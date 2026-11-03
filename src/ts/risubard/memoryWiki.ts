import type {
    EvidenceRef,
    NarrativeEvent,
    NarrativeFact,
    NarrativeMemoryState,
} from '../../../packages/risubard-core/src/memoryDelta'
import {
    validateNarrativeGraphState,
} from '../../../packages/risubard-core/src/narrativeGraph'
import { invokeBrowserFetch } from './browserFetch'
import { normalizeMemoryRetrievalMetadata, type MemoryRetrievalMetadata, type MemoryStoryTime } from '../../../server/node/risubard-memory-metadata'
import type {
    NarrativeGraphViewSnapshot,
} from './memoryGraphView'
export type {
    CanonicalTurnReceipt,
    CanonicalTurnReceiptChange,
} from './canonicalTurnReceipt'

export interface NarrativeMemoryWikiV1 {
    mode: 'v1'
    reason: 'missing-or-stale-v2-index'
    baseline: string | null
    state: Pick<NarrativeMemoryState, 'facts' | 'events'>
    observability?: NarrativeMemoryObservability
}

export interface NarrativeMemoryWikiV2 {
    mode: 'v2'
    baseline: string | null
    graph: NarrativeGraphViewSnapshot
    observability?: NarrativeMemoryObservability
}

export interface NarrativeMemoryWikiMarkdown {
    mode: 'markdown'
    observability?: undefined
    wikiPath: string
    health: {
        danglingLinks: Array<{ sourceId: string; target: string }>
        unlinkedDocumentIds: string[]
        duplicatePassages?: Array<{ documentIds: [string, string] }>
    }
    documents: Array<{
        id: string
        type: MarkdownWikiDocumentType
        status: 'active' | 'superseded' | 'retracted'
        supersededBy?: string
        title: string
        aliases?: string[]
        retrievalMetadata?: MemoryRetrievalMetadata
        relativePath: string
        sourceMessageIds: string[]
        updated: string
        content: string
        links: string[]
        created?: string
        sequence?: number
        authoring?: 'automatic' | 'ai-assisted' | 'manual'
        contextMode: MarkdownWikiContextMode
        grade?: number
        gradeBy?: 'user' | 'ai'
        contentHash: string
        reviewStatus?: 'unreviewed' | 'reviewed'
        reviewBaseContent?: string
    }>
}

export type NarrativeMemoryWikiDocument = NarrativeMemoryWikiMarkdown['documents'][number]

/**
 * Wiki dock entry: catalog metadata, with the body once it has been read.
 * Catalog entries of non-event pages carry no source IDs until then.
 */
export type WikiCatalogDocument = Omit<NarrativeMemoryWikiDocument, 'content'> & {
    content?: string
}

export interface NarrativeMemoryWikiCatalog {
    mode: 'markdown'
    observability?: undefined
    wikiPath: string
    health: NarrativeMemoryWikiMarkdown['health']
    documents: WikiCatalogDocument[]
}

export type MarkdownWikiContextMode = 'always' | 'auto' | 'never'

export type MarkdownWikiDocumentType = 'event' | 'character' | 'location'
    | 'scene' | 'faction' | 'creature' | 'item' | 'concept' | 'other'
export type CanonicalMarkdownWikiDocumentType = Exclude<
    MarkdownWikiDocumentType,
    'event'
>

export interface NarrativeMemoryObservability {
    requestGraphNodeInspections: number
    requestIndexBuilds: number
    lastPromptMode: 'disabled' | 'v2-current' | 'bounded-v1-fallback'
    graphRevision: number
    indexRevision: number
    cacheStatus: 'disabled' | 'current' | 'missing-or-stale'
    lastInquiry: {
        candidateCount: number
        inspectedNodeCount: number
        inspectedEdgeCount: number
        selectedNodeCount: number
        selectedTokens: number
        hopCount: number
        auxiliaryModelCalls: 0
    } | null
    lastAnalysis: {
        status: 'success' | 'failed'
        appliedCount: number
    } | null
}

export type NarrativeMemoryWiki = NarrativeMemoryWikiV1
    | NarrativeMemoryWikiV2
    | NarrativeMemoryWikiMarkdown

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function validBaseline(value: unknown): value is string | null {
    return value === null || typeof value === 'string'
}

function hasExactKeys(
    value: Record<string, unknown>,
    keys: readonly string[]
): boolean {
    const actual = Object.keys(value)
    return actual.length === keys.length
        && actual.every((key) => keys.includes(key))
}

function requireString(value: unknown): string {
    if (typeof value !== 'string' || value.trim().length === 0) {
        throw new Error('Invalid RisuBard memory view')
    }
    return value
}

function parseEvidence(value: unknown, chatId: string): EvidenceRef[] {
    if (!Array.isArray(value) || value.length === 0) {
        throw new Error('Invalid RisuBard memory view evidence')
    }
    return value.map((item) => {
        if (!isRecord(item)
            || !hasExactKeys(item, ['chatId', 'messageId'])
            || item.chatId !== chatId
            || typeof item.messageId !== 'string'
            || item.messageId.trim().length === 0) {
            throw new Error('Invalid RisuBard memory view evidence')
        }
        return {
            chatId,
            messageId: item.messageId,
        }
    })
}

