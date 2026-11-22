import { get } from 'svelte/store'
import {
    alertStore,
    bookmarkListOpen,
    characterAssistantOpen,
    DynamicGUI,
    promptAssistantOpen,
    readerBoardOpen,
    risuBardGalleryOpen,
    settingsOpen,
    sideBarClosing,
    sideBarStore,
} from './stores.svelte'
import { goBackInSettings } from './setting/settingsBack'
import { hideTopFullscreenPluginFrame } from './plugins/apiV3/pluginFrameLayer'

// Android back button / back gesture. The app never pushes history entries,
// so in an installed PWA the back button closes the app even while settings,
// a panel or a dialog is open. While enabled, guard entries are kept on the
// history stack; each back press pops one and closes the topmost screen.
// With nothing left to close the press shows a hint and drops the remaining
// guards, so the next press exits as before.
//
// Guards are only pushed while handling a user gesture; one gesture fills the
// stack up to GUARD_DEPTH. Chrome marks the entry before a pushState made
// without user activation as skipped by the back button, so such a guard would
// send the back button straight out of the app ("Leave site?").
//
// Guards carry a per-page-load token. When Android reloads a backgrounded PWA,
// the new page inherits history.state from the old one ({ risuBack: 2 }), but
// those entries belong to the old document: going back to them leaves the page
// instead of firing popstate. Guards with another token count as absent, so
// the next gesture stacks fresh ones on top.
//
// On an Android PWA one back press delivers popstate twice, 20-40 ms apart,
// even with a single guard. A popstate that follows another within
// DUPLICATE_POP_MS is the same press and is ignored, so one press closes one
// screen and does not run past the guard.

const GUARD_DEPTH = 2
/** One tap fires pointerup, touchend and click; it fills the guards once. */
const GUARD_GESTURE_MS = 500
const DUPLICATE_POP_MS = 150
const DIALOG_SELECTOR = '[aria-modal="true"][data-state="open"],[role="dialog"][data-state="open"]'
// Escape-driven closes (bits-ui dialogs, AlertComp) settle asynchronously.
const ESCAPE_SETTLE_MS = 150

/** Screens without a store (e.g. the BardWiki dock) register while open. */
const handlers: Array<() => boolean> = []

export function registerAppBack(handler: () => boolean) {
    handlers.push(handler)
    return () => {
        const index = handlers.indexOf(handler)
        if (index >= 0) handlers.splice(index, 1)
    }
}

// Read lazily: hotkey.ts imports this module, and many test mocks of
// stores.svelte only define the stores their subject uses.
const panelStores = () => [
    readerBoardOpen,
    characterAssistantOpen,
    promptAssistantOpen,
    risuBardGalleryOpen,
    bookmarkListOpen,
]

function isAlerting() {
    const type = get(alertStore).type
    return type !== 'none' && type !== 'wait'
}

function openDialogCount() {
    return [...document.querySelectorAll(DIALOG_SELECTOR)]
        .filter((element) => element.getClientRects().length > 0).length
}

function dispatchEscape() {
    const active = document.activeElement
    const target = active instanceof HTMLElement && active !== document.body ? active : document.body
    target.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Escape',
        code: 'Escape',
        bubbles: true,
        cancelable: true,
    }))
}

/**
 * Closes the topmost screen. Resolves false when nothing could be closed —
 * including a dialog that ignores Escape, so the back button never gets stuck.
 */
export async function closeTopScreen(): Promise<boolean> {
    const dialogs = openDialogCount()
    const alerting = isAlerting()
    if (dialogs > 0 || alerting) {
        dispatchEscape()
        await new Promise((resolve) => setTimeout(resolve, ESCAPE_SETTLE_MS))
        return openDialogCount() < dialogs || (alerting && !isAlerting())
    }
    if (hideTopFullscreenPluginFrame()) return true
    if (get(settingsOpen)) {
        if (!goBackInSettings()) settingsOpen.set(false)
        return true
    }
    for (const store of panelStores()) {
        if (get(store)) {
            store.set(false)
            return true
        }
    }
    for (const handler of [...handlers].reverse()) {
        if (handler()) return true
    }
    if (get(DynamicGUI) && get(sideBarStore)) {
        sideBarClosing.set(true)
        return true
    }
    return false
}

export function shouldHandleBackButton() {
    return window.matchMedia('(display-mode: standalone)').matches
        || window.matchMedia('(pointer: coarse)').matches
}

const pageToken = `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`

const guardLevel = (state: unknown) => {
    const guard = state as { risuBack?: unknown, risuBackPage?: unknown } | null
    return guard?.risuBackPage === pageToken ? Number(guard.risuBack) || 0 : 0
}

let lastGuardAt = Number.NEGATIVE_INFINITY

/** Fills guard entries up to GUARD_DEPTH; call only during a user gesture. */
export function fillBackGuards(now = Date.now()) {
    let level = guardLevel(history.state)
    if (level >= GUARD_DEPTH || now - lastGuardAt < GUARD_GESTURE_MS) return
    lastGuardAt = now
    while (level < GUARD_DEPTH) {
        level += 1
        history.pushState({ risuBack: level, risuBackPage: pageToken }, '')
    }
}

export function initMobileBack(onExitHint: () => void) {
    if (!shouldHandleBackButton()) return
    for (const type of ['click', 'pointerup', 'touchend', 'keydown']) {
        // Script-dispatched events (such as the Escape sent above) carry no activation.
        window.addEventListener(type, (event) => {
            if (event.isTrusted) fillBackGuards()
        }, true)
    }
    let skipPop = false
    let lastPopAt = Number.NEGATIVE_INFINITY
    window.addEventListener('popstate', (event) => {
        if (skipPop) {
            skipPop = false
            return
        }
        const now = Date.now()
        if (now - lastPopAt < DUPLICATE_POP_MS) return
        lastPopAt = now
        // Not refilled here: a back press is not a user activation.
        const level = guardLevel(event.state)
        void closeTopScreen()
            .catch((error) => {
                console.warn('[mobile back]', error)
                return true
            })
            .then((closed) => {
                if (closed) return
                onExitHint()
                if (level > 0) {
                    skipPop = true
                    history.go(-level)
                }
            })
    })
}
