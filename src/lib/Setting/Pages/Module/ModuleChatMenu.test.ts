import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { mount, tick, unmount } from 'svelte'
import { get } from 'svelte/store'
import ModuleChatMenu from './ModuleChatMenu.svelte'
import { DBState, ReloadGUIPointer, openModuleEditId, selectedCharID } from 'src/ts/stores.svelte'
import { alertConfirm, notifySuccess } from 'src/ts/alert'
import { openSettings, SettingsRoute } from 'src/ts/routing'
import { requestImmediateSave } from 'src/ts/globalApi.svelte'
import { language } from 'src/lang'

vi.mock('src/ts/stores.svelte', async () => {
    const { writable } = await import('svelte/store')
    return { DBState: { db: {} }, ReloadGUIPointer: writable(0), selectedCharID: writable(0), openModuleEditId: writable(null), SafeModeStore: writable(false) }
})
vi.mock('src/ts/storage/database.svelte', async () => {
    const { DBState } = await import('src/ts/stores.svelte')
    return { getDatabase: () => DBState.db, normalizePersonaEnabledModules: (value: unknown) => value ?? {} }
})
vi.mock('src/ts/globalApi.svelte', () => ({ requestImmediateSave: vi.fn() }))
vi.mock('src/ts/alert', () => ({ alertConfirm: vi.fn(), alertInput: vi.fn(), notifySuccess: vi.fn(), notifyError: vi.fn(), notifyWarning: vi.fn() }))
vi.mock('src/ts/routing', () => ({ openSettings: vi.fn(), SettingsRoute: { Module: 14 } }))
vi.mock('src/ts/util', () => ({ checkPersonaBinded: () => null }))

