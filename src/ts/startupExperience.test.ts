import { describe, expect, test } from 'vitest'
import { readFileSync } from 'node:fs'

describe('startup logo handoff', () => {
    test('keeps the preloaded logo visible until the Svelte logo is decoded', () => {
        const html = readFileSync('index.html', 'utf8')
        const main = readFileSync('src/main.ts', 'utf8')
        const app = readFileSync('src/App.svelte', 'utf8')

        expect(html.indexOf('rel="preload" as="image"'))
            .toBeLessThan(html.indexOf('rel="stylesheet"'))
        expect(html).toContain('data-startup-logo="preloader"')
        expect(html).toContain('decoding="sync"')
        expect(app).toContain('data-startup-logo="app"')
        expect(main).toContain('handoffStartupLogo')
        expect(main).not.toContain("document.getElementById('preloading').remove()")
    })
})
