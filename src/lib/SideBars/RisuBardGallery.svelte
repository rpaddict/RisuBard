<script lang="ts">
    import {
        ArrowDownIcon,
        ArrowLeftIcon,
        ArrowUpIcon,
        ChevronDownIcon,
        FolderPlusIcon,
        ImageIcon,
        PencilIcon,
        PlusIcon,
        TrashIcon,
    } from '@lucide/svelte'
    import { tick } from 'svelte'
    import { v4 } from 'uuid'

    import Chat from '../ChatScreens/Chat.svelte'
    import ShButton from '../UI/GUI/ShButton.svelte'
    import { language } from 'src/lang'
    import { alertConfirm, alertInput } from 'src/ts/alert'
    import { requestImmediateSave } from 'src/ts/globalApi.svelte'
    import { createSimpleCharacter } from 'src/ts/stores.svelte'
    import type {
        character,
        Message,
        RisuBardGallery,
        RisuBardGallerySlot,
    } from 'src/ts/storage/database.svelte'
    import {
        createGallerySlot,
        getGalleryPreviewMessage,
        getVisibleGalleryMessages,
        mergeLegacyChatGalleries,
        moveGallerySlot,
        moveGallerySlotByDrop,
        moveGallerySlotsToCategory,
        normalizeGallerySlotSize,
    } from 'src/ts/risubard/gallery'
    import { findCharacterbyId, getUserName } from 'src/ts/util'

    interface Props {
        chara: character
        customStyle?: string
        onClose?: () => void
    }

    let { chara, customStyle = '', onClose = () => {} }: Props = $props()
    let selectedSlotId = $state('')
    let editingSlotId = $state('')
    let editMode = $state(false)
    let adding = $state(false)
    let editingGalleryTitle = $state(false)
    let galleryTitleDraft = $state('')
    let inlineEditingSlotId = $state('')
    let inlineTitleDraft = $state('')
    let selectedSlotIds = $state(new Set<string>())
    let collapsedCategoryIds = $state(new Set<string>())
    let draggedSlotId = $state('')
    let moveTargetCategoryId = $state('')
    let draftTitle = $state('')
    let draftHideUserMessages = $state(false)
    let rangeStart = $state(0)
    let rangeEnd = $state(0)
    let draftError = $state('')
    let galleryViewportElement = $state<HTMLElement>()
    let galleryRevision = $state(0)

    let currentChat = $derived(chara.chats?.[chara.chatPage])
    let gallery = $derived.by(() => {
        void galleryRevision
        return chara.risuBardGallery
    })
    let slots = $derived(gallery?.slots ?? [])
    let categories = $derived(gallery?.categories ?? [])
    let categoryIds = $derived(new Set(categories.map((category) => category.id)))
    let unclassifiedSlots = $derived(
        slots.filter((slot) => !slot.categoryId || !categoryIds.has(slot.categoryId))
    )
    let selectedSlot = $derived(slots.find((slot) => slot.id === selectedSlotId))
    let editingSlot = $derived(slots.find((slot) => slot.id === editingSlotId))
    let displayTitle = $derived(
        gallery?.title?.trim()
        || language.galleryDefaultTitle(chara.name || language.Chat)
    )
    let slotWidth = $derived(normalizeGallerySlotSize(gallery?.slotWidth ?? 160, 160))
    let slotHeight = $derived(normalizeGallerySlotSize(gallery?.slotHeight ?? 160, 160))
    let simpleCharacter = $derived(createSimpleCharacter(chara))
    let sourceMessages = $derived.by((): Message[] => {
        if (!currentChat || currentChat._placeholder) return []

        const greeting = currentChat.fmIndex === undefined || currentChat.fmIndex === -1
            ? chara.firstMessage
            : chara.alternateGreetings[currentChat.fmIndex]
        const messages = [...currentChat.message]
        if (greeting?.trim()) {
            messages.unshift({
                role: 'char',
                data: greeting,
                name: chara.name,
            })
        }
        return messages
    })
    let canCreate = $derived(
        draftTitle.trim().length > 0
        && Number.isInteger(rangeStart)
        && Number.isInteger(rangeEnd)
        && rangeStart >= 0
        && rangeEnd >= rangeStart
        && rangeEnd < sourceMessages.length
    )

    $effect(() => {
        if (chara.risuBardGallery) return
        const migrated = mergeLegacyChatGalleries(
            chara.chats ?? [],
            chara.chatPage,
            language.galleryDefaultTitle(chara.name || language.Chat),
        )
        if (!migrated) return
        chara.risuBardGallery = migrated
        galleryRevision += 1
        void requestImmediateSave()
    })

    function galleryValue(): RisuBardGallery {
        return {
            title: gallery?.title ?? language.galleryDefaultTitle(chara.name || language.Chat),
            slotWidth: gallery?.slotWidth,
            slotHeight: gallery?.slotHeight,
            categories: [...categories],
            slots: [...slots],
        }
    }

    function persist(nextGallery: RisuBardGallery): void {
        chara.risuBardGallery = nextGallery
        galleryRevision += 1
        void requestImmediateSave()
    }

    function persistSlots(nextSlots: RisuBardGallerySlot[]): void {
        persist({ ...galleryValue(), slots: nextSlots })
    }

    function beginGalleryTitleEdit(): void {
        galleryTitleDraft = displayTitle
        editingGalleryTitle = true
    }

    function saveGalleryTitle(): void {
        const title = galleryTitleDraft.trim()
            || language.galleryDefaultTitle(chara.name || language.Chat)
        persist({ ...galleryValue(), title })
        editingGalleryTitle = false
    }

    async function createCategory(): Promise<void> {
        const name = (await alertInput(language.galleryCategoryNamePrompt) ?? '').trim()
        if (!name) return
        const id = v4()
        persist({
            ...galleryValue(),
            categories: [...categories, { id, name }],
        })
        moveTargetCategoryId = id
    }

    function toggleSlotSelection(slotId: string): void {
        const next = new Set(selectedSlotIds)
        if (next.has(slotId)) next.delete(slotId)
        else next.add(slotId)
        selectedSlotIds = next
    }

    function moveSelectedSlots(): void {
        if (selectedSlotIds.size === 0) return
        persistSlots(moveGallerySlotsToCategory(
            slots,
            selectedSlotIds,
            moveTargetCategoryId || undefined,
        ))
        selectedSlotIds = new Set()
    }

    function toggleEditMode(): void {
        editMode = !editMode
        if (editMode) return
        adding = false
        editingSlotId = ''
        selectedSlotIds = new Set()
        draggedSlotId = ''
    }

    function saveSlotDimension(
        key: 'slotWidth' | 'slotHeight',
        rawValue: string,
        input: HTMLInputElement,
    ): void {
        const fallback = key === 'slotWidth' ? slotWidth : slotHeight
        const value = normalizeGallerySlotSize(rawValue, fallback)
        input.value = `${value}px`
        persist({ ...galleryValue(), [key]: value })
    }

    function toggleCategory(categoryId: string): void {
        const next = new Set(collapsedCategoryIds)
        if (next.has(categoryId)) next.delete(categoryId)
        else next.add(categoryId)
        collapsedCategoryIds = next
    }

    const galleryDragType = 'application/x-risubard-gallery-slot'

    function handleDragStart(event: DragEvent, slotId: string): void {
        draggedSlotId = slotId
        if (!event.dataTransfer) return
        event.dataTransfer.effectAllowed = 'move'
        event.dataTransfer.setData(galleryDragType, slotId)
    }

    function acceptsGalleryDrag(event: DragEvent): boolean {
        return Boolean(draggedSlotId)
            || Boolean(event.dataTransfer?.types.includes(galleryDragType))
    }

    function handleDragOver(event: DragEvent): void {
        if (!acceptsGalleryDrag(event)) return
        event.preventDefault()
        event.stopPropagation()
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
    }

    function draggedIdFrom(event: DragEvent): string {
        return event.dataTransfer?.getData(galleryDragType) || draggedSlotId
    }

    function handleSlotDrop(event: DragEvent, targetId: string): void {
        if (!acceptsGalleryDrag(event)) return
        event.preventDefault()
        event.stopPropagation()
        const draggedId = draggedIdFrom(event)
        if (!draggedId || draggedId === targetId) return

        const rect = event.currentTarget instanceof HTMLElement
            ? event.currentTarget.getBoundingClientRect()
            : undefined
        const relativeX = rect ? (event.clientX - rect.left) / rect.width : 0
        const relativeY = rect ? (event.clientY - rect.top) / rect.height : 0
        const placement = relativeX + relativeY > 1 ? 'after' : 'before'
        persistSlots(moveGallerySlotByDrop(slots, draggedId, targetId, placement))
        draggedSlotId = ''
    }

    function handleCategoryDrop(event: DragEvent, categoryId?: string): void {
        if (!acceptsGalleryDrag(event)) return
        event.preventDefault()
        event.stopPropagation()
        const draggedId = draggedIdFrom(event)
        if (!draggedId) return

        let next = moveGallerySlotsToCategory(slots, new Set([draggedId]), categoryId)
        const categoryPeers = next.filter((slot) => (
            slot.id !== draggedId && slot.categoryId === categoryId
        ))
        const lastSlot = categoryPeers[categoryPeers.length - 1]
        if (lastSlot) next = moveGallerySlotByDrop(next, draggedId, lastSlot.id, 'after')
        persistSlots(next)
        draggedSlotId = ''
    }

    function beginAdd(): void {
        draftTitle = ''
        draftHideUserMessages = false
        rangeStart = Math.max(0, sourceMessages.length - 2)
        rangeEnd = Math.max(0, sourceMessages.length - 1)
        draftError = ''
        selectedSlotId = ''
        editingSlotId = ''
        adding = true
    }

    function addSlot(): void {
        if (!canCreate) {
            draftError = draftTitle.trim()
                ? language.galleryRangeInvalid
                : language.galleryTitleRequired
            return
        }

        const slot = {
            ...createGallerySlot({
                id: v4(),
                title: draftTitle.trim(),
                summary: '',
                sourceChatId: currentChat?.id,
                sourceChatName: currentChat?.name || language.Chat,
                messages: sourceMessages,
                startIndex: rangeStart,
                endIndex: rangeEnd,
                createdAt: Date.now(),
            }),
            previewMessageIndex: 0,
            hideUserMessages: draftHideUserMessages,
        }
        persistSlots([...slots, slot])
        adding = false
    }

    function updateSlot(slotId: string, update: Partial<RisuBardGallerySlot>): void {
        persistSlots(slots.map((slot) => slot.id === slotId ? { ...slot, ...update } : slot))
    }

    function updateMessage(slot: RisuBardGallerySlot, index: number, data: string): void {
        const messages = slot.messages.map((message, messageIndex) => (
            messageIndex === index ? { ...message, data } : message
        ))
        updateSlot(slot.id, { messages })
    }

    function moveSlot(from: number, to: number): void {
        persistSlots(moveGallerySlot(slots, from, to))
    }

    async function removeSlot(slotId: string): Promise<void> {
        if (!await alertConfirm(language.galleryDeleteConfirm)) return
        persistSlots(slots.filter((slot) => slot.id !== slotId))
        selectedSlotIds.delete(slotId)
        selectedSlotIds = new Set(selectedSlotIds)
        if (selectedSlotId === slotId) selectedSlotId = ''
        if (editingSlotId === slotId) editingSlotId = ''
    }

    function openSlot(slotId: string): void {
        if (editMode) {
            editSlot(slotId)
            return
        }
        adding = false
        editingSlotId = ''
        selectedSlotId = slotId
        resetGalleryScroll()
    }

    function editSlot(slotId: string): void {
        adding = false
        selectedSlotId = ''
        editingSlotId = slotId
        resetGalleryScroll()
    }

    function returnToGallery(): void {
        adding = false
        selectedSlotId = ''
        editingSlotId = ''
        resetGalleryScroll()
    }

    function resetGalleryScroll(): void {
        void tick().then(() => {
            const scrollHost = galleryViewportElement?.closest('[data-gallery-scroll]') as HTMLElement | null
            if (scrollHost) scrollHost.scrollTop = 0
        })
    }

    function beginInlineTitleEdit(event: MouseEvent, slot: RisuBardGallerySlot): void {
        event.stopPropagation()
        inlineEditingSlotId = slot.id
        inlineTitleDraft = slot.title
    }

    function saveInlineTitle(slotId: string): void {
        const title = inlineTitleDraft.trim()
        if (title) updateSlot(slotId, { title })
        inlineEditingSlotId = ''
    }

    function focusAndSelect(node: HTMLInputElement): void {
        node.focus()
        node.select()
    }

    function categorySlots(categoryId: string): RisuBardGallerySlot[] {
        return slots.filter((slot) => slot.categoryId === categoryId)
    }

    function speakerName(message: Message): string {
        if (message.name?.trim()) return message.name
        if (message.role === 'user') return getUserName()
        if (message.saying) return findCharacterbyId(message.saying)?.name ?? chara.name
        return chara.name
    }

    function preview(message?: Message): string {
        const text = previewText(message)
        return text.length > 54 ? `${text.slice(0, 54)}…` : text
    }

    function previewText(message?: Message): string {
        return message?.data.replace(/\s+/g, ' ').trim() ?? ''
    }

    function formatDate(value: number): string {
        return new Date(value).toLocaleDateString()
    }
