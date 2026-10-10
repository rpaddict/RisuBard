import type { ResolvedRisuBardChatSettings, RisuBardChatSettings } from './risuBardSettings'

/**
 * One character card is kept at 80% of the per-source budget, the target holds two main cards plus room for other
 * memory, and the maximum is at least target + events + 400 (recent story flow), also after dynamic growth.
 */
export type MemoryBudgetPresetId = 'economy' | 'standard' | 'generous'

export const MEMORY_BUDGET_FIELD_KEYS = [
    'risuBardInquiryTargetTokenBudget',
    'risuBardInquiryEventTokenBudget',
    'risuBardInquirySourceTokenBudget',
    'risuBardInquiryMaximumTokenBudget',
    'risuBardDynamicMemoryMode',
    'risuBardDynamicMemoryMaximumTokens',
] as const satisfies readonly (keyof RisuBardChatSettings)[]

export type MemoryBudgetFieldKey = typeof MEMORY_BUDGET_FIELD_KEYS[number]
export type MemoryBudgetValues = Pick<ResolvedRisuBardChatSettings, MemoryBudgetFieldKey>

export interface MemoryBudgetPreset {
    id: MemoryBudgetPresetId
    label: string
    target: number
    events: number
    perSource: number
    maximum: number
    dynamicMode: 'economy' | 'balanced'
    dynamicMaximum: number
}

export const MEMORY_BUDGET_PRESET_IDS = ['economy', 'standard', 'generous'] as const satisfies readonly MemoryBudgetPresetId[]

export const MEMORY_BUDGET_PRESETS: Readonly<Record<MemoryBudgetPresetId, MemoryBudgetPreset>> = {
    economy: { id: 'economy', label: '절약', target: 3_000, events: 2_000, perSource: 1_500, maximum: 5_500, dynamicMode: 'economy', dynamicMaximum: 12_000 },
    standard: { id: 'standard', label: '보통', target: 4_000, events: 3_000, perSource: 2_000, maximum: 7_500, dynamicMode: 'economy', dynamicMaximum: 12_000 },
    generous: { id: 'generous', label: '넉넉', target: 6_000, events: 4_000, perSource: 2_500, maximum: 10_500, dynamicMode: 'balanced', dynamicMaximum: 16_000 },
}

export function memoryBudgetPresetValues(id: MemoryBudgetPresetId): MemoryBudgetValues {
    const preset = MEMORY_BUDGET_PRESETS[id]
    return {
        risuBardInquiryTargetTokenBudget: preset.target,
        risuBardInquiryEventTokenBudget: preset.events,
        risuBardInquirySourceTokenBudget: preset.perSource,
        risuBardInquiryMaximumTokenBudget: preset.maximum,
        risuBardDynamicMemoryMode: preset.dynamicMode,
        risuBardDynamicMemoryMaximumTokens: preset.dynamicMaximum,
    }
}

/** Version 2 made 보통 the default; persisted globals below it are migrated once by `migrateLegacyMemoryBudgetDefaults`. */
export const MEMORY_BUDGET_DEFAULTS_VERSION = 2

export interface MemoryBudgetMigrationTarget extends Partial<MemoryBudgetValues> {
    risuBardMemoryBudgetDefaultsVersion?: number
}

/**
 * One-time migration of the GLOBAL values only (never bot-pinned or chat copies): when all six are still the old
 * defaults (an absent value counts as the default), they become the 보통 tier. Always stamps the version, so a user
 * who later picks the old values on purpose is not migrated again.
 */
export function migrateLegacyMemoryBudgetDefaults(data: MemoryBudgetMigrationTarget): void {
    const version = data.risuBardMemoryBudgetDefaultsVersion
    if (typeof version === 'number' && version >= MEMORY_BUDGET_DEFAULTS_VERSION) return
    const legacy = (value: unknown, old: unknown) => value === undefined || value === null || value === old
    if (
        legacy(data.risuBardInquiryTargetTokenBudget, 2_000)
        && legacy(data.risuBardInquiryEventTokenBudget, 2_000)
        && legacy(data.risuBardInquirySourceTokenBudget, 2_000)
        && legacy(data.risuBardInquiryMaximumTokenBudget, 6_000)
        && legacy(data.risuBardDynamicMemoryMode, 'off')
        && legacy(data.risuBardDynamicMemoryMaximumTokens, 12_000)
    ) Object.assign(data, memoryBudgetPresetValues('standard'))
    data.risuBardMemoryBudgetDefaultsVersion = MEMORY_BUDGET_DEFAULTS_VERSION
}

/** Exact match on all six resolved values; anything else is `custom`. */
export function detectMemoryBudgetPreset(settings: MemoryBudgetValues): MemoryBudgetPresetId | 'custom' {
    for (const id of MEMORY_BUDGET_PRESET_IDS) {
        const values = memoryBudgetPresetValues(id)
        if (MEMORY_BUDGET_FIELD_KEYS.every(key => settings[key] === values[key])) return id
    }
    return 'custom'
}
