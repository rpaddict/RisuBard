import { describe, expect, test, vi } from 'vitest'

vi.mock('../stores.svelte', () => ({
    DBState: { db: {} },
    selectedCharID: { subscribe: () => () => {} },
    selIdState: { selId: -1 },
}))
vi.mock('../globalApi.svelte', () => ({
    forageStorage: { realStorage: null },
    downloadFile: vi.fn(),
    saveAsset: vi.fn(async () => ''),
}))
vi.mock('../alert', () => ({ notifySuccess: vi.fn(), alertError: vi.fn() }))
vi.mock('../../lang', () => ({ language: {}, changeLanguage: vi.fn() }))

const { getDatabase, newChatModelDefaults, normalizeChat, setDatabase } = await import('./database.svelte')

describe('RisuBard settings persistence', () => {
    test('persists the dynamic policy at global, chat and pinned scopes', () => {
        setDatabase({
            characters: [{ chaId: 'dynamic', name: 'Dynamic', chats: [{ id: 'chat', message: [], risuBardSettings: { risuBardDynamicMemoryMode: 'balanced', risuBardDynamicMemoryMaximumTokens: 16000 } }], risuBardPinnedSettings: { risuBardDynamicMemoryMode: 'recall', risuBardDynamicMemoryMaximumTokens: 20000 } }],
            formatingOrder: ['main'], loreBook: [], personas: [], username: 'User', userIcon: '', userNote: '',
            risuBardDynamicMemoryMode: 'economy', risuBardDynamicMemoryMaximumTokens: 9000,
        } as any)
        setDatabase(JSON.parse(JSON.stringify(getDatabase())))
        expect(getDatabase().risuBardDynamicMemoryMode).toBe('economy')
        expect(getDatabase().risuBardDynamicMemoryMaximumTokens).toBe(9000)
        expect(getDatabase().characters[0].chats[0].risuBardSettings?.risuBardDynamicMemoryMode).toBe('balanced')
        expect(getDatabase().characters[0].risuBardPinnedSettings?.risuBardDynamicMemoryMaximumTokens).toBe(20000)
        setDatabase({ ...getDatabase(), risuBardDynamicMemoryMode: 'bad', risuBardDynamicMemoryMaximumTokens: NaN } as any)
        expect(getDatabase().risuBardDynamicMemoryMode).toBe('economy')
        expect(getDatabase().risuBardDynamicMemoryMaximumTokens).toBe(12000)
        setDatabase({ ...getDatabase(), risuBardDynamicMemoryMode: 'off' } as any)
        expect(getDatabase().risuBardDynamicMemoryMode).toBe('off')
    })
    test('preserves bot-pinned wiki settings across database reloads', () => {
        setDatabase({
            characters: [{
                chaId: 'pinned-bot', name: 'Pinned bot', chats: [],
                risuBardPinnedSettings: {
                    risuBardResponseMessageCount: 7,
                    risuBardBardChanEnabled: false,
                    risuBardWikiWritingLanguage: 'ja',
                },
            }],
            formatingOrder: ['main'], loreBook: [], personas: [],
            username: 'User', userIcon: '', userNote: '',
        } as any)
        setDatabase(JSON.parse(JSON.stringify(getDatabase())))
        expect(getDatabase().characters[0].risuBardPinnedSettings).toEqual({
            risuBardResponseMessageCount: 7,
            risuBardBardChanEnabled: false,
            risuBardWikiWritingLanguage: 'ja',
        })
    })
    test.each([
        { font: undefined, md: undefined, expected: 14, preview: true },
        { font: 22, md: false, expected: 22, preview: false },
        { font: 200, md: true, expected: 48, preview: true },
        { font: NaN, md: undefined, expected: 14, preview: true },
    ])('persists OOC typography preferences: $font / $md', ({ font, md, expected, preview }) => {
        setDatabase({
            characters: [], formatingOrder: ['main'], loreBook: [],
            personas: [], username: 'User', userIcon: '', userNote: '',
            risuBardOocFontSize: font, risuBardOocMarkdown: md,
        } as any)
        setDatabase(JSON.parse(JSON.stringify(getDatabase())))
        expect(getDatabase().risuBardOocFontSize).toBe(expected)
        expect(getDatabase().risuBardOocMarkdown).toBe(preview)
    })
    test.each([true, false, undefined, 'true'])('normalizes OOC display preference: %s', (stored) => {
        setDatabase({
            characters: [], formatingOrder: ['main'], loreBook: [],
            personas: [], username: 'User', userIcon: '', userNote: '',
            risuBardHideOocTurns: stored,
        } as any)
        expect((getDatabase() as any).risuBardHideOocTurns).toBe(stored === true)
    })

    test.each([
        { stored: true, expected: true },
        { stored: false, expected: false },
        { stored: 'true', expected: false },
        { stored: undefined, expected: false },
    ])('normalizes the BardWiki Markdown preview setting: $stored', ({
        stored, expected,
    }) => {
        setDatabase({
            characters: [], formatingOrder: ['main'], loreBook: [],
            personas: [], username: 'User', userIcon: '', userNote: '',
            risuBardWikiMarkdownPreview: stored,
        } as any)

        expect(getDatabase().risuBardWikiMarkdownPreview).toBe(expected)
    })

    test('defaults legacy HypaMemory controls and new chats to off', () => {
        setDatabase({
            characters: [], formatingOrder: ['main'], loreBook: [],
            personas: [], username: 'User', userIcon: '', userNote: '',
        } as any)

        expect(getDatabase()).toMatchObject({
            hypaV3: false,
            memoryAlgorithmType: 'none',
            showMenuHypaMemoryModal: false,
        })
        expect(newChatModelDefaults()).toMatchObject({ supaMemory: false })
        expect(normalizeChat({ message: [], note: '', name: '', localLore: [] })).toMatchObject({
            supaMemory: false,
        })
    })

    test('defaults persona pinning for new chats to on', () => {
        setDatabase({
            characters: [], formatingOrder: ['main'], loreBook: [],
            personas: [], username: 'User', userIcon: '', userNote: '',
        } as any)

        expect(getDatabase().pinPersonaOnNewChat).toBe(true)
    })

    test('new chats keep the previous chat prompt binding and pinned toggles', () => {
        setDatabase({
            characters: [], formatingOrder: ['main'], loreBook: [],
            personas: [], username: 'User', userIcon: '', userNote: '',
        } as any)
        const previous = {
            bindedBotPreset: 'preset-a',
            usePromptPresetParams: true,
            useLocallySetGlobalVariables: true,
            GLGlobalVariables: { mode: 'dark' },
            togglePresetBaseline: { name: 'Night', values: { mode: 'dark' } },
        } as any
        const defaults = newChatModelDefaults(null, previous)
        expect(defaults).toMatchObject({
            bindedBotPreset: 'preset-a',
            usePromptPresetParams: true,
            useLocallySetGlobalVariables: true,
            GLGlobalVariables: { mode: 'dark' },
            togglePresetBaseline: { name: 'Night', values: { mode: 'dark' } },
        })
        defaults.GLGlobalVariables!.mode = 'light'
        expect(previous.GLGlobalVariables.mode).toBe('dark')

        expect(newChatModelDefaults(null, { ...previous, _placeholder: true }))
            .not.toHaveProperty('bindedBotPreset')
        setDatabase({ ...getDatabase(), disableToggleBinding: true } as any)
        expect(newChatModelDefaults(null, previous))
            .not.toHaveProperty('useLocallySetGlobalVariables')
        expect(newChatModelDefaults(null, { bindedPersona: '' }))
            .not.toHaveProperty('bindedBotPreset')
    })

    test.each([
        { recent: 250, response: 300, timeout: 7_500, expectedRecent: 250, expectedResponse: 300, expectedTimeout: 7_500 },
        { recent: 0, response: Infinity, timeout: 20_000, expectedRecent: 12, expectedResponse: 12, expectedTimeout: 10_000 },
    ])('normalizes persisted message counts without a fixed ceiling: $recent', ({
        recent, response, timeout, expectedRecent, expectedResponse,
        expectedTimeout,
    }) => {
        setDatabase({
            characters: [], formatingOrder: ['main'], loreBook: [],
            personas: [], username: 'User', userIcon: '', userNote: '',
            risuBardRecentMessageCount: recent,
            risuBardResponseMessageCount: response,
            risuBardAnalysisTokenLimit: 99_999,
            risuBardAdditionalSearchLimit: 99,
            risuBardCanonicalTargetLimit: 99,
            risuBardInquiryTargetTokenBudget: 50_000,
            risuBardInquiryMaximumTokenBudget: 99_999,
            risuBardInquiryTimeoutMs: timeout,
        } as any)
        const saved = JSON.parse(JSON.stringify(getDatabase()))
        setDatabase(saved)
        expect(getDatabase()).toMatchObject({
            risuBardRecentMessageCount: expectedRecent,
            risuBardResponseMessageCount: expectedResponse,
            risuBardAnalysisTokenLimit: 99_999,
            risuBardAdditionalSearchLimit: 99,
            risuBardCanonicalTargetLimit: 99,
            risuBardInquiryTargetTokenBudget: 50_000,
            risuBardInquiryMaximumTokenBudget: 99_999,
            risuBardInquiryTimeoutMs: expectedTimeout,
        })
    })
})

