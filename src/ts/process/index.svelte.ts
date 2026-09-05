import { get } from "svelte/store";
import { type character, type MessageGenerationInfo, type Chat, type MessagePresetInfo, changeToPreset, setCurrentChat, type Message, normalizeChat, type StreamingDisplayOptimizationMode } from "../storage/database.svelte";
import { DBState } from '../stores.svelte';
import { CharEmotion, selectedCharID } from "../stores.svelte";
import { ChatTokenizer, tokenize, tokenizeNum } from "../tokenizer";
import { language } from "../../lang";
import { alertError, notifyError } from "../alert";
import { parseChatML } from "../parser/chatML";
import { loadLoreBookV3Prompt } from "./lorebook.svelte";
import { findCharacterbyId, getAuthorNoteDefaultText, getPersonaPrompt, getUserName, isLastCharPunctuation, trimUntilPunctuation, parseToggleSyntax, prebuiltAssetCommand } from "../util";
import { requestChatData } from "./request/request";
import { getPartialPresetStreamText } from './request/presetStreamPump';
import { stableDiff } from "./stableDiff";
import { processScript, processScriptFull, risuChatParser } from "./scripts";
import { getGlobalChatVar } from "../parser/chatVar.svelte";
import { exampleMessage } from "./exampleMessages";
import { sayTTS } from "./tts";
import { v4 } from "uuid";
import { runTrigger } from "./triggers";
import { HypaProcesser } from "./memory/hypamemory";
import { additionalInformations } from "./embedding/addinfo";
import { getInlayAsset } from "./files/inlays";
import { getGenerationModelString } from "./models/modelString";
import { runInlayScreen } from "./inlayScreen";
import { runImageEmbedding } from "./transformers";
import { runLuaEditTrigger } from "./scriptings";
import { pluginV2 } from "../plugins/plugins.svelte";
import { dispatchCommittedChatOutput } from "../plugins/pluginChatOutput";
import { getModelInfo, LLMFlags } from "../model/modellist";
import { resolveChatModelBinding, resolvePresetMaxOutputTokens } from "./request/modelPresetBinding";
import { hypaMemoryV3 } from "./memory/hypav3";
import { getModuleAssets, getModuleLorebooksWithSources, getModuleToggles } from "./modules";
import { forageStorage, readImage } from "../globalApi.svelte";
import { chatGenKey, chatProcessStage, endGeneration, isChatGenerating, setGenerationStage, startGeneration } from "./generationState";
import { clearPendingSend, registerPendingSend } from "./request/pendingSends";
import {
    createStoredResponseMemoryAnalysis,
    projectConfirmedMemoryTurn,
    projectMemoryAnalysisEvidence,
    projectRecentMemoryMessages,
    type MemoryAnalysisMessage,
} from "../risubard/memoryAnalysisClient";
import { projectActiveNarrativeSources } from "../risubard/sourceProjection";
import {
    detectChatWritingLanguage,
    normalizeWikiWritingLanguage,
} from "../risubard/wikiWritingLanguage";
import {
    createNarrativeSourcesPrompt,
    isNarrativeContextOptedIn,
    loadNarrativeInquiry,
    mergeNarrativeContextWithStaticPrompt,
    ensureNarrativeSessionChatId,
    normalizeNarrativeWorkingMessageLimit,
    selectPromptedNarrativeSources,
    selectNarrativeWorkingMessages,
    shouldIncludeNarrativeFirstMessage,
} from "../risubard/narrativeContext";
import {
    createRisuBardContextTrace,
    publishRisuBardMemoryActivity,
    traceRecentMessagesFromPrompt,
} from '../risubard/memoryActivity';
import {
    type RequestInjectionKind,
    type RequestInjectionSource,
} from '../status/requestStatus';
import {
    beginBardChatUndo,
    finalizeBardChatUndo,
    loadNarrativeMemoryWiki,
    retractWikiEvent,
    saveManualWikiDocument,
    trashWikiDocument,
} from '../risubard/memoryWiki';
import { announceRisuBardMemoryUpdated } from '../risubard/memoryEvents';
import {
    executeDirectWikiCommand,
    type DirectWikiContextSelection,
    type DirectWikiContextSources,
    type DirectWikiCommandResult,
} from '../risubard/directWikiCommand';
import {
    collectPersonaBuilderSources,
    matchPersonaBuilderCharacterLorebook,
} from '../personaBuilder';
import { shouldAutomaticallyConfirmNarrativeTurn } from '../risubard/automaticWikiConfirmation';
import {
    compileWikiPromptGuide,
    resolveWikiPromptPreset,
} from '../risubard/wikiPromptPreset';
import { resolveRisuBardChatSettings } from '../risubard/risuBardSettings';
import {
    findHistoricalSourceMatches,
    resolveHistoricalSourceMatchesById,
} from '../risubard/historicalSourceRecall';
import { normalizeArcPlotterRuntimeSettings } from '../risubard/arcPlotterSettings';
import {
    canonicalTurnNeedsRetry,
    canonicalTurnRetryWarning,
} from '../risubard/canonicalTurnReceipt';
import { saveChatToServer } from '../storage/chatStorage';
import {
    createWikiRebootJob,
    nextWikiRebootBatch,
    projectWikiRebootTurns,
    type WikiRebootBatchSize,
    type WikiRebootTurn,
} from '../risubard/wikiReboot';
import {
    cleanupWikiRebootWorkspace,
    completeWikiRebootBatch,
    prepareWikiRebootReplacement,
    recoverWikiRebootBatch,
} from '../risubard/wikiRebootTransport';
import { completeMemoryWikiFork } from '../risubard/memoryWikiFork';
import {
    beginWikiGeneration,
    endWikiGeneration,
    isWikiGenerating,
} from '../risubard/wikiGenerationState';

function resolvedRisuBardSettings(chat?: Chat) {
    const settings = resolveRisuBardChatSettings(DBState.db, chat?.risuBardSettings)
    if (settings.risuBardWikiLanguageSync
        && chat?.risuBardSettings?.risuBardWikiWritingLanguage === undefined
        && chat?.message?.length) {
        // The help text promises the recent chat window, not the whole
        // history, and a per-chat language override wins over the sync.
        const recentWindow = Math.max(
            normalizeNarrativeWorkingMessageLimit(
                settings.risuBardResponseMessageCount
            ),
            4,
        )
        const detected = detectChatWritingLanguage(
            chat.message.slice(-recentWindow * 2)
                .filter((message) => typeof message.data === 'string'
                    && (message.data as string).trim().length > 0)
                .map((message) => message.data as string)
        )
        if (detected) settings.risuBardWikiWritingLanguage = detected
    }
    settings.risuBardWikiWritingLanguage = normalizeWikiWritingLanguage(
        settings.risuBardWikiWritingLanguage
    )
    return settings
}

function resolvedArcPlotterSettings() {
    return normalizeArcPlotterRuntimeSettings({
        enabled: DBState.db.risuBardArcPlotterEnabled,
        checkpointSize: DBState.db.risuBardArcPlotterCheckpointSize,
        maxArcs: DBState.db.risuBardArcPlotterMaxArcs,
        maxTurningPoints: DBState.db.risuBardArcPlotterMaxTurningPoints,
        maxOpenThreads: DBState.db.risuBardArcPlotterMaxOpenThreads,
        maxCharacters: DBState.db.risuBardArcPlotterMaxCharacters,
    })
}

function findRisuBardChat(chatId?: string): Chat | undefined {
    if (!chatId) return undefined
    return DBState.db.characters.flatMap((character) => character.chats)
        .find((chat) => chat.id === chatId)
}

async function resolveNarrativeFirstMessageEvidence(
    character: character,
    chat: Chat,
    chatId: string,
): Promise<MemoryAnalysisMessage | undefined> {
    if (chat.firstMessageDisabled) return undefined
    const greetingIndex = chat.fmIndex ?? -1
    const source = greetingIndex === -1
        ? character.firstMessage
        : character.alternateGreetings[greetingIndex]
    if (typeof source !== 'string' || source.trim().length === 0) {
        return undefined
    }
    const content = await processScript(
        character,
        risuChatParser(source, { chara: character }),
        'editprocess'
    )
    if (content.trim().length === 0) return undefined
    return {
        messageId: `first-message:${chatId}:${greetingIndex}`,
        role: 'assistant',
        content,
    }
}

function boundedMemoryAnalysisError(error: unknown): string {
    const base = error instanceof Error
        ? `${error.name}: ${error.message}`
        : String(error)
    const validationHint = typeof error === 'object' && error !== null
        && typeof (error as { validationHint?: unknown }).validationHint === 'string'
        ? (error as { validationHint: string }).validationHint
        : ''
    return [base, validationHint]
        .filter(Boolean)
        .join(' · ')
        .replace(/\s+/gu, ' ')
        .trim()
        .slice(0, 1024)
}

const storedResponseMemoryAnalysis = createStoredResponseMemoryAnalysis({
    requestModel: requestChatData,
    fetchImpl: fetch,
    createAuth: () => forageStorage.createAuth(),
    getModelMode: (chatId) =>
        resolvedRisuBardSettings(findRisuBardChat(chatId)).risuBardModelMode,
    onError(error) {
        const reason = boundedMemoryAnalysisError(error) || '알 수 없는 오류'
        console.warn(`[RisuBard memory analysis] ${reason}`)
    },
    nativeV2Analysis: true,
})
const narrativeConfirmations = new Set<string>()

async function confirmProjectedNarrativeTurn(input: {
    characterId: string
    chatId: string
    targetMessageId: string
    messages: readonly MemoryAnalysisMessage[]
    additionalAnalysis?: boolean
    excludeCanonicalDocumentIds?: readonly string[]
}): Promise<boolean> {
    const key = JSON.stringify([
        input.characterId,
        input.chatId,
        input.targetMessageId,
    ])
    if (narrativeConfirmations.has(key)) return false
    narrativeConfirmations.add(key)
    const generationOperation = `analysis:${key}`
    const generationSignal = beginWikiGeneration(generationOperation)
    try {
        const character = DBState.db.characters.find(
            (item) => item.chaId === input.characterId
        )
        const chat = character?.chats.find(
            (item) => item.id === input.chatId
        )
        const settings = resolvedRisuBardSettings(chat)
        const wikiPromptPreset = resolveWikiPromptPreset(
            DBState.db.risuBardWikiPromptPresets,
            DBState.db.risuBardChatWikiPromptPresetId
        )
        const compiledWikiPromptGuide = wikiPromptPreset
            ? compileWikiPromptGuide(wikiPromptPreset, {
                characterGuide: risuChatParser(character?.risuBardWikiGuide ?? '', {
                    chara: character,
                }),
                chatGuide: risuChatParser(chat?.risuBardWikiGuide ?? '', {
                    chara: character,
                }),
            })
            : undefined
        const firstMessageEvidence = character && chat
            ? await resolveNarrativeFirstMessageEvidence(
                character,
                chat,
                input.chatId
            )
            : undefined
        const contextMessages = chat
            ? projectRecentMemoryMessages(
                chat.message,
                normalizeNarrativeWorkingMessageLimit(
                    settings.risuBardRecentMessageCount
                ),
                input.targetMessageId,
                firstMessageEvidence
            )
            : [...input.messages]
        const receipt = await storedResponseMemoryAnalysis.confirm({
            characterId: input.characterId,
            chatId: input.chatId,
            messages: projectMemoryAnalysisEvidence(
                input.messages,
                contextMessages,
                firstMessageEvidence
            ),
            analysisTokenLimit: settings.risuBardAnalysisTokenLimit,
            additionalSearchLimit: settings.risuBardAdditionalSearchLimit,
            canonicalTargetLimit: settings.risuBardCanonicalTargetLimit,
            inquiryTokenBudget: {
                target: settings.risuBardInquiryTargetTokenBudget,
                events: settings.risuBardInquiryEventTokenBudget,
                perSource: settings.risuBardInquirySourceTokenBudget,
                maximum: settings.risuBardInquiryMaximumTokenBudget,
            },
            canonicalWritingStyle: settings.risuBardCanonicalWritingStyle,
            canonicalCustomStyle: settings.risuBardCanonicalCustomStyle,
            wikiWritingLanguage: settings.risuBardWikiWritingLanguage,
            arcPlotterSettings: resolvedArcPlotterSettings(),
            ...(compiledWikiPromptGuide ? {
                wikiPromptGuide: {
                    analysis: compiledWikiPromptGuide.analysis,
                    canonicalRewrite: compiledWikiPromptGuide.canonicalRewrite,
                },
            } : {}),
            ...(input.additionalAnalysis ? { additionalAnalysis: true } : {}),
            ...(input.excludeCanonicalDocumentIds ? {
                excludeCanonicalDocumentIds:
                    input.excludeCanonicalDocumentIds,
            } : {}),
            ...(chat ? { contextMessages } : {}),
        }, generationSignal)
        const retryWarning = receipt
            ? canonicalTurnRetryWarning(receipt)
            : undefined
        if (retryWarning) {
            publishRisuBardMemoryActivity({
                characterId: input.characterId,
                chatId: input.chatId,
                operation: 'error',
                timestamp: Date.now(),
                message: retryWarning,
            })
        }
        const message = chat?.message.find(
            (item) => item.chatId === input.targetMessageId
        )
        const accepted = input.messages.at(-1)
        if (message
            && accepted?.role === 'assistant'
            && message.data === accepted.content) {
            if (receipt && canonicalTurnNeedsRetry(receipt)) {
                delete message.risubardMemoryConfirmed
            }
            else {
                message.risubardMemoryConfirmed = true
            }
            if (receipt) message.risubardCanonicalReceipt = receipt
        }
        return true
    }
    catch (error) {
        if (generationSignal.aborted) return false
        const reason = (error instanceof Error
            ? error.message
            : String(error)).trim().slice(0, 512)
        publishRisuBardMemoryActivity({
            characterId: input.characterId,
            chatId: input.chatId,
            operation: 'error',
            timestamp: Date.now(),
            message: `위키 갱신 실패: ${reason || '알 수 없는 오류'}`,
        })
        throw error
    }
    finally {
        endWikiGeneration(generationOperation)
        narrativeConfirmations.delete(key)
    }
}

export async function confirmCurrentNarrativeMessage(
    messageId: string
): Promise<boolean> {
    const character = DBState.db.characters[get(selectedCharID)]
    const chat = character?.chats[character.chatPage]
    if (!character || !chat) return false
    const chatId = ensureNarrativeSessionChatId(chat, v4)
    const projected = projectConfirmedMemoryTurn(chat.message, messageId)
    if (!projected) return false
    return confirmProjectedNarrativeTurn({
        characterId: character.chaId,
        chatId,
        ...projected,
    })
}

export async function forceCurrentNarrativeWikiUpdate(): Promise<boolean> {
    const character = DBState.db.characters[get(selectedCharID)]
    const chat = character?.chats[character.chatPage]
    if (!character || !chat) return false
    const target = chat.message.findLast((message) =>
        message.role === 'char'
        && !message.isComment
        && !message.disabled
        && typeof message.chatId === 'string'
        && message.chatId.trim().length > 0
    )
    if (!target?.chatId) return false
    const projected = projectConfirmedMemoryTurn(
        chat.message,
        target.chatId,
        { includeConfirmed: true }
    )
    if (!projected) return false
    return confirmProjectedNarrativeTurn({
        characterId: character.chaId,
        chatId: ensureNarrativeSessionChatId(chat, v4),
        additionalAnalysis: true,
        excludeCanonicalDocumentIds: target.risubardCanonicalReceipt
            ?.changes
            .map((change) => change.documentId) ?? [],
        ...projected,
    })
}

