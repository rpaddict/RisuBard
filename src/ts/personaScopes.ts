import type { Chat, RisuPersona, character } from './storage/database.svelte'

export type PersonaScope = 'global' | 'character'

export interface PersonaSelection {
    persona: RisuPersona
    scope: PersonaScope
    index: number
}

export interface PersonaDatabaseView {
    personas: RisuPersona[]
    selectedPersona: number
}

export function normalizeSelectedPersonaIndex(personaCount: number, selectedPersona: number): number {
    if (personaCount <= 0 || !Number.isInteger(selectedPersona)) return 0
    return Math.min(Math.max(selectedPersona, 0), personaCount - 1)
}

export function getCharacterPersonas(character?: character | null): RisuPersona[] {
    return character?.personas ?? []
}

export function ensureCharacterPersonas(character: character): RisuPersona[] {
    character.personas ??= []
    return character.personas
}

export function resolvePersonaById(
    db: PersonaDatabaseView,
    character: character | null | undefined,
    id: string | null | undefined,
): PersonaSelection | null {
    if (!id) return null

    const characterIndex = character?.personas?.findIndex((persona) => persona.id === id) ?? -1
    if (characterIndex >= 0) {
        return {
            persona: character.personas![characterIndex],
            scope: 'character',
            index: characterIndex,
        }
    }

    const personas = db.personas ?? []
    const globalIndex = personas.findIndex((persona) => persona.id === id)
    if (globalIndex < 0) return null
    return { persona: personas[globalIndex], scope: 'global', index: globalIndex }
}

export function getEffectivePersona(
    db: PersonaDatabaseView,
    character?: character | null,
    chat?: Pick<Chat, 'bindedPersona'> | null,
): PersonaSelection | null {
    const bound = resolvePersonaById(db, character, chat?.bindedPersona)
    if (bound) return bound

    const personas = db.personas ?? []
    const index = normalizeSelectedPersonaIndex(personas.length, db.selectedPersona)
    const persona = personas[index]
    return persona ? { persona, scope: 'global', index } : null
}

export function getNewChatPersonaBinding(
    db: PersonaDatabaseView,
    character?: character | null,
    previousChat?: Pick<Chat, 'bindedPersona'> | null,
): string {
    return getEffectivePersona(db, character, previousChat)?.persona.id ?? ''
}

export function nextPersonaCopyNote(source: RisuPersona, target: RisuPersona[]): string | undefined {
    const collisions = target.filter((persona) => persona.name === source.name)
    if (collisions.length === 0) return source.note

    const sourceNote = source.note?.trimEnd() ?? ''
    const baseNote = sourceNote.replace(/\s*\(\d+\)$/, '').trimEnd()
    const suffixPattern = baseNote
        ? new RegExp(`^${escapeRegExp(baseNote)}\\s+\\((\\d+)\\)$`)
        : /^\((\d+)\)$/
    let highest = 0
    for (const persona of collisions) {
        const note = persona.note?.trim() ?? ''
        const match = suffixPattern.exec(note)
        if (match) highest = Math.max(highest, Number(match[1]))
    }
    const next = highest + 1
    return baseNote ? `${baseNote} (${next})` : `(${next})`
}

export function clonePersonaToStore(
    source: RisuPersona,
    target: RisuPersona[],
    createId: () => string,
): RisuPersona {
    const clone = safeStructuredClone(source)
    clone.name = source.name
    clone.note = nextPersonaCopyNote(source, target)
    clone.id = createId()
    target.push(clone)
    return clone
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
