'use strict';

// Review of canonical files edited outside RisuBard while the app is open.
// Character metadata, global lorebooks and modules whose bytes no longer match their
// .sha256 sidecar are compared with the in-memory app state, so the user can
// accept the external version or keep the app version (Godot-style reload).

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { refreshChecksum } = require('./file-store.cjs');
const { splitSecrets, COLLECTIONS } = require('./user-data-repository.cjs');

const TEXT_LIMIT = 200_000;
const IGNORED_FIELDS = new Set(['chats', 'chatPage']);
const COLLECTION_KINDS = { botPresets: 'preset', modules: 'module', personas: 'persona', loreBook: 'lorebook' };
const SETTINGS_EXCLUDED = new Set(['characters', ...COLLECTIONS.map(([legacyName]) => legacyName)]);
const SECRET_MASK = '••••••';
// Collections whose edited items replace the app copy in place, without a page reload.
const IN_PLACE = {
    lorebooks: { legacyName: 'loreBook', directory: 'lorebooks', kind: 'lorebook', loreField: 'data' },
    modules: { legacyName: 'modules', directory: 'modules', kind: 'module', loreField: 'lorebook' },
};
const IN_PLACE_KINDS = new Set(['character', ...Object.values(IN_PLACE).map(collection => collection.kind)]);
const toPosix = value => String(value).split(path.sep).join('/');

const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const isPlainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

// Same format as the repository's startup validation message.
function describeJsonError(text, error) {
    const reason = String(error?.message || 'invalid JSON').replace(/\s*in JSON at position \d+.*$/, '');
    const match = /at position (\d+)/.exec(String(error?.message || ''));
    const position = match ? Math.min(Number(match[1]), text.length) : text.length;
    const before = text.slice(0, position);
    const line = before.split('\n').length;
    const column = position - before.lastIndexOf('\n');
    return `line ${line}, column ${column}: ${reason}`;
}

// Read one canonical file without blessing its checksum. By default only files
// whose bytes no longer match their .sha256 sidecar are returned.
function readEdited(root, relativePath, { all = false } = {}) {
    const target = path.join(root, relativePath);
    if (!fs.existsSync(target)) return null;
    const checksumPath = `${target}.sha256`;
    const bytes = fs.readFileSync(target);
    if (!all) {
        if (!fs.existsSync(checksumPath)) return null;
        const expected = fs.readFileSync(checksumPath, 'utf8').trim();
        if (!expected || sha256(bytes) === expected) return null;
    }
    const text = bytes.toString('utf8');
    try {
        const value = JSON.parse(text);
        if (!isPlainObject(value)) return { path: relativePath, error: 'JSON root must be an object' };
        return { path: relativePath, value };
    } catch (error) {
        return { path: relativePath, error: describeJsonError(text, error) };
    }
}

const textOf = value => {
    const text = typeof value === 'string' ? value : JSON.stringify(value ?? null, null, 2);
    return text.length > TEXT_LIMIT ? `${text.slice(0, TEXT_LIMIT)}\n…` : text;
};

function diffLore(before = [], after = []) {
    const key = (entry, index) => entry?.id ?? `${entry?.comment ?? ''}#${index}`;
    const beforeMap = new Map(before.map((entry, index) => [key(entry, index), entry]));
    const afterMap = new Map(after.map((entry, index) => [key(entry, index), entry]));
    const label = entry => entry?.comment || entry?.key || '(이름 없음)';
    const added = [];
    const removed = [];
    const changed = [];
    for (const [id, entry] of afterMap) {
        const old = beforeMap.get(id);
        if (!old) added.push({ id, name: label(entry), after: textOf(entry.content ?? '') });
        else if (!same(old, entry)) {
            const fields = [...new Set([...Object.keys(old), ...Object.keys(entry)])].filter(field => !same(old[field], entry[field]));
            changed.push({ id, name: label(entry), fields, before: textOf(old.content ?? ''), after: textOf(entry.content ?? '') });
        }
    }
    for (const [id, entry] of beforeMap) if (!afterMap.has(id)) removed.push({ id, name: label(entry), before: textOf(entry.content ?? '') });
    return { added, removed, changed };
}

