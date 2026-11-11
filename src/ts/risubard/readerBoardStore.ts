// Storage and request runtime for the reader board dock. Boards live in their
// own KV keys, outside database.bin and outside the chat, so the RP model
// never sees them and a long board never grows the main save.

import { v4 } from 'uuid'
import type { Chat, character } from '../storage/database.svelte'
import { readPersistentJson, removePersistentKey, writePersistentJson } from '../storage/persistentKv'
import { requestChatData } from '../process/request/request'
import { getUserName } from '../util'
import { forageStorage } from '../globalApi.svelte'
import { loadNarrativeMemoryWiki } from './memoryWiki'
import type { EventOrderMessage } from './eventOrder'
import { selectReaderBoardWiki, type ReaderBoardWikiDocument } from './readerBoardWiki'
import {
    applyGenerationResult,
    applyRosterResult,
    buildGenerationRequest,
    buildRosterRequest,
    createReaderBoard,
    duplicateReaderBoard,
    forkReaderBoard,
    normalizeReaderBoard,
    normalizeReaderBoardIndex,
    parseModelJson,
    prepareGeneration,
    startNewWork,
    summarizeReaderBoard,
    toMessageView,
    type ApplyResult,
    type ChatMessageView,
    type GenerationMessage,
    type GenerationPlan,
    type ReaderBoard,
    type ReaderBoardIndex,
    type ReaderBoardModel,
} from './readerBoard'

const INDEX_KEY = 'risubard/reader-board/index.json'
const boardKey = (id: string) => `risubard/reader-board/boards/${encodeURIComponent(id)}.json`
const undoKey = (id: string) => `risubard/reader-board/boards/${encodeURIComponent(id)}.undo.json`

/** What one press of the generate button did, so it can be undone or rolled again. */
export interface ReaderBoardRunRecord {
    chatKey: string
    ranges: ({ start: number; end: number } | undefined)[]
    onlyPostNo?: number
    /** Board updatedAt right after the run; any later change makes the undo stale. */
    after: number
    savedAt: number
}

export interface ReaderBoardUndoEntry {
    board: ReaderBoard
    run: ReaderBoardRunRecord
}

function normalizeUndoEntry(value: unknown): ReaderBoardUndoEntry | null {
    const entry = value as { board?: unknown; run?: ReaderBoardRunRecord } | null
    const board = normalizeReaderBoard(entry?.board)
    if (!board || !entry?.run || !Array.isArray(entry.run.ranges) || typeof entry.run.after !== 'number') return null
    return { board, run: entry.run }
}

/** Oldest first. Reads the old one-level file as a stack of one. */
async function readUndoStack(id: string): Promise<ReaderBoardUndoEntry[]> {
    const value = await readPersistentJson(undoKey(id)) as { entries?: unknown[] } | null
    const raw = Array.isArray(value?.entries) ? value.entries : value ? [value] : []
    return raw.map(normalizeUndoEntry).filter((entry): entry is ReaderBoardUndoEntry => entry !== null)
}

async function writeUndoStack(id: string, entries: ReaderBoardUndoEntry[]): Promise<void> {
    if (entries.length === 0) await removePersistentKey(undoKey(id))
    else await writePersistentJson(undoKey(id), { entries })
}

/**
 * Keeps the board as it was before a run, up to `depth` runs back. Runs that
 * no longer lead to `before` (rolled again, or the board changed in between)
 * are dropped first, so every kept entry undoes into the next one down.
 */
export async function saveRunUndo(before: ReaderBoard, run: ReaderBoardRunRecord, depth: number): Promise<number> {
    const entries = await readUndoStack(before.id)
    while (entries.length > 0 && entries[entries.length - 1].run.after !== before.updatedAt) entries.pop()
    entries.push({ board: before, run })
    const kept = entries.slice(-Math.max(1, depth))
    await writeUndoStack(before.id, kept)
    return kept.length
}

/** The latest run with how many runs can be undone in a row. */
export async function loadRunUndo(id: string): Promise<{ board: ReaderBoard; run: ReaderBoardRunRecord; depth: number } | null> {
    const entries = await readUndoStack(id)
    const top = entries[entries.length - 1]
    return top ? { ...top, depth: entries.length } : null
}

/** Takes the latest run off the stack after it was undone. */
export async function popRunUndo(id: string): Promise<void> {
    const entries = await readUndoStack(id)
    entries.pop()
    await writeUndoStack(id, entries)
}

/** Drops the oldest runs beyond a lowered depth. */
export async function trimRunUndo(id: string, depth: number): Promise<number> {
    const entries = await readUndoStack(id)
    const kept = entries.slice(-Math.max(1, depth))
    if (kept.length !== entries.length) await writeUndoStack(id, kept)
    return kept.length
}

export async function clearRunUndo(id: string): Promise<void> {
    await removePersistentKey(undoKey(id))
}

export async function loadReaderBoardIndex(): Promise<ReaderBoardIndex> {
    return normalizeReaderBoardIndex(await readPersistentJson(INDEX_KEY))
}

export async function loadReaderBoard(id: string): Promise<ReaderBoard | null> {
    return normalizeReaderBoard(await readPersistentJson(boardKey(id)))
}

