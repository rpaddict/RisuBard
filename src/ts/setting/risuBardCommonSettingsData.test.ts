import { afterEach, describe, expect, it } from 'vitest'
import { memoryBudgetPresetValues } from '../risubard/memoryBudgetPreset'
import { memoryBudgetPresetUi, showMemoryBudgetFields } from './memoryBudgetPresetUi.svelte'
import { risuBardCommonSettingsItems } from './risuBardCommonSettingsData'

describe('RisuBard common Arca settings', () => {
    it('lets number inputs keep intermediate draft values while typing', () => {
        const numericSettingIds = [
            'risubard.common.arcaChatImageWidth',
            'risubard.common.arcaChatFontSize',
            'risubard.common.arcaChatParagraphSpacing',
        ]

        for (const id of numericSettingIds) {
            const item = risuBardCommonSettingsItems.find((candidate) => candidate.id === id)
            expect(item?.type).toBe('number')
            expect(item?.setValue).toBeUndefined()
        }
    })

    it('protects built-in Archplotter presets while keeping user presets editable', () => {
        const checkpoint = risuBardCommonSettingsItems.find((candidate) =>
            candidate.id === 'risubard.arcPlotter.checkpointSize')
        const builtInContext = {
            db: { risuBardArcPlotterPresetId: 'novella' },
        } as any
        checkpoint?.onChange?.(4, builtInContext)
        expect(builtInContext.db.risuBardArcPlotterPresetId).toBe('custom')

        const userContext = {
            db: { risuBardArcPlotterPresetId: 'user:test' },
        } as any
        checkpoint?.onChange?.(5, userContext)
        expect(userContext.db.risuBardArcPlotterPresetId).toBe('user:test')
    })
})

describe('RisuBard common memory budget preset settings', () => {
    const find = (id: string) => risuBardCommonSettingsItems.find((candidate) => candidate.id === id)
    const gatedIds = [
        'risubard.chat.dynamicMemory',
        'risubard.chat.inquiryTargetTokenBudget',
        'risubard.chat.inquiryEventTokenBudget',
        'risubard.chat.inquiryMaximumTokenBudget',
        'risubard.chat.inquirySourceTokenBudget',
    ]
    afterEach(() => { memoryBudgetPresetUi.customOpen = false })

    it('places the preset control right before the dynamic memory entry with a registered component', () => {
        const ids = risuBardCommonSettingsItems.map((item) => item.id)
        expect(ids.indexOf('risubard.chat.memoryBudgetPreset') + 1).toBe(ids.indexOf('risubard.chat.dynamicMemory'))
        expect(find('risubard.chat.memoryBudgetPreset')).toMatchObject({
            type: 'custom',
            componentId: 'RisuBardMemoryBudgetPreset',
            labelKey: 'risuBardMemoryBudgetPreset',
            helpKey: 'risuBardMemoryBudgetPreset',
        })
        expect(find('risubard.chat.memoryBudgetPreset')?.condition).toBeUndefined()
    })

    it('gates only the six budget entries and keeps the other search entries visible', () => {
        for (const id of gatedIds) expect(find(id)?.condition, id).toBe(showMemoryBudgetFields)
        for (const id of ['risubard.chat.inquiryTimeoutMs', 'risubard.chat.historicalSourceMatchLimit', 'risubard.chat.analysisTokenLimit']) {
            expect(find(id)?.condition, id).toBeUndefined()
        }
    })

    it('hides the entries for a tier and shows them for custom values or an explicit custom choice', () => {
        const visible = (db: object) => gatedIds.map((id) => find(id)!.condition!({ db } as any))
        expect(visible({})).toEqual(gatedIds.map(() => false))
        for (const id of ['economy', 'standard', 'generous'] as const) {
            expect(visible(memoryBudgetPresetValues(id))).toEqual(gatedIds.map(() => false))
        }
        expect(visible({ ...memoryBudgetPresetValues('standard'), risuBardInquirySourceTokenBudget: 2100 })).toEqual(gatedIds.map(() => true))
        expect(visible({ risuBardDynamicMemoryMode: 'off' })).toEqual(gatedIds.map(() => true))
        memoryBudgetPresetUi.customOpen = true
        expect(visible(memoryBudgetPresetValues('standard'))).toEqual(gatedIds.map(() => true))
    })
})
