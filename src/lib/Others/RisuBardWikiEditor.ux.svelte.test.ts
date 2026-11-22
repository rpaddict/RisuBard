// @vitest-environment happy-dom
import { flushSync, mount, tick, unmount } from 'svelte'
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
    alertConfirmMulti: vi.fn(async () => -1),
    alertConfirm: vi.fn(async () => true),
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
    alertConfirm: mocks.alertConfirm,
}))

const lavian = {
    id: 'character.lavian',
    type: 'character' as const,
    status: 'active' as const,
    title: '라비안',
    aliases: ['기사님'],
    relativePath: 'characters/라비안.md',
    sourceMessageIds: [] as string[],
    updated: '2026-08-08T00:00:00.000Z',
    content: '# 라비안\n\n기사.',
    links: [] as string[],
    contextMode: 'auto' as const,
    contentHash: 'hash-lavian',
}
const battle = {
    ...lavian,
    id: 'event.turn',
    type: 'event' as const,
    title: '전투',
    aliases: [] as string[],
    relativePath: 'events/turn-1.md',
    sourceMessageIds: ['assistant-1'],
    updated: '2026-08-08T00:01:00.000Z',
    content: '# 전투\n\n승리했다. [[기사님]]',
    links: ['기사님'],
    contentHash: 'hash-event',
}
const gate = {
    ...lavian,
    id: 'location.gate',
    type: 'location' as const,
    title: '북문',
    aliases: [] as string[],
    relativePath: 'locations/북문.md',
    updated: '2026-08-09T00:00:00.000Z',
    content: '# 북문\n\n[[라비안|그 기사]]가 지킨다.',
    links: ['라비안|그 기사'],
    contentHash: 'hash-gate',
}
type Doc = typeof lavian | typeof battle | typeof gate

let mounted: ReturnType<typeof mount> | undefined

afterEach(async () => {
    if (mounted) await unmount(mounted)
    mounted = undefined
    document.body.replaceChildren()
    vi.clearAllMocks()
    mocks.alertConfirmMulti.mockImplementation(async () => -1)
    mocks.alertConfirm.mockImplementation(async () => true)
    mocks.db.risuBardWikiMarkdownPreview = undefined
})

async function mountEditor(extra: Record<string, unknown> = {}, docs: Doc[] = [lavian, battle, gate]) {
    const props = $state<Record<string, any>>({ characterId: 'character', chatId: 'chat', documents: docs, ...extra })
    mounted = mount(RisuBardWikiEditor, { target: document.body, props: props as any })
    await tick()
    return props
}
const q = <T extends Element = HTMLElement>(selector: string) => document.querySelector<T>(selector)
const markdownEditor = () => q<HTMLTextAreaElement>('[aria-label="Markdown"]')!
const titleValue = () => q<HTMLInputElement>('[aria-label="항목 이름"]')?.value
const row = (title: string) => [...document.querySelectorAll<HTMLButtonElement>('.file-select')]
    .find((button) => button.querySelector('.document-title')?.textContent === title)!
const treeTitles = () => [...document.querySelectorAll('.file-select .document-title')].map((node) => node.textContent)
async function typeMarkdown(value: string) {
    const editor = markdownEditor()
    editor.value = value
    editor.dispatchEvent(new Event('input', { bubbles: true }))
    await tick()
}
async function search(value: string) {
    const input = q<HTMLInputElement>('[data-wiki-search-input]')!
    input.value = value
    input.dispatchEvent(new Event('input', { bubbles: true }))
    q<HTMLFormElement>('[data-wiki-search-form]')!
        .dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }))
    await tick()
}