function requireUnique(values: string[]): void {
    if (new Set(values).size !== values.length) {
        throw new Error('Invalid RisuBard memory view')
    }
}

function requireMetric(value: unknown): number {
    if (!Number.isSafeInteger(value) || (value as number) < 0) {
        throw new Error('Invalid RisuBard memory observability')
    }
    return value as number
}

function parseObservability(value: unknown): NarrativeMemoryObservability {
    const keys = [
        'requestGraphNodeInspections',
        'requestIndexBuilds',
        'lastPromptMode',
        'graphRevision',
        'indexRevision',
        'cacheStatus',
        'lastInquiry',
        'lastAnalysis',
    ]
    if (!isRecord(value)
        || !hasExactKeys(value, keys)
        || !['disabled', 'v2-current', 'bounded-v1-fallback'].includes(
            String(value.lastPromptMode)
        )
        || !['disabled', 'current', 'missing-or-stale'].includes(
            String(value.cacheStatus)
        )) {
        throw new Error('Invalid RisuBard memory observability')
    }
    let lastInquiry: NarrativeMemoryObservability['lastInquiry'] = null
    if (value.lastInquiry !== null) {
        const inquiryKeys = [
            'candidateCount',
            'inspectedNodeCount',
            'inspectedEdgeCount',
            'selectedNodeCount',
            'selectedTokens',
            'hopCount',
            'auxiliaryModelCalls',
        ]
        if (!isRecord(value.lastInquiry)
            || !hasExactKeys(value.lastInquiry, inquiryKeys)
            || value.lastInquiry.auxiliaryModelCalls !== 0) {
            throw new Error('Invalid RisuBard memory observability')
        }
        lastInquiry = {
            candidateCount: requireMetric(value.lastInquiry.candidateCount),
            inspectedNodeCount: requireMetric(
                value.lastInquiry.inspectedNodeCount
            ),
            inspectedEdgeCount: requireMetric(
                value.lastInquiry.inspectedEdgeCount
            ),
            selectedNodeCount: requireMetric(
                value.lastInquiry.selectedNodeCount
            ),
            selectedTokens: requireMetric(value.lastInquiry.selectedTokens),
            hopCount: requireMetric(value.lastInquiry.hopCount),
            auxiliaryModelCalls: 0,
        }
    }
    let lastAnalysis: NarrativeMemoryObservability['lastAnalysis'] = null
    if (value.lastAnalysis !== null) {
        if (!isRecord(value.lastAnalysis)
            || !hasExactKeys(
                value.lastAnalysis,
                ['status', 'appliedCount']
            )
            || !['success', 'failed'].includes(
                String(value.lastAnalysis.status)
            )) {
            throw new Error('Invalid RisuBard memory observability')
        }
        lastAnalysis = {
            status: value.lastAnalysis.status as 'success' | 'failed',
            appliedCount: requireMetric(
                value.lastAnalysis.appliedCount
            ),
        }
    }
    return {
        requestGraphNodeInspections: requireMetric(
            value.requestGraphNodeInspections
        ),
        requestIndexBuilds: requireMetric(value.requestIndexBuilds),
        lastPromptMode: value.lastPromptMode as
            NarrativeMemoryObservability['lastPromptMode'],
        graphRevision: requireMetric(value.graphRevision),
        indexRevision: requireMetric(value.indexRevision),
        cacheStatus: value.cacheStatus as
            NarrativeMemoryObservability['cacheStatus'],
        lastInquiry,
        lastAnalysis,
    }
}

function parseV1State(
    value: unknown,
    chatId: string
): Pick<NarrativeMemoryState, 'facts' | 'events'> {
    if (!isRecord(value)
        || !hasExactKeys(
            value,
            ['facts', 'events']
        )
        || !Array.isArray(value.facts)
        || !Array.isArray(value.events)) {
        throw new Error('Invalid RisuBard memory view')
    }
    const facts = value.facts.map((item): NarrativeFact => {
        if (!isRecord(item)
            || Object.keys(item).some((key) => ![
                'id',
                'text',
                'status',
                'evidence',
                'invalidatedBy',
            ].includes(key))
            || !['active', 'invalidated'].includes(String(item.status))) {
            throw new Error('Invalid RisuBard memory view')
        }
        const fact: NarrativeFact = {
            id: requireString(item.id),
            text: requireString(item.text),
            status: item.status as NarrativeFact['status'],
            evidence: parseEvidence(item.evidence, chatId),
        }
        if (fact.status === 'invalidated') {
            fact.invalidatedBy = parseEvidence(item.invalidatedBy, chatId)
            if (fact.invalidatedBy.length === 0) {
                throw new Error('Invalid RisuBard memory view evidence')
            }
        }
        else if (item.invalidatedBy !== undefined) {
            throw new Error('Invalid RisuBard memory view')
        }
        return fact
    })
    const events = value.events.map((item): NarrativeEvent => {
        if (!isRecord(item)
            || !hasExactKeys(item, ['id', 'summary', 'evidence'])) {
            throw new Error('Invalid RisuBard memory view')
        }
        return {
            id: requireString(item.id),
            summary: requireString(item.summary),
            evidence: parseEvidence(item.evidence, chatId),
        }
    })
    requireUnique(facts.map((fact) => fact.id))
    requireUnique(events.map((event) => event.id))
    return { facts, events }
}

