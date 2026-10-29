import {
    isStoryArcChapterTitle,
    isStoryArcTitle,
    wikiWritingLocales,
    type WikiWritingLanguage,
} from '../../src/ts/risubard/wikiWritingLanguage'
import { createEventOrder, hasOnlyInheritedSources, type EventOrderMessage } from '../../src/ts/risubard/eventOrder'
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
const wikiLinkPattern = /\[\[([^\]\r\n]{1,240})\]\]/gu

export interface StoryArcWriterDocument {
    id: string
    type: 'event' | 'other' | string
    title: string
    aliases?: readonly string[]
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
    /** The stored checkpoint was missing, so the plan resumed after the last linked event. */
    checkpointRecovered?: boolean
}

export { isStoryArcChapterTitle, isStoryArcTitle }

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

const identityKey = (value: string) => value.normalize('NFKC').toLocaleLowerCase().trim()

/** A title containing a link delimiter cannot be written as [[title]]. */
function linkableEventTitle(title: string): boolean {
    return title.length > 0 && title.length <= 240 && !/[\]\r\n]/u.test(title)
}

function hasStoryArcEventLink(
    markdown: string,
    events: readonly StoryArcWriterDocument[]
): boolean {
    const identities = new Set(events.flatMap((event) =>
        [event.title, ...(event.aliases ?? [])].map(identityKey)
    ))
    // Titles may themselves contain "|" or "#": accept the whole target too.
    return [...markdown.matchAll(wikiLinkPattern)].some((match) => [
        match[1],
        match[1].split('|')[0] ?? '',
        match[1].split('|')[0]?.split('#')[0] ?? '',
    ].some((target) => identities.has(identityKey(target))))
}

export function validateStoryArcCheckpointEventLink(
    markdown: string,
    events: readonly StoryArcWriterDocument[]
): void {
    if (!hasStoryArcEventLink(ensureStoryArcEventLink(markdown, events), events)
        && events.some((event) => linkableEventTitle(event.title))) {
        throw new Error(
            'Story arc plot must link at least one event from the current checkpoint'
        )
    }
}

/**
 * The checkpoint must route to at least one of its events. When the model
 * omits that link, the program adds the latest event under turning points
 * instead of rejecting an otherwise valid rewrite.
 */
