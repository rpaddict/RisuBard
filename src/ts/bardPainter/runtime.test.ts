import { beforeEach, expect, it, vi } from 'vitest'
import { createPainterChatData } from './types'
import type { PainterGenerationSettings } from './types'
import { zipSync } from 'fflate'
import { get } from 'svelte/store'
import { painterSelection, painterInsertionRequest } from './selectionState'
import { savePainterGalleryRecord } from './gallery'
const mocks = vi.hoisted(() => ({ db: { characters: [] as any[], bardPainterStyles: [], NAIApiKey: 'test-key', NAIImgUrl: 'https://image.novelai.net/ai/generate-image' }, save: vi.fn(), request: vi.fn(), fetch: vi.fn(), asset: vi.fn(), readAsset: vi.fn(), compress: vi.fn(), wiki: vi.fn(), hydrate: vi.fn() }))
vi.mock('../stores.svelte', () => ({ DBState: { db: mocks.db }, ReloadChatPointer: { update: vi.fn() } }))
vi.mock('../globalApi.svelte', () => ({ requestImmediateSave: mocks.save, globalFetch: mocks.fetch, forageStorage: { createAuth: vi.fn() } }))
vi.mock('../process/request/request', () => ({ requestChatData: mocks.request }))
vi.mock('../loreBuilder', () => ({ collectLoreBuilderSources: () => ({ systemPrompt: 'system', characterDescription: 'desc', characterLorebook: 'lore', moduleLorebook: 'modules' }) }))
vi.mock('../risubard/memoryWiki', () => ({ loadNarrativeMemoryWiki: mocks.wiki }))
vi.mock('../process/files/inlays', () => ({ setInlayAsset: mocks.asset, getInlayAssetBlob: mocks.readAsset }))
vi.mock('./image', () => ({ compressPainterImage: mocks.compress }))
vi.mock('./gallery', () => ({ savePainterGalleryRecord: vi.fn().mockResolvedValue(undefined) }))
vi.mock('./reference', () => ({ loadPainterReference: vi.fn() }))
import { loadPainterReference } from './reference'
vi.mock('../storage/chatStorage', () => ({ ensureChatHydrated: mocks.hydrate }))
import { getPainterSession, PainterSession } from './runtime.svelte'
let serial = 0
it('falls back to the configured default after a style disappears', async () => {
    const { session } = setup()
    const favorite = await session.saveStyle({ ...session.style, name: 'Favorite' }, true)
    await session.setDefaultStyle(favorite!)
    const removed = await session.saveStyle({ ...session.style, name: 'Temporary' }, true)
    expect(await session.removeStyle(removed!)).toBe(true)
    expect(session.style.id).toBe(favorite)
    session.data.settings.styleId = 'missing-imported-style'
    expect(session.style.id).toBe(favorite)
    await session.setDefaultStyle('default')
})
it('uses the saved default style for new work while retaining existing choices', async () => {
    const { session } = setup()
    const id = await session.saveStyle({ ...session.style, name: 'Favorite' }, true)
    expect(await session.setDefaultStyle(id!)).toBe(true)
    expect(session.defaultStyle.id).toBe(id)
    const other = new PainterSession('bot', 'other')
    expect(other.style.id).toBe(id)
    other.data.settings.styleId = 'default'
    expect(new PainterSession('bot', 'other').style.id).toBe('default')
    expect(await session.resetWorkspace()).toBe(true)
    expect(session.style.id).toBe(id)
    mocks.save.mockRejectedValueOnce(new Error('disk full'))
    expect(await session.setDefaultStyle('default')).toBe(false)
    expect(session.defaultStyle.id).toBe(id)
    expect(await session.removeStyle(id!)).toBe(true)
    expect(session.defaultStyle.id).toBe('default')
    expect(session.style.id).toBe('default')
})
it('sets all saved card attachments in one save and rolls both lists back on failure', async () => {
    const { session } = setup()
    session.bot.identities = [{ id: 'a', name: 'A', aliases: [], appearance: 'blue eyes' }, { id: 'b', name: 'B', aliases: [], appearance: 'red hair' }]
    session.bot.outfits = [{ id: 'coat', subjectId: 'a', name: 'Coat', clothing: 'coat', state: '' }]
    session.data.outfits = [{ id: 'local', subjectId: 'b', name: 'Local', clothing: 'shirt', state: '' }]
    const local = JSON.stringify(session.data.outfits)
    mocks.save.mockClear()
    expect(await session.setAllCardAttachments(true)).toBe(true)
    expect([...session.bot.identities, ...session.bot.outfits].every(item => item.attachToCard === true)).toBe(true)
    expect(mocks.save).toHaveBeenCalledOnce()
    expect(JSON.stringify(session.data.outfits)).toBe(local)
    mocks.save.mockRejectedValueOnce(new Error('disk full'))
    expect(await session.setAllCardAttachments(false)).toBe(false)
    expect([...session.bot.identities, ...session.bot.outfits].every(item => item.attachToCard === true)).toBe(true)
    expect(await session.setAllCardAttachments(false)).toBe(true)
    expect([...session.bot.identities, ...session.bot.outfits].every(item => item.attachToCard !== true)).toBe(true)
    session.state.status = 'prompt'
    expect(await session.setAllCardAttachments(true)).toBe(false)
})
it('keeps attachment choices on overwrite but makes copied presets private', async () => {
    const { session } = setup()
    const identity = { id: 'person', name: 'Public', aliases: [], appearance: 'blue eyes', attachToCard: true }
    await session.saveIdentity(identity)
    expect(session.bot.identities[0].attachToCard).toBe(true)
    const copied = await session.saveIdentity({ ...identity, name: 'Private copy' }, true)
    expect(session.bot.identities.find(item => item.id === copied)?.attachToCard).not.toBe(true)
    const outfit = { id: 'coat', subjectId: 'person', name: 'Coat', clothing: 'blue coat', state: '', attachToCard: true }
    await session.saveOutfitPreset(outfit, true)
    expect(session.bot.outfits[0].attachToCard).toBe(true)
    const copiedOutfit = await session.saveOutfitPreset({ ...outfit, name: 'Copy' }, true, true)
    expect(session.bot.outfits.find(item => item.id === copiedOutfit)?.attachToCard).not.toBe(true)
    await session.saveIdentity({ ...identity, attachToCard: false })
    expect(session.bot.identities[0].attachToCard).not.toBe(true)
})
it('uses the captured chat persona for first-person and does not restore its locked user block', async () => {
    const { session, chat } = setup()
    session.character.personas = [{ id: 'viewer', name: '하린' }] as any
    Object.assign(chat, { bindedPersona: 'viewer' })
    session.character.chatPage = 1
    session.data.settings.perspective = 'first-person'
    const subject = { id: 'viewer-block', name: '하린', aliases: [], kind: 'character' as const, appearance: 'black hair', clothing: '', state: '', pose: '', negative: '', locked: true }
    session.data.draft!.subjects = [subject, { ...subject, id: 'other-block', name: '아리아' }]
    mocks.request.mockResolvedValue({ type: 'success', result: JSON.stringify({ rendering: '', scene: 'pov, garden', negative: '', subjects: [] }) })
    await session.prepare()
    expect(session.state.error).toBe('')
    const payload = JSON.parse(mocks.request.mock.calls[0][0].formated[1].content)
    expect(payload.viewpoint).toEqual({ mode: 'first-person', userName: '하린' })
    expect(session.data.draft!.subjects.map(item => item.name)).toEqual(['아리아'])
    expect(new PainterSession('bot', chat.id).settings.perspective).toBe('first-person')
})
it('removes viewer-linked scene-plan relations before saving first-person prompt blocks', async () => {
    const { session, chat } = setup()
    session.character.personas = [{ id: 'viewer', name: '하린' }] as any
    Object.assign(chat, { bindedPersona: 'viewer' })
    session.data.settings.perspective = 'first-person'
    const subject = { id: '', name: '하린', aliases: [], kind: 'character', appearance: 'black hair', clothing: '', state: '', negative: '',
        pose: { tags: 'standing', placement: '', posture: '', action: '', expression: '', gaze: '' } }
    mocks.request.mockResolvedValue({ type: 'success', result: JSON.stringify({ version: 2, rendering: '', negative: '',
        scene: { tags: 'pov', location: 'A garden.', framing: '', camera: '' },
        subjects: [subject, { ...subject, name: '아리아' }],
        interactions: [{ source: 0, target: 1, description: 'The viewer embraces the woman.', sourceAction: 'Embracing the woman.', targetAction: 'Leaning against the viewer.' }],
    }) })
    await session.prepare()
    expect(session.state.error).toBe('')
    expect(session.data.draft!.scene).toBe('pov\nA garden.')
    expect(session.data.draft!.subjects.map(item => ({ name: item.name, pose: item.pose }))).toEqual([{ name: '아리아', pose: 'standing' }])
})
it('shares generation defaults, keeps scene inputs local, and persists bot pinning across sessions', async () => {
    const db = mocks.db as typeof mocks.db & { bardPainterSettings?: PainterGenerationSettings }
    const { session } = setup()
    const other = new PainterSession('bot', 'other')
    session.data.settings.instruction = 'local request'
    session.data.settings.context.wikiIds = ['local wiki']
    session.data.settings.context.referenceAssetId = 'local image'
    try {
        await session.updateGenerationSettings({ ...session.settings, width: 1024, height: 1024 })
        await session.applyGenerationSettingsToGlobal()
        expect(other.settings.width).toBe(1024)
        expect(other.settings.instruction).toBe('')
        expect(other.settings.context.wikiIds).toEqual([])
        expect(other.settings.context.referenceAssetId).toBeUndefined()
        await session.pinGenerationSettings(true)
        await other.updateGenerationSettings({ ...other.settings, width: 1216, height: 832 })
        expect(new PainterSession('bot', session.chatId).settings.width).toBe(1216)
        expect(db.bardPainterSettings?.width).toBe(1024)
        await session.useGlobalGenerationSettings()
        expect(session.generationSettingsPinned).toBe(true)
        expect(other.settings.width).toBe(1024)
        await session.pinGenerationSettings(false)
        await session.updateGenerationSettings({ ...session.settings, width: 832, height: 1216 })
        expect(other.settings.width).toBe(1024)
        expect(session.settings.width).toBe(832)
        await session.useGlobalGenerationSettings()
        expect(session.settings.width).toBe(1024)
        expect(session.settings.instruction).toBe('local request')
        expect(session.settings.context.wikiIds).toEqual(['local wiki'])
        expect(session.settings.context.referenceAssetId).toBe('local image')
        expect(mocks.save).toHaveBeenCalled()
        const restored = JSON.parse(JSON.stringify(db))
        expect(restored.bardPainterSettings.width).toBe(1024)
        expect(restored.characters[0].chats[0].bardPainter.settingsScope).toBe('global')
    } finally { delete db.bardPainterSettings }
})

