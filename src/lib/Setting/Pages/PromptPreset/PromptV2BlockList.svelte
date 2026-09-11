<script lang="ts">
    import {
        ArrowDownIcon,
        ArrowUpIcon,
        ArrowRightIcon,
        BracesIcon,
        CopyIcon,
        PlusIcon,
        ReplaceAllIcon,
        ReplaceIcon,
        SearchIcon,
        Trash2Icon,
    } from '@lucide/svelte'
    import { language } from 'src/lang'
    import type { PromptItem } from 'src/ts/process/prompt'
    import {
        countPromptV2BodyMatches,
        evaluatePromptV2Activation,
        getPromptV2TextSource,
        parsePromptV2Text,
    } from 'src/ts/promptV2'
    import ShButton from 'src/lib/UI/GUI/ShButton.svelte'
    import { findTextareaMatch } from 'src/ts/gui/textareaSearch'

    let {
        items,
        selectedIndex,
        previewValues,
        onSelect,
        onAdd,
        onDuplicate,
        onRemove,
        onMove,
        onFind,
        onReplaceOne,
        onReplaceAll,
    }: {
        items: PromptItem[]
        selectedIndex: number
        previewValues: Record<string, string>
        onSelect: (index: number) => void
        onAdd: () => void
        onDuplicate: () => void
        onRemove: (index: number) => void
        onMove: (index: number, direction: -1 | 1) => void
        onFind: (query: string) => void
        onReplaceOne?: (query: string, replacement: string) => void
        onReplaceAll?: (query: string, replacement: string) => void
    } = $props()

    let search = $state('')
    let replacement = $state('')
    const canFind = $derived(!!items[selectedIndex]
        && !!findTextareaMatch(blockState(items[selectedIndex]).body, search))
    const selectedMatchCount = $derived(items[selectedIndex]
        ? countPromptV2BodyMatches(items[selectedIndex], search)
        : 0)
    const totalMatchCount = $derived(items.reduce(
        (total, item) => total + countPromptV2BodyMatches(item, search),
        0,
    ))

    function blockName(item: PromptItem): string {
        if (item.name?.trim()) return item.name.trim()
        if (item.type === 'plain') return language.formating.plain
        if (item.type === 'jailbreak') return language.formating.jailbreak
        if (item.type === 'chat') return language.Chat
        if (item.type === 'persona') return language.formating.personaPrompt
        if (item.type === 'description') return language.formating.description
        if (item.type === 'authornote') return language.formating.authorNote
        if (item.type === 'lorebook') return language.formating.lorebook
        if (item.type === 'memory') return language.formating.memory
        if (item.type === 'postEverything') return language.formating.postEverything
        if (item.type === 'cot') return language.cot
        if (item.type === 'chatML') return 'ChatML'
        if (item.type === 'cache') return language.cachePoint
        return item.type
    }

    function blockState(item: PromptItem) {
        const text = getPromptV2TextSource(item)
        if (!text) return { label: language.promptV2.always, tone: 'neutral', body: '' }
        const parsed = parsePromptV2Text(text.source)
        if (!parsed.editable) return { label: language.promptV2.manual, tone: 'manual', body: parsed.body }
        if (!parsed.activation) return { label: language.promptV2.always, tone: 'neutral', body: parsed.body }
        const active = evaluatePromptV2Activation(parsed.activation, previewValues)
        return {
            label: active ? language.promptV2.active : language.promptV2.inactive,
            tone: active ? 'active' : 'inactive',
            body: parsed.body,
        }
    }

    const visibleItems = $derived.by(() => {
        const query = search.trim().toLocaleLowerCase()
        return items
            .map((item, index) => ({
                item,
                index,
                name: blockName(item),
                state: blockState(item),
                matchCount: countPromptV2BodyMatches(item, search),
            }))
            .filter(({ name, item, state }) => !query
                || name.toLocaleLowerCase().includes(query)
                || item.type.toLocaleLowerCase().includes(query)
                || state.body.toLocaleLowerCase().includes(query))
    })
</script>

