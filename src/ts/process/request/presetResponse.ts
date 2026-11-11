import type { AdapterChatResponse, AdapterChatOptions } from '../../preset/adapter'
import { ModelOutputError, readModelResponseText } from '../../../../packages/risubard-core/src/modelResponse'
import { stripClosedModelReasoning, stripModelReasoning } from '../../../../packages/risubard-core/src/modelOutput'

export function presetGenerationOverrides(arg: { schema?: string; logSource?: string; temperature?: number; maxTokens?: number }): Pick<AdapterChatOptions, 'temperature' | 'maxOutputTokens'> {
    return arg.schema || arg.logSource === 'memory'
        ? { temperature: arg.temperature, maxOutputTokens: arg.maxTokens }
        : {}
}

export function preparePresetResponse(response: AdapterChatResponse, options: {
    internal: boolean; model: string
    formatReasoning: (parts: AdapterChatResponse['reasoning']) => string
}) {
    const metadata = { model: options.model, finishReason: response.finishReason, usage: response.usage }
    // Internal callers own validation/repair; preserve even an empty or limited
    // response so the request loop cannot multiply their bounded retry budget.
    if (!options.internal) {
        try {
            readModelResponseText({ type: 'success', result: response.text, finishReason: response.finishReason })
        } catch (error) {
            // Normal chat may display the useful partial answer; wiki cannot.
            if (!(error instanceof ModelOutputError && (
                (error.reason === 'truncated' && stripModelReasoning(response.text).trim())
                || (error.reason === 'empty' && stripClosedModelReasoning(response.text).trim())
            ))) {
                return { type: 'fail' as const, result: (error as Error).message,
                    noRetry: error instanceof ModelOutputError && !error.retryable, ...metadata }
            }
        }
    }
    return { type: 'success' as const,
        result: (options.internal ? '' : options.formatReasoning(response.reasoning)) + response.text,
        ...metadata }
}