it('preserves legacy chat settings until global inheritance is explicitly selected', async () => {
    const { session } = setup()
    delete session.data.settingsScope
    session.data.settings.width = 1216
    const db = mocks.db as typeof mocks.db & { bardPainterSettings?: PainterGenerationSettings }
    db.bardPainterSettings = { ...session.settings, width: 1024 }
    try {
        expect(session.settings.width).toBe(1216)
        await session.useGlobalGenerationSettings()
        expect(session.settings.width).toBe(1024)
    } finally { delete db.bardPainterSettings }
})

function setup() {
    const id = `chat-${++serial}`
    const data = createPainterChatData()
    data.anchor = { characterId: 'bot', chatId: id, messageId: 'm1', start: 2, end: 4, text: '장면' }
    data.draft = { rendering: '', scene: '1girl, indoors', negative: '', subjects: [] }
    const chat = { id, message: [{ chatId: 'm1', data: '앞 장면 뒤', swipes: ['앞 장면 뒤', '다른 후보'], swipeId: 0 }], bardPainter: data }
    mocks.db.characters = [{ chaId: 'bot', chatPage: 0, chats: [chat, { id: 'other', message: [{ chatId: 'm1', data: '다른 챗' }] }] }]
    return { session: getPainterSession('bot', id), chat }
}
beforeEach(() => { vi.resetAllMocks(); mocks.save.mockResolvedValue(undefined); mocks.hydrate.mockImplementation(async (chats, index) => chats[index]); mocks.db.bardPainterStyles = []; Object.assign(mocks.db, { bardPainterDefaultStyleId: undefined }); painterSelection.set(null); painterInsertionRequest.set(null) })

it('resets only current painter work after preserving gallery records, retaining settings and presets', async () => {
    const { session, chat } = setup()
    const prior = session.data
    prior.previousDraft = { ...prior.draft! }
    prior.conversation = [{ id: 'old', role: 'user', text: 'request' }]
    prior.settings.instruction = 'unsent request'
    prior.settings.context.referenceId = 'legacy'
    prior.settings.context.referenceAssetId = 'reference'
    prior.outfits = [{ id: 'coat', subjectId: 'person', name: 'Coat', clothing: 'blue coat', state: '' }]
    prior.results.push({ id: 'r', assetId: 'asset', createdAt: 1, anchor: prior.anchor!, draft: prior.draft!, settings: prior.settings, style: session.style, seed: 1 })
    session.bot.identities.push({ id: 'person', name: 'Person', aliases: [], appearance: 'black hair' })
    session.state.sources = [{ name: 'old', content: 'old reference' }]
    painterSelection.set({ characterId: 'bot', chatId: chat.id, anchor: prior.anchor })
    painterInsertionRequest.set({ characterId: 'bot', chatId: chat.id, resultId: 'r', insert: async () => true })
    vi.mocked(savePainterGalleryRecord).mockImplementationOnce(async () => { expect(session.data.results).toHaveLength(1); expect(mocks.save).not.toHaveBeenCalled() })
    expect(await session.resetWorkspace()).toBe(true)
    expect(savePainterGalleryRecord).toHaveBeenCalledWith(prior.results[0], '')
    expect(session.data).toEqual({ ...prior, anchor: undefined, draft: undefined, previousDraft: undefined, conversation: [], results: [], settings: { ...prior.settings, instruction: '', context: { ...prior.settings.context, referenceId: '', referenceAssetId: '' } } })
    expect(session.bot.identities).toHaveLength(1)
    expect(session.state.sources).toEqual([])
    expect(get(painterSelection)).toBeNull()
    expect(get(painterInsertionRequest)).toBeNull()
    expect(mocks.db.characters[0].chats[1].bardPainter).toBeUndefined()
    expect(new PainterSession('bot', chat.id).data.results).toEqual([])
})

