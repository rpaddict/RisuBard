<script lang="ts">
    import { tick } from 'svelte'
    import markdownit from 'markdown-it'
    import {
        countWikiBacklinks,
        describeWikiLinkTarget,
        wikiLinkPlugin,
        type WikiLinkRenderResolution,
        type WikiLinkResolution,
    } from 'src/ts/risubard/wikiLink'
    import {
        FileIcon,
        FileLock2Icon,
        BookCopyIcon,
        Minimize2Icon,
        FolderIcon,
        FolderOpenIcon,
        RotateCcwIcon,
        SaveIcon,
        Trash2Icon,
        PlusIcon,
        ChevronDownIcon,
        Maximize2Icon,
        Minimize2,
        LocateFixedIcon,
        SearchIcon,
        PinIcon,
        CircleOffIcon,
        CheckIcon,
    } from '@lucide/svelte'
    import ShButton from 'src/lib/UI/GUI/ShButton.svelte'
    import { canCompressCanonDocument } from 'src/ts/risubard/canonCompression'
    import { v4 } from 'uuid'
    import { forageStorage, requestImmediateSave, trackCharacterForSave } from 'src/ts/globalApi.svelte'
    import { DBState } from 'src/ts/stores.svelte'
    import { alertConfirm, alertConfirmMulti } from 'src/ts/alert'
    import {
        saveManualWikiDocument,
        setWikiDocumentContextMode,
        revealWikiDocument,
        retractWikiEvent,
        trashWikiDocument,
        type MarkdownWikiDocumentType,
        type NarrativeMemoryWikiMarkdown,
        type WikiCatalogDocument,
    } from 'src/ts/risubard/memoryWiki'
    import { matchesWikiSearch } from 'src/ts/risubard/wikiSearch'
    import {
        buildWikiFileTree,
        filterWikiDocumentsByType,
        getRecentlyUpdatedWikiDocumentIds,
        listWikiDocumentTypes,
        wikiDocumentTypeLabels,
        wikiFolderDisplayName,
        type WikiFileTreeNode,
        type WikiTreeSort,
    } from 'src/ts/risubard/wikiFileTree'
    import { publishRisuBardMemoryActivity } from 'src/ts/risubard/memoryActivity'
    import { copyWikiDocumentToLorebook } from 'src/ts/risubard/wikiLorebookCopy'
    import { normalizeMemoryWikiTreeHeight, normalizeMemoryWikiTreeWidth } from 'src/ts/risubard/memoryWikiLayout'
    import { rankWikiLinkCandidates, relinkWikiLink } from 'src/ts/risubard/wikiLinkRepair'
    import { formatStoryTimeLabel } from '../../../server/node/risubard-memory-metadata'
    import type { StorySourceRef } from 'src/ts/risubard/storySoFar'
    import { createEventOrder, type EventOrderMessage } from 'src/ts/risubard/eventOrder'

    // Catalog entries from the dock carry no body until it has been fetched.
    type WikiDocument = WikiCatalogDocument
    const contextLabels = {
        always: '항상 컨텍스트에 포함',
        auto: '관련 있을 때 포함',
        never: '자동 컨텍스트에서 제외',
    }
    const contextSegments = [
        { mode: 'always', label: '항상' },
        { mode: 'auto', label: '자동' },
        { mode: 'never', label: '제외' },
    ] as const

    interface Props {
        characterId: string
        chatId: string
        documents: WikiDocument[]
        messages?: readonly EventOrderMessage[]
        health?: NarrativeMemoryWikiMarkdown['health']
        locked?: boolean
        mobileLayout?: boolean
        /** Desktop focus view: fold the type, name and alias fields into the action row. */
        compact?: boolean
        fieldsExpanded?: boolean
        onFieldsExpandedChange?: (expanded: boolean) => void
        selectedId?: string
        onChanged?: () => void | Promise<void>
        onSelected?: (documentId: string) => void
        onFocusModeChange?: (focused: boolean) => void
        onNavigateSource?: (source: StorySourceRef) => void
        /** Opens the canon compression dialog for the selected page. */
        onCompress?: (documentId: string) => void
        highlightedDocumentIds?: string[] | null
        /** Asks the dock to fetch a body missing from a catalog entry. */
        onRequestBody?: (documentId: string) => void
        /** Server-side full-text search; without it the loaded bodies are searched. */
        onSearch?: (query: string) => Promise<Set<string>>
        /** Reports whether the editor holds an unsaved draft, so the host can guard view switches. */
        onDirtyChange?: (dirty: boolean) => void
    }

    let {
        characterId,
        chatId,
        documents,
        messages,
        health = {
            danglingLinks: [], unlinkedDocumentIds: [], duplicatePassages: [],
        },
        locked = false,
        mobileLayout = false,
        compact = false,
        fieldsExpanded = false,
        onFieldsExpandedChange,
        selectedId = $bindable(''),
        onChanged,
        onSelected,
        onFocusModeChange,
        onNavigateSource,
        onCompress,
        highlightedDocumentIds = null,
        onRequestBody,
        onSearch,
        onDirtyChange,
    }: Props = $props()
    let creating = $state(false)
    // 새 문서는 이름을 입력해야 하므로 집중 보기에서도 입력 줄을 보여 준다.
    let showFields = $derived(!compact || fieldsExpanded || creating)
    let type = $state<MarkdownWikiDocumentType>('character')
    let title = $state('')
    let aliasesText = $state('')
    let markdown = $state('')
    let saving = $state(false)
    let error = $state('')
    let notice = $state('')
    let wikiLinkDiagnostic = $state<{ status: 'missing' | 'ambiguous'; message: string } | null>(null)
    let loadedDocumentId = $state('')
    let loadedContentHash = $state('')
    let loadedType = $state<MarkdownWikiDocumentType>('character')
    let loadedTitle = $state('')
    let loadedAliasesText = $state('')
    let loadedMarkdown = $state('')
    let contextDocumentId = $state('')
    let contextX = $state(0)
    let contextY = $state(0)
    let contextMenuElement = $state<HTMLElement | null>(null)
    let contextOpener: HTMLElement | null = null
    let wikiEditorElement = $state<HTMLElement | null>(null)
    let treeExpanded = $state(false)
    let editorExpanded = $state(true)
    let editorFocus = $state(false)
    let markdownPreview = $state(
        DBState.db.risuBardWikiMarkdownPreview === true
    )
    let searchDraft = $state('')
    let searchQuery = $state('')
    let searchMatchIds = $state<Set<string> | null>(null)
    let typeFilter = $state<MarkdownWikiDocumentType | null>(null)
    let treeSort = $state<WikiTreeSort>('name')
    // Long chats put thousands of events in one folder; render them in pages.
    const folderPageSize = 100
    let folderLimits = $state<Record<string, number>>({})
    let markdownTextarea = $state<HTMLTextAreaElement | null>(null)
    let treeHeight = $state(normalizeMemoryWikiTreeHeight(undefined))
    let treeWidth = $state(normalizeMemoryWikiTreeWidth(DBState.db.risuBardWikiTreeWidth))
    // A missing link the user is reconnecting, and whether the file tree picks its new target.
    let linkRepair = $state<{ sourceId: string; target: string } | null>(null)
    let pickingLinkTarget = $state(false)
    let danglingListOpen = $state(false)
    let restoredTreeExpanded = false
    let restoredEditorExpanded = true

    function setMarkdownPreview(event: Event) {
        markdownPreview = (event.currentTarget as HTMLInputElement).checked
        DBState.db.risuBardWikiMarkdownPreview = markdownPreview
        if (!markdownPreview) wikiLinkDiagnostic = null
    }

    function wikiLinkDescription(target: string, resolution: WikiLinkResolution): string {
        if (resolution.status === 'missing') return `연결된 문서가 없습니다: ${target}`
        if (resolution.status !== 'ambiguous') return ''
        const titleCounts = new Map<string, number>()
        for (const owner of resolution.owners) {
            titleCounts.set(owner.title, (titleCounts.get(owner.title) ?? 0) + 1)
        }
        const owners = resolution.owners.map((owner) =>
            (titleCounts.get(owner.title) ?? 0) > 1
                ? `${owner.title} (${owner.relativePath})`
                : owner.title
        )
        return `이름이 겹칩니다: ${owners.join(', ')}`
    }

    function wikiLinkPresentation(target: string): WikiLinkRenderResolution {
        const resolution = describeWikiLinkTarget(target, documents)
        if (resolution.status === 'resolved') return { status: 'resolved' }
        return {
            status: resolution.status,
            description: wikiLinkDescription(target, resolution),
        }
    }

    function documentMatchesSearch(document: WikiDocument, query: string): boolean {
        if (!query) return true
        if (searchMatchIds) return searchMatchIds.has(document.id)
        return matchesWikiSearch({ ...document, content: document.content ?? '' }, query)
    }

    function renderHighlightedText(value: string, query: string): string {
        const escaped = (text: string) => text
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
        if (!query) return escaped(value)
        const lowerValue = value.toLocaleLowerCase()
        const lowerQuery = query.toLocaleLowerCase()
        let cursor = 0
        let result = ''
        while (cursor < value.length) {
            const index = lowerValue.indexOf(lowerQuery, cursor)
            if (index < 0) {
                result += escaped(value.slice(cursor))
                break
            }
            result += escaped(value.slice(cursor, index))
            result += `<mark class="wiki-search-highlight" data-wiki-search-highlight>${escaped(
                value.slice(index, index + query.length)
            )}</mark>`
            cursor = index + query.length
        }
        return result
    }

    function highlightEditorMatch() {
        if (!markdownTextarea || !searchQuery || markdownPreview) return
        const index = markdown.toLocaleLowerCase().indexOf(
            searchQuery.toLocaleLowerCase()
        )
        if (index < 0) return
        markdownTextarea.focus()
        markdownTextarea.setSelectionRange(index, index + searchQuery.length)
    }

    async function applyWikiSearch(event?: SubmitEvent) {
        event?.preventDefault()
        searchQuery = searchDraft.trim()
        folderLimits = {}
        searchMatchIds = null
        if (searchQuery && onSearch) {
            const query = searchQuery
            try {
                const matched = await onSearch(query)
                if (query !== searchQuery) return
                searchMatchIds = matched
            }
            catch (cause) {
                error = cause instanceof Error ? cause.message : String(cause)
            }
        }
        if (searchQuery) {
            const matches = documents.filter((document) =>
                documentMatchesSearch(document, searchQuery)
            )
            const target = matches.find((document) => document.id === selectedId)
                ?? matches[0]
            if (target && target.id !== selectedId && !dirty) void selectDocument(target)
        }
        await tick()
        highlightEditorMatch()
    }

    function setTypeFilter(value: MarkdownWikiDocumentType | null) {
        typeFilter = value
        folderLimits = {}
    }

    // The native clear button fires `search`, which Svelte's input props do not type.
    function listenNativeSearchClear(node: HTMLInputElement) {
        node.addEventListener('search', clearEmptySearch)
        return { destroy: () => node.removeEventListener('search', clearEmptySearch) }
    }

    // Emptying the box (typing or the native clear button) drops the filter at once.
    function clearEmptySearch(event: Event) {
        if ((event.currentTarget as HTMLInputElement).value.trim() || !searchQuery) return
        searchQuery = ''
        searchMatchIds = null
        folderLimits = {}
    }

    // Rebuilt when documents change so the plugin can flag links whose target
    // no longer exists.
    let markdownRenderer = $derived.by(() => {
        const renderer = markdownit({
            html: false,
            breaks: false,
            linkify: false,
            typographer: true,
        })
        renderer.use(wikiLinkPlugin, {
            resolve: wikiLinkPresentation,
        })
        if (searchQuery) {
            renderer.renderer.rules.text = (tokens, index) =>
                renderHighlightedText(tokens[index].content, searchQuery)
        }
        return renderer
    })

    // Rendered markdown is injected as HTML, so its links cannot carry Svelte
    // handlers; the preview container delegates for them instead.
    function activateWikiLink(event: Event) {
        const anchor = (event.target as HTMLElement | null)
            ?.closest?.('[data-wikilink]')
        if (!anchor) return
        event.preventDefault()
        const target = anchor.getAttribute('data-wikilink') ?? ''
        const resolution = describeWikiLinkTarget(target, documents)
        if (resolution.status === 'resolved') {
            wikiLinkDiagnostic = null
            void selectDocument(resolution.document)
            return
        }
        error = ''
        notice = ''
        wikiLinkDiagnostic = {
            status: resolution.status,
            message: wikiLinkDescription(target, resolution),
        }
        if (resolution.status === 'missing' && selected && !creating) {
            linkRepair = { sourceId: selected.id, target }
        }
    }

    let eventSequences = $derived(new Map(documents
        .filter((document) => document.type === 'event' && document.sequence !== undefined)
        .map((document) => [document.id, document.sequence!])))
    let repairCandidates = $derived(linkRepair
        ? rankWikiLinkCandidates(linkRepair.target,
            documents.filter((document) => document.id !== linkRepair!.sourceId), 4)
        : [])

    function closeLinkRepair() {
        linkRepair = null
        pickingLinkTarget = false
        wikiLinkDiagnostic = null
    }

    function candidateLabel(document: { id: string; title: string; sequence?: number }): string {
        const sequence = eventSequences.get(document.id) ?? document.sequence
        return sequence === undefined ? document.title : `#${sequence} ${document.title}`
    }

    /** Points the open document's missing link at another document and saves a clean page at once. */
    async function relinkTo(documentId: string) {
        const repair = linkRepair
        const target = documents.find((document) => document.id === documentId)
        if (!repair || !target || readOnly || saving || selected?.id !== repair.sourceId) return
        // A title several documents share would stay ambiguous; link those by id and keep the wording.
        const byTitle = describeWikiLinkTarget(target.title, documents).status === 'resolved'
            && !/[\[\]|#\n]/u.test(target.title)
        const wasDirty = dirty
        const result = relinkWikiLink(markdown, repair.target, byTitle ? target.title : target.id,
            { keepWording: !byTitle })
        if (result.count === 0) {
            error = `본문에서 [[${repair.target}]] 링크를 찾지 못했습니다.`
            return
        }
        markdown = result.markdown
        closeLinkRepair()
        if (wasDirty) {
            notice = `링크 ${result.count}개를 “${target.title}”에 연결했습니다. 저장하면 반영됩니다.`
            return
        }
        if (await save()) notice = `링크 ${result.count}개를 “${target.title}”에 연결하고 저장했습니다.`
    }

    async function openDanglingLink(link: { sourceId: string; target: string }) {
        const source = documents.find((document) => document.id === link.sourceId)
        if (!source) return
        danglingListOpen = false
        if (source.id !== selectedId || creating) {
            if (dirty && !await confirmDiscardDraft()) return
            loadDocument(source)
        }
        treeExpanded = false
        editorExpanded = true
        markdownPreview = true
        error = ''
        notice = ''
        wikiLinkDiagnostic = { status: 'missing', message: `연결된 문서가 없습니다: ${link.target}` }
        linkRepair = { sourceId: source.id, target: link.target }
    }

    function chooseTreeDocument(documentId: string) {
        if (pickingLinkTarget) {
            void relinkTo(documentId)
            return
        }
        const document = documents.find((item) => item.id === documentId)
        if (document) void selectDocument(document).then(() => tick()).then(highlightEditorMatch)
    }

    function onWikiLinkKeydown(event: KeyboardEvent) {
        if (event.key !== 'Enter' && event.key !== ' ') return
        activateWikiLink(event)
    }

    let presentTypes = $derived(listWikiDocumentTypes(documents))
    let activeTypeFilter = $derived(typeFilter && presentTypes.includes(typeFilter) ? typeFilter : null)
    let filteredDocuments = $derived(filterWikiDocumentsByType(documents, activeTypeFilter)
        .filter((document) => documentMatchesSearch(document, searchQuery)))
    let contextModes = $derived(new Map(documents
        .filter((document) => document.type !== 'event' && document.type !== 'scene')
        .map((document) => [document.id, document.contextMode ?? 'auto'])))

    function documentLabel(documentId: string, title: string, readOnly = false) {
        const mode = contextModes.get(documentId)
        return [title, readOnly ? '읽기 전용' : '', mode ? contextLabels[mode] : '']
            .filter(Boolean).join(', ')
    }
    let tree = $derived(buildWikiFileTree(filteredDocuments, messages, { sort: treeSort }).filter((node) =>
        (!searchQuery && !activeTypeFilter && documents.length > 0)
            || node.kind === 'file' || node.children.length > 0
    ))
    function visibleFolderChildren(path: string, children: WikiFileTreeNode[]) {
        const selectedIndex = children.findIndex((child) =>
            child.kind === 'file' && child.documentId === selectedId)
        return children.slice(0, Math.max(folderLimits[path] ?? folderPageSize, selectedIndex + 1))
    }
    function showMoreInFolder(path: string, shown: number) {
        folderLimits = { ...folderLimits, [path]: shown + folderPageSize }
    }
    let recentlyUpdatedIds = $derived(highlightedDocumentIds === null
        ? getRecentlyUpdatedWikiDocumentIds(documents)
        : new Set(highlightedDocumentIds))
    let danglingSourceIds = $derived(new Set(
        health.danglingLinks.map((link) => link.sourceId)
    ))
    let duplicateDocumentIds = $derived(new Set(
        (health.duplicatePassages ?? []).flatMap((passage) => passage.documentIds)
    ))
    let selected = $derived(
        documents.find((document) => document.id === selectedId) ?? null
    )
    // A catalog entry was selected and its body is still on the way.
    let bodyPending = $derived(!creating && !!selected && selected.content === undefined)
    let readOnly = $derived(locked || bodyPending)
    let contextDocument = $derived(
        documents.find((document) => document.id === contextDocumentId) ?? null
    )
    let dirty = $derived(creating
        ? title.trim().length > 0 || markdown.trim().length > 0
        : !!selected && (title !== loadedTitle
            || aliasesText !== loadedAliasesText
            || type !== loadedType
            || markdown !== loadedMarkdown))
    // Analysis replaced the open document while the user held a draft of it.
    let conflict = $derived(!creating && !!selected && dirty
        && selected.id === loadedDocumentId
        && selected.contentHash !== loadedContentHash)
    let empty = $derived(documents.length === 0 && !creating)
    let canContextMode = $derived(!creating && !!selected
        && selected.type !== 'event' && selected.type !== 'scene')
    let saveTitle = $derived(!title.trim() ? '이름을 입력해야 저장할 수 있습니다'
        : !markdown.trim() ? '본문을 입력해야 저장할 수 있습니다' : '저장')
    let sourceMeta = $derived.by(() => {
        if (creating || !selected) return []
        const parts: string[] = []
        if (selected.type === 'event' && messages) {
            const index = createEventOrder(messages).position(selected)
            if (index === undefined) parts.push('출처 없음')
            else if (messages[index]?.role === 'char') {
                const turn = messages.slice(0, index + 1).filter((message) => message.role === 'char').length
                parts.push(`${turn}번째 응답`)
            }
            else parts.push(`${index + 1}번째 메시지`)
        }
        parts.push(`출처 메시지 ${selected.sourceMessageIds.length}개`)
        const updated = relativeTime(selected.updated)
        if (updated) parts.push(`${updated} 수정`)
        return parts
    })

    $effect(() => {
        onDirtyChange?.(dirty)
    })

    function relativeTime(value: string | undefined): string {
        const timestamp = Date.parse(value ?? '')
        if (!Number.isFinite(timestamp)) return ''
        const minutes = Math.floor((Date.now() - timestamp) / 60_000)
        if (minutes < 1) return '방금'
        if (minutes < 60) return `${minutes}분 전`
        if (minutes < 60 * 24) return `${Math.floor(minutes / 60)}시간 전`
        if (minutes < 60 * 24 * 30) return `${Math.floor(minutes / 60 / 24)}일 전`
        return new Date(timestamp).toLocaleDateString('ko-KR')
    }

    function loadDocument(document: WikiDocument) {
        if (linkRepair && linkRepair.sourceId !== document.id) closeLinkRepair()
        if (document.content === undefined) {
            // Show the selection at once; the body arrives through the documents prop.
            selectedId = document.id
            creating = false
            type = document.type
            title = document.title
            aliasesText = (document.aliases ?? []).join(', ')
            markdown = ''
            loadedDocumentId = ''
            error = ''
            notice = ''
            wikiLinkDiagnostic = null
            onRequestBody?.(document.id)
            return
        }
        selectedId = document.id
        creating = false
        type = document.type
        title = document.title
        aliasesText = (document.aliases ?? []).join(', ')
        markdown = document.content
        loadedDocumentId = document.id
        loadedContentHash = document.contentHash
        loadedType = document.type
        loadedTitle = document.title
        loadedAliasesText = aliasesText
        loadedMarkdown = document.content
        error = ''
        notice = ''
        if (!linkRepair) wikiLinkDiagnostic = null
        onSelected?.(document.id)
    }

    /** Resolves true when the draft may be replaced: clean, saved, or discarded. */
    async function confirmDiscardDraft(): Promise<boolean> {
        if (!dirty) return true
        const choice = await alertConfirmMulti(
            '저장하지 않은 변경이 있습니다.',
            [
                { label: '저장', variant: 'primary' },
                { label: '저장하지 않고 이동', variant: 'secondary' },
            ],
            '저장하지 않고 이동하면 지금 편집한 내용이 사라집니다.'
        )
        if (choice === 0) return await save()
        return choice === 1
    }

    async function selectDocument(document: WikiDocument) {
        // Reselecting the open document must not reload over its draft.
        if (document.id === selectedId && !creating && dirty) {
            treeExpanded = false
            editorExpanded = true
            return
        }
        // A clean editor switches synchronously; only a draft waits for the dialog.
        if (dirty && !await confirmDiscardDraft()) return
        loadDocument(document)
        treeExpanded = false
        editorExpanded = true
    }

    async function startNew() {
        if (locked) return
        if (dirty && !await confirmDiscardDraft()) return
        resetNewDraft()
    }

    function resetNewDraft() {
        closeLinkRepair()
        selectedId = ''
        creating = true
        type = 'character'
        title = ''
        aliasesText = ''
        markdown = ''
        error = ''
        notice = ''
        treeExpanded = false
        editorExpanded = true
    }

    function availableTreeHeight(): number {
        const height = wikiEditorElement?.clientHeight ?? 0
        return height > 0 ? height : 10_000
    }

    function setTreeHeight(value: number, availableHeight = availableTreeHeight()) {
        treeHeight = normalizeMemoryWikiTreeHeight(value, availableHeight)
    }

    function resizeTree(event: PointerEvent) {
        event.preventDefault()
        if (!wikiEditorElement) return
        const bounds = wikiEditorElement.getBoundingClientRect()
        if (bounds.height <= 0) return
        const update = (move: PointerEvent) => {
            setTreeHeight(move.clientY - bounds.top - 44, bounds.height - 88)
        }
        const stop = () => {
            window.removeEventListener('pointermove', update)
            window.removeEventListener('pointerup', stop)
        }
        window.addEventListener('pointermove', update)
        window.addEventListener('pointerup', stop, { once: true })
    }

    function resizeTreeByKeyboard(event: KeyboardEvent) {
        if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
        event.preventDefault()
        setTreeHeight(treeHeight + (event.key === 'ArrowDown' ? 24 : -24))
    }

    function resizeTreeWidth(event: PointerEvent) {
        event.preventDefault()
        if (!wikiEditorElement) return
        const bounds = wikiEditorElement.getBoundingClientRect()
        if (bounds.width <= 0) return
        const update = (move: PointerEvent) => {
            treeWidth = normalizeMemoryWikiTreeWidth(move.clientX - bounds.left, bounds.width)
        }
        const stop = () => {
            window.removeEventListener('pointermove', update)
            DBState.db.risuBardWikiTreeWidth = treeWidth
        }
        window.addEventListener('pointermove', update)
        window.addEventListener('pointerup', stop, { once: true })
    }

    function resizeTreeWidthByKeyboard(event: KeyboardEvent) {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
        event.preventDefault()
        treeWidth = normalizeMemoryWikiTreeWidth(treeWidth + (event.key === 'ArrowRight' ? 24 : -24),
            wikiEditorElement?.clientWidth || undefined)
        DBState.db.risuBardWikiTreeWidth = treeWidth
    }

    function setEditorFocus(focused: boolean) {
        if (focused === editorFocus) return
        if (focused) {
            restoredTreeExpanded = treeExpanded
            restoredEditorExpanded = editorExpanded
            treeExpanded = false
            editorExpanded = true
        }
        else {
            treeExpanded = restoredTreeExpanded
            editorExpanded = restoredEditorExpanded
        }
        editorFocus = focused
        onFocusModeChange?.(focused)
    }

    async function openContextMenu(event: MouseEvent, documentId: string) {
        event.preventDefault()
        contextOpener = event.currentTarget instanceof HTMLElement ? event.currentTarget : null
        contextDocumentId = documentId
        contextX = Math.min(event.clientX, Math.max(8, window.innerWidth - 232))
        contextY = Math.min(event.clientY, Math.max(8, window.innerHeight - 168))
        await tick()
        contextMenuElement?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
    }

    function closeContextMenu() {
        contextDocumentId = ''
    }

    function closeContextMenuOnEscape(event: KeyboardEvent) {
        if (event.key === 'Escape' && pickingLinkTarget) {
            pickingLinkTarget = false
            return
        }
        if (event.key !== 'Escape' || !contextDocumentId) return
        event.preventDefault()
        closeContextMenu()
        contextOpener?.focus()
    }

    function closeContextMenuFromWindow(event: MouseEvent) {
        if (!(event.target as Element | null)?.closest?.('.file-context-menu')) {
            closeContextMenu()
        }
    }

    async function revealFile() {
        if (!contextDocument) return
        const documentId = contextDocument.id
        closeContextMenu()
        error = ''
        try {
            await revealWikiDocument({
                characterId,
                chatId,
                documentId,
                fetchImpl: fetch,
                createAuth: () => forageStorage.createAuth(),
            })
        }
        catch (cause) {
            error = cause instanceof Error ? cause.message : String(cause)
        }
    }

    async function changeContextMode(
        mode: 'always' | 'auto' | 'never',
        target: WikiDocument | null = contextDocument
    ) {
        if (locked || saving) return
        if (!target
            || target.type === 'event'
            || target.type === 'scene') return
        closeContextMenu()
        saving = true
        error = ''
        try {
            const saved = await setWikiDocumentContextMode({
                characterId,
                chatId,
                documentId: target.id,
                contextMode: mode,
                expectedContentHash: target.contentHash,
                fetchImpl: fetch,
                createAuth: () => forageStorage.createAuth(),
            })
            documents = documents.map((document) => document.id === saved.id ? saved : document)
            // A policy-only save advances the hash without discarding an editor draft.
            if (loadedDocumentId === saved.id && loadedContentHash === target.contentHash) {
                loadedContentHash = saved.contentHash
            }
            publishRisuBardMemoryActivity({
                characterId,
                chatId,
                operation: 'wiki-save',
                timestamp: Date.now(),
                message: `${target.relativePath} context ${mode}`,
                wikiPaths: [target.relativePath],
            })
            await onChanged?.()
        }
        catch (cause) {
            error = cause instanceof Error ? cause.message : String(cause)
        }
        finally {
            saving = false
        }
    }

    function revert() {
        if (creating) {
            resetNewDraft()
            return
        }
        if (selected) loadDocument(selected)
    }

    async function save(): Promise<boolean> {
        if (saving || readOnly || !title.trim() || !markdown.trim()) return false
        saving = true
        error = ''
        notice = ''
        // The server rewrites the body heading from the title, so a rename typed
        // only into the heading would silently revert. Adopt it as the title.
        const headingOf = (value: string) => value.match(/^#{1,2}\s+(.+)$/m)?.[1]?.trim()
        const heading = headingOf(markdown)
        if (!creating && title === loadedTitle && heading
            && heading !== headingOf(loadedMarkdown)) title = heading.slice(0, 160)
        try {
            const saved = await saveManualWikiDocument({
                characterId,
                chatId,
                ...(selected && !creating ? { documentId: selected.id } : {}),
                ...(selected && !creating ? {
                    expectedContentHash: loadedContentHash,
                } : {}),
                type,
                title,
                aliases: Array.from(new Map(aliasesText
                    .split(/[,\n]/)
                    .map((alias) => alias.trim())
                    .filter(Boolean)
                    .map((alias) => [
                        alias.normalize('NFKC').toLocaleLowerCase(), alias,
                    ])).values()).slice(0, 32),
                markdown,
                fetchImpl: fetch,
                createAuth: () => forageStorage.createAuth(),
            })
            // Adopt the server-normalized title, aliases and hash together.
            // The parent refresh may be delayed or fail after a successful save.
            documents = documents.some((document) => document.id === saved.id)
                ? documents.map((document) => document.id === saved.id ? saved : document)
                : [...documents, saved]
            loadDocument(saved)
            notice = '저장했습니다.'
            publishRisuBardMemoryActivity({
                characterId,
                chatId,
                operation: 'wiki-save',
                timestamp: Date.now(),
                message: `${saved.relativePath} 저장`,
                wikiPaths: [saved.relativePath],
            })
            await onChanged?.()
            return true
        }
        catch (cause) {
            error = cause instanceof Error ? cause.message : String(cause)
            return false
        }
        finally {
            saving = false
        }
    }

    function keepDraftOverAnalysis() {
        // The next save sends the analysis hash and deliberately overwrites it.
        if (selected) loadedContentHash = selected.contentHash
    }

    async function trash() {
        if (!selected || creating || readOnly || saving) return
        const target = selected
        const backlinks = countWikiBacklinks(target, documents)
        if (!await alertConfirm(`“${target.title}” 문서를 휴지통으로 이동할까요? 연결된 문서 ${backlinks}개가 남습니다.`)) return
        if (saving || selectedId !== target.id) return
        saving = true
        error = ''
        try {
            await trashWikiDocument({
                characterId,
                chatId,
                documentId: target.id,
                fetchImpl: fetch,
                createAuth: () => forageStorage.createAuth(),
            })
            publishRisuBardMemoryActivity({
                characterId,
                chatId,
                operation: 'wiki-trash',
                timestamp: Date.now(),
                message: `${target.relativePath} 휴지통 이동`,
                wikiPaths: [target.relativePath],
            })
            selectedId = ''
            await onChanged?.()
        }
        catch (cause) {
            error = cause instanceof Error ? cause.message : String(cause)
        }
        finally {
            saving = false
        }
    }

    async function retractEvent() {
        if (!selected
            || selected.type !== 'event'
            || selected.status !== 'active'
            || locked || readOnly
            || saving) return
        const target = selected
        if (!await alertConfirm(
            `“${target.title}” 사건을 영구 삭제할까요? 삭제한 사건은 복구할 수 없습니다.`
        )) return
        if (saving || locked || selectedId !== target.id) return
        saving = true
        error = ''
        notice = ''
        try {
            await retractWikiEvent({
                characterId,
                chatId,
                documentId: target.id,
                expectedContentHash: target.contentHash,
                fetchImpl: fetch,
                createAuth: () => forageStorage.createAuth(),
            })
            notice = '사건을 영구 삭제했습니다.'
            publishRisuBardMemoryActivity({
                characterId,
                chatId,
                operation: 'wiki-retract',
                timestamp: Date.now(),
                message: `${target.relativePath} 사건 영구 삭제`,
                wikiPaths: [target.relativePath],
            })
            await onChanged?.()
        }
        catch (cause) {
            error = cause instanceof Error ? cause.message : String(cause)
        }
        finally {
            saving = false
        }
    }

    async function copySelectedToLorebook() {
        if (!selected || dirty || saving || selected.content === undefined) return
        const target = { title: selected.title, content: selected.content }
        const character = DBState.db.characters.find((item) =>
            item.chaId === characterId
        )
        if (!character) {
            error = '이 BardWiki에 연결된 캐릭터를 찾을 수 없습니다.'
            return
        }
        let policy: 'overwrite' | 'suffix' = 'suffix'
        const hasSameName = character.globalLore.some((entry) =>
            entry.mode !== 'folder'
            && entry.comment.trim() === target.title.trim()
        )
        if (hasSameName) {
            const choice = await alertConfirmMulti(
                '같은 이름의 로어북 항목이 있습니다.',
                [
                    { label: '덮어쓰기', variant: 'primary' },
                    { label: '새 항목으로 복사', variant: 'secondary' },
                ],
                '덮어쓰기는 기존 항목을 비활성화하고 키워드를 비웁니다. 새 항목은 이름 뒤에 숫자를 붙입니다.'
            )
            if (choice < 0) return
            policy = choice === 0 ? 'overwrite' : 'suffix'
        }
        const previousLorebooks = character.globalLore
        const result = copyWikiDocumentToLorebook(
            character.globalLore,
            target,
            policy,
            v4
        )
        saving = true
        error = ''
        notice = ''
        character.globalLore = result.lorebooks
        try {
            // Only this bot changed; it may not be the selected one.
            trackCharacterForSave(character.chaId)
            await requestImmediateSave({ rejectOnFailure: true })
            notice = `로어북 “${result.entry.comment}” ${
                result.action === 'overwritten' ? '덮어쓰기' : '복사'
            } 완료 · 비활성 상태`
        }
        catch (cause) {
            character.globalLore = previousLorebooks
            error = `로어북 복사 실패: ${cause instanceof Error
                ? cause.message
                : String(cause)}`
        }
        finally {
            saving = false
        }
    }

    $effect(() => {
        const current = documents.find((document) => document.id === selectedId)
            ?? documents[0]
        if (creating || !current) return
        // A refreshed catalog entry carries no body. Fetch it whenever it is missing,
        // including right after a save, or the page stays read-only while it waits.
        if (current.content === undefined
            && (!dirty || current.contentHash !== loadedContentHash)) onRequestBody?.(current.id)
        const incomingType = current.type
        const matchesIncoming = title === current.title
            && aliasesText === (current.aliases ?? []).join(', ')
            && type === incomingType
            && markdown === current.content
        if (current.id !== selectedId
            || current.id !== loadedDocumentId
            || (current.contentHash !== loadedContentHash
                && (!dirty || matchesIncoming))) loadDocument(current)
    })
</script>

<svelte:window onclick={closeContextMenuFromWindow} onkeydown={closeContextMenuOnEscape} />

<section
    class="wiki-editor"
    class:tree-collapsed={!treeExpanded}
    class:editor-collapsed={!editorExpanded}
    class:editor-focus={editorFocus}
    class:mobile-layout={mobileLayout}
    class:compact
    data-wiki-editor
    data-tree-expanded={treeExpanded}
    data-editor-expanded={editorExpanded}
    data-editor-focus={editorFocus}
    bind:this={wikiEditorElement}
    style:--wiki-tree-height={`${treeHeight}px`}
    style:--wiki-tree-width={`${treeWidth}px`}
>
    <div class="portrait-panel-header tree-panel-header">
        <button
            type="button"
            data-wiki-toggle-tree
            aria-expanded={treeExpanded}
            aria-controls="risubard-wiki-file-tree"
            onclick={() => treeExpanded = !treeExpanded}
        >
            <FolderIcon size={17} />
            <span><strong>문서</strong><small>{documents.length}개</small></span>
            <ChevronDownIcon size={18} class={treeExpanded ? '' : 'collapsed'} />
        </button>
    </div>
    {#if treeExpanded}
        <button
            type="button"
            class="tree-scrim"
            data-wiki-tree-scrim
            aria-label="문서 목록 닫기"
            onclick={() => treeExpanded = false}
        ></button>
    {/if}
    <nav id="risubard-wiki-file-tree" class="file-tree" aria-label="위키 파일 트리" data-wiki-file-tree>
        <button
            type="button"
            class="tree-width-resizer"
            data-wiki-tree-width-resizer
            aria-label="문서 목록 너비 조절"
            title="드래그하거나 좌우 방향키로 문서 목록 너비 조절"
            onpointerdown={resizeTreeWidth}
            onkeydown={resizeTreeWidthByKeyboard}
        ><span aria-hidden="true"></span></button>
        <div class="tree-toolbar">
            <strong>문서</strong>
            <ShButton size="sm" variant="ghost" onclick={startNew} aria-label="새 문서" disabled={locked}>
                <PlusIcon size={14} /> 새 문서
            </ShButton>
        </div>
        <form class="tree-search" data-wiki-search-form onsubmit={applyWikiSearch}>
            <input
                type="search"
                bind:value={searchDraft}
                oninput={clearEmptySearch}
                use:listenNativeSearchClear
                placeholder="문서 내용 검색"
                aria-label="위키 문서 검색"
                data-wiki-search-input
            />
            <button type="submit" aria-label="검색" title="검색" data-wiki-search-submit>
                <SearchIcon size={14} />
                <span>검색</span>
            </button>
        </form>
        {#if documents.length > 0}
            <div class="tree-filters" data-wiki-tree-filters>
                <div class="type-chips" role="group" aria-label="문서 유형 필터">
                    <button type="button" aria-pressed={activeTypeFilter === null}
                        data-wiki-type-filter="all" onclick={() => setTypeFilter(null)}>전체</button>
                    {#each presentTypes as documentType (documentType)}
                        <button type="button" aria-pressed={activeTypeFilter === documentType}
                            data-wiki-type-filter={documentType}
                            onclick={() => setTypeFilter(documentType)}>{wikiDocumentTypeLabels[documentType]}</button>
                    {/each}
                </div>
                <button
                    type="button"
                    class="tree-sort"
                    data-wiki-sort
                    title={treeSort === 'name' ? '최근 수정순으로 정렬' : '이름순으로 정렬'}
                    onclick={() => treeSort = treeSort === 'name' ? 'updated' : 'name'}
                >{treeSort === 'name' ? '이름순' : '최근 수정순'}</button>
            </div>
        {/if}
        {#if pickingLinkTarget && linkRepair}
            <div class="link-pick-banner" role="status" data-wiki-link-pick>
                <span>[[{linkRepair.target}]]에 연결할 문서를 고르세요</span>
                <button type="button" onclick={() => pickingLinkTarget = false}>취소</button>
            </div>
        {/if}
        <div class="tree-list" class:picking={pickingLinkTarget} data-wiki-search-results>
        {#if searchQuery && filteredDocuments.length === 0}
            <p class="tree-empty">“{searchQuery}”을 포함한 문서가 없습니다.</p>
        {/if}
        {#each tree as node (node.path)}
            {#if node.kind === 'folder'}
                {@const visibleChildren = visibleFolderChildren(node.path, node.children)}
                <details open class="tree-folder">
                    <summary class:locked={node.readOnly} class="folder-row">
                        <FolderIcon size={14} />
                        <span>{wikiFolderDisplayName(node.name)}</span>
                        {#if node.children.length > 0}<span class="folder-count">{node.children.length.toLocaleString()}</span>{/if}
                        {#if node.readOnly}<FileLock2Icon size={12} />{/if}
                    </summary>
                    <div class="folder-children">
                        {#each visibleChildren as child (child.path)}
                            {#if child.kind === 'file'}
                                <div
                                    class="file-row"
                                    class:dangling-link={danglingSourceIds.has(child.documentId)}
                                    class:duplicate-passage={duplicateDocumentIds.has(child.documentId)}
                                    data-wiki-dangling-document={danglingSourceIds.has(child.documentId) ? child.documentId : undefined}
                                    data-wiki-duplicate-document={duplicateDocumentIds.has(child.documentId) ? child.documentId : undefined}
                                >
                                    <button
                                        type="button"
                                        class="file-select"
                                        class:active={selectedId === child.documentId}
                                        onclick={() => chooseTreeDocument(child.documentId)}
                                        oncontextmenu={(event) => openContextMenu(event, child.documentId)}
                                        aria-label={documentLabel(child.documentId, child.title, child.readOnly)}
                                    >
                                        {#if child.readOnly}<FileLock2Icon size={13} />
                                        {:else}<FileIcon size={13} />{/if}
                                        {#if eventSequences.has(child.documentId)}<span class="event-sequence" data-wiki-event-sequence>#{eventSequences.get(child.documentId)}</span>{/if}
                                        <span class="document-title" class:context-excluded={contextModes.get(child.documentId) === 'never'} title={child.title}>{child.title}</span>
                                        {@render contextBadge(child.documentId)}
                                        {@render recentUpdateBadge(child.documentId)}
                                    </button>
                                </div>
                            {/if}
                        {/each}
                        {#if visibleChildren.length < node.children.length}
                            <button
                                type="button"
                                class="folder-more"
                                data-wiki-folder-more={node.path}
                                onclick={() => showMoreInFolder(node.path, visibleChildren.length)}
                            >
                                {Math.min(folderPageSize, node.children.length - visibleChildren.length).toLocaleString()}개 더 보기
                                <span>남은 {(node.children.length - visibleChildren.length).toLocaleString()}개</span>
                            </button>
                        {/if}
                    </div>
                </details>
            {:else}
                <div
                    class="file-row"
                    class:dangling-link={danglingSourceIds.has(node.documentId)}
                    class:duplicate-passage={duplicateDocumentIds.has(node.documentId)}
                    data-wiki-dangling-document={danglingSourceIds.has(node.documentId) ? node.documentId : undefined}
                    data-wiki-duplicate-document={duplicateDocumentIds.has(node.documentId) ? node.documentId : undefined}
                >
                    <button
                        type="button"
                        class="root-file file-select"
                        class:active={selectedId === node.documentId}
                        onclick={() => chooseTreeDocument(node.documentId)}
                        oncontextmenu={(event) => openContextMenu(event, node.documentId)}
                        aria-label={documentLabel(node.documentId, node.title)}
                    >
                        <FileIcon size={13} /><span class="document-title" class:context-excluded={contextModes.get(node.documentId) === 'never'} title={node.title}>{node.title}</span>
                        {@render contextBadge(node.documentId)}
                        {@render recentUpdateBadge(node.documentId)}
                    </button>
                </div>
            {/if}
        {/each}
        </div>
        {#if danglingListOpen && health.danglingLinks.length > 0}
            <ul id="risubard-wiki-dangling-list" class="dangling-list" aria-label="끊어진 링크 목록" data-wiki-dangling-list>
                {#each health.danglingLinks as link, index (`${link.sourceId}:${index}`)}
                    {@const source = documents.find((document) => document.id === link.sourceId)}
                    <li>
                        <button type="button" onclick={() => openDanglingLink(link)} disabled={!source}>
                            <span class="dangling-target">[[{link.target}]]</span>
                            <small>{source?.title ?? link.sourceId}</small>
                        </button>
                    </li>
                {/each}
            </ul>
        {/if}
        <div class="wiki-health" aria-label="위키 건강도" data-wiki-health>
            <span>{documents.length} 문서</span>
            {#if health.danglingLinks.length > 0}
                <button type="button" class="health-action" aria-expanded={danglingListOpen}
                    aria-controls="risubard-wiki-dangling-list" data-wiki-dangling-toggle
                    onclick={() => danglingListOpen = !danglingListOpen}>끊어진 링크 {health.danglingLinks.length}</button>
            {:else}
                <span>끊어진 링크 0</span>
            {/if}
            <span>연결 없음 {health.unlinkedDocumentIds.length}</span>
            <span>본문 중복 {health.duplicatePassages?.length ?? 0}</span>
        </div>
    </nav>

    {#snippet contextBadge(documentId: string)}
        {@const mode = contextModes.get(documentId)}
        {#if mode === 'always' || mode === 'never'}
            <span class="context-mode-badge" class:context-always={mode === 'always'}
                data-wiki-context-mode={mode}
                title={`저장된 포함 설정: ${contextLabels[mode]}. 이번 응답에 실제 포함된 자료는 컨텍스트 내역에서 확인하세요.`}
                aria-hidden="true">
                {#if mode === 'always'}<PinIcon size={11} />항상
                {:else}<CircleOffIcon size={11} />제외{/if}
            </span>
        {/if}
    {/snippet}

    {#snippet recentUpdateBadge(documentId: string)}
        {#if recentlyUpdatedIds.has(documentId)}
            <span class="recent-update-badge" data-wiki-recent-update
                title="최근 분석 이후 갱신된 문서" aria-label="최근 갱신">새 문서</span>
        {/if}
    {/snippet}

    <button
        type="button"
        class="editor-section-resizer"
        data-wiki-tree-resizer
        aria-label="문서 목록 높이 조절"
        title="드래그하거나 위·아래 방향키로 문서 목록 높이 조절"
        onpointerdown={resizeTree}
        onkeydown={resizeTreeByKeyboard}
    ><span aria-hidden="true"></span></button>

    <div class="portrait-panel-header editor-panel-header">
        <button
            class="panel-toggle"
            type="button"
            data-wiki-toggle-editor
            aria-expanded={editorExpanded}
            aria-controls="risubard-wiki-editor-pane"
            onclick={() => editorExpanded = !editorExpanded}
        >
            <FileIcon size={17} />
            <span><strong>편집기</strong><small>{title || '문서를 선택하세요'}</small></span>
            <ChevronDownIcon size={18} class={editorExpanded ? '' : 'collapsed'} />
        </button>
        <button
            class="panel-focus"
            type="button"
            data-wiki-editor-focus
            aria-label={editorFocus ? '집중 종료' : '편집기에 집중'}
            aria-pressed={editorFocus}
            onclick={() => setEditorFocus(!editorFocus)}
        >
            {#if editorFocus}<Minimize2 size={17} />
            {:else}<Maximize2Icon size={17} />{/if}
        </button>
    </div>

    <div id="risubard-wiki-editor-pane" class="editor-pane">
        {#if empty}
        <div class="wiki-empty-state" data-wiki-empty-state>
            <p>아직 기억 문서가 없습니다. AI 응답이 위키 분석을 거치면 인물, 사건, 장소 문서가 여기에 쌓입니다.</p>
            <ShButton size="sm" variant="outline" onclick={startNew} disabled={locked}>
                <PlusIcon size={14} /> 새 문서
            </ShButton>
        </div>
        {:else}
        <header class="editor-header">
            {#if showFields}
            <div class="editor-title-row" data-wiki-title-row>
                <label>
                    <span>타입</span>
                    <select aria-label="항목 유형" bind:value={type} disabled={readOnly || selected?.type === 'event'}>
                        {#if selected?.type === 'event'}<option value="event">사건</option>{/if}
                        <option value="character">캐릭터</option>
                        <option value="location">장소</option>
                        <option value="faction">세력</option>
                        <option value="creature">종족과 생물</option>
                        <option value="item">사물</option>
                        <option value="concept">개념</option>
                        <option value="scene">현재 장면</option>
                        <option value="other">기타</option>
                    </select>
                </label>
                <label class="title-field">
                    <span>이름</span>
                    <input aria-label="항목 이름" bind:value={title} maxlength="160" readonly={readOnly} />
                </label>
                <label class="aliases-field">
                    <span>별칭</span>
                    <input aria-label="별칭" bind:value={aliasesText} maxlength="3000" readonly={readOnly} placeholder="쉼표로 구분" />
                </label>
            </div>
            {/if}
            {#if showFields && selected?.retrievalMetadata}
                <div class="retrieval-metadata" data-wiki-retrieval-metadata>
                    {#if selected.retrievalMetadata.keywords.length}
                        <span>검색어: {selected.retrievalMetadata.keywords.join(', ')}</span>
                    {/if}
                    {#if selected.retrievalMetadata.storyTime}
                        {@const time = selected.retrievalMetadata.storyTime}
                        <span title={time.evidence} data-wiki-story-time>작중 시간: {formatStoryTimeLabel(time)}</span>
                    {/if}
                </div>
            {/if}
            {#if showFields && sourceMeta.length}
                <div class="source-meta" data-wiki-source-meta>
                    {#each sourceMeta as part (part)}<span>{part}</span>{/each}
                </div>
            {/if}
            <div class="editor-actions" data-wiki-action-toolbar>
                {#if compact}
                    <button
                        type="button"
                        class="fields-toggle"
                        data-wiki-fields-toggle
                        aria-expanded={showFields}
                        aria-controls="risubard-wiki-editor-pane"
                        title={showFields ? '타입, 이름, 별칭 접기' : '타입, 이름, 별칭 펼치기'}
                        disabled={creating}
                        onclick={() => onFieldsExpandedChange?.(!fieldsExpanded)}
                    >
                        <ChevronDownIcon size={15} class={showFields ? '' : 'collapsed'} />
                        <span>{title || (creating ? '새 문서' : '문서를 선택하세요')}</span>
                    </button>
                {/if}
                {#if selected && selected.sourceMessageIds.length > 0 && onNavigateSource}
                    {@const localSourceIds = selected.sourceMessageIds.filter(id => !id.startsWith('inherited:'))}
                    <span class="editor-source-action" data-wiki-source-action>
                        <ShButton
                            size="sm"
                            variant="ghost"
                            aria-label={localSourceIds.length ? '원문으로 이동' : '이전 챗 원문 없음'}
                            title={localSourceIds.length ? '원문으로 이동' : '이전 챗 원문 없음'}
                            data-wiki-source
                            disabled={localSourceIds.length === 0}
                            onclick={() => onNavigateSource({
                                kind: 'chat',
                                messageIds: localSourceIds,
                            })}
                        >
                            <LocateFixedIcon size={14} />
                            <span data-wiki-source-label>{localSourceIds.length ? '원문으로 이동' : '이전 챗 원문 없음'}</span>
                        </ShButton>
                    </span>
                {/if}
                {#if canContextMode && selected}
                    {@const currentMode = selected.contextMode ?? 'auto'}
                    <div class="context-segments" role="radiogroup" aria-label="컨텍스트 포함 설정" data-wiki-context-control>
                        {#each contextSegments as segment (segment.mode)}
                            <button
                                type="button"
                                role="radio"
                                aria-checked={currentMode === segment.mode}
                                title={contextLabels[segment.mode]}
                                disabled={readOnly || saving}
                                data-wiki-context-segment={segment.mode}
                                onclick={() => changeContextMode(segment.mode, selected)}
                            >{segment.label}</button>
                        {/each}
                    </div>
                {/if}
                <ShButton size="sm" variant="success" aria-label="저장" title={saveTitle} onclick={save} disabled={readOnly || saving || !dirty || !title.trim() || !markdown.trim()}>
                    <SaveIcon size={14} />
                </ShButton>
                <ShButton size="sm" variant="ghost" aria-label="되돌리기" title="되돌리기" onclick={revert} disabled={!dirty || saving}>
                    <RotateCcwIcon size={14} />
                </ShButton>
                <ShButton
                    size="sm"
                    variant="ghost"
                    aria-label="로어북에 복사"
                    title="로어북에 복사"
                    onclick={() => void copySelectedToLorebook()}
                    disabled={!selected || dirty || saving}
                >
                    <BookCopyIcon size={14} /> <span data-wiki-action-label>로어북에 복사</span>
                </ShButton>
                {#if onCompress && selected && canCompressCanonDocument(selected)}
                    <ShButton size="sm" variant="ghost" aria-label="정본 압축" title="이 문서를 압축" data-wiki-compress-document onclick={() => onCompress(selected.id)} disabled={locked || dirty || saving}>
                        <Minimize2Icon size={14} /> <span data-wiki-action-label>압축</span>
                    </ShButton>
                {/if}
                {#if selected?.type === 'event' && selected.status === 'active'}
                    <ShButton size="sm" variant="ghost" className="text-danger" aria-label="영구 삭제" title="영구 삭제" onclick={retractEvent} disabled={locked || saving}>
                        <Trash2Icon size={14} />
                    </ShButton>
                {:else}
                    <ShButton size="sm" variant="ghost" aria-label="휴지통으로 이동" title="휴지통으로 이동" onclick={trash} disabled={!selected || creating || readOnly || saving}>
                        <Trash2Icon size={14} />
                    </ShButton>
                {/if}
                <label class="markdown-preview-toggle" title="마크다운 미리보기">
                    <input
                        type="checkbox"
                        checked={markdownPreview}
                        onchange={setMarkdownPreview}
                        aria-label="마크다운 미리보기"
                        data-wiki-markdown-toggle
                    />
                    <span>MD</span>
                </label>
            </div>
        </header>
        {#if conflict}
            <div class="conflict-banner" role="alert" data-wiki-conflict>
                <span>분석이 이 문서를 갱신했습니다</span>
                <ShButton size="xs" variant="outline" data-wiki-conflict-latest onclick={() => { if (selected) loadDocument(selected) }}>최신본 보기</ShButton>
                <ShButton size="xs" variant="ghost" data-wiki-conflict-keep onclick={keepDraftOverAnalysis}>내 편집 유지</ShButton>
            </div>
        {/if}
        {#if selected?.status === 'retracted' || readOnly || dirty || selected?.type === 'event'}
            <div class="document-meta">
            {#if selected?.status === 'retracted'}<span class="readonly-badge">철회된 사건 기록</span>
            {:else if bodyPending}<span class="readonly-badge" data-wiki-body-loading>본문 불러오는 중</span>
            {:else if readOnly}<span class="readonly-badge">위키 작업 잠김</span>
            {:else if dirty}<span class="dirty-badge">저장하지 않은 변경</span>
            {:else if selected?.type === 'event'}<span>사용자 편집 사건</span>{/if}
            </div>
        {/if}
        {#if markdownPreview}
            <!-- Delegated because injected HTML cannot carry Svelte handlers.
                 The links themselves are focusable and key-activated. -->
            <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
            <article
                class="markdown-preview"
                data-wiki-markdown-preview
                onclick={activateWikiLink}
                onkeydown={onWikiLinkKeydown}
            >
                {@html markdownRenderer.render(markdown)}
            </article>
        {:else}
            <textarea
                class="markdown-editor"
                aria-label="Markdown"
                bind:value={markdown}
                bind:this={markdownTextarea}
                readonly={readOnly}
                spellcheck="false"
            ></textarea>
        {/if}
        {#if linkRepair && selected?.id === linkRepair.sourceId && !creating}
            <div class="link-repair" data-wiki-link-repair>
                <div class="link-repair-head">
                    <span>끊어진 링크 <strong>[[{linkRepair.target}]]</strong>를 다시 연결</span>
                    <button type="button" class="link-repair-close" onclick={closeLinkRepair}>닫기</button>
                </div>
                <div class="link-repair-options">
                    {#each repairCandidates as candidate (candidate.id)}
                        <button type="button" data-wiki-link-candidate={candidate.id}
                            disabled={readOnly || saving}
                            title={`${candidate.title} (유사도 ${Math.round(candidate.score * 100)}%)`}
                            onclick={() => relinkTo(candidate.id)}>{candidateLabel(candidate)}</button>
                    {:else}
                        <span class="link-repair-empty">비슷한 제목의 문서가 없습니다.</span>
                    {/each}
                    <button type="button" class="link-repair-pick" aria-pressed={pickingLinkTarget}
                        data-wiki-link-pick-toggle disabled={readOnly || saving}
                        onclick={() => { pickingLinkTarget = !pickingLinkTarget; treeExpanded = pickingLinkTarget }}>
                        {pickingLinkTarget ? '목록에서 고르는 중' : '목록에서 고르기'}</button>
                </div>
            </div>
        {/if}
        <div class="editor-status" aria-live="polite">
            {#if error}<span class="error">{error}</span>
            {:else if wikiLinkDiagnostic && !linkRepair}<span
                class="wiki-link-diagnostic"
                class:wiki-link-diagnostic--ambiguous={wikiLinkDiagnostic.status === 'ambiguous'}
                data-wiki-link-diagnostic
            >{wikiLinkDiagnostic.message}</span>
            {:else if notice}<span class="success">{notice}</span>
            {:else if selected?.status === 'retracted'}<span>철회되어 활성 컨텍스트와 자동 처리에서 제외된 감사 기록입니다.</span>
            {:else if bodyPending}<span>문서 본문을 불러오는 중입니다.</span>
            {:else if readOnly}<span>현재 위키 작업이 끝난 뒤 수정할 수 있습니다.</span>
            {:else if selected?.type === 'event'}<span>수정 내용은 지금까지의 이야기에 반영되며 연결된 채팅 출처는 유지됩니다.</span>{/if}
        </div>
        {/if}
    </div>
</section>

{#if contextDocument}
    <div
        class="file-context-menu"
        role="menu"
        tabindex="-1"
        bind:this={contextMenuElement}
        aria-label={`${contextDocument.title} 파일 메뉴`}
        style:left={`${contextX}px`}
        style:top={`${contextY}px`}
    >
        {#if contextDocument.type !== 'event' && contextDocument.type !== 'scene'}
            <button type="button" role="menuitemradio" aria-checked={(contextDocument.contextMode ?? 'auto') === 'always'}
                disabled={locked || saving} data-wiki-context-always onclick={() => changeContextMode('always')}>
                <span class="context-check" aria-hidden="true">{#if contextDocument.contextMode === 'always'}<CheckIcon size={14} />{/if}</span>
                항상 컨텍스트에 포함
            </button>
            <button type="button" role="menuitemradio" aria-checked={(contextDocument.contextMode ?? 'auto') === 'auto'}
                disabled={locked || saving} data-wiki-context-auto onclick={() => changeContextMode('auto')}>
                <span class="context-check" aria-hidden="true">{#if (contextDocument.contextMode ?? 'auto') === 'auto'}<CheckIcon size={14} />{/if}</span>
                관련 있을 때 포함
            </button>
            <button type="button" role="menuitemradio" aria-checked={(contextDocument.contextMode ?? 'auto') === 'never'}
                disabled={locked || saving} data-wiki-context-never onclick={() => changeContextMode('never')}>
                <span class="context-check" aria-hidden="true">{#if contextDocument.contextMode === 'never'}<CheckIcon size={14} />{/if}</span>
                자동 컨텍스트에서 제외
            </button>
        {/if}
        <button type="button" role="menuitem" data-wiki-reveal-file onclick={revealFile}>
            <FolderOpenIcon size={14} /> 탐색기에서 열기
        </button>
    </div>
{/if}

<style>
    .wiki-editor { display: grid; grid-template-columns: minmax(12rem, min(var(--wiki-tree-width, 17rem), calc(100% - 20rem))) minmax(0, 1fr); min-height: 27rem; border-bottom: 1px solid var(--risu-theme-darkborderc); }
    .portrait-panel-header, .editor-section-resizer, .tree-scrim { display: none; }
    .file-tree { position: relative; min-width: 0; display: flex; flex-direction: column; overflow: hidden; padding: .55rem; border-right: 1px solid var(--risu-theme-darkborderc); background: color-mix(in srgb, var(--risu-theme-darkbg) 96%, var(--color-bgcolor)); }
    .tree-toolbar, .editor-title-row { display: flex; align-items: center; gap: .5rem; }
    .tree-toolbar { justify-content: space-between; padding: .2rem .25rem .6rem; }
    .tree-search { display: flex; gap: .35rem; padding: 0 .25rem .6rem; }
    .tree-search input { min-width: 0; flex: 1; height: 2rem; padding: 0 .55rem; border: 1px solid var(--risu-theme-darkborderc); border-radius: .34rem; outline: 0; color: var(--risu-theme-textcolor); background: var(--risu-theme-darkbg); font-size: .72rem; }
    .tree-search input:focus { border-color: color-mix(in srgb, var(--risu-theme-primary) 65%, var(--risu-theme-darkborderc)); box-shadow: 0 0 0 2px color-mix(in srgb, var(--risu-theme-primary) 14%, transparent); }
    .tree-search button { display: inline-flex; flex: 0 0 auto; height: 2rem; align-items: center; gap: .3rem; padding: 0 .55rem; border: 1px solid color-mix(in srgb, var(--risu-theme-primary) 48%, var(--risu-theme-darkborderc)); border-radius: .34rem; color: var(--risu-theme-textcolor); background: color-mix(in srgb, var(--risu-theme-primary) 14%, transparent); font-size: .69rem; font-weight: 700; cursor: pointer; }
    .tree-search button:hover { background: color-mix(in srgb, var(--risu-theme-primary) 22%, transparent); }
    .tree-list { flex: 1 1 auto; min-height: 0; overflow: auto; scrollbar-gutter: stable; scrollbar-width: thin; }
    .tree-empty { margin: .5rem .35rem; color: var(--risu-theme-textcolor2); font-size: .7rem; line-height: 1.5; }
    .wiki-health { display: flex; flex: 0 0 auto; flex-wrap: wrap; gap: .3rem; margin-top: .45rem; padding: .5rem .25rem .1rem; border-top: 1px solid color-mix(in srgb, var(--risu-theme-darkborderc) 72%, transparent); color: var(--risu-theme-textcolor2); font-size: .65rem; }
    .wiki-health span { border: 1px solid var(--risu-theme-darkborderc); border-radius: 999px; padding: .16rem .38rem; }
    .tree-toolbar strong { color: var(--risu-theme-textcolor2); font-size: .7rem; font-weight: 700; line-height: 1; }
    .tree-filters { display: flex; align-items: flex-start; gap: .35rem; padding: 0 .25rem .55rem; }
    .type-chips { display: flex; flex: 1 1 auto; flex-wrap: wrap; gap: .25rem; min-width: 0; }
    .type-chips button, .tree-sort { padding: .16rem .45rem; border: 1px solid var(--risu-theme-darkborderc); border-radius: 999px; color: var(--risu-theme-textcolor2); background: transparent; font-size: .65rem; font-weight: 600; line-height: 1.4; white-space: nowrap; cursor: pointer; }
    .type-chips button:hover, .tree-sort:hover { color: var(--risu-theme-textcolor); border-color: color-mix(in srgb, var(--risu-theme-primary) 45%, var(--risu-theme-darkborderc)); }
    .type-chips button[aria-pressed="true"] { color: var(--risu-theme-primary); border-color: color-mix(in srgb, var(--risu-theme-primary) 60%, var(--risu-theme-darkborderc)); background: color-mix(in srgb, var(--risu-theme-primary) 12%, transparent); }
    .tree-sort { flex: 0 0 auto; border-radius: .3rem; }
    .type-chips button:focus-visible, .tree-sort:focus-visible, .context-segments button:focus-visible { outline: 2px solid color-mix(in srgb, var(--risu-theme-primary) 70%, transparent); outline-offset: 1px; }
    .folder-row, .root-file, .folder-children .file-select { width: 100%; display: flex; align-items: center; gap: .4rem; min-width: 0; padding: .38rem .45rem; border-radius: .32rem; color: var(--risu-theme-textcolor); text-align: left; font-size: .74rem; }
    .folder-row { color: var(--risu-theme-textcolor2); font-weight: 700; }
    .folder-row { cursor: pointer; list-style: none; }
    .folder-row.locked { opacity: .72; }
    .folder-count { margin-left: auto; color: var(--risu-theme-textcolor2); font: 600 .62rem/1 ui-monospace, monospace; font-variant-numeric: tabular-nums; opacity: .8; }
    .folder-more { width: 100%; display: flex; align-items: baseline; gap: .45rem; margin: .2rem 0 .35rem; padding: .42rem .45rem; border: 1px dashed color-mix(in srgb, var(--risu-theme-primary) 34%, var(--risu-theme-darkborderc)); border-radius: .32rem; color: var(--risu-theme-textcolor); background: transparent; font-size: .72rem; font-weight: 700; text-align: left; cursor: pointer; }
    .folder-more span { color: var(--risu-theme-textcolor2); font-size: .65rem; font-weight: 500; font-variant-numeric: tabular-nums; }
    .folder-more:hover { background: color-mix(in srgb, var(--risu-theme-primary) 13%, transparent); }
    .folder-more:focus-visible { outline: 2px solid color-mix(in srgb, var(--risu-theme-primary) 70%, transparent); outline-offset: 1px; }
    .folder-children { margin-left: .7rem; padding-left: .35rem; border-left: 1px solid color-mix(in srgb, var(--risu-theme-primary) 20%, var(--risu-theme-darkborderc)); }
    .file-row { display: flex; min-width: 0; align-items: center; gap: .25rem; border-radius: .32rem; }
    .file-row .file-select { flex: 1 1 auto; }
    .root-file:hover, .folder-children .file-select:hover, button.active { background: color-mix(in srgb, var(--risu-theme-primary) 13%, transparent); }
    .file-row.dangling-link { background: color-mix(in srgb, var(--risu-theme-draculared) 10%, transparent); }
    .file-row.dangling-link .file-select { color: var(--risu-theme-draculared); }
    .file-row.duplicate-passage { box-shadow: inset 2px 0 color-mix(in srgb, var(--color-warning) 75%, transparent); }
    .event-sequence { flex: 0 0 auto; color: var(--risu-theme-textcolor2); font-variant-numeric: tabular-nums; font-size: .68rem; }
    .tree-width-resizer { position: absolute; top: 0; right: -1px; bottom: 0; width: .45rem; padding: 0; border: 0; background: transparent; cursor: col-resize; touch-action: none; z-index: 2; }
    .tree-width-resizer span { display: block; width: 2px; height: 100%; margin-left: auto; background: transparent; transition: background-color .15s; }
    .tree-width-resizer:hover span, .tree-width-resizer:focus-visible span { background: var(--risu-theme-primary); }
    .tree-width-resizer:focus-visible { outline: none; }
    /* The dock's height grip reaches 1.9rem up over this footer; clickable chips sit above it. */
    .wiki-health .health-action { position: relative; z-index: 5; border: 1px solid color-mix(in srgb, var(--risu-theme-draculared) 60%, var(--risu-theme-darkborderc)); border-radius: 999px; padding: .16rem .38rem; color: var(--risu-theme-draculared); }
    .wiki-health .health-action:hover, .wiki-health .health-action[aria-expanded="true"] { background: color-mix(in srgb, var(--risu-theme-draculared) 14%, transparent); }
    .dangling-list { flex: 0 1 auto; max-height: 12rem; overflow-y: auto; margin: .45rem 0 0; padding: .3rem; list-style: none; border: 1px solid var(--risu-theme-darkborderc); border-radius: .4rem; background: var(--risu-theme-bgcolor); }
    .dangling-list button { width: 100%; display: flex; flex-direction: column; align-items: flex-start; gap: .1rem; padding: .35rem .45rem; border-radius: .32rem; text-align: left; font-size: .72rem; color: var(--risu-theme-textcolor); }
    .dangling-list button:hover { background: color-mix(in srgb, var(--risu-theme-primary) 13%, transparent); }
    .dangling-list .dangling-target { color: var(--risu-theme-draculared); overflow-wrap: anywhere; }
    .dangling-list small { color: var(--risu-theme-textcolor2); font-size: .66rem; }
    .link-pick-banner { display: flex; align-items: center; gap: .4rem; margin-bottom: .4rem; padding: .4rem .5rem; border: 1px solid var(--risu-theme-primary); border-radius: .4rem; background: color-mix(in srgb, var(--risu-theme-primary) 12%, transparent); font-size: .7rem; color: var(--risu-theme-textcolor); }
    .link-pick-banner span { flex: 1; min-width: 0; overflow-wrap: anywhere; }
    .link-pick-banner button { flex: 0 0 auto; padding: .15rem .45rem; border: 1px solid var(--risu-theme-darkborderc); border-radius: .3rem; }
    .tree-list.picking .file-select { cursor: copy; }
    .link-repair { position: relative; z-index: 5; margin: 0 .75rem; padding: .5rem .6rem; border: 1px solid color-mix(in srgb, var(--risu-theme-draculared) 50%, var(--risu-theme-darkborderc)); border-radius: .45rem; background: color-mix(in srgb, var(--risu-theme-draculared) 6%, transparent); font-size: .72rem; }
    .link-repair-head { display: flex; align-items: baseline; gap: .5rem; margin-bottom: .4rem; color: var(--risu-theme-textcolor2); }
    .link-repair-head > span { flex: 1; min-width: 0; overflow-wrap: anywhere; }
    .link-repair-head strong { color: var(--risu-theme-draculared); font-weight: 600; }
    .link-repair-close { flex: 0 0 auto; color: var(--risu-theme-textcolor2); font-size: .68rem; }
    .link-repair-options { display: flex; flex-wrap: wrap; gap: .35rem; }
    .link-repair-options button { max-width: 100%; padding: .3rem .55rem; border: 1px solid var(--risu-theme-darkborderc); border-radius: .35rem; text-align: left; color: var(--risu-theme-textcolor); overflow-wrap: anywhere; }
    .link-repair-options button:hover:not(:disabled) { border-color: var(--risu-theme-primary); background: color-mix(in srgb, var(--risu-theme-primary) 12%, transparent); }
    .link-repair-options button:disabled { opacity: .5; }
    .link-repair-options .link-repair-pick { border-style: dashed; color: var(--risu-theme-textcolor2); }
    .link-repair-options .link-repair-pick[aria-pressed="true"] { border-style: solid; border-color: var(--risu-theme-primary); color: var(--risu-theme-textcolor); }
    .link-repair-empty { align-self: center; color: var(--risu-theme-textcolor2); }
    .document-title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .document-title.context-excluded { color: var(--color-textcolor2); }
    .context-mode-badge { display: inline-flex; flex: 0 0 auto; align-items: center; gap: .2rem; color: var(--color-textcolor2); font-size: .65rem; line-height: 1.4; white-space: nowrap; }
    .context-mode-badge.context-always { color: var(--color-primary); font-weight: 700; }
    .context-check { display: inline-flex; flex: 0 0 14px; color: var(--color-primary); }
    .file-context-menu button:disabled { opacity: .5; cursor: not-allowed; }
    .file-context-menu button[aria-checked="true"] { background: color-mix(in srgb, var(--color-primary) 12%, transparent); }
    .recent-update-badge { flex: 0 0 auto; margin-left: auto; padding: .12rem .32rem; border: 1px solid color-mix(in srgb, var(--risu-theme-primary) 45%, transparent); border-radius: .25rem; color: var(--risu-theme-textcolor); background: color-mix(in srgb, var(--risu-theme-primary) 18%, transparent); font-size: .6rem; font-weight: 700; line-height: 1.2; white-space: nowrap; }
    .editor-pane { container-name: wiki-editor-pane; container-type: inline-size; min-width: 0; display: flex; flex-direction: column; background: color-mix(in srgb, var(--risu-theme-darkbg) 98%, var(--color-bgcolor)); }
    .editor-header { min-width: 0; border-bottom: 1px solid var(--risu-theme-darkborderc); }
    .editor-title-row { min-width: 0; padding: .65rem .75rem; }
    .editor-title-row label { display: grid; min-width: 0; gap: .2rem; color: var(--risu-theme-textcolor2); font-size: .62rem; font-weight: 700; }
    .editor-title-row label:first-child { flex: 0 0 5.5rem; }
    .editor-title-row select, .editor-title-row input { box-sizing: border-box; width: 100%; min-height: 2rem; padding: .3rem .45rem; border: 1px solid var(--risu-theme-darkborderc); border-radius: .32rem; color: var(--risu-theme-textcolor); background: var(--risu-theme-darkbg); }
    .title-field { flex: 1 1 12rem; }
    .aliases-field { flex: 1 1 12rem; }
    .source-meta { display: flex; flex-wrap: wrap; gap: .15rem .75rem; padding: 0 .75rem .4rem; color: var(--risu-theme-textcolor2); font-size: .68rem; font-variant-numeric: tabular-nums; }
    .context-segments { display: inline-flex; flex: 0 0 auto; overflow: hidden; border: 1px solid var(--risu-theme-darkborderc); border-radius: .34rem; }
    .context-segments button { min-height: 2rem; padding: 0 .55rem; border: 0; color: var(--risu-theme-textcolor2); background: transparent; font-size: .7rem; font-weight: 600; white-space: nowrap; cursor: pointer; }
    .context-segments button + button { border-left: 1px solid var(--risu-theme-darkborderc); }
    .context-segments button[aria-checked="true"] { color: var(--risu-theme-primary); background: color-mix(in srgb, var(--risu-theme-primary) 14%, transparent); }
    .context-segments button:disabled { opacity: .5; cursor: not-allowed; }
    .conflict-banner { display: flex; flex-wrap: wrap; align-items: center; gap: .4rem .6rem; padding: .45rem .75rem; border-bottom: 1px solid color-mix(in srgb, var(--color-warning) 40%, transparent); color: var(--risu-theme-textcolor); background: color-mix(in srgb, var(--color-warning) 12%, transparent); font-size: .72rem; }
    .conflict-banner span { margin-right: auto; font-weight: 700; }
    .wiki-empty-state { display: grid; flex: 1; align-content: center; justify-items: center; gap: .85rem; padding: 2rem 1.25rem; text-align: center; }
    .wiki-empty-state p { max-width: 26rem; margin: 0; color: var(--risu-theme-textcolor2); font-size: .8rem; line-height: 1.7; word-break: keep-all; }
    .retrieval-metadata { display: flex; flex-wrap: wrap; gap: 0.25rem 1rem; font-size: 0.75rem; color: var(--risu-theme-textcolor2); overflow-wrap: anywhere; }
    .fields-toggle {
        display: inline-flex;
        flex: 0 1 auto;
        min-width: 0;
        min-height: 2rem;
        align-items: center;
        gap: .35rem;
        margin-right: auto;
        padding: .25rem .5rem .25rem .3rem;
        border: 1px solid transparent;
        border-radius: .32rem;
        color: var(--risu-theme-textcolor);
        background: transparent;
        font-size: .78rem;
        font-weight: 700;
        cursor: pointer;
    }
    .fields-toggle span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .fields-toggle :global(svg) { flex: 0 0 auto; color: var(--risu-theme-textcolor2); transition: transform .15s ease-out; }
    .fields-toggle :global(svg.collapsed) { transform: rotate(-90deg); }
    .fields-toggle:hover:not(:disabled) { border-color: var(--risu-theme-darkborderc); background: color-mix(in srgb, var(--risu-theme-primary) 9%, transparent); }
    .fields-toggle:focus-visible { outline: 2px solid color-mix(in srgb, var(--risu-theme-primary) 70%, transparent); outline-offset: 1px; }
    .fields-toggle:disabled { cursor: default; }
    .wiki-editor.compact .editor-actions { border-top: 0; padding-block: .3rem; }
    .wiki-editor.compact .editor-title-row + .editor-actions,
    .wiki-editor.compact .retrieval-metadata + .editor-actions,
    .wiki-editor.compact .source-meta + .editor-actions { border-top: 1px solid color-mix(in srgb, var(--risu-theme-darkborderc) 60%, transparent); }
    .editor-actions { display: flex; min-width: 0; flex-wrap: nowrap; align-items: center; justify-content: flex-end; gap: .25rem; overflow-x: auto; padding: .45rem .75rem; border-top: 1px solid color-mix(in srgb, var(--risu-theme-darkborderc) 60%, transparent); }
    .editor-source-action { display: inline-flex; flex: 0 0 auto; margin-right: auto; }
    .markdown-preview-toggle { display: inline-flex; flex: 0 0 auto; min-height: 2rem; align-items: center; gap: .32rem; padding: 0 .45rem; border: 1px solid var(--risu-theme-darkborderc); border-radius: .34rem; color: var(--risu-theme-textcolor2); font: 700 .67rem/1 ui-monospace, monospace; cursor: pointer; user-select: none; }
    .markdown-preview-toggle:hover { border-color: color-mix(in srgb, var(--risu-theme-primary) 55%, var(--risu-theme-darkborderc)); color: var(--risu-theme-textcolor); }
    .markdown-preview-toggle:has(input:checked) { border-color: color-mix(in srgb, var(--risu-theme-primary) 65%, var(--risu-theme-darkborderc)); color: var(--risu-theme-primary); background: color-mix(in srgb, var(--risu-theme-primary) 12%, transparent); }
    .markdown-preview-toggle input { width: .82rem; height: .82rem; margin: 0; accent-color: var(--risu-theme-primary); }
    .document-meta { display: flex; align-items: center; gap: .6rem; padding: .45rem .75rem; color: var(--risu-theme-textcolor2); font-size: .68rem; }
    .readonly-badge, .dirty-badge { padding: .16rem .38rem; border-radius: 999px; }
    .readonly-badge { background: color-mix(in srgb, var(--risu-theme-textcolor2) 14%, transparent); }
    .dirty-badge { color: var(--risu-theme-primary); background: color-mix(in srgb, var(--risu-theme-primary) 14%, transparent); }
    .markdown-editor { flex: 1; min-height: 20rem; overflow-y: scroll; resize: none; padding: .9rem 1rem; border: 0; border-top: 1px solid color-mix(in srgb, var(--risu-theme-darkborderc) 60%, transparent); outline: 0; color: var(--risu-theme-textcolor); background: transparent; font: .78rem/1.7 ui-monospace, SFMono-Regular, Consolas, monospace; scrollbar-color: color-mix(in srgb, var(--risu-theme-textcolor2) 42%, transparent) transparent; scrollbar-gutter: stable; scrollbar-width: thin; tab-size: 4; }
    .markdown-editor::-webkit-scrollbar-thumb { background-color: color-mix(in srgb, var(--risu-theme-textcolor2) 42%, transparent); }
    .markdown-editor:focus { box-shadow: inset 3px 0 color-mix(in srgb, var(--risu-theme-primary) 60%, transparent); }
    .markdown-editor[readonly] { opacity: .86; }
    .markdown-preview { flex: 1; min-height: 20rem; margin: 0; overflow-x: auto; overflow-y: scroll; padding: 1rem 1.15rem 2rem; border-top: 1px solid color-mix(in srgb, var(--risu-theme-darkborderc) 60%, transparent); color: var(--risu-theme-textcolor); font-size: .82rem; line-height: 1.7; scrollbar-gutter: stable; scrollbar-width: thin; }
    .markdown-preview :global(.wikilink) { color: var(--risu-theme-primary); text-decoration: underline; text-underline-offset: .15em; cursor: pointer; }
    .markdown-preview :global(.wikilink:hover) { filter: brightness(1.2); }
    .markdown-preview :global(.wikilink:focus-visible) { outline: 2px solid var(--risu-theme-primary); outline-offset: 2px; border-radius: .12rem; }
    .markdown-preview :global(.wikilink-unresolved) { color: var(--risu-theme-textcolor2); text-decoration-style: dashed; cursor: help; }
    .markdown-preview :global(.wikilink-ambiguous) { color: var(--risu-theme-warning); text-decoration-color: var(--risu-theme-warning); text-decoration-style: wavy; cursor: help; }
    .markdown-preview :global(h1), .markdown-preview :global(h2), .markdown-preview :global(h3), .markdown-preview :global(h4) { margin: 1.2em 0 .5em; color: var(--risu-theme-textcolor); line-height: 1.3; }
    .markdown-preview :global(h1:first-child), .markdown-preview :global(h2:first-child), .markdown-preview :global(h3:first-child) { margin-top: 0; }
    .markdown-preview :global(h1) { font-size: 1.35rem; }
    .markdown-preview :global(h2) { font-size: 1.15rem; }
    .markdown-preview :global(h3) { font-size: 1rem; }
    .markdown-preview :global(p) { margin: .55rem 0; }
    .markdown-preview :global(ul), .markdown-preview :global(ol) { margin: .55rem 0; padding-left: 1.45rem; }
    .markdown-preview :global(table) { width: 100%; margin: .75rem 0; border-collapse: collapse; font-size: .78rem; }
    .markdown-preview :global(th), .markdown-preview :global(td) { padding: .42rem .55rem; border: 1px solid var(--risu-theme-darkborderc); text-align: left; }
    .markdown-preview :global(th) { background: color-mix(in srgb, var(--risu-theme-primary) 10%, transparent); font-weight: 750; }
    .markdown-preview :global(blockquote) { margin: .75rem 0; padding: .15rem .8rem; border-left: 3px solid var(--risu-theme-primary); color: var(--risu-theme-textcolor2); }
    .markdown-preview :global(code) { padding: .08rem .28rem; border-radius: .25rem; background: color-mix(in srgb, var(--risu-theme-primary) 14%, transparent); font: .76rem/1.5 ui-monospace, SFMono-Regular, Consolas, monospace; }
    .markdown-preview :global(pre) { overflow-x: auto; padding: .75rem; border: 1px solid var(--risu-theme-darkborderc); border-radius: .4rem; background: color-mix(in srgb, var(--risu-theme-darkbg) 88%, var(--color-bgcolor)); }
    .markdown-preview :global(pre code) { padding: 0; background: transparent; }
    .markdown-preview :global(a) { color: var(--risu-theme-primary); text-decoration: underline; text-underline-offset: .15em; }
    .markdown-preview :global(.wiki-search-highlight) { padding: .04em .14em; border-radius: .18em; color: var(--risu-theme-textcolor); background: color-mix(in srgb, var(--color-warning) 62%, transparent); box-shadow: 0 0 0 1px color-mix(in srgb, var(--color-warning) 38%, transparent); }
    .editor-status { min-height: 1.8rem; padding: .35rem .75rem; color: var(--risu-theme-textcolor2); font-size: .66rem; }
    .wiki-link-diagnostic { color: var(--risu-theme-textcolor2); }
    .wiki-link-diagnostic--ambiguous { color: var(--risu-theme-warning); }
    .error { color: var(--risu-theme-draculared); }
    .success { color: var(--risu-theme-success); }
    .file-context-menu {
        position: fixed;
        z-index: 10000;
        display: grid;
        width: 14rem;
        padding: .28rem;
        border: 1px solid color-mix(in srgb, var(--risu-theme-primary) 28%, var(--risu-theme-darkborderc));
        border-radius: .45rem;
        background: color-mix(in srgb, var(--risu-theme-darkbg) 96%, var(--color-bgcolor));
        box-shadow: 0 .75rem 2rem color-mix(in srgb, var(--color-shadow) 32%, transparent);
    }
    .file-context-menu button {
        display: flex;
        align-items: center;
        gap: .5rem;
        padding: .48rem .55rem;
        border: 0;
        border-radius: .3rem;
        color: var(--risu-theme-textcolor);
        background: transparent;
        text-align: left;
        font-size: .74rem;
        cursor: pointer;
    }
    .file-context-menu button:hover,
    .file-context-menu button:focus-visible {
        outline: 0;
        background: color-mix(in srgb, var(--risu-theme-primary) 16%, transparent);
    }
    @container wiki-editor-pane (max-width: 32rem) {
        .editor-actions :global(button) { width: 2rem; padding-inline: .35rem; }
        .editor-actions .editor-source-action :global(button) { width: auto; padding-inline: .55rem; }
        .editor-actions .fields-toggle { width: auto; padding-inline: .3rem .5rem; }
        .editor-actions .context-segments button { width: auto; padding-inline: .45rem; }
        .editor-actions [data-wiki-action-label] { display: none; }
    }
    .wiki-editor.mobile-layout {
            position: relative;
            grid-template-columns: minmax(0, 1fr);
            grid-template-rows: 2.75rem minmax(0, 1fr);
            height: 100%;
            min-height: 0;
            overflow: hidden;
            isolation: isolate;
        }
        .wiki-editor.mobile-layout .tree-panel-header {
            z-index: 32;
            display: flex;
            grid-row: 1;
            min-width: 0;
            border-bottom: 1px solid var(--risu-theme-darkborderc);
            background: color-mix(in srgb, var(--risu-theme-darkbg) 91%, var(--color-bgcolor));
        }
        .wiki-editor.mobile-layout .tree-panel-header > button {
            display: flex;
            width: 100%;
            min-height: 2.75rem;
            align-items: center;
            gap: .6rem;
            padding: .35rem .75rem;
            border: 0;
            color: var(--risu-theme-textcolor);
            background: transparent;
            text-align: left;
            touch-action: manipulation;
        }
        .wiki-editor.mobile-layout .tree-panel-header > button:active {
            background: color-mix(in srgb, var(--risu-theme-primary) 13%, transparent);
        }
        .wiki-editor.mobile-layout .tree-panel-header > button:focus-visible {
            outline: 2px solid var(--risu-theme-primary);
            outline-offset: -2px;
        }
        .wiki-editor.mobile-layout .tree-panel-header button > span {
            display: flex;
            flex: 1;
            min-width: 0;
            align-items: baseline;
            gap: .5rem;
        }
        .wiki-editor.mobile-layout .tree-panel-header strong { font-size: .78rem; }
        .wiki-editor.mobile-layout .tree-panel-header small {
            overflow: hidden;
            color: var(--risu-theme-textcolor2);
            font-size: .68rem;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        .wiki-editor.mobile-layout .tree-panel-header :global(svg:last-child) {
            flex: 0 0 auto;
            transition: transform .18s ease-out;
        }
        .wiki-editor.mobile-layout .tree-panel-header :global(svg:last-child.collapsed) {
            transform: rotate(-90deg);
        }
        .wiki-editor.mobile-layout .file-tree {
            position: absolute;
            z-index: 31;
            inset: 2.75rem auto 0 0;
            width: min(20rem, calc(100% - 2.75rem));
            min-height: 0;
            box-sizing: border-box;
            border-right: 1px solid color-mix(in srgb, var(--risu-theme-primary) 26%, var(--risu-theme-darkborderc));
            overscroll-behavior: contain;
            opacity: 0;
            pointer-events: none;
            transform: translateX(-100%);
            transition: transform .18s ease-out, opacity .14s ease-out;
        }
        .wiki-editor.mobile-layout:not(.tree-collapsed) .file-tree {
            opacity: 1;
            pointer-events: auto;
            transform: translateX(0);
            box-shadow: .8rem 0 2rem color-mix(in srgb, var(--color-shadow) 32%, transparent);
        }
        .wiki-editor.mobile-layout .tree-scrim {
            position: absolute;
            z-index: 30;
            display: block;
            inset: 2.75rem 0 0;
            width: 100%;
            padding: 0;
            border: 0;
            background: color-mix(in srgb, var(--color-shadow) 48%, transparent);
            cursor: default;
        }
        .wiki-editor.mobile-layout .folder-row,
        .wiki-editor.mobile-layout .root-file,
        .wiki-editor.mobile-layout .folder-children button { min-height: 2.75rem; }
        .wiki-editor.mobile-layout .editor-section-resizer,
        .wiki-editor.mobile-layout .tree-width-resizer,
        .wiki-editor.mobile-layout .editor-panel-header { display: none; }
        .wiki-editor.mobile-layout .editor-pane { display: flex; grid-row: 2; min-height: 0; overflow: hidden; }
        .wiki-editor.mobile-layout .editor-title-row {
            display: grid;
            grid-template-columns: minmax(6.5rem, .72fr) minmax(0, 1.28fr);
            gap: .45rem;
            padding: .5rem .6rem;
        }
        .wiki-editor.mobile-layout .editor-title-row .aliases-field { grid-column: 1 / -1; }
        .wiki-editor.mobile-layout .editor-title-row select,
        .wiki-editor.mobile-layout .editor-title-row input {
            min-height: 2.75rem;
            font-size: 1rem;
        }
        .wiki-editor.mobile-layout .editor-actions {
            width: 100%;
            flex-wrap: wrap;
            overflow-x: visible;
            align-items: center;
            justify-content: flex-end;
            gap: .35rem;
            margin-left: 0;
            padding: .4rem .6rem;
            scrollbar-width: thin;
        }
        .wiki-editor.mobile-layout .editor-actions :global(button) { min-height: 2.75rem; }
        .wiki-editor.mobile-layout .document-meta { flex-wrap: wrap; gap: .35rem .6rem; }
        .wiki-editor.mobile-layout .markdown-editor,
        .wiki-editor.mobile-layout .markdown-preview {
            min-height: 0;
            padding: 1rem;
            font-size: 1rem;
            line-height: 1.65;
            overscroll-behavior: contain;
        }
        .wiki-editor.mobile-layout.tree-collapsed .file-tree { display: block; }
        .wiki-editor.mobile-layout.editor-collapsed .editor-pane { display: flex; }
        .wiki-editor.mobile-layout.editor-focus { grid-template-rows: minmax(0, 1fr); }
        .wiki-editor.mobile-layout.editor-focus .tree-panel-header,
        .wiki-editor.mobile-layout.editor-focus .file-tree,
        .wiki-editor.mobile-layout.editor-focus .tree-scrim { display: none; }
        .wiki-editor.mobile-layout.editor-focus .editor-pane { grid-row: 1; }

    @container (max-width: 30rem) {
        .editor-title-row { grid-template-columns: minmax(0, 1fr); }
        .editor-title-row .aliases-field { grid-column: auto; }
    }

    @media (prefers-reduced-motion: reduce) {
        .tree-panel-header :global(svg:last-child),
        .fields-toggle :global(svg),
        .file-tree { transition: none; }
    }
</style>
