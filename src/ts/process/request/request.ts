import { Ollama } from 'ollama/dist/browser.mjs';
import { buildOllamaChatRequest, createOllamaFetch } from './ollamaRequest';
import { language } from "../../../lang";
import { globalFetch, fetchNative } from "../../globalApi.svelte";
import { getModelInfo, LLMFlags, LLMFormat, type LLMModel } from "../../model/modellist";
import { risuChatParser, risuEscape, risuUnescape } from "../../parser/parser.svelte";
import { pluginProcess, pluginV2, type PluginV2ProviderArgument } from "../../plugins/plugins.svelte";
import { resolvePluginRequestStatus } from "../../plugins/providerRequestStatus";
import {
    createPluginStructuredOutput,
    isPluginStructuredOutputValidationFailure,
    normalizePluginStructuredOutputFailure,
    pluginStructuredOutputRepairMessage,
    resolvePluginStructuredOutput,
    shouldFallbackFromNativeStructuredOutput,
} from '../../plugins/providerStructuredOutput';
import { getCurrentCharacter, getCurrentChat, getDatabase, type Database, type character } from "../../storage/database.svelte";
import { resolveRisuBardChatSettings } from '../../risubard/risuBardSettings';
import { tokenizeNum, encodeWithTokenizer } from "../../tokenizer";
import { v4 as uuidv4 } from "uuid";
import { simplifySchema, sleep } from "../../util";
import type { OpenAIChat } from "../index.svelte";
import { getTools, callTool, encodeToolCall, decodeToolCall } from "../mcp/mcp";
import type { MCPTool, RPCToolCallContent } from "../mcp/mcplib";
import { NovelAIBadWordIds, stringlizeNAIChat } from "../models/nai";
import { OobaParams } from "../prompt";
import { getStopStrings, stringlizeAINChat, unstringlizeAIN, unstringlizeChat } from "../stringlize";
import { applyChatTemplate } from "../templates/chatTemplate";
import { convertInterfaceToSchema } from "../templates/jsonSchema";
import { runTransformers } from "../transformers";
import { runTrigger } from "../triggers";
import { requestClaude } from './anthropic';
import { requestGoogleCloudVertex } from './google';
import { requestOpenAI, requestOpenAILegacyInstruct, requestOpenAIResponseAPI } from "./openAI/requests";
import { applyParameters, collectStreamingText, resolveApiSamplingParameter, resolveStoredSamplingParameter, resolveStoredTemperature, type ModelModeExtended } from './shared';
import {
    sendChatRequest, streamChatRequest, previewChatRequest,
    sendAnthropicChatRequest, streamAnthropicChatRequest, previewAnthropicChatRequest,
    sendGoogleChatRequest, streamGoogleChatRequest, previewGoogleChatRequest,
    runToolLoop,
    type AdapterCacheContext,
    type AdapterChatMessage, type AdapterChatOptions, type AdapterChatResponse,
    type AdapterChatStreamDelta, type AdapterCredential,
    type AdapterToolCall, type AdapterToolDef, type AdapterUsage,
} from "src/ts/preset/adapter";
import { formatReasoningParts } from "src/ts/preset/adapter/reasoning";
import { TOOL_CAPABLE_ADAPTER_KINDS, VISION_CAPABLE_ADAPTER_KINDS, type AdapterKind, type ModelPreset } from "src/ts/preset/types";
import { pumpPresetStream } from "./presetStreamPump";
import { preparePresetResponse, presetGenerationOverrides } from './presetResponse';
import { normalizePluginJsonStream, preparePluginResponse } from './pluginResponse';
import { filterResponseCharacters, isRetryableTransportError, normalizeRequestRetryLimit, presetFailureRetryPolicy } from './responseRetryPolicy';
import { makeJobFetch, resolveModelJobRoute } from "./jobFetch";
import { resolveChatModelBinding, resolveRequestModelBindingTarget, buildModelPresetCredential, applyPromptPresetParams, type ModelBindingTarget } from "./modelPresetBinding";
import { createModelAttemptOrder, hasNextModelAttempt } from "./fallbackOrder";
import { expandAdapterMessages, toAdapterMessage, toolResponseText } from "./modelPresetMessages";
import { createModelPresetRequestProvenance } from './modelProvenance';
import {
    createStructuredOutputFallbackMessage,
    sendWithStructuredOutputFallback,
} from './structuredOutputFallback';
import {
    createPluginRequestEvidenceRecorder,
    formatPluginProviderFailure,
    runPluginProviderWithTimeout,
} from './pluginRequestEvidence';
import { isLocalNetworkUrl } from "src/ts/network/localNetwork";
import { createRequestLogScope, recordRequestLog, requestLogEnabled, type RequestLogRoute, type RequestLogSource, type RequestLogUsage } from "src/ts/requestLog";
import { defaultRequestPurpose, type RequestPurpose } from "src/ts/requestPurpose";
import {
    startStatus, appendText, endStatus, setStatusTokenCounter, addBadge,
    buildInjectionManifest, mergeRequestStatusSources,
    type RequestKind, type RequestInjectionManifest,
} from "src/ts/status/requestStatus";

export type ToolCall = {
    name: string;
    arguments: string;
}

interface requestDataArgument{
    formated: OpenAIChat[]
    requestSettings?: Database
    bias: {[key:number]:number}
    biasString?: [string,number][]
    currentChar?: character
    temperature?: number
    maxTokens?:number
    PresensePenalty?: number
    frequencyPenalty?: number,
    useStreaming?:boolean
    isGroupChat?:boolean
    useEmotion?:boolean
    continue?:boolean
    chatId?:string
    // The REAL chat id (chat.id) associated with this request. Distinct from
    // `chatId` above, which is the per-request generationId (historical name;
    // see generation-state-keying.md §1-bis). Internal requests may supply it
    // for body-free log association; logSource decides whether job recovery
    // may insert the result into chat history.
    realChatId?:string
    noMultiGen?:boolean
    schema?:string
    extractJson?:string
    imageResponse?:boolean
    previewBody?:boolean
    staticModel?: string
    escape?:boolean
    tools?: MCPTool[]
    rememberToolUsage?: boolean
    forceStreaming?: boolean
    blockPlugins?: boolean
    forceLocalNetwork?: boolean
    // Set when this request originates from a module's own LLM call (module
    // Lua/Python script or module trigger). Lets resolveChatModelBinding route
    // it to the ModelPreset bound to that module (db.moduleModelBindings).
    // Absent for character-owned scripts and normal chat sends.
    moduleId?: string
    // Non-chat workspaces can enter the same classic/preset routing contract
    // with their own snapshotted binding bundle.
    modelBindingTarget?: ModelBindingTarget
    /** Overrides the request log's source/purpose tag. */
    logSource?:RequestLogSource
    /** Explicit user-visible reason for the request. */
    logPurpose?:RequestPurpose
}

export interface RequestDataArgumentExtended extends requestDataArgument{
    aiModel?:string
    multiGen?:boolean
    abortSignal?:AbortSignal
    modelInfo?:LLMModel
    customURL?:string
    mode?:ModelModeExtended
    key?:string
    additionalOutput?:string
    saveSignatures?:boolean
    /** Keeps non-chat callers from inheriting the currently selected chat's prompt-cache key. */
    disablePromptCache?: boolean
}

export type requestDataResponse = {
    type: 'success'|'fail'
    result: string
    noRetry?: boolean,
    fallbackEligible?: boolean,
    finishReason?: string,
    usage?: AdapterUsage,
    bindingFailure?: 'main-unset' | 'sub-unset',
    // Set when a ModelPreset request actually executed tools. The outer
    // requestChatData loop must not re-run such a response (banned-charset /
    // blank-response retries), or side-effecting tools would fire twice.
    toolExecuted?: boolean,
    special?: {
        emotion?: string
    },
    failByServerError?: boolean
    model?: string
}|{
    type: "streaming",
    result: ReadableStream<StreamResponseChunk>,
    special?: {
        emotion?: string
    }
    model?: string
}|{
    type: "multiline",
    result: ['user'|'char',string][],
    special?: {
        emotion?: string
    }
    model?: string
}

export interface StreamResponseChunk{[key:string]:string}

export async function requestChatData(arg:RequestDataArgumentExtended, model:ModelModeExtended, abortSignal:AbortSignal=null):Promise<requestDataResponse> {
    const db = arg.requestSettings ?? getDatabase()
    const retryLimit = normalizeRequestRetryLimit(db.requestRetrys)
    const internalOutput = Boolean(arg.schema) || arg.logSource === 'memory'
    const fallBackModels = createModelAttemptOrder(
        safeStructuredClone(db?.fallbackModels?.[model] ?? [])
    )
    const tools = arg.tools ?? (await getTools())
    let da:requestDataResponse

    if(arg.escape){
        arg.useStreaming = false
        console.warn('Escape is enabled, disabling streaming')
    }

    const originalFormated = safeStructuredClone(arg.formated).map(m => {
        m.content = risuUnescape(m.content)
        return m
    })

    for(let fallbackIndex=0;fallbackIndex<fallBackModels.length;fallbackIndex++){
        let trys = 0
        arg.formated = safeStructuredClone(originalFormated)

        if(fallbackIndex !== 0 && !fallBackModels[fallbackIndex]){
            continue
        }

        while(true){
            
            if(abortSignal?.aborted){
                return {
                    type: 'fail',
                    result: 'Aborted'
                }
            }
    
            if(pluginV2.replacerbeforeRequest.size > 0){
                for(const replacer of pluginV2.replacerbeforeRequest){
                    arg.formated = await replacer(arg.formated, model)
                }
            }
            
            try{
                const currentChar = arg.currentChar ?? (arg.realChatId
                    ? db.characters.find(c => c.chats.some(chat => chat.id === arg.realChatId))
                    : getCurrentCharacter())
                const requestChat = arg.realChatId
                    ? currentChar?.chats.find(chat => chat.id === arg.realChatId)
                    : currentChar?.chats[currentChar.chatPage]
                if(currentChar && requestChat){
                    const perf = performance.now()
                    const d = await runTrigger(currentChar, 'request', {
                        chat: requestChat,
                        displayMode: true,
                        displayData: JSON.stringify(arg.formated)
                    })
        
                    const got = JSON.parse(d.displayData)
                    if(!got || !Array.isArray(got)){
                        throw new Error('Invalid return')
                    }
                    arg.formated = got
                    console.log('Trigger time', performance.now() - perf)
                }
            }
            catch(e){
                console.error(e)
            }
            
    
            try {
                da = await requestChatDataMain({
                    ...arg,
                    staticModel: fallBackModels[fallbackIndex],
                    tools: tools,
                }, model, abortSignal)
            }
            catch(error) {
                if (tools.length === 0
                    && isRetryableTransportError(error, Boolean(abortSignal?.aborted))) {
                    da = {
                        type: 'fail',
                        result: error instanceof Error ? error.message : String(error),
                        failByServerError: true,
                    }
                }
                else {
                    throw error
                }
            }

            // A ModelPreset response that already executed tools must be returned
            // as-is and NEVER re-run: the side effects (possibly writes) are done.
            // This guard runs BEFORE the abort check and the success-path retries
            // (banned charset / blank fallback) — otherwise a follow-up abort or a
            // ban/blank hit would discard the result and the outer loop would
            // replay the prompt, double-executing tools. after-replacers still run
            // (transform only), but in a try/catch so a throwing plugin can't lose
            // the side-effect record either.
            if(da.type === 'success' && da.toolExecuted){
                if(arg.escape) da.result = risuEscape(da.result)
                for(const replacer of pluginV2.replacerafterRequest){
                    try { da.result = await replacer(da.result, model) }
                    catch(e){ console.error('[ModelPreset] after-replacer failed', e) }
                }
                return {
                    ...da,
                    model: fallBackModels[fallbackIndex] || da.model
                }
            }

            if(abortSignal?.aborted){
                return {
                    type: 'fail',
                    result: 'Aborted'
                }
            }

            if(da.type === 'success' && arg.escape){
                da.result = risuEscape(da.result)
            }

            if(da.type === 'success' && pluginV2.replacerafterRequest.size > 0){
                for(const replacer of pluginV2.replacerafterRequest){
                    da.result = await replacer(da.result, model)
                }
            }

            if(!internalOutput && db.banCharacterset?.length > 0){
                da = filterResponseCharacters(da, db.banCharacterset)
            }
    
            if(!internalOutput && da.type === 'success' && !da.noRetry && fallbackIndex !== fallBackModels.length-1 && db.fallbackWhenBlankResponse){
                if(da.result.trim() === ''){
                    break
                }
            }
    
            if(da.type !== 'fail' || da.noRetry){
                if (da.type === 'fail' && da.fallbackEligible
                    && hasNextModelAttempt(fallbackIndex, fallBackModels.length)) break
                return {
                    ...da,
                    // fallBackModels[fallbackIndex] is '' for the primary (non-fallback)
                    // attempt; keep the dispatcher's own model label (e.g. a ModelPreset
                    // name) instead of clobbering it with the empty sentinel.
                    model: fallBackModels[fallbackIndex] || da.model
                }
            }
    
            if(da.failByServerError){
                await sleep(1000)
                if(db.antiServerOverloads){
                    trys -= 0.5 // reduce trys by 0.5, so that it will retry twice as much
                }
            }
            
            trys += 1
            if(trys > retryLimit){
                if(!hasNextModelAttempt(
                    fallbackIndex,
                    fallBackModels.length
                ) || da.fallbackEligible === false){
                    return da
                }
                break
            }
        }   
    }


    return da ?? {
        type: 'fail',
        result: "All models failed"
    }
}

