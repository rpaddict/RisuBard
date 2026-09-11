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
})
