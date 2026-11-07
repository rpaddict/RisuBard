<script lang="ts">
    import { getCurrentLocale, language } from 'src/lang'
    import Help from 'src/lib/Others/Help.svelte'
    import { resolveRisuBardChatSettings } from 'src/ts/risubard/risuBardSettings'
    import {
        WIKI_SCALE_PRESET_IDS,
        WIKI_SCALE_PRESETS,
        detectWikiScalePreset,
        formatWikiScaleTokens,
        normalizeRisuBardWikiSettingsView,
        wikiScalePresetValues,
        type RisuBardWikiSettingsView,
        type WikiScalePresetId,
    } from 'src/ts/risubard/wikiScalePreset'
    import { DBState } from 'src/ts/stores.svelte'

    let view = $derived(normalizeRisuBardWikiSettingsView(DBState.db.risuBardWikiSettingsView))
    let settings = $derived(resolveRisuBardChatSettings(DBState.db))
    let selection = $derived(detectWikiScalePreset(settings))
    let labels = $derived<Record<WikiScalePresetId, string>>({
        light: language.risuBardWikiScaleLight,
        standard: language.risuBardWikiScaleStandard,
        roomy: language.risuBardWikiScaleRoomy,
        large: language.risuBardWikiScaleLarge,
    })
    let summary = $derived.by(() => {
        const format = (value: number) => value.toLocaleString(getCurrentLocale())
        return language.risuBardWikiScaleSummary
            .replace('{analysis}', format(settings.risuBardAnalysisTokenLimit))
            .replace('{lore}', format(settings.risuBardAnalysisLoreTokenLimit))
    })

    function setView(next: RisuBardWikiSettingsView): void {
        DBState.db.risuBardWikiSettingsView = next
    }

    function selectScale(id: WikiScalePresetId): void {
        Object.assign(DBState.db, wikiScalePresetValues(id))
    }
</script>

<div data-setting-row data-setting-id="risubard.common.wikiSettingsView"
    class="settings-standard-row flex items-center justify-between gap-4 border-t border-darkborderc">
    <div class="flex min-w-0 flex-col">
        <span class="text-sm text-textcolor" id="risubard-wiki-settings-view-label">{language.risuBardWikiSettingsView}</span>
        <p class="mt-0.5 wrap-break-word text-xs text-textcolor2">{language.risuBardWikiSettingsViewHint}</p>
    </div>
    <div class="view-switch" role="group" aria-labelledby="risubard-wiki-settings-view-label">
        <button type="button" aria-pressed={view === 'simple'} data-wiki-settings-view="simple"
            onclick={() => setView('simple')}>{language.risuBardWikiSettingsViewSimple}</button>
        <button type="button" aria-pressed={view === 'advanced'} data-wiki-settings-view="advanced"
            onclick={() => setView('advanced')}>{language.risuBardWikiSettingsViewAdvanced}</button>
    </div>
</div>

<fieldset data-setting-row data-setting-id="risubard.common.wikiScale"
    class="scale-row settings-standard-row border-t border-darkborderc">
    <legend class="text-sm text-textcolor">
        {language.risuBardWikiScale}
        <Help key="risuBardWikiScale" name={language.risuBardWikiScale} />
    </legend>
    <div class="scale-options">
        {#each WIKI_SCALE_PRESET_IDS as id (id)}
            <label class="scale-option">
                <input type="radio" name="risubard-wiki-scale" value={id} checked={selection === id}
                    onchange={() => selectScale(id)} />
                <span class="scale-name">{labels[id]}</span>
                <span class="scale-tokens">{formatWikiScaleTokens(WIKI_SCALE_PRESETS[id].analysis)}</span>
            </label>
        {/each}
    </div>
    <p class="wrap-break-word text-xs text-textcolor2" data-wiki-scale-summary>
        {selection === 'custom' ? language.risuBardWikiScaleCustom.replace('{summary}', summary) : summary}
    </p>
</fieldset>

<style>
    .view-switch { display: grid; flex-shrink: 0; grid-template-columns: 1fr 1fr; gap: 2px; width: 12rem; max-width: 100%; padding: 2px; border: 1px solid var(--color-darkborderc); border-radius: calc(var(--risu-radius-lg) * 0.9); background: var(--color-darkbg); }
    .view-switch button { min-height: 2rem; border-radius: calc(var(--risu-radius-sm) * 1.36); color: var(--color-textcolor2); font-size: .85rem; font-weight: 650; transition: background-color .15s ease-out, color .15s ease-out; }
    .view-switch button:hover { color: var(--color-textcolor); }
    .view-switch button[aria-pressed='true'] { color: var(--color-textcolor); background: color-mix(in srgb, var(--color-primary) 30%, var(--color-darkbg)); }
    .view-switch button:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 2px; }
    .scale-row { display: grid; gap: .5rem; min-width: 0; margin: 0; }
    .scale-row legend { float: left; width: 100%; padding: 0; }
    .scale-options { clear: both; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: .4rem; max-width: 32rem; }
    .scale-option { position: relative; display: grid; justify-items: center; gap: .05rem; min-height: 3rem; padding: .4rem .25rem; border: 1px solid color-mix(in srgb, var(--color-primary) 24%, var(--color-darkborderc)); border-radius: calc(var(--risu-radius-lg) * 0.8); color: var(--color-textcolor); background: color-mix(in srgb, var(--color-primary) 8%, var(--color-darkbg)); cursor: pointer; transition: border-color .15s ease-out, background-color .15s ease-out; }
    .scale-option input { position: absolute; opacity: 0; pointer-events: none; }
    .scale-option:hover { border-color: color-mix(in srgb, var(--color-primary) 55%, var(--color-darkborderc)); background: color-mix(in srgb, var(--color-primary) 15%, var(--color-darkbg)); }
    .scale-option:has(input:checked) { border-color: color-mix(in srgb, var(--color-primary) 80%, var(--color-darkborderc)); color: var(--color-textcolor); background: color-mix(in srgb, var(--color-primary) 32%, var(--color-darkbg)); }
    .scale-option:has(input:checked) .scale-tokens { color: var(--color-textcolor); }
    .scale-option:has(input:focus-visible) { outline: 2px solid var(--color-primary); outline-offset: 2px; }
    .scale-name { font-size: .85rem; font-weight: 700; }
    .scale-tokens { font-size: .75rem; font-weight: 650; font-variant-numeric: tabular-nums; color: color-mix(in srgb, var(--color-primary) 70%, var(--color-textcolor)); }
    @media (max-width: 480px) {
        .scale-options { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }
</style>
