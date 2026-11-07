<script lang="ts">
    import type { Snippet } from 'svelte'
    import { tooltip } from 'src/ts/gui/tooltip'

    let { label, text, onclick, disabled = false, pressed, expanded, tone = 'ghost', children }: {
        label: string
        /** Visible caption next to the icon; the label stays the accessible name and tooltip. */
        text?: string
        onclick?: (event: MouseEvent) => void
        disabled?: boolean
        pressed?: boolean
        expanded?: boolean
        tone?: 'ghost' | 'danger' | 'accent'
        children: Snippet
    } = $props()
</script>

<button type="button" class="icon-button" class:labeled={!!text} class:danger={tone === 'danger'} class:accent={tone === 'accent'} aria-label={label} aria-pressed={pressed} aria-expanded={expanded} {disabled} {onclick} use:tooltip={label}>{@render children()}{#if text}<span>{text}</span>{/if}</button>

<style>
    .icon-button { display: inline-grid; place-items: center; flex-shrink: 0; width: 2rem; height: 2rem; padding: 0; border: 0; border-radius: calc(var(--risu-radius-lg) * 0.8); background: transparent; color: var(--color-textcolor2); transition: background-color .15s ease-out, color .15s ease-out, border-color .15s ease-out; }
    .icon-button.labeled { display: inline-flex; align-items: center; gap: .35rem; width: auto; padding: 0 .65rem 0 .55rem; border: 1px solid var(--color-darkborderc); color: var(--color-textcolor); font-size: .78rem; white-space: nowrap; }
    .icon-button.labeled :global(svg) { color: var(--color-textcolor2); flex-shrink: 0; }
    .icon-button.accent { border-color: color-mix(in srgb, var(--color-primary) 70%, var(--color-darkborderc)); background: color-mix(in srgb, var(--color-primary) 16%, transparent); }
    .icon-button.accent :global(svg) { color: var(--color-primary); }
    .icon-button:hover:not(:disabled), .icon-button[aria-pressed='true'], .icon-button[aria-expanded='true'] { background: var(--color-darkbutton); color: var(--color-textcolor); }
    .icon-button[aria-pressed='true'] { color: var(--color-primary); }
    .icon-button.danger:hover:not(:disabled) { color: var(--color-danger); }
    .icon-button:disabled { opacity: .4; cursor: not-allowed; }
    .icon-button:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 1px; }
    @media (pointer: coarse) { .icon-button { width: 2.75rem; height: 2.75rem; } .icon-button.labeled { width: auto; } }
</style>
