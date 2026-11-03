import {
    parseSingleJsonObject,
    parseSingleJsonObjectMatching,
} from '../../packages/risubard-core/src/modelOutput'
import englishContract from '../../src/ts/risubard/skills/bardwiki-memory-writer/references/english-contract.md?raw'
import { normalizeWikiWritingLanguage, wikiWritingHeadings, type WikiWritingLanguage } from '../../src/ts/risubard/wikiWritingLanguage'
import { normalizeCanonicalSectionHeading } from './risubard-markdown-section-patch'
import { normalizeMemoryRetrievalKeywords, STORY_TIME_UNITS, type SemanticTemporalHint, type StoryTimeUnit } from './risubard-memory-metadata'

const itemString = { type: 'string', minLength: 1, maxLength: 500 }
const canonicalTypes = [
    'character',
    'location',
    'scene',
    'faction',
    'creature',
    'item',
    'concept',
    'other',
] as const

export const memoryWriterDraftSchema = JSON.stringify({
    type: 'object',
    additionalProperties: false,
    required: [
        'title',
        'establishedEvents',
        'stateChanges',
        'characterKnowledge',
        'persistentFacts',
        'openContinuity',
        'canonicalUpdateCandidates',
        'keywords',
        'temporalHint',
    ],
    properties: {
        title: { type: 'string', minLength: 1, maxLength: 160 },
        keywords: { type: 'array', maxItems: 24, items: { type: 'string', minLength: 1, maxLength: 80 } },
        temporalHint: {
            type: 'object', additionalProperties: false,
            required: ['elapsedDays', 'evidence', 'timeline', 'flashbackAmount', 'flashbackUnit', 'calendar'],
            properties: {
                elapsedDays: { type: ['integer', 'null'], minimum: 0 },
                evidence: { type: 'string', maxLength: 240 },
                timeline: { type: 'string', enum: ['present', 'flashback'] },
                flashbackAmount: { type: ['integer', 'null'], minimum: 0 },
                flashbackUnit: { type: 'string', enum: ['day', 'month', 'year'] },
                calendar: { type: 'string', maxLength: 120 },
            },
        },
        establishedEvents: {
            type: 'array',
            maxItems: 12,
            items: itemString,
        },
        stateChanges: {
            type: 'array',
            maxItems: 12,
            items: {
                type: 'object',
                additionalProperties: false,
                required: ['subject', 'before', 'after'],
                properties: {
                    subject: itemString,
                    before: { ...itemString, type: ['string', 'null'] },
                    after: itemString,
                },
            },
        },
        characterKnowledge: {
            type: 'array',
            maxItems: 12,
            items: {
                type: 'object',
                additionalProperties: false,
                required: ['character', 'fact', 'stance'],
                properties: {
                    character: itemString,
                    fact: itemString,
                    stance: {
                        type: 'string', enum: ['knows', 'believes'],
                    },
                },
            },
        },
        persistentFacts: {
            type: 'array',
            maxItems: 12,
            items: itemString,
        },
        openContinuity: {
            type: 'array',
            maxItems: 12,
            items: itemString,
        },
        canonicalUpdateCandidates: {
            type: 'array',
            items: {
                type: 'object',
                additionalProperties: false,
                required: [
                    'type', 'title', 'reason', 'action',
                    'targetDocumentId', 'confidence', 'keywords',
                ],
                properties: {
                    type: { type: 'string', enum: canonicalTypes },
                    title: itemString,
                    aliases: {
                        type: 'array',
                        maxItems: 32,
                        items: { type: 'string', minLength: 1, maxLength: 160 },
                    },
                    keywords: { type: 'array', maxItems: 24, items: { type: 'string', minLength: 1, maxLength: 80 } },
                    reason: itemString,
                    action: {
                        type: 'string', enum: ['create', 'update'],
                    },
                    targetDocumentId: {
                        oneOf: [itemString, { type: 'null' }],
                    },
                    confidence: {
                        type: 'number', minimum: 0, maximum: 1,
                    },
                },
            },
        },
    },
})

const memoryWriterProperties = JSON.parse(memoryWriterDraftSchema).properties

