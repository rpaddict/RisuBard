// @vitest-environment happy-dom

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, tick, unmount } from 'svelte'
import { createClassComponent } from 'svelte/legacy'
import { writable } from 'svelte/store'
import type { loreBook } from 'src/ts/storage/database.svelte'
import { languageEnglish } from 'src/lang/en'
import { languageKorean } from 'src/lang/ko'
import LoreBookWorkspace from './LoreBookWorkspace.svelte'
import LoreBookWorkspaceDialog from './LoreBookWorkspaceDialog.svelte'
import { createLorebookOwnerBinding } from './loreBookWorkspaceConnections'
import { clearLorebookWorkspaceSessions } from './loreBookWorkspaceSession'

const sortableMock = vi.hoisted(() => ({
    options: undefined as Record<string, any> | undefined,
    create: vi.fn(),
    instances: [] as Array<{ destroy: ReturnType<typeof vi.fn> }>,
}))

const operationMocks = vi.hoisted(() => ({
    applyBatchPatch: vi.fn(),
}))

const environmentMock = vi.hoisted(() => ({
    mobile: false,
    db: {
        disableMobileDragDrop: false,
        templateDefaultVariables: '',
        characters: [] as Array<{ chaId: string; name: string; chatPage: number; defaultVariables: string; chats: Array<{ id: string; name: string; scriptstate?: Record<string, string> }> }>,
    },
    listeners: new Set<(event: MediaQueryListEvent) => void>(),
    alertConfirm: vi.fn<(message: string) => Promise<boolean>>(async () => true),
    notifySuccess: vi.fn<(message: string) => void>(),
}))

vi.mock('sortablejs', () => ({
    default: {
        create: vi.fn((_element: HTMLElement, options: Record<string, any>) => {
            sortableMock.options = options
            sortableMock.create(_element, options)
            const instance = { destroy: vi.fn() }
            sortableMock.instances.push(instance)
            return instance
        }),
    },
}))

vi.mock('src/ts/lorebook/workspaceOperations', async (importOriginal) => {
    const actual = await importOriginal<typeof import('src/ts/lorebook/workspaceOperations')>()
    operationMocks.applyBatchPatch.mockImplementation(actual.applyBatchPatch)
    return { ...actual, applyBatchPatch: operationMocks.applyBatchPatch }
})

vi.mock('src/ts/stores.svelte', () => ({
    DBState: { db: environmentMock.db },
    selIdState: { selId: 0 },
    isTouchDevice: writable(false),
    selectedCharID: writable(0),
}))

vi.mock('src/ts/alert', () => ({
    alertConfirm: environmentMock.alertConfirm,
    notifySuccess: environmentMock.notifySuccess,
}))

const entry = (id: string, patch: Partial<loreBook> = {}): loreBook => ({
    id,
    key: id,
    secondkey: '',
    insertorder: 100,
    comment: id,
    content: `content:${id}`,
    mode: 'normal',
    alwaysActive: false,
    selective: false,
    ...patch,
})

let mounted: ReturnType<typeof mount> | undefined

function setMobileViewport(matches: boolean) {
    environmentMock.mobile = matches
    for (const listener of environmentMock.listeners) {
        listener({ matches } as MediaQueryListEvent)
    }
}

async function render(
    entries: loreBook[],
    props: Partial<{
        dragEnabled: boolean
        bardMode: boolean
        legacyDisabledBackups: Record<string, loreBook & { disabled?: boolean }>
        onChange: (next: loreBook[]) => void
        resolveChildLabel: (id: string) => string | undefined
        localActivation: {
            visible: boolean
            isActive: (entry: loreBook) => boolean
            onToggle: (entry: loreBook, active: boolean) => void
            onEntriesRemoved?: (ids: string[]) => void
        }
        scopeLabel: string
        scopeKey: string
    }> = {},
) {
    const target = document.body.appendChild(document.createElement('div'))
    const onChange = props.onChange ?? vi.fn()
    mounted = mount(LoreBookWorkspace, {
        target,
        props: {
            entries,
            scopeLabel: 'Character lore',
            onChange,
            ...props,
        },
    })
    await tick()
    return onChange
}

function click(selector: string) {
    const control = document.body.querySelector<HTMLElement>(selector)
    if (!control) throw new Error(`Missing control: ${selector}`)
    control.click()
}

function rect(top: number, bottom: number): DOMRect {
    return {
        top,
        bottom,
        height: bottom - top,
        left: 0,
        right: 200,
        width: 200,
        x: 0,
        y: top,
        toJSON: () => ({}),
    }
}

function deferred<T>() {
    let resolve!: (value: T) => void
    const promise = new Promise<T>((done) => { resolve = done })
    return { promise, resolve }
}

beforeEach(() => {
    clearLorebookWorkspaceSessions()
    environmentMock.mobile = false
    environmentMock.db.disableMobileDragDrop = false
    environmentMock.db.characters = []
    environmentMock.db.templateDefaultVariables = ''
    environmentMock.alertConfirm.mockResolvedValue(true)
    Object.defineProperty(window, 'matchMedia', {
        configurable: true,
        value: vi.fn((query: string) => ({
            media: query,
            get matches() {
                return query.includes('max-width')
                    ? environmentMock.mobile
                    : !environmentMock.mobile
            },
            onchange: null,
            addEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => {
                environmentMock.listeners.add(listener)
            },
            removeEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => {
                environmentMock.listeners.delete(listener)
            },
            addListener: () => undefined,
            removeListener: () => undefined,
            dispatchEvent: () => true,
        })),
    })
})

afterEach(async () => {
    if (mounted) await unmount(mounted)
    mounted = undefined
    document.body.replaceChildren()
    vi.clearAllMocks()
    sortableMock.options = undefined
    sortableMock.instances = []
    environmentMock.listeners.clear()
})

