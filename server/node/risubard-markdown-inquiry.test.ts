import { get_encoding } from '@dqbd/tiktoken'
import { describe, expect, test } from 'vitest'
import type { MarkdownWikiDocument } from './risubard-markdown-wiki'
import { inquireMarkdownDocuments } from './risubard-markdown-inquiry'
import { RESOLVED_SOURCE_SCORE } from '../../src/ts/risubard/historicalSourceRecall'

function document(
    input: Partial<MarkdownWikiDocument> & Pick<
        MarkdownWikiDocument,
        'id' | 'type' | 'title' | 'relativePath' | 'content'
    >
): MarkdownWikiDocument {
    return {
        status: 'active',
        aliases: [],
        sourceMessageIds: [],
        updated: '2026-08-16T00:00:00.000Z',
        links: [],
        contextMode: 'auto',
        contentHash: `hash-${input.id}`,
        ...input,
    }
}

describe('progressive Markdown inquiry', () => {
    test('reserves the existing document count limit for separately injected required pages', () => {
        const pinned = Array.from({ length: 12 }, (_, index) => document({ id: `pin-${index}`,
            title: '계획', type: 'other', relativePath: `notes/pin-${index}.md`, content: '계획', contextMode: 'always' }))
        const auto = document({ id: 'auto', title: '계획', type: 'other', relativePath: 'notes/auto.md', content: '계획' })
        const result = inquireMarkdownDocuments({ documents: [...pinned, auto], currentInput: '계획', contextSelection: 'auto' })
        expect(result.sources).toEqual([])
    })
    test('loads complete required documents independently of query and per-source excerpt limits', () => {
        const content = '## 흑막의 계획\n\n' + '기억해야 할 계획입니다. '.repeat(140) + '\n열 번째 턴에 정체를 밝힌다.'
        const pinned = document({ id: 'plan', type: 'other', title: '계획', relativePath: 'notes/plan.md', content, contextMode: 'always' })
        const hidden = { ...pinned, id: 'hidden', relativePath: 'notes/hidden.md', contextMode: 'never' as const }
        const result = inquireMarkdownDocuments({ documents: [pinned, hidden], currentInput: '', contextSelection: 'required',
            tokenBudget: { target: 256, perSource: 256, maximum: 6000 } })
        expect(result.sources.map(source => source.content)).toEqual([content])
        expect(result.sources[0].tokens).toBeGreaterThan(256)
        expect(result.metrics.inspectedEdgeCount).toBe(0)
        // The operator's always-include choice is never rejected by the retrieval budget.
        expect(inquireMarkdownDocuments({ documents: [pinned], currentInput: '', contextSelection: 'required',
            tokenBudget: { target: 256, perSource: 256, maximum: 256 } }).sources.map(source => source.content)).toEqual([content])
        const optional = inquireMarkdownDocuments({ documents: [pinned, hidden], currentInput: '계획', contextSelection: 'auto' })
        expect(optional.sources).toEqual([])
    })
    test('includes verified semantic original evidence without an explicit history keyword', () => {
        const result = inquireMarkdownDocuments({documents:[],currentInput:'그는 손가락을 만지작거린다.',
            sourceMatches:[{messageId:'old',role:'assistant',content:'그가 전달했던 은빛 반지에는 비밀 장부의 위치가 새겨져 있다.',score:0.8,occurredAt:2,retrieval:'semantic'}],
            tokenBudget:{target:512,events:512,perSource:256,maximum:1024}})
        expect(result.sources.some(source=>source.content.includes('은빛 반지'))).toBe(true)
        expect(result.metrics.selectedTokens).toBeLessThanOrEqual(1024)
    })
    test('expands local candidates under dynamic limits without expanding provider token budget', () => {
        const documents = Array.from({ length: 180 }, (_, index) => document({
            id: `record-${index}`, type: 'other', title: `약속 ${index}`, relativePath: `notes/${index}.md`,
            content: `## 약속 ${index}\n\n북문에서 약속한 기록 ${index}.`,
        }))
        const input = { documents, currentInput: '북문 약속', tokenBudget: { target: 512, events: 512, perSource: 256, maximum: 1024 } }
        const baseline = inquireMarkdownDocuments(input)
        const expanded = inquireMarkdownDocuments({ ...input, retrievalLimits: { candidates: 256, directSeeds: 128 } })
        expect(baseline.metrics.candidateCount).toBeLessThanOrEqual(64)
        expect(expanded.metrics.candidateCount).toBeGreaterThan(baseline.metrics.candidateCount)
        expect(expanded.metrics.candidateCount).toBeLessThanOrEqual(256)
        expect(expanded.metrics.selectedTokens).toBeLessThanOrEqual(1024)
        expect(expanded.sources.length).toBeLessThanOrEqual(12)
    })

    test('retains independent verified passages in the same long document', () => {
        const first = '첫 약속은 북문에서 만나는 것이다.'
        const last = '두 번째 약속은 은색 나침반을 돌려주는 것이다.'
        const content = `## 기록\n\n### 첫 약속\n${first}\n\n` + '관련 없는 날씨. '.repeat(2000) + `\n\n### 두 번째 약속\n${last}`
        const doc = document({ id:'promises',type:'other',title:'기록',relativePath:'notes/promises.md',content })
        const result = inquireMarkdownDocuments({ documents:[doc], currentInput:'예전 두 약속은 무엇이었지?',
            semanticMatches:[first,last].map((text,index)=>({documentId:doc.id,score:0.9-index*0.01,contentHash:doc.contentHash,start:content.indexOf(text),end:content.indexOf(text)+text.length})),
            tokenBudget:{target:512,events:512,perSource:256,maximum:1024} })
        expect(result.sources[0].content).toContain(first)
        expect(result.sources[0].content).toContain(last)
        expect(result.metrics.selectedTokens).toBeLessThanOrEqual(1024)
    })
    test.each(['Why did Alice leave the fortress?', 'Did Alice leave the fortress?', 'Where was Alice before the collapse?'])('does not crowd out historical reasons for: %s', currentInput => {
        const history = 'Alice guarded the fortress. '.repeat(25) + 'Alice left because the bridge collapsed.'
        const content = '## Alice\n\n### Current State\n' + 'Alice lives in the southern village. '.repeat(40)
            + '\n\n### Story History\n' + history
        const doc = document({ id: 'alice', title: 'Alice', type: 'character', relativePath: 'characters/alice.md', content })
        const result = inquireMarkdownDocuments({ documents: [doc], currentInput,
            semanticMatches: [{ documentId: 'alice', score: 0.9, contentHash: doc.contentHash,
                start: content.indexOf(history), end: content.length }],
            tokenBudget: { target: 512, events: 512, perSource: 256, maximum: 1024 } })
        expect(result.sources[0].content).toContain('bridge collapsed')
        expect(result.sources[0].tokens).toBeLessThanOrEqual(256)
    })

    test.each(['Alice greets the guard.', 'Alice가 경비병에게 인사했다.', 'Alice asks why the guard is laughing.'])('keeps current facts alongside semantic evidence for: %s', currentInput => {
        const history = 'Alice once guarded the northern fortress.'
        const content = '## Alice\n\n### Current State\nAlice lives in the southern village.\n\n### Story History\n' + history.repeat(300)
        const doc = document({ id: 'alice', title: 'Alice', type: 'character', relativePath: 'characters/alice.md', content })
        const input = { documents: [doc], currentInput,
            semanticMatches: [{ documentId: 'alice', score: 0.9, contentHash: doc.contentHash, start: content.indexOf(history), end: content.indexOf(history) + history.length }],
            tokenBudget: { target: 512, events: 512, perSource: 256, maximum: 1024 } }
        const source = inquireMarkdownDocuments(input).sources[0]
        expect(source.content).toContain('southern village')
        expect(source.content).toContain(history)
        expect(source.content).toContain('Story History')
        expect(source.tokens).toBeLessThanOrEqual(256)
        const historical = inquireMarkdownDocuments({ ...input, currentInput: 'Where did Alice live before?' }).sources[0]
        expect(historical.content).toContain(history)
        expect(historical.content).not.toContain('southern village')
    })

    test('preserves enclosing qualifications around a semantic passage', () => {
        const content = '## Archive\n\n### Disproven rumors\n\n#### Courier\n\nThe courier gave a secret ledger to the enemy.'
        const doc = document({ id: 'rumor', title: 'Archive', type: 'event', relativePath: 'events/rumor.md', content })
        const result = inquireMarkdownDocuments({ documents: [doc], currentInput: 'betrayal',
            semanticMatches: [{ documentId: doc.id, score: 0.9, contentHash: doc.contentHash, start: content.indexOf('The courier'), end: content.length }] })
        expect(result.sources[0].content).toContain('Disproven rumors')
        expect(result.sources[0].content).toContain('#### Courier')
    })

    test('keeps current character state ahead of a semantic history passage', () => {
        const history = 'Alice once lived in the northern fortress.'
        const content = '## Alice\n\n### Current State\nAlice lives in the southern village.\n\n### Story History\n' + history.repeat(500)
        const doc = document({ id: 'alice', title: 'Alice', type: 'character', relativePath: 'characters/alice.md', content })
        const result = inquireMarkdownDocuments({ documents: [doc], currentInput: 'Where is Alice now?',
            semanticMatches: [{ documentId: 'alice', score: 0.9, contentHash: doc.contentHash, start: content.indexOf(history), end: content.indexOf(history) + history.length }],
            tokenBudget: { target: 512, events: 512, perSource: 256, maximum: 1024 } })
        expect(result.sources[0]?.content).toContain('southern village')
        expect(result.sources[0]?.content).not.toContain('northern fortress')
    })

    test('recovers verified semantic passage beyond lexical window and routes evidence', () => {
        const tail = 'The secret ledger was delivered to the enemy.'
        const content = '# Archive\n\n' + 'Unrelated description. '.repeat(1200) + '\n\n' + tail
        const doc = document({ id: 'ledger', type: 'event', title: 'Ledger', relativePath: 'events/ledger.md', content, sourceMessageIds: ['original'] })
        const match = { documentId: doc.id, score: 0.9, contentHash: doc.contentHash, start: content.indexOf(tail), end: content.length }
        const input = { documents: [doc], currentInput: 'betrayal', semanticMatches: [match], tokenBudget: { target: 512, events: 512, perSource: 256, maximum: 1024 } }
        const result = inquireMarkdownDocuments(input)
        expect(result.sources[0]?.content).toContain(tail)
        expect(result.evidenceRequests).toEqual([{ messageId: 'original', eventTitle: 'Ledger', documentId: 'ledger' }])
        expect(inquireMarkdownDocuments({ ...input, semanticMatches: [{ ...match, contentHash: 'stale' }] }).sources).toEqual([])
        expect(inquireMarkdownDocuments({ ...input, semanticMatches: [{ ...match, end: content.length + 1 }] }).sources).toEqual([])
    })

    test('preserves long routed historical evidence within the configured token budget', () => {
        const content = 'archive '.repeat(2000).trim()
        const result = inquireMarkdownDocuments({
            currentInput: 'archive in detail',
            tokenBudget: { target: 10000, events: 2000, perSource: 8000, maximum: 16000 },
            documents: [document({ id: 'event', type: 'event', title: 'archive',
                relativePath: 'events/archive.md', content: 'Archive evidence',
                sourceMessageIds: ['original'], contextMode: 'always' })],
            sourceMatches: [{ messageId: 'original', role: 'assistant',
                content, score: 10, occurredAt: 1 }],
        })
        const source = result.sources.find(item => item.id.startsWith('narrative-memory:source:'))
        expect(source?.content).toContain(content)
        expect(source?.tokens).toBeLessThanOrEqual(8000)
        expect(result.metrics.selectedTokens).toBeLessThanOrEqual(16000)
    })
    test('uses the configured token budget rather than a separate character cap', () => {
        const content = 'archive '.repeat(2000).trim()
        const input = {
            currentInput: 'archive',
            documents: [document({ id: 'archive', type: 'other', title: 'Archive',
                relativePath: 'notes/archive.md', content, contextMode: 'always' })],
        }
        const result = inquireMarkdownDocuments({ ...input,
            tokenBudget: { target: 8000, events: 8000, perSource: 8000, maximum: 16000 },
        })
        expect(result.sources[0].content).toBe(content)
        expect(result.sources[0].tokens).toBeLessThanOrEqual(8000)
        const small = inquireMarkdownDocuments({ ...input,
            tokenBudget: { target: 512, events: 512, perSource: 256, maximum: 512 },
        })
        expect(small.sources).toHaveLength(1)
        expect(small.sources[0].tokens).toBeLessThanOrEqual(256)
        expect(small.sources[0].content.length).toBeLessThan(content.length)
    })
    test('includes the recorded story day inside the existing source token budget', () => {
        const result = inquireMarkdownDocuments({
            currentInput: '춤을 기억해.',
            tokenBudget: { target: 512, events: 512, perSource: 256, maximum: 512 },
            documents: [document({
                id: 'dated', type: 'event', title: '춤', relativePath: 'events/dated.md',
                content: '## 춤\n길버트와 왈츠를 추었다.',
                retrievalMetadata: { keywords: ['춤'], storyTime: { day: 7, precision: 'explicit', evidence: '일주일 뒤' } },
            })],
        })
        expect(result.sources.some((source) => source.content.includes('[Story time: day +7 from the story start]'))).toBe(true)
        expect(result.sources.every((source) => source.tokens <= 256)).toBe(true)
    })
    test('adds the story day to a canon line\'s event mark', () => {
        const result = inquireMarkdownDocuments({
            currentInput: '길버트는 지금 어때?',
            documents: [document({
                id: 'event.dance', type: 'event', title: '춤', relativePath: 'events/dance.md', sequence: 20,
                content: '## 춤\n길버트와 왈츠를 추었다.',
                retrievalMetadata: { keywords: ['춤'], storyTime: { day: 1, precision: 'explicit', evidence: '다음 날' } },
            }), document({
                id: 'character.gilbert', type: 'character', title: '길버트', relativePath: 'characters/gilbert.md',
                content: '## 길버트\n\n### 현재 상태\n\n왈츠를 춘 뒤 들떠 있다. (#20)\n\n오래된 흉터가 있다. (#3)',
            })],
        })
        const card = result.sources.find((source) => source.id.includes('characters/gilbert.md'))
        expect(card?.content).toContain('(#20, day +1)')
        expect(card?.content).toContain('(#3)')
    })
    test('recalls a missing dance partner using retrieval keywords without extra model calls', () => {
        const result = inquireMarkdownDocuments({
            currentInput: '나는 지난 주에 누구와 춤을 췄는지 기억하려 애썼다.',
            documents: [document({
                id: 'ball', type: 'event', title: '가을 연회',
                relativePath: 'events/ball.md', sourceMessageIds: ['ball-source'],
                content: '## 가을 연회\n\n길버트와 왈츠를 추었다.',
                retrievalMetadata: { keywords: ['춤', '무도회', '파트너'] },
            })],
            sourceMatches: [{
                messageId: 'ball-source', role: 'assistant', occurredAt: 4,
                score: 0, content: '길버트가 손을 내밀었다. 우리는 왈츠를 추었다.',
            }],
        })
        expect(result.evidenceRequests).toEqual([
            { messageId: 'ball-source', eventTitle: '가을 연회' },
        ])
        expect(result.sources.find((source) => source.id.startsWith(
            'narrative-memory:source:ball-source:',
        ))?.content).toContain('길버트가 손을 내밀었다.')
        expect(result.metrics.auxiliaryModelCalls).toBe(0)
    })

    test('routes action recall through a matching arc line beyond unrelated early links', () => {
        const unrelated = Array.from({ length: 20 }, (_, index) => document({
            id: `battle-${index}`, type: 'event', title: `원정 ${index}`,
            relativePath: `events/battle-${index}.md`,
            content: `## 원정 ${index}\n\n성벽을 지켰다.`,
        }))
        const result = inquireMarkdownDocuments({
            currentInput: '누구와 춤을 췄는지 기억하려 애썼다.',
            documents: [
                ...unrelated,
                document({
                    id: 'arc', type: 'other', title: '스토리 아크 플롯',
                    relativePath: 'notes/arc.md',
                    content: '## 스토리 아크 플롯\n\n'
                        + unrelated.map((item) => `- 전투: [[${item.title}]]`).join('\n')
                        + '\n- 춤 상대와 가까워졌다: [[가을 연회]]',
                    links: [...unrelated.map((item) => item.title), '가을 연회'],
                }),
                document({
                    id: 'ball', type: 'event', title: '가을 연회',
                    relativePath: 'events/ball.md', sourceMessageIds: ['ball-source'],
                    content: '## 가을 연회\n\n길버트와 왈츠를 추었다.',
                }),
            ],
        })
        expect(result.evidenceRequests).toEqual([
            { messageId: 'ball-source', eventTitle: '가을 연회' },
        ])
        expect(result.sources.some((item) => item.id.includes('battle-'))).toBe(false)
        expect(result.metrics.inspectedEdgeCount).toBeLessThanOrEqual(256)
        expect(result.metrics.selectedNodeCount).toBeLessThanOrEqual(12)
        expect(result.metrics.selectedTokens).toBeLessThanOrEqual(6_000)
    })

    test('keyword matches preserve eligibility and do not inject metadata as story evidence', () => {
        const make = (id: string, extra: Partial<MarkdownWikiDocument> = {}) => document({
            id, type: 'event', title: id, relativePath: `events/${id}.md`,
            content: `## ${id}\n\n길버트와 왈츠를 추었다.`,
            retrievalMetadata: { keywords: ['춤', '검색전용표현'] },
            ...extra,
        })
        const result = inquireMarkdownDocuments({
            currentInput: '춤을 기억해.',
            documents: [make('eligible'), make('hidden', { contextMode: 'never' }),
                make('old', { status: 'superseded' })],
        })
        expect(result.sources.map((source) => source.id)).toEqual([
            'narrative-memory:wiki:events/eligible.md',
        ])
        expect(result.sources[0].content).not.toContain('검색전용표현')
    })

    test('retrieves one canonical document by an exact alias', () => {
        const result = inquireMarkdownDocuments({
            currentInput: '무한인은 지금 어디에 있지?',
            documents: [document({
                id: 'kim', type: 'character', title: '김철수',
                aliases: ['김군', '무한인'],
                relativePath: 'characters/kim.md',
                content: '## 김철수\n\n현재 북문에 있다.',
            })],
        })

        expect(result.sources.map((source) => source.id)).toEqual([
            'narrative-memory:wiki:characters/kim.md',
        ])
    })

    test('retrieves current character canon from a unique lore entity hint', () => {
        const result = inquireMarkdownDocuments({
            currentInput: '손을 뻗는다.',
            entityHints: [{
                kind: 'character',
                names: ['Haania', 'Hanya', 'Hania', '하니아', '수녀'],
            }],
            documents: [document({
                id: 'haania', type: 'character', title: '하니아',
                aliases: ['Haania', 'Hania'],
                relativePath: 'characters/haania.md',
                content: '## 하니아\n\n### 현재 상태\n\n교회 밖 나무 아래에 있다.',
            })],
        })

        expect(result.sources.map((source) => source.id)).toEqual([
            'narrative-memory:wiki:characters/haania.md',
        ])
        expect(result.sources[0]?.content).toContain('교회 밖 나무 아래')
    })

    test('does not guess a character from an ambiguous lore entity alias', () => {
        const result = inquireMarkdownDocuments({
            currentInput: '손을 뻗는다.',
            entityHints: [{ kind: 'character', names: ['수녀'] }],
            documents: [
                document({
                    id: 'haania', type: 'character', title: '하니아',
                    aliases: ['수녀'], relativePath: 'characters/haania.md',
                    content: '## 하니아\n\n교회 밖에 있다.',
                }),
                document({
                    id: 'maria', type: 'character', title: '마리아',
                    aliases: ['수녀'], relativePath: 'characters/maria.md',
                    content: '## 마리아\n\n수도원에 있다.',
                }),
            ],
        })

        expect(result.sources).toEqual([])
    })

    test('follows a wikilink written with a unique alias', () => {
        const result = inquireMarkdownDocuments({
            currentInput: '북문 경비대 관계를 알려 줘.',
            documents: [
                document({
                    id: 'guard', type: 'faction', title: '북문 경비대',
                    relativePath: 'factions/guard.md',
                    content: '## 북문 경비대\n\n지휘관은 [[무한인]]이다.',
                    links: ['무한인'],
                }),
                document({
                    id: 'kim', type: 'character', title: '김철수',
                    aliases: ['무한인'],
                    relativePath: 'characters/kim.md',
                    content: '## 김철수\n\n말수가 적다.',
                }),
            ],
        })

        expect(result.sources.map((source) => source.id)).toEqual(
            expect.arrayContaining([
                'narrative-memory:wiki:factions/guard.md',
                'narrative-memory:wiki:characters/kim.md',
            ])
        )
    })

    test('does not resolve a wikilink through a colliding alias', () => {
        const result = inquireMarkdownDocuments({
            currentInput: '북문 경비대 관계를 알려 줘.',
            documents: [
                document({
                    id: 'guard', type: 'faction', title: '북문 경비대',
                    relativePath: 'factions/guard.md',
                    content: '## 북문 경비대\n\n[[대장]]이 지휘한다.',
                    links: ['대장'],
                }),
                document({
                    id: 'kim', type: 'character', title: '김철수',
                    aliases: ['대장'], relativePath: 'characters/kim.md',
                    content: '## 김철수\n\n동부대 대장.',
                }),
                document({
                    id: 'lee', type: 'character', title: '이영희',
                    aliases: ['대장'], relativePath: 'characters/lee.md',
                    content: '## 이영희\n\n서부대 대장.',
                }),
            ],
        })

        expect(result.sources.map((source) => source.id)).toEqual([
            'narrative-memory:wiki:factions/guard.md',
        ])
    })

    test('follows two derived wiki-link hops from a lexical character seed', () => {
        const result = inquireMarkdownDocuments({
            currentInput: '프로도가 쉘롭에게 공격당한다. 대항할 물건은 무엇인가?',
            documents: [
                document({
                    id: 'frodo', type: 'character', title: '프로도',
                    relativePath: 'characters/frodo.md',
                    content: '# 프로도\n\n## 현재 소지품\n\n- [[에아렌딜의 유리병]]',
                    links: ['에아렌딜의 유리병'],
                }),
                document({
                    id: 'phial', type: 'item', title: '에아렌딜의 유리병',
                    relativePath: 'items/phial.md',
                    content: '# 에아렌딜의 유리병\n\n## 효능\n\n어둠 속에서 강한 빛을 낸다.\n\n## 유래\n\n[[로스로리엔의 선물]]에서 받았다.',
                    links: ['로스로리엔의 선물'],
                }),
                document({
                    id: 'gift', type: 'event', title: '로스로리엔의 선물',
                    relativePath: 'events/gift.md',
                    content: '# 로스로리엔의 선물\n\n갈라드리엘이 훗날 가장 어두운 순간에 쓰라며 유리병을 건넸다.',
                }),
                document({
                    id: 'unrelated', type: 'event', title: '곤도르의 회의',
                    relativePath: 'events/council.md',
                    content: '# 곤도르의 회의\n\n섭정들이 국경 문제를 논의했다.',
                }),
            ],
        })

        expect(result.sources.map((source) => source.id)).toEqual(
            expect.arrayContaining([
                'narrative-memory:wiki:characters/frodo.md',
                'narrative-memory:wiki:items/phial.md',
                'narrative-memory:wiki:events/gift.md',
            ])
        )
        expect(result.sources.some((source) =>
            source.id.endsWith('events/council.md'))).toBe(false)
        expect(result.metrics.hopCount).toBe(2)
        expect(result.metrics.inspectedEdgeCount).toBeGreaterThanOrEqual(2)
        expect(result.metrics.auxiliaryModelCalls).toBe(0)
    })

    test('returns the matching section instead of an unrelated document prefix', () => {
        const irrelevant = '오래된 무관한 기록이다. '.repeat(240)
        const result = inquireMarkdownDocuments({
            currentInput: '에아렌딜의 유리병은 어디에서 유래했지?',
            documents: [document({
                id: 'phial', type: 'item', title: '별빛 유물',
                relativePath: 'items/phial.md',
                content: `# 별빛 유물\n\n${irrelevant}\n\n## 유래\n\n에아렌딜의 별빛을 담았으며 갈라드리엘이 프로도에게 건넸다.`,
            })],
        })

        expect(result.sources).toHaveLength(1)
        expect(result.sources[0]?.content).toContain('## 유래')
        expect(result.sources[0]?.content).toContain('갈라드리엘')
        expect(result.sources[0]?.content.length).toBeLessThanOrEqual(2_000)
        expect(result.sources[0]?.content).not.toContain(irrelevant.slice(0, 2_000))
    })

    test('bounds traversal candidates, selected documents, excerpts, and tokens', () => {
        const linked = Array.from({ length: 80 }, (_, index) =>
            document({
                id: `item-${index}`, type: 'item', title: `유물 ${index}`,
                relativePath: `items/item-${index}.md`,
                content: `# 유물 ${index}\n\n${'상세 정보 '.repeat(500)}`,
            }))
        const result = inquireMarkdownDocuments({
            currentInput: '프로도의 유물',
            documents: [
                document({
                    id: 'frodo', type: 'character', title: '프로도',
                    relativePath: 'characters/frodo.md',
                    content: `# 프로도\n\n${linked.map((item) =>
                        `[[${item.title}]]`).join(' ')}`,
                    links: linked.map((item) => item.title),
                }),
                ...linked,
            ],
            // The bounds below are asserted against the old 2,000-token budget, independent of the app defaults.
            tokenBudget: { target: 2_000, events: 2_000, perSource: 2_000, maximum: 6_000 },
        })

        expect(result.metrics.candidateCount).toBeLessThanOrEqual(64)
        expect(result.metrics.inspectedEdgeCount).toBeLessThanOrEqual(256)
        expect(result.sources.length).toBeLessThanOrEqual(12)
        // The per-source token budget bounds an excerpt; a trimmed canon document may exceed 2,000 characters.
        expect(result.sources.every((source) =>
            source.tokens <= 2_000)).toBe(true)
        expect(result.metrics.selectedTokens).toBeLessThanOrEqual(2_000)
    })

    test('does not retrieve documents from conversational stopwords alone', () => {
        const result = inquireMarkdownDocuments({
            currentInput: '그는 지금 무엇을 해야 하지?',
            documents: Array.from({ length: 20 }, (_, index) => document({
                id: `note-${index}`,
                type: 'other',
                title: `기록 ${index}`,
                relativePath: `notes/note-${index}.md`,
                content: `# 기록 ${index}\n\n그는 조용히 방 안에 있었다.`,
            })),
        })

        expect(result.sources).toEqual([])
        expect(result.metrics.candidateCount).toBe(0)
    })

    test('ranks rare discriminative terms above ubiquitous narrative terms', () => {
        const result = inquireMarkdownDocuments({
            currentInput: '청동나비 표식이 있는 봉인문 기록을 찾아줘.',
            documents: [
                document({
                    id: 'rare-clue', type: 'event', title: '오래된 단서',
                    relativePath: 'events/rare-clue.md',
                    updated: '2026-08-01T00:00:00.000Z',
                    content: '# 오래된 단서\n\n청동나비 표식이 찍힌 봉인문 기록이다.',
                }),
                ...Array.from({ length: 8 }, (_, index) => document({
                    id: `common-${index}`, type: 'event',
                    title: '봉인문 기록',
                    relativePath: `events/common-${index}.md`,
                    updated: `2026-08-29T00:00:0${index}.000Z`,
                    content: '# 봉인문 기록\n\n봉인문 기록을 정리했다.',
                })),
            ],
        })

        expect(result.sources[0]?.id).toBe(
            'narrative-memory:wiki:events/rare-clue.md'
        )
    })

    test('admits semantic candidates without lexical overlap', () => {
        const result = inquireMarkdownDocuments({
            currentInput: '출구를 막은 장치를 풀 방법이 필요하다.',
            semanticMatches: [{ documentId: 'moon-seal', score: 0.91 }],
            documents: [document({
                id: 'moon-seal', type: 'event', title: '월광 의식',
                relativePath: 'events/moon-seal.md',
                content: '# 월광 의식\n\n은빛 구체를 제단 홈에 놓자 석문이 열렸다.',
            })],
        })

        expect(result.sources.map((source) => source.id)).toEqual([
            'narrative-memory:wiki:events/moon-seal.md',
        ])
        expect(result.metrics.semanticCandidateCount).toBe(1)
        expect(result.metrics.auxiliaryModelCalls).toBe(0)
    })

    test('recalls original source evidence through a linked story route', () => {
        const result = inquireMarkdownDocuments({
            currentInput: '샤이어를 떠나기 전 마지막으로 마신 에일을 기억해.',
            documents: [
                document({
                    id: 'shire-arc', type: 'other', title: '샤이어 출발 전',
                    relativePath: 'notes/shire-arc.md',
                    content: '# 샤이어 출발 전\n\n[[출발 전날의 불꽃놀이]] 뒤 여행을 시작했다.',
                    links: ['출발 전날의 불꽃놀이'],
                }),
                document({
                    id: 'farewell', type: 'event', title: '출발 전날의 불꽃놀이',
                    relativePath: 'events/farewell.md',
                    sourceMessageIds: ['shire-ale'],
                    content: '# 출발 전날의 불꽃놀이\n\n샘과 프로도는 간달프의 불꽃놀이를 보았다.',
                    links: ['샤이어 출발 전'],
                }),
            ],
            sourceMatches: [
                {
                    messageId: 'later-ale', role: 'assistant', occurredAt: 900,
                    score: 9,
                    content: '브리에서 이름 모를 에일을 주문했다.',
                },
                {
                    messageId: 'shire-ale', role: 'assistant', occurredAt: 5,
                    score: 2,
                    content: '샘과 프로도는 황금빛이 도는 플러피풋의 사과 에일을 마셨다.',
                },
            ],
        })

        const recalled = result.sources.filter((source) =>
            source.id.startsWith('narrative-memory:source:'))
        expect(recalled[0]?.id).toContain('shire-ale')
        expect(recalled[0]?.content).toContain('플러피풋의 사과 에일')
        expect(result.metrics.selectedTokens).toBeLessThanOrEqual(2_000)
        expect(result.metrics.auxiliaryModelCalls).toBe(0)
    })

    test('reserves directly linked old evidence without requiring a memory phrase', () => {
        const result = inquireMarkdownDocuments({
            currentInput: '수녀들이 데려갔다는 여자들이 어디로 향했는지 주인에게 묻는다.',
            documents: [
                document({
                    id: 'village-abduction', type: 'event', title: '아르세존 마을 입구',
                    relativePath: 'events/village-abduction.md',
                    sourceMessageIds: ['turn-2'],
                    content: '# 아르세존 마을 입구\n\n촌장은 한 달 전 수녀들이 자신의 딸을 포함한 마을 처녀 넷을 데려간 뒤 모두 실종되었다고 밝혔다.',
                }),
                ...Array.from({ length: 8 }, (_, index) => document({
                    id: `recent-${index}`, type: 'event', title: `최근 술집 사건 ${index}`,
                    relativePath: `events/recent-${index}.md`,
                    content: `# 최근 술집 사건 ${index}\n\n주인은 아는 바가 없는 것 같다고 말했다.`,
                })),
            ],
            sourceMatches: [{
                messageId: 'turn-2', role: 'assistant', occurredAt: 2,
                score: 2,
                content: '촌장은 수녀들이 마을 처녀 넷을 데려갔다고 말했다.',
            }],
        })

        expect(result.sources.map((source) => source.id)).toEqual(
            expect.arrayContaining([
                'narrative-memory:wiki:events/village-abduction.md',
                'narrative-memory:source:turn-2:2',
            ])
        )
    })

    test('requests exact source messages from the events that were actually selected', () => {
        const result = inquireMarkdownDocuments({
            currentInput: '수녀들이 데려간 처녀들이 어디로 갔는지 묻는다.',
            documents: [
                document({
                    id: 'abduction', type: 'event', title: '네 처녀의 실종',
                    relativePath: 'events/abduction.md',
                    sourceMessageIds: ['turn-1', 'turn-4'],
                    content: '# 네 처녀의 실종\n\n수녀들이 처녀 넷을 데려갔고 교회에는 시신이 없었다.',
                }),
                document({
                    id: 'unrelated', type: 'event', title: '수녀 괴물과의 전투',
                    relativePath: 'events/unrelated.md',
                    sourceMessageIds: ['turn-9'],
                    content: `# 수녀 괴물과의 전투\n\n${'괴물과 전투가 벌어졌다. '.repeat(200)}`,
                }),
            ],
            tokenBudget: {
                target: 1_024,
                events: 256,
                perSource: 256,
                maximum: 1_280,
            },
        })

        expect((result as any).evidenceRequests).toEqual([
            {
                messageId: 'turn-1',
                eventTitle: '네 처녀의 실종',
            },
            {
                messageId: 'turn-4',
                eventTitle: '네 처녀의 실종',
            },
        ])
        expect((result as any).evidenceRequests).not.toEqual(
            expect.arrayContaining([
                expect.objectContaining({ messageId: 'turn-9' }),
            ])
        )
    })

    test('selects as many original sources as the user limit and token budget allow', () => {
        const result = inquireMarkdownDocuments({
            currentInput: '과거 사건의 근거를 확인한다.',
            documents: [document({
                id: 'evidence', type: 'event', title: '세 단서',
                relativePath: 'events/evidence.md',
                sourceMessageIds: ['turn-1', 'turn-2', 'turn-3'],
                content: '# 세 단서\n\n과거 사건의 근거 세 가지가 남아 있다.',
            })],
            sourceMatches: ['turn-1', 'turn-2', 'turn-3'].map(
                (messageId, index) => ({
                    messageId,
                    role: 'assistant' as const,
                    occurredAt: index * 2 + 1,
                    score: 10 - index,
                    content: `직접 원문 근거 ${index + 1}`,
                })
            ),
            sourceLimit: 3,
            tokenBudget: {
                target: 1_024,
                events: 1_024,
                perSource: 256,
                maximum: 2_048,
            },
        } as any)

        const recalled = result.sources.filter((source) =>
            source.id.startsWith('narrative-memory:source:'))
        expect(recalled).toHaveLength(3)
        expect(recalled.map((source: any) => source.displayName)).toEqual([
            '과거 원문 · 턴 1 응답 · 출처 기반 · 세 단서',
            '과거 원문 · 턴 2 응답 · 출처 기반 · 세 단서',
            '과거 원문 · 턴 3 응답 · 출처 기반 · 세 단서',
        ])
    })

    test('a scene with several named characters keeps each one\'s current state', () => {
        const names = ['미도리야', '바쿠고', '토도로키', '우라라카']
        const documents = names.map((name, index) => document({ id: `character.${index}`, type: 'character', title: name,
            relativePath: `characters/${index}.md`, content: [`## ${name}`, '', '### 현재 상태', '', `- 현재마커${index}: 훈련장에서 대기 중이다.`, '',
                '### 지식과 비밀', '', ...Array.from({ length: 80 }, (_, turn) => `- ${turn + 1}번째 훈련에서 새 기술을 익혔다.`)].join('\n') }))
        const result = inquireMarkdownDocuments({ documents, contextSelection: 'auto',
            currentInput: `${names.join(', ')} 모두 훈련장에 모였다. 다들 지금 몸 상태가 어때?`,
            tokenBudget: { target: 4_000, events: 3_000, perSource: 2_000, maximum: 7_500 } })
        const context = result.sources.map((source) => source.content).join('\n')
        expect(names.filter((_, index) => context.includes(`현재마커${index}:`))).toEqual(names)
    })

    test('a scene whose original comes along keeps only its heading, so two scenes fit whole', () => {
        const scene = (id: string, title: string, messageId: string) => document({ id, type: 'event', title,
            relativePath: `events/${id}.md`, sourceMessageIds: [messageId],
            content: `## ${title}\n\n` + `- ${title} 장면에서 꽃다발 이야기가 길게 이어졌다.`.repeat(12) })
        const original = (messageId: string, occurredAt: number, text: string) => ({
            messageId, role: 'assistant' as const, occurredAt, score: 1_000, content: `${text} `.repeat(15) })
        const result = inquireMarkdownDocuments({
            currentInput: '던진 꽃다발이 다음 날 아침 어디 있었는지 기억나? 던진 꽃다발 다음 날 아침',
            documents: [scene('throw', '던진 꽃다발', 'turn-1'), scene('morning', '다음 날 아침 꽃다발', 'turn-7')],
            sourceMatches: [original('turn-1', 1, '폐품상은 꽃다발을 바닥에 던졌다.'),
                original('turn-7', 7, '눈을 뜨니 배 위에 꽃다발이 올려져 있었다.')],
            tokenBudget: { target: 200, events: 2_000, perSource: 1_000, maximum: 1_100 },
        })
        const ids = result.sources.map((source) => source.id)
        expect(ids).toContain('narrative-memory:source:turn-1:1')
        expect(ids).toContain('narrative-memory:source:turn-7:7')
        for (const event of result.sources.filter((source) => source.id.includes(':wiki:events/'))) {
            expect(event.content).toContain('[Summary omitted: the original text of this scene follows]')
        }
        expect(result.metrics.selectedTokens).toBeLessThanOrEqual(1_100)
    })

    test('the best query match comes before routed scenes even when no summary mentions it', () => {
        const scene = (id: string, title: string, messageId: string) => document({ id, type: 'event', title,
            relativePath: `events/${id}.md`, sourceMessageIds: [messageId],
            content: `## ${title}\n\n- ${title}: 유메미가 전구 이야기를 했다.` })
        const original = (messageId: string, occurredAt: number, score: number, text: string) => ({
            messageId, role: 'assistant' as const, occurredAt, score, content: `${text} `.repeat(20) })
        const result = inquireMarkdownDocuments({
            currentInput: '유메미가 말한 전구 여분은 몇 개였고, 전기 흘려 봤을 때 쓸 수 있는 건 몇 개였지?',
            documents: [scene('stock', '전구 재고 확인', 'turn-7'), scene('welcome', '첫 만남 전구 안내', 'turn-1')],
            // The summary of turn 9 dropped the test result, so only its original text can answer.
            sourceMatches: [
                original('turn-7', 7, RESOLVED_SOURCE_SCORE, '예비 전구는 재고가 4개 남아 있다고 했다.'),
                original('turn-1', 1, RESOLVED_SOURCE_SCORE, '유메미가 손님을 맞으며 전구 안내를 했다.'),
                original('turn-9', 9, 4, '전기를 흘려 본 결과 4개 중에 2개의 전구가 무사했다.'),
            ],
            sourceLimit: 2,
            tokenBudget: { target: 200, events: 2_000, perSource: 1_000, maximum: 1_500 },
        })
        const ids = result.sources.map((source) => source.id)
        expect(ids).toContain('narrative-memory:source:turn-9:9')
        expect(ids).toContain('narrative-memory:source:turn-7:7')
        expect(ids).not.toContain('narrative-memory:source:turn-1:1')
    })

    test('ranked originals come before pages and replace the scored choice of originals', () => {
        const page = document({ id: 'yumemi', type: 'character', title: '유메미', relativePath: 'characters/yumemi.md',
            content: `## 유메미\n\n${'- 유메미는 플라네타리움의 안내 로봇이다. 전구 이야기를 좋아한다.\n'.repeat(40)}` })
        const scene = document({ id: 'stock', type: 'event', title: '전구 재고 확인', relativePath: 'events/stock.md',
            sourceMessageIds: ['turn-7'], content: '## 전구 재고 확인\n\n- 유메미가 전구 재고를 말했다.' })
        const original = (messageId: string, occurredAt: number, score: number, text: string) => ({
            messageId, role: 'assistant' as const, occurredAt, score, content: `${text} `.repeat(20) })
        const input = {
            currentInput: '유메미가 말한 전구 여분은 몇 개였고, 전기 흘려 봤을 때 쓸 수 있는 건 몇 개였지?',
            documents: [page, scene],
            sourceMatches: [
                original('turn-9', 9, 4, '전기를 흘려 본 결과 4개 중에 2개의 전구가 무사했다.'),
                original('turn-7', 7, RESOLVED_SOURCE_SCORE, '예비 전구는 재고가 4개 남아 있다고 했다.'),
                original('turn-3', 3, 6, '유메미가 전구 이야기를 하며 웃었다.'),
            ],
            sourceLimit: 4,
            tokenBudget: { target: 1_000, events: 1_000, perSource: 400, maximum: 1_400 },
        }
        const plain = inquireMarkdownDocuments(input).sources.map((source) => source.id)
        expect(plain).toContain('narrative-memory:wiki:characters/yumemi.md')
        const ranked = inquireMarkdownDocuments({ ...input, rankedSourceIds: ['turn-7', 'turn-9'] })
        const ids = ranked.sources.map((source) => source.id)
        // Both ranked originals fit although the page lane alone could have used the room.
        expect(ids.filter((id) => id.includes(':source:'))).toEqual([
            'narrative-memory:source:turn-7:7', 'narrative-memory:source:turn-9:9'])
        expect(ranked.sources.find((source) => source.id.endsWith('turn-7:7'))?.displayName).toContain('전구 재고 확인')
        expect(ranked.metrics.selectedTokens).toBeLessThanOrEqual(1_400)
    })

    test('a long canon page gives way to the original text of the selected event', () => {
        const result = inquireMarkdownDocuments({
            currentInput: '유메미, 마지막 식량 섭취 때 내가 뭘 먹었지?',
            documents: [
                document({ id: 'yumemi', type: 'character', title: '유메미', relativePath: 'characters/yumemi.md',
                    content: '## 유메미\n\n' + '유메미는 플라네타리움의 해설원 로봇이다. '.repeat(200) }),
                document({ id: 'meal', type: 'event', title: '마지막 식량 섭취', relativePath: 'events/meal.md',
                    sourceMessageIds: ['turn-5'], content: '## 마지막 식량 섭취\n\n- 배낭의 마지막 식량을 먹었다.' }),
                document({ id: 'store', type: 'event', title: '식량 이야기', relativePath: 'events/store.md',
                    sourceMessageIds: ['turn-9'], content: '## 식량 이야기\n\n- 식량이 바닥났다.' }),
            ],
            // Lexical recall scored the asked-for turn low; a requested turn came back at the resolver's score.
            sourceMatches: [
                { messageId: 'turn-9', role: 'assistant', occurredAt: 9, score: 1_000, content: '식량 창고는 비어 있었다. '.repeat(20) },
                { messageId: 'turn-5', role: 'assistant', occurredAt: 5, score: 2, content: '정수기로 거른 물에서 녹 냄새가 났다. '.repeat(12) + '마지막 알루미늄 팩의 하드 비스킷을 물과 함께 삼켰다.' },
            ],
            sourceLimit: 1,
            tokenBudget: { target: 700, events: 700, perSource: 400, maximum: 1_200 },
        })
        const sources = result.sources.map(source => source.id)
        expect(sources).toContain('narrative-memory:source:turn-5:5')
        expect(sources).not.toContain('narrative-memory:source:turn-9:9')
        expect(sources).toContain('narrative-memory:wiki:events/meal.md')
        expect(result.sources.find(source => source.id === 'narrative-memory:wiki:characters/yumemi.md')?.tokens ?? 0)
            .toBeLessThan(400)
    })

    test('long canon pages placed before events leave room for the matching event', () => {
        const page = (id: string, title: string) => document({ id, type: 'character', title,
            relativePath: `characters/${id}.md`, content: `## ${title}\n\n` + `${title}는 프로그램 카드를 기억한다. `.repeat(200) })
        const result = inquireMarkdownDocuments({
            currentInput: '유메미, 폐품상에게 뽑아 준 프로그램 카드에 찍힌 제목은?',
            documents: [page('yumemi', '유메미'), page('junker', '폐품상'), document({
                id: 'card', type: 'event', title: '프로그램 카드 출력', relativePath: 'events/card.md',
                content: '## 프로그램 카드 출력\n\n- 이번 달 투영 제목이 찍힌 프로그램 카드를 뽑아 주었다.' })],
            tokenBudget: { target: 800, events: 800, perSource: 400, maximum: 1_200 },
        })
        expect(result.sources.map(source => source.id)).toContain('narrative-memory:wiki:events/card.md')
    })

    test('labels event sources with their canonical title and stable ID', () => {
        const result = inquireMarkdownDocuments({
            currentInput: '네 처녀의 실종을 확인한다.',
            documents: [document({
                id: 'abduction', type: 'event', title: '네 처녀의 실종',
                relativePath: 'events/turn-bU0ZpK1B.md',
                content: '# 네 처녀의 실종\n\n처녀 넷이 실종되었다.',
            })],
        })

        expect((result.sources[0] as any).displayName).toBe(
            '사건 · 네 처녀의 실종 · abduction'
        )
    })

    test('caps every selected item with the configured tokenizer budget', () => {
        const result = inquireMarkdownDocuments({
            currentInput: '필수 설정을 확인한다.',
            tokenBudget: { target: 768, events: 768, perSource: 256, maximum: 1_024 },
            documents: [document({
                id: 'required-token-cap', type: 'concept', title: '필수 설정',
                relativePath: 'concepts/required-token-cap.md',
                content: `# 필수 설정\n\n${'가나다라마바사 '.repeat(1_000)}`,
                contextMode: 'always',
            })],
        })

        expect(result.sources[0]?.tokens).toBeLessThanOrEqual(256)
    })

    test('uses a compact default budget instead of filling the hard limit', () => {
        const result = inquireMarkdownDocuments({
            currentInput: '프로도에 대한 관련 정보를 알려 줘.',
            documents: [
                document({
                    id: 'frodo', type: 'character', title: '프로도',
                    relativePath: 'characters/frodo.md',
                    content: '# 프로도\n\n호빗 반지 운반자다.',
                }),
                ...Array.from({ length: 12 }, (_, index) => document({
                    id: `frodo-event-${index}`,
                    type: 'event',
                    title: `프로도의 사건 ${index}`,
                    relativePath: `events/frodo-${index}.md`,
                    content: `# 프로도의 사건 ${index}\n\n프로도는 길을 걸었다.\n\n${'상세 사건 기록 '.repeat(260)}`,
                })),
            ],
        })

        expect(result.sources[0]?.id).toBe(
            'narrative-memory:wiki:characters/frodo.md'
        )
        expect(result.metrics.selectedTokens).toBeLessThanOrEqual(2_000)
    })

    test.each(['## 작중 행적', '### 작중 행적', '### Story History'])(
        'uses character turning points as a map and shops linked events for chronology (%s)', (historyHeading) => {
        const result = inquireMarkdownDocuments({
            currentInput: '프로도의 모험과 작중 행적을 순서대로 나열해 줘.',
            tokenBudget: { target: 256, events: 768, maximum: 1_024 },
            documents: [
                document({
                    id: 'frodo', type: 'character', title: '프로도',
                    relativePath: 'characters/frodo.md',
                    content: [
                        '# 프로도',
                        '',
                        historyHeading,
                        '',
                        '- [[샤이어 출발]]: 샘과 함께 고향을 떠났다.',
                        '- [[반지원정대 결성]]: 반지를 파괴할 책임을 맡았다.',
                        '- [[원정대 이탈]]: 샘과 둘이 모르도르로 향했다.',
                    ].join('\n'),
                    links: ['샤이어 출발', '반지원정대 결성', '원정대 이탈'],
                }),
                ...['샤이어 출발', '반지원정대 결성', '원정대 이탈']
                    .map((title, index) => document({
                        id: `event-${index}`, type: 'event', title,
                        relativePath: `events/event-${index}.md`,
                        content: `# ${title}\n\n프로도의 상세 사건 기록이다.`,
                    })),
            ],
        })

        expect(result.sources.map((source) => source.id)).toEqual(expect.arrayContaining([
            'narrative-memory:wiki:characters/frodo.md',
            'narrative-memory:wiki:events/event-0.md',
            'narrative-memory:wiki:events/event-1.md',
            'narrative-memory:wiki:events/event-2.md',
        ]))
        expect(result.sources[0]?.content).toContain(historyHeading)
        expect(result.metrics.selectedEventTokens).toBeGreaterThan(0)
        expect(result.metrics.selectedEventTokens).toBeLessThanOrEqual(768)
        expect(result.metrics.selectedTokens).toBeLessThanOrEqual(1_024)
    })

    test('reserves linked event evidence for past causal analysis', () => {
        const result = inquireMarkdownDocuments({
            currentInput: '진우가 초반에 주인공 자리를 잃은 원인과 세부 사건을 분석해 줘.',
            tokenBudget: { target: 256, events: 512, maximum: 768 },
            documents: [
                document({
                    id: 'jinwoo', type: 'character', title: '진우',
                    relativePath: 'characters/jinwoo.md',
                    content: [
                        '# 진우',
                        '',
                        '## 작중 행적',
                        '',
                        '- [[교실의 폭발]] 뒤 관계가 악화됐다.',
                        '- [[훼손된 신발]] 뒤 범행을 고백했다.',
                        '',
                        '초반 주인공 자리와 원인을 다루는 압축 요약이다. '.repeat(2),
                    ].join('\n'),
                    links: ['교실의 폭발', '훼손된 신발'],
                }),
                document({
                    id: 'outburst', type: 'event', title: '교실의 폭발',
                    relativePath: 'events/outburst.md',
                    content: '# 교실의 폭발\n\n진우는 필통을 책상에 내던지며 미나에게 소리쳤다. 필통은 미나에게 던진 것이 아니며, 행동의 대상과 고함의 대상은 구분된다. 이 사건 뒤 진우는 교실을 나갔다.',
                }),
                document({
                    id: 'shoes', type: 'event', title: '훼손된 신발',
                    relativePath: 'events/shoes.md',
                    content: '# 훼손된 신발\n\n미나는 이미 진우와 대화를 거부했고, 신발을 훼손한 범인이 진우라는 사실은 나중의 고백 전까지 몰랐다. 따라서 신발 훼손은 미나가 당시에 진우를 거부한 원인이 아니며, 범인에 관한 지식은 고백 뒤에 생겼다.',
                }),
            ],
        })

        expect(result.sources.map((source) => source.id)).toEqual(
            expect.arrayContaining([
                'narrative-memory:wiki:events/outburst.md',
                'narrative-memory:wiki:events/shoes.md',
            ])
        )
        expect(result.metrics.selectedEventTokens).toBeGreaterThan(0)
        expect(result.metrics.selectedEventTokens).toBeLessThanOrEqual(512)
        expect(result.metrics.selectedTokens).toBeLessThanOrEqual(768)
        expect(result.metrics.auxiliaryModelCalls).toBe(0)
    })

    test.each([
        '프로도의 현재 상태와 목표를 상세히 알려 줘.',
        '프로도의 상태와 목표를 알려 줘.',
        '프로도의 능력은 지금 어때?',
    ])('does not activate the event lane for a current-state query: %s', (currentInput) => {
        const result = inquireMarkdownDocuments({
            currentInput,
            tokenBudget: { target: 256, events: 768, maximum: 1_024 },
            documents: [
                document({
                    id: 'frodo', type: 'character', title: '프로도',
                    relativePath: 'characters/frodo.md',
                    content: '# 프로도\n\n### 현재 상태\n\n- 모르도르로 향한다.\n\n[[샤이어 출발]]',
                    links: ['샤이어 출발'],
                }),
                document({
                    id: 'departure', type: 'event', title: '샤이어 출발',
                    relativePath: 'events/departure.md',
                    content: '# 샤이어 출발\n\n프로도가 샤이어를 떠났다.',
                }),
            ],
        })

        expect(result.sources.map((source) => source.id)).toEqual([
            'narrative-memory:wiki:characters/frodo.md',
        ])
        expect(result.metrics.selectedEventTokens).toBe(0)
    })

    test('keeps a directly matched event for a current-time event query', () => {
        const result = inquireMarkdownDocuments({
            currentInput: '지금 벌어진 사건은 무엇이지?',
            tokenBudget: { target: 512, events: 768, maximum: 1_280 },
            documents: [document({
                id: 'current-incident', type: 'event', title: '지금 벌어진 사건',
                relativePath: 'events/current-incident.md',
                content: '# 지금 벌어진 사건\n\n성문 앞에서 폭발이 일어났다.',
            })],
        })

        expect(result.sources.map((source) => source.id)).toEqual([
            'narrative-memory:wiki:events/current-incident.md',
        ])
    })

    test.each([
        '그 사건은 어디서 일어났어?',
        '샤이어 출발은 어디에서 일어났어?',
    ])('retrieves event location evidence instead of treating it as current state: %s', (currentInput) => {
        const result = inquireMarkdownDocuments({
            currentInput,
            tokenBudget: { target: 512, events: 768, maximum: 1_280 },
            documents: [document({
                id: 'departure-location', type: 'event', title: '샤이어 출발',
                relativePath: 'events/departure-location.md',
                content: '# 샤이어 출발\n\n그 사건에서 프로도는 백 엔드의 집에서 출발했다.',
            })],
        })

        expect(result.sources.map((source) => source.id)).toEqual([
            'narrative-memory:wiki:events/departure-location.md',
        ])
    })

    test('reserves event slots before lower-priority documents for detailed queries', () => {
        const eventTitle = '검은 문 대치'
        const result = inquireMarkdownDocuments({
            currentInput: '프로도가 왜 검은 문에서 물러났는지 상세히 알려 줘.',
            tokenBudget: { target: 1_024, events: 512, maximum: 1_536 },
            documents: [
                document({
                    id: 'frodo', type: 'character', title: '프로도',
                    relativePath: 'characters/frodo.md',
                    content: `# 프로도\n\n### 큰 전환점\n\n- [[${eventTitle}]]에서 후퇴했다.`,
                    links: [eventTitle],
                }),
                document({
                    id: 'black-gate', type: 'event', title: eventTitle,
                    relativePath: 'events/black-gate.md',
                    content: '# 검은 문 대치\n\n프로도는 정면 돌파가 불가능하다는 사실을 확인하고 후퇴했다.',
                }),
                ...Array.from({ length: 12 }, (_, index) => document({
                    id: `note-${index}`, type: 'concept',
                    title: `프로도 검은 문 기록 ${index}`,
                    relativePath: `concepts/note-${index}.md`,
                    content: `# 프로도 검은 문 기록 ${index}\n\n검은 문에 관한 보조 기록이다.`,
                })),
            ],
        })

        expect(result.sources.map((source) => source.id)).toContain(
            'narrative-memory:wiki:events/black-gate.md'
        )
        expect(result.metrics.selectedEventTokens).toBeGreaterThan(0)
        expect(result.sources.length).toBeLessThanOrEqual(12)
    })

    test('retrieves an indirectly recalled old puzzle beside a newer item', () => {
        const puzzleTitle = '석문의 수수께끼와 퍼즐 출구 발견'
        const sphereTitle = '결박 탈출과 해골 문양 구체 발견'
        const distractors = Array.from({ length: 12 }, (_, index) => ({
            title: `리리아의 최근 무관한 사건 ${index}`,
            document: document({
                id: `recent-unrelated-${index}`,
                type: 'event',
                title: `리리아의 최근 무관한 사건 ${index}`,
                relativePath: `events/recent-unrelated-${index}.md`,
                updated: `2026-08-22T08:${String(index).padStart(2, '0')}:00.000Z`,
                content: `# 리리아의 최근 무관한 사건 ${index}\n\n리리아는 기숙사에 있던 사람과 무관한 일을 겪었다.`,
                links: ['리리아'],
            }),
        }))
        const result = inquireMarkdownDocuments({
            currentInput: '리리아는 전날 탈출하려다 발견했던 숨겨진 문과, 그 주변에 있던 문양들을 떠올리고, 구체를 들고 그리로 향한다.',
            documents: [
                document({
                    id: 'lelia', type: 'character', title: '리리아',
                    relativePath: 'characters/lelia.md',
                    updated: '2026-08-22T08:42:00.000Z',
                    content: '# 리리아\n\n빼앗긴 완드를 되찾아 탈출하고자 한다.',
                    links: [
                        puzzleTitle,
                        sphereTitle,
                        ...distractors.map(({ title }) => title),
                    ],
                }),
                document({
                    id: 'stone-door-puzzle',
                    type: 'event',
                    title: puzzleTitle,
                    relativePath: 'events/stone-door-puzzle.md',
                    updated: '2026-08-21T20:57:37.572Z',
                    content: [
                        '# 석문의 수수께끼와 퍼즐 출구 발견',
                        '',
                        '리리아는 고풍스러운 회랑 막다른 길에서 거대한 고대 석문을 발견했다.',
                        "석문 좌측에는 '태양, 불, 아기'가, 우측에는 '달, 물, ───'이라는 문구와 함께 둥그런 구멍이 파여 있었다.",
                    ].join('\n'),
                    links: ['리리아'],
                }),
                document({
                    id: 'skull-sphere',
                    type: 'event',
                    title: sphereTitle,
                    relativePath: 'events/skull-sphere.md',
                    updated: '2026-08-22T08:42:19.737Z',
                    content: '# 결박 탈출과 해골 문양 구체 발견\n\n리리아는 탈출하려다 문간 탁자에서 해골 문양의 검은 구체를 발견했다.',
                    links: ['리리아'],
                }),
                ...distractors.map(({ document: item }) => item),
            ],
        })

        expect(result.sources.map((source) => source.id)).toEqual(
            expect.arrayContaining([
                'narrative-memory:wiki:events/stone-door-puzzle.md',
                'narrative-memory:wiki:events/skull-sphere.md',
            ])
        )
        expect(result.sources.length).toBeLessThanOrEqual(12)
        expect(result.metrics.selectedTokens).toBeLessThanOrEqual(2_000)
        expect(result.metrics.auxiliaryModelCalls).toBe(0)
    })

    test('does not spend forward-scene budget on linked-only characters', () => {
        const result = inquireMarkdownDocuments({
            currentInput: '리리아는 소리가 나지 않는 길을 선택한다.',
            documents: [
                document({
                    id: 'lelia', type: 'character', title: '리리아',
                    relativePath: 'characters/lelia.md',
                    content: '# 리리아\n\n식칼을 들고 복도에 있다.\n\n[[부리 마스크 간수]] [[하니아]]',
                    links: ['부리 마스크 간수', '하니아'],
                }),
                document({
                    id: 'guard', type: 'character', title: '부리 마스크 간수',
                    relativePath: 'characters/guard.md',
                    content: '# 부리 마스크 간수\n\n사망했다.',
                }),
                document({
                    id: 'hania', type: 'character', title: '하니아',
                    relativePath: 'characters/hania.md',
                    content: '# 하니아\n\n현재 위치는 불명이다.',
                }),
            ],
        })

        expect(result.sources.map((source) => source.id)).toEqual([
            'narrative-memory:wiki:characters/lelia.md',
        ])
    })

    test('injects current character state even when long history appears first', () => {
        const result = inquireMarkdownDocuments({
            currentInput: '체사레와 산책한다.',
            documents: [document({
                id: 'cesare', type: 'character', title: '체사레',
                relativePath: 'characters/cesare.md',
                content: [
                    '## 체사레',
                    '### 작중 행적',
                    `- ${'오래된 사건 '.repeat(500)}`,
                    '### 현재 상태',
                    '- 쉽독이다.',
                    '- 이탈리아에 남기로 했다.',
                    '### 관계',
                    '- 연인과 교제한 지 21개월이다.',
                ].join('\n\n'),
            })],
        })

        expect(result.sources).toHaveLength(1)
        expect(result.sources[0].content).toContain('### 현재 상태')
        expect(result.sources[0].content).toContain('쉽독이다')
        expect(result.sources[0].content).toContain('### 관계')
        expect(result.sources[0].content).not.toContain('오래된 사건 오래된 사건')
        expect(result.sources[0].content.length).toBeLessThanOrEqual(2_000)
    })

    test.each([undefined, 'auto'] as const)('keeps linked characters for explicit relationship questions (%s)', (contextSelection) => {
        const result = inquireMarkdownDocuments({
            contextSelection,
            currentInput: '리리아와 연결된 인물은 누구인가?',
            documents: [
                document({
                    id: 'lelia', type: 'character', title: '리리아',
                    relativePath: 'characters/lelia.md',
                    content: '# 리리아\n\n[[부리 마스크 간수]] [[하니아]]와 연결되어 있다.',
                    contextMode: 'always',
                    links: ['부리 마스크 간수', '하니아'],
                }),
                document({
                    id: 'guard', type: 'character', title: '부리 마스크 간수',
                    relativePath: 'characters/guard.md',
                    content: '# 부리 마스크 간수\n\n사망했다.',
                }),
                document({
                    id: 'hania', type: 'character', title: '하니아',
                    relativePath: 'characters/hania.md',
                    content: '# 하니아\n\n현재 위치는 불명이다.',
                }),
            ],
        })

        expect(result.sources.map((source) => source.id)).toEqual(
            expect.arrayContaining([
                'narrative-memory:wiki:characters/guard.md',
                'narrative-memory:wiki:characters/hania.md',
            ])
        )
    })

    test('keeps only required documents that fit the Korean token budget outside the required read', () => {
        const documents = Array.from({ length: 4 }, (_, index) => document({
            id: `required-${index}`,
            type: 'concept',
            title: `필수 문서 ${index}`,
            relativePath: `concepts/required-${index}.md`,
            content: `# 필수 문서 ${index}\n\n${'가'.repeat(2_000)}`,
            contextMode: 'always',
        }))

        const result = inquireMarkdownDocuments({
            currentInput: '계속 진행한다.',
            documents,
        })
        expect(result.sources.length).toBeGreaterThan(0)
        expect(result.sources.length).toBeLessThan(documents.length)
        expect(result.metrics.selectedTokens).toBeLessThanOrEqual(6_000)
    })

    test('does not replace mandatory context with one semantically matched passage', () => {
        const content = '## Rules\n\n### Binding rules\nMagic always requires a spoken oath.\n\n### Anecdote\nA merchant sold a blue ribbon.'
        const required = document({ id: 'rules', title: 'Rules', type: 'concept', relativePath: 'concepts/rules.md', content, contextMode: 'always' })
        const result = inquireMarkdownDocuments({
            currentInput: 'The merchant smiles.', documents: [required],
            semanticMatches: [{ documentId: required.id, contentHash: required.contentHash, score: 0.9,
                start: content.indexOf('A merchant'), end: content.length }],
        })
        expect(result.sources[0].content).toContain('Magic always requires a spoken oath.')
    })

    test('uses request budgets without changing retrieval relevance', () => {
        const result = inquireMarkdownDocuments({
            currentInput: '필수 설정을 확인한다.',
            tokenBudget: { target: 256, maximum: 512 },
            documents: [document({
                id: 'required', type: 'concept', title: '필수 설정',
                relativePath: 'concepts/required.md',
                content: `# 필수 설정\n\n${'가'.repeat(300)}`,
                contextMode: 'always',
            })],
        })

        expect(result.sources).toHaveLength(1)
        expect(result.metrics.selectedTokens).toBeGreaterThan(256)
        expect(result.metrics.selectedTokens).toBeLessThanOrEqual(512)
    })

    test('falls back to recent conversation terms when the current input has no candidates', () => {
        const result = inquireMarkdownDocuments({
            currentInput: '*says nothing*',
            fallbackInput: '하니아는 침수된 도서관에서 은빛 열쇠를 들었다.',
            documents: [document({
                id: 'flooded-library',
                type: 'location',
                title: '침수된 도서관',
                relativePath: 'locations/flooded-library.md',
                content: '# 침수된 도서관\n\n하니아가 은빛 열쇠를 발견한 장소다.',
            })],
        })

        expect(result.sources.map((source) => source.id)).toContain(
            'narrative-memory:wiki:locations/flooded-library.md'
        )
        expect(result.metrics.candidateCount).toBe(1)
    })

    test('still falls back to recent conversation terms while a scene document is pinned', () => {
        const scene = document({
            id: 'scene', type: 'scene', title: '현재 장면', relativePath: 'current-scene.md',
            content: '# 현재 장면\n\n비가 내리는 저녁.', contextMode: 'always',
        })
        const result = inquireMarkdownDocuments({
            currentInput: '*고개를 끄덕인다*',
            fallbackInput: '하니아는 침수된 도서관에서 은빛 열쇠를 들었다.',
            documents: [scene, document({
                id: 'flooded-library',
                type: 'location',
                title: '침수된 도서관',
                relativePath: 'locations/flooded-library.md',
                content: '# 침수된 도서관\n\n하니아가 은빛 열쇠를 발견한 장소다.',
            })],
        })

        expect(result.sources.map((source) => source.id)).toContain(
            'narrative-memory:wiki:locations/flooded-library.md'
        )
    })

    test('keeps the two best lexical original matches without a history keyword', () => {
        const match = (messageId: string, score: number, content: string) => ({
            messageId, role: 'assistant' as const, content, score, occurredAt: Number(messageId.slice(-1)),
        })
        const result = inquireMarkdownDocuments({
            documents: [],
            currentInput: '은빛 반지를 바라본다.',
            sourceMatches: [
                match('turn-1', 4.2, '은빛 반지에는 비밀 장부의 위치가 새겨져 있다.'),
                match('turn-2', 3.1, '은빛 반지를 하니아에게 건넸다.'),
                match('turn-3', 2.5, '반지를 닦았다.'),
                match('turn-4', 0.4, '그는 바라보았다.'),
            ],
            tokenBudget: { target: 1024, events: 512, perSource: 256, maximum: 2048 },
        })
        const picked = (messageId: string) => result.sources.some((source) =>
            source.id.startsWith(`narrative-memory:source:${messageId}:`))
        expect(picked('turn-1')).toBe(true)
        expect(picked('turn-2')).toBe(true)
        expect(picked('turn-3')).toBe(false)
        expect(picked('turn-4')).toBe(false)
    })

    test('does not use recent conversation fallback for a long unmatched query', () => {
        const result = inquireMarkdownDocuments({
            currentInput: 'unmatched deliberate request '.repeat(8),
            fallbackInput: '침수된 도서관',
            documents: [document({
                id: 'flooded-library',
                type: 'location',
                title: '침수된 도서관',
                relativePath: 'locations/flooded-library.md',
                content: '# 침수된 도서관',
            })],
        })

        expect(result.sources).toEqual([])
        expect(result.metrics.candidateCount).toBe(0)
    })

    describe('trimming a canon document that does not fit', () => {
        const marker = '[Partial canon excerpt trimmed to fit the memory budget; omitted parts are not evidence of absence]\n'
        const encoder = get_encoding('cl100k_base')
        const tokens = (value: string) => encoder.encode(value).length
        const canon = (name: string) => {
            const lines = [`## ${name}`, '', '### 현재 상태', '', `- ${name}는 역 대합실에서 비를 피하고 있다.`, '', '### 지식과 비밀', '']
            for (let index = 1; tokens(lines.join('\n')) < 900; index += 1) {
                lines.push(`- ${name}는 마을 규칙 ${index}을 알고 있다.`)
            }
            return lines.join('\n')
        }
        const documents = ['미오', '하루'].map((name, index) => document({
            id: `character.${index}`, type: 'character', title: name,
            relativePath: `characters/${index}.md`, content: canon(name),
        }))
        const isSource = (source: { id: string }) => source.id.startsWith('narrative-memory:source:')

        test('gives each named page a share of the page lane and trims the last to what is left', () => {
            const input = { documents, currentInput: '미오와 하루가 함께 걷는다.' }
            // A 1,200-token lane holds pages of at most 512 tokens, so both characters fit.
            const shared = inquireMarkdownDocuments({
                ...input, tokenBudget: { target: 1200, events: 256, perSource: 1000, maximum: 3000 },
            })
            expect(shared.sources).toHaveLength(2)
            for (const source of shared.sources) {
                expect(source.tokens).toBeLessThanOrEqual(512)
                expect(source.content).toContain('### 현재 상태')
            }
            expect(shared.metrics.selectedTokens).toBeLessThanOrEqual(1200)

            const tight = inquireMarkdownDocuments({
                ...input, tokenBudget: { target: 1000, events: 256, perSource: 1000, maximum: 3000 },
            })
            expect(tight.sources).toHaveLength(2)
            const [first, second] = tight.sources
            expect(first.content.startsWith('[Partial canon excerpt')).toBe(false)
            expect(second.content.startsWith(marker)).toBe(true)
            expect(second.content).toContain('### 현재 상태')
            expect(second.tokens).toBe(tokens(second.content))
            expect(second.tokens).toBeLessThanOrEqual(1000 - first.tokens)

            // Less than 256 tokens of room is not worth a fragment.
            const tiny = inquireMarkdownDocuments({
                ...input, tokenBudget: { target: 700, events: 256, perSource: 1000, maximum: 3000 },
            })
            expect(tiny.sources).toHaveLength(1)
        })

        test('original evidence uses the rest of the cap and never takes room from pages', () => {
            const input = {
                documents, currentInput: '미오와 하루, 그때 무슨 말을 했는지 자세히 떠올려 줘.',
                sourceMatches: [{
                    messageId: 'assistant-3', role: 'assistant' as const, score: 5, occurredAt: 3,
                    content: '미오는 북문 앞에서 하루에게 약속을 지키겠다고 말했다. '.repeat(3).trim(),
                }],
            }
            const result = inquireMarkdownDocuments({
                ...input, tokenBudget: { target: 1100, events: 256, perSource: 1000, maximum: 1600 },
            })
            const evidence = result.sources.filter(isSource)
            const pages = result.sources.filter((source) => !isSource(source))
            expect(evidence).toHaveLength(1)
            expect(pages).toHaveLength(2)
            expect(pages.reduce((sum, source) => sum + source.tokens, 0)).toBeLessThanOrEqual(1100)
            expect(result.metrics.selectedTokens).toBeLessThanOrEqual(1600)

            // With no room left under the cap, the pages stay and the evidence is left out.
            const full = inquireMarkdownDocuments({
                ...input, tokenBudget: { target: 1100, events: 256, perSource: 1000, maximum: 1050 },
            })
            expect(full.sources.filter(isSource)).toHaveLength(0)
            expect(full.sources.filter((source) => !isSource(source)).length).toBeGreaterThan(0)
        })
    })
})

