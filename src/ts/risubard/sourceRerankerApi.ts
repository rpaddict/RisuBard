import { SOURCE_RERANK_PICK_LIMIT } from './historicalSourceRerank'
import type { HistoricalSourceMatch } from './historicalSourceRecall'

export type RisuBardSourceRerankMethod = 'model' | 'reranker'

/** A Cohere-style `/rerank` endpoint; Jina and local servers such as Infinity accept the same request. */
export interface RisuBardSourceRerankerSettings {
    method: RisuBardSourceRerankMethod
    url: string
    key: string
    model: string
    /** Originals scoring below this are dropped; none left keeps the scored search result. */
    minScore: number
}

export const RISUBARD_SOURCE_RERANKER_MIN_SCORE_DEFAULT = 0.1

export const defaultRisuBardSourceRerankerSettings = (): RisuBardSourceRerankerSettings => ({
    method: 'model',
    url: '',
    key: '',
    model: '',
    minScore: RISUBARD_SOURCE_RERANKER_MIN_SCORE_DEFAULT,
})

export function normalizeRisuBardSourceRerankerSettings(value: unknown): RisuBardSourceRerankerSettings {
    const fallback = defaultRisuBardSourceRerankerSettings()
    if (!value || typeof value !== 'object') return fallback
    const candidate = value as Partial<RisuBardSourceRerankerSettings>
    const text = (field: unknown) => typeof field === 'string' ? field : ''
    return {
        method: candidate.method === 'reranker' ? 'reranker' : 'model',
        url: text(candidate.url),
        key: text(candidate.key),
        model: text(candidate.model),
        minScore: typeof candidate.minScore === 'number' && Number.isFinite(candidate.minScore)
            ? candidate.minScore
            : fallback.minScore,
    }
}

export function sourceRerankerEndpoint(url: string): string {
    const trimmed = url.trim().replace(/\/+$/u, '')
    return trimmed.endsWith('/rerank') ? trimmed : `${trimmed}/rerank`
}

export interface SourceRerankerFetchResult { ok: boolean; status: number; data: unknown }
export type SourceRerankerFetch = (url: string, init: {
    headers: Record<string, string>
    body: Record<string, unknown>
    abortSignal?: AbortSignal
}) => Promise<SourceRerankerFetchResult>

/** Message ids the reranker scored at or above the threshold, best first. */
export function parseSourceRerankerResponse(
    data: unknown,
    pool: readonly HistoricalSourceMatch[],
    minScore: number,
): string[] {
    const results = Array.isArray(data) ? data : (data as { results?: unknown } | null)?.results
    if (!Array.isArray(results)) throw new Error('Reranker response has no results')
    const scored: { messageId: string; score: number }[] = []
    for (const result of results) {
        const { index, relevance_score: relevance, score } = (result ?? {}) as Record<string, unknown>
        const value = typeof relevance === 'number' ? relevance : score
        const match = typeof index === 'number' && Number.isSafeInteger(index) ? pool[index] : undefined
        if (!match || typeof value !== 'number' || !Number.isFinite(value) || value < minScore) continue
        if (!scored.some(entry => entry.messageId === match.messageId)) scored.push({ messageId: match.messageId, score: value })
    }
    return scored.sort((a, b) => b.score - a.score).slice(0, SOURCE_RERANK_PICK_LIMIT).map(entry => entry.messageId)
}

export async function rerankSourcesWithApi(
    question: string,
    pool: readonly HistoricalSourceMatch[],
    settings: RisuBardSourceRerankerSettings,
    fetcher: SourceRerankerFetch,
    abortSignal?: AbortSignal,
): Promise<string[]> {
    if (pool.length === 0) return []
    if (!settings.url.trim()) throw new Error('Reranker URL is empty')
    const key = settings.key.trim()
    const model = settings.model.trim()
    const response = await fetcher(sourceRerankerEndpoint(settings.url), {
        headers: key ? { Authorization: `Bearer ${key}` } : {},
        body: {
            ...(model ? { model } : {}),
            query: question,
            documents: pool.map(match => match.content),
            top_n: Math.min(pool.length, SOURCE_RERANK_PICK_LIMIT),
        },
        abortSignal,
    })
    if (!response.ok) {
        const detail = typeof response.data === 'string' ? response.data : JSON.stringify(response.data)
        throw new Error(`Reranker request failed (${response.status}): ${String(detail).slice(0, 300)}`)
    }
    return parseSourceRerankerResponse(response.data, pool, settings.minScore)
}
