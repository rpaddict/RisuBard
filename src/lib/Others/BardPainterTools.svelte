<script lang="ts">
    import { X } from '@lucide/svelte'
    import type { getPainterSession } from 'src/ts/bardPainter/runtime.svelte'
    import ManagerResizeHandles from 'src/lib/UI/GUI/ManagerResizeHandles.svelte'
    import BardPainterStyles from './BardPainterStyles.svelte'
    import BardPainterFragments from './BardPainterFragments.svelte'
    import ShDialog from 'src/lib/UI/GUI/ShDialog.svelte'
    import BardPainterPresets from './BardPainterPresets.svelte'
    import BardPainterReference from './BardPainterReference.svelte'
    let { session, mode, onClose, disabled = false }: {
        session: ReturnType<typeof getPainterSession>
        mode: 'style' | 'characters' | 'settings' | 'fragments' | null
        onClose: () => void
        disabled?: boolean
    } = $props()

    let data = $derived(session.data)
    let settings = $derived(session.settings)
    let dialogElement = $state<HTMLElement | null>(null)
    let dirty = $state(false), confirmClose = $state(false)
    let locked = $derived(disabled)
    let dialogTitle = $derived(mode === 'style' ? '화풍 프리셋' : mode === 'characters' ? '캐릭터 프리셋' : mode === 'fragments' ? '표현 조각 관리' : '생성 설정')
    $effect(() => { mode; session; dirty = false; confirmClose = false })
    function requestClose() {
        if (mode !== 'settings' && session.state.status === 'saving') return
        if (dirty) confirmClose = true
        else onClose()
    }
    $effect(() => {
        if (!mode) return
        function keydown(event: KeyboardEvent) {
            if (event.key !== 'Escape' || !dialogElement?.contains(event.target as Node)) return
            event.preventDefault(); event.stopPropagation()
            if (confirmClose) confirmClose = false
            else requestClose()
        }
        document.addEventListener('keydown', keydown, true)
        return () => document.removeEventListener('keydown', keydown, true)
    })

    function save() { void session.updateGenerationSettings(settings) }
    function selectWiki(id: string, checked: boolean) {
        const ids = data.settings.context.wikiIds
        data.settings.context.wikiIds = checked ? [...new Set([...ids, id])] : ids.filter(value => value !== id)
        void session.persist()
    }
</script>

