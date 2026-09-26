<script lang="ts">
    import BardPainterPromptInput from './BardPainterPromptInput.svelte'
    import { Trash2 } from '@lucide/svelte'
    import { tooltip } from 'src/ts/gui/tooltip'
    import { Buffer } from 'buffer'
    import { untrack } from 'svelte'
    import { getPainterSession } from 'src/ts/bardPainter/runtime.svelte'
    import { formatPainterPromptText } from 'src/ts/bardPainter/prompt'
    import { painterSelection, painterInsertionRequest } from 'src/ts/bardPainter/selectionState'
    import { painterGalleryRequested } from 'src/ts/bardPainter/gallery'
    import { botMakerMode, CharConfigSubMenu, risuBardGalleryOpen, MobileSideBar } from 'src/ts/stores.svelte'
    import BardPainterSubject from './BardPainterSubject.svelte'
    import BardPainterTools from './BardPainterTools.svelte'
    import type { TogglePreset } from 'src/ts/storage/database.svelte'

    let { characterId, chatId, visible = true }: { characterId: string; chatId: string; visible?: boolean } = $props()
    let session = $state(untrack(() => getPainterSession(characterId, chatId)))
    $effect(() => { const bot = characterId; const chat = chatId; session = untrack(() => getPainterSession(bot, chat)) })
    let data = $derived(session.data)
    let selection = $derived($painterSelection?.characterId === characterId && $painterSelection.chatId === chatId ? $painterSelection : null)
    let scene = $derived(data.draft ? data.anchor : selection?.anchor ?? data.anchor)
    let newScene = $derived(!!selection?.anchor && !!data.draft && JSON.stringify(selection.anchor) !== JSON.stringify(data.anchor))
    let latest = $derived(data.results.reduce<typeof data.results[number] | undefined>((result, item) => !result || item.createdAt > result.createdAt ? item : result, undefined))
    let insertionTarget = $derived(selection?.issue ? undefined : selection?.anchor ?? data.anchor ?? latest?.anchor)
    let busy = $derived(session.state.status !== 'idle')
    let blocked = $derived(busy || session.state.pendingImage)
    let imageChoice = $state<TogglePreset | null | undefined>(undefined)
    let imageChoices = $derived(session.imagePresets)
    let imageChoiceIndex = $derived(imageChoices.find(item => item.preset === imageChoice)?.index)
    let imageChoiceValue = $derived(imageChoice === undefined ? (session.imagePreset ? 'applied' : '') : imageChoice === null ? '' : String(imageChoiceIndex))
    $effect(() => { session; session.promptPreset?.id; imageChoice = undefined })
    async function applyImagePreset() {
        if (blocked || imageChoice === undefined || imageChoice !== null && imageChoiceIndex === undefined) return
        const current = session
        if (await current.applyImagePreset(imageChoice === null ? null : imageChoiceIndex!) && current === session) imageChoice = undefined
    }
    let resetBlocked = $derived(blocked || session.chat.isStreaming)
    let toolMode = $state<'style' | 'characters' | 'settings' | 'fragments' | null>(null)
    let confirmScene = $state(false)
    let confirmFresh = $state(false)
    let confirmDiscard = $state(false)
    let confirmClear = $state(false)
    let confirmReset = $state(false)
    let copying = $state(false)
    let expanded = $state(false)
    let broken = $state(false)
    let conversationLog: HTMLDivElement | undefined = $state()
    $effect(() => { data.conversation?.at(-1)?.id; if (conversationLog) conversationLog.scrollTop = conversationLog.scrollHeight })
    let status = $derived(session.state.status === 'prompt' ? '프롬프트를 작성하고 있습니다.' : session.state.status === 'image' ? 'NovelAI에서 이미지를 생성하고 있습니다.' : session.state.status === 'saving' ? '저장하고 있습니다.' : '')
    $effect(() => { characterId; chatId; toolMode = null; confirmScene = false; confirmFresh = false; confirmDiscard = false; confirmClear = false; confirmReset = false })
    $effect(() => { latest?.assetId; expanded = false; broken = false })
    function save() { void session.persist() }
    async function resetWorkspace() {
        if (resetBlocked) return
        const current = session
        if (await current.resetWorkspace() && current === session) {
            window.getSelection()?.removeAllRanges()
            confirmReset = false; confirmScene = false; confirmFresh = false; confirmClear = false; toolMode = null
        }
    }
    async function copyPrompt() {
        if (!data.draft || copying) return
        const current = session
        copying = true
        current.state.error = ''; current.state.notice = ''
        try {
            await navigator.clipboard.writeText(formatPainterPromptText(data.draft, current.style))
            current.state.notice = '프롬프트 원문을 복사했습니다.'
        } catch (cause) {
            current.state.error = `프롬프트를 복사하지 못했습니다. ${cause instanceof Error ? cause.message : String(cause)}`
        } finally { copying = false }
    }
    function specifyInsertion() {
        if (!latest || busy || latest.compressionPending) return
        const current = session, result = latest
        painterInsertionRequest.set({ characterId, chatId, resultId: result.id,
            messageId: insertionTarget?.messageId ?? result.anchor.messageId,
            preferredOffset: insertionTarget?.end,
            insert: anchor => current.insert(result.id, 'after', anchor),
            error: () => current.state.error,
        })
    }
    async function prepare(fresh = false) {
        if (!scene || blocked) return
        confirmFresh = false
        const current = session
        const instruction = data.settings.instruction
        const success = await current.prepare(scene, { instruction, fresh })
        if (success && current === session && data.settings.instruction === instruction) { data.settings.instruction = ''; save() }
    }
    async function clearConversation() {
        if (blocked || !data.conversation?.length) return
        const current = session
        if (await current.clearConversation() && current === session) confirmClear = false
    }
    function selectScene() {
        if (!selection?.anchor || blocked || session.chat.isStreaming) return
        if (newScene) { confirmScene = true; return }
        data.anchor = JSON.parse(JSON.stringify(selection.anchor))
        save()
    }
    function changeScene() {
        if (!selection?.anchor || blocked || session.chat.isStreaming) return
        data.anchor = JSON.parse(JSON.stringify(selection.anchor))
        data.draft = undefined; data.previousDraft = undefined; data.conversation = []
        confirmScene = false; save()
    }
    function addSubject() {
        if (!data.draft) return
        data.draft.subjects.push({ id: crypto.randomUUID(), name: '', aliases: [], kind: 'character', appearance: '', clothing: '', state: '', pose: '', negative: '' })
        save()
    }
    function moveSubject(index: number, direction: -1 | 1) {
        const subjects = data.draft?.subjects
        if (!subjects || index + direction < 0 || index + direction >= subjects.length) return
        const [subject] = subjects.splice(index, 1); subjects.splice(index + direction, 0, subject); save()
    }
    function openGallery() {
        risuBardGalleryOpen.set(false); botMakerMode.set(true); CharConfigSubMenu.set(1)
        painterGalleryRequested.set(characterId); MobileSideBar.set(0)
    }
    function assetUrl(id: string, original = false) {
        return `/api/asset/${Buffer.from(`${original ? 'inlay/' : 'inlay_thumb/'}${id}`, 'utf8').toString('hex')}`
    }
    function imageError(event: Event) {
        if (!latest) return
        const image = event.currentTarget as HTMLImageElement
        const original = assetUrl(latest.assetId, true)
        if (!image.src.endsWith(original)) image.src = original
        else broken = true
    }
