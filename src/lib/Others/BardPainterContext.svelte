<script lang="ts">
    import { Buffer } from 'buffer'
    import { BookOpen, Check, ChevronRight, Image, LoaderCircle, Minus, Plus, X } from '@lucide/svelte'
    import { tooltip } from 'src/ts/gui/tooltip'
    import type { getPainterSession } from 'src/ts/bardPainter/runtime.svelte'
    import type { PainterContext } from 'src/ts/bardPainter/types'
    import BardPainterIconButton from './BardPainterIconButton.svelte'

    let { session, disabled = false, onOpenGallery, embedded = false, summary = $bindable('') }: {
        session: ReturnType<typeof getPainterSession>
        disabled?: boolean
        onOpenGallery: () => void
        /** Shown inside the composer, which owns the open and close control. */
        embedded?: boolean
        /** What is sent, in a few words, for a control outside this component. */
        summary?: string
    } = $props()

    type Toggle = 'surrounding' | 'characterDescription' | 'persona' | 'systemPrompt' | 'characterLorebook' | 'moduleLorebook'
    const toggles: Array<{ key: Toggle; label: string; tip: string }> = [
        { key: 'characterDescription', label: '캐릭터 설명', tip: '봇의 캐릭터 설명 전체를 보냅니다.' },
        { key: 'persona', label: '페르소나', tip: '이 챗에 연결된 페르소나 설명을 보냅니다.' },
        { key: 'characterLorebook', label: '캐릭터 로어북', tip: '장면 글, 지시문과 함께 보내는 메시지에서 키워드가 맞은 항목과 상시 활성 항목만 보냅니다. 로어에 연결한 캐릭터 프리셋도 이때 알아봅니다.' },
        { key: 'moduleLorebook', label: '모듈 로어북', tip: '활성 모듈의 로어북을 키워드와 상관없이 모두 보냅니다.' },
        { key: 'systemPrompt', label: '시스템 프롬프트', tip: '채팅 프롬프트의 시스템 지시를 보냅니다.' },
        { key: 'surrounding', label: '메시지 나머지', tip: '장면으로 고른 부분 앞뒤의 같은 메시지 내용을 보냅니다.' },
    ]

    let context = $derived(session.settings.context)
    let wikiIds = $derived(session.data.settings.context.wikiIds)
    let wikiOpen = $state(false)
    // An applied image preset always sends the system prompt, so show that instead of an off switch that does nothing.
    let forcedSystemPrompt = $derived(!!session.imagePreset)
    let scope = $derived(session.generationSettingsPinned ? '이 봇에 고정' : session.hasGenerationOverrides ? '이 챗 설정' : '전역값')
    let referenceId = $derived(session.data.settings.context.referenceAssetId || session.data.results.find(result => result.id === session.data.settings.context.referenceId)?.assetId || '')
    let referenceBroken = $state(false)
    let picked = $derived([
        context.before ? `이전 ${context.before}` : '', context.after ? `이후 ${context.after}` : '',
        ...toggles.filter(item => context[item.key] || (item.key === 'systemPrompt' && forcedSystemPrompt)).map(item => item.label),
        wikiIds.length ? `바드위키 ${wikiIds.length}` : '', referenceId ? '참고 삽화' : '',
    ].filter(Boolean).join(', ') || '장면 글만 보냄')
    $effect(() => { summary = picked })
    $effect(() => { session; wikiOpen = false })
    $effect(() => { referenceId; referenceBroken = false })

    function update(patch: Partial<PainterContext>) { if (!disabled) void session.updateContext(patch) }
    function step(key: 'before' | 'after', delta: number) {
        update({ [key]: Math.max(0, Math.min(20, Math.trunc(context[key] || 0) + delta)) })
    }
    function toggleWiki() {
        wikiOpen = !wikiOpen
        if (wikiOpen && !session.state.wikiDocs.length) void session.loadWiki()
    }
    function selectWiki(id: string, checked: boolean) {
        update({ wikiIds: checked ? [...wikiIds, id] : wikiIds.filter(value => value !== id) })
    }
    const thumbnail = (id: string) => `/api/asset/${Buffer.from(`inlay_thumb/${id}`, 'utf-8').toString('hex')}`
</script>

