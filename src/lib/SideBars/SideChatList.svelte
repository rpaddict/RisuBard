<script lang="ts">
    import { onDestroy, untrack } from "svelte";
    import { v4 } from "uuid";
    import Sortable from 'sortablejs/modular/sortable.core.esm.js';
    import { DownloadIcon, PencilIcon, HardDriveUploadIcon, TrashIcon, SplitIcon, FolderPlusIcon, BookmarkCheckIcon, PackageIcon, CopyIcon, PlusIcon, MergeIcon, EllipsisIcon, XIcon, ListChecksIcon, UserRoundIcon, FolderInputIcon, FolderMinusIcon, ArrowUpIcon, ArrowDownIcon, GripVerticalIcon, ChevronRightIcon, PaletteIcon, Maximize2Icon } from "@lucide/svelte";

    import type { Chat, ChatFolder, character } from "src/ts/storage/database.svelte";
    import { newChatModelDefaults } from "src/ts/storage/database.svelte";
    import { ensureChatHydrated } from "src/ts/storage/chatStorage";
    import { DBState, ReloadGUIPointer, SizeStore } from 'src/ts/stores.svelte';
    import { selectedCharID, chatDeselected } from "src/ts/stores.svelte";

    import CheckInput from "../UI/GUI/CheckInput.svelte";
    import ShAccordion from "../UI/GUI/ShAccordion.svelte";
    import ShButton from "../UI/GUI/ShButton.svelte";

    import { exportChat, importChat, exportAllChats } from "src/ts/characters";
    import { alertConfirm, alertError, alertInput, alertSelect, alertStore, notifySuccess, notifyError } from "src/ts/alert";
    import { findCharacterbyId, sleep, sortableOptions } from "src/ts/util";

    import { bookmarkListOpen, openModuleListStore } from "src/ts/stores.svelte";
    import { language } from "src/lang";
    import Toggles from "./Toggles.svelte";
    import PersonaBind from "./PersonaBind.svelte";
    import PromptBind from "./PromptBind.svelte";
    import ModelBind from "./ModelBind.svelte";
    import { changeChatTo, createChatCopyName, requestImmediateSave, trackChatForSave } from "src/ts/globalApi.svelte";
    import { forageStorage } from "src/ts/globalApi.svelte";
    import { completeMemoryWikiFork, forkMemoryWiki } from "src/ts/risubard/memoryWikiFork";
    import { mergeCharacterChats } from "src/ts/risubard/chatMerge";
    import { createUniqueDisplayName } from 'src/ts/displayName';
    import { doingChat, isAnyGenerating } from "src/ts/process/generationState";
    import { isWikiGenerating } from "src/ts/risubard/wikiGenerationState";
    import ChatMergeDialog from "./ChatMergeDialog.svelte";
    import ChatManagerDialog from "./ChatManagerDialog.svelte";
    import ShDropdownMenu from '../UI/GUI/ShDropdownMenu.svelte';
    import ShDropdownMenuTrigger from '../UI/GUI/ShDropdownMenuTrigger.svelte';
    import ShDropdownMenuContent from '../UI/GUI/ShDropdownMenuContent.svelte';
    import ShDropdownMenuItem from '../UI/GUI/ShDropdownMenuItem.svelte';
    import ShDropdownMenuSeparator from '../UI/GUI/ShDropdownMenuSeparator.svelte';
    import SidebarResizeHandle from './SidebarResizeHandle.svelte';
    import { normalizeChatListHeight } from 'src/ts/gui/sidebarLayout';
    import { rebindPainterChatScope } from 'src/ts/bardPainter/chatScope';
    import { deleteCharacterChats, exportCharacterChats } from 'src/ts/risubard/chatListActions';
    import { chatIdRange, chatSection, gatherSelectionAfterDrag, shiftSelectedChats } from 'src/ts/risubard/chatListOrder';
    import { loadChatPreview } from 'src/ts/risubard/chatPreview';
    import { formatPreviewTime, toChatPreviewText } from 'src/ts/risubard/chatPreviewText';
    import type { ChatPreviewPayload } from 'src/ts/storage/chatContentPage';
    import { getEffectivePersona, resolvePersonaById } from 'src/ts/personaScopes';

    interface Props {
        chara: character;
    }

    let { chara = $bindable() }: Props = $props();
    let renamingFolderId = $state<string | null>(null)
    let pendingRenameFolderId: string | null = null
    let draggingChat = $state(false)

    // Safety net: chats whose folderId references a deleted folder would
    // otherwise be invisible (excluded from both the no-folder section and
    // any folder section). Render them in the no-folder section instead.
    // The server-side fix prevents new orphans; this guard rescues existing
    // ones until boot-time normalize touches the disk.
    const validFolderIds = $derived(
        new Set((chara.chatFolders ?? []).map(f => f.id).filter(Boolean))
    )
    // One pass groups every chat by its visible folder; rows keep their array index.
    const chatGroups = $derived.by(() => {
        const groups = new Map<string | null, { chat: Chat, index: number }[]>()
        chara.chats.forEach((chat, index) => {
            const key = chatSection(chat, validFolderIds)
            const entry = { chat, index }
            const list = groups.get(key)
            if (list) list.push(entry)
            else groups.set(key, [entry])
        })
        return groups
    })
    // Display order of the chats a click can reach, for Shift range selection.
    const visibleChatIds = $derived([
        ...(chara.chatFolders ?? []).filter(folder => !folder.folded).flatMap(folder => chatGroups.get(folder.id) ?? []),
        ...(chatGroups.get(null) ?? []),
    ].map(entry => entry.chat.id).filter((id): id is string => !!id))

    let chatsStb: Sortable[] = []
    let folderStb: Sortable = null

    let folderEles: HTMLDivElement = $state()
    let listEle: HTMLDivElement = $state()
    let sorted = $state(0)
    let opened = 0
    let chatListExpanded = $state(false)
    const chatListHeight = $derived(normalizeChatListHeight(DBState.db.chatListHeight, $SizeStore.h))
    const activeChat = $derived(chara.chats[chara.chatPage])
    let mergeOpen = $state(false)
    let managerOpen = $state(false)

    async function loadMergeChat(id: string): Promise<Chat> {
        const index = chara.chats.findIndex(chat => chat.id === id)
        const chat = await ensureChatHydrated(chara.chats, index, chara.chaId)
        if (!chat || chat._placeholder) throw new Error('챗 데이터를 불러오지 못했습니다.')
        return $state.snapshot(chat)
    }

    async function mergeChats(ids: string[], name: string): Promise<void> {
        const targetCharacter = chara
        const existingChatIds = new Set(targetCharacter.chats.map(chat => chat.id))
        const merged = await mergeCharacterChats(targetCharacter, ids, name, {
            hydrate: async (id) => {
                if ($doingChat || $isAnyGenerating || $isWikiGenerating) {
                    throw new Error('진행 중인 생성 작업이 끝난 뒤 병합해 주세요.')
                }
                const index = targetCharacter.chats.findIndex(chat => chat.id === id)
                return ensureChatHydrated(targetCharacter.chats, index, targetCharacter.chaId)
            },
            snapshot: (chat) => $state.snapshot(chat),
            save: async () => {
                // Only the merged chat is new; a rollback save sends just the shorter list.
                for (const chat of targetCharacter.chats) {
                    if (chat.id && !existingChatIds.has(chat.id)) trackChatForSave(targetCharacter.chaId, chat.id)
                }
                const pending = requestImmediateSave({ flushServer: true, rejectOnFailure: true })
                if (!pending) throw new Error('저장 기능이 아직 준비되지 않았습니다. 잠시 후 다시 시도해 주세요.')
                await pending
            },
        })
        if (chara === targetCharacter && DBState.db.characters[$selectedCharID]?.chaId === targetCharacter.chaId) {
            changeChatTo(merged.id!)
        }
        notifySuccess('합본 챗을 만들었습니다. Memory Wiki에서 위키 리부트를 실행해 주세요.')
    }

    function createNewChat(): void {
        const newChat = {
            message: [] as any[],
            note: '',
            name: createUniqueDisplayName(`New Chat ${chara.chats.length + 1}`, chara.chats),
            localLore: [] as any[],
            fmIndex: -1,
            id: v4(),
            ...newChatModelDefaults(chara, activeChat),
        }
        chara.chats.unshift(newChat)
        chara.chats = chara.chats
        changeChatTo(0)
        void requestImmediateSave()
        $ReloadGUIPointer += 1
    }

    async function renameCurrentChat(): Promise<void> {
        if(!activeChat) return
        const nextName = await alertInput(
            `${language.edit} ${language.Chat}`,
            [],
            activeChat.name,
        )
        if(!nextName?.trim()) return
        activeChat.name = createUniqueDisplayName(nextName, chara.chats, activeChat.id)
        chara.chats = chara.chats
        void requestImmediateSave()
    }

    async function deleteCurrentChat(): Promise<void> {
        if(!activeChat?.id) return
        await deleteCharacterChats(chara, [activeChat.id])
    }

    let selectedChatIds = $state<string[]>([])
    $effect(() => {
        chara?.chaId
        untrack(() => { selectedChatIds = [] })
    })
    const selectedSet = $derived(new Set(selectedChatIds))

    function setChatSelected(chatId: string | undefined, checked: boolean): void {
        if (!chatId) return
        const rest = selectedChatIds.filter(id => id !== chatId)
        selectedChatIds = checked ? [...rest, chatId] : rest
    }

    async function deleteSelectedChats(): Promise<void> {
        const removed = await deleteCharacterChats(chara, selectedChatIds)
        selectedChatIds = selectedChatIds.filter(id => !removed.includes(id))
    }

    async function copyChatWithMemory(chat: Chat): Promise<void> {
        const confirmed = await alertConfirm(
            `${language.copyChatConfirm}${chat.name}`
        )
        if(!confirmed) return
        const chatIdx = chara.chats.indexOf(chat)
        if(chara.chats[chatIdx]?._placeholder){
            await ensureChatHydrated(
                chara.chats,
                chatIdx,
                (chara as character).chaId
            )
        }
        const sourceChat = chara.chats[chatIdx]
        if(sourceChat?._placeholder){
            alertError('Failed to load chat data.')
            return
        }
        if(!sourceChat?.id || !(chara as character).chaId){
            alertError('Memory Wiki copy requires stable chat and character IDs.')
            return
        }
        const newChat = $state.snapshot(sourceChat)
        newChat.name = createChatCopyName(newChat.name, 'Copy')
        newChat.id = v4()
        // The reboot job and its staging wiki stay with the source chat.
        delete newChat.risuBardWikiReboot
        rebindPainterChatScope(newChat, (chara as character).chaId)
        try {
            const forkReceipt = await forkMemoryWiki({
                characterId: (chara as character).chaId,
                sourceChatId: sourceChat.id,
                destinationChatId: newChat.id,
                mode: 'copy',
                fetchImpl: fetch,
                createAuth: () => forageStorage.createAuth(),
            })
            chara.chats.unshift(newChat)
            chara.chats = chara.chats
            try {
                trackChatForSave((chara as character).chaId, newChat.id)
                await requestImmediateSave({ rejectOnFailure: true })
            }
            catch(error) {
                chara.chats.splice(chara.chats.indexOf(newChat), 1)
                chara.chats = chara.chats
                let cleanupError: unknown
                try {
                    await completeMemoryWikiFork({
                        characterId: (chara as character).chaId,
                        destinationChatId: newChat.id,
                        forkToken: forkReceipt.forkToken,
                        action: 'discard',
                        fetchImpl: fetch,
                        createAuth: () => forageStorage.createAuth(),
                    })
                }
                catch(discardError) {
                    cleanupError = discardError
                }
                void requestImmediateSave({ forceFullWrite: true })
                if(cleanupError){
                    throw new Error(
                        `${error instanceof Error ? error.message : String(error)}; `
                        + `Memory Wiki cleanup failed: ${cleanupError instanceof Error
                            ? cleanupError.message
                            : String(cleanupError)}`
                    )
                }
                throw error
            }
            try {
                await completeMemoryWikiFork({
                    characterId: (chara as character).chaId,
                    destinationChatId: newChat.id,
                    forkToken: forkReceipt.forkToken,
                    action: 'finalize',
                    fetchImpl: fetch,
                    createAuth: () => forageStorage.createAuth(),
                })
            }
            catch(error){
                alertError(
                    `Chat copy was saved, but Memory Wiki finalization failed: `
                    + `${error instanceof Error ? error.message : String(error)}`
                )
                return
            }
            changeChatTo(0)
            notifySuccess(language.copyChatSuccess)
        }
        catch(error){
            alertError(
                `Memory Wiki copy failed: ${error instanceof Error
                    ? error.message
                    : String(error)}`
            )
        }
    }

    const destroyStb = () => {
        for (const stb of [...chatsStb, folderStb]) {
            try {
                stb?.destroy()
            } catch (error) {}
        }
        chatsStb = []
        folderStb = null
    }

    // Folder containers appear after mount and the component is reused across characters,
    // so rebuild the drop targets whenever the character or its folder count changes.
    const rebuildStb = async () => {
        sorted += 1
        await sleep(1)
        createStb()
        // Start renaming a new folder only after the remount, or the remount blurs the field.
        if (pendingRenameFolderId) {
            renamingFolderId = pendingRenameFolderId
            pendingRenameFolderId = null
        }
    }

    // Reorders keep the same chat open, so only its index moves; changeChatTo
    // would re-apply chat bindings from whatever chat sat at the new index.
    const applyChatOrder = (newChats: Chat[], activeChatRef: Chat | undefined) => {
        chara.chats = newChats
        const page = activeChatRef ? newChats.indexOf(activeChatRef) : -1
        if (page >= 0) chara.chatPage = page
        $ReloadGUIPointer += 1
    }

    const createStb = () => {
        destroyStb()
        if (!listEle) return
        for (let chat of listEle.querySelectorAll('.risu-chat')) {
            chatsStb.push(new Sortable(chat, {
                group: 'chats',
                ...sortableOptions,
                // A mouse drags the whole row; touch drags only by the grip, so a long press
                // on the row stays free for selection and a swipe still scrolls.
                filter: (event: Event, target: HTMLElement) => target.classList.contains('no-sort')
                    || ((event as PointerEvent).pointerType === 'touch' || event.type.startsWith('touch'))
                        && !(event.target as Element | null)?.closest('[data-chat-drag-handle]'),
                preventOnFilter: false,
                delay: 0,
                onStart: () => { draggingChat = true },
                onEnd: async (event) => {
                    draggingChat = false
                    const previousChats = [...chara.chats]
                    const activeChatRef = chara.chats[chara.chatPage]
                    let newChats: Chat[] = []

                    listEle.querySelectorAll('[data-risu-chat-folder-idx]').forEach(folder => {
                        const folderIdx = parseInt(folder.getAttribute('data-risu-chat-folder-idx'))
                        folder.querySelectorAll('[data-risu-chat-idx]').forEach(chatInFolder => {
                            const chatIdx = parseInt(chatInFolder.getAttribute('data-risu-chat-idx'))
                            const newChat = chara.chats[chatIdx]
                            newChat.folderId = chara.chatFolders[folderIdx].id
                            newChats.push(newChat)
                        })
                    })

                    listEle.querySelectorAll('[data-risu-chat-idx]').forEach(chatEle => {
                        const idx = parseInt(chatEle.getAttribute('data-risu-chat-idx'))
                        const newChat = chara.chats[idx]
                        if (newChats.includes(newChat) == false) {
                            if (newChat.folderId != null)
                                newChat.folderId = null
                            newChats.push(newChat)
                        }
                    })

                    // Dragging one selected chat carries the rest of the selection with it.
                    const draggedId = previousChats[parseInt(event.item.getAttribute('data-risu-chat-idx'))]?.id
                    if (draggedId) newChats = gatherSelectionAfterDrag(newChats, previousChats, draggedId, selectedSet)

                    applyChatOrder(newChats, activeChatRef)
                    sorted += 1
                    await sleep(1)
                    createStb()
                },
            }))
        }
        folderStb = Sortable.create(folderEles, {
            group: 'folders',
            ...sortableOptions,
            handle: '[data-chat-folder-header]',
            onEnd: async (event) => {
                const newFolders: ChatFolder[] = []
                const newChats: Chat[] = []
                const folders: HTMLElement[] = Array.from<HTMLElement>(event.to.children)

                const activeChatRef = chara.chats[chara.chatPage]

                folders.forEach(folder => {
                    const folderIdx = parseInt(folder.getAttribute('data-risu-chat-folder-idx'))
                    newFolders.push(chara.chatFolders[folderIdx])

                    folder.querySelectorAll('[data-risu-chat-idx]').forEach(chatEle => {
                        const idx = parseInt(chatEle.getAttribute('data-risu-chat-idx'))
                        newChats.push(chara.chats[idx])
                    })
                })

                listEle.querySelectorAll('[data-risu-chat-idx]').forEach(chatEle => {
                    const idx = parseInt(chatEle.getAttribute('data-risu-chat-idx'))
                    if (newChats.includes(chara.chats[idx]) == false) {
                        newChats.push(chara.chats[idx])
                    }
                })
                
                chara.chatFolders = newFolders
                applyChatOrder(newChats, activeChatRef)
                sorted += 1
                await sleep(1)
                createStb()
            },
        })
    }

    $effect(() => {
        chara?.chaId
        chara?.chatFolders?.length
        untrack(() => void rebuildStb())
    })

    onDestroy(destroyStb)

    let rootEle: HTMLDivElement = $state()
    let selectionAnchor: string | null = null
    let checkboxShiftClick = false
    let lastPointerType = ''
    let longPressTimer: ReturnType<typeof setTimeout> | null = null
    let longPressStart = { x: 0, y: 0 }
    let suppressClickId: string | null = null

    const allSelected = $derived(chara.chats.length > 0 && chara.chats.every(chat => !chat.id || selectedSet.has(chat.id)))
    const sameOrder = (chats: Chat[]) => chats.every((chat, index) => chat === chara.chats[index])
    const canMoveUp = $derived(selectedChatIds.length > 0 && !sameOrder(shiftSelectedChats(chara.chats, selectedSet, -1, validFolderIds)))
    const canMoveDown = $derived(selectedChatIds.length > 0 && !sameOrder(shiftSelectedChats(chara.chats, selectedSet, 1, validFolderIds)))

    function toggleChatSelected(chatId: string, checked = !selectedSet.has(chatId)): void {
        setChatSelected(chatId, checked)
        selectionAnchor = chatId
    }

    function selectRangeTo(chatId: string): void {
        // Without an anchor, the range starts at the open chat, like a file manager.
        const anchor = selectionAnchor ?? (!$chatDeselected ? chara.chats[chara.chatPage]?.id : null) ?? chatId
        const range = chatIdRange(visibleChatIds, anchor, chatId)
        selectedChatIds = [...new Set([...selectedChatIds, ...range])]
        selectionAnchor = chatId
    }

    function onCheckboxChange(chatId: string | undefined, checked: boolean): void {
        if (!chatId) return
        if (checkboxShiftClick && checked && selectionAnchor) selectRangeTo(chatId)
        else toggleChatSelected(chatId, checked)
        checkboxShiftClick = false
    }

    function clearSelection(): void {
        selectedChatIds = []
        selectionAnchor = null
    }

    function toggleSelectAll(): void {
        if (allSelected) clearSelection()
        else selectedChatIds = chara.chats.map(chat => chat.id).filter((id): id is string => !!id)
    }

    function onChatRowClick(event: MouseEvent, chat: Chat, index: number): void {
        if (suppressClickId && suppressClickId === chat.id) { suppressClickId = null; return }
        if (chat.id && event.shiftKey) { selectRangeTo(chat.id); return }
        if (chat.id && (event.ctrlKey || event.metaKey)) { toggleChatSelected(chat.id); return }
        // In touch selection mode a tap adds or removes the chat instead of opening it.
        if (chat.id && selectedChatIds.length > 0 && lastPointerType === 'touch') { toggleChatSelected(chat.id); return }
        changeChatTo(index)
    }

    function cancelLongPress(): void {
        if (longPressTimer) clearTimeout(longPressTimer)
        longPressTimer = null
    }

    function onChatRowPointerDown(event: PointerEvent, chat: Chat): void {
        lastPointerType = event.pointerType
        suppressClickId = null
        cancelLongPress()
        if (event.pointerType !== 'touch' || !chat.id) return
        const chatId = chat.id
        longPressStart = { x: event.clientX, y: event.clientY }
        longPressTimer = setTimeout(() => {
            longPressTimer = null
            suppressClickId = chatId
            toggleChatSelected(chatId, true)
            navigator.vibrate?.(15)
        }, 450)
    }

    function onChatRowPointerMove(event: PointerEvent): void {
        if (longPressTimer && Math.hypot(event.clientX - longPressStart.x, event.clientY - longPressStart.y) > 10) cancelLongPress()
    }

    function onWindowKeydown(event: KeyboardEvent): void {
        if (event.key !== 'Escape' || selectedChatIds.length === 0) return
        const target = event.target as HTMLElement | null
        if (target?.closest('input, textarea, [contenteditable="true"], [role="dialog"], [role="menu"]')) return
        if (target && target !== document.body && !rootEle?.contains(target)) return
        clearSelection()
    }

    // One chat keeps the single-chat export with its JSON, TXT and HTML choices.
    async function exportSelectedChats(): Promise<void> {
        if (selectedChatIds.length === 1) {
            const index = chara.chats.findIndex(chat => chat.id === selectedChatIds[0])
            if (index >= 0) await exportChat(index)
            return
        }
        await exportCharacterChats(chara, selectedChatIds)
    }

    function moveSelectedChats(direction: -1 | 1): void {
        const next = shiftSelectedChats(chara.chats, selectedSet, direction, validFolderIds)
        if (sameOrder(next)) return
        applyChatOrder(next, chara.chats[chara.chatPage])
        void requestImmediateSave()
    }

    function moveSelectedToFolder(folderId: string | null): void {
        const folder = folderId ? chara.chatFolders?.find(f => f.id === folderId) : null
        if (folderId && !folder) return
        let count = 0
        for (const chat of chara.chats) {
            if (!chat.id || !selectedSet.has(chat.id)) continue
            chat.folderId = folderId
            count++
        }
        if (count === 0) return
        // Open the destination so the moved chats stay in view.
        if (folder) folder.folded = false
        chara.chats = chara.chats
        void requestImmediateSave()
        notifySuccess(folder ? `챗 ${count}개를 '${folder.name}' 폴더로 옮겼습니다.` : `챗 ${count}개를 폴더 밖으로 옮겼습니다.`)
    }

    function createFolder(): string {
        chara.chatFolders ??= []
        const id = v4()
        chara.chatFolders.unshift({
            id,
            name: `새 폴더 ${chara.chatFolders.length + 1}`,
            folded: false,
        })
        chara.chatFolders = chara.chatFolders
        pendingRenameFolderId = id
        $ReloadGUIPointer += 1
        return id
    }

    function commitFolderName(folder: ChatFolder, value: string): void {
        const name = value.trim()
        if (name) folder.name = name
        renamingFolderId = null
    }

    const folderColors = [
        ['red', '빨강'], ['green', '초록'], ['blue', '파랑'], ['yellow', '노랑'],
        ['indigo', '남색'], ['purple', '보라'], ['pink', '분홍'], ['default', '기본 색'],
    ] as const

    async function pickFolderColor(folder: ChatFolder): Promise<void> {
        const choice = parseInt(await alertSelect([...folderColors.map(([, label]) => label), language.cancel]))
        if (choice >= 0 && choice < folderColors.length) folder.color = folderColors[choice][0]
    }

    async function deleteFolder(folder: ChatFolder, index: number): Promise<void> {
        const count = chatGroups.get(folder.id)?.length ?? 0
        const note = count > 0 ? ` (안의 챗 ${count}개는 지워지지 않고 폴더 밖으로 옮겨집니다)` : ''
        if (!await alertConfirm(`${language.removeConfirm}${folder.name}${note}`)) return
        $ReloadGUIPointer += 1
        const folders = chara.chatFolders
        folders.splice(index, 1)
        chara.chats.forEach(chat => {
            if (chat.folderId == folder.id) {
                chat.folderId = null
            }
        })
        chara.chatFolders = folders
    }

    function focusAndSelect(node: HTMLInputElement): void {
        node.focus()
        node.select()
    }

    // ── Hover preview: persona and the last message, without opening the chat ──
    const PREVIEW_DELAY_MS = 400
    const PREVIEW_WIDTH = 320
    let preview = $state<{ chatId: string, top: number, left: number, data: ChatPreviewPayload | null, loading: boolean } | null>(null)
    let previewTimer: ReturnType<typeof setTimeout> | null = null
    let previewRequest = 0

    function portal(node: HTMLElement) {
        document.body.appendChild(node)
        return { destroy() { node.remove() } }
    }

    function hidePreview(): void {
        if (previewTimer) clearTimeout(previewTimer)
        previewTimer = null
        previewRequest++
        preview = null
    }

    function schedulePreview(anchor: HTMLElement, chat: Chat, index: number, delay = PREVIEW_DELAY_MS): void {
        hidePreview()
        if (!chat.id || draggingChat) return
        const chatId = chat.id
        const request = previewRequest
        previewTimer = setTimeout(async () => {
            previewTimer = null
            const listRight = (listEle ?? anchor).getBoundingClientRect().right
            const rowTop = anchor.getBoundingClientRect().top
            const left = listRight + 8
            // No room beside the sidebar (narrow window): skip rather than cover the row.
            if (left + 240 > window.innerWidth) return
            const top = Math.max(8, Math.min(rowTop, window.innerHeight - 240))
            preview = { chatId, top, left, data: null, loading: true }
            try {
                const data = await loadChatPreview(chara, chat, index)
                if (request !== previewRequest) return
                preview = { chatId, top, left, data, loading: false }
            } catch {
                if (request === previewRequest) preview = { chatId, top, left, data: null, loading: false }
            }
        }, delay)
    }

    function onChatRowPointerEnter(event: PointerEvent, chat: Chat, index: number): void {
        if (event.pointerType === 'touch') return
        schedulePreview(event.currentTarget as HTMLElement, chat, index)
    }

    function onChatRowFocus(event: FocusEvent, chat: Chat, index: number): void {
        const target = event.currentTarget as HTMLElement
        if (target.matches(':focus-visible')) schedulePreview(target, chat, index)
    }

    const previewPersona = $derived.by(() => {
        if (!preview?.data) return null
        const bound = resolvePersonaById(DBState.db, chara, preview.data.bindedPersona)
        const persona = bound?.persona ?? getEffectivePersona(DBState.db, chara, null)?.persona
        return { name: persona?.name || DBState.db.username || 'User', bound: !!bound }
    })

    const previewMessage = $derived.by(() => {
        const message = preview?.data?.lastMessage
        if (!message) return null
        const userName = previewPersona?.name ?? 'User'
        const charName = chara.name || '캐릭터'
        const speaker = message.role === 'user'
            ? userName
            : (message.saying ? findCharacterbyId(message.saying)?.name : null) || charName
        const text = toChatPreviewText(message.data, { user: userName, char: charName })
        return { speaker, time: message.time ? formatPreviewTime(message.time) : '', text: text || '(내용 없음)' }
    })

    $effect(() => {
        if (draggingChat) untrack(hidePreview)
    })
    onDestroy(hidePreview)
