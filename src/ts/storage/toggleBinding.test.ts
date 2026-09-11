import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('../stores.svelte', () => {
    const noopStore = { subscribe: () => () => {}, set: () => {}, update: () => {} }
    return {
        DBState: { db: {} },
        selectedCharID: noopStore,
        selIdState: { selId: -1 },
    }
})

vi.mock('../globalApi.svelte', () => ({
    forageStorage: { realStorage: null },
    downloadFile: () => {},
    saveAsset: () => Promise.resolve(''),
}))

vi.mock('../alert', () => ({
    notifySuccess: () => {},
    alertError: () => {},
}))

vi.mock('../../lang', () => ({
    language: {},
    changeLanguage: () => {},
}))

const {
    applyTogglePresetToChat,
    applyToggleValues,
    fillMissingPinnedToggleValues,
    getDatabase,
    loadTogglesFromChat,
    pinToggleValuesToChat,
    resetPinnedToggleValues,
    snapshotCurrentToggleValues,
    setDatabase,
    unpinToggleValuesFromChat,
} = await import('./database.svelte')

function makeDb() {
    return {
        customPromptTemplateToggle: 'one=Toggle One\ntwo=Toggle Two=text',
        globalChatVariables: {
            toggle_one: '1',
            toggle_two: '',
            toggle_other_bot: 'foreign',
            unrelated: 'global',
        },
        modules: [],
        enabledModules: [],
        moduleIntergration: '',
    } as any
}

function makeChat() {
    return { message: [], note: '', name: '', localLore: [], modules: [] } as any
}

function makeCharacter(chat: any) {
    return { chats: [chat], chatPage: 0, modules: [] } as any
}

