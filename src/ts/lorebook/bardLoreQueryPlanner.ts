import type {
    BardLoreEntry,
    BardLoreFacet,
    BardLoreKind,
    BardLoreQueryIntent,
    BardLoreRelationRetrieval,
    BardLoreSettings,
} from './bardLore'
import { matchesLorebookKey } from '../process/lorebookMatching'

export interface BardLoreCompiledEdge {
    sourceId: string
    targetId: string
    relation: string
    retrieval: BardLoreRelationRetrieval
}

export interface BardLoreCompiledIndex {
    entries: BardLoreEntry[]
    byId: Map<string, BardLoreEntry>
    outgoing: Map<string, BardLoreCompiledEdge[]>
    incoming: Map<string, BardLoreCompiledEdge[]>
}

export interface BardLoreQueryAnchor {
    entryId: string
    phrase: string
}

export interface BardLoreFacetConstraint {
    key: string
    value: string
    phrase: string
}

export type BardLorePlannedReason = 'entity' | 'facet' | 'graph'

export interface BardLorePlannedCandidate {
    entryId: string
    reason: BardLorePlannedReason
    score: number
    path?: string[]
    relation?: string
    retrieval?: BardLoreRelationRetrieval
}

export interface BardLoreQueryPlan {
    query: string
    intent: BardLoreQueryIntent
    arbitrary: boolean
    requestedCount?: number
    targetKinds: BardLoreKind[]
    constraints: BardLoreFacetConstraint[]
    scopeMatches: string[]
    anchors: BardLoreQueryAnchor[]
    candidates: BardLorePlannedCandidate[]
}

function normalize(value: string): string {
    return value.normalize('NFKC').toLocaleLowerCase().trim()
}

function phrases(entry: BardLoreEntry): string[] {
    return [...new Set([
        entry.comment,
        ...entry.key.split(/[,\n]/u),
        ...entry.secondkey.split(/[,\n]/u),
        ...entry.bard.aliases,
    ].map((value) => value.trim()).filter(Boolean))]
}

interface PhraseRange {
    start: number
    end: number
}

