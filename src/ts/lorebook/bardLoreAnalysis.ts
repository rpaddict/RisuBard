import { safeStructuredClone } from '../polyfill'
import type { WikiWritingLanguage } from '../risubard/wikiWritingLanguage'
import {
    buildBardLoreAnalysisLanguageInstruction,
    type BardLoreAnalysisLanguage,
    type ResolvedBardLoreAnalysisLanguage,
} from './bardLoreLanguage'
import {
    fingerprintBardLoreEntry,
    createBardLoreEntry,
    type BardLoreEntry,
    type BardLoreAnalysisBatch,
    type BardLoreAnalysisCandidate,
    type BardLoreAnalysisRun,
    type BardLoreAnalysisScope,
    type BardLoreSettings,
    type BardLoreKind,
    type BardLoreLink,
    type BardLoreFacet,
    type BardLoreInjection,
    type BardLoreAtomCandidate,
    type BardLoreActivation,
} from './bardLore'
import {
    compileBardLoreInstructionPreset,
    createDefaultBardLoreInstructionPreset,
    type BardLoreInstructionPreset,
} from './bardLoreInstructionPreset'

export type { BardLoreAnalysisCandidate, BardLoreAnalysisRun, BardLoreAnalysisScope } from './bardLore'

export interface BardLoreAnalysisDraft {
    entries: BardLoreAnalysisCandidate[]
}

export interface BardLoreAnalysisApplyResult {
    entries: BardLoreEntry[]
    appliedIds: string[]
    conflicts: Array<{ id: string; reason: 'source-changed' | 'missing-entry' }>
}

export interface BardLoreAnalysisPlannedBatch {
    entries: BardLoreEntry[]
    inputTokens: number
}

export interface BardLoreAnalysisPlan {
    batches: BardLoreAnalysisPlannedBatch[]
    totalInputTokens: number
}

export type BardLoreAnalysisQualityIssueCode =
    | 'missing-summary'
    | 'missing-tags'
    | 'composite-not-index-only'
    | 'composite-without-atoms'
    | 'supporting-links-exceed-budget'

export interface BardLoreAnalysisQualityIssue {
    entryId: string
    code: BardLoreAnalysisQualityIssueCode
    detail?: string
}

export interface BardLoreAnalysisQualityReport {
    issues: BardLoreAnalysisQualityIssue[]
    passedEntryIds: string[]
    failedEntryIds: string[]
}

export class BardLoreAnalysisBudgetError extends Error {
    constructor(message: string, readonly details?: { entryId: string; entryName: string; inputTokens: number; limit: number }) {
        super(message)
        this.name = 'BardLoreAnalysisBudgetError'
    }
}

const kinds = new Set<BardLoreKind>(['system', 'character', 'location', 'faction', 'item', 'event', 'concept', 'other'])
const compositeMarkers = [
    'roster', 'directory', 'catalog', 'timeline', 'chronology',
    '명부', '인명부', '등장인물 목록', '목록', '타임라인', '연표', '연대기',
]

export function isBardLoreCompositeEntry(source: BardLoreEntry): boolean {
    if (source.content.length < 500) return false
    const evidence = source.comment.toLocaleLowerCase()
    return compositeMarkers.some((marker) => evidence.includes(marker))
}

function qualityReport(issues: BardLoreAnalysisQualityIssue[], entryIds: string[]): BardLoreAnalysisQualityReport {
    const failedEntryIds = [...new Set(issues.map((issue) => issue.entryId))]
    const failed = new Set(failedEntryIds)
    return {
        issues,
        failedEntryIds,
        passedEntryIds: entryIds.filter((id) => !failed.has(id)),
    }
}

function auditCandidate(
    candidate: BardLoreAnalysisCandidate,
    source: BardLoreEntry,
    settings: BardLoreSettings,
    requireCompositeAtoms: boolean,
): BardLoreAnalysisQualityIssue[] {
    const issues: BardLoreAnalysisQualityIssue[] = []
    if (!candidate.summary.trim()) issues.push({ entryId: source.id, code: 'missing-summary' })
    if (candidate.tags.length === 0) issues.push({ entryId: source.id, code: 'missing-tags' })
    if (isBardLoreCompositeEntry(source)) {
        if (candidate.injection !== 'index-only') {
            issues.push({ entryId: source.id, code: 'composite-not-index-only' })
        }
        if (requireCompositeAtoms && (candidate.atoms?.length ?? 0) === 0) {
            issues.push({ entryId: source.id, code: 'composite-without-atoms' })
        }
    }
    const supportingLinks = candidate.links.filter((link) => link.retrieval === 'supporting').length
    const resultBudget = Math.max(0, Math.floor(settings.maxEntries))
    if (resultBudget > 0 && supportingLinks > resultBudget) {
        issues.push({
            entryId: source.id,
            code: 'supporting-links-exceed-budget',
            detail: `${supportingLinks}/${resultBudget}`,
        })
    }
    return issues
}

