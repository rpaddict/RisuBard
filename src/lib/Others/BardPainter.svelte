<script lang="ts">
    import { ArrowDownToLine, ArrowUpToLine, Box, ChevronDown, ChevronRight, ChevronUp, Copy, Crosshair, Eraser, History as HistoryIcon, ImagePlus, Images, LoaderCircle, Palette, Puzzle, RefreshCw, RotateCcw, ScanFace, SlidersHorizontal, Sparkles, TextSelect, Trash2, Undo2, UserPlus, Users, X } from '@lucide/svelte'
    import { tooltip } from 'src/ts/gui/tooltip'
    import { Buffer } from 'buffer'
    import { untrack } from 'svelte'
    import { getPainterSession } from 'src/ts/bardPainter/runtime.svelte'
    import { formatPainterPromptText } from 'src/ts/bardPainter/prompt'
    import { painterImageSize, painterImageSizeById, painterSizeMode, painterSubjectLimit } from 'src/ts/bardPainter/types'
    import { painterSelection, painterInsertionRequest } from 'src/ts/bardPainter/selectionState'
    import { painterGalleryRequested } from 'src/ts/bardPainter/gallery'
    import { botMakerMode, CharConfigSubMenu, risuBardGalleryOpen, MobileSideBar } from 'src/ts/stores.svelte'
    import BardPainterPromptInput from './BardPainterPromptInput.svelte'
    import BardPainterSubject from './BardPainterSubject.svelte'
    import BardPainterContext from './BardPainterContext.svelte'
    import BardPainterIconButton from './BardPainterIconButton.svelte'
    import BardPainterTools from './BardPainterTools.svelte'
    import BardPainterImagePreset from './BardPainterImagePreset.svelte'
    import BardPainterAnalyzer from './BardPainterAnalyzer.svelte'

    let { characterId, chatId, visible = true }: { characterId: string; chatId: string; visible?: boolean } = $props()
    let session = $state(untrack(() => getPainterSession(characterId, chatId)))
    $effect(() => { const bot = characterId; const chat = chatId; session = untrack(() => getPainterSession(bot, chat)) })
    $effect(() => { const current = session; untrack(() => void current.autoPruneBlankIdentities()) })
    $effect(() => { const current = session; untrack(() => void current.refreshLorePresets().catch(() => {})) })
    let data = $derived(session.data)
    let selection = $derived($painterSelection?.characterId === characterId && $painterSelection.chatId === chatId ? $painterSelection : null)
    let scene = $derived(data.anchor ?? selection?.anchor)
    // The fixed scene's text may be edited, so a new selection is judged by where it is, not by its text.
    const spot = (anchor?: { messageId: string; start: number; end: number }) => anchor ? `${anchor.messageId}:${anchor.start}:${anchor.end}` : ''
    let pendingScene = $derived(!!selection?.anchor && spot(selection.anchor) !== spot(data.anchor))
    let planned = $derived(!!data.draft?.scene.trim())
    let subjects = $derived(data.draft?.subjects ?? [])
    let subjectLimit = $derived(painterSubjectLimit(session.settings.model))
    let latest = $derived(data.results.reduce<typeof data.results[number] | undefined>((result, item) => !result || item.createdAt > result.createdAt ? item : result, undefined))
    let insertionTarget = $derived(selection?.issue ? undefined : selection?.anchor ?? data.anchor ?? latest?.anchor)
    let aiSize = $derived(painterSizeMode(session.settings) === 'ai')
    let chosenSize = $derived(aiSize ? painterImageSizeById(data.draft?.size) : undefined)
    let canvas = $derived(painterImageSize(session.settings, data.draft))
    let sizeName = $derived(aiSize ? (chosenSize ? `AI 결정 ${canvas.width}×${canvas.height}` : 'AI 결정') : `${canvas.width}×${canvas.height}`)
    let modelName = $derived(`${session.settings.model.includes('4-5') ? 'V4.5' : 'V5'} ${session.settings.model.includes('curated') ? 'Curated' : 'Full'}`)
    let resultSection = $state<HTMLElement | null>(null)
    let busy = $derived(session.state.status !== 'idle')
    let blocked = $derived(busy || session.state.pendingImage)
    let streaming = $derived(!!session.chat.isStreaming)
    let presetChoices = $derived(session.identities.filter(item => !subjects.some(subject => subject.id === item.id)))
    let globalChoices = $derived(session.unreflectedGlobalIdentities)
    let toolMode = $state<'style' | 'characters' | 'settings' | 'fragments' | null>(null)
    let confirm = $state<'fresh' | 'clear' | 'reset' | 'discard' | null>(null)
    let copying = $state(false)
    let expanded = $state(false)
    let broken = $state(false)
    let historyOpen = $state(false)
    let analyzerOpen = $state(false)
    let sourcesOpen = $state(false)
    let sourcesSummary = $state('')
    let editingFragment = $state<string | null>(null)
    let status = $derived(session.state.status === 'prompt' ? '프롬프트를 작성하고 있습니다.' : session.state.status === 'image' ? 'NovelAI에서 이미지를 생성하고 있습니다.' : session.state.status === 'saving' ? '저장하고 있습니다.' : '')
    $effect(() => { characterId; chatId; toolMode = null; confirm = null; historyOpen = false; analyzerOpen = false })
    $effect(() => { latest?.assetId; expanded = false; broken = false })

    function save() { void session.persist() }
    async function resetWorkspace() {
        if (blocked || streaming) return
        const current = session
        if (await current.resetWorkspace() && current === session) { window.getSelection()?.removeAllRanges(); confirm = null; toolMode = null }
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
            replace: target => current.replaceInlay(result.id, target),
            error: () => current.state.error,
        })
    }
    async function useSelection() {
        if (!selection?.anchor || blocked || streaming) return
        await session.changeScene(selection.anchor)
    }
    function editSceneText(value: string) {
        // Plain text only: the planner reads this as the passage to illustrate.
        if (data.anchor) data.anchor.text = value.replace(/ /g, ' ')
    }
    async function prepare(fresh = false) {
        if (!scene || blocked) return
        confirm = null
        const current = session
        const instruction = data.settings.instruction
        const success = await current.prepare(scene, { instruction, fresh })
        if (success && current === session && data.settings.instruction === instruction) { data.settings.instruction = ''; save() }
    }
    async function generate() {
        const current = session
        await current.generate()
        // The new image appears above the prompt blocks, so bring it into view.
        if (current === session) resultSection?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' })
    }
    function moveSubject(index: number, direction: -1 | 1) {
        const list = data.draft?.subjects
        if (!list || index + direction < 0 || index + direction >= list.length) return
        const [subject] = list.splice(index, 1); list.splice(index + direction, 0, subject); save()
    }
    function addFromPreset(value: string) {
        const id = value.slice(value.indexOf(':') + 1)
        if (!id || blocked) return
        void session.addSubject(value.startsWith('global:') ? { globalId: id } : { identityId: id })
    }
    function editScene(value: string) {
        if (data.draft) data.draft.scene = value
        else if (value.trim()) data.draft = { rendering: '', scene: value, negative: '', subjects: [] }
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
    function keydown(event: KeyboardEvent) {
        if (!event.defaultPrevented && !event.isComposing && event.keyCode !== 229 && event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
            event.preventDefault(); event.stopImmediatePropagation(); void prepare()
        }
    }
</script>

{#if visible}
<section class="painter" aria-label="바드페인터" data-bard-painter>
    <div class="scroll">
        <header>
            <h2>바드페인터</h2>
            <span class="spacer"></span>
            <div class="header-actions">
                <BardPainterIconButton label="캐릭터 분석기" text="캐릭터 분석" disabled={blocked} onclick={() => analyzerOpen = true}><ScanFace size={15} /></BardPainterIconButton>
                <BardPainterIconButton label="갤러리 열기" text="갤러리" onclick={openGallery}><Images size={15} /></BardPainterIconButton>
                <BardPainterIconButton label="작업 리셋" text="초기화" disabled={blocked || streaming} expanded={confirm === 'reset'} onclick={() => confirm = confirm === 'reset' ? null : 'reset'}><RotateCcw size={15} /></BardPainterIconButton>
            </div>
        </header>
        {#if confirm === 'reset'}
            <div class="confirm" role="alert"><p>장면, 초안, 프롬프트 대화와 참고 삽화를 비웁니다. 생성 설정, 프리셋과 갤러리 이미지, 본문에 넣은 그림은 그대로입니다.</p><div class="row"><button type="button" class="danger" disabled={blocked || streaming} onclick={() => void resetWorkspace()}>리셋</button><button type="button" onclick={() => confirm = null}>취소</button></div></div>
        {/if}

        <section class="frame" aria-label="그림 틀">
            <nav class="tiles" aria-label="바드페인터 도구">
                <button type="button" class="tile" aria-label="화풍 프리셋" onclick={() => toolMode = 'style'}>
                    <span class="tile-label"><Palette size={14} aria-hidden="true" />화풍</span>
                    <span class="tile-value">{session.style.name}</span>
                    <ChevronRight size={15} class="tile-go" aria-hidden="true" />
                </button>
                <button type="button" class="tile" aria-label="캐릭터 프리셋" onclick={() => toolMode = 'characters'}>
                    <span class="tile-label"><Users size={14} aria-hidden="true" />캐릭터 프리셋</span>
                    <span class="tile-value">{session.identities.length ? `${session.identities.length}명` : '없음'}</span>
                    <ChevronRight size={15} class="tile-go" aria-hidden="true" />
                </button>
                <button type="button" class="tile" aria-label="생성 설정" onclick={() => toolMode = 'settings'}>
                    <span class="tile-label"><SlidersHorizontal size={14} aria-hidden="true" />생성 설정</span>
                    <span class="tile-value">{modelName} <span class="dim">/</span> {sizeName}</span>
                    <ChevronRight size={15} class="tile-go" aria-hidden="true" />
                </button>
            </nav>
            <span class="sr-only" aria-label="현재 화풍과 이미지 형식">{session.style.name} / {sizeName} / {modelName}</span>
            <BardPainterImagePreset {session} disabled={blocked} />
        </section>
        <BardPainterTools {session} mode={toolMode} onClose={() => toolMode = null} disabled={blocked} />
        <BardPainterAnalyzer {session} bind:open={analyzerOpen} onOpenGallery={() => { analyzerOpen = false; openGallery() }} />

        <section class="block" aria-label="그릴 장면">
            <div class="heading"><h3>장면</h3></div>
            {#if scene}
                {#if data.anchor}
                    <textarea class="scene-text" aria-label="장면 글" rows="4" spellcheck="false" disabled={blocked} value={data.anchor.text} oninput={event => editSceneText(event.currentTarget.value)} onblur={save}></textarea>
                {:else}<blockquote class="pending">{scene.text}</blockquote>{/if}
                {#if !data.anchor}<p class="hint">아직 정하지 않은 선택입니다. 프롬프트를 작성하면 이 부분을 그립니다.</p>
                {:else if pendingScene}<p class="hint">본문에서 다른 부분을 선택했습니다. 아래 버튼을 누르면 장면을 바꿉니다.</p>{/if}
            {:else}<p class="empty">본문에서 그리고 싶은 부분을 드래그해 선택하세요.</p>{/if}
            {#if selection?.issue && !scene}<p class="hint">{selection.issue}</p>{/if}
            <button type="button" class="scene-pick" class:ready={pendingScene} aria-label={data.anchor ? '본문에서 새로 선택한 부분으로 장면 바꾸기' : '본문에서 선택한 부분을 장면으로 정하기'} disabled={!pendingScene || blocked || streaming} onclick={() => void useSelection()}>
                <TextSelect size={17} aria-hidden="true" /><span class="scene-pick-text"><span>{data.anchor ? '선택한 부분으로 바꾸기' : '선택한 부분을 장면으로'}</span>{#if !pendingScene}<small>본문에서 드래그해 고르세요</small>{/if}</span>
            </button>
            <div class="toolbar">
                <span class="bar-label">시점</span>
                <div class="perspective" role="group" aria-label="그림 시점" use:tooltip={'다음 프롬프트 작성부터 적용합니다. 1인칭은 사용자 캐릭터를 그리지 않습니다.'}>
                    {#each [['first-person', '1인칭'], ['third-person', '3인칭']] as [value, text] (value)}
                        <button type="button" aria-pressed={(data.settings.perspective ?? 'third-person') === value} disabled={blocked} onclick={() => { data.settings.perspective = value as 'first-person' | 'third-person'; save() }}>{text}</button>
                    {/each}
                </div>
            </div>
        </section>

        {#if session.state.pendingImage}
            <section class="block recovery" aria-label="생성 이미지 복구">
                <p>이미지는 생성됐지만 저장을 마치지 못했습니다. 다시 생성하지 않고 저장만 다시 시도합니다.</p>
                <div class="row"><button type="button" disabled={busy} onclick={() => session.retrySave()}>저장 다시 시도</button><button type="button" disabled={busy} onclick={() => session.downloadOriginal()}>원본 다운로드</button><button type="button" disabled={busy} onclick={() => confirm = 'discard'}>대기 해제</button></div>
                {#if confirm === 'discard'}<div class="confirm" role="alert"><p>먼저 원본을 다운로드하세요. 이미 저장된 파일은 갤러리에 남습니다.</p><div class="row"><button type="button" class="danger" disabled={busy} onclick={() => { confirm = null; void session.discardPending() }}>대기 해제</button><button type="button" onclick={() => confirm = null}>취소</button></div></div>{/if}
            </section>
        {/if}

        {#if latest}
            <section class="block" aria-label="현재 삽화" bind:this={resultSection}>
                <div class="heading"><h3>삽화</h3><span class="count">{latest.style.name} / 시드 {latest.seed}</span></div>
                <figure data-painter-result={latest.id}>
                    {#if broken}<p class="empty">이미지를 불러오지 못했습니다. <button type="button" class="link" onclick={() => broken = false}>다시 불러오기</button></p>
                    {:else}<button type="button" class="image-button" aria-label={expanded ? '이미지 축소' : '이미지 크게 보기'} onclick={() => expanded = !expanded}><img src={assetUrl(latest.assetId, expanded)} alt="최근 생성한 삽화" width={latest.settings.width} height={latest.settings.height} loading="lazy" decoding="async" onerror={imageError} /></button>{/if}
                    {#if insertionTarget || latest.inserted}<figcaption class="hint">{#if insertionTarget}{selection?.anchor ? (insertionTarget.insertionUnavailable ? '최근 선택한 메시지에 넣습니다' : '최근 선택한 위치에 넣습니다') : '장면 위치에 넣습니다'}{/if}{#if latest.inserted}{insertionTarget ? ' / ' : ''}본문에 넣음{/if}</figcaption>{/if}
                </figure>
                <div class="toolbar">
                    <BardPainterIconButton label="원문 위에 삽입" text="위에 넣기" disabled={busy || latest.compressionPending || !insertionTarget} onclick={() => session.insert(latest!.id, 'before', insertionTarget)}><ArrowUpToLine size={15} /></BardPainterIconButton>
                    <BardPainterIconButton label="원문 아래에 삽입" text="아래에 넣기" disabled={busy || latest.compressionPending || !insertionTarget} onclick={() => session.insert(latest!.id, 'after', insertionTarget)}><ArrowDownToLine size={15} /></BardPainterIconButton>
                    <BardPainterIconButton label="본문에서 삽입 위치 지정" text="위치 지정" pressed={$painterInsertionRequest?.resultId === latest.id} disabled={busy || latest.compressionPending} onclick={specifyInsertion}><Crosshair size={15} /></BardPainterIconButton>
                    <span class="spacer"></span>
                    <BardPainterIconButton label="삽화 목록에서 빼기" tone="danger" disabled={busy || latest.compressionPending} onclick={() => session.removeResult(latest!.id)}><Trash2 size={15} /></BardPainterIconButton>
                </div>
            </section>
        {/if}

        <section class="block" aria-label="메인 프롬프트">
            <div class="heading">
                <h3>프롬프트</h3>
                <span class="spacer"></span>
                {#if data.previousDraft}<BardPainterIconButton label="이전 초안으로 되돌리기" text="되돌리기" disabled={blocked} onclick={() => session.restoreDraft()}><Undo2 size={14} /></BardPainterIconButton>{/if}
                <BardPainterIconButton label="표현 조각 관리" text="조각" onclick={() => toolMode = 'fragments'}><Puzzle size={14} /></BardPainterIconButton>
                <BardPainterIconButton label="프롬프트 원문 복사" text="복사" disabled={blocked || copying || !data.draft} onclick={() => void copyPrompt()}><Copy size={14} /></BardPainterIconButton>
            </div>
            <BardPainterPromptInput rows={3} spellcheck="false" disabled={blocked} placeholder="구도, 배경, 조명. 프롬프트를 작성하면 채워집니다." value={data.draft?.scene ?? ''} oninput={event => editScene(event.currentTarget.value)} onblur={save} aria-label="메인 프롬프트" />
            {#if data.draft?.fragments?.length}
                <ul class="fragments" aria-label="표현 조각">
                    {#each data.draft.fragments as fragment, index (fragment.id)}
                        <li class:editing={editingFragment === fragment.id}><button type="button" class="fragment-name" aria-expanded={editingFragment === fragment.id} use:tooltip={'이 초안에 넣은 문구를 고칩니다. 저장한 표현 조각은 바뀌지 않습니다.'} onclick={() => editingFragment = editingFragment === fragment.id ? null : fragment.id}>{fragment.name}</button><button type="button" aria-label={`표현 조각 ${fragment.name} 빼기`} disabled={blocked} onclick={() => { data.draft?.fragments?.splice(index, 1); save() }}><X size={13} /></button></li>
                    {/each}
                </ul>
                {#each data.draft.fragments.filter(item => item.id === editingFragment) as fragment (fragment.id)}
                    <BardPainterPromptInput rows={2} spellcheck="false" disabled={blocked} bind:value={fragment.prompt} onblur={save} aria-label={`표현 조각 ${fragment.name}`} />
                {/each}
            {/if}
            <details class="style">
                <summary><ChevronRight size={14} class="chevron" aria-hidden="true" />화풍과 제외 요소<span class="dim">화풍 프리셋에서 고칩니다</span></summary>
                <pre>{[session.style.artist, session.style.rendering, data.draft?.rendering].filter(Boolean).join('\n') || '설정된 화풍이 없습니다.'}</pre>
                <pre class="negative">{[session.style.negative, data.draft?.negative].filter(Boolean).join('\n') || '설정된 네거티브 프롬프트가 없습니다.'}</pre>
            </details>
        </section>

        <section class="block" aria-label="인물과 사물 블록">
            <div class="heading">
                <h3>인물과 사물</h3><span class="count">{subjects.length} / {subjectLimit}</span>
            </div>
            <div class="toolbar">
                <BardPainterIconButton label="빈 인물 블록 추가" text="인물" disabled={blocked || subjects.length >= subjectLimit} onclick={() => void session.addSubject({ kind: 'character' })}><UserPlus size={15} /></BardPainterIconButton>
                <BardPainterIconButton label="빈 사물 블록 추가" text="사물" disabled={blocked || subjects.length >= subjectLimit} onclick={() => void session.addSubject({ kind: 'object' })}><Box size={15} /></BardPainterIconButton>
                <select class="add-preset" aria-label="캐릭터 프리셋으로 블록 추가" value="" disabled={blocked || subjects.length >= subjectLimit || !(presetChoices.length || globalChoices.length)} onchange={event => { const value = event.currentTarget.value; event.currentTarget.value = ''; addFromPreset(value) }}>
                    <option value="">{presetChoices.length || globalChoices.length ? '프리셋으로 추가' : '추가할 프리셋 없음'}</option>
                    {#if presetChoices.length}<optgroup label="이 봇">{#each presetChoices as identity (identity.id)}<option value={`bot:${identity.id}`}>{identity.name}{identity.appearance.trim() ? '' : ' (외형 없음)'}</option>{/each}</optgroup>{/if}
                    {#if globalChoices.length}<optgroup label="글로벌 (고르면 이 봇에 반영)">{#each globalChoices as identity (identity.id)}<option value={`global:${identity.id}`}>{identity.name}</option>{/each}</optgroup>{/if}
                </select>
            </div>
            {#each subjects as subject, index (subject.id)}
                <BardPainterSubject {subject} {session} {index} total={subjects.length} disabled={blocked} onMove={direction => moveSubject(index, direction)} onRemove={() => { data.draft?.subjects.splice(index, 1); save() }} />
            {:else}
                <p class="empty">프롬프트를 작성하면 AI가 장면 속 인물을 블록으로 나눕니다. 꼭 들어가야 할 인물은 먼저 추가해 두면 AI가 그대로 살려 씁니다.</p>
            {/each}
            {#if globalChoices.length && !session.bot.identities.some(item => item.appearance.trim())}
                <p class="hint">글로벌 보관함의 캐릭터는 이 봇에 반영해야 AI가 알아보고 저장된 외형을 넣습니다. 위의 프리셋 목록에서 고르면 반영됩니다.</p>
            {/if}
        </section>

    </div>

    <footer class="composer" aria-label="프롬프트 대화">
        {#if historyOpen && data.conversation?.length}<div class="history" role="log" aria-label="프롬프트 대화 기록">{#each data.conversation.slice(-8) as message (message.id)}<p class:user={message.role === 'user'}>{message.text}</p>{/each}</div>{/if}
        {#if confirm === 'clear'}<div class="confirm" role="alert"><p>이 챗의 프롬프트 대화 기록을 비웁니다. 초안과 삽화는 그대로입니다.</p><div class="row"><button type="button" disabled={blocked} onclick={async () => { if (await session.clearConversation()) { confirm = null; historyOpen = false } }}>비우기</button><button type="button" onclick={() => confirm = null}>취소</button></div></div>{/if}
        <div class="sources" hidden={!sourcesOpen}><BardPainterContext {session} disabled={blocked} onOpenGallery={openGallery} embedded bind:summary={sourcesSummary} /></div>
        <BardPainterPromptInput aria-label="프롬프트 대화 입력" rows={2} maxlength={6000} placeholder={planned ? '어떻게 다듬을까요? 예: 인물을 더 가까이, 배경은 흐리게' : '원하는 구도나 분위기 (비워도 됩니다)'} bind:value={data.settings.instruction} onblur={save} disabled={blocked} onkeydown={keydown} />
        {#if confirm === 'fresh'}<div class="confirm" role="alert"><p>초안을 처음부터 다시 작성합니다. 직접 추가했거나 잠근 블록은 남기고, 실패하면 지금 초안을 유지합니다.</p><div class="row"><button type="button" disabled={blocked} onclick={() => void prepare(true)}>새로 작성</button><button type="button" onclick={() => confirm = null}>취소</button></div></div>{/if}
        <div class="actions">
            <button type="button" class="sources-toggle" aria-expanded={sourcesOpen} aria-label="AI 참고 자료" onclick={() => sourcesOpen = !sourcesOpen}>
                {#if sourcesOpen}<ChevronDown size={15} aria-hidden="true" />{:else}<ChevronUp size={15} aria-hidden="true" />{/if}<span>AI 참고 자료</span><small>{sourcesSummary}</small>
            </button>
            {#if data.conversation?.length}
                <BardPainterIconButton label={`대화 기록 ${data.conversation.length}개 ${historyOpen ? '닫기' : '보기'}`} text={`기록 ${data.conversation.length}`} expanded={historyOpen} onclick={() => historyOpen = !historyOpen}><HistoryIcon size={14} /></BardPainterIconButton>
                <BardPainterIconButton label="프롬프트 대화 비우기" disabled={blocked} expanded={confirm === 'clear'} onclick={() => confirm = confirm === 'clear' ? null : 'clear'}><Eraser size={14} /></BardPainterIconButton>
            {/if}
        </div>
        <div class="launch">
            {#if session.state.status === 'prompt'}
                <button type="button" class="square" aria-label="작성 중지" onclick={() => session.cancel()}><X size={18} aria-hidden="true" /><span>중지</span></button>
            {:else}
                <button type="button" class="square" aria-label={planned ? '초안 개선' : '프롬프트 작성'} disabled={blocked || !scene} use:tooltip={'장면과 참고 자료를 읽고 AI가 프롬프트 블록을 채웁니다. 위 입력란의 요청도 함께 보냅니다. Ctrl+Enter로도 보낼 수 있습니다.'} onclick={() => void prepare()}><Sparkles size={18} aria-hidden="true" /><span>{planned ? '초안 개선' : '초안 작성'}</span></button>
            {/if}
            <button type="button" class="square" aria-label="처음부터 새로 작성" aria-expanded={confirm === 'fresh'} disabled={blocked || !planned} use:tooltip={'초안을 처음부터 다시 작성합니다.'} onclick={() => confirm = confirm === 'fresh' ? null : 'fresh'}><RefreshCw size={18} aria-hidden="true" /><span>다시 쓰기</span></button>
            <button type="button" class="generate" aria-label="이미지 생성" disabled={blocked || !data.anchor || !data.draft?.scene.trim()} use:tooltip={'지금 프롬프트 블록 그대로 NovelAI에 보냅니다. 사용량이 차감될 수 있습니다.'} onclick={() => void generate()}>
                {#if session.state.status === 'image'}<LoaderCircle size={17} class="animate-spin" aria-hidden="true" />{:else}<ImagePlus size={17} aria-hidden="true" />{/if}<span>이미지 생성</span><small>{modelName} / {sizeName}</small>
            </button>
        </div>
        <div class="feedback" role="status" aria-live="polite">
            {#if status}<p><LoaderCircle size={14} class="animate-spin" aria-hidden="true" />{status}</p>
            {:else if session.state.notice}<p>{session.state.notice}</p>{/if}
        </div>
        {#if session.state.error}<p class="error" role="alert">{session.state.error}</p>{/if}
    </footer>
</section>
{/if}

<style>
    .painter { flex: 1; display: flex; flex-direction: column; min-width: 0; min-height: 0; color: var(--color-textcolor); font-size: .875rem; }
    .scroll { flex: 1; min-height: 0; overflow: auto; padding: .9rem clamp(.75rem, 3vw, 1.1rem) 1.25rem; display: flex; flex-direction: column; gap: 1.25rem; scrollbar-gutter: stable; }
    header { display: flex; flex-wrap: wrap; align-items: center; gap: .35rem; }
    .header-actions { display: flex; flex-wrap: wrap; gap: .35rem; }
    h2 { font-size: 1.05rem; font-weight: 700; line-height: 1.3; }
    .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
    .frame { display: flex; flex-direction: column; gap: .55rem; min-width: 0; margin-top: -.35rem; container-type: inline-size; }
    .tiles { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: .4rem; }
    @container (max-width: 30rem) { .tiles { grid-template-columns: repeat(2, minmax(0, 1fr)); } .tile:last-child { grid-column: 1 / -1; } }
    .tile { position: relative; display: flex; flex-direction: column; align-items: flex-start; gap: .2rem; min-width: 0; padding: .5rem 1.7rem .55rem .7rem; border: 1px solid var(--color-darkborderc); border-radius: calc(var(--risu-radius-lg) * 1.1); background: var(--color-darkbg); color: var(--color-textcolor); text-align: left; transition: border-color .15s ease-out, background-color .15s ease-out; }
    .tile:hover { border-color: color-mix(in srgb, var(--color-primary) 60%, var(--color-darkborderc)); background: color-mix(in srgb, var(--color-primary) 6%, var(--color-darkbg)); }
    .tile:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 2px; }
    .tile-label { display: inline-flex; align-items: center; gap: .3rem; color: var(--color-textcolor2); font-size: .72rem; }
    .tile-value { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: .84rem; font-weight: 600; font-variant-numeric: tabular-nums; }
    .tile :global(.tile-go) { position: absolute; right: .45rem; top: 50%; translate: 0 -50%; color: var(--color-textcolor2); }
    .dim { color: var(--color-textcolor2); font-weight: 400; }
    .toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: .35rem; min-width: 0; }
    .bar-label { color: var(--color-textcolor2); font-size: .75rem; }
    /* The scene pick starts every illustration, so it carries the same weight as image generation. */
    .scene-pick { display: flex; align-items: center; justify-content: center; gap: .5rem; width: 100%; min-height: 2.9rem; padding: 0 1rem; border: 1px dashed color-mix(in srgb, var(--color-primary) 55%, var(--color-darkborderc)); border-radius: calc(var(--risu-radius-lg) * 1.1); background: color-mix(in srgb, var(--color-primary) 7%, transparent); color: var(--color-textcolor); font-size: .95rem; font-weight: 700; transition: filter .15s ease-out, transform .15s cubic-bezier(.16, 1, .3, 1), background-color .15s ease-out; }
    .scene-pick-text { display: flex; flex-direction: column; align-items: flex-start; line-height: 1.3; }
    .scene-pick-text > span { white-space: nowrap; }
    .scene-pick small { font-size: .72rem; font-weight: 500; color: var(--color-textcolor2); }
    .scene-pick.ready { border: 1px solid var(--color-primary); background: var(--color-primary); color: var(--color-accenttext); box-shadow: 0 3px 10px -4px color-mix(in srgb, var(--color-primary) 70%, transparent); }
    .scene-pick.ready:hover:not(:disabled) { filter: brightness(1.08); }
    .scene-pick.ready:active:not(:disabled) { transform: translateY(1px); }
    .scene-pick:disabled { cursor: not-allowed; }
    .scene-pick:disabled:not(.ready) { opacity: .8; }
    .scene-pick:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 2px; }
    .block { display: flex; flex-direction: column; gap: .6rem; min-width: 0; }
    .block + .block { padding-top: 1.1rem; border-top: 1px solid var(--color-darkborderc); }
    .heading { display: flex; align-items: center; gap: .3rem; min-height: 2rem; min-width: 0; }
    h3 { font-size: .85rem; font-weight: 600; white-space: nowrap; }
    .count { color: var(--color-textcolor2); font-size: .75rem; font-variant-numeric: tabular-nums; margin-left: .2rem; white-space: nowrap; }
    .spacer { flex: 1; }
    .perspective { display: inline-flex; padding: .15rem; border-radius: 999px; background: var(--color-darkbg); border: 1px solid var(--color-darkborderc); }
    .perspective button { min-height: 1.6rem; padding: 0 .6rem; border: 0; border-radius: 999px; background: transparent; color: var(--color-textcolor2); font-size: .75rem; }
    .perspective button[aria-pressed='true'] { background: color-mix(in srgb, var(--color-primary) 22%, transparent); color: var(--color-textcolor); font-weight: 600; }
    .perspective button:hover:not(:disabled):not([aria-pressed='true']) { color: var(--color-textcolor); }
    .perspective button:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 1px; }
    blockquote { max-height: 8.5rem; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; padding: .55rem .75rem; border-radius: var(--risu-radius-lg); background: var(--color-darkbg); line-height: 1.6; font-size: .84rem; }
    blockquote.pending { opacity: .75; border: 1px dashed var(--color-darkborderc); background: transparent; }
    .scene-text { width: 100%; min-height: 5.5rem; max-height: 16rem; padding: .55rem .75rem; border: 1px solid var(--color-darkborderc); border-radius: var(--risu-radius-lg); background: var(--color-darkbg); color: var(--color-textcolor); font: inherit; font-size: .84rem; line-height: 1.6; resize: vertical; field-sizing: content; }
    .scene-text:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 1px; }
    .hint, .empty { color: var(--color-textcolor2); font-size: .78rem; line-height: 1.55; overflow-wrap: anywhere; }
    .empty { font-size: .8rem; }
    .add-preset { width: auto; max-width: 9.5rem; min-height: 2rem; margin-left: .2rem; padding: .15rem 1.6rem .15rem .5rem; border: 1px solid var(--color-darkborderc); border-radius: calc(var(--risu-radius-lg) * 0.8); background-color: var(--color-bgcolor); color: var(--color-textcolor); font: inherit; font-size: .75rem; }
    .add-preset:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 2px; }
    .add-preset:disabled { opacity: .5; }
    .fragments { display: flex; flex-wrap: wrap; gap: .3rem; padding: 0; margin: 0; list-style: none; }
    .fragments li { display: inline-flex; align-items: center; gap: .15rem; padding: 0 .1rem 0 .6rem; border-radius: 999px; background: var(--color-darkbg); border: 1px solid var(--color-darkborderc); font-size: .75rem; }
    .fragments li.editing { border-color: color-mix(in srgb, var(--color-primary) 55%, var(--color-darkborderc)); }
    .fragments .fragment-name { display: inline; width: auto; height: auto; min-height: 1.6rem; padding: 0 .2rem 0 0; border-radius: 0; background: transparent; color: var(--color-textcolor); font-size: .75rem; }
    .fragments .fragment-name:hover { background: transparent; text-decoration: underline; text-underline-offset: 3px; }
    .fragments button { display: inline-grid; place-items: center; width: 1.6rem; height: 1.6rem; border: 0; border-radius: 999px; background: transparent; color: var(--color-textcolor2); }
    .fragments button:hover:not(:disabled) { color: var(--color-textcolor); background: var(--color-darkbutton); }
    .style summary { cursor: pointer; color: var(--color-textcolor2); font-size: .78rem; min-height: 1.75rem; display: flex; align-items: center; gap: .35rem; list-style: none; }
    .style summary::-webkit-details-marker { display: none; }
    .style summary .dim { margin-left: auto; font-size: .72rem; }
    .style :global(.chevron) { transition: transform .18s cubic-bezier(.16, 1, .3, 1); }
    .style[open] :global(.chevron) { transform: rotate(90deg); }
    .style summary:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 2px; }
    pre { margin: .35rem 0 0; padding: .5rem .6rem; border-radius: calc(var(--risu-radius-lg) * 0.8); background: var(--color-darkbg); white-space: pre-wrap; overflow-wrap: anywhere; font-family: inherit; font-size: .76rem; line-height: 1.5; max-height: 10rem; overflow: auto; }
    pre.negative { color: var(--color-textcolor2); }
    figure { display: flex; flex-direction: column; gap: .4rem; margin: 0; }
    .image-button { padding: 0; border: 0; border-radius: var(--risu-radius-lg); overflow: hidden; align-self: center; width: 100%; max-width: 32rem; background: var(--color-darkbg); }
    .image-button:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 2px; }
    img { width: 100%; height: auto; max-height: 36rem; object-fit: contain; display: block; }
    .recovery p { font-size: .8rem; line-height: 1.55; }
    .confirm { display: flex; flex-direction: column; gap: .45rem; padding: .6rem .7rem; border-radius: var(--risu-radius-lg); background: var(--color-darkbg); border: 1px solid var(--color-darkborderc); font-size: .8rem; line-height: 1.55; }
    .row, .actions { display: flex; flex-wrap: wrap; align-items: center; gap: .3rem; }
    /* Icon buttons live in a child component, so these rules reach only the text buttons here. */
    .row button, .actions button { display: inline-flex; align-items: center; justify-content: center; gap: .35rem; min-height: 2.1rem; padding: 0 .8rem; border: 1px solid var(--color-darkborderc); border-radius: calc(var(--risu-radius-lg) * 0.9); background: transparent; color: var(--color-textcolor); font-size: .8rem; white-space: nowrap; transition: background-color .15s ease-out, filter .15s ease-out; }
    .row button:hover:not(:disabled), .actions button:hover:not(:disabled) { background: var(--color-darkbutton); }
    button:disabled { opacity: .45; cursor: not-allowed; }
    button:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 2px; }
    .launch { display: flex; gap: .4rem; min-width: 0; }
    .launch .generate { flex: 1; min-width: 0; }
    /* Same weight as image generation in gray, so the three launch actions read as one row. */
    .square { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: .2rem; flex-shrink: 0; width: 3.6rem; height: 3.6rem; padding: 0; border: 1px solid var(--color-darkborderc); border-radius: calc(var(--risu-radius-lg) * 1.1); background: var(--color-darkbutton); color: var(--color-textcolor); font-size: .7rem; font-weight: 700; line-height: 1.15; transition: filter .15s ease-out, transform .15s cubic-bezier(.16, 1, .3, 1); }
    .square:hover:not(:disabled) { filter: brightness(1.15); }
    .square:active:not(:disabled) { transform: translateY(1px); }
    .square[aria-expanded='true'] { border-color: var(--color-primary); }
    .square:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 2px; }
    .actions .sources-toggle { display: inline-flex; align-items: center; gap: .4rem; flex: 1; min-width: 0; min-height: 2.1rem; padding: 0 .6rem; border: 1px solid var(--color-darkborderc); border-radius: calc(var(--risu-radius-lg) * 0.9); background: transparent; color: var(--color-textcolor); font-size: .8rem; font-weight: 600; }
    .actions .sources-toggle small { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: left; color: var(--color-textcolor2); font-weight: 400; font-size: .74rem; }
    .actions .sources-toggle:hover { background: var(--color-darkbutton); }
    .actions .sources-toggle:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 2px; }
    .sources { max-height: 15rem; overflow: auto; padding: .55rem .65rem; border: 1px solid var(--color-darkborderc); border-radius: var(--risu-radius-lg); background: var(--color-darkbg); }
    .sources[hidden] { display: none; }
    .generate { display: flex; align-items: center; justify-content: center; gap: .5rem; width: 100%; min-height: 3.6rem; padding: 0 1rem; border: 0; border-radius: calc(var(--risu-radius-lg) * 1.1); background: var(--color-primary); color: var(--color-accenttext); font-size: .95rem; font-weight: 700; box-shadow: 0 3px 10px -4px color-mix(in srgb, var(--color-primary) 70%, transparent); transition: filter .15s ease-out, transform .15s cubic-bezier(.16, 1, .3, 1); }
    .generate small { font-size: .72rem; font-weight: 500; opacity: .8; font-variant-numeric: tabular-nums; }
    .generate:hover:not(:disabled) { filter: brightness(1.08); }
    .generate:active:not(:disabled) { transform: translateY(1px); }
    .generate:disabled { box-shadow: none; }
    .row .danger { color: var(--color-danger); }
    .link { border: 0; padding: .2rem 0; background: transparent; color: var(--color-textcolor2); font-size: .78rem; text-decoration: underline; text-underline-offset: 3px; }
    .link:hover { color: var(--color-textcolor); }
    .composer { flex-shrink: 0; display: flex; flex-direction: column; gap: .45rem; padding: .6rem clamp(.75rem, 3vw, 1.1rem) .65rem; border-top: 1px solid var(--color-darkborderc); background: var(--color-bgcolor); box-shadow: var(--risu-shadow-floating, 0 -6px 16px -12px color-mix(in srgb, var(--color-shadow) 45%, transparent)); }
    .composer :global(textarea) { min-height: 2.75rem; max-height: 9rem; }
    .history { display: flex; flex-direction: column; gap: .35rem; max-height: 10rem; overflow: auto; }
    .history p { padding: .4rem .6rem; border-radius: calc(var(--risu-radius-lg) * 0.9); background: var(--color-darkbg); font-size: .78rem; line-height: 1.5; white-space: pre-wrap; overflow-wrap: anywhere; color: var(--color-textcolor2); }
    .history p.user { color: var(--color-textcolor); background: color-mix(in srgb, var(--color-primary) 10%, var(--color-darkbg)); }
    .feedback:empty { display: none; }
    .feedback p { display: flex; align-items: center; gap: .4rem; color: var(--color-textcolor2); font-size: .78rem; line-height: 1.5; overflow-wrap: anywhere; }
    .error { padding: .45rem .6rem; border-radius: calc(var(--risu-radius-lg) * 0.8); border: 1px solid var(--color-danger); color: var(--color-textcolor); font-size: .78rem; line-height: 1.5; overflow-wrap: anywhere; }
    @media (pointer: coarse) { .row button, .actions button, .add-preset, .perspective button { min-height: 2.75rem; } .generate, .scene-pick { min-height: 3.25rem; } }
    @media (max-width: 360px) { .generate small { display: none; } }
</style>
