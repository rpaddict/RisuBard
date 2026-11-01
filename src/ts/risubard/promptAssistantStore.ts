// Storage and request runtime for the Prompt Assistant dock. Projects live in
// their own KV keys, outside database.bin, so a long assistant conversation
// never grows the main save.

import { v4 } from 'uuid'
import { getDatabase, getActiveBotPresetId, getBotPresetById, type Chat, type character } from '../storage/database.svelte'
import { readPersistentJson, removePersistentKey, writePersistentJson } from '../storage/persistentKv'
import { requestChatData } from '../process/request/request'
import { fetchRequestLogs, requestLogEnabled } from '../requestLog'
import { getUserName } from '../util'
import { resolveAssistantPrompt } from './assistantPrompts'
import {
    blocksToReread,
    buildPromptAssistantMessages,
    buildPromptAssistantSelectionMessages,
    compactRequestBody,
    createPromptAssistantProject,
    diffPresetFingerprint,
    fingerprintPreset,
    forkPromptAssistantMessages,
    formatChatLogForAssistant,
    formatPresetChangeNotice,
    normalizePromptAssistantIndex,
    normalizePromptAssistantProject,
    parseBlockSelection,
    resolveSentBlocks,
    serializePresetForAssistant,
    summarizePromptAssistantProject,
    type PresetFingerprint,
    type PromptAssistantChatLine,
    type PromptAssistantIndex,
    type PromptAssistantMessage,
    type PromptAssistantModel,
    type PromptAssistantPresetSource,
    type PromptAssistantProject,
} from './promptAssistant'

const INDEX_KEY = 'risubard/prompt-assistant/index.json'
const projectKey = (id: string) => `risubard/prompt-assistant/projects/${encodeURIComponent(id)}.json`

export async function loadPromptAssistantIndex(): Promise<PromptAssistantIndex> {
    return normalizePromptAssistantIndex(await readPersistentJson(INDEX_KEY))
}

export async function loadPromptAssistantProject(id: string): Promise<PromptAssistantProject | null> {
    return normalizePromptAssistantProject(await readPersistentJson(projectKey(id)))
}

/** Writes the project first so the index never lists a project that is missing. */
export async function savePromptAssistantProject(
    project: PromptAssistantProject,
    index: PromptAssistantIndex,
): Promise<PromptAssistantIndex> {
    project.updatedAt = Date.now()
    await writePersistentJson(projectKey(project.id), project)
    const summary = summarizePromptAssistantProject(project)
    const next: PromptAssistantIndex = {
        version: 1,
        projects: [summary, ...index.projects.filter((item) => item.id !== project.id)],
        lastProjectId: project.id,
        model: index.model,
    }
    await writePersistentJson(INDEX_KEY, next)
    return next
}

export async function rememberPromptAssistantProject(
    id: string,
    index: PromptAssistantIndex,
): Promise<PromptAssistantIndex> {
    const next = { ...index, lastProjectId: id }
    await writePersistentJson(INDEX_KEY, next)
    return next
}

export async function deletePromptAssistantProject(
    id: string,
    index: PromptAssistantIndex,
): Promise<PromptAssistantIndex> {
    const projects = index.projects.filter((item) => item.id !== id)
    const next: PromptAssistantIndex = {
        version: 1,
        projects,
        lastProjectId: index.lastProjectId === id ? projects[0]?.id : index.lastProjectId,
        model: index.model,
    }
    await writePersistentJson(INDEX_KEY, next)
    await removePersistentKey(projectKey(id))
    return next
}

export async function savePromptAssistantModel(
    model: PromptAssistantModel,
    index: PromptAssistantIndex,
): Promise<PromptAssistantIndex> {
    const next = { ...index, model }
    await writePersistentJson(INDEX_KEY, next)
    return next
}

/** A new project with the source's settings and the conversation up to the chosen message. */
export function forkPromptAssistantProject(
    source: PromptAssistantProject,
    messageId: string,
): { project: PromptAssistantProject; draft: string } | null {
    const fork = forkPromptAssistantMessages(source.messages, messageId)
    if (!fork) return null
    const project = createPromptAssistantProject(v4(), `${source.name} (포크)`, source.presetId)
    project.chatMessages = source.chatMessages
    project.includeRequest = source.includeRequest
    project.sendFullPreset = source.sendFullPreset
    // The copied replies describe the preset as the source last sent it.
    project.presetFingerprint = source.presetFingerprint ? structuredClone(source.presetFingerprint) : undefined
    project.messages = fork.messages
    return { project, draft: fork.draft }
}

export function newPromptAssistantProject(name: string, presetId: string): PromptAssistantProject {
    return createPromptAssistantProject(v4(), name, presetId)
}

export interface PromptAssistantPresetOption {
    id: string
    name: string
    active: boolean
}

export function listPromptAssistantPresets(): PromptAssistantPresetOption[] {
    const db = getDatabase()
    const activeId = getActiveBotPresetId()
    return (db.botPresets ?? [])
        .filter((preset) => !!preset?.id)
        .map((preset) => ({ id: preset.id!, name: preset.name || '이름 없음', active: preset.id === activeId }))
}

/**
 * The active preset is edited through the top-level database fields and only
 * copied into botPresets when another preset is selected, so read it there.
 */
export function resolvePromptAssistantPreset(presetId: string): PromptAssistantPresetSource | null {
    const preset = getBotPresetById(presetId)
    if (!preset) return null
    if (presetId === getActiveBotPresetId()) {
        const db = getDatabase()
        return {
            name: preset.name,
            promptTemplate: db.promptTemplate,
            customPromptTemplateToggle: db.customPromptTemplateToggle,
            mainPrompt: db.mainPrompt,
            jailbreak: db.jailbreak,
            globalNote: db.globalNote,
        }
    }
    return {
        name: preset.name,
        promptTemplate: preset.promptTemplate,
        customPromptTemplateToggle: preset.customPromptTemplateToggle,
        mainPrompt: preset.mainPrompt,
        jailbreak: preset.jailbreak,
        globalNote: preset.globalNote,
    }
}

