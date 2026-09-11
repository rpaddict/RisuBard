<script lang="ts">
    import { CopyIcon, DownloadIcon, PlusIcon, Trash2Icon, UploadIcon } from '@lucide/svelte'
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
    import { DBState } from 'src/ts/stores.svelte'
    import { selectSingleFile } from 'src/ts/util'
    import PresetHeader from 'src/lib/UI/GUI/PresetHeader.svelte'
    import SettingPage from 'src/lib/UI/GUI/SettingPage.svelte'
    import SettingTabs from 'src/lib/UI/GUI/SettingTabs.svelte'
    import ShButton from 'src/lib/UI/GUI/ShButton.svelte'
    import TextInput from 'src/lib/UI/GUI/TextInput.svelte'
    import RisuBardWikiPromptReferenceSheet from './RisuBardWikiPromptReferenceSheet.svelte'
    import RisuBardWikiPromptV2Workspace from './RisuBardWikiPromptV2Workspace.svelte'

    let activeTab = $state(0)
    let choosingPreset = $state(false)
    let promptingHelpOpen = $state(false)
    let promptWorkspace: RisuBardWikiPromptV2Workspace | undefined = $state()
    let activePreset = $derived(resolveWikiPromptPreset(
        DBState.db.risuBardWikiPromptPresets,
        DBState.db.risuBardChatWikiPromptPresetId,
    ))

    function selectPreset(presetId: string) {
        promptWorkspace?.flushPendingText()
        DBState.db.risuBardChatWikiPromptPresetId = presetId
        choosingPreset = false
    }

    function touchPreset(preset: WikiPromptPreset) {
        if (!preset.builtin) preset.revision = Math.min(2_147_483_647, preset.revision + 1)
    }

    function createPreset() {
        const preset = createWikiPromptPreset(uuidv4(), language.risuBardWikiPrompt.newPresetName)
        DBState.db.risuBardWikiPromptPresets ??= []
        DBState.db.risuBardWikiPromptPresets.push(preset)
        selectPreset(preset.id)
        notifySuccess(language.risuBardWikiPrompt.presetCreated)
    }

    function duplicateActivePreset() {
        if (!activePreset) return
        const duplicate = duplicateWikiPromptPreset(activePreset, uuidv4())
        DBState.db.risuBardWikiPromptPresets ??= []
        DBState.db.risuBardWikiPromptPresets.push(duplicate)
        selectPreset(duplicate.id)
        notifySuccess(language.presetDuplicated)
    }

    async function exportActivePreset() {
        if (!activePreset) return
        const filename = `${activePreset.name.replace(/[^\p{L}\p{N}._-]+/gu, '-') || 'wiki-prompt'}.bardwiki-prompt.json`
        await downloadFile(filename, new TextEncoder().encode(serializeWikiPromptPreset(activePreset)))
        notifySuccess(language.presetExported)
    }

    async function importPreset() {
        try {
            const file = await selectSingleFile(['json'])
            if (!file) return
            const preset = parseWikiPromptPreset(new TextDecoder().decode(file.data), uuidv4)
            DBState.db.risuBardWikiPromptPresets ??= []
            DBState.db.risuBardWikiPromptPresets.push(preset)
            selectPreset(preset.id)
            notifySuccess(language.presetImported)
        }
        catch (error) {
            notifyError(error instanceof Error ? error.message : String(error))
        }
    }

    async function deleteActivePreset() {
        if (!activePreset || activePreset.builtin) return
        const ok = await alertConfirm(`${language.presetDeleteConfirm}\n${activePreset.name}`)
        if (!ok) return
        const result = deleteWikiPromptPreset(DBState.db.risuBardWikiPromptPresets ?? [], activePreset.id)
        if (!result.deleted) {
            notifyError(language.errors.onlyOnePreset)
            return
        }
        DBState.db.risuBardWikiPromptPresets = result.presets
        if (DBState.db.risuBardChatWikiPromptPresetId === activePreset.id) {
            DBState.db.risuBardChatWikiPromptPresetId = result.presets[0].id
        }
        notifySuccess(language.presetDeleted)
    }
</script>

<SettingPage
    title={language.risuBardWikiPrompt.title}
    description={language.risuBardWikiPrompt.description}
    fullWidth={activeTab === 0}
>
    <PresetHeader
        label={language.risuBardWikiPrompt.activePreset}
        activeName={activePreset?.name ?? '—'}
        onManage={() => { choosingPreset = !choosingPreset }}
    />

    {#if choosingPreset}
        <div class="preset-picker">
            {#each DBState.db.risuBardWikiPromptPresets ?? [] as preset (preset.id)}
                <button class:selected={preset.id === activePreset?.id} onclick={() => selectPreset(preset.id)}>
                    <span>{preset.name}</span>
                    {#if preset.id === activePreset?.id}<small>{language.risuBardWikiPrompt.current}</small>{/if}
                </button>
            {/each}
        </div>
    {/if}

    <SettingTabs
        tabs={[{ label: language.prompt, value: 0 }, { label: language.basicInfo, value: 1 }]}
        bind:selected={activeTab}
        variant="prominent"
    />

    {#if activePreset && activeTab === 0}
        <RisuBardWikiPromptV2Workspace
            bind:this={promptWorkspace}
            preset={activePreset}
            readonly={activePreset.builtin}
            onTouch={() => touchPreset(activePreset)}
            onHelp={() => { promptingHelpOpen = true }}
        />
    {:else if activePreset}
        <div class="basic-panel">
            <label>
                <span>{language.name}</span>
                <TextInput bind:value={activePreset.name} fullwidth disabled={activePreset.builtin} />
            </label>
            <div class="file-actions">
                <ShButton variant="default" onclick={createPreset}><PlusIcon size={16} />{language.risuBardWikiPrompt.createPreset}</ShButton>
                <ShButton variant="default" onclick={duplicateActivePreset}><CopyIcon size={16} />{language.presetDuplicate}</ShButton>
                <ShButton variant="default" onclick={exportActivePreset}><DownloadIcon size={16} />{language.presetExport}</ShButton>
                <ShButton variant="default" onclick={importPreset}><UploadIcon size={16} />{language.presetImport}</ShButton>
                <ShButton variant="destructive" onclick={deleteActivePreset} disabled={activePreset.builtin}><Trash2Icon size={16} />{language.presetDelete}</ShButton>
            </div>
        </div>
    {/if}

    <RisuBardWikiPromptReferenceSheet bind:open={promptingHelpOpen} />
</SettingPage>

<style>
    .preset-picker, .basic-panel { overflow: hidden; margin: -.65rem 0 1rem; border: 1px solid var(--settings-border, var(--risu-theme-darkborderc)); border-radius: var(--settings-radius, .75rem); background: var(--settings-surface, var(--risu-theme-bgcolor)); }
    .preset-picker button { display: flex; width: 100%; align-items: center; justify-content: space-between; padding: .75rem 1rem; text-align: left; }
    .preset-picker button + button { border-top: 1px solid var(--settings-border, var(--risu-theme-darkborderc)); }
    .preset-picker button.selected { color: var(--risu-theme-textcolor); background: color-mix(in srgb, var(--risu-theme-selected) 55%, transparent); }
    .preset-picker small { color: var(--risu-theme-textcolor2); }
    .basic-panel { margin-top: 1rem; padding: 1rem; }
    .basic-panel label { display: grid; gap: .45rem; }
    .file-actions { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: .55rem; margin-top: 1rem; }
    @media (max-width: 560px) { .file-actions { grid-template-columns: 1fr; } }
</style>
