import type { loreBook } from '../storage/database.svelte'
import { safeStructuredClone } from '../polyfill'
import type { ResolvedBardLoreAnalysisLanguage } from './bardLoreLanguage'
import type { BardLoreInstructionPreset } from './bardLoreInstructionPreset'

export type BardLoreActivation = 'required' | 'keyed' | 'retrieve' | 'never'
export type BardLoreKind = 'system' | 'character' | 'location' | 'faction' | 'item' | 'event' | 'concept' | 'other'
export type BardLoreRelationRetrieval = 'supporting' | 'discoverable' | 'ambient' | 'none'
export type BardLoreInjection = 'full' | 'index-only'
export type BardLoreQueryIntent = 'lookup' | 'scene' | 'list' | 'describe'

export interface BardLoreFacet {
    key: string
    value: string
    aliases: string[]
}

export interface BardLoreLink {
    targetId: string
    relation: string
    retrieval: BardLoreRelationRetrieval
}

export interface BardLoreMetadata {
    sourceLegacyId: string
    sourceHash: string
    derivedFromId?: string
    kind: BardLoreKind
    activation: BardLoreActivation
    aliases: string[]
    tags: string[]
    summary: string
    facets: BardLoreFacet[]
    injection: BardLoreInjection
    links: BardLoreLink[]
}

export interface BardLoreEntry extends loreBook {
    id: string
    bard: BardLoreMetadata
}

export type BardLoreAnalysisScope = 'entry' | 'connected' | 'characters' | 'all'

export interface BardLoreAnalysisCandidate {
    id: string
    sourceHash: string
    kind: BardLoreKind
    activation?: Exclude<BardLoreActivation, 'never'>
    aliases: string[]
    tags: string[]
    summary: string
    facets?: BardLoreFacet[]
    injection?: BardLoreInjection
    links: BardLoreLink[]
    atoms?: BardLoreAtomCandidate[]
}

export interface BardLoreAtomCandidate {
    name: string
    content: string
    existingTargetId?: string
    existingTargetHash?: string
    kind: BardLoreKind
    aliases: string[]
    tags: string[]
    summary: string
    facets: BardLoreFacet[]
    links: BardLoreLink[]
}

export interface BardLoreRouterSettings {
    defaultResultCount: number
    ambientResultCount: number
    kindAliases: Record<BardLoreKind, string[]>
    intentAliases: Record<'scene' | 'list' | 'describe' | 'arbitrary', string[]>
    filterFacetKeys: string[]
    facetVocabulary: BardLoreFacet[]
}

export interface BardLoreAnalysisBatch {
    id: string
    index: number
    targetIds: string[]
    estimatedInputTokens: number
    status: 'pending' | 'running' | 'complete' | 'failed'
    candidates?: BardLoreAnalysisCandidate[]
    error?: string
}

export interface BardLoreAnalysisRun {
    schemaVersion: 1
    id: string
    scope: BardLoreAnalysisScope
    targetIds: string[]
    createdAt: string
    updatedAt: string
    status: 'running' | 'paused' | 'review' | 'failed'
    settingsSnapshot: BardLoreSettings
    languageSnapshot?: ResolvedBardLoreAnalysisLanguage
    instructionPresetSnapshot?: BardLoreInstructionPreset
    batches: BardLoreAnalysisBatch[]
    overwriteExisting: boolean
    replaceLinks?: boolean
}

export interface BardLoreSettings {
    targetTokens: number
    maximumTokens: number
    maxEntries: number
    contextMessages: number
    maxLinkDepth: number
    minimumSparseScore: number
    directMatchScore: number
    linkScore: number
    linkScoreDecay: number
    minimumTermLength: number
    cjkPartialMatching: boolean
    fieldWeights: {
        name: number
        keys: number
        aliases: number
        tags: number
        facets: number
        summary: number
        content: number
    }
    router: BardLoreRouterSettings
    analysisBatchEntries: number
    analysisInputTokens: number
    analysisOutputTokens: number
    analysisLinkedDepth: number
    analysisTemperature: number
}

export interface BardLoreState {
    schemaVersion: 2
    mode: 'legacy' | 'bard'
    metadata: BardLoreMetadata[]
    derivedEntries: BardLoreEntry[]
    settings: BardLoreSettings
    analysisRun?: BardLoreAnalysisRun
}

interface CopiedBardLoreState {
    schemaVersion: 1
    mode: 'legacy' | 'bard'
    entries: BardLoreEntry[]
    settings: BardLoreSettings
    analysisRun?: BardLoreAnalysisRun
}

const bardLoreActivations = new Set<BardLoreActivation>(['required', 'keyed', 'retrieve', 'never'])
const bardLoreKinds = new Set<BardLoreKind>(['system', 'character', 'location', 'faction', 'item', 'event', 'concept', 'other'])

