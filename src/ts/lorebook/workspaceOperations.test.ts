import { describe, expect, it } from 'vitest'
import type { loreBook } from '../storage/database.svelte'
import {
    addLorebookEntry,
    addKeysToEntries,
    applyBatchPatch,
    deleteLorebookEntries,
    ensureLorebookIds,
    filterLorebookEntries,
    moveLorebookEntries,
    removeKeysFromEntries,
    updateLorebookEntry,
} from './workspaceOperations'

type TestLorebook = loreBook & { enabled?: boolean }

function lore(overrides: Partial<TestLorebook> & { id: string }): TestLorebook {
    return {
        id: overrides.id,
        key: '',
        secondkey: '',
        insertorder: 0,
        comment: overrides.id,
        content: '',
        mode: 'normal',
        alwaysActive: false,
        selective: false,
        ...overrides,
    }
}

describe('workspaceOperations', () => {
    it('adds one entry immutably while preserving every existing identity and field', () => {
        const existing = lore({ id: 'existing', content: 'full text', bookVersion: 7 })
        const added = lore({ id: 'added', comment: 'Added', activationPercent: 35 })
        const entries = [existing]

        const result = addLorebookEntry(entries, added)

        expect(result).toEqual([existing, added])
        expect(result).not.toBe(entries)
        expect(result[0]).toBe(existing)
        expect(result[1]).toBe(added)
        expect(entries).toEqual([existing])
        expect(addLorebookEntry(entries, lore({ id: 'existing' }))).toBe(entries)
    })

    it('deletes selected entries and folder children immutably', () => {
        const folderKey = '\uf000folder:places'
        const untouched = lore({ id: 'untouched', content: 'keep me' })
        const entries = [
            lore({ id: 'folder', mode: 'folder', key: folderKey }),
            lore({ id: 'child', folder: folderKey, content: 'child text' }),
            untouched,
        ]

        const result = deleteLorebookEntries(entries, new Set(['folder']))

        expect(result).toEqual([untouched])
        expect(result[0]).toBe(untouched)
        expect(entries).toHaveLength(3)
        expect(deleteLorebookEntries(entries, new Set(['missing']))).toBe(entries)
    })

    it('updates one entry including folders while preserving unknown fields and identities', () => {
        const folder = lore({ id: 'folder', mode: 'folder', key: '\uf000folder:places', content: 'metadata' })
        const untouched = lore({ id: 'untouched', content: 'keep' })
        const entries = [folder, untouched]

        const result = updateLorebookEntry(entries, 'folder', { comment: 'Renamed', insertorder: 25 })

        expect(result[0]).toMatchObject({
            id: 'folder',
            mode: 'folder',
            key: '\uf000folder:places',
            content: 'metadata',
            comment: 'Renamed',
            insertorder: 25,
        })
        expect(result[1]).toBe(untouched)
        expect(updateLorebookEntry(entries, 'missing', { comment: 'Nope' })).toBe(entries)
    })

    it('never mutates child links through batch patch or key operations', () => {
        const normal = lore({ id: 'normal', key: 'alpha', secondkey: 'one' })
        const child = lore({ id: 'child', mode: 'child', key: 'global-id', secondkey: 'linked' })
        const selected = new Set(['normal', 'child'])

        const patched = applyBatchPatch([normal, child], selected, { enabled: false, content: 'changed' })
        const added = addKeysToEntries([normal, child], selected, 'key', ['beta'])
        const removed = removeKeysFromEntries([normal, child], selected, 'secondkey', ['linked'])

        expect(patched[0]).toMatchObject({ enabled: false, content: 'changed' })
        expect(patched[1]).toBe(child)
        expect(added[1]).toBe(child)
        expect(removed[1]).toBe(child)
    })

    it('assigns stable IDs only to missing or duplicate entries without mutating input', () => {
        const entries = [
            lore({ id: 'kept', comment: 'Kept', content: 'one' }),
            lore({ id: 'kept', comment: 'Duplicate' }),
            lore({ id: '', comment: 'Missing' }),
        ]
        const ids = ['new-1', 'new-2']

        const result = ensureLorebookIds(entries, () => ids.shift()!)

        expect(result.map((entry) => entry.id)).toEqual(['kept', 'new-1', 'new-2'])
        expect(result[0]).toBe(entries[0])
        expect(result[0]).toMatchObject({ content: 'one' })
        expect(entries.map((entry) => entry.id)).toEqual(['kept', 'kept', ''])
    })

    it('does not generate an ID reserved by a later unique entry', () => {
        const entries = [lore({ id: '' }), lore({ id: 'future' })]
        const generated = ['future', '', 'created']

        const result = ensureLorebookIds(entries, () => generated.shift()!)

        expect(result.map((entry) => entry.id)).toEqual(['created', 'future'])
        expect(result[1]).toBe(entries[1])
    })

    it('filters by case-insensitive key matches while retaining the matching child parent', () => {
        const peopleFolderKey = '\uf000folder:people'
        const entries = [
            lore({ id: 'folder', mode: 'folder', key: peopleFolderKey, comment: 'People' }),
            lore({ id: 'ada', folder: peopleFolderKey, comment: 'Ada', key: 'Analyst', secondkey: 'Mathematician' }),
            lore({ id: 'beau', folder: peopleFolderKey, comment: 'Beau', key: 'Pilot' }),
            lore({ id: 'root', comment: 'Root', key: 'Elsewhere' }),
        ]

        expect(filterLorebookEntries(entries, { query: 'MATH', target: 'keys', enabled: 'all' })
            .map((entry) => entry.id)).toEqual(['folder', 'ada'])
        expect(filterLorebookEntries(entries, { query: 'people', target: 'name', enabled: 'all' })
            .map((entry) => entry.id)).toEqual(['folder'])
    })

    it('searches names, keys, and entry bodies with the all target', () => {
        const entries = [
            lore({ id: 'name-hit', comment: 'Hidden Library', key: 'archive', content: 'ordinary text' }),
            lore({ id: 'key-hit', comment: 'Weather', key: 'library-key', content: 'ordinary text' }),
            lore({ id: 'body-hit', comment: 'Alchemy', key: 'atelier', content: 'The library keeps forbidden formulas.' }),
            lore({ id: 'miss', comment: 'Harbor', key: 'ships', content: 'Salt and rope.' }),
        ]

        expect(filterLorebookEntries(entries, { query: 'library', target: 'all', enabled: 'all' })
            .map((entry) => entry.id)).toEqual(['name-hit', 'key-hit', 'body-hit'])
    })

    it('filters by enabled state independently from alwaysActive', () => {
        const entries = [
            lore({ id: 'enabled', enabled: true, alwaysActive: false }),
            lore({ id: 'enabled-default', alwaysActive: true }),
            lore({ id: 'disabled', enabled: false, alwaysActive: true }),
        ]

        expect(filterLorebookEntries(entries, { query: '', target: 'name', enabled: 'enabled' })
            .map((entry) => entry.id)).toEqual(['enabled', 'enabled-default'])
        expect(filterLorebookEntries(entries, { query: '', target: 'name', enabled: 'disabled' })
            .map((entry) => entry.id)).toEqual(['disabled'])
    })

    it('shows all folders for an empty key query, including folders without keys', () => {
        const entries = [
            lore({ id: 'empty-folder', mode: 'folder', key: '' }),
            lore({ id: 'folder', mode: 'folder', key: '\uf000folder:places' }),
            lore({ id: 'root', key: 'city' }),
        ]

        expect(filterLorebookEntries(entries, { query: '', target: 'keys', enabled: 'all' })
            .map((entry) => entry.id)).toEqual(['empty-folder', 'folder', 'root'])
    })

    it('batch patches only selected non-folder entries and retains untouched identities', () => {
        const selected = lore({ id: 'selected', comment: 'Before', alwaysActive: false })
        const folder = lore({ id: 'folder', mode: 'folder', comment: 'Folder' })
        const untouched = lore({ id: 'untouched', comment: 'Untouched' })
        const entries = [selected, folder, untouched]

        const result = applyBatchPatch(entries, new Set(['selected', 'folder']), {
            alwaysActive: true,
            comment: 'After',
        })

        expect(result[0]).toMatchObject({ alwaysActive: true, comment: 'After' })
        expect(result[0]).not.toBe(selected)
        expect(result[1]).toBe(folder)
        expect(result[2]).toBe(untouched)
        expect(selected.alwaysActive).toBe(false)
    })

    it('adds and removes exact normalized keys for selected non-folder entries', () => {
        const selected = lore({ id: 'selected', key: 'alpha, beta, alpha, Alpha', secondkey: 'x' })
        const folder = lore({ id: 'folder', mode: 'folder', key: 'alpha' })
        const entries = [selected, folder]

        const added = addKeysToEntries(entries, new Set(['selected', 'folder']), 'key', [' beta, gamma ', '', 'alpha'])
        expect(added[0].key).toBe('alpha, beta, Alpha, gamma')
        expect(added[1]).toBe(folder)

        const removed = removeKeysFromEntries(added, new Set(['selected']), 'key', ['Alpha, gamma'])
        expect(removed[0].key).toBe('alpha, beta')
        expect(selected.key).toBe('alpha, beta, alpha, Alpha')
    })

    it('deduplicates surviving keys when removing exact keys', () => {
        const entries = [lore({ id: 'selected', key: 'alpha, alpha, beta' })]

        const result = removeKeysFromEntries(entries, new Set(['selected']), 'key', ['beta'])

        expect(result[0].key).toBe('alpha')
    })

    it('moves selected entries in their source order, not sourceIds order, and renumbers a successful move', () => {
        const entries = [
            lore({ id: 'a' }),
            lore({ id: 'b' }),
            lore({ id: 'c' }),
            lore({ id: 'target' }),
        ]

        const result = moveLorebookEntries(entries, ['c', 'a'], 'target', 'before')

        expect(result.map((entry) => entry.id)).toEqual(['b', 'a', 'c', 'target'])
        expect(result.map((entry) => entry.insertorder)).toEqual([10, 20, 30, 40])
        expect(entries.map((entry) => entry.id)).toEqual(['a', 'b', 'c', 'target'])
    })

    it('moves folders with their children as root groups and never nests folders', () => {
        const oneFolderKey = '\uf000folder:one'
        const twoFolderKey = '\uf000folder:two'
        const entries = [
            lore({ id: 'two', mode: 'folder', key: twoFolderKey, comment: 'Two' }),
            lore({ id: 'two-child', folder: twoFolderKey }),
            lore({ id: 'one', mode: 'folder', key: oneFolderKey, comment: 'One' }),
            lore({ id: 'one-child', folder: oneFolderKey }),
            lore({ id: 'root' }),
        ]

        const result = moveLorebookEntries(entries, ['two'], 'one', 'inside')

        expect(result.map((entry) => entry.id)).toEqual(['one', 'one-child', 'two', 'two-child', 'root'])
        expect(result.find((entry) => entry.id === 'two')?.folder).toBeUndefined()
        expect(result.find((entry) => entry.id === 'two-child')?.folder).toBe(twoFolderKey)
    })

    it('preserves empty-key folders during a successful root reorder', () => {
        const emptyFolder = lore({ id: 'empty-folder', mode: 'folder', key: '' })
        const entries = [emptyFolder, lore({ id: 'a' }), lore({ id: 'b' })]

        const result = moveLorebookEntries(entries, ['b'], 'a', 'before')

        expect(result.map((entry) => entry.id)).toEqual(['empty-folder', 'b', 'a'])
    })

    it('moves only the selected empty-key folder when another empty-key folder is the target', () => {
        const untouched = lore({ id: 'untouched', mode: 'folder', key: '', insertorder: 10 })
        const selected = lore({ id: 'selected', mode: 'folder', key: '', insertorder: 20 })
        const target = lore({ id: 'target', mode: 'folder', key: '', insertorder: 30 })
        const entries = [untouched, selected, target]

        const result = moveLorebookEntries(entries, ['selected'], 'target', 'after')

        expect(result.map((entry) => entry.id)).toEqual(['untouched', 'target', 'selected'])
        expect(result[0]).toBe(untouched)
        expect(result.filter((entry) => entry.mode === 'folder').map((entry) => entry.id))
            .toEqual(['untouched', 'target', 'selected'])
    })

    it('rejects an inside drop onto an empty-key folder without writing an unrepresentable parent', () => {
        const emptyFolder = lore({ id: 'empty-folder', mode: 'folder', key: '' })
        const root = lore({ id: 'root' })
        const entries = [emptyFolder, root]

        const result = moveLorebookEntries(entries, ['root'], 'empty-folder', 'inside')

        expect(result).toBe(entries)
        expect(root.folder).toBeUndefined()
        expect(moveLorebookEntries(result, ['root'], 'empty-folder', 'inside')).toBe(entries)
    })

    it('returns the original reference when duplicate folder keys make hierarchy ambiguous', () => {
        const folderKey = '\uf000folder:duplicate'
        const entries = [
            lore({ id: 'first', mode: 'folder', key: folderKey }),
            lore({ id: 'second', mode: 'folder', key: folderKey }),
            lore({ id: 'root' }),
        ]

        expect(moveLorebookEntries(entries, ['root'], 'first', 'inside')).toBe(entries)
    })

    it('moves multiple selected entries into a folder after its existing children', () => {
        const folderKey = '\uf000folder:target'
        const entries = [
            lore({ id: 'folder', mode: 'folder', key: folderKey }),
            lore({ id: 'existing', folder: folderKey }),
            lore({ id: 'a' }),
            lore({ id: 'b' }),
        ]

        const result = moveLorebookEntries(entries, ['b', 'a'], 'folder', 'inside')

        expect(result.map((entry) => entry.id)).toEqual(['folder', 'existing', 'a', 'b'])
        expect(result.slice(2).map((entry) => entry.folder)).toEqual([folderKey, folderKey])
    })

    it('moves beside a child into that child folder and keeps it adjacent', () => {
        const folderKey = '\uf000folder:target'
        const entries = [
            lore({ id: 'folder', mode: 'folder', key: folderKey }),
            lore({ id: 'first', folder: folderKey }),
            lore({ id: 'second', folder: folderKey }),
            lore({ id: 'root' }),
        ]

        const result = moveLorebookEntries(entries, ['root'], 'first', 'after')

        expect(result.map((entry) => entry.id)).toEqual(['folder', 'first', 'root', 'second'])
        expect(result.find((entry) => entry.id === 'root')?.folder).toBe(folderKey)
    })

    it('returns the original reference for invalid targets and self-only drops', () => {
        const entries = [lore({ id: 'a' }), lore({ id: 'b' })]

        expect(moveLorebookEntries(entries, ['a'], 'missing', 'after')).toBe(entries)
        expect(moveLorebookEntries(entries, ['a'], 'a', 'after')).toBe(entries)
    })

    it('preserves untouched entry identity when its order and folder do not change', () => {
        const a = lore({ id: 'a', insertorder: 10 })
        const entries = [
            a,
            lore({ id: 'b', insertorder: 20 }),
            lore({ id: 'c', insertorder: 30 }),
            lore({ id: 'target', insertorder: 40 }),
        ]

        const result = moveLorebookEntries(entries, ['b'], 'c', 'after')

        expect(result.map((entry) => entry.id)).toEqual(['a', 'c', 'b', 'target'])
        expect(result[0]).toBe(a)
    })
})
