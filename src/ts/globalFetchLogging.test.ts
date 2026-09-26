import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { describe, expect, it, vi } from 'vitest'

// Exercise the real logger without initializing globalApi's storage/UI graph.
const source = readFileSync('src/ts/globalApi.svelte.ts', 'utf8')
const start = source.indexOf('function addFetchLogInGlobalFetch(')
const end = source.indexOf('async function fetchWithPlainFetch(', start)
const code = ts.transpile(source.slice(start, end), { target: ts.ScriptTarget.ES2022 })

function logger() {
    const record = vi.fn()
    const log = new Function('recordRequestLog', 'defaultRequestPurpose', `${code}; return addFetchLogInGlobalFetch`)(record, () => 'image-generation')
    return {
        record,
        log: (response: unknown, success = true) => log(response, success, 'https://image.example.test', {
            logCategory: 'image', logSource: 'image', body: { prompt: 'scene' }, headers: { 'Content-Type': 'application/json' },
        }, success ? 200 : 400, Date.now()),
    }
}

describe('global fetch response logging', () => {
    it.each([
        ['Uint8Array', new Uint8Array(1024 * 1024)],
        ['ArrayBuffer', new ArrayBuffer(1024 * 1024)],
        ['DataView', new DataView(new ArrayBuffer(1024 * 1024 + 8), 8)],
    ] as const)('summarizes %s without serializing binary bytes', (type, response) => {
        const toJSON = vi.fn(() => 'binary bytes must not be serialized')
        Object.defineProperty(response, 'toJSON', { value: toJSON })
        const { log, record } = logger()
        log(response)
        expect(record.mock.calls[0][0].responseBody).toBe(`[${type}: 1048576 bytes]`)
        expect(toJSON).not.toHaveBeenCalled()
        expect(record.mock.calls[0][0]).toMatchObject({ success: true, status: 200, category: 'image' })
    })

    it('preserves textual errors and normal JSON request and response bodies', () => {
        const { log, record } = logger()
        log('NovelAI returned an error', false)
        expect(record.mock.calls[0][0]).toMatchObject({ responseBody: 'NovelAI returned an error', success: false, status: 400 })
        log({ output: 'image ready' })
        expect(record.mock.calls[1][0]).toMatchObject({
            responseBody: JSON.stringify({ output: 'image ready' }, null, 2),
            requestBody: JSON.stringify({ prompt: 'scene' }, null, 2),
            requestHeaders: JSON.stringify({ 'Content-Type': 'application/json' }, null, 2),
        })
    })
})
