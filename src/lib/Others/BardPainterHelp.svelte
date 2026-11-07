<script lang="ts">
    import { CircleHelp } from '@lucide/svelte'
    import type { Snippet } from 'svelte'

    let { label, children }: { label: string; children: Snippet } = $props()
    let open = $state(false)
</script>

<button type="button" class="help-button" class:open aria-label={`${label} 도움말`} aria-expanded={open} title={`${label} 도움말`}
    onclick={() => open = !open} onkeydown={event => { if (event.key === 'Escape' && open) { event.stopPropagation(); open = false } }}><CircleHelp size={15} aria-hidden="true" /></button>
{#if open}<span class="help-note" role="note">{@render children()}</span>{/if}

<style>
    .help-button { display: inline-grid; place-items: center; flex-shrink: 0; width: 1.5rem; height: 1.5rem; min-height: 1.5rem; padding: 0; border: 0; border-radius: 999px; color: var(--color-textcolor2); background: transparent; vertical-align: middle; }
    .help-button:hover, .help-button.open { color: var(--color-textcolor); background: var(--color-darkbutton); }
    .help-button:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 1px; }
    .help-note { display: block; flex-basis: 100%; width: 100%; margin: .15rem 0 .1rem; padding: .45rem .6rem; border-radius: calc(var(--risu-radius-sm) * 1.2); background: var(--color-bgcolor); color: var(--color-textcolor2); font-size: .75rem; font-weight: 400; line-height: 1.55; overflow-wrap: anywhere; }
    @media (pointer: coarse) { .help-button { width: 2.25rem; height: 2.25rem; } }
</style>
