import { basename } from 'node:path'
import { get_encoding, type Tiktoken } from '@dqbd/tiktoken'
import type { MarkdownWikiDocument } from './risubard-markdown-wiki'
import { normalizeRisuBardInquiryTokenBudget } from '../../src/ts/risubard/risuBardSettings'
import {
    expandQueryTerm,
    isJapaneseQueryStopword,
} from '../../src/ts/risubard/wikiWritingLanguage'
import { selectMarkdownExcerpt } from './risubard-markdown-excerpt'

const MAX_SELECTED_DOCUMENTS = 12
const MAX_SOURCE_CHARACTERS = 12_000
const MAX_CANDIDATES = 64
const MAX_DIRECT_SEEDS = 32
const MAX_SEMANTIC_SEEDS = 32
const MAX_EXPANDED_DOCUMENTS_PER_HOP = 8
const MAX_EDGES_PER_DOCUMENT = 16
const MAX_INSPECTED_EDGES = 256
const MAX_HOPS = 2
const MAX_SOURCE_MATCHES = 32
const DEFAULT_SELECTED_SOURCE_MESSAGES = 8
const MAX_MAP_ANCHORS_BEFORE_EVENTS = 4
const ROUTED_SOURCE_SCORE_BONUS = 12
const SEMANTIC_RRF_K = 60
const SEMANTIC_RRF_SCALE = 480
const ENTITY_HINT_SCORE = 10_000

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

export interface MarkdownInquiryInput {
    documents: readonly MarkdownWikiDocument[]
    currentInput: string
    semanticMatches?: readonly {
        documentId: string
        score: number
    }[]
    entityHints?: readonly {
        kind: 'character'
        names: readonly string[]
    }[]
    sourceMatches?: readonly {
        messageId: string
        role: 'user' | 'assistant'
        content: string
        score: number
        occurredAt: number
    }[]
    sourceLimit?: number
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
}

interface NormalizedDocument {
    title: string
    aliases: string[]
    content: string
    links: string
    keys: string[]
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
            && term.length - candidate.length >= 2)
        if (!suffix) return term
        term = term.slice(0, -suffix.length)
    }
}

function queryTerms(value: string): string[] {
    const rawTerms = [...new Set(normalized(value).split(/[^\p{L}\p{N}_]+/u)
        .filter((term) => term.length > 1))]
    const expanded = rawTerms.flatMap((term) => {
        if (QUERY_STOPWORDS.has(term)) return []
        return expandQueryTerm(normalizedQueryTerm(term))
            .filter((candidate) => (candidate.length > 1
                || /^[〆々\u3400-\u4DBF\u4E00-\u9FFF]$/u.test(candidate))
                && !QUERY_STOPWORDS.has(candidate)
                && !isJapaneseQueryStopword(candidate))
    })
    return [...new Set(expanded)].slice(0, 32)
}

function hasPastIntent(value: string): boolean {
    return /(?:과거|예전|이전|당시|전날|어제|지난|그때|앞서|전에|처음|초반|원래|회상|떠올리|기억|past|previous|before|earlier|formerly|used to|昔|以前|当時)/i
        .test(value)
}

function hasHistoricalEvidenceIntent(value: string): boolean {
    const past = hasPastIntent(value)
    const causalOrDetail = /(?:왜|원인|이유|계기|인과|영향|분석|세부|근거|why|cause|reason|trigger|analysis|detail|evidence)/i
        .test(value)
    return past || causalOrDetail
}

