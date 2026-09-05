import * as fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import {
    createMarkdownNarrativeWiki,
    resolveMarkdownWikiWorkspace,
} from './risubard-markdown-wiki'

const temporaryDirectories: string[] = []

afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map((directory) =>
        fs.rm(directory, { recursive: true, force: true })
    ))
})

describe('Markdown narrative wiki', () => {
    test('can append the first summary to an English event with only a title', async () => {
        const root = await fs.mkdtemp(join(tmpdir(), 'risubard-md-wiki-'))
        temporaryDirectories.push(root)
        const wiki = createMarkdownNarrativeWiki(root)
        const scope = { characterId: 'character', chatId: 'chat', sourceMessageIds: ['empty'], writingLanguage: 'en' as const }
        await wiki.saveConfirmedTurn({ ...scope, markdown: '## Discovery' })
        const saved = await wiki.saveConfirmedTurn({ ...scope, append: true,
            markdown: '## Discovery\n\n### Story Summary\n\n- Alice found a clue.',
        })
        expect(saved.content).toContain('### Additional Analysis')
        expect(saved.content).not.toMatch(/[가-힣]/)
    })

    test('keeps automatic related and additional-analysis headings in English', async () => {
        const root = await fs.mkdtemp(join(tmpdir(), 'risubard-md-wiki-'))
        temporaryDirectories.push(root)
        const wiki = createMarkdownNarrativeWiki(root)
        const scope = { characterId: 'character', chatId: 'chat', sourceMessageIds: ['turn-en'] }
        await wiki.saveManualDocument({ ...scope, type: 'character',
            title: 'Alice', markdown: '## Alice\n\nA traveler.',
        })
        const canon = await wiki.saveCanonicalDocument({ ...scope, type: 'location',
            title: 'Station', markdown: '## Station\n\nAlice arrived here.', writingLanguage: 'en',
        })
        expect(canon.content).toContain('### Related Documents\n\n- [[Alice]]')
        const event = await wiki.saveConfirmedTurn({ ...scope, writingLanguage: 'en',
            markdown: '## Arrival\n\n### Story Summary\n\n- Alice arrived at Station.',
        })
        expect(event.content).toContain('### Related Documents')
        const appended = await wiki.saveConfirmedTurn({ ...scope, append: true, writingLanguage: 'en',
            markdown: '## Arrival\n\n### Story Summary\n\n- Alice found a key.',
        })
        expect(appended.content).toContain('### Additional Analysis')
        expect(canon.content + appended.content).not.toMatch(/[가-힣]/)
        const workspace = resolveMarkdownWikiWorkspace(root, 'character', 'chat')
        expect(await fs.readFile(workspace.indexFile, 'utf8')).toContain('## Narrative Wiki')
        const updated = await wiki.saveCanonicalDocument({ ...scope, documentId: canon.id,
            type: 'location', title: 'Station', writingLanguage: 'en',
            markdown: '## Station\n\n### 작중 행적\n\n- Alice arrived.\n\n### 관련 문서\n\n- [[Alice]]',
        })
        expect(updated.content).toContain('### Story History')
        expect(updated.content).toContain('### Related Documents')
        expect(updated.content).not.toMatch(/[가-힣]/)
        await expect(wiki.saveConfirmedTurn({ ...scope, append: true, writingLanguage: 'ko',
            markdown: '## 도착\n\n### 이야기 요약\n\n- 열쇠를 찾았다.',
        })).rejects.toThrow('language')
    })

    test('uses one temporary reboot checkpoint and removes it after recovery', async () => {
        const root = await fs.mkdtemp(join(tmpdir(), 'risubard-md-wiki-'))
        temporaryDirectories.push(root)
        const wiki = createMarkdownNarrativeWiki(root)
        const baseline = await wiki.saveManualDocument({
            characterId: 'character', chatId: 'chat', type: 'character',
            title: '라비안', markdown: '## 라비안\n\n검을 가진다.',
        })
        await wiki.beginRebootBatch({
            characterId: 'character', chatId: 'chat',
            sourceMessageIds: ['u1', 'a1'],
            eventSourceGroups: [['u1', 'a1']],
        })
        await wiki.saveCanonicalDocument({
            characterId: 'character', chatId: 'chat', documentId: baseline.id,
            type: 'character', title: '라비안', sourceMessageIds: ['u1', 'a1'],
            markdown: '## 라비안\n\n검을 잃었다.',
            expectedContentHash: baseline.contentHash,
        })
        await wiki.saveCanonicalDocument({
            characterId: 'character', chatId: 'chat', type: 'item',
            title: '검', sourceMessageIds: ['u1', 'a1'], markdown: '## 검\n\n분실됨.',
        })
        await wiki.saveConfirmedTurn({
            characterId: 'character', chatId: 'chat',
            sourceMessageIds: ['u1', 'a1'], markdown: '## 분실\n\n- 검을 잃었다.',
        })
        await expect(wiki.beginRebootBatch({
            characterId: 'character', chatId: 'chat',
            sourceMessageIds: ['u1', 'a1'],
            eventSourceGroups: [['u1', 'a1']],
        })).rejects.toThrow('checkpoint already in flight')
        await expect(wiki.beginRebootBatch({
            characterId: 'character', chatId: 'chat',
            sourceMessageIds: ['u2', 'a2'],
            eventSourceGroups: [['u2', 'a2']],
        })).rejects.toThrow('checkpoint already in flight')

        await expect(wiki.recoverRebootBatch({
            characterId: 'character', chatId: 'chat',
            sourceMessageIds: ['u1', 'a1'],
            eventSourceGroups: [['u1', 'a1']],
        })).resolves.toBeNull()
        const restored = await wiki.loadView('character', 'chat')
        expect(restored.documents.find((item) => item.id === baseline.id)?.content)
            .toContain('검을 가진다.')
        expect(restored.documents.some((item) => item.type === 'item')).toBe(false)
        expect(restored.documents.some((item) => item.type === 'event')).toBe(false)
        const workspace = resolveMarkdownWikiWorkspace(root, 'character', 'chat')
        await expect(fs.access(join(
            workspace.recoveryDirectory, 'reboot-batch'
        ))).rejects.toMatchObject({ code: 'ENOENT' })

        await wiki.beginRebootBatch({
            characterId: 'character', chatId: 'chat',
            sourceMessageIds: ['u1', 'a1'],
            eventSourceGroups: [['u1', 'a1']],
        })
        const receipt = {
            sourceMessageIds: ['u1', 'a1'], eventIds: [], changes: [],
            warnings: [], recordedAt: '2026-08-27T00:00:00.000Z',
        }
        await wiki.recordRebootBatchReceipt({
            characterId: 'character', chatId: 'chat', receipt,
        })
        await expect(wiki.beginRebootBatch({
            characterId: 'character', chatId: 'chat',
            sourceMessageIds: ['u1', 'a1'],
            eventSourceGroups: [['u1', 'a1']],
        })).rejects.toThrow('completed batch awaits cleanup')
        await expect(wiki.recoverRebootBatch({
            characterId: 'character', chatId: 'chat',
            sourceMessageIds: ['u1', 'a1'], eventSourceGroups: [['u1', 'a1']],
        })).resolves.toEqual(receipt)
        await expect(wiki.completeRebootBatch({
            characterId: 'character', chatId: 'chat',
            sourceMessageIds: ['u1', 'a1'],
        })).resolves.toEqual({ removed: true })
        await expect(wiki.completeRebootBatch({
            characterId: 'character', chatId: 'chat',
            sourceMessageIds: ['u1', 'a1'],
        })).resolves.toEqual({ removed: false })
    })

    test('recovers an unfinished legacy first-message checkpoint', async () => {
        const root = await fs.mkdtemp(join(tmpdir(), 'risubard-md-wiki-'))
        temporaryDirectories.push(root)
        const wiki = createMarkdownNarrativeWiki(root)
        await wiki.beginRebootBatch({
            characterId: 'character', chatId: 'chat',
            sourceMessageIds: ['first-message:chat:-1', 'u1', 'a1'],
            eventSourceGroups: [['u1', 'a1']],
        })

        await expect(wiki.recoverRebootBatch({
            characterId: 'character', chatId: 'chat',
            sourceMessageIds: ['u1', 'a1'],
            eventSourceGroups: [['u1', 'a1']],
        })).resolves.toBeNull()
    })

    test('completes a recorded legacy first-message checkpoint', async () => {
        const root = await fs.mkdtemp(join(tmpdir(), 'risubard-md-wiki-'))
        temporaryDirectories.push(root)
        const wiki = createMarkdownNarrativeWiki(root)
        const receipt = {
            sourceMessageIds: ['first-message:chat:-1', 'u1', 'a1'],
            eventIds: [], changes: [], warnings: [],
            recordedAt: '2026-09-03T00:00:00.000Z',
        }
        await wiki.beginRebootBatch({
            characterId: 'character', chatId: 'chat',
            sourceMessageIds: receipt.sourceMessageIds,
            eventSourceGroups: [['u1', 'a1']],
        })
        await wiki.recordRebootBatchReceipt({
            characterId: 'character', chatId: 'chat', receipt,
        })

        await expect(wiki.recoverRebootBatch({
            characterId: 'character', chatId: 'chat',
            sourceMessageIds: ['u1', 'a1'],
            eventSourceGroups: [['u1', 'a1']],
        })).resolves.toEqual(receipt)
        await expect(wiki.completeRebootBatch({
            characterId: 'character', chatId: 'chat',
            sourceMessageIds: ['u1', 'a1'],
        })).resolves.toEqual({ removed: true })
    })

    test('cleans a completed checkpoint after the client advances batches', async () => {
        const root = await fs.mkdtemp(join(tmpdir(), 'risubard-md-wiki-'))
        temporaryDirectories.push(root)
        const wiki = createMarkdownNarrativeWiki(root)
        const receipt = {
            sourceMessageIds: ['first-message:chat:-1', 'u1', 'a1'],
            eventIds: [], changes: [], warnings: [],
            recordedAt: '2026-09-03T00:00:00.000Z',
        }
        await wiki.beginRebootBatch({
            characterId: 'character', chatId: 'chat',
            sourceMessageIds: receipt.sourceMessageIds,
            eventSourceGroups: [['u1', 'a1']],
        })
        await wiki.recordRebootBatchReceipt({
            characterId: 'character', chatId: 'chat', receipt,
        })

        await expect(wiki.recoverRebootBatch({
            characterId: 'character', chatId: 'chat',
            sourceMessageIds: ['u2', 'a2'],
            eventSourceGroups: [['u2', 'a2']],
        })).resolves.toBeNull()
        const workspace = resolveMarkdownWikiWorkspace(root, 'character', 'chat')
        await expect(fs.access(join(
            workspace.recoveryDirectory, 'reboot-batch'
        ))).rejects.toMatchObject({ code: 'ENOENT' })
    })

    test('cleans an unpublished reboot checkpoint before retrying begin', async () => {
        const root = await fs.mkdtemp(join(tmpdir(), 'risubard-md-wiki-'))
        temporaryDirectories.push(root)
        const wiki = createMarkdownNarrativeWiki(root)
        const workspace = resolveMarkdownWikiWorkspace(
            root, 'character', 'chat'
        )
        const creatingDirectory = join(
            workspace.recoveryDirectory,
            'reboot-batch.creating'
        )
        await fs.mkdir(creatingDirectory, { recursive: true })
        await fs.writeFile(join(creatingDirectory, 'partial.md'), 'partial')

        const scope = {
            characterId: 'character',
            chatId: 'chat',
            sourceMessageIds: ['u1', 'a1'],
            eventSourceGroups: [['u1', 'a1']],
        }
        await expect(wiki.recoverRebootBatch(scope)).resolves.toBeNull()
        await expect(fs.access(creatingDirectory)).rejects.toMatchObject({
            code: 'ENOENT',
        })
        await expect(wiki.beginRebootBatch(scope)).resolves.toEqual({
            canonicalCount: 0,
        })
        await expect(fs.access(join(
            workspace.recoveryDirectory,
            'reboot-batch',
            'manifest.json'
        ))).resolves.toBeUndefined()
        await expect(fs.access(creatingDirectory)).rejects.toMatchObject({
            code: 'ENOENT',
        })
    })

    test('replaces literal text in canonical and event documents without history', async () => {
        const root = await fs.mkdtemp(join(tmpdir(), 'risubard-md-wiki-'))
        temporaryDirectories.push(root)
        const wiki = createMarkdownNarrativeWiki(root, {
            now: () => new Date('2026-08-16T01:02:03.000Z'),
        })
        const character = await wiki.saveManualDocument({
            characterId: 'character', chatId: 'chat', type: 'character',
            title: '길버드', markdown: '# 길버드\n\n길버드는 기사다.',
        })
        const event = await wiki.saveConfirmedTurn({
            characterId: 'character', chatId: 'chat',
            sourceMessageIds: ['user-1', 'assistant-1'],
            markdown: '길버드가 성문을 열었다.',
        })

        await expect(wiki.replaceAllText({
            characterId: 'character', chatId: 'chat',
            find: '길버드', replacement: '길버트',
        })).resolves.toEqual({ matches: 4, documents: 2 })

        const view = await wiki.loadView('character', 'chat')
        expect(view.documents.find((item) => item.id === character.id))
            .toMatchObject({ title: '길버트' })
        expect(view.documents.find((item) => item.id === event.id)?.content)
            .toContain('길버트가 성문을 열었다.')
        const workspace = resolveMarkdownWikiWorkspace(root, 'character', 'chat')
        await expect(fs.access(join(
            workspace.historyDirectory, character.id
        ))).rejects.toMatchObject({ code: 'ENOENT' })
        await expect(fs.access(join(
            workspace.historyDirectory, event.id
        ))).rejects.toMatchObject({ code: 'ENOENT' })
    })

    test('reuses parsed Markdown between inquiries and refreshes after writes', async () => {
        const root = await fs.mkdtemp(join(tmpdir(), 'risubard-md-wiki-'))
        temporaryDirectories.push(root)
        let readCount = 0
        const countingFileSystem = {
            ...fs,
            readFile: async (...args: unknown[]) => {
                readCount += 1
                return (fs.readFile as unknown as (
                    ...values: unknown[]
                ) => Promise<unknown>)(...args)
            },
        } as unknown as NonNullable<
            Parameters<typeof createMarkdownNarrativeWiki>[1]
        >['fileSystem']
        const wiki = createMarkdownNarrativeWiki(root, {
            fileSystem: countingFileSystem,
        })
        await wiki.saveManualDocument({
            characterId: 'character', chatId: 'chat', type: 'character',
            title: '라비안', markdown: '# 라비안\n\n기사다.',
        })
        const afterFirstWrite = readCount

        await wiki.inquire({
            characterId: 'character', chatId: 'chat',
            currentInput: '라비안은 누구지?',
        })
        await wiki.inquire({
            characterId: 'character', chatId: 'chat',
            currentInput: '라비안의 상태는?',
        })
        expect(readCount).toBe(afterFirstWrite)

        await wiki.saveManualDocument({
            characterId: 'character', chatId: 'chat', type: 'item',
            title: '은빛 창', markdown: '# 은빛 창\n\n라비안의 무기다.',
        })
        const afterSecondWrite = readCount
        const inquiry = await wiki.inquire({
            characterId: 'character', chatId: 'chat',
            currentInput: '은빛 창은 무엇이지?',
        })

        expect(readCount).toBe(afterSecondWrite)
        expect(inquiry.sources.some((source) =>
            source.id.includes('wiki:items/'))).toBe(true)
    })

    test('invalidates documents replaced outside the wiki writer', async () => {
        const root = await fs.mkdtemp(join(tmpdir(), 'risubard-md-wiki-'))
        temporaryDirectories.push(root)
        const wiki = createMarkdownNarrativeWiki(root)
        await wiki.saveManualDocument({
            characterId: 'character', chatId: 'chat', type: 'character',
            title: '교체 전', markdown: '# 교체 전\n\n이전 내용.',
        })
        await wiki.inquire({
            characterId: 'character', chatId: 'chat', currentInput: '교체 전',
        })
        await wiki.saveManualDocument({
            characterId: 'character', chatId: 'source', type: 'character',
            title: '교체 후', markdown: '# 교체 후\n\n새 내용.',
        })
        const workspace = resolveMarkdownWikiWorkspace(
            root, 'character', 'chat'
        )
        const sourceWorkspace = resolveMarkdownWikiWorkspace(
            root, 'character', 'source'
        )
        const [sourceFile] = await fs.readdir(
            sourceWorkspace.charactersDirectory
        )
        await fs.rm(workspace.charactersDirectory, { recursive: true })
        await fs.mkdir(workspace.charactersDirectory, { recursive: true })
        await fs.copyFile(
            join(sourceWorkspace.charactersDirectory, sourceFile),
            join(workspace.charactersDirectory, sourceFile)
        )

        wiki.invalidateCache('character', 'chat')
        const inquiry = await wiki.inquire({
            characterId: 'character', chatId: 'chat', currentInput: '교체 후',
        })
        expect(inquiry.sources.some((source) =>
            source.content.includes('새 내용')
        )).toBe(true)
    })

    test('creates an AI-free canonical page with program-owned metadata', async () => {
        const root = await fs.mkdtemp(join(tmpdir(), 'risubard-md-wiki-'))
        temporaryDirectories.push(root)
        const wiki = createMarkdownNarrativeWiki(root, {
            now: () => new Date('2026-08-08T06:07:08.000Z'),
        })

        const created = await wiki.saveManualDocument({
            characterId: 'character',
            chatId: 'chat',
            type: 'faction',
            title: '은촛대 수도회',
            aliases: [' 은촛대 ', '실버 캔들', '은촛대', '은촛대 수도회'],
            markdown: '# 은촛대 수도회\n\n사용자가 직접 기록했다.',
        })

        expect(created).toEqual(expect.objectContaining({
            type: 'faction',
            title: '은촛대 수도회',
            sourceMessageIds: [],
            created: '2026-08-08T06:07:08.000Z',
            updated: '2026-08-08T06:07:08.000Z',
            authoring: 'manual',
            aliases: ['은촛대', '실버 캔들'],
            relativePath: expect.stringMatching(/^factions\//),
        }))
        const workspace = resolveMarkdownWikiWorkspace(root, 'character', 'chat')
        const contents = await fs.readFile(
            join(workspace.directory, ...created.relativePath.split('/')),
            'utf8'
        )
        expect(contents).toContain(`id: ${JSON.stringify(created.id)}`)
        expect(contents).toContain('type: faction')
        expect(contents).toContain('authoring: manual')
        expect(contents).toContain('aliases:\n  - "은촛대"\n  - "실버 캔들"')
        expect(contents).toContain('created: "2026-08-08T06:07:08.000Z"')
    })

    test('stores creature canon in the creature folder', async () => {
        const root = await fs.mkdtemp(join(tmpdir(), 'risubard-md-wiki-'))
        temporaryDirectories.push(root)
        const wiki = createMarkdownNarrativeWiki(root)

        const created = await wiki.saveManualDocument({
            characterId: 'character', chatId: 'chat',
            type: 'creature' as any,
            title: '기어다니는 좀비',
            markdown: '## 기어다니는 좀비\n\n좀비의 지속 변종이다.',
        })

        expect(created).toEqual(expect.objectContaining({
            type: 'creature',
            relativePath: expect.stringMatching(/^creatures\//),
            contextMode: 'auto',
        }))
        expect((await wiki.loadView('character', 'chat')).documents)
            .toEqual(expect.arrayContaining([
                expect.objectContaining({ id: created.id, type: 'creature' }),
            ]))
    })

    test('nests wiki document headings below the injected prompt-block heading', async () => {
        const root = await fs.mkdtemp(join(tmpdir(), 'risubard-md-wiki-'))
        temporaryDirectories.push(root)
        const wiki = createMarkdownNarrativeWiki(root)

        const created = await wiki.saveManualDocument({
            characterId: 'character', chatId: 'chat', type: 'character',
            title: '라비안',
            markdown: '# 라비안\n\n## 현재 상태\n\n기사다.',
        })

        expect(created.content).toBe(
            '## 라비안\n\n### 현재 상태\n\n기사다.'
        )
        expect(created.content).not.toMatch(/^#\s/m)
    })

    test('resolves only unique aliases in wiki health links', async () => {
        const root = await fs.mkdtemp(join(tmpdir(), 'risubard-md-wiki-'))
        temporaryDirectories.push(root)
        const wiki = createMarkdownNarrativeWiki(root)
        await wiki.saveManualDocument({
            characterId: 'character', chatId: 'chat', type: 'character',
            title: '김철수', aliases: ['대장'], markdown: '## 김철수\n\n동부대 지휘관.',
        })
        const second = await wiki.saveManualDocument({
            characterId: 'character', chatId: 'chat', type: 'character',
            title: '이영희', markdown: '## 이영희\n\n서부대 지휘관.',
        })
        await wiki.saveManualDocument({
            characterId: 'character', chatId: 'chat', type: 'faction',
            title: '경비대', markdown: '## 경비대\n\n[[대장]]이 지휘한다.',
        })

        expect((await wiki.loadView('character', 'chat')).health.danglingLinks)
            .toEqual([])

        await wiki.saveManualDocument({
            characterId: 'character', chatId: 'chat', documentId: second.id,
            type: 'character', title: '이영희', aliases: ['대장'],
            markdown: '## 이영희\n\n서부대 지휘관.',
        })
        expect((await wiki.loadView('character', 'chat')).health.danglingLinks)
            .toEqual([expect.objectContaining({ target: '대장' })])
    })

    test('projects legacy H1 files as nested headings when loading them', async () => {
        const root = await fs.mkdtemp(join(tmpdir(), 'risubard-md-wiki-'))
        temporaryDirectories.push(root)
        const wiki = createMarkdownNarrativeWiki(root)
        const created = await wiki.saveManualDocument({
            characterId: 'character', chatId: 'chat', type: 'character',
            title: '라비안', markdown: '## 라비안\n\n### 현재 상태\n\n기사다.',
        })
        const workspace = resolveMarkdownWikiWorkspace(root, 'character', 'chat')
        const file = join(workspace.directory, ...created.relativePath.split('/'))
        const stored = await fs.readFile(file, 'utf8')
        await fs.writeFile(file, stored
            .replace('## 라비안', '# 라비안')
            .replace('### 현재 상태', '## 현재 상태'), 'utf8')

        const loaded = (await wiki.loadView('character', 'chat')).documents
            .find((document) => document.id === created.id)

        expect(loaded?.content).toBe(
            '## 라비안\n\n### 현재 상태\n\n기사다.'
        )
    })

    test('adds visible wikilinks for exact known titles on automatic writes', async () => {
        const root = await fs.mkdtemp(join(tmpdir(), 'risubard-md-wiki-'))
        temporaryDirectories.push(root)
        const wiki = createMarkdownNarrativeWiki(root)
        await wiki.saveManualDocument({
            characterId: 'character', chatId: 'chat', type: 'character',
            title: '길버드', markdown: '# 길버드\n\n고아원장이다.',
        })

        const created = await wiki.saveCanonicalDocument({
            characterId: 'character', chatId: 'chat', type: 'character',
            title: '리즐렛', sourceMessageIds: ['turn-1'],
            markdown: [
                '# 리즐렛',
                '',
                '## 대인 관계',
                '',
                '- **길버드**: 자신을 거두어 준 신부이자 고아원장이다.',
            ].join('\n'),
        })

        expect(created.content).toContain('### 관련 문서')
        expect(created.content).toContain('- [[길버드]]')
        expect(created.links).toContain('길버드')
    })

    test('keeps event evidence in character chronology without duplicating it in related documents', async () => {
        const root = await fs.mkdtemp(join(tmpdir(), 'risubard-md-wiki-'))
        temporaryDirectories.push(root)
        const wiki = createMarkdownNarrativeWiki(root)
        await wiki.saveConfirmedTurn({
            characterId: 'character', chatId: 'chat',
            sourceMessageIds: ['turn-1'],
            markdown: '## 첫 만남\n\n### 이야기 요약\n\n- 두 사람이 처음 만났다.',
        })

        const created = await wiki.saveCanonicalDocument({
            characterId: 'character', chatId: 'chat', type: 'character',
            title: '리즐렛', sourceMessageIds: ['turn-1'],
            markdown: [
                '## 리즐렛',
                '',
                '### 작중 행적',
                '',
                '- [[첫 만남]]에서 타카기와 처음 만났다.',
                '',
                '### 관련 문서',
                '',
                '- [[첫 만남]]',
            ].join('\n'),
        })

        expect(created.content.match(/\[\[첫 만남\]\]/g)).toHaveLength(1)
        expect(created.content).not.toContain('### 관련 문서')
        expect(created.links).toEqual(['첫 만남'])
    })

    test('resolves only an existing document ID to its absolute wiki file', async () => {
        const root = await fs.mkdtemp(join(tmpdir(), 'risubard-md-wiki-'))
        temporaryDirectories.push(root)
        const wiki = createMarkdownNarrativeWiki(root)
        const created = await wiki.saveManualDocument({
            characterId: 'character',
            chatId: 'chat',
            type: 'character',
            title: '라비안',
            markdown: '# 라비안\n\n기사.',
        })
        const workspace = resolveMarkdownWikiWorkspace(root, 'character', 'chat')

        await expect(wiki.resolveDocumentFile({
            characterId: 'character',
            chatId: 'chat',
            documentId: created.id,
        })).resolves.toBe(join(
            workspace.directory,
            ...created.relativePath.split('/')
        ))
        await expect(wiki.resolveDocumentFile({
            characterId: 'character',
            chatId: 'chat',
            documentId: '../escape',
        })).rejects.toThrow('Wiki document does not exist')
    })

    test('ordinary writes create no snapshots and remove legacy snapshots on access', async () => {
        const root = await fs.mkdtemp(join(tmpdir(), 'risubard-md-wiki-'))
        temporaryDirectories.push(root)
        const wiki = createMarkdownNarrativeWiki(root)
        await wiki.saveManualDocument({
            characterId: 'character', chatId: 'chat', type: 'character',
            title: '라비안', markdown: '# 라비안\n\n현재 상태.',
        })
        await wiki.saveConfirmedTurn({
            characterId: 'character', chatId: 'chat',
            sourceMessageIds: ['assistant-1'], markdown: '# 사건\n\n진행됨.',
        })
        const workspace = resolveMarkdownWikiWorkspace(root, 'character', 'chat')
        await expect(fs.access(workspace.snapshotsDirectory))
            .rejects.toMatchObject({ code: 'ENOENT' })
        await fs.mkdir(workspace.snapshotsDirectory, { recursive: true })
        await fs.writeFile(join(workspace.snapshotsDirectory, 'legacy'), 'x')
        await wiki.loadView('character', 'chat')
        await expect(fs.access(workspace.snapshotsDirectory))
            .rejects.toMatchObject({ code: 'ENOENT' })
    })

    test('does not follow linked wiki or legacy snapshot directories', async () => {
        const root = await fs.mkdtemp(join(tmpdir(), 'risubard-md-wiki-'))
        temporaryDirectories.push(root)
        const linkedWorkspace = resolveMarkdownWikiWorkspace(
            root, 'character', 'linked-chat'
        )
        const externalWiki = join(root, 'external-wiki')
        const externalLegacy = join(
            externalWiki, '.risubard-snapshots', 'keep'
        )
        await fs.mkdir(join(linkedWorkspace.directory, '..'), {
            recursive: true,
        })
        await fs.mkdir(join(externalLegacy, '..'), { recursive: true })
        await fs.writeFile(externalLegacy, 'protected')
        await fs.symlink(
            externalWiki,
            linkedWorkspace.directory,
            process.platform === 'win32' ? 'junction' : 'dir'
        )
        const wiki = createMarkdownNarrativeWiki(root)
        await expect(wiki.loadView('character', 'linked-chat'))
            .rejects.toThrow('unsafe')
        await expect(wiki.saveManualDocument({
            characterId: 'character', chatId: 'linked-chat',
            type: 'character', title: '라비안', markdown: '## 라비안',
        })).rejects.toThrow('unsafe')
        await expect(fs.readFile(externalLegacy, 'utf8'))
            .resolves.toBe('protected')

        const safeWorkspace = resolveMarkdownWikiWorkspace(
            root, 'character', 'safe-chat'
        )
        const externalSnapshots = join(root, 'external-snapshots')
        const externalSnapshotFile = join(externalSnapshots, 'keep')
        await fs.mkdir(safeWorkspace.directory, { recursive: true })
        await fs.mkdir(externalSnapshots, { recursive: true })
        await fs.writeFile(externalSnapshotFile, 'protected')
        await fs.symlink(
            externalSnapshots,
            safeWorkspace.snapshotsDirectory,
            process.platform === 'win32' ? 'junction' : 'dir'
        )
        await expect(wiki.loadView('character', 'safe-chat'))
            .resolves.toMatchObject({ mode: 'markdown' })
        await expect(fs.access(safeWorkspace.snapshotsDirectory))
            .rejects.toMatchObject({ code: 'ENOENT' })
        await expect(fs.readFile(externalSnapshotFile, 'utf8'))
            .resolves.toBe('protected')
    })

    test('renames and moves a manual page while preserving its ID and backlinks', async () => {
        const root = await fs.mkdtemp(join(tmpdir(), 'risubard-md-wiki-'))
        temporaryDirectories.push(root)
        const times = [
            new Date('2026-08-08T06:00:00.000Z'),
            new Date('2026-08-08T07:00:00.000Z'),
        ]
        const wiki = createMarkdownNarrativeWiki(root, {
            now: () => times.shift() ?? new Date('2026-08-08T08:00:00.000Z'),
        })
        const created = await wiki.saveManualDocument({
            characterId: 'character',
            chatId: 'chat',
            type: 'character',
            title: '라비안',
            markdown: '# 라비안\n\n기사.',
        })
        const linked = await wiki.saveManualDocument({
            characterId: 'character',
            chatId: 'chat',
            type: 'location',
            title: '소성당',
            markdown: '# 소성당\n\n[[라비안]]이 머문다.',
        })

        const renamed = await wiki.saveManualDocument({
            characterId: 'character',
            chatId: 'chat',
            documentId: created.id,
            type: 'location',
            title: '라비안의 은신처',
            markdown: '# 라비안의 은신처\n\n현재는 장소로 관리한다.',
        })

        expect(renamed.id).toBe(created.id)
        expect(renamed.aliases).toContain('라비안')
        expect(renamed.relativePath).toMatch(/^locations\//)
        expect(renamed.relativePath).not.toBe(created.relativePath)
        const view = await wiki.loadView('character', 'chat')
        expect(view.documents.find((item) => item.id === linked.id)?.content)
            .toContain('[[라비안의 은신처]]')
        const workspace = resolveMarkdownWikiWorkspace(root, 'character', 'chat')
        await expect(fs.readFile(
            join(workspace.directory, ...created.relativePath.split('/')),
            'utf8'
        )).rejects.toMatchObject({ code: 'ENOENT' })
        expect(await fs.readdir(join(workspace.historyDirectory, created.id)))
            .toHaveLength(1)
    })

    test('moves canonical pages to recoverable trash and rejects event deletion', async () => {
        const root = await fs.mkdtemp(join(tmpdir(), 'risubard-md-wiki-'))
        temporaryDirectories.push(root)
        const wiki = createMarkdownNarrativeWiki(root, {
            now: () => new Date('2026-08-08T09:00:00.000Z'),
        })
        const page = await wiki.saveManualDocument({
            characterId: 'character',
            chatId: 'chat',
            type: 'item',
            title: '은 열쇠',
            markdown: '# 은 열쇠\n\n낡은 열쇠.',
        })
        const event = await wiki.saveConfirmedTurn({
            characterId: 'character',
            chatId: 'chat',
            sourceMessageIds: ['assistant-1'],
            markdown: '# 발견\n\n열쇠를 발견했다.',
        })

        await wiki.trashDocument({
            characterId: 'character',
            chatId: 'chat',
            documentId: page.id,
        })

        const workspace = resolveMarkdownWikiWorkspace(root, 'character', 'chat')
        expect(await fs.readdir(join(workspace.trashDirectory, page.id)))
            .toHaveLength(1)
        expect((await wiki.loadView('character', 'chat')).documents
            .some((item) => item.id === page.id)).toBe(false)
        await expect(wiki.trashDocument({
            characterId: 'character',
            chatId: 'chat',
            documentId: event.id,
        })).rejects.toThrow('Event documents are read-only')
    })

    test('manually edits event content while preserving its provenance and path', async () => {
        const root = await fs.mkdtemp(join(tmpdir(), 'risubard-md-wiki-'))
        temporaryDirectories.push(root)
        const times = [
            new Date('2026-08-08T08:00:00.000Z'),
            new Date('2026-08-08T09:00:00.000Z'),
        ]
        const wiki = createMarkdownNarrativeWiki(root, {
            now: () => times.shift() ?? new Date('2026-08-08T10:00:00.000Z'),
        })
        const event = await wiki.saveConfirmedTurn({
            characterId: 'character',
            chatId: 'chat',
            sourceMessageIds: ['user-1', 'assistant-1'],
            markdown: '## 잘못된 전투\n\n### 이야기 요약\n\n- 전투에서 승리했다.',
        })

        const edited = await wiki.saveManualDocument({
            characterId: 'character',
            chatId: 'chat',
            documentId: event.id,
            expectedContentHash: event.contentHash,
            type: 'event',
            title: '수정된 전투',
            markdown: '## 수정된 전투\n\n### 이야기 요약\n\n- 전투에서 패배했다.',
        })

        expect(edited).toMatchObject({
            id: event.id,
            type: 'event',
            title: '수정된 전투',
            relativePath: event.relativePath,
            sourceMessageIds: ['user-1', 'assistant-1'],
            created: event.created,
            authoring: 'manual',
            contextMode: 'auto',
        })
        expect(edited.content).toContain('전투에서 패배했다.')
        const workspace = resolveMarkdownWikiWorkspace(root, 'character', 'chat')
        expect(await fs.readdir(join(workspace.historyDirectory, event.id)))
            .toHaveLength(1)
    })

    test('permanently deletes a retracted event from the view and filesystem', async () => {
        const root = await fs.mkdtemp(join(tmpdir(), 'risubard-md-wiki-'))
        temporaryDirectories.push(root)
        const times = [
            new Date('2026-08-12T01:00:00.000Z'),
            new Date('2026-08-12T02:00:00.000Z'),
        ]
        const wiki = createMarkdownNarrativeWiki(root, {
            now: () => times.shift() ?? new Date('2026-08-12T03:00:00.000Z'),
        })
        const event = await wiki.saveConfirmedTurn({
            characterId: 'character',
            chatId: 'chat',
            sourceMessageIds: ['user-1', 'assistant-1'],
            markdown: '# 잘못된 첫 만남\n\n히사시가 등장했다.',
        })

        const retracted = await wiki.retractEvent({
            characterId: 'character',
            chatId: 'chat',
            documentId: event.id,
            expectedContentHash: event.contentHash,
        })

        expect(retracted).toMatchObject({
            id: event.id,
            type: 'event',
            status: 'retracted',
            content: event.content,
            updated: '2026-08-12T02:00:00.000Z',
        })
        expect((await wiki.loadView('character', 'chat')).documents
            .some((document) => document.id === event.id)).toBe(false)
        const workspace = resolveMarkdownWikiWorkspace(root, 'character', 'chat')
        await expect(fs.access(join(
            workspace.directory, ...event.relativePath.split('/')
        ))).rejects.toMatchObject({ code: 'ENOENT' })
        const inquiry = await wiki.inquire({
            characterId: 'character',
            chatId: 'chat',
            currentInput: '히사시 첫 만남',
        })
        expect(inquiry.sources.some((source) =>
            source.content.includes('히사시')
        )).toBe(false)
    })

    test('keeps a completed event retraction successful when index refresh fails', async () => {
        const root = await fs.mkdtemp(join(tmpdir(), 'risubard-md-wiki-'))
        temporaryDirectories.push(root)
        const workspace = resolveMarkdownWikiWorkspace(root, 'character', 'chat')
        let failIndexWrites = false
        const failingIndexFileSystem = {
            ...fs,
            writeFile: async (...args: unknown[]) => {
                if (failIndexWrites
                    && String(args[0]).startsWith(`${workspace.indexFile}.tmp-`)) {
                    throw new Error('index persistence failed')
                }
                return (fs.writeFile as unknown as (
                    ...values: unknown[]
                ) => Promise<void>)(...args)
            },
        } as unknown as NonNullable<
            Parameters<typeof createMarkdownNarrativeWiki>[1]
        >['fileSystem']
        const wiki = createMarkdownNarrativeWiki(root, {
            fileSystem: failingIndexFileSystem,
        })
        const event = await wiki.saveConfirmedTurn({
            characterId: 'character', chatId: 'chat',
            sourceMessageIds: ['user-1', 'assistant-1'],
            markdown: '# 삭제할 사건\n\n이미 끝난 사건이다.',
        })
        failIndexWrites = true

        await expect(wiki.retractEvent({
            characterId: 'character',
            chatId: 'chat',
            documentId: event.id,
            expectedContentHash: event.contentHash,
        })).resolves.toMatchObject({ id: event.id, status: 'retracted' })
        await expect(fs.access(join(
            workspace.directory, ...event.relativePath.split('/')
        ))).rejects.toMatchObject({ code: 'ENOENT' })
        expect((await wiki.loadView('character', 'chat')).documents
            .some((document) => document.id === event.id)).toBe(false)
    })

    test('purges legacy retracted event files when loading the wiki', async () => {
        const root = await fs.mkdtemp(join(tmpdir(), 'risubard-md-wiki-'))
        temporaryDirectories.push(root)
        const wiki = createMarkdownNarrativeWiki(root)
        const event = await wiki.saveConfirmedTurn({
            characterId: 'character', chatId: 'chat',
            sourceMessageIds: ['user-legacy', 'assistant-legacy'],
            markdown: '# 오래된 철회 사건\n\n더는 필요하지 않다.',
        })
        const workspace = resolveMarkdownWikiWorkspace(root, 'character', 'chat')
        const eventFile = join(
            workspace.directory, ...event.relativePath.split('/')
        )
        const stored = await fs.readFile(eventFile, 'utf8')
        await fs.writeFile(eventFile, stored.replace(
            'status: active', 'status: retracted'
        ))

        expect((await wiki.loadView('character', 'chat')).documents
            .some((document) => document.id === event.id)).toBe(false)
        await expect(fs.access(eventFile)).rejects.toMatchObject({ code: 'ENOENT' })
    })

    test('retracts active events linked to confirmed messages being deleted', async () => {
        const root = await fs.mkdtemp(join(tmpdir(), 'risubard-md-wiki-'))
        temporaryDirectories.push(root)
        const wiki = createMarkdownNarrativeWiki(root)
        const removed = await wiki.saveConfirmedTurn({
            characterId: 'character', chatId: 'chat',
            sourceMessageIds: ['user-1', 'assistant-1'],
            markdown: '# 잘못된 사건\n\n히사시가 등장했다.',
        })
        const kept = await wiki.saveConfirmedTurn({
            characterId: 'character', chatId: 'chat',
            sourceMessageIds: ['user-2', 'assistant-2'],
            markdown: '# 유지할 사건\n\n라비안이 출발했다.',
        })
        const canonical = await wiki.saveCanonicalDocument({
            characterId: 'character', chatId: 'chat',
            sourceMessageIds: ['user-1', 'assistant-1'],
            type: 'character', title: '히사시',
            markdown: `# 히사시\n\n## 관련 문서\n\n- [[${removed.title}]]`,
        })

        await expect(wiki.retractEventsBySourceMessages({
            characterId: 'character', chatId: 'chat',
            sourceMessageIds: [
                ...Array.from({ length: 100 }, (_, index) => `message-${index}`),
                'assistant-1',
            ],
        })).resolves.toEqual({ retractedIds: [removed.id] })
        const view = await wiki.loadView('character', 'chat')
        expect(view.documents.some((item) => item.id === removed.id)).toBe(false)
        expect(view.documents.find((item) => item.id === kept.id)?.status)
            .toBe('active')
        expect(view.documents.find((item) => item.id === canonical.id)?.status)
            .toBe('active')
    })

    test('keeps a stable canonical page and archives its previous revision', async () => {
        const root = await fs.mkdtemp(join(tmpdir(), 'risubard-md-wiki-'))
        temporaryDirectories.push(root)
        const times = [
            new Date('2026-08-08T01:00:00.000Z'),
            new Date('2026-08-08T02:00:00.000Z'),
        ]
        const wiki = createMarkdownNarrativeWiki(root, {
            now: () => times.shift() ?? new Date('2026-08-08T03:00:00.000Z'),
        })

        const created = await wiki.saveCanonicalDocument({
            characterId: 'character',
            chatId: 'chat',
            type: 'character',
            title: '라비안',
            sourceMessageIds: ['user-1', 'assistant-1'],
            markdown: '# 라비안\n\n## 현재 상태\n\n건강하다.',
        })
        const updated = await wiki.saveCanonicalDocument({
            characterId: 'character',
            chatId: 'chat',
            documentId: created.id,
            type: 'character',
            title: '라비안',
            sourceMessageIds: ['user-2', 'assistant-2'],
            markdown: '# 라비안\n\n## 현재 상태\n\n오른팔에 화상을 입었다.',
        })

        expect(updated.id).toBe(created.id)
        expect(updated.relativePath).toBe(created.relativePath)
        expect(updated.relativePath).toMatch(
            /^characters\/라비안-[a-zA-Z0-9_-]+\.md$/
        )
        const workspace = resolveMarkdownWikiWorkspace(root, 'character', 'chat')
        const revisions = await fs.readdir(
            join(workspace.historyDirectory, created.id)
        )
        expect(revisions).toHaveLength(1)
        expect(await fs.readFile(
            join(workspace.historyDirectory, created.id, revisions[0]),
            'utf8'
        )).toContain('건강하다')
        expect((await wiki.loadView('character', 'chat')).documents)
            .toEqual([expect.objectContaining({
                type: 'character',
                content: expect.stringContaining('화상을 입었다'),
            })])
    })

    test('stores a confirmed turn as an Obsidian-readable Markdown document', async () => {
        const root = await fs.mkdtemp(join(tmpdir(), 'risubard-md-wiki-'))
        temporaryDirectories.push(root)
        const wiki = createMarkdownNarrativeWiki(root, {
            now: () => new Date('2026-08-08T00:00:00.000Z'),
        })

        await wiki.saveConfirmedTurn({
            characterId: 'character',
            chatId: 'chat',
            sourceMessageIds: ['user-1', 'assistant-1'],
            markdown: '# 다리의 붕괴\n\n다리가 무너졌고 [[리나]]가 다쳤다.',
        })

        const workspace = resolveMarkdownWikiWorkspace(
            root,
            'character',
            'chat'
        )
        const files = await fs.readdir(workspace.eventsDirectory)
        expect(files).toHaveLength(1)
        const contents = await fs.readFile(
            join(workspace.eventsDirectory, files[0]),
            'utf8'
        )
        expect(contents).toContain('type: event')
        expect(contents).toContain('status: active')
        expect(contents).toContain('  - "user-1"')
        expect(contents).toContain('  - "assistant-1"')
        expect(contents).toContain('updated: "2026-08-08T00:00:00.000Z"')
        expect(contents).toContain('[[리나]]')
        expect(contents).not.toContain('operations:')

        const view = await wiki.loadView('character', 'chat')
        expect(view.wikiPath).toBe(workspace.directory)
        expect(view.documents).toEqual([
            expect.objectContaining({
                title: '다리의 붕괴',
                relativePath: `events/${files[0]}`,
                sourceMessageIds: ['user-1', 'assistant-1'],
            }),
        ])
        expect(await fs.readFile(workspace.indexFile, 'utf8')).toContain(
            `[[events/${files[0].replace(/\.md$/, '')}|다리의 붕괴]]`
        )
    })

    test('uses the Markdown documents directly as bounded inquiry sources', async () => {
        const root = await fs.mkdtemp(join(tmpdir(), 'risubard-md-wiki-'))
        temporaryDirectories.push(root)
        const wiki = createMarkdownNarrativeWiki(root)
        await wiki.saveConfirmedTurn({
            characterId: 'character',
            chatId: 'chat',
            sourceMessageIds: ['assistant-1'],
            markdown: '# 약속\n\n리나는 카인에게 돌아오겠다고 약속했다.',
        })

        const inquiry = await wiki.inquire({
            characterId: 'character',
            chatId: 'chat',
            currentInput: '리나의 약속',
        })

        expect(inquiry.sources).toEqual([
            expect.objectContaining({
                id: expect.stringMatching(/^narrative-memory:wiki:/),
                content: expect.stringContaining('돌아오겠다고 약속했다'),
            }),
        ])
        expect(inquiry.entityCandidates).toEqual([])
    })

    test('passes bounded semantic candidates into the inquiry core', async () => {
        const root = await fs.mkdtemp(join(tmpdir(), 'risubard-md-wiki-'))
        temporaryDirectories.push(root)
        const wiki = createMarkdownNarrativeWiki(root)
        const event = await wiki.saveConfirmedTurn({
            characterId: 'character',
            chatId: 'chat',
            sourceMessageIds: ['assistant-1'],
            markdown: '# 월광 의식\n\n은빛 구체를 제단 홈에 놓자 석문이 열렸다.',
        })

        const inquiry = await wiki.inquire({
            characterId: 'character',
            chatId: 'chat',
            currentInput: '출구를 막은 장치를 풀 방법이 필요하다.',
            semanticMatches: [{ documentId: event.id, score: 0.91 }],
        })

        expect(inquiry.sources[0]?.id).toBe(
            `narrative-memory:wiki:${event.relativePath}`
        )
        expect(inquiry.metrics.semanticCandidateCount).toBe(1)
    })

    test('retrieves linked provenance two hops away without scanning chat history', async () => {
        const root = await fs.mkdtemp(join(tmpdir(), 'risubard-md-wiki-'))
        temporaryDirectories.push(root)
        const wiki = createMarkdownNarrativeWiki(root)
        await wiki.saveManualDocument({
            characterId: 'project', chatId: 'chat', type: 'character',
            title: '프로도',
            markdown: '# 프로도\n\n## 현재 소지품\n\n- [[에아렌딜의 유리병]]',
        })
        await wiki.saveManualDocument({
            characterId: 'project', chatId: 'chat', type: 'item',
            title: '에아렌딜의 유리병',
            markdown: '# 에아렌딜의 유리병\n\n## 효능\n\n어둠 속에서 빛을 낸다.\n\n## 유래\n\n[[로스로리엔의 선물]]에서 받았다.',
        })
        const gift = await wiki.saveConfirmedTurn({
            characterId: 'project', chatId: 'chat',
            sourceMessageIds: ['gift-event'],
            markdown: '# 로스로리엔의 선물\n\n갈라드리엘이 가장 어두운 순간에 쓰라며 유리병을 건넸다.',
        })

        const inquiry = await wiki.inquire({
            characterId: 'project', chatId: 'chat',
            currentInput: '프로도가 쉘롭에게 공격당한다. 대항할 물건은 무엇인가?',
        })

        expect(inquiry.sources.some((source) =>
            source.id === `narrative-memory:wiki:${gift.relativePath}`)).toBe(true)
        expect(inquiry.metrics.hopCount).toBe(2)
    })

    test('always selects the current scene and excludes unrelated event notes', async () => {
        const root = await fs.mkdtemp(join(tmpdir(), 'risubard-md-wiki-'))
        temporaryDirectories.push(root)
        const wiki = createMarkdownNarrativeWiki(root)
        await wiki.saveConfirmedTurn({
            characterId: 'character',
            chatId: 'chat',
            sourceMessageIds: ['assistant-old'],
            markdown: '# 무관한 시장 사건\n\n상인이 사과를 팔았다.',
        })
        await wiki.saveCanonicalDocument({
            characterId: 'character',
            chatId: 'chat',
            type: 'character',
            title: '라비안',
            sourceMessageIds: ['assistant-new'],
            markdown: '# 라비안\n\n오른팔에 화상을 입었다.',
        })
        await wiki.saveCanonicalDocument({
            characterId: 'character',
            chatId: 'chat',
            type: 'scene',
            title: '현재 장면',
            sourceMessageIds: ['assistant-new'],
            markdown: '# 현재 장면\n\n일행은 소성당 안에 있다.',
        })

        const inquiry = await wiki.inquire({
            characterId: 'character',
            chatId: 'chat',
            currentInput: '라비안의 상태는?',
        })

        expect(inquiry.sources.map((source) => source.id)).toEqual([
            'narrative-memory:wiki:current-scene.md',
            expect.stringMatching(/^narrative-memory:wiki:characters\//),
        ])
        expect(inquiry.sources.some((source) =>
            source.id.includes('events/'))).toBe(false)
    })

    test('weights exact titles above newer body-only matches', async () => {
        const root = await fs.mkdtemp(join(tmpdir(), 'risubard-md-wiki-'))
        temporaryDirectories.push(root)
        const wiki = createMarkdownNarrativeWiki(root)
        const titleMatch = await wiki.saveManualDocument({
            characterId: 'project', chatId: 'chat', type: 'location',
            title: '침수된 도서관', markdown: '# 침수된 도서관\n\n지하 서고가 폐쇄되었다.',
        })
        await wiki.saveManualDocument({
            characterId: 'project', chatId: 'chat', type: 'other',
            title: '최근 메모', markdown: '# 최근 메모\n\n침수된 도서관에 관한 일반적인 기록.',
        })

        const inquiry = await wiki.inquire({
            characterId: 'project', chatId: 'chat',
            currentInput: '침수된 도서관',
        })

        expect(inquiry.sources[0]?.id).toBe(
            `narrative-memory:wiki:${titleMatch.relativePath}`
        )
    })

    test('reports bounded dangling links and unlinked canonical pages', async () => {
        const root = await fs.mkdtemp(join(tmpdir(), 'risubard-md-wiki-'))
        temporaryDirectories.push(root)
        const wiki = createMarkdownNarrativeWiki(root)
        const linked = await wiki.saveManualDocument({
            characterId: 'character', chatId: 'chat', type: 'character',
            title: '라비안', markdown: '# 라비안\n\n[[없는 장소]]를 찾는다.',
        })
        const isolated = await wiki.saveManualDocument({
            characterId: 'character', chatId: 'chat', type: 'location',
            title: '고립된 탑', markdown: '# 고립된 탑\n\n아무 링크도 없다.',
        })

        const view = await wiki.loadView('character', 'chat')

        expect(view.health.danglingLinks).toEqual([{
            sourceId: linked.id,
            target: '없는 장소',
        }])
        expect(view.health.unlinkedDocumentIds).toEqual(expect.arrayContaining([
            linked.id,
            isolated.id,
        ]))
    })

    test('reports exact normalized duplicate passages without changing documents', async () => {
        const root = await fs.mkdtemp(join(tmpdir(), 'risubard-md-wiki-'))
        temporaryDirectories.push(root)
        const wiki = createMarkdownNarrativeWiki(root)
        const shared = '교회 지하 통로의 석벽에는 하얀 손 문양이 일정한 간격으로 반복되어 있었고, 문양 아래에는 아직 해독되지 않은 고대 문자가 길게 새겨져 있었다.'
        const first = await wiki.saveManualDocument({
            characterId: 'character', chatId: 'chat', type: 'location',
            title: '아르세존 교회',
            markdown: `## 아르세존 교회\n\n${shared}\n\n${shared}`,
        })
        const second = await wiki.saveManualDocument({
            characterId: 'character', chatId: 'chat', type: 'other',
            title: '사교도의 흔적',
            markdown: `## 사교도의 흔적\n\n${shared.replace('일정한 간격으로', '일정한\n간격으로')}`,
        })
        await wiki.saveManualDocument({
            characterId: 'character', chatId: 'chat', type: 'concept',
            title: '문양 색인',
            markdown: '## 문양 색인\n\n- [[아르세존 교회]] [[사교도의 흔적]] [[하얀 손 문양]] [[고대 문자]] [[지하 통로]]',
        })

        const view = await wiki.loadView('character', 'chat')

        expect(view.health.duplicatePassages).toEqual([{
            documentIds: [first.id, second.id].sort(),
        }])
        expect(view.documents.find((document) => document.id === first.id)?.content)
            .toContain(shared)
    })

    test('honors always and never context modes in bounded inquiry', async () => {
        const root = await fs.mkdtemp(join(tmpdir(), 'risubard-md-wiki-'))
        temporaryDirectories.push(root)
        const wiki = createMarkdownNarrativeWiki(root)
        const pinned = await wiki.saveManualDocument({
            characterId: 'character', chatId: 'chat', type: 'character',
            title: '라비안', markdown: '# 라비안\n\n항상 포함할 인물.',
        })
        const excluded = await wiki.saveManualDocument({
            characterId: 'character', chatId: 'chat', type: 'location',
            title: '금지된 탑', markdown: '# 금지된 탑\n\n비밀 장소.',
        })
        await wiki.setDocumentContextMode({
            characterId: 'character', chatId: 'chat',
            documentId: pinned.id, contextMode: 'always',
            expectedContentHash: pinned.contentHash,
        })
        await wiki.setDocumentContextMode({
            characterId: 'character', chatId: 'chat',
            documentId: excluded.id, contextMode: 'never',
            expectedContentHash: excluded.contentHash,
        })

        const inquiry = await wiki.inquire({
            characterId: 'character', chatId: 'chat',
            currentInput: '금지된 탑의 비밀',
        })

        expect(inquiry.sources.map((source) => source.id)).toEqual([
            `narrative-memory:wiki:${pinned.relativePath}`,
        ])
    })

    test('rejects stale canonical approvals and excessive required context', async () => {
        const root = await fs.mkdtemp(join(tmpdir(), 'risubard-md-wiki-'))
        temporaryDirectories.push(root)
        const wiki = createMarkdownNarrativeWiki(root)
        const original = await wiki.saveManualDocument({
            characterId: 'character', chatId: 'chat', type: 'character',
            title: '라비안', markdown: '# 라비안\n\n처음 상태.',
        })
        await wiki.saveManualDocument({
            characterId: 'character', chatId: 'chat', documentId: original.id,
            type: 'character', title: '라비안',
            markdown: '# 라비안\n\n사용자가 고친 상태.',
            expectedContentHash: original.contentHash,
        })
        await expect(wiki.saveCanonicalDocument({
            characterId: 'character', chatId: 'chat', documentId: original.id,
            type: 'character', title: '라비안',
            sourceMessageIds: ['assistant-1'],
            markdown: '# 라비안\n\n오래된 AI 초안.',
            expectedContentHash: original.contentHash,
        })).rejects.toThrow('Wiki document changed since the draft was created')

        for (let index = 0; index < 13; index += 1) {
            const page = await wiki.saveManualDocument({
                characterId: 'character', chatId: 'required', type: 'concept',
                title: `필수 ${index}`, markdown: `# 필수 ${index}\n\n설명.`,
            })
            await wiki.setDocumentContextMode({
                characterId: 'character', chatId: 'required',
                documentId: page.id, contextMode: 'always',
                expectedContentHash: page.contentHash,
            })
        }
        await expect(wiki.inquire({
            characterId: 'character', chatId: 'required', currentInput: '무관',
        })).rejects.toThrow('Required wiki context exceeds 12 documents')
    })

    test('keeps one review baseline across automatic canonical revisions', async () => {
        const root = await fs.mkdtemp(join(tmpdir(), 'risubard-md-wiki-'))
        temporaryDirectories.push(root)
        const wiki = createMarkdownNarrativeWiki(root)
        const original = await wiki.saveManualDocument({
            characterId: 'character', chatId: 'chat', type: 'character',
            title: '라비안', markdown: '# 라비안\n\n검을 들고 있다.',
        })
        const first = await wiki.saveCanonicalDocument({
            characterId: 'character', chatId: 'chat', documentId: original.id,
            type: 'character', title: '라비안', sourceMessageIds: ['turn-1'],
            markdown: '# 라비안\n\n창을 들고 있다.',
            expectedContentHash: original.contentHash,
            reviewStatus: 'unreviewed',
        })
        await wiki.saveCanonicalDocument({
            characterId: 'character', chatId: 'chat', documentId: original.id,
            type: 'character', title: '라비안', sourceMessageIds: ['turn-2'],
            markdown: '# 라비안\n\n은빛 창을 들고 있다.',
            expectedContentHash: first.contentHash,
            reviewStatus: 'unreviewed',
        })

        const current = (await wiki.loadView('character', 'chat')).documents
            .find((document) => document.id === original.id)
        expect(current).toMatchObject({
            reviewStatus: 'unreviewed',
            reviewBaseContent: '## 라비안\n\n검을 들고 있다.',
            content: '## 라비안\n\n은빛 창을 들고 있다.',
        })
    })

    test('accepts or reverts an unreviewed automatic canonical batch', async () => {
        const root = await fs.mkdtemp(join(tmpdir(), 'risubard-md-wiki-'))
        temporaryDirectories.push(root)
        const wiki = createMarkdownNarrativeWiki(root)
        const original = await wiki.saveManualDocument({
            characterId: 'character', chatId: 'chat', type: 'item',
            title: '열쇠', markdown: '# 열쇠\n\n붉은 열쇠.',
        })
        const automatic = await wiki.saveCanonicalDocument({
            characterId: 'character', chatId: 'chat', documentId: original.id,
            type: 'item', title: '열쇠', sourceMessageIds: ['turn-1'],
            markdown: '# 열쇠\n\n푸른 열쇠.',
            expectedContentHash: original.contentHash,
            reviewStatus: 'unreviewed',
        })
        const reverted = await wiki.reviewCanonicalDocument({
            characterId: 'character', chatId: 'chat', documentId: original.id,
            action: 'revert', expectedContentHash: automatic.contentHash,
        })
        expect(reverted).toMatchObject({
            reviewStatus: 'reviewed',
            content: '## 열쇠\n\n붉은 열쇠.',
        })

        const next = await wiki.saveCanonicalDocument({
            characterId: 'character', chatId: 'chat', documentId: original.id,
            type: 'item', title: '열쇠', sourceMessageIds: ['turn-2'],
            markdown: '# 열쇠\n\n금빛 열쇠.',
            expectedContentHash: reverted.contentHash,
            reviewStatus: 'unreviewed',
        })
        const accepted = await wiki.reviewCanonicalDocument({
            characterId: 'character', chatId: 'chat', documentId: original.id,
            action: 'accept', expectedContentHash: next.contentHash,
        })
        expect(accepted).toMatchObject({
            reviewStatus: 'reviewed',
            content: '## 열쇠\n\n금빛 열쇠.',
        })
        expect(accepted.reviewBaseContent).toBeUndefined()
    })

    test('removes a newly created automatic canonical when reverted', async () => {
        const root = await fs.mkdtemp(join(tmpdir(), 'risubard-md-wiki-'))
        temporaryDirectories.push(root)
        const wiki = createMarkdownNarrativeWiki(root)
        const created = await wiki.saveCanonicalDocument({
            characterId: 'character', chatId: 'chat', type: 'scene',
            title: '현재 장면', sourceMessageIds: ['turn-1'],
            markdown: '# 현재 장면\n\n성문 앞에 도착했다.',
            reviewStatus: 'unreviewed',
        })
        await expect(wiki.reviewCanonicalDocument({
            characterId: 'character', chatId: 'chat', documentId: created.id,
            action: 'revert', expectedContentHash: created.contentHash,
        })).resolves.toEqual({
            id: created.id, reverted: true, deleted: true,
        })
        expect((await wiki.loadView('character', 'chat')).documents
            .some((document) => document.id === created.id)).toBe(false)
    })

    test('restores the one BARDCHAT snapshot after updates, creates, and trash', async () => {
        const root = await fs.mkdtemp(join(tmpdir(), 'risubard-md-wiki-'))
        temporaryDirectories.push(root)
        const wiki = createMarkdownNarrativeWiki(root)
        const original = await wiki.saveManualDocument({
            characterId: 'character', chatId: 'chat', type: 'character',
            title: '라비안', markdown: '# 라비안\n\n처음 상태.',
        })
        const discarded = await wiki.saveManualDocument({
            characterId: 'character', chatId: 'chat', type: 'concept',
            title: '보존 문서', markdown: '# 보존 문서\n\n지워지기 전.',
        })
        await wiki.beginBardChatUndo({ characterId: 'character', chatId: 'chat' })
        const updated = await wiki.saveManualDocument({
            characterId: 'character', chatId: 'chat', documentId: original.id,
            type: 'character', title: '라비안', markdown: '# 라비안\n\n변경 상태.',
            expectedContentHash: original.contentHash,
        })
        await wiki.saveManualDocument({
            characterId: 'character', chatId: 'chat', type: 'concept',
            title: '추가 문서', markdown: '# 추가 문서\n\n새 내용.',
        })
        await wiki.trashDocument({
            characterId: 'character', chatId: 'chat', documentId: discarded.id,
        })
        await wiki.finalizeBardChatUndo({ characterId: 'character', chatId: 'chat' })

        await expect(wiki.getBardChatUndoStatus({
            characterId: 'character', chatId: 'chat',
        })).resolves.toEqual({ available: true })
        await expect(wiki.restoreBardChatUndo({
            characterId: 'character', chatId: 'chat',
        })).resolves.toEqual({ restored: true })
        const restored = await wiki.loadView('character', 'chat')
        expect(restored.documents).toHaveLength(2)
        expect(restored.documents.find((document) => document.id === original.id)).toMatchObject({
            id: original.id, content: '## 라비안\n\n처음 상태.',
        })
        expect(restored.documents.find((document) => document.id === discarded.id))
            .toMatchObject({ content: '## 보존 문서\n\n지워지기 전.' })
        expect(updated.contentHash).not.toBe(original.contentHash)
        await expect(wiki.getBardChatUndoStatus({
            characterId: 'character', chatId: 'chat',
        })).resolves.toEqual({ available: false })
    })

    test('refuses BARDCHAT restore after a later manual edit', async () => {
        const root = await fs.mkdtemp(join(tmpdir(), 'risubard-md-wiki-'))
        temporaryDirectories.push(root)
        const wiki = createMarkdownNarrativeWiki(root)
        const original = await wiki.saveManualDocument({
            characterId: 'character', chatId: 'chat', type: 'character',
            title: '라비안', markdown: '# 라비안\n\n처음 상태.',
        })
        await wiki.beginBardChatUndo({ characterId: 'character', chatId: 'chat' })
        const commandEdit = await wiki.saveManualDocument({
            characterId: 'character', chatId: 'chat', documentId: original.id,
            type: 'character', title: '라비안', markdown: '# 라비안\n\n명령 변경.',
            expectedContentHash: original.contentHash,
        })
        await wiki.finalizeBardChatUndo({ characterId: 'character', chatId: 'chat' })
        await wiki.saveManualDocument({
            characterId: 'character', chatId: 'chat', documentId: original.id,
            type: 'character', title: '라비안', markdown: '# 라비안\n\n후속 수동 변경.',
            expectedContentHash: commandEdit.contentHash,
        })

        await expect(wiki.restoreBardChatUndo({
            characterId: 'character', chatId: 'chat',
        })).rejects.toThrow('changed after the BARDCHAT command')
    })

    test('keeps Japanese related documents a single section across saves', async () => {
        const root = await fs.mkdtemp(join(tmpdir(), 'risubard-md-wiki-'))
        temporaryDirectories.push(root)
        const wiki = createMarkdownNarrativeWiki(root)
        await wiki.saveCanonicalDocument({
            characterId: 'character', chatId: 'chat', type: 'location',
            title: 'エリュシオン学園', sourceMessageIds: ['user-1'],
            markdown: '## エリュシオン学園\n\n魔法の学園。',
            writingLanguage: 'ja',
        })
        const canon = await wiki.saveCanonicalDocument({
            characterId: 'character', chatId: 'chat', type: 'character',
            title: 'シロ', sourceMessageIds: ['user-1', 'assistant-1'],
            markdown: '## シロ\n\nエリュシオン学園の新入生。',
            writingLanguage: 'ja',
        })
        expect(canon.content).toContain('### 関連文書')

        const updated = await wiki.saveCanonicalDocument({
            characterId: 'character', chatId: 'chat', type: 'character',
            title: 'シロ', sourceMessageIds: ['user-2', 'assistant-2'],
            markdown: '## シロ\n\n### 現在の状態\n\n- エリュシオン学園の新入生。',
            writingLanguage: 'ja',
        })
        const sections = updated.content.match(/^### 関連文書$/gm) ?? []
        expect(sections).toHaveLength(1)
        expect(updated.content).toContain('### 関連文書')
    })

    test('removes event links from Japanese related documents and prunes emptied sections', async () => {
        const root = await fs.mkdtemp(join(tmpdir(), 'risubard-md-wiki-'))
        temporaryDirectories.push(root)
        const wiki = createMarkdownNarrativeWiki(root)
        const event = await wiki.saveConfirmedTurn({
            characterId: 'character', chatId: 'chat',
            sourceMessageIds: ['user-1', 'assistant-1'],
            markdown: '## 出会い\n\n### 物語要約\n\n- 二人は出会った。',
        })
        const created = await wiki.saveCanonicalDocument({
            characterId: 'character', chatId: 'chat', type: 'character',
            title: 'リズレット', sourceMessageIds: ['user-1'],
            markdown: [
                '## リズレット',
                '',
                '### 作中行動',
                '',
                '- [[出会い]]で初めて会った。',
                '',
                '### 関連文書',
                '',
                '- [[出会い]]',
            ].join('\n'),
        })
        expect(created.content).toContain('### 作中行動')
        expect(created.content).not.toContain('### 関連文書')
        expect(created.links).toEqual(['出会い'])
        expect(event.id).toBeTruthy()
    })
})
