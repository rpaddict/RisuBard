import { describe, expect, test } from 'vitest'
import { compileAppSkinCss, resolveSkinFontStacks, validateAppSkin, withFontRoleFallback } from './appSkin'
import { fontBytesToDataUrl, fontDataUrlToBytes, sniffFontFormat } from './appSkinFonts'

const woff2 = new Uint8Array([0x77, 0x4f, 0x46, 0x32, 1, 2, 3, 4, 5, 6])
const ttf = new Uint8Array([0, 1, 0, 0, 9, 9, 9])
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0])
const base = { skinApi: 1, id: 'font-skin', name: '글꼴 스킨' }

describe('skin font files', () => {
    test('sniffs font signatures and rejects other files', () => {
        expect(sniffFontFormat(woff2)).toBe('woff2')
        expect(sniffFontFormat(ttf)).toBe('ttf')
        expect(sniffFontFormat(new Uint8Array([0x4f, 0x54, 0x54, 0x4f]))).toBe('otf')
        expect(sniffFontFormat(png)).toBeNull()
    })

    test('round-trips bytes through a data URL', () => {
        const url = fontBytesToDataUrl(woff2, 'woff2')
        expect(url.startsWith('data:font/woff2;base64,')).toBe(true)
        expect([...fontDataUrlToBytes(url)]).toEqual([...woff2])
    })
})

describe('skin font declarations', () => {
    test('accepts declared and embedded fonts', () => {
        const result = validateAppSkin({
            ...base,
            fonts: [
                { family: 'Black Han Sans', role: 'display', url: 'https://fonts.google.com/specimen/Black+Han+Sans', note: '제목용' },
                { family: '나눔고딕', role: 'ui', data: fontBytesToDataUrl(woff2, 'woff2'), weight: '400' },
            ],
        })
        expect(result.errors).toEqual([])
        expect(result.skin?.fonts?.length).toBe(2)
    })

    test.each([
        ['bad family', { family: 'Evil"; } body {', role: 'ui' }],
        ['bad role', { family: 'X', role: 'title' }],
        ['http url', { family: 'X', url: 'http://example.com' }],
        ['javascript url', { family: 'X', url: 'javascript:alert(1)' }],
        ['non-font data', { family: 'X', data: 'data:image/png;base64,iVBORw0KGgo=' }],
        ['asset in a file', { family: 'X', asset: 'assets/abc.woff2' }],
    ])('rejects %s', (_label, font) => {
        expect(validateAppSkin({ ...base, fonts: [font] }).ok).toBe(false)
    })

    test('stored skins may reference installed font assets', () => {
        expect(validateAppSkin({ ...base, fonts: [{ family: 'X', asset: 'assets/abc.woff2' }] }, { stored: true }).ok).toBe(true)
        expect(validateAppSkin({ ...base, fonts: [{ family: 'X', asset: '../etc/passwd' }] }, { stored: true }).ok).toBe(false)
    })

    test('rejects font tokens that reference themselves', () => {
        expect(validateAppSkin({ ...base, tokens: { 'font-ui': '"X", var(--risu-font-ui)' } }).ok).toBe(false)
    })
})

describe('font role fallback', () => {
    test('each role ends in its own default', () => {
        expect(withFontRoleFallback('"Black Han Sans"', 'display')).toBe('"Black Han Sans", var(--risu-font-ui)')
        expect(withFontRoleFallback('"Pretendard"', 'ui')).toBe('"Pretendard", var(--risu-font-family)')
        expect(withFontRoleFallback('"X", sans-serif', 'prose')).toBe('"X", sans-serif')
    })

    test('declared fonts fill their roles; explicit tokens win', () => {
        const skin = validateAppSkin({
            ...base,
            fonts: [
                { family: 'Black Han Sans', role: 'display' },
                { family: 'Impact', role: 'display' },
                { family: 'Pretendard', role: 'ui' },
                { family: 'Nanum Myeongjo', role: 'prose' },
            ],
            tokens: { 'font-prose': '"Noto Serif KR"' },
        }).skin!
        expect(resolveSkinFontStacks(skin)).toEqual({
            ui: '"Pretendard", var(--risu-font-family)',
            prose: '"Noto Serif KR", var(--risu-font-family)',
            display: '"Black Han Sans", "Impact", var(--risu-font-ui)',
        })
        const css = compileAppSkinCss(skin)
        expect(css).toContain('--risu-font-display: "Black Han Sans", "Impact", var(--risu-font-ui) !important;')
        expect(css).not.toContain('data:')
    })
})
