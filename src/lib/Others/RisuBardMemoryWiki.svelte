<script lang="ts">
    import { onMount } from 'svelte'
    import {
        BookOpenIcon,
        CheckCircle2Icon,
        Clock3Icon,
        LoaderCircleIcon,
        LogsIcon,
        PanelRightCloseIcon,
        NetworkIcon,
        RefreshCwIcon,
        ChevronDownIcon,
        SquareTerminalIcon,
        MonitorIcon,
        SmartphoneIcon,
        XCircleIcon,
    } from '@lucide/svelte'
    import ShButton from 'src/lib/UI/GUI/ShButton.svelte'
    import ShDialog from 'src/lib/UI/GUI/ShDialog.svelte'
    import { language } from 'src/lang'
    import { forageStorage } from 'src/ts/globalApi.svelte'
    import {
        normalizeMemoryWikiDockRatio,
        normalizeMemoryWikiWorkspaceHeight,
    } from 'src/ts/risubard/memoryWikiLayout'
    import {
        getBardChatUndoStatus,
        loadNarrativeMemoryWiki,
        restoreBardChatUndo,
        type NarrativeMemoryWiki,
    } from 'src/ts/risubard/memoryWiki'
    import {
        RISUBARD_MEMORY_UPDATED_EVENT,
        type RisuBardMemoryUpdatedDetail,
    } from 'src/ts/risubard/memoryEvents'
    import { DBState } from 'src/ts/stores.svelte'
    import { saveChatToServer } from 'src/ts/storage/chatStorage'
    import {
        applyChatFindReplace,
        replaceWikiText,
    } from 'src/ts/risubard/findReplace'
    import RisuBardNarrativeGraph from './RisuBardNarrativeGraph.svelte'
    import RisuBardWriterWorkbench from './RisuBardWriterWorkbench.svelte'
    import RisuBardWikiEditor from './RisuBardWikiEditor.svelte'
    import RisuBardMemoryActivity from './RisuBardMemoryActivity.svelte'
    import RisuBardStorySoFar from './RisuBardStorySoFar.svelte'
    import RisuBardStoryArcPlot from './RisuBardStoryArcPlot.svelte'
    import RisuBardWikiCommandTerminal from './RisuBardWikiCommandTerminal.svelte'
    import RisuBardFindReplace from './RisuBardFindReplace.svelte'
    import RisuBardMemoryWikiHelp from './RisuBardMemoryWikiHelp.svelte'
    import RisuBardCurrentChatSettings from './RisuBardCurrentChatSettings.svelte'
    import ManagerResizeHandles from 'src/lib/UI/GUI/ManagerResizeHandles.svelte'
    import SolarBoldIcon from 'src/lib/UI/Icons/SolarBoldIcon.svelte'
    import forceUpdateIdle from 'src/assets/risubard-memory/additional-analysis-idle.png'
    import forceUpdateHover from 'src/assets/risubard-memory/additional-analysis-hover.gif'
    import type {
        DirectWikiCommandResult,
        DirectWikiContextSelection,
    } from 'src/ts/risubard/directWikiCommand'
    import type { StorySourceRef } from 'src/ts/risubard/storySoFar'
    import { alertConfirm, alertError } from 'src/ts/alert'
    import {
        resolveWikiRebootViewChatId,
        type WikiRebootBatchSize,
        type WikiRebootJob,
    } from 'src/ts/risubard/wikiReboot'
    import {
        resolveRisuBardChatSettings,
    } from 'src/ts/risubard/risuBardSettings'
    import { normalizeArcPlotterRuntimeSettings } from 'src/ts/risubard/arcPlotterSettings'

    interface Props {
        open?: boolean
        characterId: string
        chatId: string
        onForceWikiUpdate?: () => Promise<boolean>
        rebootJob?: WikiRebootJob
        onStartWikiReboot?: (
            batchSize: WikiRebootBatchSize,
            startChatIndex: number
        ) => Promise<boolean>
        onStopWikiReboot?: () => Promise<boolean>
        onResumeWikiReboot?: () => Promise<boolean>
        onCancelWikiReboot?: () => Promise<boolean>
        onExecuteWikiCommand?: (
            instruction: string,
            contextSelection: DirectWikiContextSelection
        ) => Promise<DirectWikiCommandResult>
        onNavigateStorySource?: (source: StorySourceRef) => void
    }

    type MemoryWikiLayout = 'desktop' | 'mobile'

    let {
        open = $bindable(false),
        characterId,
        chatId,
        onForceWikiUpdate,
        rebootJob,
        onStartWikiReboot,
        onStopWikiReboot,
        onResumeWikiReboot,
        onCancelWikiReboot,
        onExecuteWikiCommand,
        onNavigateStorySource,
    }: Props = $props()
    let wiki = $state<NarrativeMemoryWiki | null>(null)
    let loading = $state(false)
    let error = $state('')
    let forceUpdating = $state(false)
    let forceUpdateStatus = $state<'success' | 'empty' | 'failed' | ''>('')
    let forceUpdateError = $state('')
    let forceUpdateMeta = $state<{ turn: number; completedAt: number } | null>(
        null
    )
    let requestSequence = 0
    let loadAbortController: AbortController | undefined
    let loadedScope = ''
    let dockElement = $state<HTMLElement | null>(null)
    let workspaceSplitElement = $state<HTMLElement | null>(null)
    let activeView = $state<'workspace' | 'story' | 'arc-plot' | 'log'>('workspace')
    let findReplaceOpen = $state(false)
    let settingsOpen = $state(false)
    let settingsPopoverElement = $state<HTMLElement | null>(null)
    let layoutMode = $state<MemoryWikiLayout>('desktop')
    let layoutManuallySelected = false
    let dockRatio = $state(normalizeMemoryWikiDockRatio(
        DBState.db.risuBardMemoryDockRatio
    ))
    let workspaceHeight = $state(normalizeMemoryWikiWorkspaceHeight(
        DBState.db.risuBardMemoryWorkspaceHeight
    ))
    let commandExpanded = $state(false)
    let editorFocus = $state(false)
    let helpOpen = $state(false)
    let selectedMarkdownId = $state('')
    let bardChatUpdatedIds = $state<string[] | null>(null)
    let bardChatUndoAvailable = $state(false)
    let rebootChooserOpen = $state(false)
    let rebootActionBusy = $state(false)
    let rebootStartChatIndex = $state(0)
    let wikiChatId = $derived(resolveWikiRebootViewChatId(chatId, rebootJob))

    let v1State = $derived(wiki?.mode === 'v1' ? wiki.state : null)
    let activeFacts = $derived(
        v1State?.facts.filter((fact) => fact.status === 'active') ?? []
    )
    let invalidatedFacts = $derived(
        v1State?.facts.filter((fact) => fact.status === 'invalidated') ?? []
    )
    let recentEvents = $derived(v1State ? [...v1State.events].reverse() : [])
    let markdownDocuments = $derived(
        wiki?.mode === 'markdown' ? wiki.documents : []
    )
    let selectedMarkdownDocument = $derived(markdownDocuments.find(
        (document) => document.id === selectedMarkdownId
    ) ?? null)
    let activityMessages = $derived(
        DBState.db.characters?.find((character) =>
            character.chaId === characterId
        )?.chats.find((chat) => chat.id === chatId)?.message ?? []
    )
    let currentChat = $derived(
        DBState.db.characters?.find((character) =>
            character.chaId === characterId
        )?.chats.find((chat) => chat.id === chatId)
    )
    let resolvedChatSettings = $derived(resolveRisuBardChatSettings(
        DBState.db,
        currentChat?.risuBardSettings
    ))
    let arcPlotterSettings = $derived(normalizeArcPlotterRuntimeSettings({
        enabled: DBState.db.risuBardArcPlotterEnabled,
        checkpointSize: DBState.db.risuBardArcPlotterCheckpointSize,
        maxArcs: DBState.db.risuBardArcPlotterMaxArcs,
        maxTurningPoints: DBState.db.risuBardArcPlotterMaxTurningPoints,
        maxOpenThreads: DBState.db.risuBardArcPlotterMaxOpenThreads,
        maxCharacters: DBState.db.risuBardArcPlotterMaxCharacters,
    }))
    let bardChatContextSelection = $derived<DirectWikiContextSelection>({
        wiki: resolvedChatSettings.bardChatIncludeWiki,
        chat: resolvedChatSettings.bardChatIncludeChat,
        systemPrompt: resolvedChatSettings.bardChatIncludeSystemPrompt,
        characterDescription:
            resolvedChatSettings.bardChatIncludeCharacterDescription,
        persona: resolvedChatSettings.bardChatIncludePersona,
        characterLorebook:
            resolvedChatSettings.bardChatIncludeCharacterLorebook,
        moduleLorebook: resolvedChatSettings.bardChatIncludeModuleLorebook,
    })
    let rebootLastChatIndex = $derived((currentChat?.message.length ?? 0) - 1)
    let rebootStartChatIndexValid = $derived(
        Number.isInteger(rebootStartChatIndex)
        && rebootStartChatIndex >= 0
        && rebootStartChatIndex <= rebootLastChatIndex
    )
    let rebootAnalysisTokenLimit = $derived(
        resolveRisuBardChatSettings(
            DBState.db,
            currentChat?.risuBardSettings
        ).risuBardAnalysisTokenLimit
    )
    let empty = $derived(
        wiki?.mode === 'v1'
        && !wiki.baseline
        && activeFacts.length === 0
        && invalidatedFacts.length === 0
        && recentEvents.length === 0
    )
    let rebootButtonLabel = $derived.by(() => {
        if (!rebootJob) return language.risuBardWikiReboot
        if (rebootJob.status === 'paused' || rebootJob.status === 'failed') {
            return language.risuBardWikiRebootResume
        }
        if (rebootJob.status === 'stop-requested') {
            return language.risuBardWikiRebootStopping
        }
        if (rebootJob.status === 'finalizing') {
            return language.risuBardWikiRebootFinalizing
        }
        return language.risuBardWikiRebootStop
    })
    let rebootProgress = $derived.by(() => {
        if (!rebootJob) return undefined
        const total = rebootJob.targetAssistantMessageIds.length
        const completed = Math.min(
            rebootJob.completedAssistantMessageIds.length,
            total
        )
        const percent = total > 0
            ? Math.round((completed / total) * 100)
            : 0
        return { completed, total, percent }
    })

    onMount(() => {
        const media = window.matchMedia?.('(max-width: 840px)')
        const syncLayout = () => {
            if (layoutManuallySelected) return
            layoutMode = (media?.matches ?? window.innerWidth <= 840)
                ? 'mobile'
                : 'desktop'
        }
        syncLayout()
        media?.addEventListener('change', syncLayout)
        return () => media?.removeEventListener('change', syncLayout)
    })

    function toggleLayout() {
        layoutManuallySelected = true
        layoutMode = layoutMode === 'mobile' ? 'desktop' : 'mobile'
    }

    async function handleRebootAction() {
        if (rebootActionBusy) return
        if (!rebootJob) {
            if (!await alertConfirm(language.risuBardWikiRebootWarning, { tier: 'top' })) return
            rebootChooserOpen = true
            return
        }
        rebootActionBusy = true
        try {
            if (rebootJob.status === 'running') {
                await onStopWikiReboot?.()
            }
            else if (rebootJob.status === 'paused'
                || rebootJob.status === 'failed') {
                const operation = onResumeWikiReboot?.()
                rebootActionBusy = false
                void operation?.catch((cause) => alertError(cause))
            }
        }
        catch (cause) {
            alertError(cause)
        }
        finally {
            rebootActionBusy = false
        }
    }

    function startReboot(batchSize: WikiRebootBatchSize) {
        if (!rebootStartChatIndexValid) return
        rebootChooserOpen = false
        rebootActionBusy = true
        const operation = onStartWikiReboot?.(batchSize, rebootStartChatIndex)
        rebootActionBusy = false
        void operation?.catch((cause) => {
            alertError(cause)
        })
    }

    async function cancelReboot() {
        if (!await alertConfirm(language.risuBardWikiRebootCancelWarning, { tier: 'top' })) return
        rebootActionBusy = true
        try {
            await onCancelWikiReboot?.()
        }
        catch (cause) {
            alertError(cause)
        }
        finally {
            rebootActionBusy = false
        }
    }

    async function loadWiki() {
        loadAbortController?.abort()
        const controller = new AbortController()
        loadAbortController = controller
        const sequence = ++requestSequence
        const scope = `${characterId}\u0000${wikiChatId}`
        const refreshingCurrentScope = loadedScope === scope
        if (!refreshingCurrentScope) {
            wiki = null
            selectedMarkdownId = ''
        }
        loading = true
        error = ''
        try {
            const loaded = await loadNarrativeMemoryWiki({
                characterId,
                chatId: wikiChatId,
                fetchImpl: fetch,
                createAuth: () => forageStorage.createAuth(),
                signal: controller.signal,
            })
            if (sequence === requestSequence) {
                wiki = loaded
                loadedScope = scope
            }
            if (sequence === requestSequence && loaded.mode === 'markdown'
                && !loaded.documents.some((document) =>
                    document.id === selectedMarkdownId
                )) {
                selectedMarkdownId = loaded.documents[0]?.id ?? ''
            }
        }
        catch (cause) {
            if (sequence === requestSequence) {
                wiki = null
                error = cause instanceof Error
                    ? cause.message
                    : String(cause)
            }
        }
        finally {
            if (loadAbortController === controller) {
                loadAbortController = undefined
            }
            if (sequence === requestSequence) loading = false
        }
    }

    function cancelWikiLoad() {
        requestSequence += 1
        loadAbortController?.abort()
        loadAbortController = undefined
        loading = false
    }

    async function forceWikiUpdate() {
        if (forceUpdating || rebootJob) return
        const targetTurn = currentChat?.message.filter((message) =>
            message.role === 'char'
            && !message.isComment
            && !message.disabled
            && typeof message.chatId === 'string'
            && message.chatId.trim().length > 0
        ).length ?? 0
        forceUpdating = true
        forceUpdateStatus = ''
        forceUpdateError = ''
        forceUpdateMeta = null
        try {
            const updated = await onForceWikiUpdate?.()
            forceUpdateStatus = updated ? 'success' : 'empty'
            if (updated && targetTurn > 0) {
                forceUpdateMeta = {
                    turn: targetTurn,
                    completedAt: Date.now(),
                }
            }
        }
        catch (cause) {
            forceUpdateStatus = 'failed'
            forceUpdateError = (cause instanceof Error
                ? cause.message
                : String(cause)).trim().slice(0, 512)
        }
        finally {
            forceUpdating = false
        }
    }

    function selectMarkdownPath(path: string) {
        const document = markdownDocuments.find((item) =>
            item.relativePath === path
        )
        if (document) selectedMarkdownId = document.id
    }

    function editStoryEntry(documentId: string) {
        selectedMarkdownId = documentId
        activeView = 'workspace'
    }

    async function executeWikiCommand(
        instruction: string,
        contextSelection: DirectWikiContextSelection
    ): Promise<DirectWikiCommandResult> {
        if (!onExecuteWikiCommand) {
            throw new Error('현재 채팅에서 위키 관리자 명령을 실행할 수 없습니다.')
        }
        const result = await onExecuteWikiCommand(
            instruction,
            contextSelection
        )
        bardChatUpdatedIds = result.applied.map((item) => item.documentId)
        await loadWiki()
        await refreshBardChatUndoStatus()
        return result
    }

    async function refreshBardChatUndoStatus() {
        const scope = `${characterId}\u0000${wikiChatId}`
        try {
            const status = await getBardChatUndoStatus({
                characterId,
                chatId: wikiChatId,
                fetchImpl: fetch,
                createAuth: () => forageStorage.createAuth(),
            })
            if (scope === `${characterId}\u0000${wikiChatId}`) {
                bardChatUndoAvailable = status.available
            }
        }
        catch {
            if (scope === `${characterId}\u0000${wikiChatId}`) {
                bardChatUndoAvailable = false
            }
        }
    }

    async function restoreLastBardChatChange() {
        await restoreBardChatUndo({
            characterId,
            chatId: wikiChatId,
            fetchImpl: fetch,
            createAuth: () => forageStorage.createAuth(),
        })
        bardChatUndoAvailable = false
        bardChatUpdatedIds = []
        await loadWiki()
    }

    function setBardChatContextSelection(
        selection: DirectWikiContextSelection
    ) {
        if (!currentChat) return
        currentChat.risuBardSettings ??= {}
        Object.assign(currentChat.risuBardSettings, {
            bardChatIncludeWiki: selection.wiki,
            bardChatIncludeChat: selection.chat,
            bardChatIncludeSystemPrompt: selection.systemPrompt,
            bardChatIncludeCharacterDescription:
                selection.characterDescription,
            bardChatIncludePersona: selection.persona,
            bardChatIncludeCharacterLorebook: selection.characterLorebook,
            bardChatIncludeModuleLorebook: selection.moduleLorebook,
        })
    }

    async function replaceText(input: {
        find: string
        replacement: string
        wiki: boolean
        chat: boolean
    }) {
        let wikiResult = { matches: 0, documents: 0 }
        let chatResult = { matches: 0, messages: 0 }
        const chatTarget = (() => {
            if (!input.chat) return null
            const character = DBState.db.characters?.find((item) =>
                item.chaId === characterId
            )
            const chatIndex = character?.chats.findIndex((item) =>
                item.id === chatId
            ) ?? -1
            const currentChat = chatIndex >= 0
                ? character?.chats[chatIndex]
                : undefined
            if (!character || !currentChat) {
                throw new Error('현재 챗 내역을 찾을 수 없습니다.')
            }
            if (currentChat.isStreaming) {
                throw new Error('답변 생성이 끝난 뒤 챗 내역을 바꿔 주세요.')
            }
            return { character, chatIndex, currentChat }
        })()
        if (input.wiki) {
            wikiResult = await replaceWikiText({
                characterId,
                chatId: wikiChatId,
                find: input.find,
                replacement: input.replacement,
                fetchImpl: fetch,
                createAuth: () => forageStorage.createAuth(),
            })
            await loadWiki()
        }
        if (chatTarget) {
            const { character, chatIndex, currentChat } = chatTarget
            const originals = currentChat.message.map((message) => ({
                data: message.data,
                saying: message.saying,
                name: message.name,
                swipes: message.swipes ? [...message.swipes] : undefined,
            }))
            chatResult = applyChatFindReplace(
                currentChat.message,
                input.find,
                input.replacement
            )
            if (chatResult.matches > 0) {
                try {
                    await saveChatToServer(
                        characterId,
                        chatIndex,
                        chatId,
                        currentChat
                    )
                    character.reloadKeys = (character.reloadKeys ?? 0) + 1
                }
                catch (cause) {
                    currentChat.message.forEach((message, index) => {
                        message.data = originals[index].data
                        message.saying = originals[index].saying
                        message.name = originals[index].name
                        message.swipes = originals[index].swipes
                    })
                    throw cause
                }
            }
        }
        return {
            wikiMatches: wikiResult.matches,
            wikiDocuments: wikiResult.documents,
            chatMatches: chatResult.matches,
            chatMessages: chatResult.messages,
        }
    }

    function setDockRatio(value: number) {
        dockRatio = normalizeMemoryWikiDockRatio(value)
        DBState.db.risuBardMemoryDockRatio = dockRatio
    }

    function resizeDock(event: PointerEvent) {
        event.preventDefault()
        const container = dockElement?.parentElement
        if (!container) return
        const update = (move: PointerEvent) => {
            const bounds = container.getBoundingClientRect()
            if (bounds.width <= 0) return
            setDockRatio((bounds.right - move.clientX) / bounds.width)
        }
        const stop = () => {
            window.removeEventListener('pointermove', update)
            window.removeEventListener('pointerup', stop)
        }
        window.addEventListener('pointermove', update)
        window.addEventListener('pointerup', stop, { once: true })
    }

    function resizeDockByKeyboard(event: KeyboardEvent) {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
        event.preventDefault()
        setDockRatio(dockRatio + (event.key === 'ArrowLeft' ? 0.05 : -0.05))
    }

    function availableWorkspaceHeight(): number {
        const height = workspaceSplitElement?.clientHeight ?? 0
        return height > 0 ? height : 10_000
    }

    function setWorkspaceHeight(
        value: number,
        availableHeight = availableWorkspaceHeight()
    ) {
        workspaceHeight = normalizeMemoryWikiWorkspaceHeight(
            value,
            availableHeight
        )
        DBState.db.risuBardMemoryWorkspaceHeight = workspaceHeight
    }

    function resizeWorkspace(event: PointerEvent) {
        event.preventDefault()
        if (!workspaceSplitElement) return
        const bounds = workspaceSplitElement.getBoundingClientRect()
        if (bounds.height <= 0) return
        const update = (move: PointerEvent) => {
            setWorkspaceHeight(move.clientY - bounds.top, bounds.height)
        }
        const stop = () => {
            window.removeEventListener('pointermove', update)
            window.removeEventListener('pointerup', stop)
        }
        window.addEventListener('pointermove', update)
        window.addEventListener('pointerup', stop, { once: true })
    }

    function resizeWorkspaceByKeyboard(event: KeyboardEvent) {
        if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
        event.preventDefault()
        setWorkspaceHeight(
            workspaceHeight + (event.key === 'ArrowDown' ? 24 : -24)
        )
    }

    $effect(() => {
        if (!open || !characterId || !wikiChatId) {
            cancelWikiLoad()
            return
        }
        void loadWiki()
        return cancelWikiLoad
    })

    $effect(() => {
        if (!open || !characterId || !wikiChatId || !onExecuteWikiCommand) return
        bardChatUpdatedIds = null
        bardChatUndoAvailable = false
        void refreshBardChatUndoStatus()
    })

    $effect(() => {
        if (activeView !== 'workspace') editorFocus = false
    })

    $effect(() => {
        const refreshCompletedAnalysis = (event: Event) => {
            const detail = (event as CustomEvent<
                RisuBardMemoryUpdatedDetail
            >).detail
            if (!open || detail?.characterId !== characterId
                || detail.chatId !== wikiChatId) return
            void loadWiki()
        }
        window.addEventListener(
            RISUBARD_MEMORY_UPDATED_EVENT,
            refreshCompletedAnalysis
        )
        return () => window.removeEventListener(
            RISUBARD_MEMORY_UPDATED_EVENT,
            refreshCompletedAnalysis
        )
    })

