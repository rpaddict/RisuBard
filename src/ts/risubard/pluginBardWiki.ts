import {
    isNarrativeContextOptedIn,
    loadNarrativeInquiry,
    selectNarrativeWorkingMessages,
    type NarrativeInquiryResponse,
} from './narrativeContext'
import {
    loadNarrativeMemoryWiki,
    saveManualWikiDocument,
    setWikiDocumentContextMode,
    setWikiDocumentGrade,
    trashWikiDocument,
    type MarkdownWikiContextMode,
    type MarkdownWikiDocumentType,
    type NarrativeMemoryWikiMarkdown,
} from './memoryWiki'
import {
    resolveRisuBardChatSettings,
    type RisuBardChatSettings,
} from './risuBardSettings'
import { PluginContextCache } from './pluginContextCache'
import { RISUBARD_MEMORY_UPDATED_EVENT } from './memoryEvents'

let compatibilityCaches = new WeakMap<
    typeof fetch, WeakMap<typeof loadNarrativeInquiry, PluginContextCache<BardWikiPluginContextResult>>
>()
if (typeof window !== 'undefined') {
    window.addEventListener(RISUBARD_MEMORY_UPDATED_EVENT, () => {
        compatibilityCaches = new WeakMap()
    })
}

export const BARDWIKI_VIRTUAL_MEMORY_MARKER = 'bardwiki-plugin-context-v1'

const SUPA_CONTEXT_START = '<!-- RISUBARD_BARDWIKI_PLUGIN_CONTEXT_START -->'
const SUPA_CONTEXT_END = '<!-- RISUBARD_BARDWIKI_PLUGIN_CONTEXT_END -->'

export interface BardWikiPluginMessage {
    role: 'user' | 'char' | 'assistant'
    data: string
    disabled?: false | true | 'allBefore'
    isComment?: boolean
}

interface LegacyMemoryItem {
    text: string
    risuBardVirtualMemory?: string
}

export interface BardWikiCompatibleChat {
    message?: readonly BardWikiPluginMessage[]
    id?: string
    risuBardSettings?: RisuBardChatSettings
    hypaV3Data?: {
        summaries?: readonly LegacyMemoryItem[]
    }
    hypaV2Data?: {
        mainChunks?: readonly LegacyMemoryItem[]
    }
    supaMemoryData?: string
}

type BardWikiProjectedChat<T> = T & {
    hypaV3Data: {
        summaries: LegacyMemoryItem[]
        [key: string]: unknown
    }
    hypaV2Data: {
        mainChunks: LegacyMemoryItem[]
        [key: string]: unknown
    }
    supaMemoryData: string
}

function stripSupaProjection(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined
    let cleaned = value
    while (true) {
        const start = cleaned.indexOf(SUPA_CONTEXT_START)
        if (start === -1) break
        const end = cleaned.indexOf(SUPA_CONTEXT_END, start)
        if (end === -1) break
        let removeFrom = start
        if (cleaned.slice(Math.max(0, start - 2), start) === '\n\n') {
            removeFrom = start - 2
        } else if (cleaned.slice(Math.max(0, start - 1), start) === '\n') {
            removeFrom = start - 1
        }
        cleaned = cleaned.slice(0, removeFrom)
            + cleaned.slice(end + SUPA_CONTEXT_END.length)
    }
    return cleaned
}

export function stripBardWikiVirtualMemory<T extends BardWikiCompatibleChat>(
    chat: T
): T {
    const v3 = chat.hypaV3Data
    const v2 = chat.hypaV2Data
    const cleanedSupa = stripSupaProjection(chat.supaMemoryData)
    return {
        ...chat,
        ...(v3 === undefined ? {} : {
            hypaV3Data: {
                ...v3,
                summaries: (v3.summaries ?? []).filter((item) =>
                    item.risuBardVirtualMemory !== BARDWIKI_VIRTUAL_MEMORY_MARKER
                ),
            },
        }),
        ...(v2 === undefined ? {} : {
            hypaV2Data: {
                ...v2,
                mainChunks: (v2.mainChunks ?? []).filter((item) =>
                    item.risuBardVirtualMemory !== BARDWIKI_VIRTUAL_MEMORY_MARKER
                ),
            },
        }),
        ...(chat.supaMemoryData === undefined ? {} : {
            supaMemoryData: cleanedSupa ?? '',
        }),
    } as T
}

