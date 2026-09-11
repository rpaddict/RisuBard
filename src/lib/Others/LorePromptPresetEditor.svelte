<script lang="ts">
    import { SaveIcon, Trash2Icon } from '@lucide/svelte'
    import { v4 } from 'uuid'
    import { language } from 'src/lang'
    import ShAccordion from 'src/lib/UI/GUI/ShAccordion.svelte'
    import ShButton from 'src/lib/UI/GUI/ShButton.svelte'
    import ShSelect from 'src/lib/UI/GUI/ShSelect.svelte'
    import OptionInput from 'src/lib/UI/GUI/OptionInput.svelte'
    import { alertConfirm, alertInput, notifyError, notifySuccess } from 'src/ts/alert'
    import { requestImmediateSave } from 'src/ts/globalApi.svelte'
    import {
        LORE_BUILDER_BUILTIN_PRESETS,
        createLoreBuilderUserPreset,
        deleteLoreBuilderUserPreset,
        overwriteLoreBuilderUserPreset,
        type LoreBuilderPromptKind,
    } from 'src/ts/loreBuilder'
    import { DBState } from 'src/ts/stores.svelte'

    interface Props {
        kind: LoreBuilderPromptKind
        value: string
        selectedId?: string
    }

    let { kind, value = $bindable(), selectedId = $bindable('') }: Props = $props()
    const copy = $derived(language.lorebookWorkspace.loreBuilder)
    const title = $derived(kind === 'task' ? copy.taskPrompt : copy.stylePrompt)
    const builtIns = $derived(LORE_BUILDER_BUILTIN_PRESETS.filter((preset) => preset.kind === kind))
    const userPresets = $derived((DBState.db.loreBuilderPromptPresets ?? []).filter((preset) => preset.kind === kind))
    const presets = $derived([...builtIns, ...userPresets])
    const selected = $derived(presets.find((preset) => preset.id === selectedId))
    const editableSelection = $derived(!!selected && !selected.id.startsWith('builtin:'))

    function applyPreset(id: string) {
        selectedId = id
        const preset = presets.find((item) => item.id === id)
        if (preset) value = preset.content
        if (kind === 'style') {
            DBState.db.loreBuilderStylePromptPresetId = id || undefined
            void requestImmediateSave()
        }
    }

    async function commit(presets: typeof DBState.db.loreBuilderPromptPresets) {
        DBState.db.loreBuilderPromptPresets = [...(presets ?? [])]
        await requestImmediateSave()
    }

    function showPresetError(cause: unknown) {
        const message = cause instanceof Error ? cause.message : ''
        notifyError(message === 'lore-builder-preset-name-exists' ? copy.presetNameExists : copy.presetInvalid)
    }

    async function saveNew() {
        const name = await alertInput(copy.presetNamePrompt, undefined, undefined, { tier: 'top' })
        if (!name) return
        const id = v4()
        try {
            const next = createLoreBuilderUserPreset({
                presets: DBState.db.loreBuilderPromptPresets ?? [], kind, name, content: value, createId: () => id,
            })
            await commit(next)
            selectedId = id
            if (kind === 'style') {
                DBState.db.loreBuilderStylePromptPresetId = id
                await requestImmediateSave()
            }
            notifySuccess(copy.presetSaved)
        }
        catch (cause) {
            showPresetError(cause)
        }
    }

    async function overwriteSelected() {
        if (!editableSelection || !selected) return
        if (!await alertConfirm(copy.presetOverwriteConfirm(selected.name), { tier: 'top' })) return
        try {
            await commit(overwriteLoreBuilderUserPreset(DBState.db.loreBuilderPromptPresets ?? [], selected.id, value))
            notifySuccess(copy.presetOverwritten)
        }
        catch (cause) {
            showPresetError(cause)
        }
    }

    async function deleteSelected() {
        if (!editableSelection || !selected) return
        if (!await alertConfirm(copy.presetDeleteConfirm(selected.name), { tier: 'top' })) return
        try {
            await commit(deleteLoreBuilderUserPreset(DBState.db.loreBuilderPromptPresets ?? [], selected.id))
            selectedId = ''
            if (kind === 'style') {
                DBState.db.loreBuilderStylePromptPresetId = undefined
                await requestImmediateSave()
            }
            notifySuccess(copy.presetDeleted)
        }
        catch (cause) {
            showPresetError(cause)
        }
    }
</script>

<ShAccordion name={title} variant="card">
    <div class="flex flex-col gap-2">
        <div class="flex flex-col gap-2 sm:flex-row">
            <ShSelect className="min-w-0 flex-1" value={selectedId} onchange={(event) => applyPreset(event.currentTarget.value)}>
                <OptionInput value="">{copy.presetSelect}</OptionInput>
                {#each builtIns as preset (preset.id)}<OptionInput value={preset.id}>{preset.name}</OptionInput>{/each}
                {#each userPresets as preset (preset.id)}<OptionInput value={preset.id}>{preset.name}</OptionInput>{/each}
            </ShSelect>
            <div class="flex gap-1.5">
                <ShButton data-lore-prompt-preset-save variant="outline" size="sm" onclick={saveNew}>
                    <SaveIcon size={14} />{copy.presetSave}
                </ShButton>
                <ShButton data-lore-prompt-preset-overwrite variant="outline" size="sm" disabled={!editableSelection} onclick={overwriteSelected}>
                    {copy.presetOverwrite}
                </ShButton>
                <ShButton data-lore-prompt-preset-delete variant="destructive" size="icon-sm" disabled={!editableSelection}
                    aria-label={copy.presetDelete} title={copy.presetDelete} onclick={deleteSelected}>
                    <Trash2Icon size={15} />
                </ShButton>
            </div>
        </div>
        <textarea class="prompt-editor" bind:value aria-label={title}
            placeholder={kind === 'task' ? copy.taskPromptPlaceholder : copy.stylePromptPlaceholder}></textarea>
        {#if selectedId.startsWith('builtin:')}
            <p class="m-0 text-xs text-textcolor2">{copy.builtinPresetHint}</p>
        {/if}
    </div>
</ShAccordion>

<style>
    .prompt-editor {
        width: 100%;
        min-height: 9rem;
        resize: vertical;
        border: 1px solid var(--color-darkborderc);
        border-radius: .5rem;
        padding: .75rem;
        color: var(--color-textcolor);
        background: var(--color-surface-inset);
        line-height: 1.55;
        outline: none;
    }
    .prompt-editor:focus-visible {
        border-color: var(--color-borderc);
        box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-borderc) 32%, transparent);
    }
</style>
