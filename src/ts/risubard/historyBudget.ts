// Chat history that does not fit the input budget is dropped oldest first.
// With a large fixed prompt (instructions, lorebook, BardWiki sources) that
// could drop everything but the current input, including the latest reply.
// The latest reply is usually not analyzed into BardWiki yet, so the model
// then continues without the scene right before it.

type HistoryMessage = { role?: string, memo?: string }

/** A reply from the chat log: examples and the greeting carry no chat id memo. */
export function isStoryReply(message: HistoryMessage | undefined): boolean {
    return message?.role === 'assistant'
        && typeof message.memo === 'string'
        && message.memo !== ''
        && !message.memo.startsWith('NewChat')
}

export function countStoryReplies(messages: readonly HistoryMessage[]): number {
    return messages.filter(isStoryReply).length
}

/**
 * Whether trimming should stop and keep the oldest remaining message.
 * Only the latest reply is kept, and only while the overflow stays within
 * half of the output reservation, so the response keeps most of its room.
 */
export function shouldKeepLatestReply(
    messages: readonly HistoryMessage[],
    overflowTokens: number,
    outputReserveTokens: number,
): boolean {
    if (!isStoryReply(messages[0])) return false
    if (messages.slice(1).some(isStoryReply)) return false
    return overflowTokens <= outputReserveTokens / 2
}
