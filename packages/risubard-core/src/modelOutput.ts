/**
 * Some providers (seen with Gemini) put raw newlines or tabs inside JSON
 * strings. Escaping them only turns invalid JSON into the value the model meant.
 */
function escapeControlsInStrings(value: string): string {
    let out = ''
    let inString = false
    let escaped = false
    for (const character of value) {
        if (inString) {
            if (escaped) escaped = false
            else if (character === '\\') escaped = true
            else if (character === '"') inString = false
            else if (character === '\n') { out += '\\n'; continue }
            else if (character === '\r') { out += '\\r'; continue }
            else if (character === '\t') { out += '\\t'; continue }
        }
        else if (character === '"') inString = true
        out += character
    }
    return out
}

function parseObject(source: string): unknown {
    for (const attempt of [source, escapeControlsInStrings(source)]) {
        try {
            const parsed = JSON.parse(attempt)
            if (typeof parsed === 'object'
                && parsed !== null
                && !Array.isArray(parsed)) {
                return parsed
            }
            return undefined
        }
        catch {
            // Try the repaired form, then give up on this span.
        }
    }
    return undefined
}

const reasoningOpen = /^<(Thoughts|think|thinking)>/i

function jsonObjectCandidates(value: string): unknown[] {
    const candidates: unknown[] = []
    let start = -1
    let depth = 0
    let inString = false
    let escaped = false
    for (let index = 0; index < value.length; index += 1) {
        const character = value[index]
        if (inString) {
            if (escaped) escaped = false
            else if (character === '\\') escaped = true
            else if (character === '"') inString = false
            continue
        }
        if (depth === 0) {
            // Outside any object: skip reasoning blocks wherever they sit, and
            // do not treat prose quotes as strings (an odd one would hide the JSON).
            if (character === '<') {
                const open = reasoningOpen.exec(value.slice(index, index + 12))
                if (open) {
                    const close = value.toLowerCase().indexOf(
                        `</${open[1].toLowerCase()}>`,
                        index + open[0].length
                    )
                    if (close < 0) break
                    index = close + open[1].length + 2
                    continue
                }
            }
            if (character === '{') {
                start = index
                depth = 1
            }
            continue
        }
        if (character === '"') inString = true
        else if (character === '{') depth += 1
        else if (character === '}') {
            depth -= 1
            if (depth === 0) {
                const parsed = parseObject(value.slice(start, index + 1))
                if (parsed !== undefined) candidates.push(parsed)
                start = -1
            }
        }
    }
    return candidates
}

export function stripModelReasoning(value: string): string {
    let remaining = value
    while (true) {
        // Strip only leading provider wrappers, never tags quoted inside JSON
        // document content. An unfinished reasoning block has no final answer.
        const reasoning = remaining.match(
            /^\s*<(Thoughts|think)>[\s\S]*?(?:<\/\1>|$)/i
        )
        if (!reasoning) return remaining
        remaining = remaining.slice(reasoning[0].length)
    }
}

// Chat-only emptiness check: keep an unclosed leading tag's text. Proxies mix
// thoughts into content with mismatched or missing closing tags, and a normally
// finished reply must not be discarded as empty because of that.
export function stripClosedModelReasoning(value: string): string {
    let remaining = value
    while (true) {
        const reasoning = remaining.match(/^\s*<(Thoughts|think)>[\s\S]*?<\/\1>/i)
        if (!reasoning) return remaining
        remaining = remaining.slice(reasoning[0].length)
    }
}

export function parseSingleJsonObject(value: string): unknown {
    if (typeof value !== 'string') {
        throw new Error('Model output must be a string')
    }
    const candidates = jsonObjectCandidates(
        stripModelReasoning(value)
    )
    if (candidates.length !== 1) {
        throw new Error('Model output must contain exactly one JSON object')
    }
    return candidates[0]
}

export function parseSingleJsonObjectMatching(
    value: string,
    matches: (candidate: Record<string, unknown>) => boolean
): unknown {
    if (typeof value !== 'string') {
        throw new Error('Model output must be a string')
    }
    const candidates = jsonObjectCandidates(stripModelReasoning(value))
    if (candidates.length === 1) return candidates[0]
    const matching = candidates.filter((candidate) =>
        matches(candidate as Record<string, unknown>)
    )
    if (matching.length !== 1) {
        throw new Error('Model output must contain exactly one JSON object')
    }
    return matching[0]
}

export function normalizeNarrativeBaseline(value: string): string {
    if (typeof value !== 'string') {
        throw new Error('Baseline output must be a string')
    }
    let normalized = stripModelReasoning(value).trim()
    const fenced = normalized.match(
        /^```(?:text|markdown|md)?\s*\r?\n([\s\S]*?)\r?\n```$/i
    )
    if (fenced) normalized = fenced[1].trim()
    if (normalized.length === 0) {
        throw new Error('Baseline output is empty after normalization')
    }
    if (normalized.length > 12_000) {
        throw new Error('Baseline output exceeds 12000 characters')
    }
    return normalized
}
