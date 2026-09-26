export interface PainterAnchor {
    characterId: string
    chatId: string
    messageId: string
    start: number
    end: number
    text: string
    /** Display-only selection: generation works, but no verified source insertion offsets exist. */
    insertionUnavailable?: boolean
}

export interface PainterSubject {
    id: string
    name: string
    aliases: string[]
    kind: 'character' | 'object'
    appearance: string
    clothing: string
    state: string
    pose: string
    negative: string
    locked?: boolean
    /** Verbatim text edited in the single character prompt block. */
    prompt?: string
}

export interface PainterFragment {
    id: string
    name: string
    prompt: string
}

export interface PainterDraft {
    rendering: string
    scene: string
    negative: string
    subjects: PainterSubject[]
    /** User-owned copies; never populated from model output. */
    fragments?: PainterFragment[]
}

export interface PainterStyle {
    id: string
    name: string
    artist: string
    rendering: string
    negative: string
    steps: number
    scale: number
    cfgRescale: number
    sampler: string
}

export interface PainterContext {
    before: number
    after: number
    surrounding: boolean
    systemPrompt: boolean
    characterDescription: boolean
    persona: boolean
    characterLorebook: boolean
    moduleLorebook: boolean
    wikiIds: string[]
    referenceId: string
    referenceAssetId?: string
}

export interface PainterSettings {
    styleId: string
    model: 'nai-diffusion-5-full' | 'nai-diffusion-5-curated'
    modelSlot: 'model' | 'submodel'
    width: number
    height: number
    seed: number | null
    instruction: string
    /** Scene-local camera selection; missing legacy values use third-person. */
    perspective?: 'first-person' | 'third-person'
    context: PainterContext
}

export interface PainterIdentity {
    id: string
    name: string
    aliases: string[]
    appearance: string
    /** Explicit opt-in for public character cards; missing means private. */
    attachToCard?: boolean
}

/** Reusable generation options; scene-specific instructions and references stay in the chat. */
export type PainterGenerationSettings = Pick<PainterSettings, 'model' | 'modelSlot' | 'width' | 'height' | 'seed'> & {
    context: Omit<PainterContext, 'wikiIds' | 'referenceId' | 'referenceAssetId'>
}

export function painterGenerationSettings(settings: PainterSettings): PainterGenerationSettings {
    const { model, modelSlot, width, height, seed } = settings
    const { before, after, surrounding, systemPrompt, characterDescription, persona, characterLorebook, moduleLorebook } = settings.context
    return { model, modelSlot, width, height, seed,
        context: { before, after, surrounding, systemPrompt, characterDescription, persona, characterLorebook, moduleLorebook } }
}

export interface PainterOutfit {
    id: string
    subjectId: string
    name: string
    clothing: string
    state: string
    /** Requires an attached identity as well; chat-local outfits are never exported. */
    attachToCard?: boolean
}

export interface PainterResult {
    id: string
    assetId: string
    createdAt: number
    anchor: PainterAnchor
    draft: PainterDraft
    style: PainterStyle
    settings: PainterSettings
    seed: number
    inserted?: 'before' | 'after'
    compressionPending?: boolean
}

export interface PainterChatData {
    settings: PainterSettings
    /** Applied snapshot, independent of chat/global toggle values. */
    imagePreset?: { promptPresetId: string; name: string; values: Record<string, string> }
    /** Missing on legacy chats: preserve their existing local generation options. */
    settingsScope?: 'global' | 'chat'
    anchor?: PainterAnchor
    draft?: PainterDraft
    outfits: PainterOutfit[]
    results: PainterResult[]
    conversation?: Array<{ id: string; role: 'user' | 'assistant'; text: string }>
    previousDraft?: PainterDraft
}

export interface PainterBotData {
    identities: PainterIdentity[]
    outfits: PainterOutfit[]
    settings?: PainterGenerationSettings
}

export interface PainterContextSource { name: string; content: string }

export function createPainterSettings(): PainterSettings {
    return {
        styleId: 'default', model: 'nai-diffusion-5-full', modelSlot: 'model',
        width: 832, height: 1216, seed: null, instruction: '', perspective: 'third-person',
        context: {
            before: 2, after: 0, surrounding: false, systemPrompt: false,
            characterDescription: true, persona: false, characterLorebook: false,
            moduleLorebook: false, wikiIds: [], referenceId: '',
        },
    }
}

export function createPainterChatData(defaultStyleId = 'default'): PainterChatData {
    return { settings: { ...createPainterSettings(), styleId: defaultStyleId }, settingsScope: 'global', outfits: [], results: [] }
}
