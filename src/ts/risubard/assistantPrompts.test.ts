import { describe, expect, test, vi } from 'vitest'
vi.mock('../parser/parser.svelte', () => ({ risuChatParser: (text: string) => text }))
vi.mock('../util', () => ({ parseToggleSyntax: () => [] }))
import {
    ASSISTANT_PROMPT_DEFAULTS,
    normalizeAssistantPromptOverrides,
    resolveAssistantPrompt,
    setAssistantPromptOverride,
    type AssistantPromptOverrides,
} from './assistantPrompts'
import { buildPromptAssistantMessages } from './promptAssistant'

describe('assistant prompt overrides', () => {
    test('falls back to the built-in prompt when nothing is stored', () => {
        expect(resolveAssistantPrompt(undefined, 'characterAssistant')).toBe(ASSISTANT_PROMPT_DEFAULTS.characterAssistant)
        expect(resolveAssistantPrompt({ characterAssistant: '  ' }, 'characterAssistant')).toBe(ASSISTANT_PROMPT_DEFAULTS.characterAssistant)
    })

    test('stores only text that differs from the default', () => {
        const overrides: AssistantPromptOverrides = {}
        setAssistantPromptOverride(overrides, 'promptAssistant', '새 지시')
        expect(overrides).toEqual({ promptAssistant: '새 지시' })
        setAssistantPromptOverride(overrides, 'promptAssistant', ASSISTANT_PROMPT_DEFAULTS.promptAssistant)
        expect(overrides).toEqual({})
    })

    test('normalizing drops unknown keys and non-string values', () => {
        expect(normalizeAssistantPromptOverrides({ promptAssistant: 'x', other: 'y', characterAssistant: 3 })).toEqual({ promptAssistant: 'x' })
        expect(normalizeAssistantPromptOverrides(null)).toEqual({})
    })

    test('the builder sends the override in place of the default', () => {
        const messages = buildPromptAssistantMessages({ systemPrompt: '새 지시', preset: '<preset />', history: [], userText: 'hi' })
        expect(messages[0].content.startsWith('새 지시\n\n<preset />')).toBe(true)
    })
})
