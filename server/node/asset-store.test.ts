import { afterEach, describe, expect, it, vi } from 'vitest'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const { createFileKv } = require('./file-kv.cjs')

const roots: string[] = []
function root() {
    const value = fs.mkdtempSync(path.join(os.tmpdir(), 'risubard-asset-store-'))
    roots.push(value)
    return value
}
afterEach(() => roots.splice(0).forEach(value => fs.rmSync(value, { recursive: true, force: true })))

const sha = (value: Buffer) => crypto.createHash('sha256').update(value).digest('hex')
function asset(text: string, ext = 'png') {
    const value = Buffer.from(text)
    return { key: `assets/${sha(value)}.${ext}`, value }
}
const manifestOf = (dataRoot: string) => JSON.parse(fs.readFileSync(path.join(dataRoot, 'kv/manifest.json'), 'utf8')).entries
const storeFile = (dataRoot: string, key: string) => {
    const name = key.slice('assets/'.length)
    return path.join(dataRoot, 'asset-store', name.slice(0, 2), name)
}

describe('asset store', () => {
    it('writes content-addressed assets as files without touching the manifest', async () => {
        const dataRoot = root()
        const kv = createFileKv({ dataRoot })
        kv.kvSet('database/database.bin', Buffer.from('db'))
        const manifestPath = path.join(dataRoot, 'kv/manifest.json')
        const before = fs.readFileSync(manifestPath, 'utf8')
        const one = asset('one')
        const many = [asset('two'), asset('three', 'webp')]
        kv.kvSet(one.key, one.value)
        await kv.kvSetManyAsync(many)
        kv.kvSetMany([asset('four')])

        expect(fs.readFileSync(manifestPath, 'utf8')).toBe(before)
        expect(fs.existsSync(storeFile(dataRoot, one.key))).toBe(true)
        const reopened = createFileKv({ dataRoot })
        expect(reopened.kvGet(one.key)?.toString()).toBe('one')
        expect(reopened.kvGet(many[1].key)?.toString()).toBe('three')
        expect(reopened.kvList('assets/')).toHaveLength(4)
        expect(reopened.kvSize(one.key)).toBe(3)
        expect(reopened.kvListWithSizes('assets/').find((entry: { key: string }) => entry.key === many[0].key)?.size).toBe(3)
    })

    it('keeps other keys and mismatched digests in the manifest', () => {
        const dataRoot = root()
        const kv = createFileKv({ dataRoot })
        const wrong = `assets/${sha(Buffer.from('other'))}.png`
        kv.kvSet(wrong, Buffer.from('not other'))
        kv.kvSet('assets/custom-id.png', Buffer.from('custom'))
        expect(Object.keys(manifestOf(dataRoot)).sort()).toEqual(['assets/custom-id.png', wrong].sort())
        expect(fs.existsSync(path.join(dataRoot, 'asset-store'))).toBe(false)
        expect(kv.kvGet(wrong)?.toString()).toBe('not other')
    })

    it('leaves an identical manifest entry in place instead of duplicating it', () => {
        const dataRoot = root()
        const kv = createFileKv({ dataRoot })
        const one = asset('one')
        // Simulate data written before the asset store existed.
        kv.kvSet('database/database.bin', Buffer.from('db'))
        const manifest = JSON.parse(fs.readFileSync(path.join(dataRoot, 'kv/manifest.json'), 'utf8'))
        fs.mkdirSync(path.join(dataRoot, 'kv/objects'), { recursive: true })
        fs.writeFileSync(path.join(dataRoot, 'kv/objects', sha(one.value)), one.value)
        manifest.entries[one.key] = { object: sha(one.value), size: 3, updatedAt: 1 }
        writeManifest(dataRoot, manifest)
        const reopened = createFileKv({ dataRoot })
        reopened.kvSet(one.key, one.value)
        expect(fs.existsSync(storeFile(dataRoot, one.key))).toBe(false)
        expect(reopened.kvList('assets/')).toEqual([one.key])
    })

    it('moves deleted files to trash and lets GC sweep them after the grace period', () => {
        const dataRoot = root()
        const kv = createFileKv({ dataRoot })
        const one = asset('one')
        kv.kvSet(one.key, one.value)
        kv.kvDel(one.key)
        expect(kv.kvGet(one.key)).toBeNull()
        expect(kv.kvList('assets/')).toEqual([])
        expect(fs.readdirSync(path.join(dataRoot, 'asset-store-trash'))).toHaveLength(1)
        expect(kv.gcChunks({ minAgeMs: 60 * 60 * 1000 }).count).toBe(0)
        expect(kv.gcChunks({ minAgeMs: 0 }).count).toBe(1)
        expect(fs.readdirSync(path.join(dataRoot, 'asset-store-trash'))).toHaveLength(0)
    })

    it('reclaims stored files at once on explicit cleanup', () => {
        const dataRoot = root()
        const kv = createFileKv({ dataRoot })
        const one = asset('12345')
        kv.kvSet(one.key, one.value)
        kv.kvSet('assets/legacy.png', Buffer.from('legacy'))
        const result = kv.kvDelManyAndCollect([one.key, 'assets/legacy.png'])
        expect(result).toMatchObject({ count: 2, bytes: 11, reclaimed: 11 })
        expect(fs.existsSync(storeFile(dataRoot, one.key))).toBe(false)
    })

    it('serves a file another program added to the store while open, but not a corrupt one', () => {
        const dataRoot = root()
        const kv = createFileKv({ dataRoot })
        kv.kvSet('database/database.bin', Buffer.from('db'))
        const added = asset('added later')
        expect(kv.kvGet(added.key)).toBeNull()
        fs.mkdirSync(path.dirname(storeFile(dataRoot, added.key)), { recursive: true })
        fs.writeFileSync(storeFile(dataRoot, added.key), added.value)
        expect(kv.kvGet(added.key)?.equals(added.value)).toBe(true)
        expect(kv.kvSize(added.key)).toBe(added.value.length)

        const corrupt = asset('corrupt')
        fs.mkdirSync(path.dirname(storeFile(dataRoot, corrupt.key)), { recursive: true })
        fs.writeFileSync(storeFile(dataRoot, corrupt.key), Buffer.from('tampered'))
        expect(() => kv.kvGet(corrupt.key)).toThrow(/checksum mismatch/)
    })

    it('copies a stored value to another key', () => {
        const dataRoot = root()
        const kv = createFileKv({ dataRoot })
        const one = asset('one')
        kv.kvSet(one.key, one.value)
        kv.kvCopyValue(one.key, 'backup/copy')
        expect(kv.kvGet('backup/copy')?.toString()).toBe('one')
    })

    it('removes replaced stored keys on prefix replacement and restore preparation', async () => {
        const dataRoot = root()
        const kv = createFileKv({ dataRoot })
        const one = asset('one')
        kv.kvSet(one.key, one.value)
        const prepared = await kv.preparePrefixReplacementFromFilesAsync([], ['assets/'])
        expect(prepared.assetStoreDirectory).toBe('asset-store')
        kv.kvReplacePrefixes([{ key: 'assets/new.png', value: Buffer.from('new') }], ['assets/'])
        expect(kv.kvList('assets/')).toEqual(['assets/new.png'])
        expect(kv.kvGet(one.key)).toBeNull()
    })

    it('keeps upper-case extensions in the manifest so case-insensitive disks cannot merge two keys', () => {
        const dataRoot = root()
        const kv = createFileKv({ dataRoot })
        const value = Buffer.from('same image')
        const lower = `assets/${sha(value)}.png`
        const upper = `assets/${sha(value)}.PNG`
        kv.kvSet(lower, value)
        kv.kvSet(upper, value)
        expect(Object.keys(manifestOf(dataRoot))).toEqual([upper])
        kv.kvDel(lower)
        const reopened = createFileKv({ dataRoot })
        expect(reopened.kvList('assets/')).toEqual([upper])
        expect(reopened.kvGet(upper)?.equals(value)).toBe(true)
    })

    it('keeps a key listed, now and after a restart, when its file cannot be removed', () => {
        const dataRoot = root()
        const kv = createFileKv({ dataRoot })
        const [locked, free] = [asset('locked'), asset('free')]
        kv.kvSet(locked.key, locked.value)
        kv.kvSet(free.key, free.value)
        const original = fs.renameSync
        const rename = vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
            if (String(from).endsWith(locked.key.slice('assets/'.length)) || String(from).endsWith('asset-store')) {
                throw Object.assign(new Error('EBUSY'), { code: 'EBUSY' })
            }
            return original(from, to)
        })
        try {
            expect(kv.kvDelMany([locked.key, free.key])).toMatchObject({ count: 1 })
        } finally { rename.mockRestore() }
        expect(kv.kvList('assets/')).toEqual([locked.key])
        expect(createFileKv({ dataRoot }).kvList('assets/')).toEqual([locked.key])
    })

    it('moves the whole folder when every stored key is removed and sweeps trash within the delete limit', () => {
        const dataRoot = root()
        const kv = createFileKv({ dataRoot })
        for (let i = 0; i < 30; i++) kv.kvSet(asset(`bulk ${i}`).key, asset(`bulk ${i}`).value)
        kv.kvDelPrefix('assets/')
        expect(kv.kvList('assets/')).toEqual([])
        expect(fs.existsSync(path.join(dataRoot, 'asset-store'))).toBe(false)
        expect(kv.gcChunks({ minAgeMs: 0, maxDeletes: 10 }).count).toBe(10)
        expect(kv.gcChunks({ minAgeMs: 0, maxDeletes: 100 }).count).toBe(20)
        expect(fs.readdirSync(path.join(dataRoot, 'asset-store-trash'))).toEqual([])
        const again = asset('after bulk removal')
        kv.kvSet(again.key, again.value)
        expect(createFileKv({ dataRoot }).kvGet(again.key)?.equals(again.value)).toBe(true)
    })
})

