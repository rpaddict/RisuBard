import { afterEach, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
const { createUserDataRepository } = require('./user-data-repository.cjs')
const { atomicWriteJson } = require('./file-store.cjs')
const { DIRECTORY_INDEX, createCharacterDirectoryResolver, resetCharacterDirectoryMappings } = require('./character-directories.cjs')
const roots: string[] = []
afterEach(() => roots.splice(0).forEach(root => fs.rmSync(root, { recursive: true, force: true })))
function fixture() {
    const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'directory-mapping-'))
    roots.push(dataRoot)
    const repo = createUserDataRepository({ dataRoot, allowDirectoryMapping: true })
    repo.importLegacyDatabase({ characters: [{ chaId: 'char-1', name: 'Alice', chats: [{ id: 'chat-1', name: 'First chat', message: [{ role: 'user', data: 'hello' }] }] }] })
    return { dataRoot, repo }
}
it('can migrate again after rename, new chat, rollback and restart', () => {
    const { dataRoot, repo } = fixture()
    const beforeMigration = repo.exportLegacyDatabase()
    beforeMigration.characters[0].name = 'Alice before migration'
    repo.importLegacyDatabase(beforeMigration, { mode: 'sync' })
    repo.publishCharacterDirectoryMapping('char-1')
    const edited = repo.exportLegacyDatabase()
    edited.characters[0].name = 'Alice renamed'
    edited.characters[0].chats[0].name = 'Renamed chat'
    edited.characters[0].chats[0].message.push({ role: 'char', data: 'saved after transition' })
    edited.characters[0].chats.push({ id: 'chat-2', name: 'New chat', message: [] })
    repo.importLegacyDatabase(edited, { mode: 'sync' })
    repo.refreshCharacterDirectoryMapping('char-1')
    repo.rollbackCharacterDirectoryMapping('char-1')
    // Saves made by older versions can leave a checksum for an older .bak.
    const backup = path.join(dataRoot, 'characters/char-1/metadata.json.bak')
    const historicalBytes = fs.readFileSync(backup)
    fs.writeFileSync(`${backup}.sha256`, '0'.repeat(64))
    const restarted = createUserDataRepository({ dataRoot, allowDirectoryMapping: true })
    restarted.publishCharacterDirectoryMapping('char-1')
    expect(restarted.characterDirectoryStatus('char-1')).toMatchObject({ enabled: true, chats: 2 })
    expect(fs.readFileSync(path.join(dataRoot, 'characters/Alice renamed/metadata.json.bak'))).toEqual(historicalBytes)
    expect(createUserDataRepository({ dataRoot }).exportLegacyDatabase()).toEqual(edited)
})
it('still rejects damaged live files before publishing a package', () => {
    const { dataRoot, repo } = fixture()
    const target = path.join(dataRoot, 'characters/char-1/chats/chat-1/messages.jsonl')
    fs.appendFileSync(target, '{"data":"unverified"}\n')
    expect(() => repo.publishCharacterDirectoryMapping('char-1')).toThrow(/checksum mismatch/)
    expect(repo.characterDirectoryStatus('char-1').enabled).toBe(false)
})
it.each(['migrate', 'refresh', 'rollback'])('marks only completed journal recovery for %s as an internal transition', action => {
    const { dataRoot, repo } = fixture()
    if (action !== 'migrate') repo.publishCharacterDirectoryMapping('char-1')
    if (action === 'refresh') {
        const edited = repo.exportLegacyDatabase()
        edited.characters[0].name = 'Renamed'
        repo.importLegacyDatabase(edited)
    }
    const expected = repo.exportLegacyDatabase()
    const failing = createUserDataRepository({ dataRoot, allowDirectoryMapping: true, directoryMappingTransactionOptions: { failAfterPublish: 1 } })
    let caught: any
    try {
        if (action === 'migrate') failing.publishCharacterDirectoryMapping('char-1')
        else if (action === 'refresh') failing.refreshCharacterDirectoryMapping('char-1')
        else failing.rollbackCharacterDirectoryMapping('char-1')
    } catch (error) { caught = error }
    expect(caught?.canonicalTransitionRecovered).toBe(true)
    const reopened = createUserDataRepository({ dataRoot })
    expect(reopened.characterDirectoryStatus('char-1').enabled).toBe(action !== 'rollback')
    expect(reopened.exportLegacyDatabase()).toEqual(expected)
})
it('moves a mapped character and retained legacy folder to trash on a normal save', () => {
    const { dataRoot, repo } = fixture()
    repo.publishCharacterDirectoryMapping('char-1')
    repo.importLegacyDatabase({ characters: [] }, { mode: 'sync' })
    expect(fs.existsSync(path.join(dataRoot, 'characters/Alice'))).toBe(false)
    expect(fs.existsSync(path.join(dataRoot, 'characters/char-1'))).toBe(false)
    const trashed = fs.readdirSync(path.join(dataRoot, 'trash'), { recursive: true }).map(String).map((item) => item.split(path.sep).join('/'))
    expect(trashed.some((item) => item.endsWith('characters/Alice'))).toBe(true)
    expect(trashed.some((item) => item.endsWith('characters/char-1'))).toBe(true)
    expect(createUserDataRepository({ dataRoot }).exportLegacyDatabase().characters).toEqual([])
})
it('publishes an explicit mapping, preserves old folders, and routes restart, writes and deletion by stable IDs', () => {
    const { dataRoot, repo } = fixture()
    repo.saveAssistantDraft('char-1', 'chat-1', { role: 'char', data: 'draft' })
    const before = repo.exportLegacyDatabase()
    const mapping = repo.publishCharacterDirectoryMapping('char-1')
    expect(mapping.directory).toBe('Alice')
    expect(mapping.chats[0].directory).toBe('First chat')
    expect(mapping.packageVersion).toBe(1)
    expect(JSON.parse(fs.readFileSync(path.join(dataRoot, 'characters/Alice/package.json'), 'utf8'))).toEqual({
        schemaVersion: 1,
        active: true,
        characterId: 'char-1',
        directory: 'Alice',
        chats: [{ id: 'chat-1', directory: 'First chat' }],
    })
    expect(repo.exportLegacyDatabase()).toEqual(before)
    const reopened = createUserDataRepository({ dataRoot })
    expect(reopened.loadAssistantDraft('char-1', 'chat-1').data).toBe('draft')
    reopened.finalizeAssistantDraft('char-1', 'chat-1')
    expect(reopened.loadMessages('char-1', 'chat-1')).toHaveLength(2)
    expect(JSON.parse(fs.readFileSync(path.join(dataRoot, 'characters/char-1/chats/chat-1/draft.json'), 'utf8')).data).toBe('draft')
    const updated = reopened.exportLegacyDatabase()
    updated.characters[0].name = 'Renamed'
    updated.characters[0].chats[0].name = 'Renamed chat'
    reopened.importLegacyDatabase(updated)
    expect(reopened.loadCharacter('char-1').name).toBe('Renamed')
    expect(fs.existsSync(path.join(dataRoot, 'characters/Renamed'))).toBe(false)
    expect(reopened.reconcileCanonicalProjection().database.characters).toHaveLength(1)
    reopened.importLegacyDatabase({ characters: [] }, { mode: 'replace' })
    expect(createUserDataRepository({ dataRoot }).exportLegacyDatabase().characters).toEqual([])
    expect(fs.existsSync(path.join(dataRoot, 'characters/char-1'))).toBe(true)
    expect(fs.existsSync(path.join(dataRoot, 'characters/Alice'))).toBe(false)
})
it('requires explicit internal opt-in and allocates case-insensitive collision-free paths', () => {
    const { dataRoot, repo } = fixture()
    expect(() => createUserDataRepository({ dataRoot }).publishCharacterDirectoryMapping('char-1')).toThrow(/disabled/)
    fs.mkdirSync(path.join(dataRoot, 'characters/ALICE'))
    const mapped = repo.publishCharacterDirectoryMapping('char-1')
    expect(mapped.directory).toBe('Alice (2)')
    expect(() => repo.publishCharacterDirectoryMapping('char-1')).toThrow(/already/)
})

