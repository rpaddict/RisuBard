import type { CanonMaintenanceRestState } from '../../../server/node/risubard-memory-analysis'

const STORAGE_KEY = 'risubard:canon-maintenance-rest'
// One card keeps up to about 4 KB of source IDs. The oldest cards leave first,
// which costs them one extra upkeep attempt at most.
const MAX_CARDS = 64

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>

function browserStorage(): StorageLike | undefined {
    try {
        return typeof localStorage === 'undefined' ? undefined : localStorage
    }
    catch {
        return undefined
    }
}

function readState(value: unknown): CanonMaintenanceRestState | undefined {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
    const { baselineTokens, restingSources, retry } = value as Record<string, unknown>
    return {
        ...(typeof baselineTokens === 'number' && Number.isFinite(baselineTokens) ? { baselineTokens } : {}),
        ...(Array.isArray(restingSources) && restingSources.every((id) => typeof id === 'string')
            ? { restingSources: restingSources as string[] } : {}),
        ...(retry === true ? { retry } : {}),
    }
}

/** Keeps upkeep cooldowns in this browser, so a reload does not retry every oversized card. */
export function createCanonMaintenanceStore(storage: StorageLike | undefined = browserStorage()) {
    const readCards = (): Record<string, unknown> => {
        try {
            const value: unknown = JSON.parse(storage?.getItem(STORAGE_KEY) ?? '{}')
            return typeof value === 'object' && value !== null && !Array.isArray(value)
                ? value as Record<string, unknown> : {}
        }
        catch {
            return {}
        }
    }
    return {
        get(key: string): CanonMaintenanceRestState | undefined {
            return readState(readCards()[key])
        },
        set(key: string, state: CanonMaintenanceRestState): void {
            const cards = readCards()
            // Re-inserting moves the card to the newest end.
            delete cards[key]
            cards[key] = state
            const keys = Object.keys(cards)
            for (const oldest of keys.slice(0, Math.max(0, keys.length - MAX_CARDS))) delete cards[oldest]
            try {
                storage?.setItem(STORAGE_KEY, JSON.stringify(cards))
            }
            catch { /* Quota or private mode: the cooldown lasts this session only. */ }
        },
    }
}
