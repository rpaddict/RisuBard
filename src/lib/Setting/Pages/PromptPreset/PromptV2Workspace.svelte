<script lang="ts">
    import {
        BracesIcon,
        EyeIcon,
        ListIcon,
        PanelLeftCloseIcon,
        PanelLeftOpenIcon,
        PanelRightCloseIcon,
        PanelRightOpenIcon,
        SlidersHorizontalIcon,
    } from '@lucide/svelte'
    import { language } from 'src/lang'
    import { tick } from 'svelte'
    import { DBState } from 'src/ts/stores.svelte'
    import type { PromptItem } from 'src/ts/process/prompt'
    import {
        clearPromptV2PreviewState,
        createPromptV2PreviewValues,
        findPromptV2ToggleUsages,
        getPromptV2TextSource,
        loadPromptV2PreviewState,
        loadPromptV2WorkspaceSession,
        parsePromptV2Text,
        parsePromptV2ToggleTree,
        promptV2PreviewDefaultValue,
        replacePromptV2BodyMatches,
        savePromptV2PreviewState,
        savePromptV2WorkspaceSession,
        type PromptV2ToggleUsage,
    } from 'src/ts/promptV2'
    import ShButton from 'src/lib/UI/GUI/ShButton.svelte'
    import PromptV2BlockList from './PromptV2BlockList.svelte'
    import PromptV2BlockEditor from './PromptV2BlockEditor.svelte'
    import PromptV2TogglePreview from './PromptV2TogglePreview.svelte'
    import PromptV2ToggleEditor from './PromptV2ToggleEditor.svelte'

    let mode = $state<'prompts' | 'toggles'>('prompts')
    let selectedIndex = $state(0)
    let showList = $state(true)
    let showPreview = $state(true)
    let compactPane = $state<'list' | 'editor' | 'preview'>('editor')
    let previewValues = $state<Record<string, string>>({})
    let hydratedPreviewScope = $state('')
    let hydratedWorkspaceScope = $state('')
    let blockScrollTops = $state<Record<number, number>>({})
    let toggleScrollTop = $state(0)
    let blockEditor: PromptV2BlockEditor | undefined = $state()

    async function findInSelectedBlock(query: string) {
        compactPane = 'editor'
        await tick()
        blockEditor?.findInBody(query)
    }

    const promptItems = $derived(DBState.db.promptTemplate ?? [])
    const toggleTree = $derived(parsePromptV2ToggleTree(DBState.db.customPromptTemplateToggle ?? ''))
    const selectedItem = $derived(promptItems[selectedIndex])
    const previewPresetId = $derived(String(
        DBState.db.botPresets?.[DBState.db.botPresetsId]?.id
        ?? `active-${DBState.db.botPresetsId ?? 0}`,
    ))
    const referencedKeys = $derived.by(() => {
        if (!selectedItem) return new Set<string>()
        const source = getPromptV2TextSource(selectedItem)
        if (!source) return new Set<string>()
        const activation = parsePromptV2Text(source.source).activation
        return new Set(activation?.conditions.map((condition) => condition.key) ?? [])
    })
    const toggleUsages = $derived.by(() => Object.fromEntries(
        toggleTree.definitions.map((definition) => [
            definition.key,
            findPromptV2ToggleUsages(promptItems, definition.key),
        ]),
    ))

    $effect(() => {
        if (promptItems.length === 0) {
            selectedIndex = -1
        } else if (selectedIndex < 0 || selectedIndex >= promptItems.length) {
            selectedIndex = Math.max(0, promptItems.length - 1)
        }
    })

    $effect(() => {
        if (hydratedWorkspaceScope === previewPresetId) return
        const session = loadPromptV2WorkspaceSession(previewPresetId)
        mode = session.mode
        selectedIndex = session.selectedIndex
        blockScrollTops = session.blockScrollTops
        toggleScrollTop = session.toggleScrollTop
        hydratedWorkspaceScope = previewPresetId
    })

    $effect(() => {
        if (!hydratedWorkspaceScope || hydratedWorkspaceScope !== previewPresetId) return
        savePromptV2WorkspaceSession(previewPresetId, {
            mode,
            selectedIndex,
            blockScrollTops,
            toggleScrollTop,
        })
    })

    function previewStorage(): Storage | undefined {
        try {
            return typeof window === 'undefined' ? undefined : window.localStorage
        } catch {
            return undefined
        }
    }

    $effect(() => {
        if (hydratedPreviewScope !== previewPresetId) {
            previewValues = loadPromptV2PreviewState(
                previewPresetId,
                toggleTree.definitions,
                DBState.db.globalChatVariables ?? {},
                previewStorage(),
            )
            hydratedPreviewScope = previewPresetId
            return
        }
        for (const definition of toggleTree.definitions) {
            if (previewValues[definition.key] === undefined) {
                previewValues[definition.key] = DBState.db.globalChatVariables?.[definition.key]
                    ?? promptV2PreviewDefaultValue(definition)
            }
        }
    })

    $effect(() => {
        if (!hydratedPreviewScope || hydratedPreviewScope !== previewPresetId) return
        const values = Object.fromEntries(toggleTree.definitions.map((definition) => [
            definition.key,
            previewValues[definition.key] ?? promptV2PreviewDefaultValue(definition),
        ]))
        savePromptV2PreviewState(
            previewPresetId,
            toggleTree.definitions,
            values,
            previewStorage(),
        )
    })

    function resetPreview() {
        clearPromptV2PreviewState(previewPresetId, previewStorage())
        previewValues = createPromptV2PreviewValues(
            toggleTree.definitions,
            DBState.db.globalChatVariables ?? {},
        )
    }

    function replaceTemplate(items: PromptItem[]) {
        DBState.db.promptTemplate = items
    }

    function addBlock() {
        blockEditor?.flushPendingText()
        const next: PromptItem[] = [...promptItems]
        const insertAt = selectedIndex < 0 ? next.length : selectedIndex + 1
        next.splice(insertAt, 0, {
            type: 'plain',
            type2: 'normal',
            role: 'system',
            text: '',
            name: language.formating.plain,
        })
        replaceTemplate(next)
        selectedIndex = insertAt
        compactPane = 'editor'
    }

    function duplicateBlock() {
        blockEditor?.flushPendingText()
        if (selectedIndex < 0 || selectedIndex >= promptItems.length) return
        const insertAt = selectedIndex + 1
        const next = [...promptItems]
        next.splice(insertAt, 0, { ...promptItems[selectedIndex] } as PromptItem)
        replaceTemplate(next)
        selectedIndex = insertAt
        compactPane = 'editor'
    }

    function removeBlock(index: number) {
        blockEditor?.flushPendingText()
        const next = [...promptItems]
        next.splice(index, 1)
        replaceTemplate(next)
        selectedIndex = Math.min(index, next.length - 1)
    }

    function moveBlock(index: number, direction: -1 | 1) {
        blockEditor?.flushPendingText()
        const target = index + direction
        if (target < 0 || target >= promptItems.length) return
        const next = [...promptItems]
        const [moving] = next.splice(index, 1)
        next.splice(target, 0, moving)
        replaceTemplate(next)
        selectedIndex = target
    }

    function replaceSelected(item: PromptItem) {
        if (selectedIndex < 0) return
        const next = [...promptItems]
        next[selectedIndex] = item
        replaceTemplate(next)
    }

    function selectBlock(index: number) {
        blockEditor?.flushPendingText()
        selectedIndex = index
        compactPane = 'editor'
    }

    function openToggleSetup() {
        blockEditor?.flushPendingText()
        mode = 'toggles'
        compactPane = 'editor'
    }

    function setWorkspaceMode(nextMode: 'prompts' | 'toggles') {
        if (nextMode === mode) return
        blockEditor?.flushPendingText()
        mode = nextMode
    }

    async function openToggleUsage(usage: PromptV2ToggleUsage) {
        mode = 'prompts'
        selectedIndex = usage.blockIndex
        compactPane = 'editor'
        await tick()
        blockEditor?.revealBodyRange(usage.start, usage.end)
    }

    function rememberBlockScroll(position: number) {
        if (selectedIndex < 0) return
        blockScrollTops = { ...blockScrollTops, [selectedIndex]: position }
    }

    function replaceOneMatch(search: string, replacement: string) {
        if (blockEditor?.replaceCurrentBodyMatch(search, replacement)) return
        const result = replacePromptV2BodyMatches(
            DBState.db.promptTemplate ?? [],
            search,
            replacement,
            selectedIndex,
        )
        if (result.replaced > 0) replaceTemplate(result.items)
    }

    function replaceAllMatches(search: string, replacement: string) {
        blockEditor?.flushPendingText()
        const result = replacePromptV2BodyMatches(
            DBState.db.promptTemplate ?? [],
            search,
            replacement,
        )
        if (result.replaced > 0) replaceTemplate(result.items)
    }
