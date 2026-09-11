import { afterEach, describe, expect, test, vi } from 'vitest'
import { mount, tick, unmount } from 'svelte'
import { writable } from 'svelte/store'
import Toggles from './Toggles.svelte'
import { alertConfirmMulti } from 'src/ts/alert'
import { pinToggleValuesToChat, unpinToggleValuesFromChat } from 'src/ts/storage/database.svelte'

const { chat } = vi.hoisted(() => ({ chat: {
    useLocallySetGlobalVariables: true,
    GLGlobalVariables: { toggle_one: 'changed' },
    togglePresetBaseline: { name: 'Story', values: { toggle_one: 'original' } },
} }))

vi.mock('src/ts/stores.svelte', () => ({
    DBState: { db: { characters: [{ chatPage: 0, chats: [chat] }], globalChatVariables: {} } },
    selectedCharID: writable(0),
    selIdState: { selId: -1 },
}))
vi.mock('src/ts/storage/database.svelte', () => ({
    getCurrentChat: () => chat,
    fillMissingPinnedToggleValues: vi.fn(),
    resetPinnedToggleValues: vi.fn(),
    saveTogglesToChat: vi.fn(),
    pinToggleValuesToChat: vi.fn(),
    unpinToggleValuesFromChat: vi.fn(),
}))
vi.mock('src/ts/process/modules', () => ({ getModuleToggles: () => '' }))
vi.mock('src/ts/util', () => ({ parseToggleSyntax: () => [] }))
vi.mock('src/ts/gui/tooltip', () => ({ tooltip: () => ({}) }))
vi.mock('src/lang', () => ({ language: new Proxy({}, { get: (_, key) => String(key) }) }))
vi.mock('src/ts/alert', () => ({
    alertConfirm: vi.fn(async () => false),
    alertConfirmMulti: vi.fn(),
    alertTogglePresets: vi.fn(),
    notifySuccess: vi.fn(),
}))

let component: ReturnType<typeof mount>
afterEach(async () => {
    if (component) await unmount(component)
    document.body.replaceChildren()
    vi.clearAllMocks()
})

describe('pinned toggle button', () => {
    test.each([0, 1, -1])('supports overwrite, unpin, and cancel (choice %s)', async (choice) => {
        vi.mocked(alertConfirmMulti).mockResolvedValue(choice)
        component = mount(Toggles, { target: document.body })
        await tick()
        const pin = [...document.querySelectorAll('button')].find(button => button.textContent?.includes('Story'))
        expect(pin).toBeDefined()
        pin!.click()
        await tick()

        expect(alertConfirmMulti).toHaveBeenCalledWith('toggleBindingLabel', [
            'togglePinOverwrite',
            { label: 'togglePinUnpin', variant: 'destructive' },
        ])
        if (choice === 0) expect(pinToggleValuesToChat).toHaveBeenCalledWith(chat)
        else expect(pinToggleValuesToChat).not.toHaveBeenCalled()
        if (choice === 1) expect(unpinToggleValuesFromChat).toHaveBeenCalledWith(chat)
        else expect(unpinToggleValuesFromChat).not.toHaveBeenCalled()
    })
})