it.each(['gallery', 'save'])('retains all work and placement when reset %s persistence fails', async failure => {
    const { session, chat } = setup()
    session.data.results.push({ id: 'r', assetId: 'asset', createdAt: 1, anchor: session.data.anchor!, draft: session.data.draft!, settings: session.data.settings, style: session.style, seed: 1 })
    const prior = JSON.parse(JSON.stringify(session.data))
    painterSelection.set({ characterId: 'bot', chatId: chat.id, anchor: session.data.anchor })
    painterInsertionRequest.set({ characterId: 'bot', chatId: chat.id, resultId: 'r', insert: async () => true })
    if (failure === 'gallery') vi.mocked(savePainterGalleryRecord).mockRejectedValueOnce(new Error('disk full'))
    else mocks.save.mockRejectedValueOnce(new Error('disk full'))
    expect(await session.resetWorkspace()).toBe(false)
    expect(session.data).toEqual(prior)
    expect(get(painterSelection)?.chatId).toBe(chat.id)
    expect(get(painterInsertionRequest)?.resultId).toBe('r')
    expect(session.state.error).toContain('disk full')
    expect(session.state.status).toBe('idle')
})

it.each(['prompt', 'image', 'saving', 'pending', 'streaming'])('does not reset while %s work is active', async mode => {
    const { session, chat } = setup()
    if (mode === 'pending') session.state.pendingImage = true
    else if (mode === 'streaming') Object.assign(chat, { isStreaming: true })
    else session.state.status = mode as 'prompt' | 'image' | 'saving'
    expect(await session.resetWorkspace()).toBe(false)
    expect(session.data.draft).toBeDefined()
    expect(mocks.save).not.toHaveBeenCalled()
})

it('keeps a pending reset bound to its chat and preserves another chats selection', async () => {
    const { session } = setup()
    let finish!: () => void
    mocks.save.mockImplementationOnce(() => new Promise<void>(resolve => finish = resolve))
    const pending = session.resetWorkspace()
    await vi.waitFor(() => expect(mocks.save).toHaveBeenCalledOnce())
    expect(await session.resetWorkspace()).toBe(false)
    painterSelection.set({ characterId: 'bot', chatId: 'other' })
    painterInsertionRequest.set({ characterId: 'bot', chatId: 'other', resultId: 'other', insert: async () => true })
    mocks.db.characters[0].chatPage = 1
    finish()
    expect(await pending).toBe(true)
    expect(get(painterSelection)?.chatId).toBe('other')
    expect(get(painterInsertionRequest)?.chatId).toBe('other')
    expect(mocks.db.characters[0].chats[1].bardPainter).toBeUndefined()
})

it('sets a validated gallery reference on the captured chat and clears its legacy selection', async () => {
    const { session, chat } = setup()
    session.data.settings.context.referenceId = 'legacy-result'
    vi.mocked(loadPainterReference).mockResolvedValue('{"prompt":"blue coat"}')
    expect(await session.setReference('gallery-asset')).toBe(true)
    expect(loadPainterReference).toHaveBeenCalledWith('gallery-asset', 'bot')
    expect(chat.bardPainter.settings.context).toMatchObject({ referenceAssetId: 'gallery-asset', referenceId: '' })
    expect(mocks.db.characters[0].chats[1].bardPainter).toBeUndefined()
    expect(mocks.save).toHaveBeenCalledOnce()
    expect(mocks.request).not.toHaveBeenCalled()
})

it('clears the reference slot without validating the old asset', async () => {
    const { session } = setup()
    Object.assign(session.data.settings.context, { referenceAssetId: 'old-image', referenceId: 'old-result' })
    expect(await session.setReference('')).toBe(true)
    expect(session.data.settings.context).toMatchObject({ referenceAssetId: '', referenceId: '' })
    expect(loadPainterReference).not.toHaveBeenCalled()
})

it('keeps the slot intact for an unusable reference or a failed save', async () => {
    const { session } = setup()
    Object.assign(session.data.settings.context, { referenceAssetId: 'old-image', referenceId: 'old-result' })
    vi.mocked(loadPainterReference).mockResolvedValueOnce(null)
    expect(await session.setReference('invalid-image')).toBe(false)
    expect(mocks.save).not.toHaveBeenCalled()
    vi.mocked(loadPainterReference).mockResolvedValueOnce('reference prompt')
    mocks.save.mockRejectedValueOnce(new Error('disk full'))
    expect(await session.setReference('new-image')).toBe(false)
    expect(session.data.settings.context).toMatchObject({ referenceAssetId: 'old-image', referenceId: 'old-result' })
    expect(session.state.status).toBe('idle')
})

it('locks reference mutations across dialogs and never redirects a pending save to a newly active chat', async () => {
    const { session } = setup()
    let finish!: (value: string) => void
    vi.mocked(loadPainterReference).mockImplementationOnce(() => new Promise(resolve => finish = resolve))
    const pending = session.setReference('new-image')
    await vi.waitFor(() => expect(loadPainterReference).toHaveBeenCalledOnce())
    expect(session.state.status).toBe('saving')
    expect(await session.setReference('')).toBe(false)
    mocks.db.characters[0].chatPage = 1
    finish('reference prompt')
    expect(await pending).toBe(true)
    expect(session.data.settings.context.referenceAssetId).toBe('new-image')
    expect(mocks.db.characters[0].chats[1].bardPainter).toBeUndefined()
})

it('loads the selected gallery image context and stops before AI if its information is unavailable', async () => {
    const { session } = setup()
    session.data.settings.context.referenceAssetId = 'cross-chat-image'
    vi.mocked(loadPainterReference).mockResolvedValueOnce(null)
    expect(await session.prepare(session.data.anchor)).toBe(false)
    expect(loadPainterReference).toHaveBeenCalledWith('cross-chat-image', 'bot')
    expect(session.state.error).toContain('참고 그림')
    expect(mocks.request).not.toHaveBeenCalled()
    vi.mocked(loadPainterReference).mockResolvedValueOnce('{"characters":[{"name":"Aria","prompt":"blue coat"}]}')
    await session.prepare(session.data.anchor)
    expect(JSON.stringify(mocks.request.mock.calls)).toContain('blue coat')
})