</script>

{#snippet memoryCard(slot: RisuBardGallerySlot)}
    {@const previewMessage = getGalleryPreviewMessage(slot)}
    <article
        data-gallery-slot
        role="listitem"
        class="memory-card"
        class:memory-card--selected={selectedSlotIds.has(slot.id)}
        class:memory-card--dragging={draggedSlotId === slot.id}
        draggable={editMode}
        aria-grabbed={editMode && draggedSlotId === slot.id}
        ondragstart={(event) => handleDragStart(event, slot.id)}
        ondragend={() => { draggedSlotId = '' }}
        ondragover={handleDragOver}
        ondrop={(event) => handleSlotDrop(event, slot.id)}
    >
        {#if editMode}
            <label class="memory-card__select" aria-label={language.gallerySelectedCount(1)}>
                <input
                    data-gallery-select-slot
                    type="checkbox"
                    checked={selectedSlotIds.has(slot.id)}
                    onchange={() => toggleSlotSelection(slot.id)}
                />
            </label>
        {/if}
        <div class="memory-card__open">
            {#if editMode && inlineEditingSlotId === slot.id}
                <input
                    data-gallery-slot-title-input
                    class="memory-card__title-input"
                    bind:value={inlineTitleDraft}
                    aria-label={language.galleryTitle}
                    use:focusAndSelect
                    onblur={() => saveInlineTitle(slot.id)}
                    onkeydown={(event) => {
                        if (event.key === 'Enter') saveInlineTitle(slot.id)
                        if (event.key === 'Escape') inlineEditingSlotId = ''
                    }}
                />
            {:else}
                <button
                    type="button"
                    data-gallery-slot-title
                    class="memory-card__title"
                    onclick={(event) => editMode
                        ? beginInlineTitleEdit(event, slot)
                        : openSlot(slot.id)}
                >{slot.title}</button>
            {/if}
            {#if previewMessage}
                <button
                    type="button"
                    class="memory-card__preview"
                    onclick={() => openSlot(slot.id)}
                >
                    {previewText(previewMessage)}
                </button>
            {/if}
        </div>
        {#if editMode}
            <div class="memory-card__controls">
                <button
                    type="button"
                    data-gallery-slot-delete
                    class="memory-card__delete"
                    aria-label={language.galleryDeleteSlot}
                    onclick={() => void removeSlot(slot.id)}
                >
                    <TrashIcon size={14} />
                </button>
            </div>
        {/if}
    </article>
{/snippet}

<section
    bind:this={galleryViewportElement}
    data-risubard-gallery-viewport
    class="gallery-viewport"
    style={customStyle}
>
    <div
        class="gallery-shell"
        class:gallery-shell--editing={editMode}
        style={`--gallery-slot-width: ${slotWidth}px; --gallery-slot-height: ${slotHeight}px`}
    >
        {#if selectedSlot || editingSlot}
            <header class="gallery-subtoolbar">
                <button
                    type="button"
                    data-gallery-back
                    class="gallery-back"
                    onclick={returnToGallery}
                >
                    <ArrowLeftIcon size={18} />
                    <span>{language.galleryBack}</span>
                </button>
                <strong>{selectedSlot?.title ?? editingSlot?.title}</strong>
            </header>
        {:else}
        <header data-gallery-list-toolbar class="gallery-toolbar">
            <div class="gallery-toolbar__nav">
                <button
                    type="button"
                    data-gallery-close
                    class="gallery-exit"
                    aria-label={language.galleryBackToChat}
                    title={language.galleryBackToChat}
                    onclick={onClose}
                >
                    <ArrowLeftIcon size={18} />
                    <span>{language.galleryBackToChat}</span>
                </button>
            </div>
            <div class="gallery-toolbar__title">
                {#if editingGalleryTitle}
                    <input
                        data-gallery-title-input
                        bind:value={galleryTitleDraft}
                        aria-label={language.galleryTitle}
                        onblur={saveGalleryTitle}
                        onkeydown={(event) => {
                            if (event.key === 'Enter') saveGalleryTitle()
                            if (event.key === 'Escape') editingGalleryTitle = false
                        }}
                    />
                {:else}
                    <h2>{displayTitle}</h2>
                    <button
                        type="button"
                        data-gallery-title-edit
                        aria-label={language.galleryEditTitle}
                        onclick={beginGalleryTitleEdit}
                    >
                        <PencilIcon size={15} />
                    </button>
                {/if}
            </div>
            <div class="gallery-toolbar__actions">
                {#if editMode}
                    <div class="slot-size-controls">
                    <label title={language.gallerySlotWidth}>
                        <span>W</span>
                        <input
                            data-gallery-slot-width
                            value={`${slotWidth}px`}
                            inputmode="numeric"
                            aria-label={language.gallerySlotWidth}
                            onchange={(event) => saveSlotDimension('slotWidth', event.currentTarget.value, event.currentTarget)}
                        />
                    </label>
                    <label title={language.gallerySlotHeight}>
                        <span>H</span>
                        <input
                            data-gallery-slot-height
                            value={`${slotHeight}px`}
                            inputmode="numeric"
                            aria-label={language.gallerySlotHeight}
                            onchange={(event) => saveSlotDimension('slotHeight', event.currentTarget.value, event.currentTarget)}
                        />
                    </label>
                    </div>
                {/if}
                {#if editMode && selectedSlotIds.size > 0}
                    <span class="selection-count">{language.gallerySelectedCount(selectedSlotIds.size)}</span>
                    <label class="move-target">
                        <span class="sr-only">{language.galleryMoveTo}</span>
                        <select bind:value={moveTargetCategoryId}>
                            <option value="">{language.galleryUncategorized}</option>
                            {#each categories as category (category.id)}
                                <option value={category.id}>{category.name}</option>
                            {/each}
                        </select>
                    </label>
                    <ShButton variant="secondary" size="sm" onclick={moveSelectedSlots}>
                        {language.galleryMove}
                    </ShButton>
                {/if}
                {#if editMode}
                    <ShButton data-gallery-new-category variant="secondary" size="sm" onclick={() => void createCategory()}>
                        <FolderPlusIcon size={15} />
                        {language.galleryNewCategory}
                    </ShButton>
                    <ShButton
                        data-gallery-new-memory
                        variant="primary"
                        size="sm"
                        disabled={sourceMessages.length === 0}
                        onclick={beginAdd}
                    >
                        <PlusIcon size={15} />
                        {language.galleryNewMemory}
                    </ShButton>
                {/if}
                <ShButton
                    data-gallery-edit-toggle
                    variant={editMode ? 'primary' : 'secondary'}
                    size="sm"
                    aria-pressed={editMode}
                    onclick={toggleEditMode}
                >
                    <PencilIcon size={15} />
                    {editMode ? language.galleryDone : language.galleryEditMode}
                </ShButton>
            </div>
        </header>
        {/if}

        <div class="gallery-content">
        {#if selectedSlot}
            <section data-gallery-reader class="scene-reader">
                <header class="scene-reader__header">
                    <p>{selectedSlot.sourceChatName} · {formatDate(selectedSlot.createdAt)}</p>
                </header>
                <div class="scene-reader__messages">
                    {#each getVisibleGalleryMessages(selectedSlot) as message, index}
                        <Chat
                            character={message.saying || simpleCharacter}
                            name={speakerName(message)}
                            message={message.data}
                            role={message.role}
                            idx={index}
                            isLastMemory={false}
                            readOnly
                        />
                    {/each}
                </div>
            </section>
        {:else if editingSlot}
            <section class="memory-editor">
                <div class="memory-editor__heading">
                    <strong>{language.galleryEditMemory}</strong>
                    <div class="memory-editor__toolbar">
                        <label class="visibility-toggle">
                            <input
                                data-gallery-hide-user-messages
                                type="checkbox"
                                checked={editingSlot.hideUserMessages === true}
                                onchange={(event) => updateSlot(editingSlot.id, {
                                    hideUserMessages: event.currentTarget.checked,
                                })}
                            />
                            <span>{language.galleryHideUserMessages}</span>
                        </label>
                        <ShButton variant="secondary" size="sm" onclick={() => { editingSlotId = '' }}>
                            {language.galleryDone}
                        </ShButton>
                    </div>
                </div>
                <div class="memory-editor__fields">
                    <label>
                        <span>{language.galleryTitle}</span>
                        <input
                            value={editingSlot.title}
                            onchange={(event) => updateSlot(editingSlot.id, { title: event.currentTarget.value })}
                        />
                    </label>
                    <label>
                        <span>{language.galleryPreviewMessage}</span>
                        <select
                            data-gallery-preview-message
                            value={editingSlot.previewMessageIndex ?? 0}
                            onchange={(event) => updateSlot(editingSlot.id, {
                                previewMessageIndex: Number(event.currentTarget.value),
                            })}
                        >
                            {#each editingSlot.messages as message, messageIndex}
                                <option value={messageIndex}>
                                    #{messageIndex + 1} · {speakerName(message)} · {preview(message)}
                                </option>
                            {/each}
                        </select>
                    </label>
                </div>
                <details open>
                    <summary>
                        {language.galleryEditMessages}
                        <span>{editingSlot.messages.length}{language.galleryMessages}</span>
                    </summary>
                    <div class="message-editors">
                        {#each editingSlot.messages as message, messageIndex}
                            <label>
                                <span>#{messageIndex + 1} · {speakerName(message)}</span>
                                <textarea
                                    data-gallery-message-editor
                                    value={message.data}
                                    rows="3"
                                    onchange={(event) => updateMessage(editingSlot, messageIndex, event.currentTarget.value)}
                                ></textarea>
                            </label>
                        {/each}
                    </div>
                </details>
                <footer class="memory-editor__footer">
                    <div class="memory-editor__order">
                        <button
                            type="button"
                            aria-label={language.galleryMoveEarlier}
                            disabled={slots.indexOf(editingSlot) === 0}
                            onclick={() => moveSlot(slots.indexOf(editingSlot), slots.indexOf(editingSlot) - 1)}
                        ><ArrowUpIcon size={15} /></button>
                        <button
                            type="button"
                            aria-label={language.galleryMoveLater}
                            disabled={slots.indexOf(editingSlot) === slots.length - 1}
                            onclick={() => moveSlot(slots.indexOf(editingSlot), slots.indexOf(editingSlot) + 1)}
                        ><ArrowDownIcon size={15} /></button>
                    </div>
                    <button type="button" class="delete-slot" onclick={() => void removeSlot(editingSlot.id)}>
                        <TrashIcon size={15} />
                        {language.remove}
                    </button>
                </footer>
            </section>
        {:else}
            {#if adding}
                <section class="new-memory">
                    <div class="new-memory__heading">
                        <strong>{language.galleryNewScene}</strong>
                        <span>{currentChat?.name ?? language.Chat}</span>
                    </div>
                    <label>
                        <span>{language.galleryTitle}</span>
                        <input data-gallery-title bind:value={draftTitle} placeholder={language.galleryTitlePlaceholder} />
                    </label>
                    <div class="range-grid">
                        <label>
                            <span>{language.galleryStartMessage}</span>
                            <select data-gallery-range-start bind:value={rangeStart}>
                                {#each sourceMessages as message, index}
                                    <option value={index}>#{index + 1} · {speakerName(message)} · {preview(message)}</option>
                                {/each}
                            </select>
                        </label>
                        <label>
                            <span>{language.galleryEndMessage}</span>
                            <select data-gallery-range-end bind:value={rangeEnd}>
                                {#each sourceMessages as message, index}
                                    <option value={index}>#{index + 1} · {speakerName(message)} · {preview(message)}</option>
                                {/each}
                            </select>
                        </label>
                    </div>
                    <label class="visibility-toggle">
                        <input
                            data-gallery-hide-user-messages
                            type="checkbox"
                            bind:checked={draftHideUserMessages}
                        />
                        <span>{language.galleryHideUserMessages}</span>
                    </label>
                    {#if draftError}<p class="new-memory__error">{draftError}</p>{/if}
                    <div class="new-memory__actions">
                        <ShButton variant="ghost" size="sm" onclick={() => { adding = false }}>{language.cancel}</ShButton>
                        <ShButton variant="primary" size="sm" disabled={!canCreate} onclick={addSlot}>
                            {language.gallerySaveScene}
                        </ShButton>
                    </div>
                </section>
            {/if}

            <div class="gallery-sections">
                {#if unclassifiedSlots.length > 0 || draggedSlotId}
                    <div
                        class="memory-grid"
                        class:memory-grid--empty={unclassifiedSlots.length === 0}
                        role="list"
                        aria-label={language.galleryUncategorized}
                        ondragover={handleDragOver}
                        ondrop={(event) => handleCategoryDrop(event)}
                    >
                        {#each unclassifiedSlots as slot (slot.id)}{@render memoryCard(slot)}{/each}
                    </div>
                {/if}

                {#each categories as category (category.id)}
                    {@const memories = categorySlots(category.id)}
                    <section
                        data-gallery-category
                        role="group"
                        aria-label={category.name}
                        class="gallery-category"
                        class:gallery-category--collapsed={collapsedCategoryIds.has(category.id)}
                        ondragover={handleDragOver}
                        ondrop={(event) => handleCategoryDrop(event, category.id)}
                    >
                        <header>
                            <button
                                type="button"
                                data-gallery-category-toggle
                                aria-expanded={!collapsedCategoryIds.has(category.id)}
                                onclick={() => toggleCategory(category.id)}
                            >
                                <ChevronDownIcon size={16} />
                                <strong>{category.name}</strong>
                                <span class="gallery-category__count">{memories.length}</span>
                            </button>
                            <span class="gallery-category__line"></span>
                        </header>
                        {#if !collapsedCategoryIds.has(category.id)}
                            {#if memories.length > 0}
                                <div class="memory-grid" role="list">
                                    {#each memories as slot (slot.id)}{@render memoryCard(slot)}{/each}
                                </div>
                            {:else}
                                <p class="gallery-category__empty">{language.galleryCategoryEmpty}</p>
                            {/if}
                        {/if}
                    </section>
                {/each}

                {#if slots.length === 0 && categories.length === 0 && !adding}
                    <div class="gallery-empty">
                        <ImageIcon size={30} />
                        <strong>{language.galleryEmpty}</strong>
                        <p>{language.galleryEmptyDescription}</p>
                    </div>
                {/if}
            </div>
        {/if}
        </div>
    </div>
</section>

<style>
    .gallery-viewport {
        display: flex;
        box-sizing: border-box;
        width: 100%;
        min-height: 100%;
        min-width: 0;
        overflow: visible;
        padding: 1rem;
        background:
            radial-gradient(circle at 85% 0%, color-mix(in srgb, var(--color-primary) 15%, transparent), transparent 32%),
            linear-gradient(150deg, color-mix(in srgb, var(--color-darkbg) 94%, var(--color-selected)), var(--color-darkbg));
    }
    .gallery-shell { display: flex; width: 100%; min-width: 0; flex-direction: column; gap: 1rem; }
    .gallery-toolbar, .gallery-subtoolbar { position: sticky; z-index: 4; top: 0; display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr); flex: 0 0 auto; align-items: center; gap: 0; padding: 0.25rem 0 0.75rem; border-bottom: 1px solid var(--color-darkborderc); background: color-mix(in srgb, var(--color-darkbg) 96%, transparent); }
    .gallery-toolbar__nav, .gallery-back { justify-self: end; margin-right: 0.65rem; }
    .gallery-subtoolbar > strong { justify-self: center; min-width: 0; max-width: min(32rem, 45vw); overflow: hidden; color: var(--color-textcolor); font-size: 1rem; text-align: center; text-overflow: ellipsis; white-space: nowrap; }
    .gallery-toolbar__title, .gallery-toolbar__actions, .memory-editor__heading, .memory-editor__toolbar, .memory-editor__footer, .memory-editor__order { display: flex; align-items: center; gap: 0.5rem; }
    .gallery-toolbar__nav { display: flex; min-width: 0; }
    .gallery-toolbar__title { min-width: 0; justify-self: center; }
    .gallery-toolbar__title h2 { overflow: hidden; margin: 0; color: var(--color-textcolor); font-size: 1.35rem; text-overflow: ellipsis; white-space: nowrap; }
    .gallery-toolbar__title button, .memory-editor__order button { display: grid; place-items: center; padding: 0.4rem; border-radius: calc(var(--risu-radius-lg) * 0.9); color: var(--color-textcolor2); }
    .gallery-toolbar__title button:hover, .memory-editor__order button:hover:not(:disabled) { color: var(--color-textcolor); background: var(--color-selected); }
    .gallery-exit { display: inline-flex; align-items: center; gap: 0.4rem; border: 1px solid var(--color-darkborderc); border-radius: var(--risu-radius-lg); padding: 0.45rem 0.6rem; background: color-mix(in srgb, var(--color-darkbg) 78%, var(--color-selected)); color: var(--color-textcolor); font-size: 0.82rem; font-weight: 650; white-space: nowrap; }
    .gallery-toolbar__title input { width: min(26rem, 42vw); font-size: 1.15rem; font-weight: 650; }
    .gallery-toolbar__actions { min-width: 0; flex-wrap: wrap; justify-content: flex-end; justify-self: end; }
    .selection-count { color: var(--color-textcolor2); font-size: 0.8rem; }
    input, textarea, select { width: 100%; border: 1px solid var(--color-darkborderc); border-radius: var(--risu-radius-lg); background: color-mix(in srgb, var(--color-darkbg) 78%, var(--color-selected)); color: var(--color-textcolor); padding: 0.55rem 0.65rem; outline: none; }
    input:focus, textarea:focus, select:focus { border-color: var(--color-primary); }
    .slot-size-controls { display: flex; align-items: center; gap: 0.4rem; padding-right: 0.25rem; }
    .slot-size-controls label { display: flex; align-items: center; gap: 0.25rem; color: var(--color-textcolor2); font-size: 0.72rem; font-weight: 700; }
    .slot-size-controls input { width: 4.75rem; padding: 0.42rem 0.5rem; font-variant-numeric: tabular-nums; }
    .move-target select { width: auto; min-width: 8rem; }
    .gallery-content { width: 100%; min-width: 0; }
    .gallery-sections, .scene-reader, .memory-editor { min-height: 0; overflow: visible; padding-right: 0.25rem; }
    .gallery-sections { display: flex; flex: 0 0 auto; flex-direction: column; gap: 1.25rem; }
    .memory-grid { display: flex; flex-wrap: wrap; align-items: flex-start; gap: 0.8rem; min-height: 1rem; }
    .memory-grid--empty { min-height: 3.5rem; border: 1px dashed var(--color-darkborderc); border-radius: calc(var(--risu-radius-lg) * 1.4); }
    .memory-card { position: relative; box-sizing: border-box; width: var(--gallery-slot-width); height: var(--gallery-slot-height); max-width: 100%; min-width: 0; overflow: hidden; border: 1px solid var(--color-darkborderc); border-radius: calc(var(--risu-radius-2xl) * 0.8); background: color-mix(in srgb, var(--color-darkbg) 88%, var(--color-selected)); cursor: pointer; box-shadow: inset 0 1px 0 color-mix(in srgb, var(--color-textcolor) 7%, transparent); transition: border-color 140ms ease, box-shadow 140ms ease, opacity 120ms ease, transform 140ms ease; }
    .memory-card:hover { border-color: color-mix(in srgb, var(--color-primary) 55%, var(--color-darkborderc)); box-shadow: inset 0 1px 0 color-mix(in srgb, var(--color-textcolor) 9%, transparent), 0 0.65rem 1.5rem color-mix(in srgb, var(--color-shadow) 16%, transparent); transform: translateY(-2px); }
    .gallery-shell--editing .memory-card { cursor: grab; }
    .memory-card--selected { border-color: var(--color-primary); box-shadow: inset 0 0 0 1px var(--color-primary); }
    .memory-card--dragging { opacity: 0.42; transform: scale(0.98); }
    .memory-card:active { cursor: grabbing; }
    .memory-card__open { display: flex; box-sizing: border-box; width: 100%; height: 100%; min-width: 0; flex-direction: column; align-items: stretch; gap: 0.65rem; overflow: hidden; padding: 1rem; text-align: left; }
    .memory-card__select { position: absolute; z-index: 3; bottom: 0.65rem; left: 0.65rem; padding: 0.35rem; border-radius: calc(var(--risu-radius-lg) * 0.8); background: color-mix(in srgb, var(--color-darkbg) 88%, transparent); }
    .memory-card__select input { width: 1rem; height: 1rem; accent-color: var(--color-primary); }
    .memory-card__controls { position: absolute; z-index: 3; right: 0.65rem; bottom: 0.65rem; display: flex; gap: 0.25rem; padding: 0.2rem; border: 1px solid color-mix(in srgb, var(--color-darkborderc) 72%, transparent); border-radius: calc(var(--risu-radius-lg) * 1.1); background: color-mix(in srgb, var(--color-darkbg) 88%, transparent); backdrop-filter: blur(8px); }
    .memory-card__delete { display: grid; place-items: center; padding: 0.4rem; border-radius: calc(var(--risu-radius-lg) * 0.8); color: var(--color-textcolor2); }
    .memory-card__delete:hover { color: var(--color-red); background: var(--color-selected); }
    .memory-card__title { display: -webkit-box; width: 100%; min-width: 0; overflow: hidden; flex: 0 0 auto; color: var(--color-textcolor); font-size: 1rem; font-weight: 750; line-height: 1.3; overflow-wrap: anywhere; text-align: left; line-clamp: 2; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
    .memory-card__title-input { box-sizing: border-box; width: 100%; min-width: 0; flex: 0 0 auto; padding: 0.25rem 0.35rem; font-size: 0.9rem; font-weight: 700; }
    .memory-card__preview { box-sizing: border-box; width: 100%; min-width: 0; min-height: 0; overflow: hidden; flex: 1; border: 0; background: transparent; color: var(--color-textcolor2); padding: 0; font-size: 0.76rem; line-height: 1.55; overflow-wrap: anywhere; text-align: left; white-space: normal; }
    .gallery-category { display: flex; flex-direction: column; gap: 0.75rem; }
    .gallery-category > header { display: flex; align-items: center; gap: 0.65rem; color: var(--color-textcolor); }
    .gallery-category > header button { display: inline-flex; align-items: center; gap: 0.4rem; min-width: 0; border-radius: calc(var(--risu-radius-lg) * 0.9); padding: 0.25rem 0.35rem; }
    .gallery-category > header button:hover { background: var(--color-selected); }
    .gallery-category > header button :global(svg) { flex: 0 0 auto; transition: transform 140ms ease; }
    .gallery-category--collapsed > header button :global(svg) { transform: rotate(-90deg); }
    .gallery-category__count { display: inline-grid; min-width: 1.35rem; height: 1.35rem; place-items: center; border-radius: 999px; background: var(--color-selected); color: var(--color-textcolor2); font-size: 0.7rem; font-variant-numeric: tabular-nums; }
    .gallery-category__line { height: 1px; flex: 1; background: var(--color-darkborderc); }
    .gallery-category__empty { margin: 0; padding: 0.25rem 0; color: var(--color-textcolor2); font-size: 0.8rem; }
    .gallery-empty { display: grid; min-height: 12rem; place-items: center; align-content: center; gap: 0.5rem; color: var(--color-textcolor2); text-align: center; }
    .gallery-empty strong { color: var(--color-textcolor); }
    .gallery-empty p { margin: 0; }
    .new-memory, .memory-editor { border: 1px solid var(--color-darkborderc); border-radius: calc(var(--risu-radius-2xl) * 0.8); background: color-mix(in srgb, var(--color-darkbg) 88%, var(--color-selected)); padding: 1rem; }
    .new-memory { display: grid; gap: 0.8rem; }
    .new-memory label, .memory-editor label, .message-editors label { display: grid; gap: 0.35rem; color: var(--color-textcolor2); font-size: 0.8rem; }
    .new-memory__heading { display: flex; align-items: baseline; justify-content: space-between; gap: 1rem; }
    .new-memory__heading strong { color: var(--color-textcolor); }
    .new-memory__heading span { color: var(--color-textcolor2); font-size: 0.8rem; }
    .range-grid, .memory-editor__fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0.75rem; }
    .new-memory__actions { display: flex; justify-content: flex-end; gap: 0.5rem; }
    label.visibility-toggle { display: inline-flex; width: fit-content; align-items: center; gap: 0.45rem; color: var(--color-textcolor2); font-size: 0.8rem; }
    label.visibility-toggle input { width: 1rem; height: 1rem; padding: 0; accent-color: var(--color-primary); }
    .new-memory__error { margin: 0; color: var(--color-red); font-size: 0.8rem; }
    .memory-editor { display: flex; flex: 0 0 auto; flex-direction: column; gap: 1rem; }
    .memory-editor__heading, .memory-editor__footer { justify-content: space-between; }
    .memory-editor__toolbar { flex-wrap: wrap; justify-content: flex-end; }
    .memory-editor details { border-top: 1px solid var(--color-darkborderc); padding-top: 0.75rem; }
    .memory-editor summary { display: flex; cursor: pointer; justify-content: space-between; color: var(--color-textcolor); }
    .message-editors { display: grid; gap: 0.75rem; padding-top: 0.75rem; }
    .memory-editor__footer { margin-top: auto; border-top: 1px solid var(--color-darkborderc); padding-top: 0.75rem; }
    .memory-editor__order button:disabled { cursor: not-allowed; opacity: 0.35; }
    .delete-slot { display: inline-flex; align-items: center; gap: 0.35rem; color: var(--color-red); }
    .gallery-back { display: inline-flex; flex: 0 0 auto; align-items: center; gap: 0.4rem; padding: 0.45rem 0.6rem; border-radius: var(--risu-radius-lg); color: var(--color-textcolor2); font-size: 0.85rem; }
    .gallery-back:hover { color: var(--color-textcolor); background: var(--color-selected); }
    .gallery-back:focus-visible, .gallery-exit:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 2px; }
    .scene-reader { flex: 0 0 auto; }
    .scene-reader__header { padding: 0 0 0.75rem; border-bottom: 1px solid var(--color-darkborderc); }
    .scene-reader__header p { margin: 0; color: var(--color-textcolor2); font-size: 0.78rem; }
    .scene-reader__messages { display: flex; flex-direction: column; gap: 0.25rem; padding-top: 1rem; }
    @media (max-width: 700px) {
        .gallery-viewport { max-width: 100%; padding: 0.5rem; }
        .gallery-toolbar { grid-template-columns: auto minmax(0, 1fr); row-gap: 0.65rem; }
        .gallery-toolbar__nav { justify-self: start; margin-right: 0.5rem; }
        .gallery-toolbar__title { justify-self: start; }
        .gallery-toolbar__title, .gallery-toolbar__title input, .gallery-toolbar__actions { width: 100%; }
        .gallery-toolbar__actions { grid-column: 1 / -1; }
        .gallery-toolbar__actions { justify-content: flex-start; }
        .slot-size-controls { width: 100%; padding-right: 0; }
        .slot-size-controls label { flex: 1; }
        .slot-size-controls input { width: 100%; }
        .range-grid, .memory-editor__fields { grid-template-columns: 1fr; }
        .memory-editor__heading { align-items: flex-start; flex-direction: column; }
        .memory-editor__toolbar { width: 100%; justify-content: space-between; }
        .memory-grid { justify-content: center; }
        .memory-card { max-width: 100%; }
    }
</style>
