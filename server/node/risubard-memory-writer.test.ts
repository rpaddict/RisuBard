import { describe, expect, test } from 'vitest'
import {
    canonicalBatchSchema,
    buildCanonicalBatchSchema,
    buildCanonicalSingleSchema,
    buildRebootBatchDraftSchema,
    memoryWriterDraftSchema,
    memoryWriterSystemPrompt,
    hasMemoryWriterContent,
    parseMemoryWriterDraft,
    parseCanonicalBatch,
    parseCanonicalSingle,
    parseRebootBatchDraft,
    serializeMemoryWriterDraft,
    buildMemoryWriterSystemPrompt,
} from './risubard-memory-writer'

describe('BardWiki memory writer skill', () => {
    test('provides an English recording contract and deterministic English headings', () => {
        const prompt = buildMemoryWriterSystemPrompt('en')
        expect(prompt).toContain('canonicalUpdateCandidates')
        expect(prompt).toContain('characterKnowledge')
        expect(prompt).toContain('Reserved story arc plot')
        expect(prompt).toContain('configured confirmed-event checkpoint')
        expect(prompt).not.toMatch(/[가-힣]/)
        const draft = parseMemoryWriterDraft(JSON.stringify({
            schemaVersion: 1, title: 'Arrival', establishedEvents: ['Alice arrived.'],
            stateChanges: [], characterKnowledge: [], persistentFacts: [],
            openContinuity: [], canonicalUpdateCandidates: [],
        }))
        expect(serializeMemoryWriterDraft(draft, 'en')).toBe(
            '## Arrival\n\n### Story Summary\n\n- Alice arrived.'
        )
    })

    test('uses one project-owned recording contract for every output locale', () => {
        for (const locale of ['ko', 'en', 'ja', 'zh-Hans', 'zh-Hant'] as const) {
            expect(buildMemoryWriterSystemPrompt(locale)).toBe(memoryWriterSystemPrompt)
        }
        expect(memoryWriterSystemPrompt).toContain('bardwiki-memory-writer')
        expect(memoryWriterSystemPrompt).toContain('User instructions are not event evidence')
        expect(memoryWriterSystemPrompt).toContain('IDs, paths, evidence metadata')
        expect(memoryWriterSystemPrompt).toContain('character knowledge')
        expect(memoryWriterSystemPrompt).toContain('self-contained chronological story summary')
        expect(memoryWriterSystemPrompt).toContain('Reserved story arc plot')
        expect(memoryWriterSystemPrompt).toContain('configured confirmed-event checkpoint')
        expect(memoryWriterSystemPrompt).toContain('species or monsters')
        expect(memoryWriterSystemPrompt).toContain('named sublocations')
        expect(memoryWriterSystemPrompt).toContain('unresolved investigations')
        expect(memoryWriterSystemPrompt).toContain('event documents')
    })

    test('keeps schemaVersion out of model-owned writer contracts', () => {
        const draftSchema = JSON.parse(memoryWriterDraftSchema)
        const rebootSchema = JSON.parse(buildRebootBatchDraftSchema(1))
        const canonicalSchema = JSON.parse(buildCanonicalBatchSchema(1))

        for (const schema of [draftSchema, rebootSchema, canonicalSchema]) {
            expect(schema.required).not.toContain('schemaVersion')
            expect(schema.properties).not.toHaveProperty('schemaVersion')
        }
        expect(parseMemoryWriterDraft(JSON.stringify({
            title: '도착', establishedEvents: ['도착했다.'],
            stateChanges: [], characterKnowledge: [], persistentFacts: [],
            openContinuity: [], canonicalUpdateCandidates: [],
        }))).toMatchObject({ schemaVersion: 1, title: '도착' })
        expect(parseCanonicalBatch(JSON.stringify({
            documents: [{ candidateIndex: 0, sections: [] }],
        }), 1)).toMatchObject({
            schemaVersion: 1,
            documents: [{ candidateIndex: 0, sections: [] }],
        })
    })

    test('uses an OpenAI-compatible nullable type for stateChanges.before', () => {
        const schema = JSON.parse(memoryWriterDraftSchema)
        const before = schema.properties.stateChanges.items.properties.before

        expect(before).toEqual({
            type: ['string', 'null'],
            minLength: 1,
            maxLength: 500,
        })
        expect(JSON.stringify(before)).not.toContain('oneOf')
    })

    test('describes every required canonical candidate field without contradicting the schema', () => {
        const candidateContract = memoryWriterSystemPrompt
            .split('- canonicalUpdateCandidates:')[1]
            ?.split('\n\n')[0] ?? ''
        for (const field of [
            'type', 'title', 'reason', 'action', 'targetDocumentId', 'confidence',
        ]) {
            expect(candidateContract).toContain(field)
        }
    })

    test('teaches general narrative value and omission-cost judgment', () => {
        expect(memoryWriterSystemPrompt).toContain('costly omissions')
        expect(memoryWriterSystemPrompt).toContain('not yet represented')
        expect(memoryWriterSystemPrompt).not.toContain(
            '명시적인 프로필이 나온 인물을 모두 포함'
        )
    })

    test('separates first registration from durable-change updates', () => {
        const creation = memoryWriterSystemPrompt
            .split('### First registration (create)')[1]
            ?.split('### Existing updates (update)')[0] ?? ''
        const updates = memoryWriterSystemPrompt
            .split('### Existing updates (update)')[1]
            ?.split('### Coverage and priority')[0] ?? ''
        expect(creation).toContain('without waiting for a complete profile')
        expect(creation).toContain('important participant')
        expect(creation).toContain('mention in an event or another character')
        expect(creation).toContain('one-off participants')
        expect(updates).toContain('not yet represented')
        expect(updates).toContain('actions sufficiently recorded in the event')
        expect(updates).toContain('Do not propose updates')
        expect(memoryWriterSystemPrompt).not.toContain(
            '후보를 만들려면 확정 본문이 기존 정본에 아직 대표되지 않은'
        )
    })

    test('checks coverage per important participant without favoring the protagonist', () => {
        const coverage = memoryWriterSystemPrompt
            .split('### Coverage and priority')[1]
            ?.split('### Reserved story arc plot')[0] ?? ''
        expect(coverage).toContain('every important participant')
        expect(coverage).toContain('characterKnowledge')
        expect(coverage).toContain("protagonist's document")
        expect(coverage).toContain('first registration')
        expect(coverage).toContain('Never fill the candidate budget with guesses')
        expect(coverage).toContain('do not add output fields')
    })

    test('publishes a strict bounded JSON schema', () => {
        const schema = JSON.parse(memoryWriterDraftSchema)
        expect(schema).toMatchObject({
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
        })
        expect(schema.properties.establishedEvents.maxItems).toBe(12)
        expect(schema.properties.schemaVersion).toBeUndefined()
        expect(JSON.parse(canonicalBatchSchema).properties.schemaVersion)
            .toBeUndefined()
        expect(schema.properties.characterKnowledge.items.properties.stance)
            .toMatchObject({ type: 'string' })
        expect(schema.properties.canonicalUpdateCandidates.items.properties.type)
            .toMatchObject({ type: 'string' })
        expect(schema.properties.canonicalUpdateCandidates.items.properties.action)
            .toMatchObject({ type: 'string' })
        expect(schema.properties.canonicalUpdateCandidates.items.properties.aliases)
            .toMatchObject({ type: 'array', maxItems: 32 })
    })

    test('accepts creature canon candidates', () => {
        const schema = JSON.parse(memoryWriterDraftSchema)
        expect(schema.properties.canonicalUpdateCandidates.items.properties.type.enum)
            .toContain('creature')
        const draft = parseMemoryWriterDraft(JSON.stringify({
            title: '좀비 출현', establishedEvents: ['좀비가 나타났다.'],
            stateChanges: [], characterKnowledge: [], persistentFacts: [],
            openContinuity: [], canonicalUpdateCandidates: [{
                type: 'creature', title: '좀비', aliases: [],
                reason: '반복해서 등장할 생물 종류의 규칙이 확정되었다.',
                action: 'create', targetDocumentId: null, confidence: 0.95,
            }],
        }))
        expect(draft.canonicalUpdateCandidates[0].type).toBe('creature')
    })

    test('supports canonical target budgets above eight while validating index membership', () => {
        const candidates = Array.from({ length: 10 }, (_, index) => ({
            type: 'character', title: `인물 ${index}`, reason: '지속 상태가 바뀌었다.',
            action: 'create', targetDocumentId: null, confidence: 0.9,
        }))
        const draft = parseMemoryWriterDraft(JSON.stringify({
            schemaVersion: 1, title: '상태 변경', establishedEvents: ['상태가 바뀌었다.'],
            stateChanges: [], characterKnowledge: [], persistentFacts: [],
            openContinuity: [], canonicalUpdateCandidates: candidates,
        }))
        expect(draft.canonicalUpdateCandidates).toHaveLength(10)
        const documents = candidates.map((candidate, candidateIndex) => ({
            candidateIndex,
            sections: [{
                heading: '', operation: 'upsert',
                content: `${candidate.title}의 변경된 상태`,
            }],
        }))
        expect(parseCanonicalBatch(JSON.stringify({ schemaVersion: 1, documents }), 10).documents).toHaveLength(10)
        expect(() => parseCanonicalBatch(JSON.stringify({ schemaVersion: 1, documents }), 9)).toThrow()
        expect(() => parseCanonicalBatch(JSON.stringify({ schemaVersion: 1, documents: [documents[0], documents[0]] }), 10)).toThrow(/candidateIndex/)
        expect(JSON.parse(memoryWriterDraftSchema).properties.canonicalUpdateCandidates.maxItems).toBeUndefined()
        const schema = JSON.parse(canonicalBatchSchema).properties.documents
        expect(schema.maxItems).toBeUndefined()
        expect(schema.items.properties.candidateIndex.maximum).toBeUndefined()
        const boundedSchema = JSON.parse(buildCanonicalBatchSchema(10))
            .properties.documents
        expect(boundedSchema).toMatchObject({ minItems: 10, maxItems: 10 })
        expect(boundedSchema.items.properties.candidateIndex.maximum).toBe(9)
    })

    test('parses bounded canonical section patches and rejects full document rewrites', () => {
        const output = JSON.stringify({
            schemaVersion: 1,
            documents: [{
                candidateIndex: 0,
                sections: [{
                    heading: '현재 상태',
                    operation: 'upsert',
                    content: '- 석사 학위 취득 완료',
                }],
            }],
        })

        expect(parseCanonicalBatch(output, 1).documents[0]).toEqual({
            candidateIndex: 0,
            sections: [{
                heading: '현재 상태',
                operation: 'upsert',
                content: '- 석사 학위 취득 완료',
            }],
        })
        expect(() => parseCanonicalBatch(JSON.stringify({
            schemaVersion: 1,
            documents: [{ candidateIndex: 0, markdown: '## 루치아' }],
        }), 1)).toThrow()
        expect(() => parseCanonicalBatch(JSON.stringify({
            schemaVersion: 1,
            documents: [{
                candidateIndex: 0,
                sections: [
                    { heading: '현재 상태', operation: 'upsert', content: '- A' },
                    { heading: '현재 상태', operation: 'upsert', content: '- B' },
                ],
            }],
        }), 1)).toThrow(/heading/)
        expect(parseCanonicalBatch(JSON.stringify({
            schemaVersion: 1,
            documents: [{ candidateIndex: 0, sections: [] }],
        }), 1).documents[0]?.sections).toEqual([])
    })

    test('uses a compact single-document contract for protocol recovery', () => {
        const schema = JSON.parse(buildCanonicalSingleSchema())
        expect(schema).toMatchObject({
            type: 'object',
            additionalProperties: false,
            required: ['sections'],
        })
        expect(schema.properties).not.toHaveProperty('documents')
        expect(parseCanonicalSingle(JSON.stringify({
            sections: [{
                heading: '현재 상태',
                operation: 'upsert',
                content: '- 귀환했다.',
            }],
        }))).toEqual({
            candidateIndex: 0,
            sections: [{
                heading: '현재 상태',
                operation: 'upsert',
                content: '- 귀환했다.',
            }],
        })
    })

    test('selects one canonical object when a provider adds unrelated JSON metadata', () => {
        const output = [
            JSON.stringify({ providerTrace: 'ignored' }),
            JSON.stringify({
                schemaVersion: 1,
                documents: [{ candidateIndex: 0, sections: [] }],
            }),
        ].join('\n')
        expect(parseCanonicalBatch(output, 1).documents).toEqual([{
            candidateIndex: 0,
            sections: [],
        }])
    })

    test('validates a semantic draft and serializes deterministic Markdown', () => {
        const draft = parseMemoryWriterDraft(JSON.stringify({
            schemaVersion: 1,
            title: '성문 도착',
            establishedEvents: ['[[라비안]]이 [[케사리아]] 성문에 도착했다.'],
            stateChanges: [{
                subject: '[[라비안]]',
                before: '케사리아로 이동 중',
                after: '케사리아 성문에 있음',
            }],
            characterKnowledge: [{
                character: '[[라비안]]',
                fact: '성문이 봉쇄되었다.',
                stance: 'knows',
            }],
            persistentFacts: ['성문은 현재 봉쇄 상태다.'],
            openContinuity: ['봉쇄 이유는 아직 밝혀지지 않았다.'],
            canonicalUpdateCandidates: [{
                type: 'location',
                title: '케사리아',
                aliases: ['제국 수도', ' 케사리아 '],
                reason: '성문 봉쇄 상태가 새로 확정되었다.',
                action: 'update',
                targetDocumentId: 'location.caesarea',
                confidence: 0.94,
            }],
        }))

        expect(draft.canonicalUpdateCandidates[0].aliases)
            .toEqual(['제국 수도', '케사리아'])

        expect(serializeMemoryWriterDraft(draft)).toBe([
            '## 성문 도착',
            '',
            '### 이야기 요약',
            '',
            '- [[라비안]]이 [[케사리아]] 성문에 도착했다.',
        ].join('\n'))
    })

    test('defaults omitted canonical aliases to an empty array', () => {
        const draft = parseMemoryWriterDraft(JSON.stringify({
            schemaVersion: 1, title: '별칭 없는 후보',
            establishedEvents: ['라비안이 도착했다.'],
            stateChanges: [], characterKnowledge: [], persistentFacts: [],
            openContinuity: [], canonicalUpdateCandidates: [{
                type: 'character', title: '라비안', reason: '지속 인물이다.',
                action: 'create', targetDocumentId: null, confidence: 0.9,
            }],
        }))

        expect(draft.canonicalUpdateCandidates[0].aliases).toEqual([])
    })

    test('keeps two reboot events separate while sharing canonical candidates', () => {
        const schema = JSON.parse(buildRebootBatchDraftSchema(2))
        expect(schema.properties.turns).toMatchObject({ minItems: 2, maxItems: 2 })
        expect(schema.properties.turns.items.required)
            .toEqual(['title', 'establishedEvents'])
        expect(schema.properties.turns.items.properties)
            .not.toHaveProperty('assistantMessageId')
        const draft = parseRebootBatchDraft(JSON.stringify({
            schemaVersion: 1,
            turns: [{
                assistantMessageId: 'a1', title: '검을 잃음',
                establishedEvents: ['라비안이 검을 잃었다.'],
            }, {
                assistantMessageId: 'a2', title: '검을 되찾음',
                establishedEvents: ['라비안이 검을 되찾았다.'],
            }],
            stateChanges: [{ subject: '라비안의 검', before: '분실', after: '소유' }],
            characterKnowledge: [], persistentFacts: [], openContinuity: [],
            canonicalUpdateCandidates: [{
                type: 'character', title: '라비안', reason: '소지품이 바뀌었다.',
                action: 'update', targetDocumentId: 'character.lavian',
                confidence: 0.95,
            }],
        }), ['a1', 'a2'])
        expect(draft.turns.map((turn) => turn.title)).toEqual([
            '검을 잃음', '검을 되찾음',
        ])
        expect(draft.canonicalUpdateCandidates).toHaveLength(1)
        expect(() => parseRebootBatchDraft(JSON.stringify({
            ...draft,
            turns: [...draft.turns].reverse(),
        }), ['a1', 'a2'])).toThrow(/order|assistant/i)
    })

    test('binds trusted reboot assistant IDs instead of model-generated IDs', () => {
        const draft = parseRebootBatchDraft(JSON.stringify({
            schemaVersion: 1,
            turns: [{
                assistantMessageId: 'reboot_1',
                title: '창고 탈출',
                establishedEvents: ['린이 시호를 부축해 창고를 나섰다.'],
            }],
            stateChanges: [],
            characterKnowledge: [],
            persistentFacts: [],
            openContinuity: [],
            canonicalUpdateCandidates: [],
        }), ['actual-assistant-message-id'])

        expect(draft.turns[0].assistantMessageId)
            .toBe('actual-assistant-message-id')
    })

    test('normalizes Gemini operation as the canonical action field', () => {
        const draft = parseMemoryWriterDraft(JSON.stringify({
            schemaVersion: 1,
            title: '장면 변화',
            establishedEvents: ['장면이 바뀌었다.'],
            stateChanges: [],
            characterKnowledge: [],
            persistentFacts: [],
            openContinuity: [],
            canonicalUpdateCandidates: [{
                type: 'scene',
                title: '현재 장면',
                reason: '장면이 바뀌었다.',
                operation: 'create',
                targetDocumentId: null,
                confidence: 0.9,
            }],
        }))

        expect(draft.canonicalUpdateCandidates[0].action).toBe('create')
    })

    test('requires an explicit create/update decision and target identity', () => {
        const invalid = {
            schemaVersion: 1,
            title: '성문 도착',
            establishedEvents: ['도착했다.'],
            stateChanges: [],
            characterKnowledge: [],
            persistentFacts: [],
            openContinuity: [],
            canonicalUpdateCandidates: [{
                type: 'location',
                title: '케사리아 외곽 폐촌',
                reason: '장소 상태가 확정되었다.',
            }],
        }
        expect(() => parseMemoryWriterDraft(JSON.stringify(invalid)))
            .toThrow(/action|targetDocumentId|confidence/)
    })

    test('rejects unknown fields and empty evidence sections', () => {
        expect(() => parseMemoryWriterDraft(JSON.stringify({
            schemaVersion: 1,
            title: '빈 기록',
            establishedEvents: [],
            stateChanges: [],
            characterKnowledge: [],
            persistentFacts: [],
            openContinuity: [],
            canonicalUpdateCandidates: [],
            markdown: '# injected',
        }))).toThrow(/field|supported memory/i)
    })

    test('represents a no-change result without fabricating an event', () => {
        const draft = parseMemoryWriterDraft(JSON.stringify({
            schemaVersion: 1,
            title: '변화 없음',
            establishedEvents: [],
            stateChanges: [],
            characterKnowledge: [],
            persistentFacts: [],
            openContinuity: [],
            canonicalUpdateCandidates: [],
        }))
        expect(hasMemoryWriterContent(draft)).toBe(false)
    })
})
