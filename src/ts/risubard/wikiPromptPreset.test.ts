import { describe, expect, test } from 'vitest'
import previousOfficial from './fixtures/wikiPromptPreset-260922-v2.json'
import previousRecallOfficial from './fixtures/wikiPromptPreset-260930-v3.json'
import previousCurrentStateOfficial from './fixtures/wikiPromptPreset-261003-v4.json'
import previousLocalizedOfficial from './fixtures/wikiPromptPreset-261003-v5.json'
import previousOctoberOfficial from './fixtures/wikiPromptPreset-261010-v6.json'
import previousFictionOfficial from './fixtures/wikiPromptPreset-261021-v7.json'
import previousRecallGuardOfficial from './fixtures/wikiPromptPreset-261027-v8.json'
import previousCardOfficial from './fixtures/wikiPromptPreset-261028-v9.json'
import previousOrderOfficial from './fixtures/wikiPromptPreset-261029-v10.json'
import type { WikiPromptPreset } from './wikiPromptPreset'
import {
    compileWikiPromptGuide,
    createDefaultWikiPromptPreset,
    deleteWikiPromptPreset,
    duplicateWikiPromptPreset,
    normalizeWikiPromptPresetState,
    OFFICIAL_WIKI_ARCHIVE_FOLDER_ID,
    OFFICIAL_WIKI_CURRENT_ID,
    OFFICIAL_WIKI_RELEASE,
    OFFICIAL_WIKI_V3_BACKUP_ID,
    OFFICIAL_WIKI_V6_BACKUP_ID,
    OFFICIAL_WIKI_V7_BACKUP_ID,
    OFFICIAL_WIKI_V8_BACKUP_ID,
    OFFICIAL_WIKI_V9_BACKUP_ID,
    OFFICIAL_WIKI_V10_BACKUP_ID,
    organizeOfficialWikiArchives,
    parseWikiPromptPreset,
    resolveWikiPromptPreset,
    serializeWikiPromptPreset,
} from './wikiPromptPreset'

