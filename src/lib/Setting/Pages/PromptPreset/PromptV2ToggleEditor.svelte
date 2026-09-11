<script lang="ts">
    import { CheckIcon, ChevronDownIcon, ChevronRightIcon, ClipboardIcon, ListFilterIcon, SlidersHorizontalIcon } from '@lucide/svelte'
    import { language } from 'src/lang'
    import { parsePromptV2ToggleTree, type PromptV2ToggleDefinition, type PromptV2ToggleUsage } from 'src/ts/promptV2'
    import TextAreaInput from 'src/lib/UI/GUI/TextAreaInput.svelte'

    let {
        view,
        template = $bindable(),
        usages = {},
        onOpenUsage = () => {},
        scrollTop = 0,
        onScrollTopChange = () => {},
    }: {
        view: 'library' | 'source'
        template: string
        usages?: Record<string, PromptV2ToggleUsage[]>
        onOpenUsage?: (usage: PromptV2ToggleUsage) => void
        scrollTop?: number
        onScrollTopChange?: (scrollTop: number) => void
    } = $props()

    let search = $state('')
    let copiedKey = $state('')
    let expandedKeys = $state(new Set<string>())
    let copyTimer: ReturnType<typeof setTimeout> | undefined
    const tree = $derived(parsePromptV2ToggleTree(template))
    const visibleDefinitions = $derived.by(() => {
        const query = search.trim().toLocaleLowerCase()
        if (!query) return tree.definitions
        return tree.definitions.filter((definition) =>
            definition.label.toLocaleLowerCase().includes(query)
            || definition.key.toLocaleLowerCase().includes(query)
            || definition.group?.toLocaleLowerCase().includes(query),
        )
    })

    async function copyKey(definition: PromptV2ToggleDefinition) {
        if (!navigator.clipboard?.writeText) return
        await navigator.clipboard.writeText(definition.key)
        copiedKey = definition.key
        if (copyTimer) clearTimeout(copyTimer)
        copyTimer = setTimeout(() => copiedKey = '', 1400)
    }

    function toggleExpanded(key: string) {
        const next = new Set(expandedKeys)
        if (next.has(key)) next.delete(key)
        else next.add(key)
        expandedKeys = next
    }
</script>

