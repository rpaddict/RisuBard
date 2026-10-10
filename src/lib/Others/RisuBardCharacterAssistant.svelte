<script lang="ts">
    import { onDestroy, tick, untrack } from 'svelte'
    import { get } from 'svelte/store'
    import markdownit from 'markdown-it'
    import DOMPurify from 'dompurify'
    import {
        ArrowLeftIcon,
        BotIcon,
        CheckIcon,
        ExternalLinkIcon,
        ListPlusIcon,
        LoaderCircleIcon,
        PanelRightCloseIcon,
        PanelRightOpenIcon,
        PencilIcon,
        PinIcon,
        PinOffIcon,
        PlusIcon,
        RotateCcwIcon,
        SendHorizontalIcon,
        SquareIcon,
        TrashIcon,
        XIcon,
    } from '@lucide/svelte'
    import ShButton from 'src/lib/UI/GUI/ShButton.svelte'
    import {
        botMakerMode,
        CharConfigSubMenu,
        characterEditorJumpRequest,
        DBState,
        PromptPresetSubmenuIndex,
        promptV2JumpRequest,
        risuBardGalleryOpen,
        selectedCharID,
        settingsOpen,
        sideBarStore,
    } from 'src/ts/stores.svelte'
    import { openSettings, SettingsRoute } from 'src/ts/routing'
    import { alertConfirm } from 'src/ts/alert'
    import { tokenize } from 'src/ts/tokenizer'
    import { changeChar } from 'src/ts/characters'
    import { markStrongForCjk, STRONG_CLOSE_MARK, STRONG_OPEN_MARK } from 'src/ts/risubard/promptAssistant'
    import {
        addPins,
        buildAssistantScopes,
        clampAssistantChatCount,
        CHARACTER_ASSISTANT_MAX_CHAT_MESSAGES,
        CHARACTER_FIELDS,
        collectMentionNames,
        findSection,
        findSectionMentions,
        pinKey,
        resolveSectionRef,
        type AssistantPin,
        type AssistantScope,
        type AssistantSection,
        type CharacterAssistantIndex,
        type CharacterAssistantModel,
        type CharacterAssistantProject,
    } from 'src/ts/risubard/characterAssistant'
    import {
        collectCharacterAssistantChatLines,
        collectCharacterAssistantSource,
        createCharacterAssistantMessage,
        deleteCharacterAssistantProject,
        describeCharacterAssistantMaterial,
        findAssistantCharacter,
        listAssistantCharacters,
        loadCharacterAssistantIndex,
        loadCharacterAssistantProject,
        newCharacterAssistantProject,
        rememberCharacterAssistantProject,
        saveCharacterAssistantProject,
        sendCharacterAssistant,
    } from 'src/ts/risubard/characterAssistantStore'

    interface Props {
        open: boolean
    }

    let { open = $bindable() }: Props = $props()

    const RATIO_KEY = 'risubard-character-assistant-dock-ratio'
    const SCROLL_KEY = 'risubard-character-assistant-scroll'
    const COLLAPSED_KEY = 'risubard-character-assistant-collapsed'
    const OPEN_TITLE = '캐릭터 편집기에서 이 항목을 엽니다'
    const VIEW_TITLE = '이 자료의 본문을 봅니다'
    /** Character editor tab of each bot field. Fields without a tab open in the viewer. */
    const FIELD_TABS: Record<string, number> = {
        desc: 0, firstMessage: 0,
        backgroundHTML: 4, lua: 4, virtualscript: 4,
        personality: 2, scenario: 2, exampleMessage: 2, systemPrompt: 2, replaceGlobalNote: 2, additionalText: 2,
        depthPrompt: 2, creatorNotes: 2, defaultVariables: 2, translatorNote: 2, customModuleToggle: 2,
    }
    const FIELD_LABELS = new Map<string, string>(CHARACTER_FIELDS.map((field) => [field.label, field.key]))
    const markdown = markdownit({ html: false, linkify: true, breaks: true })
    const renderFence = markdown.renderer.rules.fence!
    markdown.renderer.rules.fence = (tokens, idx, options, env, self) =>
        `<div data-code-block>${renderFence(tokens, idx, options, env, self)}<div data-code-actions><button type="button" data-copy-code title="코드 블록 내용을 복사합니다">복사</button></div></div>`
    const examples = [
        '이 봇의 구조를 훑어보고 토큰을 많이 쓰거나 서로 겹치는 부분을 짚어 줘.',
        '상시 활성 로어북 중에 키 매칭으로 바꿔도 되는 항목을 찾아 줘.',
        '호감도 변수가 어디서 바뀌고 어디서 쓰이는지 따라가 줘.',
    ]

    let index = $state<CharacterAssistantIndex>({ version: 1, projects: [] })
    let project = $state<CharacterAssistantProject | null>(null)
    let loading = $state(true)
    let loadError = $state('')
    let saveError = $state('')

    let formMode = $state<'none' | 'create' | 'rename'>('none')
    let formName = $state('')
    let formCharacterId = $state('')

    let draft = $state('')
    let running = $state(false)
    let streamingText = $state('')
    let lookupStatus = $state<string[]>([])
    let notice = $state('')
    let controller: AbortController | null = null
    let logElement = $state<HTMLElement>()
    let inputElement = $state<HTMLTextAreaElement>()
    let dockElement = $state<HTMLElement>()
    let ratio = $state(readRatio())
    let collapsed = $state(readCollapsed())
    let estimate = $state<number | null>(null)

    /** Side panel over the log: the section picker or one section's text. */
    let panel = $state<'none' | 'picker' | 'viewer'>('none')
    let pickerQuery = $state('')
    let viewerRef = $state('')

    const characters = $derived.by(() => {
        void DBState.db.characters
        return listAssistantCharacters()
    })
    const target = $derived(project ? characters.find((item) => item.chaId === project.characterId) : undefined)
    const scopes = $derived.by((): AssistantScope[] => {
        if (!project) return []
        // Read the fields the material depends on, so edits refresh the index.
        void DBState.db.characters
        void DBState.db.promptTemplate
        void DBState.db.modules
        const source = collectCharacterAssistantSource($state.snapshot(project) as CharacterAssistantProject)
        return source ? buildAssistantScopes(source) : []
    })
    const viewerSection = $derived(viewerRef ? findSection(scopes, viewerRef) : undefined)
    const pickerSections = $derived.by(() => {
        const query = pickerQuery.trim().toLowerCase()
        const all = scopes.flatMap((scope) => scope.sections)
        if (!query) return all
        return all.filter((section) => `${section.ref} ${section.label} ${section.summary ?? ''}`.toLowerCase().includes(query))
    })
    const attachmentLabel = $derived(project
        ? [
            '목차',
            project.pins.length > 0 ? `재료 ${project.pins.length}개` : '',
            project.referenceId ? '참고 봇' : '',
            project.includeModules ? '모듈' : '',
            project.includePreset ? '프리셋과 토글' : '',
            project.chatMessages > 0 ? `최근 챗 최대 ${project.chatMessages}개` : '',
        ].filter(Boolean).join(', ')
        : '')

    function readRatio(): number {
        try {
            const value = Number(localStorage.getItem(RATIO_KEY))
            return Number.isFinite(value) && value >= 0.15 && value <= 0.75 ? value : 0.32
        }
        catch { return 0.32 }
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
        ratio = Math.min(0.75, Math.max(0.15, value))
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
        return linkMentions(DOMPurify.sanitize(html))
    }

    function refButton(ref: string, text: string): HTMLButtonElement {
        const button = document.createElement('button')
        button.type = 'button'
        button.dataset.sectionRef = ref
        button.title = ref.startsWith('bot:') || ref.startsWith('preset:') ? OPEN_TITLE : VIEW_TITLE
        button.textContent = text
        return button
    }

    // Turns "로어북 12번" and `설명` in prose into links. Added after sanitizing,
    // so the buttons are built here and never come from the model's text.
    function linkMentions(html: string): string {
        const template = document.createElement('template')
        template.innerHTML = html
        const includeBlocks = !!project?.includePreset
        const walker = document.createTreeWalker(template.content, NodeFilter.SHOW_TEXT)
        const targets: Text[] = []
        while (walker.nextNode()) {
            const node = walker.currentNode as Text
            if (node.parentElement?.closest('pre, code, a, button')) continue
            if (findSectionMentions(node.data, includeBlocks).length > 0) targets.push(node)
        }
        for (const node of targets) {
            const fragment = document.createDocumentFragment()
            let last = 0
            for (const mention of findSectionMentions(node.data, includeBlocks)) {
                if (mention.start < last) continue
                fragment.append(node.data.slice(last, mention.start))
                fragment.append(refButton(mention.ref, node.data.slice(mention.start, mention.end)))
                last = mention.end
            }
            fragment.append(node.data.slice(last))
            node.replaceWith(fragment)
        }
        const names = itemNameRefs()
        for (const code of template.content.querySelectorAll('code')) {
            if (code.closest('pre, a, button')) continue
            const text = code.textContent?.trim() ?? ''
            const field = FIELD_LABELS.get(text)
            const ref = field ? `bot:field:${field}` : names.get(text)
            if (!ref || !findSection(scopes, ref)) continue
            const button = refButton(ref, '')
            code.replaceWith(button)
            button.append(code)
        }
        return template.innerHTML
    }

    /** Bot item names that are unique, for turning `이름` code spans into links. */
    function itemNameRefs(): Map<string, string> {
        const counts = new Map<string, number>()
        const refs = new Map<string, string>()
        for (const section of scopes.find((scope) => scope.scope === 'bot')?.sections ?? []) {
            if (!section.name || section.kind === 'field') continue
            counts.set(section.name, (counts.get(section.name) ?? 0) + 1)
            refs.set(section.name, section.ref)
        }
        for (const [name, count] of counts) if (count > 1) refs.delete(name)
        return refs
    }

    function resolveRef(ref: string, messageId?: string): AssistantSection | undefined {
        const name = messageId ? project?.messages.find((message) => message.id === messageId)?.refNames?.[ref] : undefined
        return resolveSectionRef(scopes, ref, name)
    }

    /** Whether the editor took the jump request within about a second and a half. */
    async function jumpTaken(nonce: number): Promise<boolean> {
        for (let frame = 0; frame < 90; frame++) {
            if (get(characterEditorJumpRequest)?.nonce !== nonce) return true
            await new Promise((resolve) => requestAnimationFrame(resolve))
        }
        return false
    }

    async function openSection(ref: string, messageId?: string) {
        if (!project) return
        const section = resolveRef(ref, messageId)
        if (!section) {
            const name = messageId ? project.messages.find((message) => message.id === messageId)?.refNames?.[ref] : undefined
            notice = name
                ? `'${name}' 항목을 찾지 못했습니다. 이름이 바뀌었거나 삭제됐을 수 있습니다.`
                : '이 항목이 지금 목차에 없습니다. 모듈이나 프리셋 범위가 꺼져 있는지 확인해 주세요.'
            return
        }
        notice = ''
        if (section.scope === 'preset' && section.kind === 'block') {
            promptV2JumpRequest.set({ index: Number(section.id) - 1 })
            openSettings(SettingsRoute.PromptPreset)
            PromptPresetSubmenuIndex.set(2)
            foldOnPhone()
            return
        }
        const tab = section.scope !== 'bot' ? undefined
            : section.kind === 'lore' ? 3
            : section.kind === 'regex' || section.kind === 'trigger' ? 4
            : section.kind === 'greeting' ? 0
            : FIELD_TABS[section.id]
        if (tab === undefined) {
            openViewer(section.ref)
            return
        }
        const found = findAssistantCharacter(project.characterId)
        if (!found) {
            notice = '이 프로젝트의 봇을 찾지 못했습니다.'
            return
        }
        if (get(selectedCharID) !== found.index) {
            const confirmed = await alertConfirm(`편집기를 열려면 '${found.character.name}' 캐릭터를 선택해야 합니다. 선택을 바꿀까요? 채팅 화면도 그 캐릭터로 바뀝니다.`)
            if (!confirmed) return
            changeChar(found.index)
            await tick()
            if (get(selectedCharID) !== found.index) {
                notice = '캐릭터를 바꾸지 못했습니다. 답변 생성이 끝난 뒤 다시 시도해 주세요.'
                return
            }
        }
        const nonce = Date.now()
        settingsOpen.set(false)
        risuBardGalleryOpen.set(false)
        sideBarStore.set(true)
        botMakerMode.set(true)
        CharConfigSubMenu.set(tab)
        if (section.kind === 'trigger') {
            characterEditorJumpRequest.set({ kind: 'field', field: 'trigger', nonce })
        }
        else if (section.kind === 'field') {
            characterEditorJumpRequest.set({ kind: 'field', field: section.id, nonce })
        }
        else {
            characterEditorJumpRequest.set({ kind: section.kind as 'lore' | 'regex' | 'greeting', index: Number(section.id) - 1, nonce })
        }
        foldOnPhone()
        // The editor clears the request once it shows the item. A request still
        // here means the item could not be shown, e.g. Bard Lore view is on.
        if (!await jumpTaken(nonce)) {
            characterEditorJumpRequest.set(null)
            notice = section.kind === 'lore'
                ? '로어북 탭은 열었지만 항목을 펼치지 못했습니다. 로어북이 바드 로어 보기라면 기존 로어북 편집기로 바꿔 주세요.'
                : '편집기 탭은 열었지만 항목을 찾지 못했습니다.'
        }
    }

    function foldOnPhone() {
        // A phone has no room for both; fold the dock so the editor shows.
        if (window.matchMedia('(max-width: 46rem)').matches) setCollapsed(true)
    }

    function openViewer(ref: string) {
        viewerRef = ref
        panel = 'viewer'
    }

    function closePanel() {
        panel = 'none'
        viewerRef = ''
    }

    function togglePin(ref: string) {
        if (!project) return
        if (project.pins.some((pin) => pin.ref === ref)) project.pins = project.pins.filter((pin) => pin.ref !== ref)
        else project.pins = addPins(project.pins, [{ ref }])
        void persist()
    }

    function removePin(pin: AssistantPin) {
        if (!project) return
        project.pins = project.pins.filter((item) => pinKey(item) !== pinKey(pin))
        void persist()
    }

    function clearPins() {
        if (!project || project.pins.length === 0) return
        project.pins = []
        void persist()
    }

    function pinLabel(pin: AssistantPin): string {
        const label = findSection(scopes, pin.ref)?.label ?? `${pin.ref} (없음)`
        return (pin.lines ? `${label} ${pin.lines[0]}-${pin.lines[1]}줄` : label).replaceAll('`', '')
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
        scrollTimer = setTimeout(saveScrollNow, 150)
    }

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
            const anchor = saved ? [...items].find((item) => item.dataset.messageId === saved.messageId) : undefined
            if (anchor && saved) log.scrollTop = anchor.offsetTop + saved.offset
            else {
                const last = items[items.length - 1]
                log.scrollTop = last ? last.offsetTop - parseFloat(getComputedStyle(log).paddingTop) : 0
            }
        }
        apply()
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

    async function copyWithFeedback(button: HTMLButtonElement, text: string) {
        const original = button.textContent
        let label = '복사됨'
        try { await copyText(text) }
        catch { label = '복사 실패' }
        button.textContent = label
        button.dataset.state = label === '복사됨' ? 'done' : 'failed'
        setTimeout(() => {
            button.textContent = original
            delete button.dataset.state
        }, 1600)
    }

    async function handleLogClick(event: MouseEvent) {
        const element = event.target as HTMLElement | null
        const reference = element?.closest<HTMLElement>('[data-section-ref]')
        if (reference?.dataset.sectionRef) {
            const messageId = reference.closest<HTMLElement>('[data-message-id]')?.dataset.messageId
            await openSection(reference.dataset.sectionRef, messageId)
            return
        }
        const button = element?.closest<HTMLButtonElement>('[data-copy-code]')
        if (!button) return
        await copyWithFeedback(button, button.closest('[data-code-block]')?.querySelector('pre')?.textContent ?? '')
    }

    async function load() {
        loading = true
        loadError = ''
        try {
            index = await loadCharacterAssistantIndex()
            const id = index.lastProjectId ?? index.projects[0]?.id
            project = id ? await loadCharacterAssistantProject(id) : null
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
            index = await saveCharacterAssistantProject($state.snapshot(project) as CharacterAssistantProject, index)
        }
        catch (cause) {
            saveError = `저장하지 못했습니다. ${errorText(cause)}`
        }
    }

    async function switchProject(id: string) {
        if (running || id === project?.id) return
        saveScrollNow()
        try {
            const next = await loadCharacterAssistantProject(id)
            if (!next) {
                notice = '프로젝트 파일을 찾지 못했습니다.'
                return
            }
            project = next
            formMode = 'none'
            closePanel()
            index = await rememberCharacterAssistantProject(id, index)
            await restoreScroll()
        }
        catch (cause) {
            notice = `프로젝트를 열지 못했습니다. ${errorText(cause)}`
        }
    }

    function startCreate() {
        const selected = $selectedCharID >= 0 ? DBState.db.characters[$selectedCharID]?.chaId : undefined
        const initial = characters.find((item) => item.chaId === selected) ?? characters[0]
        formMode = 'create'
        formCharacterId = initial?.chaId ?? ''
        formName = initial ? `${initial.name} 다듬기` : ''
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
            const found = findAssistantCharacter(formCharacterId)
            if (!found) return
            project = newCharacterAssistantProject(name, found.character)
            closePanel()
        }
        else if (project) {
            project.name = name
        }
        formMode = 'none'
        await persist()
    }

    async function removeProject() {
        if (!project || running) return
        if (!await alertConfirm(`'${project.name}' 프로젝트와 대화를 삭제할까요? 봇은 그대로 남습니다.`)) return
        try {
            index = await deleteCharacterAssistantProject(project.id, index)
            project = index.lastProjectId ? await loadCharacterAssistantProject(index.lastProjectId) : null
            closePanel()
            if (!project) startCreate()
            await restoreScroll()
        }
        catch (cause) {
            notice = `삭제하지 못했습니다. ${errorText(cause)}`
        }
    }

    async function resetConversation() {
        if (!project || running || project.messages.length === 0) return
        if (!await alertConfirm('이 프로젝트의 대화를 모두 지울까요? 프로젝트 설정과 재료는 그대로 남습니다.')) return
        project.messages = []
        notice = ''
        await persist()
    }

    function setModel(model: CharacterAssistantModel) {
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
        const source = collectCharacterAssistantSource($state.snapshot(project) as CharacterAssistantProject)
        if (!source) {
            notice = '이 프로젝트의 봇을 찾지 못했습니다. 삭제됐거나 비공개 라이선스 봇일 수 있습니다.'
            return
        }
        stopFollowingAnchor?.()
        notice = ''
        closePanel()
        running = true
        streamingText = ''
        lookupStatus = []
        controller = new AbortController()
        const signal = controller.signal
        const current = project
        const snapshot = $state.snapshot(current) as CharacterAssistantProject
        try {
            const chatLines = collectCharacterAssistantChatLines(snapshot)
            current.messages.push(createCharacterAssistantMessage('user', userText))
            if (text === draft) draft = ''
            await scrollToEnd()
            const result = await sendCharacterAssistant({
                project: snapshot,
                userText,
                source,
                chatLines,
                signal,
                onText: (value) => {
                    streamingText = value
                    void scrollToEnd()
                },
                onLookup: (labels, pins) => {
                    lookupStatus = [...lookupStatus, ...labels]
                    current.pins = pins
                    streamingText = ''
                    void persist()
                },
            })
            current.pins = result.pins
            const refNames = collectMentionNames(buildAssistantScopes(source), result.reply, current.includePreset)
            const extra = { refNames, lookups: result.lookups.length > 0 ? result.lookups : undefined }
            if (signal.aborted) {
                if (result.reply.trim()) current.messages.push(createCharacterAssistantMessage('assistant', result.reply, extra))
                notice = '응답을 중단했습니다.'
            }
            else if (!result.reply.trim()) {
                current.messages.push(createCharacterAssistantMessage('assistant', result.stalled
                    ? '비서가 자료만 요청하고 답하지 못했습니다. 목차에 없는 자료를 찾았거나 요청 횟수를 넘었을 수 있습니다. 질문을 좁혀 다시 보내 주세요.'
                    : '빈 응답을 받았습니다.', { failed: true }))
            }
            else {
                current.messages.push(createCharacterAssistantMessage('assistant', result.reply, extra))
            }
        }
        catch (cause) {
            if (signal.aborted) notice = '응답을 중단했습니다.'
            else current.messages.push(createCharacterAssistantMessage('assistant', errorText(cause), { failed: true }))
        }
        finally {
            running = false
            streamingText = ''
            lookupStatus = []
            controller = null
            if (project === current) {
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
        if (!project || scopes.length === 0) {
            estimate = null
            return
        }
        const { indexes, materials } = describeCharacterAssistantMaterial(scopes, project.pins)
        const material = [...indexes, ...materials].join('\n')
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

    $effect(() => {
        if (open) untrack(() => { if (collapsed) setCollapsed(false) })
    })

    $effect.pre(() => {
        if (!open || collapsed) untrack(saveScrollNow)
    })

    $effect(() => {
        if (open && !collapsed && !loading && panel === 'none') void restoreScroll()
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
    aria-label="캐릭터 비서"
    aria-hidden={!open}
    inert={!open}
    data-character-assistant
>
    <button
        type="button"
        class="rail"
        aria-label="캐릭터 비서 펼치기"
        title="펼치기"
        onclick={() => setCollapsed(false)}
        data-character-assistant-expand
    >
        <PanelRightOpenIcon size={18} />
        <span class="rail-title">캐릭터 비서</span>
        {#if running}<LoaderCircleIcon class="animate-spin" size={15} aria-label="답변을 받는 중" />{/if}
    </button>
    <button
        type="button"
        class="dock-resizer"
        aria-label="캐릭터 비서 폭 조절"
        onpointerdown={resize}
        onkeydown={resizeByKeyboard}
    ></button>

    <header class="dock-header">
        <div class="dock-titlebar">
            <span class="dock-mark"><BotIcon size={17} /></span>
            <strong>캐릭터 비서</strong>
            <span class="titlebar-spacer"></span>
            <button class="icon-button" type="button" aria-label="캐릭터 비서 접기" title="접기" onclick={() => setCollapsed(true)} data-character-assistant-collapse>
                <PanelRightCloseIcon size={18} />
            </button>
            <button class="icon-button" type="button" aria-label="캐릭터 비서 닫기" title="닫기" onclick={() => { saveScrollNow(); open = false }}>
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
                        data-character-assistant-project
                    >
                        {#each index.projects as item (item.id)}
                            <option value={item.id}>{item.name}</option>
                        {/each}
                    </select>
                    <button class="icon-button" type="button" aria-label="새 프로젝트" title="새 프로젝트" disabled={running} onclick={startCreate}><PlusIcon size={16} /></button>
                    <button class="icon-button" type="button" aria-label="프로젝트 이름 바꾸기" title="이름 바꾸기" disabled={running} onclick={startRename}><PencilIcon size={15} /></button>
                    <button class="icon-button danger" type="button" aria-label="프로젝트 삭제" title="프로젝트 삭제" disabled={running} onclick={() => void removeProject()}><TrashIcon size={15} /></button>
                </div>

                <p class="target-line" data-character-assistant-target>
                    <span>분석 대상</span>
                    {#if target}
                        <b>{target.name}</b>
                    {:else}
                        <b class="missing">{project.characterName || '이름 없음'} (찾을 수 없음)</b>
                    {/if}
                </p>

                <div class="settings-grid">
                    <label class="setting">
                        <span>참고용 봇</span>
                        <select
                            class="field"
                            bind:value={project.referenceId}
                            disabled={running}
                            onchange={() => void persist()}
                            data-character-assistant-reference
                        >
                            <option value="">없음</option>
                            {#if project.referenceId && !characters.some((item) => item.chaId === project?.referenceId)}
                                <option value={project.referenceId}>찾을 수 없는 봇</option>
                            {/if}
                            {#each characters.filter((item) => item.chaId !== project?.characterId) as item (item.chaId)}
                                <option value={item.chaId}>{item.name}</option>
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
                                max={CHARACTER_ASSISTANT_MAX_CHAT_MESSAGES}
                                step="1"
                                value={project.chatMessages}
                                disabled={running}
                                onchange={(event) => {
                                    if (!project) return
                                    project.chatMessages = clampAssistantChatCount(event.currentTarget.value)
                                    event.currentTarget.value = String(project.chatMessages)
                                    void persist()
                                }}
                                aria-label="함께 보낼 대상 봇 현재 챗의 최근 메시지 수"
                                data-character-assistant-chat-count
                            />
                            <small>개</small>
                        </span>
                    </label>
                    <div class="scope-checks">
                        <label class="setting check" title="이 봇에 켜진 모듈의 로어북, 정규식, 트리거를 목차에 넣습니다.">
                            <input type="checkbox" bind:checked={project.includeModules} disabled={running} onchange={() => void persist()} data-character-assistant-modules />
                            <span>연결된 모듈</span>
                        </label>
                        <label class="setting check" title="지금 사용 중인 프롬프트 프리셋의 블록 목록과 토글 정의, 현재 토글 값을 목차에 넣습니다.">
                            <input type="checkbox" bind:checked={project.includePreset} disabled={running} onchange={() => void persist()} data-character-assistant-preset />
                            <span>현재 프리셋과 토글</span>
                        </label>
                    </div>
                </div>

                <div class="pin-row" data-character-assistant-pins>
                    <span class="pin-title">재료 {project.pins.length}개</span>
                    <div class="pin-list">
                        {#each project.pins as pin (pinKey(pin))}
                            <span class="pin-chip" class:missing={!findSection(scopes, pin.ref)}>
                                <button type="button" class="pin-open" title={VIEW_TITLE} onclick={() => openViewer(pin.ref)}>{pinLabel(pin)}</button>
                                <button type="button" class="pin-remove" aria-label={`${pinLabel(pin)} 재료에서 빼기`} title="재료에서 빼기" disabled={running} onclick={() => removePin(pin)}><XIcon size={12} /></button>
                            </span>
                        {:else}
                            <span class="pin-empty">아직 없음. 비서가 필요한 자료를 직접 읽어 옵니다.</span>
                        {/each}
                    </div>
                    <div class="pin-actions">
                        <button type="button" class="text-button" disabled={running} onclick={() => { panel = panel === 'picker' ? 'none' : 'picker'; pickerQuery = '' }} aria-pressed={panel === 'picker'} data-character-assistant-picker-open>
                            <ListPlusIcon size={14} /> 자료 추가
                        </button>
                        {#if project.pins.length > 0}
                            <button type="button" class="text-button" disabled={running} onclick={clearPins}>모두 빼기</button>
                        {/if}
                    </div>
                </div>
                <p class="attach-summary" aria-live="polite">
                    <span>함께 보냄: {attachmentLabel}</span>
                    {#if estimate !== null}<span class="tabular">약 {estimate.toLocaleString()} 토큰{project.chatMessages > 0 ? ' + 챗' : ''}</span>{/if}
                </p>
            {:else if formMode !== 'none'}
                <form class="project-form" onsubmit={(event) => { event.preventDefault(); void submitForm() }} data-character-assistant-form>
                    <label class="setting">
                        <span>{formMode === 'create' ? '새 프로젝트 이름' : '프로젝트 이름'}</span>
                        <!-- svelte-ignore a11y_autofocus -->
                        <input class="field" bind:value={formName} maxlength="80" placeholder="예: 로어북 정리" autofocus />
                    </label>
                    {#if formMode === 'create'}
                        <label class="setting">
                            <span>다듬을 봇</span>
                            <select class="field" bind:value={formCharacterId} onchange={() => {
                                const picked = characters.find((item) => item.chaId === formCharacterId)
                                if (picked && (!formName.trim() || formName.endsWith(' 다듬기'))) formName = `${picked.name} 다듬기`
                            }}>
                                {#each characters as item (item.chaId)}
                                    <option value={item.chaId}>{item.name}{item.index === $selectedCharID ? ' (선택 중)' : ''}</option>
                                {/each}
                            </select>
                        </label>
                        {#if characters.length === 0}
                            <p class="notice">분석할 수 있는 봇이 없습니다. 비공개 라이선스 봇은 분석하지 않습니다.</p>
                        {/if}
                    {/if}
                    <div class="form-actions">
                        {#if project}
                            <ShButton variant="outline" size="sm" type="button" onclick={() => formMode = 'none'}><XIcon size={14} /> 취소</ShButton>
                        {/if}
                        <ShButton variant="primary" size="sm" type="submit" disabled={!formName.trim() || (formMode === 'create' && !formCharacterId)}>
                            <CheckIcon size={14} /> {formMode === 'create' ? '만들기' : '저장'}
                        </ShButton>
                    </div>
                </form>
            {/if}
        {/if}
    </header>

    {#if project && formMode === 'none' && panel !== 'none'}
        <section class="side-panel" aria-label={panel === 'picker' ? '자료 추가' : '자료 보기'} data-character-assistant-panel={panel}>
            <div class="panel-bar">
                <button class="icon-button" type="button" aria-label="대화로 돌아가기" title="대화로 돌아가기" onclick={closePanel}><ArrowLeftIcon size={16} /></button>
                {#if panel === 'picker'}
                    <input class="field panel-search" bind:value={pickerQuery} placeholder="이름, 키, 종류로 찾기" aria-label="자료 찾기" data-character-assistant-picker-search />
                {:else}
                    <strong class="panel-title">{viewerSection?.label.replaceAll('`', '') ?? '찾을 수 없는 자료'}</strong>
                {/if}
            </div>
            {#if panel === 'picker'}
                <ul class="picker-list">
                    {#each pickerSections.slice(0, 300) as section (section.ref)}
                        {@const pinned = project.pins.some((pin) => pin.ref === section.ref)}
                        <li class:pinned>
                            <button type="button" class="picker-pin" aria-pressed={pinned} title={pinned ? '재료에서 빼기' : '재료에 넣기'} onclick={() => togglePin(section.ref)}>
                                {#if pinned}<PinIcon size={14} />{:else}<PinOffIcon size={14} />{/if}
                            </button>
                            <button type="button" class="picker-item" title={VIEW_TITLE} onclick={() => openViewer(section.ref)}>
                                <span class="picker-label">{section.label.replaceAll('`', '')}</span>
                                {#if section.summary}<small>{section.summary}</small>{/if}
                            </button>
                        </li>
                    {:else}
                        <li class="picker-empty">{scopes.length === 0 ? '봇을 찾지 못했습니다.' : '맞는 자료가 없습니다.'}</li>
                    {/each}
                    {#if pickerSections.length > 300}
                        <li class="picker-empty">{pickerSections.length - 300}개가 더 있습니다. 검색어를 좁혀 주세요.</li>
                    {/if}
                </ul>
            {:else if viewerSection}
                <div class="viewer-actions">
                    {#if viewerSection.scope === 'bot' && (viewerSection.kind !== 'field' || FIELD_TABS[viewerSection.id] !== undefined) || viewerSection.kind === 'block'}
                        <ShButton variant="outline" size="sm" onclick={() => void openSection(viewerSection.ref)}><ExternalLinkIcon size={13} /> 편집기에서 열기</ShButton>
                    {/if}
                    <ShButton variant="outline" size="sm" disabled={running} onclick={() => togglePin(viewerSection.ref)}>
                        {#if project.pins.some((pin) => pin.ref === viewerSection.ref)}<PinOffIcon size={13} /> 재료에서 빼기{:else}<PinIcon size={13} /> 재료에 넣기{/if}
                    </ShButton>
                    <button type="button" class="text-button" onclick={(event) => void copyWithFeedback(event.currentTarget, viewerSection.text)}>복사</button>
                    {#if viewerSection.scope !== 'bot'}<span class="readonly-note">읽기 전용 자료</span>{/if}
                </div>
                <pre class="viewer-text">{viewerSection.text}</pre>
            {:else}
                <p class="picker-empty">이 자료를 지금 목차에서 찾지 못했습니다. 삭제됐거나 범위가 꺼져 있을 수 있습니다.</p>
            {/if}
        </section>
    {/if}

    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <div class="log" class:hidden-by-panel={panel !== 'none' && !!project && formMode === 'none'} bind:this={logElement} aria-live="polite" onscroll={rememberScroll} onclick={(event) => void handleLogClick(event)} data-character-assistant-log>
        {#if loading}
            <div class="state"><LoaderCircleIcon class="animate-spin" size={18} /> 프로젝트를 불러오는 중입니다.</div>
        {:else if loadError}
            <div class="state failure">
                <p>프로젝트 목록을 불러오지 못했습니다. {loadError}</p>
                <ShButton variant="outline" size="sm" onclick={() => void load()}><RotateCcwIcon size={14} /> 다시 시도</ShButton>
            </div>
        {:else if !project}
            <div class="state">
                <p>프로젝트를 만들면 대화가 그 이름으로 저장됩니다. 프로젝트는 만들 때 고른 봇에 고정되어, 다른 캐릭터를 선택해도 분석 대상이 바뀌지 않습니다.</p>
            </div>
        {:else if project.messages.length === 0 && !running}
            <div class="empty">
                <p class="empty-lead">봇에서 다듬고 싶은 부분을 말해 주세요.</p>
                <p>비서는 <b>{target?.name ?? '대상 봇'}</b>의 목차만 먼저 보고, 질문에 필요한 필드와 로어북, 정규식, 트리거만 골라 읽습니다. 읽은 자료는 위의 재료에 남고, 직접 넣거나 뺄 수도 있습니다. 봇의 내용은 비서의 지시로 쓰이지 않으며, 수정은 직접 반영합니다.</p>
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
                        {#if message.lookups?.length}
                            <span class="attached" title={message.lookups.join('\n').replaceAll('`', '')}>읽은 자료 {message.lookups.length}개</span>
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
                    {#if lookupStatus.length > 0}
                        <ul class="lookup-status" data-character-assistant-lookups>
                            {#each lookupStatus as label}
                                <li>{label.replaceAll('`', '')}</li>
                            {/each}
                        </ul>
                    {/if}
                    {#if streamingText && !/^\s*<(read|search)\b/i.test(streamingText)}
                        <div class="markdown">{@html renderMarkdown(streamingText)}</div>
                    {:else}
                        <p class="body waiting"><LoaderCircleIcon class="animate-spin" size={14} /> {lookupStatus.length > 0 ? '읽은 자료로 다시 생각하는 중입니다.' : '목차를 살펴보는 중입니다.'}</p>
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
                placeholder="예: 첫 메시지가 너무 길어. 어디를 줄이면 좋을까?"
                aria-label="캐릭터 비서에게 보낼 메시지"
                onkeydown={(event) => {
                    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                        event.preventDefault()
                        void send()
                    }
                }}
                data-character-assistant-input
            ></textarea>
            <div class="composer-actions">
                <button
                    class="text-button"
                    type="button"
                    disabled={running || project.messages.length === 0}
                    onclick={() => void resetConversation()}
                    data-character-assistant-reset
                ><RotateCcwIcon size={14} /> 대화 초기화</button>
                <span class="hint">Ctrl+Enter로 보내기</span>
                {#if running}
                    <ShButton variant="outline" size="sm" onclick={stop} data-character-assistant-stop><SquareIcon size={13} /> 중단</ShButton>
                {:else}
                    <ShButton variant="primary" size="sm" disabled={!draft.trim() || !target} onclick={() => void send()} data-character-assistant-send>
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
        min-width: min(18rem, 100%);
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
    .markdown :global(:not([data-code-actions]) > button[data-block-ref]),
    .markdown :global(button[data-block-name]) {
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
    .markdown :global(:not([data-code-actions]) > button[data-block-ref]:focus-visible),
    .markdown :global(button[data-block-name]:hover),
    .markdown :global(button[data-block-name]:focus-visible) {
        text-decoration-thickness: 2px;
        outline: 0;
    }
    .markdown :global(button[data-block-name] code) { color: inherit; }
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

    .target-line {
        display: flex;
        align-items: baseline;
        gap: .5rem;
        min-width: 0;
        margin: 0;
        font-size: .74rem;
    }
    .target-line span { flex: 0 0 auto; color: var(--risu-theme-textcolor2); font-size: .68rem; font-weight: 600; }
    .target-line b { min-width: 0; overflow: hidden; font-weight: 700; text-overflow: ellipsis; white-space: nowrap; }
    .target-line b.missing { color: var(--risu-theme-draculared); }
    .scope-checks { grid-column: 1 / -1; display: flex; flex-wrap: wrap; gap: .3rem 1rem; }
    .scope-checks .setting.check { grid-column: auto; }

    .pin-row { display: grid; grid-template-columns: auto minmax(0, 1fr); align-items: start; gap: .3rem .5rem; }
    .pin-title { padding-top: .3rem; color: var(--risu-theme-textcolor2); font-size: .68rem; font-weight: 600; white-space: nowrap; }
    .pin-list {
        display: flex;
        flex-wrap: wrap;
        gap: .25rem;
        min-width: 0;
        max-height: 4.4rem;
        overflow-y: auto;
        scrollbar-width: thin;
    }
    .pin-chip {
        display: inline-flex;
        align-items: center;
        max-width: 100%;
        min-height: 1.6rem;
        border: 1px solid var(--pa-line);
        border-radius: .35rem;
        background: color-mix(in srgb, var(--risu-theme-primary) 6%, transparent);
    }
    .pin-chip.missing { border-style: dashed; opacity: .7; }
    .pin-open {
        min-width: 0;
        overflow: hidden;
        padding: 0 .1rem 0 .45rem;
        border: 0;
        color: var(--risu-theme-textcolor);
        background: none;
        font-size: .7rem;
        text-overflow: ellipsis;
        white-space: nowrap;
        cursor: pointer;
    }
    .pin-remove {
        display: grid;
        flex: 0 0 auto;
        width: 1.5rem;
        height: 1.5rem;
        place-items: center;
        border: 0;
        color: var(--risu-theme-textcolor2);
        background: none;
        cursor: pointer;
    }
    .pin-open:hover, .pin-open:focus-visible { color: var(--risu-theme-primary); outline: 0; }
    .pin-remove:hover:not(:disabled), .pin-remove:focus-visible { color: var(--risu-theme-draculared); outline: 0; }
    .pin-remove:disabled { cursor: not-allowed; opacity: .42; }
    .pin-empty { padding-top: .3rem; color: var(--risu-theme-textcolor2); font-size: .68rem; line-height: 1.4; }
    .pin-actions { grid-column: 2; display: flex; flex-wrap: wrap; gap: .2rem; }
    .pin-actions .text-button { min-height: 1.75rem; }

    .side-panel { display: flex; flex: 1 1 auto; flex-direction: column; min-height: 0; overflow: hidden; }
    .log.hidden-by-panel { display: none; }
    .panel-bar {
        display: flex;
        align-items: center;
        gap: .4rem;
        padding: .45rem .6rem;
        border-bottom: 1px solid var(--risu-theme-darkborderc);
    }
    .panel-search { flex: 1 1 auto; }
    .panel-title { min-width: 0; overflow: hidden; font-size: .78rem; text-overflow: ellipsis; white-space: nowrap; }
    .picker-list { flex: 1 1 auto; min-height: 0; margin: 0; padding: .3rem .4rem .8rem; overflow-y: auto; list-style: none; scrollbar-width: thin; }
    .picker-list li { display: flex; align-items: flex-start; gap: .2rem; border-radius: .35rem; }
    .picker-list li.pinned { background: color-mix(in srgb, var(--risu-theme-primary) 7%, transparent); }
    .picker-pin {
        display: grid;
        flex: 0 0 auto;
        width: 2rem;
        height: 2rem;
        place-items: center;
        border: 0;
        border-radius: .35rem;
        color: var(--risu-theme-textcolor2);
        background: none;
        cursor: pointer;
    }
    .picker-list li.pinned .picker-pin { color: var(--risu-theme-primary); }
    .picker-item {
        display: grid;
        flex: 1 1 auto;
        gap: .1rem;
        min-width: 0;
        padding: .4rem .3rem;
        border: 0;
        border-radius: .35rem;
        color: var(--risu-theme-textcolor);
        text-align: left;
        background: none;
        cursor: pointer;
    }
    .picker-pin:hover, .picker-pin:focus-visible,
    .picker-item:hover, .picker-item:focus-visible { background: color-mix(in srgb, var(--risu-theme-primary) 9%, transparent); outline: 0; }
    .picker-label { overflow-wrap: anywhere; font-size: .76rem; font-weight: 600; line-height: 1.35; }
    .picker-item small { color: var(--risu-theme-textcolor2); font-size: .66rem; line-height: 1.4; overflow-wrap: anywhere; }
    .picker-empty { padding: .8rem .6rem; color: var(--risu-theme-textcolor2); font-size: .74rem; line-height: 1.5; }
    .viewer-actions { display: flex; flex-wrap: wrap; align-items: center; gap: .35rem; padding: .5rem .7rem; }
    .readonly-note { color: var(--risu-theme-textcolor2); font-size: .68rem; }
    .viewer-text {
        flex: 1 1 auto;
        min-height: 0;
        margin: 0 .7rem .8rem;
        padding: .65rem .75rem;
        overflow: auto;
        border: 1px solid var(--risu-theme-darkborderc);
        border-radius: .45rem;
        background: color-mix(in srgb, var(--risu-theme-darkbg) 80%, var(--color-darkbg));
        font: .74rem/1.55 ui-monospace, SFMono-Regular, Consolas, monospace;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
    }
    .lookup-status { display: grid; gap: .15rem; margin: 0; padding-left: 1.1rem; color: var(--risu-theme-textcolor2); font-size: .72rem; list-style: disc; }
    .markdown :global(button[data-section-ref]) {
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
    .markdown :global(button[data-section-ref]:hover),
    .markdown :global(button[data-section-ref]:focus-visible) { text-decoration-thickness: 2px; outline: 0; }
    .markdown :global(button[data-section-ref] code) { color: inherit; }

    @container (max-width: 26rem) {
        .settings-grid { grid-template-columns: minmax(0, 1fr) auto; }
        .settings-grid > .setting:first-child { grid-column: 1 / -1; }
    }
    @container (max-width: 22rem) {
        .hint { display: none; }
        .composer-actions { justify-content: space-between; }
        .dock-header, .log, .composer { padding-inline: .55rem; }
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
