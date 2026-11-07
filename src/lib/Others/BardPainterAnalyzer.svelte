<script lang="ts">
    import { LoaderCircle, ScanFace, X } from '@lucide/svelte'
    import type { getPainterSession } from 'src/ts/bardPainter/runtime.svelte'
    import type { AnalyzerItem } from 'src/ts/bardPainter/analyzer'
    import ShDialog from 'src/lib/UI/GUI/ShDialog.svelte'
    import BardPainterContext from './BardPainterContext.svelte'
    import BardPainterPromptInput from './BardPainterPromptInput.svelte'

    let { session, open = $bindable(false), onOpenGallery }: {
        session: ReturnType<typeof getPainterSession>
        open?: boolean
        onOpenGallery: () => void
    } = $props()

    let instruction = $state('')
    let items = $state<AnalyzerItem[]>([])
    let confirmClose = $state(false)
    let busy = $derived(session.state.status !== 'idle')
    let analyzing = $derived(session.state.status === 'prompt')
    let chosen = $derived(items.filter(item => item.selected).length)
    let destinations = $derived(session.analyzerDestinations)
    $effect(() => { session; items = []; confirmClose = false })

    const scopeLabel = (scope: string) => scope === 'chat' ? '챗 로어북' : destinations.find(item => item.id === scope)?.label ?? (scope.startsWith('module:') ? '모듈' : '캐릭터 로어북')
    function requestClose() {
        if (busy) return
        if (items.length && !confirmClose) { confirmClose = true; return }
        confirmClose = false; open = false
    }
    async function analyze() {
        if (busy || !instruction.trim()) return
        const result = await session.analyzeCharacters(instruction)
        if (result) items = result
    }
    async function save() {
        if (busy || !chosen) return
        if (await session.saveCharacterAnalysis($state.snapshot(items) as AnalyzerItem[])) { items = []; open = false }
    }
    function keydown(event: KeyboardEvent) {
        if (!event.isComposing && event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); void analyze() }
    }
</script>

