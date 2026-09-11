import { describe, expect, test } from 'vitest'
import {
    RISUBARD_ANALYSIS_TOKEN_LIMIT_DEFAULT,
    RISUBARD_ADDITIONAL_SEARCH_LIMIT_DEFAULT,
    RISUBARD_CANONICAL_TARGET_LIMIT_DEFAULT,
    RISUBARD_CANONICAL_WRITING_STYLE_DEFAULT,
    RISUBARD_INQUIRY_MAXIMUM_TOKEN_BUDGET_DEFAULT,
    RISUBARD_INQUIRY_EVENT_TOKEN_BUDGET_DEFAULT,
    RISUBARD_INQUIRY_SOURCE_TOKEN_BUDGET_DEFAULT,
    RISUBARD_INQUIRY_TARGET_TOKEN_BUDGET_DEFAULT,
    RISUBARD_INQUIRY_TIMEOUT_MS_DEFAULT,
    RISUBARD_HISTORICAL_SOURCE_MATCH_LIMIT_DEFAULT,
    buildRisuBardCanonicalWritingPolicy,
    buildRisuBardEventWritingPolicy,
    normalizeRisuBardAnalysisTokenLimit,
    normalizeRisuBardAdditionalSearchLimit,
    normalizeRisuBardCanonicalCustomStyle,
    normalizeRisuBardCanonicalTargetLimit,
    normalizeRisuBardCanonicalWritingStyle,
    normalizeRisuBardInquiryTokenBudget,
    normalizeRisuBardInquiryTimeoutMs,
    normalizeRisuBardHistoricalSourceMatchLimit,
    resolveRisuBardChatSettings,
} from './risuBardSettings'

