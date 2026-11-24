import { describe, expect, it, vi } from 'vitest'
import { applyLiveFileSnapshot, createLiveFileRefresh, createLiveFileSignalRefresh } from './liveFileSync'

describe('live file signal refresh', () => {
    it('coalesces concurrent signals while retaining the last change', async () => {
        let finish!: () => void
        const refresh = vi.fn().mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve }))
            .mockResolvedValue(undefined)
        const listener = createLiveFileSignalRefresh({ refresh, isActive: () => true, isVisible: () => true, onError: vi.fn() })
        listener.signal()
        listener.signal()
        listener.signal()
        expect(refresh).toHaveBeenCalledTimes(1)
        finish()
        await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(2))
        listener.close()
        listener.signal()
        expect(refresh).toHaveBeenCalledTimes(2)
    })

    it('defers hidden-tab signals, catches up on visibility and stops after cleanup', async () => {
        let visible = false
        const refresh = vi.fn(async () => {})
        const listener = createLiveFileSignalRefresh({ refresh, isActive: () => true, isVisible: () => visible, onError: vi.fn() })
        listener.signal()
        listener.signal()
        expect(refresh).not.toHaveBeenCalled()
        visible = true
        listener.signal()
        await vi.waitFor(() => expect(refresh).toHaveBeenCalledOnce())
        listener.close()
        listener.signal()
        expect(refresh).toHaveBeenCalledOnce()
    })
})

