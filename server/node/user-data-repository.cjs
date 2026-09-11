'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {
    atomicWriteJson,
    commitTransaction,
    moveToTrash,
    readVerifiedJson,
    recoverTransactions,
    resolveInside,
} = require('./file-store.cjs');

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

function stableId(value, prefix) {
    const raw = typeof value === 'string' ? value.trim() : '';
    if (/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(raw)) return raw;
    if (raw) return `${prefix}-${crypto.createHash('sha256').update(raw).digest('hex').slice(0, 24)}`;
    return `${prefix}-${crypto.randomUUID()}`;
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
        const indexPath = path.join(dataRoot, 'index', 'sidebar.json');
        if (!fs.existsSync(indexPath)) return null;

        const index = loadSidebarIndex({ acceptExternalChanges: true });
        const relativePaths = new Set([
            'index/sidebar.json',
            'settings/app.json',
            'secrets/credentials.json',
        ]);
        for (const [legacyName, directory] of COLLECTIONS) {
            for (const id of index.collections?.[legacyName] || []) {
                relativePaths.add(path.join(directory, `${stableId(id, directory.slice(0, -1))}.json`));
            }
        }
        for (const character of index.characters || []) {
            const characterId = stableId(character?.id, 'character');
            relativePaths.add(path.join('characters', characterId, 'metadata.json'));
            for (const chat of character?.chats || []) {
                const chatId = stableId(chat?.id, 'chat');
                relativePaths.add(chatMetadataPath(characterId, chatId));
                relativePaths.add(messagesPath(characterId, chatId));
            }
        }

        const revision = crypto.createHash('sha256');
        for (const relativePath of [...relativePaths].sort()) {
            const normalizedPath = relativePath.split(path.sep).join('/');
            const target = resolveInside(dataRoot, relativePath);
            try {
                const stat = fs.statSync(target, { bigint: true });
                revision.update(`${normalizedPath}\0${stat.size}\0${stat.mtimeNs}\n`);
            } catch (error) {
                if (error?.code !== 'ENOENT') throw error;
                revision.update(`${normalizedPath}\0missing\n`);
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
        return readJson(path.join('characters', id, 'metadata.json'), options);
    }

    function messagesPath(characterId, chatId) {
        return path.join('characters', stableId(characterId, 'character'), 'chats', stableId(chatId, 'chat'), 'messages.jsonl');
    }

    function chatMetadataPath(characterId, chatId) {
        return path.join('characters', stableId(characterId, 'character'), 'chats', stableId(chatId, 'chat'), 'metadata.json');
    }

    function loadMessages(characterId, chatId) {
        const relativePath = messagesPath(characterId, chatId);
        const target = resolveInside(dataRoot, relativePath);
        if (!fs.existsSync(target)) return [];
        const text = fs.readFileSync(target, 'utf8');
        return text.split(/\r?\n/).filter(Boolean).map((line, index) => {
            try { return JSON.parse(line); }
            catch { throw new Error(`Invalid chat JSONL at ${relativePath}:${index + 1}`); }
        });
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
    }

    function commitUserMessage(characterId, chatId, message) {
        appendMessage(characterId, chatId, message);
        return message;
    }

    function draftPath(characterId, chatId) {
        return path.join('characters', stableId(characterId, 'character'), 'chats', stableId(chatId, 'chat'), 'draft.json');
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

        const characters = [];
        for (const rawCharacter of Array.isArray(database.characters) ? database.characters : []) {
            const characterId = stableId(rawCharacter?.chaId || rawCharacter?.id, 'character');
            const chats = [];
            for (const rawChat of Array.isArray(rawCharacter?.chats) ? rawCharacter.chats : []) {
                const chatId = stableId(rawChat?.id, 'chat');
                const metadata = without(rawChat, new Set(['message']));
                operations.push({
                    path: chatMetadataPath(characterId, chatId),
                    data: jsonBytes({ ...metadata, id: chatId }),
                });
                const messages = Array.isArray(rawChat?.message) ? rawChat.message : [];
                operations.push({
                    path: messagesPath(characterId, chatId),
                    data: Buffer.from(messages.map(message => JSON.stringify(message)).join('\n') + (messages.length ? '\n' : ''), 'utf8'),
                });
                chats.push({ id: chatId, name: rawChat?.name || '', lastDate: rawChat?.lastDate ?? 0 });
            }
            const metadata = without(rawCharacter, new Set(['chats']));
            operations.push({
                path: path.join('characters', characterId, 'metadata.json'),
                data: jsonBytes({ ...metadata, chaId: characterId }),
            });
            const previousCharacter = previousIndex.characters.find(item => item.id === characterId);
            characters.push({
                id: characterId,
                name: rawCharacter?.name || '',
                updatedAt: Date.now(),
                chats: mode === 'merge' ? mergeById(previousCharacter?.chats, chats) : chats,
            });
        }

        const sidebarCharacters = mode === 'merge' ? mergeById(previousIndex.characters, characters) : characters;
        const sidebar = { schemaVersion: 1, updatedAt: Date.now(), characters: sidebarCharacters, collections };
        operations.push({ path: 'index/sidebar.json', data: jsonBytes(sidebar) });
        const transaction = commitTransaction(dataRoot, operations);

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
                    const relativePath = path.join('characters', previousCharacter.id);
                    if (fs.existsSync(resolveInside(dataRoot, relativePath))) moveToTrash(dataRoot, relativePath);
                    continue;
                }
                const retainedChats = new Set(retained.chats.map(chat => chat.id));
                for (const previousChat of previousCharacter.chats || []) {
                    const relativePath = path.join('characters', previousCharacter.id, 'chats', previousChat.id);
                    if (!retainedChats.has(previousChat.id) && fs.existsSync(resolveInside(dataRoot, relativePath))) moveToTrash(dataRoot, relativePath);
                }
            }
        }
        return { mode, characters: characters.length, files: operations.length, transaction };
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
            return { ...character, chats: summary.chats.map(chat => loadChat(summary.id, chat.id, readOptions)) };
        });
        return database;
    }

    return {
        dataRoot,
        appendMessage,
        commitUserMessage,
        exportLegacyDatabase,
        finalizeAssistantDraft,
        getProjectionRevision,
        importLegacyDatabase,
        loadAssistantDraft,
        loadCharacter,
        loadChat,
        loadMessages,
        loadSidebarIndex,
        saveAssistantDraft,
    };
}

module.exports = { createUserDataRepository, stableId };
