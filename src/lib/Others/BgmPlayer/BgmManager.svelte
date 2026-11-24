<script lang="ts">
    import { tick } from 'svelte'
    import { CheckIcon, ChevronsUpDownIcon, CopyIcon, DownloadIcon, FolderOpenIcon, GripVerticalIcon, LayoutTemplateIcon, Link2Icon, Maximize2Icon, Minimize2Icon, EllipsisIcon, EllipsisVerticalIcon, PanelLeftCloseIcon, PanelLeftOpenIcon, PencilIcon, PauseIcon, PlayIcon, PlusIcon, SkipForwardIcon, StarIcon, Trash2Icon, Undo2Icon, UploadIcon, XIcon } from '@lucide/svelte'
    import ShDropdownMenu from 'src/lib/UI/GUI/ShDropdownMenu.svelte'
    import ShDropdownMenuTrigger from 'src/lib/UI/GUI/ShDropdownMenuTrigger.svelte'
    import ShDropdownMenuContent from 'src/lib/UI/GUI/ShDropdownMenuContent.svelte'
    import ShDropdownMenuItem from 'src/lib/UI/GUI/ShDropdownMenuItem.svelte'
    import ShDropdownMenuSeparator from 'src/lib/UI/GUI/ShDropdownMenuSeparator.svelte'
    import { tooltip } from 'src/ts/gui/tooltip'
    import ManagerResizeHandles from 'src/lib/UI/GUI/ManagerResizeHandles.svelte'
    import { language } from 'src/lang'
    import { alertConfirm, notifyError, notifySuccess } from 'src/ts/alert'
    import { downloadFile } from 'src/ts/globalApi.svelte'
    import { selectSingleFile } from 'src/ts/util'
    import ShDialog from 'src/lib/UI/GUI/ShDialog.svelte'
    import SegmentedControl from 'src/lib/UI/GUI/SegmentedControl.svelte'
    import { bgmEngine } from 'src/ts/bgm/engine.svelte'
    import { bgmHistory, bgmManager, recordBgmChange, undoBgmChange } from 'src/ts/bgm/managerState.svelte'
    import type { BgmPlayMode, BgmSlotKind, BgmTrack } from 'src/ts/bgm/library'
    import { addSlot, addTemplateSlots, countNonFavorites, createSet, fillStarterSet, deleteSet, deleteSlot, duplicateSet, exportSet, importSet, moveItem, moveTrackToSlot, removeNonFavorites, removeTrackFromSlot, type BgmSlotTemplate } from 'src/ts/bgm/libraryEdits'
    import { addFolderFiles, addYouTubeText, uploadAudioFiles } from 'src/ts/bgm/trackImport'
    import BgmFolderDialog from './BgmFolderDialog.svelte'
    import { handleSortKey, sortableList } from './sortableList'

    const text = language.bgm
    const library = $derived(bgmEngine.library)
    const MAXIMIZED_KEY = 'risubard:bgm-manager-maximized'
    // Opening the manager before the player still gets the first-run mood set.
    fillStarterSet(bgmEngine.library, Object.values(text.templates), text.templates.everyday.name)

    let dialogElement = $state<HTMLElement | null>(null)
    let maximized = $state(readMaximized())

    // A per-browser view preference, like the dialog size the resize handles remember.
    function readMaximized(): boolean {
        try { return localStorage.getItem(MAXIMIZED_KEY) === '1' } catch { return false }
    }

    function toggleMaximized() {
        maximized = !maximized
        try { localStorage.setItem(MAXIMIZED_KEY, maximized ? '1' : '0') } catch { /* storage blocked */ }
    }

    let selectedSetId = $state(bgmManager.setId || bgmEngine.view.setId || bgmEngine.library.defaultSetId)
    let selectedSlotId = $state('')
    let addingYouTube = $state(false)
    let youtubeText = $state('')
    let youtubeMessage = $state('')
    let folderDialogOpen = $state(false)
    let uploading = $state(false)

    const currentSet = $derived(library.sets.find(item => item.id === selectedSetId) ?? library.sets[0])
    const slot = $derived(currentSet?.slots.find(item => item.id === selectedSlotId) ?? currentSet?.slots[0])
    const tracks = $derived((slot?.trackIds ?? []).map(id => library.tracks.find(track => track.id === id)).filter((track): track is BgmTrack => !!track))

    const kindOptions = $derived([
        { value: 'mood', label: text.kindMood },
        { value: 'place', label: text.kindPlace },
        { value: 'event', label: text.kindEvent },
    ])
    const playModeOptions = $derived([
        { value: 'shuffle', label: text.playShuffle },
        { value: 'sequential', label: text.playSequential },
        { value: 'repeat-one', label: text.playRepeatOne },
    ])

    function kindLabel(kind: BgmSlotKind) {
        return kind === 'place' ? text.kindPlace : kind === 'event' ? text.kindEvent : text.kindMood
    }

    function sourceLabel(track: BgmTrack) {
        if (track.source.kind === 'youtube') return text.sourceYouTube
        if (track.source.kind === 'file') return text.sourceFile
        return text.sourceAsset
    }

    function selectSet(setId: string) {
        selectedSetId = setId
        selectedSlotId = ''
        resetAdding()
    }

    function selectSlot(slotId: string) {
        selectedSlotId = slotId
        resetAdding()
        // On a narrow screen the slot list covers the detail; get it out of the way.
        if (narrow) slotsOpenNarrow = false
    }

    // ---- Slot pane: open/closed and width, remembered per browser ----

    const PANE_KEY = 'risubard:bgm-manager-slots'
    const PANE_DEFAULT_WIDTH = 232
    const PANE_MIN_WIDTH = 160
    let managerWidth = $state(0)
    const narrow = $derived(managerWidth > 0 && managerWidth < 600)
    const pane = readPane()
    let slotsOpenWide = $state(pane.open)
    let slotsOpenNarrow = $state(false)
    let slotsWidth = $state(pane.width)
    const slotsOpen = $derived(narrow ? slotsOpenNarrow : slotsOpenWide)

    function readPane(): { open: boolean; width: number } {
        try {
            const saved = JSON.parse(localStorage.getItem(PANE_KEY) ?? 'null')
            return {
                open: saved?.open !== false,
                width: typeof saved?.width === 'number' && Number.isFinite(saved.width) ? saved.width : PANE_DEFAULT_WIDTH,
            }
        } catch {
            return { open: true, width: PANE_DEFAULT_WIDTH }
        }
    }

    function savePane() {
        try { localStorage.setItem(PANE_KEY, JSON.stringify({ open: slotsOpenWide, width: slotsWidth })) } catch { /* storage blocked */ }
    }

    function toggleSlots() {
        if (narrow) slotsOpenNarrow = !slotsOpenNarrow
        else {
            slotsOpenWide = !slotsOpenWide
            savePane()
        }
    }

    function clampPane(width: number) {
        const max = Math.max(PANE_MIN_WIDTH, Math.min(440, managerWidth - 300))
        return Math.round(Math.min(max, Math.max(PANE_MIN_WIDTH, width)))
    }

    let paneDrag: { pointerId: number; startX: number; width: number } | null = null

    function onSlotsResizeStart(event: PointerEvent) {
        if (event.button !== 0) return
        event.preventDefault()
        paneDrag = { pointerId: event.pointerId, startX: event.clientX, width: slotsWidth }
        try { (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId) } catch { /* pointer already released */ }
    }

    function onSlotsResizeMove(event: PointerEvent) {
        if (!paneDrag || event.pointerId !== paneDrag.pointerId) return
        slotsWidth = clampPane(paneDrag.width + event.clientX - paneDrag.startX)
    }

    function onSlotsResizeEnd(event: PointerEvent) {
        if (!paneDrag || event.pointerId !== paneDrag.pointerId) return
        paneDrag = null
        savePane()
    }

    function resetSlotsWidth() {
        slotsWidth = PANE_DEFAULT_WIDTH
        savePane()
    }

    function onSlotsResizeKey(event: KeyboardEvent) {
        const step = event.shiftKey ? 40 : 10
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
        event.preventDefault()
        slotsWidth = clampPane(slotsWidth + (event.key === 'ArrowRight' ? step : -step))
        savePane()
    }

    // ---- Set rename, opened from the set menu ----

    let renaming = $state(false)
    let renameValue = $state('')

    function startRename() {
        if (!currentSet) return
        renameValue = currentSet.name
        renaming = true
    }

    function commitRename() {
        if (!renaming) return
        const value = renameValue.trim()
        if (value && currentSet) currentSet.name = value.slice(0, 60)
        renaming = false
    }

    function resetAdding() {
        addingYouTube = false
        youtubeText = ''
        youtubeMessage = ''
    }

    // ---- Sets ----

    function record(label: string) {
        recordBgmChange(library, label)
    }

    function undo() {
        const label = undoBgmChange(library)
        if (!label) return
        renaming = false
        resetAdding()
        notifySuccess(text.undone.replace('{action}', label))
    }

    function onManagerKey(event: KeyboardEvent) {
        if (!(event.ctrlKey || event.metaKey) || event.shiftKey || event.key.toLowerCase() !== 'z') return
        // Text fields keep their own undo.
        if ((event.target as HTMLElement).closest('input, textarea, [contenteditable]')) return
        event.preventDefault()
        undo()
    }

    function reorder<T>(items: T[], from: number, to: number) {
        record(text.actionReorder)
        moveItem(items, from, to)
    }

    function newSet() {
        record(text.newSet)
        const created = createSet(library, text.newSetName, text.defaultSlot)
        selectSet(created.id)
    }

    function copySet() {
        if (!currentSet) return
        record(text.duplicateSet)
        const copy = duplicateSet(library, currentSet.id, `${currentSet.name}${text.copySuffix}`)
        if (copy) selectSet(copy.id)
    }

    async function removeSet() {
        if (!currentSet || library.sets.length <= 1) return
        if (!await alertConfirm(text.deleteSetConfirm.replace('{name}', currentSet.name))) return
        record(text.deleteSet)
        deleteSet(library, currentSet.id)
        selectSet(library.defaultSetId)
    }

    async function exportCurrentSet() {
        if (!currentSet) return
        const data = exportSet(library, currentSet.id)
        if (!data) return
        const safeName = currentSet.name.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'bgm'
        await downloadFile(`${safeName}.risubgm.json`, JSON.stringify(data, null, 2))
    }

    async function importFromFile() {
        const file = await selectSingleFile(['json'])
        if (!file) return
        let parsed: unknown
        try { parsed = JSON.parse(new TextDecoder().decode(file.data)) }
        catch { return notifyError(text.importFailed) }
        record(text.importSet)
        const created = importSet(library, parsed)
        if (!created) {
            undoBgmChange(library)
            return notifyError(text.importFailed)
        }
        selectSet(created.id)
        notifySuccess(text.importDone.replace('{name}', created.name))
    }

    // ---- Slots ----

    function newSlot() {
        if (!currentSet) return
        record(text.newSlot)
        const created = addSlot(library, currentSet.id, text.newSlot)
        if (created) selectSlot(created.id)
    }

    function addTemplate(template: BgmSlotTemplate) {
        if (!currentSet) return
        record(text.templatesButton)
        const [created] = addTemplateSlots(library, currentSet.id, [template])
        if (created) selectSlot(created.id)
    }

    // Moods and events cover every scene; places are optional extras.
    const templates = $derived(Object.values(text.templates) as BgmSlotTemplate[])
    const templateGroups = $derived((['mood', 'event', 'place'] as const)
        .map(kind => ({ kind, items: templates.filter(template => template.kind === kind) }))
        .filter(group => group.items.length))
    const moodTemplates = $derived(templates.filter(template => template.kind !== 'place'))
    const missingMoods = $derived(currentSet
        ? moodTemplates.filter(template => !currentSet.slots.some(slot => slot.name === template.name))
        : [])
    // Same-named slots without a description (like the first default slot) get the template's.
    const moodsToDescribe = $derived(currentSet
        ? moodTemplates.filter(template => currentSet.slots.some(slot => slot.name === template.name && !slot.description.trim()))
        : [])
    const addAllMoodsLabel = $derived(missingMoods.length
        ? text.templatesAddMoods.replace('{count}', String(missingMoods.length))
        : moodsToDescribe.length ? text.templatesFillDescriptions : text.templatesMoodsDone)

    function addAllMoods() {
        if (!currentSet) return
        record(text.templatesButton)
        const added = addTemplateSlots(library, currentSet.id, moodTemplates)
        if (added.length && !selectedSlotId) selectSlot(added[0].id)
    }

    async function removeSlot() {
        if (!currentSet || !slot) return
        if (!await alertConfirm(text.deleteSlotConfirm.replace('{name}', slot.name))) return
        record(text.deleteSlot)
        deleteSlot(library, currentSet.id, slot.id)
        selectedSlotId = ''
    }

    // ---- Tracks ----

    function submitYouTube() {
        if (!slot) return
        record(text.actionAddTracks)
        const { skipped } = addYouTubeText(library, slot, youtubeText)
        youtubeMessage = skipped ? text.youtubeSkipped.replace('{count}', String(skipped)) : ''
        youtubeText = ''
        if (!skipped) addingYouTube = false
    }

    async function upload() {
        if (!slot || uploading) return
        uploading = true
        record(text.actionAddTracks)
        try { await uploadAudioFiles(library, slot) }
        catch (error) { notifyError(text.loadFailed.replace('{error}', error instanceof Error ? error.message : String(error))) }
        finally { uploading = false }
    }

    function removeTrack(trackId: string) {
        if (!slot) return
        record(text.removeTrack)
        removeTrackFromSlot(library, slot, trackId)
    }

    function toggleFavorite(track: BgmTrack) {
        track.favorite = !track.favorite
    }

    function moveTrackTo(trackId: string, targetSlotId: string) {
        const target = currentSet?.slots.find(item => item.id === targetSlotId)
        if (!slot || !target || target === slot) return
        record(text.actionMoveTrack)
        if (moveTrackToSlot(library, slot, target, trackId)) notifySuccess(text.movedTo.replace('{slot}', target.name))
    }

    async function deleteNonFavorites(scope: 'slot' | 'set') {
        const slots = scope === 'slot' ? (slot ? [slot] : []) : (currentSet?.slots ?? [])
        const count = countNonFavorites(library, slots)
        if (!count) return notifySuccess(text.nonFavoritesNone)
        if (!await alertConfirm(text.deleteNonFavoritesConfirm.replace('{count}', String(count)))) return
        record(text.actionDeleteNonFavorites)
        removeNonFavorites(library, slots)
    }

    function onGainInput(track: BgmTrack, event: Event) {
        track.gain = Number((event.currentTarget as HTMLInputElement).value)
        bgmEngine.applyVolumes()
    }

    const nowPlaying = $derived(bgmEngine.view.trackId ? library.tracks.find(track => track.id === bgmEngine.view.trackId) ?? null : null)
    const nowPlayingSlot = $derived(bgmEngine.view.slotId ? bgmEngine.currentSet().slots.find(item => item.id === bgmEngine.view.slotId)?.name ?? '' : '')

    const isPreviewing = (trackId: string) => trackId === bgmEngine.view.trackId && bgmEngine.view.playing

    /** The row button plays the track, or pauses and resumes it when it is already the current one. */
    function togglePreview(trackId: string) {
        if (trackId === bgmEngine.view.trackId) bgmEngine.toggle()
        else void preview(trackId)
    }

    async function preview(trackId: string) {
        const settings = bgmEngine.settings
        if (!settings.enabled) {
            settings.enabled = true
            settings.collapsed = true
            // Let the player mount first so YouTube videos open inside it.
            await tick()
        }
        bgmEngine.playTrack(trackId, currentSet?.id === bgmEngine.view.setId ? slot?.id : undefined)
    }
