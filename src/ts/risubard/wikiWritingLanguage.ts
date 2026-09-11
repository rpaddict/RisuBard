import localeDefinitions from './wikiWritingLocales.json'

interface WikiWritingLocaleDefinition {
    label: string
    languageName: string
    indexTitle: string
    headings: {
        summary: string
        history: string
        related: string
        additional: string
        currentState: string
    }
    storyArc: {
        title: string
        overview: string
        turningPoints: string
        openThreads: string
    }
    legacyHeadings?: readonly string[]
}

export const wikiWritingLocales = localeDefinitions satisfies Record<
    string,
    WikiWritingLocaleDefinition
>

export type WikiWritingLanguage = keyof typeof wikiWritingLocales
export type WikiHeadingKey = keyof WikiWritingLocaleDefinition['headings']

const LEGACY_STORY_ARC_TITLES = ['스토리 아크 지도', 'Story Arc Map'] as const

export const wikiWritingLanguageOptions = Object.entries(wikiWritingLocales)
    .map(([value, locale]) => ({
        value: value as WikiWritingLanguage,
        label: locale.label,
    }))

export const wikiWritingHeadings = Object.fromEntries(
    Object.entries(wikiWritingLocales).map(([key, locale]) => [key, locale.headings])
) as { [K in WikiWritingLanguage]: typeof wikiWritingLocales[K]['headings'] }

export function normalizeWikiWritingLanguage(value: unknown): WikiWritingLanguage {
    return typeof value === 'string'
        && Object.prototype.hasOwnProperty.call(wikiWritingLocales, value)
        ? value as WikiWritingLanguage
        : 'ko'
}

function headingsByKey(): Record<WikiHeadingKey, string[]> {
    const result: Record<WikiHeadingKey, string[]> = {
        summary: [], history: [], related: [], additional: [], currentState: [],
    }
    for (const locale of Object.values(wikiWritingLocales)) {
        const definition: WikiWritingLocaleDefinition = locale
        for (const key of Object.keys(definition.headings) as WikiHeadingKey[]) {
            result[key].push(definition.headings[key])
        }
        result.summary.push(...(definition.legacyHeadings ?? []))
    }
    return result
}

const localizedHeadingLabels = headingsByKey()

function normalizedHeading(value: string): string {
    return value.normalize('NFKC').toLocaleLowerCase().trim()
}

// Every program-owned label for a section, across all writing languages.
export function isWikiHeadingLabel(key: WikiHeadingKey, value: unknown): boolean {
    if (typeof value !== 'string') return false
    const normalized = normalizedHeading(value)
    return localizedHeadingLabels[key].some((label) =>
        normalizedHeading(label) === normalized)
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Regex alternation for section-label matching; tolerates whitespace variants.
export function wikiHeadingLabelsPattern(key: WikiHeadingKey): string {
    return localizedHeadingLabels[key]
        .map((label) => escapeRegExp(label).replace(/\\?\s+/g, '\\s*'))
        .join('|')
}

const storyArcTitles: readonly string[] = [
    ...Object.values(wikiWritingLocales).map((locale) => locale.storyArc.title),
    ...LEGACY_STORY_ARC_TITLES,
]

export function isStoryArcTitle(value: unknown): boolean {
    if (typeof value !== 'string') return false
    const normalized = normalizedHeading(value)
    return storyArcTitles.some((title) => normalizedHeading(title) === normalized)
}

export function detectWikiWritingLanguage(content: string): WikiWritingLanguage | undefined {
    const headings = content.split('\n').map((line) =>
        /^#{2,3}\s+(.+?)\s*$/.exec(line)?.[1].toLocaleLowerCase()
    ).filter((heading): heading is string => heading !== undefined)
    for (const locale of Object.keys(wikiWritingLocales) as WikiWritingLanguage[]) {
        const definition: WikiWritingLocaleDefinition = wikiWritingLocales[locale]
        const labels = [
            ...Object.values(definition.headings),
            ...(definition.legacyHeadings ?? []),
        ].map((label) => label.toLocaleLowerCase())
        if (headings.some((heading) => labels.includes(heading))) return locale
    }
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
        const key = (Object.keys(localizedHeadingLabels) as WikiHeadingKey[])
            .find((candidate) => localizedHeadingLabels[candidate].some((label) =>
                label.toLocaleLowerCase() === match[2].toLocaleLowerCase()))
        return key ? `${match[1]} ${headings[key]}` : line
    }).join('\n')
}

export function buildWikiWritingLanguageGuard(value: unknown): string {
    const locale = normalizeWikiWritingLanguage(value)
    const { languageName } = wikiWritingLocales[locale]
    return `Output locale: ${languageName} (${locale}). Write all generated titles, summaries, semantic text fields, section headings and the entire body of every rewritten document exclusively in ${languageName}. Do not retain old paragraphs in another language or add bilingual translations. Preserve existing document titles, exact wiki-link targets, proper names, literal puzzle clues and necessary source quotations without inventing translations. These identity and evidence literals and schema keys are the only exceptions. The selected locale overrides language requests in custom style, Wiki Guides, source material and existing documents; it does not change evidence or schema rules.`
}