export const bardLoreDefaultPreset: Readonly<BardLoreSettings> = {
    targetTokens: 4_000,
    maximumTokens: 8_000,
    maxEntries: 12,
    contextMessages: 3,
    maxLinkDepth: 1,
    minimumSparseScore: 1,
    directMatchScore: 10_000,
    linkScore: 5_000,
    linkScoreDecay: 0.5,
    minimumTermLength: 2,
    cjkPartialMatching: true,
    fieldWeights: {
        name: 2,
        keys: 3,
        aliases: 3,
        tags: 2,
        facets: 2,
        summary: 1.5,
        content: 1,
    },
    router: {
        defaultResultCount: 3,
        ambientResultCount: 2,
        kindAliases: {
            system: ['시스템', 'system'],
            character: ['캐릭터', '인물', '등장인물', 'character'],
            location: ['장소', '지역', 'location', 'place'],
            faction: ['세력', '조직', 'faction', 'organization'],
            item: ['아이템', '물건', 'item'],
            event: ['사건', '이벤트', 'event'],
            concept: ['개념', 'concept'],
            other: ['기타', 'other'],
        },
        intentAliases: {
            scene: ['갔다', '간다', '도착', '이동', 'go', 'arrive'],
            list: ['누구', '목록', '나열', 'who', 'list'],
            describe: ['설명', '소개', 'describe', 'explain'],
            arbitrary: ['아무나', '임의', '무작위', 'any', 'random'],
        },
        filterFacetKeys: ['work', 'gender'],
        facetVocabulary: [
            { key: 'gender', value: 'male', aliases: ['남자', '남성', 'male', 'man', 'boy'] },
            { key: 'gender', value: 'female', aliases: ['여자', '여성', 'female', 'woman', 'girl'] },
        ],
    },
    analysisBatchEntries: 20,
    analysisInputTokens: 12_000,
    analysisOutputTokens: 4_000,
    analysisLinkedDepth: 1,
    analysisTemperature: 0.2,
}

export type BardLoreRouterSettingsInput = Partial<Omit<BardLoreRouterSettings, 'kindAliases' | 'intentAliases' | 'filterFacetKeys' | 'facetVocabulary'>> & {
    kindAliases?: Partial<Record<BardLoreKind, string[]>>
    intentAliases?: Partial<Record<'scene' | 'list' | 'describe' | 'arbitrary', string[]>>
    filterFacetKeys?: string[]
    facetVocabulary?: BardLoreFacet[]
}

export type BardLoreSettingsInput = Partial<Omit<BardLoreSettings, 'fieldWeights' | 'router'>> & {
    fieldWeights?: Partial<BardLoreSettings['fieldWeights']>
    router?: BardLoreRouterSettingsInput
}

const nonNegative = (value: unknown, fallback: number): number =>
    typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : fallback

const nonNegativeInteger = (value: unknown, fallback: number): number =>
    Math.floor(nonNegative(value, fallback))

const cleanStrings = (values: string[]): string[] =>
    [...new Set(values.map((value) => value.trim()).filter(Boolean))]

const kindKeys: BardLoreKind[] = ['system', 'character', 'location', 'faction', 'item', 'event', 'concept', 'other']
const intentKeys: Array<keyof BardLoreRouterSettings['intentAliases']> = ['scene', 'list', 'describe', 'arbitrary']

function normalizeRouterSettings(input: BardLoreRouterSettingsInput | undefined): BardLoreRouterSettings {
    const defaults = bardLoreDefaultPreset.router
    return {
        defaultResultCount: nonNegativeInteger(input?.defaultResultCount, defaults.defaultResultCount),
        ambientResultCount: nonNegativeInteger(input?.ambientResultCount, defaults.ambientResultCount),
        kindAliases: Object.fromEntries(kindKeys.map((kind) => [
            kind,
            cleanStrings(input?.kindAliases?.[kind] ?? defaults.kindAliases[kind]),
        ])) as Record<BardLoreKind, string[]>,
        intentAliases: Object.fromEntries(intentKeys.map((intent) => [
            intent,
            cleanStrings(input?.intentAliases?.[intent] ?? defaults.intentAliases[intent]),
        ])) as BardLoreRouterSettings['intentAliases'],
        filterFacetKeys: cleanStrings(input?.filterFacetKeys ?? defaults.filterFacetKeys),
        facetVocabulary: (input?.facetVocabulary ?? defaults.facetVocabulary).flatMap((facet) => {
            const key = facet.key.trim()
            const value = facet.value.trim()
            return key && value ? [{ key, value, aliases: cleanStrings(facet.aliases) }] : []
        }),
    }
}

export function createBardLoreSettings(input: BardLoreSettingsInput = {}): BardLoreSettings {
    const defaults = bardLoreDefaultPreset
    return {
        targetTokens: nonNegativeInteger(input.targetTokens, defaults.targetTokens),
        maximumTokens: nonNegativeInteger(input.maximumTokens, defaults.maximumTokens),
        maxEntries: nonNegativeInteger(input.maxEntries, defaults.maxEntries),
        contextMessages: nonNegativeInteger(input.contextMessages, defaults.contextMessages),
        maxLinkDepth: nonNegativeInteger(input.maxLinkDepth, defaults.maxLinkDepth),
        minimumSparseScore: nonNegative(input.minimumSparseScore, defaults.minimumSparseScore),
        directMatchScore: nonNegative(input.directMatchScore, defaults.directMatchScore),
        linkScore: nonNegative(input.linkScore, defaults.linkScore),
        linkScoreDecay: nonNegative(input.linkScoreDecay, defaults.linkScoreDecay),
        minimumTermLength: nonNegativeInteger(input.minimumTermLength, defaults.minimumTermLength),
        cjkPartialMatching: input.cjkPartialMatching ?? defaults.cjkPartialMatching,
        fieldWeights: {
            name: nonNegative(input.fieldWeights?.name, defaults.fieldWeights.name),
            keys: nonNegative(input.fieldWeights?.keys, defaults.fieldWeights.keys),
            aliases: nonNegative(input.fieldWeights?.aliases, defaults.fieldWeights.aliases),
            tags: nonNegative(input.fieldWeights?.tags, defaults.fieldWeights.tags),
            facets: nonNegative(input.fieldWeights?.facets, defaults.fieldWeights.facets),
            summary: nonNegative(input.fieldWeights?.summary, defaults.fieldWeights.summary),
            content: nonNegative(input.fieldWeights?.content, defaults.fieldWeights.content),
        },
        router: normalizeRouterSettings(input.router),
        analysisBatchEntries: nonNegativeInteger(input.analysisBatchEntries, defaults.analysisBatchEntries),
        analysisInputTokens: nonNegativeInteger(input.analysisInputTokens, defaults.analysisInputTokens),
        analysisOutputTokens: nonNegativeInteger(input.analysisOutputTokens, defaults.analysisOutputTokens),
        analysisLinkedDepth: nonNegativeInteger(input.analysisLinkedDepth, defaults.analysisLinkedDepth),
        analysisTemperature: nonNegative(input.analysisTemperature, defaults.analysisTemperature),
    }
}

