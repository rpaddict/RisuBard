import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')

describe('external edit mode sidebar integration', () => {
    it('places a Solar hourglass at the bottom of both expanded desktop menus', () => {
        const sidebar = read('src/lib/SideBars/Sidebar.svelte')
        const button = read('src/lib/SideBars/ExternalEditModeButton.svelte')
        const icons = read('src/lib/UI/Icons/SolarBoldIcon.svelte')

        expect(sidebar).toContain("import ExternalEditModeButton from './ExternalEditModeButton.svelte'")
        expect(sidebar.match(/<ExternalEditModeButton \/>/g)).toHaveLength(2)
        expect(button).toContain('data-external-edit-mode-button')
        expect(button).toContain('<SolarBoldIcon name="hourglass"')
        expect(button).toContain('ariaLabel=')
        expect(button).toContain('pressed={externalEditMode.active}')
        expect(icons).toContain("| 'hourglass'")
    })

    it('connects the button to pause, status, and finish transports', () => {
        const button = read('src/lib/SideBars/ExternalEditModeButton.svelte')
        const globalApi = read('src/ts/globalApi.svelte.ts')
        const autoStorage = read('src/ts/storage/autoStorage.ts')
        const nodeStorage = read('src/ts/storage/nodeStorage.ts')

        expect(button).toContain('toggleExternalEditMode')
        expect(globalApi).toContain('export let externalEditMode = $state')
        expect(globalApi).toContain('if (externalEditMode.active)')
        expect(autoStorage).toContain('getExternalEditModeStatus()')
        expect(autoStorage).toContain('startExternalEditMode()')
        expect(autoStorage).toContain('finishExternalEditMode()')
        expect(nodeStorage).toContain("'/api/external-edit/status'")
        expect(nodeStorage).toContain("'/api/external-edit/start'")
        expect(nodeStorage).toContain("'/api/external-edit/finish'")
    })
})
