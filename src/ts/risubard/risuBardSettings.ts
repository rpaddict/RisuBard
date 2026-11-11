import {
    buildWikiCharacterSectionHeadingGuide,
    buildWikiWritingLanguageGuard,
    normalizeWikiWritingLanguage,
    wikiWritingHeadings,
    type WikiWritingLanguage,
} from './wikiWritingLanguage'

export const RISUBARD_ANALYSIS_TOKEN_LIMIT_DEFAULT = 32_768
export const RISUBARD_ADDITIONAL_SEARCH_LIMIT_DEFAULT = 1
export const RISUBARD_CANONICAL_TARGET_LIMIT_DEFAULT = 8
// One analysis call takes at most four turns (NARRATIVE_BACKLOG_TURNS_PER_RUN).
export const RISUBARD_ANALYSIS_TURN_INTERVAL_MAX = 4
export const RISUBARD_INQUIRY_TARGET_TOKEN_BUDGET_DEFAULT = 4_000
export const RISUBARD_INQUIRY_EVENT_TOKEN_BUDGET_DEFAULT = 3_000
export const RISUBARD_INQUIRY_SOURCE_TOKEN_BUDGET_DEFAULT = 2_000
export const RISUBARD_INQUIRY_MAXIMUM_TOKEN_BUDGET_DEFAULT = 7_500
export const RISUBARD_INQUIRY_TIMEOUT_MS_DEFAULT = 10_000
export const RISUBARD_HISTORICAL_SOURCE_MATCH_LIMIT_DEFAULT = 8
export const RISUBARD_CANONICAL_WRITING_STYLE_DEFAULT = 'concise' as const
export const RISUBARD_CANONICAL_CUSTOM_STYLE_MAX_LENGTH = 1_000
export const RISUBARD_DYNAMIC_MEMORY_MAXIMUM_DEFAULT = 12_000
export const RISUBARD_ANALYSIS_LORE_TOKEN_LIMIT_DEFAULT = 1_000
// Image asset lists are often always-on and thousands of tokens long; they never carry story facts.
export const RISUBARD_ANALYSIS_LORE_EXCLUDE_WORDS_DEFAULT = ['<img', '{{asset::', '{{img::', '{{image::'].join('\n')
export const RISUBARD_ANALYSIS_LORE_EXCLUDE_WORDS_MAX_LENGTH = 2_000
export type RisuBardDynamicMemoryMode = 'off' | 'economy' | 'balanced' | 'recall'
export const RISUBARD_DYNAMIC_MEMORY_MODE_DEFAULT: RisuBardDynamicMemoryMode = 'economy'

export type RisuBardCanonicalWritingStyle =
    | 'standard'
    | 'concise'
    | 'ultra-concise'
    | 'custom'

export interface RisuBardChatSettings {
    risuBardDynamicMemoryMode?: RisuBardDynamicMemoryMode
    risuBardDynamicMemoryMaximumTokens?: number
    risuBardModelMode?: 'memory' | 'model'
    showRequestStatus?: boolean
    risuBardInquiryTargetTokenBudget?: number
    risuBardInquiryEventTokenBudget?: number
    risuBardInquirySourceTokenBudget?: number
    risuBardInquiryMaximumTokenBudget?: number
    risuBardInquiryTimeoutMs?: number
    risuBardHistoricalSourceMatchLimit?: number
    risuBardSourceRerank?: boolean
    risuBardAnalysisTokenLimit?: number
    risuBardAdditionalSearchLimit?: number
    risuBardCanonicalTargetLimit?: number
    risuBardAnalysisTurnInterval?: number
    risuBardRecentMessageCount?: number
    risuBardResponseMessageCount?: number
    risuBardResponseExcludeUserMessages?: boolean
    risuBardAnalysisExcludeUserMessages?: boolean
    risuBardAnalysisLoreTokenLimit?: number
    risuBardAnalysisLoreIncludeAlwaysActive?: boolean
    risuBardAnalysisLoreExcludeWords?: string
    risuBardCanonicalWritingStyle?: RisuBardCanonicalWritingStyle
    risuBardCanonicalCustomStyle?: string
    risuBardWikiWritingLanguage?: WikiWritingLanguage
    bardChatIncludeWiki?: boolean
    bardChatIncludeChat?: boolean
    bardChatIncludeSystemPrompt?: boolean
    bardChatIncludeCharacterDescription?: boolean
    bardChatIncludePersona?: boolean
    bardChatIncludeCharacterLorebook?: boolean
    bardChatIncludeModuleLorebook?: boolean
}

