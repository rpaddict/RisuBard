import { readdirSync, readFileSync } from 'node:fs'
import { extname, join, relative } from 'node:path'
import { describe, expect, test } from 'vitest'
import { uiThemeTokens } from 'src/ts/gui/uiThemeTokens'
import { uiSkinTokenDefinitions } from 'src/ts/gui/uiSkinTokens'

const sourceRoot = join(process.cwd(), 'src')
const sourceExtensions = new Set(['.css', '.js', '.svelte', '.ts'])
const legacyThemeToken = /var\(\s*--(bgcolor|darkbg|borderc|selected|draculared|textcolor|textcolor2|darkborderc|darkbutton|success|primary)\b/g

function sourceFiles(directory: string): string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const path = join(directory, entry.name)
        if (entry.isDirectory()) return sourceFiles(path)
        if (!sourceExtensions.has(extname(entry.name))) return []
        if (/\.(?:test|spec)\.[^.]+$/.test(entry.name)) return []
        return [path]
    })
}

describe('RisuBard UI theme token contract', () => {
    test('code highlighting also follows editable colors rather than a fixed dark stylesheet', () => {
        const parser = readFileSync(join(sourceRoot, 'ts/parser/parser.svelte.ts'), 'utf8')
        const styles = readFileSync(join(sourceRoot, 'styles.css'), 'utf8')
        expect(parser.includes('highlight.js/styles/')).toBe(false)
        expect(styles.includes('.hljs { color: var(--color-textcolor); background: var(--color-surface-inset); }')).toBe(true)
        expect(styles.includes('.hljs-doctag, .hljs-formula, .hljs-keyword { color: var(--color-secondary); }')).toBe(true)
    })

    test('declares every editable role even when it is used only in component CSS', () => {
        const styles = readFileSync(join(sourceRoot, 'styles.css'), 'utf8')
        expect(styles.includes('@theme static {'), 'Raw component CSS needs unpruned theme aliases').toBe(true)
        for (const { token } of uiThemeTokens) {
            expect(styles.includes(`--color-${token}: var(--risu-theme-${token})`), token).toBe(true)
        }
        for (const { token, dark } of uiThemeTokens) {
            expect(styles.includes(`--risu-theme-${token}: ${dark};`), `${token} boot fallback`).toBe(true)
        }
    })

    test('global UI rules use tokens and legacy scales derive from editable colors', () => {
        const styles = readFileSync(join(sourceRoot, 'styles.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
        const violations = styles.split(/\r?\n/).flatMap((line, index) => {
            if (/^\s*--/.test(line)) return [] // Central bootstrap token defaults.
            return /#[\da-f]{3,8}\b|\b(?:rgb|rgba|hsl|hsla)\(\s*[\d.]|(?<![\w-])(?:white|black)(?![\w-])/i.test(line)
                ? [`${index + 1}: ${line.trim()}`] : []
        })
        expect(violations).toEqual([])
        expect(styles).not.toMatch(/--risu-theme-(?:primary|secondary|danger|success|neutral)-\d+:\s*#/)
        expect(styles).not.toMatch(/--color-(?:gray|slate|zinc|white|black)-?\d*/)
        expect(styles).not.toMatch(/@apply[^;]*(?:amber|green|blue|purple|pink|cyan)-\d+/)
        expect(styles).toContain('--tw-prose-body: var(--color-textcolor)')
        expect(styles).toContain('--tw-prose-pre-bg: var(--color-surface-inset)')
        expect(styles).toContain(':root[data-risu-base-scheme="pastel-pop"]')
    })

    test('declares every skin token with its default and routes Tailwind radius and shadow through it', () => {
        const styles = readFileSync(join(sourceRoot, 'styles.css'), 'utf8')
        for (const { token, group, defaultValue } of uiSkinTokenDefinitions) {
            if (group === 'shadow-role' || group === 'clip') {
                expect(styles.includes(`--risu-${token}:`), `${token} must stay unset so uses fall back`).toBe(false)
                continue
            }
            expect(styles.includes(`--risu-${token}: ${defaultValue};`), `${token} default`).toBe(true)
            if (group !== 'font') {
                expect(styles.includes(`--${token}: var(--risu-${token});`), `${token} Tailwind alias`).toBe(true)
            }
        }
        expect(styles).toContain('font-family: var(--risu-font-ui);')
        expect(styles).toContain(':where(.chattext, .chattext *) {\n  font-family: var(--risu-font-prose);')
    })

    test('does not color Tailwind shadows per element, which skin shadow tokens cannot honor', () => {
        const allowed = new Set(['2xs', 'xs', 'sm', 'md', 'lg', 'xl', '2xl', 'popover', 'none', 'inner'])
        const violations = sourceFiles(sourceRoot).filter((path) => path.endsWith('.svelte')).flatMap((path) => {
            const source = readFileSync(path, 'utf8')
            return [...source.matchAll(/(?<![\w-])(?:[\w-]+:)*shadow-([a-z][\w-]*(?:\/\d+)?)/g)]
                .filter((match) => !allowed.has(match[1]))
                .map((match) => `${relative(process.cwd(), path)}: ${match[0]}`)
        })
        expect(violations, 'Use a shadow size or add a named --risu-shadow-* token').toEqual([])
    })

    test('rejects undefined legacy theme variables in production UI sources', () => {
        const violations = sourceFiles(sourceRoot).flatMap((path) => {
            const source = readFileSync(path, 'utf8')
            return source.split(/\r?\n/).flatMap((line, index) => {
                legacyThemeToken.lastIndex = 0
                const matches = [...line.matchAll(legacyThemeToken)]
                return matches.map((match) =>
                    `${relative(process.cwd(), path)}:${index + 1} --${match[1]}`
                )
            })
        })

        expect(violations, [
            'Raw UI CSS must use var(--color-<token>) or an existing',
            'var(--risu-theme-<token>) bridge, never undefined bare aliases.',
        ].join(' ')).toEqual([])
    })

    test('exposes a dedicated theme-token contract check command', () => {
        const packageJson = JSON.parse(readFileSync(
            join(process.cwd(), 'package.json'), 'utf8'
        )) as { scripts?: Record<string, string> }

        expect(packageJson.scripts?.['check:theme-tokens']).toBe(
            'vitest run src/lib/UI/GUI/ThemeTokenContract.test.ts'
        )
    })
})