export function ensureStoryArcEventLink(
    markdown: string,
    events: readonly StoryArcWriterDocument[]
): string {
    if (hasStoryArcEventLink(markdown, events)) return markdown
    const event = [...events].reverse().find((candidate) => linkableEventTitle(candidate.title))
    if (!event) return markdown
    const bullet = `- [[${event.title}]]`
    const turningPoints = new Set(Object.values(wikiWritingLocales)
        .map((locale) => identityKey(locale.storyArc.turningPoints)))
    const lines = markdown.split('\n')
    const start = lines.findIndex((line) => {
        const heading = line.match(/^#{3,6}[\t ]+(.+?)[\t ]*$/u)
        return heading !== null && turningPoints.has(identityKey(heading[1]))
    })
    if (start < 0) return `${markdown.trimEnd()}\n\n${bullet}\n`
    let end = start + 1
    while (end < lines.length && !/^#{1,6}[\t ]/u.test(lines[end])) end += 1
    while (end > start + 1 && lines[end - 1].trim() === '') end -= 1
    lines.splice(end, 0, bullet)
    return lines.join('\n')
}

export function buildStoryArcUpdatePlan(input: {
    documents: readonly StoryArcWriterDocument[]
    savedEvents: readonly StoryArcWriterDocument[]
    writingLanguage: WikiWritingLanguage
    settings?: Partial<ArcPlotterSettings>
    sourceMessageOrder?: readonly EventOrderMessage[]
}): StoryArcUpdatePlan | undefined {
    const sourceOrder = createEventOrder(input.sourceMessageOrder)
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
        .filter(document => input.sourceMessageOrder === undefined
            || sourceOrder.position(document) !== undefined)
        .map((document, index) => ({ document, index }))
        .sort((left, right) => {
            if (input.sourceMessageOrder !== undefined) {
                return sourceOrder.compare(left.document, right.document)
            }
            const byCreated = (left.document.created ?? '')
                .localeCompare(right.document.created ?? '')
            return byCreated || left.index - right.index
        })
        .map(({ document }) => document)
    const checkpoint = existing
        ? readStoryArcCheckpoint(existing.content)
        : undefined
    const checkpointIndex = checkpoint
        ? ordered.findIndex((document) => document.id === checkpoint)
        : -1
    // A fork keeps its predecessor's checkpoint ID but detaches its sources.
    // That checkpoint is before all current-chat events, not a deleted local turn.
    const inheritedCheckpoint = input.sourceMessageOrder !== undefined
        && input.documents.some(document => document.id === checkpoint
            && document.type === 'event'
            && document.status !== 'retracted' && document.status !== 'superseded'
            && hasOnlyInheritedSources(document))
    // A checkpoint whose event was deleted, or a marker removed by an edit,
    // must not stop the plot for good: resume after the last event it links,
    // or from now when it links none.
    const checkpointRecovered = existing !== undefined
        && (!checkpoint || (checkpointIndex < 0 && !inheritedCheckpoint))
    const resumeIndex = checkpointRecovered
        ? lastLinkedEventIndex(existing.content, ordered) ?? ordered.length - 1
        : checkpointIndex
    const pending = ordered.slice(resumeIndex + 1)
    const repairEvents = !checkpointRecovered && existing && checkpoint
        && checkpointIndex >= 0
        && !hasStoryArcEventLink(existing.content, ordered)
        ? ordered.slice(
            Math.max(0, checkpointIndex - settings.checkpointSize + 1),
            checkpointIndex + 1
        )
        : undefined
    if (!repairEvents && pending.length < settings.checkpointSize) {
        return undefined
    }

    // A batch analysis saves several events at once; take as many whole
    // checkpoints as it added so the plot never falls further behind.
    const checkpoints = Math.min(
        Math.floor(pending.length / settings.checkpointSize),
        Math.max(1, Math.ceil(input.savedEvents.length / settings.checkpointSize)),
    )
    const events = repairEvents ?? pending.slice(0, settings.checkpointSize * checkpoints)
    const title = existing?.title ?? wikiWritingLocales[input.writingLanguage].storyArc.title
    const eventTitles = events.map((event) => `[[${event.title}]]`).join(', ')
    const reason = repairEvents
        ? `Repair missing event routes in the current story arc checkpoint: ${eventTitles}`
        : `Compact the next confirmed event checkpoint into the routing plot: ${eventTitles}`
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
        checkpointEventId: repairEvents ? checkpoint! : events.at(-1)!.id,
        ...(checkpointRecovered ? { checkpointRecovered } : {}),
    }
}

function lastLinkedEventIndex(markdown: string, ordered: readonly StoryArcWriterDocument[]): number | undefined {
    const linked = new Set([...markdown.matchAll(wikiLinkPattern)]
        .map((match) => identityKey(match[1].split('|')[0]?.split('#')[0] ?? '')))
    for (let index = ordered.length - 1; index >= 0; index -= 1) {
        const event = ordered[index]
        if ([event.title, ...(event.aliases ?? [])].some((name) => linked.has(identityKey(name)))) return index
    }
    return undefined
}

/** Every way a [[target|label]] or [[target#part]] link may name a document. */
function linkTargetKeys(markdown: string): Set<string> {
    return new Set([...markdown.matchAll(wikiLinkPattern)].flatMap((match) => [
        match[1],
        match[1].split('|')[0] ?? '',
        match[1].split('|')[0]?.split('#')[0] ?? '',
    ].map(identityKey)))
}

function storyArcOverviewRange(lines: readonly string[]): { start: number; end: number } | undefined {
    const keys = new Set(Object.values(wikiWritingLocales).map((locale) => identityKey(locale.storyArc.overview)))
    const start = lines.findIndex((line) => {
        const heading = /^#{3,6}[\t ]+(.+?)[\t ]*$/u.exec(line)
        return heading !== null && keys.has(identityKey(heading[1]))
    })
    if (start < 0) return undefined
    let end = start + 1
    while (end < lines.length && !/^#{1,6}[\t ]/u.test(lines[end])) end += 1
    return { start, end }
}

/**
 * A rewrite may merge old arcs, but an arc bullet whose event links all
 * vanished was dropped. Put it back as written, before the surviving arcs.
 */
export function restoreDroppedStoryArcs(
    previous: string,
    rewritten: string,
    writingLanguage: WikiWritingLanguage
): { markdown: string; restored: string[] } {
    const previousLines = previous.split('\n')
    const previousRange = storyArcOverviewRange(previousLines)
    if (!previousRange) return { markdown: rewritten, restored: [] }
    const kept = linkTargetKeys(rewritten)
    const restored = previousLines.slice(previousRange.start + 1, previousRange.end).filter((line) => {
        if (!/^[-*][\t ]/u.test(line)) return false
        const links = linkTargetKeys(line)
        return links.size > 0 && ![...links].some((key) => kept.has(key))
    })
    if (restored.length === 0) return { markdown: rewritten, restored }
    const lines = rewritten.split('\n')
    const range = storyArcOverviewRange(lines)
    if (range) {
        let at = range.start + 1
        while (at < range.end && lines[at].trim() === '') at += 1
        lines.splice(at, 0, ...restored)
        if (at === range.start + 1) lines.splice(at, 0, '')
        return { markdown: lines.join('\n'), restored }
    }
    const section = [`### ${wikiWritingLocales[writingLanguage].storyArc.overview}`, '', ...restored]
    const title = lines.findIndex((line) => /^#{1,2}[\t ]+\S/u.test(line))
    lines.splice(title + 1, 0, ...(title < 0 ? [...section, ''] : ['', ...section]))
    return { markdown: lines.join('\n'), restored }
}

/** Title of a closed arc chapter that keeps its arcs out of later rewrites. */
export function storyArcChapterTitle(title: string, chapter: number): string {
    return `${title} (${chapter})`
}

/**
 * When the live plot is full, its arcs move to a closed chapter document and
 * the live plot restarts from a link to it, keeping the open threads. Closed
 * chapters are never summarized again.
 */
export function planStoryArcChapter(input: {
    markdown: string
    title: string
    chapterTitle: string
    writingLanguage: WikiWritingLanguage
    settings?: Partial<ArcPlotterSettings>
}): { chapterMarkdown: string; liveMarkdown: string } | undefined {
    const settings = normalizeArcPlotterSettings(input.settings)
    const arc = wikiWritingLocales[input.writingLanguage].storyArc
    const overviewHeadings = Object.values(wikiWritingLocales).map((locale) => locale.storyArc.overview)
    const openHeadings = Object.values(wikiWritingLocales).map((locale) => locale.storyArc.openThreads)
    const unmarked = input.markdown.replace(checkpointPattern, '')
    const sectionUnits = (headings: string[]) => {
        const lines = unmarked.split('\n')
        const keys = new Set(headings.map(identityKey))
        const start = lines.findIndex((line) => {
            const heading = /^#{3,6}[\t ]+(.+?)[\t ]*$/u.exec(line)
            return heading !== null && keys.has(identityKey(heading[1]))
        })
        if (start < 0) return { start, body: [] as string[] }
        let end = start + 1
        while (end < lines.length && !/^#{1,3}[\t ]/u.test(lines[end])) end += 1
        return { start, body: lines.slice(start + 1, end).filter((line) => line.trim()) }
    }
    const overview = sectionUnits(overviewHeadings)
    if (overview.body.filter((line) => /^[-*][\t ]/u.test(line)).length < settings.maxArcs) return undefined
    const body = input.markdown.replace(checkpointPattern, '').replace(/^#{1,2}[\t ]+.+$/mu, '').trim()
    const openThreads = sectionUnits(openHeadings).body
    return {
        chapterMarkdown: `## ${input.chapterTitle}\n\n${body}`,
        liveMarkdown: [
            `## ${input.title}`, '',
            `### ${arc.overview}`, '', `- [[${input.chapterTitle}]]`,
            ...(openThreads.length > 0 ? ['', `### ${arc.openThreads}`, '', ...openThreads] : []),
        ].join('\n'),
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
        'Every rewrite must link at least one event from the current storyArcEvents checkpoint.',
        'Merge older adjacent arcs when over the cap while preserving distinctive names, objects, places, causal transitions, and representative event links.',
        `Keep the complete document within ${maxCharacters} characters. Never reproduce full event summaries or character state histories.`,
    ].join('\n')
}