describe('inquiry timeline', () => {
    const documents = ([
        ['omelet', '오므라이스 식사', 'a1'],
        ['sleep', '테이블에서 잠듦', 'a2'],
        ['wake', '잠에서 깸', 'a3'],
        ['toast', '토스트 아침 식사', 'a4'],
    ] as const).map(([id, title, source]) => document({
        id, type: 'event', title, relativePath: `events/${id}.md`,
        content: `## ${title}\n\n### 이야기 요약\n\n- ${title}.`, sourceMessageIds: [source],
    }))
    const timeline = { messages: [
        { chatId: 'u1', role: 'user' }, { chatId: 'a1', role: 'char' },
        { chatId: 'u2', role: 'user' }, { chatId: 'a2', role: 'char' },
        { chatId: 'u3', role: 'user' }, { chatId: 'a3', role: 'char' },
        { chatId: 'u4', role: 'user' }, { chatId: 'a4', role: 'char' },
    ] as const }
    const flowOf = (result: ReturnType<typeof inquireMarkdownDocuments>) =>
        result.sources.find((source) => source.id === 'narrative-memory:recent-flow')

    test('adds the ordered story flow before the recent transcript', () => {
        const result = inquireMarkdownDocuments({
            contextSelection: 'auto', currentInput: '카요가 하품했다.', documents, timeline,
        })
        const flow = flowOf(result)!
        expect(result.sources[0]).toBe(flow)
        expect(flow.displayName).toBe('직전 흐름')
        expect(flow.content.split('\n')).toEqual([
            'Story flow before the recent transcript (oldest first; the recent transcript continues after the last item):',
            '- [4 turns before] 오므라이스 식사',
            '- [3 turns before] 테이블에서 잠듦',
            '- [2 turns before] 잠에서 깸',
            '- [1 turn before] 토스트 아침 식사',
        ])
        expect(result.metrics.selectedTokens).toBeGreaterThanOrEqual(flow.tokens)
    })

    test('labels a selected event with its distance from the recent transcript', () => {
        const result = inquireMarkdownDocuments({
            contextSelection: 'auto', currentInput: '토스트 아침 식사를 자세히 떠올려 줘.', documents, timeline,
        })
        const toast = result.sources.find((source) =>
            source.id === 'narrative-memory:wiki:events/toast.md')!
        expect(toast.content.startsWith('[1 turn before the recent transcript]\n')).toBe(true)
    })

    test('keeps two events from one turn and ignores events outside the timeline', () => {
        const extra = document({ id: 'toast-2', type: 'event', title: '마멀레이드 대화',
            relativePath: 'events/toast-2.md', content: '## 마멀레이드 대화', sourceMessageIds: ['a4'] })
        const older = document({ id: 'older', type: 'event', title: '정류장 만남',
            relativePath: 'events/older.md', content: '## 정류장 만남', sourceMessageIds: ['a0'] })
        const lines = flowOf(inquireMarkdownDocuments({
            contextSelection: 'auto', currentInput: '카요', documents: [...documents, extra, older], timeline,
        }))!.content.split('\n')
        expect(lines.slice(-2)).toEqual([
            '- [1 turn before] 토스트 아침 식사',
            '- [1 turn before] 마멀레이드 대화',
        ])
        expect(lines.join('\n')).not.toContain('정류장 만남')
    })

    test('ranks an event just outside the recent transcript above an equally matching older one', () => {
        const recent = document({ id: 'recent', type: 'event', title: '정원 산책', updated: '2026-08-01T00:00:00.000Z',
            relativePath: 'events/recent.md', content: '## 정원 산책\n\n카요가 장미를 꺾었다.', sourceMessageIds: ['a4'] })
        const older = document({ id: 'older', type: 'event', title: '정원 산책', updated: '2026-09-01T00:00:00.000Z',
            relativePath: 'events/older.md', content: '## 정원 산책\n\n카요가 장미를 꺾었다.', sourceMessageIds: ['a0'] })
        const priorityOf = (result: ReturnType<typeof inquireMarkdownDocuments>, id: string) =>
            result.sources.find((source) => source.id === `narrative-memory:wiki:events/${id}.md`)?.priority ?? -1

        const withTimeline = inquireMarkdownDocuments({
            contextSelection: 'auto', currentInput: '장미를 꺾은 정원 산책', documents: [older, recent], timeline,
        })
        expect(priorityOf(withTimeline, 'recent')).toBeGreaterThan(priorityOf(withTimeline, 'older'))
        expect(priorityOf(withTimeline, 'older')).toBeGreaterThan(0)

        const withoutTimeline = inquireMarkdownDocuments({
            contextSelection: 'auto', currentInput: '장미를 꺾은 정원 산책', documents: [older, recent],
        })
        expect(priorityOf(withoutTimeline, 'recent')).toBe(priorityOf(withoutTimeline, 'older'))
    })

    test('guarantees the newest events for a current-state question that matches no event', () => {
        const result = inquireMarkdownDocuments({
            contextSelection: 'auto', currentInput: '지금 카요는 어디에 있어?', documents, timeline,
        })
        const ids = result.sources.map((source) => source.id)
        expect(ids).toContain('narrative-memory:wiki:events/toast.md')
        expect(ids).toContain('narrative-memory:wiki:events/wake.md')
        expect(ids).not.toContain('narrative-memory:wiki:events/sleep.md')
        expect(ids).not.toContain('narrative-memory:wiki:events/omelet.md')
        // Without a timeline nothing is recent, so a current-state question still skips events.
        const plain = inquireMarkdownDocuments({
            contextSelection: 'auto', currentInput: '지금 카요는 어디에 있어?', documents,
        })
        expect(plain.sources.filter((source) => source.id.includes('/events/'))).toEqual([])
    })

    test('does not pull unmatched recent events into an ordinary query', () => {
        const result = inquireMarkdownDocuments({
            contextSelection: 'auto', currentInput: '카요가 하품했다.', documents, timeline,
        })
        expect(result.sources.filter((source) => source.id.includes('/events/'))).toEqual([])
    })

    test('omits the flow without a timeline and keeps only the newest items in a tiny budget', () => {
        expect(flowOf(inquireMarkdownDocuments({
            contextSelection: 'auto', currentInput: '카요', documents,
        }))).toBeUndefined()
        const tiny = flowOf(inquireMarkdownDocuments({
            contextSelection: 'auto', currentInput: '카요', documents, timeline,
            tokenBudget: { target: 256, maximum: 256 },
        }))
        expect(tiny?.tokens ?? 0).toBeLessThanOrEqual(64)
        if (tiny) {
            expect(tiny.content).toContain('토스트 아침 식사')
            expect(tiny.content).not.toContain('오므라이스 식사')
        }
    })
})