function parseMarkdownWikiDocument(document: unknown, catalog = false): WikiCatalogDocument {
    const documentKeys = [
            'id',
            'type',
            'status',
            'title',
            'relativePath',
            'sourceMessageIds',
            'updated',
            ...(catalog ? [] : ['content']),
            'links',
            'contextMode',
            'contentHash',
        ]
    if (!isRecord(document)
        || !documentKeys.every((key) => key in document)
        || Object.keys(document).some((key) => ![
            ...documentKeys, 'created', 'sequence', 'authoring', 'grade', 'gradeBy',
            'supersededBy', 'reviewStatus',
            'reviewBaseContent', 'aliases', 'retrievalMetadata',
        ].includes(key))
        || ![
            'event', 'character', 'location', 'scene', 'faction',
            'creature', 'item', 'concept', 'other',
        ].includes(
            String(document.type)
        )
        || !['active', 'superseded', 'retracted'].includes(
            String(document.status)
        )
        || (document.status === 'superseded'
            && typeof document.supersededBy !== 'string')
        || !Array.isArray(document.sourceMessageIds)
        || !document.sourceMessageIds.every(
            (id) => typeof id === 'string' && id.length > 0
        )
        || !Array.isArray(document.links)
        || !document.links.every(
            (link) => typeof link === 'string'
        )
        || (document.aliases !== undefined
            && (!Array.isArray(document.aliases)
                || !document.aliases.every((alias) =>
                    typeof alias === 'string')))
        || (document.created !== undefined
            && typeof document.created !== 'string')
        || (document.sequence !== undefined
            && (!Number.isSafeInteger(document.sequence) || (document.sequence as number) < 1))
        || (document.authoring !== undefined
            && !['automatic', 'ai-assisted', 'manual'].includes(
                String(document.authoring)
            ))
        || (document.reviewStatus !== undefined
            && !['unreviewed', 'reviewed'].includes(
                String(document.reviewStatus)
            ))
        || (document.reviewBaseContent !== undefined
            && typeof document.reviewBaseContent !== 'string')
        || !['always', 'auto', 'never'].includes(
            String(document.contextMode)
        )
        || (document.grade !== undefined
            && !(Number.isInteger(document.grade)
                && (document.grade as number) >= 0
                && (document.grade as number) <= 9))
        || (document.gradeBy !== undefined
            && document.gradeBy !== 'user' && document.gradeBy !== 'ai')
        || typeof document.contentHash !== 'string'
        || document.contentHash.length === 0) {
        throw new Error('Invalid RisuBard Markdown wiki view')
    }
    return {
        id: requireString(document.id),
        type: document.type as
            NarrativeMemoryWikiMarkdown['documents'][number]['type'],
        status: document.status as 'active' | 'superseded' | 'retracted',
        title: requireString(document.title),
        aliases: document.aliases === undefined
            ? []
            : document.aliases as string[],
        relativePath: requireString(document.relativePath),
        sourceMessageIds: document.sourceMessageIds,
        updated: requireString(document.updated),
        ...(catalog ? {} : { content: requireString(document.content) }),
        links: document.links,
        contextMode: document.contextMode as MarkdownWikiContextMode,
        ...(document.grade === undefined ? {} : {
            grade: document.grade as number,
            ...(document.gradeBy === undefined ? {} : {
                gradeBy: document.gradeBy as 'user' | 'ai',
            }),
        }),
        contentHash: document.contentHash,
        ...(document.retrievalMetadata === undefined ? {} : {
            retrievalMetadata: normalizeMemoryRetrievalMetadata(document.retrievalMetadata),
        }),
        ...(document.supersededBy === undefined
            ? {}
            : { supersededBy: document.supersededBy as string }),
        ...(document.created === undefined
            ? {}
            : { created: requireString(document.created) }),
        ...(document.sequence === undefined ? {} : { sequence: document.sequence as number }),
        ...(document.authoring === undefined
            ? {}
            : { authoring: document.authoring as
                'automatic' | 'ai-assisted' | 'manual' }),
        ...(document.reviewStatus === undefined ? {} : {
            reviewStatus: document.reviewStatus as
                'unreviewed' | 'reviewed',
        }),
        ...(document.reviewBaseContent === undefined ? {} : {
            reviewBaseContent: document.reviewBaseContent as string,
        }),
    }
}

type WikiScopeRequest = {
    characterId: string
    chatId: string
    fetchImpl: typeof fetch
    createAuth(): Promise<string>
    signal?: AbortSignal
}

async function postWikiScope(
    input: WikiScopeRequest,
    path: string,
    extra: Record<string, unknown> = {}
): Promise<Record<string, unknown>> {
    const response = await invokeBrowserFetch(input.fetchImpl, path, {
        method: 'POST',
        credentials: 'same-origin',
        signal: input.signal,
        headers: {
            'content-type': 'application/json',
            'risu-auth': await input.createAuth(),
        },
        body: JSON.stringify({ characterId: input.characterId, chatId: input.chatId, ...extra }),
    })
    if (!response.ok) {
        throw new Error(`RisuBard wiki request failed with status ${response.status}`)
    }
    const value: unknown = await response.json()
    if (!isRecord(value)) throw new Error('Invalid RisuBard wiki response')
    return value
}