export interface ResolvedRisuBardChatSettings {
    risuBardDynamicMemoryMode: RisuBardDynamicMemoryMode
    risuBardDynamicMemoryMaximumTokens: number
    risuBardModelMode: 'memory' | 'model'
    showRequestStatus: boolean
    risuBardInquiryTargetTokenBudget: number
    risuBardInquiryEventTokenBudget: number
    risuBardInquirySourceTokenBudget: number
    risuBardInquiryMaximumTokenBudget: number
    risuBardInquiryTimeoutMs: number
    risuBardHistoricalSourceMatchLimit: number
    risuBardSourceRerank: boolean
    risuBardAnalysisTokenLimit: number
    risuBardAdditionalSearchLimit: number
    risuBardCanonicalTargetLimit: number
    risuBardAnalysisTurnInterval: number
    risuBardRecentMessageCount: number
    risuBardResponseMessageCount: number
    risuBardResponseExcludeUserMessages: boolean
    risuBardAnalysisExcludeUserMessages: boolean
    risuBardAnalysisLoreTokenLimit: number
    risuBardAnalysisLoreIncludeAlwaysActive: boolean
    risuBardAnalysisLoreExcludeWords: string
    risuBardCanonicalWritingStyle: RisuBardCanonicalWritingStyle
    risuBardCanonicalCustomStyle: string
    risuBardWikiWritingLanguage: WikiWritingLanguage
    bardChatIncludeWiki: boolean
    bardChatIncludeChat: boolean
    bardChatIncludeSystemPrompt: boolean
    bardChatIncludeCharacterDescription: boolean
    bardChatIncludePersona: boolean
    bardChatIncludeCharacterLorebook: boolean
    bardChatIncludeModuleLorebook: boolean
}

function boundedInteger(
    value: unknown,
    fallback: number,
    minimum: number,
    maximum = Number.MAX_SAFE_INTEGER
): number {
    if (!Number.isFinite(value) || typeof value !== 'number') return fallback
    const rounded = Math.round(value)
    if (!Number.isSafeInteger(rounded)) return fallback
    return Math.max(minimum, Math.min(maximum, rounded))
}

export type RisuBardNumberSettingKey =
    | 'risuBardDynamicMemoryMaximumTokens'
    | 'risuBardInquiryTargetTokenBudget'
    | 'risuBardInquiryEventTokenBudget'
    | 'risuBardInquirySourceTokenBudget'
    | 'risuBardInquiryMaximumTokenBudget'
    | 'risuBardInquiryTimeoutMs'
    | 'risuBardHistoricalSourceMatchLimit'
    | 'risuBardAnalysisTokenLimit'
    | 'risuBardAdditionalSearchLimit'
    | 'risuBardCanonicalTargetLimit'
    | 'risuBardAnalysisTurnInterval'
    | 'risuBardRecentMessageCount'
    | 'risuBardResponseMessageCount'
    | 'risuBardAnalysisLoreTokenLimit'

/**
 * The bounds resolveRisuBardChatSettings applies to each number setting.
 * The three inquiry budgets other than the maximum are capped by the resolved maximum, passed as inquiryMaximum.
 */
