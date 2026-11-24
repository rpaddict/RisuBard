type FirstMessageCharacter = {
    firstMessage?: unknown
    alternateGreetings?: unknown
}

type FirstMessageChat = {
    fmIndex?: unknown
    firstMessageDisabled?: boolean
}

/**
 * Picks the greeting a chat starts with. A missing, invalid or out-of-range
 * fmIndex falls back to the main first message; returns undefined when the
 * first message is disabled or there is no usable text.
 */
export function selectFirstMessageSource(
    character: FirstMessageCharacter,
    chat: FirstMessageChat,
): string | undefined {
    if (chat.firstMessageDisabled) return undefined
    const index = chat.fmIndex
    if (typeof index === 'number' && Number.isInteger(index) && index >= 0
        && Array.isArray(character.alternateGreetings)) {
        const greeting = character.alternateGreetings[index]
        if (typeof greeting === 'string') return greeting
    }
    return typeof character.firstMessage === 'string' ? character.firstMessage : undefined
}
