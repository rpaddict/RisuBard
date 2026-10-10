import { afterEach, expect, test, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
const { createUserDataRepository } = require('./user-data-repository.cjs')
const { createFileKv } = require('./file-kv.cjs')
const { atomicWriteFile } = require('./file-store.cjs')
const { metadataSnapshot, mergePendingLiveDatabase } = require('./live-character-files.cjs')
const { createLiveFileMonitoring } = require('./live-file-monitoring.cjs')

test.each([
    ['android', {}],
    ['linux', { PREFIX: '/data/data/com.termux/files/usr' }],
    ['win32', {}],
    ['linux', {}],
])('monitoring stays off and creates no watcher on every platform: %s %j', (platform, env) => {
    const { root, repository } = fixture()
    fs.mkdirSync(path.join(root, 'config'), { recursive: true })
    fs.writeFileSync(path.join(root, 'config/live-file-monitoring.json'), '{"enabled":true}\n')
    const watch = vi.spyOn(fs, 'watch')
    try {
        const monitor = createLiveFileMonitoring({ repository, platform, env, writeAsset: () => {} })
        expect(monitor.status()).toEqual({ enabled: false, defaultEnabled: false })
        expect(watch).not.toHaveBeenCalled()
        expect(monitor.setEnabled(false)).toEqual({ enabled: false, defaultEnabled: false })
        expect(() => monitor.setEnabled(true)).toThrow('no longer available')
        expect(() => monitor.setEnabled('false')).toThrow('boolean')
        expect(monitor.isEnabled()).toBe(false)
        expect(watch).not.toHaveBeenCalled()
        monitor.close()
    } finally { watch.mockRestore() }
})

test('re-enabling reconciles valid external metadata even when its checksum was updated', () => {
    const { root, repository } = fixture()
    const monitor = createLiveCharacterFiles({ repository, enabled: false, watch: false, settleMs: 0, writeAsset: () => {} })
    const metadata = repository.exportLegacyDatabase().characters[0]
    const { chats, ...value } = metadata
    atomicWriteFile(root, 'characters/one/metadata.json', Buffer.from(JSON.stringify({ ...value, desc: 'Edited while off' })))
    monitor.setEnabled(true)
    expect(monitor.reconcile({ verifyMetadata: true }).database.characters[0].desc).toBe('Edited while off')
    monitor.close()
})

test('disabled monitoring creates no watcher and performs no repository scans', () => {
    const { repository } = fixture()
    const getRevision = vi.spyOn(repository, 'getProjectionRevision')
    const exportDatabase = vi.spyOn(repository, 'exportLegacyDatabase')
    const watcher = { on: vi.fn(), unref: vi.fn(), close: vi.fn() }
    const watch = vi.spyOn(fs, 'watch').mockReturnValue(watcher as any)
    let live: any
    try {
        live = createLiveCharacterFiles({ repository, enabled: false, writeAsset: () => {} })
        expect(watch).not.toHaveBeenCalled()
        expect(getRevision).not.toHaveBeenCalled()
        expect(exportDatabase).not.toHaveBeenCalled()
        live.invalidate(); live.reset(); live.accept()
        expect(live.reconcile({ verifyMetadata: true })).toBeNull()
        expect(getRevision).not.toHaveBeenCalled()
        live.setEnabled(true)
        expect(watch).toHaveBeenCalledOnce()
        live.setEnabled(false)
        expect(watcher.close).toHaveBeenCalledOnce()
        getRevision.mockClear(); exportDatabase.mockClear()
        live.reconcile({ verifyMetadata: true }); live.reset(); live.accept()
        expect(getRevision).not.toHaveBeenCalled()
        expect(exportDatabase).not.toHaveBeenCalled()
    } finally { live?.close(); vi.restoreAllMocks() }
})

test('watcher signals relevant changes and failures without reading file contents', () => {
    const { repository } = fixture()
    const onChange = vi.fn()
    const watcher = { on: vi.fn(), unref: vi.fn(), close: vi.fn() }
    const watch = vi.spyOn(fs, 'watch').mockReturnValue(watcher as any)
    let live: any
    try {
        live = createLiveCharacterFiles({ repository, onChange, writeAsset: () => {} })
        // A failed validation marks retry state dirty; it is not a new file event.
        live.invalidate()
        expect(onChange).not.toHaveBeenCalled()
        const listener = watch.mock.calls[0][2] as unknown as (event: string, name: string) => void
        const read = vi.spyOn(fs, 'readFileSync')
        listener('change', 'kv/objects/irrelevant')
        expect(onChange).not.toHaveBeenCalled()
        listener('change', 'characters/one/metadata.json')
        expect(onChange).toHaveBeenCalledOnce()
        expect(read).not.toHaveBeenCalled()
        watcher.on.mock.calls.find(call => call[0] === 'error')![1](new Error('watch unavailable'))
        expect(onChange).toHaveBeenCalledTimes(2)
    } finally { live?.close(); vi.restoreAllMocks() }
})

test.each(['clear', 'remove-field'])('external chat lore deletion is adopted and preserves pending messages: %s', (operation) => {
    const { root, repository } = fixture()
    const db = repository.exportLegacyDatabase()
    db.characters[0].chats[0].localLore = [{ key: 'old', content: 'chat lore' }]
    repository.importLegacyDatabase(db, { mode: 'sync' })
    const live = createLiveCharacterFiles({ repository, watch: false, settleMs: 0, writeAsset: () => {} })
    const file = path.join(root, 'characters/one/chats/chat/metadata.json')
    const metadata = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (operation === 'clear') metadata.localLore = []
    else delete metadata.localLore
    fs.writeFileSync(file, JSON.stringify(metadata))
    const result = live.reconcile()
    const pending = structuredClone(db)
    pending.characters[0].chats[0].message.push({ role: 'user', data: 'acknowledged message' })
    pending.characters[0].chats[0].note = 'unsaved note'
    pending.characters[0].chats[0].localLore = [{ key: 'app', content: 'acknowledged lore edit' }]
    const conflicts: any[] = []
    const merged = mergePendingLiveDatabase(pending, result.previous, result.database, conflicts)
    expect(conflicts).toContainEqual(expect.objectContaining({ characterId: 'one', chatId: 'chat', field: 'localLore', local: pending.characters[0].chats[0].localLore }))
    expect(merged.characters[0].chats[0].localLore ?? []).toEqual([])
    expect(merged.characters[0].chats[0].note).toBe('unsaved note')
    expect(merged.characters[0].chats[0].message).toHaveLength(2)
    expect(metadataSnapshot(merged).chatMetadata[0].metadata.message).toBeUndefined()
    expect(metadataSnapshot(merged).chatMetadata[0].metadata.localLore ?? []).toEqual([])
    repository.importLegacyDatabase(merged, { mode: 'sync' })
    expect(createUserDataRepository({ dataRoot: root }).exportLegacyDatabase().characters[0].chats[0].localLore ?? []).toEqual([])
})

test('explicit metadata verification detects edits when watcher notifications are missed', () => {
    const { root, repository, metadata } = fixture()
    const live = createLiveCharacterFiles({ repository, watch: false, settleMs: 0, writeAsset: () => {} })
    live.reconcile()
    const original = JSON.parse(fs.readFileSync(metadata, 'utf8'))
    fs.writeFileSync(metadata, '{')
    expect(() => live.reconcile({ verifyMetadata: true })).toThrow()
    expect(fs.readFileSync(metadata, 'utf8')).toBe('{')
    fs.writeFileSync(metadata, JSON.stringify({ ...original, desc: 'Missed notification' }))
    expect(live.reconcile({ verifyMetadata: true }).database.characters[0].desc).toBe('Missed notification')
    expect(live.reconcile({ verifyMetadata: true })).toBeNull()
})

test('watches the native real path when the data root uses a directory alias', () => {
    const { root, repository } = fixture()
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'bard-watch-alias-')); roots.push(parent)
    const alias = path.join(parent, 'data')
    fs.symlinkSync(root, alias, 'junction')
    const watcher = { on: vi.fn(), unref: vi.fn(), close: vi.fn() }
    const watch = vi.spyOn(fs, 'watch').mockReturnValue(watcher as any)
    try {
        const live = createLiveCharacterFiles({ repository: { ...repository, dataRoot: alias }, writeAsset: () => {} })
        expect(watch.mock.calls[0][0]).toBe(fs.realpathSync.native(root))
        live.close()
        expect(watcher.close).toHaveBeenCalledOnce()
    } finally { watch.mockRestore() }
})

