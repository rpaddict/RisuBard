<script lang="ts">
    import type { PainterSession } from 'src/ts/bardPainter/runtime.svelte'
    import type { PainterFragment } from 'src/ts/bardPainter/types'
    import BardPainterPromptInput from './BardPainterPromptInput.svelte'

    let { session, disabled = false, onDirtyChange }: {
        session: PainterSession; disabled?: boolean; onDirtyChange: (dirty: boolean) => void
    } = $props()
    const empty = (): PainterFragment => ({ id: '', name: '', prompt: '' })
    let draft = $state<PainterFragment>(empty())
    let baseline = $state(JSON.stringify(empty()))
    let dirty = $derived(JSON.stringify(draft) !== baseline)
    let busy = $state(false)
    let locked = $derived(disabled || busy)
    let pending = $state<(() => void) | null>(null)
    let deleting = $state(false)
    let feedback = $state('')
    let failed = $state(false)
    $effect(() => { onDirtyChange(dirty) })
    function load(fragment = empty()) {
        draft = { ...fragment }; baseline = JSON.stringify(draft)
        pending = null; deleting = false; feedback = ''; failed = false
    }
    function select(fragment?: PainterFragment) {
        if (dirty) pending = () => load(fragment)
        else load(fragment)
    }
    async function perform(work: () => Promise<void>) {
        if (locked) return
        busy = true; feedback = ''; failed = false
        try { await work() }
        catch (cause) { failed = true; feedback = cause instanceof Error ? cause.message : String(cause) }
        finally { busy = false }
    }
    async function save(copy = false) {
        await perform(async () => {
            const value = { ...draft }
            if (copy) {
                const names = new Set(session.fragments.map(item => item.name.trim().toLocaleLowerCase()))
                let number = 1
                do { value.name = `${draft.name} 복사${number === 1 ? '' : ` ${number}`}`; number++ }
                while (names.has(value.name.trim().toLocaleLowerCase()))
            }
            const id = await session.saveFragment(value, copy)
            if (!id) throw new Error(session.state.error || '표현 조각을 저장하지 못했습니다.')
            load({ ...value, id }); feedback = copy ? '표현 조각을 복제했습니다.' : '표현 조각을 저장했습니다.'
        })
    }
    async function remove() {
        await perform(async () => {
            if (!await session.removeFragment(draft.id)) throw new Error(session.state.error || '표현 조각을 삭제하지 못했습니다.')
            load(); feedback = '저장 목록에서 삭제했습니다. 초안에 추가한 조각은 유지됩니다.'
        })
    }
    async function add(id: string) {
        await perform(async () => {
            if (!await session.addFragment(id)) throw new Error(session.state.error || '표현 조각을 추가하지 못했습니다.')
            feedback = '현재 초안에 표현 조각을 추가했습니다.'
        })
    }
</script>

