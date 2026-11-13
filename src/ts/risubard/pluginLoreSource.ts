import { sha256Digest } from '../secureCrypto'

/** Matching metadata for the immutable raw entry, independent of CBS-rendered text. */
export async function pluginLoreSource(scopeId: string, entry: { id?: string; content: string }) {
    const digest = await sha256Digest(new TextEncoder().encode(entry.content))
    return {
        scopeId,
        ...(entry.id ? { entryId: entry.id } : {}),
        contentHash: Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join(''),
    }
}
