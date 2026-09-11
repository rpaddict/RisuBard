import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
    db: {
        subModel: 'reverse_proxy',
        seperateModelsForAxModels: false,
        seperateModels: {},
        forceReplaceUrl: '',
        customModels: [],
        hypaV3PresetId: 0,
        hypaV3Presets: [{
            name: 'Test',
            settings: {
                summarizationModel: 'subModel',
                summarizationPrompt: '',
                reSummarizationPrompt: '',
            },
        }],
    },
    requestChatData: vi.fn(),
}))

vi.mock('src/ts/storage/database.svelte', () => ({
    getDatabase: () => mocks.db,
}))
vi.mock('../request/request', () => ({
    requestChatData: mocks.requestChatData,
}))
vi.mock('../webllm', () => ({
    chatCompletion: vi.fn(),
    unloadEngine: vi.fn(),
}))
vi.mock('src/ts/stores.svelte', () => ({
    hypaV3ProgressStore: { set: vi.fn() },
    DBState: { db: mocks.db },
    selIdState: { selId: -1 },
}))
vi.mock('./hypamemory', () => ({
    HypaProcesser: class {}, similarity: vi.fn(), contextHash: vi.fn(),
    getPersistedHypaVector: vi.fn(), setPersistedHypaVector: vi.fn(),
}))
vi.mock('./contextualEmbedding', () => ({
    isContextModel: vi.fn(), getContextProvider: vi.fn(),
}))
vi.mock('./hypamemoryv2', () => ({ HypaProcessorV2: class {} }))
vi.mock('./taskRateLimiter', () => ({ TaskRateLimiter: class {} }))
vi.mock('../request/modelPresetBinding', () => ({
    resolveChatMaxResponseTokens: vi.fn(),
}))

const { summarize } = await import('./hypav3')

describe('HypaV3 auxiliary request compatibility', () => {
    beforeEach(() => {
        mocks.requestChatData.mockReset()
        mocks.requestChatData.mockResolvedValue({
            type: 'success',
            result: 'summary',
        })
    })

    test('ends a custom ChatML summary request with a user turn', async () => {
        mocks.db.hypaV3Presets[0].settings.summarizationPrompt = [
            '<|im_start|>system<|im_sep|>Summarize the scene.<|im_end|>',
            '<|im_start|>assistant<|im_sep|>{{slot}}<|im_end|>',
        ].join('')

        await summarize([{ role: 'assistant', content: 'The gate opened.' }])

        const request = mocks.requestChatData.mock.calls[0][0]
        expect(request.formated.at(-1)).toEqual({
            role: 'user',
            content: 'Summarize the conversation above.',
        })
    })
})
