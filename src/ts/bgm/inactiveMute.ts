import type { BgmInactiveMute } from './library'

/** How often focus is re-checked in 'blur' mode. Leaving the window while an iframe has focus fires no event. */
const FOCUS_POLL_MS = 1000

export interface InactiveEnvironment {
    isHidden(): boolean
    /** True when focus is in this document or any iframe inside it. */
    hasFocus(): boolean
}

const browserEnvironment: InactiveEnvironment = {
    isHidden: () => document.visibilityState === 'hidden',
    hasFocus: () => document.hasFocus(),
}

export function isInactive(mode: BgmInactiveMute, env: InactiveEnvironment = browserEnvironment): boolean {
    if (mode === 'off') return false
    if (env.isHidden()) return true
    return mode === 'blur' && !env.hasFocus()
}

/**
 * Calls `onChange` whenever the page moves between active and inactive under the
 * current mode. Call `refresh` after the mode setting changes.
 */
export function watchInactive(getMode: () => BgmInactiveMute, onChange: (inactive: boolean) => void): { stop: () => void; refresh: () => void } {
    let last: boolean | null = null
    let poll: ReturnType<typeof setInterval> | null = null
    const check = () => {
        const mode = getMode()
        const next = isInactive(mode)
        if (mode === 'blur' && !poll) poll = setInterval(check, FOCUS_POLL_MS)
        if (mode !== 'blur' && poll) { clearInterval(poll); poll = null }
        if (next !== last) {
            last = next
            onChange(next)
        }
    }
    // Clicking into the YouTube iframe blurs the window first; hasFocus() settles a tick later.
    const deferredCheck = () => setTimeout(check, 0)
    document.addEventListener('visibilitychange', check)
    window.addEventListener('blur', deferredCheck)
    window.addEventListener('focus', check)
    window.addEventListener('pageshow', check)
    window.addEventListener('pagehide', check)
    check()
    const stop = () => {
        document.removeEventListener('visibilitychange', check)
        window.removeEventListener('blur', deferredCheck)
        window.removeEventListener('focus', check)
        window.removeEventListener('pageshow', check)
        window.removeEventListener('pagehide', check)
        if (poll) clearInterval(poll)
    }
    return { stop, refresh: check }
}
