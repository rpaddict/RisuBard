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
const { closeTopScreen, registerAppBack, fillBackGuards, initMobileBack } = await import('./mobileBack')
const { registerFullscreenPluginFrame } = await import('./plugins/apiV3/pluginFrameLayer')
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

describe('fullscreen plugin frames', () => {
    test('hides the shown plugin frame before closing settings', async () => {
        const frame = document.createElement('iframe')
        frame.style.setProperty('display', 'block', 'important')
        document.body.appendChild(frame)
        registerFullscreenPluginFrame(frame)
        stores.settingsOpen.set(true)
        expect(await closeTopScreen()).toBe(true)
        expect(frame.style.display).toBe('none')
        expect(get(stores.settingsOpen)).toBe(true)
        expect(await closeTopScreen()).toBe(true)
        expect(get(stores.settingsOpen)).toBe(false)
    })
})

describe('back guards', () => {
    test('one gesture fills two guards for this page', () => {
        history.replaceState(null, '')
        const push = vi.spyOn(history, 'pushState')
        try {
            fillBackGuards(10_000)
            fillBackGuards(10_100) // the same tap's touchend and click
            const states = push.mock.calls.map((call) => call[0] as { risuBack: number, risuBackPage: string })
            expect(states.map((state) => state.risuBack)).toEqual([1, 2])
            expect(states[0].risuBackPage).toBeTruthy()
            expect(states[1].risuBackPage).toBe(states[0].risuBackPage)
            fillBackGuards(11_000) // already full
            expect(push).toHaveBeenCalledTimes(2)
        } finally {
            push.mockRestore()
            history.replaceState(null, '')
        }
    })

    test('guards inherited from an earlier page load count as absent', () => {
        // Android reloads a backgrounded PWA; the new page inherits the old history.state.
        history.replaceState({ risuBack: 2, risuBackPage: 'earlier-load' }, '')
        const push = vi.spyOn(history, 'pushState')
        try {
            fillBackGuards(20_000)
            expect(push.mock.calls.map((call) => (call[0] as { risuBack: number }).risuBack)).toEqual([1, 2])
        } finally {
            push.mockRestore()
            history.replaceState(null, '')
        }
    })

    test('pushes nothing until a user gesture and drops the guards when nothing is open', async () => {
        const matchMedia = vi.spyOn(window, 'matchMedia').mockImplementation((query: string) =>
            ({ matches: query === '(pointer: coarse)' }) as MediaQueryList)
        // A guard of this page, as a real gesture leaves it.
        history.replaceState(null, '')
        fillBackGuards(30_000)
        history.back()
        await new Promise((resolve) => setTimeout(resolve, 50))
        const guard = history.state
        const push = vi.spyOn(history, 'pushState')
        const go = vi.spyOn(history, 'go').mockImplementation(() => {})
        const onExitHint = vi.fn()
        try {
            initMobileBack(onExitHint)
            // A script-dispatched click carries no user activation.
            document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }))
            expect(push).not.toHaveBeenCalled()

            expect(guard.risuBack).toBe(1)
            window.dispatchEvent(new PopStateEvent('popstate', { state: guard }))
            // Android delivers one press twice; the second is ignored.
            window.dispatchEvent(new PopStateEvent('popstate', { state: null }))
            await vi.waitFor(() => expect(onExitHint).toHaveBeenCalledOnce())
            await new Promise((resolve) => setTimeout(resolve, 200))
            expect(onExitHint).toHaveBeenCalledOnce()
            expect(go).toHaveBeenCalledWith(-1)
            expect(push).not.toHaveBeenCalled()
        } finally {
            matchMedia.mockRestore()
            push.mockRestore()
            go.mockRestore()
        }
    })
})
