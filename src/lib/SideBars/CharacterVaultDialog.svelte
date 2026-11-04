<script lang="ts">
    import {
        ArchiveIcon,
        CheckIcon,
        CopyIcon,
        FolderIcon,
        FolderOpenIcon,
        ImageIcon,
        PencilIcon,
        PanelLeftIcon,
        PinIcon,
        SearchIcon,
        UserRoundIcon,
        XIcon,
    } from '@lucide/svelte'
    import { v4 } from 'uuid'
    import { tick } from 'svelte'
    import ShDialog from '../UI/GUI/ShDialog.svelte'
    import ShButton from '../UI/GUI/ShButton.svelte'
    import ManagerResizeHandles from '../UI/GUI/ManagerResizeHandles.svelte'
    import SolarBoldIcon from '../UI/Icons/SolarBoldIcon.svelte'
    import { DBState, selectedCharID } from 'src/ts/stores.svelte'
    import { createUniqueDisplayName } from 'src/ts/displayName'
    import type { folder } from 'src/ts/storage/database.svelte'
    import {
        createCharacterVaultFolder,
        createCharacterVaultClones,
        applyCharacterVaultClones,
        buildCharacterVaultSections,
        deleteCharacterVaultFolder,
        getCharacterVaultQuickAccess,
        moveCharactersToVaultFolder,
        sortCharacterVaultCharacters,
        trashCharacterVaultCharacters,
        toggleCharacterVaultQuickAccess,
        type CharacterVaultSortDirection,
        type CharacterVaultSortKey,
        type CharacterVaultShortcut,
    } from 'src/ts/characterVault'
    import {
        requestImmediateSave,
        forageStorage,
        getFileSrc,
        requiresFullEncoderReload,
        saveAsset,
        trackChatForSave,
    } from 'src/ts/globalApi.svelte'
    import { selectSingleFile } from 'src/ts/util'
    import { getCharImage } from 'src/ts/characters'
    import { alertConfirm, alertInput } from 'src/ts/alert'
    import {
        completeMemoryWikiFork,
        forkMemoryWiki,
    } from 'src/ts/risubard/memoryWikiFork'
    import { characterPackageLabel, refreshPackageStatus } from 'src/ts/storage/packageStatus.svelte'

    interface Props {
        open: boolean
        onOpenChange(open: boolean): void
        onSelectCharacter?(index: number): void
    }

    let { open, onOpenChange, onSelectCharacter }: Props = $props()

    // Storage layout badges (V3 folder, V4 retired assets); legacy characters show none.
    $effect(() => { if (open) void refreshPackageStatus() })
    let query = $state('')
    let activeScope = $state('all')
    let selectedIds = $state<string[]>([])
    let moveTarget = $state('__unfiled__')
    let folderSort = $state<'manual' | 'name' | 'count'>('manual')
    // 'order' follows the sidebar; in the full vault it groups cards by folder.
    let characterSort = $state<CharacterVaultSortKey | 'order'>('name')
    let characterSortDirection = $state<CharacterVaultSortDirection>('asc')
    let coverCharacterId = $state('')
    let notice = $state('')
    let revision = $state(0)
    let cloning = $state(false)
    let draggedCharacterId = $state('')
    let dragOverFolderId = $state('')
    let folderSidebarOpen = $state(false)
    let contentElement = $state<HTMLElement | null>(null)
    let folderSidebarToggle: HTMLButtonElement | null = $state(null)
    let folderSidebarClose: HTMLButtonElement | null = $state(null)
    let vaultTitle = $derived(
        DBState.db.language === 'ko' ? '캐릭터 저장소' : 'Character Vault'
    )
    const imageCache = new Map<string, Promise<string | null>>()
    const characterDragType = 'application/x-risubard-character-vault'

    let folders = $derived.by(() => {
        revision
        const result = DBState.db.characterOrder.filter(
            (entry): entry is folder => typeof entry !== 'string'
        )
        if (folderSort === 'name') {
            return [...result].sort((a, b) => a.name.localeCompare(b.name))
        }
        if (folderSort === 'count') {
            return [...result].sort((a, b) =>
                b.data.length - a.data.length || a.name.localeCompare(b.name)
            )
        }
        return result
    })

    let activeFolder = $derived.by(() => {
        revision
        return folders.find((entry) => entry.id === activeScope) ?? null
    })

    let quickKeys = $derived.by(() => {
        revision
        return new Set(getCharacterVaultQuickAccess(DBState.db).map((entry) =>
            `${entry.kind}:${entry.id}`
        ))
    })

    const folderColorNames = ['red', 'yellow', 'green', 'blue', 'indigo', 'purple', 'pink', 'default']

    let scopedCharacters = $derived.by(() => {
        revision
        const normalizedQuery = query.trim().toLocaleLowerCase()
        const unfiled = new Set(DBState.db.characterOrder.filter(
            (entry): entry is string => typeof entry === 'string'
        ))
        const folderCharacters = activeFolder ? new Set(activeFolder.data) : null
        const items = DBState.db.characters
            .map((character, index) => ({ character, index }))
            .filter(({ character }) => {
                if (character.trashTime) return false
                if (activeScope === '__unfiled__' && !unfiled.has(character.chaId)) {
                    return false
                }
                if (folderCharacters && !folderCharacters.has(character.chaId)) {
                    return false
                }
                return !normalizedQuery
                    || character.name.toLocaleLowerCase().includes(normalizedQuery)
            })
        return items
    })

    let orderSections = $derived.by(() => {
        if (characterSort !== 'order') return null
        return buildCharacterVaultSections(
            DBState.db.characterOrder,
            scopedCharacters.map((item) => ({ ...item, chaId: item.character.chaId })),
            activeScope === 'all' && !query.trim()
        )
    })

    // Folder groups only make sense across the whole vault; a single scope stays flat.
    let groupedSections = $derived(activeScope === 'all' ? orderSections : null)

    let visibleCharacters = $derived.by(() => {
        if (orderSections) return orderSections.flatMap((section) => section.items)
        const items = scopedCharacters
        const itemsById = new Map(items.map((item) => [item.character.chaId, item]))
        return sortCharacterVaultCharacters(
            items.map((item) => item.character),
            characterSort as CharacterVaultSortKey,
            characterSortDirection
        ).map((character) => itemsById.get(character.chaId)!)
    })

    let activeCharacterCount = $derived.by(() => {
        revision
        return DBState.db.characters.filter((character) => !character.trashTime).length
    })

    function commit(message: string) {
        revision += 1
        notice = message
        void requestImmediateSave()
    }

    async function setFolderSidebar(open: boolean) {
        folderSidebarOpen = open
        await tick()
        if (open) folderSidebarClose?.focus()
        else folderSidebarToggle?.focus()
    }

    function toggleSelected(id: string) {
        selectedIds = selectedIds.includes(id)
            ? selectedIds.filter((value) => value !== id)
            : [...selectedIds, id]
    }

    function selectCard(event: MouseEvent, id: string) {
        if (event.target instanceof Element && event.target.closest('button')) return
        toggleSelected(id)
    }

    function toggleAllVisible() {
        const visibleIds = visibleCharacters.map((item) => item.character.chaId)
        const visibleSet = new Set(visibleIds)
        const allSelected = visibleIds.length > 0
            && visibleIds.every((id) => selectedIds.includes(id))
        selectedIds = allSelected
            ? selectedIds.filter((id) => !visibleSet.has(id))
            : [...new Set([...selectedIds, ...visibleIds])]
    }

    function toggleQuick(shortcut: CharacterVaultShortcut, label: string) {
        const added = toggleCharacterVaultQuickAccess(DBState.db, shortcut)
        commit(`${label} · 퀵 인벤토리${added ? '에 추가됨' : '에서 제거됨'}`)
    }

    function moveSelected() {
        if (selectedIds.length === 0) return
        moveCharactersToVaultFolder(
            DBState.db,
            selectedIds,
            moveTarget === '__unfiled__' ? null : moveTarget
        )
        const count = selectedIds.length
        selectedIds = []
        activeScope = moveTarget === '__unfiled__' ? '__unfiled__' : moveTarget
        commit(`${count}개 캐릭터 이동 완료`)
    }

    function startCharacterDrag(event: DragEvent, id: string, name: string) {
        if (!event.dataTransfer) return
        if ((event.target as HTMLElement).closest('button')) {
            event.preventDefault()
            return
        }
        draggedCharacterId = id
        event.dataTransfer.effectAllowed = 'move'
        event.dataTransfer.setData('text/plain', name)
        event.dataTransfer.setData(characterDragType, id)
    }

    function isCharacterDrag(event: DragEvent): boolean {
        return event.dataTransfer?.types.includes(characterDragType) ?? false
    }

    function locationContainsCharacter(folderEntry: folder | null, id: string): boolean {
        if (folderEntry) return folderEntry.data.includes(id)
        return DBState.db.characterOrder.includes(id)
    }

    function dragCharacterOverLocation(event: DragEvent, folderEntry: folder | null) {
        if (!isCharacterDrag(event)
            || locationContainsCharacter(folderEntry, draggedCharacterId)) {
            return
        }
        event.preventDefault()
        event.stopPropagation()
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
        dragOverFolderId = folderEntry?.id ?? '__unfiled__'
    }

    function leaveCharacterLocation(event: DragEvent, locationId: string) {
        const next = event.relatedTarget
        const location = event.currentTarget as HTMLElement
        if (next instanceof Node && location.contains(next)) return
        if (dragOverFolderId === locationId) dragOverFolderId = ''
    }

    function dropCharacterInLocation(event: DragEvent, folderEntry: folder | null) {
        if (!isCharacterDrag(event)) return
        event.preventDefault()
        event.stopPropagation()
        const id = event.dataTransfer?.getData(characterDragType)
            || draggedCharacterId
        const character = DBState.db.characters.find((entry) => entry.chaId === id)
        draggedCharacterId = ''
        dragOverFolderId = ''
        if (!character || locationContainsCharacter(folderEntry, id)) return
        moveCharactersToVaultFolder(DBState.db, [id], folderEntry?.id ?? null)
        selectedIds = selectedIds.filter((selectedId) => selectedId !== id)
        commit(`${character.name} · ${folderEntry
            ? `${folderEntry.name} 폴더로 이동`
            : '미분류로 이동'}`)
    }

    function endCharacterDrag() {
        draggedCharacterId = ''
        dragOverFolderId = ''
    }

    async function createFolder() {
        const name = await alertInput('새 폴더 이름', [], '새 폴더')
        if (!name) return
        const created = createCharacterVaultFolder(DBState.db, name, v4())
        if (!created) return
        activeScope = created.id
        coverCharacterId = ''
        commit(`${created.name} 폴더 생성 완료`)
    }

    function renameActiveFolder(event: Event) {
        if (!activeFolder) return
        const name = (event.currentTarget as HTMLInputElement).value.trim()
        if (!name || name === activeFolder.name) return
        activeFolder.name = name
        commit('폴더 이름 변경 완료')
    }

    async function renameCharacter(id: string) {
        const character = DBState.db.characters.find((entry) => entry.chaId === id)
        if (!character) return
        const oldName = character.name
        const value = await alertInput('캐릭터 이름 변경', [], oldName)
        const name = value.trim()
        if (!name || name === oldName) return
        character.name = createUniqueDisplayName(name, DBState.db.characters, character.chaId)
        commit(`${oldName} → ${character.name} 이름 변경 완료`)
    }

    function recolorActiveFolder(color: string) {
        if (!activeFolder || !color) return
        activeFolder.color = color
        commit('폴더 색상 변경 완료')
    }

    function useCharacterCover() {
        if (!activeFolder || !coverCharacterId) return
        const character = DBState.db.characters.find((entry) =>
            entry.chaId === coverCharacterId
        )
        if (!character?.image) return
        activeFolder.imgFile = character.image
        activeFolder.img = ''
        commit(`${character.name} 이미지를 폴더 커버로 지정`)
    }

    async function uploadFolderCover() {
        if (!activeFolder) return
        const file = await selectSingleFile(['png', 'jpg', 'jpeg', 'webp', 'gif'])
        if (!file) return
        const stored = await saveAsset(file.data)
        activeFolder.imgFile = stored
        activeFolder.img = await getFileSrc(stored)
        commit('폴더 커버 업로드 완료')
    }

    async function deleteActiveFolder() {
        if (!activeFolder) return
        const name = activeFolder.name
        if (!await alertConfirm(`${name} 폴더를 삭제할까요? 캐릭터는 미분류로 이동합니다.`)) {
            return
        }
        deleteCharacterVaultFolder(DBState.db, activeFolder.id)
        activeScope = '__unfiled__'
        coverCharacterId = ''
        commit(`${name} 폴더 삭제 완료`)
    }

    async function trashSelected() {
        const count = selectedIds.length
        if (count === 0) return
        if (!await alertConfirm(`선택한 ${count}명의 캐릭터를 삭제할까요?`)) {
            return
        }
        if (!await alertConfirm('캐릭터와 채팅을 영구 삭제합니다. 되돌릴 수 없습니다. 계속할까요?')) return
        const trashed = trashCharacterVaultCharacters(DBState.db, selectedIds)
        if (trashed === 0) return
        selectedIds = []
        selectedCharID.set(-1)
        requiresFullEncoderReload.state = true
        commit(`${trashed}명 캐릭터 삭제 완료`)
    }

    async function cloneSelected(withChats: boolean) {
        if (selectedIds.length === 0 || cloning) return
        cloning = true
        notice = ''
        const previousCharacters = [...DBState.db.characters]
        const previousOrder = DBState.db.characterOrder
        const staged: {
            characterId: string
            destinationChatId: string
            forkToken: string
        }[] = []
        let applied = false
        try {
            if (withChats) {
                for (const source of DBState.db.characters) {
                    if (!selectedIds.includes(source.chaId)) continue
                    for (let index = 0; index < source.chats.length; index += 1) {
                        if (source.chats[index]?._placeholder) {
                            const { ensureChatHydrated } = await import(
                                'src/ts/storage/chatStorage'
                            )
                            await ensureChatHydrated(source.chats, index, source.chaId)
                        }
                        if (source.chats[index]?._placeholder) {
                            throw new Error(`${source.name}의 챗을 불러오지 못했습니다.`)
                        }
                    }
                }
            }
            const plans = createCharacterVaultClones(DBState.db, selectedIds, {
                withChats,
                createId: v4,
            })
            for (const plan of plans) {
                for (const chat of plan.chatForks) {
                    const receipt = await forkMemoryWiki({
                        characterId: plan.sourceCharacterId,
                        destinationCharacterId: plan.clone.chaId,
                        sourceChatId: chat.sourceChatId,
                        destinationChatId: chat.destinationChatId,
                        mode: 'copy',
                        fetchImpl: fetch,
                        createAuth: () => forageStorage.createAuth(),
                    })
                    staged.push({
                        characterId: plan.clone.chaId,
                        destinationChatId: chat.destinationChatId,
                        forkToken: receipt.forkToken,
                    })
                }
            }
            applyCharacterVaultClones(DBState.db, plans)
            applied = true
            // New characters go in the patch; only their chat bodies are sent separately.
            for (const plan of plans) {
                for (const chat of plan.clone.chats) {
                    if (chat.id) trackChatForSave(plan.clone.chaId, chat.id)
                }
            }
            await requestImmediateSave({ rejectOnFailure: true })
            const finalized = await Promise.allSettled(staged.map((fork) =>
                completeMemoryWikiFork({
                    ...fork,
                    action: 'finalize',
                    fetchImpl: fetch,
                    createAuth: () => forageStorage.createAuth(),
                })
            ))
            const finalizeFailures = finalized.filter((result) =>
                result.status === 'rejected'
            ).length
            selectedIds = []
            revision += 1
            requiresFullEncoderReload.state = true
            notice = `${plans.length}명 캐릭터 복제 완료${
                finalizeFailures > 0
                    ? ` · BardWiki 마무리 실패 ${finalizeFailures}건`
                    : ''
            }`
        }
        catch (cause) {
            if (applied) {
                DBState.db.characters = previousCharacters
                DBState.db.characterOrder = previousOrder
            }
            await Promise.allSettled(staged.map((fork) =>
                completeMemoryWikiFork({
                    ...fork,
                    action: 'discard',
                    fetchImpl: fetch,
                    createAuth: () => forageStorage.createAuth(),
                })
            ))
            if (applied) void requestImmediateSave({ forceFullWrite: true })
            notice = `캐릭터 복제 실패: ${cause instanceof Error
                ? cause.message
                : String(cause)}`
        }
        finally {
            cloning = false
        }
    }

    function openCharacter(index: number) {
        onSelectCharacter?.(index)
        onOpenChange(false)
    }

    function characterImage(id: string, image: string): Promise<string | null> {
        const key = `${id}:${image}`
        const cached = imageCache.get(key)
        if (cached) return cached
        const request = getCharImage(image, 'plain')
        imageCache.set(key, request)
        return request
    }
