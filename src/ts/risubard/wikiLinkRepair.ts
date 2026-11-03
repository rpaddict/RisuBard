import { normalizeWikiLinkKey } from './wikiLink'

export interface LinkRepairDocument {
    id: string
    title: string
    aliases?: readonly string[]
    status?: string
    /** Event order; a unit's trailing `(#N)` names the event that set it. */
    sequence?: number
}

export interface RepairedWikiLink {
    from: string
    to: string
}

export interface WikiLinkCandidate {
    id: string
    title: string
    sequence?: number
    score: number
}

/** Smallest title similarity (bigram Dice) a missing link needs before it is rewritten. */
export const LINK_REPAIR_MIN_SIMILARITY = 0.7
/** The best title must beat the best title of any other document by this much, or the link is left alone. */
export const LINK_REPAIR_MIN_MARGIN = 0.08
/** A `(#N)` mark on the same line narrows the search to events just before it, so a looser match is safe. */
export const LINK_REPAIR_STAMPED_MIN_SIMILARITY = 0.4
/** Events this many steps before the marked one still count; one turn can save several events. */
export const LINK_REPAIR_STAMP_WINDOW = 4

const namesOf = (document: LinkRepairDocument): string[] =>
    [document.title, ...(Array.isArray(document.aliases) ? document.aliases : [])]
        .filter((name): name is string => typeof name === 'string' && name.length > 0)

