import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, test } from 'vitest'

const modules = readFileSync(resolve(process.cwd(), 'src/lib/Setting/Pages/Module/ModuleSettings.svelte'), 'utf8')
const plugins = readFileSync(resolve(process.cwd(), 'src/lib/Setting/Pages/PluginSettings.svelte'), 'utf8')
const organizer = readFileSync(resolve(process.cwd(), 'src/lib/UI/CollectionOrganizerList.svelte'), 'utf8')
const settingPage = readFileSync(resolve(process.cwd(), 'src/lib/UI/GUI/SettingPage.svelte'), 'utf8')
const resizeHandles = readFileSync(resolve(process.cwd(), 'src/lib/UI/GUI/ManagerResizeHandles.svelte'), 'utf8')

function styleRule(source: string, selector: string) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return source.match(new RegExp(`${escaped}\\s*\\{([^}]+)\\}`))?.[1] ?? ''
}

describe('collection manager item layout', () => {
    test('opts only the module list into the resizable settings page', () => {
        expect(modules).toMatch(/\{#if mode === 0\}\s*<SettingPage resizable title=\{language\.modules\} description=\{language\.collectionOrganizer\.description\}>/)
        expect(modules.match(/<SettingPage resizable\b/g)).toHaveLength(1)
        expect(modules).toContain('<SettingPage title={language.createModule} leading={backButton}>')
        expect(modules).toContain('<SettingPage title={language.editModule} leading={backButton}>')
    })

    test('opts the plugin list into the resizable settings page', () => {
        expect(plugins).toContain('<SettingPage resizable title={language.plugin} description={language.collectionOrganizer.description}>')
    })

    test('uses the shared settings header hierarchy for both collection pages', () => {
        expect(modules).toContain('description={language.collectionOrganizer.description}')
        expect(plugins).toContain('description={language.collectionOrganizer.description}')
        expect(plugins).toContain('<ShAlert variant="warning"')
        expect(plugins).not.toContain('text-draculared')
    })

    test('offers the plugin manager inspired enabled-state filter', () => {
        expect(organizer).toContain('statusOptions?: CollectionOrganizerStatusOption[]')
        expect(organizer).toContain('bind:value={selectedStatus}')
        expect(organizer).toContain('getVisibleCollectionItems(')
        expect(plugins).toContain("status: plugin.enabled ? 'enabled' : 'disabled'")
        expect(plugins).toContain('statusOptions={pluginStatusOptions}')
    })

    test('opts both extension lists into the plugin-manager card layout', () => {
        expect(organizer).toContain('managerLayout?: boolean')
        expect(modules).toMatch(/<CollectionOrganizerList[\s\S]*?managerLayout[\s\S]*?kind="modules"/)
        expect(plugins).toMatch(/<CollectionOrganizerList[\s\S]*?managerLayout[\s\S]*?kind="plugins"/)
        expect(organizer).toContain('collection-item-selection-rail')
        expect(organizer).toContain('{#if !managerLayout}')
        expect(organizer).toContain('class:collection-items--manager={managerLayout}')
        expect(organizer).toContain('class:collection-item--manager={managerLayout}')
    })

    test('connects manager bulk deletion to domain cleanup', () => {
        expect(modules).toContain('onDeleteItems={deleteModules}')
        expect(modules).toContain('DBState.db.enabledModules = DBState.db.enabledModules.filter')
        expect(modules).toContain('normalizeAssignments()')
        expect(modules).toMatch(/modules:\s*normalizeCollectionOrganizerState\(/)
        expect(plugins).toContain('onDeleteItems={deletePlugins}')
        expect(plugins).toContain('[...pluginProviderOwners.entries()]')
        expect(plugins).toContain('customProviderStore.update')
        expect(plugins).toContain('customV3ProviderMetaStore.splice')
        expect(plugins).toMatch(/plugins:\s*normalizeCollectionOrganizerState\(/)
        expect(plugins).toContain('await loadPlugins()')
        const removePlugins = plugins.match(/async function removePlugins[\s\S]*?\n    }\n\n    async function deletePlugins/)?.[0] ?? ''
        expect(removePlugins.indexOf('await requestImmediateSave()')).toBeLessThan(removePlugins.indexOf('await loadPlugins()'))
        expect(removePlugins).not.toContain('!pluginV2.providers.has(DBState.db.currentPluginProvider)')
    })

    test('lets the extension manager resize from every edge within the settings viewport', () => {
        expect(settingPage).toContain('<ManagerResizeHandles target={pageElement} centered {unboundedHeight} {resizeStorageKey} />')
        expect(settingPage).toMatch(/\.settings-standard-page--resizable\s*\{[^}]*left:\s*50%[^}]*align-self:\s*center[^}]*transform:\s*translateX\(-50%\)[^}]*max-width:\s*calc\(100vw - 1rem\)/s)
        expect(resizeHandles).toContain("closest<HTMLElement>('.settings-content')")
        expect(resizeHandles).toContain("['n', 'e', 's', 'w', 'ne', 'se', 'sw', 'nw']")
    })

    test('opens a per-plugin source editor with apply and download actions', () => {
        expect(plugins).toContain('data-plugin-code-editor={plugin.name}')
        expect(plugins).toContain('<ShDialog')
        expect(plugins).toContain('bind:value={pluginCodeDraft}')
        expect(plugins).toContain("isUpdate: true")
        expect(plugins).toContain('originalPluginName: pluginCodeName')
        expect(plugins).toContain('downloadFile(pluginCodeFilename(pluginCodeName), pluginCodeDraft)')
    })

    test('places the plugin setting count beside the title instead of in metadata', () => {
        const nameBlock = plugins.match(/<div class="plugin-item-name[^>]*>([\s\S]*?)<\/div>/)?.[1] ?? ''
        const metaBlock = plugins.match(/<div class="plugin-item-meta[^>]*>([\s\S]*?)<\/div>/)?.[1] ?? ''
        expect(nameBlock).toContain('visibleArgumentCount')
        expect(metaBlock).not.toContain('language.settings')
    })

    test('uses the shared settings surface tokens for the collection frame', () => {
        const rule = styleRule(organizer, '.collection-organizer')
        expect(rule).toContain('var(--settings-surface')
        expect(rule).toContain('var(--settings-border')
        expect(rule).toContain('var(--settings-radius')
    })

    test('keeps plugin metadata but removes redundant module row metadata', () => {
        expect(plugins).toContain('import ShBadge from "src/lib/UI/GUI/ShBadge.svelte"')
        expect(plugins).toContain('class="plugin-item-meta')
        expect(modules).not.toContain('class="module-item-meta')
    })

    test('uses a centered single action row for modules', () => {
        expect(modules).not.toContain('module-action-column')
        expect(styleRule(modules, '.module-item-actions')).toContain('align-items: center')
        expect(styleRule(modules, '.module-item-header')).toContain('height: 100%')
        expect(modules).toContain('variant="outline"')
        expect(modules).toContain('module-activation-icon--active')
        expect(modules).not.toContain('personaAssignmentCount(')
        expect(modules).not.toContain('<Share2Icon')
    })

    test('centers the module title and description in the same row as its actions', () => {
        const titleBlock = modules.match(/<div class="module-item-title[^>]*>([\s\S]*?)<\/div>\s*<div class="module-item-actions">/)?.[1] ?? ''
        expect(titleBlock).toContain('module-item-name')
        expect(titleBlock).toContain('module-item-description')
        expect(styleRule(modules, '.module-item-title')).toContain('justify-content: center')
        expect(styleRule(modules, '.module-item-title')).toContain('flex-direction: column')
    })

    test('matches module action sizes to folder buttons', () => {
        const moduleActions = modules.match(/<div class="module-item-actions">([\s\S]*?)<\/div>\s*<\/div>\s*\{\/if\}/)?.[1] ?? ''
        const pluginActions = plugins.match(/<div class="plugin-item-actions">([\s\S]*?)<\/div>\s*<\/div>\s*\{#if plugin\.version/)?.[1] ?? ''
        expect(moduleActions).toContain('size="icon-xs"')
        expect(moduleActions).not.toContain('size="icon"')
        expect(organizer).toContain('size="icon-xs"')
        expect(pluginActions).toContain('size="icon"')
        expect(styleRule(organizer, '.collection-item--manager .collection-item-content')).toContain('padding: .45rem .7rem')
    })

    test('moves module download into the edit page', () => {
        expect(modules).toMatch(/\{:else if mode === 2\}[\s\S]*?exportModule\(tempModule\)/)
    })

    test('uses an icon-only 18px back button in the module editor title', () => {
        const backButton = modules.match(/\{#snippet backButton\(\)\}([\s\S]*?)\{\/snippet\}/)?.[1] ?? ''
        expect(backButton).toContain('size="icon-sm"')
        expect(backButton).toContain('aria-label={language.moduleBackToList}')
        expect(backButton).toContain('title={language.moduleBackToList}')
        expect(backButton).toContain('<ArrowLeftIcon size={18}/>')
        expect(backButton).not.toContain('>{language.moduleBackToList}<')
    })

    test('centers only the two accent-sized secondary actions below module editing', () => {
        const editPage = modules.match(/\{:else if mode === 2\}([\s\S]*?)\{\/if\}\s*<ShDialog/)?.[1] ?? ''
        expect(editPage).not.toContain('DBState.db.modules[editModuleIndex] = tempModule')
        expect(editPage).not.toContain('notifySuccess(language.moduleUpdated)')
        expect(editPage).toContain('{language.download}')
        expect(editPage).toContain('{language.convertToCharacter}')
        expect(editPage.match(/class="module-editor-action"/g)).toHaveLength(2)
        expect(styleRule(modules, '.module-editor-actions')).toContain('justify-content: center')
        const action = styleRule(modules, '.module-editor-action')
        expect(action).toContain('min-height: 3rem')
        expect(action).toContain('padding: .72rem 1.15rem')
        expect(action).toContain('background: color-mix(in srgb, var(--risu-theme-primary) 62%, var(--risu-theme-bgcolor))')
    })

    test('syncs plugin actions to the same bordered column layout', () => {
        expect(plugins).toContain('class="plugin-action-column"')
        expect(plugins).toContain('class="plugin-action-column plugin-action-column--end"')
        expect(plugins).toContain('plugin-activation-icon--active')
        expect(plugins).toMatch(/class="plugin-action-column plugin-action-column--end"[\s\S]*?data-plugin-code-editor=\{plugin\.name\}[\s\S]*?variant="destructive"/)
    })

    test('renders folder name and count above a dedicated action row', () => {
        expect(organizer).toContain('class="collection-folder-summary')
        expect(organizer).toContain('class="collection-folder-actions')
        expect(organizer).not.toContain('group-hover:hidden')
        expect(styleRule(organizer, '.collection-folder')).toContain('flex-direction: column')
        expect(styleRule(organizer, '.collection-folder-actions')).toContain('width: 100%')
    })

    test.each([
        ['module', modules],
        ['plugin', plugins],
    ])('keeps the %s header and actions within their available pane', (kind, source) => {
        for (const part of ['header', 'actions']) {
            const className = `${kind}-item-${part}`
            expect(source).toMatch(new RegExp(`class="${className}(?: |")`))
            const rule = styleRule(source, `.${className}`)
            expect(rule).toMatch(/display:\s*flex/)
            expect(rule).toMatch(kind === 'module' ? /flex-wrap:\s*nowrap/ : /flex-wrap:\s*wrap/)
            expect(rule).toMatch(/min-width:\s*0/)
        }
        expect(styleRule(source, `.${kind}-item-actions`)).toMatch(/max-width:\s*100%/)
    })

    test.each([
        ['module', modules],
        ['plugin', plugins],
    ])('wraps long unbroken %s names without displacing actions', (kind, source) => {
        const className = `${kind}-item-title`
        expect(source).toMatch(new RegExp(`class="${className}(?: |")`))
        const rule = styleRule(source, `.${className}`)
        expect(rule).toMatch(/min-width:\s*0/)
        expect(rule).toMatch(/overflow-wrap:\s*anywhere/)
    })

    test('keeps long module descriptions within the item width', () => {
        expect(modules).toContain('class="module-item-description"')
        expect(styleRule(modules, '.module-item-description')).toMatch(/overflow-wrap:\s*anywhere/)
    })

    test('allows plugin argument labels and divider text to wrap', () => {
        const argumentsRule = styleRule(plugins, '.plugin-arguments')
        expect(argumentsRule).toMatch(/min-width:\s*0/)
        expect(argumentsRule).toMatch(/overflow-wrap:\s*anywhere/)
        expect(plugins).toContain('class="plugin-argument-divider ')
        expect(styleRule(plugins, '.plugin-argument-divider')).toMatch(/min-width:\s*0/)
        expect(plugins).not.toContain('text-nowrap')
    })

    test('constrains every plugin argument control to the pane width', () => {
        for (const component of ['SelectInput', 'TextAreaInput', 'TextInput', 'NumberInput', 'CheckInput']) {
            const controls = [...plugins.matchAll(new RegExp(`<${component}\\s+([^]*?)(?:\\/>|>)`, 'g'))]
            expect(controls.length).toBeGreaterThan(0)
            for (const [, attributes] of controls) {
                expect(attributes).toMatch(/className="[^"]*min-w-0[^"]*w-full[^"]*max-w-full/)
            }
        }
    })
})