{#snippet body()}
    <div class="body">
    <p class="hint">프롬프트를 작성할 때 장면 글과 함께 AI에 보낼 자료입니다. 켠 항목만 보냅니다.</p>
    <div class="chips" role="group" aria-label="참고 자료 선택">
        <div class="stepper" role="group" aria-label="장면 앞 메시지 수">
            <span>이전 메시지</span>
            <BardPainterIconButton label="이전 메시지 줄이기" disabled={disabled || context.before <= 0} onclick={() => step('before', -1)}><Minus size={14} /></BardPainterIconButton>
            <output aria-live="polite">{context.before}</output>
            <BardPainterIconButton label="이전 메시지 늘리기" disabled={disabled || context.before >= 20} onclick={() => step('before', 1)}><Plus size={14} /></BardPainterIconButton>
        </div>
        <div class="stepper" role="group" aria-label="장면 뒤 메시지 수">
            <span>이후 메시지</span>
            <BardPainterIconButton label="이후 메시지 줄이기" disabled={disabled || context.after <= 0} onclick={() => step('after', -1)}><Minus size={14} /></BardPainterIconButton>
            <output aria-live="polite">{context.after}</output>
            <BardPainterIconButton label="이후 메시지 늘리기" disabled={disabled || context.after >= 20} onclick={() => step('after', 1)}><Plus size={14} /></BardPainterIconButton>
        </div>
        {#each toggles as item (item.key)}
            {#if item.key === 'systemPrompt' && forcedSystemPrompt}
                <button type="button" class="chip" aria-pressed="true" disabled use:tooltip={'이미지 프리셋을 적용하면 프리셋이 만든 시스템 지시를 항상 보냅니다. 끄려면 이미지 프리셋을 사용 안 함으로 적용하세요.'}><Check size={13} aria-hidden="true" />{item.label} (프리셋)</button>
            {:else}
                <button type="button" class="chip" aria-pressed={context[item.key]} {disabled} use:tooltip={item.tip} onclick={() => update({ [item.key]: !context[item.key] })}>
                    {#if context[item.key]}<Check size={13} aria-hidden="true" />{/if}{item.label}
                </button>
            {/if}
        {/each}
        <button type="button" class="chip" aria-pressed={wikiIds.length > 0} aria-expanded={wikiOpen} {disabled} onclick={toggleWiki} use:tooltip={'선택한 바드위키 문서만 보냅니다. 위키는 수정하지 않습니다.'}>
            <BookOpen size={13} aria-hidden="true" />바드위키{#if wikiIds.length}<span class="count">{wikiIds.length}</span>{/if}
        </button>
        {#if referenceId}
            <span class="chip reference" aria-pressed="true">
                {#if referenceBroken}<Image size={13} aria-hidden="true" />{:else}<img src={thumbnail(referenceId)} alt="" onerror={() => referenceBroken = true} />{/if}참고 삽화
                <button type="button" class="chip-clear" aria-label="참고 삽화 비우기" {disabled} use:tooltip={'참고 삽화 비우기'} onclick={() => void session.setReference('')}><X size={13} /></button>
            </span>
        {:else}
            <button type="button" class="chip" {disabled} onclick={onOpenGallery} use:tooltip={'갤러리에서 그림을 열고 「참고 삽화 지정」을 누르면 그 그림의 외형과 의상을 참고합니다.'}><Image size={13} aria-hidden="true" />참고 삽화</button>
        {/if}
    </div>
    {#if wikiOpen}
        <div class="wiki" aria-label="바드위키 문서 선택">
            {#if session.state.loadingWiki}<p class="hint"><LoaderCircle size={14} class="animate-spin" aria-hidden="true" />위키 목록을 불러오는 중입니다.</p>
            {:else if !session.state.wikiDocs.length}<p class="hint">이 챗에 사용할 수 있는 위키 문서가 없습니다.<button type="button" class="link" onclick={() => void session.loadWiki()}>다시 불러오기</button></p>
            {:else}
                {#each session.state.wikiDocs as doc (doc.id)}
                    <label class="wiki-item"><input type="checkbox" checked={wikiIds.includes(doc.id)} {disabled} onchange={event => selectWiki(doc.id, event.currentTarget.checked)} /><span>{doc.title}</span></label>
                {/each}
                {#if wikiIds.length}<button type="button" class="link" {disabled} onclick={() => update({ wikiIds: [] })}>선택 모두 해제</button>{/if}
            {/if}
        </div>
    {/if}
    </div>
{/snippet}

{#if embedded}
    <section class="context embedded" aria-label="AI에 보낼 참고 자료">
        <div class="embedded-head"><span class="title">AI 참고 자료</span><span class="scope" use:tooltip={'선택 항목은 생성 설정의 적용 범위를 따릅니다. 바드위키와 참고 삽화는 이 챗에만 저장됩니다.'}>{scope}</span></div>
        {@render body()}
    </section>
{:else}
<details class="context" aria-label="AI에 보낼 참고 자료">
    <summary>
        <ChevronRight size={15} class="chevron" aria-hidden="true" />
        <span class="title">AI 참고 자료</span>
        <span class="picked">{picked}</span>
        <span class="scope" use:tooltip={'선택 항목은 생성 설정의 적용 범위를 따릅니다. 바드위키와 참고 삽화는 이 챗에만 저장됩니다.'}>{scope}</span>
    </summary>
    {@render body()}
</details>
{/if}

<style>
    .context { min-width: 0; }
    summary { display: flex; align-items: center; gap: .45rem; min-height: 2rem; min-width: 0; cursor: pointer; list-style: none; border-radius: calc(var(--risu-radius-lg) * 0.8); }
    summary::-webkit-details-marker { display: none; }
    summary:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 2px; }
    summary :global(.chevron) { flex-shrink: 0; color: var(--color-textcolor2); transition: transform .18s cubic-bezier(.16, 1, .3, 1); }
    .context[open] summary :global(.chevron) { transform: rotate(90deg); }
    .title { flex-shrink: 0; font-size: .85rem; font-weight: 600; color: var(--color-textcolor); }
    .picked { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: .75rem; color: var(--color-textcolor2); }
    .scope { flex-shrink: 0; font-size: .72rem; color: var(--color-textcolor2); cursor: help; }
    .body { display: flex; flex-direction: column; gap: .6rem; padding-top: .55rem; }
    .embedded .body { padding-top: .35rem; }
    .embedded-head { display: flex; align-items: center; gap: .5rem; justify-content: space-between; }
    .chips { display: flex; flex-wrap: wrap; gap: .35rem; min-width: 0; }
    .chip, .stepper { display: inline-flex; align-items: center; gap: .3rem; min-height: 2rem; padding: 0 .65rem; border: 1px solid var(--color-darkborderc); border-radius: 999px; background: transparent; color: var(--color-textcolor2); font-size: .78rem; white-space: nowrap; transition: background-color .15s ease-out, border-color .15s ease-out, color .15s ease-out; }
    .chip:hover:not(:disabled) { color: var(--color-textcolor); background: var(--color-darkbutton); }
    .chip[aria-pressed='true'] { border-color: color-mix(in srgb, var(--color-primary) 55%, var(--color-darkborderc)); background: color-mix(in srgb, var(--color-primary) 12%, transparent); color: var(--color-textcolor); }
    .chip:disabled { opacity: .5; cursor: not-allowed; }
    .chip:focus-visible, .chip-clear:focus-visible, .link:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 2px; }
    .stepper { padding: 0 .15rem 0 .65rem; gap: 0; }
    .stepper span { margin-right: .2rem; }
    .stepper :global(.icon-button) { width: 1.6rem; height: 1.6rem; border-radius: 999px; }
    .stepper output { min-width: 1.1rem; text-align: center; color: var(--color-textcolor); font-variant-numeric: tabular-nums; }
    .count { min-width: 1.1rem; padding: 0 .3rem; border-radius: 999px; background: var(--color-primary); color: var(--color-accenttext); font-size: .7rem; text-align: center; font-variant-numeric: tabular-nums; }
    .reference { padding-left: .3rem; padding-right: .2rem; }
    .reference img { width: 1.5rem; height: 1.5rem; border-radius: 999px; object-fit: cover; }
    .chip-clear { display: inline-grid; place-items: center; width: 1.5rem; height: 1.5rem; border: 0; border-radius: 999px; padding: 0; color: var(--color-textcolor2); background: transparent; }
    .chip-clear:hover:not(:disabled) { color: var(--color-textcolor); background: var(--color-darkbutton); }
    .wiki { display: flex; flex-direction: column; gap: .1rem; max-height: 14rem; overflow: auto; padding: .4rem .5rem; border: 1px solid var(--color-darkborderc); border-radius: var(--risu-radius-lg); }
    .wiki-item { display: flex; align-items: center; gap: .5rem; min-height: 2rem; font-size: .8rem; color: var(--color-textcolor); cursor: pointer; overflow-wrap: anywhere; }
    .wiki-item input { width: 1rem; height: 1rem; flex-shrink: 0; accent-color: var(--color-primary); }
    .hint { display: flex; align-items: center; flex-wrap: wrap; gap: .4rem; font-size: .78rem; color: var(--color-textcolor2); line-height: 1.5; }
    .link { align-self: flex-start; border: 0; padding: .2rem 0; background: transparent; color: var(--color-textcolor2); font-size: .78rem; text-decoration: underline; text-underline-offset: 3px; }
    .link:hover:not(:disabled) { color: var(--color-textcolor); }
    @media (pointer: coarse) { .chip, .stepper, summary { min-height: 2.75rem; } .stepper :global(.icon-button) { width: 2.4rem; height: 2.4rem; } .chip-clear { width: 2.2rem; height: 2.2rem; } }
</style>
