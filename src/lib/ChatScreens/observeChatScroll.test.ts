import { afterEach, expect, test, vi } from 'vitest'
import { observeChatScroll } from './observeChatScroll'

afterEach(() => { vi.unstubAllGlobals(); document.body.innerHTML = '' })

function setup() {
    let mutation: () => void = () => {}
    let resize: () => void = () => {}
    const frames = new Map<number, FrameRequestCallback>()
    let id = 0
    vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => { frames.set(++id, fn); return id })
    vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
    const disconnect = vi.fn()
    const observe = vi.fn()
    vi.stubGlobal('MutationObserver', class { constructor(fn: () => void) { mutation = fn } observe = vi.fn(); disconnect = disconnect })
    vi.stubGlobal('ResizeObserver', class { constructor(fn: () => void) { resize = fn } observe = observe; unobserve = vi.fn(); disconnect = disconnect })
    const container = document.createElement('div')
    container.innerHTML = '<div data-chat-index="0"></div>'
    document.body.append(container)
    let height = 100
    let baseline = 0
    const capture = vi.fn(() => { baseline = height - container.scrollTop })
    const restore = vi.fn(() => { container.scrollTop = height - baseline })
    const controller = observeChatScroll(container, capture, restore)
    const frame = () => { const pending = [...frames.values()]; frames.clear(); pending.forEach(fn => fn(0)) }
    return { container, capture, restore, controller, frame, frames, observe, disconnect,
        mutate: () => mutation(), resize: () => resize(), grow: () => { height += 50 } }
}

test('coalesces streaming mutations and corrects late image resize before paint without timers', () => {
    const s = setup()
    s.frame()
    s.grow(); s.mutate(); s.mutate(); s.frame()
    expect(s.container.scrollTop).toBe(50)
    expect(s.restore).toHaveBeenCalledTimes(1)
    s.grow(); s.resize()
    expect(s.container.scrollTop).toBe(100)
    expect(s.observe).toHaveBeenCalledWith(s.container.firstElementChild)
})

test.each(['wheel', 'touchmove', 'pointerdown', 'keydown'])('uses the position after %s as baseline and never pulls it back later', (input) => {
    const s = setup(); s.frame()
    s.controller.markProgrammaticScroll()
    s.grow(); s.mutate()
    s.container.dispatchEvent(input === 'keydown' ? new KeyboardEvent(input, { key: 'PageDown' }) : new Event(input))
    s.container.scrollTop = 30
    s.container.dispatchEvent(new Event('scroll'))
    s.frame()
    expect(s.container.scrollTop).toBe(30)
    s.grow(); s.resize()
    expect(s.container.scrollTop).toBe(80)
})

test('ignores its own scroll event and disconnects pending work', () => {
    const s = setup(); s.frame(); s.capture.mockClear()
    s.grow(); s.resize(); s.container.dispatchEvent(new Event('scroll'))
    expect(s.capture).not.toHaveBeenCalled()
    s.mutate(); s.controller.destroy(); s.frame()
    expect(s.restore).toHaveBeenCalledTimes(1)
    expect(s.disconnect).toHaveBeenCalledTimes(2)
    expect(s.container.style.overflowAnchor).toBe('')
})

test('still captures another programmatic navigation after a marked jump', () => {
    const s = setup()
    s.controller.markProgrammaticScroll()
    s.capture.mockClear()
    s.container.scrollTop = 30
    s.container.dispatchEvent(new Event('scroll'))
    expect(s.capture).toHaveBeenCalledOnce()
    s.grow(); s.resize()
    expect(s.container.scrollTop).toBe(80)
})

test('keeps the reading anchor when a collapsing reload clamps the scroll position', () => {
    const s = setup(); s.frame(); s.capture.mockClear()
    // The browser clamps scrollTop during layout; restore cannot move it any further.
    s.restore.mockImplementation(() => {})
    s.container.scrollTop = 0
    s.resize()
    s.container.dispatchEvent(new Event('scroll'))
    expect(s.capture).not.toHaveBeenCalled()
    // A later move is still the reader's.
    s.container.scrollTop = 40
    s.container.dispatchEvent(new Event('scroll'))
    expect(s.capture).toHaveBeenCalledOnce()
})
