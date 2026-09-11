// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount, tick, unmount } from 'svelte'
import { writable } from 'svelte/store'
import PromptV2ToggleEditor from './PromptV2ToggleEditor.svelte'

vi.mock(import('src/ts/storage/database.svelte'), () => ({
    appVer: '1234.5.67',
    getCurrentCharacter: () => ({}),
    getDatabase: () => ({}),
}) as typeof import('src/ts/storage/database.svelte'))

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    aiWatermarkingLawApplies: () => false,
    getFileSrc: () => Promise.resolve(''),
}))

vi.mock(import('src/ts/stores.svelte'), () => ({
    DBState: {
        db: {
            characters: [{ chatPage: 0, chats: [{ scriptstate: {} }], defaultVariables: '' }],
            globalChatVariables: {},
            templateDefaultVariables: '',
            showInputActionBar: false,
        },
    },
    disableHighlight: writable(false),
    popUpEditorStore: { value: '', mode: 'default', language: 'plaintext', open: false },
    selIdState: { selId: 0 },
    selectedCharID: writable(0),
}) as typeof import('src/ts/stores.svelte'))

let mounted: ReturnType<typeof mount> | undefined

afterEach(async () => {
    if (mounted) await unmount(mounted)
    mounted = undefined
    document.body.replaceChildren()
})

describe('Prompt V2 toggle editor', () => {
    it('unfolds a variable into counted prompt usage buttons', async () => {
        const onOpenUsage = vi.fn()
        const usages = [{
            blockIndex: 1,
            blockName: 'System rules',
            line: 12,
            start: 40,
            end: 54,
            preview: '…{{getglobalvar::toggle_enabled}} around…',
        }, {
            blockIndex: 3,
            blockName: 'Afterword',
            line: 2,
            start: 8,
            end: 22,
            preview: 'Use toggle_enabled here.',
        }]
        mounted = mount(PromptV2ToggleEditor, {
            target: document.body,
            props: {
                view: 'library',
                template: 'enabled=Enabled',
                usages: { toggle_enabled: usages },
                onOpenUsage,
            },
        })
        await tick()

        const disclosure = document.querySelector<HTMLButtonElement>('[data-prompt-v2-variable="toggle_enabled"]')!
        expect(disclosure.getAttribute('aria-expanded')).toBe('false')
        expect(disclosure.textContent).toContain('2')
        disclosure.click()
        await tick()

        expect(disclosure.getAttribute('aria-expanded')).toBe('true')
        const links = document.querySelectorAll<HTMLButtonElement>('[data-prompt-v2-usage]')
        expect(links).toHaveLength(2)
        expect(links[0].textContent).toContain('System rules')
        expect(links[0].textContent).toContain('12')
        expect(links[0].textContent).toContain('toggle_enabled')
        links[0].click()
        expect(onOpenUsage).toHaveBeenCalledWith(usages[0])
    })

    it('restores and reports the toggle-source scroll position', async () => {
        const onScrollTopChange = vi.fn()
        mounted = mount(PromptV2ToggleEditor, {
            target: document.body,
            props: {
                view: 'source',
                template: Array.from({ length: 30 }, (_, index) => `key${index}=Value ${index}`).join('\n'),
                scrollTop: 84,
                onScrollTopChange,
            },
        })
        await tick()

        const editor = document.querySelector<HTMLElement>('[contenteditable="true"]')!
        expect(editor.scrollTop).toBe(84)
        editor.scrollTop = 132
        editor.dispatchEvent(new Event('scroll'))
        expect(onScrollTopChange).toHaveBeenLastCalledWith(132)
    })
})
