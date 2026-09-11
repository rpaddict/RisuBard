export interface CbsConditionWarning { name: string; expected: number; actual: number }
export interface CbsVariableReference { name: string; values: string[]; reads: number; writes: number }
export function collectCbsVariables(source: string): CbsVariableReference[] {
    const found = new Map<string, CbsVariableReference>()
    const staticName = (name?: string) => !!name && !/[{}\r\n]/.test(name)
    const entry = (name: string) => {
        if (!found.has(name)) found.set(name, { name, values: [], reads: 0, writes: 0 })
        return found.get(name)!
    }
    const candidate = (name: string, value?: string) => {
        if (value === undefined || value.includes('{{')) return
        const values = entry(name).values
        if (!values.includes(value)) values.push(value)
    }
    const directVariable = (value: string) => {
        if (!value?.startsWith('{{') || tokenEnd(value, 0) !== value.length) return undefined
        const [name, key] = splitArguments(value.slice(2, -2))
        return name === 'getvar' && staticName(key) ? key : undefined
    }
    function walk(text: string, depth = 0) {
        if (depth > 32) return
        let cursor = 0
        while (cursor < text.length) {
            const from = text.indexOf('{{', cursor)
            if (from < 0) return
            const to = tokenEnd(text, from)
            if (to < 0) return
            cursor = to
            const inner = text.slice(from + 2, to - 2)
            if (inner.startsWith('//')) continue
            if (/^#(?:pure|puredisplay|pure_display|escape)$/.test(inner)) {
                const close = '{{/' + inner.slice(1) + '}}'
                const end = text.indexOf(close, cursor)
                if (end < 0) return
                cursor = end + close.length
                continue
            }
            const [name, ...args] = splitArguments(inner)
            if (['getvar', 'setvar', 'addvar', 'setdefaultvar'].includes(name) && staticName(args[0])) {
                const variable = entry(args[0])
                if (name === 'getvar') variable.reads++
                else variable.writes++
                if (name === 'setvar' || name === 'setdefaultvar') candidate(args[0], args[1])
            }
            // Include even ignored OR arguments as observed literals, never as declarations or enum constraints.
            if (['equal', 'notequal', 'not_equal', 'greater', 'less', 'greaterequal', 'greater_equal', 'lessequal', 'less_equal'].includes(name)) {
                const left = directVariable(args[0])
                const right = directVariable(args[1])
                if (left) candidate(left, args[1])
                if (right) candidate(right, args[0])
            }
            walk(inner, depth + 1)
        }
    }
    walk(source)
    return [...found.values()]
}
export interface CbsConditionPart {
    kind: 'text' | 'condition' | 'otherwise' | 'end'
    from: number
    to: number
    depth: number
}

// Read structure only. Never call the runtime parser: macros can change chat state.
function tokenEnd(source: string, from: number): number {
    let depth = 0
    for (let i = from; i < source.length - 1; i++) {
        if (source.startsWith('{{', i)) { depth++; i++ }
        else if (source.startsWith('}}', i)) {
            i++
            if (--depth === 0) return i + 1
        }
    }
    return -1
}

function splitArguments(source: string): string[] {
    const parts: string[] = []
    let start = 0
    for (let i = 0; i < source.length - 1; i++) {
        if (source.startsWith('{{', i)) {
            const end = tokenEnd(source, i)
            if (end < 0) return [source]
            i = end - 1
        } else if (source.startsWith('::', i)) {
            parts.push(source.slice(start, i))
            start = i + 2
            i++
        }
    }
    return [...parts, source.slice(start)]
}

export type CbsConditionExpression =
    | { kind: 'literal' | 'raw'; text: string }
    | { kind: 'variable'; text: string; name: string }
    | { kind: 'comparison'; text: string; operator: string; left: CbsConditionExpression; right: CbsConditionExpression }
    | { kind: 'logical'; text: string; operator: 'OR' | 'AND' | 'NOT'; children: CbsConditionExpression[] }

export interface CbsConditionSummaryOptions {
    variableLabels?: Record<string, string>
}