function parseWikiHealth(value: unknown): NarrativeMemoryWikiMarkdown['health'] {
    if (!isRecord(value)
        || !Array.isArray(value.danglingLinks)
        || !value.danglingLinks.every((item) => isRecord(item)
            && typeof item.sourceId === 'string' && typeof item.target === 'string')
        || !Array.isArray(value.unlinkedDocumentIds)
        || !value.unlinkedDocumentIds.every((id) => typeof id === 'string')
        || (value.duplicatePassages !== undefined
            && (!Array.isArray(value.duplicatePassages)
                || !value.duplicatePassages.every((item) => isRecord(item)
                    && Array.isArray(item.documentIds) && item.documentIds.length === 2
                    && item.documentIds.every((id) => typeof id === 'string'))))) {
        throw new Error('Invalid RisuBard wiki health')
    }
    return {
        danglingLinks: value.danglingLinks as Array<{ sourceId: string; target: string }>,
        unlinkedDocumentIds: value.unlinkedDocumentIds as string[],
        duplicatePassages: (value.duplicatePassages ?? []) as Array<{ documentIds: [string, string] }>,
    }
}

/** Wiki dock table of contents: page metadata without bodies. */
export async function loadNarrativeMemoryWikiCatalog(
    input: WikiScopeRequest
): Promise<NarrativeMemoryWikiCatalog> {
    const value = await postWikiScope(input, '/api/risubard/memory/catalog')
    if (value.mode !== 'markdown' || !Array.isArray(value.documents)) {
        throw new Error('Invalid RisuBard wiki catalog')
    }
    return {
        mode: 'markdown',
        wikiPath: requireString(value.wikiPath),
        health: parseWikiHealth(value.health),
        documents: value.documents.map((document) => parseMarkdownWikiDocument(document, true)),
    }
}

/** Full pages for the requested IDs (at most 256 per request). */
export async function loadWikiDocumentBodies(
    input: WikiScopeRequest & { documentIds: readonly string[] }
): Promise<NarrativeMemoryWikiDocument[]> {
    const documents: NarrativeMemoryWikiDocument[] = []
    for (let offset = 0; offset < input.documentIds.length; offset += 256) {
        const value = await postWikiScope(input, '/api/risubard/memory/wiki/documents', {
            documentIds: input.documentIds.slice(offset, offset + 256),
        })
        if (!Array.isArray(value.documents)) throw new Error('Invalid RisuBard wiki documents')
        documents.push(...value.documents.map((document) =>
            parseMarkdownWikiDocument(document) as NarrativeMemoryWikiDocument))
    }
    return documents
}

/** IDs of pages whose title, aliases, path or body contain the query. */
export async function searchWikiDocuments(
    input: WikiScopeRequest & { query: string }
): Promise<string[]> {
    const value = await postWikiScope(input, '/api/risubard/memory/wiki/search', { query: input.query })
    if (!Array.isArray(value.documentIds)
        || !value.documentIds.every((id) => typeof id === 'string')) {
        throw new Error('Invalid RisuBard wiki search')
    }
    return value.documentIds as string[]
}

/** Asks the server to parse the wiki ahead of the first dock open. */
export async function warmWikiCatalog(input: WikiScopeRequest): Promise<void> {
    await postWikiScope(input, '/api/risubard/memory/wiki/warm')
}

/** Story-summary bullets of active events, keyed by event ID. */
export async function loadWikiStorySummaries(
    input: WikiScopeRequest
): Promise<Map<string, string[]>> {
    const value = await postWikiScope(input, '/api/risubard/memory/wiki/story')
    if (!Array.isArray(value.entries)) throw new Error('Invalid RisuBard wiki story')
    return new Map(value.entries.map((entry) => {
        if (!isRecord(entry) || typeof entry.id !== 'string' || !Array.isArray(entry.summary)
            || !entry.summary.every((item) => typeof item === 'string')) {
            throw new Error('Invalid RisuBard wiki story')
        }
        return [entry.id, entry.summary as string[]]
    }))
}

