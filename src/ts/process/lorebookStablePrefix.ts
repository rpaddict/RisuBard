// Experimental "always-active lore before chat history" placement.
//
// Prompt caching only covers an unchanged prefix. Presets usually put the
// lorebook block after the chat history, where keyword-matched entries change
// every turn. Always-active entries sit in the same block although their text
// is the same on every turn, so they are billed at full price each time.
// With the option on, those entries move in front of the chat history and the
// keyword-matched ones stay where the preset put them.

interface StableLoreCandidate {
    pos: string
    inject: unknown
    sourceIdentity?: { entry?: { alwaysActive?: boolean, mode?: string } }
}

/** An always-active entry that goes to the plain lorebook block (no position, depth or injection decorator). */
export function isStableAlwaysActiveLore(lore: StableLoreCandidate): boolean {
    const entry = lore.sourceIdentity?.entry
    return lore.pos === ''
        && lore.inject === null
        && entry?.alwaysActive === true
        // A child entry gets alwaysActive set while it mirrors its parent's activation.
        && entry.mode !== 'child'
}

/**
 * Template index in front of which always-active lore is emitted, or -1 to
 * leave everything in the lorebook block.
 *
 * Only a lorebook block that comes after the first chat block is split; one
 * that already precedes the chat history is in the cacheable prefix as is.
 * The entries go right after the last persona or description block before the
 * chat, so they do not land under a header the preset wrote for the chat.
 */
export function resolveStableLoreIndex(template: readonly { type: string }[] | null | undefined): number {
    if (!template) return -1
    const firstChat = template.findIndex((card) => card.type === 'chat')
    const firstLorebook = template.findIndex((card) => card.type === 'lorebook')
    if (firstChat < 0 || firstLorebook < firstChat) return -1
    for (let i = firstChat - 1; i >= 0; i--) {
        if (template[i].type === 'persona' || template[i].type === 'description') return i + 1
    }
    return firstChat
}
