import type { AdapterChatStreamDelta } from "src/ts/preset/adapter"
import { stripClosedModelReasoning, stripModelReasoning } from '../../../../packages/risubard-core/src/modelOutput'
import { ModelOutputError, readModelResponseText } from '../../../../packages/risubard-core/src/modelResponse'

// Stream errors discard queued chunks. Keep the last display snapshot out of
// enumerable error properties/logs, only for the consumer handling that error.
const partialStreamText = new WeakMap<object, string>()

export function getPartialPresetStreamText(error: unknown): string | undefined {
    return error !== null && (typeof error === 'object' || typeof error === 'function')
        ? partialStreamText.get(error) : undefined
}

// Coalesces streaming deltas into throttled renderer flushes.
//
// Adapters yield one delta per token; the chat renderer re-parses the whole
// accumulated message (markdown + sanitize) on every emitted chunk, so emitting
// per token makes re-parse cost scale with token count and stalls slow devices.
// This throttle keeps every delta (the pump accumulates text and exposes it via
// buildChunk) but bounds how often a chunk reaches the renderer:
//
//   - the first delta flushes immediately (lastFlushAt starts at -Infinity),
//   - subsequent deltas flush at most once per intervalMs,
//   - a flush is skipped while the consumer signals backpressure
//     (desiredSize <= 0); since each chunk is the full accumulated text, the
//     skipped snapshot is superseded by the next flush, so no data is lost and
//     stale intermediate snapshots never pile up on a slow renderer,
//   - onEnd forces a final flush, ignoring backpressure, so the last tokens
//     (or a short response that never crossed the interval) always render.
//
// The class is pure aside from the injected effects: its flush decisions are
// driven by an injected clock (`now`) and desiredSize reader, so they are
// unit-testable without real timers. Trailing-timer scheduling lives in the
// pump below.
export class StreamFlushThrottle {
    private lastFlushAt = -Infinity
    private pending = false

    constructor(
        private readonly intervalMs: number,
        private readonly enqueue: (chunk: string) => void,
        private readonly buildChunk: () => string,
        private readonly desiredSize: () => number | null,
    ) {}

    // Call after accumulating a delta. Returns true if a flush is still pending
    // (interval not elapsed, or skipped by backpressure) so the caller arms a
    // trailing timer; false if it flushed and nothing is outstanding.
    onDelta(now: number): boolean {
        this.pending = true
        if (now - this.lastFlushAt >= this.intervalMs) {
            this.flush(now, false)
        }
        return this.pending
    }

    // Call when the trailing timer fires. Returns true if still pending (the
    // flush was skipped by backpressure) so the caller re-arms the timer.
    onTrailing(now: number): boolean {
        this.flush(now, false)
        return this.pending
    }

    // Call when the stream ends. Forces the final chunk out regardless of
    // backpressure so the last accumulated text always reaches the renderer.
    onEnd(now: number): void {
        this.flush(now, true)
    }

    private flush(now: number, force: boolean): void {
        if (!this.pending) {
            return
        }
        if (!force) {
            const ds = this.desiredSize()
            if (ds !== null && ds <= 0) {
                return
            }
        }
        this.enqueue(this.buildChunk())
        this.lastFlushAt = now
        this.pending = false
    }
}

// Minimal slice of ReadableStreamDefaultController the pump needs. A real
// ReadableStreamDefaultController<{[k:string]:string}> satisfies this, and a
// fake one keeps the pump testable without constructing a stream.
export interface StreamChunkController {
    enqueue(chunk: { [key: string]: string }): void
    close(): void
    error(err: unknown): void
    readonly desiredSize: number | null
}

export interface PumpPresetStreamOptions {
    intervalMs: number
    abortSignal?: AbortSignal
    // Wraps accumulated reasoning text for display (e.g. in <Thoughts>). Called
    // only when reasoning is present. Kept injected so the pump stays free of
    // request.ts's formatting/import graph.
    formatReasoning: (reasoningText: string) => string
    // Side-channel for logging the error; controller.error is always called too.
    onError?: (err: unknown) => void
    // Observes each raw delta for status reporting (request-status channel),
    // BEFORE throttling — so token counts and phase reflect every chunk even
    // though the renderer flush is throttled. Injected (not a store import) so
    // the pump stays decoupled; observer errors are isolated. Never affects
    // what is enqueued to the controller.
    onDelta?: (delta: AdapterChatStreamDelta) => void
    // Fires exactly once when the stream ends, with the terminal outcome — the
    // symmetric end signal for status reporting. `lastUsage` carries the final
    // delta's usage (most providers only attach it to the last chunk) so the
    // caller can reconcile token counts. Observer errors never affect output.
    onFinish?: (outcome: 'done' | 'failed', lastUsage?: AdapterChatStreamDelta['usage'], finishReason?: string) => void
}

function observe(callback: () => unknown): void {
    try {
        const result = callback()
        if (result !== undefined) void Promise.resolve(result).catch(() => {})
    } catch {
        // Status/logging failures cannot change delivery or terminal outcome.
    }
}

