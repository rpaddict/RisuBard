import { ModelPresetAdapterError } from '../../preset/adapter/error'
import { ModelOutputError } from '../../../../packages/risubard-core/src/modelResponse'

export function normalizeRequestRetryLimit(value: number): number {
    return Number.isFinite(value) ? Math.min(20, Math.max(0, Math.floor(value))) : 0
}

export function isRetryableTransportError(
    error: unknown,
    aborted = false
): boolean {
    if (aborted) return false
    const value = error as { name?: unknown; message?: unknown; code?: unknown }
    const name = typeof value?.name === 'string' ? value.name : ''
    if (name === 'AbortError' || name === 'TimeoutError' || name === 'NetworkError') {
        return true
    }
    const code = typeof value?.code === 'string' ? value.code : ''
    if (/^(?:ECONN|ENET|EHOST|ETIMEDOUT|EAI_AGAIN|UND_ERR_)/.test(code)) {
        return true
    }
    const message = typeof value?.message === 'string'
        ? value.message
        : typeof error === 'string' ? error : ''
    return /failed to fetch|fetch failed|network error|load failed|timed? out|timeout|socket (?:closed|hang up)/i.test(message)
}

export function filterResponseCharacters<T extends { type: string; result: unknown; noRetry?: boolean; toolExecuted?: boolean }>(response: T, scripts: readonly string[]): T | { type: 'fail'; result: string } {
    if (response.type !== 'success' || typeof response.result !== 'string'
        || response.noRetry || response.toolExecuted) return response
    for (const script of scripts) {
        let pattern: RegExp
        try { pattern = new RegExp(`\\p{Script=${script}}`, 'u') }
        catch { continue } // Old/imported settings may contain unsupported scripts.
        if (pattern.test(response.result)) {
            return { ...response, type: 'fail', result: '응답에 금지된 문자 집합이 포함되어 생성에 실패했습니다.' }
        }
    }
    return response
}

export function presetFailureRetryPolicy(error: unknown, aborted = false): { noRetry?: boolean; fallbackEligible?: boolean } {
    if (aborted || (error instanceof Error && error.name === 'AbortError')) {
        return { noRetry: true, fallbackEligible: false }
    }
    if (error instanceof ModelOutputError && !error.retryable) {
        return { noRetry: true, fallbackEligible: false }
    }
    return error instanceof ModelPresetAdapterError
        ? { noRetry: !error.retryable, fallbackEligible: error.fallbackEligible }
        : {}
}

const THOUGHTS_BLOCK = /<Thoughts>[\s\S]*?<\/Thoughts>/g

// A reply that holds only the model's native reasoning (the <Thoughts> block
// the request layer adds) and no answer text after it. Gemini Flash sometimes
// ends a turn right after thinking; the raw text is non-empty, so without this
// check it counts as a success and the chat shows an empty message.
export function isReasoningOnlyResponse(text: unknown): boolean {
    if (typeof text !== 'string' || !text.includes('<Thoughts>')) return false
    return text.replace(THOUGHTS_BLOCK, '').trim() === ''
}

type ChunkStream = ReadableStream<Record<string, string>>

function singleChunkStream(text: string): ChunkStream {
    return new ReadableStream({
        start(controller) {
            controller.enqueue({ '0': text })
            controller.close()
        },
    })
}

// Passes a streamed reply through; when it ends with reasoning only, requests
// again (up to maxRetries) and keeps streaming the new reply in its place.
// Stream chunks are full snapshots, so the next reply simply overwrites the
// previous text. If every attempt is reasoning only, the last one is kept.
export function retryReasoningOnlyStream(
    first: ChunkStream,
    retry: () => Promise<{ type: string; result: unknown }>,
    maxRetries: number,
    abortSignal?: AbortSignal | null,
): ChunkStream {
    let reader = first.getReader()
    let lastText = ''
    let retries = 0
    return new ReadableStream({
        async pull(controller) {
            while (true) {
                const { done, value } = await reader.read()
                if (!done) {
                    if (!value) continue
                    const key = Object.keys(value)[0]
                    lastText = key === undefined ? '' : (value[key] ?? '')
                    controller.enqueue(value)
                    return
                }
                if (abortSignal?.aborted || retries >= maxRetries || !isReasoningOnlyResponse(lastText)) {
                    controller.close()
                    return
                }
                retries += 1
                console.warn(`[request] reply had reasoning but no answer; retrying (${retries}/${maxRetries})`)
                let next: { type: string; result: unknown }
                try {
                    next = await retry()
                } catch (error) {
                    console.error('[request] retry after reasoning-only reply failed', error)
                    controller.close()
                    return
                }
                if (next.type === 'streaming' && next.result instanceof ReadableStream) {
                    reader = (next.result as ChunkStream).getReader()
                } else if (next.type === 'success' && typeof next.result === 'string') {
                    reader = singleChunkStream(next.result).getReader()
                } else {
                    controller.close()
                    return
                }
            }
        },
        cancel(reason) {
            return reader.cancel(reason)
        },
    })
}