it('rolls an active package back with its latest edits and remains readable after restart', () => {
    const { dataRoot, repo } = fixture()
    repo.publishCharacterDirectoryMapping('char-1')
    const updated = repo.exportLegacyDatabase()
    updated.characters[0].chats[0].message.push({ role: 'char', data: 'after migration' })
    repo.importLegacyDatabase(updated)
    expect(repo.rollbackCharacterDirectoryMapping('char-1')).toEqual({ enabled: false, directory: 'char-1', chats: 0 })
    expect(fs.existsSync(path.join(dataRoot, 'characters/char-1/metadata.json'))).toBe(true)
    expect(fs.existsSync(path.join(dataRoot, 'characters/Alice'))).toBe(false)
    expect(fs.existsSync(path.join(dataRoot, 'characters/char-1/package.json'))).toBe(false)
    const reopened = createUserDataRepository({ dataRoot })
    expect(reopened.loadMessages('char-1', 'chat-1').at(-1)?.data).toBe('after migration')
    expect(reopened.characterDirectoryStatus('char-1').enabled).toBe(false)
})

it('keeps active character and chat folder names in sync after canonical saves', () => {
    const { dataRoot, repo } = fixture()
    repo.publishCharacterDirectoryMapping('char-1')
    const maintained = createUserDataRepository({ dataRoot, allowDirectoryMapping: true, maintainDirectoryNames: true })
    const updated = maintained.exportLegacyDatabase()
    updated.characters[0].name = 'Renamed'
    updated.characters[0].chats[0].name = 'Renamed chat'
    maintained.importLegacyDatabase(updated)
    expect(fs.existsSync(path.join(dataRoot, 'characters/Renamed/chats/Renamed chat'))).toBe(true)
    expect(maintained.characterDirectoryStatus('char-1')).toEqual({ enabled: true, directory: 'Renamed', chats: 1 })
})