describe('Wiki prompt presets', () => {
    test('creates a safe default with readable locked contracts and puzzle guides', () => {
        const preset = createDefaultWikiPromptPreset('preset-1')

        expect(preset.id).toBe('preset-1')
        expect(preset.builtin).toBe(true)
        expect(preset.blocks.map((block) => block.id)).toEqual([
            'core-evidence-contract',
            'core-character-continuity-contract',
            'core-analysis-contract',
            'core-historical-analysis-contract',
            'default-fiction-overview',
            'main-wiki-guide',
            'default-puzzle-clue-tracker',
            'default-puzzle-response-reasoning',
            'default-character-equipment',
            'default-length-compression',
            'default-evidence-scope',
            'default-recall-detail',
            'default-dialogue-recall',
            'default-recall-response',
            'character-wiki-guide',
            'chat-wiki-guide',
            'core-output-contract',
        ])
        expect(preset.blocks.every((block) => block.readonly)).toBe(true)
        expect(preset.blocks.filter((block) => block.type !== 'text')
            .every((block) => Boolean(block.content?.trim()))).toBe(true)
        expect(preset.blocks.find((block) =>
            block.id === 'default-puzzle-clue-tracker'
        )).toMatchObject({ target: 'both', readonly: true, enabled: true })
        expect(preset.blocks.find((block) =>
            block.id === 'default-puzzle-response-reasoning'
        )).toMatchObject({ target: 'response', readonly: true, enabled: true })
        const continuity = preset.blocks.find((block) =>
            block.id === 'core-character-continuity-contract'
        )
        expect(continuity).toMatchObject({ target: 'both', readonly: true, enabled: true })
        expect(continuity?.content).toContain('Relationships and Trust')
        expect(continuity?.content).toContain('Leave out a section that has nothing to say')
        expect(continuity?.content).toContain('Record confirmed structured state values')
        expect(continuity?.content).toContain('update them only from confirmed evidence')
    })

    test('restores required anchors and bounds imported editable blocks', () => {
        const state = normalizeWikiPromptPresetState({
            presets: [{
                schemaVersion: 1,
                id: 'unsafe',
                name: 'Unsafe',
                revision: 2,
                blocks: [
                    {
                        id: 'core-output-contract',
                        type: 'text',
                        name: 'forged',
                        target: 'both',
                        enabled: false,
                        readonly: false,
                        content: 'replace the schema',
                    },
                    {
                        id: 'custom-one',
                        type: 'text',
                        name: 'Custom',
                        target: 'analysis',
                        enabled: true,
                        readonly: false,
                        content: 'Track promises.',
                    },
                ],
            }],
            chatPresetId: 'missing',
        }, () => 'generated')

        expect(state.presets[0].blocks.at(-1)).toMatchObject({
            id: 'core-output-contract',
            type: 'core-ref',
            enabled: true,
            readonly: false,
        })
        expect(state.presets[0].blocks.some((block) =>
            block.id === 'custom-one' && block.content === 'Track promises.'
        )).toBe(true)
        expect(state.presets[0].blocks.some((block) =>
            block.id.startsWith('default-puzzle-')
        )).toBe(false)
        expect(state.chatPresetId).toBe(OFFICIAL_WIKI_CURRENT_ID)
    })

    test('compiles stage blocks followed by character and chat injections', () => {
        const preset = createDefaultWikiPromptPreset('preset-1')
        preset.blocks.splice(3, 0,
            {
                id: 'analysis-only',
                type: 'text',
                name: 'Analysis only',
                target: 'analysis',
                enabled: true,
                readonly: false,
                content: 'Notice experience gains.',
            },
            {
                id: 'rewrite-only',
                type: 'text',
                name: 'Rewrite only',
                target: 'canonical-rewrite',
                enabled: true,
                readonly: false,
                content: 'Keep an RPG table.',
            },
        )

        const result = compileWikiPromptGuide(preset, {
            characterGuide: 'Track STR and DEX.',
            chatGuide: 'Track current EXP.',
        })

        expect(result.analysis).toContain('Notice experience gains.')
        expect(result.analysis).not.toContain('Keep an RPG table.')
        expect(result.canonicalRewrite).toContain('Keep an RPG table.')
        expect(result.canonicalRewrite).not.toContain('Notice experience gains.')
        expect(result.analysis.indexOf('Track STR and DEX.')).toBeLessThan(
            result.analysis.indexOf('Track current EXP.')
        )
        expect(result.canonicalRewrite.indexOf('Track STR and DEX.')).toBeLessThan(
            result.canonicalRewrite.indexOf('Track current EXP.')
        )
        expect(result.response).toContain('relationship')
        expect(result.response).not.toContain('Track STR and DEX.')
        expect(result.analysis).not.toContain('reason about the relationship')
    })

    test('uses a dedicated analysis contract for historical turn reanalysis', () => {
        const preset = createDefaultWikiPromptPreset('preset-1')

        const normal = compileWikiPromptGuide(preset, { analysisMode: 'normal' })
        const historical = compileWikiPromptGuide(preset, { analysisMode: 'historical' })

        expect(normal.analysis).toContain('Separate established events')
        expect(normal.analysis).not.toContain('Reanalyze the selected historical turn')
        expect(historical.analysis).toContain('Reanalyze the selected historical turn')
        expect(historical.analysis).not.toContain('Separate established events')
    })

    test('preserves explicit response blocks without widening both-stage blocks', () => {
        const preset = createDefaultWikiPromptPreset('preset-1')
        preset.blocks.push({
            id: 'response-only',
            type: 'text',
            name: 'Response only',
            target: 'response',
            enabled: true,
            readonly: false,
            content: 'Explain retrieved relationships naturally.',
        })
        preset.blocks.push({
            id: 'writing-both',
            type: 'text',
            name: 'Writing only',
            target: 'both',
            enabled: true,
            readonly: false,
            content: 'Store exact clue locations.',
        })

        const result = compileWikiPromptGuide(preset)

        expect(result.response).toContain('Explain retrieved relationships naturally.')
        expect(result.response).not.toContain('Store exact clue locations.')
        expect(result.analysis).toContain('Store exact clue locations.')
        expect(result.canonicalRewrite).toContain('Store exact clue locations.')
        expect(result.analysis).not.toContain('Explain retrieved relationships naturally.')
    })

    test('duplicates, exports, imports, and refuses to delete the last preset', () => {
        const first = createDefaultWikiPromptPreset('first')
        const duplicated = duplicateWikiPromptPreset(first, 'second')
        expect(duplicated.id).toBe('second')
        expect(duplicated.name).toContain(first.name)
        expect(duplicated.builtin).toBe(false)
        expect(duplicated.blocks.find((block) =>
            block.id === 'core-analysis-contract'
        )).toMatchObject({ type: 'core-ref', readonly: false })
        expect(duplicated.blocks.find((block) =>
            block.id === 'character-wiki-guide'
        )).toMatchObject({ type: 'injection', readonly: true })

        const customCore = duplicated.blocks.find((block) =>
            block.id === 'core-analysis-contract'
        )!
        customCore.content = 'Custom analysis contract.'

        const imported = parseWikiPromptPreset(serializeWikiPromptPreset(duplicated), () => 'imported')
        expect(imported.id).toBe('imported')
        expect(imported.builtin).toBe(false)
        expect(imported.blocks.find((block) =>
            block.id === 'core-analysis-contract'
        )?.content).toBe('Custom analysis contract.')
        expect(imported.blocks.find((block) => block.id === 'main-wiki-guide')?.content)
            .toBe(duplicated.blocks.find((block) => block.id === 'main-wiki-guide')?.content)

        for (const preset of [duplicated, imported]) {
            const continuity = preset.blocks.find((block) =>
                block.id === 'core-character-continuity-contract'
            )
            expect(continuity).toMatchObject({ type: 'core-ref', target: 'both', readonly: true })
            const guide = compileWikiPromptGuide(preset)
            expect(guide.analysis.split(continuity!.content!)).toHaveLength(2)
            expect(guide.canonicalRewrite.split(continuity!.content!)).toHaveLength(2)
        }

        expect(deleteWikiPromptPreset([first], first.id)).toEqual({
            presets: [first],
            deleted: false,
        })
        expect(deleteWikiPromptPreset([first, duplicated], first.id)).toEqual({
            presets: [first, duplicated],
            deleted: false,
        })
        expect(deleteWikiPromptPreset([first, duplicated], duplicated.id)).toEqual({
            presets: [first],
            deleted: true,
        })
    })

    test('resolves a stable preset id with a first-preset fallback', () => {
        const first = createDefaultWikiPromptPreset('first')
        const second = createDefaultWikiPromptPreset('second')
        expect(resolveWikiPromptPreset([first, second], 'second')).toBe(second)
        expect(resolveWikiPromptPreset([first, second], 'missing')).toBe(first)
    })
})

