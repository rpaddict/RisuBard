import { describe, expect, test } from 'vitest'
import { parseWikiGapPrompt, summarizeWikiAnalysisGap, WIKI_GAP_PROMPT_TTL_MS, summarizeWikiBacklog, wikiBacklogInterrupted, wikiBacklogMessages } from './wikiBacklog'

const reply = (index: number, extra: Record<string, unknown> = {}) => ({
    role: 'char', data: `reply ${index}`, chatId: `assistant-${index}`, ...extra,
})
const ask = (index: number) => ({ role: 'user', data: `ask ${index}`, chatId: `user-${index}` })

describe('wiki analysis backlog', () => {
    test('reports the oldest failed turn with its response number and reason', () => {
        const messages = [
            ask(1), reply(1, { risubardMemoryConfirmed: true }),
            ask(2), reply(2, { risubardWikiPending: { reason: '공급자 응답 오류', failedAt: '2026-10-26T00:00:00.000Z' } }),
            ask(3), reply(3, { risubardWikiPending: {} }),
            ask(4),
        ]

        expect(summarizeWikiBacklog(messages)).toEqual({
            count: 2,
            oldest: { messageId: 'assistant-2', index: 3, responseNumber: 2, reason: '공급자 응답 오류' },
        })
    })

    test('has nothing to show while a queued turn only waits, or after it is confirmed', () => {
        expect(summarizeWikiBacklog([ask(1), reply(1, { risubardWikiPending: {} })]).oldest?.reason).toBeUndefined()
        expect(summarizeWikiBacklog([ask(1), reply(1, { risubardMemoryConfirmed: true, risubardWikiPending: {} })]))
            .toEqual({ count: 0 })
        expect(summarizeWikiBacklog([ask(1), reply(1)])).toEqual({ count: 0 })
    })

    test('skips inactive, comment and OOC turns', () => {
        const messages = [
            ask(1), reply(1, { risubardWikiPending: {}, disabled: true }),
            ask(2), reply(2, { risubardWikiPending: {}, isComment: true }),
            ask(3), { ...reply(3, { risubardWikiPending: {} }), data: '<!-- OOC_turn -->\nnote' },
            ask(4), reply(4, { risubardWikiPending: {} }),
        ]

        expect(wikiBacklogMessages(messages).map((message) => message.chatId)).toEqual(['assistant-4'])
    })
})

describe('wiki analysis gap', () => {
    test('finds turns after the last confirmed one that were never queued', () => {
        const messages = [
            ask(1), reply(1),
            ask(2), reply(2, { risubardMemoryConfirmed: true }),
            ask(3), reply(3),
            ask(4), reply(4, { risubardWikiPending: {} }),
            ask(5), reply(5),
            ask(6), reply(6),
        ]
        expect(summarizeWikiAnalysisGap(messages, { excludeMessageIds: new Set(['assistant-6']) }))
            .toEqual({ messageIds: ['assistant-3', 'assistant-5'], startResponseNumber: 3 })
    })

    test('ignores the reply written after the turn automatic analysis targets', () => {
        const messages = [
            ask(1), reply(1, { risubardMemoryConfirmed: true }),
            ask(2), reply(2, { risubardWikiPending: {} }),
            ask(3), reply(3),
            ask(4),
        ]
        expect(summarizeWikiAnalysisGap(messages, { beforeMessageId: 'assistant-2' }).messageIds).toEqual([])
        expect(summarizeWikiAnalysisGap([...messages, reply(4)], { beforeMessageId: 'assistant-3' }).messageIds)
            .toEqual([])
    })

    test('leaves chats that never confirmed a turn, and fully analyzed chats, alone', () => {
        expect(summarizeWikiAnalysisGap([ask(1), reply(1), ask(2), reply(2)]).messageIds).toEqual([])
        expect(summarizeWikiAnalysisGap([ask(1), reply(1, { risubardMemoryConfirmed: true })]).messageIds).toEqual([])
    })
})

describe('wikiBacklogInterrupted', () => {
    test('resumes turns that are only waiting', () => {
        expect(wikiBacklogInterrupted([reply(1, { risubardWikiPending: {} })])).toBe(true)
        expect(wikiBacklogInterrupted([])).toBe(false)
    })

    test('resumes a failure only when it happened while the app was hidden', () => {
        const failed = reply(2, { risubardWikiPending: { reason: 'Failed to fetch', failedAt: '2026-11-21T10:05:00.000Z' } })
        expect(wikiBacklogInterrupted([reply(1, { risubardWikiPending: {} }), failed], '2026-11-21T10:00:00.000Z')).toBe(true)
        expect(wikiBacklogInterrupted([failed], '2026-11-21T10:10:00.000Z')).toBe(false)
        expect(wikiBacklogInterrupted([failed])).toBe(false)
    })
})

describe('parseWikiGapPrompt', () => {
    const now = Date.parse('2026-11-22T05:00:00Z')

    test('reads a stored prompt', () => {
        expect(parseWikiGapPrompt(`{"characterId":"c","chatId":"h","targetMessageId":"m","at":${now - 1000},"extra":1}`, now))
            .toEqual({ characterId: 'c', chatId: 'h', targetMessageId: 'm' })
    })

    test('ignores a missing, malformed or day-old record', () => {
        expect(parseWikiGapPrompt(null, now)).toBeUndefined()
        expect(parseWikiGapPrompt('', now)).toBeUndefined()
        expect(parseWikiGapPrompt('{', now)).toBeUndefined()
        expect(parseWikiGapPrompt('null', now)).toBeUndefined()
        expect(parseWikiGapPrompt(`{"characterId":"c","chatId":"h","at":${now}}`, now)).toBeUndefined()
        expect(parseWikiGapPrompt('{"characterId":"c","chatId":"h","targetMessageId":"m"}', now)).toBeUndefined()
        expect(parseWikiGapPrompt(`{"characterId":"c","chatId":"h","targetMessageId":"m","at":${now - WIKI_GAP_PROMPT_TTL_MS}}`, now))
            .toBeUndefined()
    })
})
