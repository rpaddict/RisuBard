export const NARRATIVE_BACKLOG_TURNS_PER_RUN = 4
// Instructions, notes and canon share the analysis input with the turns.
const NARRATIVE_BATCH_INPUT_SHARE = 0.5

/**
 * Groups waiting turns, in order, into as few analysis calls as fit half of the
 * input limit. A turn too long to share a call is analyzed alone.
 */
export function groupNarrativeBacklog<T extends { messages: readonly { content: string }[] }>(
    turns: readonly T[],
    analysisTokenLimit: number,
): T[][] {
    const budget = analysisTokenLimit * NARRATIVE_BATCH_INPUT_SHARE
    const size = (turn: T) => turn.messages.reduce((sum, message) => sum + message.content.length, 0)
    const batches: T[][] = []
    let used = 0
    for (const turn of turns) {
        const current = batches.at(-1)
        if (current && current.length < NARRATIVE_BACKLOG_TURNS_PER_RUN && used + size(turn) <= budget) {
            current.push(turn)
            used += size(turn)
            continue
        }
        batches.push([turn])
        used = size(turn)
    }
    return batches
}

/**
 * With an analysis interval above one, a new turn waits until that many turns
 * are queued, so they share one analysis call instead of repeating the
 * instructions and evidence for each turn.
 */
export function narrativeAnalysisDue(waitingTurns: number, interval: number): boolean {
    return waitingTurns >= Math.max(1, Math.min(NARRATIVE_BACKLOG_TURNS_PER_RUN, interval))
}

/** Turns without a user reply in between share one user message; keep it once. */
export function withoutRepeatedMessages<T extends { messages: readonly { messageId: string }[] }>(
    turns: readonly T[],
): T[] {
    const seen = new Set<string>()
    return turns.map((turn) => ({
        ...turn,
        messages: turn.messages.filter((message) => {
            if (seen.has(message.messageId)) return false
            seen.add(message.messageId)
            return true
        }),
    }))
}
