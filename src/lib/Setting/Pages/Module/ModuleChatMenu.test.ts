import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { mount, tick, unmount } from 'svelte'
import { get } from 'svelte/store'
import ModuleChatMenu from './ModuleChatMenu.svelte'
import { DBState, ReloadGUIPointer, selectedCharID } from 'src/ts/stores.svelte'
import { requestImmediateSave } from 'src/ts/globalApi.svelte'
import { language } from 'src/lang'

vi.mock('src/ts/stores.svelte', async () => {
    const { writable } = await import('svelte/store')
    return { DBState: { db: {} }, ReloadGUIPointer: writable(0), selectedCharID: writable(0) }
})
vi.mock('src/ts/storage/database.svelte', async () => {
    const { DBState } = await import('src/ts/stores.svelte')
    return { getDatabase: () => DBState.db }
})
vi.mock('src/ts/globalApi.svelte', () => ({ requestImmediateSave: vi.fn() }))
vi.mock('src/ts/alert', () => ({ alertConfirm: vi.fn(), alertInput: vi.fn() }))
vi.mock('src/ts/util', () => ({ checkPersonaBinded: () => null }))

let component: ReturnType<typeof mount> | undefined
beforeEach(() => {
    vi.clearAllMocks()
    selectedCharID.set(0)
    ReloadGUIPointer.set(0)
    DBState.db = {
        modules: [{ id: 'one', name: 'Test module', description: 'A module description' }],
        enabledModules: [],
        characters: [{ chatPage: 0, modules: ['legacy'], chats: [{ modules: [] }, { modules: ['other'] }] }],
        personas: [], personaEnabledModules: {},
        collectionOrganizers: { modules: {
            folders: [{ id: 'folder', name: 'Saved folder', createdAt: 1 }],
            folderByItemId: { one: 'folder' }, itemOrder: ['one'],
        } },
    } as any
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
})
afterEach(async () => {
    if (component) await unmount(component)
    await tick()
    component = undefined
    document.body.replaceChildren()
    vi.unstubAllGlobals()
})

async function openMenu(alertMode = false) {
    const host = document.createElement('div')
    host.style.transform = 'translateX(300px)'
    document.body.append(host)
    const close = vi.fn()
    component = mount(ModuleChatMenu, { target: host, props: { close, alertMode } })
    await tick()
    return { host, close }
}

function scopeButton(scope: 'global' | 'chat') {
    return document.querySelector<HTMLButtonElement>(`button[aria-label="Test module: ${language.chatModuleActivation[scope]}"]`)!
}

