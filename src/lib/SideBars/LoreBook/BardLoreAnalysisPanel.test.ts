// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount, tick, unmount } from 'svelte'
import { changeLanguage } from 'src/lang'
import { createBardLoreSettings, fingerprintBardLoreEntry, type BardLoreEntry } from 'src/ts/lorebook/bardLore'
import BardLoreAnalysisPanel from './BardLoreAnalysisPanel.svelte'

const requestChatData = vi.hoisted(() => vi.fn())
const tokenizerMock = vi.hoisted(() => vi.fn(async (_value: string) => 20))
const alertNormalMock = vi.hoisted(() => vi.fn())
vi.mock('src/ts/process/request/request', () => ({ requestChatData }))
vi.mock('src/ts/tokenizer', () => ({ tokenize: tokenizerMock }))
vi.mock('src/ts/alert', () => ({ alertNormal: alertNormalMock, notifySuccess: vi.fn() }))

const source: BardLoreEntry = {
    id: 'source',
    key: '탑',
    secondkey: '',
    insertorder: 10,
    comment: '탑',
    content: '도시의 탑',
    mode: 'normal',
    alwaysActive: false,
    selective: false,
    bard: {
        sourceLegacyId: 'source',
        sourceHash: 'legacy',
        kind: 'other',
        activation: 'retrieve',
        aliases: [],
        tags: [],
        summary: '',
        facets: [],
        injection: 'full',
        links: [],
    },
}

let mounted: ReturnType<typeof mount> | undefined
afterEach(async () => {
    if (mounted) await unmount(mounted)
    mounted = undefined
    await new Promise((resolve) => window.setTimeout(resolve, 30))
    document.body.replaceChildren()
    requestChatData.mockReset()
    tokenizerMock.mockReset().mockResolvedValue(20)
    alertNormalMock.mockClear()
    changeLanguage('en')
})

