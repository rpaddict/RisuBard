<script lang="ts">
    import SettingPage from "src/lib/UI/GUI/SettingPage.svelte";
    import SettingTabs from "src/lib/UI/GUI/SettingTabs.svelte";
    import PresetHeader from "src/lib/UI/GUI/PresetHeader.svelte";
    import ShAlert from "src/lib/UI/GUI/ShAlert.svelte";
    import SettingRenderer from "../SettingRenderer.svelte";
    import PromptV2Workspace from "./PromptPreset/PromptV2Workspace.svelte";
    import { InfoIcon } from "@lucide/svelte";
    import { language } from "src/lang";
    import {
        DBState,
        openPresetList,
        PromptPresetSubmenuIndex,
    } from "src/ts/stores.svelte";
    import {
        promptPresetBasicInfoItems,
        promptPresetPromptItems,
        promptPresetParameterItems,
        promptPresetAdvancedItems,
    } from "src/ts/setting/promptPresetSettingsData.svelte";

    function openPresetSelector() {
        openPresetList.set(true);
    }

</script>

<SettingPage
    title={language.settingsWorkspace.aiWorkspace.sections['chat-prompt-presets'].title}
    fullWidth={$PromptPresetSubmenuIndex === 2}
>
    {#snippet headerActions()}
        <PresetHeader
            compact
            label={language.currentPromptPreset}
            activeName={DBState.db.botPresets?.[DBState.db.botPresetsId]?.name ?? '—'}
            onManage={openPresetSelector}
        />
    {/snippet}
    <SettingTabs
        tabs={[
            { label: language.basicInfo, value: 0 },
            { label: language.prompt, value: 1 },
            { label: language.promptV2.tab, value: 2 },
            { label: language.parameters, value: 3 },
            { label: language.advancedSettings, value: 4 },
        ]}
        bind:selected={$PromptPresetSubmenuIndex}
        variant="prominent"
    />

    {#if $PromptPresetSubmenuIndex === 0}
        <SettingRenderer items={promptPresetBasicInfoItems} />
    {:else if $PromptPresetSubmenuIndex === 1}
        <SettingRenderer items={promptPresetPromptItems} />
    {:else if $PromptPresetSubmenuIndex === 2}
        <PromptV2Workspace />
    {:else if $PromptPresetSubmenuIndex === 3}
        <ShAlert className="mt-4 mb-2">
            {#snippet icon()}<InfoIcon />{/snippet}
            {language.promptPresetParamScopeDesc}
        </ShAlert>
        <SettingRenderer items={promptPresetParameterItems} layout="block" />
    {:else if $PromptPresetSubmenuIndex === 4}
        <SettingRenderer items={promptPresetAdvancedItems} />
    {/if}
</SettingPage>
