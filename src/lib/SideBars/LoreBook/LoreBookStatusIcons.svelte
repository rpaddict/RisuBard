<script lang="ts">
    import { language } from 'src/lang'
    import type { loreBook } from 'src/ts/storage/database.svelte'
    import SolarIcon from './SolarIcon.svelte'
    import { loreBookVisualStatus } from './loreBookVisualStatus'
    import sunIcon from 'src/assets/solar-bold/sun-bold.svg'
    import linkIcon from 'src/assets/solar-bold/link-minimalistic-2-bold.svg'
    import multipleKeyIcon from 'src/assets/solar-bold/link-round-angle-bold.svg'
    import unlinkIcon from 'src/assets/solar-bold/unlink-minimalistic-bold.svg'
    import hiddenIcon from 'src/assets/solar-bold/eye-closed-bold.svg'

    interface Props {
        entry: loreBook
        size?: string
        showActivation?: boolean
        onActivationClick?: () => void
    }

    let { entry, size = '1.05rem', showActivation = true, onActivationClick }: Props = $props()
    let status = $derived(loreBookVisualStatus(entry))
    let activationTitle = $derived(
        status.activation === 'always' ? language.lorebookWorkspace.alwaysActive
            : status.activation === 'multiple-key' ? language.lorebookWorkspace.selective
                : status.activation === 'unreachable' ? language.lorebookWorkspace.unreachable
                    : language.lorebookWorkspace.keyActive,
    )
</script>

<span class="status-icons" data-lorebook-status-icons>
    {#if status.hidden}
        <span class="hidden-status" data-lorebook-status-hidden title={language.lorebookWorkspace.hidden}>
            <SolarIcon src={hiddenIcon} name="eye-closed-bold" {size} />
        </span>
    {/if}
    {#if showActivation && onActivationClick}
        <button
            type="button"
            class:unreachable={status.unreachable}
            class="activation-status"
            data-lorebook-activation-status={status.activation}
            title={activationTitle}
            aria-label={activationTitle}
            onclick={(event) => { event.stopPropagation(); onActivationClick?.() }}
        >
            {#if status.activation === 'always'}
                <SolarIcon src={sunIcon} name="sun-bold" {size} />
            {:else if status.activation === 'multiple-key'}
                <SolarIcon src={multipleKeyIcon} name="link-round-angle-bold" {size} />
            {:else if status.activation === 'unreachable'}
                <SolarIcon src={unlinkIcon} name="unlink-minimalistic-bold" {size} />
            {:else}
                <SolarIcon src={linkIcon} name="link-minimalistic-2-bold" {size} />
            {/if}
        </button>
    {:else if showActivation}
        <span
            class:unreachable={status.unreachable}
            class="activation-status"
            data-lorebook-activation-status={status.activation}
            title={activationTitle}
        >
            {#if status.activation === 'always'}
                <SolarIcon src={sunIcon} name="sun-bold" {size} />
            {:else if status.activation === 'multiple-key'}
                <SolarIcon src={multipleKeyIcon} name="link-round-angle-bold" {size} />
            {:else if status.activation === 'unreachable'}
                <SolarIcon src={unlinkIcon} name="unlink-minimalistic-bold" {size} />
            {:else}
                <SolarIcon src={linkIcon} name="link-minimalistic-2-bold" {size} />
            {/if}
        </span>
    {/if}
</span>

<style>
    .status-icons { display: inline-flex; align-items: center; gap: .38rem; color: var(--color-textcolor2); }
    .status-icons > span, .activation-status { display: inline-flex; align-items: center; justify-content: center; }
    button.activation-status { margin: 0; padding: .18rem; border: 0; border-radius: calc(var(--risu-radius-sm) * 1.4); background: transparent; color: inherit; cursor: pointer; }
    button.activation-status:hover { background: color-mix(in srgb, var(--color-selected) 55%, transparent); color: var(--color-textcolor); }
    .unreachable { color: var(--color-danger); }
    .hidden-status { color: var(--color-textcolor2); opacity: .58; }
</style>