function splitLegacyLogical(source: string): { parts: string[]; operator: 'OR' | 'AND' } | null {
    const operators = [{ source: '||', name: 'OR' as const }, { source: '&&', name: 'AND' as const }]
    for (const operator of operators) {
        const parts: string[] = []
        let start = 0
        let depth = 0
        for (let index = 0; index < source.length - 1; index++) {
            if (source.startsWith('{{', index)) { depth++; index++; continue }
            if (source.startsWith('}}', index)) { depth--; index++; continue }
            if (depth === 0 && source.startsWith(operator.source, index)) {
                parts.push(source.slice(start, index).trim())
                start = index + operator.source.length
                index++
            }
        }
        if (parts.length) return { parts: [...parts, source.slice(start).trim()], operator: operator.name }
    }
    return null
}

function splitLegacyComparison(source: string): { left: string; right: string; operator: string } | null {
    const operators = ['>=', '<=', '!=', '==', '>', '<', '=']
    let depth = 0
    for (let index = 0; index < source.length; index++) {
        if (source.startsWith('{{', index)) { depth++; index++; continue }
        if (source.startsWith('}}', index)) { depth--; index++; continue }
        if (depth !== 0) continue
        const operator = operators.find(candidate => source.startsWith(candidate, index))
        if (!operator) continue
        return {
            left: source.slice(0, index).trim(),
            right: source.slice(index + operator.length).trim(),
            operator: operator === '==' ? '=' : operator === '!=' ? '≠' : operator,
        }
    }
    return null
}

