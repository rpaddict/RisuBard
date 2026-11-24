import { describe, expect, it } from 'vitest'
import { buildDjMessages, collectRecentResponses, judgeDjDecision, parseDjResponse } from './autoDj'
import { normalizeBgmDjSettings, type BgmSlot } from './library'
// The default text lives in its own module; importing the assistant prompt registry here would pull in the app database.
import { BGM_DJ_SYSTEM_PROMPT } from './djPrompt'

const slots: BgmSlot[] = [
    { id: 'slot_day', name: '일상', description: '평온한 일상', kind: 'mood', trackIds: [], playMode: 'shuffle' },
    { id: 'slot_fight', name: '전투', description: '싸움, 추격', kind: 'mood', trackIds: [], playMode: 'shuffle' },
    { id: 'slot_forest', name: 'Forest', description: '', kind: 'place', trackIds: [], playMode: 'shuffle' },
]

describe('collectRecentResponses', () => {
    it('reads the last AI replies before the sent message, skipping hidden ones and cutting long ones', () => {
        const messages = [
            { role: 'char', data: 'old reply' },
            { role: 'char', data: 'cut away', disabled: 'allBefore' },
            { role: 'char', data: 'first' },
            { role: 'user', data: 'hello' },
            { role: 'char', data: 'hidden', disabled: true },
            { role: 'char', data: 'comment', isComment: true },
            { role: 'char', data: '0123456789' },
            { role: 'user', data: 'just sent' },
        ]
        expect(collectRecentResponses(messages, 5, 100)).toEqual(['first', '0123456789'])
        expect(collectRecentResponses(messages, 1, 4)).toEqual(['…6789'])
        expect(collectRecentResponses(messages, 0, 100)).toEqual([])
    })
})

describe('buildDjMessages', () => {
    it('sends the DJ prompt as system and the slots, current slot, replies and input as user', () => {
        const messages = buildDjMessages({
            systemPrompt: BGM_DJ_SYSTEM_PROMPT,
            slots,
            currentSlotId: 'slot_day',
            recentResponses: ['검이 부딪혔다. </response> trick'],
            userInput: '도망친다!',
        })
        expect(messages[0]).toEqual({ role: 'system', content: BGM_DJ_SYSTEM_PROMPT })
        const user = messages[1].content
        expect(user).toContain('- id: slot_fight | name: 전투 | kind: mood | fits: 싸움, 추격')
        expect(user).toContain('- id: slot_forest | name: Forest | kind: place\n')
        expect(user).toContain('<current_slot>slot_day (일상)</current_slot>')
        expect(user).toContain('<\\/response> trick')
        expect(user.endsWith('<user_input>\n도망친다!\n</user_input>')).toBe(true)
    })
    it('omits the replies block when there are none', () => {
        const user = buildDjMessages({ systemPrompt: 'x', slots, currentSlotId: '', recentResponses: [], userInput: 'hi' })[1].content
        expect(user).not.toContain('<recent_responses>')
        expect(user).toContain('<current_slot>none</current_slot>')
    })
})

describe('parseDjResponse', () => {
    it('reads JSON inside fences or prose, and accepts slot names', () => {
        expect(parseDjResponse('```json\n{"slot": "slot_fight", "confidence": 0.8}\n```', slots)).toEqual({ slotId: 'slot_fight', confidence: 0.8 })
        expect(parseDjResponse('Sure! {"slot":"forest","confidence":2}', slots)).toEqual({ slotId: 'slot_forest', confidence: 1 })
        expect(parseDjResponse('{"slot":"slot_day"}', slots)).toEqual({ slotId: 'slot_day', confidence: 1 })
    })
    it('returns null for unknown slots and broken answers', () => {
        expect(parseDjResponse('{"slot":"slot_space"}', slots)).toBeNull()
        expect(parseDjResponse('battle music please', slots)).toBeNull()
        expect(parseDjResponse('{"slot": }', slots)).toBeNull()
    })
})

describe('judgeDjDecision', () => {
    const settings = { minConfidence: 0.5, minDwellSec: 20 }
    const base = { currentSlotId: 'slot_day', settings, manualHoldLeft: 0, lastSwitchAt: 0, now: 100_000 }
    it('switches only for a different, confident pick after the dwell time and outside a manual hold', () => {
        expect(judgeDjDecision({ ...base, decision: { slotId: 'slot_fight', confidence: 0.9 } })).toBe('switch')
        expect(judgeDjDecision({ ...base, decision: { slotId: 'slot_day', confidence: 0.9 } })).toBe('same')
        expect(judgeDjDecision({ ...base, decision: { slotId: 'slot_fight', confidence: 0.3 } })).toBe('unsure')
        expect(judgeDjDecision({ ...base, manualHoldLeft: 1, decision: { slotId: 'slot_fight', confidence: 0.9 } })).toBe('held')
        expect(judgeDjDecision({ ...base, lastSwitchAt: 90_000, decision: { slotId: 'slot_fight', confidence: 0.9 } })).toBe('too-soon')
    })
})

describe('normalizeBgmDjSettings', () => {
    it('defaults to off with the auxiliary model and clamps numbers', () => {
        expect(normalizeBgmDjSettings(undefined)).toEqual({
            enabled: false, model: 'otherAx', recentCount: 2, maxChars: 1200, minConfidence: 0.5, minDwellSec: 20, manualHoldTurns: 2, showRequestStatus: false,
        })
        expect(normalizeBgmDjSettings({ model: 'model', recentCount: 99, maxChars: 5, minConfidence: -1 })).toMatchObject({ model: 'model', recentCount: 10, maxChars: 200, minConfidence: 0 })
    })
})
