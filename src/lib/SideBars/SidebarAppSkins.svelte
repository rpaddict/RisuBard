<script lang="ts">
    // Quick app skin picker above the recent chats. Picking a row applies the skin at once.
    // Collapsed state and list height are per-device conveniences kept in local storage.
    import { language } from 'src/lang';
    import { DBState } from 'src/ts/stores.svelte';
    import { CheckIcon, ChevronDownIcon } from '@lucide/svelte';
    import { isAppSkinSuppressed, listAppSkins, selectAppSkin } from 'src/ts/gui/appSkinRuntime';
    import { appSkinSwatch, defaultAppSkinSwatch, type AppSkinSwatch } from 'src/ts/gui/appSkinSwatch';
    import { resizeHandle } from 'src/ts/gui/resizeHandle';
    import { clearResizableSize, loadResizableSize, saveResizableSize } from 'src/ts/gui/resizableSize';

    const COLLAPSED_KEY = 'risubard:sidebar-app-skins-collapsed:v1';
    const SIZE_KEY = 'sidebar-app-skins';
    const MIN_HEIGHT = 48;

    function readCollapsed() {
        try {
            return localStorage.getItem(COLLAPSED_KEY) === '1';
        } catch {
            return false;
        }
    }

    let collapsed = $state(readCollapsed());
    let height = $state<number | null>(loadResizableSize(SIZE_KEY)?.height ?? null);
    let list = $state<HTMLDivElement>();

    const copy = $derived(language.appSkin);
    const entries = $derived(listAppSkins(DBState.db));
    const activeId = $derived(DBState.db.appSkinId ?? '');
    const suppressed = isAppSkinSuppressed();
    const defaultSwatch = $derived(defaultAppSkinSwatch(DBState.db.colorScheme));
    const listId = 'sidebar-app-skin-list';

    function toggle() {
        collapsed = !collapsed;
        try {
            localStorage.setItem(COLLAPSED_KEY, collapsed ? '1' : '0');
        } catch {
            // Storage can be unavailable; the section then opens expanded next time.
        }
    }

    function startResize() {
        if (!list) return;
        const initial = list.getBoundingClientRect().height;
        // Never taller than every row needs.
        const max = Math.max(MIN_HEIGHT, list.scrollHeight);
        return (_dx: number, dy: number) => {
            height = Math.round(Math.min(max, Math.max(MIN_HEIGHT, initial + dy)));
        };
    }

    function resetHeight() {
        height = null;
        clearResizableSize(SIZE_KEY);
    }

    function finishResize() {
        if (height) saveResizableSize(SIZE_KEY, { height });
    }
</script>

{#snippet swatch(s: AppSkinSwatch)}
    <span
        class="flex h-8 w-11 shrink-0 items-center justify-center gap-1 overflow-hidden border"
        style:background-color={s.ground}
        style:border-color={s.border}
        style:border-radius={s.radius}
        aria-hidden="true"
    >
        <span class="text-[10px] font-semibold leading-none" style:color={s.text} style:font-family={s.font}>Aa</span>
        <span class="size-2.5 rounded-full" style:background-color={s.accent}></span>
    </span>
{/snippet}

{#snippet row(id: string, name: string, detail: string, s: AppSkinSwatch)}
    {@const selected = activeId === id}
    <button
        type="button"
        data-sidebar-app-skin={id}
        class="flex min-h-11 w-full shrink-0 items-center gap-2.5 rounded-md border p-1.5 text-left transition-colors hover:border-borderc/30 hover:bg-selected/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary {selected ? 'border-primary bg-selected' : 'border-borderc/10 bg-darkbg'}"
        aria-pressed={selected}
        onclick={() => selectAppSkin(id)}
    >
        {@render swatch(s)}
        <span class="min-w-0 flex-1">
            <span class="block truncate text-sm font-semibold leading-tight text-textcolor" title={name}>{name}</span>
            <span class="block truncate text-xs leading-tight text-textcolor2" title={detail}>{detail}</span>
        </span>
        {#if selected}
            <span class="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-accenttext" aria-hidden="true"><CheckIcon size={12} strokeWidth={3} /></span>
        {/if}
    </button>
{/snippet}

<section class="mt-2" data-sidebar-app-skins aria-labelledby="sidebar-app-skins-title">
    <button
        type="button"
        class="flex w-full items-center justify-between gap-2 rounded-md py-1 text-left text-textcolor focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        aria-expanded={!collapsed}
        aria-controls={listId}
        onclick={toggle}
    >
        <span id="sidebar-app-skins-title" class="text-base font-semibold">{copy.title}</span>
        <ChevronDownIcon size={18} class="shrink-0 text-textcolor2 transition-transform {collapsed ? '-rotate-90' : ''}" aria-hidden="true" />
    </button>
    {#if !collapsed}
        {#if suppressed}
            <p class="mt-1 text-xs text-warning" role="status">{copy.safeModeActive}</p>
        {/if}
        <div
            bind:this={list}
            id={listId}
            class="sidebar-app-skin-list mt-2 flex flex-col gap-1.5 overflow-y-auto overscroll-contain"
            style:height={height ? `${height}px` : undefined}
            role="group"
            aria-labelledby="sidebar-app-skins-title"
        >
            {@render row('', copy.defaultSkin, copy.defaultSkinDetail, defaultSwatch)}
            {#each entries as { skin, builtin } (skin.id)}
                {@render row(skin.id, skin.name, builtin ? copy.builtinLabel : skin.source ? copy.sourceLabel.replace('{}', skin.source) : (skin.description ?? skin.id), appSkinSwatch(skin))}
            {/each}
        </div>
        <button
            type="button"
            class="sidebar-app-skin-resize"
            aria-label={copy.sidebarResize}
            title={copy.sidebarResize}
            use:resizeHandle={{ start: startResize, reset: resetHeight, end: finishResize }}
        ></button>
    {/if}
</section>

<style>
    /* About four rows until the user drags the handle. */
    .sidebar-app-skin-list {
        max-height: 12.5rem;
    }
    .sidebar-app-skin-list[style*='height'] {
        max-height: none;
    }
    .sidebar-app-skin-resize {
        position: relative;
        display: block;
        width: 100%;
        height: 0.875rem;
        padding: 0;
        border: 0;
        background: transparent;
        cursor: row-resize;
        touch-action: none;
    }
    .sidebar-app-skin-resize::after {
        position: absolute;
        top: 50%;
        left: 50%;
        width: 2.5rem;
        height: 0.25rem;
        border-radius: 9999px;
        background: var(--color-darkborderc);
        content: '';
        transform: translate(-50%, -50%);
        transition: background-color 150ms;
    }
    .sidebar-app-skin-resize:hover::after,
    .sidebar-app-skin-resize:focus-visible::after,
    .sidebar-app-skin-resize:global([data-resizing])::after {
        background: var(--color-primary);
    }
    .sidebar-app-skin-resize:focus-visible {
        outline: none;
    }
</style>