const activeWikiReboots = new Set<string>()

function currentRisuBardConversation(): {
    character: character
    chat: Chat
    chatIndex: number
} | undefined {
    const character = DBState.db.characters[get(selectedCharID)]
    const chatIndex = character?.chatPage
    const chat = character?.chats[chatIndex]
    if (!character || !chat || typeof chatIndex !== 'number') return undefined
    return { character, chat, chatIndex }
}

async function persistWikiReboot(
    character: character,
    chat: Chat,
    chatIndex: number
): Promise<void> {
    const chatId = ensureNarrativeSessionChatId(chat, v4)
    await saveChatToServer(character.chaId, chatIndex, chatId, chat)
}

function projectRebootBatch(batch: readonly WikiRebootTurn[]) {
    const used = new Set<string>()
    const rebootTurns = batch.map((turn) => {
        const sourceMessageIds = turn.messageIds.filter((id) => {
            if (used.has(id)) return false
            used.add(id)
            return true
        })
        return {
            assistantMessageId: turn.assistantMessageId,
            sourceMessageIds,
        }
    })
    const byId = new Map(batch.flatMap((turn) => turn.messages)
        .map((message) => [message.messageId, message] as const))
    return {
        rebootTurns,
        messages: rebootTurns.flatMap((turn) =>
            turn.sourceMessageIds.flatMap((id) => {
                const message = byId.get(id)
                return message ? [message] : []
            })
        ),
        sourceMessageIds: rebootTurns.flatMap((turn) => turn.sourceMessageIds),
        eventSourceGroups: rebootTurns.map((turn) => turn.sourceMessageIds),
    }
}

function applyWikiRebootBatchReceipt(
    chat: Chat,
    batch: readonly WikiRebootTurn[],
    receipt: NonNullable<Message['risubardCanonicalReceipt']>
): void {
    const job = chat.risuBardWikiReboot
    if (!job) return
    for (const turn of batch) {
        if (!job.completedAssistantMessageIds.includes(
            turn.assistantMessageId
        )) {
            job.completedAssistantMessageIds.push(turn.assistantMessageId)
        }
        job.receipts[turn.assistantMessageId] = receipt
    }
    delete job.inFlightAssistantMessageIds
    delete job.lastError
    job.updatedAt = Date.now()
}

async function finalizeWikiReboot(
    character: character,
    chat: Chat,
    chatIndex: number
): Promise<void> {
    const job = chat.risuBardWikiReboot
    if (!job) return
    const chatId = ensureNarrativeSessionChatId(chat, v4)
    job.status = 'finalizing'
    job.updatedAt = Date.now()
    await persistWikiReboot(character, chat, chatIndex)
    if (!job.replacementForkToken) {
        const replacement = await prepareWikiRebootReplacement({
            characterId: character.chaId,
            stagingChatId: job.stagingChatId,
            chatId,
            fetchImpl: fetch,
            createAuth: () => forageStorage.createAuth(),
        })
        job.replacementForkToken = replacement.forkToken
        job.updatedAt = Date.now()
        await persistWikiReboot(character, chat, chatIndex)
    }
    await completeMemoryWikiFork({
        characterId: character.chaId,
        destinationChatId: chatId,
        forkToken: job.replacementForkToken,
        action: 'finalize',
        fetchImpl: fetch,
        createAuth: () => forageStorage.createAuth(),
    })
    const targetIds = new Set(job.targetAssistantMessageIds)
    for (const message of chat.message) {
        delete message.risubardMemoryConfirmed
        delete message.risubardCanonicalReceipt
        if (message.chatId && targetIds.has(message.chatId)) {
            message.risubardMemoryConfirmed = true
            const receipt = job.receipts[message.chatId]
            if (receipt) message.risubardCanonicalReceipt = receipt
        }
    }
    const stagingChatId = job.stagingChatId
    delete chat.risuBardWikiReboot
    await persistWikiReboot(character, chat, chatIndex)
    await cleanupWikiRebootWorkspace({
        characterId: character.chaId,
        stagingChatId,
        fetchImpl: fetch,
        createAuth: () => forageStorage.createAuth(),
    }).catch((error) => {
        console.warn('[RisuBard wiki reboot cleanup]', error)
    })
    announceRisuBardMemoryUpdated({ characterId: character.chaId, chatId })
}

async function runWikiReboot(
    character: character,
    chat: Chat,
    chatIndex: number
): Promise<boolean> {
    const chatId = ensureNarrativeSessionChatId(chat, v4)
    const operationId = `reboot:${character.chaId}:${chatId}`
    if (activeWikiReboots.has(operationId)) return false
    activeWikiReboots.add(operationId)
    const generationSignal = beginWikiGeneration(operationId)
    try {
        while (chat.risuBardWikiReboot) {
            const job = chat.risuBardWikiReboot
            const turns = projectWikiRebootTurns(chat.message)
            if (job.status === 'stop-requested'
                && !job.inFlightAssistantMessageIds?.length) {
                job.status = 'paused'
                job.updatedAt = Date.now()
                await persistWikiReboot(character, chat, chatIndex)
                return true
            }
            const inFlightIds = job.inFlightAssistantMessageIds
            const batch = inFlightIds?.length
                ? inFlightIds.map((id) => turns.find((turn) =>
                    turn.assistantMessageId === id
                )).filter((turn): turn is WikiRebootTurn => Boolean(turn))
                : nextWikiRebootBatch(job, turns)
            if (inFlightIds?.length && batch.length !== inFlightIds.length) {
                throw new Error('진행 중이던 리부트 대상 메시지를 찾을 수 없습니다.')
            }
            if (batch.length === 0) {
                await finalizeWikiReboot(character, chat, chatIndex)
                return true
            }
            const projected = projectRebootBatch(batch)
            if (inFlightIds?.length) {
                const recovered = await recoverWikiRebootBatch({
                    characterId: character.chaId,
                    stagingChatId: job.stagingChatId,
                    sourceMessageIds: projected.sourceMessageIds,
                    eventSourceGroups: projected.eventSourceGroups,
                    fetchImpl: fetch,
                    createAuth: () => forageStorage.createAuth(),
                })
                if (recovered) {
                    applyWikiRebootBatchReceipt(chat, batch, recovered)
                    await persistWikiReboot(character, chat, chatIndex)
                    await completeWikiRebootBatch({
                        characterId: character.chaId,
                        stagingChatId: job.stagingChatId,
                        sourceMessageIds: projected.sourceMessageIds,
                        fetchImpl: fetch,
                        createAuth: () => forageStorage.createAuth(),
                    }).catch((error) => {
                        console.warn('[RisuBard wiki reboot batch cleanup]', error)
                    })
                    continue
                }
            }
            else {
                job.inFlightAssistantMessageIds = batch.map((turn) =>
                    turn.assistantMessageId
                )
                job.updatedAt = Date.now()
                await persistWikiReboot(character, chat, chatIndex)
            }
            const settings = resolvedRisuBardSettings(chat)
            const wikiPromptPreset = resolveWikiPromptPreset(
                DBState.db.risuBardWikiPromptPresets,
                DBState.db.risuBardChatWikiPromptPresetId
            )
            const compiledWikiPromptGuide = wikiPromptPreset
                ? compileWikiPromptGuide(wikiPromptPreset, {
                    characterGuide: risuChatParser(
                        character.risuBardWikiGuide ?? '',
                        { chara: character }
                    ),
                    chatGuide: risuChatParser(chat.risuBardWikiGuide ?? '', {
                        chara: character,
                    }),
                })
                : undefined
            const firstMessageEvidence = await resolveNarrativeFirstMessageEvidence(
                character,
                chat,
                chatId
            )
            const contextMessages = projectRecentMemoryMessages(
                chat.message,
                normalizeNarrativeWorkingMessageLimit(
                    settings.risuBardRecentMessageCount
                ),
                batch.at(-1)?.assistantMessageId,
                firstMessageEvidence
            )
            const receipt = await storedResponseMemoryAnalysis.confirm({
                characterId: character.chaId,
                chatId: job.stagingChatId,
                modelSessionChatId: chatId,
                messages: projectMemoryAnalysisEvidence(
                    projected.messages,
                    contextMessages,
                    firstMessageEvidence
                ),
                rebootTurns: projected.rebootTurns,
                analysisTokenLimit: settings.risuBardAnalysisTokenLimit,
                additionalSearchLimit: settings.risuBardAdditionalSearchLimit,
                canonicalTargetLimit: settings.risuBardCanonicalTargetLimit,
                inquiryTokenBudget: {
                    target: settings.risuBardInquiryTargetTokenBudget,
                    events: settings.risuBardInquiryEventTokenBudget,
                    perSource: settings.risuBardInquirySourceTokenBudget,
                    maximum: settings.risuBardInquiryMaximumTokenBudget,
                },
                canonicalWritingStyle: settings.risuBardCanonicalWritingStyle,
                canonicalCustomStyle: settings.risuBardCanonicalCustomStyle,
                wikiWritingLanguage: job.writingLanguage ?? 'ko',
                arcPlotterSettings: resolvedArcPlotterSettings(),
                ...(compiledWikiPromptGuide ? {
                    wikiPromptGuide: {
                        analysis: compiledWikiPromptGuide.analysis,
                        canonicalRewrite:
                            compiledWikiPromptGuide.canonicalRewrite,
                    },
                } : {}),
                contextMessages,
            }, generationSignal)
            if (!receipt) {
                throw new Error('리부트 배치 완료 영수증을 저장하지 못했습니다.')
            }
            applyWikiRebootBatchReceipt(chat, batch, receipt)
            await persistWikiReboot(character, chat, chatIndex)
            await completeWikiRebootBatch({
                characterId: character.chaId,
                stagingChatId: job.stagingChatId,
                sourceMessageIds: projected.sourceMessageIds,
                fetchImpl: fetch,
                createAuth: () => forageStorage.createAuth(),
            }).catch((error) => {
                console.warn('[RisuBard wiki reboot batch cleanup]', error)
            })
        }
        return true
    }
    catch (error) {
        const job = chat.risuBardWikiReboot
        if (generationSignal.aborted) {
            if (job) {
                job.status = 'paused'
                job.lastError = undefined
                job.updatedAt = Date.now()
                await persistWikiReboot(character, chat, chatIndex)
                    .catch(() => {})
            }
            return true
        }
        const reason = (error instanceof Error
            ? error.message
            : String(error)).trim().slice(0, 512) || '알 수 없는 오류'
        if (job) {
            job.status = 'failed'
            job.lastError = reason
            job.updatedAt = Date.now()
            await persistWikiReboot(character, chat, chatIndex).catch(() => {})
        }
        publishRisuBardMemoryActivity({
            characterId: character.chaId,
            chatId,
            operation: 'error',
            timestamp: Date.now(),
            message: `위키 리부트 실패: ${reason}`,
        })
        throw error
    }
    finally {
        endWikiGeneration(operationId)
        activeWikiReboots.delete(operationId)
    }
}

export async function startCurrentWikiReboot(
    batchSize: WikiRebootBatchSize,
    startChatIndex: number = 0
): Promise<boolean> {
    const current = currentRisuBardConversation()
    if (!current || current.chat.risuBardWikiReboot) return false
    if (!Number.isInteger(startChatIndex) || startChatIndex < 0
        || startChatIndex >= current.chat.message.length) return false
    const chatId = ensureNarrativeSessionChatId(current.chat, v4)
    const turns = projectWikiRebootTurns(current.chat.message, startChatIndex)
    if (turns.length === 0) return false
    const jobId = v4()
    current.chat.risuBardWikiReboot = createWikiRebootJob({
        jobId,
        stagingChatId: `reboot-${jobId}`,
        writingLanguage: resolvedRisuBardSettings(current.chat).risuBardWikiWritingLanguage,
        batchSize,
        targetAssistantMessageIds: turns.map((turn) =>
            turn.assistantMessageId
        ),
    })
    await saveChatToServer(
        current.character.chaId,
        current.chatIndex,
        chatId,
        current.chat
    )
    return runWikiReboot(current.character, current.chat, current.chatIndex)
}

export async function stopCurrentWikiReboot(): Promise<boolean> {
    const current = currentRisuBardConversation()
    const job = current?.chat.risuBardWikiReboot
    if (!current || !job || (job.status !== 'running'
        && job.status !== 'stop-requested')) return false
    job.status = 'stop-requested'
    job.updatedAt = Date.now()
    await persistWikiReboot(current.character, current.chat, current.chatIndex)
    return true
}

export async function resumeCurrentWikiReboot(): Promise<boolean> {
    const current = currentRisuBardConversation()
    const job = current?.chat.risuBardWikiReboot
    if (!current || !job || (job.status !== 'paused'
        && job.status !== 'failed')) return false
    job.status = 'running'
    delete job.lastError
    job.updatedAt = Date.now()
    await persistWikiReboot(current.character, current.chat, current.chatIndex)
    return runWikiReboot(current.character, current.chat, current.chatIndex)
}

export async function cancelCurrentWikiReboot(): Promise<boolean> {
    const current = currentRisuBardConversation()
    const job = current?.chat.risuBardWikiReboot
    if (!current || !job || (job.status !== 'paused'
        && job.status !== 'failed')) return false
    if (job.replacementForkToken) {
        await completeMemoryWikiFork({
            characterId: current.character.chaId,
            destinationChatId: ensureNarrativeSessionChatId(current.chat, v4),
            forkToken: job.replacementForkToken,
            action: 'discard',
            fetchImpl: fetch,
            createAuth: () => forageStorage.createAuth(),
        })
    }
    await cleanupWikiRebootWorkspace({
        characterId: current.character.chaId,
        stagingChatId: job.stagingChatId,
        fetchImpl: fetch,
        createAuth: () => forageStorage.createAuth(),
    })
    delete current.chat.risuBardWikiReboot
    await persistWikiReboot(current.character, current.chat, current.chatIndex)
    return true
}

