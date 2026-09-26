import { beforeEach, expect, it, vi } from 'vitest'
import { writable } from 'svelte/store'
import type { Database } from '../storage/database.svelte'
import { createPainterChatData } from './types'

const mocks = vi.hoisted(() => ({ db: {} as Database, request: vi.fn(), save: vi.fn() }))
vi.mock('../stores.svelte', () => ({ DBState: { db: mocks.db }, selectedCharID: writable(0), selIdState: { selId: 0 }, ReloadChatPointer: writable(0) }))
vi.mock('../storage/database.svelte', () => ({ appVer: 'test', getCurrentCharacter: () => mocks.db.characters[0], getDatabase: () => mocks.db }))
vi.mock('../globalApi.svelte', () => ({ requestImmediateSave: mocks.save, globalFetch: vi.fn(), forageStorage: { createAuth: vi.fn() }, aiWatermarkingLawApplies: () => false, getFileSrc: async () => '' }))
vi.mock('../process/request/request', () => ({ requestChatData: mocks.request }))
vi.mock('../risubard/memoryWiki', () => ({ loadNarrativeMemoryWiki: vi.fn() }))
vi.mock('../storage/chatStorage', () => ({ ensureChatHydrated: vi.fn() }))
vi.mock('../process/files/inlays', () => ({ setInlayAsset: vi.fn(), getInlayAssetBlob: vi.fn(), getInlayInfosBatch: () => [] }))
vi.mock('../process/modules', () => ({ getModuleAssets: () => [], getModuleLorebooks: () => [], getModules: () => [] }))
vi.mock('../process/scripts', () => ({ processScriptFull: vi.fn() }))
vi.mock('../process/infunctions', () => ({ calcString: vi.fn() }))
vi.mock('../util', async (importOriginal) => ({ ...await importOriginal<typeof import('../util')>(), findCharacterbyId: vi.fn(), getPersonaPrompt: () => '', getUserIcon: () => '', getUserName: () => 'User', pickHashRand: () => 0, replaceAsync: vi.fn(), parseKeyValue: () => [] }))
vi.mock('../model/modellist', () => ({ getModelInfo: vi.fn() }))
vi.mock('src/lang', () => ({ language: {} }))
import { PainterSession } from './runtime.svelte'
import { buildPainterImageRequest, formatPainterPromptText } from './prompt'

beforeEach(() => {
    vi.resetAllMocks()
    const data = createPainterChatData()
    data.settings.context.systemPrompt = true
    data.anchor = { characterId: 'bot', chatId: 'chat', messageId: 'm1', start: 0, end: 5, text: 'scene' }
    Object.assign(mocks.db, {
        characters: [{ type: 'character', chaId: 'bot', name: 'Aria', chatPage: 0, chats: [{ id: 'chat', message: [{ chatId: 'm1', role: 'char', data: 'scene' }], bardPainter: data }] }],
        globalChatVariables: { toggle_detail: '1' },
        disableToggleBinding: false,
        promptTemplate: [{ type: 'plain', type2: 'main', role: 'system', text: 'World {{char}} {{#when::toggle::detail}}blue coat{{/}}' }],
        mainPrompt: 'Legacy',
        botPresetsId: 0,
        botPresets: [{ id: 'current', name: 'Current' }, { id: 'other', name: 'Other', promptTemplate: [{ type: 'plain', type2: 'main', role: 'system', text: 'Bound {{getglobalvar::toggle_detail}}' }] }],
        togglePresets: [{ name: 'Image', promptPresetName: 'Current', values: { toggle_detail: '0' } }, { name: 'Other image', promptPresetName: 'Other', values: { toggle_detail: '1' } }],
        customPromptTemplateToggle: 'detail=Detail\nnote=Note=text',
    })
    mocks.request.mockResolvedValue({ type: 'success', result: JSON.stringify({ rendering: '', scene: 'indoors', negative: '', subjects: [] }) })
    mocks.save.mockResolvedValue(undefined)
    mocks.db.bardPainterFragments = []
})

