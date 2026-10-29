import { describe, expect, test } from 'vitest'
import {
    STORY_ARC_CHECKPOINT_SIZE,
    buildStoryArcUpdatePlan,
    ensureStoryArcEventLink,
    isStoryArcTitle,
    readStoryArcCheckpoint,
    restoreDroppedStoryArcs,
    stampStoryArcCheckpoint,
    storyArcRewriteInstruction,
    validateStoryArcCheckpointEventLink,
} from './risubard-story-arc-writer'
import { wikiWritingLocales } from '../../src/ts/risubard/wikiWritingLanguage'

const event = (index: number) => ({
    id: `event.${index}`,
    type: 'event' as const,
    title: `사건 ${index}`,
    content: `## 사건 ${index}\n\n### 이야기 요약\n\n- ${index}번째 사건`,
    sourceMessageIds: [`assistant-${index}`],
    created: `2026-08-30T00:00:${String(index).padStart(2, '0')}.000Z`,
})

describe('story arc writer', () => {
    test('accepts checkpoint links to titles containing link delimiters or aliases', () => {
        const delimited = { ...event(1), title: '#3 결투 | 북문' }
        expect(() => validateStoryArcCheckpointEventLink('- [[#3 결투 | 북문]]', [delimited])).not.toThrow()
        const aliased = { ...event(2), aliases: ['북문 결투'] }
        expect(ensureStoryArcEventLink('- [[북문 결투]]', [aliased])).toBe('- [[북문 결투]]')
    })

    test('adds a missing checkpoint link under turning points instead of rejecting the rewrite', () => {
        const arc = wikiWritingLocales.ko.storyArc
        const markdown = `## ${arc.title}

### ${arc.overview}
- 개요

### ${arc.turningPoints}
- 기존 전환점

### ${arc.openThreads}
- 미해결`
        const linked = ensureStoryArcEventLink(markdown, [event(4), event(5)])
        expect(linked).toContain(`### ${arc.turningPoints}
- 기존 전환점
- [[사건 5]]

### ${arc.openThreads}`)
        expect(() => validateStoryArcCheckpointEventLink(markdown, [event(5)])).not.toThrow()
        // Titles that cannot be written as a link are not enforced.
        expect(() => validateStoryArcCheckpointEventLink('본문', [{ ...event(6), title: '괄호] 사건' }])).not.toThrow()
    })

    test('continues a forked arc after its inherited checkpoint without guessing deleted checkpoints', () => {
        const inherited = { ...event(1), sourceMessageIds: ['inherited:parent:a1'] }
        const arc = { id: 'other.arc', type: 'other', title: 'Story Arc Map', sourceMessageIds: [],
            content: stampStoryArcCheckpoint('## Story Arc Map\n\n[[사건 1]]', 'event.1') }
        const input = { documents: [inherited, arc, event(2), event(3)], savedEvents: [],
            writingLanguage: 'en' as const, settings: { checkpointSize: 2 },
            sourceMessageOrder: [2, 3].map(index => ({ chatId: `assistant-${index}`, role: 'char' })) }
        const plan = buildStoryArcUpdatePlan(input)
        expect(plan?.events.map(event => event.id)).toEqual(['event.2', 'event.3'])
        expect(plan?.checkpointEventId).toBe('event.3')
        expect(buildStoryArcUpdatePlan({ ...input,
            documents: [{ ...inherited, sourceMessageIds: ['deleted'] }, arc, event(2), event(3)],
        })).toBeUndefined()
    })

    test('a batch that saves several events advances as many whole checkpoints as it added', () => {
        const arc = { id: 'other.arc', type: 'other', title: 'Story Arc Map', sourceMessageIds: [],
            content: stampStoryArcCheckpoint('## Story Arc Map\n\n[[사건 1]]', 'event.1') }
        const saved = [2, 3, 4, 5].map(event)
        const plan = (savedEvents: ReturnType<typeof event>[], checkpointSize: number) => buildStoryArcUpdatePlan({
            documents: [event(1), arc], savedEvents, writingLanguage: 'en', settings: { checkpointSize },
        })
        expect(plan(saved, 1)?.events.map((item) => item.id)).toEqual(['event.2', 'event.3', 'event.4', 'event.5'])
        expect(plan(saved, 1)?.checkpointEventId).toBe('event.5')
        expect(plan(saved, 3)?.events.map((item) => item.id)).toEqual(['event.2', 'event.3', 'event.4'])
        expect(plan(saved.slice(0, 1), 1)?.events.map((item) => item.id)).toEqual(['event.2'])
    })

    test('groups events by source turns and does not treat a late repair as a new checkpoint', () => {
        const sourceMessageOrder = Array.from({ length: 8 }, (_, index) => ({
            chatId: `assistant-${index + 1}`, role: 'char',
        }))
        const documents = Array.from({ length: 8 }, (_, index) => ({
            ...event(index + 1),
            ...(index === 1 ? { created: '2026-09-30' } : {}),
        }))
        const plan = buildStoryArcUpdatePlan({ documents, savedEvents: [],
            writingLanguage: 'en', sourceMessageOrder })
        expect(plan?.events.map(event => event.id))
            .toEqual(documents.map(event => event.id))
        expect(plan?.checkpointEventId).toBe('event.8')
        expect(buildStoryArcUpdatePlan({
            documents: [...documents, {
                id: 'other.arc', type: 'other', title: 'Story Arc Map', sourceMessageIds: [],
                content: stampStoryArcCheckpoint('## Story Arc Map\n\n[[사건 8]]', 'event.8'),
            }], savedEvents: [], writingLanguage: 'en', sourceMessageOrder,
            settings: { checkpointSize: 1 },
        })).toBeUndefined()
    })

    test('waits for a bounded event checkpoint before creating the plot', () => {
        expect(buildStoryArcUpdatePlan({
            documents: Array.from(
                { length: STORY_ARC_CHECKPOINT_SIZE - 1 },
                (_, index) => event(index + 1)
            ),
            savedEvents: [],
            writingLanguage: 'ko',
        })).toBeUndefined()

        const plan = buildStoryArcUpdatePlan({
            documents: Array.from(
                { length: STORY_ARC_CHECKPOINT_SIZE },
                (_, index) => event(index + 1)
            ),
            savedEvents: [],
            writingLanguage: 'ko',
        })

        expect(plan).toMatchObject({
            checkpointEventId: `event.${STORY_ARC_CHECKPOINT_SIZE}`,
            candidate: {
                type: 'other',
                title: '스토리 아크 플롯',
                action: 'create',
                targetDocumentId: null,
            },
        })
        expect(plan?.events).toHaveLength(STORY_ARC_CHECKPOINT_SIZE)
    })

    test('uses configured checkpoint and prompt limits', () => {
        const settings = {
            checkpointSize: 4,
            maxArcs: 5,
            maxTurningPoints: 9,
            maxOpenThreads: 3,
            maxCharacters: 4_500,
        }
        const plan = buildStoryArcUpdatePlan({
            documents: Array.from({ length: 4 }, (_, index) => event(index + 1)),
            savedEvents: [],
            writingLanguage: 'ko',
            settings,
        })

        expect(plan?.events).toHaveLength(4)
        expect(storyArcRewriteInstruction('ko', settings)).toContain(
            'at most 5 chronological arc bullets, 9 turning-point bullets, and 3 open-thread bullets'
        )
        expect(storyArcRewriteInstruction('ko', settings)).toContain('4,500 characters')
    })

    test('continues from the program checkpoint and updates one reserved map', () => {
        const existing = {
            id: 'other.story-arc-map',
            type: 'other' as const,
            title: 'Story Arc Map',
            content: stampStoryArcCheckpoint(
                '## Story Arc Map\n\n### Arc Overview\n\n- The road begins at [[사건 8]].',
                'event.8'
            ),
            sourceMessageIds: [],
        }
        const plan = buildStoryArcUpdatePlan({
            documents: [
                existing,
                ...Array.from({ length: 16 }, (_, index) => event(index + 1)),
            ],
            savedEvents: [],
            writingLanguage: 'en',
        })

        expect(plan).toMatchObject({
            checkpointEventId: 'event.16',
            candidate: {
                title: 'Story Arc Map',
                action: 'update',
                targetDocumentId: 'other.story-arc-map',
            },
        })
        expect(plan?.events.map((item) => item.id)).toEqual(
            Array.from({ length: 8 }, (_, index) => `event.${index + 9}`)
        )
        expect(readStoryArcCheckpoint(existing.content)).toBe('event.8')
    })

    test('repairs a checkpoint plot that has no event links', () => {
        const existing = {
            id: 'other.story-arc-plot',
            type: 'other' as const,
            title: '스토리 아크 플롯',
            content: stampStoryArcCheckpoint(
                '## 스토리 아크 플롯\n\n### 아크 개요\n\n- 관문까지 여정이 이어졌다.',
                'event.8'
            ),
            sourceMessageIds: [],
        }
        const plan = buildStoryArcUpdatePlan({
            documents: [
                existing,
                ...Array.from({ length: 9 }, (_, index) => event(index + 1)),
            ],
            savedEvents: [],
            writingLanguage: 'ko',
        })

        expect(plan).toMatchObject({
            checkpointEventId: 'event.8',
            candidate: {
                action: 'update',
                targetDocumentId: 'other.story-arc-plot',
            },
        })
        expect(plan?.events.map((item) => item.id)).toEqual(
            Array.from({ length: 8 }, (_, index) => `event.${index + 1}`)
        )
    })

    test('replaces a stale checkpoint marker without changing the body', () => {
        const first = stampStoryArcCheckpoint('## 스토리 아크 지도', 'event.8')
        const second = stampStoryArcCheckpoint(first, 'event.16')

        expect(second.match(/risubard-story-arc-checkpoint/g)).toHaveLength(1)
        expect(second).toContain('## 스토리 아크 지도')
        expect(readStoryArcCheckpoint(second)).toBe('event.16')
    })

    test('does not replay old events when an existing map has no checkpoint', () => {
        expect(buildStoryArcUpdatePlan({
            documents: [{
                id: 'other.manual-map',
                type: 'other',
                title: '스토리 아크 지도',
                content: '## 스토리 아크 지도\n\n### 아크 개요\n\n- 수동 기록',
                sourceMessageIds: [],
            }, ...Array.from({ length: 8 }, (_, index) => event(index + 1))],
            savedEvents: [],
            writingLanguage: 'ko',
        })).toBeUndefined()
    })

    test('recognizes the new plot titles and legacy map titles', () => {
        expect(isStoryArcTitle('스토리 아크 플롯')).toBe(true)
        expect(isStoryArcTitle('Story Arc Plot')).toBe(true)
        expect(isStoryArcTitle('스토리 아크 지도')).toBe(true)
        expect(isStoryArcTitle('Story Arc Map')).toBe(true)
    })

    test.each([
        ['ja', 'ストーリーアークプロット', 'アーク概要'],
        ['zh-Hans', '故事篇章情节', '篇章概览'],
        ['zh-Hant', '故事篇章情節', '篇章概覽'],
    ] as const)('uses locale data for the %s story arc', (locale, title, overview) => {
        const plan = buildStoryArcUpdatePlan({
            documents: Array.from(
                { length: STORY_ARC_CHECKPOINT_SIZE },
                (_, index) => event(index + 1)
            ),
            savedEvents: [],
            writingLanguage: locale,
        })
        expect(plan?.candidate.title).toBe(title)
        expect(storyArcRewriteInstruction(locale)).toContain(overview)
        expect(isStoryArcTitle(title)).toBe(true)
    })

    test('restores an arc whose event links all vanished, but not a merged one', () => {
        const previous = ['## 스토리 아크 플롯', '', '### 아크 개요', '',
            '- 첫 만남과 꽃다발. [[사건 1]] [[사건 2]]',
            '- 예나 수리. [[사건 3|수리]]',
            '- 투영. [[사건 4]]', '', '### 주요 전환점', '', '- [[사건 4]]'].join('\n')
        const rewritten = ['## 스토리 아크 플롯', '', '### 아크 개요', '',
            '- 예나 수리와 투영. [[사건 3]] [[사건 4]]',
            '- 출발. [[사건 5]]', '', '### 주요 전환점', '', '- [[사건 5]]'].join('\n')
        const { markdown, restored } = restoreDroppedStoryArcs(previous, rewritten, 'ko')
        expect(restored).toEqual(['- 첫 만남과 꽃다발. [[사건 1]] [[사건 2]]'])
        expect(markdown.split('\n').slice(2, 7)).toEqual(['### 아크 개요', '',
            '- 첫 만남과 꽃다발. [[사건 1]] [[사건 2]]',
            '- 예나 수리와 투영. [[사건 3]] [[사건 4]]', '- 출발. [[사건 5]]'])
        expect(restoreDroppedStoryArcs(previous, previous, 'ko').restored).toEqual([])
    })

    test('restores dropped arcs into a rewrite that lost its overview heading', () => {
        const previous = '## 스토리 아크 플롯\n\n### 아크 개요\n\n- 첫 장. [[사건 1]]'
        const { markdown } = restoreDroppedStoryArcs(previous, '## 스토리 아크 플롯\n\n### 주요 전환점\n\n- [[사건 2]]', 'ko')
        expect(markdown).toBe('## 스토리 아크 플롯\n\n### 아크 개요\n\n- 첫 장. [[사건 1]]\n\n### 주요 전환점\n\n- [[사건 2]]')
    })
})
