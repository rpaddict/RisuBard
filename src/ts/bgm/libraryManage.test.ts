import { describe, expect, it } from 'vitest'
import { normalizeBgmLibrary, resolveActiveSetId } from './library'
import { addSlot, addTemplateSlots, addTracksToSlot, fillStarterSet, createSet, deleteSet, duplicateSet, exportSet, importSet, moveItem } from './libraryEdits'
import { languageEnglish } from '../../lang/en'
import { languageKorean } from '../../lang/ko'

function seeded() {
    const library = normalizeBgmLibrary(undefined)
    const set = library.sets[0]
    const slot = set.slots[0]
    addTracksToSlot(library, slot, [
        { title: 'A', source: { kind: 'youtube', videoId: 'dQw4w9WgXcQ' } },
        { title: 'B', source: { kind: 'file', folderId: 'f', relPath: 'b.mp3' } },
    ])
    library.tracks[1].gain = 0.4
    return { library, set, slot }
}

describe('set management', () => {
    it('resolves a bot set and falls back to the default when it is missing', () => {
        const { library, set } = seeded()
        const other = createSet(library, 'Fantasy', 'Everyday')
        expect(resolveActiveSetId(library, other.id)).toBe(other.id)
        expect(resolveActiveSetId(library, 'deleted')).toBe(set.id)
        expect(resolveActiveSetId(library, undefined)).toBe(set.id)
    })

    it('duplicates slots with new ids that share tracks, and keeps the last set', () => {
        const { library, set, slot } = seeded()
        const copy = duplicateSet(library, set.id, 'Copy')!
        expect(library.sets.map(item => item.name)).toEqual([set.name, 'Copy'])
        expect(copy.slots[0].id).not.toBe(slot.id)
        expect(copy.slots[0].trackIds).toEqual(slot.trackIds)
        expect(library.tracks).toHaveLength(2)
        library.defaultSetId = copy.id
        expect(deleteSet(library, copy.id)).toBe(true)
        expect(library.defaultSetId).toBe(set.id)
        expect(library.tracks).toHaveLength(2)
        expect(deleteSet(library, set.id)).toBe(false)
    })

    it('moves items for drag sorting and ignores out-of-range moves', () => {
        const items = ['a', 'b', 'c']
        moveItem(items, 0, 2)
        expect(items).toEqual(['b', 'c', 'a'])
        moveItem(items, 0, 5)
        expect(items).toEqual(['b', 'c', 'a'])
    })

    it('round-trips a set through export and import without duplicating shared tracks', () => {
        const { library, set } = seeded()
        addSlot(library, set.id, 'Battle', 'mood', 'fights')
        const data = JSON.parse(JSON.stringify(exportSet(library, set.id)))
        expect(data.tracks).toHaveLength(2)
        const imported = importSet(library, data)!
        expect(imported.id).not.toBe(set.id)
        expect(imported.slots.map(slot => [slot.name, slot.description])).toEqual([[set.slots[0].name, ''], ['Battle', 'fights']])
        expect(library.tracks).toHaveLength(2)
        expect(library.tracks[1].gain).toBe(0.4)

        const fresh = normalizeBgmLibrary(undefined)
        importSet(fresh, data)
        expect(fresh.tracks.find(track => track.title === 'B')?.gain).toBe(0.4)
    })

    it('rejects files that are not BGM sets', () => {
        const { library } = seeded()
        expect(importSet(library, { format: 'other' })).toBeNull()
        expect(importSet(library, null)).toBeNull()
        expect(library.sets).toHaveLength(1)
    })
})

describe('slot templates', () => {
    it('adds missing templates once and fills the description of a same-named empty slot', () => {
        const library = normalizeBgmLibrary(undefined)
        const set = library.sets[0]
        set.slots[0].name = '일상'
        const templates = Object.values(languageKorean.bgm.templates)
        const added = addTemplateSlots(library, set.id, templates)
        expect(added).toHaveLength(templates.length - 1)
        expect(set.slots[0].description).toBe(languageKorean.bgm.templates.everyday.description)
        expect(set.slots.find(slot => slot.name === '전투')?.kind).toBe('mood')
        expect(set.slots.find(slot => slot.name === '승리')?.kind).toBe('event')
        expect(set.slots.find(slot => slot.name === '던전')?.kind).toBe('place')
        expect(addTemplateSlots(library, set.id, templates)).toHaveLength(0)
    })

    it('gives every template a distinct name and a description in both languages', () => {
        for (const language of [languageEnglish, languageKorean]) {
            const templates = Object.values(language.bgm.templates)
            expect(new Set(templates.map(template => template.name)).size).toBe(templates.length)
            for (const template of templates) {
                expect(['mood', 'place', 'event']).toContain(template.kind)
                expect(template.description.length).toBeGreaterThan(10)
            }
        }
        expect(Object.keys(languageKorean.bgm.templates)).toEqual(Object.keys(languageEnglish.bgm.templates))
    })
})

describe('starter set', () => {
    const templates = Object.values(languageKorean.bgm.templates)
    it('fills an untouched first library with every mood and event once', () => {
        const library = normalizeBgmLibrary(undefined)
        expect(fillStarterSet(library, templates, '일상')).toBe(true)
        const slots = library.sets[0].slots
        expect(slots).toHaveLength(templates.filter(template => template.kind !== 'place').length)
        expect(slots[0]).toMatchObject({ name: '일상', description: languageKorean.bgm.templates.everyday.description })
        expect(slots.some(slot => slot.kind === 'place')).toBe(false)
        expect(normalizeBgmLibrary(JSON.parse(JSON.stringify(library))).starterFilled).toBe(true)
        library.sets[0].slots = [slots[0]]
        slots[0].description = ''
        expect(fillStarterSet(library, templates, '일상')).toBe(false)
        expect(library.sets[0].slots).toHaveLength(1)
    })
    it('leaves a library that is already in use alone', () => {
        const library = normalizeBgmLibrary(undefined)
        addTracksToSlot(library, library.sets[0].slots[0], [{ title: 'A', source: { kind: 'youtube', videoId: 'dQw4w9WgXcQ' } }])
        expect(fillStarterSet(library, templates, '일상')).toBe(false)
        expect(library.sets[0].slots).toHaveLength(1)
        expect(library.starterFilled).toBe(true)
    })
})
