import { oocTurnIndices } from './oocTurns'

/** Set on an assistant turn queued for wiki analysis and cleared once it is confirmed or skipped. */
export interface WikiAnalysisPending {
    /** Why the last attempt did not confirm the turn; absent while it simply waits. */
    reason?: string
    failedAt?: string
}

export interface WikiBacklogMessage {
    role?: unknown
    data?: unknown
    chatId?: unknown
    isComment?: unknown
    disabled?: unknown
    risubardMemoryConfirmed?: unknown
    risubardWikiPending?: WikiAnalysisPending
}

/**
 * Queued assistant turns not yet confirmed, oldest first, through the target
 * (which counts as queued). Turns never queued, such as history from before
 * the wiki was on, are left alone.
 */
export function wikiBacklogMessages<T extends WikiBacklogMessage>(
    messages: readonly T[],
    targetMessageId?: string,
    ignoreOocTurns?: boolean,
): T[] {
    const isActive = (message: T) => !message.isComment && !message.disabled
    const targetIndex = targetMessageId === undefined
        ? messages.length - 1
        : messages.findIndex((message) =>
            message.role === 'char' && message.chatId === targetMessageId && isActive(message))
    if (targetIndex < 0) return []
    const excluded = oocTurnIndices(messages, ignoreOocTurns !== false)
    return messages.slice(0, targetIndex + 1).filter((message, index) =>
        message.role === 'char' && isActive(message) && !excluded.has(index)
        && typeof message.chatId === 'string' && message.chatId.trim().length > 0
        && message.risubardMemoryConfirmed !== true
        && (message.risubardWikiPending !== undefined
            || (index === targetIndex && targetMessageId !== undefined)))
}

/**
 * Turns after the last confirmed one that were never queued, such as replies
 * written while automatic analysis was off. History before the first confirmed
 * turn is left alone, so a chat that never used the wiki reports no gap.
 */
export function summarizeWikiAnalysisGap(
    messages: readonly WikiBacklogMessage[],
    options: { excludeMessageIds?: ReadonlySet<string>; ignoreOocTurns?: boolean } = {},
): { messageIds: string[]; startResponseNumber: number } {
    const isTurn = (message: WikiBacklogMessage) => message.role === 'char'
        && !message.isComment && !message.disabled
    const lastConfirmed = messages.findLastIndex((message) =>
        isTurn(message) && message.risubardMemoryConfirmed === true)
    if (lastConfirmed < 0) return { messageIds: [], startResponseNumber: 0 }
    const excluded = oocTurnIndices(messages, options.ignoreOocTurns !== false)
    const messageIds: string[] = []
    let startIndex = -1
    for (let index = lastConfirmed + 1; index < messages.length; index++) {
        const message = messages[index]
        if (!isTurn(message) || excluded.has(index)
            || typeof message.chatId !== 'string' || message.chatId.trim().length === 0
            || message.risubardMemoryConfirmed === true
            || message.risubardWikiPending !== undefined
            || options.excludeMessageIds?.has(message.chatId)) continue
        if (startIndex < 0) startIndex = index
        messageIds.push(message.chatId)
    }
    const startResponseNumber = startIndex < 0 ? 0 : messages.slice(0, startIndex + 1)
        .filter((message) => message.role === 'char' && !message.isComment).length
    return { messageIds, startResponseNumber }
}

/** The waiting turns, and where and why the oldest one stopped, for the dock banner. */
export function summarizeWikiBacklog(messages: readonly WikiBacklogMessage[]): {
    count: number
    oldest?: { messageId: string; index: number; responseNumber: number; reason?: string }
} {
    const waiting = wikiBacklogMessages(messages)
    const oldest = waiting[0]
    if (!oldest) return { count: 0 }
    const index = messages.indexOf(oldest)
    const responseNumber = messages.slice(0, index + 1)
        .filter((message) => message.role === 'char' && !message.isComment).length
    return {
        count: waiting.length,
        oldest: {
            messageId: oldest.chatId as string,
            index,
            responseNumber,
            ...(oldest.risubardWikiPending?.reason ? { reason: oldest.risubardWikiPending.reason } : {}),
        },
    }
}
