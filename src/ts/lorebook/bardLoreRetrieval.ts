import { createBardLoreSettings, type BardLoreEntry, type BardLoreSettings } from './bardLore'
import { bardLoreEntrySatisfiesPlan, compileBardLoreIndex, planBardLoreQuery, type BardLoreQueryPlan } from './bardLoreQueryPlanner'

export type BardLoreSelectionReason = 'required' | 'key' | 'alias' | 'entity' | 'facet' | 'sparse' | 'link' | 'graph'

export interface BardLoreSelection {
    entry: BardLoreEntry
    reason: BardLoreSelectionReason
    score: number
    lane: 'required' | 'context'
    path?: string[]
}

export interface BardLoreSelectionResult {
    selected: BardLoreSelection[]
    excluded: BardLoreExclusion[]
    totalTokens: number
    requiredTokens: number
    contextualTokens: number
    plan: BardLoreQueryPlan
}

export type BardLoreExclusionReason = 'ineligible' | 'routing-only' | 'no-match' | 'kind-mismatch' | 'constraint-mismatch' | 'entry-limit' | 'requested-count' | 'target-reached' | 'token-limit'

export interface BardLoreExclusion {
    entry: BardLoreEntry
    reason: BardLoreExclusionReason
}

export interface BardLoreSelectionInput {
    query: string
    priorityQuery?: string
    routingEvidence?: string
    entries: BardLoreEntry[]
    tokenCounts: Record<string, number>
    settings: BardLoreSettings
    scopeAliases?: string[]
}

export class BardLoreBudgetError extends Error {
    constructor(message: string) {
        super(message)
        this.name = 'BardLoreBudgetError'
    }
}

const termPattern = /[\p{L}\p{N}]+/gu
const cjkPattern = /[\p{Script=Han}\p{Script=Hangul}\p{Script=Hiragana}\p{Script=Katakana}]/u

function terms(value: string, minimumLength: number): string[] {
    return [...new Set((value.toLocaleLowerCase().match(termPattern) ?? []).filter((term) => term.length >= minimumLength))]
}

function hasTerm(entryTerms: Set<string>, queryTerm: string, cjkPartialMatching: boolean): boolean {
    if (entryTerms.has(queryTerm)) return true
    if (!cjkPartialMatching || !cjkPattern.test(queryTerm)) return false
    return [...entryTerms].some((entryTerm) =>
        cjkPattern.test(entryTerm)
        && (queryTerm.includes(entryTerm) || entryTerm.includes(queryTerm)),
    )
}

function aliases(entry: BardLoreEntry): string[] {
    return [...new Set([
        ...entry.bard.aliases,
        ...entry.key.split(/[,\n]/u),
        ...entry.secondkey.split(/[,\n]/u),
    ].map((value) => value.trim()).filter(Boolean))]
}

function directMatch(query: string, entry: BardLoreEntry): { reason: 'key' | 'alias'; value: string } | undefined {
    const normalized = query.normalize('NFKC').toLocaleLowerCase()
    const keys = [...entry.key.split(/[,\n]/u), ...entry.secondkey.split(/[,\n]/u)].map((value) => value.trim()).filter(Boolean)
    const key = keys.find((value) => normalized.includes(value.normalize('NFKC').toLocaleLowerCase()))
    if (key) return { reason: 'key', value: key }
    const alias = entry.bard.aliases.find((value) => {
        const candidate = value.normalize('NFKC').trim().toLocaleLowerCase()
        return candidate.length > 0 && normalized.includes(candidate)
    })
    return alias ? { reason: 'alias', value: alias } : undefined
}

function searchableFields(entry: BardLoreEntry, minimumLength: number): Record<keyof BardLoreSettings['fieldWeights'], Set<string>> {
    return {
        name: new Set(terms(entry.comment, minimumLength)),
        keys: new Set(terms(entry.key + ' ' + entry.secondkey, minimumLength)),
        aliases: new Set(terms(entry.bard.aliases.join(' '), minimumLength)),
        tags: new Set(terms(entry.bard.tags.join(' '), minimumLength)),
        facets: new Set(terms((entry.bard.facets ?? []).flatMap((facet) => [facet.key, facet.value, ...facet.aliases]).join(' '), minimumLength)),
        summary: new Set(terms(entry.bard.summary, minimumLength)),
        content: new Set(terms(entry.content, minimumLength)),
    }
}

function tokenCount(entry: BardLoreEntry, tokenCounts: Record<string, number>): number {
    const count = tokenCounts[entry.id]
    if (typeof count !== 'number' || !Number.isFinite(count)) {
        throw new Error(`Missing Grimoire token count: ${entry.id}`)
    }
    return Math.max(0, Math.floor(count))
}

