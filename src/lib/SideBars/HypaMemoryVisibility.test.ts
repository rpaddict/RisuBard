import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, test } from 'vitest'

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')

describe('HypaMemory modal entry visibility', () => {
    test.each([
        'src/lib/ChatScreens/DefaultChatScreen.svelte',
        'src/lib/SideBars/CharConfig.svelte',
    ])('%s honors the menu visibility preference', (path) => {
        expect(source(path)).toContain(
            '{#if DBState.db.showMenuHypaMemoryModal && DBState.db.hypaV3}',
        )
    })

    test('the sidebar HypaMemory toggle honors the same visibility preference', () => {
        const toggles = source('src/lib/SideBars/Toggles.svelte')

        expect(toggles.match(/DBState\.db\.showMenuHypaMemoryModal && DBState\.db\.hypaV3/g)).toHaveLength(2)
    })
})