export function risuBardNumberSettingBounds(
    key: RisuBardNumberSettingKey,
    inquiryMaximum = Number.MAX_SAFE_INTEGER,
): { min: number; max: number } {
    switch (key) {
        case 'risuBardInquiryTargetTokenBudget':
        case 'risuBardInquiryEventTokenBudget':
        case 'risuBardInquirySourceTokenBudget':
            return { min: 256, max: inquiryMaximum }
        case 'risuBardDynamicMemoryMaximumTokens':
        case 'risuBardInquiryMaximumTokenBudget':
            return { min: 256, max: Number.MAX_SAFE_INTEGER }
        case 'risuBardInquiryTimeoutMs': return { min: 1, max: 10_000 }
        case 'risuBardHistoricalSourceMatchLimit': return { min: 0, max: 32 }
        case 'risuBardAnalysisTokenLimit': return { min: 3_072, max: Number.MAX_SAFE_INTEGER }
        case 'risuBardAdditionalSearchLimit':
        case 'risuBardAnalysisLoreTokenLimit':
            return { min: 0, max: Number.MAX_SAFE_INTEGER }
        case 'risuBardAnalysisTurnInterval':
            return { min: 1, max: RISUBARD_ANALYSIS_TURN_INTERVAL_MAX }
        case 'risuBardCanonicalTargetLimit':
        case 'risuBardRecentMessageCount':
        case 'risuBardResponseMessageCount':
            return { min: 1, max: Number.MAX_SAFE_INTEGER }
    }
}

/** Rounds and clamps a typed value with the resolve bounds; non-numbers return the fallback. */
export function normalizeRisuBardNumberSetting(
    key: RisuBardNumberSettingKey,
    value: unknown,
    fallback: number,
    inquiryMaximum?: number,
): number {
    const { min, max } = risuBardNumberSettingBounds(key, inquiryMaximum)
    return boundedInteger(value, fallback, min, max)
}

const bounded = (key: RisuBardNumberSettingKey, value: unknown, fallback: number, inquiryMaximum?: number) =>
    normalizeRisuBardNumberSetting(key, value, fallback, inquiryMaximum)

