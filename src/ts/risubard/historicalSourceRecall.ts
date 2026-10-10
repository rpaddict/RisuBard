import { oocTurnIndices } from './oocTurns'

const MAX_SOURCE_MATCHES = 32
const DEFAULT_SOURCE_MATCHES = 8
const MAX_SOURCE_EXCERPT_CHARACTERS = 1_200

const QUERY_STOPWORDS = new Set([
    '그는', '그녀는', '그들은', '나는', '우리는', '이것', '그것', '저것',
    '지금', '현재', '무엇', '무엇을', '어떻게', '왜', '해야', '하지',
    '한다', '했다', '하는', '있는', '있다', '없는', '없다', '대한',
    '관련', '정보', '알려', '해줘', '그리고', '그러면', '아는', '같다',
    '대해', '대해서', '생각',
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

export interface HistoricalSourceMessage {
    role?: unknown
    data?: unknown
    chatId?: unknown
    disabled?: unknown
    isComment?: unknown
}

export interface HistoricalSourceMatch {
    retrieval?: 'semantic'
    messageId: string
    role: 'user' | 'assistant'
    content: string
    score: number
    occurredAt: number
}

function beforeRecentAssistantTurns<T>(
    items: readonly T[],
    requestedTurns: number,
    roleOf: (item: T) => unknown
): T[] {
    const turnCount = Math.max(1, requestedTurns)
    const assistantIndices = items.flatMap((item, index) =>
        roleOf(item) === 'assistant' || roleOf(item) === 'char' ? [index] : [])
    if (assistantIndices.length === 0) {
        return items.slice(0, Math.max(0, items.length - turnCount))
    }
    const firstAssistant = assistantIndices[
        Math.max(0, assistantIndices.length - turnCount)
    ] ?? 0
    let start = firstAssistant
    while (start > 0 && roleOf(items[start - 1] as T) !== 'assistant'
        && roleOf(items[start - 1] as T) !== 'char') start -= 1
    return items.slice(0, start)
}

export function resolveHistoricalSourceMatchesById(input: {
    messageIds: readonly string[]
    messages: readonly HistoricalSourceMessage[]
    ignoreOocTurns?: boolean
    currentInput?: string
    queryByMessageId?: Readonly<Record<string, string>>
    excludeRecentMessages?: number
}): HistoricalSourceMatch[] {
    const requested = [...new Set(input.messageIds)].slice(0, MAX_SOURCE_MATCHES)
    if (requested.length === 0) return []
    const historical = eligibleHistoricalSources(input.messages, input.ignoreOocTurns, input.excludeRecentMessages)
    const byId = new Map(historical.map(({ message, occurredAt }) => [
        message.chatId as string,
        { message, occurredAt },
    ] as const))
    const terms = queryTerms((input.currentInput ?? '').slice(0, 4_096))
    return requested.flatMap((messageId) => {
        const found = byId.get(messageId)
        if (!found) return []
        const content = found.message.data as string
        const anchor = terms.find((term) => normalized(content).includes(term)) ?? ''
        return [{ messageId, role: found.message.role === 'user' ? 'user' as const : 'assistant' as const,
            content: input.queryByMessageId?.[messageId]?.trim()
                ? semanticEvidenceExcerpt(content, input.queryByMessageId[messageId], MAX_SOURCE_EXCERPT_CHARACTERS)
                : centeredExcerpt(content, anchor, MAX_SOURCE_EXCERPT_CHARACTERS),
            score: 1_000, occurredAt: found.occurredAt }]
    })
}

export function eligibleHistoricalSources(messages: readonly HistoricalSourceMessage[], ignoreOocTurns = true, excludeRecentMessages = 12) {
    const allBeforeBoundary = messages.findLastIndex((message) =>
        message.disabled === 'allBefore')
    const excluded = oocTurnIndices(messages, ignoreOocTurns)
    const active = messages.flatMap((message, occurredAt) => {
        if (excluded.has(occurredAt) || occurredAt <= allBeforeBoundary
            || (message.role !== 'user' && message.role !== 'char')
            || typeof message.data !== 'string'
            || typeof message.chatId !== 'string'
            || message.chatId.trim().length === 0
            || message.isComment
            || message.disabled) return []
        return [{ message, occurredAt }]
    })
    const requestedRecent = Number.isSafeInteger(excludeRecentMessages)
        ? excludeRecentMessages
        : 12
    return beforeRecentAssistantTurns(
        active,
        requestedRecent,
        ({ message }) => message.role
    )
}

/** Ordered message IDs just before the recent transcript, for inquiry turn labels. */
export function buildInquiryTimeline(
    messages: readonly HistoricalSourceMessage[],
    workingMessageLimit: number,
    limit = 96,
): { messages: Array<{ chatId: string; role: 'user' | 'char' }> } {
    return {
        messages: eligibleHistoricalSources(messages, true, workingMessageLimit)
            .slice(-limit)
            .map(({ message }) => ({
                chatId: message.chatId as string,
                role: message.role === 'char' ? 'char' as const : 'user' as const,
            })),
    }
}

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
    return [...new Set(normalized(value)
        .split(/[^\p{L}\p{N}_]+/u)
        .filter((term) => term.length > 1 && !QUERY_STOPWORDS.has(term))
        .map(normalizedQueryTerm)
        .filter((term) => term.length > 1 && !QUERY_STOPWORDS.has(term)))]
        .slice(0, 32)
}

function semanticEvidenceExcerpt(content: string, query: string, maximum: number): string {
    if (content.length <= maximum) return content.trim()
    const terms = queryTerms(query.slice(0, 4096))
    if (!terms.length) return centeredExcerpt(content, '', maximum)
    const width = maximum - 2
    const step = Math.floor(width / 2)
    const windows: Array<{ start: number; hits: string[] }> = []
    const frequencies = new Map<string, number>()
    for (let start = 0; start < content.length; start += step) {
        const text = normalized(content.slice(start, start + width))
        const hits = terms.filter(term => text.includes(term))
        windows.push({ start, hits })
        for (const term of hits) frequencies.set(term, (frequencies.get(term) ?? 0) + 1)
        if (start + width >= content.length) break
    }
    // Distinctive term coverage beats an early repeated title or generic mention.
    let best = windows[0]
    let bestScore = -1
    for (const window of windows) {
        const score = window.hits.reduce((total, term) => total
            + Math.log(1 + windows.length / (frequencies.get(term) ?? 1)), 0)
        if (score > bestScore) { best = window; bestScore = score }
    }
    const leading = best.start > 0 ? '…' : ''
    const trailing = best.start + width < content.length ? '…' : ''
    return `${leading}${content.slice(best.start, best.start + width)}${trailing}`
}

function centeredExcerpt(
    content: string,
    term: string,
    maximumCharacters: number
): string {
    if (content.length <= maximumCharacters) return content.trim()
    const match = normalized(content).indexOf(term)
    const start = Math.max(0, Math.min(
        content.length - maximumCharacters,
        match - Math.floor(maximumCharacters * 0.35)
    ))
    const leading = start > 0 ? '…' : ''
    const trailing = start + maximumCharacters < content.length ? '…' : ''
    const bodyLength = maximumCharacters - leading.length - trailing.length
    return `${leading}${content.slice(start, start + bodyLength)}${trailing}`
}

export function findHistoricalSourceMatches(input: {
    ignoreOocTurns?: boolean
    currentInput: string
    messages: readonly HistoricalSourceMessage[]
    excludeRecentMessages?: number
    maximumMatches?: number
}): HistoricalSourceMatch[] {
    const maximumMatches = Number.isSafeInteger(input.maximumMatches)
        ? Math.max(0, Math.min(MAX_SOURCE_MATCHES, input.maximumMatches as number))
        : DEFAULT_SOURCE_MATCHES
    if (maximumMatches === 0) return []
    const terms = queryTerms(input.currentInput.slice(0, 4_096))
    if (terms.length === 0) return []
    const allBeforeBoundary = input.messages.findLastIndex((message) =>
        message.disabled === 'allBefore')
    const excluded = oocTurnIndices(input.messages, input.ignoreOocTurns !== false)
    const active = input.messages.flatMap((message, occurredAt) => {
        if (excluded.has(occurredAt) || occurredAt <= allBeforeBoundary
            || (message.role !== 'user' && message.role !== 'char')
            || typeof message.data !== 'string'
            || typeof message.chatId !== 'string'
            || message.chatId.trim().length === 0
            || message.isComment
            || message.disabled) return []
        return [{
            messageId: message.chatId,
            role: message.role === 'user' ? 'user' as const : 'assistant' as const,
            content: message.data,
            normalizedContent: normalized(message.data),
            occurredAt,
        }]
    })
    const requestedRecent = Number.isSafeInteger(input.excludeRecentMessages)
        ? input.excludeRecentMessages as number
        : 12
    const historical = beforeRecentAssistantTurns(
        active,
        requestedRecent,
        (message) => message.role
    )
    if (historical.length === 0) return []

    const termWeights = new Map(terms.map((term) => {
        const documentFrequency = historical.reduce((count, message) =>
            count + Number(message.normalizedContent.includes(term)), 0)
        return [term, Math.log(1 + (
            historical.length - documentFrequency + 0.5
        ) / (documentFrequency + 0.5))] as const
    }))

    return historical.flatMap((message) => {
        const matchedTerms = terms.filter((term) =>
            message.normalizedContent.includes(term))
        if (matchedTerms.length === 0) return []
        const orderedTerms = matchedTerms.sort((left, right) =>
            (termWeights.get(right) ?? 0) - (termWeights.get(left) ?? 0)
            || right.length - left.length)
        const score = orderedTerms.reduce((total, term) =>
            total + (termWeights.get(term) ?? 0), 0)
        return [{
            messageId: message.messageId,
            role: message.role,
            content: centeredExcerpt(
                message.content,
                orderedTerms[0] ?? '',
                MAX_SOURCE_EXCERPT_CHARACTERS
            ),
            score,
            occurredAt: message.occurredAt,
        }]
    }).sort((left, right) =>
        right.score - left.score
        || right.occurredAt - left.occurredAt
        || left.messageId.localeCompare(right.messageId))
        .slice(0, maximumMatches)
}
