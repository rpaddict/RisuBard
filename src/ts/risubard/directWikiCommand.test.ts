import { describe, expect, test, vi } from 'vitest'
import type { NarrativeMemoryWikiMarkdown } from './memoryWiki'
import {
    executeDirectWikiCommand,
    type DirectWikiModelCall,
} from './directWikiCommand'

type WikiDocument = NarrativeMemoryWikiMarkdown['documents'][number]

const documents: WikiDocument[] = [{
    id: 'character.existing', type: 'character', status: 'active',
    title: '기존 인물', aliases: ['옛 이름'], relativePath: 'characters/existing.md',
    sourceMessageIds: ['assistant-old'], updated: 'now',
    content: '# 기존 인물\n\n이전 설정.', links: [], contextMode: 'auto',
    contentHash: 'hash-existing',
}, {
    id: 'concept.crawler', type: 'concept', status: 'active',
    title: '크롤러', aliases: [], relativePath: 'concepts/crawler.md',
    sourceMessageIds: ['assistant-old'], updated: 'now',
    content: '# 크롤러', links: [], contextMode: 'auto',
    contentHash: 'hash-crawler',
}, {
    id: 'event.turn', type: 'event', status: 'active',
    title: '기존 사건', aliases: [], relativePath: 'events/turn.md',
    sourceMessageIds: ['assistant-old'], updated: 'now',
    content: '# 기존 사건', links: [], contextMode: 'auto',
    contentHash: 'hash-event',
}]