export function resolveRisuBardChatSettings(
    global: RisuBardChatSettings,
    chat?: RisuBardChatSettings,
    pinned?: RisuBardChatSettings,
): ResolvedRisuBardChatSettings {
    const overrides = pinned ?? chat
    const value = <K extends keyof RisuBardChatSettings>(key: K) =>
        overrides?.[key] ?? global[key]
    const inquiry = normalizeRisuBardInquiryTokenBudget(
        value('risuBardInquiryTargetTokenBudget'),
        value('risuBardInquiryMaximumTokenBudget'),
        value('risuBardInquiryEventTokenBudget'),
        value('risuBardInquirySourceTokenBudget'),
    )
    return {
        risuBardDynamicMemoryMode: normalizeRisuBardDynamicMemoryMode(value('risuBardDynamicMemoryMode')),
        risuBardDynamicMemoryMaximumTokens: normalizeRisuBardDynamicMemoryMaximum(value('risuBardDynamicMemoryMaximumTokens')),
        risuBardModelMode: value('risuBardModelMode') === 'model' ? 'model' : 'memory',
        showRequestStatus: value('showRequestStatus') !== false,
        risuBardInquiryTargetTokenBudget: inquiry.target,
        risuBardInquiryEventTokenBudget: inquiry.events,
        risuBardInquirySourceTokenBudget: inquiry.perSource,
        risuBardInquiryMaximumTokenBudget: inquiry.maximum,
        risuBardInquiryTimeoutMs: normalizeRisuBardInquiryTimeoutMs(
            value('risuBardInquiryTimeoutMs')
        ),
        risuBardHistoricalSourceMatchLimit:
            normalizeRisuBardHistoricalSourceMatchLimit(
                value('risuBardHistoricalSourceMatchLimit')
            ),
        risuBardSourceRerank: value('risuBardSourceRerank') === true,
        risuBardAnalysisTokenLimit: normalizeRisuBardAnalysisTokenLimit(
            value('risuBardAnalysisTokenLimit')
        ),
        risuBardAdditionalSearchLimit: normalizeRisuBardAdditionalSearchLimit(
            value('risuBardAdditionalSearchLimit')
        ),
        risuBardCanonicalTargetLimit: normalizeRisuBardCanonicalTargetLimit(
            value('risuBardCanonicalTargetLimit')
        ),
        risuBardAnalysisTurnInterval: bounded(
            'risuBardAnalysisTurnInterval', value('risuBardAnalysisTurnInterval'), 1
        ),
        risuBardRecentMessageCount: bounded(
            'risuBardRecentMessageCount', value('risuBardRecentMessageCount'), 12
        ),
        risuBardResponseMessageCount: bounded(
            'risuBardResponseMessageCount', value('risuBardResponseMessageCount'), 12
        ),
        risuBardResponseExcludeUserMessages:
            value('risuBardResponseExcludeUserMessages') === true,
        risuBardAnalysisExcludeUserMessages:
            value('risuBardAnalysisExcludeUserMessages') === true,
        risuBardAnalysisLoreTokenLimit: bounded(
            'risuBardAnalysisLoreTokenLimit', value('risuBardAnalysisLoreTokenLimit'), RISUBARD_ANALYSIS_LORE_TOKEN_LIMIT_DEFAULT
        ),
        risuBardAnalysisLoreIncludeAlwaysActive:
            value('risuBardAnalysisLoreIncludeAlwaysActive') === true,
        risuBardAnalysisLoreExcludeWords: normalizeRisuBardAnalysisLoreExcludeWords(
            value('risuBardAnalysisLoreExcludeWords')
        ),
        risuBardCanonicalWritingStyle: normalizeRisuBardCanonicalWritingStyle(
            value('risuBardCanonicalWritingStyle')
        ),
        risuBardCanonicalCustomStyle: normalizeRisuBardCanonicalCustomStyle(
            value('risuBardCanonicalCustomStyle')
        ),
        risuBardWikiWritingLanguage: normalizeWikiWritingLanguage(value('risuBardWikiWritingLanguage')),
        bardChatIncludeWiki: value('bardChatIncludeWiki') !== false,
        bardChatIncludeChat: value('bardChatIncludeChat') === true,
        bardChatIncludeSystemPrompt:
            value('bardChatIncludeSystemPrompt') === true,
        bardChatIncludeCharacterDescription:
            value('bardChatIncludeCharacterDescription') === true,
        bardChatIncludePersona: value('bardChatIncludePersona') === true,
        bardChatIncludeCharacterLorebook:
            value('bardChatIncludeCharacterLorebook') === true,
        bardChatIncludeModuleLorebook:
            value('bardChatIncludeModuleLorebook') === true,
    }
}

export function normalizeRisuBardDynamicMemoryMode(value: unknown): RisuBardDynamicMemoryMode {
    // An explicitly stored 'off' stays off; only missing or invalid values fall back to the default.
    return value === 'off' || value === 'economy' || value === 'balanced' || value === 'recall'
        ? value
        : RISUBARD_DYNAMIC_MEMORY_MODE_DEFAULT
}

export function normalizeRisuBardDynamicMemoryMaximum(value: unknown): number {
    return bounded('risuBardDynamicMemoryMaximumTokens', value, RISUBARD_DYNAMIC_MEMORY_MAXIMUM_DEFAULT)
}

/** A missing value means the default list; an empty string means the user cleared it. */
export function normalizeRisuBardAnalysisLoreExcludeWords(value: unknown): string {
    return typeof value === 'string'
        ? value.slice(0, RISUBARD_ANALYSIS_LORE_EXCLUDE_WORDS_MAX_LENGTH)
        : RISUBARD_ANALYSIS_LORE_EXCLUDE_WORDS_DEFAULT
}

/** One word per line; blank lines are ignored. */
export function parseRisuBardLoreExcludeWords(value: string): string[] {
    return [...new Set(value.split('\n').map((word) => word.trim()).filter(Boolean))]
}