export function reformater(formated:OpenAIChat[],modelInfo:LLMModel|LLMFlags[]){

    const flags = Array.isArray(modelInfo) ? modelInfo : modelInfo.flags
    
    const db = getDatabase()
    let systemPrompt:OpenAIChat|null = null

    if(!flags.includes(LLMFlags.hasFullSystemPrompt)){
        if(flags.includes(LLMFlags.hasFirstSystemPrompt)){
            while(formated.length > 0 && formated[0].role === 'system'){
                if(systemPrompt){
                    systemPrompt.content += '\n\n' + formated[0].content
                    systemPrompt.requestStatusSources = mergeRequestStatusSources(
                        systemPrompt.requestStatusSources,
                        formated[0].requestStatusSources,
                    )
                }
                else{
                    systemPrompt = formated[0]
                }
                formated = formated.slice(1)
            }
        }

        for(let i=0;i<formated.length;i++){
            if(formated[i].role === 'system'){
                formated[i].content = db.systemContentReplacement ? db.systemContentReplacement.replace('{{slot}}', formated[i].content) : `system: ${formated[i].content}`
                formated[i].role = db.systemRoleReplacement || 'user'
            }
        }
    }
    
    if(flags.includes(LLMFlags.requiresAlternateRole)){
        let newFormated:OpenAIChat[] = []
        for(let i=0;i<formated.length;i++){
            const m = formated[i]
            if(newFormated.length === 0){
                newFormated.push(m)
                continue
            }

            if(newFormated[newFormated.length-1].role === m.role){
            
                newFormated[newFormated.length-1].content += '\n' + m.content
                newFormated[newFormated.length-1].requestStatusSources = mergeRequestStatusSources(
                    newFormated[newFormated.length-1].requestStatusSources,
                    m.requestStatusSources,
                )

                if(m.multimodals){
                    if(!newFormated[newFormated.length-1].multimodals){
                        newFormated[newFormated.length-1].multimodals = []
                    }
                    newFormated[newFormated.length-1].multimodals.push(...m.multimodals)
                }

                if(m.thoughts){
                    if(!newFormated[newFormated.length-1].thoughts){
                        newFormated[newFormated.length-1].thoughts = []
                    }
                    newFormated[newFormated.length-1].thoughts.push(...m.thoughts)
                }

                if(m.cachePoint){
                    if(!newFormated[newFormated.length-1].cachePoint){
                        newFormated[newFormated.length-1].cachePoint = true
                    }
                }

                continue
            }
            else{
                newFormated.push(m)
            }
        }
        formated = newFormated
    }

    if(flags.includes(LLMFlags.mustStartWithUserInput)){
        if(formated.length === 0 || formated[0].role !== 'user'){
            formated.unshift({
                role: 'user',
                content: ' '
            })
        }
    }

    if(systemPrompt){
        formated.unshift(systemPrompt)
    }

    return formated
}


export async function requestChatDataMain(arg:requestDataArgument, model:ModelModeExtended, abortSignal:AbortSignal=null):Promise<requestDataResponse> {
    const db = arg.requestSettings ?? getDatabase()
    const targ:RequestDataArgumentExtended = arg

    // P4 dual-regime dispatch (plan v6 §7). Resolve the per-chat ModelPreset
    // binding BEFORE any classic model selection so a binding chat never touches
    // db.aiModel / db.seperateModels. Skipped when a staticModel (fallback retry)
    // is forced — fallbacks are classic model ids.
    if(!arg.staticModel){
        const currentChat = resolveRequestModelBindingTarget(
            arg.modelBindingTarget,
            arg.realChatId,
            getCurrentChat(),
        )
        const binding = resolveChatModelBinding(currentChat, model, arg.moduleId)
        if(binding.kind === 'modelPreset'){
            return requestModelPreset(targ, applyPromptPresetParams(binding.preset, currentChat, model, db), abortSignal, model)
        }
        if(binding.kind === 'block'){
            return {
                type: 'fail',
                noRetry: true,
                bindingFailure: binding.reason,
                result: binding.reason === 'main-unset'
                    ? language.modelPresetBindingMainUnset
                    : language.modelPresetBindingSubUnset,
            }
        }
        // binding.kind === 'classic' → fall through to the classic path below.
    }

    targ.aiModel = arg.staticModel ? arg.staticModel : (model === 'model' ? db.aiModel : db.subModel)
    targ.modelInfo = getModelInfo(targ.aiModel)
    if(db.seperateModelsForAxModels && !arg.staticModel){
        if(db.seperateModels[model]){
            targ.aiModel = db.seperateModels[model]
            targ.modelInfo = getModelInfo(targ.aiModel)
        }
    }

    if(arg.blockPlugins && targ.modelInfo.id.startsWith('pluginmodel:::')){
        return {
            type: 'fail',
            result: 'Plugin calls are blocked by the caller.'
        }
    }

    targ.formated = safeStructuredClone(arg.formated)
    targ.maxTokens = arg.maxTokens ??db.maxResponse
    targ.temperature = arg.temperature === undefined
        ? resolveStoredTemperature(db.temperature)
        : resolveApiSamplingParameter('temperature', arg.temperature)
    targ.bias = arg.bias
    targ.currentChar = arg.currentChar
    // Plugin providers decide streaming themselves (their own toggle), and the
    // legacy streaming checkbox is hidden for plugin models, so only the
    // caller's opt-out (aux requests, escape output) collects their stream.
    targ.useStreaming = arg.forceStreaming
        ? true
        : targ.modelInfo.format === LLMFormat.Plugin
            ? arg.useStreaming === true
            : db.useStreaming && arg.useStreaming
    targ.continue = arg.continue ?? false
    targ.biasString = arg.biasString ?? []
    targ.multiGen = ((db.genTime > 1 && targ.aiModel.startsWith('gpt') && (!arg.continue)) && (!arg.noMultiGen))
    targ.abortSignal = abortSignal
    targ.mode = model
    targ.extractJson = arg.extractJson ?? db.extractJson
    if(targ.aiModel === 'reverse_proxy'){
        targ.modelInfo.internalID = db.customProxyRequestModel
        targ.modelInfo.format = db.customAPIFormat
        targ.customURL = db.forceReplaceUrl
        targ.key = db.proxyKey
    }
    if(targ.aiModel.startsWith('xcustom:::')){
        const found = db.customModels.find(m => m.id === targ.aiModel)
        targ.customURL = found?.url
        targ.key = found?.key
    }

    const format = targ.modelInfo.format

    targ.formated = reformater(targ.formated, targ.modelInfo)

    // Plugin providers may opt in to the host status card. Preserve source
    // annotations until requestPlugin builds the manifest; every other classic
    // provider keeps the legacy behavior and strips them before dispatch.
    if(format !== LLMFormat.Plugin){
        for (const message of targ.formated) delete message.requestStatusSources
    }

    switch(format){
        case LLMFormat.OpenAICompatible:
        case LLMFormat.Mistral:
        case LLMFormat.NanoGPT:
            return requestOpenAI(targ)
        case LLMFormat.NanoGPTResponses:
            return requestOpenAIResponseAPI(targ)
        case LLMFormat.NanoGPTMessages:
            return requestClaude(targ)
        case LLMFormat.NanoGPTLegacy:
            return requestOpenAILegacyInstruct(targ)
        case LLMFormat.OpenAILegacyInstruct:
            return requestOpenAILegacyInstruct(targ)
        case LLMFormat.NovelAI:
            return requestNovelAI(targ)
        case LLMFormat.OobaLegacy:
            return requestOobaLegacy(targ)
        case LLMFormat.Plugin:
            return requestPlugin(targ)
        case LLMFormat.Ooba:
            return requestOoba(targ)
        case LLMFormat.VertexAIGemini:
        case LLMFormat.GoogleCloud:
            return requestGoogleCloudVertex(targ)
        case LLMFormat.Kobold:
            return requestKobold(targ)
        case LLMFormat.NovelList:
            return requestNovelList(targ)
        case LLMFormat.Ollama:
            return requestOllama(targ)
        case LLMFormat.Cohere:
            return requestCohere(targ)
        case LLMFormat.Anthropic:
        case LLMFormat.AnthropicLegacy:
        case LLMFormat.AWSBedrockClaude:
            return requestClaude(targ)
        case LLMFormat.Horde:
            return requestHorde(targ)
        case LLMFormat.WebLLM:
            return requestWebLLM(targ)
        case LLMFormat.OpenAIResponseAPI:
            return requestOpenAIResponseAPI(targ)
        case LLMFormat.Echo:
            return requestEcho(targ)
    }

    return {
        type: 'fail',
        result: (language.errors.unknownModel)
    }
}


function sendModelPreset(
    kind: AdapterKind,
    preset: ModelPreset,
    options: AdapterChatOptions,
    credential: AdapterCredential | undefined,
): Promise<AdapterChatResponse> {
    switch (kind) {
        case 'openai-compatible': return sendChatRequest(preset, options, credential)
        case 'anthropic-messages': return sendAnthropicChatRequest(preset, options, credential)
        case 'google-gemini': return sendGoogleChatRequest(preset, options, credential)
    }
}