export async function loadNarrativeMemoryWiki(input: {
    characterId: string
    chatId: string
    fetchImpl: typeof fetch
    createAuth(): Promise<string>
    signal?: AbortSignal
}): Promise<NarrativeMemoryWiki> {
    const auth = await input.createAuth()
    const fetchImpl = input.fetchImpl
    const response = await invokeBrowserFetch(
        fetchImpl,
        '/api/risubard/memory/view',
        {
            method: 'POST',
            credentials: 'same-origin',
            signal: input.signal,
            headers: {
                'content-type': 'application/json',
                'risu-auth': auth,
            },
            body: JSON.stringify({
                characterId: input.characterId,
                chatId: input.chatId,
            }),
        }
    )
    if (!response.ok) {
        throw new Error(
            `RisuBard memory view failed with status ${response.status}`
        )
    }
    const value: unknown = await response.json()
    if (!isRecord(value)) {
        throw new Error('Invalid RisuBard memory view')
    }
    if (value.mode === 'markdown'
        && hasExactKeys(value, ['mode', 'wikiPath', 'documents', 'health'])
        && Array.isArray(value.documents)
        && isRecord(value.health)
        && (hasExactKeys(value.health, [
            'danglingLinks', 'unlinkedDocumentIds', 'duplicatePassages',
        ]) || hasExactKeys(value.health, [
            'danglingLinks', 'unlinkedDocumentIds',
        ]))
        && Array.isArray(value.health.danglingLinks)
        && value.health.danglingLinks.every((item) => isRecord(item)
            && hasExactKeys(item, ['sourceId', 'target'])
            && typeof item.sourceId === 'string'
            && typeof item.target === 'string')
        && Array.isArray(value.health.unlinkedDocumentIds)
        && value.health.unlinkedDocumentIds.every(
            (id) => typeof id === 'string'
        )
        && (value.health.duplicatePassages === undefined
            || (Array.isArray(value.health.duplicatePassages)
                && value.health.duplicatePassages.every((item) => isRecord(item)
                    && hasExactKeys(item, ['documentIds'])
                    && Array.isArray(item.documentIds)
                    && item.documentIds.length === 2
                    && item.documentIds[0] !== item.documentIds[1]
                    && item.documentIds.every((id) => typeof id === 'string')
                )))
    ) {
        return {
            mode: 'markdown',
            wikiPath: requireString(value.wikiPath),
            health: {
                danglingLinks: value.health.danglingLinks as Array<{
                    sourceId: string
                    target: string
                }>,
                unlinkedDocumentIds: value.health.unlinkedDocumentIds as string[],
                duplicatePassages: (value.health.duplicatePassages ?? []) as Array<{
                    documentIds: [string, string]
                }>,
            },
            documents: value.documents.map((document) =>
                parseMarkdownWikiDocument(document) as NarrativeMemoryWikiDocument),
        }
    }
    if (!validBaseline(value.baseline)) {
        throw new Error('Invalid RisuBard memory view')
    }
    if (value.mode === 'v1'
        && value.reason === 'missing-or-stale-v2-index'
        && (hasExactKeys(value, ['mode', 'reason', 'baseline', 'state'])
            || hasExactKeys(value, [
                'mode',
                'reason',
                'baseline',
                'state',
                'observability',
            ]))) {
        return {
            mode: 'v1',
            reason: value.reason,
            baseline: value.baseline,
            state: parseV1State(value.state, input.chatId),
            ...(value.observability === undefined
                ? {}
                : { observability: parseObservability(value.observability) }),
        }
    }
    if (value.mode === 'v2'
        && (hasExactKeys(value, ['mode', 'baseline', 'graph'])
            || hasExactKeys(value, [
                'mode',
                'baseline',
                'graph',
                'observability',
            ]))
        && isRecord(value.graph)
        && hasExactKeys(value.graph, [
            'schemaVersion',
            'storyId',
            'branchId',
            'revision',
            'nodes',
            'edges',
        ])) {
        const {
            appliedOperationIds: _appliedOperationIds,
            appliedOperationBindings: _appliedOperationBindings,
            ...graph
        } = validateNarrativeGraphState({
            ...value.graph,
            appliedOperationIds: [],
        })
        if (graph.storyId !== input.characterId
            || graph.branchId !== input.chatId) {
            throw new Error('Invalid RisuBard memory view scope')
        }
        const evidence = [
            ...graph.nodes.flatMap((node) => [
                ...node.evidence,
                ...(node.statusEvidence ?? []),
            ]),
            ...graph.edges.flatMap((edge) => edge.evidence),
        ]
        if (evidence.some((item) => item.chatId !== input.chatId)) {
            throw new Error('Invalid RisuBard memory view evidence')
        }
        return {
            mode: 'v2',
            baseline: value.baseline,
            graph,
            ...(value.observability === undefined
                ? {}
                : { observability: parseObservability(value.observability) }),
        }
    }
    throw new Error('Invalid RisuBard memory view')
}

function requiredMutationString(
    value: string,
    label: string,
    maximum = Infinity
): string {
    if (typeof value !== 'string'
        || value.trim().length === 0
        || value.trim().length > maximum) {
        throw new Error(`${label} must contain 1-${maximum} characters`)
    }
    return value.trim()
}

async function bardChatUndoRequest<K extends 'started' | 'available' | 'restored'>(
    action: 'begin' | 'finalize' | 'status' | 'restore',
    key: K,
    input: {
        characterId: string
        chatId: string
        fetchImpl: typeof fetch
        createAuth(): Promise<string>
    }
): Promise<Record<K, boolean>> {
    const response = await invokeBrowserFetch(
        input.fetchImpl,
        `/api/risubard/memory/wiki/bardchat-undo/${action}`,
        {
            method: 'POST',
            credentials: 'same-origin',
            headers: {
                'content-type': 'application/json',
                'risu-auth': await input.createAuth(),
            },
            body: JSON.stringify({
                characterId: requiredMutationString(input.characterId, 'Character ID', 1_024),
                chatId: requiredMutationString(input.chatId, 'Chat ID', 1_024),
            }),
        }
    )
    if (!response.ok) {
        throw new Error(`BARDCHAT undo ${action} failed with status ${response.status}`)
    }
    const value = await response.json()
    if (!isRecord(value) || !hasExactKeys(value, [key])
        || typeof value[key] !== 'boolean') {
        throw new Error(`Invalid BARDCHAT undo ${action} receipt`)
    }
    return value as Record<K, boolean>
}

