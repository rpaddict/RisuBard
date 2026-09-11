<script lang="ts">
    import { ArrowDownIcon, ArrowUpIcon, Clock3Icon, LoaderCircleIcon, PencilIcon, PlusIcon, SaveIcon, Trash2Icon, ZapIcon } from '@lucide/svelte'
    import loadIcon from 'src/assets/solar-bold/undo-left-square-bold.svg'
    import { alertConfirm, alertInput } from 'src/ts/alert'
    import { forageStorage } from 'src/ts/globalApi.svelte'
    import { classifyMemorySaveId, quickSaveId } from 'src/ts/risubard/memorySavePolicy'
    import {
        deleteMemorySaveSlot,
        listMemorySaveSlots,
        previewMemorySaveSlot,
        renameMemorySaveSlot,
        shouldConfirmMemorySaveLoad,
        type MemorySavePreviewMessage,
        type MemorySaveSlotSummary,
    } from 'src/ts/risubard/memorySaveSlots'
    import ShButton from '../UI/GUI/ShButton.svelte'
    import CheckInput from '../UI/GUI/CheckInput.svelte'
    import ShDialog from '../UI/GUI/ShDialog.svelte'
    import SolarAssetIcon from '../UI/Icons/SolarAssetIcon.svelte'

    interface Props {
        open: boolean
        characterId: string
        characterName?: string
        currentChatId: string
        currentChatName?: string
        currentLatestMessageId?: string
        mode?: 'save' | 'load'
        onOpenChange(open: boolean): void
        onLoad(saveId: string, asNewChat: boolean): Promise<void>
        onSave?(saveId?: string, overwrite?: boolean): Promise<MemorySaveSlotSummary>
    }

    let {
        open,
        characterId,
        characterName = '',
        currentChatId,
        currentChatName = '',
        currentLatestMessageId,
        mode = $bindable('load'),
        onOpenChange,
        onLoad,
        onSave,
    }: Props = $props()

    let slots = $state<MemorySaveSlotSummary[]>([])
    let selectedId = $state('')
    let sortAscending = $state(false)
    let loading = $state(false)
    let loadingId = $state('')
    let loadAsNewChat = $state(false)
    let previewLoadingId = $state('')
    let previewCache = $state<Record<string, MemorySavePreviewMessage[]>>({})
    let error = $state('')
    let requestSequence = 0
    let previewSequence = 0
    let workspaceElement = $state<HTMLElement | null>(null)
    let previewShare = $state(38)
    const workspaceStyle = $derived(`grid-template-rows:minmax(12rem,${100 - previewShare}fr) .75rem minmax(8rem,${previewShare}fr);`)
    const reservedQuickId = $derived(currentChatId ? quickSaveId(currentChatId) : '')

    const sortedSlots = $derived.by(() => [...slots].sort((left, right) => {
        const comparison = left.createdAt.localeCompare(right.createdAt) || left.saveId.localeCompare(right.saveId)
        return sortAscending ? comparison : -comparison
    }))
    const autosaveSlots = $derived(sortedSlots.filter((slot) => classifyMemorySaveId(slot.saveId).kind === 'auto'))
    const quickSlot = $derived(slots.find((slot) => slot.saveId === reservedQuickId))
    const manualSlots = $derived(sortedSlots.filter((slot) => classifyMemorySaveId(slot.saveId).kind === 'manual'))
    const selectedSlot = $derived(slots.find((slot) => slot.saveId === selectedId))
    const selectedPreview = $derived(previewCache[selectedId] ?? [])
    const selectedIsManual = $derived(selectedSlot && classifyMemorySaveId(selectedSlot.saveId).kind === 'manual')

    function slotLabel(slot: MemorySaveSlotSummary): string {
        const classification = classifyMemorySaveId(slot.saveId)
        if (classification.kind === 'quick') return 'QUICKSAVE'
        if (classification.kind === 'auto') return `AUTO ${classification.index + 1}`
        if (slot.sourceChatName && slot.sourceChatName !== currentChatName) return slot.sourceChatName
        const index = manualSlots.findIndex((candidate) => candidate.saveId === slot.saveId)
        return `SAVE ${String(Math.max(0, index) + 1).padStart(2, '0')}`
    }

    async function ensurePreview(saveId: string): Promise<void> {
        if (!saveId || previewCache[saveId] || previewLoadingId === saveId) return
        const sequence = ++previewSequence
        previewLoadingId = saveId
        try {
            const messages = await previewMemorySaveSlot({ characterId, saveId, fetchImpl: fetch, createAuth: () => forageStorage.createAuth() })
            if (sequence !== previewSequence) return
            previewCache[saveId] = messages
            previewCache = { ...previewCache }
        } catch (cause) {
            if (sequence === previewSequence) error = cause instanceof Error ? cause.message : String(cause)
        } finally {
            if (sequence === previewSequence) previewLoadingId = ''
        }
    }

    function selectSlot(saveId: string): void {
        selectedId = saveId
        void ensurePreview(saveId)
    }

    function firstSelectedId(next: MemorySaveSlotSummary[]): string {
        const quick = next.find((slot) => slot.saveId === reservedQuickId)
        if (quick) return quick.saveId
        return [...next].sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0]?.saveId ?? ''
    }

    async function refresh(): Promise<void> {
        const sequence = ++requestSequence
        ++previewSequence
        slots = []
        selectedId = ''
        previewCache = {}
        previewLoadingId = ''
        loading = true
        error = ''
        try {
            const next = await listMemorySaveSlots({ characterId, sourceChatId: currentChatId, fetchImpl: fetch, createAuth: () => forageStorage.createAuth() })
            if (sequence !== requestSequence) return
            slots = next
            selectedId = firstSelectedId(next)
            if (selectedId) void ensurePreview(selectedId)
        } catch (cause) {
            if (sequence === requestSequence) error = cause instanceof Error ? cause.message : String(cause)
        } finally {
            if (sequence === requestSequence) loading = false
        }
    }

    async function load(saveId: string): Promise<void> {
        if (loadingId) return
        const sequence = requestSequence
        error = ''
        try {
            if (!loadAsNewChat && shouldConfirmMemorySaveLoad(currentLatestMessageId, slots) && !await alertConfirm(
                '저장하지 않은 채팅은 사라집니다. 불러올까요?',
                { tier: 'top' },
            )) return
            if (sequence !== requestSequence || !open) return
            loadingId = saveId
            await onLoad(saveId, loadAsNewChat)
        } catch (cause) {
            error = cause instanceof Error ? cause.message : String(cause)
        } finally {
            loadingId = ''
        }
    }

    async function save(saveId?: string, overwrite = saveId !== undefined): Promise<void> {
        if (loading || loadingId || !onSave) return
        const target = slots.find((slot) => slot.saveId === saveId)
        const createsReservedQuickSlot = saveId === reservedQuickId && !target
        if (saveId !== undefined && !target && !createsReservedQuickSlot) return
        const sequence = requestSequence
        loadingId = saveId ?? '#new'
        error = ''
        try {
            if (target && !await alertConfirm(`이 슬롯에 현재 채팅을 덮어쓸까요? 기존 저장 내용은 교체됩니다.\n${slotLabel(target)}`)) return
            if (sequence !== requestSequence || !open) return
            const saved = await onSave(saveId, target ? overwrite : false)
            if (sequence !== requestSequence) return
            slots = [...slots.filter((slot) => slot.saveId !== saved.saveId), saved]
            selectedId = saved.saveId
            ++previewSequence
            previewLoadingId = ''
            delete previewCache[saved.saveId]
            previewCache = { ...previewCache }
            void ensurePreview(saved.saveId)
        } catch (cause) {
            if (sequence === requestSequence) error = cause instanceof Error ? cause.message : String(cause)
        } finally {
            loadingId = ''
        }
    }

    async function renameSlot(target: MemorySaveSlotSummary): Promise<void> {
        if (classifyMemorySaveId(target.saveId).kind !== 'manual' || loadingId) return
        const sequence = requestSequence
        loadingId = target.saveId
        try {
            const name = await alertInput('저장된 파일 이름 변경', [], target.sourceChatName)
            if (!name?.trim() || sequence !== requestSequence || !open) return
            const renamed = await renameMemorySaveSlot({ characterId, saveId: target.saveId, name, fetchImpl: fetch, createAuth: () => forageStorage.createAuth() })
            if (sequence !== requestSequence) return
            slots = slots.map((slot) => slot.saveId === renamed.saveId ? renamed : slot)
        } catch (cause) {
            error = cause instanceof Error ? cause.message : String(cause)
        } finally {
            loadingId = ''
        }
    }

    async function deleteSelected(): Promise<void> {
        if (!selectedSlot || !selectedIsManual || loadingId) return
        const target = selectedSlot
        const sequence = requestSequence
        loadingId = target.saveId
        try {
            if (!await alertConfirm(`저장된 파일을 삭제할까요?\n${slotLabel(target)}`)) return
            if (sequence !== requestSequence || !open) return
            await deleteMemorySaveSlot({ characterId, saveId: target.saveId, fetchImpl: fetch, createAuth: () => forageStorage.createAuth() })
            if (sequence !== requestSequence) return
            slots = slots.filter((slot) => slot.saveId !== target.saveId)
            delete previewCache[target.saveId]
            previewCache = { ...previewCache }
            selectedId = firstSelectedId(slots)
            if (selectedId) void ensurePreview(selectedId)
        } catch (cause) {
            error = cause instanceof Error ? cause.message : String(cause)
        } finally {
            loadingId = ''
        }
    }

    function savedAt(value: string): string { return new Date(value).toLocaleString() }
    function setPreviewShare(value: number): void { previewShare = Math.min(60, Math.max(25, Math.round(value))) }
    function startPreviewResize(event: PointerEvent): void {
        if (!workspaceElement || event.button !== 0) return
        event.preventDefault()
        const bounds = workspaceElement.getBoundingClientRect()
        const update = (clientY: number) => { if (bounds.height > 0) setPreviewShare((bounds.bottom - clientY) / bounds.height * 100) }
        const move = (next: PointerEvent) => update(next.clientY)
        const end = () => {
            document.removeEventListener('pointermove', move)
            document.removeEventListener('pointerup', end)
            document.removeEventListener('pointercancel', end)
        }
        update(event.clientY)
        document.addEventListener('pointermove', move)
        document.addEventListener('pointerup', end)
        document.addEventListener('pointercancel', end)
    }
    function resizePreviewByKeyboard(event: KeyboardEvent): void {
        if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
        event.preventDefault()
        setPreviewShare(previewShare + (event.key === 'ArrowUp' ? 5 : -5))
    }

    $effect(() => {
        if (open && characterId && currentChatId) void refresh()
        return () => { ++requestSequence; ++previewSequence }
    })
