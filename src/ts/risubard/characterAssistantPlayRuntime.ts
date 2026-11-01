// Runs a play-mode test: makes a new chat for the project's bot, then for each
// turn asks the assistant for the user's input and sends it through the normal
// chat pipeline, so presets, lorebooks and triggers work as they do for a
// person typing. Lives outside the dock so closing the dock does not stop it.

import { get, writable } from 'svelte/store'
import { v4 } from 'uuid'
import { DBState, selectedCharID } from '../stores.svelte'
import { resolveAssistantPrompt } from './assistantPrompts'
import { newChatModelDefaults, type character, type Chat } from '../storage/database.svelte'
import { changeChatTo, requestImmediateSave } from '../globalApi.svelte'
import { changeChar } from '../characters'
import { createUniqueDisplayName } from '../displayName'
import { sendChat } from '../process/index.svelte'
import { abortGeneration, chatGenKey, endGeneration, generationStates, isAnyGenerating, registerAbort } from '../process/generationState'
import { resolveGenerationTarget, type GenerationTarget } from '../process/generationTarget'
import { processScript } from '../process/scripts'
import { runTrigger } from '../process/triggers'
import { loadLoreBookV3Prompt } from '../process/lorebook.svelte'
import { getPersonaPrompt, getUserName } from '../util'
import { formatChatLogForAssistant, type PromptAssistantChatLine } from './promptAssistant'
import { takeChatContext, unwatchChatContext, watchChatContext, type CapturedChatContext } from './chatContextCapture'
import { appendCharacterAssistantMessage, createCharacterAssistantMessage, findAssistantCharacter, requestOnce } from './characterAssistantStore'
import type {
    CharacterAssistantMessage,
    CharacterAssistantModel,
    CharacterAssistantPlayContext,
    CharacterAssistantPlayMode,
    CharacterAssistantPlayTurn,
} from './characterAssistant'
import {
    buildPlayerMessages,
    clampPlayTurns,
    formatPlayStartText,
    formatPlayTurnText,
    parsePlayerReply,
    PLAY_DEFAULT_CHAT_MESSAGES,
    type PlayLoreEntry,
} from './characterAssistantPlay'

export interface PlayState {
    projectId: string
    characterId: string
    chatId: string
    chatName: string
    turn: number
    total: number
    mode: CharacterAssistantPlayMode
    phase: 'player' | 'waiting' | 'chat'
    /** Semi-automatic mode: the input waiting for the user's decision. */
    pending?: { reaction: string; input: string }
}

/** The running test, or null. */
export const characterAssistantPlay = writable<PlayState | null>(null)
/** Each message the run stored, for a dock that shows the same project. */
export const characterAssistantPlayMessages = writable<{ projectId: string; message: CharacterAssistantMessage } | null>(null)

type Decision = { send: string } | { stop: true }

let controller: AbortController | null = null
let decide: ((decision: Decision) => void) | null = null

export function stopPlay(): void {
    controller?.abort()
    const state = get(characterAssistantPlay)
    if (state) abortGeneration(chatGenKey(state.chatId))
    decide?.({ stop: true })
}

/** Semi-automatic mode: sends the (possibly edited) input. */
export function submitPlayInput(text: string): void {
    if (!text.trim()) return
    decide?.({ send: text })
}

export interface StartPlayOptions {
    projectId: string
    characterId: string
    model: CharacterAssistantModel
    chatMessages: number
    instruction: string
    turns: number
    mode: CharacterAssistantPlayMode
    context: CharacterAssistantPlayContext
}

export interface PlayResult {
    completedTurns: number
    total: number
    /** Why the run ended early. Missing when every turn finished. */
    reason?: string
}

class PlayStop extends Error {}

function update(patch: Partial<PlayState>) {
    characterAssistantPlay.update((state) => state ? { ...state, ...patch } : state)
}

async function record(projectId: string, message: CharacterAssistantMessage) {
    await appendCharacterAssistantMessage(projectId, message)
    characterAssistantPlayMessages.set({ projectId, message })
}

function createTestChat(target: character): Chat {
    const previous = target.chats[target.chatPage]
    const chat = {
        message: [],
        note: '',
        name: createUniqueDisplayName(`플레이 테스트 ${target.chats.length + 1}`, target.chats),
        localLore: [],
        fmIndex: -1,
        id: v4(),
        ...newChatModelDefaults(target, previous),
    } as Chat
    target.chats.unshift(chat)
    // unshift moved every index; keep the page on a real chat until it is switched.
    target.chatPage = 0
    return chat
}

function showTestChat(index: number) {
    if (get(selectedCharID) !== index) changeChar(index)
    if (get(selectedCharID) === index) changeChatTo(0)
}

