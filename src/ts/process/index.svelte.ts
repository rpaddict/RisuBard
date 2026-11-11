import { captureGenerationTarget, createGenerationScope, type GenerationTarget } from "./generationTarget";
import { isOocAssistantTurn, isOocToggleActive } from '../risubard/oocTurns'
import { captureChatContext } from '../risubard/chatContextCapture'
import { selectAnalysisLoreReference } from '../risubard/analysisLoreReference'
import { createRequiredWikiMessage, reserveRequiredWikiBudget } from '../risubard/requiredWikiContext'
import { createWikiInquiryDiagnostic, formatWikiInquiryDiagnostic, wikiInquiryFailure, type WikiInquiryFailure } from '../risubard/wikiInquiryDiagnostics'
import { get } from "svelte/store";
import { type Database, type character, type MessageGenerationInfo, type Chat, type MessagePresetInfo, changeToPreset, getActivePromptOverlayToggleTemplate, getChatToggleScope, type Message, normalizeChat, type StreamingDisplayOptimizationMode } from "../storage/database.svelte";
import { DBState } from '../stores.svelte';
import { CharEmotion, selectedCharID } from "../stores.svelte";
import { ChatTokenizer, tokenize, tokenizeNum } from "../tokenizer";
import { language } from "../../lang";
import { alertConfirmMulti, alertError, notifyError } from "../alert";
import { parseChatML } from "../parser/chatML";
import { loadLoreBookV3Prompt } from "./lorebook.svelte";
import { findCharacterbyId, getPersonaPrompt, getUserName, isLastCharPunctuation, trimUntilPunctuation, parseToggleSyntax, prebuiltAssetCommand, sleep } from "../util";
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
import { getModuleAssets, getModuleLorebooksWithSources, getModuleToggles } from "./modules";
import { forageStorage, readImage, refreshLiveFiles } from "../globalApi.svelte";
import { chatGenKey, chatProcessStage, endGeneration, isChatGenerating, setGenerationStage, startGeneration } from "./generationState";
import { waitForSendSync } from './sendPreparation';
import {
    buildBoundedNarrativeInquiryFallback,
    createStoredResponseMemoryAnalysis,
    projectConfirmedMemoryTurn,
    projectMemoryBacklog,
    projectMemoryAnalysisEvidence,
    projectRecentMemoryMessages,
    type MemoryAnalysisMessage,
} from "../risubard/memoryAnalysisClient";
import { enqueueNarrativeConfirmation, narrativeConfirmationsSettled } from '../risubard/narrativeConfirmationQueue';
import { groupNarrativeBacklog, NARRATIVE_BACKLOG_TURNS_PER_RUN, narrativeAnalysisDue, withoutRepeatedMessages } from '../risubard/narrativeBacklogBatch';
import { summarizeWikiAnalysisGap, wikiBacklogMessages } from '../risubard/wikiBacklog';
import { projectActiveNarrativeSources } from "../risubard/sourceProjection";
import {
    createNarrativeSourcesPrompt,
    isNarrativeContextOptedIn,
    loadNarrativeInquiry,
    mergeNarrativeContextWithStaticPrompt,
    insertBeforeLatestUserMessage,
    ensureNarrativeSessionChatId,
    normalizeNarrativeWorkingMessageLimit,
    selectPromptedNarrativeSources,
    selectNarrativeWorkingMessages,
    shouldIncludeNarrativeFirstMessage,
    cacheStableWorkingMessageStep,
    countNarrativeTurns,
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
    loadWikiDocumentBodies,
    setWikiEventStoryTimes,
} from '../risubard/memoryWiki';
import { announceRisuBardMemoryUpdated } from '../risubard/memoryEvents';
import {
    planStoryTimeBackfill,
    runStoryTimeBackfill,
    selectStoryTimeBackfillEvents,
    type StoryTimeBackfillPlan,
    type StoryTimeBackfillResult,
} from '../risubard/storyTimeBackfill';
import { directWikiTokens } from '../risubard/directWikiBlocks';
import {
    applyCanonCompression,
    previewCanonCompression,
    type CanonCompressionPreview,
} from '../risubard/canonCompression';
import { readModelResponseText } from '../../../packages/risubard-core/src/modelResponse';
import type { WikiCatalogDocument } from '../risubard/memoryWiki';
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
    type CompiledWikiPromptGuide,
} from '../risubard/wikiPromptPreset';
import { resolveRisuBardChatSettings } from '../risubard/risuBardSettings';
import { resolveDynamicMemorySettings } from '../risubard/dynamicMemoryBudget';
import { requestWithProviderOutputLimit } from '../risubard/providerOutputTokenLimit';
import {
    buildSourceRerankInput, buildSourceRerankPool, parseSourceRerank,
    SOURCE_RERANK_POOL_LIMIT, SOURCE_RERANK_SCHEMA, SOURCE_RERANK_SYSTEM_PROMPT,
} from '../risubard/historicalSourceRerank';
import { normalizeRisuBardSourceRerankerSettings, rerankSourcesWithApi } from '../risubard/sourceRerankerApi';
import { globalFetch } from '../globalApi.svelte';
import { isLocalNetworkUrl } from '../network/localNetwork';
import {
    buildInquiryTimeline,
    findHistoricalSourceMatches,
    resolveHistoricalSourceMatchesById,
    type HistoricalSourceMatch,
} from '../risubard/historicalSourceRecall';
import { activateWikiEmbeddings, refreshHistoricalSourceEmbeddings, searchHistoricalSourceEmbeddings, stopHistoricalSourceEmbeddings, wikiEmbeddingRuntime } from '../risubard/wikiEmbeddingService';
import { mergeHistoricalSourceMatches } from '../risubard/historicalSourceEmbedding';
import type { WikiSemanticMatch, WikiSemanticSkip } from '../risubard/wikiEmbeddingIndex';
import { normalizeArcPlotterRuntimeSettings } from '../risubard/arcPlotterSettings';
import {
    canonicalFailureCategory,
    canonicalTurnNeedsRetry,
    canonicalTurnRetryWarning,
    canonicalTurnFailureWarning,
    mergeCanonicalTurnReceipts,
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
    cancelChatWikiGeneration,
    endWikiGeneration,
    wikiCancellationEpoch,
    wikiChatCancellationEpoch,
} from '../risubard/wikiGenerationState';
import { composePromptBlockOverlay } from '../promptBlockOverlay';
import {
    attachScriptstateCheckpoint,
    selectResponseScriptstateBefore,
    snapshotChatScriptstate,
} from '../chatScriptstateCheckpoint';

function resolvedRisuBardSettings(chat?: Chat, applyDynamicLimits = false) {
    const character = chat && DBState.db.characters.find((item) =>
        item.chats.some((candidate) => candidate === chat || (!!chat.id && candidate.id === chat.id)))
    const settings = resolveRisuBardChatSettings(DBState.db, chat?.risuBardSettings, character?.risuBardPinnedSettings)
    return applyDynamicLimits ? resolveDynamicMemorySettings(settings, chat?.message ?? []) : settings
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
        .find((chat) => chat.id === chatId
            || chat.risuBardWikiReboot?.stagingChatId === chatId)
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
    getInquiryTimeoutMs: (chatId) =>
        resolvedRisuBardSettings(findRisuBardChat(chatId))
            .risuBardInquiryTimeoutMs,
    getAnalysisOutputTokenLimit: (chatId) =>
        resolvedRisuBardSettings(findRisuBardChat(chatId))
            .risuBardAnalysisTokenLimit,
    onError(error) {
        const reason = boundedMemoryAnalysisError(error) || '알 수 없는 오류'
        console.warn(`[RisuBard memory analysis] ${reason}`)
    },
    nativeV2Analysis: true,
})
const narrativeConfirmations = new Set<string>()
const REQUIRED_WIKI_RETRY_TIMEOUT_MS = 60_000
const WIKI_REBOOT_BATCH_RETRIES = 2
const WIKI_REBOOT_RETRY_DELAY_MS = 5_000

async function confirmProjectedNarrativeTurn(input: {
    characterId: string
    chatId: string
    targetMessageId: string
    messages: readonly MemoryAnalysisMessage[]
    additionalAnalysis?: boolean
    historicalReanalysis?: boolean
    excludeCanonicalDocumentIds?: readonly string[]
    /** Two or more waiting turns analyzed in one call; messages and target cover them all. */
    batch?: readonly NarrativeTurn[]
}): Promise<boolean> {
    const key = JSON.stringify([
        input.characterId,
        input.chatId,
        ...(input.batch?.map((turn) => turn.targetMessageId) ?? [input.targetMessageId]),
    ])
    if (narrativeConfirmations.has(key)) return false
    narrativeConfirmations.add(key)
    try {
        // Analyses of one chat run one at a time; a parallel run would save
        // canon against a stale content hash and lose that turn's update.
        // A cancel while this one waits in the queue drops it as well.
        const chatKey = JSON.stringify([input.characterId, input.chatId])
        const epoch = wikiCancellationEpoch()
        const chatEpoch = wikiChatCancellationEpoch(chatKey)
        return await enqueueNarrativeConfirmation(
            chatKey,
            () => wikiCancellationEpoch() === epoch && wikiChatCancellationEpoch(chatKey) === chatEpoch
                ? runNarrativeConfirmation(input, key)
                : Promise.resolve(false),
        )
    }
    finally {
        narrativeConfirmations.delete(key)
    }
}

/**
 * Lorebook entries active at the analyzed turn, rendered like the main request.
 * Runs on a copy of the chat cut at that turn, so activation flags written while
 * matching never reach the real chat. Failure only drops the reference.
 */
async function collectAnalysisLoreReference(
    character: character,
    chat: Chat,
    targetMessageId: string | undefined,
    settings: ReturnType<typeof resolvedRisuBardSettings>,
) {
    if (settings.risuBardAnalysisLoreTokenLimit <= 0) return undefined
    try {
        const end = targetMessageId === undefined
            ? -1
            : chat.message.findIndex((message) => message.chatId === targetMessageId)
        const preview: Chat = {
            ...chat,
            message: end < 0 ? [...chat.message] : chat.message.slice(0, end + 1),
            scriptstate: { ...chat.scriptstate },
        }
        const { actives } = await loadLoreBookV3Prompt({ character, chat: preview })
        const reference = selectAnalysisLoreReference(actives.map((active) => ({
            title: active.sourceIdentity.entry.comment?.trim() || active.source,
            source: active.sourceIdentity.entry.content ?? '',
            rendered: risuChatParser(active.prompt, { chara: character, chat: preview }),
            tokens: active.tokens,
            priority: active.priority,
            alwaysActive: active.sourceIdentity.entry.alwaysActive === true,
        })), {
            tokenLimit: settings.risuBardAnalysisLoreTokenLimit,
            includeAlwaysActive: settings.risuBardAnalysisLoreIncludeAlwaysActive,
            excludeWords: settings.risuBardAnalysisLoreExcludeWords,
        })
        return reference.length > 0 ? reference : undefined
    }
    catch (error) {
        console.warn('[RisuBard memory analysis] lorebook reference skipped', error)
        return undefined
    }
}

type NarrativeTurn = { targetMessageId: string; messages: readonly MemoryAnalysisMessage[] }

