<script lang="ts">
    import { CheckIcon } from '@lucide/svelte'
    import { language } from 'src/lang'
    import type { ResolvedRisuBardChatSettings } from 'src/ts/risubard/risuBardSettings'
    import {
        recommendedWikiPresetChanges,
        type RecommendedWikiValues,
    } from 'src/ts/risubard/recommendedWikiPreset'

    interface Props {
        settings: ResolvedRisuBardChatSettings
        disabled?: boolean
        /** Applies the changed values to the scope this control edits (global, chat or pinned bot). */
        onApply: (changes: RecommendedWikiValues) => void
    }

    let { settings, disabled = false, onApply }: Props = $props()
    const uid = $props.id()
    const titleId = `${uid}-title`
    let changes = $derived(recommendedWikiPresetChanges(settings))
    let matched = $derived(Object.keys(changes).length === 0)
    let feedback = $state('')
    const items = $derived([
        language.risuBardRecommendedPresetInterval,
        language.risuBardRecommendedPresetScale,
    ])

    function apply() {
        if (matched || disabled) return
        onApply(changes)
        feedback = language.risuBardRecommendedPresetDone
    }

    $effect(() => {
        // A later manual change makes the old confirmation misleading.
        if (!matched) feedback = ''
    })
</script>

<div class="recommended-preset" data-recommended-wiki-preset data-matched={matched}>
    <div class="recommended-copy">
        <span class="recommended-title" id={titleId}>{language.risuBardRecommendedPreset}</span>
        <p class="recommended-hint">{language.risuBardRecommendedPresetHint}</p>
        <ul class="recommended-values" aria-label={language.risuBardRecommendedPreset}>
            {#each items as item (item)}<li>{item}</li>{/each}
        </ul>
    </div>
    <button type="button" class="recommended-apply" data-apply-recommended-wiki-preset
        aria-describedby={titleId}
        disabled={disabled || matched} onclick={apply}>
        {#if matched}
            <CheckIcon size={16} aria-hidden="true" />{language.risuBardRecommendedPresetApplied}
        {:else}
            {language.risuBardRecommendedPresetApply}
        {/if}
    </button>
    {#if feedback}
        <small class="recommended-feedback" role="status">{feedback}</small>
    {/if}
</div>

<style>
    .recommended-preset { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: .45rem .9rem; min-width: 0; }
    .recommended-copy { display: grid; gap: .3rem; min-width: 0; }
    .recommended-title { color: var(--color-textcolor); font-size: .875rem; font-weight: 700; }
    .recommended-hint { margin: 0; color: var(--color-textcolor2); font-size: .75rem; line-height: 1.5; overflow-wrap: anywhere; }
    .recommended-values { display: flex; flex-wrap: wrap; gap: .3rem; margin: 0; padding: 0; list-style: none; }
    .recommended-values li { padding: .15rem .5rem; border: 1px solid color-mix(in srgb, var(--color-primary) 30%, var(--color-darkborderc)); border-radius: 999px; color: var(--color-textcolor); background: color-mix(in srgb, var(--color-primary) 10%, var(--color-darkbg)); font-size: .75rem; font-weight: 600; white-space: nowrap; }
    .recommended-apply { display: inline-flex; align-items: center; justify-content: center; gap: .3rem; min-height: 2.25rem; padding: .4rem .85rem; border: 1px solid color-mix(in srgb, var(--color-primary) 60%, var(--color-darkborderc)); border-radius: calc(var(--risu-radius-lg) * 0.8); color: var(--color-textcolor); background: color-mix(in srgb, var(--color-primary) 22%, var(--color-darkbg)); font-size: .85rem; font-weight: 700; white-space: nowrap; cursor: pointer; transition: background-color .15s ease-out, border-color .15s ease-out; }
    .recommended-apply:hover:not(:disabled) { background: color-mix(in srgb, var(--color-primary) 36%, var(--color-darkbg)); }
    .recommended-apply:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 2px; }
    .recommended-apply:disabled { border-color: var(--color-darkborderc); color: var(--color-textcolor2); background: var(--color-darkbg); cursor: default; }
    .recommended-feedback { grid-column: 1 / -1; color: var(--color-primary); font-size: .75rem; }
    @container (max-width: 26rem) {
        .recommended-preset { grid-template-columns: minmax(0, 1fr); }
        .recommended-apply { justify-self: start; }
    }
    @media (max-width: 480px) {
        .recommended-preset { grid-template-columns: minmax(0, 1fr); }
        .recommended-apply { justify-self: start; }
    }
</style>
