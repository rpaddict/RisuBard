<script lang="ts">
    import { onDestroy, untrack } from 'svelte'
    import {
        BanIcon,
        ChartColumnIcon,
        ChevronDownIcon,
        ChevronLeftIcon,
        ChevronRightIcon,
        CheckIcon,
        CopyIcon,
        FilePlusIcon,
        FileCodeIcon,
        FileTextIcon,
        GitBranchIcon,
        LibraryIcon,
        LinkIcon,
        LoaderCircleIcon,
        NewspaperIcon,
        PanelRightCloseIcon,
        PanelRightOpenIcon,
        PencilIcon,
        PlusIcon,
        ReplyIcon,
        RefreshCwIcon,
        RotateCcwIcon,
        Undo2Icon,
        SendHorizontalIcon,
        Settings2Icon,
        SparklesIcon,
        SquareIcon,
        TrashIcon,
        UnlinkIcon,
        UploadIcon,
        UserPlusIcon,
        UsersIcon,
        XIcon,
    } from '@lucide/svelte'
    import ShButton from 'src/lib/UI/GUI/ShButton.svelte'
    import { DBState, selectedCharID } from 'src/ts/stores.svelte'
    import { alertConfirm, alertConfirmMulti, alertInput } from 'src/ts/alert'
    import { downloadFile } from 'src/ts/globalApi.svelte'
    import { selectSingleFile } from 'src/ts/util'
    import {
        addAuthorPost,
        addComment,
        analyzeChat,
        banReader,
        canDeleteEpisode,
        deleteEpisode,
        emptyReaderBoardIndex,
        episodeLabel,
        chatKeyOf,
        clampInt,
        currentWork,
        deletePost,
        episodeTitle,
        findComment,
        findMatchingBoards,
        orderComments,
        READER_BOARD_STYLES,
        HARSHNESS_LABELS,
        LEVEL_LABELS,
        parseReaderBoardImport,
        previousWork,
        readerBoardExportFileName,
        renderReaderBoardHtml,
        renderReaderBoardMarkdown,
        workLabel,
        workScore,
        type ReaderBoard,
        type ReaderBoardAppearance,
        type ReaderBoardConceptPreset,
        type ReaderBoardIndex,
        type ReaderBoardPost,
        type ReaderBoardReader,
        type ReaderBoardSummary,
        type ReaderBoardWorkKind,
        totalSubscribers,
    } from 'src/ts/risubard/readerBoard'
    import {
        adoptImportedBoard,
        chatMessageViews,
        clearRunUndo,
        loadRunUndo,
        copyBoard,
        deleteReaderBoard,
        forkBoardForChat,
        linkChat,
        loadReaderBoard,
        loadReaderBoardIndex,
        newReaderBoard,
        runReaderBoard,
        runRoster,
        saveReaderBoard,
        saveReaderBoardModel,
        saveReaderBoardOptions,
        saveReaderBoardSystemPrompt,
        saveRunUndo,
        startWorkOnChat,
        unlinkChat,
        type ReaderBoardRunRecord,
        type ReaderBoardStage,
    } from 'src/ts/risubard/readerBoardStore'

    interface Props {
        open: boolean
    }

    let { open = $bindable() }: Props = $props()

    type View = 'board' | 'readers' | 'metrics' | 'settings' | 'manage'

    const RATIO_KEY = 'risubard-reader-board-dock-ratio'
    const COLLAPSED_KEY = 'risubard-reader-board-collapsed'
    const CONCEPT_PRESETS: [string, string][] = [
        ['추리 게시판', '셜로키언들이 모인 비밀 게시판. 추리의 공정성, 단서 배치, 서술 트릭에 깐깐하다. 범인과 트릭을 먼저 맞히려고 경쟁한다.'],
        ['성인 소설', '성인용 소설 게시판. 야한 장면에 거부감이 없고 수위와 묘사의 밀도, 관계의 긴장감을 솔직하게 평가한다.'],
        ['무협', '무협 소설 게시판. 무공 체계, 문파 간 세력 구도, 강호의 의리와 복수 서사에 밝은 고인물이 많다.'],
        ['로맨스 판타지', '로맨스 판타지 게시판. 남녀 주인공의 관계 진전, 설렘 포인트, 답답한 전개에 민감하다. 커플링 논쟁이 잦다.'],
    ]

    let index = $state<ReaderBoardIndex>(emptyReaderBoardIndex())
    let board = $state<ReaderBoard | null>(null)
    let loading = $state(true)
    let loadError = $state('')
    let notice = $state('')
    let view = $state<View>('board')
    let running = $state(false)
    let stage = $state<ReaderBoardStage | null>(null)
    let controller: AbortController | null = null
    let dockElement = $state<HTMLElement>()
    let ratio = $state(readRatio())
    let collapsed = $state(readCollapsed())

    // Start screen (no board linked to this chat).
    let createName = $state('')
    let createConcept = $state('')
    let createLevel = $state(1)
    let createHarshness = $state(2)
    // Posts folded down to their title, per board.
    let folded = $state<Set<number>>(new Set())

    // Episode range in turns, as the chat numbers them.
    let rangeStart = $state(1)
    let rangeEnd = $state(1)
    let page = $state(1)
    // The last run, while the board is still as that run left it.
    let undoRecord = $state<ReaderBoardRunRecord | null>(null)
    let systemPromptDraft = $state('')

    // Author composer.
    let composeTitle = $state('')
    let composeBody = $state('')
    let replyTarget = $state<{ postNo: number; ref?: string } | null>(null)
    let composeOpen = $state(false)

    // New-work form: the board that will move to this chat with a new work.
    let newWorkTarget = $state<ReaderBoardSummary | null>(null)
    let newWorkTitle = $state('')
    let newWorkKind = $state<ReaderBoardWorkKind>('new')
    let newWorkNoticeTitle = $state('')
    let newWorkNoticeBody = $state('')
    let newWorkWelcomeBack = $state(true)
    // Progress of a split run: episodes done out of total.
    let progress = $state<{ done: number; total: number } | null>(null)

    let manageScope = $state<'character' | 'all'>('character')
    let editingReader = $state<string | null>(null)

    const currentCharacter = $derived($selectedCharID >= 0 ? DBState.db.characters[$selectedCharID] : undefined)
    const currentChat = $derived(currentCharacter?.chats[currentCharacter.chatPage])
    const chatKey = $derived(currentCharacter?.chaId && currentChat?.id ? chatKeyOf(currentCharacter.chaId, currentChat.id) : '')
    // A chat still loading has no messages yet and would look fully rewound.
    const chatReady = $derived(!!currentChat?.message && !currentChat._placeholder)
    const views = $derived(open && currentCharacter && currentChat && chatReady ? chatMessageViews(currentCharacter, currentChat) : [])
    const linked = $derived(!!board && !!chatKey && chatReady && board.chatKeys.includes(chatKey))
    const analysis = $derived(board && linked ? analyzeChat(board, chatKey, views) : null)
    const matches = $derived(!board && chatKey ? findMatchingBoards(index, views) : [])
    const pendingAuthorCount = $derived(board?.pendingAuthor.length ?? 0)
    // A turn is a character message, numbered like the chat's "턴 N". Only
    // these become the novel; user messages are skipped.
    const turnIndexes = $derived(views.flatMap((view, i) => view.role === 'char' ? [i] : []))
    const turnByKey = $derived(new Map(turnIndexes.map((i, n) => [views[i].key, n + 1])))
    const totalTurns = $derived(turnIndexes.length)
    const firstTurn = $derived(analysis ? turnIndexes.filter((i) => i < analysis.nextStart).length + 1 : 1)
    const rangeStory = $derived(analysis && totalTurns >= firstTurn ? Math.max(0, Math.min(rangeEnd, totalTurns) - rangeStart + 1) : 0)
    const canPublish = $derived(rangeStory > 0)
    const splitSize = $derived(board?.settings.splitSize ?? 0)
    const plannedRanges = $derived(canPublish ? turnRanges(rangeStart, rangeEnd, splitSize) : [])
    const canUndo = $derived(!!undoRecord && !!board && undoRecord.after === board.updatedAt && undoRecord.chatKey === chatKey)
    const work = $derived(board ? currentWork(board) : null)
    const pastWork = $derived(board ? previousWork(board) : undefined)
    const workById = $derived(new Map((board?.works ?? []).map((item) => [item.id, item])))
    // Earlier boards of this character that could move here with a new work.
    const otherBoards = $derived(!board && currentCharacter
        ? index.boards.filter((item) => item.characterId === currentCharacter.chaId && !matches.some((match) => match.id === item.id)).slice(0, 4)
        : [])
    const canRun = $derived(linked && !running && (canPublish || pendingAuthorCount > 0 || (analysis?.removed.length ?? 0) > 0 || (analysis?.edited.length ?? 0) > 0))
    const posts = $derived(board ? [...board.posts].reverse() : [])
    const PAGE_SIZE = 10
    const pageCount = $derived(Math.max(1, Math.ceil(posts.length / PAGE_SIZE)))
    const pagePosts = $derived(posts.slice((Math.min(page, pageCount) - 1) * PAGE_SIZE, Math.min(page, pageCount) * PAGE_SIZE))
    const pageNumbers = $derived(pageWindow(Math.min(page, pageCount), pageCount))
    const episodeById = $derived(new Map((board?.episodes ?? []).map((episode) => [episode.id, episode])))
    const subscribers = $derived(board?.readers.filter((reader) => reader.subscribed).length ?? 0)
    const defaultBoardName = $derived(currentCharacter ? [currentCharacter.name, currentChat?.name].filter(Boolean).join(' ') : '')
    const allFolded = $derived(pagePosts.length > 0 && pagePosts.every((post) => folded.has(post.no)))
    const managed = $derived(manageScope === 'all' || !currentCharacter
        ? index.boards
        : index.boards.filter((item) => item.characterId === currentCharacter.chaId))

    /** Message index ranges for turns [from, to], `size` turns per episode (0: one episode). */
    function turnRanges(from: number, to: number, size: number): { start: number; end: number }[] {
        const last = Math.min(to, totalTurns)
        const step = size > 0 ? size : last - from + 1
        const ranges: { start: number; end: number }[] = []
        for (let turn = from; turn <= last; turn += step) {
            const end = Math.min(last, turn + step - 1)
            // A range opens right after the previous turn, so the user message
            // that led to this turn goes with it.
            const start = Math.max(analysis?.nextStart ?? 0, turn <= 1 ? 0 : turnIndexes[turn - 2] + 1)
            ranges.push({ start, end: turnIndexes[end - 1] })
        }
        return ranges
    }

    /** Turn numbers an episode covers in this chat, or how many when they are gone. */
    function episodeTurns(episode: { messageKeys: string[] }): string {
        const turns = episode.messageKeys.map((key) => turnByKey.get(key)).filter((turn): turn is number => turn !== undefined)
        if (turns.length === 0) return ''
        const min = Math.min(...turns)
        const max = Math.max(...turns)
        return min === max ? `턴 ${min}` : `턴 ${min}~${max}`
    }

    const FOLD_KEY = (id: string) => `risubard-reader-board-folded:${id}`

    function loadFolded() {
        if (!board) { folded = new Set(); return }
        try {
            const value = JSON.parse(localStorage.getItem(FOLD_KEY(board.id)) ?? '[]')
            folded = new Set(Array.isArray(value) ? value.filter((no) => typeof no === 'number') : [])
        }
        catch { folded = new Set() }
    }

    function saveFolded(next: Set<number>) {
        folded = next
        if (!board) return
        try { localStorage.setItem(FOLD_KEY(board.id), JSON.stringify([...next])) } catch {}
    }

    function toggleFold(postNo: number) {
        const next = new Set(folded)
        if (next.has(postNo)) next.delete(postNo)
        else next.add(postNo)
        saveFolded(next)
    }

    function foldPage(fold: boolean) {
        const next = new Set(folded)
        for (const post of pagePosts) {
            if (fold) next.add(post.no)
            else next.delete(post.no)
        }
        saveFolded(next)
    }

    function applyPreset(preset: Pick<ReaderBoardConceptPreset, 'concept' | 'level' | 'harshness'>, target: 'board' | 'create') {
        if (target === 'create') {
            createConcept = preset.concept
            createLevel = preset.level
            createHarshness = preset.harshness
            return
        }
        if (!board) return
        board.settings.concept = preset.concept
        board.settings.level = preset.level
        board.settings.harshness = preset.harshness
        void persist()
    }

    async function savePreset() {
        if (!board) return
        const name = (await alertInput('프리셋 이름', [], ''))?.trim()
        if (!name) return
        const preset: ReaderBoardConceptPreset = {
            id: `preset-${Date.now().toString(36)}`,
            name: name.slice(0, 40),
            concept: board.settings.concept,
            level: board.settings.level,
            harshness: board.settings.harshness,
        }
        // Same name replaces the old one.
        const presets = [...index.conceptPresets.filter((item) => item.name !== preset.name), preset]
        index = await saveReaderBoardOptions({ conceptPresets: presets }, index)
        notice = `'${preset.name}' 프리셋을 저장했습니다. 새 게시판을 만들 때도 고를 수 있습니다.`
    }

    async function removePreset(preset: ReaderBoardConceptPreset) {
        if (!(await alertConfirm(`'${preset.name}' 프리셋을 지울까요?`))) return
        index = await saveReaderBoardOptions({ conceptPresets: index.conceptPresets.filter((item) => item.id !== preset.id) }, index)
    }

    async function setAppearance(patch: Partial<ReaderBoardAppearance>) {
        // Show it at once; a later click must not be undone by an earlier save.
        const appearance = { ...index.appearance, ...patch }
        index = { ...index, appearance }
        index = await saveReaderBoardOptions({ appearance }, index)
    }

    function pageWindow(current: number, count: number): number[] {
        const start = Math.max(1, Math.min(current - 2, count - 4))
        return Array.from({ length: Math.min(5, count) }, (_, i) => start + i)
    }

    function readRatio(): number {
        try {
            const value = Number(localStorage.getItem(RATIO_KEY))
            return Number.isFinite(value) && value >= 0.15 && value <= 0.75 ? value : 0.34
        }
        catch { return 0.34 }
    }

    function readCollapsed(): boolean {
        try { return localStorage.getItem(COLLAPSED_KEY) === '1' }
        catch { return false }
    }

    function setCollapsed(value: boolean) {
        collapsed = value
        try { localStorage.setItem(COLLAPSED_KEY, value ? '1' : '0') } catch {}
    }

    function setRatio(value: number) {
        ratio = Math.min(0.75, Math.max(0.15, value))
        try { localStorage.setItem(RATIO_KEY, String(ratio)) } catch {}
    }

    function resize(event: PointerEvent) {
        event.preventDefault()
        const container = dockElement?.parentElement
        if (!container) return
        const update = (move: PointerEvent) => {
            const bounds = container.getBoundingClientRect()
            if (bounds.width > 0) setRatio((bounds.right - move.clientX) / bounds.width)
        }
        const stop = () => {
            window.removeEventListener('pointermove', update)
            window.removeEventListener('pointerup', stop)
        }
        window.addEventListener('pointermove', update)
        window.addEventListener('pointerup', stop, { once: true })
    }

    function resizeByKeyboard(event: KeyboardEvent) {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
        event.preventDefault()
        setRatio(ratio + (event.key === 'ArrowLeft' ? 0.05 : -0.05))
    }

    function errorText(cause: unknown): string {
        return cause instanceof Error ? cause.message : String(cause)
    }

    function formatTime(time: number): string {
        if (!time) return ''
        const date = new Date(time)
        const pad = (value: number) => String(value).padStart(2, '0')
        return `${date.getMonth() + 1}.${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
    }

    function storyName(): string {
        return currentCharacter?.name ?? ''
    }

    /** Names of linked chats, or null when none of them still exists. */
    function chatLabels(summary: Pick<ReaderBoardSummary, 'chatKeys'>): string[] {
        const labels: string[] = []
        for (const key of summary.chatKeys) {
            const split = key.indexOf(':')
            const chaId = key.slice(0, split)
            const chatId = key.slice(split + 1)
            const owner = DBState.db.characters.find((item) => item?.chaId === chaId)
            const chat = owner?.chats?.find((item) => item?.id === chatId)
            if (chat) labels.push(`${owner!.name} / ${chat.name || '이름 없는 챗'}`)
        }
        return labels
    }

    async function load() {
        loading = true
        loadError = ''
        try {
            index = await loadReaderBoardIndex()
            await openLinkedBoard()
        }
        catch (cause) {
            loadError = errorText(cause)
        }
        finally {
            loading = false
        }
    }

    async function openLinkedBoard() {
        const id = chatKey ? index.links[chatKey] : undefined
        notice = ''
        newWorkTarget = null
        board = id ? await loadReaderBoard(id) : null
        if (view === 'manage' && board) view = 'board'
        await loadUndo()
        resetRange()
    }

    async function loadUndo() {
        loadFolded()
        undoRecord = board ? (await loadRunUndo(board.id))?.run ?? null : null
    }

    function resetRange() {
        replyTarget = null
        composeOpen = false
        page = 1
        if (!board || !chatKey) return
        const current = analyzeChat(board, chatKey, views)
        rangeStart = views.slice(0, current.nextStart).filter((view) => view.role === 'char').length + 1
        rangeEnd = views.filter((view) => view.role === 'char').length
    }

    async function persist(next: ReaderBoard | null = board) {
        if (!next) return
        try {
            index = await saveReaderBoard($state.snapshot(next) as ReaderBoard, index)
        }
        catch (cause) {
            notice = `저장하지 못했습니다. ${errorText(cause)}`
        }
    }

    async function showBoard(target: ReaderBoard) {
        board = target
        view = 'board'
        await loadUndo()
        resetRange()
    }

    async function createBoard() {
        if (!currentCharacter || !chatKey) return
        const created = newReaderBoard({
            name: createName.trim() || defaultBoardName || `${currentCharacter.name} 독자 게시판`,
            characterId: currentCharacter.chaId,
            chatKey,
            concept: createConcept.trim(),
            level: createLevel,
            harshness: createHarshness,
        })
        await persist(created)
        createName = ''
        createConcept = ''
        createLevel = 1
        createHarshness = 2
        await showBoard(created)
        notice = '게시판을 만들었습니다. 첫 생성 때 독자 명단이 함께 만들어집니다.'
    }

    async function adoptMatch(summary: ReaderBoardSummary, mode: 'fork' | 'share') {
        if (!chatKey) return
        const source = await loadReaderBoard(summary.id)
        if (!source) {
            notice = '게시판을 불러오지 못했습니다.'
            return
        }
        if (mode === 'fork') {
            const fork = forkBoardForChat(source, chatKey)
            await persist(fork)
            await showBoard(fork)
            notice = `'${source.name}'을(를) 이 챗용으로 분기했습니다. 독자는 지금까지의 기억을 이어 갑니다.`
        }
        else {
            const result = await linkChat(source, chatKey, index)
            index = result.index
            await showBoard(result.board)
            notice = `'${source.name}'을(를) 이 챗과 함께 씁니다.`
        }
    }

    async function connectBoard(summary: ReaderBoardSummary) {
        if (!chatKey) return
        const target = await loadReaderBoard(summary.id)
        if (!target) return
        if (target.chatKeys.length > 0) {
            const confirmed = await alertConfirm(`'${target.name}'은(는) 다른 챗에도 연결되어 있습니다. 같은 게시판을 함께 쓸까요? 따로 이어 가려면 취소하고 복제를 쓰세요.`)
            if (!confirmed) return
        }
        const result = await linkChat(target, chatKey, index)
        index = result.index
        await showBoard(result.board)
    }

    function openNewWork(summary: ReaderBoardSummary) {
        newWorkTarget = summary
        newWorkTitle = ''
        newWorkKind = 'new'
        newWorkNoticeTitle = ''
        newWorkNoticeBody = ''
        newWorkWelcomeBack = true
    }

    async function submitNewWork() {
        if (!newWorkTarget || !chatKey) return
        const target = await loadReaderBoard(newWorkTarget.id)
        if (!target) {
            notice = '게시판을 불러오지 못했습니다.'
            return
        }
        const others = target.chatKeys.filter((key) => key !== chatKey).length
        if (others > 0 && !(await alertConfirm(`'${target.name}'은(는) 다른 챗 ${others}개에 연결되어 있습니다. 새 작품을 시작하면 게시판이 이 챗으로 옮겨 오고 그 챗들과의 연결은 끊깁니다. 계속할까요?`))) return
        const result = await startWorkOnChat(target, {
            chatKey,
            title: newWorkTitle,
            kind: newWorkKind,
            notice: { title: newWorkNoticeTitle, body: newWorkNoticeBody },
            welcomeBack: newWorkWelcomeBack,
        }, index)
        index = result.index
        newWorkTarget = null
        await showBoard(result.board)
        notice = `새 작품을 시작했습니다. 독자는 성격과 취향을 그대로 가지고, 이전 작품과 비교하며 읽습니다.${newWorkNoticeBody.trim() ? ' 공지에 대한 반응은 다음 생성 때 받습니다.' : ''}`
    }

    async function previewBoard(summary: ReaderBoardSummary) {
        const target = await loadReaderBoard(summary.id)
        if (target) await showBoard(target)
    }

    async function disconnect(summary: ReaderBoardSummary) {
        if (!chatKey) return
        const target = summary.id === board?.id ? board : await loadReaderBoard(summary.id)
        if (!target) return
        index = await unlinkChat(target, chatKey, index)
        if (board?.id === target.id) board = { ...target }
    }

    async function renameBoard(summary: ReaderBoardSummary) {
        const name = (await alertInput('게시판 이름', [], summary.name))?.trim()
        if (!name || name === summary.name) return
        const target = summary.id === board?.id ? board : await loadReaderBoard(summary.id)
        if (!target) return
        target.name = name.slice(0, 120)
        await persist(target)
    }

    async function duplicate(summary: ReaderBoardSummary) {
        const source = await loadReaderBoard(summary.id)
        if (!source) return
        await persist(copyBoard(source))
        notice = `'${source.name}'의 사본을 만들었습니다. 어느 챗에도 연결되지 않은 상태입니다.`
    }

    async function removeBoard(summary: ReaderBoardSummary) {
        const confirmed = await alertConfirm(`'${summary.name}'을(를) 삭제할까요? 게시글 ${summary.postCount}개와 독자 ${summary.readerCount}명의 기억이 사라지며 되돌릴 수 없습니다. 보관하려면 먼저 HTML로 저장하세요.`)
        if (!confirmed) return
        index = await deleteReaderBoard(summary.id, index)
        if (board?.id === summary.id) {
            board = null
            view = 'manage'
        }
    }

    async function exportBoard(summary: Pick<ReaderBoardSummary, 'id'>, format: 'html' | 'md') {
        const target = summary.id === board?.id ? $state.snapshot(board) as ReaderBoard : await loadReaderBoard(summary.id)
        if (!target) return
        try {
            await downloadFile(
                readerBoardExportFileName(target.name, format, new Date()),
                format === 'html' ? renderReaderBoardHtml(target) : renderReaderBoardMarkdown(target),
            )
        }
        catch (cause) {
            notice = `저장하지 못했습니다. ${errorText(cause)}`
        }
    }

    async function importBoard() {
        const file = await selectSingleFile(['html', 'htm', 'json'])
        if (!file) return
        try {
            const imported = adoptImportedBoard(parseReaderBoardImport(new TextDecoder().decode(file.data)))
            await persist(imported)
            notice = `'${imported.name}'을(를) 가져왔습니다. 관리 목록에서 이 챗에 연결할 수 있습니다.`
            view = 'manage'
        }
        catch (cause) {
            notice = errorText(cause)
        }
    }

    function generate() {
        if (!board) return
        const ranges: ({ start: number; end: number } | undefined)[] = plannedRanges.length > 0 ? [...plannedRanges] : [undefined]
        void runBatch(ranges, undefined, ranges.length > 1
            ? `턴 ${rangeStart}~${Math.min(rangeEnd, totalTurns)}을 ${ranges.length}화로 나눠 차례로 올립니다.`
            : '')
    }

    function generatePost(post: ReaderBoardPost) {
        void runBatch([undefined], post.no, '')
    }

    /**
     * Runs one press of a generate button: one request per range (more after
     * a split), saving after each. The board from before is kept so the run
     * can be undone or rolled again.
     */
    async function runBatch(ranges: ({ start: number; end: number } | undefined)[], onlyPostNo: number | undefined, splitMessage: string, before?: ReaderBoard) {
        if (!board || !linked || running) return
        const start = before ?? $state.snapshot(board) as ReaderBoard
        if (ranges.length > 1) {
            const requests = ranges.length + (start.readers.length === 0 ? 1 : 0)
            const confirmed = await alertConfirm(`${splitMessage || `${ranges.length}화를 차례로 올립니다.`} 모델 요청을 ${requests}번 보냅니다. 중간에 멈춰도 그때까지 올린 화는 남습니다.`)
            if (!confirmed) return
        }
        running = true
        notice = ''
        controller = new AbortController()
        const totals = { comments: 0, threads: 0, roster: 0, newReaders: [] as string[], dropped: [] as string[], returned: [] as string[] }
        let done = 0
        let working = start
        try {
            for (const range of ranges) {
                if (ranges.length > 1) progress = { done, total: ranges.length }
                const result = await runReaderBoard({
                    board: working,
                    chatKey,
                    views,
                    range,
                    onlyPostNo,
                    wiki: currentCharacter && currentChat?.id
                        ? { characterId: currentCharacter.chaId, chatId: currentChat.id, messages: currentChat.message.map((message) => ({ chatId: message.chatId, role: message.role })) }
                        : undefined,
                    model: index.model,
                    systemPrompt: index.systemPromptEnabled ? index.systemPrompt : undefined,
                    storyName: storyName(),
                    currentCharacter,
                    signal: controller.signal,
                    onStage: (value) => { stage = value },
                })
                working = result.board
                board = result.board
                await persist(result.board)
                done++
                totals.comments += result.applied.comments
                totals.threads += result.applied.threads
                totals.roster += result.rosterAdded
                totals.newReaders.push(...result.applied.newReaders)
                totals.dropped.push(...result.applied.dropped)
                totals.returned.push(...result.applied.returned)
            }
        }
        catch (cause) {
            const kept = done > 0 ? `${ranges.length}화 중 ${done}화까지 올렸습니다.` : '게시판은 그대로입니다.'
            notice = controller?.signal.aborted ? `생성을 멈췄습니다. ${kept}` : `생성하지 못했습니다. ${kept} ${errorText(cause)}`
        }
        finally {
            running = false
            stage = null
            progress = null
            controller = null
        }
        if (done > 0 && board) {
            const record: ReaderBoardRunRecord = { chatKey, ranges, onlyPostNo, after: board.updatedAt, savedAt: Date.now() }
            try {
                await saveRunUndo(start, record)
                undoRecord = record
            }
            catch { undoRecord = null }
        }
        resetRange()
        if (done === 0 || notice) return
        const parts = [`댓글 ${totals.comments}개`]
        if (ranges.length > 1) parts.unshift(`${done}화 연재`)
        if (totals.roster) parts.unshift(`독자 ${totals.roster}명 입장`)
        if (totals.threads) parts.push(`새 글 ${totals.threads}개`)
        if (totals.newReaders.length) parts.push(`새 독자 ${totals.newReaders.join(', ')}`)
        if (totals.dropped.length) parts.push(`구독 취소 ${totals.dropped.join(', ')}`)
        if (totals.returned.length) parts.push(`복귀 ${totals.returned.join(', ')}`)
        notice = parts.join(', ')
    }

    /** Puts the board back to just before the last run. */
    async function undoLastRun() {
        if (!board || !canUndo) return
        if (!(await alertConfirm('마지막 생성을 되돌릴까요? 그때 올라간 화, 댓글, 독자의 생각 변화가 모두 사라집니다.'))) return
        const saved = await loadRunUndo(board.id)
        if (!saved) return
        board = saved.board
        await persist(saved.board)
        await clearRunUndo(saved.board.id)
        undoRecord = null
        resetRange()
        notice = '마지막 생성을 되돌렸습니다.'
    }

    /** Undoes the last run and runs it again with the same range. */
    async function rerollLastRun() {
        if (!board || !canUndo || running) return
        const saved = await loadRunUndo(board.id)
        if (!saved) return
        await runBatch(saved.run.ranges, saved.run.onlyPostNo, '같은 범위를 다시 생성합니다.', saved.board)
    }

    async function removeEpisode(post: ReaderBoardPost) {
        if (!board || !post.episodeId) return
        const episode = episodeById.get(post.episodeId)
        if (!episode) return
        if (!(await alertConfirm(`${episodeTitle(episode)}을(를) 댓글과 지표째 지울까요? 이 화의 메시지는 다시 연재할 수 있습니다. 이 화를 읽고 바뀐 독자의 생각은 남으니, 방금 올린 화라면 '되돌리기'가 더 깔끔합니다.`))) return
        deleteEpisode(board, post.episodeId)
        await persist()
        resetRange()
    }

    async function banHandle(handle: string) {
        if (!board) return
        const reader = board.readers.find((item) => item.handle === handle)
        if (!reader) return
        const choice = await alertConfirmMulti(`'${handle}'을(를) 차단할까요? 차단한 독자는 다시 댓글을 달지 않습니다.`, [
            '차단만',
            { label: '차단하고 댓글도 지우기', variant: 'destructive' },
        ])
        if (choice !== 0 && choice !== 1) return
        banReader(board, reader.id, choice === 1)
        await persist()
        notice = `'${handle}'을(를) 차단했습니다.${choice === 1 ? ' 쓴 댓글과 글도 지웠습니다.' : ''}`
    }

    async function unbanReader(reader: ReaderBoardReader) {
        reader.banned = false
        await persist()
    }

    async function saveSystemPrompt(enabled = index.systemPromptEnabled) {
        index = await saveReaderBoardSystemPrompt({ systemPrompt: systemPromptDraft, systemPromptEnabled: enabled }, index)
    }

    async function moreReaders() {
        if (!board || running) return
        running = true
        stage = 'roster'
        controller = new AbortController()
        try {
            const result = await runRoster({
                board: $state.snapshot(board) as ReaderBoard,
                model: index.model,
                systemPrompt: index.systemPromptEnabled ? index.systemPrompt : undefined,
                storyName: storyName(),
                currentCharacter,
                signal: controller.signal,
            })
            board = result.board
            await persist(result.board)
            notice = `독자 ${result.added}명이 들어왔습니다.`
        }
        catch (cause) {
            notice = controller?.signal.aborted ? '멈췄습니다.' : `독자를 만들지 못했습니다. ${errorText(cause)}`
        }
        finally {
            running = false
            stage = null
            controller = null
        }
    }

    function startReply(post: ReaderBoardPost, ref?: string) {
        replyTarget = { postNo: post.no, ref }
        composeOpen = true
        composeTitle = ''
    }

    async function submitCompose() {
        if (!board || !composeBody.trim()) return
        if (replyTarget) {
            addComment(board, replyTarget.postNo, { author: board.settings.authorName, text: composeBody, replyTo: replyTarget.ref, byAuthor: true })
        }
        else {
            addAuthorPost(board, { title: composeTitle, body: composeBody })
            page = 1
        }
        composeBody = ''
        composeTitle = ''
        replyTarget = null
        composeOpen = false
        await persist()
    }

    async function removeAuthorPost(post: ReaderBoardPost) {
        if (!board) return
        if (!(await alertConfirm(`작가 글 #${post.no}을(를) 지울까요? 달린 댓글도 함께 사라집니다.`))) return
        deletePost(board, post.no)
        await persist()
    }

    async function setModel(model: ReaderBoardIndex['model']) {
        index = await saveReaderBoardModel(model, index)
    }

    async function removeReader(reader: ReaderBoardReader) {
        if (!board) return
        if (!(await alertConfirm(`'${reader.handle}'을(를) 명단에서 뺄까요? 이미 쓴 댓글은 남습니다.`))) return
        board.readers = board.readers.filter((item) => item.id !== reader.id)
        await persist()
    }

    function addBlankReader() {
        if (!board) return
        const id = `manual-${Date.now().toString(36)}`
        board.readers.push({
            id,
            handle: `독자${board.readers.length + 1}`,
            persona: '',
            taste: '',
            dealbreakers: '',
            level: board.settings.level,
            activity: 0.6,
            opinion: '',
            pastOpinions: [],
            theories: [],
            subscribed: true,
            joinedPostNo: board.nextPostNo - 1,
            lastActivePostNo: 0,
        })
        editingReader = id
    }

    function bar(value: number): string {
        return `${Math.max(0, Math.min(10, value)) * 10}%`
    }

    let started = false
    $effect(() => {
        if (!open || started) return
        started = true
        void load()
    })

    // Follow the chat the user is looking at.
    let lastChatKey = ''
    $effect(() => {
        const key = chatKey
        if (!started || loading || key === lastChatKey) return
        lastChatKey = key
        untrack(() => { void openLinkedBoard() })
    })

    // A new start (after publishing or a rewind) resets the range; new
    // messages move its end along.
    let lastFirstTurn = -1
    let lastTotal = -1
    $effect(() => {
        const total = totalTurns
        const first = analysis ? firstTurn : undefined
        untrack(() => {
            if (first === undefined) return
            const followEnd = rangeEnd === lastTotal
            if (first !== lastFirstTurn) {
                rangeStart = first
                rangeEnd = total
            }
            else if (followEnd || rangeEnd > total || rangeEnd < rangeStart) {
                rangeEnd = total
            }
            lastFirstTurn = first
            lastTotal = total
        })
    })

    // The start form names the board after the character and chat.
    $effect(() => {
        const name = defaultBoardName
        const show = !board
        untrack(() => { if (show) createName = name })
    })

    // The draft follows the saved prompt (loaded with the index).
    $effect(() => {
        const saved = index.systemPrompt
        untrack(() => { systemPromptDraft = saved })
    })

    $effect(() => {
        if (open) untrack(() => { if (collapsed) setCollapsed(false) })
    })

    onDestroy(() => controller?.abort())