</script>

<ShDialog bind:open={bgmManager.open} size="xl" tier="base" closeOnEscape ariaLabel={text.managerTitle}
    bind:contentElement={dialogElement}
    contentClass={maximized ? 'bgm-manager-dialog is-maximized' : 'bgm-manager-dialog'} bodyClass="bgm-manager-body min-h-0 flex-1 flex flex-col overflow-hidden">
    {#snippet headerActions()}
        <button type="button" class="bgm-maximize" aria-label={maximized ? text.restoreSize : text.maximize} title={maximized ? text.restoreSize : text.maximize} aria-pressed={maximized} onclick={toggleMaximized}>
            {#if maximized}<Minimize2Icon size={16} />{:else}<Maximize2Icon size={16} />{/if}
        </button>
    {/snippet}
    {#snippet title()}{text.managerTitle}{/snippet}
    {#snippet description()}{text.managerDescription}{/snippet}

    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="bgm-manager" data-skin-part="bgm-manager" bind:clientWidth={managerWidth} onkeydown={onManagerKey}>
        <!-- Set context: one row, like the prompt preset picker in the chat sidebar. -->
        <div class="bgm-toolbar">
            <button type="button" class="bgm-icon" aria-label={slotsOpen ? text.slotsPanelClose : text.slotsPanelOpen} aria-expanded={slotsOpen} use:tooltip={slotsOpen ? text.slotsPanelClose : text.slotsPanelOpen} onclick={toggleSlots}>
                {#if slotsOpen}<PanelLeftCloseIcon size={18} />{:else}<PanelLeftOpenIcon size={18} />{/if}
            </button>

            {#if renaming && currentSet}
                <form class="bgm-rename" onsubmit={(event) => { event.preventDefault(); commitRename() }}>
                    <!-- svelte-ignore a11y_autofocus -->
                    <input class="bgm-input" bind:value={renameValue} maxlength="60" aria-label={text.setName} autofocus
                        onkeydown={(event) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); renaming = false } }}
                        onblur={commitRename} />
                </form>
            {:else}
                <ShDropdownMenu>
                    <ShDropdownMenuTrigger>
                        {#snippet child({ props })}
                            <button {...props} type="button" class="bgm-set-trigger" title={`${text.sets}: ${currentSet?.name ?? ''}`}>
                                <span class="bgm-set-name">{currentSet?.name}</span>
                                {#if currentSet?.id === library.defaultSetId}<span class="bgm-chip is-accent">{text.defaultSet}</span>{/if}
                                <ChevronsUpDownIcon size={15} class="bgm-set-chevron" />
                            </button>
                        {/snippet}
                    </ShDropdownMenuTrigger>
                    <ShDropdownMenuContent class="bgm-menu w-72 max-w-[calc(100vw-2rem)]">
                        <div class="px-2 pt-1 pb-1.5 text-[11px] text-textcolor2">{text.sets}</div>
                        {#each library.sets as item (item.id)}
                            <ShDropdownMenuItem onSelect={() => selectSet(item.id)}>
                                <span class="bgm-menu-check">{#if item.id === currentSet?.id}<CheckIcon size={15} />{/if}</span>
                                <span class="min-w-0 flex-1 truncate">{item.name}</span>
                                {#if item.id === library.defaultSetId}<span class="bgm-chip is-accent">{text.defaultSet}</span>{/if}
                                <span class="bgm-count">{text.setSlotCount.replace('{count}', String(item.slots.length))}</span>
                            </ShDropdownMenuItem>
                        {/each}
                        <ShDropdownMenuSeparator />
                        <ShDropdownMenuItem onSelect={startRename}><PencilIcon size={15} />{text.renameSet}</ShDropdownMenuItem>
                        {#if currentSet && currentSet.id !== library.defaultSetId}
                            <ShDropdownMenuItem onSelect={() => { record(text.makeDefault); library.defaultSetId = currentSet.id }}><StarIcon size={15} />{text.makeDefault}</ShDropdownMenuItem>
                        {/if}
                        <ShDropdownMenuSeparator />
                        <ShDropdownMenuItem onSelect={newSet}><PlusIcon size={15} />{text.newSet}</ShDropdownMenuItem>
                        <ShDropdownMenuItem onSelect={importFromFile}><UploadIcon size={15} />{text.importSet}</ShDropdownMenuItem>
                        <div class="px-2 pt-1.5 pb-1 text-[11px] leading-snug text-textcolor2">{text.defaultSetHelp}</div>
                    </ShDropdownMenuContent>
                </ShDropdownMenu>
            {/if}

            <div class="bgm-toolbar-actions">
                <button type="button" class="bgm-icon" aria-label={text.undo} use:tooltip={bgmHistory.size ? text.undoLabel.replace('{action}', bgmHistory.lastLabel) : text.undoNothing} disabled={!bgmHistory.size} onclick={undo}><Undo2Icon size={16} /></button>
                <span class="bgm-toolbar-divider" aria-hidden="true"></span>
                <button type="button" class="bgm-icon" aria-label={text.duplicateSet} use:tooltip={text.duplicateSet} onclick={copySet}><CopyIcon size={16} /></button>
                <button type="button" class="bgm-icon" aria-label={text.exportSet} use:tooltip={`${text.exportSet}: ${text.exportNote}`} onclick={exportCurrentSet}><DownloadIcon size={16} /></button>
                <button type="button" class="bgm-icon is-danger" aria-label={text.deleteSet} use:tooltip={library.sets.length <= 1 ? text.lastSetHelp : text.deleteSet} disabled={library.sets.length <= 1} onclick={removeSet}><Trash2Icon size={16} /></button>
            </div>
        </div>

        <div class="bgm-main" class:is-narrow={narrow}>
            {#if slotsOpen && currentSet}
                {#if narrow}<button type="button" class="bgm-scrim" aria-label={text.slotsPanelClose} onclick={toggleSlots}></button>{/if}
                <aside class="bgm-slots" style:width={narrow ? undefined : `${slotsWidth}px`} aria-label={text.slots}>
                    <div class="bgm-pane-head">
                        <span class="bgm-pane-title">{text.slots}<span class="bgm-count">{currentSet.slots.length}</span></span>
                        <span class="bgm-pane-actions">
                            <button type="button" class="bgm-icon" aria-label={text.newSlot} use:tooltip={text.newSlot} onclick={newSlot}><PlusIcon size={16} /></button>
                            <ShDropdownMenu>
                                <ShDropdownMenuTrigger>
                                    {#snippet child({ props })}
                                        <button {...props} type="button" class="bgm-icon" aria-label={text.templatesButton} title={text.templatesButton}><LayoutTemplateIcon size={16} /></button>
                                    {/snippet}
                                </ShDropdownMenuTrigger>
                                <ShDropdownMenuContent class="bgm-menu w-80 max-w-[calc(100vw-2rem)] max-h-[min(70vh,34rem)] overflow-y-auto">
                                    <div class="px-2 pt-1 pb-1.5 text-[11px] leading-snug text-textcolor2">{text.templatesHelp}</div>
                                    <ShDropdownMenuItem disabled={!missingMoods.length && !moodsToDescribe.length} onSelect={addAllMoods}>
                                        <PlusIcon size={15} /><span class="font-semibold">{addAllMoodsLabel}</span>
                                    </ShDropdownMenuItem>
                                    {#each templateGroups as group (group.kind)}
                                        <ShDropdownMenuSeparator />
                                        <div class="px-2 pt-1 pb-0.5 text-[11px] font-semibold text-textcolor2">{kindLabel(group.kind)}</div>
                                        {#each group.items as template (template.name)}
                                            <ShDropdownMenuItem disabled={currentSet.slots.some(item => item.name === template.name)} closeOnSelect={false} onSelect={() => addTemplate(template)}>
                                                <span class="bgm-template-item">
                                                    <span class="bgm-template-name">{template.name}</span>
                                                    <span class="bgm-template-desc">{template.description}</span>
                                                </span>
                                            </ShDropdownMenuItem>
                                        {/each}
                                    {/each}
                                </ShDropdownMenuContent>
                            </ShDropdownMenu>
                        </span>
                    </div>
                    {#if currentSet.slots.length}
                        <ul class="bgm-slot-list" data-sort-list use:sortableList={{ onMove: (from, to) => reorder(currentSet.slots, from, to) }}>
                            {#each currentSet.slots as item, index (item.id)}
                                <li class="bgm-slot-row" class:is-selected={item.id === slot?.id} data-slot-drop={item.id === slot?.id ? undefined : item.id}>
                                    <button type="button" class="bgm-handle" data-sort-handle aria-label={text.moveHandle} onkeydown={(event) => handleSortKey(event, index, currentSet.slots.length, (from, to) => reorder(currentSet.slots, from, to))}><GripVerticalIcon size={14} /></button>
                                    <button type="button" class="bgm-slot-main" aria-pressed={item.id === slot?.id} onclick={() => selectSlot(item.id)}>
                                        <span class="bgm-slot-name">{item.name}</span>
                                        <!-- Moods are the norm; only the other kinds are marked. -->
                                        {#if item.kind !== 'mood'}<span class="bgm-chip">{kindLabel(item.kind)}</span>{/if}
                                        <span class="bgm-count" class:is-empty={!item.trackIds.length}>{item.trackIds.length}</span>
                                    </button>
                                </li>
                            {/each}
                        </ul>
                    {:else}
                        <p class="bgm-help bgm-pane-empty">{text.noSlots}</p>
                    {/if}
                    {#if !narrow}
                        <button type="button" class="bgm-pane-resize" aria-label={text.resizeSlots} title={text.resizeSlots}
                            onpointerdown={onSlotsResizeStart} onpointermove={onSlotsResizeMove} onpointerup={onSlotsResizeEnd} onpointercancel={onSlotsResizeEnd}
                            ondblclick={resetSlotsWidth} onkeydown={onSlotsResizeKey}></button>
                    {/if}
                </aside>
            {/if}

            <section class="bgm-detail" aria-label={slot?.name ?? text.slots}>
                {#if slot}
                    <div class="bgm-detail-head">
                        <input class="bgm-input is-slot-name" bind:value={slot.name} maxlength="40" aria-label={text.slotName} />
                        <button type="button" class="bgm-icon is-danger" aria-label={text.deleteSlot} use:tooltip={text.deleteSlot} onclick={removeSlot}><Trash2Icon size={16} /></button>
                    </div>
                    <div class="bgm-options">
                        <div class="bgm-option">
                            <span class="bgm-label">{text.slotKind}</span>
                            <SegmentedControl bind:value={() => slot.kind, (value) => slot.kind = value as BgmSlotKind} size="sm" options={kindOptions} />
                        </div>
                        <div class="bgm-option">
                            <span class="bgm-label">{text.playMode}</span>
                            <SegmentedControl bind:value={() => slot.playMode, (value) => slot.playMode = value as BgmPlayMode} size="sm" options={playModeOptions} />
                        </div>
                    </div>
                    <label class="bgm-field">
                        <span class="bgm-label">{text.slotDescription}<span class="bgm-label-note">{text.slotDescriptionHelp}</span></span>
                        <textarea class="bgm-input" rows="2" bind:value={slot.description} placeholder={text.slotDescriptionPlaceholder}></textarea>
                    </label>

                    <div class="bgm-tracks-head">
                        <span class="bgm-pane-title">{text.tracks}<span class="bgm-count">{tracks.length}</span></span>
                        <span class="bgm-add">
                            <button type="button" class="bgm-button" aria-expanded={addingYouTube} onclick={() => { addingYouTube = !addingYouTube; youtubeMessage = '' }}><Link2Icon size={15} />{text.addYouTube}</button>
                            <button type="button" class="bgm-button" onclick={() => folderDialogOpen = true}><FolderOpenIcon size={15} />{text.addFolder}</button>
                            <button type="button" class="bgm-button" disabled={uploading} onclick={upload}><UploadIcon size={15} />{text.addUpload}</button>
                            <ShDropdownMenu>
                                <ShDropdownMenuTrigger>
                                    {#snippet child({ props })}
                                        <button {...props} type="button" class="bgm-icon" aria-label={text.trackTools} title={text.trackTools}><EllipsisIcon size={16} /></button>
                                    {/snippet}
                                </ShDropdownMenuTrigger>
                                <ShDropdownMenuContent class="bgm-menu w-72 max-w-[calc(100vw-2rem)]" align="end">
                                    <ShDropdownMenuItem variant="destructive" onSelect={() => deleteNonFavorites('slot')}>
                                        <StarIcon size={15} />{text.deleteNonFavoritesSlot}
                                    </ShDropdownMenuItem>
                                    <ShDropdownMenuItem variant="destructive" onSelect={() => deleteNonFavorites('set')}>
                                        <StarIcon size={15} />{text.deleteNonFavoritesSet}
                                    </ShDropdownMenuItem>
                                    <div class="px-2 pt-1.5 pb-1 text-[11px] leading-snug text-textcolor2">{text.trackToolsHelp}</div>
                                </ShDropdownMenuContent>
                            </ShDropdownMenu>
                        </span>
                    </div>
                    {#if addingYouTube}
                        <form class="bgm-youtube" onsubmit={(event) => { event.preventDefault(); submitYouTube() }}>
                            <!-- svelte-ignore a11y_autofocus -->
                            <textarea class="bgm-input" rows="3" bind:value={youtubeText} placeholder={text.youtubePlaceholder} autofocus></textarea>
                            {#if youtubeMessage}<p class="bgm-help is-warning">{youtubeMessage}</p>{/if}
                            <div class="bgm-actions">
                                <button type="button" class="bgm-button" onclick={resetAdding}>{text.cancel}</button>
                                <button type="submit" class="bgm-button is-primary" disabled={!youtubeText.trim()}>{text.add}</button>
                            </div>
                        </form>
                    {/if}
                    {#if tracks.length}
                        <ul class="bgm-track-list" data-sort-list use:sortableList={{
                            onMove: (from, to) => reorder(slot.trackIds, from, to),
                            dropTarget: { selector: '[data-slot-drop]', onDrop: (index, target) => moveTrackTo(tracks[index]?.id ?? '', target.dataset.slotDrop ?? '') },
                        }}>
                            {#each tracks as track, index (track.id)}
                                <li class="bgm-track" class:is-playing={track.id === bgmEngine.view.trackId}>
                                    <button type="button" class="bgm-handle" data-sort-handle aria-label={text.moveTrackHandle} title={text.moveTrackHandle} onkeydown={(event) => handleSortKey(event, index, tracks.length, (from, to) => reorder(slot.trackIds, from, to))}><GripVerticalIcon size={14} /></button>
                                    <button type="button" class="bgm-star" class:is-on={track.favorite} aria-label={track.favorite ? text.unfavorite : text.favorite} aria-pressed={!!track.favorite} use:tooltip={track.favorite ? text.unfavorite : text.favorite} onclick={() => toggleFavorite(track)}>
                                        <StarIcon size={15} />
                                    </button>
                                    <input class="bgm-input is-title" bind:value={track.title} aria-label={text.trackTitle} />
                                    <span class="bgm-track-tools">
                                        <span class="bgm-chip">{sourceLabel(track)}</span>
                                        <input class="bgm-gain" type="range" min="0" max="1" step="0.05" value={track.gain} aria-label={text.trackGain} title={`${text.trackGain} ${Math.round(track.gain * 100)}%`} oninput={(event) => onGainInput(track, event)} />
                                        <button type="button" class="bgm-icon" class:is-active={isPreviewing(track.id)} aria-label={isPreviewing(track.id) ? text.pause : text.preview} aria-pressed={isPreviewing(track.id)} use:tooltip={isPreviewing(track.id) ? text.pause : text.preview} onclick={() => togglePreview(track.id)}>
                                            {#if isPreviewing(track.id)}<PauseIcon size={15} />{:else}<PlayIcon size={15} />{/if}
                                        </button>
                                        <ShDropdownMenu>
                                            <ShDropdownMenuTrigger>
                                                {#snippet child({ props })}
                                                    <button {...props} type="button" class="bgm-icon" aria-label={text.trackMenu} title={text.trackMenu}><EllipsisVerticalIcon size={15} /></button>
                                                {/snippet}
                                            </ShDropdownMenuTrigger>
                                            <ShDropdownMenuContent class="bgm-menu w-60 max-w-[calc(100vw-2rem)] max-h-[min(60vh,28rem)] overflow-y-auto" align="end">
                                                <div class="px-2 pt-1 pb-1 text-[11px] text-textcolor2">{text.moveToSlot}</div>
                                                {#each currentSet?.slots.filter(item => item.id !== slot.id) ?? [] as target (target.id)}
                                                    <ShDropdownMenuItem onSelect={() => moveTrackTo(track.id, target.id)}>
                                                        <span class="min-w-0 flex-1 truncate">{target.name}</span>
                                                        <span class="bgm-count">{target.trackIds.length}</span>
                                                    </ShDropdownMenuItem>
                                                {/each}
                                                <ShDropdownMenuSeparator />
                                                <ShDropdownMenuItem variant="destructive" onSelect={() => removeTrack(track.id)}><XIcon size={15} />{text.removeTrack}</ShDropdownMenuItem>
                                            </ShDropdownMenuContent>
                                        </ShDropdownMenu>
                                    </span>
                                </li>
                            {/each}
                        </ul>
                    {:else if !addingYouTube}
                        <p class="bgm-empty">{text.managerEmptySlot}</p>
                    {/if}
                {:else}
                    <p class="bgm-empty">{currentSet?.slots.length ? text.selectSlot : text.noSlots}</p>
                {/if}
            </section>
        </div>
        {#if nowPlaying}
            <div class="bgm-now" role="group" aria-label={text.nowPlaying}>
                <button type="button" class="bgm-now-play" aria-label={bgmEngine.view.playing ? text.pause : text.play} use:tooltip={bgmEngine.view.playing ? text.pause : text.play} onclick={() => bgmEngine.toggle()}>
                    {#if bgmEngine.view.playing}<PauseIcon size={16} />{:else}<PlayIcon size={16} />{/if}
                </button>
                <span class="bgm-now-text">
                    <span class="bgm-now-label">{text.nowPlaying}{nowPlayingSlot ? ` / ${nowPlayingSlot}` : ''}</span>
                    <span class="bgm-now-title">{nowPlaying.title}</span>
                </span>
                <button type="button" class="bgm-icon" aria-label={text.next} use:tooltip={text.next} onclick={() => bgmEngine.next()}><SkipForwardIcon size={15} /></button>
            </div>
        {/if}
    </div>
    {#if !maximized}
        <ManagerResizeHandles target={dialogElement} centered resizeStorageKey="bgm-manager-dialog" />
    {/if}
</ShDialog>

{#if folderDialogOpen}
    <BgmFolderDialog bind:open={folderDialogOpen} canAdd={!!slot} onAdd={(items) => { if (slot) { record(text.actionAddTracks); addFolderFiles(library, slot, items) } }} />
{/if}

<style>
    /* Two panes need more room than the xl dialog; the resize handles set these variables. */
    :global(.bgm-manager-dialog) {
        display: flex;
        flex-direction: column;
        width: min(var(--manager-width, 60rem), calc(100vw - 2rem));
        max-width: calc(100vw - 2rem);
        height: min(var(--manager-height, 86dvh), calc(100dvh - 2rem));
        max-height: calc(100dvh - 2rem);
        overflow: hidden;
    }
    :global(.bgm-manager-dialog.is-maximized) {
        width: calc(100vw - 1rem);
        max-width: none;
        height: calc(100dvh - 1rem);
        max-height: none;
    }
    .bgm-maximize {
        position: absolute;
        top: -0.25rem;
        right: 1.75rem;
        display: grid;
        place-items: center;
        width: 28px;
        height: 28px;
        border-radius: var(--risu-radius-md);
        color: var(--color-textcolor2);
    }
    .bgm-maximize:hover { color: var(--color-textcolor); background: var(--color-selected); }

    .bgm-manager { display: flex; flex-direction: column; gap: 12px; height: 100%; min-height: 0; }

    /* ---- Toolbar ---- */
    .bgm-toolbar { display: flex; align-items: center; gap: 6px; min-width: 0; }
    .bgm-toolbar-actions { display: flex; align-items: center; gap: 2px; margin-left: auto; }
    .bgm-toolbar-divider { width: 1px; height: 18px; margin: 0 4px; background: var(--color-darkborderc); }
    .bgm-set-trigger {
        display: flex;
        align-items: center;
        gap: 8px;
        min-width: 0;
        max-width: min(100%, 22rem);
        min-height: 36px;
        padding: 0 10px 0 12px;
        border: 1px solid var(--color-darkborderc);
        border-radius: var(--risu-radius-md);
        background: var(--color-darkbutton);
        font-weight: 600;
        transition: background 0.15s ease, border-color 0.15s ease;
    }
    .bgm-set-trigger:hover, .bgm-set-trigger[data-state='open'] { background: var(--color-selected); }
    .bgm-set-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .bgm-set-trigger :global(.bgm-set-chevron) { flex-shrink: 0; color: var(--color-textcolor2); }
    .bgm-rename { flex: 1; max-width: 22rem; }
    .bgm-rename .bgm-input { width: 100%; }
    :global(.bgm-menu [data-slot='dropdown-menu-item'], .bgm-menu [role='menuitem']) { gap: 8px; }
    .bgm-menu-check { display: grid; place-items: center; width: 15px; flex-shrink: 0; color: var(--color-primary); }

    /* ---- Two panes ---- */
    .bgm-main {
        position: relative;
        display: flex;
        flex: 1;
        min-height: 0;
        border-top: 1px solid var(--color-darkborderc);
    }
    .bgm-slots {
        position: relative;
        display: flex;
        flex-direction: column;
        flex-shrink: 0;
        min-height: 0;
        border-right: 1px solid var(--color-darkborderc);
    }
    .bgm-main.is-narrow .bgm-slots {
        position: absolute;
        inset: 0 auto 0 0;
        z-index: 3;
        width: min(18rem, 86%);
        background: var(--color-darkbg);
        box-shadow: var(--risu-shadow-popover);
    }
    .bgm-scrim { position: absolute; inset: 0; z-index: 2; background: color-mix(in srgb, var(--color-overlay) 45%, transparent); }

    .bgm-pane-head { display: flex; align-items: center; justify-content: space-between; gap: 6px; min-height: 40px; padding: 8px 8px 6px 4px; }
    .bgm-pane-title { display: inline-flex; align-items: baseline; gap: 6px; font-size: 13px; font-weight: 600; color: var(--color-textcolor2); }
    .bgm-pane-actions { display: flex; gap: 2px; }
    .bgm-pane-empty { padding: 4px 8px 12px 4px; }

    .bgm-slot-list { flex: 1; min-height: 0; overflow-y: auto; padding: 0 8px 12px 0; scrollbar-width: thin; }
    .bgm-slot-row { display: flex; align-items: center; border-radius: var(--risu-radius-md); }
    .bgm-slot-row + .bgm-slot-row { margin-top: 1px; }
    .bgm-slot-row:hover { background: color-mix(in srgb, var(--color-selected) 55%, transparent); }
    .bgm-slot-row.is-selected { background: color-mix(in srgb, var(--color-primary) 14%, transparent); }
    .bgm-slot-main { display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0; min-height: 34px; padding: 0 10px 0 0; text-align: left; }
    .bgm-slot-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .bgm-slot-row.is-selected .bgm-slot-name { color: var(--color-primary); font-weight: 600; }
    /* A dragged track is over this slot: dropping moves it here. */
    .bgm-slot-row:global(.is-drop-hover) { outline: 2px dashed var(--color-primary); outline-offset: -2px; background: color-mix(in srgb, var(--color-primary) 18%, transparent); }
    .bgm-slot-row .bgm-handle { opacity: 0; }
    .bgm-slot-row:hover .bgm-handle, .bgm-slot-row:focus-within .bgm-handle { opacity: 1; }

    .bgm-pane-resize {
        position: absolute;
        top: 0;
        right: -4px;
        bottom: 0;
        width: 8px;
        padding: 0;
        border: 0;
        background: transparent;
        cursor: col-resize;
        touch-action: none;
        z-index: 1;
    }
    .bgm-pane-resize:hover, .bgm-pane-resize:focus-visible { background: color-mix(in srgb, var(--color-primary) 30%, transparent); outline: none; }

    /* ---- Detail ---- */
    .bgm-detail {
        container: bgm-detail / inline-size;
        display: flex;
        flex-direction: column;
        gap: 14px;
        flex: 1;
        min-width: 0;
        min-height: 0;
        overflow-y: auto;
        padding: 14px 4px 16px 18px;
        scrollbar-width: thin;
    }
    .bgm-main.is-narrow .bgm-detail, .bgm-main:not(:has(.bgm-slots)) .bgm-detail { padding-left: 4px; }
    .bgm-detail-head { display: flex; align-items: center; gap: 6px; }
    .bgm-input.is-slot-name { flex: 1; min-width: 0; font-size: 17px; font-weight: 600; }
    .bgm-options { display: flex; flex-wrap: wrap; gap: 10px 24px; }
    .bgm-option { display: flex; flex-direction: column; gap: 6px; }
    .bgm-field { display: flex; flex-direction: column; gap: 6px; }
    .bgm-label { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 8px; font-size: 12px; font-weight: 600; color: var(--color-textcolor2); }
    .bgm-label-note { font-weight: 400; }

    .bgm-tracks-head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; margin-top: 4px; }
    .bgm-add { display: flex; flex-wrap: wrap; gap: 6px; }

    .bgm-track-list { display: flex; flex-direction: column; border: 1px solid var(--color-darkborderc); border-radius: var(--risu-radius-md); }
    .bgm-track { display: flex; flex-wrap: wrap; align-items: center; gap: 2px 4px; min-width: 0; padding: 4px 6px 4px 0; }
    .bgm-track + .bgm-track { border-top: 1px solid var(--color-darkborderc); }
    .bgm-track.is-playing .bgm-input.is-title { color: var(--color-primary); font-weight: 600; }
    .bgm-icon.is-active { color: var(--color-primary); }

    /* ---- Now playing: the floating player sits behind this dialog, so its controls are repeated here. ---- */
    .bgm-now {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-shrink: 0;
        min-width: 0;
        padding: 6px 8px;
        border: 1px solid var(--color-darkborderc);
        border-radius: var(--risu-radius-md);
        background: var(--color-darkbutton);
    }
    .bgm-now-play {
        display: grid;
        place-items: center;
        flex-shrink: 0;
        width: 32px;
        height: 32px;
        border-radius: 999px;
        background: var(--color-primary);
        color: var(--color-bgcolor);
    }
    .bgm-now-text { display: flex; flex-direction: column; flex: 1; min-width: 0; line-height: 1.25; }
    .bgm-now-label { font-size: 11px; color: var(--color-textcolor2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .bgm-now-title { font-size: 13px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .bgm-track-tools { display: flex; align-items: center; gap: 4px; margin-left: auto; }
    .bgm-input.is-title { flex: 1 1 12rem; min-width: 0; min-height: 30px; padding: 4px 8px; border-color: transparent; background: transparent; }
    .bgm-input.is-title:hover { border-color: var(--color-darkborderc); }
    .bgm-input.is-title:focus { border-color: var(--color-darkborderc); background: var(--color-bgcolor); }
    .bgm-gain { width: 64px; flex-shrink: 0; accent-color: var(--color-primary); }
    .bgm-star {
        display: grid;
        place-items: center;
        width: 26px;
        height: 30px;
        flex-shrink: 0;
        color: var(--color-textcolor2);
        opacity: 0.45;
        transition: opacity 0.15s ease, color 0.15s ease;
    }
    .bgm-star:hover { opacity: 1; }
    .bgm-star.is-on { color: var(--color-warning); opacity: 1; }
    .bgm-star.is-on :global(svg) { fill: currentColor; }
    /* A narrow detail pane drops the controls under the title instead of squeezing it. */
    @container bgm-detail (max-width: 460px) {
        .bgm-track-tools { width: 100%; justify-content: flex-end; padding-left: 50px; }
        .bgm-gain { flex: 1; max-width: 140px; }
    }

    .bgm-empty {
        padding: 18px 16px;
        border: 1px dashed var(--color-darkborderc);
        border-radius: var(--risu-radius-md);
        font-size: 13px;
        text-align: center;
        color: var(--color-textcolor2);
    }
    .bgm-youtube { display: flex; flex-direction: column; gap: 6px; }

    /* ---- Shared bits ---- */
    .bgm-handle {
        display: grid;
        place-items: center;
        align-self: stretch;
        width: 22px;
        flex-shrink: 0;
        color: var(--color-textcolor2);
        cursor: grab;
        touch-action: none;
    }
    .bgm-handle:hover { color: var(--color-textcolor); }
    .bgm-chip {
        flex-shrink: 0;
        padding: 1px 7px;
        border-radius: 999px;
        font-size: 11px;
        font-weight: 500;
        color: var(--color-textcolor2);
        background: var(--color-selected);
    }
    .bgm-chip.is-accent { color: var(--color-primary); background: color-mix(in srgb, var(--color-primary) 16%, transparent); }
    .bgm-count { font-size: 12px; font-weight: 500; color: var(--color-textcolor2); font-variant-numeric: tabular-nums; }
    .bgm-count.is-empty { opacity: 0.55; }
    .bgm-help { font-size: 12px; line-height: 1.5; color: var(--color-textcolor2); }
    .bgm-help.is-warning { color: var(--color-warning); }
    .bgm-template-item { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
    .bgm-template-name { font-weight: 600; }
    .bgm-template-desc { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; color: var(--color-textcolor2); }

    .bgm-input {
        min-height: 34px;
        padding: 6px 10px;
        border: 1px solid var(--color-darkborderc);
        border-radius: var(--risu-radius-md);
        background: var(--color-bgcolor);
        color: var(--color-textcolor);
        resize: vertical;
    }
    .bgm-input::placeholder { color: var(--color-textcolor2); opacity: 0.8; }

    .bgm-actions { display: flex; justify-content: flex-end; gap: 6px; }
    .bgm-button {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        min-height: 32px;
        padding: 0 10px;
        border-radius: var(--risu-radius-md);
        font-size: 13px;
        color: var(--color-textcolor);
        background: var(--color-darkbutton);
        transition: background 0.15s ease;
    }
    .bgm-button:hover:not(:disabled) { background: var(--color-selected); }
    .bgm-button:disabled { opacity: 0.5; }
    .bgm-button.is-primary { color: var(--color-primary); background: color-mix(in srgb, var(--color-primary) 16%, transparent); }

    .bgm-icon {
        display: grid;
        place-items: center;
        width: 32px;
        height: 32px;
        flex-shrink: 0;
        border-radius: var(--risu-radius-md);
        color: var(--color-textcolor2);
        transition: color 0.15s ease, background 0.15s ease;
    }
    .bgm-icon:hover:not(:disabled) { color: var(--color-textcolor); background: var(--color-selected); }
    .bgm-icon.is-danger:hover:not(:disabled) { color: var(--color-draculared); }
    .bgm-icon:disabled { opacity: 0.35; }

    .bgm-manager button:focus-visible, .bgm-input:focus-visible, .bgm-gain:focus-visible, .bgm-maximize:focus-visible {
        outline: 2px solid var(--color-primary);
        outline-offset: 1px;
    }
</style>
