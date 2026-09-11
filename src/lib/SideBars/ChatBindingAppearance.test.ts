import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { mount, tick, unmount } from 'svelte'
import { get } from 'svelte/store'
import { DBState, selectedCharID, openPersonaList, openPersonaManager, personaSelectCallback } from 'src/ts/stores.svelte'
import { alertConfirmMulti, alertSelect } from 'src/ts/alert'
import PersonaBind from './PersonaBind.svelte'
import PromptBind from './PromptBind.svelte'

vi.mock('src/ts/stores.svelte', async () => {
    const { writable } = await import('svelte/store')
    return {
        DBState: { db: {} }, selectedCharID: writable(0), selIdState: { selId: 0 },
        openPersonaList: writable(false), openPersonaManager: writable(false), personaSelectCallback: writable(null),
        openPresetList: writable(false), presetSelectCallback: writable(null),
    }
})
vi.mock('src/ts/storage/database.svelte', () => ({
    getCurrentChat: vi.fn(), changeToPreset: vi.fn(),
}))
vi.mock('src/ts/alert', () => ({
    alertConfirmMulti: vi.fn(), alertSelect: vi.fn(), notifySuccess: vi.fn(), alertMd: vi.fn(),
}))
vi.mock('src/ts/characters', () => ({ getCharImage: async (icon: string) => icon }))
vi.mock('src/lang', () => ({ language: {
    personaBindingLabel: '페르소나 바인딩', promptBindingLabel: '프롬프트 바인딩',
    promptPresetParamsUse: '파라미터', none: '없음',
} }))

let mounted: ReturnType<typeof mount> | undefined

beforeEach(() => {
    DBState.db = {
        personas: [{ id: 'persona-1', name: '페르소나', icon: '', personaPrompt: '' }],
        selectedPersona: 0,
        botPresets: [{ id: 'preset-1', name: '프롬프트' }], botPresetsId: 0,
        characters: [0, 1].map(() => ({ chatPage: 0, chats: [{
            bindedPersona: '', bindedBotPreset: '',
        }] })),
    } as typeof DBState.db
    selectedCharID.set(0)
    openPersonaList.set(false)
    openPersonaManager.set(false)
    personaSelectCallback.set(null)
    vi.mocked(alertSelect).mockReset()
    vi.mocked(alertConfirmMulti).mockReset()
})

afterEach(async () => {
    if (mounted) await unmount(mounted)
    mounted = undefined
    document.body.replaceChildren()
})

describe.each([
    { name: 'persona', mountBinding: () => mount(PersonaBind, { target: document.body }), key: 'bindedPersona' as const, id: 'persona-1' },
    { name: 'prompt', mountBinding: () => mount(PromptBind, { target: document.body }), key: 'bindedBotPreset' as const, id: 'preset-1' },
])('$name binding appearance', ({ mountBinding, key, id }) => {
    test.each(['bound', 'unbound', 'missing'] as const)('uses the editable binding pair only when %s resolves', async (state) => {
        DBState.db.characters[0].chats[0][key] = state === 'bound' ? id : state === 'missing' ? 'deleted-id' : ''
        mounted = mountBinding()
        await tick()
        const button = document.body.querySelector('button')!
        expect(button.classList.contains('bg-binding')).toBe(state === 'bound')
        expect(button.classList.contains('text-binding-text')).toBe(state === 'bound')
        expect(button.classList.contains('border-binding-border')).toBe(state === 'bound')
        expect(button.classList.contains('bg-darkbutton')).toBe(state !== 'bound')
    })

    test('removes the highlight when switching to an unbound chat', async () => {
        DBState.db.characters[0].chats[0][key] = id
        mounted = mountBinding()
        await tick()
        expect(document.body.querySelector('button')!.classList.contains('bg-binding')).toBe(true)
        selectedCharID.set(1)
        await tick()
        expect(document.body.querySelector('button')!.classList.contains('bg-binding')).toBe(false)
    })
})

test('shows one binding-status icon without an empty black avatar tile', async () => {
    DBState.db.characters[0].chats[0].bindedPersona = 'persona-1'
    mounted = mount(PersonaBind, { target: document.body })
    await tick()
    const button = document.body.querySelector('button')!
    expect(button.querySelectorAll('svg')).toHaveLength(1)
    expect(button.querySelector('.bg-darkbg')).toBeNull()
})

test('keeps a configured persona image with one binding-status icon', async () => {
    DBState.db.personas[0].icon = '/persona.png'
    mounted = mount(PersonaBind, { target: document.body })
    await vi.waitFor(() => expect(document.body.querySelector('button img')?.getAttribute('src')).toBe('/persona.png'))
    expect(document.body.querySelectorAll('button svg')).toHaveLength(1)
})

test.each([false, true])('opens the manager instead of the legacy picker when replacing a bound persona=%s', async (bound) => {
    const chat = DBState.db.characters[0].chats[0]
    chat.bindedPersona = bound ? 'persona-1' : ''
    vi.mocked(alertSelect).mockResolvedValue('1')
    vi.mocked(alertConfirmMulti).mockResolvedValue(0)
    const onBindingChange = vi.fn()
    const bindingTarget = { bindedPersona: chat.bindedPersona }
    mounted = mount(PersonaBind, { target: document.body, props: { bindingTarget, onBindingChange } })
    await tick()
    document.body.querySelector('button')!.click()

    await vi.waitFor(() => expect(get(openPersonaManager)).toBe(true))
    expect(get(openPersonaList)).toBe(false)
    expect(get(personaSelectCallback)).toBeTypeOf('function')
    get(personaSelectCallback)!({
        persona: { id: 'selected-persona', name: '다른 페르소나', icon: '', personaPrompt: '' },
        index: 0, scope: 'character',
    })
    expect(bindingTarget.bindedPersona).toBe('selected-persona')
    expect(chat.bindedPersona).toBe(bound ? 'persona-1' : '')
    expect(DBState.db.selectedPersona).toBe(0)
    expect(onBindingChange).toHaveBeenCalledOnce()
})

test('does not open either persona picker when the selection menu is cancelled', async () => {
    vi.mocked(alertSelect).mockResolvedValue('2')
    mounted = mount(PersonaBind, { target: document.body })
    await tick()
    document.body.querySelector('button')!.click()
    await tick()
    expect(get(openPersonaManager)).toBe(false)
    expect(get(openPersonaList)).toBe(false)
    expect(get(personaSelectCallback)).toBeNull()
})