export function auditBardLoreAnalysisDraft(
    draft: BardLoreAnalysisDraft,
    sources: BardLoreEntry[],
    settings: BardLoreSettings,
): BardLoreAnalysisQualityReport {
    const byId = new Map(sources.map((entry) => [entry.id, entry]))
    const issues = draft.entries.flatMap((candidate) => {
        const source = byId.get(candidate.id)
        return source ? auditCandidate(candidate, source, settings, true) : []
    })
    return qualityReport(issues, draft.entries.map((entry) => entry.id))
}

export function auditBardLoreMetadata(
    entries: BardLoreEntry[],
    settings: BardLoreSettings,
): BardLoreAnalysisQualityReport {
    const eligible = entries.filter((entry) => entry.mode !== 'folder' && entry.mode !== 'child')
    const issues = eligible.flatMap((entry) => auditCandidate({
        id: entry.id,
        sourceHash: entry.bard.sourceHash,
        kind: entry.bard.kind,
        aliases: entry.bard.aliases,
        tags: entry.bard.tags,
        summary: entry.bard.summary,
        facets: entry.bard.facets,
        injection: entry.bard.injection,
        links: entry.bard.links,
    }, entry, settings, false))
    return qualityReport(issues, eligible.map((entry) => entry.id))
}

export function buildBardLoreAnalysisQualityRepairPrompt(
    prompt: string,
    issues: BardLoreAnalysisQualityIssue[],
): string {
    const diagnostics = [...new Set(issues.map((issue) =>
        `${issue.code}${issue.detail ? `:${issue.detail}` : ''}`
    ))]
    return [
        prompt,
        '',
        'The previous draft passed JSON Schema validation but failed deterministic local metadata checks.',
        `Fix every listed issue and return the complete JSON response again: ${diagnostics.join(', ')}`,
        'Do not omit targets that already passed. Return JSON only.',
    ].join('\n')
}

export const bardLoreAnalysisSchema = JSON.stringify({
    type: 'object',
    additionalProperties: false,
    required: ['entries'],
    properties: {
        entries: {
            type: 'array',
            items: {
                type: 'object',
                additionalProperties: false,
                required: ['ref', 'kind', 'activation', 'aliases', 'tags', 'summary', 'facets', 'injection', 'atoms', 'links'],
                properties: {
                    ref: { type: 'integer', minimum: 0 },
                    kind: { type: 'string', enum: [...kinds] },
                    activation: { type: 'string', enum: ['required', 'keyed', 'retrieve'] },
                    aliases: { type: 'array', items: { type: 'string' } },
                    tags: { type: 'array', items: { type: 'string' } },
                    summary: { type: 'string' },
                    facets: {
                        type: 'array',
                        items: {
                            type: 'object',
                            additionalProperties: false,
                            required: ['key', 'value', 'aliases'],
                            properties: {
                                key: { type: 'string' },
                                value: { type: 'string' },
                                aliases: { type: 'array', items: { type: 'string' } },
                            },
                        },
                    },
                    injection: { type: 'string', enum: ['full', 'index-only'] },
                    atoms: {
                        type: 'array',
                        items: {
                            type: 'object',
                            additionalProperties: false,
                            required: ['name', 'sourceQuote', 'kind', 'aliases', 'tags', 'summary', 'facets', 'links'],
                            properties: {
                                name: { type: 'string' },
                                sourceQuote: { type: 'string' },
                                existingTargetRef: { type: 'integer', minimum: -1 },
                                kind: { type: 'string', enum: [...kinds] },
                                aliases: { type: 'array', items: { type: 'string' } },
                                tags: { type: 'array', items: { type: 'string' } },
                                summary: { type: 'string' },
                                facets: {
                                    type: 'array',
                                    items: {
                                        type: 'object',
                                        additionalProperties: false,
                                        required: ['key', 'value', 'aliases'],
                                        properties: {
                                            key: { type: 'string' },
                                            value: { type: 'string' },
                                            aliases: { type: 'array', items: { type: 'string' } },
                                        },
                                    },
                                },
                                links: {
                                    type: 'array',
                                    items: {
                                        type: 'object',
                                        additionalProperties: false,
                                        required: ['targetRef', 'relation', 'retrieval'],
                                        properties: {
                                            targetRef: { type: 'integer', minimum: 0 },
                                            relation: { type: 'string' },
                                            retrieval: { type: 'string', enum: ['supporting', 'discoverable', 'ambient', 'none'] },
                                        },
                                    },
                                },
                            },
                        },
                    },
                    links: {
                        type: 'array',
                        items: {
                            type: 'object',
                            additionalProperties: false,
                            required: ['targetRef', 'relation', 'retrieval'],
                            properties: {
                                targetRef: { type: 'integer', minimum: 0 },
                                relation: { type: 'string' },
                                retrieval: { type: 'string', enum: ['supporting', 'discoverable', 'ambient', 'none'] },
                            },
                        },
                    },
                },
            },
        },
    },
})

