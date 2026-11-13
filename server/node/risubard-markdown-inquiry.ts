import { eventSequences } from './risubard-event-sequence'
import { basename } from 'node:path'
import { get_encoding, type Tiktoken } from '@dqbd/tiktoken'
import type { MarkdownWikiDocument } from './risubard-markdown-wiki'
import { createInquiryTimeline, type InquiryTimelineInput } from './risubard-inquiry-timeline'
import { normalizeRisuBardInquiryTokenBudget } from '../../src/ts/risubard/risuBardSettings'
import { selectMarkdownExcerpt } from './risubard-markdown-excerpt'
import { isStoryArcChapterTitle, isStoryArcTitle } from '../../src/ts/risubard/wikiWritingLanguage'
import { normalizeWikiRetrievalLimits, wikiPageTokenCap, type WikiRetrievalLimits } from '../../src/ts/risubard/wikiRetrievalLimits'
import { RESOLVED_SOURCE_SCORE } from '../../src/ts/risubard/historicalSourceRecall'
import { describeStoryTimeForModel, storyTimeStamp, type MemoryStoryTime } from './risubard-memory-metadata'
import { buildCharacterLedgers, formatCharacterLedger, type LedgerEntry } from './risubard-change-ledger'

const MAX_LEDGER_TOKENS = 400

const MAX_SELECTED_DOCUMENTS = 12
// Client validation accepts at most 44 sources per inquiry.
const MAX_REQUIRED_DOCUMENTS = 32
const MAX_SOURCE_CHARACTERS = 12_000
const MAX_FALLBACK_CURRENT_INPUT_CHARACTERS = 128
const MAX_SEMANTIC_SEEDS = 32
const MAX_EXPANDED_DOCUMENTS_PER_HOP = 8
const MAX_EDGES_PER_DOCUMENT = 16
const MAX_INSPECTED_EDGES = 256
const MAX_HOPS = 2
const MAX_SOURCE_MATCHES = 32
const MIN_TRIMMED_CANON_TOKENS = 256
const TRIMMED_CANON_MARKER = '[Partial canon excerpt trimmed to fit the memory budget; omitted parts are not evidence of absence]'
const DEFAULT_SELECTED_SOURCE_MESSAGES = 8
const MAX_MAP_ANCHORS_BEFORE_EVENTS = 4
const ROUTED_SOURCE_SCORE_BONUS = 12
// Lexical matches that no selected event routed to still reach the answer
// model when they are the strongest few and carry at least one rare term
// (BM25-style weights: a term in roughly an eighth of history scores ~2).
const MAX_UNROUTED_LEXICAL_SOURCES = 2
const MIN_UNROUTED_LEXICAL_SCORE = 2
// Events whose source sits within this many assistant turns before the recent
// transcript are the story's immediate past. They always enter the candidate
// pool, score higher the closer they are, and a current-state question that
// matches no event still receives the newest few of them.
const RECENT_EVENT_WINDOW_TURNS = 6
const RECENT_EVENT_SCORE_BONUS = 4
const RECENT_EVENT_GUARANTEE = 2
const SEMANTIC_RRF_K = 60
const SEMANTIC_RRF_SCALE = 480
const ENTITY_HINT_SCORE = 10_000
const SINGLE_CHARACTER_QUERY_TERMS = new Set(['춤', '꿈', '술', '밥', '잠', '검', '꽃'])

const QUERY_STOPWORDS = new Set([
    '그는', '그녀는', '그들은', '나는', '우리는', '이것', '그것', '저것',
    '지금', '현재', '무엇', '무엇을', '어떻게', '왜', '해야', '하지',
    '한다', '했다', '하는', '있는', '있다', '없는', '없다', '대한',
    '관련', '정보', '알려', '해줘', '해', '줘', '그리고', '그러면',
    '아는', '같다', '대해', '대해서', '생각',
    'the', 'a', 'an', 'is', 'are', 'was', 'were', 'what', 'how', 'why',
    'this', 'that', 'these', 'those', 'about', 'please',
])

const KOREAN_QUERY_SUFFIXES = [
    '하려다가', '하려고', '하려다', '했다가', '되었던', '이었다',
    '들에게', '들에서', '들로', '들을', '들은', '들이',
    '했던', '하던', '했다', '한다', '하는', '하며', '하고',
    '에서', '에게', '까지', '부터', '처럼', '보다', '으로',
    '거나', '면서', '지만', '는데', '던', '고',
    '은', '는', '이', '가', '을', '를', '와', '과', '의', '에', '로', '들',
] as const

let inquiryTokenizer: Tiktoken | undefined

function countInquiryTokens(value: string): number {
    inquiryTokenizer ??= get_encoding('cl100k_base')
    return inquiryTokenizer.encode(value).length
}

function truncateToTokenBudget(value: string, maximumTokens: number): string {
    if (countInquiryTokens(value) <= maximumTokens) return value
    const characters = Array.from(value)
    let low = 0
    let high = characters.length
    while (low < high) {
        const middle = Math.ceil((low + high) / 2)
        if (countInquiryTokens(characters.slice(0, middle).join(''))
            <= maximumTokens) low = middle
        else high = middle - 1
    }
    return characters.slice(0, low).join('').trimEnd()
}

function selectTokenBoundedExcerpt(
    input: Omit<Parameters<typeof selectMarkdownExcerpt>[0], 'maximumCharacters'>,
    maximumTokens: number,
): string {
    const full = input.content.trim()
    if (countInquiryTokens(full) <= maximumTokens) return full
    let low = 0
    let high = input.content.length
    let selected = ''
    while (low < high) {
        const middle = Math.ceil((low + high) / 2)
        const excerpt = selectMarkdownExcerpt({ ...input, maximumCharacters: middle })
        if (countInquiryTokens(excerpt) <= maximumTokens) {
            low = middle
            selected = excerpt
        } else {
            high = middle - 1
        }
    }
    return selected
}

export interface MarkdownInquiryInput {
    contextSelection?: 'required' | 'auto'
    retrievalLimits?: WikiRetrievalLimits
    documents: readonly MarkdownWikiDocument[]
    currentInput: string
    fallbackInput?: string
    semanticMatches?: readonly {
        documentId: string
        score: number
        contentHash?: string
        start?: number
        end?: number
    }[]
    entityHints?: readonly {
        kind: 'character'
        names: readonly string[]
    }[]
    sourceMatches?: readonly {
        retrieval?: 'semantic'
        messageId: string
        role: 'user' | 'assistant'
        content: string
        score: number
        occurredAt: number
    }[]
    sourceLimit?: number
    /** Supplied sources a reranking model judged to state the asked facts, best first. */
    rankedSourceIds?: readonly string[]
    timeline?: InquiryTimelineInput
    tokenBudget?: {
        target: number
        events?: number
        perSource?: number
        maximum: number
    }
}

