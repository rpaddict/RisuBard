// @vitest-environment happy-dom
import { mount, tick, unmount } from 'svelte'
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import RisuBardWikiEditor from './RisuBardWikiEditor.svelte'

const mocks = vi.hoisted(() => ({
    saveManualWikiDocument: vi.fn(),
    trashWikiDocument: vi.fn(),
    retractWikiEvent: vi.fn(),
    revealWikiDocument: vi.fn(),
    setWikiDocumentContextMode: vi.fn(),
    createAuth: vi.fn(async () => 'token'),
    requestImmediateSave: vi.fn(async () => undefined),
    alertConfirmMulti: vi.fn(async () => 0),
    db: {
        characters: [] as Array<Record<string, any>>,
        risuBardWikiMarkdownPreview: undefined as boolean | undefined,
    },
}))

vi.mock('src/ts/risubard/memoryWiki', async (importOriginal) => ({
    ...await importOriginal<typeof import('src/ts/risubard/memoryWiki')>(),
    saveManualWikiDocument: mocks.saveManualWikiDocument,
    trashWikiDocument: mocks.trashWikiDocument,
    retractWikiEvent: mocks.retractWikiEvent,
    revealWikiDocument: mocks.revealWikiDocument,
    setWikiDocumentContextMode: mocks.setWikiDocumentContextMode,
}))
vi.mock('src/ts/globalApi.svelte', () => ({
    forageStorage: { createAuth: mocks.createAuth },
    requestImmediateSave: mocks.requestImmediateSave,
}))
vi.mock('src/ts/stores.svelte', () => ({
    DBState: { get db() { return mocks.db } },
}))
vi.mock('src/ts/alert', () => ({
    alertConfirmMulti: mocks.alertConfirmMulti,
}))

const documents = [{
    id: 'character.lavian',
    type: 'character' as const,
    status: 'active' as const,
    title: '라비안',
    aliases: ['기사님'],
    relativePath: 'characters/라비안.md',
    sourceMessageIds: [],
    updated: '2026-08-08T00:00:00.000Z',
    content: '# 라비안\n\n기사.',
    links: [],
    contextMode: 'auto' as const,
    contentHash: 'hash-lavian',
}, {
    id: 'event.turn',
    type: 'event' as const,
    status: 'active' as const,
    title: '전투',
    aliases: [],
    relativePath: 'events/turn-1.md',
    sourceMessageIds: ['assistant-1'],
    updated: '2026-08-08T00:01:00.000Z',
    content: '# 전투\n\n승리했다.',
    links: [],
    contextMode: 'auto' as const,
    contentHash: 'hash-event',
}]

let mounted: ReturnType<typeof mount> | undefined

afterEach(async () => {
    if (mounted) await unmount(mounted)
    mounted = undefined
    document.body.replaceChildren()
    vi.clearAllMocks()
    vi.unstubAllGlobals()
    mocks.db.risuBardWikiMarkdownPreview = undefined
})

