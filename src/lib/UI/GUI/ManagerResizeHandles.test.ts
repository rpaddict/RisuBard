import { afterEach, describe, expect, test, vi } from 'vitest'
import { mount, tick, unmount } from 'svelte'
import { readFileSync } from 'node:fs'
import SettingPage from './SettingPage.svelte'
import ManagerResizeHandles from './ManagerResizeHandles.svelte'

let mounted: ReturnType<typeof mount> | undefined
afterEach(async () => {
    if (mounted) await unmount(mounted)
    mounted = undefined
    document.body.replaceChildren()
    vi.restoreAllMocks()
})

async function manager(resizeStorageKey?: string) {
    const host = document.body.appendChild(document.createElement('div'))
    host.className = 'settings-content'
    Object.defineProperty(host, 'clientWidth', { value: 1000 })
    mounted = mount(SettingPage, { target: host, props: { title: 'Modules', resizable: true, resizeStorageKey } })
    await tick()
    const page = host.querySelector<HTMLElement>('[data-settings-page]')!
    page.getBoundingClientRect = () => {
        const width = parseFloat(page.style.getPropertyValue('--manager-width')) || 800
        const height = parseFloat(page.style.getPropertyValue('--manager-height')) || 500
        return { x: 0, y: 0, left: 0, top: 0, right: width, bottom: height, width, height, toJSON() {} }
    }
    const handle = page.querySelector<HTMLElement>('[data-manager-window-resize="se"]')
    expect(handle, 'resizable managers expose a visible corner handle').not.toBeNull()
    return { host, page, handle: handle! }
}

