import { afterEach, describe, expect, test, vi } from 'vitest'
import { loadResizableSize, persistElementHeight, saveResizableSize } from './resizableSize'

afterEach(() => {
    localStorage.clear()
    vi.unstubAllGlobals()
})

describe('resizable size persistence', () => {
    test('round-trips finite positive dimensions and ignores invalid storage', () => {
        saveResizableSize('prompt-v2-frame', { width: 960, height: 720 })
        expect(loadResizableSize('prompt-v2-frame')).toEqual({ width: 960, height: 720 })

        localStorage.setItem('risubard:resizable-size:v1:broken', '{"height":-20}')
        expect(loadResizableSize('broken')).toBeNull()
    })

    test('restores and observes a user-resized element height', () => {
        saveResizableSize('prompt-v2-body', { height: 480 })
        let notify: ResizeObserverCallback | undefined
        vi.stubGlobal('ResizeObserver', class {
            constructor(callback: ResizeObserverCallback) { notify = callback }
            observe() {}
            disconnect() {}
        })
        const field = document.createElement('textarea')
        field.getBoundingClientRect = () => ({ height: 640 } as DOMRect)

        const action = persistElementHeight(field, 'prompt-v2-body')
        expect(field.style.height).toBe('480px')
        notify?.([], {} as ResizeObserver)
        expect(loadResizableSize('prompt-v2-body')).toEqual({ height: 640 })
        action.destroy()
    })
})