describe('live chat metadata reconciliation', () => {
    it('removes external local lore while preserving live messages and unrelated unsaved metadata', () => {
        const chat = { id: 'chat', localLore: [{ key: 'old' }], note: 'unsaved', message: [{ data: 'streaming' }], isStreaming: true }
        const current = { characters: [{ chaId: 'a', chats: [chat], chatPage: 0 }], loreBook: [] }
        const baseline = { characters: [{ chaId: 'a', chats: [{ id: 'chat', _stub: true }] }], loreBook: [] }
        const rawBaseline = structuredClone(baseline)
        const state = new Map()
        const remote = { characters: [{ chaId: 'a' }], loreBook: [], chatMetadata: [{ characterId: 'a', chatId: 'chat', previous: { localLore: [{ key: 'old' }], note: 'saved', isStreaming: true }, metadata: { note: 'saved', isStreaming: false } }] }
        const message = chat.message
        const result = applyLiveFileSnapshot(current, baseline, remote, state)
        expect(chat.localLore).toEqual([])
        expect(chat.note).toBe('unsaved')
        expect(chat.message).toBe(message)
        expect(chat.isStreaming).toBe(true)
        expect(current.characters[0].chats[0]).toBe(chat)
        expect(current.characters[0].chatPage).toBe(0)
        expect(baseline).toEqual(rawBaseline)
        expect(result.conflicts).toEqual([])
        chat.localLore.push({ key: 'new local' })
        applyLiveFileSnapshot(current, baseline, remote, state)
        expect(chat.localLore).toEqual([{ key: 'new local' }])
    })

    it('archives same-field conflicts with the chat identity and never hydrates unloaded stubs', () => {
        const current = { characters: [{ chaId: 'a', chats: [{ id: 'chat', localLore: [{ key: 'local' }], message: [] }, { id: 'stub', _stub: true, name: 'old' }] }], loreBook: [] }
        const baseline = { characters: [{ chaId: 'a' }], loreBook: [] }
        const result = applyLiveFileSnapshot(current, baseline, { ...baseline, chatMetadata: [
            { characterId: 'a', chatId: 'chat', previous: { localLore: [{ key: 'saved' }] }, metadata: {} },
            { characterId: 'a', chatId: 'stub', previous: { name: 'old', localLore: [{ key: 'saved' }] }, metadata: { name: 'new', localLore: [] } },
        ] }, new Map())
        expect(result.conflicts).toEqual([{ characterId: 'a', chatId: 'chat', field: 'localLore', localValue: [{ key: 'local' }] }])
        expect(current.characters[0].chats[1]).toEqual({ id: 'stub', _stub: true, name: 'new' })
    })

    it('leaves placeholder chats unloaded and uses the first full snapshot only as a baseline', () => {
        const chat = { id: 'chat', localLore: [{ key: 'local' }], message: [] }
        const placeholder = { id: 'stub', _placeholder: true, name: 'old', localLore: [], message: [] }
        const current = { characters: [{ chaId: 'a', chats: [chat, placeholder] }], loreBook: [] }
        const baseline = { characters: [{ chaId: 'a' }], loreBook: [] }
        const result = applyLiveFileSnapshot(current, baseline, { ...baseline, chatMetadata: [
            { characterId: 'a', chatId: 'chat', metadata: { localLore: [{ key: 'server' }] } },
            { characterId: 'a', chatId: 'stub', previous: { name: 'old' }, metadata: { name: 'new', localLore: [{ key: 'server' }] } },
        ] }, new Map())
        expect(result.conflicts).toEqual([])
        expect(chat.localLore).toEqual([{ key: 'local' }])
        expect(placeholder).toEqual({ id: 'stub', _placeholder: true, name: 'new', localLore: [], message: [] })
    })

    it('accepts a later deletion with the same result after lore was re-added, without replaying old revisions', () => {
        const chat = { id: 'chat', localLore: [{ key: 'old' }], message: [] }
        const current = { characters: [{ chaId: 'a', chats: [chat] }], loreBook: [] }
        const baseline = { characters: [{ chaId: 'a' }], loreBook: [] }
        const state = new Map()
        const remote = { ...baseline, chatMetadata: [{ characterId: 'a', chatId: 'chat', previous: { localLore: [{ key: 'old' }] }, metadata: { localLore: [] }, revision: 'first' }] }
        applyLiveFileSnapshot(current, baseline, remote, state)
        chat.localLore.push({ key: 'old' })
        applyLiveFileSnapshot(current, baseline, remote, state)
        expect(chat.localLore).toEqual([{ key: 'old' }])
        remote.chatMetadata[0].revision = 'second'
        applyLiveFileSnapshot(current, baseline, remote, state)
        expect(chat.localLore).toEqual([])
    })

    it('updates acknowledged stub metadata without leaking local lore into database patches', () => {
        const current = { characters: [{ chaId: 'a', chats: [{ id: 'chat', name: 'old', modules: ['old'], localLore: [], message: [] }] }], loreBook: [] }
        const baseline = { characters: [{ chaId: 'a', chats: [{ id: 'chat', name: 'old', modules: ['old'], _stub: true }] }], loreBook: [] }
        applyLiveFileSnapshot(current, baseline, { characters: [{ chaId: 'a' }], loreBook: [], chatMetadata: [{
            characterId: 'a', chatId: 'chat', previous: { name: 'old', modules: ['old'] }, metadata: { name: 'new', localLore: [{ key: 'new' }] }, revision: 'next',
        }] }, new Map())
        expect(baseline.characters[0].chats[0]).toEqual({ id: 'chat', name: 'new', _stub: true })
        expect(current.characters[0].chats[0]).toMatchObject({ name: 'new', modules: [], localLore: [{ key: 'new' }], message: [] })
    })

    it('catches up missed chat changes without replacing newer local edits after an unrelated adoption', () => {
        const chat = { id: 'chat', localLore: [{ key: 'old' }], note: 'old', message: [] }
        const current = { characters: [{ chaId: 'a', chats: [chat] }], loreBook: [] }
        const baseline = { characters: [{ chaId: 'a' }], loreBook: [] }
        const state = new Map()
        applyLiveFileSnapshot(current, baseline, { ...baseline, chatMetadata: [{
            characterId: 'a', chatId: 'chat', metadata: { localLore: [{ key: 'old' }], note: 'old' }, revision: 'first',
        }] }, state)
        chat.note = 'new unsaved'
        const result = applyLiveFileSnapshot(current, baseline, { ...baseline, chatMetadata: [{
            characterId: 'a', chatId: 'chat', previous: { localLore: [], note: 'external' }, metadata: { localLore: [], note: 'external' }, revision: 'third',
        }] }, state)
        expect(chat.localLore).toEqual([])
        expect(chat.note).toBe('new unsaved')
        expect(result.conflicts).toEqual([])
    })
})

describe('live file refresh serialization', () => {
    it('waits for an ongoing save and serializes simultaneous preflight and polling refreshes', async () => {
        let finishSave!: () => void
        let inFlight: Promise<void> | null = new Promise(resolve => { finishSave = resolve })
        const calls: string[] = []
        let finishFirst!: () => void
        const first = new Promise<void>(resolve => { finishFirst = resolve })
        const refresh = createLiveFileRefresh({
            getInFlight: () => inFlight, setInFlight: value => { inFlight = value }, isActive: () => true,
            sync: async () => { calls.push('sync'); if (calls.length === 1) await first },
        })
        const poll = refresh()
        const send = refresh()
        expect(calls).toEqual([])
        const pendingSave = inFlight
        inFlight = null
        finishSave()
        await pendingSave
        await Promise.resolve()
        expect(calls).toEqual(['sync'])
        finishFirst()
        await Promise.all([poll, send])
        expect(calls).toEqual(['sync', 'sync'])
        expect(inFlight).toBeNull()
    })

    it('retries after a rejected operation and never syncs a retired runtime', async () => {
        let active = true
        let inFlight: Promise<void> | null = null
        let calls = 0
        const refresh = createLiveFileRefresh({
            getInFlight: () => inFlight, setInFlight: value => { inFlight = value }, isActive: () => active,
            sync: async () => { if (++calls === 1) throw new Error('invalid JSON') },
        })
        await expect(refresh()).rejects.toThrow('invalid JSON')
        await refresh()
        active = false
        await refresh()
        expect(calls).toBe(2)
        expect(inFlight).toBeNull()
    })
})

