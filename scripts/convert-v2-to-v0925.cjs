'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { atomicWriteJson } = require('../server/node/file-store.cjs');
const { createUserDataRepository, stableId } = require('../server/node/user-data-repository.cjs');

const GROUPS = [
    ['botPresets', 'prompts', 'prompt', 'presets', 'preset'],
    ['modules', 'modules', 'module', 'modules', 'module'],
    ['personas', 'personas', 'persona', 'personas', 'persona'],
    ['loreBook', 'lorebooks', 'lorebook', 'lorebooks', 'lorebook'],
];
const MAIN_FILES = Object.freeze({
    character: 'character.json',
    module: 'module.json',
    persona: 'persona.json',
    prompt: 'settings.json',
    lorebook: 'lorebook.json',
    chat: 'metadata.json',
});
const V2_OWNED_TOP_LEVEL = new Set([
    '.journal', 'characters', 'conversion', 'database', 'index', 'kv', 'lorebooks',
    'migration', 'migration-backups', 'modules', 'personas', 'presets', 'prompts',
    'secrets', 'settings', 'shared', 'trash',
]);
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const SHA256 = /^[a-f0-9]{64}$/;

function isObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function digest(value) {
    return crypto.createHash('sha256').update(value).digest('hex');
}

function digestFile(filePath) {
    const hash = crypto.createHash('sha256');
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    const fd = fs.openSync(filePath, 'r');
    try {
        let size;
        do {
            size = fs.readSync(fd, buffer, 0, buffer.length, null);
            if (size) hash.update(buffer.subarray(0, size));
        } while (size);
    } finally {
        fs.closeSync(fd);
    }
    return hash.digest('hex');
}

function isMissingError(error) {
    for (let current = error; current; current = current.cause) {
        if (current.code === 'ENOENT' || /Missing V2 source file|ENOENT/.test(String(current.message || current))) {
            return true;
        }
    }
    return false;
}

function countTreeFiles(root) {
    let count = 0;
    function visit(directory) {
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
            const target = path.join(directory, entry.name);
            const stat = assertNoLink(target, 'V2 source');
            if (stat.isDirectory()) visit(target);
            else if (stat.isFile()) count += 1;
            else throw new Error(`V2 source contains an unsupported reparse point or file type: ${target}`);
        }
    }
    visit(root);
    return count;
}

function createProgressReporter(callback) {
    let lastPercent = -1;
    return (percent, message) => {
        const normalized = Math.max(0, Math.min(100, Math.floor(percent)));
        if (normalized <= lastPercent) return;
        lastPercent = normalized;
        callback?.({ percent: normalized, message });
    };
}

function normalizedAbsolute(value) {
    const resolved = path.resolve(value);
    return process.platform === 'win32' ? resolved.toLocaleLowerCase('en-US') : resolved;
}

