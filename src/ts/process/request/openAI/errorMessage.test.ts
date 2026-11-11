import { describe, expect, test } from 'vitest'
import { formatOpenAIErrorMessage } from './errorMessage'

describe('formatOpenAIErrorMessage', () => {
    test('keeps a plain error message as is', () => {
        expect(formatOpenAIErrorMessage({ message: 'Invalid API key' })).toBe('Invalid API key')
    })

    test('appends the OpenRouter provider and raw upstream reason', () => {
        expect(formatOpenAIErrorMessage({
            message: 'Provider returned error',
            metadata: {
                provider_name: 'Google',
                raw: '{"error":{"message":"Invalid JSON schema"}}',
            },
        })).toBe('Provider returned error (Google): {"error":{"message":"Invalid JSON schema"}}')
    })

    test('serializes an object raw and truncates long reasons', () => {
        expect(formatOpenAIErrorMessage({
            message: 'Provider returned error',
            metadata: { raw: { code: 400 } },
        })).toBe('Provider returned error: {"code":400}')
        const long = formatOpenAIErrorMessage({
            message: 'Provider returned error',
            metadata: { raw: 'x'.repeat(2000) },
        })
        expect(long.endsWith('…')).toBe(true)
        expect(long.length).toBeLessThan(1100)
    })
})