describe('direct wiki command', () => {
    test.each([32_768, 65_536])(
        'uses the configured analysis limit for a large wiki: %i tokens', async (maxTokens) => {
            const largeWiki = Array.from({ length: 600 }, (_, index) => ({
                ...documents[0],
                id: `character.${index}`, title: `인물 ${index}`, aliases: [],
                content: '## 인물\n\n' + '저장된 정보. '.repeat(8),
            }))
            const requestModel = vi.fn(async (_request: DirectWikiModelCall) => ({
                type: 'success' as const,
                result: JSON.stringify({ schemaVersion: 1, operations: [{
                    action: 'upsert', targetDocumentId: largeWiki[0].id,
                    type: 'character', title: largeWiki[0].title,
                    markdown: '## 인물 0\n\n갱신된 정보.', reason: '갱신',
                }] }),
            }))
            const saveDocument = vi.fn(async () => ({
                id: largeWiki[0].id, title: largeWiki[0].title,
                relativePath: 'characters/0.md',
            }))
            const command = executeDirectWikiCommand({
                instruction: '위키 문서를 점검해.', documents: largeWiki,
                currentMessages: [], maxTokens, requestModel, saveDocument,
                trashDocument: vi.fn(), retractEvent: vi.fn(),
            })
            if (maxTokens === 32_768) {
                await expect(command).rejects.toThrow('AI 분석 토큰 상한')
                expect(requestModel).not.toHaveBeenCalled()
                expect(saveDocument).not.toHaveBeenCalled()
                return
            }
            await expect(command).resolves.toMatchObject({ failed: [] })
            const request = requestModel.mock.calls[0][0]
            expect(request.maxTokens).toBe(maxTokens)
            expect(request.formated[1].content.length).toBeGreaterThan(32_768 * 3)
            expect(JSON.parse(request.formated[1].content).documents).toHaveLength(600)
            expect(saveDocument).toHaveBeenCalledOnce()
        }
    )

    test('captures undo after plan validation and before the first write', async () => {
        const order: string[] = []
        await executeDirectWikiCommand({
            instruction: '갱신해.', documents, currentMessages: [], maxTokens: 12_000,
            requestModel: async () => {
                order.push('model')
                return {
                    type: 'success',
                    result: JSON.stringify({ schemaVersion: 1, operations: [{
                        action: 'upsert', targetDocumentId: 'character.existing',
                        type: 'character', title: '기존 인물',
                        markdown: '## 기존 인물\n\n변경.', reason: '갱신',
                    }] }),
                }
            },
            beforeApply: async () => { order.push('snapshot') },
            saveDocument: vi.fn(async () => {
                order.push('write')
                return { id: 'character.existing', title: '기존 인물', relativePath: 'characters/existing.md' }
            }),
            trashDocument: vi.fn(), retractEvent: vi.fn(),
        })

        expect(order).toEqual(['model', 'snapshot', 'write'])
    })

    test('repairs a truncated plan before applying any operation, at most once', async () => {
        const saveDocument = vi.fn(async () => ({ id: 'character.existing', title: '기존 인물', relativePath: 'characters/existing.md' }))
        const requestModel = vi.fn(async () => {
            expect(saveDocument).not.toHaveBeenCalled()
            return {
                type: 'success', finishReason: requestModel.mock.calls.length === 1 ? 'length' : 'stop',
                result: JSON.stringify({ schemaVersion: 1, operations: [{
                    action: 'upsert', targetDocumentId: 'character.existing', type: 'character',
                    title: '기존 인물', markdown: '## 기존 인물\n\n완전한 문서.', reason: '갱신',
                }] }),
            }
        })
        await executeDirectWikiCommand({ instruction: '갱신해.', documents, currentMessages: [], maxTokens: 12000,
            requestModel, saveDocument, trashDocument: vi.fn(), retractEvent: vi.fn() })
        expect(requestModel).toHaveBeenCalledTimes(2)
        expect(saveDocument).toHaveBeenCalledTimes(1)
    })

    test('falls back to a prompt schema after native structured output is ignored', async () => {
        const requestModel = vi.fn(async (request: DirectWikiModelCall) => {
            if (requestModel.mock.calls.length === 1) {
                expect(request.schema).not.toBe('')
                return { type: 'success', result: '잘 정리했습니다.' }
            }
            expect(request.schema).toBe('')
            expect(request.formated[0].content).toContain(
                'Return exactly one JSON object matching this JSON Schema.'
            )
            expect(request.formated[0].content).toContain(
                '"required":["schemaVersion","operations"]'
            )
            return {
                type: 'success',
                result: JSON.stringify({ schemaVersion: 1, operations: [{
                    action: 'upsert', targetDocumentId: 'character.existing', type: 'character',
                    title: '기존 인물', markdown: '## 기존 인물\n\n완전한 문서.', reason: '갱신',
                }] }),
            }
        })
        const saveDocument = vi.fn(async () => ({
            id: 'character.existing', title: '기존 인물',
            relativePath: 'characters/existing.md',
        }))

        await executeDirectWikiCommand({
            instruction: '갱신해.', documents, currentMessages: [], maxTokens: 12_000,
            requestModel, saveDocument, trashDocument: vi.fn(), retractEvent: vi.fn(),
        })

        expect(requestModel).toHaveBeenCalledTimes(2)
        expect(saveDocument).toHaveBeenCalledTimes(1)
    })

    test('applies an H2 merge result wrapped in provider thinking and JSON fences', async () => {
        const saveDocument = vi.fn(async (input) => ({
            id: input.documentId, title: input.title,
            relativePath: 'characters/existing.md',
        }))
        const trashDocument = vi.fn()
        const operations = [{
            action: 'upsert', targetDocumentId: 'character.existing',
            type: 'character', title: '기존 인물',
            markdown: '## 기존 인물\n\n### 현재 상태\n병합된 설정.',
            reason: '동일 인물 병합',
        }, {
            action: 'trash', targetDocumentId: 'concept.crawler',
            type: null, title: null, markdown: null,
            reason: '병합된 중복 문서 제거',
        }]

        const result = await executeDirectWikiCommand({
            instruction: '동일한 인물은 묶고 중복 문서는 지워줘.',
            documents, currentMessages: [], maxTokens: 12_000,
            requestModel: async () => ({
                type: 'success',
                result: '<think>{"draft":true}</think>\n```json\n'
                    + JSON.stringify({ schemaVersion: 1, operations }) + '\n```',
            }),
            saveDocument, trashDocument, retractEvent: vi.fn(),
        })

        expect(result.failed).toEqual([])
        expect(result.applied.map((operation) => operation.action)).toEqual(['upsert', 'trash'])
        expect(saveDocument).toHaveBeenCalledWith(expect.objectContaining({
            documentId: 'character.existing', expectedContentHash: 'hash-existing',
            markdown: operations[0].markdown,
        }))
        expect(trashDocument).toHaveBeenCalledWith('concept.crawler')
    })

    test('accepts the H2 title requested by the administrator prompt', async () => {
        const result = await executeDirectWikiCommand({
            instruction: '기존 인물을 갱신해.', documents, currentMessages: [], maxTokens: 12_000,
            requestModel: async () => ({
                type: 'success',
                result: JSON.stringify({ schemaVersion: 1, operations: [{
                    action: 'upsert', targetDocumentId: 'character.existing',
                    type: 'character', title: '기존 인물', markdown: '## 기존 인물\n\n갱신.',
                    reason: '요청 반영',
                }] }),
            }),
            saveDocument: async (input) => ({
                id: 'character.existing', title: input.title, relativePath: 'characters/existing.md',
            }),
            trashDocument: vi.fn(), retractEvent: vi.fn(),
        })
        expect(result.applied).toHaveLength(1)
    })

    test.each(['잘 정리했습니다.', '{}\n{}', '{"schemaVersion":1,"operations":['])
    ('keeps all documents unchanged and explains malformed output: %s', async (output) => {
        const saveDocument = vi.fn()
        const trashDocument = vi.fn()
        const retractEvent = vi.fn()
        await expect(executeDirectWikiCommand({
            instruction: '중복 문서를 정리해.', documents, currentMessages: [], maxTokens: 12_000,
            requestModel: async () => ({ type: 'success', result: output }),
            saveDocument, trashDocument, retractEvent,
        })).rejects.toThrow(/JSON.*위키 문서는 변경하지 않았습니다/)
        expect(saveDocument).not.toHaveBeenCalled()
        expect(trashDocument).not.toHaveBeenCalled()
        expect(retractEvent).not.toHaveBeenCalled()
    })

    test('does not inherit the general chat JSON extraction path', async () => {
        let submitted: DirectWikiModelCall | undefined
        await executeDirectWikiCommand({
            instruction: '새 인물을 만들어.',
            documents,
            currentMessages: [],
            maxTokens: 12_000,
            requestModel: async (request) => {
                submitted = structuredClone(request)
                return {
                    type: 'success',
                    result: JSON.stringify({
                        schemaVersion: 1,
                        operations: [{
                            action: 'upsert', targetDocumentId: null,
                            type: 'character', title: '새 인물',
                            markdown: '# 새 인물\n\n설정.',
                            reason: '사용자 직접 지시',
                        }],
                    }),
                }
            },
            saveDocument: vi.fn(async (input) => ({
                id: 'character.new', title: input.title,
                relativePath: 'characters/new.md',
            })),
            trashDocument: vi.fn(),
            retractEvent: vi.fn(),
        })

        expect(submitted).toMatchObject({ extractJson: '' })
    })

    test('injects only explicitly named wiki targets and omits unrequested chat', async () => {
        let submitted: DirectWikiModelCall | undefined
        await executeDirectWikiCommand({
            instruction: '다른 자료는 아무것도 검색하지 말고, 기존 인물 위키 항목에 비밀 정보를 추가해.',
            documents,
            currentMessages: [{
                messageId: 'assistant-1', role: 'assistant',
                content: '주입되면 안 되는 최신 채팅.',
            }],
            maxTokens: 12_000,
            requestModel: async (request) => {
                submitted = structuredClone(request)
                return {
                    type: 'success',
                    result: JSON.stringify({
                        schemaVersion: 1,
                        operations: [{
                            action: 'upsert',
                            targetDocumentId: 'character.existing',
                            type: 'character', title: '기존 인물',
                            markdown: '# 기존 인물\n\n이전 설정. 비밀 정보.',
                            reason: '사용자 직접 지시',
                        }],
                    }),
                }
            },
            saveDocument: vi.fn(async (input) => ({
                id: input.documentId!, title: input.title,
                relativePath: 'characters/existing.md',
            })),
            trashDocument: vi.fn(),
            retractEvent: vi.fn(),
        })

        const payload = submitted?.formated[1].content ?? ''
        const schema = JSON.parse(submitted?.schema ?? '{}')
        expect(schema.properties.schemaVersion).toEqual({ const: 1 })
        expect(payload).toContain('이전 설정.')
        expect(payload).not.toContain('크롤러')
        expect(payload).not.toContain('기존 사건')
        expect(payload).not.toContain('주입되면 안 되는 최신 채팅')
    })

    test('treats the operator instruction as highest content authority', async () => {
        let submitted: DirectWikiModelCall | undefined
        const result = await executeDirectWikiCommand({
            instruction: '채팅에 없는 새 설정도 만들어서 유나를 character로 추가해.',
            documents,
            currentMessages: [{
                messageId: 'assistant-1', role: 'assistant',
                content: '기존 인물만 등장했다.',
            }],
            maxTokens: 12_000,
            requestModel: async (request) => {
                submitted = structuredClone(request)
                return {
                    type: 'success',
                    result: JSON.stringify({
                        schemaVersion: 1,
                        operations: [{
                            action: 'upsert', targetDocumentId: null,
                            type: 'character', title: '유나',
                            markdown: '# 유나\n\n사용자가 직접 지정한 새 설정.',
                            reason: '사용자 직접 지시',
                        }],
                    }),
                }
            },
            saveDocument: vi.fn(async (input) => ({
                id: 'character.yuna', title: input.title,
                relativePath: 'characters/yuna.md',
            })),
            trashDocument: vi.fn(),
            retractEvent: vi.fn(),
        })

        expect(submitted?.formated[0].content).toContain(
            'highest authority for wiki content'
        )
        expect(submitted?.formated[0].content).toContain(
            'not required to be supported by the chat'
        )
        expect(submitted?.formated[1].content).toContain('채팅에 없는 새 설정도')
        expect(result).toMatchObject({
            applied: [{ action: 'upsert', title: '유나' }],
            failed: [],
        })
    })

    test('applies rename, type change, trash, and event retraction without silently stopping', async () => {
        const saveDocument = vi.fn(async (input) => ({
            id: input.documentId ?? 'character.new',
            title: input.title,
            relativePath: `characters/${input.title}.md`,
        }))
        const trashDocument = vi.fn(async () => undefined)
        const retractEvent = vi.fn(async () => undefined)

        const result = await executeDirectWikiCommand({
            instruction: '모두 실행해.', documents, currentMessages: [],
            maxTokens: 12_000,
            requestModel: async () => ({
                type: 'success',
                result: JSON.stringify({
                    schemaVersion: 1,
                    operations: [{
                        action: 'upsert',
                        targetDocumentId: 'concept.crawler',
                        type: 'character', title: '크롤러 개체',
                        markdown: '# 크롤러 개체\n\n인물로 재분류.',
                        reason: '유형 변경',
                    }, {
                        action: 'trash',
                        targetDocumentId: 'character.existing',
                        type: null, title: null, markdown: null,
                        reason: '병합 후 제거',
                    }, {
                        action: 'retract-event',
                        targetDocumentId: 'event.turn',
                        type: null, title: null, markdown: null,
                        reason: '사건 교정',
                    }],
                }),
            }),
            saveDocument,
            trashDocument,
            retractEvent,
        })

        expect(saveDocument).toHaveBeenCalledWith(expect.objectContaining({
            documentId: 'concept.crawler',
            expectedContentHash: 'hash-crawler',
            type: 'character', title: '크롤러 개체',
        }))
        expect(trashDocument).toHaveBeenCalledWith('character.existing')
        expect(retractEvent).toHaveBeenCalledWith(
            'event.turn', 'hash-event'
        )
        expect(result.applied).toHaveLength(3)
        expect(result.failed).toEqual([])
    })

    test('updates an existing event without retracting or recreating it', async () => {
        const saveDocument = vi.fn(async (input) => ({
            id: input.documentId!,
            title: input.title,
            relativePath: 'events/turn.md',
        }))
        const retractEvent = vi.fn()

        const result = await executeDirectWikiCommand({
            instruction: '기존 사건의 승리를 패배로 고쳐.',
            documents,
            currentMessages: [],
            maxTokens: 12_000,
            requestModel: async () => ({
                type: 'success',
                result: JSON.stringify({
                    schemaVersion: 1,
                    operations: [{
                        action: 'upsert',
                        targetDocumentId: 'event.turn',
                        type: 'event',
                        title: '기존 사건',
                        markdown: '## 기존 사건\n\n### 이야기 요약\n\n- 전투에서 패배했다.',
                        reason: '사용자 사건 교정',
                    }],
                }),
            }),
            saveDocument,
            trashDocument: vi.fn(),
            retractEvent,
        })

        expect(saveDocument).toHaveBeenCalledWith(expect.objectContaining({
            documentId: 'event.turn',
            expectedContentHash: 'hash-event',
            type: 'event',
        }))
        expect(retractEvent).not.toHaveBeenCalled()
        expect(result.failed).toEqual([])
    })

    test('rejects an event edit without its exact existing document ID', async () => {
        const saveDocument = vi.fn()
        const result = await executeDirectWikiCommand({
            instruction: '기존 사건을 고쳐.',
            documents,
            currentMessages: [],
            maxTokens: 12_000,
            requestModel: async () => ({
                type: 'success',
                result: JSON.stringify({
                    schemaVersion: 1,
                    operations: [{
                        action: 'upsert',
                        targetDocumentId: null,
                        type: 'event',
                        title: '기존 사건',
                        markdown: '## 기존 사건\n\n### 이야기 요약\n\n- 수정했다.',
                        reason: '사건 수정',
                    }],
                }),
            }),
            saveDocument,
            trashDocument: vi.fn(),
            retractEvent: vi.fn(),
        })

        expect(saveDocument).not.toHaveBeenCalled()
        expect(result.failed[0]?.reason).toContain('정확한 문서 ID')
    })

    test('continues safe operations and reports every failed target', async () => {
        const result = await executeDirectWikiCommand({
            instruction: '두 문서를 갱신해.', documents, currentMessages: [],
            maxTokens: 12_000,
            requestModel: async () => ({
                type: 'success',
                result: JSON.stringify({
                    schemaVersion: 1,
                    operations: ['기존 인물', '새 인물'].map((title, index) => ({
                        action: 'upsert',
                        targetDocumentId: index === 0
                            ? 'character.existing' : null,
                        type: 'character', title,
                        markdown: `# ${title}\n\n변경.`, reason: '직접 지시',
                    })),
                }),
            }),
            saveDocument: vi.fn(async (input) => {
                if (input.documentId) throw new Error('hash conflict')
                return {
                    id: 'character.new', title: input.title,
                    relativePath: 'characters/new.md',
                }
            }),
            trashDocument: vi.fn(), retractEvent: vi.fn(),
        })

        expect(result.applied).toEqual([expect.objectContaining({
            title: '새 인물',
        })])
        expect(result.failed).toEqual([expect.objectContaining({
            title: '기존 인물', reason: 'hash conflict',
        })])
    })

    test('does not report an empty model plan as a successful command', async () => {
        await expect(executeDirectWikiCommand({
            instruction: '반드시 새 문서를 만들어.', documents, currentMessages: [],
            maxTokens: 12_000,
            requestModel: async () => ({
                type: 'success',
                result: JSON.stringify({ schemaVersion: 1, operations: [] }),
            }),
            saveDocument: vi.fn(),
            trashDocument: vi.fn(),
            retractEvent: vi.fn(),
        })).rejects.toThrow('실행할 위키 변경을 반환하지 않았습니다')
    })

    test('treats an invented target ID for a new title as a create', async () => {
        const saveDocument = vi.fn(async (input) => ({
            id: 'character.eugene-generated',
            title: input.title,
            relativePath: 'characters/eugene.md',
        }))
        const result = await executeDirectWikiCommand({
            instruction: '현 메시지의 이유진을 새 character 문서로 만들어.',
            documents,
            currentMessages: [],
            maxTokens: 12_000,
            requestModel: async () => ({
                type: 'success',
                result: JSON.stringify({
                    schemaVersion: 1,
                    operations: [{
                        action: 'upsert',
                        targetDocumentId: 'character.eugene-lee',
                        type: 'character',
                        title: '이유진',
                        markdown: '# 이유진\n\n새 인물.',
                        reason: '이유진 프로필 생성',
                    }],
                }),
            }),
            saveDocument,
            trashDocument: vi.fn(),
            retractEvent: vi.fn(),
        })

        expect(saveDocument).toHaveBeenCalledWith({
            type: 'character',
            title: '이유진',
            markdown: '# 이유진\n\n새 인물.',
        })
        expect(result.failed).toEqual([])
        expect(result.applied).toEqual([expect.objectContaining({
            title: '이유진',
        })])
    })

    test.each(['COMBINE', 'RECONNECT', 'NETWORKING'])(
        'exposes the whole wiki to cross-document %s commands',
        async (command) => {
            let submitted: DirectWikiModelCall | undefined
            await executeDirectWikiCommand({
                instruction: `작업: ${command}\n대상: 기존 인물`,
                documents,
                currentMessages: [],
                maxTokens: 12_000,
                requestModel: async (request) => {
                    submitted = structuredClone(request)
                    return {
                        type: 'success',
                        result: JSON.stringify({
                            schemaVersion: 1,
                            operations: [{
                                action: 'upsert',
                                targetDocumentId: 'character.existing',
                                type: 'character',
                                title: '기존 인물',
                                markdown: '## 기존 인물\n\n변경 없음.',
                                reason: '교차 문서 작업',
                            }],
                        }),
                    }
                },
                saveDocument: vi.fn(async (input) => ({
                    id: input.documentId!, title: input.title,
                    relativePath: 'characters/existing.md',
                })),
                trashDocument: vi.fn(),
                retractEvent: vi.fn(),
            })

            const payload = JSON.parse(
                submitted?.formated[1].content ?? '{}'
            ) as { documents?: Array<{ id: string }> }
            expect(payload.documents?.map((document) => document.id)).toEqual(
                documents.map((document) => document.id)
            )
        }
    )

    test('serializes only explicitly selected BARDCHAT context sources', async () => {
        let submitted: DirectWikiModelCall | undefined
        await executeDirectWikiCommand({
            instruction: '새 인물을 만들어.',
            documents,
            currentMessages: [{
                messageId: 'assistant-1', role: 'assistant', content: 'CHAT',
            }],
            contextSelection: {
                wiki: false,
                chat: false,
                systemPrompt: true,
                characterDescription: false,
                persona: true,
                characterLorebook: false,
                moduleLorebook: false,
            },
            contextSources: {
                systemPrompt: 'SYSTEM',
                characterDescription: 'CHARACTER',
                persona: 'PERSONA',
                characterLorebook: 'CHARACTER LORE',
                moduleLorebook: 'MODULE LORE',
            },
            maxTokens: 12_000,
            requestModel: async (request) => {
                submitted = structuredClone(request)
                return {
                    type: 'success',
                    result: JSON.stringify({
                        schemaVersion: 1,
                        operations: [{
                            action: 'upsert', targetDocumentId: null,
                            type: 'character', title: '새 인물', aliases: null,
                            markdown: '## 새 인물\n\n생성.', reason: '사용자 지시',
                        }],
                    }),
                }
            },
            saveDocument: vi.fn(async (input) => ({
                id: 'character.new', title: input.title,
                relativePath: 'characters/new.md',
            })),
            trashDocument: vi.fn(),
            retractEvent: vi.fn(),
        })

        const payload = JSON.parse(
            submitted?.formated[1].content ?? '{}'
        ) as Record<string, unknown>
        expect(payload.documents).toEqual([])
        expect(payload.currentMessages).toEqual([])
        expect(payload.contexts).toEqual({
            systemPrompt: 'SYSTEM',
            persona: 'PERSONA',
        })
    })

    test('passes COMBINE survivor aliases through the save contract', async () => {
        const saveDocument = vi.fn(async (input) => ({
            id: input.documentId!, title: input.title,
            relativePath: 'characters/existing.md',
        }))
        await executeDirectWikiCommand({
            instruction: '작업: COMBINE\n대상: 기존 인물, 크롤러',
            documents,
            currentMessages: [],
            maxTokens: 12_000,
            requestModel: async () => ({
                type: 'success',
                result: JSON.stringify({
                    schemaVersion: 1,
                    operations: [{
                        action: 'upsert',
                        targetDocumentId: 'character.existing',
                        type: 'character', title: '기존 인물',
                        aliases: ['옛 이름', '크롤러'],
                        markdown: '## 기존 인물\n\n병합했다.',
                        reason: '존속 문서에 별칭 상속',
                    }],
                }),
            }),
            saveDocument,
            trashDocument: vi.fn(),
            retractEvent: vi.fn(),
        })

        expect(saveDocument).toHaveBeenCalledWith(expect.objectContaining({
            documentId: 'character.existing',
            aliases: ['옛 이름', '크롤러'],
        }))
    })

    test('skips destructive cleanup after a prior write failure', async () => {
        const saveDocument = vi.fn(async (input) => {
            if (input.documentId === 'character.existing') {
                throw new Error('hash conflict')
            }
            return {
                id: input.documentId!, title: input.title,
                relativePath: 'concepts/crawler.md',
            }
        })
        const trashDocument = vi.fn()
        const retractEvent = vi.fn()

        const result = await executeDirectWikiCommand({
            instruction: '작업: COMBINE\n대상: 기존 인물, 크롤러',
            documents,
            currentMessages: [],
            maxTokens: 12_000,
            requestModel: async () => ({
                type: 'success',
                result: JSON.stringify({
                    schemaVersion: 1,
                    operations: [{
                        action: 'upsert',
                        targetDocumentId: 'character.existing',
                        type: 'character', title: '기존 인물',
                        markdown: '## 기존 인물\n\n병합.', reason: '존속 문서 갱신',
                    }, {
                        action: 'upsert',
                        targetDocumentId: 'concept.crawler',
                        type: 'concept', title: '크롤러',
                        markdown: '## 크롤러\n\n링크 갱신.', reason: '안전한 후속 갱신',
                    }, {
                        action: 'trash',
                        targetDocumentId: 'concept.crawler',
                        type: null, title: null, markdown: null,
                        reason: '중복 문서 정리',
                    }, {
                        action: 'retract-event',
                        targetDocumentId: 'event.turn',
                        type: null, title: null, markdown: null,
                        reason: '사건 정리',
                    }],
                }),
            }),
            saveDocument,
            trashDocument,
            retractEvent,
        })

        expect(saveDocument).toHaveBeenCalledTimes(2)
        expect(result.applied).toEqual([expect.objectContaining({
            action: 'upsert', documentId: 'concept.crawler',
        })])
        expect(trashDocument).not.toHaveBeenCalled()
        expect(retractEvent).not.toHaveBeenCalled()
        expect(result.failed.filter((item) =>
            item.reason.includes('선행 위키 변경 실패')
        )).toHaveLength(2)
    })
})
