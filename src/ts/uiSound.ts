// Button feedback sounds (hover and click) for the whole app.
//
// One delegated listener set on the document covers every control, so
// components need no per-button wiring. A control is anything with a button-like
// role or tag, or any element the page styles with a pointer cursor (many
// sidebar rows are clickable divs). A control can opt out with
// `data-ui-sound="off"`. The default click is a bundled file, the default
// hover is synthesized with Web Audio, and the user can replace either with a
// sound uploaded to the button-sound list (`customUiSounds`), which is kept
// apart from the notification jingles.

import { get } from 'svelte/store'
import { DBState } from './stores.svelte'
import { doingChat } from './process/generationState'
import { getFileSrc } from './globalApi.svelte'
import click1 from '../etc/sounds/ui/click_1.mp3'

/** Bundled button sounds: short dry ticks only, never notification jingles. */
export const bundledUiSounds: Record<string, string> = {
    click_1: click1,
}

/** What an empty stored value plays for each kind; '' for hover means the synthesized tick. */
const DEFAULT_UI_SOUND: Record<'click' | 'hover', string> = {
    click: 'click_1',
    hover: '',
}

export type UiSoundKind = 'click' | 'hover'

export const UI_SOUND_TARGET_SELECTOR = [
    'button',
    'a[href]',
    'summary',
    'label',
    'select',
    'input[type="checkbox"]',
    'input[type="radio"]',
    '[role="button"]',
    '[role="menuitem"]',
    '[role="menuitemcheckbox"]',
    '[role="menuitemradio"]',
    '[role="switch"]',
    '[role="checkbox"]',
    '[role="radio"]',
    '[role="tab"]',
    '[role="option"]',
    '[role="combobox"]',
    '[role="treeitem"]',
].join(',')

/** Typing surfaces never click, even when a parent row is clickable. */
const TEXT_ENTRY_SELECTOR = 'textarea, [contenteditable=""], [contenteditable="true"], input:not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="range"]):not([type="color"]):not([type="file"])'

/** Rapid sweeps across a dense grid must not chatter. */
const HOVER_MIN_INTERVAL_MS = 70
/** How far up a pointer-cursor element is searched for. */
const MAX_POINTER_DEPTH = 8

interface UiSoundSettings {
    enabled: boolean
    click: boolean
    hover: boolean
    volume: number
    clickSound: string
    hoverSound: string
}

function readSettings(): UiSoundSettings {
    const db = DBState.db
    return {
        enabled: db?.uiSoundEnabled !== false,
        click: db?.uiSoundClick !== false,
        hover: db?.uiSoundHover !== false,
        volume: Math.min(100, Math.max(0, db?.uiSoundVolume ?? 50)),
        clickSound: db?.uiSoundClickSound ?? '',
        hoverSound: db?.uiSoundHoverSound ?? '',
    }
}

function hasPointerCursor(element: Element): boolean {
    return getComputedStyle(element).cursor === 'pointer'
}

/** The control a pointer event belongs to, or null when it should stay silent. */
export function findUiSoundTarget(target: EventTarget | null): HTMLElement | null {
    if (!(target instanceof Element)) return null
    if (target.closest('[data-ui-sound="off"]')) return null
    if (target.closest(TEXT_ENTRY_SELECTOR)) return null
    let control = target.closest<HTMLElement>(UI_SOUND_TARGET_SELECTOR)
    if (!control) {
        // Cursor is inherited, so climb to the outermost pointer element: that
        // is the clickable row, and it stays the same while the mouse moves
        // across its children.
        let node: Element | null = target
        let found: HTMLElement | null = null
        for (let depth = 0; node && node !== document.body && depth < MAX_POINTER_DEPTH; depth++) {
            if (!hasPointerCursor(node)) break
            if (node instanceof HTMLElement) found = node
            node = node.parentElement
        }
        control = found
    }
    if (!control) return null
    if (control.matches(':disabled, [aria-disabled="true"], [data-disabled]')) return null
    return control
}

let audioContext: AudioContext | null = null

function getAudioContext(): AudioContext | null {
    if (typeof window === 'undefined' || typeof window.AudioContext === 'undefined') return null
    audioContext ??= new window.AudioContext()
    // Browsers keep the context suspended until a user gesture; resuming
    // outside one just fails quietly and the next press succeeds.
    if (audioContext.state === 'suspended') void audioContext.resume().catch(() => {})
    return audioContext
}

const customBuffers = new Map<string, Promise<AudioBuffer | null>>()
const lastSource: Partial<Record<UiSoundKind, AudioScheduledSourceNode>> = {}

/**
 * The file a stored value plays, or null for the synthesized hover. Values that
 * are neither an upload nor a bundled button sound (for example a notification
 * preset id) fall back to the kind's default.
 */
async function resolveUiSoundUrl(kind: UiSoundKind, value: string): Promise<string | null> {
    if (value.startsWith('assets/')) {
        const url = await getFileSrc(value)
        if (url) return url
    }
    const id = bundledUiSounds[value] ? value : DEFAULT_UI_SOUND[kind]
    return bundledUiSounds[id] ?? null
}