export const bardLoreAtomicAnalysisSchema = JSON.stringify({
    type: 'object',
    additionalProperties: false,
    required: ['entries'],
    properties: {
        entries: {
            type: 'array',
            minItems: 1,
            maxItems: 1,
            items: {
                type: 'object',
                additionalProperties: false,
                required: ['ref', 'kind', 'activation', 'aliases', 'tags', 'summary', 'facets', 'injection', 'links'],
                properties: {
                    ref: { type: 'integer', minimum: 0 },
                    kind: { type: 'string', enum: [...kinds] },
                    activation: { type: 'string', enum: ['required', 'keyed', 'retrieve'] },
                    aliases: { type: 'array', items: { type: 'string' } },
                    tags: { type: 'array', items: { type: 'string' } },
                    summary: { type: 'string' },
                    facets: {
                        type: 'array',
                        items: {
                            type: 'object',
                            additionalProperties: false,
                            required: ['key', 'value', 'aliases'],
                            properties: {
                                key: { type: 'string' },
                                value: { type: 'string' },
                                aliases: { type: 'array', items: { type: 'string' } },
                            },
                        },
                    },
                    injection: { type: 'string', enum: ['full'] },
                    links: {
                        type: 'array',
                        items: {
                            type: 'object',
                            additionalProperties: false,
                            required: ['targetRef', 'relation', 'retrieval'],
                            properties: {
                                targetRef: { type: 'integer', minimum: 0 },
                                relation: { type: 'string' },
                                retrieval: { type: 'string', enum: ['supporting', 'discoverable', 'ambient', 'none'] },
                            },
                        },
                    },
                },
            },
        },
    },
})

export function buildBardLoreAtomicRetryPrompt(prompt: string): string {
    return [
        prompt,
        '',
        'The previous response was unusable.',
        'This retry contains exactly one ordinary atomic entry, not a composite directory or timeline.',
        'Ignore the earlier atom instruction. Use the smaller supplied schema, which intentionally omits atoms, and return exactly one JSON object with no Markdown fence or commentary.',
    ].join('\n')
}

export function collectBardLoreAnalysisTargets(
    entries: BardLoreEntry[],
    scope: BardLoreAnalysisScope,
    activeId: string | undefined,
    linkedDepth: number,
): BardLoreEntry[] {
    const eligible = entries.filter((entry) => entry.mode !== 'folder' && entry.mode !== 'child')
    if (scope === 'all') return eligible
    if (scope === 'characters') return eligible.filter((entry) => entry.bard.kind === 'character')
    const byId = new Map(eligible.map((entry) => [entry.id, entry]))
    const active = activeId ? byId.get(activeId) : undefined
    if (!active) return []
    if (scope === 'entry') return [active]

    const selected = new Set([active.id])
    let frontier = [active.id]
    for (let depth = 0; depth < Math.max(0, Math.floor(linkedDepth)) && frontier.length > 0; depth += 1) {
        const next: string[] = []
        for (const id of frontier) {
            const entry = byId.get(id)
            if (!entry) continue
            for (const link of entry.bard.links) {
                if (!byId.has(link.targetId) || selected.has(link.targetId)) continue
                selected.add(link.targetId)
                next.push(link.targetId)
            }
        }
        frontier = next
    }
    return eligible.filter((entry) => selected.has(entry.id))
}

export function createBardLoreAnalysisBatches(
    entries: BardLoreEntry[],
    tokenCounts: Record<string, number>,
    limits: { maxEntries: number; maxTokens: number },
): BardLoreEntry[][] {
    if (entries.length === 0) return []
    const maxEntries = Math.max(0, Math.floor(limits.maxEntries))
    const maxTokens = Math.max(0, Math.floor(limits.maxTokens))
    if (maxEntries === 0 || maxTokens === 0) {
        throw new BardLoreAnalysisBudgetError('Grimoire analysis limits do not allow any input.')
    }
    const batches: BardLoreEntry[][] = []
    let batch: BardLoreEntry[] = []
    let tokens = 0
    for (const entry of entries) {
        const entryTokens = Math.max(0, Math.floor(tokenCounts[entry.id] ?? 0))
        if (entryTokens > maxTokens) {
            throw new BardLoreAnalysisBudgetError('A Grimoire entry exceeds the configured analysis input limit.')
        }
        if (batch.length > 0 && (batch.length >= maxEntries || tokens + entryTokens > maxTokens)) {
            batches.push(batch)
            batch = []
            tokens = 0
        }
        batch.push(entry)
        tokens += entryTokens
    }
    if (batch.length > 0) batches.push(batch)
    return batches
}

