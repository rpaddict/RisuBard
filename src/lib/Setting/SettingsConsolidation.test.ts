import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, test } from 'vitest'

const settingsPath = resolve(process.cwd(), 'src/lib/Setting/Settings.svelte')
const environmentPath = resolve(process.cwd(), 'src/lib/Setting/ExperienceSettingsWorkspace.svelte')
const sidebarPath = resolve(process.cwd(), 'src/lib/SideBars/Sidebar.svelte')
const appPath = resolve(process.cwd(), 'src/App.svelte')
const personaManagerPath = resolve(process.cwd(), 'src/lib/Others/PersonaManager.svelte')
const backupPath = resolve(process.cwd(), 'src/lib/Setting/Pages/SystemBackup.svelte')
const searchManifestPath = resolve(process.cwd(), 'src/ts/setting/searchManifestData.ts')

describe('settings consolidation', () => {
    test('keeps V1 backup and transfer work on the System backup tab', () => {
        const settings = readFileSync(settingsPath, 'utf8')
        const backup = readFileSync(backupPath, 'utf8')
        const searchManifest = readFileSync(searchManifestPath, 'utf8')

        expect(settings).not.toContain('<MigrationSettings')
        expect(settings).toContain('SettingsRoute.Migration')
        expect(settings).toContain('SystemTab.Backups')
        expect(searchManifest).not.toContain('manual.page.migration')
        for (const operation of [
            'SaveLocalBackupForUpstream',
            'ImportFromSaveZip',
            'CleanupMigratedFiles',
            'SavePartialLocalBackup',
            'exportAsDataset',
        ]) expect(backup).toContain(operation)
        expect(backup).not.toContain('V2Import')
        expect(backup).not.toContain('nativeRuntime')
    })

    test('uses stronger secondary text contrast inside settings', () => {
        const source = readFileSync(settingsPath, 'utf8')

        expect(source).toContain('--risu-theme-textcolor2: color-mix(')
        expect(source).toContain('var(--risu-theme-textcolor) 82%')
    })

    test('switches display, language, and accessibility as exclusive tabs', () => {
        expect(existsSync(environmentPath)).toBe(true)
        if (!existsSync(environmentPath)) return

        const source = readFileSync(environmentPath, 'utf8')
        expect(source).toContain("activeRoute === SettingsRoute.Display")
        expect(source).toContain("activeRoute === SettingsRoute.Language")
        expect(source).toContain('<DisplaySettings embedded />')
        expect(source).toContain('<LanguageSettings embedded />')
        expect(source).toContain('<AccessibilitySettings embedded />')
        expect(source).not.toContain('scrollIntoView')
    })

    test('routes all three environment entry points to the combined page', () => {
        const source = readFileSync(settingsPath, 'utf8')

        expect(source).toContain('isExperienceSettingsRoute($SettingsMenuIndex as SettingsRouteValue)')
        expect(source).toContain('<ExperienceSettingsWorkspace')
    })

    test('keeps persona management as an overlay at the top of the bot sidebar', () => {
        const sidebar = readFileSync(sidebarPath, 'utf8')
        const app = readFileSync(appPath, 'utf8')
        const settings = readFileSync(settingsPath, 'utf8')

        expect(sidebar).toContain('data-sidebar-persona')
        expect(sidebar).toContain('openPersonaManager.set(true)')
        expect(sidebar.indexOf('data-sidebar-persona')).toBeLessThan(sidebar.indexOf('data-character-vault-button'))
        expect(app).toContain('<PersonaManager')
        expect(settings).not.toContain("import PersonaSettings from './Pages/PersonaSettings.svelte'")
        expect(settings).not.toContain('$SettingsMenuIndex === SettingsRoute.Persona')
    })

    test('keeps persona management below nested alerts and popup editors', () => {
        const personaManager = readFileSync(personaManagerPath, 'utf8')

        expect(personaManager).toContain('z-index: 40;')
        expect(personaManager).not.toContain('z-index: 80;')
    })
})
