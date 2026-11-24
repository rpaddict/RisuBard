import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { describe, expect, it, vi } from 'vitest'
import { captureGenerationTarget, resolveGenerationTarget } from '../../ts/process/generationTarget'

function deferred<T>() {
    let resolve!: (value: T) => void
    let reject!: (error: Error) => void
    const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
    return { promise, resolve, reject }
}

// Run the component's real send functions with only external work replaced.
function screen(overrides: Record<string, unknown> = {}) {
    const source = readFileSync('src/lib/ChatScreens/DefaultChatScreen.svelte', 'utf8')
    const script = source.slice(source.indexOf('>') + 1, source.indexOf('</script>'))
    const parsed = ts.createSourceFile('screen.ts', script, ts.ScriptTarget.Latest, true)
    const functions = parsed.statements.filter(node => ts.isFunctionDeclaration(node)
        && ['sendMain', 'sendChatMain'].includes(node.name?.text ?? ''))
    const code = ts.transpileModule(functions.map(node => node.getText(parsed)).join('\n'), {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
    }).outputText
    const chat = { id: 'chat-1', message: [] as unknown[] }
    const otherChat = { id: 'chat-2', message: [{role: 'user', data: 'B history'}] }
    const character = { chaId: 'character-1', type: 'character', chatPage: 0, chats: [chat, otherChat] }
    const removedDrafts: string[] = []
    const drafts = new Map([['chat-1', {m: 'original input', t: ''}], ['chat-2', {m: 'B draft', t: ''}]])
    const requests: unknown[] = []
    const errors: unknown[] = []
    const calls: string[] = []
    const dependencies = {
        $selectedCharID: 0, $doingChat: false, wikiRebootBlocksGeneration: false, currentChatGenerating: false,
        inputAssistBusy: false, notifyInfo: () => {},
        language: {}, DBState: { db: { characters: [character], aiModel: 'model-A', botPresetsId: 1 } },
        ensureActiveChatReady: async () => chat,
        runTrigger: async () => undefined,
        processScript: async (_: unknown, text: string) => text,
        processMultiCommand: async () => false,
        removeChatDraftIfMatches: (_: string, id: string, expected: {m: string; t: string}) => {
            const draft = drafts.get(id)
            if (draft?.m !== expected.m || draft?.t !== expected.t) return
            removedDrafts.push(id); drafts.delete(id)
        },
        flushChatDraft: () => {}, draftChaId: 'character-1', draftChatId: 'chat-1', draftLoading: false,
        getLatestChatPage: () => 0, chatPageSize: 20,
        sleep: async () => {}, updateInputSizeAll: () => {},
        currentChatGenKey: () => chat.id, $generationStates: new Map(),
        captureGenerationTarget, resolveGenerationTarget, chatGenKey: (id: string) => id,
        blocksChatGeneration: () => false,
        persistVisibleDraft: (id: string, draft: {m: string; t: string}) => drafts.set(id, draft),
        registerAbort: () => {}, endGeneration: () => {},
        sendChat: async (_: number, options: unknown) => { calls.push('request'); requests.push(options); return true },
        playNotificationSound: () => {}, alertError: (error: unknown) => errors.push(error),
        startBgmDjTurn: () => {},
        console: { error: () => {} },
        ...overrides,
    }
    const api = new Function(...Object.keys(dependencies), `
        let messageInput = 'original input', messageInputTranslate = '', fileInput = [], chatPage = 0;
        let preparingInput = false, sendingChat = false, sendingChatKey = null;
        ${code}
        return {sendMain, sendChatMain,
            selectOther: (text = 'B draft') => {
                persistVisibleDraft(draftChatId, {m: messageInput, t: messageInputTranslate});
                DBState.db.characters[0].chatPage = 1;
                draftChatId = 'chat-2'; messageInput = text;
            },
            setInput: (text) => { messageInput = text },
            setFiles: (files) => {fileInput = files},
            setModel: (model, preset) => {DBState.db.aiModel = model; DBState.db.botPresetsId = preset},
            state: () => ({messageInput, fileInput, preparingInput, sendingChat})};
    `)(...Object.values(dependencies))
    return { ...api, chat, otherChat, character, drafts, removedDrafts, requests, errors, calls }
}

