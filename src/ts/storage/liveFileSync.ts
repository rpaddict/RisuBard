export interface LiveFileSnapshot {
    characters: Record<string, any>[]
    loreBook: any[]
    /** Present only when an accepted external change touched a module. */
    modules?: any[]
    chatMetadata?: Array<{ characterId: string, chatId: string, metadata: Record<string, any>, previous?: Record<string, any>, revision?: string }>
}

export type LiveChatMetadataBaseline = Map<string, { metadata: Record<string, any>, revision?: string }>

export interface LiveFileSyncResult {
    enabled?: boolean
    revision: string
    etag: string | null
    snapshot?: LiveFileSnapshot
    error?: string
    recovery?: { path: string, conflicts: number }
}

export interface LiveFileConflict {
    characterId?: string
    chatId?: string
    field: string
    localValue: unknown
}

export function createLiveFileRefresh(options: {
    getInFlight(): Promise<void> | null
    setInFlight(value: Promise<void> | null): void
    isActive(): boolean
    sync(): Promise<void>
}) {
    return async () => {
        if (!options.isActive()) return
        while (options.getInFlight()) {
            // A failed poll must not permanently stop subsequent saves/refreshes.
            try { await options.getInFlight() } catch {}
        }
        if (!options.isActive()) return
        const operation = Promise.resolve().then(options.sync)
        options.setInFlight(operation)
        try { await operation } finally {
            if (options.getInFlight() === operation) options.setInFlight(null)
        }
    }
}

/** Coalesce server signals without dropping a change received during a save. */
export function createLiveFileSignalRefresh(options: {
    refresh(): Promise<void>
    isActive(): boolean
    isVisible(): boolean
    onError(error: unknown): void
}) {
    let pending = false
    let running = false
    let closed = false
    const canRefresh = () => !closed && options.isActive() && options.isVisible()
    async function drain() {
        if (running || !canRefresh()) return
        running = true
        try {
            while (pending && canRefresh()) {
                pending = false
                try { await options.refresh() } catch (error) { options.onError(error) }
            }
        } finally {
            running = false
        }
    }
    return {
        signal() {
            if (closed) return
            pending = true
            void drain()
        },
        close() { closed = true; pending = false },
    }
}

