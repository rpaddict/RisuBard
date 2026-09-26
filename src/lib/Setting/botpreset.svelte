<script lang="ts">
    import { alertConfirm, notifyError, notifySuccess } from '../../ts/alert'
    import { language } from '../../lang'
    import {
        selectChatPromptPreset,
        copyPreset,
        downloadPreset,
        importPreset,
        deleteBotPreset,
    } from '../../ts/storage/database.svelte'
    import { v4 as uuidv4 } from 'uuid'
    import { DBState, presetSelectActiveId, presetSelectCallback, settingsOpen } from 'src/ts/stores.svelte'
    import { get } from 'svelte/store'
    import { openSettings, SettingsRoute } from 'src/ts/routing'
    import ShButton from '../UI/GUI/ShButton.svelte'
    import ShDialog from '../UI/GUI/ShDialog.svelte'
    import ManagerResizeHandles from '../UI/GUI/ManagerResizeHandles.svelte'
    import {
        CopyIcon,
        Share2Icon,
        PencilIcon,
        HardDriveUploadIcon,
        PlusIcon,
        TrashIcon,
        GitCompare,
    } from '@lucide/svelte'
    import TextInput from '../UI/GUI/TextInput.svelte'
    import { prebuiltPresets } from 'src/ts/process/templates/templates'
    import PromptDiffModal from '../Others/PromptDiffModal.svelte'
    import CollectionOrganizerList from '../UI/CollectionOrganizerList.svelte'
    import { assignCollectionItem, normalizeCollectionOrganizerState } from 'src/ts/collectionOrganizer'
    import { requestImmediateSave } from 'src/ts/globalApi.svelte'

    let editMode = $state(false)
    let contentElement: HTMLElement | null = $state(null)
    let selectedPresetFolder = $state<string | null | undefined>(undefined)
    const organizerPresetItems = $derived(DBState.db.botPresets.flatMap((preset) => typeof preset.id === 'string'
        ? [{ id: preset.id, title: preset.name || preset.id, detail: preset.aiModel || preset.apiType }]
        : []))

    interface Props {
        close?: () => void
    }

    let { close = () => {} }: Props = $props()

    $effect(() => {
        return () => {
            presetSelectCallback.set(null)
            presetSelectActiveId.set(null)
        }
    })

    let showDiffModal = $state(false)
    let selectedDiffPreset = $state<number | null>(null)
    let firstPresetId = $state<number | null>(null)
    let secondPresetId = $state<number | null>(null)

    async function handleDiffMode(id: number) {
        if (selectedDiffPreset === id) {
            selectedDiffPreset = null
            firstPresetId = null
            secondPresetId = null
            return
        }
        selectedDiffPreset = id
        if (firstPresetId === null) {
            firstPresetId = id
            secondPresetId = null
            return
        }
        secondPresetId = id
        selectedDiffPreset = null
        showDiffModal = true
    }

    function closeDiff() {
        showDiffModal = false
        firstPresetId = null
        secondPresetId = null
        selectedDiffPreset = null
    }

    function selectPreset(i: number) {
        if (editMode) return
        const cb = get(presetSelectCallback)
        if (cb) {
            presetSelectCallback.set(null)
            presetSelectActiveId.set(null)
            cb(i)
        } else {
            selectChatPromptPreset(i)
        }
        close()
    }

    function assignPresetToFolder(presetId: string, folderId: string | null | undefined) {
        if (typeof folderId !== 'string' || !DBState.db.collectionOrganizers) return
        const presetIds = DBState.db.botPresets.flatMap((preset) => typeof preset.id === 'string' ? [preset.id] : [])
        const current = normalizeCollectionOrganizerState(DBState.db.collectionOrganizers.promptPresets, presetIds)
        DBState.db.collectionOrganizers = {
            ...DBState.db.collectionOrganizers,
            promptPresets: assignCollectionItem(current, presetId, folderId),
        }
        void requestImmediateSave()
    }
</script>

