import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { mount, tick, unmount } from 'svelte'
import PromptBind from './PromptBind.svelte'
import { DBState, selectedCharID } from 'src/ts/stores.svelte'
import { createBotPresetTemplate, deleteBotPreset, loadChatBindings, selectChatPromptPreset, syncActiveBotPresetFromMirror } from 'src/ts/storage/database.svelte'

vi.mock('src/ts/stores.svelte', async () => {
    const { writable } = await import('svelte/store')
    const state = $state({ db: {} as any })
    return {
        DBState: state, selectedCharID: writable(0), selIdState: { selId: 0 },
        openPresetList: writable(false), presetSelectCallback: writable(null),
    }
})
vi.mock('src/ts/globalApi.svelte', () => ({
    forageStorage: { realStorage: null }, downloadFile: vi.fn(), saveAsset: vi.fn(),
}))
vi.mock('src/ts/alert', () => ({
    notifySuccess: vi.fn(), alertError: vi.fn(), alertConfirmMulti: vi.fn(), alertSelect: vi.fn(), alertMd: vi.fn(),
}))
vi.mock('src/lang', () => ({ language: { promptBindingLabel: 'Binding', promptPresetParamsUse: 'Parameters' }, changeLanguage: vi.fn() }))

let mounted: ReturnType<typeof mount> | undefined
beforeEach(() => {
    const presets = ['Old', 'Next'].map((name) => ({
        ...createBotPresetTemplate(), id: name, name,
        mainPrompt: `${name} prompt`, moduleIntergration: `${name}-module`,
        customPromptTemplateToggle: `${name}=Toggle`,
    }))
    DBState.db = {
        ...presets[0], NAIsettings: {}, botPresets: presets, botPresetsId: 0,
        characters: [{ chatPage: 0, chats: [{ id: 'chat', bindedBotPreset: 'Old' }] }],
    } as any
    selectedCharID.set(0)
})
afterEach(async () => {
    if (mounted) await unmount(mounted)
    mounted = undefined
    document.body.replaceChildren()
})

describe('reactive prompt preset lifecycle', () => {
    test('keeps an explicit selection after the bound sidebar effect runs', async () => {
        mounted = mount(PromptBind, { target: document.body })
        await tick()
        selectChatPromptPreset(1)
        await tick()
        expect(document.querySelector('button')?.textContent).toContain('Next')
        expect(DBState.db.botPresetsId).toBe(1)
        expect(DBState.db.moduleIntergration).toBe('Next-module')
        expect(DBState.db.characters[0].chats[0].bindedBotPreset).toBe('Next')
    })

    test('clears a deleted binding and updates the sidebar before the next save', async () => {
        mounted = mount(PromptBind, { target: document.body })
        await tick()
        deleteBotPreset('Old')
        await tick()
        expect(document.querySelector('button')?.textContent).toContain('Next')
        expect(document.querySelector('button')?.classList.contains('bg-binding')).toBe(false)
        expect(DBState.db.customPromptTemplateToggle).toBe('Next=Toggle')
        syncActiveBotPresetFromMirror()
        expect(DBState.db.botPresets[0].mainPrompt).toBe('Next prompt')
        expect(DBState.db.botPresets[0].moduleIntergration).toBe('Next-module')
    })

    test('restores freshly hydrated chat bindings through the reactive slot with the sidebar hidden', async () => {
        const hydrated = { id: 'chat', bindedBotPreset: 'Next', savedToggleValues: { toggle_one: '1' } }
        DBState.db.characters[0].chats[0] = hydrated as any
        await tick()
        expect(DBState.db.characters[0].chats[0]).not.toBe(hydrated)
        loadChatBindings(hydrated as any)
        expect(DBState.db.moduleIntergration).toBe('Next-module')
        expect(DBState.db.characters[0].chats[0].GLGlobalVariables).toEqual({ toggle_one: '1' })
    })

    test('ignores late hydration from a different chat', () => {
        loadChatBindings({ id: 'previous-chat', bindedBotPreset: 'Next' } as any)
        expect(DBState.db.moduleIntergration).toBe('Old-module')
    })
})
