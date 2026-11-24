import { describe, expect, it } from 'vitest'
import { bgmFileUrl, normalizeBgmLibrary, normalizeBgmPlayerSettings, parseYouTubeAddress, pickNextTrack } from './library'

describe('parseYouTubeAddress', () => {
    it('reads common address forms and timestamps', () => {
        expect(parseYouTubeAddress('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1m30s')).toEqual({ kind: 'youtube', videoId: 'dQw4w9WgXcQ', start: 90 })
        expect(parseYouTubeAddress('youtu.be/dQw4w9WgXcQ?t=42')).toEqual({ kind: 'youtube', videoId: 'dQw4w9WgXcQ', start: 42 })
        expect(parseYouTubeAddress('https://music.youtube.com/watch?v=dQw4w9WgXcQ')?.videoId).toBe('dQw4w9WgXcQ')
        expect(parseYouTubeAddress('https://www.youtube.com/shorts/dQw4w9WgXcQ')?.videoId).toBe('dQw4w9WgXcQ')
        expect(parseYouTubeAddress('https://www.youtube.com/embed/dQw4w9WgXcQ?start=10&end=70')).toEqual({ kind: 'youtube', videoId: 'dQw4w9WgXcQ', start: 10, end: 70 })
        expect(parseYouTubeAddress('dQw4w9WgXcQ')?.videoId).toBe('dQw4w9WgXcQ')
    })
    it('rejects other sites and malformed ids', () => {
        expect(parseYouTubeAddress('https://example.com/watch?v=dQw4w9WgXcQ')).toBeNull()
        expect(parseYouTubeAddress('https://www.youtube.com/watch?v=short')).toBeNull()
        expect(parseYouTubeAddress('C:\\music\\a.mp3')).toBeNull()
    })
})

describe('normalizeBgmLibrary', () => {
    it('creates a default set and drops broken tracks and dangling slot references', () => {
        expect(normalizeBgmLibrary(undefined).sets).toHaveLength(1)
        const library = normalizeBgmLibrary({
            tracks: [
                { id: 't1', title: 'Calm', source: { kind: 'youtube', videoId: 'dQw4w9WgXcQ' } },
                { id: 't2', source: { kind: 'file', folderId: 'f' } },
                { id: 't1', source: { kind: 'asset', key: 'dup' } },
            ],
            sets: [{ id: 's', name: 'Set', slots: [{ id: 'a', name: 'Day', trackIds: ['t1', 't2', 't1'], playMode: 'loud' }] }],
            defaultSetId: 'missing',
        })
        expect(library.tracks.map(track => track.id)).toEqual(['t1'])
        expect(library.tracks[0].gain).toBe(1)
        expect(library.sets[0].slots[0]).toMatchObject({ trackIds: ['t1'], playMode: 'shuffle', kind: 'mood' })
        expect(library.defaultSetId).toBe('s')
    })
})

describe('normalizeBgmPlayerSettings', () => {
    it('defaults to disabled, collapsed and no inactive mute', () => {
        expect(normalizeBgmPlayerSettings({ muteWhenInactive: 'sometimes', crossfadeMs: 99999, volume: 4 })).toEqual({
            enabled: false, volume: 1, collapsed: true, maximized: false, videoSize: 'large', muteWhenInactive: 'off', crossfadeMs: 10000, lastSlotBySet: {},
            dj: expect.objectContaining({ enabled: false, model: 'otherAx' }),
        })
        expect(normalizeBgmPlayerSettings({ lastSlotBySet: { a: 'slot', b: 3 } }).lastSlotBySet).toEqual({ a: 'slot' })
        expect(normalizeBgmPlayerSettings({ muteWhenInactive: 'blur' }).muteWhenInactive).toBe('blur')
    })
})

describe('pickNextTrack', () => {
    const order = (values: number[]) => { let i = 0; return () => values[i++ % values.length] }

    it('plays every shuffled track once before repeating and never repeats across a refill', () => {
        const slot = { trackIds: ['a', 'b', 'c'], playMode: 'shuffle' as const }
        let bag: string[] = []
        let current: string | null = null
        const played: string[] = []
        for (let i = 0; i < 6; i++) {
            const next = pickNextTrack(slot, current, bag, new Set(), order([0.1, 0.9, 0.5]))
            played.push(next.trackId!)
            bag = next.bag
            if (i > 0) expect(next.trackId).not.toBe(current)
            current = next.trackId
        }
        expect(new Set(played.slice(0, 3)).size).toBe(3)
        expect(new Set(played.slice(3)).size).toBe(3)
    })
    it('follows order, repeat-one and skips failed tracks', () => {
        expect(pickNextTrack({ trackIds: ['a', 'b', 'c'], playMode: 'sequential' }, 'c', []).trackId).toBe('a')
        expect(pickNextTrack({ trackIds: ['a', 'b', 'c'], playMode: 'sequential' }, 'a', [], new Set(['b'])).trackId).toBe('c')
        expect(pickNextTrack({ trackIds: ['a', 'b'], playMode: 'repeat-one' }, 'b', []).trackId).toBe('b')
        expect(pickNextTrack({ trackIds: ['a'], playMode: 'shuffle' }, null, [], new Set(['a'])).trackId).toBeNull()
    })
})

it('encodes file paths so the server never sees raw separators', () => {
    expect(bgmFileUrl('f1', '전투/boss.ogg')).toMatch(/^\/api\/bgm\/file\/f1\/[0-9a-f]+$/)
})
