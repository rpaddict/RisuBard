import { describe, expect, test } from 'vitest'
import { retainedChatHtml } from './retainedChatHtml'

const flush = () => new Promise(resolve => setTimeout(resolve, 0))
const render = (html: string) => ({ content: Promise.resolve(html), format: (value: string) => value, onRender: () => {} })

describe('retainedChatHtml', () => {
    test('keeps comparison copies out of the live document and patches in place', async () => {
        const node = document.createElement('span')
        const audio = '<audio autoplay loop><source src="a.mp3"></audio>'
        const action = retainedChatHtml(node, render(audio))
        await flush()
        const live = node.querySelector('audio')
        action.update(render(audio + '<p>x</p>'))
        await flush()

        expect(node.querySelectorAll('audio')).toHaveLength(1)
        expect(node.querySelector('audio')).toBe(live)
        expect(live!.ownerDocument).toBe(document)
        expect(node.querySelector('p')?.textContent).toBe('x')
    })

    test('parses comparison HTML outside the live document', async () => {
        const parsed: Element[] = []
        const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML')!
        Object.defineProperty(Element.prototype, 'innerHTML', {
            ...descriptor,
            set(value: string) {
                descriptor.set!.call(this, value)
                parsed.push(this)
            },
        })
        try {
            retainedChatHtml(document.createElement('span'), render('<audio autoplay></audio>'))
            await flush()
        } finally {
            Object.defineProperty(Element.prototype, 'innerHTML', descriptor)
        }
        expect(parsed).toHaveLength(1)
        expect(parsed[0].ownerDocument).not.toBe(document)
        expect(parsed[0].querySelector('audio')).not.toBeNull()
    })

    test('keeps <div> parsing rules for stray table cells', async () => {
        const node = document.createElement('span')
        retainedChatHtml(node, render('<td>cell</td>'))
        await flush()
        expect(node.querySelector('td')).toBeNull()
        expect(node.textContent).toBe('cell')
    })

    test('preserves scroll position of inner scrollable panels across in-place and fallback updates', async () => {
        const node = document.createElement('span')
        const action = retainedChatHtml(node, render('<div class="panel"><div class="body"><p>Item 1</p></div></div>'))
        await flush()
        const body = node.querySelector<HTMLElement>('.body')!
        body.scrollTop = 240
        body.scrollLeft = 18

        action.update(render('<div class="panel"><div class="body"><p>Banner</p><p>Item 1</p></div></div>'))
        await flush()
        expect(node.querySelector('.body')).toBe(body)
        expect(body.scrollTop).toBe(240)
        expect(body.scrollLeft).toBe(18)

        // Force fallback rebuild by mutating live child count
        node.appendChild(document.createComment('extra'))
        action.update(render('<div class="panel"><div class="body"><p>Item 2</p></div></div>'))
        await flush()
        const rebuilt = node.querySelector<HTMLElement>('.body')!
        expect(rebuilt).not.toBe(body)
        expect(rebuilt.scrollTop).toBe(240)
        expect(rebuilt.scrollLeft).toBe(18)
    })

    test('syncs live checked state when radio checked attribute moves after user interaction', async () => {
        const node = document.createElement('span')
        document.body.append(node)
        try {
            const action = retainedChatHtml(
                node,
                render('<input type="radio" name="tab" id="a" checked><input type="radio" name="tab" id="b">'),
            )
            await flush()
            const a = node.querySelector<HTMLInputElement>('#a')!
            const b = node.querySelector<HTMLInputElement>('#b')!
            // Simulate user clicking #b (sets dirty checkedness flag)
            b.checked = true
            expect(a.checked).toBe(false)
            expect(b.checked).toBe(true)

            // Programmatic redraw moves checked from #a to #b, then back to #a
            action.update(render('<input type="radio" name="tab" id="a"><input type="radio" name="tab" id="b" checked>'))
            await flush()
            expect(a.checked).toBe(false)
            expect(b.checked).toBe(true)

            action.update(render('<input type="radio" name="tab" id="a" checked><input type="radio" name="tab" id="b">'))
            await flush()
            expect(a.checked).toBe(true)
            expect(b.checked).toBe(false)
        } finally {
            node.remove()
        }
    })
})
