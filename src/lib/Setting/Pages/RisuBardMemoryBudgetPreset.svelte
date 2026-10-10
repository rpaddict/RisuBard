<script lang="ts">
    import { getCurrentLocale, language } from 'src/lang'
    import Help from 'src/lib/Others/Help.svelte'
    import {
        MEMORY_BUDGET_PRESET_IDS,
        detectMemoryBudgetPreset,
        memoryBudgetPresetValues,
        type MemoryBudgetPresetId,
    } from 'src/ts/risubard/memoryBudgetPreset'
    import { resolveRisuBardChatSettings } from 'src/ts/risubard/risuBardSettings'
    import { memoryBudgetPresetUi } from 'src/ts/setting/memoryBudgetPresetUi.svelte'
    import { DBState } from 'src/ts/stores.svelte'

    let settings = $derived(resolveRisuBardChatSettings(DBState.db))
    // The selection is derived from the six stored values; only choosing custom keeps the entries open without changing them.
    let selection = $derived<MemoryBudgetPresetId | 'custom'>(
        memoryBudgetPresetUi.customOpen ? 'custom' : detectMemoryBudgetPreset(settings)
    )
    let labels = $derived<Record<MemoryBudgetPresetId | 'custom', string>>({
        economy: language.risuBardMemoryBudgetPresetEconomy,
        standard: language.risuBardMemoryBudgetPresetStandard,
        generous: language.risuBardMemoryBudgetPresetGenerous,
        custom: language.risuBardMemoryBudgetPresetCustom,
    })
    // One entry per label and value pair (the localized template is split at its " / " separators), so the summary can
    // wrap between pairs but never inside one.
    let summaryParts = $derived.by(() => {
        if (selection === 'custom') return []
        const format = (value: number) => value.toLocaleString(getCurrentLocale())
        return language.risuBardMemoryBudgetSummary
            .replace('{target}', format(settings.risuBardInquiryTargetTokenBudget))
            .replace('{events}', format(settings.risuBardInquiryEventTokenBudget))
            .replace('{perSource}', format(settings.risuBardInquirySourceTokenBudget))
            .replace('{maximum}', format(settings.risuBardInquiryMaximumTokenBudget))
            .replace('{dynamic}', settings.risuBardDynamicMemoryMode === 'balanced'
                ? language.risuBardMemoryBudgetDynamicBalanced
                : language.risuBardMemoryBudgetDynamicEconomy)
            .split(' / ')
    })

    function selectPreset(value: string): void {
        if (value === 'custom') {
            memoryBudgetPresetUi.customOpen = true
            return
        }
        const id = MEMORY_BUDGET_PRESET_IDS.find((candidate) => candidate === value)
        if (!id) return
        Object.assign(DBState.db, memoryBudgetPresetValues(id))
        memoryBudgetPresetUi.customOpen = false
    }
</script>

<div
    data-setting-row
    data-setting-id="risubard.chat.memoryBudgetPreset"
    class="settings-standard-row flex items-center justify-between gap-4 border-t border-darkborderc"
>
    <div class="flex min-w-0 flex-col">
        <span class="text-sm text-textcolor">
            <label for="risubard-memory-budget-preset">{language.risuBardMemoryBudgetPreset}</label>
            <Help key="risuBardMemoryBudgetPreset" name={language.risuBardMemoryBudgetPreset} />
        </span>
        {#if summaryParts.length}
            <p id="risubard-memory-budget-summary" class="mt-0.5 wrap-break-word text-xs text-textcolor2">{#each summaryParts as part, index}{#if index > 0}{' / '}{/if}<span class="whitespace-nowrap">{part}</span>{/each}</p>
        {/if}
    </div>
    <select
        id="risubard-memory-budget-preset"
        class="w-56 max-w-full shrink-0 rounded-md border border-darkborderc bg-transparent px-3 py-1.5 text-sm text-textcolor shadow-xs transition-colors focus:border-borderc focus:outline-hidden focus:ring-2 focus:ring-borderc"
        value={selection}
        aria-describedby={summaryParts.length ? 'risubard-memory-budget-summary' : undefined}
        onchange={(event) => selectPreset(event.currentTarget.value)}
    >
        {#each MEMORY_BUDGET_PRESET_IDS as id (id)}
            <option value={id} class="bg-darkbg">{labels[id]}</option>
        {/each}
        <option value="custom" class="bg-darkbg">{labels.custom}</option>
    </select>
</div>