function loadCustomBuffer(ctx: AudioContext, url: string): Promise<AudioBuffer | null> {
    let pending = customBuffers.get(url)
    if (!pending) {
        pending = (async () => {
            try {
                const response = await fetch(url)
                return await ctx.decodeAudioData(await response.arrayBuffer())
            } catch {
                return null
            }
        })()
        customBuffers.set(url, pending)
    }
    return pending
}

function playBuffer(ctx: AudioContext, kind: UiSoundKind, buffer: AudioBuffer, level: number) {
    // A long uploaded sound must not pile up under fast clicks.
    try { lastSource[kind]?.stop() } catch { /* already ended */ }
    const source = ctx.createBufferSource()
    const gain = ctx.createGain()
    source.buffer = buffer
    gain.gain.value = level
    source.connect(gain)
    gain.connect(ctx.destination)
    source.start()
    lastSource[kind] = source
}

function playBuiltinHover(ctx: AudioContext, level: number) {
    const now = ctx.currentTime
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(2600, now)
    osc.frequency.exponentialRampToValueAtTime(2200, now + 0.03)
    gain.gain.setValueAtTime(0.0001, now)
    gain.gain.exponentialRampToValueAtTime(level, now + 0.003)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.03)
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.start(now)
    osc.stop(now + 0.04)
    lastSource.hover = osc
}

function schedule(ctx: AudioContext, kind: UiSoundKind, volume: number, sound: string) {
    const scale = volume / 100
    void resolveUiSoundUrl(kind, sound).then((url) => {
        if (!url) {
            playBuiltinHover(ctx, scale * 0.07)
            return
        }
        void loadCustomBuffer(ctx, url).then((buffer) => {
            if (buffer) playBuffer(ctx, kind, buffer, scale * (kind === 'click' ? 0.8 : 0.4))
        })
    })
}

/** Decode the chosen sounds before the first press so it is not late. */
function warmUp(settings: UiSoundSettings) {
    const ctx = getAudioContext()
    if (!ctx) return
    for (const kind of ['click', 'hover'] as const) {
        const value = kind === 'click' ? settings.clickSound : settings.hoverSound
        void resolveUiSoundUrl(kind, value).then((url) => { if (url) void loadCustomBuffer(ctx, url) })
    }
}

/** Play one feedback sound. `sound` is '' for the kind's default, else a bundled button-sound id or an uploaded asset path. */
export function playUiSound(kind: UiSoundKind, volume?: number, sound?: string) {
    const settings = readSettings()
    const level = volume ?? settings.volume
    const chosen = sound ?? (kind === 'click' ? settings.clickSound : settings.hoverSound)
    const ctx = getAudioContext()
    if (!ctx || level <= 0) return
    if (ctx.state === 'running') {
        schedule(ctx, kind, level, chosen)
    } else if (kind === 'click') {
        // A press is a user gesture, so the resume started above will succeed.
        void ctx.resume().then(() => {
            if (ctx.state === 'running') schedule(ctx, kind, level, chosen)
        }).catch(() => {})
    }
}

/** Settings preview: plays even while the feature is off. */
export function previewUiSound(kind: UiSoundKind, sound?: string, volume?: number) {
    playUiSound(kind, volume, sound)
}

let lastHoverControl: HTMLElement | null = null
let lastHoverAt = 0
/** Set when a mouse or pen press already played; its trailing click stays silent. */
let pressedAt = -Infinity

function onPointerOver(event: PointerEvent) {
    // Touch has no hover; a tap would otherwise sound twice.
    if (event.pointerType !== 'mouse') return
    const settings = readSettings()
    if (!settings.enabled || !settings.hover) {
        lastHoverControl = null
        return
    }
    const control = findUiSoundTarget(event.target)
    if (control === lastHoverControl) return
    lastHoverControl = control
    if (!control) return
    warmUp(settings)
    // Messages stream in under the pointer while a reply is generating.
    if (get(doingChat)) return
    const now = performance.now()
    if (now - lastHoverAt < HOVER_MIN_INTERVAL_MS) return
    lastHoverAt = now
    playUiSound('hover', settings.volume)
}

function onPointerDown(event: PointerEvent) {
    if (!event.isTrusted) return
    const settings = readSettings()
    if (!settings.enabled) return
    warmUp(settings)
    // Touch presses may become scrolls, so touch waits for the click.
    if (event.pointerType === 'touch' || event.button !== 0) return
    // Sound on press: some controls (dropdowns, menus) act and re-render on
    // press, so their click event never reaches the original element.
    if (!settings.click || !findUiSoundTarget(event.target)) return
    pressedAt = performance.now()
    playUiSound('click', settings.volume)
}

function onClick(event: MouseEvent) {
    // Scripted clicks (hidden file inputs, programmatic triggers) stay silent.
    if (!event.isTrusted) return
    // A mouse press already sounded; detail 0 is a keyboard activation.
    if (event.detail > 0 && performance.now() - pressedAt < 1500) return
    const settings = readSettings()
    if (!settings.enabled || !settings.click) return
    if (!findUiSoundTarget(event.target)) return
    playUiSound('click', settings.volume)
}

let installed = false

export function installUiSounds() {
    if (installed || typeof document === 'undefined') return
    installed = true
    document.addEventListener('pointerdown', onPointerDown, { capture: true, passive: true })
    document.addEventListener('pointerover', onPointerOver, { capture: true, passive: true })
    document.addEventListener('click', onClick, { capture: true, passive: true })
}
