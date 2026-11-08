<script lang="ts">
    import { DBState, selectedCharID } from "src/ts/stores.svelte";
    import { language } from "src/lang";
    import { ChevronDownIcon, SettingsIcon } from "@lucide/svelte";
    import { alertConfirm, notifySuccess } from "src/ts/alert";
    import { openSettings, SettingsRoute, ModelPresetTab } from "src/ts/routing";
    import ModelList from "../UI/ModelList.svelte";
    import ModelPresetList from "../UI/ModelPresetList.svelte";
    import ShSwitch from "../UI/GUI/ShSwitch.svelte";
    import ShButton from "../UI/GUI/ShButton.svelte";
    import SelectInput from "../UI/GUI/SelectInput.svelte";
    import { emptyModelBinding } from "src/ts/preset/types";
    import type { Chat } from "src/ts/storage/database.svelte";
    import { chatUsesModelPreset } from "src/ts/process/request/modelPresetBinding";

    interface Props {
        bindingTarget?: Pick<Chat, 'useModelPreset' | 'subUseModelPreset' | 'modelBinding'>;
        onBindingChange?: () => void;
    }

    let { bindingTarget, onBindingChange = () => {} }: Props = $props();

    let currentChat = $derived(
        DBState.db.characters[$selectedCharID]?.chats?.[DBState.db.characters[$selectedCharID]?.chatPage]
    );
    let target = $derived(bindingTarget ?? currentChat);

    let auxExpanded = $state(false);

    // Global lock; 'none' lets each chat choose. The per-chat dropdown only
    // appears under 'none' — a lock forces the regime app-wide.
    let lock = $derived(DBState.db.nodeOnlyModelModeLock ?? 'none');

    // Effective regime for THIS chat (mirrors resolveChatModelBinding): a lock
    // forces it; under 'none' it's the chat's OWN stored choice only (the
    // new-chat default is snapshotted at creation, not read here).
    // The main slot and the sub slot (with its aux tasks) choose separately.
    let mainPreset = $derived(chatUsesModelPreset(target, 'main', lock));
    let subPreset = $derived(chatUsesModelPreset(target, 'sub', lock));
    let presetRegime = $derived(mainPreset || subPreset);

    // Seed the bundle when entering binding regime: copy the global default if
    // set (visible write-time seeding, not a runtime fallback), else start empty.
    // Normalize every field to a defined primitive — bind:value / bind:checked on
    // a $bindable rejects undefined (Svelte props_invalid_value).
    function ensureBinding() {
        if (!target) return;
        if (!target.modelBinding) {
            const def = DBState.db.defaultModelBinding;
            target.modelBinding = def ? structuredClone($state.snapshot(def)) : emptyModelBinding();
        }
        const b = target.modelBinding;
        b.main ??= '';
        b.sub ??= '';
        b.separateAux ??= false;
        b.aux ??= { memory: '', emotion: '', translate: '', otherAx: '' };
        b.aux.memory ??= '';
        b.aux.emotion ??= '';
        b.aux.translate ??= '';
        b.aux.otherAx ??= '';
    }

    // An unset sub mode follows the main mode, so switching only the main
    // mode still switches both, as before. Remember the choice for new chats.
    function onModeChange(slot: 'main' | 'sub', v: 'legacy' | 'preset') {
        if (!target) return;
        const sub = subPreset;
        if (slot === 'main') target.useModelPreset = v === 'preset';
        const main = target.useModelPreset ?? false;
        const nextSub = slot === 'sub' ? v === 'preset' : sub;
        if (slot === 'sub' || target.subUseModelPreset !== undefined) {
            if (nextSub === main) delete target.subUseModelPreset;
            else target.subUseModelPreset = nextSub;
        }
        if (!bindingTarget) {
            DBState.db.useModelPresetByDefault = main;
            if (target.subUseModelPreset === undefined) delete DBState.db.subUseModelPresetByDefault;
            else DBState.db.subUseModelPresetByDefault = target.subUseModelPreset;
        }
        if (main || nextSub) ensureBinding();
        onBindingChange();
    }

    function openModelModeSettings() {
        openSettings(SettingsRoute.ModelPreset, undefined, undefined, ModelPresetTab.Options);
    }

    async function confirmSetAsDefault() {
        if (!target?.modelBinding) return;
        if (!(await alertConfirm(language.modelPresetSetDefaultConfirm))) return;
        DBState.db.useModelPresetByDefault = mainPreset;
        if (subPreset === mainPreset) delete DBState.db.subUseModelPresetByDefault;
        else DBState.db.subUseModelPresetByDefault = subPreset;
        DBState.db.defaultModelBinding = structuredClone($state.snapshot(target.modelBinding));
        notifySuccess(language.modelPresetDefaultSaved);
    }

    // Make sure the bundle exists whenever the binding UI is shown (including
    // chats forced into preset mode by the global lock).
    $effect(() => {
        if (target && presetRegime) ensureBinding();
    });
