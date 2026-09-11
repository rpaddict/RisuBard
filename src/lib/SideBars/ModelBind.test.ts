import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, test } from 'vitest'

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')

describe('sidebar model mode persistence', () => {
    test('uses the last selected mode when creating a new chat', () => {
        const modelBind = read('src/lib/SideBars/ModelBind.svelte')
        const chatList = read('src/lib/SideBars/SideChatList.svelte')

        expect(modelBind).toContain(
            'if (!bindingTarget) DBState.db.useModelPresetByDefault = target.useModelPreset;'
        )
        expect(chatList).toContain('...newChatModelDefaults(chara, activeChat)')
    })

    test('saving a preset binding as default also makes preset mode the new-chat default', () => {
        const modelBind = read('src/lib/SideBars/ModelBind.svelte')

        expect(modelBind).toMatch(
            /async function confirmSetAsDefault[\s\S]*DBState\.db\.useModelPresetByDefault = true;[\s\S]*DBState\.db\.defaultModelBinding/
        )
    })
})