describe('unsaved draft protection', () => {
    it('cancels navigation to another document and keeps the draft', async () => {
        await mountEditor()
        await typeMarkdown('# 라비안\n\n고친 기록.')
        row('전투').click()
        await vi.waitFor(() => expect(mocks.alertConfirmMulti).toHaveBeenCalledWith(
            expect.stringContaining('저장하지 않은'),
            [expect.objectContaining({ label: '저장' }), expect.objectContaining({ label: '저장하지 않고 이동' })],
            expect.any(String),
        ))
        await tick()
        expect(titleValue()).toBe('라비안')
        expect(markdownEditor().value).toBe('# 라비안\n\n고친 기록.')
    })

    it('saves a rename typed only into the body heading instead of reverting it', async () => {
        mocks.saveManualWikiDocument.mockResolvedValueOnce({ ...lavian, title: '라비안 경', content: '## 라비안 경\n\n기록.', contentHash: 'renamed' })
        await mountEditor()
        await typeMarkdown('## 라비안 경\n\n기록.')
        q<HTMLButtonElement>('button[aria-label="저장"]')!.click()
        await vi.waitFor(() => expect(mocks.saveManualWikiDocument).toHaveBeenCalledWith(expect.objectContaining({
            documentId: 'character.lavian', title: '라비안 경',
        })))
    })

    it('discards the draft when the user moves without saving', async () => {
        mocks.alertConfirmMulti.mockResolvedValueOnce(1)
        await mountEditor()
        await typeMarkdown('# 라비안\n\n버릴 기록.')
        row('전투').click()
        await vi.waitFor(() => expect(titleValue()).toBe('전투'))
        expect(mocks.saveManualWikiDocument).not.toHaveBeenCalled()
    })

    it('saves before moving and stays when the save fails', async () => {
        mocks.alertConfirmMulti.mockResolvedValue(0)
        mocks.saveManualWikiDocument.mockRejectedValueOnce(new Error('저장 충돌'))
        await mountEditor()
        await typeMarkdown('# 라비안\n\n저장할 기록.')
        row('전투').click()
        await vi.waitFor(() => expect(document.body.textContent).toContain('저장 충돌'))
        expect(titleValue()).toBe('라비안')

        mocks.saveManualWikiDocument.mockResolvedValueOnce({ ...lavian, content: '# 라비안\n\n저장할 기록.', contentHash: 'saved' })
        row('전투').click()
        await vi.waitFor(() => expect(titleValue()).toBe('전투'))
        expect(mocks.saveManualWikiDocument).toHaveBeenLastCalledWith(expect.objectContaining({
            documentId: 'character.lavian', markdown: '# 라비안\n\n저장할 기록.',
        }))
    })

    it('guards new documents and preview wiki links, and reports dirty changes to the host', async () => {
        const onDirtyChange = vi.fn()
        await mountEditor({ onDirtyChange })
        expect(onDirtyChange).toHaveBeenLastCalledWith(false)
        await typeMarkdown('# 라비안\n\n고친 기록. [[전투]]')
        expect(onDirtyChange).toHaveBeenLastCalledWith(true)

        q<HTMLButtonElement>('.tree-toolbar [aria-label="새 문서"]')!.click()
        await vi.waitFor(() => expect(mocks.alertConfirmMulti).toHaveBeenCalledTimes(1))
        await tick()
        expect(titleValue()).toBe('라비안')

        q<HTMLInputElement>('[data-wiki-markdown-toggle]')!.click()
        await tick()
        q<HTMLElement>('[data-wikilink="전투"]')!.click()
        await vi.waitFor(() => expect(mocks.alertConfirmMulti).toHaveBeenCalledTimes(2))
        await tick()
        expect(titleValue()).toBe('라비안')

        q<HTMLButtonElement>('[aria-label="되돌리기"]')!.click()
        await tick()
        expect(onDirtyChange).toHaveBeenLastCalledWith(false)
    })

    it('opens the event behind an evidence mark (#N) in the preview', async () => {
        // The event has no stored number, so it is ranked like the server ranks older events: #1.
        await mountEditor({}, [{ ...lavian, content: '# 라비안\n\n검을 잃었다. (#1)' }, battle, gate])
        q<HTMLInputElement>('[data-wiki-markdown-toggle]')!.click()
        await tick()
        const mark = q<HTMLElement>('.wikilink-event-mark')!
        expect(mark.textContent).toBe('#1')
        mark.click()
        await vi.waitFor(() => expect(titleValue()).toBe('전투'))
    })
})

describe('deletion', () => {
    it('labels permanent event deletion as dangerous and disables it while locked', async () => {
        await mountEditor({ locked: true, selectedId: 'event.turn' })
        const button = q<HTMLButtonElement>('[data-wiki-action-toolbar] [aria-label="영구 삭제"]')!
        expect(button.title).toBe('영구 삭제')
        expect(button.className).toContain('text-danger')
        expect(button.disabled).toBe(true)
        button.click()
        await tick()
        expect(mocks.alertConfirm).not.toHaveBeenCalled()
        expect(mocks.retractWikiEvent).not.toHaveBeenCalled()
    })

    it('asks through the app dialog and counts alias backlinks before trashing', async () => {
        mocks.trashWikiDocument.mockResolvedValue({ id: lavian.id, trashed: true })
        await mountEditor()
        const button = q<HTMLButtonElement>('[data-wiki-action-toolbar] [aria-label="휴지통으로 이동"]')!
        expect(button.title).toBe('휴지통으로 이동')
        button.click()
        await vi.waitFor(() => expect(mocks.trashWikiDocument).toHaveBeenCalled())
        expect(mocks.alertConfirm).toHaveBeenCalledWith(expect.stringContaining('연결된 문서 2개'))
    })

    it('confirms permanent event deletion through the app dialog', async () => {
        mocks.alertConfirm.mockResolvedValueOnce(false)
        await mountEditor({ selectedId: 'event.turn' })
        q<HTMLButtonElement>('[aria-label="영구 삭제"]')!.click()
        await vi.waitFor(() => expect(mocks.alertConfirm).toHaveBeenCalledWith(expect.stringContaining('복구할 수 없습니다')))
        expect(mocks.retractWikiEvent).not.toHaveBeenCalled()
    })
})

