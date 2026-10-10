import { describe, expect, test } from 'vitest'
import { resolveRisuBardChatSettings } from './risuBardSettings'
import { countActiveMemoryTurns, measureActiveMemoryCharacters, resolveDynamicMemoryBudget, dynamicMemoryGrowth, resolveDynamicMemorySettings } from './dynamicMemoryBudget'

describe('bounded dynamic memory growth', () => {
    test.each([
        ['economy', 0.0475, 0.09, 0.25],
        ['balanced', 0.095, 0.18, 0.5],
        ['recall', 0.19, 0.36, 1],
    ] as const)('%s grows immediately and reaches a finite plateau', (mode, at50, at100, plateau) => {
        expect(dynamicMemoryGrowth(mode, 0)).toBe(0)
        expect(dynamicMemoryGrowth(mode, 1000)).toBeGreaterThan(0)
        expect(dynamicMemoryGrowth(mode, 50_000)).toBeCloseTo(at50)
        expect(dynamicMemoryGrowth(mode, 100_000)).toBeCloseTo(at100)
        expect(at100 - at50).toBeLessThan(at50)
        expect(dynamicMemoryGrowth(mode, 500_000)).toBe(plateau)
        expect(dynamicMemoryGrowth(mode, 5_000_000)).toBe(plateau)
        expect(dynamicMemoryGrowth(mode, Number.MAX_VALUE)).toBe(plateau)
        expect(dynamicMemoryGrowth(mode, 500_000) - dynamicMemoryGrowth(mode, 499_000)).toBeLessThan(0.00001)
    })
    test('off and invalid lengths do not add a budget', () => {
        expect(dynamicMemoryGrowth('off', 500_000)).toBe(0)
        for (const length of [-1, NaN, Infinity]) expect(dynamicMemoryGrowth('balanced', length)).toBe(0)
    })
})

