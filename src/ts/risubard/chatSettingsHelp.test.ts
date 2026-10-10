import { describe, expect, test } from 'vitest'
import {
    buildRisuBardChatSettingHelp,
    measureRisuBardChat,
} from './chatSettingsHelp'

describe('BardWiki current-chat setting help', () => {
    test('measures only active story messages', () => {
        const profile = measureRisuBardChat([
            { role: 'user', data: '1234' },
            { role: 'char', data: '123456' },
            { role: 'char', data: 'ignored', disabled: true },
            { role: 'user', data: 'ignored', isComment: true },
        ])

        expect(profile).toEqual({
            messageCount: 2,
            turnCount: 1,
            averageCharacters: 5,
        })
    })

    test('recommends a smaller response window for long messages', () => {
        const profile = measureRisuBardChat(Array.from(
            { length: 120 },
            (_, index) => ({
                role: index % 2 === 0 ? 'user' as const : 'char' as const,
                data: '가'.repeat(1_200),
            }),
        ))
        const help = buildRisuBardChatSettingHelp(
            'risuBardResponseMessageCount',
            profile,
        )

        expect(help).toContain('현재 챗: 60턴 · 메시지 평균 1,200자')
        expect(help).toContain('기본 절약값은 4개')
        expect(help).toContain('2~3개')
    })

    test('explains the three memory budget tiers and that edited values mean custom', () => {
        const help = buildRisuBardChatSettingHelp(
            'risuBardMemoryBudgetPreset',
            measureRisuBardChat([]),
        )

        expect(help).toContain('절약(검색 목표 3,000, 최대 5,500)')
        expect(help).toContain('보통(검색 목표 4,000, 최대 7,500)')
        expect(help).toContain('넉넉(검색 목표 6,000, 최대 10,500)')
        expect(help).toContain('값을 하나라도 직접 고치면 커스텀이 됩니다')
    })

    test.each([
        ['risuBardInquiryTargetTokenBudget', '절약 3,000, 보통 4,000, 넉넉 6,000', '넉넉을 고르세요'],
        ['risuBardInquiryEventTokenBudget', '절약 2,000, 보통 3,000, 넉넉 4,000', '넉넉을 고르세요'],
        ['risuBardInquirySourceTokenBudget', '절약 1,500, 보통 2,000, 넉넉 2,500', '넉넉을 고르세요'],
        ['risuBardInquiryMaximumTokenBudget', '절약 5,500, 보통 7,500, 넉넉 10,500', '최근 흐름 400을 더한 값'],
    ] as const)('points the %s recommendation to the tiers instead of the old defaults', (key, tiers, advice) => {
        const profile = measureRisuBardChat(Array.from(
            { length: 120 },
            (_, index) => ({
                role: index % 2 === 0 ? 'user' as const : 'char' as const,
                data: '가'.repeat(1_200),
            }),
        ))
        for (const current of [profile, measureRisuBardChat([])]) {
            const help = buildRisuBardChatSettingHelp(key, current)
            expect(help).toContain(tiers)
            expect(help).toContain(advice)
            expect(help).not.toContain('현재 규모에는')
        }
    })

    test('names the dynamic mode that each tier uses', () => {
        const help = buildRisuBardChatSettingHelp('risuBardDynamicMemoryMode', measureRisuBardChat([]))
        expect(help).toContain('절약과 보통 프리셋은 절약형, 넉넉 프리셋은 균형형')
    })

    test('explains long canonical section handling in the analysis token help', () => {
        const help = buildRisuBardChatSettingHelp(
            'risuBardAnalysisTokenLimit',
            measureRisuBardChat([]),
        )

        expect(help).toContain('4,000자 고정 상한이 없습니다')
        expect(help).toContain('공급자가 출력 한도 종료를 보고')
        expect(help).toContain('저장하지 않고 재시도')
    })
})
