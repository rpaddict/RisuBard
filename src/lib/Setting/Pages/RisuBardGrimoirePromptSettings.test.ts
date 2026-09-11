import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SettingsRoute } from 'src/ts/routing'
import { settingsSections } from 'src/ts/setting/settingsNavigation'

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')

describe('Grimoire prompt settings', () => {
    it('adds the Grimoire prompt entry immediately below Wiki prompts', () => {
        const items = settingsSections.find((section) => section.id === 'risubard')!.items
        const wikiIndex = items.findIndex((item) => item.route === SettingsRoute.RisuBardWikiPrompt)

        expect(items[wikiIndex + 1]).toMatchObject({
            id: 'risubard-grimoire-prompt',
            route: SettingsRoute.RisuBardGrimoirePrompt,
        })
        expect(read('src/lib/Setting/Settings.svelte')).toContain('<RisuBardGrimoirePromptSettings />')
    })

    it('uses one shared protected-copy workspace in settings and the analysis dialog', () => {
        const page = read('src/lib/Setting/Pages/RisuBardGrimoirePromptSettings.svelte')
        const workspace = read('src/lib/Setting/Pages/RisuBardGrimoirePromptWorkspace.svelte')
        const analysis = read('src/lib/SideBars/LoreBook/BardLoreAnalysisPanel.svelte')

        expect(page).toContain('<RisuBardGrimoirePromptWorkspace')
        expect(workspace).toContain('duplicateBardLoreInstructionPreset')
        expect(workspace).toContain('activePreset.builtin')
        expect(analysis).toContain('tier="top"')
        expect(analysis).toContain('<RisuBardGrimoirePromptWorkspace')
        const database = read('src/ts/storage/database.svelte.ts')
        expect(database).toContain('risuBardGrimoirePromptPresets?:')
        expect(database).toContain('normalizeBardLoreInstructionPresetState({')
    })
})
