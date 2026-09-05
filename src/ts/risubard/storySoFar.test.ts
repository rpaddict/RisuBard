import { describe, expect, it } from 'vitest'
import type { NarrativeMemoryWikiMarkdown } from './memoryWiki'
import { buildStorySoFar } from './storySoFar'

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

    it('reads Japanese summaries without including related links', () => {
        const entries = buildStorySoFar([event({
            content: '## 催眠発動\n\n### 物語要約\n\n- [[リサ]]は変化した。\n\n### 関連文書\n\n- [[高山小太郎]]',
        })])

        expect(entries[0]?.summary).toEqual(['リサは変化した。'])
    })

})
