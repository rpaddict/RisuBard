import type {
    NarrativeMemoryState,
} from '../../../packages/risubard-core/src/memoryDelta'
import type {
    ContextSource,
} from '../../../packages/risubard-core/src/contextCompiler'
import { invokeBrowserFetch } from './browserFetch'
import {
    normalizeRisuBardInquiryTokenBudget,
    RISUBARD_INQUIRY_TIMEOUT_MS_DEFAULT,
} from './risuBardSettings'
import type { HistoricalSourceMatch } from './historicalSourceRecall'

export const NARRATIVE_CONTEXT_OPT_IN_KEY =
    'risubard.experimentalNarrativeContext'

export function ensureNarrativeSessionChatId(
    chat: { id?: string },
    createId: () => string
): string {
    if (typeof chat.id === 'string' && chat.id.trim().length > 0) {
        return chat.id
    }
    const id = createId().trim()
    if (id.length === 0) {
        throw new Error('Narrative session chat ID must not be empty')
    }
    chat.id = id
    return id
}

export function findNarrativeSessionChat<T extends { id?: string }>(
    chats: T[],
    capturedId: string
): T | undefined {
    return chats.find((chat) => chat.id === capturedId)
}

export interface NarrativeInquiryResponse {
    mode: 'v2-current' | 'bounded-v1-fallback'
    graphRevision: number
    indexRevision: number
    cacheStatus: 'current' | 'missing-or-stale'
    sources: ContextSource[]
    evidenceRequests: Array<{ messageId: string, eventTitle: string }>
    rerankCandidates: NarrativeRerankCandidate[]
    entityCandidates: Array<{ id: string, title: string }>
    metrics: {
        candidateCount: number
        inspectedNodeCount: number
        inspectedEdgeCount: number
        selectedNodeCount: number
        selectedTokens: number
        selectedEventTokens: number
        semanticCandidateCount?: number
        hopCount: number
        auxiliaryModelCalls: number
    }
}

export interface NarrativeRerankCandidate {
    documentId: string
    type: 'character' | 'location' | 'faction' | 'creature' | 'item'
        | 'concept' | 'event' | 'scene' | 'other'
    title: string
    excerpt: string
    score: number
}

const NARRATIVE_EVIDENCE_RULES = [
    'Narrative continuity:',
    '- Treat retrieved sources as authoritative evidence. Preserve established facts, chronology, viewpoint knowledge, and unresolved uncertainty; never replace them with an unsupported continuation.',
    '- Prefer direct historical chat evidence and event documents for exact past details, and current canonical state for present facts.',
].join('\n')

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasExactKeys(
    value: Record<string, unknown>,
    keys: readonly string[]
): boolean {
    const actual = Object.keys(value)
    return actual.length === keys.length
        && actual.every((key) => keys.includes(key))
}

function hasRequiredAndOnlyKeys(
    value: Record<string, unknown>,
    required: readonly string[],
    optional: readonly string[],
): boolean {
    const actual = Object.keys(value)
    return required.every((key) => actual.includes(key))
        && actual.every((key) => required.includes(key)
            || optional.includes(key))
}

function boundedMetric(value: unknown, maximum = Number.MAX_SAFE_INTEGER) {
    if (!Number.isSafeInteger(value)
        || (value as number) < 0
        || (value as number) > maximum) {
        throw new Error(
            'RisuBard Memory Wiki 조회 응답에 잘못된 수치가 포함되어 있습니다.'
        )
    }
    return value as number
}

