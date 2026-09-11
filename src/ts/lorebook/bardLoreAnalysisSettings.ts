import {
    createBardLoreSettings,
    type BardLoreSettings,
    type BardLoreSettingsInput,
} from './bardLore'

export type BardLoreAnalysisSettings = Pick<
    BardLoreSettings,
    | 'analysisBatchEntries'
    | 'analysisInputTokens'
    | 'analysisOutputTokens'
    | 'analysisLinkedDepth'
    | 'analysisTemperature'
>

export function pickBardLoreAnalysisSettings(settings: BardLoreSettings): BardLoreAnalysisSettings {
    return {
        analysisBatchEntries: settings.analysisBatchEntries,
        analysisInputTokens: settings.analysisInputTokens,
        analysisOutputTokens: settings.analysisOutputTokens,
        analysisLinkedDepth: settings.analysisLinkedDepth,
        analysisTemperature: settings.analysisTemperature,
    }
}

export function normalizeBardLoreAnalysisDefaults(value: unknown): BardLoreAnalysisSettings {
    const input = value && typeof value === 'object' ? value as BardLoreSettingsInput : {}
    return pickBardLoreAnalysisSettings(createBardLoreSettings(input))
}

export function applyBardLoreAnalysisSettings(
    settings: BardLoreSettings,
    analysis: BardLoreAnalysisSettings,
): BardLoreSettings {
    return createBardLoreSettings({ ...settings, ...analysis })
}

const roundUp = (value: number, step: number): number => Math.ceil(value / step) * step

export function recommendBardLoreAnalysisSettings(input: {
    targetCount: number
    estimatedInputTokens: number
    minimumInputTokens?: number
}): BardLoreAnalysisSettings {
    const targetCount = Math.max(1, Math.floor(input.targetCount))
    const averageInput = Math.max(1, input.estimatedInputTokens / targetCount)
    const analysisBatchEntries = Math.min(20, targetCount, Math.max(1, Math.floor(12_000 / averageInput)))
    const analysisInputTokens = roundUp(Math.max(4_000, Math.max(averageInput * analysisBatchEntries, input.minimumInputTokens ?? 0) * 1.15), 1_000)
    const analysisOutputTokens = roundUp(Math.max(2_000, analysisBatchEntries * 400), 1_000)
    return {
        analysisBatchEntries,
        analysisInputTokens,
        analysisOutputTokens,
        analysisLinkedDepth: 1,
        analysisTemperature: 0.2,
    }
}
