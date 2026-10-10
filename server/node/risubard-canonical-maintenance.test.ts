import { describe, expect, test, vi } from 'vitest'
import {
    applyMaintenanceResponse,
    buildMaintenanceRequest,
    cardMaintenanceDue,
    coverSupportsUnit,
    maintainCharacterCanon,
    maintenanceCoverDocuments,
} from './risubard-canonical-maintenance'

const knowledgeUnits = Array.from({ length: 14 }, (_, index) => `마을 규칙 ${index + 1}을 [[하루]]에게 들었다.`)
const markdown = [
    '## 미오', '',
    '### 인물 핵심', '', '- 우산을 든 소녀.', '',
    '### 현재 상태', '', '- 역 대합실에 있다.', '',
    '### 관계와 신뢰', '', `[[하루]]: ${'함께 걸었다. '.repeat(70).trim()}`, '',
    '### 지식과 비밀', '', ...knowledgeUnits.map((unit) => `- ${unit}`),
].join('\n')
const disposition = (role: string, old: number, action: string, extra: Record<string, unknown> = {}) => ({
    role, old, action, newIndex: null, moveTo: null, movedText: null, documentId: null, ...extra,
})
const chars = (value: string) => [...value].length
const dueInput = { countTokens: chars, perSourceTokens: 400 }
const card = [
    '## 미오', '',
    '### 인물 핵심', '', '- 우산을 든 소녀.', '',
    '### 현재 상태', '', '- 역 대합실에 있다.', '',
    '### 관계와 신뢰', '', '- [[하루]]: 함께 걷는 동행.', '',
    '### 지식과 비밀', '', '- 북문은 새벽에 열린다고 [[하루]]에게 들었다.', '',
    '### 주요 전환', '',
    '- 처음에는 [[하루]]를 경계하며 거리를 두었다.',
    '- 이후 [[산책]] 뒤에 조금씩 마음을 열고 말을 걸기 시작했다.',
    '- 마침내 [[북문 약속]] 이후 하루를 동료로 받아들였다.', '',
    '### 장비와 소지품', '',
    '- 낡은 우산을 가지고 있다. 살이 하나 부러졌다.',
    '- 낡은 우산을 챙겨 다니며 비 오는 날 쓴다. 지금은 살이 하나 부러져 있다.',
    '- 놋쇠 열쇠. 북문 자물쇠에 맞는다.',
].join('\n')
const walkBody = '- 마을 규칙 11을 [[하루]]에게 들었다.'
const coverContents = new Map([['event.walk', walkBody]])
const prepare = () => buildMaintenanceRequest({
    markdown, title: '미오', roles: ['knowledge', 'relationships'],
    coverDocuments: [{ id: 'event.walk', title: '산책' }], policy: '',
})
const apply = (response: unknown) => applyMaintenanceResponse({
    markdown, title: '미오', text: typeof response === 'string' ? response : JSON.stringify(response),
    sections: prepare().sections, coverContents,
})

