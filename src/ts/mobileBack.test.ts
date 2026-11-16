import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { get, writable } from 'svelte/store'

vi.mock(import('./stores.svelte'), () => ({
    alertStore: writable({ type: 'none', msg: '' }),
    bookmarkListOpen: writable(false),
    characterAssistantOpen: writable(false),
    DynamicGUI: writable(false),
    promptAssistantOpen: writable(false),
    readerBoardOpen: writable(false),
    risuBardGalleryOpen: writable(false),
    settingsOpen: writable(false),
    sideBarClosing: writable(false),
    sideBarStore: writable(false),
}) as never)

const stores = await import('./stores.svelte')
const { closeTopScreen, registerAppBack } = await import('./mobileBack')
const { registerSettingsBack } = await import('./setting/settingsBack')

const releases: Array<() => void> = []

beforeEach(() => {
    stores.alertStore.set({ type: 'none', msg: '' } as never)
    for (const store of [stores.bookmarkListOpen, stores.characterAssistantOpen, stores.DynamicGUI,
        stores.promptAssistantOpen, stores.readerBoardOpen, stores.risuBardGalleryOpen,
        stores.settingsOpen, stores.sideBarClosing, stores.sideBarStore]) {
        store.set(false)
    }
    document.body.innerHTML = ''
})

afterEach(() => {
    releases.splice(0).forEach((release) => release())
})

describe('closeTopScreen', () => {
    test('returns false when nothing is open', async () => {
        expect(await closeTopScreen()).toBe(false)
    })

    test('steps back inside settings before closing them', async () => {
        stores.settingsOpen.set(true)
        let onSubPage = true
        releases.push(registerSettingsBack(() => {
            if (!onSubPage) return false
            onSubPage = false
            return true
        }))
        expect(await closeTopScreen()).toBe(true)
        expect(get(stores.settingsOpen)).toBe(true)
        expect(await closeTopScreen()).toBe(true)
        expect(get(stores.settingsOpen)).toBe(false)
    })

    test('closes store panels, then registered screens, then the mobile sidebar', async () => {
        stores.readerBoardOpen.set(true)
        let dockOpen = true
        releases.push(registerAppBack(() => {
            if (!dockOpen) return false
            dockOpen = false
            return true
        }))
        stores.DynamicGUI.set(true)
        stores.sideBarStore.set(true)

        expect(await closeTopScreen()).toBe(true)
        expect(get(stores.readerBoardOpen)).toBe(false)
        expect(dockOpen).toBe(true)

        expect(await closeTopScreen()).toBe(true)
        expect(dockOpen).toBe(false)
        expect(get(stores.sideBarClosing)).toBe(false)

        expect(await closeTopScreen()).toBe(true)
        expect(get(stores.sideBarClosing)).toBe(true)
    })

    test('leaves the desktop sidebar alone', async () => {
        stores.sideBarStore.set(true)
        expect(await closeTopScreen()).toBe(false)
    })

    test('sends Escape to an open dialog and reports whether it closed', async () => {
        const dialog = document.createElement('div')
        dialog.setAttribute('role', 'dialog')
        dialog.dataset.state = 'open'
        dialog.textContent = 'dialog'
        dialog.getClientRects = () => [{}] as unknown as DOMRectList
        document.body.appendChild(dialog)
        const onEscape = vi.fn((event: KeyboardEvent) => {
            if (event.key === 'Escape') dialog.remove()
        })
        document.addEventListener('keydown', onEscape)
        stores.settingsOpen.set(true)
        try {
            expect(await closeTopScreen()).toBe(true)
            expect(onEscape).toHaveBeenCalledOnce()
            // The dialog sat above settings, so settings stay open.
            expect(get(stores.settingsOpen)).toBe(true)
        } finally {
            document.removeEventListener('keydown', onEscape)
        }
    })

    test('treats a dialog that ignores Escape as nothing to close', async () => {
        const dialog = document.createElement('div')
        dialog.setAttribute('aria-modal', 'true')
        dialog.dataset.state = 'open'
        dialog.getClientRects = () => [{}] as unknown as DOMRectList
        document.body.appendChild(dialog)
        expect(await closeTopScreen()).toBe(false)
    })
})