const runtimeFields = new Set(['chats', 'chatPage', 'chaId'])
const arrayDefaults = new Set(['globalLore', 'additionalAssets', 'emotionImages', 'customscript', 'triggerscript', 'alternateGreetings', 'tags', 'bias', 'chatFolders'])
const stringDefaults = new Set(['name', 'desc', 'firstMessage', 'notes', 'exampleMessage', 'creatorNotes', 'systemPrompt', 'postHistoryInstructions', 'additionalText', 'creator', 'characterVersion', 'personality', 'scenario', 'backgroundHTML', 'backgroundCSS'])
const clone = <T>(value: T): T => value === undefined ? value : JSON.parse(JSON.stringify(value))
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/** Update metadata in place: streaming chats keep their existing objects. */
export function applyLiveFileSnapshot(
    current: LiveFileSnapshot,
    baseline: LiveFileSnapshot,
    remote: LiveFileSnapshot,
    chatBaseline: LiveChatMetadataBaseline = new Map(),
): { conflicts: LiveFileConflict[], characterIds: string[] } {
    const conflicts: LiveFileConflict[] = []
    const characterIds: string[] = []
    const merge = (local: Record<string, any>, previous: Record<string, any>, incoming: Record<string, any>, characterId?: string) => {
        for (const key of new Set([...Object.keys(previous), ...Object.keys(incoming)])) {
            if (runtimeFields.has(key) || equal(previous[key], incoming[key])) continue
            if (!equal(local[key], previous[key]) && !equal(local[key], incoming[key])) {
                conflicts.push({ ...(characterId ? { characterId } : {}), field: key, localValue: clone(local[key]) })
            }
            if (Object.hasOwn(incoming, key)) local[key] = clone(incoming[key])
            else if (characterId && arrayDefaults.has(key)) local[key] = []
            else if (characterId && stringDefaults.has(key)) local[key] = ''
            else delete local[key]
        }
    }
    for (const incoming of remote.characters) {
        const previous = baseline.characters.find(c => c.chaId === incoming.chaId)
        const local = current.characters.find(c => c.chaId === incoming.chaId)
        // Character creation/deletion remains an explicit application operation.
        if (!previous || !local) continue
        merge(local, previous, incoming, incoming.chaId)
        for (const key of new Set([...Object.keys(previous), ...Object.keys(incoming)])) {
            if (runtimeFields.has(key)) continue
            if (Object.hasOwn(incoming, key)) previous[key] = clone(incoming[key])
            else delete previous[key]
        }
        characterIds.push(incoming.chaId)
    }
    merge(current, { loreBook: baseline.loreBook }, { loreBook: remote.loreBook })
    baseline.loreBook = clone(remote.loreBook)
    if (remote.modules) {
        merge(current, { modules: baseline.modules ?? [] }, { modules: remote.modules })
        baseline.modules = clone(remote.modules)
    }
    for (const entry of remote.chatMetadata ?? []) {
        const identity = JSON.stringify([entry.characterId, entry.chatId])
        const remembered = chatBaseline.get(identity)
        // A snapshot can be repeated after another field changes or a retry.
        // Never replay its old delta over a subsequent local edit.
        if (remembered && (entry.revision ? remembered.revision === entry.revision : equal(remembered.metadata, entry.metadata))) continue
        const previous = entry.previous ?? remembered?.metadata
        const local = current.characters.find(c => c.chaId === entry.characterId)?.chats?.find(c => c.id === entry.chatId)
        if (previous && local) {
            for (const key of new Set([...Object.keys(previous), ...Object.keys(remembered?.metadata ?? {}), ...Object.keys(entry.metadata)])) {
                if (['id', 'message', '_stub', '_placeholder', 'isStreaming', 'activeStreamingDisplayOptimizationMode'].includes(key)) continue
                // Keep unloaded chats unloaded. Their complete metadata comes from the chat endpoint.
                if ((local._placeholder || (local._stub && !Array.isArray(local.message))) && !['name', 'modules', 'folderId', 'lastDate'].includes(key)) continue
                let previousValue = previous[key]
                if (equal(previousValue, entry.metadata[key])) {
                    // Another reader can adopt the chat change before a later,
                    // unrelated snapshot reaches us. Catch up unchanged local fields.
                    if (!remembered || equal(remembered.metadata[key], entry.metadata[key]) || !equal(local[key], remembered.metadata[key])) continue
                    previousValue = remembered.metadata[key]
                }
                if (!equal(local[key], previousValue) && !equal(local[key], entry.metadata[key])) {
                    conflicts.push({ characterId: entry.characterId, chatId: entry.chatId, field: key, localValue: clone(local[key]) })
                }
                if (Object.hasOwn(entry.metadata, key)) local[key] = clone(entry.metadata[key])
                else if (['localLore', 'modules'].includes(key)) local[key] = []
                else if (key === 'name') local[key] = ''
                else delete local[key]
            }
        }
        const acknowledgedChat = baseline.characters.find(c => c.chaId === entry.characterId)?.chats?.find(c => c.id === entry.chatId)
        if (previous && acknowledgedChat) {
            for (const key of ['name', 'modules', 'folderId', 'lastDate']) {
                if (equal(previous[key], entry.metadata[key]) && (!remembered || equal(remembered.metadata[key], entry.metadata[key]))) continue
                if (Object.hasOwn(entry.metadata, key)) acknowledgedChat[key] = clone(entry.metadata[key])
                else if (key === 'name') acknowledgedChat[key] = ''
                else delete acknowledgedChat[key]
            }
        }
        // This baseline is deliberately separate from the serialized database's chat stubs.
        chatBaseline.set(identity, { metadata: clone(entry.metadata), revision: entry.revision })
    }
    return { conflicts, characterIds }
}
