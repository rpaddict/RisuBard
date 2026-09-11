import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { createRawSnippet, mount, tick, unmount } from 'svelte'
import CollectionOrganizerList from './CollectionOrganizerList.svelte'
import { requestImmediateSave } from 'src/ts/globalApi.svelte'

vi.mock('src/ts/globalApi.svelte', () => ({ requestImmediateSave: vi.fn() }))
const db = vi.hoisted(() => ({ collectionOrganizers: undefined as any }))
vi.mock('src/ts/storage/database.svelte', () => ({ getDatabase: () => db }))
vi.mock('src/ts/alert', () => ({ alertConfirm: vi.fn(), alertInput: vi.fn() }))

let mounted: ReturnType<typeof mount> | undefined
let resizeObserverCallback: ResizeObserverCallback
const disconnect = vi.fn()
beforeEach(() => {
    vi.clearAllMocks()
    db.collectionOrganizers = undefined
    vi.stubGlobal('ResizeObserver', class {
        constructor(callback: ResizeObserverCallback) { resizeObserverCallback = callback }
        observe() {}
        disconnect = disconnect
    })
})
afterEach(async () => {
    if (mounted) await unmount(mounted)
    mounted = undefined
    document.body.replaceChildren()
    vi.unstubAllGlobals()
})

async function organizer(width = 1000, height = 600, managerLayout = false) {
    mounted = mount(CollectionOrganizerList, {
        target: document.body,
        props: {
            kind: 'modules', collectionLabel: 'Modules', items: [{ id: 'one', title: 'One' }],
            managerLayout,
            itemContent: createRawSnippet(() => ({ render: () => '<span>One</span>' })),
        },
    })
    await tick()
    const root = document.querySelector<HTMLElement>('[data-collection-organizer-list]')!
    const pane = root.querySelector<HTMLElement>('aside')!
    root.getBoundingClientRect = () => ({ width, height } as DOMRect)
    pane.getBoundingClientRect = () => ({ width: 272, height: 192 } as DOMRect)
    resizeObserverCallback?.([{ contentRect: { width, height } } as ResizeObserverEntry], {} as ResizeObserver)
    await tick()
    const splitter = root.querySelector<HTMLElement>('[data-collection-splitter]')
    expect(splitter, 'folders and items have an operable separator').not.toBeNull()
    return { root, splitter: splitter! }
}

describe('responsive collection pane resizing', () => {
    test.each([false, true])('keeps collection drops local (manager layout: %s)', async (managerLayout) => {
        db.collectionOrganizers = { modules: {
            folders: [{ id: 'folder', name: 'Folder', createdAt: 1 }],
            folderByItemId: {}, itemOrder: ['one'],
        } }
        const { root } = await organizer(1000, 600, managerLayout)
        const appDragOver = vi.fn((event: DragEvent) => {
            event.preventDefault()
            event.dataTransfer!.dropEffect = 'none'
        })
        const appDrop = vi.fn()
        root.addEventListener('dragover', appDragOver)
        root.addEventListener('drop', appDrop)
        const dataTransfer = new DataTransfer()
        const dragEvent = (type: string) => {
            const event = new Event(type, { bubbles: true, cancelable: true })
            Object.defineProperty(event, 'dataTransfer', { value: dataTransfer })
            return event
        }
        root.querySelector(managerLayout ? '[data-collection-item-drag-handle]' : '[data-collection-drag-handle]')!.dispatchEvent(
            dragEvent('dragstart'),
        )
        await tick()
        const folder = root.querySelector('.collection-folder')!
        const uncategorized = root.querySelectorAll('aside > div > button')[1]
        for (const target of [folder, uncategorized, root.querySelector('.collection-item')!]) {
            const over = dragEvent('dragover')
            target.dispatchEvent(over)
            expect(over.defaultPrevented).toBe(true)
            expect(dataTransfer.dropEffect).toBe('move')
        }
        expect(appDragOver).not.toHaveBeenCalled()
        folder.dispatchEvent(dragEvent('drop'))
        expect(db.collectionOrganizers.modules.folderByItemId.one).toBe('folder')
        expect(requestImmediateSave).toHaveBeenCalledOnce()
        expect(appDrop).not.toHaveBeenCalled()
    })

    test('resizes horizontal panes with keyboard controls without saving collection data', async () => {
        const { root, splitter } = await organizer()
        expect(splitter.getAttribute('aria-orientation')).toBe('vertical')
        splitter.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
        expect(root.style.getPropertyValue('--collection-folder-width')).toBe('288px')
        expect(requestImmediateSave).not.toHaveBeenCalled()
        splitter.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }))
        expect(root.style.getPropertyValue('--collection-folder-width')).toBe('')
    })

    test('switches to vertical resizing at a narrow container width', async () => {
        const { root, splitter } = await organizer(390)
        expect(splitter.getAttribute('aria-orientation')).toBe('horizontal')
        splitter.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
        expect(root.style.getPropertyValue('--collection-folder-height')).toBe('208px')
        expect(root.style.getPropertyValue('--collection-folder-width')).toBe('')
        splitter.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
        expect(root.style.getPropertyValue('--collection-folder-height')).toBe('')
    })

    test('clamps both panes during a pointer drag and stops on cancellation', async () => {
        const { root, splitter } = await organizer()
        splitter.setPointerCapture = vi.fn()
        splitter.hasPointerCapture = vi.fn(() => true)
        splitter.releasePointerCapture = vi.fn()
        splitter.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 9, clientX: 272, bubbles: true }))
        window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 9, clientX: 5000 }))
        expect(parseFloat(root.style.getPropertyValue('--collection-folder-width'))).toBeLessThanOrEqual(1000 - 320)
        window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 9, clientX: -5000 }))
        expect(parseFloat(root.style.getPropertyValue('--collection-folder-width'))).toBeGreaterThanOrEqual(208)
        window.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 9 }))
        const saved = root.getAttribute('style')
        window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 9, clientX: 500 }))
        expect(root.getAttribute('style')).toBe(saved)
    })

    test('disconnects layout observation when the manager closes', async () => {
        await organizer()
        await unmount(mounted!)
        mounted = undefined
        expect(disconnect).toHaveBeenCalledOnce()
    })
})