export function normalizeRisuBardAnalysisTokenLimit(value: unknown): number {
    return bounded('risuBardAnalysisTokenLimit', value, RISUBARD_ANALYSIS_TOKEN_LIMIT_DEFAULT)
}

export function normalizeRisuBardAdditionalSearchLimit(value: unknown): number {
    return bounded('risuBardAdditionalSearchLimit', value, RISUBARD_ADDITIONAL_SEARCH_LIMIT_DEFAULT)
}

export function normalizeRisuBardCanonicalTargetLimit(value: unknown): number {
    return bounded('risuBardCanonicalTargetLimit', value, RISUBARD_CANONICAL_TARGET_LIMIT_DEFAULT)
}

export function normalizeRisuBardHistoricalSourceMatchLimit(
    value: unknown
): number {
    return bounded('risuBardHistoricalSourceMatchLimit', value, RISUBARD_HISTORICAL_SOURCE_MATCH_LIMIT_DEFAULT)
}

export function normalizeRisuBardInquiryTokenBudget(
    target: unknown,
    maximum: unknown,
    events?: unknown,
    perSource?: unknown,
): { target: number; events: number; perSource: number; maximum: number } {
    const normalizedMaximum = bounded('risuBardInquiryMaximumTokenBudget', maximum, RISUBARD_INQUIRY_MAXIMUM_TOKEN_BUDGET_DEFAULT)
    return {
        target: bounded('risuBardInquiryTargetTokenBudget', target, RISUBARD_INQUIRY_TARGET_TOKEN_BUDGET_DEFAULT, normalizedMaximum),
        events: bounded('risuBardInquiryEventTokenBudget', events, RISUBARD_INQUIRY_EVENT_TOKEN_BUDGET_DEFAULT, normalizedMaximum),
        perSource: bounded('risuBardInquirySourceTokenBudget', perSource, RISUBARD_INQUIRY_SOURCE_TOKEN_BUDGET_DEFAULT, normalizedMaximum),
        maximum: normalizedMaximum,
    }
}

/**
 * The one built-in style. Retrieval reads these documents back to answer later
 * questions, so room goes to concrete facts rather than narration: in a 45-turn
 * measurement, event summaries spent 500-900 tokens each yet dropped the counts,
 * names and objects that questions asked about.
 */
const RISUBARD_FACT_DENSE_STYLE = 'One short sentence per fact; no atmosphere, emotion, routine movement or repetition. Keep counts, names, objects and their places, attempt outcomes and a few exact words of key lines. Preserve subjects, objects, negation, time and knowledge boundaries.'

export function normalizeRisuBardCanonicalWritingStyle(
    value: unknown
): RisuBardCanonicalWritingStyle {
    // Standard and ultra-concise were merged into the single built-in style.
    return value === 'custom' ? value : RISUBARD_CANONICAL_WRITING_STYLE_DEFAULT
}

export function normalizeRisuBardCanonicalCustomStyle(value: unknown): string {
    return typeof value === 'string'
        ? value.trim().slice(0, RISUBARD_CANONICAL_CUSTOM_STYLE_MAX_LENGTH)
        : ''
}

function resolveRisuBardWritingStyleInstruction(
    style: unknown,
    customStyle: unknown,
): string {
    const normalizedStyle = normalizeRisuBardCanonicalWritingStyle(style)
    const normalizedCustom = normalizeRisuBardCanonicalCustomStyle(customStyle)
    return normalizedStyle === 'custom' && normalizedCustom.length > 0
        ? `User style preference: ${normalizedCustom}`
        : RISUBARD_FACT_DENSE_STYLE
}

export function normalizeRisuBardInquiryTimeoutMs(value: unknown): number {
    return bounded('risuBardInquiryTimeoutMs', value, RISUBARD_INQUIRY_TIMEOUT_MS_DEFAULT)
}

export function normalizeRisuBardPlayerName(value: unknown): string {
    return typeof value === 'string'
        ? value.replace(/[\u0000-\u001f\u007f]/gu, ' ').trim().slice(0, 80)
        : ''
}

