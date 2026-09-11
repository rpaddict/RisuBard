<script lang="ts">
    import {
        ChevronDownIcon,
        ChevronUpIcon,
        CopyIcon,
        EyeIcon,
        CircleHelpIcon,
        ListIcon,
        PlusIcon,
        SearchIcon,
        Trash2Icon,
    } from '@lucide/svelte'
    import { v4 as uuidv4 } from 'uuid'
    import { language } from 'src/lang'
    import type { PromptItem } from 'src/ts/process/prompt'
    import {
        createPromptV2PreviewValues,
        getPromptV2TextSource,
        parsePromptV2ToggleTree,
    } from 'src/ts/promptV2'
    import type {
        WikiPromptBlock,
        WikiPromptPreset,
        WikiPromptStage,
    } from 'src/ts/risubard/wikiPromptPreset'
    import { DBState } from 'src/ts/stores.svelte'
    import ShButton from 'src/lib/UI/GUI/ShButton.svelte'
    import PromptV2BlockEditor from './PromptPreset/PromptV2BlockEditor.svelte'
    import PromptV2TogglePreview from './PromptPreset/PromptV2TogglePreview.svelte'

    let {
        preset,
        readonly = false,
        onTouch = () => {},
        onHelp = () => {},
    }: {
        preset: WikiPromptPreset
        readonly?: boolean
        onTouch?: () => void
        onHelp?: () => void
    } = $props()

    let selectedId = $state('')
    let compactPane = $state<'list' | 'editor' | 'preview'>('editor')
    let search = $state('')
    let replacement = $state('')
    let blockEditor: PromptV2BlockEditor | undefined = $state()
    let previewValues = $state<Record<string, string>>({})
    let hydratedPresetId = $state('')

    const toggleTree = $derived(parsePromptV2ToggleTree(DBState.db.customPromptTemplateToggle ?? ''))
    const selectedIndex = $derived(preset.blocks.findIndex((block) => block.id === selectedId))
    const selectedBlock = $derived(selectedIndex < 0 ? undefined : preset.blocks[selectedIndex])
    const selectedItem = $derived(selectedBlock ? blockToPromptItem(selectedBlock) : undefined)

    export function flushPendingText() {
        blockEditor?.flushPendingText()
    }

    $effect(() => {
        if (!preset.blocks.some((block) => block.id === selectedId)) {
            selectedId = preset.blocks[0]?.id ?? ''
        }
    })

    $effect(() => {
        if (hydratedPresetId === preset.id) return
        previewValues = createPromptV2PreviewValues(
            toggleTree.definitions,
            DBState.db.globalChatVariables ?? {},
        )
        hydratedPresetId = preset.id
    })

    function blockToPromptItem(block: WikiPromptBlock): PromptItem {
        return {
            type: 'plain',
            type2: 'normal',
            role: 'system',
            name: displayName(block),
            text: block.content ?? '',
        }
    }

    function displayName(block: WikiPromptBlock): string {
        return language.risuBardWikiPrompt.blockNames[block.id as keyof typeof language.risuBardWikiPrompt.blockNames]
            ?? block.name
    }

    function canEdit(block = selectedBlock): boolean {
        return Boolean(block && !readonly && !block.readonly && block.type !== 'injection')
    }

    function replaceBlock(blockId: string, item: PromptItem) {
        const block = preset.blocks.find((entry) => entry.id === blockId)
        if (!canEdit(block) || !block) return
        const source = getPromptV2TextSource(item)
        if (!source) return
        block.name = item.name ?? block.name
        block.content = source.source
        onTouch()
    }

    function addBlock(target: WikiPromptStage) {
        if (readonly) return
        const block: WikiPromptBlock = {
            id: uuidv4(),
            type: 'text',
            name: language.risuBardWikiPrompt.newBlock,
            target,
            enabled: true,
            readonly: false,
            analysisMode: 'all',
            content: '',
        }
        const injectionAt = preset.blocks.findIndex((item) => item.type === 'injection')
        const insertAt = injectionAt < 0 ? preset.blocks.length : injectionAt
        preset.blocks.splice(insertAt, 0, block)
        selectedId = block.id
        compactPane = 'editor'
        onTouch()
    }

    function duplicateSelected() {
        if (!canEdit() || !selectedBlock || selectedIndex < 0) return
        const duplicate: WikiPromptBlock = {
            ...selectedBlock,
            id: uuidv4(),
            type: 'text',
            name: `${selectedBlock.name} Copy`.slice(0, 80),
            readonly: false,
        }
        preset.blocks.splice(selectedIndex + 1, 0, duplicate)
        selectedId = duplicate.id
        onTouch()
    }

    function removeSelected() {
        if (!canEdit() || selectedBlock?.type !== 'text' || selectedIndex < 0) return
        preset.blocks.splice(selectedIndex, 1)
        selectedId = preset.blocks[Math.min(selectedIndex, preset.blocks.length - 1)]?.id ?? ''
        onTouch()
    }

    function moveSelected(direction: -1 | 1) {
        if (!canEdit() || selectedIndex < 0) return
        const destination = selectedIndex + direction
        if (destination < 0 || destination >= preset.blocks.length) return
        const target = preset.blocks[destination]
        if (target.type === 'injection') return
        ;[preset.blocks[selectedIndex], preset.blocks[destination]] = [target, selectedBlock!]
        onTouch()
    }

    function updateSelected(patch: Partial<WikiPromptBlock>) {
        if (!canEdit() || !selectedBlock) return
        Object.assign(selectedBlock, patch)
        onTouch()
    }

    function replaceCurrent(all = false) {
        if (!canEdit() || !search.trim()) return
        if (!all && blockEditor?.replaceCurrentBodyMatch(search, replacement)) return
        const targets = all ? preset.blocks : selectedBlock ? [selectedBlock] : []
        let changed = false
        for (const block of targets) {
            if (!canEdit(block) || !block.content?.includes(search)) continue
            block.content = all
                ? block.content.split(search).join(replacement)
                : block.content.replace(search, replacement)
            changed = true
            if (!all) break
        }
        if (changed) onTouch()
    }