describe('LoreBookWorkspace', () => {
    it('shows Bard metadata controls instead of legacy activation controls for a Bard batch selection', async () => {
        const bardEntry = (id: string) => ({
            ...entry(id),
            bard: {
                sourceLegacyId: id,
                sourceHash: id,
                kind: 'other',
                activation: 'retrieve',
                aliases: [],
                tags: [],
                summary: '',
                links: [],
            },
        }) as any
        await render([bardEntry('a'), bardEntry('b')], { bardMode: true })

        document.body.querySelector<HTMLElement>('[data-lorebook-row="a"] .row-main')!.click()
        document.body.querySelector<HTMLElement>('[data-lorebook-row="b"] .row-main')!
            .dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }))
        await tick()

        expect(document.body.querySelector('[data-bard-lore-batch-activation]')).not.toBeNull()
        expect(document.body.querySelector('[data-bard-lore-batch-kind]')).not.toBeNull()
        expect(document.body.querySelector('[data-bard-lore-batch-values]')).not.toBeNull()
        expect(document.body.querySelector('[data-lorebook-batch-always-active]')).toBeNull()
        expect(document.body.querySelector('[data-lorebook-batch-selective]')).toBeNull()
        expect(document.body.querySelector('[data-lorebook-batch-regex]')).toBeNull()
    })

    it('applies Bard activation, kind, aliases, and tags to every selected Bard entry', async () => {
        const onChange = vi.fn()
        const bardEntry = (id: string, alias: string) => ({
            ...entry(id),
            bard: {
                sourceLegacyId: id,
                sourceHash: id,
                kind: 'other',
                activation: 'retrieve',
                aliases: [alias],
                tags: ['existing'],
                summary: '',
                links: [],
            },
        }) as any
        await render([bardEntry('a', 'alpha'), bardEntry('b', 'beta')], { bardMode: true, onChange })

        document.body.querySelector<HTMLElement>('[data-lorebook-row="a"] .row-main')!.click()
        document.body.querySelector<HTMLElement>('[data-lorebook-row="b"] .row-main')!
            .dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }))
        await tick()

        click('[data-bard-lore-batch-activation]')
        await tick()
        click('[data-bard-lore-activation-option="required"]')
        await tick()
        const kind = document.body.querySelector<HTMLSelectElement>('[data-bard-lore-batch-kind]')!
        kind.value = 'system'
        kind.dispatchEvent(new Event('change', { bubbles: true }))
        await tick()
        const values = document.body.querySelector<HTMLInputElement>('[data-bard-lore-batch-values]')!
        values.value = 'shared, common'
        values.dispatchEvent(new Event('input', { bubbles: true }))
        click('[data-bard-lore-batch-add-aliases]')
        await tick()
        click('[data-bard-lore-batch-add-tags]')
        await tick()

        const changed = onChange.mock.calls.at(-1)?.[0] as any[]
        expect(changed.map((item) => item.bard)).toEqual([
            expect.objectContaining({ activation: 'required', kind: 'system', aliases: ['alpha', 'shared', 'common'], tags: ['existing', 'shared', 'common'] }),
            expect.objectContaining({ activation: 'required', kind: 'system', aliases: ['beta', 'shared', 'common'], tags: ['existing', 'shared', 'common'] }),
        ])
    })

    it('edits Bard Lore activation, keys, and metadata without showing legacy activation controls', async () => {
        const onChange = vi.fn()
        const bardEntry = {
            ...entry('mall'),
            bard: {
                sourceLegacyId: 'mall',
                sourceHash: 'hash',
                kind: 'location',
                activation: 'retrieve',
                aliases: ['폴로니안 몰'],
                tags: ['시내'],
                summary: '데이트 장소',
                links: [],
            },
        }
        await render([bardEntry], { bardMode: true, onChange })
        click('[data-lorebook-row="mall"] [data-lorebook-open]')
        await tick()

        expect(document.body.querySelector('[data-bard-lore-activation]')).not.toBeNull()
        expect(document.body.querySelector('[data-bard-lore-tags]')).not.toBeNull()
        expect(document.body.querySelector('[data-bard-lore-injection]')).not.toBeNull()
        expect(document.body.querySelector('[data-bard-lore-add-facet]')).not.toBeNull()
        expect(document.body.querySelector('[data-lorebook-activation-percent]')).toBeNull()
        expect([...document.body.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('[data-lorebook-field="key"], [data-lorebook-field="secondkey"]')]
            .every((field) => !field.disabled)).toBe(true)
        expect(document.body.querySelectorAll('[data-bard-lore-help]')).toHaveLength(7)
        const workspaceSource = readFileSync(resolve('src/lib/SideBars/LoreBook/LoreBookWorkspace.svelte'), 'utf8')
        const helpButtonRule = workspaceSource.match(/\.lore-state-rail \.bard-field-heading button\s*\{([^}]*)\}/)?.[1]
        expect(helpButtonRule).toBeDefined()
        expect(helpButtonRule!).toContain('width: 1.25rem')
        expect(helpButtonRule!).toContain('cursor: help')

        click('[data-bard-lore-activation]')
        await tick()
        click('[data-bard-lore-activation-option="required"]')
        await tick()

        const injection = document.body.querySelector<HTMLSelectElement>('[data-bard-lore-injection]')!
        injection.value = 'index-only'
        injection.dispatchEvent(new Event('change', { bubbles: true }))
        await tick()
        click('[data-bard-lore-add-facet]')
        await tick()
        const facetKey = document.body.querySelector<HTMLInputElement>('[data-bard-lore-facet-key="0"]')!
        facetKey.value = 'region'
        facetKey.dispatchEvent(new Event('change', { bubbles: true }))
        await tick()
        const facetValue = document.body.querySelector<HTMLInputElement>('[data-bard-lore-facet-value="0"]')!
        facetValue.value = 'city'
        facetValue.dispatchEvent(new Event('change', { bubbles: true }))
        await tick()

        expect((onChange.mock.calls.at(-1)?.[0] as any[])[0].bard).toMatchObject({
            activation: 'required',
            injection: 'index-only',
            facets: [{ key: 'region', value: 'city', aliases: [] }],
        })
    })

    it('shows a left-side tooltip for every Grimoire activation option', async () => {
        const bardEntry = {
            ...entry('mall'),
            bard: {
                sourceLegacyId: 'mall',
                sourceHash: 'hash',
                kind: 'location',
                activation: 'retrieve',
                aliases: ['폴로니안 몰'],
                tags: ['시내'],
                summary: '데이트 장소',
                links: [],
            },
        }
        await render([bardEntry], { bardMode: true })
        click('[data-lorebook-row="mall"] [data-lorebook-open]')
        await tick()
        click('[data-bard-lore-activation]')
        await tick()

        const options = [...document.body.querySelectorAll<HTMLElement>(
            '[data-bard-lore-activation-option]'
        )]
        expect(options).toHaveLength(4)
        expect(options.map((option) => option.dataset.tooltipSide))
            .toEqual(['left', 'left', 'left', 'left'])
        const retrieveOption = options.find((option) =>
            option.dataset.bardLoreActivationOption === 'retrieve'
        )
        expect(retrieveOption?.getAttribute('aria-label')).toContain(
            languageEnglish.lorebookWorkspace.bardGuideRetrieveBody
        )
        expect((retrieveOption?.querySelector('.activation-option') as any)?._tippy
            ?.props.placement).toBe('left')
        options[2].click()
        await tick()
    })

    it('creates an explicit non-retrieving Bard link without linking an entry to itself', async () => {
        const onChange = vi.fn()
        const bard = (id: string) => ({
            ...entry(id),
            bard: {
                sourceLegacyId: id,
                sourceHash: id,
                kind: 'other',
                activation: 'retrieve',
                aliases: [],
                tags: [],
                summary: '',
                links: [],
            },
        })
        await render([bard('source'), bard('target')], { bardMode: true, onChange })
        click('[data-lorebook-row="source"] [data-lorebook-open]')
        await tick()
        const linksButton = document.body.querySelector<HTMLButtonElement>('[data-bard-lore-links-open]')!
        expect(linksButton.textContent).toContain('0')
        expect(document.body.querySelector('[data-bard-lore-links-dialog]')).toBeNull()
        linksButton.click()
        await tick()
        expect(document.body.querySelector('[data-bard-lore-links-dialog]')).not.toBeNull()
        click('[data-bard-lore-add-link]')
        await tick()

        const retrieval = document.body.querySelector<HTMLSelectElement>('[data-bard-lore-link-retrieval]')!
        expect([...retrieval.options].map((option) => option.value)).toEqual(['none', 'supporting', 'discoverable', 'ambient'])

        const changed = onChange.mock.calls.at(-1)?.[0] as any[]
        expect(changed[0].bard.links).toEqual([
            { targetId: 'target', relation: '', retrieval: 'none' },
        ])
        expect(document.body.querySelectorAll('[data-bard-lore-link]')).toHaveLength(1)
        expect(document.body.querySelector('[data-bard-lore-link-target="source"]')).toBeNull()
    })

    it('creates complete Bard metadata for new entries and folders', async () => {
        const onChange = vi.fn()
        await render([], { bardMode: true, onChange })

        click('[data-lorebook-add]')
        await tick()
        const entryResult = onChange.mock.calls.at(-1)?.[0] as any[]
        expect(entryResult[0].bard).toMatchObject({
            sourceLegacyId: entryResult[0].id,
            kind: 'other',
            activation: 'retrieve',
            aliases: [],
            tags: [],
            links: [],
        })

        click('[data-lorebook-add-folder]')
        await tick()
        const folderResult = onChange.mock.calls.at(-1)?.[0] as any[]
        expect(folderResult.at(-1).bard).toMatchObject({
            sourceLegacyId: folderResult.at(-1).id,
            activation: 'never',
        })
    })

    it('removes dangling Bard links when their target is deleted', async () => {
        const onChange = vi.fn()
        const bard = (id: string, links: any[] = []) => ({
            ...entry(id),
            bard: {
                sourceLegacyId: id,
                sourceHash: id,
                kind: 'other',
                activation: 'retrieve',
                aliases: [],
                tags: [],
                summary: '',
                links,
            },
        })
        await render([
            bard('source', [{ targetId: 'target', relation: 'supports', retrieval: 'supporting' }]),
            bard('target'),
        ], { bardMode: true, onChange })

        click('[data-lorebook-row-delete="target"]')
        await vi.waitFor(() => expect(onChange).toHaveBeenCalled())

        expect((onChange.mock.calls.at(-1)?.[0] as any[])[0].bard.links).toEqual([])
    })

    it('renders the list, editor, and search together', async () => {
        await render([entry('one')])

        expect(document.body.querySelector('[data-lorebook-list]')).not.toBeNull()
        expect(document.body.querySelector('[data-lorebook-editor]')).not.toBeNull()
        expect(document.body.querySelector('[data-lorebook-search]')).not.toBeNull()
    })

    it('renders activation status icons with unreachable and hidden row states', async () => {
        await render([
            entry('always', { alwaysActive: true, key: '' }),
            entry('keyword', { key: 'castle' }),
            entry('multiple', { key: 'castle', selective: true }),
            entry('unreachable', { key: '   ', alwaysActive: false }),
            entry('hidden', { enabled: false, alwaysActive: true }),
        ])

        expect(document.body.querySelector('[data-lorebook-row="always"] [data-lorebook-activation-status="always"]')).not.toBeNull()
        expect(document.body.querySelector('[data-lorebook-row="keyword"] [data-lorebook-activation-status="keyword"]')).not.toBeNull()
        expect(document.body.querySelector('[data-lorebook-row="multiple"] [data-lorebook-activation-status="multiple-key"]')).not.toBeNull()
        expect(document.body.querySelector('[data-lorebook-row="unreachable"] [data-lorebook-activation-status="unreachable"]')).not.toBeNull()
        expect(document.body.querySelector('[data-lorebook-row="unreachable"]')?.classList.contains('unreachable-entry')).toBe(true)
        expect(document.body.querySelector('[data-lorebook-row="hidden"] [data-lorebook-status-hidden]')).not.toBeNull()
        expect(document.body.querySelector('[data-lorebook-row="hidden"]')?.classList.contains('hidden-entry')).toBe(true)
    })

    it('renders Grimoire activation policies as text labels instead of legacy lorebook icons', async () => {
        const bardEntry = (id: string, activation: 'required' | 'keyed' | 'retrieve' | 'never') => ({
            ...entry(id, activation === 'retrieve' ? { key: '' } : activation === 'never' ? { enabled: false } : {}),
            bard: {
                sourceLegacyId: id,
                sourceHash: id,
                kind: 'other' as const,
                activation,
                aliases: [],
                tags: [],
                summary: '',
                facets: [],
                injection: 'full' as const,
                links: [],
            },
        })
        await render([
            bardEntry('required', 'required'),
            bardEntry('keyed', 'keyed'),
            bardEntry('retrieve', 'retrieve'),
            bardEntry('never', 'never'),
        ], { bardMode: true })

        expect([...document.body.querySelectorAll('[data-bard-lore-activation-label]')]
            .map((label) => label.textContent?.trim())).toEqual([
                '[Required]',
                '[Key or alias match]',
                '[Key + relevance]',
                '[Never inject]',
            ])
        expect(document.body.querySelector('[data-lorebook-activation-status]')).toBeNull()
        expect(document.body.querySelector('[data-lorebook-row="retrieve"]')?.classList.contains('unreachable-entry')).toBe(false)
        expect(document.body.querySelector('[data-lorebook-row="never"] [data-lorebook-status-hidden]')).not.toBeNull()
    })

    it('keeps primary and secondary key fields editable in Grimoire mode', async () => {
        const onChange = vi.fn()
        await render([{
            ...entry('keyed', { key: '', secondkey: '' }),
            bard: {
                sourceLegacyId: 'keyed',
                sourceHash: 'keyed',
                kind: 'other',
                activation: 'keyed',
                aliases: [],
                tags: [],
                summary: '',
                facets: [],
                injection: 'full',
                links: [],
            },
        } as any], { bardMode: true, onChange })
        click('[data-lorebook-row="keyed"] [data-lorebook-open]')
        await tick()

        const primary = document.body.querySelector<HTMLInputElement>('[data-lorebook-field="key"]')!
        const secondary = document.body.querySelector<HTMLInputElement>('[data-lorebook-field="secondkey"]')!
        expect(primary.disabled).toBe(false)
        expect(secondary.disabled).toBe(false)
        expect(document.body.querySelector<HTMLButtonElement>('[data-lorebook-expand-key="key"]')?.disabled).toBe(false)

        primary.value = 'castle'
        primary.dispatchEvent(new Event('input', { bubbles: true }))
        primary.dispatchEvent(new FocusEvent('blur', { bubbles: true }))
        await tick()

        expect((onChange.mock.calls.at(-1)?.[0] as loreBook[])[0].key).toBe('castle')
    })

    it('maps the Hidden checkbox to enabled false', async () => {
        const onChange = vi.fn()
        await render([entry('one', { enabled: true })], { onChange })
        click('[data-lorebook-row="one"] [data-lorebook-open]')
        await tick()

        const hidden = document.body.querySelector<HTMLInputElement>('[data-lorebook-hidden]')!
        expect(hidden.checked).toBe(false)
        hidden.click()
        await tick()

        expect((onChange.mock.calls.at(-1)?.[0] as loreBook[])[0].enabled).toBe(false)
    })

    it('deletes a hovered row from its inline trash action', async () => {
        const onChange = vi.fn()
        await render([entry('one'), entry('two')], { onChange })

        click('[data-lorebook-row-delete="one"]')
        await vi.waitFor(() => expect(onChange).toHaveBeenCalled())

        expect((onChange.mock.calls.at(-1)?.[0] as loreBook[]).map((item) => item.id)).toEqual(['two'])
        expect(environmentMock.alertConfirm).toHaveBeenCalledOnce()
    })

    it('shares status icons, hidden semantics, and the inline trash action with the default lorebook editor', () => {
        const source = readFileSync(resolve('src/lib/SideBars/LoreBook/LoreBookData.svelte'), 'utf8')

        expect(source).toContain("import LoreBookStatusIcons from './LoreBookStatusIcons.svelte'")
        expect(source).toContain('data-lorebook-inline-delete')
        expect(source).toContain('data-lorebook-hidden')
        expect(source).toContain('value.enabled = !hidden')
    })

    it('names enabled inversion Hidden and selective activation Multiple keys', () => {
        expect(languageEnglish.lorebookWorkspace.hidden).toBe('Hidden')
        expect(languageKorean.lorebookWorkspace.hidden).toBe('숨김')
        expect(languageEnglish.lorebookWorkspace.selective).toBe('Multiple keys')
        expect(languageKorean.lorebookWorkspace.selective).toBe('멀티플 키')
        expect(languageEnglish.selective).toBe('Multiple keys')
        expect(languageKorean.selective).toBe('멀티플 키')
    })

    it('persists missing and duplicate IDs once when mounted', async () => {
        const onChange = vi.fn()
        await render([
            entry('', { comment: 'Missing', content: 'missing full text' }),
            entry('duplicate', { comment: 'First duplicate' }),
            entry('duplicate', { comment: 'Second duplicate' }),
        ], { onChange })
        await tick()

        expect(onChange).toHaveBeenCalledTimes(1)
        const normalized = onChange.mock.calls[0][0] as loreBook[]
        const ids = normalized.map((item) => item.id)
        expect(ids.every(Boolean)).toBe(true)
        expect(new Set(ids).size).toBe(3)
        expect(normalized[0]).toMatchObject({ comment: 'Missing', content: 'missing full text' })

        await tick()
        expect(onChange).toHaveBeenCalledTimes(1)
    })

    it('creates folders with the established private-use key prefix', async () => {
        const onChange = vi.fn()
        await render([], { onChange })

        click('[data-lorebook-add-folder]')
        await tick()

        const changed = onChange.mock.calls.at(-1)?.[0] as loreBook[]
        expect(changed).toHaveLength(1)
        expect(changed[0]).toMatchObject({ mode: 'folder' })
        expect(changed[0].key).toMatch(/^\uf000folder:/u)
    })

    it('keeps guidance and warnings out of the compact document flow', async () => {
        const content = '{{#if {{or::1::0::1}}}}Body{{/if}}'
        await render([entry('one', { content })])
        click('[data-lorebook-row="one"] [data-lorebook-open]')
        await tick()
        click('[data-cbs-view-toggle]')
        await tick()
        const view = document.body.querySelector('[data-cbs-condition-view]')!
        expect(view.querySelector('.view-note')).toBeNull()
        expect(view.querySelector('.view-warning')).toBeNull()
        expect(view.textContent).not.toContain(languageEnglish.cbsEditor.end)
        expect(view.querySelector('[data-cbs-warning]')?.getAttribute('aria-label')).toContain('first 2')
        expect(view.querySelector('aside[data-cbs-variable-sidebar] [data-cbs-variable-list]')).not.toBeNull()
        expect(view.querySelector('[data-cbs-document] [data-cbs-body]')).not.toBeNull()
        expect(view.querySelector('[data-cbs-document] [data-cbs-variable-list]')).toBeNull()
    })

    it('renders distinct comparison chips and nested logical groups without changing source', async () => {
        const opening = '{{#if {{and::{{or::{{equal::{{getvar::a}}::1}}::{{equal::{{getvar::b}}::2}}}}::{{not::{{equal::{{getvar::mode}}::OR <img src=x onerror=alert(1)>}}}}}}}}'
        const content = `${opening}Body{{/if}}`
        const onChange = await render([entry('one', { content })])
        click('[data-lorebook-row="one"] [data-lorebook-open]')
        await tick()
        click('[data-cbs-view-toggle]')
        await tick()
        const summary = document.body.querySelector('[data-cbs-summary]')!
        expect(summary.querySelectorAll('[data-cbs-clause]')).toHaveLength(3)
        expect(summary.querySelector('[data-cbs-logic="AND"] [data-cbs-logic="OR"]')).not.toBeNull()
        expect(summary.querySelector('[data-cbs-logic="AND"] [data-cbs-logic="NOT"]')).not.toBeNull()
        expect(summary.closest('summary')?.getAttribute('aria-label')).toContain('(($a = "1") OR ($b = "2")) AND')
        expect([...summary.querySelectorAll('[data-cbs-operator]')].map(el => el.textContent)).toEqual(['OR', 'AND', 'NOT'])
        expect(summary.querySelector('[data-cbs-token="literal"]')?.textContent).toBe('"1"')
        expect(summary.textContent).toContain('OR <img src=x onerror=alert(1)>')
        expect(summary.querySelector('img')).toBeNull()
        click('.condition-block summary')
        await tick()
        expect(document.body.querySelector('.condition-source')?.textContent).toBe(opening)
        expect(onChange).not.toHaveBeenCalled()
        click('[data-cbs-view-toggle]')
        await tick()
        expect(document.body.querySelector<HTMLTextAreaElement>('.lore-content')!.value).toBe(content)
    })

    it('places all metadata in one row and edits each key in a full-width expansion', async () => {
        const onChange = await render([entry('one', { key: 'first, second', secondkey: 'other' }), entry('two', { key: 'next' })])
        click('[data-lorebook-row="one"] [data-lorebook-open]')
        await tick()
        const heading = document.body.querySelector('.editor-heading')!
        expect([...heading.querySelectorAll('[data-lorebook-field]')].map(el => el.getAttribute('data-lorebook-field')))
            .toEqual(['comment', 'key', 'secondkey', 'insertorder'])
        for (const field of ['key', 'secondkey']) {
            click(`[data-lorebook-expand-key="${field}"]`)
            await tick()
            const expanded = document.body.querySelector<HTMLTextAreaElement>(`[data-lorebook-expanded-key="${field}"]`)!
            expect(expanded).not.toBeNull()
            expect(heading.contains(expanded)).toBe(false)
            expect(expanded.closest('.editor-fields')).not.toBeNull()
            expect(document.body.querySelector(`[data-lorebook-expand-key="${field}"]`)?.getAttribute('aria-expanded')).toBe('true')
            expanded.value = 'alpha,\nbeta, gamma'
            expanded.dispatchEvent(new Event('input', { bubbles: true }))
            expanded.dispatchEvent(new FocusEvent('blur', { bubbles: true }))
            await tick()
            expect(vi.mocked(onChange).mock.calls.at(-1)?.[0][0][field]).toBe('alpha,\nbeta, gamma')
            click(`[data-lorebook-expand-key="${field}"]`)
            await tick()
            click(`[data-lorebook-expand-key="${field}"]`)
            await tick()
            expect(document.body.querySelector<HTMLTextAreaElement>(`[data-lorebook-expanded-key="${field}"]`)!.value).toBe('alpha,\nbeta, gamma')
        }
        click('[data-lorebook-row="two"] [data-lorebook-open]')
        await tick()
        expect(document.body.querySelector<HTMLTextAreaElement>('[data-lorebook-expanded-key="key"]')!.value).toBe('next')
    })

    it('resizes the settings and variables independently with keyboard reset', async () => {
        await render([entry('one', { content: '{{getvar::test}}' })])
        click('[data-lorebook-row="one"] [data-lorebook-open]')
        await tick()
        const grid = document.body.querySelector<HTMLElement>('.lore-editor-grid')!
        grid.getBoundingClientRect = () => ({ ...rect(0, 600), width: 800 })
        const rail = document.body.querySelector<HTMLElement>('.lore-state-rail')!
        rail.getBoundingClientRect = () => ({ ...rect(0, 600), width: 192 })
        const stateHandle = document.body.querySelector<HTMLElement>('[data-lorebook-state-splitter]')!
        expect(stateHandle).not.toBeNull()
        stateHandle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
        expect(grid.style.getPropertyValue('--lore-state-width')).toBe('240px')
        stateHandle.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }))
        expect(grid.style.getPropertyValue('--lore-state-width')).toBe('')
        click('[data-cbs-view-toggle]')
        await tick()
        click('[data-cbs-variable-toggle]')
        await tick()
        const layout = document.body.querySelector<HTMLElement>('.view-layout')!
        layout.getBoundingClientRect = () => ({ ...rect(0, 600), width: 700 })
        const variables = document.body.querySelector<HTMLElement>('[data-cbs-variable-sidebar]')!
        variables.getBoundingClientRect = () => ({ ...rect(0, 600), width: 272 })
        const handle = document.body.querySelector<HTMLElement>('[data-cbs-variable-splitter]')!
        expect(handle).not.toBeNull()
        handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
        expect(layout.style.getPropertyValue('--cbs-variable-width')).toBe('256px')
        handle.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
        expect(layout.style.getPropertyValue('--cbs-variable-width')).toBe('')
    })

    it('discovers variables without writing them, then applies only to the chosen variable target', async () => {
        const owner = {
            chaId: 'bot', name: 'Persona', chatPage: 0, defaultVariables: 'cv_spoiler=lock',
            chats: [{ id: 'chat', name: 'Main', scriptstate: {} as Record<string, string> }],
        }
        environmentMock.db.characters = [owner]
        const content = '{{#if {{equal::{{getvar::cv_spoiler}}::request}}}}Body{{/if}}'
        const onChange = await render([entry('one', { content })], { scopeKey: JSON.stringify(['lorebook', 'character', 'bot']) })
        click('[data-lorebook-row="one"] [data-lorebook-open]')
        await tick()
        click('[data-cbs-view-toggle]')
        await tick()
        const sidebar = document.body.querySelector<HTMLElement>('[data-cbs-variable-sidebar]')!
        const toggle = document.body.querySelector<HTMLButtonElement>('[data-cbs-variable-toggle]')!
        expect(sidebar).not.toBeNull()
        expect(toggle.getAttribute('aria-controls')).toBe(sidebar.id)
        expect(sidebar.hidden).toBe(true)
        click('[data-cbs-variable-toggle]')
        await tick()
        expect(sidebar.hidden).toBe(false)
        expect(toggle.getAttribute('aria-expanded')).toBe('true')
        expect(owner.chats[0].scriptstate).toEqual({})
        const input = document.body.querySelector<HTMLInputElement>('[data-cbs-variable="cv_spoiler"]')!
        expect(input.value).toBe('lock')
        expect(document.body.querySelector('datalist option')?.getAttribute('value')).toBe('request')
        input.value = 'request'
        input.dispatchEvent(new Event('input', { bubbles: true }))
        await tick()
        expect(owner.chats[0].scriptstate).toEqual({})
        click('[data-cbs-variable-toggle]')
        await tick()
        expect(sidebar.hidden).toBe(true)
        expect(toggle.getAttribute('aria-expanded')).toBe('false')
        click('[data-cbs-variable-toggle]')
        await tick()
        expect(document.body.querySelector('[data-cbs-variable="cv_spoiler"]')).toBe(input)
        expect(input.value).toBe('request')
        expect(document.body.querySelector<HTMLSelectElement>('[data-cbs-variable-target]')!.value).toBe('chat')
        expect(document.body.querySelector<HTMLButtonElement>('[data-cbs-variable-apply="cv_spoiler"]')!.disabled).toBe(false)
        click('[data-cbs-variable-apply="cv_spoiler"]')
        await tick()
        expect(owner.chats[0].scriptstate).toEqual({ $cv_spoiler: 'request' })
        expect(owner.defaultVariables).toBe('cv_spoiler=lock')
        const target = document.body.querySelector<HTMLSelectElement>('[data-cbs-variable-target]')!
        target.value = 'default'
        target.dispatchEvent(new Event('change', { bubbles: true }))
        await tick()
        const defaultInput = document.body.querySelector<HTMLInputElement>('[data-cbs-variable="cv_spoiler"]')!
        expect(defaultInput.getAttribute('aria-label')).toContain('Character default')
        defaultInput.value = 'open'
        defaultInput.dispatchEvent(new Event('input', { bubbles: true }))
        await tick()
        expect(document.body.querySelector<HTMLButtonElement>('[data-cbs-variable-apply="cv_spoiler"]')!.disabled).toBe(false)
        click('[data-cbs-variable-apply="cv_spoiler"]')
        await tick()
        expect(owner.defaultVariables).toBe('cv_spoiler=open')
        expect(owner.chats[0].scriptstate.$cv_spoiler).toBe('request')
        expect(onChange).not.toHaveBeenCalled()
    })

    it('edits conditional lore bodies without changing their CBS wrappers', async () => {
        const opening = '{{#if {{equal::{{getvar::cv_g8}}::1}}}}'
        const content = `${opening}Original body{{/if}}`
        const onChange = await render([entry('one', { content })])
        click('[data-lorebook-row="one"] [data-lorebook-open]')
        await tick()
        expect(document.body.querySelector('[data-cbs-view-toggle]')).not.toBeNull()
        click('[data-cbs-view-toggle]')
        await tick()
        const summary = document.body.querySelector('[data-cbs-summary]')!
        expect(summary.querySelector('[data-cbs-token="variable"]')?.textContent).toContain('$cv_g8')
        expect(summary.querySelector('[data-cbs-token="literal"]')?.textContent).toBe('"1"')
        const body = document.body.querySelector<HTMLTextAreaElement>('[data-cbs-body]')!
        expect(body.value).toBe('Original body')
        body.value = 'Edited body'
        body.dispatchEvent(new Event('input', { bubbles: true }))
        body.dispatchEvent(new FocusEvent('blur', { bubbles: true }))
        await tick()
        expect(onChange).toHaveBeenLastCalledWith([
            expect.objectContaining({ content: `${opening}Edited body{{/if}}` }),
        ])
        click('[data-cbs-view-toggle]')
        await tick()
        expect(document.body.querySelector<HTMLTextAreaElement>('.lore-content')!.value)
            .toBe(`${opening}Edited body{{/if}}`)
    })

    it('keeps an active body editor mounted while typing an unfinished CBS expression', async () => {
        const onChange = await render([entry('one', { content: '{{#if 1}}Body{{/if}}' })])
        click('[data-lorebook-row="one"] [data-lorebook-open]')
        await tick()
        click('[data-cbs-view-toggle]')
        await tick()
        const body = document.body.querySelector<HTMLTextAreaElement>('[data-cbs-body]')!
        body.focus()
        body.value = 'Body {{'
        body.dispatchEvent(new Event('input', { bubbles: true }))
        await tick()
        expect(document.body.querySelector('[data-cbs-body]')).toBe(body)
        expect(body.value).toBe('Body {{')
        expect(document.activeElement).toBe(body)
        body.value = 'Body {{char}}'
        body.dispatchEvent(new Event('input', { bubbles: true }))
        body.dispatchEvent(new FocusEvent('blur', { bubbles: true }))
        await tick()
        expect(onChange).toHaveBeenLastCalledWith([
            expect.objectContaining({ content: '{{#if 1}}Body {{char}}{{/if}}' }),
        ])
    })

    it('allows editing a whitespace-only conditional body', async () => {
        await render([entry('one', { content: '{{#if 1}}\n{{/if}}' })])
        click('[data-lorebook-row="one"] [data-lorebook-open]')
        await tick()
        click('[data-cbs-view-toggle]')
        await tick()
        expect(document.body.querySelector<HTMLTextAreaElement>('[data-cbs-body]')?.value).toBe('\n')
    })

    it('saves successive body edits at current offsets and refreshes the view when switching entries', async () => {
        const content = '{{#if 1}}First{{/if}}\r\n{{#if 0}}Second{{/if}}'
        const onChange = await render([entry('one', { content }), entry('two', { content: '{{#if 1}}Other{{/if}}' })])
        click('[data-lorebook-row="one"] [data-lorebook-open]')
        await tick()
        click('[data-cbs-view-toggle]')
        await tick()
        for (const text of ['Longer first body', 'Short']) {
            const first = document.body.querySelector<HTMLTextAreaElement>('[data-cbs-body]')!
            first.value = text
            first.dispatchEvent(new Event('input', { bubbles: true }))
            await tick()
        }
        const second = document.body.querySelectorAll<HTMLTextAreaElement>('[data-cbs-body]')[1]
        second.value = 'Changed second'
        second.dispatchEvent(new Event('input', { bubbles: true }))
        await tick()
        click('[data-lorebook-row="two"] [data-lorebook-open]')
        await tick()
        expect(onChange).toHaveBeenLastCalledWith([
            expect.objectContaining({ content: '{{#if 1}}Short{{/if}}\r\n{{#if 0}}Changed second{{/if}}' }),
            expect.objectContaining({ content: '{{#if 1}}Other{{/if}}' }),
        ])
        expect(document.body.querySelector<HTMLTextAreaElement>('[data-cbs-body]')!.value).toBe('Other')
    })

    it('routes a single editor commit through the pure batch patch operation', async () => {
        await render([entry('one', { comment: 'Before', content: 'preserved' })])
        click('[data-lorebook-row="one"] [data-lorebook-open]')
        await tick()

        const name = document.body.querySelector<HTMLInputElement>('.editor-heading input')!
        name.value = 'After'
        name.dispatchEvent(new Event('input', { bubbles: true }))
        name.dispatchEvent(new FocusEvent('blur', { bubbles: true }))
        await tick()

        expect(operationMocks.applyBatchPatch).toHaveBeenCalledWith(
            expect.any(Array),
            new Set(['one']),
            { comment: 'After' },
        )
    })

    it('preserves a dirty active draft when a batch enabled change happens before blur', async () => {
        const onChange = vi.fn()
        await render([entry('one', { content: 'before' }), entry('two')], { onChange })
        click('[data-lorebook-row="one"] [data-lorebook-open]')
        await tick()

        const content = document.body.querySelector<HTMLTextAreaElement>('.lore-content')!
        content.value = 'dirty draft'
        content.dispatchEvent(new Event('input', { bubbles: true }))
        document.body.querySelector<HTMLElement>('[data-lorebook-row="two"] .row-main')!
            .dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }))
        await tick()
        click('[data-lorebook-batch-enabled="false"]')
        await tick()
        content.dispatchEvent(new FocusEvent('blur', { bubbles: true }))
        await tick()

        const changed = onChange.mock.calls.at(-1)?.[0] as loreBook[]
        expect(changed[0]).toMatchObject({ id: 'one', enabled: false, content: 'dirty draft' })
    })

    it('resynchronizes an active restored Loremaster entry before a later blur', async () => {
        const placeholder = entry('one', {
            comment: '[X] Library',
            key: '',
            content: '',
            folder: '\uf000folder:places',
            insertorder: 30,
        }) as loreBook & { disabled?: boolean }
        placeholder.disabled = true
        const onChange = vi.fn()
        await render([placeholder], {
            legacyDisabledBackups: {
                one: entry('one', { comment: 'Library', key: 'books', content: 'Full text' }),
            },
            onChange,
        })
        click('[data-lorebook-row="one"] [data-lorebook-open]')
        await tick()
        click('[data-lorebook-import-loremaster]')
        await tick()

        const name = document.body.querySelector<HTMLInputElement>('[data-lorebook-field="comment"]')!
        expect(name.value).toBe('Library')
        name.dispatchEvent(new FocusEvent('blur', { bubbles: true }))
        await tick()

        const changed = onChange.mock.calls.at(-1)?.[0] as loreBook[]
        expect(changed[0]).toMatchObject({
            comment: 'Library', key: 'books', content: 'Full text', enabled: false,
        })
    })

    it('disables two checked entries without dropping their content', async () => {
        const entries = [
            entry('one', { content: 'one full text', bookVersion: 3 }),
            entry('two', { content: 'two full text', activationPercent: 45 }),
        ]
        const onChange = vi.fn()
        await render(entries, { onChange })

        click('[data-lorebook-select="one"]')
        click('[data-lorebook-select="two"]')
        await tick()
        click('[data-lorebook-batch-enabled="false"]')
        await tick()

        const changed = onChange.mock.calls.at(-1)?.[0] as loreBook[]
        expect(changed).toEqual([
            expect.objectContaining({ id: 'one', enabled: false, content: 'one full text', bookVersion: 3 }),
            expect.objectContaining({ id: 'two', enabled: false, content: 'two full text', activationPercent: 45 }),
        ])
    })

    it('keeps the mobile checkbox inside a separate accessible hit area', async () => {
        setMobileViewport(true)
        await render([entry('one', { comment: 'Library' })])

        const hitArea = document.body.querySelector<HTMLLabelElement>('.row-select-hit-area')
        const checkbox = hitArea?.querySelector<HTMLInputElement>('[data-lorebook-select="one"]')
        expect(hitArea).not.toBeNull()
        expect(checkbox?.getAttribute('aria-label')).toBe('Select Library')
    })

    it('keeps a key-matching child and its folder in search results', async () => {
        await render([
            entry('folder', { mode: 'folder', key: 'places', comment: 'Places' }),
            entry('library', { key: 'books, archive', folder: 'places', comment: 'Library' }),
            entry('other', { key: 'weather', comment: 'Weather' }),
        ])

        const target = document.body.querySelector<HTMLSelectElement>('[data-lorebook-search-target]')!
        target.value = 'keys'
        target.dispatchEvent(new Event('change', { bubbles: true }))
        await tick()
        const search = document.body.querySelector<HTMLInputElement>('[data-lorebook-search]')!
        search.value = 'archive'
        search.dispatchEvent(new Event('input', { bubbles: true }))
        await tick()

        const list = document.body.querySelector('[data-lorebook-list]')!
        expect(list.textContent).toContain('Places')
        expect(list.textContent).toContain('Library')
        expect(list.textContent).not.toContain('Weather')
    })

    it('offers an all-fields search target that finds lore body content', async () => {
        await render([
            entry('body-hit', { comment: 'Alchemy', key: 'atelier', content: 'A forbidden library beneath the academy.' }),
            entry('miss', { comment: 'Weather', key: 'rain', content: 'Clouds gather at dusk.' }),
        ])

        const target = document.body.querySelector<HTMLSelectElement>('[data-lorebook-search-target]')!
        expect([...target.options].map((option) => option.value)).toContain('all')
        target.value = 'all'
        target.dispatchEvent(new Event('change', { bubbles: true }))
        const search = document.body.querySelector<HTMLInputElement>('[data-lorebook-search]')!
        search.value = 'forbidden library'
        search.dispatchEvent(new Event('input', { bubbles: true }))
        await tick()

        const list = document.body.querySelector('[data-lorebook-list]')!
        expect(list.textContent).toContain('Alchemy')
        expect(list.textContent).not.toContain('Weather')
    })

    it('keeps every explicit move action when drag is disabled', async () => {
        await render([
            entry('folder', { mode: 'folder', key: 'places', comment: 'Places' }),
            entry('one'),
        ], { dragEnabled: false })

        click('[data-lorebook-row="one"] [data-lorebook-open]')
        await tick()

        for (const action of ['up', 'down', 'folder', 'root']) {
            expect(document.body.querySelector(`[data-lorebook-move="${action}"]`)).not.toBeNull()
        }
    })

    it('toggles and edits a folder from the full folder row without a separate disclosure button', async () => {
        const folderKey = '\uf000folder:places'
        const onChange = vi.fn()
        await render([
            entry('folder', { mode: 'folder', key: folderKey, comment: 'Places', insertorder: 10 }),
            entry('child', { folder: folderKey, comment: 'Library', insertorder: 20 }),
            entry('folder-two', { mode: 'folder', key: '\uf000folder:people', comment: 'People', insertorder: 30 }),
        ], { dragEnabled: false, onChange })

        const folderRow = document.body.querySelector<HTMLElement>('[data-lorebook-row="folder"]')!
        expect(folderRow.getAttribute('role')).toBeNull()
        const folderButton = folderRow.querySelector<HTMLButtonElement>('[data-lorebook-folder-toggle]')!
        expect(folderButton.getAttribute('aria-expanded')).toBe('false')
        expect(folderRow.querySelector('.folder-disclosure')).toBeNull()
        expect(document.body.querySelector('[data-lorebook-row="child"]')).toBeNull()
        folderButton.click()
        await tick()
        expect(folderButton.getAttribute('aria-expanded')).toBe('true')
        expect(document.body.querySelector('[data-lorebook-row="child"]')).not.toBeNull()
        expect(document.body.querySelector('[data-lorebook-folder-editor]')).not.toBeNull()
        const name = document.body.querySelector<HTMLInputElement>('[data-lorebook-folder-name]')!
        name.value = 'Locations'
        name.dispatchEvent(new Event('input', { bubbles: true }))
        name.dispatchEvent(new FocusEvent('blur', { bubbles: true }))
        await tick()
        expect(onChange.mock.calls.at(-1)?.[0][0]).toMatchObject({ comment: 'Locations' })
        expect(document.body.querySelector('[data-lorebook-move="up"]')).not.toBeNull()
        click('[data-lorebook-move="down"]')
        await tick()
        expect((onChange.mock.calls.at(-1)?.[0] as loreBook[]).map((item) => item.id))
            .toEqual(['folder-two', 'folder', 'child'])
    })

    it('renders expanded folder children directly after their parent when source children come first', async () => {
        const folderKey = '\uf000folder:people'
        await render([
            entry('first-child', { folder: folderKey, comment: 'Ada' }),
            entry('second-child', { folder: folderKey, comment: 'Beau' }),
            entry('folder', { mode: 'folder', key: folderKey, comment: 'People' }),
            entry('root', { comment: 'Weather' }),
        ])

        const rowIds = () => [...document.body.querySelectorAll<HTMLElement>('[data-lorebook-row]')]
            .map((row) => row.dataset.lorebookRow)

        expect(rowIds()).toEqual(['folder', 'root'])
        click('[data-lorebook-folder-toggle]')
        await tick()
        expect(rowIds()).toEqual(['folder', 'first-child', 'second-child', 'root'])
    })

    it('renders child-mode lore as a disabled global link and restores activation percent for normal lore', async () => {
        const onChange = vi.fn()
        await render([
            entry('link', { mode: 'child', comment: 'Global library', content: 'do not edit' }),
            entry('normal', { activationPercent: 42 }),
        ], { onChange })

        click('[data-lorebook-row="link"] [data-lorebook-open]')
        await tick()
        expect(document.body.querySelector('[data-lorebook-child-link]')).not.toBeNull()
        expect(document.body.querySelector('[data-lorebook-child-link] textarea')).toBeNull()
        expect(document.body.querySelector('[data-lorebook-child-link] input:not([disabled])')).toBeNull()

        click('[data-lorebook-row="normal"] [data-lorebook-open]')
        await tick()
        const activation = document.body.querySelector<HTMLInputElement>('[data-lorebook-activation-percent]')!
        expect(activation.value).toBe('42')
        activation.value = '55'
        activation.dispatchEvent(new Event('change', { bubbles: true }))
        await tick()
        expect(onChange.mock.calls.at(-1)?.[0][1]).toMatchObject({ activationPercent: 55 })
    })

    it('shows current-chat activation only when enabled and routes the active normal entry', async () => {
        const onToggle = vi.fn()
        await render([entry('one')], {
            localActivation: {
                visible: true,
                isActive: (item) => item.id === 'one',
                onToggle,
            },
        })
        click('[data-lorebook-row="one"] [data-lorebook-open]')
        await tick()

        const checkbox = document.body.querySelector<HTMLInputElement>('[data-lorebook-local-activation]')!
        expect(checkbox).not.toBeNull()
        expect(checkbox.checked).toBe(true)
        checkbox.checked = false
        checkbox.dispatchEvent(new Event('change', { bubbles: true }))
        expect(onToggle).toHaveBeenCalledWith(expect.objectContaining({ id: 'one' }), false)
    })

    it('hides current-chat activation when the setting is disabled', async () => {
        await render([entry('one')], {
            localActivation: {
                visible: false,
                isActive: () => false,
                onToggle: vi.fn(),
            },
        })
        click('[data-lorebook-row="one"] [data-lorebook-open]')
        await tick()

        expect(document.body.querySelector('[data-lorebook-local-activation]')).toBeNull()
    })

    it('reports every entry removed by a cascading folder deletion', async () => {
        const onEntriesRemoved = vi.fn()
        await render([
            entry('folder', { mode: 'folder', key: '\uf000folder:places' }),
            entry('inside', { folder: '\uf000folder:places' }),
            entry('unrelated'),
        ], {
            localActivation: {
                visible: true,
                isActive: () => false,
                onToggle: vi.fn(),
                onEntriesRemoved,
            },
        })
        click('[data-lorebook-row="folder"] [data-lorebook-folder-edit]')
        await tick()
        click('[data-lorebook-delete]')
        await vi.waitFor(() => expect(onEntriesRemoved).toHaveBeenCalledTimes(1))

        expect(new Set(onEntriesRemoved.mock.calls[0][0])).toEqual(new Set(['folder', 'inside']))
    })

    it('finishes a deferred deletion against the captured scope after a scope switch', async () => {
        const confirmation = deferred<boolean>()
        environmentMock.alertConfirm.mockReturnValueOnce(confirmation.promise)
        const onChangeA = vi.fn()
        const onChangeB = vi.fn()
        const activationA = {
            visible: true,
            isActive: () => false,
            onToggle: vi.fn(),
            onEntriesRemoved: vi.fn(),
        }
        const activationB = {
            visible: true,
            isActive: () => false,
            onToggle: vi.fn(),
            onEntriesRemoved: vi.fn(),
        }
        const target = document.body.appendChild(document.createElement('div'))
        const component = createClassComponent({
            component: LoreBookWorkspace,
            target,
            props: {
                entries: [entry('scope-a-entry')],
                scopeLabel: 'Scope A',
                scopeKey: 'scope-a',
                onChange: onChangeA,
                localActivation: activationA,
            },
        })
        try {
            click('[data-lorebook-row="scope-a-entry"] [data-lorebook-open]')
            await tick()
            click('[data-lorebook-delete]')
            await vi.waitFor(() => expect(environmentMock.alertConfirm).toHaveBeenCalledTimes(1))

            component.$set({
                entries: [entry('scope-b-entry')],
                scopeLabel: 'Scope B',
                scopeKey: 'scope-b',
                onChange: onChangeB,
                localActivation: activationB,
            })
            await tick()
            confirmation.resolve(true)
            await vi.waitFor(() => expect(onChangeA).toHaveBeenCalledWith([]))

            expect(onChangeB).not.toHaveBeenCalled()
            expect(activationA.onEntriesRemoved).toHaveBeenCalledWith(['scope-a-entry'])
            expect(activationB.onEntriesRemoved).not.toHaveBeenCalled()
        }
        finally {
            component.$destroy()
        }
    })

    it('keeps Ctrl/Cmd selection limited to editable normal lore and batch ops leave child links intact', async () => {
        const child = entry('link', { mode: 'child', content: 'linked record' })
        const onChange = vi.fn()
        await render([
            entry('normal'),
            child,
            entry('normal-2'),
            entry('folder', { mode: 'folder', key: '\uf000folder:places' }),
        ], { onChange })

        for (const id of ['normal', 'link', 'normal-2', 'folder']) {
            document.body.querySelector<HTMLElement>(`[data-lorebook-row="${id}"] .row-main`)!
                .dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }))
            await tick()
        }

        expect(document.body.querySelector('[data-lorebook-row="normal"]')?.classList.contains('selected')).toBe(true)
        expect(document.body.querySelector('[data-lorebook-row="link"]')?.classList.contains('selected')).toBe(false)
        expect(document.body.querySelector('[data-lorebook-row="folder"]')?.classList.contains('selected')).toBe(false)
        expect(document.body.querySelector('[data-lorebook-batch]')?.textContent).toContain('2 selected')
        click('[data-lorebook-batch-enabled="false"]')
        await tick()
        expect((onChange.mock.calls.at(-1)?.[0] as loreBook[])[1]).toBe(child)
    })

    it('uses desktop file-manager selection gestures and exposes a clear-selection action', async () => {
        await render([entry('a'), entry('b'), entry('c'), entry('d')], {
            scopeKey: 'desktop-selection-gestures',
        })

        document.body.querySelector<HTMLElement>('[data-lorebook-row="a"] .row-main')!.click()
        await tick()
        expect(document.body.querySelector('[data-lorebook-row="a"]')?.classList.contains('selected')).toBe(true)

        document.body.querySelector<HTMLElement>('[data-lorebook-row="c"] .row-main')!
            .dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }))
        await tick()
        expect(document.body.querySelector('[data-lorebook-batch]')?.textContent).toContain('2 selected')

        document.body.querySelector<HTMLInputElement>('[data-lorebook-select="d"]')!
            .dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }))
        await tick()
        expect(document.body.querySelector('[data-lorebook-row="c"]')?.classList.contains('selected')).toBe(true)
        expect(document.body.querySelector('[data-lorebook-row="d"]')?.classList.contains('selected')).toBe(true)

        click('[data-lorebook-clear-selection]')
        await tick()
        expect(document.body.querySelector('[data-lorebook-batch]')).toBeNull()
        expect(document.body.querySelectorAll('[data-lorebook-row].selected')).toHaveLength(0)
    })

    it('collapses multiple selection to the entry clicked without a modifier', async () => {
        await render([entry('a'), entry('b'), entry('c')])

        document.body.querySelector<HTMLElement>('[data-lorebook-row="a"] .row-main')!.click()
        document.body.querySelector<HTMLElement>('[data-lorebook-row="b"] .row-main')!
            .dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }))
        await tick()
        expect(document.body.querySelectorAll('[data-lorebook-row].selected')).toHaveLength(2)

        document.body.querySelector<HTMLElement>('[data-lorebook-row="c"] .row-main')!.click()
        await tick()

        expect(document.body.querySelector('[data-lorebook-batch]')).toBeNull()
        expect(document.body.querySelectorAll('[data-lorebook-row].selected')).toHaveLength(1)
        expect(document.body.querySelector('[data-lorebook-row="c"]')?.classList.contains('selected')).toBe(true)
    })

    it('clears multiple selection when a folder is clicked without a modifier', async () => {
        await render([
            entry('a'),
            entry('b'),
            entry('folder', { mode: 'folder', key: 'folder-key', comment: 'Folder' }),
        ])

        document.body.querySelector<HTMLElement>('[data-lorebook-row="a"] .row-main')!.click()
        document.body.querySelector<HTMLElement>('[data-lorebook-row="b"] .row-main')!
            .dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }))
        await tick()
        expect(document.body.querySelectorAll('[data-lorebook-row].selected')).toHaveLength(2)

        document.body.querySelector<HTMLElement>('[data-lorebook-row="folder"] .row-main')!.click()
        await tick()

        expect(document.body.querySelector('[data-lorebook-batch]')).toBeNull()
        expect(document.body.querySelectorAll('[data-lorebook-row].selected')).toHaveLength(0)
    })

    it('replaces the entry editor with the batch editor when multiple entries are selected', async () => {
        await render([entry('a'), entry('b'), entry('c')])

        document.body.querySelector<HTMLElement>('[data-lorebook-row="a"] .row-main')!.click()
        document.body.querySelector<HTMLElement>('[data-lorebook-row="c"] .row-main')!
            .dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }))
        await tick()

        const editor = document.body.querySelector('[data-lorebook-editor]')!
        const list = document.body.querySelector('[data-lorebook-list]')!
        expect(editor.querySelector('[data-lorebook-batch]')).not.toBeNull()
        expect(list.querySelector('[data-lorebook-batch]')).toBeNull()
        expect(editor.querySelector('[data-lorebook-field="content"]')).toBeNull()
    })

    it('never renders private folder keys and reflects expansion with the folder icon', async () => {
        const privateKey = '\uf000folder:7ae21525-a9e7-4d3e-b543-7b8a4fb5d04e'
        await render([
            entry('folder', { mode: 'folder', key: privateKey, comment: 'Places' }),
            entry('child', { folder: privateKey, comment: 'Cafe' }),
        ], { scopeKey: 'folder-privacy' })

        expect(document.body.textContent).not.toContain(privateKey)
        expect(document.body.querySelector('[data-solar-icon="folder-bold"]')).not.toBeNull()
        click('[data-lorebook-folder-toggle]')
        await tick()
        expect(document.body.querySelector('[data-solar-icon="folder-open-bold"]')).not.toBeNull()
        expect(document.body.textContent).not.toContain(privateKey)
    })

    it('restores the active selection, expanded folders, list scroll, and focused field after remount', async () => {
        const folderKey = '\uf000folder:session'
        const entries = [
            entry('folder', { mode: 'folder', key: folderKey, comment: 'Places' }),
            entry('inside', { folder: folderKey, comment: 'Cafe' }),
        ]
        await render(entries, { scopeKey: 'session-restore-test' })
        click('[data-lorebook-folder-toggle]')
        await tick()
        document.body.querySelector<HTMLElement>('[data-lorebook-row="inside"] .row-main')!.click()
        await tick()
        const list = document.body.querySelector<HTMLElement>('[data-lorebook-list] .lore-rows')!
        list.scrollTop = 87
        document.body.querySelector<HTMLTextAreaElement>('[data-lorebook-field="content"]')!.focus()

        await unmount(mounted!)
        mounted = undefined
        document.body.replaceChildren()
        await render(entries, { scopeKey: 'session-restore-test' })
        await vi.waitFor(() => expect(document.activeElement)
            .toBe(document.body.querySelector('[data-lorebook-field="content"]')))

        expect(document.body.querySelector('[data-lorebook-row="inside"]')?.classList.contains('active')).toBe(true)
        expect(document.body.querySelector('[data-lorebook-row="inside"]')?.classList.contains('selected')).toBe(true)
        expect(document.body.querySelector('[data-lorebook-folder-toggle]')?.getAttribute('aria-expanded')).toBe('true')
        expect(document.body.querySelector<HTMLElement>('[data-lorebook-list] .lore-rows')?.scrollTop).toBe(87)
    })

    it('identifies child links through the resolver and deactivates only after confirmation', async () => {
        const onChange = vi.fn()
        environmentMock.alertConfirm.mockResolvedValueOnce(false).mockResolvedValueOnce(true)
        await render([entry('global-id', { mode: 'child', comment: '', key: '' })], {
            onChange,
            resolveChildLabel: (id) => id === 'global-id' ? 'Global Library' : undefined,
        })

        const childRow = document.body.querySelector('[data-lorebook-row="global-id"] .row-main')!
        expect(childRow.querySelector('strong')?.textContent).toContain('Global Library')
        expect(childRow.querySelector('small')?.textContent).toContain('Global Library')
        click('[data-lorebook-row="global-id"] [data-lorebook-open]')
        await tick()
        expect(document.body.querySelector('[data-lorebook-child-label]')?.textContent).toContain('Global Library')
        click('[data-lorebook-deactivate-child]')
        await vi.waitFor(() => expect(environmentMock.alertConfirm).toHaveBeenCalledTimes(1))
        expect(onChange).not.toHaveBeenCalled()
        click('[data-lorebook-deactivate-child]')
        await vi.waitFor(() => expect(onChange).toHaveBeenCalledWith([]))
    })

    it('uses the localized untitled label when a child resolver returns no label', async () => {
        await render(
            [entry('global-fallback', { mode: 'child', comment: '', key: '' })],
            { resolveChildLabel: () => '   ' },
        )
        expect(document.body.querySelector('[data-lorebook-row="global-fallback"] .row-main')?.textContent)
            .toContain(languageEnglish.lorebookWorkspace.untitledLore)
        click('[data-lorebook-row="global-fallback"] [data-lorebook-open]')
        await tick()
        expect(document.body.querySelector('[data-lorebook-child-label]')?.textContent)
            .toContain(languageEnglish.lorebookWorkspace.untitledLore)
    })

    it('includes the localized enabled state in each row action accessible name', async () => {
        await render([
            entry('on', { comment: 'On', enabled: true }),
            entry('off', { comment: 'Off', enabled: false }),
        ])

        expect(document.body.querySelector('[data-lorebook-row="on"] .row-main')?.textContent)
            .toContain(languageEnglish.lorebookWorkspace.enabled)
        expect(document.body.querySelector('[data-lorebook-row="off"] .row-main')?.textContent)
            .toContain(languageEnglish.lorebookWorkspace.disabled)
    })

    it('reconciles selection and editor state across same-scope entry replacement and scope changes', async () => {
        const target = document.body.appendChild(document.createElement('div'))
        const ownerA = {
            data: [
                entry('same'),
                entry('removed'),
                entry('folder', { mode: 'folder', key: '\uf000folder:old' }),
                entry('other'),
            ],
        }
        const ownerB = {
            data: [
                entry('same', { content: 'scope-b content' }),
                entry('other'),
            ],
        }
        let liveOwner = ownerA
        const bindingForLiveOwner = () => {
            const owner = liveOwner
            return createLorebookOwnerBinding(
                owner,
                owner.data,
                (capturedOwner, next) => { capturedOwner.data = next },
            )
        }
        const bindingA = bindingForLiveOwner()
        const component = createClassComponent({
            component: LoreBookWorkspace,
            target,
            props: {
                entries: bindingA.entries,
                scopeLabel: 'Scope A',
                scopeKey: 'scope-a',
                onChange: bindingA.onChange,
            },
        })
        try {
            click('[data-lorebook-select="same"]')
            click('[data-lorebook-row="removed"] [data-lorebook-open]')
            await tick()
            const folderTarget = document.body.querySelector<HTMLSelectElement>('[aria-label="Move target folder"]')!
            folderTarget.value = 'folder'
            folderTarget.dispatchEvent(new Event('change', { bubbles: true }))

            ownerA.data = [
                entry('same'),
                entry('new-folder', { mode: 'folder', key: '\uf000folder:new' }),
                entry('other'),
            ]
            component.$set({ entries: ownerA.data })
            await tick()
            expect(document.body.querySelector('[data-lorebook-batch]')).toBeNull()
            expect(document.body.querySelector('.editor-empty')).not.toBeNull()

            click('[data-lorebook-row="same"] [data-lorebook-open]')
            await tick()
            expect(document.body.querySelector<HTMLSelectElement>('[aria-label="Move target folder"]')?.value).toBe('')
            const content = document.body.querySelector<HTMLTextAreaElement>('[data-lorebook-field="content"]')!
            content.value = 'scope-a draft'
            content.dispatchEvent(new Event('input', { bubbles: true }))

            liveOwner = ownerB
            const bindingB = bindingForLiveOwner()
            component.$set({
                entries: bindingB.entries,
                scopeLabel: 'Scope B',
                scopeKey: 'scope-b',
                onChange: bindingB.onChange,
            })
            await tick()
            expect(ownerA.data).toEqual(expect.arrayContaining([
                expect.objectContaining({ id: 'same', content: 'scope-a draft' }),
            ]))
            expect(ownerB.data.find((item) => item.id === 'same')?.content).toBe('scope-b content')
            expect(document.body.querySelector('[data-lorebook-toolbar]')?.textContent).toContain('Scope B')
            expect(document.body.querySelector('[data-lorebook-batch]')).toBeNull()
            expect(document.body.querySelector('.editor-empty')).not.toBeNull()
            document.body.querySelector<HTMLElement>('[data-lorebook-row="other"] [data-lorebook-open]')!
                .dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }))
            await tick()
            expect(document.body.querySelector('[data-lorebook-batch]')).toBeNull()
            click('[data-lorebook-row="same"] [data-lorebook-open]')
            await tick()
            expect(document.body.querySelector<HTMLTextAreaElement>('[data-lorebook-field="content"]')?.value)
                .toBe('scope-b content')
        }
        finally {
            component.$destroy()
        }
    })

    it('removes selected folder children from batch state after cascading folder deletion', async () => {
        const folderKey = '\uf000folder:places'
        const onChange = vi.fn()
        await render([
            entry('folder', { mode: 'folder', key: folderKey }),
            entry('child', { folder: folderKey }),
        ], { onChange })
        click('[data-lorebook-folder-toggle]')
        await tick()
        click('[data-lorebook-select="child"]')
        click('[data-lorebook-folder-edit]')
        await tick()
        click('[data-lorebook-delete]')

        await vi.waitFor(() => expect(onChange).toHaveBeenCalledWith([]))
        await tick()
        expect(document.body.querySelector('[data-lorebook-batch]')).toBeNull()
    })

    it('requires confirmation before deleting and honors both cancel and accept', async () => {
        const onChange = vi.fn()
        environmentMock.alertConfirm.mockResolvedValueOnce(false).mockResolvedValueOnce(true)
        await render([entry('one', { comment: 'Archive', content: 'full text' })], { onChange })
        click('[data-lorebook-row="one"] [data-lorebook-open]')
        await tick()

        click('[data-lorebook-delete]')
        await vi.waitFor(() => expect(environmentMock.alertConfirm).toHaveBeenCalledTimes(1))
        expect(environmentMock.alertConfirm.mock.calls[0][0]).toContain('Archive')
        expect(onChange).not.toHaveBeenCalled()

        click('[data-lorebook-delete]')
        await vi.waitFor(() => expect(onChange).toHaveBeenCalledWith([]))
    })

    it('states the folder child count in destructive confirmation', async () => {
        const folderKey = '\uf000folder:places'
        environmentMock.alertConfirm.mockResolvedValue(false)
        await render([
            entry('folder', { mode: 'folder', key: folderKey, comment: 'Places' }),
            entry('one', { folder: folderKey }),
            entry('two', { folder: folderKey }),
        ])
        click('[data-lorebook-row="folder"] [data-lorebook-folder-edit]')
        await tick()
        click('[data-lorebook-delete]')

        await vi.waitFor(() => expect(environmentMock.alertConfirm).toHaveBeenCalled())
        expect(environmentMock.alertConfirm.mock.calls[0][0]).toContain('2')
    })

    it('restores exact Loremaster backups as native disabled entries', async () => {
        const placeholder = entry('one', {
            comment: '[X] Library',
            key: '',
            content: '',
            folder: 'places',
            insertorder: 30,
        }) as loreBook & { disabled?: boolean }
        placeholder.disabled = true
        const backup = entry('one', {
            comment: 'Library',
            key: 'books',
            content: 'Full text',
            alwaysActive: true,
        })
        const onChange = vi.fn()
        await render([placeholder], {
            legacyDisabledBackups: { one: backup },
            onChange,
        })

        click('[data-lorebook-import-loremaster]')
        await tick()

        expect(onChange).toHaveBeenCalledWith([
            expect.objectContaining({
                id: 'one',
                comment: 'Library',
                key: 'books',
                content: 'Full text',
                folder: 'places',
                insertorder: 30,
                enabled: false,
            }),
        ])
        expect(onChange.mock.calls.at(-1)?.[0][0]).not.toHaveProperty('disabled')
    })

    it('uses the mouse onMove target even when onEnd points at the moved source', async () => {
        const onChange = vi.fn()
        await render([entry('a'), entry('b'), entry('c')], { onChange })
        const source = document.body.querySelector<HTMLElement>('[data-lorebook-row="c"]')!
        const target = document.body.querySelector<HTMLElement>('[data-lorebook-row="b"]')!
        const options = sortableMock.options!
        expect(options.onMove).toBeTypeOf('function')

        options.onStart?.({ item: source })
        options.onMove?.({
            dragged: source,
            related: target,
            relatedRect: rect(40, 80),
        }, new MouseEvent('mousemove', { clientY: 45 }))
        options.onEnd?.({ item: source, to: source.parentElement!, newIndex: 2 })

        const changed = onChange.mock.calls.at(-1)?.[0] as loreBook[]
        expect(changed.map((item) => item.id)).toEqual(['a', 'c', 'b'])
    })

    it('uses the whole row as the drag surface without letting Sortable move the preview DOM', async () => {
        await render([entry('a'), entry('b')])
        const source = document.body.querySelector<HTMLElement>('[data-lorebook-row="a"]')!
        const target = document.body.querySelector<HTMLElement>('[data-lorebook-row="b"]')!

        expect(sortableMock.options?.handle).toBeUndefined()
        expect(sortableMock.options?.filter).toContain('[data-lorebook-no-drag]')
        expect(document.body.querySelector('[data-lorebook-drag-handle]')).toBeNull()
        sortableMock.options?.onStart?.({ item: source })
        const allowDomMove = sortableMock.options?.onMove?.({
            dragged: source,
            related: target,
            relatedRect: rect(40, 80),
        }, new MouseEvent('mousemove', { clientY: 45 }))
        await tick()

        expect(allowDomMove).toBe(false)
        expect(target.dataset.dropPosition).toBe('before')
    })

    it('marks and moves the whole selected group when a selected row is dragged', async () => {
        const onChange = vi.fn()
        await render([entry('a'), entry('b'), entry('c'), entry('target')], { onChange })
        document.body.querySelector<HTMLElement>('[data-lorebook-row="a"] .row-main')!.click()
        document.body.querySelector<HTMLElement>('[data-lorebook-row="c"] .row-main')!
            .dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }))
        await tick()

        const source = document.body.querySelector<HTMLElement>('[data-lorebook-row="c"]')!
        const target = document.body.querySelector<HTMLElement>('[data-lorebook-row="target"]')!
        const options = sortableMock.options!
        options.onStart?.({ item: source })
        await tick()

        expect(document.body.querySelector('[data-lorebook-drag-count="2"]')).not.toBeNull()
        expect(document.body.querySelectorAll('[data-lorebook-row].dragging-group')).toHaveLength(2)

        options.onMove?.({
            dragged: source,
            related: target,
            relatedRect: rect(120, 160),
        }, new MouseEvent('mousemove', { clientY: 121 }))
        await tick()
        expect(target.dataset.dropPosition).toBe('before')

        options.onEnd?.({ item: source, to: source.parentElement!, newIndex: 2 })
        await tick()
        expect((onChange.mock.calls.at(-1)?.[0] as loreBook[]).map((item) => item.id))
            .toEqual(['b', 'a', 'c', 'target'])
        expect(document.body.querySelector('[data-lorebook-drag-count]')).toBeNull()
    })

    it('uses touch coordinates and excludes a self-related row when resolving a folder drop', async () => {
        const folderKey = '\uf000folder:places'
        const onChange = vi.fn()
        await render([
            entry('a'),
            entry('folder', { mode: 'folder', key: folderKey, comment: 'Places' }),
        ], { onChange })
        const source = document.body.querySelector<HTMLElement>('[data-lorebook-row="a"]')!
        const folder = document.body.querySelector<HTMLElement>('[data-lorebook-row="folder"]')!
        folder.getBoundingClientRect = () => rect(40, 80)
        const options = sortableMock.options!
        expect(options.onMove).toBeTypeOf('function')

        options.onStart?.({ item: source })
        options.onMove?.({
            dragged: source,
            related: source,
            relatedRect: rect(0, 40),
        }, {
            touches: [{ clientY: 60 }],
            changedTouches: [{ clientY: 60 }],
        })
        await tick()
        expect(folder.dataset.dropPosition).toBe('inside')
        options.onEnd?.({ item: source, to: source.parentElement!, newIndex: 0 })

        const changed = onChange.mock.calls.at(-1)?.[0] as loreBook[]
        expect(changed.map((item) => item.id)).toEqual(['folder', 'a'])
        expect(changed.find((item) => item.id === 'a')?.folder).toBe(folderKey)
    })

    it('destroys and recreates Sortable when viewport and mobile drag settings change', async () => {
        await render([entry('a'), entry('b')])
        expect(sortableMock.create).toHaveBeenCalledTimes(1)
        const first = sortableMock.instances[0]

        environmentMock.db.disableMobileDragDrop = true
        setMobileViewport(true)
        await tick()
        expect(first.destroy).toHaveBeenCalledTimes(1)
        expect(sortableMock.create).toHaveBeenCalledTimes(1)

        environmentMock.db.disableMobileDragDrop = false
        setMobileViewport(false)
        await tick()
        expect(sortableMock.create).toHaveBeenCalledTimes(2)
    })

    it('does not create Sortable when drag is disabled', async () => {
        await render([entry('a')], { dragEnabled: false })
        expect(sortableMock.create).not.toHaveBeenCalled()
    })

    it('restores Sortable DOM mutation before applying a valid pure data move', async () => {
        let domAtChange: string[] = []
        const onChange = vi.fn((_entries: loreBook[]) => {
            domAtChange = [...document.body.querySelectorAll<HTMLElement>('[data-lorebook-row]')]
                .map((row) => row.dataset.lorebookRow!)
        })
        await render([entry('a'), entry('b'), entry('c')], { onChange })
        const list = document.body.querySelector<HTMLElement>('.lore-rows')!
        const source = list.querySelector<HTMLElement>('[data-lorebook-row="c"]')!
        const target = list.querySelector<HTMLElement>('[data-lorebook-row="b"]')!
        const options = sortableMock.options!

        options.onStart?.({ item: source })
        options.onMove?.({ dragged: source, related: target, relatedRect: rect(40, 80) },
            new MouseEvent('mousemove', { clientY: 45 }))
        list.insertBefore(source, target)
        expect([...list.querySelectorAll<HTMLElement>('[data-lorebook-row]')]
            .map((row) => row.dataset.lorebookRow)).toEqual(['a', 'c', 'b'])
        options.onEnd?.({ item: source, to: list, newIndex: 1 })

        expect(domAtChange).toEqual(['a', 'b', 'c'])
        expect((onChange.mock.calls[0][0] as loreBook[]).map((item) => item.id))
            .toEqual(['a', 'c', 'b'])
    })

    it('restores Sortable DOM mutation even when no drop intent exists', async () => {
        const onChange = vi.fn()
        await render([entry('a'), entry('b'), entry('c')], { onChange })
        const list = document.body.querySelector<HTMLElement>('.lore-rows')!
        const source = list.querySelector<HTMLElement>('[data-lorebook-row="b"]')!
        const options = sortableMock.options!

        options.onStart?.({ item: source })
        list.insertBefore(source, list.firstElementChild)
        options.onEnd?.({ item: source, to: list, newIndex: 0 })

        expect([...list.querySelectorAll<HTMLElement>('[data-lorebook-row]')]
            .map((row) => row.dataset.lorebookRow)).toEqual(['a', 'b', 'c'])
        expect(onChange).not.toHaveBeenCalled()
    })

    it('opens Lore Builder for the active entry and applies the edited draft only there', async () => {
        const onChange = vi.fn()
        await render([entry('one'), entry('two')], { onChange })
        click('[data-lorebook-row="one"] [data-lorebook-open]')
        await tick()
        click('[data-lore-builder-open]')
        await vi.waitFor(() => expect(document.body.querySelector('[data-lore-builder-draft]')).not.toBeNull())

        const original = document.body.querySelector<HTMLTextAreaElement>('[data-lore-builder-original]')!
        const draft = document.body.querySelector<HTMLTextAreaElement>('[data-lore-builder-draft]')!
        expect(original.value).toBe('content:one')
        expect(draft.value).toBe('')
        draft.value = '# Rewritten one'
        draft.dispatchEvent(new Event('input', { bubbles: true }))
        await tick()
        click('[data-lore-builder-apply]')
        await tick()

        const changed = onChange.mock.calls.at(-1)?.[0] as loreBook[]
        expect(changed.find((item) => item.id === 'one')?.content).toBe('# Rewritten one')
        expect(changed.find((item) => item.id === 'two')?.content).toBe('content:two')
        await vi.waitFor(() => expect(document.body.querySelector('[data-lore-builder-draft]')).toBeNull())
    })
})

