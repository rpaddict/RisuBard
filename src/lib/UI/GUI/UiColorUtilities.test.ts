import { readdirSync, readFileSync } from 'node:fs'
import { extname, join, relative } from 'node:path'
import { describe, expect, test } from 'vitest'

const projectRoot = process.cwd()
const extensions = new Set(['.css', '.js', '.svelte', '.ts'])

function sourceFiles(directory: string): string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const path = join(directory, entry.name)
        if (entry.isDirectory()) return sourceFiles(path)
        if (!extensions.has(extname(path)) || /\.(?:test|spec)\.[^.]+$/.test(path)) return []
        return [path]
    })
}

// User-selected named folder colors and seasonal wordmark artwork deliberately
// keep their palette. An exception must identify both the color and expression;
// no component is exempt from the application-theme contract as a whole.
const authoredPalettes = [
    ...['red', 'yellow', 'green', 'blue', 'indigo', 'purple', 'pink'].flatMap((color) => [
        {
            file: 'src/lib/SideBars/SideChatList.svelte',
            expression: `class:bg-${color}-900={folder.color === '${color}'}`,
            utilities: [`bg-${color}-900`],
            reason: 'The folder surface reflects its explicitly selected named color.',
        },
        {
            file: 'src/lib/SideBars/ChatManagerDialog.svelte',
            expression: `class:bg-${color}-500={color === '${color}'}`,
            utilities: [`bg-${color}-500`],
            reason: 'The folder dot in the chat manager reflects its explicitly selected named color.',
        },
        {
            file: 'src/lib/SideBars/SidebarAvatar.svelte',
            expression: `color === '${color}' ? 'bg-${color}-700/50'`,
            utilities: [`bg-${color}-700/50`],
            reason: 'The avatar tint previews the explicitly selected folder color.',
        },
        {
            file: 'src/lib/SideBars/Sidebar.svelte',
            expression: `char.color === '${color}' ? 'bg-${color}-700/20'`,
            utilities: [`bg-${color}-700/20`],
            reason: 'The character tint reflects its explicitly selected named color.',
        },
    ]),
    ...[
        ['text-amber-400', '🐉RisuBard🐉'],
        ['text-blue-500', 'P'], ['text-red-500', 'o'], ['text-yellow-500', 'c'],
        ['text-white', 'k'], ['text-black', 'e'], ['text-blue-500', 't'],
        ['text-red-500', 'R'], ['text-yellow-500', 'i'], ['text-white', 's'], ['text-black', 'u'],
    ].map(([utility, text]) => ({
        file: 'src/lib/UI/Title.svelte',
        expression: `<span class="${utility}">${text}</span>`,
        utilities: [utility],
        reason: 'The seasonal wordmark is authored brand artwork, not application chrome.',
    })),
    {
        file: 'src/lib/UI/Title.svelte',
        expression: '<span class="text-2xl font-extralight italic text-amber-400 hover:text-amber-600 transition">RisuBard {',
        utilities: ['text-amber-400', 'text-amber-600'],
        reason: 'The anniversary wordmark is authored brand artwork.',
    },
]

const fixedPaletteUtility = /\b(?:bg|text|placeholder|border(?:-[trblxyse])?|ring(?:-offset)?|outline|fill|stroke|from|via|to|shadow|divide|decoration|accent|caret)-(?:(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|primary|danger)-(?:0|50|[1-9]00|950)|white|black)\b(?:\/[\d.]+)?/g
const arbitraryPaletteUtility = /\b(?:bg|text|placeholder|border(?:-[trblxyse])?|ring(?:-offset)?|outline|fill|stroke|from|via|to|shadow|divide|decoration|accent|caret)-\[(?:#[\da-f]{3,8}|(?:rgba?|hsla?|oklch|oklab|lab|lch)\()[^\]]*\]/gi
const fixedPaletteVariable = /var\(--color-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|primary|danger)-\d+\)/g

function uncomment(source: string): string {
    return source
        .replace(/\/\*[\s\S]*?\*\/|<!--[\s\S]*?-->/g, (comment) => comment.replace(/[^\n]/g, ' '))
        .split(/\r?\n/)
        .map((line) => /^\s*\/\//.test(line) ? '' : line)
        .join('\n')
}

const uiSources = [
    ...sourceFiles(join(projectRoot, 'src/lib')),
    ...['src/App.svelte', 'src/ts/observer.svelte.ts', 'src/ts/setting/languageSettingsData.svelte.ts']
        .map((file) => join(projectRoot, file)),
]

describe('application-owned utility colors', () => {
    test('keeps the app stub and loading screen on editable colors', () => {
        const source = uncomment(readFileSync(join(projectRoot, 'src/App.svelte'), 'utf8'))
        expect(source).not.toMatch(/#[\da-f]{3,8}\b/i)
    })

    test('pairs the legacy filled danger button with its matching foreground', () => {
        const source = readFileSync(join(projectRoot, 'src/lib/UI/GUI/Button.svelte'), 'utf8')
        expect(source).toContain("styled === 'danger' ? 'text-on-danger'")
    })

    test('uses editable theme tokens instead of built-in or numbered fixed palettes', () => {
        const violations: string[] = []
        const usedExceptions = new Set<string>()
        for (const path of uiSources) {
            const file = relative(projectRoot, path).replaceAll('\\', '/')
            uncomment(readFileSync(path, 'utf8')).split('\n').forEach((line, index) => {
                for (const match of [...line.matchAll(fixedPaletteUtility), ...line.matchAll(arbitraryPaletteUtility), ...line.matchAll(fixedPaletteVariable)]) {
                    const exception = authoredPalettes.find((item) => item.file === file
                        && line.includes(item.expression) && item.utilities.includes(match[0]))
                    if (exception) {
                        usedExceptions.add(`${exception.file}:${exception.expression}:${match[0]}`)
                    } else {
                        violations.push(`${file}:${index + 1} ${match[0]}`)
                    }
                }
            })
        }
        expect(violations, 'Application UI utilities must reference editable --color-* theme roles.').toEqual([])
        for (const exception of authoredPalettes) {
            expect(exception.reason).not.toBe('')
            for (const utility of exception.utilities) {
                expect(usedExceptions.has(`${exception.file}:${exception.expression}:${utility}`),
                    `Remove stale palette exception: ${exception.file} ${exception.expression}`).toBe(true)
            }
        }
    })
})
