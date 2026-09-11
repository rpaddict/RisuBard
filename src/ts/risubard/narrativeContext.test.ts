import { describe, expect, it, vi } from 'vitest'
import {
    createNarrativeSourcesPrompt,
    createNarrativeContextPrompt,
    mergeNarrativeContextWithStaticPrompt,
    isNarrativeContextOptedIn,
    loadNarrativeInquiry,
    ensureNarrativeSessionChatId,
    findNarrativeSessionChat,
    selectPromptedNarrativeSources,
    normalizeNarrativeWorkingMessageLimit,
    selectNarrativeWorkingMessages,
    shouldIncludeNarrativeFirstMessage,
} from './narrativeContext'

describe('narrative context prompt composition', () => {
    it('keeps static character and active lore prompts beside native BardWiki context', () => {
        const character = { content: 'character' }
        const assetLore = { content: 'asset output instructions' }
        const wiki = { content: 'current scene' }

        expect(mergeNarrativeContextWithStaticPrompt({
            currentContext: wiki,
            baseline: null,
            baseDescription: character,
            descriptionPrompts: [character],
            afterDescriptionPrompts: [],
            activeLorePrompts: [assetLore],
        })).toEqual({
            baseDescription: character,
            descriptionPrompts: [character, wiki],
            afterDescriptionPrompts: [wiki],
            activeLorePrompts: [assetLore],
        })
    })

    it('replaces static prompts only when a synthesized baseline represents them', () => {
        const character = { content: 'character' }
        const assetLore = { content: 'asset output instructions' }
        const baseline = { content: 'synthesized baseline and wiki' }

        expect(mergeNarrativeContextWithStaticPrompt({
            currentContext: baseline,
            baseline: 'synthesized baseline',
            baseDescription: character,
            descriptionPrompts: [character],
            afterDescriptionPrompts: [],
            activeLorePrompts: [assetLore],
        })).toEqual({
            baseDescription: baseline,
            descriptionPrompts: [baseline],
            afterDescriptionPrompts: [],
            activeLorePrompts: [],
        })
    })
})