describe('canonical maintenance', () => {
    test('is due only near the retrieval ceiling or after outgrowing the last baseline', () => {
        expect(cardMaintenanceDue({ tokens: 1700, perSourceTokens: 2000 })).toBe(true)
        expect(cardMaintenanceDue({ tokens: 1500, perSourceTokens: 2000 })).toBe(false)
        expect(cardMaintenanceDue({ tokens: 1700, perSourceTokens: 2000, baselineTokens: 1500 })).toBe(false)
        expect(cardMaintenanceDue({ tokens: 1900, perSourceTokens: 2000, baselineTokens: 1500 })).toBe(true)
        expect(cardMaintenanceDue({ tokens: 1700, perSourceTokens: 2000, baselineTokens: 1000 })).toBe(true)
    })

    test('does not call the model while the card is not due', async () => {
        const request = vi.fn()
        expect(await maintainCharacterCanon({
            markdown, title: '미오', coverDocuments: [], policy: '', countTokens: chars, perSourceTokens: 4000, request,
        })).toEqual({ attempted: false })
        expect(await maintainCharacterCanon({
            markdown, title: '미오', coverDocuments: [], policy: '', ...dueInput, baselineTokens: chars(markdown), request,
        })).toEqual({ attempted: false })
        expect(await maintainCharacterCanon({
            markdown: '## 미오\n\n### 현재 상태\n\n- 집.', title: '미오', coverDocuments: [], policy: '', ...dueInput, request,
        })).toEqual({ attempted: false })
        expect(request).not.toHaveBeenCalled()
    })

    test('sends every present maintained section and merges transitions and equipment', async () => {
        const prompts: Array<{ role: string; heading: string }[]> = []
        const result = await maintainCharacterCanon({
            markdown: card, title: '미오', coverDocuments: [], policy: '', ...dueInput,
            request: async (prompt) => {
                prompts.push(JSON.parse(prompt.input).sections)
                return JSON.stringify({
                    sections: [
                        { role: 'transitions', units: ['[[하루]]를 경계하다 [[산책]] 뒤에 마음을 열었다.'] },
                        { role: 'equipment', units: ['낡은 우산: 살이 하나 부러졌다.', '놋쇠 열쇠: 북문 자물쇠에 맞는다.'] },
                    ],
                    dispositions: [
                        disposition('transitions', 0, 'merged', { newIndex: 0 }),
                        disposition('transitions', 1, 'merged', { newIndex: 0 }),
                        disposition('transitions', 2, 'merged', { newIndex: 0 }),
                        disposition('equipment', 0, 'merged', { newIndex: 0 }),
                        disposition('equipment', 1, 'merged', { newIndex: 0 }),
                        disposition('equipment', 2, 'kept', { newIndex: 1 }),
                    ],
                })
            },
        })
        expect(prompts[0].map((section) => [section.role, section.heading])).toEqual([
            ['knowledge', '지식과 비밀'], ['relationships', '관계와 신뢰'],
            ['transitions', '주요 전환'], ['equipment', '장비와 소지품'],
        ])
        expect(result).toMatchObject({ attempted: true, outcome: 'applied', tokensBefore: chars(card) })
        expect(result.tokensAfter).toBe(chars(result.markdown!))
        expect(result.note).toBe(`정본 정리: 미오 주요 전환 압축, 장비와 소지품 압축 (${chars(card)}→${result.tokensAfter}토큰)`
            + ' (근거를 확인하지 못한 1항목은 그대로 두었습니다)')
        // The merge dropped the [[북문 약속]] link, so that unit stays beside the merged one.
        expect(result.markdown).toContain([
            '### 주요 전환', '',
            '- [[하루]]를 경계하다 [[산책]] 뒤에 마음을 열었다.',
            '- 마침내 [[북문 약속]] 이후 하루를 동료로 받아들였다.',
        ].join('\n'))
        expect(result.markdown).toContain('### 장비와 소지품\n\n- 낡은 우산: 살이 하나 부러졌다.\n- 놋쇠 열쇠: 북문 자물쇠에 맞는다.')
        expect(result.markdown).toContain('### 인물 핵심\n\n- 우산을 든 소녀.')
    })

    test('reports no reduction and keeps the document when the rewrite saves less than a tenth', async () => {
        const result = await maintainCharacterCanon({
            markdown, title: '미오', coverDocuments: [], policy: '', ...dueInput,
            request: async () => JSON.stringify({
                sections: [{ role: 'knowledge', units: ['[[하루]]에게 마을 규칙 1, 2를 들었다.', ...knowledgeUnits.slice(2)] }],
                dispositions: knowledgeUnits.map((_, old) =>
                    disposition('knowledge', old, old < 2 ? 'merged' : 'kept', { newIndex: Math.max(0, old - 1) })),
            }),
        })
        expect(result).toEqual({
            attempted: true, outcome: 'no-reduction', tokensBefore: chars(markdown),
            note: '정본 정리 보류: 미오 (줄일 항목 없음). 문서는 바꾸지 않았습니다.',
        })
    })

    test('works with English headings', async () => {
        const english = ['## Mio', '',
            '### Identity', '', '- A girl with an umbrella.', '',
            '### Current State', '', '- Waits at the station.', '',
            '### Knowledge and Secrets', '', '- Learned from Haru that the north gate opens at dawn.',
            '- Learned from Haru that the north gate stays shut at night.', '',
            '### Major Transitions', '', '- Distrusted [[Haru]] at first.', '- Warmed to [[Haru]] after the walk.', '',
            '### Equipment and Possessions', '', '- An old umbrella with one bent rib.', '- A brass key for the north gate.',
        ].join('\n')
        const sent: string[] = []
        const result = await maintainCharacterCanon({
            markdown: english, title: 'Mio', coverDocuments: [], policy: '', ...dueInput,
            request: async (prompt) => {
                sent.push(...JSON.parse(prompt.input).sections.map((section: { heading: string }) => section.heading))
                return JSON.stringify({
                    sections: [
                        { role: 'knowledge', units: ['North gate: open at dawn, shut at night (from Haru).'] },
                        { role: 'transitions', units: ['Distrusted [[Haru]], then warmed to [[Haru]] after the walk.'] },
                    ],
                    dispositions: [
                        disposition('knowledge', 0, 'merged', { newIndex: 0 }),
                        disposition('knowledge', 1, 'merged', { newIndex: 0 }),
                        disposition('transitions', 0, 'merged', { newIndex: 0 }),
                        disposition('transitions', 1, 'merged', { newIndex: 0 }),
                    ],
                })
            },
        })
        expect(sent).toEqual(['Knowledge and Secrets', 'Major Transitions', 'Equipment and Possessions'])
        expect(result).toMatchObject({ attempted: true, outcome: 'applied' })
        expect(result.note).toContain('Knowledge and Secrets 2→1항목, Major Transitions 압축')
        expect(result.markdown).toContain('### Major Transitions\n\n- Distrusted [[Haru]], then warmed to [[Haru]] after the walk.')
    })

    test('states the card rule without a numeric unit target', () => {
        const { system, schema } = buildMaintenanceRequest({
            markdown: card, title: '미오', roles: ['knowledge'], coverDocuments: [], policy: '',
        })
        expect(system).not.toContain('Aim for at most')
        expect(system).not.toMatch(/at most|\d+ units?/iu)
        expect(system).toContain('current-state card')
        expect(system).toContain('Major Transitions')
        expect(system).toContain('Equipment and Possessions')
        const parsed = JSON.parse(schema)
        expect(parsed.properties.sections.maxItems).toBe(4)
        expect(parsed.properties.dispositions.maxItems).toBe(128 * 4)
        expect(parsed.properties.sections.items.properties.role.enum)
            .toEqual(['knowledge', 'relationships', 'transitions', 'equipment'])
    })

    test('keeps a section as it was when its rewrite is not shorter, dropping its moves too', () => {
        const result = apply({
            sections: [
                { role: 'knowledge', units: knowledgeUnits.map((unit) => `${unit} 더 길게 덧붙였다.`) },
                { role: 'relationships', units: ['[[하루]]: 서로 의지하는 동행.'] },
            ],
            dispositions: [
                ...knowledgeUnits.map((_, old) => old === 11
                    ? disposition('knowledge', old, 'moved', { moveTo: 'currentState', movedText: '규칙 12에 따라 대합실에 머문다.' })
                    : disposition('knowledge', old, 'kept', { newIndex: old })),
                disposition('relationships', 0, 'merged', { newIndex: 0 }),
            ],
        })
        expect(result.counts.map((count) => count.role)).toEqual(['relationships'])
        expect(result.markdown).toContain('### 관계와 신뢰\n\n[[하루]]: 서로 의지하는 동행.')
        expect(result.markdown).toContain(knowledgeUnits.map((unit) => `- ${unit}`).join('\n'))
        expect(result.markdown).not.toContain('규칙 12에 따라')
    })

    test('merges, moves and covers verified units and keeps the rest verbatim', () => {
        const result = apply({
            sections: [
                { role: 'knowledge', units: ['[[하루]]에게 마을 규칙 1~10을 들었다.'] },
                { role: 'relationships', units: ['[[하루]]: 서로 의지하는 동행.'] },
            ],
            dispositions: [
                ...Array.from({ length: 10 }, (_, old) => disposition('knowledge', old, 'merged', { newIndex: 0 })),
                disposition('knowledge', 10, 'covered', { documentId: 'event.walk' }),
                disposition('knowledge', 11, 'moved', { moveTo: 'currentState', movedText: '규칙 12에 따라 대합실에 머문다.' }),
                disposition('relationships', 0, 'merged', { newIndex: 0 }),
            ],
        })
        expect(result.restored).toBe(2)
        expect(result.markdown).toContain([
            '### 지식과 비밀', '',
            '- [[하루]]에게 마을 규칙 1~10을 들었다.',
            '- 마을 규칙 13을 [[하루]]에게 들었다.',
            '- 마을 규칙 14을 [[하루]]에게 들었다.',
        ].join('\n'))
        expect(result.markdown).toContain('### 현재 상태\n\n- 역 대합실에 있다.\n- 규칙 12에 따라 대합실에 머문다.')
        expect(result.markdown).toContain('### 관계와 신뢰\n\n[[하루]]: 서로 의지하는 동행.')
        expect(result.counts).toContainEqual({ role: 'knowledge', heading: '지식과 비밀', before: 14, after: 3 })
    })

    test('appends moved text to the original destination body without reformatting it', () => {
        const source = markdown.replace('- 역 대합실에 있다.', '* 역 대합실에 있다.\n\n보충 문단.')
        const request = buildMaintenanceRequest({
            markdown: source, title: '미오', roles: ['knowledge'], coverDocuments: [], policy: '',
        })
        const result = applyMaintenanceResponse({
            markdown: source, title: '미오', sections: request.sections, coverContents: new Map(),
            text: JSON.stringify({
                sections: [{ role: 'knowledge', units: ['[[하루]]에게 마을 규칙을 들었다.'] }],
                dispositions: knowledgeUnits.map((_, old) => old === 11
                    ? disposition('knowledge', old, 'moved', { moveTo: 'currentState', movedText: '규칙 12에 따라 머문다.' })
                    : disposition('knowledge', old, 'merged', { newIndex: 0 })),
            }),
        })
        expect(result.markdown).toContain('### 현재 상태\n\n* 역 대합실에 있다.\n\n보충 문단.\n- 규칙 12에 따라 머문다.')
    })

    test('restores a covered unit whose links appear nowhere else', () => {
        const source = markdown.replace('마을 규칙 11을 [[하루]]에게 들었다.', '[[유키]]에게 비밀을 들었다.')
        const body = '- [[유키]]에게 비밀을 들었다.'
        expect(coverSupportsUnit('[[유키]]에게 비밀을 들었다.', body)).toBe(true)
        const request = buildMaintenanceRequest({
            markdown: source, title: '미오', roles: ['knowledge'],
            coverDocuments: [{ id: 'event.walk', title: '산책' }], policy: '',
        })
        const result = applyMaintenanceResponse({
            markdown: source, title: '미오', sections: request.sections,
            coverContents: new Map([['event.walk', body]]),
            text: JSON.stringify({
                sections: [{ role: 'knowledge', units: ['[[하루]]에게 마을 규칙을 들었다.'] }],
                dispositions: knowledgeUnits.map((_, old) => old === 10
                    ? disposition('knowledge', old, 'covered', { documentId: 'event.walk' })
                    : disposition('knowledge', old, 'merged', { newIndex: 0 })),
            }),
        })
        expect(result.restored).toBe(1)
        expect(result.markdown).toContain('- [[유키]]에게 비밀을 들었다.')
    })

    test('drops proposed units that no old unit points to', () => {
        const result = apply({
            sections: [{ role: 'knowledge', units: ['[[하루]]에게 규칙 전부를 들었다.', '하루는 사실 유령이다.'] }],
            dispositions: knowledgeUnits.map((_, old) => disposition('knowledge', old, 'merged', { newIndex: 0 })),
        })
        expect(result.markdown).toContain('### 지식과 비밀\n\n- [[하루]]에게 규칙 전부를 들었다.')
        expect(result.markdown).not.toContain('유령')
    })

    test('keeps everything when dispositions name unknown documents, lose links or do not shrink', () => {
        const unknownCover = apply({
            sections: [{ role: 'knowledge', units: [] }],
            dispositions: knowledgeUnits.map((_, old) => disposition('knowledge', old, 'covered', { documentId: 'event.unknown' })),
        })
        const lostLink = apply({
            sections: [{ role: 'relationships', units: ['하루: 서로 의지하는 동행.'] }],
            dispositions: [disposition('relationships', 0, 'merged', { newIndex: 0 })],
        })
        const invalid = apply('not json')
        for (const [result, reason] of [
            [unknownCover, 'no-reduction'], [lostLink, 'no-reduction'], [invalid, 'invalid-response'],
        ] as const) {
            expect(result.markdown).toBeUndefined()
            expect(result.reason).toBe(reason)
        }
    })

    test('offers only overlapping events and linked canon as cover documents', () => {
        expect(maintenanceCoverDocuments(
            { content: markdown, sourceMessageIds: ['m1'] },
            [
                { id: 'event.walk', type: 'event', title: '산책', sourceMessageIds: ['m1'] },
                { id: 'event.other', type: 'event', title: '다른 날', sourceMessageIds: ['m9'] },
                { id: 'character.haru', type: 'character', title: '하루', sourceMessageIds: [] },
                { id: 'event.old', type: 'event', title: '철회', sourceMessageIds: ['m1'], status: 'retracted' },
            ],
        )).toEqual([
            { id: 'event.walk', title: '산책', content: '' },
            { id: 'character.haru', title: '하루', content: '' },
        ])
        expect(maintenanceCoverDocuments(
            { content: markdown, sourceMessageIds: ['m1'] },
            [{ id: 'event.walk', type: 'event', title: '산책', sourceMessageIds: ['m1'], content: walkBody }],
        )).toEqual([{ id: 'event.walk', title: '산책', content: walkBody }])
    })

    test('reports applied, skipped and failed maintenance without throwing', async () => {
        const success = await maintainCharacterCanon({
            markdown, title: '미오', coverDocuments: [{ id: 'event.walk', title: '산책', content: walkBody }], policy: '',
            ...dueInput,
            request: async (prompt) => {
                expect(prompt.system.startsWith('Canonical maintenance:')).toBe(true)
                return JSON.stringify({
                    sections: [{ role: 'knowledge', units: ['[[하루]]에게 마을 규칙을 들었다.'] }],
                    dispositions: knowledgeUnits.map((_, old) => disposition('knowledge', old, 'merged', { newIndex: 0 })),
                })
            },
        })
        expect(success).toMatchObject({
            attempted: true, outcome: 'applied', tokensBefore: chars(markdown),
            note: `정본 정리: 미오 지식과 비밀 14→1항목 (${chars(markdown)}→${chars(success.markdown!)}토큰)`,
        })
        expect(success.tokensAfter).toBe(chars(success.markdown!))
        expect(success.markdown).toContain('- [[하루]]에게 마을 규칙을 들었다.')
        expect(await maintainCharacterCanon({
            markdown, title: '미오', coverDocuments: [], policy: '', ...dueInput,
            request: async () => { throw new Error('provider down') },
        })).toEqual({
            attempted: true, outcome: 'error',
            note: '정본 정리 보류: 미오 (모델 호출 실패). 문서는 바꾸지 않았습니다.',
        })
        expect(await maintainCharacterCanon({
            markdown, title: '미오', coverDocuments: [], policy: '', ...dueInput, request: async () => 'not json',
        })).toEqual({
            attempted: true, outcome: 'error',
            note: '정본 정리 보류: 미오 (응답 형식 오류). 문서는 바꾸지 않았습니다.',
        })
    })

    test('sends only the id and title of cover documents to the model', () => {
        const request = buildMaintenanceRequest({
            markdown, title: '미오', roles: ['knowledge'],
            coverDocuments: [{ id: 'event.walk', title: '산책', content: walkBody }], policy: '',
        })
        expect(JSON.parse(request.input).coverDocuments).toEqual([{ id: 'event.walk', title: '산책' }])
        expect(request.input).not.toContain('content')
        expect(request.input).not.toContain(walkBody)
    })

    test('restores a covered unit unless the document body supports it', () => {
        const respond = (contents: ReadonlyMap<string, string>) => applyMaintenanceResponse({
            markdown, title: '미오', sections: prepare().sections, coverContents: contents,
            text: JSON.stringify({
                sections: [{ role: 'knowledge', units: ['[[하루]]에게 마을 규칙을 들었다.'] }],
                dispositions: knowledgeUnits.map((_, old) => old === 10
                    ? disposition('knowledge', old, 'covered', { documentId: 'event.walk' })
                    : disposition('knowledge', old, 'merged', { newIndex: 0 })),
            }),
        })
        const unsupported = respond(new Map([['event.walk', '- 역 대합실에서 비를 피했다.']]))
        expect(unsupported.restored).toBe(1)
        expect(unsupported.markdown).toContain('- 마을 규칙 11을 [[하루]]에게 들었다.')
        const supported = respond(coverContents)
        expect(supported.restored).toBe(0)
        expect(supported.markdown).not.toContain('마을 규칙 11을')
    })
})

describe('cover support', () => {
    const pajama = '- 사토 렌이 자신이 잠든 사이 젖은 옷을 벗겨 난간에 널고 파자마를 입혀주었음을 확인했다.'

    test('requires the cover body to repeat most of the unit wording', () => {
        expect(coverSupportsUnit(pajama,
            '- 헐렁한 파자마를 입은 카요가 2층 침실에서 계단을 밟고 1층 홀로 조심스럽게 내려왔다.')).toBe(false)
        expect(coverSupportsUnit(pajama,
            '카요는 사토 렌이 자신이 잠든 사이 젖은 옷을 벗겨 난간에 널고 파자마를 입혀주었음을 알았다.')).toBe(true)
        expect(coverSupportsUnit('- 가.', '가 가 가')).toBe(false)
    })
})
