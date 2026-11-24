// Open state of the BGM manager dialog, shared by the player, the bot settings and App.

export const bgmManager = $state({
    open: false,
    /** Set to show first; empty shows the set the player is using. */
    setId: '',
})

export function openBgmManager(setId = '') {
    bgmManager.setId = setId
    bgmManager.open = true
}

// ---- Undo ----

import type { BgmLibrary } from './library'

const UNDO_LIMIT = 30

interface UndoEntry {
    label: string
    snapshot: BgmLibrary
}

/** Library states before each structural edit, newest last. Plain data; only the summary below is reactive. */
const undoStack: UndoEntry[] = []

/** What the undo button shows. Lives for the app session. */
export const bgmHistory = $state({ size: 0, lastLabel: '' })

function syncHistory() {
    bgmHistory.size = undoStack.length
    bgmHistory.lastLabel = undoStack.at(-1)?.label ?? ''
}

/** Call right before an edit; the label names the edit for the undo button. */
export function recordBgmChange(library: BgmLibrary, label: string) {
    undoStack.push({ label, snapshot: $state.snapshot(library) as BgmLibrary })
    if (undoStack.length > UNDO_LIMIT) undoStack.splice(0, undoStack.length - UNDO_LIMIT)
    syncHistory()
}

/** Puts the library back as it was before the last recorded edit. Returns that edit's label. */
export function undoBgmChange(library: BgmLibrary): string | null {
    const entry = undoStack.pop()
    syncHistory()
    if (!entry) return null
    const snapshot = structuredClone(entry.snapshot)
    library.tracks = snapshot.tracks
    library.sets = snapshot.sets
    library.defaultSetId = snapshot.defaultSetId
    return entry.label
}
