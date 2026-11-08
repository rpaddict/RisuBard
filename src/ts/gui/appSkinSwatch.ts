// Preview colors for skin cards and rows. Missing roles fall back to the current theme.

import { resolveSkinFontStacks, type AppSkin } from './appSkin'

export interface AppSkinSwatch {
    ground: string
    surface: string
    border: string
    text: string
    accent: string
    accentText: string
    radius: string
    font: string
}

export function appSkinSwatch(skin: AppSkin): AppSkinSwatch {
    const c = skin.colors ?? {}
    const t = skin.tokens ?? {}
    return {
        ground: c.bgcolor ?? 'var(--color-bgcolor)',
        surface: c.darkbg ?? 'var(--color-darkbg)',
        border: c.darkborderc ?? 'var(--color-darkborderc)',
        text: c.textcolor ?? 'var(--color-textcolor)',
        accent: c.primary ?? 'var(--color-primary)',
        accentText: c.accenttext ?? 'var(--color-accenttext)',
        radius: t['radius-md'] ?? 'var(--risu-radius-md)',
        font: resolveSkinFontStacks(skin).ui ?? 'inherit',
    }
}

/** The default card shows the user's own color scheme, not whatever skin is active. */
export function defaultAppSkinSwatch(scheme: { bgcolor: string, darkbg: string, darkBorderc: string, textcolor: string, primary: string, accentText?: string }): AppSkinSwatch {
    return {
        ground: scheme.bgcolor,
        surface: scheme.darkbg,
        border: scheme.darkBorderc,
        text: scheme.textcolor,
        accent: scheme.primary,
        accentText: scheme.accentText ?? scheme.textcolor,
        radius: '0.375rem',
        font: 'inherit',
    }
}