<div class="manager">
    {#if pending}<div class="confirm" role="alert"><p>저장하지 않은 변경을 버리고 이동할까요?</p><div class="actions"><button type="button" disabled={locked} onclick={() => pending?.()}>변경 버리고 이동</button><button type="button" onclick={() => pending = null}>계속 편집</button></div></div>{/if}
    <div class="workspace">
        <aside aria-label="저장한 표현 조각">
            <div class="heading"><h3>표현 조각 {session.fragments.length}개</h3><button type="button" disabled={locked} onclick={() => select()}>새로 만들기</button></div>
            <div class="list">
                {#each session.fragments as fragment (fragment.id)}
                    <div class="item">
                        <button type="button" class="name" class:chosen={draft.id === fragment.id} aria-pressed={draft.id === fragment.id} disabled={locked} onclick={() => { if (draft.id !== fragment.id) select(fragment) }}>{fragment.name}</button>
                        <button type="button" aria-label={`${fragment.name} 추가`} disabled={locked || !session.data.draft} onclick={() => add(fragment.id)}>추가</button>
                    </div>
                {:else}<p class="hint">자주 쓰는 프롬프트를 표현 조각으로 저장하세요.</p>{/each}
            </div>
        </aside>
        <section class="editor" aria-label="표현 조각 편집">
            <div class="heading"><h3>{draft.id ? '표현 조각 편집' : '새 표현 조각'}</h3><span class="hint">{dirty ? '저장하지 않은 변경' : ''}</span></div>
            <fieldset disabled={locked}>
                <label>이름<input aria-label="표현 조각 이름" bind:value={draft.name} /></label>
                <label>프롬프트<BardPainterPromptInput aria-label="표현 조각 프롬프트" rows={8} spellcheck="false" bind:value={draft.prompt} /></label>
                <div class="actions">
                    <button type="button" class="primary" disabled={!dirty || !draft.name.trim() || !draft.prompt.trim()} onclick={() => save()}>저장</button>
                    <button type="button" disabled={!draft.name.trim() || !draft.prompt.trim()} onclick={() => save(true)}>복제</button>
                    {#if draft.id}<button type="button" onclick={() => deleting = true}>삭제</button>{/if}
                </div>
            </fieldset>
            {#if deleting}<div class="confirm" role="alert"><p>「{draft.name}」을 저장 목록에서 삭제할까요? 초안에 추가한 조각은 유지됩니다.</p><div class="actions"><button type="button" disabled={locked} onclick={remove}>삭제 확인</button><button type="button" disabled={locked} onclick={() => deleting = false}>취소</button></div></div>{/if}
            <p class="hint">목록의 추가 버튼으로 현재 초안에 넣습니다. 초안에서 편집한 내용은 저장 목록의 원본에 영향을 주지 않습니다.</p>
            <p class="feedback" class:error={failed} role="status">{busy ? '저장 중…' : feedback}</p>
        </section>
    </div>
</div>

<style>
    .manager { container-type: inline-size; height: 100%; min-height: 0; display: flex; flex-direction: column; gap: .75rem; }
    .workspace { display: grid; grid-template-columns: minmax(12rem, 1fr) minmax(0, 2fr); gap: 1rem; flex: 1; min-height: 0; }
    aside, .editor { min-width: 0; display: flex; flex-direction: column; gap: .75rem; }
    aside { border-right: 1px solid var(--color-darkborderc); padding-right: 1rem; }
    .list, .editor { overflow-y: auto; }
    .editor { padding: .15rem; }
    .heading, .actions, .item { display: flex; align-items: center; gap: .5rem; }
    .heading, .actions { flex-wrap: wrap; }
    .heading { justify-content: space-between; }
    .item { margin-bottom: .4rem; }
    .name { flex: 1; min-width: 0; text-align: left; }
    .chosen { background: var(--color-selected); }
    h3 { font-size: .95rem; font-weight: 600; }
    fieldset, label { display: flex; flex-direction: column; gap: .5rem; min-width: 0; }
    fieldset { border: 0; padding: 0; margin: 0; gap: .85rem; }
    input { width: 100%; min-width: 0; border: 1px solid var(--color-darkborderc); background: var(--color-bgcolor); color: var(--color-textcolor); border-radius: .4rem; padding: .6rem; }
    button { min-height: 2.75rem; border: 1px solid var(--color-darkborderc); border-radius: .4rem; padding: .4rem .7rem; overflow-wrap: anywhere; font-size: .85rem; }
    button:hover:not(:disabled) { background: var(--color-darkbutton); }
    button:disabled { opacity: .5; cursor: not-allowed; }
    button:focus-visible, input:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 2px; }
    .primary { background: var(--color-primary); color: var(--color-accenttext); }
    .hint, .feedback { color: var(--color-textcolor2); font-size: .8rem; line-height: 1.55; overflow-wrap: anywhere; }
    .error { color: var(--color-danger); }
    .confirm { border: 1px solid var(--color-darkborderc); border-radius: .4rem; padding: .7rem; }
    @container (max-width: 560px) { .workspace { grid-template-columns: 1fr; overflow-y: auto; } aside { max-height: 14rem; border-right: 0; border-bottom: 1px solid var(--color-darkborderc); padding: 0 0 .75rem; } .editor { overflow-y: visible; } }
</style>