function normalizeCopiedBardLoreState(value: unknown): CopiedBardLoreState | undefined {
    if (!value || typeof value !== 'object') return undefined
    const raw = value as Record<string, unknown>
    if (raw.schemaVersion !== 1 || (raw.mode !== 'legacy' && raw.mode !== 'bard') || !Array.isArray(raw.entries)) {
        return undefined
    }
    const entries: BardLoreEntry[] = []
    const entryIds = new Set<string>()
    for (const candidate of raw.entries) {
        if (!candidate || typeof candidate !== 'object') return undefined
        const entry = candidate as Record<string, unknown>
        const metadata = entry.bard
        if (
            typeof entry.id !== 'string'
            || typeof entry.key !== 'string'
            || typeof entry.secondkey !== 'string'
            || typeof entry.comment !== 'string'
            || typeof entry.content !== 'string'
            || typeof entry.insertorder !== 'number'
            || typeof entry.mode !== 'string'
            || typeof entry.alwaysActive !== 'boolean'
            || typeof entry.selective !== 'boolean'
            || !metadata
            || typeof metadata !== 'object'
        ) return undefined
        if (entryIds.has(entry.id as string)) return undefined
        entryIds.add(entry.id as string)
        const bard = metadata as Record<string, unknown>
        if (
            typeof bard.sourceLegacyId !== 'string'
            || typeof bard.sourceHash !== 'string'
            || (bard.derivedFromId !== undefined && typeof bard.derivedFromId !== 'string')
            || !bardLoreKinds.has(bard.kind as BardLoreKind)
            || !bardLoreActivations.has(bard.activation as BardLoreActivation)
            || !Array.isArray(bard.aliases)
            || !bard.aliases.every((item) => typeof item === 'string')
            || !Array.isArray(bard.tags)
            || !bard.tags.every((item) => typeof item === 'string')
            || typeof bard.summary !== 'string'
            || !Array.isArray(bard.links)
        ) return undefined
        const facets: BardLoreFacet[] = []
        if (bard.facets !== undefined) {
            if (!Array.isArray(bard.facets)) return undefined
            for (const candidateFacet of bard.facets) {
                if (!candidateFacet || typeof candidateFacet !== 'object') return undefined
                const facet = candidateFacet as Record<string, unknown>
                if (
                    typeof facet.key !== 'string'
                    || typeof facet.value !== 'string'
                    || !Array.isArray(facet.aliases)
                    || !facet.aliases.every((item) => typeof item === 'string')
                ) return undefined
                const key = facet.key.trim()
                const value = facet.value.trim()
                if (!key || !value) continue
                facets.push({ key, value, aliases: cleanStrings(facet.aliases as string[]) })
            }
        }
        const injection: BardLoreInjection = bard.injection === undefined
            ? 'full'
            : bard.injection === 'full' || bard.injection === 'index-only'
                ? bard.injection
                : undefined as never
        if (!injection) return undefined
        const links: BardLoreLink[] = []
        for (const candidateLink of bard.links) {
            if (!candidateLink || typeof candidateLink !== 'object') return undefined
            const link = candidateLink as Record<string, unknown>
            if (
                typeof link.targetId !== 'string'
                || typeof link.relation !== 'string'
                || !['supporting', 'discoverable', 'ambient', 'none'].includes(link.retrieval as string)
            ) return undefined
            links.push({
                targetId: link.targetId,
                relation: link.relation.trim(),
                retrieval: link.retrieval as BardLoreRelationRetrieval,
            })
        }
        entries.push({
            ...safeStructuredClone(entry),
            bard: {
                ...safeStructuredClone(bard),
                aliases: cleanStrings(bard.aliases as string[]),
                tags: cleanStrings(bard.tags as string[]),
                facets,
                injection,
                links,
            },
        } as unknown as BardLoreEntry)
    }
    const normalized: CopiedBardLoreState = {
        schemaVersion: 1,
        mode: raw.mode,
        entries,
        settings: createBardLoreSettings(
            raw.settings && typeof raw.settings === 'object'
                ? raw.settings as BardLoreSettingsInput
                : {},
        ),
    }
    const analysisRun = normalizeBardLoreAnalysisRun(raw.analysisRun, entryIds)
    if (analysisRun) normalized.analysisRun = analysisRun
    return normalized
}

function copiedStateToOverlay(state: CopiedBardLoreState): BardLoreState | undefined {
    const metadata: BardLoreMetadata[] = []
    const derivedEntries: BardLoreEntry[] = []
    for (const entry of state.entries) {
        if (entry.bard.derivedFromId) derivedEntries.push(entry)
        else metadata.push(safeStructuredClone(entry.bard))
    }
    if (metadata.some((item) => item.derivedFromId)) return undefined
    return {
        schemaVersion: 2,
        mode: state.mode,
        metadata,
        derivedEntries,
        settings: state.settings,
        ...(state.analysisRun ? { analysisRun: state.analysisRun } : {}),
    }
}

