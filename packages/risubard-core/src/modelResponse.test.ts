import { describe, expect, it, vi } from 'vitest'
import { parseSingleJsonObject } from './modelOutput'
import {
    ModelOutputError,
    NativeStructuredOutputUnavailableError,
    readModelResponseText,
    runStructuredModelRequest,
    runValidatedModelRequest,
} from './modelResponse'

describe('model response quality', () => {
    it.each(['length', 'max_tokens', 'MAX_TOKENS', 'max_output_tokens'])
    ('rejects truncated output even if it contains valid JSON: %s', (finishReason) => {
        expect(() => readModelResponseText({ type: 'success', result: '{}', finishReason }))
            .toThrow(expect.objectContaining({ reason: 'truncated' }))
    })

    it.each(['SAFETY', 'content_filter', 'refusal'])
    ('names the provider finish reason when generation is blocked: %s', (finishReason) => {
        expect(() => readModelResponseText({ type: 'success', result: 'partial', finishReason }))
            .toThrow(`모델 제공자가 응답 생성을 중단했습니다. (종료 사유: ${finishReason})`)
    })

    it.each(['', '   ', '<think>unfinished', '<Thoughts>only reasoning</Thoughts>'])
    ('rejects empty or reasoning-only responses: %s', (result) => {
        expect(() => readModelResponseText({ type: 'success', result }))
            .toThrow(expect.objectContaining({ reason: 'empty' }))
    })

    it('retains a complete answer and strips only leading reasoning', () => {
        expect(readModelResponseText({ type: 'success', result: '<think>draft</think>\n{"ok":true}', finishReason: 'stop' }))
            .toBe('{"ok":true}')
    })

    it('repairs invalid output once with typed feedback', async () => {
        const request = vi.fn(async (feedback?: ModelOutputError) => ({
            type: 'success', result: feedback ? '{"ok":true}' : 'not JSON',
        }))
        expect(await runValidatedModelRequest({ request, parse: parseSingleJsonObject }))
            .toEqual({ ok: true })
        expect(request).toHaveBeenCalledTimes(2)
        expect(request.mock.calls[1][0]).toBeInstanceOf(ModelOutputError)
    })

    it('stops after two invalid results without exposing model content', async () => {
        const request = vi.fn(async () => ({ type: 'success', result: 'private story text' }))
        await expect(runValidatedModelRequest({ request, parse: parseSingleJsonObject }))
            .rejects.toThrow('응답 형식')
        expect(request).toHaveBeenCalledTimes(2)
    })

    it('keeps bounded validator feedback private for repair prompts', async () => {
        const request = vi.fn(async () => ({
            type: 'success',
            result: '{"private story text":true}',
        }))
        const parse = vi.fn(() => {
            throw new Error('Unexpected field: private story text')
        })

        const error = await runValidatedModelRequest({ request, parse })
            .catch((caught) => caught as ModelOutputError)
        expect(error.validationHint)
            .toBe('Unexpected field: private story text')
        expect(error.message).not.toContain('private story text')
    })

    it('retries a typed output failure raised at the request boundary', async () => {
        const request = vi.fn(async (feedback?: ModelOutputError) => {
            if (!feedback) throw new ModelOutputError('truncated')
            return { type: 'success', result: '{"ok":true}' }
        })
        await expect(runValidatedModelRequest({ request, parse: parseSingleJsonObject }))
            .resolves.toEqual({ ok: true })
        expect(request).toHaveBeenCalledTimes(2)
    })

    it.each(['auth', 'aborted', 'rate limit'])('does not replay request failures: %s', async (message) => {
        const request = vi.fn(async () => { throw new Error(message) })
        await expect(runValidatedModelRequest({ request, parse: parseSingleJsonObject }))
            .rejects.toThrow(message)
        expect(request).toHaveBeenCalledTimes(1)
    })

    it('does not retry failed responses or provider refusals', async () => {
        for (const response of [
            { type: 'fail', result: '인증 실패' },
            { type: 'success', result: '', finishReason: 'content_filter' },
            { type: 'success', result: '', finishReason: 'SAFETY' },
        ]) {
            const request = vi.fn(async () => response)
            await expect(runValidatedModelRequest({ request, parse: parseSingleJsonObject })).rejects.toThrow()
            expect(request).toHaveBeenCalledTimes(1)
        }
    })

    it.each([{ noRetry: true }, { toolExecuted: true }])
    ('never replays a result marked non-replayable: %s', async (flags) => {
        const request = vi.fn(async () => ({ type: 'success', result: 'not JSON', ...flags }))
        await expect(runValidatedModelRequest({ request, parse: parseSingleJsonObject })).rejects.toThrow()
        expect(request).toHaveBeenCalledTimes(1)
    })

    it('allows a batch owner to disable repair before splitting', async () => {
        const request = vi.fn(async () => ({ type: 'success', result: '{', finishReason: 'length' }))
        await expect(runValidatedModelRequest({ request, parse: parseSingleJsonObject, maxAttempts: 1 }))
            .rejects.toThrow(expect.objectContaining({ reason: 'truncated' }))
        expect(request).toHaveBeenCalledTimes(1)
    })
})

