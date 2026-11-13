import { readFileSync } from 'node:fs'
import { describe, expect, test, vi } from 'vitest'
import {
    CONTEXT_FIT_CAPABILITIES,
    hasRequiredPluginContext,
    getContextFitRequestState,
    registerContextFitReplacer,
    runPluginContextFit,
    stripPluginContextFitMarkers,
    type ContextFitMessage,
    type ContextFitReplacer,
} from './pluginContextFit'

describe('plugin context before native fitting', () => {
    test('preserves required context and cleans up a registered callback', async () => {
        const hooks = new Set<ContextFitReplacer<ContextFitMessage>>()
        const callback = vi.fn(async (messages: ContextFitMessage[]) => [
            { role: 'system', content: 'Required wiki', requiredContext: true, removable: true },
            ...messages,
        ])
        const cleanup = registerContextFitReplacer(hooks, callback)
        const original: ContextFitMessage[] = [{ role: 'user', content: 'Question', removable: true }]
        const prepared = await runPluginContextFit(original, hooks)
        expect(prepared[0]).toMatchObject({ requiredContext: true, removable: false })
        expect(prepared[1]).toBe(original[0])
        const delivered = stripPluginContextFitMarkers(prepared)
        expect(delivered[0]).not.toHaveProperty('requiredContext')
        expect(delivered[0]).toMatchObject({ content: 'Required wiki', removable: false })
        expect(delivered[1]).toBe(original[0])
        expect(hasRequiredPluginContext(prepared)).toBe(true)
        expect(callback).toHaveBeenCalledExactlyOnceWith(original, 'model')
        cleanup()
        expect(await runPluginContextFit(original, hooks)).toEqual(original)
        expect(callback).toHaveBeenCalledTimes(1)
    })

    test('chains each hook once and rejects invalid output before a request is sent', async () => {
        const first = vi.fn((messages: ContextFitMessage[]) => [...messages, { role: 'system', content: 'One' }])
        const second = vi.fn((messages: ContextFitMessage[]) => [...messages, { role: 'system', content: 'Two' }])
        expect((await runPluginContextFit([], [first, second])).map(item => item.content)).toEqual(['One', 'Two'])
        expect(first).toHaveBeenCalledTimes(1)
        expect(second).toHaveBeenCalledTimes(1)
        await expect(runPluginContextFit([], [async () => null as unknown as ContextFitMessage[]])).rejects.toThrow('invalid prompt messages')
        expect(hasRequiredPluginContext([{ role: 'system', content: 'Ordinary' }])).toBe(false)
        expect(CONTEXT_FIT_CAPABILITIES).toEqual({ version: 1, hook: 'beforeContextFit', requiredContext: true, requestState: true })
    })

    test('exposes an isolated request state and stops waiting when generation is cancelled', async () => {
        const controller = new AbortController()
        let requestId = ''
        const callback: ContextFitReplacer<ContextFitMessage> = (_messages, _type, request) => {
            requestId = request?.requestId ?? ''
            expect(getContextFitRequestState(requestId)).toEqual({ requestId, status: 'active' })
            return new Promise(() => {})
        }
        const pending = runPluginContextFit([], [callback], controller.signal)
        expect(requestId).not.toBe('')
        controller.abort()
        expect(getContextFitRequestState(requestId)).toEqual({ requestId, status: 'aborted' })
        await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
        expect(getContextFitRequestState(requestId)).toBeNull()
    })

    test('expires a completed hook request and skips already cancelled invocations', async () => {
        const controller = new AbortController()
        let requestId = ''
        const callback = vi.fn((_messages, _type, request) => {
            requestId = request.requestId
            return []
        })
        await runPluginContextFit([], [callback], controller.signal)
        expect(getContextFitRequestState(requestId)).toBeNull()
        controller.abort()
        await expect(runPluginContextFit([], [callback], controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
        expect(callback).toHaveBeenCalledTimes(1)
    })

    test('places the hook before token counting while retaining native chat removal and response reserve', () => {
        const source = readFileSync('src/ts/process/index.svelte.ts', 'utf8')
        const call = 'await runPluginContextFit(formated, pluginV2.replacerbeforeContextFit, abortSignal)'
        expect(source.split(call)).toHaveLength(2)
        expect(source.indexOf(call)).toBeGreaterThan(source.indexOf('else if (requiredWikiMessage) formated.unshift(requiredWikiMessage)'))
        expect(source.indexOf(call)).toBeLessThan(source.indexOf('//token rechecking'))
        expect(source).toContain('requiredWikiMessage || hasRequiredPluginContext(formated)')
        expect(source).toContain('? maxContextTokens - maxResponseTokens : maxContextTokens')
        expect(source).toContain('if(formated[pointer].removable){')
        expect(source.indexOf('formated = stripPluginContextFitMarkers(formated)')).toBeGreaterThan(source.indexOf('const inputTokenLimit ='))
        const request = readFileSync('src/ts/process/request/request.ts', 'utf8')
        expect(request).not.toContain('runPluginContextFit')
        const bridge = readFileSync('src/ts/plugins/apiV3/v3.svelte.ts', 'utf8')
        expect(bridge).toContain('getContextFitCapabilities: oldApis.getContextFitCapabilities')
        expect(bridge).toContain('addPluginUnloadCallback(plugin.name, cleanup)')
    })
})