describe('context inclusion control', () => {
    it('offers a visible three-way control wired to the policy save', async () => {
        mocks.setWikiDocumentContextMode.mockResolvedValue({ ...lavian, contextMode: 'never', contentHash: 'policy' })
        await mountEditor()
        const segments = [...document.querySelectorAll<HTMLButtonElement>('[data-wiki-context-segment]')]
        expect(segments.map((segment) => segment.textContent?.trim())).toEqual(['항상', '자동', '제외'])
        expect(segments[1].getAttribute('aria-checked')).toBe('true')
        segments[2].click()
        await vi.waitFor(() => expect(mocks.setWikiDocumentContextMode).toHaveBeenCalledWith(expect.objectContaining({
            documentId: 'character.lavian', contextMode: 'never', expectedContentHash: 'hash-lavian',
        })))
        await vi.waitFor(() => expect(q('[data-wiki-context-segment="never"]')?.getAttribute('aria-checked')).toBe('true'))
    })

    it('disables the control when read only and hides it for events', async () => {
        await mountEditor({ locked: true })
        const segments = [...document.querySelectorAll<HTMLButtonElement>('[data-wiki-context-segment]')]
        expect(segments).toHaveLength(3)
        expect(segments.every((segment) => segment.disabled)).toBe(true)
        row('전투').click()
        await tick()
        expect(document.querySelectorAll('[data-wiki-context-segment]')).toHaveLength(0)
    })

    it('focuses the first context menu item and closes on Escape', async () => {
        await mountEditor()
        row('라비안').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }))
        await vi.waitFor(() => expect(document.activeElement).toBe(q('[data-wiki-context-always]')))
        document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
        await tick()
        expect(q('.file-context-menu')).toBeNull()
    })

    it('badges only always and never documents in the tree', async () => {
        await mountEditor({}, [{ ...lavian, contextMode: 'always' }, { ...gate, contextMode: 'auto' as any },
            { ...lavian, id: 'n', title: '숨김', relativePath: 'notes/n.md', contextMode: 'never' as any }])
        expect([...document.querySelectorAll('[data-wiki-context-mode]')].map((badge) => badge.textContent?.trim()).sort())
            .toEqual(['제외', '항상'])
    })
})

describe('source metadata', () => {
    it('shows the response position, source count, and last update in one line', async () => {
        const updated = new Date(Date.now() - 3 * 3_600_000).toISOString()
        await mountEditor({
            selectedId: 'event.turn',
            messages: [{ chatId: 'user-1', role: 'user' }, { chatId: 'assistant-0', role: 'char' },
                { chatId: 'user-2', role: 'user' }, { chatId: 'assistant-1', role: 'char' }],
        }, [lavian, { ...battle, updated }])
        const meta = q('[data-wiki-source-meta]')!
        expect(meta.textContent).toContain('2번째 응답')
        expect(meta.textContent).toContain('출처 메시지 1개')
        expect(meta.textContent).toContain('3시간 전')
    })

    it('says when an event source is missing from the chat', async () => {
        await mountEditor({ selectedId: 'event.turn', messages: [{ chatId: 'other', role: 'char' }] })
        expect(q('[data-wiki-source-meta]')!.textContent).toContain('출처 없음')
    })
})

describe('search, filters, and sorting', () => {
    it('clears the active filter as soon as the search box is emptied', async () => {
        await mountEditor()
        await search('승리했다')
        await vi.waitFor(() => expect(treeTitles()).toEqual(['전투']))
        const input = q<HTMLInputElement>('[data-wiki-search-input]')!
        input.value = ''
        input.dispatchEvent(new Event('search', { bubbles: true }))
        await tick()
        expect(treeTitles().sort()).toEqual(['라비안', '북문', '전투'].sort())
    })

    it('does not jump away from a dirty draft to the first match', async () => {
        await mountEditor()
        await typeMarkdown('# 라비안\n\n고친 기록.')
        await search('승리했다')
        await vi.waitFor(() => expect(treeTitles()).toEqual(['전투']))
        expect(titleValue()).toBe('라비안')
        expect(mocks.alertConfirmMulti).not.toHaveBeenCalled()
    })

    it('filters by present document type and toggles name or recent sorting', async () => {
        await mountEditor({}, [lavian, { ...lavian, id: 'c2', title: '가람', relativePath: 'characters/가람.md',
            updated: '2026-07-01T00:00:00.000Z' }, battle, gate])
        const chips = [...document.querySelectorAll<HTMLButtonElement>('[data-wiki-type-filter]')]
        expect(chips.map((chip) => chip.textContent?.trim())).toEqual(['전체', '인물', '장소', '사건'])
        chips[2].click()
        await tick()
        expect(treeTitles()).toEqual(['북문'])
        expect(chips[2].getAttribute('aria-pressed')).toBe('true')
        chips[0].click()
        await tick()
        const sort = q<HTMLButtonElement>('[data-wiki-sort]')!
        expect(sort.textContent).toContain('이름순')
        const characterTitles = () => treeTitles().filter((title) => title === '라비안' || title === '가람')
        expect(characterTitles()).toEqual(['가람', '라비안'])
        sort.click()
        await tick()
        expect(sort.textContent).toContain('최근 수정순')
        expect(characterTitles()).toEqual(['라비안', '가람'])
    })
})

