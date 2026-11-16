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

// Android back button / back gesture. The app never pushes history entries,
// so in an installed PWA the back button closes the app even while settings,
// a panel or a dialog is open. While enabled, one guard entry is kept on the
// history stack; each back press pops it, closes the topmost screen, and puts
// the guard back. With nothing left to close the first press shows a hint and
// leaves the guard off briefly, so a second press exits as before.

const GUARD_STATE = { risuBack: true }
const EXIT_WINDOW_MS = 2500
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

export function initMobileBack(onExitHint: () => void) {
    if (!shouldHandleBackButton()) return
    const isGuard = (state: unknown) => !!(state as typeof GUARD_STATE | null)?.risuBack
    const pushGuard = () => {
        if (!isGuard(history.state)) history.pushState(GUARD_STATE, '')
    }
    let exitTimer: ReturnType<typeof setTimeout> | null = null
    window.addEventListener('popstate', (event) => {
        if (isGuard(event.state)) return
        if (exitTimer) {
            clearTimeout(exitTimer)
            exitTimer = null
        }
        void closeTopScreen()
            .catch((error) => {
                console.warn('[mobile back]', error)
                return true
            })
            .then((closed) => {
                if (closed) {
                    pushGuard()
                    return
                }
                onExitHint()
                exitTimer = setTimeout(() => {
                    exitTimer = null
                    pushGuard()
                }, EXIT_WINDOW_MS)
            })
    })
    pushGuard()
}
