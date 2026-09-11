import { parseToggleSyntax, type sidebarToggle } from './util'
import type { PromptItem } from './process/prompt'
import { risuChatParser } from './parser/parser.svelte'

export type PromptV2Join = 'and' | 'or'
export type PromptV2Operator = 'is' | 'isnot' | 'greater' | 'greaterequal' | 'less' | 'lessequal'

export interface PromptV2Condition {
    key: string
    operator: PromptV2Operator
    value: string
}

export interface PromptV2Activation {
    join: PromptV2Join
    conditions: PromptV2Condition[]
}

export interface ParsedPromptV2Text {
    body: string
    activation: PromptV2Activation | null
    format: 'none' | 'v2' | 'legacy' | 'manual'
    editable: boolean
}

export type PromptV2ToggleType = 'switch' | 'select' | 'text' | 'textarea'

export interface PromptV2ToggleDefinition {
    key: string
    rawKey: string
    label: string
    type: PromptV2ToggleType
    options: string[]
    group?: string
}

export type PromptV2ToggleTreeItem =
    | { type: 'group'; label: string; children: PromptV2ToggleTreeItem[] }
    | { type: 'caption' | 'divider'; label: string }
    | { type: 'toggle'; definition: PromptV2ToggleDefinition }

export interface PromptV2ToggleTree {
    items: PromptV2ToggleTreeItem[]
    definitions: PromptV2ToggleDefinition[]
}

