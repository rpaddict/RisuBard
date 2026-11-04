// BardWiki notes for the reader board. Readers may only remember what was
// published, so every note is cut at the last published message: event
// documents by where their source messages sit in the chat, and the story arc
// plot only when the last event it covers is already published.

import { createEventOrder, type EventOrderMessage } from './eventOrder'
import { isStoryArcChapterTitle, isStoryArcTitle } from './wikiWritingLanguage'

export interface ReaderBoardWikiDocument {
    id: string
    type: string
    status: string
    title: string
    content: string
    sourceMessageIds: string[]
    created?: string
    updated?: string
}

/** Characters of wiki text one request may carry. */
export const WIKI_CONTEXT_LIMIT = 12_000
const EVENT_LIMIT = 1_500
const ARC_LIMIT = 5_000

const checkpointPattern = /<!--\s*risubard-story-arc-checkpoint:\s*([A-Za-z0-9._:-]{1,200})\s*-->/gu

function plainText(content: string): string {
    return content
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/\[\[([^\]#|]+)(?:#[^|\]]*)?(?:\|([^\]]+))?\]\]/gu, (_, target: string, label?: string) => (label ?? target).trim())
        .replace(/\n{3,}/g, '\n\n')
        .trim()
}

function clip(value: string, limit: number): string {
    return value.length <= limit ? value : `${value.slice(0, limit)}…`
}

/**
 * Picks the notes a run may use. `publishedUntil` is the chat index of the
 * last published message; `focus` is the index range of the episode being
 * published now, whose events come first.
 */
export function selectReaderBoardWiki(input: {
    documents: readonly ReaderBoardWikiDocument[]
    messages: readonly EventOrderMessage[]
    publishedUntil: number
    focus?: { start: number; end: number }
    limit?: number
}): string {
    if (input.publishedUntil < 0) return ''
    const limit = input.limit ?? WIKI_CONTEXT_LIMIT
    const order = createEventOrder(input.messages)
    const active = input.documents.filter((document) => document.status === 'active')
    const events = active
        .filter((document) => document.type === 'event')
        .map((document) => ({ document, position: order.position(document) }))
        .filter((item): item is { document: ReaderBoardWikiDocument; position: number } =>
            item.position !== undefined && item.position <= input.publishedUntil)
        .sort((a, b) => a.position - b.position)
    const byId = new Map(events.map((item) => [item.document.id, item.position]))

    // An arc plot is safe only if the last event it took in is published.
    const arcs = active
        .filter((document) => document.type === 'other' && (isStoryArcTitle(document.title) || isStoryArcChapterTitle(document.title)))
        .filter((document) => {
            const checkpoint = [...document.content.matchAll(checkpointPattern)].at(-1)?.[1]
            return !!checkpoint && byId.has(checkpoint)
        })

    const parts: string[] = []
    let used = 0
    const push = (text: string) => {
        if (used + text.length > limit) return false
        parts.push(text)
        used += text.length
        return true
    }
    for (const arc of arcs) push(`## ${arc.title}\n${clip(plainText(arc.content), ARC_LIMIT)}`)

    const focus = input.focus
    const inFocus = focus ? events.filter((item) => item.position >= focus.start && item.position <= focus.end) : []
    const earlier = events.filter((item) => !inFocus.includes(item)).reverse()
    const picked: typeof events = []
    for (const item of [...inFocus, ...earlier]) {
        const text = `### ${item.document.title}\n${clip(plainText(item.document.content), EVENT_LIMIT)}`
        if (used + text.length > limit) continue
        used += text.length
        picked.push(item)
    }
    // Story order reads better than pick order.
    picked.sort((a, b) => a.position - b.position)
    if (picked.length > 0) {
        parts.push(['## 연재된 사건 기록', ...picked.map((item) => `### ${item.document.title}\n${clip(plainText(item.document.content), EVENT_LIMIT)}`)].join('\n\n'))
    }
    return parts.join('\n\n')
}