test('malformed chat lore or changed chat identity is rejected before checksum acceptance', () => {
    const { root, repository } = fixture()
    const target = path.join(root, 'characters/one/chats/chat/metadata.json')
    const original = JSON.parse(fs.readFileSync(target, 'utf8'))
    for (const edit of [{ localLore: 'bad' }, { localLore: [{ content: 42 }] }, { id: 'other' }, { message: [] }]) {
        fs.writeFileSync(target, JSON.stringify({ ...original, ...edit }))
        expect(() => repository.reconcileCanonicalProjection({ externalEditing: true })).toThrow()
    }
})
const createLiveCharacterFiles = fs.existsSync(path.join(import.meta.dirname, 'live-character-files.cjs'))
    ? require('./live-character-files.cjs').createLiveCharacterFiles : undefined
const roots: string[] = []
afterEach(() => roots.splice(0).forEach(root => fs.rmSync(root, { recursive: true, force: true })))
test('does not import historical unregistered A1 copies during startup, but adopts a later edit', () => {
    const { root, repository } = fixture()
    atomicWriteFile(root, 'characters/one/assets/old.png', Buffer.from('old'))
    const store = createFileKv({ dataRoot: root })
    let writes = 0
    const live = createLiveCharacterFiles({ repository, watch: false, settleMs: 0, writeAsset(key: string, bytes: Buffer) { writes++; store.kvSet(key, bytes) } })
    const initial = live.reconcile()
    expect(initial?.database.characters[0].additionalAssets || []).toEqual([])
    expect(writes).toBe(0)
    fs.writeFileSync(path.join(root, 'characters/one/assets/old.png'), 'new')
    live.invalidate()
    expect(live.reconcile().database.characters[0].additionalAssets).toHaveLength(1)
    expect(writes).toBe(1)
})
test('publishes multiple new assets in one KV batch instead of rewriting the manifest per file', () => {
    const { root, repository } = fixture()
    const assets = path.join(root, 'characters/one/assets'); fs.mkdirSync(assets)
    fs.writeFileSync(path.join(assets, 'a.png'), 'a'); fs.writeFileSync(path.join(assets, 'b.png'), 'b')
    const store = createFileKv({ dataRoot: root })
    let batches = 0
    const live = createLiveCharacterFiles({ repository, watch: false, settleMs: 0,
        writeAsset() { throw new Error('per-file manifest rewrite') },
        writeAssets(entries: any[]) { batches++; store.kvSetMany(entries) },
    })
    const result = live.reconcile()
    expect(result.database.characters[0].additionalAssets).toHaveLength(2)
    expect(batches).toBe(1)
})
function fixture() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bard-live-files-')); roots.push(root)
    const repository = createUserDataRepository({ dataRoot: root })
    repository.importLegacyDatabase({ botPresets: [], modules: [], personas: [], loreBook: [{ id: 'world', name: 'World', data: [] }],
        characters: [{ chaId: 'one', type: 'character', name: 'One', desc: 'Before', globalLore: [{ key: 'old', content: 'Lore' }], additionalAssets: [], emotionImages: [], chats: [{ id: 'chat', name: 'Chat', message: [{ role: 'user', data: 'Keep me' }] }] }],
    }, { mode: 'sync' })
    const metadata = path.join(root, 'characters/one/metadata.json')
    return { root, repository, metadata }
}
test('adopts plain editor JSON and embedded lore removal without requiring checksum edits, then reopens', () => {
    const { root, repository, metadata } = fixture()
    const value = JSON.parse(fs.readFileSync(metadata, 'utf8'))
    value.desc = 'After'; value.globalLore = []
    fs.writeFileSync(metadata, JSON.stringify(value))
    const result = repository.reconcileCanonicalProjection({ externalEditing: true })
    expect(result.database.characters[0]).toMatchObject({ desc: 'After', globalLore: [], chats: [{ message: [{ data: 'Keep me' }] }] })
    expect(createUserDataRepository({ dataRoot: root }).exportLegacyDatabase().characters[0].desc).toBe('After')
})
test('validates all external input before accepting any file and keeps invalid editor bytes intact', () => {
    const { root, repository, metadata } = fixture()
    const checksum = fs.readFileSync(`${metadata}.sha256`, 'utf8')
    const value = JSON.parse(fs.readFileSync(metadata, 'utf8')); value.desc = 'Valid pending edit'
    fs.writeFileSync(metadata, JSON.stringify(value))
    fs.writeFileSync(path.join(root, 'lorebooks/world.json'), '{')
    expect(() => repository.reconcileCanonicalProjection({ externalEditing: true })).toThrow()
    expect(fs.readFileSync(`${metadata}.sha256`, 'utf8')).toBe(checksum)
    expect(fs.readFileSync(path.join(root, 'lorebooks/world.json'), 'utf8')).toBe('{')
})
test('rejects invalid character field types and stable ID changes', () => {
    const { repository, metadata } = fixture()
    const original = JSON.parse(fs.readFileSync(metadata, 'utf8'))
    for (const edit of [{ desc: 42 }, { globalLore: 'bad' }, { chaId: 'different' }, { chats: [] }]) {
        fs.writeFileSync(metadata, JSON.stringify({ ...original, ...edit }))
        expect(() => repository.reconcileCanonicalProjection({ externalEditing: true })).toThrow()
    }
})
test('accepts global lorebook edits and deletion without deleting character chats', () => {
    const { root, repository } = fixture()
    fs.writeFileSync(path.join(root, 'lorebooks/world.json'), JSON.stringify({ id: 'world', name: 'Edited', data: [] }))
    expect(repository.reconcileCanonicalProjection({ externalEditing: true }).database.loreBook[0].name).toBe('Edited')
    fs.unlinkSync(path.join(root, 'lorebooks/world.json'))
    const result = repository.reconcileCanonicalProjection({ externalEditing: true })
    expect(result.database.loreBook).toEqual([])
    expect(result.database.characters[0].chats[0].message[0].data).toBe('Keep me')
})

