// @vitest-environment happy-dom
import { mount, tick, unmount } from 'svelte'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
    loadChatRequestEvidence: vi.fn(),
    addRetainedAssistantSummary: vi.fn(async (evidence: any, messages: any[]) => ({
        ...evidence,
        retainedAssistant: {
            responseCount: messages.filter((message) => message.role === 'char').length,
            bodyTokens: 123,
        },
    })),
    downloadFile: vi.fn(),
}))

vi.mock('src/ts/risubard/chatRequestEvidence', async (importOriginal) => {
    const actual = await importOriginal<typeof import('src/ts/risubard/chatRequestEvidence')>()
    return {
        ...actual,
        loadChatRequestEvidence: mocks.loadChatRequestEvidence,
        addRetainedAssistantSummary: mocks.addRetainedAssistantSummary,
        formatChatRequestEvidenceMarkdown: vi.fn(() => '# evidence'),
        chatRequestFailureLabel: vi.fn((category: string) => category === 'format'
            ? '구조화 응답 검증 오류'
            : '공급자 응답 오류'),
        buildLegacyChatRequestEvidence: vi.fn((chatId: string, entries: unknown[]) => ({
            schemaVersion: 1,
            generatedAt: '2026-08-12T04:00:00.000Z',
            chatId,
            requestCount: entries.length,
            totals: { inputTokens: 10, outputTokens: 2, cachedTokens: 0, reasoningTokens: 0 },
            requests: entries.map((entry: any, index: number) => ({
                id: -(index + 1),
                timestamp: new Date(entry.timestamp).toISOString(),
                generationId: entry.generationId,
                source: 'main',
                model: entry.model,
                outcome: 'done',
                streaming: false,
                inputTokens: entry.inputTokens,
                outputTokens: entry.outputTokens,
            })),
        })),
    }
})
vi.mock('src/ts/globalApi.svelte', () => ({
    downloadFile: mocks.downloadFile,
}))
vi.mock('src/ts/requestLog', () => ({
    REQUEST_LOG_RECORDED_EVENT: 'risubard-request-log-recorded',
}))
import RisuBardMemoryActivity from './RisuBardMemoryActivity.svelte'
import { publishRisuBardMemoryActivity } from 'src/ts/risubard/memoryActivity'

let mounted: ReturnType<typeof mount> | undefined

beforeEach(() => {
    mocks.loadChatRequestEvidence.mockResolvedValue({
        schemaVersion: 1,
        generatedAt: '2026-08-12T04:00:00.000Z',
        chatId: 'chat',
        requestCount: 0,
        totals: { inputTokens: 0, outputTokens: 0, cachedTokens: 0, reasoningTokens: 0 },
        requests: [],
    })
})

afterEach(async () => {
    if (mounted) await unmount(mounted)
    mounted = undefined
    document.body.replaceChildren()
    vi.clearAllMocks()
})