describe('structured model response recovery', () => {
    it('returns a valid native response without falling back', async () => {
        const request = vi.fn(async () => ({
            type: 'success', result: '{"ok":true}',
        }))

        await expect(runStructuredModelRequest({
            request,
            parse: parseSingleJsonObject,
        })).resolves.toEqual({ ok: true })
        expect(request).toHaveBeenCalledTimes(1)
        expect(request.mock.calls[0][0]).toBe('native')
    })

    it('keeps the corrected native response when validation repair succeeds', async () => {
        const request = vi.fn(async (_mode, feedback?: ModelOutputError) => ({
            type: 'success', result: feedback ? '{"ok":true}' : 'not JSON',
        }))

        await expect(runStructuredModelRequest({
            request,
            parse: parseSingleJsonObject,
        })).resolves.toEqual({ ok: true })
        expect(request.mock.calls.map(([mode]) => mode))
            .toEqual(['native', 'native'])
    })

    it('falls back once after corrected native output still fails validation', async () => {
        const request = vi.fn(async (mode) => ({
            type: 'success',
            result: mode === 'prompt' ? '{"ok":true}' : 'not JSON',
        }))

        await expect(runStructuredModelRequest({
            request,
            parse: parseSingleJsonObject,
        })).resolves.toEqual({ ok: true })
        expect(request.mock.calls.map(([mode]) => mode))
            .toEqual(['native', 'native', 'prompt'])
        expect(request.mock.calls[2][1]).toBeInstanceOf(ModelOutputError)
    })

    it('falls back immediately when the provider rejects native schema', async () => {
        const request = vi.fn(async (mode) => {
            if (mode === 'native') {
                throw new NativeStructuredOutputUnavailableError()
            }
            return { type: 'success', result: '{"ok":true}' }
        })

        await expect(runStructuredModelRequest({
            request,
            parse: parseSingleJsonObject,
        })).resolves.toEqual({ ok: true })
        expect(request.mock.calls.map(([mode]) => mode))
            .toEqual(['native', 'prompt'])
    })

    it('does not retry an invalid prompt-schema fallback', async () => {
        const request = vi.fn(async (mode) => {
            if (mode === 'native') {
                throw new NativeStructuredOutputUnavailableError()
            }
            return { type: 'success', result: 'not JSON' }
        })

        await expect(runStructuredModelRequest({
            request,
            parse: parseSingleJsonObject,
        })).rejects.toThrow('응답 형식')
        expect(request.mock.calls.map(([mode]) => mode))
            .toEqual(['native', 'prompt'])
    })

    it.each([{ noRetry: true }, { toolExecuted: true }])
    ('does not fall back after a non-replayable native result: %s', async (flags) => {
        const request = vi.fn(async () => ({
            type: 'success', result: 'not JSON', ...flags,
        }))

        await expect(runStructuredModelRequest({
            request,
            parse: parseSingleJsonObject,
        })).rejects.toThrow('응답 형식')
        expect(request).toHaveBeenCalledTimes(1)
    })

    it('does not convert ordinary request failures into schema fallback', async () => {
        const request = vi.fn(async () => {
            throw new Error('rate limit')
        })

        await expect(runStructuredModelRequest({
            request,
            parse: parseSingleJsonObject,
        })).rejects.toThrow('rate limit')
        expect(request).toHaveBeenCalledTimes(1)
    })
})
