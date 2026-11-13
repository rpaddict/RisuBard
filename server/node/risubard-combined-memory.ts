import {
    memoryWriterDraftSchema,
    buildCanonicalBatchSchema,
    parseCanonicalBatchIsolated,
    parseMemoryWriterDraft,
    type CanonicalSectionPatch,
} from './risubard-memory-writer'
import { parseSingleJsonObject } from '../../packages/risubard-core/src/modelOutput'
import { CANONICAL_UNIT_EDIT_INSTRUCTIONS } from './risubard-canonical-unit-edit'

export function combinedMemorySchema(): string {
    const schema = JSON.parse(memoryWriterDraftSchema)
    schema.properties.canonicalPatches = JSON.parse(buildCanonicalBatchSchema())
        .properties.documents
    schema.required.push('canonicalPatches')
    return JSON.stringify(schema)
}

export const combinedMemoryInstruction = [
    'When completeCanonicalDocuments is provided, combine semantic analysis and canonical writing in this response.',
    'Return canonicalPatches as an array of {candidateIndex, sections}; candidateIndex refers to canonicalUpdateCandidates in this response.',
    'For new documents return initial H3 sections. For updates, only patch an exact ID present in completeCanonicalDocuments. Never patch from excerpts in existingNotes.',
    ...CANONICAL_UNIT_EDIT_INSTRUCTIONS,
    'Omitted sections are preserved by the program. Do not repeat unchanged sections.',
    'For character updates, preserve durable relationships, trust, mental state, knowledge boundaries, promises, injuries, and meaningful possessions, equipment, appearance, and constraints outside transient current-scene changes. Keep relationships, trust, mental state, knowledge boundaries, and meaningful possessions, equipment, appearance, and constraints in separate evidence-grounded sections when useful. Do not create empty sections or templates.',
    'Do not infer shared knowledge, ownership, or relationship meaning from structured state values alone.',
    'Use an empty sections array for a verified no-op. Omit a candidate patch entirely when the complete existing document is unavailable or you cannot safely finish it.',
    'Use confirmedMessages as evidence; stateChanges, characterKnowledge items with a gap, persistentFacts and openContinuity are coverage checks, not permission to invent.',
    'Never supply a reserved story arc patch unless separately requested by the program. Never return paths, frontmatter or source IDs.',
].join('\n')

export function parseCombinedMemory(output: string) {
    const raw = parseSingleJsonObject(output)
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        throw new Error('Memory draft must be an object')
    }
    const { canonicalPatches, ...semantic } = raw as Record<string, unknown>
    const draft = parseMemoryWriterDraft(JSON.stringify(semantic))
    const patches = new Map<(typeof draft.canonicalUpdateCandidates)[number], CanonicalSectionPatch[]>()
    // Legacy providers may ignore the new field. Keep the existing rewrite path.
    if (Array.isArray(canonicalPatches) && canonicalPatches.length > 0) {
        try {
            const batch = parseCanonicalBatchIsolated(
                JSON.stringify({ documents: canonicalPatches }),
                draft.canonicalUpdateCandidates.length,
            )
            for (const entry of batch.documents) {
                const candidate = draft.canonicalUpdateCandidates[entry.candidateIndex]
                if (candidate) patches.set(candidate, entry.sections)
            }
        }
        catch {
            // A malformed optimization must not discard a valid semantic event.
            patches.clear()
        }
    }
    return { draft, patches }
}