<ShDialog open onOpenChange={(open) => { if (!open) close() }} bind:contentElement
    tier="base" size="xl" closeOnEscape closeOnOutsideClick={false}
    contentClass="preset-manager" bodyClass="preset-manager-body"
    closeAriaLabel={language.collectionOrganizer.close}>
        {#snippet title()}{language.promptPresets}{/snippet}
        {#if !$settingsOpen}
            <ShButton variant="default" size="default" className="w-full mb-4" onclick={() => {
                close()
                openSettings(SettingsRoute.PromptPreset)
            }}>
                <PencilIcon size={16}/>
                <span class="ml-1">{language.presetEdit}</span>
            </ShButton>
        {/if}

        <CollectionOrganizerList
            kind="promptPresets"
            items={organizerPresetItems}
            collectionLabel={language.promptPresets}
            bind:selectedFolderId={selectedPresetFolder}
        >
            {#snippet toolbar(selectedFolderId)}
                <div class="flex items-center gap-1">
                    <ShButton variant="ghost" size="icon-sm" aria-label={language.add} onclick={() => {
                        const botPresets = DBState.db.botPresets
                        const newPreset = safeStructuredClone(prebuiltPresets.OAI2)
                        newPreset.id = uuidv4()
                        newPreset.name = 'New Preset'
                        botPresets.push(newPreset)
                        DBState.db.botPresets = botPresets
                        assignPresetToFolder(newPreset.id, selectedFolderId)
                    }}><PlusIcon/></ShButton>
                    <ShButton variant="ghost" size="icon-sm" aria-label={language.import} onclick={async () => {
                        const before = DBState.db.botPresets.length
                        const previousIds = new Set(DBState.db.botPresets.map((preset) => preset.id))
                        await importPreset()
                        const after = DBState.db.botPresets.length
                        if (after > before) {
                            for (const preset of DBState.db.botPresets) {
                                if (typeof preset.id === 'string' && !previousIds.has(preset.id)) assignPresetToFolder(preset.id, selectedFolderId)
                            }
                            selectChatPromptPreset(after - 1)
                            notifySuccess(language.presetImported)
                        }
                    }}><HardDriveUploadIcon/></ShButton>
                    <ShButton variant="ghost" size="icon-sm" aria-label={language.presetEdit} onclick={() => {
                        editMode = !editMode
                    }}><PencilIcon/></ShButton>
                </div>
            {/snippet}

            {#snippet itemContent(presetId)}
                {@const i = DBState.db.botPresets.findIndex((preset) => preset.id === presetId)}
                {#if i >= 0}
                    {@const preset = DBState.db.botPresets[i]}
                    <div
                        class="preset-manager-item flex min-h-9 min-w-0 w-full flex-wrap cursor-pointer items-center gap-2 rounded-md px-2 text-textcolor hover:bg-selected/30"
                        class:bg-selected={$presetSelectActiveId ? preset.id === $presetSelectActiveId : i === DBState.db.botPresetsId}
                        role="button"
                        tabindex="0"
                        onclick={() => selectPreset(i)}
                        onkeydown={(event) => { if (event.key === 'Enter') selectPreset(i) }}
                    >
                        {#if editMode}
                            <TextInput className="min-w-0 max-w-full flex-1 basis-40" bind:value={DBState.db.botPresets[i].name} placeholder="string" padding={false}/>
                        {:else}
                            {#if preset.image}
                                <img src={preset.image} alt="icon" class="size-6 shrink-0 rounded-md" decoding="async"/>
                            {/if}
                            <span class="min-w-0 flex-1 basis-40 wrap-anywhere">{preset.name}</span>
                        {/if}
                        <div class="preset-manager-actions ml-auto flex max-w-full flex-wrap items-center">
                            {#if DBState.db.showPromptComparison}
                                <ShButton variant="ghost" size="icon-sm" aria-label={language.showPromptComparison} onclick={(event) => {
                                    event.stopPropagation()
                                    handleDiffMode(i)
                                }}><GitCompare class={selectedDiffPreset === i ? 'text-success' : ''}/></ShButton>
                            {/if}
                            <ShButton variant="ghost" size="icon-sm" aria-label={language.copy} onclick={(event) => {
                                event.stopPropagation()
                                const before = DBState.db.botPresets.length
                                copyPreset(i)
                                const after = DBState.db.botPresets.length
                                if (after > before) {
                                    const copiedPresetId = DBState.db.botPresets.at(-1)?.id
                                    if (typeof copiedPresetId === 'string') assignPresetToFolder(copiedPresetId, selectedPresetFolder)
                                    selectChatPromptPreset(after - 1)
                                    notifySuccess(language.presetDuplicated)
                                }
                            }}><CopyIcon/></ShButton>
                            <ShButton variant="ghost" size="icon-sm" aria-label={language.export} onclick={(event) => {
                                event.stopPropagation()
                                downloadPreset(i, 'risupreset')
                                notifySuccess(language.presetExported)
                            }}><Share2Icon/></ShButton>
                            <ShButton variant="ghost" size="icon-sm" aria-label={language.remove} onclick={async (event) => {
                                event.stopPropagation()
                                if (DBState.db.botPresets.length === 1) {
                                    notifyError(language.errors.onlyOnePreset)
                                    return
                                }
                                const presetId = preset.id
                                if (!presetId || !await alertConfirm(`${language.removeConfirm}${preset.name}`)) return
                                if (deleteBotPreset(presetId)) notifySuccess(language.presetDeleted)
                            }}><TrashIcon/></ShButton>
                        </div>
                    </div>
                {/if}
            {/snippet}
        </CollectionOrganizerList>
        <ManagerResizeHandles target={contentElement} centered />
        {#if showDiffModal && firstPresetId !== null && secondPresetId !== null}
            <PromptDiffModal
                firstPresetId={firstPresetId}
                secondPresetId={secondPresetId}
                onClose={closeDiff}
            />
        {/if}
</ShDialog>

<style>
    :global(.preset-manager) {
        width: var(--manager-width, min(96vw, 83.2rem));
        max-width: calc(100vw - 1rem);
        height: var(--manager-height, min(86dvh, 54rem));
        max-height: calc(100dvh - 1rem);
        min-width: 0;
        min-height: min(24rem, calc(100dvh - 1rem));
        overflow: hidden;
    }
    :global(.preset-manager-body) { display: flex; flex: 1; flex-direction: column; min-height: 0; min-width: 0; }
    :global(.preset-manager > :first-child) { flex-shrink: 0; }
    @media (max-width: 640px) {
        :global(.preset-manager) { width: 100vw; max-width: 100vw; height: 100dvh; max-height: 100dvh; border-radius: 0; padding: .75rem; }
    }
    @media (pointer: coarse) {
        .preset-manager-actions :global(button) { min-width: 2.5rem; min-height: 2.5rem; }
    }
</style>
