import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
    BARDWIKI_VIRTUAL_MEMORY_MARKER,
    buildBardWikiPluginContext,
    type BardWikiCompatibleCharacter,
    decorateBardWikiCharacterForPlugin,
    decorateBardWikiChatForPlugin,
    getBardWikiPluginDocuments,
    injectBardWikiVirtualMemory,
    saveBardWikiPluginDocument,
    selectBardWikiPluginRecentMessages,
    stripBardWikiVirtualMemory,
    stripBardWikiVirtualMemoryFromDatabase,
} from './pluginBardWiki'
import { NARRATIVE_CONTEXT_OPT_IN_KEY, type NarrativeInquiryResponse } from './narrativeContext'

const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
beforeEach(() => {
    const values = new Map<string, string>()
    Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        value: {
            getItem: (key: string) => values.get(key) ?? null,
            setItem: (key: string, value: string) => { values.set(key, value) },
            removeItem: (key: string) => { values.delete(key) },
        },
    })
})
afterEach(() => {
    if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage)
    else Reflect.deleteProperty(globalThis, 'localStorage')
})

describe('BardWiki legacy plugin compatibility', () => {
    it('projects one identical payload into all legacy memory shapes without mutation', () => {
        const original = {
            message: [],
            hypaV3Data: {
                summaries: [{
                    text: 'real v3 memory',
                    chatMemos: ['m1'],
                    isImportant: false,
                }],
            },
            hypaV2Data: {
                mainChunks: [{ text: 'real v2 memory' }],
            },
            supaMemoryData: 'real supa memory',
        }

        const projected = injectBardWikiVirtualMemory(
            original,
            'BardWiki fact\n\nRecent conversation'
        )

        expect(projected).not.toBe(original)
        expect(projected.hypaV3Data).not.toBe(original.hypaV3Data)
        expect(projected.hypaV2Data).not.toBe(original.hypaV2Data)
        expect(original.hypaV3Data.summaries).toHaveLength(1)
        expect(original.hypaV2Data.mainChunks).toHaveLength(1)
        expect(original.supaMemoryData).toBe('real supa memory')

        const v3 = projected.hypaV3Data.summaries.at(-1) as
            | { text: string; risuBardVirtualMemory?: string }
            | undefined
        const v2 = projected.hypaV2Data.mainChunks.at(-1) as
            | { text: string; risuBardVirtualMemory?: string }
            | undefined
        expect(v3?.risuBardVirtualMemory).toBe(BARDWIKI_VIRTUAL_MEMORY_MARKER)
        expect(v2?.risuBardVirtualMemory).toBe(BARDWIKI_VIRTUAL_MEMORY_MARKER)
        expect(v3?.text).toBe(v2?.text)
        expect(v3?.text).toBe(projected.supaMemoryData)
        expect(v3?.text).toContain('real supa memory')
        expect(v3?.text).toContain('BardWiki fact')
    })

    it('removes only the virtual projection before persistence', () => {
        const original = {
            message: [],
            hypaV3Data: {
                summaries: [{
                    text: 'real v3 memory',
                    chatMemos: [],
                    isImportant: false,
                }],
            },
            hypaV2Data: {
                mainChunks: [{ text: 'real v2 memory' }],
            },
            supaMemoryData: 'real supa memory',
        }
        const projected = injectBardWikiVirtualMemory(original, 'virtual wiki')

        const cleaned = stripBardWikiVirtualMemory(projected)

        expect(cleaned.hypaV3Data.summaries.map((item) => item.text))
            .toEqual(['real v3 memory'])
        expect(cleaned.hypaV2Data.mainChunks.map((item) => item.text))
            .toEqual(['real v2 memory'])
        expect(cleaned.supaMemoryData).toBe('real supa memory')
    })

    it('uses response-window settings and keeps only the latest user message when excluded', () => {
        const messages = [
            { role: 'user', data: 'u1' },
            { role: 'char', data: 'a1' },
            { role: 'user', data: 'u2' },
            { role: 'char', data: 'a2' },
            { role: 'user', data: 'u3' },
            { role: 'char', data: 'a3' },
        ] as const

        const selected = selectBardWikiPluginRecentMessages(messages, 2, true)

        expect(selected.map((message) => message.data))
            .toEqual(['a2', 'u3', 'a3'])
    })

    it('honors disabled messages and the all-before boundary', () => {
        const messages = [
            { role: 'char', data: 'old' },
            { role: 'user', data: 'cut', disabled: 'allBefore' },
            { role: 'char', data: 'hidden', disabled: true },
            { role: 'user', data: 'current' },
            { role: 'char', data: 'answer' },
        ] as const

        const selected = selectBardWikiPluginRecentMessages(messages, 12, false)

        expect(selected.map((message) => message.data))
            .toEqual(['current', 'answer'])
    })
})

