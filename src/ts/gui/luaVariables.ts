// Lists the chat variables a bot's Lua touches, for the dev tool. Static scan only:
// it sees getChatVar/setChatVar (and getState/setState) calls whose name is a string
// literal, so names built at runtime are reported only by their literal prefix.

export interface LuaSource {
    label: string
    code: string
}

export interface LuaVariableUse {
    source: string
    line: number
    write: boolean
}

export interface LuaVariable {
    /** Key as stored in chat.scriptstate, without the leading `$`. */
    name: string
    /** True when the literal is only a prefix (`'roll_'..n`); name ends with `*`. */
    pattern: boolean
    reads: number
    writes: number
    uses: LuaVariableUse[]
    comment: string
    defaultValue?: string
}

interface LuaComment {
    startLine: number
    endLine: number
    text: string
    /** No code before the comment on its first line. */
    standalone: boolean
}

const longBracket = /^\[(=*)\[/

function scanLua(code: string) {
    const comments: LuaComment[] = []
    let stripped = ''
    let line = 1
    let lineHasCode = false
    let i = 0
    const n = code.length

    const consumeLong = (start: number, level: string) => {
        const close = ']' + level + ']'
        const end = code.indexOf(close, start)
        return end === -1 ? n : end + close.length
    }
    const emitBlank = (from: number, to: number) => {
        for (let k = from; k < to; k++) {
            if (code[k] === '\n') { stripped += '\n'; line++; lineHasCode = false }
            else stripped += ' '
        }
    }

    while (i < n) {
        const ch = code[i]
        if (ch === '-' && code[i + 1] === '-') {
            const startLine = line
            const standalone = !lineHasCode
            const rest = code.slice(i + 2, i + 2 + 64)
            const long = longBracket.exec(rest)
            let end: number
            let text: string
            if (long) {
                const bodyStart = i + 2 + long[0].length
                end = consumeLong(bodyStart, long[1])
                text = code.slice(bodyStart, Math.max(bodyStart, end - long[1].length - 2))
            } else {
                end = code.indexOf('\n', i)
                if (end === -1) end = n
                text = code.slice(i + 2, end)
            }
            emitBlank(i, end)
            comments.push({ startLine, endLine: long ? line : startLine, text: text.trim(), standalone })
            i = end
            continue
        }
        if (ch === '"' || ch === "'") {
            let j = i + 1
            while (j < n && code[j] !== ch && code[j] !== '\n') j += code[j] === '\\' ? 2 : 1
            // An unterminated string stops before the newline so line counts stay right.
            const end = code[j] === ch ? j + 1 : j
            const text = code.slice(i, end)
            stripped += text
            for (const c of text) if (c === '\n') line++
            lineHasCode = true
            i = end
            continue
        }
        if (ch === '[') {
            const long = longBracket.exec(code.slice(i, i + 64))
            if (long) {
                const end = consumeLong(i + long[0].length, long[1])
                // Keep long strings out of the call scan but keep line numbers right.
                emitBlank(i, end)
                lineHasCode = true
                i = end
                continue
            }
        }
        if (ch === '\n') { line++; lineHasCode = false }
        else if (ch !== ' ' && ch !== '\t' && ch !== '\r') lineHasCode = true
        stripped += ch
        i++
    }
    return { comments, stripped }
}

interface Accessor {
    argIndex: number
    write: boolean
    /** Key parts placed before the argument: literal text or `{expr}`. */
    prefix: string
}

const baseAccessors: Record<string, Accessor[]> = {
    getChatVar: [{ argIndex: 1, write: false, prefix: '' }],
    setChatVar: [{ argIndex: 1, write: true, prefix: '' }],
    setChatVarChanged: [{ argIndex: 1, write: true, prefix: '' }],
    getState: [{ argIndex: 1, write: false, prefix: '__' }],
    setState: [{ argIndex: 1, write: true, prefix: '__' }],
    setStateChanged: [{ argIndex: 1, write: true, prefix: '__' }],
}

const PARAM = '\u0000'

function unescapeLua(value: string) {
    return value.replace(/\\(.)/g, '$1')
}

/** Splits call arguments starting right after `(`; strings are intact in `code`. */
function readArgs(code: string, start: number) {
    const args: string[] = []
    let depth = 0
    let current = ''
    for (let i = start; i < code.length; i++) {
        const ch = code[i]
        if (ch === '"' || ch === "'") {
            let j = i + 1
            while (j < code.length && code[j] !== ch && code[j] !== '\n') j += code[j] === '\\' ? 2 : 1
            current += code.slice(i, j + 1)
            i = j
            continue
        }
        if (ch === '(' || ch === '{' || ch === '[') depth++
        else if (ch === ')' || ch === '}' || ch === ']') {
            if (depth === 0) { args.push(current.trim()); return args }
            depth--
        } else if (ch === ',' && depth === 0) { args.push(current.trim()); current = ''; continue }
        current += ch
        if (current.length > 400) return args
    }
    return args
}

/** Splits `a..'b'..c` at top-level `..`. */
function splitConcat(expr: string) {
    const parts: string[] = []
    let depth = 0
    let current = ''
    for (let i = 0; i < expr.length; i++) {
        const ch = expr[i]
        if (ch === '"' || ch === "'") {
            let j = i + 1
            while (j < expr.length && expr[j] !== ch) j += expr[j] === '\\' ? 2 : 1
            current += expr.slice(i, j + 1)
            i = j
            continue
        }
        if (ch === '(' || ch === '{' || ch === '[') depth++
        else if (ch === ')' || ch === '}' || ch === ']') depth--
        if (ch === '.' && expr[i + 1] === '.' && expr[i + 2] !== '.' && depth === 0) {
            parts.push(current.trim()); current = ''; i++; continue
        }
        current += ch
    }
    parts.push(current.trim())
    return parts
}

const literalPart = /^(['"])([\s\S]*)\1$/
const identPart = /^[A-Za-z_]\w*$/

interface FunctionHeader { index: number, params: string[], name: string }

function findHeaders(code: string) {
    const headers: FunctionHeader[] = []
    const re = /(?:\bfunction\s+([A-Za-z_][\w.:]*)\s*\(([^)]*)\))|(?:([A-Za-z_][\w.]*)\s*=\s*function\s*\(([^)]*)\))/g
    for (const m of code.matchAll(re)) {
        const name = (m[1] ?? m[3]).replace(':', '.')
        const params = (m[2] ?? m[4]).split(',').map(p => p.trim()).filter(Boolean)
        // `function obj:method(a)` has an implicit self first.
        if (m[1]?.includes(':')) params.unshift('self')
        headers.push({ index: m.index, params, name })
    }
    return headers
}

function escapeName(name: string) {
    return name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function callRegex(names: string[]) {
    const alt = [...names].sort((a, b) => b.length - a.length).map(escapeName).join('|')
    return new RegExp('(?<![\\w.:])(' + alt + ')\\s*\\(', 'g')
}

/**
 * Resolves one accessor call into a key template. Returns null when the key has no
 * literal part, `{ wrapper }` when the key is a parameter of the enclosing function.
 */
function resolveKey(arg: string, prefix: string, enclosingParams: string[] | null) {
    let key = prefix
    let sawLiteral = prefix.replace(/\{[^}]*\}/g, '') !== ''
    let param: string | null = null
    const parts = splitConcat(arg)
    let trailingExpr = false
    for (const part of parts) {
        const lit = literalPart.exec(part)
        if (lit) { key += unescapeLua(lit[2]); sawLiteral = true; trailingExpr = false; continue }
        if (!param && enclosingParams && identPart.test(part) && enclosingParams.includes(part)) {
            param = part
            key += PARAM
            trailingExpr = false
            continue
        }
        key += '{' + part + '}'
        trailingExpr = true
    }
    if (param) return { wrapper: key }
    if (!sawLiteral) return null
    if (trailingExpr) key = key.replace(/(\{[^}]*\})+$/, '') + '*'
    return { name: key, pattern: trailingExpr }
}

/** Rejoins a wrapped comment into sentences; list items keep their own lines. */
function joinBlock(block: LuaComment[]) {
    let out = ''
    for (const { text } of block) {
        if (!out) out = text
        else out += (/^([-*•]|\d+[.)])\s/.test(text) ? '\n' : ' ') + text
    }
    return out.trim()
}