it('saves a style copy under a new ID and overwrites only the chosen custom style', async () => {
    const { session } = setup()
    const defaultStyle = { ...session.style }
    const originalId = await session.saveStyle({ ...defaultStyle, name: '  펜화  ', artist: 'ink drawing' })
    expect(originalId).toBeTruthy()
    expect(originalId).not.toBe(defaultStyle.id)
    const copiedId = await session.saveStyle({ ...session.style, name: '수채화' }, true)
    expect(copiedId).not.toBe(originalId)
    expect(session.styles.map(item => item.name)).toContain('펜화')
    expect(await session.saveStyle({ ...session.style, name: '수채화 수정', artist: 'watercolor' })).toBe(copiedId)
    expect(mocks.db.bardPainterStyles).toHaveLength(2)
    expect(session.styles.find(item => item.id === originalId)?.artist).toBe('ink drawing')
    expect(session.styles[0]).toEqual(defaultStyle)
})

it('reorders custom styles, resets hydrated selections on removal and retains generation snapshots', async () => {
    const { session } = setup()
    const a = await session.saveStyle({ ...session.style, name: 'A' })
    const b = await session.saveStyle({ ...session.style, name: 'B' }, true)
    const other = createPainterChatData()
    other.settings.styleId = a!
    mocks.db.characters[0].chats[1].bardPainter = other
    const snapshot = { ...session.styles.find(item => item.id === a)! }
    session.data.results.push({ id: 'r', assetId: 'asset', createdAt: 1, anchor: { ...session.data.anchor! }, draft: session.data.draft!, settings: { ...session.data.settings }, style: snapshot, seed: 1 })
    expect(await session.moveStyle(b!, -1)).toBe(true)
    expect(session.styles.map(item => item.id)).toEqual(['default', b, a])
    expect(await session.moveStyle('default', 1)).toBe(false)
    expect(await session.removeStyle(a!)).toBe(true)
    expect(other.settings.styleId).toBe('default')
    expect(session.data.settings.styleId).toBe(b)
    expect(session.data.results[0].style).toEqual(snapshot)
    expect(await session.removeStyle('default')).toBe(false)
})

it('restores style order and all changed selections when persistence fails', async () => {
    const { session } = setup()
    const id = await session.saveStyle({ ...session.style, name: '기존' })
    const prior = JSON.parse(JSON.stringify(mocks.db.bardPainterStyles))
    mocks.save.mockRejectedValueOnce(new Error('disk full'))
    expect(await session.saveStyle({ ...session.style, name: '복사 실패' }, true)).toBeUndefined()
    expect(mocks.db.bardPainterStyles).toEqual(prior)
    expect(session.data.settings.styleId).toBe(id)
    mocks.save.mockRejectedValueOnce(new Error('disk full'))
    expect(await session.removeStyle(id!)).toBe(false)
    expect(mocks.db.bardPainterStyles).toEqual(prior)
    expect(session.data.settings.styleId).toBe(id)
    expect(session.state.status).toBe('idle')
})

it('copies only identity fields while overwrite keeps outfit ownership and ordering', async () => {
    const { session } = setup()
    const id = await session.saveIdentity({ id: 'person', name: '  아리아  ', aliases: [' Aria ', '', 'Aria'], appearance: 'blue eyes' })
    await session.saveOutfitPreset({ id: 'coat', subjectId: id!, name: '코트', clothing: 'blue coat', state: '' }, true)
    const copyId = await session.saveIdentity({ ...session.bot.identities[0], name: '아리아 복사' }, true)
    expect(copyId).not.toBe(id)
    expect(session.bot.identities[0].name).toBe('아리아')
    expect(session.bot.identities[0].aliases).toEqual(['Aria'])
    expect(session.bot.outfits).toHaveLength(1)
    expect(session.bot.outfits[0].subjectId).toBe(id)
    expect(await session.saveIdentity({ ...session.bot.identities[0], appearance: 'green eyes' })).toBe(id)
    expect(session.bot.outfits[0].subjectId).toBe(id)
    expect(await session.moveIdentity(copyId!, -1)).toBe(true)
    expect(session.bot.identities.map(item => item.id)).toEqual([copyId, id])
})

it('hydrates every chat before deleting one identity and its outfits without changing old drafts', async () => {
    const { session } = setup()
    const person = { id: 'person', name: '아리아', aliases: [], appearance: 'blue eyes' }
    session.bot.identities.push(person, { ...person, id: 'other-person', name: '미라' })
    const outfit = { id: 'coat', subjectId: person.id, name: '코트', clothing: 'blue coat', state: '' }
    session.bot.outfits.push(outfit)
    session.data.outfits.push({ ...outfit, id: 'local' })
    session.data.draft!.subjects.push({ ...person, kind: 'character', clothing: 'blue coat', state: '', pose: '', negative: '' })
    const remote = { id: 'unloaded', _placeholder: true, message: [] }
    mocks.db.characters[0].chats.push(remote)
    const hydrated = { id: remote.id, message: [], bardPainter: createPainterChatData() }
    hydrated.bardPainter.outfits.push({ ...outfit, id: 'remote' }, { ...outfit, id: 'unrelated', subjectId: 'other-person' })
    mocks.hydrate.mockImplementation(async (chats, index) => {
        if (chats[index] === remote) chats[index] = hydrated
        return chats[index]
    })
    expect(await session.removeIdentity(person.id)).toBe(true)
    expect(mocks.hydrate).toHaveBeenCalledWith(mocks.db.characters[0].chats, 2, 'bot')
    expect(session.bot.identities.map(item => item.id)).toEqual(['other-person'])
    expect(session.bot.outfits).toEqual([])
    expect(session.data.outfits).toEqual([])
    expect(hydrated.bardPainter.outfits.map(item => item.id)).toEqual(['unrelated'])
    expect(session.data.draft!.subjects[0].id).toBe(person.id)
})

it('cancels identity deletion on hydration or save failure without partial preset removal', async () => {
    const { session } = setup()
    const person = { id: 'person', name: '아리아', aliases: [], appearance: '' }
    session.bot.identities.push(person)
    session.data.outfits.push({ id: 'coat', subjectId: person.id, name: '코트', clothing: 'blue coat', state: '' })
    mocks.db.characters[0].chats.push({ id: 'unloaded', _placeholder: true, message: [] })
    mocks.hydrate.mockResolvedValueOnce(null)
    expect(await session.removeIdentity(person.id)).toBe(false)
    expect(session.bot.identities).toHaveLength(1)
    expect(session.data.outfits).toHaveLength(1)
    expect(mocks.save).not.toHaveBeenCalled()
    mocks.db.characters[0].chats.pop()
    mocks.save.mockRejectedValueOnce(new Error('disk full'))
    expect(await session.removeIdentity(person.id)).toBe(false)
    expect(session.bot.identities).toHaveLength(1)
    expect(session.data.outfits).toHaveLength(1)
})