function diffFields(app = {}, external = {}) {
    return [...new Set([...Object.keys(app), ...Object.keys(external)])]
        .filter(field => !same(app[field], external[field]))
        .map(field => ({ field, before: textOf(app[field]), after: textOf(external[field]) }));
}

function settingsOf(appDb) {
    return splitSecrets(Object.fromEntries(Object.entries(appDb || {}).filter(([key]) => !SETTINGS_EXCLUDED.has(key))));
}

function diffCharacter(app, external) {
    const fields = [];
    let lore = null;
    for (const field of new Set([...Object.keys(app), ...Object.keys(external)])) {
        if (IGNORED_FIELDS.has(field) || same(app[field], external[field])) continue;
        if (field === 'globalLore') {
            lore = diffLore(app.globalLore, external.globalLore);
            continue;
        }
        fields.push({ field, before: textOf(app[field]), after: textOf(external[field]) });
    }
    return { fields, lore };
}

function createExternalChangeReview({ repository, dataRoot }) {
    let cache = null;

    // Externally edited character and global lorebook files, with their parsed values.
    // `paths` lists files known to have changed even if their checksum was rewritten.
    function collect({ all = false, paths = null } = {}) {
        const index = repository.loadSidebarIndex();
        const read = relativePath => readEdited(dataRoot, relativePath, { all: all || Boolean(paths?.has(relativePath)) });
        const characters = [];
        for (const summary of index.characters || []) {
            const directory = repository.characterDirectoryPath(summary.id);
            if (!directory) continue;
            const edited = read(toPosix(path.join(directory, 'metadata.json')));
            if (edited) characters.push({ id: summary.id, ...edited });
        }
        const items = collection => (index.collections?.[collection.legacyName] || []).flatMap(id => {
            const edited = read(toPosix(repository.collectionItemPath(collection.directory, id)));
            return edited ? [{ id, ...edited }] : [];
        });
        return { characters, lorebooks: items(IN_PLACE.lorebooks), modules: items(IN_PLACE.modules) };
    }

    // Summarize differences between the app database and the edited files.
    // `changed` lists every file changed since the app last accepted the files;
    // without it only characters and global lorebooks can be compared.
    function inspect(revision, appDb, changed = null) {
        if (cache && cache.revision === revision) return cache.review;
        const paths = changed ? new Set(changed.map(file => file.path)) : null;
        let review = compare(revision, appDb, collect({ paths }));
        // A tool may rewrite the checksum together with the file. Compare every
        // character and lorebook with the app state when no sidecar mismatches.
        if (!changed && !review.changes.length && !review.errors.length) review = compare(revision, appDb, collect({ all: true }));
        if (changed) review = withOtherFiles(review, appDb, changed);
        // Unknown files changed: accepting must load them all rather than overwrite them.
        else if (!review.changes.length && !review.errors.length) review = { ...review, reload: true };
        cache = { revision, review };
        return review;
    }

    // Add every other changed file: settings, credentials, presets, modules,
    // personas, chats and anything else in the canonical data folder.
    function withOtherFiles(review, appDb, changed) {
        const index = repository.loadSidebarIndex();
        const owners = (index.characters || []).map(summary => {
            const directory = repository.characterDirectoryPath(summary.id);
            return directory ? { id: summary.id, directory: toPosix(directory) } : null;
        }).filter(Boolean);
        const reviewed = new Set([...review.files.characters, ...review.files.lorebooks, ...review.files.modules].map(file => file.path));
        const compared = new Set([
            ...owners.map(owner => `${owner.directory}/metadata.json`),
            ...Object.values(IN_PLACE).flatMap(collection => (index.collections?.[collection.legacyName] || [])
                .map(id => toPosix(repository.collectionItemPath(collection.directory, id)))),
        ]);
        const changes = [...review.changes];
        const errors = [...review.errors];
        const seen = new Set();
        for (const file of changed) {
            // Characters and lorebooks were compared above; identical ones need nothing.
            // Without app state nothing was compared, so every file is listed.
            if (reviewed.has(file.path) || (appDb && file.status === 'changed' && compared.has(file.path))) continue;
            const described = describeFile(file, appDb, index, owners);
            if (described.error) errors.push(described.error);
            else if (!seen.has(described.id)) {
                seen.add(described.id);
                changes.push(described);
            }
        }
        const reload = changes.some(change => change.status || !IN_PLACE_KINDS.has(change.kind));
        return { ...review, changes, errors, paths: changed.map(file => file.path), reload };
    }

    function describeFile(file, appDb, index, owners) {
        const relativePath = file.path;
        const status = file.status;
        const edited = status !== 'removed' && relativePath.endsWith('.json') ? readEdited(dataRoot, relativePath, { all: true }) : null;
        if (edited?.error) return { error: { path: relativePath, error: edited.error } };
        const external = edited?.value;
        const base = { id: relativePath, path: relativePath, name: '', status, fields: [], lore: null };
        if (relativePath === 'settings/app.json') {
            const { schemaVersion: _schema, ...settings } = external || {};
            return { ...base, kind: 'settings', fields: external && appDb ? diffFields(settingsOf(appDb).settings, settings) : [] };
        }
        if (relativePath === 'secrets/credentials.json') {
            // Show which credentials changed, never their values.
            const { schemaVersion: _schema, ...secrets } = external || {};
            const app = settingsOf(appDb).secrets;
            const fields = external && appDb ? [...new Set([...Object.keys(app), ...Object.keys(secrets)])]
                .filter(field => !same(app[field], secrets[field]))
                .map(field => ({ field, before: field in app ? SECRET_MASK : '', after: field in secrets ? SECRET_MASK : '' })) : [];
            return { ...base, kind: 'secrets', fields };
        }
        const collection = COLLECTIONS.find(([, directory]) => relativePath.startsWith(`${directory}/`));
        if (collection) {
            const [legacyName, directory] = collection;
            const appIndex = (index.collections?.[legacyName] || [])
                .findIndex(id => toPosix(repository.collectionItemPath(directory, id)) === relativePath);
            const app = appIndex >= 0 ? appDb?.[legacyName]?.[appIndex] : undefined;
            return {
                ...base, kind: COLLECTION_KINDS[legacyName],
                name: external?.name || app?.name || path.posix.basename(relativePath, '.json'),
                fields: app && external ? diffFields(app, external) : [],
            };
        }
        const owner = owners.find(candidate => relativePath.startsWith(`${candidate.directory}/`));
        if (owner) {
            const character = appDb?.characters?.find(item => item.chaId === owner.id);
            const characterName = character?.name || owner.id;
            if (relativePath === `${owner.directory}/metadata.json` || relativePath === `${owner.directory}/package.json`) {
                return { ...base, kind: 'character', name: characterName };
            }
            // A chat is its metadata plus messages; list the chat once.
            const chatDirectory = path.posix.dirname(relativePath);
            const metadata = readEdited(dataRoot, `${chatDirectory}/metadata.json`, { all: true });
            const chatName = metadata?.value?.name || path.posix.basename(chatDirectory);
            return { ...base, id: chatDirectory, kind: 'chat', name: `${characterName} / ${chatName}` };
        }
        return { ...base, kind: 'file' };
    }

    function compare(revision, appDb, files) {
        const changes = [];
        const errors = [];
        for (const file of files.characters) {
            if (file.error) { errors.push({ path: file.path, error: file.error }); continue; }
            const app = appDb?.characters?.find(character => character.chaId === file.value.chaId);
            if (!app) continue;
            const diff = diffCharacter(app, file.value);
            if (!diff.fields.length && !diff.lore) continue;
            changes.push({ kind: 'character', id: file.value.chaId, name: file.value.name || app.name || '', path: file.path, ...diff });
        }
        const index = repository.loadSidebarIndex();
        for (const [name, collection] of Object.entries(IN_PLACE)) {
            const { legacyName, kind, loreField } = collection;
            for (const file of files[name] || []) {
                if (file.error) { errors.push({ path: file.path, error: file.error }); continue; }
                const appIndex = (index.collections?.[legacyName] || []).indexOf(file.id);
                const app = appDb?.[legacyName]?.[appIndex];
                if (!app || same(app, file.value)) continue;
                const fields = [...new Set([...Object.keys(app), ...Object.keys(file.value)])]
                    .filter(field => field !== loreField && !same(app[field], file.value[field]))
                    .map(field => ({ field, before: textOf(app[field]), after: textOf(file.value[field]) }));
                const lore = same(app[loreField], file.value[loreField]) ? null : diffLore(app[loreField], file.value[loreField]);
                changes.push({ kind, id: file.id, index: appIndex, name: file.value.name || app.name || '', path: file.path, fields, lore });
            }
        }
        // Only files that differ from the app (or cannot be parsed) take part in a decision.
        const relevant = new Set([...changes.map(change => change.path), ...errors.map(error => error.path)]);
        return {
            revision, changes, errors,
            files: {
                characters: files.characters.filter(file => relevant.has(file.path)),
                lorebooks: (files.lorebooks || []).filter(file => relevant.has(file.path)),
                modules: (files.modules || []).filter(file => relevant.has(file.path)),
            },
        };
    }

    // Replace the reviewed entities in a stripped database with their external versions.
    function applyExternal(appDb, review) {
        const next = structuredClone(appDb);
        for (const file of review.files.characters) {
            if (file.error) continue;
            const index = next.characters.findIndex(character => character.chaId === file.value.chaId);
            if (index < 0) continue;
            const { chats, chatPage } = next.characters[index];
            const incoming = Object.fromEntries(Object.entries(file.value).filter(([field]) => !IGNORED_FIELDS.has(field)));
            next.characters[index] = { ...incoming, chats, chatPage };
        }
        const collections = repository.loadSidebarIndex().collections || {};
        for (const [name, { legacyName }] of Object.entries(IN_PLACE)) {
            const order = collections[legacyName] || [];
            for (const file of review.files[name] || []) {
                if (file.error) continue;
                const index = order.indexOf(file.id);
                if (index >= 0 && next[legacyName]?.[index]) next[legacyName][index] = file.value;
            }
        }
        return next;
    }

    // Keep a copy of discarded external files before the app version replaces them.
    const reviewedPaths = review => [...new Set([
        ...review.files.characters.map(file => file.path),
        ...review.files.lorebooks.map(file => file.path),
        ...(review.files.modules || []).map(file => file.path),
        ...(review.paths || []),
    ])];

    function backup(review) {
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const target = path.join(dataRoot, 'trash', `external-changes-${stamp}`);
        for (const relativePath of reviewedPaths(review)) {
            const file = { path: relativePath };
            const source = path.join(dataRoot, file.path);
            if (!fs.existsSync(source)) continue;
            const destination = path.join(target, file.path);
            fs.mkdirSync(path.dirname(destination), { recursive: true });
            fs.copyFileSync(source, destination);
        }
        return path.relative(dataRoot, target).split(path.sep).join('/');
    }

    // The reviewed bytes become the transaction baseline, so the decided
    // version can replace them (the commit refuses to overwrite unseen edits).
    function acknowledge(review) {
        for (const relativePath of reviewedPaths(review)) {
            const target = path.join(dataRoot, relativePath);
            // Files without a sidecar (chat messages) have no checksum to refresh.
            if (fs.existsSync(target) && fs.existsSync(`${target}.sha256`)) refreshChecksum(dataRoot, relativePath);
        }
    }

    // Response payload: diff details without the parsed file bodies.
    const publicReview = review => review && {
        revision: review.revision,
        changes: review.changes,
        errors: review.errors,
        hasDetails: review.changes.length > 0 || review.errors.length > 0,
        reloadOnAccept: Boolean(review.reload),
    };

    return { inspect, applyExternal, backup, acknowledge, publicReview, clear: () => { cache = null; } };
}

module.exports = { createExternalChangeReview, diffCharacter, diffLore, readEdited };
