import { describe, expect, test } from 'vitest'
import { countStoryReplies, isStoryReply, shouldKeepLatestReply } from './historyBudget'

const reply = (id: string) => ({ role: 'assistant', memo: id })
const input = { role: 'user', memo: 'input' }

describe('history budget', () => {
    test('counts replies from the chat log only', () => {
        const messages = [
            { role: 'system', memo: 'NewChatExample' },
            { role: 'assistant' }, // example or greeting
            { role: 'system', memo: 'NewChat' },
            reply('a'),
            reply('b'),
            input,
        ]
        expect(isStoryReply(messages[1])).toBe(false)
        expect(countStoryReplies(messages)).toBe(2)
    })

    test('keeps the latest reply while the overflow fits half the output reservation', () => {
        expect(shouldKeepLatestReply([reply('b'), input], 76, 16_384)).toBe(true)
        expect(shouldKeepLatestReply([reply('b'), input], 8_192, 16_384)).toBe(true)
        expect(shouldKeepLatestReply([reply('b'), input], 8_193, 16_384)).toBe(false)
    })

    test('drops older replies first', () => {
        expect(shouldKeepLatestReply([reply('a'), reply('b'), input], 10, 16_384)).toBe(false)
        expect(shouldKeepLatestReply([{ role: 'system', memo: 'NewChat' }, reply('b'), input], 10, 16_384)).toBe(false)
        expect(shouldKeepLatestReply([input], 10, 16_384)).toBe(false)
    })
})
