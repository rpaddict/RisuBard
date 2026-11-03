// @vitest-environment happy-dom

import { afterEach, describe, expect, test, vi } from 'vitest'
import { mount, tick, unmount } from 'svelte'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { completeMemoryWikiFork } from 'src/ts/risubard/memoryWikiFork'
import { startGeneration, endGeneration } from 'src/ts/process/generationState'
import { painterTestState } from './BardPainterTestState.svelte'
import { createPainterChatData } from 'src/ts/bardPainter/types'

const mocks = vi.hoisted(() => ({
    loadNarrativeMemoryWiki: vi.fn(),
    saveManualWikiDocument: vi.fn(),
    getBardChatUndoStatus: vi.fn(async () => ({ available: false })),
    restoreBardChatUndo: vi.fn(async () => ({ restored: true })),
    replaceWikiText: vi.fn(),
    saveChatToServer: vi.fn(),
    importWikiPackage: vi.fn(async () => ({ imported: 1 })),
    alertError: vi.fn(),
    db: {} as {
        risuBardMemoryDialogSize?: {
            width: number
            height: number
        }
        risuBardMemoryDockRatio?: number
        risuBardMemoryWorkspaceHeight?: number
        risuBardWikiSettingsView?: 'simple' | 'advanced'
        risuBardModelMode?: 'memory' | 'model'
        risuBardRecentMessageCount?: number
        risuBardResponseMessageCount?: number
        risuBardResponseIncludeUserMessages?: boolean
        risuBardHideOocTurns?: boolean
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
vi.mock('src/ts/alert', () => ({ alertError: mocks.alertError, alertConfirm: vi.fn(async () => true), alertNormal: vi.fn() }))
vi.mock('src/ts/risubard/wikiTransfer', async (importOriginal) => ({
    ...await importOriginal<typeof import('src/ts/risubard/wikiTransfer')>(),
    importWikiPackage: mocks.importWikiPackage,
}))
vi.mock('src/ts/process/request/request', () => ({
    requestChatData: vi.fn(),
}))
vi.mock('src/ts/loreBuilder', () => ({ collectLoreBuilderSources: vi.fn() }))
vi.mock('src/ts/process/files/inlays', () => ({ setInlayAsset: vi.fn(), getInlayAssetBlob: vi.fn() }))
vi.mock('src/ts/bardPainter/gallery', async () => {
    const { writable } = await import('svelte/store')
    return { painterGalleryRequested: writable(null), savePainterGalleryRecord: vi.fn() }
})
// The dock loads a catalog and fetches bodies on demand; these mocks serve
// both from the same fixture so the tests keep one source of truth.
const lastView = vi.hoisted(() => ({
    value: null as null | { documents?: Array<Record<string, unknown>> },
    bodies: null as null | Array<Record<string, unknown>>,
    bodyRequests: [] as string[][],
}))
vi.mock('src/ts/risubard/memoryWiki', async () => {
    const { storySection } = await import('src/ts/risubard/storySoFar')
    const documents = () => (lastView.value?.documents ?? []) as Array<{
        id: string; type: string; status: string; content?: string; title: string
    }>
    return {
        loadNarrativeMemoryWiki: mocks.loadNarrativeMemoryWiki,
        loadNarrativeMemoryWikiCatalog: async (input: unknown) => {
            const view = await mocks.loadNarrativeMemoryWiki(input)
            lastView.value = view
            return view
        },
        loadWikiDocumentBodies: async (input: { documentIds: string[] }) => {
            lastView.bodyRequests.push(input.documentIds)
            return ((lastView.bodies ?? documents()) as Array<{ id: string }>)
                .filter((document) => input.documentIds.includes(document.id))
        },
        searchWikiDocuments: async (input: { query: string }) =>
            documents().filter((document) =>
                `${document.title}\n${document.content ?? ''}`.includes(input.query))
                .map((document) => document.id),
        loadWikiStorySummaries: async () => new Map(documents()
            .filter((document) => document.type === 'event' && document.status === 'active')
            .map((document) => [document.id, storySection(document.content ?? '')] as const)
            .filter(([, summary]) => summary.length > 0)),
        warmWikiCatalog: async () => undefined,
        saveManualWikiDocument: mocks.saveManualWikiDocument,
        getBardChatUndoStatus: mocks.getBardChatUndoStatus,
        restoreBardChatUndo: mocks.restoreBardChatUndo,
    }
})
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
    botMakerMode: { set: vi.fn() },
    CharConfigSubMenu: { set: vi.fn() },
    risuBardGalleryOpen: { set: vi.fn() },
    MobileSideBar: { set: vi.fn() },
    ReloadChatPointer: { update: vi.fn() },
}))

import RisuBardMemoryWiki from './RisuBardMemoryWiki.svelte'
import RisuBardChatFindReplaceDialog from '../ChatScreens/RisuBardChatFindReplaceDialog.svelte'
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
    delete mocks.db.risuBardHideOocTurns
    delete mocks.db.characters
})

