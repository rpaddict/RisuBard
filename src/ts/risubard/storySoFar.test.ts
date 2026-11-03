import { describe, expect, it } from 'vitest'
import type { NarrativeMemoryWikiMarkdown } from './memoryWiki'
import { buildStorySoFar } from './storySoFar'
import { wikiWritingLocales } from './wikiWritingLanguage'

type Document = NarrativeMemoryWikiMarkdown['documents'][number]

const event = (overrides: Partial<Document>): Document => ({
    id: 'event.default',
    type: 'event',
    status: 'active',
    title: '기본 사건',
    relativePath: 'events/default.md',
    sourceMessageIds: ['message-1'],
    updated: '2026-08-15T00:00:00.000Z',
    created: '2026-08-15T00:00:00.000Z',
    content: '# 기본 사건\n\n## 이야기 요약\n\n- 기본 사건이 일어났다.',
    links: [],
    contextMode: 'auto',
    contentHash: 'hash',
    ...overrides,
})

describe('story so far projection', () => {
    it('places a late repair back in source order, including grouped turns and missing sources', () => {
        const messages = [
            { chatId: 'shared-user', role: 'user' },
            { chatId: 'a1', role: 'char' },
            { chatId: 'a2', role: 'char' },
            { chatId: 'a3', role: 'char' },
            { chatId: 'a4', role: 'char' },
        ]
        const documents = [
            event({ id: 'last', sourceMessageIds: ['shared-user', 'a4'], created: '2026-01-02' }),
            event({ id: 'repair', sourceMessageIds: ['a3', 'a2'], created: '2026-09-30' }),
            event({ id: 'first', sourceMessageIds: ['a1'], created: '2026-01-01' }),
            event({ id: 'unavailable', sourceMessageIds: ['deleted'], created: '2025-01-01' }),
        ]
        expect(buildStorySoFar(documents, messages).map(entry => entry.id))
            .toEqual(['first', 'repair', 'last', 'unavailable'])
        expect(buildStorySoFar(documents, [...messages].reverse()).map(entry => entry.id))
            .toEqual(['last', 'repair', 'first', 'unavailable'])
        expect(documents.map(document => document.id)).toEqual(['last', 'repair', 'first', 'unavailable'])
    })

    it('does not infer source order from inherited or ambiguous message IDs', () => {
        const documents = [
            event({ id: 'ambiguous', sourceMessageIds: ['user', 'duplicate'], created: '2026-01-03' }),
            event({ id: 'inherited', sourceMessageIds: ['inherited:a1'], created: '2026-01-01' }),
            event({ id: 'known', sourceMessageIds: ['a1'], created: '2026-01-02' }),
        ]
        expect(buildStorySoFar(documents, [
            { chatId: 'user', role: 'user' },
            { chatId: 'duplicate', role: 'char' },
            { chatId: 'a1', role: 'char' },
            { chatId: 'duplicate', role: 'char' },
        ]).map(entry => entry.id)).toEqual(['known', 'inherited', 'ambiguous'])
    })

    it('does not use the remaining user message to guess a deleted response position', () => {
        const documents = [
            event({ id: 'deleted', sourceMessageIds: ['u1', 'deleted-a1'], created: '2026-01-01' }),
            event({ id: 'known', sourceMessageIds: ['a2'], created: '2026-01-02' }),
        ]
        expect(buildStorySoFar(documents, [{ chatId: 'u1', role: 'user' }, { chatId: 'a2', role: 'char' }])
            .map(entry => entry.id)).toEqual(['known', 'deleted'])
    })

    it('reads English summaries alongside legacy Korean without including related links', () => {
        const entries = buildStorySoFar([event({}), event({
            id: 'event.english',
            content: '## Arrival\n\n### Story Summary\n\n- [[Alice]] arrived.\n\n### Related Documents\n\n- [[Station]]',
        })])
        expect(entries.map((entry) => entry.summary)).toEqual([
            ['기본 사건이 일어났다.'], ['Alice arrived.'],
        ])
    })

    it('builds one chronological story from active event summaries only', () => {
        const entries = buildStorySoFar([
            event({
                id: 'event.later', title: '역 도착',
                created: '2026-08-15T02:00:00.000Z',
                content: '# 역 도착\n\n## 이야기 요약\n\n- 폐쇄된 역에 도착했다.\n\n## 상태 변화\n\n- 무시한다.',
            }),
            event({
                id: 'event.earlier', title: '출발',
                created: '2026-08-15T01:00:00.000Z',
                content: '# 출발\n\n## 확정된 사건\n\n- 도시를 떠났다.',
            }),
            event({ id: 'event.old', status: 'superseded' }),
            event({ id: 'character.no', type: 'character' }),
        ])

        expect(entries.map((entry) => entry.title)).toEqual(['출발', '역 도착'])
        expect(entries.map((entry) => entry.summary)).toEqual([
            ['도시를 떠났다.'],
            ['폐쇄된 역에 도착했다.'],
        ])
    })

    it('uses message IDs for chat navigation', () => {
        expect(buildStorySoFar([event({
            sourceMessageIds: ['user-1', 'assistant-1'],
        })])[0].source).toEqual({
            kind: 'chat',
            messageIds: ['user-1', 'assistant-1'],
        })
    })

    it('reads summaries after the wiki loader normalizes legacy headings', () => {
        const entries = buildStorySoFar([event({
            content: '## 기본 사건\n\n### 이야기 요약\n\n- 남아 있던 사건을 표시한다.\n\n### 관련 문서\n\n- 무시한다.',
        })])

        expect(entries[0]?.summary).toEqual(['남아 있던 사건을 표시한다.'])
    })

    it.each(Object.entries(wikiWritingLocales))(
        'reads the %s summary heading written by the wiki writer', (_locale, definition) => {
            const entries = buildStorySoFar([event({
                content: `## 到着\n\n### ${definition.headings.summary}\n\n- 駅に到着した。`,
            })])

            expect(entries[0]?.summary).toEqual(['駅に到着した。'])
        }
    )

    it('labels each event with its story day and written date', () => {
        const entries = buildStorySoFar([
            event({ id: 'dated', retrievalMetadata: { keywords: [], storyTime: {
                day: 2, evidence: '다음 날', precision: 'explicit', calendar: '7월 넷째 주 월요일',
            } } }),
            event({ id: 'plain', created: '2026-08-16T00:00:00.000Z' }),
        ])
        expect(entries.map((entry) => entry.time)).toEqual(['+2일, 7월 넷째 주 월요일', ''])
    })
})
