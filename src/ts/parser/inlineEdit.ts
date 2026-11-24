// Maps text a reader edits in the rendered message back onto the message source.
// The rendered text must be the source with only markup removed; anything a script
// or macro produced is locked, and an edit touching it is refused.

/** Stands for a locked element (image, status box, ruby, link) in rendered text. */
export const LOCKED_CHAR = '\uFFFC'

export interface PlainSpan {
    /** Source range this rendered character came from; empty for collapsed whitespace. */
    start: number
    end: number
    /** Produced by a macro or a locked element: never edited. */
    locked: boolean
}

export interface InlineAlignment {
    start: number
    end: number
    spans: PlainSpan[]
}

const MAX_PLAIN_LENGTH = 6000
// Macro output is a name or a short value; longer runs would swallow real text.
const MAX_MACRO_OUTPUT = 60
const MARKUP_CHARS = new Set(['*', '_', '~', '`', '#', '>', '\\'])
const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr'])
const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

function canon(ch: string): string {
    switch (ch) {
        case '\u2018': case '\u2019': return "'"
        case '\u201C': case '\u201D': return '"'
        case '\u00A0': case '\u3000': return ' '
        default: return ch
    }
}

function isSpace(ch: string | undefined): boolean {
    return ch !== undefined && /\s/.test(ch)
}

function isZeroWidth(ch: string | undefined): boolean {
    return ch !== undefined && ((ch >= '\u200B' && ch <= '\u200D') || ch === '\uFEFF')
}

/** End of a `{{...}}` macro starting at j, honoring nesting. */
function macroEnd(source: string, j: number): number {
    if (!source.startsWith('{{', j)) return -1
    let depth = 0
    for (let k = j; k < source.length - 1; k++) {
        if (source[k] === '{' && source[k + 1] === '{') { depth++; k++ }
        else if (source[k] === '}' && source[k + 1] === '}') {
            depth--
            k++
            if (depth === 0) return k + 1
        }
    }
    return -1
}

function tagEnd(source: string, j: number): number {
    if (source.startsWith('<!--', j)) {
        const close = source.indexOf('-->', j + 4)
        return close === -1 ? -1 : close + 3
    }
    const m = /^<\/?[A-Za-z][\w-]*(?:\s[^<>]*)?\/?>/.exec(source.slice(j, j + 2000))
    return m ? j + m[0].length : -1
}

/** A whole element (`<img>`, `<a>..</a>`) starting at j. */
function elementEnd(source: string, j: number): number {
    const open = /^<([A-Za-z][\w-]*)\b[^<>]*>/.exec(source.slice(j, j + 2000))
    if (!open) return -1
    const openEnd = j + open[0].length
    const name = open[1].toLowerCase()
    if (VOID_TAGS.has(name) || open[0].endsWith('/>')) return openEnd
    const close = source.toLowerCase().indexOf(`</${name}`, openEnd)
    if (close === -1) return openEnd
    const gt = source.indexOf('>', close)
    return gt === -1 ? openEnd : gt + 1
}

/** `![alt](src)` or `[text](href)` starting at j. */
function markdownLinkEnd(source: string, j: number): number {
    const m = /^!?\[[^\]\n]*\]\([^)\n]*\)/.exec(source.slice(j, j + 2000))
    return m ? j + m[0].length : -1
}

function listMarkerEnd(source: string, j: number): number {
    if (j > 0 && source[j - 1] !== '\n') return -1
    const m = /^[ \t]*(?:\d+[.)]|[-+*])[ \t]+/.exec(source.slice(j, j + 40))
    return m ? j + m[0].length : -1
}

function entityAt(source: string, j: number): { ch: string; end: number } | null {
    if (source[j] !== '&') return null
    const m = /^&(#\d+|#x[0-9a-f]+|[a-z]+);/i.exec(source.slice(j, j + 12))
    if (!m) return null
    const body = m[1]
    let ch: string | undefined
    if (body[0] === '#') {
        const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10)
        ch = Number.isFinite(code) ? String.fromCodePoint(code) : undefined
    } else {
        ch = ENTITIES[body.toLowerCase()]
    }
    return ch ? { ch, end: j + m[0].length } : null
}