{#if mode}
    {#key mode}
    <ShDialog open={true} size="xl" closable={false} closeOnEscape={false} closeOnOutsideClick={mode === 'settings'} onOpenChange={open => { if (!open) requestClose() }}
        bind:contentElement={dialogElement} contentClass="painter-tools-dialog" bodyClass="painter-tools-body" >
        {#snippet headerActions()}<button type="button" class="dialog-close" aria-label="닫기" title="닫기" disabled={mode !== 'settings' && session.state.status === 'saving'} onclick={requestClose}><X size={18}/></button>{/snippet}
        {#snippet title()}{dialogTitle}{/snippet}
        <div class="tools" class:settings={mode === 'settings'} data-painter-tools={mode}>
            {#if mode === 'style'}
                <BardPainterStyles {session} disabled={locked} onDirtyChange={value => dirty = value} />
            {:else if mode === 'characters'}
                <BardPainterPresets {session} disabled={locked} expanded={true} onDirtyChange={value => dirty = value} />
            {:else if mode === 'fragments'}
                <BardPainterFragments {session} disabled={locked} onDirtyChange={value => dirty = value} />
            {:else if mode === 'settings'}
                <fieldset disabled={locked}>
                    <div class="actions" aria-label="생성 설정 적용 범위">
                        <label class="check" title="이 봇의 기존 챗과 새 챗에 공통 적용합니다. 해제하면 현재 챗은 값을 유지합니다."><input type="checkbox" checked={session.generationSettingsPinned} onchange={event => void session.pinGenerationSettings(event.currentTarget.checked)} />이 봇에 고정</label>
                        <button type="button" disabled={!session.hasGenerationOverrides} title="현재 생성 옵션을 전역 기본값으로 저장합니다. 봇 고정 상태는 유지합니다." onclick={() => void session.applyGenerationSettingsToGlobal()}>전역값으로 설정</button>
                        <button type="button" disabled={!session.hasGenerationOverrides} title={session.generationSettingsPinned ? '이 봇의 고정 설정을 현재 전역값으로 바꿉니다.' : '이 챗의 개별 설정을 지우고 전역값을 사용합니다.'} onclick={() => void session.useGlobalGenerationSettings()}>전역값 사용</button>
                    </div>
                    <p class="hint">{session.generationSettingsPinned ? '이 봇에 고정된 값' : session.hasGenerationOverrides ? '이 챗의 개별 값' : '전역값'}을 사용 중입니다. 요청문, 화풍, 선택한 위키 항목과 참고 그림은 현재 챗에서 유지됩니다.</p>
                    <section aria-label="AI에 보낼 참고 자료">
                        <h3>AI에 보낼 참고 자료</h3>
                        <p class="hint">그릴 순간은 확정한 원문으로 고정됩니다. 아래 자료는 외형과 배경을 보완할 때 사용합니다.</p>
                        <div class="grid">
                            <label>이전 메시지 수<input aria-label="이전 메시지 수" type="number" min="0" max="20" step="1" value={settings.context.before} onchange={event => { settings.context.before = event.currentTarget.valueAsNumber; save() }} /></label>
                            <label>이후 메시지 수<input aria-label="이후 메시지 수" type="number" min="0" max="20" step="1" value={settings.context.after} onchange={event => { settings.context.after = event.currentTarget.valueAsNumber; save() }} /></label>
                        </div>
                        <div class="checks">
                            <label class="check"><input type="checkbox" checked={settings.context.surrounding} onchange={event => { settings.context.surrounding = event.currentTarget.checked; save() }} />선택한 메시지의 나머지 내용</label>
                            <label class="check"><input type="checkbox" checked={settings.context.characterDescription} onchange={event => { settings.context.characterDescription = event.currentTarget.checked; save() }} />캐릭터 설명</label>
                            <label class="check"><input type="checkbox" checked={settings.context.persona} onchange={event => { settings.context.persona = event.currentTarget.checked; save() }} />페르소나</label>
                            <label class="check"><input type="checkbox" checked={settings.context.systemPrompt} onchange={event => { settings.context.systemPrompt = event.currentTarget.checked; save() }} />채팅 시스템 프롬프트</label>
                            <label class="check"><input type="checkbox" checked={settings.context.characterLorebook} onchange={event => { settings.context.characterLorebook = event.currentTarget.checked; save() }} />캐릭터 로어북</label>
                            <label class="check"><input type="checkbox" checked={settings.context.moduleLorebook} onchange={event => { settings.context.moduleLorebook = event.currentTarget.checked; save() }} />모듈 로어북</label>
                        </div>
                        <details class="advanced">
                            <summary>바드위키 항목 선택{#if data.settings.context.wikiIds.length} ({data.settings.context.wikiIds.length}개){/if}</summary>
                            <div class="actions">
                                <button type="button" disabled={session.state.loadingWiki} onclick={() => session.loadWiki()}>{session.state.loadingWiki ? '위키 불러오는 중…' : '위키 목록 불러오기'}</button>
                                {#if data.settings.context.wikiIds.length}<button type="button" onclick={() => { data.settings.context.wikiIds = []; void session.persist() }}>선택 해제</button>{/if}
                            </div>
                            <div class="wiki-list">
                                {#each session.state.wikiDocs as doc (doc.id)}
                                    <label class="check"><input type="checkbox" checked={data.settings.context.wikiIds.includes(doc.id)} onchange={event => selectWiki(doc.id, event.currentTarget.checked)} />{doc.title}</label>
                                {/each}
                            </div>
                            <p class="hint">선택한 항목만 전송합니다. 위키를 수정하지 않습니다.</p>
                        </details>
                        <BardPainterReference {session} disabled={locked}/>
                        <label>프롬프트 작성 모델<select value={settings.modelSlot} onchange={event => { settings.modelSlot = event.currentTarget.value as typeof settings.modelSlot; save() }}><option value="model">메인 모델</option><option value="submodel">보조 모델</option></select></label>
                    </section>
                    <section aria-label="이미지 생성 설정">
                        <h3>이미지 생성</h3>
                        <label>NovelAI 모델<select value={settings.model} onchange={event => { settings.model = event.currentTarget.value as typeof settings.model; save() }}><option value="nai-diffusion-5-full">NovelAI V5 Full</option><option value="nai-diffusion-5-curated">NovelAI V5 Curated</option></select></label>
                        <div class="grid">
                            <label>이미지 크기<select aria-label="이미지 크기" value={`${settings.width}x${settings.height}`} onchange={event => { const [width, height] = event.currentTarget.value.split('x').map(Number); settings.width = width; settings.height = height; save() }}><option value="832x1216">세로 832 × 1216</option><option value="1216x832">가로 1216 × 832</option><option value="1024x1024">정사각 1024 × 1024</option></select></label>
                            <label>시드<span class="hint">비우면 무작위</span><input aria-label="이미지 시드" type="number" min="0" max="4294967295" step="1" value={settings.seed ?? ''} onchange={event => { settings.seed = event.currentTarget.value === '' ? null : event.currentTarget.valueAsNumber; save() }} /></label>
                        </div>
                        <p class="hint">앱 설정에 저장된 NovelAI API 키를 사용합니다. 생성한 이미지는 원래 해상도의 WebP로 저장합니다.</p>
                    </section>
                </fieldset>
            {/if}
            {#if mode === 'settings' && session.state.error}<p class="error" role="alert">{session.state.error}</p>{/if}
        </div>
        <ManagerResizeHandles target={dialogElement} centered resizeStorageKey={`bard-painter-${mode}-dialog`} />
        {#snippet footer()}
            <div class="actions footer">
                {#if confirmClose}<p class="hint">저장하지 않은 변경을 버릴까요?</p><button type="button" onclick={onClose}>변경 버리고 닫기</button><button type="button" onclick={() => confirmClose = false}>계속 편집</button>
                {:else}<span class="resize-hint hint">모서리로 크기 조절 / 두 번 클릭하면 초기화</span><button type="button" disabled={mode !== 'settings' && session.state.status === 'saving'} onclick={requestClose}>닫기</button>{/if}
            </div>
        {/snippet}
    </ShDialog>
    {/key}
{/if}

<style>
    :global(.painter-tools-dialog) { width: min(var(--manager-width, 64rem), calc(100vw - 2rem)); max-width: calc(100vw - 2rem); height: min(var(--manager-height, 80dvh), calc(100dvh - 2rem)); max-height: calc(100dvh - 2rem); min-height: min(24rem, calc(100dvh - 2rem)); min-width: min(24rem, calc(100vw - 2rem)); overflow: hidden; gap: .75rem; }
    :global(.painter-tools-body) { flex: 1; min-height: 0; display: flex; flex-direction: column; overflow: hidden; }
    .tools { color: var(--color-textcolor); min-width: 0; min-height: 0; flex: 1; }
    .tools.settings { overflow-y: auto; padding-right: .25rem; }
    .dialog-close { position: absolute; top: -.15rem; right: 0; width: 2rem; height: 2rem; min-height: 2rem; padding: .2rem; display: grid; place-items: center; }
    .resize-hint { margin-right: auto; }
    @media (max-width: 640px) { .resize-hint { display: none; } }

    fieldset, section { display: flex; flex-direction: column; gap: .85rem; padding: 0; border: 0; margin: 0; min-width: 0; }
    fieldset:disabled { opacity: .65; }
    section + section { border-top: 1px solid var(--color-darkborderc); margin-top: .5rem; padding-top: 1rem; }
    h3 { font-size: .95rem; font-weight: 600; }
    label { display: flex; flex-direction: column; gap: .35rem; min-width: 0; font-size: .85rem; }
    input:not([type='checkbox']), select { border: 1px solid var(--color-darkborderc); background: var(--color-bgcolor); color: var(--color-textcolor); border-radius: .4rem; padding: .6rem; min-width: 0; width: 100%; }
    input, select, button, summary { min-height: 2rem; }
    .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: .75rem; }
    .checks { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: .2rem .75rem; }
    .check { flex-direction: row; align-items: center; min-height: 2.75rem; gap: .5rem; }
    input[type='checkbox'] { width: 1rem; height: 1rem; min-height: 0; accent-color: var(--color-primary); flex-shrink: 0; }
    .advanced { border-top: 1px solid var(--color-darkborderc); padding-top: .2rem; }
    summary { cursor: pointer; padding: .55rem 0; font-size: .85rem; overflow-wrap: anywhere; }
    .wiki-list { max-height: 15rem; overflow: auto; margin-top: .5rem; }
    .wiki-list label { overflow-wrap: anywhere; }
    .hint { color: var(--color-textcolor2); line-height: 1.55; font-size: .8rem; }
    button { border: 1px solid var(--color-darkborderc); border-radius: .4rem; padding: .3rem .55rem; font-size: .8rem; overflow-wrap: anywhere; }
    button:hover:not(:disabled) { background: var(--color-darkbutton); }
    button:disabled { opacity: .5; cursor: not-allowed; }
    input:focus-visible, select:focus-visible, button:focus-visible, summary:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 2px; }
    .actions { display: flex; flex-wrap: wrap; gap: .5rem; }
    .footer { justify-content: flex-end; width: 100%; }
    @media (pointer: coarse) { button, input, select { min-height: 2.75rem; } }
    .error { margin-top: .75rem; color: var(--color-danger); overflow-wrap: anywhere; }
    @media (max-width: 520px) { .grid, .checks { grid-template-columns: 1fr; } }
</style>