export async function loadNarrativeInquiry(input: {
    characterId: string
    chatId: string
    currentInput: string
    fallbackInput?: string
    tokenBudget?: {
        target: number
        events?: number
        perSource?: number
        maximum: number
    }
    semanticMatches?: readonly {
        documentId: string
        score: number
    }[]
    entityHints?: readonly {
        kind: 'character'
        names: readonly string[]
    }[]
    sourceMatches?: readonly HistoricalSourceMatch[]
    sourceLimit?: number
    resolveSourceMatches?: (
        messageIds: readonly string[]
    ) => readonly HistoricalSourceMatch[] | Promise<readonly HistoricalSourceMatch[]>
    fetchImpl: typeof fetch
    createAuth(): Promise<string>
    timeoutMs?: number
}): Promise<NarrativeInquiryResponse> {
    const timeoutMs = input.timeoutMs ?? RISUBARD_INQUIRY_TIMEOUT_MS_DEFAULT
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1
        || timeoutMs > 10_000) {
        throw new Error('Invalid RisuBard narrative inquiry timeout')
    }
    const controller = new AbortController()
    const fetchImpl = input.fetchImpl
    let timeout: ReturnType<typeof setTimeout> | undefined
    let value: unknown
    try {
        value = await Promise.race([
            (async () => {
                const auth = await input.createAuth()
                const response = await invokeBrowserFetch(
                    fetchImpl,
                    '/api/risubard/memory/inquiry',
                    {
                        method: 'POST',
                        credentials: 'same-origin',
                        signal: controller.signal,
                        headers: {
                            'content-type': 'application/json',
                            'risu-auth': auth,
                        },
                        body: JSON.stringify({
                            characterId: input.characterId,
                            chatId: input.chatId,
                            currentInput: input.currentInput.slice(0, 4_096),
                            ...(input.fallbackInput === undefined
                                ? {}
                                : { fallbackInput:
                                    input.fallbackInput.slice(-4_096) }),
                            ...(input.tokenBudget === undefined
                                ? {}
                                : { tokenBudget:
                                    normalizeRisuBardInquiryTokenBudget(
                                        input.tokenBudget.target,
                                        input.tokenBudget.maximum,
                                        input.tokenBudget.events,
                                        input.tokenBudget.perSource,
                                    ) }),
                            ...(input.semanticMatches === undefined
                                ? {}
                                : { semanticMatches:
                                    input.semanticMatches.slice(0, 32) }),
                            ...(input.entityHints === undefined
                                ? {}
                                : { entityHints: input.entityHints
                                    .slice(0, 12)
                                    .map((hint) => ({
                                        kind: hint.kind,
                                        names: hint.names.slice(0, 16)
                                            .map((name) => name.slice(0, 128)),
                                    })) }),
                            ...(input.sourceMatches === undefined
                                ? {}
                                : { sourceMatches:
                                    input.sourceMatches.slice(0, 32) }),
                            ...(input.sourceLimit === undefined
                                ? {}
                                : { sourceLimit: Math.max(0, Math.min(
                                    32,
                                    Math.trunc(input.sourceLimit)
                                )) }),
                        }),
                    }
                )
                if (!response.ok) {
                    throw new Error(
                        `RisuBard narrative inquiry failed with status ${response.status}`
                    )
                }
                return response.json()
            })(),
            new Promise<never>((_, reject) => {
                timeout = setTimeout(() => {
                    controller.abort()
                    reject(new DOMException(
                        `RisuBard narrative inquiry timed out after ${timeoutMs} ms`,
                        'AbortError'
                    ))
                }, timeoutMs)
            }),
        ])
    }
    finally {
        if (timeout !== undefined) clearTimeout(timeout)
    }
    if (!isRecord(value)
        || !hasRequiredAndOnlyKeys(value, [
            'mode',
            'graphRevision',
            'indexRevision',
            'cacheStatus',
            'sources',
            'metrics',
        ], [
            'evidenceRequests',
            'entityCandidates',
            'rerankCandidates',
        ])
        || !['v2-current', 'bounded-v1-fallback'].includes(
            String(value.mode)
        )
        || !['current', 'missing-or-stale'].includes(
            String(value.cacheStatus)
        )
        || !Array.isArray(value.sources)
        || value.sources.length > 44
        || !isRecord(value.metrics)
        || !(hasExactKeys(value.metrics, [
                'candidateCount',
                'inspectedNodeCount',
                'inspectedEdgeCount',
                'selectedNodeCount',
                'selectedTokens',
                'hopCount',
                'auxiliaryModelCalls',
            ]) || hasExactKeys(value.metrics, [
                'candidateCount',
                'inspectedNodeCount',
                'inspectedEdgeCount',
                'selectedNodeCount',
                'selectedTokens',
                'semanticCandidateCount',
                'hopCount',
                'auxiliaryModelCalls',
            ]) || hasExactKeys(value.metrics, [
                'candidateCount',
                'inspectedNodeCount',
                'inspectedEdgeCount',
                'selectedNodeCount',
                'selectedTokens',
                'selectedEventTokens',
                'hopCount',
                'auxiliaryModelCalls',
            ]) || hasExactKeys(value.metrics, [
                'candidateCount',
                'inspectedNodeCount',
                'inspectedEdgeCount',
                'selectedNodeCount',
                'selectedTokens',
                'selectedEventTokens',
                'semanticCandidateCount',
                'hopCount',
                'auxiliaryModelCalls',
            ]))
        || (value.mode === 'v2-current'
            && value.cacheStatus !== 'current')
        || (value.mode === 'bounded-v1-fallback'
            && value.cacheStatus !== 'missing-or-stale')) {
        throw new Error(
            'RisuBard Memory Wiki 조회 응답이 현재 앱과 호환되지 않습니다. 앱과 서버를 다시 시작해 주세요.'
        )
    }
    const sources = value.sources.map((source): ContextSource => {
        if (!isRecord(source)
            || !(hasExactKeys(source, [
                'id',
                'kind',
                'role',
                'content',
                'tokens',
                'priority',
            ]) || hasExactKeys(source, [
                'id',
                'kind',
                'role',
                'content',
                'tokens',
                'priority',
                'occurredAt',
            ]) || hasExactKeys(source, [
                'id',
                'kind',
                'role',
                'content',
                'tokens',
                'priority',
                'displayName',
            ]) || hasExactKeys(source, [
                'id',
                'kind',
                'role',
                'content',
                'tokens',
                'priority',
                'occurredAt',
                'displayName',
            ]))
            || typeof source.id !== 'string'
            || source.kind !== 'memory'
            || source.role !== 'system'
            || typeof source.content !== 'string'
            || source.content.length > 4_096
            || (source.displayName !== undefined
                && (typeof source.displayName !== 'string'
                    || source.displayName.trim().length === 0
                    || source.displayName.length > 1_024))) {
            throw new Error('Invalid RisuBard narrative inquiry source')
        }
        return {
            id: source.id,
            kind: 'memory',
            role: 'system',
            content: source.content,
            tokens: boundedMetric(source.tokens, 4_096),
            priority: boundedMetric(source.priority),
            ...(source.occurredAt === undefined
                ? {}
                : { occurredAt: boundedMetric(source.occurredAt) }),
            ...(source.displayName === undefined
                ? {}
                : { displayName: String(source.displayName).slice(0, 1_024) }),
        }
    })
    const evidenceRequests = value.evidenceRequests === undefined
        ? []
        : Array.isArray(value.evidenceRequests)
            ? value.evidenceRequests.slice(0, 32).map((request) => {
                if (!isRecord(request)
                    || !hasExactKeys(request, ['messageId', 'eventTitle'])
                    || typeof request.messageId !== 'string'
                    || request.messageId.trim().length === 0
                    || request.messageId.length > 1_024
                    || typeof request.eventTitle !== 'string'
                    || request.eventTitle.trim().length === 0
                    || request.eventTitle.length > 512) {
                    throw new Error('Invalid RisuBard evidence request')
                }
                return {
                    messageId: request.messageId,
                    eventTitle: request.eventTitle,
                }
            })
            : (() => {
                throw new Error('Invalid RisuBard evidence requests')
            })()
    const rerankCandidates = value.rerankCandidates === undefined
        ? []
        : Array.isArray(value.rerankCandidates)
            ? value.rerankCandidates.slice(0, 12).map((candidate) => {
                if (!isRecord(candidate)
                    || !hasExactKeys(candidate, [
                        'documentId', 'type', 'title', 'excerpt', 'score',
                    ])
                    || typeof candidate.documentId !== 'string'
                    || candidate.documentId.trim().length === 0
                    || candidate.documentId.length > 256
                    || !['character', 'location', 'faction', 'creature',
                        'item', 'concept', 'event', 'scene', 'other']
                        .includes(String(candidate.type))
                    || typeof candidate.title !== 'string'
                    || candidate.title.trim().length === 0
                    || candidate.title.length > 160
                    || typeof candidate.excerpt !== 'string'
                    || candidate.excerpt.length > 320
                    || typeof candidate.score !== 'number'
                    || !Number.isFinite(candidate.score)) {
                    throw new Error('Invalid Bard-chan rerank candidate')
                }
                return {
                    documentId: candidate.documentId,
                    type: candidate.type as NarrativeRerankCandidate['type'],
                    title: candidate.title,
                    excerpt: candidate.excerpt,
                    score: candidate.score,
                }
            })
            : (() => {
                throw new Error('Invalid Bard-chan rerank candidates')
            })()
    const entityCandidates = value.entityCandidates === undefined
        ? []
        : Array.isArray(value.entityCandidates)
            ? value.entityCandidates.slice(0, 16).map((candidate) => {
                if (!isRecord(candidate)
                    || !hasExactKeys(candidate, ['id', 'title'])
                    || typeof candidate.id !== 'string'
                    || typeof candidate.title !== 'string'
                    || candidate.id.trim().length === 0
                    || candidate.title.trim().length === 0) {
                    throw new Error(
                        'Invalid RisuBard narrative entity candidate'
                    )
                }
                return { id: candidate.id, title: candidate.title }
            })
            : (() => {
                throw new Error(
                    'Invalid RisuBard narrative entity candidates'
                )
            })()
    const suppliedSourceIds = new Set(
        (input.sourceMatches ?? []).map((match) => match.messageId)
    )
    const missingSourceIds = evidenceRequests
        .map((request) => request.messageId)
        .filter((messageId) => !suppliedSourceIds.has(messageId))
    if (input.resolveSourceMatches && missingSourceIds.length > 0) {
        const resolved = await input.resolveSourceMatches(missingSourceIds)
        const merged = [...resolved, ...(input.sourceMatches ?? [])]
            .filter((match, index, matches) => matches.findIndex((candidate) =>
                candidate.messageId === match.messageId) === index)
            .slice(0, Math.max(0, Math.min(
                32,
                Number.isSafeInteger(input.sourceLimit)
                    ? input.sourceLimit as number
                    : 8
            )))
        if (merged.some((match) => !suppliedSourceIds.has(match.messageId))) {
            return loadNarrativeInquiry({
                ...input,
                sourceMatches: merged,
                resolveSourceMatches: undefined,
            })
        }
    }
    return {
        mode: value.mode as NarrativeInquiryResponse['mode'],
        graphRevision: boundedMetric(value.graphRevision),
        indexRevision: boundedMetric(value.indexRevision),
        cacheStatus: value.cacheStatus as NarrativeInquiryResponse['cacheStatus'],
        sources,
        evidenceRequests,
        rerankCandidates,
        entityCandidates,
        metrics: {
            candidateCount: boundedMetric(value.metrics.candidateCount, 64),
            inspectedNodeCount: boundedMetric(
                value.metrics.inspectedNodeCount,
                100_000
            ),
            inspectedEdgeCount: boundedMetric(
                value.metrics.inspectedEdgeCount,
                512
            ),
            selectedNodeCount: boundedMetric(
                value.metrics.selectedNodeCount,
                44
            ),
            selectedTokens: boundedMetric(
                value.metrics.selectedTokens
            ),
            selectedEventTokens: boundedMetric(
                value.metrics.selectedEventTokens ?? 0
            ),
            ...(value.metrics.semanticCandidateCount === undefined
                ? {}
                : { semanticCandidateCount: boundedMetric(
                    value.metrics.semanticCandidateCount,
                    32
                ) }),
            hopCount: boundedMetric(value.metrics.hopCount, 2),
            auxiliaryModelCalls: boundedMetric(
                value.metrics.auxiliaryModelCalls,
                1,
            ),
        },
    }
}