describe('BardWiki compatibility context opt-out', () => {
    function fixture() {
        const input = {
            characterId: 'opt-out-character',
            chatId: 'opt-out-chat',
            chat: {
                id: 'opt-out-chat',
                message: [{ role: 'user' as const, data: 'current message' }],
                supaMemoryData: 'existing legacy memory',
            },
            globalSettings: {},
            fetchImpl: fetch,
            createAuth: vi.fn(async () => 'auth'),
        }
        const response: NarrativeInquiryResponse = {
            mode: 'v2-current', graphRevision: 1, indexRevision: 1, cacheStatus: 'current',
            sources: [{ id: 'wiki:opt-out', kind: 'memory', role: 'system', content: 'wiki context', tokens: 2 }],
            evidenceRequests: [], entityCandidates: [],
            metrics: {
                candidateCount: 1, inspectedNodeCount: 1, inspectedEdgeCount: 0,
                selectedNodeCount: 1, selectedTokens: 2, selectedEventTokens: 2,
                hopCount: 0, auxiliaryModelCalls: 0,
            },
        }
        return { input, response, loadInquiry: vi.fn(async () => response) }
    }

    async function withOptIn(value: string | null, action: () => Promise<void>) {
        const previous = localStorage.getItem(NARRATIVE_CONTEXT_OPT_IN_KEY)
        const set = (next: string | null) => next === null
            ? localStorage.removeItem(NARRATIVE_CONTEXT_OPT_IN_KEY)
            : localStorage.setItem(NARRATIVE_CONTEXT_OPT_IN_KEY, next)
        set(value)
        try { await action() }
        finally { set(previous) }
    }

    it('returns original chat and character metadata without inquiry when explicitly disabled', async () => {
        await withOptIn('false', async () => {
            const { input, loadInquiry } = fixture()
            expect(await decorateBardWikiChatForPlugin(input, { loadInquiry })).toBe(input.chat)
            const character = { chaId: input.characterId, chatPage: 0, chats: [input.chat] }
            expect(await decorateBardWikiCharacterForPlugin({
                ...input, character,
            }, { loadInquiry })).toBe(character)
            expect(loadInquiry).not.toHaveBeenCalled()
            expect(input.createAuth).not.toHaveBeenCalled()
            expect(input.chat.supaMemoryData).toBe('existing legacy memory')
        })
    })

    it.each([null, 'true'])('retains compatibility inquiry with opt-in value %s', async (value) => {
        await withOptIn(value, async () => {
            const { input, loadInquiry } = fixture()
            const chat = await decorateBardWikiChatForPlugin(input, { loadInquiry })
            expect(chat).not.toBe(input.chat)
            expect(chat.supaMemoryData).toContain('wiki context')
            expect(loadInquiry).toHaveBeenCalledOnce()
        })
    })

    it('does not project a previously cached result after opt-out', async () => {
        await withOptIn('true', async () => {
            const { input, loadInquiry } = fixture()
            expect((await decorateBardWikiChatForPlugin(input, { loadInquiry })).supaMemoryData)
                .toContain('wiki context')
            localStorage.setItem(NARRATIVE_CONTEXT_OPT_IN_KEY, 'false')
            expect(await decorateBardWikiChatForPlugin(input, { loadInquiry })).toBe(input.chat)
            expect(loadInquiry).toHaveBeenCalledOnce()
        })
    })

    it('continues to honor explicit context requests while compatibility reads are disabled', async () => {
        await withOptIn('false', async () => {
            const { input, loadInquiry } = fixture()
            const context = await buildBardWikiPluginContext(input, { loadInquiry })
            expect(context.content).toContain('wiki context')
            expect(loadInquiry).toHaveBeenCalledOnce()
        })
    })
})