function escapeRegExp(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function parseDefaultVariables(text: string) {
    const out = new Map<string, string>()
    for (const raw of (text ?? '').split('\n')) {
        const eq = raw.indexOf('=')
        if (eq <= 0) continue
        const key = raw.slice(0, eq).trim()
        if (key) out.set(key, raw.slice(eq + 1).replace(/\r$/, ''))
    }
    return out
}

function enclosingParams(stripped: string, headers: FunctionHeader[], index: number) {
    let found: FunctionHeader | null = null
    for (const h of headers) {
        if (h.index >= index) break
        found = h
    }
    if (!found) return null
    let lines = 0
    for (let k = found.index; k < index; k++) if (stripped[k] === '\n' && ++lines > 40) return null
    return found
}

export function collectLuaVariables(sources: LuaSource[], defaultVariables = ''): LuaVariable[] {
    const vars = new Map<string, LuaVariable & { score: number }>()
    const scanned = sources.filter(s => s.code).map(s => {
        const { comments, stripped } = scanLua(s.code)
        return { label: s.label, comments, stripped, headers: findHeaders(stripped) }
    })

    // Find helper functions that pass one of their parameters on as the key
    // (`function ST.var(id,k) return getChatVar(id,k) end`), including helpers of helpers.
    const accessors = new Map<string, Accessor[]>(Object.entries(baseAccessors))
    const isHeaderName = (stripped: string, index: number) => /function\s+$/.test(stripped.slice(Math.max(0, index - 12), index))
    for (let round = 0; round < 4; round++) {
        let added = false
        const re = callRegex([...accessors.keys()])
        for (const src of scanned) {
            for (const m of src.stripped.matchAll(re)) {
                if (isHeaderName(src.stripped, m.index)) continue
                const header = enclosingParams(src.stripped, src.headers, m.index)
                if (!header) continue
                const args = readArgs(src.stripped, m.index + m[0].length)
                for (const acc of accessors.get(m[1]) ?? []) {
                    const arg = args[acc.argIndex]
                    if (!arg) continue
                    const resolved = resolveKey(arg, acc.prefix, header.params)
                    if (!resolved || !('wrapper' in resolved)) continue
                    const key = resolved.wrapper
                    const paramName = splitConcat(arg).find(p => identPart.test(p) && header.params.includes(p))!
                    const next: Accessor = { argIndex: header.params.indexOf(paramName), write: acc.write, prefix: key.slice(0, key.indexOf(PARAM)) }
                    if (header.name === m[1]) continue
                    const list = accessors.get(header.name) ?? []
                    if (list.some(a => a.argIndex === next.argIndex && a.write === next.write && a.prefix === next.prefix)) continue
                    list.push(next)
                    accessors.set(header.name, list)
                    added = true
                }
            }
        }
        if (!added) break
    }
    const callPattern = callRegex([...accessors.keys()])

    for (const { label, comments, stripped, headers } of scanned) {
        const source = { label }

        // Comment-only lines grouped into contiguous blocks, keyed by their last line.
        const blocks: LuaComment[][] = []
        let previousEnd = -1
        for (const c of comments) {
            if (!c.standalone) continue
            const contiguous = previousEnd + 1 === c.startLine
            previousEnd = c.endLine
            // Banner lines such as `==== 10-state.lua ====` split blocks and say nothing.
            if (/^[=\-#*]{3,}/.test(c.text) || !c.text) { blocks.push([]); continue }
            const last = blocks[blocks.length - 1]
            if (last && contiguous) last.push(c)
            else blocks.push([c])
        }
        for (let k = blocks.length - 1; k >= 0; k--) if (blocks[k].length === 0) blocks.splice(k, 1)
        const trailingAt = new Map<number, LuaComment>()
        for (const c of comments) if (!c.standalone) trailingAt.set(c.startLine, c)

        const lineStarts = [0]
        for (let k = 0; k < stripped.length; k++) if (stripped[k] === '\n') lineStarts.push(k + 1)
        const lineOf = (index: number) => {
            let lo = 0, hi = lineStarts.length - 1
            while (lo < hi) {
                const mid = (lo + hi + 1) >> 1
                if (lineStarts[mid] <= index) lo = mid
                else hi = mid - 1
            }
            return lo + 1
        }

        for (const match of stripped.matchAll(callPattern)) {
            if (isHeaderName(stripped, match.index)) continue
            const args = readArgs(stripped, match.index + match[0].length)
            const line = lineOf(match.index)
            for (const acc of accessors.get(match[1]) ?? []) {
                const arg = args[acc.argIndex]
                if (!arg) continue
                // Inside a helper, a key built from its parameter is not a variable of its own.
                const header = enclosingParams(stripped, headers, match.index)
                if (header && 'wrapper' in (resolveKey(arg, acc.prefix, header.params) ?? {})) continue
                const resolved = resolveKey(arg, acc.prefix, null)
                if (!resolved || 'wrapper' in resolved) continue
                const { name, pattern } = resolved
                const write = acc.write

                let entry = vars.get(name)
                if (!entry) {
                    entry = { name, pattern, reads: 0, writes: 0, uses: [], comment: '', score: 0 }
                    vars.set(name, entry)
                }
                if (write) entry.writes++
                else entry.reads++
                entry.uses.push({ source: source.label, line, write })

                // A comment on the call's own line is about that call.
                const trailing = trailingAt.get(line)
                const score = write ? 3 : 2.5
                if (trailing?.text && score > entry.score) { entry.score = score; entry.comment = trailing.text }
            }
        }

        // A comment block that opens with the variable's name documents it wherever it sits.
        for (const block of blocks) {
            const first = block[0].text
            for (const entry of vars.values()) {
                if (entry.score >= 4 || entry.name.includes('{')) continue
                const bare = entry.pattern ? entry.name.slice(0, -1) : entry.name.replace(/^__/, '')
                if (bare.length < 3) continue
                const word = escapeRegExp(bare) + (entry.pattern ? '' : '(?!\\w)')
                if (new RegExp('^`?' + word).test(first)) { entry.score = 4; entry.comment = joinBlock(block); continue }
                // Otherwise the first block that names it, e.g. "-- the game lives in st_state".
                if (entry.score < 2 && new RegExp('(?<!\\w)' + word).test(joinBlock(block))) {
                    entry.score = 2
                    entry.comment = joinBlock(block)
                }
            }
        }
    }

    const defaults = parseDefaultVariables(defaultVariables)
    for (const [key, value] of defaults) {
        const entry = vars.get(key)
        if (entry) entry.defaultValue = value
        else vars.set(key, { name: key, pattern: false, reads: 0, writes: 0, uses: [], comment: '', defaultValue: value, score: 0 })
    }

    return [...vars.values()]
        .map(({ score: _score, ...rest }) => rest)
        // Names with a runtime prefix (`{SH.VAR}now`) go last: they cannot be set from here.
        .sort((a, b) => Number(a.name.startsWith('{')) - Number(b.name.startsWith('{')) || a.name.localeCompare(b.name))
}