function writeManifest(dataRoot: string, manifest: unknown) {
    const bytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`)
    fs.writeFileSync(path.join(dataRoot, 'kv/manifest.json'), bytes)
    fs.writeFileSync(path.join(dataRoot, 'kv/manifest.json.sha256'), `${sha(bytes)}\n`)
}

// Builds a store as older versions left it: every asset in the manifest.
function legacyRoot(count: number) {
    const dataRoot = root()
    const kv = createFileKv({ dataRoot })
    kv.kvSet('database/database.bin', Buffer.from('db'))
    const manifest = JSON.parse(fs.readFileSync(path.join(dataRoot, 'kv/manifest.json'), 'utf8'))
    const assets = Array.from({ length: count }, (_, i) => asset(`asset ${i}`))
    for (const { key, value } of assets) {
        fs.writeFileSync(path.join(dataRoot, 'kv/objects', sha(value)), value)
        manifest.entries[key] = { object: sha(value), size: value.length, updatedAt: 1 }
    }
    writeManifest(dataRoot, manifest)
    return { dataRoot, assets }
}

describe('asset store conversion', () => {
    it('converts in resumable batches, survives GC and reopens', async () => {
        const { dataRoot, assets } = legacyRoot(25)
        const kv = createFileKv({ dataRoot })
        expect(kv.assetStoreStatus()).toMatchObject({ convertible: 25, stored: 0 })

        const partial = await kv.convertToAssetStore({ limit: 10, verify: true })
        expect(partial).toMatchObject({ converted: 10, remaining: 15, verified: 10, failed: 0 })
        let next = partial
        while (next.remaining > 0) next = await kv.convertToAssetStore({ limit: 10 })

        expect(Object.keys(manifestOf(dataRoot))).toEqual(['database/database.bin'])
        kv.gcChunks({ minAgeMs: 0 })
        const reopened = createFileKv({ dataRoot })
        for (const { key, value } of assets) expect(reopened.kvGet(key)?.equals(value)).toBe(true)
        expect(reopened.kvList('assets/')).toHaveLength(25)
        expect(reopened.kvGet('database/database.bin')?.toString()).toBe('db')
        expect(reopened.assetStoreStatus()).toMatchObject({ convertible: 0, stored: 25, manifestEntries: 1 })
    })

    it('reverts every stored asset back into the manifest', async () => {
        const { dataRoot, assets } = legacyRoot(12)
        const kv = createFileKv({ dataRoot })
        await kv.convertToAssetStore({ limit: 100 })
        kv.gcChunks({ minAgeMs: 0 })
        const fresh = asset('written after conversion')
        kv.kvSet(fresh.key, fresh.value)

        let result = await kv.revertAssetStore({ limit: 5 })
        while (result.remaining > 0) result = await kv.revertAssetStore({ limit: 5 })

        expect(Object.keys(manifestOf(dataRoot))).toHaveLength(14)
        expect(fs.readdirSync(path.join(dataRoot, 'asset-store')).flatMap(dir =>
            fs.readdirSync(path.join(dataRoot, 'asset-store', dir)))).toEqual([])
        const reopened = createFileKv({ dataRoot })
        for (const { key, value } of [...assets, fresh]) expect(reopened.kvGet(key)?.equals(value)).toBe(true)
    })

    it('serves an asset whose object moved before the manifest was saved', async () => {
        const { dataRoot, assets } = legacyRoot(1)
        const [{ key, value }] = assets
        // Interrupted conversion: file moved into the store, manifest unchanged.
        fs.mkdirSync(path.dirname(storeFile(dataRoot, key)), { recursive: true })
        fs.renameSync(path.join(dataRoot, 'kv/objects', sha(value)), storeFile(dataRoot, key))
        const kv = createFileKv({ dataRoot })
        expect(kv.kvGet(key)?.equals(value)).toBe(true)
        expect(await kv.convertToAssetStore({})).toMatchObject({ converted: 1, remaining: 0 })
        expect(createFileKv({ dataRoot }).kvGet(key)?.equals(value)).toBe(true)
    })

    it.each([
        ['copies when hard links are unsupported', 'EPERM'],
        ['copies across devices', 'EXDEV'],
    ])('%s and reverts by copy', async (_label, code) => {
        const { dataRoot, assets } = legacyRoot(6)
        const link = vi.spyOn(fs.promises, 'link').mockRejectedValue(Object.assign(new Error(code), { code }))
        try {
            const kv = createFileKv({ dataRoot })
            expect(await kv.convertToAssetStore({})).toMatchObject({ converted: 6, missing: 0, errors: 0 })
            // Copied, then the unreferenced originals are dropped so the disk is not used twice.
            for (const { value } of assets) expect(fs.existsSync(path.join(dataRoot, 'kv/objects', sha(value)))).toBe(false)
            const reopened = createFileKv({ dataRoot })
            for (const { key, value } of assets) expect(reopened.kvGet(key)?.equals(value)).toBe(true)
            expect(await reopened.revertAssetStore({})).toMatchObject({ reverted: 6, failed: 0 })
            const final = createFileKv({ dataRoot })
            for (const { key, value } of assets) expect(final.kvGet(key)?.equals(value)).toBe(true)
            expect(final.assetStoreStatus()).toMatchObject({ stored: 0, convertible: 6 })
        } finally { link.mockRestore() }
    })

    it('copies an object another key still uses when hard links fail', async () => {
        const { dataRoot, assets } = legacyRoot(1)
        const [{ key, value }] = assets
        const kv = createFileKv({ dataRoot })
        kv.kvSet('backup/same-bytes', value)
        const link = vi.spyOn(fs.promises, 'link').mockRejectedValue(Object.assign(new Error('EPERM'), { code: 'EPERM' }))
        try {
            expect(await kv.convertToAssetStore({})).toMatchObject({ converted: 1 })
        } finally { link.mockRestore() }
        expect(fs.existsSync(path.join(dataRoot, 'kv/objects', sha(value)))).toBe(true)
        kv.gcChunks({ minAgeMs: 0 })
        const reopened = createFileKv({ dataRoot })
        expect(reopened.kvGet(key)?.equals(value)).toBe(true)
        expect(reopened.kvGet('backup/same-bytes')?.equals(value)).toBe(true)
    })

    it('converts V4 retired entries and skips missing objects', async () => {
        const { dataRoot, assets } = legacyRoot(3)
        const kv = createFileKv({ dataRoot })
        const [retired, lost] = assets
        const candidates = [retired].map(({ key, value }) => ({ key, object: sha(value), size: value.length }))
        expect(kv.retireAssets('character-1', candidates)).toEqual({ retired: 1 })
        fs.unlinkSync(path.join(dataRoot, 'kv/objects', sha(lost.value)))

        const result = await kv.convertToAssetStore({})
        expect(result).toMatchObject({ converted: 2, missing: 1, remaining: 0 })
        expect(kv.retiredSummary()).toEqual({})
        expect(kv.kvGet(retired.key)?.equals(retired.value)).toBe(true)
        expect(kv.assetStoreStatus()).toMatchObject({ unconvertible: 1 })
    })
})
