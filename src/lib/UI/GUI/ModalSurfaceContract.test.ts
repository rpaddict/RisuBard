import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, test } from 'vitest'

function source(path: string): string {
    return readFileSync(resolve(process.cwd(), path), 'utf8')
}

describe('modal surface contract', () => {
    test('defines one theme-safe modal visual language', () => {
        const styles = source('src/styles.css')

        expect(styles).toContain('.risu-modal-overlay')
        expect(styles).toContain('var(--color-overlay) 58%')
        expect(styles).toContain('.risu-modal-surface')
        expect(styles).toContain('background: var(--color-darkbg)')
        expect(styles).toContain('border: 1px solid var(--color-darkborderc)')
        expect(styles).toContain('border-radius: 1rem')
        expect(styles).toContain('.risu-modal-header')
        expect(styles).toContain('.risu-modal-close')
    })

    test('shared dialog primitives use the canonical overlay and surface', () => {
        for (const file of [
            'src/lib/UI/GUI/ShDialog.svelte',
            'src/lib/UI/GUI/ShAlertDialog.svelte',
            'src/lib/UI/GUI/ShLoadingDialog.svelte',
        ]) {
            const component = source(file)
            expect(component, file).toContain('risu-modal-overlay')
            expect(component, file).toContain('risu-modal-surface')
        }

        const dialog = source('src/lib/UI/GUI/ShDialog.svelte')
        expect(dialog).toContain('risu-modal-header')
        expect(dialog).toContain('risu-modal-close')
    })

    test('legacy modal implementations adopt the canonical visual contract', () => {
        const modalFiles = [
            'src/lib/Others/AlertComp.svelte',
            'src/lib/Others/BookmarkList.svelte',
            'src/lib/Others/ChatList.svelte',
            'src/lib/Others/HypaV3Modal.svelte',
            'src/lib/Others/HypaV3Modal/category-manager-modal.svelte',
            'src/lib/Others/HypaV3Modal/tag-manager-modal.svelte',
            'src/lib/Others/PersonaManager.svelte',
            'src/lib/Others/PluginAlertModal.svelte',
            'src/lib/Others/PopupEditor.svelte',
            'src/lib/Others/PromptDiffModal.svelte',
            'src/lib/Others/RisuBardMemoryWiki.svelte',
            'src/lib/FirstMessageStudio/FirstMessageStudioEditor.svelte',
            'src/lib/ChatScreens/PartialEditController.svelte',
            'src/lib/Setting/listedHypaV3Preset.svelte',
            'src/lib/Setting/listedPersona.svelte',
            'src/lib/Setting/lorepreset.svelte',
            'src/lib/Setting/modelpreset.svelte',
            'src/lib/Setting/modelProfileBrowser.svelte',
            'src/lib/Setting/themepreset.svelte',
            'src/lib/SideBars/Scripts/TriggerV2List.svelte',
            'src/lib/UI/ModelList.svelte',
            'src/lib/UI/ModelPresetList.svelte',
            'src/lib/UI/OpenrouterProviderList.svelte',
        ]

        for (const file of modalFiles) {
            const component = source(file)
            expect(component, file).toContain('risu-modal-overlay')
            expect(component, file).toContain('risu-modal-surface')
        }

        expect(source('src/lib/Others/LoadingOverlay.svelte'))
            .toContain('risu-modal-overlay')
    })

    test('custom ShDialog surfaces keep the canonical opaque background', () => {
        const characterVault = source('src/lib/SideBars/CharacterVaultDialog.svelte')
        const saveSlots = source('src/lib/SideBars/RisuBardSaveSlotsDialog.svelte')

        expect(characterVault).toMatch(
            /:global\(\.character-vault-dialog\)[\s\S]*?background:\s*var\(--color-darkbg\)/,
        )
        expect(saveSlots).toMatch(
            /:global\(\.save-slot-dialog\)[^}]*background:\s*var\(--color-darkbg\)/,
        )
    })

    test('keeps fixed-width legacy modal surfaces inside narrow viewports', () => {
        for (const file of [
            'src/lib/Others/ChatList.svelte',
            'src/lib/Setting/listedHypaV3Preset.svelte',
            'src/lib/Setting/listedPersona.svelte',
            'src/lib/Setting/lorepreset.svelte',
            'src/lib/Setting/modelpreset.svelte',
            'src/lib/Setting/modelProfileBrowser.svelte',
            'src/lib/Setting/themepreset.svelte',
        ]) {
            const surface = source(file).split(/\r?\n/)
                .find((line) => line.includes('risu-modal-surface')) ?? ''
            expect(surface, file).toContain('max-w-full')
        }
    })

    test('bounds partial-edit modal minimum widths by the viewport gutter', () => {
        const partialEdit = source('src/lib/ChatScreens/PartialEditController.svelte')

        expect(partialEdit).not.toMatch(/min-width:\s*(?:320|400)px/)
        expect(partialEdit.match(/min-width:\s*min\((?:320|400)px, calc\(100vw - 2rem\)\)/g))
            .toHaveLength(4)
    })
})