it('keeps editable fragment copies through refinement, fresh drafts and restoration and sends them to images', async () => {
    const session = new PainterSession('bot', 'chat')
    const id = await session.saveFragment({ id: '', name: '빛', prompt: '1.3::rim light::' })
    expect(id).toBeTruthy()
    await session.prepare()
    expect(await session.addFragment(id!)).toBe(true)
    session.data.draft!.fragments![0].prompt = '  1.5::rim light::\nsoft glow  '
    mocks.request.mockResolvedValue({ type: 'success', result: JSON.stringify({ rendering: '', scene: 'indoors', negative: '', subjects: [], fragments: [{ id: 'injected', name: 'AI', prompt: 'changed' }] }) })
    for (const fresh of [false, true]) {
        expect(await session.prepare(undefined, { fresh })).toBe(true)
        expect(session.data.draft!.fragments![0].prompt).toBe('  1.5::rim light::\nsoft glow  ')
        const payload = JSON.parse(mocks.request.mock.calls.at(-1)[0].formated[1].content)
        expect(payload.expressionFragments).toEqual(['  1.5::rim light::\nsoft glow  '])
        expect(payload.draft?.fragments).toBeUndefined()
    }
    session.data.draft!.fragments![0].prompt = '2::rim light::'
    await session.restoreDraft()
    expect(session.data.draft!.fragments![0].prompt).toBe('2::rim light::')
    expect(session.fragments[0].prompt).toBe('1.3::rim light::')
    const request = buildPainterImageRequest(session.data.draft!, session.style, session.settings, 42)
    expect(request.input).toContain('2::rim light::')
    expect(request.parameters.v4_prompt.caption.base_caption).toContain('2::rim light::')
    expect(formatPainterPromptText(session.data.draft!, session.style)).toContain('2::rim light::')
    await session.removeFragment(id!)
    expect(session.fragments).toEqual([])
    expect(session.data.draft!.fragments![0].prompt).toBe('2::rim light::')
})

it('saves, duplicates and rolls back fragment library changes on persistence failure', async () => {
    const session = new PainterSession('bot', 'chat')
    const id = await session.saveFragment({ id: '', name: '빛', prompt: 'glow' })
    await session.saveFragment({ id: id!, name: '빛', prompt: 'rim light' })
    const copyId = await session.saveFragment({ id: id!, name: '빛 복사', prompt: 'rim light' }, true)
    expect(copyId).not.toBe(id)
    expect(new PainterSession('bot', 'chat').fragments.map(item => item.prompt)).toEqual(['rim light', 'rim light'])
    mocks.save.mockRejectedValueOnce(new Error('disk full'))
    expect(await session.removeFragment(id!)).toBe(false)
    expect(session.fragments).toHaveLength(2)
    expect(session.state.error).toContain('disk full')
})

it('applies an isolated snapshot to prompt creation and refinement without changing chat toggles', async () => {
    const chat = mocks.db.characters[0].chats[0]
    chat.useLocallySetGlobalVariables = true
    chat.GLGlobalVariables = { toggle_detail: '1', toggle_note: 'chat note' }
    mocks.db.promptTemplate = [{ type: 'plain', type2: 'main', role: 'system', text: 'World {{#when::toggle::detail}}blue coat{{/}} [{{getglobalvar::toggle_detail}}] [{{getglobalvar::toggle_note}}]' }]
    chat.bardPainter.settings.context.systemPrompt = false
    const session = new PainterSession('bot', 'chat')
    expect(session.imagePresets.map(item => item.preset.name)).toEqual(['Image'])
    expect(await session.applyImagePreset(0)).toBe(true)
    mocks.db.togglePresets[0].values.toggle_detail = '1'
    for (let i = 0; i < 2; i++) {
        await session.prepare()
        expect(session.state.error).toBe('')
        const payload = JSON.parse(mocks.request.mock.calls.at(-1)[0].formated[1].content)
        expect(payload.references).toContainEqual({ name: 'systemPrompt', content: 'World  [0] []' })
    }
    expect(mocks.db.globalChatVariables.toggle_detail).toBe('1')
    expect(chat.GLGlobalVariables).toEqual({ toggle_detail: '1', toggle_note: 'chat note' })
    expect(new PainterSession('bot', 'chat').imagePreset?.name).toBe('Image')
    expect(await session.applyImagePreset(null)).toBe(true)
    expect(session.imagePreset).toBeUndefined()
    expect(chat.bardPainter.settings.context.systemPrompt).toBe(false)
})