export function summarizeCbsCondition(
    source: string,
    options: CbsConditionSummaryOptions = {},
): { text: string; expression: CbsConditionExpression; warnings: CbsConditionWarning[] } {
    const warnings: CbsConditionWarning[] = []
    const comparisons: Record<string, string> = {
        equal: '=', notequal: '≠', not_equal: '≠', greater: '>', less: '<',
        greaterequal: '≥', greater_equal: '≥', lessequal: '≤', less_equal: '≤',
    }
    const raw = (text: string): CbsConditionExpression => ({ kind: 'raw', text })
    function expression(value: string, depth = 0): CbsConditionExpression {
        if (depth > 32) return raw(value)
        if (value.startsWith('{{? ') && tokenEnd(value, 0) === value.length) {
            let legacy = value.slice(4, -2).trim()
            const withoutBooleanSuffix = legacy.replace(/=\s*1$/, '').trim()
            const suffixLogical = withoutBooleanSuffix !== legacy ? splitLegacyLogical(withoutBooleanSuffix) : null
            if (suffixLogical?.parts.every(part => part.startsWith('{{? ') && tokenEnd(part, 0) === part.length)) {
                legacy = withoutBooleanSuffix
            }
            const logical = splitLegacyLogical(legacy)
            if (logical) {
                const children = logical.parts.map(part => expression(part, depth + 1))
                return {
                    kind: 'logical', operator: logical.operator, children,
                    text: children.map(child => `(${child.text})`).join(` ${logical.operator} `),
                }
            }
            const comparison = splitLegacyComparison(legacy)
            if (comparison) {
                const left = expression(comparison.left, depth + 1)
                const right = expression(comparison.right, depth + 1)
                return { kind: 'comparison', ...comparison, left, right, text: `${left.text} ${comparison.operator} ${right.text}` }
            }
            return raw(value)
        }
        if (!value.startsWith('{{') || tokenEnd(value, 0) !== value.length) {
            return value.includes('{{') ? raw(value) : { kind: 'literal', text: JSON.stringify(value) }
        }
        const [name, ...args] = splitArguments(value.slice(2, -2))
        const arity = name === 'not' || name === 'getvar' || name === 'getglobalvar' ? 1
            : name === 'or' || name === 'and' || comparisons[name] ? 2 : 0
        if (!arity || args.length < arity) return raw(value)
        if (args.length > arity) warnings.push({ name, expected: arity, actual: args.length })
        const render = (arg: string) => expression(arg, depth + 1)
        if (name === 'getvar' || name === 'getglobalvar') {
            if (!/^[\w.-]+$/.test(args[0])) return raw(value)
            return { kind: 'variable', name: args[0], text: options.variableLabels?.[args[0]] ?? `$${args[0]}` }
        }
        const left = render(args[0])
        if (name === 'not') return { kind: 'logical', operator: 'NOT', children: [left], text: `NOT (${left.text})` }
        const right = render(args[1])
        if (name === 'or' || name === 'and') {
            const operator = name === 'or' ? 'OR' : 'AND'
            return { kind: 'logical', operator, children: [left, right], text: `(${left.text}) ${operator} (${right.text})` }
        }
        return { kind: 'comparison', operator: comparisons[name], left, right, text: `${left.text} ${comparisons[name]} ${right.text}` }
    }
    const inner = source.slice(2, -2)
    const condition = inner.match(/^#(?:if|if_pure|when) (.+)$/s)
    let tree = condition ? expression(condition[1]) : raw(inner)
    const when = splitArguments(inner)
    const toggleArgs = when.slice(1)
    if (toggleArgs[0] === 'keep') toggleArgs.shift()
    if (when[0] === '#when' && toggleArgs.length === 3
        && ['tis', 'tisnot'].includes(toggleArgs[1]) && /^[\w.-]+$/.test(toggleArgs[0])
        && !toggleArgs[2].includes('{{')) {
        const left = expression(`{{getglobalvar::toggle_${toggleArgs[0]}}}`)
        const right = expression(toggleArgs[2])
        const operator = toggleArgs[1] === 'tis' ? '=' : '≠'
        tree = { kind: 'comparison', left, right, operator, text: `${left.text} ${operator} ${right.text}` }
    }
    if (
        when[0] === '#when' && when[1] === 'keep' && when.length >= 3 && when.length % 2 === 1
        && when.filter((_, index) => index > 2 && index % 2 === 1).every(join => join === 'and' || join === 'or')
    ) {
        const children: CbsConditionExpression[] = []
        const joins: Array<'OR' | 'AND'> = []
        for (let index = 2; index < when.length; index += 2) {
            children.push(expression(when[index]))
            if (index + 1 < when.length) joins.push(when[index + 1] === 'or' ? 'OR' : 'AND')
        }
        if (joins.every(join => join === joins[0])) {
            tree = children.length === 1 ? children[0] : {
                kind: 'logical', operator: joins[0] ?? 'AND', children,
                text: children.map(child => `(${child.text})`).join(` ${joins[0] ?? 'AND'} `),
            }
        }
    }
    return { text: tree.text, expression: tree, warnings }
}

export function parseCbsConditionView(source: string): { valid: boolean; parts: CbsConditionPart[] } {
    const parts: CbsConditionPart[] = []
    const frames: Array<{ name: string; visible: boolean; hasElse: boolean }> = []
    const fallback = () => ({ valid: false, parts: [{ kind: 'text' as const, from: 0, to: source.length, depth: 0 }] })
    let cursor = 0
    let boundary = 0
    let depth = 0
    const textUntil = (to: number) => {
        const previous = parts.at(-1)?.kind
        if (to > boundary || previous === 'condition' || previous === 'otherwise') {
            parts.push({ kind: 'text', from: boundary, to, depth })
        }
    }
    while (cursor < source.length) {
        const from = source.indexOf('{{', cursor)
        if (from < 0) break
        const to = tokenEnd(source, from)
        if (to < 0) return fallback()
        cursor = to
        const token = source.slice(from + 2, to - 2)
        const opening = token.match(/^#([\w-]+)(?= |::|$)/)
        if (opening) {
            const name = opening[1]
            const conditional = ['if', 'if_pure', 'when'].includes(name)
            const opaque = ['pure', 'puredisplay', 'pure_display', 'code', 'escape', 'each'].includes(name)
                || (name === 'func' && token.startsWith('#func '))
            if (!conditional && !opaque) continue
            if (frames.length >= 128) return fallback()
            const visible = conditional && frames.every(frame => frame.visible)
            frames.push({ name, visible, hasElse: false })
            if (visible) {
                textUntil(from)
                parts.push({ kind: 'condition', from, to, depth })
                depth++
                boundary = to
            }
        } else if (token === '/' || /^\/[\w-]+$/.test(token)) {
            const frame = frames.pop()
            if (!frame) return fallback()
            if (frame.visible) {
                textUntil(from)
                depth--
                parts.push({ kind: 'end', from, to, depth })
                boundary = to
            }
        } else if (token === ':else' && frames.at(-1)?.visible) {
            const frame = frames.at(-1)!
            if (frame.name !== 'when' || frame.hasElse) return fallback()
            frame.hasElse = true
            textUntil(from)
            parts.push({ kind: 'otherwise', from, to, depth: depth - 1 })
            boundary = to
        }
    }
    if (frames.length) return fallback()
    textUntil(source.length)
    if (!parts.length) parts.push({ kind: 'text', from: 0, to: source.length, depth: 0 })
    return { valid: true, parts }
}