/** Turns one analysis call may cover; a reboot batch stays at two. */
export const MEMORY_BATCH_MAX_TURNS = 4

export function buildRebootBatchDraftSchema(turnCount?: number): string {
    return JSON.stringify({
        type: 'object',
        additionalProperties: false,
        required: [
            'turns', 'stateChanges', 'characterKnowledge',
            'persistentFacts', 'openContinuity', 'canonicalUpdateCandidates',
        ],
        properties: {
            turns: {
                type: 'array',
                minItems: turnCount ?? 1,
                maxItems: turnCount ?? 2,
                items: {
                    type: 'object', additionalProperties: false,
                    required: [
                        'title', 'establishedEvents', 'keywords',
                        'temporalHint',
                    ],
                    properties: {
                        title: { type: 'string', minLength: 1, maxLength: 160 },
                        establishedEvents:
                            memoryWriterProperties.establishedEvents,
                        keywords: memoryWriterProperties.keywords,
                        temporalHint: memoryWriterProperties.temporalHint,
                    },
                },
            },
            stateChanges: memoryWriterProperties.stateChanges,
            characterKnowledge: memoryWriterProperties.characterKnowledge,
            persistentFacts: memoryWriterProperties.persistentFacts,
            openContinuity: memoryWriterProperties.openContinuity,
            canonicalUpdateCandidates:
                memoryWriterProperties.canonicalUpdateCandidates,
        },
    })
}

export const rebootBatchDraftSchema = buildRebootBatchDraftSchema()

export const CANONICAL_EDIT_MAX_ITEMS = 128

export function buildCanonicalBatchSchema(candidateCount?: number): string {
    if (candidateCount !== undefined
        && (!Number.isSafeInteger(candidateCount) || candidateCount < 1)) {
        throw new Error('Canonical batch schema candidate count is invalid')
    }
    return JSON.stringify({
        type: 'object',
        additionalProperties: false,
        required: ['documents'],
        properties: {
            documents: {
                type: 'array',
                ...(candidateCount === undefined ? {} : {
                    minItems: candidateCount,
                    maxItems: candidateCount,
                }),
                items: {
                    type: 'object',
                    additionalProperties: false,
                    required: ['candidateIndex', 'sections'],
                    properties: {
                        candidateIndex: {
                            type: 'integer',
                            minimum: 0,
                            ...(candidateCount === undefined ? {} : {
                                maximum: candidateCount - 1,
                            }),
                        },
                        sections: {
                            type: 'array', minItems: 0, maxItems: 24,
                            items: {
                                type: 'object',
                                additionalProperties: false,
                                required: ['heading', 'operation', 'content', 'add', 'replace', 'remove'],
                                properties: {
                                    heading: {
                                        type: 'string', maxLength: 160,
                                    },
                                    operation: {
                                        type: 'string', enum: ['upsert', 'delete', 'edit'],
                                    },
                                    content: { type: 'string' },
                                    add: {
                                        type: 'array', maxItems: CANONICAL_EDIT_MAX_ITEMS,
                                        items: { type: 'string', minLength: 1 },
                                    },
                                    replace: {
                                        type: 'array', maxItems: CANONICAL_EDIT_MAX_ITEMS,
                                        items: {
                                            type: 'object', additionalProperties: false,
                                            required: ['index', 'text'],
                                            properties: {
                                                index: { type: 'integer', minimum: 0 },
                                                text: { type: 'string', minLength: 1 },
                                            },
                                        },
                                    },
                                    remove: {
                                        type: 'array', maxItems: CANONICAL_EDIT_MAX_ITEMS,
                                        items: {
                                            type: 'object', additionalProperties: false,
                                            required: ['index', 'reason', 'mergedInto'],
                                            properties: {
                                                index: { type: 'integer', minimum: 0 },
                                                reason: { type: 'string', enum: ['superseded', 'merged', 'corrected'] },
                                                mergedInto: { type: ['integer', 'null'], minimum: 0 },
                                            },
                                        },
                                    },
                                },
                            },
                        },
                    },
                },
            },
        },
    })
}

export const canonicalBatchSchema = buildCanonicalBatchSchema()