export async function planBardLoreAnalysisBatches(
    entries: BardLoreEntry[],
    catalog: BardLoreEntry[],
    settings: BardLoreSettings,
    tokenize: (value: string) => Promise<number>,
    language: BardLoreAnalysisLanguage = 'follow-bardwiki',
    wikiLanguage: WikiWritingLanguage = 'ko',
    instructionPreset: BardLoreInstructionPreset = createDefaultBardLoreInstructionPreset(),
): Promise<BardLoreAnalysisPlan> {
    const maxEntries = Math.max(0, Math.floor(settings.analysisBatchEntries))
    const maxTokens = Math.max(0, Math.floor(settings.analysisInputTokens))
    if (entries.length === 0) return { batches: [], totalInputTokens: 0 }
    if (maxEntries === 0 || maxTokens === 0) {
        throw new BardLoreAnalysisBudgetError('Grimoire analysis limits do not allow any input.')
    }
    const schemaTokens = await tokenize(bardLoreAnalysisSchema)
    const planned: BardLoreAnalysisPlannedBatch[] = []
    let current: BardLoreEntry[] = []
    let currentTokens = 0

    const measure = async (batch: BardLoreEntry[]) =>
        schemaTokens + await tokenize(buildBardLoreAnalysisPrompt(
            batch,
            catalog,
            settings.router.filterFacetKeys,
            language,
            wikiLanguage,
            instructionPreset,
        ))
    const commit = () => {
        if (current.length === 0) return
        planned.push({ entries: current, inputTokens: currentTokens })
        current = []
        currentTokens = 0
    }

    for (const entry of entries) {
        if (current.length >= maxEntries) commit()
        let candidate = [...current, entry]
        let candidateTokens = await measure(candidate)
        if (candidateTokens > maxTokens && current.length > 0) {
            commit()
            candidate = [entry]
            candidateTokens = await measure(candidate)
        }
        if (candidateTokens > maxTokens) {
            throw new BardLoreAnalysisBudgetError(
                `Grimoire entry "${entry.comment || entry.key || entry.id}" requires ${candidateTokens} input tokens; the configured limit is ${maxTokens}.`,
                { entryId: entry.id, entryName: entry.comment || entry.key || entry.id, inputTokens: candidateTokens, limit: maxTokens },
            )
        }
        current = candidate
        currentTokens = candidateTokens
        if (current.length >= maxEntries) commit()
    }
    commit()
    return {
        batches: planned,
        totalInputTokens: planned.reduce((sum, batch) => sum + batch.inputTokens, 0),
    }
}

export function createBardLoreAnalysisRun(
    plan: BardLoreAnalysisPlan,
    scope: BardLoreAnalysisScope,
    settings: BardLoreSettings,
    createId: () => string,
    now: () => string = () => new Date().toISOString(),
    languageSnapshot: ResolvedBardLoreAnalysisLanguage = 'ko',
    instructionPresetSnapshot: BardLoreInstructionPreset = createDefaultBardLoreInstructionPreset(),
): BardLoreAnalysisRun {
    const timestamp = now()
    const batches: BardLoreAnalysisBatch[] = plan.batches.map((batch, index) => ({
        id: createId(),
        index,
        targetIds: batch.entries.map((entry) => entry.id),
        estimatedInputTokens: batch.inputTokens,
        status: 'pending',
    }))
    return {
        schemaVersion: 1,
        id: createId(),
        scope,
        targetIds: batches.flatMap((batch) => batch.targetIds),
        createdAt: timestamp,
        updatedAt: timestamp,
        status: 'running',
        settingsSnapshot: safeStructuredClone(settings),
        languageSnapshot,
        instructionPresetSnapshot: safeStructuredClone(instructionPresetSnapshot),
        batches,
        overwriteExisting: false,
    }
}

function updateRunBatch(
    run: BardLoreAnalysisRun,
    batchId: string,
    update: (batch: BardLoreAnalysisBatch) => BardLoreAnalysisBatch,
): BardLoreAnalysisRun {
    return {
        ...safeStructuredClone(run),
        updatedAt: new Date().toISOString(),
        batches: run.batches.map((batch) => batch.id === batchId ? update(safeStructuredClone(batch)) : safeStructuredClone(batch)),
    }
}

export function startBardLoreAnalysisBatch(run: BardLoreAnalysisRun, batchId: string): BardLoreAnalysisRun {
    return updateRunBatch(run, batchId, (batch) => ({ ...batch, status: 'running', error: undefined }))
}

export function completeBardLoreAnalysisBatch(
    run: BardLoreAnalysisRun,
    batchId: string,
    candidates: BardLoreAnalysisCandidate[],
): BardLoreAnalysisRun {
    return updateRunBatch(run, batchId, (batch) => ({
        ...batch,
        status: 'complete',
        candidates: safeStructuredClone(candidates),
        error: undefined,
    }))
}

