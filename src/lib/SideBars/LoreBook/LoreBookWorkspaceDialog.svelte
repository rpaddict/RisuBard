<script lang="ts">
    import { language } from 'src/lang'
    import { resizeHandle } from 'src/ts/gui/resizeHandle'
    import { tooltip } from 'src/ts/gui/tooltip'
    import type { loreBook } from 'src/ts/storage/database.svelte'
    import ShDialog from 'src/lib/UI/GUI/ShDialog.svelte'
    import { CircleQuestionMarkIcon, XIcon } from '@lucide/svelte'
    import { DynamicGUI, MobileGUI } from 'src/ts/stores.svelte'
    import LoreBookWorkspace from './LoreBookWorkspace.svelte'
    import type { LorebookLocalActivation } from './loreBookWorkspaceConnections'
    import type { BardLoreAnalysisRun, BardLoreSettings } from 'src/ts/lorebook/bardLore'

    interface Props {
        open?: boolean
        onOpenChange?: (open: boolean) => void
        entries: loreBook[]
        scopeLabel: string
        scopeKey?: string
        dragEnabled?: boolean
        /** Desktop only: cover the chat column instead of a modal so the sidebars stay usable. */
        dockable?: boolean
        bardMode?: boolean
        bardSettings?: BardLoreSettings
        bardAnalysisRun?: BardLoreAnalysisRun
        bardCharacterId?: string
        onBardAnalysisRunChange?: (run: BardLoreAnalysisRun | undefined) => void
        legacyDisabledBackups?: Record<string, loreBook & { disabled?: boolean }>
        localActivation?: LorebookLocalActivation
        onChange: (entries: loreBook[]) => void
        onImport?: () => void | Promise<void>
        onExport?: () => void | Promise<void>
        resolveChildLabel?: (id: string) => string | undefined
    }

    let {
        open = $bindable(false),
        onOpenChange,
        entries,
        scopeLabel,
        scopeKey,
        dragEnabled = true,
        dockable = false,
        bardMode = false,
        bardSettings,
        bardAnalysisRun,
        bardCharacterId,
        onBardAnalysisRunChange,
        legacyDisabledBackups,
        localActivation,
        onChange,
        onImport,
        onExport,
        resolveChildLabel,
    }: Props = $props()

    let contentElement: HTMLElement | null = $state(null)
    let guideOpen = $state(false)
    const edges = ['n', 'e', 's', 'w', 'ne', 'se', 'sw', 'nw'] as const
    const docked = $derived(dockable && !$DynamicGUI && !$MobileGUI)

    // Keep props/state in the owner, but render over the chat column (App's [data-lorebook-dock-host]).
    function dockInChatArea(node: HTMLElement) {
        const host = document.querySelector<HTMLElement>('[data-lorebook-dock-host]')
        if (!host) return
        host.appendChild(node)
        return { destroy: () => node.remove() }
    }

    function closeDock() {
        open = false
        onOpenChange?.(false)
    }

    function closeDockOnEscape(event: KeyboardEvent) {
        // The guide is modal; its own Escape handling closes it even if focus stayed in the dock.
        if (event.key !== 'Escape' || event.defaultPrevented || guideOpen) return
        event.preventDefault()
        closeDock()
    }

    function startWindowResize(edge: string) {
        const element = contentElement
        if (!element) return
        const { width, height } = element.getBoundingClientRect()
        const x = edge.includes('e') ? 1 : edge.includes('w') ? -1 : 0
        const y = edge.includes('s') ? 1 : edge.includes('n') ? -1 : 0
        return (dx: number, dy: number) => {
            // ShDialog stays at 50%/50%: both opposite edges move by the pointer delta.
            if (x) element.style.setProperty('--lore-dialog-width', `${Math.min(window.innerWidth - 16, Math.max(480, width + dx * x * 2))}px`)
            if (y) element.style.setProperty('--lore-dialog-height', `${Math.min(window.innerHeight - 16, Math.max(320, height + dy * y * 2))}px`)
        }
    }
    function resetWindowSize() {
        contentElement?.style.removeProperty('--lore-dialog-width')
        contentElement?.style.removeProperty('--lore-dialog-height')
    }