describe('RisuBardMemoryWiki', () => {
    test.each(['bot', 'chat'])('waits for hydration when switching %s with painter open', async (scope) => {
        mocks.loadNarrativeMemoryWiki.mockResolvedValue(null)
        const ready = { id: `ready-${scope}`, message: [], bardPainter: createPainterChatData() }
        ready.bardPainter.settings.instruction = '이전 채팅의 그림'
        const pending = { id: `pending-${scope}`, _placeholder: true, message: [], bardPainter: createPainterChatData() }
        pending.bardPainter.settings.instruction = '새 채팅의 그림'
        const characters = painterTestState([
            { chaId: `first-${scope}`, chats: scope === 'chat' ? [ready, pending] : [ready] },
            { chaId: `second-${scope}`, chats: scope === 'bot' ? [pending] : [] },
        ])
        mocks.db.characters = characters
        const props = painterTestState({ open: true, characterId: characters[0].chaId, chatId: ready.id })
        mounted = mount(RisuBardMemoryWiki, { target: document.body, props })
        await tick()
        document.querySelector<HTMLButtonElement>('[data-memory-view="painter"]')!.click()
        // This test covers chat hydration, not the cold Vite transform of the lazy painter bundle.
        await tick()
        await vi.dynamicImportSettled()
        const instruction = () => document.querySelector<HTMLTextAreaElement>('[aria-label="프롬프트 대화 입력"]')?.value
        await vi.waitFor(() => expect(instruction()).toBe('이전 채팅의 그림'))

        const destination = characters[scope === 'bot' ? 1 : 0]
        props.characterId = destination.chaId
        props.chatId = pending.id
        await tick()
        expect(document.querySelector('[data-bard-painter]')).toBeNull()
        expect(document.body.textContent).toContain('채팅을 불러오는 중...')

        // Hydration replaces the placeholder without changing the selected IDs.
        destination.chats[destination.chats.findIndex(chat => chat.id === pending.id)] = {
            id: pending.id, message: [], bardPainter: pending.bardPainter,
        }
        await vi.waitFor(() => expect(instruction()).toBe('새 채팅의 그림'))
        expect(document.body.textContent).not.toContain('채팅을 불러오는 중...')
    })

    test('opens a live OOC mirror before the workspace tab, even without a wiki', async () => {
        const onNavigateOocMessage = vi.fn()
        mocks.loadNarrativeMemoryWiki.mockRejectedValue(new Error('Wiki unavailable'))
        mocks.db.characters = [{ chaId: 'c', chats: [{ id: 'chat', message: [
            { role: 'user', chatId: 'u1', data: 'Story request' },
            { role: 'char', chatId: 'a1', data: 'Story response' },
            { role: 'user', chatId: 'u2', data: 'Plan a twist' },
            { role: 'char', chatId: 'a2', data: '<!-- OOC_turn --> **A secret door**' },
        ] }] }]
        mounted = mount(RisuBardMemoryWiki, {
            target: document.body,
            props: { open: true, characterId: 'c', chatId: 'chat', onNavigateOocMessage },
        })
        await tick()
        const tabs = [...document.querySelectorAll('[data-memory-view]')]
        expect(tabs.slice(0, 3).map((tab) => tab.getAttribute('data-memory-view'))).toEqual(['painter', 'ooc', 'workspace'])
        ;(tabs[1] as HTMLButtonElement).click()
        await tick()
        const memo = document.querySelector('[data-ooc-notepad]')
        expect(memo?.textContent).toContain('Plan a twist')
        await vi.waitFor(() => expect(memo?.querySelector('strong')?.textContent).toBe('A secret door'))
        expect(memo?.textContent).not.toContain('Story response')
        expect(memo?.textContent).not.toContain('<!-- OOC_turn -->')
        const toggle = memo?.querySelector<HTMLInputElement>('[data-ooc-hide]')
        expect(toggle?.checked).toBe(false)
        toggle?.click()
        await tick()
        expect(mocks.db.risuBardHideOocTurns).toBe(true)
        memo?.querySelector<HTMLButtonElement>('[data-ooc-message-index="3"] [data-ooc-source]')?.click()
        expect(mocks.db.risuBardHideOocTurns).toBe(false)
        expect(onNavigateOocMessage).toHaveBeenCalledWith(3)
    })

    test('opens with a body-less catalog and fetches only the selected page body', async () => {
        const page = (id: string, title: string) => ({
            id, title, type: 'character' as const, status: 'active' as const,
            contextMode: 'auto' as const, contentHash: `hash-${id}`,
            relativePath: `characters/${id}.md`, aliases: [], sourceMessageIds: [],
            updated: 'now', links: [],
        })
        const catalog = [page('alpha', 'Alpha'), page('beta', 'Beta')]
        lastView.bodies = catalog.map((item) => ({ ...item, content: `## ${item.title}\n\n${item.title} body.` }))
        lastView.bodyRequests = []
        mocks.loadNarrativeMemoryWiki.mockResolvedValue({
            mode: 'markdown', wikiPath: 'C:\\wiki', documents: catalog,
            health: { danglingLinks: [], unlinkedDocumentIds: [] },
        })
        mounted = mount(RisuBardMemoryWiki, {
            target: document.body,
            props: { open: true, characterId: 'character', chatId: 'catalog-chat' },
        })
        const content = () => document.querySelector<HTMLTextAreaElement>('[aria-label="Markdown"]')?.value
        await vi.waitFor(() => expect(content()).toBe('## Alpha\n\nAlpha body.'))
        expect(lastView.bodyRequests).toEqual([['alpha']])

        document.querySelector<HTMLButtonElement>('[aria-label^="Beta"]')?.click()
        await vi.waitFor(() => expect(content()).toBe('## Beta\n\nBeta body.'))
        expect(lastView.bodyRequests).toEqual([['alpha'], ['beta']])
        expect(mocks.saveManualWikiDocument).not.toHaveBeenCalled()
        lastView.bodies = null
    })

    test('reloads the visible canonical document after a save replaces the same chat workspace', async () => {
        const current = {
            id: 'same-document', title: 'Character', type: 'character' as const,
            status: 'active' as const, contextMode: 'auto' as const, contentHash: 'current-hash',
            relativePath: 'characters/character.md', aliases: [], tags: [],
            sourceMessageIds: [], updated: 'now', links: [],
            content: '# Character\n\nCurrent timeline.',
        }
        const saved = { ...current, content: '# Character\n\nSaved timeline.', contentHash: 'saved-hash' }
        const view = (item: typeof current) => ({
            mode: 'markdown' as const, wikiPath: 'C:\\wiki', documents: [item],
            health: { danglingLinks: [], unlinkedDocumentIds: [] },
        })
        mocks.loadNarrativeMemoryWiki.mockResolvedValueOnce(view(current)).mockResolvedValue(view(saved))
        mounted = mount(RisuBardMemoryWiki, {
            target: document.body,
            props: { open: true, characterId: 'character', chatId: 'same-chat' },
        })
        const content = () => document.querySelector<HTMLTextAreaElement>('[aria-label="Markdown"]')?.value
        await vi.waitFor(() => expect(content()).toBe(current.content))

        await completeMemoryWikiFork({
            characterId: 'character', destinationChatId: 'same-chat', forkToken: 'saved-snapshot', action: 'finalize',
            fetchImpl: vi.fn(async () => new Response(JSON.stringify({ action: 'finalize', completed: true }))),
            createAuth: async () => 'auth',
        })
        await vi.waitFor(() => expect(content()).toBe(saved.content))
        expect(mocks.loadNarrativeMemoryWiki).toHaveBeenCalledTimes(2)
        expect(mocks.saveManualWikiDocument).not.toHaveBeenCalled()
    })

    test('stays editable after saving a page whose refreshed catalog entry has no body', async () => {
        const entry = {
            id: 'kayo', title: '카요', type: 'character' as const, status: 'active' as const,
            contextMode: 'auto' as const, contentHash: 'hash-1', relativePath: 'characters/kayo.md',
            aliases: [], sourceMessageIds: [], updated: 'now', links: [],
        }
        const savedEntry = { ...entry, contentHash: 'hash-2' }
        const savedBody = { ...savedEntry, content: '## 카요\n\n고친 내용' }
        const view = (item: typeof entry) => ({
            mode: 'markdown' as const, wikiPath: 'C:\\wiki', documents: [item],
            health: { danglingLinks: [], unlinkedDocumentIds: [] },
        })
        lastView.bodies = [{ ...entry, content: '## 카요\n\n처음 내용' }]
        lastView.bodyRequests = []
        mocks.loadNarrativeMemoryWiki.mockResolvedValueOnce(view(entry)).mockResolvedValue(view(savedEntry))
        mocks.saveManualWikiDocument.mockImplementation(async () => {
            lastView.bodies = [savedBody]
            return savedBody
        })
        mounted = mount(RisuBardMemoryWiki, {
            target: document.body,
            props: { open: true, characterId: 'character', chatId: 'save-body-chat' },
        })
        const editor = () => document.querySelector<HTMLTextAreaElement>('[aria-label="Markdown"]')
        await vi.waitFor(() => expect(editor()?.value).toContain('처음 내용'))
        editor()!.value = '## 카요\n\n고친 내용'
        editor()!.dispatchEvent(new Event('input', { bubbles: true }))
        await tick()
        document.querySelector<HTMLButtonElement>('[aria-label="저장"]')!.click()
        await vi.waitFor(() => expect(mocks.saveManualWikiDocument).toHaveBeenCalled())
        await vi.waitFor(() => {
            expect(lastView.bodyRequests.at(-1)).toEqual(['kayo'])
            const always = document.querySelector<HTMLButtonElement>('[data-wiki-context-segment="always"]')
            expect(always?.disabled).toBe(false)
        })
        expect(editor()?.value).toContain('고친 내용')
        lastView.bodies = null
        mocks.saveManualWikiDocument.mockReset()
    })

    test('docks outside a constrained theme and cleans up when the chat unmounts', async () => {
        const workspace = document.createElement('div')
        workspace.dataset.chatDockWorkspace = ''
        const theme = document.createElement('div')
        theme.style.width = '672px'
        workspace.append(theme)
        document.body.append(workspace)
        mocks.loadNarrativeMemoryWiki.mockResolvedValue({
            documents: [], links: [], chapters: [], events: [],
        })
        mounted = mount(RisuBardMemoryWiki, {
            target: theme,
            props: { open: true, characterId: 'character-a', chatId: 'chat-a' },
        })
        await tick()
        const dock = workspace.querySelector<HTMLElement>('[data-memory-wiki-dock]')!
        expect(dock.parentElement).toBe(workspace)
        expect(theme.querySelector('[data-memory-wiki-dock]')).toBeNull()

        vi.spyOn(workspace, 'getBoundingClientRect').mockReturnValue({
            left: 100, right: 1300, width: 1200,
        } as DOMRect)
        dock.querySelector('[aria-label="BardWiki 폭 조절"]')!.dispatchEvent(
            new PointerEvent('pointerdown', { bubbles: true }),
        )
        window.dispatchEvent(new PointerEvent('pointermove', { clientX: 820 }))
        window.dispatchEvent(new PointerEvent('pointerup'))
        await tick()
        expect(mocks.db.risuBardMemoryDockRatio).toBe(0.4)
        expect(dock.style.flexBasis).toBe('40%')

        const toggle = dock.querySelector<HTMLButtonElement>('[data-memory-layout-toggle]')!
        const previousLayout = dock.dataset.memoryLayout
        toggle.click()
        await tick()
        expect(dock.dataset.memoryLayout).not.toBe(previousLayout)
        expect(dock.parentElement).toBe(workspace)

        dock.querySelector<HTMLButtonElement>('[aria-label="BardWiki 닫기"]')!.click()
        await tick()
        expect(dock.dataset.open).toBe('false')
        await unmount(mounted)
        mounted = undefined
        expect(workspace.querySelector('[data-memory-wiki-dock]')).toBeNull()
        expect(theme.parentElement).toBe(workspace)
    })

    test('imports a dropped wiki package and rejects oversized files before reading', async () => {
        mocks.loadNarrativeMemoryWiki.mockResolvedValue({
            mode: 'markdown', wikiPath: 'wiki', documents: [],
            health: { danglingLinks: [], unlinkedDocumentIds: [] },
        })
        mounted = mount(RisuBardMemoryWiki, {
            target: document.body, props: { open: true, characterId: 'character', chatId: 'chat' },
        })
        await vi.waitFor(() => expect(document.querySelector('[data-wiki-tools]')).not.toBeNull())
        const pack = { format: 'risubard-wiki', version: 1, documents: [
            { id: 'character.alice', type: 'character', title: '앨리스', aliases: [], content: '## 앨리스', contextMode: 'auto' },
        ] }
        const file = new File([JSON.stringify(pack)], 'wiki.bardwiki.json', { type: 'application/json' })
        const drop = new Event('drop', { bubbles: true, cancelable: true })
        Object.defineProperty(drop, 'dataTransfer', { value: { files: [file] } })
        document.querySelector('[data-memory-wiki-dock]')!.dispatchEvent(drop)
        await vi.waitFor(() => expect(mocks.importWikiPackage).toHaveBeenCalledWith(expect.objectContaining({
            characterId: 'character', chatId: 'chat', package: pack,
        })))
        await vi.waitFor(() => expect(document.body.textContent).toContain('1개 위키 항목을 들여왔습니다.'))
        const oversized = new File([], 'large.bardwiki.json')
        Object.defineProperty(oversized, 'size', { value: 16 * 1024 * 1024 + 1 })
        const read = vi.spyOn(oversized, 'text')
        const largeDrop = new Event('drop', { bubbles: true, cancelable: true })
        Object.defineProperty(largeDrop, 'dataTransfer', { value: { files: [oversized] } })
        document.querySelector('[data-memory-wiki-dock]')!.dispatchEvent(largeDrop)
        await vi.waitFor(() => expect(mocks.alertError).toHaveBeenCalledWith('위키 파일은 16MB까지 들여올 수 있습니다.'))
        expect(read).not.toHaveBeenCalled()
        expect(mocks.importWikiPackage).toHaveBeenCalledTimes(1)
    })

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
        // The hidden settings popover is also a dialog, so look up the one holding the guide.
        expect(document.querySelector('[data-memory-help-content]')?.closest('[role="dialog"]')?.textContent)
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
            expect(help?.textContent).toContain('바꾼 값이 어디에 저장되는지')
            expect(help?.textContent).toContain('전역값 사용')
            expect(help?.textContent).toContain('고정 풀고 전역값 따르기')
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
                'LLM에 전달할 최근 채팅 내역', '답변에 그대로 넣을 최근 응답 수',
                '위키 분석 최근 원문', '위키 분석이 읽을 최근 응답 수',
                '과거 사용자 메시지 제외', '위키 작성 언어',
                '위키 조회 토큰 목표', '위키 조회 토큰 절대 상한',
                'AI 분석 토큰 상한', '한 번에 고칠 위키 문서 수', '정본 집필 문체',
            ]) expect(text).toContain(setting)
            // The window counts AI responses; the current request rides along outside the count.
            expect(text).toContain('메시지 수가 아니라 AI 응답 수')
            expect(text).toContain('현재 사용자 요청은 이 수와 별도로 항상 들어갑니다')
            expect(text).toContain('기본값은 각각 12')
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
            .mockResolvedValue(view(updated))
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
        mounted = mount(RisuBardChatFindReplaceDialog, {
            target: document.body,
            props: { open: true, characterId: 'character', chatId: 'chat' },
        })
        await vi.waitFor(() => expect(document.querySelector('[data-find-replace-find]')).not.toBeNull())
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
        startGeneration('other-chat', 'find-replace-test')
        try {
            await tick()
            document.querySelector<HTMLButtonElement>('[data-find-replace-run]')!.click()
            await vi.waitFor(() => expect(document.querySelector('[data-find-replace] [role="alert"]')?.textContent).toContain('현재 작업이 끝난 뒤'))
            expect(mocks.replaceWikiText).not.toHaveBeenCalled()
            expect(mocks.saveChatToServer).not.toHaveBeenCalled()
            expect(mocks.db.characters[0].chats[0].message[0].data).toBe('길버드가 왔다.')
        } finally {
            endGeneration('other-chat')
        }
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
        expect(document.querySelector<HTMLInputElement>('[data-find-replace-find]')?.value).toBe('길버드')
        expect(document.querySelector<HTMLInputElement>('[data-find-replace-replacement]')?.value).toBe('길버트')
        expect(document.querySelector('[data-find-replace]')).toBe(find.closest('[data-find-replace]'))
        await vi.waitFor(() => expect(document.querySelector('[data-find-replace]')?.textContent).toContain('4곳을 바꿨습니다'))
        mocks.saveChatToServer.mockRejectedValueOnce(new Error('챗 저장 실패'))
        find.value = '길버트'
        find.dispatchEvent(new Event('input', { bubbles: true }))
        replacement.value = '길버드'
        replacement.dispatchEvent(new Event('input', { bubbles: true }))
        await tick()
        document.querySelector<HTMLButtonElement>('[data-find-replace-run]')!.click()
        await vi.waitFor(() => expect(document.querySelector('[data-find-replace] [role="alert"]')?.textContent).toContain('챗 저장 실패'))
        expect(mocks.db.characters[0].chats[0].message[0].data).toBe('길버트가 왔다.')
        expect(document.querySelector<HTMLInputElement>('[data-find-replace-find]')?.value).toBe('길버트')
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
            ?.parentElement?.getAttribute('aria-label')).toBe('아만다 다인, 관련 있을 때 포함')
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
            .find((button) => button.getAttribute('aria-label') === '두 번째, 관련 있을 때 포함')!
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
        mocks.db.risuBardWikiSettingsView = 'advanced'
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
        expect(document.body.textContent).toContain('위키 분석이 읽을 최근 응답 수')
        expect(document.body.textContent).toContain('답변에 그대로 넣을 최근 응답 수')
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
            const shell = views?.parentElement
            expect(shell?.classList.contains('dock-views-shell')).toBe(true)
            expect(shell?.parentElement?.classList.contains('dock-header')).toBe(true)
            expect(shell?.previousElementSibling?.classList.contains('dock-titlebar')).toBe(true)
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
        const wikiTools = document.body.querySelector<HTMLButtonElement>('[data-wiki-tools]')!
        expect(wikiTools.textContent?.trim()).toBe('위키 도구')
        expect(wikiTools.previousElementSibling).toBe(forceUpdate)
        expect(document.body.querySelector('[data-wiki-open-find-replace]')).toBeNull()
        wikiTools.click()
        await vi.waitFor(() => expect(document.querySelector('[data-wiki-export]')).not.toBeNull())
        const toolLabels = [...document.querySelectorAll('[data-slot="dropdown-menu-item"]')].map(item => item.textContent?.trim())
        expect(document.querySelector('[data-slot="dropdown-menu-item"]')?.hasAttribute('data-risubard-wiki-reboot')).toBe(true)
        expect(toolLabels.slice(1, 6)).toEqual(['정본 압축', '사건 날짜 다시 매기기', '이 위키로 새 챗 시작', '위키 내보내기', '위키 들여오기'])
        const exportItem = document.querySelector<HTMLElement>('[data-wiki-export]')!
        exportItem.focus()
        exportItem.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
        await vi.waitFor(() => expect(document.querySelector('[data-export-document]')).not.toBeNull())
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

    test('reloads an open view when its background analysis completes', async () => {
        const view = (documents: Array<Record<string, unknown>>) => ({
            mode: 'markdown' as const, wikiPath: 'C:\\wiki', documents,
            health: { danglingLinks: [], unlinkedDocumentIds: [] },
        })
        mocks.loadNarrativeMemoryWiki
            .mockResolvedValueOnce(view([]))
            .mockResolvedValueOnce(view([{
                id: 'first-turn', title: 'First turn', type: 'character', status: 'active',
                contextMode: 'auto', contentHash: 'hash-first', relativePath: 'characters/first-turn.md',
                aliases: [], sourceMessageIds: [], updated: 'now', links: [], content: '## First turn',
            }]))
        mounted = mount(RisuBardMemoryWiki, {
            target: document.body,
            props: { open: true, characterId: 'character', chatId: 'chat' },
        })
        await vi.waitFor(() => expect(mocks.loadNarrativeMemoryWiki).toHaveBeenCalledOnce())

        window.dispatchEvent(new CustomEvent('risubard-memory-updated', {
            detail: { characterId: 'character', chatId: 'chat' },
        }))

        await vi.waitFor(() => {
            expect(mocks.loadNarrativeMemoryWiki).toHaveBeenCalledTimes(2)
            expect(document.body.textContent).toContain('First turn')
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

    test('uses source order in the tree and story and shows checkpoint progress', async () => {
        mocks.db.characters = [{ chaId: 'character', chats: [{ id: 'chat',
            message: [1, 2, 3].map(index => ({ chatId: `a${index}`, role: 'char' as const, data: `Turn ${index}` })),
        }] }]
        const events = ['출발', '첫 관문', '숲의 밤'].map((title, index) => ({
            id: `event.${index + 1}`, type: 'event' as const, status: 'active' as const,
            title, relativePath: `events/${index + 1}.md`, sourceMessageIds: [`a${index + 1}`],
            created: index === 0 ? '2026-09-30T00:00:00.000Z' : `2026-08-0${index + 1}T00:00:00.000Z`,
            updated: `2026-08-0${index + 1}T00:00:00.000Z`,
            content: `## ${title}\n\n### 이야기 요약\n\n- ${title}`, links: [], contextMode: 'auto' as const,
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
        expect([...document.querySelectorAll('.file-select .document-title')].map(node => node.textContent))
            .toEqual(['숲의 밤', '첫 관문', '출발'])
        document.querySelector<HTMLButtonElement>('[data-memory-view="story"]')?.click()
        await vi.waitFor(() => expect([...document.querySelectorAll<HTMLElement>('[data-story-entry]')]
            .map(node => node.dataset.storyEntry)).toEqual(['event.1', 'event.2', 'event.3']))
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

    test('fetches only the arc plot body when the catalog has none', async () => {
        const plot = {
            id: 'other.story-arc', type: 'other' as const, status: 'active' as const,
            title: '스토리 아크 플롯', relativePath: 'notes/story-arc.md',
            sourceMessageIds: [], created: '2026-08-02T00:00:00.000Z',
            updated: '2026-08-02T00:00:00.000Z',
            links: [], contextMode: 'auto' as const, contentHash: 'plot-hash',
        }
        const canonical = {
            id: 'character.frodo', type: 'character' as const, status: 'active' as const,
            title: '프로도', relativePath: 'characters/frodo.md', sourceMessageIds: [],
            updated: '2026-08-02T00:00:00.000Z', links: [], contextMode: 'auto' as const,
            contentHash: 'frodo-hash',
        }
        lastView.bodies = [
            { ...plot, content: '# 스토리 아크 플롯\n\n## 반지 원정\n\n- 원정대가 길을 나섰다.' },
            { ...canonical, content: '## 프로도\n\n반지를 맡았다.' },
        ]
        lastView.bodyRequests = []
        mocks.loadNarrativeMemoryWiki.mockResolvedValue({
            mode: 'markdown', wikiPath: 'C:\\wiki',
            health: { danglingLinks: [], unlinkedDocumentIds: [] },
            documents: [canonical, plot],
        })
        mounted = mount(RisuBardMemoryWiki, {
            target: document.body,
            props: { open: true, characterId: 'character', chatId: 'arc-chat' },
        })
        await vi.waitFor(() => expect(document.querySelector('[data-memory-view="arc-plot"]')).not.toBeNull())
        document.querySelector<HTMLButtonElement>('[data-memory-view="arc-plot"]')?.click()
        await vi.waitFor(() => expect(document.body.textContent).toContain('반지 원정'))
        expect(lastView.bodyRequests.flat()).toContain('other.story-arc')
        expect(lastView.bodyRequests.flat().filter((id) => id === 'other.story-arc')).toHaveLength(1)
        lastView.bodies = null
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

    describe('dock shell behaviour', () => {
        const page = (id: string, title: string, type = 'character') => ({
            id, title, type, status: 'active' as const, contextMode: 'auto' as const,
            contentHash: `hash-${id}`, relativePath: `${type}s/${id}.md`, aliases: [],
            sourceMessageIds: [], updated: 'now', links: [], content: `## ${title}\n\n### 이야기 요약\n\n- ${title}.`,
        })
        const markdownView = () => ({
            mode: 'markdown' as const, wikiPath: 'C:\\wiki',
            documents: [page('alpha', 'Alpha'), page('event-1', '첫 사건', 'event')],
            health: { danglingLinks: [], unlinkedDocumentIds: [] },
        })
        const view = (name: string) => document.querySelector<HTMLButtonElement>(`[data-memory-view="${name}"]`)!

        test('switching between wiki views does not reload the catalog', async () => {
            mocks.loadNarrativeMemoryWiki.mockResolvedValue(markdownView())
            mounted = mount(RisuBardMemoryWiki, { target: document.body, props: { open: true, characterId: 'c', chatId: 'views-chat' } })
            await vi.waitFor(() => expect(view('story')).not.toBeNull())
            const calls = mocks.loadNarrativeMemoryWiki.mock.calls.length
            for (const name of ['story', 'log', 'workspace', 'arc-plot', 'workspace']) {
                view(name).click()
                await tick()
            }
            expect(mocks.loadNarrativeMemoryWiki.mock.calls.length).toBe(calls)
        })

        test('every view button reports its pressed state and views sit apart from actions', async () => {
            mocks.loadNarrativeMemoryWiki.mockResolvedValue(markdownView())
            mounted = mount(RisuBardMemoryWiki, { target: document.body, props: { open: true, characterId: 'c', chatId: 'pressed-chat' } })
            await vi.waitFor(() => expect(view('story')).not.toBeNull())
            const views = [...document.querySelectorAll<HTMLButtonElement>('[data-memory-view]')]
            expect(views.every((button) => button.hasAttribute('aria-pressed'))).toBe(true)
            expect(view('workspace').getAttribute('aria-pressed')).toBe('true')
            const group = document.querySelector('[data-memory-view-group]')
            expect(group?.getAttribute('role')).toBe('group')
            expect(group?.contains(document.querySelector('[data-risubard-force-wiki-update]'))).toBe(false)
            expect(view('log').textContent).toContain('요청 기록')
        })

        test('a failed catalog load offers a retry that reloads', async () => {
            mocks.loadNarrativeMemoryWiki.mockRejectedValueOnce(new Error('boom'))
            mocks.loadNarrativeMemoryWiki.mockResolvedValue(markdownView())
            mounted = mount(RisuBardMemoryWiki, { target: document.body, props: { open: true, characterId: 'c', chatId: 'retry-chat' } })
            const retry = () => document.querySelector<HTMLButtonElement>('[data-memory-retry]')
            await vi.waitFor(() => expect(retry()).not.toBeNull())
            retry()!.click()
            await vi.waitFor(() => expect(view('story')).not.toBeNull())
            expect(retry()).toBeNull()
        })

        test('a failed story summary load stays inline and keeps the toolbar', async () => {
            mocks.loadNarrativeMemoryWiki.mockResolvedValue(markdownView())
            const memoryWiki = await import('src/ts/risubard/memoryWiki')
            const original = memoryWiki.loadWikiStorySummaries
            ;(memoryWiki as { loadWikiStorySummaries: unknown }).loadWikiStorySummaries = vi.fn(async () => { throw new Error('story down') })
            try {
                mounted = mount(RisuBardMemoryWiki, { target: document.body, props: { open: true, characterId: 'c', chatId: 'inline-chat' } })
                await vi.waitFor(() => expect(view('story')).not.toBeNull())
                view('story').click()
                await vi.waitFor(() => expect(document.querySelector('[data-memory-inline-error]')?.textContent).toContain('story down'))
                expect(document.querySelector('.ledger-error')).toBeNull()
                expect(view('workspace')).not.toBeNull()
                document.querySelector<HTMLButtonElement>('[data-memory-inline-error] [data-dismiss]')!.click()
                await tick()
                expect(document.querySelector('[data-memory-inline-error]')).toBeNull()
            } finally {
                ;(memoryWiki as { loadWikiStorySummaries: unknown }).loadWikiStorySummaries = original
            }
        })

        test('the settings popover is a dialog that closes on Escape', async () => {
            mocks.loadNarrativeMemoryWiki.mockResolvedValue(markdownView())
            mounted = mount(RisuBardMemoryWiki, { target: document.body, props: { open: true, characterId: 'c', chatId: 'settings-chat' } })
            const settings = () => document.querySelector<HTMLButtonElement>('[data-memory-settings]')!
            await vi.waitFor(() => expect(settings()).not.toBeNull())
            expect(settings().getAttribute('aria-haspopup')).toBe('dialog')
            settings().click()
            await tick()
            const popover = document.querySelector<HTMLElement>('[data-memory-settings-popover]')!
            expect(popover.hidden).toBe(false)
            popover.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
            await tick()
            expect(popover.hidden).toBe(true)
        })

        test('leaving the workspace with an unsaved edit asks first', async () => {
            const { alertConfirm } = await import('src/ts/alert')
            mocks.loadNarrativeMemoryWiki.mockResolvedValue(markdownView())
            mounted = mount(RisuBardMemoryWiki, { target: document.body, props: { open: true, characterId: 'c', chatId: 'dirty-chat' } })
            const editor = () => document.querySelector<HTMLTextAreaElement>('[aria-label="Markdown"]')
            await vi.waitFor(() => expect(editor()?.value).toContain('Alpha'))
            editor()!.value = '## Alpha\n\n고친 내용'
            editor()!.dispatchEvent(new Event('input', { bubbles: true }))
            await tick()
            vi.mocked(alertConfirm).mockResolvedValueOnce(false)
            view('story').click()
            await vi.waitFor(() => expect(alertConfirm).toHaveBeenCalled())
            await tick()
            expect(view('workspace').getAttribute('aria-pressed')).toBe('true')
            expect(editor()?.value).toContain('고친 내용')
            vi.mocked(alertConfirm).mockResolvedValueOnce(true)
            view('story').click()
            await vi.waitFor(() => expect(view('story').getAttribute('aria-pressed')).toBe('true'))
        })

        test('status banners can be dismissed and are cleared on chat switch', () => {
            const source = readFileSync(resolve(process.cwd(), 'src/lib/Others/RisuBardMemoryWiki.svelte'), 'utf8')
            expect(source).toContain('data-dismiss-force-update')
            expect(source).toContain('data-dismiss-transfer')
            const load = source.slice(source.indexOf('async function loadWiki()'), source.indexOf('function wikiScope()'))
            expect(load).toContain("forceUpdateStatus = ''")
            expect(load).toContain('settingsOpen = false')
        })
    })
})