export function normalizeBardLoreState(value: unknown): BardLoreState | undefined {
    if (!value || typeof value !== 'object') return undefined
    const raw = value as Record<string, unknown>
    if (raw.schemaVersion === 1) {
        const copied = normalizeCopiedBardLoreState(value)
        return copied ? copiedStateToOverlay(copied) : undefined
    }
    if (
        raw.schemaVersion !== 2
        || (raw.mode !== 'legacy' && raw.mode !== 'bard')
        || !Array.isArray(raw.metadata)
        || !Array.isArray(raw.derivedEntries)
    ) return undefined

    const syntheticEntries = [
        ...raw.metadata.map((metadata) => ({
            id: metadata && typeof metadata === 'object'
                ? (metadata as Record<string, unknown>).sourceLegacyId
                : undefined,
            key: '',
            secondkey: '',
            insertorder: 0,
            comment: '',
            content: '',
            mode: 'normal',
            alwaysActive: false,
            selective: false,
            bard: metadata,
        })),
        ...raw.derivedEntries,
    ]
    const copied = normalizeCopiedBardLoreState({
        schemaVersion: 1,
        mode: raw.mode,
        entries: syntheticEntries,
        settings: raw.settings,
        analysisRun: raw.analysisRun,
    })
    if (!copied || copied.entries.slice(0, raw.metadata.length).some((entry) => entry.bard.derivedFromId)) {
        return undefined
    }
    return copiedStateToOverlay(copied)
}

