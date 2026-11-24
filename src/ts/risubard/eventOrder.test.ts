import { describe, expect, test } from 'vitest'
import { createEventTurnLabels } from './eventOrder'

describe('createEventTurnLabels', () => {
    const messages = [
        { chatId: 'u1', role: 'user' },
        { chatId: 'a1', role: 'char' },
        { chatId: 'u2', role: 'user' },
        { chatId: 'ooc', role: 'char', data: '<!-- OOC_turn -->' },
        { chatId: 'note', role: 'char', isComment: true },
        { chatId: 'u3', role: 'user' },
        { chatId: 'off', role: 'char', disabled: true },
        { chatId: 'a3', role: 'char' },
        { chatId: 'a4', role: 'char' },
    ]
    const turnOf = createEventTurnLabels(messages)

    test('counts turns like the chat screen, OOC included', () => {
        expect(turnOf(['u1', 'a1'])).toBe('1')
        expect(turnOf(['u3', 'a3'])).toBe('3')
    })

    test('shows a range for events spanning several turns', () => {
        expect(turnOf(['a1', 'a4'])).toBe('1~4')
    })

    test('falls back to the reply a user message opened', () => {
        expect(turnOf(['u3'])).toBe('3')
    })

    test('has no turn for sources missing from this chat', () => {
        expect(turnOf(['inherited:old:a1'])).toBeUndefined()
        expect(turnOf([])).toBeUndefined()
        expect(turnOf(['off'])).toBeUndefined()
    })
})
