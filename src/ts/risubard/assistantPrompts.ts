import { CHARACTER_ASSISTANT_SYSTEM_PROMPT } from './characterAssistant'
import { CHARACTER_ASSISTANT_PLAYER_PROMPT } from './characterAssistantPlay'
import { PROMPT_ASSISTANT_SELECT_PROMPT, PROMPT_ASSISTANT_SYSTEM_PROMPT } from './promptAssistant'

export const ASSISTANT_PROMPT_KEYS = [
    'promptAssistant',
    'promptAssistantSelect',
    'characterAssistant',
    'characterAssistantPlayer',
] as const

export type AssistantPromptKey = typeof ASSISTANT_PROMPT_KEYS[number]

/** Only the prompts the user changed; a missing key falls back to the built-in text. */
export type AssistantPromptOverrides = Partial<Record<AssistantPromptKey, string>>

export const ASSISTANT_PROMPT_DEFAULTS: Record<AssistantPromptKey, string> = {
    promptAssistant: PROMPT_ASSISTANT_SYSTEM_PROMPT,
    promptAssistantSelect: PROMPT_ASSISTANT_SELECT_PROMPT,
    characterAssistant: CHARACTER_ASSISTANT_SYSTEM_PROMPT,
    characterAssistantPlayer: CHARACTER_ASSISTANT_PLAYER_PROMPT,
}

export function normalizeAssistantPromptOverrides(raw: unknown): AssistantPromptOverrides {
    const result: AssistantPromptOverrides = {}
    if (!raw || typeof raw !== 'object') return result
    for (const key of ASSISTANT_PROMPT_KEYS) {
        const value = (raw as Record<string, unknown>)[key]
        if (typeof value === 'string' && value.trim() && value !== ASSISTANT_PROMPT_DEFAULTS[key]) result[key] = value
    }
    return result
}

export function resolveAssistantPrompt(overrides: AssistantPromptOverrides | undefined, key: AssistantPromptKey): string {
    const value = overrides?.[key]
    return typeof value === 'string' && value.trim() ? value : ASSISTANT_PROMPT_DEFAULTS[key]
}

/** Stores an edit; text that is empty or equal to the default removes the override. */
export function setAssistantPromptOverride(overrides: AssistantPromptOverrides, key: AssistantPromptKey, value: string) {
    if (!value.trim() || value === ASSISTANT_PROMPT_DEFAULTS[key]) delete overrides[key]
    else overrides[key] = value
}
