import * as nodeFs from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { basename, isAbsolute, join, relative, resolve } from 'node:path'
import { resolveMemoryWorkspace } from './risubard-memory-workspace'
import { inquireMarkdownDocuments } from './risubard-markdown-inquiry'
import { detectWikiWritingLanguage, localizeWikiHeadings, normalizeWikiWritingLanguage, wikiWritingHeadings, type WikiWritingLanguage } from '../../src/ts/risubard/wikiWritingLanguage'
import {
    parseCanonicalTurnReceipt,
    type CanonicalTurnReceipt,
} from '../../src/ts/risubard/canonicalTurnReceipt'

export interface MarkdownWikiDocument {
    id: string
    type: MarkdownWikiDocumentType
    status: 'active' | 'superseded' | 'retracted'
    supersededBy?: string
    title: string
    aliases: string[]
    relativePath: string
    sourceMessageIds: string[]
    updated: string
    content: string
    links: string[]
    created?: string
    authoring?: 'automatic' | 'ai-assisted' | 'manual'
    contextMode: MarkdownWikiContextMode
    contentHash: string
    reviewStatus?: 'unreviewed' | 'reviewed'
    reviewBaseContent?: string
}

export type MarkdownWikiContextMode = 'always' | 'auto' | 'never'

export type MarkdownWikiDocumentType = 'event' | 'character' | 'location'
    | 'scene' | 'faction' | 'creature' | 'item' | 'concept' | 'other'
export type CanonicalMarkdownWikiDocumentType = Exclude<
    MarkdownWikiDocumentType,
    'event'
>

export interface MarkdownWikiView {
    mode: 'markdown'
    wikiPath: string
    documents: MarkdownWikiDocument[]
    health: MarkdownWikiHealth
}

export interface MarkdownWikiHealth {
    danglingLinks: Array<{ sourceId: string; target: string }>
    unlinkedDocumentIds: string[]
    duplicatePassages: Array<{ documentIds: [string, string] }>
}

interface RebootRecoveryManifest {
    version: 1
    created: string
    sourceMessageIds: string[]
    eventSourceGroups: string[][]
    documents: Array<{
        id: string
        type: CanonicalMarkdownWikiDocumentType
        relativePath: string
    }>
    receipt?: CanonicalTurnReceipt
}

export interface MarkdownWikiWorkspace {
    directory: string
    eventsDirectory: string
    charactersDirectory: string
    locationsDirectory: string
    historyDirectory: string
    trashDirectory: string
    snapshotsDirectory: string
    recoveryDirectory: string
    reviewDirectory: string
    sceneFile: string
    indexFile: string
}

type WikiFileSystem = Pick<
    typeof nodeFs,
    'lstat' | 'mkdir' | 'readFile' | 'readdir' | 'realpath' | 'rename'
    | 'rm' | 'writeFile'
>

function required(value: string, label: string): string {
    if (typeof value !== 'string' || value.trim().length === 0) {
        throw new Error(`${label} must not be empty`)
    }
    return value
}

function normalizeAliases(
    values: readonly string[] | undefined,
    title: string
): string[] {
    if (values === undefined) return []
    if (!Array.isArray(values) || values.length > 32) {
        throw new Error('Wiki aliases must contain at most 32 items')
    }
    const titleKey = title.normalize('NFKC').toLocaleLowerCase()
    const seen = new Set<string>()
    const aliases: string[] = []
    for (const value of values) {
        if (typeof value !== 'string') {
            throw new Error('Wiki alias must be a string')
        }
        const alias = value.trim()
        if (alias.length === 0 || alias.length > 160) {
            throw new Error('Wiki alias must contain 1-160 characters')
        }
        const key = alias.normalize('NFKC').toLocaleLowerCase()
        if (key === titleKey || seen.has(key)) continue
        seen.add(key)
        aliases.push(alias)
    }
    return aliases
}

function aliasesForSave(input: {
    aliases?: readonly string[]
    title: string
    existing?: Pick<MarkdownWikiDocument, 'title' | 'aliases'>
}): string[] {
    const values = input.aliases === undefined
        ? [...(input.existing?.aliases ?? [])]
        : [...input.aliases]
    if (input.existing
        && input.existing.title.normalize('NFKC').toLocaleLowerCase()
            !== input.title.normalize('NFKC').toLocaleLowerCase()) {
        values.push(input.existing.title)
    }
    return normalizeAliases(values, input.title)
}

function yamlString(value: string): string {
    return JSON.stringify(value)
}

function stableId(sourceMessageIds: readonly string[]): string {
    return createHash('sha256')
        .update(JSON.stringify(sourceMessageIds))
        .digest('base64url')
        .slice(0, 24)
}

function isLegacyFirstMessageCheckpoint(
    sourceMessageIds: readonly string[]
): boolean {
    return /^first-message:.+:-?\d+$/.test(sourceMessageIds[0] ?? '')
}

function matchesRebootSourceMessageIds(
    checkpoint: readonly string[],
    requested: readonly string[]
): boolean {
    if (JSON.stringify(checkpoint) === JSON.stringify(requested)) return true
    return checkpoint.length === requested.length + 1
        && isLegacyFirstMessageCheckpoint(checkpoint)
        && JSON.stringify(checkpoint.slice(1)) === JSON.stringify(requested)
}

function readableStem(value: string): string {
    return value.normalize('NFKC')
        .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
        .trim()
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .slice(0, 64) || 'entry'
}