describe('memory budget defaults migration', () => {
    const base = () => ({
        characters: [], formatingOrder: ['main'], loreBook: [], personas: [],
        username: 'User', userIcon: '', userNote: '',
    })
    const oldDefaults = {
        risuBardInquiryTargetTokenBudget: 2000,
        risuBardInquiryEventTokenBudget: 2000,
        risuBardInquirySourceTokenBudget: 2000,
        risuBardInquiryMaximumTokenBudget: 6000,
        risuBardDynamicMemoryMode: 'off',
        risuBardDynamicMemoryMaximumTokens: 12000,
    }
    const standard = {
        risuBardInquiryTargetTokenBudget: 4000,
        risuBardInquiryEventTokenBudget: 3000,
        risuBardInquirySourceTokenBudget: 2000,
        risuBardInquiryMaximumTokenBudget: 7500,
        risuBardDynamicMemoryMode: 'economy',
        risuBardDynamicMemoryMaximumTokens: 12000,
    }

    test('moves untouched old defaults to the standard tier once and stamps the version', () => {
        setDatabase({ ...base(), ...oldDefaults } as any)
        expect(getDatabase()).toMatchObject({ ...standard, risuBardMemoryBudgetDefaultsVersion: 2 })
        setDatabase(JSON.parse(JSON.stringify(getDatabase())))
        expect(getDatabase()).toMatchObject({ ...standard, risuBardMemoryBudgetDefaultsVersion: 2 })
    })

    test('treats absent values as the old defaults, including a never configured database', () => {
        setDatabase(base() as any)
        expect(getDatabase()).toMatchObject({ ...standard, risuBardMemoryBudgetDefaultsVersion: 2 })
        setDatabase({ ...base(), risuBardInquiryTargetTokenBudget: 2000, risuBardInquiryMaximumTokenBudget: 6000 } as any)
        expect(getDatabase()).toMatchObject({ ...standard, risuBardMemoryBudgetDefaultsVersion: 2 })
    })

    test('leaves customized globals untouched and still stamps the version', () => {
        setDatabase({ ...base(), ...oldDefaults, risuBardInquiryTargetTokenBudget: 3000 } as any)
        expect(getDatabase()).toMatchObject({ ...oldDefaults, risuBardInquiryTargetTokenBudget: 3000, risuBardMemoryBudgetDefaultsVersion: 2 })
        setDatabase({ ...base(), ...oldDefaults, risuBardDynamicMemoryMode: 'balanced' } as any)
        expect(getDatabase()).toMatchObject({ ...oldDefaults, risuBardDynamicMemoryMode: 'balanced', risuBardMemoryBudgetDefaultsVersion: 2 })
    })

    test('does not migrate again when the version is already current, e.g. old values picked via custom', () => {
        setDatabase({ ...base(), ...oldDefaults, risuBardMemoryBudgetDefaultsVersion: 2 } as any)
        expect(getDatabase()).toMatchObject({ ...oldDefaults, risuBardMemoryBudgetDefaultsVersion: 2 })
        setDatabase({ ...base(), ...oldDefaults, risuBardMemoryBudgetDefaultsVersion: 5 } as any)
        expect(getDatabase()).toMatchObject({ ...oldDefaults, risuBardMemoryBudgetDefaultsVersion: 5 })
        setDatabase({ ...base(), ...oldDefaults, risuBardMemoryBudgetDefaultsVersion: 1 } as any)
        expect(getDatabase()).toMatchObject({ ...standard, risuBardMemoryBudgetDefaultsVersion: 2 })
    })

    test('never touches bot-pinned or chat-level copies', () => {
        const pinned = { ...oldDefaults, risuBardResponseMessageCount: 5 }
        const chatSettings = { ...oldDefaults }
        setDatabase({
            ...base(), ...oldDefaults,
            characters: [{ chaId: 'migration', name: 'Migration', risuBardPinnedSettings: pinned, chats: [{ id: 'chat', message: [], risuBardSettings: chatSettings }] }],
        } as any)
        const database = getDatabase()
        expect(database).toMatchObject({ ...standard, risuBardMemoryBudgetDefaultsVersion: 2 })
        expect(database.characters[0].risuBardPinnedSettings).toEqual(pinned)
        expect(database.characters[0].chats[0].risuBardSettings).toEqual(chatSettings)
    })
})
