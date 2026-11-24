// BGM library model: tracks, slots (mood or place) and sets of slots.
// Pure data helpers only; playback lives in engine.svelte.ts.

export type BgmTrackSource =
    | { kind: 'asset'; key: string }
    | { kind: 'file'; folderId: string; relPath: string }
    | { kind: 'youtube'; videoId: string; start?: number; end?: number }

export interface BgmTrack {
    id: string
    title: string
    source: BgmTrackSource
    /** Per-track loudness correction, 0..1. */
    gain: number
    /** Kept when clearing out everything that is not a favorite. */
    favorite?: boolean
}

export type BgmSlotKind = 'mood' | 'place' | 'event'
export type BgmPlayMode = 'shuffle' | 'sequential' | 'repeat-one'

export interface BgmSlot {
    id: string
    name: string
    /** Read by the auto DJ to decide when this slot fits the scene. */
    description: string
    kind: BgmSlotKind
    trackIds: string[]
    playMode: BgmPlayMode
}

export interface BgmSet {
    id: string
    name: string
    slots: BgmSlot[]
}

export interface BgmLibrary {
    tracks: BgmTrack[]
    sets: BgmSet[]
    defaultSetId: string
    /** The first-run mood set was offered once; a library is never refilled after that. */
    starterFilled?: boolean
}

export type BgmInactiveMute = 'off' | 'hidden' | 'blur'

export interface BgmPlayerSettings {
    enabled: boolean
    volume: number
    collapsed: boolean
    placement?: { xRatio: number; yRatio: number }
    /** Expanded card size the user dragged to; unset uses the default size. */
    size?: { width: number; height: number }
    /** Expanded card fills the window. */
    maximized: boolean
    /** YouTube video beside the title ('small') or across the card ('large'). */
    videoSize: 'large' | 'small'
    muteWhenInactive: BgmInactiveMute
    crossfadeMs: number
    /** Last slot picked in each set, so switching bots resumes that bot's mood. */
    lastSlotBySet: Record<string, string>
    dj: BgmDjSettings
}

export interface BgmDjSettings {
    enabled: boolean
    /** 'otherAx' is the auxiliary model slot; 'model' is the main chat model. */
    model: 'otherAx' | 'model'
    /** How many recent AI replies the DJ reads. */
    recentCount: number
    /** Each reply is cut to its last this-many characters. */
    maxChars: number
    /** Decisions below this confidence keep the current slot. */
    minConfidence: number
    /** Seconds a slot plays at least before the DJ may change it. */
    minDwellSec: number
    /** After a manual slot pick, the DJ sits out this many turns. */
    manualHoldTurns: number
    showRequestStatus: boolean
}

export const BGM_DJ_LIMITS = {
    recentCount: [0, 10],
    maxChars: [200, 6000],
    minDwellSec: [0, 600],
    manualHoldTurns: [0, 10],
} as const

function bounded(value: unknown, [min, max]: readonly [number, number], fallback: number): number {
    return typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback
}

export function normalizeBgmDjSettings(value: unknown): BgmDjSettings {
    const raw = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
    return {
        enabled: raw.enabled === true,
        model: raw.model === 'model' ? 'model' : 'otherAx',
        recentCount: bounded(raw.recentCount, BGM_DJ_LIMITS.recentCount, 2),
        maxChars: bounded(raw.maxChars, BGM_DJ_LIMITS.maxChars, 1200),
        minConfidence: unit(raw.minConfidence, 0.5),
        minDwellSec: bounded(raw.minDwellSec, BGM_DJ_LIMITS.minDwellSec, 20),
        manualHoldTurns: bounded(raw.manualHoldTurns, BGM_DJ_LIMITS.manualHoldTurns, 2),
        showRequestStatus: raw.showRequestStatus === true,
    }
}

export const BGM_DEFAULT_CROSSFADE_MS = 2500
export const BGM_MAX_CROSSFADE_MS = 10000

const SLOT_KINDS: BgmSlotKind[] = ['mood', 'place', 'event']
const PLAY_MODES: BgmPlayMode[] = ['shuffle', 'sequential', 'repeat-one']
const INACTIVE_MODES: BgmInactiveMute[] = ['off', 'hidden', 'blur']

export function createBgmId(prefix: string): string {
    const random = typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID().replace(/-/g, '').slice(0, 12)
        : Math.random().toString(36).slice(2, 14)
    return `${prefix}_${random}`
}

function text(value: unknown, fallback = ''): string {
    return typeof value === 'string' ? value : fallback
}

function unit(value: unknown, fallback: number): number {
    return typeof value === 'number' && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : fallback
}

function seconds(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined
}