function normalizeMarkdown(value: string): { title: string; content: string } {
    let content = required(value, 'Markdown').trim()
        .replace(/^<Thoughts>[\s\S]*?<\/Thoughts>\s*/i, '')
        .replace(/^---\s*\r?\n[\s\S]*?\r?\n---\s*/i, '')
        .trim()
    if (content.length === 0 || content.length > 12_000) {
        throw new Error('Markdown memory must contain 1-12000 characters')
    }
    if (/^#\s+\S+/m.test(content)) {
        content = content.replace(/^(#{1,5})(?=\s)/gm, '$1#')
    }
    const heading = content.match(/^##\s+(.+)$/m)
    const title = (heading?.[1] ?? '서사 기록').trim().slice(0, 160)
    if (!heading) content = `## ${title}\n\n${content}`
    return { title, content }
}

function linksFrom(content: string): string[] {
    return [...content.matchAll(/\[\[([^\]\r\n]{1,240})\]\]/g)]
        .map((match) => match[1])
        .filter((value, index, all) => all.indexOf(value) === index)
        .slice(0, 32)
}

/**
 * Matches the program-owned related-documents heading in every supported
 * writing language, with or without the H3 marker, so both full lines and
 * bare heading text work; legacy ko/en documents and ja documents all stay
 * one section.
 */
function relatedDocumentsHeadingPattern(): RegExp {
    return new RegExp(
        '^#{0,3}\\s*(?:'
        + [...new Set(Object.values(wikiWritingHeadings)
            .map((headings) => headings.related))]
            .map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
            .join('|')
        + ')\\s*$',
        'mi',
    )
}

function appendKnownDocumentLinks(
    content: string,
    documents: readonly MarkdownWikiDocument[],
    selfId: string,
    writingLanguage: WikiWritingLanguage = 'ko'
): string {
    const existingTargets = new Set(linksFrom(content).map((value) =>
        value.split('|')[0]?.split('#')[0]?.normalize('NFKC')
            .toLocaleLowerCase().trim()
    ))
    const searchable = content.normalize('NFKC').toLocaleLowerCase()
    const related = documents.filter((document) => {
        const title = document.title.normalize('NFKC').toLocaleLowerCase().trim()
        return document.id !== selfId
            && document.status === 'active'
            && title.length > 1
            && !/[\[\]\r\n]/.test(document.title)
            && !existingTargets.has(title)
            && searchable.includes(title)
    }).sort((left, right) =>
        right.title.length - left.title.length
        || left.id.localeCompare(right.id)
    ).slice(0, Math.max(0, 32 - existingTargets.size))
    if (related.length === 0) {
        return collapseDuplicateRelatedSections(content)
    }
    const bullets = related.map((document) => `- [[${document.title}]]`)
        .join('\n')
    const heading = `### ${wikiWritingHeadings[normalizeWikiWritingLanguage(writingLanguage)].related}`
    const relatedHeadingPattern = relatedDocumentsHeadingPattern()
    if (relatedHeadingPattern.test(content)) {
        return collapseDuplicateRelatedSections(
            content.replace(
                relatedHeadingPattern,
                () => `${heading}\n\n${bullets}`,
            ),
        )
    }
    return `${content}\n\n${heading}\n\n${bullets}`
}

/**
 * Older saves could append a second localized related-documents section; merge
 * its unique link bullets into the first section and drop the duplicate so
 * section-patch duplicate-heading validation never rejects the document.
 */
function collapseDuplicateRelatedSections(content: string): string {
    const pattern = relatedDocumentsHeadingPattern()
    const first = pattern.exec(content)
    if (!first) return content
    let cursor = first.index + first[0].length
    while (cursor < content.length) {
        const next = pattern.exec(content.slice(cursor))
        if (!next) break
        const start = cursor + next.index
        const following = content.slice(start + next[0].length)
        const nextSection = following.match(/^#{1,6}\s+\S/m)
        const sectionEnd = nextSection?.index !== undefined
            ? start + next[0].length + nextSection.index
            : content.length
        const duplicateBody = following.slice(
            0,
            sectionEnd - start - next[0].length,
        )
        content = content.slice(0, start)
            + content.slice(sectionEnd).replace(/^\s*\r?\n/, '')
        content = mergeRelatedSectionBullets(
            content,
            pattern,
            duplicateBody,
        )
        cursor = first.index + first[0].length
    }
    return content
}

function mergeRelatedSectionBullets(
    content: string,
    pattern: RegExp,
    duplicateBody: string
): string {
    const bullets = [...duplicateBody.matchAll(/^\s*[-*+]\s+\[\[.+?\]\]\s*$/gm)]
        .map((match) => match[0].trim())
        .filter((bullet) => !content.includes(bullet))
    if (bullets.length === 0) return content
    const section = pattern.exec(content)
    if (!section) return content
    const headingEnd = section.index + section[0].length
    const rest = content.slice(headingEnd)
    const nextHeading = rest.match(/^#{1,6}\s+\S/m)
    const sectionBodyEnd = nextHeading?.index !== undefined
        ? headingEnd + nextHeading.index
        : content.length
    const body = content.slice(headingEnd, sectionBodyEnd)
    const existingBullets = [...body.matchAll(/^\s*[-*+]\s+\[\[.+?\]\]\s*$/gm)]
    const insertAfter = existingBullets.at(-1)
    if (insertAfter) {
        const bulletEnd = headingEnd
            + (insertAfter.index ?? 0)
            + insertAfter[0].replace(/\s+$/, '').length
        const tail = content.slice(bulletEnd)
        return content.slice(0, bulletEnd)
            + `\n${bullets.join('\n')}`
            + (tail.startsWith('\n\n') ? tail : `\n${tail}`)
    }
    return content.slice(0, headingEnd)
        + `\n\n${bullets.join('\n')}`
        + rest
}

function parseRebootRecoveryManifest(value: unknown): RebootRecoveryManifest {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new Error('invalid manifest object')
    }
    const record = value as Record<string, unknown>
    const hasReceipt = record.receipt !== undefined
    const expectedKeys = [
        'version', 'created', 'sourceMessageIds', 'eventSourceGroups',
        'documents', ...(hasReceipt ? ['receipt'] : []),
    ]
    const canonicalTypes: readonly string[] = [
        'character', 'location', 'scene', 'faction', 'creature', 'item',
        'concept', 'other',
    ]
    if (Object.keys(record).length !== expectedKeys.length
        || !expectedKeys.every((key) => Object.hasOwn(record, key))
        || record.version !== 1
        || typeof record.created !== 'string'
        || !Array.isArray(record.sourceMessageIds)
        || !record.sourceMessageIds.every((id) => typeof id === 'string')
        || !Array.isArray(record.eventSourceGroups)
        || !record.eventSourceGroups.every((group) => Array.isArray(group)
            && group.every((id) => typeof id === 'string'))
        || !Array.isArray(record.documents)) {
        throw new Error('invalid manifest fields')
    }
    const documents = record.documents.map((value) => {
        if (typeof value !== 'object' || value === null || Array.isArray(value)) {
            throw new Error('invalid manifest document')
        }
        const document = value as Record<string, unknown>
        if (Object.keys(document).length !== 3
            || typeof document.id !== 'string'
            || !canonicalTypes.includes(String(document.type))
            || typeof document.relativePath !== 'string'
            || isAbsolute(document.relativePath)
            || document.relativePath.split(/[\\/]/).includes('..')) {
            throw new Error('invalid manifest document')
        }
        return document as unknown as RebootRecoveryManifest['documents'][number]
    })
    return {
        version: 1,
        created: record.created,
        sourceMessageIds: record.sourceMessageIds as string[],
        eventSourceGroups: record.eventSourceGroups as string[][],
        documents,
        ...(hasReceipt ? {
            receipt: parseCanonicalTurnReceipt(record.receipt),
        } : {}),
    }
}

function removeCharacterEventLinksFromRelatedDocuments(
    content: string,
    documents: readonly MarkdownWikiDocument[]
): string {
    const eventTitles = new Set(documents
        .filter((document) => document.type === 'event')
        .map((document) => document.title.normalize('NFKC')
            .toLocaleLowerCase().trim()))
    if (eventTitles.size === 0) return content
    let inRelatedDocuments = false
    const filtered = content.split(/\r?\n/).filter((line) => {
        const heading = line.match(/^(#{1,6})\s+(.+?)\s*$/)
        if (heading) {
            if (heading[1].length <= 3) {
                inRelatedDocuments = heading[1].length === 3
                    && relatedDocumentsHeadingPattern()
                        .test(heading[2].normalize('NFKC').trim())
            }
            return true
        }
        if (!inRelatedDocuments) return true
        const bullet = line.match(/^\s*[-*+]\s+\[\[([^\]|#]+)(?:[^\]]*)\]\]\s*$/)
        if (!bullet) return true
        return !eventTitles.has(bullet[1].normalize('NFKC')
            .toLocaleLowerCase().trim())
    })
    const relatedHeading = filtered.findIndex((line) =>
        relatedDocumentsHeadingPattern().test(line))
    if (relatedHeading >= 0) {
        const nextSection = filtered.findIndex((line, index) =>
            index > relatedHeading && /^#{1,3}\s+\S/.test(line))
        const sectionEnd = nextSection >= 0 ? nextSection : filtered.length
        if (filtered.slice(relatedHeading + 1, sectionEnd)
            .every((line) => line.trim().length === 0)) {
            filtered.splice(relatedHeading, sectionEnd - relatedHeading)
        }
    }
    return filtered.join('\n').trim()
}

function hashDocumentBytes(contents: string): string {
    return createHash('sha256').update(contents).digest('base64url')
}

function prepareDocument(
    document: Omit<MarkdownWikiDocument, 'contentHash' | 'aliases'> & {
        aliases?: string[]
    }
): { document: MarkdownWikiDocument; contents: string } {
    const normalizedDocument: Omit<MarkdownWikiDocument, 'contentHash'> = {
        ...document,
        aliases: normalizeAliases(document.aliases, document.title),
    }
    const contents = serializeDocument(normalizedDocument)
    return {
        document: {
            ...normalizedDocument,
            contentHash: hashDocumentBytes(contents),
        },
        contents,
    }
}

function serializeDocument(
    document: Omit<MarkdownWikiDocument, 'contentHash'>
): string {
    return [
        '---',
        `id: ${yamlString(document.id)}`,
        `type: ${document.type}`,
        `status: ${document.status}`,
        ...(document.supersededBy
            ? [`superseded_by: ${yamlString(document.supersededBy)}`]
            : []),
        ...(document.created
            ? [`created: ${yamlString(document.created)}`]
            : []),
        `updated: ${yamlString(document.updated)}`,
        ...(document.authoring
            ? [`authoring: ${document.authoring}`]
            : []),
        ...(document.reviewStatus
            ? [`review_status: ${document.reviewStatus}`]
            : []),
        `context: ${document.contextMode}`,
        'aliases:',
        ...document.aliases.map((alias) => `  - ${yamlString(alias)}`),
        'source_messages:',
        ...document.sourceMessageIds.map((id) => `  - ${yamlString(id)}`),
        'links:',
        ...document.links.map((link) => `  - ${yamlString(link)}`),
        '---',
        '',
        document.content,
        '',
    ].join('\n')
}

function parseDocument(
    contents: string,
    relativePath: string
): MarkdownWikiDocument {
    const boundary = contents.indexOf('\n---\n', 4)
    if (!contents.startsWith('---\n') || boundary < 0) {
        throw new Error('Invalid Markdown wiki frontmatter')
    }
    const frontmatter = contents.slice(4, boundary)
    const storedContent = contents.slice(boundary + 5).trim()
    const scalar = (key: string): string => {
        const match = frontmatter.match(new RegExp(`^${key}: (.+)$`, 'm'))
        if (!match) throw new Error(`Missing Markdown wiki ${key}`)
        return JSON.parse(match[1])
    }
    const plainScalar = (key: string): string => {
        const match = frontmatter.match(new RegExp(`^${key}: (.+)$`, 'm'))
        if (!match) throw new Error(`Missing Markdown wiki ${key}`)
        return match[1].trim()
    }
    const list = (key: string): string[] => {
        const match = frontmatter.match(
            new RegExp(`^${key}:\\n((?:  - .+\\n?)*)`, 'm')
        )
        if (!match) return []
        return match[1].trim().length === 0
            ? []
            : match[1].trim().split('\n').map((line) =>
                JSON.parse(line.trim().replace(/^-\s+/, ''))
            )
    }
    const storedTitle = storedContent.match(/^#{1,2}\s+(.+)$/m)?.[1]?.trim()
    const normalized = normalizeMarkdown(storedContent)
    const type = plainScalar('type')
    if (![
        'event', 'character', 'location', 'scene', 'faction', 'creature',
        'item', 'concept', 'other',
    ].includes(type)) {
        throw new Error('Invalid Markdown wiki type')
    }
    const optionalScalar = (key: string): string | undefined => {
        const match = frontmatter.match(new RegExp(`^${key}: (.+)$`, 'm'))
        if (!match) return undefined
        try { return JSON.parse(match[1]) }
        catch { return match[1].trim() }
    }
    const updated = scalar('updated')
    const authoring = optionalScalar('authoring')
    const context = optionalScalar('context')
    const reviewStatus = optionalScalar('review_status')
    if (reviewStatus !== undefined
        && reviewStatus !== 'unreviewed'
        && reviewStatus !== 'reviewed') {
        throw new Error('Invalid Markdown wiki review status')
    }
    const defaultContext: MarkdownWikiContextMode = type === 'scene'
        ? 'always'
        : 'auto'
    const status = plainScalar('status')
    if (status !== 'active'
        && status !== 'superseded'
        && status !== 'retracted') {
        throw new Error('Invalid Markdown wiki status')
    }
    return {
        id: scalar('id'),
        type: type as MarkdownWikiDocument['type'],
        status,
        ...(status === 'superseded'
            ? { supersededBy: required(
                optionalScalar('superseded_by') ?? '',
                'Markdown wiki supersededBy'
            ) }
            : {}),
        title: required(storedTitle ?? '', 'Markdown wiki title'),
        aliases: normalizeAliases(list('aliases'), storedTitle ?? ''),
        relativePath,
        sourceMessageIds: list('source_messages'),
        updated,
        content: normalized.content,
        links: list('links'),
        created: optionalScalar('created') ?? updated,
        authoring: (['automatic', 'ai-assisted', 'manual'].includes(
            authoring ?? ''
        ) ? authoring : type === 'event' ? 'automatic' : 'ai-assisted') as
            MarkdownWikiDocument['authoring'],
        contextMode: (['always', 'auto', 'never'].includes(context ?? '')
            ? context
            : defaultContext) as MarkdownWikiContextMode,
        contentHash: hashDocumentBytes(contents),
        ...(reviewStatus ? {
            reviewStatus: reviewStatus as 'unreviewed' | 'reviewed',
        } : {}),
    }
}

function computeHealth(documents: MarkdownWikiDocument[]): MarkdownWikiHealth {
    const possibleTargets = new Map<string, MarkdownWikiDocument | null>()
    for (const document of documents) {
        const pathWithoutExtension = document.relativePath.replace(/\.md$/i, '')
        const fileName = basename(pathWithoutExtension)
        for (const value of [
            document.title,
            ...document.aliases,
            pathWithoutExtension,
            fileName,
        ]) {
            const key = value.normalize('NFKC').toLocaleLowerCase()
            const existing = possibleTargets.get(key)
            possibleTargets.set(
                key,
                existing && existing.id !== document.id ? null : document
            )
        }
    }
    const byTarget = new Map([...possibleTargets.entries()]
        .filter((entry): entry is [string, MarkdownWikiDocument] =>
            entry[1] !== null))
    const connected = new Set<string>()
    const danglingLinks: MarkdownWikiHealth['danglingLinks'] = []
    for (const document of documents) {
        for (const rawLink of document.links) {
            const target = rawLink.split('|')[0]?.split('#')[0]?.trim() ?? ''
            if (!target) continue
            const resolved = byTarget.get(
                target.normalize('NFKC').toLocaleLowerCase()
            )
            if (!resolved) {
                if (danglingLinks.length < 64) {
                    danglingLinks.push({ sourceId: document.id, target })
                }
                continue
            }
            if (resolved.id === document.id) continue
            connected.add(document.id)
            connected.add(resolved.id)
        }
    }
    const passageDocuments = new Map<string, Set<string>>()
    for (const document of documents) {
        if (document.status !== 'active' || document.type === 'scene') continue
        const passages = new Set(document.content.split(/\r?\n\s*\r?\n/)
            .map((passage) => passage.trim())
            .filter((passage) => passage.length > 0
                && !/^#{1,6}\s/u.test(passage)
                && passage.replace(/\[\[[^\]]+\]\]/g, '')
                    .replace(/[\s\-*•,;:|]+/gu, '').length > 0)
            .map((passage) => passage.normalize('NFKC').toLocaleLowerCase()
                .replace(/\s+/gu, ' ').trim())
            .filter((passage) => Array.from(passage).length >= 80))
        for (const passage of passages) {
            const owners = passageDocuments.get(passage) ?? new Set<string>()
            owners.add(document.id)
            passageDocuments.set(passage, owners)
        }
    }
    const duplicatePairKeys = new Set<string>()
    const duplicatePassages: MarkdownWikiHealth['duplicatePassages'] = []
    for (const owners of passageDocuments.values()) {
        const ids = [...owners].sort()
        for (let left = 0; left < ids.length; left += 1) {
            for (let right = left + 1; right < ids.length; right += 1) {
                const documentIds: [string, string] = [ids[left], ids[right]]
                const key = documentIds.join('\n')
                if (duplicatePairKeys.has(key)) continue
                duplicatePairKeys.add(key)
                duplicatePassages.push({ documentIds })
            }
        }
    }
    duplicatePassages.sort((left, right) =>
        left.documentIds.join('\n').localeCompare(right.documentIds.join('\n'))
    )
    return {
        danglingLinks,
        duplicatePassages: duplicatePassages.slice(0, 64),
        unlinkedDocumentIds: documents
            .filter((document) => document.type !== 'event'
                && document.type !== 'scene'
                && !connected.has(document.id))
            .map((document) => document.id)
            .sort()
            .slice(0, 64),
    }
}

async function writeAtomically(
    fileSystem: WikiFileSystem,
    file: string,
    contents: string
): Promise<void> {
    const temporary = `${file}.tmp-${randomUUID()}`
    try {
        await fileSystem.writeFile(temporary, contents, {
            encoding: 'utf8',
            flag: 'wx',
            mode: 0o600,
        })
        await fileSystem.rename(temporary, file)
    }
    catch (error) {
        await fileSystem.rm(temporary, { force: true }).catch(() => undefined)
        throw error
    }
}

export function resolveMarkdownWikiWorkspace(
    userDataDirectory: string,
    characterId: string,
    chatId: string
): MarkdownWikiWorkspace {
    if (!isAbsolute(required(userDataDirectory, 'userDataDirectory'))) {
        throw new Error('userDataDirectory must be absolute')
    }
    const memory = resolveMemoryWorkspace(
        userDataDirectory,
        characterId,
        chatId
    )
    const directory = resolve(memory.directory, 'wiki')
    return {
        directory,
        eventsDirectory: resolve(directory, 'events'),
        charactersDirectory: resolve(directory, 'characters'),
        locationsDirectory: resolve(directory, 'locations'),
        historyDirectory: resolve(directory, '.risubard-history'),
        trashDirectory: resolve(directory, '.risubard-trash'),
        snapshotsDirectory: resolve(directory, '.risubard-snapshots'),
        recoveryDirectory: resolve(directory, '.risubard-recovery'),
        reviewDirectory: resolve(directory, '.risubard-review'),
        sceneFile: resolve(directory, 'current-scene.md'),
        indexFile: resolve(directory, 'index.md'),
    }
}

export function createMarkdownNarrativeWiki(
    userDataDirectory: string,
    options: {
        fileSystem?: WikiFileSystem
        now?: () => Date
    } = {}
) {
    const fileSystem = options.fileSystem ?? nodeFs
    const now = options.now ?? (() => new Date())
    const workspaceFor = (characterId: string, chatId: string) =>
        resolveMarkdownWikiWorkspace(userDataDirectory, characterId, chatId)
    const documentCache = new Map<string, MarkdownWikiDocument[]>()
    type BardChatUndoFile = { relativePath: string; contents: string }
    type BardChatUndoSnapshot = {
        characterId: string
        chatId: string
        files: BardChatUndoFile[]
        signature: string
    }
    let bardChatUndoSnapshot: BardChatUndoSnapshot | null = null
    let pendingBardChatUndo: Omit<BardChatUndoSnapshot, 'signature'> & {
        beforeSignature: string
    } | null = null

    const cleanupLegacySnapshots = async (
        characterId: string,
        chatId: string
    ): Promise<void> => {
        const memory = resolveMemoryWorkspace(
            userDataDirectory,
            characterId,
            chatId
        )
        const workspace = workspaceFor(characterId, chatId)
        let memoryStatus: Awaited<ReturnType<WikiFileSystem['lstat']>>
        let wikiStatus: Awaited<ReturnType<WikiFileSystem['lstat']>>
        try {
            memoryStatus = await fileSystem.lstat(memory.directory)
            wikiStatus = await fileSystem.lstat(workspace.directory)
        }
        catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
            throw error
        }
        if (memoryStatus.isSymbolicLink() || !memoryStatus.isDirectory()
            || wikiStatus.isSymbolicLink() || !wikiStatus.isDirectory()) {
            throw new Error('Wiki workspace is unsafe')
        }
        const [realMemory, realWiki] = await Promise.all([
            fileSystem.realpath(memory.directory),
            fileSystem.realpath(workspace.directory),
        ])
        const relation = relative(realMemory, realWiki)
        if (relation === '' || isAbsolute(relation) || relation === '..'
            || relation.startsWith(`..${process.platform === 'win32'
                ? '\\' : '/'}`)) {
            throw new Error('Wiki workspace escapes its memory workspace')
        }
        let snapshotsStatus: Awaited<ReturnType<WikiFileSystem['lstat']>>
        try {
            snapshotsStatus = await fileSystem.lstat(
                workspace.snapshotsDirectory
            )
        }
        catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
            throw error
        }
        if (snapshotsStatus.isSymbolicLink()) {
            await fileSystem.rm(workspace.snapshotsDirectory, { force: true })
            return
        }
        await fileSystem.rm(workspace.snapshotsDirectory, {
            recursive: snapshotsStatus.isDirectory(),
            force: true,
        })
    }

    const recoveryPaths = (workspace: MarkdownWikiWorkspace) => ({
        published: join(workspace.recoveryDirectory, 'reboot-batch'),
        creating: join(workspace.recoveryDirectory, 'reboot-batch.creating'),
    })

    const removeRecoveryArtifact = async (path: string): Promise<void> => {
        let status: Awaited<ReturnType<WikiFileSystem['lstat']>>
        try {
            status = await fileSystem.lstat(path)
        }
        catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
            throw error
        }
        await fileSystem.rm(path, {
            recursive: status.isDirectory() && !status.isSymbolicLink(),
            force: true,
        })
    }

    const hasPublishedRecovery = async (
        workspace: MarkdownWikiWorkspace
    ): Promise<boolean> => {
        const { published } = recoveryPaths(workspace)
        try {
            const status = await fileSystem.lstat(published)
            if (status.isSymbolicLink() || !status.isDirectory()) {
                throw new Error('Wiki reboot recovery checkpoint is unsafe')
            }
            return true
        }
        catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
            throw error
        }
    }

    const cleanupUnpublishedRecovery = async (
        workspace: MarkdownWikiWorkspace
    ): Promise<boolean> => {
        if (await hasPublishedRecovery(workspace)) return false
        await removeRecoveryArtifact(recoveryPaths(workspace).creating)
        return true
    }

    const readDocuments = async (
        characterId: string,
        chatId: string
    ): Promise<MarkdownWikiDocument[]> => {
        const workspace = workspaceFor(characterId, chatId)
        const documents: MarkdownWikiDocument[] = []
        const folders = [
            [workspace.charactersDirectory, 'characters'],
            [workspace.locationsDirectory, 'locations'],
            [resolve(workspace.directory, 'factions'), 'factions'],
            [resolve(workspace.directory, 'creatures'), 'creatures'],
            [resolve(workspace.directory, 'items'), 'items'],
            [resolve(workspace.directory, 'concepts'), 'concepts'],
            [resolve(workspace.directory, 'notes'), 'notes'],
            [workspace.eventsDirectory, 'events'],
        ] as const
        try {
            documents.push(parseDocument(
                await fileSystem.readFile(workspace.sceneFile, 'utf8'),
                'current-scene.md'
            ))
        }
        catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        }
        for (const [directory, prefix] of folders) {
            let files: string[]
            try {
                files = (await fileSystem.readdir(directory))
                    .filter((file) => file.endsWith('.md'))
                    .sort()
            }
            catch (error) {
                if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
                throw error
            }
            const loaded = await Promise.all(files.map(async (file) => ({
                file: join(directory, basename(file)),
                document: parseDocument(
                    await fileSystem.readFile(
                        join(directory, basename(file)),
                        'utf8'
                    ),
                    `${prefix}/${file}`
                ),
            })))
            for (const item of loaded) {
                if (item.document.type === 'event'
                    && item.document.status === 'retracted') {
                    await fileSystem.rm(item.file, { force: true })
                    continue
                }
                documents.push(item.document)
            }
        }
        return documents
    }

    const refreshDocuments = async (
        characterId: string,
        chatId: string
    ): Promise<MarkdownWikiDocument[]> => {
        await cleanupLegacySnapshots(characterId, chatId)
        const documents = await readDocuments(characterId, chatId)
        documentCache.set(workspaceFor(characterId, chatId).directory, documents)
        return documents
    }

    const loadDocuments = async (
        characterId: string,
        chatId: string
    ): Promise<MarkdownWikiDocument[]> => {
        const workspace = workspaceFor(characterId, chatId)
        await cleanupLegacySnapshots(characterId, chatId)
        const key = workspace.directory
        return documentCache.get(key)
            ?? refreshDocuments(characterId, chatId)
    }

    const snapshotSignature = (
        documents: readonly MarkdownWikiDocument[]
    ): string => createHash('sha256').update(JSON.stringify(
        [...documents]
            .sort((left, right) => left.relativePath.localeCompare(right.relativePath))
            .map((document) => [
                document.id, document.relativePath, document.contentHash,
            ])
    )).digest('base64url')

    const captureBardChatFiles = async (
        characterId: string,
        chatId: string
    ): Promise<{ files: BardChatUndoFile[]; signature: string }> => {
        const workspace = workspaceFor(characterId, chatId)
        const documents = await refreshDocuments(characterId, chatId)
        return {
            signature: snapshotSignature(documents),
            files: await Promise.all(documents.map(async (document) => ({
                relativePath: document.relativePath,
                contents: await fileSystem.readFile(join(
                    workspace.directory,
                    ...document.relativePath.split('/')
                ), 'utf8'),
            }))),
        }
    }

    const rebuildIndex = async (
        characterId: string,
        chatId: string,
        writingLanguage?: WikiWritingLanguage
    ): Promise<void> => {
        const workspace = workspaceFor(characterId, chatId)
        const documents = await refreshDocuments(characterId, chatId)
        const indexLanguage = writingLanguage ?? (
            documents.some((document) => /^###\s+(物語要約|作中行動|関連文書)\s*$/mi.test(document.content))
                && !documents.some((document) => /^###\s+(이야기 요약|Story Summary)\s*$/mi.test(document.content))
                ? 'ja'
                : documents.some((document) => /^###\s+(Story Summary|Story History|Related Documents)\s*$/mi.test(document.content))
                    && !documents.some((document) => /^###\s+이야기 요약\s*$/m.test(document.content))
                ? 'en' : 'ko'
        )
        const index = [
            '---',
            'type: narrative_wiki_index',
            'status: active',
            '---',
            '',
            indexLanguage === 'en' ? '## Narrative Wiki'
                : indexLanguage === 'ja' ? '## ナラティブウィキ'
                : '## 서사 위키',
            '',
            ...documents.map((item) =>
                `- [[${item.relativePath.replace(/\.md$/, '')}|${item.title}]]`
            ),
            '',
        ].join('\n')
        await writeAtomically(fileSystem, workspace.indexFile, index)
    }

    return {
        invalidateCache(characterId: string, chatId: string): void {
            documentCache.delete(workspaceFor(characterId, chatId).directory)
        },
        async beginBardChatUndo(input: {
            characterId: string
            chatId: string
        }): Promise<{ started: true }> {
            const characterId = required(input.characterId, 'Character ID')
            const chatId = required(input.chatId, 'Chat ID')
            const captured = await captureBardChatFiles(characterId, chatId)
            pendingBardChatUndo = {
                characterId,
                chatId,
                files: captured.files,
                beforeSignature: captured.signature,
            }
            return { started: true }
        },
        async finalizeBardChatUndo(input: {
            characterId: string
            chatId: string
        }): Promise<{ available: boolean }> {
            const characterId = required(input.characterId, 'Character ID')
            const chatId = required(input.chatId, 'Chat ID')
            const pending = pendingBardChatUndo
            if (!pending || pending.characterId !== characterId
                || pending.chatId !== chatId) {
                throw new Error('BARDCHAT undo snapshot was not started')
            }
            const current = await captureBardChatFiles(characterId, chatId)
            if (current.signature !== pending.beforeSignature) {
                bardChatUndoSnapshot = {
                    characterId,
                    chatId,
                    files: pending.files,
                    signature: current.signature,
                }
            }
            pendingBardChatUndo = null
            return {
                available: bardChatUndoSnapshot?.characterId === characterId
                    && bardChatUndoSnapshot.chatId === chatId,
            }
        },
        async getBardChatUndoStatus(input: {
            characterId: string
            chatId: string
        }): Promise<{ available: boolean }> {
            const characterId = required(input.characterId, 'Character ID')
            const chatId = required(input.chatId, 'Chat ID')
            return {
                available: bardChatUndoSnapshot?.characterId === characterId
                    && bardChatUndoSnapshot.chatId === chatId,
            }
        },
        async restoreBardChatUndo(input: {
            characterId: string
            chatId: string
        }): Promise<{ restored: true }> {
            const characterId = required(input.characterId, 'Character ID')
            const chatId = required(input.chatId, 'Chat ID')
            const snapshot = bardChatUndoSnapshot
            if (!snapshot || snapshot.characterId !== characterId
                || snapshot.chatId !== chatId) {
                throw new Error('No BARDCHAT undo snapshot is available')
            }
            const workspace = workspaceFor(characterId, chatId)
            const current = await refreshDocuments(characterId, chatId)
            if (snapshotSignature(current) !== snapshot.signature) {
                throw new Error('Wiki changed after the BARDCHAT command')
            }
            const baselinePaths = new Set(snapshot.files.map((file) =>
                file.relativePath
            ))
            for (const file of snapshot.files) {
                const target = join(
                    workspace.directory,
                    ...file.relativePath.split('/')
                )
                await fileSystem.mkdir(resolve(target, '..'), { recursive: true })
                await writeAtomically(fileSystem, target, file.contents)
            }
            for (const document of current) {
                if (baselinePaths.has(document.relativePath)) continue
                await fileSystem.rm(join(
                    workspace.directory,
                    ...document.relativePath.split('/')
                ), { force: true })
            }
            await rebuildIndex(characterId, chatId)
            bardChatUndoSnapshot = null
            pendingBardChatUndo = null
            return { restored: true }
        },
        async recoverRebootBatch(input: {
            characterId: string
            chatId: string
            sourceMessageIds: string[]
            eventSourceGroups: string[][]
        }): Promise<CanonicalTurnReceipt | null> {
            const sourceMessageIds = input.sourceMessageIds.map((id) =>
                required(id, 'Source message ID')
            )
            if (sourceMessageIds.length < 1 || sourceMessageIds.length > 12
                || input.eventSourceGroups.length < 1
                || input.eventSourceGroups.length > 2) {
                throw new Error('Invalid reboot recovery sources')
            }
            const eventSourceGroups = input.eventSourceGroups.map((group) => {
                const normalized = group.map((id) =>
                    required(id, 'Event source message ID')
                )
                if (normalized.length < 1 || normalized.length > 2) {
                    throw new Error('Invalid reboot event source group')
                }
                return normalized
            })
            const workspace = workspaceFor(input.characterId, input.chatId)
            const recoveryDirectory = recoveryPaths(workspace).published
            const manifestFile = join(recoveryDirectory, 'manifest.json')
            let manifest: RebootRecoveryManifest
            try {
                manifest = parseRebootRecoveryManifest(JSON.parse(
                    await fileSystem.readFile(
                    manifestFile,
                    'utf8'
                )))
            }
            catch (error) {
                if ((error as NodeJS.ErrnoException).code === 'ENOENT'
                    && await cleanupUnpublishedRecovery(workspace)) return null
                throw error
            }
            const sourceMatches = matchesRebootSourceMessageIds(
                manifest.sourceMessageIds,
                sourceMessageIds
            )
            const eventGroupsMatch = JSON.stringify(manifest.eventSourceGroups)
                === JSON.stringify(eventSourceGroups)
            if (manifest.receipt
                && isLegacyFirstMessageCheckpoint(manifest.sourceMessageIds)
                && (!sourceMatches || !eventGroupsMatch)) {
                await fileSystem.rm(recoveryDirectory, {
                    recursive: true,
                    force: true,
                })
                return null
            }
            if (manifest.version !== 1
                || !sourceMatches
                || !eventGroupsMatch
                || !Array.isArray(manifest.documents)) {
                throw new Error('Wiki reboot recovery checkpoint is invalid')
            }
            if (manifest.receipt) {
                return parseCanonicalTurnReceipt(manifest.receipt)
            }
            const current = await loadDocuments(
                input.characterId,
                input.chatId
            )
            const baselineCanonical = new Map(manifest.documents.map(
                (document) => [document.id, document]
            ))
            const exactEventSources = new Set(eventSourceGroups.map((group) =>
                JSON.stringify(group)
            ))
            for (const document of current) {
                const removeEvent = document.type === 'event'
                    && exactEventSources.has(JSON.stringify(
                        document.sourceMessageIds
                    ))
                const removeCreatedCanonical = document.type !== 'event'
                    && !baselineCanonical.has(document.id)
                const baseline = baselineCanonical.get(document.id)
                const removeMovedCanonical = Boolean(baseline
                    && baseline.relativePath !== document.relativePath)
                if (removeEvent || removeCreatedCanonical
                    || removeMovedCanonical) {
                    await fileSystem.rm(join(
                        workspace.directory,
                        ...document.relativePath.split('/')
                    ), { force: true })
                }
            }
            for (const document of baselineCanonical.values()) {
                const source = join(
                    recoveryDirectory,
                    ...document.relativePath.split('/')
                )
                const target = join(
                    workspace.directory,
                    ...document.relativePath.split('/')
                )
                await fileSystem.mkdir(resolve(target, '..'), {
                    recursive: true,
                })
                await writeAtomically(
                    fileSystem,
                    target,
                    await fileSystem.readFile(source, 'utf8')
                )
            }
            await rebuildIndex(input.characterId, input.chatId)
            await fileSystem.rm(recoveryDirectory, {
                recursive: true,
                force: true,
            })
            return null
        },
        async beginRebootBatch(input: {
            characterId: string
            chatId: string
            sourceMessageIds: string[]
            eventSourceGroups: string[][]
        }): Promise<{ canonicalCount: number }> {
            const sourceMessageIds = input.sourceMessageIds.map((id) =>
                required(id, 'Source message ID')
            )
            const eventSourceGroups = input.eventSourceGroups.map((group) =>
                group.map((id) => required(id, 'Event source message ID'))
            )
            if (sourceMessageIds.length < 1 || sourceMessageIds.length > 12
                || eventSourceGroups.length < 1
                || eventSourceGroups.length > 2
                || eventSourceGroups.some((group) =>
                    group.length < 1 || group.length > 2)) {
                throw new Error('Invalid reboot recovery sources')
            }
            const workspace = workspaceFor(input.characterId, input.chatId)
            const documents = await loadDocuments(input.characterId, input.chatId)
            const canonical = documents.filter((document) =>
                document.type !== 'event'
            )
            const {
                published: recoveryDirectory,
                creating: creatingDirectory,
            } = recoveryPaths(workspace)
            const manifestFile = join(recoveryDirectory, 'manifest.json')
            try {
                const existing = parseRebootRecoveryManifest(JSON.parse(
                    await fileSystem.readFile(manifestFile, 'utf8')
                ))
                try {
                    await Promise.all(existing.documents.map((document) =>
                        fileSystem.readFile(join(
                            recoveryDirectory,
                            ...document.relativePath.split('/')
                        ))
                    ))
                }
                catch (error) {
                    throw new Error(
                        'Wiki reboot recovery conflict: existing checkpoint is invalid',
                        { cause: error }
                    )
                }
                if (existing.receipt) {
                    throw new Error(
                        'Wiki reboot recovery conflict: completed batch awaits cleanup'
                    )
                }
                throw new Error(
                    'Wiki reboot recovery conflict: checkpoint already in flight'
                )
            }
            catch (error) {
                if (error instanceof Error
                    && error.message.startsWith(
                        'Wiki reboot recovery conflict:'
                    )) throw error
                if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
                    throw new Error(
                        'Wiki reboot recovery conflict: existing checkpoint is invalid',
                        { cause: error }
                    )
                }
                if (!await cleanupUnpublishedRecovery(workspace)) {
                    throw new Error(
                        'Wiki reboot recovery conflict: checkpoint manifest is missing'
                    )
                }
            }
            await fileSystem.mkdir(creatingDirectory, { recursive: true })
            try {
                for (const document of canonical) {
                    const target = join(
                        creatingDirectory,
                        ...document.relativePath.split('/')
                    )
                    await fileSystem.mkdir(resolve(target, '..'), {
                        recursive: true,
                    })
                    await writeAtomically(
                        fileSystem,
                        target,
                        await fileSystem.readFile(join(
                            workspace.directory,
                            ...document.relativePath.split('/')
                        ), 'utf8')
                    )
                }
                await writeAtomically(
                    fileSystem,
                    join(creatingDirectory, 'manifest.json'),
                    `${JSON.stringify({
                        version: 1,
                        created: now().toISOString(),
                        sourceMessageIds,
                        eventSourceGroups,
                        documents: canonical.map((document) => ({
                            id: document.id,
                            type: document.type,
                            relativePath: document.relativePath,
                        })),
                    }, null, 2)}\n`
                )
                await fileSystem.rename(creatingDirectory, recoveryDirectory)
            }
            catch (error) {
                await removeRecoveryArtifact(creatingDirectory)
                    .catch(() => undefined)
                throw error
            }
            return { canonicalCount: canonical.length }
        },

        async recordRebootBatchReceipt(input: {
            characterId: string
            chatId: string
            receipt: CanonicalTurnReceipt
        }): Promise<CanonicalTurnReceipt> {
            const receipt = parseCanonicalTurnReceipt(input.receipt)
            const workspace = workspaceFor(input.characterId, input.chatId)
            const manifestFile = join(
                workspace.recoveryDirectory,
                'reboot-batch',
                'manifest.json'
            )
            const manifest = parseRebootRecoveryManifest(JSON.parse(
                await fileSystem.readFile(manifestFile, 'utf8')
            ))
            if (manifest.version !== 1
                || JSON.stringify(manifest.sourceMessageIds)
                    !== JSON.stringify(receipt.sourceMessageIds)
                || !Array.isArray(manifest.documents)
                || !Array.isArray(manifest.eventSourceGroups)) {
                throw new Error('Wiki reboot recovery checkpoint is invalid')
            }
            manifest.receipt = receipt
            await writeAtomically(
                fileSystem,
                manifestFile,
                `${JSON.stringify(manifest, null, 2)}\n`
            )
            return receipt
        },

        async completeRebootBatch(input: {
            characterId: string
            chatId: string
            sourceMessageIds: string[]
        }): Promise<{ removed: boolean }> {
            const workspace = workspaceFor(input.characterId, input.chatId)
            const recoveryDirectory = join(
                workspace.recoveryDirectory,
                'reboot-batch'
            )
            const sourceMessageIds = input.sourceMessageIds.map((id) =>
                required(id, 'Source message ID')
            )
            let manifest: RebootRecoveryManifest
            try {
                manifest = parseRebootRecoveryManifest(JSON.parse(
                    await fileSystem.readFile(
                    join(recoveryDirectory, 'manifest.json'),
                    'utf8'
                )))
            }
            catch (error) {
                if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
                    return { removed: false }
                }
                throw error
            }
            if (manifest.version !== 1
                || !matchesRebootSourceMessageIds(
                    manifest.sourceMessageIds,
                    sourceMessageIds
                )) {
                throw new Error('Wiki reboot recovery checkpoint does not match')
            }
            await fileSystem.rm(recoveryDirectory, {
                recursive: true,
                force: true,
            })
            return { removed: true }
        },

        async resolveDocumentFile(input: {
            characterId: string
            chatId: string
            documentId: string
        }): Promise<string> {
            const document = (await loadDocuments(
                input.characterId,
                input.chatId
            )).find((item) => item.id === input.documentId)
            if (!document) throw new Error('Wiki document does not exist')
            const workspace = workspaceFor(input.characterId, input.chatId)
            return join(
                workspace.directory,
                ...document.relativePath.split('/')
            )
        },

        async saveConfirmedTurn(input: {
            characterId: string
            chatId: string
            sourceMessageIds: string[]
            markdown: string
            append?: boolean
            writingLanguage?: WikiWritingLanguage
        }): Promise<MarkdownWikiDocument> {
            const sourceMessageIds = input.sourceMessageIds.map((id) =>
                required(id, 'sourceMessageId')
            )
            if (sourceMessageIds.length === 0) {
                throw new Error('Markdown memory requires at least one source')
            }
            const workspace = workspaceFor(input.characterId, input.chatId)
            await fileSystem.mkdir(workspace.eventsDirectory, {
                recursive: true,
            })
            const knownDocuments = await loadDocuments(
                input.characterId,
                input.chatId
            )
            let normalized = normalizeMarkdown(input.markdown)
            const suffix = stableId(sourceMessageIds)
            const file = `turn-${suffix}.md`
            const operationTime = now().toISOString()
            const existingEvent = input.append
                ? knownDocuments
                    .find((document) => document.id === `event.${suffix}`)
                : undefined
            const previousLanguage = existingEvent ? detectWikiWritingLanguage(existingEvent.content) : undefined
            const writingLanguage = normalizeWikiWritingLanguage(input.writingLanguage
                ?? previousLanguage ?? detectWikiWritingLanguage(normalized.content))
            normalized = normalizeMarkdown(localizeWikiHeadings(normalized.content, writingLanguage))
            if (existingEvent?.type === 'event') {
                if (previousLanguage && writingLanguage !== previousLanguage) {
                    throw new Error('Wiki writing language differs from the existing event; reboot the wiki to change its language.')
                }
                const addition = normalized.content.replace(
                    /^##\s+[^\r\n]+\r?\n*/,
                    ''
                ).trim()
                normalized = normalizeMarkdown([
                    existingEvent.content,
                    `### ${wikiWritingHeadings[writingLanguage].additional}`,
                    addition,
                ].filter(Boolean).join('\n\n'))
            }
            normalized = normalizeMarkdown(appendKnownDocumentLinks(
                normalized.content,
                knownDocuments,
                `event.${suffix}`,
                writingLanguage
            ))
            const prepared = prepareDocument({
                id: `event.${suffix}`,
                type: 'event',
                status: 'active',
                title: normalized.title,
                aliases: existingEvent?.aliases ?? [],
                relativePath: `events/${file}`,
                sourceMessageIds,
                updated: operationTime,
                content: normalized.content,
                links: linksFrom(normalized.content),
                created: existingEvent?.created ?? operationTime,
                authoring: 'automatic',
                contextMode: 'auto',
            })
            await writeAtomically(
                fileSystem,
                join(workspace.eventsDirectory, file),
                prepared.contents
            )
            await rebuildIndex(input.characterId, input.chatId, writingLanguage)
            return prepared.document
        },

        async saveCanonicalDocument(input: {
            characterId: string
            chatId: string
            documentId?: string
            type: CanonicalMarkdownWikiDocumentType
            title: string
            aliases?: string[]
            sourceMessageIds: string[]
            markdown: string
            expectedContentHash?: string
            reviewStatus?: 'unreviewed' | 'reviewed'
            writingLanguage?: WikiWritingLanguage
        }): Promise<MarkdownWikiDocument> {
            const title = required(input.title, 'Title').trim().slice(0, 160)
            const incomingSources = input.sourceMessageIds.map((id) =>
                required(id, 'sourceMessageId')
            )
            if (incomingSources.length === 0) {
                throw new Error('Canonical wiki document requires at least one source')
            }
            const workspace = workspaceFor(input.characterId, input.chatId)
            const documents = await loadDocuments(
                input.characterId,
                input.chatId
            )
            const existing = input.documentId
                ? documents.find((document) =>
                    document.id === input.documentId)
                : undefined
            if (input.documentId && !existing) {
                throw new Error('Canonical wiki document does not exist')
            }
            if (existing && existing.type !== input.type) {
                throw new Error('Canonical wiki document type cannot change')
            }
            if (existing && input.expectedContentHash
                && existing.contentHash !== input.expectedContentHash) {
                throw new Error(
                    'Wiki document changed since the draft was created'
                )
            }
            const suffix = existing?.id.split('.').at(-1)
                ?? stableId([input.type, title.normalize('NFKC').toLocaleLowerCase()])
            const id = existing?.id ?? `${input.type}.${suffix}`
            const folder: Record<CanonicalMarkdownWikiDocumentType, string> = {
                character: 'characters',
                location: 'locations',
                scene: '',
                faction: 'factions',
                creature: 'creatures',
                item: 'items',
                concept: 'concepts',
                other: 'notes',
            }
            const relativePath = existing?.relativePath
                ?? (input.type === 'scene'
                    ? 'current-scene.md'
                    : `${folder[input.type]}/${readableStem(title)}-${suffix}.md`)
            const file = input.type === 'scene'
                ? workspace.sceneFile
                : join(workspace.directory, ...relativePath.split('/'))
            const operationTime = now().toISOString()
            await fileSystem.mkdir(resolve(file, '..'), { recursive: true })
            const reviewFile = join(
                workspace.reviewDirectory,
                `${stableId([id])}.md`
            )
            if (input.reviewStatus === 'unreviewed'
                && existing?.reviewStatus !== 'unreviewed') {
                await fileSystem.mkdir(workspace.reviewDirectory, {
                    recursive: true,
                })
                await writeAtomically(
                    fileSystem,
                    reviewFile,
                    existing ? await fileSystem.readFile(file, 'utf8') : ''
                )
            }
            if (existing) {
                const history = join(workspace.historyDirectory, existing.id)
                await fileSystem.mkdir(history, { recursive: true })
                const stamp = operationTime.replace(/[:.]/g, '-')
                await writeAtomically(
                    fileSystem,
                    join(history, `${stamp}-${randomUUID().slice(0, 8)}.md`),
                    await fileSystem.readFile(file, 'utf8')
                )
            }
            let normalized = normalizeMarkdown(input.markdown)
            const writingLanguage = normalizeWikiWritingLanguage(input.writingLanguage
                ?? detectWikiWritingLanguage(normalized.content))
            normalized = normalizeMarkdown(localizeWikiHeadings(normalized.content, writingLanguage))
            if (input.type === 'character') {
                normalized = normalizeMarkdown(
                    removeCharacterEventLinksFromRelatedDocuments(
                        normalized.content,
                        documents
                    )
                )
            }
            normalized = normalizeMarkdown(appendKnownDocumentLinks(
                normalized.content,
                input.type === 'character'
                    ? documents.filter((document) => document.type !== 'event')
                    : documents,
                id,
                writingLanguage
            ))
            const prepared = prepareDocument({
                id,
                type: input.type,
                status: 'active',
                title: normalized.title,
                aliases: aliasesForSave({
                    aliases: input.aliases,
                    title: normalized.title,
                    existing,
                }),
                relativePath,
                sourceMessageIds: [...new Set([
                    ...(existing?.sourceMessageIds ?? []),
                    ...incomingSources,
                ])].slice(-96),
                updated: operationTime,
                content: normalized.content,
                links: linksFrom(normalized.content),
                created: existing?.created ?? operationTime,
                authoring: 'ai-assisted',
                reviewStatus: input.reviewStatus ?? 'reviewed',
                contextMode: input.type === 'scene'
                    ? 'always'
                    : existing?.contextMode ?? 'auto',
            })
            await writeAtomically(fileSystem, file, prepared.contents)
            await rebuildIndex(input.characterId, input.chatId, writingLanguage)
            return prepared.document
        },

        async reviewCanonicalDocument(input: {
            characterId: string
            chatId: string
            documentId: string
            action: 'accept' | 'revert'
            expectedContentHash: string
        }): Promise<MarkdownWikiDocument | {
            id: string
            reverted: true
            deleted: true
        }> {
            const workspace = workspaceFor(input.characterId, input.chatId)
            const document = (await loadDocuments(
                input.characterId,
                input.chatId
            )).find((item) => item.id === required(
                input.documentId,
                'Document ID'
            ))
            if (!document || document.type === 'event'
                || document.status !== 'active') {
                throw new Error('Canonical wiki document does not exist')
            }
            if (document.reviewStatus !== 'unreviewed') {
                throw new Error('Canonical wiki document is not awaiting review')
            }
            if (document.contentHash !== input.expectedContentHash) {
                throw new Error('Wiki document changed since review opened')
            }
            const file = join(
                workspace.directory,
                ...document.relativePath.split('/')
            )
            const reviewFile = join(
                workspace.reviewDirectory,
                `${stableId([document.id])}.md`
            )
            if (input.action === 'revert') {
                const baseline = await fileSystem.readFile(reviewFile, 'utf8')
                if (baseline.length === 0) {
                    const trash = join(
                        workspace.trashDirectory,
                        document.id
                    )
                    await fileSystem.mkdir(trash, { recursive: true })
                    await writeAtomically(
                        fileSystem,
                        join(trash, `${now().toISOString().replace(/[:.]/g, '-')}-${basename(file)}`),
                        await fileSystem.readFile(file, 'utf8')
                    )
                    await fileSystem.rm(file)
                    await fileSystem.rm(reviewFile, { force: true })
                    await rebuildIndex(input.characterId, input.chatId)
                    return {
                        id: document.id,
                        reverted: true as const,
                        deleted: true as const,
                    }
                }
                const history = join(workspace.historyDirectory, document.id)
                await fileSystem.mkdir(history, { recursive: true })
                await writeAtomically(
                    fileSystem,
                    join(history, `${now().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}.md`),
                    await fileSystem.readFile(file, 'utf8')
                )
                await writeAtomically(fileSystem, file, baseline)
            }
            else {
                const { contentHash: _contentHash, reviewBaseContent: _base,
                    ...stored } = document
                const accepted = prepareDocument({
                    ...stored,
                    reviewStatus: 'reviewed',
                    updated: now().toISOString(),
                })
                await writeAtomically(fileSystem, file, accepted.contents)
            }
            await fileSystem.rm(reviewFile, { force: true })
            await rebuildIndex(input.characterId, input.chatId)
            const reviewed = (await loadDocuments(
                input.characterId,
                input.chatId
            )).find((item) => item.id === document.id)
            if (!reviewed) throw new Error('Reviewed wiki document disappeared')
            return reviewed.reviewStatus
                ? reviewed
                : { ...reviewed, reviewStatus: 'reviewed' }
        },

        async saveManualDocument(input: {
            characterId: string
            chatId: string
            documentId?: string
            type: MarkdownWikiDocumentType
            title: string
            aliases?: string[]
            markdown: string
            expectedContentHash?: string
        }): Promise<MarkdownWikiDocument> {
            const title = required(input.title, 'Title').trim().slice(0, 160)
            const allowed: MarkdownWikiDocumentType[] = [
                'character', 'location', 'scene', 'faction', 'creature',
                'item', 'concept', 'other', 'event',
            ]
            if (!allowed.includes(input.type)) {
                throw new Error('Invalid manual wiki document type')
            }
            const workspace = workspaceFor(input.characterId, input.chatId)
            const documents = await loadDocuments(input.characterId, input.chatId)
            const existing = input.documentId
                ? documents.find((document) => document.id === input.documentId)
                : undefined
            if (input.documentId && !existing) {
                throw new Error('Canonical wiki document does not exist')
            }
            if (input.type === 'event' && existing?.type !== 'event') {
                throw new Error('Manual event creation is not allowed')
            }
            if (existing?.type === 'event' && input.type !== 'event') {
                throw new Error('Event documents must keep their type')
            }
            if (existing && input.expectedContentHash
                && existing.contentHash !== input.expectedContentHash) {
                throw new Error(
                    'Wiki document changed since the draft was created'
                )
            }
            const operationTime = now().toISOString()
            const suffix = existing?.id.split('.').at(-1)
                ?? stableId([input.type, title, randomUUID()])
            const id = existing?.id ?? `${input.type}.${suffix}`
            const folder: Record<CanonicalMarkdownWikiDocumentType, string> = {
                character: 'characters',
                location: 'locations',
                scene: '',
                faction: 'factions',
                creature: 'creatures',
                item: 'items',
                concept: 'concepts',
                other: 'notes',
            }
            const relativePath = input.type === 'event'
                ? existing!.relativePath
                : input.type === 'scene'
                ? 'current-scene.md'
                : `${folder[input.type]}/${readableStem(title)}-${suffix}.md`
            const file = join(workspace.directory, ...relativePath.split('/'))
            const oldFile = existing
                ? join(workspace.directory, ...existing.relativePath.split('/'))
                : undefined
            if (documents.some((item) =>
                item.relativePath === relativePath && item.id !== existing?.id
            )) {
                throw new Error('A wiki document already owns that path')
            }
            await fileSystem.mkdir(resolve(file, '..'), { recursive: true })
            if (existing && oldFile) {
                const history = join(workspace.historyDirectory, existing.id)
                await fileSystem.mkdir(history, { recursive: true })
                const stamp = operationTime.replace(/[:.]/g, '-')
                await writeAtomically(
                    fileSystem,
                    join(history, `${stamp}-${randomUUID().slice(0, 8)}.md`),
                    await fileSystem.readFile(oldFile, 'utf8')
                )
            }
            const normalized = normalizeMarkdown(input.markdown)
            const content = normalized.content.replace(
                /^##\s+.+$/m,
                `## ${title}`
            )
            const prepared = prepareDocument({
                id,
                type: input.type,
                status: 'active',
                title,
                aliases: aliasesForSave({
                    aliases: input.aliases,
                    title,
                    existing,
                }),
                relativePath,
                sourceMessageIds: existing?.sourceMessageIds ?? [],
                created: existing?.created ?? operationTime,
                updated: operationTime,
                authoring: 'manual',
                content,
                links: linksFrom(content),
                contextMode: input.type === 'event'
                    ? 'auto'
                    : input.type === 'scene'
                    ? 'always'
                    : existing?.contextMode ?? 'auto',
            })
            await writeAtomically(fileSystem, file, prepared.contents)
            if (oldFile && oldFile !== file) {
                await fileSystem.rm(oldFile)
            }
            if (existing && existing.title !== title) {
                for (const linked of documents) {
                    if (linked.id === existing.id || linked.type === 'event') continue
                    const escaped = existing.title.replace(
                        /[.*+?^${}()|[\]\\]/g,
                        '\\$&'
                    )
                    const changed = linked.content.replace(
                        new RegExp(`\\[\\[${escaped}(?=\\]|\\|)`, 'g'),
                        `[[${title}`
                    )
                    if (changed === linked.content) continue
                    const linkedFile = join(
                        workspace.directory,
                        ...linked.relativePath.split('/')
                    )
                    const updatedLinked = {
                        ...linked,
                        content: changed,
                        links: linksFrom(changed),
                        updated: operationTime,
                    }
                    const linkedHistory = join(
                        workspace.historyDirectory,
                        linked.id
                    )
                    await fileSystem.mkdir(linkedHistory, { recursive: true })
                    await writeAtomically(
                        fileSystem,
                        join(linkedHistory, `${operationTime.replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}.md`),
                        await fileSystem.readFile(linkedFile, 'utf8')
                    )
                    await writeAtomically(
                        fileSystem,
                        linkedFile,
                        serializeDocument(updatedLinked)
                    )
                }
            }
            await rebuildIndex(input.characterId, input.chatId)
            return prepared.document
        },

        async setDocumentContextMode(input: {
            characterId: string
            chatId: string
            documentId: string
            contextMode: MarkdownWikiContextMode
            expectedContentHash?: string
        }): Promise<MarkdownWikiDocument> {
            const workspace = workspaceFor(input.characterId, input.chatId)
            const document = (await loadDocuments(
                input.characterId,
                input.chatId
            )).find((item) => item.id === required(
                input.documentId,
                'Document ID'
            ))
            if (!document) {
                throw new Error('Canonical wiki document does not exist')
            }
            if (document.type === 'event' || document.type === 'scene') {
                throw new Error('This document has a fixed context mode')
            }
            if (!['always', 'auto', 'never'].includes(input.contextMode)) {
                throw new Error('Invalid wiki context mode')
            }
            if (input.expectedContentHash
                && document.contentHash !== input.expectedContentHash) {
                throw new Error(
                    'Wiki document changed since the draft was created'
                )
            }
            const file = join(
                workspace.directory,
                ...document.relativePath.split('/')
            )
            const operationTime = now().toISOString()
            const history = join(workspace.historyDirectory, document.id)
            await fileSystem.mkdir(history, { recursive: true })
            await writeAtomically(
                fileSystem,
                join(history, `${operationTime.replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}.md`),
                await fileSystem.readFile(file, 'utf8')
            )
            const { contentHash: _contentHash, ...stored } = document
            const prepared = prepareDocument({
                ...stored,
                contextMode: input.contextMode,
                updated: operationTime,
            })
            await writeAtomically(fileSystem, file, prepared.contents)
            await rebuildIndex(input.characterId, input.chatId)
            return prepared.document
        },

        async trashDocument(input: {
            characterId: string
            chatId: string
            documentId: string
        }): Promise<{ id: string; trashed: true }> {
            const workspace = workspaceFor(input.characterId, input.chatId)
            const document = (await loadDocuments(input.characterId, input.chatId))
                .find((item) => item.id === required(input.documentId, 'Document ID'))
            if (!document) throw new Error('Canonical wiki document does not exist')
            if (document.type === 'event') {
                throw new Error('Event documents are read-only')
            }
            const file = join(workspace.directory, ...document.relativePath.split('/'))
            const trash = join(workspace.trashDirectory, document.id)
            await fileSystem.mkdir(trash, { recursive: true })
            const stamp = now().toISOString().replace(/[:.]/g, '-')
            await writeAtomically(
                fileSystem,
                join(trash, `${stamp}-${basename(file)}`),
                await fileSystem.readFile(file, 'utf8')
            )
            await fileSystem.rm(file)
            await rebuildIndex(input.characterId, input.chatId)
            return { id: document.id, trashed: true as const }
        },

        async retractEvent(input: {
            characterId: string
            chatId: string
            documentId: string
            expectedContentHash: string
        }): Promise<MarkdownWikiDocument> {
            const workspace = workspaceFor(input.characterId, input.chatId)
            const document = (await loadDocuments(
                input.characterId,
                input.chatId
            )).find((item) => item.id === required(
                input.documentId,
                'Document ID'
            ))
            if (!document || document.type !== 'event') {
                throw new Error('Event document does not exist')
            }
            if (document.status !== 'active') {
                throw new Error('Only an active event can be retracted')
            }
            if (document.contentHash !== required(
                input.expectedContentHash,
                'Content hash'
            )) {
                throw new Error('Wiki event changed since it was opened')
            }
            const file = join(
                workspace.directory,
                ...document.relativePath.split('/')
            )
            const { contentHash: _contentHash, ...stored } = document
            const prepared = prepareDocument({
                ...stored,
                status: 'retracted',
                updated: now().toISOString(),
            })
            await fileSystem.rm(file, { force: true })
            try {
                await rebuildIndex(input.characterId, input.chatId)
            } catch {
                documentCache.delete(workspace.directory)
            }
            return prepared.document
        },

        async retractEventsBySourceMessages(input: {
            characterId: string
            chatId: string
            sourceMessageIds: string[]
        }): Promise<{ retractedIds: string[] }> {
            const sources = new Set(input.sourceMessageIds.map((id) =>
                required(id, 'Source message ID')
            ))
            if (sources.size === 0) {
                throw new Error('Event retraction requires at least one source message')
            }
            const workspace = workspaceFor(input.characterId, input.chatId)
            const matches = (await loadDocuments(
                input.characterId,
                input.chatId
            )).filter((document) =>
                document.type === 'event'
                && document.status === 'active'
                && document.sourceMessageIds.some((id) => sources.has(id))
            )
            for (const document of matches) {
                await fileSystem.rm(
                    join(
                        workspace.directory,
                        ...document.relativePath.split('/')
                    ),
                    { force: true }
                )
            }
            if (matches.length > 0) {
                await rebuildIndex(input.characterId, input.chatId)
            }
            return { retractedIds: matches.map((document) => document.id) }
        },

        async loadView(
            characterId: string,
            chatId: string
        ): Promise<MarkdownWikiView> {
            const workspace = workspaceFor(characterId, chatId)
            const documents = await refreshDocuments(characterId, chatId)
            const withReviewBases = await Promise.all(documents.map(
                async (document) => {
                    if (document.reviewStatus !== 'unreviewed') return document
                    try {
                        const baseline = await fileSystem.readFile(join(
                            workspace.reviewDirectory,
                            `${stableId([document.id])}.md`
                        ), 'utf8')
                        return {
                            ...document,
                            reviewBaseContent: baseline.length > 0
                                ? parseDocument(
                                    baseline,
                                    document.relativePath
                                ).content
                                : '',
                        }
                    }
                    catch (error) {
                        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
                            return document
                        }
                        throw error
                    }
                }
            ))
            return {
                mode: 'markdown' as const,
                wikiPath: workspaceFor(characterId, chatId).directory,
                documents: withReviewBases,
                health: computeHealth(documents),
            }
        },

        async replaceAllText(input: {
            characterId: string
            chatId: string
            find: string
            replacement: string
        }): Promise<{ matches: number; documents: number }> {
            if (typeof input.find !== 'string'
                || input.find.length === 0
                || input.find.length > 256) {
                throw new Error('Find text must contain 1-256 characters')
            }
            const find = input.find
            if (typeof input.replacement !== 'string'
                || input.replacement.length > 256) {
                throw new Error('Replacement text is too long')
            }
            if (find === input.replacement) {
                return { matches: 0, documents: 0 }
            }
            const workspace = workspaceFor(input.characterId, input.chatId)
            const documents = await loadDocuments(
                input.characterId,
                input.chatId
            )
            const operationTime = now().toISOString()
            const staged = documents.flatMap((document) => {
                const contentMatches = document.content.split(find).length - 1
                if (contentMatches === 0) return []
                const { contentHash: _contentHash, ...stored } = document
                const content = stored.content.replaceAll(
                    find,
                    input.replacement
                )
                const prepared = prepareDocument({
                    ...stored,
                    title: stored.title.replaceAll(find, input.replacement),
                    content,
                    links: linksFrom(content),
                    updated: operationTime,
                })
                return [{
                    document,
                    matches: contentMatches,
                    file: join(
                        workspace.directory,
                        ...document.relativePath.split('/')
                    ),
                    prepared,
                }]
            })
            if (staged.length === 0) {
                return { matches: 0, documents: 0 }
            }
            const originals = await Promise.all(staged.map(async (item) => ({
                ...item,
                contents: await fileSystem.readFile(item.file, 'utf8'),
            })))
            const written: typeof originals = []
            try {
                for (const item of originals) {
                    await writeAtomically(
                        fileSystem,
                        item.file,
                        item.prepared.contents
                    )
                    written.push(item)
                }
            }
            catch (error) {
                await Promise.allSettled(written.map((item) =>
                    writeAtomically(fileSystem, item.file, item.contents)
                ))
                await refreshDocuments(input.characterId, input.chatId)
                throw error
            }
            await rebuildIndex(input.characterId, input.chatId)
            return {
                matches: staged.reduce(
                    (total, item) => total + item.matches,
                    0
                ),
                documents: staged.length,
            }
        },

        async inquire(input: {
            characterId: string
            chatId: string
            currentInput: string
            semanticMatches?: readonly {
                documentId: string
                score: number
            }[]
            sourceMatches?: readonly {
                messageId: string
                role: 'user' | 'assistant'
                content: string
                score: number
                occurredAt: number
            }[]
            sourceLimit?: number
            tokenBudget?: {
                target: number
                events?: number
                perSource?: number
                maximum: number
            }
        }) {
            return inquireMarkdownDocuments({
                documents: await loadDocuments(
                    input.characterId,
                    input.chatId
                ),
                currentInput: input.currentInput,
                ...(input.semanticMatches
                    ? { semanticMatches: input.semanticMatches }
                    : {}),
                ...(input.sourceMatches
                    ? { sourceMatches: input.sourceMatches }
                    : {}),
                ...(input.sourceLimit === undefined
                    ? {}
                    : { sourceLimit: input.sourceLimit }),
                ...(input.tokenBudget
                    ? { tokenBudget: input.tokenBudget }
                    : {}),
            })
        },
    }
}
