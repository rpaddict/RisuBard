import type { BgmDeck, BgmDeckEvents } from './decks'

// Minimal typing for the YouTube IFrame Player API.
interface YTPlayer {
    playVideo(): void
    pauseVideo(): void
    seekTo(seconds: number, allowSeekAhead: boolean): void
    setVolume(volume: number): void
    unMute(): void
    getCurrentTime(): number
    getDuration(): number
    getPlayerState(): number
    getVideoData?(): { title?: string }
    destroy(): void
}
interface YTNamespace {
    Player: new (element: HTMLElement, options: Record<string, unknown>) => YTPlayer
}
declare global {
    interface Window {
        YT?: YTNamespace
        onYouTubeIframeAPIReady?: () => void
    }
}

const STATE_ENDED = 0
const STATE_PLAYING = 1
const STATE_PAUSED = 2
const STATE_BUFFERING = 3
/** Without a click the iframe stays unstarted; after this long the engine asks for one. */
const START_TIMEOUT_MS = 4000

let apiPromise: Promise<YTNamespace> | null = null

export function loadYouTubeApi(): Promise<YTNamespace> {
    if (window.YT?.Player) return Promise.resolve(window.YT)
    apiPromise ??= new Promise<YTNamespace>((resolve, reject) => {
        const previous = window.onYouTubeIframeAPIReady
        window.onYouTubeIframeAPIReady = () => {
            previous?.()
            if (window.YT) resolve(window.YT)
        }
        const script = document.createElement('script')
        script.src = 'https://www.youtube.com/iframe_api'
        script.async = true
        script.onerror = () => {
            apiPromise = null
            script.remove()
            reject(new Error('YouTube player could not be loaded'))
        }
        document.head.appendChild(script)
    })
    return apiPromise
}

export class YouTubeDeck implements BgmDeck {
    private player: YTPlayer | null = null
    private ready = false
    private destroyed = false
    private wantPlaying = false
    private volume = 0
    private startTimer: ReturnType<typeof setTimeout> | null = null
    readonly element: HTMLDivElement

    constructor(
        host: HTMLElement,
        private source: { videoId: string; start?: number; end?: number },
        private events: BgmDeckEvents,
    ) {
        this.element = document.createElement('div')
        this.element.className = 'bgm-youtube-deck'
        const mount = document.createElement('div')
        this.element.appendChild(mount)
        host.appendChild(this.element)
        loadYouTubeApi().then((YT) => {
            if (this.destroyed) return
            this.player = new YT.Player(mount, {
                width: '100%',
                height: '100%',
                videoId: source.videoId,
                playerVars: {
                    autoplay: 0,
                    controls: 0,
                    disablekb: 1,
                    fs: 0,
                    playsinline: 1,
                    rel: 0,
                    iv_load_policy: 3,
                    ...(source.start ? { start: source.start } : {}),
                    ...(source.end ? { end: source.end } : {}),
                },
                events: {
                    onReady: () => {
                        if (this.destroyed) return
                        this.ready = true
                        this.player!.unMute()
                        this.player!.setVolume(Math.round(this.volume * 100))
                        const title = this.player!.getVideoData?.()?.title?.trim()
                        if (title) events.onTitle?.(title)
                        if (this.wantPlaying) this.startPlayback()
                    },
                    onStateChange: (event: { data: number }) => {
                        if (this.destroyed) return
                        if (event.data === STATE_PLAYING) {
                            this.clearStartTimer()
                            events.onPlaying()
                        }
                        else if (event.data === STATE_ENDED) events.onEnded()
                    },
                    onError: (event: { data: number }) => {
                        if (this.destroyed) return
                        this.clearStartTimer()
                        // 101 and 150: the owner disabled embedding. 2, 5, 100: bad id, player error, removed.
                        events.onFailure(event.data === 101 || event.data === 150 ? 'embed-refused' : 'unavailable')
                    },
                },
            })
        }).catch(() => {
            if (!this.destroyed) events.onFailure('unavailable')
        })
    }

    private clearStartTimer() {
        if (this.startTimer) clearTimeout(this.startTimer)
        this.startTimer = null
    }

    private startPlayback() {
        this.player!.playVideo()
        this.clearStartTimer()
        this.startTimer = setTimeout(() => {
            this.startTimer = null
            if (this.destroyed || !this.wantPlaying || !this.player) return
            const state = this.player.getPlayerState()
            if (state !== STATE_PLAYING && state !== STATE_BUFFERING) this.events.onFailure('blocked')
        }, START_TIMEOUT_MS)
    }

    play() {
        this.wantPlaying = true
        if (this.ready) this.startPlayback()
    }
    pause() {
        this.wantPlaying = false
        this.clearStartTimer()
        if (this.ready) this.player!.pauseVideo()
    }
    seek(seconds: number) {
        if (this.ready && Number.isFinite(seconds)) this.player!.seekTo(Math.max(0, seconds) + (this.source.start ?? 0), true)
    }
    setVolume(volume: number) {
        this.volume = Math.min(1, Math.max(0, volume))
        if (this.ready) this.player!.setVolume(Math.round(this.volume * 100))
    }
    position() {
        return this.ready ? Math.max(0, this.player!.getCurrentTime() - (this.source.start ?? 0)) : 0
    }
    duration() {
        if (!this.ready) return 0
        const end = this.source.end ?? this.player!.getDuration()
        return Math.max(0, end - (this.source.start ?? 0))
    }
    isPaused() {
        if (!this.ready) return !this.wantPlaying
        const state = this.player!.getPlayerState()
        return state === STATE_PAUSED || state === STATE_ENDED || !this.wantPlaying
    }
    destroy() {
        this.destroyed = true
        this.clearStartTimer()
        try { this.player?.destroy() } catch { /* iframe already gone */ }
        this.element.remove()
    }
}