</script>

<ShDialog
    {open}
    {onOpenChange}
    closeOnEscape
    size="xl"
    tier="base"
    bind:contentElement
    contentClass="character-vault-dialog"
    bodyClass="character-vault-body"
>
    {#snippet title()}
        <span class="vault-title"><ArchiveIcon size={19} /> {vaultTitle}</span>
    {/snippet}
    {#snippet description()}
        전체 캐릭터를 보관하고 정리합니다. 사이드바에는 퀵 인벤토리만 표시됩니다.
    {/snippet}

    <div class="vault-shell">
        <aside
            id="character-vault-folders"
            class="vault-rail"
            class:open={folderSidebarOpen}
            aria-label="캐릭터 폴더"
        >
            <div class="rail-heading">
                <span>보관 위치</span>
                <div class="rail-actions">
                    <button
                        type="button"
                        class="folder-sidebar-close"
                        bind:this={folderSidebarClose}
                        aria-label="캐릭터 폴더 닫기"
                        onclick={() => void setFolderSidebar(false)}
                    ><XIcon size={17} /></button>
                    <button
                        type="button"
                        aria-label="새 폴더 만들기"
                        onclick={() => void createFolder()}
                    ><SolarBoldIcon name="add-folder" size={15} /></button>
                    <button
                        type="button"
                        aria-label="선택한 폴더 삭제"
                        disabled={!activeFolder}
                        onclick={() => void deleteActiveFolder()}
                    ><SolarBoldIcon name="remove-folder" size={15} /></button>
                </div>
            </div>
            <select class="folder-sort" aria-label="폴더 정렬" bind:value={folderSort}>
                <option value="manual">기본순</option>
                <option value="name">이름순</option>
                <option value="count">개수순</option>
            </select>
            <button
                type="button"
                class:active={activeScope === 'all'}
                onclick={() => {
                    activeScope = 'all'
                    void setFolderSidebar(false)
                }}
            >
                <ArchiveIcon size={15} /><span>전체 캐릭터</span>
                <small>{activeCharacterCount}</small>
            </button>
            <button
                type="button"
                class:active={activeScope === '__unfiled__'}
                class:drop-target={dragOverFolderId === '__unfiled__'}
                onclick={() => {
                    activeScope = '__unfiled__'
                    void setFolderSidebar(false)
                }}
                ondragover={(event) => dragCharacterOverLocation(event, null)}
                ondragleave={(event) => leaveCharacterLocation(event, '__unfiled__')}
                ondrop={(event) => dropCharacterInLocation(event, null)}
            >
                <UserRoundIcon size={15} /><span>미분류</span>
                <small>{DBState.db.characterOrder.filter((entry) => typeof entry === 'string').length}</small>
            </button>
            <div class="folder-list" role="list">
                {#each folders as folderEntry (folderEntry.id)}
                    <div
                        class="folder-row"
                        role="listitem"
                        class:drop-target={dragOverFolderId === folderEntry.id}
                        style={`--folder-accent:${folderEntry.color || 'var(--color-borderc)'}`}
                        ondragover={(event) => dragCharacterOverLocation(event, folderEntry)}
                        ondragleave={(event) => leaveCharacterLocation(event, folderEntry.id)}
                        ondrop={(event) => dropCharacterInLocation(event, folderEntry)}
                    >
                        <button
                            type="button"
                            class:active={activeScope === folderEntry.id}
                            aria-label={`${folderEntry.name} 폴더 열기`}
                            onclick={() => {
                                activeScope = folderEntry.id
                                coverCharacterId = folderEntry.data[0] ?? ''
                                void setFolderSidebar(false)
                            }}
                        >
                            {#if activeScope === folderEntry.id}<FolderOpenIcon size={15} />
                            {:else}<FolderIcon size={15} />{/if}
                            <span>{folderEntry.name}</span><small>{folderEntry.data.length}</small>
                        </button>
                        <button
                            type="button"
                            class="folder-pin"
                            class:pinned={quickKeys.has(`folder:${folderEntry.id}`)}
                            aria-label={`${folderEntry.name} 퀵 인벤토리 전환`}
                            aria-pressed={quickKeys.has(`folder:${folderEntry.id}`)}
                            onclick={() => toggleQuick(
                                { kind: 'folder', id: folderEntry.id }, folderEntry.name
                            )}
                        ><PinIcon size={12} /></button>
                    </div>
                {/each}
            </div>
        </aside>

        {#if folderSidebarOpen}
            <button
                type="button"
                class="folder-sidebar-scrim"
                aria-label="캐릭터 폴더 닫기"
                onclick={() => void setFolderSidebar(false)}
            ></button>
        {/if}

        <main class="vault-main">
            <div class="vault-toolbar">
                <button
                    type="button"
                    class="folder-sidebar-toggle"
                    bind:this={folderSidebarToggle}
                    aria-label={folderSidebarOpen ? '캐릭터 폴더 닫기' : '캐릭터 폴더 열기'}
                    aria-controls="character-vault-folders"
                    aria-expanded={folderSidebarOpen}
                    onclick={() => void setFolderSidebar(!folderSidebarOpen)}
                ><PanelLeftIcon size={18} /></button>
                <label class="vault-search">
                    <SearchIcon size={16} />
                    <input
                        aria-label="캐릭터 검색"
                        bind:value={query}
                        placeholder="이름으로 캐릭터 찾기"
                    />
                </label>
                <div class="character-sort">
                    <select
                        aria-label="캐릭터 정렬 기준"
                        value={characterSort}
                        onchange={(event) => characterSort =
                            (event.currentTarget as HTMLSelectElement).value as CharacterVaultSortKey | 'order'}
                    >
                        <option value="name">이름</option>
                        <option value="lastInteraction">마지막 사용</option>
                        <option value="creationDate">생성/임포트</option>
                        <option value="order">사이드바 순서</option>
                    </select>
                    <button
                        type="button"
                        disabled={characterSort === 'order'}
                        aria-label={`정렬 방향: ${characterSortDirection === 'asc' ? '오름차' : '내림차'}`}
                        onclick={() => characterSortDirection = characterSortDirection === 'asc'
                            ? 'desc'
                            : 'asc'}
                    >{characterSortDirection === 'asc' ? '오름차' : '내림차'}</button>
                </div>
                <ShButton
                    size="xs"
                    variant="secondary"
                    aria-label="현재 목록 전체 선택"
                    onclick={toggleAllVisible}
                    disabled={visibleCharacters.length === 0}
                ><CheckIcon /> 전체 선택</ShButton>
                <span>{visibleCharacters.length}명</span>
            </div>

            {#if activeFolder}
                <section class="folder-editor" aria-label="활성 폴더 편집">
                    <label>
                        <span>폴더 이름</span>
                        <input
                            aria-label="폴더 이름"
                            value={activeFolder.name}
                            onchange={renameActiveFolder}
                        />
                    </label>
                    <label>
                        <span>강조색</span>
                        <div class="color-line">
                            {#each folderColorNames as color}
                                <button
                                    type="button"
                                    class="color-chip color-{color}"
                                    class:active={activeFolder.color === color}
                                    aria-label={`${color} 폴더 색상`}
                                    onclick={() => recolorActiveFolder(color)}
                                ></button>
                            {/each}
                            <input
                                type="color"
                                aria-label="폴더 사용자 지정 색상"
                                value={activeFolder.color.startsWith('#') ? activeFolder.color : '#8b6a34'}
                                oninput={(event) => recolorActiveFolder(
                                    (event.currentTarget as HTMLInputElement).value
                                )}
                            />
                        </div>
                    </label>
                    <label class="cover-control">
                        <span>커버</span>
                        <select bind:value={coverCharacterId} aria-label="폴더 커버 캐릭터">
                            <option value="">캐릭터 선택</option>
                            {#each activeFolder.data as id}
                                {@const character = DBState.db.characters.find((entry) => entry.chaId === id)}
                                {#if character}<option value={id}>{character.name}</option>{/if}
                            {/each}
                        </select>
                        <ShButton size="xs" variant="secondary" onclick={useCharacterCover} disabled={!coverCharacterId}>
                            <ImageIcon /> 캐릭터 이미지
                        </ShButton>
                        <ShButton size="xs" variant="secondary" onclick={() => void uploadFolderCover()}>
                            업로드
                        </ShButton>
                    </label>
                </section>
            {/if}

            {#snippet characterCard(item: (typeof visibleCharacters)[number])}
                <div
                    class="character-card"
                    role="checkbox"
                    tabindex="0"
                    aria-checked={selectedIds.includes(item.character.chaId)}
                    class:selected={selectedIds.includes(item.character.chaId)}
                    class:dragging={draggedCharacterId === item.character.chaId}
                    draggable="true"
                    aria-label={`${item.character.name} 캐릭터 카드 · 폴더로 드래그하여 이동`}
                    onclick={(event) => selectCard(event, item.character.chaId)}
                    onkeydown={(event) => {
                        if (event.target !== event.currentTarget
                            || (event.key !== 'Enter' && event.key !== ' ')) return
                        event.preventDefault()
                        toggleSelected(item.character.chaId)
                    }}
                    ondragstart={(event) => startCharacterDrag(
                        event,
                        item.character.chaId,
                        item.character.name
                    )}
                    ondragend={endCharacterDrag}
                >
                    <div class="portrait">
                        {#await characterImage(
                            item.character.chaId,
                            item.character.image ?? ''
                        )}
                            <UserRoundIcon size={24} />
                        {:then image}
                            {#if image}<img src={image} alt="" />
                            {:else}<UserRoundIcon size={24} />{/if}
                        {/await}
                        {#if characterPackageLabel(item.character.chaId)}
                            <span class="package-badge" title={`저장 구조: ${characterPackageLabel(item.character.chaId)}`}>{characterPackageLabel(item.character.chaId)}</span>
                        {/if}
                        <button
                            type="button"
                            class="select-character"
                            aria-label={`${item.character.name} 선택`}
                            aria-pressed={selectedIds.includes(item.character.chaId)}
                            onclick={() => toggleSelected(item.character.chaId)}
                        >
                            {#if selectedIds.includes(item.character.chaId)}<CheckIcon size={14} />{/if}
                        </button>
                        <button
                            type="button"
                            class="pin-character"
                            class:pinned={quickKeys.has(`character:${item.character.chaId}`)}
                            aria-label={`${item.character.name} 퀵 인벤토리 전환`}
                            aria-pressed={quickKeys.has(`character:${item.character.chaId}`)}
                            onclick={() => toggleQuick(
                                { kind: 'character', id: item.character.chaId },
                                item.character.name
                            )}
                        ><PinIcon size={13} /></button>
                        <button
                            type="button"
                            class="open-character"
                            aria-label={`${item.character.name} 열기`}
                            onclick={() => openCharacter(item.index)}
                        ><SolarBoldIcon name="play-circle" size={16} /></button>
                        <button
                            type="button"
                            class="rename-character"
                            aria-label={`${item.character.name} 이름 변경`}
                            onclick={() => void renameCharacter(item.character.chaId)}
                        ><PencilIcon size={13} /></button>
                    </div>
                    <div class="character-caption">
                        <strong>{item.character.name}</strong>
                    </div>
                </div>
            {/snippet}

            {#snippet emptyVault()}
                <div class="empty-vault">
                    <SearchIcon size={22} /> 조건에 맞는 캐릭터가 없습니다.
                </div>
            {/snippet}

            <div class="character-grid" class:grouped={!!groupedSections} aria-label="캐릭터 목록">
                {#if groupedSections}
                    {#each groupedSections as section (section.key)}
                        {@const folderEntry = section.folder}
                        {#if folderEntry}
                            <section
                                class="vault-section"
                                class:drop-target={dragOverFolderId === folderEntry.id}
                                aria-label={`${folderEntry.name} 폴더`}
                                ondragover={(event) => dragCharacterOverLocation(event, folderEntry)}
                                ondragleave={(event) => leaveCharacterLocation(event, folderEntry.id)}
                                ondrop={(event) => dropCharacterInLocation(event, folderEntry)}
                            >
                                <header class="vault-section-head">
                                    <span
                                        class="color-chip color-{folderColorNames.includes(folderEntry.color) ? folderEntry.color : 'default'}"
                                        style={folderEntry.color?.startsWith('#') ? `background:${folderEntry.color}` : undefined}
                                    ></span>
                                    <FolderIcon size={15} />
                                    <h3 title={folderEntry.name}>{folderEntry.name}</h3>
                                    <small>{query.trim() && section.items.length !== folderEntry.data.length
                                        ? `${section.items.length} / ${folderEntry.data.length}명`
                                        : `${section.items.length}명`}</small>
                                </header>
                                {#if section.items.length > 0}
                                    <div class="vault-section-grid">
                                        {#each section.items as item (item.character.chaId)}
                                            {@render characterCard(item)}
                                        {/each}
                                    </div>
                                {:else}
                                    <p class="vault-section-empty">비어 있는 폴더입니다. 캐릭터 카드를 여기로 끌어 놓으면 이 폴더로 옮겨집니다.</p>
                                {/if}
                            </section>
                        {:else}
                            <section class="vault-section" aria-label="미분류 캐릭터">
                                <header class="vault-section-head">
                                    <UserRoundIcon size={15} />
                                    <h3>미분류</h3>
                                    <small>{section.items.length}명</small>
                                </header>
                                <div class="vault-section-grid">
                                    {#each section.items as item (item.character.chaId)}
                                        {@render characterCard(item)}
                                    {/each}
                                </div>
                            </section>
                        {/if}
                    {:else}
                        {@render emptyVault()}
                    {/each}
                {:else}
                    {#each visibleCharacters as item (item.character.chaId)}
                        {@render characterCard(item)}
                    {:else}
                        {@render emptyVault()}
                    {/each}
                {/if}
            </div>

            {#if selectedIds.length > 0}
                <div class="bulk-dock">
                    <strong>{selectedIds.length}명 선택</strong>
                    <select
                        aria-label="선택 캐릭터 이동"
                        value={moveTarget}
                        onchange={(event) => moveTarget =
                            (event.currentTarget as HTMLSelectElement).value}
                    >
                        <option value="__unfiled__">미분류로 이동</option>
                        {#each folders as folderEntry}
                            <option value={folderEntry.id}>{folderEntry.name}</option>
                        {/each}
                    </select>
                    <div class="bulk-actions">
                        <ShButton size="sm" variant="primary" aria-label="선택 항목 이동" onclick={moveSelected}>
                            선택 항목 이동
                        </ShButton>
                        <ShButton
                            size="sm"
                            variant="secondary"
                            aria-label="선택 캐릭터 챗 포함 복제"
                            disabled={cloning}
                            onclick={() => void cloneSelected(true)}
                        ><CopyIcon size={15} /> 챗 포함 복제</ShButton>
                        <ShButton
                            size="sm"
                            variant="secondary"
                            aria-label="선택 캐릭터 챗 제외 복제"
                            disabled={cloning}
                            onclick={() => void cloneSelected(false)}
                        ><CopyIcon size={15} /> 챗 제외 복제</ShButton>
                        <ShButton
                            size="sm"
                            variant="destructive"
                            aria-label="선택 캐릭터 삭제"
                            onclick={() => void trashSelected()}
                        >
                            <SolarBoldIcon name="trash-bin-trash" size={15} /> 삭제
                        </ShButton>
                    </div>
                </div>
            {/if}
        </main>
    </div>
    <p class="vault-notice" aria-live="polite">{notice}</p>
    <ManagerResizeHandles target={contentElement} centered />
</ShDialog>

<style>
    :global(.character-vault-dialog) {
        width: var(--manager-width, min(96vw, 72rem));
        max-width: calc(100vw - 1rem);
        height: var(--manager-height, min(90dvh, 48rem));
        max-height: calc(100dvh - 1rem);
        min-width: min(30rem, calc(100vw - 1rem));
        min-height: min(24rem, calc(100dvh - 1rem));
        overflow: hidden;
        background: var(--color-darkbg);
    }
    :global(.character-vault-body) { min-height: 0; flex: 1; container-type: inline-size; container-name: character-vault; }
    .vault-title { display: inline-flex; align-items: center; gap: .45rem; font-family: var(--risu-font-family); letter-spacing: -.02em; }
    .vault-shell { position: relative; display: grid; grid-template-columns: 13.5rem minmax(0, 1fr); height: 100%; min-height: 0; overflow: hidden; border: 1px solid var(--color-darkborderc); border-radius: .7rem; }
    .vault-rail { display: flex; min-height: 0; flex-direction: column; gap: .25rem; padding: .65rem; border-right: 1px solid var(--color-darkborderc); background: color-mix(in srgb, var(--color-darkbg) 87%, var(--color-warning) 13%); }
    .rail-heading { display: flex; align-items: center; justify-content: space-between; margin-bottom: .35rem; color: var(--color-textcolor2); font-size: .66rem; letter-spacing: .12em; text-transform: uppercase; }
    .rail-actions { display: flex; gap: .25rem; }
    .rail-actions button { display: grid; width: 1.75rem; height: 1.75rem; place-items: center; border: 1px solid var(--color-darkborderc); border-radius: .35rem; background: color-mix(in srgb, var(--color-darkbg) 88%, var(--color-selected) 12%); color: var(--color-textcolor2); }
    .rail-actions button:hover:not(:disabled) { border-color: var(--color-borderc); color: var(--color-textcolor); }
    .rail-actions button:disabled { cursor: not-allowed; opacity: .35; }
    .rail-actions .folder-sidebar-close { display: none; }
    .folder-sort { width: 100%; margin-bottom: .2rem; padding: .3rem .4rem; border: 1px solid var(--color-darkborderc); border-radius: .3rem; background: var(--color-darkbg); color: var(--color-textcolor2); font-size: .65rem; }
    .vault-rail > button, .folder-row > button:first-child { display: grid; width: 100%; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: .42rem; padding: .48rem .5rem; border-radius: .42rem; color: var(--color-textcolor2); text-align: left; font-size: .76rem; transition: background 120ms ease, color 120ms ease; }
    .vault-rail button span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .vault-rail button small { font: 600 .64rem ui-monospace, monospace; opacity: .7; }
    .vault-rail button:hover, .vault-rail button.active { color: var(--color-textcolor); background: color-mix(in srgb, var(--color-selected) 75%, transparent); }
    .folder-list { min-height: 0; flex: 1 1 auto; overflow-y: auto; overscroll-behavior: contain; padding: .2rem .25rem .2rem 0; scrollbar-color: var(--color-borderc) transparent; scrollbar-gutter: stable; scrollbar-width: thin; }
    .folder-list::-webkit-scrollbar { width: .38rem; }
    .folder-list::-webkit-scrollbar-thumb { border-radius: 999px; background: var(--color-borderc); }
    .folder-row { position: relative; display: flex; align-items: center; border-left: 2px solid var(--folder-accent); border-radius: .42rem; transition: background 120ms ease, box-shadow 120ms ease; }
    .folder-row.drop-target, .vault-rail > button.drop-target { background: color-mix(in srgb, var(--color-warning) 18%, var(--color-selected)); box-shadow: inset 0 0 0 1px var(--color-warning), 0 0 0 2px color-mix(in srgb, var(--color-warning) 12%, transparent); }
    .folder-row.drop-target > button:first-child { color: var(--color-textcolor); }
    .vault-rail > button.drop-target { color: var(--color-textcolor); }
    .folder-pin { flex: none; padding: .25rem; border-radius: .3rem; color: var(--color-textcolor2); opacity: .45; }
    .folder-pin:hover, .folder-pin.pinned { color: var(--color-warning); opacity: 1; }
    .vault-main { position: relative; display: flex; min-width: 0; min-height: 0; flex-direction: column; background: color-mix(in srgb, var(--color-darkbg) 97%, var(--color-bgcolor)); }
    .vault-toolbar { display: flex; align-items: center; gap: .7rem; padding: .7rem; border-bottom: 1px solid var(--color-darkborderc); }
    .folder-sidebar-toggle, .folder-sidebar-scrim { display: none; }
    .vault-toolbar > span { color: var(--color-textcolor2); font: 600 .72rem ui-monospace, monospace; }
    .vault-search { display: flex; min-width: 0; flex: 1; align-items: center; gap: .45rem; padding: .45rem .55rem; border: 1px solid var(--color-darkborderc); border-radius: .48rem; background: color-mix(in srgb, var(--color-darkbg) 90%, var(--color-bgcolor)); color: var(--color-textcolor2); }
    .vault-search input { min-width: 0; flex: 1; border: 0; outline: 0; background: transparent; color: var(--color-textcolor); font-size: .8rem; }
    .character-sort { display: flex; height: 2rem; overflow: hidden; border: 1px solid var(--color-darkborderc); border-radius: .4rem; background: var(--color-darkbg); }
    .character-sort select, .character-sort button { border: 0; background: transparent; color: var(--color-textcolor2); font-size: .7rem; }
    .character-sort select { padding: 0 .4rem; }
    .character-sort button { min-width: 3.5rem; padding: 0 .45rem; border-left: 1px solid var(--color-darkborderc); }
    .character-sort button:hover:not(:disabled) { color: var(--color-textcolor); background: color-mix(in srgb, var(--color-selected) 45%, transparent); }
    .character-sort button:disabled { cursor: not-allowed; opacity: .4; }
    .folder-editor { display: grid; grid-template-columns: minmax(8rem, 1fr) auto minmax(15rem, 1.3fr); align-items: end; gap: .55rem; padding: .55rem .7rem; border-bottom: 1px solid var(--color-darkborderc); background: color-mix(in srgb, var(--color-selected) 35%, transparent); }
    .folder-editor label { display: grid; gap: .25rem; color: var(--color-textcolor2); font-size: .64rem; }
    .folder-editor input:not([type=color]), .folder-editor select, .bulk-dock select { min-width: 0; height: 2rem; padding: 0 .45rem; border: 1px solid var(--color-darkborderc); border-radius: .35rem; background: var(--color-darkbg); color: var(--color-textcolor); font-size: .72rem; }
    .color-line { display: flex; align-items: center; gap: .22rem; }
    .color-chip { width: .95rem; height: .95rem; border: 1px solid var(--color-darkborderc); border-radius: 50%; }
    .color-chip.active { outline: 2px solid var(--color-textcolor); outline-offset: 1px; }
    .color-red { background:#b91c1c }.color-yellow { background:#a16207 }.color-green { background:#15803d }.color-blue { background:#1d4ed8 }.color-indigo { background:#4338ca }.color-purple { background:#7e22ce }.color-pink { background:#be185d }.color-default { background:#64748b }
    input[type=color] { width: 1.25rem; height: 1.25rem; padding: 0; border: 0; background: transparent; }
    .cover-control { grid-template-columns: minmax(6rem, 1fr) auto auto; }
    .cover-control > span { grid-column: 1 / -1; }
    .character-grid { display: grid; min-height: 0; flex: 1; grid-template-columns: repeat(auto-fill, minmax(min(100%, 12rem), 1fr)); grid-auto-rows: max-content; align-content: start; gap: .65rem; overflow-y: auto; padding: .75rem; }
    .character-grid.grouped { display: flex; flex-direction: column; gap: 1.25rem; padding-top: 0; }
    .vault-section { border-radius: .55rem; transition: box-shadow 120ms ease; }
    .vault-section.drop-target { box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-warning) 55%, transparent); }
    .vault-section-head { position: sticky; z-index: 3; top: 0; display: flex; min-width: 0; align-items: center; gap: .45rem; margin-bottom: .55rem; padding: .7rem .1rem .45rem; border-bottom: 1px solid var(--color-darkborderc); background: color-mix(in srgb, var(--color-darkbg) 97%, var(--color-bgcolor)); color: var(--color-textcolor2); }
    .vault-section.drop-target .vault-section-head { color: var(--color-textcolor); background: color-mix(in srgb, var(--color-warning) 14%, var(--color-darkbg)); }
    .vault-section-head .color-chip { flex: none; width: .7rem; height: .7rem; }
    .vault-section-head :global(svg) { flex: none; }
    .vault-section-head h3 { min-width: 0; flex: 1 1 auto; margin: 0; overflow: hidden; color: var(--color-textcolor); font-size: .8rem; font-weight: 700; text-overflow: ellipsis; white-space: nowrap; }
    .vault-section-head small { flex: none; font: 600 .66rem ui-monospace, monospace; opacity: .75; }
    .vault-section-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 12rem), 1fr)); grid-auto-rows: max-content; gap: .65rem; }
    .vault-section-empty { margin: 0; padding: .9rem .75rem; border: 1px dashed var(--color-darkborderc); border-radius: .55rem; color: var(--color-textcolor2); font-size: .74rem; line-height: 1.5; }
    .character-card { position: relative; width: 100%; min-width: 0; aspect-ratio: 1; align-self: start; isolation: isolate; overflow: hidden; cursor: grab; border: 1px solid var(--color-darkborderc); border-radius: .55rem; background: color-mix(in srgb, var(--color-darkbg) 88%, var(--color-selected) 12%); transition: border-color 120ms ease, opacity 120ms ease, transform 120ms ease; }
    .character-card:hover { transform: translateY(-1px); border-color: var(--color-borderc); }
    .character-card:focus-visible { outline: 2px solid var(--color-warning); outline-offset: 2px; }
    .character-card.selected { border-color: var(--color-warning); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--color-warning) 35%, transparent); }
    .character-card.dragging { cursor: grabbing; opacity: .42; transform: scale(.98); }
    .portrait { position: absolute; inset: 0; display: grid; place-items: center; overflow: hidden; background: color-mix(in srgb, var(--color-selected) 45%, var(--color-darkbg)); color: var(--color-textcolor2); }
    .portrait img { width: 100%; height: 100%; object-fit: cover; object-position: top; }
    .select-character, .pin-character, .open-character, .rename-character { position: absolute; z-index: 2; display: grid; width: 1.55rem; height: 1.55rem; place-items: center; border: 1px solid color-mix(in srgb, var(--color-media-text) 22%, transparent); border-radius: .38rem; background: color-mix(in srgb, var(--color-media-bg) 62%, transparent); color: var(--color-media-text); backdrop-filter: blur(6px); }
    .select-character { left: .38rem; }
    .package-badge { position: absolute; z-index: 1; top: 2.15rem; left: .38rem; padding: .05rem .38rem; border: 1px solid color-mix(in srgb, var(--color-media-text) 22%, transparent); border-radius: .3rem; background: color-mix(in srgb, var(--color-media-bg) 62%, transparent); color: var(--color-media-text); font-size: .68rem; font-weight: 600; line-height: 1.4; letter-spacing: .02em; pointer-events: none; backdrop-filter: blur(6px); }
    .select-character, .pin-character { top: .38rem; }
    .pin-character, .open-character { right: .38rem; }
    .open-character { bottom: .38rem; }
    .rename-character { bottom: .38rem; left: .38rem; }
    .open-character:hover, .rename-character:hover { border-color: var(--color-warning); color: var(--color-warning); }
    .select-character[aria-pressed=true] { border-color: var(--color-warning-border); background: var(--color-warning); color: var(--color-on-warning); }
    .pin-character.pinned { color: var(--color-warning); }
    .character-caption { position: absolute; z-index: 1; inset: 0; display: grid; place-items: center; padding: 2.35rem; background: color-mix(in srgb, var(--color-media-bg) 72%, transparent); opacity: 0; pointer-events: none; text-align: center; transition: opacity 160ms ease; }
    .character-card:hover .character-caption, .character-card:focus-visible .character-caption, .character-card:focus-within .character-caption { opacity: 1; }
    .character-caption strong { display: block; max-width: 100%; overflow: hidden; color: var(--color-media-text); font-size: clamp(1rem, 1.65vw, 1.4rem); font-weight: 800; line-height: 1.2; overflow-wrap: anywhere; text-shadow: 0 .12rem .5rem color-mix(in srgb, var(--color-shadow) 72%, transparent); text-wrap: balance; }
    .empty-vault { grid-column: 1 / -1; display: flex; min-height: 12rem; align-items: center; justify-content: center; gap: .45rem; color: var(--color-textcolor2); font-size: .8rem; }
    .bulk-dock { display: flex; flex: none; flex-wrap: wrap; align-items: center; gap: .5rem; margin: 0 .75rem .75rem; padding: .55rem; border: 1px solid color-mix(in srgb, var(--color-warning) 45%, var(--color-darkborderc)); border-radius: .55rem; background: color-mix(in srgb, var(--color-darkbg) 91%, var(--color-warning) 9%); box-shadow: 0 .9rem 2.4rem color-mix(in srgb, var(--color-shadow) 36%, transparent); }
    .bulk-dock strong { color: var(--color-textcolor); font-size: .74rem; white-space: nowrap; }
    .bulk-dock select { width: 9rem; }
    .bulk-actions { display: flex; min-width: 0; flex: 1 1 auto; flex-wrap: wrap; gap: .5rem; }
    .vault-notice { min-height: 1rem; margin: 0; color: var(--color-textcolor2); font-size: .7rem; }
    @container character-vault (max-width: 50rem) {
        .vault-shell { grid-template-columns: 1fr; grid-template-rows: minmax(0, 1fr); }
        .vault-rail { position: absolute; z-index: 6; top: 0; bottom: 0; left: 0; width: min(18rem, 86%); max-height: none; visibility: hidden; border-right: 1px solid var(--color-darkborderc); box-shadow: 1rem 0 2.5rem color-mix(in srgb, var(--color-shadow) 48%, transparent); pointer-events: none; transform: translateX(-105%); transition: transform 180ms ease-out; }
        .vault-rail.open { visibility: visible; pointer-events: auto; transform: translateX(0); }
        .folder-sidebar-scrim { position: absolute; z-index: 5; inset: 0; display: block; width: 100%; height: 100%; border: 0; border-radius: 0; background: color-mix(in srgb, var(--color-shadow) 58%, transparent); }
        .folder-sidebar-toggle { display: grid; width: 2.75rem; height: 2.75rem; flex: none; place-items: center; border: 1px solid var(--color-darkborderc); border-radius: .48rem; background: var(--color-darkbg); color: var(--color-textcolor); touch-action: manipulation; }
        .rail-actions .folder-sidebar-close { display: grid; width: 2.75rem; height: 2.75rem; }
        .vault-rail > button, .folder-row > button:first-child { min-height: 2.75rem; }
        .folder-pin { display: grid; width: 2.75rem; height: 2.75rem; place-items: center; }
        .folder-editor { grid-template-columns: 1fr 1fr; }
        .cover-control { grid-column: 1 / -1; }
        .vault-toolbar { flex-wrap: wrap; gap: .5rem; padding: .6rem; }
        .vault-search { min-height: 2.75rem; flex: 1 1 calc(100% - 3.25rem); }
        .character-sort { height: 2.75rem; flex: 1 1 auto; }
        .character-sort select { min-width: 0; flex: 1; }
        .vault-toolbar :global(button) { min-height: 2.75rem; }
        .bulk-dock { display: grid; grid-template-columns: 1fr; margin: 0 .6rem .6rem; }
        .bulk-dock select { width: 100%; height: 2.75rem; }
        .bulk-actions { display: grid; width: 100%; grid-template-columns: repeat(2, minmax(0, 1fr)); }
        .bulk-actions :global(button) { width: 100%; min-height: 2.75rem; white-space: normal; }
        .character-grid { grid-template-columns: repeat(auto-fill, minmax(min(100%, 8.5rem), 1fr)); gap: .5rem; padding: .6rem; }
        .character-grid.grouped { gap: 1rem; padding-top: 0; }
        .vault-section-grid { grid-template-columns: repeat(auto-fill, minmax(min(100%, 8.5rem), 1fr)); gap: .5rem; }
        .select-character, .pin-character, .open-character, .rename-character { width: 2.25rem; height: 2.25rem; }
    }
    @media (max-width: 720px) {
        :global(.character-vault-dialog) { width: 100vw !important; max-width: 100vw !important; height: 100dvh !important; max-height: 100dvh; min-width: 0; min-height: 0; border-radius: 0; }
        :global(.character-vault-dialog [data-manager-window-resize]) { display: none; }
    }
    @media (prefers-reduced-motion: reduce) {
        .vault-rail { transition: none; }
    }
</style>