</script>

<div data-risubard-wiki-prompt-v2-workspace class="wiki-v2-workspace">
    <div class="compact-tabs">
        <button class:active={compactPane === 'list'} onclick={() => compactPane = 'list'}><ListIcon size={14} />{language.promptV2.blockList}</button>
        <button class:active={compactPane === 'editor'} onclick={() => compactPane = 'editor'}>{language.promptV2.editor}</button>
        <button class:active={compactPane === 'preview'} onclick={() => compactPane = 'preview'}><EyeIcon size={14} />{language.promptV2.sidebarPreview}</button>
    </div>

    <div class="workspace-grid" data-compact-pane={compactPane}>
        <section class="pane pane-list">
            <header class="list-header">
                <div class="search-row"><SearchIcon size={14} /><input bind:value={search} placeholder={language.search} /></div>
                <div class="search-row"><input bind:value={replacement} placeholder={language.promptV2.replaceWith} /></div>
                <div class="list-actions">
                    <ShButton size="sm" variant="outline" onclick={() => replaceCurrent(false)} disabled={!canEdit()}>{language.promptV2.replaceOne}</ShButton>
                    <ShButton size="sm" variant="outline" onclick={() => replaceCurrent(true)} disabled={readonly}>{language.promptV2.replaceAll}</ShButton>
                    <ShButton size="icon-sm" variant="ghost" onclick={onHelp} title={language.risuBardWikiPrompt.promptingHelp}><CircleHelpIcon size={15} /></ShButton>
                </div>
            </header>
            <div class="block-list">
                {#each preset.blocks as block (block.id)}
                    <button
                        type="button"
                        class:selected={block.id === selectedId}
                        class:critical={block.type === 'core-ref'}
                        onclick={() => { blockEditor?.flushPendingText(); selectedId = block.id; compactPane = 'editor' }}
                    >
                        <span>{displayName(block)}</span>
                        <small>{block.target}</small>
                    </button>
                {/each}
            </div>
            <div class="add-actions">
                <ShButton size="sm" variant="outline" onclick={() => addBlock('both')} disabled={readonly}><PlusIcon size={14} />{language.risuBardWikiPrompt.addBlock}</ShButton>
                <ShButton size="sm" variant="outline" onclick={() => addBlock('response')} disabled={readonly}><PlusIcon size={14} />{language.risuBardWikiPrompt.addResponseBlock}</ShButton>
            </div>
        </section>

        <section class="pane pane-editor">
            {#if selectedBlock}
                <div class="block-toolbar">
                    <label><span>{language.target}</span><select value={selectedBlock.target} disabled={!canEdit()} onchange={(event) => updateSelected({ target: event.currentTarget.value as WikiPromptStage })}><option value="analysis">analysis</option><option value="canonical-rewrite">canonical-rewrite</option><option value="both">both</option><option value="response">response</option></select></label>
                    {#if selectedBlock.target === 'analysis'}
                        <label><span>Mode</span><select value={selectedBlock.analysisMode ?? 'all'} disabled={!canEdit()} onchange={(event) => updateSelected({ analysisMode: event.currentTarget.value as WikiPromptBlock['analysisMode'] })}><option value="all">all</option><option value="normal">normal</option><option value="historical">historical</option></select></label>
                    {/if}
                    <label class="enabled"><input type="checkbox" checked={selectedBlock.enabled} disabled={!canEdit()} onchange={(event) => updateSelected({ enabled: event.currentTarget.checked })} />{language.promptV2.active}</label>
                    <div class="toolbar-buttons">
                        <ShButton size="icon-sm" variant="ghost" onclick={() => moveSelected(-1)} disabled={!canEdit()} title={language.promptV2.moveUp}><ChevronUpIcon size={15} /></ShButton>
                        <ShButton size="icon-sm" variant="ghost" onclick={() => moveSelected(1)} disabled={!canEdit()} title={language.promptV2.moveDown}><ChevronDownIcon size={15} /></ShButton>
                        <ShButton size="icon-sm" variant="ghost" onclick={duplicateSelected} disabled={!canEdit()} title={language.presetDuplicate}><CopyIcon size={15} /></ShButton>
                        <ShButton size="icon-sm" variant="ghost" onclick={removeSelected} disabled={!canEdit() || selectedBlock.type !== 'text'} title={language.remove}><Trash2Icon size={15} /></ShButton>
                    </div>
                </div>
                <div class="editor-host">
                    {#key `${preset.id}:${selectedBlock.id}`}
                        <PromptV2BlockEditor
                            bind:this={blockEditor}
                            item={selectedItem}
                            definitions={toggleTree.definitions}
                            {previewValues}
                            readOnly={!canEdit()}
                            simple
                            critical={selectedBlock?.type === 'core-ref'}
                            onReplace={(item) => replaceBlock(selectedBlock.id, item)}
                            onOpenToggleSetup={() => {}}
                        />
                    {/key}
                </div>
            {/if}
        </section>

        <section class="pane pane-preview">
            <PromptV2TogglePreview
                template={DBState.db.customPromptTemplateToggle ?? ''}
                bind:previewValues
                onReset={() => previewValues = createPromptV2PreviewValues(toggleTree.definitions, DBState.db.globalChatVariables ?? {})}
            />
        </section>
    </div>
</div>

<style>
    .wiki-v2-workspace { display: flex; min-height: 32rem; height: 100%; flex-direction: column; overflow: hidden; border: 1px solid var(--color-darkborderc); border-radius: .9rem; background: var(--color-darkbg); }
    .workspace-grid { display: grid; min-height: 0; flex: 1; grid-template-columns: minmax(13rem,.75fr) minmax(28rem,1.65fr) minmax(17rem,.8fr); }
    .pane { min-width: 0; min-height: 0; overflow: hidden; }
    .pane + .pane { border-left: 1px solid var(--color-darkborderc); }
    .pane-list { display: flex; flex-direction: column; }
    .list-header, .add-actions, .block-toolbar { flex-shrink: 0; border-bottom: 1px solid var(--color-darkborderc); padding: .65rem; }
    .search-row { display: flex; align-items: center; gap: .4rem; margin-bottom: .4rem; }
    .search-row input, select { min-width: 0; height: 2rem; border: 1px solid var(--color-darkborderc); border-radius: .4rem; padding: .25rem .45rem; background: transparent; color: var(--color-textcolor); }
    .search-row input { width: 100%; }
    .list-actions, .add-actions, .toolbar-buttons { display: flex; gap: .35rem; }
    .add-actions { border-top: 1px solid var(--color-darkborderc); border-bottom: 0; flex-wrap: wrap; }
    .block-list { min-height: 0; flex: 1; overflow-y: auto; padding: .35rem; }
    .block-list button { display: flex; width: 100%; align-items: center; justify-content: space-between; gap: .5rem; border-radius: .45rem; padding: .55rem .6rem; text-align: left; }
    .block-list button:hover, .block-list button.selected { background: color-mix(in srgb, var(--color-selected) 34%, transparent); }
    .block-list button.critical span { color: var(--color-danger); font-weight: 700; }
    .block-list small { color: var(--color-textcolor2); font-size: .65rem; }
    .pane-editor { display: flex; flex-direction: column; }
    .block-toolbar { display: flex; min-height: 3.5rem; align-items: center; gap: .55rem; }
    .block-toolbar label { display: flex; align-items: center; gap: .3rem; font-size: .7rem; color: var(--color-textcolor2); }
    .block-toolbar .enabled { color: var(--color-textcolor); }
    .toolbar-buttons { margin-left: auto; }
    .editor-host { min-height: 0; flex: 1; }
    .compact-tabs { display: none; grid-template-columns: repeat(3,minmax(0,1fr)); gap: .25rem; border-bottom: 1px solid var(--color-darkborderc); padding: .35rem; }
    .compact-tabs button { display: flex; align-items: center; justify-content: center; gap: .3rem; min-height: 2.2rem; border-radius: .4rem; font-size: .72rem; }
    .compact-tabs button.active { color: var(--color-binding-text); background: var(--color-binding); }
    @container settings-page (max-width: 68rem) {
        .compact-tabs { display: grid; }
        .workspace-grid { display: block; }
        .pane { display: none; height: 100%; }
        .workspace-grid[data-compact-pane='list'] .pane-list,
        .workspace-grid[data-compact-pane='editor'] .pane-editor,
        .workspace-grid[data-compact-pane='preview'] .pane-preview { display: flex; }
        .pane + .pane { border-left: 0; }
    }
</style>
