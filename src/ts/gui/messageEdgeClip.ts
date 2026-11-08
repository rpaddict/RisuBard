// Rounds message cards where the chat viewport cuts them.
// A card taller than the screen otherwise shows only straight sides mid-scroll: its own
// rounded corners sit off screen. When a skin sets the `message-clip-radius` token, a card
// that crosses the top of the chat area or the top of the fixed composer is clipped there
// with rounded corners, as if the viewport were a rounded window onto it.
// Only cards that cross an edge get a clip-path, so the cost stays with one or two cards.

const CARD_SELECTOR = '[data-skin-part="message-card"]'
const COMPOSER_SELECTOR = '[data-skin-part="composer"]'
const TOKEN = '--risu-message-clip-radius'
// Room kept outside the card so its own shadows and keylines survive the clip.
const SPILL = 32

function lengthToPx(value: string): number {
    const match = value.trim().match(/^(-?\d*\.?\d+)(px|rem|em)?$/)
    if (!match) return 0
    const amount = Number(match[1])
    if (match[2] === 'rem' || match[2] === 'em') {
        return amount * (parseFloat(getComputedStyle(document.documentElement).fontSize) || 16)
    }
    return amount
}

/** clip-path for a card of width w and height h cut at `top` and/or `bottom` (card coordinates). */
export function edgeClipPath(w: number, h: number, radius: number, top: number | null, bottom: number | null): string {
    const t = top ?? -SPILL
    const b = bottom ?? h + SPILL
    const r = Math.max(0, Math.min(radius, w / 2, (b - t) / 2))
    const n = (value: number) => Math.round(value * 10) / 10
    let d = top === null
        ? `M ${-SPILL} ${n(t)} L ${n(w + SPILL)} ${n(t)}`
        : `M ${-SPILL} ${n(t + r)} L 0 ${n(t + r)} A ${n(r)} ${n(r)} 0 0 1 ${n(r)} ${n(t)} L ${n(w - r)} ${n(t)} A ${n(r)} ${n(r)} 0 0 1 ${n(w)} ${n(t + r)} L ${n(w + SPILL)} ${n(t + r)}`
    d += bottom === null
        ? ` L ${n(w + SPILL)} ${n(b)} L ${-SPILL} ${n(b)} Z`
        : ` L ${n(w + SPILL)} ${n(b - r)} L ${n(w)} ${n(b - r)} A ${n(r)} ${n(r)} 0 0 1 ${n(w - r)} ${n(b)} L ${n(r)} ${n(b)} A ${n(r)} ${n(r)} 0 0 1 0 ${n(b - r)} L ${-SPILL} ${n(b - r)} Z`
    return `path("${d}")`
}

export function messageEdgeClip(node: HTMLElement) {
    let frame = 0
    let needScan = false
    let radius = 0
    const visible = new Set<HTMLElement>()
    const clipped = new Set<HTMLElement>()

    const clear = (card: HTMLElement) => {
        card.style.removeProperty('clip-path')
        clipped.delete(card)
    }

    const intersection = new IntersectionObserver((entries) => {
        for (const entry of entries) {
            const card = entry.target as HTMLElement
            if (entry.isIntersecting) visible.add(card)
            else {
                visible.delete(card)
                if (clipped.has(card)) clear(card)
            }
        }
        schedule()
    }, { root: node })

    const observeCards = () => {
        if (!radius) return
        for (const card of node.querySelectorAll<HTMLElement>(CARD_SELECTOR)) intersection.observe(card)
    }

    const update = () => {
        frame = 0
        if (!radius) return
        if (needScan) {
            needScan = false
            observeCards()
        }
        const view = node.getBoundingClientRect()
        const composer = node.querySelector<HTMLElement>(COMPOSER_SELECTOR)
        const bottomEdge = composer && getComputedStyle(composer).position === 'sticky'
            ? composer.getBoundingClientRect().top
            : view.bottom
        for (const card of visible) {
            if (!card.isConnected) {
                visible.delete(card)
                clipped.delete(card)
                continue
            }
            const box = card.getBoundingClientRect()
            // Cards drawn square (phones) stay square at the edge too.
            const own = parseFloat(getComputedStyle(card).borderTopLeftRadius) || 0
            const top = box.top < view.top && box.bottom > view.top ? view.top - box.top : null
            const bottom = box.top < bottomEdge && box.bottom > bottomEdge ? bottomEdge - box.top : null
            if (own <= 0 || (top === null && bottom === null)) {
                if (clipped.has(card)) clear(card)
                continue
            }
            card.style.setProperty('clip-path', edgeClipPath(box.width, box.height, radius, top, bottom))
            clipped.add(card)
        }
    }

    function schedule() {
        if (!frame && radius) frame = requestAnimationFrame(update)
    }

    const readToken = () => {
        const next = lengthToPx(getComputedStyle(document.documentElement).getPropertyValue(TOKEN))
        if (next === radius) return
        radius = next
        if (radius) {
            observeCards()
            schedule()
        } else {
            for (const card of [...clipped]) clear(card)
            visible.clear()
            intersection.disconnect()
        }
    }

    const resize = new ResizeObserver(schedule)
    resize.observe(node)
    // Rescan once per frame: streaming replies mutate the list many times a second.
    const cards = new MutationObserver(() => {
        needScan = true
        schedule()
    })
    cards.observe(node, { childList: true, subtree: true })
    // Skins switch by changing the root's data attribute and the skin style element.
    const skin = new MutationObserver(readToken)
    skin.observe(document.documentElement, { attributes: true, attributeFilter: ['data-risu-skin', 'style'] })
    skin.observe(document.head, { childList: true, subtree: true, characterData: true })
    node.addEventListener('scroll', schedule, { passive: true })
    readToken()

    return {
        destroy() {
            if (frame) cancelAnimationFrame(frame)
            node.removeEventListener('scroll', schedule)
            intersection.disconnect()
            resize.disconnect()
            cards.disconnect()
            skin.disconnect()
            for (const card of [...clipped]) clear(card)
        },
    }
}