function streamModelPreset(
    kind: AdapterKind,
    preset: ModelPreset,
    options: AdapterChatOptions,
    credential: AdapterCredential | undefined,
): AsyncGenerator<AdapterChatStreamDelta, void, void> {
    switch (kind) {
        case 'openai-compatible': return streamChatRequest(preset, options, credential)
        case 'anthropic-messages': return streamAnthropicChatRequest(preset, options, credential)
        case 'google-gemini': return streamGoogleChatRequest(preset, options, credential)
    }
}

function previewModelPreset(
    kind: AdapterKind,
    preset: ModelPreset,
    options: AdapterChatOptions,
    credential: AdapterCredential | undefined,
) {
    switch (kind) {
        case 'openai-compatible': return previewChatRequest(preset, options, credential)
        case 'anthropic-messages': return previewAnthropicChatRequest(preset, options, credential)
        case 'google-gemini': return previewGoogleChatRequest(preset, options, credential)
    }
}

// Route adapter requests through the proxy-aware fetch (fetchNative) instead of
// globalThis.fetch: NodeOnly runs in the browser, so a direct cross-origin fetch
// to a provider that doesn't send CORS headers fails ("Failed to fetch").
// fetchNative tries a direct fetch first and falls back to the node /proxy2,
// matching the classic request path.
// chatId (= the message generationId) is threaded into fetchNative so the
// request is recorded in the fetch log against the message — otherwise the
// per-message "view log" shows "deleted log" for binding requests.
function makeProxiedFetch(chatId?: string, onRoute?: (route: RequestLogRoute) => void): typeof fetch {
    return ((input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString()
        return fetchNative(url, {
            // fetchNative decides direct-vs-proxy at request time (it tries a
            // direct fetch and falls back to /proxy2 on CORS/network failure),
            // so the route is reported back rather than assumed here.
            onLogRoute: onRoute,
            method: (init?.method as 'POST' | 'GET' | 'PUT' | 'DELETE') ?? 'POST',
            headers: (init?.headers as Record<string, string>) ?? {},
            body: init?.body as string,
            signal: init?.signal ?? undefined,
            chatId,
            // Local providers (e.g. self-hosted Ollama) must route through the node
            // proxy rather than a browser-direct fetch to a private address.
            networkRoute: isLocalNetworkUrl(url) ? 'local_network' : 'auto',
            // Honor the same request-timeout the classic path uses.
            requestTimeoutMs: (getDatabase().localNetworkTimeoutSec ?? 600) * 1000,
        })
    }) as typeof fetch
}

// Pull out adapter-error detail for logging without leaking the credential.
function describeModelPresetError(err: unknown): Record<string, unknown> {
    if (err && typeof err === 'object') {
        const e = err as Record<string, unknown>
        return {
            name: (e.name as string) ?? undefined,
            kind: e.kind,
            status: e.status,
            retryable: e.retryable,
            fallbackEligible: e.fallbackEligible,
            message: e.message ?? String(err),
            cause: e.cause instanceof Error ? e.cause.message : e.cause,
        }
    }
    return { message: String(err) }
}

// --- request-status publishing (model-preset path only) ------------------
//
// Thin, harmless bridge from the preset request pipeline to the request-status
// channel (src/ts/status/requestStatus). Every call is wrapped so status
// reporting can NEVER break a request (P0: status display must not throw into
// the request path). Gated by db.showRequestStatus so the whole feature is a
// no-op when off — and the classic path is never touched regardless.
//
// Token counts during streaming use a cheap char-based estimate (no per-chunk
// tokenizer cost — mobile-friendly), reconciled against the authoritative
// adapter usage at completion. See .agent/notes/request-status-toast-infra.md.

function statusEnabled(chatId?: string): boolean {
    try {
        const db = getDatabase()
        const character = chatId
            ? db.characters.find((item) => item.chats.some((chat) => chat.id === chatId))
            : undefined
        const chat = character?.chats.find((item) => item.id === chatId)
        return resolveRisuBardChatSettings(
            db,
            chat?.risuBardSettings,
            character?.risuBardPinnedSettings,
        ).showRequestStatus
    } catch {
        return false
    }
}

// Register a LOCAL tokenizer with the status store so the render tick counts
// streamed tokens language-aware (real subwords, good for CJK) instead of a
// char/N estimate. Uses encodeWithTokenizer with a fixed local tokenizer — NOT
// tokenizeNum/encode, which routes by db.aiModel and can fire the Google
// countTokens NETWORK API (sending chat text + key, consuming quota) every
// render tick for googleClaudeTokenizing users. Status is an approximate live
// display (the final count is reconciled from provider usage), so a fixed local
// tokenizer is the right tradeoff: never network, never quota, never leaks text.
setStatusTokenCounter(async (text) => {
    const encoded = await encodeWithTokenizer(text, 'tik')
    return encoded.length
})

function safeStatus(fn: () => void): void {
    try { fn() } catch (e) { console.error('[ModelPreset] status publish failed', e) }
}

// Map the request pipeline's mode to the status-channel chip kind. submodel and
// otherAx collapse to 'sub' (both are internal aux calls the user rarely
// distinguishes; see the toast infra note).
// The request log reuses RequestKind's vocabulary for its `source` tag, so the
// part of the app that issued a request reads the same in the log as it does
// in the request-status toast.
function toLogSource(mode: ModelModeExtended): RequestLogSource {
    return toRequestKind(mode)
}

function toLogUsage(usage: AdapterUsage | undefined): RequestLogUsage | undefined {
    if (!usage) return undefined
    return {
        inputTokens: usage.promptTokens,
        outputTokens: usage.completionTokens,
        cachedTokens: usage.cachedTokens,
        reasoningTokens: usage.reasoningTokens,
    }
}

function toRequestKind(mode: ModelModeExtended): RequestKind {
    switch (mode) {
        case 'translate': return 'translate'
        case 'memory': return 'memory'
        case 'emotion': return 'emotion'
        case 'submodel':
        case 'otherAx': return 'sub'
        default: return 'main'
    }
}

// Per-preset streaming resolution. Independent of the global db.useStreaming:
// the preset's own on/off decides (default off). Forced off when the profile
// does not declare the 'streaming' capability, or when the caller opted out
// (arg.useStreaming === false, e.g. aux/summarization requests).
function resolvePresetStreaming(preset: ModelPreset, arg: RequestDataArgumentExtended): boolean {
    if (arg.forceStreaming) return true
    const caps = preset.profileSnapshot.capabilities
    const supportsStreaming = !caps || caps.includes('streaming')
    if (!supportsStreaming) return false
    return !!preset.useStreaming && (arg.useStreaming ?? true)
}

// Tool-execution rounds allowed per request before we stop and surface a
// marker. Deliberately separate from the network retry budget (db.requestRetrys,
// applied by the outer requestChatData loop): conflating them would let a failed
// follow-up re-run already-executed (possibly write-side) tools.
const MODEL_PRESET_MAX_TOOL_STEPS = 8

// How often (ms) a streaming response flushes accumulated text to the chat
// renderer. Adapters yield one delta per token; each emitted chunk forces a full
// re-parse of the whole message (markdown + sanitize) downstream, so emitting
// every token makes the re-parse count scale with token count and stalls slow
// (mobile) devices. Coalescing to ~20fps keeps streaming visibly live while
// bounding re-parse cost. The final chunk is always flushed regardless.
const STREAM_FLUSH_INTERVAL_MS = 50

function toAdapterToolDef(tool: MCPTool): AdapterToolDef {
    return {
        name: tool.name,
        description: tool.description,
        // simplifySchema mutates; clone first. Stage 1 targets openai-compatible,
        // whose schema shape matches the default simplification.
        parameters: simplifySchema(safeStructuredClone(tool.inputSchema)),
    }
}

// Shared with jobRecovery.ts (recovered text must match a live run byte for
// byte) — see preset/adapter/reasoning.ts.
const formatPresetReasoning = formatReasoningParts

