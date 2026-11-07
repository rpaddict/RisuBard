import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, test } from 'vitest'

const sharedTabsPath = resolve(process.cwd(), 'src/lib/UI/GUI/SettingsSectionTabs.svelte')
const settingTabsPath = resolve(process.cwd(), 'src/lib/UI/GUI/SettingTabs.svelte')
const aiWorkspacePath = resolve(process.cwd(), 'src/lib/Setting/AISettingsWorkspace.svelte')
const experienceWorkspacePath = resolve(process.cwd(), 'src/lib/Setting/ExperienceSettingsWorkspace.svelte')
const prominentPagePaths = [
    'src/lib/Setting/Pages/AdvancedSettings.svelte',
    'src/lib/Setting/Pages/InlayImageGallery.svelte',
    'src/lib/Setting/Pages/PromptPresetSettings.svelte',
    'src/lib/Setting/Pages/PromptSettings.svelte',
    'src/lib/Setting/Pages/RisuBardWikiPromptSettings.svelte',
    'src/lib/Setting/Pages/SystemSettings.svelte',
].map((path) => resolve(process.cwd(), path))
const embeddedPagePaths = [
    'src/lib/Setting/Pages/AccessibilitySettings.svelte',
    'src/lib/Setting/Pages/BotSettings.svelte',
    'src/lib/Setting/Pages/DisplaySettings.svelte',
    'src/lib/Setting/Pages/Model/ModelPresetSettings.svelte',
    'src/lib/Setting/Pages/OtherBotSettings.svelte',
].map((path) => resolve(process.cwd(), path))

describe('settings section tab standard', () => {
    test('provides a single-row horizontally scrollable tablist', () => {
        expect(existsSync(sharedTabsPath)).toBe(true)
        if (!existsSync(sharedTabsPath)) return

        const source = readFileSync(sharedTabsPath, 'utf8')
        expect(source).toContain('data-settings-section-tabs')
        expect(source).toContain('role="tablist"')
        expect(source).toContain('overflow-x: auto')
        expect(source).toContain('white-space: nowrap')
        expect(source).not.toContain('flex-wrap')
    })

    test('provides a prominent rounded accent variant for top-level navigation', () => {
        const source = readFileSync(sharedTabsPath, 'utf8')

        expect(source).toContain("variant?: 'default' | 'prominent'")
        expect(source).toContain("class:prominent={variant === 'prominent'}")
        expect(source).toContain('.settings-section-tabs.prominent {')
        expect(source).toContain('var(--risu-theme-primary)')
        expect(source).toContain('border-radius: calc(var(--risu-radius-2xl) * 0.9)')
        expect(source).toContain('.prominent button {')
        expect(source).toContain('min-height: 3rem')
        expect(source).toContain('font-size: .96rem')
        expect(source).toContain('font-weight: 700')
        expect(source).toContain('.prominent button:focus-visible')
        expect(source).toContain('.prominent button.active::after')
    })

    test('backs the existing option tabs with the shared standard', () => {
        const source = readFileSync(settingTabsPath, 'utf8')

        expect(source).toContain("import SettingsSectionTabs from './SettingsSectionTabs.svelte'")
        expect(source).toContain('<SettingsSectionTabs')
        expect(source).toContain("variant?: 'default' | 'prominent'")
        expect(source).toContain('{variant}')
    })

    test('uses the shared top tabs for AI and environment at every viewport size', () => {
        const aiSource = readFileSync(aiWorkspacePath, 'utf8')
        const experienceSource = readFileSync(experienceWorkspacePath, 'utf8')

        expect(aiSource).toContain('<SettingsSectionTabs')
        expect(aiSource).not.toContain('mobile-section-tabs')
        expect(aiSource).not.toContain('<nav class="section-navigation"')
        expect(experienceSource).toContain('<SettingsSectionTabs')
    })

    test('uses the prominent hierarchy for every top-level settings tab row', () => {
        const aiSource = readFileSync(aiWorkspacePath, 'utf8')
        const experienceSource = readFileSync(experienceWorkspacePath, 'utf8')

        expect(aiSource).toContain('variant="prominent"')
        expect(experienceSource).toContain('variant="prominent"')
        for (const path of prominentPagePaths) {
            expect(readFileSync(path, 'utf8'), path).toContain('variant="prominent"')
        }
    })

    test('keeps embedded detail tabs visually subordinate', () => {
        for (const path of embeddedPagePaths) {
            expect(readFileSync(path, 'utf8'), path).not.toContain('variant="prominent"')
        }
    })
})