describe('RisuBardWikiEditor', () => {
    it('uses an explicit BARDCHAT update set instead of older automatic badges', async () => {
        mounted = mount(RisuBardWikiEditor, {
            target: document.body,
            props: {
                characterId: 'character', chatId: 'chat',
                documents,
                highlightedDocumentIds: ['character.lavian'],
            },
        })
        await tick()

        const badges = [...document.querySelectorAll('[data-wiki-recent-update]')]
        expect(badges.map((badge) => badge.parentElement?.getAttribute('aria-label')))
            .toEqual(['라비안 '])
    })

    it('shows recent update badges on the right of root and folder pages without changing their selection', async () => {
        mounted = mount(RisuBardWikiEditor, {
            target: document.body,
            props: {
                characterId: 'character', chatId: 'chat',
                documents: [
                    ...documents,
                    { ...documents[0], id: 'scene', title: '현재 장면', type: 'scene',
                        relativePath: 'current-scene.md', updated: '2026-08-08T00:01:02Z' },
                    { ...documents[0], id: 'new-character', title: '새 인물',
                        updated: '2026-08-08T00:01:04Z', relativePath: 'characters/new.md' },
                ],
            },
        })
        await tick()
        const badges = [...document.querySelectorAll('[data-wiki-recent-update]')]
        expect(badges.map((badge) => badge.parentElement?.getAttribute('aria-label')))
            .toEqual(['현재 장면', '새 인물 ', '전투 '])
        expect(badges.every((badge) => badge.textContent === 'New'
            && badge === badge.parentElement?.lastElementChild)).toBe(true)
        badges[0].parentElement!.click()
        await tick()
        expect(document.querySelector<HTMLInputElement>('[aria-label="항목 이름"]')?.value)
            .toBe('현재 장면')
    })

    it('keeps save, revert, and delete icon-only in the editor toolbar', async () => {
        const target = document.body.appendChild(document.createElement('div'))
        mounted = mount(RisuBardWikiEditor, {
            target,
            props: { characterId: 'character', chatId: 'chat', documents },
        })
        await tick()

        const titleRow = document.querySelector('[data-wiki-title-row]')
        const toolbar = document.querySelector('[data-wiki-action-toolbar]')
        expect(titleRow?.querySelector('[aria-label="항목 유형"]')).not.toBeNull()
        expect(titleRow?.querySelector('[aria-label="항목 이름"]')).not.toBeNull()
        expect(toolbar).not.toBeNull()
        expect([...toolbar!.querySelectorAll('button')].map((button) =>
            button.textContent?.trim()
        )).toEqual(['', '', '로어북에 복사', ''])
        expect(toolbar!.querySelectorAll('[data-wiki-action-label]')).toHaveLength(1)
        expect([...toolbar!.querySelectorAll('button')].map((button) =>
            button.getAttribute('aria-label')
        )).toEqual(['저장', '되돌리기', '로어북에 복사', '삭제'])

        const source = readFileSync(
            'src/lib/Others/RisuBardWikiEditor.svelte',
            'utf8'
        )
        expect(source).toContain('container-name: wiki-editor-pane')
        expect(source).toContain('@container wiki-editor-pane (max-width: 32rem)')
        expect(source).toMatch(/\.editor-actions\s*\{[^}]*flex-wrap:\s*nowrap/s)
        expect(document.body.textContent).not.toContain('characters/라비안.md')
        expect(document.body.textContent).not.toContain('context: auto')
    })

    it('offers a creature document type', async () => {
        mounted = mount(RisuBardWikiEditor, {
            target: document.body,
            props: { characterId: 'character', chatId: 'chat', documents },
        })
        await tick()

        const option = document.querySelector<HTMLOptionElement>(
            '[aria-label="항목 유형"] option[value="creature"]'
        )
        expect(option?.textContent).toBe('종족·생물')
    })

    it('keeps a visible vertical scrollbar in the Markdown editor', () => {
        const source = readFileSync(
            'src/lib/Others/RisuBardWikiEditor.svelte',
            'utf8'
        )

        expect(source).toMatch(
            /\.markdown-editor\s*\{[^}]*overflow-y:\s*scroll[^}]*scrollbar-gutter:\s*stable[^}]*scrollbar-width:\s*thin/s
        )
        expect(source).toMatch(
            /\.markdown-editor::\-webkit-scrollbar-thumb\s*\{[^}]*background-color:\s*color-mix\(/s
        )
        expect(source).toMatch(
            /\.markdown-preview\s*\{[^}]*overflow-y:\s*scroll[^}]*scrollbar-gutter:\s*stable[^}]*scrollbar-width:\s*thin/s
        )
    })

    it('marks dangling-link files red without offering automatic repair', async () => {
        const brokenDocuments = [{
            ...documents[0],
            content: '# 라비안\n\n[[사라진 도시#성문|그곳]]으로 향했다.',
            links: ['사라진 도시#성문|그곳'],
        }, documents[1]]
        mounted = mount(RisuBardWikiEditor, {
            target: document.body,
            props: {
                characterId: 'character', chatId: 'chat',
                documents: brokenDocuments,
                health: {
                    danglingLinks: [{
                        sourceId: 'character.lavian', target: '사라진 도시',
                    }],
                    unlinkedDocumentIds: [],
                },
            },
        })
        await tick()

        const row = document.querySelector<HTMLElement>(
            '[data-wiki-dangling-document="character.lavian"]'
        )!
        expect(row).not.toBeNull()
        expect(row.classList.contains('dangling-link')).toBe(true)
        expect(row.querySelector('[data-wiki-repair-link]')).toBeNull()
    })

    it('shows duplicate passage warnings without offering automatic repair', async () => {
        mounted = mount(RisuBardWikiEditor, {
            target: document.body,
            props: {
                characterId: 'character', chatId: 'chat', documents,
                health: {
                    danglingLinks: [],
                    unlinkedDocumentIds: [],
                    duplicatePassages: [{
                        documentIds: ['character.lavian', 'event.turn'],
                    }],
                } as any,
            },
        })
        await tick()

        expect(document.body.textContent).toContain('본문 중복 1')
        expect(document.querySelectorAll('[data-wiki-duplicate-document]'))
            .toHaveLength(2)
        expect(document.querySelector('[data-wiki-repair-duplicate]')).toBeNull()
    })

    it('toggles a live, safe Markdown preview from the editor toolbar', async () => {
        const previewDocuments = [{
            ...documents[0],
            content: [
                '## 라비안',
                '',
                '**기사**',
                '',
                '| 항목 | 현재값 |',
                '|---|---:|',
                '| 자금 | 10 |',
                '',
                '<script>window.wikiPreviewExecuted = true</script>',
            ].join('\n'),
        }]
        mounted = mount(RisuBardWikiEditor, {
            target: document.body,
            props: {
                characterId: 'character', chatId: 'chat',
                documents: previewDocuments,
            },
        })
        await tick()

        const toggle = document.querySelector<HTMLInputElement>(
            '[data-wiki-markdown-toggle]'
        )!
        expect(toggle).not.toBeNull()
        expect(toggle.checked).toBe(false)
        expect(document.querySelector('[data-wiki-markdown-preview]')).toBeNull()

        toggle.click()
        await tick()

        const preview = document.querySelector<HTMLElement>(
            '[data-wiki-markdown-preview]'
        )!
        expect(preview.querySelector('h2')?.textContent).toBe('라비안')
        expect(preview.querySelector('strong')?.textContent).toBe('기사')
        expect(preview.querySelector('table')).not.toBeNull()
        expect(preview.querySelector('script')).toBeNull()
        expect(preview.textContent).toContain('<script>')
        expect(document.querySelector('[aria-label="Markdown"]')).toBeNull()

        toggle.click()
        await tick()
        expect(document.querySelector('[data-wiki-markdown-preview]')).toBeNull()
        expect(document.querySelector<HTMLTextAreaElement>(
            '[aria-label="Markdown"]'
        )?.value).toBe(previewDocuments[0].content)
    })

    it('distinguishes missing links from name collisions and explains both on activation', async () => {
        mocks.db.risuBardWikiMarkdownPreview = true
        const collisionDocuments = [{
            ...documents[0],
            content: '# 라비안\n\n[[없는 도시]]와 [[공통 이름]]',
        }, {
            ...documents[1],
            title: '공통 이름',
        }, {
            ...documents[1],
            id: 'location.second',
            title: '두 번째 문서',
            aliases: ['공통 이름'],
            relativePath: 'locations/second.md',
        }]
        mounted = mount(RisuBardWikiEditor, {
            target: document.body,
            props: { characterId: 'character', chatId: 'chat', documents: collisionDocuments },
        })
        await tick()

        const missing = document.querySelector<HTMLElement>('[data-wikilink-status="missing"]')!
        const ambiguous = document.querySelector<HTMLElement>('[data-wikilink-status="ambiguous"]')!
        expect(missing.classList.contains('wikilink-ambiguous')).toBe(false)
        expect(missing.title).toBe('연결된 문서가 없습니다: 없는 도시')
        expect(ambiguous.classList.contains('wikilink-ambiguous')).toBe(true)
        expect(ambiguous.title).toBe('이름이 겹칩니다: 공통 이름, 두 번째 문서')
        expect(ambiguous.getAttribute('tabindex')).toBe('0')

        ambiguous.click()
        await tick()
        expect(document.querySelector('[data-wiki-link-diagnostic]')?.textContent)
            .toBe('이름이 겹칩니다: 공통 이름, 두 번째 문서')

        missing.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
        await tick()
        expect(document.querySelector('[data-wiki-link-diagnostic]')?.textContent)
            .toBe('연결된 문서가 없습니다: 없는 도시')
    })

    it('opens the responsive document sidebar on demand and closes it from the scrim', async () => {
        const onFocusModeChange = vi.fn()
        const target = document.body.appendChild(document.createElement('div'))
        mounted = mount(RisuBardWikiEditor, {
            target,
            props: {
                characterId: 'character',
                chatId: 'chat',
                documents,
                onFocusModeChange,
            },
        })
        await tick()

        const editor = document.querySelector<HTMLElement>('[data-wiki-editor]')!
        expect(editor.dataset.treeExpanded).toBe('false')
        expect(editor.dataset.editorExpanded).toBe('true')
        expect(editor.dataset.editorFocus).toBe('false')
        expect(document.querySelector('[data-wiki-tree-scrim]')).toBeNull()

        document.querySelector<HTMLButtonElement>(
            '[data-wiki-toggle-tree]'
        )?.click()
        await tick()
        expect(editor.dataset.treeExpanded).toBe('true')
        const scrim = document.querySelector<HTMLButtonElement>(
            '[data-wiki-tree-scrim]'
        )
        expect(scrim?.getAttribute('aria-label')).toBe('문서 목록 닫기')

        scrim?.click()
        await tick()
        expect(editor.dataset.treeExpanded).toBe('false')
        expect(document.querySelector('[data-wiki-tree-scrim]')).toBeNull()

        document.querySelector<HTMLButtonElement>(
            '[data-wiki-editor-focus]'
        )?.click()
        await tick()
        expect(editor.dataset.editorFocus).toBe('true')
        expect(editor.dataset.editorExpanded).toBe('true')
        expect(onFocusModeChange).toHaveBeenLastCalledWith(true)
    })

    it('restores the Markdown preview toggle from the persisted database setting', async () => {
        mocks.db.risuBardWikiMarkdownPreview = true
        mounted = mount(RisuBardWikiEditor, {
            target: document.body,
            props: { characterId: 'character', chatId: 'chat', documents },
        })
        await tick()

        const toggle = document.querySelector<HTMLInputElement>(
            '[data-wiki-markdown-toggle]'
        )!
        expect(toggle.checked).toBe(true)
        expect(document.querySelector('[data-wiki-markdown-preview]')).not.toBeNull()

        toggle.click()
        await tick()
        expect(mocks.db.risuBardWikiMarkdownPreview).toBe(false)

        await unmount(mounted)
        mounted = mount(RisuBardWikiEditor, {
            target: document.body,
            props: { characterId: 'character', chatId: 'chat', documents },
        })
        await tick()

        expect(document.querySelector<HTMLInputElement>(
            '[data-wiki-markdown-toggle]'
        )?.checked).toBe(false)
        expect(document.querySelector('[data-wiki-markdown-preview]')).toBeNull()
    })

    it('uses an explicit mobile overlay drawer instead of stacking the tree above the editor', () => {
        const source = readFileSync(
            'src/lib/Others/RisuBardWikiEditor.svelte',
            'utf8'
        )

        expect(source).toContain('class:mobile-layout={mobileLayout}')
        expect(source).toMatch(/\.wiki-editor\.mobile-layout \.file-tree\s*\{[^}]*position:\s*absolute[^}]*transform:\s*translateX\(-100%\)/s)
        expect(source).toContain(
            '.wiki-editor.mobile-layout:not(.tree-collapsed) .file-tree'
        )
        expect(source).toContain('.tree-scrim')
    })

    it('copies a saved wiki document into the character lorebook without AI', async () => {
        const character = { chaId: 'character', globalLore: [] }
        mocks.db.characters = [character]
        const target = document.body.appendChild(document.createElement('div'))
        mounted = mount(RisuBardWikiEditor, {
            target,
            props: { characterId: 'character', chatId: 'chat', documents },
        })
        await tick()

        const copy = [...document.querySelectorAll('button')]
            .find((button) => button.textContent?.trim() === '로어북에 복사')!
        copy.click()

        await vi.waitFor(() => expect(character.globalLore).toHaveLength(1))
        expect(character.globalLore[0]).toEqual(expect.objectContaining({
            comment: '라비안',
            content: '# 라비안\n\n기사.',
            enabled: false,
            alwaysActive: false,
            key: '',
            secondkey: '',
        }))
        expect(mocks.alertConfirmMulti).not.toHaveBeenCalled()
        expect(mocks.requestImmediateSave).toHaveBeenCalledWith({
            forceFullWrite: true,
            rejectOnFailure: true,
        })
    })

    it('asks whether to overwrite or create a suffixed lorebook entry', async () => {
        const existing = {
            id: 'existing', comment: '라비안', content: 'old', enabled: true,
            key: 'old-key', secondkey: '', insertorder: 100, mode: 'normal',
            alwaysActive: true, selective: false,
        }
        const character = { chaId: 'character', globalLore: [existing] }
        mocks.db.characters = [character]
        mocks.alertConfirmMulti.mockResolvedValueOnce(0)
        const target = document.body.appendChild(document.createElement('div'))
        mounted = mount(RisuBardWikiEditor, {
            target,
            props: { characterId: 'character', chatId: 'chat', documents },
        })
        await tick()

        const copy = [...document.querySelectorAll('button')]
            .find((button) => button.textContent?.trim() === '로어북에 복사')!
        copy.click()

        await vi.waitFor(() => expect(character.globalLore[0].content)
            .toBe('# 라비안\n\n기사.'))
        expect(mocks.alertConfirmMulti).toHaveBeenCalledWith(
            expect.stringContaining('같은 이름'),
            [expect.objectContaining({ label: '덮어쓰기' }),
                expect.objectContaining({ label: '새 항목으로 복사' })],
            expect.any(String)
        )
        expect(character.globalLore).toHaveLength(1)
        expect(character.globalLore[0]).toEqual(expect.objectContaining({
            id: 'existing', enabled: false, alwaysActive: false, key: '',
        }))
    })

    it('edits an active event while keeping its event type and source identity', async () => {
        mocks.saveManualWikiDocument.mockResolvedValue({
            ...documents[1],
            authoring: 'manual',
            content: '# 전투\n\n패배했다.',
            contentHash: 'hash-event-edited',
        })
        const target = document.body.appendChild(document.createElement('div'))
        mounted = mount(RisuBardWikiEditor, {
            target,
            props: { characterId: 'character', chatId: 'chat', documents },
        })
        await tick()

        expect(document.body.textContent).toContain('characters')
        expect(document.body.textContent).toContain('events')
        const eventButton = [...document.querySelectorAll('button')]
            .find((button) => button.textContent?.includes('전투'))!
        eventButton.click()
        await tick()
        const type = document.querySelector<HTMLSelectElement>('[aria-label="항목 유형"]')!
        const markdown = document.querySelector<HTMLTextAreaElement>('[aria-label="Markdown"]')!
        expect(type.value).toBe('event')
        expect(type.disabled).toBe(true)
        expect(markdown.readOnly).toBe(false)

        markdown.value = '# 전투\n\n패배했다.'
        markdown.dispatchEvent(new Event('input', { bubbles: true }))
        await tick()
        const save = document.querySelector<HTMLButtonElement>(
            '[data-wiki-action-toolbar] [aria-label="저장"]'
        )!
        save.click()

        await vi.waitFor(() => {
            expect(mocks.saveManualWikiDocument).toHaveBeenCalledWith(
                expect.objectContaining({
                    documentId: 'event.turn',
                    expectedContentHash: 'hash-event',
                    type: 'event',
                    title: '전투',
                    markdown: '# 전투\n\n패배했다.',
                })
            )
        })
    })

    it('edits aliases as comma-separated document metadata', async () => {
        mocks.saveManualWikiDocument.mockResolvedValue(documents[0])
        mounted = mount(RisuBardWikiEditor, {
            target: document.body,
            props: { characterId: 'character', chatId: 'chat', documents },
        })
        await tick()

        const aliases = document.querySelector<HTMLInputElement>(
            '[aria-label="별칭"]'
        )!
        expect(aliases.value).toBe('기사님')
        aliases.value = '기사님, 북방의 검'
        aliases.dispatchEvent(new Event('input', { bubbles: true }))
        await tick()
        document.querySelector<HTMLButtonElement>(
            '[data-wiki-action-toolbar] [aria-label="저장"]'
        )!.click()

        await vi.waitFor(() => expect(mocks.saveManualWikiDocument)
            .toHaveBeenCalledWith(expect.objectContaining({
                documentId: 'character.lavian',
                aliases: ['기사님', '북방의 검'],
            })))
    })

    it('navigates to the selected document source from the left toolbar action', async () => {
        const onNavigateSource = vi.fn()
        mounted = mount(RisuBardWikiEditor, {
            target: document.body,
            props: {
                characterId: 'character', chatId: 'chat', documents,
                onNavigateSource,
            },
        })
        await tick()

        const eventButton = [...document.querySelectorAll('button')]
            .find((button) => button.textContent?.includes('전투'))!
        eventButton.click()
        await tick()

        const toolbar = document.querySelector('[data-wiki-action-toolbar]')!
        const sourceButton = toolbar.querySelector<HTMLButtonElement>(
            '[data-wiki-source]'
        )
        expect(sourceButton?.textContent).toContain('원문으로 이동')
        expect(sourceButton?.querySelector('[data-wiki-source-label]'))
            .not.toBeNull()
        expect(toolbar.firstElementChild).toBe(
            sourceButton?.closest('[data-wiki-source-action]')
        )

        sourceButton?.click()
        expect(onNavigateSource).toHaveBeenCalledWith({
            kind: 'chat',
            messageIds: ['assistant-1'],
        })
    })

    it('permanently deletes an active event after explicit confirmation', async () => {
        mocks.retractWikiEvent.mockResolvedValue({
            ...documents[1], status: 'retracted', contentHash: 'hash-retracted',
        })
        const confirm = vi.fn(() => true)
        vi.stubGlobal('confirm', confirm)
        const onChanged = vi.fn()
        const target = document.body.appendChild(document.createElement('div'))
        mounted = mount(RisuBardWikiEditor, {
            target,
            props: {
                characterId: 'character', chatId: 'chat', documents, onChanged,
            },
        })
        await tick()

        const eventButton = [...document.querySelectorAll('button')]
            .find((button) => button.textContent?.includes('전투'))!
        eventButton.click()
        await tick()
        const toolbar = document.querySelector('[data-wiki-action-toolbar]')!
        expect([...toolbar.querySelectorAll('button')].map((button) =>
            button.textContent?.trim()
        )).toEqual(['', '', '로어북에 복사', ''])
        const deleteButton = toolbar.querySelector<HTMLButtonElement>(
            '[aria-label="삭제"]'
        )!
        deleteButton.click()

        await vi.waitFor(() => {
            expect(mocks.retractWikiEvent).toHaveBeenCalledWith(
                expect.objectContaining({
                    characterId: 'character',
                    chatId: 'chat',
                    documentId: 'event.turn',
                    expectedContentHash: 'hash-event',
                })
            )
            expect(onChanged).toHaveBeenCalled()
        })
        expect(confirm).toHaveBeenCalledWith(expect.stringContaining(
            '복구할 수 없습니다'
        ))
    })

    it('creates, edits, and trashes canonical pages without calling AI', async () => {
        mocks.saveManualWikiDocument.mockResolvedValue(documents[0])
        mocks.trashWikiDocument.mockResolvedValue({
            id: 'character.lavian',
            trashed: true,
        })
        vi.stubGlobal('confirm', vi.fn(() => true))
        const onChanged = vi.fn()
        const target = document.body.appendChild(document.createElement('div'))
        mounted = mount(RisuBardWikiEditor, {
            target,
            props: {
                characterId: 'character', chatId: 'chat', documents, onChanged,
            },
        })
        await tick()

        const button = (label: string) => [...document.querySelectorAll('button')]
            .find((item) => item.getAttribute('aria-label') === label
                || item.textContent?.trim() === label)!
        button('새 문서').click()
        await tick()
        const type = document.querySelector<HTMLSelectElement>('[aria-label="항목 유형"]')!
        type.selectedIndex = [...type.options]
            .findIndex((option) => option.value === 'location')
        type.dispatchEvent(new Event('input', { bubbles: true }))
        type.dispatchEvent(new Event('change', { bubbles: true }))
        await tick()
        const title = document.querySelector<HTMLInputElement>('[aria-label="항목 이름"]')!
        title.value = '케사리아'
        title.dispatchEvent(new Event('input', { bubbles: true }))
        const markdown = document.querySelector<HTMLTextAreaElement>('[aria-label="Markdown"]')!
        markdown.value = '# 케사리아\n\n도시.'
        markdown.dispatchEvent(new Event('input', { bubbles: true }))
        await tick()
        button('저장').click()
        await vi.waitFor(() => expect(mocks.saveManualWikiDocument).toHaveBeenCalled())

        expect(mocks.saveManualWikiDocument).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'character',
                title: '케사리아',
                markdown: '# 케사리아\n\n도시.',
            })
        )
        const characterButton = [...document.querySelectorAll('button')]
            .find((item) => item.textContent?.includes('라비안'))!
        characterButton.click()
        await tick()
        await vi.waitFor(() => expect(
            (button('삭제') as HTMLButtonElement).disabled
        ).toBe(false))
        button('삭제').click()
        await vi.waitFor(() => expect(mocks.trashWikiDocument).toHaveBeenCalled())
        expect(mocks.trashWikiDocument).toHaveBeenCalledWith(
            expect.objectContaining({ documentId: 'character.lavian' })
        )
        expect(onChanged).toHaveBeenCalled()
    })

    it('changes context policy and reveals either file from its context menu', async () => {
        mocks.revealWikiDocument.mockResolvedValue({ ok: true })
        const target = document.body.appendChild(document.createElement('div'))
        mounted = mount(RisuBardWikiEditor, {
            target,
            props: {
                characterId: 'character',
                chatId: 'chat',
                documents,
            },
        })
        await tick()

        const characterButton = [...document.querySelectorAll('button')]
            .find((item) => item.textContent?.includes('라비안'))!
        characterButton.dispatchEvent(new MouseEvent('contextmenu', {
            bubbles: true,
            clientX: 120,
            clientY: 80,
        }))
        await tick()
        expect(document.querySelector('[data-wiki-send-to-workbench]')).toBeNull()

        mocks.setWikiDocumentContextMode.mockResolvedValue({
            ...documents[0], contextMode: 'always', contentHash: 'hash-next',
        })
        characterButton.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }))
        await tick()
        document.querySelector<HTMLButtonElement>('[data-wiki-context-always]')?.click()
        await vi.waitFor(() => expect(
            mocks.setWikiDocumentContextMode
        ).toHaveBeenCalledWith(expect.objectContaining({
            documentId: 'character.lavian',
            contextMode: 'always',
            expectedContentHash: 'hash-lavian',
        })))

        characterButton.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }))
        await tick()
        document.querySelector<HTMLButtonElement>('[data-wiki-reveal-file]')?.click()
        await vi.waitFor(() => expect(mocks.revealWikiDocument).toHaveBeenCalledWith(
            expect.objectContaining({ documentId: 'character.lavian' })
        ))

        const eventButton = [...document.querySelectorAll('button')]
            .find((item) => item.textContent?.includes('전투'))!
        eventButton.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }))
        await tick()
        expect(document.querySelector('[data-wiki-send-to-workbench]')).toBeNull()
        expect(document.querySelector('[data-wiki-reveal-file]')).not.toBeNull()
    })
})
