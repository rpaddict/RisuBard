<script lang="ts">
    import { Box, ChevronDown, ChevronRight, ChevronUp, Download, Ellipsis, Link2, Lock, LockOpen, RotateCcw, Save, Trash2, User } from '@lucide/svelte'
    import { tooltip } from 'src/ts/gui/tooltip'
    import BardPainterPromptInput from './BardPainterPromptInput.svelte'
    import BardPainterIconButton from './BardPainterIconButton.svelte'
    import type { PainterSubject } from 'src/ts/bardPainter/types'
    import type { getPainterSession } from 'src/ts/bardPainter/runtime.svelte'

    let { subject, session, disabled = false, index, total, onMove, onRemove }: {
        subject: PainterSubject
        session: ReturnType<typeof getPainterSession>
        disabled?: boolean
        index: number
        total: number
        onMove: (direction: -1 | 1) => void
        onRemove: () => void
    } = $props()

    const matchLabels = { lore: '로어 연결로 알아봄', name: '이름으로 알아봄', context: '식별 메모로 추정함, 맞는 인물인지 확인하세요', manual: '직접 불러옴' } as const
    let collapsed = $state(false)
    let moreOpen = $state(false)
    let confirmRemove = $state(false)
    let outfitName = $state('')
    let character = $derived(subject.kind === 'character')
    let linked = $derived(session.identities.find(item => item.id === subject.id))
    let globalMatch = $derived(session.globalMatchFor(subject))
    let globalChoices = $derived(session.unreflectedGlobalIdentities)
    let outfits = $derived(session.outfitChoices(subject.id))
    let outfit = $derived(outfits.find(item => item.id === subject.outfitId))
    let customAppearance = $derived(!!linked?.appearance.trim() && subject.appearance !== linked.appearance)
    let canSaveLook = $derived(character && !!subject.name.trim() && !!subject.appearance.trim() && (!linked?.appearance.trim() || customAppearance))
    let label = $derived(subject.name.trim() || (character ? `인물 ${index + 1}` : `사물 ${index + 1}`))
    $effect(() => { subject.id; confirmRemove = false; outfitName = '' })

    function save() { void session.persist() }
    function editAppearance(value: string) {
        subject.appearance = value
        // Only the user's own wording outlives a revision; matching the preset again clears that.
        if (linked?.appearance.trim() ? value !== linked.appearance : !!value.trim()) subject.appearanceEdited = true
        else delete subject.appearanceEdited
    }
    function editClothing(value: string) {
        subject.clothing = value
        if (outfit && value !== outfit.clothing) subject.outfitEdited = true
        else delete subject.outfitEdited
    }
    function revertAppearance() {
        if (!linked?.appearance.trim()) return
        subject.appearance = linked.appearance
        delete subject.appearanceEdited
        save()
    }
    function chooseCharacter(value: string) {
        const [kind, id] = [value.slice(0, value.indexOf(':')), value.slice(value.indexOf(':') + 1)]
        if (!id || disabled) return
        void session.linkSubject(subject.id, kind === 'global' ? { globalId: id } : { identityId: id })
    }
    function toggleKind() {
        subject.kind = character ? 'object' : 'character'
        save()
    }
</script>

