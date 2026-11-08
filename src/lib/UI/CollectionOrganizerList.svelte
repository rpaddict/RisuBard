<script lang="ts">
    import type { Snippet } from 'svelte'
    import { onMount } from 'svelte'
    import { resizeHandle } from 'src/ts/gui/resizeHandle'
    import {
        ChevronDownIcon,
        ChevronUpIcon,
        CheckCheckIcon,
        CheckIcon,
        FolderIcon,
        FolderPlusIcon,
        GripVerticalIcon,
        PencilIcon,
        SquareIcon,
        TrashIcon,
        XIcon,
    } from '@lucide/svelte'
    import { v4 as uuidv4 } from 'uuid'
    import { language } from 'src/lang'
    import { alertConfirm, alertInput } from 'src/ts/alert'
    import { requestImmediateSave } from 'src/ts/globalApi.svelte'
    import {
        assignItemsToFolder,
        createCollectionFolder,
        deleteCollectionFolder,
        getCollectionFolderCounts,
        getCollectionItemDragState,
        getVisibleCollectionItems,
        normalizeCollectionOrganizerState,
        renameCollectionFolder,
        reorderCollectionItemDragGroup,
        reorderVisibleCollectionItems,
        retainVisibleCollectionSelection,
        type CollectionKind,
        type CollectionOrganizerItem,
        type CollectionOrganizerState,
        type CollectionOrganizers,
    } from 'src/ts/collectionOrganizer'
    import { getDatabase } from 'src/ts/storage/database.svelte'
    import ShButton from './GUI/ShButton.svelte'
    import TextInput from './GUI/TextInput.svelte'

    interface CollectionOrganizerStatusOption {
        value: string
        label: string
    }

    interface Props {
        kind: CollectionKind
        items: CollectionOrganizerItem[]
        collectionLabel: string
        selectedFolderId?: string | null
        itemContent: Snippet<[string]>
        toolbar?: Snippet<[string | null | undefined]>
        statusOptions?: CollectionOrganizerStatusOption[]
        managerLayout?: boolean
        onDeleteItems?: (itemIds: string[]) => boolean | void | Promise<boolean | void>
    }

    let {
        kind,
        items,
        collectionLabel,
        selectedFolderId = $bindable(undefined),
        itemContent,
        toolbar,
        statusOptions = [],
        managerLayout = false,
        onDeleteItems,
    }: Props = $props()

    let search = $state('')
    let selectedStatus = $state('')
    let newFolderName = $state('')
    let selectedItemIds = $state<string[]>([])
    let moveTarget = $state<string>('')
    let draggedItemIds = $state<string[]>([])
    let primaryDraggedItemId = $state<string | null>(null)
    let draggedFolderId = $state<string | null>(null)
    let organizerElement: HTMLDivElement
    let folderElement: HTMLElement
    let compact = $state(false)
    let folderSize = $state(272)
    let paneLimit = $state(680)
    const paneId = $props.id()

    // Folders sit beside the items on wide or landscape frames, above them only on narrow portrait ones.
    // Keep in sync with the @container conditions in the style block.
    function stackedLayout(width: number, height: number) {
        return width < 720 && !(width >= 520 && width > height)
    }

    onMount(() => {
        const observer = new ResizeObserver(([entry]) => {
            compact = stackedLayout(entry.contentRect.width, entry.contentRect.height)
            paneLimit = Math.max(0, compact ? entry.contentRect.height - 252 : entry.contentRect.width - 332)
            const rect = folderElement.getBoundingClientRect()
            folderSize = compact ? rect.height : rect.width
        })
        observer.observe(organizerElement)
        return () => observer.disconnect()
    })

    function startPaneResize() {
        const { width, height } = organizerElement.getBoundingClientRect()
        const vertical = stackedLayout(width, height)
        const rect = folderElement.getBoundingClientRect()
        const initial = vertical ? rect.height : rect.width
        const limit = Math.max(0, vertical ? height - 252 : width - 332)
        const minimum = Math.min(vertical ? 128 : 208, limit)
        return (dx: number, dy: number) => {
            folderSize = Math.min(limit, Math.max(minimum, initial + (vertical ? dy : dx)))
            organizerElement.style.setProperty(vertical ? '--collection-folder-height' : '--collection-folder-width', `${folderSize}px`)
        }
    }

    function resetPanes() {
        organizerElement.style.removeProperty('--collection-folder-width')
        organizerElement.style.removeProperty('--collection-folder-height')
        const rect = folderElement.getBoundingClientRect()
        folderSize = compact ? rect.height : rect.width
    }

    const itemIds = $derived(items.map((item) => item.id))
    const organizerState = $derived(normalizeCollectionOrganizerState(
        getDatabase().collectionOrganizers?.[kind],
        itemIds,
    ))
    const visibleItems = $derived(getVisibleCollectionItems(
        organizerState,
        items,
        selectedFolderId,
        search,
        selectedStatus,
    ))
    const folderCounts = $derived(getCollectionFolderCounts(organizerState))
    const copy = $derived(language.collectionOrganizer)

    $effect(() => {
        const retainedSelection = selectedItemIds.filter((id) => itemIds.includes(id))
        if (retainedSelection.length !== selectedItemIds.length) selectedItemIds = retainedSelection

        const folderIds = organizerState.folders.map((folder) => folder.id)
        if (typeof selectedFolderId === 'string' && !folderIds.includes(selectedFolderId)) selectedFolderId = undefined
        if (moveTarget && moveTarget !== '__uncategorized__' && !folderIds.includes(moveTarget)) moveTarget = ''
    })

    function emptyState(): CollectionOrganizerState {
        return { folders: [], folderByItemId: {}, itemOrder: [] }
    }

    function currentState(): CollectionOrganizerState {
        return normalizeCollectionOrganizerState(
            getDatabase().collectionOrganizers?.[kind],
            items.map((item) => item.id),
        )
    }

    function saveState(next: CollectionOrganizerState) {
        const db = getDatabase()
        const organizers: CollectionOrganizers = db.collectionOrganizers ?? {
            promptPresets: emptyState(),
            modules: emptyState(),
            plugins: emptyState(),
            wikiPromptPresets: emptyState(),
        }
        db.collectionOrganizers = {
            ...organizers,
            [kind]: normalizeCollectionOrganizerState(next, items.map((item) => item.id)),
        }
        void requestImmediateSave()
    }

    function selectFolder(folderId: string | null | undefined) {
        selectedFolderId = folderId
        selectedItemIds = []
        moveTarget = ''
    }

    function createFolder() {
        if (!newFolderName.trim()) return
        const id = uuidv4()
        saveState(createCollectionFolder(currentState(), newFolderName, id, Date.now()))
        newFolderName = ''
        selectFolder(id)
    }

    async function renameFolder(folderId: string, currentName: string) {
        const nextName = await alertInput(copy.renameFolderPrompt, [], currentName)
        if (!nextName) return
        saveState(renameCollectionFolder(currentState(), folderId, nextName))
    }

    async function deleteFolder(folderId: string, folderName: string) {
        if (!await alertConfirm(copy.deleteFolderConfirm.replace('{}', folderName))) return
        saveState(deleteCollectionFolder(currentState(), folderId))
        if (selectedFolderId === folderId) selectFolder(undefined)
    }

    function reorderFolder(folderId: string, offset: number) {
        const state = currentState()
        const index = state.folders.findIndex((folder) => folder.id === folderId)
        const targetIndex = index + offset
        if (index < 0 || targetIndex < 0 || targetIndex >= state.folders.length) return
        const folders = [...state.folders]
        const [folder] = folders.splice(index, 1)
        folders.splice(targetIndex, 0, folder)
        saveState({ ...state, folders })
    }

    function dropFolder(targetFolderId: string) {
        if (!draggedFolderId || draggedFolderId === targetFolderId) return
        const state = currentState()
        const fromIndex = state.folders.findIndex((folder) => folder.id === draggedFolderId)
        const toIndex = state.folders.findIndex((folder) => folder.id === targetFolderId)
        if (fromIndex < 0 || toIndex < 0) return
        const folders = [...state.folders]
        const [folder] = folders.splice(fromIndex, 1)
        folders.splice(toIndex, 0, folder)
        saveState({ ...state, folders })
        draggedFolderId = null
    }

    function toggleSelection(itemId: string, checked: boolean) {
        selectedItemIds = checked
            ? Array.from(new Set([...selectedItemIds, itemId]))
            : selectedItemIds.filter((id) => id !== itemId)
        selectionAnchorId = itemId
    }

    // Press a selection box and sweep across rows to set them all to the same state.
    let selectionAnchorId: string | null = null
    let paintValue = false
    let paintLastId: string | null = null
    let paintPointer = { x: 0, y: 0 }
    let paintFrame = 0
    let listElement = $state<HTMLDivElement>()

    function setSelection(ids: readonly string[], checked: boolean) {
        const next = new Set(selectedItemIds)
        for (const id of ids) {
            if (checked) next.add(id)
            else next.delete(id)
        }
        selectedItemIds = Array.from(next)
    }

    function visibleRange(fromId: string | null, toId: string) {
        const ids = visibleItems.map((item) => item.id)
        const to = ids.indexOf(toId)
        const from = fromId ? ids.indexOf(fromId) : -1
        if (to < 0) return []
        if (from < 0) return [toId]
        return ids.slice(Math.min(from, to), Math.max(from, to) + 1)
    }

    function startSelectionPaint(event: PointerEvent, itemId: string) {
        if (event.button !== 0) return
        event.preventDefault()
        paintValue = !selectedItemIds.includes(itemId)
        setSelection(event.shiftKey ? visibleRange(selectionAnchorId, itemId) : [itemId], paintValue)
        selectionAnchorId = itemId
        paintLastId = itemId
        paintPointer = { x: event.clientX, y: event.clientY }
        window.addEventListener('pointermove', moveSelectionPaint)
        window.addEventListener('pointerup', stopSelectionPaint)
        window.addEventListener('pointercancel', stopSelectionPaint)
        paintFrame = requestAnimationFrame(scrollSelectionPaint)
    }

    function paintAtPointer() {
        if (!listElement || !paintLastId) return
        const rect = listElement.getBoundingClientRect()
        const x = Math.min(rect.right - 2, Math.max(rect.left + 2, paintPointer.x))
        const y = Math.min(rect.bottom - 2, Math.max(rect.top + 2, paintPointer.y))
        const row = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-collection-item-id]')
        const itemId = row && listElement.contains(row) ? row.dataset.collectionItemId : undefined
        if (!itemId || itemId === paintLastId) return
        setSelection(visibleRange(paintLastId, itemId), paintValue)
        paintLastId = itemId
        selectionAnchorId = itemId
    }

    function moveSelectionPaint(event: PointerEvent) {
        paintPointer = { x: event.clientX, y: event.clientY }
        paintAtPointer()
    }

    function scrollSelectionPaint() {
        if (listElement) {
            const rect = listElement.getBoundingClientRect()
            const edge = Math.min(48, rect.height / 4)
            const overshoot = paintPointer.y < rect.top + edge
                ? paintPointer.y - rect.top - edge
                : Math.max(0, paintPointer.y - rect.bottom + edge)
            if (overshoot) {
                listElement.scrollTop += Math.max(-24, Math.min(24, overshoot / 3))
                paintAtPointer()
            }
        }
        paintFrame = requestAnimationFrame(scrollSelectionPaint)
    }

    function stopSelectionPaint() {
        window.removeEventListener('pointermove', moveSelectionPaint)
        window.removeEventListener('pointerup', stopSelectionPaint)
        window.removeEventListener('pointercancel', stopSelectionPaint)
        cancelAnimationFrame(paintFrame)
        paintLastId = null
    }

    // Pointer clicks were already applied on pointerdown; only keyboard clicks (detail 0) toggle here.
    function consumeSelectionClick(event: MouseEvent) {
        if (event.detail === 0) return false
        event.preventDefault()
        event.stopPropagation()
        return true
    }

    onMount(() => stopSelectionPaint)

    function moveItems(itemIdsToMove: readonly string[], folderId: string | null) {
        const next = assignItemsToFolder(currentState(), itemIdsToMove, folderId)
        saveState(next)
        const nextVisibleIds = getVisibleCollectionItems(next, items, selectedFolderId, search)
            .map((item) => item.id)
        selectedItemIds = retainVisibleCollectionSelection(selectedItemIds, nextVisibleIds)
    }

    function bulkMove() {
        if (!selectedItemIds.length || !moveTarget) return
        moveItems(selectedItemIds, moveTarget === '__uncategorized__' ? null : moveTarget)
    }

    async function deleteSelectedItems() {
        if (!selectedItemIds.length || !onDeleteItems) return
        const itemIdsToDelete = selectedItemIds.filter((id) => itemIds.includes(id))
        if (!itemIdsToDelete.length) return
        const result = await onDeleteItems(itemIdsToDelete)
        if (result !== false) selectedItemIds = selectedItemIds.filter((id) => !itemIdsToDelete.includes(id))
    }

    function moveVisibleItem(itemId: string, offset: number) {
        const visibleIds = visibleItems.map((item) => item.id)
        const index = visibleIds.indexOf(itemId)
        const targetIndex = index + offset
        if (index < 0 || targetIndex < 0 || targetIndex >= visibleIds.length) return
        const reordered = [...visibleIds]
        const [moved] = reordered.splice(index, 1)
        reordered.splice(targetIndex, 0, moved)
        saveState(reorderVisibleCollectionItems(currentState(), reordered))
    }

    function moveManagerItemWithKeyboard(event: KeyboardEvent, itemId: string) {
        if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return
        if (event.target instanceof Element && event.target.closest('button, a, input, select, textarea')) return
        const visibleIds = visibleItems.map((item) => item.id)
        const dragState = getCollectionItemDragState(itemId, selectedItemIds)
        const dragged = new Set(dragState.itemIds)
        const visibleGroup = visibleIds.filter((visibleItemId) => dragged.has(visibleItemId))
        if (!visibleGroup.length) return
        const movingDown = event.key === 'ArrowDown'
        const edgeItemId = movingDown ? visibleGroup.at(-1)! : visibleGroup[0]
        const targetIndex = visibleIds.indexOf(edgeItemId) + (movingDown ? 1 : -1)
        const targetItemId = visibleIds[targetIndex]
        if (!targetItemId || dragged.has(targetItemId)) return
        event.preventDefault()
        const reordered = reorderCollectionItemDragGroup(
            visibleIds,
            dragState.itemIds,
            visibleGroup[0],
            targetItemId,
        )
        saveState(reorderVisibleCollectionItems(currentState(), reordered))
    }

    // Touch-friendly reorder: the floating selection bar moves the selected group one slot at a time.
    function moveSelection(movingDown: boolean) {
        const visibleIds = visibleItems.map((item) => item.id)
        const selected = new Set(selectedItemIds)
        const visibleGroup = visibleIds.filter((id) => selected.has(id))
        if (!visibleGroup.length) return
        const edgeItemId = movingDown ? visibleGroup.at(-1)! : visibleGroup[0]
        const targetItemId = visibleIds[visibleIds.indexOf(edgeItemId) + (movingDown ? 1 : -1)]
        if (!targetItemId) return
        const reordered = reorderCollectionItemDragGroup(visibleIds, visibleGroup, visibleGroup[0], targetItemId)
        saveState(reorderVisibleCollectionItems(currentState(), reordered))
    }

    function startItemDrag(event: DragEvent, itemId: string) {
        if (managerLayout && event.target instanceof Element && event.target.closest('button, a, input, select, textarea')) {
            event.preventDefault()
            return
        }
        const dragState = getCollectionItemDragState(itemId, selectedItemIds)
        primaryDraggedItemId = dragState.primaryItemId
        draggedItemIds = dragState.itemIds
        if (!event.dataTransfer) return
        event.dataTransfer.effectAllowed = 'move'
        event.dataTransfer.setData('application/x-risubard-collection-items', JSON.stringify(draggedItemIds))
    }

    function acceptCollectionDrag(event: DragEvent, allowFolders = false) {
        if (!draggedItemIds.length && !(allowFolders && draggedFolderId)) return
        event.preventDefault()
        event.stopPropagation()
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
    }

    function dropItemsOnFolder(event: DragEvent, folderId: string | null) {
        if (!draggedItemIds.length) return
        event.preventDefault()
        event.stopPropagation()
        moveItems(draggedItemIds, folderId)
        draggedItemIds = []
        primaryDraggedItemId = null
    }

    function dropItemForReorder(event: DragEvent, targetItemId: string) {
        const sourceItemId = primaryDraggedItemId
        if (!sourceItemId) return
        event.preventDefault()
        event.stopPropagation()
        const visibleIds = visibleItems.map((item) => item.id)
        const reordered = reorderCollectionItemDragGroup(
            visibleIds,
            draggedItemIds,
            sourceItemId,
            targetItemId,
        )
        if (reordered.some((itemId, index) => itemId !== visibleIds[index])) {
            saveState(reorderVisibleCollectionItems(currentState(), reordered))
        }
        draggedItemIds = []
        primaryDraggedItemId = null
    }