</script>

<div data-prompt-v2-workspace class="prompt-v2-workspace">
    <div class="workspace-toolbar">
        <div class="toolbar-segment" aria-label={language.promptV2.workspaceHelp}>
            <button
                type="button"
                class:toolbar-segment__active={mode === 'prompts'}
                aria-pressed={mode === 'prompts'}
                onclick={() => setWorkspaceMode('prompts')}
            >
                <BracesIcon size={15} />
                {language.promptV2.promptsMode}
            </button>
            <button
                type="button"
                class:toolbar-segment__active={mode === 'toggles'}
                aria-pressed={mode === 'toggles'}
                onclick={() => setWorkspaceMode('toggles')}
            >
                <SlidersHorizontalIcon size={15} />
                {language.promptV2.togglesMode}
            </button>
        </div>

        <div class="ml-auto hidden items-center gap-1 lg:flex">
            <ShButton
                size="sm"
                variant={showList ? 'soft-primary' : 'ghost'}
                onclick={() => showList = !showList}
                aria-pressed={showList}
                title={language.promptV2.listPane}
            >
                {#if showList}<PanelLeftCloseIcon size={15} />{:else}<PanelLeftOpenIcon size={15} />{/if}
                <span class="hidden 2xl:inline">{language.promptV2.listPane}</span>
            </ShButton>
            <ShButton
                size="sm"
                variant={showPreview ? 'soft-primary' : 'ghost'}
                onclick={() => showPreview = !showPreview}
                aria-pressed={showPreview}
                title={language.promptV2.previewPane}
            >
                {#if showPreview}<PanelRightCloseIcon size={15} />{:else}<PanelRightOpenIcon size={15} />{/if}
                <span class="hidden 2xl:inline">{language.promptV2.previewPane}</span>
            </ShButton>
        </div>
    </div>

    <div class="compact-pane-tabs" aria-label={language.promptV2.workspaceHelp}>
        <button class:compact-pane-tab--active={compactPane === 'list'} onclick={() => compactPane = 'list'}>
            <ListIcon size={14} />{mode === 'prompts' ? language.promptV2.blockList : language.promptV2.variableLibrary}
        </button>
        <button class:compact-pane-tab--active={compactPane === 'editor'} onclick={() => compactPane = 'editor'}>
            <BracesIcon size={14} />{mode === 'prompts' ? language.promptV2.editor : language.promptV2.toggleSource}
        </button>
        <button class:compact-pane-tab--active={compactPane === 'preview'} onclick={() => compactPane = 'preview'}>
            <EyeIcon size={14} />{language.promptV2.sidebarPreview}
        </button>
    </div>

    <div
        class="workspace-grid"
        class:workspace-grid--no-list={!showList}
        class:workspace-grid--no-preview={!showPreview}
        data-compact-pane={compactPane}
    >
        {#if showList}
            <div data-prompt-v2-block-list class="workspace-pane workspace-pane--list">
                {#if mode === 'prompts'}
                    <PromptV2BlockList
                        items={promptItems}
                        {selectedIndex}
                        {previewValues}
                        onSelect={selectBlock}
                        onAdd={addBlock}
                        onDuplicate={duplicateBlock}
                        onRemove={removeBlock}
                        onMove={moveBlock}
                        onFind={findInSelectedBlock}
                        onReplaceOne={replaceOneMatch}
                        onReplaceAll={replaceAllMatches}
                    />
                {:else}
                    <PromptV2ToggleEditor
                        view="library"
                        bind:template={DBState.db.customPromptTemplateToggle}
                        usages={toggleUsages}
                        onOpenUsage={openToggleUsage}
                    />
                {/if}
            </div>
        {/if}

        <div data-prompt-v2-editor class="workspace-pane workspace-pane--editor">
            {#if mode === 'prompts'}
                <PromptV2BlockEditor
                    bind:this={blockEditor}
                    item={selectedItem}
                    definitions={toggleTree.definitions}
                    {previewValues}
                    scrollTop={blockScrollTops[selectedIndex] ?? 0}
                    onScrollTopChange={rememberBlockScroll}
                    onReplace={replaceSelected}
                    onOpenToggleSetup={openToggleSetup}
                />
            {:else}
                <PromptV2ToggleEditor
                    view="source"
                    bind:template={DBState.db.customPromptTemplateToggle}
                    scrollTop={toggleScrollTop}
                    onScrollTopChange={(position) => toggleScrollTop = position}
                />
            {/if}
        </div>

        {#if showPreview}
            <div data-prompt-v2-toggle-preview class="workspace-pane workspace-pane--preview">
                <PromptV2TogglePreview
                    template={DBState.db.customPromptTemplateToggle ?? ''}
                    bind:previewValues
                    {referencedKeys}
                    onReset={resetPreview}
                />
            </div>
        {/if}
    </div>
</div>

<style>
    .prompt-v2-workspace {
        container: prompt-v2 / inline-size;
        display: flex;
        width: 100%;
        height: 100%;
        min-height: 0;
        max-height: 100%;
        flex: 1;
        flex-direction: column;
        overflow: hidden;
        border: 1px solid var(--color-darkborderc);
        border-radius: .9rem;
        background: color-mix(in srgb, var(--color-darkbg) 92%, var(--color-bgcolor));
        box-shadow: 0 14px 36px color-mix(in srgb, var(--color-bgcolor) 35%, transparent);
    }

    .workspace-toolbar {
        display: flex;
        min-height: 3.5rem;
        align-items: center;
        gap: .5rem;
        border-bottom: 1px solid var(--color-darkborderc);
        padding: .55rem .65rem;
        background: color-mix(in srgb, var(--color-darkbutton) 30%, transparent);
    }

    .toolbar-segment {
        display: inline-flex;
        align-items: center;
        gap: .2rem;
        border: 1px solid var(--color-darkborderc);
        border-radius: .55rem;
        padding: .2rem;
        background: color-mix(in srgb, var(--color-darkbg) 72%, transparent);
    }

    .toolbar-segment button,
    .compact-pane-tabs button {
        display: inline-flex;
        min-height: 2.25rem;
        align-items: center;
        justify-content: center;
        gap: .4rem;
        border-radius: .4rem;
        padding: .35rem .65rem;
        color: var(--color-textcolor2);
        font-size: .78rem;
        font-weight: 600;
        transition: color 150ms ease, background-color 150ms ease;
    }

    .toolbar-segment button:hover,
    .compact-pane-tabs button:hover { color: var(--color-textcolor); background: color-mix(in srgb, var(--color-selected) 30%, transparent); }
    .toolbar-segment button:focus-visible,
    .compact-pane-tabs button:focus-visible { outline: 2px solid color-mix(in srgb, var(--color-borderc) 55%, transparent); outline-offset: 1px; }

    .toolbar-segment .toolbar-segment__active,
    .compact-pane-tabs .compact-pane-tab--active {
        color: var(--color-binding-text);
        background: var(--color-binding);
    }

    .workspace-grid {
        display: grid;
        min-height: 0;
        flex: 1;
        grid-template-columns: minmax(14rem, .78fr) minmax(28rem, 1.65fr) minmax(18rem, .86fr);
        overflow: hidden;
    }
    .workspace-grid--no-list { grid-template-columns: minmax(30rem, 1.65fr) minmax(18rem, .86fr); }
    .workspace-grid--no-preview { grid-template-columns: minmax(14rem, .78fr) minmax(30rem, 1.65fr); }
    .workspace-grid--no-list.workspace-grid--no-preview { grid-template-columns: minmax(0, 1fr); }

    .workspace-pane { min-width: 0; min-height: 0; overflow: hidden; }
    .workspace-pane + .workspace-pane { border-left: 1px solid var(--color-darkborderc); }
    .workspace-pane--list { background: color-mix(in srgb, var(--color-darkbg) 72%, transparent); }
    .workspace-pane--preview { background: color-mix(in srgb, var(--color-bgcolor) 24%, transparent); }

    :global(.prompt-v2-pane-header) {
        height: 6.75rem;
        min-height: 6.75rem;
        flex-shrink: 0;
        overflow: hidden;
    }
    :global(.prompt-v2-pane-header.prompt-v2-editor-header) {
        height: auto;
        min-height: 3.5rem;
    }
    :global(.prompt-v2-pane-header.prompt-v2-block-list-header) {
        height: auto;
        min-height: 9.5rem;
    }

    .compact-pane-tabs {
        display: none;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: .25rem;
        border-bottom: 1px solid var(--color-darkborderc);
        padding: .35rem;
    }

    @container prompt-v2 (max-width: 68.75rem) {
        .compact-pane-tabs { display: grid; }
        .workspace-grid,
        .workspace-grid--no-list,
        .workspace-grid--no-preview,
        .workspace-grid--no-list.workspace-grid--no-preview { display: block; }
        .workspace-pane { display: none; height: 100%; }
        .workspace-grid[data-compact-pane='list'] .workspace-pane--list,
        .workspace-grid[data-compact-pane='editor'] .workspace-pane--editor,
        .workspace-grid[data-compact-pane='preview'] .workspace-pane--preview { display: block; }
        .workspace-pane + .workspace-pane { border-left: 0; }
    }

    @media (max-width: 620px) {
        .workspace-toolbar { align-items: stretch; flex-direction: column; }
        .toolbar-segment { display: grid; width: 100%; grid-template-columns: repeat(2, minmax(0, 1fr)); }
        .compact-pane-tabs button { padding-inline: .35rem; font-size: .7rem; }
    }
</style>