export function createNarrativeSourcesPrompt(
    sources: readonly ContextSource[],
    baseline = '',
    characterBudget = 12_000,
    responseGuide = ''
): string | null {
    const selectedSources = sources.slice(0, 16)
    const sections = [
        selectedSources.length > 0 ? NARRATIVE_EVIDENCE_RULES : '',
        selectedSources.length > 0 && responseGuide.trim().length > 0
            ? `Wiki preset response guidance:\n${responseGuide.trim()}`
            : '',
        baseline.trim().length > 0
            ? `Current narrative baseline:\n${baseline.trim()}`
            : '',
        selectedSources.length > 0
            ? `Relevant narrative memory:\n${selectedSources
                .map((source) =>
                    `- [source ${JSON.stringify(source.id)}] ${source.content}`
                )
                .join('\n')}`
            : '',
    ].filter(Boolean)
    if (sections.length === 0) return null
    return sections.join('\n\n').slice(
        0,
        Math.max(0, characterBudget)
    )
}

export function mergeNarrativeContextWithStaticPrompt<
    DescriptionPrompt,
    LorePrompt,
>(input: {
    currentContext: DescriptionPrompt
    baseline: string | null
    baseDescription: DescriptionPrompt | null
    descriptionPrompts: readonly DescriptionPrompt[]
    afterDescriptionPrompts: readonly DescriptionPrompt[]
    activeLorePrompts: readonly LorePrompt[]
}): {
    baseDescription: DescriptionPrompt | null
    descriptionPrompts: DescriptionPrompt[]
    afterDescriptionPrompts: DescriptionPrompt[]
    activeLorePrompts: LorePrompt[]
} {
    if (input.baseline?.trim()) {
        return {
            baseDescription: input.currentContext,
            descriptionPrompts: [input.currentContext],
            afterDescriptionPrompts: [],
            activeLorePrompts: [],
        }
    }
    return {
        baseDescription: input.baseDescription,
        descriptionPrompts: [
            ...input.descriptionPrompts,
            input.currentContext,
        ],
        afterDescriptionPrompts: [
            ...input.afterDescriptionPrompts,
            input.currentContext,
        ],
        activeLorePrompts: [...input.activeLorePrompts],
    }
}

