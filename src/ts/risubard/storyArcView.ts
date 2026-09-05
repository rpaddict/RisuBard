import type { NarrativeMemoryWikiMarkdown } from './memoryWiki'

type WikiDocument = NarrativeMemoryWikiMarkdown['documents'][number]

const STORY_ARC_TITLES = [
    '스토리 아크 플롯',
    'Story Arc Plot',
    'ストーリーアークプロット',
    '스토리 아크 지도',
    'Story Arc Map',
] as const

const checkpointPattern = /<!--\s*risubard-story-arc-checkpoint:\s*([A-Za-z0-9._:-]{1,200})\s*-->/gu
const wikiLinkPattern = /\[\[([^\]#|]+)(?:#[^|\]]*)?(?:\|([^\]]+))?\]\]/gu

export interface StoryArcLink {
    target: string
    label: string
}

export interface StoryArcView {
    document: WikiDocument | undefined
    checkpointSize: number
    pendingEventCount: number
    remainingEventCount: number
}

function normalizedTitle(value: string): string {
    return value.normalize('NFKC').toLocaleLowerCase().trim()
}

export function findStoryArcDocument(
    documents: readonly WikiDocument[]
): WikiDocument | undefined {
    const titles = new Set(STORY_ARC_TITLES.map(normalizedTitle))
    return documents.find((document) =>
        document.type === 'other'
        && document.status !== 'retracted'
        && titles.has(normalizedTitle(document.title)))
}

function storyArcCheckpoint(content: string): string | undefined {
    const matches = [...content.matchAll(checkpointPattern)]
    return matches.at(-1)?.[1]
}

function activeEvents(documents: readonly WikiDocument[]): WikiDocument[] {
    return documents
        .filter((document) =>
            document.type === 'event' && document.status === 'active')
        .sort((left, right) => {
            const leftTime = left.created ?? left.updated
            const rightTime = right.created ?? right.updated
            return leftTime.localeCompare(rightTime)
                || left.id.localeCompare(right.id)
        })
}

export function buildStoryArcView(
    documents: readonly WikiDocument[],
    requestedCheckpointSize: number
): StoryArcView {
    const checkpointSize = Math.max(1, Math.round(requestedCheckpointSize))
    const document = findStoryArcDocument(documents)
    const events = activeEvents(documents)
    const checkpoint = document ? storyArcCheckpoint(document.content) : undefined
    const checkpointIndex = checkpoint
        ? events.findIndex((event) => event.id === checkpoint)
        : -1
    const pendingEventCount = document
        ? checkpointIndex >= 0 ? events.length - checkpointIndex - 1 : 0
        : events.length

    return {
        document,
        checkpointSize,
        pendingEventCount,
        remainingEventCount: Math.max(0, checkpointSize - pendingEventCount),
    }
}

export function extractStoryArcLinks(markdown: string): StoryArcLink[] {
    const seen = new Set<string>()
    const links: StoryArcLink[] = []
    for (const match of markdown.matchAll(wikiLinkPattern)) {
        const target = match[1].trim()
        const label = (match[2] ?? target).trim()
        const key = normalizedTitle(target)
        if (!target || seen.has(key)) continue
        seen.add(key)
        links.push({ target, label: label || target })
    }
    return links
}

export function storyArcDisplayMarkdown(markdown: string): string {
    return markdown
        .replace(checkpointPattern, '')
        .replace(wikiLinkPattern, (_match, target: string, label?: string) =>
            (label ?? target).trim())
        .trim()
}
