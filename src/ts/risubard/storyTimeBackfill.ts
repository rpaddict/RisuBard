import { parseSingleJsonObject } from '../../../packages/risubard-core/src/modelOutput'
import {
    formatStoryTimeLabel,
    groundTemporalHint,
    resolveMemoryRetrievalMetadata,
    type MemoryStoryTime,
    type MemoryTimelineEntry,
} from '../../../server/node/risubard-memory-metadata'
import { memoryWriterDraftSchema, parseTemporalHint } from '../../../server/node/risubard-memory-writer'
import { eventSequences } from '../../../server/node/risubard-event-sequence'

/** An event whose story time is being placed again, with the text it came from. */
export interface StoryTimeBackfillItem {
    id: string
    title: string
    sequence: number
    contentHash: string
    /** The saved event text without its heading. */
    summary: string
    /** Its original chat messages, trimmed. */
    source: string
}

export interface StoryTimeBackfillPlan {
    /** Story times of the events before the first undated one; they anchor the count. */
    prior: MemoryTimelineEntry[]
    previous: { title: string; storyTime: string; summary: string } | null
    batches: StoryTimeBackfillItem[][]
    eventCount: number
    inputTokens: number
}

export interface StoryTimeBackfillResult {
    updated: number
    skipped: number
    failedBatches: number
    counts: Record<MemoryStoryTime['precision'], number>
    firstError?: string
}

interface EventEntry {
    id: string
    type: string
    status?: string
    title: string
    sequence?: number
    created?: string
    updated: string
    contentHash: string
    sourceMessageIds: readonly string[]
    retrievalMetadata?: { storyTime?: MemoryStoryTime }
}

const MAX_EVENTS_PER_REQUEST = 8
const MAX_INPUT_TOKENS_PER_REQUEST = 12_000
const SUMMARY_CHARACTERS = 700
const SOURCE_CHARACTERS = 1_800

export const STORY_TIME_BACKFILL_SYSTEM_PROMPT = [
    'You place saved story events on a story timeline. The events come in story order, each with its saved summary and the original chat text it came from. Return one temporalHint per event, in the same order.',
    '- elapsedDays: story days since the event before it (previousEvent for the first one). 0 when the same scene or day continues without a stated skip, 1 for the next day or a night\'s sleep, the stated number for an explicit skip, null only for a skip whose length the text does not give.',
    '- evidence: a short exact quote from that event\'s source or summary that shows the time; empty only with null.',
    '- timeline: "flashback" only when the event itself is set in the past (a recalled scene played out, a prologue, a backstory chapter), with flashbackAmount and flashbackUnit giving how long before the present scene (null amount when unstated) and elapsedDays null. Recalling the past inside a present scene is "present".',
    '- calendar: the in-story date or time copied exactly as that event\'s source writes it, such as a status line\'s date and time fields; never infer one; otherwise an empty string.',
    'The program counts days from day 0; never compute absolute days. Return exactly one JSON object matching the schema.',
].join('\n')

const trimMiddle = (value: string, limit: number) => {
    const characters = [...value]
    if (characters.length <= limit) return value
    const half = Math.floor(limit / 2)
    return `${characters.slice(0, half).join('')}\n…\n${characters.slice(-half).join('')}`
}