it('routes direct chat saves, new imports, revisions and chat trash while excluding retained copies', () => {
    const { dataRoot, repo } = fixture()
    repo.publishCharacterDirectoryMapping('char-1')
    const revision = repo.getProjectionRevision()
    const updated = repo.exportLegacyDatabase()
    updated.characters[0].chats[0].message.push({ role: 'char', data: 'new' })
    repo.syncLegacyChatState(updated, { chats: [{ characterId: 'char-1', chatId: 'chat-1' }] })
    expect(repo.getProjectionRevision()).not.toBe(revision)
    expect(repo.loadIndexedChat('char-1', 0).message).toHaveLength(2)
    expect(repo.loadStartupDatabase().characters[0].chats[0]._stub).toBe(true)
    repo.importLegacyDatabase({ characters: [{ chaId: 'char-1', name: 'Alice', chats: [{ id: 'chat-2', name: 'New', message: [] }] }, { chaId: 'char-2', name: 'Bob', chats: [] }] }, { mode: 'replace' })
    expect(fs.existsSync(path.join(dataRoot, 'characters/Alice/chats/First chat'))).toBe(false)
    const reopened = createUserDataRepository({ dataRoot })
    expect(reopened.exportLegacyDatabase().characters.map(c => c.chaId)).toEqual(['char-1', 'char-2'])
    expect(reopened.exportLegacyDatabase().characters[0].chats.map(c => c.id)).toEqual(['chat-2'])
    expect(fs.existsSync(path.join(dataRoot, 'characters/Alice/chats/chat-2'))).toBe(true)
})

it('refreshes mapped character and chat directories after renames and new chat creation', () => {
    const { dataRoot, repo } = fixture()
    repo.saveAssistantDraft('char-1', 'chat-1', { role: 'char', data: 'draft' })
    repo.publishCharacterDirectoryMapping('char-1')
    const updated = repo.exportLegacyDatabase()
    updated.characters[0].name = 'Renamed'
    updated.characters[0].chats[0].name = 'Renamed chat'
    updated.characters[0].chats.push({ id: 'chat-2', name: 'New chat', message: [{ role: 'user', data: 'new' }] })
    repo.importLegacyDatabase(updated, { mode: 'replace' })
    expect(fs.existsSync(path.join(dataRoot, 'characters/Alice/chats/chat-2'))).toBe(true)

    const mapping = repo.refreshCharacterDirectoryMapping('char-1')

    expect(mapping.directory).toBe('Renamed')
    expect(mapping.chats.find((chat: any) => chat.id === 'chat-1')?.directory).toBe('Renamed chat')
    expect(mapping.chats.find((chat: any) => chat.id === 'chat-2')?.directory).toBe('New chat')
    expect(JSON.parse(fs.readFileSync(path.join(dataRoot, 'characters/Renamed/package.json'), 'utf8'))).toMatchObject({
        characterId: 'char-1',
        directory: 'Renamed',
        chats: [
            { id: 'chat-1', directory: 'Renamed chat' },
            { id: 'chat-2', directory: 'New chat' },
        ],
    })
    expect(fs.existsSync(path.join(dataRoot, 'characters/Alice'))).toBe(false)
    expect(fs.existsSync(path.join(dataRoot, 'characters/Renamed/chats/Renamed chat/draft.json'))).toBe(true)
    expect(fs.existsSync(path.join(dataRoot, 'characters/Renamed/chats/New chat/messages.jsonl'))).toBe(true)
    const reopened = createUserDataRepository({ dataRoot, allowDirectoryMapping: true })
    expect(reopened.exportLegacyDatabase()).toEqual(updated)
})