async function runNarrativeConfirmation(
    input: Parameters<typeof confirmProjectedNarrativeTurn>[0],
    key: string,
): Promise<boolean> {
    const generationOperation = `analysis:${key}`
    const generationSignal = beginWikiGeneration(generationOperation)
    const turns: readonly NarrativeTurn[] = input.batch ?? [input]
    try {
        const character = DBState.db.characters.find(
            (item) => item.chaId === input.characterId
        )
        const chat = character?.chats.find(
            (item) => item.id === input.chatId
        )
        const settings = resolvedRisuBardSettings(chat, true)
        const previousCanonicalReceipt = chat?.message.find(
            (item) => item.chatId === input.targetMessageId
        )?.risubardCanonicalReceipt
        if (input.messages.some((message) =>
            message.role === 'assistant' && isOocAssistantTurn({ role: 'char', data: message.content })
        )) return false
        const wikiPromptPreset = resolveWikiPromptPreset(
            DBState.db.risuBardWikiPromptPresets,
            DBState.db.risuBardChatWikiPromptPresetId
        )
        const compiledWikiPromptGuide = wikiPromptPreset
            ? renderWikiPromptGuide(compileWikiPromptGuide(wikiPromptPreset, {
                characterGuide: risuChatParser(character?.risuBardWikiGuide ?? '', {
                    chara: character,
                }),
                chatGuide: risuChatParser(chat?.risuBardWikiGuide ?? '', {
                    chara: character,
                }),
                analysisMode: input.historicalReanalysis
                    ? 'historical'
                    : 'normal',
            }), character, chat)
            : undefined
        const firstMessageEvidence = character && chat
            ? await resolveNarrativeFirstMessageEvidence(
                character,
                chat,
                input.chatId
            )
            : undefined
        const keepMessage = (message: MemoryAnalysisMessage) =>
            !settings.risuBardAnalysisExcludeUserMessages || message.role !== 'user'
        const confirmedMessages = input.messages.filter(keepMessage)
        const batchTurns = input.batch?.map((turn) => ({
            assistantMessageId: turn.targetMessageId,
            sourceMessageIds: turn.messages.filter(keepMessage).map((message) => message.messageId),
        }))
        const contextMessages = chat
            ? projectRecentMemoryMessages(
                chat.message,
                normalizeNarrativeWorkingMessageLimit(
                    settings.risuBardRecentMessageCount
                ),
                input.targetMessageId,
                firstMessageEvidence,
                !settings.risuBardAnalysisExcludeUserMessages,
                true
            )
            : confirmedMessages
        const loreReference = character && chat
            ? await collectAnalysisLoreReference(character, chat, input.targetMessageId, settings)
            : undefined
        const receipt = await storedResponseMemoryAnalysis.confirm({
            characterId: input.characterId,
            chatId: input.chatId,
            messages: projectMemoryAnalysisEvidence(
                confirmedMessages,
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
            ...(character && chat ? { playerName: getUserName({ character, chat }) } : {}),
            wikiWritingLanguage: settings.risuBardWikiWritingLanguage,
            arcPlotterSettings: resolvedArcPlotterSettings(),
            ...(compiledWikiPromptGuide ? {
                wikiPromptGuide: {
                    analysis: compiledWikiPromptGuide.analysis,
                    canonicalRewrite: compiledWikiPromptGuide.canonicalRewrite,
                },
            } : {}),
            ...(loreReference ? { loreReference } : {}),
            ...(input.additionalAnalysis ? { additionalAnalysis: true } : {}),
            ...(!input.additionalAnalysis && !input.historicalReanalysis && !batchTurns && previousCanonicalReceipt
                ? { previousCanonicalReceipt } : {}),
            ...(batchTurns ? { batchTurns } : {}),
            ...(input.historicalReanalysis ? { historicalReanalysis: true } : {}),
            ...(input.excludeCanonicalDocumentIds ? {
                excludeCanonicalDocumentIds:
                    input.excludeCanonicalDocumentIds,
            } : {}),
            ...(chat ? { contextMessages,
                sourceMessageOrder: chat.message.filter(message => message.chatId)
                    .map(({ chatId, role }) => ({ chatId, role })),
            } : {}),
        }, generationSignal)
        const retryWarning = receipt
            ? canonicalTurnFailureWarning(receipt)
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
        for (const turn of turns) {
            const message = chat?.message.find(
                (item) => item.chatId === turn.targetMessageId
            )
            const accepted = turn.messages.at(-1)
            if (message && accepted?.role === 'assistant' && message.data !== accepted.content) {
                message.risubardWikiPending = {
                    reason: '분석하는 동안 메시지 내용이 바뀌어 다시 분석합니다.',
                    failedAt: new Date().toISOString(),
                }
            }
            if (message
                && accepted?.role === 'assistant'
                && message.data === accepted.content) {
                if (receipt && canonicalTurnNeedsRetry(receipt)) {
                    delete message.risubardMemoryConfirmed
                    message.risubardWikiPending = {
                        reason: canonicalTurnRetryWarning(receipt)?.slice(0, 512),
                        failedAt: new Date().toISOString(),
                    }
                }
                else {
                    message.risubardMemoryConfirmed = true
                    delete message.risubardWikiPending
                }
                if (receipt) {
                    message.risubardCanonicalReceipt = mergeCanonicalTurnReceipts(
                        message.risubardCanonicalReceipt,
                        receipt
                    )
                }
            }
        }
        return true
    }
    catch (error) {
        if (generationSignal.aborted) return false
        // The validator hint names the failing field, so a report can be diagnosed.
        const validationHint = typeof error === 'object' && error !== null
            ? (error as { validationHint?: unknown }).validationHint : undefined
        const hint = typeof validationHint === 'string' && validationHint ? ` (${validationHint})` : ''
        const reason = ((error instanceof Error
            ? error.message
            : String(error)) + hint).trim().slice(0, 512)
        for (const turn of turns) {
            const failed = findNarrativeMessage(input.characterId, input.chatId, turn.targetMessageId)
            if (failed && failed.risubardMemoryConfirmed !== true) {
                failed.risubardWikiPending = {
                    reason: reason || '알 수 없는 오류',
                    failedAt: new Date().toISOString(),
                }
            }
        }
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
    }
}

function findNarrativeMessage(characterId: string, chatId: string, messageId: string): Message | undefined {
    return DBState.db.characters.find((item) => item.chaId === characterId)
        ?.chats.find((item) => item.id === chatId)
        ?.message.find((item) => item.chatId === messageId && item.role === 'char')
}

/**
 * Analyzes the chat's queued turns in story order, as many per model call as
 * fit, and stops at the first batch that does not confirm so that no later turn
 * overtakes it. The target turn is queued first.
 */
const narrativeBacklogRuns = new Map<string, Promise<void>>()
const PROVIDER_OUTAGE_CATEGORIES = new Set(['타임아웃', '호출 제한', '인증 오류', '공급자 서버 오류', '네트워크 오류'])

function processNarrativeBacklog(input: {
    characterId: string
    chatId: string
    targetMessageId?: string
}): Promise<void> {
    if (input.targetMessageId) {
        const target = findNarrativeMessage(input.characterId, input.chatId, input.targetMessageId)
        if (target && target.risubardMemoryConfirmed !== true) target.risubardWikiPending ??= {}
    }
    // A second trigger waits for the running pass instead of colliding with it.
    const key = JSON.stringify([input.characterId, input.chatId])
    const run = (narrativeBacklogRuns.get(key) ?? Promise.resolve()).then(() => runNarrativeBacklog(input))
    const settled = run.catch(() => undefined)
    narrativeBacklogRuns.set(key, settled)
    void settled.then(() => {
        if (narrativeBacklogRuns.get(key) === settled) narrativeBacklogRuns.delete(key)
    })
    return run
}

/** Runs the queued turns until none are left or a pass confirms nothing more. */
async function drainNarrativeBacklog(characterId: string, chatId: string): Promise<void> {
    let before = Number.POSITIVE_INFINITY
    for (;;) {
        const chat = DBState.db.characters.find((item) => item.chaId === characterId)
            ?.chats.find((item) => item.id === chatId)
        const waiting = chat ? wikiBacklogMessages(chat.message, undefined, true).length : 0
        if (waiting === 0 || waiting >= before) return
        before = waiting
        await processNarrativeBacklog({ characterId, chatId })
    }
}

// Gap turns the user chose not to analyze this session, so the question is not repeated each turn.
const declinedWikiGapTurns = new Set<string>()

/**
 * Asks whether to analyze the turns left unanalyzed since the last confirmed
 * one, such as replies written while automatic analysis was off. Returns
 * 'catch-up' after queueing them, 'latest' to analyze only the newest turn, or
 * 'cancel'.
 */
async function askWikiGapCatchUp(
    chat: Chat,
    targetMessageId: string,
    respectDeclined: boolean,
): Promise<'none' | 'catch-up' | 'latest' | 'cancel'> {
    const gap = summarizeWikiAnalysisGap(chat.message, {
        beforeMessageId: targetMessageId,
        excludeMessageIds: new Set(respectDeclined
            ? [targetMessageId, ...declinedWikiGapTurns]
            : [targetMessageId]),
        ignoreOocTurns: true,
    })
    if (gap.messageIds.length === 0) return 'none'
    const target = chat.message.find((message) => message.role === 'char' && message.chatId === targetMessageId)
    const total = gap.messageIds.length + (target && target.risubardMemoryConfirmed !== true ? 1 : 0)
    const choice = await alertConfirmMulti(
        `분석되지 않은 턴 ${total.toLocaleString()}개가 있습니다`,
        [
            { label: `${gap.startResponseNumber.toLocaleString()}턴부터 이어서 분석`, variant: 'primary' },
            '최신 턴만 분석',
        ],
        '마지막으로 분석된 턴 뒤에 위키에 반영되지 않은 턴이 있습니다. 자동 분석이 꺼져 있던 동안의 턴일 수 있습니다.\n이어서 분석하면 오래된 턴부터 순서대로 반영하며, 턴 수에 따라 분석 요청이 여러 번 나갑니다. 기존 위키는 그대로 유지됩니다.',
    )
    if (choice === 0) {
        const ids = new Set(gap.messageIds)
        for (const message of chat.message) {
            if (message.role === 'char' && message.chatId && ids.has(message.chatId)) {
                message.risubardWikiPending ??= {}
            }
        }
        return 'catch-up'
    }
    for (const id of gap.messageIds) declinedWikiGapTurns.add(id)
    return choice === 1 ? 'latest' : 'cancel'
}

/** Queues a new turn and analyzes the backlog once the chat's turn interval is reached. */
function queueNarrativeTurn(input: {
    characterId: string
    chatId: string
    targetMessageId: string
}): void {
    const chat = DBState.db.characters.find((item) => item.chaId === input.characterId)
        ?.chats.find((item) => item.id === input.chatId)
    if (chat && summarizeWikiAnalysisGap(chat.message, {
        beforeMessageId: input.targetMessageId,
        excludeMessageIds: new Set([input.targetMessageId, ...declinedWikiGapTurns]),
        ignoreOocTurns: true,
    }).messageIds.length > 0) {
        void askWikiGapCatchUp(chat, input.targetMessageId, true).then((choice) => {
            if (choice !== 'catch-up') {
                queueNarrativeTurnNow(input)
                return
            }
            const target = findNarrativeMessage(input.characterId, input.chatId, input.targetMessageId)
            if (target && target.risubardMemoryConfirmed !== true) target.risubardWikiPending ??= {}
            void drainNarrativeBacklog(input.characterId, input.chatId)
        })
        return
    }
    queueNarrativeTurnNow(input)
}

function queueNarrativeTurnNow(input: {
    characterId: string
    chatId: string
    targetMessageId: string
}): void {
    const chat = DBState.db.characters.find((item) => item.chaId === input.characterId)
        ?.chats.find((item) => item.id === input.chatId)
    const target = findNarrativeMessage(input.characterId, input.chatId, input.targetMessageId)
    if (chat && target && target.risubardMemoryConfirmed !== true) {
        const interval = resolvedRisuBardSettings(chat).risuBardAnalysisTurnInterval
        if (interval > 1) {
            target.risubardWikiPending ??= {}
            const waiting = wikiBacklogMessages(chat.message, input.targetMessageId, true).length
            if (!narrativeAnalysisDue(waiting, interval)) return
        }
    }
    void processNarrativeBacklog(input)
}

async function runNarrativeBacklog(input: {
    characterId: string
    chatId: string
    targetMessageId?: string
}): Promise<void> {
    const chat = DBState.db.characters.find((item) => item.chaId === input.characterId)
        ?.chats.find((item) => item.id === input.chatId)
    if (!chat) return
    const turns = projectMemoryBacklog(chat.message, input.targetMessageId, {
        limit: NARRATIVE_BACKLOG_TURNS_PER_RUN,
        ignoreOocTurns: true,
    })
    const analysisTokenLimit = resolvedRisuBardSettings(chat, true).risuBardAnalysisTokenLimit
    const batches = groupNarrativeBacklog(turns, analysisTokenLimit)
    const epoch = wikiCancellationEpoch()
    for (let batch = batches.shift(); batch; batch = batches.shift()) {
        const last = batch.at(-1)!
        const turnsOnce = withoutRepeatedMessages(batch)
        const projected = batch.length === 1 ? last : {
            targetMessageId: last.targetMessageId,
            messages: turnsOnce.flatMap((turn) => turn.messages),
            batch: turnsOnce,
        }
        try {
            await confirmProjectedNarrativeTurn({
                characterId: input.characterId,
                chatId: input.chatId,
                ...projected,
            })
        }
        catch (error) {
            console.warn('[RisuBard memory confirmation]', error)
            // A batch the model cannot answer must not hold every turn back; retry them one by one.
            // A provider outage would fail each turn the same way, so it waits for the next reply.
            if (batch.length > 1 && wikiCancellationEpoch() === epoch
                && !PROVIDER_OUTAGE_CATEGORIES.has(canonicalFailureCategory(error))) {
                batches.unshift(...batch.map((turn) => [turn]))
                continue
            }
        }
        if (batch.some((turn) => findNarrativeMessage(input.characterId, input.chatId, turn.targetMessageId)
            ?.risubardMemoryConfirmed !== true)) break
    }
}

/**
 * A retry the user asks for replaces this chat's analysis still in flight. A
 * provider that never answers holds the request for minutes per attempt, and a
 * retry queued behind it would only wait with it.
 */
async function restartChatWikiAnalysis(characterId: string, chatId: string): Promise<void> {
    const key = JSON.stringify([characterId, chatId])
    cancelChatWikiGeneration(key, `analysis:${key.slice(0, -1)},`)
    await narrativeConfirmationsSettled(key)
    // The cancelled run releases its duplicate guard just after the queue settles.
    await new Promise((resolve) => setTimeout(resolve, 0))
}

/** Runs the current chat's waiting wiki turns now, from the oldest. */
export async function retryNarrativeBacklog(): Promise<void> {
    const character = DBState.db.characters[get(selectedCharID)]
    const chat = character?.chats[character.chatPage]
    if (!character || !chat) return
    const chatId = ensureNarrativeSessionChatId(chat, v4)
    await restartChatWikiAnalysis(character.chaId, chatId)
    await processNarrativeBacklog({
        characterId: character.chaId,
        chatId,
    })
}

/** Leaves one waiting turn out of the wiki so that the turns after it can proceed. */
export function skipNarrativeBacklogTurn(messageId: string): boolean {
    const character = DBState.db.characters[get(selectedCharID)]
    const chat = character?.chats[character.chatPage]
    const message = chat?.message.find((item) => item.chatId === messageId && item.role === 'char')
    if (!message || message.risubardMemoryConfirmed === true) return false
    delete message.risubardWikiPending
    message.risubardMemoryConfirmed = true
    message.risubardCanonicalReceipt = mergeCanonicalTurnReceipts(message.risubardCanonicalReceipt, {
        sourceMessageIds: [messageId],
        eventIds: [],
        changes: [],
        warnings: ['사용자가 이 턴을 건너뛰었습니다. 이 턴의 내용은 위키에 반영되지 않았습니다.'],
        recordedAt: new Date().toISOString(),
    })
    return true
}

export async function confirmCurrentNarrativeMessage(
    messageId: string
): Promise<boolean> {
    const character = DBState.db.characters[get(selectedCharID)]
    const chat = character?.chats[character.chatPage]
    if (!character || !chat) return false
    const chatId = ensureNarrativeSessionChatId(chat, v4)
    const projected = projectConfirmedMemoryTurn(chat.message, messageId, {
        ignoreOocTurns: true,
    })
    if (!projected) return false
    return confirmProjectedNarrativeTurn({
        characterId: character.chaId,
        chatId,
        ...projected,
    })
}

function renderWikiPromptGuide(
    guide: CompiledWikiPromptGuide,
    currentCharacter?: character,
    chat?: Chat,
): CompiledWikiPromptGuide {
    // Toggles read from the chat that owns them, falling back to the globals.
    const globalChatVariables = getChatToggleScope(chat)
    const render = (source: string) => risuChatParser(source, {
        chara: currentCharacter,
        chat,
        globalChatVariables,
    })
    return {
        analysis: render(guide.analysis),
        canonicalRewrite: render(guide.canonicalRewrite),
        response: render(guide.response),
    }
}

export async function reanalyzeNarrativeMessage(
    messageId: string
): Promise<boolean> {
    const character = DBState.db.characters[get(selectedCharID)]
    const chat = character?.chats[character.chatPage]
    if (!character || !chat) return false
    const projected = projectConfirmedMemoryTurn(
        chat.message,
        messageId,
        { includeConfirmed: true, ignoreOocTurns: true }
    )
    if (!projected) return false
    return confirmProjectedNarrativeTurn({
        characterId: character.chaId,
        chatId: ensureNarrativeSessionChatId(chat, v4),
        historicalReanalysis: true,
        ...projected,
    })
}

export async function forceCurrentNarrativeWikiUpdate(): Promise<boolean | null> {
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
    const gapChoice = await askWikiGapCatchUp(chat, target.chatId, false)
    if (gapChoice === 'cancel') return null
    if (gapChoice === 'catch-up') {
        const chatId = ensureNarrativeSessionChatId(chat, v4)
        if (target.risubardMemoryConfirmed !== true) target.risubardWikiPending ??= {}
        await restartChatWikiAnalysis(character.chaId, chatId)
        await drainNarrativeBacklog(character.chaId, chatId)
        if (wikiBacklogMessages(chat.message, undefined, true).length > 0) {
            throw new Error('일부 턴을 분석하지 못했습니다. 위키 대기 배너에서 남은 턴을 다시 시도할 수 있습니다.')
        }
        return true
    }
    const projected = projectConfirmedMemoryTurn(
        chat.message,
        target.chatId,
        { includeConfirmed: true, ignoreOocTurns: true }
    )
    if (!projected) return false
    const chatId = ensureNarrativeSessionChatId(chat, v4)
    await restartChatWikiAnalysis(character.chaId, chatId)
    return confirmProjectedNarrativeTurn({
        characterId: character.chaId,
        chatId,
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
        delete message.risubardWikiPending
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
    let consecutiveRebootFailures = 0
    try {
        while (chat.risuBardWikiReboot) {
            try {
                const job = chat.risuBardWikiReboot
                const settings = resolvedRisuBardSettings(chat, true)
                // Legacy jobs predate OOC exclusion; retain their original evidence for recovery.
                const ignoreOocTurns = job.ignoreOocTurns === true
                const turns = projectWikiRebootTurns(
                    chat.message, 0, !settings.risuBardAnalysisExcludeUserMessages,
                    ignoreOocTurns
                )
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
                const wikiPromptPreset = resolveWikiPromptPreset(
                    DBState.db.risuBardWikiPromptPresets,
                    DBState.db.risuBardChatWikiPromptPresetId
                )
                const compiledWikiPromptGuide = wikiPromptPreset
                    ? renderWikiPromptGuide(compileWikiPromptGuide(wikiPromptPreset, {
                        characterGuide: risuChatParser(
                            character.risuBardWikiGuide ?? '',
                            { chara: character }
                        ),
                        chatGuide: risuChatParser(chat.risuBardWikiGuide ?? '', {
                            chara: character,
                        }),
                    }), character, chat)
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
                    firstMessageEvidence,
                    !settings.risuBardAnalysisExcludeUserMessages,
                    ignoreOocTurns
                )
                const loreReference = await collectAnalysisLoreReference(
                    character, chat, batch.at(-1)?.assistantMessageId, settings
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
                    playerName: getUserName({ character, chat }),
                    wikiWritingLanguage: job.writingLanguage ?? 'ko',
                    arcPlotterSettings: resolvedArcPlotterSettings(),
                    ...(compiledWikiPromptGuide ? {
                        wikiPromptGuide: {
                            analysis: compiledWikiPromptGuide.analysis,
                            canonicalRewrite:
                                compiledWikiPromptGuide.canonicalRewrite,
                        },
                    } : {}),
                    ...(loreReference ? { loreReference } : {}),
                    contextMessages,
                    sourceMessageOrder: chat.message.filter(message => message.chatId)
                        .map(({ chatId, role }) => ({ chatId, role })),
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
                consecutiveRebootFailures = 0
            }
            catch (error) {
                // Transient provider, network or server failures retry the same
                // in-flight batch; its receipt recovery prevents duplicate writes.
                if (generationSignal.aborted
                    || ++consecutiveRebootFailures > WIKI_REBOOT_BATCH_RETRIES) throw error
                console.warn('[RisuBard wiki reboot batch retry]', error)
                await sleep(WIKI_REBOOT_RETRY_DELAY_MS * consecutiveRebootFailures)
                if (generationSignal.aborted) throw error
            }
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
        const reason = boundedMemoryAnalysisError(error) || '알 수 없는 오류'
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
        throw new Error(reason, { cause: error })
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
    const turns = projectWikiRebootTurns(current.chat.message, startChatIndex, true,
        true)
    if (turns.length === 0) return false
    const jobId = v4()
    current.chat.risuBardWikiReboot = createWikiRebootJob({
        jobId,
        stagingChatId: `reboot-${jobId}`,
        writingLanguage: resolvedRisuBardSettings(current.chat).risuBardWikiWritingLanguage,
        ignoreOocTurns: true,
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
    const settings = resolvedRisuBardSettings(chat, true)
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
            !settings.risuBardAnalysisExcludeUserMessages,
            true,
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
            requestModel: (request) => requestWithProviderOutputLimit(
                {
                    ...request,
                    // Dynamic growth widens the input budget only.
                    maxTokens: Math.min(request.maxTokens,
                        resolvedRisuBardSettings(chat).risuBardAnalysisTokenLimit),
                    realChatId: chatId,
                    logSource: 'wiki-admin' as const,
                },
                (attempt) => requestChatData(attempt, settings.risuBardModelMode, generationSignal)
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

/** Runs the canon maintenance pass on chosen wiki pages and returns previews; nothing is saved. */
export async function previewCurrentCanonCompression(
    targetIds: readonly string[],
    catalog: readonly WikiCatalogDocument[],
    onProgress?: (done: number, total: number, title: string) => void
): Promise<CanonCompressionPreview[]> {
    const character = DBState.db.characters[get(selectedCharID)]
    const chat = character?.chats[character.chatPage]
    if (!character || !chat) throw new Error('현재 채팅을 찾을 수 없습니다.')
    const characterId = character.chaId
    const chatId = ensureNarrativeSessionChatId(chat, v4)
    const settings = resolvedRisuBardSettings(chat, true)
    const wikiPromptPreset = resolveWikiPromptPreset(
        DBState.db.risuBardWikiPromptPresets,
        DBState.db.risuBardChatWikiPromptPresetId
    )
    const policy = wikiPromptPreset
        ? renderWikiPromptGuide(compileWikiPromptGuide(wikiPromptPreset, {
            characterGuide: risuChatParser(character.risuBardWikiGuide ?? '', { chara: character }),
            chatGuide: risuChatParser(chat.risuBardWikiGuide ?? '', { chara: character }),
        }), character, chat).canonicalRewrite
        : ''
    const operation = `compress:${characterId}:${chatId}`
    const signal = beginWikiGeneration(operation)
    try {
        return await previewCanonCompression({
            characterId, chatId, targetIds, catalog, policy, signal, onProgress,
            fetchImpl: fetch,
            createAuth: () => forageStorage.createAuth(),
            request: async (prompt) => readModelResponseText(await requestWithProviderOutputLimit(
                {
                    formated: [
                        { role: 'system' as const, content: prompt.system },
                        { role: 'user' as const, content: prompt.input },
                    ],
                    useStreaming: false,
                    noMultiGen: true,
                    tools: [],
                    maxTokens: settings.risuBardAnalysisTokenLimit,
                    temperature: 0,
                    bias: {},
                    extractJson: '',
                    schema: prompt.schema,
                    logSource: 'wiki-admin' as const,
                    logPurpose: 'bardwiki-admin' as const,
                    realChatId: chatId,
                },
                (attempt) => requestChatData(attempt, settings.risuBardModelMode, signal)
            )),
        })
    }
    finally {
        endWikiGeneration(operation)
    }
}

/** Saves the ready previews with an undo point, so the wiki's last-change undo restores them. */
export async function applyCurrentCanonCompression(
    previews: readonly CanonCompressionPreview[]
): Promise<{ applied: string[]; failed: Array<{ title: string; reason: string }> }> {
    const character = DBState.db.characters[get(selectedCharID)]
    const chat = character?.chats[character.chatPage]
    if (!character || !chat) throw new Error('현재 채팅을 찾을 수 없습니다.')
    const characterId = character.chaId
    const chatId = ensureNarrativeSessionChatId(chat, v4)
    const createAuth = () => forageStorage.createAuth()
    let undoStarted = false
    try {
        const result = await applyCanonCompression({
            previews,
            beforeApply: async () => {
                await beginBardChatUndo({ characterId, chatId, fetchImpl: fetch, createAuth })
                undoStarted = true
            },
            save: (preview) => saveManualWikiDocument({
                characterId, chatId,
                documentId: preview.documentId,
                type: preview.type,
                title: preview.title,
                aliases: preview.aliases,
                markdown: preview.markdown,
                expectedContentHash: preview.contentHash,
                fetchImpl: fetch,
                createAuth,
            }),
        })
        if (undoStarted) {
            await finalizeBardChatUndo({ characterId, chatId, fetchImpl: fetch, createAuth })
            undoStarted = false
        }
        announceRisuBardMemoryUpdated({ characterId, chatId })
        publishRisuBardMemoryActivity({
            characterId, chatId,
            operation: result.failed.length > 0 ? 'error' : 'wiki-save',
            timestamp: Date.now(),
            message: `정본 압축: ${result.applied.length}건 적용${result.failed.length > 0 ? `, ${result.failed.length}건 미적용` : ''}`,
        })
        return result
    }
    catch (cause) {
        if (undoStarted) {
            try { await finalizeBardChatUndo({ characterId, chatId, fetchImpl: fetch, createAuth }) }
            catch { /* Preserve the original failure. */ }
        }
        throw cause
    }
}

/** Finds the undated events of the current chat and plans the requests that place them again; nothing is sent. */
export async function prepareCurrentStoryTimeBackfill(
    catalog: readonly WikiCatalogDocument[]
): Promise<StoryTimeBackfillPlan> {
    const character = DBState.db.characters[get(selectedCharID)]
    const chat = character?.chats[character.chatPage]
    if (!character || !chat) throw new Error('현재 채팅을 찾을 수 없습니다.')
    const characterId = character.chaId
    const chatId = ensureNarrativeSessionChatId(chat, v4)
    const { prior, targets, sequences } = selectStoryTimeBackfillEvents(catalog)
    const bodies = new Map((await loadWikiDocumentBodies({
        characterId, chatId, fetchImpl: fetch, createAuth: () => forageStorage.createAuth(),
        documentIds: [...(prior.length > 0 ? [prior.at(-1)!.id] : []), ...targets.map((document) => document.id)],
    })).map((document) => [document.id, document]))
    const messages = new Map(chat.message.map((message) => [message.chatId, message]))
    return planStoryTimeBackfill({
        prior: prior.map((document) => bodies.get(document.id) ?? document),
        targets: targets.flatMap((document) => {
            const body = bodies.get(document.id)
            return body ? [body] : []
        }),
        sequences,
        sourceTextFor: (messageIds) => messageIds.flatMap((id) => {
            const message = messages.get(id)
            return message && typeof message.data === 'string'
                ? [`${message.role === 'user' ? 'User' : 'Assistant'}: ${message.data}`] : []
        }).join('\n\n'),
        countTokens: directWikiTokens,
    })
}

/** Places the planned events again with the analysis model and saves them with an undo point. */
export async function runCurrentStoryTimeBackfill(
    plan: StoryTimeBackfillPlan,
    onProgress?: (done: number, total: number) => void,
    stop?: AbortSignal
): Promise<StoryTimeBackfillResult> {
    const character = DBState.db.characters[get(selectedCharID)]
    const chat = character?.chats[character.chatPage]
    if (!character || !chat) throw new Error('현재 채팅을 찾을 수 없습니다.')
    const characterId = character.chaId
    const chatId = ensureNarrativeSessionChatId(chat, v4)
    const settings = resolvedRisuBardSettings(chat, true)
    const createAuth = () => forageStorage.createAuth()
    const operation = `story-time:${characterId}:${chatId}`
    const generation = beginWikiGeneration(operation)
    const signal = stop && typeof AbortSignal.any === 'function' ? AbortSignal.any([generation, stop]) : generation
    let undoStarted = false
    try {
        const result = await runStoryTimeBackfill({
            plan, signal, onProgress,
            request: async (prompt) => readModelResponseText(await requestWithProviderOutputLimit(
                {
                    formated: [
                        { role: 'system' as const, content: prompt.system },
                        { role: 'user' as const, content: prompt.input },
                    ],
                    useStreaming: false,
                    noMultiGen: true,
                    tools: [],
                    maxTokens: settings.risuBardAnalysisTokenLimit,
                    temperature: 0,
                    bias: {},
                    extractJson: '',
                    schema: prompt.schema,
                    logSource: 'wiki-admin' as const,
                    logPurpose: 'bardwiki-admin' as const,
                    realChatId: chatId,
                },
                (attempt) => requestChatData(attempt, settings.risuBardModelMode, signal)
            )),
            save: async (updates) => {
                if (!undoStarted) {
                    await beginBardChatUndo({ characterId, chatId, fetchImpl: fetch, createAuth })
                    undoStarted = true
                }
                return setWikiEventStoryTimes({ characterId, chatId, updates, fetchImpl: fetch, createAuth })
            },
        })
        publishRisuBardMemoryActivity({
            characterId, chatId,
            operation: result.failedBatches > 0 ? 'error' : 'wiki-save',
            timestamp: Date.now(),
            message: `사건 날짜 다시 매기기: ${result.updated}건 저장${result.failedBatches > 0 ? `, 요청 ${result.failedBatches}건 실패` : ''}`,
        })
        return result
    }
    finally {
        if (undoStarted) {
            try { await finalizeBardChatUndo({ characterId, chatId, fetchImpl: fetch, createAuth }) }
            catch { /* Preserve the original outcome. */ }
            announceRisuBardMemoryUpdated({ characterId, chatId })
        }
        endWikiGeneration(operation)
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
    target?: GenerationTarget
    requestSettings?: Database
} = {}):Promise<boolean> {
    const requestSettings = arg.requestSettings ?? { ...DBState.db }
    const target = arg.target ?? captureGenerationTarget(DBState.db.characters[get(selectedCharID)])
    const generationScope = createGenerationScope(() => DBState.db.characters, target)
    try {
        await waitForSendSync(refreshLiveFiles, { signal: arg.signal })
    } catch (error) {
        if (arg.signal?.aborted) return false
        notifyError(`${language.chatSendPreparationFailed}: ${error instanceof Error ? error.message : String(error)}`)
        return false
    }

    const parseGenerationText = (text: string, options: Parameters<typeof risuChatParser>[1] = {}) =>
        risuChatParser(text, { ...options, db: requestSettings, chara: options.chara ?? generationScope.character, chat: generationScope.chat })
    const processGenerationScript = (char: Parameters<typeof processScript>[0], text: string, mode: Parameters<typeof processScript>[2], conditions: Parameters<typeof processScript>[3] = {}) =>
        processScript(char, text, mode, conditions, target, requestSettings)
    const processGenerationScriptFull = (char: Parameters<typeof processScriptFull>[0], text: string, mode: Parameters<typeof processScriptFull>[2], index = -1, conditions: Parameters<typeof processScriptFull>[4] = {}) =>
        processScriptFull(char, text, mode, index, conditions, target, requestSettings)

    // Selection may have changed during synchronization; continue in the captured chat.
    if (generationScope.chat.risuBardWikiReboot) return false

    chatProcessStage.set(0)
    const abortSignal = arg.signal ?? (new AbortController()).signal
    
    // NOTE: `throwError()` can be called before these are populated (e.g. HypaV3 early validation errors).
    // Keep them declared up-front to avoid TDZ ReferenceErrors in production builds.
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
            v.data = parseGenerationText(v.data, {chara: currentChar, runVar: true})
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

            const charRoom = generationScope.character
            const chatRoom = generationScope.chat
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
    const guardChat = generationScope.chat
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
    if(chatProcessIndex === -1 && requestSettings.presetChain){
        const names = requestSettings.presetChain.split(',').map((v) => v.trim())
        const randomSelect = Math.floor(Math.random() * names.length)
        const ele = names[randomSelect]

        const findId = requestSettings.botPresets.findIndex((v) => {
            return v.name === ele
        })

        if(findId === -1){
            notifyError(`Cannot find preset: ${ele}`, { source: 'preset' })
        }
        else{
            changeToPreset(findId, true)
            Object.assign(requestSettings, DBState.db)
        }
    }

    requestSettings.statics.messages += 1
    const nowChatroom = generationScope.character
    nowChatroom.lastInteraction = Date.now()
    // Block send if chat is still a placeholder (hydration not complete)
    if (generationScope.chat?._placeholder) {
        alertError('Chat is still loading. Please wait a moment.')
        endGeneration(genKey)
        return false
    }
    generationScope.chat.message = generationScope.chat.message.map((v) => {
        v.chatId = v.chatId ?? v4()
        return v
    })
    
    let promptInfo: MessagePresetInfo = {}
    let initialPresetNameForPromptInfo = null
    let initialPromptTogglesForPromptInfo: {
        key: string,
        value: string,
    }[] = []
    if(requestSettings.promptInfoInsideChat){
        initialPresetNameForPromptInfo = requestSettings.botPresets[requestSettings.botPresetsId]?.name ?? ''
        initialPromptTogglesForPromptInfo = parseToggleSyntax(getActivePromptOverlayToggleTemplate(requestSettings) + getModuleToggles({ character: generationScope.character, chat: generationScope.chat }))
            .flatMap(toggle => {
                const raw = getGlobalChatVar(`toggle_${toggle.key}`, generationScope.chat)
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
    if(requestSettings.aiModel.startsWith('gpt')){
        caculatedChatTokens += 5
    }
    else{
        caculatedChatTokens += 3
    }

    currentChar = nowChatroom

    let chatAdditonalTokens = arg.chatAdditonalTokens ?? caculatedChatTokens
    const tokenizer = new ChatTokenizer(chatAdditonalTokens, requestSettings.aiModel.startsWith('gpt') ? 'noName' : 'name')
    const scriptstateBeforeSend = snapshotChatScriptstate(generationScope.chat.scriptstate)
    let currentChat = runCurrentChatFunction(generationScope.chat)
    const continuedResponseCheckpoint = arg.continue
        ? currentChat.message[currentChat.message.length - 1]?.scriptstateCheckpoint
        : undefined
    const scriptstateBeforeResponse = selectResponseScriptstateBefore(
        scriptstateBeforeSend,
        continuedResponseCheckpoint,
    )
    const narrativeSessionChatId = realChatId
        ?? ensureNarrativeSessionChatId(currentChat, v4)
    generationScope.chat = currentChat
    const narrativeTurnToConfirm = projectConfirmedMemoryTurn(
        currentChat.message, undefined,
        { ignoreOocTurns: true }
    )
    let maxContextTokens = requestSettings.maxContext
    // Output-token reservation for the context budget. Defaults to the legacy
    // global db.maxResponse (the "[채팅 봇]" max response size), overridden below
    // when this chat is bound to a ModelPreset.
    let maxResponseTokens = requestSettings.maxResponse
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

    const defaultAuthorNote = requestSettings.promptTemplate?.find(card => card.type === 'authornote')?.defaultText ?? ''
    let promptTemplate = composePromptBlockOverlay(
        requestSettings.promptTemplate,
        requestSettings.promptBlockOverlayProfiles ?? [],
        requestSettings.promptBlockOverlay,
    )
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
    if(currentChar.utilityBot && (!(usingPromptTemplate && requestSettings.promptSettings.utilOverride))){
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
        const mainp = currentChar.systemPrompt?.replaceAll('{{original}}', requestSettings.mainPrompt) || requestSettings.mainPrompt


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

        unformated.main.push(...formatPrompt(parseGenerationText(mainp + ((requestSettings.additionalPrompt === '' || (!requestSettings.promptPreprocess)) ? '' : `\n${requestSettings.additionalPrompt}`), {chara: currentChar}), 'systemPrompt'))
    
        if(requestSettings.jailbreakToggle){
            unformated.jailbreak.push(...formatPrompt(parseGenerationText(requestSettings.jailbreak, {chara: currentChar}), 'jailbreak'))
        }
    
        unformated.globalNote.push(...formatPrompt(parseGenerationText(currentChar.replaceGlobalNote?.replaceAll('{{original}}', requestSettings.globalNote) || requestSettings.globalNote, {chara:currentChar}), 'globalNote'))
    }

    let baseDescriptionPrompt:OpenAIChat|null = null
    let beforeDescriptionPrompts:OpenAIChat[] = []
    let afterDescriptionPrompts:OpenAIChat[] = []

    if(currentChat.note){
        unformated.authorNote.push(setRequestStatusSource({
            role: 'system',
            content: parseGenerationText(currentChat.note, {chara: currentChar})
        }, 'authorNote'))
    }
    else if(defaultAuthorNote !== ''){
        unformated.authorNote.push(setRequestStatusSource({
            role: 'system',
            content: parseGenerationText(defaultAuthorNote, {chara: currentChar})
        }, 'authorNote'))
    }

    if(requestSettings.chainOfThought && (!(usingPromptTemplate && requestSettings.promptSettings.customChainOfThought))){
        unformated.postEverything.push({
            role: 'system',
            content: `<instruction> - before respond everything, Think step by step as a ai assistant how would you respond inside <Thoughts> xml tag. this must be less than 5 paragraphs.</instruction>`
        })
    }

    {
        let description = parseGenerationText((requestSettings.promptPreprocess ? requestSettings.descriptionPrefix: '') + currentChar.desc, {chara: currentChar})

        const additionalInfo = await additionalInformations(currentChar, currentChat)

        if(additionalInfo){
            description += '\n\n' + parseGenerationText(additionalInfo, {chara:currentChar})
        }

        if(currentChar.personality){
            description += parseGenerationText("\n\nDescription of {{char}}: " + currentChar.personality, {chara: currentChar})
        }

        if(currentChar.scenario){
            description += parseGenerationText("\n\nCircumstances and context of the dialogue: " + currentChar.scenario, {chara: currentChar})
        }

        baseDescriptionPrompt = setRequestStatusSource({
            role: 'system',
            content: description
        }, 'character', currentChar.name)
        unformated.description.push(baseDescriptionPrompt)

    }

    let renderedFirstMessageCache: { source: string, content: string } | undefined
    const renderFirstMessage = async (source: string) => {
        if (renderedFirstMessageCache?.source === source) return renderedFirstMessageCache.content
        const content = await processGenerationScript(nowChatroom,
            parseGenerationText(source, {chara: currentChar}),
        'editprocess')
        renderedFirstMessageCache = { source, content }
        return content
    }
    const selectedFirstMessage = currentChat.firstMessageDisabled
        ? undefined
        : currentChat.fmIndex === -1 ? nowChatroom.firstMessage : nowChatroom.alternateGreetings?.[currentChat.fmIndex]
    const lorepmt = await loadLoreBookV3Prompt({
        character: generationScope.character,
        chat: generationScope.chat,
        renderedFirstMessage: typeof selectedFirstMessage === 'string'
            ? await renderFirstMessage(selectedFirstMessage)
            : undefined,
    })
    let wikiInquiryAttempted = false
    let wikiInquiryError: WikiInquiryFailure | undefined
    let wikiSemanticSkip: WikiSemanticSkip | undefined
    let wikiInquirySources: Awaited<ReturnType<typeof loadNarrativeInquiry>>['sources'] = []
    let requiredWikiSources: typeof wikiInquirySources = []
    let requiredWikiDocumentCount = 0
    let requiredWikiDurationMs = 0
    const responseWikiPromptPreset = resolveWikiPromptPreset(
        requestSettings.risuBardWikiPromptPresets,
        requestSettings.risuBardChatWikiPromptPresetId
    )
    const responseWikiPromptGuide = responseWikiPromptPreset
        ? renderWikiPromptGuide(compileWikiPromptGuide(responseWikiPromptPreset), currentChar, currentChat).response
        : ''
    const wikiSettings = resolvedRisuBardSettings(currentChat, true)
    let optionalWikiBudget: ReturnType<typeof reserveRequiredWikiBudget> = {
        target: wikiSettings.risuBardInquiryTargetTokenBudget,
        events: wikiSettings.risuBardInquiryEventTokenBudget,
        perSource: wikiSettings.risuBardInquirySourceTokenBudget,
        maximum: wikiSettings.risuBardInquiryMaximumTokenBudget,
    }
    if (isNarrativeContextOptedIn()) {
        const requiredStartedAt = performance.now()
        try {
            const loadRequired = (timeoutMs: number) => loadNarrativeInquiry({
                characterId: currentChar.chaId, chatId: narrativeSessionChatId,
                currentInput: '', contextSelection: 'required', tokenBudget: optionalWikiBudget,
                fetchImpl: fetch, createAuth: () => forageStorage.createAuth(),
                timeoutMs, signal: arg.signal,
            })
            // After a wiki write the server rereads every document once; a
            // timed-out lookup keeps warming that cache, so wait longer instead
            // of failing the mandatory context.
            const required = await loadRequired(wikiSettings.risuBardInquiryTimeoutMs).catch((error: unknown) => {
                if (arg.signal?.aborted || !(error instanceof Error && error.name === 'AbortError')) throw error
                return loadRequired(REQUIRED_WIKI_RETRY_TIMEOUT_MS)
            })
            requiredWikiSources = required.sources
            requiredWikiDocumentCount = required.metrics.inspectedNodeCount
            requiredWikiDurationMs = performance.now() - requiredStartedAt
            wikiInquirySources = [...requiredWikiSources]
            wikiInquiryAttempted = true
            optionalWikiBudget = reserveRequiredWikiBudget(optionalWikiBudget, requiredWikiSources)
        } catch (error) {
            // We cannot promise mandatory context when its source cannot be read.
            if (!arg.signal?.aborted) throwError(`항상 포함할 바드위키를 확인하지 못해 응답 생성을 중단했습니다. 위키 상태와 토큰 상한을 확인해 주세요.\n${error instanceof Error ? error.message : String(error)}`)
            endGeneration(genKey)
            return false
        }
    }
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
    const cacheFriendlyContext = DBState.db.risuBardCacheFriendlyContext === true
    let cacheFriendlyNarrativeMessage: OpenAIChat | null = null
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
                && optionalWikiBudget
                && currentInput.trim().length > 0) {
                const inquiryStartedAt = performance.now()
                wikiInquiryAttempted = true
                try {
                    const inquirySettings = resolvedRisuBardSettings(currentChat, true)
                    activateWikiEmbeddings(currentChar.chaId, narrativeSessionChatId, DBState.db)
                    if (inquirySettings.risuBardHistoricalSourceMatchLimit > 0) refreshHistoricalSourceEmbeddings(currentChar.chaId, narrativeSessionChatId, DBState.db,
                        currentChat.message, true)
                    else stopHistoricalSourceEmbeddings()
                    const retrievalRecentContext = buildBoundedNarrativeInquiryFallback(projectRecentMemoryMessages(
                            currentChat.message.slice(currentChat.message.findLastIndex(
                                message => message.disabled === 'allBefore',
                            ) + 1), 4, undefined, undefined,
                            !inquirySettings.risuBardResponseExcludeUserMessages,
                            true,
                        ))
                    // A remote embedding model can take several seconds; wait as long as the wiki lookup may.
                    const embedded = await wikiEmbeddingRuntime.search(currentInput, retrievalRecentContext,
                        inquirySettings.risuBardInquiryTimeoutMs)
                    wikiSemanticSkip = embedded.skipped
                    // Refresh does not delay this response; inquiry verifies old ranges against live hashes.
                    wikiEmbeddingRuntime.refresh()
                    const historicalOptions = {
                        ignoreOocTurns: true,
                        excludeRecentMessages: normalizeNarrativeWorkingMessageLimit(inquirySettings.risuBardResponseMessageCount),
                        maximumMatches: inquirySettings.risuBardHistoricalSourceMatchLimit,
                        timeoutMs: inquirySettings.risuBardInquiryTimeoutMs,
                    }
                    const historicalMatches = mergeHistoricalSourceMatches(
                        findHistoricalSourceMatches({ ...historicalOptions, currentInput, messages: currentChat.message }),
                        await searchHistoricalSourceEmbeddings(currentInput, retrievalRecentContext, currentChat.message, historicalOptions),
                        inquirySettings.risuBardHistoricalSourceMatchLimit,
                    )
                    const inquiryTimeline = buildInquiryTimeline(
                        currentChat.message,
                        normalizeNarrativeWorkingMessageLimit(inquirySettings.risuBardResponseMessageCount),
                    )
                    const resolveSources = (messageIds: readonly string[], evidenceRequests: readonly { messageId: string; documentId?: string }[]) =>
                        resolveHistoricalSourceMatchesById({
                            ignoreOocTurns: true,
                            messageIds,
                            messages: currentChat.message,
                            currentInput,
                            queryByMessageId: Object.fromEntries(evidenceRequests
                                .filter(request => request.documentId && embedded.evidenceHints[request.documentId])
                                .map(request => [request.messageId, embedded.evidenceHints[request.documentId!]])),
                            excludeRecentMessages:
                                normalizeNarrativeWorkingMessageLimit(
                                    inquirySettings.risuBardResponseMessageCount
                                ),
                        })
                    const loadInquiry = (semanticMatches?: readonly WikiSemanticMatch[], ranked?: {
                        sourceMatches: readonly HistoricalSourceMatch[]
                        rankedSourceIds: readonly string[]
                    }) => loadNarrativeInquiry({
                        contextSelection: 'auto',
                        timeline: inquiryTimeline,
                        characterId: currentChar.chaId,
                        chatId: narrativeSessionChatId,
                        currentInput,
                        fallbackInput: buildBoundedNarrativeInquiryFallback(
                            projectRecentMemoryMessages(
                                currentChat.message,
                                normalizeNarrativeWorkingMessageLimit(
                                    inquirySettings.risuBardResponseMessageCount
                                ), undefined, undefined, true, true
                            )
                        ),
                        entityHints: lorepmt.bardWikiEntityHints,
                        tokenBudget: optionalWikiBudget!,
                        sourceMatches: ranked?.sourceMatches ?? historicalMatches,
                        sourceLimit:
                            inquirySettings.risuBardHistoricalSourceMatchLimit,
                        ...(ranked
                            ? { rankedSourceIds: ranked.rankedSourceIds }
                            : { resolveSourceMatches: resolveSources }),
                        fetchImpl: fetch,
                        createAuth: () => forageStorage.createAuth(),
                        timeoutMs: inquirySettings.risuBardInquiryTimeoutMs,
                        ...(semanticMatches ? { semanticMatches } : {}),
                    })
                    let inquiry = await loadInquiry(embedded.matches)
                    if (inquirySettings.risuBardSourceRerank) {
                        // A model reads the candidate originals against the question; any failure keeps the scored choice.
                        try {
                            const known = new Set(historicalMatches.map(match => match.messageId))
                            const pool = buildSourceRerankPool(
                                historicalMatches,
                                await resolveSources(inquiry.evidenceRequests
                                    .filter(request => !known.has(request.messageId))
                                    .map(request => request.messageId), inquiry.evidenceRequests),
                                findHistoricalSourceMatches({ ...historicalOptions, maximumMatches: SOURCE_RERANK_POOL_LIMIT,
                                    currentInput, messages: currentChat.message }),
                            )
                            const reranker = normalizeRisuBardSourceRerankerSettings(DBState.db.risuBardSourceReranker)
                            const rankedSourceIds = pool.length === 0 ? [] : reranker.method === 'reranker'
                                ? await rerankSourcesWithApi(currentInput, pool, reranker, (url, init) => globalFetch(url, {
                                    ...init,
                                    ...(isLocalNetworkUrl(url) ? { networkRoute: 'local_network' as const } : {}),
                                    logCategory: 'other',
                                    logSource: 'memory',
                                    logPurpose: 'bardwiki-source-rerank',
                                }), arg.signal)
                                : parseSourceRerank(readModelResponseText(
                                await requestWithProviderOutputLimit({
                                    formated: [
                                        { role: 'system' as const, content: SOURCE_RERANK_SYSTEM_PROMPT },
                                        { role: 'user' as const, content: buildSourceRerankInput(currentInput, pool) },
                                    ],
                                    useStreaming: false,
                                    noMultiGen: true,
                                    tools: [],
                                    // Thinking models spend reasoning tokens from this limit; a fixed 512 cut them off before the JSON.
                                    maxTokens: inquirySettings.risuBardAnalysisTokenLimit,
                                    temperature: 0,
                                    bias: {},
                                    extractJson: '',
                                    schema: SOURCE_RERANK_SCHEMA,
                                    logSource: 'memory' as const,
                                    logPurpose: 'bardwiki-source-rerank' as const,
                                    realChatId,
                                }, (attempt) => requestChatData(attempt, inquirySettings.risuBardModelMode, arg.signal))), pool)
                            if (rankedSourceIds.length > 0) {
                                inquiry = await loadInquiry(embedded.matches, {
                                    sourceMatches: buildSourceRerankPool(
                                        rankedSourceIds.map(id => pool.find(match => match.messageId === id)!),
                                        pool,
                                    ),
                                    rankedSourceIds,
                                })
                            }
                        }
                        catch (error) {
                            if (arg.signal?.aborted) throw error
                            console.warn('RisuBard source rerank skipped', error)
                        }
                    }
                    sources = inquiry.sources
                    wikiInquirySources = [...requiredWikiSources, ...sources]
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
                    wikiInquiryError = wikiInquiryFailure(error)
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
            // Cache-friendly mode keeps the slow-changing baseline in the
            // description slot and moves per-turn sources next to the latest
            // user message, after the stable prompt prefix.
            const currentPrompt = narrativeContext.sourceChanged
                ? null
                : createNarrativeSourcesPrompt(
                    sources,
                    cacheFriendlyContext ? '' : narrativeContext.baseline ?? '',
                    undefined,
                    requiredWikiSources.length ? '' : responseWikiPromptGuide
                )
            const baselinePrompt = cacheFriendlyContext
                && !narrativeContext.sourceChanged
                ? createNarrativeSourcesPrompt([], narrativeContext.baseline ?? '')
                : null
            if (currentPrompt || baselinePrompt) {
                narrativeContextObservation.mode = 'current'
                narrativeContextObservation.reason =
                    narrativeContextObservation.promptMode === 'v2-current'
                        ? 'v2-inquiry-injected'
                        : 'bounded-fallback-injected'
                const baseline = narrativeContext.baseline?.trim() ?? ''
                const baselineStatusSources: RequestInjectionSource[] = []
                if (baseline && (baselinePrompt ?? currentPrompt ?? '').includes(baseline)) {
                    baselineStatusSources.push({
                        kind: 'character',
                        name: currentChar.name,
                        role: 'system',
                        content: baseline,
                    })
                }
                const requestStatusSources: RequestInjectionSource[] =
                    cacheFriendlyContext ? [] : baselineStatusSources
                if (currentPrompt && responseWikiPromptGuide
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
                    currentPrompt ?? ''
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
                const currentContextMessage: OpenAIChat | null = currentPrompt
                    ? { role: 'system', content: currentPrompt, requestStatusSources }
                    : null
                if (currentContextMessage && requestStatusSources.length === 0) {
                    setRequestStatusSource(currentContextMessage, 'memory')
                }
                if (cacheFriendlyContext) {
                    cacheFriendlyNarrativeMessage = currentContextMessage
                }
                const staticContextMessage: OpenAIChat | null = cacheFriendlyContext
                    ? baselinePrompt
                        ? { role: 'system', content: baselinePrompt, requestStatusSources: baselineStatusSources }
                        : null
                    : currentContextMessage
                if (staticContextMessage) {
                const mergedContext = mergeNarrativeContextWithStaticPrompt({
                    currentContext: staticContextMessage,
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
        }
        catch (error) {
            wikiInquiryError = wikiInquiryFailure(error)
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
            content: parseGenerationText(resolvePosition(lorebook.prompt), {chara: currentChar})
        }, lorebook.requestStatusKind, lorebook.source))
    }

    const descActives = lorepmt.actives.filter(v => {
        return v.pos === 'after_desc' || v.pos === 'before_desc' || v.pos === 'personality' || v.pos === 'scenario'
    })

    for(const lorebook of descActives){
        const c = setRequestStatusSource({
            role: lorebook.role,
            content: parseGenerationText(resolvePosition(lorebook.prompt), {chara: currentChar})
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

    const personaPromptText = getPersonaPrompt({ character: generationScope.character, chat: generationScope.chat })
    if(personaPromptText){
        unformated.personaPrompt.push(setRequestStatusSource({
            role: 'system',
            content: parseGenerationText(personaPromptText, {chara: currentChar})
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
            content: parseGenerationText(resolvePosition(lorebook.prompt), {chara: currentChar})
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
            content: parseGenerationText(resolvePosition(lorebook.prompt), {chara: currentChar})
        }, lorebook.requestStatusKind, lorebook.source))
    }

    //await tokenize currernt
    let currentTokens = maxResponseTokens
    const requiredWikiMessage = createRequiredWikiMessage(requiredWikiSources, responseWikiPromptGuide)
    if (requiredWikiMessage) currentTokens += await tokenizer.tokenizeChat(requiredWikiMessage)
    if (cacheFriendlyNarrativeMessage) currentTokens += await tokenizer.tokenizeChat(cacheFriendlyNarrativeMessage)
    const cacheFriendlyWikiMessages = cacheFriendlyContext
        ? [requiredWikiMessage, cacheFriendlyNarrativeMessage].filter((message) => message !== null)
        : []
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
                            pmt[i].content = parseGenerationText(positionParser(card.innerFormat,card.type), {chara: currentChar}).replace('{{slot}}', pmt[i].content)
                        }
                    }

                    await tokenizeChatArray(pmt)
                    break
                }
                case 'description':{
                    let pmt = getDescriptionPrompts(card.role2)
                    if(card.innerFormat && pmt.length > 0){
                        for(let i=0;i<pmt.length;i++){
                            pmt[i].content = parseGenerationText(positionParser(card.innerFormat,card.type), {chara: currentChar}).replace('{{slot}}', pmt[i].content)
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
                            pmt[i].content = parseGenerationText(positionParser(card.innerFormat,card.type), {chara: currentChar}).replace('{{slot}}', pmt[i].content || card.defaultText || '')
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
                    if(usingPromptTemplate && requestSettings.promptSettings.postEndInnerFormat){
                        await tokenizeChatArray([{
                            role: 'system',
                            content: requestSettings.promptSettings.postEndInnerFormat
                        }])
                    }
                    break
                }
                case 'plain':
                case 'jailbreak':
                case 'cot':{
                    if((!requestSettings.jailbreakToggle) && (card.type === 'jailbreak')){
                        continue
                    }
                    if((!requestSettings.chainOfThought) && (card.type === 'cot')){
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
                        content = (parseGenerationText(content, {chara: currentChar, role: card.role}))
                    }
                    else if(card.type2 === 'main'){
                        content = (parseGenerationText(content, {chara: currentChar, role: card.role}))
                    }
                    else{
                        content = parseGenerationText(content, {chara: currentChar, role: card.role})
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

                    if(usingPromptTemplate && requestSettings.promptSettings.sendChatAsSystem && (!card.chatAsOriginalOnSystem)){
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
    
    const examples = exampleMessage(currentChar, getUserName({ character: generationScope.character, chat: generationScope.chat }))

    for(const example of examples){
        currentTokens += await tokenizer.tokenizeChat(example)
    }

    let chats:OpenAIChat[] = examples

    if(!requestSettings.aiModel.startsWith('novelai') && !DBState.db?.promptSettings?.trimStartNewChat){
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
            content: await renderFirstMessage(firstMsg)
        }

        if(usingPromptTemplate && requestSettings.promptSettings.sendName){
            chat.content = `${currentChar.name}: ${chat.content}`
            chat.attr = ['nameAdded']
        }
        chats.push(chat)
        currentTokens += await tokenizer.tokenizeChat(chat)
    }
    console.log('Prepared messages for token calculation:', ms)

    const triggerResult = await runTrigger(currentChar, 'start', {chat: currentChat})
    if(triggerResult){
        renderedFirstMessageCache = undefined
        currentChat = triggerResult.chat
        generationScope.chat = normalizeChat(currentChat)
        ms = makeMs(currentChat)
        currentTokens += triggerResult.tokens
        if(triggerResult.stopSending){
            endGeneration(genKey)
            return false
        }
    }

    narrativeContextObservation.availableHistoryMessages = countNarrativeTurns(ms)
    const narrativeWorkingMessageLimit =
        normalizeNarrativeWorkingMessageLimit(
            resolvedRisuBardSettings(currentChat).risuBardResponseMessageCount
        )
    const narrativeWorkingMessageStep = cacheFriendlyContext
        ? cacheStableWorkingMessageStep(narrativeWorkingMessageLimit)
        : 1
    ms = selectNarrativeWorkingMessages(
        ms,
        narrativeWorkingMessageLimit,
        !resolvedRisuBardSettings(currentChat).risuBardResponseExcludeUserMessages,
        true,
        isOocToggleActive([
            ...Object.keys(currentChat.GLGlobalVariables ?? {}),
            ...Object.keys(DBState.db.globalChatVariables ?? {}),
        ], (key) => getGlobalChatVar(key, currentChat)) !== false,
        narrativeWorkingMessageStep,
    )
    narrativeContextObservation.selectedHistoryMessages = ms.length

    if(shouldIncludeNarrativeFirstMessage(
            narrativeContextObservation.availableHistoryMessages,
            narrativeWorkingMessageLimit,
            narrativeWorkingMessageStep
        )){
        await addFirstMessage()
    }

    let index = 0
    for(const msg of ms){
        let formatedChat = (await processGenerationScriptFull(nowChatroom,parseGenerationText(msg.data, {chara: currentChar, role: msg.role}), 'editprocess', index, {
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
            name = `${getUserName({ character: generationScope.character, chat: generationScope.chat })}`
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
        const modelinfo = getModelInfo(requestSettings.aiModel)
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

        if(usingPromptTemplate && requestSettings.promptSettings.sendName){
            const form = requestSettings.groupTemplate || `<{{char}}\'s Message>\n{{slot}}\n</{{char}}\'s Message>`
            formatedChat = parseGenerationText(form, {chara: currentChar.name}).replace('{{slot}}', formatedChat)
        }
        let thoughts:string[] = []
        const maxThoughtDepth = requestSettings.promptSettings?.maxThoughtTagDepth ?? -1
        formatedChat = formatedChat.replace(/<Thoughts>(.+)<\/Thoughts>/gms, (match, p1) => {
            if(maxThoughtDepth === -1 || (maxThoughtDepth - ms.length) <= index){
                thoughts.push(p1)
            }
            return ''
        })

        const assetPromises:Promise<void>[] = []
        formatedChat = formatedChat.replace(/\{\{asset_?prompt::(.+?)\}\}/gmsiu, (match, p1) => {
            const moduleAssets = getModuleAssets({ character: generationScope.character, chat: generationScope.chat })
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
            content: parseGenerationText(resolvePosition(depthPrompt.prompt), {chara: currentChar})
        }
        currentTokens += await tokenizer.tokenizeChat(chat)
    }
    
    // BardWiki already selected the response history. Legacy memory flags are
    // compatibility data and must not activate another summarizer here.
    {
        stageTimings.stage1Duration = Date.now() - stageTimings.stage1Start
        while(currentTokens > maxContextTokens){
            if(chats.length <= 1){
                throwError(language.errors.toomuchtoken + "\n\nRequired Tokens: " + currentTokens)
                endGeneration(genKey)
                return false
            }

            currentTokens -= await tokenizer.tokenizeChat(chats[0])
            chats.splice(0, 1)
        }
    }

    let biases:[string,number][] = requestSettings.bias.concat(currentChar.bias).map((v) => {
        return [parseGenerationText(v[0].replaceAll("\\n","\n").replaceAll("\\r","\r").replaceAll("\\\\","\\"), {chara: currentChar}),v[1]]
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
            content: parseGenerationText(resolvePosition(depthPrompt.prompt), {chara: currentChar})
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
    const formatOrder = safeStructuredClone(requestSettings.formatingOrder)
    if(formatOrder){
        formatOrder.push('postEverything')
    }

    //continue chat model
    if(arg.continue && (requestSettings.aiModel.startsWith('claude') || requestSettings.aiModel.startsWith('gpt') || requestSettings.aiModel.startsWith('openrouter') || requestSettings.aiModel.startsWith('reverse_proxy'))){
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
            if(!(requestSettings.aiModel.startsWith('gpt') || requestSettings.aiModel.startsWith('claude') || requestSettings.aiModel === 'openrouter' || requestSettings.aiModel === 'reverse_proxy')){
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
            content: parseGenerationText(fmt),
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
                            pmt[i].content = parseGenerationText(positionParser(card.innerFormat,card.type), {chara: currentChar}).replace('{{slot}}', pmt[i].content)

                            if(requestSettings.promptInfoInsideChat && requestSettings.promptTextInfoInsideChat){
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
                            pmt[i].content = parseGenerationText(positionParser(card.innerFormat,card.type), {chara: currentChar}).replace('{{slot}}', pmt[i].content)
                            
                            if(requestSettings.promptInfoInsideChat && requestSettings.promptTextInfoInsideChat){
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
                            pmt[i].content = parseGenerationText(positionParser(card.innerFormat,card.type), {chara: currentChar}).replace('{{slot}}', pmt[i].content || card.defaultText || '')
                            
                            if(requestSettings.promptInfoInsideChat && requestSettings.promptTextInfoInsideChat){
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
                    if(usingPromptTemplate && requestSettings.promptSettings.postEndInnerFormat){
                        pushPrompts([{
                            role: 'system',
                            content: requestSettings.promptSettings.postEndInnerFormat
                        }], { kind: 'instruction' })
                    }
                    break
                }
                case 'plain':
                case 'jailbreak':
                case 'cot':{
                    if((!requestSettings.jailbreakToggle) && (card.type === 'jailbreak')){
                        continue
                    }
                    if((!requestSettings.chainOfThought) && (card.type === 'cot')){
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
                        content = (parseGenerationText(content, {chara: currentChar, role: card.role}))
                    }
                    else if(card.type2 === 'main'){
                        content = (parseGenerationText(content, {chara: currentChar, role: card.role}))
                    }
                    else{
                        content = parseGenerationText(content, {chara: currentChar, role: card.role})
                    }

                    const prompt:OpenAIChat ={
                        role: convertPromptRole[card.role],
                        content: content
                    }

                    if(requestSettings.promptInfoInsideChat && requestSettings.promptTextInfoInsideChat && card.type2 !== 'globalNote'){
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
                    if(usingPromptTemplate && requestSettings.promptSettings.sendChatAsSystem && (!card.chatAsOriginalOnSystem)){
                        chats = systemizeChat(chats)
                    }
                    pushPrompts(chats, {
                        kind: 'chatHistory',
                        name: `${chats.length}개 (${start + 1}~${injectedEnd})`,
                    })

                    if(requestSettings.automaticCachePoint && !hasCachePoint){
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
                            pmt[i].content = parseGenerationText(card.innerFormat, {chara: currentChar}).replace('{{slot}}', pmt[i].content)

                            if(requestSettings.promptInfoInsideChat && requestSettings.promptTextInfoInsideChat){
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

    if(requestSettings.promptInfoInsideChat && requestSettings.promptTextInfoInsideChat){
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
            content: parseGenerationText(depthPrompt.prompt, {chara: currentChar})
        }, 'instruction'))
    }

    formated = await runLuaEditTrigger(currentChar, 'editRequest', formated)
    for(const message of formated) syncRequestStatusSource(message)

    // Inject after preset/script assembly, before the model's token check. This
    // survives optional retrieval failure and presets without a description block.
    if (cacheFriendlyWikiMessages.length) {
        formated = insertBeforeLatestUserMessage(formated, cacheFriendlyWikiMessages)
    }
    else if (requiredWikiMessage) formated.unshift(requiredWikiMessage)
    if (requiredWikiMessage) {
        if (narrativeContextObservation.mode !== 'current') narrativeContextObservation.reason = 'required-wiki-injected'
        narrativeContextObservation.mode = 'current'
        narrativeContextObservation.promptMode = 'v2-current'
    }
    narrativeContextObservation.inspectedNodeCount = Math.max(requiredWikiDocumentCount, narrativeContextObservation.inspectedNodeCount)
    narrativeContextObservation.selectedSourceIds = wikiInquirySources.map(source => source.id)
    narrativeContextObservation.selectedNodeCount = wikiInquirySources.length
    narrativeContextObservation.selectedTokens = wikiInquirySources.reduce((sum, source) => sum + source.tokens, 0)
    narrativeContextObservation.inquiryDurationMs += requiredWikiDurationMs

    if(requestSettings.promptInfoInsideChat && requestSettings.promptTextInfoInsideChat){
        promptBodyformatedForChatStore = await runLuaEditTrigger(currentChar, 'editRequest', promptBodyformatedForChatStore)
        if (cacheFriendlyWikiMessages.length) {
            promptBodyformatedForChatStore = insertBeforeLatestUserMessage(promptBodyformatedForChatStore, cacheFriendlyWikiMessages)
        }
        else if (requiredWikiMessage) promptBodyformatedForChatStore.unshift(requiredWikiMessage)
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

    const inputTokenLimit = requiredWikiMessage ? maxContextTokens - maxResponseTokens : maxContextTokens
    if(inputTokens > inputTokenLimit){
        let pointer = 0
        while(inputTokens > inputTokenLimit){
            if(pointer >= formated.length){
                throwError(language.errors.toomuchtoken + "\n\nAt token rechecking. Required Tokens: " + inputTokens)
                endGeneration(genKey)
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
            wikiInquiry: createWikiInquiryDiagnostic({
                attempted: wikiInquiryAttempted,
                ...(wikiInquiryAttempted && !wikiInquiryError ? {
                    documentCount: narrativeContextObservation.inspectedNodeCount,
                    candidateCount: narrativeContextObservation.candidateCount,
                } : {}),
                failure: wikiInquiryError,
                ...(wikiSemanticSkip ? { semanticSkip: wikiSemanticSkip } : {}),
                sources: wikiInquirySources,
                messages: formated,
            }),
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
        const contMsgs = generationScope.chat.message
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
        message: `${generationModel} 요청 시작 / ${formatWikiInquiryDiagnostic(generationInfo.risuBardContext!.wikiInquiry!)}`,
        wikiPaths: generationInfo.risuBardContext?.wikiPaths,
    })

    if (!arg.previewPrompt) captureChatContext(realChatId, formated)
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
        modelBindingTarget: generationScope.chat,
        requestSettings,
        logPurpose: 'chat-response',
        imageResponse: requestSettings.outputImageModal,
        previewBody: arg.previewPrompt,
        escape: nowChatroom.type === 'character' && nowChatroom.escapeOutput,
        rememberToolUsage: requestSettings.rememberToolUsage,
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
    // An output trigger hands back a plain copy of the chat. Once that copy is
    // stored, deleting fields on it no longer reaches the reactive chat that the
    // screen and saves read, so edit the stored chat instead.
    const attachOutputScriptstateCheckpoint = () => {
        const storedChat = generationScope.chat
        const outputMessageIndex = findMessageIndexByChatId(storedChat, outputMessageId)
        if(outputMessageIndex < 0) return
        attachScriptstateCheckpoint(
            storedChat.message,
            outputMessageIndex,
            scriptstateBeforeResponse,
            snapshotChatScriptstate(storedChat.scriptstate),
        )
    }

    if(abortSignal.aborted === true){
        return false
    }
    if(req.type === 'fail'){
        throwError(req.result)
        endGeneration(genKey)
        return false
    }
    else if(req.type === 'streaming'){
        const reader = req.result.getReader()
        try {
        let msgIndex = generationScope.chat.message.length
        let prefix = ''
        if(arg.continue){
            msgIndex -= 1
            prefix = generationScope.chat.message[msgIndex].data
        }
        else{
            generationScope.chat.message.push({
                role: 'char',
                data: "",
                saying: currentChar.chaId,
                time: Date.now(),
                generationInfo,
                promptInfo,
                chatId: generationId,
            })
        }
        outputMessageId = generationScope.chat.message[msgIndex]?.chatId
        const performanceMode: StreamingDisplayOptimizationMode = requestSettings.streamingDisplayOptimizationMode ?? 'balanced'
        generationScope.chat.isStreaming = true
        generationScope.chat.activeStreamingDisplayOptimizationMode = performanceMode
        generationScope.character.reloadKeys += 1
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
                        generationScope.chat.message[msgIndex].data = reformatContent(prefix + nextResult)
                        generationScope.character.reloadKeys += 1
                        continue
                    }
                    let result2 = await processGenerationScriptFull(nowChatroom, reformatContent(prefix + nextResult), 'editoutput', msgIndex)
                    generationScope.chat.message[msgIndex].data = result2.data
                    emoChanged = result2.emoChanged
                    generationScope.character.reloadKeys += 1
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
                    if(requestSettings.removeIncompleteResponse){
                        result = trimUntilPunctuation(result)
                    }
                    if(coalesceStreamingDisplay){
                        pendingStreamingResult = result
                        scheduleStreamingDisplayFlush()
                    }
                    else{
                        let result2 = await processGenerationScriptFull(nowChatroom, reformatContent(prefix + result), 'editoutput', msgIndex)
                        generationScope.chat.message[msgIndex].data = result2.data
                        emoChanged = result2.emoChanged
                        generationScope.character.reloadKeys += 1
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
                    let result2 = await processGenerationScriptFull(nowChatroom, reformatContent(prefix + result), 'editoutput', msgIndex)
                    generationScope.chat.message[msgIndex].data = result2.data
                    emoChanged = result2.emoChanged
                }
            }
            finally {
                void reader.cancel().catch(() => {})
                generationScope.chat.isStreaming = false
                generationScope.chat.activeStreamingDisplayOptimizationMode = undefined
                generationScope.character.reloadKeys += 1
            }
        }

        if(streamAborted || abortSignal.aborted){
            return false
        }

        generationScope.chat = runCurrentChatFunction(generationScope.chat)
        currentChat = generationScope.chat
        const triggerResult = await runTrigger(currentChar, 'output', {chat:currentChat})
        if(triggerResult && triggerResult.chat){
            currentChat = normalizeChat(triggerResult.chat)
        }
        if(triggerResult && triggerResult.sendAIprompt){
            resendChat = true
        }
        const inlayr = runInlayScreen(currentChar, currentChat.message[msgIndex].data)
        currentChat.message[msgIndex].data = inlayr.text
        generationScope.chat = currentChat
        if(inlayr.promise){
            const t = await inlayr.promise
            currentChat.message[msgIndex].data = t
            generationScope.chat = currentChat
        }
        await dispatchCommittedChatOutput(pluginV2.chatOutput, {
            char: currentChar,
            chat: currentChat,
            characterIndex: generationScope.characterIndex,
            chatIndex: generationScope.chatIndex,
            messageIndex: findMessageIndexByChatId(currentChat, outputMessageId),
        })
        attachOutputScriptstateCheckpoint()
        if(requestSettings.ttsAutoSpeech){
            await sayTTS(currentChar, result)
        }
        } finally {
            // Includes failure before the first chunk (e.g. the target was deleted).
            void reader.cancel().catch(() => {})
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
            let msgIndex = generationScope.chat.message.length
            let result2 = await processGenerationScriptFull(nowChatroom, reformatContent(mess), 'editoutput', msgIndex)
            if(i === 0 && arg.continue){
                msgIndex -= 1
                let beforeChat = generationScope.chat.message[msgIndex]
                result2 = await processGenerationScriptFull(nowChatroom, reformatContent(beforeChat.data + mess), 'editoutput', msgIndex)
            }
            if(requestSettings.removeIncompleteResponse){
                result2.data = trimUntilPunctuation(result2.data)
            }
            result = result2.data
            const inlayResult = runInlayScreen(currentChar, result)
            result = inlayResult.text
            emoChanged = result2.emoChanged
            if(i === 0 && arg.continue){
                generationScope.chat.message[msgIndex] = {
                    role: 'char',
                    data: result,
                    saying: currentChar.chaId,
                    time: Date.now(),
                    generationInfo,
                    promptInfo,
                    // Keep the original message identity: older jobs match on it
                    // (jobRecovery secondary match) — see the continue restamp note.
                    chatId: generationScope.chat.message[msgIndex]?.chatId ?? generationId,
                }       
                if(inlayResult.promise){
                    const p = await inlayResult.promise
                    generationScope.chat.message[msgIndex].data = p
                }
            }
            else if(i===0){
                generationScope.chat.message.push({
                    role: msg[0],
                    data: result,
                    saying: currentChar.chaId,
                    time: Date.now(),
                    generationInfo,
                    promptInfo,
                    chatId: generationId,
                })
                const ind = generationScope.chat.message.length - 1
                if(inlayResult.promise){
                    const p = await inlayResult.promise
                    generationScope.chat.message[ind].data = p
                }
                mrerolls.push(result)
            }
            else{
                mrerolls.push(result)
            }
            if(i === 0){
                outputMessageId = generationScope.chat.message[msgIndex]?.chatId
            }
            generationScope.character.reloadKeys += 1
            if(requestSettings.ttsAutoSpeech){
                await sayTTS(currentChar, result)
            }
        }

        generationScope.chat = runCurrentChatFunction(generationScope.chat)
        currentChat = generationScope.chat

        const triggerResult = await runTrigger(currentChar, 'output', {chat:currentChat})
        if(triggerResult && triggerResult.chat){
            currentChat = normalizeChat(triggerResult.chat)
            generationScope.chat = currentChat
        }
        if(triggerResult && triggerResult.sendAIprompt){
            resendChat = true
        }
        await dispatchCommittedChatOutput(pluginV2.chatOutput, {
            char: currentChar,
            chat: currentChat,
            characterIndex: generationScope.characterIndex,
            chatIndex: generationScope.chatIndex,
            messageIndex: findMessageIndexByChatId(currentChat, outputMessageId),
        })
        attachOutputScriptstateCheckpoint()
    }

    let needsAutoContinue = false
    const resultTokens = await tokenize(result) + (arg.usedContinueTokens || 0)
    if (generationInfo) generationInfo.outputTokens = resultTokens
    if(requestSettings.autoContinueMinTokens > 0 && resultTokens < requestSettings.autoContinueMinTokens){
        needsAutoContinue = true
    }

    if(requestSettings.autoContinueChat && (!isLastCharPunctuation(result))){
        //if result doesn't end with punctuation or special characters, auto continue
        needsAutoContinue = true
    }

    if(needsAutoContinue){
        endGeneration(genKey, { keepPendingAbort: true })
        return await sendChat(chatProcessIndex, {
            target,
            requestSettings,
            chatAdditonalTokens: arg.chatAdditonalTokens,
            continue: true,
            signal: abortSignal,
            usedContinueTokens: resultTokens
        })
    }

    const igp = parseGenerationText(requestSettings.igpPrompt ?? "")

    if(igp){
        const igpFormated = parseChatML(igp)
        const rq = await requestChatData({
            formated: igpFormated,
            bias: {}
        },'emotion', abortSignal)

        generationScope.chat.message[generationScope.chat.message.length - 1].data += rq
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
        
        const lastMessageIndex = generationScope.chat.message.length - 1
        if(lastMessageIndex >= 0 && generationScope.chat.message[lastMessageIndex].generationInfo) {
            generationScope.chat.message[lastMessageIndex].generationInfo = generationInfo
        }
        
        endGeneration(genKey, { keepPendingAbort: true })
        return await sendChat(chatProcessIndex, {
            target,
            requestSettings,
            signal: abortSignal
        })
    }

    if(requestSettings.notification
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

            if(requestSettings.emotionProcesser === 'embedding'){
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
                    content: `${requestSettings.emotionPrompt2 || "From the list below, choose a word that best represents a character's outfit description, action, or emotion in their dialogue. Prioritize selecting words related to outfit first, then action, and lastly emotion. Print out the chosen word."}\n\n list: ${shuffleArray(emotionList).join(', ')} \noutput only one word.`
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
                if(abortSignal.aborted){
                    return true
                }
                throwError(rq.result)
                return true
            }
            if(rq.type === 'streaming' || rq.type === 'multiline'){
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
                    return true
                }
            }
            
            return true


        }
        else if(currentChar.viewScreen === 'imggen'){
            const msgs = generationScope.chat.message
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
    
    const lastMessageIndex = generationScope.chat.message.length - 1
    if(lastMessageIndex >= 0 && generationScope.chat.message[lastMessageIndex].generationInfo) {
        generationScope.chat.message[lastMessageIndex].generationInfo = generationInfo
    }

    if (narrativeTurnToConfirm
        && shouldAutomaticallyConfirmNarrativeTurn(
            requestSettings.risuBardAutoWikiEnabled
        )) {
        // Turns that failed before stay queued and go first, in story order.
        queueNarrativeTurn({
            characterId: currentChar.chaId,
            chatId: narrativeSessionChatId,
            targetMessageId: narrativeTurnToConfirm.targetMessageId,
        })
    }

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
