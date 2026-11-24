import { describe, expect, it } from 'vitest'
import { isInactive } from './inactiveMute'
import { normalizeBgmLibrary } from './library'
import { addSlot, addTracksToSlot, deleteSlot, fileTitle, parseYouTubeLines, removeTrackFromSlot } from './libraryEdits'
import { formatBgmTime, placementFromPosition, positionFromPlacement } from './placement'

describe('isInactive', () => {
    const env = (hidden: boolean, focused: boolean) => ({ isHidden: () => hidden, hasFocus: () => focused })
    it('never mutes when off', () => {
        expect(isInactive('off', env(true, false))).toBe(false)
    })
    it('mutes on another tab only, or also when the window loses focus', () => {
        expect(isInactive('hidden', env(true, true))).toBe(true)
        expect(isInactive('hidden', env(false, false))).toBe(false)
        expect(isInactive('blur', env(false, false))).toBe(true)
        // Focus inside the YouTube iframe still counts as focused.
        expect(isInactive('blur', env(false, true))).toBe(false)
    })
})

describe('library edits', () => {
    it('reuses one track across slots and prunes it only when no slot holds it', () => {
        const library = normalizeBgmLibrary(undefined)
        const set = library.sets[0]
        const day = set.slots[0]
        const night = addSlot(library, set.id, '  Night  ')!
        expect(night.name).toBe('Night')
        const source = { kind: 'youtube' as const, videoId: 'dQw4w9WgXcQ' }
        addTracksToSlot(library, day, [{ title: 'Song', source }])
        expect(addTracksToSlot(library, night, [{ title: 'Song again', source }])).toHaveLength(1)
        expect(addTracksToSlot(library, night, [{ title: 'dup', source }])).toHaveLength(0)
        expect(library.tracks).toHaveLength(1)
        removeTrackFromSlot(library, day, library.tracks[0].id)
        expect(library.tracks).toHaveLength(1)
        deleteSlot(library, set.id, night.id)
        expect(library.tracks).toHaveLength(0)
    })
    it('counts pasted lines that are not YouTube addresses', () => {
        expect(parseYouTubeLines('https://youtu.be/dQw4w9WgXcQ\n\nhello\nhttps://example.com')).toMatchObject({ skipped: 2, sources: [{ videoId: 'dQw4w9WgXcQ' }] })
        expect(fileTitle('battle/Boss Theme.mp3')).toBe('Boss Theme')
        expect(fileTitle('C:\\Music\\calm.flac')).toBe('calm')
    })
})

describe('placement', () => {
    const viewport = { width: 1000, height: 800 }
    it('round-trips and keeps the player inside the gutters', () => {
        const size = { width: 300, height: 200 }
        const placement = placementFromPosition(400, 300, viewport, size)
        expect(positionFromPlacement(placement, viewport, size)).toEqual({ left: 400, top: 300 })
        expect(positionFromPlacement({ xRatio: 1, yRatio: 1 }, viewport, size)).toEqual({ left: 688, top: 588 })
        expect(placementFromPosition(-50, 5000, viewport, size)).toEqual({ xRatio: 0, yRatio: 1 })
    })
    it('formats times', () => {
        expect(formatBgmTime(65)).toBe('1:05')
        expect(formatBgmTime(3725)).toBe('1:02:05')
        expect(formatBgmTime(Number.NaN)).toBe('0:00')
    })
})
