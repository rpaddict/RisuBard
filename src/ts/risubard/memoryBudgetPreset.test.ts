import { describe, expect, test } from 'vitest'
import { resolveDynamicMemoryBudget } from './dynamicMemoryBudget'
import {
    MEMORY_BUDGET_DEFAULTS_VERSION,
    MEMORY_BUDGET_FIELD_KEYS,
    MEMORY_BUDGET_PRESET_IDS,
    MEMORY_BUDGET_PRESETS,
    detectMemoryBudgetPreset,
    memoryBudgetPresetValues,
    migrateLegacyMemoryBudgetDefaults,
    type MemoryBudgetPresetId,
} from './memoryBudgetPreset'
import { resolveRisuBardChatSettings } from './risuBardSettings'

const resolvePreset = (id: MemoryBudgetPresetId) => resolveRisuBardChatSettings(memoryBudgetPresetValues(id))

describe('memory budget presets', () => {
    test('keep the agreed tier values', () => {
        expect(MEMORY_BUDGET_PRESETS).toEqual({
            economy: { id: 'economy', label: '절약', target: 3000, events: 2000, perSource: 1500, maximum: 5500, dynamicMode: 'economy', dynamicMaximum: 12000 },
            standard: { id: 'standard', label: '보통', target: 4000, events: 3000, perSource: 2000, maximum: 7500, dynamicMode: 'economy', dynamicMaximum: 12000 },
            generous: { id: 'generous', label: '넉넉', target: 6000, events: 4000, perSource: 2500, maximum: 10500, dynamicMode: 'balanced', dynamicMaximum: 16000 },
        })
        expect(memoryBudgetPresetValues('standard')).toEqual({
            risuBardInquiryTargetTokenBudget: 4000,
            risuBardInquiryEventTokenBudget: 3000,
            risuBardInquirySourceTokenBudget: 2000,
            risuBardInquiryMaximumTokenBudget: 7500,
            risuBardDynamicMemoryMode: 'economy',
            risuBardDynamicMemoryMaximumTokens: 12000,
        })
        expect(Object.keys(memoryBudgetPresetValues('economy')).sort()).toEqual([...MEMORY_BUDGET_FIELD_KEYS].sort())
    })

    test.each(MEMORY_BUDGET_PRESET_IDS)('%s leaves room for recent story flow, also after dynamic growth', (id) => {
        const settings = resolvePreset(id)
        expect(settings.risuBardInquiryMaximumTokenBudget)
            .toBeGreaterThanOrEqual(settings.risuBardInquiryTargetTokenBudget + settings.risuBardInquiryEventTokenBudget + 400)
        const grown = resolveDynamicMemoryBudget(settings, 500_000)
        expect(grown.maximum).toBeGreaterThan(settings.risuBardInquiryMaximumTokenBudget)
        expect(grown.target + grown.events + 400).toBeLessThanOrEqual(grown.maximum)
    })

    test.each(MEMORY_BUDGET_PRESET_IDS)('%s holds two main cards within the target', (id) => {
        const { perSource, target } = MEMORY_BUDGET_PRESETS[id]
        expect(2 * Math.floor(perSource * 0.8)).toBeLessThan(target)
    })

    test.each(MEMORY_BUDGET_PRESET_IDS)('%s round-trips through detect', (id) => {
        expect(detectMemoryBudgetPreset(resolvePreset(id))).toBe(id)
    })

    test('a resolved settings object without stored values is the standard tier', () => {
        expect(detectMemoryBudgetPreset(resolveRisuBardChatSettings({}))).toBe('standard')
    })

    test.each(MEMORY_BUDGET_PRESET_IDS.flatMap(id => MEMORY_BUDGET_FIELD_KEYS.map(key => [id, key] as const)))(
        '%s with a changed %s detects as custom', (id, key) => {
            const settings = resolvePreset(id)
            const changed = {
                ...settings,
                [key]: key === 'risuBardDynamicMemoryMode'
                    ? (settings.risuBardDynamicMemoryMode === 'recall' ? 'off' : 'recall')
                    : settings[key] as number + 1,
            }
            expect(detectMemoryBudgetPreset(changed)).toBe('custom')
        },
    )

    test('migrates exactly the old defaults to the standard tier once', () => {
        const legacy = () => ({
            risuBardInquiryTargetTokenBudget: 2000,
            risuBardInquiryEventTokenBudget: 2000,
            risuBardInquirySourceTokenBudget: 2000,
            risuBardInquiryMaximumTokenBudget: 6000,
            risuBardDynamicMemoryMode: 'off' as const,
            risuBardDynamicMemoryMaximumTokens: 12000,
        })
        const migrated = legacy()
        migrateLegacyMemoryBudgetDefaults(migrated)
        expect(migrated).toEqual({ ...memoryBudgetPresetValues('standard'), risuBardMemoryBudgetDefaultsVersion: MEMORY_BUDGET_DEFAULTS_VERSION })

        const missing: Parameters<typeof migrateLegacyMemoryBudgetDefaults>[0] = {}
        migrateLegacyMemoryBudgetDefaults(missing)
        expect(missing).toEqual({ ...memoryBudgetPresetValues('standard'), risuBardMemoryBudgetDefaultsVersion: 2 })

        const customized = { ...legacy(), risuBardInquiryMaximumTokenBudget: 6500 }
        migrateLegacyMemoryBudgetDefaults(customized)
        expect(customized).toEqual({ ...legacy(), risuBardInquiryMaximumTokenBudget: 6500, risuBardMemoryBudgetDefaultsVersion: 2 })

        const current = { ...legacy(), risuBardMemoryBudgetDefaultsVersion: 2 }
        migrateLegacyMemoryBudgetDefaults(current)
        expect(current).toEqual({ ...legacy(), risuBardMemoryBudgetDefaultsVersion: 2 })
    })

    test('an explicitly disabled dynamic mode is custom even when the other values match', () => {
        const settings = resolveRisuBardChatSettings({ ...memoryBudgetPresetValues('standard'), risuBardDynamicMemoryMode: 'off' })
        expect(settings.risuBardDynamicMemoryMode).toBe('off')
        expect(detectMemoryBudgetPreset(settings)).toBe('custom')
    })
})