let component: ReturnType<typeof mount> | undefined
beforeEach(() => {
    vi.clearAllMocks()
    selectedCharID.set(0)
    openModuleEditId.set(null)
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

function actionButton(action: 'edit' | 'remove') {
    return document.querySelector<HTMLButtonElement>(`button[aria-label="Test module: ${language[action]}"]`)!
}

function scopeButton(scope: 'global' | 'chat') {
    return document.querySelector<HTMLButtonElement>(`button[aria-label^="Test module: ${language.chatModuleActivation[scope]}"]`)!
}

describe('chat module manager', () => {
    test.each([' Risuco, Other ', 'one'])('highlights preset integration %s without changing manual activation', async (integration) => {
        DBState.db.modules[0].namespace = 'Risuco'
        DBState.db.moduleIntergration = integration
        await openMenu()
        const button = scopeButton('global')
        expect(button.classList.contains('preset-enabled')).toBe(true)
        expect(button.title).toContain(language.chatModuleActivation.presetEnabled)
        expect(button.getAttribute('aria-label')).toContain(language.chatModuleActivation.presetEnabled)
        expect(button.getAttribute('aria-pressed')).toBe('false')
        expect(scopeButton('chat').classList.contains('preset-enabled')).toBe(false)
        expect(DBState.db.enabledModules).toEqual([])
        expect(requestImmediateSave).not.toHaveBeenCalled()
        button.click()
        expect(DBState.db.enabledModules).toEqual(['one'])
        button.click()
        expect(DBState.db.enabledModules).toEqual([])
        expect(DBState.db.moduleIntergration).toBe(integration)
        expect(button.classList.contains('preset-enabled')).toBe(true)
    })

    test('keeps preset highlighting when also enabled manually', async () => {
        DBState.db.moduleIntergration = 'one'
        DBState.db.enabledModules = ['one']
        await openMenu()
        expect(scopeButton('global').classList.contains('preset-enabled')).toBe(true)
        expect(scopeButton('global').getAttribute('aria-pressed')).toBe('true')
    })

    test.each(['', 'risuco', 'RisucoExtra', 'Test module'])('does not highlight unmatched integration %s', async (integration) => {
        DBState.db.modules[0].namespace = 'Risuco'
        DBState.db.moduleIntergration = integration
        await openMenu()
        expect(scopeButton('global').classList.contains('preset-enabled')).toBe(false)
        expect(scopeButton('global').title).toBe(language.chatModuleActivation.globalHint)
    })

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

    test('opens the module editor in settings from the edit button', async () => {
        const { close } = await openMenu()
        actionButton('edit').click()
        expect(get(openModuleEditId)).toBe('one')
        expect(openSettings).toHaveBeenCalledWith(SettingsRoute.Module)
        expect(close).toHaveBeenCalledWith('')
    })

    test('disables editing for MCP modules like the settings page', async () => {
        DBState.db.modules[0].mcp = { url: 'http://localhost' } as any
        await openMenu()
        expect(actionButton('edit').disabled).toBe(true)
        expect(actionButton('remove').disabled).toBe(false)
    })

    test('deletes a module only after confirmation', async () => {
        DBState.db.enabledModules = ['one']
        vi.mocked(alertConfirm).mockResolvedValueOnce(false)
        await openMenu()
        actionButton('remove').click()
        await vi.waitFor(() => expect(alertConfirm).toHaveBeenCalledWith(language.removeConfirm + 'Test module'))
        expect(DBState.db.modules).toHaveLength(1)

        vi.mocked(alertConfirm).mockResolvedValueOnce(true)
        actionButton('remove').click()
        await vi.waitFor(() => expect(DBState.db.modules).toEqual([]))
        expect(DBState.db.enabledModules).toEqual([])
        expect(DBState.db.collectionOrganizers.modules.folderByItemId).toEqual({})
        expect(notifySuccess).toHaveBeenCalledWith(language.moduleDeleted)
        expect(requestImmediateSave).toHaveBeenCalledTimes(1)
    })

    test('links a skin to the open bot from the skins tab', async () => {
        DBState.db.characters[0].chaId = 'bot-a'
        DBState.db.appSkins = []
        DBState.db.appSkinId = ''
        DBState.db.characterAppSkins = {}
        DBState.db.colorScheme = {} as typeof DBState.db.colorScheme
        await openMenu()
        const tab = [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((item) => item.textContent === language.appSkin.botTab)!
        tab.click()
        await tick()
        expect(document.querySelector('[data-collection-organizer-list="modules"]')).toBeNull()
        const card = document.querySelector<HTMLButtonElement>('[data-character-app-skin="rounded"]')!
        expect(card.getAttribute('aria-pressed')).toBe('false')
        card.click()
        await tick()
        expect(DBState.db.characterAppSkins).toEqual({ 'bot-a': 'rounded' })
        expect(requestImmediateSave).toHaveBeenCalledTimes(1)
        expect(DBState.db.appSkinId).toBe('')
    })

    test('marks the skin already linked to the open bot', async () => {
        DBState.db.characters[0].chaId = 'bot-a'
        DBState.db.appSkins = []
        DBState.db.appSkinId = 'rounded'
        DBState.db.characterAppSkins = { 'bot-a': 'hero-comic' }
        DBState.db.colorScheme = {} as typeof DBState.db.colorScheme
        await openMenu()
        ;[...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((item) => item.textContent === language.appSkin.botTab)!.click()
        await tick()
        expect(document.querySelector('[data-character-app-skin="hero-comic"]')!.getAttribute('aria-pressed')).toBe('true')
        expect(document.querySelector('[data-character-app-skin="rounded"]')!.getAttribute('aria-pressed')).toBe('false')
        expect(document.querySelector('[data-character-app-skin="rounded"]')!.textContent).toContain(language.appSkin.botGlobal)
    })

    test('hides the skins tab in the module picker', async () => {
        await openMenu(true)
        expect(document.querySelector('[role="tab"]')).toBeNull()
    })

    test('hides edit and delete in the module picker', async () => {
        await openMenu(true)
        expect(actionButton('edit')).toBeNull()
        expect(actionButton('remove')).toBeNull()
    })
})
