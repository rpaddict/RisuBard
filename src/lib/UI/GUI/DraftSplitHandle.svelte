<script lang="ts">
    import { resizeHandle } from 'src/ts/gui/resizeHandle'
    import { clearResizableSize, loadResizableSize, saveResizableSize } from 'src/ts/gui/resizableSize'

    let { target, ariaLabel, resizeStorageKey }: { target: HTMLElement | null; ariaLabel: string; resizeStorageKey?: string } = $props()
    let handleElement: HTMLButtonElement
    let restoredTarget: HTMLElement | null = null
    let restoredKey = ''
    let skipNextPersistence = false

    $effect(() => {
        const element = target
        const key = resizeStorageKey
        if (!element || !key || (restoredTarget === element && restoredKey === key)) return
        const saved = loadResizableSize(key)
        const availableWidth = Math.max(0, element.getBoundingClientRect().width - (handleElement?.getBoundingClientRect().width || 16))
        if (saved?.width && availableWidth > 0) {
            const minimumPaneWidth = Math.min(200, availableWidth / 2)
            const leftWidth = Math.min(availableWidth - minimumPaneWidth, Math.max(minimumPaneWidth, saved.width))
            element.style.setProperty('--draft-left-width', `${leftWidth}px`)
            element.style.setProperty('--draft-right-width', `${availableWidth - leftWidth}px`)
        }
        restoredTarget = element
        restoredKey = key
    })

    function startResize() {
        const element = target
        if (!element) return
        const availableWidth = Math.max(0, element.getBoundingClientRect().width - (handleElement.getBoundingClientRect().width || 16))
        const originalPane = element.querySelector<HTMLElement>('[data-draft-pane="original"]')
        const initialLeftWidth = originalPane?.getBoundingClientRect().width || availableWidth / 2
        const minimumPaneWidth = Math.min(200, availableWidth / 2)
        return (dx: number) => {
            const leftWidth = Math.min(availableWidth - minimumPaneWidth, Math.max(minimumPaneWidth, initialLeftWidth + dx))
            element.style.setProperty('--draft-left-width', `${leftWidth}px`)
            element.style.setProperty('--draft-right-width', `${availableWidth - leftWidth}px`)
        }
    }

    function resetSplit() {
        target?.style.removeProperty('--draft-left-width')
        target?.style.removeProperty('--draft-right-width')
        if (resizeStorageKey) clearResizableSize(resizeStorageKey)
        skipNextPersistence = true
    }

    function finishResize() {
        if (!skipNextPersistence && target && resizeStorageKey) {
            const originalPane = target.querySelector<HTMLElement>('[data-draft-pane="original"]')
            if (originalPane) saveResizableSize(resizeStorageKey, { width: originalPane.getBoundingClientRect().width })
        }
        skipNextPersistence = false
    }
</script>

<button
    bind:this={handleElement}
    type="button"
    data-draft-split-resize
    class="draft-split-resize"
    aria-label={ariaLabel}
    title={ariaLabel}
    use:resizeHandle={{ start: startResize, reset: resetSplit, end: finishResize }}
></button>

<style>
    .draft-split-resize {
        position: relative;
        width: 1rem;
        min-height: 2.75rem;
        padding: 0;
        border: 0;
        background: transparent;
        cursor: col-resize;
        touch-action: none;
    }
    .draft-split-resize::after {
        position: absolute;
        top: 1rem;
        bottom: 1rem;
        left: calc(50% - 1px);
        width: 2px;
        border-radius: 999px;
        background: var(--color-darkborderc);
        content: '';
        transition: background-color 160ms ease, width 160ms ease;
    }
    .draft-split-resize:hover::after,
    .draft-split-resize:focus-visible::after,
    .draft-split-resize:global([data-resizing])::after {
        width: 3px;
        background: var(--color-borderc);
    }
    .draft-split-resize:focus-visible {
        border-radius: .35rem;
        outline: 2px solid var(--color-borderc);
        outline-offset: -2px;
    }
    @media (max-width: 700px) {
        .draft-split-resize { display: none; }
    }
</style>
