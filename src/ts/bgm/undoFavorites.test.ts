import { describe, expect, it } from 'vitest'
import { normalizeBgmLibrary } from './library'
import { addSlot, addTracksToSlot, countNonFavorites, moveTrackToSlot, removeNonFavorites } from './libraryEdits'
import { bgmHistory, recordBgmChange, undoBgmChange } from './managerState.svelte'

function seeded() {
    const library = normalizeBgmLibrary(undefined)
    const set = library.sets[0]
    const day = set.slots[0]
    const night = addSlot(library, set.id, 'Night')!
    addTracksToSlot(library, day, [
        { title: 'A', source: { kind: 'youtube', videoId: 'aaaaaaaaaaa' } },
        { title: 'B', source: { kind: 'youtube', videoId: 'bbbbbbbbbbb' } },
        { title: 'C', source: { kind: 'youtube', videoId: 'ccccccccccc' } },
    ])
    addTracksToSlot(library, night, [{ title: 'D', source: { kind: 'youtube', videoId: 'ddddddddddd' } }])
    return { library, day, night }
}

describe('favorites', () => {
    it('keeps the favorite flag through normalization', () => {
        const { library } = seeded()
        library.tracks[0].favorite = true
        const again = normalizeBgmLibrary(JSON.parse(JSON.stringify(library)))
        expect(again.tracks.map(track => !!track.favorite)).toEqual([true, false, false, false])
    })
    it('deletes only non-favorites in the given slots and prunes unused tracks', () => {
        const { library, day, night } = seeded()
        library.tracks.find(track => track.title === 'B')!.favorite = true
        expect(countNonFavorites(library, [day])).toBe(2)
        expect(countNonFavorites(library, [day, night])).toBe(3)
        expect(removeNonFavorites(library, [day])).toBe(2)
        expect(day.trackIds.map(id => library.tracks.find(track => track.id === id)?.title)).toEqual(['B'])
        expect(library.tracks.map(track => track.title).sort()).toEqual(['B', 'D'])
    })
})

describe('moveTrackToSlot', () => {
    it('moves a track and does not duplicate it in the target', () => {
        const { library, day, night } = seeded()
        const a = day.trackIds[0]
        expect(moveTrackToSlot(library, day, night, a)).toBe(true)
        expect(day.trackIds).not.toContain(a)
        expect(night.trackIds.at(-1)).toBe(a)
        night.trackIds.push(day.trackIds[0])
        const b = day.trackIds[0]
        moveTrackToSlot(library, day, night, b)
        expect(night.trackIds.filter(id => id === b)).toHaveLength(1)
        expect(moveTrackToSlot(library, day, day, day.trackIds[0])).toBe(false)
    })
})

describe('undo', () => {
    it('restores the library before the last recorded edit, newest first', () => {
        const { library, day } = seeded()
        recordBgmChange(library, 'first')
        removeNonFavorites(library, [day])
        recordBgmChange(library, 'second')
        library.sets[0].name = 'Renamed'
        expect(bgmHistory.lastLabel).toBe('second')
        expect(undoBgmChange(library)).toBe('second')
        expect(library.sets[0].name).not.toBe('Renamed')
        expect(day.trackIds).toHaveLength(0)
        expect(undoBgmChange(library)).toBe('first')
        expect(library.sets[0].slots[0].trackIds).toHaveLength(3)
        expect(library.tracks).toHaveLength(4)
        while (bgmHistory.size) undoBgmChange(library)
        expect(undoBgmChange(library)).toBeNull()
    })
})
