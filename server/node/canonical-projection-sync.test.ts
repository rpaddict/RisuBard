import { afterEach, describe, expect, it } from 'vitest'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const { createUserDataRepository } = require('./user-data-repository.cjs')
let createCanonicalProjectionSync: any
try {
    ({ createCanonicalProjectionSync } = require('./canonical-projection-sync.cjs'))
} catch {
    createCanonicalProjectionSync = undefined
}

const roots: string[] = []

function replaceCanonicalJson(dataRoot: string, relativePath: string, value: unknown) {
    const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8')
    const target = path.join(dataRoot, relativePath)
    fs.writeFileSync(target, bytes)
    fs.writeFileSync(`${target}.sha256`, `${crypto.createHash('sha256').update(bytes).digest('hex')}\n`)
}
afterEach(() => {
    roots.splice(0).forEach(value => fs.rmSync(value, { recursive: true, force: true }))
})

describe('canonical projection sync', () => {
    it('loads externally edited canonical files and advances the accepted revision only after adoption', () => {
        expect(createCanonicalProjectionSync).toBeTypeOf('function')
        if (!createCanonicalProjectionSync) return

        const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'risubard-projection-sync-'))
        roots.push(dataRoot)
        const repository = createUserDataRepository({ dataRoot })
        repository.importLegacyDatabase({
            language: 'ko',
            botPresets: [{ id: 'preset-1', name: 'Original' }],
            modules: [], personas: [], loreBook: [], characters: [],
        }, { mode: 'merge' })

        let acceptedRevision: string | null = null
        const sync = createCanonicalProjectionSync({
            repository,
            readAcceptedRevision: () => acceptedRevision,
            writeAcceptedRevision: (revision: string) => { acceptedRevision = revision },
        })

        const initial = sync.loadExternalChanges()
        expect(initial?.database.botPresets[0].name).toBe('Original')
        expect(acceptedRevision).toBeNull()
        sync.accept(initial.revision)
        expect(sync.hasExternalChanges).toBeTypeOf('function')
        if (!sync.hasExternalChanges) return
        expect(sync.hasExternalChanges()).toBe(false)
        expect(sync.loadExternalChanges()).toBeNull()

        const presetPath = path.join(dataRoot, 'presets', 'preset-1.json')
        const preset = JSON.parse(fs.readFileSync(presetPath, 'utf8'))
        preset.name = 'Externally edited'
        replaceCanonicalJson(dataRoot, 'presets/preset-1.json', preset)

        expect(sync.hasExternalChanges()).toBe(true)
        // The rewrite refreshed its checksum, yet the review still sees which file changed.
        expect(sync.changedFiles()).toEqual([{ path: 'presets/preset-1.json', status: 'changed' }])
        const changed = sync.loadExternalChanges()
        expect(changed?.database.botPresets[0].name).toBe('Externally edited')
        expect(acceptedRevision).toBe(initial.revision)
        sync.accept(changed.revision)
        expect(acceptedRevision).toBe(changed.revision)
        expect(sync.loadExternalChanges()).toBeNull()
    })

    it('reconciles the sidebar before returning an externally edited compatibility projection', () => {
        expect(createCanonicalProjectionSync).toBeTypeOf('function')
        if (!createCanonicalProjectionSync) return

        const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'risubard-projection-sync-'))
        roots.push(dataRoot)
        const repository = createUserDataRepository({ dataRoot })
        repository.importLegacyDatabase({
            language: 'ko', botPresets: [], modules: [], personas: [], loreBook: [],
            characters: [{
                chaId: 'char-1', name: 'Original', modification_date: 1_700_000_000,
                globalLore: [{ key: 'old' }], chats: [],
            }],
        }, { mode: 'sync' })

        let acceptedRevision = repository.getProjectionRevision()
        const sync = createCanonicalProjectionSync({
            repository,
            readAcceptedRevision: () => acceptedRevision,
            writeAcceptedRevision: (revision: string) => { acceptedRevision = revision },
        })
        const metadata = repository.loadCharacter('char-1')
        metadata.name = 'External character'
        metadata.modification_date = 1_800_000_000
        metadata.globalLore = [{ key: 'new' }]
        replaceCanonicalJson(dataRoot, 'characters/char-1/metadata.json', metadata)

        const changed = sync.loadExternalChanges()

        expect(changed?.database.characters[0]).toMatchObject({
            name: 'External character',
            globalLore: [{ key: 'new' }],
        })
        expect(repository.loadSidebarIndex().characters[0]).toMatchObject({
            name: 'External character',
            updatedAt: 1_800_000_000_000,
        })
        expect(changed?.database).toStrictEqual(repository.exportLegacyDatabase())
        expect(changed?.revision).toBe(repository.getProjectionRevision())
    })

    it('invalidates a character whose globalLore changed while display summaries stayed the same', () => {
        expect(createCanonicalProjectionSync).toBeTypeOf('function')
        if (!createCanonicalProjectionSync) return

        const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'risubard-projection-sync-'))
        roots.push(dataRoot)
        const repository = createUserDataRepository({ dataRoot })
        repository.importLegacyDatabase({
            botPresets: [], modules: [], personas: [], loreBook: [],
            characters: [{
                chaId: 'char-1', name: 'Same name', modification_date: 1_800_000_000,
                globalLore: [{ key: 'old' }], chats: [],
            }],
        }, { mode: 'sync' })
        let acceptedRevision = repository.getProjectionRevision()
        const sync = createCanonicalProjectionSync({
            repository,
            readAcceptedRevision: () => acceptedRevision,
            writeAcceptedRevision: (revision: string) => { acceptedRevision = revision },
        })
        const metadata = repository.loadCharacter('char-1')
        metadata.globalLore = [{ key: 'new' }]
        metadata.modification_date = 1_800_000_001
        replaceCanonicalJson(dataRoot, 'characters/char-1/metadata.json', metadata)

        const changed = sync.loadExternalChanges()

        expect(changed?.sidebarWritten).toBe(true)
        expect(changed?.database.characters[0].globalLore).toEqual([{ key: 'new' }])
        expect(repository.loadSidebarIndex().characters[0]).toMatchObject({
            name: 'Same name',
            updatedAt: 1_800_000_001_000,
        })
    })
})

