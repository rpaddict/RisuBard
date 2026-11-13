import { describe, expect, test } from 'vitest'
import type { MarkdownWikiDocument } from './risubard-markdown-wiki'
import { buildCharacterLedgers, eventLedgerChanges, parseLedgerLine } from './risubard-change-ledger'
import { inquireMarkdownDocuments } from './risubard-markdown-inquiry'
import { parseMemoryWriterDraft, serializeMemoryWriterDraft } from './risubard-memory-writer'

function document(
    input: Partial<MarkdownWikiDocument> & Pick<MarkdownWikiDocument, 'id' | 'type' | 'title' | 'content'>
): MarkdownWikiDocument {
    return {
        status: 'active',
        aliases: [],
        sourceMessageIds: [],
        updated: '2026-11-12T00:00:00.000Z',
        links: [],
        contextMode: 'auto',
        contentHash: `hash-${input.id}`,
        relativePath: `${input.type === 'event' ? 'events' : 'characters'}/${input.id}.md`,
        ...input,
    }
}

const draftJson = (stateChanges: unknown[]) => JSON.stringify({
    title: '선물', establishedEvents: ['미나가 카요에게 티아라를 건넸다.'], stateChanges,
    characterKnowledge: [], persistentFacts: [], openContinuity: [], canonicalUpdateCandidates: [],
})

describe('change ledger', () => {
    test('writes a State Changes section that reads back as ledger lines', () => {
        const draft = parseMemoryWriterDraft(draftJson([
            { subject: '카요', attribute: '소지품: 티아라', before: null, after: '금빛 진주 티아라 보유' },
            { subject: '카요', before: '처녀', after: '처녀 아님' },
        ]))
        const markdown = serializeMemoryWriterDraft(draft, 'ko')
        expect(markdown).toContain('### 상태 변화\n\n- 카요 / 소지품 티아라: 금빛 진주 티아라 보유\n- 카요: 처녀 아님')
        expect(eventLedgerChanges(document({ id: 'e1', type: 'event', title: '선물', content: markdown }))).toEqual([
            { subject: '카요', attribute: '소지품 티아라', after: '금빛 진주 티아라 보유' },
            { subject: '카요', after: '처녀 아님' },
        ])
    })

    test('older drafts without attribute and events without the section stay valid', () => {
        expect(() => parseMemoryWriterDraft(draftJson([{ subject: '카요', before: null, after: '잠듦' }]))).not.toThrow()
        const legacy = document({ id: 'old', type: 'event', title: '옛 사건', content: '## 옛 사건\n\n### 이야기 요약\n\n- 카요: 식당에 갔다.' })
        expect(eventLedgerChanges(legacy)).toEqual([])
        expect(parseLedgerLine('not a list line')).toBeUndefined()
    })

    test('keeps the latest value per item and skips ambiguous subjects', () => {
        const kayo = document({ id: 'kayo', type: 'character', title: '카요', content: '## 카요' })
        const mina = document({ id: 'mina', type: 'character', title: '미나', content: '## 미나' })
        const event = (id: string, sequence: number, lines: string) => document({ id, type: 'event', title: id, sequence,
            content: `## ${id}\n\n### 이야기 요약\n\n- 일\n\n### 상태 변화\n\n${lines}` })
        const ledgers = buildCharacterLedgers([kayo, mina,
            event('e1', 1, '- 카요 / 처녀성: 처녀\n- 카요 / 위치: 기숙사'),
            event('e2', 2, '- 카요 / 처녀성: 처녀 아님\n- 카요와 미나 / 관계: 연인'),
        ], new Map([['e1', 1], ['e2', 2]]))
        expect(ledgers.get('kayo')).toEqual([
            { item: '처녀성', after: '처녀 아님', sequence: 2 },
            { item: '위치', after: '기숙사', sequence: 1 },
        ])
        expect(ledgers.has('mina')).toBe(false)
    })

    test('recall leads the card with the ledger only when events recorded changes', () => {
        const card = '## 카요\n\n### 현재 상태\n카요는 기숙사에 산다.'
        const kayo = document({ id: 'kayo', type: 'character', title: '카요', content: card })
        const legacy = document({ id: 'e1', type: 'event', title: '첫날', sequence: 1, content: '## 첫날\n\n### 이야기 요약\n\n- 카요가 도착했다.' })
        const before = inquireMarkdownDocuments({ documents: [kayo, legacy], currentInput: '카요' })
        expect(before.sources.find((source) => source.content.includes('카요는 기숙사'))?.content).not.toContain('Change ledger')

        const later = document({ id: 'e2', type: 'event', title: '밤', sequence: 2,
            content: '## 밤\n\n### 이야기 요약\n\n- 일\n\n### 상태 변화\n\n- 카요 / 위치: 행방불명' })
        const after = inquireMarkdownDocuments({ documents: [kayo, legacy, later], currentInput: '카요' })
        const source = after.sources.find((item) => item.content.includes('카요는 기숙사'))!
        expect(source.content.indexOf('- 위치: 행방불명 (#2)')).toBeLessThan(source.content.indexOf('카요는 기숙사'))
    })
})
