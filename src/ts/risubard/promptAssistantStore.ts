// Storage and request runtime for the Prompt Assistant dock. Projects live in
// their own KV keys, outside database.bin, so a long assistant conversation
// never grows the main save.

import { v4 } from 'uuid'
import { getDatabase, getActiveBotPresetId, getBotPresetById, type Chat, type character } from '../storage/database.svelte'
import { readPersistentJson, removePersistentKey, writePersistentJson } from '../storage/persistentKv'
import { requestChatData } from '../process/request/request'
import { fetchRequestLogs, requestLogEnabled } from '../requestLog'
import { getUserName } from '../util'
import {
    buildPromptAssistantMessages,
    compactRequestBody,
    createPromptAssistantProject,
    formatChatLogForAssistant,
    normalizePromptAssistantIndex,
    normalizePromptAssistantProject,
    serializePresetForAssistant,
    summarizePromptAssistantProject,
    type PromptAssistantChatLine,
    type PromptAssistantIndex,
    type PromptAssistantMessage,
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
    }
    await writePersistentJson(INDEX_KEY, next)
    await removePersistentKey(projectKey(id))
    return next
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

export interface PromptAssistantSendInput {
    project: PromptAssistantProject
    userText: string
    preset: PromptAssistantPresetSource
    chatLines: PromptAssistantChatLine[]
    sentRequest?: string
    currentCharacter?: character
    signal: AbortSignal
    onText: (text: string) => void
}

export async function sendPromptAssistant(input: PromptAssistantSendInput): Promise<string> {
    const formated = buildPromptAssistantMessages({
        preset: serializePresetForAssistant(input.preset),
        chatLog: formatChatLogForAssistant(input.chatLines),
        sentRequest: input.sentRequest,
        history: input.project.messages,
        userText: input.userText,
    })
    const response = await requestChatData({
        formated,
        bias: {},
        currentChar: input.currentCharacter,
        useStreaming: true,
        noMultiGen: true,
        tools: [],
        disablePromptCache: true,
        logSource: 'other',
        logPurpose: 'prompt-assistant',
    }, input.project.model, input.signal)
    if (response.type === 'multiline') throw new Error('지원하지 않는 응답 형식입니다.')
    if (response.type !== 'streaming') {
        if (response.type === 'fail') throw new Error(response.result || '응답을 받지 못했습니다.')
        input.onText(response.result)
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
                input.onText(text)
            }
        }
    }
    finally {
        reader.releaseLock()
    }
    return text
}

export function createPromptAssistantMessage(
    role: PromptAssistantMessage['role'],
    text: string,
    extra: Partial<PromptAssistantMessage> = {},
): PromptAssistantMessage {
    return { id: v4(), role, text, createdAt: Date.now(), ...extra }
}
