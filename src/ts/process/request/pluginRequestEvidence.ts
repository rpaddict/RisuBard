import type {
    recordRequestLog,
    RequestLogSource,
} from 'src/ts/requestLog'
import type { RequestPurpose } from 'src/ts/requestPurpose'
import type { RequestInjectionManifest } from 'src/ts/status/requestStatus'

interface PluginRequestEvidenceInput {
    startedAt: number
    source: RequestLogSource
    purpose?: RequestPurpose
    sessionChatId?: string
    generationId: string
    model: string
    provider: string
    injectionManifest?: RequestInjectionManifest
}

interface PluginRequestEvidenceFinish {
    success: boolean
    aborted?: boolean
    streaming: boolean
    output?: string
    errorMessage?: string
    /** Provider-reported usage. Reported counts replace the local estimates. */
    usage?: {
        promptTokens?: number
        completionTokens?: number
        cachedTokens?: number
        reasoningTokens?: number
    } | null
}

interface PluginRequestEvidenceDependencies {
    now?(): number
    countTokens(text: string): Promise<number>
    record(entry: Parameters<typeof recordRequestLog>[0]): void
}

export async function runPluginProviderWithTimeout<T>(
    invoke: (signal: AbortSignal) => Promise<T>,
    timeoutMs: number,
    abortSignal?: AbortSignal | null,
): Promise<T> {
    const boundedTimeoutMs = Number.isFinite(timeoutMs) && timeoutMs > 0
        ? Math.max(1, Math.floor(timeoutMs))
        : 600_000
    const controller = new AbortController()
    const signal = abortSignal
        ? AbortSignal.any([abortSignal, controller.signal])
        : controller.signal

    let timeout: ReturnType<typeof setTimeout> | undefined
    const timeoutPromise = new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
            const error = new Error(
                `Plugin provider request timed out after ${boundedTimeoutMs}ms`
            )
            controller.abort(error)
            reject(error)
        }, boundedTimeoutMs)
    })
    try {
        return await Promise.race([
            Promise.resolve().then(() => invoke(signal)),
            timeoutPromise,
        ])
    } finally {
        if (timeout !== undefined) clearTimeout(timeout)
    }
}

export function formatPluginProviderFailure(
    provider: string,
    error: unknown,
): string {
    const raw = error instanceof Error ? error.message : String(error)
    const reason = raw.replace(/\s+/gu, ' ').trim().slice(0, 512)
        || 'Unknown plugin error'
    return `Plugin Error from ${provider}: ${reason}`
}

export function createPluginRequestEvidenceRecorder(
    input: PluginRequestEvidenceInput,
    dependencies: PluginRequestEvidenceDependencies,
) {
    const now = dependencies.now ?? (() => Date.now())
    const record = dependencies.record
    let firstTokenAt: number | undefined
    let finished = false
    let requestBody: string | undefined
    return {
        setRequestBody(body: unknown) {
            try {
                requestBody = JSON.stringify(body)
            } catch {
                requestBody = '[Plugin request could not be serialized]'
            }
        },
        markFirstToken(timestamp = now()) {
            firstTokenAt ??= timestamp
        },
        async finish(result: PluginRequestEvidenceFinish): Promise<void> {
            if (finished) return
            finished = true
            const usage = result.usage ?? undefined
            let outputTokens: number | undefined = usage?.completionTokens
            if (outputTokens === undefined && result.output) {
                try {
                    outputTokens = await dependencies.countTokens(result.output)
                } catch {
                    // Evidence collection must never affect the provider result.
                }
            }
            record({
                timestamp: input.startedAt,
                category: 'llm',
                source: input.source,
                purpose: input.purpose,
                chatId: input.generationId,
                sessionChatId: input.sessionChatId,
                generationId: input.generationId,
                model: input.model,
                provider: input.provider,
                url: `plugin://${encodeURIComponent(input.provider)}`,
                method: 'PLUGIN',
                success: result.success,
                aborted: result.aborted,
                streaming: result.streaming,
                durationMs: Math.max(0, now() - input.startedAt),
                ...(firstTokenAt === undefined ? {} : {
                    firstTokenMs: Math.max(0, firstTokenAt - input.startedAt),
                }),
                inputTokens: usage?.promptTokens ?? input.injectionManifest?.totalTokens,
                outputTokens,
                ...(usage?.cachedTokens === undefined ? {} : { cachedTokens: usage.cachedTokens }),
                ...(usage?.reasoningTokens === undefined ? {} : { reasoningTokens: usage.reasoningTokens }),
                injectionManifest: input.injectionManifest,
                requestBody,
                responseBody: result.output || result.errorMessage || '',
                errorMessage: result.errorMessage,
            })
        },
    }
}
