export function observeChatScroll(container: HTMLElement, capture: () => void, restore: () => void) {
    let frame: number | null = null
    let userFrame: number | null = null
    let ownScrollTop: number | null = null
    let destroyed = false
    const previousOverflowAnchor = container.style.overflowAnchor
    container.style.overflowAnchor = 'none'

    function cancelCorrection() {
        if (frame !== null) cancelAnimationFrame(frame)
        frame = null
    }

    function correct() {
        cancelCorrection()
        if (destroyed || userFrame !== null) return
        restore()
        // A reload that empties a message first shrinks the content, and the browser clamps
        // scrollTop. Its scroll event arrives after this layout pass; capturing there would
        // replace the reading anchor with the collapsed layout.
        ownScrollTop = container.scrollTop
    }

    function queueCorrection() {
        if (frame === null) frame = requestAnimationFrame(correct)
    }

    function directInteraction(event: Event) {
        if (event instanceof KeyboardEvent && !['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) return
        cancelCorrection()
        ownScrollTop = null
        if (userFrame !== null) cancelAnimationFrame(userFrame)
        // Input fires before its default scrolling action. Read the new position afterward.
        userFrame = requestAnimationFrame(() => {
            userFrame = null
            capture()
        })
    }

    function onScroll() {
        if (ownScrollTop !== null && Math.abs(container.scrollTop - ownScrollTop) < 0.5) {
            ownScrollTop = null
            return
        }
        ownScrollTop = null
        cancelCorrection()
        capture()
    }

    // The viewport has a fixed height, so observe its message boxes as well.
    // ResizeObserver runs after layout and before paint; don't delay it another frame.
    const resize = new ResizeObserver(correct)
    let messages = new Set<Element>()
    function observeMessages() {
        const next = new Set(container.querySelectorAll('[data-chat-index]'))
        for (const message of messages) if (!next.has(message)) resize.unobserve(message)
        for (const message of next) if (!messages.has(message)) resize.observe(message)
        messages = next
    }
    resize.observe(container)
    observeMessages()
    const mutation = new MutationObserver(() => { observeMessages(); queueCorrection() })
    mutation.observe(container, { childList: true, characterData: true, subtree: true })
    const inputs = ['wheel', 'touchstart', 'touchmove', 'pointerdown', 'keydown']
    for (const input of inputs) container.addEventListener(input, directInteraction, { passive: true })
    container.addEventListener('scroll', onScroll)
    capture()

    return {
        markProgrammaticScroll() {
            // An explicit jump also queues a scroll event. Its target must survive
            // async message layout until ResizeObserver can restore that anchor.
            ownScrollTop = container.scrollTop
        },
        reset() {
            cancelCorrection()
            if (userFrame !== null) cancelAnimationFrame(userFrame)
            userFrame = null
            ownScrollTop = null
        },
        destroy() {
            destroyed = true
            this.reset()
            mutation.disconnect()
            resize.disconnect()
            for (const input of inputs) container.removeEventListener(input, directInteraction)
            container.removeEventListener('scroll', onScroll)
            container.style.overflowAnchor = previousOverflowAnchor
        },
    }
}