describe('manager window resize controls', () => {
    test('keeps ordinary settings pages unchanged', async () => {
        mounted = mount(SettingPage, { target: document.body, props: { title: 'Normal' } })
        await tick()
        expect(document.querySelector('[data-manager-window-resize]')).toBeNull()
    })

    test('resizes an inline manager with the keyboard and resets with Home', async () => {
        const { page, handle } = await manager()
        handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
        expect(page.style.getPropertyValue('--manager-width')).toBe('832px')
        handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', shiftKey: true, bubbles: true }))
        expect(page.style.getPropertyValue('--manager-height')).toBe('596px')
        handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }))
        expect(page.style.getPropertyValue('--manager-width')).toBe('')
        expect(page.style.getPropertyValue('--manager-height')).toBe('')
    })

    test('bounds pointer resizing to the parent and viewport and cleans up after cancellation', async () => {
        const { page, handle } = await manager()
        handle.setPointerCapture = vi.fn()
        handle.hasPointerCapture = vi.fn(() => true)
        handle.releasePointerCapture = vi.fn()
        handle.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 3, clientX: 800, clientY: 500, bubbles: true }))
        window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 3, clientX: 3000, clientY: 3000 }))
        expect(parseFloat(page.style.getPropertyValue('--manager-width'))).toBe(984)
        expect(parseFloat(page.style.getPropertyValue('--manager-height'))).toBeLessThanOrEqual(window.innerHeight - 16)
        window.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 3 }))
        const saved = page.getAttribute('style')
        window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 3, clientX: 0, clientY: 0 }))
        expect(page.getAttribute('style')).toBe(saved)
        expect(handle.releasePointerCapture).toHaveBeenCalledWith(3)
        handle.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
        expect(page.style.getPropertyValue('--manager-width')).toBe('')
    })

    test('removes active drag listeners on unmount', async () => {
        const { page, handle } = await manager()
        handle.setPointerCapture = vi.fn()
        handle.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 4, clientX: 800, bubbles: true }))
        await unmount(mounted!)
        mounted = undefined
        window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 4, clientX: 900 }))
        expect(page.style.getPropertyValue('--manager-width')).toBe('')
    })

    test('resizes centered dialogs from both sides without exceeding small viewports', async () => {
        const target = document.body.appendChild(document.createElement('div'))
        target.getBoundingClientRect = () => ({ width: 800, height: 500 } as DOMRect)
        mounted = mount(ManagerResizeHandles, { target, props: { target, centered: true } })
        await tick()
        expect(target.querySelectorAll('[data-manager-window-resize]')).toHaveLength(8)
        const west = target.querySelector<HTMLElement>('[data-manager-window-resize="w"]')!
        west.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
        expect(target.style.getPropertyValue('--manager-width')).toBe('768px')
        vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(360)
        vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(300)
        const corner = target.querySelector<HTMLElement>('[data-manager-window-resize="se"]')!
        corner.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }))
        corner.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }))
        expect(target.style.getPropertyValue('--manager-width')).toBe('344px')
        expect(target.style.getPropertyValue('--manager-height')).toBe('284px')
    })

    test('resizes a right-anchored popover from its left and bottom edges', async () => {
        const target = document.body.appendChild(document.createElement('div'))
        target.getBoundingClientRect = () => ({ width: 928, height: 700 } as DOMRect)
        mounted = mount(ManagerResizeHandles, {
            target,
            props: { target, rightAnchored: true },
        })
        await tick()

        expect([...target.querySelectorAll('[data-manager-window-resize]')]
            .map((handle) => handle.getAttribute('data-manager-window-resize')))
            .toEqual(['w', 's', 'sw'])
        target.querySelector<HTMLElement>('[data-manager-window-resize="w"]')!
            .dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
        expect(target.style.getPropertyValue('--manager-width')).toBe('912px')
    })

    test('previews pointer resizing with a shadow and commits layout once on release', async () => {
        const target = document.body.appendChild(document.createElement('div'))
        target.getBoundingClientRect = () => {
            const width = parseFloat(target.style.getPropertyValue('--manager-width')) || 800
            const height = parseFloat(target.style.getPropertyValue('--manager-height')) || 500
            return { x: 200, y: 100, left: 200, top: 100, right: 200 + width, bottom: 600, width, height, toJSON() {} }
        }
        const onResizeEnd = vi.fn()
        mounted = mount(ManagerResizeHandles, {
            target,
            props: { target, rightAnchored: true, shadowPreview: true, onResizeEnd },
        })
        await tick()

        const handle = target.querySelector<HTMLElement>('[data-manager-window-resize="w"]')!
        handle.setPointerCapture = vi.fn()
        handle.hasPointerCapture = vi.fn(() => true)
        handle.releasePointerCapture = vi.fn()
        handle.dispatchEvent(new PointerEvent('pointerdown', {
            pointerId: 9, button: 0, clientX: 200, clientY: 300, bubbles: true,
        }))
        window.dispatchEvent(new PointerEvent('pointermove', {
            pointerId: 9, clientX: 100, clientY: 300,
        }))

        expect(target.style.getPropertyValue('--manager-width')).toBe('')
        const shadow = document.querySelector<HTMLElement>('[data-manager-resize-shadow]')
        expect(shadow).not.toBeNull()
        expect(shadow?.style.width).toBe('900px')
        expect(shadow?.style.left).toBe('100px')

        window.dispatchEvent(new PointerEvent('pointerup', {
            pointerId: 9, clientX: 100, clientY: 300,
        }))

        expect(target.style.getPropertyValue('--manager-width')).toBe('900px')
        expect(document.querySelector('[data-manager-resize-shadow]')).toBeNull()
        expect(onResizeEnd).toHaveBeenCalledOnce()
    })

    test('reports the resized target after a committed resize', async () => {
        const target = document.body.appendChild(document.createElement('div'))
        target.getBoundingClientRect = () => ({ width: 800, height: 500 } as DOMRect)
        const onResizeEnd = vi.fn()
        mounted = mount(ManagerResizeHandles, { target, props: { target, centered: true, onResizeEnd } })
        await tick()

        target.querySelector<HTMLElement>('[data-manager-window-resize="e"]')!
            .dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))

        expect(onResizeEnd).toHaveBeenCalledOnce()
        expect(onResizeEnd).toHaveBeenCalledWith(target)
    })

    test('restores, updates, and resets a named frame size', async () => {
        localStorage.setItem('risubard:resizable-size:v1:prompt-v2-frame', JSON.stringify({ width: 900, height: 700 }))
        const { page, handle } = await manager('prompt-v2-frame')
        expect(page.style.getPropertyValue('--manager-width')).toBe('900px')
        expect(page.style.getPropertyValue('--manager-height')).toBe('700px')

        handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
        expect(JSON.parse(localStorage.getItem('risubard:resizable-size:v1:prompt-v2-frame')!)).toEqual({ width: 932, height: 700 })

        handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }))
        expect(localStorage.getItem('risubard:resizable-size:v1:prompt-v2-frame')).toBeNull()
    })

    test('uses the full settings width for resizable managers while keeping preset comparison bounded', () => {
        const settingPage = readFileSync('src/lib/UI/GUI/SettingPage.svelte', 'utf8')
        const settings = readFileSync('src/lib/Setting/Settings.svelte', 'utf8')
        const presets = readFileSync('src/lib/Setting/botpreset.svelte', 'utf8')
        expect(settingPage).toContain('width: var(--manager-width, 100%)')
        expect(settingPage).toContain('max-width: calc(100vw - 1rem)')
        expect(settings).toContain('settings-page--collection')
        expect(settings).toMatch(/\.settings-page:has\(> :global\(\.settings-standard-page--resizable\)\)[^{]*\{[^}]*padding-bottom:\s*0/s)
        expect(settings).toContain('.settings-content--mobile-collection:has(:global(.settings-standard-page--resizable))')
        expect(presets).toContain('83.2rem')
        expect(presets).toContain('<ManagerResizeHandles')
        expect(presets).toContain('<ShDialog')
    })

    test('keeps preset comparison inside the dialog focus and pointer scope', () => {
        const presets = readFileSync('src/lib/Setting/botpreset.svelte', 'utf8')
        expect(presets.indexOf('<PromptDiffModal')).toBeLessThan(presets.indexOf('</ShDialog>'))
    })
})