export interface MarkdownInquiryResult {
    mode: 'v2-current'
    graphRevision: number
    indexRevision: number
    cacheStatus: 'current'
    sources: Array<{
        id: string
        kind: 'memory'
        role: 'system'
        content: string
        tokens: number
        priority: number
        displayName?: string
        occurredAt?: number
    }>
    evidenceRequests: Array<{
        messageId: string
        eventTitle: string
        documentId?: string
    }>
    entityCandidates: []
    metrics: {
        candidateCount: number
        inspectedNodeCount: number
        inspectedEdgeCount: number
        selectedNodeCount: number
        selectedTokens: number
        selectedEventTokens: number
        semanticCandidateCount: number
        hopCount: number
        auxiliaryModelCalls: 0
    }
}

interface Candidate {
    document: MarkdownWikiDocument
    directScore: number
    hop: number
    linkScore: number
    recencyBonus?: number
}

/** A recent event the query neither matched nor linked to: only the guarantee may select it. */
function isRecencyOnly(candidate: Pick<Candidate, 'document' | 'directScore' | 'linkScore' | 'recencyBonus'>): boolean {
    return candidate.document.type === 'event'
        && (candidate.recencyBonus ?? 0) > 0
        && candidate.directScore <= 0
        && candidate.linkScore <= 0
}

interface NormalizedDocument {
    title: string
    aliases: string[]
    content: string
    links: string
    keys: string[]
    keywords: string[]
}

interface InquiryCatalogBase {
    byTarget: Map<string, MarkdownWikiDocument>
    adjacency: Map<string, Set<string>>
}

const normalizedDocumentCache = new WeakMap<
    MarkdownWikiDocument,
    NormalizedDocument
>()
const inquiryCatalogCache = new WeakMap<object, InquiryCatalogBase>()

function normalized(value: string): string {
    return value.normalize('NFKC').toLocaleLowerCase().trim()
}

function normalizedQueryTerm(value: string): string {
    if (!/^[가-힣]+$/u.test(value)) return value
    let term = value
    while (true) {
        const suffix = KOREAN_QUERY_SUFFIXES.find((candidate) =>
            term.endsWith(candidate)
            && (term.length - candidate.length >= 2
                || SINGLE_CHARACTER_QUERY_TERMS.has(term.slice(0, -candidate.length))))
        if (!suffix) return term
        term = term.slice(0, -suffix.length)
    }
}

function queryTerms(value: string): string[] {
    return [...new Set(normalized(value).split(/[^\p{L}\p{N}_]+/u)
        .filter((term) => (term.length > 1 || SINGLE_CHARACTER_QUERY_TERMS.has(term))
            && !QUERY_STOPWORDS.has(term))
        .map(normalizedQueryTerm)
        .filter((term) => (term.length > 1 || SINGLE_CHARACTER_QUERY_TERMS.has(term))
            && !QUERY_STOPWORDS.has(term)))]
        .slice(0, 32)
}

function hasPastIntent(value: string): boolean {
    return /(?:과거|예전|이전|당시|전날|어제|지난|그때|앞서|전에|처음|초반|원래|회상|떠올리|기억|past|previous|before|earlier|formerly|used to|昔|以前|当時|過去|过去|之前|當時|曾经|曾經|回忆|回憶|记得|記得)/i
        .test(value)
}

function hasHistoricalEvidenceIntent(value: string): boolean {
    const past = hasPastIntent(value)
    const causalOrDetail = /(?:왜|원인|이유|계기|인과|영향|분석|세부|근거|why|cause|reason|trigger|analysis|detail|evidence|为什么|為什麼|为何|為何|原因|理由|细节|細節)/i
        .test(value)
    return past || causalOrDetail
}

function hasLinkedCharacterIntent(value: string): boolean {
    return /(?:인물|누구|동료|관계|주변|함께|연결|people|who|companion|relationship|with whom|人物|誰|仲間|関係|谁|关系|關係|同伴)/i
        .test(value)
}

function normalizedLinkTarget(rawLink: string): string {
    return normalized(rawLink.split('|')[0]?.split('#')[0] ?? '')
}

function documentKeys(document: MarkdownWikiDocument): string[] {
    const pathWithoutExtension = document.relativePath.replace(/\.md$/i, '')
    return [
        document.title,
        ...document.aliases,
        pathWithoutExtension,
        basename(pathWithoutExtension),
    ].map(normalized)
}

function normalizedDocument(
    document: MarkdownWikiDocument
): NormalizedDocument {
    const cached = normalizedDocumentCache.get(document)
    if (cached) return cached
    const value = {
        title: normalized(document.title),
        aliases: document.aliases.map(normalized),
        content: normalized(document.content),
        links: normalized(document.links.join(' ')),
        keys: documentKeys(document),
        keywords: (document.retrievalMetadata?.keywords ?? []).slice(0, 24)
            .map((keyword) => normalized(keyword.slice(0, 80))),
    }
    normalizedDocumentCache.set(document, value)
    return value
}

function catalogBase(
    documents: readonly MarkdownWikiDocument[]
): InquiryCatalogBase {
    const cacheKey = documents as object
    const cached = inquiryCatalogCache.get(cacheKey)
    if (cached) return cached
    const possibleTargets = new Map<string, MarkdownWikiDocument | null>()
    for (const document of documents) {
        for (const key of normalizedDocument(document).keys) {
            const existing = possibleTargets.get(key)
            possibleTargets.set(
                key,
                existing && existing.id !== document.id ? null : document
            )
        }
    }
    const byTarget = new Map([...possibleTargets.entries()]
        .filter((entry): entry is [string, MarkdownWikiDocument] =>
            entry[1] !== null))
    const adjacency = new Map<string, Set<string>>()
    const connect = (left: string, right: string) => {
        if (left === right) return
        const leftSet = adjacency.get(left) ?? new Set<string>()
        leftSet.add(right)
        adjacency.set(left, leftSet)
        const rightSet = adjacency.get(right) ?? new Set<string>()
        rightSet.add(left)
        adjacency.set(right, rightSet)
    }
    for (const document of documents) {
        for (const rawLink of document.links) {
            const target = byTarget.get(normalizedLinkTarget(rawLink))
            if (target) connect(document.id, target.id)
        }
    }
    const value = { byTarget, adjacency }
    inquiryCatalogCache.set(cacheKey, value)
    return value
}

