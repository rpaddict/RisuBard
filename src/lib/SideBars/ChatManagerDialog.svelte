<script lang="ts">
    import { tick } from 'svelte'
    import { ArrowDownAZIcon, DownloadIcon, FolderIcon, FolderInputIcon, FolderMinusIcon, FolderPlusIcon, InboxIcon, LayersIcon, ListOrderedIcon, MessagesSquareIcon, PencilIcon, SearchIcon, TrashIcon, UserRoundIcon, XIcon } from '@lucide/svelte'
    import type { Chat, character } from 'src/ts/storage/database.svelte'
    import { DBState, ReloadGUIPointer } from 'src/ts/stores.svelte'
    import { chatDeselected } from 'src/ts/stores.svelte'
    import { alertInput, notifySuccess } from 'src/ts/alert'
    import { exportChat } from 'src/ts/characters'
    import { changeChatTo, requestImmediateSave } from 'src/ts/globalApi.svelte'
    import { createUniqueDisplayName } from 'src/ts/displayName'
    import { findCharacterbyId } from 'src/ts/util'
    import { deleteCharacterChats, exportCharacterChats } from 'src/ts/risubard/chatListActions'
    import { chatIdRange, chatSection } from 'src/ts/risubard/chatListOrder'
    import { loadChatPreview } from 'src/ts/risubard/chatPreview'
    import { formatPreviewTime, toChatPreviewText } from 'src/ts/risubard/chatPreviewText'
    import type { ChatPreviewPayload } from 'src/ts/storage/chatContentPage'
    import { getEffectivePersona, resolvePersonaById } from 'src/ts/personaScopes'
    import { v4 } from 'uuid'
    import ShButton from '../UI/GUI/ShButton.svelte'
    import ShDialog from '../UI/GUI/ShDialog.svelte'
    import CheckInput from '../UI/GUI/CheckInput.svelte'
    import ShDropdownMenu from '../UI/GUI/ShDropdownMenu.svelte'
    import ShDropdownMenuTrigger from '../UI/GUI/ShDropdownMenuTrigger.svelte'
    import ShDropdownMenuContent from '../UI/GUI/ShDropdownMenuContent.svelte'
    import ShDropdownMenuItem from '../UI/GUI/ShDropdownMenuItem.svelte'
    import ShDropdownMenuSeparator from '../UI/GUI/ShDropdownMenuSeparator.svelte'

    interface Props {
        open: boolean
        chara: character
        onOpenChange(open: boolean): void
    }
    let { open, chara = $bindable(), onOpenChange }: Props = $props()

    type FolderFilter = 'all' | 'none' | string
    let query = $state('')
    let sort = $state<'saved' | 'name'>('saved')
    let folderFilter = $state<FolderFilter>('all')
    let selectedIds = $state<string[]>([])
    let anchorId: string | null = null
    let checkboxShift = false
    let focusId = $state<string | null>(chara.chats[chara.chatPage]?.id ?? null)
    let listEle: HTMLDivElement | undefined = $state()

    const folders = $derived(chara.chatFolders ?? [])
    const folderIds = $derived(new Set(folders.map(folder => folder.id).filter(Boolean)))
    const folderById = $derived(new Map(folders.map(folder => [folder.id, folder])))
    const activeId = $derived($chatDeselected ? null : chara.chats[chara.chatPage]?.id ?? null)
    const sectionCounts = $derived.by(() => {
        const counts = new Map<string | null, number>()
        for (const chat of chara.chats) {
            const key = chatSection(chat, folderIds)
            counts.set(key, (counts.get(key) ?? 0) + 1)
        }
        return counts
    })
    const collator = new Intl.Collator('ko', { numeric: true, sensitivity: 'base' })
    const visible = $derived.by(() => {
        const needle = query.trim().toLocaleLowerCase()
        const rows = chara.chats.flatMap((chat, index) => {
            if (!chat.id) return []
            const section = chatSection(chat, folderIds)
            if (folderFilter === 'none' && section !== null) return []
            if (folderFilter !== 'all' && folderFilter !== 'none' && section !== folderFilter) return []
            if (needle && !chat.name.toLocaleLowerCase().includes(needle)) return []
            return [{ chat, index, id: chat.id, section }]
        })
        if (sort === 'name') rows.sort((a, b) => collator.compare(a.chat.name, b.chat.name))
        return rows
    })
    const visibleIds = $derived(visible.map(row => row.id))
    const selectedSet = $derived(new Set(selectedIds))
    const allVisibleSelected = $derived(visibleIds.length > 0 && visibleIds.every(id => selectedSet.has(id)))
    const focusRow = $derived(chara.chats.findIndex(chat => chat.id === focusId))
    const focusChat = $derived(focusRow >= 0 ? chara.chats[focusRow] : null)
    const filterLabel = $derived(folderFilter === 'all' ? '모든 챗' : folderFilter === 'none' ? '폴더 밖' : folderById.get(folderFilter)?.name ?? '폴더')

    // Deleted chats drop out of the selection.
    $effect(() => {
        const ids = new Set(chara.chats.map(chat => chat.id))
        if (selectedIds.some(id => !ids.has(id))) selectedIds = selectedIds.filter(id => ids.has(id))
    })
    // The preview follows the list: a filter or search that hides the focused chat moves focus to the first match.
    $effect(() => {
        if (focusId && visibleIds.includes(focusId)) return
        focusId = activeId && visibleIds.includes(activeId) ? activeId : visibleIds[0] ?? null
    })


    const namedColors = new Set(['red', 'green', 'blue', 'yellow', 'indigo', 'purple', 'pink'])

    async function focusRowElement(id: string): Promise<void> {
        await tick()
        const row = listEle?.querySelector<HTMLElement>(`[data-manager-row="${CSS.escape(id)}"]`)
        row?.focus({ preventScroll: true })
        row?.scrollIntoView({ block: 'nearest' })
    }

    function selectOnly(id: string): void {
        selectedIds = [id]
        anchorId = id
        focusId = id
    }

    function selectRange(id: string): void {
        selectedIds = chatIdRange(visibleIds, anchorId ?? focusId ?? id, id)
        focusId = id
    }

    function toggle(id: string): void {
        selectedIds = selectedSet.has(id) ? selectedIds.filter(value => value !== id) : [...selectedIds, id]
        anchorId = id
        focusId = id
    }

    function onRowClick(event: MouseEvent, id: string): void {
        if (event.shiftKey) selectRange(id)
        else if (event.ctrlKey || event.metaKey) toggle(id)
        else selectOnly(id)
    }

    function toggleAllVisible(): void {
        selectedIds = allVisibleSelected
            ? selectedIds.filter(id => !visibleIds.includes(id))
            : [...new Set([...selectedIds, ...visibleIds])]
    }

    function onListKeydown(event: KeyboardEvent): void {
        if (visibleIds.length === 0) return
        const current = focusId ? visibleIds.indexOf(focusId) : -1
        let next = -1
        if (event.key === 'ArrowDown') next = Math.min(visibleIds.length - 1, current + 1)
        else if (event.key === 'ArrowUp') next = Math.max(0, current < 0 ? 0 : current - 1)
        else if (event.key === 'Home') next = 0
        else if (event.key === 'End') next = visibleIds.length - 1
        else if (event.key === 'Enter' && focusId) { event.preventDefault(); openChat(focusId); return }
        else if (event.key === 'Delete' && selectedIds.length > 0) { event.preventDefault(); void deleteChats(selectedIds); return }
        else if (event.key === ' ' && focusId) { event.preventDefault(); toggle(focusId); return }
        else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') { event.preventDefault(); selectedIds = [...visibleIds]; return }
        if (next < 0) return
        event.preventDefault()
        const id = visibleIds[next]
        if (event.shiftKey) selectRange(id)
        else selectOnly(id)
        void focusRowElement(id)
    }

    function openChat(id: string): void {
        changeChatTo(id)
        onOpenChange(false)
    }

    async function renameChat(chat: Chat): Promise<void> {
        const next = await alertInput('챗 이름 바꾸기', [], chat.name)
        if (!next?.trim()) return
        chat.name = createUniqueDisplayName(next, chara.chats, chat.id)
        chara.chats = chara.chats
        void requestImmediateSave()
    }

    async function deleteChats(ids: string[]): Promise<void> {
        const removed = await deleteCharacterChats(chara, ids)
        if (removed.length > 0) selectedIds = selectedIds.filter(id => !removed.includes(id))
    }

    async function exportChats(ids: string[]): Promise<void> {
        if (ids.length === 1) {
            const index = chara.chats.findIndex(chat => chat.id === ids[0])
            if (index >= 0) await exportChat(index)
            return
        }
        await exportCharacterChats(chara, ids)
    }

    async function createFolder(): Promise<string | null> {
        const name = (await alertInput('새 폴더 이름', [], `새 폴더 ${folders.length + 1}`))?.trim()
        if (!name) return null
        const id = v4()
        chara.chatFolders = [{ id, name, folded: false }, ...folders]
        $ReloadGUIPointer += 1
        void requestImmediateSave()
        return id
    }

    async function moveToFolder(ids: string[], target: string | null | 'new'): Promise<void> {
        const folderId = target === 'new' ? await createFolder() : target
        if (target === 'new' && !folderId) return
        const folder = folderId ? folderById.get(folderId) ?? chara.chatFolders?.find(f => f.id === folderId) : null
        let count = 0
        for (const chat of chara.chats) {
            if (!chat.id || !ids.includes(chat.id)) continue
            chat.folderId = folderId
            count++
        }
        if (count === 0) return
        if (folder) folder.folded = false
        chara.chats = chara.chats
        $ReloadGUIPointer += 1
        void requestImmediateSave()
        notifySuccess(folder ? `챗 ${count}개를 '${folder.name}' 폴더로 옮겼습니다.` : `챗 ${count}개를 폴더 밖으로 옮겼습니다.`)
    }

    // ── Preview of the focused chat ──
    let preview = $state<{ id: string, data: ChatPreviewPayload | null, loading: boolean } | null>(null)
    let previewRequest = 0
    $effect(() => {
        const chat = focusChat
        const index = focusRow
        if (!chat?.id) { preview = null; return }
        const id = chat.id
        const request = ++previewRequest
        preview = { id, data: null, loading: true }
        loadChatPreview(chara, chat, index)
            .then(data => { if (request === previewRequest) preview = { id, data, loading: false } })
            .catch(() => { if (request === previewRequest) preview = { id, data: null, loading: false } })
    })

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
</script>

