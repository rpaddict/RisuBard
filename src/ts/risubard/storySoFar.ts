import type { NarrativeMemoryWikiMarkdown } from './memoryWiki'
import { isWikiHeadingLabel } from './wikiWritingLanguage'
import { createEventOrder, type EventOrderMessage } from './eventOrder'
import { formatStoryTimeLabel } from '../../../server/node/risubard-memory-metadata'

type MarkdownDocument = Omit<NarrativeMemoryWikiMarkdown['documents'][number], 'content'> & {
    content?: string
}

export type StorySourceRef = {
    kind: 'chat'
    messageIds: string[]
}

export interface StorySoFarEntry {
    id: string
    title: string
    created: string
    /** Story day from day 0 and any in-story date, such as "+2일, 7월 넷째 주 월요일". */
    time: string
    summary: string[]
    source: StorySourceRef
}

/** Bullets of an event's story summary section; also used by the server. */
export function storySection(content: string): string[] {
    const lines = content.replace(/\r\n/g, '\n').split('\n')
    let headingLevel = 0
    const heading = lines.findIndex((line) => {
        const match = /^(#{2,3})\s+(.+?)\s*$/.exec(line.trim())
        if (!match || !isWikiHeadingLabel('summary', match[2])) return false
        headingLevel = match[1].length
        return true
    })
    if (heading < 0) return []
    const items: string[] = []
    for (const line of lines.slice(heading + 1)) {
        const nextHeading = /^(#{1,6})\s+/.exec(line.trim())
        if (nextHeading && nextHeading[1].length <= headingLevel) break
        const match = line.match(/^\s*[-*]\s+(.+?)\s*$/)
        if (match) items.push(match[1].replace(/\[\[([^\]]+)\]\]/g, '$1'))
    }
    return items
}

function sourceFor(document: MarkdownDocument): StorySourceRef {
    return { kind: 'chat', messageIds: [...document.sourceMessageIds] }
}

export function buildStorySoFar(
    documents: readonly MarkdownDocument[],
    messages?: readonly EventOrderMessage[],
    summaries?: ReadonlyMap<string, readonly string[]>
): StorySoFarEntry[] {
    const order = createEventOrder(messages)
    return documents
        .filter((document) => document.type === 'event'
            && document.status === 'active')
        .map((document) => ({
            document,
            summary: [...(summaries?.get(document.id)
                ?? (document.content === undefined ? [] : storySection(document.content)))],
        }))
        .filter(({ summary }) => summary.length > 0)
        .sort((left, right) => order.compare(left.document, right.document))
        .map(({ document, summary }) => ({
            id: document.id,
            title: document.title,
            created: document.created ?? document.updated,
            time: formatStoryTimeLabel(document.retrievalMetadata?.storyTime),
            summary,
            source: sourceFor(document),
        }))
}