describe('LoreBookWorkspaceDialog source contract', () => {
    it('opens a Grimoire end-user guide from the square help button beside close', async () => {
        mounted = mount(LoreBookWorkspaceDialog, {
            target: document.body.appendChild(document.createElement('div')),
            props: {
                open: true,
                entries: [entry('one')],
                scopeLabel: 'Dialog lore',
                bardMode: true,
                onChange: vi.fn(),
            },
        })
        await vi.waitFor(() => expect(document.body.querySelector('[data-bard-lore-guide-open]')).not.toBeNull())

        click('[data-bard-lore-guide-open]')
        await tick()

        const guide = document.body.querySelector('[data-bard-lore-guide]')
        expect(guide).not.toBeNull()
        expect(guide?.textContent).toContain(languageEnglish.lorebookWorkspace.bardGuideActivationTitle)
        expect(guide?.textContent).toContain(languageEnglish.lorebookWorkspace.bardRequired)
        expect(guide?.textContent).toContain(languageEnglish.lorebookWorkspace.bardKeyed)
        expect(guide?.textContent).toContain(languageEnglish.lorebookWorkspace.bardRetrieve)
        expect(guide?.textContent).toContain(languageEnglish.lorebookWorkspace.bardNever)
        const toc = guide?.querySelector('[data-bard-lore-guide-toc]')
        expect(toc).not.toBeNull()
        expect(toc?.querySelector('a[href="#bard-guide-writing"]')?.textContent)
            .toContain(languageEnglish.lorebookWorkspace.bardGuideWritingTitle)
        const writing = guide?.querySelector('#bard-guide-writing')
        expect(writing?.textContent).toContain(languageEnglish.lorebookWorkspace.bardGuideWritingSecretTitle)
        expect(writing?.textContent).toContain(languageEnglish.lorebookWorkspace.bardGuideWritingIdentityTitle)
        expect(writing?.textContent).toContain(languageEnglish.lorebookWorkspace.bardGuideWritingKeysTitle)
        expect(writing?.textContent).toContain(languageEnglish.lorebookWorkspace.bardGuideWritingExampleTitle)
    })

    it('commits an active draft when the dialog closes and shows it after reopening', async () => {
        const target = document.body.appendChild(document.createElement('div'))
        const entries = [entry('one')]
        const onChange = vi.fn((next: loreBook[]) => {
            entries.splice(0, entries.length, ...next)
        })
        const component = createClassComponent({
            component: LoreBookWorkspaceDialog,
            target,
            props: {
                open: true,
                entries,
                scopeKey: 'dialog-scope',
                scopeLabel: 'Dialog lore',
                onChange,
            },
        })
        try {
            await vi.waitFor(() => expect(document.body.querySelector('[data-lorebook-row="one"]')).not.toBeNull())
            click('[data-lorebook-row="one"] [data-lorebook-open]')
            await tick()
            const content = document.body.querySelector<HTMLTextAreaElement>('[data-lorebook-field="content"]')!
            content.value = 'saved on close'
            content.dispatchEvent(new Event('input', { bubbles: true }))

            component.$set({ open: false })
            await tick()
            expect(onChange).toHaveBeenCalledWith(expect.arrayContaining([
                expect.objectContaining({ id: 'one', content: 'saved on close' }),
            ]))

            component.$set({ open: true })
            await vi.waitFor(() => expect(document.body.querySelector('[data-lorebook-row="one"]')).not.toBeNull())
            click('[data-lorebook-row="one"] [data-lorebook-open]')
            await tick()
            expect(document.body.querySelector<HTMLTextAreaElement>('[data-lorebook-field="content"]')?.value)
                .toBe('saved on close')
        }
        finally {
            component.$destroy()
        }
    })

    it('declares the wide responsive shell and pointer splitter hooks', () => {
        const source = readFileSync(resolve(
            'src/lib/SideBars/LoreBook/LoreBookWorkspaceDialog.svelte',
        ), 'utf8')
        const workspaceSource = readFileSync(resolve(
            'src/lib/SideBars/LoreBook/LoreBookWorkspace.svelte',
        ), 'utf8')

        expect(source).toContain('min(96vw, 1700px)')
        expect(source).toContain('min(92vh, 1000px)')
        expect(source).toContain('data-lorebook-window-resize')
        expect(workspaceSource).toContain('data-lorebook-splitter')
        expect(workspaceSource).not.toContain('minmax(19rem')
        expect(workspaceSource).toContain('left: calc(var(--lore-effective-list-width) - .25rem)')
        expect(workspaceSource).toContain('container-name: lore-workbench')
        expect(workspaceSource).toContain('@container lore-workbench (max-width: 1199px)')
        expect(workspaceSource).not.toContain('@container (max-width: 31rem)')
        expect(workspaceSource).toContain('grid-template-rows: auto minmax(0, 1fr)')
        expect(workspaceSource).toContain('grid-column: 1 / -1')
        expect(workspaceSource).toContain('content-visibility: auto')
        expect(workspaceSource).toContain('contain-intrinsic-size: auto 3.05rem')
        expect(workspaceSource).toContain('touch-action: manipulation')
        expect(workspaceSource).toContain('scopeKey?: string')
        expect(source).toContain('scopeKey?: string')
        expect(source).toContain('{scopeKey}')
        expect(workspaceSource).not.toContain('.folder-disclosure')
        expect(workspaceSource).not.toContain('data-lorebook-drag-handle')
        expect(workspaceSource).toContain('.row-select-hit-area { display: grid; min-width: 3rem; min-height: 3rem; place-items: center; }')
        expect(workspaceSource).toContain('[data-lorebook-select] { width: 1rem; min-width: 1rem; height: 1rem; min-height: 1rem; margin: 0; }')
        expect(workspaceSource).not.toContain('.folder-disclosure, [data-lorebook-select]')
        expect(source).not.toContain('lorebookWorkspace.description')
        expect(source).toContain('lore-dialog-close')
        expect(workspaceSource).toContain('folder-open-bold.svg')
        expect(workspaceSource).toContain('folder-bold.svg')
        expect(workspaceSource).toContain('document-add-bold.svg')
        expect(workspaceSource).toContain('add-folder-bold.svg')
        expect(workspaceSource).toContain('file-download-bold.svg')
        expect(workspaceSource).toContain('file-send-bold.svg')
    })

    it('keeps the content heading intrinsic and gives remaining height to the textarea', () => {
        const workspaceSource = readFileSync(resolve(
            'src/lib/SideBars/LoreBook/LoreBookWorkspace.svelte',
        ), 'utf8')
        const contentFieldRule = workspaceSource.match(/\.content-field\s*\{([^}]*)\}/)?.[1]

        expect(contentFieldRule).toContain('grid-template-rows: auto minmax(0, 1fr)')
    })

    it('keeps the Bard inspector readable and lets the toolbar wrap instead of overflowing', () => {
        const workspaceSource = readFileSync(resolve(
            'src/lib/SideBars/LoreBook/LoreBookWorkspace.svelte',
        ), 'utf8')

        expect(workspaceSource).toContain('var(--lore-state-width, 20rem)')
        expect(workspaceSource).toContain('class="bard-field"')
        expect(workspaceSource).toContain('flex-wrap: wrap')
        expect(workspaceSource).not.toContain('flex-wrap: nowrap')
        expect(workspaceSource).toContain('compact')
    })

    it('derives explicit hierarchy and drag colors from canonical theme tokens', () => {
        const source = readFileSync(resolve('src/lib/SideBars/LoreBook/LoreBookWorkspace.svelte'), 'utf8')

        for (const token of [
            '--lore-surface-root',
            '--lore-surface-folder',
            '--lore-surface-child',
            '--lore-hierarchy-line',
            '--lore-selection',
            '--lore-drop-target',
        ]) expect(source).toContain(token)
        expect(source).not.toContain('#c85d5d')
    })

    it('keeps the built-in light scheme on crisp neutral surfaces', () => {
        const paletteSource = readFileSync(resolve(
            'src/ts/gui/colorschemePalettes.ts',
        ), 'utf8')
        const schemeSource = readFileSync(resolve(
            'src/ts/gui/colorscheme.ts',
        ), 'utf8')
        const lightScheme = paletteSource.match(
            /export const lightColorScheme:[\s\S]*?type: 'light',\s*}/,
        )?.[0]

        expect(lightScheme).toContain("bgcolor: '#f7f7f8'")
        expect(lightScheme).toContain("darkbg: '#ffffff'")
        expect(lightScheme).toContain("darkBorderc: '#e5e7eb'")
        expect(paletteSource).toContain('light: lightColorScheme')
        expect(schemeSource).toContain(
            'colorScheme = resolveBuiltInColorScheme(normalizedName, colorScheme)'
        )
    })

    it('uses one OpenAI-style application font stack without lorebook typeface overrides', () => {
        const workspaceSource = readFileSync(resolve(
            'src/lib/SideBars/LoreBook/LoreBookWorkspace.svelte',
        ), 'utf8')
        const globalSource = readFileSync(resolve('src/styles.css'), 'utf8')
        const colorSchemeSource = readFileSync(resolve('src/ts/gui/colorscheme.ts'), 'utf8')
        const applicationStack = '"OpenAI Sans", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI Variable Text", "Segoe UI", "Noto Sans KR", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif'

        expect(globalSource).toContain(`--risu-font-family: ${applicationStack};`)
        expect(colorSchemeSource).toContain(`'${applicationStack}'`)
        expect(workspaceSource).not.toContain('ui-monospace')
        expect(workspaceSource).not.toContain("'Cascadia Code'")
        expect(workspaceSource).not.toContain('Georgia')
        expect(workspaceSource).not.toContain("'Times New Roman'")
        expect(workspaceSource).toContain('font-size: 100%;')
        expect(workspaceSource).not.toContain('font-size: 110%;')
        expect(workspaceSource).toContain('.row-title strong { font-size: .84rem; font-weight: 600; }')
        expect(workspaceSource).toContain('.lore-content {')
        expect(workspaceSource).toContain('font-family: inherit;')
    })

    it('mounts pointer resize/reset handlers and removes them on teardown', async () => {
        const target = document.body.appendChild(document.createElement('div'))
        mounted = mount(LoreBookWorkspaceDialog, {
            target,
            props: {
                open: true,
                entries: [entry('one')],
                scopeLabel: 'Dialog lore',
                onChange: vi.fn(),
            },
        })
        await vi.waitFor(() => expect(document.body.querySelector('[data-lorebook-splitter]')).not.toBeNull())
        const shell = document.body.querySelector<HTMLElement>('.lore-workspace')!
        const splitter = document.body.querySelector<HTMLElement>('[data-lorebook-splitter]')!
        shell.getBoundingClientRect = () => ({ ...rect(0, 600), left: 0, right: 1000, width: 1000 })
        document.body.querySelector<HTMLElement>('.lore-list-pane')!.getBoundingClientRect = () => ({ ...rect(0, 600), width: 380 })
        splitter.setPointerCapture = vi.fn()
        splitter.hasPointerCapture = vi.fn(() => true)
        splitter.releasePointerCapture = vi.fn()

        splitter.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 7, clientX: 380 }))
        window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 7, clientX: 900 }))
        expect(splitter.setPointerCapture).toHaveBeenCalledWith(7)
        expect(shell.style.getPropertyValue('--lore-list-ratio')).toBe('76%')
        splitter.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 7, clientX: 100 }))
        expect(shell.style.getPropertyValue('--lore-list-ratio')).toBe('12%')
        splitter.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 8, clientX: 600 }))
        expect(shell.style.getPropertyValue('--lore-list-ratio')).toBe('12%')
        splitter.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, pointerId: 7 }))
        expect(splitter.releasePointerCapture).toHaveBeenCalledWith(7)
        splitter.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 7, clientX: 600 }))
        expect(shell.style.getPropertyValue('--lore-list-ratio')).toBe('12%')
        splitter.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
        expect(shell.style.getPropertyValue('--lore-list-ratio')).toBe('38%')

        splitter.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 7, clientX: 380 }))
        await unmount(mounted)
        mounted = undefined
        shell.style.setProperty('--lore-list-ratio', '31%')
        splitter.dispatchEvent(new PointerEvent('pointermove', { pointerId: 7, clientX: 700 }))
        expect(shell.style.getPropertyValue('--lore-list-ratio')).toBe('31%')
    })

    it('resizes the centered window from edges and corners and clamps it to the viewport', async () => {
        mounted = mount(LoreBookWorkspaceDialog, {
            target: document.body.appendChild(document.createElement('div')),
            props: { open: true, entries: [entry('one')], scopeLabel: 'Dialog lore', onChange: vi.fn() },
        })
        await vi.waitFor(() => expect(document.body.querySelector('.lore-dialog')).not.toBeNull())
        const dialog = document.body.querySelector<HTMLElement>('.lore-dialog')!
        dialog.getBoundingClientRect = () => ({ ...rect(0, 600), width: 800, height: 600 })
        const corner = document.body.querySelector<HTMLElement>('[data-lorebook-window-resize="se"]')!
        expect(corner).not.toBeNull()
        corner.setPointerCapture = vi.fn()
        corner.hasPointerCapture = vi.fn(() => true)
        corner.releasePointerCapture = vi.fn()
        corner.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 2, clientX: 800, clientY: 600, bubbles: true }))
        corner.dispatchEvent(new PointerEvent('pointermove', { pointerId: 2, clientX: 700, clientY: 520, bubbles: true }))
        expect(dialog.style.getPropertyValue('--lore-dialog-width')).toBe('600px')
        expect(dialog.style.getPropertyValue('--lore-dialog-height')).toBe('440px')
        corner.dispatchEvent(new PointerEvent('pointermove', { pointerId: 2, clientX: 3000, clientY: 3000, bubbles: true }))
        expect(parseFloat(dialog.style.getPropertyValue('--lore-dialog-width'))).toBe(window.innerWidth - 16)
        expect(parseFloat(dialog.style.getPropertyValue('--lore-dialog-height'))).toBe(window.innerHeight - 16)
        corner.dispatchEvent(new PointerEvent('pointerup', { pointerId: 2, bubbles: true }))
        const west = document.body.querySelector<HTMLElement>('[data-lorebook-window-resize="w"]')!
        west.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
        expect(dialog.style.getPropertyValue('--lore-dialog-width')).toBe('768px')
        west.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }))
        expect(dialog.style.getPropertyValue('--lore-dialog-width')).toBe('')
        expect(dialog.style.getPropertyValue('--lore-dialog-height')).toBe('')
    })
})

