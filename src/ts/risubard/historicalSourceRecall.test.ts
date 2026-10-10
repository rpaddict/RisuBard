import { describe, expect, test } from 'vitest'
import {
    buildInquiryTimeline,
    findHistoricalSourceMatches,
    resolveHistoricalSourceMatchesById,
    type HistoricalSourceMessage,
} from './historicalSourceRecall'

describe('historical source recall', () => {
    test('uses per-message semantic hints to find late evidence past an early generic title match', () => {
        const tail = 'The secret ledger was delivered to the enemy. The courier wore a silver ring.'
        const data = 'Archive discussed weather. ' + 'Ordinary weather. '.repeat(1000) + tail
        const input = { messageIds: ['old'], currentInput: 'Archive betrayal', excludeRecentMessages: 1,
            messages: [{ role: 'char', chatId: 'old', data }, { role: 'char', chatId: 'recent', data: 'Now' }] }
        expect(resolveHistoricalSourceMatchesById(input)[0].content).not.toContain('silver ring')
        const matches = resolveHistoricalSourceMatchesById({ ...input,
            queryByMessageId: { old: 'Archive\nArchive\nThe secret ledger was delivered to the enemy.' } })
        expect(matches[0].content).toContain('silver ring')
        expect(matches[0].content.length).toBeLessThanOrEqual(1200)
    })

    test('recovers a small early detail from a one-thousand-message chat', () => {
        const currentInput = '샘이 프로도에게 샤이어를 떠나기 전 마지막으로 마신 에일의 맛을 기억하느냐고 묻는다.'
        const messages = Array.from({ length: 1_000 }, (_, index) => ({
            role: index % 2 === 0 ? 'user' as const : 'char' as const,
            data: `중간 여정의 일반적인 대화 ${index}`,
            chatId: `message-${index}`,
        }))
        messages[5] = {
            role: 'char',
            data: '샘과 프로도는 황금빛이 도는 플러피풋의 사과 에일을 마시며 간달프의 불꽃놀이를 감상하고 있었다.',
            chatId: 'shire-ale',
        }
        messages[999] = {
            role: 'user',
            data: currentInput,
            chatId: 'current-input',
        }

        const matches = findHistoricalSourceMatches({
            currentInput,
            messages,
            excludeRecentMessages: 12,
        })

        expect(matches[0]).toMatchObject({
            messageId: 'shire-ale',
            role: 'assistant',
            occurredAt: 5,
        })
        expect(matches[0]?.content).toContain('플러피풋의 사과 에일')
        expect(matches).toHaveLength(1)
        expect(matches.every((match) => match.content.length <= 1_200))
            .toBe(true)
    })

    test('ignores current, recent, disabled, comment, and id-less messages', () => {
        const matches = findHistoricalSourceMatches({
            currentInput: '플러피풋 사과 에일을 기억한다.',
            excludeRecentMessages: 1,
            messages: [
                { role: 'char', data: '플러피풋 사과 에일', chatId: 'old' },
                { role: 'char', data: '플러피풋 사과 에일', chatId: 'disabled', disabled: true },
                { role: 'char', data: '플러피풋 사과 에일', chatId: 'comment', isComment: true },
                { role: 'char', data: '플러피풋 사과 에일' },
                { role: 'char', data: '플러피풋 사과 에일', chatId: 'recent' },
                { role: 'user', data: '플러피풋 사과 에일을 기억한다.', chatId: 'current' },
            ],
        })

        expect(matches.map((match) => match.messageId)).toEqual(['old'])
    })

    test('does not search messages hidden behind an all-before boundary', () => {
        const matches = findHistoricalSourceMatches({
            currentInput: '플러피풋의 사과 에일을 기억한다.',
            excludeRecentMessages: 1,
            messages: [
                { role: 'char', data: '플러피풋의 사과 에일', chatId: 'hidden' },
                { role: 'user', data: '기억을 여기서 초기화한다.', chatId: 'boundary', disabled: 'allBefore' },
                { role: 'char', data: '새로운 여정이 시작됐다.', chatId: 'after' },
                { role: 'user', data: '플러피풋의 사과 에일을 기억한다.', chatId: 'current' },
            ],
        })

        expect(matches).toEqual([])
    })

    test('uses the configured maximum candidate count, including zero', () => {
        const messages = [
            ...Array.from({ length: 10 }, (_, index) => ({
                role: 'char' as const,
                data: `수녀들이 마을 처녀들을 데려간 증언 ${index}`,
                chatId: `evidence-${index}`,
            })),
            { role: 'user' as const, data: '수녀들이 데려간 처녀들', chatId: 'current' },
        ]

        expect(findHistoricalSourceMatches({
            currentInput: '수녀들이 데려간 처녀들',
            messages,
            excludeRecentMessages: 1,
            maximumMatches: 3,
        })).toHaveLength(3)
        expect(findHistoricalSourceMatches({
            currentInput: '수녀들이 데려간 처녀들',
            messages,
            excludeRecentMessages: 1,
            maximumMatches: 0,
        })).toEqual([])
    })

    test('resolves selected event provenance by ID without lexical overlap', () => {
        const matches = resolveHistoricalSourceMatchesById({
            messageIds: ['turn-1', 'turn-4'],
            messages: [
                {
                    role: 'char',
                    data: '촌장은 한 달 전 딸을 포함한 처녀 넷이 사라졌다고 증언했다.',
                    chatId: 'turn-1',
                },
                { role: 'user', data: '교회를 수색한다.', chatId: 'turn-2' },
                {
                    role: 'char',
                    data: '기도실과 본당 어디에도 시신은 없었다.',
                    chatId: 'turn-4',
                },
                { role: 'user', data: '지도에 관해 묻는다.', chatId: 'current' },
            ],
            excludeRecentMessages: 1,
        })

        expect(matches.map((match) => match.messageId)).toEqual(['turn-1'])
        expect(matches[0]?.score).toBeGreaterThan(100)
    })
})

test('builds the inquiry timeline from active messages before the recent transcript', () => {
    const messages = [
        { chatId: 'old', role: 'char', data: 'Before the boundary' },
        { chatId: 'cut', role: 'user', data: 'cut', disabled: 'allBefore' },
        { chatId: 'u1', role: 'user', data: 'One' }, { chatId: 'a1', role: 'char', data: 'Reply one' },
        { chatId: 'u2', role: 'user', data: 'Two' }, { chatId: 'a2', role: 'char', data: 'Reply two' },
        { chatId: 'u3', role: 'user', data: 'Three' }, { chatId: 'a3', role: 'char', data: 'Reply three' },
        { chatId: 'pending', role: 'user', data: 'Now' },
    ] as HistoricalSourceMessage[]
    expect(buildInquiryTimeline(messages, 1)).toEqual({ messages: [
        { chatId: 'u1', role: 'user' }, { chatId: 'a1', role: 'char' },
        { chatId: 'u2', role: 'user' }, { chatId: 'a2', role: 'char' },
    ] })
    expect(buildInquiryTimeline(messages, 1, 3).messages.map((message) => message.chatId))
        .toEqual(['a1', 'u2', 'a2'])
})
