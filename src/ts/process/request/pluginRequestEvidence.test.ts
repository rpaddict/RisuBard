import { describe, expect, it, vi } from 'vitest'
import {
    createPluginRequestEvidenceRecorder,
    formatPluginProviderFailure,
} from './pluginRequestEvidence'
import * as pluginRequestLifecycle from './pluginRequestEvidence'

describe('plugin request evidence recorder', () => {
    it('ends a plugin provider call that never settles when the host timeout expires', async () => {
        const run = (pluginRequestLifecycle as unknown as {
            runPluginProviderWithTimeout?: <T>(
                invoke: (signal: AbortSignal) => Promise<T>,
                timeoutMs: number,
                abortSignal?: AbortSignal | null,
            ) => Promise<T>
        }).runPluginProviderWithTimeout
        expect(run).toBeTypeOf('function')

        vi.useFakeTimers()
        try {
            let receivedSignal: AbortSignal | undefined
            const pending = run!(signal => {
                receivedSignal = signal
                return new Promise(() => {})
            }, 50)
            const rejected = expect(pending).rejects.toThrow(
                'Plugin provider request timed out after 50ms'
            )

            await vi.advanceTimersByTimeAsync(50)

            await rejected
            expect(receivedSignal?.aborted).toBe(true)
        } finally {
            vi.useRealTimers()
        }
    })

    it('preserves a bounded Error message instead of serializing it as an empty object', () => {
        expect(formatPluginProviderFailure(
            'pagefold-gemini-3.7-flash',
            new Error('Upstream request timed out after 300000ms')
        )).toBe(
            'Plugin Error from pagefold-gemini-3.7-flash: Upstream request timed out after 300000ms'
        )
    })

    it('records plugin input and output with locally counted output tokens', async () => {
        const record = vi.fn()
        const recorder = createPluginRequestEvidenceRecorder({
            startedAt: 1_000,
            source: 'wiki-admin',
            purpose: 'bardwiki-admin',
            sessionChatId: 'chat-1',
            generationId: 'generation-1',
            model: 'pluginmodel:::gemini',
            provider: 'gemini',
            injectionManifest: {
                totalTokens: 31,
                estimated: true,
                items: [{ kind: 'wiki', tokens: 31 }],
            },
        }, {
            now: () => 1_250,
            countTokens: async (text) => text.length,
            record,
        })

        recorder.setRequestBody({ prompt_chat: [{ role: 'user', content: 'hello' }], max_tokens: 100 })
        recorder.markFirstToken(1_100)
        await recorder.finish({ success: true, streaming: true, output: 'done' })

        expect(record).toHaveBeenCalledWith(expect.objectContaining({
            timestamp: 1_000,
            category: 'llm',
            source: 'wiki-admin',
            purpose: 'bardwiki-admin',
            sessionChatId: 'chat-1',
            generationId: 'generation-1',
            inputTokens: 31,
            outputTokens: 4,
            firstTokenMs: 100,
            durationMs: 250,
            success: true,
            streaming: true,
        }))
        expect(record.mock.calls[0][0].responseBody).toBe('done')
        expect(JSON.parse(record.mock.calls[0][0].requestBody)).toEqual({ prompt_chat: [{ role: 'user', content: 'hello' }], max_tokens: 100 })
        await recorder.finish({ success: true, streaming: false, output: 'duplicate' })
        expect(record).toHaveBeenCalledTimes(1)
    })
    it('records the final retry input and error response without interrupting on unserializable input', async () => {
        const record = vi.fn()
        const recorder = createPluginRequestEvidenceRecorder({ startedAt: 0, source: 'main', generationId: 'g', model: 'm', provider: 'p' }, { record, countTokens: async () => 0 })
        recorder.setRequestBody({ prompt_chat: ['first'] })
        recorder.setRequestBody({ prompt_chat: ['repair'] })
        await recorder.finish({ success: false, streaming: false, errorMessage: 'provider refused' })
        expect(JSON.parse(record.mock.calls[0][0].requestBody).prompt_chat).toEqual(['repair'])
        expect(record.mock.calls[0][0].responseBody).toBe('provider refused')
        const other = createPluginRequestEvidenceRecorder({ startedAt: 0, source: 'main', generationId: 'g', model: 'm', provider: 'p' }, { record, countTokens: async () => 0 })
        expect(() => other.setRequestBody({ toJSON() { throw new Error('cannot serialize') } })).not.toThrow()
    })
    it('prefers provider-reported usage over local estimates', async () => {
        const record = vi.fn()
        const recorder = createPluginRequestEvidenceRecorder(
            { startedAt: 0, source: 'main', generationId: 'g', model: 'm', provider: 'p', injectionManifest: { totalTokens: 900, items: [], estimated: true } },
            { record, countTokens: async () => 7 },
        )
        await recorder.finish({ success: true, streaming: true, output: 'answer', usage: { promptTokens: 1000, completionTokens: 50, cachedTokens: 800 } })
        expect(record).toHaveBeenCalledWith(expect.objectContaining({ inputTokens: 1000, outputTokens: 50, cachedTokens: 800 }))
        expect(record.mock.calls[0][0]).not.toHaveProperty('reasoningTokens')
    })
    it('keeps the local estimates when the provider reports no usage', async () => {
        const record = vi.fn()
        const recorder = createPluginRequestEvidenceRecorder(
            { startedAt: 0, source: 'main', generationId: 'g', model: 'm', provider: 'p', injectionManifest: { totalTokens: 900, items: [], estimated: true } },
            { record, countTokens: async () => 7 },
        )
        await recorder.finish({ success: true, streaming: false, output: 'answer' })
        expect(record).toHaveBeenCalledWith(expect.objectContaining({ inputTokens: 900, outputTokens: 7 }))
        expect(record.mock.calls[0][0]).not.toHaveProperty('cachedTokens')
    })
    it('preserves streamed partial output alongside interruption errors', async () => {
        const record = vi.fn()
        const recorder = createPluginRequestEvidenceRecorder({ startedAt: 0, source: 'main', generationId: 'g', model: 'm', provider: 'p' }, { record, countTokens: async () => 2 })
        await recorder.finish({ success: false, streaming: true, aborted: true, output: 'partial answer', errorMessage: 'interrupted' })
        expect(record).toHaveBeenCalledWith(expect.objectContaining({ responseBody: 'partial answer', errorMessage: 'interrupted', aborted: true }))
    })
})
