// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount, tick, unmount } from 'svelte'
import { writable } from 'svelte/store'
import type { PromptItem } from 'src/ts/process/prompt'
import PromptV2BlockEditor from './PromptV2BlockEditor.svelte'

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
        },
    },
    selIdState: { selId: 0 },
    selectedCharID: writable(0),
}) as typeof import('src/ts/stores.svelte'))

let mounted: ReturnType<typeof mount> | undefined

afterEach(async () => {
    if (mounted) await unmount(mounted)
    mounted = undefined
    vi.useRealTimers()
    document.body.replaceChildren()
    localStorage.clear()
})

describe('Prompt V2 block visual editor', () => {
    it('replaces the currently selected search match instead of the first body match', async () => {
        const item: PromptItem = {
            type: 'plain', type2: 'normal', role: 'system', name: 'Block', text: 'Alpha alpha ALPHA',
        }
        const onReplace = vi.fn()
        mounted = mount(PromptV2BlockEditor, {
            target: document.body,
            props: {
                item,
                definitions: [],
                previewValues: {},
                onReplace,
                onOpenToggleSetup: vi.fn(),
            },
        })
        await tick()
        const editor = mounted as unknown as {
            findInBody(search: string): Promise<void>
            replaceCurrentBodyMatch(search: string, replacement: string): boolean
        }

        await editor.findInBody('alpha')
        await editor.findInBody('alpha')
        expect(editor.replaceCurrentBodyMatch('alpha', 'Beta')).toBe(true)
        expect(onReplace.mock.lastCall?.[0].text).toBe('Alpha Beta ALPHA')
    })

    it('reveals an exact body range and restores source and visual scroll positions', async () => {
        const item: PromptItem = {
            type: 'plain', type2: 'normal', role: 'system', name: 'Block',
            text: 'First line\nUse {{getglobalvar::toggle_enabled}} here.\nLast line',
        }
        const onScrollTopChange = vi.fn()
        mounted = mount(PromptV2BlockEditor, {
            target: document.body,
            props: {
                item,
                definitions: [],
                previewValues: {},
                scrollTop: 76,
                onScrollTopChange,
                onReplace: vi.fn(),
                onOpenToggleSetup: vi.fn(),
            },
        })
        await tick()
        const editor = mounted as unknown as {
            revealBodyRange(start: number, end: number): Promise<void>
        }
        const start = item.text.indexOf('toggle_enabled')
        const body = document.querySelector<HTMLTextAreaElement>('.prompt-body-field')!
        expect(body.scrollTop).toBe(76)

        await editor.revealBodyRange(start, start + 'toggle_enabled'.length)
        expect(body.selectionStart).toBe(start)
        expect(body.selectionEnd).toBe(start + 'toggle_enabled'.length)

        body.scrollTop = 118
        body.dispatchEvent(new Event('scroll'))
        expect(onScrollTopChange).toHaveBeenLastCalledWith(118)

        document.querySelectorAll<HTMLButtonElement>('.editor-mode-tabs button')[1].click()
        await tick()
        const visual = document.querySelector<HTMLElement>('[data-cbs-document]')!
        expect(visual.scrollTop).toBe(118)
        await editor.revealBodyRange(start, start + 'toggle_enabled'.length)
        expect(document.querySelector('.prompt-body-field')).toBeNull()
        expect(document.querySelector('[data-cbs-document]')).not.toBeNull()
        visual.scrollTop = 164
        visual.dispatchEvent(new Event('scroll'))
        expect(onScrollTopChange).toHaveBeenLastCalledWith(164)
    })

    it('debounces visual body commits and flushes the latest text on blur', async () => {
        vi.useFakeTimers()
        const item: PromptItem = {
            type: 'plain', type2: 'normal', role: 'system', name: 'Block', text: 'Body',
        }
        const onReplace = vi.fn()
        mounted = mount(PromptV2BlockEditor, {
            target: document.body,
            props: {
                item,
                definitions: [],
                previewValues: {},
                onReplace,
                onOpenToggleSetup: vi.fn(),
            },
        })
        await tick()

        document.querySelectorAll<HTMLButtonElement>('.editor-mode-tabs button')[1].click()
        await tick()
        const body = document.querySelector<HTMLTextAreaElement>('[data-cbs-body]')!
        body.value = 'Body updated'
        body.dispatchEvent(new Event('input', { bubbles: true }))
        await tick()

        expect(onReplace).not.toHaveBeenCalled()
        await vi.advanceTimersByTimeAsync(400)
        body.value = 'Body updated twice'
        body.dispatchEvent(new Event('input', { bubbles: true }))
        await tick()
        await vi.advanceTimersByTimeAsync(749)
        expect(onReplace).not.toHaveBeenCalled()
        await vi.advanceTimersByTimeAsync(1)
        expect(onReplace).toHaveBeenCalledTimes(1)
        expect(onReplace.mock.lastCall?.[0].text).toBe('Body updated twice')

        body.value = 'Body updated again'
        body.dispatchEvent(new Event('input', { bubbles: true }))
        await tick()
        expect(onReplace).toHaveBeenCalledTimes(1)
        body.dispatchEvent(new FocusEvent('blur', { bubbles: true }))
        await tick()
        expect(onReplace).toHaveBeenCalledTimes(2)
        expect(onReplace.mock.lastCall?.[0].text).toBe('Body updated again')
    })

    it('edits the block name inline and keeps editor modes at the right edge of the toolbar', async () => {
        const item: PromptItem = {
            type: 'plain', type2: 'normal', role: 'system', name: 'Block', text: 'Body',
        }
        const onReplace = vi.fn()
        mounted = mount(PromptV2BlockEditor, {
            target: document.body,
            props: {
                item,
                definitions: [],
                previewValues: {},
                onReplace,
                onOpenToggleSetup: vi.fn(),
            },
        })
        await tick()

        document.querySelector<HTMLButtonElement>('[data-prompt-v2-name]')!.click()
        await tick()
        const nameInput = document.querySelector<HTMLInputElement>('[data-prompt-v2-name-input]')!
        nameInput.value = 'Renamed block'
        nameInput.dispatchEvent(new Event('input', { bubbles: true }))
        nameInput.dispatchEvent(new FocusEvent('blur', { bubbles: true }))
        await tick()
        expect(onReplace.mock.lastCall?.[0].name).toBe('Renamed block')
        expect(document.querySelectorAll('[data-prompt-v2-header-fields] select')).toHaveLength(3)
        const toolbar = document.querySelector('.editor-toolbar')!
        expect(toolbar.lastElementChild?.classList.contains('editor-mode-tabs')).toBe(true)
        expect(toolbar.textContent).not.toMatch(/블록 설정|Block settings/)
        expect(document.querySelector('[data-prompt-v2-block-settings]')).toBeNull()
    })

    it('applies conditional preview text state to the visual editor', async () => {
        const item: PromptItem = {
            type: 'plain',
            type2: 'normal',
            role: 'system',
            name: 'Conditional block',
            text: 'Always\n{{#if {{equal::{{getglobalvar::toggle_enabled}}::1}}}}\nConditional\n{{/if}}\nTail',
        }
        mounted = mount(PromptV2BlockEditor, {
            target: document.body,
            props: {
                item,
                definitions: [{
                    key: 'toggle_enabled', rawKey: 'enabled', label: '활성화', type: 'switch', options: [],
                }],
                previewValues: { toggle_enabled: '0' },
                onReplace: vi.fn(),
                onOpenToggleSetup: vi.fn(),
            },
        })
        await tick()

        document.querySelectorAll<HTMLButtonElement>('.editor-mode-tabs button')[1].click()
        await tick()
        const conditional = Array.from(document.querySelectorAll<HTMLTextAreaElement>('[data-cbs-body]'))
            .find(field => field.value.includes('Conditional'))!
        expect(conditional.dataset.cbsPreviewState).toBe('inactive')
    })

    it('shows the native source text while the textarea is focused', async () => {
        const item: PromptItem = {
            type: 'plain',
            type2: 'normal',
            role: 'system',
            name: 'Conditional block',
            text: 'Before {{#if {{equal::{{getglobalvar::toggle_enabled}}::1}}}}inside{{/if}} after',
        }
        mounted = mount(PromptV2BlockEditor, {
            target: document.body,
            props: {
                item,
                definitions: [{
                    key: 'toggle_enabled', rawKey: 'enabled', label: '활성화', type: 'switch', options: [],
                }],
                previewValues: { toggle_enabled: '1' },
                onReplace: vi.fn(),
                onOpenToggleSetup: vi.fn(),
            },
        })
        await tick()

        document.querySelectorAll<HTMLButtonElement>('.editor-mode-tabs button')[0].click()
        await tick()
        const body = document.querySelector<HTMLTextAreaElement>('.prompt-body-field')!
        expect(body.classList.contains('prompt-body-field--preview')).toBe(true)
        expect(document.querySelector('.prompt-body-preview')).not.toBeNull()

        body.focus()
        await tick()

        expect(body.classList.contains('prompt-body-field--preview')).toBe(false)
        expect(document.querySelector('.prompt-body-preview')).toBeNull()
    })

    it('wraps the selected visual text with a condition and remembers the mode', async () => {
        const item: PromptItem = {
            type: 'plain', type2: 'normal', role: 'system', name: 'Block', text: 'Before selected after',
        }
        const onReplace = vi.fn()
        mounted = mount(PromptV2BlockEditor, {
            target: document.body,
            props: {
                item,
                definitions: [{
                    key: 'toggle_enabled', rawKey: 'enabled', label: '활성화', type: 'switch', options: [],
                }],
                previewValues: { toggle_enabled: '0' },
                onReplace,
                onOpenToggleSetup: vi.fn(),
            },
        })
        await tick()

        const activation = Array.from(document.querySelectorAll<HTMLButtonElement>('button'))
            .find(button => button.textContent?.trim() === 'Activation' || button.textContent?.trim() === '활성화 조건')!
        activation.click()
        await tick()
        expect(document.querySelector('[role="dialog"][data-state="open"]')?.textContent).toMatch(/Activation|활성화 조건/)
        document.querySelector<HTMLButtonElement>('[role="dialog"][data-state="open"] button[aria-label="Close"]')?.click()
        await tick()

        const modeButtons = document.querySelectorAll<HTMLButtonElement>('.editor-mode-tabs button')
        modeButtons[1].click()
        await tick()
        const designer = Array.from(document.querySelectorAll<HTMLButtonElement>('button'))
            .find(button => button.textContent?.includes('조건문 디자이너') || button.textContent?.includes('Condition designer'))!
        designer.click()
        await tick()
        await vi.waitFor(() => expect(document.querySelector('[data-prompt-v2-syntax-palette]')).not.toBeNull())
        expect(localStorage.getItem('risubard:prompt-v2-editor-mode:v1')).toBe('visual')

        const body = document.querySelector<HTMLTextAreaElement>('[data-cbs-body]')!
        const start = body.value.indexOf('selected')
        body.focus()
        body.setSelectionRange(start, start + 'selected'.length)
        body.dispatchEvent(new Event('select', { bubbles: true }))
        await tick()

        const insert = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-prompt-v2-syntax-palette] button'))
            .find(button => button.textContent?.includes('선택 영역') || button.textContent?.includes('Wrap selection'))!
        insert.click()
        await tick()

        expect(onReplace).toHaveBeenCalled()
        expect(onReplace.mock.lastCall?.[0].text).toBe(
            'Before {{#if {{equal::{{getglobalvar::toggle_enabled}}::1}}}}\nselected\n{{/if}} after',
        )
        expect(document.querySelector('[data-prompt-v2-syntax-palette]')?.closest('[role="dialog"]')?.getAttribute('data-state')).toBe('closed')
    })
})