async function requestModelPreset(arg:RequestDataArgumentExtended, preset:ModelPreset, abortSignal:AbortSignal=null, mode:ModelModeExtended='model'):Promise<requestDataResponse> {
    const credential = buildModelPresetCredential(preset)
    const kind = preset.profileSnapshot.adapterKind
    const provenance = createModelPresetRequestProvenance(preset)
    // arg.chatId is the per-request generationId for main chat (sendChat passes
    // it under that name; see generation-state-keying.md §1-bis). Aux requests
    // (translate/memory/emotion/sub) don't supply one, so mint a per-request key
    // here purely for the status channel — it's memory-only and never persisted.
    // Uses uuid v4 (crypto.getRandomValues, available over plain HTTP) NOT
    // crypto.randomUUID (secure-context only — would throw on remote HTTP and
    // break the aux request before the try). Reporting is gated by db.showRequestStatus.
    const genId = arg.chatId ?? `aux-${uuidv4()}`
    const statusKind = toRequestKind(mode)
    const reportStatus = statusEnabled(arg.realChatId) && !!genId
    const logSource = arg.logSource ?? (arg.previewBody ? 'preview' : toLogSource(mode))
    const logPurpose = arg.logPurpose ?? defaultRequestPurpose(logSource)

    // Request logging wraps the transport, so the direct path and the
    // server-side job path are recorded identically — the job path had no
    // logging at all before, which is why a backend-call generation showed
    // "log deleted" in its per-message viewer. chatId carries genId because
    // that is the key the per-message viewer looks up (alertRequestData sends
    // genInfo.generationId).
    const logScope = createRequestLogScope({
        category: 'llm',
        source: logSource,
        purpose: logPurpose,
        chatId: genId,
        sessionChatId: arg.realChatId,
        generationId: genId,
        model: provenance.wireModelId,
        provider: preset.profileSnapshot.providerBaseId,
        streaming: resolvePresetStreaming(preset, arg),
    })
    const proxiedFetch = makeProxiedFetch(arg.chatId, (route) => logScope.setRoute(route))

    // Tool gating. Three guards:
    //  1) Per-preset opt-in (preset.toolUse, default OFF) — the hard regression
    //     guard: while off, this preset's requests stay text-only (streaming
    //     allowed) even for MCP users. One deliberate difference from "do
    //     nothing": the adapters strip any customBody-provided tools /
    //     tool_choice / toolConfig so OFF is a true text gate — a request that
    //     manually smuggled tool fields via customBody will lose them.
    //  2) Adapter-kind allowlist — only adapters whose tool wire is implemented.
    //  3) Capability gate: the profile must EXPLICITLY declare 'tools'. Stricter
    //     than the streaming convention (no `!caps` shortcut) so it matches the
    //     editor toggle's visibility — a capability-less custom profile (e.g.
    //     after a profile swap that kept toolUse) can never activate tools.
    const caps = preset.profileSnapshot.capabilities
    const supportsTools = preset.toolUse === true
        && TOOL_CAPABLE_ADAPTER_KINDS.includes(kind)
        && (caps?.includes('tools') ?? false)
    const tools = (supportsTools && arg.tools && arg.tools.length > 0)
        ? arg.tools.map(toAdapterToolDef)
        : undefined

    // Server-side job routing (Stage 3, model-preset-server-side-requests.md):
    // toggle ON + no tools (the tool loop stays browser-bound) + not a preview.
    // The whole send pipeline rides jobs — a send is a sequential chain of
    // aux/main requests (input translate → memory summarization → main →
    // translate/emotion), and any link dying kills the send, so all links get
    // the reconnectable job transport:
    //   - main (realChatId present + logSource='main'): keyed by chat.id, per-chat guard,
    //     journal recovered at boot as a chat message.
    //   - aux (including internal requests linked to a chat for logging):
    //     relay-only 'aux' job keyed
    //     by its unique genId (guard is a no-op); NEVER recovered — its
    //     journal is not a chat message. It rides only for the in-flight
    //     stream reattach, so a network blip mid-pipeline resumes in place.
    // makeJobFetch itself falls back to the proxied path when job creation
    // fails for infra reasons (network/404/5xx — e.g. older server); a 409
    // (chat already generating) surfaces as an error instead, since falling
    // back would double-generate. All defaults off → proxiedFetch →
    // byte-identical to the previous behavior.
    const useServerJob = getDatabase().nodeOnlyServerSideRequests === true
        && !tools && !arg.previewBody
    const transportFetch = useServerJob
        ? makeJobFetch({
            ...resolveModelJobRoute({
                realChatId: arg.realChatId,
                generationId: genId,
                logSource,
            }),
            generationId: genId,
            adapterKind: kind,
            model: provenance.wireModelId,
            streaming: resolvePresetStreaming(preset, arg),
            timeoutMs: (getDatabase().localNetworkTimeoutSec ?? 600) * 1000,
            fallbackFetch: proxiedFetch,
        })
        : proxiedFetch

    // Request logging wraps the transport, so the direct path and the
    // server-side job path are recorded identically — the job path had no
    // logging at all before, which is why a backend-call generation showed
    // "log deleted" in its per-message viewer. chatId carries genId because
    // that is the key the per-message viewer looks up (alertRequestData sends
    // genInfo.generationId). Cache housekeeping deliberately stays outside the
    // scope: it rides proxiedFetch directly, and admitting it would let a
    // cachedContents call land where the chat request's usage belongs.
    if (useServerJob) logScope.setRoute('job')
    const fetchImpl = logScope.wrap(transportFetch)

    // Vision gate: send attached images when the adapter implements image wire AND
    // either the profile declares the 'vision' capability OR the user opted in via
    // the preset's imageInput toggle (for profiles like ollama / openai-compatible
    // whose snapshot does not declare 'vision'). Additive — both branches default
    // off, so OFF is byte-identical to the prior text-only behavior.
    const supportsVision = VISION_CAPABLE_ADAPTER_KINDS.includes(kind)
        && ((caps?.includes('vision') ?? false) || preset.imageInput === true)

    // Gemini context caching: MAIN chat requests on the google-gemini adapter
    // (AI Studio key auth OR Vertex native service-account auth) — tool runs and
    // previews are excluded. Both auth kinds share the cachedContents wire; the
    // adapter derives the Studio-vs-Vertex URL/model shape from the prepared
    // chat URL, so the only difference here is admitting google-service-account.
    // The profile must EXPLICITLY declare the 'cache' capability (same gate the
    // editor toggle uses, ModelPresetSettings.svelte): a profile swap that kept
    // promptCaching.enabled but landed on a cache-less profile can never engage
    // caching — otherwise the cachedContents API would be hit every turn on a
    // model that does not support it.
    // Vertex-OpenAI stays out: it routes through openai-compatible, not this
    // adapter kind. The context carries everything the cache layer needs so the
    // adapter never reads the database (SSR rule). The state key is chat.id
    // (present for chats created in current versions; a chat without one is
    // simply not cached). All defaults off → cache undefined → requests
    // byte-identical to before.
    const cacheAuthKind = preset.profileSnapshot.auth.kind
    let cache: AdapterCacheContext | undefined
    if (kind === 'google-gemini' && preset.promptCaching?.enabled && mode === 'model'
        && !arg.disablePromptCache
        && (caps?.includes('cache') ?? false)
        && !tools && !arg.previewBody
        && (cacheAuthKind === 'x-goog-api-key' || cacheAuthKind === 'google-service-account')) {
        const cacheChatKey = arg.realChatId ?? getCurrentChat()?.id
        if (cacheChatKey) {
            cache = {
                promptCaching: preset.promptCaching,
                chatKey: cacheChatKey,
                task: mode,
                presetId: preset.id,
                generationId: genId,
                // Always the direct proxied fetch, never the server-side job
                // fetch: a job is keyed to the chat (one at a time) and its
                // journal is replayed as a CHAT response at boot, so cache
                // housekeeping calls must not become jobs. Built without the
                // route reporter so a cachedContents call cannot relabel the
                // chat request's log entries.
                fetchImpl: makeProxiedFetch(arg.chatId),
            }
        }
    }

    // System/role normalization. The classic path always runs reformater() before
    // dispatch (~431); the preset path skipped it, so models without a native system
    // role (e.g. Ollama Gemma3) never saw bot/persona info folded into user turns.
    // Synthesize the relevant LLMFlags from the preset's ability toggles and reuse
    // reformater (which also honors db.systemRoleReplacement/ContentReplacement, also
    // previously ignored here). All toggles default off → flags = [hasFullSystemPrompt]
    // → reformater is a no-op (byte-identical to the prior preset behavior).
    //
    // Folding is gated on the LIVE adapter kind, not just the toggle: only literal-role
    // adapters (openai-compatible) may fold. anthropic-messages / google-gemini extract
    // system natively (collectSystemAndChat), so folding system→user would strip their
    // system instruction — and gating on `kind` also defuses a stale foldSystemPrompt
    // left over from a profile swap (its UI toggle is hidden on the new kind). Sequence
    // shaping (alternate role / user-first) is adapter-agnostic and applies to all kinds.
    const foldSystem = kind === 'openai-compatible' && preset.foldSystemPrompt === true
    const presetFlags: LLMFlags[] = []
    if (!foldSystem) presetFlags.push(LLMFlags.hasFullSystemPrompt)
    else if (preset.keepFirstSystemPrompt) presetFlags.push(LLMFlags.hasFirstSystemPrompt)
    if (preset.alternateRole) presetFlags.push(LLMFlags.requiresAlternateRole)
    if (preset.startWithUserInput) presetFlags.push(LLMFlags.mustStartWithUserInput)
    // reformater mutates its input in place (requiresAlternateRole appends merged
    // content onto the first message of a run). The preset path returns before the
    // classic clone at ~405, and the retry loop (while(true)) only re-clones per
    // fallback model, so mutating arg.formated directly would re-merge on every retry
    // (A,B → A\nB → A\nB\nB). Clone first, matching the classic path's safeStructuredClone.
    // Also guarded: reformater runs outside the request try below, so a throw returns
    // a graceful fail instead of propagating (mirrors the previewBody/request catches).
    try {
        arg.formated = reformater(safeStructuredClone(arg.formated), presetFlags)
    } catch (err) {
        return { type: 'fail', result: err instanceof Error ? err.message : String(err), model: provenance.wireModelId }
    }

    let requestStatusManifest: RequestInjectionManifest | undefined
    if (reportStatus || requestLogEnabled()) {
        try {
            const messageTokens = await Promise.all(arg.formated.map(async (message) =>
                (await encodeWithTokenizer(`${message.role}\n${message.content}`, 'tik')).length + 3
            ))
            requestStatusManifest = await buildInjectionManifest(
                arg.formated,
                messageTokens,
                async (source) =>
                    (await encodeWithTokenizer(`${source.role}\n${source.content}`, 'tik')).length + 3,
            )
        } catch (error) {
            console.warn('[ModelPreset] request context manifest failed', error)
        }
    }
    logScope.setInjectionManifest(requestStatusManifest)
    for (const message of arg.formated) delete message.requestStatusSources

    // Expand `<tool_call>` history into structured tool turns ONLY on the active
    // tool path. With tools off, fall back to the plain mapping so existing chats
    // behave exactly as before (literal passthrough; no tool-role messages that a
    // text-only adapter would reject). Guards regression P1#2. Image attachments
    // ride along in both branches, gated by supportsVision.
    const messages = tools
        ? await expandAdapterMessages(arg.formated, decodeToolCall, supportsVision)
        : arg.formated.map((m) => toAdapterMessage(m, supportsVision))

    // previewBody never calls the chat endpoint and never runs tools — it just
    // builds and returns the prepared request. (One caveat: a google-service-
    // account profile may still perform an OAuth token exchange during credential
    // resolution if its token cache is empty/expired — that exchange is not the
    // chat request. API-key profiles make no network call here.) Mirrors the
    // classic adapters' previewBody handling.
    if (arg.previewBody) {
        try {
            // Mirror the real request's options so the preview shows the body that
            // would actually be sent (cache breakpoints included).
            const prepared = await previewModelPreset(kind, preset, {
                messages, tools, fetchImpl,
                anthropicCache1h: getDatabase().claude1HourCaching === true,
            }, credential)
            return {
                type: 'success',
                result: JSON.stringify({ url: prepared.url, body: prepared.body, headers: prepared.headers }),
                model: provenance.wireModelId,
            }
        } catch (err) {
            return { type: 'fail', result: err instanceof Error ? err.message : String(err), model: provenance.wireModelId }
        } finally {
            void logScope.close()
        }
    }

    let streamedOutputStarted = false
    try {
        // Tool runs always go non-streaming for now: the execute→re-request loop
        // needs the full structured response (tool_calls) each turn, and
        // streaming tool_call assembly is a later stage. Status is NOT reported
        // for the tool path in v1 (it bypasses the pump); see the toast infra note.
        if (tools) {
            const { result, toolsExecuted } = await runModelPresetToolLoop(arg, preset, kind, credential, fetchImpl, messages, tools, abortSignal)
            // The tool loop issues one request per turn; each is its own log
            // entry and all of them flush together here.
            void logScope.close()
            return { type: 'success', result, model: provenance.wireModelId, toolExecuted: toolsExecuted }
        }

        const useStreaming = resolvePresetStreaming(preset, arg)
        const options: AdapterChatOptions = {
            messages, abortSignal: abortSignal ?? undefined, fetchImpl, generationId: genId, cache,
            ...presetGenerationOverrides(arg),
            responseSchema: arg.schema
                ? convertInterfaceToSchema(arg.schema)
                : undefined,
            // Opt-in (System > Request Logs): without it a streamed response
            // reports no tokens at all, so chat usage statistics stay empty.
            collectStreamUsage: getDatabase().requestLogStreamUsage === true,
            // Prompt-cache breakpoints ride on message.cachePoint; this only picks
            // the TTL, matching the classic Anthropic path.
            anthropicCache1h: getDatabase().claude1HourCaching === true,
        }
        if (reportStatus) {
            safeStatus(() => startStatus(genId, {
                kind: statusKind,
                purpose: logPurpose,
                label: provenance.displayModel,
                chatId: arg.realChatId,
                phase: 'connecting',
                now: Date.now(),
                injectionManifest: requestStatusManifest,
            }))
        }
        if(useStreaming){
            const streamAbort = new AbortController()
            const abortStream = () => streamAbort.abort(abortSignal?.reason)
            if (abortSignal?.aborted) abortStream()
            else abortSignal?.addEventListener('abort', abortStream, { once: true })
            let streamUsage: AdapterUsage | undefined
            let streamFinishReason: string | undefined
            const gen = streamModelPreset(kind, preset, { ...options, abortSignal: streamAbort.signal }, credential)
            const stream = new ReadableStream<StreamResponseChunk>({
                start(controller){
                    return pumpPresetStream(gen, controller, {
                        intervalMs: STREAM_FLUSH_INTERVAL_MS,
                        abortSignal: streamAbort.signal,
                        formatReasoning: (text) => formatPresetReasoning([{ text }]),
                        onError: (err) => console.error('[ModelPreset] stream error', describeModelPresetError(err)),
                        // appendText owns the phase transition (thinking/responding)
                        // from which kind of text arrives, and recovers from 'stalled'
                        // when chunks resume — no local phase tracking needed here.
                        onDelta: (delta) => {
                            streamedOutputStarted ||= Boolean(delta.textDelta || delta.reasoningDelta)
                            if (reportStatus) safeStatus(() => {
                                const now = Date.now()
                                if (delta.reasoningDelta) appendText(genId, { thinking: delta.reasoningDelta }, now)
                                if (delta.textDelta) appendText(genId, { response: delta.textDelta }, now)
                            })
                        },
                        // Always registered: the request log needs the stream's
                        // end to attach the adapter's authoritative usage and
                        // flush, independent of whether the status toast is on.
                        onFinish: (outcome, lastUsage, finishReason) => {
                            streamUsage = lastUsage
                            streamFinishReason = finishReason
                            abortSignal?.removeEventListener('abort', abortStream)
                            if (reportStatus) safeStatus(() => {
                                // A stream that ends via abort throws inside the
                                // generator → 'failed'; reclassify as 'aborted' so the
                                // toast shows "Cancelled" rather than an error.
                                const finalOutcome = outcome === 'failed' && streamAbort.signal.aborted ? 'aborted' : outcome
                                // Confirmed cache hit (usageMetadata.cachedContentTokenCount
                                // > 0) → savings badge on the status toast. Gated on the
                                // cache context so behavior is unchanged with caching off.
                                const cachedTokens = lastUsage?.cachedTokens ?? 0
                                if (cache && cachedTokens > 0) {
                                    addBadge(genId, { key: 'cache', text: language.requestStatus.cacheHit.replace('{n}', cachedTokens.toLocaleString()), tone: 'success' })
                                }
                                endStatus(genId, finalOutcome, {
                                    now: Date.now(),
                                    usage: lastUsage && (lastUsage.promptTokens !== undefined || lastUsage.completionTokens !== undefined)
                                        ? {
                                            inputTokens: lastUsage.promptTokens,
                                            responseTokens: lastUsage.completionTokens,
                                        }
                                        : undefined,
                                })
                            })
                            logScope.setUsage(toLogUsage(lastUsage))
                            void logScope.close()
                        },
                    })
                },
                cancel(reason) { streamAbort.abort(reason) },
            })
            // Decoupled streaming: the wire request still streams (keeping the
            // provider's lenient streaming limits), but we drain the stream here
            // and return a single text result. The final chunk already holds the
            // full reasoning-prefixed text, so this matches the non-streaming
            // sendModelPreset return byte-for-byte — the chat renderer paints it
            // once instead of token-by-token.
            if(preset.decoupledStreaming){
                const text = await collectStreamingText(stream)
                return { type: 'success', result: text, model: provenance.wireModelId,
                    noRetry: true, finishReason: streamFinishReason, usage: streamUsage }
            }
            // endStatus fires from the pump's onFinish once the consumer drains
            // the stream — NOT here, because the stream outlives this return.
            return { type: 'streaming', result: stream, model: provenance.wireModelId }
        }
        const response = await sendWithStructuredOutputFallback(
            options,
            (fallbackOptions) => sendModelPreset(
                kind,
                preset,
                fallbackOptions,
                credential
            ),
            (error) => console.warn(
                '[ModelPreset] native structured output rejected; retrying with prompt schema',
                describeModelPresetError(error)
            )
        )
        logScope.setUsage(toLogUsage(response.usage))
        void logScope.close()
        const prepared = preparePresetResponse(response, {
            internal: Boolean(arg.schema) || arg.logSource === 'memory',
            model: provenance.wireModelId,
            formatReasoning: formatPresetReasoning,
        })
        if (reportStatus) {
            safeStatus(() => {
                // Cache-hit badge: same rule as the streaming onFinish above.
                const cachedTokens = response.usage?.cachedTokens ?? 0
                if (cache && cachedTokens > 0) {
                    addBadge(genId, { key: 'cache', text: language.requestStatus.cacheHit.replace('{n}', cachedTokens.toLocaleString()), tone: 'success' })
                }
                endStatus(genId, prepared.type === 'fail' ? 'failed' : 'done', {
                    now: Date.now(),
                    usage: response.usage && (response.usage.promptTokens !== undefined || response.usage.completionTokens !== undefined)
                        ? {
                            inputTokens: response.usage.promptTokens,
                            responseTokens: response.usage.completionTokens,
                        }
                        : undefined,
                })
            })
        }
        return prepared
    } catch (err) {
        console.error('[ModelPreset] request failed', describeModelPresetError(err))
        // A throw before the stream started (or instead of it) means onFinish
        // never fires, so the failed entry is flushed here.
        void logScope.close()
        if (reportStatus) {
            // Distinguish a user cancel from a real failure for the status toast.
            const outcome = abortSignal?.aborted ? 'aborted' : 'failed'
            safeStatus(() => endStatus(genId, outcome, { now: Date.now(), error: outcome === 'failed' ? (err instanceof Error ? err.message : String(err)) : undefined }))
        }
        return {
            type: 'fail',
            result: err instanceof Error ? err.message : String(err),
            model: provenance.wireModelId,
            ...presetFailureRetryPolicy(err, abortSignal?.aborted),
            ...(streamedOutputStarted ? { noRetry: true, fallbackEligible: false } : {}),
        }
    }
}