describe('actual narrative inquiry prompt', () => {
    it('assigns one stable v2 session ID to an idless legacy chat', () => {
        const chat: { id?: string } = {}
        const createId = vi.fn(() => 'generated-chat-id')

        expect(ensureNarrativeSessionChatId(chat, createId))
            .toBe('generated-chat-id')
        expect(chat.id).toBe('generated-chat-id')
        expect(ensureNarrativeSessionChatId(chat, createId))
            .toBe('generated-chat-id')
        expect(createId).toHaveBeenCalledOnce()
    })

    it('resolves the captured v2 session after chat indexes change', () => {
        const captured = { id: 'captured-id', message: ['captured'] }
        const chats = [
            { id: 'other-id', message: ['other'] },
            captured,
        ]

        expect(findNarrativeSessionChat(chats, 'captured-id')).toBe(captured)
        expect(findNarrativeSessionChat(chats, 'missing-id')).toBeUndefined()
    })

    it('invokes browser fetch with the Window-compatible global receiver', async () => {
        const fetchImpl = function (
            this: unknown
        ): Promise<Response> {
            if (this !== globalThis) {
                throw new TypeError(
                    "'fetch' called on an object that does not implement interface Window."
                )
            }
            return Promise.resolve(new Response(JSON.stringify({
                mode: 'bounded-v1-fallback',
                graphRevision: 0,
                indexRevision: 0,
                cacheStatus: 'missing-or-stale',
                sources: [],
                entityCandidates: [],
                metrics: {
                    candidateCount: 0,
                    inspectedNodeCount: 0,
                    inspectedEdgeCount: 0,
                    selectedNodeCount: 0,
                    selectedTokens: 0,
                    hopCount: 0,
                    auxiliaryModelCalls: 0,
                },
            })))
        } as typeof fetch

        await expect(loadNarrativeInquiry({
            characterId: 'character-1',
            chatId: 'chat-1',
            currentInput: 'What happened?',
            fetchImpl,
            createAuth: async () => 'auth',
        })).resolves.toMatchObject({
            mode: 'bounded-v1-fallback',
            sources: [],
        })
    })

    it('allows a normal local inquiry to take longer than 150 ms', async () => {
        const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
            mode: 'bounded-v1-fallback',
            graphRevision: 0,
            indexRevision: 0,
            cacheStatus: 'missing-or-stale',
            sources: [],
            entityCandidates: [],
            metrics: {
                candidateCount: 0,
                inspectedNodeCount: 0,
                inspectedEdgeCount: 0,
                selectedNodeCount: 0,
                selectedTokens: 0,
                hopCount: 0,
                auxiliaryModelCalls: 0,
            },
        }))) as unknown as typeof fetch

        await expect(loadNarrativeInquiry({
            characterId: 'character-1',
            chatId: 'chat-1',
            currentInput: 'What happened?',
            fetchImpl,
            createAuth: async () => {
                await new Promise((resolve) => setTimeout(resolve, 175))
                return 'auth'
            },
        })).resolves.toMatchObject({
            mode: 'bounded-v1-fallback',
            sources: [],
        })
    })

    it('enables current narrative memory by default unless explicitly disabled', () => {
        expect(isNarrativeContextOptedIn({
            getItem: () => null,
        })).toBe(true)
        expect(isNarrativeContextOptedIn({
            getItem: () => 'false',
        })).toBe(false)
        expect(isNarrativeContextOptedIn({
            getItem: () => 'true',
        })).toBe(true)
    })

    it('aborts a stalled local inquiry within its fixed timeout', async () => {
        const fetchImpl = vi.fn((_url: unknown, init?: RequestInit) =>
            new Promise<Response>((_resolve, reject) => {
                init?.signal?.addEventListener('abort', () => {
                    reject(new DOMException('Aborted', 'AbortError'))
                })
            })) as unknown as typeof fetch

        await expect(loadNarrativeInquiry({
            characterId: 'character-1',
            chatId: 'chat-1',
            currentInput: 'What happened?',
            fetchImpl,
            createAuth: async () => 'auth',
            timeoutMs: 5,
        })).rejects.toMatchObject({
            name: 'AbortError',
            message: 'RisuBard narrative inquiry timed out after 5 ms',
        })
    })

    it('applies the inquiry deadline while authentication is stalled', async () => {
        await expect(loadNarrativeInquiry({
            characterId: 'character-1',
            chatId: 'chat-1',
            currentInput: 'What happened?',
            fetchImpl: vi.fn() as unknown as typeof fetch,
            createAuth: () => new Promise<string>(() => undefined),
            timeoutMs: 5,
        })).rejects.toMatchObject({ name: 'AbortError' })
    })

    it('applies the inquiry deadline while the response body is stalled', async () => {
        const fetchImpl = vi.fn(async () => ({
            ok: true,
            status: 200,
            json: () => new Promise<unknown>(() => undefined),
        } as Response)) as unknown as typeof fetch

        await expect(loadNarrativeInquiry({
            characterId: 'character-1',
            chatId: 'chat-1',
            currentInput: 'What happened?',
            fetchImpl,
            createAuth: async () => 'auth',
            timeoutMs: 5,
        })).rejects.toMatchObject({ name: 'AbortError' })
    })

    it('sends bounded recent conversation text as a fallback inquiry', async () => {
        const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
            mode: 'v2-current',
            graphRevision: 0,
            indexRevision: 0,
            cacheStatus: 'current',
            sources: [],
            entityCandidates: [],
            metrics: {
                candidateCount: 0,
                inspectedNodeCount: 0,
                inspectedEdgeCount: 0,
                selectedNodeCount: 0,
                selectedTokens: 0,
                hopCount: 0,
                auxiliaryModelCalls: 0,
            },
        }))) as unknown as typeof fetch

        await loadNarrativeInquiry({
            characterId: 'character-1',
            chatId: 'chat-1',
            currentInput: '*says nothing*',
            fallbackInput: '하니아와 침수된 도서관'.repeat(400),
            fetchImpl,
            createAuth: async () => 'auth',
        })

        const body = JSON.parse((fetchImpl as any).mock.calls[0][1].body)
        expect(body.fallbackInput).toHaveLength(4_096)
        expect(body.fallbackInput).toBe(
            '하니아와 침수된 도서관'.repeat(400).slice(-4_096)
        )
    })

    it('loads bounded server sources and serializes only selected content', async () => {
        const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
            mode: 'v2-current',
            graphRevision: 4,
            indexRevision: 4,
            cacheStatus: 'current',
            sources: [{
                id: 'narrative-memory:event:bridge',
                kind: 'memory',
                role: 'system',
                content: '[Event] The bridge collapsed.',
                tokens: 8,
                priority: 120,
            }],
            metrics: {
                candidateCount: 1,
                inspectedNodeCount: 1,
                inspectedEdgeCount: 0,
                selectedNodeCount: 1,
                selectedTokens: 8,
                hopCount: 1,
                auxiliaryModelCalls: 0,
            },
        }))) as unknown as typeof fetch

        const inquiry = await loadNarrativeInquiry({
            characterId: 'character-1',
            chatId: 'chat-1',
            currentInput: 'What happened?',
            tokenBudget: { target: 1_500, events: 2_000, perSource: 700, maximum: 4_500 },
            semanticMatches: [{
                documentId: 'event-bridge',
                score: 0.91,
            }],
            entityHints: [{
                kind: 'character',
                names: ['Haania', 'Hania', '하니아', 'Hanya'],
            }],
            sourceMatches: Array.from({ length: 9 }, (_, index) => ({
                messageId: `message-${index}`,
                role: 'assistant' as const,
                content: index === 0
                    ? '플러피풋의 사과 에일'
                    : `과거 원문 ${index}`,
                score: 9 - index,
                occurredAt: index,
            })),
            fetchImpl,
            createAuth: async () => 'auth',
        })
        const prompt = createNarrativeSourcesPrompt(
            inquiry.sources,
            'Lina is at the bridge.'
        )

        expect(prompt).toContain('Lina is at the bridge.')
        expect(prompt).toContain('narrative-memory:event:bridge')
        expect(prompt).toContain('[Event] The bridge collapsed.')
        expect(fetchImpl).toHaveBeenCalledWith(
            '/api/risubard/memory/inquiry',
            expect.objectContaining({
                method: 'POST',
                body: JSON.stringify({
                    characterId: 'character-1',
                    chatId: 'chat-1',
                    currentInput: 'What happened?',
                    tokenBudget: { target: 1_500, events: 2_000, perSource: 700, maximum: 4_500 },
                    semanticMatches: [{
                        documentId: 'event-bridge',
                        score: 0.91,
                    }],
                    entityHints: [{
                        kind: 'character',
                        names: ['Haania', 'Hania', '하니아', 'Hanya'],
                    }],
                    sourceMatches: Array.from({ length: 9 }, (_, index) => ({
                        messageId: `message-${index}`,
                        role: 'assistant',
                        content: index === 0
                            ? '플러피풋의 사과 에일'
                            : `과거 원문 ${index}`,
                        score: 9 - index,
                        occurredAt: index,
                    })),
                }),
            })
        )
    })

    it('accepts Markdown inquiry metrics above the retired v1 token budget', async () => {
        const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
            mode: 'v2-current',
            graphRevision: 7,
            indexRevision: 7,
            cacheStatus: 'current',
            sources: [],
            metrics: {
                candidateCount: 7,
                inspectedNodeCount: 7,
                inspectedEdgeCount: 0,
                selectedNodeCount: 6,
                selectedTokens: 1_147,
                hopCount: 0,
                auxiliaryModelCalls: 0,
            },
        }))) as unknown as typeof fetch

        await expect(loadNarrativeInquiry({
            characterId: 'character-1',
            chatId: 'chat-1',
            currentInput: '여섯 명의 구조 대상 정보를 분석한다.',
            fetchImpl,
            createAuth: async () => 'auth',
        })).resolves.toMatchObject({
            metrics: { selectedTokens: 1_147 },
        })
    })

    it('recompiles with exact source IDs requested by the selected event', async () => {
        const base = {
            mode: 'v2-current',
            graphRevision: 2,
            indexRevision: 2,
            cacheStatus: 'current',
            entityCandidates: [],
            metrics: {
                candidateCount: 2,
                inspectedNodeCount: 2,
                inspectedEdgeCount: 0,
                selectedNodeCount: 1,
                selectedTokens: 40,
                selectedEventTokens: 40,
                semanticCandidateCount: 0,
                hopCount: 0,
                auxiliaryModelCalls: 0,
            },
        }
        const fetchImpl = vi.fn()
            .mockResolvedValueOnce(new Response(JSON.stringify({
                ...base,
                sources: [{
                    id: 'narrative-memory:wiki:events/abduction.md',
                    kind: 'memory',
                    role: 'system',
                    content: '# 네 처녀의 실종',
                    tokens: 40,
                    priority: 120,
                    displayName: '사건 · 네 처녀의 실종 · abduction',
                }],
                evidenceRequests: [{
                    messageId: 'turn-4',
                    eventTitle: '네 처녀의 실종',
                }],
            })))
            .mockResolvedValueOnce(new Response(JSON.stringify({
                ...base,
                sources: [
                    {
                        id: 'narrative-memory:wiki:events/abduction.md',
                        kind: 'memory',
                        role: 'system',
                        content: '# 네 처녀의 실종',
                        tokens: 40,
                        priority: 120,
                        displayName: '사건 · 네 처녀의 실종 · abduction',
                    },
                    {
                        id: 'narrative-memory:source:turn-4:7',
                        kind: 'memory',
                        role: 'system',
                        content: '기도실과 본당 어디에도 시신은 없었다.',
                        tokens: 20,
                        priority: 250,
                        occurredAt: 7,
                        displayName: '과거 원문 · 턴 4 응답 · 출처 기반 · 네 처녀의 실종',
                    },
                ],
                evidenceRequests: [{
                    messageId: 'turn-4',
                    eventTitle: '네 처녀의 실종',
                }],
            }))) as unknown as typeof fetch

        const inquiry = await loadNarrativeInquiry({
            characterId: 'character-1',
            chatId: 'chat-1',
            currentInput: '수녀들이 데려간 여자들에 대해 묻는다.',
            sourceLimit: 8,
            sourceMatches: [{
                messageId: 'turn-9', role: 'assistant', occurredAt: 17,
                score: 9, content: '수녀 괴물과 싸웠다.',
            }],
            resolveSourceMatches: (messageIds) => messageIds.map(
                (messageId) => ({
                    messageId,
                    role: 'assistant' as const,
                    occurredAt: 7,
                    score: 1_000,
                    content: '기도실과 본당 어디에도 시신은 없었다.',
                })
            ),
            fetchImpl,
            createAuth: async () => 'auth',
        } as any)

        expect(fetchImpl).toHaveBeenCalledTimes(2)
        const secondBody = JSON.parse(
            (fetchImpl as any).mock.calls[1][1].body
        )
        expect(secondBody.sourceLimit).toBe(8)
        expect(secondBody.sourceMatches.map(
            (match: { messageId: string }) => match.messageId
        )).toEqual(['turn-4', 'turn-9'])
        expect((inquiry.sources[0] as any).displayName).toBe(
            '사건 · 네 처녀의 실종 · abduction'
        )
        expect((inquiry.sources[1] as any).displayName).toContain(
            '턴 4 응답 · 출처 기반 · 네 처녀의 실종'
        )
    })

    it('accepts progressive inquiry metrics for a large Markdown catalog', async () => {
        const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
            mode: 'v2-current',
            graphRevision: 2_000,
            indexRevision: 2_000,
            cacheStatus: 'current',
            sources: [],
            metrics: {
                candidateCount: 64,
                inspectedNodeCount: 2_000,
                inspectedEdgeCount: 128,
                selectedNodeCount: 3,
                selectedTokens: 450,
                semanticCandidateCount: 2,
                hopCount: 2,
                auxiliaryModelCalls: 0,
            },
        }))) as unknown as typeof fetch

        await expect(loadNarrativeInquiry({
            characterId: 'character-1',
            chatId: 'chat-1',
            currentInput: '에아렌딜의 유리병은 어디서 얻었지?',
            fetchImpl,
            createAuth: async () => 'auth',
        })).resolves.toMatchObject({
            metrics: {
                inspectedNodeCount: 2_000,
                semanticCandidateCount: 2,
                hopCount: 2,
            },
        })
    })

    it('caps source count and prompt bytes independently of graph size', () => {
        const sources = Array.from({ length: 20 }, (_, index) => ({
            id: `memory-${index}`,
            kind: 'memory' as const,
            role: 'system' as const,
            content: `Memory ${index} ${'x'.repeat(1_000)}`,
            tokens: 260,
            priority: 100 - index,
        }))

        const prompt = createNarrativeSourcesPrompt(sources, '', 4_096)

        expect(prompt.length).toBeLessThanOrEqual(4_096)
        expect(prompt).toContain('Memory 0')
        expect(prompt).not.toContain('Memory 16')
    })

    it('grounds historical answers without inventing omitted relations', () => {
        const prompt = createNarrativeSourcesPrompt([{
            id: 'narrative-memory:wiki:events/outburst.md',
            kind: 'memory',
            role: 'system',
            content: '진우는 필통을 책상에 내던지며 미나에게 소리쳤다.',
            tokens: 24,
            priority: 120,
        }], '')!

        expect(prompt).toContain('Treat retrieved sources as authoritative evidence')
        expect(prompt).toContain('chronology')
        expect(prompt).toContain('viewpoint knowledge')
    })

    it('gives canonical current-state sections precedence', () => {
        const prompt = createNarrativeSourcesPrompt([{
            id: 'narrative-memory:wiki:characters/체사레.md',
            kind: 'memory', role: 'system',
            content: '## 체사레\n\n### 현재 상태\n\n- 쉽독이다.',
            tokens: 20, priority: 120,
        }], '')!

        expect(prompt).toContain('current canonical state for present facts')
        expect(prompt).toContain('unsupported continuation')
    })

    it('injects preset-bound response guidance only beside retrieved Wiki sources', () => {
        const source = {
            id: 'narrative-memory:wiki:events/stone-door.md',
            kind: 'memory' as const,
            role: 'system' as const,
            content: '문 왼쪽에는 태양·불·아기, 오른쪽에는 달·물·빈칸이 있다.',
            tokens: 30,
            priority: 120,
        }
        const responseGuide = '대칭 배열과 빈칸의 관계를 먼저 추론하라.'

        expect(createNarrativeSourcesPrompt(
            [source], '', 12_000, responseGuide
        )).toContain(`Wiki preset response guidance:\n${responseGuide}`)
        expect(createNarrativeSourcesPrompt(
            [], '현재 장면', 12_000, responseGuide
        )).not.toContain(responseGuide)
    })

    it('keeps a source identity when its content is truncated by the prompt budget', () => {
        const source = {
            id: 'narrative-memory:wiki:places/bridge.md',
            kind: 'memory' as const,
            role: 'system' as const,
            content: `Bridge details ${'x'.repeat(200)}`,
            tokens: 55,
            priority: 100,
        }
        const fullPrompt = createNarrativeSourcesPrompt([source], '')!
        const truncatedPrompt = createNarrativeSourcesPrompt(
            [source],
            '',
            fullPrompt.indexOf(source.content) + 20
        )!
        expect(selectPromptedNarrativeSources).toBeTypeOf('function')
        expect(selectPromptedNarrativeSources([source], truncatedPrompt))
            .toEqual([source])
        expect(truncatedPrompt).not.toContain(source.content)
    })
})

