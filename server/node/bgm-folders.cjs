'use strict';

// Music folders the BGM player may read from. Only audio files under a folder the
// user registered are ever served; everything else on the disk stays unreachable.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { atomicWriteJson } = require('./file-store.cjs');

const FOLDERS_FILE = 'settings/bgm-folders.json';
const MAX_FOLDERS = 32;
const MAX_SCAN_FILES = 5000;
const MAX_SCAN_DEPTH = 8;
const AUDIO_TYPES = new Map([
    ['.mp3', 'audio/mpeg'],
    ['.ogg', 'audio/ogg'],
    ['.oga', 'audio/ogg'],
    ['.opus', 'audio/ogg'],
    ['.wav', 'audio/wav'],
    ['.flac', 'audio/flac'],
    ['.m4a', 'audio/mp4'],
    ['.aac', 'audio/aac'],
    ['.weba', 'audio/webm'],
    ['.webm', 'audio/webm'],
]);

function audioType(filePath) {
    return AUDIO_TYPES.get(path.extname(filePath).toLowerCase()) ?? null;
}

function isInside(root, target) {
    const relative = path.relative(root, target);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function validId(id) {
    return typeof id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(id);
}

function createBgmFolders(dataRoot, { fsImpl = fs } = {}) {
    const absoluteFile = path.join(dataRoot, FOLDERS_FILE);

    function list() {
        try {
            const parsed = JSON.parse(fsImpl.readFileSync(absoluteFile, 'utf8'));
            return (Array.isArray(parsed?.folders) ? parsed.folders : [])
                .filter(folder => validId(folder?.id) && typeof folder.path === 'string' && path.isAbsolute(folder.path))
                .map(folder => ({ id: folder.id, path: folder.path, name: typeof folder.name === 'string' && folder.name.trim() ? folder.name.trim() : path.basename(folder.path) || folder.path }));
        } catch {
            return [];
        }
    }

    /** Replaces the folder list. Returns per-entry errors without saving when any entry is invalid. */
    function replace(entries) {
        if (!Array.isArray(entries) || entries.length > MAX_FOLDERS) return { errors: [{ index: -1, reason: 'invalid-list' }] };
        const current = list();
        const errors = [];
        const folders = [];
        const seen = new Set();
        entries.forEach((entry, index) => {
            const raw = typeof entry?.path === 'string' ? entry.path.trim() : '';
            if (!raw || !path.isAbsolute(raw)) return errors.push({ index, reason: 'not-absolute' });
            let resolved;
            try {
                resolved = fsImpl.realpathSync.native(raw);
                if (!fsImpl.statSync(resolved).isDirectory()) return errors.push({ index, reason: 'not-directory' });
            } catch {
                return errors.push({ index, reason: 'missing' });
            }
            const key = process.platform === 'win32' ? resolved.toLowerCase() : resolved;
            if (seen.has(key)) return errors.push({ index, reason: 'duplicate' });
            seen.add(key);
            const previous = current.find(folder => folder.id === entry.id) ?? current.find(folder => folder.path === resolved);
            const id = previous?.id ?? crypto.randomUUID().replace(/-/g, '').slice(0, 16);
            const name = typeof entry.name === 'string' && entry.name.trim() ? entry.name.trim().slice(0, 80) : path.basename(resolved) || resolved;
            folders.push({ id, path: resolved, name });
        });
        if (errors.length) return { errors };
        atomicWriteJson(dataRoot, FOLDERS_FILE, { schemaVersion: 1, folders });
        return { folders };
    }

    function rootOf(folderId) {
        const folder = list().find(item => item.id === folderId);
        if (!folder) return null;
        try { return fsImpl.realpathSync.native(folder.path); } catch { return null; }
    }

    /** Absolute path of an audio file inside a registered folder, or null. Follows links before checking. */
    function resolveFile(folderId, relPath) {
        if (!validId(folderId) || typeof relPath !== 'string' || !relPath || relPath.includes('\0')) return null;
        if (path.isAbsolute(relPath) || /^[A-Za-z]:/.test(relPath)) return null;
        const root = rootOf(folderId);
        if (!root) return null;
        const candidate = path.resolve(root, relPath);
        if (!isInside(root, candidate) || !audioType(candidate)) return null;
        try {
            const real = fsImpl.realpathSync.native(candidate);
            if (!isInside(root, real) || !audioType(real) || !fsImpl.statSync(real).isFile()) return null;
            return real;
        } catch {
            return null;
        }
    }

    /** Audio files under a folder, relative with forward slashes. Symlinked folders are not followed. */
    function scan(folderId) {
        const root = rootOf(folderId);
        if (!root) return null;
        const files = [];
        let truncated = false;
        const walk = (dir, depth) => {
            if (truncated || depth > MAX_SCAN_DEPTH) return;
            let entries;
            try { entries = fsImpl.readdirSync(dir, { withFileTypes: true }); } catch { return; }
            entries.sort((a, b) => a.name.localeCompare(b.name));
            for (const entry of entries) {
                const full = path.join(dir, entry.name);
                if (entry.isDirectory()) walk(full, depth + 1);
                else if (entry.isFile() && audioType(entry.name)) {
                    if (files.length >= MAX_SCAN_FILES) { truncated = true; return; }
                    files.push(path.relative(root, full).split(path.sep).join('/'));
                }
            }
        };
        walk(root, 0);
        return { files, truncated };
    }

    /** Maps an absolute file path to a registered folder, so a pasted path can become a track. */
    function locate(absolutePath) {
        if (typeof absolutePath !== 'string' || !path.isAbsolute(absolutePath.trim())) return null;
        let real;
        try { real = fsImpl.realpathSync.native(absolutePath.trim()); } catch { return null; }
        if (!audioType(real)) return null;
        for (const folder of list()) {
            const root = rootOf(folder.id);
            if (root && isInside(root, real)) {
                return { folderId: folder.id, relPath: path.relative(root, real).split(path.sep).join('/') };
            }
        }
        return null;
    }

    return { list, replace, resolveFile, scan, locate };
}

function registerBgmRoutes(app, { auth, activeSession, sessionAuth, folders }) {
    app.get('/api/bgm/folders', async (req, res) => {
        if (!await auth(req, res)) return;
        res.json({ folders: folders.list() });
    });
    app.put('/api/bgm/folders', async (req, res, next) => {
        if (!await auth(req, res) || !activeSession(req, res)) return;
        try {
            const result = folders.replace(req.body?.folders);
            if (result.errors) return res.status(400).json(result);
            res.json(result);
        } catch (error) { next(error); }
    });
    app.get('/api/bgm/folders/:folderId/files', async (req, res) => {
        if (!await auth(req, res)) return;
        const result = folders.scan(req.params.folderId);
        if (!result) return res.status(404).json({ error: 'Folder unavailable' });
        res.json(result);
    });
    app.post('/api/bgm/locate', async (req, res) => {
        if (!await auth(req, res)) return;
        const result = folders.locate(req.body?.path);
        if (!result) return res.status(404).json({ error: 'outside' });
        res.json(result);
    });
    // Audio elements cannot send auth headers, so this read uses the session cookie.
    app.get('/api/bgm/file/:folderId/:hexPath', sessionAuth, (req, res) => {
        const hex = req.params.hexPath;
        const relPath = /^(?:[0-9a-f]{2})+$/i.test(hex) ? Buffer.from(hex, 'hex').toString('utf8') : '';
        const file = folders.resolveFile(req.params.folderId, relPath);
        if (!file) return res.status(404).set('Cache-Control', 'no-store').end();
        res.type(audioType(file));
        res.sendFile(file, { dotfiles: 'allow', acceptRanges: true, headers: { 'Cache-Control': 'private, no-store' } }, error => {
            if (error && !res.headersSent) res.status(404).end();
        });
    });
}

module.exports = { createBgmFolders, registerBgmRoutes, audioType };
