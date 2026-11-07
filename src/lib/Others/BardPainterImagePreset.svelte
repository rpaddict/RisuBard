<script lang="ts">
    import { tooltip } from 'src/ts/gui/tooltip'
    import type { getPainterSession } from 'src/ts/bardPainter/runtime.svelte'
    import type { TogglePreset } from 'src/ts/storage/database.svelte'

    let { session, disabled = false }: { session: ReturnType<typeof getPainterSession>; disabled?: boolean } = $props()

    let imageChoice = $state<TogglePreset | null | undefined>(undefined)
    let imageChoices = $derived(session.imagePresets)
    let imageChoiceIndex = $derived(imageChoices.find(item => item.preset === imageChoice)?.index)
    let imageChoiceValue = $derived(imageChoice === undefined ? (session.imagePreset ? 'applied' : '') : imageChoice === null ? '' : String(imageChoiceIndex))
    let pending = $derived(imageChoice !== undefined && (imageChoice === null || imageChoiceIndex !== undefined))
    $effect(() => { session; session.promptPreset?.id; imageChoice = undefined })

    async function apply() {
        if (disabled || !pending) return
        const current = session
        if (await current.applyImagePreset(imageChoice === null ? null : imageChoiceIndex!) && current === session) imageChoice = undefined
    }
</script>

{#if imageChoices.length || session.imagePreset}
    <div class="image-preset">
        <label for="painter-image-preset" use:tooltip={'현재 채팅 프롬프트의 커스텀 토글 묶음을 프롬프트 작성에만 적용합니다. 채팅 토글은 바꾸지 않으며, 적용하면 시스템 프롬프트를 항상 함께 보냅니다.'}>이미지 프리셋</label>
        <select id="painter-image-preset" aria-label="이미지 프리셋" {disabled} value={imageChoiceValue} onchange={event => { imageChoice = event.currentTarget.value === '' ? null : event.currentTarget.value === 'applied' ? undefined : imageChoices.find(item => item.index === Number(event.currentTarget.value))?.preset }}>
            <option value="">사용 안 함</option>
            {#if session.imagePreset}<option value="applied">{session.imagePreset.name} (적용됨)</option>{/if}
            {#each imageChoices as { preset, index }}<option value={String(index)}>{preset.name}</option>{/each}
        </select>
        <button type="button" class:ready={pending} disabled={disabled || !pending} onclick={apply}>적용</button>
    </div>
{/if}

<style>
    .image-preset { display: flex; align-items: center; gap: .45rem; min-width: 0; }
    label { flex-shrink: 0; font-size: .75rem; color: var(--color-textcolor2); cursor: help; }
    select { flex: 1; width: auto; min-width: 0; min-height: 2rem; padding: .25rem .5rem; border: 1px solid var(--color-darkborderc); border-radius: calc(var(--risu-radius-lg) * 0.8); background: var(--color-bgcolor); color: var(--color-textcolor); font-size: .8rem; }
    button { flex-shrink: 0; min-height: 2rem; padding: 0 .75rem; border: 1px solid var(--color-darkborderc); border-radius: calc(var(--risu-radius-lg) * 0.8); background: transparent; color: var(--color-textcolor); font-size: .78rem; }
    button.ready { border-color: var(--color-primary); background: var(--color-primary); color: var(--color-accenttext); font-weight: 600; }
    button:hover:not(:disabled):not(.ready) { background: var(--color-darkbutton); }
    button:disabled { opacity: .45; cursor: not-allowed; }
    select:focus-visible, button:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 2px; }
    @media (pointer: coarse) { select, button { min-height: 2.75rem; } }
</style>
