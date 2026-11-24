import { getFileSrc } from '../globalApi.svelte'
import { DBState } from '../stores.svelte'
import { AudioDeck, type BgmDeck, type BgmDeckFailure } from './decks'
import { watchInactive } from './inactiveMute'
import {
    bgmFileUrl,
    findBgmSet,
    normalizeBgmLibrary,
    normalizeBgmPlayerSettings,
    pickNextTrack,
    type BgmLibrary,
    type BgmPlayerSettings,
    type BgmSet,
    type BgmSlot,
    type BgmTrack,
    youtubePlaceholderTitle,
} from './library'
import { YouTubeDeck } from './youtube'

const FADE_TICK_MS = 40
const MUTE_FADE_MS = 300
const VIEW_TICK_MS = 500

export type BgmNotice = '' | BgmDeckFailure | 'empty'

interface DeckEntry {
    deck: BgmDeck
    track: BgmTrack
    youtube: boolean
    fade: number
    fadeTarget: number
    /** Fade change per millisecond. */
    fadeRate: number
}

/**
 * Plays the BGM library. A module singleton, so music keeps going when the floating
 * player is collapsed or another screen opens.
 */
class BgmEngine {
    view = $state({
        playing: false,
        trackId: '',
        setId: '',
        slotId: '',
        position: 0,
        duration: 0,
        needsGesture: false,
        notice: '' as BgmNotice,
        inactive: false,
        youtubeVisible: false,
        /** What the auto DJ is doing, for the player's indicator. */
        dj: 'idle' as 'idle' | 'thinking' | 'failed' | 'held',
        /** Slot name of the DJ's last switch, shown briefly in the player. */
        djPick: '',
    })

    /** Turns the DJ still sits out after the user picked a slot by hand. */
    private manualHoldLeft = 0
    /** When the current slot started; the DJ waits a minimum time before changing it. */
    lastSwitchAt = 0

    private active: DeckEntry | null = null
    private outgoing = new Set<DeckEntry>()
    private bags = new Map<string, string[]>()
    private skipped = new Set<string>()
    private muteFactor = 1
    private muteTarget = 1
    private fadeTimer: ReturnType<typeof setInterval> | null = null
    private lastFadeAt = 0
    private viewTimer: ReturnType<typeof setInterval> | null = null
    private inactiveWatch: { stop: () => void; refresh: () => void } | null = null
    private videoHost: HTMLElement | null = null
    private fallbackHost: HTMLElement | null = null
    private startToken = 0

    get library(): BgmLibrary {
        DBState.db.bgmLibrary ??= normalizeBgmLibrary(undefined)
        return DBState.db.bgmLibrary
    }

    get settings(): BgmPlayerSettings {
        DBState.db.bgmPlayer ??= normalizeBgmPlayerSettings(undefined)
        return DBState.db.bgmPlayer
    }

    currentSet(): BgmSet {
        return findBgmSet(this.library, this.view.setId)
    }

    /**
     * Follows the selected bot's set. Picks up the slot last used in that set and, when
     * music is playing, crossfades into it.
     */
    useSet(setId: string) {
        const set = findBgmSet(this.library, setId)
        if (this.view.setId === set.id) return
        this.view.setId = set.id
        const remembered = this.settings.lastSlotBySet[set.id]
        const slotId = set.slots.find(slot => slot.id === remembered)?.id ?? set.slots[0]?.id ?? ''
        const wasPlaying = !!this.active && !this.active.deck.isPaused()
        const changed = slotId !== this.view.slotId
        this.view.slotId = slotId
        if (changed) this.lastSwitchAt = Date.now()
        if (wasPlaying && changed) this.playNext(true)
    }

    currentSlot(): BgmSlot | null {
        const set = this.currentSet()
        return set.slots.find(slot => slot.id === this.view.slotId) ?? set.slots[0] ?? null
    }

    trackById(id: string): BgmTrack | undefined {
        return this.library.tracks.find(track => track.id === id)
    }

    /** Starts listeners. Called while the player is enabled. */
    start() {
        if (this.viewTimer) return
        if (!this.view.setId) this.useSet(this.library.defaultSetId)
        this.inactiveWatch = watchInactive(() => this.settings.muteWhenInactive, (inactive) => {
            this.view.inactive = inactive
            this.muteTarget = inactive ? 0 : 1
            this.runFades()
        })
        this.viewTimer = setInterval(() => this.refreshView(), VIEW_TICK_MS)
    }

