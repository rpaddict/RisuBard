// Floating player position, stored as a ratio of the free space on each axis.
// A ratio of 1 keeps the player flush with the right or bottom gutter, so it stays
// anchored to that edge when it expands or the window resizes.

export const BGM_GUTTER = 12
export const BGM_DEFAULT_PLACEMENT = { xRatio: 1, yRatio: 0.82 }

export interface Size { width: number; height: number }

function clamp(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, value))
}

export function positionFromPlacement(placement: { xRatio: number; yRatio: number } | undefined, viewport: Size, size: Size) {
    const { xRatio, yRatio } = placement ?? BGM_DEFAULT_PLACEMENT
    const freeX = Math.max(0, viewport.width - size.width - BGM_GUTTER * 2)
    const freeY = Math.max(0, viewport.height - size.height - BGM_GUTTER * 2)
    return {
        left: Math.round(BGM_GUTTER + clamp(xRatio, 0, 1) * freeX),
        top: Math.round(BGM_GUTTER + clamp(yRatio, 0, 1) * freeY),
    }
}

export function placementFromPosition(left: number, top: number, viewport: Size, size: Size) {
    const freeX = viewport.width - size.width - BGM_GUTTER * 2
    const freeY = viewport.height - size.height - BGM_GUTTER * 2
    return {
        xRatio: freeX > 0 ? clamp((left - BGM_GUTTER) / freeX, 0, 1) : 1,
        yRatio: freeY > 0 ? clamp((top - BGM_GUTTER) / freeY, 0, 1) : 1,
    }
}

export const BGM_MIN_SIZE = { width: 280, height: 260 }

/** Clamps a dragged card size to the minimum and to the window minus its gutters. */
export function clampPlayerSize(size: Size, viewport: Size): Size {
    return {
        width: Math.round(clamp(size.width, BGM_MIN_SIZE.width, Math.max(BGM_MIN_SIZE.width, viewport.width - BGM_GUTTER * 2))),
        height: Math.round(clamp(size.height, BGM_MIN_SIZE.height, Math.max(BGM_MIN_SIZE.height, viewport.height - BGM_GUTTER * 2))),
    }
}

export function formatBgmTime(seconds: number): string {
    if (!Number.isFinite(seconds) || seconds < 0) seconds = 0
    const whole = Math.floor(seconds)
    const hours = Math.floor(whole / 3600)
    const minutes = Math.floor((whole % 3600) / 60)
    const rest = String(whole % 60).padStart(2, '0')
    return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}` : `${minutes}:${rest}`
}