it('uses the captured chat binding and suspends an image preset when its prompt preset changes', async () => {
    const chat = mocks.db.characters[0].chats[0]
    chat.bindedBotPreset = 'other'
    const session = new PainterSession('bot', 'chat')
    expect(session.imagePresets.map(item => item.preset.name)).toEqual(['Other image'])
    expect(await session.applyImagePreset(0)).toBe(false)
    expect(await session.applyImagePreset(1)).toBe(true)
    await session.prepare()
    expect(JSON.parse(mocks.request.mock.calls.at(-1)[0].formated[1].content).references)
        .toContainEqual({ name: 'systemPrompt', content: 'Bound 1' })
    chat.bindedBotPreset = 'current'
    expect(session.imagePreset).toBeUndefined()
    await session.prepare()
    expect(JSON.parse(mocks.request.mock.calls.at(-1)[0].formated[1].content).references)
        .toContainEqual({ name: 'systemPrompt', content: 'World Aria blue coat' })
})

it('restores the applied image preset if saving fails and blocks changes during generation', async () => {
    const session = new PainterSession('bot', 'chat')
    await session.applyImagePreset(0)
    mocks.save.mockRejectedValueOnce(new Error('save failed'))
    expect(await session.applyImagePreset(null)).toBe(false)
    expect(session.imagePreset?.name).toBe('Image')
    session.state.status = 'prompt'
    expect(await session.applyImagePreset(null)).toBe(false)
    expect(session.imagePreset?.name).toBe('Image')
})

it.each([
    ['1', undefined, false, 'World Aria blue coat'],
    ['0', undefined, false, 'World Aria'],
    ['1', '0', false, 'World Aria'],
    ['0', '1', false, 'World Aria blue coat'],
    ['1', '0', true, 'World Aria blue coat'],
] as const)('resolves painter references with global=%s, pinned=%s, binding disabled=%s', async (global, pinned, disabled, expected) => {
    mocks.db.globalChatVariables.toggle_detail = global
    mocks.db.disableToggleBinding = disabled
    const chat = mocks.db.characters[0].chats[0]
    chat.useLocallySetGlobalVariables = pinned !== undefined
    chat.GLGlobalVariables = pinned === undefined ? {} : { toggle_detail: pinned }
    const session = new PainterSession('bot', 'chat')
    await session.prepare()
    expect(session.state.error).toBe('')
    const payload = JSON.parse(mocks.request.mock.calls[0][0].formated[1].content)
    expect(payload.references).toContainEqual({ name: 'systemPrompt', content: expected })
    expect(payload.references.some((source: { content: string }) => source.content.includes('{{'))).toBe(false)
})

it('omits a main block hidden by the current toggle instead of sending the legacy prompt', async () => {
    mocks.db.promptTemplate = [{ type: 'plain', type2: 'main', role: 'system', text: '{{#when::toggle::detail}}hidden{{/}}' }]
    mocks.db.globalChatVariables.toggle_detail = '0'
    const session = new PainterSession('bot', 'chat')
    await session.prepare()
    expect(session.state.error).toBe('')
    const payload = JSON.parse(mocks.request.mock.calls[0][0].formated[1].content)
    expect(payload.references).not.toContainEqual(expect.objectContaining({ name: 'systemPrompt' }))
})
