import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'

const legacyTokens = [
    {
        value: ['jel', 'ly'].join(''),
        contentExceptions: new Set([
            'src/ts/plugins/providerRequestStatus.test.ts',
            'src/ts/plugins/providerRequestStatus.ts',
        ]),
    },
    {
        value: ['pocket', 'risu'].join(''),
        contentExceptions: new Set([
            'README.en.md',
            'README.md',
            'patchnote/0.8.14-arca.txt',
            'patchnote/0.9.3-arca.txt',
            'patchnote/0.9.31.md',
            'src/lang/en.ts',
            'src/lang/ko.ts',
            'src/lang/zh-Hant.ts',
        ]),
    },
]
const excludedPrefixes = ['public/token/']

function ownedFiles(): string[] {
    return execFileSync('git', [
        'ls-files',
        '--cached',
        '--others',
        '--exclude-standard',
        '-z',
    ], { encoding: 'utf8' })
        .split('\0')
        .filter(Boolean)
        .filter((path) => !excludedPrefixes.some((prefix) => path.startsWith(prefix)))
        .filter(existsSync)
}

describe('brand boundary', () => {
    test('keeps the legacy product name in backup compatibility guidance', () => {
        const legacyProductName = ['Pocket', 'Risu'].join('')
        const compatibilityGuides = [
            'patchnote/0.9.31.md',
            'src/lang/en.ts',
            'src/lang/ko.ts',
            'src/lang/zh-Hant.ts',
        ]

        for (const path of compatibilityGuides) {
            expect(readFileSync(path, 'utf8')).toContain(legacyProductName)
        }
    })

    test('owned paths and UTF-8 text contain no legacy brand tokens', () => {
        const violations: string[] = []

        for (const path of ownedFiles()) {
            if (legacyTokens.some(({ value }) => path.toLowerCase().includes(value))) {
                violations.push(`path:${path}`)
            }

            const content = readFileSync(path)
            if (!content.includes(0) && legacyTokens.some(({ value, contentExceptions }) => (
                !contentExceptions.has(path) && content.toString('utf8').toLowerCase().includes(value)
            ))) {
                violations.push(`content:${path}`)
            }
        }

        expect(violations).toEqual([])
    })
})
