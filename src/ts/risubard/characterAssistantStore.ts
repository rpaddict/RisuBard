// Storage and request runtime for the Character Assistant dock. Projects live
// in their own KV keys, outside database.bin, like the Prompt Assistant's.

import { v4 } from 'uuid'
import {
    getActiveBotPresetId,
    getActivePromptOverlayToggleTemplate,
    getBotPresetById,
    getDatabase,
    snapshotCurrentToggleValues,
    type character,
} from '../storage/database.svelte'
import { readPersistentJson, removePersistentKey, writePersistentJson } from '../storage/persistentKv'
import { requestChatData } from '../process/request/request'
import { parseAssistantEdits, stripAssistantEdits, type ParsedAssistantEdit } from './characterAssistantEdits'
import { getModules } from '../process/modules'
import { parseToggleSyntax } from '../util'
import { formatChatLogForAssistant, type PromptAssistantChatLine } from './promptAssistant'
import { forkAssistantMessages } from './assistantChat'
import { resolveAssistantPrompt } from './assistantPrompts'
import { collectPromptAssistantChatLines } from './promptAssistantStore'
import {
    addPins,
    buildAssistantScopes,
    buildCharacterAssistantMessages,
    CHARACTER_ASSISTANT_MAX_LOOKUP_ROUNDS,
    createCharacterAssistantProject,
    findSection,
    formatMaterial,
    formatScopeIndex,
    formatSearchResult,
    isPinCovered,
    normalizeCharacterAssistantIndex,
    normalizeCharacterAssistantProject,
    parseAssistantLookups,
    searchSections,
    sectionLineCounter,
    stripAssistantLookups,
    summarizeCharacterAssistantProject,
    type AssistantPin,
    type AssistantScope,
    type CharacterAssistantIndex,
    type CharacterAssistantMessage,
    type CharacterAssistantProject,
    type CharacterAssistantMaterialSource,
} from './characterAssistant'

const INDEX_KEY = 'risubard/character-assistant/index.json'
const projectKey = (id: string) => `risubard/character-assistant/projects/${encodeURIComponent(id)}.json`

export async function loadCharacterAssistantIndex(): Promise<CharacterAssistantIndex> {
    return normalizeCharacterAssistantIndex(await readPersistentJson(INDEX_KEY))
}

export async function loadCharacterAssistantProject(id: string): Promise<CharacterAssistantProject | null> {
    return normalizeCharacterAssistantProject(await readPersistentJson(projectKey(id)))
}

/** Writes the project first so the index never lists a project that is missing. */
export async function saveCharacterAssistantProject(
    project: CharacterAssistantProject,
    index: CharacterAssistantIndex,
): Promise<CharacterAssistantIndex> {
    project.updatedAt = Date.now()
    await writePersistentJson(projectKey(project.id), project)
    const next: CharacterAssistantIndex = {
        version: 1,
        projects: [summarizeCharacterAssistantProject(project), ...index.projects.filter((item) => item.id !== project.id)],
        lastProjectId: project.id,
    }
    await writePersistentJson(INDEX_KEY, next)
    return next
}

/**
 * Adds one message to a stored project without touching the index. Play mode
 * writes turns this way, so it does not depend on the dock being open.
 */
export async function appendCharacterAssistantMessage(projectId: string, message: CharacterAssistantMessage): Promise<void> {
    const project = await loadCharacterAssistantProject(projectId)
    if (!project) throw new Error('프로젝트 파일을 찾지 못했습니다.')
    if (project.messages.some((item) => item.id === message.id)) return
    project.messages.push(message)
    project.updatedAt = Date.now()
    await writePersistentJson(projectKey(project.id), project)
}

export async function rememberCharacterAssistantProject(
    id: string,
    index: CharacterAssistantIndex,
): Promise<CharacterAssistantIndex> {
    const next = { ...index, lastProjectId: id }
    await writePersistentJson(INDEX_KEY, next)
    return next
}

export async function deleteCharacterAssistantProject(
    id: string,
    index: CharacterAssistantIndex,
): Promise<CharacterAssistantIndex> {
    const projects = index.projects.filter((item) => item.id !== id)
    const next: CharacterAssistantIndex = {
        version: 1,
        projects,
        lastProjectId: index.lastProjectId === id ? projects[0]?.id : index.lastProjectId,
    }
    await writePersistentJson(INDEX_KEY, next)
    await removePersistentKey(projectKey(id))
    return next
}

/** A new project with the source's settings, materials and the conversation up to the chosen message. */
export function forkCharacterAssistantProject(
    source: CharacterAssistantProject,
    messageId: string,
): { project: CharacterAssistantProject; draft: string } | null {
    const fork = forkAssistantMessages(source.messages, messageId)
    if (!fork) return null
    const project = createCharacterAssistantProject(v4(), `${source.name} (포크)`, source.characterId, source.characterName)
    project.referenceId = source.referenceId
    project.includeModules = source.includeModules
    project.includePreset = source.includePreset
    project.model = source.model
    project.chatMessages = source.chatMessages
    project.pins = structuredClone(source.pins)
    project.messages = fork.messages
    return { project, draft: fork.draft }
}

