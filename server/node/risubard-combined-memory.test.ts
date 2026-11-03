import { describe, expect, test, vi } from 'vitest'
import { createMemoryAnalysisRunner, type MemoryAnalysisModelRequest } from './risubard-memory-analysis'
import { combinedMemoryInstruction, combinedMemorySchema, parseCombinedMemory } from './risubard-combined-memory'
import { annotateCanonicalUnits } from './risubard-canonical-unit-edit'

const existing = {
    id: 'character.gilbert', type: 'character' as const, title: 'Gilbert', aliases: [],
    relativePath: 'characters/gilbert.md', sourceMessageIds: ['old'], contentHash: 'old-hash',
    content: '## Gilbert\n\n### Current State\nA knight.\n\n### Possessions\nA silver ring.',
}
const sections = [{ heading: 'Current State', operation: 'upsert', content: 'A knight and the narrator’s dance partner.' }]
function draft(action: 'create' | 'update' = 'update') {
    return {
        title: 'Dance', establishedEvents: ['The narrator danced with Gilbert.'],
        stateChanges: [], characterKnowledge: [], persistentFacts: [], openContinuity: [],
        keywords: ['dance', 'partner', 'waltz'],
        temporalHint: { elapsedDays: 7, evidence: 'Seven days later' },
        canonicalUpdateCandidates: [{
            type: 'character', title: 'Gilbert', aliases: [], reason: 'Became a partner',
            action, targetDocumentId: action === 'update' ? existing.id : null, confidence: 1,
            keywords: ['knight', 'dance partner'],
        }],
        canonicalPatches: [{ candidateIndex: 0, sections }],
    }
}

async function run(options: { supplied?: boolean; unnamed?: boolean; create?: boolean; malformed?: boolean; priorUnknown?: boolean; ungrounded?: boolean; partial?: boolean; reboot?: boolean; guide?: boolean } = {}) {
    const saveCanonicalDocument = vi.fn(async (input) => ({
        ...existing, ...input, contentHash: 'new-hash',
    }))
    const saveConfirmedTurn = vi.fn(async (input) => ({
        ...existing, ...input, id: 'event.dance', type: 'event' as const,
        title: 'Dance', relativePath: 'events/dance.md', content: input.markdown,
    }))
    const previous = {
        ...existing, id: 'event.previous', type: 'event' as const, created: '2026-01-01',
        relativePath: 'events/previous.md', content: '## Previous\nThe story began.',
        retrievalMetadata: { keywords: [], storyTime: options.priorUnknown
            ? { day: null, precision: 'unknown' as const, evidence: 'unknown jump' }
            : { day: 0, precision: 'origin' as const, evidence: 'first event' } },
    }
    const analyze = vi.fn(async (request: MemoryAnalysisModelRequest) => {
        if (request.format === 'reboot-batch') {
            return JSON.stringify({
                turns: [
                    { title: 'Beginning', establishedEvents: ['The story began.'], keywords: ['beginning'], temporalHint: { elapsedDays: null, evidence: '' } },
                    { title: 'Dance', establishedEvents: ['The narrator danced with Gilbert.'], keywords: ['dance'], temporalHint: { elapsedDays: 7, evidence: 'Seven days later' } },
                ],
                stateChanges: [], characterKnowledge: [], persistentFacts: [], openContinuity: [], canonicalUpdateCandidates: [],
            })
        }
        if (request.format === 'memory-draft') {
            const result = draft(options.create ? 'create' : 'update')
            if (options.malformed) result.canonicalPatches[0].candidateIndex = 99
            if (options.partial) {
                result.canonicalUpdateCandidates.unshift({
                    ...result.canonicalUpdateCandidates[0], title: 'Mara', action: 'create', targetDocumentId: null,
                })
                result.canonicalPatches[0].candidateIndex = 1
            }
            return JSON.stringify(result)
        }
        return JSON.stringify({ documents: [{ candidateIndex: 0, sections }] })
    })
    const runner = createMemoryAnalysisRunner({
        memoryService: { loadState: vi.fn(), applyDelta: vi.fn() }, nativeV2Analysis: true,
        markdownWikiService: {
            inquire: vi.fn(async () => ({ graphRevision: 0, sources: options.supplied === false || options.create
                ? [] : [{ id: existing.relativePath, content: existing.content }] })),
            loadDocuments: vi.fn(async () => options.create ? [] : [previous, existing]),
            saveConfirmedTurn, saveCanonicalDocument,
            beginRebootBatch: vi.fn(async () => ({ canonicalCount: 0 })),
            recordRebootBatchReceipt: vi.fn(async () => undefined),
        },
        onError: vi.fn(), analyze,
    })
    await runner.run({
        characterId: 'character', chatId: 'chat', wikiWritingLanguage: 'en',
        ...(options.guide ? { wikiPromptGuide: {
            analysis: [
                '## Intentional repeat\nRepeat marker.',
                '## Intentional repeat\nRepeat marker.',
                '## Character continuity contract\nShared policy marker.',
            ].join('\n\n'),
            canonicalRewrite: '## Character continuity contract\nShared policy marker.',
        } } : {}),
        arcPlotterSettings: { enabled: false, checkpointSize: 8, maxArcs: 8, maxTurningPoints: 16, maxOpenThreads: 8, maxCharacters: 6000 },
        ...(options.reboot ? { rebootTurns: [
            { assistantMessageId: 'first', sourceMessageIds: ['first'] },
            { assistantMessageId: 'new', sourceMessageIds: ['new'] },
        ] } : {}),
        messages: [...(options.reboot ? [{ messageId: 'first', role: 'assistant' as const, content: 'The story began.' }] : []),
            { messageId: 'new', role: 'assistant', content: options.unnamed
            ? 'Seven days later the narrator danced with a knight.' : options.ungrounded
            ? 'The narrator danced with Gilbert.' : 'Seven days later the narrator danced with Gilbert.' }],
    })
    return { analyze, saveCanonicalDocument, saveConfirmedTurn }
}