function normalizeSource(value: unknown): BgmTrackSource | null {
    if (!value || typeof value !== 'object') return null
    const raw = value as Record<string, unknown>
    if (raw.kind === 'asset' && text(raw.key)) return { kind: 'asset', key: text(raw.key) }
    if (raw.kind === 'file' && text(raw.folderId) && text(raw.relPath)) {
        return { kind: 'file', folderId: text(raw.folderId), relPath: text(raw.relPath) }
    }
    if (raw.kind === 'youtube' && YOUTUBE_ID.test(text(raw.videoId))) {
        const source: BgmTrackSource = { kind: 'youtube', videoId: text(raw.videoId) }
        const start = seconds(raw.start)
        const end = seconds(raw.end)
        if (start) source.start = start
        if (end && (!start || end > start)) source.end = end
        return source
    }
    return null
}

export function createBgmSlot(name: string, kind: BgmSlotKind = 'mood'): BgmSlot {
    return { id: createBgmId('slot'), name, description: '', kind, trackIds: [], playMode: 'shuffle' }
}

export function createDefaultBgmSet(name = 'BGM'): BgmSet {
    return { id: createBgmId('set'), name, slots: [createBgmSlot('Default')] }
}

export function normalizeBgmLibrary(value: unknown): BgmLibrary {
    const raw = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
    const tracks: BgmTrack[] = []
    const trackIds = new Set<string>()
    for (const item of Array.isArray(raw.tracks) ? raw.tracks : []) {
        if (!item || typeof item !== 'object') continue
        const track = item as Record<string, unknown>
        const id = text(track.id)
        const source = normalizeSource(track.source)
        if (!id || trackIds.has(id) || !source) continue
        trackIds.add(id)
        tracks.push({ id, title: text(track.title).trim() || id, source, gain: unit(track.gain, 1), ...(track.favorite === true ? { favorite: true } : {}) })
    }
    const sets: BgmSet[] = []
    const setIds = new Set<string>()
    for (const item of Array.isArray(raw.sets) ? raw.sets : []) {
        if (!item || typeof item !== 'object') continue
        const set = item as Record<string, unknown>
        const id = text(set.id)
        if (!id || setIds.has(id)) continue
        setIds.add(id)
        const slotIds = new Set<string>()
        const slots: BgmSlot[] = []
        for (const slotItem of Array.isArray(set.slots) ? set.slots : []) {
            if (!slotItem || typeof slotItem !== 'object') continue
            const slot = slotItem as Record<string, unknown>
            const slotId = text(slot.id)
            if (!slotId || slotIds.has(slotId)) continue
            slotIds.add(slotId)
            slots.push({
                id: slotId,
                name: text(slot.name).trim() || slotId,
                description: text(slot.description),
                kind: SLOT_KINDS.includes(slot.kind as BgmSlotKind) ? slot.kind as BgmSlotKind : 'mood',
                trackIds: [...new Set((Array.isArray(slot.trackIds) ? slot.trackIds : [])
                    .filter((trackId): trackId is string => typeof trackId === 'string' && trackIds.has(trackId)))],
                playMode: PLAY_MODES.includes(slot.playMode as BgmPlayMode) ? slot.playMode as BgmPlayMode : 'shuffle',
            })
        }
        sets.push({ id, name: text(set.name).trim() || 'BGM', slots })
    }
    if (sets.length === 0) sets.push(createDefaultBgmSet())
    const defaultSetId = setIds.has(text(raw.defaultSetId)) ? text(raw.defaultSetId) : sets[0].id
    return raw.starterFilled === true ? { tracks, sets, defaultSetId, starterFilled: true } : { tracks, sets, defaultSetId }
}

export function normalizeBgmPlayerSettings(value: unknown): BgmPlayerSettings {
    const raw = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
    const placement = raw.placement as Record<string, unknown> | undefined
    const settings: BgmPlayerSettings = {
        enabled: raw.enabled === true,
        volume: unit(raw.volume, 0.6),
        collapsed: raw.collapsed !== false,
        maximized: raw.maximized === true,
        videoSize: raw.videoSize === 'small' ? 'small' : 'large',
        muteWhenInactive: INACTIVE_MODES.includes(raw.muteWhenInactive as BgmInactiveMute)
            ? raw.muteWhenInactive as BgmInactiveMute
            : 'off',
        crossfadeMs: typeof raw.crossfadeMs === 'number' && Number.isFinite(raw.crossfadeMs)
            ? Math.min(BGM_MAX_CROSSFADE_MS, Math.max(0, Math.round(raw.crossfadeMs)))
            : BGM_DEFAULT_CROSSFADE_MS,
        lastSlotBySet: {},
        dj: normalizeBgmDjSettings(raw.dj),
    }
    if (placement && typeof placement.xRatio === 'number' && typeof placement.yRatio === 'number'
        && Number.isFinite(placement.xRatio) && Number.isFinite(placement.yRatio)) {
        settings.placement = { xRatio: unit(placement.xRatio, 1), yRatio: unit(placement.yRatio, 1) }
    }
    const size = raw.size as Record<string, unknown> | undefined
    if (size && typeof size.width === 'number' && typeof size.height === 'number'
        && Number.isFinite(size.width) && Number.isFinite(size.height) && size.width > 0 && size.height > 0) {
        settings.size = { width: Math.round(size.width), height: Math.round(size.height) }
    }
    const lastSlots = raw.lastSlotBySet && typeof raw.lastSlotBySet === 'object' ? raw.lastSlotBySet as Record<string, unknown> : {}
    settings.lastSlotBySet = Object.fromEntries(Object.entries(lastSlots).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
    return settings
}

// ---- YouTube addresses ----

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/
const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtube-nocookie.com', 'www.youtube-nocookie.com'])

/** Accepts `90`, `90s`, `1m30s`, `1h2m3s`. */
function parseTimestamp(value: string | null): number | undefined {
    if (!value) return undefined
    if (/^\d+$/.test(value)) return seconds(Number(value))
    const match = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(value)
    if (!match || !match[0]) return undefined
    return seconds(Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0))
}