// Drains an adapter stream into a chunk controller, accumulating text/reasoning
// and emitting throttled, backpressure-aware, trailing-flushed snapshots.
export async function pumpPresetStream(
    gen: AsyncGenerator<AdapterChatStreamDelta, void, void>,
    controller: StreamChunkController,
    options: PumpPresetStreamOptions,
): Promise<void> {
    const { intervalMs, formatReasoning, onError, onDelta, onFinish, abortSignal } = options
    let lastUsage: AdapterChatStreamDelta['usage'] | undefined
    let finishReason: string | undefined
    let generatorFinished = false
    let interrupt: ((error: unknown) => void) | undefined
    const abortError = () => abortSignal?.reason ?? new DOMException('Stream cancelled', 'AbortError')
    const onAbort = () => interrupt?.(abortError())
    let fullText = ''
    let reasoningText = ''
    // Prepend accumulated reasoning (mirrors the non-streaming path) so thinking
    // shows as reasoning and is never merged into the saved answer.
    const buildChunk = () =>
        (reasoningText.length > 0 ? formatReasoning(reasoningText) : '') + fullText

    const throttle = new StreamFlushThrottle(
        intervalMs,
        (chunk) => controller.enqueue({ "0": chunk }),
        buildChunk,
        () => controller.desiredSize,
    )

    // Trailing timer: flushes the tail during quiet or backpressured gaps
    // without waiting for the next delta. At most one is armed at a time; it is
    // re-armed when a flush is skipped by backpressure, and cleared on every
    // successful flush and on exit (so no timer leaks past the stream).
    let trailingTimer: ReturnType<typeof setTimeout> | null = null
    const clearTrailing = () => {
        if (trailingTimer !== null) {
            clearTimeout(trailingTimer)
            trailingTimer = null
        }
    }
    const armTrailing = () => {
        if (trailingTimer !== null) {
            return
        }
        trailingTimer = setTimeout(() => {
            trailingTimer = null
            try {
                if (throttle.onTrailing(Date.now())) {
                    armTrailing()
                }
            } catch (error) {
                // Timer callbacks are outside the pump's try/catch. Route the
                // failure through its pending read so there is one finalizer.
                interrupt?.(error)
            }
        }, intervalMs)
    }

    try {
        abortSignal?.addEventListener('abort', onAbort, { once: true })
        while (true) {
            if (abortSignal?.aborted) throw abortError()
            // Do not await generator.return() on cancellation: a suspended
            // upstream read may still be pending. Its eventual result is ignored.
            const next = await new Promise<IteratorResult<AdapterChatStreamDelta, void>>((resolve, reject) => {
                interrupt = reject
                gen.next().then(resolve, reject)
            })
            if (abortSignal?.aborted) throw abortError()
            if (next.done === true) {
                generatorFinished = true
                break
            }
            const delta = next.value
            observe(() => onDelta?.(delta))
            // Merge rather than replace: Anthropic splits usage across events
            // (input_tokens on message_start, output_tokens on message_delta),
            // so overwriting would discard whichever half arrived first.
            if (delta.usage) {
                lastUsage = lastUsage ? { ...lastUsage, ...delta.usage } : delta.usage
            }
            if (delta.finishReason && finishReason !== 'refusal') finishReason = delta.finishReason
            if (delta.reasoningDelta) {
                reasoningText += delta.reasoningDelta
            }
            fullText += delta.textDelta
            if (throttle.onDelta(Date.now())) {
                armTrailing()
            } else {
                clearTrailing()
            }
        }
        clearTrailing()
        throttle.onEnd(Date.now())
        try {
            readModelResponseText({ type: 'success', result: fullText, finishReason })
        } catch (error) {
            // Ordinary chat can display useful partial text at the token limit;
            // empty/reasoning-only output is never a successful final answer.
            // An unclosed leading <think> on a finished reply still carries text.
            if (!(error instanceof ModelOutputError && (
                (error.reason === 'truncated' && stripModelReasoning(fullText).trim())
                || (error.reason === 'empty' && stripClosedModelReasoning(fullText).trim())
            ))) throw error
        }
        controller.close()
        observe(() => onFinish?.('done', lastUsage, finishReason))
    } catch (err) {
        clearTrailing()
        const error = err !== null && (typeof err === 'object' || typeof err === 'function')
            ? err : new Error('AI 스트리밍 응답이 중단되었습니다.')
        partialStreamText.delete(error)
        if (stripModelReasoning(fullText).trim()
            && !(error instanceof ModelOutputError && (error.reason === 'blocked' || error.reason === 'empty'))) {
            observe(() => partialStreamText.set(error, buildChunk()))
        }
        // An actively waiting reader can receive this final snapshot; a slow
        // consumer must recover it through the error's private WeakMap entry.
        observe(() => throttle.onEnd(Date.now()))
        observe(() => onError?.(error))
        observe(() => controller.error(error))
        observe(() => onFinish?.('failed', lastUsage, finishReason))
    } finally {
        clearTrailing()
        abortSignal?.removeEventListener('abort', onAbort)
        if (!generatorFinished) observe(() => gen.return())
    }
}
