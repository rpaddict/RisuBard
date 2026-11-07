<script lang="ts">
    import { untrack } from 'svelte'
    import { language } from 'src/lang'
    import type { BardLoreEntry } from 'src/ts/lorebook/bardLore'
    import { applyBardLoreLocalSplit, previewBardLoreLocalSplit } from 'src/ts/lorebook/bardLoreLocalSplit'

    let { source, entries, onApply, onClose }: {
        source: BardLoreEntry
        entries: BardLoreEntry[]
        onApply: (entries: BardLoreEntry[]) => void
        onClose: () => void
    } = $props()
    const preview = untrack(() => previewBardLoreLocalSplit(source, entries))
    let conflict = $state(false)

    function apply() {
        const result = applyBardLoreLocalSplit(entries, preview)
        if (result.conflicts.length || !result.appliedIds.length) { conflict = true; return }
        onApply(result.entries)
    }
</script>

<section class="local-review" data-bard-lore-local-split-review aria-label={language.lorebookWorkspace.bardLocalSplit}>
    <div class="review-heading">
        <strong>{language.lorebookWorkspace.bardLocalSplitCount(preview.atoms.length)}</strong>
        <button type="button" onclick={onClose}>{language.lorebookWorkspace.bardLocalSplitClose}</button>
    </div>
    <p>{language.lorebookWorkspace.bardLocalSplitHelp}</p>
    {#if preview.reason}
        <p class="notice" role="status">{language.lorebookWorkspace.bardLocalSplitBlocked[preview.reason]}</p>
    {/if}
    {#if preview.unassigned}
        <details><summary>{language.lorebookWorkspace.bardLocalSplitUnassigned}</summary><pre>{preview.unassigned}</pre></details>
    {/if}
    <div class="atoms">
        {#each preview.atoms as atom, index}
            <details data-bard-lore-local-atom={index}>
                <summary>{atom.aliases.join(' / ')}</summary>
                <pre>{atom.content}</pre>
            </details>
        {/each}
        {#if preview.contexts.length > 0}
            <details>
                <summary>{language.lorebookWorkspace.bardLocalSplitContext(preview.contexts.length)}</summary>
                <pre>{preview.contexts.map(context => context.content).join('\n')}</pre>
            </details>
        {/if}
    </div>
    {#if conflict}<p class="notice" role="alert">{language.lorebookWorkspace.bardLocalSplitConflict}</p>{/if}
    <button class="apply" type="button" data-bard-lore-local-split-apply disabled={!preview.canApply || conflict} onclick={apply}>
        {language.lorebookWorkspace.bardLocalSplitApply}
    </button>
</section>

<style>
    .local-review { display: grid; gap: .65rem; margin: .35rem .65rem .75rem; padding: .8rem; border: 1px solid var(--color-darkborderc); border-radius: var(--risu-radius-lg); background: var(--color-darkbg); color: var(--color-textcolor); user-select: text; min-width: 0; }
    .review-heading { display: flex; align-items: center; justify-content: space-between; gap: .75rem; }
    p { margin: 0; color: var(--color-textcolor2); font-size: .8rem; line-height: 1.55; overflow-wrap: anywhere; }
    .notice { color: var(--color-warning); }
    .atoms { max-height: 19rem; overflow: auto; min-width: 0; }
    details { border-bottom: 1px solid var(--color-darkborderc); }
    summary { cursor: pointer; padding: .55rem .2rem; font-size: .8rem; overflow-wrap: anywhere; }
    pre { margin: 0; padding: .6rem; background: var(--color-selected); white-space: pre-wrap; overflow-wrap: anywhere; font: inherit; font-size: .76rem; line-height: 1.5; }
    button { border: 1px solid var(--color-darkborderc); border-radius: calc(var(--risu-radius-lg) * 0.8); background: var(--color-selected); padding: .45rem .7rem; font-size: .8rem; color: var(--color-textcolor); cursor: pointer; }
    button:hover:not(:disabled) { background: var(--color-darkbutton); }
    button:disabled { opacity: .5; cursor: not-allowed; }
    button:focus-visible, summary:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 2px; }
    .apply { justify-self: start; border-color: var(--color-primary); }
</style>
