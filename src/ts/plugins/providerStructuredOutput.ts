import type { PluginResponseMetadata } from '../process/request/pluginResponse'

export interface PluginProviderStructuredOutput {
    name: string
    strict: boolean
    schema: Record<string, unknown>
}

export type PluginStructuredOutputOption = boolean | (() => boolean)

const SCHEMA_ERROR_MARKERS = [
    'json_schema',
    'response_format',
    'response format',
    'response_schema',
    'response schema',
    'responsejsonschema',
    'responseschema',
    'structured output',
    'structured-output',
    'responsemime',
    'response mime',
]

const OUTPUT_VALIDATION_ERROR_MARKERS = [
    'structured output validation failed',
    'structured-output validation failed',
]

const PAGEFOLD_WRAPPED_PROVIDER_ERROR = /^\[pagefold\]\s+provider returned error\.?$/i

export const pluginStructuredOutputRepairMessage = [
    'The previous model output failed validation against the supplied JSON Schema.',
    'Generate the complete response again. Return exactly one valid JSON value matching every required field and no commentary.',
].join(' ')

export function resolvePluginStructuredOutput(
    options: { structuredOutput?: PluginStructuredOutputOption } | undefined,
): boolean {
    const value = options?.structuredOutput
    try {
        return typeof value === 'function' ? value() === true : value === true
    }
    catch {
        return false
    }
}

export function createPluginStructuredOutput(
    schema: Record<string, unknown> | undefined,
    strict: boolean,
    context?: { provider: string; purpose?: string },
): PluginProviderStructuredOutput | undefined {
    if (!schema) return undefined
    // PageFold Gemini analysis uses prompt-schema compatibility mode. Match the
    // provider family, including legacy google-gemini IDs, independently of the
    // model version, route suffix, or profile number.
    // requestPlugin still supplies the schema prompt and structured_output flag;
    // BardWiki keeps validating the returned JSON before saving it.
    if (context?.purpose === 'bardwiki-analysis'
        && /^pagefold-(?:google-)?gemini-.+/.test(context.provider)) {
        return undefined
    }
    return {
        name: 'risubard_response',
        strict,
        schema,
    }
}

export type PluginProviderResponse = PluginResponseMetadata & {
    success: boolean
    content: string | ReadableStream<string>
}

export async function normalizePluginStructuredOutputFailure(
    response: PluginProviderResponse | undefined,
): Promise<PluginProviderResponse | undefined> {
    if (!response || response.success || typeof response.content === 'string') return response
    return {
        ...response,
        content: await new Response(response.content).text(),
    }
}

export function isPluginStructuredOutputRejection(
    response: PluginProviderResponse | undefined,
): boolean {
    if (!response || response.success || typeof response.content !== 'string') return false
    if (isPluginStructuredOutputValidationFailure(response)) return false
    const message = response.content.toLowerCase()
    return SCHEMA_ERROR_MARKERS.some((marker) => message.includes(marker))
}

export function isPluginStructuredOutputValidationFailure(
    response: PluginProviderResponse | undefined,
): boolean {
    if (!response || response.success || typeof response.content !== 'string') return false
    const message = response.content.toLowerCase()
    return OUTPUT_VALIDATION_ERROR_MARKERS.some((marker) => message.includes(marker))
}

export function shouldFallbackFromNativeStructuredOutput(
    response: PluginProviderResponse | undefined,
): boolean {
    return isPluginStructuredOutputValidationFailure(response)
        || isPluginStructuredOutputRejection(response)
        || Boolean(response && !response.success
            && typeof response.content === 'string'
            && (/\binvalid[_ ]argument\b/i.test(response.content)
                || PAGEFOLD_WRAPPED_PROVIDER_ERROR.test(response.content.trim())))
}