</script>

{#if visible}
<section class="painter" aria-label="바드페인터" data-bard-painter>
    <header>
        <div class="title-row"><h2>바드페인터</h2><nav aria-label="바드페인터 도구"><button type="button" disabled={resetBlocked} aria-expanded={confirmReset} onclick={() => confirmReset = !confirmReset}>리셋</button><button type="button" class="primary" onclick={() => toolMode = 'style'}>화풍</button><button type="button" class="primary" onclick={() => toolMode = 'characters'}>캐릭터</button><button type="button" class="primary" onclick={() => toolMode = 'settings'}>생성 설정</button></nav></div>
        <p class="hint">{session.style.name} / {session.settings.width} × {session.settings.height} / {session.settings.model.includes('curated') ? 'V5 Curated' : 'V5 Full'}</p>
        {#if confirmReset}<p class="hint">그릴 장면, 초안, 프롬프트 대화, 입력한 요청, 참고 그림과 현재 그림 표시를 비울까요? 생성 설정과 프리셋, 갤러리 이미지와 본문에 삽입한 이미지는 유지됩니다.</p><div class="actions"><button type="button" disabled={resetBlocked} onclick={() => void resetWorkspace()}>리셋 확인</button><button type="button" onclick={() => confirmReset = false}>취소</button></div>{/if}
    </header>
    <BardPainterTools {session} mode={toolMode} onClose={() => toolMode = null} disabled={blocked} />

    <div class="scene-options">
        <label class="perspective">시점<select aria-label="그림 시점" title="다음 프롬프트 작성과 개선에 적용합니다. 1인칭에서는 사용자 캐릭터를 묘사하지 않습니다." disabled={blocked} value={data.settings.perspective ?? 'third-person'} onchange={event => { data.settings.perspective = event.currentTarget.value === 'first-person' ? 'first-person' : 'third-person'; save() }}><option value="first-person">1인칭</option><option value="third-person">3인칭</option></select></label>
        <div class="image-preset">
            <label>이미지 프리셋<select aria-label="이미지 프리셋" title="현재 프롬프트의 커스텀 토글 프리셋을 선택한 뒤 적용하세요. 프롬프트 작성과 개선에만 사용하며 채팅 토글은 변경하지 않습니다." disabled={blocked} value={imageChoiceValue} onchange={event => { imageChoice = event.currentTarget.value === '' ? null : event.currentTarget.value === 'applied' ? undefined : imageChoices.find(item => item.index === Number(event.currentTarget.value))?.preset }}>
                <option value="">사용 안 함</option>
                {#if session.imagePreset}<option value="applied">{session.imagePreset.name} (적용됨)</option>{/if}
                {#each imageChoices as { preset, index }}<option value={String(index)}>{preset.name}</option>{/each}
            </select></label>
            <button type="button" disabled={blocked || imageChoice === undefined || imageChoice !== null && imageChoiceIndex === undefined} onclick={applyImagePreset}>적용</button>
        </div>
    </div>

    <section class="card scene" aria-label="그릴 장면">
        <div class="section-title"><h3><span class="step">1</span>그릴 장면</h3><div class="actions">{#if data.draft}<span class="hint">확정됨</span>{/if}<button type="button" class="primary" disabled={!selection?.anchor || blocked || session.chat.isStreaming} aria-expanded={confirmScene} onclick={selectScene}>그릴 장면 선택</button></div></div>
        {#if scene}<blockquote>{scene.text}</blockquote>
        {:else}<p class="empty">본문에서 그리고 싶은 부분을 드래그해 주세요. 선택한 내용으로 프롬프트를 작성합니다.</p>{/if}
        {#if selection?.issue && !scene}<p class="hint">{selection.issue}</p>{/if}
        {#if newScene && confirmScene}
            <p class="hint">현재 초안을 비우고 새로 선택한 부분을 그릴 장면으로 바꿉니다.</p><div class="actions"><button type="button" disabled={blocked || session.chat.isStreaming} onclick={changeScene}>장면 변경 확인</button><button type="button" onclick={() => confirmScene = false}>취소</button></div>
        {/if}
    </section>

    <section class="draft" aria-label="프롬프트 초안">
        <div class="section-title"><h3><span class="step">2</span>프롬프트 초안</h3><div class="actions"><button type="button" disabled={blocked || copying || !data.draft} onclick={() => void copyPrompt()}>원문 카피</button>{#if data.previousDraft}<button type="button" disabled={blocked} onclick={() => session.restoreDraft()}>이전 초안으로</button>{/if}</div></div>
        {#if data.draft}
            <details class="card"><summary use:tooltip={'화풍은 상단의 화풍 프리셋에서 설정합니다.'}>화풍</summary>
                <pre>{[session.style.artist, session.style.rendering, data.draft.rendering].filter(Boolean).join('\n') || '설정된 화풍이 없습니다.'}</pre>
                <h4>네거티브 프롬프트</h4>
                <pre>{[session.style.negative, data.draft.negative].filter(Boolean).join('\n') || '설정된 네거티브 프롬프트가 없습니다.'}</pre>
            </details>
            <details class="card" open aria-label="메인 프롬프트"><summary>메인 블록</summary>
                <fieldset disabled={blocked}>
                    <BardPainterPromptInput rows={4} spellcheck="false" bind:value={data.draft.scene} onblur={save} aria-label="메인 프롬프트" />
                    <section class="fragments" aria-label="표현 조각">
                        <div class="section-title"><h4><button type="button" class="section-help" use:tooltip={'관리에서 저장한 표현 조각을 추가하세요. AI가 초안을 작성하거나 개선해도 표현 조각은 그대로 유지됩니다.'}>표현 조각</button></h4><button type="button" onclick={() => toolMode = 'fragments'}>관리</button></div>
                        {#each data.draft.fragments ?? [] as fragment, index (fragment.id)}
                            <div class="fragment">
                                <details class="fragment-content">
                                    <summary>{fragment.name}</summary>
                                    <BardPainterPromptInput rows={2} spellcheck="false" bind:value={fragment.prompt} onblur={save} aria-label={`표현 조각 ${fragment.name}`} />
                                </details>
                                <button type="button" class="remove-fragment" title="표현 조각 제거" aria-label={`표현 조각 ${fragment.name} 제거`} onclick={() => { data.draft?.fragments?.splice(index, 1); save() }}><Trash2 size={16} /></button>
                            </div>
                        {/each}
                    </section>
                </fieldset>
            </details>
            <div class="subjects" aria-label="인물과 사물 블록">
                {#each data.draft.subjects as subject, index (subject.id)}
                    <BardPainterSubject {subject} {session} {index} total={data.draft.subjects.length} disabled={blocked} onMove={direction => moveSubject(index, direction)} onRemove={() => { data.draft?.subjects.splice(index, 1); save() }} />
                {/each}
            </div>
            <button type="button" class="quiet" disabled={blocked || data.draft.subjects.length >= 22} onclick={addSubject}>인물 블록 추가</button>
        {:else}<p class="empty">아래 대화창에서 원하는 구도나 분위기를 알려 주세요. 요청 없이 바로 작성할 수도 있습니다.</p>{/if}
    </section>

    <section class="card conversation" aria-label="프롬프트 대화">
        <div class="section-title"><h3>프롬프트 대화</h3><button type="button" disabled={blocked || !data.conversation?.length} aria-expanded={confirmClear} onclick={() => confirmClear = !confirmClear}>대화 비우기</button></div>
        {#if confirmClear}<p class="hint">이 챗의 프롬프트 대화 기록을 비울까요? 초안과 생성한 삽화는 유지됩니다.</p><div class="actions"><button type="button" disabled={blocked} onclick={() => void clearConversation()}>비우기 확인</button><button type="button" onclick={() => confirmClear = false}>취소</button></div>{/if}
        {#if data.conversation?.length}<div class="conversation-log" bind:this={conversationLog} role="log" aria-label="프롬프트 대화 기록">{#each data.conversation.slice(-6) as message (message.id)}<p class:user={message.role === 'user'}><span class="hint">{message.role === 'user' ? '나' : '바드페인터'}</span>{message.text}</p>{/each}</div>{/if}
        <label class="composer-label">{data.draft ? '어떻게 다듬을까요?' : '어떤 그림을 원하시나요?'}<BardPainterPromptInput aria-label="프롬프트 대화 입력" rows={3} maxlength={6000} placeholder={data.draft ? '예: 인물을 더 가까이, 배경은 흐리게 바꿔 줘' : '예: 창가에 앉은 인물의 옆모습을 그려 줘'} bind:value={data.settings.instruction} onblur={save} disabled={blocked} onkeydown={event => { if (!event.defaultPrevented && !event.isComposing && event.keyCode !== 229 && event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); event.stopImmediatePropagation(); void prepare() } }}></BardPainterPromptInput></label>
        <div class="actions"><button type="button" class="primary" disabled={blocked || !scene} onclick={() => prepare()}>{data.draft ? '초안 개선' : '프롬프트 작성'}</button>{#if data.draft}<button type="button" disabled={blocked} onclick={() => confirmFresh = true}>새로 작성</button>{/if}<span class="hint">Ctrl+Enter로 보내기</span></div>
        {#if confirmFresh}<p class="hint">현재 초안 대신 확정한 장면에서 다시 작성합니다. 실패하면 기존 초안은 유지됩니다.</p><div class="actions"><button type="button" disabled={blocked} onclick={() => prepare(true)}>새로 작성 확인</button><button type="button" onclick={() => confirmFresh = false}>취소</button></div>{/if}
    </section>
    {#if session.state.error}<p class="feedback error" role="alert">{session.state.error}</p>{/if}
    <div role="status" aria-live="polite">{#if status}<p class="feedback">{status}</p>{#if session.state.status === 'prompt'}<button type="button" onclick={() => session.cancel()}>프롬프트 작성 취소</button>{/if}{:else if session.state.notice}<p class="hint">{session.state.notice}</p>{/if}</div>
    {#if session.state.pendingImage}
        <section class="card" aria-label="생성 이미지 복구"><p>이미지는 생성되었지만 저장을 마치지 못했습니다. 재생성 없이 저장만 다시 시도합니다.</p><div class="actions"><button type="button" disabled={busy} onclick={() => session.retrySave()}>저장 다시 시도</button><button type="button" disabled={busy} onclick={() => session.downloadOriginal()}>원본 다운로드</button><button type="button" disabled={busy} onclick={() => confirmDiscard = true}>저장 대기 해제</button></div>
        {#if confirmDiscard}<p class="hint">먼저 원본을 다운로드해 주세요. 이미 저장된 파일은 갤러리에 남습니다.</p><div class="actions"><button type="button" disabled={busy} onclick={() => { confirmDiscard = false; void session.discardPending() }}>대기 해제 확인</button><button type="button" onclick={() => confirmDiscard = false}>취소</button></div>{/if}</section>
    {/if}
    <section class="output" aria-label="현재 삽화">
        <div class="section-title"><h3><span class="step">3</span>그림 만들기</h3><button type="button" onclick={openGallery}>갤러리 열기</button></div>
        <div class="actions generation-actions"><button type="button" class="primary" disabled={blocked || !data.anchor || !data.draft?.scene.trim()} onclick={() => session.generate()}>이미지 생성</button><button type="button" class="primary" onclick={() => toolMode = 'settings'}>생성 설정</button><span class="hint" aria-label="현재 이미지 형식과 화풍">{session.settings.width > session.settings.height ? '가로' : session.settings.width < session.settings.height ? '세로' : '정사각형'} / {session.style.name}</span></div>
        <p class="hint">프롬프트를 확인한 뒤 생성하세요. NovelAI 사용량이 차감될 수 있습니다.</p>
        {#if latest}
            <article class="card result" data-painter-result={latest.id}>
                {#if broken}<p class="empty">이미지를 불러오지 못했습니다.</p><button type="button" onclick={() => broken = false}>다시 불러오기</button>
                {:else}<button type="button" class="image-button" aria-label={expanded ? '이미지 축소' : '이미지 크게 보기'} onclick={() => expanded = !expanded}><img src={assetUrl(latest.assetId, expanded)} alt="최근 생성한 삽화" width={latest.settings.width} height={latest.settings.height} loading="lazy" decoding="async" onerror={imageError} /></button>{/if}
                <p class="hint">{latest.style.name} / 시드 {latest.seed}</p>
                {#if insertionTarget}<p class="hint">{selection?.anchor ? (insertionTarget.insertionUnavailable ? '최근 선택한 메시지에 삽입' : '최근 선택한 위치에 삽입') : '그릴 장면의 위치에 삽입'}{#if latest.inserted} / 삽입 완료{/if}</p>{/if}
                <div class="actions insertion"><button type="button" class="primary" disabled={busy || latest.compressionPending || !insertionTarget} onclick={() => session.insert(latest!.id, 'before', insertionTarget)}>위에 삽입</button><button type="button" class="primary" disabled={busy || latest.compressionPending || !insertionTarget} onclick={() => session.insert(latest!.id, 'after', insertionTarget)}>아래에 삽입</button><button type="button" class="primary" disabled={busy || latest.compressionPending} aria-pressed={$painterInsertionRequest?.resultId === latest.id} onclick={specifyInsertion}>지정 삽입</button></div>
            </article>
        {/if}
    </section>
</section>
{/if}

<style>
    .painter { flex: 1; min-width: 0; min-height: 0; overflow: auto; padding: clamp(.75rem, 3vw, 1.25rem); color: var(--color-textcolor); display: flex; flex-direction: column; gap: 1.15rem; font-size: .9rem; }
    header, .draft, .subjects, .output, .conversation, .result { display: flex; flex-direction: column; gap: .75rem; min-width: 0; }
    header { border-bottom: 1px solid var(--color-darkborderc); padding-bottom: .85rem; }
    .title-row, .section-title { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: .5rem; }
    h2 { font-size: 1.15rem; font-weight: 700; }
    h3 { font-size: .95rem; font-weight: 600; display: flex; align-items: center; gap: .5rem; }
    nav, .actions { display: flex; flex-wrap: wrap; align-items: center; gap: .5rem; }
    .step { background: var(--color-selected); border-radius: 50%; width: 1.5rem; height: 1.5rem; display: inline-flex; align-items: center; justify-content: center; font-size: .8rem; }
    .hint, .empty { color: var(--color-textcolor2); line-height: 1.55; font-size: .8rem; }
    .empty { padding: .5rem 0; font-size: .85rem; }
    .card { border: 1px solid var(--color-darkborderc); border-radius: .65rem; background: var(--color-darkbg); padding: .85rem; min-width: 0; }
    .scene .section-title { margin-bottom: .7rem; }
    fieldset { display: flex; flex-direction: column; gap: .7rem; padding: 0; border: 0; margin: 0; min-width: 0; }
    fieldset:disabled { opacity: .65; }
    label { display: flex; flex-direction: column; gap: .4rem; min-width: 0; font-size: .85rem; }
    .scene-options { display: flex; flex-wrap: wrap; align-items: center; gap: .6rem 1rem; }
    .scene-options label { flex-direction: row; align-items: center; gap: .6rem; white-space: nowrap; }
    .scene-options select { min-height: 2.75rem; min-width: 0; padding: .4rem .65rem; border: 1px solid var(--color-darkborderc); border-radius: .4rem; background: var(--color-bgcolor); color: var(--color-textcolor); font: inherit; }
    .scene-options select:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 2px; }
    .image-preset { display: flex; flex: 1; min-width: min(100%, 16rem); align-items: center; gap: .5rem; }
    .image-preset label { flex: 1; }
    .image-preset select { flex: 1; width: 0; }
    .image-preset button { flex-shrink: 0; }
    summary { cursor: pointer; min-height: 2.75rem; padding: .65rem 0; color: var(--color-textcolor2); }
    details { border-top: 1px solid var(--color-darkborderc); }
    .card > summary { padding-top: 0; color: var(--color-textcolor); font-weight: 600; }
    .card:not([open]) > summary { padding-bottom: 0; min-height: 1.5rem; }
    .fragments { display: flex; flex-direction: column; gap: .6rem; border-top: 1px solid var(--color-darkborderc); padding-top: .7rem; }
    .section-help { border: 0; padding: 0; min-height: 2.75rem; font: inherit; cursor: help; }
    .section-help:hover:not(:disabled) { background: transparent; }
    .fragment { display: flex; align-items: flex-start; gap: .5rem; border: 1px solid var(--color-darkborderc); border-radius: .4rem; padding: .35rem .5rem; }
    .fragment-content { flex: 1; min-width: 0; border: 0; }
    .fragment-content > summary { color: var(--color-textcolor); overflow-wrap: anywhere; }
    .fragment-content[open] { padding-bottom: .25rem; }
    .remove-fragment { display: grid; place-items: center; flex-shrink: 0; min-width: 2.75rem; }
    button { min-height: 2.75rem; border: 1px solid var(--color-darkborderc); border-radius: .4rem; padding: .5rem .75rem; font-size: .85rem; overflow-wrap: anywhere; }
    button:hover:not(:disabled) { background: var(--color-darkbutton); }
    button:disabled { opacity: .5; cursor: not-allowed; }
    .primary { background: var(--color-primary); color: var(--color-accenttext); border-color: var(--color-primary); font-weight: 600; }
    .primary:hover:not(:disabled) { background: var(--color-primary); filter: brightness(1.08); }
    button:focus-visible, summary:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 2px; }
    .quiet { align-self: flex-start; }
    blockquote { max-height: 9rem; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; border-left: 3px solid var(--color-primary); padding-left: .75rem; margin-bottom: .7rem; line-height: 1.6; }
    .conversation-log { max-height: 13rem; overflow: auto; display: flex; flex-direction: column; gap: .55rem; }
    .conversation-log p { white-space: pre-wrap; overflow-wrap: anywhere; padding: .6rem; border-radius: .4rem; background: var(--color-bgcolor); line-height: 1.55; }
    .conversation-log p.user { border-left: 2px solid var(--color-primary); }
    .conversation-log .hint { display: block; margin-bottom: .2rem; }
    .feedback { padding: .7rem; border: 1px solid var(--color-darkborderc); border-radius: .4rem; overflow-wrap: anywhere; }
    .error { border-color: var(--color-danger); }
    .output { border-top: 1px solid var(--color-darkborderc); padding-top: 1rem; }
    .generation-actions { justify-content: flex-start; }
    .image-button { padding: 0; overflow: hidden; align-self: center; width: 100%; max-width: 32rem; background: var(--color-bgcolor); }
    img { width: 100%; height: auto; max-height: 36rem; object-fit: contain; display: block; }
    .insertion button { flex: 1; }
    pre { white-space: pre-wrap; overflow-wrap: anywhere; font-family: inherit; line-height: 1.5; font-size: .8rem; max-height: 12rem; overflow: auto; margin: .5rem 0; }
</style>
