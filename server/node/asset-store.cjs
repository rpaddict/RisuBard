'use strict';

// Content-addressed asset files kept outside the KV manifest. A key
// "assets/<sha256>.<ext>" names its own bytes, so this store needs no index
// file: the path follows from the key and the digest proves the content.
// Writing one asset therefore costs one file, however many assets exist.
//
// Deletions move files to asset-store-trash/<time>-<id>/ and GC removes them
// later, matching the grace period unreferenced KV objects get. Older
// RisuBard versions never look here, so they cannot delete these files.
const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const crypto = require('node:crypto');

const STORE_DIR = 'asset-store';
const TRASH_DIR = 'asset-store-trash';
// Lower-case extensions only: on case-insensitive file systems (Windows, macOS)
// "x.png" and "x.PNG" would share one file. Other spellings stay in the manifest.
const STORE_KEY = /^assets\/([a-f0-9]{64})\.([a-z0-9]{1,16})$/;
const STORE_FILE = /^([a-f0-9]{64})\.([a-z0-9]{1,16})$/;

function parseStoreKey(key) {
    const match = typeof key === 'string' ? STORE_KEY.exec(key) : null;
    return match ? { digest: match[1], ext: match[2] } : null;
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

function createAssetStore({ dataRoot, digest }) {
    const root = path.join(dataRoot, STORE_DIR);
    const trashRoot = path.join(dataRoot, TRASH_DIR);
    // key -> { size, mtimeMs } once stat'ed, null until then.
    let index = new Map();

    function fileOf(parsed) {
        return path.join(root, parsed.digest.slice(0, 2), `${parsed.digest}.${parsed.ext}`);
    }

    function pathOf(key) {
        const parsed = parseStoreKey(key);
        return parsed ? fileOf(parsed) : null;
    }

    // Scans the folder once per process (and after a restore). Leftover
    // temporary files belong to writes a previous process never finished.
    function reload() {
        const next = new Map();
        if (fs.existsSync(root)) {
            for (const directory of fs.readdirSync(root, { withFileTypes: true })) {
                if (!directory.isDirectory() || !/^[a-f0-9]{2}$/.test(directory.name)) continue;
                const folder = path.join(root, directory.name);
                for (const name of fs.readdirSync(folder)) {
                    const match = STORE_FILE.exec(name);
                    if (match && match[1].startsWith(directory.name)) next.set(`assets/${name}`, null);
                    else if (name.startsWith('.') && name.endsWith('.tmp')) {
                        try { fs.unlinkSync(path.join(folder, name)); } catch {}
                    }
                }
            }
        }
        index = next;
    }

    // A file another program put in the store after the scan (a tool that
    // installs a module while the app runs) is picked up on first use instead
    // of after a restart. read() still checks its bytes against the digest.
    function has(key) {
        if (index.has(key)) return true;
        const file = pathOf(key);
        if (!file || !fs.existsSync(file)) return false;
        index.set(key, null);
        return true;
    }

    function stat(key) {
        const cached = index.get(key);
        if (cached) return cached;
        if (cached === undefined) return null;
        try {
            const info = fs.statSync(pathOf(key));
            // Whole milliseconds, like the manifest's updatedAt values.
            const value = { size: info.size, mtimeMs: Math.round(info.mtimeMs) };
            index.set(key, value);
            return value;
        } catch {
            // Removed outside the app: stop listing it.
            index.delete(key);
            return null;
        }
    }

    function size(key) {
        return stat(key)?.size ?? 0;
    }

    function updatedAt(key) {
        return stat(key)?.mtimeMs ?? null;
    }

    function list(prefix = '') {
        const keys = [];
        for (const key of index.keys()) if (key.startsWith(prefix)) keys.push(key);
        return keys;
    }

    function count() {
        return index.size;
    }

    function bytes() {
        let total = 0;
        for (const key of [...index.keys()]) total += size(key);
        return total;
    }

    function read(key) {
        const parsed = parseStoreKey(key);
        if (!parsed || !has(key)) return null;
        let value;
        try { value = fs.readFileSync(fileOf(parsed)); }
        catch (error) {
            if (error.code === 'ENOENT') { index.delete(key); return null; }
            throw error;
        }
        if (digest(value) !== parsed.digest) throw new Error(`Asset store checksum mismatch for ${key}`);
        return value;
    }

    function prepareTarget(parsed) {
        const target = fileOf(parsed);
        const directory = path.dirname(target);
        const created = !fs.existsSync(directory);
        if (created) {
            fs.mkdirSync(directory, { recursive: true });
            fsyncDirectory(root);
        }
        return { target, directory, temp: path.join(directory, `.${parsed.digest}.${crypto.randomUUID()}.tmp`) };
    }

    function current(key, length) {
        const known = stat(key);
        return known !== null && known.size === length;
    }

    // Accepts only bytes whose digest matches the key. The caller has already
    // hashed the value; anything else stays in the KV manifest.
    function write(key, data, hash) {
        const parsed = parseStoreKey(key);
        if (!parsed || parsed.digest !== hash) return false;
        if (current(key, data.length)) return true;
        const { target, directory, temp } = prepareTarget(parsed);
        const fd = fs.openSync(temp, 'wx', 0o600);
        try {
            fs.writeFileSync(fd, data);
            fs.fsyncSync(fd);
        } finally {
            fs.closeSync(fd);
        }
        fs.renameSync(temp, target);
        fsyncDirectory(directory);
        index.set(key, { size: data.length, mtimeMs: Date.now() });
        return true;
    }

    async function writeAsync(key, data, hash) {
        const parsed = parseStoreKey(key);
        if (!parsed || parsed.digest !== hash) return false;
        if (current(key, data.length)) return true;
        const { target, directory, temp } = prepareTarget(parsed);
        const handle = await fsp.open(temp, 'wx', 0o600);
        try {
            await handle.writeFile(data);
            await handle.sync();
        } finally {
            await handle.close();
        }
        await fsp.rename(temp, target);
        fsyncDirectory(directory);
        index.set(key, { size: data.length, mtimeMs: Date.now() });
        return true;
    }

    // Takes over an existing KV object file without touching it. A hard link
    // shares the bytes; where links are unavailable (FAT, exFAT, some shares,
    // another drive) a copy is verified before it is published. The object is
    // never moved: another key may still need it.
    async function adopt(key, sourcePath) {
        const parsed = parseStoreKey(key);
        if (!parsed) throw new Error(`Not a content-addressed asset key: ${key}`);
        const source = await fsp.stat(sourcePath);
        if (current(key, source.size)) return 'exists';
        const { target, temp } = prepareTarget(parsed);
        let how = 'link';
        try {
            await fsp.link(sourcePath, target);
        } catch (error) {
            if (error.code === 'EEXIST') {
                index.set(key, null);
                if (current(key, source.size)) return 'exists';
                throw new Error(`Asset store file differs from its object: ${key}`);
            }
            how = 'copy';
            await fsp.copyFile(sourcePath, temp);
            const handle = await fsp.open(temp, 'r+');
            try { await handle.sync(); } finally { await handle.close(); }
            if (digest(await fsp.readFile(temp)) !== parsed.digest) {
                await fsp.unlink(temp);
                throw new Error(`Asset store copy verification failed: ${key}`);
            }
            await fsp.rename(temp, target);
        }
        index.set(key, { size: source.size, mtimeMs: Math.round(source.mtimeMs) });
        return how;
    }

    function syncDirectories(keys) {
        const directories = new Set();
        for (const key of keys) {
            const file = pathOf(key);
            if (file) directories.add(path.dirname(file));
        }
        for (const directory of directories) if (fs.existsSync(directory)) fsyncDirectory(directory);
    }

    function trashBatch() {
        return path.join(trashRoot, `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`);
    }

    // Takes keys out of the store by moving or deleting their files. A key
    // leaves the index only after its file is gone, so a file another program
    // holds open (Windows antivirus, an image viewer) keeps its key listed now
    // and after a restart alike; the failure is counted, never thrown.
    function release(keys, dispose) {
        let removed = 0;
        let total = 0;
        let failed = 0;
        const touched = [];
        for (const key of new Set(keys)) {
            if (!index.has(key)) continue;
            const known = stat(key);
            if (!known) continue;
            try {
                dispose(key, pathOf(key));
                removed += 1;
                total += known.size;
            } catch (error) {
                if (error.code !== 'ENOENT') { failed += 1; continue; }
            }
            index.delete(key);
            touched.push(key);
        }
        if (failed) console.warn(`[Asset store] ${failed} file(s) could not be removed and stay listed`);
        syncDirectories(touched);
        return { count: removed, bytes: total, failed };
    }

    // Moves files to trash. When every stored key goes, the whole folder moves at once.
    function remove(keys) {
        const unique = new Set(keys);
        if (unique.size && unique.size === index.size && [...index.keys()].every(key => unique.has(key)) && fs.existsSync(root)) {
            let total = 0;
            for (const key of index.keys()) total += index.get(key)?.size ?? 0;
            const batch = trashBatch();
            try {
                fs.mkdirSync(batch, { recursive: true });
                fs.renameSync(root, path.join(batch, STORE_DIR));
                const count = index.size;
                index = new Map();
                fsyncDirectory(dataRoot);
                return { count, bytes: total, failed: 0 };
            } catch { /* A locked file blocks the folder move: fall back to one file at a time. */ }
        }
        let batch = null;
        return release(unique, (key, file) => {
            batch ??= trashBatch();
            const destination = path.join(batch, path.relative(root, file));
            fs.mkdirSync(path.dirname(destination), { recursive: true });
            fs.renameSync(file, destination);
        });
    }

    // Deletes files immediately, for explicit cleanup that reports reclaimed space.
    function purge(keys) {
        return release(keys, (_key, file) => fs.unlinkSync(file));
    }

    // Deletes trash older than the grace period, at most `maxDeletes` files per call.
    function sweepTrash({ minAgeMs = 0, now = Date.now(), maxDeletes = Number.POSITIVE_INFINITY } = {}) {
        let removed = 0;
        let total = 0;
        if (!fs.existsSync(trashRoot)) return { count: 0, bytes: 0 };
        for (const name of fs.readdirSync(trashRoot)) {
            if (removed >= maxDeletes) break;
            const created = Number(name.split('-')[0]);
            if (!Number.isFinite(created) || now - created < minAgeMs) continue;
            const batch = path.join(trashRoot, name);
            const folders = [];
            const stack = [batch];
            while (stack.length && removed < maxDeletes) {
                const folder = stack.pop();
                folders.push(folder);
                for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
                    if (removed >= maxDeletes) break;
                    const full = path.join(folder, entry.name);
                    if (entry.isDirectory()) { stack.push(full); continue; }
                    try {
                        const size = fs.statSync(full).size;
                        fs.unlinkSync(full);
                        removed += 1;
                        total += size;
                    } catch {}
                }
            }
            // Empty folders go deepest first; a folder with files left stays for the next sweep.
            for (const folder of folders.reverse()) {
                try { fs.rmdirSync(folder); } catch {}
            }
        }
        return { count: removed, bytes: total };
    }

    // Fills the size cache in the background so the first size listing after a
    // start does not stat every file while blocking requests.
    async function warmSizes() {
        let checked = 0;
        for (const key of [...index.keys()]) {
            if (index.get(key) !== null) continue;
            try {
                const info = await fsp.stat(pathOf(key));
                if (index.get(key) === null) index.set(key, { size: info.size, mtimeMs: Math.round(info.mtimeMs) });
            } catch { /* Left for the synchronous path, which also handles removal. */ }
            if (++checked % 500 === 0) await new Promise(resolve => setImmediate(resolve));
        }
    }

    reload();
    if (index.size) warmSizes().catch(() => {});

    return {
        pathOf, reload, has, size, updatedAt, list, count, bytes, read, write, writeAsync,
        adopt, syncDirectories, remove, purge, sweepTrash,
    };
}

module.exports = { createAssetStore, parseStoreKey, STORE_DIR, TRASH_DIR };