it('copies, overwrites and reorders outfits within their owner and storage scope', async () => {
    const { session } = setup()
    session.bot.identities.push({ id: 'a', name: '아리아', aliases: [], appearance: '' }, { id: 'b', name: '미라', aliases: [], appearance: '' })
    const outfit = { id: 'coat', subjectId: 'a', name: '코트', clothing: 'blue coat', state: '' }
    const first = await session.saveOutfitPreset(outfit, false)
    const unrelated = await session.saveOutfitPreset({ ...outfit, id: 'other', subjectId: 'b' }, false)
    const second = await session.saveOutfitPreset({ ...outfit, id: first!, name: '  여행 코트  ' }, false, true)
    const shared = await session.saveOutfitPreset({ ...outfit, id: first! }, true, true)
    expect(second).not.toBe(first)
    expect(shared).not.toBe(first)
    expect(await session.saveOutfitPreset({ ...outfit, id: first!, clothing: 'white coat' }, false)).toBe(first)
    expect(session.bot.outfits[0].clothing).toBe('blue coat')
    expect(await session.moveOutfit(second!, false, -1)).toBe(true)
    expect(session.data.outfits.map(item => item.id)).toEqual([second, unrelated, first])
    expect(session.data.outfits[0].name).toBe('여행 코트')
    expect(await session.moveOutfit(second!, false, -1)).toBe(false)
    expect(await session.removeOutfit(second!, false)).toBe(true)
    expect(session.bot.outfits[0].id).toBe(shared)
})

it('validates preset inputs and rolls back identity and outfit changes on save failure', async () => {
    const { session } = setup()
    expect(await session.saveIdentity({ id: '', name: ' ', aliases: [], appearance: '' })).toBeUndefined()
    expect(await session.saveOutfitPreset({ id: '', subjectId: 'missing', name: '코트', clothing: 'blue coat', state: '' }, false)).toBeUndefined()
    const id = await session.saveIdentity({ id: 'person', name: '아리아', aliases: [], appearance: 'blue eyes' })
    mocks.save.mockRejectedValueOnce(new Error('disk full'))
    expect(await session.saveIdentity({ ...session.bot.identities[0], name: '변경 실패' })).toBeUndefined()
    expect(session.bot.identities[0].name).toBe('아리아')
    await session.saveOutfitPreset({ id: 'coat', subjectId: id!, name: '코트', clothing: 'blue coat', state: '' }, false)
    mocks.save.mockRejectedValueOnce(new Error('disk full'))
    expect(await session.removeOutfit('coat', false)).toBe(false)
    expect(session.data.outfits[0].id).toBe('coat')
    mocks.save.mockRejectedValueOnce(new Error('disk full'))
    expect(await session.saveOutfitPreset({ ...session.data.outfits[0], clothing: 'red coat' }, false)).toBeUndefined()
    expect(session.data.outfits[0].clothing).toBe('blue coat')
})

it('refuses preset changes during generation or pending image recovery', async () => {
    const { session } = setup()
    session.state.status = 'image'
    expect(await session.saveStyle({ ...session.style, name: '바뀌면 안 됨' }, true)).toBeUndefined()
    session.state.status = 'idle'
    session.state.pendingImage = true
    expect(await session.saveIdentity({ id: 'person', name: '아리아', aliases: [], appearance: '' })).toBeUndefined()
    expect(mocks.db.bardPainterStyles).toEqual([])
    expect(session.bot.identities).toEqual([])
    expect(mocks.save).not.toHaveBeenCalled()
})

it('rejects duplicate names in their scope while allowing the same outfit name for another owner', async () => {
    const { session } = setup()
    expect(await session.saveStyle({ ...session.style }, true)).toBeUndefined()
    await session.saveStyle({ ...session.style, name: 'Ink' })
    expect(await session.saveStyle({ ...session.style, name: ' ink ' }, true)).toBeUndefined()
    const person = { id: '', name: 'Aria', aliases: [], appearance: '' }
    const id = await session.saveIdentity(person)
    expect(id).toBeTruthy()
    expect(await session.saveIdentity({ ...person, name: ' aria ' })).toBeUndefined()
    await session.saveIdentity({ ...person, id: 'other', name: 'Mira' })
    const outfit = { id: '', subjectId: id!, name: 'Coat', clothing: 'blue coat', state: '' }
    expect(await session.saveOutfitPreset(outfit, false)).toBeTruthy()
    expect(await session.saveOutfitPreset({ ...outfit, name: ' coat ' }, false)).toBeUndefined()
    expect(await session.saveOutfitPreset({ ...outfit, subjectId: 'other' }, false)).toBeTruthy()
    expect(await session.saveOutfitPreset(outfit, true)).toBeTruthy()
})

it('assigns a different ID when an outfit is newly saved in another scope', async () => {
    const { session } = setup()
    session.bot.identities.push({ id: 'person', name: '아리아', aliases: [], appearance: '' })
    const localId = await session.saveOutfitPreset({ id: 'coat', subjectId: 'person', name: '코트', clothing: 'blue coat', state: '' }, false)
    const sharedId = await session.saveOutfitPreset(session.data.outfits[0], true)
    expect(sharedId).toBeTruthy()
    expect(sharedId).not.toBe(localId)
})

it('rolls back all preset reordering when persistence fails', async () => {
    const { session } = setup()
    const a = await session.saveStyle({ ...session.style, name: 'A' })
    const b = await session.saveStyle({ ...session.style, name: 'B' }, true)
    session.bot.identities.push({ id: 'a', name: '아리아', aliases: [], appearance: '' }, { id: 'b', name: '미라', aliases: [], appearance: '' })
    session.data.outfits.push({ id: 'one', subjectId: 'a', name: '하나', clothing: 'coat', state: '' }, { id: 'two', subjectId: 'a', name: '둘', clothing: 'shirt', state: '' })
    mocks.save.mockRejectedValue(new Error('disk full'))
    expect(await session.moveStyle(b!, -1)).toBe(false)
    expect(await session.moveIdentity('b', -1)).toBe(false)
    expect(await session.moveOutfit('two', false, -1)).toBe(false)
    expect(session.styles.map(item => item.id)).toEqual(['default', a, b])
    expect(session.bot.identities.map(item => item.id)).toEqual(['a', 'b'])
    expect(session.data.outfits.map(item => item.id)).toEqual(['one', 'two'])
})

