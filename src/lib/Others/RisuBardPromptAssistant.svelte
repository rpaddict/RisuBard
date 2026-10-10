<script lang="ts">
    import { onDestroy, tick, untrack } from 'svelte'
    import markdownit from 'markdown-it'
    import DOMPurify from 'dompurify'
    import {
        CheckIcon,
        LoaderCircleIcon,
        MessageSquareTextIcon,
        PanelRightCloseIcon,
        PanelRightOpenIcon,
        PencilIcon,
        PlusIcon,
        RotateCcwIcon,
        SendHorizontalIcon,
        SquareIcon,
        TrashIcon,
        XIcon,
    } from '@lucide/svelte'
    import ShButton from 'src/lib/UI/GUI/ShButton.svelte'
    import { DBState, PromptPresetSubmenuIndex, promptV2JumpRequest, selectedCharID } from 'src/ts/stores.svelte'
    import { getActiveBotPresetId, getBotPresetIndexById, selectChatPromptPreset } from 'src/ts/storage/database.svelte'
    import { openSettings, SettingsRoute } from 'src/ts/routing'
    import { alertConfirm } from 'src/ts/alert'
    import { tokenize } from 'src/ts/tokenizer'
    import {
        BLOCK_REFERENCE_PATTERN,
        clampChatMessageCount,
        collectBlockNames,
        formatChatLogForAssistant,
        markStrongForCjk,
        PROMPT_ASSISTANT_MAX_CHAT_MESSAGES,
        STRONG_CLOSE_MARK,
        STRONG_OPEN_MARK,
        stripBlockWrapper,
        resolveBlockIndex,
        serializePresetForAssistant,
        type PromptAssistantIndex,
        type PromptAssistantModel,
        type PromptAssistantProject,
    } from 'src/ts/risubard/promptAssistant'
    import {
        collectPromptAssistantChatLines,
        createPromptAssistantMessage,
        deletePromptAssistantProject,
        findLatestSentRequest,
        listPromptAssistantPresets,
        loadPromptAssistantIndex,
        loadPromptAssistantProject,
        newPromptAssistantProject,
        rememberPromptAssistantProject,
        resolvePromptAssistantPreset,
        savePromptAssistantProject,
        sendPromptAssistant,
    } from 'src/ts/risubard/promptAssistantStore'

    interface Props {
        open: boolean
    }

    let { open = $bindable() }: Props = $props()

    const RATIO_KEY = 'risubard-prompt-assistant-dock-ratio'
    const SCROLL_KEY = 'risubard-prompt-assistant-scroll'
    const COLLAPSED_KEY = 'risubard-prompt-assistant-collapsed'
    const OPEN_BLOCK_TITLE = '프롬프트 프리셋 V2 편집기에서 이 블록을 엽니다'
    const markdown = markdownit({ html: false, linkify: true, breaks: true })
    const renderFence = markdown.renderer.rules.fence!
    markdown.renderer.rules.fence = (tokens, idx, options, env, self) => {
        const no = tokens[idx].content.match(/^\s*<block\s+no="(\d{1,4})"/)?.[1]
        const openButton = no ? `<button type="button" data-block-ref="${no}" title="${OPEN_BLOCK_TITLE}">편집기에서 열기</button>` : ''
        return `<div data-code-block>${renderFence(tokens, idx, options, env, self)}<div data-code-actions>${openButton}<button type="button" data-copy-code title="블록 태그를 뺀 본문을 복사합니다">복사</button></div></div>`
    }
    const examples = [
        '방금 응답이 너무 길고 같은 묘사를 반복해. 어느 블록 때문인지 짚어 줘.',
        '캐릭터가 내 행동을 대신 서술해. 이걸 막으려면 어디를 고쳐야 해?',
        '이 프리셋에서 서로 충돌하거나 중복되는 지시를 찾아 줘.',
    ]

    let index = $state<PromptAssistantIndex>({ version: 1, projects: [] })
    let project = $state<PromptAssistantProject | null>(null)
    let loading = $state(true)
    let loadError = $state('')
    let saveError = $state('')

    let formMode = $state<'none' | 'create' | 'rename'>('none')
    let formName = $state('')
    let formPresetId = $state('')

    let draft = $state('')
    let running = $state(false)
    let streamingText = $state('')
    let notice = $state('')
    let controller: AbortController | null = null
    let logElement = $state<HTMLElement>()
    let inputElement = $state<HTMLTextAreaElement>()
    let dockElement = $state<HTMLElement>()
    let ratio = $state(readRatio())
    let collapsed = $state(readCollapsed())
    let estimate = $state<number | null>(null)

    const presets = $derived.by(() => {
        void DBState.db.botPresets
        void DBState.db.botPresetsId
        return listPromptAssistantPresets()
    })
    const currentCharacter = $derived($selectedCharID >= 0 ? DBState.db.characters[$selectedCharID] : undefined)
    const currentChat = $derived(currentCharacter?.chats[currentCharacter.chatPage])
    const attachmentLabel = $derived(project
        ? ['프리셋', project.chatMessages > 0 ? `최근 챗 최대 ${project.chatMessages}개` : '', project.includeRequest ? '마지막 실제 요청' : '']
            .filter(Boolean).join(', ')
        : '')
    const projectPreset = $derived(project ? presets.find((preset) => preset.id === project.presetId) : undefined)

    function readRatio(): number {
        try {
            const value = Number(localStorage.getItem(RATIO_KEY))
            return Number.isFinite(value) && value >= 0.25 && value <= 0.75 ? value : 0.38
        }
        catch { return 0.38 }
    }

    function readCollapsed(): boolean {
        try { return localStorage.getItem(COLLAPSED_KEY) === '1' }
        catch { return false }
    }

    function setCollapsed(value: boolean) {
        collapsed = value
        try { localStorage.setItem(COLLAPSED_KEY, value ? '1' : '0') } catch {}
    }

    function setRatio(value: number) {
        ratio = Math.min(0.75, Math.max(0.25, value))
        try { localStorage.setItem(RATIO_KEY, String(ratio)) } catch {}
    }

    function resize(event: PointerEvent) {
        event.preventDefault()
        const container = dockElement?.parentElement
        if (!container) return
        const update = (move: PointerEvent) => {
            const bounds = container.getBoundingClientRect()
            if (bounds.width > 0) setRatio((bounds.right - move.clientX) / bounds.width)
        }
        const stop = () => {
            window.removeEventListener('pointermove', update)
            window.removeEventListener('pointerup', stop)
        }
        window.addEventListener('pointermove', update)
        window.addEventListener('pointerup', stop, { once: true })
    }

    function resizeByKeyboard(event: KeyboardEvent) {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
        event.preventDefault()
        setRatio(ratio + (event.key === 'ArrowLeft' ? 0.05 : -0.05))
    }

    function errorText(cause: unknown): string {
        return cause instanceof Error ? cause.message : String(cause)
    }

    function renderMarkdown(text: string): string {
        const html = markdown.render(markStrongForCjk(text))
            .replaceAll(STRONG_OPEN_MARK, '<strong>')
            .replaceAll(STRONG_CLOSE_MARK, '</strong>')
        return linkBlockReferences(DOMPurify.sanitize(html))
    }

    // Turns "114번 블록" in prose into editor links. Added after sanitizing, so
    // the buttons are built here and never come from the model's text.
    function linkBlockReferences(html: string): string {
        const template = document.createElement('template')
        template.innerHTML = html
        const walker = document.createTreeWalker(template.content, NodeFilter.SHOW_TEXT)
        const targets: Text[] = []
        while (walker.nextNode()) {
            const node = walker.currentNode as Text
            if (node.parentElement?.closest('pre, code, a, button')) continue
            BLOCK_REFERENCE_PATTERN.lastIndex = 0
            if (BLOCK_REFERENCE_PATTERN.test(node.data)) targets.push(node)
        }
        for (const node of targets) {
            const fragment = document.createDocumentFragment()
            let last = 0
            for (const match of node.data.matchAll(BLOCK_REFERENCE_PATTERN)) {
                const start = match.index ?? 0
                fragment.append(node.data.slice(last, start))
                const button = document.createElement('button')
                button.type = 'button'
                button.dataset.blockRef = match[1] ?? match[2]
                button.title = OPEN_BLOCK_TITLE
                button.textContent = match[0]
                fragment.append(button)
                last = start + match[0].length
            }
            fragment.append(node.data.slice(last))
            node.replaceWith(fragment)
        }
        return template.innerHTML
    }

    async function openBlock(no: number, messageId?: string) {
        if (!project || !Number.isInteger(no)) return
        const name = messageId ? project.messages.find((message) => message.id === messageId)?.blockNames?.[no] : undefined
        const presetIndex = getBotPresetIndexById(project.presetId)
        if (presetIndex < 0) {
            notice = '이 프로젝트에 연결된 프리셋을 찾지 못했습니다. 프리셋을 다시 골라 주세요.'
            return
        }
        if (project.presetId !== getActiveBotPresetId()) {
            const presetName = DBState.db.botPresets[presetIndex]?.name || '이름 없음'
            const confirmed = await alertConfirm(`이 프로젝트의 프리셋 '${presetName}'은(는) 지금 사용 중이 아닙니다. 사용 중 프리셋을 바꾸고 편집기를 열까요? 채팅에 쓰이는 프리셋도 함께 바뀝니다.`)
            if (!confirmed) return
            selectChatPromptPreset(presetIndex)
        }
        const target = resolveBlockIndex(DBState.db.promptTemplate ?? [], no, name)
        if (target < 0) {
            notice = name
                ? `${no}번 블록 '${name}'을(를) 찾지 못했습니다. 이름이 바뀌었거나 삭제됐을 수 있습니다.`
                : `${no}번 블록이 지금 프리셋에 없습니다.`
            return
        }
        notice = ''
        promptV2JumpRequest.set({ index: target })
        openSettings(SettingsRoute.PromptPreset)
        PromptPresetSubmenuIndex.set(2)
        // A phone has no room for both; fold the dock so the editor shows.
        if (window.matchMedia('(max-width: 46rem)').matches) setCollapsed(true)
    }

    type ScrollAnchor = { messageId: string; offset: number }

    function readScrollAnchors(): Record<string, ScrollAnchor> {
        try {
            const value = JSON.parse(localStorage.getItem(SCROLL_KEY) ?? '{}')
            return value && typeof value === 'object' ? value : {}
        }
        catch { return {} }
    }

    function writeScrollAnchor(projectId: string, anchor: ScrollAnchor) {
        try {
            const anchors = readScrollAnchors()
            anchors[projectId] = anchor
            localStorage.setItem(SCROLL_KEY, JSON.stringify(anchors))
        }
        catch {}
    }

    let scrollTimer: ReturnType<typeof setTimeout> | undefined

    // Stores the message at the top of the view, so a remounted or resized
    // log returns to the same text rather than to a raw pixel offset.
    function saveScrollNow() {
        clearTimeout(scrollTimer)
        if (!project || !logElement || logElement.clientHeight === 0) return
        const top = logElement.scrollTop
        let anchor: HTMLElement | undefined
        for (const item of logElement.querySelectorAll<HTMLElement>('[data-message-id]')) {
            anchor = item
            if (item.offsetTop + item.offsetHeight > top) break
        }
        if (anchor?.dataset.messageId) writeScrollAnchor(project.id, { messageId: anchor.dataset.messageId, offset: top - anchor.offsetTop })
    }

    function rememberScroll() {
        clearTimeout(scrollTimer)
        // A timer, not requestAnimationFrame: frames pause while the page is in the background.
        scrollTimer = setTimeout(saveScrollNow, 150)
    }

    /** Last viewed position, or the start of the latest message when none is saved. */
    let stopFollowingAnchor: (() => void) | undefined

    async function restoreScroll() {
        await tick()
        stopFollowingAnchor?.()
        if (!project || !logElement || logElement.clientHeight === 0) return
        const log = logElement
        const projectId = project.id
        const saved = readScrollAnchors()[projectId]
        const apply = () => {
            const items = log.querySelectorAll<HTMLElement>('[data-message-id]')
            const target = saved ? [...items].find((item) => item.dataset.messageId === saved.messageId) : undefined
            if (target && saved) log.scrollTop = target.offsetTop + saved.offset
            else {
                const last = items[items.length - 1]
                log.scrollTop = last ? last.offsetTop - parseFloat(getComputedStyle(log).paddingTop) : 0
            }
        }
        apply()
        // Fonts and rendered markdown can still change heights after the first
        // paint. Keep the anchor in place briefly, until the reader moves.
        const observer = new ResizeObserver(() => {
            if (project?.id === projectId) apply()
        })
        for (const child of log.children) observer.observe(child)
        const userEvents = ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const
        const stop = () => {
            observer.disconnect()
            clearTimeout(timer)
            for (const name of userEvents) log.removeEventListener(name, stop)
            if (stopFollowingAnchor === stop) stopFollowingAnchor = undefined
        }
        const timer = setTimeout(stop, 1500)
        for (const name of userEvents) log.addEventListener(name, stop, { passive: true })
        stopFollowingAnchor = stop
    }

    async function copyText(text: string) {
        if (navigator.clipboard && window.isSecureContext) {
            await navigator.clipboard.writeText(text)
            return
        }
        const area = document.createElement('textarea')
        area.value = text
        area.style.position = 'fixed'
        area.style.opacity = '0'
        document.body.appendChild(area)
        area.select()
        const copied = document.execCommand('copy')
        area.remove()
        if (!copied) throw new Error('copy failed')
    }

    async function handleLogClick(event: MouseEvent) {
        const target = event.target as HTMLElement | null
        const reference = target?.closest<HTMLElement>('[data-block-ref]')
        if (reference) {
            const messageId = reference.closest<HTMLElement>('[data-message-id]')?.dataset.messageId
            await openBlock(Number(reference.dataset.blockRef), messageId)
            return
        }
        const button = target?.closest<HTMLButtonElement>('[data-copy-code]')
        if (!button) return
        const code = button.closest('[data-code-block]')?.querySelector('pre')?.textContent ?? ''
        let label = '복사됨'
        try { await copyText(stripBlockWrapper(code)) }
        catch { label = '복사 실패' }
        button.textContent = label
        button.dataset.state = label === '복사됨' ? 'done' : 'failed'
        setTimeout(() => {
            button.textContent = '복사'
            delete button.dataset.state
        }, 1600)
    }

    async function load() {
        loading = true
        loadError = ''
        try {
            index = await loadPromptAssistantIndex()
            const id = index.lastProjectId ?? index.projects[0]?.id
            project = id ? await loadPromptAssistantProject(id) : null
            if (!project) startCreate()
        }
        catch (cause) {
            loadError = errorText(cause)
        }
        finally {
            loading = false
        }
        await restoreScroll()
    }

    async function persist() {
        if (!project) return
        saveError = ''
        try {
            index = await savePromptAssistantProject($state.snapshot(project) as PromptAssistantProject, index)
        }
        catch (cause) {
            saveError = `저장하지 못했습니다. ${errorText(cause)}`
        }
    }

    async function switchProject(id: string) {
        if (running || id === project?.id) return
        saveScrollNow()
        try {
            const next = await loadPromptAssistantProject(id)
            if (!next) {
                notice = '프로젝트 파일을 찾지 못했습니다.'
                return
            }
            project = next
            formMode = 'none'
            index = await rememberPromptAssistantProject(id, index)
            await restoreScroll()
        }
        catch (cause) {
            notice = `프로젝트를 열지 못했습니다. ${errorText(cause)}`
        }
    }

    function startCreate() {
        const active = presets.find((preset) => preset.active) ?? presets[0]
        formMode = 'create'
        formPresetId = active?.id ?? ''
        formName = active ? `${active.name} 다듬기` : ''
    }

    function startRename() {
        if (!project) return
        formMode = 'rename'
        formName = project.name
    }

    async function submitForm() {
        const name = formName.trim()
        if (!name) return
        if (formMode === 'create') {
            if (!formPresetId) return
            project = newPromptAssistantProject(name, formPresetId)
        }
        else if (project) {
            project.name = name
        }
        formMode = 'none'
        await persist()
    }

    async function removeProject() {
        if (!project || running) return
        if (!await alertConfirm(`'${project.name}' 프로젝트와 대화를 삭제할까요? 프리셋은 그대로 남습니다.`)) return
        try {
            index = await deletePromptAssistantProject(project.id, index)
            project = index.lastProjectId ? await loadPromptAssistantProject(index.lastProjectId) : null
            if (!project) startCreate()
            await restoreScroll()
        }
        catch (cause) {
            notice = `삭제하지 못했습니다. ${errorText(cause)}`
        }
    }

    async function resetConversation() {
        if (!project || running || project.messages.length === 0) return
        if (!await alertConfirm('이 프로젝트의 대화를 모두 지울까요? 프로젝트 설정과 프리셋은 그대로 남습니다.')) return
        project.messages = []
        notice = ''
        await persist()
    }

    function setModel(model: PromptAssistantModel) {
        if (!project || project.model === model) return
        project.model = model
        void persist()
    }

    async function scrollToEnd() {
        await tick()
        logElement?.scrollTo({ top: logElement.scrollHeight })
    }

    async function send(text = draft) {
        const userText = text.trim()
        if (!project || running || !userText) return
        const preset = resolvePromptAssistantPreset(project.presetId)
        if (!preset) {
            notice = '연결된 프리셋을 찾지 못했습니다. 프리셋을 다시 골라 주세요.'
            return
        }
        stopFollowingAnchor?.()
        notice = ''
        running = true
        streamingText = ''
        controller = new AbortController()
        const signal = controller.signal
        const target = project
        const history = $state.snapshot(target.messages) as PromptAssistantProject['messages']
        try {
            const chatLines = currentCharacter && currentChat
                ? collectPromptAssistantChatLines(currentCharacter, currentChat, target.chatMessages)
                : []
            let sentRequest: string | undefined
            if (target.includeRequest && currentChat) {
                const found = await findLatestSentRequest(currentChat)
                if (found.status === 'found') sentRequest = found.text
                else notice = found.status === 'disabled'
                    ? '요청 기록이 꺼져 있어 실제 요청을 첨부하지 못했습니다.'
                    : '마지막 AI 응답의 요청 기록이 없어 실제 요청을 첨부하지 못했습니다.'
            }
            target.messages.push(createPromptAssistantMessage('user', userText, {
                attached: { chatMessages: chatLines.length, request: !!sentRequest },
            }))
            if (text === draft) draft = ''
            await scrollToEnd()
            const reply = await sendPromptAssistant({
                project: { ...target, messages: history },
                userText,
                preset,
                chatLines,
                sentRequest,
                currentCharacter,
                signal,
                onText: (value) => {
                    streamingText = value
                    void scrollToEnd()
                },
            })
            const blockNames = collectBlockNames(preset, reply)
            if (signal.aborted) {
                if (reply.trim()) target.messages.push(createPromptAssistantMessage('assistant', reply, { blockNames }))
                notice = '응답을 중단했습니다.'
            }
            else if (!reply.trim()) {
                target.messages.push(createPromptAssistantMessage('assistant', '빈 응답을 받았습니다.', { failed: true }))
            }
            else {
                target.messages.push(createPromptAssistantMessage('assistant', reply, { blockNames }))
            }
        }
        catch (cause) {
            if (signal.aborted) notice = '응답을 중단했습니다.'
            else target.messages.push(createPromptAssistantMessage('assistant', errorText(cause), { failed: true }))
        }
        finally {
            running = false
            streamingText = ''
            controller = null
            if (project === target) {
                await persist()
                await scrollToEnd()
            }
        }
    }

    function retry() {
        const lastUser = project?.messages.findLast((message) => message.role === 'user')
        if (lastUser) void send(lastUser.text)
    }

    function stop() {
        controller?.abort()
    }

    async function useExample(text: string) {
        draft = text
        await tick()
        inputElement?.focus()
    }

    $effect(() => {
        if (!project) {
            estimate = null
            return
        }
        const preset = resolvePromptAssistantPreset(project.presetId)
        const lines = currentCharacter && currentChat
            ? collectPromptAssistantChatLines(currentCharacter, currentChat, project.chatMessages)
            : []
        const material = (preset ? serializePresetForAssistant(preset) : '') + formatChatLogForAssistant(lines)
        let cancelled = false
        const timer = setTimeout(async () => {
            try {
                const count = await tokenize(material)
                if (!cancelled) estimate = count
            }
            catch { if (!cancelled) estimate = null }
        }, 400)
        return () => {
            cancelled = true
            clearTimeout(timer)
        }
    })

    let started = false
    $effect(() => {
        if (!open || started) return
        started = true
        void load()
    })

    // Runs before the DOM hides the dock, while the log still has its offset.
    $effect.pre(() => {
        if (!open || collapsed) untrack(saveScrollNow)
    })

    // display:none drops the log's scroll offset, so reopening restores it.
    $effect(() => {
        if (open && !collapsed && !loading) void restoreScroll()
    })

    onDestroy(() => {
        controller?.abort()
        stopFollowingAnchor?.()
        saveScrollNow()
    })
