'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { readVerifiedJson, resolveInside } = require('./file-store.cjs');
const { sanitizeSegment, collisionKey } = require('./friendly-paths.cjs');
const DIRECTORY_INDEX = 'index/character-directories.json';
const generations = new Map();
const signatures = new Map();
const restoreEpochs = new Map();
const validId = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value);

function validateDirectoryMapping(value) {
    if (value?.schemaVersion !== 1 || !Array.isArray(value.characters)) throw new Error('Invalid character directory mapping');
    function validateEntries(entries) {
        const ids = new Set();
        const names = new Map();
        for (const entry of entries) {
            if (!validId(entry?.id) || ids.has(collisionKey(entry.id))) throw new Error('Invalid or duplicate mapped ID');
            if (Object.hasOwn(entry, 'packageVersion') && entry.packageVersion !== 1) throw new Error('Invalid character package version');
            ids.add(collisionKey(entry.id));
            if (typeof entry.directory !== 'string' || entry.directory.startsWith('.') || sanitizeSegment(entry.directory) !== entry.directory) throw new Error('Unsafe mapped directory');
            if (entry.id !== entry.directory && collisionKey(entry.id) === collisionKey(entry.directory)) throw new Error('Mapped directory collision');
            // Reserve both the retained legacy ID and the destination, including after deletion.
            for (const name of [entry.id, entry.directory]) {
                const key = collisionKey(name);
                if (names.has(key) && names.get(key) !== entry.id) throw new Error('Mapped directory collision');
                names.set(key, entry.id);
            }
        }
    }
    validateEntries(value.characters);
    for (const character of value.characters) {
        if (!Array.isArray(character.chats)) throw new Error('Invalid mapped chats');
        validateEntries(character.chats);
    }
    return value;
}

function createCharacterDirectoryResolver(dataRoot) {
    const root = path.resolve(dataRoot);
    let generation = -1;
    let mapping;
    let restoreEpoch = restoreEpochs.get(root) || 0;
    function acceptRestoreEpoch() {
        const current = restoreEpochs.get(root) || 0;
        if (restoreEpoch === current) return;
        restoreEpoch = current;
        mapping = undefined;
        generation = -1;
    }
    function safePath(relative) {
        const target = resolveInside(root, relative);
        let current = root;
        for (const segment of path.relative(root, target).split(path.sep)) {
            current = path.join(current, segment);
            let stat;
            try { stat = fs.lstatSync(current); } catch { break; } // nothing below a missing segment exists
            // existsSync follows the link, so a dangling link stays allowed as before.
            if (stat.isSymbolicLink() && fs.existsSync(current)) throw new Error('Mapped directory uses a symbolic link');
        }
        return target;
    }
    function refresh() {
        acceptRestoreEpoch();
        try {
            const target = safePath(DIRECTORY_INDEX);
            let next;
            if (fs.existsSync(target)) {
                if (!fs.existsSync(`${target}.sha256`) || !/^[a-f0-9]{64}$/.test(fs.readFileSync(`${target}.sha256`, 'utf8').trim())) throw new Error('Directory mapping checksum is missing or invalid');
                next = validateDirectoryMapping(readVerifiedJson(root, DIRECTORY_INDEX));
            } else {
                if (mapping?.characters.length || signatures.get(root)?.hasMapping) throw new Error('Published directory mapping is missing');
                next = { schemaVersion: 1, characters: [] };
            }
            for (const old of mapping?.characters || []) {
                const current = next.characters.find(entry => entry.id === old.id);
                if (!current || JSON.stringify(current) !== JSON.stringify(old)) throw new Error('Published directory mapping cannot be removed or reassigned');
            }
            const signature = JSON.stringify(next);
            if (signatures.get(root)?.value !== signature) {
                generations.set(root, (generations.get(root) || 0) + 1);
                signatures.set(root, { value: signature, hasMapping: next.characters.length > 0 });
            }
            mapping = next;
            generation = generations.get(root) || 0;
            return mapping;
        } catch (error) {
            // Peer replica readers must stop using a previously cached mapping too.
            generations.set(root, (generations.get(root) || 0) + 1);
            throw error;
        }
    }
    function snapshot() {
        acceptRestoreEpoch();
        if (generation !== (generations.get(root) || 0)) refresh();
        return mapping;
    }
    function resolveEntry(entries, id) {
        if (!validId(id)) throw new Error('Invalid directory entity ID');
        const mapped = entries.find(entry => entry.id === id);
        if (mapped) return mapped.directory;
        if (entries.some(entry => [entry.id, entry.directory].some(name => collisionKey(name) === collisionKey(id)))) throw new Error('Directory ID collides with a reserved mapping');
        return id;
    }
    function characterDirectory(id) {
        return path.join('characters', resolveEntry(snapshot().characters, id));
    }
    function chatDirectory(characterId, chatId) {
        const character = snapshot().characters.find(entry => entry.id === characterId);
        return path.join(characterDirectory(characterId), 'chats', resolveEntry(character?.chats || [], chatId));
    }
    function discover(relative, entries) {
        const target = safePath(relative);
        let items;
        try {
            items = fs.readdirSync(target, { withFileTypes: true });
        } catch (error) {
            if (error?.code === 'ENOENT') return [];
            throw error;
        }
        const reverse = new Map(entries.map(entry => [collisionKey(entry.directory), entry]));
        const retired = new Set(entries.filter(entry => entry.id !== entry.directory).map(entry => collisionKey(entry.id)));
        const found = new Set();
        const result = [];
        for (const item of items) {
            if (item.isSymbolicLink()) throw new Error('Canonical directory uses a symbolic link');
            if (!item.isDirectory() || item.name.startsWith('.')) continue;
            const key = collisionKey(item.name);
            if (retired.has(key)) continue;
            const entry = reverse.get(key);
            if (entry && item.name !== entry.directory) throw new Error('Mapped directory casing changed');
            const id = entry?.id || item.name;
            if (!validId(id) || found.has(collisionKey(id))) throw new Error('Invalid or duplicate canonical directory');
            found.add(collisionKey(id));
            result.push(id);
        }
        return result;
    }
    refresh();
    return {
        snapshot, refresh, safePath, characterDirectory, chatDirectory,
        characterIds: () => discover('characters', snapshot().characters),
        chatIds: id => discover(path.join(characterDirectory(id), 'chats'), snapshot().characters.find(entry => entry.id === id)?.chats || []),
        invalidate: () => { generations.set(root, (generations.get(root) || 0) + 1); },
    };
}

function resetCharacterDirectoryMappings(dataRoot) {
    const root = path.resolve(dataRoot);
    restoreEpochs.set(root, (restoreEpochs.get(root) || 0) + 1);
    signatures.delete(root);
    generations.set(root, (generations.get(root) || 0) + 1);
}

module.exports = { DIRECTORY_INDEX, validateDirectoryMapping, createCharacterDirectoryResolver, resetCharacterDirectoryMappings };
