import type { WikiWritingLanguage } from '../risubard/wikiWritingLanguage'

export type BardLoreAnalysisLanguage = 'follow-bardwiki' | 'en' | 'ko' | 'ja' | 'bilingual'
export type ResolvedBardLoreAnalysisLanguage = Exclude<BardLoreAnalysisLanguage, 'follow-bardwiki'>

const supportedLanguages = new Set<BardLoreAnalysisLanguage>([
    'follow-bardwiki',
    'en',
    'ko',
    'ja',
    'bilingual',
])

export function normalizeBardLoreAnalysisLanguage(value: unknown): BardLoreAnalysisLanguage {
    return supportedLanguages.has(value as BardLoreAnalysisLanguage)
        ? value as BardLoreAnalysisLanguage
        : 'follow-bardwiki'
}

export function resolveBardLoreAnalysisLanguage(
    value: unknown,
    wikiLanguage: WikiWritingLanguage,
): ResolvedBardLoreAnalysisLanguage {
    const normalized = normalizeBardLoreAnalysisLanguage(value)
    return normalized === 'follow-bardwiki' ? wikiLanguage : normalized
}

export function buildBardLoreAnalysisLanguageInstruction(
    value: unknown,
    wikiLanguage: WikiWritingLanguage,
): string {
    switch (resolveBardLoreAnalysisLanguage(value, wikiLanguage)) {
        case 'en':
            return 'Write all human-readable retrieval metadata in English: aliases, tags, summaries, facet values and aliases, atom metadata, and link relation text. Preserve exact source names and useful source-language spellings as aliases. Keep schema enum values and canonical facet keys unchanged.'
        case 'ko':
            return '사람이 읽고 검색하는 모든 메타데이터를 한국어로 작성하세요: 별칭, 태그, 요약, 패싯 값과 별칭, 원자 항목 메타데이터, 링크 관계 문구. 원문의 정확한 고유명과 유용한 원어 표기는 별칭으로 보존하세요. 스키마 열거값과 정규 패싯 키는 바꾸지 마세요.'
        case 'ja':
            return '人が読んで検索するすべてのメタデータを日本語で書いてください: 別名、タグ、要約、ファセット値と別名、アトム項目メタデータ、リンク関係の文。原文の正確な固有名と有用な原語表記は別名として保存してください。スキーマの列挙値と正規ファセットキーは変更しないでください。'
        case 'bilingual':
            return 'Write human-readable retrieval metadata in both English and Korean. Pair natural English and Korean terms in aliases, tags, facet aliases, atom metadata, and link relation text without duplicates. Write each summary as a Korean sentence followed by its English counterpart. Preserve exact source names. Keep schema enum values and canonical facet keys unchanged.'
    }
}