export function injectBardWikiVirtualMemory<T extends BardWikiCompatibleChat>(
    chat: T,
    content: string
): BardWikiProjectedChat<T> {
    const cleaned = stripBardWikiVirtualMemory(chat)
    const baseSupa = cleaned.supaMemoryData?.trimEnd() ?? ''
    const wikiSection = `${SUPA_CONTEXT_START}\n${content}\n${SUPA_CONTEXT_END}`
    const payload = baseSupa ? `${baseSupa}\n\n${wikiSection}` : wikiSection
    const v3 = cleaned.hypaV3Data ?? {}
    const v2 = cleaned.hypaV2Data ?? {}
    return {
        ...cleaned,
        hypaV3Data: {
            ...v3,
            summaries: [
                ...(v3.summaries ?? []),
                {
                    text: payload,
                    chatMemos: [],
                    isImportant: true,
                    tags: ['BardWiki'],
                    risuBardVirtualMemory: BARDWIKI_VIRTUAL_MEMORY_MARKER,
                },
            ],
        },
        hypaV2Data: {
            ...v2,
            mainChunks: [
                ...(v2.mainChunks ?? []),
                {
                    text: payload,
                    risuBardVirtualMemory: BARDWIKI_VIRTUAL_MEMORY_MARKER,
                },
            ],
        },
        supaMemoryData: payload,
    } as BardWikiProjectedChat<T>
}

export function selectBardWikiPluginRecentMessages<
    T extends BardWikiPluginMessage
>(
    messages: readonly T[],
    responseMessageCount: number,
    excludeHistoricalUserMessages: boolean
): T[] {
    let start = 0
    for (let index = messages.length - 1; index >= 0; index -= 1) {
        if (messages[index].disabled === 'allBefore') {
            start = index + 1
            break
        }
    }
    const usable = messages.slice(start).filter((message) =>
        message.disabled !== true
        && message.disabled !== 'allBefore'
        && message.isComment !== true
        && typeof message.data === 'string'
        && message.data.trim().length > 0
    )
    return selectNarrativeWorkingMessages(
        usable,
        responseMessageCount,
        !excludeHistoricalUserMessages
    )
}

export type BardWikiPluginDocument =
    NarrativeMemoryWikiMarkdown['documents'][number]

export interface BardWikiPluginContextResult {
    content: string
    sources: NarrativeInquiryResponse['sources']
    recentMessages: Array<{
        role: BardWikiPluginMessage['role']
        data: string
    }>
    metrics: NarrativeInquiryResponse['metrics']
}

interface BardWikiPluginScope {
    characterId: string
    chatId: string
    fetchImpl: typeof fetch
    createAuth(): Promise<string>
}

interface BardWikiPluginContextInput extends BardWikiPluginScope {
    chat: BardWikiCompatibleChat
    character?: { risuBardPinnedSettings?: RisuBardChatSettings }
    globalSettings: RisuBardChatSettings
    query?: string
}

interface BardWikiPluginContextDependencies {
    loadInquiry: typeof loadNarrativeInquiry
}

function formatBardWikiPluginContext(
    sources: NarrativeInquiryResponse['sources'],
    recentMessages: readonly BardWikiPluginMessage[]
): string {
    const sections: string[] = []
    if (sources.length > 0) {
        sections.push([
            '# BardWiki long-term context',
            ...sources.map((source) => [
                `## ${source.displayName ?? source.id}`,
                `[source ${JSON.stringify(source.id)}]`,
                source.content,
            ].join('\n')),
        ].join('\n\n'))
    }
    if (recentMessages.length > 0) {
        sections.push([
            '# Recent conversation',
            ...recentMessages.map((message) =>
                `${message.role === 'user' ? 'User' : 'Assistant'}: ${message.data}`
            ),
        ].join('\n\n'))
    }
    return sections.join('\n\n')
}

