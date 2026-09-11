<script lang="ts">
    import { onDestroy } from 'svelte'
    import { language } from 'src/lang'
    import { resizeHandle } from 'src/ts/gui/resizeHandle'
    import { clearResizableSize, loadResizableSize, saveResizableSize } from 'src/ts/gui/resizableSize'

    let { target, centered = false, rightAnchored = false, unboundedHeight = false, shadowPreview = false, resizeStorageKey, onResizeEnd }: {
        target: HTMLElement | null
        centered?: boolean
        rightAnchored?: boolean
        unboundedHeight?: boolean
        shadowPreview?: boolean
        resizeStorageKey?: string
        onResizeEnd?: (target: HTMLElement) => void
    } = $props()
    const edges = $derived(centered
        ? ['n', 'e', 's', 'w', 'ne', 'se', 'sw', 'nw']
        : rightAnchored ? ['w', 's', 'sw'] : ['e', 's', 'se'])
    let restoredTarget: HTMLElement | null = null
    let restoredKey = ''
    let skipNextPersistence = false
    let pendingSize: { width?: number; height?: number } | undefined
    let resizeShadow: HTMLElement | undefined

    function removeResizeShadow() {
        resizeShadow?.remove()
        resizeShadow = undefined
    }

    function updateResizeShadow(
        element: HTMLElement,
        rect: DOMRect,
        width: number,
        height: number,
        edge: string,
    ) {
        resizeShadow ??= element.ownerDocument.body.appendChild(
            element.ownerDocument.createElement('div')
        )
        resizeShadow.dataset.managerResizeShadow = 'true'
        resizeShadow.setAttribute('aria-hidden', 'true')
        const left = centered
            ? rect.left + (rect.width - width) / 2
            : edge.includes('w') ? rect.right - width : rect.left
        const top = edge.includes('n') ? rect.bottom - height : rect.top
        Object.assign(resizeShadow.style, {
            left: `${left}px`,
            top: `${top}px`,
            width: `${width}px`,
            height: `${height}px`,
        })
    }

    onDestroy(removeResizeShadow)

    $effect(() => {
        const element = target
        const key = resizeStorageKey
        if (!element || !key || (restoredTarget === element && restoredKey === key)) return
        const saved = loadResizableSize(key)
        if (saved?.width) element.style.setProperty('--manager-width', `${saved.width}px`)
        if (saved?.height) element.style.setProperty('--manager-height', `${saved.height}px`)
        restoredTarget = element
        restoredKey = key
    })

    function startResize(edge: string) {
        const element = target
        if (!element) return
        const host = element.ownerDocument.defaultView!
        const rect = element.getBoundingClientRect()
        const { width, height } = rect
        const parent = element.parentElement
        const parentStyle = parent && host.getComputedStyle(parent)
        const parentWidth = parent ? parent.clientWidth - (parseFloat(parentStyle!.paddingLeft) || 0) - (parseFloat(parentStyle!.paddingRight) || 0) : host.innerWidth
        const settingsViewport = element.closest<HTMLElement>('.settings-content')
        const viewportWidth = settingsViewport?.clientWidth ?? host.innerWidth
        const maxWidth = Math.max(0, centered || rightAnchored
            ? viewportWidth - 16
            : Math.min(parentWidth, viewportWidth - 16))
        const maxHeight = Math.max(0, host.innerHeight - 16)
        const x = edge.includes('e') ? 1 : edge.includes('w') ? -1 : 0
        const y = edge.includes('s') ? 1 : edge.includes('n') ? -1 : 0
        const scale = centered ? 2 : 1
        return (dx: number, dy: number) => {
            const nextWidth = x && dx
                ? Math.min(maxWidth, Math.max(Math.min(480, maxWidth), width + dx * x * scale))
                : width
            const nextHeight = y && dy
                ? Math.max(Math.min(320, maxHeight), height + dy * y * scale)
                : height
            const boundedHeight = unboundedHeight ? nextHeight : Math.min(maxHeight, nextHeight)
            if (shadowPreview) {
                pendingSize = {
                    ...(x && dx ? { width: nextWidth } : {}),
                    ...(y && dy ? { height: boundedHeight } : {}),
                }
                updateResizeShadow(element, rect, nextWidth, boundedHeight, edge)
                return
            }
            if (x && dx) element.style.setProperty('--manager-width', `${nextWidth}px`)
            if (y && dy) {
                element.style.setProperty('--manager-height', `${boundedHeight}px`)
            }
        }
    }

    function resetSize() {
        pendingSize = undefined
        removeResizeShadow()
        target?.style.removeProperty('--manager-width')
        target?.style.removeProperty('--manager-height')
        if (resizeStorageKey) clearResizableSize(resizeStorageKey)
        skipNextPersistence = true
    }

    function finishResize() {
        if (target && pendingSize) {
            if (pendingSize.width !== undefined) {
                target.style.setProperty('--manager-width', `${pendingSize.width}px`)
            }
            if (pendingSize.height !== undefined) {
                target.style.setProperty('--manager-height', `${pendingSize.height}px`)
            }
        }
        pendingSize = undefined
        removeResizeShadow()
        if (!skipNextPersistence && target && resizeStorageKey) {
            const { width, height } = target.getBoundingClientRect()
            saveResizableSize(resizeStorageKey, { width, height })
        }
        skipNextPersistence = false
        if (target) onResizeEnd?.(target)
    }

    function cancelResize() {
        pendingSize = undefined
        removeResizeShadow()
    }
