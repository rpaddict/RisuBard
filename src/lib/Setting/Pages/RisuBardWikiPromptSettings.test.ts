import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, test } from 'vitest'
import { settingsSections } from 'src/ts/setting/settingsNavigation'
import { SettingsRoute } from 'src/ts/routing'

const pagePath = resolve(
    process.cwd(),
    'src/lib/Setting/Pages/RisuBardWikiPromptSettings.svelte'
)
const blockPath = resolve(
    process.cwd(),
    'src/lib/Setting/Pages/RisuBardWikiPromptBlock.svelte'
)
const referencePath = resolve(
    process.cwd(),
    'src/lib/Setting/Pages/RisuBardWikiPromptReferenceSheet.svelte'
)
const textAreaPath = resolve(
    process.cwd(),
    'src/lib/UI/GUI/TextAreaInput.svelte'
)
const settingsPath = resolve(process.cwd(), 'src/lib/Setting/Settings.svelte')
const searchIndexPath = resolve(process.cwd(), 'src/ts/setting/searchIndex.ts')

describe('RisuBard Wiki Prompt settings', () => {
    test('registers a dedicated RisuBard settings route', () => {
        expect(settingsSections[1].items).toContainEqual(expect.objectContaining({
            id: 'risubard-wiki-prompt',
            route: SettingsRoute.RisuBardWikiPrompt,
        }))
        expect(readFileSync(settingsPath, 'utf8')).toContain(
            '<RisuBardWikiPromptSettings />'
        )
        expect(readFileSync(searchIndexPath, 'utf8')).toContain(
            'case SettingsRoute.RisuBardWikiPrompt: return language.risuBardWikiPrompt.title;'
        )
    })

    test('reuses the AI preset page hierarchy and exposes create and file actions', () => {
        const source = readFileSync(pagePath, 'utf8')

        expect(source).toContain('<SettingPage')
        expect(source).toContain('<PresetHeader')
        expect(source).toContain('<SettingTabs')
        expect(source).toContain('createWikiPromptPreset')
        expect(source).toContain('function createPreset()')
        expect(source).toContain('onclick={createPreset}')
        expect(source).toContain('language.risuBardWikiPrompt.createPreset')
        expect(source).toContain('duplicateWikiPromptPreset')
        expect(source).toContain('serializeWikiPromptPreset')
        expect(source).toContain('parseWikiPromptPreset')
        expect(source).toContain('deleteWikiPromptPreset')
        expect(source).toContain("selectSingleFile(['json'])")
        expect(source).toContain('downloadFile(')
    })

    test('uses the Prompt V2 workspace and keeps only the built-in preset immutable', () => {
        const page = readFileSync(pagePath, 'utf8')
        const block = readFileSync(blockPath, 'utf8')

        expect(page).toContain('<RisuBardWikiPromptV2Workspace')
        expect(page).toContain('readonly={activePreset.builtin}')
        expect(page).toContain('fullWidth={activeTab === 0}')
        expect(page).toContain('disabled={activePreset.builtin}')
        expect(block).toContain('block.readonly')
        const workspace = readFileSync(
            resolve(process.cwd(), 'src/lib/Setting/Pages/RisuBardWikiPromptV2Workspace.svelte'),
            'utf8'
        )
        expect(workspace).toContain("PromptV2BlockEditor")
        expect(workspace).toContain("block.type === 'core-ref'")
        expect(workspace).toContain('critical={selectedBlock?.type ===')
        expect(readFileSync(textAreaPath, 'utf8')).toContain('class:resize-y={resizable}')
    })

    test('supports writing and response targets and opens a field reference sheet', () => {
        const page = readFileSync(pagePath, 'utf8')
        const workspace = readFileSync(
            resolve(process.cwd(), 'src/lib/Setting/Pages/RisuBardWikiPromptV2Workspace.svelte'),
            'utf8'
        )
        const reference = readFileSync(referencePath, 'utf8')

        expect(workspace).toContain("addBlock('both')")
        expect(workspace).toContain("addBlock('response')")
        expect(workspace).toContain('value="canonical-rewrite"')
        expect(page).toContain('<RisuBardWikiPromptReferenceSheet')
        expect(reference).toContain('<ShDialog')
        expect(reference).toContain('establishedEvents')
        expect(reference).toContain('stateChanges')
        expect(reference).toContain('persistentFacts')
        expect(reference).toContain('canonicalUpdateCandidates')
        expect(reference).toContain('schemaVersion / title')
        expect(reference).toContain('helpProgramOwnedFields')
    })
})
