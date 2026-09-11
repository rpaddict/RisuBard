<script lang="ts">
    import { GripVerticalIcon, ScissorsIcon, Trash2Icon } from '@lucide/svelte'
    import { language } from 'src/lang'
    import { parseCbsConditionView, summarizeCbsCondition, type CbsConditionExpression } from 'src/ts/gui/cbsConditionView'
    import type { CbsVariableContext } from 'src/ts/gui/cbsVariableEditor'
    import { tooltip } from 'src/ts/gui/tooltip'
    import { resizeHandle } from 'src/ts/gui/resizeHandle'
    import CbsVariableList from './CbsVariableList.svelte'

    let { value, onInput, onblur, onkeydown, variableContext, variableLabels, switchVariables = [], previewSegments = [], showVariableSidebar = true, onSelectionChange, allowBlockActions = false, scrollTop = 0, onScrollTopChange }: {
        value: string
        onInput: (value: string) => void
        onblur?: () => void
        onkeydown?: (event: KeyboardEvent) => void
        variableContext?: CbsVariableContext
        variableLabels?: Record<string, string>
        switchVariables?: string[]
        previewSegments?: Array<{ text: string; state: 'neutral' | 'active' | 'inactive' }>
        showVariableSidebar?: boolean
        onSelectionChange?: (selection: { start: number; end: number }) => void
        allowBlockActions?: boolean
        scrollTop?: number
        onScrollTopChange?: (scrollTop: number) => void
    } = $props()

    let documentValue = $state('')
    let view = $state(parseCbsConditionView(''))
    const id = $props.id()
    let containerWidth = $state(0)
    let variablesPreference = $state<boolean | undefined>(undefined)
    const variablesOpen = $derived(showVariableSidebar && (variablesPreference ?? containerWidth >= 360))
    let layoutElement: HTMLElement | undefined = $state()
    let rootElement: HTMLElement | undefined = $state()
    let documentElement: HTMLElement | undefined = $state()
    let draggedRange: { from: number; to: number } | undefined
    const labels = $derived(language.cbsEditor)
    const previewRanges = $derived.by(() => {
        let from = 0
        return previewSegments.map((segment) => {
            const range = { from, to: from + segment.text.length, state: segment.state }
            from = range.to
            return range
        })
    })

    $effect.pre(() => {
        if (value !== documentValue) {
            documentValue = value
            view = parseCbsConditionView(value)
        }
    })

    type Block = { index: number; endIndex?: number; children: Block[] }
    const blocks = $derived.by(() => {
        const root: Block[] = []
        const childStack = [root]
        const conditionStack: Block[] = []
        view.parts.forEach((part, index) => {
            if (part.kind === 'end') {
                conditionStack.pop()!.endIndex = index
                if (childStack.length > 1) childStack.pop()
                return
            }
            const block: Block = { index, children: [] }
            childStack[childStack.length - 1].push(block)
            if (part.kind === 'condition') {
                conditionStack.push(block)
                childStack.push(block.children)
            }
        })
        return root
    })

    $effect(() => {
        const element = documentElement
        const position = scrollTop
        if (element && element.scrollTop !== position) element.scrollTop = position
    })

    function switchState(node: CbsConditionExpression): string | undefined {
        if (node.kind !== 'comparison' || node.operator !== '=' || node.left.kind !== 'variable'
            || !switchVariables.includes(node.left.name) || node.right.kind !== 'literal') return
        if (node.right.text === '"0"') return labels.off
        if (node.right.text === '"1"') return labels.on
    }

    function previewStateForRange(from: number, to: number): 'neutral' | 'active' | 'inactive' {
        const states = previewRanges
            .filter((range) => range.from < to && range.to > from)
            .map((range) => range.state)
        if (states.includes('inactive')) return 'inactive'
        if (states.includes('active')) return 'active'
        return 'neutral'
    }

    function edit(index: number, replacement: string) {
        const part = view.parts[index]
        const delta = replacement.length - (part.to - part.from)
        documentValue = documentValue.slice(0, part.from) + replacement + documentValue.slice(part.to)
        // Keep the active textarea (and its IME/undo state) while a macro is incomplete.
        view.parts = view.parts.map((item, i) => i < index ? item : {
            ...item, from: item.from + (i > index ? delta : 0), to: item.to + delta,
        })
        onInput(documentValue)
    }

    function blockRange(block: Block): { from: number; to: number } {
        const opening = view.parts[block.index]
        const closing = block.endIndex === undefined ? opening : view.parts[block.endIndex]
        return { from: opening.from, to: closing.to }
    }

    function replaceRange(from: number, to: number, replacement = '') {
        documentValue = documentValue.slice(0, from) + replacement + documentValue.slice(to)
        view = parseCbsConditionView(documentValue)
        onInput(documentValue)
    }

    async function cutBlock(block: Block, event: MouseEvent) {
        event.preventDefault()
        event.stopPropagation()
        const range = blockRange(block)
        const source = documentValue.slice(range.from, range.to)
        try {
            if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(source)
            else {
                const field = document.createElement('textarea')
                field.value = source
                field.style.position = 'fixed'
                field.style.opacity = '0'
                document.body.append(field)
                field.select()
                document.execCommand('copy')
                field.remove()
            }
        } catch {
            return
        }
        replaceRange(range.from, range.to)
    }

    function deleteBlock(block: Block, event: MouseEvent) {
        event.preventDefault()
        event.stopPropagation()
        const range = blockRange(block)
        replaceRange(range.from, range.to)
    }

    function startBlockDrag(block: Block, event: DragEvent) {
        if (!allowBlockActions) return
        event.stopPropagation()
        draggedRange = blockRange(block)
        event.dataTransfer?.setData('text/plain', documentValue.slice(draggedRange.from, draggedRange.to))
        if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
    }

    function dropBlock(block: Block, event: DragEvent) {
        if (!draggedRange) return
        event.preventDefault()
        event.stopPropagation()
        const source = draggedRange
        const target = blockRange(block)
        draggedRange = undefined
        if (target.from >= source.from && target.to <= source.to) return

        const rect = event.currentTarget instanceof HTMLElement
            ? event.currentTarget.getBoundingClientRect()
            : { top: 0, height: 0 }
        const insertAt = event.clientY < rect.top + rect.height / 2 ? target.from : target.to
        const moving = documentValue.slice(source.from, source.to)
        const without = documentValue.slice(0, source.from) + documentValue.slice(source.to)
        const adjustedInsert = insertAt > source.to ? insertAt - (source.to - source.from) : insertAt
        documentValue = without.slice(0, adjustedInsert) + moving + without.slice(adjustedInsert)
        view = parseCbsConditionView(documentValue)
        onInput(documentValue)
    }

    function finishEdit() {
        view = parseCbsConditionView(documentValue)
        onblur?.()
    }

    function reportSelection(index: number, event: Event) {
        const part = view.parts[index]
        const field = event.currentTarget as HTMLTextAreaElement
        onSelectionChange?.({ start: part.from + field.selectionStart, end: part.from + field.selectionEnd })
    }

    export function focusSelection(start: number, end: number) {
        const fields = rootElement?.querySelectorAll<HTMLTextAreaElement>('[data-cbs-body-index]')
        if (!fields) return
        for (const field of fields) {
            const part = view.parts[Number(field.dataset.cbsBodyIndex)]
            if (!part || part.kind !== 'text' || start < part.from || end > part.to) continue
            let parent = field.parentElement
            while (parent && parent !== rootElement) {
                if (parent instanceof HTMLDetailsElement) parent.open = true
                parent = parent.parentElement
            }
            field.focus()
            field.setSelectionRange(start - part.from, end - part.from)
            return
        }

        const conditionParts = rootElement?.querySelectorAll<HTMLElement>('[data-cbs-condition-part]')
        if (!conditionParts) return
        for (const element of conditionParts) {
            const part = view.parts[Number(element.dataset.cbsPartIndex)]
            if (!part || part.kind !== 'condition' || start < part.from || end > part.to) continue
            let parent: HTMLElement | null = element
            while (parent && parent !== rootElement) {
                if (parent instanceof HTMLDetailsElement) parent.open = true
                parent = parent.parentElement
            }
            const heading = element.querySelector<HTMLElement>('[data-cbs-condition-heading]')
            heading?.focus({ preventScroll: true })
            element.scrollIntoView?.({ block: 'center', inline: 'nearest' })
            return
        }
    }

    function expressionHasRaw(node: CbsConditionExpression): boolean {
        if (node.kind === 'raw') return true
        if (node.kind === 'logical') return node.children.some(expressionHasRaw)
        if (node.kind === 'comparison') return expressionHasRaw(node.left) || expressionHasRaw(node.right)
        return false
    }

    function startVariableResize() {
        const layout = layoutElement
        const sidebar = layout?.querySelector<HTMLElement>('[data-cbs-variable-sidebar]')
        if (!layout || !sidebar) return
        const width = layout.getBoundingClientRect().width
        const start = sidebar.getBoundingClientRect().width
        return (dx: number) => layout.style.setProperty('--cbs-variable-width', `${Math.max(112, Math.min(width - 128, start - dx))}px`)
    }
