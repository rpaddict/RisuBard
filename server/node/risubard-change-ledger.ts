import type { MarkdownWikiDocument } from './risubard-markdown-wiki'
import { wikiHeadingLabelsPattern } from '../../src/ts/risubard/wikiWritingLanguage'
import { storyTimeStamp, type MemoryStoryTime } from './risubard-memory-metadata'

/**
 * The change ledger is not stored anywhere: it is read back from the
 * `State Changes` section the writer adds to each event, so events written
 * before that section existed simply contribute nothing.
 */
export interface LedgerChange {
    subject: string
    attribute?: string
    after: string
}

export interface LedgerEntry {
    item: string
    after: string
    sequence: number
}

const MAX_LEDGER_ENTRIES = 16

const changesHeading = new RegExp(`^#{2,6}[\\t ]+(?:${wikiHeadingLabelsPattern('changes')})[\\t ]*$`, 'iu')
const anyHeading = /^#{1,6}[\t ]+/u
const parsedChanges = new WeakMap<MarkdownWikiDocument, LedgerChange[]>()

function normalizedIdentity(value: string): string {
    return value.normalize('NFKC').toLocaleLowerCase().replace(/\s+/gu, '')
}

/** `- subject / attribute: after` or `- subject: after`, tolerant of hand edits. */
export function parseLedgerLine(line: string): LedgerChange | undefined {
    const match = /^\s*[-*][\t ]+(.+)$/u.exec(line)
    if (!match) return undefined
    const body = match[1].trim()
    const colon = body.search(/[:：]/u)
    if (colon <= 0) return undefined
    const head = body.slice(0, colon).trim()
    const after = body.slice(colon + 1).trim()
    if (!head || !after) return undefined
    const slash = head.indexOf(' / ')
    const subject = (slash >= 0 ? head.slice(0, slash) : head).trim()
    const attribute = slash >= 0 ? head.slice(slash + 3).trim() : ''
    if (!subject) return undefined
    return attribute ? { subject, attribute, after } : { subject, after }
}

export function eventLedgerChanges(document: MarkdownWikiDocument): LedgerChange[] {
    if (document.type !== 'event') return []
    const cached = parsedChanges.get(document)
    if (cached) return cached
    const changes: LedgerChange[] = []
    let inSection = false
    for (const line of document.content.split(/\r?\n/u)) {
        const trimmed = line.trim()
        if (anyHeading.test(trimmed)) {
            inSection = changesHeading.test(trimmed)
            continue
        }
        if (!inSection) continue
        const change = parseLedgerLine(line)
        if (change) changes.push(change)
    }
    parsedChanges.set(document, changes)
    return changes
}

/**
 * Folds the ledger for every character: each change goes to the one
 * character whose title or alias is the longest match inside its subject,
 * and only the latest value of each item survives.
 */
export function buildCharacterLedgers(
    documents: readonly MarkdownWikiDocument[],
    sequences: ReadonlyMap<string, number>,
): Map<string, LedgerEntry[]> {
    const characters = documents.filter((document) => document.type === 'character')
        .map((document) => ({
            id: document.id,
            identities: [...new Set([document.title, ...(document.aliases ?? [])]
                .map(normalizedIdentity).filter((identity) => identity.length >= 2))],
        }))
    const ledgers = new Map<string, Map<string, LedgerEntry>>()
    if (characters.length === 0) return new Map()
    for (const event of documents) {
        const sequence = sequences.get(event.id)
        if (sequence === undefined) continue
        for (const change of eventLedgerChanges(event)) {
            const subject = normalizedIdentity(change.subject)
            let best = 0
            let owners: string[] = []
            for (const character of characters) {
                const length = Math.max(0, ...character.identities
                    .filter((identity) => subject.includes(identity))
                    .map((identity) => identity.length))
                if (length === 0 || length < best) continue
                if (length > best) {
                    best = length
                    owners = []
                }
                owners.push(character.id)
            }
            if (owners.length !== 1) continue
            const item = change.attribute ?? change.subject
            const key = normalizedIdentity(item)
            const ledger = ledgers.get(owners[0]) ?? new Map<string, LedgerEntry>()
            const previous = ledger.get(key)
            if (!previous || previous.sequence <= sequence) {
                ledger.set(key, { item, after: change.after, sequence })
            }
            ledgers.set(owners[0], ledger)
        }
    }
    return new Map([...ledgers].map(([id, ledger]) => [id,
        [...ledger.values()].sort((left, right) => right.sequence - left.sequence)
            .slice(0, MAX_LEDGER_ENTRIES)]))
}

export function formatCharacterLedger(
    entries: readonly LedgerEntry[],
    eventTimes: ReadonlyMap<number, MemoryStoryTime>,
): string {
    if (entries.length === 0) return ''
    return [
        '[Change ledger: the latest recorded value of each item, newest first. It comes from event records and outranks older wording in this canon.]',
        ...entries.map((entry) => {
            const stamp = storyTimeStamp(eventTimes.get(entry.sequence))
            return `- ${entry.item}: ${entry.after} (#${entry.sequence}${stamp ? `, ${stamp}` : ''})`
        }),
    ].join('\n')
}
