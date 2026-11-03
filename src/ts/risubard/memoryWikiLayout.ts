export interface MemoryWikiDialogSize {
    width: number
    height: number
}

interface ViewportSize {
    width: number
    height: number
}

const DEFAULT_WIDTH = 1_216
const DEFAULT_HEIGHT = 864
const MIN_WIDTH = 320
const MIN_HEIGHT = 384
const VIEWPORT_GUTTER = 32
const DEFAULT_DOCK_RATIO = 0.62
const MIN_DOCK_RATIO = 0.3
const MAX_DOCK_RATIO = 0.75
const DEFAULT_WORKSPACE_HEIGHT = 500
const MIN_WORKSPACE_HEIGHT = 288
const MIN_COMMAND_HEIGHT = 220
const DEFAULT_AVAILABLE_WORKSPACE_HEIGHT = 10_000
const DEFAULT_TREE_HEIGHT = 176
const MIN_TREE_HEIGHT = 96
const MIN_EDITOR_HEIGHT = 192
const DEFAULT_TREE_WIDTH = 272
const MIN_TREE_WIDTH = 192
const MAX_TREE_WIDTH = 640
const MIN_EDITOR_WIDTH = 320

export function normalizeMemoryWikiDockRatio(value: unknown): number {
    const ratio = finiteOr(value, DEFAULT_DOCK_RATIO)
    return Math.round(clamp(ratio, MIN_DOCK_RATIO, MAX_DOCK_RATIO) * 100) / 100
}

export function normalizeMemoryWikiWorkspaceHeight(
    value: unknown,
    availableHeight = DEFAULT_AVAILABLE_WORKSPACE_HEIGHT
): number {
    const available = Math.max(
        MIN_WORKSPACE_HEIGHT + MIN_COMMAND_HEIGHT,
        Math.round(finiteOr(
            availableHeight,
            DEFAULT_AVAILABLE_WORKSPACE_HEIGHT
        ))
    )
    return clamp(
        Math.round(finiteOr(value, DEFAULT_WORKSPACE_HEIGHT)),
        MIN_WORKSPACE_HEIGHT,
        available - MIN_COMMAND_HEIGHT
    )
}

export function normalizeMemoryWikiTreeHeight(
    value: unknown,
    availableHeight = DEFAULT_AVAILABLE_WORKSPACE_HEIGHT
): number {
    const available = Math.max(
        MIN_TREE_HEIGHT + MIN_EDITOR_HEIGHT,
        Math.round(finiteOr(
            availableHeight,
            DEFAULT_AVAILABLE_WORKSPACE_HEIGHT
        ))
    )
    return clamp(
        Math.round(finiteOr(value, DEFAULT_TREE_HEIGHT)),
        MIN_TREE_HEIGHT,
        available - MIN_EDITOR_HEIGHT
    )
}

/** Desktop file tree width; the editor beside it keeps a readable minimum. */
export function normalizeMemoryWikiTreeWidth(
    value: unknown,
    availableWidth = DEFAULT_AVAILABLE_WORKSPACE_HEIGHT
): number {
    const available = Math.round(finiteOr(availableWidth, DEFAULT_AVAILABLE_WORKSPACE_HEIGHT))
    const maximum = Math.max(MIN_TREE_WIDTH, Math.min(MAX_TREE_WIDTH, available - MIN_EDITOR_WIDTH))
    return clamp(Math.round(finiteOr(value, DEFAULT_TREE_WIDTH)), MIN_TREE_WIDTH, maximum)
}

function finiteOr(value: unknown, fallback: number): number {
    return typeof value === 'number' && Number.isFinite(value)
        ? value
        : fallback
}

function clamp(value: number, minimum: number, maximum: number): number {
    return Math.min(maximum, Math.max(minimum, value))
}

export function normalizeMemoryWikiDialogSize(
    value: unknown,
    viewport: ViewportSize
): MemoryWikiDialogSize {
    const saved = typeof value === 'object' && value !== null
        ? value as Partial<MemoryWikiDialogSize>
        : {}
    const maximumWidth = Math.max(
        1,
        Math.round(finiteOr(viewport.width, DEFAULT_WIDTH))
        - VIEWPORT_GUTTER
    )
    const maximumHeight = Math.max(
        1,
        Math.round(finiteOr(viewport.height, DEFAULT_HEIGHT))
        - VIEWPORT_GUTTER
    )
    return {
        width: clamp(
            Math.round(finiteOr(saved.width, DEFAULT_WIDTH)),
            Math.min(MIN_WIDTH, maximumWidth),
            maximumWidth
        ),
        height: clamp(
            Math.round(finiteOr(saved.height, DEFAULT_HEIGHT)),
            Math.min(MIN_HEIGHT, maximumHeight),
            maximumHeight
        ),
    }
}
