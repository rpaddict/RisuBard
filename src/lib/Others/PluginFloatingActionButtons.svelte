<script lang="ts">
    import type { MenuDef } from '../../ts/stores.svelte'
    import {
        DEFAULT_FAB_SIZE,
        FAB_DRAG_THRESHOLD,
        makeFabLayoutKey,
        placementFromClientPoint,
        resolveFabPosition,
        type FloatingActionButtonPlacement,
        type FloatingActionButtonSize,
    } from '../../ts/plugins/floatingActionButtonLayout'
    import PluginDefinedIcon from './PluginDefinedIcon.svelte'

    let {
        buttons,
        placements = {},
        onPlacementChange = () => {},
    }: {
        buttons: MenuDef[]
        placements?: Record<string, FloatingActionButtonPlacement>
        onPlacementChange?: (
            layoutKey: string,
            placement: FloatingActionButtonPlacement | null
        ) => void
    } = $props()

    interface DragState {
        pointerId: number
        layoutKey: string
        startClientX: number
        startClientY: number
        startLeft: number
        startTop: number
        size: FloatingActionButtonSize
        moved: boolean
    }

    let viewport = $state(readViewport())
    let transientPlacements = $state<Record<
        string,
        FloatingActionButtonPlacement
    >>({})
    let drag = $state<DragState | null>(null)
    let suppressClickKey = ''

    // The chat pane is the containing block for these fixed buttons (layout containment),
    // so positions are relative to the pane, which shrinks when side panels open.
    function readViewport() {
        const pane = document.querySelector<HTMLElement>('[data-chat-pane]')
        return {
            width: Math.max(1, pane?.clientWidth || window.innerWidth),
            height: Math.max(1, pane?.clientHeight || window.innerHeight),
        }
    }

    $effect(() => {
        const pane = document.querySelector<HTMLElement>('[data-chat-pane]')
        if (!pane || typeof ResizeObserver === 'undefined') return
        const observer = new ResizeObserver(() => viewport = readViewport())
        observer.observe(pane)
        return () => observer.disconnect()
    })

    function buttonLayoutKey(button: MenuDef): string {
        return button.layoutKey ?? makeFabLayoutKey(
            button.pluginName ?? 'legacy-plugin',
            button.id,
            button.name
        )
    }

    function buttonSize(element: HTMLButtonElement): FloatingActionButtonSize {
        const bounds = element.getBoundingClientRect()
        return {
            width: bounds.width || DEFAULT_FAB_SIZE.width,
            height: bounds.height || DEFAULT_FAB_SIZE.height,
        }
    }

    function currentPlacement(layoutKey: string) {
        const saved = placements && typeof placements === 'object'
            ? placements[layoutKey]
            : undefined
        return transientPlacements[layoutKey] ?? saved
    }

    function buttonPosition(button: MenuDef, index: number) {
        return resolveFabPosition(
            currentPlacement(buttonLayoutKey(button)),
            index,
            viewport
        )
    }

    function beginDrag(
        event: PointerEvent,
        button: MenuDef,
        index: number
    ) {
        if (event.button !== 0) return
        const element = event.currentTarget as HTMLButtonElement
        const layoutKey = buttonLayoutKey(button)
        const size = buttonSize(element)
        const position = resolveFabPosition(
            currentPlacement(layoutKey),
            index,
            viewport,
            size
        )
        element.setPointerCapture?.(event.pointerId)
        drag = {
            pointerId: event.pointerId,
            layoutKey,
            startClientX: event.clientX,
            startClientY: event.clientY,
            startLeft: position.left,
            startTop: position.top,
            size,
            moved: false,
        }
    }

    function moveDrag(event: PointerEvent) {
        if (!drag || event.pointerId !== drag.pointerId) return
        const deltaX = event.clientX - drag.startClientX
        const deltaY = event.clientY - drag.startClientY
        if (!drag.moved && Math.hypot(deltaX, deltaY) < FAB_DRAG_THRESHOLD) {
            return
        }
        event.preventDefault()
        drag.moved = true
        transientPlacements = {
            ...transientPlacements,
            [drag.layoutKey]: placementFromClientPoint(
                drag.startLeft + deltaX,
                drag.startTop + deltaY,
                viewport,
                drag.size
            ),
        }
    }

    function endDrag(event: PointerEvent) {
        if (!drag || event.pointerId !== drag.pointerId) return
        if (drag.moved) {
            const placement = transientPlacements[drag.layoutKey]
            if (placement) onPlacementChange(drag.layoutKey, placement)
            suppressClickKey = drag.layoutKey
            const suppressedKey = drag.layoutKey
            setTimeout(() => {
                if (suppressClickKey === suppressedKey) suppressClickKey = ''
            }, 0)
        }
        drag = null
    }

    function cancelDrag(event: PointerEvent) {
        if (!drag || event.pointerId !== drag.pointerId) return
        const cancelledKey = drag.layoutKey
        const { [cancelledKey]: _cancelled, ...remaining } = transientPlacements
        transientPlacements = remaining
        drag = null
    }

    function activate(event: MouseEvent, button: MenuDef) {
        const layoutKey = buttonLayoutKey(button)
        if (suppressClickKey === layoutKey) {
            suppressClickKey = ''
            event.preventDefault()
            event.stopPropagation()
            return
        }
        button.callback()
    }

    function repositionByKeyboard(
        event: KeyboardEvent,
        button: MenuDef,
        index: number
    ) {
        const layoutKey = buttonLayoutKey(button)
        if (event.key === 'Home') {
            event.preventDefault()
            const { [layoutKey]: _reset, ...remaining } = transientPlacements
            transientPlacements = remaining
            onPlacementChange(layoutKey, null)
            return
        }
        const direction = {
            ArrowLeft: [-1, 0],
            ArrowRight: [1, 0],
            ArrowUp: [0, -1],
            ArrowDown: [0, 1],
        }[event.key]
        if (!direction) return
        event.preventDefault()
        const element = event.currentTarget as HTMLButtonElement
        const size = buttonSize(element)
        const position = resolveFabPosition(
            currentPlacement(layoutKey),
            index,
            viewport,
            size
        )
        const step = event.shiftKey ? 24 : 8
        onPlacementChange(layoutKey, placementFromClientPoint(
            position.left + direction[0] * step,
            position.top + direction[1] * step,
            viewport,
            size
        ))
    }

</script>

<svelte:window onresize={() => viewport = readViewport()} />

{#each buttons as button, index (`${button.pluginName ?? 'legacy-plugin'}:${button.id}`)}
    {@const position = buttonPosition(button, index)}
    <button
        type="button"
        class="fixed z-50 flex cursor-move items-center gap-2 rounded-full bg-primary px-4 py-2 text-accenttext shadow-lg transition-colors hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        style:left={`${position.left}px`}
        style:top={`${position.top}px`}
        style:transform="translate(-50%, -50%)"
        style:touch-action="none"
        aria-label={button.name}
        aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight Home"
        title={button.name}
        data-plugin-fab={`${button.pluginName ?? 'legacy-plugin'}:${button.id}`}
        onpointerdown={(event) => beginDrag(event, button, index)}
        onpointermove={moveDrag}
        onpointerup={endDrag}
        onpointercancel={cancelDrag}
        onkeydown={(event) => repositionByKeyboard(event, button, index)}
        onclick={(event) => activate(event, button)}
    >
        <PluginDefinedIcon ico={button} />
    </button>
{/each}