export async function executeCurrentNarrativeWikiCommand(
    instruction: string,
    requestedContextSelection?: DirectWikiContextSelection
): Promise<DirectWikiCommandResult> {
    const character = DBState.db.characters[get(selectedCharID)]
    const chat = character?.chats[character.chatPage]
    if (!character || !chat) {
        throw new Error('현재 채팅을 찾을 수 없습니다.')
    }
    const characterId = character.chaId
    const chatId = ensureNarrativeSessionChatId(chat, v4)
    const settings = resolvedRisuBardSettings(chat)
    const contextSelection = requestedContextSelection ?? {
        wiki: settings.bardChatIncludeWiki,
        chat: settings.bardChatIncludeChat,
        systemPrompt: settings.bardChatIncludeSystemPrompt,
        characterDescription: settings.bardChatIncludeCharacterDescription,
        persona: settings.bardChatIncludePersona,
        characterLorebook: settings.bardChatIncludeCharacterLorebook,
        moduleLorebook: settings.bardChatIncludeModuleLorebook,
    }
    let currentMessages: MemoryAnalysisMessage[] = []
    if (contextSelection.chat) {
        const target = chat.message.findLast((message) =>
            message.role === 'char'
            && !message.isComment
            && !message.disabled
            && typeof message.chatId === 'string'
            && message.chatId.trim().length > 0
        )
        if (!target?.chatId) {
            throw new Error('명령에 참고할 현재 AI 응답이 없습니다.')
        }
        currentMessages = projectRecentMemoryMessages(
            chat.message,
            normalizeNarrativeWorkingMessageLimit(
                settings.risuBardRecentMessageCount
            ),
            target.chatId,
            await resolveNarrativeFirstMessageEvidence(
                character,
                chat,
                chatId
            ),
        )
        if (currentMessages.length === 0) {
            throw new Error('현재 메시지를 위키 명령 자료로 준비할 수 없습니다.')
        }
    }
    const needsBuilderSources = contextSelection.systemPrompt
        || contextSelection.characterDescription
        || contextSelection.characterLorebook
        || contextSelection.moduleLorebook
    const builderSources = needsBuilderSources
        ? collectPersonaBuilderSources({
            database: DBState.db,
            character,
            moduleLorebooks: contextSelection.moduleLorebook
                ? getModuleLorebooksWithSources()
                : [],
        })
        : undefined
    let characterLorebook = ''
    if (contextSelection.characterLorebook) {
        characterLorebook = (await matchPersonaBuilderCharacterLorebook({
            character,
            userInstruction: instruction,
            draft: '',
        })).content
    }
    const contextSources: DirectWikiContextSources = {
        systemPrompt: builderSources?.systemPrompt ?? '',
        characterDescription: builderSources?.characterDescription ?? '',
        persona: contextSelection.persona ? getPersonaPrompt() : '',
        characterLorebook,
        moduleLorebook: builderSources?.moduleLorebook ?? '',
    }
    const createAuth = () => forageStorage.createAuth()
    const wiki = await loadNarrativeMemoryWiki({
        characterId,
        chatId,
        fetchImpl: fetch,
        createAuth,
    })
    if (wiki.mode !== 'markdown') {
        throw new Error('직접 위키 명령은 Markdown Memory Wiki에서만 사용할 수 있습니다.')
    }
    publishRisuBardMemoryActivity({
        characterId,
        chatId,
        operation: 'request',
        timestamp: Date.now(),
        message: '사용자 직접 위키 명령을 실행합니다.',
    })
    const generationOperation = `command:${characterId}:${chatId}`
    const generationSignal = beginWikiGeneration(generationOperation)
    let undoStarted = false
    try {
        const result = await executeDirectWikiCommand({
            instruction,
            documents: wiki.documents,
            currentMessages,
            contextSelection,
            contextSources,
            maxTokens: settings.risuBardAnalysisTokenLimit,
            requestModel: (request) => requestChatData(
                {
                    ...request,
                    realChatId: chatId,
                    logSource: 'wiki-admin',
                },
                settings.risuBardModelMode,
                generationSignal
            ),
            beforeApply: async () => {
                await beginBardChatUndo({
                    characterId, chatId, fetchImpl: fetch, createAuth,
                })
                undoStarted = true
            },
            saveDocument: (document) => saveManualWikiDocument({
                characterId,
                chatId,
                ...document,
                fetchImpl: fetch,
                createAuth,
            }),
            trashDocument: (documentId) => trashWikiDocument({
                characterId,
                chatId,
                documentId,
                fetchImpl: fetch,
                createAuth,
            }),
            retractEvent: (documentId, expectedContentHash) => retractWikiEvent({
                characterId,
                chatId,
                documentId,
                expectedContentHash,
                fetchImpl: fetch,
                createAuth,
            }),
        })
        if (undoStarted) {
            await finalizeBardChatUndo({
                characterId, chatId, fetchImpl: fetch, createAuth,
            })
            undoStarted = false
        }
        announceRisuBardMemoryUpdated({ characterId, chatId })
        publishRisuBardMemoryActivity({
            characterId,
            chatId,
            operation: result.failed.length > 0 ? 'error' : 'wiki-save',
            timestamp: Date.now(),
            message: result.failed.length > 0
                ? `직접 위키 명령: ${result.applied.length}건 적용, ${result.failed.length}건 미적용`
                : `직접 위키 명령: ${result.applied.length}건 적용`,
            wikiPaths: result.applied.flatMap((item) =>
                item.relativePath ? [item.relativePath] : []
            ),
        })
        for (const failure of result.failed) {
            publishRisuBardMemoryActivity({
                characterId,
                chatId,
                operation: 'error',
                timestamp: Date.now(),
                message: `미적용 · ${failure.title}: ${failure.reason}`,
            })
        }
        return result
    }
    catch (cause) {
        if (undoStarted) {
            try {
                await finalizeBardChatUndo({
                    characterId, chatId, fetchImpl: fetch, createAuth,
                })
            }
            catch {
                // Preserve the original command failure.
            }
            undoStarted = false
        }
        if (generationSignal.aborted) {
            publishRisuBardMemoryActivity({
                characterId,
                chatId,
                operation: 'error',
                timestamp: Date.now(),
                message: '사용자가 바드위키 작업을 취소했습니다.',
            })
            return { applied: [], failed: [] }
        }
        const reason = (cause instanceof Error
            ? cause.message
            : String(cause)).trim().slice(0, 512)
        publishRisuBardMemoryActivity({
            characterId,
            chatId,
            operation: 'error',
            timestamp: Date.now(),
            message: `직접 위키 명령 실패: ${reason || '알 수 없는 오류'}`,
        })
        throw cause
    }
    finally {
        endWikiGeneration(generationOperation)
    }
}

export interface OpenAIChat{
    role: 'system'|'user'|'assistant'|'function'
    content: string
    memo?:string
    name?:string
    removable?:boolean
    attr?:string[]
    multimodals?: MultiModal[]
    thoughts?: string[]
    cachePoint?: boolean
    requestStatusSources?: RequestInjectionSource[]
}

function findMessageIndexByChatId(chat: { message: Array<{ chatId?: string }> }, chatId?: string) {
    if(!chatId){
        return -1
    }
    return chat.message.findIndex((message) => message.chatId === chatId)
}

function setRequestStatusSource(
    message: OpenAIChat,
    kind: RequestInjectionKind,
    name?: string,
): OpenAIChat {
    message.requestStatusSources = [{
        kind,
        ...(name ? { name } : {}),
        role: message.role,
        content: message.content,
    }]
    return message
}

function syncRequestStatusSource(message: OpenAIChat): void {
    if (message.requestStatusSources?.length === 1) {
        message.requestStatusSources[0] = {
            ...message.requestStatusSources[0],
            role: message.role,
            content: message.content,
        }
    }
}

function narrativeSourceDisplayName(
    sourceId: string,
    displayName?: string
): string {
    if (displayName?.trim()) return displayName
    const wikiMarker = ':wiki:'
    const wikiAt = sourceId.indexOf(wikiMarker)
    if (wikiAt >= 0) return sourceId.slice(wikiAt + wikiMarker.length)
    return sourceId.split(':').at(-1) || sourceId
}

export interface MultiModal{
    type:'image'|'video'|'audio'|'signature'
    base64:string,
    height?:number,
    width?:number
}

export interface requestTokenPart{
    name:string
    tokens:number
}

export { doingChat, chatProcessStage } from "./generationState"
export let requestTokenParts:{[key:string]:requestTokenPart[]} = {}
export let previewFormated:OpenAIChat[] = []
export let previewBody:string = ''

