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
