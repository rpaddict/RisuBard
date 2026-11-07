import { readdirSync, readFileSync } from 'node:fs'
import { extname, join, relative } from 'node:path'
import { describe, expect, test } from 'vitest'

// Corners and depth shadows must follow skin tokens. A fixed length here would
// keep its shape under every skin. Pills, circles and zero are intentional.
const sourceRoot = join(process.cwd(), 'src')

function styleSources(directory: string): string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const path = join(directory, entry.name)
        if (entry.isDirectory()) return entry.name === '백업' ? [] : styleSources(path)
        if (!['.svelte', '.css'].includes(extname(entry.name)) || entry.name.includes('.test.')) return []
        return [path]
    })
}

const sources = styleSources(sourceRoot).map((path) => ({
    path: relative(process.cwd(), path).replaceAll('\\', '/'),
    text: readFileSync(path, 'utf8'),
}))

function topLevelLayers(value: string) {
    const layers: string[] = []
    let depth = 0
    let start = 0
    for (let i = 0; i < value.length; i++) {
        if (value[i] === '(') depth++
        else if (value[i] === ')') depth--
        else if (value[i] === ',' && depth === 0) {
            layers.push(value.slice(start, i))
            start = i + 1
        }
    }
    return [...layers, value.slice(start)].map((layer) => layer.trim())
}

const allowedRadiusPart = /^(?:0|0px|0rem|999px|9999px|99rem|\d+%|inherit|initial|unset|[\d.]+em)$/

describe('skin shape contract', () => {
    test('border radii use skin radius tokens unless they are pills, circles or zero', () => {
        const violations = sources.flatMap(({ path, text }) =>
            [...text.matchAll(/border(?:-(?:top|bottom|start|end)-(?:left|right|start|end))?-radius\s*:\s*([^;}"\n{]+)/g)]
                .map((match) => match[1].replace(/!important/, '').trim())
                .filter((value) => !/var\(--(?:risu-radius|settings-radius|studio-radius)/.test(value) && !value.includes('{') && !value.includes('$'))
                .filter((value) => !value.split(/\s+/).every((part) => allowedRadiusPart.test(part)))
                .map((value) => `${path}: border-radius: ${value}`))
        expect(violations, 'Write calc(var(--risu-radius-<size>) * <ratio>) so skins can reshape it').toEqual([])
    })

    test('settings radius falls back to a skin token outside the settings workspace', () => {
        const violations = sources.flatMap(({ path, text }) =>
            [...text.matchAll(/var\(--settings-radius,\s*([^)]+)\)/g)]
                .filter((match) => !/^(?:var|calc)\(\s*(?:var\()?--risu-radius/.test(match[1].trim()))
                .map((match) => `${path}: ${match[0]}`))
        expect(violations).toEqual([])
    })

    test('depth shadows go through a skin shadow role', () => {
        const violations = sources.flatMap(({ path, text }) =>
            [...text.matchAll(/box-shadow\s*:\s*([^;}]+)/g)]
                .map((match) => match[1].replace(/\s+/g, ' ').trim())
                .filter((value) => !/^(?:none|inherit)$/.test(value) && !/var\(--(?:risu-shadow|tw)/.test(value))
                .filter((value) => !/inset|primary|\$\{|\{/.test(value))
                .filter((value) => {
                    // Rings and glows (no offset) are not depth.
                    const offsets = topLevelLayers(value).map((layer) => layer.split(/\s+/).slice(0, 2))
                    return offsets.some(([x, y]) => !/^-?0(?:px|rem)?$/.test(x ?? '0') || !/^-?0(?:px|rem)?$/.test(y ?? '0'))
                })
                .map((value) => `${path}: box-shadow: ${value.slice(0, 90)}`))
        expect(violations, 'Wrap depth shadows as var(--risu-shadow-raised|floating|overlay, <shadow>)').toEqual([])
    })
})
