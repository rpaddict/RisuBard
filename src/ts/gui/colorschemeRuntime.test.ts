import { beforeEach, describe, expect, test, vi } from 'vitest'
import { get } from 'svelte/store'
import type { Database } from '../storage/database.svelte'
import { CustomCSSStore, SafeModeStore } from '../stores.svelte'
import { isLite } from '../lite'
import {
    changeColorScheme,
    changeColorSchemeType,
    ColorSchemeTypeStore,
    updateColorScheme,
    updateTextThemeAndCSS,
    exportColorScheme,
    importColorScheme,
} from './colorscheme'
import { darkColorScheme, lightColorScheme } from './colorschemePalettes'
import { downloadFile } from '../globalApi.svelte'
import { BufferToText, selectSingleFile } from '../util'
import { notifyError } from '../alert'

type ThemeSettings = Pick<Database,
    'colorScheme' | 'colorSchemeName' | 'textTheme' | 'textThemeAutoContrast' | 'customTextTheme' | 'font' | 'customCSS' | 'textScreenColor' | 'theme' | 'customBackground'
>

const state = vi.hoisted(() => ({ db: {} as ThemeSettings }))

// Isolate the theme runtime from database bootstrap and file/UI side effects.
vi.mock('../storage/database.svelte', () => ({ getDatabase: () => state.db }))
vi.mock('../globalApi.svelte', () => ({ downloadFile: vi.fn() }))
vi.mock('../util', () => ({ BufferToText: vi.fn(), selectSingleFile: vi.fn() }))
vi.mock('../alert', () => ({ notifyError: vi.fn() }))
vi.mock('../stores.svelte', async () => {
    const { writable } = await import('svelte/store')
    return { CustomCSSStore: writable(''), SafeModeStore: writable(false), selectedCharID: writable(-1) }
})
vi.mock('../lite', async () => {
    const { writable } = await import('svelte/store')
    return { isLite: writable(false) }
})

const fontTokens = [
    'FontColorStandard', 'FontColorItalic', 'FontColorBold',
    'FontColorItalicBold', 'FontColorQuote1', 'FontColorQuote2',
] as const

function fontColors() {
    return Object.fromEntries(fontTokens.map((token) => [
        token, document.documentElement.style.getPropertyValue(`--${token}`),
    ]))
}

function rgb(hex: string): number[] {
    return hex.slice(1).match(/.{2}/g)!.map((channel) => parseInt(channel, 16))
}

function contrastRatio(foreground: number[], background: number[]): number {
    const luminance = (channels: number[]) => channels.reduce((sum, channel, index) => {
        const value = channel / 255
        const linear = value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
        return sum + linear * [0.2126, 0.7152, 0.0722][index]
    }, 0)
    const first = luminance(foreground)
    const second = luminance(background)
    return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05)
}

beforeEach(() => {
    vi.clearAllMocks()
    document.documentElement.removeAttribute('style')
    delete document.documentElement.dataset.risuColorScheme
    isLite.set(false)
    SafeModeStore.set(false)
    CustomCSSStore.set('')
    state.db = {
        colorScheme: { ...darkColorScheme },
        colorSchemeName: 'dark',
        textTheme: 'standard',
        customTextTheme: {
            FontColorStandard: '#123456',
            FontColorItalic: '#234567',
            FontColorBold: '#345678',
            FontColorItalicBold: '#456789',
            FontColorQuote1: '#56789a',
            FontColorQuote2: '#6789ab',
        },
        font: 'default',
        customCSS: '',
        textScreenColor: null,
        theme: '',
        customBackground: '',
    }
})