function hasLinkedCharacterIntent(value: string): boolean {
    return /(?:인물|누구|동료|관계|주변|함께|연결|people|who|companion|relationship|with whom|人物|誰|仲間|関係)/i
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
    const { title, aliases, content, links } = normalizedDocument(document)
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
            const { title, aliases, content, links } = normalizedDocument(document)
            return count + Number([title, ...aliases].some((key) =>
                key.includes(term))
                || links.includes(term)
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
    if (candidate.document.type === 'event') score += pastIntent ? 3 : 0
    else score += currentIntent ? 3 : 1
    return score
}

export function inquireMarkdownDocuments(
    input: MarkdownInquiryInput
): MarkdownInquiryResult {
    const normalizedQuery = normalized(input.currentInput.slice(0, 4_096))
    const terms = queryTerms(input.currentInput.slice(0, 4_096))
    const eligibleDocuments = input.documents.filter((document) =>
        isEligible(document, input))
    const characterTitles = new Set(eligibleDocuments
        .filter((document) => document.type === 'character')
        .flatMap((document) => [document.title, ...document.aliases]
            .map(normalized)))
    const characterAnchorTerms = new Set(terms.filter((term) =>
        characterTitles.has(term)))
    const termWeights = queryTermWeights(eligibleDocuments, terms)
    const requiredDocuments = eligibleDocuments.filter((document) =>
        document.contextMode === 'always'
            || document.type === 'scene')
    if (requiredDocuments.length > MAX_SELECTED_DOCUMENTS) {
        throw new Error('Required wiki context exceeds 12 documents')
    }

    const base = catalogBase(input.documents)
    const byId = new Map(eligibleDocuments.map((document) =>
        [document.id, document]))

    const direct = eligibleDocuments.map((document) => ({
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
    for (const match of input.semanticMatches ?? []) {
        if (!Number.isFinite(match.score) || match.score <= 0
            || !byId.has(match.documentId)) continue
        semanticScores.set(
            match.documentId,
            Math.max(semanticScores.get(match.documentId) ?? 0, match.score)
        )
    }
    const semantic = [...semanticScores.entries()]
        .sort((left, right) => right[1] - left[1]
            || left[0].localeCompare(right[0]))
        .slice(0, MAX_SEMANTIC_SEEDS)
    const directById = new Map(direct.slice(0, MAX_DIRECT_SEEDS).map((item) =>
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
    const hybridDirect = [...directById.values()]
        .sort((left, right) =>
            right.directScore - left.directScore
            || right.document.updated.localeCompare(left.document.updated)
            || left.document.id.localeCompare(right.document.id))
        .slice(0, MAX_DIRECT_SEEDS)
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
    for (const item of hybridDirect) {
        if (candidates.size >= MAX_CANDIDATES) break
        candidates.set(item.document.id, {
            ...item,
            hop: 0,
            linkScore: 0,
        })
    }

    let inspectedEdgeCount = 0
    for (let hop = 0; hop < MAX_HOPS; hop += 1) {
        const expandable = [...candidates.values()]
            .filter((candidate) => candidate.hop === hop)
            .sort((left, right) =>
                right.directScore - left.directScore
                || right.linkScore - left.linkScore
                || left.document.id.localeCompare(right.document.id))
            .slice(0, MAX_EXPANDED_DOCUMENTS_PER_HOP)
        for (const candidate of expandable) {
            const neighbors = [...(base.adjacency.get(
                candidate.document.id
            ) ?? [])]
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
                if (candidates.size >= MAX_CANDIDATES) continue
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
                })
            }
            if (inspectedEdgeCount >= MAX_INSPECTED_EDGES) break
        }
        if (inspectedEdgeCount >= MAX_INSPECTED_EDGES) break
    }

    const pastIntent = hasPastIntent(input.currentInput)
    const currentIntent = /(?:현재|지금|최신|상태|current|now|latest|status|現在|今)/i
        .test(input.currentInput)
    const stateTopicIntent = /(?:상태|목표|관계|위치|어디|소지품|보유|능력|지식|state|status|goal|relationship|location|where|inventory|ability|knowledge|状態|目標|関係|位置)/i
        .test(input.currentInput)
    const stateHistoryIntent = pastIntent
        || /(?:상태\s*변화|왜|원인|이유|계기|변해|바뀌|했|였|됐|갔|왔|던|데려간|사라진|향했|cause|reason|changed?|became|変化|理由|原因)/i
            .test(input.currentInput)
    const explicitEventIntent = /(?:사건|이벤트|발생|일어났|벌어졌|event|incident|happened|occurred|事件|発生)/i
        .test(input.currentInput)
        || eligibleDocuments.some((document) => document.type === 'event'
            && [document.title, ...(document.aliases ?? [])].some((title) =>
                normalizedQuery.includes(normalized(title))))
    const currentStateIntent = stateTopicIntent
        && !stateHistoryIntent
        && !explicitEventIntent
    const chronologyIntent = /(?:작중\s*행적|행적|모험|여정|연대기|시간\s*순|순서대로|지금까지|journey|adventures?|chronolog|timeline|story\s+history)/i
        .test(input.currentInput)
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
    const excerptCharacters = Math.min(
        MAX_SOURCE_CHARACTERS,
        tokenBudget.perSource,
    )
    const prepared = [
        ...requiredDocuments.map((document) => ({
            document,
            score: 100,
            hop: candidates.get(document.id)?.hop ?? 0,
        })),
        ...automatic,
    ].map((candidate) => {
        const content = selectMarkdownExcerpt({
            content: candidate.document.content,
            documentType: candidate.document.type,
            query: input.currentInput,
            maximumCharacters: excerptCharacters,
            chronologyIntent,
        })
        const boundedContent = truncateToTokenBudget(
            content,
            tokenBudget.perSource,
        )
        return {
            ...candidate,
            content: boundedContent,
            tokens: countInquiryTokens(boundedContent),
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
    let selectedTokens = 0
    let selectedMapTokens = 0
    let selectedEventLaneTokens = 0
    let selectedEventTokens = 0
    for (const candidate of prepared.filter((item) =>
        requiredIds.has(item.document.id))) {
        if (selectedTokens + candidate.tokens > tokenBudget.maximum) {
            throw new Error('Required wiki context exceeds token budget')
        }
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
    ) => {
        const isEvent = candidate.document.type === 'event'
        const laneTokens = lane === 'event'
            ? selectedEventLaneTokens
            : selectedMapTokens
        const laneBudget = lane === 'event'
            ? tokenBudget.events
            : selectedMapTokenBudget
        if (selectedIds.has(candidate.document.id)
            || selected.length >= MAX_SELECTED_DOCUMENTS
            || selectedTokens + candidate.tokens > tokenBudget.maximum
            || laneTokens + candidate.tokens > laneBudget) {
            return false
        }
        selected.push(candidate)
        selectedIds.add(candidate.document.id)
        selectedTokens += candidate.tokens
        if (isEvent) selectedEventTokens += candidate.tokens
        if (lane === 'event') selectedEventLaneTokens += candidate.tokens
        else selectedMapTokens += candidate.tokens
        return true
    }
    for (const candidate of prepared.filter((item) =>
        !requiredIds.has(item.document.id)
        && item.document.type !== 'event'
    ).slice(0, MAX_MAP_ANCHORS_BEFORE_EVENTS)) {
        addOptionalIfFits(candidate, 'map')
    }
    if (eventEvidenceIntent) {
        for (const candidate of prepared.filter((item) =>
            !requiredIds.has(item.document.id)
            && item.document.type === 'event'
        )) {
            addOptionalIfFits(candidate, 'event')
        }
    }
    if (!eventEvidenceIntent && !currentStateIntent) {
        for (const candidate of prepared.filter((item) =>
            !requiredIds.has(item.document.id)
            && item.document.type === 'event'
        )) {
            addOptionalIfFits(candidate, 'map')
        }
    }
    const sourceLimit = Number.isSafeInteger(input.sourceLimit)
        ? Math.max(0, Math.min(MAX_SOURCE_MATCHES, input.sourceLimit as number))
        : DEFAULT_SELECTED_SOURCE_MESSAGES
    const selectedEventSources = new Map<string, string>()
    for (const candidate of selected) {
        if (candidate.document.type !== 'event') continue
        for (const messageId of candidate.document.sourceMessageIds) {
            if (!selectedEventSources.has(messageId)) {
                selectedEventSources.set(messageId, candidate.document.title)
            }
        }
    }
    const evidenceRequests = [...selectedEventSources]
        .slice(0, sourceLimit)
        .map(([messageId, eventTitle]) => ({ messageId, eventTitle }))
    const preparedSourceMatches = (input.sourceMatches ?? [])
        .slice(0, MAX_SOURCE_MATCHES)
        .map((match) => {
            const eventTitle = selectedEventSources.get(match.messageId)
            const routed = eventTitle !== undefined
            const heading = `Original historical chat evidence (${match.role}, order ${match.occurredAt}):`
            const bodyTokenBudget = Math.max(
                1,
                tokenBudget.perSource - countInquiryTokens(`${heading}\n`),
            )
            const excerpt = selectMarkdownExcerpt({
                content: match.content,
                documentType: 'other',
                query: input.currentInput,
                maximumCharacters: Math.min(
                    MAX_SOURCE_CHARACTERS,
                    bodyTokenBudget,
                ),
                chronologyIntent: false,
            })
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
        })
        .filter((match) => historicalEvidenceIntent || match.routed)
        .sort((left, right) =>
            Number(right.routed) - Number(left.routed)
            || right.effectiveScore - left.effectiveScore
            || right.occurredAt - left.occurredAt
            || left.messageId.localeCompare(right.messageId))
    const selectedSourceMatches: typeof preparedSourceMatches = []
    const selectedSourceIds = new Set<string>()
    for (const match of preparedSourceMatches) {
        if (selectedSourceMatches.length >= sourceLimit
            || selectedSourceIds.has(match.messageId)
            || selectedTokens + match.tokens > tokenBudget.maximum
            || selectedMapTokens + match.tokens > selectedMapTokenBudget) continue
        selectedSourceMatches.push(match)
        selectedSourceIds.add(match.messageId)
        selectedTokens += match.tokens
        selectedMapTokens += match.tokens
    }
    for (const candidate of prepared) {
        if (!requiredIds.has(candidate.document.id)
            && candidate.document.type !== 'event') {
            addOptionalIfFits(candidate, 'map')
        }
    }

    return {
        mode: 'v2-current',
        graphRevision: input.documents.length,
        indexRevision: input.documents.length,
        cacheStatus: 'current',
        sources: [
            ...selected.map((candidate) => ({
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
                    : `과거 원문 · 턴 ${Math.max(1, Math.floor((match.occurredAt + 1) / 2))} ${match.role === 'assistant' ? '응답' : '입력'} · 어휘 검색`,
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
