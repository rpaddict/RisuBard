/**
 * Custom Component Registry
 * 
 * Maps component IDs (strings) to actual Svelte components.
 * This enables the data-driven settings structure to reference
 * complex components without circular import issues.
 * 
 * Usage in settings data:
 *   { type: 'custom', componentId: 'ModelSelector' }
 * 
 * The SettingRenderer will look up the component from this registry
 * and render it dynamically.
 */

import type { Component } from 'svelte';

// Import custom components here
import SeparateParametersSection from 'src/lib/Setting/Pages/SeparateParametersSection.svelte';
import TranslatorPresetSettings from 'src/lib/Setting/Pages/Language/TranslatorPresetSettings.svelte';
import BanCharacterSetSettings from 'src/lib/Setting/Pages/Advanced/BanCharacterSetSettings.svelte';
import SettingsExportButtons from 'src/lib/Setting/Pages/Advanced/SettingsExportButtons.svelte';
import InlayCompressButton from 'src/lib/Setting/Pages/Advanced/InlayCompressButton.svelte';
import ColorSchemeSelect from 'src/lib/Setting/Pages/Display/ColorSchemeSelect.svelte';
import CustomColorSchemeEditor from 'src/lib/Setting/Pages/Display/CustomColorSchemeEditor.svelte';
import CustomTextThemeEditor from 'src/lib/Setting/Pages/Display/CustomTextThemeEditor.svelte';
import CustomBackgroundToggle from 'src/lib/Setting/Pages/Display/CustomBackgroundToggle.svelte';
import NullableTextColorToggle from 'src/lib/Setting/Pages/Display/NullableTextColorToggle.svelte';
import NotificationToggle from 'src/lib/Setting/Pages/Display/NotificationToggle.svelte';
import CustomizationWarning from 'src/lib/Setting/Pages/Display/CustomizationWarning.svelte';
import PromptPresetBasicInfo from 'src/lib/Setting/Pages/PromptPreset/PromptPresetBasicInfo.svelte';
import PromptEditorSection from 'src/lib/Setting/Pages/PromptPreset/PromptEditorSection.svelte';
import PromptTemplateBlock from 'src/lib/Setting/Pages/PromptPreset/PromptTemplateBlock.svelte';
import PromptToolsBlock from 'src/lib/Setting/Pages/PromptPreset/PromptToolsBlock.svelte';
import PromptRegexBlock from 'src/lib/Setting/Pages/PromptPreset/PromptRegexBlock.svelte';
import ModelRegistryRefresh from 'src/lib/Setting/Pages/Model/ModelRegistryRefresh.svelte';
import ModuleModelBindingList from 'src/lib/Setting/Pages/Model/ModuleModelBindingList.svelte';
import RisuBardArcPlotterPresets from 'src/lib/Setting/Pages/RisuBardArcPlotterPresets.svelte';
import RisuBardGrimoireLanguageSettings from 'src/lib/Setting/Pages/RisuBardGrimoireLanguageSettings.svelte';
import WikiEmbeddingSettings from 'src/lib/Setting/Pages/WikiEmbeddingSettings.svelte';
import RisuBardDynamicMemorySettings from 'src/lib/Setting/Pages/RisuBardDynamicMemorySettings.svelte';
import RisuBardMemoryBudgetPreset from 'src/lib/Setting/Pages/RisuBardMemoryBudgetPreset.svelte';

/**
 * Registry of custom components.
 * Add new components here as needed.
 */
export const customComponents: Record<string, Component<any>> = {
    'SeparateParametersSection': SeparateParametersSection,
    'TranslatorPresetSettings': TranslatorPresetSettings,
    'BanCharacterSetSettings': BanCharacterSetSettings,
    'SettingsExportButtons': SettingsExportButtons,
    'InlayCompressButton': InlayCompressButton,
    'ColorSchemeSelect': ColorSchemeSelect,
    'CustomColorSchemeEditor': CustomColorSchemeEditor,
    'CustomTextThemeEditor': CustomTextThemeEditor,
    'CustomBackgroundToggle': CustomBackgroundToggle,
    'NullableTextColorToggle': NullableTextColorToggle,
    'NotificationToggle': NotificationToggle,
    'CustomizationWarning': CustomizationWarning,
    'PromptPresetBasicInfo': PromptPresetBasicInfo,
    'PromptEditorSection': PromptEditorSection,
    'PromptTemplateBlock': PromptTemplateBlock,
    'PromptToolsBlock': PromptToolsBlock,
    'PromptRegexBlock': PromptRegexBlock,
    'ModelRegistryRefresh': ModelRegistryRefresh,
    'ModuleModelBindingList': ModuleModelBindingList,
    'RisuBardArcPlotterPresets': RisuBardArcPlotterPresets,
    'RisuBardGrimoireLanguageSettings': RisuBardGrimoireLanguageSettings,
    'WikiEmbeddingSettings': WikiEmbeddingSettings,
    'RisuBardDynamicMemorySettings': RisuBardDynamicMemorySettings,
    'RisuBardMemoryBudgetPreset': RisuBardMemoryBudgetPreset,
    // Add more as we migrate complex settings
} as const;

/**
 * Type-safe component ID type.
 * Will be populated as components are added to the registry.
 */
export type CustomComponentId = keyof typeof customComponents;

/**
 * Props that can be passed to custom components
 */
export interface CustomComponentProps {
    /** Any additional props to pass to the component */
    [key: string]: unknown;
}