</script>

<aside
    class="memory-wiki-dock"
    class:closed={!open}
    class:editor-focus={editorFocus}
    class:settings-open={settingsOpen}
    class:mobile-layout={layoutMode === 'mobile'}
    class:desktop-layout={layoutMode === 'desktop'}
    data-memory-wiki-dock
    data-memory-layout={layoutMode}
    data-open={open}
    data-editor-focus={editorFocus}
    bind:this={dockElement}
    style:flex-basis={`${dockRatio * 100}%`}
    aria-label={language.risuBardMemoryWiki}
    aria-hidden={!open}
    inert={!open}
>
    <button
        type="button"
        class="dock-resizer"
        aria-label="BardWiki 폭 조절"
        onpointerdown={resizeDock}
        onkeydown={resizeDockByKeyboard}
    ></button>
    <header class="dock-header">
        <div class="dock-titlebar">
            <div class="dock-identity">
            <span class="dock-mark"><BookOpenIcon size={17} /></span>
            <div class="dock-title-row">
                <strong>{language.risuBardMemoryWiki}</strong>
                <button
                    type="button"
                    class="dock-help"
                    data-memory-help
                    aria-label="사용 가이드"
                    title="BardWiki 사용 가이드"
                    onclick={() => helpOpen = true}
                >사용 가이드</button>
                <button
                    type="button"
                    class="dock-layout-toggle"
                    data-memory-layout-toggle
                    aria-label={`${layoutMode === 'mobile' ? '데스크톱' : '모바일'} 레이아웃으로 전환`}
                    title={`${layoutMode === 'mobile' ? '데스크톱' : '모바일'} 레이아웃으로 전환`}
                    onclick={toggleLayout}
                >
                    {#if layoutMode === 'mobile'}
                        <MonitorIcon size={15} />
                        <span>데스크톱</span>
                    {:else}
                        <SmartphoneIcon size={15} />
                        <span>모바일</span>
                    {/if}
                </button>
            </div>
            </div>
            <button class="dock-close" type="button" aria-label="BardWiki 닫기" onclick={() => open = false}>
                <PanelRightCloseIcon size={18} />
            </button>
        </div>
        <nav class="dock-views" aria-label="BardWiki 보기">
            {#if wiki?.mode === 'markdown'}
                <button
                    type="button"
                    class="force-update-button"
                    class:running={forceUpdating}
                    data-risubard-force-wiki-update
                    title={language.risuBardMemoryForceUpdate}
                    aria-label={language.risuBardMemoryForceUpdate}
                    aria-busy={forceUpdating}
                    onclick={forceWikiUpdate}
                    disabled={forceUpdating || Boolean(rebootJob)
                        || !onForceWikiUpdate}
                >
                    <img class="force-update-idle" src={forceUpdateIdle} alt="" />
                    <img class="force-update-hover" src={forceUpdateHover} alt="" />
                    <span>{forceUpdating
                        ? language.risuBardMemoryForceUpdating
                        : language.risuBardMemoryForceUpdate}</span>
                </button>
                <button
                    type="button"
                    class="find-replace-button"
                    data-wiki-open-find-replace
                    title="찾기/바꾸기"
                    aria-label="찾기/바꾸기"
                    onclick={() => findReplaceOpen = true}
                    disabled={Boolean(rebootJob)}
                >
                    <SolarBoldIcon name="magnifier" size={16} />
                    <span>찾기/바꾸기</span>
                </button>
                <button
                    type="button"
                    class="reboot-button"
                    class:active={Boolean(rebootJob)}
                    data-risubard-wiki-reboot
                    title={rebootJob
                        ? `${rebootButtonLabel} · ${rebootJob.completedAssistantMessageIds.length}/${rebootJob.targetAssistantMessageIds.length}`
                        : language.risuBardWikiRebootDescription}
                    aria-busy={rebootActionBusy
                        || rebootJob?.status === 'running'
                        || rebootJob?.status === 'finalizing'}
                    onclick={handleRebootAction}
                    disabled={rebootActionBusy
                        || rebootJob?.status === 'stop-requested'
                        || rebootJob?.status === 'finalizing'
                        || (!rebootJob && !onStartWikiReboot)}
                ><span>{rebootButtonLabel}</span></button>
                {#if rebootJob && (rebootJob.status === 'paused'
                    || rebootJob.status === 'failed')}
                    <button
                        type="button"
                        class="reboot-cancel-button"
                        title={language.risuBardWikiRebootCancelDescription}
                        onclick={cancelReboot}
                        disabled={rebootActionBusy}
                    ><span>{language.risuBardWikiRebootCancel}</span></button>
                {/if}
            {/if}
            <div class="dock-view-actions">
                <button
                    type="button"
                    class:active={activeView === 'workspace'}
                    data-memory-view="workspace"
                    title="작업 공간"
                    onclick={() => activeView = 'workspace'}
                ><SolarBoldIcon name="notebook" size={22} /><span>작업 공간</span></button>
                {#if wiki?.mode === 'markdown'}
                    <button
                        type="button"
                        class:active={activeView === 'story'}
                        data-memory-view="story"
                        title="이야기"
                        onclick={() => activeView = 'story'}
                    >
                        <svg data-memory-icon="scroll" viewBox="0 0 24 24" aria-hidden="true">
                            <path d="m22.5 17c-.17-.339-.621-.5-1-.5h-12.5c-.553 0-1 .448-1 1v1.5c0 .015-.012 1.5-1 1.5-.505 0-.931.376-.992.878-.062.501.26.97.75 1.092 2.119.53 5.094.53 8.242.53 4.858 0 6.163-.463 6.447-.605.159-.08 1.553-.85 1.553-3.395 0-1.688-.438-1.876-.5-2z" />
                            <path d="m3 1.88c-.246.093-.425.191-.555.285-.58.343-1.441 1.262-1.445 2.833-.005 2.183.555 2.974.796 3.213.188.186.44.29.704.29h.5z" />
                            <path d="m20.122 2.787c-.09-.283-.301-.511-.575-.623-.116-.047-2.904-1.164-7.547-1.164-3.557 0-6.31.383-7 .488v17.779c.289-.259.628-.463 1-.595v-1.171c0-1.654 1.346-3 3-3h11.925c.046-.856.07-1.692.07-2.5 0-6.398-.838-9.102-.873-9.213z" />
                        </svg>
                        <span>이야기</span>
                    </button>
                    <button
                        type="button"
                        class:active={activeView === 'arc-plot'}
                        data-memory-view="arc-plot"
                        title="아크 플롯"
                        onclick={() => activeView = 'arc-plot'}
                    ><NetworkIcon size={20} /><span>아크 플롯</span></button>
                {/if}
                <button
                    type="button"
                    class:active={activeView === 'log'}
                    data-memory-view="log"
                    title="로그"
                    onclick={() => activeView = 'log'}
                ><LogsIcon size={20} /><span>로그</span></button>
                {#if wiki?.mode === 'markdown'}
                    <button
                        type="button"
                        class="dock-settings"
                        class:active={settingsOpen}
                        data-memory-settings
                        title="설정"
                        aria-haspopup="true"
                        aria-expanded={settingsOpen}
                        onclick={() => settingsOpen = !settingsOpen}
                    ><SolarBoldIcon name="settings" size={22} /><span>설정</span></button>
                {/if}
            </div>
            {#if rebootJob && rebootProgress}
                <div
                    class="reboot-progress"
                    class:running={rebootJob.status === 'running'}
                    data-risubard-wiki-reboot-progress
                    role="progressbar"
                    aria-live="polite"
                    aria-valuemin="0"
                    aria-valuemax="100"
                    aria-valuenow={rebootProgress.percent}
                    aria-valuetext={language.risuBardWikiRebootProgress(
                        rebootProgress.completed,
                        rebootProgress.total,
                        rebootProgress.percent
                    )}
                >
                    <div class="reboot-progress-copy">
                        <span>{language.risuBardWikiReboot}</span>
                        <strong>{language.risuBardWikiRebootProgress(
                            rebootProgress.completed,
                            rebootProgress.total,
                            rebootProgress.percent
                        )}</strong>
                    </div>
                    <div class="reboot-progress-track" aria-hidden="true">
                        <span
                            class="reboot-progress-fill"
                            data-risubard-wiki-reboot-progress-fill
                            style:width={`${rebootProgress.percent}%`}
                        ></span>
                    </div>
                </div>
            {/if}
        </nav>
        {#if wiki?.mode === 'markdown'}
            <section
                class="settings-popover"
                data-memory-settings-popover
                aria-label="BardWiki 현재 챗 설정"
                hidden={!settingsOpen}
                bind:this={settingsPopoverElement}
            >
                <RisuBardCurrentChatSettings chat={currentChat} global={DBState.db} />
                <ManagerResizeHandles
                    target={settingsPopoverElement}
                    rightAnchored
                    shadowPreview
                    resizeStorageKey="bardwiki-current-chat-settings"
                />
            </section>
        {/if}
    </header>

    <div class="memory-ledger min-h-0">
        {#if wiki && wiki.mode !== 'markdown'}
            <div class="ledger-toolbar">
            <div class="ledger-stats" aria-live="polite">
                {#if wiki.mode === 'v2'}
                    <span class="graph-current">
                        <NetworkIcon size={13} />
                        {language.risuBardGraphCurrent}
                    </span>
                    <span>{wiki.graph.nodes.length} {language.risuBardGraphNodes}</span>
                    <span>{wiki.graph.edges.length} {language.risuBardGraphRelations}</span>
                {:else}
                    <span>{activeFacts.length} {language.risuBardActiveFacts}</span>
                    <span>{recentEvents.length} {language.risuBardEvents}</span>
                    <span>{invalidatedFacts.length} {language.risuBardInvalidatedFacts}</span>
                {/if}
            </div>
                <ShButton
                    variant="ghost"
                    size="sm"
                    onclick={loadWiki}
                    disabled={loading}
                >
                    <RefreshCwIcon size={15} class={loading ? 'animate-spin' : ''} />
                    {language.risuBardMemoryRefresh}
                </ShButton>
            </div>
        {/if}
        {#if forceUpdateStatus}
            <div
                class="force-update-status"
                class:failed={forceUpdateStatus === 'failed'}
                data-force-update-status={forceUpdateStatus}
                aria-live="polite"
            >
                <span>
                    {forceUpdateStatus === 'failed' && forceUpdateError
                        ? forceUpdateError
                        : forceUpdateStatus === 'success'
                        ? language.risuBardMemoryForceUpdateDone
                        : forceUpdateStatus === 'empty'
                            ? language.risuBardMemoryForceUpdateEmpty
                            : language.risuBardMemoryForceUpdateFailed}
                </span>
                {#if forceUpdateStatus === 'success' && forceUpdateMeta}
                    <span class="force-update-meta" data-force-update-meta>
                        {language.risuBardMemoryForceUpdateMeta(
                            forceUpdateMeta.turn,
                            new Intl.DateTimeFormat(undefined, {
                                hour: '2-digit',
                                minute: '2-digit',
                                hour12: false,
                            }).format(forceUpdateMeta.completedAt)
                        )}
                    </span>
                {/if}
            </div>
        {/if}
        {#if wiki?.observability}
            <div
                class="memory-observability"
                data-memory-observability
                aria-label="RisuBard runtime observability"
            >
                <span>prompt {wiki.observability.lastPromptMode}</span>
                <span>
                    graph r{wiki.observability.graphRevision}
                    / index r{wiki.observability.indexRevision}
                    ({wiki.observability.cacheStatus})
                </span>
                {#if wiki.observability.lastInquiry}
                    <span>
                        candidates {wiki.observability.lastInquiry.candidateCount}
                        · inspected {wiki.observability.lastInquiry.inspectedNodeCount}
                        nodes / {wiki.observability.lastInquiry.inspectedEdgeCount}
                        edges
                    </span>
                    <span>
                        selected {wiki.observability.lastInquiry.selectedNodeCount}
                        nodes / {wiki.observability.lastInquiry.selectedTokens}
                        tokens
                    </span>
                {/if}
                <span>
                    analysis
                    {wiki.observability.lastAnalysis?.status ?? 'none'}
                    · {wiki.observability.lastAnalysis?.appliedCount ?? 0}
                    operations
                </span>
            </div>
        {/if}

        {#if loading && !wiki}
            <div class="ledger-state">
                <LoaderCircleIcon size={24} class="animate-spin" />
                <span>{language.loading}</span>
            </div>
        {:else if error}
            <div class="ledger-state ledger-error">
                <XCircleIcon size={24} />
                <span>{language.risuBardMemoryLoadFailed}</span>
                <small>{error}</small>
            </div>
        {:else if wiki?.mode === 'markdown'}
            <div
                class="markdown-wiki"
                class:workspace-split={activeView === 'workspace'
                    && !!onExecuteWikiCommand && !rebootJob}
                class:command-collapsed={!commandExpanded}
                class:editor-focus={editorFocus}
                class:activity-view={activeView === 'log'}
                data-memory-view-mode="markdown"
                data-wiki-workspace-split={activeView === 'workspace' ? '' : undefined}
                bind:this={workspaceSplitElement}
                style:--wiki-workspace-height={`${workspaceHeight}px`}
            >
                {#if activeView === 'workspace'}
                    <div class="wiki-editor-region">
                        <RisuBardWikiEditor
                            {characterId}
                            chatId={wikiChatId}
                            locked={Boolean(rebootJob)}
                            documents={wiki.documents}
                            health={wiki.health}
                            bind:selectedId={selectedMarkdownId}
                            onChanged={loadWiki}
                            onFocusModeChange={(focused) => editorFocus = focused}
                            onNavigateSource={onNavigateStorySource}
                            highlightedDocumentIds={bardChatUpdatedIds}
                            mobileLayout={layoutMode === 'mobile'}
                        />
                    </div>
                    {#if onExecuteWikiCommand && !rebootJob}
                        <button
                            type="button"
                            class="workspace-resizer"
                            data-wiki-workspace-resizer
                            aria-label="위키 편집 영역 높이 조절"
                            title="드래그하거나 위·아래 방향키로 편집 영역 높이 조절"
                            onpointerdown={resizeWorkspace}
                            onkeydown={resizeWorkspaceByKeyboard}
                        ><span aria-hidden="true"></span></button>
                        <article
                            class="markdown-command-pane"
                            class:collapsed={!commandExpanded}
                            data-wiki-command-pane
                            data-command-expanded={commandExpanded}
                        >
                            <header class="portrait-command-header">
                                <button
                                    type="button"
                                    data-wiki-toggle-command
                                    aria-expanded={commandExpanded}
                                    aria-controls="risubard-wiki-command-terminal"
                                    onclick={() => commandExpanded = !commandExpanded}
                                >
                                    <SquareTerminalIcon size={17} />
                                    <strong>BARDCHAT</strong>
                                    <ChevronDownIcon size={18} class={commandExpanded ? '' : 'collapsed'} />
                                </button>
                            </header>
                            <div id="risubard-wiki-command-terminal" class="command-terminal-region">
                                <RisuBardWikiCommandTerminal
                                    onExecute={executeWikiCommand}
                                    contextSelection={bardChatContextSelection}
                                    onContextSelectionChange={setBardChatContextSelection}
                                    targetDocumentTitleOrId={selectedMarkdownDocument?.title ?? ''}
                                    canRestore={bardChatUndoAvailable}
                                    onRestore={restoreLastBardChatChange}
                                    mobileLayout={layoutMode === 'mobile'}
                                />
                            </div>
                        </article>
                    {/if}
                {:else if activeView === 'story'}
                    <RisuBardStorySoFar
                        documents={wiki.documents}
                        onNavigate={onNavigateStorySource}
                        onEdit={editStoryEntry}
                    />
                {:else if activeView === 'arc-plot'}
                    <RisuBardStoryArcPlot
                        documents={wiki.documents}
                        checkpointSize={arcPlotterSettings.checkpointSize}
                        enabled={arcPlotterSettings.enabled}
                        onOpenDocument={editStoryEntry}
                    />
                {:else}
                    <div class="activity-log-scroll" data-memory-activity-scroll>
                        <RisuBardMemoryActivity
                            {characterId}
                            {chatId}
                            messages={activityMessages}
                            onSelectPath={(path) => {
                                selectMarkdownPath(path)
                                activeView = 'workspace'
                            }}
                        />
                    </div>
                {/if}
            </div>
        {:else if wiki?.mode === 'v2'}
            <div class="graph-scroll" data-memory-v2-scroll>
                <RisuBardNarrativeGraph graph={wiki.graph} />
                <RisuBardWriterWorkbench
                    graph={wiki.graph}
                    {characterId}
                    {chatId}
                    onApplied={() => loadWiki()}
                />
            </div>
        {:else if empty}
            <div class="ledger-state" data-memory-view-mode="v1">
                <div class="fallback-note">
                    <strong>{language.risuBardMemoryFallback}</strong>
                    <span>{language.risuBardMemoryFallbackDescription}</span>
                </div>
                <BookOpenIcon size={28} />
                <span>{language.risuBardMemoryEmpty}</span>
            </div>
        {:else}
            <div class="ledger-scroll" data-memory-view-mode="v1">
                <div class="fallback-note">
                    <strong>{language.risuBardMemoryFallback}</strong>
                    <span>{language.risuBardMemoryFallbackDescription}</span>
                </div>
                {#if wiki?.baseline}
                    <section class="ledger-section ledger-baseline">
                        <h3>{language.risuBardCurrentSnapshot}</h3>
                        <p>{wiki.baseline}</p>
                    </section>
                {/if}

                <div class="ledger-columns">
                    <section class="ledger-section">
                        <h3>
                            <CheckCircle2Icon size={16} />
                            {language.risuBardActiveFacts}
                        </h3>
                        {#if activeFacts.length === 0}
                            <p class="ledger-muted">{language.none}</p>
                        {:else}
                            <ul>
                                {#each activeFacts as fact (fact.id)}
                                    <li>{fact.text}</li>
                                {/each}
                            </ul>
                        {/if}
                    </section>

                    <section class="ledger-section">
                        <h3>
                            <Clock3Icon size={16} />
                            {language.risuBardEvents}
                        </h3>
                        {#if recentEvents.length === 0}
                            <p class="ledger-muted">{language.none}</p>
                        {:else}
                            <ol>
                                {#each recentEvents as event (event.id)}
                                    <li>{event.summary}</li>
                                {/each}
                            </ol>
                        {/if}
                    </section>
                </div>

                {#if invalidatedFacts.length > 0}
                    <section class="ledger-section ledger-invalidated">
                        <h3>{language.risuBardInvalidatedFacts}</h3>
                        <ul>
                            {#each invalidatedFacts as fact (fact.id)}
                                <li>{fact.text}</li>
                            {/each}
                        </ul>
                    </section>
                {/if}
            </div>
        {/if}
    </div>
    {#if findReplaceOpen && wiki?.mode === 'markdown'}
        <div
            class="risu-modal-overlay find-replace-overlay"
            data-find-replace-overlay
            role="presentation"
            onclick={(event) => {
                if (event.target === event.currentTarget) findReplaceOpen = false
            }}
        >
            <div
                class="risu-modal-surface find-replace-dialog"
                data-find-replace-dialog
                role="dialog"
                aria-modal="true"
                aria-label="찾기/바꾸기"
            >
                <RisuBardFindReplace
                    documents={wiki.documents}
                    messages={activityMessages}
                    onReplace={replaceText}
                />
            </div>
        </div>
    {/if}
</aside>

{#if rebootChooserOpen}
    <ShDialog
        open={true}
        onOpenChange={(value) => { if (!value) rebootChooserOpen = false }}
        size="default"
        tier="top"
        footer={rebootChooserFooter}
    >
        {#snippet title()}{language.risuBardWikiRebootChooseTitle}{/snippet}
        <p class="reboot-choice-intro">
            {language.risuBardWikiRebootChooseDescription}
        </p>
        <div
            class="reboot-start-index"
            data-risubard-wiki-reboot-start-index
        >
            <label for="risubard-wiki-reboot-start-index">
                {language.risuBardWikiRebootStartChatIndex}
            </label>
            <input
                id="risubard-wiki-reboot-start-index"
                type="number"
                min="0"
                max={rebootLastChatIndex}
                step="1"
                bind:value={rebootStartChatIndex}
                aria-invalid={!rebootStartChatIndexValid}
                aria-describedby="risubard-wiki-reboot-start-index-hint"
            />
            <small id="risubard-wiki-reboot-start-index-hint">
                {language.risuBardWikiRebootStartChatIndexHint(
                    rebootLastChatIndex
                )}
            </small>
        </div>
        <p
            class="reboot-token-budget"
            data-risubard-wiki-reboot-token-budget
        >
            {language.risuBardWikiRebootTokenBudget(rebootAnalysisTokenLimit)}
        </p>
        <div class="reboot-choices" data-risubard-wiki-reboot-choices>
            <button
                type="button"
                class="reboot-choice"
                title={language.risuBardWikiRebootOneTurnTooltip}
                onclick={() => startReboot(1)}
                disabled={!rebootStartChatIndexValid}
            >
                <strong>{language.risuBardWikiRebootOneTurn}</strong>
                <span>{language.risuBardWikiRebootOneTurnSummary}</span>
            </button>
            <button
                type="button"
                class="reboot-choice"
                title={language.risuBardWikiRebootTwoTurnTooltip}
                onclick={() => startReboot(2)}
                disabled={!rebootStartChatIndexValid}
            >
                <strong>{language.risuBardWikiRebootTwoTurn}</strong>
                <span>{language.risuBardWikiRebootTwoTurnSummary}</span>
            </button>
        </div>
    </ShDialog>
{/if}

{#snippet rebootChooserFooter()}
    <div class="reboot-choice-footer">
        <ShButton variant="outline" onclick={() => rebootChooserOpen = false}>
            {language.cancel}
        </ShButton>
    </div>
{/snippet}

<RisuBardMemoryWikiHelp bind:open={helpOpen} />

<style>
    .memory-wiki-dock {
        position: relative;
        z-index: 30;
        display: flex;
        flex: 0 0 auto;
        flex-direction: column;
        min-width: min(28rem, 100%);
        max-width: 75%;
        height: 100%;
        min-height: 0;
        overflow: hidden;
        border-left: 1px solid color-mix(in srgb, var(--risu-theme-primary) 28%, var(--risu-theme-darkborderc));
        background: var(--risu-theme-darkbg);
        box-shadow: -.8rem 0 2.4rem color-mix(in srgb, var(--color-shadow) 18%, transparent);
        animation: dock-enter .18s ease-out;
        container-type: inline-size;
    }
    .memory-wiki-dock.closed { display: none; }
    .memory-wiki-dock.settings-open { overflow: visible; }
    .memory-wiki-dock.editor-focus > .dock-header,
    .memory-wiki-dock.editor-focus .ledger-toolbar,
    .memory-wiki-dock.editor-focus .force-update-status,
    .memory-wiki-dock.editor-focus .memory-observability { display: none; }
    .dock-resizer {
        position: absolute;
        z-index: 5;
        inset: 0 auto 0 -.3rem;
        width: .6rem;
        padding: 0;
        border: 0;
        background: transparent;
        cursor: col-resize;
        touch-action: none;
    }
    .dock-resizer::after {
        content: '';
        position: absolute;
        inset: 0 auto 0 .27rem;
        width: 1px;
        background: transparent;
        transition: width .15s ease, background .15s ease;
    }
    .dock-resizer:hover::after,
    .dock-resizer:focus-visible::after {
        width: 3px;
        outline: 0;
        background: var(--risu-theme-primary);
    }
    .dock-header {
        position: relative;
        z-index: 10;
        display: flex;
        flex-direction: column;
        gap: .3rem;
        padding: .4rem .5rem .45rem .65rem;
        border-bottom: 1px solid var(--risu-theme-darkborderc);
        background: color-mix(in srgb, var(--risu-theme-darkbg) 91%, var(--color-bgcolor));
    }
    .dock-titlebar { display: flex; width: 100%; min-width: 0; align-items: center; gap: .65rem; }
    .dock-identity {
        display: flex;
        flex: 1 1 8rem;
        min-width: 0;
        align-items: center;
        gap: .55rem;
    }
    .dock-title-row { display: flex; flex-wrap: wrap; min-width: 0; align-items: center; gap: .35rem .5rem; }
    .dock-identity strong { font-family: var(--risu-font-family); font-size: .84rem; font-weight: 700; line-height: 1.1; letter-spacing: -.02em; white-space: nowrap; }
    .dock-help,
    .dock-layout-toggle {
        display: inline-flex;
        flex: 0 0 auto;
        min-height: 1.75rem;
        align-items: center;
        justify-content: center;
        gap: .3rem;
        padding: .2rem .55rem;
        border: 1px solid var(--risu-theme-darkborderc);
        border-radius: .35rem;
        color: var(--risu-theme-textcolor);
        background: color-mix(in srgb, var(--risu-theme-primary) 8%, var(--risu-theme-darkbg));
        font-size: .75rem;
        font-weight: 600;
        line-height: 1.2;
        white-space: nowrap;
        cursor: pointer;
    }
    .dock-help:hover,
    .dock-help:focus-visible,
    .dock-layout-toggle:hover,
    .dock-layout-toggle:focus-visible {
        border-color: color-mix(in srgb, var(--risu-theme-primary) 35%, var(--risu-theme-darkborderc));
        outline: 0;
        color: var(--risu-theme-textcolor);
        background: color-mix(in srgb, var(--risu-theme-primary) 12%, transparent);
    }
    .dock-mark {
        display: grid;
        flex: 0 0 auto;
        width: 1.8rem;
        height: 1.8rem;
        place-items: center;
        border: 1px solid color-mix(in srgb, var(--risu-theme-primary) 38%, var(--risu-theme-darkborderc));
        border-radius: .4rem;
        color: var(--risu-theme-primary);
        background: color-mix(in srgb, var(--risu-theme-primary) 9%, transparent);
    }
    .dock-views { display: flex; flex-wrap: wrap; width: 100%; min-height: 44px; align-items: center; gap: .3rem; padding: .3rem .35rem; border-radius: .48rem; background: color-mix(in srgb, var(--risu-theme-darkbg) 78%, var(--risu-theme-textcolor2) 8%); }
    .dock-view-actions { display: flex; align-items: center; justify-content: flex-end; gap: .25rem; margin-left: auto; }
    .reboot-progress {
        flex: 1 0 100%;
        display: grid;
        gap: .28rem;
        padding: .38rem .18rem .08rem;
        border-top: 1px solid color-mix(in srgb, var(--risu-theme-primary) 18%, var(--risu-theme-darkborderc));
    }
    .reboot-progress-copy {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: .75rem;
        color: var(--risu-theme-textcolor2);
        font-size: .68rem;
        line-height: 1;
    }
    .reboot-progress-copy strong {
        color: var(--risu-theme-textcolor);
        font-size: .7rem;
        font-variant-numeric: tabular-nums;
        letter-spacing: .015em;
    }
    .reboot-progress-track {
        height: .34rem;
        overflow: hidden;
        border: 1px solid color-mix(in srgb, var(--risu-theme-primary) 20%, transparent);
        border-radius: 999px;
        background: color-mix(in srgb, var(--risu-theme-darkbg) 82%, var(--risu-theme-textcolor2) 8%);
    }
    .reboot-progress-fill {
        position: relative;
        display: block;
        height: 100%;
        overflow: hidden;
        border-radius: inherit;
        background: var(--risu-theme-primary);
        transition: width 280ms ease-out;
    }
    .reboot-progress.running .reboot-progress-fill::after {
        position: absolute;
        inset: 0;
        content: '';
        background: linear-gradient(90deg, transparent 0%, color-mix(in srgb, var(--color-accenttext) 38%, transparent) 50%, transparent 100%);
        transform: translateX(-100%);
        animation: reboot-progress-sheen 1.4s ease-in-out infinite;
    }
    @keyframes reboot-progress-sheen {
        to { transform: translateX(100%); }
    }
    @media (prefers-reduced-motion: reduce) {
        .reboot-progress-fill { transition: none; }
        .reboot-progress.running .reboot-progress-fill::after {
            animation: none;
        }
    }
    .dock-views button, .dock-close {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: .32rem;
        min-height: 1.85rem;
        padding: .28rem .48rem;
        border: 1px solid transparent;
        border-radius: .34rem;
        color: var(--risu-theme-textcolor2);
        background: transparent;
        font-size: .68rem;
        white-space: nowrap;
        cursor: pointer;
        list-style: none;
    }
    .dock-views button { width: 2.35rem; min-height: 2.25rem; padding: .35rem; }
    .dock-views .force-update-button,
    .dock-views .find-replace-button,
    .dock-views .reboot-button,
    .dock-views .reboot-cancel-button {
        flex: 0 0 auto;
        width: auto;
        min-width: 5.7rem;
        height: 2.25rem;
        padding-inline: .72rem;
        font-size: .75rem;
        border-color: color-mix(in srgb, var(--risu-theme-primary) 32%, var(--risu-theme-darkborderc));
    }
    .dock-views .force-update-button { justify-content: flex-start; gap: .4rem; color: var(--risu-theme-textcolor); background: color-mix(in srgb, var(--risu-theme-primary) 13%, var(--risu-theme-darkbg)); }
    .dock-views .reboot-cancel-button {
        min-width: auto;
        color: var(--risu-theme-draculared);
    }
    .force-update-button img { display: block; flex: 0 0 auto; width: 24px; height: 24px; object-fit: contain; image-rendering: auto; }
    .force-update-hover { display: none !important; }
    .force-update-button:hover:not(:disabled) .force-update-idle,
    .force-update-button.running .force-update-idle { display: none; }
    .force-update-button:hover:not(:disabled) .force-update-hover,
    .force-update-button.running .force-update-hover { display: block !important; }
    .dock-view-actions svg { display: block; width: 22px; height: 22px; fill: currentColor; }
    .dock-views button span { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
    .dock-views .force-update-button span,
    .dock-views .find-replace-button span,
    .dock-views .reboot-button span,
    .dock-views .reboot-cancel-button span {
        position: static;
        width: auto;
        height: auto;
        overflow: visible;
        clip-path: none;
    }
    .dock-views button:hover, .dock-views button.active,
    .dock-close:hover {
        color: var(--risu-theme-textcolor);
        border-color: color-mix(in srgb, var(--risu-theme-primary) 24%, var(--risu-theme-darkborderc));
        background: color-mix(in srgb, var(--risu-theme-primary) 12%, transparent);
    }
    .dock-views button.active { color: var(--color-accenttext); border-color: color-mix(in srgb, var(--risu-theme-primary) 72%, transparent); background: var(--risu-theme-primary); }
    .dock-views button:disabled { opacity: .48; cursor: default; }
    .settings-popover {
        position: absolute;
        z-index: 50;
        top: calc(100% + .22rem);
        right: .5rem;
        display: grid;
        width: var(--manager-width, 58rem);
        height: var(--manager-height, auto);
        max-width: calc(100vw - 1rem);
        max-height: calc(100dvh - 7rem);
        overflow-y: auto;
        padding: .55rem;
        border: 1px solid var(--risu-theme-darkborderc);
        border-radius: .42rem;
        background: var(--risu-theme-bgcolor);
        box-shadow: 0 .6rem 1.5rem color-mix(in srgb, var(--color-shadow) 28%, transparent);
    }
    .settings-popover[hidden] { display: none; }
    .find-replace-overlay {
        position: absolute;
        z-index: 60;
        inset: 0;
        display: grid;
        place-items: start center;
        padding: clamp(4rem, 12vh, 7rem) 1rem 1rem;
        background: color-mix(in srgb, var(--color-overlay) 58%, transparent);
        backdrop-filter: blur(4px);
    }
    .find-replace-dialog {
        width: min(27rem, 100%);
        max-height: calc(100% - 1rem);
        overflow: hidden;
        border: 1px solid var(--color-darkborderc);
        border-radius: 1rem;
        background: var(--color-darkbg);
        box-shadow: 0 1.5rem 4rem color-mix(in srgb, var(--color-shadow) 32%, transparent);
        background: var(--risu-theme-bgcolor);
        box-shadow: 0 1rem 2.8rem color-mix(in srgb, var(--color-shadow) 38%, transparent);
    }
    .dock-close { flex: 0 0 auto; padding-inline: .38rem; }
    .reboot-choice-intro {
        margin: 0 0 .65rem;
        color: var(--risu-theme-textcolor2);
        font-size: .82rem;
        line-height: 1.55;
        text-align: center;
    }
    .reboot-start-index {
        display: grid;
        grid-template-columns: minmax(0, 1fr) 7rem;
        align-items: center;
        gap: .4rem .85rem;
        margin: 0 0 .8rem;
        padding: .8rem .9rem;
        border: 1px solid color-mix(in srgb, var(--risu-theme-primary) 52%, var(--risu-theme-darkborderc));
        border-radius: .6rem;
        background: color-mix(in srgb, var(--risu-theme-primary) 11%, var(--risu-theme-darkbg));
    }
    .reboot-start-index label {
        color: var(--risu-theme-textcolor);
        font-size: 1rem;
        font-weight: 750;
        line-height: 1.35;
    }
    .reboot-start-index input {
        width: 100%;
        min-width: 0;
        padding: .5rem .65rem;
        border: 1px solid var(--risu-theme-darkborderc);
        border-radius: .42rem;
        color: var(--risu-theme-textcolor);
        background: var(--risu-theme-bgcolor);
        font-size: 1.1rem;
        font-weight: 700;
        font-variant-numeric: tabular-nums;
        text-align: center;
    }
    .reboot-start-index input:focus-visible {
        border-color: var(--risu-theme-primary);
        outline: 2px solid color-mix(in srgb, var(--risu-theme-primary) 42%, transparent);
        outline-offset: 2px;
    }
    .reboot-start-index input[aria-invalid="true"] {
        border-color: var(--risu-theme-draculared);
    }
    .reboot-start-index small {
        grid-column: 1 / -1;
        color: var(--risu-theme-textcolor2);
        font-size: .72rem;
        line-height: 1.4;
    }
    .reboot-token-budget {
        margin: 0 0 1rem;
        padding: .65rem .75rem;
        border: 1px solid color-mix(in srgb, var(--risu-theme-primary) 24%, var(--risu-theme-darkborderc));
        border-radius: .5rem;
        color: var(--risu-theme-textcolor2);
        background: color-mix(in srgb, var(--risu-theme-primary) 6%, transparent);
        font-size: .74rem;
        line-height: 1.5;
        text-align: center;
    }
    .reboot-choices {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: .85rem;
    }
    .reboot-choice {
        aspect-ratio: 1;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: .7rem;
        min-width: 0;
        padding: 1rem;
        border: 1px solid color-mix(in srgb, var(--risu-theme-primary) 35%, var(--risu-theme-darkborderc));
        border-radius: .7rem;
        color: var(--risu-theme-textcolor);
        background: color-mix(in srgb, var(--risu-theme-primary) 8%, var(--risu-theme-darkbg));
        cursor: pointer;
    }
    .reboot-choice:hover {
        border-color: var(--risu-theme-primary);
        background: color-mix(in srgb, var(--risu-theme-primary) 17%, var(--risu-theme-darkbg));
    }
    .reboot-choice:disabled {
        opacity: .45;
        cursor: not-allowed;
    }
    .reboot-choice strong { font-size: 1rem; }
    .reboot-choice span {
        color: var(--risu-theme-textcolor2);
        font-size: .72rem;
        line-height: 1.45;
        text-align: center;
    }
    .reboot-choice-footer { display: flex; width: 100%; justify-content: center; }
    .memory-ledger {
        display: flex;
        flex: 1;
        flex-direction: column;
        height: auto;
        min-height: 0;
        background:
            linear-gradient(90deg, color-mix(in srgb, var(--risu-theme-primary) 7%, transparent) 1px, transparent 1px),
            linear-gradient(color-mix(in srgb, var(--risu-theme-primary) 5%, transparent) 1px, transparent 1px);
        background-size: 28px 28px;
    }
    .ledger-toolbar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 1rem;
        padding: .75rem 1rem;
        border-block: 1px solid var(--risu-theme-darkborderc);
        background: color-mix(in srgb, var(--risu-theme-darkbg) 92%, transparent);
    }
    .ledger-stats {
        display: flex;
        flex-wrap: wrap;
        gap: .5rem;
        color: var(--risu-theme-textcolor2);
        font-size: .72rem;
        letter-spacing: .06em;
        text-transform: uppercase;
    }
    .ledger-stats span {
        display: inline-flex;
        align-items: center;
        gap: .35rem;
        padding: .25rem .5rem;
        border: 1px solid var(--risu-theme-darkborderc);
        border-radius: 999px;
    }
    .ledger-stats .graph-current {
        color: color-mix(in srgb, var(--risu-theme-primary) 78%, var(--risu-theme-textcolor));
        border-color: color-mix(in srgb, var(--risu-theme-primary) 45%, var(--risu-theme-darkborderc));
    }
    .force-update-status {
        display: flex;
        align-items: center;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: .25rem 1rem;
        padding: .42rem 1rem;
        border-bottom: 1px solid color-mix(in srgb, var(--risu-theme-success) 28%, var(--risu-theme-darkborderc));
        color: color-mix(in srgb, var(--risu-theme-success) 78%, var(--risu-theme-textcolor));
        background: color-mix(in srgb, var(--risu-theme-success) 8%, var(--risu-theme-darkbg));
        font-size: .7rem;
    }
    .force-update-meta {
        margin-left: auto;
        white-space: nowrap;
        color: color-mix(in srgb, currentColor 78%, transparent);
    }
    .force-update-status.failed {
        border-bottom-color: color-mix(in srgb, var(--risu-theme-draculared) 35%, var(--risu-theme-darkborderc));
        color: var(--risu-theme-draculared);
        background: color-mix(in srgb, var(--risu-theme-draculared) 7%, var(--risu-theme-darkbg));
    }
    .ledger-scroll {
        flex: 1;
        min-height: 0;
        overflow-y: auto;
        padding: 1rem;
    }
    .graph-scroll {
        flex: 1;
        min-height: 0;
        overflow-y: auto;
        overscroll-behavior: contain;
    }
    .markdown-wiki {
        flex: 1;
        min-height: 0;
        overflow-y: auto;
    }
    .markdown-wiki.activity-view { overflow: hidden; }
    .activity-log-scroll {
        height: 100%;
        min-height: 0;
        overflow-y: scroll;
        overscroll-behavior: contain;
        scrollbar-gutter: stable;
    }
    .activity-log-scroll :global(.activity-console) { height: auto; min-height: 100%; overflow: visible; }
    .activity-log-scroll :global(.activity-stream) { overflow: visible; }
    .markdown-wiki.workspace-split {
        display: grid;
        grid-template-rows:
            minmax(0, min(
                var(--wiki-workspace-height),
                calc(100% - 13.75rem)
            ))
            .75rem
            minmax(13rem, 1fr);
        overflow: hidden;
    }
    .workspace-split > .wiki-editor-region { grid-row: 1; }
    .workspace-split > .workspace-resizer { grid-row: 2; }
    .workspace-split > .markdown-command-pane { grid-row: 3; }
    .markdown-wiki.workspace-split.editor-focus {
        grid-template-rows: minmax(0, 1fr);
    }
    .workspace-split.editor-focus > .workspace-resizer,
    .workspace-split.editor-focus > .markdown-command-pane { display: none; }
    .wiki-editor-region {
        min-height: 0;
        overflow: hidden;
    }
    .workspace-split .wiki-editor-region :global(.wiki-editor) {
        height: 100%;
        min-height: 0;
        border-bottom: 0;
    }
    .workspace-split .wiki-editor-region :global(.editor-pane) {
        min-height: 0;
    }
    .workspace-split .wiki-editor-region :global(.markdown-editor),
    .workspace-split .wiki-editor-region :global(.markdown-preview) {
        min-height: 0;
    }
    .workspace-resizer {
        position: relative;
        z-index: 4;
        width: 100%;
        min-height: .75rem;
        padding: 0;
        border: 0;
        border-block: 1px solid var(--risu-theme-darkborderc);
        outline: 0;
        background: color-mix(in srgb, var(--risu-theme-darkbg) 90%, transparent);
        cursor: row-resize;
        touch-action: none;
    }
    .workspace-resizer::before {
        position: absolute;
        z-index: 2;
        inset: -1.9rem 0 0;
        content: '';
    }
    .workspace-resizer span,
    .workspace-resizer::after {
        position: absolute;
        left: 50%;
        width: 2.6rem;
        content: '';
        transform: translateX(-50%);
    }
    .workspace-resizer span {
        top: 50%;
        height: .18rem;
        border-radius: 999px;
        background: color-mix(in srgb, var(--risu-theme-textcolor2) 48%, transparent);
        transform: translate(-50%, -50%);
    }
    .workspace-resizer::after {
        inset-block: -.28rem;
        width: 5rem;
        border-radius: .35rem;
        background: transparent;
        transition: background .14s ease;
    }
    .workspace-resizer:hover,
    .workspace-resizer:focus-visible {
        border-color: color-mix(in srgb, var(--risu-theme-primary) 55%, var(--risu-theme-darkborderc));
        background: color-mix(in srgb, var(--risu-theme-primary) 10%, var(--risu-theme-darkbg));
    }
    .workspace-resizer:hover::after,
    .workspace-resizer:focus-visible::after {
        background: color-mix(in srgb, var(--risu-theme-primary) 9%, transparent);
    }
    .markdown-command-pane {
        position: relative;
        z-index: 6;
        min-height: 0;
        overflow: hidden;
        padding: .65rem .75rem .75rem;
    }
    .portrait-command-header { display: none; }
    .command-terminal-region { height: 100%; min-height: 0; }

    .memory-wiki-dock.mobile-layout .markdown-wiki.workspace-split {
        grid-template-rows: minmax(0, 1fr) 0 minmax(12rem, 42%);
    }
    .memory-wiki-dock.mobile-layout .markdown-wiki.workspace-split.command-collapsed {
        grid-template-rows: minmax(0, 1fr) 0 3rem;
    }
    .memory-wiki-dock.mobile-layout .workspace-resizer { display: none; }
    .memory-wiki-dock.mobile-layout .markdown-command-pane {
        display: grid;
        grid-template-rows: 3rem minmax(0, 1fr);
        padding: 0;
        border-top: 1px solid var(--risu-theme-darkborderc);
        background: color-mix(in srgb, var(--risu-theme-darkbg) 94%, var(--color-bgcolor));
        box-shadow: 0 -.6rem 1.8rem color-mix(in srgb, var(--color-shadow) 16%, transparent);
    }
    .memory-wiki-dock.mobile-layout .portrait-command-header {
        display: block;
        min-width: 0;
        border-bottom: 1px solid var(--risu-theme-darkborderc);
    }
    .memory-wiki-dock.mobile-layout .portrait-command-header > button {
        display: flex;
        width: 100%;
        min-height: 3rem;
        align-items: center;
        gap: .6rem;
        padding: .35rem .75rem;
        border: 0;
        color: var(--risu-theme-textcolor);
        background: transparent;
        text-align: left;
        touch-action: manipulation;
    }
    .memory-wiki-dock.mobile-layout .portrait-command-header > button:active {
        background: color-mix(in srgb, var(--risu-theme-primary) 13%, transparent);
    }
    .memory-wiki-dock.mobile-layout .portrait-command-header > button:focus-visible {
        outline: 2px solid var(--risu-theme-primary);
        outline-offset: -2px;
    }
    .memory-wiki-dock.mobile-layout .portrait-command-header strong {
        flex: 1;
        min-width: 0;
        font-size: .78rem;
    }
    .memory-wiki-dock.mobile-layout .portrait-command-header :global(svg:last-child) {
        flex: 0 0 auto;
        transition: transform .18s ease-out;
    }
    .memory-wiki-dock.mobile-layout .portrait-command-header :global(svg:last-child.collapsed) {
        transform: rotate(-90deg);
    }
    .memory-wiki-dock.mobile-layout .command-terminal-region { padding: .45rem .55rem .55rem; }
    .memory-wiki-dock.mobile-layout .markdown-command-pane.collapsed .command-terminal-region { display: none; }
    .memory-wiki-dock.mobile-layout .markdown-wiki.workspace-split.editor-focus {
        grid-template-rows: minmax(0, 1fr);
    }

    @keyframes dock-enter {
        from { opacity: .5; transform: translateX(1rem); }
        to { opacity: 1; transform: translateX(0); }
    }

    .memory-wiki-dock.mobile-layout .dock-views {
        flex-wrap: nowrap;
        overflow-x: auto;
        overscroll-behavior-inline: contain;
        scrollbar-width: thin;
    }
    .memory-wiki-dock.mobile-layout .dock-views button {
        width: 2.75rem;
        min-height: 2.75rem;
        padding-inline: .45rem;
    }
    .memory-wiki-dock.mobile-layout .dock-views .force-update-button,
    .memory-wiki-dock.mobile-layout .dock-views .find-replace-button {
        width: 2.75rem;
        min-width: 2.75rem;
        height: 2.75rem;
        justify-content: center;
        padding-inline: 0;
    }
    .memory-wiki-dock.mobile-layout .dock-views .force-update-button span,
    .memory-wiki-dock.mobile-layout .dock-views .find-replace-button span {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip-path: inset(50%);
        white-space: nowrap;
    }
    .memory-wiki-dock.mobile-layout .dock-views .reboot-button,
    .memory-wiki-dock.mobile-layout .dock-views .reboot-cancel-button {
        min-width: auto;
        height: 2.75rem;
        padding-inline: .6rem;
    }
    .memory-wiki-dock.mobile-layout .dock-view-actions {
        flex: 0 0 auto;
        margin-left: auto;
    }
    .memory-wiki-dock.mobile-layout {
        position: absolute;
        inset: 0;
        width: 100% !important;
        max-width: none;
        min-width: 0;
    }
    .memory-wiki-dock.mobile-layout .dock-resizer { display: none; }
    .memory-wiki-dock.mobile-layout .dock-identity { min-width: 0; }

    .memory-observability {
        display: flex;
        flex-wrap: wrap;
        gap: 0.35rem 0.8rem;
        padding: 0.45rem 0.9rem;
        border-bottom: 1px solid color-mix(in srgb, var(--risu-theme-primary) 16%, transparent);
        color: var(--risu-theme-textcolor2);
        font-size: 0.75rem;
        font-variant-numeric: tabular-nums;
    }
    .ledger-columns {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 1rem;
        margin-top: 1rem;
    }
    .fallback-note {
        display: grid;
        gap: .2rem;
        margin-bottom: 1rem;
        padding: .7rem .85rem;
        border: 1px solid color-mix(in srgb, var(--risu-theme-primary) 28%, var(--risu-theme-darkborderc));
        border-left: 3px solid var(--risu-theme-primary);
        background: color-mix(in srgb, var(--risu-theme-primary) 7%, var(--risu-theme-darkbg));
        font-size: .72rem;
    }
    .fallback-note span {
        color: var(--risu-theme-textcolor2);
    }
    .ledger-section {
        padding: 1rem;
        border: 1px solid var(--risu-theme-darkborderc);
        border-radius: .5rem;
        background: color-mix(in srgb, var(--risu-theme-darkbg) 94%, transparent);
        box-shadow: 0 10px 28px color-mix(in srgb, var(--color-shadow) 12%, transparent);
    }
    .ledger-section h3 {
        display: flex;
        align-items: center;
        gap: .45rem;
        margin: 0 0 .75rem;
        color: var(--risu-theme-textcolor);
        font-size: .8rem;
        font-weight: 700;
        letter-spacing: .08em;
        text-transform: uppercase;
    }
    .ledger-section p {
        margin: 0;
        white-space: pre-wrap;
        line-height: 1.7;
    }
    .ledger-section ul,
    .ledger-section ol {
        display: grid;
        gap: .65rem;
        margin: 0;
        padding-left: 1.25rem;
    }
    .ledger-section li {
        padding-left: .25rem;
        line-height: 1.55;
    }
    .ledger-baseline {
        border-left: 3px solid var(--risu-theme-primary);
    }
    .ledger-invalidated {
        margin-top: 1rem;
        opacity: .72;
    }
    .ledger-invalidated li {
        text-decoration: line-through;
    }
    .ledger-muted {
        color: var(--risu-theme-textcolor2);
        font-style: italic;
    }
    .ledger-state {
        flex: 1;
        min-height: 0;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: .75rem;
        padding: 2rem;
        color: var(--risu-theme-textcolor2);
        text-align: center;
    }
    .ledger-error {
        color: var(--risu-theme-draculared);
    }
    .ledger-error small {
        max-width: 36rem;
        color: var(--risu-theme-textcolor2);
    }
    @media (max-width: 640px) {
        .ledger-columns {
            grid-template-columns: 1fr;
        }
        .ledger-toolbar {
            align-items: flex-start;
        }
    }

    @media (prefers-reduced-motion: reduce) {
        .memory-wiki-dock { animation: none; }
        .portrait-command-header :global(svg:last-child) { transition: none; }
    }
</style>
