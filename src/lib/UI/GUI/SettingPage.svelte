<script lang="ts">
    import type { Snippet } from "svelte";
    import ManagerResizeHandles from './ManagerResizeHandles.svelte';

    let {
        title,
        description,
        showTitle = true,
        fullWidth = false,
        resizable = false,
        wide = false,
        unboundedHeight = false,
        resizeStorageKey,
        children,
        leading,
        headerActions,
    }: {
        title: string;
        description?: string;
        showTitle?: boolean;
        fullWidth?: boolean;
        resizable?: boolean;
        wide?: boolean;
        unboundedHeight?: boolean;
        resizeStorageKey?: string;
        children?: Snippet;
        leading?: Snippet;
        headerActions?: Snippet;
    } = $props();
    let pageElement: HTMLElement | null = $state(null);
</script>

<section
    bind:this={pageElement}
    data-settings-page
    class="settings-standard-page"
    class:settings-standard-page--full-width={fullWidth}
    class:settings-standard-page--resizable={resizable}
    class:settings-standard-page--wide={wide}
    class:settings-standard-page--unbounded-height={unboundedHeight}
>
    {#if showTitle}
        <header data-settings-page-header class="settings-standard-page__header">
            <div class="settings-standard-page__title-row">
                <div class="settings-standard-page__title">{@render leading?.()}<h1>{title}</h1></div>
                {@render headerActions?.()}
            </div>
            {#if description}
                <p>{description}</p>
            {/if}
        </header>
    {/if}
    <div data-settings-page-body class="settings-standard-page__body">
        {@render children?.()}
    </div>
    {#if resizable}<ManagerResizeHandles target={pageElement} centered {unboundedHeight} {resizeStorageKey} />{/if}
</section>

<style>
    .settings-standard-page__title-row { display: flex; align-items: center; justify-content: space-between; gap: 1rem; }
    .settings-standard-page__title { display: flex; min-width: 0; align-items: center; gap: .75rem; }
    .settings-standard-page--full-width { width: 100%; max-width: 100%; height: 100%; min-height: 0; }
    .settings-standard-page--full-width > .settings-standard-page__header { max-width: none; margin-bottom: 1rem; }
    .settings-standard-page--full-width > .settings-standard-page__body { flex: 1; min-height: 0; overflow: hidden; }
    .settings-standard-page--full-width > .settings-standard-page__body > :global([data-settings-section-tabs]) { flex-shrink: 0; }
    @media (max-width: 640px) {
        .settings-standard-page__title-row { align-items: stretch; flex-direction: column; }
    }
    .settings-standard-page--resizable {
        position: relative;
        left: 50%;
        display: flex;
        flex-direction: column;
        align-self: center;
        transform: translateX(-50%);
        width: var(--manager-width, 100%);
        max-width: calc(100vw - 1rem);
        min-width: 0;
        height: var(--manager-height, min(76dvh, 52rem));
        min-height: min(24rem, calc(100dvh - 1rem));
        max-height: calc(100dvh - 1rem);
        padding-bottom: .75rem;
    }
    .settings-standard-page--resizable.settings-standard-page--wide {
        --manager-width: min(calc(100vw - 20rem), 88rem);
    }
    .settings-standard-page--resizable.settings-standard-page--unbounded-height { max-height: none; }
    .settings-standard-page--resizable > .settings-standard-page__header { flex-shrink: 0; }
    .settings-standard-page--resizable > .settings-standard-page__body { display: flex; flex: 1; flex-direction: column; min-height: 0; overflow: auto; }
    .settings-standard-page--resizable > .settings-standard-page__body > :global([data-settings-preset-header]),
    .settings-standard-page--resizable > .settings-standard-page__body > :global([data-settings-section-tabs]) { flex-shrink: 0; }
    @media (max-width: 640px) {
        .settings-standard-page--resizable { left: auto; width: 100%; height: max(38rem, calc(100dvh - 8rem)); max-height: none; transform: none; padding-bottom: 0; }
    }
</style>
