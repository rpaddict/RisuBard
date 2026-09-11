import {
    buildWikiWritingLanguageGuard,
    normalizeWikiWritingLanguage,
    wikiWritingHeadings,
    type WikiWritingLanguage,
} from './wikiWritingLanguage'

export const RISUBARD_ANALYSIS_TOKEN_LIMIT_DEFAULT = 8_192
export const RISUBARD_ADDITIONAL_SEARCH_LIMIT_DEFAULT = 1
export const RISUBARD_CANONICAL_TARGET_LIMIT_DEFAULT = 8
export const RISUBARD_INQUIRY_TARGET_TOKEN_BUDGET_DEFAULT = 2_000
export const RISUBARD_INQUIRY_EVENT_TOKEN_BUDGET_DEFAULT = 2_000
export const RISUBARD_INQUIRY_SOURCE_TOKEN_BUDGET_DEFAULT = 2_000
export const RISUBARD_INQUIRY_MAXIMUM_TOKEN_BUDGET_DEFAULT = 6_000
export const RISUBARD_INQUIRY_TIMEOUT_MS_DEFAULT = 10_000
export const RISUBARD_HISTORICAL_SOURCE_MATCH_LIMIT_DEFAULT = 8
export const RISUBARD_CANONICAL_WRITING_STYLE_DEFAULT = 'concise' as const
export const RISUBARD_CANONICAL_CUSTOM_STYLE_MAX_LENGTH = 1_000

export type RisuBardCanonicalWritingStyle =
    | 'standard'
    | 'concise'
    | 'ultra-concise'
    | 'custom'

