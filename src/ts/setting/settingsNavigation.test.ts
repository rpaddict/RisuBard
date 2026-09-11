import { describe, expect, test } from 'vitest'
import { SettingsRoute } from '../routing'
import {
    getVisibleSettingsSections,
    isExperienceSettingsRoute,
    isSettingsNavigationItemActive,
    settingsSections,
} from './settingsNavigation'

describe('settings navigation registry', () => {
    test('orders the full settings workspace by user task', () => {
        const sections = getVisibleSettingsSections({
            isLite: false,
            isDesktop: true,
            devPanelEnabled: false,
        })

        expect(sections.map((section) => section.id)).toEqual([
            'ai',
            'risubard',
            'experience',
            'extensions',
            'system',
        ])
    })

    test('places chat prompt presets directly below the AI workspace', () => {
        const aiSection = settingsSections.find((section) => section.id === 'ai')

        expect(aiSection?.items.map((item) => item.id)).toEqual([
            'ai-settings',
            'chat-prompt-presets',
            'advanced',
        ])
        expect(aiSection?.items[0].route).toBe(SettingsRoute.ModelPreset)
        expect(aiSection?.items[1].route).toBe(SettingsRoute.PromptPreset)
        expect(aiSection?.items[2].route).toBe(SettingsRoute.Advanced)
    })

    test('keeps only the remaining legacy AI routes active inside the unified workspace', () => {
        const aiItem = settingsSections.find((section) => section.id === 'ai')?.items[0]
        const promptPresetItem = settingsSections.find((section) => section.id === 'ai')?.items[1]

        expect(aiItem).toBeDefined()
        expect([
            SettingsRoute.ChatBot,
            SettingsRoute.ModelPreset,
            SettingsRoute.OtherBots,
        ].every((route) => isSettingsNavigationItemActive(aiItem!, route))).toBe(true)
        expect(isSettingsNavigationItemActive(aiItem!, SettingsRoute.PromptPreset)).toBe(false)
        expect(isSettingsNavigationItemActive(promptPresetItem!, SettingsRoute.PromptPreset)).toBe(true)
        expect(isSettingsNavigationItemActive(aiItem!, SettingsRoute.Display)).toBe(false)
    })

    test('keeps the legacy chat route active inside unified RisuBard common settings', () => {
        const risuBard = settingsSections.find((section) => section.id === 'risubard')
        const common = risuBard?.items.find((item) => item.id === 'risubard-common')

        expect(risuBard?.items.map((item) => item.id)).toEqual([
            'risubard-common',
            'risubard-wiki-prompt',
            'risubard-grimoire-prompt',
        ])
        expect(isSettingsNavigationItemActive(common!, SettingsRoute.RisuBardChat)).toBe(true)
    })

    test('removes the redundant creation section from the sidebar', () => {
        const hasCreation = settingsSections.some((section) => String(section.id) === 'creation')
        const routes = settingsSections.flatMap((section) => section.items.map((item) => item.route))

        expect(hasCreation).toBe(false)
        expect(routes).not.toContain(SettingsRoute.Prompt)
        expect(routes).not.toContain(SettingsRoute.GlobalLoreBook)
        expect(routes).not.toContain(SettingsRoute.GlobalRegex)
    })

    test('combines display, language, and accessibility', () => {
        const experience = settingsSections.find((section) => section.id === 'experience')
        const environmentItem = experience?.items[0]

        expect(experience?.items.map((item) => item.id)).toEqual([
            'experience-settings',
            'sound',
            'hotkeys',
        ])
        expect(environmentItem?.route).toBe(SettingsRoute.Display)
        expect(isSettingsNavigationItemActive(environmentItem!, SettingsRoute.Language)).toBe(true)
        expect(isSettingsNavigationItemActive(environmentItem!, SettingsRoute.Accessibility)).toBe(true)
        expect(isExperienceSettingsRoute(SettingsRoute.Display)).toBe(true)
        expect(isExperienceSettingsRoute(SettingsRoute.Language)).toBe(true)
        expect(isExperienceSettingsRoute(SettingsRoute.Accessibility)).toBe(true)
        expect(isExperienceSettingsRoute(SettingsRoute.SoundAndNotification)).toBe(false)
    })

    test('assigns every top-level workspace to one canonical route', () => {
        const routes = settingsSections.flatMap((section) => section.items.map((item) => item.route))

        expect(new Set(routes).size).toBe(routes.length)
        expect(routes).toEqual(expect.arrayContaining([
            SettingsRoute.ModelPreset,
            SettingsRoute.Display,
            SettingsRoute.Module,
            SettingsRoute.System,
        ]))
    })

    test('does not duplicate advanced settings in the system section', () => {
        const system = settingsSections.find((section) => section.id === 'system')

        expect(system?.items.map((item) => item.id)).not.toContain('advanced')
    })

    test('keeps the lite workspace useful without exposing full-only pages', () => {
        const sections = getVisibleSettingsSections({
            isLite: true,
            isDesktop: true,
            devPanelEnabled: false,
        })

        expect(sections.map((section) => ({
            id: section.id,
            items: section.items.map((item) => item.id),
        }))).toEqual([
            { id: 'experience', items: ['experience-settings', 'hotkeys'] },
        ])
    })

    test('hides desktop-only pages on mobile and reveals the dev page explicitly', () => {
        const mobileRoutes = getVisibleSettingsSections({
            isLite: false,
            isDesktop: false,
            devPanelEnabled: false,
        }).flatMap((section) => section.items.map((item) => item.route))
        const devRoutes = getVisibleSettingsSections({
            isLite: false,
            isDesktop: true,
            devPanelEnabled: true,
        }).flatMap((section) => section.items.map((item) => item.route))

        expect(mobileRoutes).not.toContain(SettingsRoute.Hotkey)
        expect(devRoutes).toContain(SettingsRoute.DevPanel)
    })
})
