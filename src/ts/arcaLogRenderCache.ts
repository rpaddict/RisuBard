// Rendered message bodies outlive the dialog so a stopped or accidentally closed
// export resumes where it left off instead of rendering the whole chat again.

export interface ArcaLogBodyOptions {
    imageWidthPercent: number
    paragraphSpacingPercent: number
    palette: string
}

export interface ArcaLogCachedBody {
    bodyHtml: string
    plainText: string
}

interface CacheEntry extends ArcaLogCachedBody {
    data: string
    role: string
}

const MAX_ENTRIES = 3000
const bodies = new Map<string, CacheEntry>()

function cacheKey(chatId: string, sourceIndex: number, options: ArcaLogBodyOptions): string {
    return [chatId, sourceIndex, options.imageWidthPercent, options.paragraphSpacingPercent, options.palette].join('\u0000')
}

export function getArcaLogCachedBody(
    chatId: string,
    sourceIndex: number,
    role: string,
    data: string,
    options: ArcaLogBodyOptions,
): ArcaLogCachedBody | undefined {
    const entry = bodies.get(cacheKey(chatId, sourceIndex, options))
    // Edits, rerolls, and deletions that shift indexes all change the source text.
    if (!entry || entry.data !== data || entry.role !== role) return undefined
    return entry
}

export function setArcaLogCachedBody(
    chatId: string,
    sourceIndex: number,
    role: string,
    data: string,
    options: ArcaLogBodyOptions,
    body: ArcaLogCachedBody,
): void {
    const key = cacheKey(chatId, sourceIndex, options)
    bodies.delete(key)
    bodies.set(key, { ...body, data, role })
    while (bodies.size > MAX_ENTRIES) {
        const oldest = bodies.keys().next().value
        if (oldest === undefined) break
        bodies.delete(oldest)
    }
}

export function clearArcaLogRenderCache(): void {
    bodies.clear()
}

// Character emotion images repeat across messages; fetch and encode each URL once per export.
export function createArcaImageLoader(load: (url: string) => Promise<string>): (url: string) => Promise<string> {
    const pending = new Map<string, Promise<string>>()
    return (url) => {
        let result = pending.get(url)
        if (!result) {
            result = load(url)
            // A failed load should not poison later attempts in the same export.
            result.catch(() => pending.delete(url))
            pending.set(url, result)
        }
        return result
    }
}
