import type { Message } from './storage/database.svelte'

export type ChatTurnNavigation = {
    turnCount: number
    turnByMessageIndex: Map<number, number>
    messageIndexByTurn: number[]
    turnAtOrBeforeMessage(messageIndex: number): number
}

function isTurnResponse(message: Message): boolean {
    return message.role === 'char' && !message.isComment && !message.disabled
}

export function buildChatTurnNavigation(
    messages: readonly Message[],
    start = 0,
    end = messages.length,
): ChatTurnNavigation {
    const turnByMessageIndex = new Map<number, number>()
    const messageIndexByTurn: number[] = []
    let turnCount = 0
    const normalizedStart = Number.isFinite(start)
        ? Math.min(messages.length, Math.max(0, Math.floor(start)))
        : 0
    const normalizedEnd = Number.isFinite(end)
        ? Math.min(messages.length, Math.max(normalizedStart, Math.floor(end)))
        : messages.length

    messages.forEach((message, messageIndex) => {
        if (messageIndex < normalizedStart || messageIndex >= normalizedEnd) return
        if (!isTurnResponse(message)) return
        turnCount += 1
        turnByMessageIndex.set(messageIndex, turnCount)
        messageIndexByTurn.push(messageIndex)
    })

    return {
        turnCount,
        turnByMessageIndex,
        messageIndexByTurn,
        turnAtOrBeforeMessage(messageIndex: number) {
            if (turnCount === 0) return 0
            const normalizedIndex = Number.isFinite(messageIndex)
                ? Math.max(0, Math.floor(messageIndex))
                : 0
            let result = 0
            for (const [index, turn] of turnByMessageIndex) {
                if (index > normalizedIndex) break
                result = turn
            }
            return result || 1
        },
    }
}

export function normalizeChatNavigationTarget(
    value: unknown,
    maximum: number,
    fallback: number,
): number {
    const max = Math.max(1, Math.floor(Number.isFinite(maximum) ? maximum : 1))
    const safeFallback = Math.min(max, Math.max(1, Math.floor(
        Number.isFinite(fallback) ? fallback : 1,
    )))
    if (typeof value === 'string' && value.trim() === '') return safeFallback
    const parsed = typeof value === 'number' ? value : Number(value)
    if (!Number.isFinite(parsed)) return safeFallback
    return Math.min(max, Math.max(1, Math.floor(parsed)))
}

/**
 * The shown turn closest to `turn` (1-based, whole chat): the turn itself,
 * else the next shown one, else the previous one. Turns whose message index
 * is in `hidden` (OOC turns the chat hides) keep their numbers but are
 * skipped. 0 when no turn is shown.
 */
export function resolveShownTurn(navigation: ChatTurnNavigation, turn: number, hidden: ReadonlySet<number>): number {
    const shown = (n: number) => n >= 1 && n <= navigation.turnCount && !hidden.has(navigation.messageIndexByTurn[n - 1])
    if (shown(turn)) return turn
    for (let n = turn + 1; n <= navigation.turnCount; n++) if (shown(n)) return n
    for (let n = Math.min(turn - 1, navigation.turnCount); n >= 1; n--) if (shown(n)) return n
    return 0
}

/** The first shown turn in messages [start, end), else the last shown one before start; 0 when none. */
export function firstShownTurnFrom(navigation: ChatTurnNavigation, start: number, end: number, hidden: ReadonlySet<number>): number {
    let before = 0
    for (let n = 1; n <= navigation.turnCount; n++) {
        const index = navigation.messageIndexByTurn[n - 1]
        if (hidden.has(index)) continue
        if (index >= end) break
        if (index >= start) return n
        before = n
    }
    return before
}
