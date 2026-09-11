import type { NarrativeRerankCandidate } from './narrativeContext'

const MAX_BARD_CHAN_CANDIDATES = 8
const MAX_BARD_CHAN_QUERY_CHARACTERS = 1_024
const MAX_BARD_CHAN_EXCERPT_CHARACTERS = 240

export type BardChanCandidate = NarrativeRerankCandidate

interface BardChanModelCall {
    formated: Array<{
        role: 'system' | 'user'
        content: string
    }>
    bias: Record<number, number>
    temperature: number
    maxTokens: number
    useStreaming: false
    noMultiGen: true
    extractJson: ''
    tools: []
    blockPlugins: true
    realChatId?: string
    logSource: 'memory'
    logPurpose: 'bardwiki-bard-chan-rerank'
}

interface BardChanModelResponse {
    type: 'success' | 'fail' | 'streaming' | 'multiline'
    result: unknown
    bindingFailure?: 'main-unset' | 'sub-unset'
}

export interface BardChanSemanticMatch {
    documentId: string
    score: number
}

export function shouldRunBardChan(
    enabled: boolean,
    candidates: readonly BardChanCandidate[],
): boolean {
    if (!enabled || candidates.length < 2) return false
    const sorted = [...candidates].sort((left, right) =>
        right.score - left.score)
    const [first, second] = sorted
    return first.score > 0 && second.score >= first.score * 0.7
}

function parseRankedIds(
    value: unknown,
    candidates: readonly BardChanCandidate[],
): string[] {
    if (typeof value !== 'string') return []
    let parsed: unknown
    try {
        parsed = JSON.parse(value.trim())
    }
    catch {
        return []
    }
    if (typeof parsed !== 'object' || parsed === null
        || Array.isArray(parsed)
        || Object.keys(parsed).length !== 1
        || !('ids' in parsed)
        || !Array.isArray(parsed.ids)) return []
    const allowed = new Set(candidates.map((candidate) =>
        candidate.documentId))
    return parsed.ids
        .filter((id): id is string => typeof id === 'string'
            && allowed.has(id))
        .filter((id, index, ids) => ids.indexOf(id) === index)
        .slice(0, candidates.length)
}

export async function rerankWithBardChan(input: {
    enabled: boolean
    modelMode: 'memory' | 'model'
    currentInput: string
    candidates: readonly BardChanCandidate[]
    realChatId?: string
    requestModel(
        request: BardChanModelCall,
        model: 'memory' | 'model',
    ): Promise<BardChanModelResponse>
}): Promise<BardChanSemanticMatch[]> {
    if (!shouldRunBardChan(input.enabled, input.candidates)) return []
    const candidates = input.candidates
        .slice(0, MAX_BARD_CHAN_CANDIDATES)
        .map((candidate) => ({
            id: candidate.documentId,
            type: candidate.type,
            title: candidate.title.slice(0, 160),
            excerpt: candidate.excerpt.slice(
                0,
                MAX_BARD_CHAN_EXCERPT_CHARACTERS,
            ),
        }))
    try {
        const response = await input.requestModel({
            formated: [{
                role: 'system',
                content: [
                    'You are Bard-chan, a BardWiki retrieval reranker.',
                    'Rank only the supplied candidate IDs by relevance to the query.',
                    'Return strict JSON only: {"ids":["id-1","id-2"]}.',
                    'Do not explain, invent IDs, or repeat IDs.',
                ].join(' '),
            }, {
                role: 'user',
                content: JSON.stringify({
                    query: input.currentInput.slice(
                        0,
                        MAX_BARD_CHAN_QUERY_CHARACTERS,
                    ),
                    candidates,
                }),
            }],
            bias: {},
            temperature: 0,
            maxTokens: 64,
            useStreaming: false,
            noMultiGen: true,
            extractJson: '',
            tools: [],
            blockPlugins: true,
            ...(input.realChatId ? { realChatId: input.realChatId } : {}),
            logSource: 'memory',
            logPurpose: 'bardwiki-bard-chan-rerank',
        }, input.modelMode)
        if (response.type !== 'success') return []
        const ids = parseRankedIds(response.result, input.candidates)
        return ids.map((documentId, index) => ({
            documentId,
            score: (ids.length - index) / ids.length,
        }))
    }
    catch {
        return []
    }
}