export function newCharacterAssistantProject(name: string, target: character): CharacterAssistantProject {
    return createCharacterAssistantProject(v4(), name, target.chaId, target.name)
}

export interface AssistantCharacterOption {
    chaId: string
    name: string
    index: number
}

/** Bots the assistant may read. Private-license bots hide their content, so they are left out. */
export function listAssistantCharacters(): AssistantCharacterOption[] {
    return getDatabase().characters
        .map((item, index) => ({ item, index }))
        .filter(({ item }) => item && item.license !== 'private')
        .map(({ item, index }) => ({ chaId: item.chaId, name: item.name || '이름 없음', index }))
}

export function findAssistantCharacter(chaId: string): { character: character; index: number } | null {
    if (!chaId) return null
    const characters = getDatabase().characters
    const index = characters.findIndex((item) => item?.chaId === chaId)
    const found = characters[index]
    if (!found || found.license === 'private') return null
    return { character: found, index }
}

function characterToggleKeys(target: character): string[] {
    const keys: string[] = []
    const walk = (items: ReturnType<typeof parseToggleSyntax>) => {
        for (const item of items) {
            if ('children' in item && Array.isArray(item.children)) walk(item.children)
            if ('key' in item && typeof item.key === 'string' && item.key) keys.push(`toggle_${item.key}`)
        }
    }
    walk(parseToggleSyntax(target.customModuleToggle ?? ''))
    return keys
}

function currentToggleValues(target: character): Record<string, string> {
    const db = getDatabase()
    const chat = target.chats?.[target.chatPage]
    const values = snapshotCurrentToggleValues(db, target, chat)
    for (const key of characterToggleKeys(target)) {
        if (key in values) continue
        const local = !db.disableToggleBinding && chat?.useLocallySetGlobalVariables && chat.GLGlobalVariables
            && Object.hasOwn(chat.GLGlobalVariables, key)
        values[key] = (local ? chat.GLGlobalVariables[key] : db.globalChatVariables[key]) ?? ''
    }
    return values
}

/** The material for one send, read fresh so edits made between turns are seen. */
export function collectCharacterAssistantSource(project: CharacterAssistantProject): CharacterAssistantMaterialSource | null {
    const target = findAssistantCharacter(project.characterId)?.character
    if (!target) return null
    const reference = project.referenceId && project.referenceId !== project.characterId
        ? findAssistantCharacter(project.referenceId)?.character
        : undefined
    const source: CharacterAssistantMaterialSource = { bot: target, reference }
    if (project.includeModules) {
        source.modules = getModules({ character: target, chat: target.chats?.[target.chatPage] }).filter(Boolean)
    }
    if (project.includePreset) {
        const db = getDatabase()
        const preset = getBotPresetById(getActiveBotPresetId())
        source.preset = {
            name: preset?.name,
            promptTemplate: db.promptTemplate,
            customPromptTemplateToggle: getActivePromptOverlayToggleTemplate(db),
            mainPrompt: db.mainPrompt,
            jailbreak: db.jailbreak,
            globalNote: db.globalNote,
            toggleValues: currentToggleValues(target),
        }
    }
    return source
}

export function collectCharacterAssistantChatLines(project: CharacterAssistantProject): PromptAssistantChatLine[] {
    const target = findAssistantCharacter(project.characterId)?.character
    const chat = target?.chats?.[target.chatPage]
    if (!target || !chat || project.chatMessages <= 0) return []
    return collectPromptAssistantChatLines(target, chat, project.chatMessages)
}

/** The text that goes into the system turn before any lookups, for the token estimate. */
export function describeCharacterAssistantMaterial(scopes: AssistantScope[], pins: AssistantPin[]): { indexes: string[]; materials: string[] } {
    return {
        indexes: scopes.map(formatScopeIndex),
        materials: pins.flatMap((pin) => {
            const section = findSection(scopes, pin.ref)
            return section ? [formatMaterial(section, pin.lines)] : []
        }),
    }
}

export interface CharacterAssistantSendInput {
    project: CharacterAssistantProject
    userText: string
    source: CharacterAssistantMaterialSource
    chatLines: PromptAssistantChatLine[]
    signal: AbortSignal
    onText: (text: string) => void
    /** Called when the assistant asked for material, with the labels being read. */
    onLookup: (labels: string[], pins: AssistantPin[]) => void
}

export interface CharacterAssistantSendResult {
    reply: string
    pins: AssistantPin[]
    lookups: string[]
    /** <edit> tags of the final reply, removed from `reply`. */
    edits: ParsedAssistantEdit[]
    /** The last reply only asked for material it could not get. */
    stalled?: boolean
}