<article class="subject" class:collapsed data-painter-subject={subject.id} aria-label={label}>
    <header>
        <BardPainterIconButton label={collapsed ? `${label} 펼치기` : `${label} 접기`} onclick={() => collapsed = !collapsed}>{#if collapsed}<ChevronRight size={16} />{:else}<ChevronDown size={16} />{/if}</BardPainterIconButton>
        <BardPainterIconButton label={character ? '인물 블록 (누르면 사물로 바꿈)' : '사물 블록 (누르면 인물로 바꿈)'} {disabled} onclick={toggleKind}>{#if character}<User size={16} />{:else}<Box size={16} />{/if}</BardPainterIconButton>
        <input class="name" aria-label={`대상 ${index + 1} 이름`} placeholder={character ? '이름' : '사물 이름'} {disabled} bind:value={subject.name} onblur={save} />
        {#if character && linked && subject.presetMatch}
            <span class="preset" class:uncertain={subject.presetMatch === 'context'} data-preset-match={subject.presetMatch} use:tooltip={`캐릭터 프리셋 「${linked.name}」을 불러왔습니다. ${matchLabels[subject.presetMatch]}.`}><Link2 size={13} aria-hidden="true" />{linked.name === subject.name.trim() ? '프리셋' : linked.name}{#if outfit}<span class="sep">/</span>{outfit.name}{/if}</span>
        {/if}
        <span class="spacer"></span>
        <BardPainterIconButton label={subject.locked ? 'AI로 개선해도 이 블록 유지 중 (누르면 해제)' : 'AI로 개선할 때 이 블록 유지'} pressed={!!subject.locked} {disabled} onclick={() => { subject.locked = !subject.locked; save() }}>{#if subject.locked}<Lock size={15} />{:else}<LockOpen size={15} />{/if}</BardPainterIconButton>
        <BardPainterIconButton label={`${label} 더 보기`} expanded={moreOpen} onclick={() => { moreOpen = !moreOpen; collapsed = false }}><Ellipsis size={16} /></BardPainterIconButton>
    </header>

    {#if !collapsed}
        {#if globalMatch}
            <div class="global" role="note">
                <p>글로벌 보관함의 「{globalMatch.name}」이 이 봇에 없어서 저장된 외형을 쓰지 못했습니다.</p>
                <button type="button" {disabled} onclick={() => void session.linkSubject(subject.id, { globalId: globalMatch!.id })}><Download size={14} aria-hidden="true" />봇에 반영하고 불러오기</button>
            </div>
        {/if}
        <fieldset {disabled}>
            <div class="field">
                <div class="field-head">
                    <label for={`subject-${subject.id}-appearance`}>{character ? '외형' : '형태와 재질'}</label>
                    {#if customAppearance}<span class="badge">직접 수정함</span>{/if}
                    <span class="spacer"></span>
                    {#if customAppearance}<BardPainterIconButton label="프리셋 외형으로 되돌리기" {disabled} onclick={revertAppearance}><RotateCcw size={14} /></BardPainterIconButton>{/if}
                    {#if canSaveLook}<BardPainterIconButton label={linked?.appearance.trim() ? '프리셋 외형을 이 내용으로 덮어쓰기' : '이름과 외형을 캐릭터 프리셋으로 저장'} {disabled} onclick={() => void session.rememberIdentity(subject.id)}><Save size={14} /></BardPainterIconButton>{/if}
                    {#if character}
                        <select class="picker" aria-label={`대상 ${index + 1} 캐릭터 불러오기`} value={linked ? `bot:${linked.id}` : ''} {disabled} onchange={event => { const value = event.currentTarget.value; event.currentTarget.value = linked ? `bot:${linked.id}` : ''; chooseCharacter(value) }}>
                            <option value="">캐릭터 불러오기</option>
                            {#each session.identities as identity (identity.id)}<option value={`bot:${identity.id}`}>{identity.name}{identity.appearance.trim() ? '' : ' (외형 없음)'}</option>{/each}
                            {#if globalChoices.length}<optgroup label="글로벌 (고르면 이 봇에 반영)">{#each globalChoices as identity (identity.id)}<option value={`global:${identity.id}`}>{identity.name}</option>{/each}</optgroup>{/if}
                        </select>
                    {/if}
                </div>
                <BardPainterPromptInput id={`subject-${subject.id}-appearance`} rows={2} spellcheck="false" placeholder={character ? '머리, 눈, 체형 등 변하지 않는 특징' : '모양, 재질, 색'} value={subject.appearance} oninput={event => editAppearance(event.currentTarget.value)} onblur={save} />
            </div>
            <div class="field">
                <div class="field-head">
                    <label for={`subject-${subject.id}-clothing`}>{character ? '의상' : '상태'}</label>
                    {#if subject.outfitEdited}<span class="badge">직접 수정함</span>{/if}
                    <span class="spacer"></span>
                    {#if character}
                        <select class="picker" aria-label={`대상 ${index + 1} 의상 불러오기`} value={subject.outfitId ?? ''} disabled={disabled || !outfits.length} onchange={event => { const id = event.currentTarget.value; event.currentTarget.value = subject.outfitId ?? ''; if (id) void session.applyOutfit(subject.id, id) }}>
                            <option value="">{outfits.length ? '의상 불러오기' : '저장된 의상 없음'}</option>
                            {#each outfits as item (item.id)}<option value={item.id}>{item.name}{item.subjectId ? '' : ' (공용)'}</option>{/each}
                        </select>
                    {/if}
                </div>
                <!-- An object keeps clothing only when it was a person before; show it rather than send hidden text. -->
                {#if character || subject.clothing.trim()}<BardPainterPromptInput id={`subject-${subject.id}-clothing`} rows={2} spellcheck="false" placeholder="옷, 장신구" value={subject.clothing} oninput={event => editClothing(event.currentTarget.value)} onblur={save} />{/if}
                <input class="state" id={character || subject.clothing.trim() ? undefined : `subject-${subject.id}-clothing`} aria-label={`대상 ${index + 1} 상태`} placeholder={character ? '일시적 상태: 젖음, 찢어짐, 상처 등' : '젖음, 깨짐 등'} bind:value={subject.state} onblur={save} />
            </div>
            <div class="field">
                <div class="field-head"><label for={`subject-${subject.id}-pose`}>자세와 행동</label></div>
                <BardPainterPromptInput id={`subject-${subject.id}-pose`} rows={2} spellcheck="false" placeholder="화면 위치, 자세, 행동, 표정, 시선" bind:value={subject.pose} onblur={save} />
            </div>
            {#if moreOpen}
                <div class="more" data-subject-more>
                    {#if character}<label class="field">별칭<input aria-label={`대상 ${index + 1} 별칭`} placeholder="쉼표로 구분" value={subject.aliases.join(', ')} onchange={event => { subject.aliases = event.currentTarget.value.split(',').map(value => value.trim()).filter(Boolean); save() }} /></label>{/if}
                    <div class="field">
                        <label for={`subject-${subject.id}-negative`}>제외할 요소</label>
                        <BardPainterPromptInput id={`subject-${subject.id}-negative`} rows={1} spellcheck="false" placeholder="이 대상에서만 빼고 싶은 요소" bind:value={subject.negative} onblur={save} />
                    </div>
                    {#if character}
                        <div class="outfit-save">
                            <input aria-label={`${label} 저장할 의상 이름`} placeholder="의상 이름 (예: 겨울 여행복)" bind:value={outfitName} />
                            <button type="button" disabled={!outfitName.trim() || !subject.clothing.trim()} use:tooltip={'의상과 상태를 이 챗의 의상 프리셋으로 저장합니다. 봇 공용 저장은 캐릭터 프리셋 창에서 합니다.'} onclick={async () => { if (await session.saveOutfit(subject.id, outfitName.trim(), true)) outfitName = '' }}><Save size={14} aria-hidden="true" />의상 저장</button>
                        </div>
                    {/if}
                    <div class="block-actions">
                        <BardPainterIconButton label={`${label} 위로`} disabled={index === 0} onclick={() => onMove(-1)}><ChevronUp size={16} /></BardPainterIconButton>
                        <BardPainterIconButton label={`${label} 아래로`} disabled={index === total - 1} onclick={() => onMove(1)}><ChevronDown size={16} /></BardPainterIconButton>
                        <span class="spacer"></span>
                        {#if confirmRemove}
                            <span class="confirm">블록을 삭제할까요?</span>
                            <button type="button" class="danger" onclick={onRemove}>삭제</button>
                            <button type="button" onclick={() => confirmRemove = false}>취소</button>
                        {:else}
                            <BardPainterIconButton label={`${label} 블록 삭제`} tone="danger" onclick={() => confirmRemove = true}><Trash2 size={15} /></BardPainterIconButton>
                        {/if}
                    </div>
                </div>
            {/if}
        </fieldset>
    {/if}
</article>

<style>
    .subject { display: flex; flex-direction: column; gap: .5rem; min-width: 0; padding: .45rem .6rem .7rem; border: 1px solid var(--color-darkborderc); border-radius: calc(var(--risu-radius-lg) * 1.2); background: var(--color-darkbg); }
    .subject.collapsed { padding-bottom: .45rem; }
    header, .field-head, .block-actions, .outfit-save { display: flex; align-items: center; gap: .25rem; min-width: 0; }
    .spacer { flex: 1; }
    .name { flex: 1 1 6rem; min-width: 0; min-height: 2rem; padding: .2rem .4rem; border: 1px solid transparent; border-radius: calc(var(--risu-radius-lg) * 0.8); background: transparent; color: var(--color-textcolor); font-size: .9rem; font-weight: 600; }
    .name:hover:not(:disabled) { border-color: var(--color-darkborderc); }
    .name:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 1px; background: var(--color-bgcolor); }
    .name::placeholder { color: var(--color-textcolor2); font-weight: 400; }
    .preset { display: inline-flex; align-items: center; gap: .25rem; max-width: 45%; min-width: 0; padding: .1rem .5rem; border-radius: 999px; background: color-mix(in srgb, var(--color-primary) 12%, transparent); color: var(--color-textcolor); font-size: .72rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; cursor: help; }
    .preset.uncertain { background: color-mix(in srgb, var(--color-danger) 14%, transparent); }
    .sep { color: var(--color-textcolor2); }
    .global { display: flex; flex-wrap: wrap; align-items: center; gap: .4rem .6rem; padding: .5rem .6rem; border-radius: calc(var(--risu-radius-lg) * 0.9); background: color-mix(in srgb, var(--color-primary) 10%, var(--color-bgcolor)); font-size: .78rem; line-height: 1.5; color: var(--color-textcolor); }
    .global p { flex: 1 1 12rem; margin: 0; }
    fieldset { display: flex; flex-direction: column; gap: .65rem; min-width: 0; margin: 0; padding: 0 .1rem; border: 0; }
    fieldset:disabled { opacity: .65; }
    .field { display: flex; flex-direction: column; gap: .25rem; min-width: 0; font-size: .75rem; color: var(--color-textcolor2); }
    .field-head { min-height: 2rem; }
    .field-head label { font-size: .75rem; color: var(--color-textcolor2); }
    .badge { padding: 0 .4rem; border-radius: 999px; background: var(--color-bgcolor); color: var(--color-textcolor2); font-size: .68rem; line-height: 1.6; }
    .picker { width: auto; max-width: min(11rem, 55%); min-height: 1.85rem; padding: .15rem 1.6rem .15rem .5rem; border: 1px solid var(--color-darkborderc); border-radius: calc(var(--risu-radius-lg) * 0.8); background-color: var(--color-bgcolor); color: var(--color-textcolor); font-size: .75rem; text-overflow: ellipsis; }
    input:not(.name), .picker { font-family: inherit; }
    .state, .more input { width: 100%; min-width: 0; min-height: 2rem; padding: .3rem .55rem; border: 1px solid var(--color-darkborderc); border-radius: calc(var(--risu-radius-lg) * 0.8); background: var(--color-bgcolor); color: var(--color-textcolor); font-size: .8rem; }
    .state::placeholder, .more input::placeholder { color: var(--color-textcolor2); opacity: .85; }
    .picker:focus-visible, .state:focus-visible, .more input:focus-visible, button:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 2px; }
    .subject :global(textarea) { min-height: 2.6rem; font-size: .82rem; }
    .more { display: flex; flex-direction: column; gap: .6rem; padding-top: .6rem; border-top: 1px solid var(--color-darkborderc); }
    .outfit-save input { flex: 1; }
    button:not(.icon-button) { display: inline-flex; align-items: center; gap: .3rem; flex-shrink: 0; min-height: 2rem; padding: 0 .7rem; border: 1px solid var(--color-darkborderc); border-radius: calc(var(--risu-radius-lg) * 0.8); background: transparent; color: var(--color-textcolor); font-size: .78rem; white-space: nowrap; }
    button:not(.icon-button):hover:not(:disabled) { background: var(--color-darkbutton); }
    button:disabled { opacity: .5; cursor: not-allowed; }
    .danger { color: var(--color-danger); }
    .confirm { font-size: .78rem; color: var(--color-textcolor); }
    @media (pointer: coarse) { .name, .picker, .state, .more input, button:not(.icon-button) { min-height: 2.75rem; } }
</style>