</script>

{#snippet renderExpression(node: CbsConditionExpression, nested = false)}
    {#if node.kind === 'logical'}
        <span class="logical-group" class:nested data-cbs-logic={node.operator}>
            {#each node.children as child, index}
                {#if index > 0 || node.operator === 'NOT'}
                    {' '}<span class="logical-operator" data-cbs-operator={node.operator}>{labels.logic[node.operator]}</span>{' '}
                {/if}
                {@render renderExpression(child, true)}
            {/each}
        </span>
    {:else if node.kind === 'comparison'}
        <span class="condition-clause" data-cbs-clause>
            {@render renderExpression(node.left, true)}{' '}
            {#if switchState(node)}
                <span class="comparison-operator">·</span> <span>{switchState(node)}</span>
            {:else}
                <span class="comparison-operator">{node.operator}</span>{' '}{@render renderExpression(node.right, true)}
            {/if}
        </span>
    {:else if node.kind === 'variable'}
        <span class="expression-leaf variable-leaf" data-cbs-token={node.kind} title={node.name}>[{node.text}]</span>
    {:else}
        <span class="expression-leaf" data-cbs-token={node.kind}>{node.text}</span>
    {/if}
{/snippet}

{#snippet renderBlocks(items: Block[])}
    {#each items as block}
        {@const index = block.index}
        {@const part = view.parts[index]}
        {@const source = documentValue.slice(part.from, part.to)}
        <div
            class="part"
            data-cbs-part-index={index}
            data-cbs-condition-part={part.kind === 'condition' ? '' : undefined}
        >
            {#if part.kind === 'text'}
                {#if source.trim() || part.depth > 0 || part.from === part.to}
                    <textarea
                        data-cbs-body
                        data-cbs-preview-state={previewStateForRange(part.from, part.to)}
                        aria-label={`${labels.body} ${index + 1}`}
                        value={source}
                        rows={Math.max(1, Math.min(24, source.split('\n').length))}
                        spellcheck="false"
                        oninput={(event) => edit(index, event.currentTarget.value)}
                        onselect={(event) => reportSelection(index, event)}
                        onfocus={(event) => reportSelection(index, event)}
                        onblur={finishEdit}
                        {onkeydown}
                        data-cbs-body-index={index}
                    ></textarea>
                {:else}
                    <div class="text-gap" aria-hidden="true"></div>
                {/if}
            {:else if part.kind === 'condition'}
                {@const summary = summarizeCbsCondition(source, { variableLabels })}
                {@const warnings = [
                    ...summary.warnings.map(warning => labels.extraArguments.replace('{name}', warning.name).replace('{actual}', String(warning.actual)).replace('{expected}', String(warning.expected))),
                    ...(expressionHasRaw(summary.expression) ? [labels.unsupportedExpression] : []),
                ].join('\n')}
                <details
                    class="condition-block"
                    data-cbs-block
                    open
                    draggable={allowBlockActions}
                    ondragstart={(event) => startBlockDrag(block, event)}
                    ondragend={() => draggedRange = undefined}
                    ondragover={(event) => { if (draggedRange) event.preventDefault() }}
                    ondrop={(event) => dropBlock(block, event)}
                >
                    <summary class="block-heading" aria-label={summary.text} data-cbs-condition-heading tabindex="-1">
                        {#if allowBlockActions}<GripVerticalIcon size={14} class="block-drag-handle" />{/if}
                        <span class="condition-label">{labels.condition}</span>
                        <span class="condition-expression" data-cbs-summary>{@render renderExpression(summary.expression)}</span>
                        {#if allowBlockActions}
                            <span class="condition-actions">
                                <button type="button" data-cbs-cut-condition aria-label={labels.cutCondition} title={labels.cutCondition} onclick={(event) => cutBlock(block, event)}>
                                    <ScissorsIcon size={14} />
                                </button>
                                <button type="button" data-cbs-delete-condition aria-label={labels.deleteCondition} title={labels.deleteCondition} onclick={(event) => deleteBlock(block, event)}>
                                    <Trash2Icon size={14} />
                                </button>
                            </span>
                        {/if}
                    </summary>
                    <div class="block-body">
                        <div class="condition-tools">
                            <details class="source-details">
                                <summary title={labels.editSource}>{labels.showSource}</summary>
                                <pre class="condition-source">{source}</pre>
                            </details>
                            {#if warnings}<button type="button" class="tip-icon" data-cbs-warning aria-label={warnings} use:tooltip={warnings}>!</button>{/if}
                        </div>
                        {@render renderBlocks(block.children)}
                    </div>
                </details>
            {:else if part.kind === 'otherwise'}
                <div class="branch-label">{labels.otherwise}</div>
            {/if}
        </div>
    {/each}
{/snippet}

<div class="cbs-condition-view" data-cbs-condition-view bind:this={rootElement} bind:clientWidth={containerWidth}>
    <div class="view-tools">
        {#if !view.valid}<button type="button" class="tip-icon" aria-label={labels.fallback} use:tooltip={labels.fallback}>!</button>{/if}
        <button type="button" class="tip-icon" aria-label={labels.description} use:tooltip={labels.description}>?</button>
        {#if showVariableSidebar}<button type="button" class="variable-toggle" data-cbs-variable-toggle
            aria-controls={`${id}-variables`} aria-expanded={variablesOpen}
            aria-label={variablesOpen ? labels.hideVariables : labels.showVariables}
            use:tooltip={variablesOpen ? labels.hideVariables : labels.showVariables}
            onclick={() => { variablesPreference = !variablesOpen }}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" aria-hidden="true">
                <rect x="1.5" y="2" width="13" height="12" rx="1.5" />
                <path d="M10 2v12" />
            </svg>
            {labels.variables}
        </button>{/if}
    </div>
    <div class="view-layout" class:variables-open={variablesOpen} bind:this={layoutElement}>
    <div
        class="cbs-document"
        data-cbs-document
        bind:this={documentElement}
        onscroll={(event) => onScrollTopChange?.(event.currentTarget.scrollTop)}
    >
    {@render renderBlocks(blocks)}
    </div>
    {#if showVariableSidebar}<button type="button" class="variable-splitter" data-cbs-variable-splitter hidden={!variablesOpen}
        aria-label={labels.resizeVariables} use:tooltip={language.lorebookWorkspace.resizeHint}
        use:resizeHandle={{ start: startVariableResize, reset: () => layoutElement?.style.removeProperty('--cbs-variable-width') }}></button>
    <aside class="variable-sidebar" data-cbs-variable-sidebar id={`${id}-variables`}
        aria-label={labels.variables} hidden={!variablesOpen}>
        <CbsVariableList source={documentValue} context={variableContext} />
    </aside>{/if}
    </div>
</div>

<style>
    .cbs-condition-view { display: flex; flex-direction: column; container: cbs-editor / inline-size; height: 100%; min-height: 0; min-width: 0; overflow: hidden; color: var(--color-textcolor); background: var(--color-darkbg); font-size: .86rem; font-weight: 400; letter-spacing: normal; }
    .view-tools { display: flex; flex-shrink: 0; align-items: center; justify-content: flex-end; gap: .4rem; padding: .25rem .5rem; border-bottom: 1px solid var(--color-darkborderc); }
    .variable-toggle { display: flex; align-items: center; gap: .3rem; padding: .15rem .4rem; border: 1px solid var(--color-darkborderc); border-radius: .2rem; color: var(--color-textcolor2); background: transparent; font: inherit; font-size: .73rem; cursor: pointer; }
    .variable-toggle[aria-expanded='true'] { color: var(--color-textcolor); background: var(--color-selected); }
    .view-layout { --cbs-effective-variable-width: clamp(7rem, var(--cbs-variable-width, 17rem), calc(100% - 8rem)); position: relative; display: flex; flex: 1; min-height: 0; }
    .cbs-document { flex: 1; min-width: 0; overflow: auto; overscroll-behavior: contain; padding: .4rem .6rem; }
    .variable-sidebar { flex: 0 0 var(--cbs-effective-variable-width); min-width: 0; overflow: hidden; border-left: 1px solid var(--color-darkborderc); background: var(--color-bgcolor); container: cbs-variables / inline-size; }
    .variable-splitter { position: absolute; top: 0; bottom: 0; right: calc(var(--cbs-effective-variable-width) - .25rem); z-index: 2; width: .5rem; padding: 0; border: 0; background: transparent; cursor: col-resize; touch-action: none; }
    .variable-splitter::after { position: absolute; top: calc(50% - 1rem); height: 2rem; left: 3px; border-left: 2px solid var(--color-borderc); content: ''; }
    .variable-splitter:hover, .variable-splitter:focus-visible, .variable-splitter:global([data-resizing]) { background: color-mix(in srgb, var(--color-borderc) 45%, transparent); outline: none; }
    .part { min-width: 0; }
    .condition-block { margin: .85rem 0; border: 1px solid var(--color-borderc); border-bottom-width: 3px; border-left: 3px solid var(--color-primary); border-radius: .5rem; background: color-mix(in srgb, var(--color-primary) 5%, var(--color-darkbg)); }
    .condition-block[draggable='true'] { cursor: grab; }
    .condition-block[draggable='true']:active { cursor: grabbing; }
    .block-heading { min-height: 2.75rem; align-items: center; padding: .5rem .75rem; background: color-mix(in srgb, var(--color-primary) 12%, var(--color-darkbg)); border-radius: .35rem; }
    .condition-block[open] > .block-heading { border-bottom: 1px solid var(--color-darkborderc); border-radius: .35rem .35rem 0 0; }
    .block-heading:hover { background: color-mix(in srgb, var(--color-primary) 20%, var(--color-darkbg)); }
    .block-body { padding: .4rem .85rem .75rem 1.5rem; }
    .block-body > .part > .condition-block { margin-left: 1rem; }
    .condition-tools { display: flex; align-items: flex-start; gap: .5rem; }
    .source-details { flex: 1; min-width: 0; color: var(--color-textcolor2); font-size: .75rem; }
    summary { display: flex; align-items: flex-start; gap: .35rem; padding: .25rem .4rem; cursor: pointer; overflow-wrap: anywhere; line-height: 1.5; list-style: none; }
    summary::-webkit-details-marker { display: none; }
    summary::before { content: '▸'; flex-shrink: 0; padding-top: .15rem; color: var(--color-textcolor2); }
    details[open] > summary::before { content: '▾'; }
    summary:focus-visible { outline: 2px solid var(--color-borderc); outline-offset: 2px; }
    .condition-label { flex-shrink: 0; color: var(--color-textcolor2); font-size: .75rem; font-weight: 600; }
    .condition-source { font-family: ui-monospace, monospace; font-size: .75rem; }
    .condition-expression { display: flex; flex: 1; min-width: 0; align-items: center; }
    .block-heading :global(.block-drag-handle) { flex-shrink: 0; color: var(--color-textcolor2); opacity: .7; }
    .condition-actions { display: inline-flex; flex-shrink: 0; align-items: center; gap: .15rem; margin-left: auto; }
    .condition-actions button { display: grid; width: 1.75rem; height: 1.75rem; place-content: center; border: 1px solid transparent; border-radius: .3rem; color: var(--color-textcolor2); background: transparent; cursor: pointer; }
    .condition-actions button:hover { border-color: var(--color-darkborderc); color: var(--color-textcolor); background: var(--color-darkbutton); }
    .condition-actions button[data-cbs-delete-condition]:hover { color: var(--color-danger); }
    .condition-actions button:focus-visible, [data-cbs-condition-heading]:focus-visible { outline: 2px solid var(--color-borderc); outline-offset: 1px; }
    .logical-group { display: inline-flex; flex-wrap: wrap; align-items: center; gap: .3rem; min-width: 0; max-width: 100%; }
    .logical-group.nested { padding: .2rem .3rem; border: 1px solid color-mix(in srgb, var(--color-borderc) 65%, var(--color-darkborderc)); border-radius: .4rem; background: color-mix(in srgb, var(--color-selected) 18%, var(--color-darkbg)); }
    .condition-clause, .expression-leaf { min-width: 0; max-width: 100%; padding: .15rem .4rem; border: 1px solid color-mix(in srgb, var(--color-primary) 30%, var(--color-darkborderc)); border-radius: .3rem; background: color-mix(in srgb, var(--color-primary) 10%, var(--color-darkbg)); overflow-wrap: anywhere; }
    .condition-clause { display: inline-flex; flex-wrap: wrap; align-items: baseline; column-gap: .3rem; }
    .condition-clause > .expression-leaf { padding: 0; border: 0; border-radius: 0; background: transparent; }
    [data-cbs-token='variable'] { color: var(--color-textcolor); font-weight: 600; }
    .variable-leaf { border-color: color-mix(in srgb, var(--color-primary) 45%, var(--color-darkborderc)); background: color-mix(in srgb, var(--color-primary) 16%, var(--color-darkbg)); }
    [data-cbs-token='literal'] { color: color-mix(in srgb, var(--color-textcolor) 85%, var(--color-primary)); }
    [data-cbs-token='raw'], .comparison-operator { color: var(--color-textcolor2); }
    .logical-operator { flex-shrink: 0; padding: .1rem .25rem; color: var(--color-textcolor); font: inherit; font-size: .75rem; font-weight: 600; }
    .condition-source { margin: 0; padding: .4rem .5rem; border-top: 1px solid var(--color-darkborderc); white-space: pre-wrap; overflow-wrap: anywhere; user-select: text; }
    textarea { display: block; width: 100%; min-height: 1.75rem; field-sizing: content; padding: .2rem .5rem; border: 1px solid transparent;  border-radius: .15rem; background: transparent; color: var(--color-textcolor); font-family: inherit; font-size: .87rem; font-weight: 400; line-height: 1.65; resize: none; }
    textarea[data-cbs-preview-state='active'] { color: color-mix(in srgb, var(--color-info) 86%, var(--color-textcolor)); }
    textarea[data-cbs-preview-state='inactive']:not(:focus) { color: color-mix(in srgb, var(--color-textcolor2) 42%, var(--color-bgcolor)); opacity: .72; }
    textarea:hover { border-color: var(--color-darkborderc); }
    textarea:focus { border-color: var(--color-borderc); outline: 1px solid var(--color-borderc); background: var(--color-bgcolor); }
    .text-gap { height: .12rem; }
    .branch-label { margin: .75rem -.75rem .5rem; padding: .5rem .75rem; border-block: 1px solid var(--color-borderc); background: color-mix(in srgb, var(--color-selected) 35%, var(--color-darkbg)); color: var(--color-textcolor); font-size: .8rem; font-weight: 600; }
    .tip-icon { display: grid; width: 1.35rem; height: 1.35rem; flex-shrink: 0; place-content: center; padding: 0; border: 1px solid var(--color-darkborderc); border-radius: 50%; background: transparent; color: var(--color-textcolor2); font-size: .7rem; cursor: help; }
    .tip-icon:focus-visible, .variable-toggle:focus-visible { outline: 1px solid var(--color-borderc); outline-offset: 1px; }
    @container cbs-editor (max-width: 359px) {
        .variables-open .cbs-document { display: none; }
        .variable-sidebar { flex: 1; border-left: 0; }
        .variable-splitter { display: none; }
    }
</style>