describe('chat send preparation', () => {
    it('keeps A model settings when switching to B during input preparation', async () => {
        const translation = deferred<string>()
        const chat = screen({processScript: () => translation.promise})
        const send = chat.sendMain(false)
        await vi.waitFor(() => expect(chat.state().preparingInput).toBe(true))
        chat.selectOther()
        chat.setModel('model-B', 2)
        translation.resolve('translated input')
        await send
        expect(chat.requests).toEqual([expect.objectContaining({
            requestSettings: expect.objectContaining({aiModel: 'model-A', botPresetsId: 1}),
        })])
    })
    it('passes the captured A context to slash commands after a switch during hydration', async () => {
        const hydration = deferred<unknown>()
        const command = vi.fn(async () => true)
        const chat = screen({ensureActiveChatReady: () => hydration.promise, processMultiCommand: command})
        chat.setInput('/command')
        const send = chat.sendMain(false)
        chat.selectOther()
        hydration.resolve(chat.chat)
        await send
        expect(command).toHaveBeenCalledWith('/command', {character: chat.character, chat: chat.chat})
        expect(chat.state().messageInput).toBe('B draft')
        expect(chat.requests).toEqual([])
    })
    it.each([false, true])('consumes A attachments while preserving new attachments (switch = %s)', async (switchChat) => {
        const translation = deferred<string>()
        const chat = screen({processScript: () => translation.promise})
        chat.setFiles(['A-file'])
        const send = chat.sendMain(false)
        await vi.waitFor(() => expect(chat.state().preparingInput).toBe(true))
        if (switchChat) chat.selectOther()
        else chat.setInput('new input')
        chat.setFiles(['A-file', 'new-file'])
        translation.resolve('translated input')
        await send
        expect(chat.state().fileInput).toEqual(['new-file'])
    })
    it('keeps a newer saved A draft after the user types in A then switches to B', async () => {
        const translation = deferred<string>()
        const chat = screen({processScript: () => translation.promise})
        const send = chat.sendMain(false)
        await vi.waitFor(() => expect(chat.state().preparingInput).toBe(true))
        chat.setInput('next A draft')
        chat.selectOther()
        translation.resolve('translated input')
        await send
        expect(chat.drafts.get('chat-1')).toEqual({m: 'next A draft', t: ''})
        expect(chat.state().messageInput).toBe('B draft')
    })
    it('does not apply the visible B wiki lock to an already prepared A request', async () => {
        const chat = screen({wikiRebootBlocksGeneration: true})
        chat.selectOther()
        expect(await chat.sendChatMain(false, {characterId: 'character-1', chatId: 'chat-1'})).toBe(true)
        expect(chat.state().messageInput).toBe('B draft')
    })
    it('keeps the original input and writes only A after switching to B during an input trigger', async () => {
        const trigger = deferred<undefined>()
        const chat = screen({runTrigger: () => trigger.promise})
        const send = chat.sendMain(false)
        await vi.waitFor(() => expect(chat.state().preparingInput).toBe(true))
        chat.selectOther()
        trigger.resolve(undefined)
        await send
        expect(chat.chat.message).toEqual([expect.objectContaining({data: 'original input'})])
        expect(chat.otherChat.message).toEqual([{role: 'user', data: 'B history'}])
        expect(chat.state().messageInput).toBe('B draft')
        expect(chat.removedDrafts).toEqual(['chat-1'])
        expect(chat.requests).toEqual([expect.objectContaining({target: {characterId: 'character-1', chatId: 'chat-1'}})])
    })

    it('captures A before hydration and tolerates chat reordering during preparation', async () => {
        const hydration = deferred<unknown>()
        const chat = screen({ensureActiveChatReady: () => hydration.promise})
        const send = chat.sendMain(false)
        chat.selectOther()
        chat.character.chats.reverse()
        chat.character.chatPage = 0
        hydration.resolve(chat.chat)
        await send
        expect(chat.chat.message).toEqual([expect.objectContaining({data: 'original input'})])
        expect(chat.otherChat.message).toEqual([{role: 'user', data: 'B history'}])
        expect(chat.state().messageInput).toBe('B draft')
        expect(chat.requests).toEqual([expect.objectContaining({target: {characterId: 'character-1', chatId: 'chat-1'}})])
    })

    it('does not persist the empty B composer while its saved draft is loading', async () => {
        const translation = deferred<string>()
        const flush = vi.fn()
        const chat = screen({processScript: () => translation.promise, draftLoading: true, flushChatDraft: flush})
        const send = chat.sendMain(false)
        await vi.waitFor(() => expect(chat.state().preparingInput).toBe(true))
        chat.selectOther('')
        translation.resolve('translated input')
        await send
        expect(flush).not.toHaveBeenCalled()
        expect(chat.removedDrafts).toEqual(['chat-1'])
    })

    it('preserves new text typed in A while the previous input is preparing', async () => {
        const translation = deferred<string>()
        const chat = screen({processScript: () => translation.promise})
        const send = chat.sendMain(false)
        await vi.waitFor(() => expect(chat.state().preparingInput).toBe(true))
        chat.setInput('next draft')
        translation.resolve('translated input')
        await send
        expect(chat.state().messageInput).toBe('next draft')
        expect(chat.removedDrafts).toEqual([])
    })

    it('blocks a second click while input translation is pending', async () => {
        const translation = deferred<string>()
        const chat = screen({ processScript: () => translation.promise })
        const first = chat.sendMain(false)
        await vi.waitFor(() => expect(chat.state().preparingInput).toBe(true))
        await chat.sendMain(false)
        translation.resolve('translated input')
        await first
        expect(chat.chat.message).toHaveLength(1)
        expect(chat.calls).toEqual(['request'])
        expect(chat.state().preparingInput).toBe(false)
    })

    it('keeps the draft and permits retry after an input hook fails', async () => {
        let fail = true
        const chat = screen({ processScript: async () => {
            if (fail) throw new Error('translation failed')
            return 'translated input'
        } })
        await expect(chat.sendMain(false)).resolves.toBeUndefined()
        expect(chat.errors).toHaveLength(1)
        expect(chat.state()).toMatchObject({messageInput: 'original input', preparingInput: false})
        expect(chat.chat.message).toHaveLength(0)
        fail = false
        await chat.sendMain(false)
        expect(chat.chat.message).toHaveLength(1)
    })

    it('blocks duplicate requests before generation registration and unlocks on failure', async () => {
        const pending = deferred<boolean>()
        let requests = 0
        const chat = screen({ sendChat: () => { requests++; return pending.promise } })
        const first = chat.sendChatMain()
        expect(chat.state().sendingChat).toBe(true)
        expect(await chat.sendChatMain()).toBe(false)
        expect(requests).toBe(1)
        pending.reject(new Error('sync failed'))
        expect(await first).toBe(false)
        expect(chat.state().sendingChat).toBe(false)
    })
})