<section class="flex h-full min-h-0 flex-col" aria-label={language.promptV2.blockList}>
    <header class="prompt-v2-pane-header prompt-v2-block-list-header border-b border-darkborderc px-3 py-3">
        <div class="flex items-center gap-2">
            <div class="flex items-center gap-2 font-medium">
                <BracesIcon size={16} class="text-borderc" />
                <span>{language.promptV2.blockList}</span>
            </div>
            <div class="ml-auto flex shrink-0 items-center gap-1">
                <ShButton size="xs" variant="secondary" onclick={onAdd}>
                    <PlusIcon size={14} />
                    {language.promptV2.newBlock}
                </ShButton>
                <ShButton size="xs" variant="secondary" onclick={onDuplicate} disabled={selectedIndex < 0 || selectedIndex >= items.length}>
                    <CopyIcon size={14} />
                    {language.promptV2.duplicateBlock}
                </ShButton>
            </div>
            <span class="hidden rounded-full bg-darkbutton px-2 py-0.5 text-[11px] text-textcolor2 2xl:inline">
                {language.promptV2.blockCount(items.length)}
            </span>
        </div>
        <div class="relative mt-3">
            <SearchIcon size={14} class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-textcolor2" />
            <input
                data-prompt-v2-find
                class="h-10 w-full rounded-md border border-darkborderc bg-transparent pl-9 pr-12 text-sm outline-none placeholder:text-textcolor2 focus:border-borderc focus:ring-2 focus:ring-borderc/50"
                bind:value={search}
                placeholder={language.promptV2.searchBlocks}
                onkeydown={(event) => {
                    if (event.key === 'Enter' && !event.isComposing && canFind) {
                        event.preventDefault()
                        onFind(search)
                    }
                }}
            />
            <button
                type="button"
                class="absolute right-1 top-1 flex h-8 w-8 items-center justify-center rounded text-textcolor2 hover:bg-selected hover:text-textcolor disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-borderc"
                disabled={!canFind}
                title={language.promptV2.jumpToMatch}
                aria-label={language.promptV2.jumpToMatch}
                onclick={() => onFind(search)}
            ><ArrowRightIcon size={16} /></button>
        </div>
        <div class="replacement-row mt-2">
            <input
                data-prompt-v2-replacement
                class="h-9 min-w-0 rounded-md border border-darkborderc bg-transparent px-3 text-sm outline-none placeholder:text-textcolor2 focus:border-borderc focus:ring-2 focus:ring-borderc/50"
                bind:value={replacement}
                placeholder={language.promptV2.replaceWith}
                onkeydown={(event) => {
                    if (event.key === 'Enter' && !event.isComposing && selectedMatchCount > 0 && search !== replacement) {
                        event.preventDefault()
                        onReplaceOne?.(search, replacement)
                    }
                }}
            />
            <ShButton
                data-prompt-v2-replace-one
                size="xs"
                variant="secondary"
                disabled={selectedMatchCount === 0 || search === replacement}
                onclick={() => onReplaceOne?.(search, replacement)}
                title={language.promptV2.replaceOneHint}
            >
                <ReplaceIcon size={13} />
                {language.promptV2.replaceOne}
                <span data-prompt-v2-selected-match-count class="match-count">{selectedMatchCount}</span>
            </ShButton>
            <ShButton
                data-prompt-v2-replace-all
                size="xs"
                variant="secondary"
                disabled={totalMatchCount === 0 || search === replacement}
                onclick={() => onReplaceAll?.(search, replacement)}
                title={language.promptV2.replaceAllHint}
            >
                <ReplaceAllIcon size={13} />
                {language.promptV2.replaceAll}
                <span data-prompt-v2-total-match-count class="match-count">{totalMatchCount}</span>
            </ShButton>
        </div>
    </header>

    <div class="min-h-0 grow overflow-y-auto p-2" role="listbox" aria-label={language.promptV2.blockList}>
        {#if visibleItems.length > 0}
            <div class="flex flex-col gap-1.5">
                {#each visibleItems as row (row.item)}
                    <button
                        type="button"
                        class="prompt-v2-list-row"
                        class:prompt-v2-list-row--selected={row.index === selectedIndex}
                        aria-selected={row.index === selectedIndex}
                        role="option"
                        onclick={() => onSelect(row.index)}
                    >
                        <div class="min-w-0 grow">
                            <div class="flex items-center gap-2">
                                <span class="truncate text-sm font-medium">{row.name}</span>
                                <span class="state-badge state-badge--{row.state.tone}">{row.state.label}</span>
                                {#if row.matchCount > 0}
                                    <span class="match-badge">{language.promptV2.matchCount(row.matchCount)}</span>
                                {/if}
                            </div>
                            <div class="mt-1 flex items-center gap-2 text-[11px] text-textcolor2">
                                <span class="uppercase tracking-wide">{row.item.type}</span>
                                {#if row.state.body}
                                    <span aria-hidden="true">·</span>
                                    <span
                                        class="prompt-preview-text truncate"
                                        class:prompt-preview-text--active={row.state.tone === 'active'}
                                        class:prompt-preview-text--inactive={row.state.tone === 'inactive'}
                                    >{row.state.body.replace(/\s+/g, ' ').trim()}</span>
                                {/if}
                            </div>
                        </div>
                        <div class="row-actions flex shrink-0 items-center gap-0.5">
                            <ShButton
                                size="icon-xs"
                                variant="ghost"
                                disabled={row.index === 0}
                                onclick={(event) => { event.stopPropagation(); onMove(row.index, -1) }}
                                title={language.promptV2.moveUp}
                                aria-label={language.promptV2.moveUp}
                            ><ArrowUpIcon /></ShButton>
                            <ShButton
                                size="icon-xs"
                                variant="ghost"
                                disabled={row.index === items.length - 1}
                                onclick={(event) => { event.stopPropagation(); onMove(row.index, 1) }}
                                title={language.promptV2.moveDown}
                                aria-label={language.promptV2.moveDown}
                            ><ArrowDownIcon /></ShButton>
                            <ShButton
                                size="icon-xs"
                                variant="ghost"
                                onclick={(event) => { event.stopPropagation(); onRemove(row.index) }}
                                title={language.promptV2.deleteBlock}
                                aria-label={language.promptV2.deleteBlock}
                            ><Trash2Icon /></ShButton>
                        </div>
                    </button>
                {/each}
            </div>
        {:else}
            <div class="flex min-h-44 items-center justify-center px-5 text-center text-sm text-textcolor2">
                {items.length === 0 ? language.promptV2.noBlocks : language.promptV2.noSearchResults}
            </div>
        {/if}
    </div>

</section>

<style>
    .prompt-v2-list-row {
        display: flex;
        width: 100%;
        min-height: 4rem;
        align-items: center;
        gap: .5rem;
        border: 1px solid transparent;
        border-radius: .65rem;
        padding: .65rem .55rem .65rem .75rem;
        text-align: left;
        transition: background-color 160ms ease, border-color 160ms ease;
    }

    .prompt-v2-list-row:hover {
        border-color: var(--color-darkborderc);
        background: color-mix(in srgb, var(--color-selected) 28%, transparent);
    }

    .prompt-v2-list-row:focus-visible {
        border-color: var(--color-borderc);
        outline: 2px solid color-mix(in srgb, var(--color-borderc) 50%, transparent);
        outline-offset: 1px;
    }

    .prompt-v2-list-row--selected {
        border-color: color-mix(in srgb, var(--color-primary) 55%, var(--color-darkborderc));
        background: color-mix(in srgb, var(--color-primary) 11%, transparent);
    }

    .row-actions { opacity: .5; }
    .prompt-v2-list-row:hover .row-actions,
    .prompt-v2-list-row:focus-within .row-actions,
    .prompt-v2-list-row--selected .row-actions { opacity: 1; }

    .state-badge {
        flex-shrink: 0;
        border: 1px solid var(--color-darkborderc);
        border-radius: 999px;
        padding: .08rem .42rem;
        font-size: .64rem;
        line-height: 1.25;
        color: var(--color-textcolor2);
        background: var(--color-darkbutton);
    }
    .state-badge--active { border-color: var(--color-success-border); color: var(--color-success); background: var(--color-success-bg); }
    .state-badge--inactive { opacity: .72; }
    .state-badge--manual { border-color: var(--color-warning-border); color: var(--color-warning); background: var(--color-warning-bg); }

    .replacement-row {
        display: grid;
        grid-template-columns: minmax(4.5rem, 1fr) auto auto;
        gap: .3rem;
    }

    .match-count,
    .match-badge {
        border-radius: 999px;
        color: var(--color-textcolor2);
        background: color-mix(in srgb, var(--color-selected) 42%, transparent);
        font-size: .62rem;
        line-height: 1.2;
    }
    .match-count { min-width: 1.05rem; padding: .08rem .28rem; text-align: center; }
    .match-badge { padding: .08rem .38rem; }

    .prompt-preview-text { transition: color 160ms ease, opacity 160ms ease; }
    .prompt-preview-text--active { color: var(--color-info); opacity: 1; }
    .prompt-preview-text--inactive { color: var(--color-textcolor2); opacity: .42; }
</style>
