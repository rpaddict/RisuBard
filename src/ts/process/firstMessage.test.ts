import { describe, expect, it } from 'vitest'
import { selectFirstMessageSource } from './firstMessage'

const character = { firstMessage: 'main', alternateGreetings: ['alt0', 'alt1'] }

describe('selectFirstMessageSource', () => {
    it('uses the main first message for fmIndex -1', () => {
        expect(selectFirstMessageSource(character, { fmIndex: -1 })).toBe('main')
    })

    it('uses the selected alternate greeting', () => {
        expect(selectFirstMessageSource(character, { fmIndex: 1 })).toBe('alt1')
    })

    it('falls back to the main first message when fmIndex is missing', () => {
        expect(selectFirstMessageSource(character, {})).toBe('main')
        expect(selectFirstMessageSource(character, { fmIndex: undefined })).toBe('main')
        expect(selectFirstMessageSource(character, { fmIndex: null })).toBe('main')
    })

    it('falls back to the main first message when fmIndex is out of range or invalid', () => {
        expect(selectFirstMessageSource(character, { fmIndex: 5 })).toBe('main')
        expect(selectFirstMessageSource(character, { fmIndex: -3 })).toBe('main')
        expect(selectFirstMessageSource(character, { fmIndex: 0.5 })).toBe('main')
        expect(selectFirstMessageSource(character, { fmIndex: '1' })).toBe('main')
    })

    it('tolerates alternateGreetings saved as an object or missing', () => {
        expect(selectFirstMessageSource({ firstMessage: 'main', alternateGreetings: {} }, { fmIndex: 0 })).toBe('main')
        expect(selectFirstMessageSource({ firstMessage: 'main' }, { fmIndex: 0 })).toBe('main')
    })

    it('returns undefined when disabled or when no text exists', () => {
        expect(selectFirstMessageSource(character, { fmIndex: 0, firstMessageDisabled: true })).toBeUndefined()
        expect(selectFirstMessageSource({ alternateGreetings: {} }, {})).toBeUndefined()
    })
})
