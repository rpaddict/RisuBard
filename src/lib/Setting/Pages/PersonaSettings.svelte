<script lang="ts">
    import { onDestroy, onMount, tick, untrack } from 'svelte'
    import Sortable from 'sortablejs/modular/sortable.core.esm.js'
    import { v4 } from 'uuid'
    import { BrushIcon, Maximize2Icon, PlusIcon, SparklesIcon } from '@lucide/svelte'
    import { language } from 'src/lang'
    import SettingPage from 'src/lib/UI/GUI/SettingPage.svelte'
    import Help from 'src/lib/Others/Help.svelte'
    import TextAreaInput from 'src/lib/UI/GUI/TextAreaInput.svelte'
    import TextInput from 'src/lib/UI/GUI/TextInput.svelte'
    import SolarBoldIcon from 'src/lib/UI/Icons/SolarBoldIcon.svelte'
    import ShButton from 'src/lib/UI/GUI/ShButton.svelte'
    import PersonaBuilder from '../../Others/PersonaBuilder.svelte'
    import PersonaPortraitDialog from '../../Others/PersonaPortraitDialog.svelte'
    import { alertConfirm, alertSelect, notifySuccess } from 'src/ts/alert'
    import { getCharImage } from 'src/ts/characters'
    import { tooltip } from 'src/ts/gui/tooltip'
    import {
        changeUserPersona,
        exportUserPersona,
        importUserPersona,
        saveUserPersona,
        selectPersonaImg,
    } from 'src/ts/persona'
    import { DBState, popUpEditorStore, selectedCharID } from 'src/ts/stores.svelte'
    import { requestImmediateSave } from 'src/ts/globalApi.svelte'
    import {
        clonePersonaToStore,
        ensureCharacterPersonas,
        getCharacterPersonas,
        type PersonaScope,
        type PersonaSelection,
    } from 'src/ts/personaScopes'
    import { saveImage, type RisuPersona } from 'src/ts/storage/database.svelte'
    import { sortableOptions } from 'src/ts/util'

    type PersonaManagerScope = 'global' | 'character'
    const PERSONA_GRID_HEIGHT_KEY = 'risubard-persona-grid-height'
    const PERSONA_DESCRIPTION_HEIGHT_KEY = 'risubard-persona-description-height'
    const MIN_PERSONA_GRID_HEIGHT = 112
    const MAX_PERSONA_GRID_HEIGHT = 520
    const MIN_DESCRIPTION_HEIGHT = 160
    const MAX_DESCRIPTION_HEIGHT = 720

    let { embedded = false, initialSelection = null, onSelect }: {
        embedded?: boolean
        initialSelection?: PersonaSelection | null
        onSelect?: (selection: PersonaSelection) => void
    } = $props()
    let activeScope = $state<PersonaManagerScope>(
        untrack(() => initialSelection?.scope ?? 'global'),
    )
    let globalSelectedIndex = $state(untrack(() =>
        initialSelection?.scope === 'global' && onSelect
            ? initialSelection.index
            : DBState.db.selectedPersona,
    ))
    let characterSelectedIndex = $state(untrack(() =>
        initialSelection?.scope === 'character' ? initialSelection.index : 0,
    ))
    let editingPersona = $state<RisuPersona | null>(null)
    let gridElement = $state<HTMLDivElement>()
    let sortable: Sortable | null = null
    let personaGridHeight = $state(204)
    let descriptionHeight = $state(240)
    let popupEditorTimer: ReturnType<typeof setInterval> | null = null
    let stopPersonaGridResize: (() => void) | null = null
    let stopDescriptionResize: (() => void) | null = null
    let personaBuilderOpen = $state(false)
    let personaBuilderTarget = $state<RisuPersona | null>(null)
    let portraitOpen = $state(false)
    let portraitTarget = $state<RisuPersona | null>(null)

    const currentCharacter = $derived(DBState.db.characters[$selectedCharID])

    function activeStore(scope: PersonaScope = activeScope): RisuPersona[] {
        if (scope === 'global') return DBState.db.personas
        return currentCharacter ? getCharacterPersonas(currentCharacter) : []
    }

    function editableStore(): RisuPersona[] {
        if (activeScope === 'global') return DBState.db.personas
        return currentCharacter ? ensureCharacterPersonas(currentCharacter) : []
    }

    function selectedIndex(): number {
        if (activeScope === 'character') return characterSelectedIndex
        return onSelect ? globalSelectedIndex : DBState.db.selectedPersona
    }

    function syncGlobalLegacyFields(): void {
        if (activeScope !== 'global' || !editingPersona) return
        // A binding picker can edit a different persona from the global selection.
        if (editingPersona !== DBState.db.personas[DBState.db.selectedPersona]) return
        DBState.db.username = editingPersona.name
        DBState.db.userIcon = editingPersona.icon
        DBState.db.personaPrompt = editingPersona.personaPrompt
        DBState.db.userNote = editingPersona.note ?? ''
    }

    function bindCharacterPersona(persona: RisuPersona): void {
        const chat = currentCharacter?.chats?.[currentCharacter.chatPage]
        if (!chat) return
        persona.id ??= v4()
        chat.bindedPersona = persona.id
    }

    function selectPersona(index: number, bindToChat = true, saveCurrent = true): void {
        const store = activeStore()
        if (store.length === 0) {
            editingPersona = null
            characterSelectedIndex = 0
            return
        }
        const safeIndex = Math.min(Math.max(index, 0), store.length - 1)
        if (activeScope === 'global') {
            if (onSelect) globalSelectedIndex = safeIndex
            else changeUserPersona(safeIndex, saveCurrent ? 'save' : 'noSave')
        } else {
            characterSelectedIndex = safeIndex
            if (bindToChat) bindCharacterPersona(store[safeIndex])
        }
        editingPersona = store[safeIndex]
        void requestImmediateSave()
    }

    function choosePersona(index: number): void {
        selectPersona(index, !onSelect)
        if (!onSelect) return
        const persona = activeStore()[index]
        if (!persona) return
        persona.id ??= v4()
        onSelect({ persona, index, scope: activeScope })
        void requestImmediateSave()
    }

    function switchScope(scope: PersonaManagerScope): void {
        if (scope === activeScope) return
        syncGlobalLegacyFields()
        activeScope = scope
        selectPersona(scope === 'global' ? (onSelect ? globalSelectedIndex : DBState.db.selectedPersona) : characterSelectedIndex, false)
        void resetSortable()
    }

    function createPersona(): RisuPersona {
        return { name: 'New Persona', icon: '', personaPrompt: '', note: '', id: v4() }
    }

    async function addPersona(): Promise<void> {
        if (activeScope === 'character' && !currentCharacter) return
        const selection = parseInt(await alertSelect([language.createfromScratch, language.importCharacter]))
        const store = editableStore()
        let persona: RisuPersona | null = null
        if (selection === 0) {
            persona = createPersona()
            store.push(persona)
        } else if (selection === 1) {
            persona = await importUserPersona(store)
        }
        if (!persona) return
        selectPersona(store.indexOf(persona))
    }

    async function importPersona(): Promise<void> {
        if (activeScope === 'character' && !currentCharacter) return
        const store = editableStore()
        const imported = await importUserPersona(store)
        if (imported) selectPersona(store.indexOf(imported))
    }

    function duplicateGlobalPersona(): void {
        const source = editingPersona
        if (!source) return
        if (activeScope === 'global') saveUserPersona()
        const store = editableStore()
        const clone = clonePersonaToStore(source, store, v4)
        selectPersona(store.indexOf(clone))
    }

    function cloneGlobalPersonaToCharacter(): void {
        const source = editingPersona
        if (activeScope !== 'global' || !source || !currentCharacter) return
        saveUserPersona()
        const characterPersonas = ensureCharacterPersonas(currentCharacter)
        const clone = clonePersonaToStore(source, characterPersonas, v4)
        activeScope = 'character'
        characterSelectedIndex = characterPersonas.indexOf(clone)
        editingPersona = clone
        bindCharacterPersona(clone)
        void requestImmediateSave()
    }

    function cloneCharacterPersonaToGlobal(): void {
        if (activeScope !== 'character' || !editingPersona) return
        const clone = clonePersonaToStore(editingPersona, DBState.db.personas, v4)
        activeScope = 'global'
        const index = DBState.db.personas.indexOf(clone)
        changeUserPersona(index, 'noSave')
        editingPersona = clone
        void resetSortable()
        void requestImmediateSave()
    }

    async function removePersona(): Promise<void> {
        const store = editableStore()
        if (!editingPersona || (activeScope === 'global' && store.length === 1)) return
        if (!await alertConfirm(`${language.removeConfirm}${editingPersona.name}`)) return

        const removedId = editingPersona.id
        store.splice(selectedIndex(), 1)
        if (activeScope === 'character') {
            for (const chat of currentCharacter?.chats ?? []) {
                if (removedId && chat.bindedPersona === removedId) chat.bindedPersona = ''
            }
            characterSelectedIndex = Math.min(characterSelectedIndex, store.length - 1)
        }
        selectPersona(activeScope === 'global' ? 0 : characterSelectedIndex, false, false)
        void requestImmediateSave()
    }

    function destroySortable(): void {
        sortable?.destroy()
        sortable = null
    }

    function initializeSortable(): void {
        destroySortable()
        if (!gridElement) return
        sortable = Sortable.create(gridElement, {
            onEnd: () => {
                const store = activeStore()
                const selected = editingPersona
                const order = Array.from(gridElement.querySelectorAll<HTMLElement>('[data-risu-idx]'))
                    .map((element) => Number(element.dataset.risuIdx))
                const reordered = order.map((index) => store[index]).filter(Boolean)
                if (activeScope === 'global') {
                    DBState.db.personas = reordered
                    const index = Math.max(0, reordered.indexOf(selected!))
                    changeUserPersona(index, 'noSave')
                } else if (currentCharacter) {
                    currentCharacter.personas = reordered
                    characterSelectedIndex = Math.max(0, reordered.indexOf(selected!))
                }
                editingPersona = selected
                void requestImmediateSave()
            },
            ...sortableOptions,
        })
    }

    async function resetSortable(): Promise<void> {
        await tick()
        initializeSortable()
    }

    async function replacePersonaImage(): Promise<void> {
        if (!editingPersona) return
        if (await selectPersonaImg(editingPersona)) {
            syncGlobalLegacyFields()
            void requestImmediateSave()
        }
    }

    function openPortraitDialog(): void {
        if (!editingPersona) return
        portraitTarget = editingPersona
        portraitOpen = true
    }

    async function assignPortrait(png: Uint8Array): Promise<void> {
        const target = portraitTarget
        if (!target) return
        target.icon = await saveImage(png)
        target.id ??= v4()
        if (target === editingPersona) syncGlobalLegacyFields()
        await requestImmediateSave()
    }

    function togglePortraitMode(): void {
        if (!editingPersona) return
        editingPersona.largePortrait = !editingPersona.largePortrait
        syncGlobalLegacyFields()
        void requestImmediateSave()
    }

    function normalizeDescriptionHeight(value: number): number {
        if (!Number.isFinite(value)) return 240
        return Math.min(MAX_DESCRIPTION_HEIGHT, Math.max(MIN_DESCRIPTION_HEIGHT, Math.round(value)))
    }

    function normalizePersonaGridHeight(value: number): number {
        if (!Number.isFinite(value)) return 204
        return Math.min(MAX_PERSONA_GRID_HEIGHT, Math.max(MIN_PERSONA_GRID_HEIGHT, Math.round(value)))
    }

    function persistPersonaGridHeight(): void {
        personaGridHeight = normalizePersonaGridHeight(personaGridHeight)
        localStorage.setItem(PERSONA_GRID_HEIGHT_KEY, String(personaGridHeight))
    }

    function startPersonaGridResize(event: PointerEvent): void {
        event.preventDefault()
        const startY = event.clientY
        const startHeight = personaGridHeight
        stopPersonaGridResize?.()

        const update = (moveEvent: PointerEvent) => {
            personaGridHeight = normalizePersonaGridHeight(startHeight + moveEvent.clientY - startY)
        }
        const stop = () => {
            window.removeEventListener('pointermove', update)
            window.removeEventListener('pointerup', stop)
            persistPersonaGridHeight()
            stopPersonaGridResize = null
        }
        stopPersonaGridResize = stop
        window.addEventListener('pointermove', update)
        window.addEventListener('pointerup', stop, { once: true })
    }

    function resizePersonaGridByKeyboard(event: KeyboardEvent): void {
        if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
        event.preventDefault()
        personaGridHeight = normalizePersonaGridHeight(
            personaGridHeight + (event.key === 'ArrowDown' ? 16 : -16),
        )
        persistPersonaGridHeight()
    }

    function persistDescriptionHeight(): void {
        descriptionHeight = normalizeDescriptionHeight(descriptionHeight)
        localStorage.setItem(PERSONA_DESCRIPTION_HEIGHT_KEY, String(descriptionHeight))
    }

    function startDescriptionResize(event: PointerEvent): void {
        event.preventDefault()
        const startY = event.clientY
        const startHeight = descriptionHeight
        stopDescriptionResize?.()

        const update = (moveEvent: PointerEvent) => {
            descriptionHeight = normalizeDescriptionHeight(startHeight + moveEvent.clientY - startY)
        }
        const stop = () => {
            window.removeEventListener('pointermove', update)
            window.removeEventListener('pointerup', stop)
            persistDescriptionHeight()
            stopDescriptionResize = null
        }
        stopDescriptionResize = stop
        window.addEventListener('pointermove', update)
        window.addEventListener('pointerup', stop, { once: true })
    }

    function resizeDescriptionByKeyboard(event: KeyboardEvent): void {
        if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
        event.preventDefault()
        descriptionHeight = normalizeDescriptionHeight(
            descriptionHeight + (event.key === 'ArrowDown' ? 16 : -16),
        )
        persistDescriptionHeight()
    }

    function openDescriptionEditor(): void {
        if (!editingPersona) return
        popUpEditorStore.value = editingPersona.personaPrompt
        popUpEditorStore.mode = 'default'
        popUpEditorStore.language = 'markdown'
        popUpEditorStore.open = true
        if (popupEditorTimer) clearInterval(popupEditorTimer)
        popupEditorTimer = setInterval(() => {
            if (popUpEditorStore.open || !editingPersona) return
            editingPersona.personaPrompt = popUpEditorStore.value
            syncGlobalLegacyFields()
            void requestImmediateSave()
            if (popupEditorTimer) clearInterval(popupEditorTimer)
            popupEditorTimer = null
        }, 100)
    }

    function openPersonaBuilder(): void {
        if (!editingPersona) return
        personaBuilderTarget = editingPersona
        personaBuilderOpen = true
    }

    async function copyPersonaBuilderDraft(draft: string): Promise<void> {
        if (!editingPersona || editingPersona !== personaBuilderTarget) return
        if (editingPersona.personaPrompt.trim()
            && editingPersona.personaPrompt.trim() !== draft.trim()
            && !await alertConfirm(language.settingsWorkspace.personaManager.builder.copyConfirm)) return
        editingPersona.personaPrompt = draft
        syncGlobalLegacyFields()
        await requestImmediateSave()
        notifySuccess(language.settingsWorkspace.personaManager.builder.copied)
    }

    $effect(() => {
        if (activeScope !== 'global' || !editingPersona) return
        editingPersona.name
        editingPersona.icon
        editingPersona.personaPrompt
        editingPersona.note
        syncGlobalLegacyFields()
    })

    onMount(() => {
        const storedGridHeight = Number(localStorage.getItem(PERSONA_GRID_HEIGHT_KEY))
        const storedHeight = Number(localStorage.getItem(PERSONA_DESCRIPTION_HEIGHT_KEY))
        if (storedGridHeight) personaGridHeight = normalizePersonaGridHeight(storedGridHeight)
        if (storedHeight) descriptionHeight = normalizeDescriptionHeight(storedHeight)
        selectPersona(
            activeScope === 'global' ? globalSelectedIndex : characterSelectedIndex,
            false,
            false,
        )
        initializeSortable()
    })
    onDestroy(() => {
        syncGlobalLegacyFields()
        destroySortable()
        if (popupEditorTimer) clearInterval(popupEditorTimer)
        stopPersonaGridResize?.()
        stopDescriptionResize?.()
    })
