import { describe, expect, it } from 'vitest'
import {
    buildWikiWritingLanguageGuard,
    detectChatWritingLanguage,
    detectWikiWritingLanguage,
    expandQueryTerm,
    isJapaneseQueryStopword,
    localizeWikiHeadings,
    normalizeWikiWritingLanguage,
    wikiWritingHeadings,
} from './wikiWritingLanguage'

describe('normalizeWikiWritingLanguage', () => {
    it('accepts ko, en and ja', () => {
        expect(normalizeWikiWritingLanguage('ko')).toBe('ko')
        expect(normalizeWikiWritingLanguage('en')).toBe('en')
        expect(normalizeWikiWritingLanguage('ja')).toBe('ja')
    })

    it('falls back to ko for unknown values', () => {
        expect(normalizeWikiWritingLanguage('fr')).toBe('ko')
        expect(normalizeWikiWritingLanguage(undefined)).toBe('ko')
    })
})

describe('wikiWritingHeadings', () => {
    it('provides ja headings', () => {
        expect(wikiWritingHeadings.ja.summary).toBe('物語要約')
        expect(wikiWritingHeadings.ja.history).toBe('作中行動')
        expect(wikiWritingHeadings.ja.related).toBe('関連文書')
        expect(wikiWritingHeadings.ja.additional).toBe('追加分析')
    })
})

describe('detectWikiWritingLanguage', () => {
    it('detects Japanese headings', () => {
        expect(detectWikiWritingLanguage('### 物語要約\n\n- 사건')).toBe('ja')
        expect(detectWikiWritingLanguage('## 제목\n\n### 関連文書')).toBe('ja')
    })

    it('keeps detecting ko and en headings', () => {
        expect(detectWikiWritingLanguage('### 이야기 요약')).toBe('ko')
        expect(detectWikiWritingLanguage('### Story Summary')).toBe('en')
        expect(detectWikiWritingLanguage('no headings')).toBeUndefined()
    })
})

describe('localizeWikiHeadings', () => {
    it('rewrites program-owned headings across all supported languages', () => {
        const korean = '### 이야기 요약\n본문\n\n### 작중 행적\n본문2'
        expect(localizeWikiHeadings(korean, 'ja'))
            .toBe('### 物語要約\n본문\n\n### 作中行動\n본문2')
        expect(localizeWikiHeadings(korean, 'en'))
            .toBe('### Story Summary\n본문\n\n### Story History\n본문2')
        expect(localizeWikiHeadings('### 物語要約', 'ko')).toBe('### 이야기 요약')
        expect(localizeWikiHeadings('### Story Summary', 'ja')).toBe('### 物語要約')
    })

    it('leaves fenced code blocks untouched', () => {
        const content = '```\n### 이야기 요약\n```'
        expect(localizeWikiHeadings(content, 'ja')).toBe(content)
    })
})

describe('buildWikiWritingLanguageGuard', () => {
    it('requests Japanese output for ja', () => {
        const guard = buildWikiWritingLanguageGuard('ja')
        expect(guard).toContain('Output language: Japanese')
        expect(guard).toContain('Preserve existing document titles')
    })

    it('preserves ko and en guards', () => {
        expect(buildWikiWritingLanguageGuard('ko')).toContain('Output language: Korean')
        expect(buildWikiWritingLanguageGuard('en')).toContain('Output language: English')
    })
})

describe('detectChatWritingLanguage', () => {
    it('detects Japanese from kana', () => {
        expect(detectChatWritingLanguage(['こんにちは、元気ですか。'])).toBe('ja')
        expect(detectChatWritingLanguage(['彼は東京に向かった。', '何それ？'])).toBe('ja')
    })

    it('detects Korean from Hangul', () => {
        expect(detectChatWritingLanguage(['안녕, 잘 지냈어?'])).toBe('ko')
    })

    it('prefers Hangul when both scripts appear in mixed text', () => {
        expect(detectChatWritingLanguage(['안녕하세요 です'])).toBe('ko')
    })

    it('falls back to English for Latin script', () => {
        expect(detectChatWritingLanguage(['Hello, how are you?'])).toBe('en')
    })

    it('returns undefined for empty or non-text input', () => {
        expect(detectChatWritingLanguage([])).toBeUndefined()
        expect(detectChatWritingLanguage(['', undefined, '12345 !!!'])).toBeUndefined()
    })
})


describe('expandQueryTerm', () => {
    it('segments Japanese clause queries into content words', () => {
        expect(expandQueryTerm('シロの現在の状態は'))
            .toEqual(['シロの現在の状態は', '現在', '状態', 'シロ'])
        expect(expandQueryTerm('寮に行く'))
            .toEqual(['寮に行く', '寮', '行く'])
    })

    it('recombines katakana loanword fragments into contiguous runs', () => {
        expect(expandQueryTerm('クリットリング'))
            .toEqual(['クリットリング', 'リットリング'])
    })

    it('keeps single CJK ideograph content words', () => {
        expect(expandQueryTerm('寮')).toEqual(['寮'])
    })

    it('returns non-Japanese terms unchanged', () => {
        expect(expandQueryTerm('관련 문서')).toEqual(['관련 문서'])
        expect(expandQueryTerm('Story Summary')).toEqual(['Story Summary'])
    })
    it('strips particles when Intl.Segmenter is unavailable', () => {
        const originalSegmenter = Intl.Segmenter
        Object.defineProperty(Intl, 'Segmenter', {
            value: undefined,
            configurable: true,
        })
        try {
            expect(expandQueryTerm('猫のために'))
                .toEqual(['猫のために', '猫の'])
            expect(expandQueryTerm('ライラックの花'))
                .toEqual(['ライラックの花'])
        }
        finally {
            Object.defineProperty(Intl, 'Segmenter', {
                value: originalSegmenter,
                configurable: true,
            })
        }
    })
})

describe('isJapaneseQueryStopword', () => {
    it('flags bare clause-tail particles', () => {
        expect(isJapaneseQueryStopword('どう')).toBe(true)
        expect(isJapaneseQueryStopword('シロ')).toBe(false)
    })
})