const CURRENT_NAME = '공식 기본 프리셋 (2026-11-03)'
const officialOf = (presets: readonly WikiPromptPreset[]) => presets.filter(preset => preset.builtin)

describe('official preset release and archives', () => {
    test('the 2026-11-03 release marks unheard remarks and thoughts on top of the 10-29 text', () => {
        const current = compileWikiPromptGuide(createDefaultWikiPromptPreset(OFFICIAL_WIKI_CURRENT_ID))
        const previous = compileWikiPromptGuide(previousOrderOfficial.preset as WikiPromptPreset)
        for (const stage of [current.analysis, current.canonicalRewrite]) {
            expect(stage).toContain('A muttered X alone in the car, and no one heard it.')
            expect(stage).toContain('known only to that character')
        }
        expect(current.response).toContain('recorded as unheard or done alone stays unknown to every other character')
        expect(current.response).toContain('use the order numbers on retrieved original excerpts')
        expect(previous.analysis).not.toContain('no one heard it')
        expect(current.analysis.length).toBeGreaterThan(previous.analysis.length)
    })

    test('ships one locked official preset and three unlocked dated archives', () => {
        const state = normalizeWikiPromptPresetState(undefined, () => 'unused')
        expect(state.presets.map(preset => [preset.name, preset.builtin, preset.writingPolicyVersion])).toEqual([
            [CURRENT_NAME, true, 11],
            ['공식 기본 프리셋 (2026-10-29)', false, 10],
            ['공식 기본 프리셋 (2026-10-28)', false, 9],
            ['공식 기본 프리셋 (2026-10-27)', false, 8],
        ])
        expect(state.chatPresetId).toBe(OFFICIAL_WIKI_CURRENT_ID)
        expect(state.officialRelease).toBe(OFFICIAL_WIKI_RELEASE)
        expect(normalizeWikiPromptPresetState(state, () => 'unused')).toEqual(state)
    })

    test('archives compile exactly like the instructions they replaced and stay deletable', () => {
        const state = normalizeWikiPromptPresetState(undefined, () => 'unused')
        const v7 = state.presets.find(preset => preset.id === OFFICIAL_WIKI_V7_BACKUP_ID)
        const v6 = state.presets.find(preset => preset.id === OFFICIAL_WIKI_V6_BACKUP_ID)
        const v8 = state.presets.find(preset => preset.id === OFFICIAL_WIKI_V8_BACKUP_ID)!
        const v9 = state.presets.find(preset => preset.id === OFFICIAL_WIKI_V9_BACKUP_ID)!
        const v10 = state.presets.find(preset => preset.id === OFFICIAL_WIKI_V10_BACKUP_ID)!
        expect(compileWikiPromptGuide(v10)).toEqual(compileWikiPromptGuide(previousOrderOfficial.preset as WikiPromptPreset))
        expect(compileWikiPromptGuide(v9)).toEqual(compileWikiPromptGuide(previousCardOfficial.preset as WikiPromptPreset))
        expect(compileWikiPromptGuide(v8)).toEqual(compileWikiPromptGuide(previousRecallGuardOfficial.preset as WikiPromptPreset))
        expect(v7).toBeUndefined()
        expect(v6).toBeUndefined()
        expect(previousOctoberOfficial.preset.writingPolicyVersion).toBe(6)
        expect(state.presets.some(preset => preset.id === OFFICIAL_WIKI_V3_BACKUP_ID)).toBe(false)
        expect(deleteWikiPromptPreset(state.presets, v8.id).deleted).toBe(true)
        expect(deleteWikiPromptPreset(state.presets, OFFICIAL_WIKI_CURRENT_ID).deleted).toBe(false)
    })

    test('keeps a deleted archive deleted and an edited archive unchanged on reload', () => {
        const state = normalizeWikiPromptPresetState(undefined, () => 'unused')
        const edited = state.presets.find(preset => preset.id === OFFICIAL_WIKI_V9_BACKUP_ID)!
        edited.blocks.find(block => block.id === 'main-wiki-guide')!.content = 'My archive edit.'
        const remaining = state.presets.filter(preset => preset.id !== OFFICIAL_WIKI_V8_BACKUP_ID)
        const reloaded = normalizeWikiPromptPresetState({ ...state, presets: remaining, chatPresetId: edited.id }, () => 'unused')
        expect(reloaded.presets.map(preset => preset.id))
            .toEqual([OFFICIAL_WIKI_CURRENT_ID, OFFICIAL_WIKI_V10_BACKUP_ID, OFFICIAL_WIKI_V9_BACKUP_ID])
        expect(reloaded.chatPresetId).toBe(edited.id)
        expect(compileWikiPromptGuide(reloaded.presets[2]).analysis).toContain('My archive edit.')
    })

    test('cleans up the legacy backup list once, keeping personal copies', () => {
        const legacy = (id: string, preset: unknown, name: string) => ({ ...(preset as WikiPromptPreset), id, name, builtin: true })
        const current = { ...createDefaultWikiPromptPreset(OFFICIAL_WIKI_CURRENT_ID), name: '공식기본' }
        const copy = duplicateWikiPromptPreset(previousLocalizedOfficial.preset as WikiPromptPreset, 'personal-copy')
        const presets = [
            current,
            legacy('official-wiki-260922', previousOfficial.preset, '공식기본-260922'),
            legacy('official-wiki-260922-v2', previousOfficial.preset, '공식기본-260922-v2'),
            // A broken legacy backup: labelled 2026-09-30 but carrying the v2 instructions.
            legacy(OFFICIAL_WIKI_V3_BACKUP_ID, previousOfficial.preset, '공식기본'),
            legacy('official-wiki-261003', previousCurrentStateOfficial.preset, '공식기본-261003'),
            copy,
            legacy('official-wiki-261003-v5', previousLocalizedOfficial.preset, '공식기본-261003-v5'),
        ]
        const state = normalizeWikiPromptPresetState({ presets, chatPresetId: 'official-wiki-261003' }, () => 'unused')
        expect(state.presets.map(preset => preset.name)).toEqual([
            CURRENT_NAME, '공식기본-261003-v5 Copy', '공식 기본 프리셋 (2026-10-29)', '공식 기본 프리셋 (2026-10-28)', '공식 기본 프리셋 (2026-10-27)',
        ])
        expect(officialOf(state.presets).map(preset => preset.id)).toEqual([OFFICIAL_WIKI_CURRENT_ID])
        expect(state.presets.find(preset => preset.id === OFFICIAL_WIKI_V3_BACKUP_ID)).toBeUndefined()
        expect(state.presets.find(preset => preset.id === 'personal-copy')).toEqual(copy)
        // A retired selection falls back to the official preset, not the first list entry.
        expect(state.chatPresetId).toBe(OFFICIAL_WIKI_CURRENT_ID)
        expect(normalizeWikiPromptPresetState(state, () => 'unused')).toEqual(state)
    })

    test('keeps only the first locked official preset', () => {
        const state = normalizeWikiPromptPresetState({
            presets: [createDefaultWikiPromptPreset('first-official'), createDefaultWikiPromptPreset('second-official')],
            chatPresetId: 'second-official',
            officialRelease: OFFICIAL_WIKI_RELEASE,
        }, () => 'unused')
        expect(officialOf(state.presets).map(preset => preset.id)).toEqual(['first-official'])
        expect(state.chatPresetId).toBe('first-official')
    })

    test('places archives in their folder and the official preset first only on a release upgrade', () => {
        const mine = duplicateWikiPromptPreset(createDefaultWikiPromptPreset('x'), 'mine')
        const state = normalizeWikiPromptPresetState({ presets: [mine] }, () => 'unused')
        const organized = organizeOfficialWikiArchives(undefined, state.presets, true)
        expect(organized.folders).toEqual([{ id: OFFICIAL_WIKI_ARCHIVE_FOLDER_ID, name: '과거 공식 프리셋', createdAt: 0 }])
        expect(organized.folderByItemId).toEqual({
            [OFFICIAL_WIKI_V10_BACKUP_ID]: OFFICIAL_WIKI_ARCHIVE_FOLDER_ID,
            [OFFICIAL_WIKI_V9_BACKUP_ID]: OFFICIAL_WIKI_ARCHIVE_FOLDER_ID,
            [OFFICIAL_WIKI_V8_BACKUP_ID]: OFFICIAL_WIKI_ARCHIVE_FOLDER_ID,
        })
        expect(organized.itemOrder).toEqual([OFFICIAL_WIKI_CURRENT_ID, 'mine', OFFICIAL_WIKI_V10_BACKUP_ID, OFFICIAL_WIKI_V9_BACKUP_ID, OFFICIAL_WIKI_V8_BACKUP_ID])
        const legacyOrder = { itemOrder: [OFFICIAL_WIKI_V8_BACKUP_ID, 'mine', OFFICIAL_WIKI_CURRENT_ID] }
        expect(organizeOfficialWikiArchives(legacyOrder, state.presets, true).itemOrder)
            .toEqual([OFFICIAL_WIKI_CURRENT_ID, 'mine', OFFICIAL_WIKI_V10_BACKUP_ID, OFFICIAL_WIKI_V9_BACKUP_ID, OFFICIAL_WIKI_V8_BACKUP_ID])
        const folderDeletedByUser = { ...organized, folders: [], folderByItemId: {} }
        expect(organizeOfficialWikiArchives(folderDeletedByUser, state.presets, false).folders).toEqual([])
    })
})

