// Tiny signal for features that react to a reply as it begins (the BGM auto DJ switches
// music here). Fired once per model request: when streaming starts, or when a
// non-streamed reply arrives.

type Listener = () => void

const outputStartListeners = new Set<Listener>()

export function onGenerationOutputStart(listener: Listener): () => void {
    outputStartListeners.add(listener)
    return () => outputStartListeners.delete(listener)
}

export function emitGenerationOutputStart() {
    for (const listener of outputStartListeners) {
        try { listener() } catch (error) { console.error('[generationEvents] listener failed', error) }
    }
}