it('rechecks other chat generation after hydration before deleting shared presets', async () => {
    const { session } = setup()
    session.bot.identities.push({ id: 'person', name: '아리아', aliases: [], appearance: '' })
    const otherSession = getPainterSession('bot', 'other')
    otherSession.state.status = 'idle'
    mocks.hydrate.mockImplementationOnce(async (chats, index) => {
        otherSession.state.status = 'prompt'
        return chats[index]
    })
    try {
        expect(await session.removeIdentity('person')).toBe(false)
        expect(session.bot.identities).toHaveLength(1)
        expect(mocks.save).not.toHaveBeenCalled()
    } finally { otherSession.state.status = 'idle' }
})

it('uses saved personal presets alongside the neutral public default', () => {
    const { session } = setup()
    const custom = { ...session.style, id: 'saved-fixture', name: '사용자 화풍', artist: 'fixture-artist', rendering: 'fixture-rendering' }
    mocks.db.bardPainterStyles = [custom]
    session.data.settings.styleId = custom.id
    expect(session.style).toEqual(custom)
    expect(session.styles.find(style => style.id === 'default')?.artist).toBe('')
})
it('inserts into the saved chat and active swipe after current chat changes', async () => {
    const { session, chat } = setup()
    session.data.results.push({ id: 'r', assetId: 'asset', createdAt: 1, anchor: { ...session.data.anchor! }, draft: session.data.draft!, settings: session.data.settings, style: session.style, seed: 1 })
    mocks.db.characters[0].chatPage = 1
    await session.insert('r', 'after')
    expect(chat.message[0].data).toContain('장면\n\n{{inlay::asset}}')
    expect(chat.message[0].swipes[0]).toBe(chat.message[0].data)
    expect(chat.message[0].swipes[1]).toBe('다른 후보')
    expect(mocks.db.characters[0].chats[1].message[0].data).toBe('다른 챗')
})
it('rolls back text, swipe, result status and anchors if insertion cannot be saved', async () => {
    const { session, chat } = setup()
    session.data.results.push({ id: 'r', assetId: 'asset', createdAt: 1, anchor: { ...session.data.anchor! }, draft: session.data.draft!, settings: session.data.settings, style: session.style, seed: 1 })
    mocks.save.mockRejectedValueOnce(new Error('disk full'))
    await session.insert('r', 'before')
    expect(chat.message[0].data).toBe('앞 장면 뒤')
    expect(chat.message[0].swipes[0]).toBe('앞 장면 뒤')
    expect(session.data.anchor?.start).toBe(2)
    expect(session.data.results[0].inserted).toBeUndefined()
    expect(session.state.error).toContain('disk full')
})
it('prepares visible transformed text without fabricating surrounding source context', async () => {
    const { session } = setup()
    session.data.settings.context.surrounding = true
    mocks.request.mockResolvedValue({ type: 'success', result: JSON.stringify({ rendering: '', scene: 'open door', negative: '', subjects: [] }) })
    await session.prepare({ ...session.data.anchor!, start: 0, end: 0, text: '화면에서 선택한 장면', insertionUnavailable: true })
    expect(mocks.request).toHaveBeenCalledOnce()
    expect(JSON.stringify(mocks.request.mock.calls[0][0].formated)).toContain('화면에서 선택한 장면')
    expect(session.state.sources.some(item => item.name.startsWith('선택 구간'))).toBe(false)
    expect(session.data.draft?.scene).toBe('open door')
})
it('inserts after the selected message when transformed text has no reliable source offsets', async () => {
    const { session, chat } = setup()
    session.data.results.push({ id: 'unmapped', assetId: 'asset', createdAt: 1, anchor: { ...session.data.anchor!, insertionUnavailable: true }, draft: session.data.draft!, settings: session.data.settings, style: session.style, seed: 1 })
    await session.insert('unmapped', 'after')
    expect(chat.message[0].data).toBe('앞 장면 뒤\n\n{{inlay::asset}}\n\n')
    expect(session.state.error).toBe('')
})
it('inserts at a new selection without moving the draft scene', async () => {
    const { session, chat } = setup()
    const original = { ...session.data.anchor! }
    chat.message.push({ chatId: 'new-target', data: '선택한 다른 메시지', swipes: ['선택한 다른 메시지'], swipeId: 0 })
    session.data.results.push({ id: 'r', assetId: 'asset', createdAt: 1, anchor: original, draft: session.data.draft!, settings: session.data.settings, style: session.style, seed: 1 })
    await session.insert('r', 'after', { ...original, messageId: 'new-target', start: 4, end: 6, text: '다른' })
    expect(chat.message[1].data).toContain('선택한 다른\n\n{{inlay::asset}}')
    expect(chat.message[0].data).toBe('앞 장면 뒤')
    expect(session.data.anchor).toEqual(original)
})
it('keeps the captured selection aligned across before and after insertion', async () => {
    const { session, chat } = setup()
    painterSelection.set({ characterId: 'bot', chatId: session.chatId, anchor: { ...session.data.anchor! } })
    session.data.results.push({ id: 'r', assetId: 'asset', createdAt: 1, anchor: { ...session.data.anchor! }, draft: session.data.draft!, settings: session.data.settings, style: session.style, seed: 1 })
    await session.insert('r', 'before', get(painterSelection)!.anchor)
    await session.insert('r', 'after', get(painterSelection)!.anchor)
    expect(chat.message[0].data).toBe('앞 \n\n{{inlay::asset}}\n\n장면\n\n{{inlay::asset}}\n\n 뒤')
    expect(chat.message[0].swipes[0]).toBe(chat.message[0].data)
})
it('keeps the captured selection and message unchanged when saving insertion fails', async () => {
    const { session, chat } = setup()
    const captured = { characterId: 'bot', chatId: session.chatId, anchor: { ...session.data.anchor! } }
    painterSelection.set(captured)
    session.data.results.push({ id: 'r', assetId: 'asset', createdAt: 1, anchor: { ...session.data.anchor! }, draft: session.data.draft!, settings: session.data.settings, style: session.style, seed: 1 })
    mocks.save.mockRejectedValueOnce(new Error('disk full'))
    await session.insert('r', 'before', captured.anchor)
    expect(get(painterSelection)).toEqual(captured)
    expect(chat.message[0].data).toBe('앞 장면 뒤')
})
it('does not shift a fresh selection captured from the changed message while save is pending', async () => {
    const { session } = setup()
    const captured = { characterId: 'bot', chatId: session.chatId, anchor: { ...session.data.anchor! } }
    painterSelection.set(captured)
    session.data.results.push({ id: 'r', assetId: 'asset', createdAt: 1, anchor: { ...session.data.anchor! }, draft: session.data.draft!, settings: session.data.settings, style: session.style, seed: 1 })
    let completeSave!: () => void
    mocks.save.mockImplementationOnce(() => new Promise<void>(resolve => { completeSave = resolve }))
    const inserting = session.insert('r', 'before', captured.anchor)
    const fresh = { ...captured, anchor: { ...captured.anchor, start: 25, end: 26, text: '뒤' } }
    painterSelection.set(fresh)
    completeSave()
    await inserting
    expect(get(painterSelection)).toEqual(fresh)
})
it('clears only the current painter conversation and excludes it from the next prompt request', async () => {
    const { session, chat } = setup()
    session.data.conversation = [{ id: 'old', role: 'user', text: 'earlier composition request' }]
    session.data.previousDraft = { ...session.data.draft!, scene: 'previous scene' }
    session.data.settings.instruction = 'unsent instruction'
    session.data.results.push({ id: 'r', assetId: 'asset', createdAt: 1, anchor: session.data.anchor!, draft: session.data.draft!, settings: session.data.settings, style: session.style, seed: 1 })
    const before = JSON.parse(JSON.stringify(session.data))
    const other = createPainterChatData()
    other.conversation = [{ id: 'other', role: 'user', text: 'other chat request' }]
    mocks.db.characters[0].chats[1].bardPainter = other
    expect(await session.clearConversation()).toBe(true)
    expect(session.data).toEqual({ ...before, conversation: [] })
    expect(other.conversation).toHaveLength(1)
    expect(mocks.save).toHaveBeenCalledWith({ flushServer: 'canonical', rejectOnFailure: true })
    expect(mocks.request).not.toHaveBeenCalled()
    expect(new PainterSession('bot', chat.id).data.conversation).toEqual([])
    mocks.request.mockResolvedValue({ type: 'success', result: JSON.stringify({ rendering: '', scene: 'new scene', negative: '', subjects: [] }) })
    await session.prepare()
    expect(JSON.parse(mocks.request.mock.calls[0][0].formated[1].content).conversation).toEqual([])
})
it('restores the painter conversation when clearing cannot be saved', async () => {
    const { session } = setup()
    session.data.conversation = [{ id: 'old', role: 'user', text: 'keep this request' }]
    const before = JSON.parse(JSON.stringify(session.data))
    mocks.save.mockRejectedValueOnce(new Error('disk full'))
    expect(await session.clearConversation()).toBe(false)
    expect(session.data).toEqual(before)
    expect(session.state.error).toContain('disk full')
    expect(session.state.status).toBe('idle')
})
it('locks a pending conversation clear to the captured chat', async () => {
    const { session } = setup()
    session.data.conversation = [{ id: 'old', role: 'user', text: 'old request' }]
    let finish!: () => void
    mocks.save.mockImplementationOnce(() => new Promise<void>(resolve => finish = resolve))
    const pending = session.clearConversation()
    expect(session.state.status).toBe('saving')
    expect(await session.clearConversation()).toBe(false)
    mocks.db.characters[0].chatPage = 1
    finish()
    expect(await pending).toBe(true)
    expect(session.data.conversation).toEqual([])
    expect(mocks.db.characters[0].chats[1].bardPainter).toBeUndefined()
    expect(mocks.save).toHaveBeenCalledOnce()
})
it.each(['prompt', 'image', 'pending', 'streaming'])('keeps the conversation while %s work is active', async mode => {
    const { session, chat } = setup()
    session.data.conversation = [{ id: 'old', role: 'user', text: 'old request' }]
    if (mode === 'pending') session.state.pendingImage = true
    else if (mode === 'streaming') Object.assign(chat, { isStreaming: true })
    else session.state.status = mode as 'prompt' | 'image'
    expect(await session.clearConversation()).toBe(false)
    expect(session.data.conversation).toHaveLength(1)
    expect(mocks.save).not.toHaveBeenCalled()
})
it('refines the pinned scene through prompt conversation and can restore the prior draft', async () => {
    const { session } = setup()
    mocks.request.mockResolvedValue({ type: 'success', result: JSON.stringify({ rendering: '', scene: 'closer framing', negative: '', subjects: [] }) })
    const prior = JSON.parse(JSON.stringify(session.data.draft))
    await session.prepare(undefined, { instruction: '가까운 구도로 바꿔 줘' })
    const request = JSON.parse(mocks.request.mock.calls[0][0].formated[1].content)
    expect(request.target.text).toBe('장면')
    expect(request.instruction).toBe('가까운 구도로 바꿔 줘')
    expect(request.draft).toEqual(prior)
    expect(session.data.conversation?.at(-2)?.text).toBe('가까운 구도로 바꿔 줘')
    expect(mocks.fetch).not.toHaveBeenCalled()
    await session.restoreDraft()
    expect(session.data.draft).toEqual(prior)
})
it('keeps the edited draft, restore backup and conversation when restoration cannot be saved', async () => {
    const { session } = setup()
    session.data.previousDraft = { rendering: '', scene: 'previous framing', negative: '', subjects: [] }
    session.data.conversation = [{ id: 'request', role: 'user', text: '가까운 구도로 바꿔 줘' }]
    const previous = JSON.parse(JSON.stringify(session.data))
    mocks.save.mockRejectedValueOnce(new Error('disk full'))
    await session.restoreDraft()
    expect(session.data.draft).toEqual(previous.draft)
    expect(session.data.previousDraft).toEqual(previous.previousDraft)
    expect(session.data.conversation).toEqual(previous.conversation)
    expect(session.state.error).toContain('disk full')
})
it('prompt failure preserves the previous editable draft and never calls the image API', async () => {
    const { session } = setup()
    mocks.request.mockResolvedValue({ type: 'fail', result: 'provider offline' })
    await session.prepare()
    expect(session.data.draft?.scene).toBe('1girl, indoors')
    expect(session.state.error).toContain('provider offline')
    expect(mocks.fetch).not.toHaveBeenCalled()
    expect(session.state.status).toBe('idle')
})

