// One playing track. The engine keeps up to two decks alive to crossfade between them.

export type BgmDeckFailure = 'blocked' | 'unavailable' | 'embed-refused'

export interface BgmDeckEvents {
    onEnded: () => void
    onFailure: (reason: BgmDeckFailure) => void
    onPlaying: () => void
    /** The source's own title, when the player learns it (YouTube). */
    onTitle?: (title: string) => void
}

export interface BgmDeck {
    play(): void
    pause(): void
    seek(seconds: number): void
    /** 0..1, already including master volume, track gain and fades. */
    setVolume(volume: number): void
    position(): number
    duration(): number
    isPaused(): boolean
    destroy(): void
}

export class AudioDeck implements BgmDeck {
    private audio: HTMLAudioElement
    private destroyed = false

    constructor(url: string, private events: BgmDeckEvents) {
        this.audio = new Audio()
        this.audio.preload = 'auto'
        this.audio.volume = 0
        this.audio.addEventListener('ended', () => { if (!this.destroyed) events.onEnded() })
        this.audio.addEventListener('playing', () => { if (!this.destroyed) events.onPlaying() })
        this.audio.addEventListener('error', () => { if (!this.destroyed) events.onFailure('unavailable') })
        this.audio.src = url
    }

    play() {
        this.audio.play().catch((error: unknown) => {
            if (this.destroyed) return
            // NotAllowedError: the browser wants a click before sound. Load errors arrive via 'error'.
            if (error instanceof DOMException && error.name === 'NotAllowedError') this.events.onFailure('blocked')
        })
    }
    pause() { this.audio.pause() }
    seek(seconds: number) { if (Number.isFinite(seconds)) this.audio.currentTime = Math.max(0, seconds) }
    setVolume(volume: number) { this.audio.volume = Math.min(1, Math.max(0, volume)) }
    position() { return this.audio.currentTime || 0 }
    duration() { return Number.isFinite(this.audio.duration) ? this.audio.duration : 0 }
    isPaused() { return this.audio.paused }
    destroy() {
        this.destroyed = true
        this.audio.pause()
        this.audio.removeAttribute('src')
        this.audio.load()
    }
}
