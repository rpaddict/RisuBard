import { describe, expect, test } from 'vitest'
import previousOfficial from './fixtures/wikiPromptPreset-260922-v2.json'
import previousRecallOfficial from './fixtures/wikiPromptPreset-260930-v3.json'
import previousCurrentStateOfficial from './fixtures/wikiPromptPreset-261003-v4.json'
import previousLocalizedOfficial from './fixtures/wikiPromptPreset-261003-v5.json'
import type { WikiPromptPreset } from './wikiPromptPreset'
import {
    compileWikiPromptGuide,
    createDefaultWikiPromptPreset,
    deleteWikiPromptPreset,
    duplicateWikiPromptPreset,
    normalizeWikiPromptPresetState,
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
        expect(continuity?.content).toContain('relationships and trust')
        expect(continuity?.content).toContain('Do not create empty sections')
        expect(continuity?.content).toContain('Record confirmed structured state values')
        expect(continuity?.content).toContain('retain existing values when they are omitted')
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
        expect(state.chatPresetId).toBe('unsafe')
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

describe('versioned official character presets', () => {
    test('ships current default and frozen backup and preserves selection on reload', () => {
        const old = createDefaultWikiPromptPreset('old')
        delete old.writingPolicyVersion
        const state = normalizeWikiPromptPresetState({ presets: [old], chatPresetId: 'old' }, () => 'generated')
        const backup = state.presets.find(p => p.name === '공식기본-260922')!
        expect(backup).toBeDefined()
        expect(state.chatPresetId).toBe('old')
        expect(compileWikiPromptGuide(backup).canonicalRewrite).toContain('in separate sections from transient current state')
        expect(compileWikiPromptGuide(state.presets[0]).canonicalRewrite).toContain('One primary home per fact')
        const reloaded = normalizeWikiPromptPresetState({ presets: state.presets, chatPresetId: backup.id }, () => 'unused')
        expect(reloaded.presets).toHaveLength(6)
        expect(reloaded.chatPresetId).toBe(backup.id)
        const imported = parseWikiPromptPreset(serializeWikiPromptPreset(backup), () => 'imported-backup')
        expect(compileWikiPromptGuide(imported).canonicalRewrite).toBe(compileWikiPromptGuide(backup).canonicalRewrite)
    })

    test('optional compression survives normalization and does not discard essential facts', () => {
        const preset = createDefaultWikiPromptPreset('new')
        const block = preset.blocks.find(b => b.id === 'default-length-compression')!
        expect(block).toMatchObject({ enabled: true })
        expect(compileWikiPromptGuide(preset).canonicalRewrite).toContain('Apply stronger compression')
        expect(compileWikiPromptGuide(preset).canonicalRewrite).toContain('Never drop distinct still-valid facts')
        block.enabled = false
        const restored = parseWikiPromptPreset(serializeWikiPromptPreset(preset), () => 'imported')
        expect(compileWikiPromptGuide(restored).canonicalRewrite).not.toContain('Apply stronger compression')
    })
})


test('keeps personal preset selection and policy while installing official choices', () => {
    const personal = duplicateWikiPromptPreset(createDefaultWikiPromptPreset('seed'), 'personal')
    personal.writingPolicyVersion = 1
    personal.name = 'My wiki'
    personal.blocks.find(block => block.id === 'main-wiki-guide')!.content = 'Track my custom facts.'
    const state = normalizeWikiPromptPresetState({ presets: [personal], chatPresetId: personal.id }, () => 'generated')
    expect(state.chatPresetId).toBe('personal')
    expect(state.presets[0].writingPolicyVersion).toBe(1)
    expect(compileWikiPromptGuide(state.presets[0]).analysis).toContain('Track my custom facts.')
    expect(state.presets.filter(preset => preset.builtin)).toHaveLength(6)
    expect(normalizeWikiPromptPresetState(state, () => 'unused')).toEqual(state)
})

describe('recall-focused official preset migration', () => {
    const previous = previousOfficial.preset as WikiPromptPreset

    test('selects the latest official preset for a new installation', () => {
        const state = normalizeWikiPromptPresetState(undefined, () => 'new-default')
        const selected = resolveWikiPromptPreset(state.presets, state.chatPresetId)!
        expect(selected).toMatchObject({ id: 'new-default', name: '공식기본', writingPolicyVersion: 6 })
        expect(state.presets.map(preset => preset.name)).toEqual([
            '공식기본', '공식기본-260922', '공식기본-260922-v2', '공식기본-260930', '공식기본-261003', '공식기본-261003-v5',
        ])
        expect(normalizeWikiPromptPresetState(state, () => 'unused')).toEqual(state)
    })

    test('upgrades the selected official preset while retaining its ID and optional toggles', () => {
        const old = structuredClone(previous)
        old.id = 'existing-official'
        old.blocks.find(block => block.id === 'default-character-equipment')!.enabled = false
        old.blocks.find(block => block.id === 'default-length-compression')!.enabled = true
        const state = normalizeWikiPromptPresetState({ presets: [old], chatPresetId: old.id }, () => 'unused')
        const selected = resolveWikiPromptPreset(state.presets, state.chatPresetId)!
        expect(selected).toMatchObject({ id: old.id, writingPolicyVersion: 6 })
        expect(selected.blocks.find(block => block.id === 'default-character-equipment')?.enabled).toBe(false)
        expect(selected.blocks.find(block => block.id === 'default-length-compression')?.enabled).toBe(true)
        const backup = state.presets.find(preset => preset.name === '공식기본-260922-v2')!
        expect(backup).toBeDefined()
        expect(compileWikiPromptGuide(backup)).toEqual(compileWikiPromptGuide(previous))
    })

    test('keeps the archived policy through selection, reload, duplication and file import', () => {
        const state = normalizeWikiPromptPresetState(undefined, () => 'current')
        const backup = state.presets.find(preset => preset.name === '공식기본-260922-v2')!
        expect(backup).toBeDefined()
        const reloaded = normalizeWikiPromptPresetState({ presets: [backup], chatPresetId: backup.id }, () => 'unused')
        expect(reloaded.chatPresetId).toBe(backup.id)
        expect(reloaded.presets.some(preset => preset.builtin && preset.writingPolicyVersion === 6)).toBe(true)
        const imported = parseWikiPromptPreset(serializeWikiPromptPreset(backup), () => 'imported')
        const duplicate = duplicateWikiPromptPreset(backup, 'copy')
        for (const candidate of [reloaded.presets[0], imported, duplicate]) {
            expect(candidate.writingPolicyVersion).toBe(2)
            expect(compileWikiPromptGuide(candidate)).toEqual(compileWikiPromptGuide(previous))
        }
        expect(normalizeWikiPromptPresetState(reloaded, () => 'unused')).toEqual(reloaded)
    })

    test('preserves a personal v2 preset without silently adding new instructions', () => {
        const personal = duplicateWikiPromptPreset(previous, 'personal-v2')
        const before = compileWikiPromptGuide(personal)
        const state = normalizeWikiPromptPresetState({ presets: [personal], chatPresetId: personal.id }, () => 'unused')
        expect(state.chatPresetId).toBe(personal.id)
        expect(state.presets[0].writingPolicyVersion).toBe(2)
        expect(compileWikiPromptGuide(state.presets[0])).toEqual(before)
    })

    test('routes recall instructions to their intended stages after export and import', () => {
        const preset = createDefaultWikiPromptPreset('latest')
        const imported = parseWikiPromptPreset(serializeWikiPromptPreset(preset), () => 'imported')
        expect(imported.writingPolicyVersion).toBe(6)
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
})

describe('current-state official preset migration', () => {
    const previous = previousRecallOfficial.preset as WikiPromptPreset

    test('upgrades v3 in place while keeping the old instructions selectable and frozen', () => {
        const old = structuredClone(previous)
        old.id = 'selected-official'
        old.blocks.find(block => block.id === 'default-character-equipment')!.enabled = false
        old.blocks.find(block => block.id === 'default-length-compression')!.enabled = true
        const state = normalizeWikiPromptPresetState({ presets: [old], chatPresetId: old.id }, () => 'unused')
        const selected = resolveWikiPromptPreset(state.presets, state.chatPresetId)!
        expect(selected).toMatchObject({ id: old.id, writingPolicyVersion: 6 })
        expect(selected.blocks.find(block => block.id === 'default-character-equipment')?.enabled).toBe(false)
        expect(selected.blocks.find(block => block.id === 'default-length-compression')?.enabled).toBe(true)
        const backup = state.presets.find(preset => preset.name === '공식기본-260930')!
        expect(backup).toBeDefined()
        // Compare to the saved pre-change payload, not a newly generated default.
        expect(backup.blocks).toEqual(previous.blocks)
        const reloaded = normalizeWikiPromptPresetState({ ...state, chatPresetId: backup.id }, () => 'unused')
        expect(reloaded.chatPresetId).toBe(backup.id)
        const imported = parseWikiPromptPreset(serializeWikiPromptPreset(backup), () => 'imported-v3')
        const copied = duplicateWikiPromptPreset(backup, 'copied-v3')
        for (const candidate of [reloaded.presets.find(preset => preset.id === backup.id)!, imported, copied]) {
            expect(candidate.writingPolicyVersion).toBe(3)
            expect(compileWikiPromptGuide(candidate)).toEqual(compileWikiPromptGuide(previous))
        }
        expect(normalizeWikiPromptPresetState(reloaded, () => 'unused')).toEqual(reloaded)
    })

    test('keeps personal v3 instructions and selection unchanged', () => {
        const personal = duplicateWikiPromptPreset(previous, 'personal-v3')
        const state = normalizeWikiPromptPresetState({ presets: [personal], chatPresetId: personal.id }, () => 'unused')
        expect(state.chatPresetId).toBe(personal.id)
        expect(state.presets[0]).toEqual(personal)
        expect(compileWikiPromptGuide(state.presets[0])).toEqual(compileWikiPromptGuide(previous))
    })
})

describe('localized transition official preset migration', () => {
    const previous = previousCurrentStateOfficial.preset as WikiPromptPreset

    test('upgrades v4 in place, enables compression and keeps the old instructions frozen', () => {
        const old = structuredClone(previous)
        old.id = 'official-wiki-current'
        old.blocks.find(block => block.id === 'default-character-equipment')!.enabled = false
        const state = normalizeWikiPromptPresetState({ presets: [old], chatPresetId: old.id }, () => 'unused')
        const selected = resolveWikiPromptPreset(state.presets, state.chatPresetId)!
        expect(selected).toMatchObject({ id: old.id, name: '공식기본', writingPolicyVersion: 6 })
        expect(selected.blocks.find(block => block.id === 'default-character-equipment')?.enabled).toBe(false)
        expect(selected.blocks.find(block => block.id === 'default-length-compression')?.enabled).toBe(true)
        const backup = state.presets.find(preset => preset.name === '공식기본-261003')!
        expect(backup).toBeDefined()
        expect(backup.blocks).toEqual(previous.blocks)
        const reloaded = normalizeWikiPromptPresetState({ ...state, chatPresetId: backup.id }, () => 'unused')
        expect(reloaded.chatPresetId).toBe(backup.id)
        const imported = parseWikiPromptPreset(serializeWikiPromptPreset(backup), () => 'imported-v4')
        const copied = duplicateWikiPromptPreset(backup, 'copied-v4')
        for (const candidate of [reloaded.presets.find(preset => preset.id === backup.id)!, imported, copied]) {
            expect(candidate.writingPolicyVersion).toBe(4)
            expect(compileWikiPromptGuide(candidate)).toEqual(compileWikiPromptGuide(previous))
        }
        expect(normalizeWikiPromptPresetState(reloaded, () => 'unused')).toEqual(reloaded)
    })

    test('keeps personal v4 instructions and selection unchanged', () => {
        const personal = duplicateWikiPromptPreset(previous, 'personal-v4')
        const state = normalizeWikiPromptPresetState({ presets: [personal], chatPresetId: personal.id }, () => 'unused')
        expect(state.chatPresetId).toBe(personal.id)
        expect(state.presets[0]).toEqual(personal)
        expect(compileWikiPromptGuide(state.presets[0])).toEqual(compileWikiPromptGuide(previous))
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
        expect(guide).toContain('exact locale heading')
        expect(guide).toContain('revise that entry instead of appending a new one')
        expect(guide).toContain('one or two representative event links')
        expect(guide).not.toContain('Retain meaningful transition results and exact event links')
    })
})

describe('knowledge-boundary official preset migration', () => {
    const previous = previousLocalizedOfficial.preset as WikiPromptPreset

    test('upgrades v5 in place, keeps its compression choice and freezes the v5 instructions', () => {
        const old = structuredClone(previous)
        old.id = 'official-wiki-current'
        old.blocks.find(block => block.id === 'default-length-compression')!.enabled = false
        const state = normalizeWikiPromptPresetState({ presets: [old], chatPresetId: old.id }, () => 'unused')
        const selected = resolveWikiPromptPreset(state.presets, state.chatPresetId)!
        expect(selected).toMatchObject({ id: old.id, name: '공식기본', writingPolicyVersion: 6 })
        expect(selected.blocks.find(block => block.id === 'default-length-compression')?.enabled).toBe(false)
        const continuity = selected.blocks.find(block => block.id === 'core-character-continuity-contract')!.content
        expect(continuity).toContain('It is not a catalogue of everything the character has seen or been told.')
        expect(continuity).toContain('not a running chronicle of scenes')
        expect(continuity).not.toContain('Retain who met whom and what each person learned.')
        const backup = state.presets.find(preset => preset.name === '공식기본-261003-v5')!
        expect(backup.blocks).toEqual(previous.blocks)
        const imported = parseWikiPromptPreset(serializeWikiPromptPreset(backup), () => 'imported-v5')
        const copied = duplicateWikiPromptPreset(backup, 'copied-v5')
        for (const candidate of [imported, copied]) {
            expect(candidate.writingPolicyVersion).toBe(5)
            expect(compileWikiPromptGuide(candidate)).toEqual(compileWikiPromptGuide(previous))
        }
        expect(normalizeWikiPromptPresetState(state, () => 'unused')).toEqual(state)
    })

    test('keeps personal v5 instructions and selection unchanged', () => {
        const personal = duplicateWikiPromptPreset(previous, 'personal-v5')
        const state = normalizeWikiPromptPresetState({ presets: [personal], chatPresetId: personal.id }, () => 'unused')
        expect(state.chatPresetId).toBe(personal.id)
        expect(state.presets[0]).toEqual(personal)
        expect(compileWikiPromptGuide(state.presets[0])).toEqual(compileWikiPromptGuide(previous))
    })
})
