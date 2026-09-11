export const BARD_LORE_DEFAULT_INSTRUCTION_PRESET_ID = 'risubard-grimoire-analysis-default'

export interface BardLoreInstructionPreset {
    schemaVersion: 1
    id: string
    name: string
    revision: number
    builtin: boolean
    content: string
}

export interface BardLoreInstructionPresetState {
    presets: BardLoreInstructionPreset[]
    activePresetId: string
}

export interface BardLoreInstructionRuntimeSlots {
    languageInstruction: string
    filterFacetInstruction: string
}

const DEFAULT_CONTENT = [
    'Analyze Grimoire metadata for deterministic runtime retrieval.',
    'Do not rewrite lore content.',
    'Infer explicit aliases, concise tags, one kind, normalized facets, a short factual search summary, a justified activation policy, and justified typed links.',
    '{{metadata_language_instruction}}',
    'Facets are structured facts such as work, gender, role, affiliation, location, or era. Each facet has one canonical key/value and query aliases.',
    '{{filter_facet_instruction}}',
    'Do not invent or require a facet merely because its key is filterable. Original characters and standalone settings may have no work, series, franchise, gender, affiliation, or other optional facet.',
    'Add retrieval facets and aliases for explicitly stated appearance, school or social role, age group, personality, skills, weaknesses, preferences, and recurring behavior. These descriptors are search evidence, not graph relationships. Follow the selected metadata language so a natural-language description can retrieve the character without naming them.',
    'Do not use a generic class word such as persona, character, country, or location as the alias of many different facet values. An alias must identify that value rather than merely name its category.',
    'Set activation to "required" only for a system rule or output contract that must be present on every generation request, such as a status display, mandatory output tags, or a fixed output format. Set activation to "keyed" only when explicit keys should trigger the entry. Otherwise use "retrieve". Do not preserve a legacy always-active setting merely because it already exists.',
    'Set injection to "index-only" for a composite directory, roster, timeline, chronology, or routing catalog whose complete body should not be sent to the generation model; otherwise use "full".',
    'For a composite directory, roster, timeline, or chronology, return one atom per independently retrievable entity or event. atom.sourceQuote must be an exact contiguous quote from the supplied source content; never rewrite it. Set atom.existingTargetRef to the matching linkCatalog ref when that atomic entry already exists, otherwise -1. Return atoms: [] for ordinary entries.',
    'A shared kind or tag alone is not a relationship. Links must be supported by the supplied lore text.',
    'Do not use supporting as the default relationship mode. Use supporting only when selecting this source should also inject the target as necessary explanatory context. Use discoverable when selecting the target should find this source by reverse traversal. Use ambient for scene-presence hints such as a character attending, belonging to, or normally appearing at a location, class, club, organization, or event. Use none for a stored relationship that must not expand retrieval. Prefer none over a weak or ambiguous expansion.',
    'linkCatalog tuples are [ref, name, currentKind]. Current metadata link tuples are [targetRef, relation, retrieval].',
    'Return every target ref exactly once and no other ref. Use only link targetRef values from linkCatalog.',
    'Return JSON only matching the supplied schema.',
].join('\n')

export function createDefaultBardLoreInstructionPreset(): BardLoreInstructionPreset {
    return {
        schemaVersion: 1,
        id: BARD_LORE_DEFAULT_INSTRUCTION_PRESET_ID,
        name: 'RisuBard Default',
        revision: 1,
        builtin: true,
        content: DEFAULT_CONTENT,
    }
}

function normalizeCustomPreset(value: unknown): BardLoreInstructionPreset | undefined {
    if (!value || typeof value !== 'object') return undefined
    const preset = value as Partial<BardLoreInstructionPreset>
    if (
        preset.id === BARD_LORE_DEFAULT_INSTRUCTION_PRESET_ID
        || typeof preset.id !== 'string'
        || !preset.id.trim()
        || typeof preset.name !== 'string'
        || !preset.name.trim()
        || typeof preset.content !== 'string'
    ) return undefined
    return {
        schemaVersion: 1,
        id: preset.id,
        name: preset.name.trim(),
        revision: Number.isInteger(preset.revision) && (preset.revision ?? 0) > 0
            ? preset.revision!
            : 1,
        builtin: false,
        content: preset.content,
    }
}

export function normalizeBardLoreInstructionPresetState(
    value: Partial<BardLoreInstructionPresetState> | undefined,
): BardLoreInstructionPresetState {
    const builtin = createDefaultBardLoreInstructionPreset()
    const custom = Array.isArray(value?.presets)
        ? value.presets.map(normalizeCustomPreset).filter((preset): preset is BardLoreInstructionPreset => Boolean(preset))
        : []
    const seen = new Set([builtin.id])
    const presets = [builtin, ...custom.filter((preset) => {
        if (seen.has(preset.id)) return false
        seen.add(preset.id)
        return true
    })]
    const activePresetId = presets.some((preset) => preset.id === value?.activePresetId)
        ? value!.activePresetId!
        : builtin.id
    return { presets, activePresetId }
}

export function resolveBardLoreInstructionPreset(
    presets: BardLoreInstructionPreset[] | undefined,
    activePresetId: string | undefined,
): BardLoreInstructionPreset {
    if (activePresetId && activePresetId !== BARD_LORE_DEFAULT_INSTRUCTION_PRESET_ID) {
        const custom = presets?.find((preset) => preset.id === activePresetId && !preset.builtin)
        if (custom) return custom
    }
    return presets?.find((preset) => preset.id === BARD_LORE_DEFAULT_INSTRUCTION_PRESET_ID)
        ?? createDefaultBardLoreInstructionPreset()
}

export function compileBardLoreInstructionPreset(
    preset: BardLoreInstructionPreset,
    slots: BardLoreInstructionRuntimeSlots,
): string {
    return preset.content
        .replaceAll('{{metadata_language_instruction}}', slots.languageInstruction)
        .replaceAll('{{filter_facet_instruction}}', slots.filterFacetInstruction)
}

export function duplicateBardLoreInstructionPreset(
    source: BardLoreInstructionPreset,
    id: string,
): BardLoreInstructionPreset {
    return {
        schemaVersion: 1,
        id,
        name: `${source.name} Copy`,
        revision: 1,
        builtin: false,
        content: source.content,
    }
}

export function deleteBardLoreInstructionPreset(
    presets: BardLoreInstructionPreset[],
    id: string,
): { presets: BardLoreInstructionPreset[]; deleted: boolean } {
    const target = presets.find((preset) => preset.id === id)
    if (!target || target.builtin) return { presets, deleted: false }
    return { presets: presets.filter((preset) => preset.id !== id), deleted: true }
}
