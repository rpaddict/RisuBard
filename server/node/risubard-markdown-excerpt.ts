import { expandQueryTerm } from '../../src/ts/risubard/wikiWritingLanguage'

export type ExcerptDocumentType =
    | 'event' | 'scene' | 'character' | 'location'
    | 'faction' | 'creature' | 'item' | 'concept' | 'other'

export interface MarkdownExcerptInput {
    content: string
    documentType: ExcerptDocumentType
    query: string
    maximumCharacters: number
    chronologyIntent: boolean
}

interface MarkdownSection {
    heading: string
    headingText: string
    level: number
    content: string
    order: number
}

const HISTORY_HEADINGS = /^(?:작중\s*행적|이야기\s*요약|物語要約|作中行動|story\s+history|story\s+summary|history|timeline)$/iu

const CURRENT_HEADINGS = /^(?:현재\s*상태|정체성|프로필|학력|직업|관계|지식|목표|소지품|제약|現在の状態|概要|人物情報|現在の情報|current\s+state|identity|profile|education|occupation|relationships?|knowledge|goals?|inventory|constraints?)$/iu

function normalized(value: string): string {
    return value.normalize('NFKC').toLocaleLowerCase().trim()
}

function queryTerms(value: string): string[] {
    const rawTerms = [...new Set(normalized(value)
        .split(/[^\p{L}\p{N}_]+/u)
        .filter((term) => term.length > 1))]
    const expanded = rawTerms.flatMap((term) =>
        expandQueryTerm(term))
    return [...new Set(expanded)]
        .sort((left, right) => right.length - left.length)
}

function sectionsOf(content: string): MarkdownSection[] {
    const matches = [...content.matchAll(/^(#{1,6})\s+(.+?)\s*$/gm)]
    if (matches.length === 0) return []
    return matches.map((match, order) => {
        const start = match.index ?? 0
        const end = matches[order + 1]?.index ?? content.length
        return {
            heading: match[0].trim(),
            headingText: normalized(match[2]),
            level: match[1].length,
            content: content.slice(start, end).trim(),
            order,
        }
    })
}

function matchScore(section: MarkdownSection, query: string): number {
    const searchable = normalized(section.content)
    const phrase = normalized(query)
    let score = phrase.length > 1 && searchable.includes(phrase) ? 20 : 0
    for (const term of queryTerms(query)) {
        if (section.headingText.includes(term)) score += 6
        if (searchable.includes(term)) score += 2
    }
    return score
}

function centeredBody(
    content: string,
    query: string,
    maximumCharacters: number
): string {
    if (content.length <= maximumCharacters) return content
    const firstBreak = content.indexOf('\n')
    const heading = firstBreak >= 0 ? content.slice(0, firstBreak).trim() : ''
    const body = firstBreak >= 0 ? content.slice(firstBreak + 1).trim() : content
    const prefix = heading ? `${heading}\n\n` : ''
    const bodyBudget = Math.max(0, maximumCharacters - prefix.length)
    if (bodyBudget === 0) return prefix.slice(0, maximumCharacters)
    const searchable = normalized(body)
    const match = queryTerms(query)
        .map((term) => searchable.indexOf(term))
        .find((index) => index >= 0) ?? -1
    if (match < 0) return `${prefix}${body.slice(0, bodyBudget)}`
        .slice(0, maximumCharacters)
    const leading = Math.floor(bodyBudget * 0.35)
    let start = Math.max(0, match - leading)
    let end = Math.min(body.length, start + bodyBudget)
    if (end - start < bodyBudget) start = Math.max(0, end - bodyBudget)
    const startMarker = start > 0 ? '…' : ''
    const endMarker = end < body.length ? '…' : ''
    const markerBudget = bodyBudget - startMarker.length - endMarker.length
    return `${prefix}${startMarker}${body.slice(start, start + markerBudget)}${endMarker}`
        .slice(0, maximumCharacters)
}

function joinBounded(
    sections: readonly MarkdownSection[],
    query: string,
    maximumCharacters: number
): string {
    let result = ''
    for (const [index, section] of sections.entries()) {
        const separator = result ? '\n\n' : ''
        const remaining = maximumCharacters - result.length - separator.length
        if (remaining <= 0) break
        const remainingSections = sections.length - index
        const fairShare = Math.max(1, Math.floor(
            remaining / remainingSections
        ))
        result += separator + centeredBody(
            section.content,
            query,
            fairShare
        )
    }
    return result.slice(0, maximumCharacters).trim()
}

function centeredPlainText(
    content: string,
    query: string,
    maximumCharacters: number
): string {
    if (content.length <= maximumCharacters) return content
    const searchable = normalized(content)
    const match = queryTerms(query)
        .map((term) => searchable.indexOf(term))
        .find((index) => index >= 0) ?? -1
    if (match < 0) return content.slice(0, maximumCharacters)
    const start = Math.max(0, Math.min(
        content.length - maximumCharacters,
        match - Math.floor(maximumCharacters * 0.35)
    ))
    return content.slice(start, start + maximumCharacters)
}

export function selectMarkdownExcerpt(
    input: MarkdownExcerptInput
): string {
    const maximumCharacters = Math.max(0, Math.floor(input.maximumCharacters))
    if (maximumCharacters === 0 || input.content.length === 0) return ''
    if (input.content.length <= maximumCharacters) return input.content.trim()
    const sections = sectionsOf(input.content)
    if (sections.length === 0) {
        return centeredPlainText(
            input.content,
            input.query,
            maximumCharacters
        ).trim()
    }

    const title = sections.find((section) => section.level <= 2) ?? sections[0]
    const boundedTitle = sections.length > 1 && title.content.length > 400
        ? { ...title, content: title.heading }
        : title
    const selected: MarkdownSection[] = [boundedTitle]
    const selectedOrders = new Set([title.order])
    const add = (section: MarkdownSection) => {
        if (selectedOrders.has(section.order)) return
        selected.push(section)
        selectedOrders.add(section.order)
    }

    if (input.documentType === 'character') {
        if (input.chronologyIntent) {
            for (const section of sections) {
                if (HISTORY_HEADINGS.test(section.headingText)) add(section)
            }
        }
        for (const section of sections) {
            if (CURRENT_HEADINGS.test(section.headingText)) add(section)
        }
        const matching = sections.filter((section) =>
            !HISTORY_HEADINGS.test(section.headingText)
            && matchScore(section, input.query) > 0)
            .sort((left, right) =>
                matchScore(right, input.query) - matchScore(left, input.query)
                || left.order - right.order)
        for (const section of matching) add(section)
    }
    else {
        const matching = sections.filter((section) =>
            matchScore(section, input.query) > 0)
            .sort((left, right) =>
                matchScore(right, input.query) - matchScore(left, input.query)
                || left.order - right.order)
        for (const section of matching) add(section)
        if (selected.length === 1 && sections.length > 1) add(sections[1])
    }

    return joinBounded(selected, input.query, maximumCharacters)
}
