import { describe, expect, test } from 'vitest'
import { readConfirmMultiOutcome } from './alertOutcome'

describe('readConfirmMultiOutcome', () => {
    test('reads the chosen action', () => {
        expect(readConfirmMultiOutcome('0')).toBe(0)
        expect(readConfirmMultiOutcome('2')).toBe(2)
    })

    test('tells a closed prompt apart from one another alert replaced', () => {
        // The prompt's own close (Escape, outside click, X) leaves 'cancel'.
        expect(readConfirmMultiOutcome('cancel')).toBe('cancel')
        // Closing an error or notice that replaced it leaves that alert's message.
        expect(readConfirmMultiOutcome('yes')).toBe('replaced')
        expect(readConfirmMultiOutcome('')).toBe('replaced')
        expect(readConfirmMultiOutcome(undefined)).toBe('replaced')
    })
})
