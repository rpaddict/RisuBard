const MIN_CORRECTION_PX = 1.25
const READING_BLOCK_SELECTOR = 'p, li, pre, blockquote, h1, h2, h3, h4, h5, h6, img, video, iframe, table, hr'

export interface ChatScrollAnchor {
    contextKey: string
    messageIndex: number
    messageCount: number
    offsetTop: number
    atLatest: boolean
    // Keep the scroll end in view instead of a message. Used after a new
    // message arrives at the latest position, while its layout is still settling.
    followEnd?: boolean
    readingBlock?: {
        element: HTMLElement
        path: number[]
        tagName: string
        identity: string
        offsetTop: number
    }
}

export type ChatScrollRestoreResult =
    | 'restored'
    | 'stable'
    | 'context-changed'
    | 'missing'
    | 'new-message'

function getIndexedMessages(container: HTMLElement) {
    return Array.from(container.querySelectorAll<HTMLElement>('[data-chat-index]'))
        .map((element) => ({
            element,
            index: Number(element.dataset.chatIndex),
            rect: element.getBoundingClientRect(),
        }))
        // The pinned first message renders as -1. A chat that has only it still needs an anchor,
        // or a reload that swaps its content leaves the reverse scroller at the message end.
        .filter((message) => Number.isInteger(message.index) && message.index >= -1)
}

function blockIdentity(element: HTMLElement) {
    return element.getAttribute('src') ?? (element.textContent ?? '').trim().slice(0, 64)
}

function captureReadingBlock(message: HTMLElement, viewport: DOMRect): ChatScrollAnchor['readingBlock'] {
    const content = message.querySelector('.chattext')
    if (!content) return undefined
    let selected: HTMLElement | undefined
    let bestScore = Number.POSITIVE_INFINITY
    for (const element of content.querySelectorAll<HTMLElement>(READING_BLOCK_SELECTOR)) {
        const rect = element.getBoundingClientRect()
        if (rect.height <= 0 || rect.bottom <= viewport.top + 1 || rect.top >= viewport.bottom - 1) continue
        const score = rect.top <= viewport.top + 1
            ? Math.abs(rect.top - viewport.top - 1) * 0.001
            : rect.top - viewport.top + 10
        // Prefer the inner paragraph/media over a surrounding quote or list item.
        if (score < bestScore || (score === bestScore && selected?.contains(element))) {
            selected = element
            bestScore = score
        }
    }
    if (!selected) return undefined
    const path: number[] = []
    for (let element: Element = selected; element !== message && element.parentElement; element = element.parentElement) {
        path.unshift(Array.prototype.indexOf.call(element.parentElement.children, element))
    }
    return {
        element: selected,
        path,
        tagName: selected.tagName,
        identity: blockIdentity(selected),
        offsetTop: selected.getBoundingClientRect().top - viewport.top,
    }
}

export function captureChatScrollAnchor(
    container: HTMLElement,
    contextKey: string,
    messageCount: number,
): ChatScrollAnchor | null {
    if (!contextKey || messageCount < 0) return null

    const containerRect = container.getBoundingClientRect()
    const viewportTop = containerRect.top + 1
    const viewportBottom = containerRect.bottom - 1
    const messages = getIndexedMessages(container)
    let selected: (typeof messages)[number] | null = null
    let bestScore = Number.POSITIVE_INFINITY

    for (const message of messages) {
        if (message.rect.bottom <= viewportTop || message.rect.top >= viewportBottom) continue
        const crossesTop = message.rect.top <= viewportTop && message.rect.bottom > viewportTop
        const score = crossesTop
            ? Math.abs(message.rect.top - viewportTop) * 0.001
            : Math.abs(message.rect.top - viewportTop) + 10
        if (score < bestScore) {
            selected = message
            bestScore = score
        }
    }

    if (!selected) return null
    const newest = messages.reduce<(typeof messages)[number] | null>(
        (current, message) => !current || message.index > current.index ? message : current,
        null,
    )

    const readingBlock = captureReadingBlock(selected.element, containerRect)
    return {
        contextKey,
        messageIndex: selected.index,
        messageCount,
        offsetTop: selected.rect.top - containerRect.top,
        atLatest: Boolean(newest && newest.rect.top <= containerRect.bottom + 100),
        ...(readingBlock ? { readingBlock } : {}),
    }
}

export function createChatScrollEndAnchor(contextKey: string, messageCount: number): ChatScrollAnchor {
    return {
        contextKey,
        messageIndex: Math.max(0, messageCount - 1),
        messageCount,
        offsetTop: 0,
        atLatest: true,
        followEnd: true,
    }
}

export function restoreChatScrollAnchor(
    container: HTMLElement,
    anchor: ChatScrollAnchor,
    contextKey: string,
    messageCount: number,
): ChatScrollRestoreResult {
    if (anchor.contextKey !== contextKey) return 'context-changed'
    if (anchor.followEnd) {
        // A column-reverse chat ends at scrollTop 0.
        const end = getComputedStyle(container).flexDirection === 'column-reverse'
            ? 0
            : container.scrollHeight - container.clientHeight
        if (Math.abs(container.scrollTop - end) < MIN_CORRECTION_PX) return 'stable'
        container.scrollTo({ top: end, behavior: 'instant' })
        return 'restored'
    }
    if (anchor.messageIndex >= messageCount) return 'missing'
    if (anchor.atLatest && messageCount > anchor.messageCount) return 'new-message'

    const target = container.querySelector<HTMLElement>(
        `[data-chat-index="${anchor.messageIndex}"]`,
    )
    if (!target) return 'missing'

    let readingTarget = target
    let offsetTop = anchor.offsetTop
    if (anchor.readingBlock) {
        const block = anchor.readingBlock
        let candidate: Element | undefined = block.element
        if (!target.contains(candidate)) {
            candidate = target
            for (const index of block.path) candidate = candidate?.children[index]
            // A removed block can leave another paragraph at the same path.
            if (candidate?.tagName !== block.tagName
                || blockIdentity(candidate as HTMLElement) !== block.identity) candidate = undefined
        }
        if (candidate && candidate.getBoundingClientRect().height > 0) {
            readingTarget = candidate as HTMLElement
            offsetTop = block.offsetTop
        }
    }
    const currentOffset = readingTarget.getBoundingClientRect().top
        - container.getBoundingClientRect().top
    const delta = currentOffset - offsetTop
    if (Math.abs(delta) < MIN_CORRECTION_PX) return 'stable'

    container.scrollTo({
        top: container.scrollTop + delta,
        behavior: 'instant',
    })
    return 'restored'
}
