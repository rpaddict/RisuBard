// Library edits shared by the floating player and the manager.
// Each function mutates the given library in place and returns what changed.

import { createBgmId, createBgmSlot, normalizeBgmLibrary, parseYouTubeAddress, type BgmLibrary, type BgmSet, type BgmSlot, type BgmSlotKind, type BgmTrack, type BgmTrackSource } from './library'

function sameSource(a: BgmTrackSource, b: BgmTrackSource): boolean {
    if (a.kind !== b.kind) return false
    if (a.kind === 'asset' && b.kind === 'asset') return a.key === b.key
    if (a.kind === 'file' && b.kind === 'file') return a.folderId === b.folderId && a.relPath === b.relPath
    if (a.kind === 'youtube' && b.kind === 'youtube') return a.videoId === b.videoId && a.start === b.start && a.end === b.end
    return false
}

/** Adds tracks to a slot, reusing library entries with the same source so one song can live in many slots. */
export function addTracksToSlot(library: BgmLibrary, slot: BgmSlot, items: Array<{ title: string; source: BgmTrackSource }>): BgmTrack[] {
    const added: BgmTrack[] = []
    for (const item of items) {
        let track = library.tracks.find(existing => sameSource(existing.source, item.source))
        if (!track) {
            track = { id: createBgmId('track'), title: item.title.trim() || 'Untitled', source: item.source, gain: 1 }
            library.tracks.push(track)
        }
        if (!slot.trackIds.includes(track.id)) {
            slot.trackIds.push(track.id)
            added.push(track)
        }
    }
    return added
}

/** Splits pasted text into YouTube sources; lines that are not YouTube addresses are counted, not guessed. */
export function parseYouTubeLines(text: string): { sources: Extract<BgmTrackSource, { kind: 'youtube' }>[]; skipped: number } {
    const sources: Extract<BgmTrackSource, { kind: 'youtube' }>[] = []
    let skipped = 0
    for (const line of text.split(/\r?\n/)) {
        if (!line.trim()) continue
        const source = parseYouTubeAddress(line)
        if (source) sources.push(source)
        else skipped++
    }
    return { sources, skipped }
}

export function fileTitle(path: string): string {
    const name = path.split(/[\\/]/).pop() ?? path
    return name.replace(/\.[^.]+$/, '') || name
}

export function addSlot(library: BgmLibrary, setId: string, name: string, kind: BgmSlotKind = 'mood', description = ''): BgmSlot | null {
    const set = library.sets.find(item => item.id === setId)
    if (!set || !name.trim()) return null
    const slot = createBgmSlot(name.trim().slice(0, 40), kind)
    slot.description = description
    set.slots.push(slot)
    return slot
}

export interface BgmSlotTemplate {
    name: string
    kind: string
    description: string
}

/**
 * Adds the templates whose name the set does not use yet. A slot that already has the
 * name but no description gets the template's description, so the DJ can read it.
 * Returns the slots added, in template order.
 */
export function addTemplateSlots(library: BgmLibrary, setId: string, templates: BgmSlotTemplate[]): BgmSlot[] {
    const set = library.sets.find(item => item.id === setId)
    if (!set) return []
    const added: BgmSlot[] = []
    for (const template of templates) {
        const existing = set.slots.find(slot => slot.name === template.name)
        if (existing) {
            if (!existing.description.trim()) existing.description = template.description
            continue
        }
        const kind = (['mood', 'place', 'event'] as const).find(item => item === template.kind) ?? 'mood'
        const slot = addSlot(library, setId, template.name, kind, template.description)
        if (slot) added.push(slot)
    }
    return added
}

/**
 * Fills a library nobody has touched yet (one set holding one empty, undescribed slot)
 * with the mood and event templates, so the player starts with a usable set. Runs once:
 * any library seen here is marked, and one already in use is left alone.
 */
export function fillStarterSet(library: BgmLibrary, templates: BgmSlotTemplate[], everydayName: string): boolean {
    if (library.starterFilled) return false
    library.starterFilled = true
    const [set] = library.sets
    const [slot] = set?.slots ?? []
    const untouched = library.sets.length === 1 && set.slots.length === 1 && library.tracks.length === 0
        && !slot.trackIds.length && !slot.description.trim() && (slot.name === 'Default' || slot.name === everydayName)
    if (!untouched) return false
    slot.name = everydayName
    addTemplateSlots(library, set.id, templates.filter(template => template.kind !== 'place'))
    return true
}

/** Moves one item inside an array in place (drag sorting). */
export function moveItem<T>(items: T[], from: number, to: number) {
    if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) return
    const [item] = items.splice(from, 1)
    items.splice(to, 0, item)
}

export function createSet(library: BgmLibrary, name: string, firstSlotName: string): BgmSet {
    const set: BgmSet = { id: createBgmId('set'), name: name.trim().slice(0, 60) || 'BGM', slots: [createBgmSlot(firstSlotName)] }
    library.sets.push(set)
    return set
}

/** Copies a set's slots; the copy shares tracks with the original. */
export function duplicateSet(library: BgmLibrary, setId: string, name: string): BgmSet | null {
    const source = library.sets.find(set => set.id === setId)
    if (!source) return null
    const copy: BgmSet = {
        id: createBgmId('set'),
        name: name.trim().slice(0, 60) || source.name,
        slots: source.slots.map(slot => ({ ...slot, id: createBgmId('slot'), trackIds: [...slot.trackIds] })),
    }
    library.sets.splice(library.sets.indexOf(source) + 1, 0, copy)
    return copy
}