{#if open}
<ShDialog open={true} size="xl" closable={false} closeOnEscape={false} closeOnOutsideClick={false} onOpenChange={value => { if (!value) requestClose() }} contentClass="painter-analyzer-dialog">
    {#snippet headerActions()}<button type="button" class="dialog-close" aria-label="닫기" disabled={busy} onclick={requestClose}><X size={18} /></button>{/snippet}
    {#snippet title()}캐릭터 분석기{/snippet}
    {#snippet description()}대화 맥락에서 지정한 캐릭터의 외형과 의상을 NovelAI 프롬프트로 만들어 로어북의 바드페인터 프리셋으로 저장합니다.{/snippet}
    <div class="analyzer" data-painter-analyzer>
        <section class="request" aria-label="분석 요청">
            <label for="painter-analyzer-instruction">지시문</label>
            <textarea id="painter-analyzer-instruction" rows="3" maxlength="4000" disabled={busy} bind:value={instruction} onkeydown={keydown}
                placeholder="예: 페르소나/user/야가미 키스케의 잠옷을 알아서 만들어 줘"></textarea>
            <p class="hint">대상이 여럿이면 슬래시(/)로 나눕니다. 맥락은 아래에서 고르며 바드페인터 패널과 같은 설정을 씁니다. 장면을 정하지 않았으면 마지막 메시지를 함께 보냅니다.</p>
            <BardPainterContext {session} disabled={busy} {onOpenGallery} />
            <div class="run">
                {#if analyzing}
                    <button type="button" class="ghost" onclick={() => session.cancel()}><X size={15} aria-hidden="true" />분석 중지</button>
                    <span class="status" role="status"><LoaderCircle size={14} class="animate-spin" aria-hidden="true" />분석하고 있습니다.</span>
                {:else}
                    <button type="button" class="primary" disabled={busy || !instruction.trim()} onclick={() => void analyze()}><ScanFace size={16} aria-hidden="true" />{items.length ? '다시 분석' : '분석'}</button>
                    <span class="hint">Ctrl+Enter로도 분석합니다.</span>
                {/if}
            </div>
        </section>

        {#if items.length}
            <section class="results" aria-label="분석 결과">
                <h3>분석 결과 <span>{items.length}명</span></h3>
                {#each items as item (item.key)}
                    <article class="card" class:off={!item.selected} data-analyzer-item={item.presetId}>
                        <header>
                            <input type="checkbox" class="pick" aria-label={`${item.name} 저장`} disabled={busy} bind:checked={item.selected} />
                            <input class="name" aria-label="캐릭터 이름" disabled={busy} bind:value={item.name} />
                            <span class="badge" class:new={!item.existing}>{item.existing ? `${scopeLabel(item.existing.scope)}에 있음` : '새 캐릭터'}</span>
                        </header>
                        <fieldset disabled={busy || !item.selected}>
                            {#if item.existing}
                                <div class="row">
                                    <div class="segment" role="group" aria-label={`${item.name} 작업`}>
                                        <button type="button" aria-pressed={item.action === 'overwrite'} onclick={() => item.action = 'overwrite'}>외형 덮어쓰기</button>
                                        <button type="button" aria-pressed={item.action === 'outfit'} onclick={() => item.action = 'outfit'}>의상만 추가</button>
                                    </div>
                                    <span class="where">저장 위치: {scopeLabel(item.existing.scope)}</span>
                                </div>
                            {:else}
                                <label class="inline">저장 위치
                                    <select aria-label={`${item.name} 저장 위치`} bind:value={item.destination}>
                                        {#each destinations as destination (destination.id)}<option value={destination.id}>{destination.label}</option>{/each}
                                    </select>
                                </label>
                            {/if}
                            <label class="inline">별칭<input aria-label={`${item.name} 별칭`} placeholder="쉼표로 구분" value={item.aliases.join(', ')}
                                onchange={event => item.aliases = event.currentTarget.value.split(',').map(value => value.trim()).filter(Boolean)} /></label>
                            {#if item.action !== 'outfit'}
                                <div class="field">
                                    <span class="label">외형{#if item.existing}<em>기존 외형을 이 내용으로 바꿉니다</em>{/if}</span>
                                    <BardPainterPromptInput rows={2} spellcheck="false" aria-label={`${item.name} 외형`} bind:value={item.appearance} />
                                    {#if item.existing?.appearance}<details><summary>기존 외형 보기</summary><pre>{item.existing.appearance}</pre></details>{/if}
                                </div>
                            {/if}
                            <div class="field">
                                <span class="label">의상</span>
                                {#each item.outfits as outfit, index (outfit.id)}
                                    <div class="outfit">
                                        <div class="outfit-head">
                                            <input aria-label="의상 이름" bind:value={outfit.name} />
                                            {#if item.existing?.outfits.some(saved => saved.id === outfit.id)}<span class="badge warn">기존 의상 바꿈</span>{/if}
                                            <button type="button" class="remove" aria-label={`의상 ${outfit.name} 빼기`} onclick={() => item.outfits.splice(index, 1)}><X size={14} /></button>
                                        </div>
                                        <BardPainterPromptInput rows={2} spellcheck="false" aria-label={`의상 ${outfit.name}`} bind:value={outfit.clothing} />
                                    </div>
                                {:else}
                                    <p class="hint">{item.action === 'outfit' ? '추가할 의상이 없습니다. 이 항목은 저장되지 않습니다.' : '추가할 의상이 없습니다.'}</p>
                                {/each}
                            </div>
                        </fieldset>
                    </article>
                {/each}
            </section>
        {/if}
        {#if session.state.error}<p class="error" role="alert">{session.state.error}</p>
        {:else if session.state.notice && !analyzing}<p class="notice" role="status">{session.state.notice}</p>{/if}
    </div>
    {#snippet footer()}
        <div class="footer">
            {#if confirmClose}
                <p class="hint">저장하지 않은 분석 결과를 버릴까요?</p>
                <button type="button" onclick={() => { items = []; confirmClose = false; open = false }}>버리고 닫기</button>
                <button type="button" onclick={() => confirmClose = false}>계속 보기</button>
            {:else}
                <button type="button" disabled={busy} onclick={requestClose}>닫기</button>
                {#if items.length}<button type="button" class="primary" disabled={busy || !chosen} onclick={() => void save()}>{chosen ? `${chosen}개 로어북에 저장` : '저장할 항목 없음'}</button>{/if}
            {/if}
        </div>
    {/snippet}
</ShDialog>
{/if}

<style>
    :global(.painter-analyzer-dialog) { width: min(52rem, calc(100vw - 2rem)); max-width: calc(100vw - 2rem); }
    .dialog-close { position: absolute; top: -.15rem; right: 0; display: grid; place-items: center; width: 2rem; height: 2rem; border-radius: calc(var(--risu-radius-lg) * 0.8); color: var(--color-textcolor2); }
    .dialog-close:hover:not(:disabled) { background: var(--color-darkbutton); color: var(--color-textcolor); }
    .analyzer { display: flex; flex-direction: column; gap: 1.25rem; min-width: 0; color: var(--color-textcolor); font-size: .875rem; }
    .request, .results { display: flex; flex-direction: column; gap: .6rem; min-width: 0; }
    .results { padding-top: 1.1rem; border-top: 1px solid var(--color-darkborderc); }
    label[for], .label, h3 { font-size: .85rem; font-weight: 600; }
    h3 span { margin-left: .3rem; color: var(--color-textcolor2); font-weight: 400; font-size: .78rem; }
    textarea, select, input:not([type='checkbox']) { width: 100%; min-width: 0; min-height: 2rem; padding: .45rem .6rem; border: 1px solid var(--color-darkborderc); border-radius: calc(var(--risu-radius-lg) * 0.8); background: var(--color-bgcolor); color: var(--color-textcolor); font: inherit; font-size: .84rem; }
    textarea { resize: vertical; line-height: 1.55; }
    textarea:focus-visible, select:focus-visible, input:focus-visible, button:focus-visible, summary:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 2px; }
    .hint { color: var(--color-textcolor2); font-size: .78rem; line-height: 1.55; }
    .run { display: flex; flex-wrap: wrap; align-items: center; gap: .6rem; }
    .status { display: inline-flex; align-items: center; gap: .4rem; color: var(--color-textcolor2); font-size: .8rem; }
    button { display: inline-flex; align-items: center; justify-content: center; gap: .35rem; min-height: 2.1rem; padding: 0 .85rem; border: 1px solid var(--color-darkborderc); border-radius: calc(var(--risu-radius-lg) * 0.9); background: transparent; color: var(--color-textcolor); font-size: .82rem; white-space: nowrap; }
    button:hover:not(:disabled) { background: var(--color-darkbutton); }
    button:disabled { opacity: .45; cursor: not-allowed; }
    .primary { min-height: 2.5rem; padding: 0 1.2rem; border-color: var(--color-primary); background: var(--color-primary); color: var(--color-accenttext); font-weight: 700; }
    .primary:hover:not(:disabled) { background: var(--color-primary); filter: brightness(1.08); }
    .card { display: flex; flex-direction: column; gap: .6rem; padding: .7rem .8rem .85rem; border: 1px solid var(--color-darkborderc); border-radius: calc(var(--risu-radius-lg) * 1.2); background: var(--color-darkbg); }
    .card.off { opacity: .6; }
    .card header, .row, .outfit-head { display: flex; align-items: center; gap: .5rem; min-width: 0; flex-wrap: wrap; }
    .pick { width: 1.1rem; height: 1.1rem; flex-shrink: 0; accent-color: var(--color-primary); }
    .name { flex: 1 1 10rem; width: auto; font-weight: 600; font-size: .95rem; }
    .badge { flex-shrink: 0; padding: .1rem .55rem; border-radius: 999px; background: color-mix(in srgb, var(--color-primary) 14%, transparent); font-size: .72rem; white-space: nowrap; }
    .badge.new { background: color-mix(in srgb, var(--color-textcolor2) 16%, transparent); }
    .badge.warn { background: color-mix(in srgb, var(--color-danger) 16%, transparent); }
    fieldset { display: flex; flex-direction: column; gap: .65rem; min-width: 0; margin: 0; padding: 0; border: 0; }
    .segment { display: inline-flex; padding: .15rem; border: 1px solid var(--color-darkborderc); border-radius: 999px; background: var(--color-bgcolor); }
    .segment button { min-height: 1.8rem; padding: 0 .75rem; border: 0; border-radius: 999px; color: var(--color-textcolor2); font-size: .78rem; }
    .segment button[aria-pressed='true'] { background: color-mix(in srgb, var(--color-primary) 22%, transparent); color: var(--color-textcolor); font-weight: 600; }
    .where { color: var(--color-textcolor2); font-size: .78rem; }
    .inline { display: flex; flex-direction: column; gap: .3rem; font-size: .78rem; color: var(--color-textcolor2); }
    .field { display: flex; flex-direction: column; gap: .35rem; min-width: 0; }
    .label em { margin-left: .5rem; color: var(--color-textcolor2); font-style: normal; font-weight: 400; font-size: .74rem; }
    details summary { cursor: pointer; color: var(--color-textcolor2); font-size: .76rem; }
    pre { margin: .3rem 0 0; padding: .45rem .6rem; border-radius: calc(var(--risu-radius-lg) * 0.8); background: var(--color-bgcolor); white-space: pre-wrap; overflow-wrap: anywhere; font: inherit; font-size: .78rem; color: var(--color-textcolor2); }
    .outfit { display: flex; flex-direction: column; gap: .3rem; padding: .5rem; border: 1px solid var(--color-darkborderc); border-radius: var(--risu-radius-lg); }
    .outfit-head input { flex: 1 1 8rem; width: auto; }
    .remove { width: 2rem; padding: 0; flex-shrink: 0; }
    .error { padding: .5rem .65rem; border: 1px solid var(--color-danger); border-radius: calc(var(--risu-radius-lg) * 0.9); font-size: .8rem; line-height: 1.5; overflow-wrap: anywhere; }
    .notice { color: var(--color-textcolor2); font-size: .8rem; }
    .footer { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: .5rem; width: 100%; }
    .footer .hint { margin-right: auto; }
    @media (pointer: coarse) { button, input:not([type='checkbox']), select { min-height: 2.75rem; } }
</style>
