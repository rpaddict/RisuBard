<script lang="ts">
    import { CopyIcon, LockKeyholeIcon, Trash2Icon } from '@lucide/svelte'
    import { v4 as uuidv4 } from 'uuid'
    import { language } from 'src/lang'
    import { alertConfirm, notifySuccess } from 'src/ts/alert'
    import {
        BARD_LORE_DEFAULT_INSTRUCTION_PRESET_ID,
        deleteBardLoreInstructionPreset,
        duplicateBardLoreInstructionPreset,
        resolveBardLoreInstructionPreset,
    } from 'src/ts/lorebook/bardLoreInstructionPreset'
    import { DBState } from 'src/ts/stores.svelte'
    import ShButton from 'src/lib/UI/GUI/ShButton.svelte'

    interface Props { compact?: boolean }
    let { compact = false }: Props = $props()

    let activePreset = $derived(resolveBardLoreInstructionPreset(
        DBState.db.risuBardGrimoirePromptPresets,
        DBState.db.risuBardGrimoirePromptPresetId,
    ))

    function selectPreset(id: string) {
        DBState.db.risuBardGrimoirePromptPresetId = id
    }

    function duplicateActivePreset() {
        const duplicate = duplicateBardLoreInstructionPreset(activePreset, uuidv4())
        DBState.db.risuBardGrimoirePromptPresets ??= []
        DBState.db.risuBardGrimoirePromptPresets.push(duplicate)
        selectPreset(duplicate.id)
        notifySuccess(language.presetDuplicated)
    }

    async function deleteActivePreset() {
        if (activePreset.builtin) return
        if (!await alertConfirm(`${language.presetDeleteConfirm}\n${activePreset.name}`)) return
        const result = deleteBardLoreInstructionPreset(
            DBState.db.risuBardGrimoirePromptPresets ?? [],
            activePreset.id,
        )
        if (!result.deleted) return
        DBState.db.risuBardGrimoirePromptPresets = result.presets
        DBState.db.risuBardGrimoirePromptPresetId = BARD_LORE_DEFAULT_INSTRUCTION_PRESET_ID
        notifySuccess(language.presetDeleted)
    }

    function updateName(value: string) {
        if (activePreset.builtin || !value.trim()) return
        activePreset.name = value
        activePreset.revision = Math.min(2_147_483_647, activePreset.revision + 1)
    }

    function updateContent(value: string) {
        if (activePreset.builtin) return
        activePreset.content = value
        activePreset.revision = Math.min(2_147_483_647, activePreset.revision + 1)
    }
</script>

<section class:compact class="grimoire-prompt-workspace">
    <div class="preset-bar">
        <label>
            <span>{language.risuBardGrimoirePrompt.activePreset}</span>
            <select value={activePreset.id} onchange={(event) => selectPreset(event.currentTarget.value)}>
                {#each DBState.db.risuBardGrimoirePromptPresets ?? [] as preset (preset.id)}
                    <option value={preset.id}>{preset.name}</option>
                {/each}
            </select>
        </label>
        <div class="actions">
            <ShButton variant="default" onclick={duplicateActivePreset}>
                <CopyIcon size={15} />{language.presetDuplicate}
            </ShButton>
            <ShButton variant="destructive" onclick={deleteActivePreset} disabled={activePreset.builtin}>
                <Trash2Icon size={15} />{language.presetDelete}
            </ShButton>
        </div>
    </div>

    <div class="editor-card">
        <div class="editor-heading">
            <label>
                <span>{language.name}</span>
                <input
                    value={activePreset.name}
                    disabled={activePreset.builtin}
                    onchange={(event) => updateName(event.currentTarget.value)}
                />
            </label>
            {#if activePreset.builtin}
                <span class="protected"><LockKeyholeIcon size={14} />{language.risuBardGrimoirePrompt.builtin}</span>
            {/if}
        </div>
        {#if activePreset.builtin}
            <p class="notice">{language.risuBardGrimoirePrompt.protectedDescription}</p>
        {/if}
        <label class="instruction-editor">
            <span>{language.risuBardGrimoirePrompt.content}</span>
            <small>{language.risuBardGrimoirePrompt.contentHelp}</small>
            <textarea
                value={activePreset.content}
                readonly={activePreset.builtin}
                oninput={(event) => updateContent(event.currentTarget.value)}
                spellcheck="false"
            ></textarea>
        </label>
        <code>{language.risuBardGrimoirePrompt.placeholderHelp}</code>
    </div>
</section>

<style>
    .grimoire-prompt-workspace { display: grid; min-height: 32rem; grid-template-rows: auto minmax(0, 1fr); gap: .75rem; }
    .preset-bar { display: flex; align-items: end; justify-content: space-between; gap: .75rem; }
    .preset-bar label, .editor-heading label, .instruction-editor { display: grid; gap: .35rem; }
    .preset-bar label { flex: 1; }
    select, input, textarea { width: 100%; border: 1px solid var(--settings-border, var(--risu-theme-darkborderc)); border-radius: .55rem; color: var(--risu-theme-textcolor); background: var(--risu-theme-bgcolor); }
    select, input { min-height: 2.5rem; padding: .45rem .65rem; }
    .actions { display: flex; gap: .45rem; }
    .editor-card { display: grid; min-height: 0; grid-template-rows: auto auto minmax(0, 1fr) auto; gap: .55rem; padding: .85rem; border: 1px solid var(--settings-border, var(--risu-theme-darkborderc)); border-radius: .75rem; background: var(--settings-surface, var(--risu-theme-bgcolor)); }
    .editor-heading { display: flex; align-items: end; gap: .75rem; }
    .editor-heading label { flex: 1; }
    .protected { display: inline-flex; align-items: center; gap: .3rem; padding: .35rem .55rem; border-radius: 999px; color: var(--risu-theme-textcolor2); background: color-mix(in srgb, var(--risu-theme-darkborderc) 55%, transparent); white-space: nowrap; }
    .notice, small, code { margin: 0; color: var(--risu-theme-textcolor2); font-size: .78rem; }
    .instruction-editor { min-height: 0; grid-template-rows: auto auto minmax(14rem, 1fr); }
    textarea { min-height: 14rem; resize: none; padding: .75rem; font: .82rem/1.5 ui-monospace, SFMono-Regular, Consolas, monospace; }
    textarea[readonly], input:disabled { opacity: .8; }
    .compact { min-height: min(66dvh, 42rem); }
    @media (max-width: 620px) {
        .preset-bar, .editor-heading { align-items: stretch; flex-direction: column; }
        .actions { display: grid; grid-template-columns: 1fr 1fr; }
        .protected { align-self: start; }
    }
</style>
