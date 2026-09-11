// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { mount, tick, unmount } from 'svelte'
import { writable } from 'svelte/store'
import Chat from './Chat.svelte'
import Chats from './Chats.svelte'
import { DBState, selIdState } from 'src/ts/stores.svelte'

vi.mock('src/ts/stores.svelte', () => ({
    DBState: { db: {} },
    selIdState: { selId: 0 },
    selectedCharID: writable(0),
    ReloadChatPointer: writable({}),
    ReloadGUIPointer: writable(0),
    CurrentTriggerIdStore: writable(null),
    popupStore: writable([]),
    HideIconStore: writable(false),
    createSimpleCharacter: vi.fn((character) => character),
}))
vi.mock('src/ts/globalApi.svelte', () => ({
    aiLawApplies: vi.fn(() => false),
    changeChatTo: vi.fn(),
    foldChatToMessage: vi.fn(),
    getFileSrc: vi.fn(),
    createChatCopyName: vi.fn(),
    forageStorage: { createAuth: vi.fn() },
    requestImmediateSave: vi.fn(),
}))
vi.mock('src/ts/risubard/memoryWiki', () => ({ retractWikiEventsBySourceMessages: vi.fn() }))
vi.mock('src/ts/risubard/memoryEvents', () => ({ announceRisuBardMemoryUpdated: vi.fn() }))
vi.mock('src/ts/risubard/memoryWikiFork', () => ({ completeMemoryWikiFork: vi.fn(), forkMemoryWiki: vi.fn() }))
vi.mock('src/ts/gui/colorscheme', () => ({ ColorSchemeTypeStore: writable('dark') }))
vi.mock('src/ts/model/modellist', () => ({ getModelInfo: vi.fn(() => null) }))
vi.mock('src/ts/process/scriptings', () => ({ runLuaButtonTrigger: vi.fn() }))
vi.mock('src/ts/process/scripts', () => ({ risuChatParser: vi.fn((value: string) => value) }))
vi.mock('src/ts/process/triggers', () => ({ runTrigger: vi.fn() }))
vi.mock('src/ts/process/tts', () => ({ sayTTS: vi.fn() }))
vi.mock('src/ts/util', () => ({
    capitalize: (value: string) => value,
    getUserIcon: vi.fn(),
    getUserName: vi.fn(),
    sleep: vi.fn(),
}))
vi.mock('src/ts/characters', () => ({ getCharImage: vi.fn(async () => '') }))
vi.mock('src/lang', () => ({ language: new Proxy({}, { get: (_, key) => String(key) }) }))
vi.mock('src/ts/alert', () => ({
    alertClear: vi.fn(), alertConfirm: vi.fn(), alertConfirmMulti: vi.fn(), alertInput: vi.fn(),
    alertRequestData: vi.fn(), alertWait: vi.fn(), notifyError: vi.fn(), notifyInfo: vi.fn(), notifySuccess: vi.fn(),
}))
vi.mock('src/ts/parser/parser.svelte', () => ({
    ParseMarkdown: vi.fn(async (value: string) => value),
    addMetadataToElement: vi.fn((value: string) => value),
    getDistance: vi.fn(),
    postTranslationParse: vi.fn((value: string) => value),
    resolveInlayPlaceholders: vi.fn((value: string) => value),
    trimMarkdown: vi.fn((value: string) => value),
}))
vi.mock('src/ts/translator/translator', () => ({ getLLMCache: vi.fn(), setLLMCache: vi.fn() }))
vi.mock('src/ts/storage/database.svelte', () => ({
    getCurrentCharacter: vi.fn(() => DBState.db.characters[0]),
    getCurrentChat: vi.fn(() => DBState.db.characters[0].chats[0]),
    setCurrentChat: vi.fn(),
}))

let mounted: ReturnType<typeof mount> | undefined

beforeEach(() => {
    DBState.db = {
        theme: '',
        zoomsize: 100,
        lineHeight: 1.25,
        iconsize: 100,
        roundIcons: false,
        nodeOnlyStandardChatWidth: 'normal',
        translator: '',
        clickToEdit: false,
        enableBlockPartialEdit: false,
        enableDragPartialEdit: false,
        characters: [{
            chaId: 'character-1',
            chatPage: 0,
            chats: [{ message: [{ role: 'user', data: 'editable message', chatId: 'message-1' }] }],
            ttsMode: 'none',
        }],
    } as unknown as typeof DBState.db
    selIdState.selId = 0
})

afterEach(async () => {
    if (mounted) await unmount(mounted)
    mounted = undefined
    document.body.replaceChildren()
})

describe('message edit button', () => {
    test('opens the message textarea when the pencil button is clicked', async () => {
        mounted = mount(Chat, {
            target: document.body,
            props: {
                message: 'editable message',
                name: 'User',
                isLastMemory: false,
                idx: 0,
                role: 'user',
            },
        })
        await tick()

        document.querySelector<HTMLButtonElement>('.button-icon-edit')!.click()
        await tick()

        const editor = document.querySelector<HTMLTextAreaElement>('.message-edit-area')
        expect(editor).not.toBeNull()
        expect(editor?.value).toBe('editable message')
        expect(document.activeElement).toBe(editor)
    })

    test('keeps the editor open inside the live message list', async () => {
        const currentCharacter = DBState.db.characters[0]
        mounted = mount(Chats, {
            target: document.body,
            props: {
                messages: currentCharacter.chats[0].message,
                currentCharacter,
                onReroll: vi.fn(),
                unReroll: vi.fn(),
                currentUsername: 'User',
                userIcon: '',
                pageStart: 0,
                pageEnd: 1,
            },
        })
        await tick()

        document.querySelector<HTMLButtonElement>('.button-icon-edit')!.click()
        await tick()

        expect(document.querySelector<HTMLTextAreaElement>('.message-edit-area')).not.toBeNull()
    })
})
