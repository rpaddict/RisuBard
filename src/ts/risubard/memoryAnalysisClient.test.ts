import { describe, expect, test, vi } from 'vitest'
import { get_encoding } from '@dqbd/tiktoken'
import {
    buildBoundedNarrativeInquiryFallback,
    createStoredResponseMemoryAnalysis,
    projectRecentMemoryMessages,
    type MemoryAnalysisModelCall,
    type MemoryAnalysisModelResponse,
} from './memoryAnalysisClient'

describe('stored response memory analysis', () => {
    test('builds the recent inquiry fallback from the end within its character budget', () => {
        expect(buildBoundedNarrativeInquiryFallback([
            { messageId: '1', role: 'assistant', content: 'a'.repeat(20) },
            { messageId: '2', role: 'user', content: '*waits*' },
        ], 16)).toBe(`${'a'.repeat(8)}\n*waits*`)
    })

    test('selects only the accepted prior turn after the next user message', async () => {
        const module = await import('./memoryAnalysisClient')
        const project = (
            module as unknown as {
                projectConfirmedMemoryTurn?: (
                    messages: unknown[]
                ) => unknown
            }
        ).projectConfirmedMemoryTurn

        expect(project?.([
            {
                role: 'user',
                data: 'Open the gate.',
                chatId: 'user-1',
            },
            {
                role: 'char',
                data: 'The gate opened.',
                chatId: 'assistant-1',
            },
            {
                role: 'user',
                data: 'What is beyond it?',
                chatId: 'user-2',
            },
        ])).toEqual({
            targetMessageId: 'assistant-1',
            messages: [
                {
                    messageId: 'user-1',
                    role: 'user',
                    content: 'Open the gate.',
                },
                {
                    messageId: 'assistant-1',
                    role: 'assistant',
                    content: 'The gate opened.',
                },
            ],
        })
    })

    test('selects the current assistant turn only when explicitly confirmed', async () => {
        const module = await import('./memoryAnalysisClient')
        const project = (
            module as unknown as {
                projectConfirmedMemoryTurn?: (
                    messages: unknown[],
                    targetMessageId?: string
                ) => unknown
            }
        ).projectConfirmedMemoryTurn
        const messages = [
            {
                role: 'user',
                data: 'Open the gate.',
                chatId: 'user-1',
            },
            {
                role: 'char',
                data: 'The gate opened.',
                chatId: 'assistant-1',
            },
        ]

        expect(project?.(messages)).toBeNull()
        expect(project?.(messages, 'assistant-1')).toMatchObject({
            targetMessageId: 'assistant-1',
            messages: [
                { messageId: 'user-1' },
                { messageId: 'assistant-1' },
            ],
        })
    })

    test('does not select an already confirmed or replaced response', async () => {
        const module = await import('./memoryAnalysisClient')
        const project = (
            module as unknown as {
                projectConfirmedMemoryTurn?: (
                    messages: unknown[],
                    targetMessageId?: string
                ) => unknown
            }
        ).projectConfirmedMemoryTurn

        expect(project?.([{
            role: 'user',
            data: 'Open the gate.',
            chatId: 'user-1',
        }])).toBeNull()
        expect(project?.([
            {
                role: 'user',
                data: 'Open the gate.',
                chatId: 'user-1',
            },
            {
                role: 'char',
                data: 'The gate opened.',
                chatId: 'assistant-1',
                risubardMemoryConfirmed: true,
            },
            {
                role: 'user',
                data: 'What is beyond it?',
                chatId: 'user-2',
            },
        ])).toBeNull()
    })

    test('reselects an already confirmed response only for an explicit force update', async () => {
        const module = await import('./memoryAnalysisClient')
        const project = (
            module as unknown as {
                projectConfirmedMemoryTurn?: (
                    messages: unknown[],
                    targetMessageId?: string,
                    options?: { includeConfirmed?: boolean }
                ) => unknown
            }
        ).projectConfirmedMemoryTurn
        const messages = [{
            role: 'user',
            data: '문을 연다.',
            chatId: 'user-1',
        }, {
            role: 'char',
            data: '문이 열렸다.',
            chatId: 'assistant-1',
            risubardMemoryConfirmed: true,
        }]

        expect(project?.(messages, 'assistant-1')).toBeNull()
        expect(project?.(messages, 'assistant-1', {
            includeConfirmed: true,
        })).toMatchObject({
            targetMessageId: 'assistant-1',
        })
    })

    test('invokes browser fetch with the Window-compatible global receiver', async () => {
        const fetchImpl = function (
            this: unknown,
            input: RequestInfo | URL
        ) {
            if (this !== globalThis) {
                throw new TypeError(
                    "'fetch' called on an object that does not implement interface Window."
                )
            }
            if (String(input).endsWith('/source')) {
                return Promise.resolve(new Response(JSON.stringify({
                    snapshot: { schemaVersion: 1, sources: [] },
                    baseline: 'Baseline',
                })))
            }
            return Promise.resolve(new Response(JSON.stringify({
                facts: [],
                events: [],
                appliedOperationIds: [],
            })))
        } as typeof fetch
        const analysis = createStoredResponseMemoryAnalysis({
            requestModel: vi.fn(),
            fetchImpl,
            createAuth: async () => 'test-jwt',
            onError: vi.fn(),
        })

        await expect(analysis.prepareContext(
            'character',
            'chat',
            { schemaVersion: 1, sources: [] }
        )).resolves.toMatchObject({ baseline: 'Baseline' })
    })

    test('releases stalled baseline work so the next turn can retry', async () => {
        let modelCalls = 0
        let resolveFirstModel!: (value: MemoryAnalysisModelResponse) => void
        const storedBaselines: string[] = []
        const onError = vi.fn()
        const analysis = createStoredResponseMemoryAnalysis({
            requestModel: () => {
                modelCalls += 1
                return modelCalls === 1
                    ? new Promise<MemoryAnalysisModelResponse>((resolve) => {
                        resolveFirstModel = resolve
                    })
                    : Promise.resolve({
                        type: 'success',
                        result: 'Recovered baseline',
                    })
            },
            fetchImpl: vi.fn(async (input, init) => {
                if (String(input).endsWith('/baseline')) {
                    const body = JSON.parse(String(init?.body))
                    storedBaselines.push(body.summary)
                    return new Response(JSON.stringify({
                        summary: body.summary,
                    }))
                }
                return new Response(JSON.stringify({
                        snapshot: { schemaVersion: 1, sources: [] },
                        baseline: null,
                }))
            }) as unknown as typeof fetch,
            createAuth: async () => 'test-jwt',
            onError,
        })
        const prepareWithDeadline = analysis.prepareContext as (
            characterId: string,
            chatId: string,
            snapshot: { schemaVersion: 1, sources: [] },
            deadlineMs: number,
            operationDeadlineMs: number
        ) => Promise<unknown>

        await expect(prepareWithDeadline(
            'character',
            'chat',
            { schemaVersion: 1, sources: [] },
            5,
            10
        )).resolves.toBeNull()
        await new Promise((resolve) => setTimeout(resolve, 15))
        await expect(prepareWithDeadline(
            'character',
            'chat',
            { schemaVersion: 1, sources: [] },
            50,
            20
        )).resolves.toEqual({
            baseline: 'Recovered baseline',
            sourceChanged: false,
        })
        expect(modelCalls).toBe(2)
        expect(onError).toHaveBeenCalledWith(expect.objectContaining({
            message: 'Narrative context preparation timed out',
        }))
        resolveFirstModel({
            type: 'success',
            result: 'Late stale baseline',
        })
        await new Promise((resolve) => setTimeout(resolve, 5))
        expect(storedBaselines).toEqual(['Recovered baseline'])
    })

    test('does not share preparation results across changed snapshots', async () => {
        const snapshotA = {
            schemaVersion: 1 as const,
            sources: [{
                sourceId: 'description',
                kind: 'character-description' as const,
                content: 'Version A',
                fingerprint: 'a',
            }],
        }
        const snapshotB = {
            ...snapshotA,
            sources: [{
                ...snapshotA.sources[0],
                content: 'Version B',
                fingerprint: 'b',
            }],
        }
        const analysis = createStoredResponseMemoryAnalysis({
            requestModel: vi.fn(),
            fetchImpl: vi.fn(async (_input, init) => {
                const body = JSON.parse(String(init?.body))
                const isA = body.snapshot.sources[0].fingerprint === 'a'
                if (isA) {
                    await new Promise((resolve) => setTimeout(resolve, 20))
                }
                return new Response(JSON.stringify({
                    snapshot: body.snapshot,
                    baseline: isA ? 'Baseline A' : 'Baseline B',
                }))
            }) as unknown as typeof fetch,
            createAuth: async () => 'test-jwt',
            onError: vi.fn(),
        })

        await expect(analysis.prepareContext(
            'character',
            'chat',
            snapshotA,
            5,
            100
        )).resolves.toBeNull()
        await expect(analysis.prepareContext(
            'character',
            'chat',
            snapshotB,
            50,
            100
        )).resolves.toEqual({
            baseline: 'Baseline B',
            sourceChanged: false,
        })
    })

    test('sends native confirmation as a schema-bound memory draft', async () => {
        const calls: string[] = []
        const onError = vi.fn()
        let submittedSchema = ''
        const requestModel = vi.fn(
            async (request: MemoryAnalysisModelCall) => {
                if (request.schema) submittedSchema = request.schema
                return {
                    type: 'success' as const,
                    result: JSON.stringify({
                        schemaVersion: 1,
                        title: '작은 변화',
                        establishedEvents: [],
                        stateChanges: [],
                        characterKnowledge: [],
                        persistentFacts: ['지속되는 작은 변화가 있다.'],
                        openContinuity: [],
                        canonicalUpdateCandidates: [],
                    }),
                }
            }
        )
        const analysis = createStoredResponseMemoryAnalysis({
            requestModel,
            fetchImpl: vi.fn(async (input) => {
                const url = String(input)
                calls.push(url)
                if (url.endsWith('/inquiry')) {
                    return new Response(JSON.stringify({
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
                    }))
                }
                if (url.endsWith('/view')) {
                    return new Response(JSON.stringify({
                        mode: 'markdown',
                        wikiPath: 'C:\\wiki',
                        health: {
                            danglingLinks: [],
                            unlinkedDocumentIds: [],
                        },
                        documents: [],
                    }))
                }
                return new Response(JSON.stringify({
                    facts: [],
                    events: [],
                    appliedOperationIds: [],
                }))
            }),
            createAuth: async () => 'test-jwt',
            onError,
            nativeV2Analysis: true,
        })

        await expect(analysis.run({
            characterId: 'character',
            chatId: 'chat',
            messages: [{
                messageId: 'message-1',
                role: 'assistant',
                content: 'Nothing changed.',
            }],
        })).resolves.toMatchObject({
            facts: [],
            events: [],
            canonicalReceipt: {
                sourceMessageIds: ['message-1'],
                eventIds: [],
                changes: [],
                warnings: [],
            },
        })
        expect(calls).toEqual([
            '/api/risubard/memory/view',
            '/api/risubard/memory/inquiry',
            '/api/risubard/memory/wiki/save',
        ])
        expect(JSON.parse(submittedSchema)).toMatchObject({
            type: 'object',
            additionalProperties: false,
            required: expect.arrayContaining([
                'establishedEvents',
                'stateChanges',
                'characterKnowledge',
            ]),
        })
        expect(onError).not.toHaveBeenCalled()
    })

    test.each([
        { result: '분석 결과를 만들지 못했습니다.' },
        { result: JSON.stringify({ schemaVersion: 1, title: '변화 없음', establishedEvents: [], stateChanges: [], characterKnowledge: [], persistentFacts: [], openContinuity: [], canonicalUpdateCandidates: [] }), finishReason: 'length' },
        { result: '<think>unfinished reasoning', finishReason: 'stop' },
        { result: 'not JSON', repeat: true, expectedAttempts: 3 },
        { result: '', finishReason: 'SAFETY', expectedAttempts: 1 },
        { result: 'not JSON', noRetry: true, expectedAttempts: 1 },
        { result: 'not JSON', toolExecuted: true, expectedAttempts: 1 },
    ])('bounds structured-output recovery without replaying writes: %j', async (firstResponse) => {
        const requestModel = vi.fn(async (
            request: MemoryAnalysisModelCall
        ) => ({
            type: 'success' as const,
            noRetry: firstResponse.noRetry,
            toolExecuted: firstResponse.toolExecuted,
            finishReason: requestModel.mock.calls.length === 1 ? firstResponse.finishReason : 'stop',
            result: requestModel.mock.calls.length === 1 || firstResponse.repeat
                ? firstResponse.result
                : JSON.stringify({
                    schemaVersion: 1,
                    title: '변화 없음',
                    establishedEvents: [],
                    stateChanges: [],
                    characterKnowledge: [],
                    persistentFacts: [],
                    openContinuity: [],
                    canonicalUpdateCandidates: [],
                }),
        }))
        const analysis = createStoredResponseMemoryAnalysis({
            requestModel,
            fetchImpl: vi.fn(async (input) => {
                const url = String(input)
                if (url.endsWith('/view')) {
                    return new Response(JSON.stringify({
                        mode: 'markdown',
                        wikiPath: 'C:\\wiki',
                        health: {
                            danglingLinks: [],
                            unlinkedDocumentIds: [],
                        },
                        documents: [],
                    }))
                }
                if (url.endsWith('/inquiry')) {
                    return new Response(JSON.stringify({
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
                    }))
                }
                throw new Error(`Unexpected request: ${url}`)
            }),
            createAuth: async () => 'test-jwt',
            onError: vi.fn(),
            nativeV2Analysis: true,
        })

        const operation = analysis.run({
            characterId: 'character',
            chatId: 'chat',
            messages: [{
                messageId: 'message-1',
                role: 'assistant',
                content: '아무 변화도 없었다.',
            }],
        })
        if (firstResponse.expectedAttempts) await expect(operation).rejects.toThrow()
        else await expect(operation).resolves.toMatchObject({ facts: [], events: [] })
        expect(requestModel).toHaveBeenCalledTimes(firstResponse.expectedAttempts ?? 2)
        for (const [request] of requestModel.mock.calls) expect(request.extractJson).toBe('')
        if (requestModel.mock.calls.length > 1) {
            expect(requestModel.mock.calls[1][0].formated[0].content).toContain('previous response')
        }
    })

    test('does not retry after a prompt-schema fallback returns invalid output', async () => {
        const requestModel = vi.fn(async (request: MemoryAnalysisModelCall) =>
            request.schema
                ? { type: 'fail' as const, result: 'HTTP 400' }
                : { type: 'success' as const, result: 'not JSON' }
        )
        const analysis = createStoredResponseMemoryAnalysis({
            requestModel,
            fetchImpl: vi.fn(async (input) => {
                const url = String(input)
                if (url.endsWith('/view')) {
                    return new Response(JSON.stringify({
                        mode: 'markdown', wikiPath: 'wiki', documents: [],
                        health: { danglingLinks: [], unlinkedDocumentIds: [] },
                    }))
                }
                if (url.endsWith('/inquiry')) {
                    return new Response(JSON.stringify({
                        mode: 'v2-current', graphRevision: 0, indexRevision: 0,
                        cacheStatus: 'current', sources: [], metrics: {
                            candidateCount: 0, inspectedNodeCount: 0,
                            inspectedEdgeCount: 0, selectedNodeCount: 0,
                            selectedTokens: 0, hopCount: 0,
                            auxiliaryModelCalls: 0,
                        },
                    }))
                }
                throw new Error(`Unexpected request: ${url}`)
            }) as unknown as typeof fetch,
            createAuth: async () => 'test-jwt',
            onError: vi.fn(),
            nativeV2Analysis: true,
        })

        await expect(analysis.run({
            characterId: 'character', chatId: 'chat',
            messages: [{
                messageId: 'assistant-1', role: 'assistant',
                content: '아무 변화도 없었다.',
            }],
        })).rejects.toThrow('응답 형식')
        expect(requestModel).toHaveBeenCalledTimes(2)
        expect(requestModel.mock.calls[0][0].schema).toBeTruthy()
        expect(requestModel.mock.calls[1][0].schema).toBeUndefined()
    })

    test('falls back to prompt schema after corrected native output still fails validation', async () => {
        const validDraft = JSON.stringify({
            title: '변화 없음',
            establishedEvents: [],
            stateChanges: [],
            characterKnowledge: [],
            persistentFacts: [],
            openContinuity: [],
            canonicalUpdateCandidates: [],
        })
        const requestModel = vi.fn(async (request: MemoryAnalysisModelCall) => ({
            type: 'success' as const,
            result: request.schema ? '{"title":"incomplete"}' : validDraft,
        }))
        const analysis = createStoredResponseMemoryAnalysis({
            requestModel,
            fetchImpl: vi.fn(async (input) => {
                const url = String(input)
                if (url.endsWith('/view')) {
                    return new Response(JSON.stringify({
                        mode: 'markdown', wikiPath: 'wiki', documents: [],
                        health: { danglingLinks: [], unlinkedDocumentIds: [] },
                    }))
                }
                if (url.endsWith('/inquiry')) {
                    return new Response(JSON.stringify({
                        mode: 'v2-current', graphRevision: 0, indexRevision: 0,
                        cacheStatus: 'current', sources: [], metrics: {
                            candidateCount: 0, inspectedNodeCount: 0,
                            inspectedEdgeCount: 0, selectedNodeCount: 0,
                            selectedTokens: 0, hopCount: 0,
                            auxiliaryModelCalls: 0,
                        },
                    }))
                }
                if (url.endsWith('/wiki/save')) {
                    return new Response(JSON.stringify({
                        document: null, revision: null,
                    }))
                }
                throw new Error(`Unexpected request: ${url}`)
            }) as unknown as typeof fetch,
            createAuth: async () => 'test-jwt',
            onError: vi.fn(),
            nativeV2Analysis: true,
        })

        await expect(analysis.run({
            characterId: 'character', chatId: 'chat',
            messages: [{
                messageId: 'assistant-1', role: 'assistant',
                content: '아무 변화도 없었다.',
            }],
        })).resolves.toMatchObject({ facts: [], events: [] })
        expect(requestModel).toHaveBeenCalledTimes(3)
        expect(requestModel.mock.calls.map(([request]) => Boolean(request.schema)))
            .toEqual([true, true, false])
        expect(requestModel.mock.calls[2][0].formated[0].content)
            .toContain('canonicalUpdateCandidates')
    })

    test('does not prepare or store a v1 snapshot for native v2 analysis', async () => {
        const fetchImpl = vi.fn()
        const requestModel = vi.fn()
        const analysis = createStoredResponseMemoryAnalysis({
            requestModel,
            fetchImpl: fetchImpl as unknown as typeof fetch,
            createAuth: async () => 'test-jwt',
            onError: vi.fn(),
            nativeV2Analysis: true,
        })

        await expect(analysis.prepareContext(
            'character',
            'chat',
            {
                schemaVersion: 1,
                sources: [{
                    sourceId: 'character-card',
                    kind: 'character-description',
                    content: 'Static character description.',
                    fingerprint: 'fingerprint',
                }],
            }
        )).resolves.toEqual({
            baseline: null,
            sourceChanged: false,
        })
        expect(fetchImpl).not.toHaveBeenCalled()
        expect(requestModel).not.toHaveBeenCalled()
    })

    test('projects only the latest twelve stable user and assistant messages', () => {
        const messages = Array.from({ length: 14 }, (_, index) => ({
            role: index % 2 === 0 ? 'user' : 'char',
            data: `message-${index}`,
            chatId: `id-${index}`,
        }))

        expect(projectRecentMemoryMessages(messages)).toEqual(
            Array.from({ length: 12 }, (_, index) => {
                const sourceIndex = index + 2
                return {
                    messageId: `id-${sourceIndex}`,
                    role: sourceIndex % 2 === 0 ? 'user' : 'assistant',
                    content: `message-${sourceIndex}`,
                }
            })
        )
    })

    test('projects configured windows beyond one hundred without truncating message text', () => {
        const messages = Array.from({ length: 151 }, (_, index) => ({
            role: 'char', chatId: `id-${index}`, data: `message-${index}`,
        }))
        messages[149].data = '원문 '.repeat(45_000)
        const projected = projectRecentMemoryMessages(messages, 150, 'id-149')
        expect(projected).toHaveLength(150)
        expect(projected.at(-1)?.content).toBe(messages[149].data)
        expect(projected.some((message) => message.messageId === 'id-150')).toBe(false)
    })

    test('projects the configured recent raw context only through the confirmed message', () => {
        const messages = [
            { role: 'user', data: 'old', chatId: 'user-0' },
            { role: 'char', data: 'old reply', chatId: 'assistant-0' },
            { role: 'user', data: 'current', chatId: 'user-1' },
            { role: 'char', data: 'confirmed', chatId: 'assistant-1' },
            { role: 'user', data: 'later', chatId: 'user-2' },
        ]

        expect(projectRecentMemoryMessages(
            messages,
            3,
            'assistant-1'
        )).toEqual([
            { messageId: 'assistant-0', role: 'assistant', content: 'old reply' },
            { messageId: 'user-1', role: 'user', content: 'current' },
            { messageId: 'assistant-1', role: 'assistant', content: 'confirmed' },
        ])
    })

    test('keeps the first message through five later stored messages and drops it on the sixth', () => {
        const firstMessage = {
            messageId: 'first-message',
            role: 'assistant' as const,
            content: 'The tournament begins in one month.',
        }
        const messages = Array.from({ length: 6 }, (_, index) => ({
            role: index % 2 === 0 ? 'user' : 'char',
            data: `message-${index}`,
            chatId: `id-${index}`,
        }))

        expect(projectRecentMemoryMessages(
            messages,
            5,
            'id-4',
            firstMessage,
        )).toEqual([
            firstMessage,
            ...Array.from({ length: 5 }, (_, index) => ({
                messageId: `id-${index}`,
                role: index % 2 === 0 ? 'user' : 'assistant',
                content: `message-${index}`,
            })),
        ])
        expect(projectRecentMemoryMessages(
            messages,
            5,
            'id-5',
            firstMessage,
        )).toEqual(Array.from({ length: 5 }, (_, index) => {
            const sourceIndex = index + 1
            return {
                messageId: `id-${sourceIndex}`,
                role: sourceIndex % 2 === 0 ? 'user' : 'assistant',
                content: `message-${sourceIndex}`,
            }
        }))
    })

    test('uses the first message as analysis evidence only while it remains in the recent window', async () => {
        const module = await import('./memoryAnalysisClient')
        const project = (
            module as unknown as {
                projectMemoryAnalysisEvidence?: (
                    confirmed: Array<{
                        messageId: string
                        role: 'user' | 'assistant'
                        content: string
                    }>,
                    recent: Array<{
                        messageId: string
                        role: 'user' | 'assistant'
                        content: string
                    }>,
                    firstMessage: {
                        messageId: string
                        role: 'assistant'
                        content: string
                    },
                ) => Array<{
                    messageId: string
                    role: 'user' | 'assistant'
                    content: string
                }>
            }
        ).projectMemoryAnalysisEvidence
        const firstMessage = {
            messageId: 'first-message',
            role: 'assistant' as const,
            content: 'The tournament begins in one month.',
        }
        const confirmed = [
            { messageId: 'user-1', role: 'user' as const, content: 'When?' },
            { messageId: 'assistant-1', role: 'assistant' as const, content: 'Soon.' },
        ]

        expect(project?.(confirmed, [firstMessage, ...confirmed], firstMessage))
            .toEqual([firstMessage, ...confirmed])
        expect(project?.(confirmed, confirmed, firstMessage)).toEqual(confirmed)
    })

    test('uses the existing memory model slot and authenticated server storage', async () => {
        let submittedModelCall: MemoryAnalysisModelCall | undefined
        const requestModel = vi.fn(async (
            request: MemoryAnalysisModelCall
        ) => {
            submittedModelCall = request
            return {
            type: 'success' as const,
            result: JSON.stringify({
                schemaVersion: 1,
                operations: [],
            }),
            }
        })
        const fetchImpl = vi.fn(async (
            input: RequestInfo | URL,
            init?: RequestInit
        ) => {
            if (String(input).endsWith('/state')) {
                return new Response(JSON.stringify({
                    schemaVersion: 1,
                    facts: [],
                    events: [],
                    appliedOperationIds: [],
                }), {
                    status: 200,
                    headers: { 'content-type': 'application/json' },
                })
            }
            expect(JSON.parse(String(init?.body))).toMatchObject({
                characterId: 'character',
                chatId: 'chat',
                delta: { schemaVersion: 1, operations: [] },
            })
            return new Response(JSON.stringify({
                schemaVersion: 1,
                facts: [],
                events: [],
                appliedOperationIds: [],
            }), {
                status: 200,
                headers: { 'content-type': 'application/json' },
            })
        })
        const analysis = createStoredResponseMemoryAnalysis({
            requestModel,
            fetchImpl,
            createAuth: async () => 'test-jwt',
            onError: vi.fn(),
        })

        await analysis.run({
            characterId: 'character',
            chatId: 'chat',
            messages: [{
                messageId: 'message-1',
                role: 'assistant',
                content: 'The door opened.',
            }],
        })

        expect(requestModel).toHaveBeenCalledWith(
            expect.objectContaining({
                formated: [
                    expect.objectContaining({ role: 'system' }),
                    expect.objectContaining({ role: 'user' }),
                ],
                useStreaming: false,
                noMultiGen: true,
                tools: [],
            }),
            'memory'
        )
        expect(submittedModelCall).not.toHaveProperty('blockPlugins')
        expect(JSON.parse(submittedModelCall?.schema ?? '{}')).toMatchObject({
            type: 'object',
            required: ['schemaVersion', 'operations'],
            properties: {
                operations: {
                    type: 'array',
                },
            },
        })
        expect(fetchImpl).toHaveBeenCalledTimes(2)
        for (const call of fetchImpl.mock.calls) {
            expect(call[1]?.headers).toMatchObject({
                'risu-auth': 'test-jwt',
            })
        }
    })

    test('passes an exact one-turn reboot schema to the model provider', async () => {
        const modelCalls: MemoryAnalysisModelCall[] = []
        const requestModel = vi.fn(async (request: MemoryAnalysisModelCall) => {
            modelCalls.push(request)
            return {
                type: 'success' as const,
                result: JSON.stringify({
                    schemaVersion: 1,
                    turns: [{ title: '탈출', establishedEvents: [] }],
                    stateChanges: [],
                    characterKnowledge: [],
                    persistentFacts: [],
                    openContinuity: [],
                    canonicalUpdateCandidates: [],
                }),
            }
        })
        const fetchImpl = vi.fn(async (input, init) => {
            const url = String(input)
            if (url.endsWith('/view')) {
                return new Response(JSON.stringify({
                    mode: 'markdown', wikiPath: 'wiki', documents: [],
                    health: { danglingLinks: [], unlinkedDocumentIds: [] },
                }))
            }
            if (url.endsWith('/inquiry')) {
                return new Response(JSON.stringify({
                    mode: 'v2-current', graphRevision: 0, indexRevision: 0,
                    cacheStatus: 'current', sources: [], metrics: {
                        candidateCount: 0, inspectedNodeCount: 0,
                        inspectedEdgeCount: 0, selectedNodeCount: 0,
                        selectedTokens: 0, hopCount: 0,
                        auxiliaryModelCalls: 0,
                    },
                }))
            }
            if (url.endsWith('/wiki/reboot/begin')) {
                return new Response(JSON.stringify({ canonicalCount: 0 }))
            }
            if (url.endsWith('/wiki/reboot/record')) {
                return new Response(JSON.stringify(
                    JSON.parse(String(init?.body)).receipt
                ))
            }
            throw new Error(`Unexpected request: ${url}`)
        }) as unknown as typeof fetch
        const analysis = createStoredResponseMemoryAnalysis({
            requestModel,
            fetchImpl,
            createAuth: async () => 'test-jwt',
            onError: vi.fn(),
            nativeV2Analysis: true,
        })

        await analysis.confirm({
            characterId: 'character',
            chatId: 'reboot-job',
            messages: [{
                messageId: 'assistant-1',
                role: 'assistant',
                content: '창고를 나섰다.',
            }],
            rebootTurns: [{
                assistantMessageId: 'assistant-1',
                sourceMessageIds: ['assistant-1'],
            }],
        })

        expect(modelCalls).toHaveLength(1)
        const schema = JSON.parse(modelCalls[0].schema ?? '{}')
        expect(schema.properties.turns).toMatchObject({
            minItems: 1,
            maxItems: 1,
        })
        expect(schema.properties.turns.items.properties)
            .not.toHaveProperty('assistantMessageId')
    })

    test('falls back to the main model only when the memory binding is unset', async () => {
        const modes: string[] = []
        const requestModel = vi.fn(async (
            _request: MemoryAnalysisModelCall,
            mode: 'memory' | 'model'
        ): Promise<MemoryAnalysisModelResponse> => {
            modes.push(mode)
            if (mode === 'memory') {
                return {
                    type: 'fail',
                    result: 'The auxiliary model binding is unset.',
                    bindingFailure: 'sub-unset',
                }
            }
            return {
                type: 'success',
                result: JSON.stringify({
                    schemaVersion: 1,
                    operations: [],
                }),
            }
        })
        const analysis = createStoredResponseMemoryAnalysis({
            requestModel,
            fetchImpl: vi.fn(async () => new Response(JSON.stringify({
                schemaVersion: 1,
                facts: [],
                events: [],
                appliedOperationIds: [],
            }))),
            createAuth: async () => 'test-jwt',
            onError: vi.fn(),
        })

        await analysis.run({
            characterId: 'character',
            chatId: 'chat',
            messages: [{
                messageId: 'message-1',
                role: 'assistant',
                content: 'The first turn establishes a durable fact.',
            }],
        })

        expect(modes).toEqual(['memory', 'model'])
    })

    test('uses the main model directly when RisuBard is configured for it', async () => {
        const modes: string[] = []
        const analysis = createStoredResponseMemoryAnalysis({
            requestModel: async (_request, mode) => {
                modes.push(mode)
                return {
                    type: 'success',
                    result: JSON.stringify({
                        schemaVersion: 1,
                        operations: [],
                    }),
                }
            },
            getModelMode: () => 'model',
            fetchImpl: vi.fn(async () => new Response(JSON.stringify({
                schemaVersion: 1,
                facts: [],
                events: [],
                appliedOperationIds: [],
            }))),
            createAuth: async () => 'test-jwt',
            onError: vi.fn(),
        })

        await analysis.run({
            characterId: 'character',
            chatId: 'chat',
            messages: [{
                messageId: 'message-1',
                role: 'assistant',
                content: 'A durable fact.',
            }],
        })

        expect(modes).toEqual(['model'])
    })

    test('does not retry provider failures and preserves their reason', async () => {
        const requestModel = vi.fn(async () => ({
            type: 'fail',
            result: 'Provider rejected the request.',
        }))
        const analysis = createStoredResponseMemoryAnalysis({
            requestModel,
            fetchImpl: vi.fn(async () => new Response(JSON.stringify({
                schemaVersion: 1,
                facts: [],
                events: [],
                appliedOperationIds: [],
            }))),
            createAuth: async () => 'test-jwt',
            onError: vi.fn(),
        })

        await expect(analysis.run({
            characterId: 'character',
            chatId: 'chat',
            messages: [{
                messageId: 'message-1',
                role: 'assistant',
                content: 'The first turn.',
            }],
        })).rejects.toThrow(
            'Memory analysis model request failed: Provider rejected the request.'
        )
        expect(requestModel).toHaveBeenCalledOnce()
        expect(requestModel).toHaveBeenCalledWith(
            expect.objectContaining({
                realChatId: 'chat',
                logSource: 'memory',
                logPurpose: 'bardwiki-analysis',
            }),
            expect.any(String),
        )
    })

    test('submits a projected graph delta after the v1 write', async () => {
        const calls: Array<{ url: string; body: unknown }> = []
        const analysis = createStoredResponseMemoryAnalysis({
            requestModel: vi.fn(async () => ({
                type: 'success',
                result: JSON.stringify({
                    schemaVersion: 1,
                    operations: [{
                        type: 'add-fact',
                        operationId: 'operation-door',
                        factId: 'door-state',
                        text: 'The door is open.',
                        evidence: [{
                            chatId: 'chat',
                            messageId: 'message-1',
                        }],
                    }],
                }),
            })),
            fetchImpl: vi.fn(async (input, init) => {
                const url = String(input)
                calls.push({
                    url,
                    body: JSON.parse(String(init?.body)),
                })
                if (url.endsWith('/state')) {
                    return new Response(JSON.stringify({
                        facts: [],
                        events: [],
                        appliedOperationIds: [],
                    }), { status: 200 })
                }
                if (url.endsWith('/graph/apply')) {
                    return new Response(JSON.stringify({
                        revision: 1,
                    }), { status: 200 })
                }
                return new Response(JSON.stringify({
                    facts: [{
                        id: 'door-state',
                        text: 'The door is open.',
                        status: 'active',
                        evidence: [{
                            chatId: 'chat',
                            messageId: 'message-1',
                        }],
                    }],
                    events: [],
                    appliedOperationIds: ['operation-door'],
                }), { status: 200 })
            }),
            createAuth: async () => 'test-jwt',
            onError: vi.fn(),
        })

        await analysis.run({
            characterId: 'character',
            chatId: 'chat',
            messages: [{
                messageId: 'message-1',
                role: 'assistant',
                content: 'The door is open.',
            }],
        })

        expect(calls.map((call) => call.url)).toEqual([
            '/api/risubard/memory/state',
            '/api/risubard/memory/apply',
            '/api/risubard/memory/graph/apply',
        ])
        expect(calls[2].body).toMatchObject({
            characterId: 'character',
            chatId: 'chat',
            delta: {
                schemaVersion: 2,
                storyId: 'character',
                branchId: 'chat',
                operations: [{
                    type: 'add-node',
                    operationId: 'operation-door',
                    node: {
                        id: 'claim:v1:door-state',
                        evidence: [{
                            chatId: 'chat',
                            messageId: 'message-1',
                        }],
                    },
                }],
            },
        })
    })

    test('requests background reconciliation after graph apply failure', async () => {
        const calls: string[] = []
        const onError = vi.fn()
        const analysis = createStoredResponseMemoryAnalysis({
            requestModel: vi.fn(async () => ({
                type: 'success',
                result: JSON.stringify({
                    schemaVersion: 1,
                    operations: [{
                        type: 'add-fact',
                        operationId: 'operation-door',
                        factId: 'door-state',
                        text: 'The door is open.',
                        evidence: [{
                            chatId: 'chat',
                            messageId: 'message-1',
                        }],
                    }],
                }),
            })),
            fetchImpl: vi.fn(async (input) => {
                const url = String(input)
                calls.push(url)
                if (url.endsWith('/state')) {
                    return new Response(JSON.stringify({
                        facts: [],
                        events: [],
                        appliedOperationIds: [],
                    }), { status: 200 })
                }
                if (url.endsWith('/graph/apply')) {
                    return new Response('graph rejected', { status: 500 })
                }
                if (url.endsWith('/graph/reconcile')) {
                    return new Response(JSON.stringify({
                        revision: 1,
                    }), { status: 200 })
                }
                return new Response(JSON.stringify({
                    facts: [{
                        id: 'door-state',
                        text: 'The door is open.',
                        status: 'active',
                        evidence: [{
                            chatId: 'chat',
                            messageId: 'message-1',
                        }],
                    }],
                    events: [],
                    appliedOperationIds: ['operation-door'],
                }), { status: 200 })
            }),
            createAuth: async () => 'test-jwt',
            onError,
        })

        await expect(analysis.run({
            characterId: 'character',
            chatId: 'chat',
            messages: [{
                messageId: 'message-1',
                role: 'assistant',
                content: 'The door is open.',
            }],
        })).resolves.toMatchObject({
            facts: [{ id: 'door-state' }],
        })
        expect(calls).toEqual([
            '/api/risubard/memory/state',
            '/api/risubard/memory/apply',
            '/api/risubard/memory/graph/apply',
            '/api/risubard/memory/graph/reconcile',
        ])
        expect(onError).toHaveBeenCalledWith(
            expect.objectContaining({
                message: 'RisuBard memory API failed with status 500',
            })
        )
    })

    test('schedule snapshots input and reports failures without rejecting chat', async () => {
        let rejectModel!: (error: unknown) => void
        let submittedPrompt = ''
        const requestModel = vi.fn((
            request: MemoryAnalysisModelCall
        ): Promise<MemoryAnalysisModelResponse> => {
            submittedPrompt = request.formated[1].content
            return new Promise((_, reject) => {
                rejectModel = reject
            })
        })
        const onError = vi.fn()
        const analysis = createStoredResponseMemoryAnalysis({
            requestModel,
            fetchImpl: vi.fn(async () => new Response(JSON.stringify({
                schemaVersion: 1,
                facts: [],
                events: [],
                appliedOperationIds: [],
            }), { status: 200 })),
            createAuth: async () => 'test-jwt',
            onError,
        })
        const input = {
            characterId: 'character',
            chatId: 'chat',
            messages: [{
                messageId: 'message-1',
                role: 'assistant' as const,
                content: 'Original',
            }],
        }

        expect(analysis.schedule(input)).toBeUndefined()
        input.messages[0].content = 'Mutated'
        await vi.waitFor(() => expect(requestModel).toHaveBeenCalled())
        rejectModel(new Error('provider failed'))
        await vi.waitFor(() => expect(onError).toHaveBeenCalledOnce())
        expect(submittedPrompt).toContain('Original')
        expect(submittedPrompt).not.toContain('Mutated')
    })

    test('announces a completed background write to the matching memory view', async () => {
        const updates = vi.fn()
        window.addEventListener('risubard-memory-updated', updates)
        const analysis = createStoredResponseMemoryAnalysis({
            requestModel: vi.fn(async (request) => ({
                type: 'success',
                result: request.schema?.includes('establishedEvents')
                    ? JSON.stringify({
                        schemaVersion: 1,
                        title: '첫 턴',
                        establishedEvents: ['첫 턴이 확정되었다.'],
                        stateChanges: [],
                        characterKnowledge: [],
                        persistentFacts: [],
                        openContinuity: [],
                        canonicalUpdateCandidates: [],
                    })
                    : 'NONE',
            })),
            fetchImpl: vi.fn(async (input) => {
                if (String(input).endsWith('/inquiry')) {
                    return new Response(JSON.stringify({
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
                    }))
                }
                return new Response(JSON.stringify({ ok: true }))
            }),
            createAuth: async () => 'test-jwt',
            onError: vi.fn(),
            nativeV2Analysis: true,
        })

        analysis.schedule({
            characterId: 'character',
            chatId: 'chat',
            messages: [{
                messageId: 'message-1',
                role: 'assistant',
                content: 'The first turn.',
            }],
        })

        await vi.waitFor(() => expect(updates).toHaveBeenCalledOnce())
        expect((updates.mock.calls[0][0] as CustomEvent).detail).toEqual({
            characterId: 'character',
            chatId: 'chat',
        })
        window.removeEventListener('risubard-memory-updated', updates)
    })

    test('awaits an explicit confirmation and announces its completed write', async () => {
        const updates = vi.fn()
        window.addEventListener('risubard-memory-updated', updates)
        const requestModel = vi.fn(async (request: MemoryAnalysisModelCall) => ({
            type: 'success',
            result: request.schema?.includes('establishedEvents')
                ? JSON.stringify({
                    schemaVersion: 1,
                    title: '확정된 턴',
                    establishedEvents: ['턴이 확정되었다.'],
                    stateChanges: [],
                    characterKnowledge: [],
                    persistentFacts: [],
                    openContinuity: [],
                    canonicalUpdateCandidates: [],
                })
                : 'NONE',
        }))
        const analysis = createStoredResponseMemoryAnalysis({
            requestModel,
            fetchImpl: vi.fn(async (input) => {
                if (String(input).endsWith('/inquiry')) {
                    return new Response(JSON.stringify({
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
                    }))
                }
                return new Response(JSON.stringify({ ok: true }))
            }),
            createAuth: async () => 'test-jwt',
            onError: vi.fn(),
            nativeV2Analysis: true,
        })
        const confirm = (
            analysis as unknown as {
                confirm?: (input: {
                    characterId: string
                    chatId: string
                    messages: Array<{
                        messageId: string
                        role: 'assistant'
                        content: string
                    }>
                }, signal?: AbortSignal) => Promise<void>
            }
        ).confirm

        expect(confirm).toBeTypeOf('function')
        const controller = new AbortController()
        await confirm?.({
            characterId: 'character',
            chatId: 'chat',
            messages: [{
                messageId: 'message-1',
                role: 'assistant',
                content: 'The accepted turn.',
            }],
        }, controller.signal)
        expect((requestModel.mock.calls[0] as unknown[])[2])
            .toBe(controller.signal)
        expect(updates).toHaveBeenCalledOnce()
        window.removeEventListener('risubard-memory-updated', updates)
    })

    test('reports the configured analysis token limit in user-readable terms', async () => {
        const onError = vi.fn()
        const requestModel = vi.fn(async (request: MemoryAnalysisModelCall) => ({
            type: 'success' as const,
            result: request.schema?.includes('establishedEvents')
                ? JSON.stringify({
                    schemaVersion: 1,
                    title: '대규모 정본 후보',
                    establishedEvents: ['여러 지속 정보가 확정되었다.'],
                    stateChanges: [], characterKnowledge: [],
                    persistentFacts: [], openContinuity: [],
                    canonicalUpdateCandidates: Array.from(
                        { length: 8 },
                        (_, index) => ({
                            type: 'character', title: `인물 ${index}`,
                            reason: '가'.repeat(500), action: 'create',
                            targetDocumentId: null, confidence: 0.9,
                        })
                    ),
                })
                : JSON.stringify({ schemaVersion: 1, documents: [] }),
        }))
        const analysis = createStoredResponseMemoryAnalysis({
            requestModel,
            fetchImpl: vi.fn(async (input) => {
                const url = String(input)
                if (url.endsWith('/view')) {
                    return new Response(JSON.stringify({
                        mode: 'markdown', wikiPath: 'wiki', documents: [],
                        health: { danglingLinks: [], unlinkedDocumentIds: [] },
                    }))
                }
                if (url.endsWith('/inquiry')) {
                    return new Response(JSON.stringify({
                        mode: 'v2-current', graphRevision: 0, indexRevision: 0,
                        cacheStatus: 'current', sources: [],
                        metrics: {
                            candidateCount: 0, inspectedNodeCount: 0,
                            inspectedEdgeCount: 0, selectedNodeCount: 0,
                            selectedTokens: 0, hopCount: 0,
                            auxiliaryModelCalls: 0,
                        },
                    }))
                }
                return new Response(JSON.stringify({ ok: true }))
            }) as unknown as typeof fetch,
            createAuth: async () => 'test-jwt',
            onError,
            nativeV2Analysis: true,
        })

        await analysis.confirm({
            characterId: 'character', chatId: 'chat',
            messages: [{
                messageId: 'assistant-1', role: 'assistant',
                content: '여러 인물의 지속 정보가 확정되었다.',
            }],
            analysisTokenLimit: 2_048,
        })

        expect(onError).toHaveBeenCalledWith(expect.objectContaining({
            message: expect.stringContaining('AI 분석 토큰 상한'),
        }))
        expect(onError).toHaveBeenCalledOnce()
        expect(requestModel).toHaveBeenCalledOnce()
    })

    test.each([
        { analysisTokenLimit: 12_000, longEvidence: false },
        { analysisTokenLimit: 12_000, longEvidence: true },
        { analysisTokenLimit: 65_536, longEvidence: true },
    ])('fits evidence with $analysisTokenLimit tokens (long: $longEvidence)', async ({ analysisTokenLimit, longEvidence }) => {
        const modelCalls: MemoryAnalysisModelCall[] = []
        const savedTitles: string[] = []
        const requestModel = vi.fn(async (request: MemoryAnalysisModelCall) => {
            modelCalls.push(request)
            if (request.schema?.includes('establishedEvents')) {
                return {
                    type: 'success' as const,
                    result: JSON.stringify({
                        schemaVersion: 1, title: '두 인물',
                        establishedEvents: ['두 인물 정보가 확정되었다.'],
                        stateChanges: [], characterKnowledge: [],
                        persistentFacts: [], openContinuity: [],
                        canonicalUpdateCandidates: ['사만다', '아만다'].map(
                            (title) => ({
                                type: 'character', title,
                                reason: '향후 서사에 지속되는 직책 정보',
                                action: 'create', targetDocumentId: null,
                                confidence: 0.9,
                            })
                        ),
                    }),
                }
            }
            return {
                type: 'success' as const,
                result: JSON.stringify({
                    schemaVersion: 1,
                    documents: JSON.parse(request.formated[1].content).targets.map(
                        ({ candidateIndex, target }) => ({
                            candidateIndex,
                            sections: [{
                                heading: '현재 상태', operation: 'upsert',
                                content: `- ${target.title}의 지속 정보.`,
                            }],
                        })
                    ),
                }),
            }
        })
        const analysis = createStoredResponseMemoryAnalysis({
            requestModel,
            fetchImpl: vi.fn(async (input, init) => {
                const url = String(input)
                if (url.endsWith('/view')) {
                    return new Response(JSON.stringify({
                        mode: 'markdown', wikiPath: 'wiki', documents: [],
                        health: { danglingLinks: [], unlinkedDocumentIds: [] },
                    }))
                }
                if (url.endsWith('/inquiry')) {
                    return new Response(JSON.stringify({
                        mode: 'v2-current', graphRevision: 0, indexRevision: 0,
                        cacheStatus: 'current', sources: [], metrics: {
                            candidateCount: 0, inspectedNodeCount: 0,
                            inspectedEdgeCount: 0, selectedNodeCount: 0,
                            selectedTokens: 0, hopCount: 0,
                            auxiliaryModelCalls: 0,
                        },
                    }))
                }
                if (url.endsWith('/document/save')) {
                    const body = JSON.parse(String(init?.body))
                    savedTitles.push(body.title)
                    return new Response(JSON.stringify({
                        id: `character.${body.title}`, type: 'character',
                        status: 'active', title: body.title,
                        relativePath: `characters/${body.title}.md`,
                        sourceMessageIds: ['assistant-1'],
                        updated: '2026-08-13T00:00:00.000Z',
                        content: body.markdown, links: [], contextMode: 'auto',
                        contentHash: `hash-${body.title}`,
                        reviewStatus: 'reviewed',
                    }))
                }
                return new Response(JSON.stringify({ id: 'event-1' }))
            }) as unknown as typeof fetch,
            createAuth: async () => 'test-jwt',
            onError: vi.fn(), nativeV2Analysis: true,
        })

        await analysis.confirm({
            characterId: 'character', chatId: 'chat',
            messages: [{
                messageId: 'assistant-1', role: 'assistant',
                content: (longEvidence ? '확정된 사건 원문이다. '.repeat(7_000) : '')
                    + '사만다는 생물학자이고 아만다는 감사관이다.',
            }],
            analysisTokenLimit,
        })

        // Long evidence can split the rewrite into one request per target.
        expect(modelCalls).toHaveLength(longEvidence ? 3 : 2)
        expect(modelCalls[1].schema).toContain('candidateIndex')
        expect(modelCalls[1].schema).toContain('sections')
        expect(modelCalls[1].schema).not.toContain('markdown')
        for (const call of modelCalls.filter((item) =>
            item.logPurpose === 'bardwiki-canonical-update'
        )) {
            const targetCount = JSON.parse(call.formated[1].content)
                .targets.length
            const schema = JSON.parse(call.schema ?? '{}')
            expect(schema.properties.documents).toMatchObject({
                minItems: targetCount,
                maxItems: targetCount,
            })
            expect(schema.properties.documents.items.properties
                .candidateIndex.maximum).toBe(targetCount - 1)
        }
        expect(modelCalls[0].logPurpose).toBe('bardwiki-analysis')
        expect(modelCalls[1].logPurpose).toBe('bardwiki-canonical-update')
        expect(modelCalls[0].maxTokens).toBe(analysisTokenLimit)
        expect(modelCalls[1].maxTokens).toBe(analysisTokenLimit)
        const tokenizer = get_encoding('cl100k_base')
        try {
            for (const call of modelCalls) {
                expect(tokenizer.encode(call.formated.map((message) => message.content).join('\n')).length)
                    .toBeLessThanOrEqual(analysisTokenLimit)
                if (call.logPurpose === 'bardwiki-canonical-update') {
                    expect(call.maxTokens).toBe(analysisTokenLimit)
                }
            }
        }
        finally { tokenizer.free() }
        expect(modelCalls[1].formated[1].content).toContain('confirmedMessages')
        expect(savedTitles).toEqual(['사만다', '아만다'])
    })

    test('retries a canonical native-schema HTTP 400 with a prompt schema', async () => {
        const modelCalls: MemoryAnalysisModelCall[] = []
        const requestModel = vi.fn(async (request: MemoryAnalysisModelCall) => {
            modelCalls.push(request)
            if (request.logPurpose === 'bardwiki-analysis') {
                return {
                    type: 'success' as const,
                    result: JSON.stringify({
                        schemaVersion: 1,
                        turns: [{
                            title: '인물 등록',
                            establishedEvents: ['사만다가 생물학자로 확인되었다.'],
                        }],
                        stateChanges: [],
                        characterKnowledge: [],
                        persistentFacts: [],
                        openContinuity: [],
                        canonicalUpdateCandidates: [{
                            type: 'character',
                            title: '사만다',
                            reason: '지속되는 역할',
                            action: 'create',
                            targetDocumentId: null,
                            confidence: 0.9,
                        }],
                    }),
                }
            }
            if (request.schema) {
                return { type: 'fail' as const, result: 'HTTP 400' }
            }
            return {
                type: 'success' as const,
                result: JSON.stringify({
                    schemaVersion: 1,
                    documents: [{
                        candidateIndex: 0,
                        sections: [{
                            heading: '현재 상태',
                            operation: 'upsert',
                            content: '- 생물학자.',
                        }],
                    }],
                }),
            }
        })
        const analysis = createStoredResponseMemoryAnalysis({
            requestModel,
            fetchImpl: vi.fn(async (input, init) => {
                const url = String(input)
                if (url.endsWith('/view')) {
                    return new Response(JSON.stringify({
                        mode: 'markdown', wikiPath: 'wiki', documents: [],
                        health: { danglingLinks: [], unlinkedDocumentIds: [] },
                    }))
                }
                if (url.endsWith('/inquiry')) {
                    return new Response(JSON.stringify({
                        mode: 'v2-current', graphRevision: 0, indexRevision: 0,
                        cacheStatus: 'current', sources: [], metrics: {
                            candidateCount: 0, inspectedNodeCount: 0,
                            inspectedEdgeCount: 0, selectedNodeCount: 0,
                            selectedTokens: 0, hopCount: 0,
                            auxiliaryModelCalls: 0,
                        },
                    }))
                }
                if (url.endsWith('/wiki/reboot/begin')) {
                    return new Response(JSON.stringify({ canonicalCount: 0 }))
                }
                if (url.endsWith('/wiki/reboot/record')) {
                    return new Response(JSON.stringify(
                        JSON.parse(String(init?.body)).receipt
                    ))
                }
                if (url.endsWith('/document/save')) {
                    const body = JSON.parse(String(init?.body))
                    return new Response(JSON.stringify({
                        id: 'character.samantha', type: 'character',
                        status: 'active', title: body.title,
                        relativePath: 'characters/samantha.md',
                        sourceMessageIds: ['assistant-1'],
                        updated: '2026-09-02T00:00:00.000Z',
                        content: body.markdown, links: [], contextMode: 'auto',
                        contentHash: 'hash-samantha', reviewStatus: 'reviewed',
                    }))
                }
                return new Response(JSON.stringify({ id: 'event-1' }))
            }) as unknown as typeof fetch,
            createAuth: async () => 'test-jwt',
            onError: vi.fn(),
            nativeV2Analysis: true,
        })

        await expect(analysis.confirm({
            characterId: 'character', chatId: 'chat',
            messages: [{
                messageId: 'assistant-1', role: 'assistant',
                content: '사만다는 생물학자다.',
            }],
            rebootTurns: [{
                assistantMessageId: 'assistant-1',
                sourceMessageIds: ['assistant-1'],
            }],
        })).resolves.toMatchObject({
            changes: [{ documentId: 'character.samantha', action: 'create' }],
        })

        expect(modelCalls).toHaveLength(3)
        expect(modelCalls[1].schema).toContain('candidateIndex')
        expect(modelCalls[2].schema).toBeUndefined()
        expect(modelCalls[2].formated[0].content)
            .toContain('Return exactly one JSON value matching this JSON Schema.')
        expect(modelCalls[2].formated[0].content).toContain('"documents"')
    })

    test('allows background wiki inquiry to outlive the synchronous chat deadline', async () => {
        const requestModel = vi.fn(async (request) => ({
            type: 'success' as const,
            result: request.schema?.includes('establishedEvents')
                ? JSON.stringify({
                    schemaVersion: 1,
                    title: '느린 조회 뒤 확정된 턴',
                    establishedEvents: ['느린 위키 조회 뒤에도 사건이 확정되었다.'],
                    stateChanges: [],
                    characterKnowledge: [],
                    persistentFacts: [],
                    openContinuity: [],
                    canonicalUpdateCandidates: [],
                })
                : 'NONE',
        }))
        const analysis = createStoredResponseMemoryAnalysis({
            requestModel,
            fetchImpl: vi.fn(async (input) => {
                if (String(input).endsWith('/inquiry')) {
                    await new Promise((resolve) => setTimeout(resolve, 200))
                    return new Response(JSON.stringify({
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
                    }))
                }
                return new Response(JSON.stringify({ ok: true }))
            }),
            createAuth: async () => 'test-jwt',
            onError: vi.fn(),
            nativeV2Analysis: true,
        })

        await expect(analysis.confirm({
            characterId: 'character',
            chatId: 'chat',
            messages: [{
                messageId: 'message-1',
                role: 'assistant',
                content: 'The accepted turn.',
            }],
        })).resolves.toMatchObject({
            sourceMessageIds: ['message-1'],
            changes: [],
        })
        expect(requestModel).toHaveBeenCalledOnce()
    })

    test('does not call the model when no stable message IDs are available', () => {
        const requestModel = vi.fn()
        const analysis = createStoredResponseMemoryAnalysis({
            requestModel,
            fetchImpl: vi.fn(),
            createAuth: async () => 'test-jwt',
            onError: vi.fn(),
        })

        analysis.schedule({
            characterId: 'character',
            chatId: 'chat',
            messages: projectRecentMemoryMessages([
                { role: 'char', data: 'No ID' },
            ]),
        })

        expect(requestModel).not.toHaveBeenCalled()
    })

    test('prepares source context without returning the full v1 state', async () => {
        const calls: string[] = []
        const analysis = createStoredResponseMemoryAnalysis({
            requestModel: vi.fn(),
            fetchImpl: vi.fn(async (input, init) => {
                calls.push(String(input))
                const body = JSON.parse(String(init?.body))
                if (String(input).endsWith('/source')) {
                    return new Response(JSON.stringify({
                        snapshot: body.snapshot,
                        baseline: 'Baseline',
                    }))
                }
                return new Response(JSON.stringify({
                    facts: [],
                    events: [],
                    appliedOperationIds: [],
                }))
            }),
            createAuth: async () => 'test-jwt',
            onError: vi.fn(),
        })
        const snapshot = {
            schemaVersion: 1 as const,
            sources: [{
                sourceId: 'source',
                kind: 'character-description' as const,
                content: 'Original',
                fingerprint: 'fingerprint',
            }],
        }

        const result = await analysis.prepareContext(
            'character',
            'chat',
            snapshot
        )

        expect(calls).toEqual([
            '/api/risubard/memory/source',
        ])
        expect(result).toEqual({
            baseline: 'Baseline',
            sourceChanged: false,
        })
        expect(snapshot.sources[0].content).toBe('Original')
    })

    test('uses the main model fallback for an initial baseline when the memory binding is unset', async () => {
        const modes: string[] = []
        const analysis = createStoredResponseMemoryAnalysis({
            requestModel: vi.fn(async (
                _request: MemoryAnalysisModelCall,
                mode: 'memory' | 'model'
            ): Promise<MemoryAnalysisModelResponse> => {
                modes.push(mode)
                return mode === 'memory'
                    ? {
                        type: 'fail',
                        result: 'The auxiliary model binding is unset.',
                        bindingFailure: 'sub-unset',
                    }
                    : {
                        type: 'success',
                        result: 'A concise initial state.',
                    }
            }),
            fetchImpl: vi.fn(async (input, init) => {
                const url = String(input)
                if (url.endsWith('/source')) {
                    return new Response(JSON.stringify({
                        snapshot: JSON.parse(String(init?.body)).snapshot,
                        baseline: null,
                    }))
                }
                if (url.endsWith('/baseline')) {
                    return new Response(JSON.stringify({
                        summary: 'A concise initial state.',
                    }))
                }
                return new Response(JSON.stringify({
                    schemaVersion: 1,
                    facts: [],
                    events: [],
                    appliedOperationIds: [],
                }))
            }),
            createAuth: async () => 'test-jwt',
            onError: vi.fn(),
        })

        const result = await analysis.prepareContext(
            'character',
            'chat',
            {
                schemaVersion: 1,
                sources: [{
                    sourceId: 'source',
                    kind: 'character-description',
                    content: 'Source material.',
                    fingerprint: 'fingerprint',
                }],
            }
        )

        expect(modes).toEqual(['memory', 'model'])
        expect(result.baseline).toBe('A concise initial state.')
    })
})
