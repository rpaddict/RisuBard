export function shouldAutomaticallyConfirmNarrativeTurn(
    enabled: boolean | undefined
): boolean {
    return enabled !== false
}

/**
 * The subset of a stored chat message that lagged target selection reads.
 * Kept structural so this module stays dependency-free.
 */
interface ConfirmationCandidate {
    role?: unknown
    chatId?: unknown
    isComment?: unknown
    disabled?: unknown
}

/**
 * Returns the chatId of the assistant message automatic confirmation should
 * target when the user holds wiki updates back by `lagTurns` turns.
 *
 * Automatic mode already lags by one turn: it targets the assistant message
 * preceding the latest user message. This walks back `lagTurns` further.
 *
 * `null` means "nothing to confirm yet" — the caller must skip confirmation
 * rather than fall back to a more recent turn, which would defeat the lag.
 */
export function selectLaggedConfirmationTarget(
    storedMessages: readonly ConfirmationCandidate[],
    lagTurns: number
): string | null {
    if (!Number.isSafeInteger(lagTurns) || lagTurns <= 0) return null
    const isActive = (message: ConfirmationCandidate) =>
        !message.isComment && !message.disabled
    const latestActiveIndex = storedMessages.findLastIndex(isActive)
    if (latestActiveIndex < 0
        || storedMessages[latestActiveIndex].role !== 'user') {
        return null
    }
    let remaining = lagTurns + 1
    for (let index = latestActiveIndex - 1; index >= 0; index -= 1) {
        const message = storedMessages[index]
        if (!isActive(message) || message.role !== 'char') continue
        remaining -= 1
        if (remaining > 0) continue
        return typeof message.chatId === 'string'
            && message.chatId.trim().length > 0
            ? message.chatId
            : null
    }
    return null
}