// One-shot test request for the preset editor's "Test" tab. Sends a single
// user-supplied message through requestModelPreset so the credential resolution,
// adapter dispatch and error handling are byte-identical to a real chat request —
// only the prompt is caller-supplied and streaming/tools are forced off so the
// result is a single text reply. Not part of the chat flow; nothing is persisted.
export interface ModelPresetTestResult {
    ok: boolean
    message: string   // reply text on success, error message on failure
    latencyMs: number
}

export async function testModelPreset(preset: ModelPreset, message: string, abortSignal: AbortSignal = null): Promise<ModelPresetTestResult> {
    const arg: RequestDataArgumentExtended = {
        formated: [{ role: 'user', content: message }],
        bias: {},
        useStreaming: false,
        // Trial sends from the preset editor are tagged apart so they don't
        // land in the chat usage statistics.
        logSource: 'test',
    }
    const start = performance.now()
    const res = await requestModelPreset(arg, preset, abortSignal)
    const latencyMs = Math.round(performance.now() - start)
    // useStreaming:false + no tools guarantees a success/fail (never streaming/multiline),
    // but fall through defensively rather than asserting the union.
    if (res.type === 'success') {
        return { ok: true, message: res.result, latencyMs }
    }
    if (res.type === 'fail') {
        return { ok: false, message: res.result, latencyMs }
    }
    return { ok: false, message: 'Unexpected response type', latencyMs }
}

// Binds the real send + tool execution to the generic runToolLoop (kept in the
// adapter layer so it is unit-testable without request.ts's import graph).
// Mirrors the classic recursive path (openAI/requests.ts): the visible result
// interleaves model text with `<tool_call>` markers (encoded when
// rememberToolUsage is on) so the turn round-trips on the next request.
async function runModelPresetToolLoop(
    arg: RequestDataArgumentExtended,
    preset: ModelPreset,
    kind: AdapterKind,
    credential: AdapterCredential | undefined,
    fetchImpl: typeof fetch,
    messages: AdapterChatMessage[],
    tools: AdapterToolDef[],
    abortSignal: AbortSignal | null,
): Promise<{ result: string; toolsExecuted: boolean }> {
    // Tracks whether any tool actually ran, so the caller can block outer
    // success-path retries that would otherwise re-execute side-effecting tools.
    let toolsExecuted = false
    const result = await runToolLoop(messages, {
        maxSteps: MODEL_PRESET_MAX_TOOL_STEPS,
        formatReasoning: formatPresetReasoning,
        abortSignal: abortSignal ?? undefined,
        send: (convo) => sendModelPreset(
            kind, preset,
            {
                messages: convo, tools, abortSignal: abortSignal ?? undefined, fetchImpl,
                // Tool turns are ordinary billed requests: without this the cache
                // TTL silently drops back to 5 minutes for the whole tool loop.
                anthropicCache1h: getDatabase().claude1HourCaching === true,
            },
            credential,
        ),
        executeTool: async (call) => {
            toolsExecuted = true
            const executed = await executeModelPresetTool(arg, call)
            // Persistence is best-effort: the tool already ran, so a failed
            // encode must not throw (the loop would otherwise drop later results,
            // and a propagated error could trigger an outer re-run). Skip the
            // round-trip marker on failure instead.
            let encoded: string | undefined
            if (arg.rememberToolUsage && executed.response.length > 0) {
                try {
                    encoded = await encodeToolCall({
                        call: { id: call.id, name: call.name, arg: call.arguments },
                        response: executed.response,
                    })
                } catch (e) {
                    console.error('[ModelPreset] tool-call persistence failed', e)
                }
            }
            return { text: executed.text, encoded }
        },
    })
    return { result, toolsExecuted }
}

async function executeModelPresetTool(
    arg: RequestDataArgumentExtended,
    call: AdapterToolCall,
): Promise<{ text: string, response: RPCToolCallContent[] }> {
    const tool = (arg.tools ?? []).find(t => t.name === call.name)
    if (!tool) {
        return { text: 'No tool found with name: ' + call.name, response: [] }
    }
    let parsedArgs: unknown
    try {
        parsedArgs = call.arguments ? JSON.parse(call.arguments) : {}
    } catch (e) {
        return { text: 'Tool call has invalid JSON arguments: ' + (e instanceof Error ? e.message : String(e)), response: [] }
    }
    try {
        const response = await callTool(call.name, parsedArgs)
        const text = toolResponseText(response)
        return { text: text.length > 0 ? text : 'Tool call returned no text response', response }
    } catch (e) {
        return { text: 'Tool call failed: ' + (e instanceof Error ? e.message : String(e)), response: [] }
    }
}


