<script lang="ts">
    import { language } from 'src/lang'
    import { tokenize } from 'src/ts/tokenizer'
    import { risuChatParser } from 'src/ts/parser/parser.svelte'
    import type { character as Character } from 'src/ts/storage/database.svelte'
    import type { BardLoreEntry, BardLoreSettings } from 'src/ts/lorebook/bardLore'
    import {
        selectBardLoreEntries,
        type BardLoreExclusionReason,
        type BardLoreSelectionResult,
    } from 'src/ts/lorebook/bardLoreRetrieval'

    interface Props {
        entries: BardLoreEntry[]
        settings: BardLoreSettings
        character: Character
    }

    let { entries, settings, character }: Props = $props()
    let query = $state('')
    let running = $state(false)
    let error = $state('')
    let result = $state<BardLoreSelectionResult | null>(null)

    function exclusionLabel(reason: BardLoreExclusionReason): string {
        switch (reason) {
            case 'ineligible': return language.lorebookWorkspace.bardExcludedIneligible
            case 'routing-only': return language.lorebookWorkspace.bardExcludedRoutingOnly
            case 'no-match': return language.lorebookWorkspace.bardExcludedNoMatch
            case 'kind-mismatch': return language.lorebookWorkspace.bardExcludedKindMismatch
            case 'constraint-mismatch': return language.lorebookWorkspace.bardExcludedConstraintMismatch
            case 'entry-limit': return language.lorebookWorkspace.bardExcludedEntryLimit
            case 'requested-count': return language.lorebookWorkspace.bardExcludedRequestedCount
            case 'target-reached': return language.lorebookWorkspace.bardExcludedTargetReached
            case 'token-limit': return language.lorebookWorkspace.bardExcludedTokenLimit
        }
    }

    async function runPreview() {
        error = ''
        result = null
        running = true
        try {
            const tokenCounts: Record<string, number> = {}
            await Promise.all(entries.filter((entry) => entry.bard.injection !== 'index-only').map(async (entry) => {
                tokenCounts[entry.id] = await tokenize(risuChatParser(entry.content, { chara: character }))
            }))
            result = selectBardLoreEntries({ query, entries, tokenCounts, settings, scopeAliases: [character.name] })
        }
        catch (cause) {
            error = cause instanceof Error ? cause.message : String(cause)
        }
        finally {
            running = false
        }
    }
</script>

<section class="preview" aria-label={language.lorebookWorkspace.bardSearchPreview}>
    <strong>{language.lorebookWorkspace.bardSearchPreview}</strong>
    <div class="controls">
        <input
            data-bard-lore-preview-query
            bind:value={query}
            placeholder={language.lorebookWorkspace.bardSearchPlaceholder}
            onkeydown={(event) => {
                if (event.key === 'Enter') void runPreview()
            }}
        />
        <button
            type="button"
            data-bard-lore-preview-run
            disabled={running}
            onclick={() => void runPreview()}
        >{running ? language.lorebookWorkspace.bardSearching : language.lorebookWorkspace.bardRunSearch}</button>
    </div>
    {#if error}
        <p class="error">{error}</p>
    {:else if result}
        <p>{language.lorebookWorkspace.bardSearchTotal(result.selected.length, result.totalTokens)}</p>
        <div class="query-plan" data-bard-lore-query-plan>
            <span><strong>Intent</strong> <span data-bard-lore-query-intent>{result.plan.intent}</span></span>
            <span><strong>Count</strong> <span data-bard-lore-query-count>{result.plan.requestedCount ?? '—'}</span></span>
            <span><strong>Kinds</strong> <span data-bard-lore-query-kinds>{result.plan.targetKinds.join(', ') || '—'}</span></span>
            <span><strong>Constraints</strong> <span data-bard-lore-query-constraints>{result.plan.constraints.map((item) => `${item.key}=${item.value}`).join(', ') || '—'}</span></span>
            <span><strong>Scope</strong> <span data-bard-lore-query-scope>{result.plan.scopeMatches.join(', ') || '—'}</span></span>
            <span><strong>Anchors</strong> <span>{result.plan.anchors.map((item) => item.phrase).join(', ') || '—'}</span></span>
        </div>
        <p data-bard-lore-budget-lanes>required {result.requiredTokens} · context {result.contextualTokens} · total {result.totalTokens}</p>
        <ol>
            {#each result.selected as selection}
                <li data-bard-lore-preview-result={selection.entry.id}>
                    <strong>{selection.entry.comment || selection.entry.id}</strong>
                    <span>{selection.lane} · {selection.reason} · {Math.round(selection.score * 100) / 100}</span>
                    {#if selection.path}<small>{selection.path.join(' → ')}</small>{/if}
                </li>
            {/each}
        </ol>
        {#if result.excluded.length > 0}
            <details>
                <summary>{language.lorebookWorkspace.bardExcludedTotal(result.excluded.length)}</summary>
                <ul>
                    {#each result.excluded as exclusion}
                        <li data-bard-lore-preview-excluded={exclusion.entry.id}>
                            <strong>{exclusion.entry.comment || exclusion.entry.id}</strong>
                            <span>{exclusionLabel(exclusion.reason)}</span>
                        </li>
                    {/each}
                </ul>
            </details>
        {/if}
    {/if}
</section>

<style>
    .preview { display: grid; gap: .55rem; margin: .65rem 0; padding: .75rem; border: 1px solid var(--color-darkborderc); border-radius: calc(var(--risu-radius-lg) * 1.2); background: color-mix(in srgb, var(--color-selected) 10%, transparent); }
    .controls { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: .45rem; }
    input, button { min-height: 2.4rem; padding: .45rem .6rem; border: 1px solid var(--color-darkborderc); border-radius: calc(var(--risu-radius-lg) * 0.9); background: var(--color-darkbg); color: var(--color-textcolor); }
    button { background: var(--color-selected); }
    ol { display: grid; gap: .35rem; margin: 0; padding-left: 1.4rem; }
    .query-plan { display: grid; grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr)); gap: .35rem; padding: .5rem; border: 1px solid var(--color-darkborderc); border-radius: calc(var(--risu-radius-lg) * 0.9); }
    .query-plan > span { display: grid; gap: .15rem; color: var(--color-textcolor2); }
    li { padding: .35rem; }
    li span, li small { display: block; color: var(--color-textcolor2); }
    details ul { display: grid; gap: .25rem; margin: .35rem 0 0; padding-left: 1.4rem; }
    .error { color: var(--color-red); }
    @media (max-width: 599px) { .controls { grid-template-columns: 1fr; } }
</style>
