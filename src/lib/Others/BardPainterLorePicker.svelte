<script lang="ts">
    import ShDialog from '../UI/GUI/ShDialog.svelte'
    import { untrack } from 'svelte'
    import type { getPainterSession } from 'src/ts/bardPainter/runtime.svelte'

    let { session, identityId, identityName, open = $bindable(false), disabled = false }: {
        session: ReturnType<typeof getPainterSession>; identityId: string; identityName: string; open?: boolean; disabled?: boolean
    } = $props()
    let query = $state('')
    let busy = $state(false)
    let feedback = $state('')
    let failed = $state(false)
    let replacement = $state<string | undefined>()
    let limit = $state(40)
    let entries = $derived(session.loreEntries ?? [])
    const normalize = (value: string) => value.normalize('NFKC').toLocaleLowerCase()
    let filtered = $derived(entries.filter(item => normalize(`${item.title} ${item.content}`).includes(normalize(query.trim()))))
    let replacing = $derived(entries.find(item => item.id === replacement))
    const personName = (id: string) => session.bot.identities.find(item => item.id === id)?.name ?? '다른 인물'
    $effect(() => {
        open; identityId; session
        untrack(() => { query = ''; feedback = ''; failed = false; replacement = undefined; limit = 40 })
    })
    async function save(id: string, target?: string) {
        if (busy || disabled) return
        busy = true; feedback = ''; failed = false
        try {
            if (await session.setLoreIdentity(id, target)) {
                replacement = undefined
                feedback = target ? '로어에 인물을 연결했습니다.' : '로어 연결을 해제했습니다.'
            } else { failed = true; feedback = session.state.error || '연결을 저장하지 못했습니다. 다시 시도하세요.' }
        } catch (error) { failed = true; feedback = error instanceof Error ? error.message : String(error) }
        finally { busy = false }
    }
    function choose(id: string) {
        const entry = entries.find(item => item.id === id)
        if (!entry) return
        if (entry.identityId && entry.identityId !== identityId) replacement = id
        else void save(id, entry.identityId === identityId ? undefined : identityId)
    }
</script>

<ShDialog bind:open size="lg" tier="top" closeAriaLabel="로어 연결 닫기" closable={!busy} closeOnOutsideClick={!busy} closeOnEscape={!busy}>
    {#snippet title()}로어 연결 — {identityName}{/snippet}
    {#snippet description()}현재 봇의 로어를 선택하면 이 인물이 연결됩니다. 로어 본문과 키워드는 그대로 유지됩니다.{/snippet}
    <div class="picker">
        <label>로어 검색<input type="search" aria-label="로어 검색" bind:value={query} oninput={() => limit = 40} placeholder="제목 또는 본문" /></label>
        {#if replacing}
            <div class="confirmation" role="alert">
                <p>「{replacing.title}」에는 {personName(replacing.identityId!)}이(가) 연결되어 있습니다. {identityName}(으)로 바꿀까요?</p>
                <div class="actions"><button type="button" disabled={busy || disabled} onclick={() => save(replacing!.id, identityId)}>이 인물로 연결 변경</button><button type="button" disabled={busy} onclick={() => replacement = undefined}>취소</button></div>
            </div>
        {/if}
        <div class="entries" aria-label="연결할 로어 목록" aria-busy={busy}>
            {#each filtered.slice(0, limit) as entry (entry.id)}
                {@const linked = entry.identityId === identityId}
                <button type="button" class="entry" class:linked disabled={busy || disabled} aria-pressed={linked} aria-label={`${entry.title} ${linked ? '연결 해제' : entry.identityId ? '연결 변경' : '연결'}`} onclick={() => choose(entry.id)}>
                    <strong>{entry.title}</strong>
                    <span>{linked ? '연결됨 / 클릭하여 해제' : entry.identityId ? `${personName(entry.identityId)} 연결됨 / 변경` : '클릭하여 연결'}</span>
                </button>
            {:else}<p class="hint">{entries.length ? '검색 결과가 없습니다.' : '연결할 로어가 없습니다. 현재 봇의 로어북에 항목을 추가하세요.'}</p>{/each}
            {#if filtered.length > limit}<button type="button" onclick={() => limit += 40}>로어 더 보기 ({filtered.length - limit}개)</button>{/if}
        </div>
        <p class:error={failed} class="hint" role="status" aria-live="polite">{busy ? '연결 저장 중…' : feedback}</p>
    </div>
</ShDialog>

<style>
    .picker { display: flex; flex-direction: column; gap: .75rem; min-width: 0; color: var(--color-textcolor); }
    label { display: flex; flex-direction: column; gap: .3rem; font-size: .85rem; }
    input, button { border: 1px solid var(--color-darkborderc); border-radius: calc(var(--risu-radius-sm) * 1.2); color: var(--color-textcolor); background: var(--color-bgcolor); padding: .6rem; min-height: 2.75rem; }
    input { min-width: 0; width: 100%; }
    button:focus-visible, input:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 2px; }
    button:hover:not(:disabled) { background: var(--color-darkbutton); }
    button:disabled { opacity: .55; }
    .entries { display: flex; flex-direction: column; gap: .3rem; max-height: 45vh; overflow: auto; padding: .2rem; }
    .entry { text-align: left; display: flex; flex-direction: column; gap: .25rem; overflow-wrap: anywhere; }
    .entry strong { font-weight: 600; }
    .entry span, .hint { font-size: .8rem; color: var(--color-textcolor2); line-height: 1.5; }
    .entry.linked { background: var(--color-selected); }
    .confirmation { border: 1px solid var(--color-darkborderc); padding: .75rem; border-radius: calc(var(--risu-radius-sm) * 1.2); }
    .confirmation p { overflow-wrap: anywhere; font-size: .85rem; margin-bottom: .5rem; }
    .actions { display: flex; flex-wrap: wrap; gap: .4rem; }
    .error { color: var(--color-danger); }
    p:empty { display: none; }
</style>
