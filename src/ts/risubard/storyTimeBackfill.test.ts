import { describe, expect, it, vi } from 'vitest'
import {
    planStoryTimeBackfill,
    runStoryTimeBackfill,
    selectStoryTimeBackfillEvents,
} from './storyTimeBackfill'

const hint = (overrides: Record<string, unknown> = {}) => ({
    elapsedDays: 0, evidence: '', timeline: 'present', flashbackAmount: null, flashbackUnit: 'day', calendar: '',
    ...overrides,
})

const event = (sequence: number, storyTime?: Record<string, unknown>) => ({
    id: `event.${sequence}`,
    type: 'event',
    status: 'active',
    title: `사건 ${sequence}`,
    sequence,
    updated: '2026-11-01T00:00:00.000Z',
    contentHash: `hash-${sequence}`,
    sourceMessageIds: [`m${sequence}`],
    content: `## 사건 ${sequence}\n\n사건 ${sequence}의 본문.`,
    ...(storyTime ? { retrievalMetadata: { keywords: [], storyTime } } : {}),
}) as never

const sources: Record<string, string> = {
    m3: '다음 날 아침, 학교로 간다.',
    m4: '[STATUS|날짜: 7월 넷째 주 화요일|시간: 오전 9시]\n교실에 들어섰다.',
    m5: '이백 년 전, 전쟁이 있었다.',
}

function plan(events: never[], countTokens = (value: string) => value.length) {
    const { prior, targets, sequences } = selectStoryTimeBackfillEvents(events)
    return planStoryTimeBackfill({
        prior, targets: targets as never, sequences, countTokens,
        sourceTextFor: (ids) => ids.map((id) => sources[id] ?? '').join('\n'),
    })
}

describe('story time backfill', () => {
    it('keeps dated events as the anchor and places everything from the first undated event', () => {
        const { prior, targets } = selectStoryTimeBackfillEvents([
            event(3, { day: null, evidence: 'x', precision: 'unknown' }),
            event(1, { day: 0, evidence: 'x', precision: 'origin' }),
            event(2, { day: 1, evidence: 'x', precision: 'explicit' }),
            event(4),
        ] as never[])
        expect(prior.map((item: { id: string }) => item.id)).toEqual(['event.1', 'event.2'])
        expect(targets.map((item: { id: string }) => item.id)).toEqual(['event.3', 'event.4'])
        expect(selectStoryTimeBackfillEvents([event(1, { day: 0, evidence: 'x', precision: 'origin' })] as never[]).targets)
            .toEqual([])
    })

    it('batches by count and token size and estimates the input', () => {
        const events = [event(1, { day: 0, evidence: 'x', precision: 'origin' }),
            ...Array.from({ length: 10 }, (_, index) => event(index + 2))]
        const result = plan(events as never[])
        expect(result.eventCount).toBe(10)
        expect(result.batches.map((batch) => batch.length)).toEqual([8, 2])
        expect(result.previous).toMatchObject({ title: '사건 1', storyTime: '0일 (시작)' })
        expect(result.inputTokens).toBeGreaterThan(0)
        expect(plan(events as never[], () => 7_000).batches.map((batch) => batch.length)).toEqual(Array(10).fill(1))
    })

    it('places each batch in order on the saved anchor, grounds quotes and dates, and saves batch by batch', async () => {
        const events = [
            event(1, { day: 0, evidence: 'x', precision: 'origin' }),
            event(2, { day: 1, evidence: 'x', precision: 'explicit' }),
            event(3), event(4), event(5),
        ]
        const backfill = plan(events as never[])
        backfill.batches = [[backfill.batches[0][0]], backfill.batches[0].slice(1)]
        const request = vi.fn()
            .mockResolvedValueOnce(JSON.stringify({ events: [hint({ elapsedDays: 1, evidence: '다음 날 아침' })] }))
            .mockResolvedValueOnce(JSON.stringify({ events: [
                hint({ elapsedDays: 0, evidence: '교실에 들어섰다', calendar: '7월 넷째 주 화요일 오전 9시' }),
                hint({ elapsedDays: null, evidence: '이백 년 전', timeline: 'flashback', flashbackAmount: 200, flashbackUnit: 'year', calendar: '8월 1일' }),
            ] }))
        const save = vi.fn(async (updates: Array<{ documentId: string }>) => ({
            updated: updates.map((update) => update.documentId), skipped: [],
        }))
        const result = await runStoryTimeBackfill({ plan: backfill, request, save })
        expect(save.mock.calls.flatMap(([updates]) => updates)).toEqual([
            { documentId: 'event.3', expectedContentHash: 'hash-3', storyTime: { day: 2, evidence: '다음 날 아침', precision: 'explicit' } },
            { documentId: 'event.4', expectedContentHash: 'hash-4', storyTime: {
                day: 2, evidence: '교실에 들어섰다', precision: 'explicit', calendar: '7월 넷째 주 화요일 오전 9시',
            } },
            // The invented date is dropped; the flashback never moves the present day.
            { documentId: 'event.5', expectedContentHash: 'hash-5', storyTime: {
                day: null, evidence: '이백 년 전', precision: 'flashback', offset: { amount: -200, unit: 'year' },
            } },
        ])
        // The second request starts from the day the first one placed.
        expect(JSON.parse(request.mock.calls[1][0].input).previousEvent).toMatchObject({ title: '사건 3', storyTime: '+2일' })
        expect(result).toMatchObject({ updated: 3, failedBatches: 0, counts: { explicit: 2, flashback: 1 } })
    })

    it('leaves a failed batch as it was and counts on past it as a lower bound', async () => {
        const events = [event(1, { day: 0, evidence: 'x', precision: 'origin' }), event(2), event(3)]
        const backfill = plan(events as never[])
        backfill.batches = [[backfill.batches[0][0]], [backfill.batches[0][1]]]
        const request = vi.fn()
            .mockResolvedValueOnce('not json')
            .mockResolvedValueOnce(JSON.stringify({ events: [hint({ elapsedDays: 1, evidence: '다음 날 아침' })] }))
        const save = vi.fn(async (updates: Array<{ documentId: string }>) => ({
            updated: updates.map((update) => update.documentId), skipped: [],
        }))
        sources.m3 = '다음 날 아침, 학교로 간다.'
        const result = await runStoryTimeBackfill({ plan: backfill, request, save })
        expect(result.failedBatches).toBe(1)
        expect(save).toHaveBeenCalledTimes(1)
        expect(save.mock.calls[0][0][0]).toMatchObject({ documentId: 'event.3', storyTime: { day: 1, precision: 'after' } })
    })

    it('stops before the next request when aborted', async () => {
        const backfill = plan([event(1), event(2)] as never[])
        const controller = new AbortController()
        controller.abort()
        await expect(runStoryTimeBackfill({
            plan: backfill, request: vi.fn(), save: vi.fn(), signal: controller.signal,
        })).rejects.toThrow()
    })
})