export function beginBardChatUndo(input: {
    characterId: string; chatId: string; fetchImpl: typeof fetch
    createAuth(): Promise<string>
}) {
    return bardChatUndoRequest('begin', 'started', input) as Promise<{ started: true }>
}

export function finalizeBardChatUndo(input: {
    characterId: string; chatId: string; fetchImpl: typeof fetch
    createAuth(): Promise<string>
}) {
    return bardChatUndoRequest('finalize', 'available', input)
}

export function getBardChatUndoStatus(input: {
    characterId: string; chatId: string; fetchImpl: typeof fetch
    createAuth(): Promise<string>
}) {
    return bardChatUndoRequest('status', 'available', input)
}

export function restoreBardChatUndo(input: {
    characterId: string; chatId: string; fetchImpl: typeof fetch
    createAuth(): Promise<string>
}) {
    return bardChatUndoRequest('restore', 'restored', input) as Promise<{ restored: true }>
}

export async function saveManualWikiDocument(input: {
    characterId: string
    chatId: string
    documentId?: string
    type: MarkdownWikiDocumentType
    title: string
    aliases?: string[]
    markdown: string
    expectedContentHash?: string
    fetchImpl: typeof fetch
    createAuth(): Promise<string>
}): Promise<NarrativeMemoryWikiMarkdown['documents'][number]> {
    const body = {
        characterId: requiredMutationString(input.characterId, 'Character ID', 1_024),
        chatId: requiredMutationString(input.chatId, 'Chat ID', 1_024),
        ...(input.documentId
            ? { documentId: requiredMutationString(input.documentId, 'Document ID', 1_024) }
            : {}),
        ...(input.expectedContentHash
            ? { expectedContentHash: requiredMutationString(
                input.expectedContentHash,
                'Content hash',
                128
            ) }
            : {}),
        type: input.type,
        title: requiredMutationString(input.title, 'Wiki title', 160),
        ...(input.aliases === undefined ? {} : {
            aliases: input.aliases.map((alias) =>
                requiredMutationString(alias, 'Wiki alias', 160)
            ),
        }),
        markdown: requiredMutationString(input.markdown, 'Markdown'),
    }
    const response = await invokeBrowserFetch(
        input.fetchImpl,
        '/api/risubard/memory/wiki/document/manual-save',
        {
            method: 'POST',
            credentials: 'same-origin',
            headers: {
                'content-type': 'application/json',
                'risu-auth': await input.createAuth(),
            },
            body: JSON.stringify(body),
        }
    )
    if (!response.ok) {
        if (response.status === 409) {
            throw new Error('이 문서에 다른 변경이 저장되었습니다. 편집 내용은 유지됩니다. 내용을 복사해 보관한 뒤 최신 문서를 다시 열어 변경 사항을 확인해 주세요.')
        }
        throw new Error(`Wiki manual save failed with status ${response.status}`)
    }
    const value = await response.json() as NarrativeMemoryWikiMarkdown['documents'][number]
    if (!isRecord(value)
        || typeof value.id !== 'string'
        || value.status !== 'active'
        || value.authoring !== 'manual'
        || !Array.isArray(value.sourceMessageIds)
        || typeof value.content !== 'string'
        || !['always', 'auto', 'never'].includes(String(value.contextMode))
        || typeof value.contentHash !== 'string') {
        throw new Error('Invalid manual wiki document receipt')
    }
    return value
}

export async function setWikiDocumentContextMode(input: {
    characterId: string
    chatId: string
    documentId: string
    contextMode: MarkdownWikiContextMode
    expectedContentHash: string
    fetchImpl: typeof fetch
    createAuth(): Promise<string>
}): Promise<NarrativeMemoryWikiMarkdown['documents'][number]> {
    const body = {
        characterId: requiredMutationString(input.characterId, 'Character ID', 1_024),
        chatId: requiredMutationString(input.chatId, 'Chat ID', 1_024),
        documentId: requiredMutationString(input.documentId, 'Document ID', 1_024),
        contextMode: input.contextMode,
        expectedContentHash: requiredMutationString(
            input.expectedContentHash,
            'Content hash',
            128
        ),
    }
    const response = await invokeBrowserFetch(
        input.fetchImpl,
        '/api/risubard/memory/wiki/document/context-mode',
        {
            method: 'POST',
            credentials: 'same-origin',
            headers: {
                'content-type': 'application/json',
                'risu-auth': await input.createAuth(),
            },
            body: JSON.stringify(body),
        }
    )
    if (!response.ok) {
        throw new Error(
            `Wiki context-mode update failed with status ${response.status}`
        )
    }
    const value: unknown = await response.json()
    if (!isRecord(value)
        || value.id !== body.documentId
        || value.status !== 'active'
        || value.contextMode !== body.contextMode
        || typeof value.contentHash !== 'string') {
        throw new Error('Invalid wiki context-mode receipt')
    }
    return value as unknown as NarrativeMemoryWikiMarkdown['documents'][number]
}

