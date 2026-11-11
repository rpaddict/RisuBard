import { describe, expect, it } from 'vitest'
import { preparePresetResponse, presetGenerationOverrides } from './presetResponse'

describe('preset generation response boundary', () => {
    const options = { internal: false, model: 'model', formatReasoning: () => '<Thoughts>thinking</Thoughts>' }
    it('keeps finish reason and usage for internal validation without mixing reasoning into JSON', () => {
        expect(preparePresetResponse({ text: '{}', raw: {}, reasoning: [{ text: 'thinking' }], finishReason: 'length', usage: { completionTokens: 12 } }, { ...options, internal: true }))
            .toMatchObject({ type: 'success', result: '{}', finishReason: 'length', usage: { completionTokens: 12 } })
    })
    it('does not mistake a thinking-only chat response for a completed answer', () => {
        expect(preparePresetResponse({ text: '', reasoning: [{ text: 'thinking' }], raw: {} }, options)).toMatchObject({ type: 'fail' })
    })
    it('preserves normal chat reasoning and partial answers at the output limit', () => {
        expect(preparePresetResponse({ text: 'answer', raw: {}, finishReason: 'length' }, options))
            .toMatchObject({ type: 'success', result: '<Thoughts>thinking</Thoughts>answer', finishReason: 'length' })
    })
    it('does not retry an explicit provider refusal', () => {
        expect(preparePresetResponse({ text: '', raw: {}, finishReason: 'content_filter' }, options))
            .toMatchObject({ type: 'fail', noRetry: true })
    })
    it('does not accept a token-limited inline-thinking-only chat', () => {
        expect(preparePresetResponse({ text: '<think>reasoning only</think>', raw: {}, finishReason: 'length' }, options).type)
            .toBe('fail')
    })
    it('keeps a finished chat whose leading thinking tag never closes', () => {
        expect(preparePresetResponse({ text: '<think>plan\n\nThe answer body.', raw: {}, finishReason: 'stop' }, options))
            .toMatchObject({ type: 'success', result: '<Thoughts>thinking</Thoughts><think>plan\n\nThe answer body.' })
        expect(preparePresetResponse({ text: '<think>reasoning only</think>', raw: {}, finishReason: 'stop' }, options).type)
            .toBe('fail')
    })
    it('forwards wiki controls even for Markdown, but leaves ordinary chat preset defaults alone', () => {
        expect(presetGenerationOverrides({ logSource: 'memory', temperature: 0, maxTokens: 4096 }))
            .toEqual({ temperature: 0, maxOutputTokens: 4096 })
        expect(presetGenerationOverrides({ schema: '{}', temperature: 0, maxTokens: 12000 }))
            .toEqual({ temperature: 0, maxOutputTokens: 12000 })
        expect(presetGenerationOverrides({ temperature: 0.7, maxTokens: 1000 })).toEqual({})
    })
})
