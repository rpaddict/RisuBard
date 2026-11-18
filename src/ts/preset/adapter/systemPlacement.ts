import type { AdapterChatMessage } from './types'

/**
 * Anthropic and Gemini take one system field in front of every message, so the
 * adapters hoist every system-role message into it. A system block placed after
 * the chat history (keyword lore, BardWiki memory, author's note) then changes
 * the system field on every turn, and the prompt cache misses from the first
 * byte. With the option on, only the leading run of system messages is hoisted;
 * a later one stays where the preset put it, sent as a user turn like the
 * classic request path does.
 */
export function inlineLaterSystemMessages(messages: AdapterChatMessage[]): AdapterChatMessage[] {
    const firstChat = messages.findIndex((message) => message.role !== 'system')
    if (firstChat < 0) return messages
    return messages.map((message, index) => index > firstChat && message.role === 'system'
        ? { ...message, role: 'user', content: `System: ${message.content}` }
        : message)
}
