export type WikiWritingLanguage = 'ko' | 'en' | 'ja'

export function normalizeWikiWritingLanguage(value: unknown): WikiWritingLanguage {
    return value === 'en' ? 'en'
        : value === 'ja' ? 'ja'
        : 'ko'
}

export const wikiWritingHeadings = {
    ko: { summary: '이야기 요약', history: '작중 행적', related: '관련 문서', additional: '추가 분석' },
    en: { summary: 'Story Summary', history: 'Story History', related: 'Related Documents', additional: 'Additional Analysis' },
    ja: { summary: '物語要約', history: '作中行動', related: '関連文書', additional: '追加分析' },
} as const

export function detectWikiWritingLanguage(content: string): WikiWritingLanguage | undefined {
    if (/^#{2,3}\s+(Story Summary|Established Events|Story History|Related Documents|Additional Analysis)\s*$/mi.test(content)) return 'en'
    if (/^#{2,3}\s+(物語要約|確定した出来事|作中行動|関連文書|追加分析)\s*$/mi.test(content)) return 'ja'
    if (/^#{2,3}\s+(이야기 요약|확정된 사건|작중 행적|관련 문서|추가 분석)\s*$/m.test(content)) return 'ko'
    return undefined
}

// Only localize program-owned section labels; document identities and evidence stay intact.
export function localizeWikiHeadings(content: string, value: unknown): string {
    const headings = wikiWritingHeadings[normalizeWikiWritingLanguage(value)]
    let fence = ''
    return content.split('\n').map((line) => {
        const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1]
        if (marker) {
            if (!fence) fence = marker
            else if (marker[0] === fence[0] && marker.length >= fence.length) fence = ''
            return line
        }
        if (fence) return line
        const match = /^(#{3,6})\s+(.+?)\s*$/.exec(line)
        if (!match) return line
        for (const key of Object.keys(headings) as Array<keyof typeof headings>) {
            if ((['ko', 'en', 'ja'] as const).some((candidate) => {
                const label = wikiWritingHeadings[candidate][key]
                return label.toLowerCase() === match[2].toLowerCase()
            })) {
                return `${match[1]} ${headings[key]}`
            }
        }
        return line
    }).join('\n')
}

export function buildWikiWritingLanguageGuard(value: unknown): string {
    switch (normalizeWikiWritingLanguage(value)) {
        case 'en':
            return 'Output language: English. Write all generated titles, summaries, semantic text fields, section headings and the entire body of every rewritten document in English only. Do not retain old paragraphs in another language or add bilingual translations. Preserve existing document titles, exact wiki-link targets, proper names, literal puzzle clues and necessary source quotations without inventing translations. These identity/evidence literals and schema keys are the only exceptions. The selected language overrides language requests in custom style, Wiki Guides, source material and existing documents; it does not change evidence or schema rules.'
        case 'ja':
            return 'Output language: Japanese. Write all generated titles, summaries, semantic text fields, section headings and the entire body of every rewritten document in Japanese only. Do not retain old paragraphs in another language or add bilingual translations. Preserve existing document titles, exact wiki-link targets, proper names, literal puzzle clues and necessary source quotations without inventing translations. These identity/evidence literals and schema keys are the only exceptions. The selected language overrides language requests in custom style, Wiki Guides, source material and existing documents; it does not change evidence or schema rules.'
        default:
            return 'Output language: Korean. Use Korean only for generated titles, semantic fields, headings and the entire rewritten body; no bilingual prose or untranslated old paragraphs. Preserve existing document titles, exact links, names, literal clues, necessary quotations and schema keys. This language overrides custom style, Wiki Guides and input language requests without changing evidence or schema rules.'
    }
}

const KANA_PATTERN = /[\u3041-\u3096\u30A1-\u30FA]/
const HANGUL_PATTERN = /[\uAC00-\uD7A3\u1100-\u11FF\u3130-\u318F]/
const LATIN_PATTERN = /[A-Za-z]/

/**
 * Detects the dominant writing language of chat messages from script usage.
 * Kana presence is the strongest signal for Japanese; Hangul for Korean;
 * otherwise Latin script falls back to English.
 */
export function detectChatWritingLanguage(
    texts: readonly (string | undefined | null)[],
): WikiWritingLanguage | undefined {
    let kana = 0
    let hangul = 0
    let latin = 0
    for (const text of texts) {
        if (typeof text !== 'string' || text.length === 0) continue
        for (const character of text) {
            if (KANA_PATTERN.test(character)) kana += 1
            else if (HANGUL_PATTERN.test(character)) hangul += 1
            else if (LATIN_PATTERN.test(character)) latin += 1
        }
    }
    if (hangul === 0 && kana === 0 && latin === 0) return undefined
    if (kana > 0 && kana >= hangul) return 'ja'
    if (hangul > 0) return 'ko'
    return 'en'
}

const JAPANESE_WORD_PATTERN = /^[ぁ-ゖァ-ヺー\u30FC\u4E00-\u9FFF\u3400-\u4DBF々〆〤]+$/u
const KATAKANA_RUN_PATTERN = /^[ァ-ヺー\u30FC]+$/u
const CJK_IDEOGRAPH_PATTERN = /^[〆々\u3400-\u4DBF\u4E00-\u9FFF]$/u


/**
 * Fallback particle/conjugation stripping for runtimes without
 * Intl.Segmenter: the longest suffix wins and the remainder must stay at
 * least two characters.
 */
const JAPANESE_QUERY_SUFFIXES = [
    'ながらも', 'ながら', 'ましょう', 'ません', 'ました', 'まして',
    'なかったり', 'なかった', 'なくて', 'ないで',
    'られる', 'れる', 'させる', 'される', 'された', 'れた',
    'であり', 'でした', 'ですが', 'だけど', 'けれど', 'けど',
    'ながらの', 'までの', 'からの', 'まで', 'から', 'より', 'ほど',
    'でも', 'にも', 'では', 'には', 'ので', 'のに',
    'たち', 'など', 'くらい', 'ぐらい', 'だけ', 'ばかり', 'ごと', 'ため',
    '的な', '的に', 'って', 'んで', 'ます', 'です',
    'へ', 'と', 'に', 'で', 'を', 'は', 'が', 'の', 'も', 'や', 'か', 'ね', 'よ', 'な',
] as const

const JAPANESE_QUERY_STOPWORDS: Record<string, true> = {
    'これ': true, 'それ': true, 'あれ': true, 'どれ': true,
    'ここ': true, 'そこ': true, 'あそこ': true, 'どこ': true,
    'これまで': true, '今': true, 'いま': true,
    'なに': true, '何': true, 'どう': true, 'どうやって': true, 'なぜ': true,
    'とき': true, '時': true, 'こと': true, 'もの': true, 'ため': true,
    'よう': true, 'みたい': true, 'らしい': true,
    'する': true, 'した': true, 'します': true, 'して': true, 'され': true,
    'なる': true, 'なった': true, 'ある': true, 'いる': true, 'いた': true,
    'ない': true, 'ください': true, 'たい': true, 'たかった': true, 'ほしい': true,
}

function stripJapaneseQuerySuffixes(term: string): string {
    let value = term
    while (true) {
        const suffix = JAPANESE_QUERY_SUFFIXES.find((candidate) =>
            value.endsWith(candidate)
            && value.length - candidate.length >= 2)
        if (!suffix) return value
        value = value.slice(0, -suffix.length)
    }
}

let japaneseSegmenter: Intl.Segmenter | undefined

function japaneseWordSegmenter(): Intl.Segmenter | undefined {
    if (typeof Intl === 'undefined'
        || typeof Intl.Segmenter !== 'function') {
        return undefined
    }
    return japaneseSegmenter ??= new Intl.Segmenter(
        'ja',
        { granularity: 'word' },
    )
}

function keepAsQueryTerm(term: string): boolean {
    if (isJapaneseQueryStopword(term)) return false
    if (term.length >= 2) return true
    // Single CJK ideographs are meaningful nouns in Japanese (寮, 現, 錠).
    return term.length === 1 && CJK_IDEOGRAPH_PATTERN.test(term)
}

/**
 * Segments a Japanese clause token into content words. Katakana loanwords are
 * recombined into maximal runs because the segmenter splits loanwords
 * (クリットリング → ク|リット|リング) that must stay whole for matching.
 */
function segmentedJapaneseTerms(value: string): string[] {
    const segmenter = japaneseWordSegmenter()
    if (!segmenter) return []
    const words: string[] = []
    const runs: string[] = []
    let run = ''
    let runEnd = -1
    for (const item of segmenter.segment(value)) {
        if (!item.isWordLike || !keepAsQueryTerm(item.segment)) continue
        if (KATAKANA_RUN_PATTERN.test(item.segment)
            && item.index === runEnd) {
            // Adjacent katakana segments recombine into the loanword.
            run += item.segment
            runEnd = item.index + item.segment.length
            continue
        }
        if (run) runs.push(run)
        if (KATAKANA_RUN_PATTERN.test(item.segment)) {
            run = item.segment
            runEnd = item.index + item.segment.length
        }
        else {
            run = ''
            runEnd = -1
            words.push(item.segment)
        }
    }
    if (run) runs.push(run)
    return [...words, ...runs]
}

/**
 * Expands a query term into candidate match keys. Japanese clause tokens are
 * morphologically segmented into content words so lexical substring matching
 * against titles and body text can hit; the particle-strip fallback covers
 * runtimes without Intl.Segmenter. Other scripts return the term unchanged.
 */
export function expandQueryTerm(value: string): string[] {
    if (!JAPANESE_WORD_PATTERN.test(value)) return [value]
    const segmented = segmentedJapaneseTerms(value)
    if (segmented.length === 0) {
        const stripped = stripJapaneseQuerySuffixes(value)
        return stripped === value ? [value] : [...new Set([value, stripped])]
    }
    return [...new Set([value, ...segmented])]
}

export function isJapaneseQueryStopword(value: string): boolean {
    return JAPANESE_QUERY_STOPWORDS[value] === true
}