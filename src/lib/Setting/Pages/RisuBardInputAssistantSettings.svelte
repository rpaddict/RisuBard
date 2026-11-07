<script lang="ts">
    import { CopyIcon, FlaskConicalIcon, LockKeyholeIcon, Trash2Icon } from '@lucide/svelte'
    import { v4 as uuidv4 } from 'uuid'
    import { language } from 'src/lang'
    import { alertConfirm, notifySuccess } from 'src/ts/alert'
    import {
        deleteBardLoreInstructionPreset,
        duplicateBardLoreInstructionPreset,
    } from 'src/ts/lorebook/bardLoreInstructionPreset'
    import {
        INPUT_ASSISTANT_CONTEXT_KEYS,
        INPUT_ASSISTANT_DEFAULT_PRESET_ID,
        INPUT_ASSISTANT_MAX_MESSAGES,
        normalizeInputAssistantPresetState,
        normalizeInputAssistantSettings,
        resolveInputAssistantPreset,
    } from 'src/ts/risubard/inputAssistant'
    import { DBState } from 'src/ts/stores.svelte'
    import SettingPage from 'src/lib/UI/GUI/SettingPage.svelte'
    import SegmentedControl from 'src/lib/UI/GUI/SegmentedControl.svelte'
    import NumberInput from 'src/lib/UI/GUI/NumberInput.svelte'
    import CheckInput from 'src/lib/UI/GUI/CheckInput.svelte'
    import ShButton from 'src/lib/UI/GUI/ShButton.svelte'
    import ShSwitch from 'src/lib/UI/GUI/ShSwitch.svelte'

    const text = language.risuBardInputAssistant

    // Older databases loaded before this page existed have no state yet.
    if (!DBState.db.risuBardInputAssistantSettings) {
        DBState.db.risuBardInputAssistantSettings = normalizeInputAssistantSettings(undefined)
    }
    if (!DBState.db.risuBardInputAssistantPromptPresets?.length) {
        const state = normalizeInputAssistantPresetState({
            presets: DBState.db.risuBardInputAssistantPromptPresets,
            activePresetId: DBState.db.risuBardInputAssistantPromptPresetId,
        })
        DBState.db.risuBardInputAssistantPromptPresets = state.presets
        DBState.db.risuBardInputAssistantPromptPresetId = state.activePresetId
    }

    let settings = $derived(DBState.db.risuBardInputAssistantSettings!)
    let activePreset = $derived(resolveInputAssistantPreset(
        DBState.db.risuBardInputAssistantPromptPresets,
        DBState.db.risuBardInputAssistantPromptPresetId,
    ))

    const contextLabels = {
        systemPrompt: text.includeSystemPrompt,
        characterDescription: text.includeCharacterDescription,
        persona: text.includePersona,
        characterLorebook: text.includeCharacterLorebook,
        moduleLorebook: text.includeModuleLorebook,
    }

    function clampMessageCount() {
        settings.messageCount = normalizeInputAssistantSettings(settings).messageCount
    }

    function selectPreset(id: string) {
        DBState.db.risuBardInputAssistantPromptPresetId = id
    }

    function duplicateActivePreset() {
        const duplicate = duplicateBardLoreInstructionPreset(activePreset, uuidv4())
        DBState.db.risuBardInputAssistantPromptPresets ??= []
        DBState.db.risuBardInputAssistantPromptPresets.push(duplicate)
        selectPreset(duplicate.id)
        notifySuccess(language.presetDuplicated)
    }

    async function deleteActivePreset() {
        if (activePreset.builtin) return
        if (!await alertConfirm(`${language.presetDeleteConfirm}\n${activePreset.name}`)) return
        const result = deleteBardLoreInstructionPreset(
            DBState.db.risuBardInputAssistantPromptPresets ?? [],
            activePreset.id,
        )
        if (!result.deleted) return
        DBState.db.risuBardInputAssistantPromptPresets = result.presets
        DBState.db.risuBardInputAssistantPromptPresetId = INPUT_ASSISTANT_DEFAULT_PRESET_ID
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

<SettingPage title={text.title} description={text.description}>
    {#snippet titleSuffix()}
        <span class="experimental-badge"><FlaskConicalIcon size={13} />{text.experimental}</span>
    {/snippet}
    <div class="input-assistant-settings">
        <section class="panel enable-row">
            <div class="enable-text">
                <span class="label" id="input-assistant-enable">{text.enable}</span>
                <small>{text.enableHelp}</small>
            </div>
            <ShSwitch bind:checked={settings.enabled} ariaLabel={text.enable} />
        </section>
        <section class="panel" aria-labelledby="input-assistant-request">
            <h2 id="input-assistant-request">{text.requestSection}</h2>
            <div class="field">
                <span class="label">{text.model}</span>
                <SegmentedControl
                    bind:value={settings.model}
                    size="sm"
                    options={[
                        { value: 'otherAx', label: text.modelAux },
                        { value: 'model', label: text.modelMain },
                    ]}
                />
                <small>{text.modelHelp}</small>
            </div>
            <label class="field">
                <span class="label">{text.messageCount}</span>
                <NumberInput
                    bind:value={settings.messageCount}
                    min={0}
                    max={INPUT_ASSISTANT_MAX_MESSAGES}
                    size="sm"
                    marginBottom={false}
                    className="message-count"
                    onChange={clampMessageCount}
                />
                <small>{text.messageCountHelp}</small>
            </label>
            <fieldset class="field">
                <legend class="label">{text.include}</legend>
                <div class="checks">
                    {#each INPUT_ASSISTANT_CONTEXT_KEYS as key (key)}
                        <CheckInput bind:check={settings.include[key]} name={contextLabels[key]} margin={false} />
                    {/each}
                </div>
                <small>{text.includeHelp}</small>
            </fieldset>
        </section>

        <section class="panel prompt" aria-labelledby="input-assistant-prompt">
            <h2 id="input-assistant-prompt">{text.promptSection}</h2>
            <div class="preset-bar">
                <label>
                    <span class="label">{text.activePreset}</span>
                    <select value={activePreset.id} onchange={(event) => selectPreset(event.currentTarget.value)}>
                        {#each DBState.db.risuBardInputAssistantPromptPresets ?? [] as preset (preset.id)}
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
            <div class="editor-heading">
                <label>
                    <span class="label">{language.name}</span>
                    <input
                        value={activePreset.name}
                        disabled={activePreset.builtin}
                        onchange={(event) => updateName(event.currentTarget.value)}
                    />
                </label>
                {#if activePreset.builtin}
                    <span class="protected"><LockKeyholeIcon size={14} />{text.builtin}</span>
                {/if}
            </div>
            {#if activePreset.builtin}
                <p class="note">{text.protectedDescription}</p>
            {/if}
            <label class="instruction-editor">
                <span class="label">{text.content}</span>
                <small>{text.contentHelp}</small>
                <textarea
                    value={activePreset.content}
                    readonly={activePreset.builtin}
                    oninput={(event) => updateContent(event.currentTarget.value)}
                    spellcheck="false"
                ></textarea>
            </label>
            <small>{text.placeholderHelp}</small>
        </section>
    </div>
</SettingPage>

<style>
    .input-assistant-settings { display: grid; gap: 1rem; padding-bottom: 1rem; }
    .panel { display: grid; gap: .9rem; padding: 1rem; border: 1px solid var(--settings-border, var(--risu-theme-darkborderc)); border-radius: var(--risu-radius-xl); background: var(--settings-surface, var(--risu-theme-bgcolor)); }
    .experimental-badge { display: inline-flex; flex-shrink: 0; align-items: center; gap: .3rem; padding: .2rem .55rem; border: 1px solid var(--risu-theme-warning-border); border-radius: 999px; color: var(--risu-theme-warning); background: var(--risu-theme-warning-bg); font-size: .75rem; font-weight: 650; white-space: nowrap; }
    .enable-row { display: flex; align-items: center; justify-content: space-between; gap: 1rem; }
    .enable-text { display: grid; gap: .25rem; }
    h2 { margin: 0; color: var(--risu-theme-textcolor); font-size: .95rem; font-weight: 650; }
    .field, .preset-bar label, .editor-heading label, .instruction-editor { display: grid; gap: .35rem; justify-items: start; }
    .preset-bar label, .editor-heading label, .instruction-editor { justify-items: stretch; }
    fieldset { margin: 0; padding: 0; border: 0; }
    .label { color: var(--risu-theme-textcolor); font-size: .85rem; font-weight: 600; }
    small, .note { margin: 0; color: var(--risu-theme-textcolor2); font-size: .78rem; line-height: 1.45; }
    .field > :global(.segmented-control-container) { margin-bottom: 0; }
    .checks { display: flex; flex-wrap: wrap; gap: .5rem 1.25rem; padding: .15rem 0; font-size: .875rem; }
    :global(.message-count) { width: 7rem; }
    select, input:not([type]), textarea { width: 100%; border: 1px solid var(--settings-border, var(--risu-theme-darkborderc)); border-radius: calc(var(--risu-radius-lg) * 1.1); color: var(--risu-theme-textcolor); background: var(--risu-theme-bgcolor); }
    select, input:not([type]) { min-height: 2.5rem; padding: .45rem .65rem; }
    .preset-bar { display: flex; align-items: end; justify-content: space-between; gap: .75rem; }
    .preset-bar label { flex: 1; }
    .actions { display: flex; gap: .45rem; }
    .editor-heading { display: flex; align-items: end; gap: .75rem; }
    .editor-heading label { flex: 1; }
    .protected { display: inline-flex; align-items: center; gap: .3rem; padding: .35rem .55rem; border-radius: 999px; color: var(--risu-theme-textcolor2); background: color-mix(in srgb, var(--risu-theme-darkborderc) 55%, transparent); white-space: nowrap; }
    textarea { min-height: 18rem; resize: vertical; padding: .75rem; font: .82rem/1.5 ui-monospace, SFMono-Regular, Consolas, monospace; }
    textarea[readonly], input:disabled { opacity: .8; }
    @media (max-width: 620px) {
        .preset-bar, .editor-heading { align-items: stretch; flex-direction: column; }
        .actions { display: grid; grid-template-columns: 1fr 1fr; }
        .protected { align-self: start; }
    }
</style>