describe('createNarrativeContextPrompt', () => {
    it('uses only active facts and recent events within a fixed budget', () => {
        const prompt = createNarrativeContextPrompt({
            facts: [
                { id: 'old', text: 'Old', status: 'invalidated', evidence: [] },
                { id: 'current', text: 'Current fact', status: 'active', evidence: [] },
            ],
            events: Array.from({ length: 10 }, (_, index) => ({
                id: `event-${index}`,
                summary: `Event ${index}`,
                evidence: [],
            })),
            appliedOperationIds: [],
        }, 120)

        expect(prompt).toContain('Current fact')
        expect(prompt).not.toContain('Old')
        expect(prompt.length).toBeLessThanOrEqual(120)
    })

    it('returns null until current narrative memory exists', () => {
        expect(createNarrativeContextPrompt({
            facts: [],
            events: [],
            appliedOperationIds: [],
        }, 1_000)).toBeNull()
    })
})

describe('selectNarrativeWorkingMessages', () => {
    it('normalizes a user-configured full-message window', () => {
        expect(normalizeNarrativeWorkingMessageLimit(undefined)).toBe(12)
        expect(normalizeNarrativeWorkingMessageLimit(0)).toBe(12)
        expect(normalizeNarrativeWorkingMessageLimit(101)).toBe(101)
        expect(normalizeNarrativeWorkingMessageLimit(Infinity)).toBe(12)
        expect(normalizeNarrativeWorkingMessageLimit(Number.MAX_SAFE_INTEGER + 1)).toBe(12)
        expect(normalizeNarrativeWorkingMessageLimit(24)).toBe(24)
    })

    it('caps both current and fallback modes to recent messages', () => {
        const messages = Array.from({ length: 20 }, (_, index) => ({
            id: `message-${index}`,
        }))

        expect(selectNarrativeWorkingMessages(
            messages,
            12
        )).toEqual(messages.slice(-12))
        expect(messages).toHaveLength(20)
    })

    it('can omit historical user turns while retaining the current user request', () => {
        const messages = [
            { id: 'user-1', role: 'user' },
            { id: 'assistant-1', role: 'char' },
            { id: 'user-2', role: 'user' },
            { id: 'assistant-2', role: 'char' },
            { id: 'user-current', role: 'user' },
        ]

        expect(selectNarrativeWorkingMessages(
            messages,
            3,
            false
        ).map((message) => message.id)).toEqual([
            'assistant-1',
            'assistant-2',
            'user-current',
        ])
    })

    it('counts eight as total slots and always retains the current user request', () => {
        const messages = Array.from({ length: 8 }, (_, index) => [
            { id: `user-${index + 1}`, role: 'user' },
            { id: `assistant-${index + 1}`, role: 'char' },
        ]).flat().concat({ id: 'user-current', role: 'user' })

        const withUsers = selectNarrativeWorkingMessages(
            messages, 8, true
        )
        expect(withUsers.filter((message) => message.role === 'user')).toHaveLength(4)
        expect(withUsers.filter((message) => message.role === 'char')).toHaveLength(4)

        const withoutHistoricalUsers = selectNarrativeWorkingMessages(
            messages, 8, false
        )
        expect(withoutHistoricalUsers.filter((message) => message.role === 'user'))
            .toEqual([{ id: 'user-current', role: 'user' }])
        expect(withoutHistoricalUsers.filter((message) => message.role === 'char'))
            .toHaveLength(7)
    })

    it('keeps the first greeting inside the message budget', () => {
        expect(shouldIncludeNarrativeFirstMessage(11, 12)).toBe(true)
        expect(shouldIncludeNarrativeFirstMessage(12, 12)).toBe(false)
        expect(shouldIncludeNarrativeFirstMessage(20, 12)).toBe(false)
    })
})