export function failBardLoreAnalysisBatch(
    run: BardLoreAnalysisRun,
    batchId: string,
    error: string,
): BardLoreAnalysisRun {
    return updateRunBatch(run, batchId, (batch) => ({ ...batch, status: 'failed', error, candidates: undefined }))
}

export function finishBardLoreAnalysisRun(run: BardLoreAnalysisRun): BardLoreAnalysisRun {
    const complete = run.batches.some((batch) => batch.status === 'complete')
    return {
        ...safeStructuredClone(run),
        status: complete ? 'review' : 'failed',
        updatedAt: new Date().toISOString(),
    }
}

export function pauseBardLoreAnalysisRun(run: BardLoreAnalysisRun): BardLoreAnalysisRun {
    return {
        ...safeStructuredClone(run),
        status: 'paused',
        updatedAt: new Date().toISOString(),
        batches: run.batches.map((batch) => batch.status === 'running'
            ? { ...safeStructuredClone(batch), status: 'pending' }
            : safeStructuredClone(batch)),
    }
}

export function retryFailedBardLoreAnalysisBatches(run: BardLoreAnalysisRun): BardLoreAnalysisRun {
    return {
        ...safeStructuredClone(run),
        status: 'running',
        updatedAt: new Date().toISOString(),
        batches: run.batches.map((batch) => batch.status === 'failed'
            ? { ...safeStructuredClone(batch), status: 'pending', error: undefined }
            : safeStructuredClone(batch)),
    }
}

export function bardLoreAnalysisDraftFromRun(run: BardLoreAnalysisRun): BardLoreAnalysisDraft {
    return {
        entries: run.batches.flatMap((batch) => batch.status === 'complete' ? batch.candidates ?? [] : []),
    }
}

export function buildBardLoreAnalysisPrompt(
    targets: BardLoreEntry[],
    catalog: BardLoreEntry[],
    characterFilterFacetKeys: string[] = ['work', 'gender'],
    language: BardLoreAnalysisLanguage = 'follow-bardwiki',
    wikiLanguage: WikiWritingLanguage = 'ko',
    instructionPreset: BardLoreInstructionPreset = createDefaultBardLoreInstructionPreset(),
): string {
    const refs = new Map(catalog.map((entry, index) => [entry.id, index]))
    const payload = targets.map((entry) => ({
        ref: refs.get(entry.id),
        name: entry.comment,
        keys: entry.key,
        secondaryKeys: entry.secondkey,
        content: entry.content,
        currentMetadata: {
            kind: entry.bard.kind,
            activation: entry.bard.activation,
            aliases: entry.bard.aliases,
            tags: entry.bard.tags,
            summary: entry.bard.summary,
            facets: entry.bard.facets ?? [],
            injection: entry.bard.injection ?? 'full',
            links: entry.bard.links.flatMap((link) => {
                const targetRef = refs.get(link.targetId)
                return targetRef === undefined
                    ? []
                    : [[targetRef, link.relation, link.retrieval]]
            }),
        },
    }))
    const linkCatalog = catalog.map((entry, ref) => [ref, entry.comment, entry.bard.kind])
    return [
        buildBardLoreAnalysisInstructions(characterFilterFacetKeys, language, wikiLanguage, instructionPreset),
        JSON.stringify({ linkCatalog, targets: payload }),
    ].join('\n')
}

export function buildBardLoreAnalysisInstructions(
    characterFilterFacetKeys: string[] | undefined,
    language: BardLoreAnalysisLanguage = 'follow-bardwiki',
    wikiLanguage: WikiWritingLanguage = 'ko',
    instructionPreset: BardLoreInstructionPreset = createDefaultBardLoreInstructionPreset(),
): string {
    const filterFacetKeys = characterFilterFacetKeys === undefined
        ? undefined
        : cleanStrings(characterFilterFacetKeys)
    const filterFacetInstruction = filterFacetKeys === undefined
        ? '[Character-specific filter facet keys are inserted here at request time.]'
        : filterFacetKeys.length > 0
            ? `The router can filter these facet keys when evidence exists: ${filterFacetKeys.join(', ')}. Use these canonical keys exactly and put natural query words and value synonyms in each facet aliases array.`
            : 'For characters, return only facets established by the supplied text or catalog.'
    return compileBardLoreInstructionPreset(instructionPreset, {
        languageInstruction: buildBardLoreAnalysisLanguageInstruction(language, wikiLanguage),
        filterFacetInstruction,
    })
}