</script>

{#each edges as edge}
    <button type="button" class="manager-window-resize" class:right-anchored={rightAnchored} data-manager-window-resize={edge}
        aria-label={`${language.collectionOrganizer.resizeWindow} · ${edge.toUpperCase()}`}
        title={language.collectionOrganizer.resizeHint}
        use:resizeHandle={{ start: () => startResize(edge), reset: resetSize, end: finishResize, cancel: cancelResize }}></button>
{/each}

<style>
    .manager-window-resize { position: absolute; z-index: 10; border: 0; padding: 0; background: transparent; touch-action: none; }
    :global([data-manager-resize-shadow]) { position: fixed; z-index: 1000; box-sizing: border-box; contain: strict; pointer-events: none; border: 1px solid color-mix(in srgb, var(--risu-theme-primary) 78%, var(--color-textcolor)); border-radius: .42rem; background: color-mix(in srgb, var(--risu-theme-primary) 8%, transparent); box-shadow: 0 0 0 1px color-mix(in srgb, var(--risu-theme-primary) 24%, transparent), 0 1rem 2.5rem color-mix(in srgb, var(--color-shadow) 34%, transparent); }
    .manager-window-resize:hover, .manager-window-resize:focus-visible, .manager-window-resize:global([data-resizing]) { background: color-mix(in srgb, var(--color-borderc) 45%, transparent); outline: none; }
    [data-manager-window-resize='n'], [data-manager-window-resize='s'] { left: 1rem; right: 1rem; height: .5rem; cursor: ns-resize; }
    [data-manager-window-resize='e'], [data-manager-window-resize='w'] { top: 1rem; bottom: 1rem; width: .5rem; cursor: ew-resize; }
    [data-manager-window-resize='n'] { top: 0; }
    [data-manager-window-resize='s'] { bottom: 0; }
    [data-manager-window-resize='e'] { right: 0; }
    [data-manager-window-resize='w'] { left: 0; }
    [data-manager-window-resize='ne'], [data-manager-window-resize='se'], [data-manager-window-resize='sw'], [data-manager-window-resize='nw'] { width: 1.1rem; height: 1.1rem; }
    [data-manager-window-resize='ne'] { top: 0; right: 0; cursor: nesw-resize; }
    [data-manager-window-resize='se'] { bottom: 0; right: 0; cursor: nwse-resize; border-right: 2px solid var(--color-borderc); border-bottom: 2px solid var(--color-borderc); border-bottom-right-radius: .3rem; }
    [data-manager-window-resize='sw'] { bottom: 0; left: 0; cursor: nesw-resize; }
    [data-manager-window-resize='sw'].right-anchored { border-left: 2px solid var(--color-borderc); border-bottom: 2px solid var(--color-borderc); border-bottom-left-radius: .3rem; }
    [data-manager-window-resize='nw'] { top: 0; left: 0; cursor: nwse-resize; }
    @media (max-width: 640px) { .manager-window-resize { display: none; } }
</style>