function liveFixture() {
    expect(createLiveCharacterFiles).toBeTypeOf('function')
    const base = fixture()
    const store = createFileKv({ dataRoot: base.root })
    const live = createLiveCharacterFiles({ repository: base.repository, writeAsset: store.kvSet, watch: false, settleMs: 0 })
    const assets = path.join(base.root, 'characters/one/assets'); fs.mkdirSync(assets, { recursive: true })
    return { ...base, store, live, assets }
}

test('explicit metadata verification does not scan or read unchanged assets', () => {
    const { live, assets } = liveFixture()
    const target = path.join(assets, 'smile.png')
    fs.writeFileSync(target, 'image')
    live.reconcile()
    const read = vi.spyOn(fs, 'readFileSync')
    const list = vi.spyOn(fs, 'readdirSync')
    try {
        expect(live.reconcile({ verifyMetadata: true })).toBeNull()
        expect(read.mock.calls.filter(([file]) => String(file) === target)).toHaveLength(0)
        expect(list.mock.calls.filter(([directory]) => String(directory) === assets)).toHaveLength(0)
    } finally { read.mockRestore(); list.mockRestore() }
})

test('persists verified asset fingerprints across restart and upgrades cacheless records once', () => {
    const { root, live, assets, store, repository } = liveFixture()
    const target = path.join(assets, 'smile.png')
    fs.writeFileSync(target, 'first')
    live.reconcile()
    const persisted = JSON.parse(fs.readFileSync(path.join(root, 'index/live-character-assets.json'), 'utf8')).characters.one['smile.png']
    require('./file-store.cjs').atomicWriteJson(root, 'index/character-asset-replicas.json', {
        schemaVersion: 1, characters: { one: { enabled: true, entries: [{ filename: 'smile.png', key: persisted.key, hash: persisted.hash }] } },
    })
    const restart = () => createLiveCharacterFiles({ repository, writeAsset: store.kvSet, watch: false, settleMs: 0 })
    const reads = vi.spyOn(fs, 'readFileSync')
    try {
        expect(restart().reconcile()).toBeNull()
        expect(reads.mock.calls.filter(([file]) => String(file) === target)).toHaveLength(0)
        const indexPath = path.join(root, 'index/live-character-assets.json')
        const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'))
        delete index.characters.one['smile.png'].stamp
        require('./file-store.cjs').atomicWriteJson(root, 'index/live-character-assets.json', index)
        reads.mockClear()
        expect(restart().reconcile()).toBeNull()
        expect(reads.mock.calls.filter(([file]) => String(file) === target)).toHaveLength(1)
        reads.mockClear()
        restart().reconcile()
        expect(reads.mock.calls.filter(([file]) => String(file) === target)).toHaveLength(0)
    } finally { reads.mockRestore() }
})

