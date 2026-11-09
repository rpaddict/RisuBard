<script lang="ts">
    import { X } from '@lucide/svelte'
    import type { getPainterSession } from 'src/ts/bardPainter/runtime.svelte'
    import ManagerResizeHandles from 'src/lib/UI/GUI/ManagerResizeHandles.svelte'
    import BardPainterStyles from './BardPainterStyles.svelte'
    import BardPainterFragments from './BardPainterFragments.svelte'
    import ShDialog from 'src/lib/UI/GUI/ShDialog.svelte'
    import BardPainterPresets from './BardPainterPresets.svelte'
    import { PAINTER_IMAGE_SIZES, painterSizeMode } from 'src/ts/bardPainter/types'
    let { session, mode, onClose, disabled = false }: {
        session: ReturnType<typeof getPainterSession>
        mode: 'style' | 'characters' | 'settings' | 'fragments' | null
        onClose: () => void
        disabled?: boolean
    } = $props()

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
                    <p class="hint">{session.generationSettingsPinned ? '이 봇에 고정된 값' : session.hasGenerationOverrides ? '이 챗의 개별 값' : '전역값'}을 사용 중입니다. 메인 화면의 참고 자료 선택도 이 범위를 따릅니다. 바드위키와 참고 삽화는 현재 챗에만 저장됩니다.</p>
                    <section aria-label="프롬프트 작성">
                        <h3>프롬프트 작성</h3>
                        <label>프롬프트 작성 모델<select value={settings.modelSlot} onchange={event => { settings.modelSlot = event.currentTarget.value as typeof settings.modelSlot; save() }}><option value="model">메인 모델</option><option value="submodel">보조 모델</option></select></label>
                        <p class="hint">AI에 보낼 참고 자료는 바드페인터 메인 화면의 참고 자료에서 고릅니다.</p>
                    </section>
                    <section aria-label="이미지 생성 설정">
                        <h3>이미지 생성</h3>
                        <label>NovelAI 모델<select value={settings.model} onchange={event => { settings.model = event.currentTarget.value as typeof settings.model; save() }}><option value="nai-diffusion-5-full">NovelAI V5 Full</option><option value="nai-diffusion-5-curated">NovelAI V5 Curated</option><option value="nai-diffusion-4-5-full">NovelAI V4.5 Full</option><option value="nai-diffusion-4-5-curated">NovelAI V4.5 Curated</option></select></label>
                        {#if settings.model === 'nai-diffusion-4-5-full' || settings.model === 'nai-diffusion-4-5-curated'}<p class="hint">V4.5는 인물과 사물 블록을 최대 6개까지 지원합니다.</p>{/if}
                        <div class="grid">
                            <label>이미지 크기<select aria-label="이미지 크기" value={painterSizeMode(settings) === 'ai' ? 'ai' : `${settings.width}x${settings.height}`} onchange={event => { const value = event.currentTarget.value; if (value === 'ai') settings.sizeMode = 'ai'; else { const [width, height] = value.split('x').map(Number); settings.sizeMode = 'fixed'; settings.width = width; settings.height = height } save() }}><option value="ai">AI 결정</option>{#each PAINTER_IMAGE_SIZES as size (size.id)}<option value={`${size.width}x${size.height}`}>{size.label}</option>{/each}</select></label>
                            <label>시드<span class="hint">비우면 무작위</span><input aria-label="이미지 시드" type="number" min="0" max="4294967295" step="1" value={settings.seed ?? ''} onchange={event => { settings.seed = event.currentTarget.value === '' ? null : event.currentTarget.valueAsNumber; save() }} /></label>
                        </div>
                        {#if painterSizeMode(settings) === 'ai'}<p class="hint">프롬프트를 작성할 때 AI가 장면 구도에 맞춰 위의 다섯 가지 크기 중 하나를 고릅니다. 고르지 못하면 세로 832 × 1216으로 생성합니다.</p>{/if}
                        <label>인물 위치<select aria-label="인물 위치" value={settings.positionMode ?? 'plan'} onchange={event => { settings.positionMode = event.currentTarget.value as 'plan' | 'novelai'; save() }}><option value="plan">AI가 정한 위치 사용</option><option value="novelai">NovelAI에 맡기기</option></select></label>
                        <p class="hint">{(settings.positionMode ?? 'plan') === 'plan' ? '프롬프트를 작성할 때 AI가 인물과 사물마다 고른 위치를 NovelAI 캐릭터 좌표로 보냅니다. 위치가 없는 블록이 하나라도 있으면 좌표 없이 생성합니다.' : '좌표를 보내지 않고 NovelAI가 인물 위치를 정합니다. 좌표 때문에 구도가 어색할 때 사용하세요. AI가 고른 위치는 초안에 남아 있어 다시 바꾸면 바로 쓰입니다.'}</p>
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
    input:not([type='checkbox']), select { border: 1px solid var(--color-darkborderc); background: var(--color-bgcolor); color: var(--color-textcolor); border-radius: calc(var(--risu-radius-lg) * 0.8); padding: .6rem; min-width: 0; width: 100%; }
    input, select, button { min-height: 2rem; }
    .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: .75rem; }
    .check { flex-direction: row; align-items: center; min-height: 2.75rem; gap: .5rem; }
    input[type='checkbox'] { width: 1rem; height: 1rem; min-height: 0; accent-color: var(--color-primary); flex-shrink: 0; }
    .hint { color: var(--color-textcolor2); line-height: 1.55; font-size: .8rem; }
    button { border: 1px solid var(--color-darkborderc); border-radius: calc(var(--risu-radius-lg) * 0.8); padding: .3rem .55rem; font-size: .8rem; overflow-wrap: anywhere; }
    button:hover:not(:disabled) { background: var(--color-darkbutton); }
    button:disabled { opacity: .5; cursor: not-allowed; }
    input:focus-visible, select:focus-visible, button:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 2px; }
    .actions { display: flex; flex-wrap: wrap; gap: .5rem; }
    .footer { justify-content: flex-end; width: 100%; }
    @media (pointer: coarse) { button, input, select { min-height: 2.75rem; } }
    .error { margin-top: .75rem; color: var(--color-danger); overflow-wrap: anywhere; }
    @media (max-width: 520px) { .grid { grid-template-columns: 1fr; } }
</style>
