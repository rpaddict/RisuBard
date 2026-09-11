import { describe, expect, test } from 'vitest'
import { findTextareaMatch } from './textareaSearch'

describe('textarea search', () => {
    test('finds literal variables regardless of case and trims the query', () => {
        expect(findTextareaMatch('앞 {{toggle.test[0]}} 뒤', '  {{TOGGLE.test[0]}} '))
            .toEqual({ start: 2, end: 20 })
    })

    test('continues from the selection and wraps at the end', () => {
        const text = 'one ONE one'
        expect(findTextareaMatch(text, 'one')).toEqual({ start: 0, end: 3 })
        expect(findTextareaMatch(text, 'one', 3)).toEqual({ start: 4, end: 7 })
        expect(findTextareaMatch(text, 'one', 7)).toEqual({ start: 8, end: 11 })
        expect(findTextareaMatch(text, 'one', 11)).toEqual({ start: 0, end: 3 })
    })

    test('preserves original UTF-16 selection offsets', () => {
        expect(findTextareaMatch('İ🙂 한글 TARGET', 'target')).toEqual({ start: 7, end: 13 })
    })

    test('returns no selection for empty or absent text', () => {
        expect(findTextareaMatch('body', '  ')).toBeNull()
        expect(findTextareaMatch('body', 'missing')).toBeNull()
    })
})
