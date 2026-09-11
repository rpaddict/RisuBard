interface ResizeOptions {
    start: () => ((dx: number, dy: number) => void) | undefined
    reset: () => void
    end?: () => void
    cancel?: () => void
}

/** Shared pointer capture and keyboard controls for local editor resize handles. */
export function resizeHandle(node: HTMLElement, options: ResizeOptions) {
    const host = node.ownerDocument.defaultView!
    let drag: { id: number; x: number; y: number; move: (dx: number, dy: number) => void } | undefined
    function finish(commit = true) {
        const id = drag?.id
        drag = undefined
        delete node.dataset.resizing
        host.removeEventListener('pointermove', move, true)
        host.removeEventListener('pointerup', up, true)
        host.removeEventListener('pointercancel', cancel, true)
        if (id !== undefined && node.hasPointerCapture?.(id)) node.releasePointerCapture(id)
        if (id !== undefined) {
            if (commit) options.end?.()
            else if (options.cancel) options.cancel()
            else options.end?.()
        }
    }
    function down(event: PointerEvent) {
        if (event.button !== 0 || drag) return
        const applyDelta = options.start()
        if (!applyDelta) return
        event.preventDefault()
        event.stopPropagation()
        node.focus({ preventScroll: true })
        drag = { id: event.pointerId, x: event.clientX, y: event.clientY, move: applyDelta }
        node.dataset.resizing = 'true'
        node.setPointerCapture(event.pointerId)
        // Track the whole window while dragging, including hosts that do not retarget captured events.
        host.addEventListener('pointermove', move, true)
        host.addEventListener('pointerup', up, true)
        host.addEventListener('pointercancel', cancel, true)
    }
    function move(event: PointerEvent) {
        if (drag?.id === event.pointerId) drag.move(event.clientX - drag.x, event.clientY - drag.y)
    }
    function up(event: PointerEvent) {
        if (drag?.id === event.pointerId) finish()
    }
    function cancel(event: PointerEvent) {
        if (drag?.id === event.pointerId) finish(false)
    }
    function reset() { finish(false); options.reset(); options.end?.() }
    function key(event: KeyboardEvent) {
        if (event.key === 'Home') { event.preventDefault(); reset(); return }
        const step = event.shiftKey ? 48 : 16
        const delta = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[event.key]
        if (!delta) return
        event.preventDefault()
        event.stopPropagation()
        const applyDelta = options.start()
        if (applyDelta) { applyDelta(delta[0], delta[1]); options.end?.() }
    }
    node.addEventListener('pointerdown', down)
    node.addEventListener('lostpointercapture', up)
    node.addEventListener('dblclick', reset)
    node.addEventListener('keydown', key)
    return {
        update(next: ResizeOptions) { options = next },
        destroy() {
            finish(false)
            node.removeEventListener('pointerdown', down)
            node.removeEventListener('lostpointercapture', up)
            node.removeEventListener('dblclick', reset)
            node.removeEventListener('keydown', key)
        },
    }
}