describe('RisuBard analysis settings', () => {
    test('defaults wiki language to Korean and resolves a chat language independently', () => {
        expect(resolveRisuBardChatSettings({}).risuBardWikiWritingLanguage).toBe('ko')
        expect(resolveRisuBardChatSettings({ risuBardWikiWritingLanguage: 'en' })
            .risuBardWikiWritingLanguage).toBe('en')
        expect(resolveRisuBardChatSettings({ risuBardWikiWritingLanguage: 'en' }, {
            risuBardWikiWritingLanguage: 'ko',
        }).risuBardWikiWritingLanguage).toBe('ko')
    })

    test.each(['ko', 'en', 'ja', 'zh-Hans', 'zh-Hant'] as const)(
        'uses one canonical policy with a locale-specific output contract for %s', (locale) => {
            const event = buildRisuBardEventWritingPolicy('concise', '', locale)
            const canon = buildRisuBardCanonicalWritingPolicy('concise', '', locale)
            expect(event).toContain(`(${locale})`)
            expect(canon).toContain('dynamic lorebook')
            expect(canon).toContain('recommended')
            expect(canon).toContain('3-6')
            expect(canon).toContain('entire body')
            expect(canon).toContain('existing document titles')
            expect(event).toContain('When compressing')
        }
    )

    test('uses conservative defaults for missing and invalid values', () => {
        expect(RISUBARD_ANALYSIS_TOKEN_LIMIT_DEFAULT).toBe(8_192)
        expect(normalizeRisuBardAnalysisTokenLimit(undefined))
            .toBe(RISUBARD_ANALYSIS_TOKEN_LIMIT_DEFAULT)
        expect(normalizeRisuBardAdditionalSearchLimit('2'))
            .toBe(RISUBARD_ADDITIONAL_SEARCH_LIMIT_DEFAULT)
        expect(normalizeRisuBardCanonicalTargetLimit(Number.NaN))
            .toBe(RISUBARD_CANONICAL_TARGET_LIMIT_DEFAULT)
    })

    test('retains minimums without imposing arbitrary setting maxima', () => {
        expect(normalizeRisuBardAnalysisTokenLimit(12)).toBe(3_072)
        expect(normalizeRisuBardAnalysisTokenLimit(99_999)).toBe(99_999)
        expect(normalizeRisuBardAdditionalSearchLimit(-3)).toBe(0)
        expect(normalizeRisuBardAdditionalSearchLimit(99)).toBe(99)
        expect(normalizeRisuBardCanonicalTargetLimit(0)).toBe(1)
        expect(normalizeRisuBardCanonicalTargetLimit(99)).toBe(99)
        expect(normalizeRisuBardAnalysisTokenLimit(Infinity)).toBe(RISUBARD_ANALYSIS_TOKEN_LIMIT_DEFAULT)
        expect(normalizeRisuBardAnalysisTokenLimit(Number.MAX_SAFE_INTEGER + 1)).toBe(RISUBARD_ANALYSIS_TOKEN_LIMIT_DEFAULT)
    })

    test('normalizes configurable inquiry map, event, source, and maximum budgets', () => {
        expect(normalizeRisuBardInquiryTokenBudget(undefined, undefined, undefined, undefined))
            .toEqual({
                target: RISUBARD_INQUIRY_TARGET_TOKEN_BUDGET_DEFAULT,
                events: RISUBARD_INQUIRY_EVENT_TOKEN_BUDGET_DEFAULT,
                perSource: RISUBARD_INQUIRY_SOURCE_TOKEN_BUDGET_DEFAULT,
                maximum: RISUBARD_INQUIRY_MAXIMUM_TOKEN_BUDGET_DEFAULT,
            })
        expect(normalizeRisuBardInquiryTokenBudget(8_000, 4_000, 9_000, 5_000))
            .toEqual({ target: 4_000, events: 4_000, perSource: 4_000, maximum: 4_000 })
        expect(normalizeRisuBardInquiryTokenBudget(1, 99_999, 1, 1))
            .toEqual({ target: 256, events: 256, perSource: 256, maximum: 99_999 })
    })

    test('normalizes the historical source candidate limit', () => {
        expect(normalizeRisuBardHistoricalSourceMatchLimit(undefined))
            .toBe(RISUBARD_HISTORICAL_SOURCE_MATCH_LIMIT_DEFAULT)
        expect(normalizeRisuBardHistoricalSourceMatchLimit(-1)).toBe(0)
        expect(normalizeRisuBardHistoricalSourceMatchLimit(99)).toBe(32)
    })

    test('normalizes the configurable inquiry timeout to the supported range', () => {
        expect(normalizeRisuBardInquiryTimeoutMs(undefined))
            .toBe(RISUBARD_INQUIRY_TIMEOUT_MS_DEFAULT)
        expect(normalizeRisuBardInquiryTimeoutMs(0)).toBe(1)
        expect(normalizeRisuBardInquiryTimeoutMs(8_000)).toBe(8_000)
        expect(normalizeRisuBardInquiryTimeoutMs(20_000)).toBe(10_000)
        expect(resolveRisuBardChatSettings({}, {
            risuBardInquiryTimeoutMs: 7_500,
        }).risuBardInquiryTimeoutMs).toBe(7_500)
    })

    test('keeps configured message windows above one hundred', () => {
        const settings = resolveRisuBardChatSettings({
            risuBardRecentMessageCount: 250, risuBardResponseMessageCount: 300,
        })
        expect(settings.risuBardRecentMessageCount).toBe(250)
        expect(settings.risuBardResponseMessageCount).toBe(300)
    })

    test('normalizes the shared canonical writing policy', () => {
        expect(normalizeRisuBardCanonicalWritingStyle(undefined))
            .toBe(RISUBARD_CANONICAL_WRITING_STYLE_DEFAULT)
        expect(normalizeRisuBardCanonicalWritingStyle('standard')).toBe('standard')
        expect(normalizeRisuBardCanonicalWritingStyle('ultra-concise')).toBe('ultra-concise')
        expect(normalizeRisuBardCanonicalWritingStyle('invalid')).toBe('concise')
        expect(normalizeRisuBardCanonicalCustomStyle(`  ${'가'.repeat(1_200)}  `))
            .toBe('가'.repeat(1_000))
    })

    test('keeps custom style text without weakening the shared memory rules', () => {
        expect(buildRisuBardCanonicalWritingPolicy('concise', '')).toContain(
            'Use one sentence per fact'
        )
        const custom = buildRisuBardCanonicalWritingPolicy(
            'custom',
            '항목마다 짧은 명사형으로 끝낸다.'
        )
        expect(custom).toContain('Output locale: Korean (ko)')
        expect(custom).toContain('항목마다 짧은 명사형으로 끝낸다.')
        expect(custom).toContain('cannot change fact selection, evidence, structure or safety rules')
        expect(custom).not.toContain('undefined')
    })

    test('keeps character canon compact while preserving detailed event evidence', () => {
        const policy = buildRisuBardCanonicalWritingPolicy('concise', '')

        expect(policy).toContain('dynamic lorebook')
        expect(policy).toContain('major irreversible or causally useful transitions')
        expect(policy).toContain('not a turn-by-turn action log')
        expect(policy).toContain('event documents')
        expect(policy).toContain('do not present both states as current')
        expect(policy).toContain('### 현재 상태')
        expect(policy).toContain('### 작중 행적')
        expect(policy).toContain('3-6')
        expect(policy).toContain('[[event document titles]]')
        expect(policy).toContain('do not invent action targets or locations')
        expect(policy).toContain('turn temporal order into causation')
        expect(policy).toContain('character knowledge boundaries')
        expect(policy).toContain('puzzle')
        expect(policy).toContain('spatial layout')
        expect(policy).toContain('observations from inferred rules')
        expect(policy).toContain('species, creatures, and monster kinds')
        expect(policy).toContain('named sublocation')
        expect(policy).toContain('investigation thread')
        expect(policy).toContain('do not copy event sentences or paragraphs')
    })

    test('resolves current-chat overrides over normalized global defaults', () => {
        const resolved = resolveRisuBardChatSettings({
            risuBardModelMode: 'memory',
            risuBardRecentMessageCount: 12,
            risuBardResponseMessageCount: 20,
            showRequestStatus: true,
        }, {
            risuBardModelMode: 'model',
            risuBardRecentMessageCount: 7,
            risuBardResponseExcludeUserMessages: true,
            showRequestStatus: false,
        })

        expect(resolved.risuBardModelMode).toBe('model')
        expect(resolved.risuBardRecentMessageCount).toBe(7)
        expect(resolved.risuBardResponseMessageCount).toBe(20)
        expect(resolved.risuBardResponseExcludeUserMessages).toBe(true)
        expect(resolved.showRequestStatus).toBe(false)
    })

    test('resolves per-chat BARDCHAT context selections with token-saving defaults', () => {
        const defaults = resolveRisuBardChatSettings({})
        expect(defaults).toMatchObject({
            bardChatIncludeWiki: true,
            bardChatIncludeChat: false,
            bardChatIncludeSystemPrompt: false,
            bardChatIncludeCharacterDescription: false,
            bardChatIncludePersona: false,
            bardChatIncludeCharacterLorebook: false,
            bardChatIncludeModuleLorebook: false,
        })

        const resolved = resolveRisuBardChatSettings({
            bardChatIncludeSystemPrompt: true,
            bardChatIncludeCharacterLorebook: true,
        }, {
            bardChatIncludeSystemPrompt: false,
            bardChatIncludeChat: true,
        })
        expect(resolved).toMatchObject({
            bardChatIncludeWiki: true,
            bardChatIncludeChat: true,
            bardChatIncludeSystemPrompt: false,
            bardChatIncludeCharacterLorebook: true,
        })
    })
})
