// @vitest-environment happy-dom

import { afterEach, describe, expect, test, vi } from 'vitest'
import { mount, tick, unmount } from 'svelte'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const mocks = vi.hoisted(() => ({
    loadNarrativeMemoryWiki: vi.fn(),
    saveManualWikiDocument: vi.fn(),
    getBardChatUndoStatus: vi.fn(async () => ({ available: false })),
    restoreBardChatUndo: vi.fn(async () => ({ restored: true })),
    replaceWikiText: vi.fn(),
    saveChatToServer: vi.fn(),
    db: {} as {
        risuBardMemoryDialogSize?: {
            width: number
            height: number
        }
        risuBardMemoryDockRatio?: number
        risuBardMemoryWorkspaceHeight?: number
        risuBardModelMode?: 'memory' | 'model'
        risuBardRecentMessageCount?: number
        risuBardResponseMessageCount?: number
        risuBardResponseIncludeUserMessages?: boolean
        characters?: Array<{
            chaId: string
            reloadKeys?: number
            chats: Array<{
                id: string
                isStreaming?: boolean
                risuBardSettings?: Record<string, unknown>
                message: Array<{
                    role: 'user' | 'char'
                    data: string
                    swipes?: string[]
                    chatId?: string
                    disabled?: boolean
                    isComment?: boolean
                }>
            }>
        }>
    },
}))

vi.mock('src/ts/globalApi.svelte', () => ({
    forageStorage: {
        createAuth: vi.fn(async () => 'auth-token'),
    },
    saveAsset: vi.fn(async () => ''),
}))
vi.mock('src/ts/process/request/request', () => ({
    requestChatData: vi.fn(),
}))
vi.mock('src/ts/risubard/memoryWiki', () => ({
    loadNarrativeMemoryWiki: mocks.loadNarrativeMemoryWiki,
    saveManualWikiDocument: mocks.saveManualWikiDocument,
    getBardChatUndoStatus: mocks.getBardChatUndoStatus,
    restoreBardChatUndo: mocks.restoreBardChatUndo,
}))
vi.mock('src/ts/risubard/findReplace', () => ({
    previewFindReplace: (
        documents: Array<{ title: string; content: string }>,
        messages: Array<{ data: string; swipes?: string[] }>,
        find: string
    ) => {
        const count = (value: string) => find
            ? value.split(find).length - 1
            : 0
        return {
            wikiMatches: documents.reduce((total, item) =>
                total + count(item.content), 0),
            wikiDocuments: documents.filter((item) =>
                count(item.content) > 0).length,
            chatMatches: messages.reduce((total, item) => total
                + count(item.data)
                + (item.swipes ?? []).reduce((sum, swipe) =>
                    sum + count(swipe), 0), 0),
            chatMessages: messages.filter((item) => count(item.data)
                + (item.swipes ?? []).reduce((sum, swipe) =>
                    sum + count(swipe), 0) > 0).length,
        }
    },
    applyChatFindReplace: (
        messages: Array<{ data: string; swipes?: string[] }>,
        find: string,
        replacement: string
    ) => {
        let matches = 0
        let changedMessages = 0
        for (const message of messages) {
            let current = message.data.split(find).length - 1
            message.data = message.data.replaceAll(find, replacement)
            message.swipes = message.swipes?.map((swipe) => {
                current += swipe.split(find).length - 1
                return swipe.replaceAll(find, replacement)
            })
            if (current > 0) changedMessages += 1
            matches += current
        }
        return { matches, messages: changedMessages }
    },
    replaceWikiText: mocks.replaceWikiText,
}))
vi.mock('src/ts/storage/chatStorage', () => ({
    saveChatToServer: mocks.saveChatToServer,
}))
vi.mock('src/ts/stores.svelte', () => ({
    DBState: { db: mocks.db },
    selIdState: { selId: -1 },
}))

import RisuBardMemoryWiki from './RisuBardMemoryWiki.svelte'
import RisuBardMemoryWikiHelp from './RisuBardMemoryWikiHelp.svelte'

let mounted: ReturnType<typeof mount> | undefined

afterEach(async () => {
    if (mounted) await unmount(mounted)
    mounted = undefined
    document.body.replaceChildren()
    vi.clearAllMocks()
    delete mocks.db.risuBardMemoryDialogSize
    delete mocks.db.risuBardMemoryDockRatio
    delete mocks.db.risuBardMemoryWorkspaceHeight
    delete mocks.db.risuBardModelMode
    delete mocks.db.risuBardRecentMessageCount
    delete mocks.db.risuBardResponseMessageCount
    delete mocks.db.risuBardResponseIncludeUserMessages
    delete mocks.db.characters
})

