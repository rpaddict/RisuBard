<script lang="ts">
    import { language } from 'src/lang'
    import { tooltipLeft } from 'src/ts/gui/tooltip'
    import type { BardLoreActivation } from 'src/ts/lorebook/bardLore'
    import ShDropdownMenu from 'src/lib/UI/GUI/ShDropdownMenu.svelte'
    import ShDropdownMenuContent from 'src/lib/UI/GUI/ShDropdownMenuContent.svelte'
    import ShDropdownMenuItem from 'src/lib/UI/GUI/ShDropdownMenuItem.svelte'
    import ShDropdownMenuTrigger from 'src/lib/UI/GUI/ShDropdownMenuTrigger.svelte'

    interface Props {
        value: BardLoreActivation | ''
        batch?: boolean
        onChange: (value: BardLoreActivation) => void
    }

    let { value, batch = false, onChange }: Props = $props()
    let options = $derived([
        {
            value: 'required' as const,
            label: language.lorebookWorkspace.bardRequired,
            help: language.lorebookWorkspace.bardGuideRequiredBody,
        },
        {
            value: 'keyed' as const,
            label: language.lorebookWorkspace.bardKeyed,
            help: language.lorebookWorkspace.bardGuideKeyedBody,
        },
        {
            value: 'retrieve' as const,
            label: language.lorebookWorkspace.bardRetrieve,
            help: language.lorebookWorkspace.bardGuideRetrieveBody,
        },
        {
            value: 'never' as const,
            label: language.lorebookWorkspace.bardNever,
            help: language.lorebookWorkspace.bardGuideNeverBody,
        },
    ])
    let selectedLabel = $derived(
        options.find((option) => option.value === value)?.label
            ?? language.lorebookWorkspace.bardBatchMixed
    )
    let triggerAttributes = $derived(batch
        ? { 'data-bard-lore-batch-activation': '' }
        : { 'data-bard-lore-activation': '' })
</script>

<ShDropdownMenu>
    <ShDropdownMenuTrigger>
        {#snippet child({ props })}
            <button
                {...props}
                {...triggerAttributes}
                type="button"
                class="activation-trigger"
                aria-label={`${language.lorebookWorkspace.bardActivation}: ${selectedLabel}`}
            >
                <span>{selectedLabel}</span><span aria-hidden="true">▾</span>
            </button>
        {/snippet}
    </ShDropdownMenuTrigger>
    <ShDropdownMenuContent class="min-w-48 activation-menu" align="start">
        {#each options as option}
            <ShDropdownMenuItem
                data-bard-lore-activation-option={option.value}
                data-tooltip-side="left"
                aria-label={`${option.label}. ${option.help}`}
                onSelect={() => onChange(option.value)}
            >
                <span class="activation-option" use:tooltipLeft={option.help}>
                    {option.label}
                </span>
            </ShDropdownMenuItem>
        {/each}
    </ShDropdownMenuContent>
</ShDropdownMenu>

<style>
    .activation-trigger {
        display: flex;
        width: 100%;
        min-height: 2.15rem;
        align-items: center;
        justify-content: space-between;
        gap: .75rem;
        padding: .42rem .65rem;
        border: 1px solid var(--color-darkborderc);
        border-radius: calc(var(--risu-radius-lg) * 0.96);
        background: color-mix(in srgb, var(--color-darkbg) 98%, var(--color-selected) 2%);
        color: var(--color-textcolor);
        font-size: .8rem;
        font-weight: 400;
        text-align: left;
    }
    .activation-trigger:hover { background: color-mix(in srgb, var(--color-selected) 24%, var(--color-darkbg)); }
    .activation-trigger:focus-visible { border-color: var(--color-borderc); box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-selected) 65%, transparent); outline: none; }
    .activation-option { display: block; width: 100%; }
</style>
