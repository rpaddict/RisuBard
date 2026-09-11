<script lang="ts">
    import { onDestroy, tick } from 'svelte'
    import {
        AlertTriangleIcon,
        BracesIcon,
        CheckIcon,
        ClipboardIcon,
        PencilIcon,
        PlusIcon,
        Settings2Icon,
        SlidersHorizontalIcon,
        Trash2Icon,
    } from '@lucide/svelte'
    import { language } from 'src/lang'
    import { findTextareaMatch, revealTextareaMatch } from 'src/ts/gui/textareaSearch'
    import { persistElementHeight } from 'src/ts/gui/resizableSize'
    import type { PromptItem, PromptRole, PromptType } from 'src/ts/process/prompt'
    import {
        compilePromptV2Text,
        createPromptV2BodyPreviewSegments,
        evaluatePromptV2Activation,
        getPromptV2TextSource,
        insertPromptV2BodyCondition,
        loadPromptV2EditorMode,
        parsePromptV2Text,
        savePromptV2EditorMode,
        setPromptV2TextSource,
        type PromptV2Activation,
        type PromptV2Condition,
        type PromptV2EditorMode,
        type PromptV2Join,
        type PromptV2Operator,
        type PromptV2ToggleDefinition,
    } from 'src/ts/promptV2'
    import CbsConditionView from 'src/lib/UI/GUI/CbsConditionView.svelte'
    import ShAlert from 'src/lib/UI/GUI/ShAlert.svelte'
    import ShButton from 'src/lib/UI/GUI/ShButton.svelte'
    import ShDialog from 'src/lib/UI/GUI/ShDialog.svelte'
    import ShSwitch from 'src/lib/UI/GUI/ShSwitch.svelte'

    let {
        item,
        definitions,
        previewValues,
        scrollTop = 0,
        readOnly = false,
        simple = false,
        critical = false,
        onScrollTopChange = () => {},
        onReplace,
        onOpenToggleSetup,
    }: {
        item?: PromptItem
        definitions: PromptV2ToggleDefinition[]
        previewValues: Record<string, string>
        scrollTop?: number
        readOnly?: boolean
        simple?: boolean
        critical?: boolean
        onScrollTopChange?: (scrollTop: number) => void
        onReplace: (item: PromptItem) => void
        onOpenToggleSetup: () => void
    } = $props()

    let variableSearch = $state('')
    let copiedKey = $state('')
    let copyTimer: ReturnType<typeof setTimeout> | undefined
    let conditionError = $state('')
    let bodyPreviewElement: HTMLPreElement | undefined = $state()
    let bodyField: HTMLTextAreaElement | undefined = $state()
    let bodyFieldFocused = $state(false)
    let nameField: HTMLInputElement | undefined = $state()
    let visualBodyField: { focusSelection: (start: number, end: number) => void } | undefined = $state()
    let editorMode = $state<PromptV2EditorMode>(loadPromptV2EditorMode())
    let activationDialogOpen = $state(false)
    let syntaxDialogOpen = $state(false)
    let editingName = $state(false)
    let draftName = $state('')
    let bodySelection = $state({ start: 0, end: 0 })
    let bodySyntaxJoin = $state<PromptV2Join>('and')
    let bodySyntaxConditions = $state<PromptV2Condition[]>([])
    let lastSearch: { item: PromptItem; query: string } | undefined
    let visualBodyCommitTimer: ReturnType<typeof setTimeout> | undefined
    let pendingVisualItem: PromptItem | undefined
    let pendingVisualBody: string | undefined
    let pendingVisualActivation: PromptV2Activation | null = null
    let currentScrollTop = $state(0)

    const visualBodyCommitDelay = 750

    export async function findInBody(search: string) {
        if (!item) return
        if (editorMode !== 'source') await setEditorMode('source')
        if (!bodyField) return
        const query = search.trim()
        const continuing = lastSearch?.item === item && lastSearch.query === query
        const match = findTextareaMatch(bodyField.value, query, continuing ? bodyField.selectionEnd : 0)
        if (!match) return
        revealTextareaMatch(bodyField, match)
        if (bodyPreviewElement) bodyPreviewElement.scrollTop = bodyField.scrollTop
        lastSearch = { item, query }
    }

    export async function revealBodyRange(start: number, end: number) {
        await tick()
        if (editorMode === 'source') {
            if (!bodyField) return
            revealTextareaMatch(bodyField, { start, end })
            if (bodyPreviewElement) bodyPreviewElement.scrollTop = bodyField.scrollTop
        } else {
            visualBodyField?.focusSelection(start, end)
        }
    }

    export function replaceCurrentBodyMatch(search: string, replacement: string): boolean {
        if (readOnly) return false
        const query = search.trim()
        const currentItem = pendingVisualItem ?? item
        const body = pendingVisualBody ?? bodyField?.value ?? parsedText?.body
        const activation = pendingVisualBody !== undefined
            ? pendingVisualActivation
            : parsedText?.activation ?? null
        if (!query || !currentItem || body === undefined) return false

        const selectedStart = bodyField?.selectionStart ?? 0
        const selectedEnd = bodyField?.selectionEnd ?? 0
        const selected = body.slice(selectedStart, selectedEnd)
        const match = selected.localeCompare(query, undefined, { sensitivity: 'accent' }) === 0
            ? { start: selectedStart, end: selectedEnd }
            : findTextareaMatch(body, query)
        if (!match) return false

        cancelPendingVisualCommit()
        const next = buildTextItem(
            body.slice(0, match.start) + replacement + body.slice(match.end),
            activation,
            currentItem,
        )
        if (!next) return false
        lastSearch = undefined
        onReplace(next)
        return true
    }

    const textSource = $derived(item ? getPromptV2TextSource(item) : null)
    const parsedText = $derived(textSource ? parsePromptV2Text(textSource.source) : null)
    const previewState = $derived(
        parsedText?.activation
            ? evaluatePromptV2Activation(parsedText.activation, previewValues)
            : null,
    )
    const bodyPreviewSegments = $derived(
        parsedText
            ? createPromptV2BodyPreviewSegments(parsedText.body, previewValues, previewState)
            : [],
    )
    const hasBodyPreview = $derived(bodyPreviewSegments.some((segment) => segment.state !== 'neutral'))
    const visualVariableLabels = $derived(Object.fromEntries(definitions.map((definition) => [definition.key, definition.label])))
    const visibleDefinitions = $derived.by(() => {
        const query = variableSearch.trim().toLocaleLowerCase()
        if (!query) return definitions
        return definitions.filter((definition) =>
            definition.label.toLocaleLowerCase().includes(query)
            || definition.key.toLocaleLowerCase().includes(query)
            || definition.group?.toLocaleLowerCase().includes(query),
        )
    })

    $effect(() => {
        currentScrollTop = scrollTop
    })

    $effect(() => {
        const field = bodyField
        const position = currentScrollTop
        if (field && field.scrollTop !== position) {
            field.scrollTop = position
            if (bodyPreviewElement) bodyPreviewElement.scrollTop = position
        }
    })

    $effect(() => {
        if (bodySyntaxConditions.length === 0 && definitions[0]) {
            bodySyntaxConditions = [{ key: definitions[0].key, operator: 'is', value: defaultValue(definitions[0]) }]
        }
    })

    function cancelPendingVisualCommit() {
        if (visualBodyCommitTimer) clearTimeout(visualBodyCommitTimer)
        visualBodyCommitTimer = undefined
        pendingVisualItem = undefined
        pendingVisualBody = undefined
        pendingVisualActivation = null
    }

    export function flushPendingText() {
        if (readOnly) {
            cancelPendingVisualCommit()
            return
        }
        if (!pendingVisualItem || pendingVisualBody === undefined) return
        if (visualBodyCommitTimer) clearTimeout(visualBodyCommitTimer)
        visualBodyCommitTimer = undefined
        const next = buildTextItem(pendingVisualBody, pendingVisualActivation, pendingVisualItem)
        pendingVisualItem = undefined
        pendingVisualBody = undefined
        pendingVisualActivation = null
        if (next) onReplace(next)
    }

    onDestroy(flushPendingText)

    function patchItem(patch: Record<string, unknown>) {
        if (readOnly) return
        const current = pendingVisualItem && pendingVisualBody !== undefined
            ? buildTextItem(pendingVisualBody, pendingVisualActivation, pendingVisualItem)
            : item
        if (!current) return
        cancelPendingVisualCommit()
        onReplace({ ...current, ...patch } as PromptItem)
    }

    async function beginNameEdit() {
        if (!item || readOnly) return
        draftName = item.name ?? ''
        editingName = true
        await tick()
        nameField?.focus()
        nameField?.select()
    }

    function finishNameEdit(commit = true) {
        if (!editingName) return
        editingName = false
        if (commit) patchItem({ name: draftName })
    }

    function defaultValue(definition?: PromptV2ToggleDefinition): string {
        if (definition?.type === 'switch') return '1'
        return '0'
    }

    function buildTextItem(
        body: string,
        activation: PromptV2Activation | null,
        current: PromptItem | undefined = pendingVisualItem ?? item,
    ): PromptItem | undefined {
        if (!current) return
        const currentSource = getPromptV2TextSource(current)
        if (!currentSource || !parsePromptV2Text(currentSource.source).editable) return
        try {
            const next = { ...current } as PromptItem
            setPromptV2TextSource(next, compilePromptV2Text(body, activation))
            conditionError = ''
            return next
        } catch (error) {
            conditionError = error instanceof Error ? error.message : String(error)
        }
    }

    function applyText(body: string, activation: PromptV2Activation | null = parsedText?.activation ?? null) {
        if (readOnly) return
        const next = buildTextItem(body, activation)
        if (!next) return
        cancelPendingVisualCommit()
        onReplace(next)
    }

    function scheduleVisualText(body: string) {
        if (readOnly || !item || !textSource || !parsedText?.editable) return
        if (visualBodyCommitTimer) clearTimeout(visualBodyCommitTimer)
        pendingVisualItem ??= item
        pendingVisualBody = body
        pendingVisualActivation = parsedText.activation
        visualBodyCommitTimer = setTimeout(flushPendingText, visualBodyCommitDelay)
    }

    function currentBody(): string {
        return pendingVisualBody ?? parsedText?.body ?? ''
    }

    function enableConditions() {
        if (readOnly || !parsedText?.editable || parsedText.activation || definitions.length === 0) return
        const definition = definitions[0]
        applyText(currentBody(), {
            join: 'and',
            conditions: [{ key: definition.key, operator: 'is', value: defaultValue(definition) }],
        })
    }

    function updateActivation(patch: Partial<PromptV2Activation>) {
        if (readOnly || !parsedText?.activation) return
        applyText(currentBody(), { ...parsedText.activation, ...patch })
    }

    function updateCondition(index: number, patch: Partial<PromptV2Condition>) {
        if (!parsedText?.activation) return
        const conditions = parsedText.activation.conditions.map((condition, conditionIndex) =>
            conditionIndex === index ? { ...condition, ...patch } : condition,
        )
        updateActivation({ conditions })
    }

    function selectConditionVariable(index: number, key: string) {
        const definition = definitions.find((entry) => entry.key === key)
        updateCondition(index, { key, value: defaultValue(definition) })
    }

    function addCondition(definition = definitions[0]) {
        if (readOnly || !definition || !parsedText?.editable) return
        if (!parsedText.activation) {
            applyText(currentBody(), {
                join: 'and',
                conditions: [{ key: definition.key, operator: 'is', value: defaultValue(definition) }],
            })
            return
        }
        updateActivation({
            conditions: [
                ...parsedText.activation.conditions,
                { key: definition.key, operator: 'is', value: defaultValue(definition) },
            ],
        })
    }

    function removeCondition(index: number) {
        if (readOnly || !parsedText?.activation) return
        const conditions = parsedText.activation.conditions.filter((_, conditionIndex) => conditionIndex !== index)
        if (conditions.length === 0) {
            applyText(currentBody(), null)
            activationDialogOpen = false
        } else {
            updateActivation({ conditions })
        }
    }

    async function setEditorMode(mode: PromptV2EditorMode) {
        if (mode === editorMode) return
        if (bodyField) bodySelection = { start: bodyField.selectionStart, end: bodyField.selectionEnd }
        if (editorMode === 'visual') flushPendingText()
        editorMode = mode
        savePromptV2EditorMode(mode)
        await tick()
        if (mode === 'source' && bodyField) {
            bodyField.focus()
            bodyField.setSelectionRange(bodySelection.start, bodySelection.end)
        } else {
            visualBodyField?.focusSelection(bodySelection.start, bodySelection.end)
        }
    }

    function updateBodySelection(selection?: { start: number; end: number }) {
        if (selection) bodySelection = selection
        else if (bodyField) bodySelection = { start: bodyField.selectionStart, end: bodyField.selectionEnd }
    }

    function updateBodySyntaxCondition(index: number, patch: Partial<PromptV2Condition>) {
        bodySyntaxConditions = bodySyntaxConditions.map((condition, conditionIndex) =>
            conditionIndex === index ? { ...condition, ...patch } : condition,
        )
    }

    function selectBodySyntaxVariable(index: number, key: string) {
        const definition = definitions.find((entry) => entry.key === key)
        updateBodySyntaxCondition(index, { key, value: defaultValue(definition) })
    }

    function addBodySyntaxCondition() {
        const definition = definitions[0]
        if (!definition) return
        bodySyntaxConditions = [
            ...bodySyntaxConditions,
            { key: definition.key, operator: 'is', value: defaultValue(definition) },
        ]
    }

    function removeBodySyntaxCondition(index: number) {
        if (bodySyntaxConditions.length <= 1) return
        bodySyntaxConditions = bodySyntaxConditions.filter((_, conditionIndex) => conditionIndex !== index)
    }

    async function insertBodyCondition() {
        if (readOnly || !parsedText || bodySyntaxConditions.length === 0) return
        const result = insertPromptV2BodyCondition(
            currentBody(),
            bodySelection.start,
            bodySelection.end,
            { join: bodySyntaxJoin, conditions: bodySyntaxConditions },
        )
        bodySelection = { start: result.selectionStart, end: result.selectionEnd }
        applyText(result.body)
        syntaxDialogOpen = false
        await tick()
        if (editorMode === 'source' && bodyField) {
            bodyField.focus()
            bodyField.setSelectionRange(result.selectionStart, result.selectionEnd)
        } else {
            visualBodyField?.focusSelection(result.selectionStart, result.selectionEnd)
        }
    }

    function replaceType(type: PromptType) {
        if (readOnly) return
        const current = pendingVisualItem && pendingVisualBody !== undefined
            ? buildTextItem(pendingVisualBody, pendingVisualActivation, pendingVisualItem)
            : item
        if (!current || type === current.type) return
        const name = current.name
        const currentSource = getPromptV2TextSource(current)
        const currentParsed = currentSource ? parsePromptV2Text(currentSource.source) : null
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

        if (currentSource && currentParsed?.editable && getPromptV2TextSource(next)) {
            setPromptV2TextSource(next, compilePromptV2Text(currentParsed.body, currentParsed.activation))
        }
        cancelPendingVisualCommit()
        onReplace(next)
    }

    function conditionDefinition(condition: PromptV2Condition): PromptV2ToggleDefinition | undefined {
        return definitions.find((definition) => definition.key === condition.key)
    }

    async function copyVariableKey(definition: PromptV2ToggleDefinition) {
        if (!navigator.clipboard?.writeText) return
        await navigator.clipboard.writeText(definition.key)
        copiedKey = definition.key
        if (copyTimer) clearTimeout(copyTimer)
        copyTimer = setTimeout(() => copiedKey = '', 1400)
    }

    function hasRole2(value: PromptItem): value is PromptItem & { role2?: PromptRole } {
        return value.type === 'persona' || value.type === 'description' || value.type === 'authornote' || value.type === 'memory'
    }

    function syncBodyPreviewScroll(event: Event) {
        const field = event.currentTarget as HTMLTextAreaElement
        currentScrollTop = field.scrollTop
        onScrollTopChange(field.scrollTop)
        if (bodyPreviewElement) {
            bodyPreviewElement.scrollTop = field.scrollTop
            bodyPreviewElement.scrollLeft = field.scrollLeft
        }
    }