const v2Wrapper = /^\{\{#when::keep::(.+)\}\}\r?\n([\s\S]*)\r?\n\{\{\/when\}\}$/

function isSafeCBSArgument(value: string): boolean {
    return value.length > 0 && !/[{}\r\n]/.test(value) && !value.includes('::')
}

function compileComparison(condition: PromptV2Condition): string {
    if (!isSafeCBSArgument(condition.key) || !isSafeCBSArgument(condition.value)) {
        throw new Error('Prompt V2 condition keys and values cannot contain braces, line breaks, or double colons.')
    }
    const fn: Record<PromptV2Operator, string> = {
        is: 'equal',
        isnot: 'notequal',
        greater: 'greater',
        greaterequal: 'greater_equal',
        less: 'less',
        lessequal: 'less_equal',
    }
    return `{{${fn[condition.operator]}::{{getglobalvar::${condition.key}}}::${condition.value}}}`
}

export function compilePromptV2Text(body: string, activation: PromptV2Activation | null): string {
    if (!activation || activation.conditions.length === 0) return body
    const expression = activation.conditions.map(compileComparison).join(`::${activation.join}::`)
    return `{{#when::keep::${expression}}}\n${body}\n{{/when}}`
}

export interface PromptV2BodyInsertion {
    body: string
    selectionStart: number
    selectionEnd: number
}

export function insertPromptV2BodyCondition(
    source: string,
    selectionStart: number,
    selectionEnd: number,
    activation: PromptV2Activation,
): PromptV2BodyInsertion {
    const start = Math.max(0, Math.min(source.length, Math.min(selectionStart, selectionEnd)))
    const end = Math.max(start, Math.min(source.length, Math.max(selectionStart, selectionEnd)))
    if (activation.conditions.length === 0) return { body: source, selectionStart: start, selectionEnd: end }
    const selected = source.slice(start, end)
    const comparisons = activation.conditions.map(compileComparison)
    const expression = comparisons.slice(1).reduce(
        (left, right) => `{{${activation.join}::${left}::${right}}}`,
        comparisons[0],
    )
    const opening = `{{#if ${expression}}}`
    const wrapped = `${opening}\n${selected}\n{{/if}}`
    const bodyOffset = opening.length + 1
    return {
        body: source.slice(0, start) + wrapped + source.slice(end),
        selectionStart: start + bodyOffset,
        selectionEnd: start + bodyOffset + selected.length,
    }
}

function parseV2Expression(expression: string): PromptV2Activation | null {
    const conditions: PromptV2Condition[] = []
    const joins: PromptV2Join[] = []
    const comparison = /\{\{(equal|notequal|greater|greater_equal|less|less_equal)::\{\{getglobalvar::([^{}\r\n]+)\}\}::([^{}\r\n]+)\}\}/y
    let cursor = 0

    while (cursor < expression.length) {
        comparison.lastIndex = cursor
        const match = comparison.exec(expression)
        if (!match) return null
        conditions.push({
            key: match[2],
            operator: ({
                equal: 'is', notequal: 'isnot', greater: 'greater', greater_equal: 'greaterequal',
                less: 'less', less_equal: 'lessequal',
            } as Record<string, PromptV2Operator>)[match[1]],
            value: match[3],
        })
        cursor = comparison.lastIndex
        if (cursor === expression.length) break

        const separator = expression.slice(cursor).match(/^::(and|or)::/)
        if (!separator) return null
        joins.push(separator[1] as PromptV2Join)
        cursor += separator[0].length
    }

    if (conditions.length === 0) return null
    if (joins.some((join) => join !== joins[0])) return null
    return { join: joins[0] ?? 'and', conditions }
}

export function parsePromptV2Text(source: string): ParsedPromptV2Text {
    const v2 = source.match(v2Wrapper)
    if (v2) {
        const activation = parseV2Expression(v2[1])
        if (activation) {
            return { body: v2[2], activation, format: 'v2', editable: true }
        }
    }

    return { body: source, activation: null, format: 'none', editable: true }
}

export function evaluatePromptV2Activation(
    activation: PromptV2Activation | null,
    values: Record<string, string>,
): boolean {
    if (!activation || activation.conditions.length === 0) return true
    const results = activation.conditions.map((condition) => {
        const actual = values[condition.key] ?? ''
        if (condition.operator === 'is') return actual === condition.value
        if (condition.operator === 'isnot') return actual !== condition.value
        const left = Number(actual)
        const right = Number(condition.value)
        if (!Number.isFinite(left) || !Number.isFinite(right)) return false
        if (condition.operator === 'greater') return left > right
        if (condition.operator === 'greaterequal') return left >= right
        if (condition.operator === 'less') return left < right
        return left <= right
    })
    return activation.join === 'or' ? results.some(Boolean) : results.every(Boolean)
}

export type PromptV2BodyPreviewState = 'neutral' | 'active' | 'inactive'

export interface PromptV2BodyPreviewSegment {
    text: string
    state: PromptV2BodyPreviewState
}

function promptV2TokenEnd(source: string, from: number): number {
    let depth = 0
    for (let index = from; index < source.length - 1; index++) {
        if (source.startsWith('{{', index)) {
            depth++
            index++
        } else if (source.startsWith('}}', index)) {
            index++
            if (--depth === 0) return index + 1
        }
    }
    return -1
}

function evaluatePromptV2BodyCondition(
    opening: string,
    kind: 'if' | 'when',
    values: Record<string, string>,
): boolean | null {
    const scoped = opening.replace(
        /\{\{getglobalvar::([^{}\r\n]+)\}\}/gi,
        (_, key: string) => values[key] ?? '',
    )
    const marker = 'RISUBARD_PROMPT_V2_VISIBLE_7F3A'
    try {
        const rendered = risuChatParser(
            `${scoped}${marker}{{/${kind}}}`,
            { globalChatVariables: values, rmVar: true, runVar: false },
        )
        return rendered.includes(marker)
    } catch {
        return null
    }
}

export function createPromptV2BodyPreviewSegments(
    source: string,
    values: Record<string, string>,
    blockState: boolean | null = null,
): PromptV2BodyPreviewSegment[] {
    type Frame = {
        kind: 'if' | 'when' | 'opaque'
        condition: boolean | null
        parent: boolean | null
        effective: boolean | null
    }
    const segments: PromptV2BodyPreviewSegment[] = []
    const frames: Frame[] = []
    let scan = 0
    let boundary = 0

    const current = () => frames.at(-1)?.effective ?? blockState
    const stateName = (state: boolean | null): PromptV2BodyPreviewState => (
        state === null ? 'neutral' : state ? 'active' : 'inactive'
    )
    const append = (text: string, state = current()) => {
        if (!text) return
        const named = stateName(state)
        const previous = segments.at(-1)
        if (previous?.state === named) previous.text += text
        else segments.push({ text, state: named })
    }
    const combine = (parent: boolean | null, condition: boolean | null) => {
        if (parent === false || condition === false) return false
        if (condition === true) return true
        return parent
    }
    const fallback = () => [{ text: source, state: stateName(blockState) }]

    while (scan < source.length) {
        const from = source.indexOf('{{', scan)
        if (from < 0) break
        const to = promptV2TokenEnd(source, from)
        if (to < 0) return fallback()
        scan = to
        const token = source.slice(from + 2, to - 2)
        const opening = token.match(/^#(if_pure|if|when)(?= |::|$)/)

        if (opening) {
            append(source.slice(boundary, from))
            const kind = opening[1] === 'when' ? 'when' : 'if'
            const parent = current()
            const condition = evaluatePromptV2BodyCondition(source.slice(from, to), kind, values)
            const effective = combine(parent, condition)
            frames.push({ kind, condition, parent, effective })
            append(source.slice(from, to), effective)
            boundary = to
            continue
        }

        const opaqueOpening = token.match(/^#(pure|pure_display|puredisplay|code|escape|each|func)(?= |::|$)/)
        if (opaqueOpening) {
            append(source.slice(boundary, from))
            const inherited = current()
            frames.push({ kind: 'opaque', condition: null, parent: inherited, effective: inherited })
            append(source.slice(from, to), inherited)
            boundary = to
            continue
        }

        if (token === ':else') {
            const frame = frames.at(-1)
            if (!frame) return fallback()
            if (frame.kind === 'opaque') continue
            if (frame.kind !== 'when') return fallback()
            append(source.slice(boundary, from))
            frame.effective = combine(frame.parent, frame.condition === null ? null : !frame.condition)
            append(source.slice(from, to), frame.effective)
            boundary = to
            continue
        }

        if (token.startsWith('/') && !token.startsWith('//')) {
            const frame = frames.at(-1)
            if (!frame) return fallback()
            append(source.slice(boundary, from))
            append(source.slice(from, to), frame.effective)
            frames.pop()
            boundary = to
            continue
        }
    }

    if (frames.length > 0) return fallback()
    append(source.slice(boundary))
    return segments.length > 0 ? segments : fallback()
}

function toggleType(toggle: sidebarToggle): PromptV2ToggleType {
    if (toggle.type === 'select' || toggle.type === 'text' || toggle.type === 'textarea') return toggle.type
    return 'switch'
}

export function parsePromptV2ToggleTree(template: string): PromptV2ToggleTree {
    const parsed = parseToggleSyntax(template)
    const root: PromptV2ToggleTreeItem[] = []
    const definitions: PromptV2ToggleDefinition[] = []
    const stack: Array<{ label: string; children: PromptV2ToggleTreeItem[] }> = []
    const target = () => stack.at(-1)?.children ?? root

    for (const toggle of parsed) {
        if (toggle.type === 'group') {
            const group = { type: 'group' as const, label: toggle.value ?? '', children: [] as PromptV2ToggleTreeItem[] }
            target().push(group)
            stack.push(group)
            continue
        }
        if (toggle.type === 'groupEnd') {
            stack.pop()
            continue
        }
        if (toggle.type === 'caption' || toggle.type === 'divider') {
            target().push({ type: toggle.type, label: toggle.value ?? '' })
            continue
        }
        if (!toggle.key || !toggle.value) continue

        const definition: PromptV2ToggleDefinition = {
            key: `toggle_${toggle.key}`,
            rawKey: toggle.key,
            label: toggle.value,
            type: toggleType(toggle),
            options: toggle.options ?? [],
            group: stack.at(-1)?.label || undefined,
        }
        definitions.push(definition)
        target().push({ type: 'toggle', definition })
    }

    return { items: root, definitions }
}

export function createPromptV2PreviewValues(
    definitions: PromptV2ToggleDefinition[],
    source: Record<string, string> = {},
): Record<string, string> {
    return Object.fromEntries(definitions.map((definition) => [
        definition.key,
        source[definition.key] ?? promptV2PreviewDefaultValue(definition),
    ]))
}

export function promptV2PreviewDefaultValue(definition: PromptV2ToggleDefinition): string {
    return definition.type === 'text' || definition.type === 'textarea' ? '' : '0'
}

export interface PromptV2PreviewStorage {
    getItem(key: string): string | null
    setItem(key: string, value: string): unknown
    removeItem(key: string): unknown
}

export type PromptV2EditorMode = 'source' | 'visual'
const editorModeStorageKey = 'risubard:prompt-v2-editor-mode:v1'

export interface PromptV2WorkspaceSession {
    mode: 'prompts' | 'toggles'
    selectedIndex: number
    blockScrollTops: Record<number, number>
    toggleScrollTop: number
}

const promptV2WorkspaceSessions = new Map<string, PromptV2WorkspaceSession>()

export function loadPromptV2WorkspaceSession(presetId: string): PromptV2WorkspaceSession {
    const saved = promptV2WorkspaceSessions.get(presetId)
    if (!saved) return { mode: 'prompts', selectedIndex: 0, blockScrollTops: {}, toggleScrollTop: 0 }
    return { ...saved, blockScrollTops: { ...saved.blockScrollTops } }
}

export function savePromptV2WorkspaceSession(presetId: string, session: PromptV2WorkspaceSession): void {
    if (!presetId) return
    promptV2WorkspaceSessions.set(presetId, {
        ...session,
        blockScrollTops: { ...session.blockScrollTops },
    })
}

export function loadPromptV2EditorMode(storage?: PromptV2PreviewStorage): PromptV2EditorMode {
    if (!storage) {
        try { storage = typeof localStorage === 'undefined' ? undefined : localStorage } catch {}
    }
    try {
        const value = storage?.getItem(editorModeStorageKey)
        return value === 'visual' ? 'visual' : 'source'
    } catch {
        return 'source'
    }
}

export function savePromptV2EditorMode(mode: PromptV2EditorMode, storage?: PromptV2PreviewStorage): void {
    if (!storage) {
        try { storage = typeof localStorage === 'undefined' ? undefined : localStorage } catch {}
    }
    try { storage?.setItem(editorModeStorageKey, mode) } catch {}
}

const previewStorageKey = (presetId: string) => `risubard:prompt-v2-preview:${encodeURIComponent(presetId)}`

export function loadPromptV2PreviewState(
    presetId: string,
    definitions: PromptV2ToggleDefinition[],
    defaults: Record<string, string>,
    storage?: PromptV2PreviewStorage,
): Record<string, string> {
    const fallback = createPromptV2PreviewValues(definitions, defaults)
    if (!presetId || !storage) return fallback
    try {
        const raw = storage.getItem(previewStorageKey(presetId))
        if (!raw) return fallback
        const saved = JSON.parse(raw) as unknown
        if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return fallback
        for (const definition of definitions) {
            const value = (saved as Record<string, unknown>)[definition.key]
            if (typeof value === 'string') fallback[definition.key] = value
        }
    } catch {
        return fallback
    }
    return fallback
}

export function savePromptV2PreviewState(
    presetId: string,
    definitions: PromptV2ToggleDefinition[],
    values: Record<string, string>,
    storage?: PromptV2PreviewStorage,
): void {
    if (!presetId || !storage) return
    const portable = Object.fromEntries(definitions.map((definition) => [
        definition.key,
        values[definition.key] ?? promptV2PreviewDefaultValue(definition),
    ]))
    try {
        storage.setItem(previewStorageKey(presetId), JSON.stringify(portable))
    } catch {
        // Preview persistence is best-effort and must never block prompt editing.
    }
}

export function clearPromptV2PreviewState(
    presetId: string,
    storage?: PromptV2PreviewStorage,
): void {
    if (!presetId || !storage) return
    try {
        storage.removeItem(previewStorageKey(presetId))
    } catch {
        // Storage-disabled environments still support an in-memory preview reset.
    }
}

export type PromptV2TextField = 'text' | 'innerFormat'

export interface PromptV2TextSource {
    field: PromptV2TextField
    source: string
}

export function getPromptV2TextSource(item: PromptItem): PromptV2TextSource | null {
    if (item.type === 'plain' || item.type === 'jailbreak' || item.type === 'cot' || item.type === 'chatML') {
        return { field: 'text', source: item.text ?? '' }
    }
    if (
        item.type === 'persona' || item.type === 'description' || item.type === 'lorebook'
        || item.type === 'postEverything' || item.type === 'memory' || item.type === 'authornote'
    ) {
        return { field: 'innerFormat', source: item.innerFormat ?? '{{slot}}' }
    }
    return null
}

export function setPromptV2TextSource(item: PromptItem, source: string): void {
    if (item.type === 'plain' || item.type === 'jailbreak' || item.type === 'cot' || item.type === 'chatML') {
        item.text = source
        return
    }
    if (
        item.type === 'persona' || item.type === 'description' || item.type === 'lorebook'
        || item.type === 'postEverything' || item.type === 'memory' || item.type === 'authornote'
    ) {
        item.innerFormat = source
    }
}

export interface PromptV2ToggleUsage {
    blockIndex: number
    blockName: string
    line: number
    start: number
    end: number
    preview: string
}

export function findPromptV2ToggleUsages(
    items: PromptItem[],
    key: string,
): PromptV2ToggleUsage[] {
    if (!key) return []
    const markerPrefix = '{{getglobalvar::'
    const marker = `${markerPrefix}${key}}}`
    const usages: PromptV2ToggleUsage[] = []

    items.forEach((item, blockIndex) => {
        const textSource = getPromptV2TextSource(item)
        if (!textSource) return
        const body = parsePromptV2Text(textSource.source).body
        let markerStart = body.indexOf(marker)
        while (markerStart >= 0) {
            const start = markerStart + markerPrefix.length
            const end = start + key.length
            const contextLength = Math.max(0, 50 - key.length)
            const previewStart = Math.max(0, start - Math.floor(contextLength / 2))
            const previewEnd = Math.min(body.length, end + Math.ceil(contextLength / 2))
            usages.push({
                blockIndex,
                blockName: item.name?.trim() || String(blockIndex + 1),
                line: body.slice(0, start).split(/\r\n|\r|\n/).length,
                start,
                end,
                preview: `${previewStart > 0 ? '…' : ''}${body.slice(previewStart, previewEnd).replace(/\s+/g, ' ')}${previewEnd < body.length ? '…' : ''}`,
            })
            markerStart = body.indexOf(marker, markerStart + marker.length)
        }
    })

    return usages
}

function promptV2BodySearchExpression(search: string): RegExp | null {
    const query = search.trim()
    if (!query) return null
    return new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')
}

export function countPromptV2BodyMatches(item: PromptItem, search: string): number {
    const source = getPromptV2TextSource(item)
    const expression = promptV2BodySearchExpression(search)
    if (!source || !expression) return 0
    return Array.from(parsePromptV2Text(source.source).body.matchAll(expression)).length
}

export function replacePromptV2BodyMatches(
    items: PromptItem[],
    search: string,
    replacement: string,
    selectedIndex?: number,
): { items: PromptItem[]; replaced: number } {
    const expression = promptV2BodySearchExpression(search)
    if (!expression) return { items, replaced: 0 }

    const targetIndexes = selectedIndex === undefined
        ? items.map((_, index) => index)
        : [selectedIndex]
    let next = items
    let replaced = 0

    for (const index of targetIndexes) {
        const item = items[index]
        const source = item && getPromptV2TextSource(item)
        if (!source) continue
        const parsed = parsePromptV2Text(source.source)
        const matches = Array.from(parsed.body.matchAll(expression))
        const replacing = selectedIndex === undefined ? matches : matches.slice(0, 1)
        if (replacing.length === 0) continue

        const match = replacing[0]
        const changedBody = selectedIndex === undefined
            ? parsed.body.replace(expression, () => replacement)
            : parsed.body.slice(0, match.index)
                + replacement
                + parsed.body.slice((match.index ?? 0) + match[0].length)
        const changed = { ...item } as PromptItem
        setPromptV2TextSource(changed, compilePromptV2Text(changedBody, parsed.activation))
        if (next === items) next = [...items]
        next[index] = changed
        replaced += replacing.length
    }

    return { items: next, replaced }
}