describe('BardWiki plugin service', () => {
    it.each([false, true])('retrieves wiki sources with the effective response window (bot pin: %s)', async (pinned) => {
        let inquiryInput: Record<string, unknown> | undefined
        const result = await buildBardWikiPluginContext({
            characterId: 'char-1',
            chatId: 'chat-1',
            character: pinned ? { risuBardPinnedSettings: {
                risuBardResponseMessageCount: 1,
                risuBardResponseExcludeUserMessages: true,
            } } : undefined,
            chat: {
                message: [
                    { role: 'user', data: 'old question' },
                    { role: 'char', data: 'old answer' },
                    { role: 'user', data: 'current question' },
                    { role: 'char', data: 'current answer' },
                ],
                risuBardSettings: {
                    risuBardResponseMessageCount: pinned ? 12 : 1,
                    risuBardResponseExcludeUserMessages: true,
                },
            },
            globalSettings: {},
            fetchImpl: fetch,
            createAuth: async () => 'auth',
        }, {
            loadInquiry: async (input) => {
                inquiryInput = input as unknown as Record<string, unknown>
                return {
                    mode: 'v2-current',
                    graphRevision: 1,
                    indexRevision: 1,
                    cacheStatus: 'current',
                    sources: [{
                        id: 'wiki:event-1',
                        kind: 'memory',
                        role: 'system',
                        content: 'The gate remains sealed.',
                        tokens: 7,
                        displayName: 'Sealed Gate',
                    }],
                    evidenceRequests: [],
                    entityCandidates: [],
                    metrics: {
                        candidateCount: 1,
                        inspectedNodeCount: 1,
                        inspectedEdgeCount: 0,
                        selectedNodeCount: 1,
                        selectedTokens: 7,
                        selectedEventTokens: 7,
                        hopCount: 0,
                        auxiliaryModelCalls: 0,
                    },
                }
            },
        })

        expect(inquiryInput?.currentInput).toBe('current question')
        expect(result.sources).toHaveLength(1)
        expect(result.recentMessages.map((message) => message.data))
            .toEqual(['current question', 'current answer'])
        expect(result.content).toContain('The gate remains sealed.')
        expect(result.content).toContain('current question')
        expect(result.content).toContain('current answer')
        expect(result.content).not.toContain('old question')
    })

    it('still returns the configured recent window when no wiki document matches', async () => {
        const result = await buildBardWikiPluginContext({
            characterId: 'char-1',
            chatId: 'chat-1',
            chat: {
                message: [{ role: 'user', data: 'unmatched question' }],
            },
            globalSettings: {},
            fetchImpl: fetch,
            createAuth: async () => 'auth',
        }, {
            loadInquiry: async () => ({
                mode: 'v2-current',
                graphRevision: 1,
                indexRevision: 1,
                cacheStatus: 'current',
                sources: [],
                evidenceRequests: [],
                entityCandidates: [],
                metrics: {
                    candidateCount: 0,
                    inspectedNodeCount: 0,
                    inspectedEdgeCount: 0,
                    selectedNodeCount: 0,
                    selectedTokens: 0,
                    selectedEventTokens: 0,
                    hopCount: 0,
                    auxiliaryModelCalls: 0,
                },
            }),
        })

        expect(result.sources).toEqual([])
        expect(result.content).toContain('unmatched question')
    })

    it('lists current-chat documents without exposing the server wiki path', async () => {
        const documents = await getBardWikiPluginDocuments({
            characterId: 'char-1',
            chatId: 'chat-1',
            fetchImpl: fetch,
            createAuth: async () => 'auth',
            types: ['event'],
        }, {
            loadWiki: async () => ({
                mode: 'markdown',
                wikiPath: 'secret/server/path',
                health: { danglingLinks: [], unlinkedDocumentIds: [] },
                documents: [{
                    id: 'event-1',
                    type: 'event',
                    status: 'active',
                    title: 'Event',
                    relativePath: 'events/event-1.md',
                    sourceMessageIds: [],
                    updated: '2026-09-16T00:00:00.000Z',
                    content: '# Event',
                    links: [],
                    contextMode: 'auto',
                    contentHash: 'hash',
                }, {
                    id: 'character-1',
                    type: 'character',
                    status: 'active',
                    title: 'Character',
                    relativePath: 'characters/character-1.md',
                    sourceMessageIds: [],
                    updated: '2026-09-16T00:00:00.000Z',
                    content: '# Character',
                    links: [],
                    contextMode: 'always',
                    contentHash: 'hash-2',
                }],
            }),
        })

        expect(documents.map((document) => document.id)).toEqual(['event-1'])
        expect('wikiPath' in documents).toBe(false)
    })

    it('scopes document writes to the current character and chat', async () => {
        let savedInput: Record<string, unknown> | undefined
        await saveBardWikiPluginDocument({
            characterId: 'char-1',
            chatId: 'chat-1',
            fetchImpl: fetch,
            createAuth: async () => 'auth',
            document: {
                type: 'concept',
                title: 'Magic',
                markdown: '# Magic',
            },
        }, {
            saveDocument: async (input) => {
                savedInput = input as unknown as Record<string, unknown>
                return {
                    id: 'concept-magic',
                    type: 'concept',
                    status: 'active',
                    title: 'Magic',
                    relativePath: 'concepts/magic.md',
                    sourceMessageIds: [],
                    updated: '2026-09-16T00:00:00.000Z',
                    content: '# Magic',
                    links: [],
                    authoring: 'manual',
                    contextMode: 'auto',
                    contentHash: 'hash',
                }
            },
        })

        expect(savedInput).toMatchObject({
            characterId: 'char-1',
            chatId: 'chat-1',
            type: 'concept',
            title: 'Magic',
            markdown: '# Magic',
        })
    })

    it('decorates only the selected chat and fails open when inquiry is unavailable', async () => {
        const character: BardWikiCompatibleCharacter = {
            chaId: 'char-1',
            chatPage: 1,
            chats: [
                { id: 'chat-0', message: [] },
                {
                    id: 'chat-1',
                    message: [{ role: 'user', data: 'current' }],
                },
            ],
        }
        const response = {
            mode: 'v2-current' as const,
            graphRevision: 1,
            indexRevision: 1,
            cacheStatus: 'current' as const,
            sources: [{
                id: 'wiki:1',
                kind: 'memory' as const,
                role: 'system' as const,
                content: 'wiki memory',
                tokens: 3,
            }],
            evidenceRequests: [],
            entityCandidates: [],
            metrics: {
                candidateCount: 1,
                inspectedNodeCount: 1,
                inspectedEdgeCount: 0,
                selectedNodeCount: 1,
                selectedTokens: 3,
                selectedEventTokens: 3,
                hopCount: 0,
                auxiliaryModelCalls: 0,
            },
        }

        const loadInquiry = vi.fn(async () => response)
        const decorated = await decorateBardWikiCharacterForPlugin({
            character,
            globalSettings: {},
            fetchImpl: fetch,
            createAuth: async () => 'auth',
        }, { loadInquiry })

        expect(decorated.chats?.[0].hypaV3Data).toBeUndefined()
        expect(decorated.chats?.[1].hypaV3Data?.summaries.at(-1)?.text)
            .toContain('wiki memory')

        for (let index = 0; index < 30; index++) {
            const polled = await decorateBardWikiCharacterForPlugin({
                character: structuredClone(character),
                globalSettings: {}, fetchImpl: fetch, createAuth: async () => 'auth',
            }, { loadInquiry })
            expect(polled.chats?.[1].hypaV3Data?.summaries.at(-1)?.text).toContain('wiki memory')
        }
        expect(loadInquiry).toHaveBeenCalledTimes(1)
        window.dispatchEvent(new CustomEvent('risubard-memory-updated'))
        await decorateBardWikiCharacterForPlugin({
            character, globalSettings: {}, fetchImpl: fetch, createAuth: async () => 'auth',
        }, { loadInquiry })
        expect(loadInquiry).toHaveBeenCalledTimes(2)

        const failed = await decorateBardWikiCharacterForPlugin({
            character,
            globalSettings: {},
            fetchImpl: fetch,
            createAuth: async () => 'auth',
        }, { loadInquiry: async () => { throw new Error('offline') } })

        expect(failed).toBe(character)
    })

    it('removes virtual projections from every character in a database write', () => {
        const projected = injectBardWikiVirtualMemory({ message: [] }, 'wiki')
        const database = {
            characters: {
                first: { chats: [projected] },
                second: { chats: [projected] },
            },
            unrelated: { keep: true },
        }

        const cleaned = stripBardWikiVirtualMemoryFromDatabase(database)

        expect(cleaned.characters.first.chats[0].hypaV3Data?.summaries)
            .toHaveLength(0)
        expect(cleaned.characters.second.chats[0].hypaV2Data?.mainChunks)
            .toHaveLength(0)
        expect(cleaned.unrelated).toEqual({ keep: true })
    })
})