describe('live file metadata reconciliation', () => {
    it('preserves hydrated defaults absent from both canonical snapshots without putting them in the hash baseline', () => {
        const baseline = { characters: [{ chaId: 'a', desc: 'old' }], loreBook: [] }
        const current = { characters: [{ chaId: 'a', desc: 'old', emotionImages: [], globalLore: [], chats: [] }], loreBook: [] }
        applyLiveFileSnapshot(current, baseline, { characters: [{ chaId: 'a', desc: 'new' }], loreBook: [] })
        expect(current.characters[0]).toMatchObject({ desc: 'new', emotionImages: [], globalLore: [], chats: [] })
        expect(baseline.characters[0]).toEqual({ chaId: 'a', desc: 'new' })
    })
    it('applies external changes and deletions without replacing live chats or unrelated unsaved fields', () => {
        const chat = { id: 'chat', message: [{ data: 'streaming' }] }
        const baseline = { characters: [{ chaId: 'a', desc: 'old', name: 'old name', globalLore: [{ key: 'old' }], chats: [] }], loreBook: [] }
        const current = { characters: [{ ...baseline.characters[0], name: 'local name', chats: [chat], chatPage: 2 }], loreBook: [] }
        const character = current.characters[0]
        const result = applyLiveFileSnapshot(current, baseline, { characters: [{ chaId: 'a', desc: 'external', name: 'old name' }], loreBook: [] })
        expect(current.characters[0]).toBe(character)
        expect(character.chats[0]).toBe(chat)
        expect(character.chatPage).toBe(2)
        expect(character.desc).toBe('external')
        expect(character.name).toBe('local name')
        expect(character.globalLore).toEqual([])
        expect(baseline.characters[0]).not.toHaveProperty('globalLore')
        expect(result.conflicts).toEqual([])
        expect(baseline.characters[0].desc).toBe('external')
        expect(baseline.characters[0].name).toBe('old name')
    })

    it('keeps recoverable local values when the same field is externally replaced', () => {
        const baseline = { characters: [{ chaId: 'a', desc: 'old' }], loreBook: [] }
        const current = { characters: [{ chaId: 'a', desc: 'local' }], loreBook: [] }
        const result = applyLiveFileSnapshot(current, baseline, { characters: [{ chaId: 'a', desc: 'external' }], loreBook: [] })
        expect(current.characters[0].desc).toBe('external')
        expect(result.conflicts).toEqual([{ characterId: 'a', field: 'desc', localValue: 'local' }])
    })

    it('uses safe runtime defaults for removed required metadata without changing the raw baseline', () => {
        const baseline = { characters: [{ chaId: 'a', desc: 'old', name: 'old', additionalAssets: [['x']], emotionImages: [['happy']] }], loreBook: [] }
        const current = structuredClone(baseline)
        applyLiveFileSnapshot(current, baseline, { characters: [{ chaId: 'a' }], loreBook: [] })
        expect(current.characters[0]).toEqual({ chaId: 'a', desc: '', name: '', additionalAssets: [], emotionImages: [] })
        expect(baseline.characters[0]).toEqual({ chaId: 'a' })
    })

    it('does not revert local edits when the server field did not change, and applies root lore deletion', () => {
        const baseline = { characters: [{ chaId: 'a', desc: 'old' }], loreBook: [{ name: 'book' }] }
        const current = { characters: [{ chaId: 'a', desc: 'local' }], loreBook: [{ name: 'book' }] }
        applyLiveFileSnapshot(current, baseline, { characters: [{ chaId: 'a', desc: 'old' }], loreBook: [] })
        expect(current.characters[0].desc).toBe('local')
        expect(current.loreBook).toEqual([])
    })

    it('replaces modules only when the snapshot carries them', () => {
        const modules = [{ id: 'm', name: 'World', lorebook: [{ content: 'old' }] }]
        const baseline: any = { characters: [], loreBook: [], modules: structuredClone(modules) }
        const current: any = { characters: [], loreBook: [], modules: structuredClone(modules) }
        applyLiveFileSnapshot(current, baseline, { characters: [], loreBook: [] })
        expect(current.modules).toEqual(modules)
        const incoming = [{ id: 'm', name: 'World', lorebook: [{ content: 'new' }] }]
        const result = applyLiveFileSnapshot(current, baseline, { characters: [], loreBook: [], modules: incoming })
        expect(current.modules[0].lorebook[0].content).toBe('new')
        expect(current.modules).not.toBe(incoming)
        expect(baseline.modules).toEqual(incoming)
        expect(result.conflicts).toEqual([])
    })
})