describe('per-chat toggle pinning', () => {
    let db: ReturnType<typeof makeDb>
    let chat: ReturnType<typeof makeChat>
    let character: ReturnType<typeof makeCharacter>

    beforeEach(() => {
        db = makeDb()
        chat = makeChat()
        character = makeCharacter(chat)
    })

    test('copies current toggle values, including empty strings, without copying unrelated globals', () => {
        pinToggleValuesToChat(chat, db, character)

        expect(chat.useLocallySetGlobalVariables).toBe(true)
        expect(chat.GLGlobalVariables).toEqual({ toggle_one: '1', toggle_two: '' })
        expect(chat.togglePresetBaseline).toEqual({ values: { toggle_one: '1', toggle_two: '' } })
        expect(chat.GLGlobalVariables).not.toHaveProperty('toggle_other_bot')
        expect(chat.savedToggleValues).toBeUndefined()
    })

    test('applies a named preset as the pinned live values and baseline', () => {
        applyTogglePresetToChat(
            { name: 'Story', values: { toggle_one: 'preset', toggle_two: '2' } },
            db,
            character,
            chat,
        )

        expect(chat.useLocallySetGlobalVariables).toBe(true)
        expect(chat.GLGlobalVariables).toEqual({ toggle_one: 'preset', toggle_two: '2' })
        expect(chat.togglePresetBaseline).toEqual({
            name: 'Story',
            values: { toggle_one: 'preset', toggle_two: '2' },
        })
        expect(db.globalChatVariables.toggle_one).toBe('1')
    })

    test('resets pinned values exactly to the stored baseline', () => {
        applyTogglePresetToChat({ name: 'Story', values: { toggle_one: 'preset' } }, db, character, chat)
        chat.GLGlobalVariables = { toggle_one: 'changed', toggle_extra: 'orphan' }

        resetPinnedToggleValues(chat)

        expect(chat.GLGlobalVariables).toEqual({ toggle_one: 'preset' })
    })

    test('repinning uses current local values as a new manual reset baseline', () => {
        const preset = { name: 'Story', values: { toggle_one: 'preset', toggle_two: '2' } }
        applyTogglePresetToChat(preset, db, character, chat)
        chat.GLGlobalVariables.toggle_one = 'edited'
        chat.GLGlobalVariables.toggle_two = ''

        pinToggleValuesToChat(chat, db, character)

        expect(chat.useLocallySetGlobalVariables).toBe(true)
        expect(chat.togglePresetBaseline).toEqual({ values: { toggle_one: 'edited', toggle_two: '' } })
        chat.GLGlobalVariables.toggle_one = 'later edit'
        resetPinnedToggleValues(chat)
        expect(chat.GLGlobalVariables).toEqual({ toggle_one: 'edited', toggle_two: '' })
        expect(db.globalChatVariables.toggle_one).toBe('1')
        expect(preset.values.toggle_one).toBe('preset')
    })

    test('snapshots and applies presets against the local map while pinned', () => {
        pinToggleValuesToChat(chat, db, character)
        db.globalChatVariables.toggle_one = 'global-unchanged'

        applyToggleValues({ toggle_one: 'local' }, db, character, chat)

        expect(snapshotCurrentToggleValues(db, character, chat)).toEqual({ toggle_one: 'local', toggle_two: '' })
        expect(db.globalChatVariables.toggle_one).toBe('global-unchanged')
    })

    test('unpinning drops the local map and restores global fallback', () => {
        pinToggleValuesToChat(chat, db, character)
        chat.GLGlobalVariables.toggle_one = 'local'

        unpinToggleValuesFromChat(chat)

        expect(chat.useLocallySetGlobalVariables).toBe(false)
        expect(chat.GLGlobalVariables).toBeUndefined()
        expect(chat.togglePresetBaseline).toBeUndefined()
        expect(db.globalChatVariables.toggle_one).toBe('1')
    })

    test('migrates the existing saved-toggle binding without mutating global values', () => {
        chat.savedToggleValues = { toggle_one: 'legacy' }

        loadTogglesFromChat(chat, db, character)

        expect(chat.useLocallySetGlobalVariables).toBe(true)
        expect(chat.GLGlobalVariables).toEqual({ toggle_one: 'legacy' })
        expect(chat.togglePresetBaseline).toEqual({ values: { toggle_one: 'legacy' } })
        expect(chat.savedToggleValues).toBeUndefined()
        expect(db.globalChatVariables.toggle_one).toBe('1')
    })

    test('creates a manual baseline for an existing pinned chat during hydration', () => {
        const initial = makeChat()
        initial.useLocallySetGlobalVariables = true
        initial.GLGlobalVariables = { toggle_one: 'local' }

        setDatabase({
            characters: [{ ...makeCharacter(initial), risuBardWikiGuide: '' }],
            formatingOrder: ['main'],
            loreBook: [],
            personas: [{ name: 'User', icon: '', personaPrompt: '' }],
            selectedPersona: 0,
            username: 'User',
            userIcon: '',
            userNote: '',
        } as any)

        expect(getDatabase().characters[0].chats[0].togglePresetBaseline).toEqual({
            values: { toggle_one: 'local' },
        })
    })

    test('fills a partial pinned map from global values so UI and generation agree', () => {
        chat.useLocallySetGlobalVariables = true
        chat.GLGlobalVariables = { toggle_one: 'local' }
        chat.togglePresetBaseline = { values: { toggle_one: 'local' } }

        fillMissingPinnedToggleValues(chat, ['toggle_one', 'toggle_two'], db)

        expect(chat.GLGlobalVariables).toEqual({ toggle_one: 'local', toggle_two: '' })
        expect(chat.togglePresetBaseline.values).toEqual({ toggle_one: 'local', toggle_two: '' })
    })

    test('migrates the initially selected legacy chat during database hydration', () => {
        const initial = makeChat()
        initial.savedToggleValues = { toggle_one: 'legacy' }

        setDatabase({
            characters: [{ ...makeCharacter(initial), risuBardWikiGuide: '' }],
            formatingOrder: ['main'],
            loreBook: [],
            personas: [{ name: 'User', icon: '', personaPrompt: '' }],
            selectedPersona: 0,
            username: 'User',
            userIcon: '',
            userNote: '',
        } as any)

        const hydrated = getDatabase().characters[0].chats[0]
        expect(hydrated.useLocallySetGlobalVariables).toBe(true)
        expect(hydrated.GLGlobalVariables).toEqual({ toggle_one: 'legacy' })
        expect(hydrated.savedToggleValues).toBeUndefined()
    })
})
