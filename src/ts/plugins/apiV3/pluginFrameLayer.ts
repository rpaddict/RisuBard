// Fullscreen plugin frames sit above every app dialog tier (z-40 to z-[60]) so
// the plugin UI covers the app. While an app dialog that a plugin call waits on
// is open, those frames drop below the dialog tiers and come back afterwards;
// otherwise the dialog renders behind the plugin and cannot be answered.
export const PLUGIN_FULLSCREEN_Z_INDEX = '1000'
export const PLUGIN_FRAME_BEHIND_DIALOG_Z_INDEX = '30'

const fullscreenFrames = new Set<HTMLElement>()
let openDialogs = 0

function currentZIndex(): string {
    return openDialogs > 0
        ? PLUGIN_FRAME_BEHIND_DIALOG_Z_INDEX
        : PLUGIN_FULLSCREEN_Z_INDEX
}

function applyZIndex() {
    for (const frame of fullscreenFrames) {
        if (!frame.isConnected) {
            fullscreenFrames.delete(frame)
            continue
        }
        frame.style.zIndex = currentZIndex()
    }
}

/** Hides the last shown fullscreen plugin frame, as its hideContainer() would. */
export function hideTopFullscreenPluginFrame(): boolean {
    const top = [...fullscreenFrames]
        .filter((frame) => frame.isConnected && frame.style.display !== 'none')
        .at(-1)
    if (!top) return false
    top.style.setProperty('display', 'none', 'important')
    fullscreenFrames.delete(top)
    return true
}

export function registerFullscreenPluginFrame(frame: HTMLElement) {
    fullscreenFrames.add(frame)
    frame.style.zIndex = currentZIndex()
}

export function unregisterFullscreenPluginFrame(frame: HTMLElement) {
    fullscreenFrames.delete(frame)
}

export async function withPluginFramesBehindDialog<T>(
    showDialog: () => Promise<T>
): Promise<T> {
    openDialogs++
    applyZIndex()
    try {
        return await showDialog()
    }
    finally {
        openDialogs--
        applyZIndex()
    }
}
