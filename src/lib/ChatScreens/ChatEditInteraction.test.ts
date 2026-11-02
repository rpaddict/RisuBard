// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { mount, tick, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { SvelteMap } from 'svelte/reactivity'
import Chat from './Chat.svelte'
import Chats from './Chats.svelte'
import { DBState, selIdState } from 'src/ts/stores.svelte'
import { ParseMarkdown } from 'src/ts/parser/parser.svelte'

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
vi.mock('src/ts/risubard/memoryEvents', async importOriginal => ({
    ...await importOriginal<typeof import('src/ts/risubard/memoryEvents')>(),
    announceRisuBardMemoryUpdated: vi.fn(),
}))
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
    test.each([
        { width: 390, inline: undefined, direct: false },
        { width: 390, inline: true, direct: true },
        { width: 640, inline: false, direct: true },
    ])('shows message actions at $width px with inline=$inline and saves quick edits', async ({ width, inline, direct }) => {
        const originalWidth = window.innerWidth
        window.innerWidth = width
        DBState.db.translator = 'en'
        DBState.db.mobileMessageActionsInline = inline
        DBState.db.characters[0].chats[0].message[0].role = 'char'
        const onReroll = vi.fn()
        try {
            mounted = mount(Chat, { target: document.body, props: {
                message: 'editable message', name: 'Character', isLastMemory: false, idx: 0, role: 'char',
                rerollIcon: true, onReroll,
            } })
            await tick(); await tick()
            if (direct) {
                expect(document.querySelector('.mobile-message-actions .button-icon-menu')).toBeNull()
            } else {
                expect(document.querySelector('.button-icon-translate')).toBeNull()
                expect(document.querySelector('[data-hotkey-action="reroll"]')).toBeNull()
                document.querySelector<HTMLButtonElement>('.button-icon-menu')!.click()
                await tick(); await tick()
            }
            expect(document.querySelector('.button-icon-translate')).not.toBeNull()
            document.querySelector<HTMLButtonElement>('[data-hotkey-action="reroll"]')!.click()
            await tick(); await tick()
            expect(onReroll).toHaveBeenCalledOnce()
            const edit = document.querySelector<HTMLButtonElement>('.button-icon-edit')!
            edit.click()
            await tick()
            const editor = document.querySelector<HTMLTextAreaElement>('.message-edit-area')!
            editor.value = '수정한 메시지'
            editor.dispatchEvent(new Event('input', { bubbles: true }))
            edit.click()
            await tick(); await tick()
            expect(DBState.db.characters[0].chats[0].message[0].data).toBe('수정한 메시지')
        } finally {
            window.innerWidth = originalWidth
        }
    })
    test.each(['normal', 'ambiguous', 'streaming'] as const)('removes only the chosen inlay and active swipe safely (%s)', async (mode) => {
        const data = 'Before {{inlay::scene}} middle {{inlay::scene}} after'
        const msg = { role: 'char', data, chatId: 'message-1', swipes: ['untouched swipe', data], swipeId: 1 }
        const chat = DBState.db.characters[0].chats[0]
        chat.message = [msg] as any
        chat.isStreaming = mode === 'streaming'
        DBState.db.clickToEdit = true
        vi.mocked(ParseMarkdown).mockImplementation(async () => '<p><img data-inlay-image-id="scene" data-inlay-occurrence="0" src="/scene.png">'
            + (mode === 'ambiguous' ? '' : '<img data-inlay-image-id="scene" data-inlay-occurrence="1" src="/scene.png">') + '</p>')
        try {
            mounted = mount(Chat, { target: document.body, props: { message: data, name: 'Character', isLastMemory: false, idx: 0, role: 'char' } })
            await tick(); await tick(); await tick()
            await new Promise(resolve => setTimeout(resolve, 0))
            const buttons = document.querySelectorAll<HTMLButtonElement>('.inlay-image-remove')
            if (mode === 'streaming') {
                expect(buttons).toHaveLength(0)
            } else {
                buttons[buttons.length - 1]!.click()
                await tick()
            }
            expect(msg.data).toBe(mode === 'normal' ? 'Before {{inlay::scene}} middle  after' : data)
            expect(msg.swipes).toEqual(['untouched swipe', msg.data])
            expect(document.querySelector('.message-edit-area')).toBeNull()
        } finally {
            vi.mocked(ParseMarkdown).mockImplementation(async value => value)
        }
    })
    test.each([true, false])('retains the previous reply when sending input with preserveReadingPosition=%s', async (preserve) => {
        DBState.db.preserveChatScrollPosition = preserve
        const character = DBState.db.characters[0]
        const reply = { role: 'char', chatId: 'reply', data: '<p>First line</p><p>Reading here</p>', swipes: ['old', 'current'], swipeId: 1 }
        const state = new SvelteMap<string, any>([['messages', [reply]]])
        const chat = { id: 'room', get message() { return state.get('messages') } }
        character.chats = [chat] as any
        const nextSwipe = vi.fn()
        mounted = mount(Chats, {
            target: document.body,
            props: {
                get messages() { return chat.message }, currentCharacter: character,
                onReroll: vi.fn(), onNextSwipe: nextSwipe, unReroll: vi.fn(),
                currentUsername: 'User', userIcon: '', pageStart: 0,
                get pageEnd() { return chat.message.length },
            },
        })
        await tick(); await tick(); await tick()
        const previousReply = document.querySelector('[data-chat-index="0"]')!
        const paragraph = previousReply.querySelector('.chattext p')!
        expect(paragraph.textContent).toBe('First line')
        expect(previousReply.querySelector('[data-hotkey-action="reroll"]')).not.toBeNull()

        state.set('messages', [reply, { role: 'user', chatId: 'input', data: 'Next input' }])
        await tick(); await tick(); await tick()
        expect(document.querySelector('[data-chat-index="0"]')).toBe(previousReply)
        expect(previousReply.querySelector('.chattext p')).toBe(paragraph)
        expect(previousReply.querySelector('[data-hotkey-action="reroll"]')).toBeNull()
        expect(document.querySelector('[data-chat-index="1"]')?.textContent).toContain('Next input')

        // Removing the new input makes the retained reply the reroll target again.
        state.set('messages', [reply])
        await tick(); await tick(); await tick()
        expect(document.querySelector('[data-chat-index="0"]')).toBe(previousReply)
        expect(previousReply.querySelector('.chattext p')).toBe(paragraph)
        expect(previousReply.textContent).toContain('2/2')
        previousReply.querySelector<HTMLButtonElement>('.button-icon-reroll')!.click()
        expect(nextSwipe).toHaveBeenCalledOnce()
    })

    test.each([
        ['balanced', true], ['strong', true], ['off', true], ['balanced', false],
    ] as const)('finishes %s streaming with preserveReadingPosition=%s', async (mode, preserve) => {
        DBState.db.preserveChatScrollPosition = preserve
        DBState.db.streamingDisplayOptimizationMode = mode
        const character = DBState.db.characters[0]
        const state = new SvelteMap<string, any>([
            ['streaming', true], ['text', '<p>Reading here</p><p>Partial</p>'],
        ])
        const message = {
            role: 'char', chatId: 'reply',
            get data() { return state.get('text') },
            get risubardMemoryConfirmed() { return state.get('confirmed') ?? false },
        }
        const chat = { get id() { return state.get('room') ?? 'room' }, get isStreaming() { return state.get('streaming') }, message: [message] }
        character.chats = [chat] as any
        mounted = mount(Chats, {
            target: document.body,
            props: {
                messages: chat.message as any, currentCharacter: character,
                onReroll: vi.fn(), unReroll: vi.fn(), currentUsername: 'User', userIcon: '',
                pageStart: 0, pageEnd: 1,
            },
        })
        await tick(); await tick(); await tick()
        const messageElement = document.querySelector('[data-chat-index="0"]')
        const readingParagraph = messageElement?.querySelector('.chattext p')
        expect(messageElement).not.toBeNull()
        state.set('text', '<p>Reading here</p><p>Completed response</p>')
        state.set('streaming', false)
        await tick(); await tick(); await tick()
        const completedElement = document.querySelector('[data-chat-index="0"]')
        if (preserve) {
            expect(completedElement).toBe(messageElement)
            if (mode !== 'strong') expect(completedElement?.querySelector('.chattext p')).toBe(readingParagraph)
            // Output post-processing and memory status can arrive after the last token.
            state.set('confirmed', true)
            state.set('text', '<p>Reading here</p><p>Post-processed response</p>')
            await tick(); await tick(); await tick()
            expect(document.querySelector('[data-chat-index="0"]')).toBe(messageElement)
            expect(messageElement?.textContent).toContain('Post-processed response')
        } else {
            expect(completedElement).not.toBe(messageElement)
            expect(completedElement?.textContent).toContain('Completed response')
        }
        document.querySelector<HTMLButtonElement>('.button-icon-edit')!.click()
        await tick()
        expect(document.querySelector<HTMLTextAreaElement>('.message-edit-area')?.value)
            .toBe(preserve ? '<p>Reading here</p><p>Post-processed response</p>' : '<p>Reading here</p><p>Completed response</p>')
        if (preserve) {
            state.set('room', 'another-room')
            await tick(); await tick(); await tick()
            expect(document.querySelector('[data-chat-index="0"]')).not.toBe(messageElement)
            expect(document.querySelector('.message-edit-area')).toBeNull()
        }
    })

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

        editor!.value = 'Unsaved draft'
        editor!.dispatchEvent(new Event('input', { bubbles: true }))
        await tick()
        ;(mounted as any).updateStreamingDisplay({
            isOptimizedStreamingMessage: false,
            streamingOptimizationMode: 'off',
            rawStreamingText: 'editable message',
        })
        await tick()
        expect(editor?.value).toBe('Unsaved draft')
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

    test('keeps older messages editable after the list re-renders', async () => {
        const character = DBState.db.characters[0]
        const state = new SvelteMap<string, any>([['messages', [
            { role: 'char', chatId: 'a', data: 'first' },
            { role: 'user', chatId: 'b', data: 'second' },
        ]]])
        const chat = { id: 'room', get message() { return state.get('messages') } }
        character.chats = [chat] as any
        mounted = mount(Chats, { target: document.body, props: {
            get messages() { return chat.message }, currentCharacter: character,
            onReroll: vi.fn(), unReroll: vi.fn(), currentUsername: 'User', userIcon: '', pageStart: 0,
            get pageEnd() { return chat.message.length },
        } })
        const settle = async () => { await tick(); await tick(); await tick() }
        await settle()
        // A reply arrives and is then rerolled away: the list effect runs twice after the first mount.
        state.set('messages', [...state.get('messages'), { role: 'char', chatId: 'c', data: 'third' }])
        await settle()
        state.set('messages', state.get('messages').slice(0, 2))
        await settle()

        const first = document.querySelector('[data-chat-index="0"]')!
        first.querySelector<HTMLButtonElement>('.button-icon-edit')!.click()
        await settle()
        expect(first.querySelector('.message-edit-area')).not.toBeNull()
    })
})
