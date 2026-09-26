import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, test } from 'vitest'

async function loadModule() {
    const modulePath = './providerStructuredOutput'
    return import(/* @vite-ignore */ modulePath).catch(() => null)
}

describe('plugin provider structured output contract', () => {
    test('builds a native provider schema only for opted-in providers', async () => {
        const module = await loadModule()
        expect(module).not.toBeNull()
        if (!module) return

        const schema = {
            type: 'object',
            properties: { value: { type: 'string' } },
            required: ['value'],
        }
        expect(module.createPluginStructuredOutput(schema, false)).toEqual({
            name: 'risubard_response',
            strict: false,
            schema,
        })
        expect(module.resolvePluginStructuredOutput(undefined)).toBe(false)
        expect(module.resolvePluginStructuredOutput({ structuredOutput: false })).toBe(false)
        expect(module.resolvePluginStructuredOutput({ structuredOutput: true })).toBe(true)
        expect(module.resolvePluginStructuredOutput({ structuredOutput: () => true })).toBe(true)
    })

    test.each([
        'pagefold-gemini-3.7-flash',
        'pagefold-google-gemini-3.7-flash',
        'pagefold-gemini-3.8-flash-openrouter',
        'pagefold-gemini-3.8-flash-vertex',
        'pagefold-gemini-3.8-flash-vertex-1',
        'pagefold-gemini-3.8-flash-openrouter-1',
        'pagefold-gemini-3.8-flash-openrouter-2',
    ])('omits native schema on the first BardWiki analysis request to %s', async (provider) => {
        const { createPluginStructuredOutput } = await import('./providerStructuredOutput')
        const schema = { type: 'object', properties: { title: { type: 'string' } } }

        expect(createPluginStructuredOutput(schema, false, {
            provider, purpose: 'bardwiki-analysis',
        })).toBeUndefined()
    })

    test.each([
        ['pagefold-gemini-3.7-flash', 'chat-response'],
        ['pagefold-gemini-3.7-flash', 'bardwiki-canonical-update'],
        ['pagefold-google-gemini-3.7-flash', 'bardwiki-canonical-update'],
        ['pagefold-gemini-3.8-flash-vertex-1', 'chat-response'],
        ['pagefold-gemini-3.8-flash-openrouter-1', 'bardwiki-canonical-update'],
        ['pagefold-gemini-3.8-flash-vertex-1', undefined],
        ['pagefold-claude-sonnet-openrouter-1', 'bardwiki-analysis'],
        ['another-gemini-vertex-1', 'bardwiki-analysis'],
        ['gemini-3.7-flash', 'bardwiki-analysis'],
    ])('retains native schema for unaffected requests: %s / %s', async (provider, purpose) => {
        const { createPluginStructuredOutput } = await import('./providerStructuredOutput')
        const schema = { type: 'object', properties: { title: { type: 'string' } } }

        expect(createPluginStructuredOutput(schema, true, { provider, purpose })).toEqual({
            name: 'risubard_response', strict: true, schema,
        })
    })

    test('retries only schema-related native provider failures', async () => {
        const module = await loadModule()
        expect(module).not.toBeNull()
        if (!module) return

        expect(module.isPluginStructuredOutputRejection({
            success: false,
            content: 'Invalid response_format json_schema',
        })).toBe(true)
        expect(module.isPluginStructuredOutputRejection({
            success: false,
            content: 'Unknown name "responseJsonSchema" at generation_config',
        })).toBe(true)
        expect(module.isPluginStructuredOutputRejection({
            success: false,
            content: 'Unknown field responseSchema',
        })).toBe(true)
        const invalidModelOutput = {
            success: false,
            content: '[PageFold] Structured output validation failed: /entries/0 is missing required property atoms',
        }
        expect(module.isPluginStructuredOutputValidationFailure(invalidModelOutput)).toBe(true)
        expect(module.isPluginStructuredOutputRejection(invalidModelOutput)).toBe(false)
        expect(module.shouldFallbackFromNativeStructuredOutput(invalidModelOutput)).toBe(true)
        const ambiguousInvalidArgument = {
            success: false,
            content: '[PageFold] Request contains an invalid argument.',
        }
        expect(module.isPluginStructuredOutputRejection(ambiguousInvalidArgument)).toBe(false)
        expect(module.shouldFallbackFromNativeStructuredOutput(ambiguousInvalidArgument)).toBe(true)
        const pageFoldWrappedProviderError = {
            success: false,
            content: '[PageFold] Provider returned error',
        }
        expect(module.shouldFallbackFromNativeStructuredOutput(pageFoldWrappedProviderError)).toBe(true)
        expect(module.isPluginStructuredOutputRejection({
            success: false,
            content: 'rate limit exceeded',
        })).toBe(false)
        expect(module.isPluginStructuredOutputRejection({
            success: true,
            content: 'schema',
        })).toBe(false)

        const encoder = new TextEncoder()
        const failureStream = new ReadableStream({
            start(controller) {
                controller.enqueue(encoder.encode('Unknown field responseSchema'))
                controller.close()
            },
        }) as unknown as ReadableStream<string>
        const normalized = await module.normalizePluginStructuredOutputFailure({
            success: false,
            content: failureStream,
        })
        expect(normalized?.content).toBe('Unknown field responseSchema')
        expect(module.isPluginStructuredOutputRejection(normalized)).toBe(true)
    })

    test('passes native schema through the plugin API while retaining prompt fallback', () => {
        const request = readFileSync(
            resolve(process.cwd(), 'src/ts/process/request/request.ts'),
            'utf8',
        )
        const runtime = readFileSync(
            resolve(process.cwd(), 'src/ts/plugins/plugins.svelte.ts'),
            'utf8',
        )
        const declarations = readFileSync(
            resolve(process.cwd(), 'src/ts/plugins/apiV3/risuai.d.ts'),
            'utf8',
        )

        expect(runtime).toContain('response_schema?: PluginProviderStructuredOutput')
        expect(runtime).toContain('structured_output?: boolean')
        expect(runtime).toContain('structuredOutput?: boolean | (() => boolean)')
        expect(declarations).toContain('response_schema?: ProviderStructuredOutput;')
        expect(declarations).toContain('structured_output?: boolean;')
        expect(declarations).toContain('structuredOutput?: boolean | (() => boolean);')
        expect(request).toContain('createStructuredOutputFallbackMessage(')
        expect(request).toContain('createPluginStructuredOutput(responseSchema, db.strictJsonSchema, {')
        expect(request).toContain('normalizePluginStructuredOutputFailure(d)')
        expect(request).toContain('structured_output: Boolean(responseSchema)')
        expect(request).toContain('response_schema: nativeStructuredOutput')
        expect(request).toContain('isPluginStructuredOutputValidationFailure(d)')
        expect(request).toContain('pluginStructuredOutputRepairMessage')
        expect(request).toContain('shouldFallbackFromNativeStructuredOutput(d)')
    })
})
