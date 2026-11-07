<script lang="ts">
    import { ParseMarkdown } from 'src/ts/parser/parser.svelte'
    import { ColorSchemeTypeStore } from 'src/ts/gui/colorscheme'
    import { DBState } from 'src/ts/stores.svelte'
    import { ChevronLeftIcon, ChevronRightIcon, CircleQuestionMarkIcon, LocateFixedIcon, Trash2Icon } from '@lucide/svelte'
    import ShDialog from 'src/lib/UI/GUI/ShDialog.svelte'
    import type { Message } from 'src/ts/storage/database.svelte'
    import { OOC_TURN_MARKER, buildOocGroups } from 'src/ts/risubard/oocTurns'
    import { alertConfirmMulti, type AlertAction } from 'src/ts/alert'
    import { language } from 'src/lang'

    let { messages, hideOoc = false, onHideChange, onNavigate, onDelete }: {
        messages: Message[]
        hideOoc?: boolean
        onHideChange: (value: boolean) => void
        onNavigate?: (index: number) => void
        /** 원본 채팅에서 해당 인덱스의 메시지를 지운다. 지웠으면 true. */
        onDelete?: (indices: number[]) => Promise<boolean>
    } = $props()
    let deleting = $state(false)
    let query = $state('')
    let selectedGroupId = $state('')
    let helpOpen = $state(false)
    let fontSize = $state(DBState.db.risuBardOocFontSize ?? 14)
    let markdownEnabled = $state(DBState.db.risuBardOocMarkdown !== false)
    let scroller = $state<HTMLElement | null>(null)
    let groups = $derived(buildOocGroups(messages))
    let matchingGroups = $derived(groups.map(group => ({ ...group, entries: group.entries.filter(({ message }) =>
        !query.trim() || message.data.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())) }))
        .filter(group => group.entries.length > 0))
    let selectedGroup = $derived(matchingGroups.find(group => group.id === selectedGroupId) ?? matchingGroups[0])
    let groupIndex = $derived(matchingGroups.findIndex(group => group.id === selectedGroup?.id))

    function selectGroup(id: string) {
        selectedGroupId = id
        if (scroller) scroller.scrollTop = 0
    }

    function navigate(index: number) {
        onHideChange(false)
        onNavigate?.(index)
    }

    /** 사용자 입력이면 그 뒤에 이어진 AI 응답(다음 사용자 입력 전까지)이 연결된 응답이다. */
    function linkedReplies(index: number): number[] {
        const entries = groups.find(group => group.id === selectedGroup?.id)?.entries ?? []
        const start = entries.findIndex(entry => entry.index === index)
        const replies: number[] = []
        for (const entry of entries.slice(start + 1)) {
            if (entry.message.role === 'user') break
            replies.push(entry.index)
        }
        return replies
    }

    async function remove(index: number) {
        if (!onDelete || deleting) return
        let indices = [index]
        if (messages[index]?.role === 'user') {
            const replies = linkedReplies(index)
            if (replies.length > 0) {
                const actions: AlertAction[] = [
                    { label: `사용자 입력과 연결된 AI 응답 ${replies.length}개 함께 삭제`, variant: 'destructive' },
                    { label: '사용자 입력만 삭제', variant: 'destructive' },
                ]
                const choice = await alertConfirmMulti(language.bardWikiDeleteWarning, actions)
                if (choice < 0) return
                if (choice === 0) indices = [index, ...replies]
            } else {
                const choice = await alertConfirmMulti(language.bardWikiDeleteWarning, [{ label: '사용자 입력 삭제', variant: 'destructive' }])
                if (choice < 0) return
            }
        } else {
            const choice = await alertConfirmMulti(language.bardWikiDeleteWarning, [{ label: 'AI 응답 삭제', variant: 'destructive' }])
            if (choice < 0) return
        }
        deleting = true
        try { await onDelete(indices) } finally { deleting = false }
    }

    function setFontSize(event: Event) {
        const input = event.currentTarget as HTMLInputElement
        const value = input.valueAsNumber
        if (!Number.isFinite(value)) return
        fontSize = Math.min(48, Math.max(8, value))
        input.value = String(fontSize)
        DBState.db.risuBardOocFontSize = fontSize
    }
</script>