interface Step {
    i: number
    j: number
    /** Spans for plain characters consumed by this step, in order. */
    spans: PlainSpan[]
}

// Every way to advance from (i, j), most literal first.
function nextSteps(source: string, plain: string, i: number, j: number): Step[] {
    const steps: Step[] = []
    const p = plain[i]
    const s = source[j]

    if (p === LOCKED_CHAR) {
        for (const end of [macroEnd(source, j), elementEnd(source, j), markdownLinkEnd(source, j)]) {
            if (end > j) steps.push({ i: i + 1, j: end, spans: [{ start: j, end, locked: true }] })
        }
    } else if (j < source.length) {
        if (isSpace(p) && isSpace(s)) {
            let end = j
            while (end < source.length && isSpace(source[end])) end++
            steps.push({ i: i + 1, j: end, spans: [{ start: j, end, locked: false }] })
        } else if (canon(p) === canon(s)) {
            steps.push({ i: i + 1, j: j + 1, spans: [{ start: j, end: j + 1, locked: false }] })
        } else if (p === '\u2026' && source.startsWith('...', j)) {
            steps.push({ i: i + 1, j: j + 3, spans: [{ start: j, end: j + 3, locked: false }] })
        }
        const entity = entityAt(source, j)
        if (entity && canon(entity.ch) === canon(p)) {
            steps.push({ i: i + 1, j: entity.end, spans: [{ start: j, end: entity.end, locked: false }] })
        }
    }

    // Whitespace the renderer kept but the source does not have.
    if (p !== LOCKED_CHAR && (isSpace(p) || isZeroWidth(p))) {
        steps.push({ i: i + 1, j, spans: [{ start: j, end: j, locked: false }] })
    }

    // A macro such as {{user}} renders as text that is not in the source.
    const macro = macroEnd(source, j)
    if (macro > j && p !== LOCKED_CHAR) {
        for (let k = 1; i + k <= plain.length && k <= MAX_MACRO_OUTPUT; k++) {
            const ch = plain[i + k - 1]
            if (ch === LOCKED_CHAR || ch.charCodeAt(0) === 10) break
            steps.push({
                i: i + k,
                j: macro,
                spans: Array.from({ length: k }, () => ({ start: j, end: macro, locked: true })),
            })
        }
    }

    // Markup that renders as nothing.
    if (i > 0 && j < source.length) {
        if (macro > j) steps.push({ i, j: macro, spans: [] })
        const tag = tagEnd(source, j)
        if (tag > j) steps.push({ i, j: tag, spans: [] })
        const marker = listMarkerEnd(source, j)
        if (marker > j) steps.push({ i, j: marker, spans: [] })
        if (isSpace(s) || isZeroWidth(s) || MARKUP_CHARS.has(s)) steps.push({ i, j: j + 1, spans: [] })
    }
    return steps
}

interface Frame {
    i: number
    j: number
    steps: Step[]
    next: number
}

function alignFrom(
    source: string,
    plain: string,
    start: number,
    failed: Set<number>,
): InlineAlignment | null {
    const width = source.length + 1
    const spans: PlainSpan[] = new Array(plain.length)
    const stack: Frame[] = [{ i: 0, j: start, steps: nextSteps(source, plain, 0, start), next: 0 }]
    while (stack.length) {
        const frame = stack[stack.length - 1]
        if (frame.next >= frame.steps.length) {
            if (frame.i > 0) failed.add(frame.i * width + frame.j)
            stack.pop()
            continue
        }
        const step = frame.steps[frame.next++]
        for (let k = 0; k < step.spans.length; k++) spans[frame.i + k] = step.spans[k]
        if (step.i === plain.length) {
            const first = spans.find(span => span.end > span.start) ?? spans[0]
            return { start: first.start, end: step.j, spans: spans.slice() }
        }
        if (failed.has(step.i * width + step.j)) continue
        stack.push({ i: step.i, j: step.j, steps: nextSteps(source, plain, step.i, step.j), next: 0 })
    }
    return null
}

