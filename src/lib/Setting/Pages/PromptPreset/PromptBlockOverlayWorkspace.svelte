<script lang="ts">
    import {
        ArrowDownToLineIcon,
        ArrowDownIcon,
        ArrowUpIcon,
        ArrowUpFromLineIcon,
        BookMarkedIcon,
        ChevronDownIcon,
        ChevronRightIcon,
        ChevronsDownIcon,
        ChevronsUpIcon,
        CircleHelpIcon,
        CopyIcon,
        PlusIcon,
        ReplaceIcon,
        Trash2Icon,
    } from '@lucide/svelte'
    import { v4 as uuidv4 } from 'uuid'
    import { language } from 'src/lang'
    import { DBState } from 'src/ts/stores.svelte'
    import { alertConfirm, alertInput, notifySuccess } from 'src/ts/alert'
    import { saveCurrentPreset } from 'src/ts/storage/database.svelte'
    import { safeStructuredClone } from 'src/ts/polyfill'
    import type {
        PromptItem,
        PromptItemAuthorNote,
        PromptItemPlain,
        PromptItemTyped,
        PromptRole,
        PromptType,
    } from 'src/ts/process/prompt'
    import {
        applyPromptBlockOverlayApplicationPreset,
        appendPromptBlockOverlayProfileFromPreset,
        composePromptBlockOverlay,
        createPromptBlockOverlayApplicationPreset,
        createPromptBlockOverlayProfileFromPreset,
        deletePromptBlockOverlayApplicationPreset,
        deletePromptBlockOverlayProfile,
        deletePromptBlockOverlayProfileBlock,
        duplicatePromptBlockOverlayProfileBlock,
        getEffectivePromptToggleTemplate,
        insertPromptBlockOverlayProfileBlock,
        movePromptBlockOverlayProfileBlock,
        normalizePromptBlockOverlay,
        overwritePromptBlockOverlayApplicationPreset,
        promptBlockOverlayItemText,
        promptBlockMatchesExtractionText,
        promptBlockOverlayReference,
        remapPromptBlockOverlayRules,
        renamePromptBlockOverlayApplicationPreset,
        resolvePromptBlockOverlayReference,
        renamePromptBlockOverlayProfile,
        selectPromptBlockOverlayProfile,
        replacePromptBlockOverlayProfileBlock,
        updatePromptBlockItemText,
        updatePromptBlockOverlayProfileBlockText,
        updatePromptBlockOverlayConfig,
        type PromptBlockOverlayConfig,
        type PromptBlockOverlayPlacement,
        type PromptBlockOverlayProfile,
        type PromptBlockOverlayProfileSettings,
        type PromptBlockOverlayRule,
    } from 'src/ts/promptBlockOverlay'
    import ShSwitch from 'src/lib/UI/GUI/ShSwitch.svelte'
    import { resizeHandle } from 'src/ts/gui/resizeHandle'
    import { tooltip } from 'src/ts/gui/tooltip'

    let search = $state('')
    let extractPresetId = $state('')
    let extractionText = $state('📙')
    let setupExpanded = $state(true)
    let applicationPresetName = $state('')
    let hydratedApplicationPresetId = $state('')
    let profileName = $state('')
    let hydratedProfileId = $state('')
    let selectedSourceIndex = $state(-1)
    let editingSourceBlocks = $state<Record<number, boolean>>({})
    let editingSourceNameIndex = $state(-1)
    let blockNameDraft = $state('')
    let expandedBlocks = $state<Record<string, boolean>>({})
    let topTools = $state<HTMLDivElement>(null!)
    let topSplitHandle = $state<HTMLButtonElement>(null!)
    let workspaceColumns = $state<HTMLDivElement>(null!)
    let splitHandle = $state<HTMLButtonElement>(null!)

    const baseItems = $derived(DBState.db.promptTemplate ?? [])
    const activePreset = $derived(DBState.db.botPresets?.[DBState.db.botPresetsId])
    const installedPresets = $derived((DBState.db.botPresets ?? []).filter(preset =>
        !!preset?.id && Array.isArray(preset.promptTemplate)
    ))
    const profiles = $derived(DBState.db.promptBlockOverlayProfiles ?? [])
    const applicationPresets = $derived(DBState.db.promptBlockOverlayApplicationPresets ?? [])
    const config = $derived(normalizePromptBlockOverlay(DBState.db.promptBlockOverlay) ?? {
        enabled: false,
        profileId: '',
        includeReferencedToggles: true,
        rules: [],
    })
    const activeProfile = $derived(profiles.find(profile => profile.id === config.profileId))
    const selectedApplicationPreset = $derived(applicationPresets.find(preset => preset.id === config.applicationPresetId))
    const sourceItems = $derived(activeProfile?.promptTemplate ?? [])
    const extractPreset = $derived(installedPresets.find(preset => preset.id === extractPresetId))
    const extractBlockCount = $derived(extractPreset?.promptTemplate?.filter(item =>
        promptBlockMatchesExtractionText(item, extractionText)).length ?? 0)
    const missingTargetRules = $derived(config.rules.filter(rule => resolvedTargetIndex(rule) < 0))
    const visibleSourceItems = $derived(sourceItems
        .map((item, index) => ({ item, index }))
        .filter(({ item }) => !search.trim()
            || blockName(item).toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())))

    $effect(() => {
        const id = config.applicationPresetId ?? ''
        if (id === hydratedApplicationPresetId) return
        hydratedApplicationPresetId = id
        applicationPresetName = applicationPresets.find(preset => preset.id === id)?.name ?? ''
    })

    $effect(() => {
        const id = activeProfile?.id ?? ''
        if (id === hydratedProfileId) return
        hydratedProfileId = id
        profileName = activeProfile?.name ?? ''
        selectedSourceIndex = -1
        editingSourceBlocks = {}
        editingSourceNameIndex = -1
        blockNameDraft = ''
    })

    function blockName(item: PromptItem, index?: number): string {
        return item.name?.trim() || `${language.promptOverlay.untitledBlock} ${(index ?? 0) + 1}`
    }

    function store(next: PromptBlockOverlayConfig) {
        DBState.db.promptBlockOverlay = next
    }

    function patchConfig(next: Partial<PromptBlockOverlayProfileSettings>) {
        store(updatePromptBlockOverlayConfig(config, next))
    }

    function selectProfile(profileId: string) {
        store(selectPromptBlockOverlayProfile(config, profileId))
    }

    function extractProfile() {
        if (!extractPreset || extractBlockCount === 0) return
        const profile = createPromptBlockOverlayProfileFromPreset(extractPreset, uuidv4(), extractionText)
        DBState.db.promptBlockOverlayProfiles = [...profiles, profile]
        selectProfile(profile.id)
    }

    function appendToProfile() {
        if (!extractPreset || !activeProfile || extractBlockCount === 0) return
        const firstAddedIndex = activeProfile.promptTemplate.length
        replaceProfileStructure(appendPromptBlockOverlayProfileFromPreset(
            activeProfile,
            extractPreset,
            extractionText,
        ))
        selectedSourceIndex = firstAddedIndex
    }

    function replaceActiveProfile(nextProfile: PromptBlockOverlayProfile) {
        DBState.db.promptBlockOverlayProfiles = profiles.map(profile =>
            profile.id === nextProfile.id ? nextProfile : profile)
    }

    function replaceProfileStructure(nextProfile: PromptBlockOverlayProfile, removedIndex = -1, replacedIndex = -1) {
        const rules = remapPromptBlockOverlayRules(
            config.rules,
            sourceItems,
            nextProfile.promptTemplate,
            removedIndex,
            replacedIndex,
        )
        store(updatePromptBlockOverlayConfig(config, { rules }))
        replaceActiveProfile(nextProfile)
    }

    function renameProfile() {
        if (!activeProfile || !profileName.trim()) return
        DBState.db.promptBlockOverlayProfiles = renamePromptBlockOverlayProfile(
            profiles,
            activeProfile.id,
            profileName,
        )
        profileName = profileName.trim()
    }

    function deleteProfile() {
        if (!activeProfile || !globalThis.confirm(language.promptOverlay.confirmDeleteProfile)) return
        DBState.db.promptBlockOverlayProfiles = deletePromptBlockOverlayProfile(profiles, activeProfile.id)
        store({ ...selectPromptBlockOverlayProfile(config, ''), applicationPresetId: undefined })
        profileName = ''
        editingSourceBlocks = {}
    }

    function canEditBlock(item: PromptItem): boolean {
        return item.type !== 'chat' && item.type !== 'cache'
    }

    function editBlockText(index: number, text: string) {
        if (!activeProfile) return
        replaceActiveProfile(updatePromptBlockOverlayProfileBlockText(activeProfile, index, text))
    }

    function replaceBlock(index: number, item: PromptItem) {
        if (!activeProfile) return
        replaceProfileStructure(
            replacePromptBlockOverlayProfileBlock(activeProfile, index, item),
            -1,
            index,
        )
    }

    function uniqueNewBlockName(): string {
        const baseName = language.promptOverlay.newBlock
        const usedNames = new Set(sourceItems.map(item => item.name ?? ''))
        if (!usedNames.has(baseName)) return baseName
        let number = 2
        while (usedNames.has(`${baseName} ${number}`)) number += 1
        return `${baseName} ${number}`
    }

    function insertNewBlockAfterSelection() {
        if (!activeProfile || selectedSourceIndex < 0) return
        const nextIndex = selectedSourceIndex + 1
        const item: PromptItem = {
            type: 'plain',
            type2: 'normal',
            text: '',
            role: 'system',
            name: uniqueNewBlockName(),
        }
        replaceProfileStructure(insertPromptBlockOverlayProfileBlock(activeProfile, selectedSourceIndex, item))
        selectedSourceIndex = nextIndex
        editingSourceBlocks = { [nextIndex]: true }
    }

    function beginBlockNameEdit(event: MouseEvent, index: number) {
        event.stopPropagation()
        selectedSourceIndex = index
        editingSourceNameIndex = index
        blockNameDraft = blockName(sourceItems[index], index)
    }

    function finishBlockNameEdit(index: number, save = true) {
        const item = sourceItems[index]
        if (save && item && blockNameDraft.trim()) replaceBlock(index, { ...item, name: blockNameDraft.trim() } as PromptItem)
        editingSourceNameIndex = -1
        blockNameDraft = ''
    }

    function makeBlockForType(item: PromptItem, type: PromptType): PromptItem {
        const name = item.name
        const text = promptBlockOverlayItemText(item)
        let next: PromptItem
        if (type === 'plain' || type === 'jailbreak' || type === 'cot') {
            next = { type, type2: 'normal', text: '', role: 'system', name }
        } else if (type === 'chatML') {
            next = { type, text: '', name }
        } else if (type === 'chat') {
            next = { type, rangeStart: -1000, rangeEnd: 'end', name }
        } else if (type === 'cache') {
            next = { type, name: name ?? '', depth: 1, role: 'all' }
        } else if (type === 'authornote') {
            next = { type, name, defaultText: '', role2: 'system' }
        } else {
            next = { type, name, role2: type === 'lorebook' || type === 'postEverything' ? undefined : 'system' }
        }
        return updatePromptBlockItemText(next, text)
    }

    function replaceBlockType(index: number, type: PromptType) {
        const item = sourceItems[index]
        if (!item || item.type === type) return
        replaceBlock(index, makeBlockForType(item, type))
    }

    function hasSpecialType(item: PromptItem): item is PromptItemPlain {
        return item.type === 'plain' || item.type === 'jailbreak' || item.type === 'cot'
    }

    function hasRole2(item: PromptItem): item is PromptItemTyped | PromptItemAuthorNote {
        return item.type === 'persona' || item.type === 'description' || item.type === 'authornote' || item.type === 'memory'
    }

    function blockRole(item: PromptItem): string {
        if (hasSpecialType(item)) return item.role
        if (hasRole2(item)) return item.role2 ?? 'system'
        if (item.type === 'cache') return item.role
        return ''
    }

    function setBlockSpecialType(index: number, type2: 'normal' | 'globalNote' | 'main') {
        const item = sourceItems[index]
        if (item && hasSpecialType(item)) replaceBlock(index, { ...item, type2 })
    }

    function setBlockRole(index: number, role: string) {
        const item = sourceItems[index]
        if (!item) return
        if (hasSpecialType(item)) replaceBlock(index, { ...item, role: role as PromptRole })
        else if (hasRole2(item)) replaceBlock(index, { ...item, role2: role as PromptRole })
        else if (item.type === 'cache') replaceBlock(index, { ...item, role: role as 'all' | 'user' | 'assistant' | 'system' })
    }

    function editResultBlock(kind: 'base' | PromptBlockOverlayPlacement, index: number, text: string) {
        if (index < 0) return
        if (kind === 'base') {
            DBState.db.promptTemplate = baseItems.map((item, itemIndex) =>
                itemIndex === index ? updatePromptBlockItemText(item, text) : item)
            return
        }
        editBlockText(index, text)
    }

    function duplicateBlock(index: number) {
        if (!activeProfile) return
        replaceProfileStructure(duplicatePromptBlockOverlayProfileBlock(
            activeProfile,
            index,
            language.promptOverlay.copySuffix,
        ))
        selectedSourceIndex = index + 1
        editingSourceBlocks = {}
    }

    function deleteBlock(index: number) {
        if (!activeProfile || !globalThis.confirm(language.promptOverlay.confirmDeleteBlock)) return
        const nextProfile = deletePromptBlockOverlayProfileBlock(activeProfile, index)
        replaceProfileStructure(nextProfile, index)
        selectedSourceIndex = nextProfile.promptTemplate.length === 0
            ? -1
            : Math.min(index, nextProfile.promptTemplate.length - 1)
        editingSourceBlocks = {}
    }

    function moveBlock(index: number, distance: number) {
        if (!activeProfile) return
        const targetIndex = Math.max(0, Math.min(sourceItems.length - 1, index + distance))
        if (targetIndex === index) return
        replaceProfileStructure(movePromptBlockOverlayProfileBlock(activeProfile, index, targetIndex))
        selectedSourceIndex = targetIndex
        editingSourceBlocks = {}
    }

    function toggleBlockEditor(event: MouseEvent, index: number) {
        event.stopPropagation()
        selectedSourceIndex = index
        editingSourceBlocks = {
            ...editingSourceBlocks,
            [index]: !editingSourceBlocks[index],
        }
    }

    function selectApplicationPreset(id: string) {
        const preset = applicationPresets.find(candidate => candidate.id === id)
        if (!preset) {
            store({ ...config, applicationPresetId: undefined })
            applicationPresetName = ''
            return
        }
        store(applyPromptBlockOverlayApplicationPreset(config, preset))
        applicationPresetName = preset.name
    }

    function saveApplicationPreset() {
        const name = applicationPresetName.trim()
        if (!name || !config.profileId) return
        const preset = createPromptBlockOverlayApplicationPreset(config, uuidv4(), name)
        DBState.db.promptBlockOverlayApplicationPresets = [...applicationPresets, preset]
        store(applyPromptBlockOverlayApplicationPreset(config, preset))
    }

    function overwriteApplicationPreset() {
        if (!selectedApplicationPreset) return
        DBState.db.promptBlockOverlayApplicationPresets = overwritePromptBlockOverlayApplicationPreset(
            applicationPresets,
            selectedApplicationPreset.id,
            config,
        )
    }

    function renameApplicationPreset() {
        const name = applicationPresetName.trim()
        if (!selectedApplicationPreset || !name || name === selectedApplicationPreset.name) return
        DBState.db.promptBlockOverlayApplicationPresets = renamePromptBlockOverlayApplicationPreset(
            applicationPresets,
            selectedApplicationPreset.id,
            name,
        )
        applicationPresetName = name
    }

    function deleteApplicationPreset() {
        if (!selectedApplicationPreset) return
        DBState.db.promptBlockOverlayApplicationPresets = deletePromptBlockOverlayApplicationPreset(
            applicationPresets,
            selectedApplicationPreset.id,
        )
        store({ ...config, applicationPresetId: undefined })
        applicationPresetName = ''
    }

    function materializedPromptTemplate(): PromptItem[] {
        const result = composePromptBlockOverlay(baseItems, profiles, config)
        return Array.isArray(result) ? result : []
    }

    async function saveComposedAsNewPreset() {
        if (!activePreset || !activeProfile) return
        const defaultName = `${activePreset.name || language.promptOverlay.untitledPreset} + ${activeProfile.name}`
        const name = (await alertInput(language.promptOverlay.newPresetNamePrompt, [], defaultName)).trim()
        if (!name) return

        const promptTemplate = materializedPromptTemplate()
        const toggleTemplate = getEffectivePromptToggleTemplate(
            DBState.db.customPromptTemplateToggle,
            profiles,
            config,
        )
        saveCurrentPreset()
        const sourcePreset = DBState.db.botPresets[DBState.db.botPresetsId]
        if (!sourcePreset) return
        const newPreset = safeStructuredClone(sourcePreset)
        newPreset.id = uuidv4()
        newPreset.name = name
        newPreset.promptTemplate = promptTemplate
        newPreset.customPromptTemplateToggle = toggleTemplate
        newPreset.promptBlockOverlay = null
        DBState.db.botPresets = [...DBState.db.botPresets, newPreset]
        notifySuccess(language.promptOverlay.savedAsNew.replace('{name}', name))
    }

    async function overwriteOriginalPreset() {
        if (!activePreset || !activeProfile) return
        if (!await alertConfirm(
            language.promptOverlay.overwriteOriginalConfirm.replace('{name}', activePreset.name || language.promptOverlay.untitledPreset),
        )) return

        DBState.db.promptTemplate = materializedPromptTemplate()
        DBState.db.customPromptTemplateToggle = getEffectivePromptToggleTemplate(
            DBState.db.customPromptTemplateToggle,
            profiles,
            config,
        )
        store({
            ...selectPromptBlockOverlayProfile(config, ''),
            applicationPresetId: undefined,
        })
        saveCurrentPreset()
        expandedBlocks = {}
        notifySuccess(language.promptOverlay.overwrittenOriginal.replace('{name}', activePreset.name || language.promptOverlay.untitledPreset))
    }

    function startTopSplitResize() {
        const availableWidth = Math.max(0, topTools.getBoundingClientRect().width - topSplitHandle.getBoundingClientRect().width)
        const initialWidth = topTools.querySelector<HTMLElement>('[data-overlay-top-pane="extract"]')?.getBoundingClientRect().width
            ?? availableWidth / 3
        const minimum = Math.min(220, availableWidth / 2)
        return (dx: number) => {
            const extractWidth = Math.min(availableWidth - minimum, Math.max(minimum, initialWidth + dx))
            topTools.style.setProperty('--overlay-extract-width', `${extractWidth}px`)
            topTools.style.setProperty('--overlay-application-width', `${availableWidth - extractWidth}px`)
        }
    }

    function resetTopSplitResize() {
        topTools.style.removeProperty('--overlay-extract-width')
        topTools.style.removeProperty('--overlay-application-width')
    }

    function ruleFor(sourceIndex: number): PromptBlockOverlayRule | undefined {
        const item = sourceItems[sourceIndex]
        if (!item) return undefined
        return config.rules.find(rule => resolvePromptBlockOverlayReference(sourceItems, rule.source) === sourceIndex)
    }

    function suggestedTargetIndex(sourceIndex: number): number {
        const source = sourceItems[sourceIndex]
        if (!source || baseItems.length === 0) return -1
        const exact = baseItems.findIndex(item =>
            item.type === source.type && (item.name ?? '') === (source.name ?? ''))
        if (exact >= 0) return exact
        const sameType = baseItems.findIndex(item => item.type === source.type)
        return sameType >= 0 ? sameType : Math.min(sourceIndex, baseItems.length - 1)
    }

    function replaceRule(sourceIndex: number, next: PromptBlockOverlayRule | null) {
        const rules = config.rules.filter(rule => resolvePromptBlockOverlayReference(sourceItems, rule.source) !== sourceIndex)
        if (next) rules.push(next)
        store(updatePromptBlockOverlayConfig(config, { rules }))
    }

    function setPlacement(sourceIndex: number, placement: 'off' | PromptBlockOverlayPlacement) {
        if (placement === 'off') {
            replaceRule(sourceIndex, null)
            return
        }
        const source = sourceItems[sourceIndex]
        const current = ruleFor(sourceIndex)
        const targetIndex = current?.target.index ?? suggestedTargetIndex(sourceIndex)
        const target = baseItems[targetIndex]
        if (!source || !target) return
        replaceRule(sourceIndex, {
            source: promptBlockOverlayReference(source, sourceIndex),
            target: promptBlockOverlayReference(target, targetIndex),
            placement,
        })
    }

    function setTarget(sourceIndex: number, targetIndex: number) {
        const source = sourceItems[sourceIndex]
        const target = baseItems[targetIndex]
        const current = ruleFor(sourceIndex)
        if (!source || !target || !current) return
        replaceRule(sourceIndex, {
            ...current,
            source: promptBlockOverlayReference(source, sourceIndex),
            target: promptBlockOverlayReference(target, targetIndex),
        })
    }

    function rulesAt(targetIndex: number, placement: PromptBlockOverlayPlacement): PromptBlockOverlayRule[] {
        return config.rules.filter(rule =>
            rule.placement === placement
            && resolvePromptBlockOverlayReference(baseItems, rule.target) === targetIndex
        ).sort((left, right) => left.source.index - right.source.index)
    }

    function resolvedTargetIndex(rule: PromptBlockOverlayRule): number {
        return resolvePromptBlockOverlayReference(baseItems, rule.target)
    }

    function sourceItem(rule: PromptBlockOverlayRule): PromptItem | undefined {
        const index = sourceItemIndex(rule)
        return index < 0 ? undefined : sourceItems[index]
    }

    function sourceItemIndex(rule: PromptBlockOverlayRule): number {
        return resolvePromptBlockOverlayReference(sourceItems, rule.source)
    }

    function sourceName(rule: PromptBlockOverlayRule): string {
        const item = sourceItem(rule)
        return item ? blockName(item, rule.source.index) : language.promptOverlay.missingBlock
    }

    function toggleExpanded(key: string) {
        expandedBlocks = { ...expandedBlocks, [key]: !expandedBlocks[key] }
    }

    function startSplitResize() {
        const availableWidth = Math.max(0, workspaceColumns.getBoundingClientRect().width - splitHandle.getBoundingClientRect().width)
        const initialWidth = workspaceColumns.querySelector<HTMLElement>('[data-overlay-pane="mapping"]')?.getBoundingClientRect().width
            ?? availableWidth * .62
        const minimum = Math.min(280, availableWidth / 2)
        return (dx: number) => {
            const mappingWidth = Math.min(availableWidth - minimum, Math.max(minimum, initialWidth + dx))
            workspaceColumns.style.setProperty('--overlay-mapping-width', `${mappingWidth}px`)
            workspaceColumns.style.setProperty('--overlay-result-width', `${availableWidth - mappingWidth}px`)
        }
    }

    function resetSplitResize() {
        workspaceColumns.style.removeProperty('--overlay-mapping-width')
        workspaceColumns.style.removeProperty('--overlay-result-width')
    }

    const placements: Array<{
        value: 'off' | PromptBlockOverlayPlacement
        label: string
    }> = [
        { value: 'off', label: language.promptOverlay.skip },
        { value: 'before', label: language.promptOverlay.before },
        { value: 'replace', label: language.promptOverlay.replace },
        { value: 'after', label: language.promptOverlay.after },
    ]
