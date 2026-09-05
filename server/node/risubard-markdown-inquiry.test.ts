import { describe, expect, test } from 'vitest'
import type { MarkdownWikiDocument } from './risubard-markdown-wiki'
import { inquireMarkdownDocuments } from './risubard-markdown-inquiry'

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
        })

        expect(result.metrics.candidateCount).toBeLessThanOrEqual(64)
        expect(result.metrics.inspectedEdgeCount).toBeLessThanOrEqual(256)
        expect(result.sources.length).toBeLessThanOrEqual(12)
        expect(result.sources.every((source) =>
            source.content.length <= 2_000)).toBe(true)
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

    test('keeps linked characters for explicit relationship questions', () => {
        const result = inquireMarkdownDocuments({
            currentInput: '리리아와 연결된 인물은 누구인가?',
            documents: [
                document({
                    id: 'lelia', type: 'character', title: '리리아',
                    relativePath: 'characters/lelia.md',
                    content: '# 리리아\n\n[[부리 마스크 간수]] [[하니아]]와 연결되어 있다.',
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

    test('counts Korean text against the token budget instead of a character heuristic', () => {
        const documents = Array.from({ length: 4 }, (_, index) => document({
            id: `required-${index}`,
            type: 'concept',
            title: `필수 문서 ${index}`,
            relativePath: `concepts/required-${index}.md`,
            content: `# 필수 문서 ${index}\n\n${'가'.repeat(2_000)}`,
            contextMode: 'always',
        }))

        expect(() => inquireMarkdownDocuments({
            currentInput: '계속 진행한다.',
            documents,
        })).toThrow('Required wiki context exceeds token budget')
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

    test('retrieves Japanese documents from clause queries via particle stripping', () => {
        const result = inquireMarkdownDocuments({
            currentInput: '校則データベースでクリットリングを確認した。',
            documents: [document({
                id: 'rules', type: 'concept', title: '校則データベース',
                relativePath: 'concepts/rules.md',
                content: '## 校則データベース\n\n第三章にクリットリングの規定がある。',
            })],
        })

        expect(result.sources.map((source) => source.id)).toEqual([
            'narrative-memory:wiki:concepts/rules.md',
        ])
    })

    test('prefers ja current-state sections for ja state queries', () => {
        const result = inquireMarkdownDocuments({
            currentInput: 'シロの現在の状態は？',
            documents: [document({
                id: 'shiro', type: 'character', title: 'シロ',
                relativePath: 'characters/shiro.md',
                content: [
                    '## シロ',
                    '',
                    '### 現在の状態',
                    '',
                    '- 学園の新入生。',
                    '',
                    '### 作中行動',
                    '',
                    `- ${'古い記録 '.repeat(200)}`,
                ].join('\n'),
            })],
        })

        expect(result.sources).toHaveLength(1)
        expect(result.sources[0]?.content).toContain('### 現在の状態')
        expect(result.sources[0]?.content).toContain('学園の新入生')
    })
})