// A match made mostly of macro output says nothing about where the text came from.
function mostlyLiteral(found: InlineAlignment, plain: string): boolean {
    let literal = 0
    let macro = 0
    for (let k = 0; k < found.spans.length; k++) {
        if (isSpace(plain[k]) || plain[k] === LOCKED_CHAR) continue
        if (found.spans[k].locked) macro++
        else literal++
    }
    return literal > 0 && literal >= macro
}

/**
 * Every place in `source` that renders as `plain`, in source order.
 * Leading and trailing whitespace of `plain` maps to empty spans at the edges.
 */
export function findInlineAlignments(source: string, plain: string): InlineAlignment[] {
    const lead = plain.length - plain.trimStart().length
    const core = plain.trim()
    if (!core || core.length > MAX_PLAIN_LENGTH) return []
    const trail = plain.length - lead - core.length

    const failed = new Set<number>()
    const results: InlineAlignment[] = []
    let from = 0
    for (let j = 0; j < source.length; j++) {
        if (j < from) continue
        const first = core[0]
        const possible = first === LOCKED_CHAR
            || source[j] === '{'
            || canon(source[j]) === canon(first)
            || source[j] === '&'
            || (first === '\u2026' && source[j] === '.')
        if (!possible) continue
        const found = alignFrom(source, core, j, failed)
        if (!found || !mostlyLiteral(found, core)) continue
        const lastEnd = found.spans[found.spans.length - 1].end
        const spans = [
            ...Array.from({ length: lead }, () => ({ start: found.start, end: found.start, locked: false })),
            ...found.spans,
            ...Array.from({ length: trail }, () => ({ start: lastEnd, end: lastEnd, locked: false })),
        ]
        results.push({ start: found.start, end: lastEnd, spans })
        from = lastEnd
    }
    return results
}

function countLocked(text: string): number {
    let n = 0
    for (const ch of text) if (ch === LOCKED_CHAR) n++
    return n
}

/**
 * Applies the change between two renderings of one block to the source.
 * Markup inside the changed range is kept so emphasis and tags stay balanced.
 * Returns null when the change would touch locked content.
 */
export function applyInlineEdit(
    source: string,
    alignment: InlineAlignment,
    oldPlain: string,
    newPlain: string,
): string | null {
    const before = oldPlain.replace(/\u00A0/g, ' ')
    let after = newPlain.replace(/\u00A0/g, ' ')
    if (before.length !== alignment.spans.length) return null
    // Browsers keep a trailing line break so an empty last line stays visible.
    const keptBreaks = /\n*$/.exec(before)![0].length
    after = after.replace(/\n+$/, m => m.slice(0, keptBreaks))
    if (before === after) return source
    if (countLocked(before) !== countLocked(after)) return null

    let prefix = 0
    const max = Math.min(before.length, after.length)
    while (prefix < max && before[prefix] === after[prefix]) prefix++
    let suffix = 0
    while (suffix < max - prefix && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix++

    const removeEnd = before.length - suffix
    const inserted = after.slice(prefix, after.length - suffix)
    const spans = alignment.spans

    for (let k = prefix; k < removeEnd; k++) if (spans[k].locked) return null
    if (prefix === removeEnd && prefix > 0 && prefix < spans.length) {
        const left = spans[prefix - 1]
        const right = spans[prefix]
        if (left.locked && right.locked && left.start === right.start && left.end === right.end) return null
    }

    const at = prefix < removeEnd
        ? spans[prefix].start
        : prefix > 0 ? spans[prefix - 1].end : spans[0].start

    const removed: Array<[number, number]> = []
    for (let k = prefix; k < removeEnd; k++) {
        const { start, end } = spans[k]
        if (end > start) removed.push([start, end])
    }

    let out = source.slice(0, at) + inserted
    let cursor = at
    for (const [start, end] of removed) {
        if (start > cursor) out += source.slice(cursor, start)
        cursor = Math.max(cursor, end)
    }
    return out + source.slice(cursor)
}
