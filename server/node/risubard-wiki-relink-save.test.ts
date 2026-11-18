import * as fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, test } from 'vitest'
import { createMarkdownNarrativeWiki } from './risubard-markdown-wiki'
import { createMemoryAnalysisRunner, type MemoryAnalysisModelRequest } from './risubard-memory-analysis'

const roots: string[] = []
afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
})

// Re-analysing a turn renames its event, and that rewrites links in the cards that pointed at it.
// The card update of the same analysis must save on top of that rewrite instead of failing forever.
test('a re-analysed turn whose event is renamed still updates the cards that linked it', async () => {
    const root = await fs.mkdtemp(join(tmpdir(), 'risubard-relink-'))
    roots.push(root)
    const scope = { characterId: 'character', chatId: 'chat' }
    const wiki = createMarkdownNarrativeWiki(root, { externalEditSweepMs: 0 })
    await wiki.saveConfirmedTurn({ ...scope, sourceMessageIds: ['a1'], markdown: '## 첫 만남\n\n앨리스가 도착했다.' })
    await wiki.saveCanonicalDocument({ ...scope, type: 'character', title: '앨리스', sourceMessageIds: ['a1'],
        markdown: '## 앨리스\n\n### 현재 상태\n\n- [[첫 만남]] 뒤 성문에 있다.' })
    const runner = createMemoryAnalysisRunner({
        memoryService: { loadState: async () => { throw new Error('unused') }, applyDelta: async () => { throw new Error('unused') } },
        nativeV2Analysis: true,
        markdownWikiService: {
            inquire: (input) => wiki.inquire(input),
            loadDocuments: async (characterId, chatId) => (await wiki.loadView(characterId, chatId)).documents,
            saveConfirmedTurn: (input) => wiki.saveConfirmedTurn(input),
            saveCanonicalDocument: (input) => wiki.saveCanonicalDocument(input),
        },
        analyze: async (request: MemoryAnalysisModelRequest) => request.format === 'memory-draft'
            ? JSON.stringify({ schemaVersion: 1, title: '성문 앞의 재회', establishedEvents: ['앨리스가 성문에 도착했다.'],
                stateChanges: [], characterKnowledge: [], persistentFacts: [], openContinuity: [],
                canonicalUpdateCandidates: [{ type: 'character', title: '앨리스', reason: '도착', action: 'create',
                    targetDocumentId: null, confidence: 1 }] })
            : JSON.stringify({ schemaVersion: 1, documents: [{ candidateIndex: 0, sections: [
                { heading: '현재 상태', operation: 'upsert', content: '- [[성문 앞의 재회]] 뒤 성문 안으로 들어갔다.' },
            ] }] }),
        onError: () => undefined,
    })
    const result = await runner.run({ ...scope, wikiWritingLanguage: 'ko',
        messages: [{ messageId: 'a1', role: 'assistant', content: '앨리스가 성문에 도착했다.' }] })
    expect(result.canonicalReceipt?.warnings.filter((warning) => warning.startsWith('정본 문서 저장 실패'))).toEqual([])
    const alice = (await wiki.loadView(scope.characterId, scope.chatId)).documents
        .find((document) => document.type === 'character')
    expect(alice?.content).toContain('성문 안으로 들어갔다')
})
