// Non-color skin tokens. Colors live in uiThemeTokens.ts.
// styles.css declares every token on :root with the default below, which
// reproduces the pre-skin look; a skin overrides them on :root.
// Tailwind's rounded-* and shadow-* utilities read the radius and shadow
// tokens through the @theme block, so components follow a skin unchanged.

export type UiSkinTokenGroup = 'font' | 'radius' | 'shadow' | 'shadow-role' | 'clip'

export interface UiSkinTokenDefinition {
    token: string
    group: UiSkinTokenGroup
    /** '' for override-only roles: never declared, so each use falls back to its own original shadow. */
    defaultValue: string
}

const shadowMix = (percent: number) => `color-mix(in srgb, var(--risu-theme-shadow) ${percent}%, transparent)`

export const uiSkinTokenDefinitions: readonly UiSkinTokenDefinition[] = [
    { token: 'font-ui', group: 'font', defaultValue: 'var(--risu-font-family)' },
    { token: 'font-prose', group: 'font', defaultValue: 'var(--risu-font-family)' },
    { token: 'font-display', group: 'font', defaultValue: 'var(--risu-font-ui)' },
    { token: 'font-numeric', group: 'font', defaultValue: 'var(--risu-font-ui)' },

    { token: 'radius', group: 'radius', defaultValue: '0.25rem' },
    { token: 'radius-xs', group: 'radius', defaultValue: '0.125rem' },
    { token: 'radius-sm', group: 'radius', defaultValue: '0.25rem' },
    { token: 'radius-md', group: 'radius', defaultValue: '0.375rem' },
    { token: 'radius-lg', group: 'radius', defaultValue: '0.5rem' },
    { token: 'radius-xl', group: 'radius', defaultValue: '0.75rem' },
    { token: 'radius-2xl', group: 'radius', defaultValue: '1rem' },
    { token: 'radius-3xl', group: 'radius', defaultValue: '1.5rem' },
    { token: 'radius-4xl', group: 'radius', defaultValue: '2rem' },

    { token: 'shadow', group: 'shadow', defaultValue: `0 1px 3px 0 ${shadowMix(10)}, 0 1px 2px -1px ${shadowMix(10)}` },
    { token: 'shadow-2xs', group: 'shadow', defaultValue: `0 1px ${shadowMix(5)}` },
    { token: 'shadow-xs', group: 'shadow', defaultValue: `0 1px 2px 0 ${shadowMix(5)}` },
    { token: 'shadow-sm', group: 'shadow', defaultValue: `0 1px 3px 0 ${shadowMix(10)}, 0 1px 2px -1px ${shadowMix(10)}` },
    { token: 'shadow-md', group: 'shadow', defaultValue: `0 4px 6px -1px ${shadowMix(10)}, 0 2px 4px -2px ${shadowMix(10)}` },
    { token: 'shadow-lg', group: 'shadow', defaultValue: `0 10px 15px -3px ${shadowMix(10)}, 0 4px 6px -4px ${shadowMix(10)}` },
    { token: 'shadow-xl', group: 'shadow', defaultValue: `0 20px 25px -5px ${shadowMix(10)}, 0 8px 10px -6px ${shadowMix(10)}` },
    { token: 'shadow-2xl', group: 'shadow', defaultValue: `0 25px 50px -12px ${shadowMix(25)}` },
    { token: 'shadow-popover', group: 'shadow', defaultValue: `0 20px 25px -5px ${shadowMix(20)}, 0 8px 10px -6px ${shadowMix(20)}` },

    // Depth shadows written per component as var(--risu-shadow-<role>, original).
    // Unset by default; a skin sets one to restyle every shadow of that size at once.
    { token: 'shadow-raised', group: 'shadow-role', defaultValue: '' },
    { token: 'shadow-floating', group: 'shadow-role', defaultValue: '' },
    { token: 'shadow-overlay', group: 'shadow-role', defaultValue: '' },

    // No effect since 0.9.93: clipping the card also cut off the inline edit popup and split the
    // card at the composer. Still accepted so skins made for 0.9.92 keep installing.
    { token: 'message-clip-radius', group: 'clip', defaultValue: '' },
]
