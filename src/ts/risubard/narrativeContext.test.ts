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
    it('sends at most 96 timeline messages, newest last', async () => {
        let body: any
        await loadNarrativeInquiry({ characterId: 'c', chatId: 'chat', currentInput: 'Alice',
            timeline: { messages: Array.from({ length: 100 }, (_, index) =>
                ({ chatId: `m${index}`, role: 'user' as const })) },
            createAuth: async () => 'auth', fetchImpl: async (_url, options) => {
                body = JSON.parse(String(options?.body))
                return new Response(JSON.stringify({
                    mode: 'v2-current', graphRevision: 0, indexRevision: 0, cacheStatus: 'current',
                    sources: [], evidenceRequests: [],
                    metrics: { candidateCount: 0, inspectedNodeCount: 0, inspectedEdgeCount: 0,
                        selectedNodeCount: 0, selectedTokens: 0, hopCount: 0, auxiliaryModelCalls: 0 },
                }))
            },
        })
        expect(body.timeline.messages).toHaveLength(96)
        expect(body.timeline.messages[0].chatId).toBe('m4')
    })

    it('tells the response model that canon summaries do not establish recency', () => {
        const prompt = createNarrativeSourcesPrompt([
            { id: 'a', kind: 'memory', role: 'system', content: 'x', tokens: 1 },
        ])!
        expect(prompt).toContain('it does not establish when they happened')
    })
    it('transports required and automatic selection without changing the failure contract', async () => {
        for (const contextSelection of ['required', 'auto'] as const) {
            let body: Record<string, unknown> = {}
            await expect(loadNarrativeInquiry({ characterId: 'c', chatId: 'chat', currentInput: '', contextSelection,
                createAuth: async () => 'auth', fetchImpl: async (_url, options) => {
                    body = JSON.parse(String(options?.body))
                    return new Response(JSON.stringify({ code: 'budget-exceeded' }), { status: 500 })
                },
            })).rejects.toMatchObject({ code: 'budget-exceeded' })
            expect(body.contextSelection).toBe(contextSelection)
        }
    })
    it('preserves safe server failure codes without exposing raw server errors', async () => {
        await expect(loadNarrativeInquiry({ characterId: 'c', chatId: 'chat', currentInput: 'Alice',
            createAuth: async () => 'auth', fetchImpl: async () => new Response(JSON.stringify({
                code: 'budget-exceeded', error: 'private path and document contents',
            }), { status: 500 }),
        })).rejects.toMatchObject({ code: 'budget-exceeded', httpStatus: 500 })
    })

    it('re-excerpts an already supplied source using the verified semantic event identity', async () => {
        const request = { messageId: 'm', eventTitle: 'Archive', documentId: 'event' }
        const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
            mode: 'v2-current', graphRevision: 0, indexRevision: 0, cacheStatus: 'current',
            sources: [], evidenceRequests: [request],
            metrics: { candidateCount: 1, inspectedNodeCount: 1, inspectedEdgeCount: 0,
                selectedNodeCount: 0, selectedTokens: 0, hopCount: 0, auxiliaryModelCalls: 0 },
        }))) as unknown as typeof fetch
        const resolve = vi.fn(async () => [{
            messageId: 'm', role: 'assistant' as const, occurredAt: 1, score: 1000,
            content: 'The exact remembered sentence at the end.',
        }])
        await loadNarrativeInquiry({
            characterId: 'c', chatId: 'chat', currentInput: 'What happened?',
            semanticMatches: [{ documentId: 'event', score: 0.9, contentHash: 'hash', start: 12000, end: 12500 }],
            sourceMatches: [{ messageId: 'm', role: 'assistant', occurredAt: 1, score: 2, content: 'Misleading beginning.' }],
            resolveSourceMatches: resolve, fetchImpl, createAuth: async () => 'auth',
        })
        expect(resolve).toHaveBeenCalledWith(['m'], [request])
        expect(fetchImpl).toHaveBeenCalledTimes(2)
        const body = JSON.parse((fetchImpl as any).mock.calls[1][1].body)
        expect(body.sourceMatches[0].content).toContain('exact remembered sentence')
        expect(body.semanticMatches[0]).toMatchObject({ contentHash: 'hash', start: 12000, end: 12500 })
    })

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

    it('preserves long inquiry sources and their token counts without a hidden character limit', async () => {
        const content = '위키 근거 '.repeat(3000)
        const source = { id: 'long-wiki', kind: 'memory', role: 'system', content, tokens: 5000, priority: 100 }
        const inquiry = await loadNarrativeInquiry({
            characterId: 'character', chatId: 'chat', currentInput: '위키',
            tokenBudget: { target: 8000, events: 8000, perSource: 8000, maximum: 16000 },
            createAuth: async () => 'auth',
            fetchImpl: vi.fn(async () => new Response(JSON.stringify({
                mode: 'v2-current', graphRevision: 1, indexRevision: 1, cacheStatus: 'current',
                sources: [source],
                metrics: { candidateCount: 1, inspectedNodeCount: 1, inspectedEdgeCount: 0,
                    selectedNodeCount: 1, selectedTokens: 5000, hopCount: 0, auxiliaryModelCalls: 0 },
            }))) as typeof fetch,
        })
        expect(inquiry.sources[0].content).toBe(content)
        expect(inquiry.sources[0].tokens).toBe(5000)
        expect(createNarrativeSourcesPrompt(inquiry.sources)).toContain(content)
        const selected = Array.from({ length: 20 }, (_, index) => ({
            ...inquiry.sources[0], id: `selected-${index}`, content: `selected evidence ${index}`,
        }))
        expect(createNarrativeSourcesPrompt(selected)).toContain('selected evidence 19')
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

    it('counts configured history as assistant turns and retains the current user request', () => {
        const messages = Array.from({ length: 8 }, (_, index) => [
            { id: `user-${index + 1}`, role: 'user' },
            { id: `assistant-${index + 1}`, role: 'char' },
        ]).flat().concat({ id: 'user-current', role: 'user' })

        const withUsers = selectNarrativeWorkingMessages(
            messages, 2, true
        )
        expect(withUsers.map((message) => message.id)).toEqual([
            'user-7', 'assistant-7', 'user-8', 'assistant-8', 'user-current',
        ])

        const withoutHistoricalUsers = selectNarrativeWorkingMessages(
            messages, 2, false
        )
        expect(withoutHistoricalUsers.filter((message) => message.role === 'user'))
            .toEqual([{ id: 'user-current', role: 'user' }])
        expect(withoutHistoricalUsers.filter((message) => message.role === 'char'))
            .toHaveLength(2)
    })

    it('excludes an OOC exchange before applying the response window but retains the pending request', () => {
        const messages = [
            { id: 'user-story', role: 'user', data: 'Continue the story.' },
            { id: 'assistant-story', role: 'char', data: 'The story continues.' },
            { id: 'user-ooc', role: 'user', data: 'Plan the next scene.' },
            { id: 'assistant-ooc', role: 'char', data: '<!-- OOC_turn -->\nPlan: continue.' },
            { id: 'user-current', role: 'user', data: 'Write the next scene.' },
        ]

        expect(selectNarrativeWorkingMessages(messages, 1, true, true)
            .map((message) => message.id)).toEqual([
            'user-story', 'assistant-story', 'user-current',
        ])
        expect(selectNarrativeWorkingMessages(messages, 2, true, false)
            .map((message) => message.id)).toContain('assistant-ooc')
        expect(selectNarrativeWorkingMessages(messages, 2, true, false)
            .map((message) => message.id)).toContain('user-ooc')

        const completedOoc = messages.slice(0, 4)
        expect(selectNarrativeWorkingMessages(completedOoc, 1, true, true)
            .map((message) => message.id)).toEqual([
            'user-story', 'assistant-story',
        ])

        const assistantRoleOoc = messages.map((message) =>
            message.id === 'assistant-ooc' ? { ...message, role: 'assistant' } : message
        )
        expect(selectNarrativeWorkingMessages(assistantRoleOoc, 1, true, true)
            .map((message) => message.id)).not.toContain('assistant-ooc')
    })

    it('keeps only the trailing OOC exchanges outside the response window', () => {
        const ids = (messages: { id: string }[]) => messages.map((message) => message.id)
        const messages = [
            { id: 'u1', role: 'user', data: 'Story one.' },
            { id: 'a1', role: 'char', data: 'Story reply one.' },
            { id: 'u-old', role: 'user', data: 'Old question.' },
            { id: 'a-old', role: 'char', data: '<!-- OOC_turn -->\nOld answer.' },
            { id: 'u2', role: 'user', data: 'Story two.' },
            { id: 'a2', role: 'char', data: 'Story reply two.' },
            { id: 'u-ooc1', role: 'user', data: 'Question one.' },
            { id: 'a-ooc1', role: 'char', data: '<!-- OOC_turn -->\nAnswer one.' },
            { id: 'u-ooc2', role: 'user', data: 'Question two.' },
            { id: 'a-ooc2', role: 'char', data: '<!-- OOC_turn -->\nAnswer two.' },
            { id: 'u-now', role: 'user', data: 'Question three.' },
        ]

        expect(ids(selectNarrativeWorkingMessages(messages, 1, true, true, true))).toEqual([
            'u2', 'a2', 'u-ooc1', 'a-ooc1', 'u-ooc2', 'a-ooc2', 'u-now',
        ])
        expect(ids(selectNarrativeWorkingMessages(messages, 2, true, true, true))).toEqual([
            'u1', 'a1', 'u2', 'a2', 'u-ooc1', 'a-ooc1', 'u-ooc2', 'a-ooc2', 'u-now',
        ])
        expect(ids(selectNarrativeWorkingMessages(messages, 1, true, true, false))).toEqual([
            'u2', 'a2', 'u-now',
        ])

        const resumedStory = [...messages.slice(0, 10),
            { id: 'u3', role: 'user', data: 'Story three.' },
            { id: 'a3', role: 'char', data: 'Story reply three.' },
        ]
        expect(ids(selectNarrativeWorkingMessages(resumedStory, 2, true, true, true))).toEqual([
            'u2', 'a2', 'u3', 'a3',
        ])
    })

    it('keeps the first greeting inside the message budget', () => {
        expect(shouldIncludeNarrativeFirstMessage(11, 12)).toBe(true)
        expect(shouldIncludeNarrativeFirstMessage(12, 12)).toBe(false)
        expect(shouldIncludeNarrativeFirstMessage(20, 12)).toBe(false)
    })
})
