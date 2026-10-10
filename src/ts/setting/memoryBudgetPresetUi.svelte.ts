import { detectMemoryBudgetPreset } from '../risubard/memoryBudgetPreset'
import { resolveRisuBardChatSettings } from '../risubard/risuBardSettings'
import type { SettingContext } from './types'

/**
 * Page-session UI state of the global memory budget preset. Choosing 커스텀 keeps the six individual entries
 * visible without changing any value, so the flag is shared by the preset control and the entries' conditions.
 */
export const memoryBudgetPresetUi = $state({ customOpen: false })

/** The six individual entries are visible for 커스텀 (chosen explicitly or derived from non-tier values). */
export function showMemoryBudgetFields({ db }: SettingContext): boolean {
    return memoryBudgetPresetUi.customOpen || detectMemoryBudgetPreset(resolveRisuBardChatSettings(db)) === 'custom'
}