test('does not persist a verified stamp if an asset changes during its checksum read', () => {
    const { root, live, assets } = liveFixture()
    const target = path.join(assets, 'smile.png')
    fs.writeFileSync(target, 'first')
    const read = fs.readFileSync
    let changed = false
    const spy = vi.spyOn(fs, 'readFileSync').mockImplementation(((file: any, ...args: any[]) => {
        const result = (read as any)(file, ...args)
        if (String(file) === target && !changed) {
            changed = true
            fs.writeFileSync(target, 'different size')
        }
        return result
    }) as typeof fs.readFileSync)
    try { expect(() => live.reconcile()).toThrow('Asset changed while reading') }
    finally { spy.mockRestore() }
    expect(fs.existsSync(path.join(root, 'index/live-character-assets.json'))).toBe(false)
})

test('cached scans check each file once without repeating directory ancestry checks', () => {
    const { live, assets } = liveFixture()
    const count = 64
    for (let i = 0; i < count; i++) fs.writeFileSync(path.join(assets, `${i}.png`), 'image')
    live.reconcile()
    live.invalidate()
    const lstat = vi.spyOn(fs, 'lstatSync')
    const exists = vi.spyOn(fs, 'existsSync')
    try {
        expect(live.reconcile()).toBeNull()
        expect(lstat.mock.calls.length).toBeLessThan(count + 50)
        expect(exists.mock.calls.length).toBeLessThan(50)
    } finally { lstat.mockRestore(); exists.mockRestore() }
})

