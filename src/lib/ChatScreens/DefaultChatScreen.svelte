<script lang="ts">

    import Suggestion from './Suggestion.svelte';
    import { CameraIcon, ChevronUpIcon, ChevronDownIcon, ChevronsUpIcon, ChevronsDownIcon, DatabaseIcon, FileTextIcon, GlobeIcon, ImagePlusIcon, LanguagesIcon, Laugh, MenuIcon, MicOffIcon, PackageIcon, Plus, RefreshCcwIcon, ReplyIcon, Send, StepForwardIcon, XIcon, BrainIcon, ArrowDown, ZapIcon, Maximize2, Minimize2, BookOpenIcon } from "@lucide/svelte";
    import ShDropdownMenu from 'src/lib/UI/GUI/ShDropdownMenu.svelte';
    import ShDropdownMenuTrigger from 'src/lib/UI/GUI/ShDropdownMenuTrigger.svelte';
    import ShDropdownMenuContent from 'src/lib/UI/GUI/ShDropdownMenuContent.svelte';
    import ShDropdownMenuItem from 'src/lib/UI/GUI/ShDropdownMenuItem.svelte';
    import { selectedCharID, PlaygroundStore, createSimpleCharacter, hypaV3ModalOpen, ScrollToMessageStore, additionalChatMenu, additionalFloatingActionButtons, chatDeselected, chatPanelStore } from "../../ts/stores.svelte";
    import { tick, untrack } from 'svelte';
    import Chat from "./Chat.svelte";
    import {
        DEFAULT_CHAT_PAGE_SIZE,
        getChatPageBounds,
        getChatPageCount,
        getChatPageForMessage,
        getLatestChatPage,
        normalizeChatPageSize,
    } from 'src/ts/chatPagination';
    import {
        buildChatTurnNavigation,
        normalizeChatNavigationTarget,
    } from 'src/ts/chatTurnNavigation';
    import { loadChatViewSession, saveChatViewSession, type ChatViewSession } from 'src/ts/chatViewSession'
    import { type Chat as ChatData, type Message } from "../../ts/storage/database.svelte";
    import { DBState } from 'src/ts/stores.svelte';
    import { getCharImage } from "../../ts/characters";
    import {
        chatProcessStage,
        cancelCurrentWikiReboot,
        confirmCurrentNarrativeMessage,
        reanalyzeNarrativeMessage,
        doingChat,
        executeCurrentNarrativeWikiCommand,
        forceCurrentNarrativeWikiUpdate,
        resumeCurrentWikiReboot,
        startCurrentWikiReboot,
        stopCurrentWikiReboot,
        sendChat,
    } from "../../ts/process/index.svelte";
    import { abortGeneration, chatGenKey, endGeneration, generationStates, registerAbort } from "../../ts/process/generationState";
    import { claimPendingSend, clearPendingSend, markResumable, resumableSends, takeResumable } from "../../ts/process/request/pendingSends";
    import { ensureCurrentChatReady } from "../../ts/storage/chatStorage";
    import { sleep } from "../../ts/util";
    import { language } from "../../lang";
    import { isExpTranslator, translate } from "../../ts/translator/translator";
    import { alertError, alertWait, notifySuccess, notifyError } from "../../ts/alert";
    import { playNotificationSound } from '../../ts/notificationSound'