async function searchLore(target: character, instruction: string): Promise<PlayLoreEntry[]> {
    const found = await loadLoreBookV3Prompt({ character: target, text: instruction })
    const entries = found.actives.map((active) => ({
        name: active.source,
        content: active.prompt,
        always: active.sourceIdentity?.entry?.alwaysActive === true,
    }))
    // Entries the instruction matched come before always-on ones, so the length limit drops the latter first.
    return [...entries.filter((entry) => !entry.always), ...entries.filter((entry) => entry.always)]
        .filter((entry) => entry.content.trim())
        .map(({ name, content }) => ({ name, content }))
}

function greeting(target: character, chat: Chat): string {
    const index = chat.fmIndex ?? -1
    return (index >= 0 ? target.alternateGreetings?.[index] : target.firstMessage) ?? ''
}

function chatLines(target: character, chat: Chat, count: number): PromptAssistantChatLine[] {
    const userName = getUserName({ character: target, chat })
    const lines: PromptAssistantChatLine[] = []
    const first = greeting(target, chat)
    if (first.trim()) lines.push({ role: 'char', name: target.name, text: first })
    for (const message of chat.message) {
        lines.push({ role: message.role, name: message.role === 'user' ? userName : (message.name || target.name), text: message.data })
    }
    return lines.slice(-count)
}

function lastReply(target: character, chat: Chat): string {
    for (let i = chat.message.length - 1; i >= 0; i--) {
        if (chat.message[i].role === 'char') return chat.message[i].data
    }
    return greeting(target, chat)
}

async function askPlayer(options: StartPlayOptions, target: character, chat: Chat, lore: PlayLoreEntry[], wiki: CapturedChatContext['wiki'], turn: number, signal: AbortSignal) {
    const formated = buildPlayerMessages({
        systemPrompt: resolveAssistantPrompt(DBState.db.risuBardAssistantPrompts, 'characterAssistantPlayer'),
        instruction: options.instruction,
        personaName: getUserName({ character: target, chat }),
        personaPrompt: getPersonaPrompt({ character: target, chat }) ?? '',
        botName: target.name,
        lore,
        context: options.context,
        chatLog: formatChatLogForAssistant(chatLines(target, chat, options.chatMessages > 0 ? options.chatMessages : PLAY_DEFAULT_CHAT_MESSAGES)),
        wiki,
        lastReply: lastReply(target, chat),
        turn,
        total: options.turns,
    })
    const text = await requestOnce({ model: options.model }, formated, signal, () => {})
    if (signal.aborted) throw new PlayStop()
    return parsePlayerReply(text)
}

/** Why the run must stop before touching the chat, if it must. */
function interruption(target: GenerationTarget, expectedLength: number): string | undefined {
    let chat: Chat
    try {
        chat = resolveGenerationTarget(DBState.db.characters, target).chat
    }
    catch {
        return '테스트 채팅이나 봇이 삭제됐습니다.'
    }
    if (get(generationStates).has(chatGenKey(target.chatId))) return '테스트 채팅에서 다른 답변이 생성 중입니다.'
    if (chat.message.length !== expectedLength) return '테스트 채팅에 다른 메시지가 들어오거나 지워졌습니다.'
    const selected = DBState.db.characters[get(selectedCharID)]
    if (selected?.chaId !== target.characterId || selected.chats[selected.chatPage]?.id !== target.chatId) {
        return '화면이 테스트 채팅에서 벗어났습니다.'
    }
    return undefined
}

/** Puts the input in the chat the way the chat screen does, then generates the reply. */
async function playTurn(target: GenerationTarget, input: string, signal: AbortSignal): Promise<'done' | 'stopped' | 'failed'> {
    const key = chatGenKey(target.chatId)
    if (get(generationStates).has(key)) return 'failed'
    const requestSettings = { ...DBState.db }
    const { character: bot, chat } = resolveGenerationTarget(DBState.db.characters, target)
    let messages = chat.message
    const triggered = await runTrigger(bot, 'input', { chat })
    if (triggered) messages = triggered.chat.message
    messages.push({
        role: 'user',
        data: await processScript(bot, input, 'editinput', {}, target, requestSettings),
        time: Date.now(),
        name: null,
    })
    resolveGenerationTarget(DBState.db.characters, target).chat.message = messages

    const generation = new AbortController()
    const forward = () => generation.abort()
    signal.addEventListener('abort', forward)
    registerAbort(key, generation)
    try {
        const generated = await sendChat(-1, { signal: generation.signal, target, requestSettings })
        if (generation.signal.aborted) return 'stopped'
        return generated ? 'done' : 'failed'
    }
    finally {
        signal.removeEventListener('abort', forward)
        endGeneration(key)
    }
}

