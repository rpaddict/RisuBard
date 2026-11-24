/** chatId is the stable ID on a chat message, not the containing chat's ID. */
export interface EventOrderMessage {
    chatId?: string
    role: string
    /** Chat messages store string flags too; any truthy value counts. */
    disabled?: unknown
    isComment?: unknown
}

/**
 * Chat turn numbers of an event's source messages, counted the way the chat
 * screen counts them, so the wiki and the chat show the same number.
 * Returns "41" or "40~41"; undefined when no source is in this chat.
 */
export function createEventTurnLabels(messages: readonly EventOrderMessage[] = []) {
    const assistantTurns = new Map<string, number>()
    const userTurns = new Map<string, number>()
    const waitingUsers: string[] = []
    let turn = 0
    for (const message of messages) {
        if (message.isComment) continue
        if (message.role === 'user' && message.chatId) waitingUsers.push(message.chatId)
        if (message.role !== 'char' || message.disabled) continue
        turn += 1
        if (message.chatId) assistantTurns.set(message.chatId, turn)
        // A user message belongs to the turn its reply opens.
        for (const id of waitingUsers.splice(0)) userTurns.set(id, turn)
    }
    return (sourceMessageIds: readonly string[] = []): string | undefined => {
        const collect = (turns: Map<string, number>) => sourceMessageIds
            .flatMap((id) => turns.has(id) ? [turns.get(id)!] : [])
        const found = collect(assistantTurns)
        const numbers = found.length > 0 ? found : collect(userTurns)
        if (numbers.length === 0) return undefined
        const start = Math.min(...numbers)
        const end = Math.max(...numbers)
        return start === end ? String(start) : `${start}~${end}`
    }
}

interface EventSource {
    id: string
    sourceMessageIds?: readonly string[]
    created?: string
    updated?: string
}

export function hasOnlyInheritedSources(event: Pick<EventSource, 'sourceMessageIds'>): boolean {
    return (event.sourceMessageIds?.length ?? 0) > 0
        && event.sourceMessageIds!.every(id => id.startsWith('inherited:'))
}

/** Resolve positions at read time so deleting a turn cannot stale stored indices. */
export function createEventOrder(messages: readonly EventOrderMessage[] = []) {
    const positions = new Map<string, { index: number; assistant: boolean }>()
    const ambiguous = new Set<string>()
    messages.forEach((message, index) => {
        const id = message.chatId
        if (!id || id.startsWith('inherited:')) return
        if (positions.has(id)) ambiguous.add(id)
        positions.set(id, { index, assistant: message.role === 'char' })
    })
    const position = (event: Pick<EventSource, 'sourceMessageIds'>): number | undefined => {
        let assistant: number | undefined
        let other: number | undefined
        let missing = false
        for (const id of event.sourceMessageIds ?? []) {
            if (ambiguous.has(id)) return undefined
            const source = positions.get(id)
            if (!source) {
                missing = true
                continue
            }
            if (source.assistant) assistant = Math.min(assistant ?? Infinity, source.index)
            else other = Math.min(other ?? Infinity, source.index)
        }
        // Several assistant turns can share a user message. Prefer response IDs.
        return assistant ?? (missing ? undefined : other)
    }
    const compare = (left: EventSource, right: EventSource, newestFirst = false): number => {
        const a = position(left)
        const b = position(right)
        if (a === undefined && b !== undefined) return 1
        if (a !== undefined && b === undefined) return -1
        const direction = newestFirst ? -1 : 1
        if (a !== undefined && b !== undefined) {
            return direction * (a - b) || left.id.localeCompare(right.id)
        }
        return direction * (left.created ?? left.updated ?? '')
            .localeCompare(right.created ?? right.updated ?? '')
            || left.id.localeCompare(right.id)
    }
    return { position, compare }
}
