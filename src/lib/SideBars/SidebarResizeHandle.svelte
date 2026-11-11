<script lang="ts">
    import { DBState, SizeStore } from 'src/ts/stores.svelte'
    import { requestImmediateSave } from 'src/ts/globalApi.svelte'
    import { resizeHandle } from 'src/ts/gui/resizeHandle'
    import {
        normalizeCharacterListSidebarWidth,
        normalizeChatListHeight,
        normalizeCharacterSidebarWidth,
    } from 'src/ts/gui/sidebarLayout'

    let { axis, target, maxWidth = 720, field, inFlow = false }: {
        axis: 'width' | 'height'
        target: HTMLElement | undefined
        maxWidth?: number
        field?: 'characterSidebarWidth' | 'characterListSidebarWidth'
        /**
         * Paint in document order instead of raising the handle. A raised handle in a container without its own
         * stacking context would draw over bot panels in the chat screen.
         */
        inFlow?: boolean
    } = $props()
    const sizeField = $derived(field ?? (axis === 'height' ? 'chatListHeight' : 'characterSidebarWidth'))
    const normalize = (value: unknown) => sizeField === 'chatListHeight'
        ? normalizeChatListHeight(value, $SizeStore.h)
        : sizeField === 'characterListSidebarWidth'
            ? normalizeCharacterListSidebarWidth(value, maxWidth)
            : normalizeCharacterSidebarWidth(value, maxWidth)
    const currentSize = $derived(normalize(DBState.db[sizeField]))
    const sizeLabel = $derived(sizeField === 'chatListHeight'
        ? '챗 목록 높이 조절'
        : sizeField === 'characterListSidebarWidth'
            ? '캐릭터 목록 사이드바 너비 조절'
            : '캐릭터 사이드바 너비 조절')

    function start() {
        if (!target) return
        const initial = target.getBoundingClientRect()[axis]
        return (dx: number, dy: number) => {
            const delta = axis === 'height' ? dy : dx
            if (delta) DBState.db[sizeField] = normalize(initial + delta)
        }
    }
</script>

<button type="button"
    aria-label={`${sizeLabel} · ${currentSize}px`}
    title="드래그 또는 방향키로 조절 · 두 번 클릭하거나 Home 키로 초기화"
    class="sidebar-resize-handle" class:is-width={axis === 'width'} class:is-height={axis === 'height'} class:in-flow={inFlow}
    data-sidebar-resize={axis}
    use:resizeHandle={{ start, reset: () => { delete DBState.db[sizeField] }, end: () => { void requestImmediateSave() } }}
></button>

<style>
    .sidebar-resize-handle { padding: 0; border: 0; background: transparent; touch-action: none; flex-shrink: 0; }
    .sidebar-resize-handle::after { content: ''; position: absolute; border-radius: 999px; background: var(--color-darkborderc); transition: background-color .15s; }
    .is-height { position: relative; display: block; width: 100%; height: .875rem; margin-top: .25rem; cursor: row-resize; }
    .is-height::after { width: 2rem; height: 3px; top: calc(50% - 1.5px); left: calc(50% - 1rem); }
    .is-width { position: absolute; z-index: 20; right: 0; top: calc(50% - 1.5rem); height: 3rem; width: .5rem; cursor: col-resize; }
    .is-width.in-flow { z-index: auto; }
    .is-width::after { width: 2px; height: 3rem; top: calc(50% - 1.5rem); right: 1px; }
    .sidebar-resize-handle:hover, .sidebar-resize-handle:focus-visible, .sidebar-resize-handle:global([data-resizing]) { background: color-mix(in srgb, var(--color-borderc) 15%, transparent); outline: none; }
    .sidebar-resize-handle:hover::after, .sidebar-resize-handle:focus-visible::after, .sidebar-resize-handle:global([data-resizing])::after { background: var(--color-borderc); }
    @media (max-width: 640px) { .is-width { display: none; } }
</style>
