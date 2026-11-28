<script lang="ts">
    import { language } from 'src/lang'
    import {
        alwaysActiveBardLoreEntries,
        isAutoRequiredBardLoreEntry,
        setAlwaysActiveBardLoreRequired,
        type BardLoreEntry,
    } from 'src/ts/lorebook/bardLore'

    interface Props {
        entries: BardLoreEntry[]
        disabled?: boolean
        onChange: (entries: BardLoreEntry[]) => void
    }

    let { entries, disabled = false, onChange }: Props = $props()
    let overrides = $state(new Map<string, boolean>())
    let applied = $state(false)

    const candidates = $derived(alwaysActiveBardLoreEntries(entries))
    const requiredCount = $derived(candidates.filter((entry) => entry.bard.activation === 'required' || isAutoRequiredBardLoreEntry(entry)).length)

    function checked(entry: BardLoreEntry): boolean {
        return overrides.get(entry.id) ?? entry.bard.activation === 'required'
    }

    function toggle(entry: BardLoreEntry, value: boolean) {
        const next = new Map(overrides)
        if (value === (entry.bard.activation === 'required')) next.delete(entry.id)
        else next.set(entry.id, value)
        overrides = next
        applied = false
    }

    function commit(requiredIds: Set<string>) {
        onChange(setAlwaysActiveBardLoreRequired(entries, requiredIds))
        overrides = new Map()
        applied = true
    }

    function applySelection() {
        commit(new Set(candidates.filter(checked).map((entry) => entry.id)))
    }

    function makeAllRequired() {
        commit(new Set(candidates.map((entry) => entry.id)))
    }
</script>

{#if candidates.length > 0}
    <section
        class="always-active-review"
        class:complete={requiredCount === candidates.length}
        data-bard-always-active-review
        aria-label={language.lorebookWorkspace.bardAlwaysActiveShowList}
    >
        <strong data-bard-always-active-title>{language.lorebookWorkspace.bardAlwaysActiveTitle(requiredCount, candidates.length)}</strong>
        <small>{language.lorebookWorkspace.bardAlwaysActiveDescription}</small>
        <details open={requiredCount < candidates.length}>
            <summary>{language.lorebookWorkspace.bardAlwaysActiveShowList}</summary>
            <ul>
                {#each candidates as entry (entry.id)}
                    {@const auto = isAutoRequiredBardLoreEntry(entry)}
                    <li>
                        <label class:auto>
                            <input
                                type="checkbox"
                                data-bard-always-active-entry={entry.id}
                                checked={auto || checked(entry)}
                                disabled={disabled || auto}
                                onchange={(event) => toggle(entry, event.currentTarget.checked)}
                            />
                            <span class="entry-name">{entry.comment || entry.id}</span>
                            {#if auto}<span class="entry-note">{language.lorebookWorkspace.bardAlwaysActiveAuto}</span>{/if}
                        </label>
                    </li>
                {/each}
            </ul>
        </details>
        <div class="actions">
            <button
                type="button"
                class="secondary"
                data-bard-always-active-all
                disabled={disabled || requiredCount === candidates.length}
                onclick={makeAllRequired}
            >{language.lorebookWorkspace.bardAlwaysActiveAllRequired}</button>
            <button
                type="button"
                class="secondary"
                data-bard-always-active-apply
                disabled={disabled || overrides.size === 0}
                onclick={applySelection}
            >{language.lorebookWorkspace.bardAlwaysActiveApply}</button>
            {#if applied}<span class="applied" role="status">{language.lorebookWorkspace.bardAlwaysActiveApplied}</span>{/if}
        </div>
    </section>
{/if}

<style>
    .always-active-review { display: grid; gap: .35rem; padding: .65rem .75rem; border: 1px solid var(--color-darkborderc); border-radius: calc(var(--risu-radius-lg) * 1.1); background: var(--color-darkbg); color: var(--color-textcolor); }
    .always-active-review:not(.complete) { border-color: var(--color-warning); }
    .always-active-review small { color: var(--color-textcolor2); line-height: 1.45; }
    details { font-size: .78rem; }
    summary { cursor: pointer; }
    ul { display: grid; gap: .15rem; max-height: 16rem; margin: .4rem 0 0; padding: 0; overflow-y: auto; list-style: none; }
    label { display: flex; align-items: center; gap: .5rem; min-width: 0; padding: .3rem .25rem; border-radius: var(--risu-radius-md, .4rem); cursor: pointer; }
    label:hover { background: var(--color-selected); }
    label.auto { cursor: default; }
    input { flex: 0 0 auto; width: 1rem; height: 1rem; accent-color: var(--color-info); }
    .entry-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .entry-note { flex: 0 0 auto; margin-left: auto; color: var(--color-textcolor2); font-size: .7rem; }
    .actions { display: flex; flex-wrap: wrap; align-items: center; gap: .45rem; margin-top: .2rem; }
    button { min-height: 2.2rem; padding: .4rem .7rem; border: 1px solid var(--color-darkborderc); border-radius: var(--risu-radius-lg); background: var(--color-surface-raised, var(--color-darkbg)); color: var(--color-textcolor); font-weight: 650; }
    button:disabled { cursor: not-allowed; opacity: .55; }
    .applied { color: var(--color-success); font-size: .75rem; }
</style>
