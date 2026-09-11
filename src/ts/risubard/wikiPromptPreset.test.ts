import { describe, expect, test } from 'vitest'
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
            'core-analysis-contract',
            'core-historical-analysis-contract',
            'main-wiki-guide',
            'default-puzzle-clue-tracker',
            'default-puzzle-response-reasoning',
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