describe('BardLoreAnalysisPanel', () => {
    it('ignores an older budget error after the input allowance has been increased', async () => {
        let finishOldMeasurement!: (tokens: number) => void
        tokenizerMock.mockImplementationOnce(() => new Promise<number>((resolve) => { finishOldMeasurement = resolve }))
        mounted = mount(BardLoreAnalysisPanel, {
            target: document.body.appendChild(document.createElement('div')),
            props: { entries: [source], settings: createBardLoreSettings({ analysisInputTokens: 30 }), onChange: vi.fn() },
        })
        await tick()
        document.body.querySelector<HTMLButtonElement>('[data-bard-lore-analysis-open]')!.click()
        await vi.waitFor(() => expect(tokenizerMock).toHaveBeenCalledOnce())
        const input = document.body.querySelector<HTMLInputElement>('[data-bard-lore-analysis-setting="analysisInputTokens"]')!
        input.value = '100'
        input.dispatchEvent(new Event('change', { bubbles: true }))
        await vi.waitFor(() => expect(document.body.querySelector('[data-bard-lore-analysis-plan]')).not.toBeNull())
        finishOldMeasurement(20)
        await vi.waitFor(() => expect(tokenizerMock).toHaveBeenCalledTimes(4))
        await tick()
        expect(document.body.querySelector('.error')).toBeNull()
        expect(document.body.querySelector('[data-bard-lore-analyze]')).not.toBeNull()
        expect(requestChatData).not.toHaveBeenCalled()
    })

    it('explains oversized lore input and recommends enough room for every complete selected entry', async () => {
        changeLanguage('ko')
        tokenizerMock.mockImplementation(async (value: string) => value.length)
        const long = { ...structuredClone(source), content: '가'.repeat(17_655), comment: '긴 배포 로어' }
        const longer = { ...structuredClone(source), id: 'longer', content: '나'.repeat(21_000), comment: '더 긴 로어' }
        const onSettingsChange = vi.fn()
        requestChatData.mockImplementation(async ({ formated }) => ({
            type: 'success',
            result: JSON.stringify({ entries: JSON.parse(formated[0].content.split('\n').at(-1)).targets.map(({ ref }: { ref: number }) => ({
                ref, kind: 'location', activation: 'retrieve', aliases: [], tags: ['도시'], summary: '도시의 탑', links: [],
            })) }),
        }))
        mounted = mount(BardLoreAnalysisPanel, {
            target: document.body.appendChild(document.createElement('div')),
            props: { entries: [long, longer], settings: createBardLoreSettings(), onChange: vi.fn(), onSettingsChange },
        })
        await tick()
        document.body.querySelector<HTMLButtonElement>('[data-bard-lore-analysis-open]')!.click()
        await vi.waitFor(() => {
            const error = document.body.querySelector('.error')?.textContent ?? ''
            expect(error).toContain('긴 배포 로어')
            expect(error).toContain('12,000')
            expect(error).toContain('최대 입력 토큰')
            expect(error).toContain('추천 설정')
        })
        expect(requestChatData).not.toHaveBeenCalled()
        document.body.querySelector<HTMLButtonElement>('[data-bard-lore-analysis-recommend]')!.click()
        await vi.waitFor(() => expect(document.body.querySelector('[data-bard-lore-analysis-plan]')).not.toBeNull())
        expect(document.body.querySelector('.error')).toBeNull()
        expect(onSettingsChange.mock.calls.at(-1)?.[0].analysisInputTokens).toBeGreaterThan(21_000)
        expect(requestChatData).not.toHaveBeenCalled()
        document.body.querySelector<HTMLButtonElement>('[data-bard-lore-analyze]')!.click()
        await vi.waitFor(() => expect(requestChatData).toHaveBeenCalledTimes(2))
        expect(JSON.parse(requestChatData.mock.calls[0][0].formated[0].content.split('\n').at(-1)).targets[0].content).toBe(long.content)
        expect(JSON.parse(requestChatData.mock.calls[1][0].formated[0].content.split('\n').at(-1)).targets[0].content).toBe(longer.content)
    })

    it('resizes the analysis window and both workbench splits', async () => {
        mounted = mount(BardLoreAnalysisPanel, {
            target: document.body.appendChild(document.createElement('div')),
            props: {
                entries: [source],
                settings: createBardLoreSettings(),
                onChange: vi.fn(),
            },
        })

        await tick()
        document.body.querySelector<HTMLButtonElement>('[data-bard-lore-analysis-open]')!.click()
        await vi.waitFor(() => expect(document.body.querySelector('[data-bard-lore-analysis-plan]')).not.toBeNull())

        expect(document.body.querySelectorAll('[data-manager-window-resize]')).toHaveLength(8)
        const workbench = document.body.querySelector<HTMLElement>('[data-bard-lore-analysis-workbench]')!
        const settingsPane = workbench.querySelector<HTMLElement>('.settings-pane')!
        workbench.getBoundingClientRect = () => ({ width: 1000 } as DOMRect)
        settingsPane.getBoundingClientRect = () => ({ width: 360 } as DOMRect)
        const splitter = workbench.querySelector<HTMLElement>('[data-bard-lore-analysis-splitter]')!
        expect(splitter.getAttribute('role')).toBe('separator')
        expect(splitter.getAttribute('aria-orientation')).toBe('vertical')

        splitter.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))

        expect(workbench.style.getPropertyValue('--analysis-settings-width')).toBe('376px')

        const settingsSection = settingsPane.querySelector<HTMLElement>('.analysis-settings')!
        settingsPane.getBoundingClientRect = () => ({ height: 600 } as DOMRect)
        settingsSection.getBoundingClientRect = () => ({ height: 200 } as DOMRect)
        const rowSplitter = settingsPane.querySelector<HTMLElement>('[data-bard-lore-analysis-settings-splitter]')!
        expect(rowSplitter.getAttribute('aria-orientation')).toBe('horizontal')

        rowSplitter.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))

        expect(settingsPane.style.getPropertyValue('--analysis-settings-height')).toBe('216px')
    })

    it('omits the redundant model-request estimate sentence', async () => {
        mounted = mount(BardLoreAnalysisPanel, {
            target: document.body.appendChild(document.createElement('div')),
            props: {
                entries: [source],
                settings: createBardLoreSettings(),
                onChange: vi.fn(),
            },
        })

        await tick()
        document.body.querySelector<HTMLButtonElement>('[data-bard-lore-analysis-open]')!.click()
        await vi.waitFor(() => expect(document.body.querySelector('[data-bard-lore-analysis-plan]')).not.toBeNull())

        expect(document.body.textContent).not.toContain('모델 요청 1회를 실행합니다')
    })

    it('opens a complete beginner Grimoire guide from the analysis dialog title', async () => {
        mounted = mount(BardLoreAnalysisPanel, {
            target: document.body.appendChild(document.createElement('div')),
            props: {
                entries: [source],
                settings: createBardLoreSettings(),
                onChange: vi.fn(),
            },
        })

        await tick()
        document.body.querySelector<HTMLButtonElement>('[data-bard-lore-analysis-open]')!.click()
        await tick()

        const helpButton = document.body.querySelector<HTMLButtonElement>('[data-bard-lore-analysis-guide]')
        expect(helpButton).not.toBeNull()
        expect(helpButton?.textContent?.trim()).toBe('도움말')
        expect(helpButton?.getAttribute('aria-label')).toBe('AI 분석 도움말')

        helpButton?.click()
        await tick()

        const help = document.body.querySelector('[data-bard-lore-analysis-help-content]')
        expect(help).not.toBeNull()
        const headings = [...help!.querySelectorAll('h2')].map((heading) => heading.textContent?.trim())
        expect(headings).toContain('Grimoire를 쓰기 전에')
        expect(headings).toContain('항목마다 무엇을 입력하나요?')
        expect(headings).toContain('구조화 패싯(facet)은 무엇인가요?')
        expect(headings).toContain('활성화 규칙은 어떻게 고르나요?')
        expect(headings).toContain('프롬프트 역할은 무엇인가요?')
        expect(headings).toContain('명시 링크는 어떻게 쓰나요?')
        expect(headings).toContain('검색 예산은 무엇인가요?')
        expect(headings).toContain('AI 분석은 무엇을 하나요?')
        expect(help?.textContent).toContain('원문은 바꾸지 않습니다')
        expect(help?.textContent).toContain('AI 분석을 사용하지 않는다면')
        expect(help?.textContent).toContain('활성화 규칙·프롬프트 역할·링크의 초안')
        expect(help?.textContent).toContain('검색 메타데이터(찾기 위한 이름표)')
        expect(help?.textContent).toContain('토큰은 글의 양을 재는 단위')
        expect(help?.textContent).toContain('프롬프트 역할까지 확인했습니다')
        expect(help?.textContent).toContain('패싯 키')
        expect(help?.textContent).toContain('정규 값')
        expect(help?.textContent).toContain('검색 별칭')
        expect(help?.textContent).toContain('필터로 적용할 facet 키')
        expect(help?.textContent).toContain('facet 값 검색 어휘')
        expect(help?.textContent).toContain('항상 필수')
        expect(help?.textContent).toContain('키·별칭 적중')
        expect(help?.textContent).toContain('키+관련도')
        expect(help?.textContent).toContain('검색 인덱스로만 사용')
        expect(help?.textContent).toContain('full')
        expect(help?.textContent).toContain('index-only')
        expect(help?.textContent).toContain('보조 검색')
        expect(help?.textContent).toContain('역방향 탐색')
        expect(help?.textContent).toContain('supporting')
        expect(help?.textContent).toContain('discoverable')
        expect(help?.textContent).toContain('ambient')
        expect(help?.textContent).toContain('none')
        expect(help?.textContent).toContain('서로 다른 설정')
        expect(help?.textContent).toContain('추천 셋팅')
        expect(help?.textContent).toContain('요청 시작')
        expect(help?.textContent).toContain('초안 적용')
    })

    it('shows the exact deterministic quality gaps before the user trusts the Grimoire', async () => {
        mounted = mount(BardLoreAnalysisPanel, {
            target: document.body.appendChild(document.createElement('div')),
            props: {
                entries: [source],
                settings: createBardLoreSettings(),
                onChange: vi.fn(),
            },
        })

        await tick()
        const status = document.body.querySelector('[data-bard-lore-quality-status="fail"]')!
        expect(status).not.toBeNull()
        expect(status.textContent).toContain('탑')
        expect(status.querySelector('[data-bard-lore-quality-issue="missing-summary"]')).not.toBeNull()
        expect(status.querySelector('[data-bard-lore-quality-issue="missing-tags"]')).not.toBeNull()
    })
    it('automatically repairs a schema-valid draft that fails the local quality gate', async () => {
        requestChatData
            .mockResolvedValueOnce({
                type: 'success',
                result: JSON.stringify({
                    entries: [{
                        ref: 0,
                        kind: 'character',
                        activation: 'retrieve',
                        aliases: ['탑지기'],
                        tags: [],
                        summary: '도시의 탑을 지키는 인물.',
                        facets: [],
                        injection: 'full',
                        atoms: [],
                        links: [],
                    }],
                }),
            })
            .mockResolvedValueOnce({
                type: 'success',
                result: JSON.stringify({
                    entries: [{
                        ref: 0,
                        kind: 'character',
                        activation: 'retrieve',
                        aliases: ['탑지기'],
                        tags: ['인물'],
                        summary: '도시의 탑을 지키는 인물.',
                        facets: [],
                        injection: 'full',
                        atoms: [],
                        links: [],
                    }],
                }),
            })
        mounted = mount(BardLoreAnalysisPanel, {
            target: document.body.appendChild(document.createElement('div')),
            props: {
                entries: [source],
                settings: createBardLoreSettings(),
                onChange: vi.fn(),
            },
        })

        await tick()
        document.body.querySelector<HTMLButtonElement>('[data-bard-lore-analysis-open]')!.click()
        await vi.waitFor(() => expect(document.body.querySelector('[data-bard-lore-analysis-plan]')).not.toBeNull())
        document.body.querySelector<HTMLButtonElement>('[data-bard-lore-analyze]')!.click()
        await vi.waitFor(() => expect(document.body.querySelector('[data-bard-lore-analysis-draft="source"]')).not.toBeNull())

        expect(requestChatData).toHaveBeenCalledTimes(2)
        expect(requestChatData.mock.calls[1][0].formated[0].content).toContain('missing-tags')
    })

    it('prepares an AI repair run for only the entries that fail deterministic quality checks', async () => {
        const healthy = structuredClone(source)
        healthy.id = 'healthy'
        healthy.comment = '완료 항목'
        healthy.bard.tags = ['장소']
        healthy.bard.summary = '이미 검색 가능한 항목.'
        mounted = mount(BardLoreAnalysisPanel, {
            target: document.body.appendChild(document.createElement('div')),
            props: {
                entries: [source, healthy],
                settings: createBardLoreSettings(),
                onChange: vi.fn(),
                onAnalysisRunChange: vi.fn(),
            },
        })

        await tick()
        document.body.querySelector<HTMLButtonElement>('[data-bard-lore-quality-repair]')!.click()
        await vi.waitFor(() => expect(document.body.querySelector('[data-bard-lore-analysis-plan]')).not.toBeNull())

        expect(document.body.querySelector('[data-bard-lore-analysis-target="source"]')).not.toBeNull()
        expect(document.body.querySelector('[data-bard-lore-analysis-target="healthy"]')).toBeNull()
    })
    it('edits analysis limits in the dialog and replans before starting', async () => {
        requestChatData.mockResolvedValue({
            type: 'success',
            result: JSON.stringify({
                entries: [{ ref: 0, kind: 'location', activation: 'retrieve', aliases: [], tags: ['장소'], summary: '도시의 탑.', links: [] }],
            }),
        })
        const onSettingsChange = vi.fn()
        mounted = mount(BardLoreAnalysisPanel, {
            target: document.body.appendChild(document.createElement('div')),
            props: {
                entries: [source],
                settings: createBardLoreSettings({ analysisOutputTokens: 200 }),
                onChange: vi.fn(),
                onSettingsChange,
            },
        })

        await tick()
        document.body.querySelector<HTMLButtonElement>('[data-bard-lore-analysis-open]')!.click()
        await vi.waitFor(() => expect(document.body.querySelector('[data-bard-lore-analysis-plan]')).not.toBeNull())
        const output = document.body.querySelector<HTMLInputElement>('[data-bard-lore-analysis-setting="analysisOutputTokens"]')!
        expect(output).not.toBeNull()
        output.value = '6400'
        output.dispatchEvent(new Event('change', { bubbles: true }))
        await vi.waitFor(() => expect(onSettingsChange).toHaveBeenCalledWith(expect.objectContaining({ analysisOutputTokens: 6400 })))
        await vi.waitFor(() => expect(document.body.querySelector('[data-bard-lore-analysis-plan]')).not.toBeNull())
        document.body.querySelector<HTMLButtonElement>('[data-bard-lore-analyze]')!.click()
        await vi.waitFor(() => expect(requestChatData).toHaveBeenCalled())

        expect(requestChatData.mock.calls[0][0].maxTokens).toBe(6400)
    })

    it('recommends settings from the current estimate and saves them as app defaults', async () => {
        const onSettingsChange = vi.fn()
        const onSaveSettingsAsDefault = vi.fn()
        mounted = mount(BardLoreAnalysisPanel, {
            target: document.body.appendChild(document.createElement('div')),
            props: {
                entries: [source],
                settings: createBardLoreSettings(),
                onChange: vi.fn(),
                onSettingsChange,
                onSaveSettingsAsDefault,
            },
        })

        await tick()
        document.body.querySelector<HTMLButtonElement>('[data-bard-lore-analysis-open]')!.click()
        await vi.waitFor(() => expect(document.body.querySelector('[data-bard-lore-analysis-plan]')).not.toBeNull())
        document.body.querySelector<HTMLButtonElement>('[data-bard-lore-analysis-recommend]')!.click()
        await vi.waitFor(() => expect(onSettingsChange).toHaveBeenCalledWith(expect.objectContaining({
            analysisBatchEntries: 1,
            analysisTemperature: 0.2,
            analysisLinkedDepth: 1,
        })))
        document.body.querySelector<HTMLButtonElement>('[data-bard-lore-analysis-save-default]')!.click()

        expect(onSaveSettingsAsDefault).toHaveBeenCalledWith(expect.objectContaining({
            analysisBatchEntries: 1,
            analysisTemperature: 0.2,
        }))
    })

    it('filters a hierarchical target table by lore kind and bulk-selects visible entries', async () => {
        const folder = { ...structuredClone(source), id: 'folder', key: 'folder-key', comment: '등장인물', mode: 'folder' as const }
        const character = structuredClone(source)
        character.id = 'character'
        character.comment = '탑지기'
        character.folder = 'folder-key'
        character.bard.kind = 'character'
        const location = structuredClone(source)
        location.id = 'location'
        location.comment = '광장'
        location.bard.kind = 'location'
        mounted = mount(BardLoreAnalysisPanel, {
            target: document.body.appendChild(document.createElement('div')),
            props: {
                entries: [location, character, folder],
                settings: createBardLoreSettings(),
                onChange: vi.fn(),
            },
        })

        await tick()
        document.body.querySelector<HTMLButtonElement>('[data-bard-lore-analysis-open]')!.click()
        await vi.waitFor(() => expect(document.body.querySelector('[data-bard-lore-analysis-plan]')).not.toBeNull())
        const filter = document.body.querySelector<HTMLSelectElement>('[data-bard-lore-analysis-kind-filter]')!
        filter.value = 'character'
        filter.dispatchEvent(new Event('change', { bubbles: true }))
        await tick()

        expect([...document.body.querySelectorAll<HTMLElement>('[data-bard-lore-analysis-row]')].map((row) => row.dataset.bardLoreAnalysisRow))
            .toEqual(['folder', 'character'])
        document.body.querySelector<HTMLButtonElement>('[data-bard-lore-analysis-select-none]')!.click()
        await tick()
        expect(document.body.querySelector('[data-bard-lore-analysis-selected-count]')?.textContent).toContain('0')
        document.body.querySelector<HTMLButtonElement>('[data-bard-lore-analysis-select-all]')!.click()
        await vi.waitFor(() => expect(document.body.querySelector('[data-bard-lore-analysis-selected-count]')?.textContent).toContain('2'))
        await vi.waitFor(() => expect(document.body.querySelector('[data-bard-lore-analysis-plan]')).not.toBeNull())
    })

    it('paints the pointer-down selection state across every entered target row', async () => {
        const second = structuredClone(source)
        second.id = 'second'
        second.comment = '두 번째'
        mounted = mount(BardLoreAnalysisPanel, {
            target: document.body.appendChild(document.createElement('div')),
            props: { entries: [source, second], settings: createBardLoreSettings(), onChange: vi.fn() },
        })

        await tick()
        document.body.querySelector<HTMLButtonElement>('[data-bard-lore-analysis-open]')!.click()
        await vi.waitFor(() => expect(document.body.querySelector('[data-bard-lore-analysis-plan]')).not.toBeNull())
        document.body.querySelector<HTMLButtonElement>('[data-bard-lore-analysis-select-none]')!.click()
        const firstRow = document.body.querySelector<HTMLElement>('[data-bard-lore-analysis-row="source"]')!
        const secondRow = document.body.querySelector<HTMLElement>('[data-bard-lore-analysis-row="second"]')!
        firstRow.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }))
        secondRow.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }))
        window.dispatchEvent(new PointerEvent('pointerup'))
        await vi.waitFor(() => expect(document.body.querySelector('[data-bard-lore-analysis-selected-count]')?.textContent).toContain('2'))
    })

    it('shows setting help on hover and click and marks completed and failed entry names', async () => {
        const failed = structuredClone(source)
        failed.id = 'failed'
        failed.comment = '실패 항목'
        const settings = createBardLoreSettings()
        mounted = mount(BardLoreAnalysisPanel, {
            target: document.body.appendChild(document.createElement('div')),
            props: {
                entries: [source, failed],
                settings,
                analysisRun: {
                    schemaVersion: 1,
                    id: 'status-run',
                    scope: 'all',
                    targetIds: ['source', 'failed'],
                    createdAt: '2026-09-02T00:00:00.000Z',
                    updatedAt: '2026-09-02T00:00:00.000Z',
                    status: 'failed',
                    settingsSnapshot: settings,
                    overwriteExisting: false,
                    batches: [
                        { id: 'done', index: 0, targetIds: ['source'], estimatedInputTokens: 20, status: 'complete', candidates: [] },
                        { id: 'bad', index: 1, targetIds: ['failed'], estimatedInputTokens: 20, status: 'failed', error: 'invalid' },
                    ],
                },
                onChange: vi.fn(),
            },
        })

        await tick()
        document.body.querySelector<HTMLButtonElement>('[data-bard-lore-analysis-open]')!.click()
        await tick()
        const label = document.body.querySelector<HTMLElement>('[data-bard-lore-analysis-label="analysisLinkedDepth"]')!
        const help = document.body.querySelector<HTMLButtonElement>('[data-bard-lore-analysis-help="analysisLinkedDepth"]')!
        expect(label.title).toContain('1')
        help.click()
        expect(alertNormalMock).toHaveBeenCalledWith(expect.stringContaining('1'))
        expect(document.body.querySelector('[data-bard-lore-analysis-name="source"]')?.classList.contains('complete')).toBe(true)
        expect(document.body.querySelector('[data-bard-lore-analysis-name="failed"]')?.classList.contains('failed')).toBe(true)
    })

    it('previews every selected lore entry and its original content before charging tokens', async () => {
        mounted = mount(BardLoreAnalysisPanel, {
            target: document.body.appendChild(document.createElement('div')),
            props: {
                entries: [source],
                settings: createBardLoreSettings(),
                onChange: vi.fn(),
            },
        })

        await tick()
        document.body.querySelector<HTMLButtonElement>('[data-bard-lore-analysis-open]')!.click()
        await vi.waitFor(() => expect(document.body.querySelector('[data-bard-lore-analysis-target="source"]')).not.toBeNull())

        const preview = document.body.querySelector('[data-bard-lore-analysis-target="source"]')!
        expect(preview.textContent).toContain('탑')
        expect(preview.textContent).toContain('도시의 탑')
        expect(requestChatData).not.toHaveBeenCalled()
    })

    it('stops and persists a paused run when the dialog closes', async () => {
        requestChatData.mockImplementation((_arg, _mode, signal: AbortSignal) => new Promise((resolve) => {
            signal.addEventListener('abort', () => resolve({ type: 'fail', result: 'aborted' }), { once: true })
        }))
        const onAnalysisRunChange = vi.fn()
        mounted = mount(BardLoreAnalysisPanel, {
            target: document.body.appendChild(document.createElement('div')),
            props: {
                entries: [source],
                settings: createBardLoreSettings(),
                onChange: vi.fn(),
                onAnalysisRunChange,
            },
        })

        await tick()
        document.body.querySelector<HTMLButtonElement>('[data-bard-lore-analysis-open]')!.click()
        await vi.waitFor(() => expect(document.body.querySelector('[data-bard-lore-analysis-plan]')).not.toBeNull())
        document.body.querySelector<HTMLButtonElement>('[data-bard-lore-analyze]')!.click()
        await vi.waitFor(() => expect(requestChatData).toHaveBeenCalled())
        document.body.querySelector<HTMLButtonElement>('.risu-modal-close')!.click()
        await vi.waitFor(() => expect(onAnalysisRunChange.mock.calls.at(-1)?.[0]?.status).toBe('paused'))
        expect(requestChatData.mock.calls[0][2].aborted).toBe(true)
    })

    it('shows persisted drafts and failed-batch reasons after reopening', async () => {
        requestChatData.mockResolvedValue({ type: 'success', result: '{invalid' })
        const onAnalysisRunChange = vi.fn()
        mounted = mount(BardLoreAnalysisPanel, {
            target: document.body.appendChild(document.createElement('div')),
            props: {
                entries: [source],
                settings: createBardLoreSettings(),
                onChange: vi.fn(),
                onAnalysisRunChange,
            },
        })

        await tick()
        document.body.querySelector<HTMLButtonElement>('[data-bard-lore-analysis-open]')!.click()
        await vi.waitFor(() => expect(document.body.querySelector('[data-bard-lore-analysis-plan]')).not.toBeNull())
        document.body.querySelector<HTMLButtonElement>('[data-bard-lore-analyze]')!.click()
        await vi.waitFor(() => expect(document.body.querySelector('[data-bard-lore-analysis-failure]')).not.toBeNull())

        const failure = document.body.querySelector('[data-bard-lore-analysis-failure]')!
        expect(failure.textContent).toContain('JSON')
        document.body.querySelector<HTMLButtonElement>('.risu-modal-close')!.click()
        await tick()
        document.body.querySelector<HTMLButtonElement>('[data-bard-lore-analysis-open]')!.click()
        await vi.waitFor(() => expect(document.body.querySelector('[data-bard-lore-analysis-failure]')).not.toBeNull())
        expect(document.body.querySelector('[data-bard-lore-analysis-target="source"]')).not.toBeNull()
    })

    it('automatically splits an invalid multi-entry JSON batch and completes the smaller batches', async () => {
        const second = structuredClone(source)
        second.id = 'second'
        second.key = '항구'
        second.comment = '항구'
        second.content = '도시의 항구'
        second.bard.sourceLegacyId = 'second'
        requestChatData
            .mockResolvedValueOnce({
                type: 'fail',
                result: '[PageFold] Structured output validation failed: Structured output is not valid JSON. (finish reason: MAX_TOKENS)',
            })
            .mockResolvedValueOnce({
                type: 'success',
                result: JSON.stringify({
                    entries: [{ ref: 0, kind: 'location', activation: 'retrieve', aliases: [], tags: ['장소'], summary: '도시의 탑.', links: [] }],
                }),
            })
            .mockResolvedValueOnce({
                type: 'success',
                result: JSON.stringify({
                    entries: [{ ref: 1, kind: 'location', activation: 'retrieve', aliases: [], tags: ['장소'], summary: '도시의 항구.', links: [] }],
                }),
            })
        const onAnalysisRunChange = vi.fn()
        mounted = mount(BardLoreAnalysisPanel, {
            target: document.body.appendChild(document.createElement('div')),
            props: {
                entries: [source, second],
                settings: createBardLoreSettings({ analysisBatchEntries: 2 }),
                onChange: vi.fn(),
                onAnalysisRunChange,
            },
        })

        await tick()
        document.body.querySelector<HTMLButtonElement>('[data-bard-lore-analysis-open]')!.click()
        await vi.waitFor(() => expect(document.body.querySelector('[data-bard-lore-analysis-plan]')).not.toBeNull())
        document.body.querySelector<HTMLButtonElement>('[data-bard-lore-analyze]')!.click()
        await vi.waitFor(() => expect(requestChatData).toHaveBeenCalledTimes(3))
        await vi.waitFor(() => expect(onAnalysisRunChange.mock.calls.at(-1)?.[0]).toMatchObject({
            status: 'review',
            batches: [{ status: 'complete' }, { status: 'complete' }],
        }))

        expect(document.body.querySelector('[data-bard-lore-analysis-failure]')).toBeNull()
        expect(document.body.querySelector('[data-bard-lore-analysis-draft="source"]')).not.toBeNull()
        expect(document.body.querySelector('[data-bard-lore-analysis-draft="second"]')).not.toBeNull()
    })

    it('regenerates one invalid atomic singleton with a smaller response contract', async () => {
        requestChatData
            .mockResolvedValueOnce({ type: 'success', result: '{invalid' })
            .mockResolvedValueOnce({
                type: 'success',
                result: JSON.stringify({
                    entries: [{ ref: 0, kind: 'location', activation: 'retrieve', aliases: [], tags: ['장소'], summary: '도시의 탑.', links: [] }],
                }),
            })
        const onAnalysisRunChange = vi.fn()
        mounted = mount(BardLoreAnalysisPanel, {
            target: document.body.appendChild(document.createElement('div')),
            props: {
                entries: [source],
                settings: createBardLoreSettings(),
                onChange: vi.fn(),
                onAnalysisRunChange,
            },
        })

        await tick()
        document.body.querySelector<HTMLButtonElement>('[data-bard-lore-analysis-open]')!.click()
        await vi.waitFor(() => expect(document.body.querySelector('[data-bard-lore-analysis-plan]')).not.toBeNull())
        document.body.querySelector<HTMLButtonElement>('[data-bard-lore-analyze]')!.click()
        await vi.waitFor(() => expect(requestChatData).toHaveBeenCalledTimes(2))
        await vi.waitFor(() => expect(onAnalysisRunChange.mock.calls.at(-1)?.[0]?.status).toBe('review'))

        expect(requestChatData.mock.calls[1][0].formated[0].content).toContain('ordinary atomic entry')
        expect(requestChatData.mock.calls[1][0].schema).not.toContain('"atoms"')
        expect(requestChatData.mock.calls[1][0].schema.length).toBeLessThan(requestChatData.mock.calls[0][0].schema.length)
        expect(document.body.querySelector('[data-bard-lore-analysis-draft="source"]')).not.toBeNull()
    })

    it('replans failed work with changed limits and uses them on retry', async () => {
        requestChatData
            .mockResolvedValueOnce({ type: 'success', result: '{"entries":[]}' })
            .mockResolvedValueOnce({
                type: 'success',
                result: JSON.stringify({
                    entries: [{ ref: 0, kind: 'location', activation: 'retrieve', aliases: [], tags: ['장소'], summary: '도시의 탑.', links: [] }],
                }),
            })
        const onAnalysisRunChange = vi.fn()
        mounted = mount(BardLoreAnalysisPanel, {
            target: document.body.appendChild(document.createElement('div')),
            props: {
                entries: [source],
                settings: createBardLoreSettings({ analysisOutputTokens: 200 }),
                onChange: vi.fn(),
                onSettingsChange: vi.fn(),
                onAnalysisRunChange,
            },
        })

        await tick()
        document.body.querySelector<HTMLButtonElement>('[data-bard-lore-analysis-open]')!.click()
        await vi.waitFor(() => expect(document.body.querySelector('[data-bard-lore-analysis-plan]')).not.toBeNull())
        document.body.querySelector<HTMLButtonElement>('[data-bard-lore-analyze]')!.click()
        await vi.waitFor(() => expect(document.body.querySelector('[data-bard-lore-analysis-failure]')).not.toBeNull())
        const output = document.body.querySelector<HTMLInputElement>('[data-bard-lore-analysis-setting="analysisOutputTokens"]')!
        output.value = '6400'
        output.dispatchEvent(new Event('change', { bubbles: true }))
        await vi.waitFor(() => expect(onAnalysisRunChange.mock.calls.at(-1)?.[0]).toMatchObject({
            status: 'paused',
            settingsSnapshot: { analysisOutputTokens: 6400 },
            batches: [{ status: 'pending' }],
        }))
        document.body.querySelector<HTMLButtonElement>('[data-bard-lore-analysis-resume]')!.click()
        await vi.waitFor(() => expect(requestChatData).toHaveBeenCalledTimes(2))

        expect(requestChatData.mock.calls[1][0].maxTokens).toBe(6400)
    })

    it('explains legacy generic validation failures instead of exposing an internal code', async () => {
        const settings = createBardLoreSettings()
        mounted = mount(BardLoreAnalysisPanel, {
            target: document.body.appendChild(document.createElement('div')),
            props: {
                entries: [source],
                settings,
                analysisRun: {
                    schemaVersion: 1,
                    id: 'legacy-run',
                    scope: 'all',
                    targetIds: ['source'],
                    createdAt: '2026-08-31T00:00:00.000Z',
                    updatedAt: '2026-08-31T00:00:00.000Z',
                    status: 'failed',
                    settingsSnapshot: settings,
                    overwriteExisting: false,
                    batches: [{
                        id: 'legacy-batch',
                        index: 0,
                        targetIds: ['source'],
                        estimatedInputTokens: 20,
                        status: 'failed',
                        error: 'bard-lore-analysis-invalid',
                    }],
                },
                onChange: vi.fn(),
            },
        })

        await tick()
        document.body.querySelector<HTMLButtonElement>('[data-bard-lore-analysis-open]')!.click()
        await vi.waitFor(() => expect(document.body.querySelector('[data-bard-lore-analysis-failure]')).not.toBeNull())
        const text = document.body.querySelector('[data-bard-lore-analysis-failure]')!.textContent ?? ''
        expect(text).toContain('schema')
        expect(text).not.toContain('bard-lore-analysis-invalid')
    })

    it('keeps AI metadata as a preview until explicit approval', async () => {
        requestChatData.mockResolvedValue({
            type: 'success',
            result: JSON.stringify({
                entries: [{
                    ref: 0,
                    kind: 'location',
                    activation: 'retrieve',
                    aliases: ['타워'],
                    tags: ['도시'],
                    summary: '도시의 탑',
                    links: [],
                }],
            }),
        })
        const onChange = vi.fn()
        const onAnalysisRunChange = vi.fn()
        const target = document.body.appendChild(document.createElement('div'))
        mounted = mount(BardLoreAnalysisPanel, {
            target,
            props: {
                entries: [source],
                settings: createBardLoreSettings({
                    analysisBatchEntries: 1,
                    analysisInputTokens: 100,
                    analysisOutputTokens: 200,
                    analysisTemperature: 0.25,
                }),
                activeEntryId: 'source',
                onChange,
                onAnalysisRunChange,
            },
        })
        await tick()
        document.body.querySelector<HTMLButtonElement>('[data-bard-lore-analysis-open]')!.click()
        await vi.waitFor(() => expect(document.body.querySelector('[data-bard-lore-analysis-plan]')).not.toBeNull())
        expect(requestChatData).not.toHaveBeenCalled()
        document.body.querySelector<HTMLButtonElement>('[data-bard-lore-analyze]')!.click()
        await vi.waitFor(() => expect(document.body.querySelector('[data-bard-lore-analysis-draft="source"]')).not.toBeNull())

        expect(onChange).not.toHaveBeenCalled()
        expect(onAnalysisRunChange).toHaveBeenCalled()
        expect(requestChatData.mock.calls[0][0]).toMatchObject({
            maxTokens: 200,
            temperature: 0.25,
            logPurpose: 'bard-lore-analysis',
            disablePromptCache: false,
        })
        expect(tokenizerMock).toHaveBeenCalledWith(expect.stringContaining('"required":["entries"]'))

        document.body.querySelector<HTMLButtonElement>('[data-bard-lore-analysis-apply]')!.click()
        await tick()

        expect(onChange).toHaveBeenCalledOnce()
        expect((onChange.mock.calls[0][0] as BardLoreEntry[])[0].bard).toMatchObject({
            kind: 'location',
            aliases: ['타워'],
            tags: ['도시'],
        })
    })

    it('keeps the first completed batch when a later response is invalid', async () => {
        const second = structuredClone(source)
        second.id = 'second'
        second.comment = 'second'
        second.key = 'second'
        second.bard.sourceLegacyId = 'second'
        requestChatData
            .mockResolvedValueOnce({
                type: 'success',
                result: JSON.stringify({
                    entries: [{
                        ref: 0,
                        kind: 'location',
                        activation: 'retrieve',
                        aliases: [],
                        tags: ['도시'],
                        summary: '보존될 초안',
                        links: [],
                    }],
                }),
            })
            .mockResolvedValueOnce({ type: 'success', result: '{invalid' })
        const onAnalysisRunChange = vi.fn()
        mounted = mount(BardLoreAnalysisPanel, {
            target: document.body.appendChild(document.createElement('div')),
            props: {
                entries: [source, second],
                settings: createBardLoreSettings({
                    analysisBatchEntries: 1,
                    analysisInputTokens: 100,
                    analysisOutputTokens: 100,
                }),
                onChange: vi.fn(),
                onAnalysisRunChange,
            },
        })

        await tick()
        document.body.querySelector<HTMLButtonElement>('[data-bard-lore-analysis-open]')!.click()
        await vi.waitFor(() => expect(document.body.querySelector('[data-bard-lore-analysis-plan]')).not.toBeNull())
        document.body.querySelector<HTMLButtonElement>('[data-bard-lore-analyze]')!.click()
        await vi.waitFor(() => expect(document.body.querySelector('[data-bard-lore-analysis-retry]')).not.toBeNull())

        expect(document.body.querySelector('[data-bard-lore-analysis-draft="source"]')).not.toBeNull()
        const saved = onAnalysisRunChange.mock.calls.at(-1)?.[0]
        expect(saved.batches.map((batch: { status: string }) => batch.status)).toEqual(['complete', 'failed'])
        expect(saved.batches[0].candidates[0].summary).toBe('보존될 초안')
    })

    it('keeps pending batches resumable after approving completed drafts', async () => {
        const second = structuredClone(source)
        second.id = 'second'
        second.comment = '남은 항목'
        second.key = '남은 항목'
        second.bard.sourceLegacyId = 'second'
        const settings = createBardLoreSettings({ analysisBatchEntries: 1 })
        const onAnalysisRunChange = vi.fn()
        mounted = mount(BardLoreAnalysisPanel, {
            target: document.body.appendChild(document.createElement('div')),
            props: {
                entries: [source, second],
                settings,
                analysisRun: {
                    schemaVersion: 1,
                    id: 'partially-complete-run',
                    scope: 'all',
                    targetIds: ['source', 'second'],
                    createdAt: '2026-08-31T00:00:00.000Z',
                    updatedAt: '2026-08-31T00:00:00.000Z',
                    status: 'paused',
                    settingsSnapshot: settings,
                    overwriteExisting: false,
                    batches: [
                        {
                            id: 'complete-batch',
                            index: 0,
                            targetIds: ['source'],
                            estimatedInputTokens: 20,
                            status: 'complete',
                            candidates: [{
                                id: 'source',
                                sourceHash: fingerprintBardLoreEntry(source),
                                kind: 'location',
                                aliases: [],
                                tags: ['도시'],
                                summary: '승인할 초안',
                                links: [],
                            }],
                        },
                        {
                            id: 'pending-batch',
                            index: 1,
                            targetIds: ['second'],
                            estimatedInputTokens: 20,
                            status: 'pending',
                        },
                    ],
                },
                onChange: vi.fn(),
                onAnalysisRunChange,
            },
        })

        await tick()
        document.body.querySelector<HTMLButtonElement>('[data-bard-lore-analysis-open]')!.click()
        await vi.waitFor(() => expect(document.body.querySelector('[data-bard-lore-analysis-apply]')).not.toBeNull())
        document.body.querySelector<HTMLButtonElement>('[data-bard-lore-analysis-apply]')!.click()
        await tick()

        expect(onAnalysisRunChange.mock.calls.at(-1)?.[0]).toMatchObject({
            status: 'paused',
            targetIds: ['second'],
            batches: [{ id: 'pending-batch', status: 'pending' }],
        })
        expect(document.body.querySelector('[data-bard-lore-analysis-resume]')).not.toBeNull()
    })

    it('offers resume for a persisted failed run that still has pending batches', async () => {
        const settings = createBardLoreSettings()
        requestChatData.mockResolvedValue({
            type: 'success',
            result: JSON.stringify({
                entries: [{ ref: 0, kind: 'location', activation: 'retrieve', aliases: [], tags: ['장소'], summary: '도시의 탑.', links: [] }],
            }),
        })
        mounted = mount(BardLoreAnalysisPanel, {
            target: document.body.appendChild(document.createElement('div')),
            props: {
                entries: [source],
                settings,
                analysisRun: {
                    schemaVersion: 1,
                    id: 'legacy-failed-pending-run',
                    scope: 'all',
                    targetIds: ['source'],
                    createdAt: '2026-08-31T00:00:00.000Z',
                    updatedAt: '2026-08-31T00:00:00.000Z',
                    status: 'failed',
                    settingsSnapshot: settings,
                    overwriteExisting: false,
                    batches: [{
                        id: 'pending-batch',
                        index: 0,
                        targetIds: ['source'],
                        estimatedInputTokens: 20,
                        status: 'pending',
                    }],
                },
                onChange: vi.fn(),
            },
        })

        await tick()
        document.body.querySelector<HTMLButtonElement>('[data-bard-lore-analysis-open]')!.click()
        await tick()

        expect(document.body.querySelector('[data-bard-lore-analysis-resume]')).not.toBeNull()
        document.body.querySelector<HTMLButtonElement>('[data-bard-lore-analysis-resume]')!.click()
        await vi.waitFor(() => expect(requestChatData).toHaveBeenCalledOnce())
    })

    it('does not offer resume for an externally running batch', async () => {
        const settings = createBardLoreSettings()
        mounted = mount(BardLoreAnalysisPanel, {
            target: document.body.appendChild(document.createElement('div')),
            props: {
                entries: [source],
                settings,
                analysisRun: {
                    schemaVersion: 1,
                    id: 'externally-running-run',
                    scope: 'all',
                    targetIds: ['source'],
                    createdAt: '2026-08-31T00:00:00.000Z',
                    updatedAt: '2026-08-31T00:00:00.000Z',
                    status: 'running',
                    settingsSnapshot: settings,
                    overwriteExisting: false,
                    batches: [{
                        id: 'running-batch',
                        index: 0,
                        targetIds: ['source'],
                        estimatedInputTokens: 20,
                        status: 'running',
                    }],
                },
                onChange: vi.fn(),
            },
        })

        await tick()
        document.body.querySelector<HTMLButtonElement>('[data-bard-lore-analysis-open]')!.click()
        await tick()

        expect(document.body.querySelector('[data-bard-lore-analysis-resume]')).toBeNull()
    })
})