    /** Stops playback and listeners. Called when the player is turned off. */
    shutdown() {
        this.startToken++
        this.inactiveWatch?.stop()
        this.inactiveWatch = null
        if (this.viewTimer) clearInterval(this.viewTimer)
        this.viewTimer = null
        if (this.fadeTimer) clearInterval(this.fadeTimer)
        this.fadeTimer = null
        for (const entry of [this.active, ...this.outgoing]) entry?.deck.destroy()
        this.active = null
        this.outgoing.clear()
        this.fallbackHost?.remove()
        this.fallbackHost = null
        Object.assign(this.view, { playing: false, trackId: '', setId: '', position: 0, duration: 0, needsGesture: false, youtubeVisible: false })
    }

    /** Re-reads the inactive-mute mode after the setting changes. */
    refreshInactiveMode() {
        this.inactiveWatch?.refresh()
    }

    /** The element YouTube videos render into. Moving an existing video reloads it, so attach before playing. */
    attachVideoHost(element: HTMLElement | null) {
        this.videoHost = element
    }

    /**
     * Makes a slot current. A pick by the user starts playback and makes the DJ sit out a
     * few turns; a pick by the DJ only crossfades when music is already playing.
     */
    selectSlot(slotId: string, by: 'user' | 'dj' | 'system' = 'system') {
        const slot = this.currentSet().slots.find(item => item.id === slotId)
        if (!slot) return
        const changed = this.view.slotId !== slotId
        if (by === 'user') {
            this.manualHoldLeft = this.settings.dj.manualHoldTurns
            this.view.djPick = ''
        }
        if (changed) this.lastSwitchAt = Date.now()
        this.view.slotId = slotId
        this.settings.lastSlotBySet[this.currentSet().id] = slotId
        if (by === 'dj') {
            if (changed && this.active && !this.active.deck.isPaused()) this.playNext(true)
            return
        }
        if (changed || !this.active) this.playNext(true)
        else if (this.active.deck.isPaused()) this.resume()
    }

    /** True while the player is on screen and listening. */
    isRunning(): boolean {
        return !!this.viewTimer
    }

    /** Uses up one held turn; true when this turn should be left to the user's own pick. */
    consumeManualHold(): boolean {
        if (this.manualHoldLeft <= 0) return false
        this.manualHoldLeft--
        return true
    }

    toggle() {
        if (!this.active) return this.playNext(true)
        if (this.active.deck.isPaused() || this.view.needsGesture) this.resume()
        else {
            this.active.deck.pause()
            this.refreshView()
        }
    }

    next() {
        this.playNext(true)
    }

    /** Plays one track now; when it belongs to a slot of the current set, that slot becomes current. */
    playTrack(trackId: string, slotId?: string) {
        if (!this.trackById(trackId)) return
        const slot = slotId ? this.currentSet().slots.find(item => item.id === slotId) : undefined
        if (slot) this.view.slotId = slot.id
        this.skipped.delete(trackId)
        void this.startTrack(trackId, true)
    }

    seek(seconds: number) {
        this.active?.deck.seek(seconds)
        this.refreshView()
    }

    setVolume(volume: number) {
        this.settings.volume = Math.min(1, Math.max(0, volume))
        this.applyVolumes()
    }

    /** Re-applies volume after a track's gain changes. */
    applyVolumes() {
        for (const entry of [this.active, ...this.outgoing]) if (entry) this.applyVolume(entry)
    }

    private resume() {
        if (!this.active) return
        this.view.needsGesture = false
        this.active.deck.play()
        this.refreshView()
    }

    private playNext(crossfade: boolean) {
        const slot = this.currentSlot()
        if (!slot) return this.stopWithNotice('empty')
        const picked = pickNextTrack(slot, this.active?.track.id ?? null, this.bags.get(slot.id) ?? [], this.skipped)
        this.bags.set(slot.id, picked.bag)
        if (!picked.trackId) {
            // Every track failed this session: forget the failures so a later retry can work.
            for (const id of slot.trackIds) this.skipped.delete(id)
            return this.stopWithNotice(slot.trackIds.length ? this.view.notice || 'unavailable' : 'empty')
        }
        void this.startTrack(picked.trackId, crossfade)
    }

    private stopWithNotice(notice: BgmNotice) {
        if (this.active) this.fadeOut(this.active, false)
        this.active = null
        this.view.notice = notice
        this.refreshView()
    }

    private host(): HTMLElement {
        if (this.videoHost?.isConnected) return this.videoHost
        if (!this.fallbackHost) {
            this.fallbackHost = document.createElement('div')
            this.fallbackHost.setAttribute('aria-hidden', 'true')
            this.fallbackHost.style.cssText = 'position:fixed;left:-10000px;top:0;width:200px;height:200px;'
            document.body.appendChild(this.fallbackHost)
        }
        return this.fallbackHost
    }