export function collectPromptAssistantChatLines(
    currentCharacter: character,
    chat: Chat,
    count: number,
): PromptAssistantChatLine[] {
    if (count <= 0) return []
    const userName = getUserName({ character: currentCharacter, chat })
    return chat.message.slice(-count).map((message) => ({
        role: message.role,
        name: message.role === 'user' ? userName : (message.name || currentCharacter.name),
        text: message.data,
    }))
}

export type SentRequestLookup =
    | { status: 'found'; text: string }
    | { status: 'disabled' | 'missing' }

/** Latest AI reply's real request, from the request log. */
export async function findLatestSentRequest(chat: Chat): Promise<SentRequestLookup> {
    if (!requestLogEnabled()) return { status: 'disabled' }
    for (let i = chat.message.length - 1; i >= 0; i--) {
        const message = chat.message[i]
        if (message.role !== 'char') continue
        const generationId = message.generationInfo?.generationId
        if (!generationId) continue
        const rows = await fetchRequestLogs({ chatId: generationId, limit: 1, bodies: true })
        const body = rows[0]?.requestBody
        return body ? { status: 'found', text: compactRequestBody(body) } : { status: 'missing' }
    }
    return { status: 'missing' }
}

export type PromptAssistantStage =
    | { step: 'select' }
    | { step: 'answer'; blocks: number[] | 'all' }

export interface PromptAssistantSendInput {
    project: PromptAssistantProject
    model: PromptAssistantModel
    userText: string
    preset: PromptAssistantPresetSource
    chatLines: PromptAssistantChatLine[]
    sentRequest?: string
    currentCharacter?: character
    signal: AbortSignal
    onText: (text: string) => void
    onStage?: (stage: PromptAssistantStage) => void
}

export interface PromptAssistantSendResult {
    text: string
    /** Block bodies the answer was given. */
    blocks: number[] | 'all'
    /** Save on the project after a successful reply; the next send diffs against it. */
    fingerprint: PresetFingerprint
}

async function requestAssistantText(
    formated: ReturnType<typeof buildPromptAssistantMessages>,
    input: PromptAssistantSendInput,
    streaming: boolean,
): Promise<string> {
    const response = await requestChatData({
        formated,
        bias: {},
        currentChar: input.currentCharacter,
        useStreaming: streaming,
        noMultiGen: true,
        tools: [],
        disablePromptCache: true,
        logSource: 'other',
        logPurpose: 'prompt-assistant',
    }, input.model, input.signal)
    if (response.type === 'multiline') throw new Error('지원하지 않는 응답 형식입니다.')
    if (response.type !== 'streaming') {
        if (response.type === 'fail') throw new Error(response.result || '응답을 받지 못했습니다.')
        if (streaming) input.onText(response.result)
        return response.result
    }
    const reader = response.result.getReader()
    let text = ''
    try {
        while (true) {
            const { done, value } = await reader.read()
            if (done) break
            if (value && typeof value['0'] === 'string') {
                text = value['0']
                if (streaming) input.onText(text)
            }
        }
    }
    finally {
        reader.releaseLock()
    }
    return text
}

/**
 * One turn. Unless the project always sends the whole preset, a first request
 * shows only the block index and asks which bodies the answer needs; the
 * answer request then carries those bodies, any blocks changed since the last
 * send, and the index for the rest. A change notice goes in front of the
 * question whenever the preset differs from the last successful send.
 */
export async function sendPromptAssistant(input: PromptAssistantSendInput): Promise<PromptAssistantSendResult> {
    const fingerprint = fingerprintPreset(input.project.presetId, input.preset)
    const change = diffPresetFingerprint(input.project.presetFingerprint, fingerprint)
    const notice = change ? formatPresetChangeNotice(change) : undefined
    const chatLog = formatChatLogForAssistant(input.chatLines)
    const history = input.project.messages
    const blockCount = Array.isArray(input.preset.promptTemplate) ? input.preset.promptTemplate.length : 0
    let blocks: number[] | 'all' = 'all'
    if (!input.project.sendFullPreset && blockCount > 0) {
        input.onStage?.({ step: 'select' })
        const selection = await requestAssistantText(buildPromptAssistantSelectionMessages({
            systemPrompt: resolveAssistantPrompt(getDatabase().risuBardAssistantPrompts, 'promptAssistantSelect'),
            preset: serializePresetForAssistant(input.preset, { include: new Set(), preview: true }),
            chatLog,
            history,
            userText: input.userText,
            notice,
        }), input, false)
        blocks = resolveSentBlocks(parseBlockSelection(selection, blockCount), blocksToReread(change), blockCount)
    }
    input.onStage?.({ step: 'answer', blocks })
    const text = await requestAssistantText(buildPromptAssistantMessages({
        systemPrompt: resolveAssistantPrompt(getDatabase().risuBardAssistantPrompts, 'promptAssistant'),
        preset: serializePresetForAssistant(input.preset, blocks === 'all' ? {} : { include: new Set(blocks) }),
        chatLog,
        sentRequest: input.sentRequest,
        history,
        userText: input.userText,
        notice,
    }), input, true)
    return { text, blocks, fingerprint }
}

export function createPromptAssistantMessage(
    role: PromptAssistantMessage['role'],
    text: string,
    extra: Partial<PromptAssistantMessage> = {},
): PromptAssistantMessage {
    return { id: v4(), role, text, createdAt: Date.now(), ...extra }
}