const WIKI_LINK = /\[\[([^\]|#\n]+)((?:[|#][^\]\n]*)?)\]\]/gu
const LINE_STAMP = /\(#(\d{1,6})\)\s*$/u

function bigrams(value: string): Map<string, number> {
    const chars = [...normalizeWikiLinkKey(value).replace(/[\s\p{P}]+/gu, '')]
    const result = new Map<string, number>()
    if (chars.length === 1) result.set(chars[0], 1)
    for (let index = 0; index + 1 < chars.length; index += 1) {
        const bigram = chars[index] + chars[index + 1]
        result.set(bigram, (result.get(bigram) ?? 0) + 1)
    }
    return result
}

function dice(left: Map<string, number>, right: Map<string, number>): number {
    let shared = 0
    let total = 0
    for (const count of left.values()) total += count
    for (const count of right.values()) total += count
    if (total === 0) return 0
    for (const [bigram, count] of left) shared += Math.min(count, right.get(bigram) ?? 0)
    return (2 * shared) / total
}

function liveDocuments(documents: readonly LinkRepairDocument[]): LinkRepairDocument[] {
    return documents.filter((document) => typeof document?.title === 'string' && document.title
        && document.status !== 'retracted' && document.status !== 'superseded')
}

function rankDocuments(
    target: string,
    candidates: readonly { document: LinkRepairDocument; grams: Map<string, number>[] }[],
): WikiLinkCandidate[] {
    const grams = bigrams(target)
    if (grams.size === 0) return []
    return candidates.map(({ document, grams: names }) => ({
        id: document.id,
        title: document.title,
        ...(typeof document.sequence === 'number' ? { sequence: document.sequence } : {}),
        score: Math.max(...names.map((other) => dice(grams, other))),
    })).sort((a, b) => b.score - a.score)
}

/** Live documents ordered by how closely their title or an alias matches a missing link target. */
export function rankWikiLinkCandidates(
    target: string,
    documents: readonly LinkRepairDocument[],
    limit = 5,
): WikiLinkCandidate[] {
    try {
        return rankDocuments(target, liveDocuments(documents)
            .map((document) => ({ document, grams: namesOf(document).map(bigrams) })))
            .filter((candidate) => candidate.score > 0)
            .slice(0, limit)
    }
    catch {
        return []
    }
}

/**
 * Rewrites a `[[link]]` that no document owns to the closest existing title, so a writer that
 * misquotes a title by a word or two does not leave a dead link. Runs on every save without a
 * model call. Links that already resolve, and links with no clearly closest title, stay as written.
 */
export function repairBrokenWikiLinks(
    markdown: string,
    documents: readonly LinkRepairDocument[],
): { markdown: string; repaired: RepairedWikiLink[] } {
    // A save must never fail because of link upkeep: malformed input leaves the text as written.
    try {
        return repairLinks(markdown, documents)
    }
    catch {
        return { markdown, repaired: [] }
    }
}

function repairLinks(
    markdown: string,
    documents: readonly LinkRepairDocument[],
): { markdown: string; repaired: RepairedWikiLink[] } {
    const live = liveDocuments(documents)
    const known = new Set<string>()
    const owners = new Map<string, string | null>()
    for (const document of live) {
        known.add(document.id)
        for (const name of namesOf(document)) {
            const key = normalizeWikiLinkKey(name)
            known.add(key)
            const owner = owners.get(key)
            owners.set(key, owner === undefined || owner === document.id ? document.id : null)
        }
    }
    const candidates = live.map((document) => ({
        document,
        grams: namesOf(document).map(bigrams),
    }))
    const cache = new Map<string, string | undefined>()
    const repaired: RepairedWikiLink[] = []

    const pick = (ranked: readonly WikiLinkCandidate[], minimum: number): string | undefined => {
        const [first, second] = ranked
        if (!first || first.score < minimum) return undefined
        if (second && first.score - second.score < LINK_REPAIR_MIN_MARGIN) return undefined
        return first.title
    }
    const closest = (target: string): string | undefined => pick(rankDocuments(target, candidates), LINK_REPAIR_MIN_SIMILARITY)
    // Only events just before the marked one, minus those the line already links, compete.
    const closestNear = (target: string, stamp: number, linked: Set<string>): string | undefined => pick(
        rankDocuments(target, candidates.filter(({ document }) => typeof document.sequence === 'number'
            && document.sequence <= stamp && document.sequence > stamp - LINK_REPAIR_STAMP_WINDOW
            && !linked.has(document.id))),
        LINK_REPAIR_STAMPED_MIN_SIMILARITY,
    )

    const result = markdown.split('\n').map((line) => {
        if (!line.includes('[[')) return line
        const stamp = Number(line.match(LINE_STAMP)?.[1])
        const linked = new Set<string>()
        for (const match of line.matchAll(WIKI_LINK)) {
            const owner = owners.get(normalizeWikiLinkKey(match[1]))
            if (owner) linked.add(owner)
            else if (known.has(match[1].trim())) linked.add(match[1].trim())
        }
        return line.replace(WIKI_LINK, (match, target: string, suffix: string) => {
            const key = normalizeWikiLinkKey(target)
            if (!key || known.has(key) || known.has(target.trim())) return match
            if (!cache.has(key)) cache.set(key, closest(target))
            const title = cache.get(key)
                ?? (Number.isSafeInteger(stamp) && stamp > 0 ? closestNear(target, stamp, linked) : undefined)
            if (!title || /[\[\]|#\n]/u.test(title)) return match
            const owner = owners.get(normalizeWikiLinkKey(title))
            if (owner) linked.add(owner)
            repaired.push({ from: target.trim(), to: title })
            return `[[${title}${suffix}]]`
        })
    }).join('\n')
    return { markdown: result, repaired }
}

/**
 * Points every `[[from]]` in the text at `target`, keeping each link's `#section` and `|label`.
 * With `keepWording`, a link without a label keeps its old wording as one, for targets such as
 * document ids that read poorly in prose.
 */
export function relinkWikiLink(
    markdown: string,
    from: string,
    target: string,
    options: { keepWording?: boolean } = {},
): { markdown: string; count: number } {
    const wanted = normalizeWikiLinkKey(from.split('#')[0] ?? '')
    if (!wanted || !target.trim() || /[\[\]|#\n]/u.test(target)) return { markdown, count: 0 }
    let count = 0
    const result = markdown.replace(WIKI_LINK, (match, linked: string, suffix: string) => {
        if (normalizeWikiLinkKey(linked) !== wanted) return match
        count += 1
        const label = options.keepWording && !suffix.includes('|') ? `|${linked.trim()}` : ''
        return `[[${target.trim()}${suffix}${label}]]`
    })
    return { markdown: result, count }
}