function isInside(parent, child) {
    const relative = path.relative(parent, child);
    return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function assertSafeRelative(value, label = 'path') {
    if (typeof value !== 'string' || !value || path.posix.isAbsolute(value) || path.win32.isAbsolute(value)
        || /[:\x00-\x1f]/.test(value)
        || value.split(/[\\/]/).some(part => !part || part === '.' || part === '..' || /[. ]$/.test(part))) {
        throw new Error(`${label} must be a safe relative path`);
    }
    return value.replace(/\\/g, '/');
}

function assertNoLink(filePath, label) {
    const stat = fs.lstatSync(filePath);
    if (stat.isSymbolicLink()) throw new Error(`${label} contains a symbolic link or reparse point: ${filePath}`);
    return stat;
}

function resolveSource(root, relative, options = {}) {
    const normalized = assertSafeRelative(relative, 'V2 source path');
    let current = root;
    for (const part of normalized.split('/')) {
        current = path.join(current, part);
        if (!fs.existsSync(current)) {
            if (options.optional) return null;
            throw new Error(`Missing V2 source file: ${normalized}`);
        }
        assertNoLink(current, 'V2 source');
    }
    return current;
}

function readBytes(root, relative, options = {}) {
    const target = resolveSource(root, relative, options);
    if (target === null) return null;
    if (!fs.statSync(target).isFile()) throw new Error(`V2 source is not a file: ${relative}`);
    const bytes = fs.readFileSync(target);
    const checksumPath = resolveSource(root, `${assertSafeRelative(relative)}.sha256`, { optional: true });
    if (checksumPath) {
        const expected = fs.readFileSync(checksumPath, 'utf8').trim();
        if (!SHA256.test(expected) || digest(bytes) !== expected) {
            throw new Error(`V2 source checksum mismatch: ${relative}`);
        }
    }
    return bytes;
}

function readJson(root, relative, validate) {
    const bytes = readBytes(root, relative);
    let value;
    try { value = JSON.parse(bytes.toString('utf8')); }
    catch (error) { throw new Error(`Invalid V2 JSON: ${relative}`, { cause: error }); }
    if (validate && validate(value) !== true) throw new Error(`Invalid V2 JSON shape: ${relative}`);
    return value;
}

function treeDigest(root, options = {}) {
    const includeMetadata = options.includeMetadata !== false;
    const hash = crypto.createHash('sha256');
    assertNoLink(root, 'V2 source');
    if (!fs.statSync(root).isDirectory()) throw new Error(`Expected a directory: ${root}`);
    function visit(relative) {
        const directory = relative ? path.join(root, relative) : root;
        const entries = fs.readdirSync(directory, { withFileTypes: true })
            .sort((left, right) => left.name.localeCompare(right.name));
        for (const entry of entries) {
            const local = relative ? path.join(relative, entry.name) : entry.name;
            const target = path.join(root, local);
            const before = assertNoLink(target, 'V2 source');
            const normalized = local.split(path.sep).join('/');
            if (before.isDirectory()) {
                hash.update(`d\0${normalized}\n`);
                visit(local);
            } else if (before.isFile()) {
                const beforeBig = fs.lstatSync(target, { bigint: true });
                hash.update(`f\0${normalized}\0${beforeBig.size}\0`);
                if (includeMetadata) hash.update(`${beforeBig.mtimeNs}\0${beforeBig.ctimeNs}\0`);
                hash.update(digestFile(target));
                const after = fs.lstatSync(target, { bigint: true });
                if (beforeBig.size !== after.size || beforeBig.mtimeNs !== after.mtimeNs || beforeBig.ctimeNs !== after.ctimeNs) {
                    throw new Error(`V2 source changed while being read: ${normalized}`);
                }
                hash.update('\n');
                options.onFile?.(normalized);
            } else {
                throw new Error(`V2 source contains an unsupported reparse point or file type: ${normalized}`);
            }
        }
    }
    visit('');
    return hash.digest('hex');
}

function validateFieldPath(fieldPath) {
    if (!Array.isArray(fieldPath) || fieldPath.length === 0 || fieldPath.some(segment => (
        typeof segment === 'number'
            ? !Number.isSafeInteger(segment) || segment < 0
            : typeof segment !== 'string' || !segment || FORBIDDEN_KEYS.has(segment)
    ))) throw new Error('Invalid V2 entity field path');
}

function fieldPathStartsWith(value, prefix) {
    return prefix.length <= value.length && prefix.every((segment, index) => value[index] === segment);
}

function fieldParent(entity, fieldPath) {
    let parent = entity;
    for (const segment of fieldPath.slice(0, -1)) {
        if (!parent || typeof parent !== 'object' || !Object.hasOwn(parent, segment)) {
            throw new Error('V2 entity field path is missing from metadata');
        }
        parent = parent[segment];
    }
    const key = fieldPath[fieldPath.length - 1];
    if (!parent || typeof parent !== 'object'
        || (Array.isArray(parent) && (typeof key !== 'number' || key >= parent.length))) {
        throw new Error('Invalid V2 entity field path container');
    }
    return parent;
}

function decodeEntity(root, kind, folder, options = {}) {
    const prefix = assertSafeRelative(folder, 'V2 entity folder');
    const filename = MAIN_FILES[kind];
    if (!filename) throw new Error(`Unknown V2 entity kind: ${kind}`);
    const manifest = readJson(root, `${prefix}/manifest.json`, value => (
        value?.schemaVersion === 2 && value.kind === kind && isObject(value.fieldFiles)
    ));
    const names = new Set([filename.toLocaleLowerCase('en-US'), 'manifest.json']);
    const fieldPaths = [];
    for (const [name, fieldPath] of Object.entries(manifest.fieldFiles)) {
        const safeName = assertSafeRelative(name, 'V2 entity field file');
        const folded = safeName.toLocaleLowerCase('en-US');
        if (!/\.(?:md|json)$/.test(safeName) || names.has(folded)) {
            throw new Error('Invalid or duplicate V2 entity manifest file path');
        }
        validateFieldPath(fieldPath);
        if (fieldPaths.some(previous => fieldPathStartsWith(previous, fieldPath) || fieldPathStartsWith(fieldPath, previous))) {
            throw new Error('Overlapping V2 entity manifest field paths');
        }
        names.add(folded);
        fieldPaths.push(fieldPath);
    }
    const entity = readJson(root, `${prefix}/${filename}`, isObject);
    for (const [name, fieldPath] of Object.entries(manifest.fieldFiles)) {
        const relative = `${prefix}/${assertSafeRelative(name)}`;
        let value;
        try {
            value = name.endsWith('.json')
                ? readJson(root, relative)
                : readBytes(root, relative).toString('utf8');
        } catch (error) {
            if (!options.skipMissing || !isMissingError(error)) throw error;
            options.warn?.(`누락된 ${kind} 분리 파일을 건너뜁니다: ${relative}`);
            continue;
        }
        const parent = fieldParent(entity, fieldPath);
        parent[fieldPath[fieldPath.length - 1]] = value;
    }
    return entity;
}

function deepMerge(base, incoming) {
    const result = isObject(base) ? { ...base } : {};
    for (const [key, value] of Object.entries(incoming || {})) {
        if (FORBIDDEN_KEYS.has(key)) throw new Error(`Forbidden database key: ${key}`);
        result[key] = isObject(value) && isObject(result[key]) ? deepMerge(result[key], value) : value;
    }
    return result;
}

function withoutSchema(value) {
    const { schemaVersion: _schemaVersion, ...plain } = value;
    return plain;
}

function assertStableId(value, prefix, label) {
    if (typeof value !== 'string' || stableId(value, prefix) !== value) {
        throw new Error(`${label} is not a V1-compatible stable ID`);
    }
    return value;
}

function addFolded(set, value, label) {
    const folded = value.toLocaleLowerCase('en-US');
    if (set.has(folded)) throw new Error(`Case-insensitive ${label} collision: ${value}`);
    set.add(folded);
}

function validateIndex(root, index) {
    if (index?.schemaVersion !== 2 || !Array.isArray(index.characters)
        || !isObject(index.collections) || !isObject(index.paths)
        || (index.names !== undefined && !isObject(index.names))) {
        throw new Error('Invalid V2 sidebar index');
    }
    const sourcePaths = new Set();
    const outputPaths = new Set();
    const addSourcePath = (value, directory) => {
        const normalized = assertSafeRelative(value, 'V2 index path');
        const parts = normalized.split('/');
        const prefix = directory.split('/');
        if (parts.length !== prefix.length + 1 || !prefix.every((part, i) => parts[i] === part)) {
            throw new Error(`Invalid V2 index path: ${value}`);
        }
        addFolded(sourcePaths, normalized, 'source path');
        return normalized;
    };
    const addOutputPath = value => addFolded(outputPaths, value.replace(/\\/g, '/'), 'output path');

    for (const [field, sourceDirectory, , destinationDirectory, idPrefix] of GROUPS) {
        const ids = index.collections[field];
        const paths = index.paths[field];
        if (!Array.isArray(ids) || !isObject(paths)) throw new Error(`Invalid V2 collection index: ${field}`);
        const foldedIds = new Set();
        for (const id of ids) {
            assertStableId(id, idPrefix, `${field} ID`);
            addFolded(foldedIds, id, `${field} ID`);
            if (!Object.hasOwn(paths, id)) throw new Error(`Missing V2 collection path: ${field}/${id}`);
            addSourcePath(paths[id], sourceDirectory);
            addOutputPath(`${destinationDirectory}/${id}.json`);
        }
    }

    const characterIds = new Set();
    for (const character of index.characters) {
        if (!isObject(character) || !Array.isArray(character.chats)) throw new Error('Invalid V2 character index entry');
        const id = assertStableId(character.id, 'character', 'Character ID');
        addFolded(characterIds, id, 'character ID');
        const folder = addSourcePath(character.path, 'characters');
        addOutputPath(`characters/${id}/metadata.json`);
        const chatIds = new Set();
        for (const chat of character.chats) {
            if (!isObject(chat)) throw new Error('Invalid V2 chat index entry');
            const chatId = assertStableId(chat.id, 'chat', 'Chat ID');
            addFolded(chatIds, chatId, `chat ID for ${id}`);
            const chatFolder = addSourcePath(chat.path, `${folder}/chats`);
            addOutputPath(`characters/${id}/chats/${chatId}/metadata.json`);
            addOutputPath(`characters/${id}/chats/${chatId}/messages.jsonl`);
            if (!chatFolder.startsWith(`${folder}/chats/`)) throw new Error('V2 chat path is outside its character');
        }
    }
    return index;
}

function loadV2Database(root, options = {}) {
    const layout = readJson(root, 'settings/layout.json', value => (
        value?.schemaVersion === 2 && value.format === 'risubard-named-folders'
    ));
    void layout;
    const settings = readJson(root, 'settings/app.json', value => isObject(value) && value.schemaVersion === 1);
    const secrets = readJson(root, 'secrets/credentials.json', value => isObject(value) && value.schemaVersion === 1);
    const index = validateIndex(root, readJson(root, 'index/sidebar.json'));
    const database = deepMerge(withoutSchema(settings), withoutSchema(secrets));

    for (const [field, , kind] of GROUPS) {
        database[field] = [];
        for (const id of index.collections[field]) {
            try {
                const entity = decodeEntity(root, kind, index.paths[field][id], options);
                if (entity.id !== id) throw new Error(`Canonical ${kind} ID does not match the V2 index`);
                database[field].push(entity);
            } catch (error) {
                if (!options.skipMissing || !isMissingError(error)) throw error;
                options.warn?.(`누락된 ${kind} 항목을 건너뜁니다: ${index.paths[field][id]}`);
            }
        }
    }
    database.characters = [];
    for (const characterSummary of index.characters) {
        let character;
        try {
            character = decodeEntity(root, 'character', characterSummary.path, options);
        } catch (error) {
            if (!options.skipMissing || !isMissingError(error)) throw error;
            options.warn?.(`누락된 character 항목을 건너뜁니다: ${characterSummary.path}`);
            continue;
        }
        if (character.chaId !== characterSummary.id) throw new Error('Canonical character ID does not match the V2 index');
        const chats = [];
        for (const chatSummary of characterSummary.chats) {
            let chat;
            try {
                chat = decodeEntity(root, 'chat', chatSummary.path, options);
            } catch (error) {
                if (!options.skipMissing || !isMissingError(error)) throw error;
                options.warn?.(`누락된 chat 항목을 건너뜁니다: ${chatSummary.path}`);
                continue;
            }
            if (chat.id !== chatSummary.id) throw new Error('Canonical chat ID does not match the V2 index');
            const relative = `${assertSafeRelative(chatSummary.path)}/messages.jsonl`;
            let text = '';
            try {
                text = readBytes(root, relative).toString('utf8');
            } catch (error) {
                if (!options.skipMissing || !isMissingError(error)) throw error;
                options.warn?.(`누락된 채팅 메시지 파일을 빈 대화로 복원합니다: ${relative}`);
            }
            const messages = text.split(/\r?\n/).filter(Boolean).map((line, lineIndex) => {
                let message;
                try { message = JSON.parse(line); }
                catch (error) { throw new Error(`Invalid V2 chat JSONL at ${relative}:${lineIndex + 1}`, { cause: error }); }
                if (!isObject(message)) throw new Error(`Invalid V2 chat message at ${relative}:${lineIndex + 1}`);
                return message;
            });
            chats.push({ ...chat, message: messages });
        }
        database.characters.push({ ...character, chats });
    }
    return { database, index, settings, secrets };
}

function logicalAssetKey(value) {
    if (typeof value !== 'string') throw new Error('Invalid logical asset key');
    const key = value.replace(/\\/g, '/');
    if (!key.startsWith('assets/') || key.split('/').some(part => !part || part === '.' || part === '..')
        || /[:\0]/.test(key)) throw new Error(`Invalid logical asset key: ${value}`);
    return key;
}

function collectAssetReferences(database, knownKeys) {
    const result = new Set();
    const seen = new WeakSet();
    const explicitFields = new Set(['image', 'icon', 'emotionImages', 'additionalAssets', 'assets', 'ccAssets']);
    function candidate(value, explicit) {
        const normalized = value.replace(/\\/g, '/');
        if (normalized.startsWith('assets/') && !/[\r\n<>"']/.test(normalized)) {
            if (explicit || knownKeys.has(normalized) || !/[\s\[\]{}()+*?|^$]/.test(normalized)) {
                result.add(logicalAssetKey(normalized));
            }
        }
        for (const match of normalized.matchAll(/(?:^|[^A-Za-z0-9_:/.-])(assets\/[^\s"'<>\\)\],}]+)(?=$|[\s"'<>\\)\],}])/g)) {
            if (explicit || knownKeys.has(match[1])) result.add(logicalAssetKey(match[1]));
        }
    }
    function visit(value, explicit = false) {
        if (typeof value === 'string') return candidate(value, explicit);
        if (!value || typeof value !== 'object' || seen.has(value)) return;
        seen.add(value);
        if (Array.isArray(value)) {
            for (const child of value) visit(child, explicit);
            return;
        }
        for (const field of explicitFields) if (Object.hasOwn(value, field)) visit(value[field], true);
        for (const [field, child] of Object.entries(value)) {
            if (explicitFields.has(field) || field === 'prebuiltAssetExclude') continue;
            visit(child, field === 'uri');
        }
    }
    visit(database);
    return result;
}

function loadKvManifest(root) {
    if (!resolveSource(root, 'kv/manifest.json', { optional: true })) return { schemaVersion: 1, updatedAt: 0, entries: {} };
    return readJson(root, 'kv/manifest.json', value => (
        value?.schemaVersion === 1 && isObject(value.entries)
    ));
}

function validateKvObject(root, key, entry) {
    if (!isObject(entry) || !SHA256.test(entry.object) || !Number.isSafeInteger(entry.size) || entry.size < 0) {
        throw new Error(`Invalid V2 KV entry: ${key}`);
    }
    const sourcePath = resolveSource(root, `kv/objects/${entry.object}`);
    const stat = fs.statSync(sourcePath);
    if (!stat.isFile() || stat.size !== entry.size || digestFile(sourcePath) !== entry.object) {
        throw new Error(`V2 KV object checksum or size mismatch: ${key}`);
    }
    return sourcePath;
}

function loadAssets(root, database, kvManifest, options = {}) {
    const assetIndex = readJson(root, 'settings/asset-files.json', value => (
        value?.schemaVersion === 2 && isObject(value.entries)
    ));
    const assets = new Map();
    const paths = new Set();
    const keys = new Set();
    for (const [rawKey, mapping] of Object.entries(assetIndex.entries)) {
        const key = logicalAssetKey(rawKey);
        addFolded(keys, key, 'logical asset key');
        if (!isObject(mapping) || !Array.isArray(mapping.paths) || mapping.paths.length === 0
            || (mapping.checksum !== undefined && !SHA256.test(mapping.checksum))) {
            throw new Error(`Invalid owned asset mapping: ${key}`);
        }
        const versions = new Map();
        for (const rawRelative of mapping.paths) {
            const relative = assertSafeRelative(rawRelative, 'Owned asset path');
            if (!/(?:^|\/)assets\/[^/]+$/.test(relative)) throw new Error(`Invalid owned asset location: ${relative}`);
            addFolded(paths, relative, 'owned asset path');
            let sourcePath;
            try { sourcePath = resolveSource(root, relative); }
            catch (error) {
                if (!options.skipMissing || !isMissingError(error)) {
                    throw new Error(`Missing or unreadable owned asset ${key}: ${relative}`, { cause: error });
                }
                options.warn?.(`누락된 에셋 사본을 건너뜁니다: ${relative}`);
                continue;
            }
            if (!fs.statSync(sourcePath).isFile()) throw new Error(`Missing or unreadable owned asset ${key}: ${relative}`);
            const current = digestFile(sourcePath);
            if (!versions.has(current)) versions.set(current, sourcePath);
        }
        if (versions.size === 0) continue;
        let selected;
        if (versions.size === 1) {
            selected = versions.values().next().value;
        } else {
            if (mapping.checksum) versions.delete(mapping.checksum);
            if (versions.size !== 1) throw new Error(`Conflicting owned asset copies for ${key}: ${mapping.paths.join(', ')}`);
            selected = versions.values().next().value;
        }
        assets.set(key, { sourcePath: selected, updatedAt: mapping.updatedAt });
    }
    const knownKeys = new Set([
        ...assets.keys(),
        ...Object.keys(kvManifest.entries).filter(key => key.startsWith('assets/')),
    ]);
    for (const reference of collectAssetReferences(database, knownKeys)) {
        if (!assets.has(reference)) {
            if (!options.skipMissing) throw new Error(`Database-referenced asset is missing from the owned index: ${reference}`);
            options.warn?.(`참조된 에셋을 복원하지 못했습니다: ${reference}`);
        }
    }
    return assets;
}

function fsyncFile(filePath) {
    const fd = fs.openSync(filePath, 'r+');
    try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}

function fsyncDirectory(directory) {
    let fd;
    try {
        fd = fs.openSync(directory, 'r');
        fs.fsyncSync(fd);
    } catch (error) {
        if (process.platform !== 'win32') throw error;
    } finally {
        if (fd !== undefined) fs.closeSync(fd);
    }
}

function copyObject(stage, sourcePath, expectedHash) {
    const objects = path.join(stage, 'kv', 'objects');
    fs.mkdirSync(objects, { recursive: true });
    const target = path.join(objects, expectedHash);
    if (fs.existsSync(target)) {
        if (digestFile(target) !== expectedHash) throw new Error(`Destination object collision: ${expectedHash}`);
        return;
    }
    fs.copyFileSync(sourcePath, target, fs.constants.COPYFILE_EXCL);
    fsyncFile(target);
    if (digestFile(target) !== expectedHash) throw new Error(`Copied object checksum mismatch: ${expectedHash}`);
}

function writeKv(stage, sourceRoot, kvManifest, assets, options = {}) {
    const entries = Object.create(null);
    for (const [key, entry] of Object.entries(kvManifest.entries)) {
        // The V1 runtime rebuilds this derived cache from the converted files.
        if (key.startsWith('assets/') || key === 'database/database.bin') continue;
        if (typeof key !== 'string' || key.includes('\0')) throw new Error('Invalid V2 KV key');
        let sourcePath;
        try {
            sourcePath = validateKvObject(sourceRoot, key, entry);
        } catch (error) {
            if (!options.skipMissing || !isMissingError(error)) throw error;
            options.warn?.(`누락된 KV 데이터를 건너뜁니다: ${key}`);
            continue;
        }
        copyObject(stage, sourcePath, entry.object);
        entries[key] = { ...entry };
    }
    for (const [key, asset] of assets) {
        const hash = digestFile(asset.sourcePath);
        const size = fs.statSync(asset.sourcePath).size;
        copyObject(stage, asset.sourcePath, hash);
        entries[key] = { object: hash, size, updatedAt: asset.updatedAt ?? Date.now() };
    }
    atomicWriteJson(stage, 'kv/manifest.json', { schemaVersion: 1, updatedAt: Date.now(), entries }, {
        validate: value => value?.schemaVersion === 1 && isObject(value.entries),
    });
    return entries;
}

function copyTree(sourceRoot, destinationRoot, name) {
    const source = resolveSource(sourceRoot, name, { optional: true });
    if (!source) return;
    if (!fs.statSync(source).isDirectory()) throw new Error(`Auxiliary V2 path is not a directory: ${name}`);
    const destination = path.join(destinationRoot, name);
    function visit(from, to) {
        fs.mkdirSync(to, { recursive: false });
        for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
            const sourcePath = path.join(from, entry.name);
            const destinationPath = path.join(to, entry.name);
            const stat = assertNoLink(sourcePath, 'V2 auxiliary tree');
            if (stat.isDirectory()) visit(sourcePath, destinationPath);
            else if (stat.isFile()) {
                fs.copyFileSync(sourcePath, destinationPath, fs.constants.COPYFILE_EXCL);
                fsyncFile(destinationPath);
            } else throw new Error(`V2 auxiliary tree contains an unsupported reparse point: ${sourcePath}`);
        }
        fsyncDirectory(to);
    }
    visit(source, destination);
}

function copyRootFile(sourceRoot, destinationRoot, name) {
    const source = resolveSource(sourceRoot, name, { optional: true });
    if (!source) return;
    const stat = assertNoLink(source, 'V2 root file');
    if (!stat.isFile()) throw new Error(`Optional V2 root path is not a file: ${name}`);
    const destination = path.join(destinationRoot, name);
    fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
    fsyncFile(destination);
    if (digestFile(source) !== digestFile(destination)) throw new Error(`Root file verification failed: ${name}`);
}

function listPassThroughEntries(sourceRoot) {
    return fs.readdirSync(sourceRoot, { withFileTypes: true })
        .filter(entry => !V2_OWNED_TOP_LEVEL.has(entry.name)
            && !/^risuai\.db(?:-wal|-shm)?$/i.test(entry.name)
            && !/^(?:[a-f0-9]{2})+$/i.test(entry.name))
        .map(entry => {
            const source = path.join(sourceRoot, entry.name);
            const stat = assertNoLink(source, 'V2 pass-through entry');
            if (!stat.isDirectory() && !stat.isFile()) {
                throw new Error(`V2 pass-through entry has an unsupported type: ${source}`);
            }
            return { name: entry.name, directory: stat.isDirectory() };
        });
}

function copyPassThroughEntries(sourceRoot, destinationRoot, entries) {
    for (const entry of entries) {
        if (entry.directory) copyTree(sourceRoot, destinationRoot, entry.name);
        else copyRootFile(sourceRoot, destinationRoot, entry.name);
    }
}

function loadDrafts(sourceRoot, index, database) {
    const drafts = [];
    const convertedChats = new Set(database.characters.flatMap(character => (
        character.chats.map(chat => `${character.chaId}\0${chat.id}`)
    )));
    for (const character of index.characters) for (const chat of character.chats) {
        if (!convertedChats.has(`${character.id}\0${chat.id}`)) continue;
        const relative = `${assertSafeRelative(chat.path)}/draft.json`;
        if (resolveSource(sourceRoot, relative, { optional: true })) {
            const value = readJson(sourceRoot, relative, isObject);
            drafts.push({ characterId: character.id, chatId: chat.id, value });
        }
    }
    return drafts;
}

function verifyStage(stage, expected, options = {}) {
    const repository = createUserDataRepository({ dataRoot: stage });
    assert.deepStrictEqual(repository.exportLegacyDatabase(), expected.database);
    assert.deepStrictEqual(readJson(stage, 'settings/app.json'), expected.settings);
    assert.deepStrictEqual(readJson(stage, 'secrets/credentials.json'), expected.secrets);
    const sidebar = readJson(stage, 'index/sidebar.json');
    if (sidebar.schemaVersion !== 1) throw new Error('Converted sidebar is not V1');
    for (const draft of expected.drafts) {
        assert.deepStrictEqual(repository.loadAssistantDraft(draft.characterId, draft.chatId), draft.value);
    }
    const manifest = readJson(stage, 'kv/manifest.json', value => value?.schemaVersion === 1 && isObject(value.entries));
    for (const [key, entry] of Object.entries(manifest.entries)) validateKvObject(stage, key, entry);
    for (const key of expected.assetKeys) {
        if (!Object.hasOwn(manifest.entries, key)) throw new Error(`Converted asset is missing: ${key}`);
    }
    for (const marker of ['settings/layout.json', 'settings/asset-files.json', 'settings/entity-order.json']) {
        if (fs.existsSync(path.join(stage, marker))) throw new Error(`V2 marker leaked into destination: ${marker}`);
    }
    for (const entry of expected.passThroughEntries) {
        const source = path.join(expected.sourceRoot, entry.name);
        const destination = path.join(stage, entry.name);
        if (!fs.existsSync(destination)) throw new Error(`Pass-through entry is missing: ${entry.name}`);
        if (entry.directory) {
            if (!fs.statSync(destination).isDirectory()
                || treeDigest(source, { includeMetadata: false }) !== treeDigest(destination, { includeMetadata: false })) {
                throw new Error(`Pass-through tree verification failed: ${entry.name}`);
            }
        } else {
            assertNoLink(destination, 'Converted root file');
            if (!fs.statSync(destination).isFile() || digestFile(source) !== digestFile(destination)) {
                throw new Error(`Pass-through file verification failed: ${entry.name}`);
            }
        }
    }
    treeDigest(stage, { onFile: options.onFile });
}

function safeCleanupStage(stage, destination) {
    const parent = path.dirname(destination);
    const prefix = `${path.basename(destination)}.incomplete-`;
    if (path.dirname(stage) !== parent || !path.basename(stage).startsWith(prefix)) {
        throw new Error('Refusing to remove an unexpected staging directory');
    }
    if (fs.existsSync(stage)) fs.rmSync(stage, { recursive: true, force: true });
}

function validateRoots(sourceValue, destinationValue) {
    const source = path.resolve(sourceValue);
    const destination = path.resolve(destinationValue);
    if (!fs.existsSync(source)) throw new Error('V2 source does not exist');
    assertNoLink(source, 'V2 source');
    if (!fs.statSync(source).isDirectory()) throw new Error('V2 source must be a directory');
    if (normalizedAbsolute(source) === normalizedAbsolute(destination)) {
        throw new Error('Source and destination must be separate');
    }
    if (isInside(source, destination) || isInside(destination, source)) {
        throw new Error('Source and destination must not be nested');
    }
    if (fs.existsSync(destination)) throw new Error('Destination must not exist');
    if (path.parse(destination).root === destination) throw new Error('Destination cannot be a filesystem root');
    const parent = path.dirname(destination);
    if (!fs.existsSync(parent) || !fs.statSync(parent).isDirectory()) throw new Error('Destination parent must exist');
    assertNoLink(parent, 'Destination parent');
    return { source, destination };
}

function convertV2ToV0925(sourceValue, destinationValue, options = {}) {
    const report = createProgressReporter(options.onProgress);
    const warnings = [];
    const warn = warning => {
        if (warnings.includes(warning)) return;
        warnings.push(warning);
        options.onWarning?.(warning);
    };
    const recovery = { skipMissing: options.skipMissing === true, warn };

    report(0, '변환 경로를 확인하는 중...');
    const { source, destination } = validateRoots(sourceValue, destinationValue);
    report(1, 'V2 파일 목록을 확인하는 중...');
    const sourceFileCount = Math.max(1, countTreeFiles(source));
    let sourceFilesRead = 0;
    const sourceDigest = treeDigest(source, {
        onFile: relative => {
            sourceFilesRead += 1;
            report(2 + (sourceFilesRead / sourceFileCount) * 18, `V2 원본 검사 중: ${relative}`);
        },
    });
    const stage = `${destination}.incomplete-${crypto.randomUUID()}`;
    let published = false;
    try {
        report(21, '설정과 사이드바 인덱스를 읽는 중...');
        const loaded = loadV2Database(source, recovery);
        report(42, '캐릭터·채팅·프롬프트를 V1 형식으로 복원하는 중...');
        const kvManifest = loadKvManifest(source);
        const assets = loadAssets(source, loaded.database, kvManifest, recovery);
        report(52, '이미지와 첨부 파일을 확인하는 중...');
        const drafts = loadDrafts(source, loaded.index, loaded.database);
        const passThroughEntries = listPassThroughEntries(source);

        report(58, 'V1 저장 폴더를 만드는 중...');
        fs.mkdirSync(stage, { recursive: false });
        const repository = createUserDataRepository({ dataRoot: stage });
        repository.importLegacyDatabase(loaded.database, { mode: 'replace' });
        atomicWriteJson(stage, 'settings/app.json', loaded.settings);
        atomicWriteJson(stage, 'secrets/credentials.json', loaded.secrets);
        for (const relative of ['settings/app.json.bak', 'secrets/credentials.json.bak']) {
            const backup = path.join(stage, relative);
            if (fs.existsSync(backup)) fs.unlinkSync(backup);
        }
        for (const draft of drafts) repository.saveAssistantDraft(draft.characterId, draft.chatId, draft.value);
        report(68, '에셋과 플러그인 데이터를 복사하는 중...');
        const kvEntries = writeKv(stage, source, kvManifest, assets, recovery);
        report(74, '위키·로그·보조 폴더를 복사하는 중...');
        copyPassThroughEntries(source, stage, passThroughEntries);
        atomicWriteJson(stage, 'conversion/v2-to-v0925.json', {
            schemaVersion: 1,
            sourceDigest,
            convertedAt: new Date().toISOString(),
            characters: loaded.database.characters.length,
            assets: assets.size,
            kvEntries: Object.keys(kvEntries).length,
            warnings,
        });

        report(79, '변환된 V1 데이터를 다시 읽어 검증하는 중...');
        const stageFileCount = Math.max(1, countTreeFiles(stage));
        let stageFilesRead = 0;
        verifyStage(stage, {
            sourceRoot: source,
            database: loaded.database,
            settings: loaded.settings,
            secrets: loaded.secrets,
            drafts,
            assetKeys: [...assets.keys()],
            passThroughEntries,
        }, {
            onFile: relative => {
                stageFilesRead += 1;
                report(80 + (stageFilesRead / stageFileCount) * 9, `V1 결과 검사 중: ${relative}`);
            },
        });
        options.beforePublish?.({ source, stage, destination });
        report(90, '변환 중 V2 원본이 바뀌지 않았는지 최종 확인하는 중...');
        sourceFilesRead = 0;
        const finalSourceDigest = treeDigest(source, {
            onFile: relative => {
                sourceFilesRead += 1;
                report(90 + (sourceFilesRead / sourceFileCount) * 9, `V2 원본 최종 검사 중: ${relative}`);
            },
        });
        if (finalSourceDigest !== sourceDigest) throw new Error('V2 source changed during conversion');
        if (fs.existsSync(destination)) throw new Error('Destination must not exist');
        report(99, '검증된 V1 폴더를 게시하는 중...');
        fs.renameSync(stage, destination);
        try {
            (options.syncParentDirectory ?? fsyncDirectory)(path.dirname(destination));
        } catch (error) {
            fs.renameSync(destination, stage);
            try { fsyncDirectory(path.dirname(destination)); } catch {}
            throw error;
        }
        published = true;
        report(100, 'V2에서 V1으로 변환 완료');
        return {
            sourceDigest,
            destination,
            characters: loaded.database.characters.length,
            assets: assets.size,
            kvEntries: Object.keys(kvEntries).length,
            warnings,
        };
    } finally {
        if (!published) safeCleanupStage(stage, destination);
    }
}

if (require.main === module) {
    const args = process.argv.slice(2);
    const skipMissing = args.includes('--skip-missing');
    const unknownOptions = args.filter(value => value.startsWith('--') && value !== '--skip-missing');
    const [source, explicitDestination, ...extra] = args.filter(value => value !== '--skip-missing');
    if (!source || extra.length || unknownOptions.length) {
        console.error('Usage: node scripts/convert-v2-to-v0925.cjs [--skip-missing] <v2-source-root> [new-v1-destination]');
        process.exitCode = 1;
    } else {
        try {
            const destination = explicitDestination || `${path.resolve(source)}-v1`;
            const result = convertV2ToV0925(source, destination, {
                skipMissing,
                onProgress: ({ percent, message }) => console.error(`[${String(percent).padStart(3)}%] ${message}`),
                onWarning: warning => console.error(`[경고] ${warning}`),
            });
            console.log(JSON.stringify(result, null, 2));
        } catch (error) {
            console.error(error?.stack || String(error));
            process.exitCode = isMissingError(error) ? 2 : 1;
        }
    }
}

module.exports = { convertV2ToV0925 };
