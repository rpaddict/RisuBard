<script lang="ts">
    import { AlertTriangle, BookCheck } from '@lucide/svelte'
    import { language } from 'src/lang'
    import type { CanonicalTurnReceipt } from 'src/ts/risubard/memoryWiki'

    let { receipt }: {
        receipt: CanonicalTurnReceipt
    } = $props()
</script>

<aside class="turn-receipt" data-risubard-turn-receipt>
    <header>
        <span><BookCheck size={15} />{language.risuBardTurnCanon}</span>
    </header>
    {#if receipt.changes.length === 0}
        <p>{language.risuBardTurnCanonNoChanges}</p>
    {:else}
        <ul>
            {#each receipt.changes as change (change.documentId)}
                <li>
                    <span>
                        <small>{change.action === 'create'
                            ? language.risuBardCanonCreated
                            : language.risuBardCanonUpdated}</small>
                        {change.title}
                    </span>
                </li>
            {/each}
        </ul>
    {/if}
    {#each receipt.warnings as warning}
        <p class="warning"><AlertTriangle size={13} />{warning}</p>
    {/each}
    {#each receipt.notes ?? [] as note}
        <p class="note">{note}</p>
    {/each}
</aside>

<style>
    .turn-receipt { margin: .35rem .5rem .55rem; padding: .55rem .65rem; border: 1px solid color-mix(in srgb, var(--color-darkborderc) 75%, transparent); border-radius: .6rem; background: color-mix(in srgb, var(--risu-theme-bgcolor) 92%, var(--risu-theme-darkbutton)); font-size: .78rem; }
    header, header span, li, li > span, .warning { display: flex; align-items: center; gap: .35rem; }
    header, li { justify-content: space-between; }
    header { font-weight: 650; }
    ul { display: grid; gap: .25rem; margin: .45rem 0 0; padding: 0; list-style: none; }
    li small { opacity: .65; min-width: 2.8rem; }
    p { margin: .4rem 0 0; opacity: .72; }
    .warning { color: var(--color-warning); }
</style>
