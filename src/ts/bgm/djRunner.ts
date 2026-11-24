// The BGM auto DJ request. It starts when the user sends a message, runs beside the main
// reply, and switches the slot once that reply starts arriving.

import { v4 as uuidv4 } from 'uuid'
import { requestChatData } from '../process/request/request'
import { onGenerationOutputStart } from '../process/generationEvents'
import { resolveAssistantPrompt } from '../risubard/assistantPrompts'
import { endStatus, startStatus } from '../status/requestStatus'
import { getDatabase, type character, type Chat } from '../storage/database.svelte'
import { buildDjMessages, collectRecentResponses, judgeDjDecision, parseDjResponse, type DjDecision } from './autoDj'
import { bgmEngine } from './engine.svelte'

interface DjTurn {
    controller: AbortController
    responseStarted: boolean
    decision: DjDecision | null
}

let turn: DjTurn | null = null

function applyDecision(decision: DjDecision) {
    const verdict = judgeDjDecision({
        decision,
        currentSlotId: bgmEngine.view.slotId,
        settings: bgmEngine.settings.dj,
        manualHoldLeft: 0,
        lastSwitchAt: bgmEngine.lastSwitchAt,
        now: Date.now(),
    })
    if (verdict !== 'switch') return
    const slot = bgmEngine.currentSet().slots.find(item => item.id === decision.slotId)
    if (!slot) return
    bgmEngine.selectSlot(slot.id, 'dj')
    bgmEngine.view.djPick = slot.name
}

/** Listens for replies starting. Call while the player is mounted; returns the stop function. */
export function installBgmDj(): () => void {
    const stop = onGenerationOutputStart(() => {
        if (!turn || turn.responseStarted) return
        turn.responseStarted = true
        if (turn.decision) applyDecision(turn.decision)
    })
    return () => {
        stop()
        turn?.controller.abort()
        turn = null
    }
}

/** Called right after the user's message joins the chat, before the main request starts. */
export function startBgmDjTurn(input: { character: character; chat: Chat; userInput: string }) {
    const settings = bgmEngine.settings
    if (!settings.enabled || !settings.dj.enabled || !bgmEngine.isRunning()) return
    const slots = bgmEngine.currentSet().slots
    turn?.controller.abort()
    turn = null
    if (slots.length < 2 || !input.userInput.trim()) return
    if (bgmEngine.consumeManualHold()) {
        bgmEngine.view.dj = 'held'
        return
    }
    const current: DjTurn = { controller: new AbortController(), responseStarted: false, decision: null }
    turn = current
    void runRequest(current, input, slots)
}

async function runRequest(current: DjTurn, input: { character: character; chat: Chat; userInput: string }, slots: ReturnType<typeof bgmEngine.currentSet>['slots']) {
    const db = getDatabase()
    const dj = bgmEngine.settings.dj
    const formated = buildDjMessages({
        systemPrompt: resolveAssistantPrompt(db.risuBardAssistantPrompts, 'bgmDj'),
        slots,
        currentSlotId: bgmEngine.view.slotId,
        recentResponses: collectRecentResponses(input.chat.message, dj.recentCount, dj.maxChars),
        userInput: input.userInput,
    })
    const signal = current.controller.signal
    const statusId = `bgm-dj-${uuidv4()}`
    if (dj.showRequestStatus) {
        const separate = db.seperateModelsForAxModels ? db.seperateModels?.otherAx : ''
        startStatus(statusId, {
            kind: dj.model === 'model' ? 'main' : 'sub',
            purpose: 'bgm-dj',
            label: dj.model === 'model' ? db.aiModel : (separate || db.subModel),
            chatId: input.chat.id,
            phase: 'connecting',
            now: Date.now(),
        })
    }
    bgmEngine.view.dj = 'thinking'
    let outcome: 'done' | 'failed' | 'aborted' = 'failed'
    let failure: string | undefined
    try {
        const response = await requestChatData({
            formated,
            bias: {},
            currentChar: input.character,
            chatId: statusId,
            realChatId: input.chat.id,
            useStreaming: false,
            noMultiGen: true,
            tools: [],
            disablePromptCache: true,
            logSource: 'other',
            logPurpose: 'bgm-dj',
        }, dj.model, signal)
        if (signal.aborted) { outcome = 'aborted'; return }
        if (response.type !== 'success') {
            failure = response.type === 'fail' ? response.result : 'Unsupported response'
            return
        }
        const decision = parseDjResponse(response.result, slots)
        if (!decision) {
            failure = 'The DJ answer named no listed slot'
            return
        }
        outcome = 'done'
        current.decision = decision
        // The reply may already be streaming; otherwise the output-start listener applies it.
        if (current.responseStarted) applyDecision(decision)
    } catch (error) {
        if (signal.aborted) outcome = 'aborted'
        else failure = error instanceof Error ? error.message : String(error)
    } finally {
        if (turn === current || outcome !== 'aborted') {
            bgmEngine.view.dj = outcome === 'failed' ? 'failed' : 'idle'
        }
        if (failure) console.warn('[BGM DJ]', failure)
        if (dj.showRequestStatus) endStatus(statusId, outcome, { now: Date.now(), error: failure })
    }
}
