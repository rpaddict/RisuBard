'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {
    atomicWriteJson,
    commitTransaction,
    moveToTrash,
    readVerifiedJson,
    refreshChecksum,
    recoverTransactions,
    resolveInside,
} = require('./file-store.cjs');

const { DIRECTORY_INDEX, validateDirectoryMapping, createCharacterDirectoryResolver, resetCharacterDirectoryMappings } = require('./character-directories.cjs');
const { createCharacterPackageManifest, validateCharacterPackageManifest } = require('./character-package-manifest.cjs');
const { inspectCharacterPackageOwnership } = require('./character-package-preflight.cjs');
const { allocateSegment, planDirectoryMapping } = require('./friendly-paths.cjs');
const { collectNestedAssetReferences } = require('./orphan-cleanup.cjs');

const COLLECTIONS = [
    ['botPresets', 'presets'],
    ['modules', 'modules'],
    ['personas', 'personas'],
    ['loreBook', 'lorebooks'],
];

const SECRET_NAME = /(?:key|token|secret|password|credential|privateKey|clientEmail|accessToken|refresh_token)/i;

function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function containsSecret(value) {
    if (Array.isArray(value)) return value.some(containsSecret);
    if (!isPlainObject(value)) return false;
    return Object.entries(value).some(([key, child]) => SECRET_NAME.test(key) || containsSecret(child));
}

function splitSecrets(source) {
    const settings = {};
    const secrets = {};
    for (const [key, value] of Object.entries(source || {})) {
        if (SECRET_NAME.test(key) || (Array.isArray(value) && containsSecret(value))) {
            secrets[key] = value;
        } else if (isPlainObject(value)) {
            const nested = splitSecrets(value);
            if (Object.keys(nested.settings).length) settings[key] = nested.settings;
            if (Object.keys(nested.secrets).length) secrets[key] = nested.secrets;
            if (!Object.keys(nested.settings).length && !Object.keys(nested.secrets).length) settings[key] = {};
        } else {
            settings[key] = value;
        }
    }
    return { settings, secrets };
}

function deepMerge(base, incoming) {
    const result = isPlainObject(base) ? { ...base } : {};
    for (const [key, value] of Object.entries(incoming || {})) {
        result[key] = isPlainObject(value) && isPlainObject(result[key])
            ? deepMerge(result[key], value)
            : value;
    }
    return result;
}

function mergeById(existing, incoming) {
    const merged = new Map((existing || []).map(item => [item.id, item]));
    for (const item of incoming || []) merged.set(item.id, item);
    return [...merged.values()];
}

function jsonBytes(value) {
    return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function* messageChunks(messages) {
    for (const message of messages) yield Buffer.from(`${JSON.stringify(message) ?? ''}\n`, 'utf8');
}

function parseMessageBytes(bytes, relativePath, errorCode) {
    const messages = [];
    let start = 0;
    while (start < bytes.length) {
        const newline = bytes.indexOf(10, start);
        const end = newline === -1 ? bytes.length : newline;
        const contentEnd = newline !== -1 && bytes[end - 1] === 13 ? end - 1 : end;
        if (contentEnd > start) {
            try { messages.push(JSON.parse(bytes.toString('utf8', start, contentEnd))); }
            catch {
                const error = new Error(`Invalid chat JSONL at ${relativePath}:${messages.length + 1}`);
                if (errorCode) error.code = errorCode;
                throw error;
            }
        }
        start = end + 1;
    }
    return messages;
}

function stableId(value, prefix) {
    const raw = typeof value === 'string' ? value.trim() : '';
    if (/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(raw)) return raw;
    if (raw) return `${prefix}-${crypto.createHash('sha256').update(raw).digest('hex').slice(0, 24)}`;
    return `${prefix}-${crypto.randomUUID()}`;
}

function orderedIds(previousIds, discoveredIds) {
    const discovered = new Set(discoveredIds);
    const ordered = [];
    for (const id of previousIds || []) {
        if (discovered.delete(id)) ordered.push(id);
    }
    return [...ordered, ...[...discovered].sort()];
}

function characterUpdatedAt(character, fallback) {
    const value = character?.modification_date;
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
        return Math.trunc(value >= 1_000_000_000_000 ? value : value * 1000);
    }
    return Math.trunc(fallback);
}

function sidebarMeaning(sidebar) {
    return JSON.stringify({
        schemaVersion: 1,
        characters: Array.isArray(sidebar?.characters) ? sidebar.characters : [],
        collections: isPlainObject(sidebar?.collections) ? sidebar.collections : {},
    });
}

function without(source, names) {
    const result = {};
    for (const [key, value] of Object.entries(source || {})) {
        if (!names.has(key)) result[key] = value;
    }
    return result;
}

