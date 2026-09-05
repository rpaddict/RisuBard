import {
    parseSingleJsonObject,
    parseSingleJsonObjectMatching,
} from '../../packages/risubard-core/src/modelOutput'
import skillInstructions from '../../src/ts/risubard/skills/bardwiki-memory-writer/SKILL.md?raw'
import eventSchemaReference from '../../src/ts/risubard/skills/bardwiki-memory-writer/references/event-schema.md?raw'
import englishContract from '../../src/ts/risubard/skills/bardwiki-memory-writer/references/english-contract.md?raw'
import {
    buildWikiWritingLanguageGuard,
    normalizeWikiWritingLanguage,
    wikiWritingHeadings,
    type WikiWritingLanguage,
} from '../../src/ts/risubard/wikiWritingLanguage'
import { normalizeCanonicalSectionHeading } from './risubard-markdown-section-patch'

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
    ],
    properties: {
        title: { type: 'string', minLength: 1, maxLength: 160 },
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
                    before: { oneOf: [itemString, { type: 'null' }] },
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
                    'targetDocumentId', 'confidence',
                ],
                properties: {
                    type: { type: 'string', enum: canonicalTypes },
                    title: itemString,
                    aliases: {
                        type: 'array',
                        maxItems: 32,
                        items: { type: 'string', minLength: 1, maxLength: 160 },
                    },
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

export function buildRebootBatchDraftSchema(turnCount?: 1 | 2): string {
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
                    required: ['title', 'establishedEvents'],
                    properties: {
                        title: { type: 'string', minLength: 1, maxLength: 160 },
                        establishedEvents:
                            memoryWriterProperties.establishedEvents,
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
                                required: ['heading', 'operation', 'content'],
                                properties: {
                                    heading: {
                                        type: 'string', maxLength: 160,
                                    },
                                    operation: {
                                        type: 'string', enum: ['upsert', 'delete'],
                                    },
                                    content: {
                                        type: 'string', maxLength: 4_000,
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

export const memoryWriterSystemPrompt = [
    skillInstructions.trim(),
    '## 런타임 필드 계약',
    eventSchemaReference.trim(),
    'update의 targetDocumentId는 existingNotes의 실제 ID, create는 null이다.',
    '같은 실체는 제목이 달라도 update다. confidence는 0~1이다.',
    '반드시 제공된 JSON Schema에 맞는 JSON 객체 하나만 반환하라. Markdown, YAML, 코드 펜스, 해설을 반환하지 마라.',
].join('\n\n')

export function buildMemoryWriterSystemPrompt(language: WikiWritingLanguage): string {
    if (language === 'en') return englishContract.trim()
    if (language === 'ja') {
        return [
            englishContract.trim(),
            buildWikiWritingLanguageGuard('ja'),
        ].join('\n\n')
    }
    return memoryWriterSystemPrompt
}

export interface MemoryWriterDraft {
    schemaVersion: 1
    title: string
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
        reason: string
        action: 'create' | 'update'
        targetDocumentId: string | null
        confidence: number
    }>
}

export interface CanonicalSectionPatch {
    heading: string
    operation: 'upsert' | 'delete'
    content: string
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

export function parseMemoryWriterDraft(output: string): MemoryWriterDraft {
    const raw = parseSingleJsonObject(output)
    if (!isRecord(raw)) throw new Error('Memory draft must be an object')
    const parsed = withoutModelSchemaVersion(raw)
    exactKeys(parsed, [
        'title',
        'establishedEvents',
        'stateChanges',
        'characterKnowledge',
        'persistentFacts',
        'openContinuity',
        'canonicalUpdateCandidates',
    ], 'memory draft')
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
        exactKeys(candidate, [
            'type', 'title', 'aliases', 'reason', 'action',
            'targetDocumentId', 'confidence',
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
        || expectedAssistantMessageIds.length > 2) {
        throw new Error('Reboot batch requires one or two assistant IDs')
    }
    const rawTurns = boundedArray(parsed.turns, 'reboot batch turns', 2)
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
        exactKeys(item, [
            ...(hasLegacyAssistantMessageId ? ['assistantMessageId'] : []),
            'title',
            'establishedEvents',
        ], `reboot batch turns[${index}]`)
        legacyAssistantMessageIds[index] = undefined
        if (hasLegacyAssistantMessageId) {
            legacyAssistantMessageIds[index] = text(
                item.assistantMessageId,
                `reboot batch turns[${index}].assistantMessageId`,
                1_024
            )
        }
        return {
            assistantMessageId: expectedAssistantMessageIds[index],
            title: text(item.title, `reboot batch turns[${index}].title`, 160),
            establishedEvents: boundedArray(
                item.establishedEvents,
                `reboot batch turns[${index}].establishedEvents`,
                12
            ).map((event, eventIndex) => text(
                event,
                `reboot batch turns[${index}].establishedEvents[${eventIndex}]`
            )),
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
        let totalLength = 0
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
            exactKeys(
                section,
                ['heading', 'operation', 'content'],
                `canonical batch documents[${index}].sections[${sectionIndex}]`
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
                && operation !== 'delete') {
                throw new Error(
                    `canonical batch documents[${index}].sections[${sectionIndex}].operation is invalid`
                )
            }
            if (typeof section.content !== 'string'
                || section.content.length > 4_000) {
                throw new Error(
                    `canonical batch documents[${index}].sections[${sectionIndex}].content is invalid`
                )
            }
            const content = section.content.trim()
            if ((operation === 'upsert' && content.length === 0)
                || (operation === 'delete' && content.length > 0)) {
                throw new Error(
                    `canonical batch documents[${index}].sections[${sectionIndex}].content does not match operation`
                )
            }
            totalLength += heading.length + content.length
            if (totalLength > 12_000) {
                throw new Error(
                    `canonical batch documents[${index}].sections are too large`
                )
            }
            return {
                heading,
                operation,
                content,
            }
        })
        used.add(item.candidateIndex as number)
        return {
            candidateIndex: item.candidateIndex as number,
            sections,
        }
    })
    return { schemaVersion: 1, documents }
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