</script>

{#snippet resultRow(
    item: PromptItem,
    key: string,
    kind: 'base' | PromptBlockOverlayPlacement,
    label: string,
    index?: number,
    replaced = false,
    editIndex = -1,
)}
    <div
        class:result-row--base={kind === 'base'}
        class:result-row--source={kind !== 'base'}
        class:result-row--replaced={replaced}
        class="result-block"
    >
        <button
            type="button"
            class="result-row"
            aria-expanded={!!expandedBlocks[key]}
            onclick={() => toggleExpanded(key)}
        >
            {#if expandedBlocks[key]}<ChevronDownIcon size={15} />{:else}<ChevronRightIcon size={15} />{/if}
            {#if kind === 'base'}
                <span class="result-index">{(index ?? 0) + 1}</span>
            {:else if kind === 'before'}
                <ArrowDownToLineIcon size={15} />
            {:else if kind === 'replace'}
                <ReplaceIcon size={15} />
            {:else}
                <ArrowUpFromLineIcon size={15} />
            {/if}
            <span class="result-name">{blockName(item, index)}</span>
            <em>{label}</em>
        </button>
        {#if expandedBlocks[key]}
            {#if canEditBlock(item)}
                <textarea
                    class="result-content result-editor"
                    aria-label={`${language.promptOverlay.editBlockContent}: ${blockName(item, editIndex)}`}
                    value={promptBlockOverlayItemText(item)}
                    oninput={(event) => editResultBlock(kind, editIndex, event.currentTarget.value)}
                ></textarea>
            {:else}
                <pre class="result-content">{promptBlockOverlayItemText(item) || language.promptOverlay.blockHasNoEditableContent}</pre>
            {/if}
        {/if}
    </div>
{/snippet}

<div data-prompt-overlay-workspace class="overlay-workspace">
    <section class="setup-card">
        <button
            type="button"
            class="setup-toggle"
            aria-expanded={setupExpanded}
            aria-label={setupExpanded ? language.promptOverlay.collapseSetup : language.promptOverlay.expandSetup}
            title={setupExpanded ? language.promptOverlay.collapseSetup : language.promptOverlay.expandSetup}
            onclick={() => setupExpanded = !setupExpanded}
        >
            <span class="setup-title">
                <span class="book-mark"><BookMarkedIcon size={20} /></span>
                <span class="setup-copy">
                    <strong>{language.promptOverlay.title}</strong>
                    <span>{language.promptOverlay.description}</span>
                </span>
            </span>
            {#if setupExpanded}<ChevronDownIcon size={18} />{:else}<ChevronRightIcon size={18} />{/if}
        </button>

        {#if setupExpanded}
            <div bind:this={topTools} class="top-tools">
            <section data-overlay-top-pane="extract" class="top-pane extract-panel">
                <header>
                    <strong>{language.promptOverlay.extractTools}</strong>
                    <span>{language.promptOverlay.extractHint}</span>
                </header>
                <div class="extract-row">
                    <label>
                        <span>{language.promptOverlay.extractSourcePreset}</span>
                        <select bind:value={extractPresetId}>
                            <option value="">{language.promptOverlay.noExtractSource}</option>
                            {#each installedPresets as preset (preset.id)}
                                <option value={preset.id}>{preset.name || language.promptOverlay.untitledPreset}</option>
                            {/each}
                        </select>
                    </label>
                    <label>
                        <span>{language.promptOverlay.extractionText}</span>
                        <input name="prompt-overlay-extraction-text" autocomplete="off" bind:value={extractionText} placeholder={language.promptOverlay.extractionTextPlaceholder} />
                    </label>
                    <div class="extract-actions">
                        <button class="extract-button" disabled={!extractPreset || extractBlockCount === 0} onclick={extractProfile}>
                            {language.promptOverlay.extract} ({extractBlockCount})
                        </button>
                        <button
                            class="extract-button"
                            disabled={!extractPreset || !activeProfile || extractBlockCount === 0}
                            onclick={appendToProfile}
                        >
                            {language.promptOverlay.appendToProfile}
                        </button>
                    </div>
                </div>
            </section>

            <button
                bind:this={topSplitHandle}
                type="button"
                class="top-split-handle"
                aria-label={language.promptOverlay.resizeTopPanels}
                title={language.promptOverlay.resizeTopPanels}
                use:resizeHandle={{ start: startTopSplitResize, reset: resetTopSplitResize }}
            ></button>

            <section data-overlay-top-pane="presets" class="top-pane application-panel">
                <header>
                    <strong>{language.promptOverlay.applicationPreset}</strong>
                </header>
                <div class="application-preset-row">
                    <label>
                        <span>{language.promptOverlay.applicationPreset}</span>
                        <select
                            value={config.applicationPresetId ?? ''}
                            onchange={(event) => selectApplicationPreset(event.currentTarget.value)}
                        >
                            <option value="">{language.promptOverlay.noApplicationPreset}</option>
                            {#each applicationPresets as preset (preset.id)}
                                <option value={preset.id}>{preset.name}</option>
                            {/each}
                        </select>
                    </label>
                    <label>
                        <span>{language.promptOverlay.applicationPresetName}</span>
                        <input name="prompt-overlay-preset-name" autocomplete="off" bind:value={applicationPresetName} placeholder={language.promptOverlay.applicationPresetNamePlaceholder} />
                    </label>
                    <div class="preset-actions">
                        <button disabled={!applicationPresetName.trim() || !config.profileId} onclick={saveApplicationPreset}>{language.promptOverlay.saveNewPreset}</button>
                        <button disabled={!selectedApplicationPreset} onclick={overwriteApplicationPreset}>{language.promptOverlay.overwritePreset}</button>
                        <button
                            disabled={!selectedApplicationPreset || !applicationPresetName.trim() || applicationPresetName.trim() === selectedApplicationPreset.name}
                            onclick={renameApplicationPreset}
                        >{language.promptOverlay.renamePreset}</button>
                        <button class="danger" disabled={!selectedApplicationPreset} onclick={deleteApplicationPreset}>{language.promptOverlay.deletePreset}</button>
                    </div>
                </div>
            </section>
            </div>

            <div class="setup-grid">
            <label>
                <span>{language.promptOverlay.profile}</span>
                <select
                    value={config.profileId}
                    onchange={(event) => selectProfile(event.currentTarget.value)}
                >
                    <option value="">{language.promptOverlay.noProfile}</option>
                    {#each profiles as profile (profile.id)}
                        <option value={profile.id}>{profile.name}</option>
                    {/each}
                </select>
            </label>
            <div class="switch-row">
                <div>
                    <span class="control-title">
                        <strong>{language.promptOverlay.includeToggles}</strong>
                        <button
                            type="button"
                            class="help-icon"
                            aria-label={language.promptOverlay.includeTogglesHelp}
                            use:tooltip={language.promptOverlay.includeTogglesHelp}
                        ><CircleHelpIcon size={14} /></button>
                    </span>
                    <span>{language.promptOverlay.includeTogglesHint}</span>
                </div>
                <ShSwitch
                    checked={config.includeReferencedToggles}
                    disabled={!config.profileId}
                    onCheckedChange={(includeReferencedToggles) => patchConfig({ includeReferencedToggles })}
                />
            </div>
            </div>
        {/if}

    </section>

    {#if activeProfile}
        <div bind:this={workspaceColumns} class="workspace-columns">
            <section data-overlay-pane="mapping" class="mapping-panel">
                <header class="panel-header">
                    <div>
                        <h3>{language.promptOverlay.sourceBlocks}</h3>
                        <p>{language.promptOverlay.sourceBlocksHint}</p>
                    </div>
                    <div class="profile-manager">
                        <label>
                            <span>{language.promptOverlay.profileName}</span>
                            <input name="prompt-overlay-profile-name" autocomplete="off" bind:value={profileName} placeholder={language.promptOverlay.profileNamePlaceholder} />
                        </label>
                        <div class="profile-actions">
                            <button disabled={!profileName.trim() || profileName.trim() === activeProfile.name} onclick={renameProfile}>
                                {language.promptOverlay.renameProfile}
                            </button>
                            <button class="danger" onclick={deleteProfile}>{language.promptOverlay.deleteProfile}</button>
                        </div>
                        <span class="count-badge">{config.rules.length}/{sourceItems.length}</span>
                    </div>
                </header>
                <div class="filter-bar">
                    <input
                        type="search"
                        name="prompt-overlay-search"
                        autocomplete="off"
                        aria-label={language.promptOverlay.searchBlocks}
                        bind:value={search}
                        placeholder={language.promptOverlay.searchBlocks}
                    />
                </div>
                <div class="mapping-body">
                    <div class="block-toolbar" role="toolbar" aria-label={language.promptOverlay.blockToolbar}>
                        <button
                            disabled={selectedSourceIndex < 0}
                            aria-label={language.promptOverlay.newBlock}
                            title={language.promptOverlay.newBlock}
                            onclick={insertNewBlockAfterSelection}
                        ><PlusIcon size={16} /></button>
                        <button
                            disabled={selectedSourceIndex < 0}
                            aria-label={language.promptOverlay.duplicateBlock}
                            title={language.promptOverlay.duplicateBlock}
                            onclick={() => duplicateBlock(selectedSourceIndex)}
                        ><CopyIcon size={16} /></button>
                        <span class="toolbar-divider"></span>
                        <button
                            disabled={selectedSourceIndex <= 0}
                            aria-label={language.promptOverlay.moveBlockUpFive}
                            title={language.promptOverlay.moveBlockUpFive}
                            onclick={() => moveBlock(selectedSourceIndex, -5)}
                        ><ChevronsUpIcon size={16} /></button>
                        <button
                            disabled={selectedSourceIndex <= 0}
                            aria-label={language.promptOverlay.moveBlockUp}
                            title={language.promptOverlay.moveBlockUp}
                            onclick={() => moveBlock(selectedSourceIndex, -1)}
                        ><ArrowUpIcon size={16} /></button>
                        <button
                            disabled={selectedSourceIndex < 0 || selectedSourceIndex >= sourceItems.length - 1}
                            aria-label={language.promptOverlay.moveBlockDown}
                            title={language.promptOverlay.moveBlockDown}
                            onclick={() => moveBlock(selectedSourceIndex, 1)}
                        ><ArrowDownIcon size={16} /></button>
                        <button
                            disabled={selectedSourceIndex < 0 || selectedSourceIndex >= sourceItems.length - 1}
                            aria-label={language.promptOverlay.moveBlockDownFive}
                            title={language.promptOverlay.moveBlockDownFive}
                            onclick={() => moveBlock(selectedSourceIndex, 5)}
                        ><ChevronsDownIcon size={16} /></button>
                        <span class="toolbar-divider"></span>
                        <button
                            class="danger"
                            disabled={selectedSourceIndex < 0}
                            aria-label={language.promptOverlay.deleteBlock}
                            title={language.promptOverlay.deleteBlock}
                            onclick={() => deleteBlock(selectedSourceIndex)}
                        ><Trash2Icon size={16} /></button>
                    </div>
                    <div class="mapping-list">
                    {#each visibleSourceItems as { item, index } (index)}
                        {@const rule = ruleFor(index)}
                        {@const targetIndex = rule ? resolvedTargetIndex(rule) : -1}
                        {@const missingTarget = !!rule && targetIndex < 0}
                        <div
                            class:active-rule={!!rule}
                            class:missing-target={missingTarget}
                            class:selected-block={selectedSourceIndex === index}
                            class="mapping-row"
                            role="button"
                            tabindex="0"
                            onclick={() => selectedSourceIndex = index}
                            onkeydown={(event) => {
                                if (event.target !== event.currentTarget) return
                                if (event.key !== 'Enter' && event.key !== ' ') return
                                event.preventDefault()
                                selectedSourceIndex = index
                            }}
                        >
                            <div class="block-selector">
                                <button
                                    type="button"
                                    class:expanded={!!editingSourceBlocks[index]}
                                    class="block-editor-toggle"
                                    aria-label={`${language.promptOverlay.editBlockContent}: ${blockName(item, index)}`}
                                    aria-expanded={!!editingSourceBlocks[index]}
                                    onclick={(event) => toggleBlockEditor(event, index)}
                                ><ChevronDownIcon size={16} /></button>
                                <span class="block-copy">
                                    {#if editingSourceNameIndex === index}
                                        <input
                                            class="block-name-input"
                                            bind:value={blockNameDraft}
                                            aria-label={language.name}
                                            onclick={(event) => event.stopPropagation()}
                                            onblur={() => finishBlockNameEdit(index)}
                                            onkeydown={(event) => {
                                                if (event.key === 'Enter' && !event.isComposing) event.currentTarget.blur()
                                                if (event.key === 'Escape') finishBlockNameEdit(index, false)
                                            }}
                                        />
                                    {:else}
                                        <button
                                            type="button"
                                            class="block-name-button"
                                            title={language.name}
                                            onclick={(event) => beginBlockNameEdit(event, index)}
                                        >{blockName(item, index)}</button>
                                    {/if}
                                    <span>#{index + 1} · {item.type}</span>
                                </span>
                            </div>
                            <label class="mapping-control">
                                <span>{language.promptOverlay.action}</span>
                                <select
                                    value={rule?.placement ?? 'off'}
                                    onchange={(event) => setPlacement(index, event.currentTarget.value as 'off' | PromptBlockOverlayPlacement)}
                                >
                                    {#each placements as placement}
                                        <option value={placement.value}>{placement.label}</option>
                                    {/each}
                                </select>
                            </label>
                            <label class="mapping-control mapping-control--target">
                                <span>{language.promptOverlay.targetBlock}</span>
                                <select
                                    disabled={!rule}
                                    value={missingTarget ? -1 : (targetIndex >= 0 ? targetIndex : suggestedTargetIndex(index))}
                                    onchange={(event) => setTarget(index, Number(event.currentTarget.value))}
                                >
                                    {#if missingTarget}
                                        <option value={-1} disabled>⚠ {language.promptOverlay.missingTarget}: {rule?.target.name}</option>
                                    {/if}
                                    {#each baseItems as target, targetIndex (targetIndex)}
                                        <option value={targetIndex}>#{targetIndex + 1} · {blockName(target, targetIndex)}</option>
                                    {/each}
                                </select>
                            </label>
                            {#if editingSourceBlocks[index]}
                                <div class="block-editor block-editor-layout">
                                    <label class="block-editor-content">
                                        <span>{language.promptOverlay.editBlockContent}</span>
                                        <textarea
                                            disabled={!canEditBlock(item)}
                                            value={promptBlockOverlayItemText(item)}
                                            placeholder={!canEditBlock(item) ? language.promptOverlay.blockHasNoEditableContent : ''}
                                            oninput={(event) => editBlockText(index, event.currentTarget.value)}
                                        ></textarea>
                                    </label>
                                    <div class="block-editor-fields">
                                        <label>
                                            <span>{language.type}</span>
                                            <select value={item.type} onchange={(event) => replaceBlockType(index, event.currentTarget.value as PromptType)}>
                                                <option value="plain">{language.formating.plain}</option>
                                                <option value="jailbreak">{language.formating.jailbreak}</option>
                                                <option value="chat">{language.Chat}</option>
                                                <option value="persona">{language.formating.personaPrompt}</option>
                                                <option value="description">{language.formating.description}</option>
                                                <option value="authornote">{language.formating.authorNote}</option>
                                                <option value="lorebook">{language.formating.lorebook}</option>
                                                <option value="memory">{language.formating.memory}</option>
                                                <option value="postEverything">{language.formating.postEverything}</option>
                                                <option value="chatML">ChatML</option>
                                                <option value="cache">{language.cachePoint}</option>
                                                <option value="cot">{language.cot}</option>
                                            </select>
                                        </label>
                                        <label>
                                            <span>{language.specialType}</span>
                                            <select
                                                disabled={!hasSpecialType(item)}
                                                value={hasSpecialType(item) ? item.type2 : ''}
                                                onchange={(event) => setBlockSpecialType(index, event.currentTarget.value as 'normal' | 'globalNote' | 'main')}
                                            >
                                                {#if !hasSpecialType(item)}<option value="">—</option>{/if}
                                                <option value="normal">{language.noSpecialType}</option>
                                                <option value="main">{language.mainPrompt}</option>
                                                <option value="globalNote">{language.globalNote}</option>
                                            </select>
                                        </label>
                                        <label>
                                            <span>{language.role}</span>
                                            <select
                                                disabled={!blockRole(item)}
                                                value={blockRole(item)}
                                                onchange={(event) => setBlockRole(index, event.currentTarget.value)}
                                            >
                                                {#if !blockRole(item)}<option value="">—</option>{/if}
                                                {#if item.type === 'cache'}<option value="all">{language.all}</option>{/if}
                                                <option value="user">{language.user}</option>
                                                <option value={item.type === 'cache' ? 'assistant' : 'bot'}>{language.character}</option>
                                                <option value="system">{language.systemPrompt}</option>
                                            </select>
                                        </label>
                                    </div>
                                </div>
                            {/if}
                        </div>
                    {:else}
                        <div class="empty-state">{language.promptOverlay.noMatchingBlocks}</div>
                    {/each}
                    </div>
                </div>
            </section>

            <button
                bind:this={splitHandle}
                type="button"
                class="split-handle"
                aria-label={language.promptOverlay.resizePanels}
                title={language.promptOverlay.resizePanels}
                use:resizeHandle={{ start: startSplitResize, reset: resetSplitResize }}
            ></button>

            <section class="result-panel">
                <header class="panel-header">
                    <div>
                        <h3>{language.promptOverlay.resultMap}</h3>
                        <p>{language.promptOverlay.resultMapHint}</p>
                    </div>
                    <div class="profile-actions result-actions">
                        <button
                            type="button"
                            title={language.promptOverlay.saveComposedAsNewHelp}
                            onclick={saveComposedAsNewPreset}
                        >{language.promptOverlay.saveComposedAsNew}</button>
                        <button
                            type="button"
                            class="danger"
                            title={language.promptOverlay.overwriteOriginalHelp}
                            onclick={overwriteOriginalPreset}
                        >{language.promptOverlay.overwriteOriginal}</button>
                    </div>
                </header>
                <div class="result-list">
                    {#if missingTargetRules.length > 0}
                        <div class="missing-target-summary">
                            <strong>{language.promptOverlay.missingTargets}</strong>
                            {#each missingTargetRules as rule}
                                <span>{sourceName(rule)} → {rule.target.name || language.promptOverlay.untitledBlock}</span>
                            {/each}
                        </div>
                    {/if}
                    {#each baseItems as item, index (index)}
                        {@const beforeRules = rulesAt(index, 'before')}
                        {@const replaceRules = rulesAt(index, 'replace')}
                        {@const afterRules = rulesAt(index, 'after')}
                        {#each beforeRules as rule}
                            {@const source = sourceItem(rule)}
                            {@const sourceIndex = sourceItemIndex(rule)}
                            {#if source}{@render resultRow(source, `before-${index}-${rule.source.index}`, 'before', language.promptOverlay.before, undefined, false, sourceIndex)}{/if}
                        {/each}
                        {@render resultRow(item, `base-${index}`, 'base', replaceRules.length > 0 ? language.promptOverlay.replaced : language.promptOverlay.baseBlock, index, replaceRules.length > 0, index)}
                        {#each replaceRules as rule}
                            {@const source = sourceItem(rule)}
                            {@const sourceIndex = sourceItemIndex(rule)}
                            {#if source}{@render resultRow(source, `replace-${index}-${rule.source.index}`, 'replace', language.promptOverlay.replace, undefined, false, sourceIndex)}{/if}
                        {/each}
                        {#each afterRules as rule}
                            {@const source = sourceItem(rule)}
                            {@const sourceIndex = sourceItemIndex(rule)}
                            {#if source}{@render resultRow(source, `after-${index}-${rule.source.index}`, 'after', language.promptOverlay.after, undefined, false, sourceIndex)}{/if}
                        {/each}
                    {:else}
                        <div class="empty-state">{language.promptOverlay.noTargetBlocks}</div>
                    {/each}
                </div>
            </section>
        </div>
    {:else}
        <div class="empty-state empty-state--large">
            <BookMarkedIcon size={28} />
            <strong>{language.promptOverlay.chooseProfile}</strong>
            <span>{language.promptOverlay.chooseProfileHint}</span>
        </div>
    {/if}
</div>

<style>
    .overlay-workspace {
        display: flex;
        min-height: 0;
        flex: 1;
        flex-direction: column;
        gap: .75rem;
        overflow: hidden;
    }
    .setup-card,
    .mapping-panel,
    .result-panel,
    .empty-state--large {
        border: 1px solid var(--color-darkborderc);
        border-radius: calc(var(--risu-radius-2xl) * 0.9);
        background: color-mix(in srgb, var(--color-darkbg) 92%, var(--color-bgcolor));
    }
    .setup-card { padding: 1rem; }
    .setup-toggle {
        display: flex;
        width: 100%;
        align-items: center;
        justify-content: space-between;
        gap: .75rem;
        border: 0;
        padding: 0;
        color: var(--color-textcolor);
        background: transparent;
        text-align: left;
        cursor: pointer;
        transition: color 160ms ease, background-color 160ms ease;
    }
    .setup-toggle:hover { color: var(--color-borderc); }
    .setup-toggle:active { color: var(--color-selected); }
    .setup-toggle:focus-visible { outline: 2px solid var(--color-borderc); outline-offset: .35rem; }
    .setup-title { display: flex; min-width: 0; align-items: flex-start; gap: .75rem; }
    .setup-copy { display: flex; min-width: 0; flex-direction: column; }
    .setup-copy strong,
    .panel-header h3 { margin: 0; color: var(--color-textcolor); font-weight: 700; }
    .setup-copy strong { font-size: 1rem; }
    .setup-copy > span,
    .panel-header p { margin: .2rem 0 0; color: var(--color-textcolor2); font-size: .76rem; line-height: 1.45; }
    .book-mark {
        display: grid;
        width: 2.35rem;
        height: 2.35rem;
        flex: 0 0 auto;
        place-items: center;
        border-radius: calc(var(--risu-radius-lg) * 1.3);
        color: var(--color-binding-text);
        background: var(--color-binding);
    }
    .setup-grid {
        display: grid;
        grid-template-columns: minmax(15rem, 1.2fr) minmax(13rem, 1fr);
        gap: .65rem;
        margin-top: .85rem;
    }
    .top-tools {
        display: grid;
        grid-template-columns: var(--overlay-extract-width, minmax(14rem, 1fr)) 1rem var(--overlay-application-width, minmax(28rem, 2fr));
        min-width: 0;
        margin-top: .75rem;
    }
    .top-pane {
        min-width: 0;
        border: 1px solid var(--color-darkborderc);
        border-radius: calc(var(--risu-radius-lg) * 1.3);
        padding: .6rem;
        background: color-mix(in srgb, var(--color-darkbutton) 18%, transparent);
        container-name: top-tools;
        container-type: inline-size;
    }
    .top-pane > header {
        display: flex;
        min-height: 1.5rem;
        align-items: baseline;
        gap: .45rem;
        margin-bottom: .35rem;
        color: var(--color-textcolor);
        font-size: .75rem;
    }
    .top-pane > header span {
        overflow: hidden;
        color: var(--color-textcolor2);
        font-size: .72rem;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .application-preset-row {
        display: grid;
        min-width: 0;
        grid-template-columns: minmax(12rem, .8fr) minmax(12rem, 1fr) auto;
        gap: .55rem;
        align-items: end;
    }
    .application-preset-row > label { display: flex; min-width: 0; flex-direction: column; gap: .28rem; }
    .application-preset-row > label > span { color: var(--color-textcolor2); font-size: .75rem; font-weight: 650; }
    .preset-actions { display: flex; gap: .35rem; }
     .preset-actions button,
     .profile-actions button,
     .block-toolbar button,
     .extract-button {
        min-height: 2.35rem;
        border: 1px solid var(--color-borderc);
        border-radius: var(--risu-radius-lg);
        padding: .4rem .68rem;
        color: var(--color-textcolor);
        background: var(--color-darkbutton);
        cursor: pointer;
        white-space: nowrap;
        transition: border-color 160ms ease, background-color 160ms ease, color 160ms ease, box-shadow 160ms ease;
    }
     .preset-actions button:not(:disabled):hover,
     .profile-actions button:not(:disabled):hover,
     .block-toolbar button:not(:disabled):hover,
     .extract-button:not(:disabled):hover {
         border-color: var(--color-borderc);
         background: color-mix(in srgb, var(--color-selected) 24%, var(--color-darkbutton));
     }
     .preset-actions button:not(:disabled):active,
     .profile-actions button:not(:disabled):active,
     .block-toolbar button:not(:disabled):active,
     .extract-button:not(:disabled):active {
         background: color-mix(in srgb, var(--color-selected) 42%, var(--color-darkbutton));
     }
     .preset-actions button:focus-visible,
     .profile-actions button:focus-visible,
     .block-toolbar button:focus-visible,
     .extract-button:focus-visible {
         outline: 2px solid var(--color-borderc);
         outline-offset: 2px;
     }
     .preset-actions button.danger { border-color: color-mix(in srgb, var(--color-danger) 55%, var(--color-darkborderc)); color: var(--color-danger); }
     .profile-actions button.danger,
     .block-toolbar button.danger { border-color: color-mix(in srgb, var(--color-danger) 55%, var(--color-darkborderc)); color: var(--color-danger); }
     .preset-actions button.danger:not(:disabled):hover,
     .profile-actions button.danger:not(:disabled):hover,
     .block-toolbar button.danger:not(:disabled):hover {
         border-color: var(--color-danger);
         background: color-mix(in srgb, var(--color-danger) 14%, var(--color-darkbutton));
     }
     .preset-actions button:disabled,
     .profile-actions button:disabled,
     .block-toolbar button:disabled,
     .extract-button:disabled { cursor: not-allowed; opacity: .45; }
    .extract-row {
        display: grid;
        grid-template-columns: minmax(10rem, 1.3fr) minmax(7rem, .7fr) auto;
        gap: .45rem;
        align-items: end;
    }
    .extract-actions { display: flex; min-width: 0; gap: .35rem; }
    .extract-actions .extract-button { min-width: 0; flex: 1 1 9rem; }
    .extract-row > label,
    .setup-grid > label { display: flex; min-width: 0; flex-direction: column; gap: .28rem; }
    .mapping-control {
        display: grid;
        min-width: 0;
        grid-template-columns: max-content minmax(0, 1fr);
        align-items: center;
        gap: .5rem;
    }
    .extract-row > label > span,
    .setup-grid > label > span,
    .mapping-control > span { color: var(--color-textcolor2); font-size: .75rem; font-weight: 650; }
     select,
     .extract-row input,
     .application-preset-row input,
     .profile-manager input,
     .block-name-input,
     .block-editor textarea,
     .filter-bar > input {
        min-height: 2.35rem;
        min-width: 0;
        width: 100%;
        border: 1px solid var(--color-darkborderc);
        border-radius: var(--risu-radius-lg);
        padding: .4rem .55rem;
        color: var(--color-textcolor);
        background: var(--color-darkbg);
    }
     select:focus-visible,
     input:focus-visible,
     textarea:focus-visible { outline: 2px solid color-mix(in srgb, var(--color-borderc) 60%, transparent); outline-offset: 1px; }
    select:disabled { cursor: not-allowed; opacity: .45; }
    .switch-row {
        display: flex;
        min-height: 3.5rem;
        align-items: center;
        justify-content: space-between;
        gap: .75rem;
        border: 1px solid var(--color-darkborderc);
        border-radius: calc(var(--risu-radius-lg) * 1.3);
        padding: .55rem .65rem;
        background: color-mix(in srgb, var(--color-darkbutton) 28%, transparent);
    }
    .switch-row div { display: flex; min-width: 0; flex-direction: column; gap: .12rem; }
    .switch-row strong { color: var(--color-textcolor); font-size: .8rem; }
    .switch-row span { color: var(--color-textcolor2); font-size: .75rem; line-height: 1.45; }
    .control-title { display: flex; align-items: center; gap: .3rem; }
     .help-icon {
         display: inline-flex;
         border: 0;
         padding: 0;
         color: var(--color-textcolor2);
         background: transparent;
         cursor: help;
     }
    .workspace-columns {
        display: grid;
        min-height: 0;
        flex: 1;
        grid-template-columns: var(--overlay-mapping-width, minmax(32rem, 1.45fr)) 1rem var(--overlay-result-width, minmax(18rem, .75fr));
        gap: 0;
        overflow: hidden;
    }
     .mapping-panel,
     .result-panel { display: flex; min-height: 0; flex-direction: column; overflow: hidden; }
     .mapping-panel { container-name: mapping-panel; container-type: inline-size; }
    .panel-header {
        display: flex;
        min-height: 4rem;
        align-items: center;
        justify-content: space-between;
        gap: .75rem;
        border-bottom: 1px solid var(--color-darkborderc);
        padding: .65rem .8rem;
    }
     .panel-header h3 { font-size: .86rem; }
     .profile-manager { display: flex; min-width: 0; align-items: end; justify-content: flex-end; gap: .45rem; }
     .profile-manager label { display: flex; min-width: 10rem; flex-direction: column; gap: .2rem; }
     .profile-manager label > span { color: var(--color-textcolor2); font-size: .72rem; font-weight: 650; }
     .profile-actions { display: flex; gap: .3rem; }
     .profile-actions button { min-height: 2.35rem; }
     .result-actions { min-width: 0; margin-left: auto; flex-wrap: wrap; justify-content: flex-end; }
     .mapping-body { display: flex; min-height: 0; flex: 1; overflow: hidden; }
     .block-toolbar {
         display: flex;
         flex: 0 0 auto;
         flex-direction: column;
         gap: .3rem;
         border-right: 1px solid var(--color-darkborderc);
         padding: .55rem .45rem;
         overflow-y: auto;
         background: color-mix(in srgb, var(--color-darkbutton) 20%, transparent);
     }
     .block-toolbar button {
         display: grid;
         width: 2.75rem;
         min-height: 2.75rem;
         padding: 0;
         place-items: center;
     }
     .toolbar-divider {
         width: 100%;
         height: 1px;
         margin: .1rem 0;
         background: var(--color-darkborderc);
     }
    .count-badge {
        flex: 0 0 auto;
        border-radius: 999px;
        padding: .2rem .55rem;
        color: var(--color-binding-text);
        background: var(--color-binding);
        font-size: .75rem;
        font-variant-numeric: tabular-nums;
    }
    .filter-bar {
        display: block;
        border-bottom: 1px solid var(--color-darkborderc);
        padding: .55rem .65rem;
    }
    .mapping-list,
    .result-list { min-height: 0; flex: 1; overflow-y: scroll; scrollbar-gutter: stable; padding: .55rem; }
     .mapping-list { min-width: 0; }
     .mapping-row {
         display: grid;
         position: relative;
         grid-template-columns: minmax(11rem, 1fr) minmax(14rem, .9fr) minmax(18rem, 1.25fr);
        gap: .55rem;
        align-items: center;
        border: 1px solid var(--color-darkborderc);
        border-left-width: .25rem;
        border-left-color: transparent;
        border-radius: calc(var(--risu-radius-lg) * 1.3);
        padding: .4rem .55rem;
        background: color-mix(in srgb, var(--color-darkbutton) 14%, transparent);
        cursor: pointer;
        transition: border-color 160ms ease, background-color 160ms ease, box-shadow 160ms ease;
    }
    .mapping-row::before {
        position: absolute;
        inset: .55rem auto .55rem -.25rem;
        width: .25rem;
        border-radius: 999px;
        background: transparent;
        content: '';
        opacity: 0;
        transform: scaleY(.35);
        transition: opacity 160ms ease, transform 160ms ease;
    }
    .mapping-row + .mapping-row { margin-top: .45rem; }
    .mapping-row:not(.selected-block):hover {
        border-color: color-mix(in srgb, var(--color-borderc) 48%, var(--color-darkborderc));
        background: color-mix(in srgb, var(--color-selected) 10%, var(--color-darkbg));
    }
    .mapping-row:focus-within {
        box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--color-borderc) 72%, transparent);
    }
    .mapping-row.active-rule {
        border-color: color-mix(in srgb, var(--color-selected) 60%, var(--color-darkborderc));
        background: color-mix(in srgb, var(--color-selected) 12%, var(--color-darkbg));
    }
    .mapping-row.missing-target {
        border-color: var(--color-danger);
        background: color-mix(in srgb, var(--color-danger) 10%, var(--color-darkbg));
    }
    .mapping-row.selected-block {
        border-left-color: var(--color-borderc);
        background: color-mix(in srgb, var(--color-selected) 48%, var(--color-darkbg));
        box-shadow:
            inset 0 0 0 1px color-mix(in srgb, var(--color-borderc) 82%, transparent),
            0 .25rem .75rem color-mix(in srgb, var(--color-selected) 18%, transparent);
    }
    .mapping-row.selected-block::before {
        background: var(--color-borderc);
        opacity: 1;
        transform: scaleY(1);
    }
    .mapping-row.selected-block select {
        background: color-mix(in srgb, var(--color-selected) 14%, var(--color-darkbg));
    }
    .mapping-row.missing-target.selected-block {
        border-color: var(--color-danger);
        border-left-color: var(--color-borderc);
        background: color-mix(in srgb, var(--color-danger) 12%, var(--color-selected));
    }
    .mapping-row.missing-target select { border-color: var(--color-danger); color: var(--color-danger); }
    .block-selector {
        display: grid;
        min-width: 0;
        align-self: stretch;
        grid-template-columns: 1.5rem minmax(0, 1fr);
        align-items: center;
        gap: .55rem;
        padding: .35rem;
        color: inherit;
        text-align: left;
    }
    .block-editor-toggle {
        display: grid;
        width: 1.35rem;
        height: 1.35rem;
        place-items: center;
        border: 1px solid color-mix(in srgb, var(--color-textcolor2) 55%, var(--color-darkborderc));
        border-radius: calc(var(--risu-radius-sm) * 1.4);
        padding: 0;
        color: var(--color-textcolor2);
        background: color-mix(in srgb, var(--color-darkbg) 74%, transparent);
        cursor: pointer;
        transition: border-color 160ms ease, background-color 160ms ease, color 160ms ease, transform 160ms ease;
    }
    .block-editor-toggle:hover,
    .block-editor-toggle:focus-visible,
    .mapping-row.selected-block .block-editor-toggle {
        border-color: var(--color-borderc);
        color: var(--color-textcolor);
        background: color-mix(in srgb, var(--color-selected) 36%, var(--color-darkbg));
    }
    .block-editor-toggle.expanded { transform: rotate(180deg); }
    .block-copy { display: flex; min-width: 0; flex-direction: column; gap: .2rem; }
    .block-name-button {
        overflow: hidden;
        border: 0;
        padding: 0;
        color: var(--color-textcolor);
        background: transparent;
        font-size: .82rem;
        font-weight: 700;
        text-align: left;
        text-overflow: ellipsis;
        white-space: nowrap;
        cursor: text;
    }
    .block-name-button:hover { color: var(--color-borderc); }
    .block-name-button:focus-visible { outline: 2px solid var(--color-borderc); outline-offset: 2px; }
    .block-name-input { min-height: 1.75rem; padding: .15rem .35rem; font-size: .82rem; font-weight: 700; }
     .block-copy > span { color: var(--color-textcolor2); font-size: .72rem; }
     .block-editor {
         display: grid;
         grid-column: 1 / -1;
         grid-template-columns: minmax(14rem, 1fr) minmax(8rem, 10rem);
         gap: .65rem;
         cursor: default;
     }
     .block-editor-content,
     .block-editor-fields label { display: flex; min-width: 0; flex-direction: column; gap: .25rem; }
     .block-editor-content > span,
     .block-editor-fields label > span { color: var(--color-textcolor2); font-size: .72rem; font-weight: 650; }
     .block-editor-fields { display: grid; align-content: start; gap: .45rem; grid-template-columns: 1fr; }
     .block-editor textarea {
         min-height: 7.5rem;
         padding: .65rem;
         resize: vertical;
         font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
         font-size: .72rem;
         line-height: 1.5;
     }
    .result-list { display: flex; flex-direction: column; gap: .42rem; }
    .result-block {
        flex: 0 0 auto;
        overflow: hidden;
        border: 1px solid var(--color-darkborderc);
        border-radius: var(--risu-radius-lg);
    }
    .result-row {
        display: grid;
        min-height: 2.35rem;
        width: 100%;
        grid-template-columns: 1rem 1.5rem minmax(0, 1fr) auto;
        align-items: center;
        gap: .45rem;
        border: 0;
        padding: .35rem .5rem;
        color: var(--color-textcolor);
        background: transparent;
        font-size: .75rem;
        line-height: 1.35;
        text-align: left;
        cursor: pointer;
        transition: background-color 160ms ease, color 160ms ease;
    }
    .result-row:hover { background: color-mix(in srgb, var(--color-selected) 16%, transparent); }
    .result-row:active { background: color-mix(in srgb, var(--color-selected) 28%, transparent); }
    .result-row:focus-visible { outline: 2px solid var(--color-borderc); outline-offset: -2px; }
    .result-row--base { background: color-mix(in srgb, var(--color-darkbutton) 22%, transparent); }
    .result-row--source {
        border-color: color-mix(in srgb, var(--color-selected) 46%, var(--color-darkborderc));
        color: var(--color-binding-text);
        background: color-mix(in srgb, var(--color-binding) 72%, var(--color-darkbg));
    }
    .result-row--replaced > .result-row { opacity: .48; text-decoration: line-through; }
    .result-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
     .result-content {
         display: block;
         box-sizing: border-box;
         width: 100%;
         max-height: 22rem;
        margin: 0;
        border-top: 1px solid var(--color-darkborderc);
        padding: .65rem .75rem;
        overflow: auto;
        color: var(--color-textcolor);
        background: color-mix(in srgb, var(--color-darkbg) 94%, transparent);
        font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
        font-size: .75rem;
        line-height: 1.5;
        white-space: pre-wrap;
         word-break: break-word;
     }
     .result-editor {
         min-height: 9rem;
         border: 0;
         border-top: 1px solid var(--color-darkborderc);
         outline: 0;
         resize: vertical;
     }
     .result-editor:focus { border-top-color: var(--color-borderc); box-shadow: inset 0 0 0 1px var(--color-borderc); }
    .result-index {
        display: grid;
        width: 1.35rem;
        height: 1.35rem;
        place-items: center;
        border-radius: calc(var(--risu-radius-sm) * 1.4);
        color: var(--color-textcolor2);
        background: var(--color-darkbutton);
        font-size: .7rem;
    }
    .result-row em { color: inherit; font-size: .7rem; font-style: normal; opacity: .78; }
    .missing-target-summary {
        display: flex;
        flex: 0 0 auto;
        flex-direction: column;
        gap: .25rem;
        border: 1px solid var(--color-danger);
        border-radius: calc(var(--risu-radius-lg) * 1.1);
        padding: .6rem;
        color: var(--color-danger);
        background: color-mix(in srgb, var(--color-danger) 9%, var(--color-darkbg));
        font-size: .75rem;
    }
    .split-handle,
    .top-split-handle {
        position: relative;
        width: 1rem;
        min-height: 3rem;
        border: 0;
        padding: 0;
        background: transparent;
        cursor: col-resize;
        touch-action: none;
    }
    .split-handle::after,
    .top-split-handle::after {
        position: absolute;
        inset: 1rem auto 1rem calc(50% - 1px);
        width: 2px;
        border-radius: 999px;
        background: var(--color-darkborderc);
        content: '';
    }
    .split-handle:hover::after,
    .split-handle:focus-visible::after,
    .split-handle:global([data-resizing])::after,
    .top-split-handle:hover::after,
    .top-split-handle:focus-visible::after,
    .top-split-handle:global([data-resizing])::after { width: 3px; background: var(--color-borderc); }
    .split-handle:focus-visible,
    .top-split-handle:focus-visible { outline: 2px solid var(--color-borderc); outline-offset: -2px; }
    .empty-state {
        display: flex;
        min-height: 5rem;
        align-items: center;
        justify-content: center;
        color: var(--color-textcolor2);
        font-size: .76rem;
    }
    .empty-state--large { flex: 1; flex-direction: column; gap: .35rem; }
    .empty-state--large strong { color: var(--color-textcolor); }
    .empty-state--large span { max-width: 32rem; text-align: center; }

    @container top-tools (max-width: 64rem) {
        .application-preset-row { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        .preset-actions { grid-column: 1 / -1; flex-wrap: wrap; }
        .preset-actions button { min-width: 0; flex: 1 1 10rem; }
    }
    @container top-tools (max-width: 48rem) {
        .extract-row { grid-template-columns: 1fr 1fr; }
        .extract-actions { grid-column: 1 / -1; flex-wrap: wrap; }
    }
    @container top-tools (max-width: 38rem) {
        .application-preset-row { grid-template-columns: 1fr; }
    }
     @container top-tools (max-width: 21rem) {
         .extract-row { grid-template-columns: 1fr; }
         .extract-actions { grid-column: 1; }
         .extract-actions .extract-button { flex-basis: 100%; }
        .top-pane > header { display: grid; gap: .15rem; }
     }
     @container mapping-panel (max-width: 48rem) {
         .panel-header { align-items: flex-start; flex-direction: column; }
         .profile-manager { width: 100%; justify-content: flex-start; flex-wrap: wrap; }
         .profile-manager label { flex: 1 1 13rem; }
         .mapping-row { grid-template-columns: minmax(10rem, 1fr) minmax(14rem, 1.1fr); }
         .mapping-control--target { grid-column: 1 / -1; }
     }
      @container mapping-panel (max-width: 30rem) {
         .mapping-row { grid-template-columns: 1fr; }
         .mapping-control--target { grid-column: 1; }
          .block-editor { grid-column: 1; grid-template-columns: 1fr; }
     }

    @media (max-width: 900px) {
        .overlay-workspace { overflow-y: auto; }
        .top-tools,
        .application-preset-row,
        .extract-row,
        .setup-grid,
        .workspace-columns { grid-template-columns: 1fr; overflow: visible; }
        .split-handle,
        .top-split-handle { display: none; }
        .workspace-columns { flex: none; }
        .mapping-panel,
        .result-panel { max-height: 34rem; }
        .extract-actions { grid-column: 1; flex-wrap: wrap; }
    }
     @media (max-width: 620px) {
         .mapping-row { grid-template-columns: 1fr; }
         .mapping-control--target { grid-column: 1; }
     }
     @media (prefers-reduced-motion: reduce) {
         .setup-toggle,
         .preset-actions button,
         .profile-actions button,
         .block-toolbar button,
         .extract-button,
         .mapping-row,
         .mapping-row::before,
         .block-selector,
          .block-editor-toggle,
         .result-row { transition: none; }
     }
</style>