describe('RisuBardMemoryActivity', () => {
    it('shows saved wiki diagnostics alongside a persisted request after reopening', async () => {
        mocks.loadChatRequestEvidence.mockResolvedValue({
            schemaVersion: 1, generatedAt: '2026-09-26T00:00:00.000Z', chatId: 'chat', requestCount: 1,
            totals: { inputTokens: 0, outputTokens: 0, cachedTokens: 0, reasoningTokens: 0 },
            requests: [{ id: 42, generationId: 'diag-generation', source: 'main',
                timestamp: '2026-09-26T00:00:00.000Z', outcome: 'done', streaming: false }],
        })
        mounted = mount(RisuBardMemoryActivity, { target: document.body, props: {
            characterId: 'c', chatId: 'chat', messages: [{ role: 'char', data: 'reply',
                generationInfo: { generationId: 'diag-generation', risuBardContext: {
                    mode: 'current', recentMessages: [], wikiPaths: [], selectedTokens: 20, inquiryDurationMs: 1,
                    wikiInquiry: { status: 'not-injected', documentCount: 3, candidateCount: 1,
                        selectedWikiCount: 1, injectedWikiCount: 0 },
                } },
            }] as any,
        } })
        await vi.waitFor(() => expect(document.querySelector('[data-wiki-inquiry]')?.textContent)
            .toContain('프리셋 확인'))
        expect(document.querySelector('[data-wiki-inquiry]')?.textContent).toContain('최종 포함 0개')
    })

    it('uses a dedicated vertical log scroller and raises log type by three pixels', () => {
        const source = readFileSync(resolve(
            process.cwd(), 'src/lib/Others/RisuBardMemoryActivity.svelte'
        ), 'utf8')
        const workspaceSource = readFileSync(resolve(
            process.cwd(), 'src/lib/Others/RisuBardMemoryWiki.svelte'
        ), 'utf8')
        const processSource = readFileSync(resolve(
            process.cwd(), 'src/ts/process/index.svelte.ts'
        ), 'utf8')
        expect(source).toMatch(/\.activity-console\s*\{[^}]*height:\s*100%/s)
        expect(source).toMatch(/\.activity-stream\s*\{[^}]*flex:\s*1/s)
        expect(source).not.toMatch(/\.activity-stream\s*\{[^}]*max-height:/s)
        expect(source).toContain('--activity-font-step: 3px')
        expect(source).toMatch(/\.activity-heading\s*\{[^}]*font-size:\s*calc\(\.74rem \+ var\(--activity-font-step\)\)/s)
        expect(source).toMatch(/\.metadata-grid small\s*\{[^}]*font-size:\s*calc\(\.54rem \+ var\(--activity-font-step\)\)/s)
        expect(source).not.toContain('.request-kind::before')
        expect(source).not.toContain('.request-kind::after')
        expect(source).toMatch(/\.summary-metrics b, \.summary-groups b\s*\{[^}]*font:\s*400/s)
        expect(workspaceSource).toContain('data-memory-activity-scroll')
        expect(workspaceSource).toMatch(/\.activity-log-scroll\s*\{[^}]*overflow-y:\s*scroll/s)
        expect(workspaceSource).toMatch(/\.activity-log-scroll\s*\{[^}]*scrollbar-gutter:\s*stable/s)
        expect(processSource).toMatch(/name:\s*`\$\{chats\.length\}개 \(\$\{start \+ 1\}~\$\{injectedEnd\}\)`/)
    })

    it('shows a failure published before the log view mounts', async () => {
        publishRisuBardMemoryActivity({
            characterId: 'late-character',
            chatId: 'late-chat',
            operation: 'error',
            timestamp: 123,
            message: '위키 조회 제한 시간을 초과했습니다.',
        })
        const target = document.body.appendChild(document.createElement('div'))
        mounted = mount(RisuBardMemoryActivity, {
            target,
            props: {
                characterId: 'late-character',
                chatId: 'late-chat',
                messages: [],
            },
        })
        await tick()

        expect(document.body.textContent).toContain(
            '위키 조회 제한 시간을 초과했습니다.'
        )
    })

    it.each([
        '정본 문서 갱신 실패 (응답 형식 오류). 다음 턴에 자동으로 다시 시도합니다.',
        '정본 문서 갱신 보류: Alice (응답 복구 횟수 소진). 추가 분석을 실행할 수 있습니다.',
    ])('interleaves provider responses and failed canonical results: %s', async (warning) => {
        mocks.loadChatRequestEvidence.mockResolvedValue({
            schemaVersion: 1,
            generatedAt: '2026-09-01T04:08:00.000Z',
            chatId: 'chat-result',
            requestCount: 3,
            totals: { inputTokens: 30, outputTokens: 9, cachedTokens: 0, reasoningTokens: 0 },
            requests: [3, 2, 1].map((id) => ({
                id,
                timestamp: id === 3
                    ? '2026-09-01T04:08:03.000Z'
                    : `2026-09-01T04:07:0${id}.000Z`,
                source: 'memory',
                purpose: 'bardwiki-canonical-update',
                outcome: id === 3 ? 'failed' : 'response-received',
                ...(id === 3 ? { failureCategory: 'format' as const } : {}),
                streaming: false,
                inputTokens: 10,
                outputTokens: 3,
            })),
        })
        const target = document.body.appendChild(document.createElement('div'))
        mounted = mount(RisuBardMemoryActivity, {
            target,
            props: {
                characterId: 'character',
                chatId: 'chat-result',
                messages: [{
                    role: 'char', data: 'reply',
                    time: Date.parse('2026-09-01T04:07:45.000Z'),
                    chatId: 'assistant-1',
                    risubardCanonicalReceipt: {
                        sourceMessageIds: ['assistant-1'],
                        eventIds: ['event-1'],
                        changes: [],
                        warnings: [warning],
                        recordedAt: '2026-09-01T04:07:45.000Z',
                    },
                }],
            },
        })

        await vi.waitFor(() => {
            expect(document.body.textContent).toContain('BardWiki 정본 반영')
            expect(document.body.textContent).toContain('실패')
            expect(document.body.textContent).toContain('응답 수신')
            expect(document.body.textContent).toContain('구조화 응답 검증 오류')
        })
        expect(document.body.textContent).not.toContain('확정 작업 결과')
        expect(document.body.textContent).not.toContain('응답 시도')
        expect([...document.querySelectorAll('time')].map((node) => node.dateTime))
            .toEqual([
                '2026-09-01T04:08:03.000Z',
                '2026-09-01T04:07:45.000Z',
                '2026-09-01T04:07:02.000Z',
                '2026-09-01T04:07:01.000Z',
            ])
    })

    it('does not show an empty state when only a canonical result exists', async () => {
        const target = document.body.appendChild(document.createElement('div'))
        mounted = mount(RisuBardMemoryActivity, {
            target,
            props: {
                characterId: 'character',
                chatId: 'receipt-only',
                messages: [{
                    role: 'char', data: 'reply', chatId: 'assistant-only',
                    risubardCanonicalReceipt: {
                        sourceMessageIds: ['assistant-only'],
                        eventIds: ['event-only'],
                        changes: [], warnings: [],
                        recordedAt: '2026-09-01T04:07:45.000Z',
                    },
                }],
            },
        })

        await vi.waitFor(() => {
            expect(document.body.textContent).toContain('BardWiki 정본 반영')
        })
        expect(document.body.textContent).not.toContain(
            '이 채팅에 보존된 요청 기록이 없습니다.'
        )
    })

    it('shows a failed canonical entry when analysis threw before writing a receipt', async () => {
        const target = document.body.appendChild(document.createElement('div'))
        mounted = mount(RisuBardMemoryActivity, {
            target,
            props: {
                characterId: 'character',
                chatId: 'pending-only',
                messages: [{
                    role: 'char', data: 'reply', chatId: 'assistant-pending',
                    risubardWikiPending: {
                        reason: '정본 저장 검증 실패',
                        failedAt: '2026-09-01T04:07:45.000Z',
                    },
                }],
            },
        })

        await vi.waitFor(() => {
            expect(document.body.textContent).toContain('BardWiki 정본 반영')
            expect(document.body.textContent).toContain('정본에 저장하지 못했습니다: 정본 저장 검증 실패')
            expect(document.querySelector('.result-entry')?.getAttribute('data-outcome')).toBe('failed')
        })
    })

    it('shows per-generation chat and wiki provenance without prompt bodies', async () => {
        mocks.loadChatRequestEvidence.mockResolvedValue({
            schemaVersion: 1,
            generatedAt: '2026-08-12T04:00:00.000Z',
            chatId: 'chat',
            requestCount: 0,
            totals: { inputTokens: 0, outputTokens: 0, cachedTokens: 0, reasoningTokens: 0 },
            requests: [],
        })
        const onSelectPath = vi.fn()
        const target = document.body.appendChild(document.createElement('div'))
        mounted = mount(RisuBardMemoryActivity, {
            target,
            props: {
                characterId: 'character',
                chatId: 'chat',
                messages: [{
                    role: 'char',
                    data: 'secret generated prose',
                    chatId: 'assistant-2',
                    time: Date.UTC(2026, 7, 12, 3, 4, 5),
                    generationInfo: {
                        generationId: 'generation-2',
                        model: 'deepseek-v4-flash',
                        inputTokens: 2841,
                        outputTokens: 617,
                        toolUsed: false,
                        stageTiming: { stage1: 10, stage2: 20, stage3: 3000, stage4: 30 },
                        risuBardContext: {
                            mode: 'current',
                            recentMessages: [{ id: 'user-1', role: 'user' }],
                            wikiPaths: ['characters/라비안.md'],
                            selectedTokens: 210,
                            inquiryDurationMs: 18,
                        },
                    },
                }],
                onSelectPath,
            },
        })
        await tick()

        expect(document.body.textContent).toContain('deepseek-v4-flash')
        expect(document.body.textContent).toContain('답변 생성')
        expect(document.querySelector('time')?.dateTime).toBe(
            '2026-08-12T03:04:05.000Z'
        )
        expect(document.body.textContent).toContain('2,841')
        expect(document.body.textContent).toContain('617')
        expect(document.body.textContent).toContain('user-1')
        expect(document.body.textContent).not.toContain('secret generated prose')
        const path = [...document.querySelectorAll('button')].find((button) =>
            button.textContent?.includes('characters/라비안.md'))!
        path.click()
        expect(onSelectPath).toHaveBeenCalledWith('characters/라비안.md')
    })

    it('does not duplicate a persisted generation under its message id', async () => {
        mocks.loadChatRequestEvidence.mockResolvedValue({
            schemaVersion: 1,
            generatedAt: '2026-08-12T04:00:00.000Z',
            chatId: 'chat-deduplicated',
            requestCount: 1,
            totals: { inputTokens: 100, outputTokens: 20, cachedTokens: 0, reasoningTokens: 0 },
            requests: [{
                id: 1,
                timestamp: '2026-08-12T03:04:05.000Z',
                generationId: 'generation-2',
                source: 'main',
                purpose: 'chat-response',
                outcome: 'done',
                streaming: false,
                inputTokens: 100,
                outputTokens: 20,
            }],
        })
        const target = document.body.appendChild(document.createElement('div'))
        mounted = mount(RisuBardMemoryActivity, {
            target,
            props: {
                characterId: 'character',
                chatId: 'chat-deduplicated',
                messages: [{
                    role: 'char',
                    data: 'generated prose',
                    chatId: 'assistant-2',
                    time: Date.UTC(2026, 7, 12, 3, 4, 5),
                    generationInfo: {
                        generationId: 'generation-2',
                        risuBardContext: {
                            mode: 'current', recentMessages: [], wikiPaths: [],
                            selectedTokens: 0, inquiryDurationMs: 0,
                        },
                    },
                }],
            },
        })
        await vi.waitFor(() => {
            expect(document.querySelectorAll('details.request-entry')).toHaveLength(1)
            expect(document.body.textContent).toContain('스토리 생성')
            expect(document.body.textContent).not.toContain('구형 생성 기록')
        })
    })

    it('labels persisted automatic wiki and administrator requests', async () => {
        mocks.loadChatRequestEvidence.mockResolvedValue({
            schemaVersion: 1,
            generatedAt: '2026-08-12T04:00:00.000Z',
            chatId: 'chat-kinds',
            requestCount: 3,
            totals: { inputTokens: 30, outputTokens: 8, cachedTokens: 0, reasoningTokens: 0 },
            requests: [{
                id: 2,
                timestamp: '2026-08-12T03:05:00.000Z',
                generationId: 'wiki-2',
                source: 'memory',
                purpose: 'bardwiki-analysis',
                outcome: 'done',
                streaming: false,
                inputTokens: 20,
                outputTokens: 5,
            }, {
                id: 3,
                timestamp: '2026-08-12T03:04:30.000Z',
                generationId: 'wiki-3',
                source: 'memory',
                purpose: 'bardwiki-canonical-update',
                outcome: 'done',
                streaming: false,
                inputTokens: 20,
                outputTokens: 5,
            }, {
                id: 1,
                timestamp: '2026-08-12T03:04:00.000Z',
                generationId: 'admin-1',
                source: 'wiki-admin',
                purpose: 'bardwiki-admin',
                outcome: 'done',
                streaming: false,
                inputTokens: 10,
                outputTokens: 3,
            }],
        })
        const target = document.body.appendChild(document.createElement('div'))
        mounted = mount(RisuBardMemoryActivity, {
            target,
            props: { characterId: 'character', chatId: 'chat-kinds', messages: [] },
        })

        await vi.waitFor(() => {
            expect(document.body.textContent).toContain('BardWiki 의미 분석')
            expect(document.body.textContent).toContain('BardWiki 정본 갱신')
            expect(document.body.textContent).toContain('BardWiki 관리자 명령')
        })
        expect([...document.querySelectorAll('time')].map((node) => node.dateTime))
            .toEqual([
                '2026-08-12T03:05:00.000Z',
                '2026-08-12T03:04:30.000Z',
                '2026-08-12T03:04:00.000Z',
            ])
    })

    it('renders retained requests as collapsed summaries with grouped token totals', async () => {
        mocks.loadChatRequestEvidence.mockResolvedValue({
            schemaVersion: 1,
            generatedAt: '2026-08-12T04:00:00.000Z',
            chatId: 'chat-summary',
            requestCount: 1,
            totals: { inputTokens: 2_700, outputTokens: 700, cachedTokens: 0, reasoningTokens: 0 },
            requests: [{
                id: 9,
                timestamp: '2026-08-12T03:04:05.000Z',
                generationId: 'generation-9',
                source: 'main',
                purpose: 'chat-response',
                outcome: 'done',
                streaming: true,
                durationMs: 12_000,
                inputTokens: 2_700,
                outputTokens: 700,
                injectionManifest: {
                    totalTokens: 2_700,
                    items: [
                        { kind: 'systemPrompt', name: 'System Rule', tokens: 300 },
                        { kind: 'persona', tokens: 200 },
                        { kind: 'wiki', name: 'characters/라비안.md', tokens: 400 },
                        { kind: 'lorebook', name: 'Main', tokens: 500 },
                        { kind: 'chatHistory', name: '4개 (1~4)', tokens: 300 },
                        { kind: 'instruction', name: 'Guidelines', tokens: 350 },
                        { kind: 'chatHistory', name: '1개 (5~5)', tokens: 150 },
                        { kind: 'instruction', name: 'Postamble', tokens: 350 },
                        { kind: 'chatHistory', name: '1개 (6~6)', tokens: 150 },
                    ],
                },
            }],
        })
        const target = document.body.appendChild(document.createElement('div'))
        mounted = mount(RisuBardMemoryActivity, {
            target,
            props: { characterId: 'character', chatId: 'chat-summary', messages: [] },
        })

        await vi.waitFor(() => expect(document.querySelector('details.request-entry')).not.toBeNull())
        const card = document.querySelector<HTMLDetailsElement>('details.request-entry')!
        const summary = card.querySelector('summary')?.textContent ?? ''
        expect(card.open).toBe(false)
        expect(summary).toContain('스토리 생성')
        expect(summary).toContain('성공')
        expect(summary).toContain('입력 2,700')
        expect(summary).toContain('출력 700')
        expect(summary).toContain('시스템 1,000')
        expect(summary).toContain('페르소나 200')
        expect(summary).toContain('BardWiki 400')
        expect(summary).toContain('로어북 500')
        expect(summary).toContain('채팅 기록 6개 (1~6) 600')
        expect(document.body.textContent).not.toContain('보존 요청 1')
        expect(document.body.textContent).not.toContain('이번 실행 이벤트 0')
        expect(card.querySelector('.request-details')?.textContent).toContain('System Rule')
        const details = card.querySelector('.request-details')?.textContent ?? ''
        expect(details).toContain('채팅 기록 6개 (1~6)')
        expect(details.match(/추가 지침/g)).toHaveLength(1)
        expect(details).not.toContain('5~5')
        expect(details).not.toContain('6~6')
        const instructionGroup = card.querySelector<HTMLDetailsElement>(
            '[data-injection-group="instruction"]'
        )
        expect(instructionGroup).not.toBeNull()
        expect(instructionGroup?.open).toBe(false)
        expect(instructionGroup?.textContent).toContain('Guidelines')
        expect(instructionGroup?.textContent).toContain('Postamble')
        expect(document.querySelector('.request-kind')?.textContent).not.toMatch(/^\[|\]$/)
    })

    it('reloads retained history when a request-log row is persisted', async () => {
        const base = {
            schemaVersion: 1 as const,
            generatedAt: '2026-08-12T04:00:00.000Z',
            chatId: 'chat-refresh',
            totals: { inputTokens: 10, outputTokens: 2, cachedTokens: 0, reasoningTokens: 0 },
        }
        mocks.loadChatRequestEvidence
            .mockResolvedValueOnce({ ...base, requestCount: 0, requests: [] })
            .mockResolvedValueOnce({
                ...base,
                requestCount: 1,
                requests: [{
                    id: 10,
                    timestamp: '2026-08-12T03:04:05.000Z',
                    generationId: 'persisted-after-mount',
                    source: 'main',
                    purpose: 'chat-response',
                    outcome: 'done',
                    streaming: true,
                    inputTokens: 10,
                    outputTokens: 2,
                }],
            })
        const target = document.body.appendChild(document.createElement('div'))
        mounted = mount(RisuBardMemoryActivity, {
            target,
            props: { characterId: 'character', chatId: 'chat-refresh', messages: [] },
        })
        await vi.waitFor(() => expect(mocks.loadChatRequestEvidence).toHaveBeenCalledTimes(1))

        window.dispatchEvent(new CustomEvent('risubard-request-log-recorded', {
            detail: { sessionChatIds: ['chat-refresh'] },
        }))

        await vi.waitFor(() => {
            expect(mocks.loadChatRequestEvidence).toHaveBeenCalledTimes(2)
            expect(document.body.textContent).toContain('persisted-after-mount')
        })
    })

    it('renders nullable database metrics as unavailable', async () => {
        mocks.loadChatRequestEvidence.mockResolvedValue({
            schemaVersion: 1,
            generatedAt: '2026-08-12T04:00:00.000Z',
            chatId: 'chat-null-metrics',
            requestCount: 1,
            totals: { inputTokens: 0, outputTokens: 0, cachedTokens: 0, reasoningTokens: 0 },
            requests: [{
                id: 1,
                timestamp: '2026-08-12T03:04:00.000Z',
                source: 'main',
                outcome: 'done',
                streaming: false,
                inputTokens: null,
                outputTokens: null,
                durationMs: null,
                firstTokenMs: null,
            }],
        })
        const target = document.body.appendChild(document.createElement('div'))
        mounted = mount(RisuBardMemoryActivity, {
            target,
            props: { characterId: 'character', chatId: 'chat-null-metrics', messages: [] },
        })

        await vi.waitFor(() => {
            expect(document.body.textContent).toContain('답변 생성')
            expect(document.body.textContent).toContain('입력 확인 불가')
            expect(document.body.textContent).toContain('첫 응답 확인 불가 ms')
        })
    })

    it('offers only an icon-labelled Markdown evidence download', async () => {
        mocks.loadChatRequestEvidence.mockResolvedValue({
            schemaVersion: 1,
            generatedAt: '2026-08-12T04:00:00.000Z',
            chatId: 'chat-evidence',
            requestCount: 1,
            totals: { inputTokens: 6537, outputTokens: 792, cachedTokens: 0, reasoningTokens: 0 },
            requests: [],
        })
        const target = document.body.appendChild(document.createElement('div'))
        mounted = mount(RisuBardMemoryActivity, {
            target,
            props: {
                characterId: 'character',
                chatId: 'chat-evidence',
                messages: [],
            },
        })
        await tick()

        const markdown = document.body.querySelector<HTMLButtonElement>(
            '[data-export-request-evidence="markdown"]'
        )
        const json = document.body.querySelector<HTMLButtonElement>(
            '[data-export-request-evidence="json"]'
        )
        expect(markdown).not.toBeNull()
        expect(markdown?.textContent?.trim()).toBe('')
        expect(markdown?.getAttribute('aria-label')).toBe('Markdown 다운로드')
        expect(json).toBeNull()
        expect(document.querySelector('[data-refresh-request-evidence]')).toBeNull()
        markdown?.click()
        await vi.waitFor(() => expect(mocks.downloadFile).toHaveBeenCalledWith(
            expect.stringMatching(/^risubard-chat-evidence-.*\.md$/),
            '# evidence',
        ))
    })

    it('exports legacy generation evidence when no persisted plugin row exists', async () => {
        mocks.loadChatRequestEvidence.mockResolvedValue({
            schemaVersion: 1,
            generatedAt: '2026-08-12T04:00:00.000Z',
            chatId: 'chat-legacy',
            requestCount: 0,
            totals: { inputTokens: 0, outputTokens: 0, cachedTokens: 0, reasoningTokens: 0 },
            requests: [],
        })
        const target = document.body.appendChild(document.createElement('div'))
        mounted = mount(RisuBardMemoryActivity, {
            target,
            props: {
                characterId: 'character',
                chatId: 'chat-legacy',
                messages: [{
                    role: 'char', data: 'hidden', chatId: 'generation-1',
                    time: Date.UTC(2026, 7, 12, 3),
                    generationInfo: {
                        model: 'pluginmodel:::gemini', inputTokens: 10, outputTokens: 2,
                        risuBardContext: {
                            mode: 'current', recentMessages: [], wikiPaths: [],
                            selectedTokens: 0, inquiryDurationMs: 0,
                        },
                    },
                }],
            },
        })
        await tick()
        document.body.querySelector<HTMLButtonElement>(
            '[data-export-request-evidence="markdown"]'
        )?.click()

        await vi.waitFor(() => expect(mocks.downloadFile).toHaveBeenCalledWith(
            expect.stringMatching(/\.md$/),
            expect.any(String),
        ))
        expect(document.body.textContent).not.toContain('저장된 요청 증거가 없습니다')
    })
})