export function buildCanonicalSingleSchema(): string {
    const batch = JSON.parse(buildCanonicalBatchSchema(1)) as {
        properties: {
            documents: { items: { properties: { sections: unknown } } }
        }
    }
    return JSON.stringify({
        type: 'object',
        additionalProperties: false,
        required: ['sections'],
        properties: {
            sections: batch.properties.documents.items.properties.sections,
        },
    })
}

export const canonicalSingleSchema = buildCanonicalSingleSchema()

export const memoryWriterSystemPrompt = englishContract.trim()

export function buildMemoryWriterSystemPrompt(_language: WikiWritingLanguage): string {
    return memoryWriterSystemPrompt
}

export interface MemoryWriterDraft {
    schemaVersion: 1
    title: string
    keywords?: string[]
    temporalHint?: SemanticTemporalHint
    establishedEvents: string[]
    stateChanges: Array<{
        subject: string
        before: string | null
        after: string
    }>
    characterKnowledge: Array<{
        character: string
        fact: string
        stance: 'knows' | 'believes'
    }>
    persistentFacts: string[]
    openContinuity: string[]
    canonicalUpdateCandidates: Array<{
        type: typeof canonicalTypes[number]
        title: string
        aliases: string[]
        keywords?: string[]
        reason: string
        action: 'create' | 'update'
        targetDocumentId: string | null
        confidence: number
    }>
}

/**
 * Unit edits address the numbered units of an existing section. Units that
 * are not mentioned stay as they are; removing one needs a reason.
 */
export interface CanonicalUnitEdits {
    add: string[]
    replace: Array<{ index: number; text: string }>
    remove: Array<{ index: number; reason: 'superseded' | 'merged' | 'corrected'; mergedInto: number | null }>
}

export interface CanonicalSectionPatch {
    heading: string
    operation: 'upsert' | 'delete' | 'edit'
    content: string
    edits?: CanonicalUnitEdits
}

export interface CanonicalBatch {
    schemaVersion: 1
    documents: Array<{
        candidateIndex: number
        sections: CanonicalSectionPatch[]
    }>
}

export interface RebootBatchDraft extends Omit<
    MemoryWriterDraft,
    'title' | 'establishedEvents'
