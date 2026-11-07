<script lang="ts">
    import ShDialog from 'src/lib/UI/GUI/ShDialog.svelte'
    import ShButton from 'src/lib/UI/GUI/ShButton.svelte'
    import { CheckIcon, FileTextIcon, LockKeyholeIcon } from '@lucide/svelte'
    import { isPortableWikiDocument } from 'src/ts/risubard/wikiTransfer'
    type ExportDocument = Parameters<typeof isPortableWikiDocument>[0] & { id: string, relativePath: string }
    let { open = $bindable(false), documents, onExport, disabled = false }: {
        open?: boolean
        documents: readonly ExportDocument[]
        onExport: (ids: string[]) => Promise<void>
        disabled?: boolean
    } = $props()
    // Rows render in pages so a wiki with thousands of pages opens at once.
    const PAGE_SIZE = 300
    let shownCount = $state(PAGE_SIZE)
    let selected = $state.raw(new Set<string>())
    let running = $state(false)
    let error = $state('')
    let painting = false
    let paintValue = false
    let lastPaintIndex = -1
    let list: HTMLDivElement
    let portable = $derived(documents.filter(isPortableWikiDocument))
    let portableIds = $derived(new Set(portable.map(doc => doc.id)))
    let indexById = $derived(new Map(documents.map((doc, index) => [doc.id, index])))
    let shown = $derived(documents.slice(0, shownCount))
    function setSelected(id: string, value: boolean) {
        if (disabled || running || !portableIds.has(id) || selected.has(id) === value) return
        const next = new Set(selected)
        if (value) next.add(id)
        else next.delete(id)
        selected = next
    }
    function begin(event: PointerEvent, id: string) {
        if (event.button !== 0 || disabled || running) return
        event.preventDefault()
        painting = true
        paintValue = !selected.has(id)
        lastPaintIndex = indexById.get(id) ?? -1
        setSelected(id, paintValue)
        list.setPointerCapture?.(event.pointerId)
    }
    function move(event: PointerEvent) {
        if (!painting) return
        const row = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-export-document]')
        if (row && list.contains(row)) {
            const index = indexById.get(row.dataset.exportDocument ?? '') ?? -1
            if (index < 0) return
            const next = new Set(selected)
            for (const doc of documents.slice(Math.min(lastPaintIndex, index), Math.max(lastPaintIndex, index) + 1)) {
                if (!portableIds.has(doc.id)) continue
                if (paintValue) next.add(doc.id)
                else next.delete(doc.id)
            }
            if (!disabled && !running) selected = next
            lastPaintIndex = index
        }
    }
    async function save() {
        if (!selected.size || disabled || running) return
        running = true
        error = ''
        try { await onExport([...selected]) }
        catch (cause) { error = cause instanceof Error ? cause.message : String(cause) }
        finally { running = false }
    }
</script>

<svelte:window onpointerup={() => painting = false} onpointercancel={() => painting = false} />
<ShDialog bind:open size="lg" closeOnEscape closable={!running} closeOnOutsideClick={!running}>
    {#snippet title()}위키 내보내기{/snippet}
    {#snippet description()}항목을 클릭하거나 누른 채 드래그해 선택하거나 해제하세요. 사건 정본과 아크 플롯은 ‘이 위키로 새 챗 시작’으로만 옮길 수 있습니다. 문서의 링크는 유지되지만 선택하지 않은 연결 문서는 포함되지 않습니다.{/snippet}
    <div class="export-actions">
        <span aria-live="polite">{selected.size} / {portable.length}개 선택</span>
        <ShButton variant="outline" size="sm" disabled={disabled || running} onclick={() => selected = new Set(portableIds)}>전체 선택</ShButton>
        <ShButton variant="outline" size="sm" disabled={disabled || running} onclick={() => selected = new Set()}>선택 해제</ShButton>
    </div>
    <div class="export-list" bind:this={list} role="group" aria-label="내보낼 위키 항목" onpointermove={move}>
        {#each shown as doc (doc.id)}
            {@const allowed = portableIds.has(doc.id)}
            {@const isSelected = selected.has(doc.id)}
            <button type="button" class="export-row" class:selected={isSelected}
                data-export-document={doc.id} aria-pressed={isSelected}
                disabled={!allowed || disabled || running}
                onpointerdown={event => begin(event, doc.id)}
                onclick={event => { if (event.detail === 0) setSelected(doc.id, !isSelected) }}>
                <span class="selection-box">{#if isSelected}<CheckIcon size={14} />{/if}</span>
                {#if allowed}<FileTextIcon size={17} />{:else}<LockKeyholeIcon size={17} />{/if}
                <span class="document-name"><strong>{doc.title}</strong><small>{doc.relativePath}</small></span>
                {#if !allowed}<small>새 챗으로만 이동</small>{/if}
            </button>
        {:else}<p>내보낼 위키 항목이 없습니다.</p>{/each}
        {#if documents.length > shown.length}
            <ShButton variant="ghost" size="sm" data-export-more onclick={() => shownCount += PAGE_SIZE}>
                {documents.length - shown.length}개 더 보기
            </ShButton>
        {/if}
    </div>
    {#if error}<p class="export-error" role="alert">{error}</p>{/if}
    {#snippet footer()}
        <ShButton variant="outline" disabled={running} onclick={() => open = false}>닫기</ShButton>
        <ShButton disabled={disabled || running || selected.size === 0} onclick={save}>{running ? '저장 중…' : '내보내기'}</ShButton>
    {/snippet}
</ShDialog>

<style>
    .export-actions { display: flex; align-items: center; gap: .5rem; flex-wrap: wrap; }
    .export-actions > span { margin-right: auto; color: var(--color-textcolor2); font-size: .8rem; }
    .export-list { display: grid; gap: .25rem; max-height: 50vh; overflow-y: auto; padding: .25rem; border: 1px solid var(--color-darkborderc); border-radius: var(--risu-radius-lg); }
    .export-row { display: flex; width: 100%; align-items: center; gap: .65rem; padding: .65rem; border: 1px solid transparent; border-radius: calc(var(--risu-radius-sm) * 1.4); color: var(--color-textcolor); background: transparent; text-align: left; user-select: none; touch-action: pan-y; }
    .export-row:hover:not(:disabled), .export-row.selected { background: color-mix(in srgb, var(--color-primary) 14%, transparent); border-color: color-mix(in srgb, var(--color-primary) 40%, transparent); }
    .export-row:focus-visible { outline: 2px solid var(--color-primary); outline-offset: -2px; }
    .export-row:disabled { opacity: .5; cursor: not-allowed; }
    .selection-box { display: grid; place-items: center; width: 1rem; height: 1rem; flex-shrink: 0; border: 1px solid var(--color-darkborderc); border-radius: calc(var(--risu-radius-sm) * 0.8); }
    .selected .selection-box { background: var(--color-primary); color: var(--color-accenttext); }
    .document-name { display: grid; flex: 1; min-width: 0; gap: .15rem; }
    .document-name strong { overflow-wrap: anywhere; font-size: .85rem; }
    small { color: var(--color-textcolor2); font-size: .75rem; overflow-wrap: anywhere; }
    .export-error { color: var(--color-draculared); }
</style>