{#if view === 'library'}
    <section class="flex h-full min-h-0 flex-col" aria-label={language.promptV2.variableLibrary}>
        <header class="prompt-v2-pane-header border-b border-darkborderc px-4 py-3">
            <div class="flex items-center justify-between gap-2">
                <div class="flex items-center gap-2 font-medium">
                    <ListFilterIcon size={16} class="text-borderc" />
                    <span>{language.promptV2.variableLibrary}</span>
                </div>
                <span class="rounded-full bg-darkbutton px-2 py-0.5 text-[11px] text-textcolor2">
                    {language.promptV2.toggleCount(tree.definitions.length)}
                </span>
            </div>
            <div class="relative mt-3">
                <ListFilterIcon size={14} class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-textcolor2" />
                <input
                    class="h-10 w-full rounded-md border border-darkborderc bg-transparent pl-9 pr-3 text-sm outline-none placeholder:text-textcolor2 focus:border-borderc focus:ring-2 focus:ring-borderc/50"
                    bind:value={search}
                    placeholder={language.promptV2.searchVariables}
                />
            </div>
        </header>

        <div class="min-h-0 grow overflow-y-auto p-2">
            {#if visibleDefinitions.length > 0}
                <div class="flex flex-col gap-1">
                    {#each visibleDefinitions as definition (definition)}
                        {@const definitionUsages = usages[definition.key] ?? []}
                        <div class="overflow-hidden rounded-lg border border-transparent hover:border-darkborderc">
                            <div class="group flex min-h-14 items-stretch">
                                <button
                                    type="button"
                                    data-prompt-v2-variable={definition.key}
                                    class="flex min-w-0 grow items-center gap-2 px-2.5 py-2 text-left hover:bg-selected/25 focus-visible:bg-selected/25 focus-visible:outline-none"
                                    aria-expanded={expandedKeys.has(definition.key)}
                                    onclick={() => toggleExpanded(definition.key)}
                                >
                                    {#if expandedKeys.has(definition.key)}
                                        <ChevronDownIcon size={15} class="shrink-0 text-borderc" />
                                    {:else}
                                        <ChevronRightIcon size={15} class="shrink-0 text-textcolor2" />
                                    {/if}
                                    <div class="min-w-0 grow">
                                        <div class="truncate text-sm font-medium">{definition.label}</div>
                                        <div class="mt-0.5 truncate font-mono text-[11px] text-textcolor2">{definition.key}</div>
                                        {#if definition.group}<div class="mt-0.5 truncate text-[11px] text-textcolor2">{definition.group}</div>{/if}
                                    </div>
                                    <span class="min-w-6 shrink-0 rounded-full bg-darkbutton px-1.5 py-0.5 text-center text-[11px] tabular-nums text-textcolor2">{definitionUsages.length}</span>
                                </button>
                                <button
                                    type="button"
                                    class="grid w-9 shrink-0 place-content-center text-textcolor2 hover:bg-selected/25 hover:text-textcolor focus-visible:outline-2 focus-visible:outline-borderc"
                                    onclick={() => copyKey(definition)}
                                    title={language.promptV2.copyKey}
                                    aria-label={language.promptV2.copyKey}
                                >
                                    {#if copiedKey === definition.key}
                                        <CheckIcon size={15} class="text-success" />
                                    {:else}
                                        <ClipboardIcon size={15} class="opacity-55 group-hover:opacity-100" />
                                    {/if}
                                </button>
                            </div>
                            {#if expandedKeys.has(definition.key) && definitionUsages.length > 0}
                                <div class="border-t border-darkborderc bg-darkbg/55 py-1 pl-6 pr-1.5">
                                    {#each definitionUsages as usage}
                                        <button
                                            type="button"
                                            data-prompt-v2-usage
                                            class="block w-full rounded-md px-2 py-1.5 text-left hover:bg-selected/30 focus-visible:bg-selected/30 focus-visible:outline-none"
                                            onclick={() => onOpenUsage(usage)}
                                        >
                                            <span class="flex items-baseline justify-between gap-2 text-xs">
                                                <span class="truncate font-medium text-textcolor">{usage.blockName}</span>
                                                <span class="shrink-0 text-[10px] tabular-nums text-borderc">{language.promptV2.lineNumber(usage.line)}</span>
                                            </span>
                                            <span class="mt-0.5 block truncate font-mono text-[10px] leading-relaxed text-textcolor2">{usage.preview}</span>
                                        </button>
                                    {/each}
                                </div>
                            {/if}
                        </div>
                    {/each}
                </div>
            {:else}
                <div class="flex min-h-44 items-center justify-center px-5 text-center text-sm text-textcolor2">
                    {language.promptV2.noToggleVariables}
                </div>
            {/if}
        </div>
    </section>
{:else}
    <section class="flex h-full min-h-0 flex-col" aria-label={language.promptV2.toggleSource}>
        <header class="prompt-v2-pane-header border-b border-darkborderc px-4 py-3">
            <div class="flex items-center gap-2 font-medium">
                <SlidersHorizontalIcon size={16} class="text-borderc" />
                <span>{language.promptV2.toggleSource}</span>
            </div>
            <p class="mt-1 text-xs leading-relaxed text-textcolor2">{language.promptV2.toggleSourceHint}</p>
        </header>
        <div class="min-h-0 grow p-3">
            <TextAreaInput
                bind:value={template}
                fullwidth
                height="full"
                resizable
                highlight
                optimaizedInput={false}
                placeholder={language.promptV2.toggleSourcePlaceholder}
                popupLanguage="plaintext"
                {scrollTop}
                {onScrollTopChange}
            />
        </div>
    </section>
{/if}
