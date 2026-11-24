<script lang="ts">
    import { onDestroy, onMount, untrack } from 'svelte'
    import { ChevronDownIcon, ArrowLeftIcon, PlusIcon, Settings2Icon, Trash2Icon, XIcon, FolderOpenIcon, UploadIcon, Link2Icon, ListMusicIcon, Maximize2Icon, Minimize2Icon, PictureInPicture2Icon, RectangleHorizontalIcon } from '@lucide/svelte'
    import { language } from 'src/lang'
    import { alertConfirm, notifyError } from 'src/ts/alert'
    import { DBState, selectedCharID, settingsOpen } from 'src/ts/stores.svelte'
    import { bgmEngine } from 'src/ts/bgm/engine.svelte'
    import { BGM_MAX_CROSSFADE_MS, findBgmSet, resolveActiveSetId, type BgmInactiveMute, type BgmTrack } from 'src/ts/bgm/library'
    import { addSlot, deleteSlot, fillStarterSet, removeTrackFromSlot } from 'src/ts/bgm/libraryEdits'
    import { addFolderFiles, addYouTubeText, uploadAudioFiles } from 'src/ts/bgm/trackImport'
    import { openBgmManager, recordBgmChange } from 'src/ts/bgm/managerState.svelte'
    import { installBgmDj } from 'src/ts/bgm/djRunner'
    import { BGM_DJ_LIMITS } from 'src/ts/bgm/library'
    import { assistantPromptJump } from 'src/ts/risubard/assistantPrompts'
    import { openSettings, SettingsRoute } from 'src/ts/routing'
    import { BGM_DEFAULT_PLACEMENT, clampPlayerSize, formatBgmTime, placementFromPosition, positionFromPlacement } from 'src/ts/bgm/placement'
    import SolarBoldIcon from 'src/lib/UI/Icons/SolarBoldIcon.svelte'
    import SegmentedControl from 'src/lib/UI/GUI/SegmentedControl.svelte'
    import BgmFolderDialog from './BgmFolderDialog.svelte'

    const text = language.bgm
    const view = bgmEngine.view
    const DRAG_THRESHOLD = 6

    const settings = $derived(bgmEngine.settings)
    const library = $derived(bgmEngine.library)
    const set = $derived(findBgmSet(library, view.setId))
    const characterSetId = $derived.by(() => {
        const character = DBState.db.characters?.[$selectedCharID]
        return character && 'bgmSetId' in character ? character.bgmSetId : undefined
    })

    // Follow the selected bot's set; untracked so the engine's own state changes do not loop back here.
    $effect(() => {
        const setId = resolveActiveSetId(library, characterSetId)
        untrack(() => bgmEngine.useSet(setId))
    })
    const slot = $derived(set.slots.find(item => item.id === view.slotId) ?? set.slots[0])
    const tracks = $derived((slot?.trackIds ?? []).map(id => library.tracks.find(track => track.id === id)).filter((track): track is BgmTrack => !!track))
    const current = $derived(view.trackId ? library.tracks.find(track => track.id === view.trackId) : undefined)
    const collapsed = $derived(settings.collapsed)
    const maximized = $derived(!settings.collapsed && settings.maximized)

    let panel = $state<'main' | 'settings'>('main')
    const miniVideo = $derived(!collapsed && panel === 'main' && view.youtubeVisible && settings.videoSize === 'small')
    let adding = $state<'' | 'youtube' | 'slot'>('')
    let youtubeText = $state('')
    let youtubeMessage = $state('')
    let slotName = $state('')
    let folderDialogOpen = $state(false)
    let uploading = $state(false)
    let seekPreview = $state<number | null>(null)
    let lastAudibleVolume = 0.6

    let root: HTMLElement | undefined = $state()
    let videoHost: HTMLElement | undefined = $state()
    let position = $state({ left: -9999, top: -9999 })

    const dj = $derived(settings.dj)
    const djTitle = $derived.by(() => {
        if (!dj.enabled) return ''
        if (view.dj === 'thinking') return text.djThinking
        if (view.dj === 'failed') return text.djFailed
        if (view.dj === 'held') return text.djHeld
        if (set.slots.length < 2) return text.djNeedsSlots
        return view.djPick ? text.djPicked.replace('{name}', view.djPick) : text.djTitle
    })

    function editDjPrompt() {
        assistantPromptJump.key = 'bgmDj'
        openSettings(SettingsRoute.RisuBardAssistantPrompt)
    }

    function setMuteMode(mode: BgmInactiveMute) {
        settings.muteWhenInactive = mode
        bgmEngine.refreshInactiveMode()
    }

    const noticeText = $derived.by(() => {
        switch (view.notice) {
            case 'blocked': return text.noticeBlocked
            case 'unavailable': return text.noticeUnavailable
            case 'embed-refused': return text.noticeEmbedRefused
            // An empty slot already says so in its track list.
            case 'empty': return slot ? '' : text.noticeEmpty
            default: return ''
        }
    })

    function sourceLabel(track: BgmTrack) {
        if (track.source.kind === 'youtube') return text.sourceYouTube
        if (track.source.kind === 'file') return text.sourceFile
        return text.sourceAsset
    }

    // ---- Placement and dragging ----

    function viewport() {
        return { width: window.innerWidth, height: window.innerHeight }
    }

    function place() {
        if (!root) return
        const rect = root.getBoundingClientRect()
        position = positionFromPlacement(settings.placement, viewport(), { width: rect.width, height: rect.height })
    }

    // ---- Resizing ----

    /** Size while a resize drag is in progress; committed to settings when it ends. */
    let liveSize = $state<{ width: number; height: number } | null>(null)
    const cardSize = $derived(collapsed || maximized ? null : liveSize ?? settings.size ?? null)
    // The grip sits on the corner that faces the middle of the window, so a card docked to an
    // edge grows toward open space while the docked edge stays put.
    const gripLeft = $derived((settings.placement ?? BGM_DEFAULT_PLACEMENT).xRatio > 0.5)
    const gripTop = $derived((settings.placement ?? BGM_DEFAULT_PLACEMENT).yRatio > 0.5)
    let resize: { pointerId: number; startX: number; startY: number; width: number; height: number } | null = null

    function onResizeStart(event: PointerEvent) {
        if (event.button !== 0 || !root) return
        event.preventDefault()
        event.stopPropagation()
        const rect = root.getBoundingClientRect()
        resize = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, width: rect.width, height: rect.height }
        try { (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId) } catch { /* pointer already released */ }
    }

    function onResizeMove(event: PointerEvent) {
        if (!resize || event.pointerId !== resize.pointerId) return
        event.stopPropagation()
        const dx = (event.clientX - resize.startX) * (gripLeft ? -1 : 1)
        const dy = (event.clientY - resize.startY) * (gripTop ? -1 : 1)
        liveSize = clampPlayerSize({ width: resize.width + dx, height: resize.height + dy }, viewport())
    }

    function onResizeEnd(event: PointerEvent) {
        if (!resize || event.pointerId !== resize.pointerId) return
        event.stopPropagation()
        if (liveSize) settings.size = liveSize
        liveSize = null
        resize = null
    }

    function resetSize() {
        delete settings.size
        liveSize = null
    }

    function onResizeKey(event: KeyboardEvent) {
        if (!root) return
        const step = event.shiftKey ? 40 : 10
        const keys: Record<string, [number, number]> = {
            ArrowLeft: [gripLeft ? step : -step, 0],
            ArrowRight: [gripLeft ? -step : step, 0],
            ArrowUp: [0, gripTop ? step : -step],
            ArrowDown: [0, gripTop ? -step : step],
        }
        const delta = keys[event.key]
        if (!delta) return
        event.preventDefault()
        const rect = root.getBoundingClientRect()
        settings.size = clampPlayerSize({ width: rect.width + delta[0], height: rect.height + delta[1] }, viewport())
    }

    function toggleMaximized() {
        settings.maximized = !settings.maximized
    }

    let suppressClick = false

    function onClickCapture(event: MouseEvent) {
        if (!suppressClick) return
        suppressClick = false
        event.stopPropagation()
        event.preventDefault()
    }

    let drag: { pointerId: number; startX: number; startY: number; left: number; top: number; moved: boolean } | null = null

    function onDragStart(event: PointerEvent) {
        if (event.button !== 0 || maximized) return
        // Buttons may start a drag too (the collapsed pill is almost all buttons); a real drag swallows their click.
        if ((event.target as HTMLElement).closest('input, textarea, a, select, [data-bgm-no-drag]')) return
        drag = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, left: position.left, top: position.top, moved: false }
    }

    function onDragMove(event: PointerEvent) {
        if (!drag || event.pointerId !== drag.pointerId || !root) return
        const dx = event.clientX - drag.startX
        const dy = event.clientY - drag.startY
        if (!drag.moved) {
            if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return
            drag.moved = true
            try { (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId) } catch { /* pointer already released */ }
        }
        const rect = root.getBoundingClientRect()
        const size = { width: rect.width, height: rect.height }
        const placement = placementFromPosition(drag.left + dx, drag.top + dy, viewport(), size)
        position = positionFromPlacement(placement, viewport(), size)
    }

    function onDragEnd(event: PointerEvent) {
        if (!drag || event.pointerId !== drag.pointerId || !root) return
        if (drag.moved) {
            suppressClick = true
            const rect = root.getBoundingClientRect()
            settings.placement = placementFromPosition(position.left, position.top, viewport(), { width: rect.width, height: rect.height })
        }
        drag = null
    }

    // ---- Actions ----

    function setCollapsed(value: boolean) {
        settings.collapsed = value
        if (!value) panel = 'main'
    }

    function turnOff() {
        settings.enabled = false
    }

    function onSeekInput(event: Event) {
        seekPreview = Number((event.currentTarget as HTMLInputElement).value)
    }

    function onSeekCommit(event: Event) {
        bgmEngine.seek(Number((event.currentTarget as HTMLInputElement).value))
        seekPreview = null
    }

    function onVolumeInput(event: Event) {
        bgmEngine.setVolume(Number((event.currentTarget as HTMLInputElement).value))
    }

    function toggleMute() {
        if (settings.volume > 0) {
            lastAudibleVolume = settings.volume
            bgmEngine.setVolume(0)
        } else {
            bgmEngine.setVolume(lastAudibleVolume || 0.6)
        }
    }

    function playAfterAdding() {
        if (!view.trackId && slot) bgmEngine.selectSlot(slot.id)
    }

    function addYouTube() {
        if (!slot) return
        const { skipped } = addYouTubeText(library, slot, youtubeText)
        youtubeMessage = skipped ? text.youtubeSkipped.replace('{count}', String(skipped)) : ''
        youtubeText = ''
        if (!skipped) adding = ''
        playAfterAdding()
    }

    async function uploadFiles() {
        if (!slot || uploading) return
        uploading = true
        try {
            if (await uploadAudioFiles(library, slot)) playAfterAdding()
        } catch (error) {
            notifyError(text.loadFailed.replace('{error}', error instanceof Error ? error.message : String(error)))
        } finally {
            uploading = false
        }
    }

    function addFolderTracks(items: Array<{ folderId: string; relPath: string }>) {
        if (!slot) return
        if (addFolderFiles(library, slot, items)) playAfterAdding()
    }

    function createSlot() {
        const created = addSlot(library, set.id, slotName)
        slotName = ''
        adding = ''
        if (created) bgmEngine.selectSlot(created.id)
    }

    async function removeCurrentSlot() {
        if (!slot || !await alertConfirm(text.deleteSlotConfirm.replace('{name}', slot.name))) return
        const removedId = slot.id
        // Undoable from the manager like its own edits.
        recordBgmChange(library, text.deleteSlot)
        deleteSlot(library, set.id, removedId)
        const next = set.slots[0]
        if (next) bgmEngine.selectSlot(next.id)
        else view.slotId = ''
    }

    function removeTrack(trackId: string) {
        if (!slot) return
        recordBgmChange(library, text.removeTrack)
        removeTrackFromSlot(library, slot, trackId)
        if (view.trackId === trackId) bgmEngine.next()
    }

    // ---- Lifecycle ----

    let resizeObserver: ResizeObserver | null = null

    onMount(() => {
        // The first library is created before the UI language loads, so it is filled with the localized moods here.
        fillStarterSet(library, Object.values(text.templates), text.templates.everyday.name)
        bgmEngine.attachVideoHost(videoHost ?? null)
        bgmEngine.start()
        place()
        resizeObserver = new ResizeObserver(() => { if (!drag) place() })
        if (root) resizeObserver.observe(root)
        window.addEventListener('resize', place)
    })

    const uninstallDj = installBgmDj()

    onDestroy(() => {
        uninstallDj()
        resizeObserver?.disconnect()
        window.removeEventListener('resize', place)
        bgmEngine.attachVideoHost(null)
        bgmEngine.shutdown()
    })
