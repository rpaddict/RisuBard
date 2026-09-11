import { afterEach, describe, expect, it, vi } from 'vitest'
import { get } from 'svelte/store'
import { createLoadingActivity, describeNativeRead } from './loadingActivity'

afterEach(() => vi.useRealTimers())

describe('loading feedback', () => {
    it('shows foreground immediately and removes it on completion without a percentage', () => {
        const activity = createLoadingActivity()
        const load = activity.select('Alpha')
        expect(get(activity.foreground)).toMatchObject({ label: 'Alpha' })
        load.finish()
        expect(get(activity.foreground)).toBeNull()
    })

    it('cancel and late completion cannot close or publish a newer selection', () => {
        const activity = createLoadingActivity()
        const old = activity.select('Alpha')
        const next = activity.select('Beta')
        old.finish()
        expect(old.current()).toBe(false)
        expect(get(activity.foreground)?.label).toBe('Beta')
        next.cancel()
        expect(next.current()).toBe(false)
        expect(get(activity.foreground)).toBeNull()
    })

    it('tracks parallel work independently and cleans up rejected reads', async () => {
        const activity = createLoadingActivity()
        const a = activity.begin('a.webp')
        const b = activity.begin('b.webp')
        a()
        expect(get(activity.background).map(entry => entry.label)).toEqual(['b.webp'])
        await expect(activity.read('persona', async () => { throw new Error('offline') })).rejects.toThrow('offline')
        expect(get(activity.background).map(entry => entry.label)).toEqual(['b.webp'])
        expect(get(activity.failure)?.label).toBe('persona')
        b(); b()
        expect(get(activity.background)).toEqual([])
    })

    it('observes image completion once, bounds remembered images, and clears stalled work', () => {
        vi.useFakeTimers()
        const images: any[] = []
        const activity = createLoadingActivity(() => { const image = { onload: null, onerror: null, src: '' }; images.push(image); return image as any })
        activity.image('/api/asset/one', 'one.webp')
        activity.image('/api/asset/one', 'one.webp')
        expect(images).toHaveLength(1)
        images[0].onload()
        expect(get(activity.background)).toEqual([])
        activity.image('/api/asset/two', 'two.webp')
        images[1].onerror()
        expect(get(activity.failure)?.label).toBe('two.webp')
        activity.image('/api/asset/three', 'three.webp')
        vi.advanceTimersByTime(60000)
        expect(get(activity.background)).toEqual([])
        expect(get(activity.failure)?.label).toBe('three.webp')
        for (let i = 0; i < 140; i++) { activity.image(`/api/asset/${i}`, `${i}.webp`); images.at(-1).onload() }
        activity.image('/api/asset/one', 'one.webp')
        expect(get(activity.background)).toHaveLength(1)
        images.at(-1).onload()
    })

    it('labels native reads without exposing settings contents or tracking writes', () => {
        expect(describeNativeRead('/api/native/document?kind=persona&id=one')).toBe('persona / one')
        expect(describeNativeRead('/api/native/documents', { targets: [{ kind: 'persona', id: 'one' }, { kind: 'persona', id: 'two' }] })).toBe('persona / one (+1)')
        expect(describeNativeRead('/api/native/commit', { writes: [{ value: { password: 'secret' } }] })).toBeNull()
    })
})
