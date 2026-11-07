<script lang="ts">
    import { CopyIcon, DownloadIcon, HardDriveUploadIcon, LockKeyholeIcon, PencilIcon, PlusIcon, Trash2Icon, UploadIcon } from '@lucide/svelte'
    import { v4 as uuidv4 } from 'uuid'
    import { language } from 'src/lang'
    import { alertConfirm, notifyError, notifySuccess } from 'src/ts/alert'
    import { downloadFile } from 'src/ts/globalApi.svelte'
    import {
        createWikiPromptPreset,
        deleteWikiPromptPreset,
        duplicateWikiPromptPreset,
        parseWikiPromptPreset,
        resolveWikiPromptPreset,
        serializeWikiPromptPreset,
        type WikiPromptPreset,
    } from 'src/ts/risubard/wikiPromptPreset'
    import { assignCollectionItem, normalizeCollectionOrganizerState } from 'src/ts/collectionOrganizer'
    import { DBState } from 'src/ts/stores.svelte'
    import { selectSingleFile } from 'src/ts/util'
    import PresetHeader from 'src/lib/UI/GUI/PresetHeader.svelte'
    import SettingPage from 'src/lib/UI/GUI/SettingPage.svelte'
    import SettingTabs from 'src/lib/UI/GUI/SettingTabs.svelte'
    import ShButton from 'src/lib/UI/GUI/ShButton.svelte'
    import ShDialog from 'src/lib/UI/GUI/ShDialog.svelte'
    import TextInput from 'src/lib/UI/GUI/TextInput.svelte'
    import CollectionOrganizerList from 'src/lib/UI/CollectionOrganizerList.svelte'
    import RisuBardWikiPromptReferenceSheet from './RisuBardWikiPromptReferenceSheet.svelte'
    import RisuBardWikiPromptV1Editor from './RisuBardWikiPromptV1Editor.svelte'
    import RisuBardWikiPromptV2Workspace from './RisuBardWikiPromptV2Workspace.svelte'

    let activeTab = $state(0)
    let choosingPreset = $state(false)
    let renaming = $state(false)
    let selectedPresetFolder = $state<string | null | undefined>(undefined)
    let organizerPresetItems = $derived((DBState.db.risuBardWikiPromptPresets ?? []).map(
        (preset) => ({ id: preset.id, title: preset.name }),
    ))
    let promptingHelpOpen = $state(false)
    let promptWorkspace: RisuBardWikiPromptV2Workspace | undefined = $state()
    let activePreset = $derived(resolveWikiPromptPreset(
        DBState.db.risuBardWikiPromptPresets,
        DBState.db.risuBardChatWikiPromptPresetId,
    ))

    function activatePreset(presetId: string) {
        promptWorkspace?.flushPendingText()
        DBState.db.risuBardChatWikiPromptPresetId = presetId
    }

    function selectPreset(presetId: string) {
        if (renaming) return
        activatePreset(presetId)
        choosingPreset = false
    }

    function openPresetList() {
        renaming = false
        choosingPreset = true
    }

    function touchPreset(preset: WikiPromptPreset) {
        if (!preset.builtin) preset.revision = Math.min(2_147_483_647, preset.revision + 1)
    }

    function addPreset(preset: WikiPromptPreset, folderId: string | null | undefined) {
        DBState.db.risuBardWikiPromptPresets ??= []
        DBState.db.risuBardWikiPromptPresets.push(preset)
        if (typeof folderId === 'string' && DBState.db.collectionOrganizers) {
            const current = normalizeCollectionOrganizerState(
                DBState.db.collectionOrganizers.wikiPromptPresets,
                DBState.db.risuBardWikiPromptPresets.map((candidate) => candidate.id),
            )
            DBState.db.collectionOrganizers = {
                ...DBState.db.collectionOrganizers,
                wikiPromptPresets: assignCollectionItem(current, preset.id, folderId),
            }
        }
        activatePreset(preset.id)
    }

    function createPreset(folderId?: string | null) {
        addPreset(createWikiPromptPreset(uuidv4(), language.risuBardWikiPrompt.newPresetName), folderId)
        notifySuccess(language.risuBardWikiPrompt.presetCreated)
    }

    function duplicatePreset(source: WikiPromptPreset | undefined, folderId?: string | null) {
        if (!source) return
        promptWorkspace?.flushPendingText()
        addPreset(duplicateWikiPromptPreset(source, uuidv4()), folderId)
        notifySuccess(language.presetDuplicated)
    }

    async function exportPreset(preset: WikiPromptPreset | undefined) {
        if (!preset) return
        promptWorkspace?.flushPendingText()
        const filename = `${preset.name.replace(/[^\p{L}\p{N}._-]+/gu, '-') || 'wiki-prompt'}.bardwiki-prompt.json`
        await downloadFile(filename, new TextEncoder().encode(serializeWikiPromptPreset(preset)))
        notifySuccess(language.presetExported)
    }

    async function importPreset(folderId?: string | null) {
        try {
            const file = await selectSingleFile(['json'])
            if (!file) return
            addPreset(parseWikiPromptPreset(new TextDecoder().decode(file.data), uuidv4), folderId)
            notifySuccess(language.presetImported)
        }
        catch (error) {
            notifyError(error instanceof Error ? error.message : String(error))
        }
    }

    async function deletePreset(preset: WikiPromptPreset | undefined) {
        if (!preset || preset.builtin) return
        const ok = await alertConfirm(`${language.presetDeleteConfirm}\n${preset.name}`)
        if (!ok) return
        const result = deleteWikiPromptPreset(DBState.db.risuBardWikiPromptPresets ?? [], preset.id)
        if (!result.deleted) {
            notifyError(language.errors.onlyOnePreset)
            return
        }
        DBState.db.risuBardWikiPromptPresets = result.presets
        if (DBState.db.risuBardChatWikiPromptPresetId === preset.id) {
            DBState.db.risuBardChatWikiPromptPresetId = resolveWikiPromptPreset(result.presets, undefined)!.id
        }
        notifySuccess(language.presetDeleted)
    }