describe('analysis conflict banner', () => {
    it('loads the latest version on request', async () => {
        const props = await mountEditor()
        await typeMarkdown('# 라비안\n\n내 편집.')
        props.documents = [{ ...lavian, content: '# 라비안\n\n분석 갱신.', contentHash: 'hash-new' }, battle, gate]
        flushSync()
        await tick()
        expect(q('[data-wiki-conflict]')?.textContent).toContain('분석이 이 문서를 갱신했습니다')
        expect(markdownEditor().value).toBe('# 라비안\n\n내 편집.')
        q<HTMLButtonElement>('[data-wiki-conflict-latest]')!.click()
        await tick()
        expect(markdownEditor().value).toBe('# 라비안\n\n분석 갱신.')
        expect(q('[data-wiki-conflict]')).toBeNull()
    })

    it('keeps the draft and saves against the new hash when the user chooses to overwrite', async () => {
        mocks.saveManualWikiDocument.mockResolvedValue({ ...lavian, content: '# 라비안\n\n내 편집.', contentHash: 'hash-final' })
        const props = await mountEditor()
        await typeMarkdown('# 라비안\n\n내 편집.')
        props.documents = [{ ...lavian, content: '# 라비안\n\n분석 갱신.', contentHash: 'hash-new' }, battle, gate]
        flushSync()
        await tick()
        q<HTMLButtonElement>('[data-wiki-conflict-keep]')!.click()
        await tick()
        expect(q('[data-wiki-conflict]')).toBeNull()
        expect(markdownEditor().value).toBe('# 라비안\n\n내 편집.')
        q<HTMLButtonElement>('[aria-label="저장"]')!.click()
        await vi.waitFor(() => expect(mocks.saveManualWikiDocument).toHaveBeenCalledWith(expect.objectContaining({
            expectedContentHash: 'hash-new', markdown: '# 라비안\n\n내 편집.',
        })))
    })
})

describe('empty state and labels', () => {
    it('shows a guide instead of empty folders and the editor form when there are no documents', async () => {
        await mountEditor({}, [])
        const guide = q('[data-wiki-empty-state]')!
        expect(guide.textContent).toContain('아직 기억 문서가 없습니다.')
        expect(document.querySelectorAll('.folder-row')).toHaveLength(0)
        expect(q('[aria-label="Markdown"]')).toBeNull()
        expect(q('[data-wiki-action-toolbar]')).toBeNull()
        guide.querySelector<HTMLButtonElement>('button')!.click()
        await tick()
        expect(q('[aria-label="Markdown"]')).not.toBeNull()
        expect(q('[aria-label="항목 이름"]')).not.toBeNull()
    })

    it('uses Korean folder names, badge, and heading', async () => {
        await mountEditor({ highlightedDocumentIds: ['character.lavian'] })
        const folders = [...document.querySelectorAll('.folder-row span:first-of-type')].map((node) => node.textContent)
        expect(folders).toEqual(expect.arrayContaining(['인물', '사건', '장소', '메모']))
        expect(folders).not.toContain('characters')
        expect(q('[data-wiki-recent-update]')?.textContent).toBe('새 문서')
        expect(q('.tree-toolbar strong')?.textContent).toBe('문서')
    })

    it('exposes full titles on truncated rows and explains a disabled save', async () => {
        const longTitle = '아주 긴 이름을 가진 북방 기사단 제일 검사 라비안'
        await mountEditor({}, [{ ...lavian, title: longTitle }])
        expect(row(longTitle).querySelector('.document-title')?.getAttribute('title')).toBe(longTitle)
        await typeMarkdown('   ')
        const save = q<HTMLButtonElement>('[aria-label="저장"]')!
        expect(save.disabled).toBe(true)
        expect(save.title).toContain('본문')
        const titleInput = q<HTMLInputElement>('[aria-label="항목 이름"]')!
        titleInput.value = ''
        titleInput.dispatchEvent(new Event('input', { bubbles: true }))
        await tick()
        expect(save.title).toContain('이름')
    })
})
