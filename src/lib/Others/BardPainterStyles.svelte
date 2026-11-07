<script lang="ts">
    import BardPainterPromptInput from './BardPainterPromptInput.svelte'
    import { untrack } from 'svelte'
    import { ArrowUp, ArrowDown, Plus, Trash2 } from '@lucide/svelte'
    import type { getPainterSession } from 'src/ts/bardPainter/runtime.svelte'
    import type { PainterStyle } from 'src/ts/bardPainter/types'
    import { PAINTER_STYLES } from 'src/ts/bardPainter/styles'
    import { isPainterLoreStyle } from 'src/ts/bardPainter/lorePresets'

    let { session, disabled = false, onDirtyChange = () => {} }: {
        session: ReturnType<typeof getPainterSession>; disabled?: boolean; onDirtyChange?: (dirty: boolean) => void
    } = $props()
    const clone = (style: PainterStyle) => JSON.parse(JSON.stringify(style)) as PainterStyle
    let draft = $state<PainterStyle>(clone(untrack(() => session.style)))
    let baseline = $state(untrack(() => JSON.stringify(draft)))
    let selected = $state(untrack(() => draft.id))
    let query = $state(''), page = $state(0), busy = $state(false), feedback = $state(''), failed = $state(false)
    let pending = $state<(() => void | Promise<void>) | null>(null)
    let deleting = $state(false)
    let dirty = $derived(JSON.stringify(draft) !== baseline)
    let locked = $derived(disabled || busy)
    let original = $derived(session.styles.find(item => item.id === selected))
    let builtIn = $derived(PAINTER_STYLES.some(item => item.id === selected))
    let fromLore = $derived(isPainterLoreStyle(selected))
    let custom = $derived(session.styles.filter(item => !PAINTER_STYLES.some(base => base.id === item.id) && !isPainterLoreStyle(item.id)))
    let customIndex = $derived(custom.findIndex(item => item.id === selected))
    let customCount = $derived(custom.length)
    let filtered = $derived(session.styles.filter(item => item.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())))
    let pages = $derived(Math.max(1, Math.ceil(filtered.length / 16)))
    let canCopy = $derived(!!draft.name.trim() && (!original || draft.name.trim().toLocaleLowerCase() !== original.name.trim().toLocaleLowerCase()))
    $effect(() => { const current = session; untrack(() => { load(current.style); query = ''; busy = false; pending = null }) })
    $effect(() => { const value = dirty; untrack(() => onDirtyChange(value)) })
    $effect(() => { if (page >= pages) page = pages - 1 })

    function load(style: PainterStyle) {
        draft = clone(style); selected = style.id; baseline = JSON.stringify(draft); deleting = false; feedback = ''; failed = false
    }
    function guard(action: () => void | Promise<void>) {
        if (locked) return
        if (dirty) pending = action
        else void action()
    }
    async function perform(action: () => Promise<void>) {
        if (locked) return
        const current = session
        busy = true; feedback = ''; failed = false
        try { await action() }
        catch (error) { if (current === session) { failed = true; feedback = error instanceof Error ? error.message : String(error) } }
        finally { if (current === session) busy = false }
    }
    async function select(style: PainterStyle) {
        if (style.id === selected) return
        await perform(async () => {
            const current = session
            if (!await current.chooseStyle(style.id)) throw new Error(current.state.error || '화풍을 바꾸지 못했습니다.')
            if (current === session) load(style)
        })
    }
    function newStyle() { load({ ...clone(PAINTER_STYLES[0]), id: '', name: '' }) }
    async function save(asNew: boolean) {
        await perform(async () => {
            const current = session, savedDraft = clone(draft)
            const id = await current.saveStyle(savedDraft, asNew)
            if (!id) throw new Error(current.state.error || '저장하지 못했습니다. 다시 시도해 주세요.')
            if (current !== session) return
            load(current.styles.find(item => item.id === id) ?? { ...savedDraft, id })
            query = ''; page = Math.max(0, Math.floor(current.styles.findIndex(item => item.id === id) / 16))
            feedback = asNew ? '새 화풍으로 저장하고 적용했습니다.' : '화풍을 덮어썼습니다.'
        })
    }
    async function remove() {
        await perform(async () => {
            const current = session
            if (!await current.removeStyle(selected)) throw new Error(current.state.error || '삭제하지 못했습니다.')
            if (current === session) { load(current.style); feedback = '화풍 프리셋을 삭제했습니다.' }
        })
    }
    async function setDefault() {
        await perform(async () => {
            const current = session
            if (!await current.setDefaultStyle(selected)) throw new Error(current.state.error || '기본 화풍을 저장하지 못했습니다.')
            if (current === session) feedback = '새 채팅에서 사용할 기본 화풍으로 지정했습니다.'
        })
    }
    async function move(direction: -1 | 1) {
        await perform(async () => {
            const current = session
            if (!await current.moveStyle(selected, direction)) throw new Error(current.state.error || '순서를 변경하지 못했습니다.')
            if (current === session) page = Math.max(0, Math.floor(filtered.findIndex(item => item.id === selected) / 16))
        })
    }