export function parseYouTubeAddress(input: string): Extract<BgmTrackSource, { kind: 'youtube' }> | null {
    const value = input.trim()
    if (YOUTUBE_ID.test(value)) return { kind: 'youtube', videoId: value }
    let url: URL
    try { url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`) }
    catch { return null }
    const host = url.hostname.toLowerCase()
    let videoId: string | null = null
    if (host === 'youtu.be') videoId = url.pathname.split('/')[1] ?? null
    else if (YOUTUBE_HOSTS.has(host)) {
        if (url.pathname === '/watch') videoId = url.searchParams.get('v')
        else {
            const [, kind, id] = url.pathname.split('/')
            if (['embed', 'shorts', 'live', 'v'].includes(kind)) videoId = id ?? null
        }
    }
    if (!videoId || !YOUTUBE_ID.test(videoId)) return null
    const source: Extract<BgmTrackSource, { kind: 'youtube' }> = { kind: 'youtube', videoId }
    const start = parseTimestamp(url.searchParams.get('t') ?? url.searchParams.get('start'))
    const end = parseTimestamp(url.searchParams.get('end'))
    if (start) source.start = start
    if (end && (!start || end > start)) source.end = end
    return source
}

// ---- Queue ----

function shuffled<T>(items: T[], random: () => number): T[] {
    const result = [...items]
    for (let i = result.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [result[i], result[j]] = [result[j], result[i]]
    }
    return result
}

/**
 * Picks the next track of a slot. `bag` holds the not-yet-played shuffle order and is
 * refilled when empty, so every track plays once before any repeats. Skipped ids are
 * tracks that failed to load in this session.
 */
export function pickNextTrack(
    slot: Pick<BgmSlot, 'trackIds' | 'playMode'>,
    currentId: string | null,
    bag: string[],
    skipped: ReadonlySet<string> = new Set(),
    random: () => number = Math.random,
): { trackId: string | null; bag: string[] } {
    const playable = slot.trackIds.filter(id => !skipped.has(id))
    if (playable.length === 0) return { trackId: null, bag: [] }
    if (slot.playMode === 'repeat-one') {
        return { trackId: currentId && playable.includes(currentId) ? currentId : playable[0], bag }
    }
    if (slot.playMode === 'sequential') {
        const index = currentId ? slot.trackIds.indexOf(currentId) : -1
        for (let step = 1; step <= slot.trackIds.length; step++) {
            const id = slot.trackIds[(index + step + slot.trackIds.length) % slot.trackIds.length]
            if (!skipped.has(id)) return { trackId: id, bag }
        }
        return { trackId: null, bag: [] }
    }
    let next = bag.filter(id => playable.includes(id))
    if (next.length === 0) {
        next = shuffled(playable, random)
        // Avoid playing the same track twice in a row across a refill.
        if (next.length > 1 && next[0] === currentId) next.push(next.shift()!)
    }
    const [trackId, ...rest] = next
    return { trackId, bag: rest }
}

/** The set a bot plays: its own when it still exists, otherwise the library default. */
export function resolveActiveSetId(library: BgmLibrary, characterSetId: string | undefined): string {
    if (characterSetId && library.sets.some(set => set.id === characterSetId)) return characterSetId
    return findBgmSet(library, undefined).id
}

export function findBgmSet(library: BgmLibrary, setId: string | undefined): BgmSet {
    return library.sets.find(set => set.id === setId) ?? library.sets.find(set => set.id === library.defaultSetId) ?? library.sets[0]
}

/** Title given to a YouTube track until its real title is known. */
export function youtubePlaceholderTitle(videoId: string): string {
    return `YouTube ${videoId}`
}

export function bgmFileUrl(folderId: string, relPath: string): string {
    const hex = Array.from(new TextEncoder().encode(relPath), byte => byte.toString(16).padStart(2, '0')).join('')
    return `/api/bgm/file/${encodeURIComponent(folderId)}/${hex}`
}