export async function buildBardWikiPluginContext(
    input: BardWikiPluginContextInput,
    dependencies: Partial<BardWikiPluginContextDependencies> = {}
): Promise<BardWikiPluginContextResult> {
    const settings = resolveRisuBardChatSettings(
        input.globalSettings,
        input.chat.risuBardSettings,
        input.character?.risuBardPinnedSettings,
    )
    const recentMessages = selectBardWikiPluginRecentMessages(
        input.chat.message ?? [],
        settings.risuBardResponseMessageCount,
        settings.risuBardResponseExcludeUserMessages
    )
    const latestUser = [...recentMessages].reverse().find((message) =>
        message.role === 'user'
    )
    const latestMessage = recentMessages.at(-1)
    const query = input.query?.trim()
        || latestUser?.data
        || latestMessage?.data
        || 'current narrative state'
    const fallbackInput = recentMessages.map((message) =>
        `${message.role === 'user' ? 'User' : 'Assistant'}: ${message.data}`
    ).join('\n').slice(-4_096)
    const inquiry = await (dependencies.loadInquiry ?? loadNarrativeInquiry)({
        characterId: input.characterId,
        chatId: input.chatId,
        currentInput: query,
        ...(fallbackInput ? { fallbackInput } : {}),
        tokenBudget: {
            target: settings.risuBardInquiryTargetTokenBudget,
            events: settings.risuBardInquiryEventTokenBudget,
            perSource: settings.risuBardInquirySourceTokenBudget,
            maximum: settings.risuBardInquiryMaximumTokenBudget,
        },
        fetchImpl: input.fetchImpl,
        createAuth: input.createAuth,
        timeoutMs: settings.risuBardInquiryTimeoutMs,
    })
    return {
        content: formatBardWikiPluginContext(inquiry.sources, recentMessages),
        sources: inquiry.sources,
        recentMessages: recentMessages.map((message) => ({
            role: message.role,
            data: message.data,
        })),
        metrics: inquiry.metrics,
    }
}

interface BardWikiDocumentDependencies {
    loadWiki: typeof loadNarrativeMemoryWiki
    saveDocument: typeof saveManualWikiDocument
    setContextMode: typeof setWikiDocumentContextMode
    setGrade: typeof setWikiDocumentGrade
    trashDocument: typeof trashWikiDocument
}

export async function getBardWikiPluginDocuments(
    input: BardWikiPluginScope & {
        types?: readonly MarkdownWikiDocumentType[]
        statuses?: readonly BardWikiPluginDocument['status'][]
    },
    dependencies: Partial<BardWikiDocumentDependencies> = {}
): Promise<BardWikiPluginDocument[]> {
    const wiki = await (dependencies.loadWiki ?? loadNarrativeMemoryWiki)(input)
    if (wiki.mode !== 'markdown') return []
    const typeFilter = input.types ? new Set(input.types) : undefined
    const statusFilter = input.statuses ? new Set(input.statuses) : undefined
    return wiki.documents.filter((document) =>
        (!typeFilter || typeFilter.has(document.type))
        && (!statusFilter || statusFilter.has(document.status))
    )
}

export async function saveBardWikiPluginDocument(
    input: BardWikiPluginScope & {
        document: {
            documentId?: string
            type: MarkdownWikiDocumentType
            title: string
            aliases?: string[]
            markdown: string
            expectedContentHash?: string
        }
    },
    dependencies: Partial<BardWikiDocumentDependencies> = {}
): Promise<BardWikiPluginDocument> {
    const result = await (dependencies.saveDocument ?? saveManualWikiDocument)({
        characterId: input.characterId,
        chatId: input.chatId,
        fetchImpl: input.fetchImpl,
        createAuth: input.createAuth,
        ...input.document,
    })
    compatibilityCaches = new WeakMap()
    return result
}

export async function setBardWikiPluginDocumentContextMode(
    input: BardWikiPluginScope & {
        documentId: string
        contextMode: MarkdownWikiContextMode
        expectedContentHash: string
    },
    dependencies: Partial<BardWikiDocumentDependencies> = {}
): Promise<BardWikiPluginDocument> {
    const result = await (dependencies.setContextMode ?? setWikiDocumentContextMode)(input)
    compatibilityCaches = new WeakMap()
    return result
}

export async function setBardWikiPluginDocumentGrade(
    input: BardWikiPluginScope & {
        documentId: string
        grade: number | null
        gradeBy?: 'user' | 'ai'
        expectedContentHash: string
    },
    dependencies: Partial<BardWikiDocumentDependencies> = {}
): Promise<BardWikiPluginDocument> {
    const result = await (dependencies.setGrade ?? setWikiDocumentGrade)(input)
    compatibilityCaches = new WeakMap()
    return result
}

export async function trashBardWikiPluginDocument(
    input: BardWikiPluginScope & { documentId: string },
    dependencies: Partial<BardWikiDocumentDependencies> = {}
): Promise<{ id: string; trashed: true }> {
    const result = await (dependencies.trashDocument ?? trashWikiDocument)(input)
    compatibilityCaches = new WeakMap()
    return result
}