async function writeIndex(index: ReaderBoardIndex): Promise<ReaderBoardIndex> {
    await writePersistentJson(INDEX_KEY, index)
    return index
}

/** Writes the board first so the index never lists a board that is missing. */
export async function saveReaderBoard(board: ReaderBoard, index: ReaderBoardIndex): Promise<ReaderBoardIndex> {
    await writePersistentJson(boardKey(board.id), board)
    const links = { ...index.links }
    for (const [key, id] of Object.entries(links)) {
        if (id === board.id && !board.chatKeys.includes(key)) delete links[key]
    }
    for (const key of board.chatKeys) links[key] = board.id
    return writeIndex({
        ...index,
        boards: [summarizeReaderBoard(board), ...index.boards.filter((item) => item.id !== board.id)],
        links,
    })
}

export async function deleteReaderBoard(id: string, index: ReaderBoardIndex): Promise<ReaderBoardIndex> {
    const links = Object.fromEntries(Object.entries(index.links).filter(([, boardId]) => boardId !== id))
    const next = await writeIndex({ ...index, boards: index.boards.filter((item) => item.id !== id), links })
    await removePersistentKey(boardKey(id))
    await removePersistentKey(undoKey(id))
    return next
}

export async function saveReaderBoardModel(model: ReaderBoardModel, index: ReaderBoardIndex): Promise<ReaderBoardIndex> {
    return writeIndex({ ...index, model })
}

/** Saves board-wide options kept in the index (presets, look). */
export async function saveReaderBoardOptions(
    patch: Partial<Pick<ReaderBoardIndex, 'conceptPresets' | 'appearance'>>,
    index: ReaderBoardIndex,
): Promise<ReaderBoardIndex> {
    return writeIndex({ ...index, ...patch })
}

export async function saveReaderBoardSystemPrompt(
    input: { systemPrompt: string; systemPromptEnabled: boolean },
    index: ReaderBoardIndex,
): Promise<ReaderBoardIndex> {
    return writeIndex({ ...index, systemPrompt: input.systemPrompt.slice(0, 40000), systemPromptEnabled: input.systemPromptEnabled })
}

/** Links a chat to a board, releasing any board it was linked to before. */
export async function linkChat(
    board: ReaderBoard,
    chatKey: string,
    index: ReaderBoardIndex,
): Promise<{ board: ReaderBoard; index: ReaderBoardIndex }> {
    let next = index
    const previousId = index.links[chatKey]
    if (previousId && previousId !== board.id) {
        const previous = await loadReaderBoard(previousId)
        if (previous) {
            previous.chatKeys = previous.chatKeys.filter((key) => key !== chatKey)
            next = await saveReaderBoard(previous, next)
        }
    }
    if (!board.chatKeys.includes(chatKey)) board.chatKeys.push(chatKey)
    next = await saveReaderBoard(board, next)
    return { board, index: next }
}

export async function unlinkChat(board: ReaderBoard, chatKey: string, index: ReaderBoardIndex): Promise<ReaderBoardIndex> {
    board.chatKeys = board.chatKeys.filter((key) => key !== chatKey)
    return saveReaderBoard(board, index)
}

export function newReaderBoard(input: { name: string; characterId: string; chatKey?: string; concept?: string; level?: number; harshness?: number }): ReaderBoard {
    return createReaderBoard({
        id: v4(),
        name: input.name,
        characterId: input.characterId,
        chatKey: input.chatKey,
        settings: {
            ...(input.concept ? { concept: input.concept } : {}),
            ...(input.level !== undefined ? { level: input.level } : {}),
            ...(input.harshness !== undefined ? { harshness: input.harshness } : {}),
        },
    })
}

export function forkBoardForChat(source: ReaderBoard, chatKey: string, name?: string): ReaderBoard {
    return forkReaderBoard(source, { id: v4(), chatKey, name })
}

/** Ends the board's current work and starts another on the given chat. */
export async function startWorkOnChat(
    board: ReaderBoard,
    input: Omit<Parameters<typeof startNewWork>[1], 'id' | 'chatKey'> & { chatKey: string },
    index: ReaderBoardIndex,
): Promise<{ board: ReaderBoard; index: ReaderBoardIndex }> {
    startNewWork(board, { ...input, id: v4() })
    // linkChat also releases a board this chat was attached to before.
    return linkChat(board, input.chatKey, index)
}

export function copyBoard(source: ReaderBoard): ReaderBoard {
    return duplicateReaderBoard(source, { id: v4() })
}

/** Imported boards always get a new id so they never overwrite one in use. */
export function adoptImportedBoard(board: ReaderBoard): ReaderBoard {
    return duplicateReaderBoard(board, { id: v4(), name: board.name })
}

export function chatMessageViews(currentCharacter: character, chat: Chat): ChatMessageView[] {
    const userName = getUserName({ character: currentCharacter, chat })
    // Disabled messages are out of the story, as they are out of the chat's turns.
    return chat.message
        .filter((message) => !message.isComment && !message.disabled)
        .map((message) => toMessageView(message, message.role === 'user' ? userName : (message.name || currentCharacter.name)))
}

