import {
    isStoryArcTitle,
    wikiWritingLocales,
    type WikiWritingLanguage,
} from '../../src/ts/risubard/wikiWritingLanguage'
import {
    ARC_PLOTTER_DEFAULT_SETTINGS,
    normalizeArcPlotterSettings,
    type ArcPlotterSettings,
} from '../../src/ts/risubard/arcPlotterSettings'

export const STORY_ARC_CHECKPOINT_SIZE =
    ARC_PLOTTER_DEFAULT_SETTINGS.checkpointSize
export const STORY_ARC_MAX_MARKDOWN_CHARACTERS =
    ARC_PLOTTER_DEFAULT_SETTINGS.maxCharacters
export const STORY_ARC_EVENT_EXCERPT_CHARACTERS = 800

const checkpointPattern = /<!--\s*risubard-story-arc-checkpoint:\s*([A-Za-z0-9._:-]{1,200})\s*-->/gu

export interface StoryArcWriterDocument {
    id: string
    type: 'event' | 'other' | string
    title: string
    content: string
    sourceMessageIds: string[]
    created?: string
    status?: 'active' | 'superseded' | 'retracted'
}

export interface StoryArcUpdatePlan {
    candidate: {
        type: 'other'
        title: string
        aliases: string[]
        reason: string
        action: 'create' | 'update'
        targetDocumentId: string | null
        confidence: number
    }
    events: StoryArcWriterDocument[]
    checkpointEventId: string
}

export { isStoryArcTitle }

export function isStoryArcCandidate(candidate: {
    type: string
    title: string
}): boolean {
    return candidate.type === 'other' && isStoryArcTitle(candidate.title)
}

export function readStoryArcCheckpoint(markdown: string): string | undefined {
    const matches = [...markdown.matchAll(checkpointPattern)]
    return matches.at(-1)?.[1]
}

export function stampStoryArcCheckpoint(
    markdown: string,
    eventId: string
): string {
    if (!/^[A-Za-z0-9._:-]{1,200}$/u.test(eventId)) {
        throw new Error('Story arc checkpoint event ID is invalid')
    }
    const body = markdown.replace(checkpointPattern, '').trimEnd()
    return `${body}\n\n<!-- risubard-story-arc-checkpoint: ${eventId} -->`
}

export function buildStoryArcUpdatePlan(input: {
    documents: readonly StoryArcWriterDocument[]
    savedEvents: readonly StoryArcWriterDocument[]
    writingLanguage: WikiWritingLanguage
    settings?: Partial<ArcPlotterSettings>
}): StoryArcUpdatePlan | undefined {
    const settings = normalizeArcPlotterSettings(input.settings)
    const existing = input.documents.find((document) =>
        document.type === 'other'
        && document.status !== 'retracted'
        && isStoryArcTitle(document.title)
    )
    const ordered = [...input.documents, ...input.savedEvents]
        .filter((document) => document.type === 'event'
            && document.status !== 'retracted'
            && document.status !== 'superseded')
        .filter((document, index, all) =>
            all.findIndex((candidate) => candidate.id === document.id) === index)
        .map((document, index) => ({ document, index }))
        .sort((left, right) => {
            const byCreated = (left.document.created ?? '')
                .localeCompare(right.document.created ?? '')
            return byCreated || left.index - right.index
        })
        .map(({ document }) => document)
    const checkpoint = existing
        ? readStoryArcCheckpoint(existing.content)
        : undefined
    if (existing && !checkpoint) return undefined
    const checkpointIndex = checkpoint
        ? ordered.findIndex((document) => document.id === checkpoint)
        : -1
    if (checkpoint && checkpointIndex < 0) return undefined
    const pending = ordered.slice(checkpointIndex + 1)
    if (pending.length < settings.checkpointSize) return undefined

    const events = pending.slice(0, settings.checkpointSize)
    const title = existing?.title ?? wikiWritingLocales[input.writingLanguage].storyArc.title
    const eventTitles = events.map((event) => `[[${event.title}]]`).join(', ')
    const reason = `Compact the next confirmed event checkpoint into the routing plot: ${eventTitles}`
    return {
        candidate: {
            type: 'other',
            title,
            aliases: [],
            reason: reason.slice(0, 500),
            action: existing ? 'update' : 'create',
            targetDocumentId: existing?.id ?? null,
            confidence: 1,
        },
        events,
        checkpointEventId: events.at(-1)!.id,
    }
}

export function storyArcRewriteInstruction(
    writingLanguage: WikiWritingLanguage,
    value?: Partial<ArcPlotterSettings>
): string {
    const settings = normalizeArcPlotterSettings(value)
    const maxCharacters = settings.maxCharacters.toLocaleString('en-US')
    const arc = wikiWritingLocales[writingLanguage].storyArc
    return [
        `For the reserved other document titled ${arc.title}, use storyArcEvents as the evidence batch.`,
        `It is a compact routing plot, not primary evidence. Keep exactly the useful H3 sections ${arc.overview}, ${arc.turningPoints}, and ${arc.openThreads}.`,
        `Keep at most ${settings.maxArcs} chronological arc bullets, ${settings.maxTurningPoints} turning-point bullets, and ${settings.maxOpenThreads} open-thread bullets. Link representative events as [[event title]].`,
        'Merge older adjacent arcs when over the cap while preserving distinctive names, objects, places, causal transitions, and representative event links.',
        `Keep the complete document within ${maxCharacters} characters. Never reproduce full event summaries or character state histories.`,
    ].join('\n')
}