</script>

<div class="style-manager" data-painter-style-manager>
    {#if pending}
        <div class="confirm" role="alert"><p>저장하지 않은 변경을 버리고 이동할까요?</p><div class="actions"><button type="button" disabled={locked} onclick={() => { const action = pending; pending = null; void action?.() }}>변경 버리고 이동</button><button type="button" onclick={() => pending = null}>계속 편집</button></div></div>
    {/if}
    <div class="workspace">
        <aside aria-label="화풍 프리셋 목록">
            <div class="list-toolbar"><strong>화풍 {session.styles.length}개</strong><button type="button" class="icon" title="새 화풍" aria-label="새 화풍" disabled={locked} onclick={() => guard(newStyle)}><Plus size={16} /></button></div>
            <input type="search" aria-label="화풍 검색" placeholder="화풍 이름 검색" bind:value={query} oninput={() => page = 0} />
            <div class="list">
                {#each filtered.slice(page * 16, (page + 1) * 16) as style (style.id)}
                    <button type="button" class="preset" class:chosen={selected === style.id} aria-pressed={selected === style.id} data-painter-style={style.id} disabled={locked} onclick={() => { if (selected !== style.id) guard(() => select(style)) }}><span>{style.name}</span>{#if isPainterLoreStyle(style.id)}<small>{session.botDefaultStyle?.id === style.id ? '봇 기본' : '봇 로어'}</small>{:else if session.defaultStyle?.id === style.id}<small>기본 화풍</small>{/if}{#if session.style.id === style.id}<small>사용 중</small>{/if}</button>
                {:else}<p class="hint">검색 결과가 없습니다.</p>{/each}
            </div>
            {#if pages > 1}<div class="pagination"><button type="button" aria-label="이전 화풍 페이지" disabled={page === 0} onclick={() => page--}>이전</button><span>{page + 1} / {pages}</span><button type="button" aria-label="다음 화풍 페이지" disabled={page + 1 >= pages} onclick={() => page++}>다음</button></div>{/if}
            <div class="list-footer"><span class="hint">선택한 화풍 순서</span><button type="button" class="icon" aria-label="화풍 위로 이동" title="위로 이동" disabled={locked || customIndex <= 0} onclick={() => move(-1)}><ArrowUp size={15} /></button><button type="button" class="icon" aria-label="화풍 아래로 이동" title="아래로 이동" disabled={locked || customIndex < 0 || customIndex + 1 >= customCount} onclick={() => move(1)}><ArrowDown size={15} /></button></div>
        </aside>
        <section class="editor" aria-label="화풍 편집">
            <div class="editor-heading"><h3>{original?.name || '새 화풍'}</h3><span class="hint">{dirty ? '저장하지 않은 변경' : builtIn ? '기본 제공' : fromLore ? '봇 로어' : '개인 프리셋'}</span>{#if original && !builtIn && !fromLore}<button type="button" class="icon danger" title="화풍 삭제" aria-label="화풍 삭제" disabled={locked} onclick={() => deleting = true}><Trash2 size={16} /></button>{/if}</div>
            {#if deleting}<div class="confirm" role="alert"><p>「{original?.name}」을 삭제할까요? 사용 중인 화풍은 기본으로 바뀝니다. 생성한 그림과 기록은 유지됩니다.</p><div class="actions"><button type="button" class="danger" disabled={locked} onclick={remove}>삭제 확인</button><button type="button" disabled={locked} onclick={() => deleting = false}>취소</button></div></div>{/if}
            <fieldset disabled={locked}>
                <label>프리셋 이름<input aria-label="화풍 프리셋 이름" bind:value={draft.name} placeholder="새 화풍 이름" /></label>
                {#if builtIn}<p class="hint">기본 프리셋에는 화풍 태그가 없습니다. 이름을 바꾸고 새 프리셋으로 저장하세요.</p>{/if}
                {#if fromLore}<p class="hint">이 봇의 로어북에서 온 화풍입니다. 고치려면 로어북의 바드페인터 항목을 수정하거나, 이름을 바꿔 개인 프리셋으로 저장하세요.</p>{/if}
                <label>그림체와 작가 태그<BardPainterPromptInput aria-label="화풍 작가 태그" rows={3} spellcheck="false" bind:value={draft.artist}></BardPainterPromptInput></label>
                <label>그림 스타일<BardPainterPromptInput aria-label="화풍 그림 스타일" rows={3} spellcheck="false" bind:value={draft.rendering}></BardPainterPromptInput></label>
                <label>네거티브 프롬프트<BardPainterPromptInput rows={2} spellcheck="false" bind:value={draft.negative}></BardPainterPromptInput></label>
                <details><summary>생성 값</summary><div class="grid">
                    <label>스텝<input type="number" min="1" max="50" step="1" bind:value={draft.steps} /></label>
                    <label>프롬프트 강도<input type="number" min="0" max="10" step="0.1" bind:value={draft.scale} /></label>
                    <label>CFG 리스케일<input type="number" min="0" max="1" step="0.05" bind:value={draft.cfgRescale} /></label>
                    <label>샘플러<select bind:value={draft.sampler}><option value="k_euler_ancestral">Euler Ancestral</option><option value="k_euler">Euler</option><option value="k_dpmpp_2m">DPM++ 2M</option><option value="k_dpmpp_2m_sde">DPM++ 2M SDE</option><option value="k_dpmpp_2s_ancestral">DPM++ 2S Ancestral</option><option value="k_dpmpp_sde">DPM++ SDE</option><option value="ddim_v3">DDIM</option></select></label>
                </div></details>
            </fieldset>
            <div class="save-bar">
                {#if original && !fromLore}<button type="button" disabled={locked || dirty || session.defaultStyle?.id === selected} onclick={setDefault}>기본 화풍으로 지정</button>{/if}
                {#if original && !builtIn && !fromLore}<button type="button" class="primary" disabled={locked || !dirty || !draft.name.trim()} onclick={() => save(false)}>덮어쓰기</button>{/if}
                <button type="button" class:primary={!original || builtIn || fromLore} disabled={locked || !canCopy} onclick={() => save(true)}>{original ? '새 이름으로 저장' : '새 프리셋 저장'}</button>
                {#if dirty && original}<button type="button" disabled={locked} onclick={() => guard(() => load(original!))}>되돌리기</button>{/if}
                {#if original}<p class="hint">새 이름으로 저장하면 원본은 그대로 남습니다.</p>{/if}
            </div>
            <p class="feedback" class:error={failed} role="status">{busy ? '저장 중…' : feedback}</p>
        </section>
    </div>
</div>

<style>
    .style-manager { container-type: inline-size; height: 100%; min-height: 0; display: flex; flex-direction: column; gap: .6rem; color: var(--color-textcolor); }
    .workspace { display: grid; grid-template-columns: minmax(11rem, .65fr) minmax(0, 1.65fr); flex: 1; min-height: 0; gap: 1rem; }
    aside { display: flex; flex-direction: column; min-width: 0; gap: .55rem; border-right: 1px solid var(--color-darkborderc); padding-right: 1rem; }
    .list-toolbar, .editor-heading, .list-footer, .actions, .pagination, .save-bar { display: flex; align-items: center; flex-wrap: wrap; gap: .35rem; }
    .list-toolbar { justify-content: space-between; }
    .list { overflow-y: auto; flex: 1; min-height: 4rem; }
    .preset { display: flex; justify-content: space-between; align-items: center; gap: .5rem; width: 100%; text-align: left; border-color: transparent; }
    .preset span { overflow-wrap: anywhere; min-width: 0; }
    .preset small { flex-shrink: 0; font-size: .7rem; color: var(--color-textcolor2); }
    .preset.chosen { background: var(--color-selected); border-color: var(--color-darkborderc); }
    .list-footer, .pagination { justify-content: flex-end; font-size: .8rem; }
    .list-footer .hint { margin-right: auto; }
    .editor { overflow-y: auto; min-width: 0; padding-right: .25rem; }
    .editor-heading { margin-bottom: .7rem; }
    h3 { font-size: .95rem; font-weight: 600; overflow-wrap: anywhere; }
    .editor-heading .hint { margin-left: auto; }
    fieldset { display: flex; flex-direction: column; gap: .65rem; border: 0; padding: 0; min-width: 0; }
    label { display: flex; flex-direction: column; gap: .3rem; font-size: .8rem; min-width: 0; }
    input, select { width: 100%; min-width: 0; border: 1px solid var(--color-darkborderc); background: var(--color-bgcolor); color: var(--color-textcolor); border-radius: calc(var(--risu-radius-sm) * 1.4); padding: .4rem .5rem; font: inherit; font-size: .85rem; }
    button { display: inline-flex; align-items: center; justify-content: center; min-height: 2rem; padding: .3rem .55rem; border: 1px solid var(--color-darkborderc); border-radius: calc(var(--risu-radius-sm) * 1.4); font-size: .8rem; }
    .icon { width: 2rem; flex: 0 0 2rem; padding: .25rem; }
    button:hover:not(:disabled) { background: var(--color-darkbutton); }
    button:disabled { opacity: .45; cursor: not-allowed; }
    button:focus-visible, input:focus-visible, select:focus-visible, summary:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 2px; }
    .primary { background: var(--color-primary); color: var(--color-accenttext); border-color: var(--color-primary); }
    .danger, .error { color: var(--color-danger); }
    .hint { color: var(--color-textcolor2); font-size: .75rem; line-height: 1.5; }
    .confirm { border: 1px solid var(--color-darkborderc); border-radius: calc(var(--risu-radius-lg) * 0.8); padding: .65rem; font-size: .85rem; display: flex; flex-direction: column; gap: .5rem; }
    .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: .6rem; margin-top: .5rem; }
    summary { cursor: pointer; padding: .4rem 0; font-size: .8rem; }
    .save-bar { border-top: 1px solid var(--color-darkborderc); margin-top: .8rem; padding-top: .65rem; }
    .save-bar p { width: 100%; margin-top: .15rem; }
    .feedback { font-size: .8rem; line-height: 1.5; overflow-wrap: anywhere; margin-top: .35rem; }
    @container (max-width: 620px) { .workspace { display: flex; flex-direction: column; overflow-y: auto; } aside { border-right: 0; border-bottom: 1px solid var(--color-darkborderc); padding-right: 0; padding-bottom: .6rem; flex-shrink: 0; } .list { max-height: 9rem; } .editor { overflow: visible; flex-shrink: 0; } }
    @media (pointer: coarse) { button { min-height: 2.75rem; } .icon { width: 2.75rem; flex-basis: 2.75rem; } }
</style>