describe('color scheme and chat text synchronization', () => {
    test.each(['standard', 'highcontrast'])('%s text updates immediately when switching dark to light and back', (textTheme) => {
        state.db.textTheme = textTheme
        updateColorScheme()
        updateTextThemeAndCSS()
        const darkText = fontColors()

        changeColorScheme('light')

        expect(document.documentElement.style.getPropertyValue('--risu-theme-bgcolor')).toBe(lightColorScheme.bgcolor)
        expect(get(ColorSchemeTypeStore)).toBe('light')
        expect(document.documentElement.style.colorScheme).toBe('light')
        expect(fontColors().FontColorStandard).toBe('#0f172a')

        changeColorScheme('dark')

        expect(get(ColorSchemeTypeStore)).toBe('dark')
        expect(document.documentElement.style.colorScheme).toBe('dark')
        expect(fontColors()).toEqual(darkText)
    })

    test('direct palette updates also refresh text when applying a stored light skin', () => {
        updateTextThemeAndCSS()
        state.db.colorSchemeName = 'light'

        updateColorScheme()

        expect(state.db.colorScheme).toEqual(lightColorScheme)
        expect(fontColors().FontColorStandard).toBe('#0f172a')
    })

    test('custom skin type changes refresh text while respecting its actual stored background', () => {
        changeColorScheme('custom')

        changeColorSchemeType('light')

        expect(contrastRatio(rgb(fontColors().FontColorStandard), rgb(state.db.colorScheme.bgcolor))).toBeGreaterThanOrEqual(4.5)
        expect(get(ColorSchemeTypeStore)).toBe('light')
    })

    test('preserves explicit custom text colors and CSS while switching skins', () => {
        state.db.textTheme = 'custom'
        state.db.textThemeAutoContrast = false
        state.db.customCSS = '.custom-chat { line-height: 2; }'
        updateTextThemeAndCSS()

        changeColorScheme('light')

        expect(state.db.textTheme).toBe('custom')
        expect(fontColors()).toEqual(state.db.customTextTheme)
        expect(get(CustomCSSStore)).toBe(state.db.customCSS)
    })

    test('keeps Lite mode text synchronized with its forced dark palette', () => {
        changeColorScheme('light')
        updateTextThemeAndCSS()
        isLite.set(true)

        updateColorScheme()

        expect(document.documentElement.dataset.risuColorScheme).toBe('dark')
        expect(get(ColorSchemeTypeStore)).toBe('dark')
        expect(fontColors().FontColorStandard).toBe('#fafafa')
    })
})

