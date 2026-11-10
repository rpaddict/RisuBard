// Picks the lorebook entries the wiki analysis may read as setting reference.
// Entries come from the regular lorebook activation, so keyword matching,
// conditionals and variables already match what the story saw.

import { parseRisuBardLoreExcludeWords } from './risuBardSettings'

export interface AnalysisLoreCandidate {
    title: string
    /** Entry text before CBS evaluation; exclude words match against it. */
    source: string
    /** Entry text after CBS evaluation; this is what the analysis reads. */
    rendered: string
    tokens: number
    priority: number
    alwaysActive: boolean
    sourceIdentity?: { scopeId: string; entryId?: string; contentHash: string }
}

export interface AnalysisLoreReference {
    title: string
    content: string
    source?: { scopeId: string; entryId?: string; contentHash: string }
}

export interface AnalysisLoreReferenceSettings {
    tokenLimit: number
    includeAlwaysActive: boolean
    excludeWords: string
}

/** Highest priority first; an entry that does not fit is skipped whole, never cut. */
export function selectAnalysisLoreReference(
    candidates: readonly AnalysisLoreCandidate[],
    settings: AnalysisLoreReferenceSettings,
): AnalysisLoreReference[] {
    if (settings.tokenLimit <= 0) return []
    const words = parseRisuBardLoreExcludeWords(settings.excludeWords).map((word) => word.toLowerCase())
    const seen = new Set<string>()
    const selected: AnalysisLoreReference[] = []
    let used = 0
    const ordered = candidates
        .map((candidate, index) => ({ candidate, index }))
        .sort((a, b) => b.candidate.priority - a.candidate.priority || a.index - b.index)
    for (const { candidate } of ordered) {
        if (selected.length >= 64) break
        const content = candidate.rendered.trim()
        if (!content || seen.has(content)) continue
        if (candidate.alwaysActive && !settings.includeAlwaysActive) continue
        const haystack = `${candidate.title}\n${candidate.source}`.toLowerCase()
        if (words.some((word) => haystack.includes(word))) continue
        if (used + candidate.tokens > settings.tokenLimit) continue
        used += candidate.tokens
        seen.add(content)
        selected.push({ title: candidate.title.slice(0, 200), content: content.slice(0, 64_000),
            ...(candidate.sourceIdentity ? { source: candidate.sourceIdentity } : {}),
        })
    }
    return selected
}
