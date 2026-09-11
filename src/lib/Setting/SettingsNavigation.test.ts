import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, test } from 'vitest'
import { settingsSections } from 'src/ts/setting/settingsNavigation'
import { SettingsRoute } from 'src/ts/routing'

const componentPath = resolve(process.cwd(), 'src/lib/Setting/SettingsNavigation.svelte')
const workspacePath = resolve(process.cwd(), 'src/lib/Setting/Settings.svelte')

describe('SettingsNavigation', () => {
    test('places chat prompt presets immediately after AI settings', () => {
        expect(settingsSections[0].items.slice(0, 2)).toEqual([
            expect.objectContaining({ id: 'ai-settings', route: SettingsRoute.ModelPreset }),
            expect.objectContaining({ id: 'chat-prompt-presets', route: SettingsRoute.PromptPreset }),
        ])
    })

    test('places the unified RisuBard common page and wiki prompt directly below AI', () => {
        expect(settingsSections.map((section) => section.id).slice(0, 3)).toEqual([
            'ai',
            'risubard',
            'experience',
        ])
        expect(settingsSections[1].items).toEqual([
            expect.objectContaining({
                id: 'risubard-common',
                route: SettingsRoute.RisuBardCommon,
                aliases: [SettingsRoute.RisuBardChat],
            }),
            expect.objectContaining({ id: 'risubard-wiki-prompt', route: SettingsRoute.RisuBardWikiPrompt }),
            expect.objectContaining({ id: 'risubard-grimoire-prompt', route: SettingsRoute.RisuBardGrimoirePrompt }),
        ])
    })

    test('exposes the workspace navigation landmarks', () => {
        const source = readFileSync(componentPath, 'utf8')

        expect(source).toContain('data-settings-navigation')
        expect(source).toContain('data-settings-section')
        expect(source).toContain("aria-current={isSettingsNavigationItemActive(item, activeRoute) ? 'page' : undefined}")
    })

    test('places a persona manager action first in the first settings section', () => {
        const source = readFileSync(componentPath, 'utf8')
        const personaButton = source.indexOf('data-settings-persona')
        const routedItems = source.indexOf('{#each section.items as item')

        expect(source).toContain("section.id === 'ai'")
        expect(source).toContain('onNavigate(SettingsRoute.Persona)')
        expect(personaButton).toBeGreaterThan(-1)
        expect(personaButton).toBeLessThan(routedItems)
    })

    test('provides search, close, and mobile back actions', () => {
        const source = readFileSync(componentPath, 'utf8')

        expect(source).toContain('data-settings-search')
        expect(source).toContain('data-settings-close')
        expect(source).toContain('data-settings-mobile-back')
        expect(source).toContain('{#if !mobile}<kbd>Ctrl K</kbd>{/if}')
    })

    test('connects the advertised search shortcut to the workspace', () => {
        const source = readFileSync(workspacePath, 'utf8')

        expect(source).toContain("event.key.toLowerCase() === 'k'")
        expect(source).toContain('event.ctrlKey || event.metaKey')
    })

    test('does not expose a separate legacy migration page', () => {
        expect(settingsSections.flatMap((section) => section.items).map((item) => item.id))
            .not.toContain('migration')

        const source = readFileSync(workspacePath, 'utf8')
        expect(source).not.toContain("import MigrationSettings")
        expect(source).not.toContain('<MigrationSettings')
    })
})