function waitForDecision(): Promise<Decision> {
    return new Promise((resolve) => {
        decide = (decision) => {
            decide = null
            resolve(decision)
        }
    })
}

/**
 * Runs the whole test. Throws before anything starts when it cannot start;
 * after that, problems end the run and are written as a turn note.
 */
export async function startPlay(options: StartPlayOptions): Promise<PlayResult> {
    if (get(characterAssistantPlay)) throw new Error('이미 플레이 테스트가 진행 중입니다.')
    if (get(isAnyGenerating)) throw new Error('진행 중인 답변 생성이 끝난 뒤 시작해 주세요.')
    const found = findAssistantCharacter(options.characterId)
    if (!found) throw new Error('이 프로젝트의 봇을 찾지 못했습니다.')
    const instruction = options.instruction.trim()
    if (!instruction) throw new Error('지시문을 입력해 주세요.')
    const total = clampPlayTurns(options.turns)
    const run: StartPlayOptions = { ...options, instruction, turns: total }

    const chat = createTestChat(found.character)
    const target: GenerationTarget = { characterId: found.character.chaId, chatId: chat.id! }
    showTestChat(found.index)
    void requestImmediateSave()

    controller = new AbortController()
    const signal = controller.signal
    characterAssistantPlay.set({
        projectId: run.projectId,
        characterId: target.characterId,
        chatId: target.chatId,
        chatName: chat.name ?? '',
        turn: 1,
        total,
        mode: run.mode,
        phase: 'player',
    })
    watchChatContext(target.chatId)
    let completed = 0
    let reason: string | undefined
    try {
        await record(run.projectId, createCharacterAssistantMessage('user', formatPlayStartText(instruction, total, run.mode, run.context, chat.name ?? ''), {
            playStart: { turns: total, mode: run.mode, context: run.context, chatName: chat.name ?? '' },
        }))
        const lore = await searchLore(found.character, instruction)
        let wiki: CapturedChatContext['wiki'] = []
        let expectedLength = 0
        for (let turn = 1; turn <= total; turn++) {
            update({ turn, phase: 'player', pending: undefined })
            const finish = async (outcome: CharacterAssistantPlayTurn['outcome'], played: Omit<CharacterAssistantPlayTurn, 'turn' | 'total' | 'outcome'>) => {
                const play: CharacterAssistantPlayTurn = { turn, total, outcome, ...played }
                await record(run.projectId, createCharacterAssistantMessage('assistant', formatPlayTurnText(play), { play }))
            }
            reason = interruption(target, expectedLength)
            if (reason) break
            const resolved = resolveGenerationTarget(DBState.db.characters, target)
            const reply = await askPlayer(run, resolved.character, resolved.chat, lore, wiki, turn, signal)
            if (!reply.input) {
                await finish('failed', { reaction: reply.reaction, input: '', note: '비서가 <input> 태그로 입력을 만들지 못했습니다.' })
                reason = '비서가 입력을 만들지 못했습니다.'
                break
            }
            let input = reply.input
            if (run.mode === 'semi') {
                update({ phase: 'waiting', pending: reply })
                const decision = await waitForDecision()
                if ('stop' in decision) throw new PlayStop()
                input = decision.send.trim()
            }
            // The user may have typed in the chat while the assistant was writing.
            reason = interruption(target, expectedLength)
            if (reason) break
            update({ phase: 'chat', pending: undefined })
            const outcome = await playTurn(target, input, signal)
            const context = takeChatContext(target.chatId)
            if (context) wiki = context.wiki
            const after = resolveGenerationTarget(DBState.db.characters, target).chat
            const last = after.message.at(-1)
            if (outcome === 'stopped' || signal.aborted) {
                await finish('stopped', { reaction: reply.reaction, input, lorebook: context?.lorebook })
                reason = '직접 중지했습니다.'
                break
            }
            if (outcome === 'failed' || last?.role !== 'char' || !last.data.trim()) {
                await finish('failed', { reaction: reply.reaction, input, lorebook: context?.lorebook, note: '봇 응답을 받지 못했거나 빈 응답이었습니다.' })
                reason = '봇 응답을 받지 못했습니다.'
                break
            }
            await finish('done', { reaction: reply.reaction, input, lorebook: context?.lorebook ?? [] })
            completed = turn
            expectedLength = after.message.length
        }
    }
    catch (cause) {
        if (cause instanceof PlayStop || signal.aborted) reason = '직접 중지했습니다.'
        else {
            reason = `오류가 났습니다. ${cause instanceof Error ? cause.message : String(cause)}`
            console.error('[Character Assistant play]', cause)
        }
    }
    finally {
        unwatchChatContext(target.chatId)
        decide = null
        controller = null
        characterAssistantPlay.set(null)
        void requestImmediateSave()
    }
    return { completedTurns: completed, total, reason }
}