it('renames character and chat directories when only letter case changes', () => {
    const { dataRoot, repo } = fixture()
    repo.publishCharacterDirectoryMapping('char-1')
    const updated = repo.exportLegacyDatabase()
    updated.characters[0].name = 'alice'
    updated.characters[0].chats[0].name = 'first chat'
    repo.importLegacyDatabase(updated, { mode: 'replace' })

    const mapping = repo.refreshCharacterDirectoryMapping('char-1')

    expect(mapping.directory).toBe('alice')
    expect(mapping.chats.find((chat: any) => chat.id === 'chat-1')?.directory).toBe('first chat')
    expect(fs.readdirSync(path.join(dataRoot, 'characters'))).toContain('alice')
    expect(fs.readdirSync(path.join(dataRoot, 'characters'))).not.toContain('Alice')
    expect(fs.readdirSync(path.join(dataRoot, 'characters/alice/chats'))).toContain('first chat')
    const reopened = createUserDataRepository({ dataRoot, allowDirectoryMapping: true })
    expect(reopened.exportLegacyDatabase()).toEqual(updated)
    expect(reopened.refreshCharacterDirectoryMapping('char-1').directory).toBe('alice')
})

it('numbers rename collisions', () => {
    const { dataRoot, repo } = fixture()
    repo.publishCharacterDirectoryMapping('char-1')
    fs.mkdirSync(path.join(dataRoot, 'characters/Renamed'))
    const updated = repo.exportLegacyDatabase()
    updated.characters[0].name = 'Renamed'
    updated.characters[0].chats[0].name = 'First chat'
    updated.characters[0].chats.push({ id: 'chat-2', name: 'First chat', message: [] })
    repo.importLegacyDatabase(updated, { mode: 'replace' })

    const mapping = repo.refreshCharacterDirectoryMapping('char-1')

    expect(mapping.directory).toBe('Renamed (2)')
    expect(mapping.chats.map((chat: any) => chat.directory)).toEqual(['First chat', 'First chat (2)'])
})

it('keeps a deleted chat path reserved when assigning a later chat', () => {
    const { repo } = fixture()
    repo.publishCharacterDirectoryMapping('char-1')
    const updated = repo.exportLegacyDatabase()
    updated.characters[0].chats = [{ id: 'chat-2', name: 'First chat', message: [] }]
    repo.importLegacyDatabase(updated, { mode: 'replace' })

    const mapping = repo.refreshCharacterDirectoryMapping('char-1')

    expect(mapping.chats).toEqual([
        { id: 'chat-2', directory: 'First chat (2)' },
        { id: 'chat-1', directory: 'First chat' },
    ])
})

it('finishes an interrupted directory refresh before returning the injected error', () => {
    const { dataRoot, repo } = fixture()
    repo.publishCharacterDirectoryMapping('char-1')
    const updated = repo.exportLegacyDatabase()
    updated.characters[0].name = 'Renamed'
    repo.importLegacyDatabase(updated)
    const failing = createUserDataRepository({
        dataRoot,
        allowDirectoryMapping: true,
        directoryMappingTransactionOptions: { failAfterPublish: 1 },
    })

    expect(() => failing.refreshCharacterDirectoryMapping('char-1')).toThrow(/simulated crash/)

    const reopened = createUserDataRepository({ dataRoot, allowDirectoryMapping: true })
    expect(reopened.loadCharacter('char-1').name).toBe('Renamed')
    expect(fs.existsSync(path.join(dataRoot, 'characters/Renamed/metadata.json'))).toBe(true)
    expect(fs.readdirSync(path.join(dataRoot, '.journal')).filter(name => name.endsWith('.json'))).toEqual([])
})

it('rejects new IDs reserved by mapped directory names without changing current files', () => {
    const { repo } = fixture()
    repo.publishCharacterDirectoryMapping('char-1')
    const before = repo.exportLegacyDatabase()
    expect(() => repo.importLegacyDatabase({ characters: [{ chaId: 'ALICE', chats: [] }] })).toThrow(/collides/)
    expect(repo.exportLegacyDatabase()).toEqual(before)
})

