import { describe, expect, test } from 'vitest'
import { groupNarrativeBacklog, narrativeAnalysisDue, withoutRepeatedMessages } from './narrativeBacklogBatch'

const turn = (id: string, length: number) => ({
    targetMessageId: id,
    messages: [{ messageId: id, content: '가'.repeat(length) }],
})

describe('narrative backlog batches', () => {
    test('puts waiting turns that fit half the input limit into one call', () => {
        const turns = [turn('a1', 3_000), turn('a2', 3_000), turn('a3', 3_000)]
        expect(groupNarrativeBacklog(turns, 32_768).map((batch) => batch.map((item) => item.targetMessageId)))
            .toEqual([['a1', 'a2', 'a3']])
    })

    test('starts a new call when the budget or turn cap is reached, keeping order', () => {
        const turns = [turn('a1', 3_000), turn('a2', 3_000), turn('a3', 3_000)]
        expect(groupNarrativeBacklog(turns, 8_192).map((batch) => batch.map((item) => item.targetMessageId)))
            .toEqual([['a1'], ['a2'], ['a3']])
        const many = ['a1', 'a2', 'a3', 'a4', 'a5'].map((id) => turn(id, 10))
        expect(groupNarrativeBacklog(many, 32_768).map((batch) => batch.length)).toEqual([4, 1])
    })

    test('analyzes an oversized turn alone', () => {
        const turns = [turn('a1', 100), turn('a2', 40_000), turn('a3', 100)]
        expect(groupNarrativeBacklog(turns, 32_768).map((batch) => batch.map((item) => item.targetMessageId)))
            .toEqual([['a1'], ['a2'], ['a3']])
    })

    test('keeps a user message shared by two turns only once', () => {
        const turns = [
            { targetMessageId: 'a1', messages: [{ messageId: 'u1' }, { messageId: 'a1' }] },
            { targetMessageId: 'a2', messages: [{ messageId: 'u1' }, { messageId: 'a2' }] },
        ]
        expect(withoutRepeatedMessages(turns).map((item) => item.messages.map((message) => message.messageId)))
            .toEqual([['u1', 'a1'], ['a2']])
    })
})

describe('narrative analysis interval', () => {
    test('waits until the interval worth of turns is queued', () => {
        expect(narrativeAnalysisDue(1, 1)).toBe(true)
        expect(narrativeAnalysisDue(1, 2)).toBe(false)
        expect(narrativeAnalysisDue(2, 2)).toBe(true)
        expect(narrativeAnalysisDue(2, 3)).toBe(false)
        expect(narrativeAnalysisDue(5, 3)).toBe(true)
    })

    test('never waits for more turns than one call can take', () => {
        expect(narrativeAnalysisDue(4, 10)).toBe(true)
        expect(narrativeAnalysisDue(1, 0)).toBe(true)
    })
})