export async function setWikiDocumentGrade(input: {
    characterId: string
    chatId: string
    documentId: string
    /** 0-9, or null to clear. */
    grade: number | null
    gradeBy?: 'user' | 'ai'
    expectedContentHash: string
    fetchImpl: typeof fetch
    createAuth(): Promise<string>
}): Promise<NarrativeMemoryWikiMarkdown['documents'][number]> {
    if (input.grade !== null
        && !(Number.isInteger(input.grade) && input.grade >= 0 && input.grade <= 9)) {
        throw new Error('Invalid wiki grade')
    }
    const body = {
        characterId: requiredMutationString(input.characterId, 'Character ID', 1_024),
        chatId: requiredMutationString(input.chatId, 'Chat ID', 1_024),
        documentId: requiredMutationString(input.documentId, 'Document ID', 1_024),
        grade: input.grade,
        gradeBy: input.gradeBy ?? 'ai',
        expectedContentHash: requiredMutationString(
            input.expectedContentHash,
            'Content hash',
            128
        ),
    }
    const response = await invokeBrowserFetch(
        input.fetchImpl,
        '/api/risubard/memory/wiki/document/grade',
        {
            method: 'POST',
            credentials: 'same-origin',
            headers: {
                'content-type': 'application/json',
                'risu-auth': await input.createAuth(),
            },
            body: JSON.stringify(body),
        }
    )
    if (!response.ok) {
        throw new Error(
            `Wiki grade update failed with status ${response.status}`
        )
    }
    const value: unknown = await response.json()
    if (!isRecord(value)
        || value.id !== body.documentId
        || value.status !== 'active'
        || (body.grade === null
            ? value.grade !== undefined
            : value.grade !== body.grade)
        || typeof value.contentHash !== 'string') {
        throw new Error('Invalid wiki grade receipt')
    }
    return value as unknown as NarrativeMemoryWikiMarkdown['documents'][number]
}

/** Saves recomputed story times onto events; events changed since they were read are skipped. */
export async function setWikiEventStoryTimes(input: {
    characterId: string
    chatId: string
    updates: ReadonlyArray<{ documentId: string; expectedContentHash: string; storyTime: MemoryStoryTime }>
    fetchImpl: typeof fetch
    createAuth(): Promise<string>
}): Promise<{ updated: string[]; skipped: string[] }> {
    const body = {
        characterId: requiredMutationString(input.characterId, 'Character ID', 1_024),
        chatId: requiredMutationString(input.chatId, 'Chat ID', 1_024),
        updates: input.updates.map((update) => ({
            documentId: requiredMutationString(update.documentId, 'Document ID', 1_024),
            expectedContentHash: requiredMutationString(update.expectedContentHash, 'Content hash', 128),
            storyTime: update.storyTime,
        })),
    }
    const response = await invokeBrowserFetch(
        input.fetchImpl,
        '/api/risubard/memory/wiki/event/story-times',
        {
            method: 'POST',
            credentials: 'same-origin',
            headers: {
                'content-type': 'application/json',
                'risu-auth': await input.createAuth(),
            },
            body: JSON.stringify(body),
        }
    )
    if (!response.ok) {
        throw new Error(`Wiki story time update failed with status ${response.status}`)
    }
    const value: unknown = await response.json()
    if (!isRecord(value) || !Array.isArray(value.updated) || !Array.isArray(value.skipped)
        || ![...value.updated, ...value.skipped].every((id) => typeof id === 'string')) {
        throw new Error('Invalid wiki story time receipt')
    }
    return { updated: value.updated as string[], skipped: value.skipped as string[] }
}

export async function trashWikiDocument(input: {
    characterId: string
    chatId: string
    documentId: string
    fetchImpl: typeof fetch
    createAuth(): Promise<string>
}): Promise<{ id: string; trashed: true }> {
    const body = {
        characterId: requiredMutationString(input.characterId, 'Character ID', 1_024),
        chatId: requiredMutationString(input.chatId, 'Chat ID', 1_024),
        documentId: requiredMutationString(input.documentId, 'Document ID', 1_024),
    }
    const response = await invokeBrowserFetch(
        input.fetchImpl,
        '/api/risubard/memory/wiki/document/trash',
        {
            method: 'POST',
            credentials: 'same-origin',
            headers: {
                'content-type': 'application/json',
                'risu-auth': await input.createAuth(),
            },
            body: JSON.stringify(body),
        }
    )
    if (!response.ok) {
        throw new Error(`Wiki trash failed with status ${response.status}`)
    }
    const value: unknown = await response.json()
    if (!isRecord(value)
        || !hasExactKeys(value, ['id', 'trashed'])
        || typeof value.id !== 'string'
        || value.trashed !== true) {
        throw new Error('Invalid wiki trash receipt')
    }
    return { id: value.id, trashed: true }
}

export async function retractWikiEvent(input: {
    characterId: string
    chatId: string
    documentId: string
    expectedContentHash: string
    fetchImpl: typeof fetch
    createAuth(): Promise<string>
}): Promise<NarrativeMemoryWikiMarkdown['documents'][number]> {
    const body = {
        characterId: requiredMutationString(input.characterId, 'Character ID', 1_024),
        chatId: requiredMutationString(input.chatId, 'Chat ID', 1_024),
        documentId: requiredMutationString(input.documentId, 'Document ID', 1_024),
        expectedContentHash: requiredMutationString(
            input.expectedContentHash,
            'Content hash',
            128
        ),
    }
    const response = await invokeBrowserFetch(
        input.fetchImpl,
        '/api/risubard/memory/wiki/event/retract',
        {
            method: 'POST',
            credentials: 'same-origin',
            headers: {
                'content-type': 'application/json',
                'risu-auth': await input.createAuth(),
            },
            body: JSON.stringify(body),
        }
    )
    if (!response.ok) {
        throw new Error(`Wiki event retraction failed with status ${response.status}`)
    }
    const value: unknown = await response.json()
    if (!isRecord(value)
        || value.id !== body.documentId
        || value.type !== 'event'
        || value.status !== 'retracted'
        || typeof value.contentHash !== 'string'
        || value.contentHash.length === 0) {
        throw new Error('Invalid wiki event retraction receipt')
    }
    return value as unknown as NarrativeMemoryWikiMarkdown['documents'][number]
}

