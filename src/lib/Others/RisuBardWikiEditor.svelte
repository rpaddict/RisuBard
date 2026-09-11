<script lang="ts">
    import markdownit from 'markdown-it'
    import {
        describeWikiLinkTarget,
        wikiLinkPlugin,
        type WikiLinkRenderResolution,
        type WikiLinkResolution,
    } from 'src/ts/risubard/wikiLink'
    import {
        FileIcon,
        FileLock2Icon,
        BookCopyIcon,
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
    } from '@lucide/svelte'
    import ShButton from 'src/lib/UI/GUI/ShButton.svelte'
    import { v4 } from 'uuid'
    import { forageStorage, requestImmediateSave } from 'src/ts/globalApi.svelte'
    import { DBState } from 'src/ts/stores.svelte'
    import { alertConfirmMulti } from 'src/ts/alert'
    import {
        saveManualWikiDocument,
        setWikiDocumentContextMode,
        revealWikiDocument,
        retractWikiEvent,
        trashWikiDocument,
        type MarkdownWikiDocumentType,
        type NarrativeMemoryWikiMarkdown,
    } from 'src/ts/risubard/memoryWiki'
    import { buildWikiFileTree, getRecentlyUpdatedWikiDocumentIds } from 'src/ts/risubard/wikiFileTree'
    import { publishRisuBardMemoryActivity } from 'src/ts/risubard/memoryActivity'
    import { copyWikiDocumentToLorebook } from 'src/ts/risubard/wikiLorebookCopy'
    import { normalizeMemoryWikiTreeHeight } from 'src/ts/risubard/memoryWikiLayout'
    import type { StorySourceRef } from 'src/ts/risubard/storySoFar'

    type WikiDocument = NarrativeMemoryWikiMarkdown['documents'][number]

    interface Props {
        characterId: string
        chatId: string
        documents: WikiDocument[]
        health?: NarrativeMemoryWikiMarkdown['health']
        locked?: boolean
        mobileLayout?: boolean
        selectedId?: string
        onChanged?: () => void | Promise<void>
        onSelected?: (documentId: string) => void
        onFocusModeChange?: (focused: boolean) => void
        onNavigateSource?: (source: StorySourceRef) => void
        highlightedDocumentIds?: string[] | null
    }

    let {
        characterId,
        chatId,
        documents,
        health = {
            danglingLinks: [], unlinkedDocumentIds: [], duplicatePassages: [],
        },
        locked = false,
        mobileLayout = false,
        selectedId = $bindable(''),
        onChanged,
        onSelected,
        onFocusModeChange,
        onNavigateSource,
        highlightedDocumentIds = null,
    }: Props = $props()
    let creating = $state(false)
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
    let wikiEditorElement = $state<HTMLElement | null>(null)
    let treeExpanded = $state(false)
    let editorExpanded = $state(true)
    let editorFocus = $state(false)
    let markdownPreview = $state(
        DBState.db.risuBardWikiMarkdownPreview === true
    )
    let treeHeight = $state(normalizeMemoryWikiTreeHeight(undefined))
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
            selectDocument(resolution.document)
            return
        }
        error = ''
        notice = ''
        wikiLinkDiagnostic = {
            status: resolution.status,
            message: wikiLinkDescription(target, resolution),
        }
    }

    function onWikiLinkKeydown(event: KeyboardEvent) {
        if (event.key !== 'Enter' && event.key !== ' ') return
        activateWikiLink(event)
    }

    let tree = $derived(buildWikiFileTree(documents))
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
    let readOnly = $derived(locked)
    let contextDocument = $derived(
        documents.find((document) => document.id === contextDocumentId) ?? null
    )
    let dirty = $derived(creating
        ? title.trim().length > 0 || markdown.trim().length > 0
        : !!selected && (title !== loadedTitle
            || aliasesText !== loadedAliasesText
            || type !== loadedType
            || markdown !== loadedMarkdown))

    function loadDocument(document: WikiDocument) {
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
        wikiLinkDiagnostic = null
        onSelected?.(document.id)
    }

    function selectDocument(document: WikiDocument) {
        loadDocument(document)
        treeExpanded = false
        editorExpanded = true
    }

    function startNew() {
        if (locked) return
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

    function openContextMenu(event: MouseEvent, documentId: string) {
        event.preventDefault()
        contextDocumentId = documentId
        contextX = Math.min(event.clientX, Math.max(8, window.innerWidth - 190))
        contextY = Math.min(event.clientY, Math.max(8, window.innerHeight - 96))
    }

    function closeContextMenu() {
        contextDocumentId = ''
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

    async function changeContextMode(mode: 'always' | 'auto' | 'never') {
        if (locked) return
        if (!contextDocument
            || contextDocument.type === 'event'
            || contextDocument.type === 'scene') return
        const target = contextDocument
        closeContextMenu()
        saving = true
        error = ''
        try {
            await setWikiDocumentContextMode({
                characterId,
                chatId,
                documentId: target.id,
                contextMode: mode,
                expectedContentHash: target.contentHash,
                fetchImpl: fetch,
                createAuth: () => forageStorage.createAuth(),
            })
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
            startNew()
            return
        }
        if (selected) loadDocument(selected)
    }

    async function save() {
        if (saving || readOnly || !title.trim() || !markdown.trim()) return
        saving = true
        error = ''
        notice = ''
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
            selectedId = saved.id
            creating = false
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
        }
        catch (cause) {
            error = cause instanceof Error ? cause.message : String(cause)
        }
        finally {
            saving = false
        }
    }

    async function trash() {
        if (!selected || creating || readOnly || saving) return
        const backlinks = documents.filter((document) =>
            document.id !== selected.id
            && document.links.includes(selected.title)
        ).length
        if (!confirm(`“${selected.title}” 문서를 휴지통으로 이동할까요? 연결된 문서 ${backlinks}개가 남습니다.`)) return
        saving = true
        error = ''
        try {
            await trashWikiDocument({
                characterId,
                chatId,
                documentId: selected.id,
                fetchImpl: fetch,
                createAuth: () => forageStorage.createAuth(),
            })
            publishRisuBardMemoryActivity({
                characterId,
                chatId,
                operation: 'wiki-trash',
                timestamp: Date.now(),
                message: `${selected.relativePath} 휴지통 이동`,
                wikiPaths: [selected.relativePath],
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
            || saving) return
        if (!confirm(
            `“${selected.title}” 사건을 영구 삭제할까요? 삭제한 사건은 복구할 수 없습니다.`
        )) return
        const target = selected
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
        if (!selected || dirty || saving) return
        const target = selected
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
            { title: target.title, content: target.content },
            policy,
            v4
        )
        saving = true
        error = ''
        notice = ''
        character.globalLore = result.lorebooks
        try {
            await requestImmediateSave({
                forceFullWrite: true,
                rejectOnFailure: true,
            })
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

<svelte:window onclick={closeContextMenuFromWindow} />

<section
    class="wiki-editor"
    class:tree-collapsed={!treeExpanded}
    class:editor-collapsed={!editorExpanded}
    class:editor-focus={editorFocus}
    class:mobile-layout={mobileLayout}
    data-wiki-editor
    data-tree-expanded={treeExpanded}
    data-editor-expanded={editorExpanded}
    data-editor-focus={editorFocus}
    bind:this={wikiEditorElement}
    style:--wiki-tree-height={`${treeHeight}px`}
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
    <nav id="risubard-wiki-file-tree" class="file-tree" aria-label="위키 파일 트리">
        <div class="tree-toolbar">
            <strong>WIKI</strong>
            <ShButton size="sm" variant="ghost" onclick={startNew} aria-label="새 문서" disabled={locked}>
                <PlusIcon size={14} /> 새 문서
            </ShButton>
        </div>
        <div class="wiki-health" aria-label="위키 건강도">
            <span>{documents.length} 문서</span>
            <span>끊어진 링크 {health.danglingLinks.length}</span>
            <span>연결 없음 {health.unlinkedDocumentIds.length}</span>
            <span>본문 중복 {health.duplicatePassages?.length ?? 0}</span>
        </div>
        {#each tree as node (node.path)}
            {#if node.kind === 'folder'}
                <details open class="tree-folder">
                    <summary class:locked={node.readOnly} class="folder-row">
                        <FolderIcon size={14} />
                        <span>{node.name}</span>
                        {#if node.readOnly}<FileLock2Icon size={12} />{/if}
                    </summary>
                    <div class="folder-children">
                        {#each node.children as child (child.path)}
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
                                        onclick={() => {
                                            const document = documents.find((item) => item.id === child.documentId)
                                            if (document) selectDocument(document)
                                        }}
                                        oncontextmenu={(event) => openContextMenu(event, child.documentId)}
                                        aria-label={`${child.title} ${child.readOnly ? '읽기 전용' : ''}`}
                                    >
                                        {#if child.readOnly}<FileLock2Icon size={13} />
                                        {:else}<FileIcon size={13} />{/if}
                                        <span class="document-title">{child.title}</span>
                                        {@render recentUpdateBadge(child.documentId)}
                                    </button>
                                </div>
                            {/if}
                        {/each}
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
                        onclick={() => {
                            const document = documents.find((item) => item.id === node.documentId)
                            if (document) selectDocument(document)
                        }}
                        oncontextmenu={(event) => openContextMenu(event, node.documentId)}
                        aria-label={node.title}
                    >
                        <FileIcon size={13} /><span class="document-title">{node.title}</span>
                        {@render recentUpdateBadge(node.documentId)}
                    </button>
                </div>
            {/if}
        {/each}
    </nav>

    {#snippet recentUpdateBadge(documentId: string)}
        {#if recentlyUpdatedIds.has(documentId)}
            <span class="recent-update-badge" data-wiki-recent-update
                title="최근 분석 이후 갱신된 문서" aria-label="최근 갱신">New</span>
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
        <header class="editor-header">
            <div class="editor-title-row" data-wiki-title-row>
                <label>
                    <span>타입</span>
                    <select aria-label="항목 유형" bind:value={type} disabled={readOnly || selected?.type === 'event'}>
                        {#if selected?.type === 'event'}<option value="event">사건</option>{/if}
                        <option value="character">캐릭터</option>
                        <option value="location">장소</option>
                        <option value="faction">세력</option>
                        <option value="creature">종족·생물</option>
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
            <div class="editor-actions" data-wiki-action-toolbar>
                {#if selected && selected.sourceMessageIds.length > 0 && onNavigateSource}
                    <span class="editor-source-action" data-wiki-source-action>
                        <ShButton
                            size="sm"
                            variant="ghost"
                            aria-label="원문으로 이동"
                            title="원문으로 이동"
                            data-wiki-source
                            onclick={() => onNavigateSource({
                                kind: 'chat',
                                messageIds: selected.sourceMessageIds,
                            })}
                        >
                            <LocateFixedIcon size={14} />
                            <span data-wiki-source-label>원문으로 이동</span>
                        </ShButton>
                    </span>
                {/if}
                <ShButton size="sm" variant="success" aria-label="저장" title="저장" onclick={save} disabled={readOnly || saving || !dirty || !title.trim() || !markdown.trim()}>
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
                {#if selected?.type === 'event' && selected.status === 'active'}
                    <ShButton size="sm" variant="ghost" aria-label="삭제" title="삭제" onclick={retractEvent} disabled={saving}>
                        <Trash2Icon size={14} />
                    </ShButton>
                {:else}
                    <ShButton size="sm" variant="ghost" aria-label="삭제" title="삭제" onclick={trash} disabled={!selected || creating || readOnly || saving}>
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
        {#if selected?.status === 'retracted' || readOnly || dirty || selected?.type === 'event'}
            <div class="document-meta">
            {#if selected?.status === 'retracted'}<span class="readonly-badge">철회된 사건 기록</span>
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
                readonly={readOnly}
                maxlength="12000"
                spellcheck="false"
            ></textarea>
        {/if}
        <div class="editor-status" aria-live="polite">
            {#if error}<span class="error">{error}</span>
            {:else if wikiLinkDiagnostic}<span
                class="wiki-link-diagnostic"
                class:wiki-link-diagnostic--ambiguous={wikiLinkDiagnostic.status === 'ambiguous'}
                data-wiki-link-diagnostic
            >{wikiLinkDiagnostic.message}</span>
            {:else if notice}<span class="success">{notice}</span>
            {:else if selected?.status === 'retracted'}<span>철회되어 활성 컨텍스트와 자동 처리에서 제외된 감사 기록입니다.</span>
            {:else if readOnly}<span>현재 위키 작업이 끝난 뒤 수정할 수 있습니다.</span>
            {:else if selected?.type === 'event'}<span>수정 내용은 지금까지의 이야기에 반영되며 연결된 채팅 출처는 유지됩니다.</span>{/if}
        </div>
    </div>
</section>

{#if contextDocument}
    <div
        class="file-context-menu"
        role="menu"
        tabindex="-1"
        aria-label={`${contextDocument.title} 파일 메뉴`}
        style:left={`${contextX}px`}
        style:top={`${contextY}px`}
    >
        {#if contextDocument.type !== 'event' && contextDocument.type !== 'scene'}
            <button type="button" role="menuitem" data-wiki-context-always onclick={() => changeContextMode('always')}>
                항상 컨텍스트에 포함
            </button>
            <button type="button" role="menuitem" data-wiki-context-auto onclick={() => changeContextMode('auto')}>
                관련 있을 때 포함
            </button>
            <button type="button" role="menuitem" data-wiki-context-never onclick={() => changeContextMode('never')}>
                자동 컨텍스트에서 제외
            </button>
        {/if}
        <button type="button" role="menuitem" data-wiki-reveal-file onclick={revealFile}>
            <FolderOpenIcon size={14} /> 탐색기에서 열기
        </button>
    </div>
{/if}

<style>
    .wiki-editor { display: grid; grid-template-columns: minmax(12rem, 17rem) minmax(0, 1fr); min-height: 27rem; border-bottom: 1px solid var(--risu-theme-darkborderc); }
    .portrait-panel-header, .editor-section-resizer, .tree-scrim { display: none; }
    .file-tree { min-width: 0; overflow: auto; padding: .55rem; border-right: 1px solid var(--risu-theme-darkborderc); background: color-mix(in srgb, var(--risu-theme-darkbg) 96%, var(--color-bgcolor)); }
    .tree-toolbar, .editor-title-row { display: flex; align-items: center; gap: .5rem; }
    .tree-toolbar { justify-content: space-between; padding: .2rem .25rem .6rem; }
    .wiki-health { display: flex; flex-wrap: wrap; gap: .3rem; padding: 0 .25rem .55rem; color: var(--risu-theme-textcolor2); font-size: .65rem; }
    .wiki-health span { border: 1px solid var(--risu-theme-darkborderc); border-radius: 999px; padding: .16rem .38rem; }
    .tree-toolbar strong { color: var(--risu-theme-textcolor2); font: 700 .65rem/1 ui-monospace, monospace; letter-spacing: .16em; }
    .folder-row, .root-file, .folder-children .file-select { width: 100%; display: flex; align-items: center; gap: .4rem; min-width: 0; padding: .38rem .45rem; border-radius: .32rem; color: var(--risu-theme-textcolor); text-align: left; font-size: .74rem; }
    .folder-row { color: var(--risu-theme-textcolor2); font-weight: 700; }
    .folder-row { cursor: pointer; list-style: none; }
    .folder-row.locked { opacity: .72; }
    .folder-children { margin-left: .7rem; padding-left: .35rem; border-left: 1px solid color-mix(in srgb, var(--risu-theme-primary) 20%, var(--risu-theme-darkborderc)); }
    .file-row { display: flex; min-width: 0; align-items: center; gap: .25rem; border-radius: .32rem; }
    .file-row .file-select { flex: 1 1 auto; }
    .root-file:hover, .folder-children .file-select:hover, button.active { background: color-mix(in srgb, var(--risu-theme-primary) 13%, transparent); }
    .file-row.dangling-link { background: color-mix(in srgb, var(--risu-theme-draculared) 10%, transparent); }
    .file-row.dangling-link .file-select { color: var(--risu-theme-draculared); }
    .file-row.duplicate-passage { box-shadow: inset 2px 0 color-mix(in srgb, var(--color-warning) 75%, transparent); }
    .document-title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .recent-update-badge { flex: 0 0 auto; margin-left: auto; padding: .12rem .32rem; border: 1px solid color-mix(in srgb, var(--risu-theme-primary) 45%, transparent); border-radius: .25rem; color: var(--risu-theme-textcolor); background: color-mix(in srgb, var(--risu-theme-primary) 18%, transparent); font-size: .6rem; font-weight: 700; line-height: 1.2; white-space: nowrap; }
    .editor-pane { container-name: wiki-editor-pane; container-type: inline-size; min-width: 0; display: flex; flex-direction: column; background: color-mix(in srgb, var(--risu-theme-darkbg) 98%, var(--color-bgcolor)); }
    .editor-header { min-width: 0; border-bottom: 1px solid var(--risu-theme-darkborderc); }
    .editor-title-row { min-width: 0; padding: .65rem .75rem; }
    .editor-title-row label { display: grid; min-width: 0; gap: .2rem; color: var(--risu-theme-textcolor2); font-size: .62rem; font-weight: 700; }
    .editor-title-row label:first-child { flex: 0 0 5.5rem; }
    .editor-title-row select, .editor-title-row input { box-sizing: border-box; width: 100%; min-height: 2rem; padding: .3rem .45rem; border: 1px solid var(--risu-theme-darkborderc); border-radius: .32rem; color: var(--risu-theme-textcolor); background: var(--risu-theme-darkbg); }
    .title-field { flex: 1 1 12rem; }
    .aliases-field { flex: 1 1 12rem; }
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
    .editor-status { min-height: 1.8rem; padding: .35rem .75rem; color: var(--risu-theme-textcolor2); font-size: .66rem; }
    .wiki-link-diagnostic { color: var(--risu-theme-textcolor2); }
    .wiki-link-diagnostic--ambiguous { color: var(--risu-theme-warning); }
    .error { color: var(--risu-theme-draculared); }
    .success { color: var(--risu-theme-success); }
    .file-context-menu {
        position: fixed;
        z-index: 10000;
        display: grid;
        width: 11rem;
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
        .file-tree { transition: none; }
    }
</style>