import { isMobile } from 'src/ts/platform'
    import { processScript } from "src/ts/process/scripts";
    import CreatorQuote from "./CreatorQuote.svelte";
    import { stopTTS } from "src/ts/process/tts";
    import MainMenu from '../UI/MainMenu.svelte';
    import AssetInput from './AssetInput.svelte';
    import { scrollWithinContainer } from './scrollWithin';
    import {
        captureChatScrollAnchor,
        restoreChatScrollAnchor,
        type ChatScrollAnchor,
    } from './chatScrollAnchor';
    import { aiLawApplies, chatFoldedState, chatFoldedStateMessageIndex, downloadFile } from 'src/ts/globalApi.svelte';
    import { runTrigger } from 'src/ts/process/triggers';
    import { v4 } from 'uuid';
    import { processMultiCommand } from 'src/ts/process/command';
    import { postChatFile } from 'src/ts/process/files/multisend';
    import { getInlayAsset } from 'src/ts/process/files/inlays';
    import { quickMenu } from 'src/ts/hotkey';
    import { loadChatDraft, scheduleSaveChatDraft, flushChatDraft, removeChatDraft } from 'src/ts/storage/chatDraft';
    import { blocksChatGeneration } from 'src/ts/risubard/wikiReboot';
    import {
        cancelWikiGeneration,
        isWikiGenerating,
    } from 'src/ts/risubard/wikiGenerationState';

    import Chats from './Chats.svelte';
    import Button from '../UI/GUI/Button.svelte';
    import PluginDefinedIcon from '../Others/PluginDefinedIcon.svelte';
    import PluginFloatingActionButtons from '../Others/PluginFloatingActionButtons.svelte';
    import SolarAssetIcon from '../UI/Icons/SolarAssetIcon.svelte';
    import RisuBardMemoryWiki from '../Others/RisuBardMemoryWiki.svelte';
    import ArcaChatLogDialog from './ArcaChatLogDialog.svelte'
    import RisuBardSaveLoadShortcuts from './RisuBardSaveLoadShortcuts.svelte';
    import type { StorySourceRef } from 'src/ts/risubard/storySoFar';
    import feedIcon from 'src/assets/solar-bold/feed-bold.svg';
    import loadIcon from 'src/assets/solar-bold/undo-left-square-bold.svg';
    import { getEffectivePersona, resolvePersonaById } from 'src/ts/personaScopes';
    import type { FloatingActionButtonPlacement } from 'src/ts/plugins/floatingActionButtonLayout';

    const loadPlaygroundMenu = () => import('../Playground/PlaygroundMenu.svelte').then(m => m.default);

    function setPluginFabPlacement(
        layoutKey: string,
        placement: FloatingActionButtonPlacement | null
    ) {
        const next = { ...(DBState.db.pluginFabPlacements ?? {}) }
        if (placement) next[layoutKey] = placement
        else delete next[layoutKey]
        DBState.db.pluginFabPlacements = next
    }

    // Whether an Enter keydown should send (vs insert a newline), based on the
    // per-platform send-key mode. Mobile uses sendKeyMobile, desktop sendKeyPC.
    function shouldSendOnEnter(e: KeyboardEvent): boolean {
        const mode = isMobile ? DBState.db.sendKeyMobile : DBState.db.sendKeyPC;
        // Match the configured combo EXACTLY — every other modifier must be absent,
        // so e.g. Alt+Enter or Ctrl+Shift+Enter inserts a newline instead of sending.
        switch (mode) {
            case 'enter': return !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey;
            case 'ctrl-enter': return (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey;
            case 'shift-enter': return e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey;
            default: return false; // 'button'
        }
    }

    interface Props {
        openModuleList?: boolean;
        openChatList?: boolean;
        customStyle?: string;
        onSaveChat?: () => void | Promise<void>;
        onOpenChatLoad?: () => void;
        onQuickSave?: () => void | Promise<void>;
        onQuickLoad?: () => void | Promise<void>;
        savingSlot?: boolean;
    }

    let messageInput:string = $state('')
    let messageInputTranslate:string = $state('')
    let openMenu = $state(false)
    let memoryWikiOpen = $state(false)
    let arcaChatLogOpen = $state(false)
    let chatPage = $state(0)
    let firstMessageCollapsed = $state(true)
    let paginationKey = $state('')
    let paginationMessageCount = $state(0)
    let paginationPageSize = $state(DEFAULT_CHAT_PAGE_SIZE)
    let doingChatInputTranslate = false
    let toggleStickers:boolean = $state(false)
    let fileInput:string[] = $state([])
    let showNewMessageButton = $state(false)
    let showScrollNav = $state(false)
    let scrollNavFocused = $state(false)
    let scrollNavTimer: ReturnType<typeof setTimeout> | null = null
    let pageJumpInput = $state<number | undefined>(1)
    let turnJumpInput = $state<number | undefined>(1)
    let jumpDisplayKey = ''
    let chatsInstance: any = $state()
    let chatScrollContainer: HTMLElement | undefined = $state()
    let isScrollingToMessage = $state(false)
    let currentScrollAnchor: ChatScrollAnchor | null = null
    let scrollAnchorCaptureTimer: ReturnType<typeof setTimeout> | null = null
    let scrollAnchorRestoreTimers: ReturnType<typeof setTimeout>[] = []
    let scrollAnchorMutationToken = 0
    let scrollAnchorFreezeUntil = 0
    let restoringScrollAnchor = false
    const SCROLL_ANCHOR_RESTORE_DELAYS = [0, 80, 180, 350, 700, 1300, 2100]
    let {
        openModuleList = $bindable(false),
        openChatList = $bindable(false),
        customStyle = '',
        onSaveChat = () => {},
        onOpenChatLoad = () => {},
        onQuickSave = () => {},
        onQuickLoad = () => {},
        savingSlot = false,
    }: Props = $props();
    let currentCharacter = $derived(DBState.db.characters[$selectedCharID])
    let currentChatSlot = $derived(currentCharacter?.chats[currentCharacter.chatPage])
    let wikiRebootBlocksGeneration = $derived(
        blocksChatGeneration(currentChatSlot?.risuBardWikiReboot)
    )
    let wikiBlocksGeneration = $derived(
        wikiRebootBlocksGeneration || $isWikiGenerating
    )
    let currentChatReady = $derived(!!currentChatSlot && !currentChatSlot._placeholder)
    let currentChat = $derived(currentChatReady ? currentChatSlot.message : [])
    let currentChatFmIndex = $derived(currentChatReady ? (currentChatSlot.fmIndex ?? -1) : -1)
    let chatPageSize = $derived(normalizeChatPageSize(DBState.db.chatPageSize))
    let chatBounds = $derived(getChatPageBounds(currentChat.length, chatPageSize, chatPage))
    let targetPageNumber = $derived(normalizeChatNavigationTarget(
        pageJumpInput,
        chatBounds.pageCount,
        chatBounds.page + 1,
    ))
    let targetPageBounds = $derived(getChatPageBounds(
        currentChat.length,
        chatPageSize,
        targetPageNumber - 1,
    ))
    let targetPageTurnNavigation = $derived(buildChatTurnNavigation(currentChat, targetPageBounds.start, targetPageBounds.end))

    $effect(() => {
        const nextKey = `${paginationKey}:${chatBounds.page}:${chatBounds.start}`
        untrack(() => {
            if (nextKey === jumpDisplayKey) return
            jumpDisplayKey = nextKey
            pageJumpInput = chatBounds.page + 1
            turnJumpInput = 1
        })
    })

    function clearScrollAnchorTimers() {
        if (scrollAnchorCaptureTimer) clearTimeout(scrollAnchorCaptureTimer)
        scrollAnchorCaptureTimer = null
        for (const timer of scrollAnchorRestoreTimers) clearTimeout(timer)
        scrollAnchorRestoreTimers = []
    }

    function captureCurrentScrollAnchor() {
        if (
            !DBState.db.preserveChatScrollPosition
            || !chatScrollContainer
            || restoringScrollAnchor
            || Date.now() < scrollAnchorFreezeUntil
        ) return
        currentScrollAnchor = captureChatScrollAnchor(
            chatScrollContainer,
            paginationKey,
            currentChat.length,
        )
    }

    function scheduleScrollAnchorCapture(delay = 55) {
        if (!DBState.db.preserveChatScrollPosition) return
        if (scrollAnchorCaptureTimer) clearTimeout(scrollAnchorCaptureTimer)
        scrollAnchorCaptureTimer = setTimeout(() => {
            scrollAnchorCaptureTimer = null
            captureCurrentScrollAnchor()
        }, delay)
    }

    function queueScrollAnchorRestore() {
        if (!DBState.db.preserveChatScrollPosition || !currentScrollAnchor) {
            scheduleScrollAnchorCapture(80)
            return
        }

        const snapshot = { ...currentScrollAnchor }
        const token = ++scrollAnchorMutationToken
        for (const timer of scrollAnchorRestoreTimers) clearTimeout(timer)
        scrollAnchorFreezeUntil = Date.now() + SCROLL_ANCHOR_RESTORE_DELAYS.at(-1)! + 50
        scrollAnchorRestoreTimers = SCROLL_ANCHOR_RESTORE_DELAYS.map((delay, index) =>
            setTimeout(() => {
                if (
                    token !== scrollAnchorMutationToken
                    || !DBState.db.preserveChatScrollPosition
                    || !chatScrollContainer
                ) return

                restoringScrollAnchor = true
                const result = restoreChatScrollAnchor(
                    chatScrollContainer,
                    snapshot,
                    paginationKey,
                    currentChat.length,
                )
                restoringScrollAnchor = false

                if (result === 'context-changed') {
                    scrollAnchorMutationToken += 1
                    return
                }
                if (index === SCROLL_ANCHOR_RESTORE_DELAYS.length - 1) {
                    scrollAnchorFreezeUntil = 0
                    scheduleScrollAnchorCapture(55)
                }
            }, delay),
        )
    }

    function handleDirectScrollInteraction() {
        scrollAnchorMutationToken += 1
        for (const timer of scrollAnchorRestoreTimers) clearTimeout(timer)
        scrollAnchorRestoreTimers = []
        scrollAnchorFreezeUntil = 0
        captureCurrentScrollAnchor()
    }

    $effect(() => {
        const container = chatScrollContainer
        const enabled = DBState.db.preserveChatScrollPosition
        const contextKey = paginationKey
        if (!container || !enabled || !contextKey) {
            currentScrollAnchor = null
            clearScrollAnchorTimers()
            return
        }

        const observer = new MutationObserver(() => queueScrollAnchorRestore())
        const handleMediaLoad = (event: Event) => {
            if (event.target instanceof HTMLImageElement || event.target instanceof HTMLVideoElement) {
                queueScrollAnchorRestore()
            }
        }
        observer.observe(container, { childList: true, subtree: true })
        container.addEventListener('load', handleMediaLoad, true)
        container.addEventListener('pointerdown', handleDirectScrollInteraction)
        container.addEventListener('wheel', handleDirectScrollInteraction)
        container.addEventListener('touchstart', handleDirectScrollInteraction)
        container.addEventListener('keydown', handleDirectScrollInteraction)
        scheduleScrollAnchorCapture(0)

        return () => {
            observer.disconnect()
            container.removeEventListener('load', handleMediaLoad, true)
            container.removeEventListener('pointerdown', handleDirectScrollInteraction)
            container.removeEventListener('wheel', handleDirectScrollInteraction)
            container.removeEventListener('touchstart', handleDirectScrollInteraction)
            container.removeEventListener('keydown', handleDirectScrollInteraction)
            scrollAnchorMutationToken += 1
            currentScrollAnchor = null
            clearScrollAnchorTimers()
            scrollAnchorFreezeUntil = 0
        }
    })

    async function restoreChatViewScroll(key: string, savedView: ChatViewSession) {
        await tick()
        if (paginationKey !== key || !chatScrollContainer) return
        chatScrollContainer.scrollTop = savedView.scrollTop
    }

    $effect(() => {
        const nextKey = `${currentCharacter?.chaId ?? ''}/${currentChatSlot?.id ?? ''}`
        const messageCount = currentChat.length
        const nextPageCount = getChatPageCount(messageCount, chatPageSize)
        const latestPage = nextPageCount - 1

        if (nextKey !== paginationKey) {
            paginationKey = nextKey
            firstMessageCollapsed = true
            const savedView = loadChatViewSession(nextKey)
            if (savedView) {
                chatPage = getChatPageBounds(messageCount, chatPageSize, savedView.page).page
                void restoreChatViewScroll(nextKey, savedView)
            } else {
                chatPage = latestPage
            }
        } else if (chatPageSize !== paginationPageSize) {
            const anchorIndex = chatPage * paginationPageSize
            chatPage = getChatPageForMessage(anchorIndex, messageCount, chatPageSize)
        } else {
            const previousLatestPage = getLatestChatPage(paginationMessageCount, paginationPageSize)
            if (chatPage === previousLatestPage && messageCount > paginationMessageCount) {
                chatPage = latestPage
            } else if (chatPage > latestPage) {
                chatPage = latestPage
            }
        }

        paginationMessageCount = messageCount
        paginationPageSize = chatPageSize
    })

    $effect(() => {
        const foldedIndex = chatFoldedStateMessageIndex.index
        if (foldedIndex >= 0) {
            chatPage = getChatPageForMessage(foldedIndex, currentChat.length, chatPageSize)
        }
    })

    // ─── Per-chat composer draft ────────────────────────────────────────────
    // The message input is kept per chat, stored outside the chat body, so it
    // survives unmounting the chat view (e.g. accidentally opening Settings while
    // composing a long message). Keyed by character + chat id.
    let draftChaId = $derived(currentCharacter?.chaId ?? '')
    let draftChatId = $derived(currentChatSlot?.id ?? '')
    let draftLoading = $state(false)

    function persistDraftNow() {
        flushChatDraft(draftChaId, draftChatId, { m: messageInput, t: messageInputTranslate })
    }

    // Load on chat enter (keyed by id, so no wait for hydration); flush the
    // latest text for the chat being left on switch / unmount.
    $effect(() => {
        const chaId = draftChaId
        const chatId = draftChatId
        if (!chaId || !chatId) return
        untrack(() => { messageInput = ''; messageInputTranslate = ''; draftLoading = true })
        let active = true
        ;(async () => {
            const draft = await loadChatDraft(chaId, chatId)
            if (!active) return
            untrack(() => {
                // Don't clobber text the user began typing during the load.
                if (draft && messageInput === '' && messageInputTranslate === '') {
                    messageInput = draft.m
                    messageInputTranslate = draft.t
                }
                draftLoading = false
            })
            // Resize the textarea to fit the cleared/loaded text (height is
            // updated imperatively, not reactively to messageInput).
            await tick()
            if (active) updateInputSizeAll()
        })()
        return () => {
            active = false
            flushChatDraft(chaId, chatId, {
                m: untrack(() => messageInput),
                t: untrack(() => messageInputTranslate),
            })
        }
    })

    // Debounced save while typing (each write is a network round-trip, so it is
    // coalesced). Suppressed during the initial load to avoid racing it.
    $effect(() => {
        const chaId = draftChaId
        const chatId = draftChatId
        const m = messageInput
        const t = messageInputTranslate
        if (!chaId || !chatId || draftLoading) return
        scheduleSaveChatDraft(chaId, chatId, { m, t })
    })

    // Best-effort persist on tab hide / unload (refresh, app switch): the
    // unmount cleanup above does not fire on a hard page teardown.
    $effect(() => {
        const onHide = () => { if (document.visibilityState === 'hidden') persistDraftNow() }
        const onPageHide = () => persistDraftNow()
        document.addEventListener('visibilitychange', onHide)
        window.addEventListener('pagehide', onPageHide)
        return () => {
            document.removeEventListener('visibilitychange', onHide)
            window.removeEventListener('pagehide', onPageHide)
        }
    })

    /** Await hydration of active chat. Returns full Chat or null on failure. */
    async function ensureActiveChatReady(selectedChar = $selectedCharID): Promise<ChatData | null> {
        const char = DBState.db.characters[selectedChar]
        if (!char) return null
        const chat = char.chats[char.chatPage]
        if (!chat) return null
        if (!chat._placeholder) return chat
        return await ensureCurrentChatReady(char.chats, char.chatPage, char.chaId)
    }

    function scrollToBottom() {
        chatsInstance?.scrollToLatestMessage();
    }

    async function navigateStorySource(source: StorySourceRef) {
        if (source.kind !== 'chat') return
        const index = currentChat.findIndex((message) =>
            source.messageIds.includes(message.chatId)
        )
        if (index < 0) return
        await scrollToMessage(index)
    }

    function bumpScrollNav() {
        showScrollNav = true
        if (scrollNavTimer) clearTimeout(scrollNavTimer)
        scrollNavTimer = null
        if (!scrollNavFocused && !DBState.db.pinChatScrollNavigator) {
            scrollNavTimer = setTimeout(() => { showScrollNav = false }, 1500)
        }
    }

    function holdScrollNav() {
        scrollNavFocused = true
        showScrollNav = true
        if (scrollNavTimer) clearTimeout(scrollNavTimer)
        scrollNavTimer = null
    }

    function releaseScrollNav() {
        scrollNavFocused = false
        bumpScrollNav()
    }

    function getLoadedMessages(container: HTMLElement) {
        return Array.from(container.querySelectorAll('[data-chat-index]'))
            .map(el => ({ el: el as HTMLElement, idx: parseInt(el.getAttribute('data-chat-index')!) }))
            .sort((a, b) => a.idx - b.idx)
    }

    function scrollToPageStart(behavior: ScrollBehavior = 'smooth') {
        const container = chatScrollContainer
        if (!container) return
        const pageStart = container.querySelector(`[data-chat-index="${chatBounds.start}"]`) as HTMLElement | null
        const target = pageStart ?? getLoadedMessages(container).find(message => message.idx >= chatBounds.start)?.el
        if (!target) return
        scrollWithinContainer(target, container, { block: 'start', behavior })
    }

    async function selectChatPage(page: number, scrollToLatest = false, behavior: ScrollBehavior = 'smooth') {
        chatPage = getChatPageBounds(currentChat.length, chatPageSize, page).page
        chatFoldedState.data = null
        await tick()
        if (scrollToLatest) chatsInstance?.scrollToLatestMessage()
        else scrollToPageStart(behavior)
    }

    async function jumpToPageTurn() {
        const page = targetPageNumber
        pageJumpInput = page
        if (targetPageTurnNavigation.turnCount === 0) {
            turnJumpInput = 1
            await selectChatPage(targetPageBounds.page, false, 'instant')
            return
        }
        const target = normalizeChatNavigationTarget(
            turnJumpInput,
            targetPageTurnNavigation.turnCount,
            1,
        )
        const messageIndex = targetPageTurnNavigation.messageIndexByTurn[target - 1]
        if (messageIndex !== undefined) await scrollToMessage(messageIndex)
        pageJumpInput = page
        turnJumpInput = target
    }

    // Literal bottom of the scroll (end of the latest message).
    function scrollToLoadedBottom() {
        const container = document.querySelector('.default-chat-screen') as HTMLElement | null
        if (!container) return
        const messages = getLoadedMessages(container)
        if (messages.length === 0) return
        scrollWithinContainer(messages[messages.length - 1].el, container, { block: 'end', behavior: 'smooth' })
    }

    function navigateMessage(direction: 'prev' | 'next') {
        const container = document.querySelector('.default-chat-screen') as HTMLElement | null
        if (!container) return
        const messages = Array.from(container.querySelectorAll('[data-chat-index]'))
            .map(el => ({ el: el as HTMLElement, idx: parseInt(el.getAttribute('data-chat-index')!) }))
            .sort((a, b) => a.idx - b.idx)
        if (messages.length === 0) return

        const containerRect = container.getBoundingClientRect()
        const threshold = 30

        // Find the message currently at the top of the viewport
        let current = messages[0]
        for (const msg of messages) {
            const rect = msg.el.getBoundingClientRect()
            if (rect.bottom > containerRect.top + threshold) {
                current = msg
                break
            }
        }

        const currentRect = current.el.getBoundingClientRect()

        if (direction === 'prev') {
            const topVisible = currentRect.top >= containerRect.top - threshold
            if (!topVisible) {
                // Current message top is hidden → scroll to its start
                scrollWithinContainer(current.el, container, { block: 'start', behavior: 'smooth' })
            } else {
                // Already at top → go to previous message start
                const prev = messages.find(m => m.idx === current.idx - 1)
                if (prev) {
                    scrollWithinContainer(prev.el, container, { block: 'start', behavior: 'smooth' })
                }
            }
        } else {
            const bottomVisible = currentRect.bottom <= containerRect.bottom + threshold
            if (!bottomVisible) {
                // Current message bottom is hidden → scroll to its end
                scrollWithinContainer(current.el, container, { block: 'end', behavior: 'smooth' })
            } else {
                // Already see the end → go to next message start
                const next = messages.find(m => m.idx === current.idx + 1)
                if (next) {
                    scrollWithinContainer(next.el, container, { block: 'start', behavior: 'smooth' })
                }
            }
        }
    }
    $effect(() => {
        if(ScrollToMessageStore.value !== -1){
            const index = ScrollToMessageStore.value
            ScrollToMessageStore.value = -1
            scrollToMessage(index)
        }
    })

    async function scrollToMessage(index: number){
        isScrollingToMessage = true
        try {
            chatPage = getChatPageForMessage(index, currentChat.length, chatPageSize)
            await tick()

            let element: Element | null = null;
            // Poll for element existence (max 5 seconds)
            for(let i = 0; i < 50; i++){
                element = document.querySelector(`[data-chat-index="${index}"]`)
                if(element) break;
                await sleep(100)
            }

            const chatContainer = document.querySelector('.default-chat-screen') as HTMLElement | null;
            const preIndex = Math.max(0, index - 3)
            const preElement = document.querySelector(`[data-chat-index="${preIndex}"]`)
            // Scroll within the chat container only — raw scrollIntoView climbs to
            // documentElement and, if the root is inflated, shoves the whole page up.
            if(chatContainer && preElement){
                scrollWithinContainer(preElement as HTMLElement, chatContainer, { block: 'start', behavior: 'instant' })
            } else if(chatContainer && element){
                scrollWithinContainer(element as HTMLElement, chatContainer, { block: 'start', behavior: 'instant' })
            }
            await sleep(50)

            if(element){
                // Wait for images to load to prevent layout shift
                if(chatContainer) {
                    const images = Array.from(chatContainer.querySelectorAll('img'));
                    const promises = images.map(img => {
                        if (img.complete) return Promise.resolve();
                        return new Promise(resolve => {
                            img.onload = () => resolve(null);
                            img.onerror = () => resolve(null);
                        });
                    });
                    // Wait for all images or timeout after 4 seconds
                    await Promise.race([
                        Promise.all(promises),
                        sleep(4000)
                    ]);
                }

                if(chatContainer){
                    scrollWithinContainer(element as HTMLElement, chatContainer, { block: 'start', behavior: 'instant' })
                    // Small delay and scroll again to ensure position is correct after any final layout adjustments
                    await sleep(50)
                    scrollWithinContainer(element as HTMLElement, chatContainer, { block: 'start', behavior: 'instant' })
                }

                element.classList.add('ring-2', 'ring-info')
                setTimeout(() => {
                    element.classList.remove('ring-2', 'ring-info')
                }, 2000)
            }
        } finally {
            isScrollingToMessage = false
        }
    }

    async function send(){
        return sendMain(false)
    }
    async function sendContinue(){
        return sendMain(true)
    }

    async function sendMain(continueResponse:boolean) {
        let selectedChar = $selectedCharID
        if($doingChat){
            return
        }
        if (wikiBlocksGeneration) {
            alertError($isWikiGenerating
                ? language.risuBardWikiGenerationChatLocked
                : language.risuBardWikiRebootChatLocked)
            return
        }

        const activeChat = await ensureActiveChatReady(selectedChar)
        if(!activeChat) return

        let cha = activeChat.message

        if(messageInput.startsWith('/')){
            const commandProcessed = await processMultiCommand(messageInput)
            if(commandProcessed !== false){
                messageInput = ''
                messageInputTranslate = ''
                removeChatDraft(draftChaId, draftChatId)
                return
            }
        }

        if(fileInput.length > 0){
            for(const file of fileInput){
                messageInput += `{{inlayed::${file}}}`
            }
            fileInput = []
        }

        if(messageInput === ''){
            if(cha.length === 0 || cha[cha.length - 1].role !== 'user'){
                if(DBState.db.useSayNothing){
                    cha.push({
                        role: 'user',
                        data: '*says nothing*',
                        name: null
                    })
                }
            }
        }
        else{
            const char = DBState.db.characters[selectedChar]
            if(char.type === 'character'){
                let triggerResult = await runTrigger(char,'input', {chat: activeChat})
                if(triggerResult){
                    cha = triggerResult.chat.message
                }

                cha.push({
                    role: 'user',
                    data: await processScript(char,messageInput,'editinput'),
                    time: Date.now(),
                    name: null
                })
            }
            else{
                cha.push({
                    role: 'user',
                    data: messageInput,
                    time: Date.now(),
                    name: null
                })
            }
        }
        messageInput = ''
        messageInputTranslate = ''
        removeChatDraft(draftChaId, draftChatId)
        DBState.db.characters[selectedChar].chats[DBState.db.characters[selectedChar].chatPage].message = cha
        chatPage = getLatestChatPage(cha.length, chatPageSize)

        await sleep(10)
        updateInputSizeAll()
        await sendChatMain(continueResponse)

    }

    // Fullscreen compose mode: the same messageInput, just shown in a full-screen
    // editor. Enter inserts a newline (no send); sending is via the Send button.
    let composerFullscreen = $state(false)
    let fullscreenEle:HTMLTextAreaElement = $state()
    $effect(() => {
        if (composerFullscreen && fullscreenEle) {
            const el = fullscreenEle
            requestAnimationFrame(() => {
                el.focus()
                el.selectionStart = el.selectionEnd = el.value.length
            })
        }
    })
    async function exitFullscreen(){
        composerFullscreen = false
        persistDraftNow()   // checkpoint the draft on return from the expanded composer
        await tick()   // let the inline composer re-measure with the latest text
        updateInputSizeAll()
        updateInputTransateMessage(false)
    }
    function sendFullscreen(){
        composerFullscreen = false
        send()
    }

    // With an empty input (and no attachments) and the last message being the
    // user's, pressing send doesn't add a new message — it regenerates a reply
    // to that last message. Surface that as a reroll affordance.
    const willResend = $derived.by(() => {
        if (messageInput !== '' || fileInput.length > 0) return false
        const cha = DBState.db.characters[$selectedCharID]
        if (!cha) return false
        const msgs = cha.chats?.[cha.chatPage]?.message
        if (!msgs || msgs.length === 0) return false
        return msgs[msgs.length - 1].role === 'user'
    })

    function getLastCharMsg() {
        const msgs = DBState.db.characters[$selectedCharID]?.chats[DBState.db.characters[$selectedCharID].chatPage]?.message
        if (!msgs || msgs.length === 0) return null
        for (let i = msgs.length - 1; i >= 0; i--) {
            if (msgs[i].role === 'char' && !msgs[i].isComment && !msgs[i].disabled) return msgs[i]
        }
        return null
    }

    async function reroll() {
        if($doingChat) return
        if (wikiBlocksGeneration) {
            alertError($isWikiGenerating
                ? language.risuBardWikiGenerationChatLocked
                : language.risuBardWikiRebootChatLocked)
            return
        }
        const lastMsg = getLastCharMsg()
        if (!lastMsg) return

        // Save existing swipes before clone replaces the array
        const savedSwipes = lastMsg.swipes ? [...lastMsg.swipes] : [lastMsg.data]

        // Generate new response
        // Preserve trailing comment/disabled messages (e.g. branch comments)
        let cha = safeStructuredClone(DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage].message)
        const originalMessages = safeStructuredClone(cha)
        if(cha.length === 0) return
        openMenu = false

        const trailingComments = []
        while(cha.length > 0 && (cha[cha.length - 1].isComment || cha[cha.length - 1].disabled)) {
            trailingComments.unshift(cha.pop())
        }

        if(cha.length === 0) return
        const saying = cha[cha.length - 1].saying
        let sayingQu = 2
        while(cha[cha.length - 1].role !== 'user'){
            if(cha[cha.length - 1].saying === saying){
                sayingQu -= 1
                if(sayingQu === 0) break
            }
            let msg = cha.pop()
            if(!msg) return
        }
        DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage].message = cha
        const generated = await sendChatMain()

        const currentMsgs = DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage].message

        // If generation failed, restore original messages
        if (!generated) {
            DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage].message = originalMessages
            return
        }

        // Restore trailing comments after the new message
        if (trailingComments.length > 0) {
            currentMsgs.push(...trailingComments)
            DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage].message = currentMsgs
        }

        // Save new response to swipes
        const newLastMsg = getLastCharMsg()
        if (newLastMsg && !newLastMsg.swipes) {
            newLastMsg.swipes = [...savedSwipes, newLastMsg.data]
            newLastMsg.swipeId = newLastMsg.swipes.length - 1
        }
    }

    async function unReroll() {
        if($doingChat) return
        const lastMsg = getLastCharMsg()
        if (!lastMsg || !lastMsg.swipes || lastMsg.swipeId === undefined) return

        lastMsg.swipeId = lastMsg.swipeId <= 0 ? lastMsg.swipes.length - 1 : lastMsg.swipeId - 1
        lastMsg.data = lastMsg.swipes[lastMsg.swipeId]
        DBState.db.characters[$selectedCharID].reloadKeys += 1
    }

    function nextSwipe() {
        const lastMsg = getLastCharMsg()
        if (!lastMsg || !lastMsg.swipes || lastMsg.swipeId === undefined) return

        lastMsg.swipeId = lastMsg.swipeId >= lastMsg.swipes.length - 1 ? 0 : lastMsg.swipeId + 1
        lastMsg.data = lastMsg.swipes[lastMsg.swipeId]
        DBState.db.characters[$selectedCharID].reloadKeys += 1
    }

    function deleteSwipe() {
        const lastMsg = getLastCharMsg()
        if (!lastMsg || !lastMsg.swipes || lastMsg.swipes.length <= 1) return

        const idx = lastMsg.swipeId ?? 0
        lastMsg.swipes.splice(idx, 1)

        if (idx >= lastMsg.swipes.length) {
            lastMsg.swipeId = lastMsg.swipes.length - 1
        }
        lastMsg.data = lastMsg.swipes[lastMsg.swipeId]

        if (lastMsg.swipes.length === 1) {
            delete lastMsg.swipes
            delete lastMsg.swipeId
        }
        DBState.db.characters[$selectedCharID].reloadKeys += 1
    }

    // The abort controller lives in the per-chat generation-state registry so
    // the Stop button aborts the generation of the chat it is shown for (not
    // whatever this screen instance last started). See generationState.ts.
    function currentChatGenKey(){
        const char = DBState.db.characters[$selectedCharID]
        return chatGenKey(char?.chats?.[char.chatPage]?.id)
    }

    // Stop affordance is per-chat: shown when the CURRENTLY SELECTED chat has
    // a generation entry (live or background), so the button always targets
    // the chat it is rendered for — generate in A, switch to B, and B shows
    // Send while A (revisited) still shows a working Stop. Recomputes on chat
    // switch because currentChatGenKey reads the selected char/chatPage.
    let currentChatGenerating = $derived($generationStates.has(currentChatGenKey()))

    async function sendChatMain(continued:boolean = false) {

        messageInput = ''
        if (wikiBlocksGeneration) return false
        const genKey = currentChatGenKey()
        // Mirror sendChat's per-chat guard BEFORE any side effects: a blocked
        // send must not run the unconditional conclude below, which would tear
        // down the RUNNING generation's guard entry and tombstone (e.g. Enter
        // pressed while an auto-resume is streaming).
        if ($generationStates.has(genKey)) {
            return false
        }
        const abortController = new AbortController()
        registerAbort(genKey, abortController)
        let generated = false
        try {
            generated = await sendChat(-1, {
                signal:abortController.signal,
                continue:continued
            })
        } catch (error) {
            console.error(error)
            alertError(error)
        }
        endGeneration(genKey)
        // Send concluded on THIS client (success, failure or abort alike) —
        // drop the resumable-send tombstone so no later boot re-runs it.
        clearPendingSend(genKey)
        if(DBState.db.playMessage){
            playNotificationSound(DBState.db.messageSound, DBState.db.messageSoundVolume)
        }
        return generated
    }

    // Auto-resume of an interrupted send (pendingSends.ts): discovery flags a
    // chat whose send died mid-pipeline with no recoverable response; opening
    // that chat re-runs the send once, as if the user pressed send again on
    // the same conversation tail. Unlike sendChatMain this must NOT touch
    // messageInput (a typed draft survives) and adds no new user message —
    // the original one is already the chat's last message.
    //
    // Everything is revalidated at execution time (a macrotask after the
    // effect): the selection must still point at the flagged chat, nothing may
    // be generating, the chat must still end on the user's turn, and the
    // server-side CLAIM must succeed — the atomic claim is what makes the
    // re-run at-most-once across devices, tabs and reloads.
    async function resumeInterruptedSend(chatId: string) {
        if (wikiBlocksGeneration) {
            markResumable(chatId)
            return
        }
        if (currentChatGenKey() !== chatId || $generationStates.has(chatId)) {
            // Not runnable right now (selection moved / something generating)
            // but not concluded either — restore the flag so returning to the
            // chat can retry without waiting for another discovery pass (and
            // without a duplicate notice).
            markResumable(chatId)
            return
        }
        const char = DBState.db.characters[$selectedCharID]
        const chat = char?.chats?.[char.chatPage]
        const last = chat?.message?.[chat.message.length - 1]
        if (!last || last.role !== 'user') return        // tail changed — concluded
        if (!await claimPendingSend(chatId)) return      // another client won (or server unreachable)
        if (currentChatGenKey() !== chatId || $generationStates.has(chatId)) return
        const abortController = new AbortController()
        registerAbort(chatId, abortController)
        try {
            await sendChat(-1, { signal: abortController.signal })
        } catch (error) {
            console.error(error)
        }
        endGeneration(chatId)
        clearPendingSend(chatId)
    }

    // One-shot via takeResumable; the timeout escapes the effect before the
    // send mutates tracked state.
    $effect(() => {
        const char = DBState.db.characters[$selectedCharID]
        const chatId = char?.chats?.[char.chatPage]?.id
        if (!chatId || !$resumableSends.has(chatId)) return
        if ($generationStates.has(chatGenKey(chatId))) return
        if (!takeResumable(chatId)) return
        setTimeout(() => { void resumeInterruptedSend(chatId) }, 0)
    })

    function abortChat(){
        abortGeneration(currentChatGenKey())
    }

    let { userIconPortrait, currentUsername, userIcon } = $derived.by(() => {
        const character = DBState.db.characters[$selectedCharID]
        const chat = character?.chats?.[character.chatPage]
        const bound = resolvePersonaById(DBState.db, character, chat?.bindedPersona)
        const effective = bound ?? getEffectivePersona(DBState.db, character, chat)
        const persona = effective?.persona
        return {
            currentUsername: persona?.name ?? DBState.db.username,
            userIconPortrait: persona?.largePortrait ?? false,
            userIcon: persona?.icon ?? DBState.db.userIcon,
        }
    })

    let inputHeight = $state("44px")
    let multiline = $state(false)
    let inputOverflow = $state(false)
    let inputEle:HTMLTextAreaElement = $state()
    let inputTranslateHeight = $state("44px")
    let inputTranslateEle:HTMLTextAreaElement = $state()

    // Standard theme: composer width follows the configured chat width (matches message cards).
    // Other themes: no width limit (original full-width behavior).
    let isStandardTheme = $derived(DBState.db.theme === '')
    let composerWidthClass = $derived(
        !isStandardTheme ? '' :
        DBState.db.nodeOnlyStandardChatWidth === 'full' ? 'max-w-full' :
        DBState.db.nodeOnlyStandardChatWidth === 'wide' ? 'max-w-6xl' :
        'max-w-3xl'
    )
    // Effective persona name for the input placeholder (chat-bound persona overrides the selected one).
    let activePersonaName = $derived.by(() => {
        const character = DBState.db.characters[$selectedCharID]
        const chat = character?.chats?.[character.chatPage]
        return getEffectivePersona(DBState.db, character, chat)?.persona.name || 'User'
    })

    function updateInputSizeAll() {
        updateInputSize()
        updateInputTranslateSize()
    }

    function updateInputTranslateSize() {
        if(inputTranslateEle) {
            inputTranslateEle.style.height = "0";
            inputTranslateHeight = (inputTranslateEle.scrollHeight) + "px";
            inputTranslateEle.style.height = inputTranslateHeight
        }
    }
    // Measure the textarea's content height at a given css width (empty = current
    // flex width), restoring the override afterwards.
    function measureHeightAt(cssWidth:string):number {
        const prev = inputEle.style.width
        inputEle.style.height = "0"
        if(cssWidth) inputEle.style.width = cssWidth
        const h = inputEle.scrollHeight
        inputEle.style.width = prev
        return h
    }

    // Width the textarea would have on a single inline row (pill content minus the
    // icon buttons and gaps). Computed from layout-independent sizes — the pill is
    // always full width and the icons are fixed-size — so it does NOT depend on the
    // current `multiline` state. That's what stops the 1↔2 line flip-flop.
    function inlineColWidth():number {
        const pill = inputEle.parentElement
        if(!pill) return 0
        const cs = getComputedStyle(pill)
        const padX = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0)
        const gap = parseFloat(cs.columnGap || cs.gap || '0') || 0
        let used = 0, others = 0
        for(const c of Array.from(pill.children) as HTMLElement[]){
            if(c === inputEle) continue
            used += c.offsetWidth
            others++
        }
        return pill.clientWidth - padX - used - gap * others
    }

    function updateInputSize() {
        if(inputEle){
            const col = inlineColWidth()
            const ref = col > 0 ? col + "px" : ""
            // Gemini-style hysteresis: once the text grows past one line it stays
            // multiline until the input is fully cleared. Reflow is therefore a
            // one-way latch (cleared only on empty), so the layout toggle can never
            // feed back into the width measurement and flip-flop 1↔2 lines.
            if(messageInput === ''){
                multiline = false
            } else if(!multiline && measureHeightAt(ref) > 50){
                multiline = true
            }
            // Height for the width that will actually be shown.
            const sh = measureHeightAt(multiline ? "100%" : ref)
            // Cap the composer at ~60% of the viewport; beyond that it scrolls.
            const maxH = Math.round(window.innerHeight * 0.6)
            inputHeight = Math.min(sh, maxH) + "px"
            inputEle.style.height = inputHeight
            inputOverflow = sh > maxH
        }
    }

    $effect.pre(() => {
        updateInputSizeAll()
    });

    async function updateInputTransateMessage(reverse: boolean) {
        if(!DBState.db.useAutoTranslateInput){
            return
        }
        if(isExpTranslator()){
            if(!reverse){
                messageInputTranslate = ''
                return
            }
            if(messageInputTranslate === '') {
                messageInput = ''
                return
            }
            const lastMessageInputTranslate = messageInputTranslate
            await sleep(1500)
            if(lastMessageInputTranslate === messageInputTranslate){
                translate(reverse ? messageInputTranslate : messageInput, reverse).then((translatedMessage) => {
                    if(translatedMessage){
                        if(reverse)
                            messageInput = translatedMessage
                        else
                            messageInputTranslate = translatedMessage
                    }
                })
            }
            return

        }
        if(reverse && messageInputTranslate === '') {
            messageInput = ''
            return
        }
        if(!reverse && messageInput === '') {
            messageInputTranslate = ''
            return
        }
        translate(reverse ? messageInputTranslate : messageInput, reverse).then((translatedMessage) => {
            if(translatedMessage){
                if(reverse)
                    messageInput = translatedMessage
                else
                    messageInputTranslate = translatedMessage
            }
        })
    }

    async function screenShot(){
        try {
            const html2canvas = await import('html-to-image');
            const chats = document.querySelectorAll('.default-chat-screen .risu-chat')
            alertWait("Taking screenShot...")
            let canvases:HTMLCanvasElement[] = []

            for(const chat of chats){
                const cnv = await html2canvas.toCanvas(chat as HTMLElement)
                alertWait("Taking screenShot... "+canvases.length+"/"+chats.length)
                canvases.push(cnv)
            }

            canvases.reverse()

            alertWait("Merging images...")

            let mergedCanvas = document.createElement('canvas');
            mergedCanvas.width = 0;
            mergedCanvas.height = 0;
            let mergedCtx = mergedCanvas.getContext('2d');

            let totalHeight = 0;
            let maxWidth = 0;
            for(let i = 0; i < canvases.length; i++) {
                let canvas = canvases[i];
                totalHeight += canvas.height;
                maxWidth = Math.max(maxWidth, canvas.width);

                mergedCanvas.width = maxWidth;
                mergedCanvas.height = totalHeight;
            }

            mergedCtx.fillStyle = 'var(--risu-theme-bgcolor)'
            mergedCtx.fillRect(0, 0, maxWidth, totalHeight);
            let indh = 0
            for(let i = 0; i < canvases.length; i++) {
                let canvas = canvases[i];
                indh += canvas.height
                mergedCtx.drawImage(canvas, 0, indh - canvas.height);
                canvases[i].remove();
            }

            if(mergedCanvas){
                await downloadFile(`chat-page-${chatBounds.page + 1}-${v4()}.png`, Buffer.from(mergedCanvas.toDataURL('png').split(',').at(-1), 'base64'))
                mergedCanvas.remove();
            }
            notifySuccess(language.screenshotSaved)
        } catch (error) {
            console.error(error)
            notifyError("Error while taking screenshot")
        }
    }

    
