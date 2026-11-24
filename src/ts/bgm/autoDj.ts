// Pure parts of the BGM auto DJ: what it reads, how its answer is parsed, and when a
// decision may actually switch the music. The request itself lives in djRunner.ts.

import type { BgmDjSettings, BgmSlot } from './library'

export interface DjChatMessage {
    role: string
    data: string
    disabled?: unknown
    isComment?: boolean
}

export interface DjDecision {
    slotId: string
    confidence: number
}

function escapeClosers(value: string): string {
    return value.replace(/<\/(slots|current_slot|recent_responses|response|user_input)>/gi, '<\\/$1>')
}

function lastChars(text: string, max: number): string {
    const trimmed = text.trim()
    return trimmed.length > max ? `…${trimmed.slice(trimmed.length - max)}` : trimmed
}

/**
 * The latest AI replies before the message just sent, oldest first. Skips hidden and
 * comment messages, and everything before an "all before" cut.
 */
export function collectRecentResponses(messages: DjChatMessage[], count: number, maxChars: number): string[] {
    if (count <= 0) return []
    const cut = messages.findLastIndex((message) => message.disabled === 'allBefore')
    const visible = messages.slice(cut + 1).filter((message) => !message.disabled && !message.isComment)
    // The last message is the user input itself; replies come before it.
    const lastUser = visible.findLastIndex((message) => message.role === 'user')
    return visible
        .slice(0, lastUser < 0 ? visible.length : lastUser)
        .filter((message) => message.role === 'char' && message.data.trim())
        .slice(-count)
        .map((message) => lastChars(message.data, maxChars))
}

export function buildDjMessages(input: {
    systemPrompt: string
    slots: BgmSlot[]
    currentSlotId: string
    recentResponses: string[]
    userInput: string
}): Array<{ role: 'system' | 'user'; content: string }> {
    const slots = input.slots.map((slot) => {
        const fits = slot.description.trim() ? ` | fits: ${slot.description.trim().replace(/\s+/g, ' ')}` : ''
        return `- id: ${slot.id} | name: ${slot.name} | kind: ${slot.kind}${fits}`
    })
    const current = input.slots.find((slot) => slot.id === input.currentSlotId)
    const user = [
        `<slots>\n${escapeClosers(slots.join('\n'))}\n</slots>`,
        `<current_slot>${current ? escapeClosers(`${current.id} (${current.name})`) : 'none'}</current_slot>`,
        input.recentResponses.length
            ? `<recent_responses>\n${input.recentResponses.map((text) => `<response>\n${escapeClosers(text)}\n</response>`).join('\n')}\n</recent_responses>`
            : '',
        `<user_input>\n${escapeClosers(input.userInput.trim())}\n</user_input>`,
    ].filter(Boolean).join('\n\n')
    return [
        { role: 'system', content: input.systemPrompt.trim() },
        { role: 'user', content: user },
    ]
}

/**
 * Reads the DJ's JSON answer. Accepts code fences and extra words around the object, and a
 * slot name instead of its id. Returns null when no listed slot can be found.
 */
export function parseDjResponse(text: string, slots: Array<Pick<BgmSlot, 'id' | 'name'>>): DjDecision | null {
    const match = /\{[\s\S]*?\}/.exec(text)
    if (!match) return null
    let parsed: unknown
    try { parsed = JSON.parse(match[0]) } catch { return null }
    if (!parsed || typeof parsed !== 'object') return null
    const raw = parsed as { slot?: unknown; confidence?: unknown }
    const wanted = typeof raw.slot === 'string' ? raw.slot.trim() : ''
    if (!wanted) return null
    const slot = slots.find((item) => item.id === wanted)
        ?? slots.find((item) => item.name.trim().toLowerCase() === wanted.toLowerCase())
    if (!slot) return null
    const confidence = typeof raw.confidence === 'number' && Number.isFinite(raw.confidence)
        ? Math.min(1, Math.max(0, raw.confidence))
        : 1
    return { slotId: slot.id, confidence }
}

export type DjVerdict = 'switch' | 'same' | 'unsure' | 'held' | 'too-soon'

/** Whether a decision should change the music now. Order matters: the first reason wins. */
export function judgeDjDecision(input: {
    decision: DjDecision
    currentSlotId: string
    settings: Pick<BgmDjSettings, 'minConfidence' | 'minDwellSec'>
    manualHoldLeft: number
    lastSwitchAt: number
    now: number
}): DjVerdict {
    if (input.decision.slotId === input.currentSlotId) return 'same'
    if (input.manualHoldLeft > 0) return 'held'
    if (input.decision.confidence < input.settings.minConfidence) return 'unsure'
    if (input.now - input.lastSwitchAt < input.settings.minDwellSec * 1000) return 'too-soon'
    return 'switch'
}