test('rejects an asset directory exchanged for a junction while scanning before publishing', () => {
    const { root, live, assets } = liveFixture()
    const target = path.join(assets, 'smile.png')
    fs.writeFileSync(target, 'first')
    live.reconcile()
    live.invalidate()
    const indexPath = path.join(root, 'index/live-character-assets.json')
    const before = fs.readFileSync(indexPath)
    const external = path.join(root, 'outside-assets')
    fs.mkdirSync(external)
    fs.writeFileSync(path.join(external, 'smile.png'), 'first')
    const lstat = fs.lstatSync
    let swapped = false
    const spy = vi.spyOn(fs, 'lstatSync').mockImplementation(((file: any, ...args: any[]) => {
        const result = (lstat as any)(file, ...args)
        if (String(file) === target && !swapped) {
            swapped = true
            fs.renameSync(assets, `${assets}-original`)
            fs.symlinkSync(external, assets, 'junction')
        }
        return result
    }) as typeof fs.lstatSync)
    try { expect(() => live.reconcile()).toThrow() }
    finally { spy.mockRestore() }
    expect(fs.readFileSync(indexPath)).toEqual(before)
})

test('rejects a file exchanged for a directory junction after enumeration', () => {
    const { root, live, assets } = liveFixture()
    const target = path.join(assets, 'smile.png')
    fs.writeFileSync(target, 'first')
    const external = path.join(root, 'external-dir')
    fs.mkdirSync(external)
    const readdir = fs.readdirSync
    let swapped = false
    const spy = vi.spyOn(fs, 'readdirSync').mockImplementation(((directory: any, ...args: any[]) => {
        const result = (readdir as any)(directory, ...args)
        if (String(directory) === assets && !swapped) {
            swapped = true
            fs.unlinkSync(target)
            fs.symlinkSync(external, target, 'junction')
        }
        return result
    }) as typeof fs.readdirSync)
    try { expect(() => live.reconcile()).toThrow() }
    finally { spy.mockRestore() }
    expect(fs.existsSync(path.join(root, 'index/live-character-assets.json'))).toBe(false)
})