describe('chat module manager', () => {
    test('portals the shared folder list outside a shifted chat container', async () => {
        const { host } = await openMenu()
        expect(host.querySelector('[role="dialog"]')).toBeNull()
        const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!
        expect(dialog).not.toBeNull()
        expect(dialog.classList.contains('fixed')).toBe(true)
        expect(dialog.style.maxWidth).toBe('calc(100vw - 2rem)')
        expect(dialog.textContent).toContain('Saved folder')
        expect(dialog.querySelector('[data-collection-organizer-list="modules"]')).not.toBeNull()
        expect(scopeButton('global').getAttribute('aria-pressed')).toBe('false')
        expect(scopeButton('chat').getAttribute('aria-pressed')).toBe('false')
    })

    test('opens from chat entry points without creating per-chat module settings', () => {
        const sidebar = readFileSync('src/lib/SideBars/SideChatList.svelte', 'utf8')
        const chatScreen = readFileSync('src/lib/ChatScreens/DefaultChatScreen.svelte', 'utf8')
        expect(sidebar).not.toMatch(/chats\[char\.chatPage\]\.modules\s*\?\?=/)
        expect(chatScreen).not.toMatch(/chats\[DBState\.db\.characters\[\$selectedCharID\]\.chatPage\]\.modules\s*\?\?=/)
    })

    test('toggles global and current-character scopes without rewriting individual chats', async () => {
        await openMenu()
        scopeButton('chat').click()
        expect(DBState.db.characters[0].modules).toEqual(['legacy', 'one'])
        expect(DBState.db.characters[0].chats[0].modules).toEqual([])
        expect(DBState.db.characters[0].chats[1].modules).toEqual(['other'])
        expect(DBState.db.enabledModules).toEqual([])
        scopeButton('global').click()
        expect(DBState.db.enabledModules).toEqual(['one'])
        scopeButton('global').click()
        expect(DBState.db.enabledModules).toEqual([])
        expect(DBState.db.characters[0].modules).toEqual(['legacy', 'one'])
        scopeButton('chat').click()
        expect(DBState.db.characters[0].chats[0].modules).toEqual([])
        expect(DBState.db.characters[0].chats[1].modules).toEqual(['other'])
        expect(DBState.db.characters[0].modules).toEqual(['legacy'])
        expect(requestImmediateSave).toHaveBeenCalledTimes(4)
        expect(get(ReloadGUIPointer)).toBe(4)
    })

    test('renders compact icon-only scope controls', async () => {
        await openMenu()
        const source = readFileSync('src/lib/Setting/Pages/Module/ModuleChatMenu.svelte', 'utf8')
        const scopes = document.querySelectorAll('.chat-module-scope')
        expect(scopes).toHaveLength(2)
        expect(document.querySelector('.chat-module-scope > span')).toBeNull()
        for (const scope of scopes) {
            const button = scope.querySelector<HTMLButtonElement>('.chat-module-toggle')!
            const icon = button.querySelector('svg')!
            expect(button.textContent).toBe('')
            expect(button.getAttribute('aria-label')).toBeTruthy()
            expect(icon.getAttribute('width')).toBe('19.2')
            expect(icon.getAttribute('height')).toBe('19.2')
        }
        expect(source).toMatch(/\.chat-module-toggle\s*\{[^}]*width:\s*1\.5rem;[^}]*height:\s*1\.5rem;/)
    })

    test('does not initialize or mutate missing per-chat assignments', async () => {
        delete DBState.db.characters[0].chats[0].modules
        await openMenu()
        scopeButton('chat').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }))
        expect(DBState.db.characters[0].modules).toEqual(['legacy'])
        expect(requestImmediateSave).not.toHaveBeenCalled()
        scopeButton('chat').click()
        expect(DBState.db.characters[0].modules).toEqual(['legacy', 'one'])
        expect(DBState.db.characters[0].chats[0].modules).toBeUndefined()
    })

    test('allows character activation even when the character has no current chat', async () => {
        DBState.db.characters[0].chats = []
        await openMenu()
        expect(scopeButton('chat').disabled).toBe(false)
        scopeButton('chat').click()
        expect(DBState.db.characters[0].modules).toEqual(['legacy', 'one'])
    })

    test('disables character activation when no character is selected', async () => {
        selectedCharID.set(-1)
        await openMenu()
        expect(scopeButton('chat').disabled).toBe(true)
    })

    test('preserves the module picker callback without changing activation', async () => {
        const { close } = await openMenu(true)
        expect(scopeButton('global')).toBeNull()
        const select = document.querySelector<HTMLButtonElement>(`.chat-module-row button[aria-label="${language.chatModuleActivation.selectModule.replace('{0}', 'Test module')}"]`)!
        select.click()
        expect(close).toHaveBeenCalledWith('one')
        expect(DBState.db.enabledModules).toEqual([])
        expect(requestImmediateSave).not.toHaveBeenCalled()
    })

    test('reflects activation stored on the current character', async () => {
        DBState.db.characters[0].modules = ['one']
        await openMenu()
        expect(scopeButton('chat').getAttribute('aria-pressed')).toBe('true')
        expect(document.querySelector('.chat-module-inherited')).toBeNull()
    })

    test('closes through the portal dialog close button', async () => {
        const { close } = await openMenu()
        document.querySelector<HTMLButtonElement>(`button[aria-label="${language.close}"]`)!.click()
        await tick()
        expect(close).toHaveBeenCalledWith('')
    })
})