test('keeps personal preset selection and policy while installing the official preset', () => {
    const personal = duplicateWikiPromptPreset(createDefaultWikiPromptPreset('seed'), 'personal')
    personal.writingPolicyVersion = 1
    personal.name = 'My wiki'
    personal.blocks.find(block => block.id === 'main-wiki-guide')!.content = 'Track my custom facts.'
    const state = normalizeWikiPromptPresetState({ presets: [personal], chatPresetId: personal.id }, () => 'generated')
    expect(state.chatPresetId).toBe('personal')
    expect(state.presets[0].writingPolicyVersion).toBe(1)
    expect(compileWikiPromptGuide(state.presets[0]).analysis).toContain('Track my custom facts.')
    expect(officialOf(state.presets)).toHaveLength(1)
    expect(normalizeWikiPromptPresetState(state, () => 'unused')).toEqual(state)
})

describe('in-place official preset upgrades', () => {
    for (const [label, fixture] of [['v2', previousOfficial.preset], ['v3', previousRecallOfficial.preset]] as const) {
        test(`upgrades a selected ${label} official preset while retaining its ID and optional toggles`, () => {
            const old = structuredClone(fixture) as WikiPromptPreset
            old.id = `selected-${label}`
            old.blocks.find(block => block.id === 'default-character-equipment')!.enabled = false
            old.blocks.find(block => block.id === 'default-length-compression')!.enabled = true
            const state = normalizeWikiPromptPresetState({ presets: [old], chatPresetId: old.id }, () => 'unused')
            const selected = resolveWikiPromptPreset(state.presets, state.chatPresetId)!
            expect(selected).toMatchObject({ id: old.id, name: CURRENT_NAME, builtin: true, writingPolicyVersion: 11 })
            expect(selected.blocks.find(block => block.id === 'default-character-equipment')?.enabled).toBe(false)
            expect(selected.blocks.find(block => block.id === 'default-length-compression')?.enabled).toBe(true)
        })
    }

    test('upgrades v4 in place and enables compression', () => {
        const old = structuredClone(previousCurrentStateOfficial.preset) as WikiPromptPreset
        old.id = OFFICIAL_WIKI_CURRENT_ID
        old.blocks.find(block => block.id === 'default-character-equipment')!.enabled = false
        const state = normalizeWikiPromptPresetState({ presets: [old], chatPresetId: old.id }, () => 'unused')
        const selected = resolveWikiPromptPreset(state.presets, state.chatPresetId)!
        expect(selected).toMatchObject({ id: old.id, name: CURRENT_NAME, writingPolicyVersion: 11 })
        expect(selected.blocks.find(block => block.id === 'default-character-equipment')?.enabled).toBe(false)
        expect(selected.blocks.find(block => block.id === 'default-length-compression')?.enabled).toBe(true)
    })

    test('upgrades v5 in place and keeps its compression choice', () => {
        const old = structuredClone(previousLocalizedOfficial.preset) as WikiPromptPreset
        old.id = OFFICIAL_WIKI_CURRENT_ID
        old.blocks.find(block => block.id === 'default-length-compression')!.enabled = false
        const state = normalizeWikiPromptPresetState({ presets: [old], chatPresetId: old.id }, () => 'unused')
        const selected = resolveWikiPromptPreset(state.presets, state.chatPresetId)!
        expect(selected).toMatchObject({ id: old.id, name: CURRENT_NAME, writingPolicyVersion: 11 })
        expect(selected.blocks.find(block => block.id === 'default-length-compression')?.enabled).toBe(false)
        const continuity = selected.blocks.find(block => block.id === 'core-character-continuity-contract')!.content
        expect(continuity).toContain('A character document is a current card, not a log.')
        expect(continuity).not.toContain('Silence is not')
        expect(continuity).not.toContain('Retain who met whom and what each person learned.')
        // A protagonist is in every scene; logging each witnessed fact grew their card every turn.
        expect(continuity).toContain('Do not write that the character saw, heard, was told, confirmed or learned something; the event records it.')
        expect(continuity).toContain('Every update rewrites the card; it never only appends.')
    })

    test('upgrades the 2026-10-21 official preset so responses stop inventing unsupported past facts', () => {
        const old = structuredClone(previousFictionOfficial.preset) as WikiPromptPreset
        old.id = OFFICIAL_WIKI_CURRENT_ID
        const before = old.blocks.find(block => block.id === 'default-recall-response')!.content!
        const state = normalizeWikiPromptPresetState({ presets: [old], chatPresetId: old.id, officialRelease: '2026-10-21' }, () => 'unused')
        const selected = resolveWikiPromptPreset(state.presets, state.chatPresetId)!
        expect(selected).toMatchObject({ id: old.id, name: CURRENT_NAME, builtin: true, writingPolicyVersion: 11 })
        const response = compileWikiPromptGuide(selected).response
        expect(before).toContain('Missing context remains uncertain.')
        expect(response).toContain('Do not invent past facts that no supplied source supports')
        expect(response).not.toContain('Missing context remains uncertain.')
        // An in-character reply is not told to admit ignorance.
        expect(response).not.toMatch(/say (?:that )?you do not know|admit/i)
        // Later releases have retired the 2026-10-21 archive.
        expect(state.presets.find(preset => preset.id === OFFICIAL_WIKI_V7_BACKUP_ID)).toBeUndefined()
    })

    test('optional compression survives normalization and does not discard essential facts', () => {
        const preset = createDefaultWikiPromptPreset('new')
        const block = preset.blocks.find(b => b.id === 'default-length-compression')!
        expect(block).toMatchObject({ enabled: true })
        expect(compileWikiPromptGuide(preset).canonicalRewrite).toContain('over its length goal')
        expect(compileWikiPromptGuide(preset).canonicalRewrite).toContain('Keep each secret and who shares it')
        block.enabled = false
        const restored = parseWikiPromptPreset(serializeWikiPromptPreset(preset), () => 'imported')
        expect(compileWikiPromptGuide(restored).canonicalRewrite).not.toContain('over its length goal')
    })
})