> {
    turns: Array<{
        assistantMessageId: string
        title: string
        establishedEvents: string[]
        keywords?: string[]
        temporalHint?: SemanticTemporalHint
    }>
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function withoutModelSchemaVersion(
    value: Record<string, unknown>
): Record<string, unknown> {
    const { schemaVersion: _schemaVersion, ...modelFields } = value
    return modelFields
}

function exactKeys(
    value: Record<string, unknown>,
    keys: readonly string[],
    label: string
): void {
    const expected = new Set(keys)
    for (const key of Object.keys(value)) {
        if (!expected.has(key)) throw new Error(`Unexpected ${label} field: ${key}`)
    }
    for (const key of keys) {
        if (!Object.prototype.hasOwnProperty.call(value, key)) {
            throw new Error(`Missing ${label} field: ${key}`)
        }
    }
}

function text(value: unknown, label: string, maximum = 500): string {
    if (typeof value !== 'string') throw new Error(`${label} must be a string`)
    const normalized = value.trim()
        .replace(/[\r\n\u0000]+/g, ' ')
        .replace(/\s{2,}/g, ' ')
    if (normalized.length < 1 || normalized.length > maximum) {
        throw new Error(`${label} must contain 1-${maximum} characters`)
    }
    return normalized
}

function boundedArray(
    value: unknown,
    label: string,
    maximum = Number.MAX_SAFE_INTEGER
): unknown[] {
    if (!Array.isArray(value) || value.length > maximum) {
        throw new Error(`${label} must be an array of at most ${maximum} items`)
    }
    return value
}

export function parseTemporalHint(value: unknown): SemanticTemporalHint | undefined {
    if (value === undefined) return undefined
    if (!isRecord(value)) throw new Error('temporalHint must be an object')
    // Drafts saved before flashbacks and in-story dates carry only the first two fields.
    const extended = ['timeline', 'flashbackAmount', 'flashbackUnit', 'calendar']
    exactKeys(value, ['elapsedDays', 'evidence',
        ...(extended.some((key) => Object.hasOwn(value, key)) ? extended : [])], 'temporalHint')
    if (value.elapsedDays !== null
        && (!Number.isSafeInteger(value.elapsedDays)
            || (value.elapsedDays as number) < 0)) {
        throw new Error('temporalHint.elapsedDays must be a non-negative integer or null')
    }
    if (typeof value.evidence !== 'string' || value.evidence.length > 240
        || (value.elapsedDays !== null && !value.evidence.trim())) {
        throw new Error('temporalHint.evidence is invalid')
    }
    if (value.timeline === undefined) {
        return { elapsedDays: value.elapsedDays as number | null, evidence: value.evidence }
    }
    if ((value.timeline !== 'present' && value.timeline !== 'flashback')
        || (value.flashbackAmount !== null && (!Number.isSafeInteger(value.flashbackAmount)
            || (value.flashbackAmount as number) < 0))
        || !STORY_TIME_UNITS.includes(value.flashbackUnit as StoryTimeUnit)
        || typeof value.calendar !== 'string' || value.calendar.length > 120) {
        throw new Error('temporalHint timeline fields are invalid')
    }
    return {
        elapsedDays: value.elapsedDays as number | null,
        evidence: value.evidence,
        timeline: value.timeline,
        flashbackAmount: value.flashbackAmount as number | null,
        flashbackUnit: value.flashbackUnit as StoryTimeUnit,
        calendar: value.calendar,
    }
}

export function parseMemoryWriterDraft(output: string): MemoryWriterDraft {
    const raw = parseSingleJsonObject(output)
    if (!isRecord(raw)) throw new Error('Memory draft must be an object')
    const parsed: Record<string, unknown> = {
        keywords: undefined,
        temporalHint: undefined,
        ...withoutModelSchemaVersion(raw),
    }
    exactKeys(parsed, [
        'title',
        'establishedEvents',
        'stateChanges',
        'characterKnowledge',
        'persistentFacts',
        'openContinuity',
        'canonicalUpdateCandidates',
        'keywords',
        'temporalHint',
    ], 'memory draft')
    const keywords = parsed.keywords === undefined ? undefined : normalizeMemoryRetrievalKeywords(parsed.keywords)
    const temporalHint = parseTemporalHint(parsed.temporalHint)
    const strings = (value: unknown, label: string) => boundedArray(
        value,
        label,
        12
    ).map((item, index) => text(item, `${label}[${index}]`))
    const establishedEvents = strings(
        parsed.establishedEvents,
        'establishedEvents'
    )
    const stateChanges = boundedArray(parsed.stateChanges, 'stateChanges', 12)
        .map((item, index) => {
            if (!isRecord(item)) throw new Error(`stateChanges[${index}] must be an object`)
            exactKeys(item, ['subject', 'before', 'after'], `stateChanges[${index}]`)
            return {
                subject: text(item.subject, `stateChanges[${index}].subject`),
                before: item.before === null
                    ? null
                    : text(item.before, `stateChanges[${index}].before`),
                after: text(item.after, `stateChanges[${index}].after`),
            }
        })
    const characterKnowledge = boundedArray(
        parsed.characterKnowledge,
        'characterKnowledge',
        12
    ).map((item, index) => {
        if (!isRecord(item)) throw new Error(`characterKnowledge[${index}] must be an object`)
        exactKeys(item, ['character', 'fact', 'stance'], `characterKnowledge[${index}]`)
        if (item.stance !== 'knows' && item.stance !== 'believes') {
            throw new Error(`characterKnowledge[${index}].stance is invalid`)
        }
        return {
            character: text(item.character, `characterKnowledge[${index}].character`),
            fact: text(item.fact, `characterKnowledge[${index}].fact`),
            stance: item.stance as 'knows' | 'believes',
        }
    })
    const persistentFacts = strings(parsed.persistentFacts, 'persistentFacts')
    const openContinuity = strings(parsed.openContinuity, 'openContinuity')
    const canonicalUpdateCandidates = boundedArray(
        parsed.canonicalUpdateCandidates,
        'canonicalUpdateCandidates'
    ).map((item, index) => {
        if (!isRecord(item)) throw new Error(`canonicalUpdateCandidates[${index}] must be an object`)
        const candidateWithAction = !Object.prototype.hasOwnProperty.call(item, 'action')
            && Object.prototype.hasOwnProperty.call(item, 'operation')
            ? { ...item, action: item.operation }
            : item
        if (candidateWithAction !== item) delete candidateWithAction.operation
        const candidate = Object.prototype.hasOwnProperty.call(
            candidateWithAction, 'aliases'
        ) ? candidateWithAction : { ...candidateWithAction, aliases: [] }
        exactKeys({ keywords: undefined, ...candidate }, [
            'type', 'title', 'aliases', 'reason', 'action',
            'targetDocumentId', 'confidence', 'keywords',
        ], `canonicalUpdateCandidates[${index}]`)
        if (!canonicalTypes.includes(candidate.type as typeof canonicalTypes[number])) {
            throw new Error(`canonicalUpdateCandidates[${index}].type is invalid`)
        }
        if (candidate.action !== 'create' && candidate.action !== 'update') {
            throw new Error(`canonicalUpdateCandidates[${index}].action is invalid`)
        }
        const targetDocumentId = candidate.targetDocumentId === null
            ? null
            : text(
                candidate.targetDocumentId,
                `canonicalUpdateCandidates[${index}].targetDocumentId`
            )
        if ((candidate.action === 'create' && targetDocumentId !== null)
            || (candidate.action === 'update' && targetDocumentId === null)) {
            throw new Error(
                `canonicalUpdateCandidates[${index}].targetDocumentId does not match action`
            )
        }
        if (typeof candidate.confidence !== 'number'
            || !Number.isFinite(candidate.confidence)
            || candidate.confidence < 0
            || candidate.confidence > 1) {
            throw new Error(`canonicalUpdateCandidates[${index}].confidence is invalid`)
        }
        const aliases: string[] = []
        const aliasKeys = new Set<string>()
        for (const [aliasIndex, alias] of boundedArray(
            candidate.aliases,
            `canonicalUpdateCandidates[${index}].aliases`,
            32
        ).entries()) {
            const normalized = text(
                alias,
                `canonicalUpdateCandidates[${index}].aliases[${aliasIndex}]`,
                160
            )
            const key = normalized.normalize('NFKC').toLocaleLowerCase()
            if (!aliasKeys.has(key)) {
                aliasKeys.add(key)
                aliases.push(normalized)
            }
        }
        return {
            type: candidate.type as typeof canonicalTypes[number],
            title: text(candidate.title, `canonicalUpdateCandidates[${index}].title`),
            aliases,
            reason: text(candidate.reason, `canonicalUpdateCandidates[${index}].reason`),
            action: candidate.action as 'create' | 'update',
            targetDocumentId,
            confidence: candidate.confidence,
            ...(candidate.keywords === undefined ? {} : {
                keywords: normalizeMemoryRetrievalKeywords(candidate.keywords),
            }),
        }
    })
    return {
        schemaVersion: 1,
        title: text(parsed.title, 'title', 160),
        establishedEvents,
        stateChanges,
        characterKnowledge,
        persistentFacts,
        openContinuity,
        canonicalUpdateCandidates,
        ...(keywords ? { keywords } : {}),
        ...(temporalHint ? { temporalHint } : {}),
    }
}

export function parseRebootBatchDraft(
    output: string,
    expectedAssistantMessageIds: readonly string[]
): RebootBatchDraft {
    const raw = parseSingleJsonObject(output)
    if (!isRecord(raw)) throw new Error('Reboot batch draft must be an object')
    const parsed = withoutModelSchemaVersion(raw)
    exactKeys(parsed, [
        'turns', 'stateChanges', 'characterKnowledge',
        'persistentFacts', 'openContinuity', 'canonicalUpdateCandidates',
    ], 'reboot batch draft')
    if (expectedAssistantMessageIds.length < 1
        || expectedAssistantMessageIds.length > MEMORY_BATCH_MAX_TURNS) {
        throw new Error(`Reboot batch requires one to ${MEMORY_BATCH_MAX_TURNS} assistant IDs`)
    }
    const rawTurns = boundedArray(parsed.turns, 'reboot batch turns', MEMORY_BATCH_MAX_TURNS)
    if (rawTurns.length !== expectedAssistantMessageIds.length) {
        throw new Error('Reboot batch turn count does not match assistant IDs')
    }
    const legacyAssistantMessageIds: Array<string | undefined> = []
    const turns = rawTurns.map((item, index) => {
        if (!isRecord(item)) {
            throw new Error(`reboot batch turns[${index}] must be an object`)
        }
        const hasLegacyAssistantMessageId = Object.prototype.hasOwnProperty.call(
            item,
            'assistantMessageId'
        )
        const turn: Record<string, unknown> = { keywords: undefined, temporalHint: undefined, ...item }
        exactKeys(turn, [
            ...(hasLegacyAssistantMessageId ? ['assistantMessageId'] : []),
            'title',
            'establishedEvents',
            'keywords',
            'temporalHint',
        ], `reboot batch turns[${index}]`)
        legacyAssistantMessageIds[index] = undefined
        if (hasLegacyAssistantMessageId) {
            legacyAssistantMessageIds[index] = text(
                item.assistantMessageId,
                `reboot batch turns[${index}].assistantMessageId`,
                1_024
            )
        }
        const turnTemporalHint = parseTemporalHint(turn.temporalHint)
        return {
            assistantMessageId: expectedAssistantMessageIds[index],
            title: text(turn.title, `reboot batch turns[${index}].title`, 160),
            establishedEvents: boundedArray(
                turn.establishedEvents,
                `reboot batch turns[${index}].establishedEvents`,
            12
            ).map((event, eventIndex) => text(
                event,
                `reboot batch turns[${index}].establishedEvents[${eventIndex}]`
            )),
            ...(turn.keywords === undefined ? {} : {
                keywords: normalizeMemoryRetrievalKeywords(turn.keywords),
            }),
            ...(turnTemporalHint ? {
                temporalHint: turnTemporalHint,
            } : {}),
        }
    })
    const expectedIdSet = new Set(expectedAssistantMessageIds)
    const legacyIdsAreTrusted = legacyAssistantMessageIds.length
        === expectedAssistantMessageIds.length
        && legacyAssistantMessageIds.every((id) =>
            id !== undefined && expectedIdSet.has(id)
        )
    if (legacyIdsAreTrusted && legacyAssistantMessageIds.some(
        (id, index) => id !== expectedAssistantMessageIds[index]
    )) {
        throw new Error('Reboot batch assistant order does not match input')
    }
    const aggregate = parseMemoryWriterDraft(JSON.stringify({
        title: turns.map((turn) => turn.title).join(' · ').slice(0, 160),
        establishedEvents: turns.flatMap((turn) => turn.establishedEvents)
            .slice(0, 12),
        stateChanges: parsed.stateChanges,
        characterKnowledge: parsed.characterKnowledge,
        persistentFacts: parsed.persistentFacts,
        openContinuity: parsed.openContinuity,
        canonicalUpdateCandidates: parsed.canonicalUpdateCandidates,
    }))
    const { title: _title, establishedEvents: _events, ...shared } = aggregate
    return { ...shared, turns }
}

export function rebootBatchToMemoryDraft(
    draft: RebootBatchDraft
): MemoryWriterDraft {
    const { turns, ...shared } = draft
    return {
        ...shared,
        title: turns.map((turn) => turn.title).join(' · ').slice(0, 160),
        establishedEvents: turns.flatMap((turn) =>
            turn.establishedEvents
        ).slice(0, 12),
    }
}

function parseCanonicalUnitEdits(section: Record<string, unknown>, label: string): CanonicalUnitEdits {
    const add = boundedArray(section.add ?? [], `${label}.add`, CANONICAL_EDIT_MAX_ITEMS).map((text, index) => {
        if (typeof text !== 'string' || !text.trim()) throw new Error(`${label}.add[${index}] is invalid`)
        return text.trim()
    })
    const replace = boundedArray(section.replace ?? [], `${label}.replace`, CANONICAL_EDIT_MAX_ITEMS).map((item, index) => {
        if (!isRecord(item)) throw new Error(`${label}.replace[${index}] must be an object`)
        exactKeys(item, ['index', 'text'], `${label}.replace[${index}]`)
        if (!Number.isSafeInteger(item.index) || (item.index as number) < 0
            || typeof item.text !== 'string' || !item.text.trim()) {
            throw new Error(`${label}.replace[${index}] is invalid`)
        }
        return { index: item.index as number, text: item.text.trim() }
    })
    const remove = boundedArray(section.remove ?? [], `${label}.remove`, CANONICAL_EDIT_MAX_ITEMS).map((item, index) => {
        if (!isRecord(item)) throw new Error(`${label}.remove[${index}] must be an object`)
        exactKeys(item, ['index', 'reason', 'mergedInto'], `${label}.remove[${index}]`)
        if (!Number.isSafeInteger(item.index) || (item.index as number) < 0
            || !['superseded', 'merged', 'corrected'].includes(item.reason as string)
            || (item.mergedInto !== null && (!Number.isSafeInteger(item.mergedInto) || (item.mergedInto as number) < 0))) {
            throw new Error(`${label}.remove[${index}] is invalid`)
        }
        return {
            index: item.index as number,
            reason: item.reason as CanonicalUnitEdits['remove'][number]['reason'],
            mergedInto: item.mergedInto as number | null,
        }
    })
    return { add, replace, remove }
}

export function parseCanonicalBatch(
    output: string,
    candidateCount: number
): CanonicalBatch {
    const raw = parseSingleJsonObjectMatching(output, (candidate) =>
        Array.isArray(candidate.documents)
    )
    if (!isRecord(raw)) throw new Error('Canonical batch must be an object')
    const parsed = withoutModelSchemaVersion(raw)
    exactKeys(parsed, ['documents'], 'canonical batch')
    if (!Number.isSafeInteger(candidateCount)
        || candidateCount < 0) {
        throw new Error('Canonical batch candidate count is invalid')
    }
    const used = new Set<number>()
    const documents = boundedArray(
        parsed.documents,
        'canonical batch documents',
        candidateCount
    ).map((item, index) => {
        if (!isRecord(item)) {
            throw new Error(`canonical batch documents[${index}] must be an object`)
        }
        exactKeys(
            item,
            ['candidateIndex', 'sections'],
            `canonical batch documents[${index}]`
        )
        if (!Number.isSafeInteger(item.candidateIndex)
            || (item.candidateIndex as number) < 0
            || (item.candidateIndex as number) >= candidateCount
            || used.has(item.candidateIndex as number)) {
            throw new Error(
                `canonical batch documents[${index}].candidateIndex is invalid`
            )
        }
        const headings = new Set<string>()
        const sections = boundedArray(
            item.sections,
            `canonical batch documents[${index}].sections`,
            24
        ).map<CanonicalSectionPatch>((section, sectionIndex) => {
            if (!isRecord(section)) {
                throw new Error(
                    `canonical batch documents[${index}].sections[${sectionIndex}] must be an object`
                )
            }
            const label = `canonical batch documents[${index}].sections[${sectionIndex}]`
            // Older providers and prompts return only heading, operation and content.
            exactKeys(
                section,
                Object.hasOwn(section, 'add') || Object.hasOwn(section, 'replace') || Object.hasOwn(section, 'remove')
                    ? ['heading', 'operation', 'content', 'add', 'replace', 'remove']
                    : ['heading', 'operation', 'content'],
                label
            )
            if (typeof section.heading !== 'string'
                || section.heading.length > 160
                || /[\r\n]/u.test(section.heading)) {
                throw new Error(
                    `canonical batch documents[${index}].sections[${sectionIndex}].heading is invalid`
                )
            }
            const heading = section.heading.trim()
            const headingKey = normalizeCanonicalSectionHeading(heading)
            if (headings.has(headingKey)) {
                throw new Error(
                    `canonical batch documents[${index}].sections[${sectionIndex}].heading is duplicated`
                )
            }
            headings.add(headingKey)
            const operation = section.operation
            if (operation !== 'upsert'
                && operation !== 'delete'
                && operation !== 'edit') {
                throw new Error(
                    `canonical batch documents[${index}].sections[${sectionIndex}].operation is invalid`
                )
            }
            if (typeof section.content !== 'string') {
                throw new Error(
                    `canonical batch documents[${index}].sections[${sectionIndex}].content is invalid`
                )
            }
            const content = section.content.trim()
            if ((operation === 'upsert' && content.length === 0)
                || (operation === 'delete' && content.length > 0)
                || (operation === 'edit' && heading.length === 0)) {
                throw new Error(
                    `canonical batch documents[${index}].sections[${sectionIndex}].content does not match operation`
                )
            }
            if (operation !== 'edit') return { heading, operation, content }
            const edits = parseCanonicalUnitEdits(section, label)
            // An edit that carries only a body is a whole-section rewrite; the
            // program's preservation check still applies to it.
            if (content && edits.add.length + edits.replace.length + edits.remove.length === 0) {
                return { heading, operation: 'upsert', content }
            }
            return { heading, operation, content: '', edits }
        })
        used.add(item.candidateIndex as number)
        return {
            candidateIndex: item.candidateIndex as number,
            sections,
        }
    })
    return { schemaVersion: 1, documents }
}

// Only isolate content failures after the entire envelope has unambiguous routing.
// Each surviving entry still goes through the same strict parser as a full batch.
export function parseCanonicalBatchIsolated(output: string, candidateCount: number): CanonicalBatch & {
    failures: Array<{ candidateIndex: number; error: Error }>
} {
    const value = parseSingleJsonObjectMatching(output, (candidate) => Array.isArray(candidate.documents))
    if (!isRecord(value)) throw new Error('Canonical batch must be an object')
    const raw = withoutModelSchemaVersion(value)
    exactKeys(raw, ['documents'], 'canonical batch')
    const items = boundedArray(raw.documents, 'canonical batch documents', candidateCount)
    parseCanonicalBatch(JSON.stringify({ documents: items.map((item) => ({
        candidateIndex: isRecord(item) ? item.candidateIndex : undefined,
        sections: [],
    })) }), candidateCount)
    const documents: CanonicalBatch['documents'] = []
    const failures: Array<{ candidateIndex: number; error: Error }> = []
    const seen = new Set<number>()
    for (const item of items) {
        const candidateIndex = (item as { candidateIndex: number }).candidateIndex
        seen.add(candidateIndex)
        try {
            documents.push(parseCanonicalBatch(JSON.stringify({ documents: [item] }), candidateCount).documents[0])
        }
        catch (error) {
            failures.push({ candidateIndex, error: error instanceof Error ? error : new Error('Invalid canonical document') })
        }
    }
    for (let candidateIndex = 0; candidateIndex < candidateCount; candidateIndex++) {
        if (!seen.has(candidateIndex)) failures.push({ candidateIndex, error: new Error('Missing canonical target; return its complete changed sections.') })
    }
    return { schemaVersion: 1, documents, failures }
}

export function parseCanonicalSingle(output: string): CanonicalBatch['documents'][number] {
    const parsed = parseSingleJsonObjectMatching(output, (candidate) =>
        Array.isArray(candidate.sections)
    )
    if (!isRecord(parsed)) throw new Error('Canonical single result must be an object')
    exactKeys(parsed, ['sections'], 'canonical single result')
    return parseCanonicalBatch(JSON.stringify({
        documents: [{ candidateIndex: 0, sections: parsed.sections }],
    }), 1).documents[0]
}

export function hasMemoryWriterContent(draft: MemoryWriterDraft): boolean {
    return draft.establishedEvents.length + draft.stateChanges.length
        + draft.characterKnowledge.length + draft.persistentFacts.length
        + draft.openContinuity.length > 0
}

export function serializeMemoryWriterDraft(draft: MemoryWriterDraft, language: WikiWritingLanguage = 'ko'): string {
    const lines = [`## ${draft.title}`]
    if (draft.establishedEvents.length > 0) {
        lines.push('', `### ${wikiWritingHeadings[normalizeWikiWritingLanguage(language)].summary}`, '')
        lines.push(...draft.establishedEvents.map((item) =>
            item.startsWith('- ') ? item : `- ${item}`
        ))
    }
    return lines.join('\n')
}
