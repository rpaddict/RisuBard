import { describe, expect, it } from 'vitest'
import type { Message } from './storage/database.svelte'
import {
    buildChatTurnNavigation,
    firstShownTurnFrom,
    normalizeChatNavigationTarget,
    resolveShownTurn,
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

describe('jumping by the chat turn numbers', () => {
    // Turns 1..4 at message indexes 1, 3, 5, 7; turn 2 (index 3) is a hidden OOC turn.
    const chat = [
        message('user', 'u'), message('char', 't1'),
        message('user', 'u'), message('char', '<!-- OOC_turn --> ooc'),
        message('user', 'u'), message('char', 't3'),
        message('user', 'u'), message('char', 't4'),
    ]
    const navigation = buildChatTurnNavigation(chat)
    const hidden = new Set([2, 3])

    it('keeps a shown turn and moves a hidden one to the next shown turn', () => {
        expect(resolveShownTurn(navigation, 3, hidden)).toBe(3)
        expect(resolveShownTurn(navigation, 2, hidden)).toBe(3)
        expect(resolveShownTurn(navigation, 2, new Set())).toBe(2)
    })

    it('falls back to the previous shown turn at the end, and 0 when nothing is shown', () => {
        expect(resolveShownTurn(navigation, 4, new Set([7]))).toBe(3)
        expect(resolveShownTurn(navigation, 1, new Set([1, 3, 5, 7]))).toBe(0)
    })

    it('names the first shown turn of a page, or the last one before it', () => {
        expect(firstShownTurnFrom(navigation, 2, 6, hidden)).toBe(3)
        expect(firstShownTurnFrom(navigation, 2, 4, hidden)).toBe(1)
        expect(firstShownTurnFrom(navigation, 0, 2, hidden)).toBe(1)
    })
})
