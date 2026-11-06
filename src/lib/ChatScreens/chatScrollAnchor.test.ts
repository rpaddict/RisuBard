import { describe, expect, test, vi } from 'vitest'
import {
    captureChatScrollAnchor,
    createChatScrollEndAnchor,
    restoreChatScrollAnchor,
} from './chatScrollAnchor'

function rect(top: number, bottom: number): DOMRect {
    return {
        top,
        bottom,
        left: 0,
        right: 600,
        width: 600,
        height: bottom - top,
        x: 0,
        y: top,
        toJSON: () => ({}),
    } as DOMRect
}

function createChatLayout(
    messageRects: Array<{ index: number; top: number; bottom: number }>,
    scrollTop = -200,
) {
    const container = document.createElement('div')
    Object.defineProperty(container, 'scrollTop', { value: scrollTop, writable: true })
    container.getBoundingClientRect = () => rect(0, 500)
    container.scrollTo = vi.fn()

    const elements = new Map<number, HTMLElement>()
    for (const messageRect of messageRects) {
        const element = document.createElement('article')
        element.dataset.chatIndex = String(messageRect.index)
        element.getBoundingClientRect = () => rect(messageRect.top, messageRect.bottom)
        container.append(element)
        elements.set(messageRect.index, element)
    }

    return { container, elements }
}