function normalizeBardLoreAnalysisRun(
    value: unknown,
    validEntryIds: Set<string>,
): BardLoreAnalysisRun | undefined {
    if (!value || typeof value !== 'object') return undefined
    const raw = value as Record<string, unknown>
    const scopes = new Set<BardLoreAnalysisScope>(['entry', 'connected', 'characters', 'all'])
    const statuses = new Set(['running', 'paused', 'review', 'failed'])
    if (
        raw.schemaVersion !== 1
        || typeof raw.id !== 'string'
        || !scopes.has(raw.scope as BardLoreAnalysisScope)
        || !Array.isArray(raw.targetIds)
        || !raw.targetIds.every((id) => typeof id === 'string' && validEntryIds.has(id))
        || typeof raw.createdAt !== 'string'
        || typeof raw.updatedAt !== 'string'
        || !statuses.has(raw.status as string)
        || !Array.isArray(raw.batches)
    ) return undefined

    const batches: BardLoreAnalysisBatch[] = []
    for (const valueBatch of raw.batches) {
        if (!valueBatch || typeof valueBatch !== 'object') return undefined
        const batch = valueBatch as Record<string, unknown>
        if (
            typeof batch.id !== 'string'
            || typeof batch.index !== 'number'
            || !Number.isFinite(batch.index)
            || !Array.isArray(batch.targetIds)
            || !batch.targetIds.every((id) => typeof id === 'string' && validEntryIds.has(id))
            || typeof batch.estimatedInputTokens !== 'number'
            || !Number.isFinite(batch.estimatedInputTokens)
            || !['pending', 'running', 'complete', 'failed'].includes(batch.status as string)
            || (batch.error !== undefined && typeof batch.error !== 'string')
        ) return undefined
        let candidates: BardLoreAnalysisCandidate[] | undefined
        if (batch.candidates !== undefined) {
            if (!Array.isArray(batch.candidates)) return undefined
            candidates = []
            for (const valueCandidate of batch.candidates) {
                if (!valueCandidate || typeof valueCandidate !== 'object') return undefined
                const candidate = valueCandidate as Record<string, unknown>
                if (
                    typeof candidate.id !== 'string'
                    || !batch.targetIds.includes(candidate.id)
                    || typeof candidate.sourceHash !== 'string'
                    || !bardLoreKinds.has(candidate.kind as BardLoreKind)
                    || (candidate.activation !== undefined && !['required', 'keyed', 'retrieve'].includes(candidate.activation as string))
                    || !Array.isArray(candidate.aliases)
                    || !candidate.aliases.every((item) => typeof item === 'string')
                    || !Array.isArray(candidate.tags)
                    || !candidate.tags.every((item) => typeof item === 'string')
                    || typeof candidate.summary !== 'string'
                    || (candidate.injection !== undefined && candidate.injection !== 'full' && candidate.injection !== 'index-only')
                    || !Array.isArray(candidate.links)
                ) return undefined
                const facets: BardLoreFacet[] = []
                if (candidate.facets !== undefined) {
                    if (!Array.isArray(candidate.facets)) return undefined
                    for (const valueFacet of candidate.facets) {
                        if (!valueFacet || typeof valueFacet !== 'object') return undefined
                        const facet = valueFacet as Record<string, unknown>
                        if (
                            typeof facet.key !== 'string'
                            || typeof facet.value !== 'string'
                            || !Array.isArray(facet.aliases)
                            || !facet.aliases.every((item) => typeof item === 'string')
                        ) return undefined
                        const key = facet.key.trim()
                        const value = facet.value.trim()
                        if (key && value) facets.push({ key, value, aliases: cleanStrings(facet.aliases as string[]) })
                    }
                }
                const links: BardLoreLink[] = []
                for (const valueLink of candidate.links) {
                    if (!valueLink || typeof valueLink !== 'object') return undefined
                    const link = valueLink as Record<string, unknown>
                    if (
                        typeof link.targetId !== 'string'
                        || !validEntryIds.has(link.targetId)
                        || typeof link.relation !== 'string'
                        || !['supporting', 'discoverable', 'ambient', 'none'].includes(link.retrieval as string)
                    ) return undefined
                    links.push(link as unknown as BardLoreLink)
                }
                        const atoms: BardLoreAtomCandidate[] = []
                if (candidate.atoms !== undefined) {
                    if (!Array.isArray(candidate.atoms)) return undefined
                    for (const valueAtom of candidate.atoms) {
                        if (!valueAtom || typeof valueAtom !== 'object') return undefined
                        const atom = valueAtom as Record<string, unknown>
                        if (
                            typeof atom.name !== 'string'
                            || typeof atom.content !== 'string'
                            || !bardLoreKinds.has(atom.kind as BardLoreKind)
                            || !Array.isArray(atom.aliases)
                            || !atom.aliases.every((item) => typeof item === 'string')
                            || !Array.isArray(atom.tags)
                            || !atom.tags.every((item) => typeof item === 'string')
                            || typeof atom.summary !== 'string'
                            || !Array.isArray(atom.facets)
                            || !Array.isArray(atom.links)
                        ) return undefined
                        const atomFacets: BardLoreFacet[] = []
                        for (const valueFacet of atom.facets) {
                            if (!valueFacet || typeof valueFacet !== 'object') return undefined
                            const facet = valueFacet as Record<string, unknown>
                            if (typeof facet.key !== 'string' || typeof facet.value !== 'string' || !Array.isArray(facet.aliases) || !facet.aliases.every((item) => typeof item === 'string')) return undefined
                            if (facet.key.trim() && facet.value.trim()) atomFacets.push({ key: facet.key.trim(), value: facet.value.trim(), aliases: cleanStrings(facet.aliases as string[]) })
                        }
                        const atomLinks: BardLoreLink[] = []
                        for (const valueLink of atom.links) {
                            if (!valueLink || typeof valueLink !== 'object') return undefined
                            const link = valueLink as Record<string, unknown>
                            if (typeof link.targetId !== 'string' || !validEntryIds.has(link.targetId) || typeof link.relation !== 'string' || !['supporting', 'discoverable', 'ambient', 'none'].includes(link.retrieval as string)) return undefined
                            atomLinks.push(link as unknown as BardLoreLink)
                        }
                            atoms.push({
                                name: atom.name,
                                content: atom.content,
                                existingTargetId: typeof atom.existingTargetId === 'string' ? atom.existingTargetId : undefined,
                                existingTargetHash: typeof atom.existingTargetHash === 'string' ? atom.existingTargetHash : undefined,
                                kind: atom.kind as BardLoreKind,
                            aliases: cleanStrings(atom.aliases as string[]),
                            tags: cleanStrings(atom.tags as string[]),
                            summary: atom.summary,
                            facets: atomFacets,
                            links: atomLinks,
                        })
                    }
                }
                candidates.push({
                    id: candidate.id,
                    sourceHash: candidate.sourceHash,
                    kind: candidate.kind as BardLoreKind,
                    activation: candidate.activation as Exclude<BardLoreActivation, 'never'> | undefined,
                    aliases: cleanStrings(candidate.aliases as string[]),
                    tags: cleanStrings(candidate.tags as string[]),
                    summary: candidate.summary,
                    facets,
                    injection: (candidate.injection ?? 'full') as BardLoreInjection,
                    links,
                    atoms,
                })
            }
        }
        batches.push({
            id: batch.id,
            index: Math.max(0, Math.floor(batch.index)),
            targetIds: [...new Set(batch.targetIds as string[])],
            estimatedInputTokens: Math.max(0, Math.floor(batch.estimatedInputTokens)),
            status: batch.status === 'running' ? 'pending' : batch.status as BardLoreAnalysisBatch['status'],
            ...(candidates ? { candidates } : {}),
            ...(batch.error ? { error: batch.error as string } : {}),
        })
    }
    const instructionPreset = raw.instructionPresetSnapshot as Partial<BardLoreInstructionPreset> | undefined
    const instructionPresetSnapshot = instructionPreset
        && instructionPreset.schemaVersion === 1
        && typeof instructionPreset.id === 'string'
        && typeof instructionPreset.name === 'string'
        && typeof instructionPreset.revision === 'number'
        && Number.isInteger(instructionPreset.revision)
        && typeof instructionPreset.builtin === 'boolean'
        && typeof instructionPreset.content === 'string'
        ? safeStructuredClone(instructionPreset as BardLoreInstructionPreset)
        : undefined
    return {
        schemaVersion: 1,
        id: raw.id,
        scope: raw.scope as BardLoreAnalysisScope,
        targetIds: [...new Set(raw.targetIds as string[])],
        createdAt: raw.createdAt,
        updatedAt: raw.updatedAt,
        status: raw.status === 'running' ? 'paused' : raw.status as BardLoreAnalysisRun['status'],
        settingsSnapshot: createBardLoreSettings(
            raw.settingsSnapshot && typeof raw.settingsSnapshot === 'object'
                ? raw.settingsSnapshot as BardLoreSettingsInput
                : {},
        ),
        ...(raw.languageSnapshot === 'en'
            || raw.languageSnapshot === 'ko'
            || raw.languageSnapshot === 'bilingual'
            ? { languageSnapshot: raw.languageSnapshot }
            : {}),
        ...(instructionPresetSnapshot ? { instructionPresetSnapshot } : {}),
        batches,
        overwriteExisting: raw.overwriteExisting === true,
        ...(typeof raw.replaceLinks === 'boolean' ? { replaceLinks: raw.replaceLinks } : {}),
    }
}

function stableStringify(value: unknown): string {
    if (value === null || typeof value !== 'object') return JSON.stringify(value)
    if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']'

    const record = value as Record<string, unknown>
    return '{' + Object.keys(record).sort().map((key) => JSON.stringify(key) + ':' + stableStringify(record[key])).join(',') + '}'
}

export function fingerprintLegacyLore(entry: loreBook): string {
    const source = {
        key: entry.key,
        secondkey: entry.secondkey,
        insertorder: entry.insertorder,
        comment: entry.comment,
        content: entry.content,
        mode: entry.mode,
        alwaysActive: entry.alwaysActive,
        selective: entry.selective,
        enabled: entry.enabled,
        extentions: entry.extentions,
        activationPercent: entry.activationPercent,
        useRegex: entry.useRegex,
        bookVersion: entry.bookVersion,
        folder: entry.folder,
    }
    return fingerprintValue(source)
}

