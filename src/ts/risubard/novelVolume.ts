// How long the chat would be as a novel: prose only (no status windows,
// images, OOC turns or the user's own messages), counted the way web-novel
// platforms count, and turned into episodes and books by common averages.

import { isStoryView, type ChatMessageView } from './readerBoard'

/** Tags whose text is prose; any other tag is a widget and goes with its content. */
const PROSE_TAGS = new Set([
    'p', 'span', 'div', 'b', 'i', 'em', 'strong', 'u', 's', 'del', 'ins', 'br', 'font', 'small', 'big', 'q',
    'blockquote', 'center', 'mark', 'sup', 'sub', 'ruby', 'rb', 'rt', 'rp', 'a', 'ul', 'ol', 'li', 'hr',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'section', 'article', 'cite', 'abbr', 'wbr',
])

/**
 * The story text of one message: drops HTML comments, code blocks, tables,
 * images, macros, custom tags (status windows, thinking blocks) with their
 * content, `[TAG]...[/TAG]` blocks and lines with no letters, and keeps the
 * text of plain formatting tags.
 */
export function proseText(raw: string): string {
    let text = raw
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/```[\s\S]*?(?:```|$)/g, '')
        .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
        .replace(/\{\{[\s\S]*?\}\}/g, '')
        .replace(/\[([A-Za-z가-힣][^\]\n/]{0,40})\][\s\S]*?\[\/\1\]/g, '')
    // Paired non-prose tags go with their content, innermost first.
    const paired = /<([A-Za-z][\w-]*)\b[^<>]*>((?:(?!<\1\b)[\s\S])*?)<\/\1\s*>/g
    for (let guard = 0; guard < 50; guard++) {
        let changed = false
        text = text.replace(paired, (whole, name: string, inner: string) => {
            if (PROSE_TAGS.has(name.toLowerCase())) return whole
            changed = true
            return ''
        })
        if (!changed) break
    }
    text = text
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/?[A-Za-z][^<>]*>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&(?:lt|gt|amp|quot|#39);/g, (entity) => ({ '&lt;': '<', '&gt;': '>', '&amp;': '&', '&quot;': '"', '&#39;': "'" })[entity] ?? entity)
    return text
        .split('\n')
        // Table rows and lines of only rules or numbers are not prose; a line
        // like "……!" in quotes still is.
        .filter((line) => !/^\s*\|.*\|\s*$/.test(line) && !/^[\s\-–—─━═=_*~#+.:/\d%()[\]<>|·•]*$/u.test(line))
        .map((line) => line.replace(/[ \t]+/g, ' ').trim())
        .filter(Boolean)
        .join('\n')
}

export interface TextCount {
    /** Characters with spaces, without line breaks: the web-novel platform count. */
    withSpaces: number
    withoutSpaces: number
    /** Space-separated words (어절 for Korean). */
    words: number
    hangul: number
    latin: number
}

export function countText(text: string): TextCount {
    const lines = text.split('\n')
    return {
        withSpaces: lines.reduce((sum, line) => sum + [...line].length, 0),
        withoutSpaces: [...text.replace(/\s+/g, '')].length,
        words: text.split(/\s+/).filter(Boolean).length,
        hangul: (text.match(/[가-힣]/g) ?? []).length,
        latin: (text.match(/[A-Za-z]/g) ?? []).length,
    }
}

/** Common averages, labelled so the screen can say what each figure assumes. */
export const VOLUME_BASIS = {
    ko: {
        episode: 5_000,
        ebook: 125_000,
        paperback: 200_000,
        perMinute: 600,
        manuscriptPage: 200,
    },
    en: {
        episode: 3_000,
        ebook: 60_000,
        paperback: 90_000,
        perMinute: 250,
    },
} as const

export interface NovelVolume {
    /** Story turns counted. */
    turns: number
    count: TextCount
    language: 'ko' | 'en'
    /** The unit the estimates use: characters with spaces (ko) or words (en). */
    size: number
    perTurn: number
    episodes: number
    ebooks: number
    paperbacks: number
    readingMinutes: number
    /** 200-character manuscript pages (Korean only). */
    manuscriptPages?: number
}

export function measureNovel(views: readonly ChatMessageView[]): NovelVolume {
    const story = views.filter(isStoryView)
    const texts = story.map((view) => proseText(view.text)).filter(Boolean)
    const count = countText(texts.join('\n'))
    const language = count.latin > count.hangul * 3 ? 'en' : 'ko'
    const basis = VOLUME_BASIS[language]
    const size = language === 'ko' ? count.withSpaces : count.words
    return {
        turns: texts.length,
        count,
        language,
        size,
        perTurn: texts.length ? Math.round(size / texts.length) : 0,
        episodes: size / basis.episode,
        ebooks: size / basis.ebook,
        paperbacks: size / basis.paperback,
        readingMinutes: Math.round(size / basis.perMinute),
        ...(language === 'ko' ? { manuscriptPages: Math.ceil(count.withSpaces / VOLUME_BASIS.ko.manuscriptPage) } : {}),
    }
}