describe('LoreBookWorkspace lore builder connection', () => {
    it('opens against a captured normal entry and applies only its content', () => {
        const workspace = readFileSync(resolve('src/lib/SideBars/LoreBook/LoreBookWorkspace.svelte'), 'utf8')

        expect(workspace).toContain("import LoreBuilder from 'src/lib/Others/LoreBuilder.svelte'")
        expect(workspace).toContain('data-lore-builder-open')
        expect(workspace).toContain('function openLoreBuilder()')
        expect(workspace).toContain("commitDraft('content')")
        expect(workspace).toContain('function applyLoreBuilderDraft(content: string)')
        expect(workspace).toContain("patchEntry(loreBuilderTarget.id, { content })")
        expect(workspace).toContain('<LoreBuilder')
        expect(workspace).toContain('targetEntryId={loreBuilderTarget.id}')
    })

    it('gives the builder and condition actions the new-lore hierarchy', () => {
        const workspace = readFileSync(resolve('src/lib/SideBars/LoreBook/LoreBookWorkspace.svelte'), 'utf8')

        expect(workspace).toContain("import magicWandIcon from 'src/assets/solar-bold/magic-wand-bold.svg'")
        expect(workspace).toMatch(/data-lore-builder-open[^>]*class="content-action lore-builder-launch"/)
        expect(workspace).toContain('<SolarIcon src={magicWandIcon} name="magic-wand-bold" size="1.15rem" />')
        expect(workspace).toMatch(/data-cbs-view-toggle[^>]*class="content-action"/)
        expect(workspace).toContain('.content-heading .content-action')
        expect(workspace).toContain('font-size: .8rem')
        expect(workspace).toContain('font-weight: 650')
        expect(workspace).toContain('.content-heading .lore-builder-launch')
        expect(workspace).toContain('background: var(--color-selected)')
    })
})