</script>

<section
    bind:this={root}
    class="bgm-player"
    class:is-collapsed={collapsed}
    class:is-tucked={$settingsOpen}
    class:is-maximized={maximized}
    class:has-mini-video={miniVideo}
    class:is-sized={!!cardSize}
    data-skin-part="bgm-player"
    data-skin-state={collapsed ? 'collapsed' : 'expanded'}
    aria-label={text.toolbarToggle}
    style:left={maximized ? undefined : `${position.left}px`}
    style:top={maximized ? undefined : `${position.top}px`}
    style:--bgm-width={cardSize ? `${cardSize.width}px` : undefined}
    style:--bgm-height={cardSize ? `${cardSize.height}px` : undefined}
    onpointerdown={onDragStart}
    onpointermove={onDragMove}
    onpointerup={onDragEnd}
    onpointercancel={onDragEnd}
    onclickcapture={onClickCapture}
>
    {#if !collapsed}
        <header class="bgm-header">
            <SolarBoldIcon name="music-note-2" size={16} />
            <!-- With several sets, the set this bot uses is the useful title. -->
            <span class="bgm-header-title">{library.sets.length > 1 ? set.name : text.title}</span>
            {#if dj.enabled}<span class="bgm-dj" data-state={view.dj} title={djTitle} role="status" aria-label={djTitle}>DJ</span>{/if}
            <span class="bgm-header-actions">
                <button type="button" class="bgm-icon-button" aria-label={text.openManager} onclick={() => openBgmManager(set.id)}>
                    <ListMusicIcon size={16} />
                </button>
                <button type="button" class="bgm-icon-button" aria-label={panel === 'settings' ? text.back : text.settings} aria-pressed={panel === 'settings'} onclick={() => panel = panel === 'settings' ? 'main' : 'settings'}>
                    {#if panel === 'settings'}<ArrowLeftIcon size={16} />{:else}<Settings2Icon size={16} />{/if}
                </button>
                <button type="button" class="bgm-icon-button" aria-label={maximized ? text.restoreSize : text.maximize} aria-pressed={maximized} onclick={toggleMaximized}>
                    {#if maximized}<Minimize2Icon size={16} />{:else}<Maximize2Icon size={16} />{/if}
                </button>
                <button type="button" class="bgm-icon-button" aria-label={text.collapse} onclick={() => setCollapsed(true)}>
                    <ChevronDownIcon size={16} />
                </button>
                <button type="button" class="bgm-icon-button" aria-label={text.close} onclick={turnOff}>
                    <XIcon size={16} />
                </button>
            </span>
        </header>
    {/if}

    <!-- One host for every YouTube iframe: moving an iframe in the DOM would reload the video. -->
    <div bind:this={videoHost} class="bgm-video" class:is-visible={view.youtubeVisible} class:is-hidden-panel={!collapsed && panel === 'settings'} aria-hidden="true"></div>

    {#if collapsed}
        <div class="bgm-pill">
            <button type="button" class="bgm-play is-small" aria-label={view.playing ? text.pause : text.play} onclick={() => bgmEngine.toggle()}>
                <SolarBoldIcon name={view.playing ? 'pause' : 'play'} size={14} />
            </button>
            <button type="button" class="bgm-pill-label" aria-label={text.expand} onclick={() => setCollapsed(false)}>
                <span class="bgm-pill-slot">
                    {#if view.playing}<span class="bgm-bars" aria-hidden="true"><i></i><i></i><i></i></span>{/if}
                    {slot?.name ?? text.title}
                    {#if dj.enabled}<span class="bgm-dj is-small" data-state={view.dj} title={djTitle}>DJ</span>{/if}
                </span>
                <span class="bgm-pill-track">{current?.title ?? text.nothingPlaying}</span>
            </button>
        </div>
    {:else if panel === 'settings'}
        <div class="bgm-body">
            <div class="bgm-field">
                <span class="bgm-label">{text.muteWhenInactive}</span>
                <SegmentedControl bind:value={() => settings.muteWhenInactive, (mode) => setMuteMode(mode as BgmInactiveMute)} size="sm" options={[
                    { value: 'off', label: text.muteOff },
                    { value: 'hidden', label: text.muteHidden },
                    { value: 'blur', label: text.muteBlur },
                ]} />
                <p class="bgm-help">{text.muteHelp}</p>
            </div>
            <label class="bgm-field">
                <span class="bgm-label-row">
                    <span class="bgm-label">{text.crossfade}</span>
                    <span class="bgm-value">{text.seconds.replace('{value}', (settings.crossfadeMs / 1000).toFixed(1))}</span>
                </span>
                <input class="bgm-range" type="range" min="0" max={BGM_MAX_CROSSFADE_MS} step="500" bind:value={settings.crossfadeMs} />
            </label>
            <button type="button" class="bgm-text-button" onclick={() => folderDialogOpen = true}>
                <FolderOpenIcon size={15} />{text.manageFolders}
            </button>

            <section class="bgm-settings-group" aria-label={text.djTitle}>
                <label class="bgm-check">
                    <input type="checkbox" bind:checked={dj.enabled} />
                    <span>{text.djEnable}</span>
                </label>
                <p class="bgm-help">{text.djHelp}</p>
                {#if dj.enabled}
                    {#if set.slots.length < 2}<p class="bgm-help is-warning">{text.djNeedsSlots}</p>{/if}
                    <div class="bgm-field">
                        <span class="bgm-label">{text.djModel}</span>
                        <SegmentedControl bind:value={() => dj.model, (value) => dj.model = value === 'model' ? 'model' : 'otherAx'} size="sm" options={[
                            { value: 'otherAx', label: text.djModelSub },
                            { value: 'model', label: text.djModelMain },
                        ]} />
                    </div>
                    <label class="bgm-field">
                        <span class="bgm-label-row"><span class="bgm-label">{text.djRecentCount}</span><span class="bgm-value">{text.countUnit.replace('{value}', String(dj.recentCount))}</span></span>
                        <input class="bgm-range" type="range" min={BGM_DJ_LIMITS.recentCount[0]} max={BGM_DJ_LIMITS.recentCount[1]} step="1" bind:value={dj.recentCount} />
                    </label>
                    <label class="bgm-field">
                        <span class="bgm-label-row"><span class="bgm-label">{text.djMaxChars}</span><span class="bgm-value">{text.charsUnit.replace('{value}', dj.maxChars.toLocaleString())}</span></span>
                        <input class="bgm-range" type="range" min={BGM_DJ_LIMITS.maxChars[0]} max={BGM_DJ_LIMITS.maxChars[1]} step="100" bind:value={dj.maxChars} />
                    </label>
                    <label class="bgm-field">
                        <span class="bgm-label-row"><span class="bgm-label">{text.djMinConfidence}</span><span class="bgm-value">{text.percentUnit.replace('{value}', String(Math.round(dj.minConfidence * 100)))}</span></span>
                        <input class="bgm-range" type="range" min="0" max="1" step="0.05" bind:value={dj.minConfidence} />
                    </label>
                    <label class="bgm-field">
                        <span class="bgm-label-row"><span class="bgm-label">{text.djMinDwell}</span><span class="bgm-value">{text.seconds.replace('{value}', String(dj.minDwellSec))}</span></span>
                        <input class="bgm-range" type="range" min={BGM_DJ_LIMITS.minDwellSec[0]} max="180" step="5" bind:value={dj.minDwellSec} />
                    </label>
                    <label class="bgm-field">
                        <span class="bgm-label-row"><span class="bgm-label">{text.djManualHold}</span><span class="bgm-value">{text.messagesUnit.replace('{value}', String(dj.manualHoldTurns))}</span></span>
                        <input class="bgm-range" type="range" min={BGM_DJ_LIMITS.manualHoldTurns[0]} max={BGM_DJ_LIMITS.manualHoldTurns[1]} step="1" bind:value={dj.manualHoldTurns} />
                    </label>
                    <label class="bgm-check">
                        <input type="checkbox" bind:checked={dj.showRequestStatus} />
                        <span>{text.djShowStatus}</span>
                    </label>
                    <button type="button" class="bgm-text-button" onclick={editDjPrompt}>{text.djEditPrompt}</button>
                {/if}
            </section>
        </div>
    {:else}
        <!-- Transport stays put; only the slot and track lists below scroll, so play/pause is always in reach. -->
        <div class="bgm-transport">
            <div class="bgm-now">
                <p class="bgm-now-title" title={current?.title}>{current?.title ?? text.nothingPlaying}</p>
                {#if current}<p class="bgm-now-meta"><span class="bgm-tag">{sourceLabel(current)}</span>{slot?.name}</p>{/if}
            </div>

            <div class="bgm-progress">
                <input
                    class="bgm-range"
                    type="range"
                    min="0"
                    max={Math.max(1, view.duration)}
                    step="1"
                    value={seekPreview ?? view.position}
                    disabled={!current || !view.duration}
                    aria-label={text.seek}
                    oninput={onSeekInput}
                    onchange={onSeekCommit}
                />
                <span class="bgm-time">{formatBgmTime(seekPreview ?? view.position)} / {formatBgmTime(view.duration)}</span>
            </div>

            <div class="bgm-controls">
                <button type="button" class="bgm-play" aria-label={view.playing ? text.pause : text.play} onclick={() => bgmEngine.toggle()}>
                    <SolarBoldIcon name={view.playing ? 'pause' : 'play'} size={18} />
                </button>
                <button type="button" class="bgm-icon-button is-large" aria-label={text.next} disabled={!tracks.length} onclick={() => bgmEngine.next()}>
                    <SolarBoldIcon name="skip-next" size={18} />
                </button>
                <span class="bgm-volume">
                    <button type="button" class="bgm-icon-button" aria-label={settings.volume > 0 ? text.mute : text.unmute} onclick={toggleMute}>
                        <SolarBoldIcon name={settings.volume > 0 ? 'volume-loud' : 'volume-cross'} size={16} />
                    </button>
                    <input class="bgm-range" type="range" min="0" max="1" step="0.01" value={settings.volume} aria-label={text.volume} oninput={onVolumeInput} />
                </span>
                {#if view.youtubeVisible}
                    <button type="button" class="bgm-icon-button" aria-label={settings.videoSize === 'small' ? text.videoLarge : text.videoSmall} title={settings.videoSize === 'small' ? text.videoLarge : text.videoSmall} aria-pressed={settings.videoSize === 'small'} onclick={() => settings.videoSize = settings.videoSize === 'small' ? 'large' : 'small'}>
                        {#if settings.videoSize === 'small'}<RectangleHorizontalIcon size={16} />{:else}<PictureInPicture2Icon size={16} />{/if}
                    </button>
                {/if}
            </div>

            {#if noticeText}<p class="bgm-notice" role="status">{noticeText}</p>{/if}
        </div>

        <div class="bgm-body is-main">

            <div class="bgm-section">
                <div class="bgm-section-head">
                    <span class="bgm-label">{text.slots}</span>
                    {#if slot}
                        <button type="button" class="bgm-icon-button" aria-label={text.deleteSlot} onclick={removeCurrentSlot}><Trash2Icon size={14} /></button>
                    {/if}
                </div>
                <div class="bgm-chips" role="group" aria-label={text.slots}>
                    {#each set.slots as item (item.id)}
                        <button type="button" class="bgm-chip" aria-pressed={item.id === slot?.id} onclick={() => bgmEngine.selectSlot(item.id, 'user')}>
                            {item.name}<span class="bgm-chip-count">{item.trackIds.length}</span>
                        </button>
                    {/each}
                    {#if adding === 'slot'}
                        <form class="bgm-inline-form" onsubmit={(event) => { event.preventDefault(); createSlot() }}>
                            <!-- svelte-ignore a11y_autofocus -->
                            <input class="bgm-input" bind:value={slotName} placeholder={text.slotNamePlaceholder} maxlength="40" autofocus />
                            <button type="submit" class="bgm-text-button is-primary" disabled={!slotName.trim()}>{text.add}</button>
                            <button type="button" class="bgm-text-button" onclick={() => { adding = ''; slotName = '' }}>{text.cancel}</button>
                        </form>
                    {:else}
                        <button type="button" class="bgm-chip is-add" aria-label={text.addSlot} onclick={() => adding = 'slot'}><PlusIcon size={14} /></button>
                    {/if}
                </div>
            </div>

            {#if slot}
                <div class="bgm-section is-tracks">
                    <span class="bgm-label">{text.tracks}</span>
                    {#if tracks.length}
                        <ul class="bgm-tracks">
                            {#each tracks as track (track.id)}
                                <li class="bgm-track" class:is-current={track.id === view.trackId}>
                                    <button type="button" class="bgm-track-main" onclick={() => bgmEngine.playTrack(track.id)}>
                                        <span class="bgm-track-title" title={track.title}>{track.title}</span>
                                        <span class="bgm-tag">{sourceLabel(track)}</span>
                                    </button>
                                    <button type="button" class="bgm-icon-button" aria-label={text.removeTrack} onclick={() => removeTrack(track.id)}><XIcon size={14} /></button>
                                </li>
                            {/each}
                        </ul>
                    {:else}
                        <p class="bgm-help">{text.emptySlot}</p>
                    {/if}

                    {#if adding === 'youtube'}
                        <form class="bgm-youtube-form" onsubmit={(event) => { event.preventDefault(); addYouTube() }}>
                            <!-- svelte-ignore a11y_autofocus -->
                            <textarea class="bgm-input" rows="3" bind:value={youtubeText} placeholder={text.youtubePlaceholder} autofocus></textarea>
                            {#if youtubeMessage}<p class="bgm-help is-warning">{youtubeMessage}</p>{/if}
                            <span class="bgm-form-actions">
                                <button type="button" class="bgm-text-button" onclick={() => { adding = ''; youtubeText = ''; youtubeMessage = '' }}>{text.cancel}</button>
                                <button type="submit" class="bgm-text-button is-primary" disabled={!youtubeText.trim()}>{text.add}</button>
                            </span>
                        </form>
                    {:else}
                        <div class="bgm-add-row">
                            <button type="button" class="bgm-text-button" onclick={() => { adding = 'youtube'; youtubeMessage = '' }}><Link2Icon size={15} />{text.addYouTube}</button>
                            <button type="button" class="bgm-text-button" onclick={() => folderDialogOpen = true}><FolderOpenIcon size={15} />{text.addFolder}</button>
                            <button type="button" class="bgm-text-button" disabled={uploading} onclick={uploadFiles}><UploadIcon size={15} />{text.addUpload}</button>
                        </div>
                    {/if}
                </div>
            {/if}
        </div>
    {/if}
    {#if !collapsed && !maximized}
        <button
            type="button"
            class="bgm-resize"
            class:is-left={gripLeft}
            class:is-right={!gripLeft}
            class:is-top={gripTop}
            class:is-bottom={!gripTop}
            data-bgm-no-drag
            aria-label={text.resizeHandle}
            title={text.resizeHandle}
            onpointerdown={onResizeStart}
            onpointermove={onResizeMove}
            onpointerup={onResizeEnd}
            onpointercancel={onResizeEnd}
            ondblclick={resetSize}
            onkeydown={onResizeKey}
        ></button>
    {/if}
</section>

{#if folderDialogOpen}
    <BgmFolderDialog bind:open={folderDialogOpen} canAdd={panel === 'main' && !!slot} onAdd={addFolderTracks} />
{/if}

<style>
    .bgm-player {
        position: fixed;
        /* Above the chat and side panels (z-30), below every dialog (z-40 and up). */
        z-index: 35;
        display: flex;
        flex-direction: column;
        width: min(var(--bgm-width, 340px), calc(100vw - 24px));
        max-height: min(640px, calc(100dvh - 24px));
        background: var(--color-darkbg);
        color: var(--color-textcolor);
        border: 1px solid var(--color-darkborderc);
        border-radius: var(--risu-radius-xl);
        box-shadow: var(--risu-shadow-popover);
        font-size: 0.875rem;
        touch-action: none;
        user-select: none;
        overflow: hidden;
    }
    /* The settings screen replaces the app; keep playing but stay out of its way. */
    .bgm-player.is-tucked { visibility: hidden; pointer-events: none; }
    .bgm-player.is-collapsed {
        flex-direction: row;
        align-items: center;
        width: auto;
        max-width: min(300px, calc(100vw - 24px));
        border-radius: 999px;
        padding: 5px 6px 5px 5px;
        gap: 6px;
        cursor: grab;
    }
    .bgm-player :global(input), .bgm-player :global(textarea) { user-select: text; touch-action: auto; }

    .bgm-header {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 8px 8px 8px 14px;
        color: var(--color-textcolor2);
        cursor: grab;
    }
    .bgm-header-title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--color-textcolor); font-weight: 600; }
    .bgm-header-actions { margin-left: auto; display: flex; gap: 2px; }

    .bgm-icon-button {
        display: grid;
        place-items: center;
        width: 28px;
        height: 28px;
        flex-shrink: 0;
        border-radius: var(--risu-radius-md);
        color: var(--color-textcolor2);
        transition: color 0.15s ease, background 0.15s ease;
    }
    .bgm-icon-button.is-large { width: 36px; height: 36px; }
    .bgm-icon-button:hover:not(:disabled) { color: var(--color-textcolor); background: var(--color-selected); }
    .bgm-icon-button:disabled { opacity: 0.4; }
    .bgm-icon-button[aria-pressed='true'] { color: var(--color-primary); }

    .bgm-video {
        position: relative;
        display: none;
        flex-shrink: 0;
        overflow: hidden;
        background: var(--color-media-bg);
    }
    .bgm-video.is-visible { display: block; margin: 0 12px; aspect-ratio: 16 / 9; border-radius: var(--risu-radius-md); }
    /* In a large card keep the video from pushing the controls out of view. */
    .bgm-player.is-sized:not(.has-mini-video), .bgm-player.is-maximized:not(.has-mini-video) { container: bgm-card / size; }
    .is-sized:not(.has-mini-video) > .bgm-video.is-visible, .is-maximized:not(.has-mini-video) > .bgm-video.is-visible {
        align-self: center;
        width: min(calc(100% - 24px), calc(38cqh * 16 / 9));
        margin: 0;
    }
    .bgm-video.is-visible.is-hidden-panel { height: 0; aspect-ratio: auto; margin: 0; }
    .is-collapsed .bgm-video.is-visible { margin: 0; width: 52px; height: 30px; aspect-ratio: auto; border-radius: 999px var(--risu-radius-sm) var(--risu-radius-sm) 999px; }
    .bgm-video :global(.bgm-youtube-deck), .bgm-video :global(iframe) { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; pointer-events: none; }

    .bgm-pill { display: flex; align-items: center; gap: 8px; min-width: 0; }
    .bgm-pill-label {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        min-width: 0;
        padding: 0 8px 0 0;
        text-align: left;
        line-height: 1.25;
    }
    .bgm-pill-slot { display: flex; align-items: center; gap: 5px; font-size: 11px; color: var(--color-textcolor2); }
    .bgm-pill-track { max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500; }

    .bgm-play {
        display: grid;
        place-items: center;
        width: 40px;
        height: 40px;
        flex-shrink: 0;
        border-radius: 999px;
        color: var(--color-primary);
        background: color-mix(in srgb, var(--color-primary) 16%, transparent);
        transition: background 0.15s ease, transform 0.15s ease;
    }
    .bgm-play.is-small { width: 30px; height: 30px; }
    .bgm-play:hover { background: color-mix(in srgb, var(--color-primary) 26%, transparent); }
    .bgm-play:active { transform: scale(0.94); }

    .bgm-body {
        display: flex;
        flex-direction: column;
        gap: 14px;
        flex: 1;
        min-height: 0;
        padding: 12px 14px 14px;
        overflow-y: auto;
        overscroll-behavior: contain;
    }
    .bgm-transport {
        display: flex;
        flex-direction: column;
        gap: 10px;
        flex-shrink: 0;
        min-width: 0;
        padding: 12px 14px 12px;
    }
    /* The divider belongs to the lists, so it spans the full card even beside a small video. */
    .bgm-transport + .bgm-body { padding-top: 12px; border-top: 1px solid var(--color-darkborderc); }

    /* Small video sits beside the title; the lists take the full width below. */
    .bgm-player.has-mini-video {
        display: grid;
        grid-template-columns: auto minmax(0, 1fr);
        grid-template-rows: auto auto minmax(0, 1fr);
    }
    .has-mini-video > .bgm-header { grid-column: 1 / -1; }
    .has-mini-video > .bgm-video.is-visible { grid-column: 1; grid-row: 2; align-self: start; width: 120px; margin: 12px 0 0 14px; }
    .has-mini-video > .bgm-transport { grid-column: 2; grid-row: 2; padding-left: 12px; }
    .has-mini-video > .bgm-body { grid-column: 1 / -1; grid-row: 3; }
    .has-mini-video .bgm-now-title { font-size: 14px; }

    /* A wide card (resized or maximized) puts the track list beside the controls. */
    .bgm-player:not(.is-collapsed) { container: bgm-card / inline-size; }
    @container bgm-card (min-width: 720px) {
        .bgm-body { padding: 16px 20px 20px; }
        .bgm-transport { padding: 14px 20px; }
        .bgm-body.is-main {
            display: grid;
            grid-template-columns: minmax(0, 1fr) minmax(0, 1.2fr);
            column-gap: 32px;
            align-content: start;
        }
        .bgm-body.is-main > .is-tracks { grid-column: 2; grid-row: 1; }
        .bgm-body.is-main .bgm-tracks { max-height: none; }
        .bgm-body:not(.is-main) { width: min(100%, 640px); margin: 0 auto; }
    }

    .bgm-now-title {
        display: -webkit-box;
        -webkit-line-clamp: 2;
        line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
        font-size: 15px;
        font-weight: 600;
        line-height: 1.35;
    }
    .bgm-now-meta { display: flex; align-items: center; gap: 6px; margin-top: 4px; font-size: 12px; color: var(--color-textcolor2); }

    .bgm-tag {
        flex-shrink: 0;
        padding: 1px 6px;
        border-radius: 999px;
        font-size: 11px;
        color: var(--color-textcolor2);
        background: var(--color-selected);
    }

    .bgm-progress { display: flex; flex-direction: column; gap: 2px; }
    .bgm-time { align-self: flex-end; font-size: 11px; color: var(--color-textcolor2); font-variant-numeric: tabular-nums; }

    .bgm-range { width: 100%; accent-color: var(--color-primary); cursor: pointer; }
    .bgm-range:disabled { opacity: 0.4; cursor: default; }

    .bgm-controls { display: flex; align-items: center; gap: 6px; }
    .bgm-volume { display: flex; align-items: center; gap: 4px; flex: 1; min-width: 0; margin-left: 6px; }

    .bgm-notice {
        padding: 8px 10px;
        border-radius: var(--risu-radius-md);
        font-size: 12px;
        line-height: 1.45;
        color: var(--color-textcolor);
        background: var(--color-warning-bg);
        border: 1px solid var(--color-warning-border);
    }

    .bgm-section { display: flex; flex-direction: column; gap: 8px; }
    .bgm-section-head { display: flex; align-items: center; justify-content: space-between; height: 24px; }
    .bgm-label { font-size: 12px; font-weight: 600; color: var(--color-textcolor2); }
    .bgm-label-row { display: flex; justify-content: space-between; align-items: baseline; }
    .bgm-value { font-size: 12px; color: var(--color-textcolor2); font-variant-numeric: tabular-nums; }
    .bgm-help { font-size: 12px; line-height: 1.5; color: var(--color-textcolor2); }
    .bgm-help.is-warning { color: var(--color-warning); }
    .bgm-field { display: flex; flex-direction: column; gap: 8px; }

    .bgm-chips { display: flex; flex-wrap: wrap; gap: 6px; }
    .bgm-chip {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        min-height: 30px;
        padding: 0 10px;
        border: 1px solid var(--color-darkborderc);
        border-radius: 999px;
        font-size: 13px;
        transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease;
    }
    .bgm-chip:hover { background: var(--color-selected); }
    .bgm-chip[aria-pressed='true'] {
        color: var(--color-primary);
        border-color: color-mix(in srgb, var(--color-primary) 55%, transparent);
        background: color-mix(in srgb, var(--color-primary) 12%, transparent);
    }
    .bgm-chip-count { font-size: 11px; color: var(--color-textcolor2); font-variant-numeric: tabular-nums; }
    .bgm-chip.is-add { width: 30px; padding: 0; justify-content: center; color: var(--color-textcolor2); }

    .bgm-tracks {
        display: flex;
        flex-direction: column;
        max-height: 196px;
        overflow-y: auto;
        border: 1px solid var(--color-darkborderc);
        border-radius: var(--risu-radius-md);
    }
    .bgm-track { display: flex; align-items: center; gap: 2px; padding-right: 4px; }
    .bgm-track + .bgm-track { border-top: 1px solid var(--color-darkborderc); }
    .bgm-track-main { display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0; padding: 8px 10px; text-align: left; }
    .bgm-track-main:hover { color: var(--color-primary); }
    .bgm-track-title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .bgm-track.is-current .bgm-track-title { color: var(--color-primary); font-weight: 600; }

    .bgm-add-row { display: flex; flex-wrap: wrap; gap: 6px; }
    .bgm-text-button {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        min-height: 30px;
        padding: 0 10px;
        border-radius: var(--risu-radius-md);
        font-size: 13px;
        color: var(--color-textcolor);
        background: var(--color-darkbutton);
        transition: background 0.15s ease, opacity 0.15s ease;
    }
    .bgm-text-button:hover:not(:disabled) { background: var(--color-selected); }
    .bgm-text-button:disabled { opacity: 0.5; }
    .bgm-text-button.is-primary { color: var(--color-primary); background: color-mix(in srgb, var(--color-primary) 16%, transparent); }

    .bgm-inline-form { display: flex; flex-wrap: wrap; gap: 6px; width: 100%; }
    .bgm-inline-form .bgm-input { flex: 1; min-width: 140px; }
    .bgm-youtube-form { display: flex; flex-direction: column; gap: 6px; }
    .bgm-form-actions { display: flex; justify-content: flex-end; gap: 6px; }
    .bgm-input {
        min-height: 30px;
        padding: 6px 10px;
        border: 1px solid var(--color-darkborderc);
        border-radius: var(--risu-radius-md);
        background: var(--color-bgcolor);
        color: var(--color-textcolor);
        font-size: 13px;
        resize: vertical;
    }
    .bgm-input::placeholder { color: var(--color-textcolor2); }

    .bgm-player button:focus-visible, .bgm-input:focus-visible, .bgm-range:focus-visible {
        outline: 2px solid var(--color-primary);
        outline-offset: 1px;
    }

    .bgm-settings-group { display: flex; flex-direction: column; gap: 12px; padding-top: 14px; border-top: 1px solid var(--color-darkborderc); }
    .bgm-check { display: flex; align-items: center; gap: 8px; font-size: 13px; cursor: pointer; }
    .bgm-check input { width: 16px; height: 16px; accent-color: var(--color-primary); }

    .bgm-dj {
        flex-shrink: 0;
        padding: 0 6px;
        border-radius: 999px;
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0.04em;
        line-height: 16px;
        color: var(--color-primary);
        background: color-mix(in srgb, var(--color-primary) 16%, transparent);
    }
    .bgm-dj.is-small { line-height: 14px; font-size: 9px; }
    .bgm-dj[data-state='thinking'] { animation: bgm-dj-pulse 1.2s ease-in-out infinite; }
    .bgm-dj[data-state='failed'] { color: var(--color-warning); background: var(--color-warning-bg); }
    .bgm-dj[data-state='held'] { color: var(--color-textcolor2); background: var(--color-selected); }
    @keyframes bgm-dj-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }

    .bgm-bars { display: inline-flex; align-items: flex-end; gap: 2px; height: 10px; color: var(--color-primary); }
    .bgm-bars i { width: 2px; height: 100%; border-radius: 999px; background: currentColor; transform-origin: bottom; animation: bgm-bar 1s ease-in-out infinite; }
    .bgm-bars i:nth-child(2) { animation-delay: -0.35s; }
    .bgm-bars i:nth-child(3) { animation-delay: -0.7s; }
    @keyframes bgm-bar { 0%, 100% { transform: scaleY(0.35); } 50% { transform: scaleY(1); } }
    @media (prefers-reduced-motion: reduce) {
        .bgm-bars i { animation: none; transform: scaleY(0.7); }
        .bgm-dj[data-state='thinking'] { animation: none; }
    }

    .bgm-player.is-sized { height: min(var(--bgm-height), calc(100dvh - 24px)); max-height: calc(100dvh - 24px); }
    .bgm-player.is-maximized {
        inset: 12px;
        width: auto;
        height: auto;
        max-height: none;
    }
    .bgm-player.is-maximized .bgm-header { cursor: default; }

    .bgm-resize {
        position: absolute;
        z-index: 2;
        width: 14px;
        height: 14px;
        padding: 0;
        border: 0;
        background: transparent;
        touch-action: none;
        color: var(--color-textcolor2);
        opacity: 0.55;
        transition: opacity 0.15s ease, color 0.15s ease;
    }
    .bgm-resize::before {
        content: '';
        position: absolute;
        inset: 3px;
        border-color: currentColor;
        border-style: solid;
        border-width: 0;
    }
    .bgm-resize:hover, .bgm-resize:focus-visible { opacity: 1; color: var(--color-primary); outline: none; }
    .bgm-resize.is-bottom { bottom: 0; }
    .bgm-resize.is-top { top: 0; }
    .bgm-resize.is-right { right: 0; }
    .bgm-resize.is-left { left: 0; }
    .bgm-resize.is-bottom.is-right { cursor: nwse-resize; }
    .bgm-resize.is-top.is-left { cursor: nwse-resize; }
    .bgm-resize.is-bottom.is-left, .bgm-resize.is-top.is-right { cursor: nesw-resize; }
    .bgm-resize.is-bottom::before { border-bottom-width: 2px; }
    .bgm-resize.is-top::before { border-top-width: 2px; }
    .bgm-resize.is-right::before { border-right-width: 2px; }
    .bgm-resize.is-left::before { border-left-width: 2px; }
    .bgm-resize.is-bottom.is-right::before { border-bottom-right-radius: var(--risu-radius-sm); }
    .bgm-resize.is-bottom.is-left::before { border-bottom-left-radius: var(--risu-radius-sm); }
    .bgm-resize.is-top.is-right::before { border-top-right-radius: var(--risu-radius-sm); }
    .bgm-resize.is-top.is-left::before { border-top-left-radius: var(--risu-radius-sm); }

    @media (max-width: 480px) {
        .bgm-player:not(.is-collapsed):not(.is-maximized):not(.is-sized) { width: calc(100vw - 24px); max-height: min(72dvh, 600px); }
    }
</style>