async function requestNovelAI(arg:RequestDataArgumentExtended):Promise<requestDataResponse>{
    const formated = arg.formated
    const db = getDatabase()
    const aiModel = arg.aiModel
    const temperature = arg.temperature
    const maxTokens = arg.maxTokens
    const biasString = arg.biasString
    const currentChar = getCurrentCharacter()
    const prompt = stringlizeNAIChat(formated, currentChar?.name ?? '', arg.continue)
    const abortSignal = arg.abortSignal
    let logit_bias_exp:{
        sequence: number[], bias: number, ensure_sequence_finish: false, generate_once: true
    }[] = []

    if(arg.previewBody){
        return {
            type: 'success',
            result: JSON.stringify({
                error: "This model is not supported in preview mode"
            })
        }
    }

    for(let i=0;i<biasString.length;i++){
        const bia = biasString[i]
        const tokens = await tokenizeNum(bia[0])

        const tokensInNumberArray:number[] = []

        for(const token of tokens){
            tokensInNumberArray.push(token)
        }
        logit_bias_exp.push({
            sequence: tokensInNumberArray,
            bias: bia[1],
            ensure_sequence_finish: false,
            generate_once: true
        })
    }

    let prefix = 'vanilla'

    if(db.NAIadventure){
        prefix = 'theme_textadventure'
    }

    const gen = db.NAIsettings
    const payload = {
        temperature:temperature,
        max_length: maxTokens,
        min_length: 1,
        top_k: gen.topK,
        top_p: gen.topP,
        top_a: gen.topA,
        tail_free_sampling: gen.tailFreeSampling,
        repetition_penalty: gen.repetitionPenalty,
        repetition_penalty_range: gen.repetitionPenaltyRange,
        repetition_penalty_slope: gen.repetitionPenaltySlope,
        repetition_penalty_frequency: gen.frequencyPenalty,
        repetition_penalty_presence: gen.presencePenalty,
        generate_until_sentence: true,
        use_cache: false,
        use_string: true,
        return_full_text: false,
        prefix: prefix,
        order: [6, 2, 3, 0, 4, 1, 5, 8],
        typical_p: gen.typicalp,
        repetition_penalty_whitelist:[49256,49264,49231,49230,49287,85,49255,49399,49262,336,333,432,363,468,492,745,401,426,623,794,1096,2919,2072,7379,1259,2110,620,526,487,16562,603,805,761,2681,942,8917,653,3513,506,5301,562,5010,614,10942,539,2976,462,5189,567,2032,123,124,125,126,127,128,129,130,131,132,588,803,1040,49209,4,5,6,7,8,9,10,11,12],
        stop_sequences: [[49287], [49405]],
        bad_words_ids: NovelAIBadWordIds,
        logit_bias_exp: logit_bias_exp,
        mirostat_lr: gen.mirostat_lr ?? 1,
        mirostat_tau: gen.mirostat_tau ?? 0,
        cfg_scale: gen.cfg_scale ?? 1,
        cfg_uc: ""   
    }

    

      
    const body = {
        "input": prompt,
        "model": aiModel === 'novelai_kayra' ? 'kayra-v1' : 'clio-v1',
        "parameters":payload
    }

    const da = await globalFetch(aiModel === 'novelai_kayra' ? "https://text.novelai.net/ai/generate" : "https://api.novelai.net/ai/generate", {
        logCategory: 'llm',
        logSource: 'main',
        logModel: aiModel,
        body: body,
        headers: {
            "Authorization": "Bearer " + (arg.key ?? db.novelai.token)
        },
        abortSignal,
        chatId: arg.chatId,
    })

    if((!da.ok )|| (!da.data.output)){
        return {
            type: 'fail',
            result: (language.errors.httpError + `${JSON.stringify(da.data)}`)
        }
    }
    return {
        type: "success",
        result: unstringlizeChat(da.data.output, formated, currentChar?.name ?? '')
    }
}

async function requestOobaLegacy(arg:RequestDataArgumentExtended):Promise<requestDataResponse> {
    const formated = arg.formated
    const db = getDatabase()
    const aiModel = arg.aiModel
    const maxTokens = arg.maxTokens
    const currentChar = getCurrentCharacter()
    const useStreaming = arg.useStreaming
    const abortSignal = arg.abortSignal
    let streamUrl = db.textgenWebUIStreamURL.replace(/\/api.*/, "/api/v1/stream")
    let blockingUrl = db.textgenWebUIBlockingURL.replace(/\/api.*/, "/api/v1/generate")
    let bodyTemplate:{[key:string]:any} = {}
    const prompt = applyChatTemplate(formated)
    let stopStrings = getStopStrings(false)
    if(db.localStopStrings){
        stopStrings = db.localStopStrings.map((v) => {
            return risuChatParser(v.replace(/\\n/g, "\n"))
        })
    }

    bodyTemplate = {
        'max_new_tokens': db.maxResponse,
        'do_sample': db.ooba.do_sample,
        'temperature': arg.temperature === undefined
            ? resolveStoredTemperature(db.temperature)
            : resolveApiSamplingParameter('temperature', arg.temperature),
        'top_p': db.ooba.top_p,
        'typical_p': db.ooba.typical_p,
        'repetition_penalty': db.ooba.repetition_penalty,
        'encoder_repetition_penalty': db.ooba.encoder_repetition_penalty,
        'top_k': db.ooba.top_k,
        'min_length': db.ooba.min_length,
        'no_repeat_ngram_size': db.ooba.no_repeat_ngram_size,
        'num_beams': db.ooba.num_beams,
        'penalty_alpha': db.ooba.penalty_alpha,
        'length_penalty': db.ooba.length_penalty,
        'early_stopping': false,
        'truncation_length': maxTokens,
        'ban_eos_token': db.ooba.ban_eos_token,
        'stopping_strings': stopStrings,
        'seed': -1,
        add_bos_token: db.ooba.add_bos_token,
        topP: resolveStoredSamplingParameter('top_p', db.top_p),
        prompt: prompt
    }

    const headers = (aiModel === 'textgen_webui') ? {} : {
        'X-API-KEY': db.mancerHeader
    }

    if(arg.previewBody){
        return {
            type: 'success',
            result: JSON.stringify({
                url: blockingUrl,
                body: bodyTemplate,
                headers: headers
            })      
        }
    }

    if(useStreaming){
        const oobaboogaSocket = new WebSocket(streamUrl);
        const statusCode = await new Promise((resolve) => {
            oobaboogaSocket.onopen = () => resolve(0)
            oobaboogaSocket.onerror = () => resolve(1001)
            oobaboogaSocket.onclose = ({ code }) => resolve(code)
        })
        if(abortSignal?.aborted || statusCode !== 0) {
            oobaboogaSocket.close()
            return ({
                type: "fail",
                result: abortSignal?.reason || `WebSocket connection failed to '${streamUrl}' failed!`,
            })
        }

        const close = () => {
            oobaboogaSocket.close()
        }
        const stream = new ReadableStream({
            start(controller){
                let readed = "";
                oobaboogaSocket.onmessage = (event) => {
                    const json = JSON.parse(event.data);
                    if (json.event === "stream_end") {
                        close()
                        controller.close()
                        return
                    }
                    if (json.event !== "text_stream") return
                    readed += json.text
                    controller.enqueue(readed)
                };
                oobaboogaSocket.send(JSON.stringify(bodyTemplate));
            },
            cancel(){
                close()
            }
        })
        oobaboogaSocket.onerror = close
        oobaboogaSocket.onclose = close
        abortSignal?.addEventListener("abort", close)

        return {
            type: 'streaming',
            result: stream
        }
    }

    const res = await globalFetch(blockingUrl, {
        logCategory: 'llm',
        logSource: 'main',
        body: bodyTemplate,
        headers: headers,
        abortSignal,
        chatId: arg.chatId
    })
    
    const dat = res.data as any
    if(res.ok){
        try {
            let result:string = dat.results[0].text ?? ''

            return {
                type: 'success',
                result: unstringlizeChat(result, formated, currentChar?.name ?? '')
            }
        } catch (error) {                    
            return {
                type: 'fail',
                result: (language.errors.httpError + `${error}`)
            }
        }
    }
    else{
        return {
            type: 'fail',
            result: (language.errors.httpError + `${JSON.stringify(res.data)}`)
        }
    }
}