function fingerprintValue(value: unknown): string {
    const text = stableStringify(value)
    let hash = 0x811c9dc5
    for (let index = 0; index < text.length; index += 1) {
        hash ^= text.charCodeAt(index)
        hash = Math.imul(hash, 0x01000193)
    }
    return 'fnv1a-' + (hash >>> 0).toString(16).padStart(8, '0')
}

export function fingerprintBardLoreEntry(entry: BardLoreEntry): string {
    return fingerprintValue({
        source: fingerprintLegacyLore(entry),
        metadata: entry.bard,
    })
}

function splitAliases(...values: string[]): string[] {
    return [...new Set(values.flatMap((value) => value.split(/[,\n]/u)).map((value) => value.trim()).filter(Boolean))]
}

function activationFor(entry: loreBook): BardLoreActivation {
    if (entry.enabled === false || entry.mode === 'folder' || entry.mode === 'child') return 'never'
    return splitAliases(entry.key, entry.secondkey).length > 0 ? 'keyed' : 'retrieve'
}

export function createBardLoreEntry(entry: loreBook): BardLoreEntry {
    if (!entry.id?.trim()) throw new Error('Grimoire entries require a stable ID.')
    const id = entry.id.trim()
    return {
        ...safeStructuredClone(entry),
        id,
        bard: {
            sourceLegacyId: id,
            sourceHash: fingerprintLegacyLore(entry),
            kind: 'other',
            activation: activationFor(entry),
            aliases: splitAliases(entry.key, entry.secondkey),
            tags: [],
            summary: '',
            facets: [],
            injection: 'full',
            links: [],
        },
    }
}

function withoutBardMetadata(entry: BardLoreEntry): loreBook {
    const legacy = safeStructuredClone(entry) as BardLoreEntry & { bard?: BardLoreMetadata }
    delete legacy.bard
    return legacy
}

function uniqueSourceId(entry: loreBook, index: number, retained: Set<string>): string {
    const saved = entry.id?.trim() ?? ''
    if (saved && !retained.has(saved)) return saved
    const base = `legacy-${fingerprintLegacyLore(entry).slice(6)}-${index + 1}`
    let id = base
    let suffix = 2
    while (retained.has(id)) id = `${base}-${suffix++}`
    return id
}

function allocateSourceId(preferred: string | undefined, used: Set<string>, createId: () => string): string {
    let id = preferred?.trim() ?? ''
    if (id && !used.has(id)) {
        used.add(id)
        return id
    }
    do id = createId().trim()
    while (!id || used.has(id))
    used.add(id)
    return id
}

function ensureSourceIds(entries: loreBook[], createId: () => string): loreBook[] {
    const used = new Set<string>()
    return entries.map((entry) => {
        const id = allocateSourceId(entry.id, used, createId)
        return entry.id === id ? entry : { ...entry, id }
    })
}

function reconcileAnalysisRun(
    run: BardLoreAnalysisRun | undefined,
    validIds: Set<string>,
    remappedIds: Map<string, string> = new Map(),
): BardLoreAnalysisRun | undefined {
    if (!run) return undefined
    const mapId = (id: string) => remappedIds.get(id) ?? id
    const targetIds = [...new Set(run.targetIds.map(mapId).filter((id) => validIds.has(id)))]
    if (targetIds.length === 0) return undefined
    const batches = run.batches.flatMap((batch): BardLoreAnalysisBatch[] => {
        const batchTargetIds = [...new Set(batch.targetIds.map(mapId).filter((id) => validIds.has(id)))]
        if (batchTargetIds.length === 0) return []
        const batchTargets = new Set(batchTargetIds)
        const candidates = batch.candidates?.flatMap((candidate): BardLoreAnalysisCandidate[] => {
            const id = mapId(candidate.id)
            if (!batchTargets.has(id)) return []
            return [{
                ...safeStructuredClone(candidate),
                id,
                links: candidate.links.flatMap((link) => {
                    const targetId = mapId(link.targetId)
                    return validIds.has(targetId) ? [{ ...link, targetId }] : []
                }),
                ...(candidate.atoms ? {
                    atoms: candidate.atoms.map((atom) => ({
                        ...safeStructuredClone(atom),
                        ...(atom.existingTargetId
                            ? { existingTargetId: mapId(atom.existingTargetId) }
                            : {}),
                        links: atom.links.flatMap((link) => {
                            const targetId = mapId(link.targetId)
                            return validIds.has(targetId) ? [{ ...link, targetId }] : []
                        }),
                    })),
                } : {}),
            }]
        })
        return [{
            ...safeStructuredClone(batch),
            targetIds: batchTargetIds,
            ...(candidates ? { candidates } : {}),
        }]
    })
    return {
        ...safeStructuredClone(run),
        targetIds,
        batches,
    }
}