export async function sendChat(chatProcessIndex = -1,arg:{
    chatAdditonalTokens?:number,
    signal?:AbortSignal,
    continue?:boolean,
    usedContinueTokens?:number,
    preview?:boolean
    previewPrompt?:boolean
} = {}):Promise<boolean> {

    if (!arg.preview && !arg.previewPrompt && get(isWikiGenerating)) {
        alertError(language.risuBardWikiGenerationChatLocked)
        return false
    }

    const selected = DBState.db.characters[get(selectedCharID)]
    const selectedConversation = selected?.chats[selected.chatPage]
    if (selectedConversation?.risuBardWikiReboot) return false

    chatProcessStage.set(0)
    const abortSignal = arg.signal ?? (new AbortController()).signal
    
    // NOTE: `throwError()` can be called before these are populated (e.g. HypaV3 early validation errors).
    // Keep them declared up-front to avoid TDZ ReferenceErrors in production builds.
    let selectedChar = -1
    let selectedChat = -1
    let currentChar:character
    let generationInfo:MessageGenerationInfo|undefined = undefined

    const stageTimings = {
        stage1Start: 0,
        stage2Start: 0,
        stage3Start: 0,
        stage4Start: 0,
        stage1Duration: 0,
        stage2Duration: 0,
        stage3Duration: 0,
        stage4Duration: 0
    }

    let isAborted = false
    let findCharCache:{[key:string]:character} = {}
    function findCharacterbyIdwithCache(id:string){
        const d = findCharCache[id]
        if(!!d){
            return d
        }
        else{
            const r = findCharacterbyId(id)
            findCharCache[id] = r
            return r
        }
    }


    function runCurrentChatFunction(chat:Chat){
        chat.message = chat.message.map((v) => {
            v.data = risuChatParser(v.data, {chara: currentChar, runVar: true})
            return v
        })
        return chat
    }

    function reformatContent(data:string){
        if(chatProcessIndex === -1){
            return data.trim()
        }
        return data.trim()
    }

    function throwError(error:string){
        if(!DBState?.db?.inlayErrorResponse){
            alertError(error)
            return
        }

        try{
            const db = DBState.db

            // Prefer already-resolved selection, but fall back to current store/db pointers.
            const sc = selectedChar >= 0 ? selectedChar : get(selectedCharID)
            const charRoom = db.characters?.[sc]
            if(!charRoom){
                alertError(error)
                return
            }
            const st = selectedChat >= 0 ? selectedChat : charRoom.chatPage
            const chatRoom = charRoom.chats?.[st]
            if(!chatRoom || !Array.isArray(chatRoom.message)){
                alertError(error)
                return
            }

            const messages = chatRoom.message
            const last = messages[messages.length - 1]
            const suffix = `\n\`\`\`risuerror\n${error}\n\`\`\``

            if(last?.role === 'char'){
                last.data += suffix
                return
            }

            const m:Message = {
                role: 'char',
                data: `\`\`\`risuerror\n${error}\n\`\`\``,
                time: Date.now(),
            }
            if(currentChar?.chaId){
                m.saying = currentChar.chaId
            }
            if(generationInfo){
                m.generationInfo = generationInfo
            }
            messages.push(m)
            return
        }
        catch(e){
            console.error(e)
            alertError(error)
            return
        }
    }

    // Concurrency and narrative memory share one persistent per-chat ID.
    // Legacy chats receive an ID before generation instead of sharing an
    // index-based fallback key.
    const guardChar = DBState.db.characters[get(selectedCharID)]
    const guardChat = guardChar?.chats?.[guardChar.chatPage]
    const realChatId = guardChat
        ? ensureNarrativeSessionChatId(guardChat, v4)
        : undefined
    const genKey = chatGenKey(realChatId)

    if(isChatGenerating(genKey)){
        if(chatProcessIndex === -1){
            return false
        }
    }
    const generationId = v4()
    startGeneration(genKey, generationId)
    // Resumable-send tombstone (pendingSends.ts): registered BEFORE the
    // pipeline so a tab death anywhere in it (translate → memory → request)
    // leaves the marker; cleared on every conclude path. Previews never
    // register (they end without a message, which would read as resumable).
    // No-op unless the server-side requests toggle is on.
    if (realChatId && !arg.preview && !arg.previewPrompt) {
        registerPendingSend(realChatId, generationId)
    }

    if(chatProcessIndex === -1 && DBState.db.presetChain){
        const names = DBState.db.presetChain.split(',').map((v) => v.trim())
        const randomSelect = Math.floor(Math.random() * names.length)
        const ele = names[randomSelect]

        const findId = DBState.db.botPresets.findIndex((v) => {
            return v.name === ele
        })

        if(findId === -1){
            notifyError(`Cannot find preset: ${ele}`, { source: 'preset' })
        }
        else{
            changeToPreset(findId, true)
        }
    }

    DBState.db.statics.messages += 1
    selectedChar = get(selectedCharID)
    const nowChatroom = DBState.db.characters[selectedChar]
    nowChatroom.lastInteraction = Date.now()
    selectedChat = nowChatroom.chatPage
    // Block send if chat is still a placeholder (hydration not complete)
    if (nowChatroom.chats[nowChatroom.chatPage]?._placeholder) {
        alertError('Chat is still loading. Please wait a moment.')
        endGeneration(genKey)
        if (realChatId) clearPendingSend(realChatId)
        return false
    }
    nowChatroom.chats[nowChatroom.chatPage].message = nowChatroom.chats[nowChatroom.chatPage].message.map((v) => {
        v.chatId = v.chatId ?? v4()
        return v
    })
    
    let promptInfo: MessagePresetInfo = {}
    let initialPresetNameForPromptInfo = null
    let initialPromptTogglesForPromptInfo: {
        key: string,
        value: string,
    }[] = []
    if(DBState.db.promptInfoInsideChat){
        initialPresetNameForPromptInfo = DBState.db.botPresets[DBState.db.botPresetsId]?.name ?? ''
        initialPromptTogglesForPromptInfo = parseToggleSyntax(DBState.db.customPromptTemplateToggle + getModuleToggles())
            .flatMap(toggle => {
                const raw = getGlobalChatVar(`toggle_${toggle.key}`)
                if (toggle.type === 'select' || toggle.type === 'text') {
                    return [{ key: toggle.value, value: toggle.options[raw] }];
                }
                if (raw === '1') {
                    return [{ key: toggle.value, value: 'ON' }];
                }
                return [];
            })

        promptInfo = {
            promptName: initialPresetNameForPromptInfo,
            promptToggles: initialPromptTogglesForPromptInfo,
        }
    }

    let caculatedChatTokens = 0
    if(DBState.db.aiModel.startsWith('gpt')){
        caculatedChatTokens += 5
    }
    else{
        caculatedChatTokens += 3
    }

    currentChar = nowChatroom

    let chatAdditonalTokens = arg.chatAdditonalTokens ?? caculatedChatTokens
    const tokenizer = new ChatTokenizer(chatAdditonalTokens, DBState.db.aiModel.startsWith('gpt') ? 'noName' : 'name')
    let currentChat = runCurrentChatFunction(nowChatroom.chats[selectedChat])
    const narrativeSessionChatId = realChatId
        ?? ensureNarrativeSessionChatId(currentChat, v4)
    nowChatroom.chats[selectedChat] = currentChat
    const narrativeTurnToConfirm = projectConfirmedMemoryTurn(
        currentChat.message
    )
    let maxContextTokens = DBState.db.maxContext
    // Output-token reservation for the context budget. Defaults to the legacy
    // global db.maxResponse (the "[채팅 봇]" max response size), overridden below
    // when this chat is bound to a ModelPreset.
    let maxResponseTokens = DBState.db.maxResponse
    // When this chat is bound to a ModelPreset, use the preset's own input
    // budget (preset.maxContext, default 65000) instead of the global
    // db.maxContext — clamped to the model's context window when known.
    // Without this, a small global maxContext blocks large-context presets.
    {
        const mainBinding = resolveChatModelBinding(currentChat, 'model')
        if (mainBinding.kind === 'modelPreset') {
            const ctxWindow = mainBinding.preset.profileSnapshot.limits?.contextWindowTokens
            const set = mainBinding.preset.maxContext
            const budget = set && set > 0 ? set : 65000
            maxContextTokens = ctxWindow ? Math.min(budget, ctxWindow) : budget
            // Reserve output tokens from the preset's own max-output setting
            // rather than db.maxResponse — the legacy global value can be a
            // stray figure (e.g. 65535 carried over from an imported prompt
            // preset) that would eat the whole context window and make even the
            // first message fail with a false "too much token" error.
            const presetOut = resolvePresetMaxOutputTokens(mainBinding.preset)
            if (presetOut !== undefined) maxResponseTokens = presetOut
        }
    }

    setGenerationStage(genKey, 1)
    stageTimings.stage1Start = Date.now()
    let unformated = {
        'main':([] as OpenAIChat[]),
        'jailbreak':([] as OpenAIChat[]),
        'chats':([] as OpenAIChat[]),
        'lorebook':([] as OpenAIChat[]),
        'globalNote':([] as OpenAIChat[]),
        'authorNote':([] as OpenAIChat[]),
        'lastChat':([] as OpenAIChat[]),
        'description':([] as OpenAIChat[]),
        'postEverything':([] as OpenAIChat[]),
        'personaPrompt':([] as OpenAIChat[])
    }

    let promptTemplate = safeStructuredClone(DBState.db.promptTemplate)
    const usingPromptTemplate = !!promptTemplate
    if(promptTemplate){
        let hasPostEverything = false
        for(const card of promptTemplate){
            if(card.type === 'postEverything'){
                hasPostEverything = true
                break
            }
        }

        if(!hasPostEverything){
            promptTemplate.push({
                type: 'postEverything'
            })
        }
    }
    if(currentChar.utilityBot && (!(usingPromptTemplate && DBState.db.promptSettings.utilOverride))){
        promptTemplate = [
            {
              "type": "plain",
              "text": "",
              "role": "system",
              "type2": "main"
            },
            {
              "type": "description",
            },
            {
              "type": "lorebook",
            },
            {
              "type": "chat",
              "rangeStart": 0,
              "rangeEnd": "end"
            },
            {
              "type": "plain",
              "text": "",
              "role": "system",
              "type2": "globalNote"
            },
            {
                'type': "postEverything"
            }
        ]
    }

    if((!currentChar.utilityBot) && (!promptTemplate)){
        const mainp = currentChar.systemPrompt?.replaceAll('{{original}}', DBState.db.mainPrompt) || DBState.db.mainPrompt


        function formatPrompt(data:string, kind: RequestInjectionKind){
            if(!data.startsWith('@@')){
                data = "@@system\n" + data
            }
            const parts = data.split(/@@@?(user|assistant|system)\n/);
  
            // Initialize empty array for the chat objects
            const chatObjects: OpenAIChat[] = [];
            
            // Loop through the parts array two elements at a time
            for (let i = 1; i < parts.length; i += 2) {
              const role = parts[i] as 'user' | 'assistant' | 'system';
              const content = parts[i + 1]?.trim() || '';
              chatObjects.push(setRequestStatusSource({ role, content }, kind));
            }

            return chatObjects;
        }

        unformated.main.push(...formatPrompt(risuChatParser(mainp + ((DBState.db.additionalPrompt === '' || (!DBState.db.promptPreprocess)) ? '' : `\n${DBState.db.additionalPrompt}`), {chara: currentChar}), 'systemPrompt'))
    
        if(DBState.db.jailbreakToggle){
            unformated.jailbreak.push(...formatPrompt(risuChatParser(DBState.db.jailbreak, {chara: currentChar}), 'jailbreak'))
        }
    
        unformated.globalNote.push(...formatPrompt(risuChatParser(currentChar.replaceGlobalNote?.replaceAll('{{original}}', DBState.db.globalNote) || DBState.db.globalNote, {chara:currentChar}), 'globalNote'))
    }

    let baseDescriptionPrompt:OpenAIChat|null = null
    let beforeDescriptionPrompts:OpenAIChat[] = []
    let afterDescriptionPrompts:OpenAIChat[] = []

    if(currentChat.note){
        unformated.authorNote.push(setRequestStatusSource({
            role: 'system',
            content: risuChatParser(currentChat.note, {chara: currentChar})
        }, 'authorNote'))
    }
    else if(getAuthorNoteDefaultText() !== ''){
        unformated.authorNote.push(setRequestStatusSource({
            role: 'system',
            content: risuChatParser(getAuthorNoteDefaultText(), {chara: currentChar})
        }, 'authorNote'))
    }

    if(DBState.db.chainOfThought && (!(usingPromptTemplate && DBState.db.promptSettings.customChainOfThought))){
        unformated.postEverything.push({
            role: 'system',
            content: `<instruction> - before respond everything, Think step by step as a ai assistant how would you respond inside <Thoughts> xml tag. this must be less than 5 paragraphs.</instruction>`
        })
    }

    {
        let description = risuChatParser((DBState.db.promptPreprocess ? DBState.db.descriptionPrefix: '') + currentChar.desc, {chara: currentChar})

        const additionalInfo = await additionalInformations(currentChar, currentChat)

        if(additionalInfo){
            description += '\n\n' + risuChatParser(additionalInfo, {chara:currentChar})
        }

        if(currentChar.personality){
            description += risuChatParser("\n\nDescription of {{char}}: " + currentChar.personality, {chara: currentChar})
        }

        if(currentChar.scenario){
            description += risuChatParser("\n\nCircumstances and context of the dialogue: " + currentChar.scenario, {chara: currentChar})
        }

        baseDescriptionPrompt = setRequestStatusSource({
            role: 'system',
            content: description
        }, 'character', currentChar.name)
        unformated.description.push(baseDescriptionPrompt)

    }

    const lorepmt = await loadLoreBookV3Prompt()
    const narrativeContextObservation: {
        mode: 'disabled' | 'legacy' | 'current'
        promptMode: 'disabled' | 'v2-current' | 'bounded-v1-fallback'
        reason: string
        baselineCharacters: number
        activeFacts: number
        recentEvents: number
        availableHistoryMessages: number
        selectedHistoryMessages: number
        graphRevision: number
        indexRevision: number
        cacheStatus: 'disabled' | 'current' | 'missing-or-stale'
        candidateCount: number
        inspectedNodeCount: number
        inspectedEdgeCount: number
        selectedNodeCount: number
        selectedTokens: number
        selectedSourceIds: string[]
        inquiryDurationMs: number
    } = {
        mode: 'disabled',
        promptMode: 'disabled',
        reason: 'opt-in-disabled',
        baselineCharacters: 0,
        activeFacts: 0,
        recentEvents: 0,
        availableHistoryMessages: 0,
        selectedHistoryMessages: 0,
        graphRevision: 0,
        indexRevision: 0,
        cacheStatus: 'disabled',
        candidateCount: 0,
        inspectedNodeCount: 0,
        inspectedEdgeCount: 0,
        selectedNodeCount: 0,
        selectedTokens: 0,
        selectedSourceIds: [],
        inquiryDurationMs: 0,
    }
    if (isNarrativeContextOptedIn()) {
        narrativeContextObservation.mode = 'legacy'
        narrativeContextObservation.reason = 'current-state-unavailable'
        try {
            const narrativeContext = await storedResponseMemoryAnalysis.prepareContext(
                currentChar.chaId,
                narrativeSessionChatId,
                projectActiveNarrativeSources({
                    characterId: currentChar.chaId,
                    description: baseDescriptionPrompt?.content
                        ?? currentChar.desc,
                    actives: lorepmt.activeSources,
                })
            )
            if (narrativeContext === null) {
                narrativeContextObservation.reason =
                    'context-preparation-deferred'
            }
            else {
            narrativeContextObservation.baselineCharacters =
                narrativeContext.baseline?.length ?? 0
            narrativeContextObservation.reason = narrativeContext.sourceChanged
                ? 'source-changed'
                : 'current-state-empty'
            const currentInput = currentChat.message.findLast(
                (message) => message.role === 'user'
                    && typeof message.data === 'string'
            )?.data ?? ''
            let sources: Awaited<
                ReturnType<typeof loadNarrativeInquiry>
            >['sources'] = []
            if (!narrativeContext.sourceChanged
                && currentInput.trim().length > 0) {
                const inquiryStartedAt = performance.now()
                try {
                    const inquirySettings = resolvedRisuBardSettings(currentChat)
                    const inquiry = await loadNarrativeInquiry({
                        characterId: currentChar.chaId,
                        chatId: narrativeSessionChatId,
                        currentInput,
                        entityHints: lorepmt.bardWikiEntityHints,
                        tokenBudget: {
                            target: inquirySettings.risuBardInquiryTargetTokenBudget,
                            events: inquirySettings.risuBardInquiryEventTokenBudget,
                            perSource: inquirySettings.risuBardInquirySourceTokenBudget,
                            maximum: inquirySettings.risuBardInquiryMaximumTokenBudget,
                        },
                        sourceMatches: findHistoricalSourceMatches({
                            currentInput,
                            messages: currentChat.message,
                            excludeRecentMessages: normalizeNarrativeWorkingMessageLimit(
                                inquirySettings.risuBardResponseMessageCount
                            ),
                            maximumMatches:
                                inquirySettings.risuBardHistoricalSourceMatchLimit,
                        }),
                        sourceLimit:
                            inquirySettings.risuBardHistoricalSourceMatchLimit,
                        resolveSourceMatches: (messageIds) =>
                            resolveHistoricalSourceMatchesById({
                                messageIds,
                                messages: currentChat.message,
                                currentInput,
                                excludeRecentMessages:
                                    normalizeNarrativeWorkingMessageLimit(
                                        inquirySettings.risuBardResponseMessageCount
                                    ),
                            }),
                        fetchImpl: fetch,
                        createAuth: () => forageStorage.createAuth(),
                    })
                    sources = inquiry.sources
                    narrativeContextObservation.promptMode = inquiry.mode
                    narrativeContextObservation.graphRevision =
                        inquiry.graphRevision
                    narrativeContextObservation.indexRevision =
                        inquiry.indexRevision
                    narrativeContextObservation.cacheStatus =
                        inquiry.cacheStatus
                    narrativeContextObservation.candidateCount =
                        inquiry.metrics.candidateCount
                    narrativeContextObservation.inspectedNodeCount =
                        inquiry.metrics.inspectedNodeCount
                    narrativeContextObservation.inspectedEdgeCount =
                        inquiry.metrics.inspectedEdgeCount
                    narrativeContextObservation.selectedNodeCount =
                        inquiry.metrics.selectedNodeCount
                    narrativeContextObservation.selectedTokens =
                        inquiry.metrics.selectedTokens
                    narrativeContextObservation.selectedSourceIds =
                        inquiry.sources.map((source) => source.id)
                }
                catch (error) {
                    narrativeContext.sourceChanged = true
                    narrativeContextObservation.mode = 'legacy'
                    narrativeContextObservation.promptMode =
                        'bounded-v1-fallback'
                    narrativeContextObservation.reason =
                        'inquiry-and-fallback-failed'
                    console.warn('RisuBard narrative inquiry fallback', error)
                }
                finally {
                    narrativeContextObservation.inquiryDurationMs =
                        performance.now() - inquiryStartedAt
                }
            }
            const responseWikiPromptPreset = resolveWikiPromptPreset(
                DBState.db.risuBardWikiPromptPresets,
                DBState.db.risuBardChatWikiPromptPresetId
            )
            const responseWikiPromptGuide = responseWikiPromptPreset
                ? compileWikiPromptGuide(responseWikiPromptPreset).response
                : ''
            const currentPrompt = narrativeContext.sourceChanged
                ? null
                : createNarrativeSourcesPrompt(
                    sources,
                    narrativeContext.baseline ?? '',
                    12_000,
                    responseWikiPromptGuide
                )
            if (currentPrompt) {
                narrativeContextObservation.mode = 'current'
                narrativeContextObservation.reason =
                    narrativeContextObservation.promptMode === 'v2-current'
                        ? 'v2-inquiry-injected'
                        : 'bounded-fallback-injected'
                const baseline = narrativeContext.baseline?.trim() ?? ''
                const requestStatusSources: RequestInjectionSource[] = []
                if (baseline && currentPrompt.includes(baseline)) {
                    requestStatusSources.push({
                        kind: 'character',
                        name: currentChar.name,
                        role: 'system',
                        content: baseline,
                    })
                }
                if (responseWikiPromptGuide
                    && currentPrompt.includes(responseWikiPromptGuide)) {
                    requestStatusSources.push({
                        kind: 'wiki',
                        name: language.risuBardWikiPrompt.responseGuideInjection,
                        role: 'system',
                        content: responseWikiPromptGuide,
                    })
                }
                for (const source of selectPromptedNarrativeSources(
                    sources,
                    currentPrompt
                )) {
                    requestStatusSources.push({
                        kind: source.id.includes(':wiki:') ? 'wiki' : 'memory',
                        name: narrativeSourceDisplayName(
                            source.id,
                            source.displayName
                        ),
                        role: 'system',
                        content: source.content,
                    })
                }
                const currentContextMessage: OpenAIChat = {
                    role: 'system',
                    content: currentPrompt,
                    requestStatusSources,
                }
                if (requestStatusSources.length === 0) {
                    setRequestStatusSource(currentContextMessage, 'memory')
                }
                const mergedContext = mergeNarrativeContextWithStaticPrompt({
                    currentContext: currentContextMessage,
                    baseline,
                    baseDescription: baseDescriptionPrompt,
                    descriptionPrompts: unformated.description,
                    afterDescriptionPrompts,
                    activeLorePrompts: lorepmt.actives,
                })
                baseDescriptionPrompt = mergedContext.baseDescription
                unformated.description = mergedContext.descriptionPrompts
                afterDescriptionPrompts = mergedContext.afterDescriptionPrompts
                lorepmt.actives = mergedContext.activeLorePrompts
            }
            }
        }
        catch (error) {
            narrativeContextObservation.reason = 'context-preparation-failed'
            console.warn('RisuBard narrative context fallback', error)
        }
    }

    const positionRegex = /{{position::(.+?)}}/g
    const replaceposition = (text:string):{text:string, replaced:boolean} => {
        let replaced = false
        const result = text.replace(positionRegex, (match, p1) => {
            replaced = true
            const posMatch = 'pt_' + p1
            const matchingPrompts: string[] = []
            for (const v of lorepmt.actives) {
                if (v.pos === posMatch) {
                    matchingPrompts.push(v.prompt)
                }
            }
            return matchingPrompts.join('\n')
        })
        return {text: result, replaced}
    }

    // maxDepth controls how many levels of nesting are resolved. Currently set to 5, adjust if needed.
    const resolvePosition = (text:string, maxDepth:number = 5) => {
        let result = text
        for(let i=0; i<maxDepth;i++) {
            const r = replaceposition(result)
            result = r.text
            if(!r.replaced) break
        }
        result = result.replace(positionRegex, '')
        return result
    }

    const normalActives = lorepmt.actives.filter(v => {
        return v.pos === '' && v.inject === null
    })
    console.log(normalActives)

    for(const lorebook of normalActives){
        unformated.lorebook.push(setRequestStatusSource({
            role: lorebook.role,
            content: risuChatParser(resolvePosition(lorebook.prompt), {chara: currentChar})
        }, lorebook.requestStatusKind, lorebook.source))
    }

    const descActives = lorepmt.actives.filter(v => {
        return v.pos === 'after_desc' || v.pos === 'before_desc' || v.pos === 'personality' || v.pos === 'scenario'
    })

    for(const lorebook of descActives){
        const c = setRequestStatusSource({
            role: lorebook.role,
            content: risuChatParser(resolvePosition(lorebook.prompt), {chara: currentChar})
        }, lorebook.requestStatusKind, lorebook.source)
        if(lorebook.pos === 'before_desc'){
            beforeDescriptionPrompts.unshift(c)
            unformated.description.unshift(c)
        }
        else{
            afterDescriptionPrompts.push(c)
            unformated.description.push(c)
        }
    }

    const personaPromptText = getPersonaPrompt()
    if(personaPromptText){
        unformated.personaPrompt.push(setRequestStatusSource({
            role: 'system',
            content: risuChatParser(personaPromptText, {chara: currentChar})
        }, 'persona'))
    }
    
    if(currentChar.inlayViewScreen){
        if(currentChar.viewScreen === 'emotion'){
            unformated.postEverything.push({
                role: 'system',
                content: currentChar.newGenData.emotionInstructions.replaceAll('{{slot}}', currentChar.emotionImages.map((v) => v[0]).join(', '))
            })
        }
        if(currentChar.viewScreen === 'imggen'){
            unformated.postEverything.push({
                role: 'system',
                content: currentChar.newGenData.instructions
            })
        }
    }

    const postEverythingLorebooks = lorepmt.actives.filter(v => {
        return v.pos === 'depth' && v.depth === 0 && v.role !== 'assistant'
    })
    for(const lorebook of postEverythingLorebooks){
        unformated.postEverything.push(setRequestStatusSource({
            role: lorebook.role,
            content: risuChatParser(resolvePosition(lorebook.prompt), {chara: currentChar})
        }, lorebook.requestStatusKind, lorebook.source))
    }

    //Since assistant needs to be prefill, we need to add assistant lorebooks after user/system lorebooks
    const postEverythingAssistantLorebooks = lorepmt.actives.filter(v => {
        return v.pos === 'depth' && v.depth === 0 && v.role === 'assistant'
    })

    const injectionLorebooks = lorepmt.actives.filter(v => {
        return v.inject && !v.inject.lore
    })

    const injectionLorePosSet = new Set<string>()
    for(const lorebook of injectionLorebooks){
        injectionLorePosSet.add(lorebook.inject.location)
    }
    
    for(const lorebook of postEverythingAssistantLorebooks){
        unformated.postEverything.push(setRequestStatusSource({
            role: lorebook.role,
            content: risuChatParser(resolvePosition(lorebook.prompt), {chara: currentChar})
        }, lorebook.requestStatusKind, lorebook.source))
    }

    //await tokenize currernt
    let currentTokens = maxResponseTokens
    let supaMemoryCardUsed = false
    
    //for unexpected error
    currentTokens += 50
    
    const positionParser = (text:string, loc:string) => {
        console.log(injectionLorePosSet)
        if(injectionLorePosSet.has(loc)){
            const matchings = injectionLorebooks.filter(v => {
                return v.inject.location === loc
            })
            for(const lore of matchings){
                switch(lore.inject.operation){
                    case 'append':{
                        text += ' ' + lore.prompt
                        break
                    }
                    case 'prepend':{
                        text = lore.prompt + ' ' + text
                        break
                    }
                    case 'replace':{
                        text = text.replace(lore.inject.param, lore.prompt)
                        break
                    }
                }
            }
        }

        return resolvePosition(text)
    }

    let hasCachePoint = false
    const convertPromptRole = {
        "system": "system",
        "user": "user",
        "bot": "assistant",
    } as const

    function applyPromptBlockRole(chats:OpenAIChat[], role?: 'user'|'bot'|'system'){
        console.log("Applying ", chats, role)
        if(!role){
            return
        }
        for(const chat of chats){
            chat.role = convertPromptRole[role]
        }
    }

    function getDescriptionPrompts(role?: 'user'|'bot'|'system'){
        const pmt = [
            ...safeStructuredClone(beforeDescriptionPrompts),
            ...(baseDescriptionPrompt ? [safeStructuredClone(baseDescriptionPrompt)] : []),
            ...safeStructuredClone(afterDescriptionPrompts)
        ]
        if(baseDescriptionPrompt){
            applyPromptBlockRole([pmt[beforeDescriptionPrompts.length]], role)
        }
        return pmt
    }

    if(promptTemplate){
        const template = promptTemplate

        async function tokenizeChatArray(chats:OpenAIChat[]){
            for(const chat of chats){
                const tokens = await tokenizer.tokenizeChat(chat)
                currentTokens += tokens
            }
        }

        for(const card of template){
            switch(card.type){
                case 'persona':{
                    let pmt = safeStructuredClone(unformated.personaPrompt)
                    applyPromptBlockRole(pmt, card.role2)
                    if(card.innerFormat && pmt.length > 0){
                        for(let i=0;i<pmt.length;i++){
                            pmt[i].content = risuChatParser(positionParser(card.innerFormat,card.type), {chara: currentChar}).replace('{{slot}}', pmt[i].content)
                        }
                    }

                    await tokenizeChatArray(pmt)
                    break
                }
                case 'description':{
                    let pmt = getDescriptionPrompts(card.role2)
                    if(card.innerFormat && pmt.length > 0){
                        for(let i=0;i<pmt.length;i++){
                            pmt[i].content = risuChatParser(positionParser(card.innerFormat,card.type), {chara: currentChar}).replace('{{slot}}', pmt[i].content)
                        }
                    }

                    await tokenizeChatArray(pmt)
                    break
                }
                case 'authornote':{
                    let pmt = safeStructuredClone(unformated.authorNote)
                    applyPromptBlockRole(pmt, card.role2)
                    if(card.innerFormat && pmt.length > 0){
                        for(let i=0;i<pmt.length;i++){
                            pmt[i].content = risuChatParser(positionParser(card.innerFormat,card.type), {chara: currentChar}).replace('{{slot}}', pmt[i].content || card.defaultText || '')
                        }
                    }

                    await tokenizeChatArray(pmt)
                    break
                }
                case 'lorebook':{
                    await tokenizeChatArray(unformated.lorebook)
                    break
                }
                case 'postEverything':{
                    await tokenizeChatArray(unformated.postEverything)
                    if(usingPromptTemplate && DBState.db.promptSettings.postEndInnerFormat){
                        await tokenizeChatArray([{
                            role: 'system',
                            content: DBState.db.promptSettings.postEndInnerFormat
                        }])
                    }
                    break
                }
                case 'plain':
                case 'jailbreak':
                case 'cot':{
                    if((!DBState.db.jailbreakToggle) && (card.type === 'jailbreak')){
                        continue
                    }
                    if((!DBState.db.chainOfThought) && (card.type === 'cot')){
                        continue
                    }

                    const posType = card.type === 'plain' ? card.type2 : card.type
                    let content = positionParser(card.text, posType)

                    if(card.type2 === 'globalNote'){
                        if(currentChar.replaceGlobalNote){
                            content = positionParser(currentChar.replaceGlobalNote, posType).replaceAll('{{original}}', content)
                        }
                        
                        if(currentChar.prebuiltAssetCommand && !card.text.includes('{{//@customimageinstruction}}')){
                            content += prebuiltAssetCommand
                        }
                        content = (risuChatParser(content, {chara: currentChar, role: card.role}))
                    }
                    else if(card.type2 === 'main'){
                        content = (risuChatParser(content, {chara: currentChar, role: card.role}))
                    }
                    else{
                        content = risuChatParser(content, {chara: currentChar, role: card.role})
                    }

                    const prompt:OpenAIChat ={
                        role: convertPromptRole[card.role],
                        content: content
                    }

                    await tokenizeChatArray([prompt])
                    break
                }
                case 'chatML':{
                    let prompts = parseChatML(card.text)
                    await tokenizeChatArray(prompts)
                    break
                }
                case 'chat':{
                    let start = card.rangeStart
                    let end = (card.rangeEnd === 'end') ? unformated.chats.length : card.rangeEnd
                    if(start === -1000){
                        start = 0
                        end = unformated.chats.length
                    }
                    if(start < 0){
                        start = unformated.chats.length + start
                        if(start < 0){
                            start = 0
                        }
                    }
                    if(end < 0){
                        end = unformated.chats.length + end
                        if(end < 0){
                            end = 0
                        }
                    }
                    
                    if(start >= end){
                        break
                    }
                    const injectedEnd = Math.min(end, unformated.chats.length)
                    let chats = unformated.chats.slice(start, injectedEnd)

                    if(usingPromptTemplate && DBState.db.promptSettings.sendChatAsSystem && (!card.chatAsOriginalOnSystem)){
                        chats = systemizeChat(chats)
                    }
                    await tokenizeChatArray(chats)
                    break
                }
                case 'memory':{
                    supaMemoryCardUsed = true
                    break
                }
                case 'cache':{
                    hasCachePoint = true
                    break
                }
            }
        }
    }
    else{
        for(const key in unformated){
            const chats = unformated[key] as OpenAIChat[]
            for(const chat of chats){
                currentTokens += await tokenizer.tokenizeChat(chat)
            }
        }
    }
    
    const examples = exampleMessage(currentChar, getUserName())

    for(const example of examples){
        currentTokens += await tokenizer.tokenizeChat(example)
    }

    let chats:OpenAIChat[] = examples

    if(!DBState.db.aiModel.startsWith('novelai') && !DBState.db?.promptSettings?.trimStartNewChat){
        chats.push({
            role: 'system',
            content: '[Start a new chat]',
            memo: "NewChat"
        })
    }

    
    let msReseted = false
    const makeMs = (currentChat:Chat) => {
        let mss:Message[] = []
        msReseted = false
        for(let i=currentChat.message.length -1;i>=0;i--){
            const d = currentChat.message[i]
            if(d.disabled === true){
                continue
            }
            if(d.disabled === 'allBefore'){
                msReseted = true
                break
            }
            mss.unshift(d)
        }
        return mss
    }

    let ms:Message[] = makeMs(currentChat)
    const addFirstMessage = async () => {
        if(msReseted || currentChat.firstMessageDisabled) return
        const firstMsg = currentChat.fmIndex === -1 ? nowChatroom.firstMessage : nowChatroom.alternateGreetings[currentChat.fmIndex]

        const chat:OpenAIChat = {
            role: 'assistant',
            content: await (processScript(nowChatroom,
                risuChatParser(firstMsg, {chara: currentChar}),
            'editprocess'))
        }

        if(usingPromptTemplate && DBState.db.promptSettings.sendName){
            chat.content = `${currentChar.name}: ${chat.content}`
            chat.attr = ['nameAdded']
        }
        chats.push(chat)
        currentTokens += await tokenizer.tokenizeChat(chat)
    }
    console.log('Prepared messages for token calculation:', ms)

    const triggerResult = await runTrigger(currentChar, 'start', {chat: currentChat})
    if(triggerResult){
        currentChat = triggerResult.chat
        setCurrentChat(currentChat)
        ms = makeMs(currentChat)
        currentTokens += triggerResult.tokens
        if(triggerResult.stopSending){
            endGeneration(genKey)
            if (realChatId) clearPendingSend(realChatId)
            return false
        }
    }

    narrativeContextObservation.availableHistoryMessages = ms.length
    const narrativeWorkingMessageLimit =
        normalizeNarrativeWorkingMessageLimit(
            resolvedRisuBardSettings(currentChat).risuBardResponseMessageCount
        )
    ms = selectNarrativeWorkingMessages(
        ms,
        narrativeWorkingMessageLimit,
        !resolvedRisuBardSettings(currentChat).risuBardResponseExcludeUserMessages
    )
    narrativeContextObservation.selectedHistoryMessages = ms.length

    if(shouldIncludeNarrativeFirstMessage(
            narrativeContextObservation.availableHistoryMessages,
            narrativeWorkingMessageLimit
        )){
        await addFirstMessage()
    }

    let index = 0
    for(const msg of ms){
        let formatedChat = (await processScriptFull(nowChatroom,risuChatParser(msg.data, {chara: currentChar, role: msg.role}), 'editprocess', index, {
            chatRole: msg.role,
        })).data
        let name = ''
        if(msg.role === 'char'){
            if(msg.saying){
                name = `${findCharacterbyIdwithCache(msg.saying).name}`
            }
            else{
                name = `${currentChar.name}`
            }
        }
        else if(msg.role === 'user'){
            name = `${getUserName()}`
        }
        if(!msg.chatId){
            msg.chatId = v4()
        }
        let inlays:string[] = []
        if(msg.role === 'char'){
            formatedChat = formatedChat.replace(/{{(inlay|inlayed|inlayeddata)::(.+?)}}/g, (
                match: string,
                p1: string,
                p2: string
            ) => {
                if(p2 && p1 === 'inlayeddata'){
                    inlays.push(p2)
                }
                return ''
            })
        }
        else{
            const inlayMatch = formatedChat.match(/{{(inlay|inlayed|inlayeddata)::(.+?)}}/g)
            if(inlayMatch){
                for(const inlay of inlayMatch){
                    inlays.push(inlay)
                }
            }
        }

        let multimodal:MultiModal[] = []
        const modelinfo = getModelInfo(DBState.db.aiModel)
        if(inlays.length > 0){
            for(const inlay of inlays){
                const inlayName = inlay.replace('{{inlayed::', '').replace('{{inlay::', '').replace('}}', '').replace('{{inlayeddata::', '')
                const inlayData = await getInlayAsset(inlayName)
                if(inlayData?.type === 'image'){
                    if(modelinfo.flags.includes(LLMFlags.hasImageInput)){
                        multimodal.push({
                            type: 'image',
                            base64: inlayData.data,
                            width: inlayData.width,
                            height: inlayData.height
                        })
                    }
                    else{
                        const captionResult = await runImageEmbedding(inlayData.data) 
                        formatedChat += `[${captionResult[0].generated_text}]`
                    }
                }
                if(inlayData?.type === 'video' || inlayData?.type === 'audio'){
                    if(multimodal.length === 0){
                        multimodal.push({
                            type: inlayData.type,
                            base64: inlayData.data
                        })
                    }
                }
                if(inlayData?.type === 'signature'){
                    multimodal.push({
                        type: 'signature',
                        base64: inlayData.data
                    })
                }
                formatedChat = formatedChat.replace(inlay, '')
            }
        }

        let attr:string[] = []
        let role:'user'|'assistant'|'system' = msg.role === 'user' ? 'user' : 'assistant'

        if(usingPromptTemplate && DBState.db.promptSettings.sendName){
            const form = DBState.db.groupTemplate || `<{{char}}\'s Message>\n{{slot}}\n</{{char}}\'s Message>`
            formatedChat = risuChatParser(form, {chara: currentChar.name}).replace('{{slot}}', formatedChat)
        }
        let thoughts:string[] = []
        const maxThoughtDepth = DBState.db.promptSettings?.maxThoughtTagDepth ?? -1
        formatedChat = formatedChat.replace(/<Thoughts>(.+)<\/Thoughts>/gms, (match, p1) => {
            if(maxThoughtDepth === -1 || (maxThoughtDepth - ms.length) <= index){
                thoughts.push(p1)
            }
            return ''
        })

        const assetPromises:Promise<void>[] = []
        formatedChat = formatedChat.replace(/\{\{asset_?prompt::(.+?)\}\}/gmsiu, (match, p1) => {
            const moduleAssets = getModuleAssets()
            const assets = (currentChar.additionalAssets ?? []).concat(moduleAssets)
            const asset = assets.find(v => {
                return v[0] === p1
            })
            if(asset){
                assetPromises.push((async () => {
                    const assetDataBuf = await readImage(asset[1])
                    multimodal.push({
                        type: "image",
                        base64: `data:image/png;base64,${Buffer.from(assetDataBuf).toString('base64')}`
                    })
                })())
            }
            else if(p1 === 'icon'){
                assetPromises.push((async () => {
                    const assetDataBuf = await readImage(currentChar.image ?? '')
                    multimodal.push({
                        type: "image",
                        base64: `data:image/png;base64,${Buffer.from(assetDataBuf).toString('base64')}`
                    })
                })())
            }
            return ''          
        })
        await Promise.all(assetPromises)

        const chat:OpenAIChat = {
            role: role,
            content: formatedChat,
            memo: msg.chatId,
            attr: attr,
            multimodals: multimodal,
            thoughts: thoughts
        }
        if(chat.multimodals.length === 0){
            delete chat.multimodals
        }
        chats.push(chat)
        currentTokens += await tokenizer.tokenizeChat(chat)
        index++
    }
    console.log(JSON.stringify(chats, null, 2))

    const depthPrompts = lorepmt.actives.filter(v => {
        return (v.pos === 'depth' && v.depth > 0) || v.pos === 'reverse_depth'
    })

    for(const depthPrompt of depthPrompts){
        const chat:OpenAIChat = {
            role: depthPrompt.role,
            content: risuChatParser(resolvePosition(depthPrompt.prompt), {chara: currentChar})
        }
        currentTokens += await tokenizer.tokenizeChat(chat)
    }
    
    if((currentChat.supaMemory ?? nowChatroom.supaMemory) && DBState.db.hypaV3){
        stageTimings.stage1Duration = Date.now() - stageTimings.stage1Start
        setGenerationStage(genKey, 2)
        stageTimings.stage2Start = Date.now()
        console.log("Current chat's hypaV3 Data: ", currentChat.hypaV3Data)
        const sp = await hypaMemoryV3(chats, currentTokens, maxContextTokens, currentChat, nowChatroom, tokenizer)
        if(sp.error){
            // Save new summary
            if (sp.memory) {
                currentChat.hypaV3Data = sp.memory
                DBState.db.characters[selectedChar].chats[selectedChat].hypaV3Data = currentChat.hypaV3Data
            }
            console.log(sp)
            throwError(sp.error)
            if (realChatId) clearPendingSend(realChatId)
            return false
        }
        chats = sp.chats
        currentTokens = sp.currentTokens
        currentChat.hypaV3Data = sp.memory ?? currentChat.hypaV3Data
        DBState.db.characters[selectedChar].chats[selectedChat].hypaV3Data = currentChat.hypaV3Data

        currentChat = DBState.db.characters[selectedChar].chats[selectedChat];
        console.log("[Expected to be updated] chat's HypaV3Data: ", currentChat.hypaV3Data)
        stageTimings.stage2Duration = Date.now() - stageTimings.stage2Start
        setGenerationStage(genKey, 1)
    }
    else{
        stageTimings.stage1Duration = Date.now() - stageTimings.stage1Start
        while(currentTokens > maxContextTokens){
            if(chats.length <= 1){
                throwError(language.errors.toomuchtoken + "\n\nRequired Tokens: " + currentTokens)

                if (realChatId) clearPendingSend(realChatId)
                return false
            }

            currentTokens -= await tokenizer.tokenizeChat(chats[0])
            chats.splice(0, 1)
        }
    }

    let biases:[string,number][] = DBState.db.bias.concat(currentChar.bias).map((v) => {
        return [risuChatParser(v[0].replaceAll("\\n","\n").replaceAll("\\r","\r").replaceAll("\\\\","\\"), {chara: currentChar}),v[1]]
    })

    let memories:OpenAIChat[] = []



    if(!promptTemplate){
        unformated.lastChat.push(chats[chats.length - 1])
        chats.splice(chats.length - 1, 1)
    }

    unformated.chats = chats.map((v) => {
        if(v.memo !== 'supaMemory' && v.memo !== 'hypaMemory'){
            v.removable = true
        }
        else if(supaMemoryCardUsed){
            memories.push(v)
            return {
                role: 'system',
                content: '',
            } as OpenAIChat
        }
        else{
            v.content = `<Previous Conversation>${v.content}</Previous Conversation>`
        }
        return v
    }).filter((v) => {
        return v.content.trim() !== '' || (v.multimodals && v.multimodals.length > 0)
    })

    for(const depthPrompt of depthPrompts){
        const chat:OpenAIChat = setRequestStatusSource({
            role: depthPrompt.role,
            content: risuChatParser(resolvePosition(depthPrompt.prompt), {chara: currentChar})
        }, 'lorebook', depthPrompt.source)
        const depth = depthPrompt.pos === 'depth' ? (depthPrompt.depth) : (unformated.chats.length - depthPrompt.depth)
        unformated.chats.splice(depth,0,chat)
    }

    if(triggerResult){
        if(triggerResult.additonalSysPrompt.promptend){
            unformated.postEverything.push({
                role: 'system',
                content: triggerResult.additonalSysPrompt.promptend
            })
        }
        if(triggerResult.additonalSysPrompt.historyend){
            unformated.lastChat.push({
                role: 'system',
                content: triggerResult.additonalSysPrompt.historyend
            })
        }
        if(triggerResult.additonalSysPrompt.start){
            unformated.lastChat.unshift({
                role: 'system',
                content: triggerResult.additonalSysPrompt.start
            })
        }
    }

    
    //make into one

    let formated:OpenAIChat[] = []
    const formatOrder = safeStructuredClone(DBState.db.formatingOrder)
    if(formatOrder){
        formatOrder.push('postEverything')
    }

    //continue chat model
    if(arg.continue && (DBState.db.aiModel.startsWith('claude') || DBState.db.aiModel.startsWith('gpt') || DBState.db.aiModel.startsWith('openrouter') || DBState.db.aiModel.startsWith('reverse_proxy'))){
        unformated.postEverything.push({
            role: 'system',
            content: '[Continue the last response]'
        })
    }

    function pushPrompts(
        cha:OpenAIChat[],
        source?: { kind: RequestInjectionKind, name?: string },
    ){
        for(const chat of cha){
            if(!chat.content.trim() && !(chat.multimodals && chat.multimodals.length > 0)){
                continue
            }
            if(!chat.requestStatusSources?.length && source){
                setRequestStatusSource(chat, source.kind, source.name)
            }
            syncRequestStatusSource(chat)
            if(!(DBState.db.aiModel.startsWith('gpt') || DBState.db.aiModel.startsWith('claude') || DBState.db.aiModel === 'openrouter' || DBState.db.aiModel === 'reverse_proxy')){
                formated.push(chat)
                continue
            }
            if(chat.role === 'system'){
                const endf = formated.at(-1)
                if(endf && endf.role === 'system' && endf.memo === chat.memo && endf.name === chat.name){
                    if(!endf.requestStatusSources?.length){
                        setRequestStatusSource(
                            endf,
                            endf.memo === 'NewChatExample' ? 'exampleDialogue' : 'other',
                        )
                    }
                    formated[formated.length - 1].content += '\n\n' + chat.content
                    endf.requestStatusSources = [
                        ...(endf.requestStatusSources ?? []),
                        ...(chat.requestStatusSources ?? []),
                    ]
                }
                else{
                    formated.push(chat)
                }
                formated.at(-1).content += ''
            }
            else{
                formated.push(chat)
            }
        }
    }

    let promptBodyformatedForChatStore: OpenAIChat[] = []
    function pushPromptInfoBody(role: "function" | "system" | "user" | "assistant", fmt: string, promptBody: OpenAIChat[]) {
        if(!fmt.trim()){
            return
        }
        promptBody.push({
            role: role,
            content: risuChatParser(fmt),
        })
    }

    if(promptTemplate){
        const template = promptTemplate

        for(const card of template){
            switch(card.type){
                case 'persona':{
                    let pmt = safeStructuredClone(unformated.personaPrompt)
                    applyPromptBlockRole(pmt, card.role2)
                    if(card.innerFormat && pmt.length > 0){
                        for(let i=0;i<pmt.length;i++){
                            pmt[i].content = risuChatParser(positionParser(card.innerFormat,card.type), {chara: currentChar}).replace('{{slot}}', pmt[i].content)

                            if(DBState.db.promptInfoInsideChat && DBState.db.promptTextInfoInsideChat){
                                pushPromptInfoBody(pmt[i].role, card.innerFormat, promptBodyformatedForChatStore)
                            }
                        }
                    }

                    pushPrompts(pmt, { kind: 'persona' })
                    break
                }
                case 'description':{
                    let pmt = getDescriptionPrompts(card.role2)
                    if(card.innerFormat && pmt.length > 0){
                        for(let i=0;i<pmt.length;i++){
                            pmt[i].content = risuChatParser(positionParser(card.innerFormat,card.type), {chara: currentChar}).replace('{{slot}}', pmt[i].content)
                            
                            if(DBState.db.promptInfoInsideChat && DBState.db.promptTextInfoInsideChat){
                                pushPromptInfoBody(pmt[i].role, card.innerFormat, promptBodyformatedForChatStore)
                            }
                        }
                    }

                    pushPrompts(pmt, { kind: 'character', name: currentChar.name })
                    break
                }
                case 'authornote':{
                    let pmt = safeStructuredClone(unformated.authorNote)
                    applyPromptBlockRole(pmt, card.role2)
                    if(card.innerFormat && pmt.length > 0){
                        for(let i=0;i<pmt.length;i++){
                            pmt[i].content = risuChatParser(positionParser(card.innerFormat,card.type), {chara: currentChar}).replace('{{slot}}', pmt[i].content || card.defaultText || '')
                            
                            if(DBState.db.promptInfoInsideChat && DBState.db.promptTextInfoInsideChat){
                                pushPromptInfoBody(pmt[i].role, card.innerFormat, promptBodyformatedForChatStore)
                            }
                        }
                    }

                    pushPrompts(pmt, { kind: 'authorNote' })
                    break
                }
                case 'lorebook':{
                    pushPrompts(unformated.lorebook, { kind: 'lorebook' })
                    break
                }
                case 'postEverything':{
                    pushPrompts(unformated.postEverything, { kind: 'instruction' })
                    if(usingPromptTemplate && DBState.db.promptSettings.postEndInnerFormat){
                        pushPrompts([{
                            role: 'system',
                            content: DBState.db.promptSettings.postEndInnerFormat
                        }], { kind: 'instruction' })
                    }
                    break
                }
                case 'plain':
                case 'jailbreak':
                case 'cot':{
                    if((!DBState.db.jailbreakToggle) && (card.type === 'jailbreak')){
                        continue
                    }
                    if((!DBState.db.chainOfThought) && (card.type === 'cot')){
                        continue
                    }

                    const posType = card.type === 'plain' ? card.type2 : card.type
                    let content = positionParser(card.text, posType)

                    if(card.type2 === 'globalNote'){
                        if(currentChar.replaceGlobalNote){
                            content = positionParser(currentChar.replaceGlobalNote, posType).replaceAll('{{original}}', content)
                        }
                        if(currentChar.prebuiltAssetCommand && !card.text.includes('{{//@customimageinstruction}}')){
                            content += prebuiltAssetCommand
                        }
                        content = (risuChatParser(content, {chara: currentChar, role: card.role}))
                    }
                    else if(card.type2 === 'main'){
                        content = (risuChatParser(content, {chara: currentChar, role: card.role}))
                    }
                    else{
                        content = risuChatParser(content, {chara: currentChar, role: card.role})
                    }

                    const prompt:OpenAIChat ={
                        role: convertPromptRole[card.role],
                        content: content
                    }

                    if(DBState.db.promptInfoInsideChat && DBState.db.promptTextInfoInsideChat && card.type2 !== 'globalNote'){
                        pushPromptInfoBody(prompt.role, prompt.content, promptBodyformatedForChatStore)
                    }

                    pushPrompts([prompt], {
                        kind: card.type === 'jailbreak'
                            ? 'jailbreak'
                            : card.type2 === 'main'
                                ? 'systemPrompt'
                                : card.type2 === 'globalNote'
                                    ? 'globalNote'
                                    : 'instruction',
                        name: card.name,
                    })
                    break
                }
                case 'chatML':{
                    let prompts = parseChatML(card.text)
                    pushPrompts(prompts, { kind: 'instruction', name: card.name })
                    break
                }
                case 'chat':{
                    let start = card.rangeStart
                    let end = (card.rangeEnd === 'end') ? unformated.chats.length : card.rangeEnd
                    if(start === -1000){
                        start = 0
                        end = unformated.chats.length
                    }
                    if(start < 0){
                        start = unformated.chats.length + start
                        if(start < 0){
                            start = 0
                        }
                    }
                    if(end < 0){
                        end = unformated.chats.length + end
                        if(end < 0){
                            end = 0
                        }
                    }
                    
                    if(start >= end){
                        break
                    }

                    const injectedEnd = Math.min(end, unformated.chats.length)
                    let chats = unformated.chats.slice(start, injectedEnd)
                    if(usingPromptTemplate && DBState.db.promptSettings.sendChatAsSystem && (!card.chatAsOriginalOnSystem)){
                        chats = systemizeChat(chats)
                    }
                    pushPrompts(chats, {
                        kind: 'chatHistory',
                        name: `${chats.length}개 (${start + 1}~${injectedEnd})`,
                    })

                    if(DBState.db.automaticCachePoint && !hasCachePoint){
                        let pointer = formated.length - 1
                        let depthRemaining = 3
                        while(pointer >= 0){
                            if(depthRemaining === 0){
                                break
                            }
                            if(formated[pointer].role === 'user'){
                                formated[pointer].cachePoint = true
                                depthRemaining--
                            }
                            pointer--
                        }
                    }
                    break
                }
                case 'memory':{
                    let pmt = safeStructuredClone(memories)
                    applyPromptBlockRole(pmt, card.role2)
                    if(card.innerFormat && pmt.length > 0){
                        for(let i=0;i<pmt.length;i++){
                            pmt[i].content = risuChatParser(card.innerFormat, {chara: currentChar}).replace('{{slot}}', pmt[i].content)

                            if(DBState.db.promptInfoInsideChat && DBState.db.promptTextInfoInsideChat){
                                pushPromptInfoBody(pmt[i].role, card.innerFormat, promptBodyformatedForChatStore)
                            }
                        }
                    }

                    pushPrompts(pmt, { kind: 'memory' })
                    break
                }
                case 'cache':{
                    let pointer = formated.length - 1
                    let depthRemaining = card.depth
                    while(pointer >= 0){
                        if(depthRemaining === 0){
                            break
                        }
                        if(formated[pointer].role === card.role || card.role === 'all'){
                            formated[pointer].cachePoint = true
                            depthRemaining--
                        }
                        pointer--
                    }
                    break
                }
            }
        }
    }
    else{
        for(let i=0;i<formatOrder.length;i++){
            const cha = unformated[formatOrder[i]]
            const key = formatOrder[i]
            const kind: RequestInjectionKind = key === 'main' ? 'systemPrompt'
                : key === 'jailbreak' ? 'jailbreak'
                : key === 'globalNote' ? 'globalNote'
                : key === 'authorNote' ? 'authorNote'
                : key === 'description' ? 'character'
                : key === 'personaPrompt' ? 'persona'
                : key === 'lorebook' ? 'lorebook'
                : key === 'chats' || key === 'lastChat' ? 'chatHistory'
                : 'instruction'
            pushPrompts(cha, { kind })
        }
    }


    formated = formated.map((v) => {
        v.content = v.content.trim()
        return v
    })

    if(DBState.db.promptInfoInsideChat && DBState.db.promptTextInfoInsideChat){
        promptBodyformatedForChatStore = promptBodyformatedForChatStore.map((v) => {
            v.content = v.content.trim()
            return v
        })
    }


    if(currentChar.depth_prompt && currentChar.depth_prompt.prompt && currentChar.depth_prompt.prompt.length > 0){
        //depth_prompt
        const depthPrompt = currentChar.depth_prompt
        formated.splice(formated.length - depthPrompt.depth, 0, setRequestStatusSource({
            role: 'system',
            content: risuChatParser(depthPrompt.prompt, {chara: currentChar})
        }, 'instruction'))
    }

    formated = await runLuaEditTrigger(currentChar, 'editRequest', formated)
    for(const message of formated) syncRequestStatusSource(message)

    if(DBState.db.promptInfoInsideChat && DBState.db.promptTextInfoInsideChat){
        promptBodyformatedForChatStore = await runLuaEditTrigger(currentChar, 'editRequest', promptBodyformatedForChatStore)
        promptInfo.promptText = promptBodyformatedForChatStore
    }

    //token rechecking
    let inputTokens = 0
    const messageTokenCountsByMessage = new Map<OpenAIChat, number>()

    for(const chat of formated){
        const messageTokens = await tokenizer.tokenizeChat(chat)
        messageTokenCountsByMessage.set(chat, messageTokens)
        inputTokens += messageTokens
    }

    if(inputTokens > maxContextTokens){
        let pointer = 0
        while(inputTokens > maxContextTokens){
            if(pointer >= formated.length){
                throwError(language.errors.toomuchtoken + "\n\nAt token rechecking. Required Tokens: " + inputTokens)
                if (realChatId) clearPendingSend(realChatId)
                return false
            }
            if(formated[pointer].removable){
                inputTokens -= await tokenizer.tokenizeChat(formated[pointer])
                formated[pointer].content = ''
                if(formated[pointer].multimodals?.length > 0){
                    try {
                        messageTokenCountsByMessage.set(
                            formated[pointer],
                            await tokenizer.tokenizeChat(formated[pointer])
                        )
                    }
                    catch {
                        messageTokenCountsByMessage.set(
                            formated[pointer],
                            Number.NaN
                        )
                    }
                }
            }
            pointer++
        }
        formated = formated.filter((v) => {
            return v.content !== ''  || (v.multimodals && v.multimodals.length > 0)
        })
    }
    //estimate tokens
    let outputTokens = maxResponseTokens
    if(inputTokens + outputTokens > maxContextTokens){
        outputTokens = maxContextTokens - inputTokens
    }
    // generationId minted at the top of sendChat (registered in the
    // generation-state map alongside the real chat id).
    const generationModel = getGenerationModelString()

    generationInfo = {
        model: generationModel,
        generationId: generationId,
        inputTokens: inputTokens,
        outputTokens: outputTokens,
        maxContext: maxContextTokens,
        risuBardContext: createRisuBardContextTrace({
            mode: narrativeContextObservation.mode,
            recentMessages: traceRecentMessagesFromPrompt(formated),
            selectedSourceIds: narrativeContextObservation.selectedSourceIds,
            selectedTokens: narrativeContextObservation.selectedTokens,
            inquiryDurationMs: narrativeContextObservation.inquiryDurationMs,
        }),
        stageTiming: {
            stage1: stageTimings.stage1Duration,
            stage2: stageTimings.stage2Duration,
            stage3: 0,
            stage4: 0
        }
    }

    // Continue writes into the previous reply: stamp it with THIS
    // generation's id up front so recovery attributes a mid-continue death to
    // the continued message (fill/skip) instead of inserting a duplicate.
    if(arg.continue && !arg.preview && !arg.previewPrompt){
        const contMsgs = DBState.db.characters[selectedChar].chats[selectedChat].message
        if(contMsgs.length > 0){
            contMsgs[contMsgs.length - 1].generationInfo = generationInfo
        }
    }

    setGenerationStage(genKey, 3)
    stageTimings.stage3Start = Date.now()
    if(arg.preview){
        previewFormated = formated
        return true
    }

    console.info('[RisuBard context mode]', {
        ...narrativeContextObservation,
        historyPolicy: `bounded-recent-${narrativeWorkingMessageLimit}`,
        finalMessageCount: formated.length,
        removableMessageCount: formated.filter(
            (message) => message.removable
        ).length,
        inputTokens,
        maxContextTokens,
    })
    publishRisuBardMemoryActivity({
        characterId: currentChar.chaId,
        chatId: narrativeSessionChatId,
        operation: 'request',
        timestamp: Date.now(),
        message: `${generationModel} 요청 시작`,
        wikiPaths: generationInfo.risuBardContext?.wikiPaths,
    })

    const req = await requestChatData({
        formated: formated,
        biasString: biases,
        currentChar: currentChar,
        useStreaming: true,
        isGroupChat: false,
        bias: {},
        continue: arg.continue,
        chatId: generationId,
        realChatId: realChatId,
        logPurpose: 'chat-response',
        imageResponse: DBState.db.outputImageModal,
        previewBody: arg.previewPrompt,
        escape: nowChatroom.type === 'character' && nowChatroom.escapeOutput,
        rememberToolUsage: DBState.db.rememberToolUsage,
    }, 'model', abortSignal)

    console.log(req)
    if(req.model){
        generationInfo.model = getGenerationModelString(req.model)
        console.log(generationInfo.model, req.model)
    }
    generationInfo.toolUsed = 'toolExecuted' in req
        && req.toolExecuted === true

    if(arg.previewPrompt && req.type === 'success'){
        previewBody = req.result
        return true
    }

    let result = ''
    let emoChanged = false
    let resendChat = false
    let outputMessageId: string | undefined
    
    if(abortSignal.aborted === true){
        if (realChatId) clearPendingSend(realChatId)
        return false
    }
    if(req.type === 'fail'){
        throwError(req.result)
        endGeneration(genKey)
        if (realChatId) clearPendingSend(realChatId)
        return false
    }
    else if(req.type === 'streaming'){
        const reader = req.result.getReader()
        let msgIndex = DBState.db.characters[selectedChar].chats[selectedChat].message.length
        let prefix = ''
        if(arg.continue){
            msgIndex -= 1
            prefix = DBState.db.characters[selectedChar].chats[selectedChat].message[msgIndex].data
        }
        else{
            DBState.db.characters[selectedChar].chats[selectedChat].message.push({
                role: 'char',
                data: "",
                saying: currentChar.chaId,
                time: Date.now(),
                generationInfo,
                promptInfo,
                chatId: generationId,
            })
        }
        outputMessageId = DBState.db.characters[selectedChar].chats[selectedChat].message[msgIndex]?.chatId
        const performanceMode: StreamingDisplayOptimizationMode = DBState.db.streamingDisplayOptimizationMode ?? 'balanced'
        DBState.db.characters[selectedChar].chats[selectedChat].isStreaming = true
        DBState.db.characters[selectedChar].chats[selectedChat].activeStreamingDisplayOptimizationMode = performanceMode
        DBState.db.characters[selectedChar].reloadKeys += 1
        let lastResponseChunk:{[key:string]:string} = {}
        let streamAborted:boolean = abortSignal.aborted
        let receivedStreamingResult = false
        const deferStreamingPostProcessing = performanceMode === 'strong'
        const coalesceStreamingDisplay = performanceMode === 'balanced' || performanceMode === 'strong'
        const streamingDisplayFlushDelay = 125
        let pendingStreamingResult: string | null = null
        let streamingFlushTimer: ReturnType<typeof setTimeout> | null = null
        let streamingFlushFrame: number | null = null
        let streamingFlushPromise: Promise<void> | null = null
        let streamingFlushQueued = false
        let streamingFlushError: unknown = null
        const clearStreamingFlushSchedule = () => {
            if(streamingFlushTimer !== null){
                clearTimeout(streamingFlushTimer)
                streamingFlushTimer = null
            }
            if(streamingFlushFrame !== null){
                cancelAnimationFrame(streamingFlushFrame)
                streamingFlushFrame = null
            }
        }
        const flushStreamingDisplay = async () => {
            clearStreamingFlushSchedule()
            if(streamingFlushPromise){
                streamingFlushQueued = true
                return streamingFlushPromise
            }
            streamingFlushPromise = (async () => {
                do {
                    streamingFlushQueued = false
                    const nextResult = pendingStreamingResult
                    pendingStreamingResult = null
                    if(nextResult === null){
                        continue
                    }
                    if(deferStreamingPostProcessing){
                        DBState.db.characters[selectedChar].chats[selectedChat].message[msgIndex].data = reformatContent(prefix + nextResult)
                        DBState.db.characters[selectedChar].reloadKeys += 1
                        continue
                    }
                    let result2 = await processScriptFull(nowChatroom, reformatContent(prefix + nextResult), 'editoutput', msgIndex)
                    DBState.db.characters[selectedChar].chats[selectedChat].message[msgIndex].data = result2.data
                    emoChanged = result2.emoChanged
                    DBState.db.characters[selectedChar].reloadKeys += 1
                } while(streamingFlushQueued || pendingStreamingResult !== null)
            })().finally(() => {
                streamingFlushPromise = null
            })
            return streamingFlushPromise
        }
        const scheduleStreamingDisplayFlush = () => {
            if(streamingFlushTimer !== null || streamingFlushFrame !== null){
                return
            }
            streamingFlushTimer = setTimeout(() => {
                streamingFlushTimer = null
                streamingFlushFrame = requestAnimationFrame(() => {
                    streamingFlushFrame = null
                    void flushStreamingDisplay().catch((error) => {
                        streamingFlushError ??= error
                        void reader.cancel().catch(() => {})
                    })
                })
            }, streamingDisplayFlushDelay)
        }
        const abortReader = () => {
            streamAborted = true
            void reader.cancel().catch(() => {})
        }
        abortSignal.addEventListener('abort', abortReader, { once: true })
        try {
            while(streamAborted === false){
                let readed: ReadableStreamReadResult<{ [key: string]: string }>
                let readFailure: unknown
                try {
                    readed = await reader.read()
                }
                catch(error){
                    if(abortSignal.aborted || streamAborted){
                        streamAborted = true
                        break
                    }
                    const partial = getPartialPresetStreamText(error)
                    if (partial === undefined) throw error
                    readed = { done: false, value: { "0": partial } }
                    readFailure = error
                }
                if(readed.value){
                    receivedStreamingResult = true
                    lastResponseChunk = readed.value
                    const firstChunkKey = Object.keys(lastResponseChunk)[0]
                    result = lastResponseChunk[firstChunkKey]
                    if(!result){
                        result = ''
                    }
                    if(DBState.db.removeIncompleteResponse){
                        result = trimUntilPunctuation(result)
                    }
                    if(coalesceStreamingDisplay){
                        pendingStreamingResult = result
                        scheduleStreamingDisplayFlush()
                    }
                    else{
                        let result2 = await processScriptFull(nowChatroom, reformatContent(prefix + result), 'editoutput', msgIndex)
                        DBState.db.characters[selectedChar].chats[selectedChat].message[msgIndex].data = result2.data
                        emoChanged = result2.emoChanged
                        DBState.db.characters[selectedChar].reloadKeys += 1
                    }
                }
                // Render the last received snapshot, but do not run successful
                // turn completion / automatic wiki analysis for a failed stream.
                if (readFailure) throw readFailure
                if(readed.done){
                    break
                }
            }
        }
        finally {
            abortSignal.removeEventListener('abort', abortReader)
            try {
                if(coalesceStreamingDisplay){
                    try {
                        await flushStreamingDisplay()
                    }
                    catch(error){
                        streamingFlushError ??= error
                    }
                }
                if(streamingFlushError !== null){
                    throw streamingFlushError
                }
                if(deferStreamingPostProcessing && receivedStreamingResult){
                    let result2 = await processScriptFull(nowChatroom, reformatContent(prefix + result), 'editoutput', msgIndex)
                    DBState.db.characters[selectedChar].chats[selectedChat].message[msgIndex].data = result2.data
                    emoChanged = result2.emoChanged
                }
            }
            finally {
                DBState.db.characters[selectedChar].chats[selectedChat].isStreaming = false
                DBState.db.characters[selectedChar].chats[selectedChat].activeStreamingDisplayOptimizationMode = undefined
                DBState.db.characters[selectedChar].reloadKeys += 1
                void reader.cancel().catch(() => {})
            }
        }

        if(streamAborted || abortSignal.aborted){
            if (realChatId) clearPendingSend(realChatId)
            return false
        }

        DBState.db.characters[selectedChar].chats[selectedChat] = runCurrentChatFunction(DBState.db.characters[selectedChar].chats[selectedChat])
        currentChat = DBState.db.characters[selectedChar].chats[selectedChat]        
        const triggerResult = await runTrigger(currentChar, 'output', {chat:currentChat})
        if(triggerResult && triggerResult.chat){
            currentChat = normalizeChat(triggerResult.chat)
        }
        if(triggerResult && triggerResult.sendAIprompt){
            resendChat = true
        }
        const inlayr = runInlayScreen(currentChar, currentChat.message[msgIndex].data)
        currentChat.message[msgIndex].data = inlayr.text
        DBState.db.characters[selectedChar].chats[selectedChat] = currentChat
        if(inlayr.promise){
            const t = await inlayr.promise
            currentChat.message[msgIndex].data = t
            DBState.db.characters[selectedChar].chats[selectedChat] = currentChat
        }
        await dispatchCommittedChatOutput(pluginV2.chatOutput, {
            char: currentChar,
            chat: currentChat,
            characterIndex: selectedChar,
            chatIndex: selectedChat,
            messageIndex: findMessageIndexByChatId(currentChat, outputMessageId),
        })
        if(DBState.db.ttsAutoSpeech){
            await sayTTS(currentChar, result)
        }
    }
    else{
        const msgs = (req.type === 'success') ? [['char',req.result]] as const 
                    : (req.type === 'multiline') ? req.result
                    : []
        let mrerolls:string[] = []
        for(let i=0;i<msgs.length;i++){
            let msg = msgs[i]
            let mess = msg[1]
            let msgIndex = DBState.db.characters[selectedChar].chats[selectedChat].message.length
            let result2 = await processScriptFull(nowChatroom, reformatContent(mess), 'editoutput', msgIndex)
            if(i === 0 && arg.continue){
                msgIndex -= 1
                let beforeChat = DBState.db.characters[selectedChar].chats[selectedChat].message[msgIndex]
                result2 = await processScriptFull(nowChatroom, reformatContent(beforeChat.data + mess), 'editoutput', msgIndex)
            }
            if(DBState.db.removeIncompleteResponse){
                result2.data = trimUntilPunctuation(result2.data)
            }
            result = result2.data
            const inlayResult = runInlayScreen(currentChar, result)
            result = inlayResult.text
            emoChanged = result2.emoChanged
            if(i === 0 && arg.continue){
                DBState.db.characters[selectedChar].chats[selectedChat].message[msgIndex] = {
                    role: 'char',
                    data: result,
                    saying: currentChar.chaId,
                    time: Date.now(),
                    generationInfo,
                    promptInfo,
                    // Keep the original message identity: older jobs match on it
                    // (jobRecovery secondary match) — see the continue restamp note.
                    chatId: DBState.db.characters[selectedChar].chats[selectedChat].message[msgIndex]?.chatId ?? generationId,
                }       
                if(inlayResult.promise){
                    const p = await inlayResult.promise
                    DBState.db.characters[selectedChar].chats[selectedChat].message[msgIndex].data = p
                }
            }
            else if(i===0){
                DBState.db.characters[selectedChar].chats[selectedChat].message.push({
                    role: msg[0],
                    data: result,
                    saying: currentChar.chaId,
                    time: Date.now(),
                    generationInfo,
                    promptInfo,
                    chatId: generationId,
                })
                const ind = DBState.db.characters[selectedChar].chats[selectedChat].message.length - 1
                if(inlayResult.promise){
                    const p = await inlayResult.promise
                    DBState.db.characters[selectedChar].chats[selectedChat].message[ind].data = p
                }
                mrerolls.push(result)
            }
            else{
                mrerolls.push(result)
            }
            if(i === 0){
                outputMessageId = DBState.db.characters[selectedChar].chats[selectedChat].message[msgIndex]?.chatId
            }
            DBState.db.characters[selectedChar].reloadKeys += 1
            if(DBState.db.ttsAutoSpeech){
                await sayTTS(currentChar, result)
            }
        }

        DBState.db.characters[selectedChar].chats[selectedChat] = runCurrentChatFunction(DBState.db.characters[selectedChar].chats[selectedChat])
        currentChat = DBState.db.characters[selectedChar].chats[selectedChat]        

        const triggerResult = await runTrigger(currentChar, 'output', {chat:currentChat})
        if(triggerResult && triggerResult.chat){
            currentChat = normalizeChat(triggerResult.chat)
            DBState.db.characters[selectedChar].chats[selectedChat] = currentChat
        }
        if(triggerResult && triggerResult.sendAIprompt){
            resendChat = true
        }
        await dispatchCommittedChatOutput(pluginV2.chatOutput, {
            char: currentChar,
            chat: currentChat,
            characterIndex: selectedChar,
            chatIndex: selectedChat,
            messageIndex: findMessageIndexByChatId(currentChat, outputMessageId),
        })
    }

    let needsAutoContinue = false
    const resultTokens = await tokenize(result) + (arg.usedContinueTokens || 0)
    if (generationInfo) generationInfo.outputTokens = resultTokens
    if(DBState.db.autoContinueMinTokens > 0 && resultTokens < DBState.db.autoContinueMinTokens){
        needsAutoContinue = true
    }

    if(DBState.db.autoContinueChat && (!isLastCharPunctuation(result))){
        //if result doesn't end with punctuation or special characters, auto continue
        needsAutoContinue = true
    }

    if(needsAutoContinue){
        endGeneration(genKey, { keepPendingAbort: true })
        return await sendChat(chatProcessIndex, {
            chatAdditonalTokens: arg.chatAdditonalTokens,
            continue: true,
            signal: abortSignal,
            usedContinueTokens: resultTokens
        })
    }

    const igp = risuChatParser(DBState.db.igpPrompt ?? "")

    if(igp){
        const igpFormated = parseChatML(igp)
        const rq = await requestChatData({
            formated: igpFormated,
            bias: {}
        },'emotion', abortSignal)

        DBState.db.characters[selectedChar].chats[selectedChat].message[DBState.db.characters[selectedChar].chats[selectedChat].message.length - 1].data += rq
    }

    stageTimings.stage3Duration = Date.now() - stageTimings.stage3Start

    if(generationInfo.stageTiming) {
        generationInfo.stageTiming.stage3 = stageTimings.stage3Duration
    }
    setGenerationStage(genKey, 4)
    stageTimings.stage4Start = Date.now()

    if(resendChat){
        stageTimings.stage4Duration = Date.now() - stageTimings.stage4Start
        
        if(generationInfo.stageTiming) {
            generationInfo.stageTiming.stage1 = stageTimings.stage1Duration
            generationInfo.stageTiming.stage2 = stageTimings.stage2Duration
            generationInfo.stageTiming.stage3 = stageTimings.stage3Duration
            generationInfo.stageTiming.stage4 = stageTimings.stage4Duration
        }
        
        const lastMessageIndex = DBState.db.characters[selectedChar].chats[selectedChat].message.length - 1
        if(lastMessageIndex >= 0 && DBState.db.characters[selectedChar].chats[selectedChat].message[lastMessageIndex].generationInfo) {
            DBState.db.characters[selectedChar].chats[selectedChat].message[lastMessageIndex].generationInfo = generationInfo
        }
        
        endGeneration(genKey, { keepPendingAbort: true })
        return await sendChat(chatProcessIndex, {
            signal: abortSignal
        })
    }

    if(DBState.db.notification
        && typeof Notification !== 'undefined'
        && Notification.permission === 'granted'){
        try {
            const noti = new Notification('Risuai', {
                body: result
            })
            noti.onclick = () => {
                window.focus()
            }
        } catch (error) {
            
        }
    }

    if(req.special){
        if(req.special.emotion){
            let charemotions = get(CharEmotion)
            let currentEmotion = currentChar.emotionImages

            let tempEmotion = charemotions[currentChar.chaId]
            if(!tempEmotion){
                tempEmotion = []
            }
            if(tempEmotion.length > 4){
                tempEmotion.splice(0, 1)
            }

            for(const emo of currentEmotion){
                if(emo[0] === req.special.emotion){
                    const emos:[string, string,number] = [emo[0], emo[1], Date.now()]
                    tempEmotion.push(emos)
                    charemotions[currentChar.chaId] = tempEmotion
                    CharEmotion.set(charemotions)
                    emoChanged = true
                    break
                }
            }
        }
    }

    if(!currentChar.inlayViewScreen){
        if(currentChar.viewScreen === 'emotion' && (!emoChanged) && (abortSignal.aborted === false)){

            let currentEmotion = currentChar.emotionImages
            let emotionList = currentEmotion.map((a) => {
                return a[0]
            })
            let charemotions = get(CharEmotion)

            let tempEmotion = charemotions[currentChar.chaId]
            if(!tempEmotion){
                tempEmotion = []
            }
            if(tempEmotion.length > 4){
                tempEmotion.splice(0, 1)
            }

            if(DBState.db.emotionProcesser === 'embedding'){
                const hypaProcesser = new HypaProcesser()
                await hypaProcesser.addText(emotionList.map((v) => 'emotion:' + v))
                let searched = (await hypaProcesser.similaritySearchScored(result)).map((v) => {
                    v[0] = v[0].replace("emotion:",'')
                    return v
                })

                //give panaltys
                for(let i =0;i<tempEmotion.length;i++){
                    const emo = tempEmotion[i]
                    //give panalty index
                    const index = searched.findIndex((v) => {
                        return v[0] === emo[0]
                    })

                    const modifier = ((5 - ((tempEmotion.length - (i + 1))))) / 200

                    if(index !== -1){
                        searched[index][1] -= modifier
                    }
                }

                //make a sorted array by score
                const emoresult = searched.sort((a,b) => {
                    return b[1] - a[1]
                }).map((v) => {
                    return v[0]
                })

                for(const emo of currentEmotion){
                    if(emo[0] === emoresult[0]){
                        const emos:[string, string,number] = [emo[0], emo[1], Date.now()]
                        tempEmotion.push(emos)
                        charemotions[currentChar.chaId] = tempEmotion
                        CharEmotion.set(charemotions)
                        break
                    }
                }

                

                if (realChatId) clearPendingSend(realChatId)
                return true
            }

            function shuffleArray(array:string[]) {
                for (let i = array.length - 1; i > 0; i--) {
                    const j = Math.floor(Math.random() * (i + 1));
                    [array[i], array[j]] = [array[j], array[i]];
                }
                return array
            }

            let emobias:{[key:number]:number} = {}

            for(const emo of emotionList){
                const tokens = await tokenizeNum(emo)
                for(const token of tokens){
                    emobias[token] = 10
                }
            }

            for(let i =0;i<tempEmotion.length;i++){
                const emo = tempEmotion[i]

                const tokens = await tokenizeNum(emo[0])
                const modifier = 20 - ((tempEmotion.length - (i + 1)) * (20/4))

                for(const token of tokens){
                    emobias[token] -= modifier
                    if(emobias[token] < -100){
                        emobias[token] = -100
                    }
                }
            }        

            const promptbody:OpenAIChat[] = [
                {
                    role:'system',
                    content: `${DBState.db.emotionPrompt2 || "From the list below, choose a word that best represents a character's outfit description, action, or emotion in their dialogue. Prioritize selecting words related to outfit first, then action, and lastly emotion. Print out the chosen word."}\n\n list: ${shuffleArray(emotionList).join(', ')} \noutput only one word.`
                },
                {
                    role: 'user',
                    content: `"Good morning, Master! Is there anything I can do for you today?"`
                },
                {
                    role: 'assistant',
                    content: 'happy'
                },
                {
                    role: 'user',
                    content: result
                },
            ]

            const rq = await requestChatData({
                formated: promptbody,
                bias: emobias,
                currentChar: currentChar,
                maxTokens: 30,
            }, 'emotion', abortSignal)

            if(rq.type === 'fail'){
                if (realChatId) clearPendingSend(realChatId)
                if(abortSignal.aborted){
                    return true
                }
                throwError(rq.result)
                return true
            }
            if(rq.type === 'streaming' || rq.type === 'multiline'){
                if (realChatId) clearPendingSend(realChatId)
                if(abortSignal.aborted){
                    return true
                }
                throwError('Unexpected response type')
                return true
            }
            else{
                emotionList = currentEmotion.map((a) => {
                    return a[0]
                })
                try {
                    const emotion:string = rq.result.replace(/ |\n/g,'').trim().toLocaleLowerCase()
                    let emotionSelected = false
                    for(const emo of currentEmotion){
                        if(emo[0] === emotion){
                            const emos:[string, string,number] = [emo[0], emo[1], Date.now()]
                            tempEmotion.push(emos)
                            charemotions[currentChar.chaId] = tempEmotion
                            CharEmotion.set(charemotions)
                            emotionSelected = true
                            break
                        }
                    }
                    if(!emotionSelected){
                        for(const emo of currentEmotion){
                            if(emotion.includes(emo[0])){
                                const emos:[string, string,number] = [emo[0], emo[1], Date.now()]
                                tempEmotion.push(emos)
                                charemotions[currentChar.chaId] = tempEmotion
                                CharEmotion.set(charemotions)
                                emotionSelected = true
                                break
                            }
                        }
                    }
                    if(!emotionSelected && emotionList.includes('neutral')){
                        const emo = currentEmotion[emotionList.indexOf('neutral')]
                        const emos:[string, string,number] = [emo[0], emo[1], Date.now()]
                        tempEmotion.push(emos)
                        charemotions[currentChar.chaId] = tempEmotion
                        CharEmotion.set(charemotions)
                        emotionSelected = true
                    }
                } catch (error) {
                    throwError(language.errors.httpError + `${error}`)
                    if (realChatId) clearPendingSend(realChatId)
                    return true
                }
            }
            
            if (realChatId) clearPendingSend(realChatId)
            return true


        }
        else if(currentChar.viewScreen === 'imggen'){
            const msgs = DBState.db.characters[selectedChar].chats[selectedChat].message
            let msgStr = ''
            for(let i = (msgs.length - 1);i>=0;i--){
                if(msgs[i].role === 'char'){
                    msgStr = `character: ${msgs[i].data.replace(/\n/g, ' ')} \n` + msgStr
                }
                else{
                    msgStr = `user: ${msgs[i].data.replace(/\n/g, ' ')} \n` + msgStr
                    break
                }
            }


            await stableDiff(currentChar, msgStr)
        }
    }

    stageTimings.stage4Duration = Date.now() - stageTimings.stage4Start
    
    if(generationInfo.stageTiming) {
        generationInfo.stageTiming.stage1 = stageTimings.stage1Duration
        generationInfo.stageTiming.stage2 = stageTimings.stage2Duration
        generationInfo.stageTiming.stage3 = stageTimings.stage3Duration
        generationInfo.stageTiming.stage4 = stageTimings.stage4Duration
    }
    
    const lastMessageIndex = DBState.db.characters[selectedChar].chats[selectedChat].message.length - 1
    if(lastMessageIndex >= 0 && DBState.db.characters[selectedChar].chats[selectedChat].message[lastMessageIndex].generationInfo) {
        DBState.db.characters[selectedChar].chats[selectedChat].message[lastMessageIndex].generationInfo = generationInfo
    }

    if (narrativeTurnToConfirm
        && shouldAutomaticallyConfirmNarrativeTurn(
            DBState.db.risuBardAutoWikiEnabled
        )) {
        void confirmProjectedNarrativeTurn({
            characterId: currentChar.chaId,
            chatId: narrativeSessionChatId,
            ...narrativeTurnToConfirm,
        }).catch((error) => {
            console.warn('[RisuBard memory confirmation]', error)
        })
    }

    if (realChatId) clearPendingSend(realChatId)
    return true
}

function systemizeChat(chat:OpenAIChat[]){
    for(let i=0;i<chat.length;i++){
        if(chat[i].role === 'user' || chat[i].role === 'assistant'){
            const attr = chat[i].attr ?? []
            if(chat[i].name?.startsWith('example_')){
                chat[i].content = chat[i].name + ': ' + chat[i].content
            }
            else if(!attr.includes('nameAdded')){
                chat[i].content = chat[i].role + ': ' + chat[i].content
            }
            chat[i].role = 'system'
            delete chat[i].memo
            delete chat[i].name
        }
    }
    return chat
}
