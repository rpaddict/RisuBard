<script lang="ts">
    import { onDestroy } from 'svelte'
    import { ArrowDownIcon, ArrowUpIcon, CheckIcon, LoaderCircleIcon, MergeIcon, PlusIcon, XIcon } from '@lucide/svelte'
    import type { Chat } from 'src/ts/storage/database.svelte'
    import { countSharedMergeMessages } from 'src/ts/risubard/chatMerge'
    import ShButton from '../UI/GUI/ShButton.svelte'
    import ShDialog from '../UI/GUI/ShDialog.svelte'

    interface Props {
        open: boolean
        chats: Chat[]
        loadChat(id: string): Promise<Chat>
        onMerge(ids: string[], name: string): Promise<void>
        onOpenChange(open: boolean): void
    }
    let { open, chats, loadChat, onMerge, onOpenChange }: Props = $props()
    let selected = $state<string[]>([])
    let loaded = $state<Record<string, Chat>>({})
    let errors = $state<Record<string, string>>({})
    let name = $state('')
    let query = $state('')
    let busy = $state(false)
    let error = $state('')
    let acknowledgeOverlap = $state(false)
    const requests = new Map<string, symbol>()
    onDestroy(() => requests.clear())
    const available = $derived(chats.filter(chat => chat.id && !selected.includes(chat.id)
        && chat.name.toLocaleLowerCase().includes(query.toLocaleLowerCase())))
    const ordered = $derived(selected.flatMap(id => loaded[id] ? [loaded[id]] : []))
    const overlap = $derived(countSharedMergeMessages(ordered))
    const messageCount = $derived(ordered.reduce((sum, chat) => sum + chat.message.length, 0))
    const resultName = $derived(name.trim() || `${ordered[0]?.name ?? '이야기'} (합본)`)
    const ready = $derived(selected.length >= 2 && ordered.length === selected.length
        && !selected.some(id => errors[id]) && (!overlap || acknowledgeOverlap))
    const preview = (chat: Chat, end: boolean) => {
        const message = end ? chat.message.at(-1) : chat.message[0]
        return message?.data.replace(/\s+/g, ' ').trim().slice(0, 100) || '대화 없음'
    }

    async function add(id: string): Promise<void> {
        if (busy || selected.includes(id)) return
        selected = [...selected, id]
        acknowledgeOverlap = false
        error = ''
        delete errors[id]
        const request = Symbol()
        requests.set(id, request)
        try {
            const chat = await loadChat(id)
            if (requests.get(id) !== request) return
            if (chat._placeholder || chat.isStreaming || chat.risuBardWikiReboot) {
                throw new Error('불러오기 또는 진행 중인 작업을 마친 뒤 다시 선택해 주세요.')
            }
            loaded[id] = chat
        }
        catch (cause) {
            if (requests.get(id) === request) errors[id] = cause instanceof Error ? cause.message : String(cause)
        }
    }

    function remove(id: string): void {
        selected = selected.filter(value => value !== id)
        requests.delete(id)
        delete loaded[id]
        delete errors[id]
        acknowledgeOverlap = false
    }

    function move(index: number, offset: number): void {
        const next = [...selected]
        const destination = index + offset
        if (busy || destination < 0 || destination >= next.length) return
        const value = next[index]
        next[index] = next[destination]
        next[destination] = value
        selected = next
    }

    async function merge(): Promise<void> {
        if (busy || !ready) return
        busy = true
        error = ''
        try {
            await onMerge([...selected], resultName)
            onOpenChange(false)
        }
        catch (cause) { error = cause instanceof Error ? cause.message : String(cause) }
        finally { busy = false }
    }
</script>