describe('canonical save racing an external edit', () => {
    const { observeWrites } = require('./file-store.cjs')
    const chat = (id: string) => ({ id, name: id, message: [{ role: 'user', data: 'hi', chatId: `${id}-m1` }], note: '', localLore: [] })
    const character = (chaId: string, desc: string) => ({
        type: 'character', chaId, name: chaId, desc, firstMessage: '', chats: [chat(`${chaId}-chat`)], chatPage: 0, additionalAssets: [],
    })

    function fixture() {
        const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'risubard-save-race-'))
        roots.push(dataRoot)
        const repository = createUserDataRepository({ dataRoot })
        const database = { characters: [character('bot', 'app'), character('other', 'o')], botPresets: [], modules: [], personas: [], loreBook: [] }
        const save = (db = database) => repository.importLegacyDatabase(structuredClone(db), { mode: 'sync' })
        save()
        let acceptedRevision: string | null = null
        const sync = createCanonicalProjectionSync({
            repository,
            readAcceptedRevision: () => acceptedRevision,
            writeAcceptedRevision: (revision: string) => { acceptedRevision = revision },
        })
        sync.accept()
        const metadata = fs.readdirSync(path.join(dataRoot, 'characters'))
            .map(name => `characters/${name}/metadata.json`)
            .find(file => fs.existsSync(path.join(dataRoot, file)) && JSON.parse(fs.readFileSync(path.join(dataRoot, file), 'utf8')).chaId === 'bot')!
        const desc = () => JSON.parse(fs.readFileSync(path.join(dataRoot, metadata), 'utf8')).desc
        // Like the bot factory installer: rename a new file in, leave the old checksum.
        const editExternally = () => {
            const target = path.join(dataRoot, metadata)
            const value = JSON.parse(fs.readFileSync(target, 'utf8'))
            value.desc = 'external'
            fs.writeFileSync(`${target}.tmp`, JSON.stringify(value, null, 2))
            fs.renameSync(`${target}.tmp`, target)
        }
        return { repository, database, save, sync, metadata, desc, editExternally }
    }

    it('accepts a save that no other program interrupted', () => {
        const f = fixture()
        f.database.characters[1].chats[0].message.push({ role: 'char', data: 'yo', chatId: 'other-m2' })
        const save = f.sync.beginSave()
        observeWrites(save, () => f.save())
        expect(save.settle()).toBeTypeOf('string')
        expect(f.sync.hasExternalChanges()).toBe(false)
    })

    it('leaves a file edited during an unrelated save pending for review', () => {
        const f = fixture()
        f.database.characters[1].chats[0].message.push({ role: 'char', data: 'yo', chatId: 'other-m2' })
        const save = f.sync.beginSave()
        observeWrites(save, () => f.save())
        f.editExternally()
        expect(save.settle()).toBeNull()
        expect(f.sync.hasExternalChanges()).toBe(true)
        expect(f.sync.changedFiles()).toEqual([{ path: f.metadata, status: 'changed' }])
    })

    it('refuses to replace a file another program rewrote after the save began', () => {
        const f = fixture()
        f.database.characters[0].desc = 'app edit'
        const save = f.sync.beginSave()
        f.editExternally()
        expect(() => observeWrites(save, () => f.save())).toThrow(expect.objectContaining({ code: 'CANONICAL_FILES_CHANGED' }))
        expect(f.desc()).toBe('external')
        expect(save.settle()).toBeNull()
        expect(f.sync.hasExternalChanges()).toBe(true)
        expect(f.sync.changedFiles()).toEqual([{ path: f.metadata, status: 'changed' }])
    })

    it('reports a file the app left unchanged as pending after the transaction stops', () => {
        const f = fixture()
        const save = f.sync.beginSave()
        f.editExternally()
        expect(() => observeWrites(save, () => f.save())).toThrow(expect.objectContaining({ code: 'CANONICAL_FILES_CHANGED' }))
        save.settle()
        expect(f.sync.hasExternalChanges()).toBe(true)
        expect(f.desc()).toBe('external')
    })

    it('reuses the revision a check just scanned instead of scanning again', () => {
        const f = fixture()
        let scans = 0
        const scan = f.repository.getProjectionRevision
        f.repository.getProjectionRevision = () => { scans++; return scan() }
        const unchanged = f.sync.checkExternalChanges()
        expect(unchanged).toEqual({ changed: false, revision: expect.any(String) })
        const before = scans
        expect(f.sync.loadExternalChanges(unchanged.revision)).toBeNull()
        expect(scans).toBe(before)

        f.editExternally()
        const changed = f.sync.checkExternalChanges()
        expect(changed.changed).toBe(true)
        expect(f.sync.loadExternalChanges(changed.revision)?.database.characters
            .find((item: any) => item.chaId === 'bot').desc).toBe('external')
        // Without a checked revision it still scans by itself.
        f.sync.accept()
        const scanned = scans
        expect(f.sync.loadExternalChanges()).toBeNull()
        expect(scans).toBe(scanned + 1)
    })
})