async function requestOoba(arg:RequestDataArgumentExtended):Promise<requestDataResponse> {
    const formated = arg.formated
    const db = getDatabase()
    const aiModel = arg.aiModel
    const maxTokens = arg.maxTokens
    const temperature = arg.temperature
    const prompt = applyChatTemplate(formated)
    let stopStrings = getStopStrings(false)
    if(db.localStopStrings){
        stopStrings = db.localStopStrings.map((v) => {
            return risuChatParser(v.replace(/\\n/g, "\n"))
        })
    }
    const presencePenalty = arg.PresensePenalty === undefined
        ? resolveStoredSamplingParameter('presence_penalty', db.PresensePenalty)
        : resolveApiSamplingParameter('presence_penalty', arg.PresensePenalty)
    const frequencyPenalty = arg.frequencyPenalty === undefined
        ? resolveStoredSamplingParameter('frequency_penalty', db.frequencyPenalty)
        : resolveApiSamplingParameter('frequency_penalty', arg.frequencyPenalty)
    const topP = resolveStoredSamplingParameter('top_p', db.top_p)
    let bodyTemplate:Record<string, any> = {
        'prompt': prompt,
        logit_bias: {},
        max_tokens: maxTokens,
        stop: stopStrings,
        temperature: temperature,
        ...(presencePenalty === undefined ? {} : { presence_penalty: presencePenalty }),
        ...(frequencyPenalty === undefined ? {} : { frequency_penalty: frequencyPenalty }),
        ...(topP === undefined ? {} : { top_p: topP }),
    }

    const url = new URL(db.textgenWebUIBlockingURL)
    url.pathname = "/v1/completions"
    const urlStr = url.toString()

    const OobaBodyTemplate = db.reverseProxyOobaArgs
    const keys = Object.keys(OobaBodyTemplate)
    for(const key of keys){
        if(OobaBodyTemplate[key] !== undefined && OobaBodyTemplate[key] !== null && OobaParams.includes(key)){
            bodyTemplate[key] = OobaBodyTemplate[key]
        }
        else if(bodyTemplate[key]){
            delete bodyTemplate[key]
        }
    }

    if(arg.previewBody){
        return {
            type: 'success',
            result: JSON.stringify({
                url: urlStr,
                body: bodyTemplate,
                headers: {}
            })      
        }
    }

    const response = await globalFetch(urlStr, {
        logCategory: 'llm',
        logSource: 'main',
        body: bodyTemplate,
        chatId: arg.chatId,
        abortSignal: arg.abortSignal
    })

    if(!response.ok){
        return {
            type: 'fail',
            result: (language.errors.httpError + `${JSON.stringify(response.data)}`)
        }
    }
    const text:string = response.data.choices[0].text ?? ''
    return {
        type: 'success',
        result: text.replace(/##\n/g, '')
    }
    
}

async function requestPlugin(arg:RequestDataArgumentExtended):Promise<requestDataResponse> {
    const db = getDatabase()
    const startedAt = Date.now()
    const isV3Model = arg.aiModel.startsWith('pluginmodel:::')
    const responseModel = isV3Model ? arg.aiModel : 'custom'
    const model = isV3Model ? arg.aiModel.replace('pluginmodel:::', '') : db.currentPluginProvider
    const providerOptions = pluginV2.providerOptions.get(model)
    const reportStatus = statusEnabled(arg.realChatId)
        && await resolvePluginRequestStatus(providerOptions)
    const genId = arg.chatId ?? `aux-${uuidv4()}`
    let injectionManifest: RequestInjectionManifest | undefined

    if((reportStatus || requestLogEnabled()) && !arg.previewBody){
        try {
            const messageTokens = await Promise.all(arg.formated.map(async (message) =>
                (await encodeWithTokenizer(`${message.role}\n${message.content}`, 'tik')).length + 3
            ))
            injectionManifest = await buildInjectionManifest(
                arg.formated,
                messageTokens,
                async (source) =>
                    (await encodeWithTokenizer(`${source.role}\n${source.content}`, 'tik')).length + 3,
            )
        } catch (error) {
            console.warn('[PluginProvider] request context manifest failed', error)
        }
    }
    const evidenceRecorder = createPluginRequestEvidenceRecorder({
        startedAt,
        source: arg.logSource ?? (arg.previewBody ? 'preview' : toLogSource(arg.mode)),
        purpose: arg.logPurpose ?? defaultRequestPurpose(
            arg.logSource ?? (arg.previewBody ? 'preview' : toLogSource(arg.mode))
        ),
        sessionChatId: arg.realChatId,
        generationId: genId,
        model: responseModel,
        provider: model,
        injectionManifest,
    }, {
        countTokens: async (text) =>
            (await encodeWithTokenizer(text, 'tik')).length,
        record: recordRequestLog,
    })
    for (const message of arg.formated) delete message.requestStatusSources

    try {
        let formated = arg.formated
        const responseSchema = arg.schema
            ? convertInterfaceToSchema(arg.schema)
            : undefined
        const nativeStructuredOutput = resolvePluginStructuredOutput(providerOptions)
            ? createPluginStructuredOutput(responseSchema, db.strictJsonSchema, {
                provider: model,
                purpose: arg.logPurpose,
            })
            : undefined
        if(arg.schema){
            const schemaMessage = createStructuredOutputFallbackMessage(
                responseSchema
            )
            if(!schemaMessage){
                await evidenceRecorder.finish({
                    success: false,
                    streaming: false,
                    errorMessage: 'Structured output schema is too large for this plugin provider.',
                })
                return {
                    type: 'fail',
                    result: 'Structured output schema is too large for this plugin provider.',
                    model: responseModel,
                }
            }
            const schemaContent = typeof schemaMessage.content === 'string'
                ? schemaMessage.content
                : JSON.stringify(schemaMessage.content)
            formated = formated[0]?.role === 'system'
                ? [{
                    ...formated[0],
                    content: `${schemaContent}\n\n${formated[0].content}`,
                }, ...formated.slice(1)]
                : [{ role: 'system', content: schemaContent }, ...formated]
        }
        const maxTokens = arg.maxTokens
        const bias = arg.biasString
        const v2Function = pluginV2.providers.get(model)

        if(arg.previewBody){
            return {
                type: 'success',
                result: JSON.stringify({
                    error: "Plugin is not supported in preview mode"
                })
            }
        }

        if(reportStatus){
            safeStatus(() => startStatus(genId, {
                kind: toRequestKind(arg.mode),
                purpose: arg.logPurpose ?? defaultRequestPurpose(
                    arg.logSource ?? toLogSource(arg.mode)
                ),
                label: responseModel,
                chatId: arg.realChatId,
                phase: 'connecting',
                now: Date.now(),
                injectionManifest,
            }))
        }
    
        const pluginArguments = applyParameters({
            prompt_chat: formated,
            mode: arg.mode,
            bias: [],
            max_tokens: maxTokens,
            structured_output: Boolean(responseSchema),
            response_schema: nativeStructuredOutput,
        }, [
            'frequency_penalty','min_p','presence_penalty','repetition_penalty','top_k','top_p','temperature'
        ], {}, arg.mode, {
            modelId: arg.aiModel,
            temperatureOverride: arg.temperature,
        }) as PluginV2ProviderArgument
        const legacyPluginTemperature = arg.temperature === undefined
            ? resolveStoredTemperature(db.temperature)
            : resolveApiSamplingParameter('temperature', arg.temperature)
        const legacyPluginPresencePenalty = resolveStoredSamplingParameter('presence_penalty', db.PresensePenalty)
        const legacyPluginFrequencyPenalty = resolveStoredSamplingParameter('frequency_penalty', db.frequencyPenalty)
        const providerTimeoutMs = Number.isFinite(db.localNetworkTimeoutSec)
            && db.localNetworkTimeoutSec > 0
            ? db.localNetworkTimeoutSec * 1000
            : 600_000
        const providerDeadlineAt = startedAt + providerTimeoutMs
        const runProvider = <T>(invoke: (signal: AbortSignal) => Promise<T>) =>
            runPluginProviderWithTimeout(
                invoke,
                Math.max(1, providerDeadlineAt - Date.now()),
                arg.abortSignal,
            )
        const invokeV2Provider = (args: PluginV2ProviderArgument) => {
            if (requestLogEnabled()) evidenceRecorder.setRequestBody(args)
            return runProvider(signal => v2Function(args, signal))
        }
        const legacyArguments = {
            bias: bias,
            prompt_chat: formated,
            max_tokens: maxTokens,
            ...(legacyPluginTemperature === undefined ? {} : { temperature: legacyPluginTemperature }),
            ...(legacyPluginPresencePenalty === undefined ? {} : { presence_penalty: legacyPluginPresencePenalty }),
            ...(legacyPluginFrequencyPenalty === undefined ? {} : { frequency_penalty: legacyPluginFrequencyPenalty }),
        }
        if (!v2Function && requestLogEnabled()) evidenceRecorder.setRequestBody(legacyArguments)
        let d = v2Function
            ? await invokeV2Provider(pluginArguments)
            : await runProvider(() => pluginProcess(legacyArguments))
        if(v2Function && nativeStructuredOutput){
            d = await runProvider(() => normalizePluginStructuredOutputFailure(d))
            if(isPluginStructuredOutputValidationFailure(d)){
                d = await invokeV2Provider({
                    ...pluginArguments,
                    prompt_chat: [
                        ...pluginArguments.prompt_chat,
                        { role: 'user', content: pluginStructuredOutputRepairMessage },
                    ],
                })
                d = await runProvider(() => normalizePluginStructuredOutputFailure(d))
            }
            if(shouldFallbackFromNativeStructuredOutput(d)){
                d = await invokeV2Provider({
                    ...pluginArguments,
                    response_schema: undefined,
                })
            }
        }
    
        if(!d){
            if(reportStatus) safeStatus(() => endStatus(genId, 'failed', {
                now: Date.now(), error: language.errors.unknownModel,
            }))
            await evidenceRecorder.finish({
                success: false,
                streaming: false,
                errorMessage: language.errors.unknownModel,
            })
            return {
                type: 'fail',
                result: (language.errors.unknownModel),
                model: responseModel
            }
        }
        else if(!d.success){
            const errorText = d.content instanceof ReadableStream
                ? await runProvider(() => (new Response(d.content)).text())
                : d.content
            if(reportStatus) safeStatus(() => endStatus(genId, 'failed', {
                now: Date.now(), error: String(errorText),
            }))
            await evidenceRecorder.finish({
                success: false,
                streaming: d.content instanceof ReadableStream,
                errorMessage: String(errorText),
            })
            return preparePluginResponse(d, errorText, responseModel)
        }
        else if(d.content instanceof ReadableStream){
            const reader = d.content.getReader()
            let fullText = ''
            let terminalStreamError: unknown
            const statusStream = new ReadableStream<StreamResponseChunk>({
                async pull(controller) {
                    try {
                        const { done, value } = await reader.read()
                        if(done){
                            if(terminalStreamError){
                                controller.error(terminalStreamError)
                                return
                            }
                            if(reportStatus) safeStatus(() => endStatus(genId, 'done', { now: Date.now() }))
                            await evidenceRecorder.finish({
                                success: true,
                                streaming: true,
                                output: fullText,
                            })
                            controller.close()
                            return
                        }
                        evidenceRecorder.markFirstToken()
                        fullText += value
                        if(reportStatus) safeStatus(() => appendText(genId, { response: value }, Date.now()))
                        controller.enqueue({ "0": fullText })
                    } catch (error) {
                        if(reportStatus) safeStatus(() => endStatus(genId, 'failed', {
                            now: Date.now(), error: error instanceof Error ? error.message : String(error),
                        }))
                        await evidenceRecorder.finish({
                            success: false,
                            streaming: true,
                            output: fullText,
                            errorMessage: error instanceof Error ? error.message : String(error),
                        })
                        controller.error(error)
                    }
                },
                async cancel(reason) {
                    if(reportStatus) safeStatus(() => endStatus(genId, 'aborted', { now: Date.now() }))
                    await evidenceRecorder.finish({
                        success: false,
                        aborted: true,
                        streaming: true,
                        output: fullText,
                    })
                    await reader.cancel(reason)
                }
            })

            if(arg.useStreaming === false){
                let text: string
                try {
                    text = await runProvider(() => collectStreamingText(statusStream))
                } catch (error) {
                    terminalStreamError = error
                    await reader.cancel(error).catch(() => {})
                    throw error
                }
                return preparePluginResponse(d, text, responseModel)
            }
    
            return {
                type: 'streaming',
                result: normalizePluginJsonStream(statusStream),
                model: responseModel
            }
        }
        else{
            const content = d.content ?? ''
            if(reportStatus) safeStatus(() => {
                if(content) appendText(genId, { response: content }, Date.now())
                endStatus(genId, 'done', { now: Date.now() })
            })
            await evidenceRecorder.finish({
                success: true,
                streaming: false,
                output: content,
            })
            return preparePluginResponse(d, content, responseModel)
        }
    } catch (error) {
        console.error(error)
        const failureMessage = formatPluginProviderFailure(model, error)
        if(reportStatus) safeStatus(() => endStatus(genId, 'failed', {
            now: Date.now(), error: error instanceof Error ? error.message : String(error),
        }))
        await evidenceRecorder.finish({
            success: false,
            streaming: false,
            errorMessage: error instanceof Error ? error.message : String(error),
        })
        return {
            type: 'fail',
            result: failureMessage,
            model: responseModel
        }
    }
}

async function requestEcho(arg:RequestDataArgumentExtended):Promise<requestDataResponse> {
    const db = getDatabase()
    const delay = db.echoDelay ?? 0
    const message = db.echoMessage ?? "Echo Message"

    if(delay > 0){
        await sleep(delay * 1000)
    }

    return {
        type: 'success',
        result: message
    }
}

async function requestKobold(arg:RequestDataArgumentExtended):Promise<requestDataResponse> {
    const formated = arg.formated
    const db = getDatabase()
    const maxTokens = arg.maxTokens
    const abortSignal = arg.abortSignal

    const prompt = applyChatTemplate(formated)
    const url = new URL(db.koboldURL)
    if(url.pathname.length < 3){
        url.pathname = 'api/v1/generate'
    }

    const body = applyParameters({
        "prompt": prompt,
        max_length: maxTokens,
        max_context_length: db.maxContext,
        n: 1
    }, [
        'temperature',
        'top_p',
        'repetition_penalty',
        'top_k',
        'top_a'
    ], {
        'repetition_penalty': 'rep_pen'
    }, arg.mode, {
        modelId: arg.aiModel
    }) as KoboldGenerationInputSchema

    if(arg.previewBody){
        return {
            type: 'success',
            result: JSON.stringify({
                url: url.toString(),
                body: body,
                headers: {}
            })      
        }
    }
    
    const da = await globalFetch(url.toString(), {
        logCategory: 'llm',
        logSource: 'main',
        method: "POST",
        body: body,
        headers: {
            "content-type": "application/json",
        },
        abortSignal,
        chatId: arg.chatId
    })

    if(!da.ok){
        return {
            type: "fail",
            result: (typeof da.data === 'string') ? da.data : JSON.stringify(da.data),
            noRetry: true
        }
    }

    const data = da.data
    return {
        type: 'success',
        result: data.results[0].text
    }
}

async function requestNovelList(arg:RequestDataArgumentExtended):Promise<requestDataResponse> {

    const formated = arg.formated
    const db = getDatabase()
    const maxTokens = arg.maxTokens
    const temperature = arg.temperature
    const biasString = arg.biasString
    const currentChar = getCurrentCharacter()
    const aiModel = arg.aiModel
    const auth_key = db.novellistAPI;
    const api_server_url = 'https://api.tringpt.com/';
    const logit_bias:string[] = []
    const logit_bias_values:string[] = []
    for(let i=0;i<biasString.length;i++){
        const bia = biasString[i]
        logit_bias.push(bia[0])
        logit_bias_values.push(bia[1].toString())
    }
    const headers = {
        'Authorization': `Bearer ${auth_key}`,
        'Content-Type': 'application/json'
    };
    
    const send_body = {
        text: stringlizeAINChat(formated, currentChar?.name ?? '', arg.continue),
        length: maxTokens,
        temperature: temperature,
        top_p: db.ainconfig.top_p,
        top_k: db.ainconfig.top_k,
        rep_pen: db.ainconfig.rep_pen,
        top_a: db.ainconfig.top_a,
        rep_pen_slope: db.ainconfig.rep_pen_slope,
        rep_pen_range: db.ainconfig.rep_pen_range,
        typical_p: db.ainconfig.typical_p,
        badwords: db.ainconfig.badwords,
        model: aiModel === 'novellist_damsel' ? 'damsel' : 'supertrin',
        stoptokens: ["「"].join("<<|>>") + db.ainconfig.stoptokens,
        logit_bias: (logit_bias.length > 0) ? logit_bias.join("<<|>>") : undefined,
        logit_bias_values: (logit_bias_values.length > 0) ? logit_bias_values.join("|") : undefined,
    };


    if(arg.previewBody){
        return {
            type: 'success',
            result: JSON.stringify({
                url: api_server_url + '/api',
                body: send_body,
                headers: headers
            })      
        }
    }
    const response = await globalFetch(arg.customURL ?? api_server_url + '/api', {
        logCategory: 'llm',
        logSource: 'main',
        method: 'POST',
        headers: headers,
        body: send_body,
        chatId: arg.chatId,
        abortSignal: arg.abortSignal
    });

    if(!response.ok){
        return {
            type: 'fail',
            result: response.data
        }
    }

    if(response.data.error){
        return {
            'type': 'fail',
            'result': `${response.data.error.replace("token", "api key")}`
        }
    }

    const result = response.data.data[0];
    const unstr = unstringlizeAIN(result, formated, currentChar?.name ?? '')
    return {
        'type': 'multiline',
        'result': unstr
    }
}

async function requestOllama(arg:RequestDataArgumentExtended):Promise<requestDataResponse> {
    const formated = arg.formated
    const db = getDatabase()

    if(arg.previewBody){
        return {
            type: 'success',
            result: JSON.stringify({
                error: "Preview body is not supported for Ollama"
            })
        }
    }

    const ollama = new Ollama({
        host: db.ollamaURL,
        fetch: createOllamaFetch(fetch, arg.abortSignal),
    })

    const messages = []
    for (const v of formated) {
        if (v.role === 'assistant' || v.role === 'user' || v.role === 'system') {
            messages.push({
                role: v.role,
                content: v.content
            })
        }
    }

    arg.abortSignal?.throwIfAborted()
    const request = buildOllamaChatRequest({
        model: db.ollamaModel,
        messages,
        useStreaming: arg.useStreaming !== false,
        schema: arg.schema,
        temperature: arg.temperature,
        maxTokens: arg.maxTokens,
    })

    if (arg.useStreaming === false) {
        const response = await ollama.chat({ ...request, stream: false })
        return {
            type: 'success',
            result: response.message.content,
            finishReason: response.done_reason,
        }
    }

    const response = await ollama.chat({ ...request, stream: true })
    arg.abortSignal?.throwIfAborted()

    const readableStream = new ReadableStream<StreamResponseChunk>({
        async start(controller){
            const abort = () => ollama.abort()
            arg.abortSignal?.addEventListener('abort', abort, { once: true })
            try {
                for await(const chunk of response){
                    controller.enqueue({
                        "0": chunk.message.content
                    })
                }
                controller.close()
            }
            catch (error) {
                controller.error(error)
            }
            finally {
                arg.abortSignal?.removeEventListener('abort', abort)
            }
        }
    })

    return {
        type: 'streaming',
        result: readableStream
    }
}

async function requestCohere(arg:RequestDataArgumentExtended):Promise<requestDataResponse> {
    const formated = arg.formated
    const db = getDatabase()
    const aiModel = arg.aiModel

    let lastChatPrompt = ''
    let preamble = ''

    let lastChat = formated[formated.length-1]
    if(lastChat.role === 'user'){
        lastChatPrompt = lastChat.content
        formated.pop()
    }
    else{
        while(lastChat.role !== 'user'){
            lastChat = formated.pop()
            if(!lastChat){
                return {
                    type: 'fail',
                    result: 'Cohere requires a user message to generate a response'
                }
            }
            lastChatPrompt = (lastChat.role === 'user' ? '' : `${lastChat.role}: `) + '\n' + lastChat.content + lastChatPrompt
        }
    }

    const firstChat = formated[0]
    if(firstChat.role === 'system'){
        preamble = firstChat.content
        formated.shift()
    }

    //reformat chat

    let body = applyParameters({
        message: lastChatPrompt,
        chat_history: formated.map((v) => {
            if(v.role === 'assistant'){
                return {
                    role: 'CHATBOT',
                    message: v.content
                }
            }
            if(v.role === 'system'){
                return {
                    role: 'SYSTEM',
                    message: v.content
                }
            }
            if(v.role === 'user'){
                return {
                    role: 'USER',
                    message: v.content
                }
            }
            return null
        }).filter((v) => v !== null).filter((v) => {
            return v.message
        }),
    }, [
        'temperature', 'top_k', 'top_p', 'presence_penalty', 'frequency_penalty'
    ], {
        'top_k': 'k',
        'top_p': 'p',
    }, arg.mode, {
        modelId: arg.aiModel
    })

    if(aiModel !== 'cohere-command-r-03-2024' && aiModel !== 'cohere-command-r-plus-04-2024'){
        body.safety_mode = "NONE"
    }
    
    if(preamble){
        if(body.chat_history.length > 0){
            body.preamble = preamble
        }
        else{
            body.message = `system: ${preamble}`
        }
    }

    console.log(body)

    if(arg.previewBody){
        return {
            type: 'success',
            result: JSON.stringify({
                url: arg.customURL ?? 'https://api.cohere.com/v1/chat',
                body: body,
                headers: {
                    "Authorization": "Bearer " + (arg.key ?? db.cohereAPIKey),
                    "Content-Type": "application/json"
                }
            })
        }
    }

    const res = await globalFetch(arg.customURL ?? 'https://api.cohere.com/v1/chat', {
        logCategory: 'llm',
        logSource: 'main',
        method: "POST",
        headers: {
            "Authorization": "Bearer " + (arg.key ?? db.cohereAPIKey),
            "Content-Type": "application/json"
        },
        body: body,
        abortSignal: arg.abortSignal
    })

    if(!res.ok){
        return {
            type: 'fail',
            result: JSON.stringify(res.data)
        }
    }

    const result = res?.data?.text
    if(!result){
        return {
            type: 'fail',
            result: JSON.stringify(res.data)
        }
    }

    return {
        type: 'success',
        result: result
    }
 
}


async function requestHorde(arg:RequestDataArgumentExtended):Promise<requestDataResponse> {
    const formated = arg.formated
    const db = getDatabase()
    const aiModel = arg.aiModel
    const currentChar = getCurrentCharacter()
    const abortSignal = arg.abortSignal

    if(arg.previewBody){
        return {
            type: 'success',
            result: JSON.stringify({
                error: "Preview body is not supported for Horde"
            })
        }
    }

    const prompt = applyChatTemplate(formated)

    const realModel = aiModel.split(":::")[1]
    const hordeTemperature = arg.temperature === undefined
        ? resolveStoredTemperature(db.temperature)
        : resolveApiSamplingParameter('temperature', arg.temperature)
    const hordeTopK = resolveStoredSamplingParameter('top_k', db.top_k)
    const hordeTopP = resolveStoredSamplingParameter('top_p', db.top_p)

    const argument = {
        "prompt": prompt,
        "params": {
            "n": 1,
            "max_context_length": db.maxContext + 100,
            "max_length": db.maxResponse,
            "singleline": false,
            ...(hordeTemperature === undefined ? {} : { "temperature": hordeTemperature }),
            ...(hordeTopK === undefined ? {} : { "top_k": hordeTopK }),
            ...(hordeTopP === undefined ? {} : { "top_p": hordeTopP }),
        },
        "trusted_workers": false,
        "workerslow_workers": true,
        "_blacklist": false,
        "dry_run": false,
        "models": [realModel, realModel.trim(), ' ' + realModel, realModel + ' ']
    }

    if(realModel === 'auto'){
        delete argument.models
    }

    let apiKey = '0000000000'
    if(db.hordeConfig.apiKey.length > 2){
        apiKey = db.hordeConfig.apiKey
    }

    const da = await fetch("https://stablehorde.net/api/v2/generate/text/async", {
        body: JSON.stringify(argument),
        method: "POST",
        headers: {
            "content-type": "application/json",
            "apikey": apiKey
        },
        signal: abortSignal
    })

    if(da.status !== 202){
        return {
            type: "fail",
            result: await da.text()
        }
    }

    const json:{
        id:string,
        kudos:number,
        message:string
    } = await da.json()

    let warnMessage = ""
    if(json.message){
        warnMessage = "with " + json.message
    }

    while(true){
        await sleep(2000)
        const data = await (await fetch("https://stablehorde.net/api/v2/generate/text/status/" + json.id)).json()
        if(!data.is_possible){
            fetch("https://stablehorde.net/api/v2/generate/text/status/" + json.id, {
                method: "DELETE"
            })
            return {
                type: 'fail',
                result: "Response not possible" + warnMessage,
                noRetry: true
            }
        }
        if(data.done && Array.isArray(data.generations) && data.generations.length > 0){
            const generations:{text:string}[] = data.generations
            if(generations && generations.length > 0){
                return {
                    type: "success",
                    result: unstringlizeChat(generations[0].text ?? '', formated, currentChar?.name ?? '')
                }
            }
            return {
                type: 'fail',
                result: "No Generations when done",
                noRetry: true
            }
        }
    }
}

async function requestWebLLM(arg:RequestDataArgumentExtended):Promise<requestDataResponse> {
    const formated = arg.formated
    const db = getDatabase()
    const aiModel = arg.aiModel
    const currentChar = getCurrentCharacter()
    const maxTokens = arg.maxTokens
    const temperature = arg.temperature
    const realModel = aiModel.split(":::")[1]
    const prompt = applyChatTemplate(formated)

    if(arg.previewBody){
        return {
            type: 'success',
            result: JSON.stringify({
                error: "Preview body is not supported for WebLLM"
            })
        }
    }
    const v = await runTransformers(prompt, realModel, {
        temperature: temperature,
        max_new_tokens: maxTokens,
        top_k: db.ooba.top_k,
        top_p: db.ooba.top_p,
        repetition_penalty: db.ooba.repetition_penalty,
        typical_p: db.ooba.typical_p,
    } as any)
    return {
        type: 'success',
        result: unstringlizeChat((v.generated_text as string) ?? '', formated, currentChar?.name ?? '')
    }
}

export interface KoboldSamplerSettingsSchema {
    rep_pen?: number;
    rep_pen_range?: number;
    rep_pen_slope?: number;
    top_k?: number;
    top_a?: number;
    top_p?: number;
    tfs?: number;
    typical?: number;
    temperature?: number;
}

export interface KoboldGenerationInputSchema extends KoboldSamplerSettingsSchema {
    prompt: string;
    use_memory?: boolean;
    use_story?: boolean;
    use_authors_note?: boolean;
    use_world_info?: boolean;
    use_userscripts?: boolean;
    soft_prompt?: string;
    max_length?: number;
    max_context_length?: number;
    n: number;
    disable_output_formatting?: boolean;
    frmttriminc?: boolean;
    frmtrmblln?: boolean;
    frmtrmspch?: boolean;
    singleline?: boolean;
    disable_input_formatting?: boolean;
    frmtadsnsp?: boolean;
    quiet?: boolean;
    sampler_order?: number[];
    sampler_seed?: number;
    sampler_full_determinism?: boolean;
}