const withoutHeading = (content: string) => content.replace(/^#{1,2}[\t ]+.+$/mu, '').trim()

/** Active events in story order, the ones that keep their time, and the ones placed again. */
export function selectStoryTimeBackfillEvents<T extends EventEntry>(documents: readonly T[]): {
    prior: T[]
    targets: T[]
    sequences: Map<string, number>
} {
    const sequences = eventSequences(documents as unknown as Parameters<typeof eventSequences>[0])
    const events = documents.filter((document) => document.type === 'event'
        && document.status !== 'retracted' && sequences.has(document.id))
        .sort((left, right) => sequences.get(left.id)! - sequences.get(right.id)!)
    // Everything from the first undated event on is placed again; earlier dates are the anchor.
    const first = events.findIndex((document) => !document.retrievalMetadata?.storyTime
        || document.retrievalMetadata.storyTime.precision === 'unknown')
    return first < 0
        ? { prior: events, targets: [], sequences }
        : { prior: events.slice(0, first), targets: events.slice(first), sequences }
}

export function planStoryTimeBackfill(input: {
    prior: readonly (EventEntry & { content?: string })[]
    targets: readonly (EventEntry & { content: string })[]
    sequences: ReadonlyMap<string, number>
    sourceTextFor(messageIds: readonly string[]): string
    countTokens(value: string): number
}): StoryTimeBackfillPlan {
    const items: Array<StoryTimeBackfillItem & { tokens: number }> = input.targets.map((document) => {
        const item = {
            id: document.id,
            title: document.title,
            sequence: input.sequences.get(document.id) ?? 0,
            contentHash: document.contentHash,
            summary: trimMiddle(withoutHeading(document.content), SUMMARY_CHARACTERS),
            source: trimMiddle(input.sourceTextFor(document.sourceMessageIds).trim(), SOURCE_CHARACTERS),
        }
        return { ...item, tokens: input.countTokens(JSON.stringify(item)) }
    })
    const batches: StoryTimeBackfillItem[][] = []
    let current: typeof items = []
    let tokens = 0
    for (const item of items) {
        if (current.length > 0 && (current.length >= MAX_EVENTS_PER_REQUEST
            || tokens + item.tokens > MAX_INPUT_TOKENS_PER_REQUEST)) {
            batches.push(current.map(({ tokens: _tokens, ...rest }) => rest))
            current = []
            tokens = 0
        }
        current.push(item)
        tokens += item.tokens
    }
    if (current.length > 0) batches.push(current.map(({ tokens: _tokens, ...rest }) => rest))
    const last = input.prior.at(-1)
    const previous = last ? {
        title: last.title,
        storyTime: formatStoryTimeLabel(last.retrievalMetadata?.storyTime) || 'unknown',
        summary: trimMiddle(withoutHeading(last.content ?? ''), SUMMARY_CHARACTERS),
    } : null
    const fixedTokens = input.countTokens(STORY_TIME_BACKFILL_SYSTEM_PROMPT) + input.countTokens(JSON.stringify(previous))
    return {
        prior: input.prior.map((document) => document.retrievalMetadata?.storyTime
            ?? { day: null, precision: 'unknown' as const }),
        previous,
        batches,
        eventCount: items.length,
        inputTokens: items.reduce((total, item) => total + item.tokens, 0) + batches.length * fixedTokens,
    }
}

export function buildStoryTimeBackfillRequest(
    batch: readonly StoryTimeBackfillItem[],
    previous: StoryTimeBackfillPlan['previous'],
): { system: string; input: string; schema: string } {
    const hint = JSON.parse(memoryWriterDraftSchema).properties.temporalHint
    return {
        system: STORY_TIME_BACKFILL_SYSTEM_PROMPT,
        input: JSON.stringify({
            previousEvent: previous,
            events: batch.map((item, index) => ({
                position: index + 1, title: item.title, summary: item.summary, source: item.source,
            })),
        }),
        schema: JSON.stringify({
            type: 'object',
            additionalProperties: false,
            required: ['events'],
            properties: {
                events: { type: 'array', minItems: batch.length, maxItems: batch.length, items: hint },
            },
        }),
    }
}

export function parseStoryTimeBackfillResponse(output: string, count: number) {
    const value = parseSingleJsonObject(output) as { events?: unknown }
    if (!Array.isArray(value?.events) || value.events.length !== count) {
        throw new Error(`Expected ${count} story times`)
    }
    return value.events.map((item) => parseTemporalHint(item))
}

/**
 * Places each batch in order and saves it before the next, so the next request sees the
 * newly placed day and a stop keeps what was done. A failed request leaves its events as
 * they were and the count continues past them as a lower bound.
 */
export async function runStoryTimeBackfill(input: {
    plan: StoryTimeBackfillPlan
    request(prompt: { system: string; input: string; schema: string }): Promise<string>
    save(updates: Array<{ documentId: string; expectedContentHash: string; storyTime: MemoryStoryTime }>):
        Promise<{ updated: string[]; skipped: string[] }>
    signal?: AbortSignal
    onProgress?(done: number, total: number): void
}): Promise<StoryTimeBackfillResult> {
    const timeline = [...input.plan.prior]
    let previous = input.plan.previous
    const result: StoryTimeBackfillResult = {
        updated: 0, skipped: 0, failedBatches: 0,
        counts: { origin: 0, explicit: 0, after: 0, flashback: 0, unknown: 0 },
    }
    for (const [index, batch] of input.plan.batches.entries()) {
        input.signal?.throwIfAborted()
        input.onProgress?.(index, input.plan.batches.length)
        let hints: ReturnType<typeof parseStoryTimeBackfillResponse>
        try {
            hints = parseStoryTimeBackfillResponse(
                await input.request(buildStoryTimeBackfillRequest(batch, previous)), batch.length)
        }
        catch (cause) {
            input.signal?.throwIfAborted()
            result.failedBatches += 1
            result.firstError ??= cause instanceof Error ? cause.message.slice(0, 200) : String(cause)
            for (const _item of batch) timeline.push({ day: null, precision: 'unknown' })
            continue
        }
        const updates = batch.map((item, position) => {
            const storyTime = resolveMemoryRetrievalMetadata({
                keywords: [],
                temporalHint: groundTemporalHint(hints[position], `${item.source}\n${item.summary}`),
                priorTimeline: timeline,
            }).storyTime!
            timeline.push(storyTime)
            return { documentId: item.id, expectedContentHash: item.contentHash, storyTime }
        })
        const saved = await input.save(updates)
        const savedIds = new Set(saved.updated)
        for (const update of updates) {
            if (savedIds.has(update.documentId)) result.counts[update.storyTime.precision] += 1
        }
        result.updated += saved.updated.length
        result.skipped += saved.skipped.length
        const last = batch.at(-1)!
        previous = {
            title: last.title,
            storyTime: formatStoryTimeLabel(updates.at(-1)!.storyTime),
            summary: last.summary,
        }
    }
    input.onProgress?.(input.plan.batches.length, input.plan.batches.length)
    return result
}