<ShDialog {open} onOpenChange={(next) => { if (!busy) onOpenChange(next) }} size="lg"
    closable={!busy} closeOnEscape={!busy} closeOnOutsideClick={false}
    closeAriaLabel="병합 창 닫기" contentClass="chat-merge-dialog" bodyClass="min-h-0">
    {#snippet title()}
        <span class="flex items-center gap-2"><MergeIcon size={20} />챗 이어 붙이기</span>
    {/snippet}
    {#snippet description()}같은 이야기의 챗을 순서대로 모아 새 챗을 만듭니다.{/snippet}

    <div class="merge-workspace">
        <section class="merge-pane" aria-label="병합할 챗 선택">
            <h3 class="merge-heading">챗 선택 <span>{available.length}</span></h3>
            <input class="merge-input" aria-label="챗 이름 검색" placeholder="챗 이름 검색" bind:value={query} disabled={busy} />
            <div class="merge-list">
                {#each available as chat (chat.id)}
                    <button type="button" class="merge-source" data-merge-add={chat.id}
                        disabled={busy || chat.isStreaming || Boolean(chat.risuBardWikiReboot)}
                        aria-label={`${chat.name} 추가`} onclick={() => void add(chat.id!)}>
                        <span class="min-w-0"><span class="block truncate">{chat.name}</span>
                            {#if chat.isStreaming || chat.risuBardWikiReboot}<small>진행 중인 작업이 있습니다</small>{/if}
                        </span><PlusIcon size={16} />
                    </button>
                {:else}
                    <p class="merge-empty">{query ? '일치하는 챗이 없습니다.' : '모든 챗을 선택했습니다.'}</p>
                {/each}
            </div>
        </section>

        <section class="merge-pane merge-order" aria-label="병합 순서">
            <h3 class="merge-heading">병합 순서 <span>{selected.length}개 선택</span></h3>
            <p class="merge-caption">위에서 아래로 이어집니다. 화살표로 순서를 바꾸세요.</p>
            <ol class="merge-list merge-ordered-list" aria-label="선택한 챗 순서">
                {#each selected as id, index (id)}
                    {@const chat = loaded[id]}
                    <li class="merge-row" data-merge-row={id}>
                        <div class="merge-row-header">
                            <span class="merge-number">{index + 1}</span>
                            <span class="min-w-0 grow truncate font-medium" title={chat?.name ?? chats.find(c => c.id === id)?.name}>
                                {chat?.name ?? chats.find(c => c.id === id)?.name}
                            </span>
                            <div class="flex shrink-0">
                                <ShButton variant="ghost" size="icon-xs" data-merge-up={id} aria-label="위로 이동" title="위로 이동"
                                    disabled={busy || index === 0} onclick={() => move(index, -1)}><ArrowUpIcon size={14} /></ShButton>
                                <ShButton variant="ghost" size="icon-xs" data-merge-down={id} aria-label="아래로 이동" title="아래로 이동"
                                    disabled={busy || index === selected.length - 1} onclick={() => move(index, 1)}><ArrowDownIcon size={14} /></ShButton>
                                <ShButton variant="ghost" size="icon-xs" data-merge-remove={id} aria-label={`${chat?.name ?? '챗'} 제외`} title="선택에서 제외"
                                    disabled={busy} onclick={() => remove(id)}><XIcon size={14} /></ShButton>
                            </div>
                        </div>
                        {#if errors[id]}
                            <p class="text-danger text-xs mt-1" role="alert">{errors[id]}</p>
                        {:else if chat}
                            <div class="merge-preview">
                                <p title={preview(chat, false)}><span>처음</span>{preview(chat, false)}</p>
                                <p title={preview(chat, true)}><span>마지막</span>{preview(chat, true)}</p>
                            </div>
                            <p class="merge-caption mt-1">메시지 {chat.message.length}개</p>
                        {:else}
                            <p class="merge-caption mt-2" role="status">대화 불러오는 중…</p>
                        {/if}
                    </li>
                {:else}
                    <li class="merge-empty merge-empty-order"><MergeIcon size={26} /><span>챗을 두 개 이상 추가해 주세요.</span><small>원본 순서는 바뀌지 않습니다.</small></li>
                {/each}
            </ol>
        </section>
    </div>

    <label class="block mt-4 text-sm font-medium">새 챗 이름
        <input class="merge-input mt-1.5 w-full" data-merge-name placeholder={resultName} bind:value={name} disabled={busy} />
    </label>
    <div class="merge-summary" aria-live="polite">
        <CheckIcon size={15} /><span>원본 챗은 그대로 보존됩니다. 메시지 {messageCount}개를 새 챗으로 복사합니다.</span>
    </div>
    <p class="merge-caption mt-2">생성 후 새 챗의 Memory Wiki에서 ‘위키 리부트’를 실행해 주세요.</p>
    <details class="merge-details">
        <summary>설정과 위키는 어떻게 되나요?</summary>
        <p>설정·로컬 로어·변수는 마지막 챗{ordered.at(-1) ? ` ‘${ordered.at(-1)!.name}’` : ''}을 따릅니다. 첫 인사말은 첫 챗의 것만 사용합니다.</p>
        <p>기존 위키와 수동 작성 문서는 복사하지 않습니다. 리부트에는 AI 호출 비용이 발생합니다.</p>
    </details>
    {#if overlap}
        <label class="merge-warning">
            <input type="checkbox" data-merge-overlap bind:checked={acknowledgeOverlap} disabled={busy} />
            <span>겹치는 메시지 {overlap}개가 있습니다. 분기·복제된 내용도 삭제하지 않고 모두 이어 붙입니다.</span>
        </label>
    {/if}
    {#if error}<p role="alert" class="text-danger text-sm mt-3">{error}</p>{/if}

    {#snippet footer()}
        <ShButton variant="ghost" disabled={busy} onclick={() => onOpenChange(false)}>취소</ShButton>
        <ShButton variant="primary" data-merge-submit disabled={busy || !ready} onclick={() => void merge()}>
            {#if busy}<LoaderCircleIcon size={16} class="animate-spin" />{:else}<MergeIcon size={16} />{/if}
            {busy ? '새 챗 저장 중…' : '병합해서 새 챗 만들기'}
        </ShButton>
    {/snippet}
</ShDialog>

<style>
    .merge-workspace { display: grid; grid-template-columns: minmax(0, 0.8fr) minmax(0, 1.2fr); gap: 1rem; }
    .merge-pane { min-width: 0; }
    .merge-heading { display: flex; align-items: center; justify-content: space-between; margin-bottom: .625rem; font-size: .875rem; font-weight: 600; }
    .merge-heading span { color: var(--color-textcolor2); font-size: .75rem; font-weight: 400; }
    .merge-input { min-width: 0; width: 100%; height: 2.25rem; padding: .5rem .625rem; border: 1px solid var(--color-darkborderc); border-radius: var(--risu-radius-md); background: var(--color-darkbg); color: var(--color-textcolor); font-size: .875rem; }
    .merge-input:focus-visible { outline: 2px solid var(--color-borderc); outline-offset: 2px; }
    .merge-list { height: 15rem; overflow-y: auto; margin-top: .5rem; overscroll-behavior: contain; }
    .merge-source { display: flex; width: 100%; align-items: center; justify-content: space-between; gap: .5rem; padding: .625rem; border-radius: var(--risu-radius-md); text-align: left; font-size: .875rem; cursor: pointer; }
    .merge-source:hover { background: var(--color-selected); }
    .merge-source:focus-visible { outline: 2px solid var(--color-borderc); outline-offset: -2px; }
    .merge-source:disabled { opacity: .5; cursor: not-allowed; }
    .merge-source small { color: var(--color-textcolor2); }
    .merge-source :global(svg) { flex-shrink: 0; }
    .merge-order { border-left: 1px solid var(--color-darkborderc); padding-left: 1rem; }
    .merge-caption { color: var(--color-textcolor2); font-size: .6875rem; line-height: 1.5; }
    .merge-ordered-list { height: 16rem; list-style: none; padding: 0; }
    .merge-row { padding: .5rem; margin-bottom: .5rem; border: 1px solid var(--color-darkborderc); border-radius: var(--risu-radius-lg); background: var(--color-darkbg); }
    .merge-row-header { display: flex; align-items: center; gap: .375rem; font-size: .875rem; }
    .merge-number { display: grid; place-items: center; width: 1.375rem; height: 1.375rem; flex-shrink: 0; border-radius: var(--risu-radius-md); background: var(--color-selected); color: var(--color-textcolor); font-size: .75rem; font-variant-numeric: tabular-nums; }
    .merge-preview { margin-top: .375rem; color: var(--color-textcolor2); font-size: .75rem; line-height: 1.6; }
    .merge-preview p { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
    .merge-preview span { display: inline-block; width: 2.5rem; opacity: .8; }
    .merge-empty { padding: 1.25rem .5rem; color: var(--color-textcolor2); font-size: .8125rem; text-align: center; }
    .merge-empty-order { height: 100%; display: flex; flex-direction: column; justify-content: center; align-items: center; gap: .625rem; border: 1px dashed var(--color-darkborderc); border-radius: var(--risu-radius-lg); }
    .merge-summary { display: flex; align-items: start; gap: .375rem; margin-top: .875rem; font-size: .75rem; color: var(--color-textcolor2); }
    .merge-summary :global(svg) { flex-shrink: 0; margin-top: 1px; }
    .merge-details { margin-top: .625rem; font-size: .75rem; color: var(--color-textcolor2); line-height: 1.6; }
    .merge-details summary { cursor: pointer; }
    .merge-details p { margin-top: .375rem; }
    .merge-warning { display: flex; align-items: start; gap: .5rem; margin-top: .75rem; padding: .625rem; border: 1px solid var(--color-darkborderc); border-radius: var(--risu-radius-md); background: var(--color-selected); font-size: .75rem; }
    .merge-warning input { margin-top: .2rem; }
    @media (max-width: 560px) {
        .merge-workspace { grid-template-columns: minmax(0, 1fr); gap: .875rem; }
        .merge-order { padding: .875rem 0 0; border-left: 0; border-top: 1px solid var(--color-darkborderc); }
        .merge-list { height: 7rem; }
        .merge-ordered-list { height: 11rem; }
    }
</style>
