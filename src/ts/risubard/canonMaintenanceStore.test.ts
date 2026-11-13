import { describe, expect, test } from 'vitest'
import { createCanonMaintenanceStore } from './canonMaintenanceStore'

function memoryStorage(initial: Record<string, string> = {}) {
    const items = new Map(Object.entries(initial))
    return {
        items,
        getItem: (key: string) => items.get(key) ?? null,
        setItem: (key: string, value: string) => { items.set(key, value) },
    }
}

describe('canon maintenance store', () => {
    test('returns what another store instance saved', () => {
        const storage = memoryStorage()
        createCanonMaintenanceStore(storage).set('card', { baselineTokens: 900, restingSources: ['a', 'b'], retry: true })
        expect(createCanonMaintenanceStore(storage).get('card'))
            .toEqual({ baselineTokens: 900, restingSources: ['a', 'b'], retry: true })
        expect(createCanonMaintenanceStore(storage).get('other')).toBeUndefined()
    })

    test('drops the oldest cards beyond 64 and keeps a rewritten card', () => {
        const store = createCanonMaintenanceStore(memoryStorage())
        for (let index = 0; index < 64; index++) store.set(`card-${index}`, { baselineTokens: index })
        store.set('card-0', { baselineTokens: 1000 })
        store.set('card-64', { baselineTokens: 64 })
        expect(store.get('card-0')).toEqual({ baselineTokens: 1000 })
        expect(store.get('card-1')).toBeUndefined()
        expect(store.get('card-64')).toEqual({ baselineTokens: 64 })
    })

    test('ignores broken data and a storage that refuses writes', () => {
        expect(createCanonMaintenanceStore(memoryStorage({ 'risubard:canon-maintenance-rest': 'not json' })).get('card'))
            .toBeUndefined()
        expect(createCanonMaintenanceStore(memoryStorage({
            'risubard:canon-maintenance-rest': JSON.stringify({ card: { baselineTokens: 'x', restingSources: [1], retry: 'yes' } }),
        })).get('card')).toEqual({})
        const refusing = { getItem: () => null, setItem: () => { throw new Error('quota') } }
        expect(() => createCanonMaintenanceStore(refusing).set('card', { baselineTokens: 1 })).not.toThrow()
        expect(() => createCanonMaintenanceStore(undefined).set('card', { baselineTokens: 1 })).not.toThrow()
    })
})