</script>

<SettingPage
    title={language.risuBardWikiPrompt.title}
    description={language.risuBardWikiPrompt.description}
    fullWidth={activeTab === 2}
>
    {#snippet headerActions()}
        <PresetHeader
            compact
            label={language.risuBardWikiPrompt.activePreset}
            activeName={activePreset?.name ?? '—'}
            onManage={openPresetList}
        />
    {/snippet}

    <SettingTabs
        tabs={[
            { label: language.basicInfo, value: 0 },
            { label: language.prompt, value: 1 },
            { label: language.promptV2.tab, value: 2 },
        ]}
        bind:selected={activeTab}
        variant="prominent"
    />

    {#if activePreset && activeTab === 2}
        <RisuBardWikiPromptV2Workspace
            bind:this={promptWorkspace}
            preset={activePreset}
            readonly={activePreset.builtin}
            onTouch={() => touchPreset(activePreset)}
            onHelp={() => { promptingHelpOpen = true }}
        />
    {:else if activePreset && activeTab === 1}
        <RisuBardWikiPromptV1Editor
            preset={activePreset}
            onTouch={() => touchPreset(activePreset)}
            onHelp={() => { promptingHelpOpen = true }}
            onDuplicate={() => duplicatePreset(activePreset)}
        />
    {:else if activePreset}
        <div class="basic-panel">
            <label>
                <span>{language.name}</span>
                <TextInput bind:value={activePreset.name} fullwidth disabled={activePreset.builtin} />
            </label>
            {#if activePreset.builtin}
                <p class="builtin-note"><LockKeyholeIcon size={14} />{language.risuBardWikiPrompt.builtinReadonly}</p>
            {/if}
            <div class="file-actions">
                <ShButton variant="default" onclick={() => createPreset()}><PlusIcon size={16} />{language.risuBardWikiPrompt.createPreset}</ShButton>
                <ShButton variant="default" onclick={() => duplicatePreset(activePreset)}><CopyIcon size={16} />{language.presetDuplicate}</ShButton>
                <ShButton variant="default" onclick={() => exportPreset(activePreset)}><DownloadIcon size={16} />{language.presetExport}</ShButton>
                <ShButton variant="default" onclick={() => importPreset()}><UploadIcon size={16} />{language.presetImport}</ShButton>
                <ShButton variant="destructive" onclick={() => deletePreset(activePreset)} disabled={activePreset.builtin}><Trash2Icon size={16} />{language.presetDelete}</ShButton>
            </div>
        </div>
    {/if}

    <RisuBardWikiPromptReferenceSheet bind:open={promptingHelpOpen} />
</SettingPage>

<ShDialog bind:open={choosingPreset} size="xl" tier="base" closeOnEscape closeOnOutsideClick={false}>
    {#snippet title()}{language.risuBardWikiPrompt.title}{/snippet}
    <CollectionOrganizerList
        kind="wikiPromptPresets"
        items={organizerPresetItems}
        collectionLabel={language.risuBardWikiPrompt.title}
        bind:selectedFolderId={selectedPresetFolder}
    >
        {#snippet toolbar(selectedFolderId)}
            <div class="picker-toolbar">
                <ShButton variant="ghost" size="icon-sm" onclick={() => createPreset(selectedFolderId)} title={language.risuBardWikiPrompt.createPreset} aria-label={language.risuBardWikiPrompt.createPreset}><PlusIcon /></ShButton>
                <ShButton variant="ghost" size="icon-sm" onclick={() => importPreset(selectedFolderId)} title={language.presetImport} aria-label={language.presetImport}><HardDriveUploadIcon /></ShButton>
                <ShButton variant="ghost" size="icon-sm" className={renaming ? 'rename-on' : ''} onclick={() => { renaming = !renaming }} title={language.risuBardWikiPrompt.renamePresets} aria-label={language.risuBardWikiPrompt.renamePresets} aria-pressed={renaming}><PencilIcon /></ShButton>
            </div>
        {/snippet}

        {#snippet itemContent(presetId)}
            {@const preset = (DBState.db.risuBardWikiPromptPresets ?? []).find((candidate) => candidate.id === presetId)}
            {#if preset}
                {@const isActive = preset.id === activePreset?.id}
                <div class="preset-row" class:selected={isActive}>
                    {#if renaming && !preset.builtin}
                        <div class="preset-rename"><TextInput bind:value={preset.name} fullwidth /></div>
                    {:else}
                        <button type="button" class="preset-select" aria-pressed={isActive} onclick={() => selectPreset(preset.id)} disabled={renaming}>
                            <span>{preset.name}</span>
                            {#if isActive}<small>{language.risuBardWikiPrompt.current}</small>{/if}
                        </button>
                    {/if}
                    <div class="preset-actions">
                        <ShButton size="icon-sm" variant="ghost" onclick={() => duplicatePreset(preset, selectedPresetFolder)} title={language.presetDuplicate} aria-label={`${language.presetDuplicate}: ${preset.name}`}><CopyIcon /></ShButton>
                        <ShButton size="icon-sm" variant="ghost" onclick={() => exportPreset(preset)} title={language.presetExport} aria-label={`${language.presetExport}: ${preset.name}`}><DownloadIcon /></ShButton>
                        {#if preset.builtin}
                            <span class="preset-lock" role="img" title={language.risuBardWikiPrompt.builtinLocked} aria-label={language.risuBardWikiPrompt.builtinLocked}><LockKeyholeIcon size={16} /></span>
                        {:else}
                            <ShButton size="icon-sm" variant="ghost" className="preset-delete" onclick={() => deletePreset(preset)} title={language.presetDelete} aria-label={`${language.presetDelete}: ${preset.name}`}><Trash2Icon /></ShButton>
                        {/if}
                    </div>
                </div>
            {/if}
        {/snippet}
    </CollectionOrganizerList>
</ShDialog>

<style>
    .basic-panel { border: 1px solid var(--settings-border, var(--risu-theme-darkborderc)); border-radius: var(--settings-radius, var(--risu-radius-xl)); background: var(--settings-surface, var(--risu-theme-bgcolor)); }
    .picker-toolbar { display: flex; align-items: center; gap: .25rem; }
    .picker-toolbar :global(.rename-on) { color: var(--risu-theme-textcolor); background: color-mix(in srgb, var(--risu-theme-selected) 55%, transparent); }
    .preset-row { display: flex; align-items: center; gap: .25rem; padding-right: .5rem; }
    .preset-rename { flex: 1 1 auto; min-width: 0; padding: .45rem .5rem .45rem 1rem; }
    .preset-actions { display: flex; flex-shrink: 0; align-items: center; margin-left: auto; }
    .preset-actions :global(button) { color: var(--risu-theme-textcolor2); }
    .preset-actions :global(button:hover) { color: var(--risu-theme-textcolor); }
    .preset-lock { display: inline-flex; width: 2rem; align-items: center; justify-content: center; color: var(--risu-theme-textcolor2); opacity: .6; }
    .builtin-note { display: flex; align-items: center; gap: .4rem; margin: .6rem 0 0; color: var(--risu-theme-textcolor2); font-size: .8rem; }
    .preset-select:disabled { cursor: default; opacity: .6; }
    .preset-row.selected { border-radius: var(--risu-radius-md); color: var(--risu-theme-textcolor); background: color-mix(in srgb, var(--risu-theme-selected) 55%, transparent); }
    .preset-select { display: flex; flex: 1 1 auto; min-width: 0; align-items: center; justify-content: space-between; padding: .75rem 1rem; text-align: left; }
    .preset-select span { overflow-wrap: anywhere; }
    .preset-select small { flex-shrink: 0; margin-left: .75rem; }
    .preset-row :global(.preset-delete:hover) { color: var(--risu-theme-draculared); }
    .preset-row small { color: var(--risu-theme-textcolor2); }
    .basic-panel { margin-top: 1rem; padding: 1rem; }
    .basic-panel label { display: grid; gap: .45rem; }
    .file-actions { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: .55rem; margin-top: 1rem; }
    @media (max-width: 560px) { .file-actions { grid-template-columns: 1fr; } }
    @media (pointer: coarse) { .preset-actions :global(button), .preset-lock { min-width: 2.5rem; min-height: 2.5rem; } }
</style>