export function materializeBardLoreEntries(
    state: BardLoreState,
    legacyEntries: loreBook[],
): BardLoreEntry[] {
    const retainedIds = new Set<string>()
    const unusedMetadata = new Set(state.metadata.map((_, index) => index))
    const remappedIds = new Map<string, string>()
    const baseEntries = legacyEntries.map((source, index): BardLoreEntry => {
        const id = uniqueSourceId(source, index, retainedIds)
        retainedIds.add(id)
        const sourceHash = fingerprintLegacyLore(source)
        let metadataIndex = state.metadata.findIndex((item, candidateIndex) =>
            unusedMetadata.has(candidateIndex) && item.sourceLegacyId === id,
        )
        if (metadataIndex < 0) {
            const hashMatches = state.metadata
                .map((item, candidateIndex) => ({ item, candidateIndex }))
                .filter(({ item, candidateIndex }) => unusedMetadata.has(candidateIndex) && item.sourceHash === sourceHash)
            if (hashMatches.length === 1) metadataIndex = hashMatches[0].candidateIndex
        }
        const defaults = createBardLoreEntry({ ...source, id }).bard
        const saved = metadataIndex >= 0 ? state.metadata[metadataIndex] : defaults
        if (metadataIndex >= 0) unusedMetadata.delete(metadataIndex)
        remappedIds.set(saved.sourceLegacyId, id)
        return {
            ...safeStructuredClone(source),
            id,
            bard: {
                ...safeStructuredClone(saved),
                sourceLegacyId: id,
                sourceHash,
            },
        }
    })

    const baseIds = new Set(baseEntries.map((entry) => entry.id))
    const derivedEntries = state.derivedEntries.flatMap((saved): BardLoreEntry[] => {
        const originalParent = saved.bard.derivedFromId
        if (!originalParent) return []
        const parentId = remappedIds.get(originalParent) ?? originalParent
        if (!baseIds.has(parentId) || retainedIds.has(saved.id)) return []
        retainedIds.add(saved.id)
        return [{
            ...safeStructuredClone(saved),
            bard: {
                ...safeStructuredClone(saved.bard),
                sourceLegacyId: parentId,
                derivedFromId: parentId,
            },
        }]
    })
    const validIds = new Set([...baseIds, ...derivedEntries.map((entry) => entry.id)])
    return [...baseEntries, ...derivedEntries].map((entry) => ({
        ...entry,
        bard: {
            ...entry.bard,
            links: entry.bard.links.flatMap((link) => {
                const targetId = remappedIds.get(link.targetId) ?? link.targetId
                return validIds.has(targetId) ? [{ ...link, targetId }] : []
            }),
        },
    }))
}

export function applyMaterializedBardLoreEntries(
    state: BardLoreState,
    _currentLegacyEntries: loreBook[],
    entries: BardLoreEntry[],
): { state: BardLoreState; legacyEntries: loreBook[] } {
    const retainedIds = new Set<string>()
    const baseEntries = entries.filter((entry) => !entry.bard.derivedFromId).filter((entry) => {
        const id = entry.id?.trim()
        if (!id || retainedIds.has(id)) return false
        retainedIds.add(id)
        return true
    })
    const baseIds = new Set(baseEntries.map((entry) => entry.id))
    const derivedEntries = entries.filter((entry) => {
        const parentId = entry.bard.derivedFromId
        if (!parentId || !baseIds.has(parentId) || retainedIds.has(entry.id)) return false
        retainedIds.add(entry.id)
        return true
    })
    const validIds = new Set(retainedIds)
    const remappedIds = new Map<string, string>()
    const savedHashCounts = new Map<string, number>()
    for (const saved of state.metadata) {
        savedHashCounts.set(saved.sourceHash, (savedHashCounts.get(saved.sourceHash) ?? 0) + 1)
    }
    for (const saved of state.metadata) {
        let target = baseEntries.find((entry) => entry.id === saved.sourceLegacyId)
        if (!target && savedHashCounts.get(saved.sourceHash) === 1) {
            const hashMatches = baseEntries.filter((entry) => entry.bard.sourceHash === saved.sourceHash)
            if (hashMatches.length === 1) target = hashMatches[0]
        }
        if (target) remappedIds.set(saved.sourceLegacyId, target.id)
    }
    for (const saved of state.derivedEntries) {
        if (derivedEntries.some((entry) => entry.id === saved.id)) remappedIds.set(saved.id, saved.id)
    }
    const normalizeLinks = (links: BardLoreLink[]) => links.filter((link) => validIds.has(link.targetId))
    const legacyEntries = baseEntries.map(withoutBardMetadata)
    const metadata = baseEntries.map((entry, index): BardLoreMetadata => ({
        ...safeStructuredClone(entry.bard),
        sourceLegacyId: entry.id,
        sourceHash: fingerprintLegacyLore(legacyEntries[index]),
        derivedFromId: undefined,
        links: normalizeLinks(entry.bard.links),
    }))
    const normalizedDerived = derivedEntries.map((entry): BardLoreEntry => ({
        ...safeStructuredClone(entry),
        bard: {
            ...safeStructuredClone(entry.bard),
            sourceLegacyId: entry.bard.derivedFromId!,
            sourceHash: fingerprintLegacyLore(entry),
            links: normalizeLinks(entry.bard.links),
        },
    }))
    const analysisRun = reconcileAnalysisRun(state.analysisRun, validIds, remappedIds)
    return {
        legacyEntries,
        state: {
            schemaVersion: 2,
            mode: state.mode,
            metadata,
            derivedEntries: normalizedDerived,
            settings: createBardLoreSettings(state.settings),
            ...(analysisRun ? { analysisRun } : {}),
        },
    }
}

export function reconcileBardLoreState(
    state: BardLoreState,
    legacyEntries: loreBook[],
): { state: BardLoreState; legacyEntries: loreBook[] } {
    return applyMaterializedBardLoreEntries(
        state,
        legacyEntries,
        materializeBardLoreEntries(state, legacyEntries),
    )
}

export interface BardLoreOwnerMigrationReport {
    migratedFromSchema1: boolean
    promotedEntries: number
    conflicts: number
}

export interface BardLoreOwnerStateResult {
    state: BardLoreState
    legacyEntries: loreBook[]
    report: BardLoreOwnerMigrationReport
}