<section class="ooc-notepad" data-ooc-notepad aria-label="OOC 메모장" bind:this={scroller}>
    <header class="notepad-header">
        <div class="heading">
            <div class="title"><h2>OOC 메모장</h2>
                <button type="button" class="icon-button" data-ooc-help aria-label="OOC 메모장 도움말" title="OOC 메모장 도움말" onclick={() => helpOpen = true}><CircleQuestionMarkIcon size={16} /></button>
            </div>
            <div class="display-options">
                <label><input type="checkbox" data-ooc-hide checked={hideOoc}
                    onchange={(event) => onHideChange(event.currentTarget.checked)} />{language.risuBardHideOocTurns}</label>
                <label title="메모장 글자 크기"><input class="font-size" type="number" min="8" max="48" step="1" aria-label="메모장 글자 크기" value={fontSize} onchange={setFontSize} />px</label>
                <label title="마크다운 서식"><input type="checkbox" data-ooc-md checked={markdownEnabled}
                    onchange={(event) => { markdownEnabled = event.currentTarget.checked; DBState.db.risuBardOocMarkdown = markdownEnabled }} />MD</label>
            </div>
        </div>
        <div class="search-row">
            <select data-ooc-group aria-label="OOC 그룹" value={selectedGroup?.id ?? ''} disabled={!matchingGroups.length}
                onchange={(event) => selectGroup(event.currentTarget.value)}>
                {#each matchingGroups as group (group.id)}<option value={group.id}>{group.startTurn === undefined ? group.label : `턴 ${group.label}`}</option>{/each}
                {#if !matchingGroups.length}<option value="">OOC 없음</option>{/if}
            </select>
            <button type="button" class="icon-button" data-ooc-group-previous aria-label="이전 OOC 그룹" title="이전 OOC 그룹" disabled={groupIndex <= 0}
                onclick={() => selectGroup(matchingGroups[groupIndex - 1].id)}><ChevronLeftIcon size={18} /></button>
            <button type="button" class="icon-button" data-ooc-group-next aria-label="다음 OOC 그룹" title="다음 OOC 그룹" disabled={groupIndex < 0 || groupIndex >= matchingGroups.length - 1}
                onclick={() => selectGroup(matchingGroups[groupIndex + 1].id)}><ChevronRightIcon size={18} /></button>
            <input class="search" type="search" placeholder="OOC 내용 검색" aria-label="OOC 내용 검색" bind:value={query} />
        </div>
    </header>
    <div class="entries">
        {#each selectedGroup?.entries ?? [] as { message, index, turn } (index)}
            <article class:user={message.role === 'user'} data-ooc-message-index={index}>
                <div class="message-label">
                    <span>{message.role === 'user' ? '사용자' : 'AI 응답'}</span>
                    <span>{turn === undefined ? `메시지 ${index + 1}` : `턴 ${turn}`}</span>
                    {#if message.disabled}<span>비활성</span>{/if}
                    <button type="button" class="source-button" data-ooc-source disabled={!onNavigate} onclick={() => navigate(index)}><LocateFixedIcon size={14} />원문으로 이동</button>
                    <button type="button" class="delete-button" data-ooc-delete disabled={!onDelete || deleting}
                        aria-label={message.role === 'user' ? '사용자 입력 삭제' : 'AI 응답 삭제'}
                        title={message.role === 'user' ? '사용자 입력 삭제 (연결된 응답과 함께 삭제 선택 가능)' : 'AI 응답 삭제'}
                        onclick={() => remove(index)}><Trash2Icon size={14} />삭제</button>
                </div>
                <div class="content" class:chattext={markdownEnabled} class:prose={markdownEnabled}
                    class:prose-invert={$ColorSchemeTypeStore === 'dark'}
                    style:font-size={`${fontSize}px`}
                    style:line-height={`${(DBState.db.lineHeight ?? 1.25) / 0.875}`}
                >
                    {#if markdownEnabled}
                    {#await ParseMarkdown(message.data.split(OOC_TURN_MARKER).join(''))}
                        <span class="whitespace-pre-wrap">{message.data.split(OOC_TURN_MARKER).join('')}</span>
                    {:then html}
                        {@html html}
                    {:catch}
                        <span class="whitespace-pre-wrap">{message.data.split(OOC_TURN_MARKER).join('')}</span>
                    {/await}
                    {:else}
                        <span class="whitespace-pre-wrap">{message.data.split(OOC_TURN_MARKER).join('')}</span>
                    {/if}
                </div>
            </article>
        {:else}
            <p class="empty">{groups.length ? '검색 결과가 없습니다.' : '현재 챗에 OOC 턴이 없습니다.'}</p>
        {/each}
    </div>
</section>

<ShDialog bind:open={helpOpen} ariaLabel="OOC 메모장 도움말" closeOnEscape>
    {#snippet title()}OOC 메모장{/snippet}
    <div class="help-content">
        <p>AI 응답 원문에 <code>{OOC_TURN_MARKER}</code>가 포함되어 있으면 OOC 턴으로 인식하고 대응 사용자 입력도 함께 표시합니다.</p>
        <p>원본 채팅을 직접 보여주는 메모장입니다. 원본 수정, 재생성, 삭제는 여기에도 반영되며 별도 복사본을 저장하지 않습니다.</p>
        <p>OOC 응답과 대응 사용자 입력은 바드위키 분석, 재분석, 리부트와 과거 원문 검색에서 항상 제외됩니다.</p>
        <p>답변을 만들 때는 마지막 일반 응답 뒤에 이어진 OOC 묶음을 모두 넣고, ‘답변에 그대로 넣을 최근 응답 수’는 그 앞의 일반 대화만으로 셉니다. 중간에 일반 응답이 한 번이라도 있으면 그 앞의 OOC는 넣지 않습니다. 프롬프트에 <code>ooc</code> 토글(대소문자 무관)이 있으면 그 값이 0일 때 OOC 묶음을 넣지 않습니다. 토글이 없는 프롬프트는 직전 응답이 OOC인지만 보고 판단합니다.</p>
        <p><strong>주의:</strong> 이어진 OOC 묶음에는 개수 제한이 없습니다. OOC를 길게 이어갈수록 매 답변에 들어가는 토큰이 계속 늘어납니다. 대화가 길어졌다면 OOC 토글을 끄고 스토리로 돌아가세요.</p>
        <p>‘챗에서 OOC 턴 숨김’은 모든 챗의 화면 표시만 조절합니다. ‘원문으로 이동’을 누르면 숨김을 해제하고 해당 메시지로 이동합니다.</p>
        <p>연속된 AI 턴 번호를 한 그룹으로 묶습니다. 검색은 모든 OOC 그룹을 대상으로 하며, 드롭다운과 화살표로 검색에 맞는 그룹을 이동합니다. 글자 크기와 MD 설정은 메모장에만 적용됩니다.</p>
    </div>
</ShDialog>

<style>
    .ooc-notepad { --ooc-pad: clamp(.8rem, 3vw, 1.5rem); flex: 1; min-height: 0; overflow: auto; color: var(--color-textcolor); }
    /* 상단 메뉴는 본문 위 별도 레이어로 고정한다. 불투명 배경과 z-index로 스크롤되는 카드가 비쳐 보이지 않게 한다. */
    .notepad-header { position: sticky; top: 0; z-index: 5; display: grid; gap: .65rem; padding: var(--ooc-pad) var(--ooc-pad) .75rem;
        background: var(--color-bgcolor); border-bottom: 1px solid var(--color-darkborderc); }
    .entries { padding: 1rem var(--ooc-pad) var(--ooc-pad); }
    .heading, .title, .display-options, .search-row { display: flex; align-items: center; gap: .5rem; }
    .heading { flex-wrap: wrap; justify-content: space-between; }
    .title { flex-shrink: 0; }
    .display-options { flex-wrap: wrap; min-width: 0; }
    h2 { font-size: 1.1rem; font-weight: 700; }
    .message-label, .empty { color: var(--color-textcolor2); font-size: .8rem; }
    label { display: flex; align-items: center; gap: .35rem; font-size: .8rem; cursor: pointer; white-space: nowrap; }
    input[type='checkbox'] { accent-color: var(--color-primary); }
    .search, select, .font-size { padding: .45rem .5rem; border: 1px solid var(--color-darkborderc); border-radius: calc(var(--risu-radius-lg) * 0.8); background: var(--color-darkbg); color: var(--color-textcolor); }
    .search { flex: 1; min-width: 0; }
    select { max-width: 9rem; font-size: .8rem; }
    .font-size { width: 3.6rem; padding: .15rem .25rem; }
    .icon-button, .source-button { display: inline-flex; align-items: center; justify-content: center; gap: .3rem; padding: .35rem; border-radius: calc(var(--risu-radius-sm) * 1.2); flex-shrink: 0; }
    button:hover:not(:disabled) { background: var(--color-darkbutton); color: var(--color-primary); }
    button:disabled { opacity: .4; }
    input:focus-visible, select:focus-visible, button:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 2px; }
    .entries { display: grid; gap: .9rem; position: relative; z-index: 0; }
    .delete-button { display: inline-flex; align-items: center; gap: .3rem; padding: .35rem; border-radius: calc(var(--risu-radius-sm) * 1.2); flex-shrink: 0; white-space: nowrap; color: var(--color-textcolor2); }
    button.delete-button:hover:not(:disabled) { color: var(--color-danger); }
    article { min-width: 0; border: 1px solid var(--color-darkborderc); border-radius: var(--risu-radius-lg); background: var(--color-darkbg); padding: 1rem; }
    article.user { border-left: 3px solid var(--color-primary); }
    .message-label { display: flex; flex-wrap: wrap; align-items: center; gap: .5rem; margin-bottom: .5rem; }
    .source-button { margin-left: auto; white-space: nowrap; }
    .content { max-width: none; overflow-wrap: anywhere; }
    .help-content { display: grid; gap: .8rem; font-size: .9rem; line-height: 1.65; }
    .help-content code { overflow-wrap: anywhere; }
    .empty { padding: 2rem .5rem; text-align: center; }
</style>
