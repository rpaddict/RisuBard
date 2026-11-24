import Sortable from 'sortablejs'

export interface SortableListParams {
    /** Called with element indexes after a drag. The caller reorders its array; Svelte redraws the list. */
    onMove: (from: number, to: number) => void
    /**
     * Elements outside the list that accept a dragged item (another slot, for a track).
     * Dropping on one calls `onDrop` instead of reordering.
     */
    dropTarget?: {
        selector: string
        onDrop: (index: number, target: HTMLElement) => void
    }
}

const DROP_HOVER_CLASS = 'is-drop-hover'

/**
 * Drag sorting for a list whose direct children are the items. Only `[data-sort-handle]`
 * starts a drag, so inputs inside a row keep working.
 */
export function sortableList(node: HTMLElement, params: SortableListParams) {
    let current = params
    let pointer: { x: number; y: number } | null = null
    let hovered: HTMLElement | null = null

    const targetAt = (point: { x: number; y: number } | null): HTMLElement | null => {
        if (!point || !current.dropTarget) return null
        const element = document.elementFromPoint(point.x, point.y)
        return (element?.closest(current.dropTarget.selector) as HTMLElement | null) ?? null
    }
    const setHovered = (element: HTMLElement | null) => {
        if (hovered === element) return
        hovered?.classList.remove(DROP_HOVER_CLASS)
        hovered = element
        hovered?.classList.add(DROP_HOVER_CLASS)
    }
    const track = (event: PointerEvent | TouchEvent) => {
        const touch = 'touches' in event ? event.touches[0] : null
        pointer = touch ? { x: touch.clientX, y: touch.clientY } : { x: (event as PointerEvent).clientX, y: (event as PointerEvent).clientY }
        setHovered(targetAt(pointer))
    }

    const instance = Sortable.create(node, {
        handle: '[data-sort-handle]',
        animation: 150,
        ghostClass: 'risu-ghost-item',
        chosenClass: 'risu-chosen-item',
        // Pointer-driven dragging (not native drag and drop) so drop targets also work by touch.
        forceFallback: !!params.dropTarget,
        fallbackOnBody: true,
        onStart() {
            pointer = null
            document.addEventListener('pointermove', track)
            document.addEventListener('touchmove', track, { passive: true })
        },
        onEnd(event) {
            document.removeEventListener('pointermove', track)
            document.removeEventListener('touchmove', track)
            const target = targetAt(pointer)
            setHovered(null)
            const { item, oldIndex, newIndex } = event
            if (oldIndex === undefined || newIndex === undefined) return
            if (oldIndex !== newIndex) {
                // Undo SortableJS's own DOM move so Svelte stays the only owner of the list order.
                item.remove()
                node.insertBefore(item, node.children[oldIndex] ?? null)
            }
            if (target && current.dropTarget) current.dropTarget.onDrop(oldIndex, target)
            else if (oldIndex !== newIndex) current.onMove(oldIndex, newIndex)
        },
    })
    return {
        update(next: SortableListParams) { current = next },
        destroy() {
            document.removeEventListener('pointermove', track)
            document.removeEventListener('touchmove', track)
            setHovered(null)
            instance.destroy()
        },
    }
}

/** Arrow-key fallback on a drag handle. */
export function handleSortKey(event: KeyboardEvent, index: number, length: number, move: (from: number, to: number) => void) {
    const to = event.key === 'ArrowUp' ? index - 1 : event.key === 'ArrowDown' ? index + 1 : -1
    if (to < 0 || to >= length) return
    event.preventDefault()
    move(index, to)
    const handle = event.currentTarget as HTMLElement
    const list = handle.closest('[data-sort-list]')
    requestAnimationFrame(() => (list?.children[to]?.querySelector('[data-sort-handle]') as HTMLElement | null)?.focus())
}