function isEligible(
    document: MarkdownWikiDocument,
    input: MarkdownInquiryInput
): boolean {
    if (document.status !== 'active' || document.contextMode === 'never') {
        return false
    }
    return true
}

function lexicalScore(
    document: MarkdownWikiDocument,
    normalizedQuery: string,
    terms: readonly string[],
    characterAnchorTerms: ReadonlySet<string>,
    termWeights: ReadonlyMap<string, number>
): number {
    const { title, aliases, content, links, keywords } = normalizedDocument(document)
    const identityKeys = [title, ...aliases]
    let score = identityKeys.includes(normalizedQuery) ? 12 : 0
    if (normalizedQuery.length > 1 && title !== normalizedQuery
        && identityKeys.some((key) => key.includes(normalizedQuery)
            || normalizedQuery.includes(key))) score += 6
    if (normalizedQuery.length > 1 && content.includes(normalizedQuery)) score += 2
    if (normalizedQuery.length > 1 && links.includes(normalizedQuery)) score += 4
    for (const term of terms) {
        if (characterAnchorTerms.has(term)) {
            if (identityKeys.includes(term)) score += 4
            continue
        }
        const weight = termWeights.get(term) ?? 1
        if (identityKeys.some((key) => key.includes(term)
            || (key.length > 1 && term.includes(key)))) {
            score += 4 * weight
        }
        if (links.includes(term)) score += 3 * weight
        if (content.includes(term)) score += 2 * weight
        if (keywords.some((keyword) => keyword.includes(term))) score += 3 * weight
    }
    return score
}

function queryTermWeights(
    documents: readonly MarkdownWikiDocument[],
    terms: readonly string[]
): Map<string, number> {
    const weights = new Map<string, number>()
    for (const term of terms) {
        const documentFrequency = documents.reduce((count, document) => {
            const { title, aliases, content, links, keywords } = normalizedDocument(document)
            return count + Number([title, ...aliases].some((key) =>
                key.includes(term))
                || links.includes(term)
                || keywords.some((keyword) => keyword.includes(term))
                || content.includes(term))
        }, 0)
        const inverseDocumentFrequency = Math.log(1 + (
            documents.length - documentFrequency + 0.5
        ) / (documentFrequency + 0.5))
        weights.set(term, inverseDocumentFrequency)
    }
    return weights
}

function candidateScore(
    candidate: Candidate,
    pastIntent: boolean,
    currentIntent: boolean
): number {
    let score = candidate.directScore + candidate.linkScore
    if (candidate.document.type === 'event') score += (pastIntent ? 3 : 0) + (candidate.recencyBonus ?? 0)
    else score += currentIntent ? 3 : 1
    return score
}

/** Full bonus one turn before the recent transcript, fading to nothing past the window. */
function recentEventBonus(turnsBefore: number | undefined): number {
    if (turnsBefore === undefined || turnsBefore > RECENT_EVENT_WINDOW_TURNS) return 0
    return RECENT_EVENT_SCORE_BONUS * (RECENT_EVENT_WINDOW_TURNS - turnsBefore + 1) / RECENT_EVENT_WINDOW_TURNS
}

function arcRouteTargets(
    document: MarkdownWikiDocument,
    terms: readonly string[],
    byTarget: ReadonlyMap<string, MarkdownWikiDocument>,
): Set<string> {
    const targets = new Set<string>()
    if (document.type !== 'other' || !(isStoryArcTitle(document.title) || isStoryArcChapterTitle(document.title))) return targets
    // Keep an action and its event link together; unrelated arcs must not win
    // merely because their links appear first in the document.
    for (const line of document.content.slice(0, MAX_SOURCE_CHARACTERS).split('\n')) {
        if (!terms.some((term) => normalized(line).includes(term))) continue
        for (const match of line.matchAll(/\[\[([^\]]+)\]\]/gu)) {
            const target = byTarget.get(normalizedLinkTarget(match[1]))
            if (target) targets.add(target.id)
        }
    }
    return targets
}