export interface RisuBardChatSettings {
    risuBardModelMode?: 'memory' | 'model'
    risuBardBardChanEnabled?: boolean
    risuBardBardChanModelMode?: 'memory' | 'model'
    showRequestStatus?: boolean
    risuBardInquiryTargetTokenBudget?: number
    risuBardInquiryEventTokenBudget?: number
    risuBardInquirySourceTokenBudget?: number
    risuBardInquiryMaximumTokenBudget?: number
    risuBardInquiryTimeoutMs?: number
    risuBardHistoricalSourceMatchLimit?: number
    risuBardAnalysisTokenLimit?: number
    risuBardAdditionalSearchLimit?: number
    risuBardCanonicalTargetLimit?: number
    risuBardRecentMessageCount?: number
    risuBardResponseMessageCount?: number
    risuBardResponseExcludeUserMessages?: boolean
    risuBardAnalysisExcludeUserMessages?: boolean
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
    risuBardModelMode: 'memory' | 'model'
    risuBardBardChanEnabled: boolean
    risuBardBardChanModelMode: 'memory' | 'model'
    showRequestStatus: boolean
    risuBardInquiryTargetTokenBudget: number
    risuBardInquiryEventTokenBudget: number
    risuBardInquirySourceTokenBudget: number
    risuBardInquiryMaximumTokenBudget: number
    risuBardInquiryTimeoutMs: number
    risuBardHistoricalSourceMatchLimit: number
    risuBardAnalysisTokenLimit: number
    risuBardAdditionalSearchLimit: number
    risuBardCanonicalTargetLimit: number
    risuBardRecentMessageCount: number
    risuBardResponseMessageCount: number
    risuBardResponseExcludeUserMessages: boolean
    risuBardAnalysisExcludeUserMessages: boolean
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

export function resolveRisuBardChatSettings(
    global: RisuBardChatSettings,
    chat?: RisuBardChatSettings,
): ResolvedRisuBardChatSettings {
    const value = <K extends keyof RisuBardChatSettings>(key: K) =>
        chat?.[key] ?? global[key]
    const inquiry = normalizeRisuBardInquiryTokenBudget(
        value('risuBardInquiryTargetTokenBudget'),
        value('risuBardInquiryMaximumTokenBudget'),
        value('risuBardInquiryEventTokenBudget'),
        value('risuBardInquirySourceTokenBudget'),
    )
    return {
        risuBardModelMode: value('risuBardModelMode') === 'model' ? 'model' : 'memory',
        risuBardBardChanEnabled: value('risuBardBardChanEnabled') === true,
        risuBardBardChanModelMode:
            value('risuBardBardChanModelMode') === 'model' ? 'model' : 'memory',
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
        risuBardAnalysisTokenLimit: normalizeRisuBardAnalysisTokenLimit(
            value('risuBardAnalysisTokenLimit')
        ),
        risuBardAdditionalSearchLimit: normalizeRisuBardAdditionalSearchLimit(
            value('risuBardAdditionalSearchLimit')
        ),
        risuBardCanonicalTargetLimit: normalizeRisuBardCanonicalTargetLimit(
            value('risuBardCanonicalTargetLimit')
        ),
        risuBardRecentMessageCount: boundedInteger(
            value('risuBardRecentMessageCount'), 12, 1
        ),
        risuBardResponseMessageCount: boundedInteger(
            value('risuBardResponseMessageCount'), 12, 1
        ),
        risuBardResponseExcludeUserMessages:
            value('risuBardResponseExcludeUserMessages') === true,
        risuBardAnalysisExcludeUserMessages:
            value('risuBardAnalysisExcludeUserMessages') === true,
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

export function normalizeRisuBardAnalysisTokenLimit(value: unknown): number {
    return boundedInteger(
        value,
        RISUBARD_ANALYSIS_TOKEN_LIMIT_DEFAULT,
        3_072
    )
}

export function normalizeRisuBardAdditionalSearchLimit(value: unknown): number {
    return boundedInteger(
        value,
        RISUBARD_ADDITIONAL_SEARCH_LIMIT_DEFAULT,
        0
    )
}

export function normalizeRisuBardCanonicalTargetLimit(value: unknown): number {
    return boundedInteger(
        value,
        RISUBARD_CANONICAL_TARGET_LIMIT_DEFAULT,
        1
    )
}

export function normalizeRisuBardHistoricalSourceMatchLimit(
    value: unknown
): number {
    return boundedInteger(
        value,
        RISUBARD_HISTORICAL_SOURCE_MATCH_LIMIT_DEFAULT,
        0,
        32
    )
}

export function normalizeRisuBardInquiryTokenBudget(
    target: unknown,
    maximum: unknown,
    events?: unknown,
    perSource?: unknown,
): { target: number; events: number; perSource: number; maximum: number } {
    const normalizedMaximum = boundedInteger(
        maximum,
        RISUBARD_INQUIRY_MAXIMUM_TOKEN_BUDGET_DEFAULT,
        256
    )
    return {
        target: boundedInteger(
            target,
            RISUBARD_INQUIRY_TARGET_TOKEN_BUDGET_DEFAULT,
            256,
            normalizedMaximum
        ),
        events: boundedInteger(
            events,
            RISUBARD_INQUIRY_EVENT_TOKEN_BUDGET_DEFAULT,
            256,
            normalizedMaximum,
        ),
        perSource: boundedInteger(
            perSource,
            RISUBARD_INQUIRY_SOURCE_TOKEN_BUDGET_DEFAULT,
            256,
            normalizedMaximum,
        ),
        maximum: normalizedMaximum,
    }
}

export function normalizeRisuBardCanonicalWritingStyle(
    value: unknown
): RisuBardCanonicalWritingStyle {
    return value === 'standard'
        || value === 'concise'
        || value === 'ultra-concise'
        || value === 'custom'
        ? value
        : RISUBARD_CANONICAL_WRITING_STYLE_DEFAULT
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
    return normalizedStyle === 'standard'
        ? 'Use natural, complete short sentences without unnecessary embellishment or repetition.'
        : normalizedStyle === 'ultra-concise'
            ? 'Use telegraphic sentences and stable field labels, one atomic fact per line. Explicitly preserve subjects, objects, negation, time and character knowledge boundaries. Do not invent abbreviations.'
            : normalizedStyle === 'custom' && normalizedCustom.length > 0
                ? `User style preference: ${normalizedCustom}`
                : 'Remove decorative prose and repeated facts. Use one sentence per fact. Preserve subjects, objects, negation, time and character knowledge boundaries. Do not invent abbreviations.'
}

export function normalizeRisuBardInquiryTimeoutMs(value: unknown): number {
    return boundedInteger(
        value,
        RISUBARD_INQUIRY_TIMEOUT_MS_DEFAULT,
        1,
        10_000,
    )
}

export function buildRisuBardEventWritingPolicy(
    style: unknown,
    customStyle: unknown,
    language: WikiWritingLanguage = 'ko'
): string {
    return [
        '## Canonical writing policy',
        resolveRisuBardWritingStyleInstruction(style, customStyle),
        'When compressing, do not invent action targets or locations, turn temporal order into causation, or cross character knowledge boundaries at the time of an event.',
        'Preserve observed puzzle elements, order, spatial layout, pairings, blanks, mechanism positions and attempt outcomes. Separate observations from inferred rules or solutions; retain unresolved clues as open continuity.',
        'Style affects expression only; it cannot change fact selection, evidence, structure or safety rules.',
        buildWikiWritingLanguageGuard(language),
    ].join('\n')
}

export function buildRisuBardCanonicalWritingPolicy(
    style: unknown,
    customStyle: unknown,
    language: WikiWritingLanguage = 'ko'
): string {
    const normalizedLanguage = normalizeWikiWritingLanguage(language)
    const headings = wikiWritingHeadings[normalizedLanguage]
    return [
        buildRisuBardEventWritingPolicy(style, customStyle, language),
        'Treat each character document as a dynamic lorebook entry: keep durable identity, role, traits, capabilities and rules, relationships, knowledge boundaries, goals, possessions, constraints, and open continuity that help the character operate in the next scene.',
        `A compact self-contained \`### ${headings.currentState}\` snapshot near the top is recommended when useful, but no exact heading is required and its absence is valid.`,
        `An optional \`### ${headings.history}\` or turning-point map should contain about 3-6 major irreversible or causally useful transitions, not a turn-by-turn action log.`,
        'Link exact [[event document titles]] from turning points. Retrieve exact chronology, actions, targets, locations, and evidence from event documents rather than copying those details into character canon.',
        'Do not update a character document merely because the character participated in an event. Update it only for a durable lorebook fact or a major transition.',
        'Events own exact historical observations and actions. Other canon owns durable current state and rules; do not copy event sentences or paragraphs into it.',
        'Register recurring species, creatures, and monster kinds as creature canon. Split a variant only for durable distinct rules, not an individual encounter or cosmetic difference.',
        'Give a named sublocation its own location canon when it has independent persistent state, structure, people, secrets, or repeated scene use; keep only a short link summary in its parent.',
        'Do not create canon for every clue. Keep one compact investigation thread in other canon only when clues cross events or remain unresolved and affect future decisions.',
        'When new facts replace old ones, do not present both states as current. Preserve unrelated established facts.',
    ].join('\n')
}