/** Deletes a set unless it is the last one. The default moves to the first remaining set. */
export function deleteSet(library: BgmLibrary, setId: string): boolean {
    if (library.sets.length <= 1) return false
    library.sets = library.sets.filter(set => set.id !== setId)
    if (!library.sets.some(set => set.id === library.defaultSetId)) library.defaultSetId = library.sets[0].id
    pruneUnusedTracks(library)
    return true
}

export const BGM_SET_EXPORT_FORMAT = 'risubard-bgm-set'

/** A set with only the tracks it uses, for sharing. Uploaded and folder tracks only play where those files exist. */
export function exportSet(library: BgmLibrary, setId: string) {
    const set = library.sets.find(item => item.id === setId)
    if (!set) return null
    const used = new Set(set.slots.flatMap(slot => slot.trackIds))
    return {
        format: BGM_SET_EXPORT_FORMAT,
        version: 1,
        set: JSON.parse(JSON.stringify(set)) as BgmSet,
        tracks: JSON.parse(JSON.stringify(library.tracks.filter(track => used.has(track.id)))) as BgmTrack[],
    }
}

/** Adds an exported set as a new set. Tracks with a source already in the library are reused. Returns null for other files. */
export function importSet(library: BgmLibrary, data: unknown): BgmSet | null {
    if (!data || typeof data !== 'object' || (data as { format?: unknown }).format !== BGM_SET_EXPORT_FORMAT) return null
    const raw = data as { set?: unknown; tracks?: unknown }
    // Reuse the library normalizer to validate the file before touching the real library.
    const parsed = normalizeBgmLibrary({ tracks: raw.tracks, sets: [raw.set] })
    const incoming = parsed.sets[0]
    if (!raw.set || !incoming) return null
    const set: BgmSet = { id: createBgmId('set'), name: incoming.name, slots: [] }
    for (const slot of incoming.slots) {
        const copy: BgmSlot = { ...slot, id: createBgmId('slot'), trackIds: [] }
        const items = slot.trackIds
            .map(id => parsed.tracks.find(track => track.id === id))
            .filter((track): track is BgmTrack => !!track)
        for (const track of items) {
            const before = library.tracks.length
            const [added] = addTracksToSlot(library, copy, [{ title: track.title, source: track.source }])
            // Look the new track up again: a reactive library stores its own copy of pushed objects.
            const live = added && library.tracks.length > before ? library.tracks.find(item => item.id === added.id) : undefined
            if (live) live.gain = track.gain
        }
        set.slots.push(copy)
    }
    library.sets.push(set)
    return set
}

/** Moves a track from one slot to another. A track already in the target only leaves the source. */
export function moveTrackToSlot(library: BgmLibrary, from: BgmSlot, to: BgmSlot, trackId: string): boolean {
    if (from === to || !from.trackIds.includes(trackId)) return false
    from.trackIds = from.trackIds.filter(id => id !== trackId)
    if (!to.trackIds.includes(trackId)) to.trackIds.push(trackId)
    return true
}

/** Tracks in these slots that are not favorites. */
export function countNonFavorites(library: BgmLibrary, slots: BgmSlot[]): number {
    const favorites = new Set(library.tracks.filter(track => track.favorite).map(track => track.id))
    return slots.reduce((sum, slot) => sum + slot.trackIds.filter(id => !favorites.has(id)).length, 0)
}

/** Takes every non-favorite track out of these slots, then drops tracks no slot uses. Returns how many were taken out. */
export function removeNonFavorites(library: BgmLibrary, slots: BgmSlot[]): number {
    const favorites = new Set(library.tracks.filter(track => track.favorite).map(track => track.id))
    let removed = 0
    for (const slot of slots) {
        const kept = slot.trackIds.filter(id => favorites.has(id))
        removed += slot.trackIds.length - kept.length
        slot.trackIds = kept
    }
    pruneUnusedTracks(library)
    return removed
}

/** Removes a track from a slot, and from the library when no slot uses it any more. */
export function removeTrackFromSlot(library: BgmLibrary, slot: BgmSlot, trackId: string) {
    slot.trackIds = slot.trackIds.filter(id => id !== trackId)
    pruneUnusedTracks(library)
}

export function deleteSlot(library: BgmLibrary, setId: string, slotId: string) {
    const set = library.sets.find(item => item.id === setId)
    if (!set) return
    set.slots = set.slots.filter(slot => slot.id !== slotId)
    pruneUnusedTracks(library)
}

function pruneUnusedTracks(library: BgmLibrary) {
    const used = new Set(library.sets.flatMap(set => set.slots.flatMap(slot => slot.trackIds)))
    library.tracks = library.tracks.filter(track => used.has(track.id))
}

/** Fetches a YouTube title without an API key. Returns null when the video is private or the request fails. */
export async function fetchYouTubeTitle(videoId: string): Promise<string | null> {
    try {
        const url = `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}`
        const response = await fetch(url)
        if (!response.ok) return null
        const data = await response.json() as { title?: unknown }
        return typeof data.title === 'string' && data.title.trim() ? data.title.trim() : null
    } catch {
        return null
    }
}
