import { isWikiHeadingLabel } from '../../src/ts/risubard/wikiWritingLanguage'
import { coverSupportsUnit, joinSectionUnits, splitSectionUnits } from './risubard-canonical-maintenance'
import {
    applyCanonicalSectionPatches,
    listCanonicalSections,
    mapCanonicalSectionBodies,
    normalizeCanonicalSectionHeading,
} from './risubard-markdown-section-patch'
import type { CanonicalSectionPatch } from './risubard-memory-writer'

// Existing sections are edited unit by unit so that whatever the model leaves
// out stays; only the current-state snapshot and new sections are written whole.
export const CANONICAL_UNIT_EDIT_INSTRUCTIONS = [
    'Existing sections show numbered units like "- [3] text"; the numbers are references, never write them. A trailing (#N) marks the event that set a unit; the program writes it, not you.',
    'To change an existing section other than current state, use operation edit with empty content: new units in add, rewritten units in replace by index, dropped units in remove with a reason. Unmentioned units stay; never repeat them.',
    'Remove reasons: superseded (a confirmed change this turn made it untrue), merged (its facts now live in the kept unit mergedInto), corrected (the confirmed messages show it was wrong), covered (only for an overBudget target: the unit just narrates something an event in its coverEvents records). mergedInto is only for merged. Prefer replace for a new wording or value.',
    'Use upsert with the complete body only for the current-state section and new sections. Do not delete an existing section unless every fact in it appears in another section in this response.',
    'Every section has heading, operation, content, add, replace and remove; use empty arrays for unused fields.',
]

