import { describe, expect, test } from 'vitest'
import { compileAppSkinCss, validateAppSkin, validateSkinCss } from './appSkin'

const baseSkin = {
    skinApi: 1,
    id: 'steel-tactical',
    name: '강철 전술',
    source: 'girls-und-panzer',
    base: 'dark',
    colors: { bgcolor: '#141a1c', darkbg: '#1c2427', primary: '#e0782a', textcolor: '#f1efe2' },
    chatText: { standard: '#f1efe2' },
    tokens: { 'radius-md': '3px', 'shadow-lg': '0 30px 80px rgb(0 0 0 / .6)', 'font-ui': '"Noto Sans KR", sans-serif' },
    partsCss: `
        /* active tab underline */
        [data-skin-part="tab"][data-skin-state="active"] { box-shadow: inset 0 -3px 0 var(--color-primary); }
        [data-skin-part="settings-page"] h1, [data-skin-part="modal"] h2::after { letter-spacing: .12em; }
        @media (max-width: 640px) { [data-skin-part="message"][data-skin-role="user"] { border-radius: 0; } }
        @keyframes skin-pulse { from { opacity: .4 } to { opacity: 1 } }
        [data-skin-part="button"][data-skin-variant="primary"]:hover:not(:disabled) { animation: skin-pulse 1s; }
    `,
}

describe('app skin validation', () => {
    test('accepts a complete skin', () => {
        const result = validateAppSkin(baseSkin)
        expect(result.errors).toEqual([])
        expect(result.ok).toBe(true)
        expect(result.skin?.name).toBe('강철 전술')
    })

    test.each([
        ['class selector', '.chattext { color: red }'],
        ['id selector', '#app { color: red }'],
        ['selector without a hook', 'h1 { color: red }'],
        ['unknown part', '[data-skin-part="nope"] { color: red }'],
        ['remote url', '[data-skin-part="app-shell"] { background: url(https://example.com/a.png) }'],
        ['import', '@import url(x.css);'],
        ['font-face', '@font-face { font-family: x; src: local(x) }'],
        ['fixed position', '[data-skin-part="menu"] { position: fixed }'],
        ['hidden part', '[data-skin-part="composer"] { display: none }'],
        ['zero opacity', '[data-skin-part="composer"] { opacity: 0 }'],
        ['html', '[data-skin-part="modal"] { color: red } </style><script>'],
        ['nested rule', '[data-skin-part="modal"] { & h1 { color: red } }'],
        ['javascript url', '[data-skin-part="modal"] { background: url("javascript:alert(1)") }'],
    ])('rejects %s', (_label, css) => {
        expect(validateSkinCss(css).length).toBeGreaterThan(0)
    })

    test('allows data image textures', () => {
        expect(validateSkinCss('[data-skin-part="app-shell"] { background-image: url("data:image/svg+xml;utf8,a") }')).toEqual([])
    })

    test('rejects unknown tokens, unsafe values and bad ids', () => {
        expect(validateAppSkin({ ...baseSkin, tokens: { 'radius-huge': '1px' } }).ok).toBe(false)
        expect(validateAppSkin({ ...baseSkin, tokens: { 'radius-md': '3px; } body { display:none' } }).ok).toBe(false)
        expect(validateAppSkin({ ...baseSkin, tokens: { 'font-ui': '"Noto Sans KR' } }).ok).toBe(false)
        expect(validateAppSkin({ ...baseSkin, colors: { bgcolor: 'red;}' } }).ok).toBe(false)
        expect(validateAppSkin({ ...baseSkin, colors: { notAColor: '#fff' } }).ok).toBe(false)
        expect(validateAppSkin({ ...baseSkin, id: 'Bad Id' }).ok).toBe(false)
        expect(validateAppSkin({ ...baseSkin, skinApi: 2 }).ok).toBe(false)
        expect(validateAppSkin('not an object').ok).toBe(false)
    })

    test('warns on unknown top-level fields without failing', () => {
        const result = validateAppSkin({ ...baseSkin, extra: 1 })
        expect(result.ok).toBe(true)
        expect(result.warnings.length).toBe(1)
    })
})

describe('app skin compiler', () => {
    const css = compileAppSkinCss(validateAppSkin(baseSkin).skin!)
    const scope = ':root[data-risu-skin="steel-tactical"]'

    test('overrides tokens under the skin scope with priority over inline theme values', () => {
        expect(css).toContain(`${scope}{`)
        expect(css).toContain('--risu-theme-primary: #e0782a !important;')
        expect(css).toContain('--FontColorStandard: #f1efe2 !important;')
        expect(css).toContain('--risu-radius-md: 3px !important;')
        expect(css).toContain('color-scheme: dark !important;')
    })

    test('scopes every selector, including inside @media, and keeps keyframes intact', () => {
        expect(css).toContain(`${scope} [data-skin-part="tab"][data-skin-state="active"]{`)
        expect(css).toContain(`${scope} [data-skin-part="settings-page"] h1, ${scope} [data-skin-part="modal"] h2::after{`)
        expect(css).toMatch(/@media \(max-width: 640px\)\{\n:root\[data-risu-skin="steel-tactical"\] \[data-skin-part="message"\]/)
        expect(css).toContain('@keyframes skin-pulse{')
        expect(css).not.toContain('/*')
    })
})
