import type MarkdownIt from 'markdown-it'
import type { NarrativeMemoryWikiMarkdown } from './memoryWiki'

// Link resolution reads ids, titles and aliases only, so catalog entries without bodies work.
export type WikiDocument = Omit<NarrativeMemoryWikiMarkdown['documents'][number], 'content'> & {
    content?: string
}

export type WikiLinkResolution =
    | { status: 'resolved'; document: WikiDocument }
    | { status: 'ambiguous'; owners: readonly WikiDocument[] }
    | { status: 'missing' }

/** Longest `[[…]]` target or alias the parser will accept. */
const MAX_WIKILINK_LENGTH = 160

export function normalizeWikiLinkKey(value: string): string {
    return value.normalize('NFKC').replace(/\s+/g, ' ').trim().toLocaleLowerCase()
}

/** Describes a `[[target]]` without guessing when several documents own it. */
export function describeWikiLinkTarget(
    target: string,
    documents: readonly WikiDocument[]
): WikiLinkResolution {
    const wanted = normalizeWikiLinkKey(target)
    if (!wanted) return { status: 'missing' }
    // Writers sometimes copy the internal id instead of the title; an exact id is unambiguous.
    const byId = documents.find((document) => document.id === target.trim())
    if (byId) return { status: 'resolved', document: byId }
    const owners: WikiDocument[] = []
    const ownerIds = new Set<string>()
    for (const document of documents) {
        const ownsIdentifier = [document.title, ...(document.aliases ?? [])]
            .some((value) => normalizeWikiLinkKey(value) === wanted)
        if (!ownsIdentifier || ownerIds.has(document.id)) continue
        ownerIds.add(document.id)
        owners.push(document)
    }
    if (owners.length === 0) return { status: 'missing' }
    if (owners.length > 1) return { status: 'ambiguous', owners }
    return { status: 'resolved', document: owners[0] }
}

/** Counts other documents linking to the target by its id, title or any alias. */
export function countWikiBacklinks(
    target: { id: string; title: string; aliases?: readonly string[] },
    documents: readonly { id: string; links?: readonly string[] }[]
): number {
    const keys = new Set([target.title, ...(target.aliases ?? [])]
        .map(normalizeWikiLinkKey).filter(Boolean))
    return documents.filter((document) => document.id !== target.id
        && (document.links ?? []).some((link) => {
            const linked = link.split('|')[0]?.split('#')[0]?.trim() ?? ''
            return linked === target.id || keys.has(normalizeWikiLinkKey(linked))
        })).length
}

/** Resolves a `[[target]]` only when one loaded document owns the identifier. */
export function resolveWikiLinkTarget(
    target: string,
    documents: readonly WikiDocument[]
): WikiDocument | null {
    const resolution = describeWikiLinkTarget(target, documents)
    return resolution.status === 'resolved' ? resolution.document : null
}

export type WikiLinkRenderResolution =
    | { status: 'resolved' }
    | { status: 'ambiguous' | 'missing'; description?: string }

export interface WikiLinkPluginOptions {
    /** Reports whether a target resolves, so unresolved links can be styled. */
    resolves?: (target: string) => boolean
    /** Reports the reason a target does not resolve and its accessible description. */
    resolve?: (target: string) => WikiLinkRenderResolution
    /**
     * Names the event document behind an evidence mark `(#N)`, or nothing when
     * no single event has that number. Without it the marks stay plain text.
     */
    eventMarkTarget?: (sequence: number) => string | undefined
}