</script>



<div class="w-full h-full relative flex overflow-hidden" data-chat-wiki-workspace style={customStyle}>
    <main class="relative z-0 h-full min-w-0 flex-1" data-chat-pane>
    
    {#if DBState.db.nodeOnlyScrollButtonType !== 'off' && currentChat.length > 0}
        <div
            class="absolute right-3 bottom-16 z-40 flex min-w-16 flex-col overflow-hidden rounded-lg border border-darkborderc border-opacity-30 bg-bgcolor/90 shadow-lg backdrop-blur-sm transition-opacity duration-300"
            class:opacity-0={!DBState.db.pinChatScrollNavigator && !showScrollNav && !scrollNavFocused}
            class:pointer-events-none={!DBState.db.pinChatScrollNavigator && !showScrollNav && !scrollNavFocused}
            onfocusin={holdScrollNav}
            onfocusout={releaseScrollNav}
        >
            {#if DBState.db.nodeOnlyScrollButtonType === 'four'}
            <button
                data-chat-page-top
                type="button"
                class="h-9 w-full text-textcolor2 hover:text-textcolor hover:bg-darkbg/50 flex items-center justify-center transition-colors"
                title={language.chatPageTop}
                aria-label={language.chatPageTop}
                onclick={() => { bumpScrollNav(); scrollToPageStart() }}
            >
                <ChevronsUpIcon size={18} />
            </button>
            <div class="border-t border-darkborderc border-opacity-30"></div>
            {/if}
            <button
                data-chat-message-previous
                type="button"
                class="h-9 w-full text-textcolor2 hover:text-textcolor hover:bg-darkbg/50 flex items-center justify-center transition-colors"
                title={language.chatMessagePrevious}
                aria-label={language.chatMessagePrevious}
                onclick={() => { bumpScrollNav(); navigateMessage('prev') }}
            >
                <ChevronUpIcon size={18} />
            </button>
            <div class="border-t border-darkborderc border-opacity-30"></div>
            <button
                data-chat-message-next
                type="button"
                class="h-9 w-full text-textcolor2 hover:text-textcolor hover:bg-darkbg/50 flex items-center justify-center transition-colors"
                title={language.chatMessageNext}
                aria-label={language.chatMessageNext}
                onclick={() => { bumpScrollNav(); navigateMessage('next') }}
            >
                <ChevronDownIcon size={18} />
            </button>
            {#if DBState.db.nodeOnlyScrollButtonType === 'four'}
            <div class="border-t border-darkborderc border-opacity-30"></div>
            <button
                data-chat-page-bottom
                type="button"
                class="h-9 w-full text-textcolor2 hover:text-textcolor hover:bg-darkbg/50 flex items-center justify-center transition-colors"
                title={language.chatPageBottom}
                aria-label={language.chatPageBottom}
                onclick={() => { bumpScrollNav(); scrollToLoadedBottom() }}
            >
                <ChevronsDownIcon size={18} />
            </button>
            {/if}
        </div>
    {/if}

    {#if showNewMessageButton}
        {#if (DBState.db.newMessageButtonStyle === 'bottom-center' || !DBState.db.newMessageButtonStyle)}
            <button class="absolute bottom-16 left-1/2 -translate-x-1/2 bg-primary text-accenttext px-4 py-2 rounded-full shadow-lg z-50 flex items-center gap-2 hover:bg-primary/90 transition-colors" onclick={scrollToBottom}>
                <ArrowDown size={16} />
                <span>{language.newMessage}</span>
            </button>
        {/if}

        {#if DBState.db.newMessageButtonStyle === 'bottom-right'}
            <button class="absolute bottom-20 right-4 bg-primary text-accenttext px-4 py-2 rounded-full shadow-lg z-50 flex items-center gap-2 hover:bg-primary/90 transition-colors" onclick={scrollToBottom}>
                <ArrowDown size={16} />
                <span>{language.newMessage}</span>
            </button>
        {/if}

        {#if DBState.db.newMessageButtonStyle === 'bottom-left'}
            <button class="absolute bottom-20 left-4 bg-primary text-accenttext px-4 py-2 rounded-full shadow-lg z-50 flex items-center gap-2 hover:bg-primary/90 transition-colors" onclick={scrollToBottom}>
                <ArrowDown size={16} />
                <span>{language.newMessage}</span>
            </button>
        {/if}

        {#if DBState.db.newMessageButtonStyle === 'floating-circle'}
            <button class="absolute bottom-36 right-4 bg-primary text-accenttext w-12 h-12 rounded-full shadow-lg z-50 flex items-center justify-center hover:bg-primary/90 transition-colors" onclick={scrollToBottom} title="4. 원형 (우하단)">
                <ArrowDown size={20} />
            </button>
        {/if}

        {#if DBState.db.newMessageButtonStyle === 'right-center'}
            <button class="absolute top-1/2 right-2 -translate-y-1/2 bg-primary text-accenttext px-2 py-3 rounded-l-lg shadow-lg z-50 flex flex-col items-center gap-1 hover:bg-primary/90 transition-colors" onclick={scrollToBottom}>
                <ArrowDown size={14} />
                <span class="text-xs writing-mode-vertical">{language.newMessage}</span>
            </button>
        {/if}

        {#if DBState.db.newMessageButtonStyle === 'top-bar'}
            <button class="absolute top-2 left-1/2 -translate-x-1/2 bg-primary text-accenttext px-6 py-1.5 rounded-full shadow-lg z-50 flex items-center gap-2 hover:bg-primary/90 transition-colors text-sm" onclick={scrollToBottom}>
                <ArrowDown size={14} />
                <span>{language.newMessage}</span>
            </button>
        {/if}
    {/if}
    {#if isScrollingToMessage}
        <div class="absolute inset-0 z-50 flex items-center justify-center bg-overlay/50 text-media-text text-xl font-bold backdrop-blur-sm">
            Loading...
        </div>
    {/if}
    {#if $selectedCharID < 0}
        {#if $PlaygroundStore === 0}
            <MainMenu />
        {:else}
            {#await loadPlaygroundMenu() then PlaygroundMenu}
                <PlaygroundMenu />
            {/await}
        {/if}
    {:else if $chatDeselected}
        <div class="h-full w-full flex items-center justify-center text-textcolor2">
            <span>{language.selectChatToView}</span>
        </div>
    {:else}
        {#snippet composerCluster()}
            <div
                    class="{DBState.db.fixedChatTextarea ? 'sticky pt-2 pb-2 right-0 bottom-0 bg-bgcolor' : 'mt-2 mb-2'} w-full"
                    style="{DBState.db.fixedChatTextarea ? 'z-index:29;' : ''}"
            >
              <div class="mx-auto w-full {composerWidthClass} px-2">
                {#if currentCharacter?.chaId
                    && currentCharacter.chaId !== '§playground'
                    && !$chatDeselected
                    && DBState.db.showRisuBardSaveLoadShortcuts !== false}
                    <div data-composer-save-toolbar>
                        <RisuBardSaveLoadShortcuts
                            saving={savingSlot}
                            onSave={onSaveChat}
                            onLoad={onOpenChatLoad}
                            {onQuickSave}
                            {onQuickLoad}
                            bind:page={pageJumpInput}
                            bind:turn={turnJumpInput}
                            pageCount={chatBounds.pageCount}
                            turnCount={targetPageTurnNavigation.turnCount}
                            onJump={jumpToPageTurn}
                        />
                    </div>
                {/if}
                <!-- "plugin-compat-items-stretch" is a compat hook (not a Tailwind class):
                     plugins that locate the composer via div[class*="items-stretch"] (e.g. gemini-cache-keeper)
                     relied on the pre-redesign container class. Keep it so they can still find/anchor their UI,
                     and it scopes the timer re-flow rules in <style> below. -->
                <div class="flex flex-wrap items-center gap-1 rounded-3xl border border-darkborderc bg-bgcolor px-2 py-1.5 transition-colors focus-within:border-textcolor plugin-compat-items-stretch">
                {#if DBState.db.characters[$selectedCharID]?.chaId !== '§playground'}
                    <ShDropdownMenu bind:open={openMenu}>
                        <ShDropdownMenuTrigger>
                            {#snippet child({ props })}
                                <button {...props}
                                        aria-label="menu"
                                        class="shrink-0 flex justify-center items-center w-9 h-9 rounded-full text-textcolor hover:bg-primary/20 transition-colors">
                                    <MenuIcon size={20} />
                                </button>
                            {/snippet}
                        </ShDropdownMenuTrigger>
                        <ShDropdownMenuContent side="top" align="start" class="min-w-48 max-h-[70vh] overflow-y-auto">
                            {#if DBState.db.characters[$selectedCharID].ttsMode === 'webspeech' || DBState.db.characters[$selectedCharID].ttsMode === 'elevenlab'}
                                <ShDropdownMenuItem onSelect={() => stopTTS()}>
                                    <MicOffIcon /><span>{language.ttsStop}</span>
                                </ShDropdownMenuItem>
                            {/if}
                            <ShDropdownMenuItem
                                disabled={(DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage].message.length < 2) || (DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage].message[DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage].message.length - 1].role !== 'char')}
                                onSelect={() => sendContinue()}>
                                <StepForwardIcon /><span>{language.continueResponse}</span>
                            </ShDropdownMenuItem>
                            <ShDropdownMenuItem data-composer-save-chat disabled={savingSlot} onSelect={() => void onSaveChat()}>
                                <SolarAssetIcon src={feedIcon} name="feed-bold" size={18} />
                                <span>{language.saveChatFileAction}</span>
                            </ShDropdownMenuItem>
                            <ShDropdownMenuItem data-composer-load-chat onSelect={onOpenChatLoad}>
                                <SolarAssetIcon src={loadIcon} name="undo-left-square-bold" size={18} />
                                <span>{language.loadChatFileAction}</span>
                            </ShDropdownMenuItem>
                            {#if DBState.db.showMenuChatList}
                                <ShDropdownMenuItem onSelect={() => { openChatList = true }}>
                                    <DatabaseIcon /><span>{language.chatList}</span>
                                </ShDropdownMenuItem>
                            {/if}
                            <ShDropdownMenuItem data-open-arca-chat-log disabled={!currentChatReady}
                                onSelect={() => { arcaChatLogOpen = true }}>
                                <FileTextIcon /><span>{language.arcaChatLog.menu}</span>
                            </ShDropdownMenuItem>
                            {#each additionalChatMenu as menu}
                                <ShDropdownMenuItem onSelect={() => { menu.callback() }}>
                                    <PluginDefinedIcon ico={menu} /><span>{menu.name}</span>
                                </ShDropdownMenuItem>
                            {/each}
                            {#if DBState.db.showMenuHypaMemoryModal && DBState.db.hypaV3}
                                <ShDropdownMenuItem onSelect={() => { $hypaV3ModalOpen = true }}>
                                    <BrainIcon /><span>{language.hypaMemoryV3Modal}</span>
                                </ShDropdownMenuItem>
                            {/if}
                            <ShDropdownMenuItem onSelect={() => { memoryWikiOpen = true }}>
                                <BookOpenIcon /><span>{language.risuBardMemoryWiki}</span>
                            </ShDropdownMenuItem>
                            {#if DBState.db.translator !== ''}
                                <ShDropdownMenuItem class={DBState.db.useAutoTranslateInput ? 'text-success' : ''} onSelect={() => { DBState.db.useAutoTranslateInput = !DBState.db.useAutoTranslateInput }}>
                                    <GlobeIcon /><span>{language.autoTranslateInput}</span>
                                </ShDropdownMenuItem>
                            {/if}
                            <ShDropdownMenuItem onSelect={() => { screenShot() }}>
                                <CameraIcon /><span>{language.screenshot}</span>
                            </ShDropdownMenuItem>
                            <ShDropdownMenuItem onSelect={async () => {
                                const results = await postChatFile(messageInput)
                                if(!results) return
                                for(const res of results){
                                    if(res?.type === 'asset'){
                                        fileInput.push(res.data)
                                    }
                                    if(res?.type === 'text'){
                                        messageInput += `{{file::${res.name}::${res.data}}}`
                                    }
                                }
                                updateInputSizeAll()
                            }}>
                                <ImagePlusIcon /><span>{language.postFile}</span>
                            </ShDropdownMenuItem>
                            <ShDropdownMenuItem class={DBState.db.useAutoSuggestions ? 'text-success' : ''} onSelect={() => { DBState.db.useAutoSuggestions = !DBState.db.useAutoSuggestions }}>
                                <ReplyIcon /><span>{language.autoSuggest}</span>
                            </ShDropdownMenuItem>
                            <ShDropdownMenuItem onSelect={() => {
                                openModuleList = true
                            }}>
                                <PackageIcon /><span>{language.modules}</span>
                            </ShDropdownMenuItem>
                            {#if DBState.db.sideMenuRerollButton}
                                <ShDropdownMenuItem onSelect={() => { reroll() }}>
                                    <RefreshCcwIcon /><span>{language.reroll}</span>
                                </ShDropdownMenuItem>
                            {/if}
                            <ShDropdownMenuItem onSelect={() => { quickMenu() }}>
                                <ZapIcon /><span>{language.hotkeyDesc.quickMenu}</span>
                            </ShDropdownMenuItem>
                        </ShDropdownMenuContent>
                    </ShDropdownMenu>
                {:else}
                    <button type="button" aria-label={language.add} onclick={() => {
                        DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage].message.push({
                            role: 'char',
                            data: ''
                        })
                        DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage] = DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage]
                    }}
                         class="shrink-0 flex justify-center items-center w-9 h-9 rounded-full text-textcolor hover:bg-primary/20 transition-colors cursor-pointer"
                    >
                        <Plus size={20} />
                    </button>
                {/if}

                {#if DBState.db.useChatSticker}
                    <button type="button" aria-label={language.useChatSticker} onclick={()=>{toggleStickers = !toggleStickers}}
                         class={"shrink-0 flex justify-center items-center w-9 h-9 rounded-full hover:bg-primary/20 transition-colors cursor-pointer "+(toggleStickers ? 'text-success':'text-textcolor')}>
                        <Laugh size={20}/>
                    </button>
                {/if}

                <textarea class="text-input-area outline-hidden text-textcolor px-2 py-1.5 min-w-0 bg-transparent input-text text-base resize-none overflow-x-hidden max-w-full"
                          class:flex-1={!multiline}
                          class:basis-full={multiline}
                          class:order-first={multiline}
                          class:overflow-y-auto={inputOverflow}
                          class:overflow-y-hidden={!inputOverflow}
                          placeholder={willResend ? language.resendLastMessage : language.enterMessageToPersona(activePersonaName)}
                          bind:value={messageInput}
                          bind:this={inputEle}
                          onkeydown={(e) => {
                        if(e.key.toLocaleLowerCase() === "enter" && !e.isComposing){
                            if(shouldSendOnEnter(e)){
                                send()
                                e.preventDefault()
                            }
                        }
                        if(e.key.toLocaleLowerCase() === "m" && (e.ctrlKey)){
                            reroll()
                            e.preventDefault()
                        }
                    }}
                          onpaste={(e) => {
                        const items = e.clipboardData?.items
                        if(!items){
                            return
                        }
                        let canceled = false

                        for(const item of items){
                            if(item.kind === 'file' && item.type.startsWith('image')){
                                if(!canceled){
                                    e.preventDefault()
                                    canceled = true
                                }
                                const file = item.getAsFile()
                                if(file){
                                    const reader = new FileReader()
                                    reader.onload = async (e) => {
                                        const buf = e.target?.result as ArrayBuffer
                                        const uint8 = new Uint8Array(buf)
                                        const results = await postChatFile({
                                            name: file.name,
                                            data: uint8
                                        })
                                        if(!results) return
                                        for(const res of results){
                                            if(res?.type === 'asset'){
                                                fileInput.push(res.data)
                                            }
                                            if(res?.type === 'text'){
                                                messageInput += `{{file::${res.name}::${res.data}}}`
                                            }
                                        }
                                        updateInputSizeAll()
                                    }
                                    reader.readAsArrayBuffer(file)
                                }
                            }
                        }
                    }}
                          oninput={()=>{updateInputSizeAll();updateInputTransateMessage(false)}}
                          onblur={persistDraftNow}
                          style:height={inputHeight}
                ></textarea>

                <button
                        onclick={() => composerFullscreen = true}
                        aria-label={language.chatInputExpandTitle}
                        class="composer-expand-btn order-1 shrink-0 flex justify-center items-center w-9 h-9 rounded-full text-textcolor hover:bg-primary/20 transition-colors"
                        class:ml-auto={multiline}
                >
                    <Maximize2 size={18} />
                </button>

                {#if currentChatGenerating || doingChatInputTranslate}
                    <button
                            aria-labelledby="cancel"
                            class="order-2 shrink-0 flex justify-center items-center w-9 h-9 rounded-full text-textcolor hover:bg-primary/20 transition-colors" onclick={abortChat}
                    >
                        <div class="loadmove chat-process-stage-{$chatProcessStage}"></div>
                    </button>
                {:else}
                    <button
                            onclick={send}
                            disabled={wikiBlocksGeneration}
                            title={wikiBlocksGeneration
                                ? ($isWikiGenerating
                                    ? language.risuBardWikiGenerationChatLocked
                                    : language.risuBardWikiRebootChatLocked)
                                : undefined}
                            aria-label={willResend ? language.reroll : language.send}
                            class="order-2 shrink-0 flex justify-center items-center w-9 h-9 rounded-full bg-primary text-accenttext hover:bg-primary/80 transition-colors button-icon-send disabled:opacity-45 disabled:cursor-not-allowed"
                    >
                        {#if willResend}
                            <RefreshCcwIcon size={18} />
                        {:else}
                            <Send size={18} />
                        {/if}
                    </button>
                {/if}

                {#if currentCharacter?.chaId !== '§playground' && currentCharacter?.chaId && currentChatSlot?.id}
                    <div class="relative order-3 shrink-0 flex items-center h-9" data-risubard-wiki-controls>
                        {#if $isWikiGenerating}
                            <button
                                    type="button"
                                    data-risubard-wiki-cancel
                                    onclick={cancelWikiGeneration}
                                    aria-label={language.risuBardWikiCancel}
                                    title={language.risuBardWikiCancel}
                                    class="absolute bottom-[calc(100%+6px)] right-0 z-30 whitespace-nowrap rounded-md border border-danger/70 bg-danger px-2.5 py-1.5 text-xs font-bold text-on-danger shadow-lg transition-colors hover:bg-danger/85 active:bg-danger/75"
                            >
                                {language.risuBardWikiCancel}
                            </button>
                        {/if}
                        <button
                                type="button"
                                data-risubard-wiki-button
                                onclick={() => memoryWikiOpen = !memoryWikiOpen}
                                aria-label={language.risuBardMemoryOpenManual}
                                title={language.risuBardMemoryOpenManual}
                                style="left: 5px"
                                class="relative z-10 shrink-0 flex justify-center items-center w-9 h-9 rounded-full bg-warning text-on-warning shadow-sm hover:bg-warning/85 active:bg-warning/75 transition-colors"
                                class:wiki-generating={$isWikiGenerating}
                        >
                            <BookOpenIcon size={18} strokeWidth={2.2} />
                        </button>
                        <button
                                type="button"
                                role="switch"
                                data-risubard-auto-wiki
                                aria-checked={DBState.db.risuBardAutoWikiEnabled !== false}
                                aria-label={language.risuBardAutoWiki}
                                title={DBState.db.risuBardAutoWikiEnabled !== false
                                    ? language.risuBardAutoWikiOn
                                    : language.risuBardAutoWikiOff}
                                onclick={() => {
                                    DBState.db.risuBardAutoWikiEnabled =
                                        DBState.db.risuBardAutoWikiEnabled === false
                                }}
                                class={`-ml-1 flex h-7 items-center gap-1 rounded-r-full border py-0.5 pl-2.5 pr-1.5 text-[9px] font-bold uppercase tracking-wider transition-colors ${
                                    DBState.db.risuBardAutoWikiEnabled !== false
                                        ? 'border-warning bg-warning/20 text-warning'
                                        : 'border-darkborderc bg-darkbg text-textcolor2'
                                }`}
                        >
                            <span>auto</span>
                            <span
                                    aria-hidden="true"
                                    class="flex h-4 w-4 items-center justify-center rounded-full border transition-colors"
                                    class:border-warning={DBState.db.risuBardAutoWikiEnabled !== false}
                                    class:bg-warning={DBState.db.risuBardAutoWikiEnabled !== false}
                                    class:shadow-sm={DBState.db.risuBardAutoWikiEnabled !== false}
                                    class:border-darkborderc={DBState.db.risuBardAutoWikiEnabled === false}
                                    class:bg-bgcolor={DBState.db.risuBardAutoWikiEnabled === false}
                            >
                                <span class="h-1.5 w-1.5 rounded-full bg-on-warning/90"></span>
                            </span>
                        </button>
                    </div>
                {/if}
                </div>
              </div>
            </div>
            {#if DBState.db.useAutoTranslateInput && DBState.db.characters[$selectedCharID]?.chaId !== '§playground'}
                <div class="flex items-center mt-2 mb-2">
                    <label for='messageInputTranslate' class="text-textcolor ml-4">
                        <LanguagesIcon />
                    </label>
                    <textarea id = 'messageInputTranslate' class="text-textcolor rounded-md p-2 min-w-0 bg-transparent input-text text-xl grow ml-4 mr-2 border-darkbutton resize-none focus:bg-selected overflow-y-hidden overflow-x-hidden max-w-full"
                              bind:value={messageInputTranslate}
                              bind:this={inputTranslateEle}
                              onkeydown={(e) => {
                            if(e.key.toLocaleLowerCase() === "enter" && !e.isComposing){
                                if(shouldSendOnEnter(e)){
                                    send()
                                    e.preventDefault()
                                }
                            }
                            if(e.key.toLocaleLowerCase() === "m" && (e.ctrlKey)){
                                reroll()
                                e.preventDefault()
                            }
                        }}
                              oninput={()=>{updateInputSizeAll();updateInputTransateMessage(true)}}
                              placeholder={language.enterMessageForTranslateToEnglish}
                              style:height={inputTranslateHeight}
                    ></textarea>
                </div>
            {/if}

            {#if fileInput.length > 0}
                <div class="flex items-center ml-4 flex-wrap p-2 m-2 border-darkborderc border rounded-md">
                    {#each fileInput as file, i}
                        {#await getInlayAsset(file) then inlayAsset}
                            <div class="relative">
                                {#if inlayAsset.type === 'image'}
                                    <img src={inlayAsset.data} alt="Inlay" class="max-w-48 max-h-48 border border-darkborderc">
                                {:else if inlayAsset.type === 'video'}
                                    <video controls class="max-w-48 max-h-48 border border-darkborderc">
                                        <source src={inlayAsset.data} type="video/mp4" />
                                        <track kind="captions" />
                                        Your browser does not support the video tag.
                                    </video>
                                {:else if inlayAsset.type === 'audio'}
                                    <audio controls class="max-w-48 max-h-24 border border-darkborderc">
                                        <source src={inlayAsset.data} type="audio/mpeg" />
                                        Your browser does not support the audio tag.
                                    </audio>
                                {:else}
                                    <div class="max-w-24 max-h-24">{file}</div>
                                {/if}
                                <button class="absolute -right-1 -top-1 p-1 bg-darkbg text-textcolor rounded-md transition-colors hover:text-draculared focus:text-draculared" onclick={() => {
                                    fileInput.splice(i, 1)
                                    updateInputSizeAll()
                                }}>
                                    <XIcon size={18} />
                                </button>
                            </div>
                        {/await}
                    {/each}
                </div>

            {/if}

            {#if toggleStickers}
                <div class="ml-4 flex flex-wrap">
                    <AssetInput currentCharacter={currentCharacter} onSelect={(additionalAsset)=>{
                        let fileType = 'img'
                        if(additionalAsset.length > 2 && additionalAsset[2]) {
                            const fileExtension = additionalAsset[2]
                            if(fileExtension === 'mp4' || fileExtension === 'webm')
                                fileType = 'video'
                            else if(fileExtension === 'mp3' || fileExtension === 'wav')
                                fileType = 'audio'
                        }
                        messageInput += `<span class='notranslate' translate='no'>{{${fileType}::${additionalAsset[0]}}}</span> *${additionalAsset[0]} added*`
                        updateInputSizeAll()
                    }}/>
                </div>
            {/if}

            {#if DBState.db.useAutoSuggestions}
                <Suggestion messageInput={(msg)=>messageInput=(
                    (DBState.db.subModel === "textgen_webui" || DBState.db.subModel === "mancer" || DBState.db.subModel.startsWith('local_')) && DBState.db.autoSuggestClean
                    ? msg.replace(/ +\(.+?\) *$| - [^"'*]*?$/, '')
                    : msg
                )} {send}/>
            {/if}
        {/snippet}

        <!-- overscroll-y-contain: without it, repeated overscroll at the chat's end chains the
             gesture to the viewport; mobile Chrome then collapses its URL bar, the visual viewport
             resizes, and the sticky composer inside this col-reverse scroller gets misanchored
             (bar floats up with a gap below). PWA/standalone has no URL bar, hence unaffected. -->
        <div class="h-full w-full flex flex-col-reverse overflow-y-auto overscroll-y-contain relative default-chat-screen"
            bind:this={chatScrollContainer}
            class:nodeonly-standard={DBState.db.theme === ''}
            class:no-chat-width-wide={DBState.db.theme === '' && DBState.db.nodeOnlyStandardChatWidth === 'wide'}
            class:no-chat-width-full={DBState.db.theme === '' && DBState.db.nodeOnlyStandardChatWidth === 'full'}
            onscroll={(e) => {
            if (DBState.db.nodeOnlyScrollButtonType !== 'off') {
                bumpScrollNav()
            }
            const chatTarget = e.target as HTMLElement;
            if (!restoringScrollAnchor && Date.now() >= scrollAnchorFreezeUntil) {
                scheduleScrollAnchorCapture()
            }
            if (paginationKey) {
                saveChatViewSession(paginationKey, {
                    page: chatBounds.page,
                    scrollTop: chatTarget.scrollTop,
                })
            }
            const chatsContainer = (DBState.db.fixedChatTextarea && chatTarget.children[1]) ? chatTarget.children[1] : chatTarget.children[0];
            const lastEl = chatsContainer?.firstElementChild;
            const isAtBottom = lastEl ? lastEl.getBoundingClientRect().top <= chatTarget.getBoundingClientRect().bottom + 100 : true;
            if(isAtBottom){
                showNewMessageButton = false;
            }
        }}>
            {@render composerCluster()}

            {#if chatPanelStore.length > 0}
                <div class="mx-4 my-2 flex flex-col gap-2">
                    {#each chatPanelStore as panel (panel.id)}
                        <section class={`rounded-md border border-darkborderc bg-darkbg/80 p-3 text-textcolor ${panel.className ?? ''}`} data-plugin-chat-panel={panel.id}>
                            {@html panel.html}
                        </section>
                    {/each}
                </div>
            {/if}

            {#if !currentChatReady}
                <div class="w-full flex justify-center text-textcolor2 italic mb-12">
                    {language.loadingChatData}
                </div>
            {:else}

            {#if chatFoldedStateMessageIndex.index !== -1}
                <button class="w-full flex justify-center max-w-full p-4">
                    <Button className="max-w-xl w-full" onclick={() => {
                        void selectChatPage(getLatestChatPage(currentChat.length, chatPageSize), true)
                    }}>
                        {language.loadMore}
                    </Button>
                </button>
            {/if}

            {#if chatBounds.pageCount > 1}
                <nav
                    data-chat-pagination
                    class="mx-auto my-3 flex max-w-xl items-center justify-center gap-2 rounded-full border border-darkborderc bg-darkbg/90 px-3 py-2 text-sm text-textcolor shadow-sm"
                    aria-label={language.chatPageNavigation}
                >
                    <button
                        data-chat-page-previous
                        class="rounded-full px-3 py-1 transition-colors hover:bg-primary/20 disabled:cursor-not-allowed disabled:opacity-40"
                        disabled={chatBounds.page === 0}
                        onclick={() => void selectChatPage(chatBounds.page - 1)}
                    >{language.chatPagePrevious}</button>
                    <span class="min-w-20 text-center tabular-nums">
                        {chatBounds.page + 1} / {chatBounds.pageCount}
                    </span>
                    <button
                        data-chat-page-next
                        class="rounded-full px-3 py-1 transition-colors hover:bg-primary/20 disabled:cursor-not-allowed disabled:opacity-40"
                        disabled={chatBounds.page >= chatBounds.pageCount - 1}
                        onclick={() => void selectChatPage(chatBounds.page + 1, chatBounds.page + 1 >= chatBounds.pageCount - 1)}
                    >{language.chatPageNext}</button>
                    <button
                        data-chat-page-latest
                        class="rounded-full px-3 py-1 transition-colors hover:bg-primary/20 disabled:cursor-not-allowed disabled:opacity-40"
                        disabled={chatBounds.page >= chatBounds.pageCount - 1}
                        onclick={() => void selectChatPage(chatBounds.pageCount - 1, true)}
                    >{language.chatPageLatest}</button>
                </nav>
            {/if}
            
            <Chats
                bind:this={chatsInstance}
                messages={currentChat}
                pageStart={chatBounds.start}
                pageEnd={chatBounds.end}
                onReroll={reroll}
                onNextSwipe={nextSwipe}
                onDeleteSwipe={deleteSwipe}
                onConfirmMemory={confirmCurrentNarrativeMessage}
                onReanalyzeMemory={reanalyzeNarrativeMessage}
                unReroll={unReroll}
                currentCharacter={currentCharacter}
                currentUsername={currentUsername}
                userIcon={userIcon}
                userIconPortrait={userIconPortrait}
                bind:hasNewUnreadMessage={showNewMessageButton}
            />

            <section class="w-full" data-chat-pinned-first-message>
                {#if chatBounds.page === 0 || !firstMessageCollapsed}
                    <div id="chat-pinned-first-message-content">
                        <Chat
                            character={createSimpleCharacter(DBState.db.characters[$selectedCharID])}
                            name={DBState.db.characters[$selectedCharID].name}
                            message={currentChatFmIndex === -1 ? DBState.db.characters[$selectedCharID].firstMessage :
                                DBState.db.characters[$selectedCharID].alternateGreetings[currentChatFmIndex]}
                            role='char'
                            img={getCharImage(DBState.db.characters[$selectedCharID].image, 'css')}
                            idx={-1}
                            altGreeting={DBState.db.characters[$selectedCharID].alternateGreetings.length > 0}
                            disabled={DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage].firstMessageDisabled === true}
                            largePortrait={DBState.db.characters[$selectedCharID].largePortrait}
                            firstMessage={true}
                            onReroll={() => {
                                const cha = DBState.db.characters[$selectedCharID]
                                const chat = DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage]
                                if (chat._placeholder) return
                                const cur = Number.isFinite(chat.fmIndex as number) ? (chat.fmIndex as number) : -1
                                chat.fmIndex = (cur >= cha.alternateGreetings.length - 1) ? -1 : cur + 1
                                DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage] = chat
                            }}
                            unReroll={() => {
                                const cha = DBState.db.characters[$selectedCharID]
                                const chat = DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage]
                                if (chat._placeholder) return
                                const cur = Number.isFinite(chat.fmIndex as number) ? (chat.fmIndex as number) : -1
                                chat.fmIndex = (cur === -1) ? cha.alternateGreetings.length - 1 : cur - 1
                                DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage] = chat
                            }}
                            isLastMemory={false}
                            currentPage={(Number.isFinite(DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage].fmIndex as number) ? (DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage].fmIndex as number) : -1) + 2}
                            totalPages={DBState.db.characters[$selectedCharID].alternateGreetings.length + 1}
                        />
                    </div>
                {/if}
                {#if chatBounds.page > 0}
                    <div class="mx-auto flex w-full max-w-xl justify-end px-4 pt-3">
                        <button
                            type="button"
                            data-chat-first-message-toggle
                            aria-controls="chat-pinned-first-message-content"
                            aria-expanded={!firstMessageCollapsed}
                            class="flex items-center gap-1.5 rounded-full border border-darkborderc bg-darkbg/90 px-3 py-1.5 text-sm text-textcolor shadow-sm transition-colors hover:bg-primary/20"
                            onclick={() => firstMessageCollapsed = !firstMessageCollapsed}
                        >
                            {#if firstMessageCollapsed}
                                <ChevronDownIcon size={16} />
                                {language.chatFirstMessageExpand}
                            {:else}
                                <ChevronUpIcon size={16} />
                                {language.chatFirstMessageCollapse}
                            {/if}
                        </button>
                    </div>
                {/if}
            </section>

            {#if chatBounds.page === 0}
                {#if (aiLawApplies() && DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage].message.length === 0)}
                    <div class="ml-auto mr-auto mt-4 text-textcolor2 italic max-w-2/3 wrap-break-word text-center">
                        {language.aiGenerationWarning}
                    </div>
                {/if}
                {#if !DBState.db.characters[$selectedCharID].removedQuotes && DBState.db.characters[$selectedCharID].creatorNotes.length >= 2}
                    <CreatorQuote quote={DBState.db.characters[$selectedCharID].creatorNotes} onRemove={() => {
                        const cha = DBState.db.characters[$selectedCharID]
                        cha.removedQuotes = true
                        DBState.db.characters[$selectedCharID] = cha
                    }} />
                {/if}
            {/if}

            {/if}

        </div>

    {/if}
        <PluginFloatingActionButtons
            buttons={additionalFloatingActionButtons}
            placements={DBState.db.pluginFabPlacements}
            onPlacementChange={setPluginFabPlacement}
        />
    </main>
    {#if currentCharacter?.chaId && currentChatSlot?.id}
        <RisuBardMemoryWiki
            bind:open={memoryWikiOpen}
            characterId={currentCharacter.chaId}
            chatId={currentChatSlot.id}
            onForceWikiUpdate={forceCurrentNarrativeWikiUpdate}
            rebootJob={currentChatSlot.risuBardWikiReboot}
            onStartWikiReboot={startCurrentWikiReboot}
            onStopWikiReboot={stopCurrentWikiReboot}
            onResumeWikiReboot={resumeCurrentWikiReboot}
            onCancelWikiReboot={cancelCurrentWikiReboot}
            onExecuteWikiCommand={executeCurrentNarrativeWikiCommand}
            onNavigateStorySource={navigateStorySource}
        />
        {#if currentChatReady}
            <ArcaChatLogDialog
                open={arcaChatLogOpen}
                onOpenChange={(next) => { arcaChatLogOpen = next }}
                character={currentCharacter}
                chat={currentChatSlot}
                {currentUsername}
                {userIcon}
            />
        {/if}
    {/if}
</div>

{#if composerFullscreen}
    <div class="fixed inset-0 z-50 bg-bgcolor flex flex-col p-4">
        <div class="mx-auto w-full max-w-3xl flex flex-col flex-1 min-h-0">
            <div class="flex items-center justify-between mb-2">
                <span class="text-textcolor text-sm">{language.chatInputExpandTitle}</span>
                <button onclick={exitFullscreen} aria-label="minimize"
                        class="shrink-0 flex justify-center items-center w-9 h-9 rounded-full text-textcolor hover:bg-primary/20 transition-colors">
                    <Minimize2 size={18} />
                </button>
            </div>
            <textarea
                    bind:value={messageInput}
                    bind:this={fullscreenEle}
                    onblur={persistDraftNow}
                    placeholder={language.enterMessageToPersona(activePersonaName)}
                    class="flex-1 min-h-0 w-full resize-none rounded-md border border-darkborderc bg-transparent p-3 text-textcolor text-base outline-hidden overflow-y-auto focus:border-textcolor transition-colors"
            ></textarea>
            <div class="flex justify-end mt-3">
                <button onclick={sendFullscreen} aria-label="send"
                        disabled={wikiBlocksGeneration}
                        title={wikiBlocksGeneration
                            ? ($isWikiGenerating
                                ? language.risuBardWikiGenerationChatLocked
                                : language.risuBardWikiRebootChatLocked)
                            : undefined}
                        class="flex items-center gap-1 px-4 h-10 rounded-full bg-primary text-accenttext hover:bg-primary/80 transition-colors disabled:opacity-45 disabled:cursor-not-allowed">
                    <Send size={18} />
                    <span>{language.send}</span>
                </button>
            </div>
        </div>
    </div>
{/if}

<style>

    :global(.wiki-generating svg) {
        animation: risubard-wiki-spin 1s linear infinite;
        transform-origin: center;
    }

    @keyframes risubard-wiki-spin {
        to { transform: rotate(360deg); }
    }

    .chat-process-stage-1{
        border-top: 0.4rem solid var(--color-info);
        border-left: 0.4rem solid var(--color-info);
    }

    .chat-process-stage-2{
        border-top: 0.4rem solid var(--color-danger);
        border-left: 0.4rem solid var(--color-danger);
    }

    .chat-process-stage-3{
        border-top: 0.4rem solid var(--color-success);
        border-left: 0.4rem solid var(--color-success);
    }

    .chat-process-stage-4{
        border-top: 0.4rem solid var(--color-secondary);
        border-left: 0.4rem solid var(--color-secondary);
    }


    @keyframes spin {

        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
    }

    /* gemini-cache-keeper compat: the plugin injects #gck-cache-timer into the composer
       (found via the .plugin-compat-items-stretch hook) and absolutely positions it over
       the send button — which now overlaps the expand button and floats at the composer's
       vertical center. Re-flow it as an in-line flex item: order:0 (default, appended last)
       places it just left of the expand button (order-1) and send button (order-2). */
    :global(.plugin-compat-items-stretch #gck-cache-timer) {
        position: relative !important;  /* stay a positioned ancestor so the popup still anchors to it */
        inset: auto !important;         /* clear the plugin's top/right offsets */
        transform: none !important;     /* clear translateY(-50%) */
        margin-left: auto;              /* right-align the trailing cluster when the composer wraps (multiline) */
    }
    /* when the timer is present it owns the auto margin, so drop the expand button's own
       ml-auto to avoid a double gap splitting the timer away from the buttons */
    :global(.plugin-compat-items-stretch:has(#gck-cache-timer) .composer-expand-btn) {
        margin-left: 0;
    }
</style>