</script>

{#snippet slotCard(slot: MemorySaveSlotSummary, kind: 'auto' | 'quick' | 'manual')}
    <li data-save-slot-kind={kind} class:save-slot--selected={slot.saveId === selectedId} class="save-slot">
        <button type="button" class="save-slot__select risu-button-lift" aria-pressed={slot.saveId === selectedId} onclick={() => selectSlot(slot.saveId)}>
            <strong>{slotLabel(slot)}</strong>
            <span class="save-slot__turn">TURN {slot.turnCount}</span>
            <span class="save-slot__time"><Clock3Icon size={12} />{savedAt(slot.createdAt)}</span>
        </button>
        {#if kind === 'manual'}
            <ShButton data-save-file-rename variant="ghost" className="save-slot__rename" size="icon-xs" aria-label={`${slotLabel(slot)} 이름 변경`} title="파일 이름 변경" disabled={Boolean(loadingId)} onclick={(event) => { event.stopPropagation(); selectSlot(slot.saveId); void renameSlot(slot) }}><PencilIcon size={15} /></ShButton>
        {/if}
        <ShButton data-save-file-load={mode === 'load' ? true : undefined} data-save-file-overwrite={mode === 'save' ? true : undefined} className="save-slot__action" size="icon-sm" aria-label={`${slotLabel(slot)} ${mode === 'save' ? '덮어쓰기' : '불러오기'}`} title={mode === 'save' ? '현재 채팅으로 덮어쓰기' : '선택한 저장 파일 불러오기'} disabled={Boolean(loadingId) || (mode === 'save' && !onSave)} onclick={(event) => { event.stopPropagation(); if (mode === 'save') void save(slot.saveId); else void load(slot.saveId) }}>
            {#if loadingId === slot.saveId}<LoaderCircleIcon size={20} class="animate-spin" />{:else if mode === 'save'}<SaveIcon size={18} />{:else}<SolarAssetIcon src={loadIcon} name="undo-left-square-bold" size={22} />{/if}
        </ShButton>
    </li>
{/snippet}

<ShDialog {open} onOpenChange={onOpenChange} size="xl" tier="base" contentClass="save-slot-dialog" bodyClass="save-slot-dialog__body" ariaLabel="채팅 저장 및 불러오기">
    {#snippet headerActions()}
        <div class="save-dialog-header">
            <div data-save-mode-switcher role="group" aria-label="저장 및 불러오기 전환" class="save-dialog-header__modes">
                <ShButton data-save-mode="save" size="sm" variant={mode === 'save' ? 'primary' : 'outline'} aria-pressed={mode === 'save'} disabled={Boolean(loadingId) || !onSave} onclick={() => { mode = 'save' }}>저장하기</ShButton>
                <ShButton data-save-mode="load" size="sm" variant={mode === 'load' ? 'primary' : 'outline'} aria-pressed={mode === 'load'} disabled={Boolean(loadingId)} onclick={() => { mode = 'load' }}>불러오기</ShButton>
            </div>
            <strong data-save-dialog-context>{characterName || characterId}<span>/</span>{currentChatName || currentChatId}</strong>
        </div>
    {/snippet}

    <div class="save-ledger">
        {#if error}<p class="save-ledger__error">{error}</p>{/if}
        {#if loading && slots.length === 0}
            <div class="save-ledger__empty"><LoaderCircleIcon size={20} class="animate-spin" />저장된 파일을 읽는 중…</div>
        {:else}
            <div data-save-file-workspace class="save-workspace" style={workspaceStyle} bind:this={workspaceElement}>
                <div class="slot-browser">
                    <section class="slot-section slot-section--auto" aria-labelledby="autosave-heading">
                        <div class="slot-section__head"><strong id="autosave-heading">AUTOSAVE</strong><span>{autosaveSlots.length}</span></div>
                        <ol data-autosave-strip class="autosave-strip">
                            {#if autosaveSlots.length === 0}
                                <li class="save-slot save-slot--empty"><span>자동저장 대기 중</span></li>
                            {:else}
                                {#each autosaveSlots as slot (slot.saveId)}{@render slotCard(slot, 'auto')}{/each}
                            {/if}
                        </ol>
                    </section>

                    <section class="slot-section slot-section--manual" aria-labelledby="manual-save-heading">
                        <div class="slot-section__head">
                            <strong id="manual-save-heading">SAVE FILES</strong>
                            <div data-save-file-toolbar class="save-ledger__toolbar">
                                {#if mode === 'save'}
                                    <ShButton data-save-file-new variant="primary" size="sm" disabled={loading || Boolean(loadingId) || !onSave} onclick={() => void save()}>
                                        {#if loadingId === '#new'}<LoaderCircleIcon size={16} class="animate-spin" />{:else}<PlusIcon size={16} />{/if}새 슬롯
                                    </ShButton>
                                {/if}
                                {#if mode === 'load'}
                                    <CheckInput bind:check={loadAsNewChat} name="새 챗으로 불러오기" margin={false} className="save-load-new-chat" />
                                    <span class="save-ledger__divider"></span>
                                {/if}
                                <ShButton data-save-file-delete variant="destructive" size="icon-sm" aria-label="선택한 파일 삭제" title="선택한 파일 삭제" disabled={!selectedIsManual || Boolean(loadingId)} onclick={() => void deleteSelected()}><Trash2Icon size={16} /></ShButton>
                                <span class="save-ledger__divider"></span>
                                <ShButton data-save-file-sort variant="ghost" size="icon-sm" aria-label={sortAscending ? '새 파일을 위로 정렬' : '오래된 파일을 위로 정렬'} title={sortAscending ? '현재: 오래된 파일부터' : '현재: 새 파일부터'} onclick={() => { sortAscending = !sortAscending }}>{#if sortAscending}<ArrowUpIcon size={16} />{:else}<ArrowDownIcon size={16} />{/if}</ShButton>
                            </div>
                        </div>
                        <ol data-save-file-grid class="manual-grid">
                            {#if quickSlot}
                                {@render slotCard(quickSlot, 'quick')}
                            {:else}
                                <li data-save-slot-kind="quick" class="save-slot save-slot--quick-empty">
                                    <button type="button" class="save-slot__select" disabled={mode === 'load' || !onSave || Boolean(loadingId)} onclick={() => void save(reservedQuickId, false)}>
                                        <strong>QUICKSAVE</strong><ZapIcon size={22} /><span>{mode === 'save' ? '클릭하여 생성' : '저장된 파일 없음'}</span>
                                    </button>
                                </li>
                            {/if}
                            {#each manualSlots as slot (slot.saveId)}{@render slotCard(slot, 'manual')}{/each}
                        </ol>
                    </section>
                </div>

                <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
                <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
                <div data-preview-resize-handle class="preview-resize-handle" role="separator" tabindex="0" aria-label="저장 파일 목록과 프리뷰 영역 크기 조절" aria-orientation="horizontal" aria-valuemin="25" aria-valuemax="60" aria-valuenow={previewShare} onpointerdown={startPreviewResize} onkeydown={resizePreviewByKeyboard}><span></span></div>

                <aside data-save-file-preview class="save-preview">
                    <div class="save-preview__head">{#if selectedSlot}<strong>'{slotLabel(selectedSlot)}' 최근 대화</strong>{/if}</div>
                    <div class="save-preview__body">
                        {#if previewLoadingId === selectedId}
                            <div class="save-preview__empty"><LoaderCircleIcon size={18} class="animate-spin" />프리뷰 읽는 중…</div>
                        {:else if selectedPreview.length === 0}
                            <div class="save-preview__empty">표시할 최근 대화가 없습니다.</div>
                        {:else}
                            {#each selectedPreview as message}
                                <article class:save-preview__message--user={message.role === 'user'} class="save-preview__message"><span>{message.role === 'user' ? 'USER' : 'CHARACTER'}</span><p>{message.data}</p></article>
                            {/each}
                        {/if}
                    </div>
                </aside>
            </div>
        {/if}
    </div>
</ShDialog>

<style>
    :global(.save-slot-dialog) { width: min(70.4rem, calc(100vw - 2rem)); max-width: none; min-width: min(44rem, calc(100vw - 2rem)); height: 91vh; max-height: 91vh; overflow: hidden; background: var(--color-darkbg); }
    :global(.save-slot-dialog__body) { flex: 1; min-height: 0; }
    .save-dialog-header { display: flex; min-width: 0; align-items: center; justify-content: space-between; gap: 1rem; }
    .save-dialog-header__modes { display: flex; gap: .5rem; }
    .save-dialog-header > strong { display: flex; min-width: 0; align-items: center; gap: .5rem; overflow: hidden; color: var(--color-textcolor); font-size: 1.125rem; line-height: 1.25; white-space: nowrap; text-overflow: ellipsis; }
    .save-dialog-header > strong span { color: var(--color-textcolor2); font-weight: 400; }
    .save-ledger { display: flex; height: 100%; min-height: 0; flex-direction: column; padding-top: .75rem; border-top: 1px solid var(--color-darkborderc); }
    .save-ledger__error { margin: 0 0 .5rem; color: var(--color-danger); font-size: .76rem; }
    .save-ledger__empty, .save-preview__empty { display: flex; min-height: 8rem; align-items: center; justify-content: center; gap: .45rem; color: var(--color-textcolor2); font-size: .78rem; }
    .save-ledger__empty { flex: 1; border: 1px dashed var(--color-darkborderc); border-radius: .5rem; }
    .save-workspace { display: grid; flex: 1; min-height: 0; }
    .slot-browser { min-height: 0; overflow-y: auto; padding-right: .35rem; scrollbar-color: var(--color-borderc) transparent; scrollbar-width: thin; }
    .slot-section + .slot-section { margin-top: .85rem; padding-top: .8rem; border-top: 1px solid var(--color-darkborderc); }
    .slot-section__head, .save-ledger__toolbar, .save-preview__head { display: flex; align-items: center; }
    .slot-section__head { min-height: 2rem; justify-content: space-between; gap: .75rem; margin-bottom: .45rem; }
    .slot-section__head > strong { color: var(--color-textcolor2); font: 700 .68rem ui-monospace, monospace; letter-spacing: .13em; }
    .slot-section__head > span { color: var(--color-textcolor2); font-size: .65rem; }
    .save-ledger__toolbar { flex-wrap: wrap; gap: .2rem; margin-left: auto; }
    :global(.save-load-new-chat) { margin-right: .2rem; font-size: .75rem; white-space: nowrap; }
    .save-ledger__divider { width: 1px; height: 1.1rem; margin: 0 .2rem; background: var(--color-darkborderc); }
    .autosave-strip, .manual-grid { margin: 0; padding: 0; list-style: none; }
    .autosave-strip { display: grid; grid-auto-columns: minmax(7rem, 1fr); grid-auto-flow: column; gap: .55rem; overflow-x: auto; padding-bottom: .25rem; scrollbar-width: thin; }
    .manual-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(8.5rem, 9.25rem)); align-content: start; justify-content: start; gap: .55rem; }
    .save-slot { position: relative; display: grid; aspect-ratio: 1; min-width: 0; overflow: hidden; border: 1px solid var(--color-darkborderc); border-radius: .6rem; background: color-mix(in srgb, var(--color-darkbg) 82%, var(--color-selected) 18%); transition: border-color 140ms ease, box-shadow 140ms ease, background 140ms ease; }
    .autosave-strip .save-slot { width: min(8.6rem, 18vw); }
    .save-slot:hover, .save-slot:focus-within { border-color: var(--color-borderc); box-shadow: 0 .45rem 1.25rem color-mix(in srgb, var(--color-shadow) 18%, transparent); }
    .save-slot--selected { border-color: var(--color-primary); background: color-mix(in srgb, var(--color-primary) 25%, var(--color-darkbg)); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--color-primary) 45%, transparent); }
    .save-slot__select { display: flex; min-width: 0; flex-direction: column; align-items: flex-start; justify-content: flex-start; gap: .3rem; padding: .65rem; text-align: left; }
    .save-slot__select strong { box-sizing: border-box; width: 100%; overflow: hidden; padding-right: 1.8rem; color: var(--color-textcolor); font: 750 .9rem ui-monospace, monospace; letter-spacing: .025em; line-height: 1.25; text-overflow: ellipsis; white-space: nowrap; }
    .save-slot__turn { margin-top: .35rem; color: var(--color-primary); font: 750 .8rem ui-monospace, monospace; }
    .save-slot__time { display: flex; align-items: center; gap: .2rem; margin-top: auto; padding-right: 2rem; color: var(--color-textcolor2); font-size: .62rem; line-height: 1.25; }
    :global(.save-slot__rename) { position: absolute; z-index: 1; top: .3rem; right: .3rem; width: 1.7rem; height: 1.7rem; border-radius: .38rem; color: var(--color-textcolor2); opacity: .78; }
    :global(.save-slot__rename:hover), :global(.save-slot__rename:focus-visible) { color: var(--color-textcolor); opacity: 1; }
    :global(.save-slot__action) { position: absolute; right: .38rem; bottom: .38rem; width: 2rem; height: 2rem; border-radius: .4rem; }
    .save-slot--empty, .save-slot--quick-empty { border-style: dashed; background: transparent; }
    .save-slot--empty { place-items: center; color: var(--color-textcolor2); font-size: .7rem; }
    .save-slot--quick-empty .save-slot__select { align-items: center; justify-content: center; color: var(--color-textcolor2); text-align: center; }
    .save-slot--quick-empty .save-slot__select:disabled { opacity: .6; }
    .save-slot--quick-empty .save-slot__select span { font-size: .64rem; }
    .preview-resize-handle { display: grid; width: 100%; height: .75rem; place-items: center; padding: 0; border: 0; background: transparent; cursor: row-resize; touch-action: none; }
    .preview-resize-handle span { width: 4rem; height: .2rem; border-radius: 999px; background: var(--color-darkborderc); transition: width 120ms ease, background 120ms ease; }
    .preview-resize-handle:hover span, .preview-resize-handle:focus-visible span { width: 5.5rem; background: var(--color-borderc); }
    .save-preview { display: flex; min-width: 0; min-height: 0; flex-direction: column; overflow: hidden; border: 1px solid var(--color-darkborderc); border-radius: .55rem; background: color-mix(in srgb, var(--color-darkbg) 90%, var(--color-selected) 10%); }
    .save-preview__head { min-height: 2.25rem; padding: .55rem .75rem; border-bottom: 1px solid var(--color-darkborderc); }
    .save-preview__head strong { overflow: hidden; color: var(--color-textcolor); font-size: .75rem; letter-spacing: .05em; text-overflow: ellipsis; white-space: nowrap; }
    .save-preview__body { display: flex; flex: 1; flex-direction: column; gap: .45rem; padding: .65rem; overflow-y: auto; scrollbar-width: thin; }
    .save-preview__message { align-self: flex-start; max-width: 94%; padding: .5rem .58rem; border: 1px solid var(--color-darkborderc); border-radius: .48rem; background: var(--color-darkbg); }
    .save-preview__message--user { align-self: flex-end; background: color-mix(in srgb, var(--color-selected) 45%, var(--color-darkbg)); }
    .save-preview__message > span { color: var(--color-textcolor2); font-size: .56rem; letter-spacing: .08em; }
    .save-preview__message p { margin: .2rem 0 0; color: var(--color-textcolor); font-size: .72rem; line-height: 1.45; white-space: pre-wrap; overflow-wrap: anywhere; }
    @media (max-width: 767px) {
        :global(.save-slot-dialog) { left: 0; top: 0; width: 100dvw; min-width: 100dvw; max-width: 100dvw; height: 100dvh; max-height: 100dvh; padding: .75rem; transform: none; border: 0; border-radius: 0; }
        /* Keep a distinct selector: Oxc incorrectly folds independent translate/transform properties. */
        :global(.save-slot-dialog.save-slot-dialog) { translate: none; }
        .save-dialog-header { align-items: flex-start; flex-direction: column-reverse; gap: .55rem; }
        .save-dialog-header > strong { width: 100%; font-size: 1rem; }
        .manual-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        .autosave-strip { grid-auto-columns: 7.25rem; }
        .autosave-strip .save-slot { width: 7.25rem; }
    }
</style>
