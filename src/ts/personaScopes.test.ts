import { describe, expect, test } from 'vitest'
import type { Chat, RisuPersona, character } from './storage/database.svelte'
import {
    clonePersonaToStore,
    ensureCharacterPersonas,
    getCharacterPersonas,
    getEffectivePersona,
    getNewChatPersonaBinding,
    nextPersonaCopyNote,
    normalizeSelectedPersonaIndex,
    resolvePersonaById,
} from './personaScopes'

const persona = (name: string, id: string): RisuPersona => ({
    name,
    id,
    icon: `${id}.png`,
    personaPrompt: `${name} prompt`,
})

const owner = (personas?: RisuPersona[]): character => ({
    personas,
    chats: [],
    chatFolders: [],
    chatPage: 0,
} as unknown as character)

describe('persona scopes', () => {
    test('normalizes corrupted selected persona indices to a valid global entry', () => {
        expect(normalizeSelectedPersonaIndex(2, -5)).toBe(0)
        expect(normalizeSelectedPersonaIndex(2, 99)).toBe(1)
        expect(normalizeSelectedPersonaIndex(2, Number.NaN)).toBe(0)
        expect(normalizeSelectedPersonaIndex(0, 99)).toBe(0)
    })

    test('resolves a bound persona from the current character before the global store', () => {
        const global = persona('Global duplicate', 'same-id')
        const local = persona('Character persona', 'same-id')

        expect(resolvePersonaById({ personas: [global], selectedPersona: 0 }, owner([local]), 'same-id'))
            .toEqual({ persona: local, scope: 'character', index: 0 })
    })

    test('falls back to the global store for existing chat bindings', () => {
        const global = persona('Global persona', 'global-id')

        expect(resolvePersonaById({ personas: [global], selectedPersona: 0 }, owner(), 'global-id'))
            .toEqual({ persona: global, scope: 'global', index: 0 })
    })

    test('uses the selected global persona when the chat has no valid binding', () => {
        const first = persona('First', 'first-id')
        const selected = persona('Selected', 'selected-id')
        const chat = { bindedPersona: 'missing-id' } as Chat

        expect(getEffectivePersona(
            { personas: [first, selected], selectedPersona: 1 },
            owner(),
            chat,
        )).toEqual({ persona: selected, scope: 'global', index: 1 })
    })

    test('inherits the effective persona for a new chat on the same character', () => {
        const global = persona('Global', 'global-id')
        const local = persona('Character', 'character-id')

        expect(getNewChatPersonaBinding(
            { personas: [global], selectedPersona: 0 },
            owner([local]),
            { bindedPersona: 'character-id' },
        )).toBe('character-id')
    })

    test('uses the last selected global persona when there is no previous chat', () => {
        const first = persona('First', 'first-id')
        const selected = persona('Selected', 'selected-id')

        expect(getNewChatPersonaBinding(
            { personas: [first, selected], selectedPersona: 1 },
        )).toBe('selected-id')
    })

    test('reads an absent character repository without mutating reactive state', () => {
        const character = owner()
        const store = getCharacterPersonas(character)

        expect(store).toEqual([])
        expect(character.personas).toBeUndefined()
    })

    test('initializes a character repository only for an explicit edit', () => {
        const character = owner()
        const store = ensureCharacterPersonas(character)

        expect(store).toEqual([])
        expect(character.personas).toBe(store)
    })

    test('keeps duplicate names and numbers the note instead', () => {
        const source = persona('Writer', 'source-id')
        source.note = 'Main'
        const second = persona('Writer', 'second-id')
        second.note = 'Main (1)'
        const target = [source, second]
        const clone = clonePersonaToStore(source, target, () => 'clone-id')

        expect(nextPersonaCopyNote(source, target.slice(0, 2))).toBe('Main (2)')
        expect(clone).toMatchObject({ name: 'Writer', note: 'Main (2)', id: 'clone-id' })
        expect(target).toEqual([source, expect.objectContaining({ id: 'second-id' }), clone])
        expect(clone).not.toBe(source)
    })

    test('keeps the original name and note when cloning without a collision', () => {
        const source = persona('Writer', 'source-id')
        source.note = 'Main'
        const target: RisuPersona[] = []

        expect(clonePersonaToStore(source, target, () => 'clone-id')).toMatchObject({
            name: 'Writer',
            note: 'Main',
        })
    })

    test('uses a bare parenthesized number when the duplicate has no note', () => {
        const source = persona('Writer', 'source-id')

        expect(clonePersonaToStore(source, [source], () => 'clone-id').note).toBe('(1)')
    })

})