describe('built-in light text contrast', () => {
    test.each(['standard', 'highcontrast'])('%s keeps all text legible on light surfaces', (textTheme) => {
        state.db.colorScheme = { ...lightColorScheme }
        state.db.textTheme = textTheme

        updateTextThemeAndCSS()

        for (const [token, color] of Object.entries(fontColors())) {
            expect(color, token).toMatch(/^#[0-9a-f]{6}$/i)
            for (const surface of [lightColorScheme.bgcolor, lightColorScheme.darkbg, lightColorScheme.selected]) {
                const foreground = rgb(color)
                const background = rgb(surface)
                expect(contrastRatio(foreground, background), `${token} on ${surface}`).toBeGreaterThanOrEqual(4.5)
                if (token.startsWith('FontColorQuote')) {
                    // Chat blockquotes tint the surface with 10% of their text color.
                    const tinted = background.map((channel, index) => channel * 0.9 + foreground[index] * 0.1)
                    expect(contrastRatio(foreground, tinted), `${token} on its blockquote tint`).toBeGreaterThanOrEqual(4.5)
                }
            }
        }
    })
})

describe('editable semantic UI colors', () => {
    const tokenColor = (token: string) => document.documentElement.style.getPropertyValue(`--risu-theme-${token}`)

    test('keeps copied Pastel surface styling without claiming the active skin is still built-in', () => {
        changeColorScheme('pastel-pop')
        changeColorScheme('custom')
        expect(document.documentElement.dataset.risuColorScheme).toBe('custom')
        expect(document.documentElement.dataset.risuBaseScheme).toBe('pastel-pop')
        changeColorScheme('light')
        expect(document.documentElement.dataset.risuBaseScheme).toBe('light')
    })

    test('exports and imports exact role overrides using the existing color-scheme file flow', async () => {
        changeColorScheme('light')
        changeColorScheme('custom')
        state.db.colorScheme.uiColors = { binding: '#aabbcc80', 'binding-text': '#123456' }
        exportColorScheme()
        const exported = vi.mocked(downloadFile).mock.calls.at(-1)!
        expect(exported[0]).toBe('colorScheme.json')
        const json = exported[1] as string
        vi.mocked(selectSingleFile).mockResolvedValue({ name: 'colorScheme.json', data: new Uint8Array() })
        vi.mocked(BufferToText).mockReturnValue(json)
        changeColorScheme('dark')
        await importColorScheme()
        expect(state.db.colorSchemeName).toBe('custom')
        expect(tokenColor('binding')).toBe('#aabbcc80')
        expect(state.db.colorScheme.baseScheme).toBe('light')
    })

    test('rejects an imported invalid base mode before the settings editor can use it', async () => {
        vi.mocked(selectSingleFile).mockResolvedValue({ name: 'colorScheme.json', data: new Uint8Array() })
        vi.mocked(BufferToText).mockReturnValue(JSON.stringify({ ...lightColorScheme, type: 'invalid' }))
        await importColorScheme()
        expect(notifyError).toHaveBeenCalledWith('Invalid color scheme')
        expect(state.db.colorSchemeName).toBe('dark')
    })

    test.each(['dark', 'light', 'pastel-pop'])('%s publishes legible binding and status pairs', (scheme) => {
        changeColorScheme(scheme)
        for (const [foreground, background] of [
            ['binding-text', 'binding'],
            ...['info', 'success', 'warning', 'danger', 'secondary'].flatMap((role) => [
                [role, `${role}-bg`], [`on-${role}`, role],
            ]),
        ]) {
            expect(tokenColor(foreground), foreground).toMatch(/^#[0-9a-f]{6}$/i)
            expect(tokenColor(background), background).toMatch(/^#[0-9a-f]{6}$/i)
            expect(contrastRatio(rgb(tokenColor(foreground)), rgb(tokenColor(background))), `${foreground} / ${background}`).toBeGreaterThanOrEqual(4.5)
        }
        expect(tokenColor('binding')).not.toBe(tokenColor('primary'))
    })

    test('keeps custom role overrides through JSON round trip and clears them for built-in selections', () => {
        changeColorScheme('custom')
        state.db.colorScheme.uiColors = { binding: '#fce7f3', 'binding-text': '#831843', warning: '#78350f' }
        state.db.colorScheme = JSON.parse(JSON.stringify(state.db.colorScheme))

        updateColorScheme()

        expect(tokenColor('binding')).toBe('#fce7f3')
        expect(tokenColor('binding-text')).toBe('#831843')
        expect(tokenColor('warning')).toBe('#78350f')
        changeColorScheme('light')
        expect(tokenColor('binding')).not.toBe('#fce7f3')
    })

    test('legacy custom palettes receive defaults and malformed overrides cannot invalidate CSS', () => {
        changeColorScheme('custom')
        updateColorScheme()
        const fallback = tokenColor('binding')
        expect(fallback).toMatch(/^#[0-9a-f]{6}$/i)
        state.db.colorScheme.uiColors = { binding: 'not-a-color' }
        updateColorScheme()
        expect(tokenColor('binding')).toBe(fallback)
    })
})

test('legacy custom dialogue is readable on Light without rewriting the saved color', () => {
    state.db.textTheme = 'custom'
    state.db.customTextTheme.FontColorQuote2 = '#FFB86C'
    changeColorScheme('light')

    const rendered = fontColors().FontColorQuote2
    expect(rendered).not.toBe('#FFB86C')
    expect(contrastRatio(rgb(rendered), rgb(lightColorScheme.bgcolor))).toBeGreaterThanOrEqual(4.5)
    expect(state.db.customTextTheme.FontColorQuote2).toBe('#FFB86C')

    state.db.textThemeAutoContrast = false
    updateTextThemeAndCSS()
    expect(fontColors().FontColorQuote2).toBe('#FFB86C')
})