export interface BardWikiCompatibleCharacter {
    chaId?: string
    chatPage?: number
    chats?: BardWikiCompatibleChat[]
    risuBardPinnedSettings?: RisuBardChatSettings
}

export async function decorateBardWikiChatForPlugin<
    T extends BardWikiCompatibleChat
>(input: {
    characterId: string
    chatId: string
    chat: T
    character?: { risuBardPinnedSettings?: RisuBardChatSettings }
    globalSettings: RisuBardChatSettings
    fetchImpl: typeof fetch
    createAuth(): Promise<string>
    onError?: (error: unknown) => void
}, dependencies: Partial<BardWikiPluginContextDependencies> = {}): Promise<T> {
    try {
        if (!isNarrativeContextOptedIn()) return input.chat
        // Cache only compatibility reads; explicit bardWiki.getContext() stays fresh.
        // Never cache the chat itself: polling must see current streaming state.
        const settings = resolveRisuBardChatSettings(input.globalSettings, input.chat.risuBardSettings, input.character?.risuBardPinnedSettings)
        const recent = selectBardWikiPluginRecentMessages(
            input.chat.message ?? [], settings.risuBardResponseMessageCount,
            settings.risuBardResponseExcludeUserMessages,
        ).map(({ role, data }) => ({ role, data }))
        const key = JSON.stringify([input.characterId, input.chatId, settings, recent])
        let loaders = compatibilityCaches.get(input.fetchImpl)
        if (!loaders) {
            loaders = new WeakMap()
            compatibilityCaches.set(input.fetchImpl, loaders)
        }
        const loader = dependencies.loadInquiry ?? loadNarrativeInquiry
        let cache = loaders.get(loader)
        if (!cache) {
            cache = new PluginContextCache()
            loaders.set(loader, cache)
        }
        const context = await cache.get(key, () => buildBardWikiPluginContext(input, dependencies))
        return context.content
            ? injectBardWikiVirtualMemory(input.chat, context.content)
            : input.chat
    } catch (error) {
        input.onError?.(error)
        return input.chat
    }
}

export async function decorateBardWikiCharacterForPlugin<
    T extends BardWikiCompatibleCharacter
>(
    input: {
        character: T
        globalSettings: RisuBardChatSettings
        fetchImpl: typeof fetch
        createAuth(): Promise<string>
        onError?: (error: unknown) => void
    },
    dependencies: Partial<BardWikiPluginContextDependencies> = {}
): Promise<T> {
    const page = input.character.chatPage
    const chat = Number.isSafeInteger(page)
        ? input.character.chats?.[page as number]
        : undefined
    if (!input.character.chaId || !chat?.id) return input.character
    const decoratedChat = await decorateBardWikiChatForPlugin({
        characterId: input.character.chaId,
        character: input.character,
        chatId: chat.id,
        chat,
        globalSettings: input.globalSettings,
        fetchImpl: input.fetchImpl,
        createAuth: input.createAuth,
        onError: input.onError,
    }, dependencies)
    if (decoratedChat === chat) return input.character
    const chats = [...(input.character.chats ?? [])]
    chats[page as number] = decoratedChat
    return { ...input.character, chats } as T
}

export function stripBardWikiVirtualMemoryFromCharacter<
    T extends BardWikiCompatibleCharacter
>(character: T): T {
    if (!Array.isArray(character.chats)) return character
    return {
        ...character,
        chats: character.chats.map((chat) =>
            stripBardWikiVirtualMemory(chat)
        ),
    } as T
}

export function stripBardWikiVirtualMemoryFromDatabase<
    T extends { characters?: unknown; [key: string]: unknown }
>(database: T): T {
    const characters = database.characters
    if (Array.isArray(characters)) {
        return {
            ...database,
            characters: characters.map((character) =>
                character && typeof character === 'object'
                    ? stripBardWikiVirtualMemoryFromCharacter(
                        character as BardWikiCompatibleCharacter
                    )
                    : character
            ),
        } as T
    }
    if (!characters || typeof characters !== 'object') return database
    return {
        ...database,
        characters: Object.fromEntries(
            Object.entries(characters).map(([key, character]) => [
                key,
                character && typeof character === 'object'
                    ? stripBardWikiVirtualMemoryFromCharacter(
                        character as BardWikiCompatibleCharacter
                    )
                    : character,
            ])
        ),
    } as T
}
