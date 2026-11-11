import type { ResolvedRisuBardChatSettings, RisuBardChatSettings } from './risuBardSettings'
import { WIKI_SCALE_PRESETS, wikiScalePresetValues } from './wikiScalePreset'

/**
 * The official recommendation for keeping BardWiki's auxiliary requests cheap:
 * two turns per analysis call and a work scale large enough for both turns to
 * fit one call. A larger scale is kept. Source rerank is left to the user: it
 * buys recall, and a dedicated reranker API keeps it cheap.
 */
export const RECOMMENDED_WIKI_TURN_INTERVAL = 2
export const RECOMMENDED_WIKI_MINIMUM_SCALE = 'standard' as const

type RecommendedKeys =
    | 'risuBardAnalysisTurnInterval'
    | 'risuBardAnalysisTokenLimit'
    | 'risuBardAnalysisLoreTokenLimit'

export type RecommendedWikiValues = Pick<RisuBardChatSettings, RecommendedKeys>

/** The changes the recommendation makes to the given settings; empty when they already match. */
export function recommendedWikiPresetChanges(
    settings: Pick<ResolvedRisuBardChatSettings, RecommendedKeys>,
): RecommendedWikiValues {
    const changes: RecommendedWikiValues = {}
    if (settings.risuBardAnalysisTurnInterval !== RECOMMENDED_WIKI_TURN_INTERVAL) {
        changes.risuBardAnalysisTurnInterval = RECOMMENDED_WIKI_TURN_INTERVAL
    }
    const minimum = WIKI_SCALE_PRESETS[RECOMMENDED_WIKI_MINIMUM_SCALE]
    if (settings.risuBardAnalysisTokenLimit < minimum.analysis) {
        Object.assign(changes, wikiScalePresetValues(RECOMMENDED_WIKI_MINIMUM_SCALE))
    }
    return changes
}

export function matchesRecommendedWikiPreset(
    settings: Pick<ResolvedRisuBardChatSettings, RecommendedKeys>,
): boolean {
    return Object.keys(recommendedWikiPresetChanges(settings)).length === 0
}