describe('combined semantic and canonical writing', () => {
    test('keeps a valid inline patch when a different candidate has malformed sections', () => {
        const value = draft()
        value.canonicalUpdateCandidates.push({ ...value.canonicalUpdateCandidates[0], title: 'Mara', targetDocumentId: 'character.mara' })
        value.canonicalPatches.push({ candidateIndex: 1, sections: [{ heading: 'State', operation: 'delete', content: 'Invalid deletion' }] })
        const result = parseCombinedMemory(JSON.stringify(value))
        expect(result.patches.get(result.draft.canonicalUpdateCandidates[0])).toEqual(sections)
        expect(result.patches.has(result.draft.canonicalUpdateCandidates[1])).toBe(false)
    })

    test('instructs section rewrites to retain durable character state outside the current scene', () => {
        expect(combinedMemoryInstruction).toContain('relationships, trust, mental state, knowledge boundaries')
        expect(combinedMemoryInstruction).toContain('meaningful possessions, equipment, appearance, and constraints')
        expect(combinedMemoryInstruction).toContain('Do not create empty sections')
    })

    test('injects shared analysis and rewrite guidance once into the combined memory request', async () => {
        const result = await run({ guide: true })
        expect(result.analyze.mock.calls[0][0].system
            .match(/Shared policy marker/g)).toHaveLength(1)
        expect(result.analyze.mock.calls[0][0].system
            .match(/Repeat marker/g)).toHaveLength(2)
    })

    test('saves event and supplied canonical patch in one model call, preserving unrelated sections', async () => {
        const result = await run()
        expect(result.analyze).toHaveBeenCalledTimes(1)
        expect(result.saveCanonicalDocument).toHaveBeenCalledWith(expect.objectContaining({
            expectedContentHash: 'old-hash',
            markdown: expect.stringContaining('A silver ring.'),
            retrievalMetadata: { keywords: ['knight', 'dance partner'] },
        }))
        expect(result.saveConfirmedTurn).toHaveBeenCalledWith(expect.objectContaining({
            retrievalMetadata: { keywords: ['dance', 'partner', 'waltz'], storyTime: {
                day: 7, evidence: 'Seven days later', precision: 'explicit',
            } },
        }))
        const input = JSON.parse(result.analyze.mock.calls[0][0].input)
        // Units are numbered so the model can edit them by reference.
        expect(input.completeCanonicalDocuments[0].completeText).toBe(annotateCanonicalUnits(existing.content))
        expect(input.completeCanonicalDocuments[0].completeText).toContain('[0] A knight.')
    })
    test('creates initial canon and day-zero origin with one call', async () => {
        const result = await run({ create: true })
        expect(result.analyze).toHaveBeenCalledTimes(1)
        expect(result.saveCanonicalDocument).toHaveBeenCalledTimes(1)
        expect(result.saveConfirmedTurn.mock.calls[0][0].retrievalMetadata.storyTime.day).toBe(0)
    })
    test('uses a document named in the turn when inquiry returns no sources', async () => {
        const result = await run({ supplied: false })
        expect(result.analyze).toHaveBeenCalledTimes(1)
        const input = JSON.parse(result.analyze.mock.calls[0][0].input)
        expect(input.completeCanonicalDocuments).toEqual([
            { id: existing.id, type: existing.type, title: existing.title, completeText: annotateCanonicalUnits(existing.content) },
        ])
        expect(result.saveCanonicalDocument).toHaveBeenCalledWith(expect.objectContaining({
            expectedContentHash: 'old-hash',
            markdown: expect.stringContaining('A silver ring.'),
        }))
    })
    test.each([{ supplied: false, unnamed: true }, { malformed: true }])('falls back for missing full document or malformed patches: %o', async (options) => {
        const result = await run(options)
        expect(result.analyze).toHaveBeenCalledTimes(2)
        expect(result.saveCanonicalDocument).toHaveBeenCalledTimes(1)
    })
    test('does not invent a story day without any dated event before it', async () => {
        const result = await run({ priorUnknown: true })
        expect(result.saveConfirmedTurn.mock.calls[0][0].retrievalMetadata.storyTime.day).toBeNull()
    })
    test('records an ungrounded skip only as "on or after" the previous day', async () => {
        const result = await run({ ungrounded: true })
        expect(result.saveConfirmedTurn.mock.calls[0][0].retrievalMetadata.storyTime).toMatchObject({
            precision: 'after', evidence: 'time skip of unknown length',
        })
    })
    test('maps a partial inline batch to the right candidate after fallback', async () => {
        const result = await run({ partial: true })
        expect(result.analyze).toHaveBeenCalledTimes(2)
        expect(JSON.parse(result.analyze.mock.calls[1][0].input).targets.map((target) => target.target.title)).toEqual(['Mara'])
        expect(result.saveCanonicalDocument.mock.calls.map(([input]) => input.title)).toEqual(['Mara', 'Gilbert'])
    })
    test('resolves reboot turn times sequentially with per-turn evidence', async () => {
        const result = await run({ reboot: true, create: true })
        expect(result.analyze).toHaveBeenCalledTimes(1)
        expect(result.saveConfirmedTurn.mock.calls.map(([input]) => input.retrievalMetadata.storyTime.day)).toEqual([0, 7])
        expect(result.saveConfirmedTurn.mock.calls.map(([input]) => input.retrievalMetadata.keywords)).toEqual([['beginning'], ['dance']])
    })
    test('legacy semantic output remains valid and uses fallback', () => {
        const { canonicalPatches: _, ...legacy } = draft()
        expect(parseCombinedMemory(JSON.stringify(legacy)).patches.size).toBe(0)
        expect(JSON.parse(combinedMemorySchema()).required).toContain('canonicalPatches')
    })
})