export function selectBardLoreEntries(input: BardLoreSelectionInput): BardLoreSelectionResult {
    const settings = createBardLoreSettings(input.settings)
    const eligible = input.entries.filter((entry) =>
        entry.enabled !== false
        && entry.mode !== 'folder'
        && entry.mode !== 'child'
        && entry.bard.activation !== 'never',
    )
    const order = new Map(eligible.map((entry, index) => [entry.id, index]))
    const byId = new Map(eligible.map((entry) => [entry.id, entry]))
    const selected: BardLoreSelection[] = []
    const selectedIds = new Set<string>()
    let totalTokens = 0
    let requiredTokens = 0
    let contextualTokens = 0
    let contextualEntries = 0
    let requestedEntries = 0

    for (const entry of eligible) {
        if (entry.bard.activation !== 'required' || entry.bard.injection === 'index-only') continue
        const tokens = tokenCount(entry, input.tokenCounts)
        selected.push({ entry, reason: 'required', score: Number.POSITIVE_INFINITY, lane: 'required' })
        selectedIds.add(entry.id)
        requiredTokens += tokens
        totalTokens += tokens
    }
    if (totalTokens > settings.maximumTokens) {
        throw new BardLoreBudgetError('Required Grimoire entries exceed the configured hard limit.')
    }

    const currentQuery = input.priorityQuery?.trim() || input.query
    const query = input.query.includes(currentQuery) ? input.query : `${input.query}\n${currentQuery}`
    // History supplies retrieval evidence, not instructions for the current turn.
    const plan = planBardLoreQuery(
        currentQuery,
        compileBardLoreIndex(eligible),
        settings,
        input.scopeAliases,
        input.routingEvidence,
    )
    const latestDirectIds = new Set(plan.anchors.map((anchor) => anchor.entryId))
    const explicitSelection = plan.requestedCount !== undefined || plan.arbitrary || plan.intent === 'list'

    const direct: BardLoreSelection[] = []
    const directCandidateIds = new Set<string>()
    const directSeedIds = new Set<string>()
    for (const entry of eligible) {
        if (selectedIds.has(entry.id) || entry.bard.activation === 'required') continue
        const match = directMatch(query, entry)
        if (!match) continue
        const latestInputMatch = directMatch(currentQuery, entry)
        if (latestInputMatch) latestDirectIds.add(entry.id)
        direct.push({
            entry,
            reason: match.reason,
            score: settings.directMatchScore + (latestInputMatch ? 1 : 0),
            lane: 'context',
        })
        directCandidateIds.add(entry.id)
        directSeedIds.add(entry.id)
    }
    for (const anchor of plan.anchors) directSeedIds.add(anchor.entryId)

    const queryTerms = terms(query, settings.minimumTermLength)
    const searchable = new Map(eligible.map((entry) => [
        entry.id,
        searchableFields(entry, settings.minimumTermLength),
    ]))
    const documentFrequency = new Map<string, number>()
    for (const queryTerm of queryTerms) {
        documentFrequency.set(queryTerm, eligible.filter((entry) =>
            Object.values(searchable.get(entry.id)!).some((fieldTerms) =>
                hasTerm(fieldTerms, queryTerm, settings.cjkPartialMatching),
            ),
        ).length)
    }
    const sparse = [] as BardLoreSelection[]
    for (const entry of eligible) {
        if (selectedIds.has(entry.id) || directSeedIds.has(entry.id) || entry.bard.activation !== 'retrieve') continue
        if (!bardLoreEntrySatisfiesPlan(entry, plan, settings)) continue
        const fields = searchable.get(entry.id)!
        const score = queryTerms.reduce((sum, queryTerm) => {
            const frequency = documentFrequency.get(queryTerm) ?? 0
            const idf = Math.log((eligible.length + 1) / (frequency + 1)) + 1
            return sum + (Object.keys(settings.fieldWeights) as Array<keyof BardLoreSettings['fieldWeights']>)
                .reduce((fieldScore, field) =>
                    hasTerm(fields[field], queryTerm, settings.cjkPartialMatching)
                        ? fieldScore + idf * settings.fieldWeights[field]
                        : fieldScore,
                0)
        }, 0)
        if (score >= settings.minimumSparseScore && score > 0) sparse.push({ entry, reason: 'sparse', score, lane: 'context' })
    }

    const links = [] as BardLoreSelection[]
    const linkedIds = new Set(directSeedIds)
    let frontier = [...directSeedIds].map((id) => ({ id, path: [id] }))
    for (let depth = 1; depth <= settings.maxLinkDepth && frontier.length > 0; depth += 1) {
        const nextFrontier: Array<{ id: string; path: string[] }> = []
        for (const source of frontier) {
            const seed = byId.get(source.id)
            if (!seed) continue
            for (const link of seed.bard.links) {
                if (link.retrieval !== 'supporting' || selectedIds.has(link.targetId) || linkedIds.has(link.targetId)) continue
                const target = byId.get(link.targetId)
                if (!target) continue
                const path = [...source.path, target.id]
                linkedIds.add(target.id)
                links.push({
                    entry: target,
                    reason: 'link',
                    score: settings.linkScore * Math.pow(settings.linkScoreDecay, depth - 1),
                    lane: 'context',
                    path,
                })
                nextFrontier.push({ id: target.id, path })
            }
        }
        frontier = nextFrontier
    }

    const planned = plan.candidates.flatMap((candidate): BardLoreSelection[] => {
        if (directCandidateIds.has(candidate.entryId) && candidate.reason === 'entity') return []
        const entry = byId.get(candidate.entryId)
        if (!entry) return []
        return [{
            entry,
            reason: candidate.reason,
            score: candidate.score,
            lane: 'context',
            path: candidate.path,
        }]
    })
    const priority = (candidate: BardLoreSelection) => latestDirectIds.has(candidate.entry.id)
        ? 2
        : directCandidateIds.has(candidate.entry.id) || candidate.reason === 'entity' ? 1 : 0
    const candidates = [...direct, ...links, ...planned, ...sparse].sort((left, right) =>
        priority(right) - priority(left)
        || right.score - left.score
        || (order.get(left.entry.id) ?? 0) - (order.get(right.entry.id) ?? 0),
    )
    const candidateIds = new Set(candidates.map((candidate) => candidate.entry.id))
    const exclusionReasons = new Map<string, BardLoreExclusionReason>()
    for (let index = 0; index < candidates.length; index += 1) {
        const candidate = candidates[index]
        if (selectedIds.has(candidate.entry.id)) continue
        if (candidate.entry.bard.injection === 'index-only') {
            exclusionReasons.set(candidate.entry.id, 'routing-only')
            continue
        }
        const kindMismatch = plan.targetKinds.length > 0 && !plan.targetKinds.includes(candidate.entry.bard.kind)
        const isSceneAnchor = plan.intent === 'scene'
            && plan.anchors.some((anchor) => anchor.entryId === candidate.entry.id)
        const preserveDirectMatch = !explicitSelection && latestDirectIds.has(candidate.entry.id)
        if (kindMismatch && !isSceneAnchor && !preserveDirectMatch) {
            exclusionReasons.set(candidate.entry.id, 'kind-mismatch')
            continue
        }
        const constraintMismatch = !bardLoreEntrySatisfiesPlan(candidate.entry, {
            targetKinds: [],
            constraints: plan.constraints,
        }, settings)
        if (constraintMismatch && !isSceneAnchor && !preserveDirectMatch) {
            exclusionReasons.set(candidate.entry.id, 'constraint-mismatch')
            continue
        }
        const countsTowardRequest = plan.requestedCount !== undefined
            && (plan.targetKinds.length === 0 || plan.targetKinds.includes(candidate.entry.bard.kind))
        if (countsTowardRequest && requestedEntries >= plan.requestedCount!) {
            exclusionReasons.set(candidate.entry.id, 'requested-count')
            continue
        }
        if (contextualEntries >= settings.maxEntries || contextualTokens >= settings.targetTokens) {
            const reason: BardLoreExclusionReason = contextualEntries >= settings.maxEntries
                ? 'entry-limit'
                : 'target-reached'
            for (const remaining of candidates.slice(index)) {
                if (!selectedIds.has(remaining.entry.id) && !exclusionReasons.has(remaining.entry.id)) {
                    exclusionReasons.set(remaining.entry.id, reason)
                }
            }
            break
        }
        const nextTokens = tokenCount(candidate.entry, input.tokenCounts)
        if (totalTokens + nextTokens > settings.maximumTokens) {
            exclusionReasons.set(candidate.entry.id, 'token-limit')
            continue
        }
        selected.push(candidate)
        selectedIds.add(candidate.entry.id)
        contextualEntries += 1
        if (countsTowardRequest) requestedEntries += 1
        contextualTokens += nextTokens
        totalTokens += nextTokens
    }

    const eligibleIds = new Set(eligible.map((entry) => entry.id))
    const excluded = input.entries
        .filter((entry) => !selectedIds.has(entry.id))
        .map((entry): BardLoreExclusion => ({
            entry,
            reason: entry.bard.injection === 'index-only'
                ? 'routing-only'
                : !eligibleIds.has(entry.id)
                ? 'ineligible'
                : exclusionReasons.has(entry.id)
                ? exclusionReasons.get(entry.id)!
                : plan.targetKinds.length > 0 && !plan.targetKinds.includes(entry.bard.kind)
                ? 'kind-mismatch'
                : !bardLoreEntrySatisfiesPlan(entry, { targetKinds: [], constraints: plan.constraints }, settings)
                ? 'constraint-mismatch'
                : exclusionReasons.get(entry.id) ?? (candidateIds.has(entry.id) ? 'target-reached' : 'no-match'),
        }))

    return { selected, excluded, totalTokens, requiredTokens, contextualTokens, plan }
}