</script>
<svelte:window onkeydown={onWindowKeydown} />
{#snippet chatSelectBox(chat: Chat)}
    <!-- Capture Shift before the checkbox reports its change, for range selection. -->
    <span class="contents" onclickcapture={(e) => { checkboxShiftClick = e.shiftKey }}>
        <CheckInput check={selectedSet.has(chat.id)} onChange={(checked) => onCheckboxChange(chat.id, checked)}
            margin={false} hiddenName name={`${chat.name} 선택`} className="shrink-0 self-stretch pl-2 pr-1" />
    </span>
{/snippet}
{#if mergeOpen}
    <ChatMergeDialog open={mergeOpen} chats={chara.chats} loadChat={loadMergeChat}
        onMerge={mergeChats} onOpenChange={(open) => { mergeOpen = open }} />
{/if}
{#if managerOpen}
    <ChatManagerDialog open={managerOpen} bind:chara onOpenChange={(open) => { managerOpen = open }} />
{/if}
<div class="flex flex-col w-full" bind:this={rootEle}>
    <section data-current-chat-section class="border-b border-darkborderc pb-2">
        <div data-chat-file-header class="flex min-h-10 items-center gap-1">
            <div data-current-chat-title class="flex min-w-0 grow items-center px-1.5 py-2 text-textcolor">
                <span class="truncate font-semibold">{activeChat?.name ?? language.newChat}</span>
            </div>
        </div>
    </section>

    <div data-chat-list-disclosure class="mt-2">
    <ShAccordion bind:open={chatListExpanded} name={language.sidebarChatListLabel} class="w-full">
        <span class="sr-only" aria-live="polite">{selectedChatIds.length > 0 ? `챗 ${selectedChatIds.length}개 선택됨` : ''}</span>
        {#if selectedChatIds.length > 0}
        <div data-chat-selection-bar role="toolbar" aria-label="선택한 챗 작업" class="grid grid-cols-8 items-center gap-0.5 border-b border-darkborderc py-1.5">
            <ShButton data-chat-selection-clear variant="ghost" size="sm" className="col-span-2 min-w-0 w-full justify-center gap-0.5 px-1" aria-label={`선택 해제, 챗 ${selectedChatIds.length}개 선택됨`} title="선택 해제 (Esc)" onclick={clearSelection}>
                <XIcon size={16} class="shrink-0" />
                <span class="text-sm font-semibold tabular-nums">{selectedChatIds.length}</span>
            </ShButton>
            <ShButton data-chat-select-all variant="ghost" size="icon-sm" className="min-w-0 w-full" aria-pressed={allSelected}
                aria-label={allSelected ? '전체 선택 해제' : '전체 선택'} title={allSelected ? '전체 선택 해제' : '전체 선택'} onclick={toggleSelectAll}>
                <ListChecksIcon size={18} />
            </ShButton>
            <ShDropdownMenu>
                <ShDropdownMenuTrigger data-chat-move-to-folder aria-label="폴더로 이동" title="폴더로 이동"
                    class="risu-button-lift flex h-8 min-w-0 w-full items-center justify-center rounded-md text-textcolor hover:bg-selected/30 focus-visible:outline-2 focus-visible:outline-borderc">
                    <FolderInputIcon size={18} />
                </ShDropdownMenuTrigger>
                <ShDropdownMenuContent align="start">
                    {#each chara.chatFolders ?? [] as folder (folder.id)}
                        <ShDropdownMenuItem onSelect={() => moveSelectedToFolder(folder.id)}><FolderInputIcon size={16} /><span class="truncate">{folder.name}</span></ShDropdownMenuItem>
                    {/each}
                    <ShDropdownMenuItem onSelect={() => moveSelectedToFolder(null)}><FolderMinusIcon size={16} />폴더 밖으로</ShDropdownMenuItem>
                    <ShDropdownMenuSeparator />
                    <ShDropdownMenuItem onSelect={() => moveSelectedToFolder(createFolder())}><FolderPlusIcon size={16} />새 폴더 만들어 옮기기</ShDropdownMenuItem>
                </ShDropdownMenuContent>
            </ShDropdownMenu>
            <ShButton data-chat-move-up variant="ghost" size="icon-sm" className="min-w-0 w-full" aria-label="위로 옮기기" title="위로 옮기기" disabled={!canMoveUp} onclick={() => moveSelectedChats(-1)}>
                <ArrowUpIcon size={18} />
            </ShButton>
            <ShButton data-chat-move-down variant="ghost" size="icon-sm" className="min-w-0 w-full" aria-label="아래로 옮기기" title="아래로 옮기기" disabled={!canMoveDown} onclick={() => moveSelectedChats(1)}>
                <ArrowDownIcon size={18} />
            </ShButton>
            <ShButton data-chat-export-selected variant="ghost" size="icon-sm" className="min-w-0 w-full" aria-label="선택한 챗 내보내기" title="선택한 챗 내보내기" onclick={() => void exportSelectedChats()}>
                <DownloadIcon size={18} />
            </ShButton>
            <ShButton data-chat-delete-selected variant="destructive" size="icon-sm" className="min-w-0 w-full" aria-label={`선택한 챗 ${selectedChatIds.length}개 삭제`} title={`선택한 챗 ${selectedChatIds.length}개 삭제`} onclick={() => void deleteSelectedChats()}>
                <TrashIcon size={18} />
            </ShButton>
        </div>
        {:else}
        <div data-chat-list-toolbar class="grid grid-cols-9 items-center gap-0.5 border-b border-darkborderc py-1.5">
            <ShButton data-sidebar-new-chat variant="ghost" size="icon-sm" className="min-w-0 w-full" aria-label={language.newChat} title={language.newChat} onclick={createNewChat}>
                <PlusIcon size={18} />
            </ShButton>
            <ShButton data-chat-rename variant="ghost" size="icon-sm" className="min-w-0 w-full" aria-label={language.edit} title={language.edit} onclick={() => void renameCurrentChat()}>
                <PencilIcon size={18} />
            </ShButton>
            <ShButton data-chat-copy variant="ghost" size="icon-sm" className="min-w-0 w-full" aria-label={language.copy} title={language.copy} onclick={() => { if(activeChat) void copyChatWithMemory(activeChat) }}>
                <CopyIcon size={18} />
            </ShButton>
            <ShButton data-chat-merge variant="ghost" size="icon-sm" className="min-w-0 w-full" aria-label="챗 이어 붙이기" title="챗 이어 붙이기"
                disabled={chara.chats.length < 2 || $doingChat || $isAnyGenerating || $isWikiGenerating} onclick={() => { mergeOpen = true }}>
                <MergeIcon size={18} />
            </ShButton>
            <ShButton data-chat-branch variant="ghost" size="icon-sm" className="min-w-0 w-full" aria-label="챗 분할 (브랜치)" title="챗 분할 (브랜치)" onclick={() => { alertStore.set({ type: 'branches', msg: '' }) }}>
                <SplitIcon size={18} />
            </ShButton>
            <ShButton data-chat-delete variant="destructive" size="icon-sm" className="min-w-0 w-full" aria-label="현재 챗 삭제" title="현재 챗 삭제"
                onclick={() => void deleteCurrentChat()}>
                <TrashIcon size={18} />
            </ShButton>
            <ShButton data-chat-new-folder variant="ghost" size="icon-sm" className="min-w-0 w-full" aria-label="새 폴더" title="새 폴더" onclick={() => { createFolder() }}>
                <FolderPlusIcon size={18} />
            </ShButton>
            <ShButton data-chat-manager-open variant="ghost" size="icon-sm" className="min-w-0 w-full" aria-label="챗 목록 크게 보기" title="챗 목록 크게 보기" onclick={() => { managerOpen = true }}>
                <Maximize2Icon size={18} />
            </ShButton>
            <ShDropdownMenu>
                <ShDropdownMenuTrigger data-chat-more aria-label="챗 목록 더 보기" title="더 보기"
                    class="risu-button-lift flex h-8 min-w-0 w-full items-center justify-center rounded-md text-textcolor hover:bg-selected/30 focus-visible:outline-2 focus-visible:outline-borderc">
                    <EllipsisIcon size={18} />
                </ShDropdownMenuTrigger>
                <ShDropdownMenuContent align="end">
                    <ShDropdownMenuItem onSelect={exportAllChats}><DownloadIcon size={16} />모든 챗 내보내기</ShDropdownMenuItem>
                    <ShDropdownMenuItem onSelect={importChat}><HardDriveUploadIcon size={16} />가져오기</ShDropdownMenuItem>
                    <ShDropdownMenuItem onSelect={() => { $bookmarkListOpen = true }}><BookmarkCheckIcon size={16} />북마크</ShDropdownMenuItem>
                </ShDropdownMenuContent>
            </ShDropdownMenu>
        </div>
        {/if}

        {#key sorted}
        <div data-chat-list-scroll class="chat-list-scroll flex flex-col mt-1 overflow-y-auto overflow-x-hidden" bind:this={listEle} style:height={`${chatListHeight}px`} onscroll={hidePreview}>
        {#snippet chatRow(chat: Chat, index: number)}
            {@const isActive = index === chara.chatPage && !$chatDeselected}
            <div data-chat-list-row data-risu-chat-idx={index} class="chat-row group flex items-center rounded-md select-none"
                class:bg-selected={isActive} class:chat-row-checked={!isActive && selectedSet.has(chat.id)}>
                {@render chatSelectBox(chat)}
                <button aria-current={isActive ? 'true' : undefined}
                    aria-describedby={preview?.chatId === chat.id ? 'chat-preview-card' : undefined}
                    onclick={(e) => { hidePreview(); onChatRowClick(e, chat, index) }}
                    onpointerdown={(e) => { hidePreview(); onChatRowPointerDown(e, chat) }}
                    onpointerenter={(e) => onChatRowPointerEnter(e, chat, index)}
                    onfocus={(e) => onChatRowFocus(e, chat, index)} onblur={hidePreview}
                    onpointermove={onChatRowPointerMove}
                    onpointerup={cancelLongPress} onpointercancel={cancelLongPress} onpointerleave={() => { cancelLongPress(); hidePreview() }}
                    oncontextmenu={(e) => { if (lastPointerType === 'touch') e.preventDefault() }}
                    class="flex min-w-0 grow items-center text-textcolor border-solid border-0 border-darkborderc p-2 pl-1 cursor-pointer rounded-md">
                    <span class="truncate">{chat.name}</span>
                </button>
                <span data-chat-drag-handle aria-hidden="true" title="끌어서 순서 바꾸기"
                    class="chat-drag-handle hidden shrink-0 cursor-grab items-center self-stretch px-1.5 text-textcolor2 opacity-70 pointer-coarse:flex">
                    <GripVerticalIcon size={16} />
                </span>
            </div>
        {/snippet}
        <!-- folder div -->
        <div class="flex flex-col" bind:this={folderEles}>
            <!-- chat folder -->
            {#each chara.chatFolders as folder, i}
            {@const folderChats = chatGroups.get(folder.id) ?? []}
            <div data-risu-chat-folder-idx={i}
                class="flex flex-col mb-2 border-solid border-1 border-darkborderc rounded-md">
                <!-- folder header: also the folder's drag handle -->
                <div data-chat-folder-header
                    class="flex items-center gap-0.5 text-textcolor p-1 rounded-md cursor-grab"
                    class:bg-red-900={folder.color === 'red'}
                    class:bg-yellow-900={folder.color === 'yellow'}
                    class:bg-green-900={folder.color === 'green'}
                    class:bg-blue-900={folder.color === 'blue'}
                    class:bg-indigo-900={folder.color === 'indigo'}
                    class:bg-purple-900={folder.color === 'purple'}
                    class:bg-pink-900={folder.color === 'pink'}
                >
                    {#if renamingFolderId === folder.id}
                        <input use:focusAndSelect value={folder.name} aria-label="폴더 이름"
                            class="min-w-0 grow rounded-md border border-darkborderc bg-bgcolor px-2 py-1 text-sm text-textcolor focus:outline-2 focus:outline-borderc"
                            onkeydown={(e) => {
                                if (e.key === 'Enter') commitFolderName(folder, e.currentTarget.value)
                                else if (e.key === 'Escape') { e.stopPropagation(); renamingFolderId = null }
                            }}
                            onblur={(e) => { if (renamingFolderId === folder.id) commitFolderName(folder, e.currentTarget.value) }} />
                    {:else}
                        <button aria-expanded={!folder.folded} aria-label={`${folder.name} 폴더, 챗 ${folderChats.length}개`}
                            onclick={() => {
                                chara.chatFolders[i].folded = !folder.folded
                                $ReloadGUIPointer += 1
                            }}
                            class="flex min-w-0 grow items-center gap-1.5 rounded-md p-1 text-left cursor-pointer">
                            <ChevronRightIcon size={16} class="shrink-0 text-textcolor2 transition-transform {folder.folded ? '' : 'rotate-90'}" />
                            <span class="truncate">{folder.name}</span>
                            <span class="shrink-0 text-xs text-textcolor2">{folderChats.length}</span>
                        </button>
                    {/if}
                    <button class="shrink-0 rounded-md p-1 text-textcolor2 hover:text-primary cursor-pointer" aria-label={`${folder.name} 폴더 색 바꾸기`} title="폴더 색 바꾸기"
                        onclick={() => void pickFolderColor(folder)}>
                        <PaletteIcon size={16}/>
                    </button>
                    <button class="shrink-0 rounded-md p-1 text-textcolor2 hover:text-primary cursor-pointer" aria-label={`${folder.name} 폴더 이름 바꾸기`} title="폴더 이름 바꾸기"
                        onclick={() => { renamingFolderId = folder.id }}>
                        <PencilIcon size={16}/>
                    </button>
                    <button class="shrink-0 rounded-md p-1 text-textcolor2 hover:text-danger/80 cursor-pointer" aria-label={`${folder.name} 폴더 삭제`} title="폴더 삭제"
                        onclick={() => void deleteFolder(folder, i)}>
                        <TrashIcon size={16}/>
                    </button>
                </div>
                <!-- chats in folder -->
                <!-- The empty label is CSS-only so the whole empty folder stays a Sortable drop target.
                     While a chat is dragged, a folded folder turns into a slim drop zone. -->
                <div class="risu-chat flex flex-col w-full text-textcolor border-solid border-0 border-darkborderc p-2 rounded-md
                    {folder.folded && draggingChat ? 'chat-folder-drop-zone' : 'chat-folder-body'}
                    {folder.folded && !draggingChat ? 'hidden' : ''}">
                    {#each folderChats as { chat, index } (chat.id ?? index)}
                        {@render chatRow(chat, index)}
                    {/each}
                </div>
            </div>
            {/each}
        </div>
        <!-- chat without folder div -->
        <div class="risu-chat flex flex-col">
            {#each chatGroups.get(null) ?? [] as { chat, index } (chat.id ?? index)}
                {@render chatRow(chat, index)}
            {/each}
        </div>
    </div>
    {/key}
    <SidebarResizeHandle axis="height" target={listEle} />
    </ShAccordion>
    </div>

    {#if preview}
        <div use:portal id="chat-preview-card" role="tooltip" data-chat-preview-card
            class="chat-preview-card fixed z-50 rounded-md border border-darkborderc bg-darkbg p-3 text-sm text-textcolor shadow-lg pointer-events-none"
            style:top={`${preview.top}px`} style:left={`${preview.left}px`} style:width={`min(${PREVIEW_WIDTH}px, calc(100vw - ${preview.left + 8}px))`}>
            {#if preview.loading}
                <p class="text-textcolor2">불러오는 중...</p>
            {:else}
                {#if previewPersona}
                    <div class="flex min-w-0 items-center gap-1.5 text-xs text-textcolor2">
                        <UserRoundIcon size={14} class="shrink-0" />
                        <span class="truncate text-textcolor">{previewPersona.name}</span>
                        {#if !previewPersona.bound}<span class="shrink-0">(챗에 고정 안 됨)</span>{/if}
                    </div>
                {/if}
                {#if previewMessage}
                    <div class="mt-2 flex min-w-0 items-baseline gap-1.5 border-t border-darkborderc pt-2 text-xs text-textcolor2">
                        <span class="truncate font-semibold text-textcolor">{previewMessage.speaker}</span>
                        {#if previewMessage.time}<span class="shrink-0">{previewMessage.time}</span>{/if}
                    </div>
                    <p class="chat-preview-text mt-1 whitespace-pre-line break-words">{previewMessage.text}</p>
                {:else if preview.data}
                    <p class="mt-2 text-textcolor2">아직 주고받은 메시지가 없습니다.</p>
                {:else}
                    <p class="text-textcolor2">미리보기를 불러오지 못했습니다.</p>
                {/if}
            {/if}
        </div>
    {/if}

    <div class="border-t border-selected mt-2">
        {#if DBState.db.characters[$selectedCharID]?.chaId !== '§playground' && !$chatDeselected}
            {#if DBState.db.showModelInSidebar}
                <ModelBind />
            {/if}
            {#if DBState.db.showPersonaInSidebar}
                <PersonaBind />
            {/if}
            {#if DBState.db.showPresetInSidebar}
                <PromptBind />
            {/if}
            <Toggles bind:chara={chara} noContainer />
            <ShButton className="w-full mt-2" onclick={() => {
                const char = DBState.db.characters[$selectedCharID]
                if (!char) return
                openModuleListStore.set(true)
            }}>
                <PackageIcon size={16} class="shrink-0" />
                <span class="truncate">{language.modules}</span>
            </ShButton>
        {/if}
    </div>
</div>

<style>
    .chat-list-scroll { scrollbar-gutter: stable; scrollbar-width: thin; overscroll-behavior-y: contain; scrollbar-color: color-mix(in srgb, var(--color-textcolor2) 40%, transparent) transparent; }
    .chat-list-scroll::-webkit-scrollbar { width: 6px; }
    .chat-list-scroll::-webkit-scrollbar-thumb { background: color-mix(in srgb, var(--color-textcolor2) 40%, transparent); border-radius: 999px; }
    .chat-list-scroll :global([data-chat-list-row]) { flex-shrink: 0; }
    .chat-preview-text { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 5; line-clamp: 5; overflow: hidden; line-height: 1.5; }
    .chat-list-scroll :global(.chat-row) { -webkit-touch-callout: none; }
    .chat-list-scroll :global(.chat-row-checked) { background: color-mix(in srgb, var(--color-borderc) 22%, transparent); }
    .chat-list-scroll :global(.chat-drag-handle) { touch-action: none; }
    .chat-list-scroll :global(.chat-folder-body:empty::before) { content: '챗을 끌어 놓거나, 선택한 뒤 폴더로 이동하세요'; display: block; text-align: center; font-size: 0.8125rem; color: var(--color-textcolor2); }
    .chat-list-scroll :global(.chat-folder-drop-zone) { min-height: 2.25rem; margin: 0 0.5rem 0.5rem; border: 1px dashed color-mix(in srgb, var(--color-textcolor2) 60%, transparent); justify-content: center; }
    .chat-list-scroll :global(.chat-folder-drop-zone > [data-chat-list-row]:not(.sortable-ghost)) { display: none; }
    .chat-list-scroll :global(.chat-folder-drop-zone::before) { content: '여기에 놓으면 이 폴더로 옮깁니다'; text-align: center; font-size: 0.8125rem; color: var(--color-textcolor2); }
</style>