</script>

<SettingPage title={language.persona} showTitle={!embedded}>
    <div data-persona-scope-tabs class="persona-scope-tabs" role="tablist" aria-label={language.persona}>
        <button role="tab" aria-selected={activeScope === 'global'} class:active={activeScope === 'global'} onclick={() => switchScope('global')}>
            <SolarBoldIcon name="earth" size={17} />
            {language.settingsWorkspace.personaManager.globalTab}
        </button>
        <button role="tab" aria-selected={activeScope === 'character'} class:active={activeScope === 'character'} onclick={() => switchScope('character')}>
            <SolarBoldIcon name="people-nearby" size={17} />
            {language.settingsWorkspace.personaManager.characterTab}
        </button>
    </div>

    {#if activeScope === 'character' && !currentCharacter}
        <div class="persona-empty">{language.settingsWorkspace.personaManager.noCharacter}</div>
    {:else}
        <div class="persona-grid-shell">
            <div data-persona-grid class="persona-grid" style:height={`${personaGridHeight}px`} bind:this={gridElement}>
                {#each activeStore() as persona, i (persona.id ?? i)}
                    <button data-risu-idx={i} class="persona-tile" class:selected={i === selectedIndex()} aria-label={persona.name} title={persona.name} use:tooltip={persona.name} onclick={() => choosePersona(i)}>
                        {#if persona.icon}
                            {#await getCharImage(persona.icon, 'plain')}
                                <span class="persona-placeholder"></span>
                            {:then image}
                                <img src={image} alt="" />
                            {/await}
                        {:else}
                            <span class="persona-placeholder"></span>
                        {/if}
                    </button>
                {/each}
                <button
                    data-persona-create
                    class="persona-create"
                    aria-label={language.settingsWorkspace.personaManager.create}
                    title={language.settingsWorkspace.personaManager.create}
                    use:tooltip={language.settingsWorkspace.personaManager.create}
                    onclick={addPersona}
                ><PlusIcon size={22} /></button>
            </div>
            <button
                data-persona-grid-resizer
                class="persona-grid-resizer"
                aria-label={language.settingsWorkspace.personaManager.resizeList}
                title={language.settingsWorkspace.personaManager.resizeList}
                use:tooltip={language.settingsWorkspace.personaManager.resizeList}
                onpointerdown={startPersonaGridResize}
                onkeydown={resizePersonaGridByKeyboard}
            ><span></span></button>
        </div>

        {#if activeScope === 'character' && activeStore().length === 0}
            <div class="persona-empty compact">{language.settingsWorkspace.personaManager.noCharacterPersonas}</div>
        {/if}

        {#if editingPersona}
            <div class="persona-editor">
                <div class="portrait-column">
                    <div class="portrait-wrap">
                        <button
                            class="portrait-button"
                            onclick={replacePersonaImage}
                            aria-label={language.settingsWorkspace.personaManager.changeImage}
                            title={language.settingsWorkspace.personaManager.changeImage}
                            use:tooltip={language.settingsWorkspace.personaManager.changeImage}
                        >
                            {#if editingPersona.icon}
                                {#await getCharImage(editingPersona.icon, editingPersona.largePortrait ? 'lgcss' : 'css')}
                                    <span class="persona-placeholder large"></span>
                                {:then imageStyle}
                                    <span class="persona-portrait" style={imageStyle}></span>
                                {/await}
                            {:else}
                                <span class="persona-placeholder large"></span>
                            {/if}
                        </button>
                        <button
                            data-persona-portrait-mode
                            class="portrait-mode-button"
                            aria-label={editingPersona.largePortrait
                                ? language.settingsWorkspace.personaManager.useSquareImage
                                : language.settingsWorkspace.personaManager.usePortraitImage}
                            title={editingPersona.largePortrait
                                ? language.settingsWorkspace.personaManager.useSquareImage
                                : language.settingsWorkspace.personaManager.usePortraitImage}
                            use:tooltip={editingPersona.largePortrait
                                ? language.settingsWorkspace.personaManager.useSquareImage
                                : language.settingsWorkspace.personaManager.usePortraitImage}
                            onclick={togglePortraitMode}
                        ><SolarBoldIcon name="smartphone-rotate-2" size={17} /></button>
                        <button
                            data-persona-portrait-open
                            class="portrait-mode-button portrait-ai-button"
                            aria-label={language.settingsWorkspace.personaManager.portrait.launch}
                            title={language.settingsWorkspace.personaManager.portrait.launch}
                            use:tooltip={language.settingsWorkspace.personaManager.portrait.launch}
                            onclick={openPortraitDialog}
                        ><BrushIcon size={16} /></button>
                    </div>
                </div>
                <div class="fields">
                    <label data-persona-field="name" class="field-row">
                        <span class="field-label">{language.name} <Help key="personaName" /></span>
                        <TextInput className="field-input" placeholder="User" bind:value={editingPersona.name} />
                    </label>
                    <label data-persona-field="note" class="field-row">
                        <span class="field-label">{language.note} <Help key="personaNote" /></span>
                        <TextInput className="field-input" bind:value={editingPersona.note} placeholder={language.personaNotePlaceholder} />
                    </label>
                </div>
                <section data-persona-description class="description-section">
                    <div class="description-heading">
                        <span class="field-label">{language.description} <Help key="personaDescription" /></span>
                        <button
                            class="popup-editor-button"
                            aria-label={language.settingsWorkspace.personaManager.openDescriptionEditor}
                            title={language.settingsWorkspace.personaManager.openDescriptionEditor}
                            use:tooltip={language.settingsWorkspace.personaManager.openDescriptionEditor}
                            onclick={openDescriptionEditor}
                        ><Maximize2Icon size={16} /></button>
                    </div>
                    <div class="description-editor" style:height={`${descriptionHeight}px`}>
                        <TextAreaInput
                            height="full"
                            actionBar={false}
                            autocomplete="off"
                            bind:value={editingPersona.personaPrompt}
                            placeholder="Put the description of this persona here."
                        />
                    </div>
                    <button
                        data-persona-description-resizer
                        class="description-resizer"
                        aria-label={language.settingsWorkspace.personaManager.resizeDescription}
                        title={language.settingsWorkspace.personaManager.resizeDescription}
                        use:tooltip={language.settingsWorkspace.personaManager.resizeDescription}
                        onpointerdown={startDescriptionResize}
                        onkeydown={resizeDescriptionByKeyboard}
                    ><span></span></button>
                    <div class="builder-launch">
                        <ShButton
                            data-persona-builder-open
                            variant="soft-primary"
                            size="sm"
                            onclick={openPersonaBuilder}
                        ><SparklesIcon size={15} />{language.settingsWorkspace.personaManager.builder.launch}</ShButton>
                    </div>
                </section>
                <div class="action-toolbar" aria-label={language.persona}>
                    <button
                        class="icon-button"
                        aria-label={language.settingsWorkspace.personaManager.duplicate}
                        title={language.settingsWorkspace.personaManager.duplicate}
                        use:tooltip={language.settingsWorkspace.personaManager.duplicate}
                        onclick={duplicateGlobalPersona}
                    ><SolarBoldIcon name="copy" size={18} /></button>
                    {#if activeScope === 'global'}
                        <button
                            class="icon-button"
                            disabled={!currentCharacter}
                            aria-label={language.settingsWorkspace.personaManager.cloneToCharacter}
                            title={language.settingsWorkspace.personaManager.cloneToCharacter}
                            use:tooltip={language.settingsWorkspace.personaManager.cloneToCharacter}
                            onclick={cloneGlobalPersonaToCharacter}
                        ><SolarBoldIcon name="people-nearby" size={19} /></button>
                    {:else}
                        <button
                            class="icon-button"
                            aria-label={language.settingsWorkspace.personaManager.cloneToGlobal}
                            title={language.settingsWorkspace.personaManager.cloneToGlobal}
                            use:tooltip={language.settingsWorkspace.personaManager.cloneToGlobal}
                            onclick={cloneCharacterPersonaToGlobal}
                        ><SolarBoldIcon name="earth" size={19} /></button>
                    {/if}
                    <button
                        class="icon-button"
                        aria-label={language.settingsWorkspace.personaManager.export}
                        title={language.settingsWorkspace.personaManager.export}
                        use:tooltip={language.settingsWorkspace.personaManager.export}
                        onclick={() => exportUserPersona(editingPersona!)}
                    ><SolarBoldIcon name="export" size={18} /></button>
                    <button
                        class="icon-button"
                        aria-label={language.settingsWorkspace.personaManager.import}
                        title={language.settingsWorkspace.personaManager.import}
                        use:tooltip={language.settingsWorkspace.personaManager.import}
                        onclick={importPersona}
                    ><SolarBoldIcon name="import" size={18} /></button>
                    <button
                        class="icon-button danger"
                        disabled={activeScope === 'global' && activeStore().length === 1}
                        aria-label={language.settingsWorkspace.personaManager.remove}
                        title={language.settingsWorkspace.personaManager.remove}
                        use:tooltip={language.settingsWorkspace.personaManager.remove}
                        onclick={removePersona}
                    ><SolarBoldIcon name="trash-bin-trash" size={18} /></button>
                </div>
            </div>
        {/if}
    {/if}
</SettingPage>

{#if personaBuilderTarget}
    <PersonaBuilder
        bind:open={personaBuilderOpen}
        personaName={personaBuilderTarget.name}
        currentDescription={personaBuilderTarget.personaPrompt}
        onCopyDraft={copyPersonaBuilderDraft}
    />
{/if}

{#if portraitTarget}
    <PersonaPortraitDialog bind:open={portraitOpen} persona={portraitTarget} onAssign={assignPortrait} />
{/if}

<style>
    .persona-scope-tabs { display: flex; gap: .25rem; min-width: 0; margin-bottom: .75rem; padding: .25rem; overflow-x: auto; border: 1px solid var(--color-darkborderc); border-radius: var(--risu-radius-xl); background: var(--color-surface-raised); }
    .persona-scope-tabs button { flex: 1 1 0; display: inline-flex; align-items: center; justify-content: center; gap: .4rem; min-width: 5.5rem; padding: .52rem .75rem; border-radius: calc(var(--risu-radius-lg) * 1.1); color: var(--color-textcolor2); font-size: .84rem; font-weight: 650; }
    .persona-scope-tabs button.active { color: var(--color-textcolor); background: var(--color-selected); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--color-borderc) 40%, transparent); }
    .persona-grid-shell { width: 100%; }
    .persona-grid { display: flex; flex-wrap: wrap; align-content: flex-start; gap: .65rem; width: 100%; overflow-y: auto; padding: 1rem; border: 1px solid var(--color-darkborderc); border-radius: calc(var(--risu-radius-lg) * 1.3); background: var(--color-surface-raised); scrollbar-gutter: stable; }
    .persona-grid-resizer { width: 100%; height: .75rem; display: grid; place-items: center; cursor: row-resize; touch-action: none; }
    .persona-grid-resizer span { width: 2.75rem; height: .2rem; border-radius: 999px; background: var(--color-darkborderc); transition: width .15s ease, background .15s ease; }
    .persona-grid-resizer:hover span, .persona-grid-resizer:focus-visible span { width: 3.5rem; background: var(--color-borderc); }
    .persona-tile, .persona-create { flex: 0 0 auto; width: 5rem; height: 5rem; overflow: hidden; border: 2px solid transparent; border-radius: calc(var(--risu-radius-lg) * 1.1); background: var(--color-textcolor2); box-shadow: var(--risu-shadow-floating, 0 .4rem 1rem color-mix(in srgb, var(--color-shadow) 12%, transparent)); transition: border-color .16s ease, transform .16s ease, background .16s ease; }
    .persona-tile:hover, .persona-create:hover { transform: translateY(-1px); }
    .persona-tile.selected { border-color: var(--color-primary); }
    .persona-create { display: grid; place-items: center; border-color: var(--color-darkborderc); color: var(--color-textcolor2); background: color-mix(in srgb, var(--color-selected) 34%, var(--color-darkbg)); box-shadow: none; }
    .persona-create:hover { border-color: var(--color-borderc); color: var(--color-textcolor); background: var(--color-selected); }
    .persona-tile img, .persona-placeholder, .persona-portrait { display: block; width: 100%; height: 100%; object-fit: cover; object-position: top; }
    .persona-placeholder { background: color-mix(in srgb, var(--color-textcolor2) 65%, var(--color-darkbg)); }
    .persona-editor { display: grid; grid-template-columns: 8.5rem minmax(0, 1fr); gap: 1rem 1.25rem; width: 100%; margin-top: .75rem; padding: 1rem; border: 1px solid var(--color-darkborderc); border-radius: calc(var(--risu-radius-lg) * 1.3); background: var(--color-surface-raised); }
    .portrait-column { min-width: 0; }
    .portrait-wrap { position: relative; width: 8.5rem; height: 8.5rem; }
    .portrait-button, .persona-placeholder.large { width: 8.5rem; height: 8.5rem; overflow: hidden; border-radius: calc(var(--risu-radius-lg) * 1.2); }
    .portrait-button { display: block; box-shadow: var(--risu-shadow-overlay, 0 .5rem 1.5rem color-mix(in srgb, var(--color-shadow) 16%, transparent)); }
    .portrait-mode-button { position: absolute; right: .45rem; bottom: .45rem; width: 2rem; height: 2rem; display: grid; place-items: center; border: 1px solid color-mix(in srgb, var(--color-textcolor) 26%, transparent); border-radius: var(--risu-radius-lg); color: var(--color-textcolor); background: color-mix(in srgb, var(--color-darkbg) 86%, transparent); box-shadow: var(--risu-shadow-floating, 0 .3rem .8rem color-mix(in srgb, var(--color-shadow) 28%, transparent)); backdrop-filter: blur(6px); }
    .portrait-mode-button:hover { background: var(--color-selected); }
    .portrait-ai-button { right: auto; left: .45rem; }
    .fields { display: flex; min-width: 0; flex-direction: column; justify-content: center; gap: .75rem; }
    .field-row { display: grid; grid-template-columns: 4.25rem minmax(0, 1fr); align-items: center; gap: .75rem; }
    .field-label { display: inline-flex; align-items: center; gap: .2rem; color: var(--color-textcolor2); font-size: .82rem; white-space: nowrap; }
    .field-row :global(.field-input) { min-width: 0; margin: 0; }
    .description-section { grid-column: 1 / -1; min-width: 0; }
    .description-heading { display: flex; align-items: center; justify-content: space-between; min-height: 2rem; margin-bottom: .35rem; }
    .popup-editor-button { width: 2rem; height: 2rem; display: grid; place-items: center; border-radius: calc(var(--risu-radius-lg) * 0.9); color: var(--color-textcolor2); }
    .popup-editor-button:hover { color: var(--color-textcolor); background: var(--color-selected); }
    .description-editor { min-height: 10rem; overflow: hidden; border-radius: calc(var(--risu-radius-lg) * 1.1); background: var(--color-surface-inset); }
    .description-editor :global(> div) { height: 100%; min-height: 0; }
    .description-resizer { width: 100%; height: .75rem; display: grid; place-items: center; cursor: row-resize; touch-action: none; }
    .description-resizer span { width: 2.75rem; height: .2rem; border-radius: 999px; background: var(--color-darkborderc); transition: width .15s ease, background .15s ease; }
    .description-resizer:hover span, .description-resizer:focus-visible span { width: 3.5rem; background: var(--color-borderc); }
    .builder-launch { display: flex; justify-content: flex-end; margin-top: .25rem; }
    .action-toolbar { grid-column: 1 / -1; display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: .45rem; padding-top: .85rem; border-top: 1px solid var(--color-darkborderc); }
    .icon-button { width: 2.35rem; height: 2.35rem; display: grid; place-items: center; border: 1px solid var(--color-darkborderc); border-radius: calc(var(--risu-radius-lg) * 1.16); color: var(--color-textcolor2); background: color-mix(in srgb, var(--color-darkbg) 78%, transparent); transition: color .15s ease, border-color .15s ease, background .15s ease, transform .15s ease; }
    .icon-button:hover:not(:disabled) { transform: translateY(-1px); border-color: var(--color-borderc); color: var(--color-textcolor); background: var(--color-selected); }
    .icon-button.danger:hover:not(:disabled) { border-color: color-mix(in srgb, var(--color-draculared) 70%, var(--color-darkborderc)); color: var(--color-draculared); background: color-mix(in srgb, var(--color-draculared) 12%, var(--color-darkbg)); }
    .icon-button:disabled { cursor: not-allowed; opacity: .38; }
    .persona-empty { padding: 2.5rem 1rem; border: 1px dashed var(--color-darkborderc); border-radius: calc(var(--risu-radius-lg) * 1.3); color: var(--color-textcolor2); text-align: center; }
    .persona-empty.compact { margin-top: .75rem; padding: 1rem; }
    @media (max-width: 600px) {
        .persona-editor { grid-template-columns: 1fr; }
        .portrait-column { display: flex; justify-content: center; }
        .description-section, .action-toolbar { grid-column: 1; }
        .field-row { grid-template-columns: 3.75rem minmax(0, 1fr); }
    }
</style>
