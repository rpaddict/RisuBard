type ActivateRisuTrigger = (origin: Element) => void | Promise<void>

function findTriggerOrigin(target: EventTarget | null): Element | null {
    return target instanceof Element
        ? target.closest('[risu-trigger], [risu-btn]')
        : null
}

function triggerKey(origin: Element) {
    return ['risu-trigger', 'risu-btn', 'risu-id']
        .map((name) => origin.getAttribute(name) ?? '')
        .join('\u0000')
}

// A click later than this after the pointerdown is a new press, not the same one.
const SAME_PRESS_MS = 1000

export function createRisuTriggerActivation(
    activate: ActivateRisuTrigger,
    options: { pointerDownFallback?: boolean } = {},
) {
    let pointerOrigin: Element | null = null
    let pointerKey = ''
    let pointerAt = 0

    return {
        async pointerdown(event: PointerEvent) {
            if (!options.pointerDownFallback || event.button !== 0) return
            const origin = findTriggerOrigin(event.target)
            if (!origin) return
            pointerOrigin = origin
            pointerKey = triggerKey(origin)
            pointerAt = Date.now()
            await activate(origin)
        },
        async click(event: MouseEvent) {
            const pressed = pointerOrigin
            pointerOrigin = null
            const origin = findTriggerOrigin(event.target)
            if (!origin) return
            // The script run by pointerdown may redraw the message before the click arrives; the click then
            // lands on the redrawn copy of the same button, which must not run it a second time.
            if (pressed && Date.now() - pointerAt < SAME_PRESS_MS
                && (origin === pressed || (!pressed.isConnected && triggerKey(origin) === pointerKey))) return
            await activate(origin)
        },
    }
}