describe('chat scroll anchor', () => {
    function longMessage() {
        const layout = createChatLayout([{ index: 0, top: -400, bottom: 900 }])
        const message = layout.elements.get(0)!
        message.innerHTML = '<div class="chattext"><blockquote><p>Earlier text</p><img src="scene.png"><p>Reading here</p><p>Streaming tail</p></blockquote></div>'
        const blocks = message.querySelectorAll<HTMLElement>('p, img')
        blocks[0].getBoundingClientRect = () => rect(-400, -300)
        blocks[1].getBoundingClientRect = () => rect(-300, -20)
        blocks[2].getBoundingClientRect = () => rect(-10, 150)
        blocks[3].getBoundingClientRect = () => rect(160, 900)
        message.querySelector('blockquote')!.getBoundingClientRect = () => rect(-400, 900)
        return { ...layout, message, reading: blocks[2], tail: blocks[3] }
    }

    test('keeps the visible paragraph in place when an image above it grows inside the same message', () => {
        const { container, reading } = longMessage()
        const anchor = captureChatScrollAnchor(container, 'chat', 1)!
        reading.getBoundingClientRect = () => rect(90, 250)

        expect(restoreChatScrollAnchor(container, anchor, 'chat', 1)).toBe('restored')
        expect(container.scrollTo).toHaveBeenCalledWith({ top: -100, behavior: 'instant' })
    })

    test('does not correct scrolling when only the streaming tail grows', () => {
        const { container, message, tail } = longMessage()
        const anchor = captureChatScrollAnchor(container, 'chat', 1)!
        message.getBoundingClientRect = () => rect(-400, 1200)
        tail.getBoundingClientRect = () => rect(160, 1200)

        expect(restoreChatScrollAnchor(container, anchor, 'chat', 1)).toBe('stable')
        expect(container.scrollTo).not.toHaveBeenCalled()
    })

    test('finds the same paragraph after HTML replacement', () => {
        const { container, reading } = longMessage()
        const anchor = captureChatScrollAnchor(container, 'chat', 1)!
        const replacement = reading.cloneNode(true) as HTMLElement
        replacement.getBoundingClientRect = () => rect(50, 210)
        reading.replaceWith(replacement)

        expect(restoreChatScrollAnchor(container, anchor, 'chat', 1)).toBe('restored')
        expect(container.scrollTo).toHaveBeenCalledWith({ top: -140, behavior: 'instant' })
    })

    test('retains the actual reading paragraph when content is inserted before it', () => {
        const { container, reading } = longMessage()
        const anchor = captureChatScrollAnchor(container, 'chat', 1)!
        const inserted = document.createElement('p')
        inserted.textContent = 'New content above the reader'
        reading.before(inserted)
        reading.getBoundingClientRect = () => rect(30, 190)

        expect(restoreChatScrollAnchor(container, anchor, 'chat', 1)).toBe('restored')
        expect(container.scrollTo).toHaveBeenCalledWith({ top: -160, behavior: 'instant' })
    })

    test('anchors a visible image instead of its surrounding growing blockquote', () => {
        const { container, message, reading } = longMessage()
        const image = message.querySelector('img')!
        image.getBoundingClientRect = () => rect(-20, 280)
        reading.getBoundingClientRect = () => rect(290, 450)
        const anchor = captureChatScrollAnchor(container, 'chat', 1)!
        image.getBoundingClientRect = () => rect(20, 320)

        expect(restoreChatScrollAnchor(container, anchor, 'chat', 1)).toBe('restored')
        expect(container.scrollTo).toHaveBeenCalledWith({ top: -160, behavior: 'instant' })
    })

    test('falls back to the message when the reading paragraph was removed', () => {
        const { container, message, reading } = longMessage()
        const anchor = captureChatScrollAnchor(container, 'chat', 1)!
        reading.remove()
        message.getBoundingClientRect = () => rect(-350, 700)

        expect(restoreChatScrollAnchor(container, anchor, 'chat', 1)).toBe('restored')
        expect(container.scrollTo).toHaveBeenCalledWith({ top: -150, behavior: 'instant' })
    })

    test('does not reuse a paragraph anchor in another chat or across a new latest reply', () => {
        const { container, reading } = longMessage()
        const anchor = captureChatScrollAnchor(container, 'chat', 1)!
        reading.getBoundingClientRect = () => rect(90, 250)

        expect(restoreChatScrollAnchor(container, anchor, 'other-chat', 1)).toBe('context-changed')
        expect(restoreChatScrollAnchor(container, anchor, 'chat', 2)).toBe('new-message')
        expect(container.scrollTo).not.toHaveBeenCalled()
    })

    test('captures the message crossing the viewport top and its relative offset', () => {
        const { container } = createChatLayout([
            { index: 4, top: -80, bottom: 100 },
            { index: 5, top: 110, bottom: 310 },
            { index: 9, top: 900, bottom: 1100 },
        ])

        expect(captureChatScrollAnchor(container, 'character/chat', 10)).toEqual({
            contextKey: 'character/chat',
            messageIndex: 4,
            messageCount: 10,
            offsetTop: -80,
            atLatest: false,
        })
    })

    test('restores an anchor by correcting only the chat container scroll position', () => {
        const { container, elements } = createChatLayout([
            { index: 4, top: -30, bottom: 150 },
            { index: 9, top: 900, bottom: 1100 },
        ])
        elements.get(4)!.getBoundingClientRect = () => rect(-30, 150)

        const result = restoreChatScrollAnchor(container, {
            contextKey: 'character/chat',
            messageIndex: 4,
            messageCount: 10,
            offsetTop: -80,
            atLatest: false,
        }, 'character/chat', 10)

        expect(result).toBe('restored')
        expect(container.scrollTo).toHaveBeenCalledWith({ top: -150, behavior: 'instant' })
    })

    test('leaves appended-reply auto-scroll in control when the latest message was visible', () => {
        const { container } = createChatLayout([
            { index: 8, top: -70, bottom: 300 },
            { index: 9, top: 320, bottom: 560 },
        ])
        const anchor = captureChatScrollAnchor(container, 'character/chat', 10)

        expect(anchor?.atLatest).toBe(true)
        expect(restoreChatScrollAnchor(container, anchor!, 'character/chat', 11)).toBe('new-message')
        expect(container.scrollTo).not.toHaveBeenCalled()
    })

    test('keeps the top of a first message whose content a reload replaced', () => {
        // A chat with only its first message: the start picker fits the viewport (scrollTop 0 is the end).
        const { container, elements } = createChatLayout([{ index: -1, top: 120, bottom: 460 }], 0)
        const message = elements.get(-1)!
        message.innerHTML = '<div class="chattext"><p>Pick a start</p></div>'
        message.querySelector('p')!.getBoundingClientRect = () => rect(160, 200)
        const anchor = captureChatScrollAnchor(container, 'chat', 0)!
        expect(anchor).toMatchObject({ messageIndex: -1, offsetTop: 120, atLatest: true })

        // reloadDisplay swaps the picker for a long scene; the reverse scroller keeps its end in view.
        message.innerHTML = '<div class="chattext"><p>Opening scene</p><p>Scene end</p></div>'
        const blocks = message.querySelectorAll<HTMLElement>('p')
        blocks[0].getBoundingClientRect = () => rect(-1540, -1400)
        blocks[1].getBoundingClientRect = () => rect(300, 460)
        message.getBoundingClientRect = () => rect(-1580, 460)

        expect(restoreChatScrollAnchor(container, anchor, 'chat', 0)).toBe('restored')
        expect(container.scrollTo).toHaveBeenCalledWith({ top: -1700, behavior: 'instant' })
        // The first reply still follows the end.
        expect(restoreChatScrollAnchor(container, anchor, 'chat', 1)).toBe('new-message')
    })

    test('keeps a reverse chat at its end while a new message lays out', () => {
        const { container } = createChatLayout([{ index: 9, top: -400, bottom: 40 }], -855)
        container.style.flexDirection = 'column-reverse'
        const anchor = createChatScrollEndAnchor('character/chat', 11)

        expect(restoreChatScrollAnchor(container, anchor, 'character/chat', 11)).toBe('restored')
        expect(container.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'instant' })
        container.scrollTop = 0
        expect(restoreChatScrollAnchor(container, anchor, 'character/chat', 12)).toBe('stable')
        expect(restoreChatScrollAnchor(container, anchor, 'character/other', 12)).toBe('context-changed')
    })
})