function strings(value: unknown): value is string[] {
    return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function cleanStrings(values: string[]): string[] {
    return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
}

function parseFacets(value: unknown): BardLoreFacet[] {
    if (value === undefined) return []
    if (!Array.isArray(value)) return invalid('entry-shape')
    const facets: BardLoreFacet[] = []
    for (const candidate of value) {
        if (!candidate || typeof candidate !== 'object') return invalid('entry-shape')
        const facet = candidate as Record<string, unknown>
        if (typeof facet.key !== 'string' || typeof facet.value !== 'string' || !strings(facet.aliases)) {
            return invalid('entry-shape')
        }
        const key = facet.key.trim()
        const normalizedValue = facet.value.trim()
        if (!key || !normalizedValue) continue
        facets.push({ key, value: normalizedValue, aliases: cleanStrings(facet.aliases) })
    }
    return facets
}

function parseResponseLinks(
    value: unknown,
    sourceRef: number,
    catalogByRef: Map<number, BardLoreEntry>,
): BardLoreLink[] {
    if (!Array.isArray(value)) return invalid('link-shape')
    const links: BardLoreLink[] = []
    for (const valueLink of value) {
        if (!valueLink || typeof valueLink !== 'object') return invalid('link-shape')
        const link = valueLink as Record<string, unknown>
        if (
            typeof link.targetRef !== 'number'
            || !Number.isInteger(link.targetRef)
            || typeof link.relation !== 'string'
            || !['supporting', 'discoverable', 'ambient', 'none'].includes(link.retrieval as string)
        ) return invalid('link-shape')
        if (link.targetRef === sourceRef || !catalogByRef.has(link.targetRef)) continue
        links.push({
            targetId: catalogByRef.get(link.targetRef)!.id,
            relation: link.relation,
            retrieval: link.retrieval,
        } as BardLoreLink)
    }
    return links
}

export type BardLoreAnalysisValidationReason =
    | 'invalid-json'
    | 'missing-entries'
    | 'unknown-target'
    | 'entry-shape'
    | 'link-shape'
    | 'missing-source-hash'
    | 'missing-targets'

function invalid(reason: BardLoreAnalysisValidationReason): never {
    throw new Error(`bard-lore-analysis-invalid:${reason}`)
}

function parseResponseJson(response: string): unknown {
    const trimmed = response.trim()
    const fenced = trimmed.match(/^\`\`\`(?:json)?\s*([\s\S]*?)\s*\`\`\`$/i)
    try {
        return JSON.parse(fenced?.[1] ?? trimmed)
    }
    catch {}

    for (let start = 0; start < trimmed.length; start += 1) {
        if (trimmed[start] !== '{') continue
        let depth = 0
        let quoted = false
        let escaped = false
        for (let index = start; index < trimmed.length; index += 1) {
            const character = trimmed[index]
            if (quoted) {
                if (escaped) escaped = false
                else if (character === '\\') escaped = true
                else if (character === '"') quoted = false
                continue
            }
            if (character === '"') {
                quoted = true
                continue
            }
            if (character === '{') depth += 1
            else if (character === '}') depth -= 1
            if (depth !== 0) continue
            try {
                const candidate = JSON.parse(trimmed.slice(start, index + 1))
                if (
                    candidate
                    && typeof candidate === 'object'
                    && Array.isArray((candidate as Record<string, unknown>).entries)
                ) return candidate
            }
            catch {}
            break
        }
    }
    return undefined
}

export function parseBardLoreAnalysisResponse(
    response: string,
    expectedEntries: BardLoreEntry[],
    catalog: BardLoreEntry[],
    sourceHashes: Map<string, string> = new Map(
        expectedEntries.map((entry) => [entry.id, fingerprintBardLoreEntry(entry)]),
    ),
): BardLoreAnalysisDraft {
    const parsed = parseResponseJson(response)
    if (parsed === undefined) return invalid('invalid-json')
    if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as Record<string, unknown>).entries)) return invalid('missing-entries')
    const catalogByRef = new Map(catalog.map((entry, ref) => [ref, entry]))
    const refById = new Map(catalog.map((entry, ref) => [entry.id, ref]))
    const expected = new Map(expectedEntries.map((entry) => [refById.get(entry.id), entry]))
    if (expected.has(undefined)) return invalid('unknown-target')
    const seen = new Set<number>()
    const candidates: BardLoreAnalysisCandidate[] = []
    for (const value of (parsed as { entries: unknown[] }).entries) {
        if (!value || typeof value !== 'object') return invalid('entry-shape')
        const item = value as Record<string, unknown>
        if (
            typeof item.ref !== 'number'
            || !Number.isInteger(item.ref)
            || seen.has(item.ref)
            || !expected.has(item.ref)
            || !kinds.has(item.kind as BardLoreKind)
            || !['required', 'keyed', 'retrieve'].includes(item.activation as string)
            || !strings(item.aliases)
            || !strings(item.tags)
            || typeof item.summary !== 'string'
            || (item.injection !== undefined && item.injection !== 'full' && item.injection !== 'index-only')
            || !Array.isArray(item.links)
        ) return invalid('entry-shape')
        const facets = parseFacets(item.facets)
        const injection = (item.injection ?? 'full') as BardLoreInjection
        const entry = expected.get(item.ref)!
        const links = parseResponseLinks(item.links, item.ref, catalogByRef)
        const atoms: BardLoreAtomCandidate[] = []
        if (item.atoms !== undefined) {
            if (!Array.isArray(item.atoms)) return invalid('entry-shape')
            for (const valueAtom of item.atoms) {
                if (!valueAtom || typeof valueAtom !== 'object') return invalid('entry-shape')
                const atom = valueAtom as Record<string, unknown>
                if (
                    typeof atom.name !== 'string'
                    || typeof atom.sourceQuote !== 'string'
                    || !atom.sourceQuote
                    || !entry.content.includes(atom.sourceQuote)
                    || (atom.existingTargetRef !== undefined && (
                        typeof atom.existingTargetRef !== 'number'
                        || !Number.isInteger(atom.existingTargetRef)
                        || atom.existingTargetRef < -1
                        || (atom.existingTargetRef >= 0 && !catalogByRef.has(atom.existingTargetRef))
                    ))
                    || !kinds.has(atom.kind as BardLoreKind)
                    || !strings(atom.aliases)
                    || !strings(atom.tags)
                    || typeof atom.summary !== 'string'
                ) return invalid('entry-shape')
                const existingTarget = typeof atom.existingTargetRef === 'number' && atom.existingTargetRef >= 0
                    ? catalogByRef.get(atom.existingTargetRef)
                    : undefined
                atoms.push({
                    name: atom.name.trim(),
                    content: atom.sourceQuote,
                    existingTargetId: existingTarget?.id,
                    existingTargetHash: existingTarget ? fingerprintBardLoreEntry(existingTarget) : undefined,
                    kind: atom.kind as BardLoreKind,
                    aliases: cleanStrings(atom.aliases),
                    tags: cleanStrings(atom.tags),
                    summary: atom.summary,
                    facets: parseFacets(atom.facets),
                    links: parseResponseLinks(atom.links, item.ref, catalogByRef),
                })
            }
        }
        const sourceHash = sourceHashes.get(entry.id)
        if (!sourceHash) return invalid('missing-source-hash')
        seen.add(item.ref)
        candidates.push({
            id: entry.id,
            sourceHash,
            kind: item.kind as BardLoreKind,
            activation: item.activation as Exclude<BardLoreActivation, 'never'> | undefined,
            aliases: cleanStrings(item.aliases),
            tags: cleanStrings(item.tags),
            summary: item.summary,
            facets,
            injection,
            links,
            atoms,
        })
    }
    if (seen.size !== expected.size || [...expected.keys()].some((ref) => ref === undefined || !seen.has(ref))) return invalid('missing-targets')
    return { entries: candidates }
}

function mergeLinks(current: BardLoreLink[], proposed: BardLoreLink[]): BardLoreLink[] {
    const merged = [...current]
    for (const link of proposed) {
        if (!merged.some((item) =>
            item.targetId === link.targetId
            && item.relation === link.relation
            && item.retrieval === link.retrieval,
        )) merged.push(link)
    }
    return merged
}

function mergeFacets(current: BardLoreFacet[], proposed: BardLoreFacet[]): BardLoreFacet[] {
    const merged = safeStructuredClone(current)
    for (const facet of proposed) {
        const found = merged.find((item) =>
            item.key.toLocaleLowerCase() === facet.key.toLocaleLowerCase()
            && item.value.toLocaleLowerCase() === facet.value.toLocaleLowerCase(),
        )
        if (found) found.aliases = [...new Set([...found.aliases, ...facet.aliases])]
        else merged.push(safeStructuredClone(facet))
    }
    return merged
}

function stableAtomId(sourceId: string, atom: BardLoreAtomCandidate): string {
    const value = JSON.stringify([sourceId, atom.name, atom.content, atom.kind])
    let hash = 0x811c9dc5
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index)
        hash = Math.imul(hash, 0x01000193)
    }
    return `bard-atom-${(hash >>> 0).toString(16).padStart(8, '0')}`
}

export function applyBardLoreAnalysisDraft(
    entries: BardLoreEntry[],
    draft: BardLoreAnalysisDraft,
    options: { overwriteExisting: boolean; replaceLinks?: boolean; createId?: () => string },
): BardLoreAnalysisApplyResult {
    const next = safeStructuredClone(entries)
    const byId = new Map(next.map((entry) => [entry.id, entry]))
    const originalHashes = new Map(entries.map((entry) => [entry.id, fingerprintBardLoreEntry(entry)]))
    const appliedIds: string[] = []
    const conflicts: BardLoreAnalysisApplyResult['conflicts'] = []
    const approvedCandidates: Array<{ candidate: BardLoreAnalysisCandidate; entry: BardLoreEntry }> = []
    for (const candidate of draft.entries) {
        const entry = byId.get(candidate.id)
        if (!entry) {
            conflicts.push({ id: candidate.id, reason: 'missing-entry' })
            continue
        }
        if (originalHashes.get(entry.id) !== candidate.sourceHash) {
            conflicts.push({ id: candidate.id, reason: 'source-changed' })
            continue
        }
        const atomConflict = (candidate.atoms ?? []).find((atom) => {
            if (!atom.existingTargetId) return false
            const target = byId.get(atom.existingTargetId)
            return !target || (atom.existingTargetHash !== undefined && originalHashes.get(target.id) !== atom.existingTargetHash)
        })
        if (atomConflict?.existingTargetId) {
            conflicts.push({
                id: candidate.id,
                reason: byId.has(atomConflict.existingTargetId) ? 'source-changed' : 'missing-entry',
            })
            continue
        }
        entry.bard = options.overwriteExisting
            ? {
                ...entry.bard,
                kind: candidate.kind,
                activation: candidate.activation ?? entry.bard.activation,
                aliases: [...candidate.aliases],
                tags: [...candidate.tags],
                summary: candidate.summary,
                facets: safeStructuredClone(candidate.facets ?? []),
                injection: candidate.injection ?? entry.bard.injection ?? 'full',
                links: safeStructuredClone(candidate.links),
            }
            : {
                ...entry.bard,
                kind: entry.bard.kind === 'other' ? candidate.kind : entry.bard.kind,
                activation: candidate.activation ?? entry.bard.activation,
                aliases: [...new Set([...entry.bard.aliases, ...candidate.aliases])],
                tags: [...new Set([...entry.bard.tags, ...candidate.tags])],
                summary: entry.bard.summary || candidate.summary,
                facets: mergeFacets(entry.bard.facets ?? [], candidate.facets ?? []),
                injection: candidate.injection ?? entry.bard.injection ?? 'full',
                links: options.replaceLinks
                    ? safeStructuredClone(candidate.links)
                    : mergeLinks(entry.bard.links, candidate.links),
            }
        appliedIds.push(entry.id)
        approvedCandidates.push({ candidate, entry })
    }
    for (const { candidate, entry } of approvedCandidates) {
        for (const atom of candidate.atoms ?? []) {
            const existing = atom.existingTargetId
                ? byId.get(atom.existingTargetId)
                : next.find((item) =>
                    item.bard.derivedFromId === entry.id
                    && item.comment === atom.name
                    && item.content === atom.content,
                )
            if (existing) {
                if (atom.existingTargetHash && originalHashes.get(existing.id) !== atom.existingTargetHash) {
                    conflicts.push({ id: existing.id, reason: 'source-changed' })
                    continue
                }
                existing.bard = options.overwriteExisting
                    ? {
                        ...existing.bard,
                        kind: atom.kind,
                        aliases: [...atom.aliases],
                        tags: [...atom.tags],
                        summary: atom.summary,
                        facets: safeStructuredClone(atom.facets),
                        injection: 'full',
                        links: safeStructuredClone(atom.links),
                    }
                    : {
                        ...existing.bard,
                        kind: existing.bard.kind === 'other' ? atom.kind : existing.bard.kind,
                        aliases: [...new Set([...existing.bard.aliases, ...atom.aliases])],
                        tags: [...new Set([...existing.bard.tags, ...atom.tags])],
                        summary: existing.bard.summary || atom.summary,
                        facets: mergeFacets(existing.bard.facets ?? [], atom.facets),
                        injection: 'full',
                        links: options.replaceLinks
                            ? safeStructuredClone(atom.links)
                            : mergeLinks(existing.bard.links, atom.links),
                    }
                appliedIds.push(existing.id)
                continue
            }
            if (atom.existingTargetId) {
                conflicts.push({ id: atom.existingTargetId, reason: 'missing-entry' })
                continue
            }
            const id = (options.createId?.() ?? stableAtomId(entry.id, atom)).trim()
            if (!id || byId.has(id)) throw new Error('Grimoire atom IDs must be unique and non-empty.')
            const derived = createBardLoreEntry({
                id,
                key: atom.aliases.join(', '),
                secondkey: '',
                insertorder: entry.insertorder + 1,
                comment: atom.name,
                content: atom.content,
                mode: 'normal',
                alwaysActive: false,
                selective: false,
            })
            derived.bard = {
                ...derived.bard,
                sourceLegacyId: entry.bard.sourceLegacyId,
                derivedFromId: entry.id,
                kind: atom.kind,
                aliases: [...atom.aliases],
                tags: [...atom.tags],
                summary: atom.summary,
                facets: safeStructuredClone(atom.facets),
                injection: 'full',
                links: safeStructuredClone(atom.links),
            }
            next.push(derived)
            byId.set(id, derived)
            appliedIds.push(id)
        }
    }
    return { entries: next, appliedIds, conflicts }
}