{#snippet folderDot(color?: string)}
    <span class="cm-dot" class:bg-textcolor2={!namedColors.has(color ?? '')} class:bg-red-500={color === 'red'} class:bg-green-500={color === 'green'} class:bg-blue-500={color === 'blue'} class:bg-yellow-500={color === 'yellow'} class:bg-indigo-500={color === 'indigo'} class:bg-purple-500={color === 'purple'} class:bg-pink-500={color === 'pink'} aria-hidden="true"></span>
{/snippet}

{#snippet folderMenuItems(ids: string[])}
    {#each folders as folder (folder.id)}
        <ShDropdownMenuItem onSelect={() => void moveToFolder(ids, folder.id)}><FolderInputIcon size={16} /><span class="truncate">{folder.name}</span></ShDropdownMenuItem>
    {/each}
    <ShDropdownMenuItem onSelect={() => void moveToFolder(ids, null)}><FolderMinusIcon size={16} />폴더 밖으로</ShDropdownMenuItem>
    <ShDropdownMenuSeparator />
    <ShDropdownMenuItem onSelect={() => void moveToFolder(ids, 'new')}><FolderPlusIcon size={16} />새 폴더 만들어 옮기기</ShDropdownMenuItem>
{/snippet}

{#snippet navItem(filter: FolderFilter, label: string, count: number, color?: string)}
    <button type="button" class="cm-nav-item" data-manager-folder={filter} aria-pressed={folderFilter === filter}
        onclick={() => { folderFilter = filter }}>
        {#if filter === 'all'}<LayersIcon size={16} class="shrink-0" />
        {:else if filter === 'none'}<InboxIcon size={16} class="shrink-0" />
        {:else}{@render folderDot(color)}{/if}
        <span class="min-w-0 grow truncate text-left">{label}</span>
        <span class="cm-count">{count}</span>
    </button>
{/snippet}

<ShDialog {open} {onOpenChange} size="xl" tier="base" closeOnEscape
    closeAriaLabel="챗 관리 창 닫기"
    contentClass="chat-manager-dialog max-w-5xl h-[min(46rem,90vh)] overflow-hidden"
    bodyClass="cm-body">
    {#snippet title()}
        <span class="flex min-w-0 items-center gap-2"><MessagesSquareIcon size={20} class="shrink-0" /><span class="truncate">{chara.name}의 챗</span></span>
    {/snippet}
    {#snippet description()}챗 {chara.chats.length}개, 폴더 {folders.length}개<span class="cm-hint">. 두 번 클릭하거나 Enter를 누르면 챗을 엽니다.</span>{/snippet}

    <div class="cm-workspace">
        <nav class="cm-nav" aria-label="폴더">
            {@render navItem('all', '모든 챗', chara.chats.length)}
            {@render navItem('none', '폴더 밖', sectionCounts.get(null) ?? 0)}
            {#if folders.length > 0}<div class="cm-nav-divider" role="presentation"></div>{/if}
            {#each folders as folder (folder.id)}
                {@render navItem(folder.id, folder.name, sectionCounts.get(folder.id) ?? 0, folder.color)}
            {/each}
            <button type="button" class="cm-nav-item cm-nav-add" data-manager-new-folder onclick={() => void createFolder()}>
                <FolderPlusIcon size={16} class="shrink-0" /><span class="truncate">새 폴더</span>
            </button>
        </nav>

        <section class="cm-main" aria-label="챗 목록">
            <div class="cm-search-row">
                <label class="cm-search">
                    <SearchIcon size={16} class="shrink-0 text-textcolor2" />
                    <input data-manager-search type="search" placeholder="챗 이름으로 찾기" aria-label="챗 이름으로 찾기" bind:value={query} />
                    {#if query}
                        <button type="button" class="cm-icon-btn" aria-label="검색어 지우기" onclick={() => { query = '' }}><XIcon size={14} /></button>
                    {/if}
                </label>
                <div class="cm-segment" role="group" aria-label="정렬">
                    <button type="button" aria-pressed={sort === 'saved'} aria-label="저장 순서" title="사이드바와 같은 순서" onclick={() => { sort = 'saved' }}><ListOrderedIcon size={15} /><span class="cm-seg-label">저장 순서</span></button>
                    <button type="button" aria-pressed={sort === 'name'} aria-label="이름순" title="이름 가나다순" onclick={() => { sort = 'name' }}><ArrowDownAZIcon size={15} /><span class="cm-seg-label">이름순</span></button>
                </div>
            </div>

            <div class="cm-list-head">
                <CheckInput check={allVisibleSelected} onChange={toggleAllVisible} margin={false} hiddenName
                    name={allVisibleSelected ? '보이는 챗 선택 해제' : '보이는 챗 모두 선택'} className="shrink-0 pl-2 pr-1" />
                <span class="min-w-0 grow truncate text-sm" aria-live="polite">
                    {#if selectedIds.length > 0}
                        <strong class="text-textcolor">{selectedIds.length}개 선택</strong>
                    {:else}
                        <span class="text-textcolor2">{filterLabel} {visible.length}개</span>
                    {/if}
                </span>
                <div class="cm-bulk" role="toolbar" aria-label="선택한 챗 작업">
                    <ShDropdownMenu>
                        <ShDropdownMenuTrigger data-manager-move disabled={selectedIds.length === 0} class="cm-bulk-btn" title="선택한 챗을 폴더로 옮기기">
                            <FolderInputIcon size={16} /><span class="cm-bulk-label">폴더로</span>
                        </ShDropdownMenuTrigger>
                        <ShDropdownMenuContent align="end">{@render folderMenuItems(selectedIds)}</ShDropdownMenuContent>
                    </ShDropdownMenu>
                    <button type="button" class="cm-bulk-btn" data-manager-export disabled={selectedIds.length === 0} title="선택한 챗 내보내기"
                        onclick={() => void exportChats(selectedIds)}><DownloadIcon size={16} /><span class="cm-bulk-label">내보내기</span></button>
                    <button type="button" class="cm-bulk-btn cm-danger" data-manager-delete disabled={selectedIds.length === 0} title="선택한 챗 삭제 (Delete)"
                        onclick={() => void deleteChats(selectedIds)}><TrashIcon size={16} /><span class="cm-bulk-label">삭제</span></button>
                    {#if selectedIds.length > 0}
                        <button type="button" class="cm-bulk-btn" title="선택 해제" aria-label="선택 해제" onclick={() => { selectedIds = [] }}><XIcon size={16} /></button>
                    {/if}
                </div>
            </div>

            <div class="cm-list" role="listbox" aria-label={`${filterLabel} 챗`} aria-multiselectable="true" tabindex="-1"
                bind:this={listEle} onkeydown={onListKeydown}>
                {#each visible as row (row.id)}
                    {@const folder = row.section ? folderById.get(row.section) : null}
                    <div role="option" class="cm-row" data-manager-row={row.id} aria-selected={selectedSet.has(row.id)}
                        tabindex={focusId === row.id || (!focusId && row === visible[0]) ? 0 : -1}
                        class:cm-row-focus={focusId === row.id}
                        onclick={(e) => onRowClick(e, row.id)} ondblclick={() => openChat(row.id)}
                        onfocus={() => { if (!focusId) focusId = row.id }}>
                        <!-- svelte-ignore a11y_click_events_have_key_events -->
                        <!-- The checkbox adds or removes one chat (Shift extends a range) without touching the rest. -->
                        <span role="presentation" class="contents" onclickcapture={(e) => { checkboxShift = e.shiftKey }} onclick={(e) => e.stopPropagation()}>
                            <CheckInput check={selectedSet.has(row.id)} onChange={() => { if (checkboxShift) selectRange(row.id); else toggle(row.id); checkboxShift = false }}
                                margin={false} hiddenName name={`${row.chat.name} 선택`} className="shrink-0 self-stretch pl-2 pr-1" />
                        </span>
                        <span class="min-w-0 grow truncate">{row.chat.name}</span>
                        {#if row.id === activeId}<span class="cm-badge cm-badge-active">열린 챗</span>{/if}
                        {#if folder && folderFilter === 'all'}
                            <span class="cm-badge cm-badge-folder">{@render folderDot(folder.color)}<span class="cm-badge-text truncate">{folder.name}</span></span>
                        {/if}
                    </div>
                {:else}
                    <div class="cm-empty">
                        {#if query.trim()}
                            <SearchIcon size={24} />
                            <p>이름에 '{query.trim()}'이(가) 들어간 챗이 없습니다.</p>
                            <ShButton variant="ghost" size="sm" onclick={() => { query = '' }}>검색어 지우기</ShButton>
                        {:else if folderFilter === 'all'}
                            <MessagesSquareIcon size={24} /><p>아직 챗이 없습니다.</p>
                        {:else}
                            <FolderIcon size={24} />
                            <p>이 폴더는 비어 있습니다.</p>
                            <small>다른 폴더에서 챗을 선택한 뒤 '폴더로'를 눌러 옮기세요.</small>
                        {/if}
                    </div>
                {/each}
            </div>
        </section>

        <aside class="cm-preview" aria-label="챗 미리보기">
            {#if focusChat?.id}
                {@const folder = focusChat.folderId ? folderById.get(focusChat.folderId) : null}
                <h3 class="cm-preview-title" title={focusChat.name}>{focusChat.name}</h3>
                <div class="cm-meta">
                    <span class="flex min-w-0 items-center gap-1.5">
                        {#if folder}{@render folderDot(folder.color)}<span class="truncate">{folder.name}</span>
                        {:else}<InboxIcon size={13} class="shrink-0" /><span>폴더 밖</span>{/if}
                    </span>
                    {#if previewPersona}
                        <span class="flex min-w-0 items-center gap-1.5">
                            <UserRoundIcon size={13} class="shrink-0" /><span class="truncate">{previewPersona.name}</span>
                            {#if !previewPersona.bound}<span class="shrink-0">(챗에 고정 안 됨)</span>{/if}
                        </span>
                    {/if}
                </div>
                <div class="cm-message" aria-live="polite">
                    {#if preview?.loading}
                        <p class="text-textcolor2">마지막 메시지를 불러오는 중...</p>
                    {:else if previewMessage}
                        <div class="flex min-w-0 items-baseline gap-1.5 text-xs text-textcolor2">
                            <span class="truncate font-semibold text-textcolor">{previewMessage.speaker}</span>
                            {#if previewMessage.time}<span class="shrink-0">{previewMessage.time}</span>{/if}
                        </div>
                        <p class="cm-message-text">{previewMessage.text}</p>
                    {:else if preview?.data}
                        <p class="text-textcolor2">아직 주고받은 메시지가 없습니다.</p>
                    {:else}
                        <p class="text-textcolor2">미리보기를 불러오지 못했습니다.</p>
                    {/if}
                </div>
                <div class="cm-preview-actions">
                    <ShButton variant="primary" className="w-full" data-manager-open onclick={() => openChat(focusChat.id!)}
                        disabled={focusChat.id === activeId}>
                        {focusChat.id === activeId ? '지금 열려 있는 챗' : '이 챗 열기'}
                    </ShButton>
                    <div class="grid grid-cols-4 gap-1">
                        <ShButton variant="ghost" size="icon-sm" className="w-full" aria-label="이름 바꾸기" title="이름 바꾸기" data-manager-rename onclick={() => void renameChat(focusChat)}><PencilIcon size={16} /></ShButton>
                        <ShDropdownMenu>
                            <ShDropdownMenuTrigger aria-label="폴더로 옮기기" title="폴더로 옮기기" class="cm-icon-trigger"><FolderInputIcon size={16} /></ShDropdownMenuTrigger>
                            <ShDropdownMenuContent align="end">{@render folderMenuItems([focusChat.id])}</ShDropdownMenuContent>
                        </ShDropdownMenu>
                        <ShButton variant="ghost" size="icon-sm" className="w-full" aria-label="내보내기" title="내보내기" onclick={() => void exportChats([focusChat.id!])}><DownloadIcon size={16} /></ShButton>
                        <ShButton variant="destructive" size="icon-sm" className="w-full" aria-label="이 챗 삭제" title="이 챗 삭제" onclick={() => void deleteChats([focusChat.id!])}><TrashIcon size={16} /></ShButton>
                    </div>
                </div>
            {:else}
                <div class="cm-empty"><MessagesSquareIcon size={24} /><p>챗을 고르면 마지막 메시지를 여기서 봅니다.</p></div>
            {/if}
        </aside>
    </div>
</ShDialog>

<style>
    :global(.chat-manager-dialog) { display: flex; }
    :global(.cm-body) { flex: 1 1 auto; min-height: 0; display: flex; }
    .cm-workspace { display: grid; grid-template-columns: 12rem minmax(0, 1fr) 18rem; gap: 1rem; flex: 1; min-height: 0; width: 100%; }
    .cm-nav { display: flex; flex-direction: column; gap: 2px; min-height: 0; overflow-y: auto; padding-right: .75rem; border-right: 1px solid var(--color-darkborderc); }
    .cm-nav-item { display: flex; align-items: center; gap: .5rem; min-height: 2.25rem; padding: .375rem .5rem; border-radius: var(--risu-radius-md); color: var(--color-textcolor2); font-size: .875rem; cursor: pointer; }
    .cm-nav-item:hover { background: color-mix(in srgb, var(--color-selected) 60%, transparent); color: var(--color-textcolor); }
    .cm-nav-item[aria-pressed='true'] { background: var(--color-selected); color: var(--color-textcolor); font-weight: 600; }
    .cm-nav-item:focus-visible, .cm-row:focus-visible, .cm-segment button:focus-visible, .cm-bulk-btn:focus-visible { outline: 2px solid var(--color-borderc); outline-offset: -2px; }
    .cm-nav-add { margin-top: .25rem; border: 1px dashed var(--color-darkborderc); }
    .cm-nav-divider { height: 1px; margin: .375rem .25rem; background: var(--color-darkborderc); }
    .cm-count { flex-shrink: 0; font-size: .75rem; font-variant-numeric: tabular-nums; color: var(--color-textcolor2); }
    .cm-dot { width: .5rem; height: .5rem; flex-shrink: 0; border-radius: 999px; }

    .cm-main { display: flex; flex-direction: column; min-width: 0; min-height: 0; }
    .cm-search-row { display: flex; gap: .5rem; align-items: center; }
    .cm-search { display: flex; flex: 1; min-width: 0; align-items: center; gap: .5rem; height: 2.25rem; padding: 0 .625rem; border: 1px solid var(--color-darkborderc); border-radius: var(--risu-radius-md); background: var(--color-darkbg); }
    .cm-search:focus-within { outline: 2px solid var(--color-borderc); outline-offset: 1px; }
    .cm-search input { flex: 1; min-width: 0; background: transparent; color: var(--color-textcolor); font-size: .875rem; outline: none; }
    .cm-search input::-webkit-search-cancel-button { display: none; }
    .cm-icon-btn { display: grid; place-items: center; width: 1.5rem; height: 1.5rem; border-radius: var(--risu-radius-sm); color: var(--color-textcolor2); cursor: pointer; }
    .cm-icon-btn:hover { color: var(--color-textcolor); background: var(--color-selected); }
    .cm-segment { display: flex; flex-shrink: 0; padding: 2px; border: 1px solid var(--color-darkborderc); border-radius: var(--risu-radius-md); background: var(--color-darkbg); }
    .cm-segment button { display: flex; align-items: center; gap: .25rem; height: 1.875rem; padding: 0 .5rem; border-radius: var(--risu-radius-sm); font-size: .8125rem; color: var(--color-textcolor2); white-space: nowrap; cursor: pointer; }
    .cm-segment button[aria-pressed='true'] { background: var(--color-selected); color: var(--color-textcolor); }

    .cm-list-head { display: flex; align-items: center; gap: .25rem; min-height: 2.5rem; margin-top: .5rem; border-bottom: 1px solid var(--color-darkborderc); }
    .cm-bulk { display: flex; flex-shrink: 0; gap: 2px; }
    :global(.cm-bulk-btn) { display: flex; align-items: center; gap: .25rem; height: 2rem; padding: 0 .5rem; border-radius: var(--risu-radius-md); font-size: .8125rem; color: var(--color-textcolor); cursor: pointer; }
    :global(.cm-bulk-btn:hover:not(:disabled)) { background: var(--color-selected); }
    :global(.cm-bulk-btn:disabled) { opacity: .4; cursor: not-allowed; }
    .cm-danger:not(:disabled) { color: var(--color-danger); }
    :global(.cm-icon-trigger) { display: grid; place-items: center; width: 100%; height: 2rem; border-radius: var(--risu-radius-md); color: var(--color-textcolor); cursor: pointer; }
    :global(.cm-icon-trigger:hover) { background: var(--color-selected); }

    .cm-list { flex: 1; min-height: 0; overflow-y: auto; padding: .25rem 0; overscroll-behavior: contain; scrollbar-width: thin; scrollbar-color: color-mix(in srgb, var(--color-textcolor2) 40%, transparent) transparent; }
    .cm-row { display: flex; align-items: center; gap: .5rem; min-height: 2.5rem; padding-right: .5rem; border-radius: var(--risu-radius-md); font-size: .9375rem; color: var(--color-textcolor); cursor: default; user-select: none; }
    .cm-row:hover { background: color-mix(in srgb, var(--color-selected) 50%, transparent); }
    .cm-row[aria-selected='true'] { background: color-mix(in srgb, var(--color-borderc) 24%, transparent); }
    .cm-row-focus { box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--color-borderc) 70%, transparent); }
    .cm-badge { display: flex; align-items: center; gap: .3rem; flex-shrink: 1; min-width: 0; max-width: 40%; padding: .125rem .4rem; border-radius: 999px; background: var(--color-darkbg); color: var(--color-textcolor2); font-size: .75rem; }
    .cm-badge-active { flex-shrink: 0; background: color-mix(in srgb, var(--color-borderc) 30%, transparent); color: var(--color-textcolor); }
    .cm-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: .5rem; height: 100%; min-height: 10rem; padding: 1.5rem; color: var(--color-textcolor2); font-size: .875rem; text-align: center; }
    .cm-empty small { font-size: .75rem; }

    .cm-preview { display: flex; flex-direction: column; min-width: 0; min-height: 0; padding-left: 1rem; border-left: 1px solid var(--color-darkborderc); }
    .cm-preview-title { font-size: 1rem; font-weight: 600; line-height: 1.35; overflow-wrap: anywhere; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; line-clamp: 2; overflow: hidden; }
    .cm-meta { display: flex; flex-direction: column; gap: .25rem; margin-top: .5rem; font-size: .75rem; color: var(--color-textcolor2); }
    .cm-message { flex: 1; min-height: 0; overflow-y: auto; margin-top: .75rem; padding-top: .75rem; border-top: 1px solid var(--color-darkborderc); font-size: .875rem; }
    .cm-message-text { margin-top: .375rem; white-space: pre-line; overflow-wrap: anywhere; line-height: 1.6; color: var(--color-textcolor); }
    .cm-preview-actions { display: flex; flex-direction: column; gap: .5rem; padding-top: .75rem; margin-top: .75rem; border-top: 1px solid var(--color-darkborderc); }

    @media (max-width: 900px) {
        .cm-workspace { grid-template-columns: 11rem minmax(0, 1fr); grid-template-rows: minmax(0, 1fr) 13rem; }
        .cm-nav { grid-row: 1 / 3; }
        .cm-preview { grid-column: 2; padding: .75rem 0 0; border-left: 0; border-top: 1px solid var(--color-darkborderc); }
        .cm-message { margin-top: .5rem; padding-top: .5rem; }
    }
    @media (max-width: 640px) {
        .cm-workspace { grid-template-columns: minmax(0, 1fr); grid-template-rows: auto minmax(0, 1fr) 12rem; gap: .5rem; }
        .cm-nav { grid-row: auto; flex-direction: row; overflow-x: auto; overflow-y: hidden; padding: 0 0 .5rem; border-right: 0; border-bottom: 1px solid var(--color-darkborderc); scrollbar-width: none; }
        .cm-nav-item { flex-shrink: 0; max-width: 10rem; }
        .cm-nav-divider { display: none; }
        .cm-nav-add { margin-top: 0; }
        .cm-preview { grid-column: 1; }
        .cm-workspace { grid-template-rows: auto minmax(0, 1fr) auto; }
        .cm-preview { padding-top: .5rem; }
        .cm-message { display: none; }
        .cm-preview-actions { margin-top: .5rem; padding-top: .5rem; }
        .cm-segment button { padding: 0 .5rem; }
        .cm-seg-label, .cm-bulk-label, .cm-hint, .cm-badge-folder .cm-badge-text { display: none; }
        .cm-badge-folder { padding: .25rem; }
    }
</style>