test('rejects a corrupt persisted fingerprint index instead of trusting its stamps', () => {
    const { root, live, assets, store, repository } = liveFixture()
    fs.writeFileSync(path.join(assets, 'smile.png'), 'first')
    live.reconcile()
    fs.writeFileSync(path.join(root, 'index/live-character-assets.json'), '{}')
    const restarted = createLiveCharacterFiles({ repository, writeAsset: store.kvSet, watch: false, settleMs: 0 })
    expect(() => restarted.reconcile()).toThrow()
})

test.each(['same-size', 'replacement', 'deletion'])('persisted fingerprints detect external %s after restart', operation => {
    const { live, assets, store, repository } = liveFixture()
    const target = path.join(assets, 'smile.png')
    fs.writeFileSync(target, 'first')
    const initial = live.reconcile().database.characters[0].additionalAssets[0][1]
    const original = fs.statSync(target)
    if (operation === 'deletion') fs.unlinkSync(target)
    else {
        if (operation === 'replacement') {
            const replacement = path.join(assets, 'replacement.tmp')
            fs.writeFileSync(replacement, 'other')
            fs.renameSync(replacement, target)
        } else fs.writeFileSync(target, 'other')
        fs.utimesSync(target, original.atime, original.mtime)
    }
    const restarted = createLiveCharacterFiles({ repository, writeAsset: store.kvSet, watch: false, settleMs: 0 })
    const entries = restarted.reconcile().database.characters[0].additionalAssets
    if (operation === 'deletion') expect(entries).toEqual([])
    else {
        expect(entries[0][1]).not.toBe(initial)
        expect(store.kvGet(entries[0][1]).toString()).toBe('other')
    }
})
test('recovers a fingerprint-only publication interrupted between the index and checksum', () => {
    const { root, live, assets, store, repository } = liveFixture()
    fs.writeFileSync(path.join(assets, 'smile.png'), 'first')
    live.reconcile()
    const { atomicWriteJson } = require('./file-store.cjs')
    const relative = 'index/live-character-assets.json'
    const index = JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'))
    delete index.characters.one['smile.png'].stamp
    atomicWriteJson(root, relative, index)
    const restart = () => createLiveCharacterFiles({ repository, writeAsset: store.kvSet, watch: false, settleMs: 0 })
    const reopened = restart()
    const rename = fs.renameSync
    let interrupted = false
    const spy = vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
        if (!interrupted && String(to) === path.join(root, `${relative}.sha256`)) {
            interrupted = true
            throw new Error('interrupted fingerprint publication')
        }
        return rename(from, to)
    })
    try { expect(() => reopened.reconcile()).toThrow('interrupted fingerprint publication') }
    finally { spy.mockRestore() }
    expect(interrupted).toBe(true)
    expect(restart().reconcile()).toBeNull()
    expect(store.kvGet(index.characters.one['smile.png'].key).toString()).toBe('first')
})

