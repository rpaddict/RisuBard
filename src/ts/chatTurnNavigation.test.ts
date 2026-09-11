import { describe, expect, it } from 'vitest'
import type { Message } from './storage/database.svelte'
import {
    buildChatTurnNavigation,
    normalizeChatNavigationTarget,
} from './chatTurnNavigation'

const message = (role: Message['role'], data: string, extra: Partial<Message> = {}): Message => ({
    role,
    data,
    ...extra,
})

describe('chat turn navigation', () => {
    it('numbers only enabled non-comment character responses', () => {
        const navigation = buildChatTurnNavigation([
            message('user', 'u1'),
            message('char', 'a1'),
            message('char', 'comment', { isComment: true }),
            message('char', 'disabled', { disabled: true }),
            message('user', 'u2'),
            message('char', 'a2'),
        ])

        expect(navigation.turnCount).toBe(2)
        expect(navigation.turnByMessageIndex.get(1)).toBe(1)
        expect(navigation.turnByMessageIndex.get(5)).toBe(2)
        expect(navigation.turnByMessageIndex.has(2)).toBe(false)
        expect(navigation.messageIndexByTurn).toEqual([1, 5])
    })

    it('finds the turn at or before a message for the navigator display', () => {
        const navigation = buildChatTurnNavigation([
            message('user', 'u1'),
            message('char', 'a1'),
            message('user', 'u2'),
            message('char', 'a2'),
        ])

        expect(navigation.turnAtOrBeforeMessage(0)).toBe(1)
        expect(navigation.turnAtOrBeforeMessage(2)).toBe(1)
        expect(navigation.turnAtOrBeforeMessage(3)).toBe(2)
    })

    it('numbers assistant responses relative to the selected page and clamps an oversized turn', () => {
        const messages = [
            message('user', 'page 1 user'),
            message('char', 'page 1 assistant'),
            message('user', 'page 2 user 1'),
            message('char', 'page 2 assistant 1'),
            message('char', 'page 2 comment', { isComment: true }),
            message('user', 'page 2 user 2'),
            message('char', 'page 2 assistant 2'),
            message('char', 'page 2 assistant 3'),
            message('user', 'page 3 user'),
        ]

        const navigation = buildChatTurnNavigation(messages, 2, 8)
        const targetTurn = normalizeChatNavigationTarget(7, navigation.turnCount, 1)

        expect(navigation.turnCount).toBe(3)
        expect(navigation.messageIndexByTurn).toEqual([3, 6, 7])
        expect(targetTurn).toBe(3)
        expect(navigation.messageIndexByTurn[targetTurn - 1]).toBe(7)
    })

    it('clamps entered page and turn numbers to an available one-based target', () => {
        expect(normalizeChatNavigationTarget('3', 8, 1)).toBe(3)
        expect(normalizeChatNavigationTarget(0, 8, 4)).toBe(1)
        expect(normalizeChatNavigationTarget(99, 8, 4)).toBe(8)
        expect(normalizeChatNavigationTarget('', 8, 4)).toBe(4)
        expect(normalizeChatNavigationTarget('bad', 8, 4)).toBe(4)
    })
})
