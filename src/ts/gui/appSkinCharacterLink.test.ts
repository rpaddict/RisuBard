import { beforeEach, describe, expect, test, vi } from 'vitest'
import { selectedCharID } from '../stores.svelte'
import { alertConfirm } from '../alert'
import {
    APP_SKIN_STYLE_ID,
    characterAppSkinId,
    effectiveAppSkinId,
    removeAppSkin,
    selectAppSkin,
    toggleCharacterAppSkin,
} from './appSkinRuntime'
import { BUILTIN_APP_SKINS } from './builtinSkins'

const state = vi.hoisted(() => ({ db: {} as any }))

vi.mock('../storage/database.svelte', () => ({ getDatabase: () => state.db }))
vi.mock('../globalApi.svelte', () => ({ downloadFile: vi.fn(), loadAsset: vi.fn(), saveAsset: vi.fn() }))
vi.mock('../util', () => ({ BufferToText: vi.fn(), selectSingleFile: vi.fn() }))
vi.mock('../alert', () => ({ alertConfirm: vi.fn(), notifyError: vi.fn(), notifySuccess: vi.fn(), notifyWarning: vi.fn() }))
vi.mock('../stores.svelte', async () => {
    const { writable } = await import('svelte/store')
    return { SafeModeStore: writable(false), selectedCharID: writable(-1) }
})


beforeEach(() => {
    document.getElementById(APP_SKIN_STYLE_ID)?.remove()
    delete document.documentElement.dataset.risuSkin
    state.db = {
        appSkins: [],
        appSkinId: 'rounded',
        characterAppSkins: {},
        characters: [{ chaId: 'bot-a' }, { chaId: 'bot-b' }],
    }
    selectedCharID.set(0)
})

describe('bot-linked app skin', () => {
    test('follows the app-wide skin until a skin is linked', () => {
        expect(characterAppSkinId()).toBeNull()
        expect(effectiveAppSkinId()).toBe('rounded')
        toggleCharacterAppSkin('hero-comic')
        expect(state.db.characterAppSkins).toEqual({ 'bot-a': 'hero-comic' })
        expect(effectiveAppSkinId()).toBe('hero-comic')
        expect(document.documentElement.dataset.risuSkin).toBe('hero-comic')
    })

    test('applies only to the linked bot', () => {
        toggleCharacterAppSkin('hero-comic')
        expect(effectiveAppSkinId(state.db, 1)).toBe('rounded')
        selectedCharID.set(-1)
        expect(effectiveAppSkinId()).toBe('rounded')
    })

    test('picking the linked skin again unlinks it', () => {
        toggleCharacterAppSkin('hero-comic')
        toggleCharacterAppSkin('hero-comic')
        expect(state.db.characterAppSkins).toEqual({})
        expect(document.documentElement.dataset.risuSkin).toBe('rounded')
    })

    test('can link the default look over an app-wide skin', () => {
        toggleCharacterAppSkin('')
        expect(characterAppSkinId()).toBe('')
        expect(effectiveAppSkinId()).toBe('')
        expect(document.documentElement.dataset.risuSkin).toBeUndefined()
        toggleCharacterAppSkin('')
        expect(characterAppSkinId()).toBeNull()
    })

    test('changing the app-wide skin keeps the bot link', () => {
        toggleCharacterAppSkin('hero-comic')
        selectAppSkin('')
        expect(state.db.appSkinId).toBe('')
        expect(document.documentElement.dataset.risuSkin).toBe('hero-comic')
    })

    test('a missing linked skin falls back to the app-wide skin', () => {
        state.db.characterAppSkins = { 'bot-a': 'gone' }
        expect(characterAppSkinId()).toBeNull()
        expect(effectiveAppSkinId()).toBe('rounded')
    })

    test('removing a skin removes its bot links', async () => {
        vi.mocked(alertConfirm).mockResolvedValueOnce(true)
        state.db.appSkins = [{ ...BUILTIN_APP_SKINS.find((entry) => entry.id === 'hero-comic')! }]
        state.db.characterAppSkins = { 'bot-a': 'hero-comic', 'bot-b': 'rounded' }
        await removeAppSkin('hero-comic')
        expect(state.db.characterAppSkins).toEqual({ 'bot-b': 'rounded' })
    })

    test('does nothing without an open bot', () => {
        selectedCharID.set(-1)
        toggleCharacterAppSkin('hero-comic')
        expect(state.db.characterAppSkins).toEqual({})
    })
})