function createUserDataRepository(options = {}) {
    const dataRoot = path.resolve(options.dataRoot || path.join(process.cwd(), 'save'));
    fs.mkdirSync(dataRoot, { recursive: true });
    recoverTransactions(dataRoot);
    const directories = createCharacterDirectoryResolver(dataRoot);

    function checksumMismatch(relativePath) {
        const error = new Error(`Canonical file checksum mismatch: ${relativePath}`);
        error.code = 'CANONICAL_FILES_CHANGED';
        return error;
    }

    function readCanonicalBytes(relativePath) {
        const target = resolveInside(dataRoot, relativePath);
        const bytes = fs.readFileSync(target);
        const checksumPath = `${target}.sha256`;
        if (!fs.existsSync(checksumPath)) throw checksumMismatch(relativePath);
        const expected = fs.readFileSync(checksumPath, 'utf8').trim();
        const actual = crypto.createHash('sha256').update(bytes).digest('hex');
        if (!/^[a-f0-9]{64}$/i.test(expected) || expected.toLowerCase() !== actual) {
            throw checksumMismatch(relativePath);
        }
        return bytes;
    }

    function readCanonicalJson(relativePath) {
        let parsed;
        try {
            parsed = JSON.parse(readCanonicalBytes(relativePath).toString('utf8'));
        } catch (error) {
            if (error?.code === 'CANONICAL_FILES_CHANGED') throw error;
            const invalid = new Error(`Invalid canonical JSON: ${relativePath}`);
            invalid.code = 'CANONICAL_FILES_CHANGED';
            throw invalid;
        }
        if (!isPlainObject(parsed)) {
            const invalid = new Error(`Canonical file validation failed: ${relativePath}`);
            invalid.code = 'CANONICAL_FILES_CHANGED';
            throw invalid;
        }
        return parsed;
    }

    function listJsonIds(directory) {
        const absolute = path.join(dataRoot, directory);
        if (!fs.existsSync(absolute)) return [];
        return fs.readdirSync(absolute, { withFileTypes: true })
            .filter(entry => entry.isFile() && !entry.name.startsWith('.') && entry.name.endsWith('.json'))
            .map(entry => entry.name.slice(0, -'.json'.length));
    }

    function collectCanonicalSourcePaths() {
        directories.refresh();
        const relativePaths = [];
        if (directories.snapshot().characters.length) relativePaths.push(DIRECTORY_INDEX);
        for (const relativePath of ['settings/app.json', 'secrets/credentials.json']) {
            if (fs.existsSync(resolveInside(dataRoot, relativePath))) relativePaths.push(relativePath);
        }
        for (const [, directory] of COLLECTIONS) {
            for (const id of listJsonIds(directory)) relativePaths.push(path.join(directory, `${id}.json`));
        }
        for (const characterId of directories.characterIds()) {
            const mapped = directories.snapshot().characters.find(entry => entry.id === characterId);
            if (mapped?.packageVersion === 1) {
                const packagePath = path.join(directories.characterDirectory(characterId), 'package.json');
                validateCharacterPackageManifest(readCanonicalJson(packagePath), mapped);
                relativePaths.push(packagePath);
            }
            const metadataPath = path.join(directories.characterDirectory(characterId), 'metadata.json');
            if (!fs.existsSync(resolveInside(dataRoot, metadataPath))) {
                const error = new Error(`Canonical character metadata is missing: ${characterId}`);
                error.code = 'CANONICAL_FILES_CHANGED';
                throw error;
            }
            relativePaths.push(metadataPath);
            for (const chatId of directories.chatIds(characterId)) {
                const metadata = chatMetadataPath(characterId, chatId);
                const messages = messagesPath(characterId, chatId);
                if (!fs.existsSync(resolveInside(dataRoot, metadata))
                    || !fs.existsSync(resolveInside(dataRoot, messages))) {
                    const error = new Error(`Canonical chat files are incomplete: ${characterId}/${chatId}`);
                    error.code = 'CANONICAL_FILES_CHANGED';
                    throw error;
                }
                relativePaths.push(metadata, messages);
            }
        }
        return relativePaths.map(value => value.split(path.sep).join('/')).sort();
    }

    function sourceRevision(relativePaths = collectCanonicalSourcePaths()) {
        const revision = crypto.createHash('sha256');
        for (const relativePath of relativePaths) {
            const target = resolveInside(dataRoot, relativePath);
            const stat = fs.statSync(target, { bigint: true });
            const checksumPath = `${target}.sha256`;
            const sidecar = fs.existsSync(checksumPath)
                ? fs.readFileSync(checksumPath, 'utf8').trim()
                : 'missing';
            revision.update(`${relativePath}\0${stat.size}\0${stat.mtimeNs}\0${sidecar}\n`);
        }
        return revision.digest('hex');
    }

    function readPreviousSidebarForReconciliation() {
        const relativePath = 'index/sidebar.json';
        if (!fs.existsSync(resolveInside(dataRoot, relativePath))) return null;
        try {
            const value = readCanonicalJson(relativePath);
            if (!Array.isArray(value.characters) || !isPlainObject(value.collections)) return null;
            return value;
        } catch {
            return null;
        }
    }

    function loadSidebarIndex(options = {}) {
        const indexPath = path.join(dataRoot, 'index', 'sidebar.json');
        if (!fs.existsSync(indexPath)) {
            return { schemaVersion: 1, updatedAt: 0, characters: [], collections: {} };
        }
        return readVerifiedJson(dataRoot, 'index/sidebar.json', {
            ...options,
            validate: isPlainObject,
        });
    }

    function getProjectionRevision() {
        const sources = collectCanonicalSourcePaths();
        if (sources.length === 0) return null;
        const revision = crypto.createHash('sha256');
        revision.update(`sources\0${sourceRevision(sources)}\n`);
        for (const relativePath of ['index/sidebar.json', 'index/sidebar.json.sha256']) {
            const target = resolveInside(dataRoot, relativePath);
            try {
                const stat = fs.statSync(target, { bigint: true });
                revision.update(`${relativePath}\0${stat.size}\0${stat.mtimeNs}\n`);
            } catch (error) {
                if (error?.code !== 'ENOENT') throw error;
                revision.update(`${relativePath}\0missing\n`);
            }
        }
        return revision.digest('hex');
    }

    function readJson(relativePath, options = {}) {
        return readVerifiedJson(dataRoot, relativePath, {
            ...options,
            validate: isPlainObject,
        });
    }

    function loadCharacter(characterId, options = {}) {
        const id = stableId(characterId, 'character');
        return readJson(path.join(directories.characterDirectory(id), 'metadata.json'), options);
    }

    function messagesPath(characterId, chatId) {
        return path.join(directories.chatDirectory(stableId(characterId, 'character'), stableId(chatId, 'chat')), 'messages.jsonl');
    }

    function chatMetadataPath(characterId, chatId) {
        return path.join(directories.chatDirectory(stableId(characterId, 'character'), stableId(chatId, 'chat')), 'metadata.json');
    }

    function loadMessages(characterId, chatId) {
        const relativePath = messagesPath(characterId, chatId);
        const target = resolveInside(dataRoot, relativePath);
        if (!fs.existsSync(target)) return [];
        return parseMessageBytes(fs.readFileSync(target), relativePath);
    }

    function parseCanonicalMessages(characterId, chatId) {
        const relativePath = messagesPath(characterId, chatId);
        return parseMessageBytes(readCanonicalBytes(relativePath), relativePath, 'CANONICAL_FILES_CHANGED');
    }

    // V8 reports a character offset; editors show lines and columns.
    function jsonErrorLocation(text, cause) {
        const reason = String(cause?.message || 'invalid JSON').replace(/\s*in JSON at position \d+.*$/, '');
        const match = /at position (\d+)/.exec(String(cause?.message || ''));
        const position = match ? Math.min(Number(match[1]), text.length) : text.length;
        const before = text.slice(0, position);
        const line = before.split('\n').length;
        const column = position - before.lastIndexOf('\n');
        return `line ${line}, column ${column}: ${reason}`;
    }

    function reconcileCanonicalProjection(options = {}) {
        const includeDatabase = options.includeDatabase !== false;
        const externalWrites = [];
        const externalInputs = [];
        function readEditableJson(relativePath, kind) {
            if (!options.externalEditing) return readCanonicalJson(relativePath);
            const target = resolveInside(dataRoot, relativePath);
            let current = dataRoot;
            for (const part of path.relative(dataRoot, target).split(path.sep)) {
                current = path.join(current, part);
                if (fs.lstatSync(current).isSymbolicLink()) throw new Error(`External edit uses a symbolic link: ${relativePath}`);
            }
            const original = fs.readFileSync(target);
            const normalizedPath = relativePath.split(path.sep).join('/');
            const plannedOriginal = options.externalOriginals?.get(normalizedPath);
            if (plannedOriginal && !original.equals(plannedOriginal)) throw checksumMismatch(relativePath);
            const bytes = options.externalMetadata?.get(normalizedPath) || original;
            const digest = crypto.createHash('sha256').update(bytes).digest('hex');
            const checksumPath = `${target}.sha256`;
            if (fs.existsSync(checksumPath) && fs.readFileSync(checksumPath, 'utf8').trim() === digest) {
                return readCanonicalJson(relativePath);
            }
            // Name the file and the reason so a hand edit can be fixed in place.
            const fail = (reason) => {
                const error = new Error(`Invalid external ${kind}: ${normalizedPath} (${reason})`);
                error.code = 'LIVE_FILES_INVALID';
                throw error;
            };
            const text = bytes.toString('utf8');
            let value;
            try { value = JSON.parse(text); } catch (cause) { fail(jsonErrorLocation(text, cause)); }
            if (!isPlainObject(value)) fail('the top level must be a JSON object');
            // These objects are merged into live application state. Never accept prototype keys.
            JSON.stringify(value, (key, child) => {
                if (['__proto__', 'prototype', 'constructor'].includes(key)) fail(`"${key}" is not allowed`);
                return child;
            });
            if (kind === 'character') {
                if (typeof value.chaId !== 'string' || !value.chaId) fail('"chaId" must be a non-empty string');
                if ('chats' in value) fail('"chats" must not be in metadata.json');
                for (const key of ['name', 'desc', 'firstMessage', 'personality', 'scenario', 'exampleMessage', 'image']) {
                    if (key in value && typeof value[key] !== 'string') fail(`"${key}" must be a string`);
                }
                for (const key of ['globalLore', 'additionalAssets', 'emotionImages']) {
                    if (key in value && !Array.isArray(value[key])) fail(`"${key}" must be an array`);
                }
                for (const entry of value.globalLore || []) {
                    if (!isPlainObject(entry) || ('content' in entry && typeof entry.content !== 'string')) fail('each "globalLore" entry must be an object with string "content"');
                }
                for (const entry of [...(value.additionalAssets || []), ...(value.emotionImages || [])]) {
                    if (!Array.isArray(entry) || typeof entry[0] !== 'string' || typeof entry[1] !== 'string') fail('each asset entry must start with two strings');
                }
            } else if (kind === 'chat') {
                if (typeof value.id !== 'string' || !value.id) fail('"id" must be a non-empty string');
                if ('message' in value || '_stub' in value) fail('"message" must not be in metadata.json');
                if ('name' in value && typeof value.name !== 'string') fail('"name" must be a string');
                if ('localLore' in value && !Array.isArray(value.localLore)) fail('"localLore" must be an array');
                for (const entry of value.localLore || []) {
                    if (!isPlainObject(entry) || ('content' in entry && typeof entry.content !== 'string')) fail('each "localLore" entry must be an object with string "content"');
                }
            } else {
                if ('name' in value && typeof value.name !== 'string') fail('"name" must be a string');
                if ('data' in value && !Array.isArray(value.data)) fail('"data" must be an array');
                if (value.id && stableId(value.id, 'lore') !== path.basename(relativePath, '.json')) fail('"id" does not match the file name');
            }
            externalInputs.push({ target, bytes: original });
            externalWrites.push({ path: relativePath, data: bytes });
            return value;
        }
        const sourcePathsBefore = collectCanonicalSourcePaths();
        if (sourcePathsBefore.length === 0) {
            return { database: null, revision: null, sidebar: null, sidebarWritten: false, transaction: null };
        }
        const revisionBefore = sourceRevision(sourcePathsBefore);
        const previousIndex = readPreviousSidebarForReconciliation();
        const settings = fs.existsSync(path.join(dataRoot, 'settings', 'app.json'))
            ? readCanonicalJson('settings/app.json') : {};
        const secrets = fs.existsSync(path.join(dataRoot, 'secrets', 'credentials.json'))
            ? readCanonicalJson('secrets/credentials.json') : {};
        const collections = {};
        const collectionValues = {};
        for (const [legacyName, directory] of COLLECTIONS) {
            const ids = orderedIds(previousIndex?.collections?.[legacyName], listJsonIds(directory));
            collections[legacyName] = ids;
            if (includeDatabase || (options.externalEditing && directory === 'lorebooks')) {
                collectionValues[legacyName] = ids.map(id => directory === 'lorebooks'
                    ? readEditableJson(path.join(directory, `${id}.json`), 'lorebook')
                    : readCanonicalJson(path.join(directory, `${id}.json`)));
            }
        }

        const characterIds = orderedIds(
            previousIndex?.characters?.map(character => character?.id).filter(Boolean),
            directories.characterIds(),
        );
        const characters = [];
        const sidebarCharacters = [];
        for (const characterId of characterIds) {
            const metadataPath = path.join(directories.characterDirectory(characterId), 'metadata.json');
            const metadata = readEditableJson(metadataPath, 'character');
            if (metadata.chaId && stableId(metadata.chaId, 'character') !== characterId) {
                throw new Error('Canonical character directory does not match its stable ID');
            }
            const previousCharacter = previousIndex?.characters?.find(character => character?.id === characterId);
            const chatIds = orderedIds(
                previousCharacter?.chats?.map(chat => chat?.id).filter(Boolean),
                directories.chatIds(characterId),
            );
            const chats = [];
            const chatSummaries = [];
            for (const chatId of chatIds) {
                const chatMetadata = readEditableJson(chatMetadataPath(characterId, chatId), 'chat');
                if (chatMetadata.id && stableId(chatMetadata.id, 'chat') !== chatId) {
                    throw new Error('Canonical chat directory does not match its stable ID');
                }
                const previousChat = previousCharacter?.chats?.find(chat => chat?.id === chatId);
                const legacyMessagePresent = previousChat?.legacyMessagePresent !== false;
                if (includeDatabase) {
                    const loaded = { ...chatMetadata, message: parseCanonicalMessages(characterId, chatId) };
                    chats.push(legacyMessagePresent ? loaded : without(loaded, new Set(['message'])));
                }
                chatSummaries.push({
                    id: chatId,
                    name: chatMetadata?.name || '',
                    lastDate: chatMetadata?.lastDate ?? 0,
                    legacyMessagePresent,
                });
            }
            if (includeDatabase) characters.push({ ...metadata, chats });
            sidebarCharacters.push({
                id: characterId,
                name: metadata?.name || '',
                // Normal saves use a save timestamp when modification_date is
                // absent. Preserve it on reopen: replacing it with file mtime
                // rewrites our index and falsely signals an external edit.
                updatedAt: characterUpdatedAt(metadata, options.preserveSidebarTimestamps && Number.isFinite(previousCharacter?.updatedAt)
                    ? previousCharacter.updatedAt
                    : fs.statSync(resolveInside(dataRoot, metadataPath)).mtimeMs),
                chats: chatSummaries,
            });
        }

        const sourcePathsAfter = collectCanonicalSourcePaths();
        const revisionAfter = sourceRevision(sourcePathsAfter);
        if (revisionBefore !== revisionAfter
            || JSON.stringify(sourcePathsBefore) !== JSON.stringify(sourcePathsAfter)) {
            const error = new Error('Canonical files changed while reconciliation was reading them');
            error.code = 'CANONICAL_FILES_CHANGED';
            throw error;
        }

        const derived = { schemaVersion: 1, characters: sidebarCharacters, collections };
        const unchanged = previousIndex && sidebarMeaning(previousIndex) === sidebarMeaning(derived);
        const sidebar = {
            schemaVersion: 1,
            updatedAt: unchanged && Number.isFinite(previousIndex.updatedAt)
                ? previousIndex.updatedAt
                : Date.now(),
            characters: sidebarCharacters,
            collections,
        };
        for (const input of externalInputs) {
            if (!fs.readFileSync(input.target).equals(input.bytes)) throw checksumMismatch(path.relative(dataRoot, input.target));
        }
        const operations = [...externalWrites, ...(options.externalOperations || [])];
        if (!unchanged) operations.push({ path: 'index/sidebar.json', data: jsonBytes(sidebar) });
        const transaction = operations.length ? commitTransaction(dataRoot, operations) : null;
        let database = null;
        if (includeDatabase) {
            const { schemaVersion: _settingsSchema, ...plainSettings } = settings;
            const { schemaVersion: _secretsSchema, ...plainSecrets } = secrets;
            database = deepMerge(plainSettings, plainSecrets);
            for (const [legacyName] of COLLECTIONS) database[legacyName] = collectionValues[legacyName];
            database.characters = characters;
        }
        return {
            database,
            revision: getProjectionRevision(),
            sidebar,
            sidebarWritten: !unchanged,
            transaction,
        };
    }

    function loadChat(characterId, chatId, options = {}) {
        const metadata = readJson(chatMetadataPath(characterId, chatId), options);
        return { ...metadata, message: loadMessages(characterId, chatId) };
    }

    function appendMessage(characterId, chatId, message) {
        if (!message || typeof message !== 'object') throw new Error('Chat message must be an object');
        const target = resolveInside(dataRoot, messagesPath(characterId, chatId));
        fs.mkdirSync(path.dirname(target), { recursive: true });
        const fd = fs.openSync(target, 'a', 0o600);
        try {
            fs.writeSync(fd, `${JSON.stringify(message)}\n`, null, 'utf8');
            fs.fsyncSync(fd);
        } finally {
            fs.closeSync(fd);
        }
        refreshChecksum(dataRoot, messagesPath(characterId, chatId));
    }

    function commitUserMessage(characterId, chatId, message) {
        appendMessage(characterId, chatId, message);
        return message;
    }

    function draftPath(characterId, chatId) {
        return path.join(directories.chatDirectory(stableId(characterId, 'character'), stableId(chatId, 'chat')), 'draft.json');
    }

    function saveAssistantDraft(characterId, chatId, message) {
        atomicWriteJson(dataRoot, draftPath(characterId, chatId), message, {
            validate: value => value && typeof value === 'object',
        });
    }

    function loadAssistantDraft(characterId, chatId) {
        const relativePath = draftPath(characterId, chatId);
        if (!fs.existsSync(resolveInside(dataRoot, relativePath))) return null;
        return readJson(relativePath);
    }

    function finalizeAssistantDraft(characterId, chatId) {
        const relativePath = draftPath(characterId, chatId);
        const draft = loadAssistantDraft(characterId, chatId);
        if (!draft) return null;
        appendMessage(characterId, chatId, draft);
        moveToTrash(dataRoot, relativePath);
        return draft;
    }

    function characterDirectoryStatus(characterId) {
        const id = stableId(characterId, 'character');
        directories.refresh();
        const entry = directories.snapshot().characters.find(item => item.id === id);
        return entry?.packageVersion === 1
            ? { enabled: true, directory: entry.directory, chats: entry.chats.length }
            : { enabled: false, directory: id, chats: 0 };
    }

    // Explicit single-character opt-in only. The authenticated server route is
    // the product boundary; existing saves remain unchanged until it is called.
    function publishCharacterDirectoryMapping(characterId) {
        if (options.allowDirectoryMapping !== true) throw new Error('Directory mapping publication is disabled');
        const id = stableId(characterId, 'character');
        directories.refresh();
        const previous = directories.snapshot();
        if (previous.characters.some(entry => entry.id === id)) throw new Error('Character directory is already mapped');
        const summary = loadSidebarIndex().characters.find(entry => entry.id === id);
        if (!summary) throw new Error('Canonical character is unavailable');
        const character = loadCharacter(id);
        const sourceDirectory = directories.characterDirectory(id);
        const source = directories.safePath(sourceDirectory);
        const occupied = fs.readdirSync(directories.safePath('characters'));
        for (const entry of previous.characters) occupied.push(entry.id, entry.directory);
        const mapping = planDirectoryMapping({ ...character, chaId: id, chats: summary.chats }, occupied,
            fs.existsSync(path.join(source, 'chats')) ? fs.readdirSync(path.join(source, 'chats')) : []);
        delete mapping.active;
        delete mapping.schemaVersion;
        mapping.packageVersion = 1;
        const next = validateDirectoryMapping({ schemaVersion: 1, characters: [...previous.characters, mapping] });
        const operations = [];
        function copyTree(relative, destination) {
            const absolute = directories.safePath(relative);
            for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
                if (entry.isSymbolicLink()) throw new Error('Character copy uses a symbolic link');
                const child = path.join(relative, entry.name);
                let targetName = entry.name;
                if (relative === path.join(sourceDirectory, 'chats') && entry.isDirectory()) {
                    const chat = mapping.chats.find(item => item.id === entry.name);
                    if (!chat) throw new Error('Unindexed chat must be reconciled before directory mapping');
                    targetName = chat.directory;
                }
                const target = path.join(destination, targetName);
                if (entry.isDirectory()) copyTree(child, target);
                else if (entry.isFile() && !entry.name.endsWith('.sha256')) {
                    const sourcePath = directories.safePath(child);
                    operations.push({ path: target, sourcePath });
                    // Existing checksummed sources are also transaction preconditions.
                    // Legacy backup sidecars can outlive their backup revision.
                    // Preserve their bytes via verified staging, but enforce
                    // canonical checksums only for the live files.
                    if (!entry.name.endsWith('.bak') && fs.existsSync(`${sourcePath}.sha256`)) {
                        readCanonicalBytes(child);
                        operations.push({ path: child, sourcePath });
                    }
                } else if (!entry.isFile()) throw new Error('Unsupported character copy entry');
            }
        }
        copyTree(sourceDirectory, path.join('characters', mapping.directory));
        operations.push({
            path: path.join('characters', mapping.directory, 'package.json'),
            data: jsonBytes(createCharacterPackageManifest(mapping)),
        });
        // All copies are staged and verified before the journal publishes the mapping last.
        operations.push({ path: DIRECTORY_INDEX, data: jsonBytes(next) });
        try {
            commitTransaction(dataRoot, operations, options.directoryMappingTransactionOptions || {});
        } catch (error) {
            // Do not leave a live repository discovering a half-published destination.
            const recovery = recoverTransactions(dataRoot);
            if (recovery.recovered > 0 && JSON.stringify(readVerifiedJson(dataRoot, DIRECTORY_INDEX)) === JSON.stringify(next)) {
                error.canonicalTransitionRecovered = true;
            }
            throw error;
        } finally {
            directories.invalidate();
        }
        return mapping;
    }

    function refreshCharacterDirectoryMapping(characterId) {
        if (options.allowDirectoryMapping !== true) throw new Error('Directory mapping publication is disabled');
        const id = stableId(characterId, 'character');
        directories.refresh();
        const previous = directories.snapshot();
        const current = previous.characters.find(entry => entry.id === id);
        if (!current) throw new Error('Character directory is not mapped');
        const summary = loadSidebarIndex().characters.find(entry => entry.id === id);
        if (!summary) throw new Error('Canonical character is unavailable');
        const character = loadCharacter(id);
        const charactersRoot = directories.safePath('characters');
        const occupiedCharacters = new Set(fs.readdirSync(charactersRoot));
        occupiedCharacters.delete(current.directory);
        occupiedCharacters.add(id);
        for (const entry of previous.characters) {
            if (entry.id === id) continue;
            occupiedCharacters.add(entry.id);
            occupiedCharacters.add(entry.directory);
        }
        const nextDirectory = allocateSegment(character.name, occupiedCharacters);
        const currentRoot = path.join('characters', current.directory);
        const nextRoot = path.join('characters', nextDirectory);
        const currentChatsRoot = directories.safePath(path.join(currentRoot, 'chats'));
        const occupiedChats = new Set(fs.existsSync(currentChatsRoot) ? fs.readdirSync(currentChatsRoot) : []);
        const activeIds = new Set(summary.chats.map(chat => chat.id));
        const retainedChats = current.chats.filter(chat => !activeIds.has(chat.id));
        for (const chat of retainedChats) {
            occupiedChats.add(chat.id);
            occupiedChats.add(chat.directory);
        }
        const nextChats = [];
        for (const chat of summary.chats) {
            const old = current.chats.find(entry => entry.id === chat.id) || { id: chat.id, directory: chat.id };
            occupiedChats.delete(old.directory);
            occupiedChats.add(chat.id);
            const directory = allocateSegment(chat.name, occupiedChats);
            occupiedChats.add(directory);
            occupiedChats.add(chat.id);
            nextChats.push({ id: chat.id, directory });
        }
        const nextEntry = { id, directory: nextDirectory, packageVersion: 1, chats: [...nextChats, ...retainedChats] };
        const next = validateDirectoryMapping({
            schemaVersion: 1,
            characters: previous.characters.map(entry => entry.id === id ? nextEntry : entry),
        });
        const operations = [];
        const characterMoved = current.directory !== nextDirectory;
        if (characterMoved) operations.push({ path: currentRoot, moveTo: nextRoot });
        for (const chat of nextChats) {
            const old = current.chats.find(entry => entry.id === chat.id) || { id: chat.id, directory: chat.id };
            if (old.directory === chat.directory) continue;
            operations.push({
                path: path.join(nextRoot, 'chats', old.directory),
                moveTo: path.join(nextRoot, 'chats', chat.directory),
                sourceCreatedByTransaction: characterMoved,
            });
        }
        operations.push({
            path: path.join(nextRoot, 'package.json'),
            data: jsonBytes(createCharacterPackageManifest(nextEntry)),
        });
        operations.push({ path: DIRECTORY_INDEX, data: jsonBytes(next) });
        try {
            commitTransaction(dataRoot, operations, options.directoryMappingTransactionOptions || {});
        } catch (error) {
            const recovery = recoverTransactions(dataRoot);
            if (recovery.recovered > 0 && JSON.stringify(readVerifiedJson(dataRoot, DIRECTORY_INDEX)) === JSON.stringify(next)) {
                error.canonicalTransitionRecovered = true;
            }
            resetCharacterDirectoryMappings(dataRoot);
            throw error;
        }
        resetCharacterDirectoryMappings(dataRoot);
        directories.refresh();
        return directories.snapshot().characters.find(entry => entry.id === id);
    }

    function rollbackCharacterDirectoryMapping(characterId) {
        if (options.allowDirectoryMapping !== true) throw new Error('Directory mapping publication is disabled');
        const id = stableId(characterId, 'character');
        directories.refresh();
        const previous = directories.snapshot();
        const current = previous.characters.find(entry => entry.id === id);
        if (!current || current.packageVersion !== 1) return characterDirectoryStatus(id);
        const currentRoot = path.join('characters', current.directory);
        const legacyRoot = path.join('characters', id);
        const token = `${Date.now()}-${crypto.randomUUID()}`;
        const operations = [];
        if (current.directory !== id) {
            if (fs.existsSync(directories.safePath(legacyRoot))) {
                operations.push({ path: legacyRoot, moveTo: path.join('trash', token, legacyRoot) });
            }
            operations.push({
                path: currentRoot,
                moveTo: legacyRoot,
                destinationClearedByTransaction: true,
            });
        }
        for (const chat of current.chats) {
            if (chat.directory === chat.id) continue;
            const source = path.join(legacyRoot, 'chats', chat.directory);
            if (!fs.existsSync(directories.safePath(path.join(currentRoot, 'chats', chat.directory)))) continue;
            operations.push({
                path: source,
                moveTo: path.join(legacyRoot, 'chats', chat.id),
                sourceCreatedByTransaction: current.directory !== id,
                destinationClearedByTransaction: true,
            });
        }
        for (const name of ['package.json', 'package.json.sha256']) {
            if (!fs.existsSync(directories.safePath(path.join(currentRoot, name)))) continue;
            operations.push({
                path: path.join(legacyRoot, name),
                moveTo: path.join('trash', token, 'v3-package', name),
                sourceCreatedByTransaction: current.directory !== id,
            });
        }
        const next = validateDirectoryMapping({
            schemaVersion: 1,
            characters: previous.characters.filter(entry => entry.id !== id),
        });
        operations.push({ path: DIRECTORY_INDEX, data: jsonBytes(next) });
        try {
            commitTransaction(dataRoot, operations, options.directoryMappingTransactionOptions || {});
        } catch (error) {
            const recovery = recoverTransactions(dataRoot);
            if (recovery.recovered > 0 && JSON.stringify(readVerifiedJson(dataRoot, DIRECTORY_INDEX)) === JSON.stringify(next)) {
                error.canonicalTransitionRecovered = true;
            }
            resetCharacterDirectoryMappings(dataRoot);
            throw error;
        }
        resetCharacterDirectoryMappings(dataRoot);
        directories.refresh();
        return characterDirectoryStatus(id);
    }

    function maintainMappedDirectories(characterIds) {
        if (options.maintainDirectoryNames !== true) return;
        directories.refresh();
        const active = new Set(directories.snapshot().characters.filter(entry => entry.packageVersion === 1).map(entry => entry.id));
        for (const id of characterIds) if (active.has(id)) refreshCharacterDirectoryMapping(id);
    }

    function importLegacyDatabase(database, importOptions = {}) {
        if (!database || typeof database !== 'object') throw new Error('Legacy database must be an object');
        const mode = importOptions.mode || 'merge';
        if (!['merge', 'replace', 'sync'].includes(mode)) throw new Error('Import mode must be merge or replace');

        const previousIndex = loadSidebarIndex();

        const excluded = new Set(['characters', ...COLLECTIONS.map(([legacy]) => legacy)]);
        const incoming = splitSecrets(without(database, excluded));
        const previousSettings = fs.existsSync(path.join(dataRoot, 'settings', 'app.json')) ? readJson('settings/app.json') : {};
        const previousSecrets = fs.existsSync(path.join(dataRoot, 'secrets', 'credentials.json')) ? readJson('secrets/credentials.json') : {};
        const settings = mode === 'merge' ? deepMerge(previousSettings, incoming.settings) : incoming.settings;
        const secrets = mode === 'merge' ? deepMerge(previousSecrets, incoming.secrets) : incoming.secrets;

        const operations = [
            { path: 'settings/app.json', data: jsonBytes({ schemaVersion: 1, ...settings }) },
            { path: 'secrets/credentials.json', data: jsonBytes({ schemaVersion: 1, ...secrets }) },
        ];
        const collections = {};
        for (const [legacyName, directory] of COLLECTIONS) {
            const values = Array.isArray(database[legacyName]) ? database[legacyName] : [];
            const incomingIds = [];
            for (const item of values) {
                const id = stableId(item?.id, directory.slice(0, -1));
                incomingIds.push(id);
                operations.push({ path: path.join(directory, `${id}.json`), data: jsonBytes({ ...item, id }) });
            }
            collections[legacyName] = mode === 'merge'
                ? [...new Set([...(previousIndex.collections?.[legacyName] || []), ...incomingIds])]
                : incomingIds;
        }

        const incomingCharacters = (Array.isArray(database.characters) ? database.characters : []).map(character => ({
            raw: character,
            id: stableId(character?.chaId || character?.id, 'character'),
            chats: (Array.isArray(character?.chats) ? character.chats : []).map(chat => ({ raw: chat, id: stableId(chat?.id, 'chat') })),
        }));
        directories.refresh();
        const previousMapping = directories.snapshot();
        const newMappings = new Map();
        if (options.newCharacterPackages === true && mode === 'sync' && importOptions.preserveCharacterLayout !== true) {
            const occupied = new Set([
                ...incomingCharacters.map(character => character.id),
                ...previousMapping.characters.flatMap(entry => [entry.id, entry.directory]),
                ...(fs.existsSync(path.join(dataRoot, 'characters')) ? fs.readdirSync(directories.safePath('characters')) : []),
            ]);
            const existing = new Set(previousIndex.characters.map(character => character.id));
            for (const { raw, id, chats } of incomingCharacters) {
                if (existing.has(id) || previousMapping.characters.some(entry => entry.id === id)
                    || fs.existsSync(directories.safePath(directories.characterDirectory(id)))) continue;
                const mapping = planDirectoryMapping({ ...raw, chaId: id, chats: chats.map(chat => ({ ...chat.raw, id: chat.id })) },
                    [...occupied], chats.map(chat => chat.id));
                delete mapping.active;
                delete mapping.schemaVersion;
                mapping.packageVersion = 1;
                newMappings.set(id, mapping);
                occupied.add(mapping.directory);
                operations.push({ path: path.join('characters', mapping.directory, 'package.json'), data: jsonBytes(createCharacterPackageManifest(mapping)) });
            }
        }
        const nextMapping = newMappings.size ? validateDirectoryMapping({ schemaVersion: 1,
            characters: [...previousMapping.characters, ...newMappings.values()] }) : null;
        const characters = [];
        for (const { raw: rawCharacter, id: characterId, chats: incomingChats } of incomingCharacters) {
            const mapping = newMappings.get(characterId);
            const characterDirectory = mapping ? path.join('characters', mapping.directory) : directories.characterDirectory(characterId);
            const chats = [];
            for (const { raw: rawChat, id: chatId } of incomingChats) {
                const chatDirectory = mapping ? path.join(characterDirectory, 'chats', mapping.chats.find(chat => chat.id === chatId).directory)
                    : directories.chatDirectory(characterId, chatId);
                const metadata = without(rawChat, new Set(['message']));
                operations.push({
                    path: path.join(chatDirectory, 'metadata.json'),
                    data: jsonBytes(metadata),
                });
                const messages = Array.isArray(rawChat?.message) ? rawChat.message : [];
                operations.push({
                    path: path.join(chatDirectory, 'messages.jsonl'),
                    chunks: () => messageChunks(messages),
                });
                chats.push({
                    id: chatId,
                    name: rawChat?.name || '',
                    lastDate: rawChat?.lastDate ?? 0,
                    legacyMessagePresent: Object.prototype.hasOwnProperty.call(rawChat, 'message'),
                });
            }
            const metadata = without(rawCharacter, new Set(['chats']));
            operations.push({
                path: path.join(characterDirectory, 'metadata.json'),
                data: jsonBytes({ ...metadata, chaId: characterId }),
            });
            const previousCharacter = previousIndex.characters.find(item => item.id === characterId);
            characters.push({
                id: characterId,
                name: rawCharacter?.name || '',
                updatedAt: characterUpdatedAt(rawCharacter, Date.now()),
                chats: mode === 'merge' ? mergeById(previousCharacter?.chats, chats) : chats,
            });
        }

        const sidebarCharacters = mode === 'merge' ? mergeById(previousIndex.characters, characters) : characters;
        const sidebar = { schemaVersion: 1, updatedAt: Date.now(), characters: sidebarCharacters, collections };
        operations.push({ path: 'index/sidebar.json', data: jsonBytes(sidebar) });
        // Ordinary saves permanently delete explicitly removed characters. Keep
        // backup/import replacement recovery separate from user deletion.
        const deletedAssetCandidates = new Set();
        if (mode === 'sync') {
            const retainedIds = new Set(characters.map(character => character.id));
            for (const previous of previousIndex.characters) {
                if (retainedIds.has(previous.id)) continue;
                collectNestedAssetReferences(loadCharacter(previous.id), deletedAssetCandidates);
                for (const chat of previous.chats || []) {
                    collectNestedAssetReferences(loadChat(previous.id, chat.id), deletedAssetCandidates);
                }
                const current = directories.characterDirectory(previous.id);
                const legacy = path.join('characters', previous.id);
                for (const relativePath of new Set([current, legacy])) {
                    directories.safePath(relativePath);
                    operations.push({ path: relativePath, deleteCharacter: true });
                }
            }
        }
        // Publish identity only after every new package file has been staged.
        if (nextMapping) operations.push({ path: DIRECTORY_INDEX, data: jsonBytes(nextMapping) });
        const transaction = commitTransaction(dataRoot, operations);
        if (nextMapping) directories.invalidate();

        if (mode !== 'merge') {
            for (const [legacyName, directory] of COLLECTIONS) {
                const retained = new Set(collections[legacyName]);
                for (const id of previousIndex.collections?.[legacyName] || []) {
                    const relativePath = path.join(directory, `${id}.json`);
                    if (!retained.has(id) && fs.existsSync(resolveInside(dataRoot, relativePath))) moveToTrash(dataRoot, relativePath);
                }
            }
            const retainedCharacters = new Map(characters.map(item => [item.id, item]));
            for (const previousCharacter of previousIndex.characters) {
                const retained = retainedCharacters.get(previousCharacter.id);
                if (!retained) {
                    if (mode === 'sync') continue;
                    const relativePath = directories.characterDirectory(previousCharacter.id);
                    if (fs.existsSync(resolveInside(dataRoot, relativePath))) moveToTrash(dataRoot, relativePath);
                    continue;
                }
                const retainedChats = new Set(retained.chats.map(chat => chat.id));
                for (const previousChat of previousCharacter.chats || []) {
                    const relativePath = directories.chatDirectory(previousCharacter.id, previousChat.id);
                    if (!retainedChats.has(previousChat.id) && fs.existsSync(resolveInside(dataRoot, relativePath))) moveToTrash(dataRoot, relativePath);
                }
            }
        }
        maintainMappedDirectories(characters.map(character => character.id).filter(id => !newMappings.has(id)));
        return { mode, characters: characters.length, files: operations.length, transaction, deletedAssetCandidates: [...deletedAssetCandidates] };
    }

    function syncLegacyCollection(legacyName, values) {
        const collection = COLLECTIONS.find(([name]) => name === legacyName);
        if (!collection) throw new Error(`Unsupported legacy collection: ${legacyName}`);
        if (!Array.isArray(values)) throw new Error(`Legacy collection must be an array: ${legacyName}`);

        const [, directory] = collection;
        const previousIndex = loadSidebarIndex();
        const incomingIds = [];
        const operations = [];
        for (const item of values) {
            const id = stableId(item?.id, directory.slice(0, -1));
            incomingIds.push(id);
            operations.push({ path: path.join(directory, `${id}.json`), data: jsonBytes({ ...item, id }) });
        }
        const sidebar = {
            ...previousIndex,
            schemaVersion: 1,
            updatedAt: Date.now(),
            collections: {
                ...(previousIndex.collections || {}),
                [legacyName]: incomingIds,
            },
        };
        operations.push({ path: 'index/sidebar.json', data: jsonBytes(sidebar) });
        const transaction = commitTransaction(dataRoot, operations);

        const retained = new Set(incomingIds);
        for (const id of previousIndex.collections?.[legacyName] || []) {
            const relativePath = path.join(directory, `${id}.json`);
            if (!retained.has(id) && fs.existsSync(resolveInside(dataRoot, relativePath))) {
                moveToTrash(dataRoot, relativePath);
            }
        }
        return { legacyName, files: operations.length, transaction };
    }

    function syncLegacyPresetState(database) {
        if (!database || typeof database !== 'object') throw new Error('Legacy database must be an object');
        if (!Array.isArray(database.botPresets)) throw new Error('Legacy collection must be an array: botPresets');

        const previousIndex = loadSidebarIndex();
        const excluded = new Set(['characters', ...COLLECTIONS.map(([legacy]) => legacy)]);
        const incoming = splitSecrets(without(database, excluded));
        const values = database.botPresets;
        const incomingIds = [];
        const operations = [
            { path: 'settings/app.json', data: jsonBytes({ schemaVersion: 1, ...incoming.settings }) },
            { path: 'secrets/credentials.json', data: jsonBytes({ schemaVersion: 1, ...incoming.secrets }) },
        ];
        for (const item of values) {
            const id = stableId(item?.id, 'preset');
            incomingIds.push(id);
            operations.push({ path: path.join('presets', `${id}.json`), data: jsonBytes({ ...item, id }) });
        }
        const sidebar = {
            ...previousIndex,
            schemaVersion: 1,
            updatedAt: Date.now(),
            collections: {
                ...(previousIndex.collections || {}),
                botPresets: incomingIds,
            },
        };
        operations.push({ path: 'index/sidebar.json', data: jsonBytes(sidebar) });
        const transaction = commitTransaction(dataRoot, operations);

        const retained = new Set(incomingIds);
        for (const id of previousIndex.collections?.botPresets || []) {
            const relativePath = path.join('presets', `${stableId(id, 'preset')}.json`);
            if (!retained.has(id) && fs.existsSync(resolveInside(dataRoot, relativePath))) {
                moveToTrash(dataRoot, relativePath);
            }
        }
        return { files: operations.length, transaction };
    }

    function syncLegacyChatState(database, scope) {
        // Validate the complete identity topology before planning any write. Moves,
        // creation and deletion stay on the full-sync lane, including stale scopes.
        // Character metadata may change without any accompanying chat body edit.
        const invalid = () => { throw Object.assign(new Error('Chat direct-write scope changed'), { code: 'CHAT_SCOPE_CHANGED' }); };
        const previousIndex = loadSidebarIndex();
        const characters = database?.characters;
        if (!Array.isArray(characters) || characters.length !== previousIndex.characters.length
            || !Array.isArray(scope?.chats)
            || (scope.chats.length === 0 && (!Array.isArray(scope.characterIds) || scope.characterIds.length === 0))) invalid();
        const byId = new Map();
        const storedCharacterIds = new Set();
        for (let i = 0; i < characters.length; i++) {
            const character = characters[i];
            const rawId = character?.chaId || character?.id;
            if (typeof rawId !== 'string' || !rawId.trim()) invalid();
            const id = stableId(rawId, 'character');
            const previous = previousIndex.characters[i];
            if (previous.id !== id || storedCharacterIds.has(id) || !Array.isArray(character.chats)
                || character.chats.length !== previous.chats.length) invalid();
            storedCharacterIds.add(id);
            const chats = new Map();
            const storedIds = new Set();
            for (let j = 0; j < character.chats.length; j++) {
                const chat = character.chats[j];
                if (typeof chat?.id !== 'string' || !chat.id.trim()) invalid();
                const chatId = stableId(chat.id, 'chat');
                if (previous.chats[j].id !== chatId || storedIds.has(chatId)) invalid();
                storedIds.add(chatId);
                chats.set(chat.id, { chat, id: chatId, index: j });
            }
            byId.set(rawId, { character, id, index: i, chats });
        }
        const selected = new Map();
        const dirtyCharacters = new Set(scope.characterIds || []);
        for (const entry of scope.chats) {
            const character = byId.get(entry?.characterId);
            const chat = character?.chats.get(entry?.chatId);
            if (!chat || !Array.isArray(chat.chat.message)) invalid();
            selected.set(JSON.stringify([entry.characterId, entry.chatId]), { character, ...chat });
            dirtyCharacters.add(entry.characterId);
        }
        for (const id of dirtyCharacters) if (!byId.has(id)) invalid();

        const operations = [];
        if (scope.includeRootSettings) {
            const incoming = splitSecrets(without(database, new Set(['characters', ...COLLECTIONS.map(([legacy]) => legacy)])));
            operations.push(
                { path: 'settings/app.json', data: jsonBytes({ schemaVersion: 1, ...incoming.settings }) },
                { path: 'secrets/credentials.json', data: jsonBytes({ schemaVersion: 1, ...incoming.secrets }) },
            );
        }
        const sidebar = { ...previousIndex, updatedAt: Date.now(), characters: previousIndex.characters.map(character => ({ ...character, chats: [...character.chats] })) };
        for (const rawId of dirtyCharacters) {
            const { character, id, index } = byId.get(rawId);
            operations.push({ path: path.join(directories.characterDirectory(id), 'metadata.json'),
                data: jsonBytes({ ...without(character, new Set(['chats'])), chaId: id }) });
            Object.assign(sidebar.characters[index], { name: character.name || '', updatedAt: characterUpdatedAt(character, Date.now()) });
        }
        for (const { character, chat, id, index } of selected.values()) {
            operations.push(
                { path: chatMetadataPath(character.id, id), data: jsonBytes(without(chat, new Set(['message']))) },
                { path: messagesPath(character.id, id), chunks: () => messageChunks(chat.message) },
            );
            sidebar.characters[character.index].chats[index] = {
                id, name: chat.name || '', lastDate: chat.lastDate ?? 0, legacyMessagePresent: true,
            };
        }
        operations.push({ path: 'index/sidebar.json', data: jsonBytes(sidebar) });
        const transaction = commitTransaction(dataRoot, operations);
        maintainMappedDirectories([...dirtyCharacters].map(rawId => byId.get(rawId).id));
        return { files: operations.length, transaction };
    }

    function loadCollection(directory, ids, options = {}) {
        return (ids || []).map(id => readJson(path.join(directory, `${stableId(id, directory.slice(0, -1))}.json`), options));
    }

    function exportLegacyDatabase(exportOptions = {}) {
        const readOptions = { acceptExternalChanges: exportOptions.acceptExternalChanges === true };
        const settings = fs.existsSync(path.join(dataRoot, 'settings', 'app.json')) ? readJson('settings/app.json', readOptions) : {};
        const secrets = fs.existsSync(path.join(dataRoot, 'secrets', 'credentials.json')) ? readJson('secrets/credentials.json', readOptions) : {};
        const { schemaVersion: _settingsSchema, ...plainSettings } = settings;
        const { schemaVersion: _secretsSchema, ...plainSecrets } = secrets;
        const index = loadSidebarIndex(readOptions);
        const database = deepMerge(plainSettings, plainSecrets);
        for (const [legacyName, directory] of COLLECTIONS) {
            database[legacyName] = loadCollection(directory, index.collections?.[legacyName], readOptions);
        }
        database.characters = index.characters.map(summary => {
            const character = loadCharacter(summary.id, readOptions);
            return {
                ...character,
                chats: summary.chats.map(chat => {
                    const loaded = exportOptions.metadataOnly
                        ? readJson(chatMetadataPath(summary.id, chat.id), readOptions)
                        : loadChat(summary.id, chat.id, readOptions);
                    if (chat.legacyMessagePresent !== false) return loaded;
                    const { message: _message, ...withoutMessage } = loaded;
                    return withoutMessage;
                }),
            };
        });
        return database;
    }

    function loadStartupDatabase() {
        const database = exportLegacyDatabase({ metadataOnly: true });
        for (const character of database.characters) {
            if (!character.chaId || character.coldstorage) throw new Error('Legacy migration required');
            character.chats = character.chats.map(chat => {
                if (!chat.id) throw new Error('Legacy chat ID migration required');
                const stub = { id: chat.id, name: chat.name ?? '', _stub: true };
                for (const field of ['lastDate', 'folderId', 'modules']) {
                    if (field in chat) stub[field] = chat[field];
                }
                return stub;
            });
        }
        return database;
    }

    function loadIndexedChat(characterId, chatIndex) {
        if (!Number.isInteger(chatIndex) || chatIndex < 0) return null;
        const summary = loadSidebarIndex().characters.find(character => character.id === characterId);
        const chat = summary?.chats?.[chatIndex];
        return chat ? loadChat(summary.id, chat.id) : null;
    }

    if (collectCanonicalSourcePaths().length > 0) {
        try {
            reconcileCanonicalProjection({ includeDatabase: false, preserveSidebarTimestamps: true, externalEditing: options.liveExternalEditing === true });
        } catch (error) {
            // Keep the server available to report/retry an unfinished editor
            // save. Never bless its checksum or overwrite the editor's bytes.
            if (!options.liveExternalEditing || error?.code !== 'LIVE_FILES_INVALID') throw error;
        }
    }

    return {
        dataRoot,
        appendMessage,
        commitUserMessage,
        exportLegacyDatabase,
        finalizeAssistantDraft,
        getProjectionRevision,
        importLegacyDatabase,
        inspectCharacterPackageOwnership: characterId => inspectCharacterPackageOwnership(exportLegacyDatabase(), stableId(characterId, 'character')),
        characterDirectoryStatus,
        loadAssistantDraft,
        loadCharacter,
        loadChat,
        loadIndexedChat,
        loadStartupDatabase,
        loadMessages,
        loadSidebarIndex,
        reconcileCanonicalProjection,
        recoverPendingTransactions: () => recoverTransactions(dataRoot),
        saveAssistantDraft,
        publishCharacterDirectoryMapping,
        refreshCharacterDirectoryMapping,
        rollbackCharacterDirectoryMapping,
        syncLegacyPresetState,
        syncLegacyChatState,
        syncLegacyCollection,
    };
}

module.exports = { createUserDataRepository, stableId };
