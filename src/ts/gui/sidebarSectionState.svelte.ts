// Remembers which collapsible sidebar sections (chat list, toggle groups) are
// open, per bot. Layout is a per-browser convenience, so it lives in
// localStorage instead of the bot data: no save, no fingerprint pass.

export const SIDEBAR_SECTION_STATE_KEY = 'risubard:sidebar-sections:v1'
const MAX_BOTS = 300

type SectionStore = Record<string, Record<string, boolean>>

function readStore(): SectionStore {
    try {
        const value = JSON.parse(localStorage.getItem(SIDEBAR_SECTION_STATE_KEY) ?? '{}')
        return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
    } catch {
        return {}
    }
}

let store = $state<SectionStore>(readStore())

function botKey(botId: string | undefined | null): string {
    return botId || '__none__'
}

export function isSidebarSectionOpen(botId: string | undefined | null, section: string): boolean {
    return store[botKey(botId)]?.[section] === true
}

export function setSidebarSectionOpen(botId: string | undefined | null, section: string, open: boolean) {
    const key = botKey(botId)
    if (isSidebarSectionOpen(botId, section) === open) return
    const sections = { ...(store[key] ?? {}) }
    if (open) sections[section] = true
    else delete sections[section]
    // Re-insert so the most recently used bot sits last; drop the oldest past the cap.
    const next: SectionStore = { ...store }
    delete next[key]
    if (Object.keys(sections).length > 0) next[key] = sections
    const keys = Object.keys(next)
    for (const stale of keys.slice(0, Math.max(0, keys.length - MAX_BOTS))) delete next[stale]
    store = next
    try {
        localStorage.setItem(SIDEBAR_SECTION_STATE_KEY, JSON.stringify(next))
    } catch {
        // Section layout is a per-browser convenience.
    }
}

/** Test hook: reload from localStorage. */
export function reloadSidebarSectionState() {
    store = readStore()
}