export function buildRisuBardEventWritingPolicy(
    style: unknown,
    customStyle: unknown,
    language: WikiWritingLanguage = 'ko',
    playerName?: unknown,
): string {
    const player = normalizeRisuBardPlayerName(playerName)
    return [
        '## Canonical writing policy',
        resolveRisuBardWritingStyleInstruction(style, customStyle),
        // Without it, a first-person story left the model to guess: once the source work's label, once "narrator".
        ...(player ? [`Player character: ${JSON.stringify(player)}. Use this name where the text says I, me or you or names them by a role; never a guessed name or "narrator".`] : []),
        'When compressing, do not invent action targets or locations, turn temporal order into causation, or cross character knowledge boundaries at the time of an event.',
        'Preserve observed puzzle elements, order, spatial layout, pairings, blanks, mechanism positions and attempt outcomes. Separate observations from inferred rules or solutions; retain unresolved clues as open continuity.',
        'Style affects expression only; it cannot change fact selection, evidence, structure or safety rules.',
        'Inside [[...]], write only a document title or alias as the target. Never use a document id field (for example location.abc123) or file path as a link target.',
        buildWikiWritingLanguageGuard(language),
    ].join('\n')
}

export function buildRisuBardCanonicalWritingPolicy(
    style: unknown,
    customStyle: unknown,
    language: WikiWritingLanguage = 'ko',
    playerName?: unknown,
): string {
    const normalizedLanguage = normalizeWikiWritingLanguage(language)
    const headings = wikiWritingHeadings[normalizedLanguage]
    return [
        buildRisuBardEventWritingPolicy(style, customStyle, language, playerName),
        'Treat each character document as a dynamic lorebook entry: keep durable identity, role, traits, capabilities and rules, relationships, knowledge boundaries, goals, possessions, constraints, and open continuity that help the character operate in the next scene.',
        `A compact self-contained \`### ${headings.currentState}\` snapshot near the top is recommended when useful, but no exact heading is required and its absence is valid.`,
        `An optional \`### ${headings.history}\` or turning-point map should contain major irreversible or causally useful transitions, not a turn-by-turn action log.`,
        'Link exact [[event document titles]] from turning points. For every event link, copy its complete title character-for-character from confirmedEvent, storyArcEvents, or another supplied event document; never paraphrase, shorten, translate, inflect, reconstruct, or invent the target text inside [[...]].',
        'If surrounding prose needs different wording, preserve the exact target with [[exact title|display text]]. Retrieve exact chronology, actions, targets, locations, and evidence from event documents rather than copying those details into character canon.',
        'Do not update a character document merely because the character participated in an event. Update it only for a durable lorebook fact or a major transition.',
        'Events own exact historical observations and actions. Other canon owns durable current state and rules; do not copy event sentences or paragraphs into it.',
        'Register recurring species, creatures, and monster kinds as creature canon. Split a variant only for durable distinct rules, not an individual encounter or cosmetic difference.',
        'Give a named sublocation its own location canon when it has independent persistent state, structure, people, secrets, or repeated scene use; keep only a short link summary in its parent.',
        'Do not create canon for every clue. Keep one compact investigation thread in other canon only when clues cross events or remain unresolved and affect future decisions.',
        'When new facts replace old ones, do not present both states as current. Preserve unrelated established facts.',
        'Preserve distinct still-valid operating facts, relationship direction, individual knowledge and lasting consequences when compressing. The selected wiki preset governs how confirmed completed or expired state is retired. Preserve unrelated durable state and unresolved obligations; silence alone never establishes completion or forgetting.',
        buildWikiCharacterSectionHeadingGuide(normalizedLanguage),
        'The selected wiki preset defines section organization and compression pressure. Keep durable facts distinct from transient observations without requiring separate sections. Do not create empty sections or templates, and do not infer shared knowledge, ownership, or relationship meaning from structured state values alone.',
    ].join('\n')
}