/** Matches a whole evidence mark such as `(#12)`, `(#4–#9)` or `(#3, #7)` starting at its `(`. */
const EVENT_MARK = /^\(#\d{1,6}(?:\s*[–—~,-]\s*#\d{1,6})*\)/
/** What may precede a `#N` inside a mark: the `(` and any earlier numbers with their separators. */
const EVENT_MARK_PREFIX = /^\((?:#\d{1,6}\s*[–—~,-]\s*)*$/

/**
 * markdown-it plugin rendering Obsidian-style `[[Target]]` and
 * `[[Target|Label]]` as anchors carrying `data-wikilink`.
 *
 * Registered as an inline rule rather than a post-render string replacement so
 * that code spans and fenced blocks are left alone by the tokenizer itself.
 */
export function wikiLinkPlugin(
    md: MarkdownIt,
    options: WikiLinkPluginOptions = {}
): void {
    md.inline.ruler.before('link', 'wikilink', (state, silent) => {
        const start = state.pos
        const source = state.src
        if (source.charCodeAt(start) !== 0x5B /* [ */
            || source.charCodeAt(start + 1) !== 0x5B) return false

        const close = source.indexOf(']]', start + 2)
        if (close < 0) return false

        const body = source.slice(start + 2, close)
        if (!body || body.includes('\n') || body.includes('[')) return false

        const separator = body.indexOf('|')
        const target = (separator < 0 ? body : body.slice(0, separator)).trim()
        const label = (separator < 0 ? body : body.slice(separator + 1)).trim()
        if (!target || !label
            || target.length > MAX_WIKILINK_LENGTH
            || label.length > MAX_WIKILINK_LENGTH) return false

        // Let markdown-it scan nested brackets itself while finding the label
        // boundary of an ordinary Markdown link.
        if (silent) return false

        const linkLevel = (state as typeof state & { linkLevel:number }).linkLevel
        if (linkLevel > 0) {
            const text = state.push('text', '', 0)
            text.content = source.slice(start, close + 2)
            state.pos = close + 2
            return true
        }

        const resolution = options.resolve?.(target)
        const unresolved = resolution
            ? resolution.status !== 'resolved'
            : options.resolves?.(target) === false
        const ambiguous = resolution?.status === 'ambiguous'
        const open = state.push('wikilink_open', 'a', 1)
        open.attrSet('data-wikilink', target)
        open.attrSet('class', [
            'wikilink',
            ...(unresolved ? ['wikilink-unresolved'] : []),
            ...(ambiguous ? ['wikilink-ambiguous'] : []),
        ].join(' '))
        if (resolution) open.attrSet('data-wikilink-status', resolution.status)
        if (resolution && resolution.status !== 'resolved' && resolution.description) {
            open.attrSet('title', resolution.description)
            open.attrSet('aria-label', resolution.description)
        }
        // An anchor without href is not focusable, so links would be
        // unreachable by keyboard. Status-aware unresolved links expose a
        // diagnostic on activation, so they remain keyboard reachable.
        if (!unresolved || resolution) {
            open.attrSet('role', unresolved ? 'button' : 'link')
            open.attrSet('tabindex', '0')
        }
        const text = state.push('text', '', 0)
        text.content = label
        state.push('wikilink_close', 'a', -1)
        state.pos = close + 2
        return true
    })

    // Each `#N` inside an evidence mark becomes a link to that event, so a
    // range links both ends. The rule fires on `#` because markdown-it's text
    // rule stops there; it checks that the `#` sits inside a whole mark.
    md.inline.ruler.before('link', 'wiki_event_mark', (state, silent) => {
        const eventMarkTarget = options.eventMarkTarget
        if (!eventMarkTarget || silent) return false
        const start = state.pos
        const source = state.src
        if (source.charCodeAt(start) !== 0x23 /* # */) return false
        if ((state as typeof state & { linkLevel: number }).linkLevel > 0) return false
        const digits = /^#(\d{1,6})(?!\d)/.exec(source.slice(start))
        if (!digits) return false
        const open = source.lastIndexOf('(', start)
        if (open < 0 || !EVENT_MARK_PREFIX.test(source.slice(open, start))
            || !EVENT_MARK.test(source.slice(open))) return false
        const target = eventMarkTarget(Number(digits[1]))
        if (!target) return false
        const anchor = state.push('wikilink_open', 'a', 1)
        anchor.attrSet('data-wikilink', target)
        anchor.attrSet('class', 'wikilink wikilink-event-mark')
        anchor.attrSet('data-wikilink-status', 'resolved')
        anchor.attrSet('role', 'link')
        anchor.attrSet('tabindex', '0')
        const text = state.push('text', '', 0)
        text.content = digits[0]
        state.push('wikilink_close', 'a', -1)
        state.pos = start + digits[0].length
        return true
    })
}
