import { beforeEach, describe, expect, test, vi } from 'vitest'
import { excerptArcaLogMessage } from './arcaChatLog'
import {
    clearArcaLogRenderCache,
    createArcaImageLoader,
    getArcaLogCachedBody,
    setArcaLogCachedBody,
} from './arcaLogRenderCache'

const options = { imageWidthPercent: 60, paragraphSpacingPercent: 100, palette: 'dark' }
const body = { bodyHtml: '<p>hi</p>', plainText: 'hi' }

describe('arca log render cache', () => {
    beforeEach(() => clearArcaLogRenderCache())

    test('returns a body only for the same chat, index, source text, role, and body options', () => {
        setArcaLogCachedBody('chat', 3, 'char', 'hello', options, body)

        expect(getArcaLogCachedBody('chat', 3, 'char', 'hello', options)).toMatchObject(body)
        expect(getArcaLogCachedBody('chat', 3, 'char', 'edited', options)).toBeUndefined()
        expect(getArcaLogCachedBody('chat', 3, 'user', 'hello', options)).toBeUndefined()
        expect(getArcaLogCachedBody('other', 3, 'char', 'hello', options)).toBeUndefined()
        expect(getArcaLogCachedBody('chat', 3, 'char', 'hello', { ...options, imageWidthPercent: 80 })).toBeUndefined()
    })

    test('loads each image URL once per export and retries after a failure', async () => {
        const load = vi.fn()
            .mockRejectedValueOnce(new Error('offline'))
            .mockResolvedValue('data:image/png;base64,AA')
        const loadImage = createArcaImageLoader(load)

        await expect(loadImage('a.png')).rejects.toThrow('offline')
        await expect(loadImage('a.png')).resolves.toBe('data:image/png;base64,AA')
        await expect(loadImage('a.png')).resolves.toBe('data:image/png;base64,AA')
        expect(load).toHaveBeenCalledTimes(2)
    })
})

describe('excerptArcaLogMessage', () => {
    test('strips markup and images, collapses whitespace, and truncates by characters', () => {
        expect(excerptArcaLogMessage('<p>안녕</p>\n\n![a](b.png) <img src="c">하세요', 10)).toBe('안녕 하세요')
        expect(excerptArcaLogMessage('**강조**와 *기울임*, 2 * 3 * 4', 40)).toBe('강조와 기울임, 2 * 3 * 4')
        expect(excerptArcaLogMessage('가나다라마', 3)).toBe('가나다…')
        expect(excerptArcaLogMessage(undefined, 3)).toBe('')
    })
})