test('a dropped asset becomes available, same-size replacement changes its URL, and removal removes the reference', () => {
    const { live, assets, store } = liveFixture()
    fs.writeFileSync(path.join(assets, 'smile.png'), 'first')
    const added = live.reconcile().database.characters[0].additionalAssets[0]
    expect(added[0]).toBe('smile'); expect(store.kvGet(added[1]).toString()).toBe('first')
    fs.writeFileSync(path.join(assets, 'smile.png'), 'other'); live.invalidate()
    const replaced = live.reconcile().database.characters[0].additionalAssets[0]
    expect(replaced[1]).not.toBe(added[1]); expect(store.kvGet(replaced[1]).toString()).toBe('other')
    expect(store.kvGet(added[1]).toString()).toBe('first')
    fs.unlinkSync(path.join(assets, 'smile.png')); live.invalidate()
    expect(live.reconcile().database.characters[0].additionalAssets).toEqual([])
})
test('tracks assets across restart and ignores editor temporary files and checksum sidecars', () => {
    const { root, live, assets, store } = liveFixture()
    fs.writeFileSync(path.join(assets, 'smile.png'), 'first')
    fs.writeFileSync(path.join(assets, '.smile.png'), 'temp')
    fs.writeFileSync(path.join(assets, 'smile.png.bak'), 'backup')
    fs.writeFileSync(path.join(assets, 'smile.png.sha256'), 'checksum')
    expect(live.reconcile().database.characters[0].additionalAssets).toHaveLength(1)
    fs.unlinkSync(path.join(assets, 'smile.png'))
    const restarted = createLiveCharacterFiles({ repository: createUserDataRepository({ dataRoot: root }), writeAsset: store.kvSet, watch: false, settleMs: 0 })
    expect(restarted.reconcile().database.characters[0].additionalAssets).toEqual([])
})
test('retains malformed JSON and retries it after the editor finishes saving', () => {
    const { live, metadata, assets, store, repository } = liveFixture()
    const before = fs.readFileSync(metadata, 'utf8')
    fs.writeFileSync(metadata, '{')
    fs.writeFileSync(path.join(assets, 'new.png'), 'image')
    expect(() => live.reconcile()).toThrow()
    expect(fs.readFileSync(metadata, 'utf8')).toBe('{')
    fs.writeFileSync(metadata, before)
    expect(live.reconcile().database.characters[0].additionalAssets).toHaveLength(1)
    expect(repository.loadChat('one', 'chat').message[0].data).toBe('Keep me')
})
test('external adoption preserves acknowledged but not yet flushed chats and disjoint metadata edits', () => {
    const merge = require('./live-character-files.cjs').mergePendingLiveDatabase
    expect(merge).toBeTypeOf('function')
    const baseline = { characters: [{ chaId: 'one', desc: 'Old', name: 'One' }], loreBook: [] }
    const pending = { language: 'ko', characters: [{ chaId: 'one', desc: 'Old', name: 'App edit', chats: [{ id: 'chat', message: ['Newest'] }] }], loreBook: [] }
    const external = { language: 'en', characters: [{ chaId: 'one', desc: 'File edit', name: 'One', chats: [{ id: 'chat', message: ['Old'] }] }], loreBook: [] }
    expect(merge(pending, baseline, external)).toEqual({ language: 'ko', characters: [{ chaId: 'one', desc: 'File edit', name: 'App edit', chats: [{ id: 'chat', message: ['Newest'] }] }], loreBook: [] })
})
test('deleting one of two equal-content files does not remove the other asset', () => {
    const { live, assets } = liveFixture()
    fs.writeFileSync(path.join(assets, 'one.png'), 'same')
    fs.writeFileSync(path.join(assets, 'two.png'), 'same')
    expect(live.reconcile().database.characters[0].additionalAssets).toHaveLength(2)
    fs.unlinkSync(path.join(assets, 'one.png')); live.invalidate()
    const remaining = live.reconcile().database.characters[0].additionalAssets
    expect(remaining).toHaveLength(1); expect(remaining[0][0]).toBe('two')
})
test('keeps registered extensionless replicas and imports ordinary text assets', () => {
    const { root, repository } = fixture()
    const store = createFileKv({ dataRoot: root })
    store.kvSet('assets/old', Buffer.from('old'))
    const db = repository.exportLegacyDatabase(); db.characters[0].image = 'assets/old'
    repository.importLegacyDatabase(db, { mode: 'sync' })
    store.characterAssets.migrate(db, 'one', store.kvGet)
    const live = createLiveCharacterFiles({ repository, writeAsset: store.kvSet, watch: false, settleMs: 0 })
    fs.writeFileSync(path.join(root, 'characters/one/assets/note.txt'), 'hello')
    const result = live.reconcile().database.characters[0]
    expect(result.image).toBe('assets/old')
    expect(result.additionalAssets[0][0]).toBe('note')
})
test('does not overwrite an editor save made while an asset is being imported', () => {
    const { root, repository, metadata } = fixture()
    const assets = path.join(root, 'characters/one/assets'); fs.mkdirSync(assets)
    fs.writeFileSync(path.join(assets, 'one.png'), 'image')
    const store = createFileKv({ dataRoot: root })
    const live = createLiveCharacterFiles({ repository, watch: false, settleMs: 0, writeAsset(key: string, bytes: Buffer) {
        store.kvSet(key, bytes)
        const value = JSON.parse(fs.readFileSync(metadata, 'utf8')); value.desc = 'New editor save'
        fs.writeFileSync(metadata, JSON.stringify(value))
    } })
    expect(() => live.reconcile()).toThrow()
    expect(JSON.parse(fs.readFileSync(metadata, 'utf8')).desc).toBe('New editor save')
})
test('starts with validated character and lore edits made while the server was stopped', () => {
    const { root, metadata } = fixture()
    const value = JSON.parse(fs.readFileSync(metadata, 'utf8')); value.desc = 'Offline edit'
    fs.writeFileSync(metadata, JSON.stringify(value))
    fs.writeFileSync(path.join(root, 'lorebooks/world.json'), JSON.stringify({ id: 'world', name: 'Offline lore', data: [] }))
    const restarted = createUserDataRepository({ dataRoot: root, liveExternalEditing: true })
    expect(restarted.exportLegacyDatabase().characters[0].desc).toBe('Offline edit')
    expect(restarted.exportLegacyDatabase().loreBook[0].name).toBe('Offline lore')
})
test('startup with incomplete editor JSON can report the error and adopt the repaired file', () => {
    const { root, metadata } = fixture()
    const original = fs.readFileSync(metadata)
    fs.writeFileSync(metadata, '{')
    const repository = createUserDataRepository({ dataRoot: root, liveExternalEditing: true })
    const store = createFileKv({ dataRoot: root })
    const live = createLiveCharacterFiles({ repository, writeAsset: store.kvSet, watch: false, settleMs: 0 })
    expect(() => live.reconcile()).toThrow()
    expect(fs.readFileSync(metadata, 'utf8')).toBe('{')
    fs.writeFileSync(metadata, original)
    expect(live.reconcile().database.characters[0].desc).toBe('Before')
})
test('replacing an A1 replica preserves the original KV bytes used by other characters and exports', () => {
    const { root, repository } = fixture()
    const store = createFileKv({ dataRoot: root })
    store.kvSet('assets/portrait.png', Buffer.from('first'))
    const db = repository.exportLegacyDatabase(); db.characters[0].image = 'assets/portrait.png'
    repository.importLegacyDatabase(db, { mode: 'sync' })
    store.characterAssets.migrate(db, 'one', store.kvGet)
    const live = createLiveCharacterFiles({ repository, writeAsset: store.kvSet, reloadAssets: store.characterAssets.reload, watch: false, settleMs: 0 })
    live.reconcile()
    const index = JSON.parse(fs.readFileSync(path.join(root, 'index/character-asset-replicas.json'), 'utf8'))
    fs.writeFileSync(path.join(root, 'characters/one/assets', index.characters.one.entries[0].filename), 'other')
    live.invalidate()
    const changed = live.reconcile().database.characters[0]
    expect(changed.image).not.toBe('assets/portrait.png')
    expect(store.kvGet(changed.image).toString()).toBe('other')
    expect(store.kvGet('assets/portrait.png').toString()).toBe('first')
    expect(createFileKv({ dataRoot: root }).kvGet('assets/portrait.png').toString()).toBe('first')
})