it('fails closed when a declared character package identity is changed', () => {
    const { dataRoot, repo } = fixture()
    repo.publishCharacterDirectoryMapping('char-1')
    atomicWriteJson(dataRoot, 'characters/Alice/package.json', {
        schemaVersion: 1,
        active: true,
        characterId: 'another-character',
        directory: 'Alice',
        chats: [{ id: 'chat-1', directory: 'First chat' }],
    })
    expect(() => createUserDataRepository({ dataRoot })).toThrow(/package identity/)
})

it.each(['../escape', 'CON', 'trailing.', '.hidden', 'a/b', 'a\\b'])('rejects unsafe mapping directory %s', directory => {
    const { dataRoot } = fixture()
    atomicWriteJson(dataRoot, DIRECTORY_INDEX, { schemaVersion: 1, characters: [{ id: 'char-1', directory, chats: [] }] })
    expect(() => createUserDataRepository({ dataRoot })).toThrow(/Unsafe/)
})

it('fails closed for missing or corrupt mapping and never uses an older backup', () => {
    const { dataRoot, repo } = fixture()
    repo.publishCharacterDirectoryMapping('char-1')
    fs.writeFileSync(path.join(dataRoot, `${DIRECTORY_INDEX}.bak`), JSON.stringify({ schemaVersion: 1, characters: [] }))
    const bytes = fs.readFileSync(path.join(dataRoot, DIRECTORY_INDEX))
    fs.writeFileSync(path.join(dataRoot, DIRECTORY_INDEX), '{}')
    expect(() => repo.getProjectionRevision()).toThrow()
    fs.writeFileSync(path.join(dataRoot, DIRECTORY_INDEX), bytes)
    expect(repo.loadCharacter('char-1').name).toBe('Alice')
    fs.unlinkSync(path.join(dataRoot, DIRECTORY_INDEX))
    expect(() => repo.getProjectionRevision()).toThrow(/missing/)
    expect(() => createUserDataRepository({ dataRoot })).toThrow(/missing/)
})

it('recovers journal publication interrupted before the mapping is published', () => {
    const { dataRoot } = fixture()
    const repo = createUserDataRepository({ dataRoot, allowDirectoryMapping: true })
    const before = repo.exportLegacyDatabase()
    const rename = fs.renameSync
    const spy = vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
        if (String(to) === path.join(dataRoot, DIRECTORY_INDEX)) throw new Error('Simulated mapping interruption')
        return rename(from, to)
    })
    try { expect(() => repo.publishCharacterDirectoryMapping('char-1')).toThrow(/interruption/) }
    finally { spy.mockRestore() }
    expect(fs.existsSync(path.join(dataRoot, DIRECTORY_INDEX))).toBe(false)
    const reopened = createUserDataRepository({ dataRoot })
    expect(reopened.exportLegacyDatabase()).toEqual(before)
    expect(reopened.reconcileCanonicalProjection().database.characters).toHaveLength(1)
    expect(fs.readdirSync(path.join(dataRoot, '.journal')).filter(name => name.endsWith('.json'))).toEqual([])
})

it('notifies other cached resolvers when a checked external mapping is published', () => {
    const { dataRoot } = fixture()
    const first = createCharacterDirectoryResolver(dataRoot)
    const second = createCharacterDirectoryResolver(dataRoot)
    atomicWriteJson(dataRoot, DIRECTORY_INDEX, { schemaVersion: 1, characters: [{ id: 'char-1', directory: 'Alice', chats: [] }] })
    first.refresh()
    expect(second.characterDirectory('char-1')).toBe(path.join('characters', 'Alice'))
})

it('accepts a restored mapping replacement only after the explicit restore reset', () => {
    const { dataRoot, repo } = fixture()
    repo.publishCharacterDirectoryMapping('char-1')
    const first = createCharacterDirectoryResolver(dataRoot)
    const second = createCharacterDirectoryResolver(dataRoot)
    expect(first.characterDirectory('char-1')).toBe(path.join('characters', 'Alice'))

    fs.unlinkSync(path.join(dataRoot, DIRECTORY_INDEX))
    fs.unlinkSync(path.join(dataRoot, `${DIRECTORY_INDEX}.sha256`))
    expect(() => first.refresh()).toThrow(/missing/)

    resetCharacterDirectoryMappings(dataRoot)
    expect(first.characterDirectory('char-1')).toBe(path.join('characters', 'char-1'))
    expect(second.characterDirectory('char-1')).toBe(path.join('characters', 'char-1'))
})