async function requestJson(
    messages: GenerationMessage[],
    model: ReaderBoardModel,
    currentCharacter: character | undefined,
    signal: AbortSignal,
    systemPrompt?: string,
): Promise<Record<string, unknown>> {
    const response = await requestChatData({
        formated: systemPrompt?.trim() ? [{ role: 'system', content: systemPrompt.trim() }, ...messages] : messages,
        bias: {},
        currentChar: currentCharacter,
        useStreaming: false,
        noMultiGen: true,
        tools: [],
        disablePromptCache: true,
        logSource: 'other',
        logPurpose: 'reader-board',
    }, model, signal)
    if (response.type === 'fail') throw new Error(response.result || '응답을 받지 못했습니다.')
    if (response.type !== 'success') throw new Error('지원하지 않는 응답 형식입니다.')
    return parseModelJson(response.result)
}

export type ReaderBoardStage = 'roster' | 'reactions'

export interface ReaderBoardRunInput {
    board: ReaderBoard
    chatKey: string
    views: ChatMessageView[]
    range?: { start: number; end: number }
    onlyPostNo?: number
    /** The chat's wiki scope; notes are used when the board allows it. */
    wiki?: { characterId: string; chatId: string; messages: EventOrderMessage[] }
    model: ReaderBoardModel
    /** Sent first as its own system message when set. */
    systemPrompt?: string
    storyName: string
    currentCharacter?: character
    signal: AbortSignal
    onStage?: (stage: ReaderBoardStage) => void
}

export interface ReaderBoardRunResult {
    board: ReaderBoard
    applied: ApplyResult
    rosterAdded: number
}

/**
 * One run: makes the roster on first use, then asks for reactions. Nothing
 * is saved here; a failed request leaves the stored board as it was.
 */
export async function runReaderBoard(input: ReaderBoardRunInput): Promise<ReaderBoardRunResult> {
    let working = structuredClone(input.board)
    let rosterAdded = 0
    if (working.readers.length === 0) {
        input.onStage?.('roster')
        const reply = await requestJson(buildRosterRequest(working, input.storyName), input.model, input.currentCharacter, input.signal, input.systemPrompt)
        rosterAdded = applyRosterResult(working, reply, v4)
    }
    const plan = prepareGeneration({ board: working, chatKey: input.chatKey, views: input.views, range: input.range, onlyPostNo: input.onlyPostNo })
    if (!plan) throw new Error('독자가 반응할 새 연재분이나 작가 글이 없습니다.')
    input.onStage?.('reactions')
    const wiki = plan.board.settings.useWiki && input.wiki ? await wikiNotes(plan, input.wiki, input.signal) : ''
    const reply = await requestJson(buildGenerationRequest(plan, input.storyName, { wiki }), input.model, input.currentCharacter, input.signal, input.systemPrompt)
    const applied = applyGenerationResult(plan, reply, { createId: v4 })
    working = plan.board
    return { board: working, applied, rosterAdded }
}

/**
 * BardWiki notes up to the last published message. A missing or broken wiki
 * only means no notes; the run goes on without them.
 */
async function wikiNotes(
    plan: GenerationPlan,
    scope: { characterId: string; chatId: string; messages: EventOrderMessage[] },
    signal: AbortSignal,
): Promise<string> {
    const indexOf = new Map<string, number>()
    scope.messages.forEach((message, index) => { if (message.chatId) indexOf.set(message.chatId, index) })
    const board = plan.board
    const published = board.episodes.filter((episode) => episode.workId === board.currentWorkId && episode.status === 'published')
    const positions = (keys: string[]) => keys.map((key) => indexOf.get(key)).filter((index): index is number => index !== undefined)
    const all = positions(published.flatMap((episode) => episode.messageKeys))
    if (all.length === 0) return ''
    const focus = plan.episode ? positions(plan.episode.messageKeys) : []
    try {
        const wiki = await loadNarrativeMemoryWiki({
            characterId: scope.characterId,
            chatId: scope.chatId,
            fetchImpl: fetch,
            createAuth: () => forageStorage.createAuth(),
            signal,
        })
        if (wiki.mode !== 'markdown') return ''
        return selectReaderBoardWiki({
            documents: wiki.documents as ReaderBoardWikiDocument[],
            messages: scope.messages,
            publishedUntil: Math.max(...all),
            focus: focus.length > 0 ? { start: Math.min(...focus), end: Math.max(...focus) } : undefined,
        })
    }
    catch (cause) {
        if (signal.aborted) throw cause
        return ''
    }
}

/** Makes or tops up the roster without posting anything. */
export async function runRoster(input: {
    board: ReaderBoard
    model: ReaderBoardModel
    systemPrompt?: string
    storyName: string
    currentCharacter?: character
    signal: AbortSignal
}): Promise<{ board: ReaderBoard; added: number }> {
    const working = structuredClone(input.board)
    const reply = await requestJson(buildRosterRequest(working, input.storyName), input.model, input.currentCharacter, input.signal, input.systemPrompt)
    const added = applyRosterResult(working, reply, v4)
    return { board: working, added }
}
