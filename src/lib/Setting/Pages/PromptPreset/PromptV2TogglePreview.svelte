<script lang="ts">
    import { EyeIcon, PinIcon, RotateCcwIcon } from '@lucide/svelte'
    import { language } from 'src/lang'
    import {
        parsePromptV2ToggleTree,
        type PromptV2ToggleTreeItem,
    } from 'src/ts/promptV2'
    import ShAccordion from 'src/lib/UI/GUI/ShAccordion.svelte'
    import ShButton from 'src/lib/UI/GUI/ShButton.svelte'
    import ShSwitch from 'src/lib/UI/GUI/ShSwitch.svelte'
    import SelectInput from 'src/lib/UI/GUI/SelectInput.svelte'
    import OptionInput from 'src/lib/UI/GUI/OptionInput.svelte'

    let {
        template,
        previewValues = $bindable(),
        referencedKeys = new Set<string>(),
        onReset,
    }: {
        template: string
        previewValues: Record<string, string>
        referencedKeys?: Set<string>
        onReset?: () => void
    } = $props()

    const tree = $derived(parsePromptV2ToggleTree(template))

    function updateValue(key: string, value: string) {
        previewValues[key] = value
    }
</script>

{#snippet renderItems(items: PromptV2ToggleTreeItem[])}
    {#each items as item, index}
        {#if index > 0 && item.type !== 'divider' && items[index - 1]?.type !== 'divider' && item.type !== 'caption'}
            <div class="mx-1 border-t border-darkborderc/35"></div>
        {/if}

        {#if item.type === 'group'}
            <ShAccordion class="w-full" name={item.label}>
                <div class="flex flex-col px-1 pb-1">
                    {@render renderItems(item.children)}
                </div>
            </ShAccordion>
        {:else if item.type === 'caption'}
            <p class="px-1 py-0.5 text-xs leading-snug text-textcolor2">{item.label}</p>
        {:else if item.type === 'divider'}
            <div class="flex min-h-6 items-center gap-2 px-1">
                {#if item.label}<span class="text-xs text-textcolor2">{item.label}</span>{/if}
                <div class="grow border-t border-darkborderc"></div>
            </div>
        {:else if item.type === 'toggle'}
            {@const definition = item.definition}
            <div
                class="toggle-preview-row"
                class:toggle-preview-row--referenced={referencedKeys.has(definition.key)}
                data-toggle-key={definition.key}
            >
                <span class="min-w-0 grow break-words text-sm">{definition.label}</span>
                {#if definition.type === 'select'}
                    <SelectInput
                        className="w-32 shrink-0"
                        size="sm"
                        value={previewValues[definition.key] ?? '0'}
                        onchange={(event) => updateValue(definition.key, event.currentTarget.value)}
                    >
                        {#each definition.options as option, optionIndex}
                            <OptionInput value={String(optionIndex)}>{option}</OptionInput>
                        {/each}
                    </SelectInput>
                {:else if definition.type === 'text'}
                    <input
                        class="h-10 w-32 shrink-0 rounded-md border border-darkborderc bg-transparent px-3 text-sm outline-none focus:border-borderc focus:ring-2 focus:ring-borderc/50"
                        value={previewValues[definition.key] ?? ''}
                        aria-label={definition.label}
                        oninput={(event) => updateValue(definition.key, event.currentTarget.value)}
                    />
                {:else if definition.type === 'textarea'}
                    <textarea
                        class="min-h-20 w-32 shrink-0 resize-y rounded-md border border-darkborderc bg-transparent px-3 py-2 text-sm outline-none focus:border-borderc focus:ring-2 focus:ring-borderc/50"
                        value={previewValues[definition.key] ?? ''}
                        aria-label={definition.label}
                        oninput={(event) => updateValue(definition.key, event.currentTarget.value)}
                    ></textarea>
                {:else}
                    <ShSwitch
                        className="shrink-0"
                        checked={(previewValues[definition.key] ?? '0') === '1'}
                        onCheckedChange={(checked) => updateValue(definition.key, checked ? '1' : '0')}
                    />
                {/if}
            </div>
        {/if}
    {/each}
{/snippet}

<section class="flex h-full min-h-0 flex-col" aria-label={language.promptV2.sidebarPreview}>
    <header class="prompt-v2-pane-header flex items-start justify-between gap-3 border-b border-darkborderc px-4 py-3">
        <div class="min-w-0">
            <div class="flex items-center gap-2 font-medium">
                <EyeIcon size={16} class="text-borderc" />
                <span>{language.promptV2.sidebarPreview}</span>
            </div>
            <p class="mt-1 text-xs leading-relaxed text-textcolor2">{language.promptV2.previewHint}</p>
        </div>
        <ShButton size="sm" variant="outline" onclick={onReset} title={language.promptV2.resetPreview} aria-label={language.promptV2.resetPreview}>
            <RotateCcwIcon size={14} />
            <span>{language.promptV2.resetPreview}</span>
        </ShButton>
    </header>

    <div class="min-h-0 grow overflow-y-auto px-3 py-3">
        <div class="mb-3 text-[11px] text-textcolor2">{language.toggleBindingLabel}</div>
        <ShButton className="mb-4 w-full" disabled>
            <PinIcon size={16} />
            <span>{language.togglePinLabel}</span>
        </ShButton>

        {#if tree.items.length > 0}
            <div class="flex flex-col">
                {@render renderItems(tree.items)}
            </div>
        {:else}
            <div class="flex min-h-48 flex-col items-center justify-center rounded-lg border border-dashed border-darkborderc px-6 text-center">
                <EyeIcon size={22} class="mb-3 text-textcolor2" />
                <p class="text-sm font-medium">{language.promptV2.noToggleVariables}</p>
                <p class="mt-1 text-xs leading-relaxed text-textcolor2">{language.promptV2.toggleSourceHint}</p>
            </div>
        {/if}
    </div>
</section>

<style>
    .toggle-preview-row {
        display: flex;
        min-height: 2.5rem;
        align-items: center;
        justify-content: space-between;
        gap: .75rem;
        border-left: 2px solid transparent;
        border-radius: .5rem;
        padding: .25rem .4rem .25rem .55rem;
        transition: background-color 160ms ease, border-color 160ms ease;
    }

    .toggle-preview-row--referenced {
        border-left-color: var(--color-primary);
        background: color-mix(in srgb, var(--color-primary) 8%, transparent);
    }
</style>