</script>

<aside
    bind:this={dockElement}
    class="prompt-assistant-dock"
    class:closed={!open}
    class:collapsed
    style:flex-basis={collapsed ? null : `${ratio * 100}%`}
    aria-label="프롬프트 비서"
    aria-hidden={!open}
    inert={!open}
    data-prompt-assistant
>
    <button
        type="button"
        class="rail"
        aria-label="프롬프트 비서 펼치기"
        title="펼치기"
        onclick={() => setCollapsed(false)}
        data-prompt-assistant-expand
    >
        <PanelRightOpenIcon size={18} />
        <span class="rail-title">프롬프트 비서</span>
        {#if running}<LoaderCircleIcon class="animate-spin" size={15} aria-label="답변을 받는 중" />{/if}
    </button>
    <button
        type="button"
        class="dock-resizer"
        aria-label="프롬프트 비서 폭 조절"
        onpointerdown={resize}
        onkeydown={resizeByKeyboard}
    ></button>

    <header class="dock-header">
        <div class="dock-titlebar">
            <span class="dock-mark"><MessageSquareTextIcon size={17} /></span>
            <strong>프롬프트 비서</strong>
            <span class="titlebar-spacer"></span>
            <button class="icon-button" type="button" aria-label="프롬프트 비서 접기" title="접기" onclick={() => setCollapsed(true)} data-prompt-assistant-collapse>
                <PanelRightCloseIcon size={18} />
            </button>
            <button class="icon-button" type="button" aria-label="프롬프트 비서 닫기" title="닫기" onclick={() => { saveScrollNow(); open = false }}>
                <XIcon size={18} />
            </button>
        </div>

        {#if !loading && !loadError}
            {#if formMode === 'none' && project}
                <div class="project-row">
                    <select
                        class="field project-select"
                        aria-label="프로젝트"
                        value={project.id}
                        disabled={running}
                        onchange={(event) => void switchProject(event.currentTarget.value)}
                        data-prompt-assistant-project
                    >
                        {#each index.projects as item (item.id)}
                            <option value={item.id}>{item.name}</option>
                        {/each}
                    </select>
                    <button class="icon-button" type="button" aria-label="새 프로젝트" title="새 프로젝트" disabled={running} onclick={startCreate}><PlusIcon size={16} /></button>
                    <button class="icon-button" type="button" aria-label="프로젝트 이름 바꾸기" title="이름 바꾸기" disabled={running} onclick={startRename}><PencilIcon size={15} /></button>
                    <button class="icon-button danger" type="button" aria-label="프로젝트 삭제" title="프로젝트 삭제" disabled={running} onclick={() => void removeProject()}><TrashIcon size={15} /></button>
                </div>

                <div class="settings-grid">
                    <label class="setting">
                        <span>프리셋</span>
                        <select
                            class="field"
                            bind:value={project.presetId}
                            disabled={running}
                            onchange={() => void persist()}
                            data-prompt-assistant-preset
                        >
                            {#if !projectPreset}
                                <option value={project.presetId}>삭제된 프리셋</option>
                            {/if}
                            {#each presets as preset (preset.id)}
                                <option value={preset.id}>{preset.name}{preset.active ? ' (사용 중)' : ''}</option>
                            {/each}
                        </select>
                    </label>
                    <div class="setting">
                        <span>모델</span>
                        <div class="segmented" role="radiogroup" aria-label="모델">
                            <button type="button" role="radio" aria-checked={project.model === 'model'} class:active={project.model === 'model'} disabled={running} onclick={() => setModel('model')}>메인</button>
                            <button type="button" role="radio" aria-checked={project.model === 'otherAx'} class:active={project.model === 'otherAx'} disabled={running} onclick={() => setModel('otherAx')}>보조</button>
                        </div>
                    </div>
                    <label class="setting">
                        <span>최근 챗</span>
                        <span class="number-field">
                            <input
                                class="field"
                                type="number"
                                min="0"
                                max={PROMPT_ASSISTANT_MAX_CHAT_MESSAGES}
                                step="1"
                                value={project.chatMessages}
                                disabled={running}
                                onchange={(event) => {
                                    if (!project) return
                                    project.chatMessages = clampChatMessageCount(event.currentTarget.value)
                                    event.currentTarget.value = String(project.chatMessages)
                                    void persist()
                                }}
                                aria-label="함께 보낼 최근 챗 메시지 수"
                                data-prompt-assistant-chat-count
                            />
                            <small>개</small>
                        </span>
                    </label>
                    <label class="setting check" title="마지막 AI 응답을 만들 때 모델에 실제로 보낸 최종 프롬프트를 요청 기록에서 가져옵니다.">
                        <input
                            type="checkbox"
                            bind:checked={project.includeRequest}
                            disabled={running}
                            onchange={() => void persist()}
                            data-prompt-assistant-include-request
                        />
                        <span>실제 요청 첨부</span>
                    </label>
                </div>
                <p class="attach-summary" aria-live="polite">
                    <span>함께 보냄: {attachmentLabel}</span>
                    {#if estimate !== null}<span class="tabular">약 {estimate.toLocaleString()} 토큰{project.includeRequest ? ' + 요청' : ''}</span>{/if}
                </p>
            {:else if formMode !== 'none'}
                <form class="project-form" onsubmit={(event) => { event.preventDefault(); void submitForm() }} data-prompt-assistant-form>
                    <label class="setting">
                        <span>{formMode === 'create' ? '새 프로젝트 이름' : '프로젝트 이름'}</span>
                        <!-- svelte-ignore a11y_autofocus -->
                        <input class="field" bind:value={formName} maxlength="80" placeholder="예: 대사 위주 버전" autofocus />
                    </label>
                    {#if formMode === 'create'}
                        <label class="setting">
                            <span>다듬을 프리셋</span>
                            <select class="field" bind:value={formPresetId}>
                                {#each presets as preset (preset.id)}
                                    <option value={preset.id}>{preset.name}{preset.active ? ' (사용 중)' : ''}</option>
                                {/each}
                            </select>
                        </label>
                    {/if}
                    <div class="form-actions">
                        {#if project}
                            <ShButton variant="outline" size="sm" type="button" onclick={() => formMode = 'none'}><XIcon size={14} /> 취소</ShButton>
                        {/if}
                        <ShButton variant="primary" size="sm" type="submit" disabled={!formName.trim() || (formMode === 'create' && !formPresetId)}>
                            <CheckIcon size={14} /> {formMode === 'create' ? '만들기' : '저장'}
                        </ShButton>
                    </div>
                </form>
            {/if}
        {/if}
    </header>

    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <div class="log" bind:this={logElement} aria-live="polite" onscroll={rememberScroll} onclick={(event) => void handleLogClick(event)} data-prompt-assistant-log>
        {#if loading}
            <div class="state"><LoaderCircleIcon class="animate-spin" size={18} /> 프로젝트를 불러오는 중입니다.</div>
        {:else if loadError}
            <div class="state failure">
                <p>프로젝트 목록을 불러오지 못했습니다. {loadError}</p>
                <ShButton variant="outline" size="sm" onclick={() => void load()}><RotateCcwIcon size={14} /> 다시 시도</ShButton>
            </div>
        {:else if !project}
            <div class="state">
                <p>프로젝트를 만들면 대화가 그 이름으로 저장됩니다. 같은 프리셋도 버전마다 프로젝트를 따로 둘 수 있습니다.</p>
            </div>
        {:else if project.messages.length === 0 && !running}
            <div class="empty">
                <p class="empty-lead">채팅이 마음에 들지 않을 때 무엇이 문제인지 말해 주세요.</p>
                <p>비서는 <b>{projectPreset?.name ?? '연결된 프리셋'}</b>을 분석할 자료로 읽고, 어느 블록을 어떻게 고칠지 제안합니다. 프리셋은 비서의 지시로 쓰이지 않으며, 수정은 직접 반영합니다.</p>
                <div class="examples">
                    {#each examples as example}
                        <button type="button" onclick={() => void useExample(example)}>{example}</button>
                    {/each}
                </div>
            </div>
        {:else}
            {#each project.messages as message (message.id)}
                <article class="message {message.role}" class:failed={message.failed} data-message-id={message.id}>
                    <header>
                        <span class="role">{message.role === 'user' ? '나' : '비서'}</span>
                        {#if message.attached && (message.attached.chatMessages > 0 || message.attached.request)}
                            <span class="attached">
                                {message.attached.chatMessages > 0 ? `챗 ${message.attached.chatMessages}개` : ''}{message.attached.chatMessages > 0 && message.attached.request ? ', ' : ''}{message.attached.request ? '실제 요청' : ''} 첨부
                            </span>
                        {/if}
                    </header>
                    {#if message.role === 'assistant' && !message.failed}
                        <div class="markdown">{@html renderMarkdown(message.text)}</div>
                    {:else if message.failed}
                        <p class="body">응답 실패: {message.text}</p>
                    {:else}
                        <p class="body">{message.text}</p>
                    {/if}
                </article>
            {/each}
            {#if running}
                <article class="message assistant pending">
                    <header><span class="role">비서</span></header>
                    {#if streamingText}
                        <div class="markdown">{@html renderMarkdown(streamingText)}</div>
                    {:else}
                        <p class="body waiting"><LoaderCircleIcon class="animate-spin" size={14} /> 프리셋을 읽는 중입니다.</p>
                    {/if}
                </article>
            {:else if project.messages.at(-1)?.failed}
                <div class="retry">
                    <ShButton variant="outline" size="sm" onclick={retry}><RotateCcwIcon size={14} /> 다시 보내기</ShButton>
                </div>
            {/if}
        {/if}
    </div>

    {#if project && formMode === 'none'}
        <footer class="composer">
            {#if notice || saveError}
                <p class="notice" class:failure={!!saveError}>{saveError || notice}</p>
            {/if}
            <textarea
                bind:this={inputElement}
                bind:value={draft}
                rows="3"
                maxlength="12000"
                placeholder="예: 방금 응답에서 캐릭터 말투가 무너졌어. 원인이 뭐야?"
                aria-label="프롬프트 비서에게 보낼 메시지"
                onkeydown={(event) => {
                    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                        event.preventDefault()
                        void send()
                    }
                }}
                data-prompt-assistant-input
            ></textarea>
            <div class="composer-actions">
                <button
                    class="text-button"
                    type="button"
                    disabled={running || project.messages.length === 0}
                    onclick={() => void resetConversation()}
                    data-prompt-assistant-reset
                ><RotateCcwIcon size={14} /> 대화 초기화</button>
                <span class="hint">Ctrl+Enter로 보내기</span>
                {#if running}
                    <ShButton variant="outline" size="sm" onclick={stop} data-prompt-assistant-stop><SquareIcon size={13} /> 중단</ShButton>
                {:else}
                    <ShButton variant="primary" size="sm" disabled={!draft.trim()} onclick={() => void send()} data-prompt-assistant-send>
                        <SendHorizontalIcon size={14} /> 보내기
                    </ShButton>
                {/if}
            </div>
        </footer>
    {/if}
</aside>

<style>
    .prompt-assistant-dock {
        --pa-line: color-mix(in srgb, var(--risu-theme-primary) 22%, var(--risu-theme-darkborderc));
        position: relative;
        z-index: 30;
        display: flex;
        flex: 0 0 auto;
        flex-direction: column;
        min-width: min(24rem, 100%);
        max-width: 75%;
        height: 100%;
        min-height: 0;
        overflow: hidden;
        border-left: 1px solid color-mix(in srgb, var(--risu-theme-primary) 28%, var(--risu-theme-darkborderc));
        color: var(--risu-theme-textcolor);
        background: var(--risu-theme-darkbg);
        box-shadow: -.8rem 0 2.4rem color-mix(in srgb, var(--color-shadow) 18%, transparent);
        animation: dock-enter .18s ease-out;
        container-type: inline-size;
    }
    .prompt-assistant-dock.closed { display: none; }
    .prompt-assistant-dock.collapsed {
        width: 2.75rem;
        min-width: 2.75rem;
        max-width: 2.75rem;
    }
    .prompt-assistant-dock.collapsed > :not(.rail) { display: none; }
    .rail { display: none; }
    .collapsed .rail {
        display: flex;
        flex: 1 1 auto;
        flex-direction: column;
        align-items: center;
        gap: .75rem;
        width: 100%;
        padding: .7rem 0;
        border: 0;
        color: var(--risu-theme-textcolor2);
        background: color-mix(in srgb, var(--risu-theme-darkbg) 91%, var(--color-bgcolor));
        cursor: pointer;
    }
    .collapsed .rail:hover,
    .collapsed .rail:focus-visible {
        color: var(--risu-theme-primary);
        background: color-mix(in srgb, var(--risu-theme-primary) 8%, var(--risu-theme-darkbg));
        outline: 0;
    }
    .rail-title {
        color: var(--risu-theme-textcolor);
        font-size: .78rem;
        font-weight: 700;
        letter-spacing: .06em;
        writing-mode: vertical-rl;
    }
    @keyframes dock-enter {
        from { opacity: 0; transform: translateX(.75rem); }
        to { opacity: 1; transform: none; }
    }
    @media (prefers-reduced-motion: reduce) {
        .prompt-assistant-dock { animation: none; }
    }
    .dock-resizer {
        position: absolute;
        z-index: 5;
        inset: 0 auto 0 -.3rem;
        width: .6rem;
        padding: 0;
        border: 0;
        background: transparent;
        cursor: col-resize;
        touch-action: none;
    }
    .dock-resizer::after {
        content: '';
        position: absolute;
        inset: 0 auto 0 .27rem;
        width: 3px;
        background: transparent;
        transform: scaleX(.34);
        transition: transform .15s ease, background .15s ease;
    }
    .dock-resizer:hover::after,
    .dock-resizer:focus-visible::after {
        transform: none;
        outline: 0;
        background: var(--risu-theme-primary);
    }

    .dock-header {
        display: grid;
        gap: .5rem;
        padding: .45rem .6rem .6rem .7rem;
        border-bottom: 1px solid var(--risu-theme-darkborderc);
        background: color-mix(in srgb, var(--risu-theme-darkbg) 91%, var(--color-bgcolor));
    }
    .dock-titlebar { display: flex; align-items: center; gap: .55rem; min-width: 0; }
    .dock-titlebar strong {
        font-family: var(--risu-font-family);
        font-size: .84rem;
        font-weight: 700;
        line-height: 1.1;
        letter-spacing: -.02em;
        white-space: nowrap;
    }
    .titlebar-spacer { flex: 1 1 auto; }
    .dock-mark {
        display: grid;
        flex: 0 0 auto;
        width: 1.8rem;
        height: 1.8rem;
        place-items: center;
        border: 1px solid color-mix(in srgb, var(--risu-theme-primary) 38%, var(--risu-theme-darkborderc));
        border-radius: .4rem;
        color: var(--risu-theme-primary);
        background: color-mix(in srgb, var(--risu-theme-primary) 9%, transparent);
    }
    .icon-button {
        display: grid;
        flex: 0 0 auto;
        width: 2rem;
        height: 2rem;
        place-items: center;
        border: 1px solid transparent;
        border-radius: .35rem;
        color: var(--risu-theme-textcolor2);
        background: transparent;
        cursor: pointer;
    }
    .icon-button:hover:not(:disabled),
    .icon-button:focus-visible {
        border-color: var(--pa-line);
        color: var(--risu-theme-textcolor);
        background: color-mix(in srgb, var(--risu-theme-primary) 8%, transparent);
        outline: 0;
    }
    .icon-button.danger:hover:not(:disabled),
    .icon-button.danger:focus-visible { color: var(--risu-theme-draculared); }
    .icon-button:disabled { cursor: not-allowed; opacity: .42; }

    .project-row { display: flex; align-items: center; gap: .25rem; min-width: 0; }
    .field {
        min-width: 0;
        height: 2rem;
        box-sizing: border-box;
        padding: 0 .55rem;
        border: 1px solid var(--risu-theme-darkborderc);
        border-radius: .35rem;
        color: var(--risu-theme-textcolor);
        background: color-mix(in srgb, var(--risu-theme-darkbg) 82%, var(--color-bgcolor));
        font-size: .78rem;
    }
    .field:focus-visible {
        border-color: var(--risu-theme-primary);
        outline: 0;
        box-shadow: 0 0 0 2px color-mix(in srgb, var(--risu-theme-primary) 22%, transparent);
    }
    .field:disabled { opacity: .55; }
    .project-select { flex: 1 1 auto; font-weight: 600; }

    .settings-grid {
        display: grid;
        grid-template-columns: minmax(0, 1.6fr) auto auto;
        align-items: end;
        gap: .45rem .6rem;
    }
    .setting { display: grid; gap: .22rem; min-width: 0; }
    .setting > span:first-child,
    .setting.check span {
        color: var(--risu-theme-textcolor2);
        font-size: .68rem;
        font-weight: 600;
    }
    .setting .field { width: 100%; }
    .setting.check {
        grid-column: 1 / -1;
        display: flex;
        align-items: center;
        gap: .45rem;
        cursor: pointer;
    }
    .setting.check input { width: 1rem; height: 1rem; margin: 0; accent-color: var(--risu-theme-primary); }
    .setting.check span { font-size: .74rem; color: var(--risu-theme-textcolor); }
    .number-field { display: flex; align-items: center; gap: .3rem; }
    .number-field .field { width: 4.2rem; font-variant-numeric: tabular-nums; }
    .number-field small { color: var(--risu-theme-textcolor2); font-size: .7rem; }
    .segmented {
        display: inline-flex;
        justify-self: start;
        height: 2rem;
        box-sizing: border-box;
        padding: .15rem;
        border: 1px solid var(--risu-theme-darkborderc);
        border-radius: .4rem;
        background: color-mix(in srgb, var(--risu-theme-darkbg) 82%, var(--color-bgcolor));
    }
    .segmented button {
        padding: 0 .65rem;
        border: 0;
        border-radius: .28rem;
        color: var(--risu-theme-textcolor2);
        background: transparent;
        font-size: .74rem;
        font-weight: 600;
        cursor: pointer;
    }
    .segmented button.active {
        color: var(--risu-theme-primary);
        background: color-mix(in srgb, var(--risu-theme-primary) 14%, transparent);
    }
    .segmented button:focus-visible { outline: 2px solid var(--risu-theme-primary); outline-offset: -2px; }
    .segmented button:disabled { cursor: not-allowed; opacity: .55; }
    .attach-summary {
        display: flex;
        flex-wrap: wrap;
        justify-content: space-between;
        gap: .2rem .6rem;
        margin: 0;
        color: var(--risu-theme-textcolor2);
        font-size: .68rem;
        line-height: 1.45;
    }
    .tabular { font-variant-numeric: tabular-nums; white-space: nowrap; }

    .project-form { display: grid; gap: .55rem; }
    .form-actions { display: flex; justify-content: flex-end; gap: .4rem; }

    .log {
        position: relative;
        display: flex;
        flex: 1 1 auto;
        flex-direction: column;
        gap: 1.6rem;
        min-height: 0;
        overflow-y: auto;
        overscroll-behavior: contain;
        padding: .9rem .8rem 1.2rem;
        scrollbar-color: color-mix(in srgb, var(--risu-theme-textcolor2) 35%, transparent) transparent;
        scrollbar-width: thin;
    }
    .state {
        display: grid;
        justify-items: start;
        gap: .6rem;
        color: var(--risu-theme-textcolor2);
        font-size: .78rem;
        line-height: 1.55;
    }
    .state p { margin: 0; }
    .empty { display: grid; gap: .55rem; max-width: 34rem; font-size: .8rem; line-height: 1.6; color: var(--risu-theme-textcolor2); }
    .empty p { margin: 0; }
    .empty b { color: var(--risu-theme-textcolor); font-weight: 600; }
    .empty-lead { color: var(--risu-theme-textcolor); font-size: .9rem; font-weight: 600; line-height: 1.4; }
    .examples { display: grid; gap: .35rem; margin-top: .4rem; }
    .examples button {
        padding: .55rem .7rem;
        border: 1px solid var(--pa-line);
        border-radius: .4rem;
        color: var(--risu-theme-textcolor);
        text-align: left;
        background: color-mix(in srgb, var(--risu-theme-primary) 4%, transparent);
        font-size: .76rem;
        line-height: 1.45;
        cursor: pointer;
    }
    .examples button:hover,
    .examples button:focus-visible {
        border-color: color-mix(in srgb, var(--risu-theme-primary) 55%, var(--risu-theme-darkborderc));
        background: color-mix(in srgb, var(--risu-theme-primary) 10%, transparent);
        outline: 0;
    }

    .message { display: grid; gap: .4rem; min-width: 0; }
    /* A user turn opens a new exchange; give it more room than the reply it follows. */
    .message + .message.user {
        margin-top: .4rem;
        padding-top: 1.4rem;
        border-top: 1px solid color-mix(in srgb, var(--risu-theme-darkborderc) 70%, transparent);
    }
    .message > header { display: flex; align-items: baseline; gap: .5rem; }
    .role { font-size: .7rem; font-weight: 700; color: var(--risu-theme-textcolor2); }
    .message.assistant .role { color: var(--risu-theme-primary); }
    .attached { color: var(--risu-theme-textcolor2); font-size: .66rem; }
    .message.user .body {
        justify-self: start;
        max-width: 100%;
        padding: .55rem .7rem;
        border: 1px solid var(--risu-theme-darkborderc);
        border-radius: .5rem;
        background: color-mix(in srgb, var(--risu-theme-darkbg) 80%, var(--color-bgcolor));
    }
    .body {
        margin: 0;
        font-size: .8rem;
        line-height: 1.6;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
    }
    .message.failed .body { color: var(--risu-theme-draculared); }
    .waiting { display: inline-flex; align-items: center; gap: .4rem; color: var(--risu-theme-textcolor2); }
    .retry { display: flex; }
    .markdown {
        min-width: 0;
        font-size: .8rem;
        line-height: 1.65;
        overflow-wrap: anywhere;
    }
    .markdown :global(:where(p, ul, ol, pre, blockquote, table)) { margin: 0 0 .6rem; }
    .markdown :global(:where(p, ul, ol, pre, blockquote, table):last-child) { margin-bottom: 0; }
    .markdown :global(:where(ul, ol)) { padding-left: 1.2rem; }
    .markdown :global(ul) { list-style: disc; }
    .markdown :global(ol) { list-style: decimal; }
    .markdown :global(li + li) { margin-top: .2rem; }
    .markdown :global(:where(h1, h2, h3, h4)) { margin: .9rem 0 .35rem; font-size: .86rem; font-weight: 700; line-height: 1.35; }
    .markdown :global(strong) { font-weight: 700; }
    .markdown :global(code) {
        padding: .05rem .28rem;
        border-radius: .25rem;
        background: color-mix(in srgb, var(--risu-theme-primary) 10%, transparent);
        font: .74rem/1.5 ui-monospace, SFMono-Regular, Consolas, monospace;
    }
    .markdown :global(pre) {
        overflow-x: auto;
        padding: .65rem .75rem;
        border: 1px solid var(--risu-theme-darkborderc);
        border-radius: .45rem;
        background: color-mix(in srgb, var(--risu-theme-darkbg) 80%, var(--color-darkbg));
        white-space: pre-wrap;
    }
    .markdown :global(pre code) { padding: 0; background: transparent; }
    .markdown :global([data-code-block]) { display: flex; flex-direction: column; margin: 0 0 .6rem; }
    .markdown :global([data-code-block]:last-child) { margin-bottom: 0; }
    .markdown :global([data-code-block] pre) { margin: 0; }
    .markdown :global([data-code-actions]) {
        display: flex;
        order: -1;
        align-self: flex-end;
        gap: .3rem;
        margin-bottom: .3rem;
    }
    .markdown :global([data-code-actions] button) {
        min-height: 1.75rem;
        padding: 0 .6rem;
        border: 1px solid var(--pa-line);
        border-radius: .35rem;
        color: var(--risu-theme-textcolor);
        background: color-mix(in srgb, var(--risu-theme-primary) 8%, transparent);
        font-size: .7rem;
        font-weight: 600;
        cursor: pointer;
    }
    .markdown :global([data-code-actions] button:hover),
    .markdown :global([data-code-actions] button:focus-visible) {
        border-color: var(--risu-theme-primary);
        color: var(--risu-theme-primary);
        outline: 0;
    }
    .markdown :global([data-copy-code][data-state='done']) { border-color: var(--risu-theme-primary); color: var(--risu-theme-primary); }
    .markdown :global([data-copy-code][data-state='failed']) { border-color: var(--risu-theme-draculared); color: var(--risu-theme-draculared); }
    /* Inline block mentions read as links but act as buttons into the editor. */
    .markdown :global(:not([data-code-actions]) > button[data-block-ref]) {
        display: inline;
        padding: 0;
        border: 0;
        color: var(--risu-theme-primary);
        background: none;
        font: inherit;
        font-weight: 600;
        text-decoration: underline;
        text-decoration-thickness: 1px;
        text-underline-offset: .18em;
        cursor: pointer;
    }
    .markdown :global(:not([data-code-actions]) > button[data-block-ref]:hover),
    .markdown :global(:not([data-code-actions]) > button[data-block-ref]:focus-visible) {
        text-decoration-thickness: 2px;
        outline: 0;
    }
    .markdown :global(blockquote) {
        padding-left: .7rem;
        border-left: 1px solid var(--pa-line);
        color: var(--risu-theme-textcolor2);
    }
    .markdown :global(a) { color: var(--risu-theme-primary); text-decoration: underline; text-underline-offset: .15em; }
    .markdown :global(table) { border-collapse: collapse; font-size: .76rem; }
    .markdown :global(:where(th, td)) { padding: .3rem .5rem; border: 1px solid var(--risu-theme-darkborderc); }

    .composer {
        display: grid;
        gap: .45rem;
        padding: .6rem .7rem .65rem;
        border-top: 1px solid var(--risu-theme-darkborderc);
        background: color-mix(in srgb, var(--risu-theme-darkbg) 91%, var(--color-bgcolor));
    }
    .notice { margin: 0; color: var(--risu-theme-textcolor2); font-size: .7rem; line-height: 1.4; }
    .failure { color: var(--risu-theme-draculared); }
    .composer textarea {
        width: 100%;
        min-height: 4.6rem;
        max-height: 14rem;
        box-sizing: border-box;
        resize: vertical;
        padding: .55rem .65rem;
        border: 1px solid var(--risu-theme-darkborderc);
        border-radius: .45rem;
        color: var(--risu-theme-textcolor);
        background: color-mix(in srgb, var(--risu-theme-darkbg) 82%, var(--color-bgcolor));
        font-size: .8rem;
        line-height: 1.55;
    }
    .composer textarea::placeholder { color: color-mix(in srgb, var(--risu-theme-textcolor2) 75%, transparent); }
    .composer textarea:focus-visible {
        border-color: var(--risu-theme-primary);
        outline: 0;
        box-shadow: 0 0 0 2px color-mix(in srgb, var(--risu-theme-primary) 20%, transparent);
    }
    .composer-actions { display: flex; align-items: center; gap: .5rem; }
    .hint { flex: 1 1 auto; color: var(--risu-theme-textcolor2); font-size: .66rem; text-align: right; }
    .text-button {
        display: inline-flex;
        align-items: center;
        gap: .3rem;
        min-height: 2rem;
        padding: 0 .4rem;
        border: 0;
        border-radius: .35rem;
        color: var(--risu-theme-textcolor2);
        background: transparent;
        font-size: .72rem;
        font-weight: 600;
        cursor: pointer;
    }
    .text-button:hover:not(:disabled),
    .text-button:focus-visible { color: var(--risu-theme-textcolor); background: color-mix(in srgb, var(--risu-theme-primary) 8%, transparent); outline: 0; }
    .text-button:disabled { cursor: not-allowed; opacity: .42; }

    @container (max-width: 26rem) {
        .settings-grid { grid-template-columns: minmax(0, 1fr) auto; }
        .settings-grid > .setting:first-child { grid-column: 1 / -1; }
    }
    @media (max-width: 46rem) {
        .prompt-assistant-dock { position: absolute; inset: 0; z-index: 40; max-width: none; min-width: 0; flex-basis: auto !important; }
        .prompt-assistant-dock.collapsed {
            position: fixed;
            inset: 30% 0 auto auto;
            height: auto;
            border: 1px solid color-mix(in srgb, var(--risu-theme-primary) 28%, var(--risu-theme-darkborderc));
            border-right: 0;
            border-radius: .6rem 0 0 .6rem;
        }
        .collapsed .rail { padding: .8rem 0; }
        .dock-resizer { display: none; }
        .composer textarea, .field { font-size: 1rem; }
        .icon-button { width: 2.5rem; height: 2.5rem; }
        .hint { display: none; }
        .composer-actions { justify-content: space-between; }
    }
</style>