</script>

{#if item}
    <section class="flex h-full min-h-0 flex-col" aria-label={language.promptV2.editor}>
        <header class="prompt-v2-pane-header prompt-v2-editor-header">
            <div class="editor-title-control">
                <Settings2Icon size={16} class="shrink-0 text-borderc" />
                {#if editingName}
                    <input
                        data-prompt-v2-name-input
                        bind:this={nameField}
                        class="editor-title-input"
                        bind:value={draftName}
                        aria-label={language.name}
                        onblur={() => finishNameEdit()}
                        onkeydown={(event) => {
                            if (event.key === 'Enter' && !event.isComposing) event.currentTarget.blur()
                            if (event.key === 'Escape') finishNameEdit(false)
                        }}
                    />
                {:else}
                    <button
                        data-prompt-v2-name
                        type="button"
                        class="editor-title-button"
                        class:editor-title-button--critical={critical}
                        disabled={readOnly}
                        onclick={beginNameEdit}
                        title={language.name}
                    >
                        <span class="truncate">{item.name?.trim() || language.promptV2.editor}</span>
                        {#if !readOnly}<PencilIcon size={13} />{/if}
                    </button>
                {/if}
            </div>

            {#if !simple}<div data-prompt-v2-header-fields class="editor-header-fields">
                <label>
                    <span>{language.type}</span>
                    <select value={item.type} onchange={(event) => replaceType(event.currentTarget.value as PromptType)}>
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

                {#if item.type === 'plain' || item.type === 'jailbreak' || item.type === 'cot'}
                    <label>
                        <span>{language.specialType}</span>
                        <select value={item.type2} onchange={(event) => patchItem({ type2: event.currentTarget.value })}>
                            <option value="normal">{language.noSpecialType}</option>
                            <option value="main">{language.mainPrompt}</option>
                            <option value="globalNote">{language.globalNote}</option>
                        </select>
                    </label>
                    <label>
                        <span>{language.role}</span>
                        <select value={item.role} onchange={(event) => patchItem({ role: event.currentTarget.value })}>
                            <option value="user">{language.user}</option>
                            <option value="bot">{language.character}</option>
                            <option value="system">{language.systemPrompt}</option>
                        </select>
                    </label>
                {:else if hasRole2(item)}
                    <label>
                        <span>{language.role}</span>
                        <select value={item.role2 ?? 'system'} onchange={(event) => patchItem({ role2: event.currentTarget.value })}>
                            <option value="user">{language.user}</option>
                            <option value="bot">{language.character}</option>
                            <option value="system">{language.systemPrompt}</option>
                        </select>
                    </label>
                {:else if item.type === 'cache'}
                    <label>
                        <span>{language.role}</span>
                        <select value={item.role} onchange={(event) => patchItem({ role: event.currentTarget.value })}>
                            <option value="all">{language.all}</option>
                            <option value="user">{language.user}</option>
                            <option value="assistant">{language.character}</option>
                            <option value="system">{language.systemPrompt}</option>
                        </select>
                    </label>
                {/if}
            </div>{/if}
        </header>

        {#if textSource && parsedText}
        <div class="editor-toolbar">
            {#if textSource && parsedText?.editable && !readOnly}
                <div class="toolbar-control">
                    <ShButton size="sm" variant="secondary" onclick={() => activationDialogOpen = true}>
                        <SlidersHorizontalIcon size={15} />
                        {language.promptV2.activation}
                    </ShButton>
                    <ShSwitch
                        checked={!!parsedText.activation}
                        disabled={!parsedText.activation && definitions.length === 0}
                        ariaLabel={language.promptV2.activation}
                        onCheckedChange={(checked) => checked ? enableConditions() : applyText(parsedText.body, null)}
                    />
                </div>
                <ShButton size="sm" variant="secondary" onclick={() => syntaxDialogOpen = true}>
                    <BracesIcon size={15} />
                    {language.promptV2.conditionDesigner}
                </ShButton>
            {/if}
            <div class="editor-mode-tabs" aria-label={language.promptV2.editorMode}>
                <button type="button" aria-pressed={editorMode === 'source'} onclick={() => setEditorMode('source')}>
                    {language.promptV2.sourceMode}
                </button>
                <button type="button" aria-pressed={editorMode === 'visual'} onclick={() => setEditorMode('visual')}>
                    {language.promptV2.visualMode}
                </button>
            </div>
        </div>
        {/if}

        <div class="min-h-0 grow overflow-y-auto p-4">
            {#if textSource && parsedText?.editable}
                <ShDialog bind:open={activationDialogOpen} size="lg" closeOnEscape contentClass="prompt-v2-tool-dialog">
                    {#snippet title()}{language.promptV2.activation}{/snippet}
                    <p class="text-sm text-textcolor2">
                        {parsedText.activation ? language.promptV2.activationConditional : language.promptV2.activationAlways}
                    </p>

                    {#if parsedText.activation}
                        <div class="mt-4 flex flex-wrap items-center gap-2 border-t border-darkborderc pt-4">
                            <span class="text-xs font-medium text-textcolor2">{language.promptV2.activation}</span>
                            <select
                                class="field-control h-9 min-w-48 text-sm"
                                value={parsedText.activation.join}
                                onchange={(event) => updateActivation({ join: event.currentTarget.value as 'and' | 'or' })}
                            >
                                <option value="and">{language.promptV2.matchAll}</option>
                                <option value="or">{language.promptV2.matchAny}</option>
                            </select>
                        </div>

                        <div class="mt-3 flex flex-col gap-2">
                            {#each parsedText.activation.conditions as condition, conditionIndex}
                                {@const definition = conditionDefinition(condition)}
                                <div class="condition-row">
                                    <span class="condition-index">{conditionIndex + 1}</span>
                                    <label class="sr-only" for="condition-key-{conditionIndex}">{language.promptV2.rawVariableKey}</label>
                                    <select
                                        id="condition-key-{conditionIndex}"
                                        class="field-control min-w-0 grow"
                                        value={condition.key}
                                        onchange={(event) => selectConditionVariable(conditionIndex, event.currentTarget.value)}
                                    >
                                        {#if !definition}<option value={condition.key}>{condition.key}</option>{/if}
                                        {#each definitions as entry}
                                            <option value={entry.key}>{entry.group ? `${entry.group} · ` : ''}{entry.label}</option>
                                        {/each}
                                    </select>
                                    <select
                                        class="field-control w-28 shrink-0"
                                        value={condition.operator}
                                        aria-label={language.promptV2.activation}
                                        onchange={(event) => updateCondition(conditionIndex, { operator: event.currentTarget.value as PromptV2Operator })}
                                    >
                                        <option value="is">{language.promptV2.is}</option>
                                        <option value="isnot">{language.promptV2.isNot}</option>
                                        <option value="greater">&gt;</option>
                                        <option value="greaterequal">≥</option>
                                        <option value="less">&lt;</option>
                                        <option value="lessequal">≤</option>
                                    </select>

                                    {#if definition?.type === 'switch'}
                                        <select
                                            class="field-control w-24 shrink-0"
                                            value={condition.value}
                                            aria-label={language.promptV2.conditionValue}
                                            onchange={(event) => updateCondition(conditionIndex, { value: event.currentTarget.value })}
                                        >
                                            <option value="1">{language.promptV2.on}</option>
                                            <option value="0">{language.promptV2.off}</option>
                                        </select>
                                    {:else if definition?.type === 'select' && definition.options.length > 0}
                                        <select
                                            class="field-control w-36 shrink-0"
                                            value={condition.value}
                                            aria-label={language.promptV2.conditionValue}
                                            onchange={(event) => updateCondition(conditionIndex, { value: event.currentTarget.value })}
                                        >
                                            {#each definition.options as option, optionIndex}
                                                <option value={String(optionIndex)}>{option}</option>
                                            {/each}
                                        </select>
                                    {:else}
                                        <input
                                            class="field-control w-36 shrink-0"
                                            value={condition.value}
                                            aria-label={language.promptV2.conditionValue}
                                            oninput={(event) => updateCondition(conditionIndex, { value: event.currentTarget.value })}
                                        />
                                    {/if}

                                    <ShButton
                                        size="icon-sm"
                                        variant="ghost"
                                        onclick={() => removeCondition(conditionIndex)}
                                        title={language.remove}
                                        aria-label={language.remove}
                                    ><Trash2Icon size={15} /></ShButton>
                                </div>
                            {/each}
                        </div>

                        <div class="mt-3 flex justify-end">
                            <ShButton size="sm" variant="outline" onclick={() => addCondition()} disabled={definitions.length === 0}>
                                <PlusIcon size={14} />
                                {language.promptV2.addCondition}
                            </ShButton>
                        </div>
                    {:else if definitions.length === 0}
                        <div class="mt-4 rounded-lg border border-dashed border-darkborderc p-3 text-sm text-textcolor2">
                            <p>{language.promptV2.noToggleVariables}</p>
                            <ShButton size="sm" variant="outline" className="mt-3" onclick={() => { flushPendingText(); onOpenToggleSetup() }}>
                                <SlidersHorizontalIcon size={14} />
                                {language.promptV2.togglesMode}
                            </ShButton>
                        </div>
                    {/if}

                    {#if conditionError}
                        <p class="mt-3 text-xs text-danger">{conditionError}</p>
                    {/if}
                </ShDialog>
            {:else if parsedText && !parsedText.editable}
                <ShAlert variant="warning" className="mb-4">
                    {#snippet icon()}<AlertTriangleIcon />{/snippet}
                    {#snippet title()}{language.promptV2.manualConditionTitle}{/snippet}
                    {language.promptV2.manualConditionDescription}
                </ShAlert>
            {:else}
                <ShAlert variant="info" className="mb-4">
                    {#snippet icon()}<BracesIcon />{/snippet}
                    {language.promptV2.unsupportedActivation}
                </ShAlert>
            {/if}

            {#if textSource && parsedText}
                <section class="editor-card prompt-body-card">
                    <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
                        <h3 class="text-sm font-semibold">
                            {textSource.field === 'innerFormat' ? language.promptV2.innerFormat : language.promptV2.promptBody}
                        </h3>
                        <div class="flex items-center gap-2">
                            {#if parsedText.format === 'legacy'}
                                <span class="rounded-full border border-warning-border bg-warning-bg px-2 py-0.5 text-[11px] text-warning">Legacy</span>
                            {/if}
                        </div>
                    </div>
                    <ShDialog bind:open={syntaxDialogOpen} size="lg" closeOnEscape contentClass="prompt-v2-tool-dialog">
                        {#snippet title()}{language.promptV2.conditionDesigner}{/snippet}
                        <div class="syntax-palette" data-prompt-v2-syntax-palette>
                            <div class="syntax-palette-heading">
                                <div>
                                    <h4>{language.promptV2.syntaxPalette}</h4>
                                    <p>{language.promptV2.syntaxPaletteHint}</p>
                                </div>
                                {#if bodySyntaxConditions.length > 1}
                                    <select class="field-control syntax-join" bind:value={bodySyntaxJoin} aria-label={language.promptV2.conditionJoin}>
                                        <option value="and">{language.promptV2.matchAll}</option>
                                        <option value="or">{language.promptV2.matchAny}</option>
                                    </select>
                                {/if}
                            </div>
                            <div class="syntax-condition-list">
                                {#each bodySyntaxConditions as condition, conditionIndex}
                                    {@const definition = conditionDefinition(condition)}
                                    <div class="syntax-condition-row">
                                        <span class="condition-index">{conditionIndex + 1}</span>
                                        <select
                                            class="field-control"
                                            value={condition.key}
                                            aria-label={language.promptV2.rawVariableKey}
                                            onchange={(event) => selectBodySyntaxVariable(conditionIndex, event.currentTarget.value)}
                                        >
                                            {#if !definition}<option value={condition.key}>{condition.key}</option>{/if}
                                            {#each definitions as entry}
                                                <option value={entry.key}>{entry.group ? `${entry.group} · ` : ''}{entry.label}</option>
                                            {/each}
                                        </select>
                                        <select
                                            class="field-control syntax-operator"
                                            value={condition.operator}
                                            aria-label={language.promptV2.conditionOperator}
                                            onchange={(event) => updateBodySyntaxCondition(conditionIndex, { operator: event.currentTarget.value as PromptV2Operator })}
                                        >
                                            <option value="is">=</option>
                                            <option value="isnot">≠</option>
                                            <option value="greater">&gt;</option>
                                            <option value="greaterequal">≥</option>
                                            <option value="less">&lt;</option>
                                            <option value="lessequal">≤</option>
                                        </select>
                                        {#if definition?.type === 'switch'}
                                            <select
                                                class="field-control syntax-value"
                                                value={condition.value}
                                                aria-label={language.promptV2.conditionValue}
                                                onchange={(event) => updateBodySyntaxCondition(conditionIndex, { value: event.currentTarget.value })}
                                            >
                                                <option value="1">{language.promptV2.on}</option>
                                                <option value="0">{language.promptV2.off}</option>
                                            </select>
                                        {:else if definition?.type === 'select' && definition.options.length > 0}
                                            <select
                                                class="field-control syntax-value"
                                                value={condition.value}
                                                aria-label={language.promptV2.conditionValue}
                                                onchange={(event) => updateBodySyntaxCondition(conditionIndex, { value: event.currentTarget.value })}
                                            >
                                                {#each definition.options as option, optionIndex}
                                                    <option value={String(optionIndex)}>{option}</option>
                                                {/each}
                                            </select>
                                        {:else}
                                            <input
                                                class="field-control syntax-value"
                                                value={condition.value}
                                                aria-label={language.promptV2.conditionValue}
                                                oninput={(event) => updateBodySyntaxCondition(conditionIndex, { value: event.currentTarget.value })}
                                            />
                                        {/if}
                                        <ShButton
                                            size="icon-sm"
                                            variant="ghost"
                                            disabled={bodySyntaxConditions.length <= 1}
                                            onclick={() => removeBodySyntaxCondition(conditionIndex)}
                                            title={language.remove}
                                            aria-label={language.remove}
                                        ><Trash2Icon size={15} /></ShButton>
                                    </div>
                                {/each}
                            </div>
                            <div class="syntax-actions">
                                <ShButton size="sm" variant="ghost" onclick={addBodySyntaxCondition} disabled={definitions.length === 0}>
                                    <PlusIcon size={14} />{language.promptV2.addCondition}
                                </ShButton>
                                <ShButton size="sm" onclick={insertBodyCondition} disabled={definitions.length === 0 || bodySyntaxConditions.length === 0}>
                                    <BracesIcon size={14} />{bodySelection.start === bodySelection.end ? language.promptV2.insertAtCursor : language.promptV2.wrapSelection}
                                </ShButton>
                            </div>
                        </div>
                    </ShDialog>
                    {#if editorMode === 'visual'}
                        <div class="prompt-body-visual" use:persistElementHeight={'prompt-v2-body'}>
                            <CbsConditionView
                                bind:this={visualBodyField}
                                value={parsedText.body}
                                onInput={scheduleVisualText}
                                onblur={flushPendingText}
                                variableLabels={visualVariableLabels}
                                switchVariables={definitions.filter(definition => definition.type === 'switch').map(definition => definition.key)}
                                previewSegments={bodyPreviewSegments}
                                showVariableSidebar={false}
                                allowBlockActions
                                scrollTop={currentScrollTop}
                                onScrollTopChange={(position) => {
                                    currentScrollTop = position
                                    onScrollTopChange(position)
                                }}
                                onSelectionChange={updateBodySelection}
                            />
                        </div>
                    {:else}
                        <div
                            class="prompt-body-editor"
                            class:prompt-body-editor--active={previewState === true}
                            class:prompt-body-editor--inactive={previewState === false}
                        >
                            {#if hasBodyPreview && !bodyFieldFocused}
                                <pre class="prompt-body-preview" bind:this={bodyPreviewElement} aria-hidden="true">{#each bodyPreviewSegments as segment}<span
                                    class:prompt-body-preview-text--active={segment.state === 'active'}
                                    class:prompt-body-preview-text--inactive={segment.state === 'inactive'}
                                >{segment.text}</span>{/each}{'\n'}</pre>
                            {/if}
                            <textarea
                                class="prompt-body-field"
                                bind:this={bodyField}
                                use:persistElementHeight={'prompt-v2-body'}
                                class:prompt-body-field--preview={hasBodyPreview && !bodyFieldFocused}
                                class:prompt-body-field--active={previewState === true}
                                class:prompt-body-field--inactive={previewState === false}
                                value={parsedText.body}
                                readonly={readOnly || !parsedText.editable}
                                spellcheck="false"
                                onfocus={() => { bodyFieldFocused = true }}
                                onblur={() => { bodyFieldFocused = false }}
                                onselect={() => updateBodySelection()}
                                onscroll={syncBodyPreviewScroll}
                                oninput={(event) => applyText(event.currentTarget.value)}
                            ></textarea>
                        </div>
                    {/if}
                </section>
            {/if}

            {#if textSource && parsedText?.editable}
                <details class="editor-card mt-4">
                    <summary class="flex min-h-9 cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold">
                        <span class="flex items-center gap-2"><BracesIcon size={15} class="text-textcolor2" />{language.promptV2.variableLibrary}</span>
                        <span class="text-xs font-normal text-textcolor2">{language.promptV2.toggleCount(definitions.length)}</span>
                    </summary>
                    <div class="relative mt-3">
                        <input class="field-control pl-3" bind:value={variableSearch} placeholder={language.promptV2.searchVariables} />
                    </div>
                    <div class="mt-2 grid max-h-56 gap-1 overflow-y-auto sm:grid-cols-2">
                        {#each visibleDefinitions as definition (definition)}
                            <div class="flex min-w-0 items-center gap-1 rounded-lg border border-darkborderc p-2">
                                <div class="min-w-0 grow">
                                    <div class="truncate text-xs font-medium">{definition.label}</div>
                                    <div class="mt-0.5 truncate font-mono text-[10px] text-textcolor2">{definition.key}</div>
                                </div>
                                <ShButton size="icon-xs" variant="ghost" onclick={() => copyVariableKey(definition)} title={language.promptV2.copyKey} aria-label={language.promptV2.copyKey}>
                                    {#if copiedKey === definition.key}<CheckIcon class="text-success" />{:else}<ClipboardIcon />{/if}
                                </ShButton>
                                <ShButton size="icon-xs" variant="ghost" onclick={() => addCondition(definition)} title={language.promptV2.insertCondition} aria-label={language.promptV2.insertCondition}>
                                    <PlusIcon />
                                </ShButton>
                            </div>
                        {/each}
                    </div>
                </details>
            {/if}
        </div>
    </section>
{:else}
    <div class="flex h-full min-h-80 flex-col items-center justify-center px-8 text-center">
        <BracesIcon size={28} class="mb-3 text-textcolor2" />
        <p class="text-sm font-medium">{language.promptV2.selectBlock}</p>
        <p class="mt-1 max-w-sm text-xs leading-relaxed text-textcolor2">{language.promptV2.workspaceHelp}</p>
    </div>
{/if}

<style>
    .prompt-v2-editor-header {
        display: flex;
        min-width: 0;
        align-items: center;
        justify-content: space-between;
        gap: .75rem;
        border-bottom: 1px solid var(--color-darkborderc);
        padding: .5rem .75rem;
    }

    .editor-title-control {
        display: flex;
        min-width: 8rem;
        flex: 1 1 14rem;
        align-items: center;
        gap: .45rem;
    }

    .editor-title-button,
    .editor-title-input {
        min-width: 0;
        width: 100%;
        height: 2rem;
        border: 1px solid transparent;
        border-radius: .4rem;
        padding: .25rem .45rem;
        color: var(--color-textcolor);
        background: transparent;
        font-size: .88rem;
        font-weight: 650;
        text-align: left;
        outline: none;
    }

    .editor-title-button { display: flex; align-items: center; gap: .4rem; cursor: text; }
    .editor-title-button:disabled { cursor: default; opacity: 1; }
    .editor-title-button--critical { color: var(--color-danger); }
    .editor-title-button :global(svg) { flex-shrink: 0; color: var(--color-textcolor2); opacity: 0; }
    .editor-title-button:hover { border-color: var(--color-darkborderc); background: color-mix(in srgb, var(--color-selected) 24%, transparent); }
    .editor-title-button:hover :global(svg), .editor-title-button:focus-visible :global(svg) { opacity: 1; }
    .editor-title-button:focus-visible, .editor-title-input:focus { border-color: var(--color-borderc); box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-borderc) 40%, transparent); }

    .editor-header-fields {
        display: flex;
        min-width: 0;
        flex: 0 1 auto;
        align-items: center;
        justify-content: flex-end;
        gap: .5rem;
    }

    .editor-header-fields label { display: flex; align-items: center; gap: .3rem; }
    .editor-header-fields label > span { color: var(--color-textcolor2); font-size: .66rem; white-space: nowrap; }
    .editor-header-fields select {
        width: clamp(5.75rem, 8vw, 8.5rem);
        height: 2rem;
        border: 1px solid var(--color-darkborderc);
        border-radius: .4rem;
        padding: .2rem .45rem;
        color: var(--color-textcolor);
        background: var(--color-darkbg);
        font-size: .72rem;
        outline: none;
    }
    .editor-header-fields select:focus { border-color: var(--color-borderc); box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-borderc) 40%, transparent); }

    .editor-toolbar {
        display: flex;
        min-height: 3rem;
        flex-wrap: wrap;
        align-items: center;
        gap: .5rem;
        border-bottom: 1px solid var(--color-darkborderc);
        padding: .4rem .75rem;
        background: color-mix(in srgb, var(--color-darkbutton) 26%, transparent);
    }

    .toolbar-control {
        display: inline-flex;
        min-height: 2rem;
        align-items: center;
        gap: .55rem;
        padding-right: .15rem;
    }

    :global(.prompt-v2-tool-dialog) {
        width: min(calc(100vw - 2rem), 46rem);
        max-width: calc(100vw - 2rem);
    }

    .editor-card {
        border: 1px solid var(--color-darkborderc);
        border-radius: .75rem;
        background: color-mix(in srgb, var(--color-darkbg) 78%, transparent);
        padding: 1rem;
    }

    .field-control {
        width: 100%;
        min-height: 2.5rem;
        border: 1px solid var(--color-darkborderc);
        border-radius: .45rem;
        padding: .45rem .7rem;
        color: var(--color-textcolor);
        background: transparent;
        outline: none;
        transition: color 160ms ease, background-color 160ms ease, border-color 160ms ease;
    }

    .field-control:focus {
        border-color: var(--color-borderc);
        box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-borderc) 45%, transparent);
    }

    .field-control:disabled { opacity: .55; }

    .condition-row {
        display: grid;
        grid-template-columns: 1.75rem minmax(9rem, 1fr) 7rem minmax(6rem, 9rem) 2rem;
        align-items: center;
        gap: .45rem;
        border: 1px solid var(--color-darkborderc);
        border-radius: .65rem;
        padding: .5rem;
        background: color-mix(in srgb, var(--color-darkbutton) 34%, transparent);
    }

    .condition-index {
        display: inline-flex;
        width: 1.55rem;
        height: 1.55rem;
        align-items: center;
        justify-content: center;
        border-radius: 999px;
        color: var(--color-binding-text);
        background: var(--color-binding);
        font-size: .7rem;
        font-weight: 700;
    }

    .editor-mode-tabs {
        display: inline-flex;
        margin-left: auto;
        padding: .15rem;
        border: 1px solid var(--color-darkborderc);
        border-radius: .45rem;
        background: color-mix(in srgb, var(--color-bgcolor) 70%, transparent);
    }

    .editor-mode-tabs button {
        min-height: 2.25rem;
        padding: .35rem .65rem;
        border: 0;
        border-radius: .3rem;
        color: var(--color-textcolor2);
        background: transparent;
        font-size: .78rem;
        font-weight: 600;
        cursor: pointer;
    }

    .editor-mode-tabs button[aria-pressed='true'] {
        color: var(--color-binding-text);
        background: var(--color-binding);
        box-shadow: inset 0 0 0 1px var(--color-binding-border);
    }

    .editor-mode-tabs button:hover { color: var(--color-textcolor); background: color-mix(in srgb, var(--color-selected) 30%, transparent); }
    .editor-mode-tabs button[aria-pressed='true']:hover { color: var(--color-binding-text); background: var(--color-binding); }

    .editor-mode-tabs button:focus-visible {
        outline: 1px solid var(--color-borderc);
        outline-offset: 1px;
    }

    .syntax-palette {
        margin-bottom: .65rem;
        border: 1px solid var(--color-darkborderc);
        border-radius: .6rem;
        padding: .65rem;
        background: color-mix(in srgb, var(--color-darkbutton) 32%, transparent);
    }

    .syntax-palette-heading,
    .syntax-actions {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: .5rem;
    }

    .syntax-palette-heading h4 { margin: 0; font-size: .75rem; font-weight: 650; }
    .syntax-palette-heading p { margin: .15rem 0 0; color: var(--color-textcolor2); font-size: .68rem; }
    .syntax-join { width: auto; min-width: 10.5rem; min-height: 2rem; padding-block: .25rem; font-size: .72rem; }
    .syntax-condition-list { display: grid; gap: .35rem; margin-top: .55rem; }
    .syntax-condition-row {
        display: grid;
        grid-template-columns: 1.6rem minmax(8rem, 1fr) 4.25rem minmax(5.5rem, 8rem) 2rem;
        align-items: center;
        gap: .35rem;
    }
    .syntax-condition-row .field-control { min-height: 2rem; padding: .25rem .45rem; font-size: .72rem; }
    .syntax-operator, .syntax-value { width: 100%; }
    .syntax-actions { justify-content: flex-end; margin-top: .55rem; border-top: 1px solid var(--color-darkborderc); padding-top: .55rem; }

    .prompt-body-visual {
        display: block;
        width: 100%;
        height: 16rem;
        min-height: 16rem;
        resize: vertical;
        overflow: hidden;
        border: 1px solid var(--color-darkborderc);
        border-radius: .6rem;
        background: color-mix(in srgb, var(--color-bgcolor) 65%, transparent);
    }

    .prompt-body-field,
    .prompt-body-preview {
        scrollbar-gutter: stable;
    }

    .prompt-body-field {
        position: relative;
        z-index: 1;
        display: block;
        width: 100%;
        min-height: 16rem;
        resize: vertical;
        border: 1px solid var(--color-darkborderc);
        border-radius: .6rem;
        padding: .8rem;
        color: var(--color-textcolor);
        background: color-mix(in srgb, var(--color-bgcolor) 65%, transparent);
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        font-size: .8rem;
        line-height: 1.55;
        outline: none;
    }

    .prompt-body-editor { position: relative; border-radius: .6rem; }

    .prompt-body-preview {
        position: absolute;
        inset: 1px;
        z-index: 0;
        min-height: calc(100% - 2px);
        margin: 0;
        overflow: hidden;
        border-radius: .55rem;
        padding: .8rem;
        color: var(--color-textcolor);
        background: color-mix(in srgb, var(--color-bgcolor) 65%, transparent);
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        font-size: .8rem;
        line-height: 1.55;
        overflow-wrap: break-word;
        pointer-events: none;
        white-space: pre-wrap;
    }

    .prompt-body-preview span {
        font: inherit;
        transition: color 160ms ease, opacity 160ms ease;
    }
    .prompt-body-preview-text--active { color: var(--color-info); }
    .prompt-body-preview-text--inactive {
        color: color-mix(in srgb, var(--color-textcolor2) 42%, var(--color-bgcolor));
        opacity: .72;
    }

    .prompt-body-field--active {
        border-color: color-mix(in srgb, var(--color-info) 58%, var(--color-darkborderc));
        color: color-mix(in srgb, var(--color-info) 86%, var(--color-textcolor));
        background: color-mix(in srgb, var(--color-info-bg) 45%, var(--color-bgcolor));
    }

    .prompt-body-field--inactive:not(:focus) {
        color: color-mix(in srgb, var(--color-textcolor2) 42%, var(--color-bgcolor));
        background: color-mix(in srgb, var(--color-bgcolor) 82%, var(--color-darkbg));
    }

    .prompt-body-editor--active .prompt-body-preview {
        background: color-mix(in srgb, var(--color-info-bg) 45%, var(--color-bgcolor));
    }

    .prompt-body-editor--inactive .prompt-body-preview {
        background: color-mix(in srgb, var(--color-bgcolor) 82%, var(--color-darkbg));
    }

    .prompt-body-field--preview,
    .prompt-body-field--preview:focus {
        color: transparent;
        caret-color: var(--color-textcolor);
        background: transparent;
        -webkit-text-fill-color: transparent;
    }

    .prompt-body-field:focus {
        border-color: var(--color-borderc);
        box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-borderc) 45%, transparent);
    }

    .prompt-body-field:read-only { opacity: .72; }

    @media (max-width: 720px) {
        .prompt-v2-editor-header { align-items: stretch; flex-direction: column; }
        .editor-title-control, .editor-header-fields { width: 100%; }
        .editor-header-fields { justify-content: flex-start; overflow-x: auto; padding-bottom: .15rem; }
        .condition-row { grid-template-columns: 1.75rem minmax(0, 1fr) 2rem; }
        .condition-row > :global(:nth-child(3)),
        .condition-row > :global(:nth-child(4)) { grid-column: 2 / 3; width: 100%; }
        .condition-row > :global(:last-child) { grid-column: 3; grid-row: 1; }
        .syntax-condition-row { grid-template-columns: 1.6rem minmax(0, 1fr) 2rem; }
        .syntax-condition-row > :global(:nth-child(3)),
        .syntax-condition-row > :global(:nth-child(4)) { grid-column: 2 / 3; width: 100%; }
        .syntax-condition-row > :global(:last-child) { grid-column: 3; grid-row: 1; }
    }
</style>
