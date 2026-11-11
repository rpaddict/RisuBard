import { describe, expect, it, vi } from 'vitest'
import type { HistoricalSourceMatch } from './historicalSourceRecall'
import {
    normalizeRisuBardSourceRerankerSettings,
    parseSourceRerankerResponse,
    rerankSourcesWithApi,
    sourceRerankerEndpoint,
    type SourceRerankerFetch,
} from './sourceRerankerApi'

const pool: HistoricalSourceMatch[] = Array.from({ length: 6 }, (_, index) => ({
    messageId: `m${index}`, role: 'assistant', content: `excerpt ${index}`, score: 1, occurredAt: index,
}))
const settings = { ...normalizeRisuBardSourceRerankerSettings(undefined), method: 'reranker' as const,
    url: 'https://api.example.com/v2/', key: ' secret ', model: 'rerank-model', minScore: 0.2 }

describe('source reranker API', () => {
    it('normalizes stored settings', () => {
        expect(normalizeRisuBardSourceRerankerSettings({ method: 'x', url: 3, minScore: Number.NaN }))
            .toEqual({ method: 'model', url: '', key: '', model: '', minScore: 0.1 })
        expect(normalizeRisuBardSourceRerankerSettings({ method: 'reranker', minScore: 0 }).minScore).toBe(0)
    })

    it('appends /rerank once', () => {
        expect(sourceRerankerEndpoint('https://api.jina.ai/v1')).toBe('https://api.jina.ai/v1/rerank')
        expect(sourceRerankerEndpoint('http://localhost:7997/rerank/')).toBe('http://localhost:7997/rerank')
    })

    it('keeps the best ids above the threshold', () => {
        const data = { results: [
            { index: 2, relevance_score: 0.4 }, { index: 5, relevance_score: 0.9 },
            { index: 1, relevance_score: 0.1 }, { index: 9, relevance_score: 1 },
        ] }
        expect(parseSourceRerankerResponse(data, pool, 0.2)).toEqual(['m5', 'm2'])
        // Servers that answer with a bare array and `score` (e.g. TEI) are read the same way.
        expect(parseSourceRerankerResponse([{ index: 0, score: 3 }, { index: 3, score: 5 }], pool, 0)).toEqual(['m3', 'm0'])
        expect(parseSourceRerankerResponse({ results: [{ index: 1, relevance_score: 0.05 }] }, pool, 0.2)).toEqual([])
        expect(() => parseSourceRerankerResponse({ error: 'x' }, pool, 0)).toThrow()
    })

    it('sends a Cohere-style request and throws on failure', async () => {
        const fetcher = vi.fn<SourceRerankerFetch>(async () => ({ ok: true, status: 200,
            data: { results: [{ index: 4, relevance_score: 0.8 }] } }))
        await expect(rerankSourcesWithApi('question?', pool, settings, fetcher)).resolves.toEqual(['m4'])
        expect(fetcher).toHaveBeenCalledWith('https://api.example.com/v2/rerank', {
            headers: { Authorization: 'Bearer secret' },
            body: { model: 'rerank-model', query: 'question?', documents: pool.map(match => match.content), top_n: 4 },
            abortSignal: undefined,
        })
        const failing = vi.fn<SourceRerankerFetch>(async () => ({ ok: false, status: 401, data: { message: 'bad key' } }))
        await expect(rerankSourcesWithApi('q', pool, settings, failing)).rejects.toThrow('401')
        await expect(rerankSourcesWithApi('q', pool, { ...settings, url: ' ' }, failing)).rejects.toThrow('URL')
    })
})