    private async startTrack(trackId: string, crossfade: boolean) {
        const track = this.trackById(trackId)
        if (!track) return
        const token = ++this.startToken
        this.view.notice = ''
        this.view.needsGesture = false
        let url = ''
        if (track.source.kind === 'asset') url = await getFileSrc(track.source.key)
        else if (track.source.kind === 'file') url = bgmFileUrl(track.source.folderId, track.source.relPath)
        if (token !== this.startToken) return

        const fadeMs = crossfade && this.active && !this.active.deck.isPaused() ? this.settings.crossfadeMs : 0
        const entry: DeckEntry = {
            deck: null as unknown as BgmDeck,
            track,
            youtube: track.source.kind === 'youtube',
            fade: fadeMs ? 0 : 1,
            fadeTarget: 1,
            fadeRate: fadeMs ? 1 / fadeMs : 0,
        }
        const events = {
            onEnded: () => { if (this.active === entry) this.playNext(false) },
            onPlaying: () => {
                if (this.active !== entry) return
                this.view.needsGesture = false
                this.refreshView()
            },
            onFailure: (reason: BgmDeckFailure) => this.handleFailure(entry, reason),
            onTitle: (title: string) => {
                if (track.source.kind === 'youtube' && track.title === youtubePlaceholderTitle(track.source.videoId)) track.title = title
            },
        }
        entry.deck = track.source.kind === 'youtube'
            ? new YouTubeDeck(this.host(), track.source, events)
            : new AudioDeck(url, events)

        if (this.active) this.fadeOut(this.active, fadeMs > 0)
        this.active = entry
        this.view.trackId = track.id
        this.view.position = 0
        this.view.duration = 0
        this.applyVolume(entry)
        entry.deck.play()
        this.runFades()
        this.refreshView()
    }

    private handleFailure(entry: DeckEntry, reason: BgmDeckFailure) {
        if (this.active !== entry) return
        if (reason === 'blocked') {
            this.view.needsGesture = true
            this.view.notice = 'blocked'
            return
        }
        this.skipped.add(entry.track.id)
        this.playNext(false)
        // Starting the next track clears the notice; keep the reason this one was skipped visible.
        if (this.view.notice !== 'unavailable' && this.view.notice !== 'empty') this.view.notice = reason
    }

    private fadeOut(entry: DeckEntry, smooth: boolean) {
        if (!smooth) {
            entry.deck.destroy()
            return
        }
        entry.fadeTarget = 0
        entry.fadeRate = 1 / Math.max(1, this.settings.crossfadeMs)
        this.outgoing.add(entry)
    }

    private applyVolume(entry: DeckEntry) {
        entry.deck.setVolume(this.settings.volume * entry.track.gain * entry.fade * this.muteFactor)
    }

    private runFades() {
        if (this.fadeTimer) return
        this.lastFadeAt = performance.now()
        this.fadeTimer = setInterval(() => this.stepFades(), FADE_TICK_MS)
        this.stepFades()
    }

    private stepFades() {
        const now = performance.now()
        const elapsed = now - this.lastFadeAt
        this.lastFadeAt = now
        // Hidden tabs throttle timers to a crawl, so finish fades at once instead.
        const instant = document.visibilityState === 'hidden'
        const step = (value: number, target: number, rate: number) => {
            if (instant || rate <= 0) return target
            return value < target ? Math.min(target, value + rate * elapsed) : Math.max(target, value - rate * elapsed)
        }
        this.muteFactor = step(this.muteFactor, this.muteTarget, 1 / MUTE_FADE_MS)
        let moving = this.muteFactor !== this.muteTarget
        for (const entry of [this.active, ...this.outgoing]) {
            if (!entry) continue
            entry.fade = step(entry.fade, entry.fadeTarget, entry.fadeRate)
            this.applyVolume(entry)
            if (entry.fade !== entry.fadeTarget) moving = true
            else if (entry.fadeTarget === 0 && this.outgoing.has(entry)) {
                entry.deck.destroy()
                this.outgoing.delete(entry)
            }
        }
        if (!moving && this.fadeTimer) {
            clearInterval(this.fadeTimer)
            this.fadeTimer = null
        }
    }

    private refreshView() {
        const active = this.active
        this.view.playing = !!active && !active.deck.isPaused() && !this.view.needsGesture
        this.view.position = active?.deck.position() ?? 0
        this.view.duration = active?.deck.duration() ?? 0
        this.view.youtubeVisible = !!active?.youtube
        if (!active) this.view.trackId = ''
    }
}

export const bgmEngine = new BgmEngine()
