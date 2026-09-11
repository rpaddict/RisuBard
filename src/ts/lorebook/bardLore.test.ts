import { describe, expect, it } from 'vitest'
import type { loreBook } from '../storage/database.svelte'
import {
    applyMaterializedBardLoreEntries,
    createBardLoreEntry,
    createBardLoreSettings,
    fingerprintLegacyLore,
    materializeBardLoreEntries,
    normalizeBardLoreOwnerState,
    normalizeBardLoreState,
    reconcileBardLoreState,
    upgradeLegacyLorebook,
} from './bardLore'

const settings = createBardLoreSettings({
    targetTokens: 321,
    maximumTokens: 654,
    maxEntries: 7,
    contextMessages: 4,
})

function lore(overrides: Partial<loreBook> = {}): loreBook {
    return {
        key: '',
        secondkey: '',
        insertorder: 10,
        comment: 'Entry',
        content: 'Original content',
        mode: 'normal',
        alwaysActive: false,
        selective: false,
        ...overrides,
    }
}

describe('upgradeLegacyLorebook', () => {
    it('uses the recommended AI analysis defaults for first-time users', () => {
        const defaults = createBardLoreSettings()

        expect(defaults.analysisLinkedDepth).toBe(1)
        expect(defaults.analysisTemperature).toBe(0.2)
    })

    it('creates metadata without copying legacy fields or mutating the source', () => {
        const original = lore({
            id: 'legacy-1',
            key: '폴로니안 몰, 시내',
            secondkey: '데이트',
            alwaysActive: true,
            activationPercent: 73,
            bookVersion: 4,
            useRegex: true,
            extentions: { risu_case_sensitive: true },
        })
        const snapshot = structuredClone(original)

        const state = upgradeLegacyLorebook([original], () => 'unused', settings)

        expect(original).toEqual(snapshot)
        expect(state.mode).toBe('bard')
        expect(state.settings).toEqual(settings)
        expect(state).not.toHaveProperty('entries')
        expect(state.metadata[0]).toMatchObject({
            sourceLegacyId: 'legacy-1',
            activation: 'keyed',
            aliases: ['폴로니안 몰', '시내', '데이트'],
        })
    })

    it('materializes ordinary entries from the current legacy source instead of a saved copy', () => {
        const source = lore({ id: 'legacy-1', comment: 'Before', content: 'Old body' })
        const state = upgradeLegacyLorebook([source], () => 'unused', settings)
        state.metadata[0].summary = '분석 요약'

        const entries = materializeBardLoreEntries(state, [
            { ...source, comment: 'After', content: 'Edited in the legacy editor' },
        ])

        expect(entries[0]).toMatchObject({
            id: 'legacy-1',
            comment: 'After',
            content: 'Edited in the legacy editor',
            bard: { summary: '분석 요약' },
        })
    })

    it('commits ordinary Grimoire edits to legacy lore while retaining only metadata in Grimoire', () => {
        const source = lore({ id: 'legacy-1', comment: 'Before', content: 'Old body' })
        const state = upgradeLegacyLorebook([source], () => 'unused', settings)
        const edited = materializeBardLoreEntries(state, [source])
        edited[0] = {
            ...edited[0],
            comment: 'After',
            content: 'Edited in Grimoire',
            bard: { ...edited[0].bard, kind: 'character', summary: '분석 요약' },
        }

        const result = applyMaterializedBardLoreEntries(state, [source], edited)

        expect(result.legacyEntries[0]).toMatchObject({ comment: 'After', content: 'Edited in Grimoire' })
        expect(result.state.metadata[0]).toMatchObject({ kind: 'character', summary: '분석 요약' })
        expect(result.state).not.toHaveProperty('entries')
    })

    it('keeps AI-derived entries independent and removes them when their source is deleted', () => {
        const source = lore({ id: 'legacy-1' })
        const state = upgradeLegacyLorebook([source], () => 'unused', settings)
        const entries = materializeBardLoreEntries(state, [source])
        entries.push({
            ...entries[0],
            id: 'derived-1',
            comment: 'Derived',
            content: 'Derived body',
            bard: {
                ...entries[0].bard,
                sourceLegacyId: 'legacy-1',
                derivedFromId: 'legacy-1',
            },
        })

        const withDerived = applyMaterializedBardLoreEntries(state, [source], entries)
        expect(withDerived.legacyEntries).toHaveLength(1)
        expect(withDerived.state.derivedEntries).toHaveLength(1)

        const afterDelete = applyMaterializedBardLoreEntries(
            withDerived.state,
            withDerived.legacyEntries,
            withDerived.state.derivedEntries,
        )
        expect(afterDelete.legacyEntries).toEqual([])
        expect(afterDelete.state.metadata).toEqual([])
        expect(afterDelete.state.derivedEntries).toEqual([])
    })

    it('migrates schema-version-1 copied entries into metadata overlays and derived entries', () => {
        const oldState = {
            schemaVersion: 1,
            mode: 'bard',
            settings,
            entries: [
                { ...createBardLoreEntry(lore({ id: 'base' })) },
                {
                    ...createBardLoreEntry(lore({ id: 'derived', comment: 'Derived' })),
                    bard: {
                        ...createBardLoreEntry(lore({ id: 'derived' })).bard,
                        sourceLegacyId: 'base',
                        derivedFromId: 'base',
                    },
                },
            ],
        }

        const normalized = normalizeBardLoreState(oldState)

        expect(normalized?.schemaVersion).toBe(2)
        expect(normalized?.metadata.map((item) => item.sourceLegacyId)).toEqual(['base'])
        expect(normalized?.derivedEntries.map((item) => item.id)).toEqual(['derived'])
    })

    it('preserves ordinary entries added only in a schema-version-1 Grimoire', () => {
        const original = lore({ id: 'base', comment: 'Base' })
        const added = createBardLoreEntry(lore({ id: 'grimoire-only', comment: 'Added in Grimoire' }))
        const migrated = normalizeBardLoreOwnerState({
            schemaVersion: 1,
            mode: 'bard',
            settings,
            entries: [createBardLoreEntry(original), added],
        }, [original], () => 'generated')

        expect(migrated?.legacyEntries.map((entry) => entry.comment)).toEqual(['Base', 'Added in Grimoire'])
        expect(migrated?.state.metadata).toHaveLength(2)
    })

    it('keeps a one-sided schema-version-1 Grimoire edit and preserves both sides of a conflict', () => {
        const baseline = lore({ id: 'base', content: 'Baseline' })
        const copied = createBardLoreEntry(baseline)
        copied.content = 'Edited only in Grimoire'
        const oneSided = normalizeBardLoreOwnerState({
            schemaVersion: 1,
            mode: 'bard',
            settings,
            entries: [copied],
        }, [baseline], () => 'generated')
        expect(oneSided?.legacyEntries.map((entry) => entry.content)).toEqual(['Edited only in Grimoire'])

        const conflict = normalizeBardLoreOwnerState({
            schemaVersion: 1,
            mode: 'bard',
            settings,
            entries: [copied],
        }, [{ ...baseline, content: 'Edited only in Legacy' }], () => 'conflict-copy')
        expect(conflict?.legacyEntries.map((entry) => entry.content)).toEqual([
            'Edited only in Legacy',
            'Edited only in Grimoire',
        ])
        expect(conflict?.report.conflicts).toBe(1)
    })

    it('prunes deleted analysis targets while preserving unaffected completed drafts', () => {
        const sources = [lore({ id: 'first' }), lore({ id: 'second' })]
        const state = upgradeLegacyLorebook(sources, () => 'unused', settings)
        state.analysisRun = {
            schemaVersion: 1,
            id: 'run',
            scope: 'all',
            targetIds: ['first', 'second'],
            createdAt: '2026-09-02T00:00:00.000Z',
            updatedAt: '2026-09-02T00:00:00.000Z',
            status: 'review',
            settingsSnapshot: settings,
            overwriteExisting: false,
            batches: [{
                id: 'batch',
                index: 0,
                targetIds: ['first', 'second'],
                estimatedInputTokens: 10,
                status: 'complete',
                candidates: [
                    { id: 'first', sourceHash: 'one', kind: 'other', aliases: [], tags: [], summary: 'keep', links: [] },
                    { id: 'second', sourceHash: 'two', kind: 'other', aliases: [], tags: [], summary: 'drop', links: [] },
                ],
            }],
        }
        const entries = materializeBardLoreEntries(state, sources).filter((entry) => entry.id === 'first')

        const applied = applyMaterializedBardLoreEntries(state, sources, entries)

        expect(applied.state.analysisRun?.targetIds).toEqual(['first'])
        expect(applied.state.analysisRun?.batches[0].targetIds).toEqual(['first'])
        expect(applied.state.analysisRun?.batches[0].candidates?.map((candidate) => candidate.id)).toEqual(['first'])
    })

    it('remaps an analysis draft when fingerprint matching replaces a missing source ID', () => {
        const sourceWithOldId = lore({ id: 'old-id', content: 'Stable body' })
        const state = upgradeLegacyLorebook([sourceWithOldId], () => 'unused', settings)
        state.analysisRun = {
            schemaVersion: 1,
            id: 'run',
            scope: 'all',
            targetIds: ['old-id'],
            createdAt: '2026-09-02T00:00:00.000Z',
            updatedAt: '2026-09-02T00:00:00.000Z',
            status: 'review',
            settingsSnapshot: settings,
            overwriteExisting: false,
            batches: [{
                id: 'batch', index: 0, targetIds: ['old-id'], estimatedInputTokens: 10, status: 'complete',
                candidates: [{ id: 'old-id', sourceHash: 'draft', kind: 'other', aliases: [], tags: [], summary: 'keep', links: [] }],
            }],
        }
        const sourceWithoutId = { ...sourceWithOldId, id: undefined }

        const reconciled = reconcileBardLoreState(state, [sourceWithoutId])
        const newId = reconciled.legacyEntries[0].id

        expect(newId).not.toBe('old-id')
        expect(reconciled.state.analysisRun?.targetIds).toEqual([newId])
        expect(reconciled.state.analysisRun?.batches[0].candidates?.[0].id).toBe(newId)
    })

    it('does not promote an unkeyed always-active prose entry to required', () => {
        const state = upgradeLegacyLorebook([
            lore({ id: 'world', alwaysActive: true, comment: 'World history' }),
        ], () => 'unused', settings)

        expect(state.metadata[0].activation).toBe('retrieve')
    })

    it('disables folders, child links, and explicitly disabled entries', () => {
        const state = upgradeLegacyLorebook([
            lore({ id: 'folder', mode: 'folder' }),
            lore({ id: 'child', mode: 'child' }),
            lore({ id: 'disabled', enabled: false, key: 'key' }),
        ], () => 'unused', settings)

        expect(state.metadata.map((entry) => entry.activation)).toEqual(['never', 'never', 'never'])
    })

    it('assigns collision-safe IDs to missing and duplicate legacy IDs', () => {
        const generated = ['generated-1', 'generated-2']
        const state = upgradeLegacyLorebook([
            lore({ id: 'kept' }),
            lore({ id: 'kept' }),
            lore(),
        ], () => generated.shift()!, settings)

        expect(state.metadata.map((entry) => entry.sourceLegacyId)).toEqual(['kept', 'generated-1', 'generated-2'])
    })

    it('normalizes every retrieval and analysis tuning value into persisted soft settings', () => {
        const normalized = createBardLoreSettings({
            targetTokens: -1,
            maximumTokens: 900,
            maxEntries: 0,
            contextMessages: 0,
            maxLinkDepth: 3,
            minimumSparseScore: 2.5,
            directMatchScore: 75,
            linkScore: 50,
            linkScoreDecay: 0.4,
            minimumTermLength: 3,
            cjkPartialMatching: false,
            fieldWeights: {
                name: 1,
                keys: 2,
                aliases: 3,
                tags: 4,
                summary: 5,
                content: 0,
            },
            analysisBatchEntries: 9,
            analysisInputTokens: 12_000,
            analysisOutputTokens: 2_000,
            analysisLinkedDepth: 2,
            analysisTemperature: 0.35,
        })

        expect(normalized).toMatchObject({
            targetTokens: 0,
            maximumTokens: 900,
            maxEntries: 0,
            contextMessages: 0,
            maxLinkDepth: 3,
            minimumSparseScore: 2.5,
            directMatchScore: 75,
            linkScore: 50,
            linkScoreDecay: 0.4,
            minimumTermLength: 3,
            cjkPartialMatching: false,
            fieldWeights: { content: 0 },
            analysisBatchEntries: 9,
            analysisInputTokens: 12_000,
            analysisOutputTokens: 2_000,
            analysisLinkedDepth: 2,
            analysisTemperature: 0.35,
        })
    })

    it('normalizes empty and duplicate metadata terms at the storage boundary', () => {
        const state = upgradeLegacyLorebook([lore({ id: 'entry' })], () => 'unused', settings)
        state.metadata[0].aliases = ['', '  ', ' 탑 ', '탑']
        state.metadata[0].tags = ['', ' 장소 ', '장소']

        const normalized = normalizeBardLoreState(state)

        expect(normalized?.metadata[0].aliases).toEqual(['탑'])
        expect(normalized?.metadata[0].tags).toEqual(['장소'])
    })

    it('loads existing schema-version-1 entries with empty structured routing metadata', () => {
        const entry = createBardLoreEntry(lore({ id: 'entry' }))
        const legacyMetadata = entry.bard as unknown as Record<string, unknown>
        delete legacyMetadata.facets
        delete legacyMetadata.injection

        const normalized = normalizeBardLoreState({
            schemaVersion: 1,
            mode: 'bard',
            entries: [entry],
            settings,
        })

        expect(normalized?.metadata[0].facets).toEqual([])
        expect(normalized?.metadata[0].injection).toBe('full')
    })

    it('normalizes facets, expanded relation policies, and soft router settings', () => {
        const state = upgradeLegacyLorebook([lore({ id: 'entry' }), lore({ id: 'school' })], () => 'unused', settings)
        state.metadata[0].facets = [
            { key: ' gender ', value: ' male ', aliases: ['', ' 남자 ', '남자'] },
        ]
        state.metadata[0].injection = 'index-only'
        state.metadata[0].links = [{ targetId: 'school', relation: ' attends ', retrieval: 'ambient' }]
        state.settings.router = {
            ...state.settings.router,
            defaultResultCount: 7,
            ambientResultCount: 4,
            kindAliases: {
                ...state.settings.router.kindAliases,
                character: ['', ' 인물 ', '인물'],
            },
        }

        const normalized = normalizeBardLoreState(state)

        expect(normalized?.metadata[0]).toMatchObject({
            injection: 'index-only',
            facets: [{ key: 'gender', value: 'male', aliases: ['남자'] }],
            links: [{ targetId: 'school', relation: 'attends', retrieval: 'ambient' }],
        })
        expect(normalized?.settings.router).toMatchObject({
            defaultResultCount: 7,
            ambientResultCount: 4,
            kindAliases: { character: ['인물'] },
        })
    })

    it('rejects a persisted Bard Lore state with duplicate source IDs', () => {
        const state = upgradeLegacyLorebook([lore({ id: 'first' }), lore({ id: 'second' })], () => 'unused', settings)
        state.metadata[1].sourceLegacyId = state.metadata[0].sourceLegacyId

        expect(normalizeBardLoreState(state)).toBeUndefined()
    })

    it('restores completed analysis drafts and pauses interrupted work without rejecting lore entries', () => {
        const state = upgradeLegacyLorebook([lore({ id: 'entry' })], () => 'unused', settings)
        state.analysisRun = {
            schemaVersion: 1,
            id: 'run',
            scope: 'all',
            targetIds: ['entry'],
            createdAt: '2026-08-31T00:00:00.000Z',
            updatedAt: '2026-08-31T00:00:00.000Z',
            status: 'running',
            settingsSnapshot: settings,
            instructionPresetSnapshot: {
                schemaVersion: 1,
                id: 'custom-prompt',
                name: 'Custom prompt',
                revision: 3,
                builtin: false,
                content: 'Stable instruction snapshot.',
            },
            overwriteExisting: false,
            batches: [{
                id: 'batch',
                index: 0,
                targetIds: ['entry'],
                estimatedInputTokens: 40,
                status: 'running',
            }],
        }

        const normalized = normalizeBardLoreState(state)

        expect(normalized?.analysisRun?.status).toBe('paused')
        expect(normalized?.analysisRun?.languageSnapshot).toBeUndefined()
        expect(normalized?.analysisRun?.instructionPresetSnapshot?.content).toBe('Stable instruction snapshot.')
        expect(normalized?.analysisRun?.batches[0].status).toBe('pending')
        ;(state.analysisRun as unknown as Record<string, unknown>).batches = 'malformed'
        const withoutBadRun = normalizeBardLoreState(state)
        expect(withoutBadRun?.metadata).toHaveLength(1)
        expect(withoutBadRun?.analysisRun).toBeUndefined()
    })

    it('falls back from non-finite saved settings instead of propagating them', () => {
        const normalized = createBardLoreSettings({
            contextMessages: Number.NaN,
            analysisBatchEntries: Number.POSITIVE_INFINITY,
            analysisInputTokens: Number.NaN,
        })

        expect(normalized.contextMessages).toBeGreaterThan(0)
        expect(normalized.analysisBatchEntries).toBeGreaterThan(0)
        expect(normalized.analysisInputTokens).toBeGreaterThan(0)
    })

    it('fingerprints source content deterministically and notices meaningful changes', () => {
        const source = lore({ id: 'entry', content: 'one' })

        expect(fingerprintLegacyLore(source)).toBe(fingerprintLegacyLore({ ...source }))
        expect(fingerprintLegacyLore(source)).not.toBe(fingerprintLegacyLore({ ...source, content: 'two' }))
    })
})
