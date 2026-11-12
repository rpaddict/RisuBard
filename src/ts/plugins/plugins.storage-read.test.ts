import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

describe('plugin storage read cost contract', () => {
    it('reads one pluginStorage value without snapshotting the whole database', () => {
        const source = readFileSync('src/ts/plugins/plugins.svelte.ts', 'utf8')
        const start = source.indexOf('pluginStorage: {')
        const end = source.indexOf('setItem:', start)
        const getItem = source.slice(start, end)

        expect(start).toBeGreaterThan(-1)
        expect(end).toBeGreaterThan(start)
        expect(getItem).not.toContain('snapshot: true')
        expect(getItem).toContain('$state.snapshot(value)')
    })
})