describe('RisuBardMemoryWiki', () => {
    test('loads only the new character after a closed dock survives deletion and switching', async () => {
        const onExecuteWikiCommand = vi.fn(async () => ({
            applied: [],
            failed: [],
        }))

        mounted = mount(RisuBardMemoryWiki, {
            target: document.body,
            props: {
                open: false,
                characterId: 'character-a',
                chatId: 'chat-a',
                onExecuteWikiCommand,
            },
        })
        await tick()
        expect(mocks.loadNarrativeMemoryWiki).not.toHaveBeenCalled()
        expect(mocks.getBardChatUndoStatus).not.toHaveBeenCalled()
        window.dispatchEvent(new CustomEvent('risubard-memory-updated', {
            detail: { characterId: 'character-a', chatId: 'chat-a' },
        }))
        await tick()
        expect(mocks.loadNarrativeMemoryWiki).not.toHaveBeenCalled()

        await unmount(mounted)
        mounted = undefined
        mounted = mount(RisuBardMemoryWiki, {
            target: document.body,
            props: {
                open: false,
                characterId: 'character-b',
                chatId: 'chat-b',
                onExecuteWikiCommand,
            },
        })
        await tick()
        expect(mocks.loadNarrativeMemoryWiki).not.toHaveBeenCalled()
        expect(mocks.getBardChatUndoStatus).not.toHaveBeenCalled()

        await unmount(mounted)
        mounted = undefined
        mounted = mount(RisuBardMemoryWiki, {
            target: document.body,
            props: {
                open: true,
                characterId: 'character-b',
                chatId: 'chat-b',
                onExecuteWikiCommand,
            },
        })

        await vi.waitFor(() => {
            expect(mocks.loadNarrativeMemoryWiki).toHaveBeenCalledOnce()
            expect(mocks.getBardChatUndoStatus).toHaveBeenCalledOnce()
        })
        expect(mocks.loadNarrativeMemoryWiki).toHaveBeenCalledWith(
            expect.objectContaining({
                characterId: 'character-b',
                chatId: 'chat-b',
            })
        )
        expect(mocks.getBardChatUndoStatus).toHaveBeenCalledWith(
            expect.objectContaining({
                characterId: 'character-b',
                chatId: 'chat-b',
            })
        )
    })

    test('keeps the BardWiki dock open while navigating to a source message', () => {
        const chatSource = readFileSync(resolve(
            process.cwd(), 'src/lib/ChatScreens/DefaultChatScreen.svelte'
        ), 'utf8')
        const dockSource = readFileSync(resolve(
            process.cwd(), 'src/lib/Others/RisuBardMemoryWiki.svelte'
        ), 'utf8')
        const navigateStart = chatSource.indexOf(
            'async function navigateStorySource'
        )
        const navigateEnd = chatSource.indexOf(
            'function bumpScrollNav', navigateStart
        )
        const navigateSource = chatSource.slice(navigateStart, navigateEnd)

        expect(navigateSource).toContain('await scrollToMessage(index)')
        expect(navigateSource).not.toContain('memoryWikiOpen = false')
        expect(dockSource).toContain(
            'onNavigateSource={onNavigateStorySource}'
        )
    })

    test('renders above the chat stacking context and uses the BARDWIKI title', () => {
        const dockSource = readFileSync(resolve(
            process.cwd(), 'src/lib/Others/RisuBardMemoryWiki.svelte'
        ), 'utf8')
        const chatSource = readFileSync(resolve(
            process.cwd(), 'src/lib/ChatScreens/DefaultChatScreen.svelte'
        ), 'utf8')
        const korean = readFileSync(resolve(
            process.cwd(), 'src/lang/ko.ts'
        ), 'utf8')

        const dockLayer = Number(dockSource.match(
            /\.memory-wiki-dock\s*\{[\s\S]*?z-index:\s*(\d+)/
        )?.[1])

        expect(dockLayer).toBeGreaterThan(0)
        const chatPaneStart = chatSource.indexOf(
            '<main class="relative z-0 h-full min-w-0 flex-1"'
        )
        const chatPaneEnd = chatSource.indexOf('</main>', chatPaneStart)
        const pluginFabs = chatSource.indexOf(
            '<PluginFloatingActionButtons', chatPaneStart
        )
        expect(chatPaneStart).toBeGreaterThanOrEqual(0)
        expect(pluginFabs).toBeGreaterThan(chatPaneStart)
        expect(pluginFabs).toBeLessThan(chatPaneEnd)
        expect(korean).toContain(
            'risuBardMemoryWiki: "BARDWIKI - 리스바드 메모리"'
        )
    })

    test('opens detailed Memory Wiki help from the title row', async () => {
        mocks.loadNarrativeMemoryWiki.mockResolvedValue({
            mode: 'markdown',
            wikiPath: 'C:\\wiki',
            health: { danglingLinks: [], unlinkedDocumentIds: [] },
            documents: [],
        })
        mounted = mount(RisuBardMemoryWiki, {
            target: document.body,
            props: { open: true, characterId: 'character', chatId: 'chat' },
        })

        let helpButton: HTMLButtonElement | null = null
        await vi.waitFor(() => {
            helpButton = document.querySelector('[data-memory-help]')
            expect(helpButton).not.toBeNull()
        })
        expect(document.body.textContent).not.toContain(
            '현재 메모리를 살펴보고 명시적인 작가 변경을 준비할 수 있습니다.'
        )
        expect(helpButton?.previousElementSibling?.tagName).toBe('STRONG')
        expect(helpButton?.textContent?.trim()).toBe('사용 가이드')
        expect(helpButton?.getAttribute('aria-label')).toBe('사용 가이드')

        helpButton?.click()
        await vi.waitFor(() => {
            const help = document.querySelector('[data-memory-help-content]')
            expect(help).not.toBeNull()
            expect(help?.textContent).toContain('자동 분석과 추가 분석')
            expect(help?.textContent).toContain('문서 편집과 안전장치')
            expect(help?.textContent).toContain('위키 관리자 명령')
            expect(help?.textContent).toContain('컨텍스트 정책')
        })
        expect(document.querySelector('[role="dialog"]')?.textContent)
            .toContain('BardWiki 사용 가이드')
        document.querySelector<HTMLButtonElement>('[aria-label="사용 가이드 닫기"]')!.click()
        await vi.waitFor(() => {
            expect(document.querySelector('[data-memory-help-content]')).toBeNull()
        })
    })

    test('introduces usage and concept before the essential settings', async () => {
        mounted = mount(RisuBardMemoryWikiHelp, {
            target: document.body,
            props: { open: true },
        })
        await vi.waitFor(() => {
            const help = document.querySelector('[data-memory-help-content]')
            expect([...help!.querySelectorAll('h2')].slice(0, 3)
                .map((heading) => heading.textContent))
                .toEqual(['빠른 시작', 'BardWiki의 컨셉', '먼저 확인할 핵심 설정'])
            expect(help?.textContent).toContain('현재 챗 설정')
            expect(help?.textContent).toContain('전역값 사용')
        })
    })

    test('explains response history, analysis history and wiki writing language separately', async () => {
        mounted = mount(RisuBardMemoryWikiHelp, {
            target: document.body,
            props: { open: true },
        })
        await vi.waitFor(() => {
            const help = document.querySelector('[data-memory-help-content]')
            const text = help?.textContent ?? ''
            for (const setting of [
                'LLM에 전달할 최근 채팅 내역', '응답 최근 메시지',
                '위키 분석 최근 원문', '분석 최근 메시지',
                '과거 사용자 메시지 제외', '위키 작성 언어',
                '위키 조회 토큰 목표', '위키 조회 토큰 절대 상한',
                'AI 분석 토큰 상한', '정본 대상 한도', '정본 집필 문체',
            ]) expect(text).toContain(setting)
            expect(text).toContain('왕복 턴 수가 아니라 메시지 수')
            expect(text).toContain('현재 사용자 요청도 이 개수에 포함')
            expect(text).toContain('기본값은 각각 12개')
            expect(text).toContain('UI·대화 언어와 독립적')
            expect(text).toContain('기존 문서는 자동 번역되지 않습니다')
            expect(text).toContain('리부트는 시작할 때 선택한 언어를 유지')
        })
    })

    test('coordinates the portrait command panel with editor focus mode', async () => {
        mocks.loadNarrativeMemoryWiki.mockResolvedValue({
            mode: 'markdown',
            wikiPath: 'C:\\wiki',
            health: { danglingLinks: [], unlinkedDocumentIds: [] },
            documents: [],
        })
        mounted = mount(RisuBardMemoryWiki, {
            target: document.body,
            props: {
                open: true,
                characterId: 'character',
                chatId: 'chat',
                onExecuteWikiCommand: async () => ({ applied: [], failed: [] }),
            },
        })

        let dock: HTMLElement | null = null
        let commandPane: HTMLElement | null = null
        await vi.waitFor(() => {
            dock = document.querySelector('[data-memory-wiki-dock]')
            commandPane = document.querySelector('[data-wiki-command-pane]')
            expect(dock).not.toBeNull()
            expect(commandPane).not.toBeNull()
        })
        expect(commandPane?.dataset.commandExpanded).toBe('false')
        expect(dock?.dataset.editorFocus).toBe('false')

        document.querySelector<HTMLButtonElement>(
            '[data-wiki-toggle-command]'
        )?.click()
        await tick()
        expect(commandPane?.dataset.commandExpanded).toBe('true')

        document.querySelector<HTMLButtonElement>(
            '[data-wiki-editor-focus]'
        )?.click()
        await tick()
        expect(dock?.dataset.editorFocus).toBe('true')
    })

    test('replaces text across the wiki and persisted current chat', async () => {
        const original = {
            id: 'character.gilbert', type: 'character' as const,
            status: 'active' as const, title: '길버드',
            relativePath: 'characters/gilbert.md', sourceMessageIds: [],
            updated: 'now', content: '# 길버드\n\n길버드가 웃었다.', links: [],
            contextMode: 'auto' as const, contentHash: 'old-hash',
        }
        const updated = {
            ...original, title: '길버트',
            content: '# 길버트\n\n길버트가 웃었다.', contentHash: 'new-hash',
        }
        const view = (document: typeof original) => ({
            mode: 'markdown' as const, wikiPath: 'C:\\wiki',
            documents: [document],
            health: { danglingLinks: [], unlinkedDocumentIds: [] },
        })
        mocks.loadNarrativeMemoryWiki
            .mockResolvedValueOnce(view(original))
            .mockResolvedValueOnce(view(updated))
        mocks.replaceWikiText.mockResolvedValue({ matches: 2, documents: 1 })
        mocks.saveChatToServer.mockResolvedValue(undefined)
        mocks.db.characters = [{
            chaId: 'character', reloadKeys: 0,
            chats: [{
                id: 'chat',
                message: [{
                    role: 'char', data: '길버드가 왔다.',
                    swipes: ['길버드가 왔다.'],
                }],
            }],
        }]
        mounted = mount(RisuBardMemoryWiki, {
            target: document.body,
            props: { open: true, characterId: 'character', chatId: 'chat' },
        })

        await vi.waitFor(() => expect(document.querySelector(
            '[data-wiki-open-find-replace]'
        )).not.toBeNull())
        const openFindReplace = document.querySelector<HTMLButtonElement>(
            '[data-wiki-open-find-replace]'
        )!
        openFindReplace.click()
        await vi.waitFor(() => expect(document.querySelector(
            '[data-find-replace-dialog]'
        )).not.toBeNull())
        expect(document.querySelector(
            '[data-find-replace-dialog] [data-solar-icon="magnifier"]'
        )).toBeNull()
        document.querySelector<HTMLElement>('[data-find-replace-dialog]')?.click()
        expect(document.querySelector('[data-find-replace-dialog]')).not.toBeNull()
        document.querySelector<HTMLElement>('[data-find-replace-overlay]')?.click()
        await vi.waitFor(() => expect(document.querySelector(
            '[data-find-replace-dialog]'
        )).toBeNull())
        openFindReplace.click()
        await vi.waitFor(() => expect(document.querySelector(
            '[data-find-replace-dialog]'
        )).not.toBeNull())
        const find = document.querySelector<HTMLInputElement>(
            '[data-find-replace-find]'
        )!
        const replacement = document.querySelector<HTMLInputElement>(
            '[data-find-replace-replacement]'
        )!
        find.value = '길버드'
        find.dispatchEvent(new Event('input', { bubbles: true }))
        replacement.value = '길버트'
        replacement.dispatchEvent(new Event('input', { bubbles: true }))
        await tick()
        document.querySelector<HTMLButtonElement>(
            '[data-find-replace-run]'
        )?.click()

        await vi.waitFor(() => expect(mocks.replaceWikiText)
            .toHaveBeenCalledWith(expect.objectContaining({
                characterId: 'character', chatId: 'chat',
                find: '길버드', replacement: '길버트',
            })))
        await vi.waitFor(() => expect(mocks.saveChatToServer)
            .toHaveBeenCalledOnce())
        expect(mocks.db.characters[0].chats[0].message[0]).toMatchObject({
            data: '길버트가 왔다.', swipes: ['길버트가 왔다.'],
        })
        expect(mocks.db.characters[0].reloadKeys).toBe(1)
    })

    test('shows a command-updated document without creating a false local edit', async () => {
        const original = {
            id: 'character.amanda', type: 'character' as const,
            status: 'active' as const, title: '아만다 다인',
            relativePath: 'characters/amanda.md', sourceMessageIds: [],
            updated: 'now', content: '# 아만다 다인\n\n기존 정보.', links: [],
            contextMode: 'auto' as const, contentHash: 'amanda-old',
        }
        const updated = {
            ...original,
            content: '# 아만다 다인\n\n기존 정보. 추가된 비밀 정보.',
            contentHash: 'amanda-new',
        }
        const view = (document: typeof original) => ({
            mode: 'markdown' as const,
            wikiPath: 'C:\\wiki',
            documents: [document],
            health: { danglingLinks: [], unlinkedDocumentIds: [] },
        })
        mocks.loadNarrativeMemoryWiki
            .mockResolvedValueOnce(view(original))
            .mockResolvedValueOnce(view(updated))
        const onExecuteWikiCommand = vi.fn(async () => ({
            applied: [{
                action: 'upsert' as const,
                documentId: original.id,
                title: original.title,
                relativePath: original.relativePath,
            }],
            failed: [],
        }))
        const target = document.body.appendChild(document.createElement('div'))
        mounted = mount(RisuBardMemoryWiki, {
            target,
            props: {
                open: true,
                characterId: 'character',
                chatId: 'chat',
                onExecuteWikiCommand,
            },
        })

        await vi.waitFor(() => expect(
            document.querySelector<HTMLTextAreaElement>('[aria-label="Markdown"]')
                ?.value
        ).toBe(original.content))
        const command = document.querySelector<HTMLTextAreaElement>(
            '[data-wiki-command-input]'
        )!
        command.value = '아만다 다인에 비밀 정보를 추가해.'
        command.dispatchEvent(new Event('input', { bubbles: true }))
        await tick()
        document.querySelector<HTMLButtonElement>('[data-wiki-command-run]')
            ?.click()

        await vi.waitFor(() => expect(
            mocks.loadNarrativeMemoryWiki
        ).toHaveBeenCalledTimes(2))
        await vi.waitFor(() => expect(
            document.querySelector<HTMLTextAreaElement>('[aria-label="Markdown"]')
                ?.value
        ).toBe(updated.content))
        expect(document.body.textContent).not.toContain('저장하지 않은 변경')
        expect(document.querySelector('[data-wiki-recent-update]')
            ?.parentElement?.getAttribute('aria-label')).toBe('아만다 다인 ')
    })

    test('loads and restores the process-lifetime BARDCHAT snapshot', async () => {
        mocks.loadNarrativeMemoryWiki.mockResolvedValue({
            mode: 'markdown', wikiPath: 'C:\\wiki', documents: [],
            health: { danglingLinks: [], unlinkedDocumentIds: [] },
        })
        mocks.getBardChatUndoStatus.mockResolvedValue({ available: true })
        mounted = mount(RisuBardMemoryWiki, {
            target: document.body,
            props: {
                open: true, characterId: 'character', chatId: 'chat',
                onExecuteWikiCommand: vi.fn(async () => ({ applied: [], failed: [] })),
            },
        })
        await vi.waitFor(() => expect(
            document.querySelector<HTMLButtonElement>('[data-bardchat-restore]')
                ?.disabled
        ).toBe(false))
        document.querySelector<HTMLButtonElement>('[data-bardchat-restore]')?.click()

        await vi.waitFor(() => expect(mocks.restoreBardChatUndo)
            .toHaveBeenCalledWith(expect.objectContaining({
                characterId: 'character', chatId: 'chat',
            })))
    })

    test('keeps the selected document and file-tree viewport after saving', async () => {
        const first = {
            id: 'character.first', type: 'character' as const,
            status: 'active' as const, title: '첫 번째',
            relativePath: 'characters/first.md', sourceMessageIds: [],
            updated: 'now', content: '# 첫 번째\n\n첫 문서.', links: [],
            contextMode: 'auto' as const, contentHash: 'first-hash',
        }
        const second = {
            id: 'character.second', type: 'character' as const,
            status: 'active' as const, title: '두 번째',
            relativePath: 'characters/second.md', sourceMessageIds: [],
            updated: 'now', content: '# 두 번째\n\n둘째 문서.', links: [],
            contextMode: 'auto' as const, contentHash: 'second-hash',
        }
        const savedSecond = {
            ...second, content: '# 두 번째\n\n수정한 둘째 문서.',
            contentHash: 'second-hash-next',
        }
        const view = (documents: typeof first[]) => ({
            mode: 'markdown' as const, wikiPath: 'C:\\wiki', documents,
            health: { danglingLinks: [], unlinkedDocumentIds: [] },
        })
        mocks.loadNarrativeMemoryWiki
            .mockResolvedValueOnce(view([first, second]))
            .mockResolvedValueOnce(view([first, savedSecond]))
        mocks.saveManualWikiDocument.mockResolvedValue(savedSecond)
        const target = document.body.appendChild(document.createElement('div'))
        mounted = mount(RisuBardMemoryWiki, {
            target,
            props: { open: true, characterId: 'character', chatId: 'chat' },
        })

        await vi.waitFor(() => expect(
            document.querySelector('[data-wiki-editor]')
        ).not.toBeNull())
        const secondButton = [...document.querySelectorAll('button')]
            .find((button) => button.textContent?.trim() === '두 번째')!
        secondButton.click()
        await tick()
        const tree = document.querySelector<HTMLElement>('.file-tree')!
        tree.scrollTop = 120
        const markdown = document.querySelector<HTMLTextAreaElement>(
            '[aria-label="Markdown"]'
        )!
        markdown.value = savedSecond.content
        markdown.dispatchEvent(new Event('input', { bubbles: true }))
        await tick()
        const save = document.querySelector<HTMLButtonElement>(
            '[data-wiki-action-toolbar] [aria-label="저장"]'
        )!
        save.click()

        await vi.waitFor(() => expect(
            mocks.loadNarrativeMemoryWiki
        ).toHaveBeenCalledTimes(2))
        await vi.waitFor(() => expect(
            document.querySelector<HTMLInputElement>('[aria-label="항목 이름"]')
                ?.value
        ).toBe('두 번째'))
        expect(document.querySelector('.file-tree')).toBe(tree)
        expect(tree.scrollTop).toBe(120)
    })

    test('shows the concrete force-update failure reason', async () => {
        mocks.loadNarrativeMemoryWiki.mockResolvedValue({
            mode: 'markdown', wikiPath: 'C:\\wiki', documents: [],
        })
        const target = document.body.appendChild(document.createElement('div'))
        mounted = mount(RisuBardMemoryWiki, {
            target,
            props: {
                open: true,
                characterId: 'character',
                chatId: 'chat',
                onForceWikiUpdate: async () => {
                    throw new Error('위키 조회 제한 시간을 초과했습니다.')
                },
            },
        })

        let button: HTMLButtonElement | null = null
        await vi.waitFor(() => {
            button = document.body.querySelector(
                '[data-risubard-force-wiki-update]'
            )
            expect(button).not.toBeNull()
        })
        button?.click()

        await vi.waitFor(() => {
            expect(document.body.textContent).toContain(
                '위키 조회 제한 시간을 초과했습니다.'
            )
        })
    })

    test('shows the analyzed AI turn and completion time after additional analysis', async () => {
        mocks.loadNarrativeMemoryWiki.mockResolvedValue({
            mode: 'markdown', wikiPath: 'C:\\wiki', documents: [],
        })
        mocks.db.characters = [{
            chaId: 'character',
            chats: [{
                id: 'chat',
                message: [
                    { role: 'user', data: '첫 질문', chatId: 'user-1' },
                    { role: 'char', data: '첫 응답', chatId: 'assistant-1' },
                    {
                        role: 'char', data: '비활성 응답', chatId: 'disabled',
                        disabled: true,
                    },
                    {
                        role: 'char', data: '코멘트', chatId: 'comment',
                        isComment: true,
                    },
                    { role: 'user', data: '둘째 질문', chatId: 'user-2' },
                    { role: 'char', data: '둘째 응답', chatId: 'assistant-2' },
                ],
            }],
        }]
        mounted = mount(RisuBardMemoryWiki, {
            target: document.body,
            props: {
                open: true,
                characterId: 'character',
                chatId: 'chat',
                onForceWikiUpdate: async () => true,
            },
        })

        await vi.waitFor(() => expect(document.querySelector(
            '[data-risubard-force-wiki-update]'
        )).not.toBeNull())
        document.querySelector<HTMLButtonElement>(
            '[data-risubard-force-wiki-update]'
        )?.click()

        await vi.waitFor(() => {
            const status = document.querySelector(
                '[data-force-update-status="success"]'
            )
            expect(status?.textContent).toContain('Analyzed through AI turn 2')
            expect(status?.textContent).toMatch(/Updated: \d{2}:\d{2}/)
            expect(status?.querySelector(
                '[data-force-update-meta]'
            )).not.toBeNull()
        })
    })

    test('exposes the main RisuBard options as current-chat settings', async () => {
        mocks.loadNarrativeMemoryWiki.mockResolvedValue({
            mode: 'markdown',
            wikiPath: 'C:\\wiki',
            documents: [],
        })
        mocks.db.characters = [{ chaId: 'character', chats: [{ id: 'chat', message: [] }] }]
        const target = document.createElement('div')
        document.body.appendChild(target)
        mounted = mount(RisuBardMemoryWiki, {
            target,
            props: { open: true, characterId: 'character', chatId: 'chat' },
        })

        await vi.waitFor(() => {
            expect(document.body.querySelector('[data-memory-settings]')).not.toBeNull()
        })
        expect(document.body.querySelector('[data-chat-risubard-settings]')).not.toBeNull()
        expect(document.body.textContent).toContain('분석 최근 메시지')
        expect(document.body.textContent).toContain('응답 최근 메시지')
        expect(document.body.textContent).toContain('정본 문체')
        const settingsSource = readFileSync(resolve(
            process.cwd(), 'src/lib/Others/RisuBardCurrentChatSettings.svelte'
        ), 'utf8')
        expect(settingsSource.match(/font-size:\s*calc\([^;]+\+\s*4px\)/g))
            .toHaveLength(4)
    })

    test('toggles the dock and workspace between desktop and mobile layouts from the title', async () => {
        mocks.loadNarrativeMemoryWiki.mockResolvedValue({
            mode: 'markdown',
            wikiPath: 'C:\\wiki',
            documents: [],
        })
        mounted = mount(RisuBardMemoryWiki, {
            target: document.body,
            props: {
                open: true,
                characterId: 'character',
                chatId: 'chat',
                onExecuteWikiCommand: async () => ({ applied: [], failed: [] }),
            },
        })

        let dock: HTMLElement | null = null
        let toggle: HTMLButtonElement | null = null
        await vi.waitFor(() => {
            dock = document.querySelector('[data-memory-wiki-dock]')
            toggle = document.querySelector('[data-memory-layout-toggle]')
            expect(dock?.dataset.memoryLayout).toBe('desktop')
            expect(toggle).not.toBeNull()
            expect(document.querySelector('[data-wiki-editor]')).not.toBeNull()
            expect(document.querySelector('[data-wiki-command-terminal]'))
                .not.toBeNull()
        })
        if (!dock || !toggle) throw new Error('Layout controls were not rendered')

        toggle.click()
        await tick()

        expect(dock.dataset.memoryLayout).toBe('mobile')
        expect(document.querySelector('[data-wiki-editor]')
            ?.classList.contains('mobile-layout')).toBe(true)
        expect(document.querySelector('[data-wiki-command-terminal]')
            ?.classList.contains('mobile-layout')).toBe(true)
        expect(toggle.getAttribute('aria-label')).toContain('데스크톱')

        toggle.click()
        await tick()
        expect(dock.dataset.memoryLayout).toBe('desktop')
    })

    test('opens current-chat settings outside the scrolling toolbar', async () => {
        mocks.loadNarrativeMemoryWiki.mockResolvedValue({
            mode: 'markdown',
            wikiPath: 'C:\\wiki',
            documents: [],
        })
        mounted = mount(RisuBardMemoryWiki, {
            target: document.body,
            props: { open: true, characterId: 'character', chatId: 'chat' },
        })

        let settings: HTMLButtonElement | null = null
        await vi.waitFor(() => {
            settings = document.querySelector('[data-memory-settings]')
            expect(settings).not.toBeNull()
        })
        if (!settings) throw new Error('Settings control was not rendered')

        settings.click()
        await tick()

        const popover = document.querySelector('[data-memory-settings-popover]')
        const toolbar = document.querySelector('.dock-views')
        expect(popover).not.toBeNull()
        expect(toolbar?.contains(popover)).toBe(false)
        expect(popover?.parentElement?.classList.contains('dock-header')).toBe(true)
        expect(settings.getAttribute('aria-expanded')).toBe('true')
    })

    test('uses a separate icon toolbar below the title and moves document count into the sidebar', async () => {
        const source = readFileSync(resolve(
            process.cwd(), 'src/lib/Others/RisuBardMemoryWiki.svelte'
        ), 'utf8')
        mocks.loadNarrativeMemoryWiki.mockResolvedValue({
            mode: 'markdown',
            wikiPath: 'C:\\Users\\reader\\RisuBard\\wiki',
            health: { danglingLinks: [], unlinkedDocumentIds: [] },
            documents: [{
                id: 'character.reader', type: 'character', status: 'active',
                title: 'Reader', relativePath: 'characters/reader.md',
                sourceMessageIds: [], updated: 'now', content: '# Reader',
                links: [], contextMode: 'auto', contentHash: 'hash',
            }],
        })
        const target = document.createElement('div')
        document.body.appendChild(target)
        mounted = mount(RisuBardMemoryWiki, {
            target,
            props: {
                open: true,
                characterId: 'character',
                chatId: 'chat',
            },
        })

        await vi.waitFor(() => {
            const views = document.body.querySelector('.dock-views')
            expect(views).not.toBeNull()
            expect(views?.parentElement?.classList.contains('dock-header')).toBe(true)
            expect(views?.previousElementSibling?.classList.contains('dock-titlebar')).toBe(true)
            expect(views?.querySelector('[data-risubard-force-wiki-update]'))
                .not.toBeNull()
            expect(views?.querySelector('[data-memory-settings]')).not.toBeNull()
            expect(document.body.querySelector('[data-wiki-editor-menu]')).toBeNull()
            expect(document.body.querySelector('.ledger-toolbar')).toBeNull()
            expect(document.body.querySelector('.wiki-health')?.textContent)
                .toMatch(/1\s*문서.*끊어진 링크 0/)
            expect(document.body.textContent).not.toContain('Markdown 원본')
            expect(document.body.textContent).not.toContain(
                'C:\\Users\\reader\\RisuBard\\wiki'
            )
        })

        const forceUpdate = document.body.querySelector(
            '[data-risubard-force-wiki-update]'
        )!
        const actions = document.body.querySelector('.dock-view-actions')!
        const workspace = document.body.querySelector('[data-memory-view="workspace"]')!
        const story = document.body.querySelector('[data-memory-view="story"]')!
        const arcPlot = document.body.querySelector('[data-memory-view="arc-plot"]')!
        const log = document.body.querySelector('[data-memory-view="log"]')!
        const settings = document.body.querySelector('[data-memory-settings]')!
        expect(forceUpdate.classList.contains('force-update-button')).toBe(true)
        expect(forceUpdate.querySelector('.force-update-idle')).not.toBeNull()
        expect(forceUpdate.querySelector('.force-update-hover')).not.toBeNull()
        expect(actions.contains(workspace)).toBe(true)
        expect(workspace.querySelector('[data-solar-icon="notebook"]')).not.toBeNull()
        expect(story.querySelector('[data-memory-icon="scroll"]')).not.toBeNull()
        expect(arcPlot.textContent).toContain('아크 플롯')
        expect(actions.querySelector('[data-memory-view="replace"]')).toBeNull()
        expect(settings.querySelector('[data-solar-icon="settings"]')).not.toBeNull()
        expect(forceUpdate.querySelector('span')?.textContent?.trim())
            .toBe(forceUpdate.getAttribute('aria-label'))
        const findReplace = document.body.querySelector<HTMLButtonElement>(
            '[data-wiki-open-find-replace]'
        )!
        expect(findReplace.textContent?.trim()).toBe('찾기/바꾸기')
        expect(findReplace.previousElementSibling).toBe(forceUpdate)
        expect(findReplace.querySelector('[data-solar-icon="magnifier"]')).not.toBeNull()
        expect(document.body.querySelector(
            '[data-wiki-action-toolbar] [data-wiki-open-find-replace]'
        )).toBeNull()
        expect(source).toMatch(/\.dock-views \.force-update-button,\s*\.dock-views \.find-replace-button,\s*\.dock-views \.reboot-button,\s*\.dock-views \.reboot-cancel-button\s*\{[^}]*height:\s*2\.25rem/s)
        expect(source).toMatch(/\.force-update-button img\s*\{[^}]*width:\s*24px[^}]*height:\s*24px/s)
        expect(source).toMatch(/\.dock-views \.force-update-button span,\s*\.dock-views \.find-replace-button span,\s*\.dock-views \.reboot-button span/)
        expect(source).toMatch(/\.dock-views\s*\{[^}]*min-height:\s*44px[^}]*padding:\s*\.3rem\s+\.35rem/s)
        expect(source).toMatch(/\.dock-identity strong\s*\{[^}]*font-family:\s*var\(--risu-font-family\)/s)
        expect(source).toMatch(/\.settings-popover\s*\{[^}]*background:\s*var\(--risu-theme-bgcolor\)/s)
        expect(source).toMatch(/\.dock-view-actions\s*\{[^}]*margin-left:\s*auto/s)
        expect(source).toMatch(/\.memory-wiki-dock\.mobile-layout \.dock-views\s*\{[^}]*overflow-x:\s*auto/s)
        expect(forceUpdate.compareDocumentPosition(workspace)
            & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0)
        expect(workspace.compareDocumentPosition(story)
            & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0)
        expect(story.compareDocumentPosition(arcPlot)
            & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0)
        expect(arcPlot.compareDocumentPosition(log)
            & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0)
        expect(story.compareDocumentPosition(log)
            & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0)
        expect(log.compareDocumentPosition(settings)
            & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0)
    })

    test('shows exact reboot turn and percentage progress below the toolbar', async () => {
        mocks.loadNarrativeMemoryWiki.mockResolvedValue({
            mode: 'markdown',
            wikiPath: 'C:\\wiki',
            health: { danglingLinks: [], unlinkedDocumentIds: [] },
            documents: [],
        })
        mounted = mount(RisuBardMemoryWiki, {
            target: document.body,
            props: {
                open: true,
                characterId: 'character',
                chatId: 'chat',
                rebootJob: {
                    version: 1,
                    jobId: 'job',
                    stagingChatId: 'reboot-job',
                    batchSize: 2,
                    status: 'running',
                    targetAssistantMessageIds: Array.from(
                        { length: 10 },
                        (_, index) => `assistant-${index + 1}`
                    ),
                    completedAssistantMessageIds: ['assistant-1', 'assistant-2'],
                    receipts: {},
                    startedAt: 1,
                    updatedAt: 2,
                    inFlightAssistantMessageIds: ['assistant-3', 'assistant-4'],
                },
            },
        })

        await vi.waitFor(() => expect(document.querySelector(
            '[data-risubard-wiki-reboot-progress]'
        )).not.toBeNull())
        const progress = document.querySelector<HTMLElement>(
            '[data-risubard-wiki-reboot-progress]'
        )!
        expect(progress.parentElement?.classList.contains('dock-views')).toBe(true)
        expect(progress.previousElementSibling?.classList.contains(
            'dock-view-actions'
        )).toBe(true)
        expect(progress.getAttribute('role')).toBe('progressbar')
        expect(progress.getAttribute('aria-valuemin')).toBe('0')
        expect(progress.getAttribute('aria-valuemax')).toBe('100')
        expect(progress.getAttribute('aria-valuenow')).toBe('20')
        expect(progress.textContent).toMatch(/2\s*\/\s*10/)
        expect(progress.textContent).toContain('20%')
        expect(progress.querySelector<HTMLElement>(
            '[data-risubard-wiki-reboot-progress-fill]'
        )?.style.width).toBe('20%')
        expect(progress.classList.contains('running')).toBe(true)
    })

    test('shows the current v2 graph instead of the v1 ledger', async () => {
        mocks.loadNarrativeMemoryWiki.mockResolvedValue({
            mode: 'v2',
            baseline: null,
            graph: {
                schemaVersion: 2,
                storyId: 'character',
                branchId: 'chat',
                revision: 1,
                nodes: [{
                    id: 'entity:lina',
                    kind: 'entity',
                    subtype: 'character',
                    title: 'Lina',
                    summary: 'Lina summary',
                    storyId: 'character',
                    branchId: 'chat',
                    status: 'active',
                    authority: 'draft',
                    salience: 5,
                    perspective: { kind: 'omniscient' },
                    epistemic: 'fact',
                    evidence: [{
                        chatId: 'chat',
                        messageId: 'message-1',
                    }],
                    revision: 1,
                }],
                edges: [],
            },
        })
        const target = document.createElement('div')
        document.body.appendChild(target)
        mounted = mount(RisuBardMemoryWiki, {
            target,
            props: {
                open: true,
                characterId: 'character',
                chatId: 'chat',
            },
        })

        await vi.waitFor(() => {
            expect(mocks.loadNarrativeMemoryWiki).toHaveBeenCalledOnce()
            expect(document.body.querySelector(
                '[data-memory-node-id="entity:lina"]'
            )).not.toBeNull()
            expect(document.body.querySelector(
                '[data-writer-workbench]'
            )).not.toBeNull()
            expect(document.body.querySelector(
                '[data-memory-v2-scroll]'
            )).not.toBeNull()
            expect(document.body.querySelector('[data-memory-wiki-dock]'))
                .not.toBeNull()
            expect(document.body.querySelector('[role="dialog"]')).toBeNull()
            const ledger = document.body.querySelector<HTMLElement>(
                '.memory-ledger'
            )
            expect(ledger?.classList.contains('min-h-0')).toBe(true)
        })
        await tick()
    })

    test('announces the safe v1 compatibility view when graph cache is unavailable', async () => {
        mocks.loadNarrativeMemoryWiki.mockResolvedValue({
            mode: 'v1',
            reason: 'missing-or-stale-v2-index',
            baseline: null,
            state: {
                facts: [],
                events: [],
            },
        })
        const target = document.createElement('div')
        document.body.appendChild(target)
        mounted = mount(RisuBardMemoryWiki, {
            target,
            props: {
                open: true,
                characterId: 'character',
                chatId: 'chat',
            },
        })

        await vi.waitFor(() => {
            const fallback = document.body.querySelector(
                '[data-memory-view-mode="v1"]'
            )
            expect(fallback).not.toBeNull()
            expect(fallback?.textContent).toContain('Compatibility view')
            expect(document.body.querySelector(
                '[data-writer-workbench]'
            )).toBeNull()
        })
    })

    test('reloads an open empty view when its background analysis completes', async () => {
        mocks.loadNarrativeMemoryWiki
            .mockResolvedValueOnce({
                mode: 'v1',
                reason: 'missing-or-stale-v2-index',
                baseline: null,
                state: { facts: [], events: [] },
            })
            .mockResolvedValueOnce({
                mode: 'v2',
                baseline: null,
                graph: {
                    schemaVersion: 2,
                    storyId: 'character',
                    branchId: 'chat',
                    revision: 1,
                    nodes: [{
                        id: 'entity:first-turn',
                        kind: 'entity',
                        subtype: 'character',
                        title: 'First turn',
                        summary: 'The first turn.',
                        storyId: 'character',
                        branchId: 'chat',
                        status: 'active',
                        authority: 'draft',
                        salience: 3,
                        perspective: { kind: 'omniscient' },
                        epistemic: 'fact',
                        evidence: [{
                            chatId: 'chat',
                            messageId: 'message-1',
                        }],
                        revision: 1,
                    }],
                    edges: [],
                },
            })
        const target = document.createElement('div')
        document.body.appendChild(target)
        mounted = mount(RisuBardMemoryWiki, {
            target,
            props: {
                open: true,
                characterId: 'character',
                chatId: 'chat',
            },
        })
        await vi.waitFor(() => {
            expect(mocks.loadNarrativeMemoryWiki).toHaveBeenCalledOnce()
            expect(document.body.querySelector(
                '[data-memory-view-mode="v1"]'
            )).not.toBeNull()
        })

        window.dispatchEvent(new CustomEvent('risubard-memory-updated', {
            detail: {
                characterId: 'character',
                chatId: 'chat',
            },
        }))

        await vi.waitFor(() => {
            expect(mocks.loadNarrativeMemoryWiki).toHaveBeenCalledTimes(2)
            expect(document.body.querySelector(
                '[data-memory-node-id="entity:first-turn"]'
            )).not.toBeNull()
        })
    })

    test('restores the dock ratio without fixed layout preset controls', async () => {
        mocks.db.risuBardMemoryDockRatio = 0.5
        mocks.loadNarrativeMemoryWiki.mockResolvedValue({
            mode: 'markdown',
            wikiPath: 'C:\\wiki',
            documents: [],
        })
        const target = document.createElement('div')
        document.body.appendChild(target)
        mounted = mount(RisuBardMemoryWiki, {
            target,
            props: {
                open: true,
                characterId: 'character',
                chatId: 'chat',
            },
        })

        await vi.waitFor(() => {
            const dock = document.body.querySelector<HTMLElement>(
                '[data-memory-wiki-dock]'
            )
            expect(dock?.style.flexBasis).toBe('50%')
        })
        expect(document.body.querySelector('[data-memory-layout-preset]'))
            .toBeNull()
    })

    test('restores and keyboard-resizes the wiki editor and command split', async () => {
        mocks.db.risuBardMemoryWorkspaceHeight = 460
        mocks.loadNarrativeMemoryWiki.mockResolvedValue({
            mode: 'markdown',
            wikiPath: 'C:\\wiki',
            documents: [],
        })
        mounted = mount(RisuBardMemoryWiki, {
            target: document.body,
            props: {
                open: true,
                characterId: 'character',
                chatId: 'chat',
                onExecuteWikiCommand: async () => ({ applied: [], failed: [] }),
            },
        })

        let split: HTMLElement | null = null
        let resizer: HTMLButtonElement | null = null
        await vi.waitFor(() => {
            split = document.querySelector('[data-wiki-workspace-split]')
            resizer = document.querySelector('[data-wiki-workspace-resizer]')
            expect(split).not.toBeNull()
            expect(resizer).not.toBeNull()
        })
        if (!split || !resizer) throw new Error('Workspace split was not rendered')
        expect(split.style.getPropertyValue('--wiki-workspace-height')).toBe('460px')

        resizer.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'ArrowDown',
            bubbles: true,
        }))
        await vi.waitFor(() => {
            expect(mocks.db.risuBardMemoryWorkspaceHeight).toBe(484)
            expect(split?.style.getPropertyValue('--wiki-workspace-height'))
                .toBe('484px')
        })
    })

    test('pins workspace panes to stable rows when the command resizer is hidden', () => {
        const source = readFileSync(resolve(
            process.cwd(), 'src/lib/Others/RisuBardMemoryWiki.svelte'
        ), 'utf8')

        expect(source).toContain(
            '.workspace-split > .wiki-editor-region { grid-row: 1; }'
        )
        expect(source).toContain(
            '.workspace-split > .workspace-resizer { grid-row: 2; }'
        )
        expect(source).toContain(
            '.workspace-split > .markdown-command-pane { grid-row: 3; }'
        )
    })

    test('lets the Markdown preview shrink inside the split workspace and scroll', () => {
        const source = readFileSync(resolve(
            process.cwd(), 'src/lib/Others/RisuBardMemoryWiki.svelte'
        ), 'utf8')

        expect(source).toMatch(
            /\.workspace-split \.wiki-editor-region :global\(\.editor-pane\)\s*\{[^}]*min-height:\s*0/s
        )
        expect(source).toMatch(
            /\.workspace-split \.wiki-editor-region :global\(\.markdown-editor\),\s*\.workspace-split \.wiki-editor-region :global\(\.markdown-preview\)\s*\{[^}]*min-height:\s*0/s
        )
    })

    test('keeps the collapsed Bardchat dock reachable in mobile layout', () => {
        const source = readFileSync(resolve(
            process.cwd(), 'src/lib/Others/RisuBardMemoryWiki.svelte'
        ), 'utf8')

        expect(source).toContain(
            '.memory-wiki-dock.mobile-layout .markdown-wiki.workspace-split'
        )
        expect(source).toMatch(/\.mobile-layout \.markdown-wiki\.workspace-split\.command-collapsed\s*\{[^}]*grid-template-rows:\s*minmax\(0, 1fr\) 0 3rem/s)
        expect(source).toMatch(/\.markdown-command-pane\s*\{[^}]*position:\s*relative[^}]*z-index:\s*6/s)
    })

    test('stores the selected RisuBard model on the current chat', async () => {
        mocks.loadNarrativeMemoryWiki.mockResolvedValue({
            mode: 'markdown', wikiPath: 'C:\\wiki', documents: [],
        })
        mocks.db.characters = [{ chaId: 'character', chats: [{ id: 'chat', message: [] }] }]
        const target = document.body.appendChild(document.createElement('div'))
        mounted = mount(RisuBardMemoryWiki, {
            target,
            props: { open: true, characterId: 'character', chatId: 'chat' },
        })

        let select: HTMLSelectElement | null = null
        await vi.waitFor(() => {
            select = document.body.querySelector('[data-memory-model-mode]')
            expect(select).not.toBeNull()
        })
        if (!select) throw new Error('Model mode setting was not rendered')
        expect(select.value).toBe('memory')
        select.value = 'model'
        select.dispatchEvent(new Event('change', { bubbles: true }))
        await vi.waitFor(() => {
            expect(mocks.db.characters?.[0].chats[0].risuBardSettings)
                .toEqual(expect.objectContaining({ risuBardModelMode: 'model' }))
            expect(mocks.db.risuBardModelMode).toBeUndefined()
        })
    })

    test('keeps documents and the direct command terminal together while logs use a separate view', async () => {
        mocks.loadNarrativeMemoryWiki.mockResolvedValue({
            mode: 'markdown',
            wikiPath: 'C:\\wiki',
            documents: [],
        })
        const target = document.body.appendChild(document.createElement('div'))
        mounted = mount(RisuBardMemoryWiki, {
            target,
            props: {
                open: true,
                characterId: 'character',
                chatId: 'chat',
                onExecuteWikiCommand: async () => ({ applied: [], failed: [] }),
            },
        })

        await vi.waitFor(() => {
            expect(document.body.querySelector('[data-wiki-editor]')).not.toBeNull()
            expect(document.body.querySelector('[data-wiki-command-terminal]')).not.toBeNull()
            expect(document.body.querySelector('[data-memory-activity]')).toBeNull()
        })
        document.body.querySelector<HTMLButtonElement>(
            '[data-memory-view="log"]'
        )?.click()
        await vi.waitFor(() => {
            expect(document.body.querySelector('[data-memory-activity]')).not.toBeNull()
            expect(document.body.querySelector('[data-wiki-editor]')).toBeNull()
        })
    })

    test('shows checkpoint progress before the first story arc plot exists', async () => {
        const events = ['출발', '첫 관문', '숲의 밤'].map((title, index) => ({
            id: `event.${index + 1}`, type: 'event' as const, status: 'active' as const,
            title, relativePath: `events/${index + 1}.md`, sourceMessageIds: [],
            created: `2026-08-0${index + 1}T00:00:00.000Z`,
            updated: `2026-08-0${index + 1}T00:00:00.000Z`,
            content: `# ${title}`, links: [], contextMode: 'auto' as const,
            contentHash: `hash-${index + 1}`,
        }))
        mocks.loadNarrativeMemoryWiki.mockResolvedValue({
            mode: 'markdown', wikiPath: 'C:\\wiki',
            health: { danglingLinks: [], unlinkedDocumentIds: [] },
            documents: events,
        })
        mounted = mount(RisuBardMemoryWiki, {
            target: document.body,
            props: { open: true, characterId: 'character', chatId: 'chat' },
        })

        await vi.waitFor(() => expect(document.querySelector(
            '[data-memory-view="arc-plot"]'
        )).not.toBeNull())
        document.querySelector<HTMLButtonElement>(
            '[data-memory-view="arc-plot"]'
        )?.click()

        await vi.waitFor(() => expect(document.querySelector(
            '[data-story-arc-plot]'
        )).not.toBeNull())
        expect(document.body.textContent).toContain('확정 사건 3/8개')
        expect(document.body.textContent).toContain('5개가 더 쌓이면')
        expect(document.querySelector('[data-story-arc-empty]')).not.toBeNull()
    })

    test('renders the canonical story arc plot and opens linked documents in the workspace', async () => {
        const event = {
            id: 'event.departure', type: 'event' as const, status: 'active' as const,
            title: '샤이어 출발', relativePath: 'events/departure.md',
            sourceMessageIds: ['message-5'], created: '2026-08-01T00:00:00.000Z',
            updated: '2026-08-01T00:00:00.000Z',
            content: '# 샤이어 출발', links: [], contextMode: 'auto' as const,
            contentHash: 'event-hash',
        }
        const plot = {
            id: 'other.story-arc', type: 'other' as const, status: 'active' as const,
            title: '스토리 아크 플롯', relativePath: 'notes/story-arc.md',
            sourceMessageIds: [], created: '2026-08-02T00:00:00.000Z',
            updated: '2026-08-02T00:00:00.000Z',
            content: '# 스토리 아크 플롯\n\n## 첫 번째 아크\n\n- [[샤이어 출발]]에서 여정이 시작됐다.\n\n<!-- risubard-story-arc-checkpoint: event.departure -->',
            links: [], contextMode: 'auto' as const, contentHash: 'plot-hash',
        }
        mocks.loadNarrativeMemoryWiki.mockResolvedValue({
            mode: 'markdown', wikiPath: 'C:\\wiki',
            health: { danglingLinks: [], unlinkedDocumentIds: [] },
            documents: [event, plot],
        })
        mounted = mount(RisuBardMemoryWiki, {
            target: document.body,
            props: { open: true, characterId: 'character', chatId: 'chat' },
        })

        await vi.waitFor(() => expect(document.querySelector(
            '[data-memory-view="arc-plot"]'
        )).not.toBeNull())
        document.querySelector<HTMLButtonElement>(
            '[data-memory-view="arc-plot"]'
        )?.click()
        await vi.waitFor(() => expect(document.querySelector(
            '[data-story-arc-document="other.story-arc"]'
        )).not.toBeNull())
        expect(document.body.textContent).toContain('첫 번째 아크')
        expect(document.body.textContent).toContain('다음 갱신까지 8개')

        document.querySelector<HTMLButtonElement>(
            '[data-story-arc-link="샤이어 출발"]'
        )?.click()
        await vi.waitFor(() => expect(document.querySelector(
            '[data-wiki-editor]'
        )).not.toBeNull())
        expect(document.querySelector<HTMLInputElement>(
            '[aria-label="항목 이름"]'
        )?.value).toBe('샤이어 출발')

        document.querySelector<HTMLButtonElement>(
            '[data-memory-view="arc-plot"]'
        )?.click()
        await vi.waitFor(() => expect(document.querySelector(
            '[data-story-arc-edit]'
        )).not.toBeNull())
        document.querySelector<HTMLButtonElement>('[data-story-arc-edit]')?.click()
        await vi.waitFor(() => expect(document.querySelector<HTMLInputElement>(
            '[aria-label="항목 이름"]'
        )?.value).toBe('스토리 아크 플롯'))
    })

    test('opens story entries in the shared editor and keeps source navigation', async () => {
        mocks.loadNarrativeMemoryWiki.mockResolvedValue({
            mode: 'markdown', wikiPath: 'C:\\wiki',
            health: { danglingLinks: [], unlinkedDocumentIds: [] },
            documents: [{
                id: 'event.station', type: 'event', status: 'active',
                title: '폐쇄된 역', relativePath: 'events/station.md',
                sourceMessageIds: ['message-7'],
                created: '2026-08-15T00:00:00.000Z',
                updated: '2026-08-15T00:00:00.000Z',
                content: '# 폐쇄된 역\n\n## 이야기 요약\n\n- 폐쇄된 역에 도착했다.',
                links: [], contextMode: 'auto', contentHash: 'hash',
            }],
        })
        const onNavigateStorySource = vi.fn()
        mounted = mount(RisuBardMemoryWiki, {
            target: document.body,
            props: {
                open: true, characterId: 'character', chatId: 'chat',
                onNavigateStorySource,
            },
        })
        await vi.waitFor(() => expect(document.querySelector(
            '[data-memory-view="story"]'
        )).not.toBeNull())
        document.querySelector<HTMLButtonElement>(
            '[data-memory-view="story"]'
        )?.click()
        await vi.waitFor(() => expect(document.querySelector(
            '[data-story-entry="event.station"]'
        )).not.toBeNull())
        document.querySelector<HTMLButtonElement>('[data-story-source]')?.click()
        expect(onNavigateStorySource).toHaveBeenCalledWith({
            kind: 'chat', messageIds: ['message-7'],
        })

        document.querySelector<HTMLButtonElement>('[data-story-edit]')?.click()
        await vi.waitFor(() => expect(document.querySelector(
            '[data-wiki-editor]'
        )).not.toBeNull())
        expect(document.querySelector<HTMLInputElement>(
            '[aria-label="항목 이름"]'
        )?.value).toBe('폐쇄된 역')
        expect(document.querySelector<HTMLTextAreaElement>(
            '[aria-label="Markdown"]'
        )?.value).toContain('폐쇄된 역에 도착했다.')
    })
})