describe('personal presets keep their policy', () => {
    for (const [label, fixture] of [
        ['v2', previousOfficial.preset],
        ['v3', previousRecallOfficial.preset],
        ['v4', previousCurrentStateOfficial.preset],
        ['v5', previousLocalizedOfficial.preset],
    ] as const) {
        test(`keeps personal ${label} instructions and selection unchanged`, () => {
            const personal = duplicateWikiPromptPreset(fixture as WikiPromptPreset, `personal-${label}`)
            const state = normalizeWikiPromptPresetState({ presets: [personal], chatPresetId: personal.id }, () => 'unused')
            expect(state.chatPresetId).toBe(personal.id)
            expect(state.presets[0]).toEqual(personal)
            expect(compileWikiPromptGuide(state.presets[0])).toEqual(compileWikiPromptGuide(fixture as WikiPromptPreset))
        })
    }
})

describe('official instruction content', () => {
    const previous = previousCurrentStateOfficial.preset as WikiPromptPreset
    test('routes recall instructions to their intended stages after export and import', () => {
        const preset = createDefaultWikiPromptPreset('latest')
        const imported = parseWikiPromptPreset(serializeWikiPromptPreset(preset), () => 'imported')
        expect(imported.writingPolicyVersion).toBe(11)
        for (const candidate of [preset, imported]) {
            const guide = compileWikiPromptGuide(candidate)
            const historical = compileWikiPromptGuide(candidate, { analysisMode: 'historical' })
            for (const id of ['default-evidence-scope', 'default-recall-detail', 'default-dialogue-recall']) {
                const block = candidate.blocks.find(block => block.id === id)!
                expect(block?.content).toBeTruthy()
                expect(guide.analysis).toContain(block.content)
                expect(historical.analysis).toContain(block.content)
                expect(guide.response).not.toContain(block.content)
                if (id === 'default-evidence-scope') expect(guide.canonicalRewrite).toContain(block.content)
                else expect(guide.canonicalRewrite).not.toContain(block.content)
            }
            const response = candidate.blocks.find(block => block.id === 'default-recall-response')!
            expect(response?.content).toBeTruthy()
            expect(guide.response).toContain(response.content)
            expect(guide.analysis).not.toContain(response.content)
            expect(guide.canonicalRewrite).not.toContain(response.content)
        }
        expect(compileWikiPromptGuide(imported)).toEqual(compileWikiPromptGuide(preset))
    })

    test('replaces hardcoded Korean role labels and per-event transition logging', () => {
        const instructions = (preset: WikiPromptPreset) => preset.blocks
            .filter(block => ['core-character-continuity-contract', 'default-character-equipment', 'default-length-compression'].includes(block.id))
            .map(block => block.content).join('\n')
        const guide = instructions(createDefaultWikiPromptPreset('latest'))
        const before = instructions(previous)
        for (const label of ['인물 핵심', '관계와 신뢰', '지식과 비밀', '주요 전환', '장비와 소지품']) {
            expect(before).toContain(label)
            expect(guide).not.toContain(label)
        }
        expect(guide).toContain('exactly as the locale heading')
        expect(guide).toContain('rewrite that entry instead of adding one')
        expect(guide).toContain('first and decisive events')
        expect(guide).not.toContain('Retain meaningful transition results and exact event links')
    })
})