function phraseRanges(query: string, phrase: string): PhraseRange[] {
    const candidate = normalize(phrase)
    if (!candidate) return []
    const normalizedQuery = normalize(query)
    const ranges: PhraseRange[] = []
    let offset = 0
    while (offset < normalizedQuery.length) {
        const start = normalizedQuery.indexOf(candidate, offset)
        if (start < 0) break
        const end = start + candidate.length
        const requiresBoundary = !/[\p{Script=Han}\p{Script=Hangul}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(candidate)
        const before = normalizedQuery[start - 1]
        const after = normalizedQuery[end]
        if (!requiresBoundary
            || ((!before || !/[\p{L}\p{N}_]/u.test(before)) && (!after || !/[\p{L}\p{N}_]/u.test(after)))) {
            ranges.push({ start, end })
        }
        offset = start + Math.max(candidate.length, 1)
    }
    return ranges
}

function includesPhrase(query: string, phrase: string): boolean {
    return phraseRanges(query, phrase).length > 0
}

// Filter vocabulary must match words, unlike permissive entity-name lookup.
// In particular, an imported alias "여" must not filter "여행" to women.
function includesFilterPhrase(query: string, phrase: string): boolean {
    return matchesLorebookKey(normalize(query), normalize(phrase), 'word-boundary')
}

function coveredByPhrase(query: string, phrase: string, coveringPhrases: string[], equalLength = false): boolean {
    const ranges = phraseRanges(query, phrase)
    if (ranges.length === 0) return false
    return ranges.every((range) => coveringPhrases.some((coveringPhrase) => {
        if (equalLength
            ? normalize(coveringPhrase).length < normalize(phrase).length
            : normalize(coveringPhrase).length <= normalize(phrase).length) return false
        return phraseRanges(query, coveringPhrase).some((coveringRange) =>
            coveringRange.start <= range.start && coveringRange.end >= range.end,
        )
    }))
}

function cleanEdges(edges: BardLoreCompiledEdge[]): BardLoreCompiledEdge[] {
    return [...new Map(edges.map((edge) => [
        `${edge.sourceId}\u0000${edge.targetId}\u0000${edge.relation}\u0000${edge.retrieval}`,
        edge,
    ])).values()].sort((left, right) =>
        left.sourceId.localeCompare(right.sourceId)
        || left.targetId.localeCompare(right.targetId)
        || left.relation.localeCompare(right.relation),
    )
}

export function compileBardLoreIndex(entries: BardLoreEntry[]): BardLoreCompiledIndex {
    const stableEntries = [...entries].sort((left, right) => left.id.localeCompare(right.id))
    const byId = new Map(stableEntries.map((entry) => [entry.id, entry]))
    const outgoing = new Map<string, BardLoreCompiledEdge[]>()
    const incoming = new Map<string, BardLoreCompiledEdge[]>()
    for (const entry of stableEntries) {
        for (const link of entry.bard.links) {
            if (!byId.has(link.targetId) || link.retrieval === 'none') continue
            const edge = {
                sourceId: entry.id,
                targetId: link.targetId,
                relation: link.relation,
                retrieval: link.retrieval,
            }
            outgoing.set(entry.id, [...outgoing.get(entry.id) ?? [], edge])
            incoming.set(link.targetId, [...incoming.get(link.targetId) ?? [], edge])
        }
    }
    for (const [id, edges] of outgoing) outgoing.set(id, cleanEdges(edges))
    for (const [id, edges] of incoming) incoming.set(id, cleanEdges(edges))
    return { entries: stableEntries, byId, outgoing, incoming }
}

function intentFor(query: string, settings: BardLoreSettings, hasLocationAnchor: boolean): BardLoreQueryIntent {
    const aliases = settings.router.intentAliases
    if (aliases.describe.some((phrase) => includesPhrase(query, phrase))) return 'describe'
    if (aliases.list.some((phrase) => includesPhrase(query, phrase))) return 'list'
    if (aliases.scene.some((phrase) => includesPhrase(query, phrase)) || hasLocationAnchor) return 'scene'
    return 'lookup'
}

const nativeCounts = new Map([
    ['한', 1], ['하나', 1], ['두', 2], ['둘', 2], ['세', 3], ['셋', 3], ['네', 4], ['넷', 4],
    ['다섯', 5], ['여섯', 6], ['일곱', 7], ['여덟', 8], ['아홉', 9], ['열', 10],
])

function requestedCount(query: string): number | undefined {
    const numeric = query.match(/(?:^|\s)(\d+)\s*(?:명|개|곳|항목)(?:\s|$|[을를에의])/u)
    if (numeric) return Number.parseInt(numeric[1], 10)
    for (const [word, count] of nativeCounts) {
        if (new RegExp(`(?:^|\\s)${word}\\s*(?:명|개|곳|항목)`, 'u').test(query)) return count
    }
    return undefined
}

function facetPhrases(facet: BardLoreFacet): string[] {
    return [...new Set([facet.value, ...facet.aliases].map((value) => value.trim()).filter(Boolean))]
}

function canonicalFacetValue(facet: Pick<BardLoreFacet, 'key' | 'value'>, settings: BardLoreSettings): string {
    const vocabulary = settings.router.facetVocabulary.find((candidate) =>
        normalize(candidate.key) === normalize(facet.key)
        && [candidate.value, ...candidate.aliases].some((value) => normalize(value) === normalize(facet.value)),
    )
    return normalize(vocabulary?.value ?? facet.value)
}

function satisfies(entry: BardLoreEntry, kinds: BardLoreKind[], constraints: BardLoreFacetConstraint[], settings: BardLoreSettings): boolean {
    if (kinds.length > 0 && !kinds.includes(entry.bard.kind)) return false
    const keys = [...new Set(constraints.map((constraint) => normalize(constraint.key)))]
    return keys.every((key) => constraints.filter((constraint) => normalize(constraint.key) === key)
        .some((constraint) => (entry.bard.facets ?? []).some((facet) =>
            normalize(facet.key) === key
            && canonicalFacetValue(facet, settings) === canonicalFacetValue(constraint, settings),
        )))
}

function graphCandidates(
    anchorIds: string[],
    index: BardLoreCompiledIndex,
    intent: BardLoreQueryIntent,
    targetKinds: BardLoreKind[],
    settings: BardLoreSettings,
): BardLorePlannedCandidate[] {
    const candidates = new Map<string, BardLorePlannedCandidate>()
    if (settings.maxLinkDepth <= 0) return []
    type Frontier = { anchorId: string; currentId: string; path: string[] }
    let frontier: Frontier[] = anchorIds.map((anchorId) => ({ anchorId, currentId: anchorId, path: [anchorId] }))
    const visited = new Set(frontier.map((item) => `${item.anchorId}\u0000${item.currentId}`))
    const consider = (source: Frontier, entryId: string, edge: BardLoreCompiledEdge, reverse: boolean, depth: number, next: Frontier[]) => {
        const entry = index.byId.get(entryId)
        if (!entry || source.path.includes(entryId)) return
        const discover = reverse && edge.retrieval === 'discoverable' && (targetKinds.length > 0 || intent === 'list' || intent === 'describe')
        const ambient = reverse && edge.retrieval === 'ambient' && intent === 'scene'
        const supporting = !reverse && edge.retrieval === 'supporting'
        if (!discover && !ambient && !supporting) return
        const path = [...source.path, entryId]
        const visitKey = `${source.anchorId}\u0000${entryId}`
        if (!visited.has(visitKey)) {
            visited.add(visitKey)
            next.push({ anchorId: source.anchorId, currentId: entryId, path })
        }
        if (targetKinds.length > 0 && !targetKinds.includes(entry.bard.kind)) return
        const score = settings.linkScore * Math.pow(settings.linkScoreDecay, depth - 1)
        const current = candidates.get(entryId)
        const candidate: BardLorePlannedCandidate = {
            entryId,
            reason: 'graph',
            score,
            path,
            relation: edge.relation,
            retrieval: edge.retrieval,
        }
        if (!current || candidate.score > current.score || (candidate.path?.join('\u0000') ?? '') < (current.path?.join('\u0000') ?? '')) {
            candidates.set(entryId, candidate)
        }
    }
    for (let depth = 1; depth <= settings.maxLinkDepth && frontier.length > 0; depth += 1) {
        const next: Frontier[] = []
        for (const source of frontier) {
            for (const edge of index.outgoing.get(source.currentId) ?? []) consider(source, edge.targetId, edge, false, depth, next)
            for (const edge of index.incoming.get(source.currentId) ?? []) consider(source, edge.sourceId, edge, true, depth, next)
        }
        frontier = next
    }
    return [...candidates.values()].sort((left, right) => right.score - left.score || left.entryId.localeCompare(right.entryId))
}

export function planBardLoreQuery(
    value: string,
    index: BardLoreCompiledIndex,
    settings: BardLoreSettings,
    scopeAliases: string[] = [],
    routingEvidence = '',
): BardLoreQueryPlan {
    const query = normalize(value)
    const anchorQuery = normalize([value, routingEvidence].filter(Boolean).join('\n'))
    const scopeMatches = scopeAliases
        .filter((phrase): phrase is string => typeof phrase === 'string' && includesPhrase(anchorQuery, phrase))
        .sort((left, right) => right.length - left.length)
    const targetKinds = (Object.keys(settings.router.kindAliases) as BardLoreKind[]).filter((kind) =>
        settings.router.kindAliases[kind].some((phrase) => includesFilterPhrase(query, phrase)),
    )
    const facetMatches: Array<BardLoreFacetConstraint & { constraintKey: string; phraseKey: string }> = []
    for (const entry of index.entries) {
        for (const facet of entry.bard.facets ?? []) {
            if (!settings.router.filterFacetKeys.some((key) => normalize(key) === normalize(facet.key))) continue
            const canonicalValue = canonicalFacetValue(facet, settings)
            const vocabulary = settings.router.facetVocabulary.find((candidate) =>
                normalize(candidate.key) === normalize(facet.key)
                && normalize(candidate.value) === canonicalValue,
            )
            const candidates = [...facetPhrases(facet), ...vocabulary ? facetPhrases(vocabulary) : []]
            for (const phrase of candidates.filter((candidate) =>
                includesFilterPhrase(query, candidate) && !coveredByPhrase(query, candidate, scopeMatches, true),
            )) {
                facetMatches.push({
                    key: facet.key,
                    value: vocabulary?.value ?? facet.value,
                    phrase,
                    constraintKey: `${normalize(facet.key)}\u0000${normalize(vocabulary?.value ?? facet.value)}`,
                    phraseKey: normalize(phrase),
                })
            }
        }
    }
    for (const facet of settings.router.facetVocabulary) {
        if (!settings.router.filterFacetKeys.some((key) => normalize(key) === normalize(facet.key))) continue
        for (const phrase of facetPhrases(facet).filter((candidate) =>
            includesFilterPhrase(query, candidate) && !coveredByPhrase(query, candidate, scopeMatches, true),
        )) {
            facetMatches.push({
                key: facet.key,
                value: facet.value,
                phrase,
                constraintKey: `${normalize(facet.key)}\u0000${normalize(facet.value)}`,
                phraseKey: normalize(phrase),
            })
        }
    }
    const valuesByPhrase = new Map<string, Set<string>>()
    for (const match of facetMatches) {
        const values = valuesByPhrase.get(match.phraseKey) ?? new Set<string>()
        values.add(match.constraintKey)
        valuesByPhrase.set(match.phraseKey, values)
    }
    const constraintMap = new Map<string, BardLoreFacetConstraint>()
    for (const match of facetMatches.sort((left, right) => right.phrase.length - left.phrase.length)) {
        if (valuesByPhrase.get(match.phraseKey)?.size !== 1 || constraintMap.has(match.constraintKey)) continue
        constraintMap.set(match.constraintKey, { key: match.key, value: match.value, phrase: match.phrase })
    }
    const constraints = [...constraintMap.values()].sort((left, right) =>
        (phraseRanges(query, left.phrase)[0]?.start ?? Number.MAX_SAFE_INTEGER)
        - (phraseRanges(query, right.phrase)[0]?.start ?? Number.MAX_SAFE_INTEGER)
        || right.phrase.length - left.phrase.length
        || left.key.localeCompare(right.key)
        || left.value.localeCompare(right.value),
    )
    const anchors: BardLoreQueryAnchor[] = []
    const constraintPhrases = constraints.map((constraint) => constraint.phrase)
    for (const entry of index.entries) {
        const matches = phrases(entry)
            .filter((phrase) => includesPhrase(anchorQuery, phrase)
                && !coveredByPhrase(anchorQuery, phrase, constraintPhrases)
                && !coveredByPhrase(anchorQuery, phrase, scopeMatches, true))
            .sort((left, right) => right.length - left.length)
        if (matches[0]) anchors.push({ entryId: entry.id, phrase: matches[0] })
    }
    const hasLocationAnchor = anchors.some((anchor) => index.byId.get(anchor.entryId)?.bard.kind === 'location')
    const intent = intentFor(query, settings, hasLocationAnchor)
    const arbitrary = settings.router.intentAliases.arbitrary.some((phrase) => includesPhrase(query, phrase))
    const count = requestedCount(query)
    const candidateMap = new Map<string, BardLorePlannedCandidate>()
    for (const anchor of anchors) {
        candidateMap.set(anchor.entryId, { entryId: anchor.entryId, reason: 'entity', score: settings.directMatchScore })
    }
    const shouldEnumerate = arbitrary || count !== undefined || intent === 'list' || intent === 'describe'
    const facetCandidates = shouldEnumerate && (constraints.length > 0 || targetKinds.length > 0)
        ? index.entries.filter((entry) =>
            entry.bard.injection !== 'index-only'
            && satisfies(entry, targetKinds, constraints, settings)
            && !candidateMap.has(entry.id),
        )
        : []
    const facetLimit = count ?? settings.router.defaultResultCount
    for (const entry of facetCandidates.slice(0, facetLimit)) {
        candidateMap.set(entry.id, { entryId: entry.id, reason: 'facet', score: settings.directMatchScore * 0.75 })
    }
    const graph = graphCandidates(anchors.map((anchor) => anchor.entryId), index, intent, targetKinds, settings)
    const graphLimit = intent === 'scene' ? settings.router.ambientResultCount : count ?? settings.router.defaultResultCount
    for (const candidate of graph.slice(0, graphLimit)) {
        if (!candidateMap.has(candidate.entryId)) candidateMap.set(candidate.entryId, candidate)
    }
    const candidates = [...candidateMap.values()].sort((left, right) =>
        right.score - left.score || left.entryId.localeCompare(right.entryId),
    )
    return {
        query: value,
        intent,
        arbitrary,
        requestedCount: count,
        targetKinds,
        constraints,
        scopeMatches,
        anchors,
        candidates,
    }
}

export function bardLoreEntrySatisfiesPlan(
    entry: BardLoreEntry,
    plan: Pick<BardLoreQueryPlan, 'targetKinds' | 'constraints'>,
    settings: BardLoreSettings,
): boolean {
    return satisfies(entry, plan.targetKinds, plan.constraints, settings)
}