describe('dynamic memory budgets', () => {
    test('grows from the start by text length, with diminishing marginal growth', () => {
        const settings = resolveRisuBardChatSettings({ risuBardDynamicMemoryMode: 'balanced' })
        const budget = (characters: number) => resolveDynamicMemoryBudget(settings, characters).maximum
        expect(budget(0)).toBe(7500)
        expect(budget(1000)).toBeGreaterThan(7500)
        expect(budget(50_000)).toBe(8213)
        expect(budget(100_000)).toBe(8850)
        expect(budget(100_000) - budget(50_000)).toBeLessThan(budget(50_000) - budget(0))
    })
    test('defaults to the standard economy policy and leaves saved baseline untouched across mode changes', () => {
        expect(resolveRisuBardChatSettings({}).risuBardDynamicMemoryMode).toBe('economy')
        expect(resolveRisuBardChatSettings({ risuBardDynamicMemoryMode: 'off' }).risuBardDynamicMemoryMode).toBe('off')
        const settings = resolveRisuBardChatSettings({ risuBardDynamicMemoryMode: 'off' })
        expect(resolveDynamicMemoryBudget(settings, 10000)).toMatchObject({ target: 4000, events: 3000, perSource: 2000, maximum: 7500, sourceLimit: 8, candidateLimit: 64, directSeedLimit: 32 })
        const grown = resolveDynamicMemoryBudget({ ...settings, risuBardDynamicMemoryMode: 'balanced' }, 700_000)
        expect(grown.maximum).toBe(11250)
        expect(grown.target).toBe(6000)
        expect(grown.events).toBe(4500)
        expect(grown.analysis).toBe(12288)
        expect(grown.perSource).toBe(2000)
        expect(settings.risuBardInquiryMaximumTokenBudget).toBe(7500)
    })
    test.each(['economy', 'balanced', 'recall'] as const)('bounds %s growth and preserves explicitly disabled historical recall', mode => {
        const settings = resolveRisuBardChatSettings({ risuBardDynamicMemoryMode: mode, risuBardDynamicMemoryMaximumTokens: 9000, risuBardHistoricalSourceMatchLimit: 0 })
        const small = resolveDynamicMemoryBudget(settings, 0)
        const large = resolveDynamicMemoryBudget(settings, 10000000)
        expect(small.maximum).toBe(7500)
        expect(large.maximum).toBe(9000)
        expect(large.target).toBeLessThanOrEqual(9000)
        expect(large.events).toBeLessThanOrEqual(9000)
        expect(large.sourceLimit).toBe(0)
        expect(large.candidateLimit).toBeLessThanOrEqual(256)
        expect(large.directSeedLimit).toBeLessThanOrEqual(128)
        expect(large.candidateLimit).toBe(small.candidateLimit)
        expect(large.directSeedLimit).toBe(small.directSeedLimit)
    })
    test('a growth cap below baseline never shrinks existing budgets', () => {
        const settings = resolveRisuBardChatSettings({ risuBardDynamicMemoryMode: 'recall', risuBardDynamicMemoryMaximumTokens: 1000 })
        expect(resolveDynamicMemoryBudget(settings, Infinity)).toMatchObject({ maximum: 7500, target: 4000, events: 3000, perSource: 2000, characterCount: 0 })
    })
    test('only the four requested token settings grow; no stored value is overwritten', () => {
        const settings = resolveRisuBardChatSettings({ risuBardDynamicMemoryMode: 'balanced' })
        const effective = resolveDynamicMemorySettings(settings, [{ role: 'char', data: '가'.repeat(500_000) }])
        expect(effective).toEqual({ ...settings,
            risuBardInquiryTargetTokenBudget: 6000,
            risuBardInquiryEventTokenBudget: 4500,
            risuBardInquiryMaximumTokenBudget: 11250,
            risuBardAnalysisTokenLimit: 12288,
        })
        expect(settings.risuBardAnalysisTokenLimit).toBe(8192)
        expect(resolveDynamicMemoryBudget(settings, 50_000)).toMatchObject({ analysis: 8970, sourceLimit: 8, candidateLimit: 64, directSeedLimit: 32 })
        expect(resolveDynamicMemoryBudget(settings, 5_000_000)).toMatchObject({ target: 6000, events: 4500, maximum: 11250, analysis: 12288 })
    })
    test('effective settings skip the transcript when disabled and honor OOC exclusions when enabled', () => {
        const messages = [{ role: 'char', get data(): string { throw new Error('no scan when off') } }]
        const off = resolveRisuBardChatSettings({ risuBardDynamicMemoryMode: 'off' })
        expect(resolveDynamicMemorySettings(off, messages)).toBe(off)
        const settings = resolveRisuBardChatSettings({ risuBardDynamicMemoryMode: 'balanced' })
        expect(resolveDynamicMemorySettings(settings, [{ role: 'char', data: '<!-- OOC_turn -->' + '가'.repeat(500_000) }])).toEqual(settings)
    })
    test('counts active AI metadata only after the latest branch boundary', () => {
        const message = (role: string, extra = {}) => ({ role, get data(): string { throw new Error('must not read text') }, ...extra })
        expect(countActiveMemoryTurns([message('char'), message('user', { disabled: 'allBefore' }), message('char'), message('user'), message('char', { disabled: true }), message('char', { isComment: true }), message('char')])).toBe(2)
    })
    test('measures only active AI bodies after the boundary and respects ignored OOC turns', () => {
        const messages = [
            { role: 'char', data: 'old'.repeat(1000) },
            { role: 'user', data: '', disabled: 'allBefore' as const },
            { role: 'char', data: '가'.repeat(1000) },
            { role: 'user', data: '나'.repeat(5000) },
            { role: 'char', data: 'excluded', disabled: true as const },
            { role: 'char', data: 'comment', isComment: true },
            { role: 'char', data: '<!-- OOC_turn --> excluded' },
        ]
        expect(measureActiveMemoryCharacters(messages, true)).toBe(1000)
        expect(measureActiveMemoryCharacters(messages, false)).toBe(1026)
        expect(measureActiveMemoryCharacters([{ role: 'char', data: '가'.repeat(50_000) }])).toBe(
            measureActiveMemoryCharacters(Array.from({ length: 50 }, () => ({ role: 'char', data: '가'.repeat(1000) }))),
        )
    })
    test('resolves global, chat and pinned policies without leaking chat fields through pins', () => {
        const global = { risuBardDynamicMemoryMode: 'economy' as const, risuBardDynamicMemoryMaximumTokens: 9000 }
        const chat = { risuBardDynamicMemoryMode: 'balanced' as const, risuBardDynamicMemoryMaximumTokens: 15000 }
        expect(resolveRisuBardChatSettings(global, chat).risuBardDynamicMemoryMode).toBe('balanced')
        expect(resolveRisuBardChatSettings(global, chat, { risuBardDynamicMemoryMode: 'recall' })).toMatchObject({ risuBardDynamicMemoryMode: 'recall', risuBardDynamicMemoryMaximumTokens: 9000 })
    })
})
