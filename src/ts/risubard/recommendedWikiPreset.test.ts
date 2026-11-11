import { describe, expect, test } from 'vitest'
import { resolveRisuBardChatSettings } from './risuBardSettings'
import { matchesRecommendedWikiPreset, recommendedWikiPresetChanges } from './recommendedWikiPreset'

describe('official recommended BardWiki preset', () => {
    test('sets two-turn analysis, leaves rerank alone and raises a small work scale to standard', () => {
        const settings = resolveRisuBardChatSettings({
            risuBardSourceRerank: true,
            risuBardAnalysisTokenLimit: 24_576,
            risuBardAnalysisLoreTokenLimit: 750,
        })
        expect(recommendedWikiPresetChanges(settings)).toEqual({
            risuBardAnalysisTurnInterval: 2,
            risuBardAnalysisTokenLimit: 32_768,
            risuBardAnalysisLoreTokenLimit: 1_000,
        })
        expect(matchesRecommendedWikiPreset(settings)).toBe(false)
        expect(matchesRecommendedWikiPreset({ ...settings, ...recommendedWikiPresetChanges(settings) })).toBe(true)
    })

    test('keeps a work scale that is already larger than standard', () => {
        const settings = resolveRisuBardChatSettings({
            risuBardAnalysisTurnInterval: 2,
            risuBardAnalysisTokenLimit: 65_536,
            risuBardAnalysisLoreTokenLimit: 2_000,
        })
        expect(recommendedWikiPresetChanges(settings)).toEqual({})
        expect(matchesRecommendedWikiPreset(settings)).toBe(true)
    })
})
