import { maintainCharacterCanon, maintenanceCoverDocuments } from '../../../server/node/risubard-canonical-maintenance'
import { directWikiTokens } from './directWikiBlocks'
import {
    loadWikiDocumentBodies,
    type CanonicalMarkdownWikiDocumentType,
    type NarrativeMemoryWikiDocument,
    type WikiCatalogDocument,
} from './memoryWiki'

/** Pages that can be compressed by hand: every canon page except events and scene snapshots. */
export function canCompressCanonDocument(document: { type: string; status?: string }): boolean {
    return document.type !== 'event' && document.type !== 'scene'
        && document.status !== 'retracted' && document.status !== 'superseded'
}

export interface CanonCompressionPreview {
    documentId: string
    title: string
    type: CanonicalMarkdownWikiDocumentType
    aliases: string[]
    contentHash: string
    outcome: 'ready' | 'unchanged' | 'error'
    /** Shown to the user: what changed, or why nothing did. */
    note: string
    charsBefore: number
    charsAfter?: number
    markdown?: string
}

const characters = (value: string) => [...value].length

/**
 * Runs the canon maintenance pass on the chosen pages without saving. The caller shows the previews
 * and applies the ready ones; one page failing never stops the others.
 */
export async function previewCanonCompression(input: {
    characterId: string
    chatId: string
    targetIds: readonly string[]
    catalog: readonly WikiCatalogDocument[]
    policy: string
    request(prompt: { system: string; input: string; schema: string }): Promise<string>
    fetchImpl: typeof fetch
    createAuth(): Promise<string>
    signal?: AbortSignal
    onProgress?(done: number, total: number, title: string): void
}): Promise<CanonCompressionPreview[]> {
    const scope = { characterId: input.characterId, chatId: input.chatId, fetchImpl: input.fetchImpl, createAuth: input.createAuth }
    const targets = await loadWikiDocumentBodies({ ...scope, documentIds: input.targetIds })
    const previews: CanonCompressionPreview[] = []
    for (const [index, target] of targets.entries()) {
        input.signal?.throwIfAborted()
        input.onProgress?.(index, targets.length, target.title)
        previews.push(await previewOne(target, input, scope))
    }
    // A stopped request reads as a failed page inside previewOne; report the stop instead.
    input.signal?.throwIfAborted()
    input.onProgress?.(targets.length, targets.length, '')
    return previews
}

async function previewOne(
    target: NarrativeMemoryWikiDocument,
    input: Parameters<typeof previewCanonCompression>[0],
    scope: { characterId: string; chatId: string; fetchImpl: typeof fetch; createAuth(): Promise<string> },
): Promise<CanonCompressionPreview> {
    const base = {
        documentId: target.id,
        title: target.title,
        type: target.type as CanonicalMarkdownWikiDocumentType,
        aliases: target.aliases ?? [],
        contentHash: target.contentHash,
        charsBefore: characters(target.content),
    }
    try {
        const covers = maintenanceCoverDocuments(target, input.catalog)
        const bodies = covers.length > 0
            ? new Map((await loadWikiDocumentBodies({ ...scope, documentIds: covers.map((cover) => cover.id) }))
                .map((document) => [document.id, document.content]))
            : new Map<string, string>()
        const result = await maintainCharacterCanon({
            markdown: target.content,
            title: target.title,
            documentType: target.type,
            coverDocuments: covers.map((cover) => ({ ...cover, content: bodies.get(cover.id) ?? '' })),
            eventTitles: input.catalog.filter((document) => document.type === 'event').map((document) => document.title),
            policy: input.policy,
            countTokens: directWikiTokens,
            perSourceTokens: 0,
            force: true,
            request: input.request,
        })
        if (result.outcome === 'applied' && result.markdown) {
            return {
                ...base, outcome: 'ready', markdown: result.markdown,
                charsAfter: characters(result.markdown),
                note: (result.note ?? '').replace(/^정본 정리:\s*/u, ''),
            }
        }
        if (result.outcome === 'error') {
            return { ...base, outcome: 'error', note: (result.note ?? '정리하지 못했습니다.') }
        }
        return {
            ...base, outcome: 'unchanged',
            note: result.attempted ? 'AI가 줄일 항목을 찾지 못했습니다. 문서는 그대로입니다.' : '정리할 절이 없습니다.',
        }
    }
    catch (cause) {
        input.signal?.throwIfAborted()
        return { ...base, outcome: 'error', note: cause instanceof Error ? cause.message.slice(0, 200) : '정리하지 못했습니다.' }
    }
}

/** Saves the ready previews one by one. A changed page is skipped, not overwritten. */
export async function applyCanonCompression(input: {
    previews: readonly CanonCompressionPreview[]
    beforeApply(): Promise<void>
    save(preview: CanonCompressionPreview & { markdown: string }): Promise<unknown>
}): Promise<{ applied: string[]; failed: Array<{ title: string; reason: string }> }> {
    const ready = input.previews.filter((preview): preview is CanonCompressionPreview & { markdown: string } =>
        preview.outcome === 'ready' && typeof preview.markdown === 'string')
    const applied: string[] = []
    const failed: Array<{ title: string; reason: string }> = []
    if (ready.length === 0) return { applied, failed }
    await input.beforeApply()
    for (const preview of ready) {
        try {
            await input.save(preview)
            applied.push(preview.documentId)
        }
        catch (cause) {
            failed.push({
                title: preview.title,
                reason: cause instanceof Error && /changed since/i.test(cause.message)
                    ? '미리보기 이후 문서가 바뀌어 적용하지 않았습니다.'
                    : cause instanceof Error ? cause.message.slice(0, 200) : '저장하지 못했습니다.',
            })
        }
    }
    return { applied, failed }
}