export async function requestOnce(
    project: Pick<CharacterAssistantProject, 'model'>,
    formated: ReturnType<typeof buildCharacterAssistantMessages>,
    signal: AbortSignal,
    onText: (text: string) => void,
): Promise<string> {
    const response = await requestChatData({
        formated,
        bias: {},
        useStreaming: true,
        noMultiGen: true,
        tools: [],
        disablePromptCache: true,
        logSource: 'other',
        logPurpose: 'character-assistant',
    }, project.model, signal)
    if (response.type === 'multiline') throw new Error('지원하지 않는 응답 형식입니다.')
    if (response.type !== 'streaming') {
        if (response.type === 'fail') throw new Error(response.result || '응답을 받지 못했습니다.')
        onText(response.result)
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
                onText(text)
            }
        }
    }
    finally {
        reader.releaseLock()
    }
    return text
}

/**
 * Sends one user turn. When the assistant answers with <read>/<search> tags,
 * the runtime pins the sections, runs the searches, and asks again. The last
 * of CHARACTER_ASSISTANT_MAX_LOOKUP_ROUNDS + 1 requests tells the model that
 * no lookups are left, so a turn ends in an answer instead of a lookup.
 */
export async function sendCharacterAssistant(input: CharacterAssistantSendInput): Promise<CharacterAssistantSendResult> {
    const scopes = buildAssistantScopes(input.source)
    const indexes = scopes.map(formatScopeIndex)
    const lineCount = sectionLineCounter(scopes)
    const chatLog = formatChatLogForAssistant(input.chatLines)
    let pins = [...input.project.pins]
    const lookups: string[] = []
    const lookupLabels: string[] = []
    const searched = new Set<string>()
    const reported = new Set<string>()
    for (let round = 0; ; round++) {
        const finalRound = round >= CHARACTER_ASSISTANT_MAX_LOOKUP_ROUNDS
        const { materials } = describeCharacterAssistantMaterial(scopes, pins)
        const formated = buildCharacterAssistantMessages({
            systemPrompt: resolveAssistantPrompt(getDatabase().risuBardAssistantPrompts, 'characterAssistant'),
            indexes,
            materials,
            lookups,
            chatLog,
            history: input.project.messages,
            userText: input.userText,
            finalRound,
        })
        const text = await requestOnce(input.project, formated, input.signal, input.onText)
        // A stopped reply keeps its prose but not half-written edits.
        if (input.signal.aborted) return { reply: stripAssistantEdits(stripAssistantLookups(text)), pins, lookups: lookupLabels, edits: [] }
        const requested = parseAssistantLookups(text)
        const reply = stripAssistantEdits(stripAssistantLookups(text))
        const asked = requested.reads.length + requested.searches.length > 0
        if (finalRound || !asked) {
            const edits = parseAssistantEdits(text)
            return { reply, pins, lookups: lookupLabels, edits, stalled: !reply && asked && edits.length === 0 }
        }
        const found = requested.reads.filter((pin) => findSection(scopes, pin.ref))
        const reads = found.filter((pin) => !isPinCovered(pins, pin, lineCount))
        const repeated = found.length - reads.length
        const missing = requested.reads.filter((pin) => !findSection(scopes, pin.ref) && !reported.has(pin.ref))
        const searches = requested.searches.filter((query) => !searched.has(query))
        const labels: string[] = []
        if (reads.length > 0) {
            pins = addPins(pins, reads, lineCount)
            for (const pin of reads) {
                const label = findSection(scopes, pin.ref)!.label
                labels.push(pin.lines ? `${label} ${pin.lines[0]}-${pin.lines[1]}줄` : label)
            }
        }
        for (const query of searches) {
            searched.add(query)
            lookups.push(formatSearchResult(query, searchSections(scopes, query)))
            labels.push(`"${query}" 검색`)
        }
        for (const pin of missing) {
            reported.add(pin.ref)
            lookups.push(`<missing ref="${pin.ref.replaceAll('"', "'")}">목차에 없는 ref다. 목차의 ref만 쓴다.</missing>`)
        }
        // Asking again for what is already in <material> would loop; say so once.
        if (repeated > 0 && reads.length === 0 && searches.length === 0 && missing.length === 0) {
            lookups.push('<already_read>요청한 자료는 이미 위 <material>에 있다. 다시 요청하지 말고 그 자료로 답한다.</already_read>')
        }
        lookupLabels.push(...labels)
        input.onLookup(labels, pins)
    }
}

export function createCharacterAssistantMessage(
    role: CharacterAssistantMessage['role'],
    text: string,
    extra: Partial<CharacterAssistantMessage> = {},
): CharacterAssistantMessage {
    return { id: v4(), role, text, createdAt: Date.now(), ...extra }
}
