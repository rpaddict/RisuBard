import type { NarrativeMemoryWikiMarkdown } from './memoryWiki'

type MarkdownDocument = NarrativeMemoryWikiMarkdown['documents'][number]

export type StorySourceRef = {
    kind: 'chat'
    messageIds: string[]
}

export interface StorySoFarEntry {
    id: string
    title: string
    created: string
    summary: string[]
    source: StorySourceRef
}

function storySection(content: string): string[] {
    const lines = content.replace(/\r\n/g, '\n').split('\n')
    let headingLevel = 0
    const heading = lines.findIndex((line) => {
        const match = /^(#{2,3})\s+(이야기 요약|확정된 사건|物語要約|確定した出来事|Story Summary|Established Events)\s*$/i.exec(
            line.trim()
        )
        if (!match) return false
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
    documents: readonly MarkdownDocument[]
): StorySoFarEntry[] {
    return documents
        .filter((document) => document.type === 'event'
            && document.status === 'active')
        .map((document) => ({ document, summary: storySection(document.content) }))
        .filter(({ summary }) => summary.length > 0)
        .sort((left, right) => {
            const leftTime = left.document.created ?? left.document.updated
            const rightTime = right.document.created ?? right.document.updated
            return leftTime.localeCompare(rightTime)
                || left.document.id.localeCompare(right.document.id)
        })
        .map(({ document, summary }) => ({
            id: document.id,
            title: document.title,
            created: document.created ?? document.updated,
            summary,
            source: sourceFor(document),
        }))
}
