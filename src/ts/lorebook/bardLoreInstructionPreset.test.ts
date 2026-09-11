import { describe, expect, it } from 'vitest'
import {
    BARD_LORE_DEFAULT_INSTRUCTION_PRESET_ID,
    compileBardLoreInstructionPreset,
    createDefaultBardLoreInstructionPreset,
    deleteBardLoreInstructionPreset,
    duplicateBardLoreInstructionPreset,
    normalizeBardLoreInstructionPresetState,
    resolveBardLoreInstructionPreset,
} from './bardLoreInstructionPreset'

describe('Grimoire analysis instruction presets', () => {
    it('preserves the working instruction as a protected built-in and compiles its runtime slots', () => {
        const preset = createDefaultBardLoreInstructionPreset()

        expect(preset).toMatchObject({
            id: BARD_LORE_DEFAULT_INSTRUCTION_PRESET_ID,
            builtin: true,
            revision: 1,
        })
        expect(preset.content).toContain('Analyze Grimoire metadata for deterministic runtime retrieval.')
        expect(preset.content).toContain('status display')
        expect(preset.content).toContain('composite directory, roster, timeline')
        expect(preset.content).toContain('ambient')

        const compiled = compileBardLoreInstructionPreset(preset, {
            languageInstruction: 'WRITE IN KOREAN',
            filterFacetInstruction: 'FILTER WORK AND GENDER',
        })
        expect(compiled).toContain('WRITE IN KOREAN')
        expect(compiled).toContain('FILTER WORK AND GENDER')
        expect(compiled).not.toContain('{{metadata_language_instruction}}')
        expect(compiled).not.toContain('{{filter_facet_instruction}}')
    })

    it('restores a tampered built-in, keeps editable copies, and resolves missing selections safely', () => {
        const custom = duplicateBardLoreInstructionPreset(
            createDefaultBardLoreInstructionPreset(),
            'custom',
        )
        custom.content = 'Custom analysis instruction.'
        const state = normalizeBardLoreInstructionPresetState({
            presets: [
                { ...createDefaultBardLoreInstructionPreset(), content: 'tampered' },
                custom,
            ],
            activePresetId: 'missing',
        })

        expect(state.presets[0]).toEqual(createDefaultBardLoreInstructionPreset())
        expect(state.presets[1]).toMatchObject({ id: 'custom', builtin: false, content: 'Custom analysis instruction.' })
        expect(state.activePresetId).toBe(BARD_LORE_DEFAULT_INSTRUCTION_PRESET_ID)
        expect(resolveBardLoreInstructionPreset(state.presets, 'custom')).toBe(state.presets[1])
        expect(resolveBardLoreInstructionPreset(state.presets, 'missing')).toBe(state.presets[0])
    })

    it('allows deleting copies but never the built-in preset', () => {
        const builtin = createDefaultBardLoreInstructionPreset()
        const custom = duplicateBardLoreInstructionPreset(builtin, 'custom')

        expect(deleteBardLoreInstructionPreset([builtin, custom], builtin.id)).toEqual({
            presets: [builtin, custom],
            deleted: false,
        })
        expect(deleteBardLoreInstructionPreset([builtin, custom], custom.id)).toEqual({
            presets: [builtin],
            deleted: true,
        })
    })

    it('preserves an intentionally blank editable copy across normalization', () => {
        const custom = duplicateBardLoreInstructionPreset(createDefaultBardLoreInstructionPreset(), 'blank')
        custom.content = ''

        const state = normalizeBardLoreInstructionPresetState({
            presets: [custom],
            activePresetId: custom.id,
        })

        expect(state.activePresetId).toBe('blank')
        expect(state.presets[1].content).toBe('')
    })
})