</script>

{#snippet composer()}
    {#if board}
        <form class="compose-form" onsubmit={(event) => { event.preventDefault(); void submitCompose() }}>
            {#if replyTarget}
                {@const target = replyTarget.ref ? findComment(board, replyTarget.ref) : undefined}
                <p class="compose-target"><ReplyIcon size={13} /> {target ? `${target.author}의 댓글에 답글` : '이 글에 댓글'}</p>
            {:else}
                <input class="field" bind:value={composeTitle} maxlength="300" placeholder="제목 (예: 공지, 설정을 고쳤습니다)" aria-label="글 제목" />
            {/if}
            <textarea class="field area" bind:value={composeBody} rows="3" maxlength="6000" placeholder={replyTarget ? '답글 내용' : '독자에게 할 말'} aria-label="내용" data-reader-board-compose-body></textarea>
            <div class="form-actions">
                <ShButton variant="outline" size="sm" type="button" onclick={() => { composeOpen = false; replyTarget = null }}><XIcon size={14} /> 취소</ShButton>
                <ShButton variant="primary" size="sm" type="submit" disabled={!composeBody.trim()} data-reader-board-compose-submit><SendHorizontalIcon size={14} /> 올리기</ShButton>
            </div>
            <p class="hint">{replyTarget ? "올린 뒤 글 아래의 '이 글에 독자 반응 받기'로 이 글만 반응을 받을 수 있습니다." : '올린 글은 바로 저장됩니다. 독자 반응은 생성 버튼이나 글 아래 버튼으로 받습니다.'}</p>
        </form>
    {/if}
{/snippet}

<aside
    bind:this={dockElement}
    class="reader-board-dock look-{index.appearance.style}"
    style:--rb-scale={index.appearance.scale}
    class:closed={!open}
    class:collapsed
    style:flex-basis={collapsed ? null : `${ratio * 100}%`}
    aria-label="독자 게시판"
    aria-hidden={!open}
    inert={!open}
    data-reader-board
>
    <button type="button" class="rail" aria-label="독자 게시판 펼치기" title="펼치기" onclick={() => setCollapsed(false)}>
        <PanelRightOpenIcon size={18} />
        <span class="rail-title">독자 게시판</span>
        {#if running}<LoaderCircleIcon class="animate-spin" size={15} aria-label="생성 중" />{/if}
    </button>
    <button type="button" class="dock-resizer" aria-label="독자 게시판 폭 조절" onpointerdown={resize} onkeydown={resizeByKeyboard}></button>

    <header class="dock-header">
        <div class="dock-titlebar">
            <span class="dock-mark"><NewspaperIcon size={17} /></span>
            <div class="title-stack">
                <strong>{board?.name ?? '독자 게시판'}</strong>
                {#if board}
                    <small>
                        {#if work && board.works.length > 1}<span class="work-tag">{workLabel(work)}{work.kind === 'reboot' ? ' (다시 쓰기)' : ''}</span>{/if}
                        구독자 {totalSubscribers(board).toLocaleString()}명, 댓글 독자 {subscribers}명, 게시글 {board.posts.length}개
                        {#if board.forkedFrom}<span class="fork-tag"><GitBranchIcon size={11} /> {board.forkedFrom.boardName}에서 분기</span>{/if}
                    </small>
                {/if}
            </div>
            <span class="titlebar-spacer"></span>
            <button class="icon-button" class:active={view === 'manage'} type="button" aria-label="게시판 관리" title="게시판 관리" onclick={() => view = view === 'manage' ? 'board' : 'manage'} data-reader-board-manage>
                <LibraryIcon size={17} />
            </button>
            <button class="icon-button" type="button" aria-label="독자 게시판 접기" title="접기" onclick={() => setCollapsed(true)}><PanelRightCloseIcon size={18} /></button>
            <button class="icon-button" type="button" aria-label="독자 게시판 닫기" title="닫기" onclick={() => open = false}><XIcon size={18} /></button>
        </div>

        {#if board && view !== 'manage'}
            <div class="tabs" role="tablist" aria-label="게시판 보기">
                <button type="button" role="tab" aria-selected={view === 'board'} class:active={view === 'board'} onclick={() => view = 'board'}><NewspaperIcon size={14} /> 게시판</button>
                <button type="button" role="tab" aria-selected={view === 'readers'} class:active={view === 'readers'} onclick={() => view = 'readers'}><UsersIcon size={14} /> 독자</button>
                <button type="button" role="tab" aria-selected={view === 'metrics'} class:active={view === 'metrics'} onclick={() => view = 'metrics'}><ChartColumnIcon size={14} /> 지표</button>
                <button type="button" role="tab" aria-selected={view === 'settings'} class:active={view === 'settings'} onclick={() => view = 'settings'}><Settings2Icon size={14} /> 설정</button>
            </div>
        {/if}

        {#if board && view === 'board'}
            {#if !linked}
                <div class="banner">
                    <span>이 게시판은 지금 챗에 연결되어 있지 않아 읽기만 할 수 있습니다.</span>
                    {#if chatKey}
                        <ShButton variant="outline" size="xs" onclick={() => { const summary = index.boards.find((item) => item.id === board?.id); if (summary) void connectBoard(summary) }}><LinkIcon size={13} /> 이 챗에 연결</ShButton>
                    {/if}
                </div>
            {:else if analysis}
                {#if analysis.removed.length > 0}
                    <div class="banner warn" data-reader-board-rewind>
                        <RotateCcwIcon size={14} />
                        <span>{analysis.removed.map((episode) => `${episode.no}화`).join(', ')}의 메시지가 챗에서 사라졌습니다. 다음 생성 때 내려간 화로 처리되고, 독자들이 알아챕니다.</span>
                    </div>
                {:else if analysis.edited.length > 0}
                    <div class="banner">
                        <PencilIcon size={14} />
                        <span>{analysis.edited.map((episode) => `${episode.no}화`).join(', ')} 본문이 바뀌었습니다. 다음 생성 때 수정 알림이 올라갑니다.</span>
                    </div>
                {/if}
                <div class="publish-bar">
                    {#if totalTurns >= firstTurn}
                        <div class="range" aria-label="연재 범위">
                            <span>연재할 턴</span>
                            <input class="field num" type="number" min={firstTurn} max={rangeEnd} value={rangeStart} disabled={running}
                                onchange={(event) => { rangeStart = clampInt(event.currentTarget.value, firstTurn, rangeEnd, firstTurn); event.currentTarget.value = String(rangeStart) }}
                                aria-label="시작 턴" data-reader-board-range-start />
                            <span>~</span>
                            <input class="field num" type="number" min={rangeStart} max={totalTurns} value={rangeEnd} disabled={running}
                                onchange={(event) => { rangeEnd = clampInt(event.currentTarget.value, rangeStart, totalTurns, totalTurns); event.currentTarget.value = String(rangeEnd) }}
                                aria-label="끝 턴" data-reader-board-range-end />
                            <span class="muted tabular">{rangeStory}턴{firstTurn > 1 ? `, 턴 ${firstTurn - 1}까지 연재함` : ''}</span>
                        </div>
                        <div class="range" aria-label="나눠 연재">
                            <span>나눠 올리기</span>
                            <input class="field num" type="number" min="0" max="500" value={splitSize} disabled={running}
                                onchange={(event) => { if (!board) return; board.settings.splitSize = clampInt(event.currentTarget.value, 0, 500, 0); event.currentTarget.value = String(board.settings.splitSize); void persist() }}
                                aria-label="한 화에 넣을 턴 수" data-reader-board-split />
                            <span class="muted tabular">{splitSize > 0 ? `턴씩, ${plannedRanges.length}화` : '0이면 한 화로'}</span>
                        </div>
                    {:else}
                        <p class="muted small">{firstTurn > 1 ? `턴 ${firstTurn - 1}까지 모두 연재했습니다.` : '아직 연재할 턴이 없습니다.'}{pendingAuthorCount > 0 ? ` 작가 글 ${pendingAuthorCount}건에 대한 반응은 받을 수 있습니다.` : ''}</p>
                    {/if}
                    <div class="publish-actions">
                        {#if running}
                            <span class="stage"><LoaderCircleIcon class="animate-spin" size={14} /> {stage === 'roster' ? '독자 명단을 만드는 중' : '독자들이 읽는 중'}{progress ? ` (${progress.done + 1}/${progress.total}화)` : ''}</span>
                            <ShButton variant="outline" size="sm" onclick={() => controller?.abort()}><SquareIcon size={13} /> 멈추기</ShButton>
                        {:else}
                            {#if canUndo}
                                <ShButton variant="ghost" size="sm" onclick={() => void undoLastRun()} data-reader-board-undo><Undo2Icon size={14} /> 되돌리기</ShButton>
                                <ShButton variant="outline" size="sm" onclick={() => void rerollLastRun()} data-reader-board-reroll><RefreshCwIcon size={14} /> 다시 생성</ShButton>
                            {/if}
                            <ShButton variant="primary" size="sm" disabled={!canRun} onclick={() => generate()} data-reader-board-generate>
                                <SparklesIcon size={14} /> {canPublish ? (plannedRanges.length > 1 ? `${plannedRanges.length}화 연재하고 반응 받기` : '연재하고 반응 받기') : '독자 반응 받기'}
                            </ShButton>
                        {/if}
                    </div>
                </div>
            {/if}
        {/if}
        {#if notice}
            <p class="notice" aria-live="polite">{notice} <button type="button" class="link-button" onclick={() => notice = ''}>닫기</button></p>
        {/if}
    </header>

    <div class="body">
        {#if loading}
            <div class="state"><LoaderCircleIcon class="animate-spin" size={18} /> 게시판을 불러오는 중입니다.</div>
        {:else if loadError}
            <div class="state failure">
                <p>게시판 목록을 불러오지 못했습니다. {loadError}</p>
                <ShButton variant="outline" size="sm" onclick={() => void load()}><RotateCcwIcon size={14} /> 다시 시도</ShButton>
            </div>
        {:else if newWorkTarget}
            <form class="new-work" onsubmit={(event) => { event.preventDefault(); void submitNewWork() }} data-reader-board-new-work>
                <h3>'{newWorkTarget.name}'에서 새 작품 시작</h3>
                <p class="muted small">게시판이 이 챗으로 옮겨 오고, 지금까지의 작품은 연재 종료로 닫힙니다. 독자는 닉네임, 성격, 취향을 그대로 가지고, 이전 작품에 대한 생각은 한 줄 총평으로만 남습니다.</p>
                <label class="setting">
                    <span>새 작품 제목 (선택)</span>
                    <input class="field" bind:value={newWorkTitle} maxlength="120" placeholder="비워 두면 제목 없이 시작" />
                </label>
                <div class="setting">
                    <span>어떤 연재인가요</span>
                    <div class="segmented wide" role="radiogroup" aria-label="새 작품 종류">
                        <button type="button" role="radio" aria-checked={newWorkKind === 'new'} class:active={newWorkKind === 'new'} onclick={() => newWorkKind = 'new'}>완전히 새 이야기</button>
                        <button type="button" role="radio" aria-checked={newWorkKind === 'reboot'} class:active={newWorkKind === 'reboot'} onclick={() => newWorkKind = 'reboot'}>같은 이야기 다시 쓰기</button>
                    </div>
                    <p class="hint">{newWorkKind === 'reboot' ? '독자는 이전 판의 화별 내용을 기억하고, 같은 장면이 나아졌는지 비교합니다.' : '독자는 이전 작품의 설정이나 떡밥을 찾지 않고, 재미와 완성도만 비교합니다.'}</p>
                </div>
                <label class="setting">
                    <span>공지 제목 (선택)</span>
                    <input class="field" bind:value={newWorkNoticeTitle} maxlength="300" placeholder="예: 신작 연재를 시작합니다" />
                </label>
                <label class="setting">
                    <span>공지 내용 (선택)</span>
                    <textarea class="field area" bind:value={newWorkNoticeBody} rows="3" maxlength="6000" placeholder="예: 이전 작품을 즐겨 주셔서 감사합니다. 이번에는 다른 이야기를 해 보려고 합니다." data-reader-board-new-work-notice></textarea>
                </label>
                <label class="setting check">
                    <input type="checkbox" bind:checked={newWorkWelcomeBack} />
                    <span>구독을 끊었던 독자도 새 작품을 한 번 보러 옴</span>
                </label>
                <p class="hint">독자는 작가가 새로 시작하는 것을 평범한 일로 받아들이고, 몇 번째인지 따지지 않습니다. 지표는 작품별로 나뉘어 이전 작품의 같은 화수와 비교됩니다.</p>
                <div class="form-actions">
                    <ShButton variant="outline" size="sm" type="button" onclick={() => newWorkTarget = null}><XIcon size={14} /> 취소</ShButton>
                    <ShButton variant="primary" size="sm" type="submit" data-reader-board-new-work-submit><FilePlusIcon size={14} /> 새 작품 시작</ShButton>
                </div>
            </form>
        {:else if view === 'manage'}
            <section class="manage" data-reader-board-manage-view>
                <div class="manage-head">
                    <div class="segmented" role="radiogroup" aria-label="보기 범위">
                        <button type="button" role="radio" aria-checked={manageScope === 'character'} class:active={manageScope === 'character'} onclick={() => manageScope = 'character'}>현재 캐릭터</button>
                        <button type="button" role="radio" aria-checked={manageScope === 'all'} class:active={manageScope === 'all'} onclick={() => manageScope = 'all'}>전체</button>
                    </div>
                    <span class="titlebar-spacer"></span>
                    <ShButton variant="outline" size="sm" onclick={() => void importBoard()} data-reader-board-import><UploadIcon size={14} /> 가져오기</ShButton>
                    {#if chatKey && !index.links[chatKey]}
                        <ShButton variant="outline" size="sm" onclick={() => { board = null; view = 'board' }}><PlusIcon size={14} /> 새 게시판</ShButton>
                    {/if}
                </div>
                {#if managed.length === 0}
                    <p class="empty">{manageScope === 'character' ? '이 캐릭터의 게시판이 없습니다.' : '저장된 게시판이 없습니다.'} 내보낸 HTML 파일이 있으면 가져오기로 되살릴 수 있습니다.</p>
                {/if}
                <ul class="board-list">
                    {#each managed as item (item.id)}
                        {@const labels = chatLabels(item)}
                        {@const here = !!chatKey && item.chatKeys.includes(chatKey)}
                        <li class:current={board?.id === item.id}>
                            <div class="board-row">
                                <button type="button" class="board-name" onclick={() => void previewBoard(item)} title="게시판 열기">{item.name}</button>
                                {#if here}<span class="tag">이 챗</span>{/if}
                                {#if item.forkedFrom}<span class="tag subtle"><GitBranchIcon size={11} /> {item.forkedFrom.boardName}</span>{/if}
                            </div>
                            <p class="board-meta tabular">{#if (item.workCount ?? 1) > 1}작품 {item.workCount}개, 지금 작품 {/if}연재 {item.episodeCount}화, 게시글 {item.postCount}, 구독자 {item.subscriberCount.toLocaleString()}, 댓글 독자 {item.readerCount}, {formatTime(item.updatedAt)}</p>
                            <p class="board-meta">
                                {#if labels.length > 0}
                                    연결: {labels.join(', ')}
                                {:else if item.chatKeys.length > 0}
                                    <span class="orphan">연결 끊김: 연결된 챗이 삭제되었습니다</span>
                                {:else}
                                    연결된 챗 없음
                                {/if}
                            </p>
                            <div class="board-actions">
                                {#if chatKey && !here}
                                    <ShButton variant="outline" size="xs" onclick={() => void connectBoard(item)}><LinkIcon size={12} /> 이 챗에 연결</ShButton>
                                    <ShButton variant="outline" size="xs" onclick={() => openNewWork(item)} data-reader-board-new-work-open><FilePlusIcon size={12} /> 이 챗에서 새 작품</ShButton>
                                {/if}
                                {#if here}
                                    <ShButton variant="ghost" size="xs" onclick={() => void disconnect(item)}><UnlinkIcon size={12} /> 연결 해제</ShButton>
                                {/if}
                                <ShButton variant="ghost" size="xs" onclick={() => void renameBoard(item)}><PencilIcon size={12} /> 이름</ShButton>
                                <ShButton variant="ghost" size="xs" onclick={() => void duplicate(item)}><CopyIcon size={12} /> 복제</ShButton>
                                <ShButton variant="ghost" size="xs" onclick={() => void exportBoard(item, 'html')} data-reader-board-export-html><FileCodeIcon size={12} /> HTML</ShButton>
                                <ShButton variant="ghost" size="xs" onclick={() => void exportBoard(item, 'md')}><FileTextIcon size={12} /> MD</ShButton>
                                <ShButton variant="ghost" size="xs" className="text-danger" onclick={() => void removeBoard(item)} data-reader-board-delete><TrashIcon size={12} /> 삭제</ShButton>
                            </div>
                        </li>
                    {/each}
                </ul>
                <p class="hint">HTML 파일은 브라우저로 바로 열어 볼 수 있고, 같은 파일을 다시 가져올 수도 있습니다. 챗을 지워도 게시판은 남으며, 지우는 것은 여기서만 합니다.</p>
            </section>
        {:else if !board}
            <section class="start" data-reader-board-start>
                {#if !currentCharacter || !chatKey}
                    <p class="empty">캐릭터 챗을 열면 그 챗에 독자 게시판을 붙일 수 있습니다.</p>
                {:else}
                    {#if matches.length > 0}
                        <div class="match">
                            <h3>이 챗과 이어지는 게시판이 있습니다</h3>
                            <p class="muted small">복제하거나 세이브에서 불러온 챗으로 보입니다. 연재했던 메시지가 이 챗에도 들어 있습니다.</p>
                            {#each matches.slice(0, 3) as item (item.id)}
                                <div class="match-row">
                                    <strong>{item.name}</strong>
                                    <span class="muted small tabular">게시글 {item.postCount}, 구독자 {item.subscriberCount.toLocaleString()}, 댓글 독자 {item.readerCount}</span>
                                    <div class="board-actions">
                                        <ShButton variant="primary" size="xs" onclick={() => void adoptMatch(item, 'fork')} data-reader-board-fork><GitBranchIcon size={12} /> 분기해서 이어받기</ShButton>
                                        <ShButton variant="outline" size="xs" onclick={() => void adoptMatch(item, 'share')}><LinkIcon size={12} /> 같은 게시판 함께 쓰기</ShButton>
                                    </div>
                                </div>
                            {/each}
                            <p class="hint">분기는 지금까지의 독자 기억을 복사해 따로 이어 갑니다. 이 챗에서 사라진 화는 다음 생성 때 내려간 화로 처리됩니다. 함께 쓰기는 두 챗이 한 게시판에 연재합니다.</p>
                        </div>
                    {/if}
                    <form class="create" onsubmit={(event) => { event.preventDefault(); void createBoard() }}>
                        <h3>{matches.length > 0 ? '새 게시판으로 시작' : '이 챗에 독자 게시판 만들기'}</h3>
                        <p class="muted small">연재분을 올리면 가상의 독자들이 읽고 댓글을 답니다. 게시판은 채팅 프롬프트에 들어가지 않습니다.</p>
                        <label class="setting">
                            <span>이름</span>
                            <input class="field" bind:value={createName} maxlength="120" placeholder={defaultBoardName || `${currentCharacter.name} 독자 게시판`} data-reader-board-create-name />
                        </label>
                        <label class="setting">
                            <span>게시판 성격과 분위기</span>
                            <textarea class="field area" bind:value={createConcept} rows="3" maxlength="4000" placeholder="예: 셜로키언들의 비밀 게시판. 추리와 서술 트릭에 깐깐함."></textarea>
                        </label>
                        <div class="chips">
                            {#each CONCEPT_PRESETS as [label, concept] (label)}
                                <button type="button" class="chip" onclick={() => applyPreset({ concept, level: createLevel, harshness: createHarshness }, 'create')}>{label}</button>
                            {/each}
                            {#each index.conceptPresets as preset (preset.id)}
                                <button type="button" class="chip mine" title="{LEVEL_LABELS[preset.level]}, {HARSHNESS_LABELS[preset.harshness]}" onclick={() => applyPreset(preset, 'create')}>{preset.name}</button>
                            {/each}
                        </div>
                        <div class="form-actions">
                            <ShButton variant="primary" size="sm" type="submit" data-reader-board-create><CheckIcon size={14} /> 만들기</ShButton>
                        </div>
                    </form>
                    {#if otherBoards.length > 0}
                        <div class="match" data-reader-board-other-boards>
                            <h3>이전 게시판에서 새 작품 시작</h3>
                            <p class="muted small">같은 독자들에게 새 작품이나 다시 쓴 판을 보여 줍니다. 독자는 이전 작품과 비교하며 읽습니다.</p>
                            {#each otherBoards as item (item.id)}
                                <div class="match-row">
                                    <strong>{item.name}</strong>
                                    <span class="muted small tabular">연재 {item.episodeCount}화, 구독자 {item.subscriberCount.toLocaleString()}, 댓글 독자 {item.readerCount}, {formatTime(item.updatedAt)}</span>
                                    <div class="board-actions">
                                        <ShButton variant="outline" size="xs" onclick={() => openNewWork(item)}><FilePlusIcon size={12} /> 이 챗에서 새 작품 시작</ShButton>
                                    </div>
                                </div>
                            {/each}
                        </div>
                    {/if}
                    {#if index.boards.length > 0}
                        <p class="hint">다른 캐릭터의 게시판은 오른쪽 위 관리에서 연결하거나 새 작품을 시작할 수 있습니다.</p>
                    {/if}
                {/if}
            </section>
        {:else if view === 'board'}
            <section class="feed" data-reader-board-feed>
                {#if linked}
                    <div class="compose" class:open={composeOpen && !replyTarget}>
                        {#if !composeOpen || replyTarget}
                            <button type="button" class="compose-open" onclick={() => { composeOpen = true; replyTarget = null }} data-reader-board-compose>
                                <PencilIcon size={14} /> {board.settings.authorName}(으)로 글쓰기
                            </button>
                        {:else}
                            {@render composer()}
                        {/if}
                    </div>
                {/if}
                {#if posts.length === 0}
                    <p class="empty">아직 글이 없습니다. 챗을 진행한 뒤 '연재하고 반응 받기'를 누르면 첫 화가 올라갑니다.</p>
                {:else}
                    <div class="feed-head">
                        <p class="muted small">최신 글이 위에 있습니다.</p>
                        <button type="button" class="link-button" onclick={() => foldPage(!allFolded)} data-reader-board-fold-all>
                            <ChevronDownIcon size={12} class={allFolded ? 'turned' : ''} /> {allFolded ? '이 쪽 모두 펴기' : '이 쪽 모두 접기'}
                        </button>
                    </div>
                {/if}
                {#each pagePosts as post (post.no)}
                    {@const episode = post.episodeId ? episodeById.get(post.episodeId) : undefined}
                    {@const retracted = episode?.status === 'retracted'}
                    {@const pending = board.pendingAuthor.some((item) => item.postNo === post.no)}
                    {@const turns = episode ? episodeTurns(episode) : ''}
                    {@const isFolded = folded.has(post.no)}
                    <article class="post kind-{post.kind}" class:retracted class:folded={isFolded} data-reader-board-post={post.no}>
                        <header>
                            <button type="button" class="fold" aria-expanded={!isFolded} aria-label={isFolded ? '펴기' : '접기'} title={isFolded ? '펴기' : '접기'} onclick={() => toggleFold(post.no)} data-reader-board-fold>
                                <ChevronDownIcon size={14} />
                            </button>
                            {#if episode}<span class="ep-no tabular">{episodeLabel(episode)}</span>{/if}
                            <h3>{episode ? (episode.title || '부제 없음') : post.title}</h3>
                            {#if episode && board.works.length > 1 && episode.workId !== board.currentWorkId}<span class="tag subtle">{workLabel(workById.get(episode.workId) ?? { no: 0, title: '이전 작품' })}</span>{/if}
                            {#if retracted}<span class="tag warn">내려감</span>{/if}
                            {#if episode?.editedAt}<span class="tag subtle">수정됨</span>{/if}
                            {#if pending}<span class="tag subtle">반응 대기</span>{/if}
                        </header>
                        <p class="meta post-meta"><b class:author-name={post.kind === 'author' || post.kind === 'episode'}>{post.author}</b> <span class="tabular">{formatTime(post.createdAt)}</span>{#if turns} <span class="tabular">{turns}</span>{/if} <span class="tabular post-no">#{post.no}</span>{#if isFolded && post.comments.length > 0} <span class="tabular">댓글 {post.comments.length}</span>{/if}</p>
                        {#if !isFolded}
                        {#if post.body}<p class="post-body">{post.body}</p>{/if}
                        {#if post.comments.length > 0}
                            <p class="comments-head tabular">댓글 {post.comments.length}</p>
                            <ul class="comments">
                                {#each orderComments(post) as { comment, reply } (comment.no)}
                                    {@const ref = `${post.no}-${comment.no}`}
                                    {@const parent = comment.replyTo ? findComment(board, comment.replyTo) : undefined}
                                    {@const writer = comment.byAuthor ? undefined : board.readers.find((reader) => reader.handle === comment.author)}
                                    <li class:reply class:by-author={comment.byAuthor} class:banned={writer?.banned}>
                                        <p class="meta">
                                            <b>{comment.author}</b>
                                            {#if writer?.banned}<span class="tag warn">차단됨</span>{/if}
                                            {#if parent}<span class="reply-to"><ReplyIcon size={11} /> {parent.author}</span>{/if}
                                        </p>
                                        <p class="comment-text">{comment.text}</p>
                                        {#if linked && !comment.byAuthor}
                                            <div class="comment-actions">
                                                <button type="button" class="link-button" onclick={() => startReply(post, ref)}><ReplyIcon size={11} /> 답글</button>
                                                {#if writer && !writer.banned}
                                                    <button type="button" class="link-button danger" onclick={() => void banHandle(writer.handle)}><BanIcon size={11} /> 차단</button>
                                                {/if}
                                            </div>
                                        {/if}
                                        {#if composeOpen && replyTarget?.postNo === post.no && replyTarget.ref === ref}
                                            <div class="inline-compose">{@render composer()}</div>
                                        {/if}
                                    </li>
                                {/each}
                            </ul>
                        {/if}
                        {#if composeOpen && replyTarget?.postNo === post.no && !replyTarget.ref}
                            <div class="inline-compose">{@render composer()}</div>
                        {/if}
                        {#if linked}
                            <div class="post-actions">
                                <button type="button" class="link-button" onclick={() => startReply(post)}><ReplyIcon size={12} /> 댓글</button>
                                {#if pending}
                                    <button type="button" class="link-button accent" disabled={running} onclick={() => generatePost(post)} data-reader-board-post-run><SparklesIcon size={12} /> 이 글에 독자 반응 받기</button>
                                {/if}
                                {#if post.kind === 'author'}
                                    <button type="button" class="link-button danger" onclick={() => void removeAuthorPost(post)}><TrashIcon size={12} /> 지우기</button>
                                {/if}
                                {#if episode && canDeleteEpisode(board, episode.id)}
                                    <button type="button" class="link-button danger" disabled={running} onclick={() => void removeEpisode(post)} data-reader-board-delete-episode><TrashIcon size={12} /> 이 화 지우기</button>
                                {/if}
                            </div>
                        {/if}
                        {/if}
                    </article>
                {/each}
                {#if pageCount > 1}
                    <nav class="pager" aria-label="게시판 페이지">
                        <button type="button" class="icon-button small" aria-label="이전 페이지" disabled={page <= 1} onclick={() => page = Math.max(1, page - 1)}><ChevronLeftIcon size={14} /></button>
                        {#each pageNumbers as number (number)}
                            <button type="button" class="page-number tabular" class:active={number === Math.min(page, pageCount)} aria-current={number === Math.min(page, pageCount) ? 'page' : undefined} onclick={() => page = number}>{number}</button>
                        {/each}
                        <button type="button" class="icon-button small" aria-label="다음 페이지" disabled={page >= pageCount} onclick={() => page = Math.min(pageCount, page + 1)}><ChevronRightIcon size={14} /></button>
                        <span class="muted small tabular">{Math.min(page, pageCount)}/{pageCount}쪽</span>
                    </nav>
                {/if}
            </section>
        {:else if view === 'readers'}
            <section class="readers" data-reader-board-readers>
                <div class="manage-head">
                    <p class="muted small tabular">독자 {board.readers.length}명, 구독 {subscribers}명</p>
                    <span class="titlebar-spacer"></span>
                    <ShButton variant="ghost" size="sm" disabled={running} onclick={addBlankReader}><PlusIcon size={14} /> 직접 추가</ShButton>
                    <ShButton variant="outline" size="sm" disabled={running} onclick={() => void moreReaders()}>
                        {#if running && stage === 'roster'}<LoaderCircleIcon class="animate-spin" size={14} />{:else}<UserPlusIcon size={14} />{/if}
                        {board.readers.length === 0 ? '명단 만들기' : `${board.settings.rosterSize}명 더 부르기`}
                    </ShButton>
                </div>
                {#if board.readers.length === 0}
                    <p class="empty">독자가 아직 없습니다. 첫 생성 때 설정의 인원만큼 자동으로 만들어지고, 여기서 먼저 만들어 고쳐 둘 수도 있습니다.</p>
                {/if}
                {#each board.readers as reader (reader.id)}
                    <article class="reader" class:left={!reader.subscribed || reader.banned}>
                        {#if editingReader === reader.id}
                            <form class="reader-form" onsubmit={(event) => { event.preventDefault(); editingReader = null; void persist() }}>
                                <label class="setting"><span>닉네임</span><input class="field" bind:value={reader.handle} maxlength="40" /></label>
                                <label class="setting"><span>성격과 말투</span><textarea class="field area" rows="2" bind:value={reader.persona} maxlength="800"></textarea></label>
                                <label class="setting"><span>좋아하는 것</span><input class="field" bind:value={reader.taste} maxlength="600" /></label>
                                <label class="setting"><span>싫어해서 떠나게 만드는 것</span><input class="field" bind:value={reader.dealbreakers} maxlength="600" /></label>
                                <div class="setting-row">
                                    <label class="setting"><span>수준</span>
                                        <select class="field" bind:value={reader.level}>
                                            {#each LEVEL_LABELS as label, i (label)}<option value={i}>{label}</option>{/each}
                                        </select>
                                    </label>
                                    <label class="setting"><span>활동성</span>
                                        <input class="field" type="range" min="0.05" max="1" step="0.05" bind:value={reader.activity} />
                                    </label>
                                    <label class="setting check"><input type="checkbox" bind:checked={reader.subscribed} /><span>구독 중</span></label>
                                </div>
                                <div class="form-actions">
                                    <ShButton variant="primary" size="sm" type="submit"><CheckIcon size={14} /> 저장</ShButton>
                                </div>
                            </form>
                        {:else}
                            <header>
                                <h3>{reader.handle}</h3>
                                <span class="tag subtle">{LEVEL_LABELS[reader.level]}</span>
                                {#if reader.banned}<span class="tag warn">차단됨</span>{:else if !reader.subscribed}<span class="tag warn">구독 취소</span>{/if}
                                <span class="titlebar-spacer"></span>
                                {#if reader.banned}
                                    <button type="button" class="link-button" onclick={() => void unbanReader(reader)}>차단 해제</button>
                                {:else}
                                    <button type="button" class="icon-button small danger" aria-label="{reader.handle} 차단" title="차단" onclick={() => void banHandle(reader.handle)}><BanIcon size={13} /></button>
                                {/if}
                                <button type="button" class="icon-button small" aria-label="{reader.handle} 고치기" title="고치기" onclick={() => editingReader = reader.id}><PencilIcon size={13} /></button>
                                <button type="button" class="icon-button small danger" aria-label="{reader.handle} 빼기" title="명단에서 빼기" onclick={() => void removeReader(reader)}><TrashIcon size={13} /></button>
                            </header>
                            {#if reader.persona}<p>{reader.persona}</p>{/if}
                            <dl>
                                {#if reader.taste}<dt>좋아함</dt><dd>{reader.taste}</dd>{/if}
                                {#if reader.dealbreakers}<dt>싫어함</dt><dd>{reader.dealbreakers}</dd>{/if}
                                {#if reader.opinion}<dt>지금 생각</dt><dd>{reader.opinion}</dd>{/if}
                                {#each reader.pastOpinions.slice().reverse() as past (past.workId)}
                                    <dt>{workLabel(workById.get(past.workId) ?? { no: 0, title: '이전 작품' })}</dt><dd>{past.opinion}</dd>
                                {/each}
                            </dl>
                            {@const theories = reader.theories.filter((theory) => theory.workId === board.currentWorkId)}
                            {#if theories.length > 0}
                                <ul class="theories">
                                    {#each theories.slice(-6) as theory (theory.id)}
                                        <li class="theory-{theory.status}">
                                            <span class="tag subtle">{theory.status === 'open' ? '추측' : theory.status === 'confirmed' ? '맞음' : '틀림'}</span>
                                            {theory.text}{theory.note ? ` (${theory.note})` : ''}
                                        </li>
                                    {/each}
                                </ul>
                            {/if}
                        {/if}
                    </article>
                {/each}
            </section>
        {:else if view === 'metrics'}
            <section class="metrics" data-reader-board-metrics>
                {#if board.metrics.length === 0}
                    <p class="empty">연재분이 올라가면 독자들이 매긴 점수가 화별로 쌓입니다. 감상 댓글보다 이탈과 점수 흐름이 더 객관적인 신호입니다.</p>
                {:else}
                    {#if work && pastWork}
                        {@const opening = workScore(board, work.id)}
                        {@const pastOpening = workScore(board, pastWork.id, Math.max(1, opening.episodes))}
                        {@const pastWhole = workScore(board, pastWork.id)}
                        <div class="compare" data-reader-board-compare>
                            <h3>이전 작품과 비교</h3>
                            <table>
                                <thead>
                                    <tr><th scope="col"></th><th scope="col">재미</th><th scope="col">몰입</th><th scope="col">개연성</th><th scope="col">다음 화</th></tr>
                                </thead>
                                <tbody>
                                    {#each [
                                        { label: `지금 작품 ${opening.episodes}화`, row: opening, against: null },
                                        { label: `${workLabel(pastWork)} 첫 ${pastOpening.episodes}화`, row: pastOpening, against: opening },
                                        { label: `${workLabel(pastWork)} 전체 ${pastWhole.episodes}화`, row: pastWhole, against: opening },
                                    ].filter((item, i) => i < 2 || pastWhole.episodes > pastOpening.episodes) as { label, row, against } (label)}
                                        {@const values = [row.fun, row.immersion, row.plausibility, row.nextIntent]}
                                        {@const mine = against ? [against.fun, against.immersion, against.plausibility, against.nextIntent] : null}
                                        <tr class:current-row={!against}>
                                            <th scope="row">{label}</th>
                                            {#each values as value, i (i)}
                                                <td class="tabular">
                                                    {row.episodes > 0 ? value.toFixed(1) : '-'}
                                                    {#if mine && row.episodes > 0 && opening.episodes > 0 && mine[i] !== value}
                                                        <span class="delta" class:up={mine[i] > value} class:down={mine[i] < value} title="지금 작품과의 차이">{mine[i] > value ? '+' : ''}{(mine[i] - value).toFixed(1)}</span>
                                                    {/if}
                                                </td>
                                            {/each}
                                        </tr>
                                    {/each}
                                </tbody>
                            </table>
                            <p class="hint">작은 숫자는 지금 작품이 그 줄보다 얼마나 높은지입니다. 같은 화수끼리 비교하려면 첫 n화 줄을 보세요.</p>
                        </div>
                    {/if}
                    <table>
                        <thead>
                            <tr><th scope="col">화</th><th scope="col">재미</th><th scope="col">몰입</th><th scope="col">개연성</th><th scope="col">다음 화</th><th scope="col">조회</th><th scope="col">구독자</th></tr>
                        </thead>
                        {#each [...board.works].reverse() as group (group.id)}
                            {@const rows = board.metrics.filter((metric) => metric.workId === group.id)}
                            {#if rows.length > 0}
                                <tbody>
                                    {#if board.works.length > 1}
                                        <tr class="work-row"><th scope="rowgroup" colspan="7">{workLabel(group)}{group.kind === 'reboot' ? ' (다시 쓰기)' : ''}{group.status === 'ended' ? ', 연재 종료' : ', 연재 중'}</th></tr>
                                    {/if}
                                    {#each rows as metric (metric.episodeId)}
                                        {@const episode = episodeById.get(metric.episodeId)}
                                        <tr class:retracted={episode?.status === 'retracted'}>
                                            <th scope="row">{episode ? `${episode.no}화${episode.revision ? '′'.repeat(Math.min(3, episode.revision)) : ''}` : `#${metric.postNo}`}</th>
                                            {#each [metric.fun, metric.immersion, metric.plausibility, metric.nextIntent] as value, i (i)}
                                                <td><span class="cell"><span class="tabular">{value.toFixed(1)}</span><span class="meter" aria-hidden="true"><span style:width={bar(value)}></span></span></span></td>
                                            {/each}
                                            <td class="tabular">{metric.views ? metric.views.toLocaleString() : '-'}</td>
                                            <td class="tabular" title={[metric.dropped.length ? `떠난 댓글 독자: ${metric.dropped.join(', ')}` : '', metric.joined.length ? `들어온 댓글 독자: ${metric.joined.join(', ')}` : ''].filter(Boolean).join('\n') || undefined}>
                                                {(metric.audienceSubscribers + metric.subscribers).toLocaleString()}
                                                {#if metric.gained + metric.joined.length > 0}<span class="delta up">+{metric.gained + metric.joined.length}</span>{/if}
                                                {#if metric.lost + metric.dropped.length > 0}<span class="delta down">-{metric.lost + metric.dropped.length}</span>{/if}
                                            </td>
                                        </tr>
                                    {/each}
                                </tbody>
                            {/if}
                        {/each}
                    </table>
                    <p class="hint">점수는 그 화를 읽은 독자들의 평균(0~10)입니다. 줄이 그어진 화는 내려간 화입니다. 조회와 구독자는 댓글을 달지 않고 읽기만 하는 독자까지 센 숫자로, 점수가 높을수록 새 독자가 늘고 다음 화 의향이 낮으면 구독을 끊습니다. 구독자 칸에 마우스를 올리면 떠나거나 들어온 댓글 독자가 보입니다.</p>
                {/if}
            </section>
        {:else if view === 'settings'}
            <section class="settings" data-reader-board-settings>
                {#if work}
                    <label class="setting">
                        <span>지금 작품 제목{board.works.length > 1 ? ` (${board.works.length}번째 작품)` : ''}</span>
                        <input class="field" maxlength="120" value={work.title} placeholder="비워 두면 캐릭터 이름을 작품 이름으로 씁니다"
                            onchange={(event) => { if (!board || !work) return; work.title = event.currentTarget.value.trim().slice(0, 120); void persist() }} />
                    </label>
                {/if}
                <label class="setting">
                    <span>게시판 성격과 분위기</span>
                    <textarea class="field area" rows="4" maxlength="4000" bind:value={board.settings.concept} onchange={() => void persist()} placeholder="예: 성인용 소설 게시판. 야한 것에 거부감이 없음." data-reader-board-concept></textarea>
                </label>
                <div class="chips">
                    {#each CONCEPT_PRESETS as [label, concept] (label)}
                        <button type="button" class="chip" onclick={() => { if (board) { board.settings.concept = concept; void persist() } }}>{label}</button>
                    {/each}
                    {#each index.conceptPresets as preset (preset.id)}
                        <span class="chip-group">
                            <button type="button" class="chip mine" title="{LEVEL_LABELS[preset.level]}, {HARSHNESS_LABELS[preset.harshness]}" onclick={() => applyPreset(preset, 'board')}>{preset.name}</button>
                            <button type="button" class="chip-remove" aria-label="{preset.name} 프리셋 지우기" title="프리셋 지우기" onclick={() => void removePreset(preset)}><XIcon size={11} /></button>
                        </span>
                    {/each}
                    <button type="button" class="chip add" onclick={() => void savePreset()} data-reader-board-save-preset><PlusIcon size={12} /> 지금 설정을 프리셋으로</button>
                </div>
                <p class="hint flush">프리셋에는 성격과 분위기, 독자 수준, 냉정함이 함께 저장됩니다.</p>
                <div class="setting">
                    <span>독자 수준</span>
                    <div class="segmented wide" role="radiogroup" aria-label="독자 수준">
                        {#each LEVEL_LABELS as label, i (label)}
                            <button type="button" role="radio" aria-checked={board.settings.level === i} class:active={board.settings.level === i} onclick={() => { if (board) { board.settings.level = i; void persist() } }}>{label}</button>
                        {/each}
                    </div>
                </div>
                <div class="setting">
                    <span>냉정함</span>
                    <div class="segmented wide" role="radiogroup" aria-label="냉정함">
                        {#each HARSHNESS_LABELS as label, i (label)}
                            <button type="button" role="radio" aria-checked={board.settings.harshness === i} class:active={board.settings.harshness === i} onclick={() => { if (board) { board.settings.harshness = i; void persist() } }}>{label}</button>
                        {/each}
                    </div>
                </div>
                <div class="setting-row">
                    <label class="setting">
                        <span>한 번에 활동할 독자</span>
                        <input class="field num" type="number" min="1" max="15" value={board.settings.readersPerRun}
                            onchange={(event) => { if (!board) return; board.settings.readersPerRun = clampInt(event.currentTarget.value, 1, 15, 5); event.currentTarget.value = String(board.settings.readersPerRun); void persist() }} />
                    </label>
                    <label class="setting">
                        <span>명단을 만들 때 인원</span>
                        <input class="field num" type="number" min="3" max="40" value={board.settings.rosterSize}
                            onchange={(event) => { if (!board) return; board.settings.rosterSize = clampInt(event.currentTarget.value, 3, 40, 12); event.currentTarget.value = String(board.settings.rosterSize); void persist() }} />
                    </label>
                    <label class="setting">
                        <span>작가 닉네임</span>
                        <input class="field" maxlength="40" value={board.settings.authorName}
                            onchange={(event) => { if (!board) return; board.settings.authorName = event.currentTarget.value.trim() || '작가'; event.currentTarget.value = board.settings.authorName; void persist() }} />
                    </label>
                </div>
                <label class="setting check">
                    <input type="checkbox" bind:checked={board.settings.allowNewcomers} onchange={() => void persist()} />
                    <span>화제가 되면 새 독자가 들어올 수 있음</span>
                </label>
                <div class="setting">
                    <span>모델 (모든 게시판 공통)</span>
                    <div class="segmented" role="radiogroup" aria-label="모델">
                        <button type="button" role="radio" aria-checked={index.model === 'model'} class:active={index.model === 'model'} disabled={running} onclick={() => void setModel('model')}>메인</button>
                        <button type="button" role="radio" aria-checked={index.model === 'otherAx'} class:active={index.model === 'otherAx'} disabled={running} onclick={() => void setModel('otherAx')}>보조</button>
                    </div>
                </div>
                <label class="setting check">
                    <input type="checkbox" bind:checked={board.settings.useWiki} onchange={() => void persist()} data-reader-board-use-wiki />
                    <span>바드위키 참고: 이미 연재한 턴까지의 사건 기록과 아크 플롯을 독자의 기억 보조로 넣기</span>
                </label>
                <div class="setting">
                    <span>보기 (모든 게시판 공통)</span>
                    <div class="setting-row">
                        <div class="segmented" role="radiogroup" aria-label="게시판 스타일">
                            {#each READER_BOARD_STYLES as item (item.id)}
                                <button type="button" role="radio" aria-checked={index.appearance.style === item.id} class:active={index.appearance.style === item.id} onclick={() => void setAppearance({ style: item.id })}>{item.label}</button>
                            {/each}
                        </div>
                        <div class="segmented" role="radiogroup" aria-label="글자 크기">
                            {#each [[0.9, '작게'], [1, '보통'], [1.15, '크게'], [1.3, '아주 크게']] as [value, label] (value)}
                                <button type="button" role="radio" aria-checked={index.appearance.scale === value} class:active={index.appearance.scale === value} onclick={() => void setAppearance({ scale: Number(value) })}>{label}</button>
                            {/each}
                        </div>
                    </div>
                </div>
                <div class="setting">
                    <span>시스템 프롬프트 (모든 게시판 공통)</span>
                    <label class="setting check">
                        <input type="checkbox" checked={index.systemPromptEnabled} disabled={running} onchange={(event) => void saveSystemPrompt(event.currentTarget.checked)} data-reader-board-system-toggle />
                        <span>요청 맨 앞에 넣기</span>
                    </label>
                    <textarea class="field area" rows="4" maxlength="40000" bind:value={systemPromptDraft} onchange={() => void saveSystemPrompt()} disabled={running}
                        placeholder="모델이 성인 내용이나 폭력 묘사를 거절할 때 쓰는 지시문 등. 켜 두면 독자 명단과 반응 요청마다 별도 시스템 메시지로 맨 앞에 붙습니다." data-reader-board-system-prompt></textarea>
                </div>
                <p class="hint">독자는 작가가 사용자라는 사실을 모르고, 연재된 본문과 게시판만 봅니다. 아첨을 줄이려면 냉정함을 높이고, 롤플레이와 다른 모델(보조)을 쓰는 것도 도움이 됩니다.</p>
                <div class="settings-actions">
                    <ShButton variant="outline" size="sm" onclick={() => board && void exportBoard(board, 'html')}><FileCodeIcon size={14} /> HTML로 저장</ShButton>
                </div>
            </section>
        {/if}
    </div>
</aside>

<style>
    .reader-board-dock {
        --rb-line: color-mix(in srgb, var(--risu-theme-primary) 22%, var(--risu-theme-darkborderc));
        --rb-surface: color-mix(in srgb, var(--risu-theme-darkbg) 91%, var(--color-bgcolor));
        --rb-field: color-mix(in srgb, var(--risu-theme-darkbg) 82%, var(--color-bgcolor));
        position: relative;
        z-index: 30;
        display: flex;
        flex: 0 0 auto;
        flex-direction: column;
        min-width: min(19rem, 100%);
        max-width: 75%;
        height: 100%;
        min-height: 0;
        overflow: hidden;
        border-left: 1px solid color-mix(in srgb, var(--risu-theme-primary) 28%, var(--risu-theme-darkborderc));
        color: var(--risu-theme-textcolor);
        background: var(--risu-theme-darkbg);
        box-shadow: var(--risu-shadow-overlay, -.8rem 0 2.4rem color-mix(in srgb, var(--color-shadow) 18%, transparent));
        animation: dock-enter .18s ease-out;
        container-type: inline-size;
    }
    .reader-board-dock.closed { display: none; }
    .reader-board-dock.collapsed { width: 2.75rem; min-width: 2.75rem; max-width: 2.75rem; }
    .reader-board-dock.collapsed > :not(.rail) { display: none; }
    .rail { display: none; }
    .collapsed .rail {
        display: flex;
        flex: 1 1 auto;
        flex-direction: column;
        align-items: center;
        gap: .75rem;
        width: 100%;
        padding: .7rem 0;
        border: 0;
        color: var(--risu-theme-textcolor2);
        background: var(--rb-surface);
        cursor: pointer;
    }
    .collapsed .rail:hover, .collapsed .rail:focus-visible { color: var(--risu-theme-primary); outline: 0; }
    .rail-title { color: var(--risu-theme-textcolor); font-size: .78rem; font-weight: 700; letter-spacing: .06em; writing-mode: vertical-rl; }
    @keyframes dock-enter { from { opacity: 0; transform: translateX(.75rem); } to { opacity: 1; transform: none; } }
    @media (prefers-reduced-motion: reduce) { .reader-board-dock { animation: none; } }
    .dock-resizer {
        position: absolute; z-index: 5; inset: 0 auto 0 -.3rem; width: .6rem; padding: 0; border: 0;
        background: transparent; cursor: col-resize; touch-action: none;
    }
    .dock-resizer::after {
        content: ''; position: absolute; inset: 0 auto 0 .27rem; width: 3px; background: transparent;
        transform: scaleX(.34); transition: transform .15s ease, background .15s ease;
    }
    .dock-resizer:hover::after, .dock-resizer:focus-visible::after { transform: none; background: var(--risu-theme-primary); }

    .dock-header {
        display: grid;
        gap: .5rem;
        padding: .45rem .6rem .6rem .7rem;
        border-bottom: 1px solid var(--risu-theme-darkborderc);
        background: var(--rb-surface);
    }
    .dock-titlebar { display: flex; align-items: center; gap: .55rem; min-width: 0; }
    .title-stack { display: grid; min-width: 0; gap: .1rem; }
    .title-stack strong { overflow: hidden; font-size: .84rem; font-weight: 700; letter-spacing: -.02em; text-overflow: ellipsis; white-space: nowrap; }
    .title-stack small { display: flex; flex-wrap: wrap; align-items: center; gap: .1rem .5rem; color: var(--risu-theme-textcolor2); font-size: .66rem; font-variant-numeric: tabular-nums; }
    .fork-tag { display: inline-flex; align-items: center; gap: .2rem; }
    .titlebar-spacer { flex: 1 1 auto; }
    .dock-mark {
        display: grid; flex: 0 0 auto; width: 1.8rem; height: 1.8rem; place-items: center;
        border: 1px solid color-mix(in srgb, var(--risu-theme-primary) 38%, var(--risu-theme-darkborderc));
        border-radius: calc(var(--risu-radius-lg) * 0.8); color: var(--risu-theme-primary);
        background: color-mix(in srgb, var(--risu-theme-primary) 9%, transparent);
    }
    .icon-button {
        display: grid; flex: 0 0 auto; width: 2rem; height: 2rem; place-items: center;
        border: 1px solid transparent; border-radius: calc(var(--risu-radius-sm) * 1.4); color: var(--risu-theme-textcolor2);
        background: transparent; cursor: pointer;
    }
    .icon-button.small { width: 1.7rem; height: 1.7rem; }
    .icon-button:hover:not(:disabled), .icon-button:focus-visible, .icon-button.active {
        border-color: var(--rb-line); color: var(--risu-theme-textcolor);
        background: color-mix(in srgb, var(--risu-theme-primary) 8%, transparent); outline: 0;
    }
    .icon-button.active { color: var(--risu-theme-primary); }
    .icon-button.danger:hover:not(:disabled), .icon-button.danger:focus-visible { color: var(--risu-theme-draculared); }

    .tabs { display: flex; gap: .15rem; margin: 0 -.1rem; overflow-x: auto; scrollbar-width: none; }
    .tabs button {
        display: inline-flex; flex: 0 0 auto; align-items: center; gap: .3rem; height: 1.9rem; padding: 0 .6rem;
        border: 0; border-radius: calc(var(--risu-radius-sm) * 1.4); color: var(--risu-theme-textcolor2); background: transparent;
        font-size: .74rem; font-weight: 600; cursor: pointer;
    }
    .tabs button:hover { color: var(--risu-theme-textcolor); }
    .tabs button.active { color: var(--risu-theme-primary); background: color-mix(in srgb, var(--risu-theme-primary) 12%, transparent); }
    .tabs button:focus-visible { outline: 2px solid var(--risu-theme-primary); outline-offset: -2px; }

    .banner {
        display: flex; flex-wrap: wrap; align-items: center; gap: .4rem .5rem; padding: .45rem .55rem;
        border: 1px solid var(--risu-theme-darkborderc); border-radius: calc(var(--risu-radius-lg) * 0.8);
        color: var(--risu-theme-textcolor); background: var(--rb-field); font-size: .72rem; line-height: 1.45;
    }
    .banner span { flex: 1 1 12rem; }
    .banner.warn {
        border-color: color-mix(in srgb, var(--risu-theme-draculared) 45%, var(--risu-theme-darkborderc));
        background: color-mix(in srgb, var(--risu-theme-draculared) 8%, var(--risu-theme-darkbg));
    }
    .publish-bar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: .45rem .6rem; }
    .range { display: flex; flex-wrap: wrap; align-items: center; gap: .3rem; font-size: .72rem; color: var(--risu-theme-textcolor2); }
    .range > span:first-child { font-weight: 600; }
    .publish-actions { display: flex; align-items: center; gap: .4rem; margin-left: auto; }
    .stage { display: inline-flex; align-items: center; gap: .35rem; color: var(--risu-theme-textcolor2); font-size: .72rem; }
    .notice { margin: 0; color: var(--risu-theme-textcolor2); font-size: .72rem; line-height: 1.45; }

    .field {
        min-width: 0; height: 2rem; box-sizing: border-box; padding: 0 .55rem;
        border: 1px solid var(--risu-theme-darkborderc); border-radius: calc(var(--risu-radius-sm) * 1.4);
        color: var(--risu-theme-textcolor); background: var(--rb-field); font-size: .78rem;
    }
    .field.num { width: 4rem; font-variant-numeric: tabular-nums; }
    .field.area { height: auto; padding: .45rem .55rem; line-height: 1.5; resize: vertical; }
    .field[type='range'] { padding: 0; accent-color: var(--risu-theme-primary); }
    .field:focus-visible { border-color: var(--risu-theme-primary); outline: 0; box-shadow: 0 0 0 2px color-mix(in srgb, var(--risu-theme-primary) 22%, transparent); }
    .field:disabled { opacity: .55; }
    .field::placeholder { color: color-mix(in srgb, var(--risu-theme-textcolor2) 80%, transparent); }

    .body { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: .7rem .7rem 1.2rem; scrollbar-width: thin; scrollbar-color: var(--risu-theme-darkborderc) transparent; }
    .state { display: flex; align-items: center; gap: .5rem; color: var(--risu-theme-textcolor2); font-size: .8rem; }
    .state.failure { flex-direction: column; align-items: flex-start; }
    .empty { margin: .6rem 0; color: var(--risu-theme-textcolor2); font-size: .78rem; line-height: 1.6; }
    .hint { margin: .7rem 0 0; color: var(--risu-theme-textcolor2); font-size: .68rem; line-height: 1.55; }
    .muted { color: var(--risu-theme-textcolor2); }
    .small { margin: 0; font-size: .72rem; line-height: 1.5; }
    .tabular { font-variant-numeric: tabular-nums; }
    .link-button {
        display: inline-flex; align-items: center; gap: .2rem; padding: 0; border: 0;
        color: var(--risu-theme-textcolor2); background: transparent; font-size: .68rem; cursor: pointer;
    }
    .link-button:hover, .link-button:focus-visible { color: var(--risu-theme-primary); outline: 0; }
    .link-button.danger:hover { color: var(--risu-theme-draculared); }
    .tag {
        display: inline-flex; flex: 0 0 auto; align-items: center; gap: .2rem; padding: .05rem .4rem;
        border-radius: 999px; color: var(--risu-theme-primary);
        background: color-mix(in srgb, var(--risu-theme-primary) 13%, transparent); font-size: .62rem; font-weight: 700;
    }
    .tag.subtle { color: var(--risu-theme-textcolor2); background: color-mix(in srgb, var(--risu-theme-textcolor2) 12%, transparent); }
    .tag.warn { color: var(--risu-theme-draculared); background: color-mix(in srgb, var(--risu-theme-draculared) 13%, transparent); }

    .setting { display: grid; gap: .22rem; min-width: 0; }
    .setting > span:first-child { color: var(--risu-theme-textcolor2); font-size: .68rem; font-weight: 600; }
    .setting .field { width: 100%; }
    .setting .field.num { width: 4.5rem; }
    .setting.check { display: flex; align-items: center; gap: .45rem; cursor: pointer; }
    .setting.check input { width: 1rem; height: 1rem; margin: 0; accent-color: var(--risu-theme-primary); }
    .setting.check span { color: var(--risu-theme-textcolor); font-size: .74rem; font-weight: 500; }
    .setting-row { display: flex; flex-wrap: wrap; align-items: end; gap: .55rem .8rem; }
    .setting-row .setting { flex: 1 1 7rem; }
    .form-actions { display: flex; justify-content: flex-end; gap: .4rem; }
    .chips { display: flex; flex-wrap: wrap; gap: .3rem; }
    .chip {
        height: 1.65rem; padding: 0 .6rem; border: 1px solid var(--risu-theme-darkborderc); border-radius: 999px;
        color: var(--risu-theme-textcolor2); background: transparent; font-size: .7rem; cursor: pointer;
    }
    .chip:hover, .chip:focus-visible { border-color: var(--risu-theme-primary); color: var(--risu-theme-primary); outline: 0; }
    .chip { display: inline-flex; align-items: center; gap: .25rem; }
    .chip.mine { border-color: var(--rb-line); color: var(--risu-theme-textcolor); }
    .chip.add { border-style: dashed; }
    .chip-group { display: inline-flex; align-items: center; }
    .chip-group .chip { border-top-right-radius: 0; border-bottom-right-radius: 0; }
    .chip-remove {
        display: grid; height: 1.65rem; padding: 0 .35rem; place-items: center; border: 1px solid var(--rb-line); border-left: 0;
        border-radius: 0 999px 999px 0; color: var(--risu-theme-textcolor2); background: transparent; cursor: pointer;
    }
    .chip-remove:hover, .chip-remove:focus-visible { color: var(--risu-theme-draculared); outline: 0; }
    .hint.flush { margin-top: -.4rem; }
    .segmented {
        display: inline-flex; justify-self: start; max-width: 100%; min-height: 2rem; box-sizing: border-box; padding: .15rem;
        border: 1px solid var(--risu-theme-darkborderc); border-radius: calc(var(--risu-radius-lg) * 0.8); background: var(--rb-field);
    }
    .segmented.wide { display: flex; flex-wrap: wrap; justify-self: stretch; }
    .segmented button {
        flex: 1 0 auto; padding: .3rem .6rem; border: 0; border-radius: calc(var(--risu-radius-sm) * 1.12); color: var(--risu-theme-textcolor2);
        background: transparent; font-size: .72rem; font-weight: 600; cursor: pointer;
    }
    .segmented button.active { color: var(--risu-theme-primary); background: color-mix(in srgb, var(--risu-theme-primary) 14%, transparent); }
    .segmented button:focus-visible { outline: 2px solid var(--risu-theme-primary); outline-offset: -2px; }
    .segmented button:disabled { cursor: not-allowed; opacity: .55; }

    .start, .settings, .manage, .readers { display: grid; gap: .75rem; }
    .start h3, .match h3 { margin: 0; font-size: .86rem; font-weight: 700; letter-spacing: -.01em; }
    .create, .match { display: grid; gap: .55rem; }
    .match { padding: .7rem; border: 1px solid var(--rb-line); border-radius: var(--risu-radius-lg); background: color-mix(in srgb, var(--risu-theme-primary) 5%, var(--risu-theme-darkbg)); }
    .match-row { display: grid; gap: .3rem; padding-top: .45rem; border-top: 1px solid var(--risu-theme-darkborderc); }
    .match-row strong { font-size: .8rem; }

    .feed { display: grid; gap: .55rem; }
    .compose .compose-open {
        display: flex; align-items: center; gap: .4rem; width: 100%; height: 2.3rem; padding: 0 .7rem;
        border: 1px dashed var(--risu-theme-darkborderc); border-radius: calc(var(--risu-radius-lg) * 0.9);
        color: var(--risu-theme-textcolor2); background: transparent; font-size: .76rem; cursor: pointer;
    }
    .compose .compose-open:hover, .compose .compose-open:focus-visible { border-color: var(--risu-theme-primary); color: var(--risu-theme-primary); outline: 0; }
    .compose-target { display: flex; align-items: center; gap: .3rem; margin: 0; color: var(--risu-theme-primary); font-size: .72rem; font-weight: 600; }

    /* Feed text scales with the viewer's size setting. */
    .feed { font-size: calc(var(--rb-scale, 1) * 1rem); }
    .feed-head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: .3rem .6rem; }
    .feed-head p { margin: 0; }
    .feed-head :global(.turned) { transform: rotate(180deg); }

    .post { padding: .75em .85em .7em; border: 1px solid var(--risu-theme-darkborderc); border-radius: var(--risu-radius-lg); background: var(--rb-surface); }
    .post.kind-episode { border-color: var(--rb-line); }
    .post.kind-author { border-color: color-mix(in srgb, var(--risu-theme-primary) 45%, var(--risu-theme-darkborderc)); background: color-mix(in srgb, var(--risu-theme-primary) 6%, var(--rb-surface)); }
    .post.kind-event { padding: .5em .85em; border-style: dashed; background: transparent; }
    .post.kind-event h3 { font-size: .8em; font-weight: 600; color: var(--risu-theme-textcolor2); }
    .post header { display: flex; flex-wrap: wrap; align-items: center; gap: .25em .45em; }
    .fold {
        display: grid; flex: 0 0 auto; width: 1.6em; height: 1.6em; margin-left: -.3em; place-items: center; padding: 0;
        border: 0; border-radius: calc(var(--risu-radius-sm) * 1.2); color: var(--risu-theme-textcolor2); background: transparent; cursor: pointer;
        transition: transform .18s cubic-bezier(.2, .8, .2, 1), color .15s ease;
    }
    .fold:hover, .fold:focus-visible { color: var(--risu-theme-primary); outline: 0; background: color-mix(in srgb, var(--risu-theme-primary) 10%, transparent); }
    .post.folded .fold { transform: rotate(-90deg); }
    @media (prefers-reduced-motion: reduce) { .fold { transition: none; } }
    .ep-no {
        flex: 0 0 auto; padding: .1em .5em; border-radius: calc(var(--risu-radius-sm) * 1.2); color: var(--risu-theme-primary);
        background: color-mix(in srgb, var(--risu-theme-primary) 14%, transparent); font-size: .74em; font-weight: 800; letter-spacing: -.01em;
    }
    .post h3 { flex: 1 1 8em; min-width: 0; margin: 0; font-size: .95em; font-weight: 750; line-height: 1.35; letter-spacing: -.015em; overflow-wrap: anywhere; text-wrap: balance; }
    .post.retracted h3 { color: var(--risu-theme-textcolor2); text-decoration: line-through; text-decoration-color: color-mix(in srgb, var(--risu-theme-draculared) 70%, transparent); }
    .post.retracted .ep-no { color: var(--risu-theme-textcolor2); background: color-mix(in srgb, var(--risu-theme-textcolor2) 12%, transparent); }
    .meta { display: flex; flex-wrap: wrap; align-items: center; gap: .1rem .45rem; margin: .15rem 0 0; color: var(--risu-theme-textcolor2); font-size: .66rem; }
    .feed .meta { font-size: .7em; }
    .meta b { color: var(--risu-theme-textcolor); font-weight: 700; }
    .meta b.author-name { color: var(--risu-theme-primary); }
    .post-meta { padding-left: 1.3em; }
    .post-no { opacity: .7; }
    .post-body { margin: .6em 0 0; color: var(--risu-theme-textcolor); font-size: .8em; line-height: 1.7; white-space: pre-wrap; overflow-wrap: anywhere; }
    /* The episode summary reads as the post's lead, set apart from the talk. */
    .post.kind-episode .post-body { padding: .6em .75em; border-radius: calc(var(--risu-radius-lg) * 0.8); background: var(--rb-field); color: color-mix(in srgb, var(--risu-theme-textcolor) 88%, var(--risu-theme-textcolor2)); }
    .comments-head { margin: .85em 0 .1em; color: var(--risu-theme-textcolor2); font-size: .68em; font-weight: 700; letter-spacing: .02em; }
    .comments { display: grid; margin: 0; padding: 0; list-style: none; }
    .comments li { padding: .55em 0 .45em; border-top: 1px solid color-mix(in srgb, var(--risu-theme-darkborderc) 70%, transparent); }
    .comments li.reply { margin-left: 1em; padding-left: .75em; border-top-color: transparent; border-left: 1px solid var(--rb-line); }
    .comments li.by-author { background: color-mix(in srgb, var(--risu-theme-primary) 6%, transparent); }
    .comments li.by-author .meta b { color: var(--risu-theme-primary); }
    .comments .meta b { font-size: 1.05em; }
    .reply-to { display: inline-flex; align-items: center; gap: .15rem; }
    .comment-text { margin: .2em 0 .25em; font-size: .8em; line-height: 1.6; white-space: pre-wrap; overflow-wrap: anywhere; }
    .feed .link-button { font-size: .7em; }

    /* Forum: a dense community board, rules instead of boxes. */
    .look-forum .feed { gap: 0; }
    .look-forum .post { padding: .7em .1em; border: 0; border-bottom: 1px solid var(--risu-theme-darkborderc); border-radius: 0; background: transparent; }
    .look-forum .post.kind-author { background: color-mix(in srgb, var(--risu-theme-primary) 5%, transparent); }
    .look-forum .post.kind-episode .post-body { padding: 0; background: transparent; color: var(--risu-theme-textcolor2); }
    .look-forum .comments li { padding: .3em 0; border-top: 0; }
    .look-forum .comments li > .meta { display: inline-flex; margin: 0 .5em 0 0; }
    .look-forum .comment-text { display: inline; }
    .look-forum .comment-actions { display: none; }
    .look-forum .comments li:hover .comment-actions, .look-forum .comments li:focus-within .comment-actions { display: inline-flex; margin-left: .5em; }
    .look-forum .comments li.reply { margin-left: .8em; padding-left: .6em; }

    /* Reading: open and quiet, for long sessions of comments. */
    .look-reading .feed { gap: 1.4em; }
    .look-reading .post { padding: .2em 0 1.2em; border: 0; border-bottom: 1px solid var(--risu-theme-darkborderc); border-radius: 0; background: transparent; }
    .look-reading .post h3 { font-size: 1.05em; }
    .look-reading .post-body, .look-reading .comment-text { font-size: .86em; line-height: 1.8; }
    .look-reading .post.kind-episode .post-body { padding: .8em 1em; }
    .look-reading .comments li { padding: .8em 0 .6em; }

    .post-actions { display: flex; flex-wrap: wrap; gap: .3rem .7rem; margin-top: .35rem; }
    .comment-actions { display: flex; gap: .7rem; }
    .comments li.banned .comment-text { color: var(--risu-theme-textcolor2); opacity: .7; }
    .link-button.accent { color: var(--risu-theme-primary); font-weight: 600; }
    .link-button:disabled { cursor: not-allowed; opacity: .5; }
    .inline-compose { margin: .45rem 0 .2rem; }
    .compose-form { display: grid; gap: .45rem; padding: .6rem; border: 1px solid var(--rb-line); border-radius: calc(var(--risu-radius-lg) * 0.9); background: var(--rb-surface); }
    .compose-form .hint { margin: 0; }
    .pager { display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: .25rem; padding-top: .3rem; }
    .page-number {
        min-width: 1.8rem; height: 1.8rem; padding: 0 .35rem; border: 1px solid transparent; border-radius: calc(var(--risu-radius-sm) * 1.4);
        color: var(--risu-theme-textcolor2); background: transparent; font-size: .74rem; cursor: pointer;
    }
    .page-number:hover, .page-number:focus-visible { border-color: var(--rb-line); color: var(--risu-theme-textcolor); outline: 0; }
    .page-number.active { color: var(--risu-theme-primary); background: color-mix(in srgb, var(--risu-theme-primary) 12%, transparent); font-weight: 700; }
    .icon-button:disabled { cursor: not-allowed; opacity: .4; }

    .reader { display: grid; gap: .3rem; padding: .6rem .7rem; border: 1px solid var(--risu-theme-darkborderc); border-radius: var(--risu-radius-lg); background: var(--rb-surface); font-size: .74rem; line-height: 1.55; }
    .reader.left { opacity: .62; }
    .reader header { display: flex; align-items: center; gap: .4rem; }
    .reader h3 { margin: 0; font-size: .82rem; font-weight: 700; }
    .reader p { margin: 0; }
    .reader dl { display: grid; grid-template-columns: auto 1fr; gap: .15rem .6rem; margin: 0; }
    .reader dt { color: var(--risu-theme-textcolor2); font-size: .68rem; font-weight: 600; }
    .reader dd { margin: 0; overflow-wrap: anywhere; }
    .theories { display: grid; gap: .2rem; margin: .1rem 0 0; padding: 0; list-style: none; }
    .theories li { display: flex; align-items: baseline; gap: .35rem; }
    .theory-refuted { color: var(--risu-theme-textcolor2); text-decoration: line-through; }
    .reader-form { display: grid; gap: .45rem; }

    .metrics table { width: 100%; border-collapse: collapse; font-size: .72rem; }
    .metrics th, .metrics td { padding: .4rem .3rem; border-bottom: 1px solid var(--risu-theme-darkborderc); text-align: left; vertical-align: middle; }
    .metrics thead th { color: var(--risu-theme-textcolor2); font-size: .66rem; font-weight: 600; }
    .metrics tbody th { font-weight: 700; white-space: nowrap; }
    .metrics tr.retracted th { color: var(--risu-theme-textcolor2); text-decoration: line-through; }
    .cell { display: grid; gap: .2rem; min-width: 2.6rem; }
    .meter { display: block; height: 3px; border-radius: var(--risu-radius-xs); background: color-mix(in srgb, var(--risu-theme-textcolor2) 18%, transparent); overflow: hidden; }
    .meter span { display: block; height: 100%; border-radius: inherit; background: var(--risu-theme-primary); }
    .delta { margin-left: .25rem; font-size: .64rem; font-weight: 700; }
    .compare { display: grid; gap: .4rem; margin-bottom: 1rem; padding: .6rem .7rem; border: 1px solid var(--rb-line); border-radius: var(--risu-radius-lg); background: color-mix(in srgb, var(--risu-theme-primary) 5%, var(--risu-theme-darkbg)); }
    .compare h3 { margin: 0; font-size: .8rem; font-weight: 700; }
    .compare .hint { margin: 0; }
    .compare tbody th { white-space: normal; overflow-wrap: anywhere; }
    .metrics tr.current-row th, .metrics tr.current-row td { color: var(--risu-theme-primary); }
    .metrics tr.work-row th { padding-top: .8rem; color: var(--risu-theme-textcolor2); font-size: .68rem; font-weight: 700; }
    .work-tag { color: var(--risu-theme-primary); font-weight: 700; }
    .new-work { display: grid; gap: .65rem; }
    .new-work h3 { margin: 0; font-size: .86rem; font-weight: 700; overflow-wrap: anywhere; }
    .new-work .setting .hint { margin: .2rem 0 0; }
    .delta.down { color: var(--risu-theme-draculared); }
    .delta.up { color: var(--risu-theme-primary); }

    .manage-head { display: flex; flex-wrap: wrap; align-items: center; gap: .4rem; }
    .board-list { display: grid; gap: .5rem; margin: 0; padding: 0; list-style: none; }
    .board-list li { display: grid; gap: .2rem; padding: .6rem .7rem; border: 1px solid var(--risu-theme-darkborderc); border-radius: var(--risu-radius-lg); background: var(--rb-surface); }
    .board-list li.current { border-color: var(--rb-line); }
    .board-row { display: flex; flex-wrap: wrap; align-items: center; gap: .35rem; }
    .board-name { padding: 0; border: 0; color: var(--risu-theme-textcolor); background: transparent; font-size: .82rem; font-weight: 700; text-align: left; cursor: pointer; overflow-wrap: anywhere; }
    .board-name:hover, .board-name:focus-visible { color: var(--risu-theme-primary); outline: 0; }
    .board-meta { margin: 0; color: var(--risu-theme-textcolor2); font-size: .68rem; line-height: 1.5; }
    .orphan { color: var(--risu-theme-draculared); }
    .board-actions { display: flex; flex-wrap: wrap; gap: .2rem; margin-top: .25rem; }
    .settings-actions { display: flex; justify-content: flex-end; }

    @container (max-width: 22rem) {
        .publish-actions { margin-left: 0; width: 100%; justify-content: flex-end; }
        .tabs button { padding: 0 .45rem; }
    }
</style>