export function normalizeBardLoreOwnerState(
    value: unknown,
    legacyEntries: loreBook[],
    createId: () => string,
): BardLoreOwnerStateResult | undefined {
    const raw = value && typeof value === 'object' ? value as Record<string, unknown> : undefined
    if (raw?.schemaVersion !== 1) {
        const normalized = normalizeBardLoreState(value)
        if (!normalized) return undefined
        return {
            ...reconcileBardLoreState(normalized, ensureSourceIds(legacyEntries, createId)),
            report: { migratedFromSchema1: false, promotedEntries: 0, conflicts: 0 },
        }
    }

    const copied = normalizeCopiedBardLoreState(value)
    if (!copied) return undefined
    const current = ensureSourceIds(legacyEntries, createId)
    const bases = current.map((entry) => createBardLoreEntry(entry))
    const copiedBases = copied.entries.filter((entry) => !entry.bard.derivedFromId)
    const available = new Set(current.map((_, index) => index))
    const usedIds = new Set(bases.map((entry) => entry.id))
    const remappedIds = new Map<string, string>()
    let promotedEntries = 0
    let conflicts = 0

    const uniqueCurrentMatch = (predicate: (entry: loreBook) => boolean): number | undefined => {
        const matches = current.flatMap((entry, index) => available.has(index) && predicate(entry) ? [index] : [])
        return matches.length === 1 ? matches[0] : undefined
    }

    for (const source of copiedBases) {
        const copiedHash = fingerprintLegacyLore(source)
        let targetIndex = uniqueCurrentMatch((entry) =>
            entry.id === source.id || entry.id === source.bard.sourceLegacyId,
        )
        targetIndex ??= uniqueCurrentMatch((entry) => fingerprintLegacyLore(entry) === source.bard.sourceHash)
        targetIndex ??= uniqueCurrentMatch((entry) => fingerprintLegacyLore(entry) === copiedHash)

        let targetId: string
        if (targetIndex === undefined) {
            targetId = allocateSourceId(source.id, usedIds, createId)
            bases.push({
                ...safeStructuredClone(source),
                id: targetId,
                bard: { ...safeStructuredClone(source.bard), sourceLegacyId: targetId },
            })
            promotedEntries += 1
        }
        else {
            available.delete(targetIndex)
            const legacy = current[targetIndex]
            const legacyHash = fingerprintLegacyLore(legacy)
            const grimoireChanged = copiedHash !== source.bard.sourceHash
            const legacyChanged = legacyHash !== source.bard.sourceHash
            if (grimoireChanged && legacyChanged && copiedHash !== legacyHash) {
                targetId = allocateSourceId(undefined, usedIds, createId)
                bases.push({
                    ...safeStructuredClone(source),
                    id: targetId,
                    comment: `${source.comment} (Grimoire migration copy)`,
                    bard: {
                        ...safeStructuredClone(source.bard),
                        sourceLegacyId: targetId,
                        tags: [...new Set([...source.bard.tags, 'migration-conflict'])],
                    },
                })
                conflicts += 1
            }
            else {
                targetId = legacy.id!
                const ordinary = grimoireChanged && !legacyChanged ? withoutBardMetadata(source) : legacy
                bases[targetIndex] = {
                    ...safeStructuredClone(ordinary),
                    id: targetId,
                    bard: { ...safeStructuredClone(source.bard), sourceLegacyId: targetId },
                }
            }
        }
        remappedIds.set(source.id, targetId)
        remappedIds.set(source.bard.sourceLegacyId, targetId)
    }

    const derivedEntries = copied.entries.filter((entry) => entry.bard.derivedFromId).map((source) => {
        const parentId = remappedIds.get(source.bard.derivedFromId!) ?? source.bard.derivedFromId!
        const id = allocateSourceId(source.id, usedIds, createId)
        remappedIds.set(source.id, id)
        return {
            ...safeStructuredClone(source),
            id,
            bard: {
                ...safeStructuredClone(source.bard),
                sourceLegacyId: parentId,
                derivedFromId: parentId,
            },
        }
    })
    const allEntries = [...bases, ...derivedEntries]
    const validIds = new Set(allEntries.map((entry) => entry.id))
    for (const entry of allEntries) {
        entry.bard.links = entry.bard.links.flatMap((link) => {
            const targetId = remappedIds.get(link.targetId) ?? link.targetId
            return validIds.has(targetId) ? [{ ...link, targetId }] : []
        })
    }
    const analysisRun = reconcileAnalysisRun(copied.analysisRun, validIds, remappedIds)
    const state: BardLoreState = {
        schemaVersion: 2,
        mode: copied.mode,
        metadata: bases.map((entry) => entry.bard),
        derivedEntries,
        settings: copied.settings,
        ...(analysisRun ? { analysisRun } : {}),
    }
    const reconciled = applyMaterializedBardLoreEntries(
        state,
        bases.map(withoutBardMetadata),
        allEntries,
    )
    return {
        ...reconciled,
        report: { migratedFromSchema1: true, promotedEntries, conflicts },
    }
}

export function upgradeLegacyLorebook(
    entries: loreBook[],
    createId: () => string,
    settings: BardLoreSettings,
): BardLoreState {
    const reserved = new Set(entries.map((entry) => entry.id?.trim()).filter((id): id is string => Boolean(id)))
    const retained = new Set<string>()

    const metadata = entries.map((entry): BardLoreMetadata => {
        let id = entry.id?.trim() ?? ''
        if (!id || retained.has(id)) {
            do id = createId().trim()
            while (!id || reserved.has(id) || retained.has(id))
        }
        retained.add(id)
        reserved.add(id)

        return createBardLoreEntry({ ...entry, id }).bard
    })

    return {
        schemaVersion: 2,
        mode: 'bard',
        metadata,
        derivedEntries: [],
        settings: createBardLoreSettings(settings),
    }
}