export function selectPromptedNarrativeSources(
    sources: readonly ContextSource[],
    prompt: string
): ContextSource[] {
    return sources.slice(0, 16).filter((source) =>
        prompt.includes(`[source ${JSON.stringify(source.id)}]`)
    )
}

export function isNarrativeContextOptedIn(storage: Pick<
    Storage,
    'getItem'
> = localStorage): boolean {
    return storage.getItem(NARRATIVE_CONTEXT_OPT_IN_KEY) !== 'false'
}

export function createNarrativeContextPrompt(
    state: NarrativeMemoryState,
    characterBudget = 12_000,
    baseline = ''
): string | null {
    const activeFacts = state.facts
        .filter((fact) => fact.status === 'active')
        .map((fact) => `- ${fact.text}`)
    const recentEvents = state.events
        .slice(-8)
        .map((event) => `- ${event.summary}`)
    if (baseline.trim().length === 0
        && activeFacts.length === 0
        && recentEvents.length === 0) return null

    const sections = [
        activeFacts.length > 0
            ? `Current facts:\n${activeFacts.join('\n')}`
            : '',
        recentEvents.length > 0
            ? `Recent events:\n${recentEvents.join('\n')}`
            : '',
        baseline.trim().length > 0
            ? `Current narrative baseline:\n${baseline}`
            : '',
    ].filter(Boolean)
    return sections.join('\n\n').slice(0, Math.max(0, characterBudget))
}

export function selectNarrativeWorkingMessages<T>(
    messages: readonly T[],
    limit = 12,
    includeHistoricalUserMessages = true
): T[] {
    if (!Number.isSafeInteger(limit) || limit < 1) {
        throw new Error('Narrative working-message limit must be positive')
    }
    if (includeHistoricalUserMessages) return messages.slice(-limit)
    const roleOf = (message: T): unknown =>
        typeof message === 'object'
        && message !== null
        && 'role' in message
            ? (message as { role?: unknown }).role
            : undefined
    let latestUserIndex = -1
    for (let index = messages.length - 1; index >= 0; index -= 1) {
        if (roleOf(messages[index]) === 'user') {
            latestUserIndex = index
            break
        }
    }
    return messages.filter((message, index) =>
        roleOf(message) !== 'user' || index === latestUserIndex
    ).slice(-limit)
}

export function normalizeNarrativeWorkingMessageLimit(
    value: unknown,
    fallback = 12
): number {
    return Number.isSafeInteger(value)
        && (value as number) >= 1
        ? value as number
        : fallback
}

export function shouldIncludeNarrativeFirstMessage(
    availableHistoryMessages: number,
    limit = 12
): boolean {
    return availableHistoryMessages < limit
}