</script>

<div class="flex flex-col gap-1 mt-4">
    {#if target && lock === 'none'}
        <!-- Per-chat model-mode picker. Hidden when a global lock is set. -->
        <div class="flex items-center justify-between gap-1 px-1">
            <span class="text-[11px] text-textcolor2">{language.modelModeLabel}</span>
            <ShButton size="icon" className="shrink-0" onclick={openModelModeSettings} title={language.modelModeSettingsTitle}>
                <SettingsIcon size={16} />
            </ShButton>
        </div>
        <div class="grid grid-cols-2 gap-1" data-model-mode-slots>
            <div class="flex min-w-0 flex-col gap-0.5">
                <span class="text-[11px] text-textcolor2 px-1">{language.modelModeMain}</span>
                <SelectInput
                    value={mainPreset ? 'preset' : 'legacy'}
                    ariaLabel={language.modelModeMain}
                    onchange={(e) => onModeChange('main', e.currentTarget.value as 'legacy' | 'preset')}
                >
                    <option value="legacy">{language.modelModeLegacy}</option>
                    <option value="preset">{language.modelModePreset}</option>
                </SelectInput>
            </div>
            <div class="flex min-w-0 flex-col gap-0.5">
                <span class="text-[11px] text-textcolor2 px-1">{language.modelModeSub}</span>
                <SelectInput
                    value={subPreset ? 'preset' : 'legacy'}
                    ariaLabel={language.modelModeSub}
                    onchange={(e) => onModeChange('sub', e.currentTarget.value as 'legacy' | 'preset')}
                >
                    <option value="legacy">{language.modelModeLegacy}</option>
                    <option value="preset">{language.modelModePreset}</option>
                </SelectInput>
            </div>
        </div>
    {/if}
    <div class="text-[11px] text-textcolor2 px-1{target && lock === 'none' ? ' mt-3' : ''}">
        {mainPreset && subPreset ? language.modelPresetBindingTitle : `${language.model}/${language.submodel}`}
    </div>

    {#if mainPreset && target?.modelBinding}
        <ModelPresetList warnIfEmpty bind:value={target.modelBinding.main} onChange={onBindingChange} />
    {:else if !mainPreset}
        <ModelList compact bind:value={DBState.db.aiModel} />
    {/if}
    {#if !subPreset}
        <!-- Classic sub/aux: global model selection, untouched. -->
        <div class="flex gap-1 items-stretch">
            <div class="flex-1 min-w-0">
                <ModelList compact bind:value={DBState.db.subModel} />
            </div>
            <ShButton size="icon" className="shrink-0" onclick={() => { auxExpanded = !auxExpanded }} title={language.seperateModelsForAxModels}>
                <ChevronDownIcon size={16} class={`transition-transform${auxExpanded ? ' rotate-180' : ''}`} />
            </ShButton>
        </div>
        {#if auxExpanded}
            <div class="flex flex-col gap-1 mt-1 pl-2 border-l border-selected">
                <div class="w-full flex items-center justify-between gap-2 min-h-10 rounded-md px-1">
                    <span class="min-w-0">{language.seperateModelsForAxModels}</span>
                    <ShSwitch className="shrink-0" bind:checked={DBState.db.seperateModelsForAxModels} />
                </div>
                <div class="text-[11px] text-textcolor2 px-1">{language.axModelMemory}</div>
                <ModelList compact blankable blankLabel={language.useDefaultSubModel} disabled={!DBState.db.seperateModelsForAxModels} bind:value={DBState.db.seperateModels.memory} />
                <div class="text-[11px] text-textcolor2 px-1">{language.axModelTranslate}</div>
                <ModelList compact blankable blankLabel={language.useDefaultSubModel} disabled={!DBState.db.seperateModelsForAxModels} bind:value={DBState.db.seperateModels.translate} />
                <div class="text-[11px] text-textcolor2 px-1">{language.axModelEmotion}</div>
                <ModelList compact blankable blankLabel={language.useDefaultSubModel} disabled={!DBState.db.seperateModelsForAxModels} bind:value={DBState.db.seperateModels.emotion} />
                <div class="text-[11px] text-textcolor2 px-1">{language.axModelOther}</div>
                <ModelList compact blankable blankLabel={language.useDefaultSubModel} disabled={!DBState.db.seperateModelsForAxModels} bind:value={DBState.db.seperateModels.otherAx} />
            </div>
        {/if}
    {:else if target?.modelBinding}
        <!-- Binding regime: per-chat ModelPreset bundle. -->
        <div class="flex gap-1 items-stretch">
            <div class="flex-1 min-w-0">
                <ModelPresetList warnIfEmpty bind:value={target.modelBinding.sub} onChange={onBindingChange} />
            </div>
            <ShButton size="icon" className="shrink-0" onclick={() => { auxExpanded = !auxExpanded }} title={language.seperateModelsForAxModels}>
                <ChevronDownIcon size={16} class={`transition-transform${auxExpanded ? ' rotate-180' : ''}`} />
            </ShButton>
        </div>
        {#if auxExpanded}
            <div class="flex flex-col gap-1 mt-1 pl-2 border-l border-selected">
                <div class="w-full flex items-center justify-between gap-2 min-h-10 rounded-md px-1">
                    <span class="min-w-0">{language.seperateModelsForAxModels}</span>
                    <ShSwitch className="shrink-0" checked={target.modelBinding.separateAux} onCheckedChange={(checked) => { target!.modelBinding!.separateAux = checked; onBindingChange() }} />
                </div>
                <div class="text-[11px] text-textcolor2 px-1">{language.axModelMemory}</div>
                <ModelPresetList blankable disabled={!target.modelBinding.separateAux} bind:value={target.modelBinding.aux.memory} onChange={onBindingChange} />
                <div class="text-[11px] text-textcolor2 px-1">{language.axModelTranslate}</div>
                <ModelPresetList blankable disabled={!target.modelBinding.separateAux} bind:value={target.modelBinding.aux.translate} onChange={onBindingChange} />
                <div class="text-[11px] text-textcolor2 px-1">{language.axModelEmotion}</div>
                <ModelPresetList blankable disabled={!target.modelBinding.separateAux} bind:value={target.modelBinding.aux.emotion} onChange={onBindingChange} />
                <div class="text-[11px] text-textcolor2 px-1">{language.axModelOther}</div>
                <ModelPresetList blankable disabled={!target.modelBinding.separateAux} bind:value={target.modelBinding.aux.otherAx} onChange={onBindingChange} />
            </div>
        {/if}
    {/if}

    {#if !bindingTarget && presetRegime && target?.modelBinding}
        <ShButton variant="ghost" size="xs" className="w-full text-textcolor2" onclick={confirmSetAsDefault}>
            {language.modelPresetSaveAsDefaultButton}
        </ShButton>
    {/if}
</div>