it('a failed new selection keeps the previous draft attached to its original selection', async () => {
    const { session } = setup()
    const original = { ...session.data.anchor! }
    mocks.request.mockResolvedValue({ type: 'fail', result: 'offline' })
    await session.prepare({ ...original, start: 5, end: 6, text: '뒤' })
    expect(session.data.anchor).toEqual(original)
    expect(session.data.draft?.scene).toBe('1girl, indoors')
})

it('saving an outfit registers its manually added owner for other chats', async () => {
    const { session } = setup()
    session.data.draft!.subjects.push({ id: 'manual', name: '아리아', aliases: ['Aria'], kind: 'character', appearance: 'blue eyes', clothing: 'white shirt', state: '', pose: '', negative: '' })
    await session.saveOutfit('manual', '여행복', false)
    await session.promoteOutfit(session.data.outfits[0].id)
    expect(session.bot.identities).toContainEqual({ id: 'manual', name: '아리아', aliases: ['Aria'], appearance: '' })
    expect(session.bot.outfits[0].subjectId).toBe('manual')
})

it('generates and converts before storing only WebP and committing the result once', async () => {
    const { session } = setup()
    const steps: string[] = []
    mocks.fetch.mockImplementation(async () => { steps.push('generate'); return { ok: true, data: zipSync({ 'image.png': new Uint8Array([1, 2, 3]) }) } })
    mocks.compress.mockImplementation(async () => { steps.push('convert'); return { data: new Uint8Array([4]), width: 832, height: 1216, mime: 'image/webp' } })
    mocks.asset.mockImplementation(async () => { steps.push('asset') })
    vi.mocked(savePainterGalleryRecord).mockImplementation(async () => { steps.push('gallery') })
    mocks.save.mockImplementation(async () => { steps.push('commit') })
    await session.generate()
    expect(session.state.error).toBe('')
    expect(steps).toEqual(['generate', 'convert', 'asset', 'gallery', 'commit'])
    expect(mocks.asset).toHaveBeenCalledWith(session.data.results[0].assetId, expect.objectContaining({ ext: 'webp', width: 832, height: 1216 }), { charId: 'bot', chatId: session.chatId })
    expect(mocks.asset.mock.calls[0][1].data.type).toBe('image/webp')
    expect(session.data.results).toHaveLength(1)
    expect(session.data.results[0].compressionPending).toBe(false)
    expect(session.state.pendingImage).toBe(false)
})