export async function retractWikiEventsBySourceMessages(input: {
    characterId: string
    chatId: string
    sourceMessageIds: string[]
    fetchImpl: typeof fetch
    createAuth(): Promise<string>
}): Promise<{ retractedIds: string[] }> {
    const body = {
        characterId: requiredMutationString(input.characterId, 'Character ID', 1_024),
        chatId: requiredMutationString(input.chatId, 'Chat ID', 1_024),
        sourceMessageIds: [...new Set(input.sourceMessageIds.map((id) =>
            requiredMutationString(id, 'Source message ID', 1_024)
        ))],
    }
    if (body.sourceMessageIds.length === 0) {
        throw new Error('At least one source message ID is required')
    }
    const response = await invokeBrowserFetch(
        input.fetchImpl,
        '/api/risubard/memory/wiki/event/retract-sources',
        {
            method: 'POST',
            credentials: 'same-origin',
            headers: {
                'content-type': 'application/json',
                'risu-auth': await input.createAuth(),
            },
            body: JSON.stringify(body),
        }
    )
    if (!response.ok) {
        throw new Error(`Wiki source retraction failed with status ${response.status}`)
    }
    const value: unknown = await response.json()
    if (!isRecord(value)
        || !hasExactKeys(value, ['retractedIds'])
        || !Array.isArray(value.retractedIds)
        || !value.retractedIds.every((id) => typeof id === 'string')) {
        throw new Error('Invalid wiki source retraction receipt')
    }
    return { retractedIds: value.retractedIds as string[] }
}

export async function reviewCanonicalWikiDocument(input: {
    characterId: string
    chatId: string
    documentId: string
    action: 'accept' | 'revert'
    expectedContentHash: string
    fetchImpl: typeof fetch
    createAuth(): Promise<string>
}): Promise<NarrativeMemoryWikiMarkdown['documents'][number] | {
    id: string
    reverted: true
    deleted: true
}> {
    const body = {
        characterId: requiredMutationString(input.characterId, 'Character ID', 1_024),
        chatId: requiredMutationString(input.chatId, 'Chat ID', 1_024),
        documentId: requiredMutationString(input.documentId, 'Document ID', 1_024),
        action: input.action,
        expectedContentHash: requiredMutationString(
            input.expectedContentHash,
            'Content hash',
            128
        ),
    }
    const response = await invokeBrowserFetch(
        input.fetchImpl,
        '/api/risubard/memory/wiki/document/review',
        {
            method: 'POST',
            credentials: 'same-origin',
            headers: {
                'content-type': 'application/json',
                'risu-auth': await input.createAuth(),
            },
            body: JSON.stringify(body),
        }
    )
    if (!response.ok) {
        throw new Error(`Wiki review failed with status ${response.status}`)
    }
    const value: unknown = await response.json()
    if (isRecord(value)
        && hasExactKeys(value, ['id', 'reverted', 'deleted'])
        && value.id === body.documentId
        && value.reverted === true
        && value.deleted === true) {
        return {
            id: value.id as string,
            reverted: true,
            deleted: true,
        }
    }
    if (!isRecord(value)
        || value.id !== body.documentId
        || value.status !== 'active'
        || value.reviewStatus !== 'reviewed'
        || typeof value.contentHash !== 'string') {
        throw new Error('Invalid wiki review receipt')
    }
    return value as unknown as NarrativeMemoryWikiMarkdown['documents'][number]
}

export async function revealWikiDocument(input: {
    characterId: string
    chatId: string
    documentId: string
    fetchImpl: typeof fetch
    createAuth(): Promise<string>
}): Promise<{ ok: true }> {
    const body = {
        characterId: requiredMutationString(input.characterId, 'Character ID', 1_024),
        chatId: requiredMutationString(input.chatId, 'Chat ID', 1_024),
        documentId: requiredMutationString(input.documentId, 'Document ID', 1_024),
    }
    const response = await invokeBrowserFetch(
        input.fetchImpl,
        '/api/risubard/memory/wiki/document/reveal',
        {
            method: 'POST',
            credentials: 'same-origin',
            headers: {
                'content-type': 'application/json',
                'risu-auth': await input.createAuth(),
            },
            body: JSON.stringify(body),
        }
    )
    if (!response.ok) {
        throw new Error(`Wiki file reveal failed with status ${response.status}`)
    }
    const value: unknown = await response.json()
    if (!isRecord(value) || !hasExactKeys(value, ['ok']) || value.ok !== true) {
        throw new Error('Invalid wiki file reveal receipt')
    }
    return { ok: true }
}