// One or more trailing evidence marks: (#4) or a merged range (#4–#9).
const STAMP = /(?:\s*\(#\d+(?:\s*[–-]\s*#?\d+)?\))+\s*$/u

/**
 * Marks a unit with the event that set it. A single mark is replaced; a merged range
 * is extended to the new event instead of gaining a second mark.
 */
export function stampUnit(text: string, sequence: number): string {
    const marks = STAMP.exec(text)?.[0] ?? ''
    const numbers = [...marks.matchAll(/\d+/gu)].map((match) => Number(match[0]))
    const base = text.slice(0, text.length - marks.length)
    if (numbers.length < 2) return `${base} (#${sequence})`
    const start = Math.min(...numbers, sequence)
    const end = Math.max(...numbers, sequence)
    return `${base} ${start === end ? `(#${end})` : `(#${start}–#${end})`}`
}

/** Shown to the model on a unit that belongs to a thread the story has not resolved. */
export const OPEN_UNIT_TAG = '[open]'
const UNIT_MARKER = /^(\s*(?:[-*]\s+)?)\[\d{1,4}\](?:\s*\[open\])?\s+/gmu
const LINK = /\[\[([^\]|#]+)/gu

const normalized = (value: string) => value.normalize('NFKC').replace(/\s+/gu, ' ').trim()
const linksIn = (value: string) => new Set([...value.matchAll(LINK)].map((match) => match[1].trim()))

/** Unit references are shown to the model only; they never belong in saved text. */
export function stripUnitMarkers(value: string): string {
    return value.replace(UNIT_MARKER, '$1')
}

// A unit's own text, without a bullet or a copied reference number.
const unitText = (value: string) => stripUnitMarkers(value).trim().replace(/^[-*]\s+/u, '').replace(/^\[open\]\s+/u, '')

/**
 * The document as the model sees it: every section's units numbered for edit references,
 * and units of still-open threads tagged so a consolidation leaves them.
 */
export function annotateCanonicalUnits(markdown: string, isOpen?: (unit: string) => boolean): string {
    try {
        return mapCanonicalSectionBodies(markdown, (_heading, body) => {
            const { bullet, units } = splitSectionUnits(body)
            return joinSectionUnits(units.map((unit, index) =>
                `[${index}] ${isOpen?.(unit) ? `${OPEN_UNIT_TAG} ` : ''}${unit}`), bullet)
        })
    }
    catch {
        return markdown
    }
}

export interface CanonicalUnitResolution {
    /** Only upsert and delete patches, ready for applyCanonicalSectionPatches. */
    patches: CanonicalSectionPatch[]
    /** Units dropped without a reason or support that were kept. */
    restored: number
    /** Unit edits ignored because their index or reason was not valid. */
    rejected: number
    /** Units removed with a valid reason. */
    removed: number
}

/**
 * Turns a model's section patches into saved text with preservation as the
 * default. Unit edits change only the units they name; a whole-section
 * rewrite or delete of an existing section keeps every old unit the result no
 * longer supports. The current-state snapshot is replaced by design, and a
 * rewrite target such as the story arc map may be compacted freely.
 */
export function resolveCanonicalUnitPatches(input: {
    markdown: string
    title: string
    patches: readonly CanonicalSectionPatch[]
    /** The turn recorded a state change, so a unit may be superseded on its own. */
    allowSupersede: boolean
    rewrite?: boolean
    /** Story-order number of this turn's event, stamped on the units it adds or rewrites. */
    stamp?: number
    /** Bodies of the events an over-budget card may drop units into; without it no unit is covered. */
    coverContent?: string
    /** Titles of event documents: their links may leave the card, since events stay searchable. */
    eventTitles?: readonly string[]
    /** A unit of a thread the story has not resolved; it may not be dropped as covered. */
    isOpen?: (unit: string) => boolean
}): CanonicalUnitResolution {
    const stamped = (text: string) => input.stamp === undefined ? text : stampUnit(text, input.stamp)
    const existing = new Map(listCanonicalSections(input.markdown)
        .map((section) => [normalizeCanonicalSectionHeading(section.heading), section]))
    const identity = (value: string) => value.normalize('NFKC').toLocaleLowerCase().trim()
    const events = new Set((input.eventTitles ?? []).map(identity))
    let restored = 0
    let rejected = 0
    let removed = 0
    const guarded = new Set<CanonicalSectionPatch>()
    // Unit edits are finished after every patch is read, so a link may be kept by another section.
    const drafts: Array<{
        slot: number
        heading: string
        bullet: boolean
        units: string[]
        result: string[]
        add: string[]
        removals: Map<number, unknown>
        replaced: number
    }> = []
    const resolved: Array<CanonicalSectionPatch | undefined> = []
    for (const patch of input.patches) {
        const section = patch.heading ? existing.get(normalizeCanonicalSectionHeading(patch.heading)) : undefined
        if (patch.operation !== 'edit') {
            const next: CanonicalSectionPatch = {
                heading: patch.heading,
                operation: patch.operation,
                content: stripUnitMarkers(patch.content).trim(),
            }
            if (section && !input.rewrite && !isWikiHeadingLabel('currentState', patch.heading)) guarded.add(next)
            // A section new in this turn holds only this turn's facts.
            if (!section && patch.heading && next.operation === 'upsert' && input.stamp !== undefined
                && !input.rewrite && !isWikiHeadingLabel('currentState', patch.heading)) {
                const { bullet, units } = splitSectionUnits(next.content)
                next.content = joinSectionUnits(units.map(stamped), bullet)
            }
            resolved.push(next)
            continue
        }
        const edits = patch.edits ?? { add: [], replace: [], remove: [] }
        const add = edits.add.map(unitText).filter(Boolean)
        if (!section) {
            if (add.length > 0) resolved.push({ heading: patch.heading, operation: 'upsert', content: joinSectionUnits(add.map(stamped), true) })
            rejected += edits.replace.length + edits.remove.length
            continue
        }
        const { bullet, units } = splitSectionUnits(section.body)
        const result = [...units]
        const replaced = new Set<number>()
        for (const item of edits.replace) {
            const text = unitText(item.text)
            if (item.index >= units.length || replaced.has(item.index) || !text) {
                rejected += 1
                continue
            }
            replaced.add(item.index)
            result[item.index] = stamped(text)
        }
        const removals = new Map<number, (typeof edits.remove)[number]>()
        for (const item of edits.remove) {
            const target = item.mergedInto
            const validTarget = target !== null && target < units.length && target !== item.index
            const allowed = item.reason === 'merged' ? validTarget
                : item.reason === 'superseded' ? input.allowSupersede || validTarget
                    // The same check card maintenance uses: the event must actually hold the unit's words.
                    : item.reason === 'covered' ? input.coverContent !== undefined && item.index < units.length
                        && coverSupportsUnit(units[item.index], input.coverContent)
                        && !input.isOpen?.(units[item.index])
                        : true
            if (item.index >= units.length || replaced.has(item.index) || removals.has(item.index) || !allowed) {
                rejected += 1
                continue
            }
            removals.set(item.index, item)
        }
        // A unit merged into another removed unit would vanish with it.
        for (const [index, item] of [...removals]) {
            if (item.mergedInto !== null && removals.has(item.mergedInto)) {
                removals.delete(index)
                rejected += 1
            }
        }
        if (replaced.size === 0 && removals.size === 0 && add.length === 0) continue
        drafts.push({ slot: resolved.length, heading: patch.heading, bullet, units, result, add, removals, replaced: replaced.size })
        resolved.push(undefined)
    }
    const kept = (draft: (typeof drafts)[number]) =>
        [...draft.result.filter((_unit, index) => !draft.removals.has(index)), ...draft.add.map(stamped)]
    // The card must still name every person and place it named before, anywhere in it.
    // Event links may go: events stay searchable, and keeping them undid every merge of transitions.
    const editedHeadings = new Set(input.patches.map((patch) => normalizeCanonicalSectionHeading(patch.heading)))
    const present = linksIn([
        ...[...existing].filter(([heading]) => !editedHeadings.has(heading)).map(([, section]) => section.body),
        ...resolved.flatMap((patch) => patch && patch.operation !== 'delete' ? [patch.content] : []),
        ...drafts.flatMap(kept),
    ].join('\n'))
    for (const draft of drafts) {
        for (const index of [...draft.removals.keys()]) {
            const lost = [...linksIn(draft.units[index])].filter((link) => !present.has(link) && !events.has(identity(link)))
            if (lost.length === 0) continue
            draft.removals.delete(index)
            restored += 1
            for (const link of lost) present.add(link)
        }
        removed += draft.removals.size
        const final = kept(draft)
        resolved[draft.slot] = draft.replaced === 0 && draft.removals.size === 0 && draft.add.length === 0
            ? undefined
            : final.length === 0
                ? { heading: draft.heading, operation: 'delete', content: '' }
                : { heading: draft.heading, operation: 'upsert', content: joinSectionUnits(final, draft.bullet || draft.units.length === 0) }
    }
    const ready = resolved.filter((patch): patch is CanonicalSectionPatch => patch !== undefined)
    if (guarded.size === 0) return { patches: ready, restored, rejected, removed }
    let documentText: string
    try {
        documentText = applyCanonicalSectionPatches({ markdown: input.markdown, title: input.title, patches: ready })
    }
    catch {
        // The caller applies the same patches and reports the structural error.
        return { patches: ready, restored, rejected, removed }
    }
    // Only the unit's own words count as kept. A similar line about another
    // clue or person must not pass for it, so a reworded unit may come back as
    // a duplicate; card maintenance can merge it later with its own checks.
    const comparable = (value: string) => normalized(value.replace(/\(#\d+\)/gu, ''))
        .replace(/[.!?。]+(?=\s|$)/gu, '').toLocaleLowerCase()
    const remaining = comparable(documentText)
    const supported = (unit: string) => remaining.includes(comparable(unit))
    const patches = ready.map((patch) => {
        if (!guarded.has(patch)) return patch
        const section = existing.get(normalizeCanonicalSectionHeading(patch.heading))!
        const { bullet, units } = splitSectionUnits(section.body)
        const missing = units.filter((unit) => !supported(unit))
        if (missing.length === 0) return patch
        restored += missing.length
        if (patch.operation === 'delete') {
            return { heading: patch.heading, operation: 'upsert' as const, content: joinSectionUnits(missing, bullet) }
        }
        const appendAsBullets = bullet || splitSectionUnits(patch.content).bullet
        return {
            ...patch,
            content: `${patch.content}${appendAsBullets ? '\n' : '\n\n'}${joinSectionUnits(missing, appendAsBullets)}`,
        }
    })
    return { patches, restored, rejected, removed }
}
