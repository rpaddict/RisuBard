import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { flushSync, mount, unmount } from 'svelte'
import { get } from 'svelte/store'
import PersonaManager from './PersonaManager.svelte'
import { openPersonaManager } from 'src/ts/stores.svelte'

// Isolate the manager shell from persona editing, help dialogs, and application data.
vi.mock('../Setting/Pages/PersonaSettings.svelte', () => ({ default: () => {} }))
vi.mock('src/ts/alert', () => ({ alertMd: vi.fn() }))
vi.mock('src/ts/gui/tooltip', () => ({ tooltip: () => {} }))
vi.mock('src/ts/personaScopes', () => ({ getEffectivePersona: () => null }))
vi.mock('src/ts/stores.svelte', async () => {
    const { writable } = await import('svelte/store')
    return {
        DBState: { db: { characters: [] } },
        selectedCharID: writable(-1),
        openPersonaManager: writable(true),
        personaSelectCallback: writable(null),
    }
})

let mounted: ReturnType<typeof mount> | undefined
const widthKey = 'risubard-persona-manager-width'
const pointer = (target: EventTarget, type: string, clientX = 0) => {
    target.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 1, clientX }))
    flushSync()
}
const open = () => {
    mounted = mount(PersonaManager, { target: document.body })
    flushSync()
    return {
        backdrop: document.querySelector('.persona-manager-backdrop')!,
        handle: document.querySelector('[data-persona-manager-resizer]')!,
        dialog: document.querySelector('dialog')!,
    }
}

beforeEach(() => {
    vi.stubGlobal('innerWidth', 1600)
    localStorage.clear()
    openPersonaManager.set(true)
})
afterEach(async () => {
    if (mounted) await unmount(mounted)
    mounted = undefined
    document.body.innerHTML = ''
    vi.unstubAllGlobals()
})

describe('persona manager resize', () => {
    test('uses the viewport minus margins instead of a fixed width cap', () => {
        const { handle, dialog } = open()
        pointer(handle, 'pointerdown', 100)
        pointer(window, 'pointermove', 3000)
        pointer(window, 'pointerup', 3000)
        expect(dialog.style.getPropertyValue('--persona-manager-width')).toBe('1568px')
        expect(localStorage.getItem(widthKey)).toBe('1568')
    })

    test('clamps restored widths and follows a shrinking viewport', () => {
        localStorage.setItem(widthKey, '2000')
        const { dialog } = open()
        expect(dialog.style.getPropertyValue('--persona-manager-width')).toBe('1568px')
        vi.stubGlobal('innerWidth', 480)
        window.dispatchEvent(new Event('resize'))
        flushSync()
        expect(dialog.style.getPropertyValue('--persona-manager-width')).toBe('448px')
    })

    test('does not dismiss a drag released on the backdrop, but allows a fresh backdrop click', () => {
        const { handle, backdrop } = open()
        pointer(handle, 'pointerdown', 100)
        pointer(window, 'pointermove', 3000)
        pointer(backdrop, 'pointerup', 3000)
        backdrop.dispatchEvent(new MouseEvent('click', { bubbles: true }))
        expect(get(openPersonaManager)).toBe(true)
        pointer(backdrop, 'pointerdown')
        pointer(backdrop, 'pointerup')
        backdrop.dispatchEvent(new MouseEvent('click', { bubbles: true }))
        expect(get(openPersonaManager)).toBe(false)
    })

    test.each(['pointercancel', 'blur'])('ends resizing on %s', (eventType) => {
        const { handle, dialog } = open()
        pointer(handle, 'pointerdown', 100)
        pointer(window, 'pointermove', 200)
        window.dispatchEvent(new Event(eventType))
        const width = dialog.style.getPropertyValue('--persona-manager-width')
        pointer(window, 'pointermove', 300)
        expect(dialog.style.getPropertyValue('--persona-manager-width')).toBe(width)
    })
})