</script>

<div
    bind:this={organizerElement}
    class="collection-organizer overflow-hidden rounded-md border border-darkborderc"
    data-collection-organizer-list={kind}
>
  <div class="collection-organizer-layout">
    <aside bind:this={folderElement} id={`${paneId}-folders`} class="flex min-h-0 min-w-0 flex-col p-2">
        <div class="collection-folder-label mb-2 px-2 text-xs font-semibold uppercase tracking-wide text-textcolor2">{collectionLabel}</div>
        <div class="collection-folder-scroll min-h-0 grow overflow-y-auto">
            <button
                class="flex min-h-9 w-full items-center justify-between rounded-md px-2 text-left hover:bg-selected/30 focus-visible:ring-2 focus-visible:ring-borderc/50"
                class:bg-selected={selectedFolderId === undefined}
                onclick={() => selectFolder(undefined)}
            >
                <span>{copy.all}</span><span class="text-xs text-textcolor2">{folderCounts.all}</span>
            </button>
            <button
                class="flex min-h-9 w-full items-center justify-between rounded-md px-2 text-left hover:bg-selected/30 focus-visible:ring-2 focus-visible:ring-borderc/50"
                class:bg-selected={selectedFolderId === null}
                onclick={() => selectFolder(null)}
                ondragover={(event) => acceptCollectionDrag(event)}
                ondrop={(event) => dropItemsOnFolder(event, null)}
            >
                <span>{copy.uncategorized}</span><span class="text-xs text-textcolor2">{folderCounts.uncategorized}</span>
            </button>

            <div class="collection-folder-divider my-2 border-t border-darkborderc"></div>
            <div class="collection-folder-list flex flex-col gap-1" role="list" aria-label={copy.folders}>
                {#each organizerState.folders as folder, folderIndex (folder.id)}
                    <div
                        class="collection-folder group flex min-h-10 flex-wrap items-center rounded-md hover:bg-selected/30"
                        class:bg-selected={selectedFolderId === folder.id}
                        role="listitem"
                        draggable="true"
                        ondragstart={(event) => {
                            draggedFolderId = folder.id
                            event.dataTransfer?.setData('application/x-risubard-collection-folder', folder.id)
                        }}
                        ondragend={() => { draggedFolderId = null }}
                        ondragover={(event) => acceptCollectionDrag(event, true)}
                        ondrop={(event) => {
                            if (draggedFolderId) {
                                event.preventDefault()
                                event.stopPropagation()
                                dropFolder(folder.id)
                            }
                            else dropItemsOnFolder(event, folder.id)
                        }}
                    >
                        <button class="collection-folder-summary flex min-w-0 items-center gap-2 px-2 py-2 text-left" title={folder.name} onclick={() => selectFolder(folder.id)}>
                            <FolderIcon size={15} class="shrink-0" />
                            <span class="min-w-0 flex-1 truncate">{folder.name}</span>
                            <span class="text-xs text-textcolor2">{folderCounts.byFolderId[folder.id] ?? 0}</span>
                        </button>
                        <div class="collection-folder-actions flex shrink-0">
                            <ShButton variant="outline" size="icon-xs" aria-label={copy.moveFolderUp} disabled={folderIndex === 0} onclick={() => reorderFolder(folder.id, -1)}><ChevronUpIcon /></ShButton>
                            <ShButton variant="outline" size="icon-xs" aria-label={copy.moveFolderDown} disabled={folderIndex === organizerState.folders.length - 1} onclick={() => reorderFolder(folder.id, 1)}><ChevronDownIcon /></ShButton>
                            <ShButton variant="outline" size="icon-xs" aria-label={copy.renameFolder} onclick={() => renameFolder(folder.id, folder.name)}><PencilIcon /></ShButton>
                            <ShButton variant="destructive" size="icon-xs" aria-label={copy.deleteFolder} onclick={() => deleteFolder(folder.id, folder.name)}><TrashIcon /></ShButton>
                        </div>
                    </div>
                {/each}
            </div>
        </div>

        <div class="mt-2 flex gap-1 border-t border-darkborderc pt-2">
            <TextInput
                size="sm"
                className="min-w-0 grow"
                bind:value={newFolderName}
                placeholder={copy.newFolderPlaceholder}
                onkeydown={(event) => { if (event.key === 'Enter') createFolder() }}
            />
            <ShButton variant="outline" size="icon-sm" aria-label={copy.createFolder} disabled={!newFolderName.trim()} onclick={createFolder}><FolderPlusIcon /></ShButton>
        </div>
    </aside>

    <!-- A focusable ARIA separator is the keyboard-operable window splitter pattern. -->
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <div role="separator" tabindex="0" class="collection-splitter" data-collection-splitter
        aria-label={copy.resizePanes} aria-controls={`${paneId}-folders`} aria-orientation={compact ? 'horizontal' : 'vertical'}
        aria-valuemin={Math.min(compact ? 128 : 208, paneLimit)} aria-valuemax={paneLimit} aria-valuenow={Math.round(Math.min(folderSize, paneLimit))}
        title={copy.resizeHint} use:resizeHandle={{ start: startPaneResize, reset: resetPanes }}><span></span></div>

    <section class="collection-items-pane flex min-h-0 min-w-0 flex-col gap-2 overflow-auto p-3">
        <div class="collection-toolbar flex min-w-0 shrink-0 flex-wrap items-center gap-2">
            <TextInput className="min-w-0 flex-1 basis-48" bind:value={search} placeholder={copy.searchPlaceholder} />
            {#if statusOptions.length > 0}
                <select
                    class="min-h-8 min-w-32 rounded-md border border-darkborderc bg-darkbg px-2 text-sm text-textcolor focus:outline-none focus:ring-2 focus:ring-borderc/50"
                    bind:value={selectedStatus}
                    aria-label={copy.filterStatus}
                >
                    <option value="">{copy.allStatuses}</option>
                    {#each statusOptions as option (option.value)}
                        <option value={option.value}>{option.label}</option>
                    {/each}
                </select>
            {/if}
            {#if toolbar}{@render toolbar(selectedFolderId)}{/if}
        </div>

        <!-- Floats over the list so selecting never shifts the rows under a sweeping pointer. -->
        {#if selectedItemIds.length}
            <div class="collection-selection-bar" role="toolbar" aria-label={copy.selectedCount.replace('{}', String(selectedItemIds.length))}>
                <span class="collection-selection-count">{copy.selectedCount.replace('{}', String(selectedItemIds.length))}</span>
                <div class="collection-selection-order">
                    <ShButton variant="ghost" size="icon-sm" aria-label={copy.moveItemUp} title={copy.moveItemUp} onclick={() => moveSelection(false)}><ChevronUpIcon /></ShButton>
                    <ShButton variant="ghost" size="icon-sm" aria-label={copy.moveItemDown} title={copy.moveItemDown} onclick={() => moveSelection(true)}><ChevronDownIcon /></ShButton>
                    {#if !managerLayout}
                        <ShButton variant="ghost" size="icon-sm" aria-label={copy.selectVisible} title={copy.selectVisible} onclick={() => {
                            selectedItemIds = Array.from(new Set([...selectedItemIds, ...visibleItems.map((item) => item.id)]))
                        }}><CheckCheckIcon /></ShButton>
                    {/if}
                    <ShButton variant="ghost" size="icon-sm" aria-label={copy.clearSelection} title={copy.clearSelection} onclick={() => { selectedItemIds = [] }}><XIcon /></ShButton>
                </div>
                <div class="collection-selection-move">
                    <select
                        class="min-h-8 min-w-0 max-w-56 flex-1 rounded-md border border-darkborderc bg-darkbg px-2 text-sm text-textcolor focus:outline-none focus:ring-2 focus:ring-borderc/50"
                        bind:value={moveTarget}
                        aria-label={copy.moveTarget}
                    >
                        <option value="">{copy.chooseFolder}</option>
                        <option value="__uncategorized__">{copy.uncategorized}</option>
                        {#each organizerState.folders as folder (folder.id)}
                            <option value={folder.id}>{folder.name}</option>
                        {/each}
                    </select>
                    <ShButton variant="outline" size="sm" disabled={!moveTarget} onclick={bulkMove}>{copy.moveSelected}</ShButton>
                    {#if onDeleteItems}
                        <ShButton variant="destructive" size="icon-sm" aria-label={copy.deleteSelected} title={copy.deleteSelected} onclick={deleteSelectedItems}><TrashIcon size={16} /></ShButton>
                    {/if}
                </div>
            </div>
        {/if}

        <div bind:this={listElement} class="collection-items flex min-h-40 flex-1 flex-col divide-y divide-darkborderc overflow-y-auto rounded-md border border-darkborderc" class:collection-items--manager={managerLayout} class:collection-items--selecting={selectedItemIds.length > 0} role="list" aria-label={copy.items}>
            {#if visibleItems.length === 0}
                <p class="m-auto p-6 text-sm text-textcolor2">{copy.noItems}</p>
            {:else}
                {#each visibleItems as item, itemIndex (item.id)}
                    <div
                        class="collection-item flex min-w-0 shrink-0 items-start hover:bg-selected/20"
                        class:collection-item--manager={managerLayout}
                        class:collection-item--selected={selectedItemIds.includes(item.id)}
                        class:gap-2={!managerLayout}
                        class:p-2={!managerLayout}
                        role="listitem"
                        data-collection-item-id={item.id}
                        ondragover={(event) => acceptCollectionDrag(event)}
                        ondrop={(event) => dropItemForReorder(event, item.id)}
                    >
                        {#if managerLayout}
                        <div
                            class="collection-item-selection-rail"
                            role="group"
                            aria-label={copy.selectItem.replace('{}', item.title)}
                            title={copy.selectDragHint}
                            onpointerdown={(event) => startSelectionPaint(event, item.id)}
                        >
                            <ShButton
                                variant={selectedItemIds.includes(item.id) ? 'soft-primary' : 'ghost'}
                                size="icon-xs"
                                aria-label={copy.selectItem.replace('{}', item.title)}
                                aria-pressed={selectedItemIds.includes(item.id)}
                                onclick={(event: MouseEvent) => {
                                    if (consumeSelectionClick(event)) return
                                    toggleSelection(item.id, !selectedItemIds.includes(item.id))
                                }}
                            >
                                {#if selectedItemIds.includes(item.id)}<CheckIcon size={17} />{:else}<SquareIcon size={17} />{/if}
                            </ShButton>
                        </div>
                        {:else}
                        <div
                            class="collection-item-select -m-2 mr-0 flex shrink-0 self-stretch p-2 pr-0"
                            role="presentation"
                            title={copy.selectDragHint}
                            onpointerdown={(event) => startSelectionPaint(event, item.id)}
                        >
                            <input
                                type="checkbox"
                                class="mt-2 size-4 shrink-0 cursor-pointer accent-primary"
                                aria-label={copy.selectItem.replace('{}', item.title)}
                                checked={selectedItemIds.includes(item.id)}
                                onclick={consumeSelectionClick}
                                onchange={(event) => toggleSelection(item.id, event.currentTarget.checked)}
                            />
                        </div>
                        <button
                            type="button"
                            class="mt-0.5 flex size-7 shrink-0 cursor-grab items-center justify-center rounded text-textcolor2 hover:bg-selected/40 hover:text-textcolor active:cursor-grabbing"
                            draggable="true"
                            data-collection-drag-handle
                            aria-label={copy.dragItem}
                            onclick={(event) => event.stopPropagation()}
                            ondragstart={(event) => startItemDrag(event, item.id)}
                            ondragend={() => {
                                draggedItemIds = []
                                primaryDraggedItemId = null
                            }}
                        ><GripVerticalIcon size={16} /></button>
                        {/if}
                        <!-- The draggable group is intentionally focusable for its Alt+Arrow keyboard reorder alternative. -->
                        <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
                        <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
                        <div
                            class="collection-item-content min-w-0 grow"
                            class:collection-item-content--drag-handle={managerLayout}
                            role="group"
                            tabindex={managerLayout ? 0 : undefined}
                            draggable={managerLayout}
                            data-collection-item-drag-handle={managerLayout ? '' : undefined}
                            aria-label={managerLayout ? copy.dragItem : undefined}
                            title={managerLayout ? copy.dragItemKeyboardHint : undefined}
                            onkeydown={(event) => moveManagerItemWithKeyboard(event, item.id)}
                            ondragstart={(event) => { if (managerLayout) startItemDrag(event, item.id) }}
                            ondragend={() => {
                                draggedItemIds = []
                                primaryDraggedItemId = null
                            }}
                        >{@render itemContent(item.id)}</div>
                        {#if !managerLayout}
                        <div class="collection-item-order flex shrink-0 pt-1">
                            <ShButton variant="ghost" size="icon-sm" aria-label={copy.moveItemUp} disabled={itemIndex === 0} onclick={() => moveVisibleItem(item.id, -1)}><ChevronUpIcon /></ShButton>
                            <ShButton variant="ghost" size="icon-sm" aria-label={copy.moveItemDown} disabled={itemIndex === visibleItems.length - 1} onclick={() => moveVisibleItem(item.id, 1)}><ChevronDownIcon /></ShButton>
                        </div>
                        {/if}
                    </div>
                {/each}
            {/if}
        </div>
    </section>
  </div>
</div>

<style>
    .collection-organizer { container-name: collection-manager; container-type: size; width: 100%; height: min(70dvh, 46rem); min-height: 0; flex: 1; border-color: var(--settings-border, var(--color-darkborderc)); border-radius: var(--settings-radius, var(--risu-radius-xl)); background: var(--settings-surface, var(--color-bgcolor)); }
    .collection-organizer-layout { display: grid; height: 100%; min-width: 0; min-height: 0; grid-template-columns: minmax(0, 1fr); grid-template-rows: clamp(6rem, var(--collection-folder-height, 16rem), max(6rem, calc(100% - 15rem))) .75rem minmax(0, 1fr); }
    .collection-splitter { display: flex; align-items: center; justify-content: center; min-width: 0; min-height: 0; padding: 0; border: 0; background: var(--color-darkbg); cursor: row-resize; touch-action: none; }
    .collection-splitter span { width: 2rem; height: 3px; border-radius: calc(var(--risu-radius-sm) * 0.75); background: var(--color-borderc); }
    .collection-splitter:hover, .collection-splitter:focus-visible, .collection-splitter:global([data-resizing]) { outline: none; background: color-mix(in srgb, var(--color-borderc) 25%, var(--color-darkbg)); }
    .collection-items-pane { container-name: collection-items; container-type: inline-size; }
    .collection-folder { flex-direction: column; align-items: stretch; padding: .2rem; }
    .collection-folder-summary { width: 100%; }
    .collection-folder-actions { width: 100%; justify-content: flex-end; gap: .25rem; padding: 0 .3rem .3rem; }
    .collection-item { transition: background-color 180ms ease, border-color 180ms ease; }
    /* Rows stay title-sized, so the list fills its width with as many columns as fit: one on phones, two or three on wide or landscape screens. */
    .collection-items--manager { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, var(--collection-item-min, 18rem)), 1fr)); grid-auto-rows: max-content; align-content: start; gap: .5rem; border: 0; border-radius: 0; background: transparent; }
    .collection-items--selecting { padding-bottom: 4.5rem; }
    .collection-items-pane { position: relative; }
    .collection-selection-bar { position: absolute; right: .75rem; bottom: .75rem; left: .75rem; z-index: 2; display: flex; flex-wrap: wrap; align-items: center; gap: .5rem; padding: .4rem .5rem .4rem .75rem; border: 1px solid var(--settings-border, var(--color-darkborderc)); border-radius: var(--settings-radius, var(--risu-radius-xl)); background: color-mix(in srgb, var(--color-selected) 18%, var(--settings-surface, var(--color-bgcolor))); box-shadow: var(--risu-shadow-floating, 0 .5rem 1.5rem -.5rem color-mix(in srgb, var(--color-shadow) 55%, transparent)); }
    .collection-selection-order { display: flex; flex: 1 1 auto; align-items: center; gap: .1rem; }
    .collection-selection-move { display: flex; flex: 1 1 16rem; min-width: 0; align-items: center; justify-content: flex-end; gap: .4rem; }
    .collection-selection-count { font-size: .8rem; font-weight: 600; color: var(--color-textcolor); font-variant-numeric: tabular-nums; }
    .collection-item--manager:has(:global([aria-expanded="true"])) { grid-column: 1 / -1; }
    .collection-item--manager { align-items: stretch; overflow: hidden; min-height: 3.25rem; border: 1px solid var(--settings-border, var(--color-darkborderc)); border-radius: var(--settings-radius, var(--risu-radius-xl)); background: var(--settings-surface, var(--color-bgcolor)); }
    .collection-item--manager .collection-item-content { min-width: 0; padding: .45rem .7rem; }
    .collection-item--selected { border-color: color-mix(in srgb, var(--color-borderc) 70%, var(--settings-border, var(--color-darkborderc))); background: color-mix(in srgb, var(--color-selected) 22%, var(--settings-surface, var(--color-bgcolor))); }
    .collection-item-selection-rail { display: flex; width: 2.5rem; flex: 0 0 2.5rem; align-self: stretch; align-items: center; justify-content: center; border-right: 1px solid var(--settings-border, var(--color-darkborderc)); background: color-mix(in srgb, var(--settings-surface, var(--color-bgcolor)) 88%, var(--risu-theme-textcolor)); }
    .collection-item-selection-rail :global(button) { width: 100%; min-height: 2.5rem; border-radius: 0; }
    .collection-item-select, .collection-item-selection-rail { cursor: pointer; touch-action: none; user-select: none; }
    .collection-item-content--drag-handle { cursor: grab; }
    .collection-item-content--drag-handle:active { cursor: grabbing; }
    .collection-item-content--drag-handle :global(button), .collection-item-content--drag-handle :global(a), .collection-item-content--drag-handle :global(input), .collection-item-content--drag-handle :global(select), .collection-item-content--drag-handle :global(textarea) { cursor: pointer; }
    @container collection-manager (min-width: 720px) or ((min-width: 520px) and (orientation: landscape)) {
        .collection-organizer-layout { grid-template-rows: minmax(0, 1fr); grid-template-columns: clamp(13rem, var(--collection-folder-width, min(17rem, 28cqw)), calc(100% - 21rem)) .75rem minmax(0, 1fr); }
        .collection-splitter { cursor: col-resize; }
        .collection-splitter span { width: 3px; height: 2rem; }
    }
    /* Narrow portrait: folders collapse into a wrapping chip strip so the item list keeps most of the height. */
    @container collection-manager not ((min-width: 720px) or ((min-width: 520px) and (orientation: landscape))) {
        /* Until the splitter sets a height, the strip only takes what its chips need. An unset height invalidates the track and selects the fallback. */
        .collection-organizer-layout {
            --collection-folder-track: clamp(5.5rem, var(--collection-folder-height), max(5.5rem, calc(100% - 15rem)));
            grid-template-rows: var(--collection-folder-track, fit-content(max(5.5rem, calc(100% - 15rem)))) .75rem minmax(0, 1fr);
        }
        .collection-folder-label, .collection-folder-divider { display: none; }
        .collection-folder-scroll { display: flex; flex-wrap: wrap; align-content: flex-start; gap: .25rem; }
        .collection-folder-scroll > button { width: auto; gap: .6rem; padding-inline: .7rem; }
        .collection-folder-list { flex-direction: row; flex-wrap: wrap; gap: .25rem; }
        .collection-folder { flex-direction: row; align-items: center; min-height: 2.25rem; padding: 0; }
        .collection-folder-summary { width: auto; padding-block: .35rem; }
        .collection-folder:not(.bg-selected) .collection-folder-actions { display: none; }
        .collection-folder-actions { width: auto; padding: 0 .3rem 0 0; }
        .collection-items-pane { padding: .5rem; }
    }
    /* Flat frames (landscape phones): denser rows and padding so more items fit in the short height. */
    @container collection-manager (max-height: 440px) {
        .collection-items-pane { gap: .4rem; padding: .5rem; }
        .collection-items--manager { gap: .35rem; }
        .collection-item--manager { min-height: 2.75rem; }
        .collection-item--manager .collection-item-content { padding-block: .2rem; }
    }
    @container collection-items (max-width: 520px) {
        /* One line per item: selection, handle, content and order buttons share the row. */
        .collection-item:not(.collection-item--manager) { align-items: center; gap: .25rem; padding: .3rem .4rem; }
        .collection-item-select { margin: -.3rem 0 -.3rem -.4rem; padding: .3rem 0 .3rem .4rem; align-items: center; }
        .collection-item-select input { margin-top: 0; }
        .collection-item-order { display: none; }
        .collection-toolbar :global(input) { flex-basis: 6rem; }
        .collection-toolbar select { min-width: 0; flex: 0 1 7rem; }
    }
    @media (pointer: coarse) {
        .collection-folder-actions :global(button), .collection-item-order :global(button), .collection-toolbar :global(button) { min-width: 2.5rem; min-height: 2.5rem; }
        .collection-splitter span { border-radius: 0; box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-borderc) 25%, transparent); }
    }
</style>