</script>

{#snippet workspace()}
    <LoreBookWorkspace
        {entries}
        {scopeLabel}
        {scopeKey}
        active={open}
        {dragEnabled}
        {bardMode}
        {bardSettings}
        {bardAnalysisRun}
        {bardCharacterId}
        {onBardAnalysisRunChange}
        {legacyDisabledBackups}
        {localActivation}
        {onChange}
        {onImport}
        {onExport}
        {resolveChildLabel}
    />
{/snippet}

{#snippet guideButton(className: string)}
    {#if bardMode}
        <button
            type="button"
            class={className}
            data-bard-lore-guide-open
            aria-label={language.lorebookWorkspace.bardGuideOpen}
            title={language.lorebookWorkspace.bardGuideOpen}
            onclick={() => guideOpen = true}
        >
            <CircleQuestionMarkIcon size={18} />
        </button>
    {/if}
{/snippet}

{#if docked && open}
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <section
        use:dockInChatArea
        class="lore-dock"
        data-lorebook-dock
        aria-label={language.lorebookWorkspace.workspaceLabel(scopeLabel)}
        onkeydown={closeDockOnEscape}
    >
        <header class="lore-dock-header">
            <h2>{scopeLabel}</h2>
            <div class="lore-dock-actions">
                {@render guideButton('lore-dock-button')}
                <button
                    type="button"
                    class="lore-dock-button"
                    data-lorebook-dock-close
                    aria-label={language.lorebookWorkspace.close}
                    title={language.lorebookWorkspace.close}
                    onclick={closeDock}
                >
                    <XIcon size={18} />
                </button>
            </div>
        </header>
        <div class="lore-dock-body">
            {@render workspace()}
        </div>
    </section>
{:else if !docked}
<ShDialog
    bind:open
    {onOpenChange}
    bind:contentElement
    closeOnEscape
    tier="base"
    size="xl"
    contentClass="lore-dialog"
    bodyClass="lore-dialog-body"
    ariaLabel={language.lorebookWorkspace.workspaceLabel(scopeLabel)}
    closeAriaLabel={language.lorebookWorkspace.close}
    closeClass="lore-dialog-close"
>
    {#snippet headerActions()}
        {@render guideButton('lore-dialog-help')}
    {/snippet}
    {#snippet title()}{scopeLabel}{/snippet}
    {@render workspace()}
    {#each edges as edge}
        <button type="button" class="window-resize" data-lorebook-window-resize={edge}
            aria-label={`${language.lorebookWorkspace.resizeWindow} · ${edge.toUpperCase()}`}
            use:tooltip={language.lorebookWorkspace.resizeHint}
            use:resizeHandle={{ start: () => startWindowResize(edge), reset: resetWindowSize }}></button>
    {/each}
</ShDialog>
{/if}

<ShDialog
    bind:open={guideOpen}
    closeOnEscape
    tier="alert"
    size="lg"
    contentClass="bard-guide-dialog"
    bodyClass="bard-guide-dialog-body"
    ariaLabel={language.lorebookWorkspace.bardGuideTitle}
    closeAriaLabel={language.lorebookWorkspace.close}
>
    {#snippet title()}{language.lorebookWorkspace.bardGuideTitle}{/snippet}
    <article class="bard-guide" data-bard-lore-guide>
        <nav class="bard-guide-toc" data-bard-lore-guide-toc aria-label={language.lorebookWorkspace.bardGuideContents}>
            <strong>{language.lorebookWorkspace.bardGuideContents}</strong>
            <a href="#bard-guide-generation">{language.lorebookWorkspace.bardGuideGenerationTitle}</a>
            <a href="#bard-guide-activation">{language.lorebookWorkspace.bardGuideActivationTitle}</a>
            <a href="#bard-guide-writing">{language.lorebookWorkspace.bardGuideWritingTitle}</a>
            <a href="#bard-guide-search">{language.lorebookWorkspace.bardGuideSearchTitle}</a>
            <a href="#bard-guide-prompt">{language.lorebookWorkspace.bardGuidePromptTitle}</a>
            <a href="#bard-guide-links">{language.lorebookWorkspace.bardGuideLinksTitle}</a>
            <a href="#bard-guide-budget">{language.lorebookWorkspace.bardGuideBudgetTitle}</a>
            <a href="#bard-guide-analysis">{language.lorebookWorkspace.bardGuideAnalysisTitle}</a>
            <a href="#bard-guide-compatibility">{language.lorebookWorkspace.bardGuideCompatibilityTitle}</a>
        </nav>

        <div class="bard-guide-content">
            <p class="bard-guide-intro">{language.lorebookWorkspace.bardGuideIntro}</p>

            <section id="bard-guide-generation">
                <h3>{language.lorebookWorkspace.bardGuideGenerationTitle}</h3>
                <p>{language.lorebookWorkspace.bardGuideGenerationBody}</p>
            </section>

            <section id="bard-guide-activation">
                <h3>{language.lorebookWorkspace.bardGuideActivationTitle}</h3>
                <dl class="bard-guide-rules">
                    <div><dt>[{language.lorebookWorkspace.bardRequired}]</dt><dd>{language.lorebookWorkspace.bardGuideRequiredBody}</dd></div>
                    <div><dt>[{language.lorebookWorkspace.bardKeyed}]</dt><dd>{language.lorebookWorkspace.bardGuideKeyedBody}</dd></div>
                    <div><dt>[{language.lorebookWorkspace.bardRetrieve}]</dt><dd>{language.lorebookWorkspace.bardGuideRetrieveBody}</dd></div>
                    <div><dt>[{language.lorebookWorkspace.bardNever}]</dt><dd>{language.lorebookWorkspace.bardGuideNeverBody}</dd></div>
                </dl>
            </section>

            <section id="bard-guide-writing" class="bard-guide-writing">
                <h3>{language.lorebookWorkspace.bardGuideWritingTitle}</h3>
                <p class="writing-principle">{language.lorebookWorkspace.bardGuideWritingIntro}</p>
                <div class="bard-writing-grid">
                    <section><h4>{language.lorebookWorkspace.bardGuideWritingIdentityTitle}</h4><p>{language.lorebookWorkspace.bardGuideWritingIdentityBody}</p></section>
                    <section><h4>{language.lorebookWorkspace.bardGuideWritingActivationTitle}</h4><p>{language.lorebookWorkspace.bardGuideWritingActivationBody}</p></section>
                    <section><h4>{language.lorebookWorkspace.bardGuideWritingSecretTitle}</h4><p>{language.lorebookWorkspace.bardGuideWritingSecretBody}</p></section>
                    <section><h4>{language.lorebookWorkspace.bardGuideWritingKeysTitle}</h4><p>{language.lorebookWorkspace.bardGuideWritingKeysBody}</p></section>
                </div>
                <aside class="bard-writing-example">
                    <h4>{language.lorebookWorkspace.bardGuideWritingExampleTitle}</h4>
                    <p>{language.lorebookWorkspace.bardGuideWritingExampleBody}</p>
                </aside>
                <div class="bard-writing-template">
                    <h4>{language.lorebookWorkspace.bardGuideWritingTemplateTitle}</h4>
                    <pre>{language.lorebookWorkspace.bardGuideWritingTemplateBody}</pre>
                </div>
            </section>

            <div class="bard-guide-grid">
                <section id="bard-guide-search"><h3>{language.lorebookWorkspace.bardGuideSearchTitle}</h3><p>{language.lorebookWorkspace.bardGuideSearchBody}</p></section>
                <section id="bard-guide-prompt"><h3>{language.lorebookWorkspace.bardGuidePromptTitle}</h3><p>{language.lorebookWorkspace.bardGuidePromptBody}</p></section>
                <section id="bard-guide-links"><h3>{language.lorebookWorkspace.bardGuideLinksTitle}</h3><p>{language.lorebookWorkspace.bardGuideLinksBody}</p></section>
                <section id="bard-guide-budget"><h3>{language.lorebookWorkspace.bardGuideBudgetTitle}</h3><p>{language.lorebookWorkspace.bardGuideBudgetBody}</p></section>
                <section id="bard-guide-analysis"><h3>{language.lorebookWorkspace.bardGuideAnalysisTitle}</h3><p>{language.lorebookWorkspace.bardGuideAnalysisBody}</p></section>
                <section id="bard-guide-compatibility"><h3>{language.lorebookWorkspace.bardGuideCompatibilityTitle}</h3><p>{language.lorebookWorkspace.bardGuideCompatibilityBody}</p></section>
            </div>
        </div>
    </article>
</ShDialog>

<style>
    .lore-dock {
        position: absolute;
        inset: 0;
        z-index: 35;
        display: flex;
        flex-direction: column;
        min-width: 0;
        min-height: 0;
        background: var(--color-darkbg);
        color: var(--color-textcolor);
    }
    .lore-dock-header {
        display: flex;
        align-items: center;
        gap: .75rem;
        min-height: 3.25rem;
        padding: .55rem .7rem .55rem 1rem;
        border-bottom: 1px solid var(--color-darkborderc);
        background: color-mix(in srgb, var(--color-selected) 18%, var(--color-darkbg));
    }
    .lore-dock-header h2 {
        flex: 1;
        min-width: 0;
        margin: 0;
        overflow: hidden;
        font-size: 1.125rem;
        font-weight: 600;
        line-height: 1.25;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .lore-dock-actions { display: flex; flex: none; gap: .4rem; }
    :global(.lore-dock-button) {
        display: grid;
        width: 2.65rem;
        height: 2.65rem;
        padding: 0;
        place-items: center;
        border: 0;
        border-radius: calc(var(--risu-radius-xl) * 0.96);
        background: color-mix(in srgb, var(--color-selected) 58%, var(--color-darkbg));
        color: var(--color-textcolor);
        cursor: pointer;
    }
    :global(.lore-dock-button:hover), :global(.lore-dock-button:focus-visible) { background: var(--color-selected); outline: none; }
    :global(.lore-dock-button svg) { width: 1.35rem; height: 1.35rem; }
    .lore-dock-body { display: flex; flex-direction: column; flex: 1; min-height: 0; padding: .7rem; }
    :global(.lore-dialog) {
        width: var(--lore-dialog-width, min(96vw, 1700px));
        min-width: min(480px, calc(100vw - 1rem));
        max-width: calc(100vw - 1rem);
        height: var(--lore-dialog-height, min(92vh, 1000px));
        min-height: min(320px, calc(100dvh - 1rem));
        max-height: calc(100dvh - 1rem);
        padding: 0;
        overflow: hidden;
        gap: 0;
        background: var(--color-darkbg);
    }
    :global(.lore-dialog > :first-child) {
        min-height: 3.25rem;
        justify-content: center;
        padding: .75rem 4rem .75rem 1rem;
        border-bottom: 1px solid var(--color-darkborderc);
        background: color-mix(in srgb, var(--color-selected) 18%, var(--color-darkbg));
    }
    :global(.lore-dialog-close) {
        top: 50%;
        right: .7rem;
        display: grid;
        width: 2.65rem;
        height: 2.65rem;
        place-items: center;
        border-radius: calc(var(--risu-radius-xl) * 0.96);
        background: color-mix(in srgb, var(--color-selected) 58%, var(--color-darkbg));
        color: var(--color-textcolor);
        transform: translateY(-50%);
    }
    :global(.lore-dialog-help) {
        position: absolute;
        top: 50%;
        right: 3.65rem;
        z-index: 1;
        display: grid;
        width: 2.65rem;
        height: 2.65rem;
        padding: 0;
        place-items: center;
        border: 0;
        border-radius: calc(var(--risu-radius-xl) * 0.96);
        background: color-mix(in srgb, var(--color-selected) 58%, var(--color-darkbg));
        color: var(--color-textcolor);
        cursor: pointer;
        transform: translateY(-50%);
    }
    :global(.lore-dialog-help:hover) { background: var(--color-selected); }
    :global(.lore-dialog-help svg) { width: 1.35rem; height: 1.35rem; }
    :global(.lore-dialog-close:hover) { background: var(--color-selected); }
    :global(.lore-dialog-close svg) { width: 1.35rem; height: 1.35rem; }
    :global(.lore-dialog-body) { min-height: 0; flex: 1; padding: .7rem; }
    :global(.bard-guide-dialog) {
        width: min(94vw, 1080px);
        max-width: calc(100vw - 1rem);
        max-height: min(88dvh, 900px);
        background: var(--color-darkbg);
    }
    :global(.bard-guide-dialog-body) { min-height: 0; overflow-y: auto; }
    .bard-guide { display: grid; grid-template-columns: minmax(10.5rem, 13rem) minmax(0, 1fr); gap: 1.2rem; align-items: start; color: var(--color-textcolor); }
    .bard-guide-content { display: grid; min-width: 0; gap: 1rem; }
    .bard-guide p, .bard-guide dd { margin: 0; color: var(--color-textcolor2); font-size: .84rem; line-height: 1.65; }
    .bard-guide-toc { position: sticky; top: 0; display: grid; gap: .2rem; padding: .7rem; border: 1px solid var(--color-darkborderc); border-radius: calc(var(--risu-radius-lg) * 1.3); background: color-mix(in srgb, var(--color-selected) 12%, var(--color-darkbg)); }
    .bard-guide-toc strong { padding: .2rem .45rem .45rem; color: var(--color-textcolor); font-size: .76rem; letter-spacing: .04em; }
    .bard-guide-toc a { padding: .42rem .48rem; border-radius: calc(var(--risu-radius-lg) * 0.76); color: var(--color-textcolor2); font-size: .77rem; line-height: 1.25; text-decoration: none; }
    .bard-guide-toc a:hover, .bard-guide-toc a:focus-visible { background: var(--color-selected); color: var(--color-textcolor); outline: none; }
    .bard-guide-intro { padding: .85rem 1rem; border-left: .22rem solid var(--color-borderc); border-radius: calc(var(--risu-radius-lg) * 0.9); background: color-mix(in srgb, var(--color-selected) 22%, var(--color-darkbg)); color: var(--color-textcolor) !important; }
    .bard-guide section { display: grid; gap: .45rem; scroll-margin-top: .75rem; }
    .bard-guide h3 { margin: 0; color: var(--color-textcolor); font-size: .92rem; }
    .bard-guide h4 { margin: 0; color: var(--color-textcolor); font-size: .82rem; }
    .bard-guide-rules { display: grid; margin: 0; gap: .45rem; }
    .bard-guide-rules > div { display: grid; grid-template-columns: minmax(8rem, auto) 1fr; gap: .75rem; padding: .65rem .75rem; border: 1px solid var(--color-darkborderc); border-radius: calc(var(--risu-radius-lg) * 1.1); background: color-mix(in srgb, var(--color-selected) 12%, var(--color-darkbg)); }
    .bard-guide-rules dt { color: var(--color-textcolor); font-size: .78rem; font-weight: 700; white-space: nowrap; }
    .bard-guide-rules dd { margin: 0; }
    .bard-guide-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: .7rem; }
    .bard-guide-grid section { padding: .8rem; border: 1px solid var(--color-darkborderc); border-radius: calc(var(--risu-radius-lg) * 1.2); background: color-mix(in srgb, var(--color-selected) 10%, var(--color-darkbg)); }
    .bard-guide-writing { gap: .7rem !important; padding: 1rem; border: 1px solid color-mix(in srgb, var(--color-borderc) 70%, var(--color-darkborderc)); border-radius: calc(var(--risu-radius-lg) * 1.4); background: color-mix(in srgb, var(--color-selected) 8%, var(--color-darkbg)); }
    .writing-principle { padding: .75rem .85rem; border-radius: var(--risu-radius-lg); background: color-mix(in srgb, var(--color-borderc) 12%, transparent); color: var(--color-textcolor) !important; }
    .bard-writing-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: .6rem; }
    .bard-writing-grid section { padding: .75rem; border-top: 2px solid color-mix(in srgb, var(--color-borderc) 65%, transparent); background: color-mix(in srgb, var(--color-selected) 10%, transparent); }
    .bard-writing-example { display: grid; gap: .35rem; padding: .8rem .9rem; border-left: .2rem solid var(--color-borderc); border-radius: calc(var(--risu-radius-lg) * 0.9); background: color-mix(in srgb, var(--color-selected) 20%, var(--color-darkbg)); }
    .bard-writing-template { display: grid; gap: .4rem; }
    .bard-writing-template pre { margin: 0; padding: .8rem .9rem; overflow-x: auto; border: 1px solid var(--color-darkborderc); border-radius: var(--risu-radius-lg); background: color-mix(in srgb, var(--color-darkbg) 92%, var(--color-selected)); color: var(--color-textcolor2); font-size: .78rem; line-height: 1.55; white-space: pre-wrap; }
    .window-resize { position: absolute; z-index: 10; padding: 0; border: 0; border-radius: 0; background: transparent; touch-action: none; }
    .window-resize:hover, .window-resize:focus-visible, .window-resize:global([data-resizing]) { background: color-mix(in srgb, var(--color-borderc) 45%, transparent); outline: none; }
    [data-lorebook-window-resize='n'], [data-lorebook-window-resize='s'] { left: 1rem; right: 1rem; height: .45rem; cursor: ns-resize; }
    [data-lorebook-window-resize='e'], [data-lorebook-window-resize='w'] { top: 1rem; bottom: 1rem; width: .45rem; cursor: ew-resize; }
    [data-lorebook-window-resize='n'] { top: 0; }
    [data-lorebook-window-resize='s'] { bottom: 0; }
    [data-lorebook-window-resize='e'] { right: 0; }
    [data-lorebook-window-resize='w'] { left: 0; }
    [data-lorebook-window-resize='ne'], [data-lorebook-window-resize='se'], [data-lorebook-window-resize='sw'], [data-lorebook-window-resize='nw'] { width: 1rem; height: 1rem; }
    [data-lorebook-window-resize='ne'] { top: 0; right: 0; cursor: nesw-resize; }
    [data-lorebook-window-resize='se'] { bottom: 0; right: 0; cursor: nwse-resize; border-right: 2px solid var(--color-borderc); border-bottom: 2px solid var(--color-borderc); }
    [data-lorebook-window-resize='sw'] { bottom: 0; left: 0; cursor: nesw-resize; }
    [data-lorebook-window-resize='nw'] { top: 0; left: 0; cursor: nwse-resize; }
    @media (max-width: 899px) {
        :global(.lore-dialog) {
            width: 100vw;
            max-width: 100vw;
            height: 100dvh;
            max-height: none;
            border-radius: 0;
        }
        .window-resize { display: none; }
        :global(.lore-dialog-body) { padding: 0; }
        :global(.lore-dialog > :first-child) { min-height: 4rem; padding-right: 4.8rem; }
        :global(.lore-dialog-close) { right: .65rem; width: 3rem; height: 3rem; border-radius: calc(var(--risu-radius-2xl) * 0.9); }
        :global(.lore-dialog-close svg) { width: 1.55rem; height: 1.55rem; }
        :global(.lore-dialog-help) { right: 4rem; width: 3rem; height: 3rem; border-radius: calc(var(--risu-radius-2xl) * 0.9); }
        :global(.lore-dialog-help svg) { width: 1.55rem; height: 1.55rem; }
        .bard-guide, .bard-guide-rules > div, .bard-guide-grid, .bard-writing-grid { grid-template-columns: minmax(0, 1fr); }
        .bard-guide-toc { position: static; grid-template-columns: repeat(2, minmax(0, 1fr)); }
        .bard-guide-toc strong { grid-column: 1 / -1; }
    }
</style>
