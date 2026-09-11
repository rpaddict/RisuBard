import { describe, expect, it } from 'vitest'
import { createBardLoreSettings } from './bardLore'
import {
    applyBardLoreAnalysisSettings,
    normalizeBardLoreAnalysisDefaults,
    pickBardLoreAnalysisSettings,
    recommendBardLoreAnalysisSettings,
} from './bardLoreAnalysisSettings'

describe('Grimoire analysis settings', () => {
    it('copies only the five analysis fields into another settings object', () => {
        const source = createBardLoreSettings({
            targetTokens: 99_999,
            analysisBatchEntries: 7,
            analysisInputTokens: 18_000,
            analysisOutputTokens: 5_000,
            analysisLinkedDepth: 2,
            analysisTemperature: 0.35,
        })
        const target = createBardLoreSettings({ targetTokens: 2_500 })

        const picked = pickBardLoreAnalysisSettings(source)
        const applied = applyBardLoreAnalysisSettings(target, picked)

        expect(picked).toEqual({
            analysisBatchEntries: 7,
            analysisInputTokens: 18_000,
            analysisOutputTokens: 5_000,
            analysisLinkedDepth: 2,
            analysisTemperature: 0.35,
        })
        expect(applied.targetTokens).toBe(2_500)
        expect(applied).toMatchObject(picked)
    })

    it('keeps finite user defaults without imposing a hidden maximum', () => {
        expect(normalizeBardLoreAnalysisDefaults({
            analysisBatchEntries: 500,
            analysisInputTokens: 250_000,
            analysisOutputTokens: 120_000,
            analysisLinkedDepth: 8,
            analysisTemperature: 1.25,
        })).toEqual({
            analysisBatchEntries: 500,
            analysisInputTokens: 250_000,
            analysisOutputTokens: 120_000,
            analysisLinkedDepth: 8,
            analysisTemperature: 1.25,
        })
    })

    it('uses target count and estimated input to recommend a conservative batch', () => {
        expect(recommendBardLoreAnalysisSettings({
            targetCount: 40,
            estimatedInputTokens: 40_000,
        })).toEqual({
            analysisBatchEntries: 12,
            analysisInputTokens: 14_000,
            analysisOutputTokens: 5_000,
            analysisLinkedDepth: 1,
            analysisTemperature: 0.2,
        })

        expect(recommendBardLoreAnalysisSettings({
            targetCount: 4,
            estimatedInputTokens: 6_000,
        })).toEqual({
            analysisBatchEntries: 4,
            analysisInputTokens: 7_000,
            analysisOutputTokens: 2_000,
            analysisLinkedDepth: 1,
            analysisTemperature: 0.2,
        })
    })

    it('keeps the largest complete entry within the recommended input allowance', () => {
        const recommended = recommendBardLoreAnalysisSettings({
            targetCount: 100,
            estimatedInputTokens: 100_000,
            minimumInputTokens: 40_000,
        })
        expect(recommended.analysisInputTokens).toBeGreaterThanOrEqual(40_000)
    })
})
