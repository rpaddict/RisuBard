// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount, tick, unmount } from 'svelte'
import CbsConditionView from './CbsConditionView.svelte'

let mounted: ReturnType<typeof mount> | undefined

afterEach(async () => {
    if (mounted) await unmount(mounted)
    mounted = undefined
    document.body.replaceChildren()
    vi.restoreAllMocks()
})

describe('CBS visual condition editor', () => {
    it('encloses nested branches and reveals a collapsed body when focusing a source range', async () => {
        const source = 'Before{{#when::1}}Outer{{#if 1}}Inner{{/if}}{{:else}}Otherwise{{/when}}After'
        const onInput = vi.fn()
        mounted = mount(CbsConditionView, { target: document.body, props: { value: source, onInput, showVariableSidebar: false } })
        await tick()
        const blocks = document.querySelectorAll<HTMLDetailsElement>('[data-cbs-block]')
        expect(blocks).toHaveLength(2)
        expect(blocks[0].contains(blocks[1])).toBe(true)
        const fields = [...document.querySelectorAll<HTMLTextAreaElement>('[data-cbs-body]')]
        expect(fields.find(field => field.value === 'After')?.closest('[data-cbs-block]')).toBeNull()
        expect(fields.find(field => field.value === 'Otherwise')?.closest('[data-cbs-block]')).toBe(blocks[0])
        blocks[0].open = false
        blocks[1].open = false
        mounted.focusSelection(source.indexOf('Inner'), source.indexOf('Inner') + 5)
        expect(blocks[0].open && blocks[1].open).toBe(true)
        const inner = fields.find(field => field.value === 'Inner')!
        expect(document.activeElement).toBe(inner)
        expect(inner.selectionEnd - inner.selectionStart).toBe(5)
        inner.value = 'Changed'
        inner.dispatchEvent(new Event('input', { bubbles: true }))
        await tick()
        expect(onInput).toHaveBeenLastCalledWith(source.replace('Inner', 'Changed'))
        expect(document.activeElement).toBe(inner)
    })

    it('labels boolean values only for declared switch variables', async () => {
        mounted = mount(CbsConditionView, { target: document.body, props: {
            value: '{{#if {{equal::{{getglobalvar::switch}}::0}}}}A{{/if}}{{#if {{equal::{{getglobalvar::count}}::0}}}}B{{/if}}',
            switchVariables: ['switch'], onInput: vi.fn(), showVariableSidebar: false,
        } })
        await tick()
        const summaries = document.querySelectorAll('[data-cbs-summary]')
        expect(summaries[0].textContent).toContain('Off')
        expect(summaries[1].textContent).toContain('"0"')
        expect(summaries[1].textContent).not.toContain('Off')
    })

    it('shows Prompt V2 toggle labels and edits only the selected body span', async () => {
        const opening = '{{#if_pure {{? {{? {{getglobalvar::toggle_a}}>0}} || {{? {{getglobalvar::toggle_b}}>0}}=1}}}}'
        const source = `Before\n${opening}\nConditional body\n{{/if}}\nAfter`
        const onInput = vi.fn()
        const onSelectionChange = vi.fn()

        mounted = mount(CbsConditionView, {
            target: document.body,
            props: {
                value: source,
                onInput,
                onSelectionChange,
                showVariableSidebar: false,
                variableLabels: { toggle_a: '첫 번째 토글', toggle_b: '두 번째 토글' },
            },
        })
        await tick()
        await vi.waitFor(() => expect(document.querySelector('[data-cbs-summary]')).not.toBeNull())

        const summary = document.querySelector('[data-cbs-summary]')!
        expect(summary.textContent).toContain('[첫 번째 토글]')
        expect(summary.textContent).toContain('OR')
        expect(summary.textContent).toContain('[두 번째 토글]')
        expect(document.querySelector('[data-cbs-variable-sidebar]')).toBeNull()

        const body = Array.from(document.querySelectorAll<HTMLTextAreaElement>('[data-cbs-body]'))
            .find(field => field.value.includes('Conditional body'))!
        const start = body.value.indexOf('Conditional')
        body.focus()
        body.setSelectionRange(start, start + 'Conditional'.length)
        body.dispatchEvent(new Event('select', { bubbles: true }))
        expect(onSelectionChange).toHaveBeenLastCalledWith({
            start: source.indexOf('Conditional'),
            end: source.indexOf('Conditional') + 'Conditional'.length,
        })

        body.value = body.value.replace('Conditional body', 'Edited body')
        body.dispatchEvent(new Event('input', { bubbles: true }))
        await tick()
        expect(onInput).toHaveBeenLastCalledWith(source.replace('Conditional body', 'Edited body'))
        expect(onInput.mock.lastCall?.[0]).toContain(opening)
    })

    it('warns when a condition stays as lossless raw syntax', async () => {
        mounted = mount(CbsConditionView, {
            target: document.body,
            props: {
                value: '{{#if {{unknown::a::b}}}}Body{{/if}}',
                onInput: vi.fn(),
                showVariableSidebar: false,
            },
        })
        await tick()

        expect(document.querySelector('[data-cbs-warning]')).not.toBeNull()
        expect(document.querySelector('[data-cbs-summary]')?.textContent).toContain('{{unknown::a::b}}')
    })

    it('deletes or cuts a complete nested condition block', async () => {
        const source = 'Before{{#if 1}}Outer{{#if 2}}Inner{{/if}}Tail{{/if}}After'
        const onInput = vi.fn()
        const writeText = vi.fn().mockResolvedValue(undefined)
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
        mounted = mount(CbsConditionView, {
            target: document.body,
            props: { value: source, onInput, showVariableSidebar: false, allowBlockActions: true },
        })
        await tick()

        const cutButtons = document.querySelectorAll<HTMLButtonElement>('[data-cbs-cut-condition]')
        expect(cutButtons).toHaveLength(2)
        cutButtons[1].click()
        await tick()
        expect(writeText).toHaveBeenCalledWith('{{#if 2}}Inner{{/if}}')
        expect(onInput).toHaveBeenLastCalledWith('Before{{#if 1}}OuterTail{{/if}}After')

        await unmount(mounted)
        mounted = mount(CbsConditionView, {
            target: document.body,
            props: { value: source, onInput, showVariableSidebar: false, allowBlockActions: true },
        })
        await tick()
        document.querySelector<HTMLButtonElement>('[data-cbs-delete-condition]')!.click()
        await tick()
        expect(onInput).toHaveBeenLastCalledWith('BeforeAfter')
    })

    it('drags one complete condition after another without breaking either block', async () => {
        const source = 'A{{#if 1}}One{{/if}}B{{#if 2}}Two{{/if}}C'
        const onInput = vi.fn()
        mounted = mount(CbsConditionView, {
            target: document.body,
            props: { value: source, onInput, showVariableSidebar: false, allowBlockActions: true },
        })
        await tick()

        const blocks = document.querySelectorAll<HTMLElement>('[data-cbs-block]')
        expect(blocks[0].getAttribute('draggable')).toBe('true')
        blocks[0].dispatchEvent(new Event('dragstart', { bubbles: true }))
        const drop = new Event('drop', { bubbles: true, cancelable: true })
        Object.defineProperty(drop, 'clientY', { value: 1 })
        blocks[1].dispatchEvent(drop)
        await tick()

        expect(onInput).toHaveBeenLastCalledWith('AB{{#if 2}}Two{{/if}}{{#if 1}}One{{/if}}C')
    })

    it('focuses a visual condition heading when a revealed range is inside its expression', async () => {
        const source = 'Before{{#if {{equal::{{getglobalvar::toggle_enabled}}::1}}}}Body{{/if}}After'
        mounted = mount(CbsConditionView, {
            target: document.body,
            props: { value: source, onInput: vi.fn(), showVariableSidebar: false, allowBlockActions: true },
        })
        await tick()

        const start = source.indexOf('toggle_enabled')
        mounted.focusSelection(start, start + 'toggle_enabled'.length)
        expect(document.activeElement).toBe(document.querySelector('[data-cbs-condition-heading]'))
    })
})
