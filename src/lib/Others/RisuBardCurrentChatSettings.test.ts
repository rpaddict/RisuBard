// @vitest-environment happy-dom

import { afterEach, describe, expect, test } from 'vitest'
import { mount, tick, unmount } from 'svelte'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Chat } from 'src/ts/storage/database.svelte'
import type { RisuBardChatSettings } from 'src/ts/risubard/risuBardSettings'
import RisuBardCurrentChatSettings from './RisuBardCurrentChatSettings.svelte'

let mounted: ReturnType<typeof mount> | undefined

afterEach(async () => {
    if (mounted) await unmount(mounted)
    mounted = undefined
    document.body.replaceChildren()
})
function chatWithLongMessages(): Chat {
    return {
        id: 'chat',
        name: 'test',
        note: '',
        localLore: [],
        message: Array.from({ length: 120 }, (_, index) => ({
            role: index % 2 === 0 ? 'user' as const : 'char' as const,
            data: '가'.repeat(1_200),
        })),
        risuBardSettings: {
            risuBardResponseMessageCount: 4,
            risuBardBardChanEnabled: true,
            risuBardBardChanModelMode: 'model',
        },
    }
}

describe('RisuBardCurrentChatSettings', () => {
    test('promotes the current chat values to global settings', async () => {
        const chat = chatWithLongMessages()
        const global: RisuBardChatSettings = {
            risuBardResponseMessageCount: 12,
            risuBardBardChanEnabled: false,
            risuBardBardChanModelMode: 'memory',
        }
        mounted = mount(RisuBardCurrentChatSettings, {
            target: document.body,
            props: { chat, global },
        })

        document.querySelector<HTMLButtonElement>(
            '[data-apply-chat-settings-global]'
        )!.click()
        await tick()

        expect(global.risuBardResponseMessageCount).toBe(4)
        expect(global.risuBardBardChanEnabled).toBe(true)
        expect(global.risuBardBardChanModelMode).toBe('model')
        expect(chat.risuBardSettings).toBeUndefined()
    })

    test('gives every visible option contextual help without step validation hints', () => {
        const chat = chatWithLongMessages()
        mounted = mount(RisuBardCurrentChatSettings, {
            target: document.body,
            props: { chat, global: {} },
        })

        const fields = [...document.querySelectorAll('[data-chat-setting-field]')]
        const helpButtons = [...document.querySelectorAll('[data-chat-setting-help]')]
        expect(fields).toHaveLength(19)
        expect(helpButtons).toHaveLength(fields.length)
        expect(document.querySelector(
            '[data-chat-setting-field="risuBardAnalysisExcludeUserMessages"]'
        )).not.toBeNull()
        expect(document.querySelector<HTMLSelectElement>(
            '[data-chat-setting-field="risuBardBardChanModelMode"] select'
        )?.value).toBe('model')
        const responseHelp = helpButtons.find((button) =>
            button.getAttribute('data-chat-setting-help')
                === 'risuBardResponseMessageCount'
        )
        expect(responseHelp?.getAttribute('data-help-text')).toContain('2~3개')
        for (const input of document.querySelectorAll('input[type="number"]')) {
            expect(input.hasAttribute('step')).toBe(false)
        }
    })

    test('uses a compact container-responsive grid and a resizable popover', () => {
        const settingsSource = readFileSync(resolve(
            process.cwd(), 'src/lib/Others/RisuBardCurrentChatSettings.svelte'
        ), 'utf8')
        const dockSource = readFileSync(resolve(
            process.cwd(), 'src/lib/Others/RisuBardMemoryWiki.svelte'
        ), 'utf8')

        expect(settingsSource).toMatch(
            /\.settings-grid\s*\{[^}]*grid-template-columns:\s*repeat\(3,/s
        )
        expect(settingsSource).toMatch(
            /@container\s+chat-settings\s*\(max-width:\s*48rem\)[\s\S]*repeat\(2,/s
        )
        expect(settingsSource).toMatch(
            /@container\s+chat-settings\s*\(max-width:\s*31rem\)[\s\S]*grid-template-columns:\s*1fr/s
        )
        expect(settingsSource).not.toMatch(/\.setting-field\s*\{[^}]*min-height:\s*4\.6rem/s)
        expect(dockSource).toMatch(
            /<ManagerResizeHandles[\s\S]*rightAnchored/s
        )
        expect(dockSource).toMatch(
            /<ManagerResizeHandles[\s\S]*shadowPreview/s
        )
        expect(dockSource).toMatch(
            /\.settings-popover\s*\{[^}]*width:\s*var\(--manager-width,\s*58rem\)/s
        )
    })
})