it('generates once and recovers a failed conversion without storing PNG or requesting another image', async () => {
    const { session } = setup()
    mocks.fetch.mockResolvedValue({ ok: true, data: zipSync({ 'image.png': new Uint8Array([1, 2, 3]) }) })
    mocks.compress.mockRejectedValueOnce(new Error('encoder failed')).mockResolvedValueOnce({ data: new Uint8Array([4]), width: 832, height: 1216, mime: 'image/webp' })
    await session.generate()
    expect(session.state.pendingImage).toBe(true)
    expect(session.data.results).toHaveLength(0)
    expect(mocks.asset).not.toHaveBeenCalled()
    expect(mocks.save).not.toHaveBeenCalled()
    await session.retrySave()
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
    expect(session.state.pendingImage).toBe(false)
    expect(session.data.results[0].compressionPending).toBe(false)
    expect(mocks.asset).toHaveBeenCalledOnce()
    expect(mocks.asset.mock.calls[0][1].ext).toBe('webp')
})

it.each(['asset', 'gallery', 'commit'])('retries a failed %s without regenerating or reconverting the image', async failure => {
    const { session } = setup()
    mocks.fetch.mockResolvedValue({ ok: true, data: zipSync({ 'image.png': new Uint8Array([1, 2, 3]) }) })
    mocks.compress.mockResolvedValue({ data: new Uint8Array([4]), width: 832, height: 1216, mime: 'image/webp' })
    const failing = failure === 'asset' ? mocks.asset : failure === 'gallery' ? vi.mocked(savePainterGalleryRecord) : mocks.save
    failing.mockRejectedValueOnce(new Error('disk full'))
    await session.generate()
    expect(session.state.error).toContain('disk full')
    expect(session.state.pendingImage).toBe(true)
    await session.generate()
    await session.retrySave()
    expect(session.state.error).toBe('')
    expect(session.state.pendingImage).toBe(false)
    expect(session.data.results).toHaveLength(1)
    expect(session.data.results[0].compressionPending).toBe(false)
    expect(mocks.fetch).toHaveBeenCalledOnce()
    expect(mocks.compress).toHaveBeenCalledOnce()
    expect(mocks.asset).toHaveBeenCalledTimes(failure === 'asset' ? 2 : 1)
    expect(mocks.asset.mock.calls.every(([, asset]) => asset.ext === 'webp')).toBe(true)
})

it('recovers an already written WebP after restart without running the PNG converter', async () => {
    const { session } = setup()
    session.data.results.push({ id: 'r', assetId: 'asset', createdAt: 1, anchor: { ...session.data.anchor! }, draft: session.data.draft!, settings: session.data.settings, style: session.style, seed: 1, compressionPending: true })
    mocks.readAsset.mockResolvedValue({ data: new Blob(['RIFF1234WEBP']) })
    const restarted = new PainterSession('bot', session.chatId)
    await restarted.retrySave()
    expect(restarted.state.error).toBe('')
    expect(restarted.state.pendingImage).toBe(false)
    expect(mocks.compress).not.toHaveBeenCalled()
    expect(mocks.fetch).not.toHaveBeenCalled()
})

it('can abandon missing recovery data without blocking the chat or deleting assets', async () => {
    const { session } = setup()
    session.data.results.push({ id: 'r', assetId: 'missing', createdAt: 1, anchor: { ...session.data.anchor! }, draft: session.data.draft!, settings: session.data.settings, style: session.style, seed: 1, compressionPending: true })
    mocks.readAsset.mockResolvedValue(null)
    const restarted = new PainterSession('bot', session.chatId)
    await restarted.retrySave()
    expect(restarted.state.pendingImage).toBe(true)
    expect(restarted.state.error).toContain('원본')
    await restarted.discardPending()
    expect(restarted.state.pendingImage).toBe(false)
    expect(restarted.data.results).toEqual([])
    expect(restarted.data.draft).toBeDefined()
    expect(mocks.asset).not.toHaveBeenCalled()
})

it('keeps recovery data when abandoning it cannot be saved', async () => {
    const { session } = setup()
    session.data.results.push({ id: 'r', assetId: 'missing', createdAt: 1, anchor: { ...session.data.anchor! }, draft: session.data.draft!, settings: session.data.settings, style: session.style, seed: 1, compressionPending: true })
    const restarted = new PainterSession('bot', session.chatId)
    mocks.save.mockRejectedValueOnce(new Error('disk full'))
    await restarted.discardPending()
    expect(restarted.state.pendingImage).toBe(true)
    expect(restarted.data.results).toHaveLength(1)
})

it('awaits an already loading wiki before preparing a prompt with selected documents', async () => {
    const { session } = setup()
    session.data.settings.context.wikiIds = ['doc']
    let resolveWiki!: (value: unknown) => void
    mocks.wiki.mockImplementation(() => new Promise(resolve => { resolveWiki = resolve }))
    mocks.request.mockResolvedValue({ type: 'success', result: JSON.stringify({ rendering: '', scene: 'forest', negative: '', subjects: [] }) })
    const loading = session.loadWiki()
    const preparing = session.prepare()
    resolveWiki({ mode: 'markdown', documents: [{ id: 'doc', title: '여행', status: 'active', content: 'blue cloak' }] })
    await Promise.all([loading, preparing])
    expect(mocks.wiki).toHaveBeenCalledTimes(1)
    expect(session.state.error).toBe('')
    expect(session.state.sources).toContainEqual({ name: '바드위키: 여행', content: 'blue cloak' })
    expect(mocks.request).toHaveBeenCalledOnce()
})