function semanticExcerpt(document: MarkdownWikiDocument, start: number, end: number): string {
    const headings: Array<{ level: number; text: string }> = []
    for (const heading of document.content.slice(0, start).matchAll(/^(#{1,6})\s+(.+)$/gm)) {
        const level = heading[1].length
        while (headings.length && headings[headings.length - 1].level >= level) headings.pop()
        headings.push({ level, text: heading[0].trim() })
    }
    return [`## ${document.title}`, ...headings.map(heading => heading.text),
        document.content.slice(start, end)].join('\n\n')
}

/** Event sources in story order; other sources keep their places. */
function chronologicalEvents<T extends { document: MarkdownWikiDocument }>(
    selected: readonly T[],
    sequences: ReadonlyMap<string, number>,
): T[] {
    const events = selected.filter((item) => item.document.type === 'event')
        .sort((left, right) => (sequences.get(left.document.id) ?? 0) - (sequences.get(right.document.id) ?? 0))
    let next = 0
    return selected.map((item) => item.document.type === 'event' ? events[next++] : item)
}

export function inquireMarkdownDocuments(
    input: MarkdownInquiryInput
): MarkdownInquiryResult {
    // Required context is a direct read, independent of ranking and excerpts.
    if (input.contextSelection === 'required') {
        // The operator chose these documents; the retrieval budget never
        // rejects them. The request's own context fitting trims chat instead.
        const documents = input.documents.filter(document => isEligible(document, input)
            && (document.contextMode === 'always' || document.type === 'scene'))
            .slice(0, MAX_REQUIRED_DOCUMENTS)
        const sources = documents.map(document => ({
            id: `narrative-memory:wiki:${document.relativePath}`,
            kind: 'memory' as const, role: 'system' as const,
            content: document.content, tokens: countInquiryTokens(document.content), priority: 200,
        }))
        const selectedTokens = sources.reduce((sum, source) => sum + source.tokens, 0)
        return {
            mode: 'v2-current', graphRevision: input.documents.length, indexRevision: input.documents.length,
            cacheStatus: 'current', sources, evidenceRequests: [], entityCandidates: [],
            metrics: { candidateCount: 0, inspectedNodeCount: input.documents.length, inspectedEdgeCount: 0,
                selectedNodeCount: sources.length, selectedTokens, selectedEventTokens: 0,
                semanticCandidateCount: 0, hopCount: 0, auxiliaryModelCalls: 0 },
        }
    }
    const { candidates: candidateLimit, directSeeds: directSeedLimit } = normalizeWikiRetrievalLimits(input.retrievalLimits)
    const currentNormalizedQuery = normalized(
        input.currentInput.slice(0, 4_096)
    )
    let retrievalInput = input.currentInput.slice(0, 4_096)
    let normalizedQuery = currentNormalizedQuery
    let terms = queryTerms(retrievalInput)
    const optionalDocumentLimit = input.contextSelection === 'auto'
        ? Math.max(0, MAX_SELECTED_DOCUMENTS - input.documents.filter(document => document.status === 'active'
            && document.contextMode !== 'never' && (document.contextMode === 'always' || document.type === 'scene')).length)
        : MAX_SELECTED_DOCUMENTS
    const eligibleDocuments = input.documents.filter((document) =>
        isEligible(document, input))
    const characterTitles = new Set(eligibleDocuments
        .filter((document) => document.type === 'character')
        .flatMap((document) => [document.title, ...document.aliases]
            .map(normalized)))
    let characterAnchorTerms = new Set(terms.filter((term) =>
        characterTitles.has(term)))
    let termWeights = queryTermWeights(eligibleDocuments, terms)
    const requiredDocuments = eligibleDocuments.filter((document) =>
        document.contextMode === 'always'
            || document.type === 'scene')
    const timeline = createInquiryTimeline(input.timeline)
    const recencyBonusOf = (document: MarkdownWikiDocument): number =>
        document.type === 'event' && input.timeline
            ? recentEventBonus(timeline.turnsBefore(document))
            : 0

    const base = catalogBase(input.documents)
    const sequences = eventSequences(input.documents)
    const latestSequence = Math.max(0, ...sequences.values())
    const eventTimes = new Map<number, MemoryStoryTime>()
    for (const document of input.documents) {
        const sequence = sequences.get(document.id)
        const time = document.retrievalMetadata?.storyTime
        if (sequence !== undefined && time) eventTimes.set(sequence, time)
    }
    // Hub pages link to many events; expand toward relevant, then recent ones.
    const neighborRank = new Map<string, number>()
    const rankNeighbor = (id: string): number => {
        let rank = neighborRank.get(id)
        if (rank === undefined) {
            const neighbor = byId.get(id)
            rank = neighbor ? lexicalScore(neighbor, normalizedQuery, terms, characterAnchorTerms, termWeights) : -1
            neighborRank.set(id, rank)
        }
        return rank
    }
    const byId = new Map(eligibleDocuments.map((document) =>
        [document.id, document]))

    let direct = eligibleDocuments.map((document) => ({
        document,
        directScore: lexicalScore(
            document,
            normalizedQuery,
            terms,
            characterAnchorTerms,
            termWeights
        ),
    })).filter(({ directScore }) => directScore > 0)
        .sort((left, right) =>
            right.directScore - left.directScore
            || right.document.updated.localeCompare(left.document.updated)
            || left.document.id.localeCompare(right.document.id))
    const semanticScores = new Map<string, number>()
    const semanticPassages = new Map<string, Array<{ start: number; end: number; score: number }>>()
    for (const match of input.semanticMatches ?? []) {
        if (!Number.isFinite(match.score) || match.score <= 0
            || !byId.has(match.documentId)) continue
        const document = byId.get(match.documentId)!
        if (match.contentHash !== undefined || match.start !== undefined || match.end !== undefined) {
            if (match.contentHash !== document.contentHash
                || !Number.isSafeInteger(match.start) || !Number.isSafeInteger(match.end)
                || match.start! < 0 || match.end! <= match.start!
                || match.end! > document.content.length) continue
            const ranges = semanticPassages.get(match.documentId) ?? []
            const overlapping = ranges.find(range => match.start! <= range.end && match.end! >= range.start)
            if (overlapping) {
                overlapping.start = Math.min(overlapping.start, match.start!)
                overlapping.end = Math.max(overlapping.end, match.end!)
                overlapping.score = Math.max(overlapping.score, match.score)
            } else ranges.push({ start: match.start!, end: match.end!, score: match.score })
            semanticPassages.set(match.documentId, ranges.sort((a, b) => b.score - a.score || a.start - b.start).slice(0, 3))
        }
        semanticScores.set(
            match.documentId,
            Math.max(semanticScores.get(match.documentId) ?? 0, match.score)
        )
    }
    const semantic = [...semanticScores.entries()]
        .sort((left, right) => right[1] - left[1]
            || left[0].localeCompare(right[0]))
        .slice(0, MAX_SEMANTIC_SEEDS)
    const directById = new Map(direct.slice(0, directSeedLimit).map((item) =>
        [item.document.id, item]))
    semantic.forEach(([documentId], index) => {
        const document = byId.get(documentId)
        if (!document) return
        const semanticRankBonus = SEMANTIC_RRF_SCALE
            / (SEMANTIC_RRF_K + index + 1)
        const existing = directById.get(documentId)
        directById.set(documentId, {
            document,
            directScore: (existing?.directScore ?? 0) + semanticRankBonus,
        })
    })
    for (const hint of input.entityHints ?? []) {
        if (hint.kind !== 'character') continue
        const uniquelyResolvedIds = new Set<string>()
        for (const rawName of hint.names) {
            const name = normalized(rawName)
            if (!name) continue
            const matches = eligibleDocuments.filter((document) =>
                document.type === 'character'
                && [document.title, ...document.aliases]
                    .map(normalized)
                    .includes(name))
            if (matches.length === 1) uniquelyResolvedIds.add(matches[0].id)
        }
        if (uniquelyResolvedIds.size !== 1) continue
        const documentId = [...uniquelyResolvedIds][0]
        const document = byId.get(documentId)
        if (!document) continue
        const existing = directById.get(documentId)
        directById.set(documentId, {
            document,
            directScore: (existing?.directScore ?? 0) + ENTITY_HINT_SCORE,
        })
    }
    // Required pages (the pinned scene among them) are read separately, so
    // they never decide whether a short input falls back to recent dialogue.
    if (directById.size === 0
        && input.currentInput.trim().length
            <= MAX_FALLBACK_CURRENT_INPUT_CHARACTERS
        && input.fallbackInput?.trim()) {
        const fallbackInput = input.fallbackInput.slice(-4_096)
        const fallbackNormalizedQuery = normalized(fallbackInput)
        const fallbackTerms = queryTerms(fallbackInput)
        const fallbackCharacterAnchorTerms = new Set(
            fallbackTerms.filter((term) => characterTitles.has(term))
        )
        const fallbackTermWeights = queryTermWeights(
            eligibleDocuments,
            fallbackTerms,
        )
        const fallbackDirect = eligibleDocuments.map((document) => ({
            document,
            directScore: lexicalScore(
                document,
                fallbackNormalizedQuery,
                fallbackTerms,
                fallbackCharacterAnchorTerms,
                fallbackTermWeights,
            ),
        })).filter(({ directScore }) => directScore > 0)
            .sort((left, right) =>
                right.directScore - left.directScore
                || right.document.updated.localeCompare(left.document.updated)
                || left.document.id.localeCompare(right.document.id))
        if (fallbackDirect.length > 0) {
            retrievalInput = fallbackInput
            normalizedQuery = fallbackNormalizedQuery
            terms = fallbackTerms
            characterAnchorTerms = fallbackCharacterAnchorTerms
            termWeights = fallbackTermWeights
            direct = fallbackDirect
            for (const item of direct.slice(0, directSeedLimit)) {
                directById.set(item.document.id, item)
            }
        }
    }
    const hybridDirect = [...directById.values()]
        .sort((left, right) =>
            right.directScore - left.directScore
            || right.document.updated.localeCompare(left.document.updated)
            || left.document.id.localeCompare(right.document.id))
        .slice(0, directSeedLimit)
    const candidates = new Map<string, Candidate>()
    for (const document of requiredDocuments) {
        candidates.set(document.id, {
            document,
            directScore: directById.get(document.id)?.directScore
                ?? lexicalScore(
                document,
                normalizedQuery,
                terms,
                characterAnchorTerms,
                termWeights
            ),
            hop: 0,
            linkScore: 0,
        })
    }
    // The immediate past is always in the pool, however the query is worded.
    for (const document of eligibleDocuments) {
        const recencyBonus = recencyBonusOf(document)
        if (recencyBonus <= 0 || candidates.has(document.id)) continue
        if (candidates.size >= candidateLimit) break
        candidates.set(document.id, {
            document,
            directScore: directById.get(document.id)?.directScore
                ?? lexicalScore(document, normalizedQuery, terms, characterAnchorTerms, termWeights),
            hop: 0,
            linkScore: 0,
            recencyBonus,
        })
    }
    for (const item of hybridDirect) {
        if (candidates.size >= candidateLimit) break
        candidates.set(item.document.id, {
            ...item,
            hop: 0,
            linkScore: 0,
            recencyBonus: recencyBonusOf(item.document),
        })
    }

    let inspectedEdgeCount = 0
    const chronologyIntent = /(?:작중\s*행적|행적|모험|여정|연대기|시간\s*순|순서대로|지금까지|journey|adventures?|chronolog|timeline|story\s+history|经历|經歷|时间顺序|時間順序)/i
        .test(input.currentInput)
    for (let hop = 0; hop < MAX_HOPS; hop += 1) {
        const expandable = [...candidates.values()]
            .filter((candidate) => candidate.hop === hop)
            .sort((left, right) =>
                right.directScore - left.directScore
                || right.linkScore - left.linkScore
                || left.document.id.localeCompare(right.document.id))
            .slice(0, MAX_EXPANDED_DOCUMENTS_PER_HOP)
        for (const candidate of expandable) {
            const arcTargets = chronologyIntent ? new Set<string>()
                : arcRouteTargets(candidate.document, terms, base.byTarget)
            const neighbors = [...(base.adjacency.get(
                candidate.document.id
            ) ?? [])]
                .filter((id) => arcTargets.size === 0 || arcTargets.has(id))
                .sort((left, right) => rankNeighbor(right) - rankNeighbor(left)
                    || (sequences.get(right) ?? 0) - (sequences.get(left) ?? 0)
                    || left.localeCompare(right))
                .slice(0, MAX_EDGES_PER_DOCUMENT)
            for (const neighborId of neighbors) {
                if (inspectedEdgeCount >= MAX_INSPECTED_EDGES) break
                inspectedEdgeCount += 1
                const linkScore = hop === 0 ? 8 : 4
                const existing = candidates.get(neighborId)
                if (existing) {
                    existing.hop = Math.min(existing.hop, hop + 1)
                    existing.linkScore = Math.max(
                        existing.linkScore,
                        linkScore
                    )
                    continue
                }
                if (candidates.size >= candidateLimit) continue
                const neighbor = byId.get(neighborId)
                if (!neighbor) continue
                candidates.set(neighborId, {
                    document: neighbor,
                    directScore: lexicalScore(
                        neighbor,
                        normalizedQuery,
                        terms,
                        characterAnchorTerms,
                        termWeights
                    ),
                    hop: hop + 1,
                    linkScore,
                    recencyBonus: recencyBonusOf(neighbor),
                })
            }
            if (inspectedEdgeCount >= MAX_INSPECTED_EDGES) break
        }
        if (inspectedEdgeCount >= MAX_INSPECTED_EDGES) break
    }

    const pastIntent = hasPastIntent(input.currentInput)
    const currentIntent = /(?:현재|지금|최신|상태|current|now|latest|status|現在|今|现在|目前|当前|當前|状态|狀態)/i
        .test(input.currentInput)
    const stateTopicIntent = /(?:상태|목표|관계|위치|어디|소지품|보유|능력|지식|state|status|goal|relationship|location|where|inventory|ability|knowledge|状態|目標|関係|位置|状态|狀態|目标|关系|關係|哪里|哪裡|能力|知识|知識)/i
        .test(input.currentInput)
    const stateHistoryIntent = pastIntent
        || /(?:상태\s*변화|왜|원인|이유|계기|변해|바뀌|했|였|됐|갔|왔|던|데려간|사라진|향했|cause|reason|changed?|became|変化|理由|原因|变化|變化|为什么|為什麼)/i
            .test(input.currentInput)
    const explicitEventIntent = /(?:사건|이벤트|발생|일어났|벌어졌|event|incident|happened|occurred|事件|発生|发生|發生)/i
        .test(input.currentInput)
        || eligibleDocuments.some((document) => document.type === 'event'
            && [document.title, ...(document.aliases ?? [])].some((title) =>
                currentNormalizedQuery.includes(normalized(title))))
    const currentStateIntent = stateTopicIntent
        && !stateHistoryIntent
        && !explicitEventIntent
    const historicalEvidenceIntent = hasHistoricalEvidenceIntent(
        input.currentInput
    )
    const linkedCharacterIntent = hasLinkedCharacterIntent(input.currentInput)
    const requiredIds = new Set(requiredDocuments.map((document) => document.id))
    const automatic = [...candidates.values()]
        .filter((candidate) => !requiredIds.has(candidate.document.id))
        .filter((candidate) => candidate.document.type !== 'character'
            || candidate.hop === 0
            || candidate.directScore > 0
            || historicalEvidenceIntent
            || chronologyIntent
            || linkedCharacterIntent)
        .map((candidate) => ({
            ...candidate,
            score: candidateScore(candidate, pastIntent, currentIntent),
        }))
        .sort((left, right) =>
            right.score - left.score
            || right.document.updated.localeCompare(left.document.updated)
            || left.document.id.localeCompare(right.document.id))
    const tokenBudget = normalizeRisuBardInquiryTokenBudget(
        input.tokenBudget?.target,
        input.tokenBudget?.maximum,
        input.tokenBudget?.events,
        input.tokenBudget?.perSource,
    )
    const pageTokenCap = wikiPageTokenCap(tokenBudget)
    let ledgers: Map<string, LedgerEntry[]> | undefined
    const characterLedgers = () => ledgers ??= buildCharacterLedgers(eligibleDocuments, sequences)
    const prepared = [
        ...(input.contextSelection === 'auto' ? [] : requiredDocuments).map((document) => ({
            document,
            score: 100,
            hop: candidates.get(document.id)?.hop ?? 0,
            directScore: candidates.get(document.id)?.directScore ?? 0,
            linkScore: 0,
            recencyBonus: 0,
        })),
        ...automatic,
    ].map((candidate) => {
        // Each optional page gets a share of the page lane, so a long card cannot
        // keep every other named character out; events and pinned pages keep the per-source cap.
        const sourceBudget = candidate.document.type === 'event' || requiredIds.has(candidate.document.id)
            ? tokenBudget.perSource : pageTokenCap
        // A character's change ledger leads its card and takes at most a quarter of its share.
        const ledgerEntries = candidate.document.type === 'character'
            ? characterLedgers().get(candidate.document.id) : undefined
        const ledgerBlock = ledgerEntries?.length
            ? truncateToTokenBudget(formatCharacterLedger(ledgerEntries, eventTimes),
                Math.min(MAX_LEDGER_TOKENS, Math.floor(sourceBudget / 4)))
            : ''
        const perSource = ledgerBlock
            ? Math.max(1, sourceBudget - countInquiryTokens(ledgerBlock) - countInquiryTokens('\n\n'))
            : sourceBudget
        const passages = semanticPassages.get(candidate.document.id)
        const preferSemantic = passages?.length && !requiredIds.has(candidate.document.id)
            && !(currentStateIntent && candidate.document.type === 'character')
        let content = preferSemantic ? truncateToTokenBudget(
            passages!.map(passage => truncateToTokenBudget(
                semanticExcerpt(candidate.document, passage.start, passage.end),
                Math.max(1, Math.floor((perSource - (passages!.length - 1) * 2) / passages!.length)),
            )).join('\n\n'),
            perSource,
        ) : selectTokenBoundedExcerpt({
            content: candidate.document.content,
            documentType: candidate.document.type,
            query: retrievalInput,
            chronologyIntent,
        }, perSource)
        if (preferSemantic && candidate.document.type === 'character'
            && !pastIntent && !chronologyIntent) {
            // Supplement current facts without shortening the selected evidence.
            // Spare capacity, not a recency quota, owns the extra context.
            const currentBudget = Math.min(Math.floor(perSource / 2),
                perSource - countInquiryTokens(content) - countInquiryTokens('\n\n'))
            if (currentBudget > 0) {
                const current = selectTokenBoundedExcerpt({
                    content: candidate.document.content,
                    documentType: 'character', query: retrievalInput, chronologyIntent: false,
                }, currentBudget)
                if (current.includes(content)) {
                    content = current
                } else if (current.trim()) {
                    const combined = `${current}\n\n${content}`
                    if (countInquiryTokens(combined) <= perSource) content = combined
                }
            }
        }
        // A canon line's (#N) names the event that set it; its story day says when.
        if (candidate.document.type !== 'event' && eventTimes.size > 0) {
            content = content.replace(/\(#(\d{1,6})\)/gu, (match, value: string) => {
                const stamp = storyTimeStamp(eventTimes.get(Number(value)))
                return stamp ? `(#${value}, ${stamp})` : match
            })
        }
        if (ledgerBlock) content = `${ledgerBlock}\n\n${content}`
        const sequence = sequences.get(candidate.document.id)
        const labels = candidate.document.type === 'event'
            ? [
                timeline.sourceLabel(candidate.document),
                sequence === undefined ? undefined
                    : `[Story order: event #${sequence} of ${latestSequence}${sequence === latestSequence ? ', the latest' : ''}]`,
                describeStoryTimeForModel(candidate.document.retrievalMetadata?.storyTime),
            ].filter((label): label is string => label !== undefined)
            : []
        const boundedContent = truncateToTokenBudget(
            labels.length > 0 ? `${labels.join('\n')}\n${content}` : content,
            sourceBudget,
        )
        // When the scene's original text comes along, the label and title are enough to place it.
        const heading = candidate.document.type === 'event'
            ? [...labels, `## ${candidate.document.title}`, '[Summary omitted: the original text of this scene follows]'].join('\n')
            : undefined
        return {
            ...candidate,
            content: boundedContent,
            tokens: countInquiryTokens(boundedContent),
            ...(heading ? { heading, headingTokens: countInquiryTokens(heading) } : {}),
        }
    })
    const detailedIntent = /(?:자세히|상세히|모든\s+근거|근거까지|전부|모두|in detail|all evidence)/i
        .test(input.currentInput)
    const eventEvidenceIntent = !currentStateIntent && (
        stateHistoryIntent || historicalEvidenceIntent
        || chronologyIntent || detailedIntent
    )
    const selectedMapTokenBudget = tokenBudget.target
    const selected: typeof prepared = []
    const selectedIds = new Set<string>()
    // The flow is structural context, not a relevance pick; it never takes more than a quarter of the cap.
    const recentFlow = input.timeline
        ? timeline.recentFlow(eligibleDocuments, countInquiryTokens, Math.floor(tokenBudget.maximum / 4))
        : undefined
    let selectedTokens = recentFlow?.tokens ?? 0
    let selectedMapTokens = 0
    let selectedEventLaneTokens = 0
    let selectedEventTokens = 0
    for (const candidate of prepared.filter((item) =>
        requiredIds.has(item.document.id))) {
        // Outside the dedicated required read these are strong preferences:
        // keep whatever fits instead of failing analysis or plugin lookups.
        if (selected.length >= MAX_SELECTED_DOCUMENTS
            || selectedTokens + candidate.tokens > tokenBudget.maximum) continue
        selected.push(candidate)
        selectedIds.add(candidate.document.id)
        selectedTokens += candidate.tokens
        if (candidate.document.type === 'event') {
            selectedEventTokens += candidate.tokens
            selectedEventLaneTokens += candidate.tokens
        }
        else {
            selectedMapTokens += candidate.tokens
        }
    }
    const addOptionalIfFits = (
        candidate: (typeof prepared)[number],
        lane: 'map' | 'event',
        allowTrim = false,
    ) => {
        const isEvent = candidate.document.type === 'event'
        const laneTokens = lane === 'event'
            ? selectedEventLaneTokens
            : selectedMapTokens
        const laneBudget = lane === 'event'
            ? tokenBudget.events
            : selectedMapTokenBudget
        if (selectedIds.has(candidate.document.id)
            || selected.length >= optionalDocumentLimit) {
            return false
        }
        let entry = candidate
        if (selectedTokens + candidate.tokens > tokenBudget.maximum
            || laneTokens + candidate.tokens > laneBudget) {
            // Only the final pass trims, so whole documents and raw evidence are packed first.
            if (!allowTrim || lane !== 'map' || isEvent) return false
            const room = Math.min(tokenBudget.maximum - selectedTokens, laneBudget - laneTokens)
            if (room < MIN_TRIMMED_CANON_TOKENS) return false
            const excerpt = selectTokenBoundedExcerpt({
                content: candidate.document.content,
                documentType: candidate.document.type,
                query: retrievalInput,
                chronologyIntent,
            }, room - countInquiryTokens(`${TRIMMED_CANON_MARKER}\n`))
            if (!excerpt.trim()) return false
            const content = `${TRIMMED_CANON_MARKER}\n${excerpt}`
            const tokens = countInquiryTokens(content)
            if (tokens > room) return false
            entry = { ...candidate, content, tokens }
        }
        selected.push(entry)
        selectedIds.add(candidate.document.id)
        selectedTokens += entry.tokens
        if (isEvent) selectedEventTokens += entry.tokens
        if (lane === 'event') selectedEventLaneTokens += entry.tokens
        else selectedMapTokens += entry.tokens
        return true
    }
    // Events in the order they should be read: the strongest match first.
    const eventCandidates = currentStateIntent
        ? prepared
            .filter((item) => !requiredIds.has(item.document.id)
                && item.document.type === 'event' && (item.recencyBonus ?? 0) > 0)
            // "Where are we now" is answered by what just happened, so the newest
            // events before the transcript come along even without a word in common.
            .sort((left, right) => (right.recencyBonus ?? 0) - (left.recencyBonus ?? 0)
                || right.score - left.score
                || left.document.id.localeCompare(right.document.id))
            .slice(0, RECENT_EVENT_GUARANTEE)
        : prepared.filter((item) =>
            !requiredIds.has(item.document.id)
            && item.document.type === 'event'
            && !isRecencyOnly(item))
    const sourceLimit = Number.isSafeInteger(input.sourceLimit)
        ? Math.max(0, Math.min(MAX_SOURCE_MATCHES, input.sourceLimit as number))
        : DEFAULT_SELECTED_SOURCE_MESSAGES
    const suppliedSources = new Map((input.sourceMatches ?? []).slice(0, MAX_SOURCE_MATCHES)
        .map((match) => [match.messageId, match] as const))
    const selectedEventSources = new Map<string, string>()
    const semanticEventSourceDocuments = new Map<string, string>()
    const prepareSource = (
        match: NonNullable<MarkdownInquiryInput['sourceMatches']>[number],
        eventTitle = selectedEventSources.get(match.messageId),
    ) => {
        const routed = eventTitle !== undefined
        const heading = `Original historical chat evidence (${match.role}, order ${match.occurredAt}):`
        const bodyTokenBudget = Math.max(
            1,
            tokenBudget.perSource - countInquiryTokens(`${heading}\n`),
        )
        const semanticDocumentId = semanticEventSourceDocuments.get(match.messageId)
        const semanticDocument = semanticDocumentId ? byId.get(semanticDocumentId) : undefined
        const semanticPassage = semanticDocumentId ? semanticPassages.get(semanticDocumentId) : undefined
        const evidenceQuery = semanticDocument && semanticPassage
            ? semanticPassage.map(passage => semanticDocument.content.slice(passage.start, passage.end)).join('\n')
            : retrievalInput
        const excerpt = selectTokenBoundedExcerpt({
            content: match.content,
            documentType: 'other',
            query: evidenceQuery,
            chronologyIntent: false,
        }, bodyTokenBudget)
        const content = `${heading}\n${truncateToTokenBudget(
            excerpt,
            bodyTokenBudget,
        )}`
        return {
            ...match,
            content,
            eventTitle,
            routed,
            effectiveScore: match.score
                + (routed ? ROUTED_SOURCE_SCORE_BONUS : 0),
            tokens: countInquiryTokens(content),
        }
    }
    type PreparedSource = ReturnType<typeof prepareSource>
    const selectedSourceMatches: PreparedSource[] = []
    const selectedSourceIds = new Set<string>()
    const addSource = (source: PreparedSource): boolean => {
        if (selectedSourceMatches.length >= sourceLimit
            || selectedSourceIds.has(source.messageId)
            || selectedTokens + source.tokens > tokenBudget.maximum) return false
        selectedSourceMatches.push(source)
        selectedSourceIds.add(source.messageId)
        selectedTokens += source.tokens
        return true
    }
    // Ranked originals were read against the question by a model, so they come
    // before pages and replace the score-based choice of originals entirely.
    const rankedSources = (input.rankedSourceIds ?? [])
        .flatMap((messageId) => suppliedSources.get(messageId) ?? [])
    for (const match of rankedSources) {
        addSource(prepareSource(match, eventCandidates
            .find((candidate) => candidate.document.sourceMessageIds.includes(match.messageId))?.document.title))
    }
    const ranked = rankedSources.length > 0
    for (const candidate of prepared.filter((item) =>
        !requiredIds.has(item.document.id)
        && item.document.type !== 'event'
    ).slice(0, MAX_MAP_ANCHORS_BEFORE_EVENTS)) {
        addOptionalIfFits(candidate, 'map')
    }
    // The best historical match goes first even when no event summary routes it:
    // a summary can leave out the very detail asked about, and routed scenes
    // would otherwise use the room before it.
    // An event's requested original is not a query match, so it never leads.
    const leadingSource = ranked ? undefined : input.sourceMatches?.find((match) => match.score < RESOLVED_SOURCE_SCORE)
    const leadingEventTitle = leadingSource && eventCandidates
        .find((candidate) => candidate.document.sourceMessageIds.includes(leadingSource.messageId))?.document.title
    if (leadingSource && sourceLimit > 0 && (historicalEvidenceIntent || leadingSource.retrieval === 'semantic'
        || leadingSource.score >= MIN_UNROUTED_LEXICAL_SCORE)) {
        addSource(prepareSource(leadingSource, leadingEventTitle))
    }
    // Evidence is read scene by scene: an event and then its original text, so
    // the best-matching scene arrives whole before weaker summaries use the room.
    // Pages never give way here; their own lane is the target budget.
    for (const candidate of eventCandidates) {
        const newSourceIds = candidate.document.sourceMessageIds
            .filter((messageId) => !selectedEventSources.has(messageId))
        for (const messageId of newSourceIds) {
            selectedEventSources.set(messageId, candidate.document.title)
            if (semanticPassages.has(candidate.document.id)) {
                semanticEventSourceDocuments.set(messageId, candidate.document.id)
            }
        }
        const leadingOriginal = newSourceIds.some((messageId) => selectedSourceIds.has(messageId))
        const originals = newSourceIds.flatMap((messageId) => {
            const match = suppliedSources.get(messageId)
            return match && !ranked && !selectedSourceIds.has(messageId) ? [prepareSource(match)] : []
        })
        // A scene whose original fits arrives as heading plus original, so two
        // scenes' originals fit where one summary and one original did before.
        const originalTokens = originals.reduce((sum, source) => sum + source.tokens, 0)
        // A semantic passage of the summary is kept: it is the part that matched, not a repeat of the original.
        const compact = (originals.length > 0 || leadingOriginal) && candidate.heading !== undefined
            && !semanticPassages.has(candidate.document.id)
            && selectedSourceMatches.length + originals.length <= sourceLimit
            && selectedTokens + candidate.headingTokens! + originalTokens <= tokenBudget.maximum
            ? { ...candidate, content: candidate.heading, tokens: candidate.headingTokens! }
            : undefined
        if (!addOptionalIfFits(compact ?? candidate, 'event')) {
            for (const messageId of newSourceIds) selectedEventSources.delete(messageId)
            continue
        }
        for (const source of originals) addSource(source)
    }
    const evidenceRequests = [...selectedEventSources]
        .slice(0, sourceLimit)
        .map(([messageId, eventTitle]) => ({ messageId, eventTitle,
            ...(semanticEventSourceDocuments.has(messageId)
                ? { documentId: semanticEventSourceDocuments.get(messageId)! } : {}),
        }))
    const strongLexicalSourceIds = new Set([...suppliedSources.values()]
        .filter((match) => match.retrieval !== 'semantic'
            && !selectedEventSources.has(match.messageId)
            && match.score >= MIN_UNROUTED_LEXICAL_SCORE)
        .sort((left, right) => right.score - left.score
            || right.occurredAt - left.occurredAt
            || left.messageId.localeCompare(right.messageId))
        .slice(0, MAX_UNROUTED_LEXICAL_SOURCES)
        .map((match) => match.messageId))
    const unroutedSources = [...suppliedSources.values()]
        .filter((match) => !ranked && !selectedSourceIds.has(match.messageId) && !selectedEventSources.has(match.messageId)
            && (historicalEvidenceIntent || match.retrieval === 'semantic' || strongLexicalSourceIds.has(match.messageId)))
        .map((match) => prepareSource(match))
        .sort((left, right) => right.effectiveScore - left.effectiveScore
            || right.occurredAt - left.occurredAt
            || left.messageId.localeCompare(right.messageId))
    for (const source of unroutedSources) addSource(source)
    // An unrouted lead only reserved its room early; scenes read in their own order before it.
    const leading = selectedSourceMatches.findIndex((source) => source.messageId === leadingSource?.messageId)
    if (leading >= 0 && leadingEventTitle === undefined) selectedSourceMatches.push(...selectedSourceMatches.splice(leading, 1))
    for (const candidate of prepared) {
        if (!requiredIds.has(candidate.document.id)
            && candidate.document.type !== 'event') {
            addOptionalIfFits(candidate, 'map', true)
        }
    }

    return {
        mode: 'v2-current',
        graphRevision: input.documents.length,
        indexRevision: input.documents.length,
        cacheStatus: 'current',
        sources: [
            ...(recentFlow ? [{
                id: 'narrative-memory:recent-flow',
                kind: 'memory' as const,
                role: 'system' as const,
                content: recentFlow.content,
                tokens: recentFlow.tokens,
                priority: 190,
                displayName: '직전 흐름',
            }] : []),
            ...chronologicalEvents(selected, sequences).map((candidate) => ({
                id: `narrative-memory:wiki:${candidate.document.relativePath}`,
                kind: 'memory' as const,
                role: 'system' as const,
                content: candidate.content,
                tokens: candidate.tokens,
                priority: candidate.document.contextMode === 'always'
                    ? 200
                    : 100 + Math.round(candidate.score),
                ...(candidate.document.type === 'event'
                    ? { displayName: `사건 · ${candidate.document.title} · ${candidate.document.id}` }
                    : {}),
            })),
            ...selectedSourceMatches.map((match) => ({
                id: `narrative-memory:source:${encodeURIComponent(match.messageId)}:${match.occurredAt}`,
                kind: 'memory' as const,
                role: 'system' as const,
                content: match.content,
                tokens: match.tokens,
                priority: 140 + Math.round(match.effectiveScore),
                occurredAt: match.occurredAt,
                displayName: match.routed
                    ? `과거 원문 · 턴 ${Math.max(1, Math.floor((match.occurredAt + 1) / 2))} 응답 · 출처 기반 · ${match.eventTitle}`
                    : `과거 원문 / 턴 ${Math.max(1, Math.floor((match.occurredAt + 1) / 2))} ${match.role === 'assistant' ? '응답' : '입력'} / ${match.retrieval === 'semantic' ? '의미 검색' : '어휘 검색'}`,
            })),
        ],
        evidenceRequests,
        entityCandidates: [],
        metrics: {
            candidateCount: candidates.size,
            inspectedNodeCount: eligibleDocuments.length,
            inspectedEdgeCount,
            selectedNodeCount: selected.length + selectedSourceMatches.length,
            selectedTokens,
            selectedEventTokens,
            semanticCandidateCount: semantic.length,
            hopCount: selected.reduce((maximum, candidate) =>
                Math.max(maximum, candidate.hop), 0),
            auxiliaryModelCalls: 0,
        },
    }
}
