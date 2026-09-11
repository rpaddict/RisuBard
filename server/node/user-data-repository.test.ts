import { afterEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const { createUserDataRepository } = require('./user-data-repository.cjs')

const roots: string[] = []
function root() {
    const value = fs.mkdtempSync(path.join(os.tmpdir(), 'risubard-repository-'))
    roots.push(value)
    return value
}
afterEach(() => {
    vi.restoreAllMocks()
    roots.splice(0).forEach(value => fs.rmSync(value, { recursive: true, force: true }))
})

function legacyDatabase() {
    return {
        formatversion: 5,
        language: 'ko',
        openAIKey: 'secret-key',
        provider: { model: 'example', credentials: { accessToken: 'nested-secret' } },
        botPresets: [{ id: 'preset-1', name: 'Preset', temperature: 0.7 }],
        modules: [{ id: 'module-1', name: 'Module', lorebook: [] }],
        personas: [{ id: 'persona-1', name: 'Writer', personaPrompt: 'hello' }],
        loreBook: [{ id: 'lore-1', name: 'World', data: [] }],
        characters: [{
            chaId: 'char-1',
            name: 'Character',
            description: 'loaded only on demand',
            chats: [{
                id: 'chat-1',
                name: 'Chat',
                lastDate: 123,
                message: [
                    { id: 'message-1', role: 'user', data: 'hello' },
                    { id: 'message-2', role: 'char', data: 'world' },
                ],
            }],
        }],
    }
}

describe('canonical entity tree', () => {
    it('imports the legacy projection into stable-ID JSON and chat JSONL files', () => {
        const dataRoot = root()
        const repository = createUserDataRepository({ dataRoot })
        const result = repository.importLegacyDatabase(legacyDatabase(), { mode: 'merge' })

        expect(result.transaction).toMatchObject({
            committed: result.files,
            published: result.files,
            skipped: 0,
        })
        expect(result.transaction.stagedBytes).toBeGreaterThan(0)

        expect(JSON.parse(fs.readFileSync(path.join(dataRoot, 'settings', 'app.json'), 'utf8')).openAIKey).toBeUndefined()
        expect(JSON.parse(fs.readFileSync(path.join(dataRoot, 'secrets', 'credentials.json'), 'utf8')).openAIKey).toBe('secret-key')
        expect(JSON.parse(fs.readFileSync(path.join(dataRoot, 'settings', 'app.json'), 'utf8')).provider).toEqual({ model: 'example' })
        expect(JSON.parse(fs.readFileSync(path.join(dataRoot, 'secrets', 'credentials.json'), 'utf8')).provider.credentials.accessToken).toBe('nested-secret')
        expect(fs.existsSync(path.join(dataRoot, 'presets', 'preset-1.json'))).toBe(true)
        expect(fs.existsSync(path.join(dataRoot, 'modules', 'module-1.json'))).toBe(true)
        expect(fs.existsSync(path.join(dataRoot, 'personas', 'persona-1.json'))).toBe(true)
        expect(fs.existsSync(path.join(dataRoot, 'lorebooks', 'lore-1.json'))).toBe(true)
        expect(fs.existsSync(path.join(dataRoot, 'characters', 'char-1', 'metadata.json'))).toBe(true)
        const lines = fs.readFileSync(path.join(dataRoot, 'characters', 'char-1', 'chats', 'chat-1', 'messages.jsonl'), 'utf8').trim().split('\n')
        expect(lines.map(line => JSON.parse(line).id)).toEqual(['message-1', 'message-2'])
    })

    it('keeps existing stable-ID entities on merge and moves omitted entities to trash on replace', () => {
        const dataRoot = root()
        const repository = createUserDataRepository({ dataRoot })
        repository.importLegacyDatabase(legacyDatabase(), { mode: 'replace' })

        repository.importLegacyDatabase({
            language: 'en',
            characters: [{ chaId: 'char-2', name: 'Second', chats: [] }],
            botPresets: [], modules: [], personas: [], loreBook: [],
        }, { mode: 'merge' })
        expect(repository.loadSidebarIndex().characters.map((item: any) => item.id)).toEqual(['char-1', 'char-2'])
        expect(repository.exportLegacyDatabase().provider.model).toBe('example')

        repository.importLegacyDatabase({
            language: 'ja',
            characters: [{ chaId: 'char-2', name: 'Second updated', chats: [] }],
            botPresets: [], modules: [], personas: [], loreBook: [],
        }, { mode: 'replace' })
        expect(repository.loadSidebarIndex().characters.map((item: any) => item.id)).toEqual(['char-2'])
        expect(repository.exportLegacyDatabase().provider).toBeUndefined()
        expect(fs.existsSync(path.join(dataRoot, 'characters', 'char-1'))).toBe(false)
        expect(fs.readdirSync(path.join(dataRoot, 'trash')).length).toBeGreaterThan(0)
    })

    it('boots from the sidebar index without reading character or message bodies', () => {
        const dataRoot = root()
        createUserDataRepository({ dataRoot }).importLegacyDatabase(legacyDatabase(), { mode: 'merge' })
        const reads: string[] = []
        const original = fs.readFileSync
        vi.spyOn(fs, 'readFileSync').mockImplementation(((file: fs.PathOrFileDescriptor, ...args: any[]) => {
            reads.push(String(file))
            return (original as any)(file, ...args)
        }) as any)

        const index = createUserDataRepository({ dataRoot }).loadSidebarIndex()
        expect(index.characters[0]).toMatchObject({ id: 'char-1', name: 'Character' })
        expect(reads.some(file => file.includes(`${path.sep}characters${path.sep}`))).toBe(false)
        expect(reads.some(file => file.endsWith('messages.jsonl'))).toBe(false)
    })

    it('lazy-loads a selected chat and reconstructs a compatible legacy projection', () => {
        const dataRoot = root()
        const repository = createUserDataRepository({ dataRoot })
        repository.importLegacyDatabase(legacyDatabase(), { mode: 'merge' })

        expect(repository.loadChat('char-1', 'chat-1').message).toHaveLength(2)
        const exported = repository.exportLegacyDatabase()
        expect(exported.openAIKey).toBe('secret-key')
        expect(exported.characters[0].description).toBe('loaded only on demand')
        expect(exported.characters[0].chats[0].message[1].data).toBe('world')
    })

    it('fsyncs a user message before request state and recovers an assistant draft', () => {
        const dataRoot = root()
        const repository = createUserDataRepository({ dataRoot })
        repository.importLegacyDatabase(legacyDatabase(), { mode: 'merge' })
        repository.commitUserMessage('char-1', 'chat-1', { id: 'message-3', role: 'user', data: 'committed' })
        repository.saveAssistantDraft('char-1', 'chat-1', { id: 'message-4', role: 'char', data: 'partial' })

        const reopened = createUserDataRepository({ dataRoot })
        expect(reopened.loadChat('char-1', 'chat-1').message.at(-1)?.data).toBe('committed')
        expect(reopened.loadAssistantDraft('char-1', 'chat-1')?.data).toBe('partial')
        reopened.finalizeAssistantDraft('char-1', 'chat-1')
        expect(reopened.loadChat('char-1', 'chat-1').message.at(-1)?.data).toBe('partial')
        expect(reopened.loadAssistantDraft('char-1', 'chat-1')).toBeNull()
    })

    it('changes the projection revision when canonical entity files are edited externally', () => {
        const dataRoot = root()
        const repository = createUserDataRepository({ dataRoot })
        repository.importLegacyDatabase(legacyDatabase(), { mode: 'merge' })

        const getProjectionRevision = repository.getProjectionRevision?.bind(repository)
        expect(getProjectionRevision).toBeTypeOf('function')
        if (!getProjectionRevision) return

        const revisions = [getProjectionRevision()]
        const editJson = (relativePath: string, mutate: (value: any) => void) => {
            const target = path.join(dataRoot, relativePath)
            const value = JSON.parse(fs.readFileSync(target, 'utf8'))
            mutate(value)
            fs.writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`)
            revisions.push(getProjectionRevision())
        }

        editJson('settings/app.json', value => { value.language = 'external-settings' })
        editJson('presets/preset-1.json', value => { value.name = 'External preset' })
        editJson('characters/char-1/metadata.json', value => { value.name = 'External character' })
        editJson('characters/char-1/chats/chat-1/metadata.json', value => { value.name = 'External chat' })
        fs.appendFileSync(
            path.join(dataRoot, 'characters', 'char-1', 'chats', 'chat-1', 'messages.jsonl'),
            `${JSON.stringify({ id: 'external-message', role: 'user', data: 'external' })}\n`,
        )
        revisions.push(getProjectionRevision())

        expect(revisions.every((revision, index) => index === 0 || revision !== revisions[index - 1])).toBe(true)
        expect(createUserDataRepository({ dataRoot }).getProjectionRevision()).toBe(revisions.at(-1))
    })
})
