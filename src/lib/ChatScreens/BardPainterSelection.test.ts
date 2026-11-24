import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parse } from 'svelte/compiler'
import { tick } from 'svelte'
import { createClassComponent } from 'svelte/legacy'
import BardPainterSelection from './BardPainterSelection.svelte'
import { get } from 'svelte/store'
import { painterSelection, painterInsertionRequest } from 'src/ts/bardPainter/selectionState'
import { insertPainterReference } from 'src/ts/bardPainter/selection'

const { DBState } = vi.hoisted(() => ({ DBState: { db: { characters: [] as any[] } } }))
vi.mock('src/ts/stores.svelte', () => ({ DBState }))

let component: ReturnType<typeof createClassComponent> | undefined
const source = '**echo** then *echo*'

async function mount(messageId: string | undefined = 'stable-message') {
    DBState.db.characters = [{ chaId: 'bot', chats: [
        { id: 'chat', message: [{ data: source, chatId: messageId }, { data: 'other passage', chatId: 'other-message' }] },
        { id: 'other-chat', message: [{ data: source, chatId: 'another-chat-message' }] },
    ] }]
    const transcript = document.createElement('div')
    transcript.innerHTML = '<p data-painter-message="0"><strong>echo</strong> then <em>echo</em></p><p data-painter-message="1">other passage</p>'
    document.body.append(transcript)
    const target = document.createElement('div')
    document.body.append(target)
    component = createClassComponent({ component: BardPainterSelection, target, props: { characterId: 'bot', chatId: 'chat' } })
    await tick()
    return transcript
}
function select(node: Node, start = 0, end = node.textContent!.length) {
    const range = document.createRange()
    range.setStart(node, start)
    range.setEnd(node, end)
    const selection = window.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)
    document.dispatchEvent(new Event('selectionchange'))
}
async function finishSelection() { await vi.advanceTimersByTimeAsync(110); await tick() }
function entry() { return document.querySelector<HTMLButtonElement>('[data-painter-selection] button') }
function clickPosition(element: Element, clientY = 50) {
    element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientY, button: 0, pointerType: 'mouse', isPrimary: true }))
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, clientY, button: 0, detail: 1 }))
}

beforeEach(() => {
    vi.useFakeTimers()
    painterSelection.set(null)
    painterInsertionRequest.set(null)
    vi.spyOn(Range.prototype, 'getBoundingClientRect').mockReturnValue({ left: 30, right: 180, top: 30, bottom: 50, width: 150, height: 20, x: 30, y: 30, toJSON: () => ({}) })
})
afterEach(() => {
    component?.$destroy(); component = undefined
    window.getSelection()?.removeAllRanges()
    document.body.replaceChildren()
    vi.restoreAllMocks()
    vi.useRealTimers()
})

describe('BardPainter passage selection', () => {
    test('replaces an earlier passage when the selection ends at the message wrapper', async () => {
        const transcript = await mount()
        const root = transcript.querySelector<HTMLElement>('[data-painter-message="0"]')!
        const source = 'First paragraph.\n\nLast paragraph.'
        DBState.db.characters[0].chats[0].message[0].data = source
        root.innerHTML = '<span data-painter-body><p>First paragraph.</p><p>Last paragraph.</p></span><button>Edit</button>'
        select(root.querySelector('p')!.firstChild!)
        await finishSelection()
        expect(get(painterSelection)?.anchor?.text).toBe('First paragraph.')

        const range = document.createRange()
        range.setStart(root.querySelector('p')!.firstChild!, 0)
        range.setEnd(root, 1)
        window.getSelection()!.removeAllRanges()
        window.getSelection()!.addRange(range)
        document.dispatchEvent(new Event('selectionchange'))
        await finishSelection()

        expect(get(painterSelection)?.anchor).toMatchObject({
            start: 0, end: source.length, text: 'First paragraph.Last paragraph.',
        })
    })

    test('captures the finished drag before clicking a panel control clears the highlight', async () => {
        const transcript = await mount()
        select(transcript.querySelector('strong')!.firstChild!)
        await finishSelection()
        select(transcript.querySelector('[data-painter-message="1"]')!.firstChild!)
        document.dispatchEvent(new MouseEvent('mouseup'))
        window.getSelection()!.removeAllRanges()
        document.dispatchEvent(new Event('selectionchange'))
        await finishSelection()

        expect(get(painterSelection)?.anchor).toMatchObject({ messageId: 'other-message', text: 'other passage' })
    })

    test('captures only story text when wrapper selection includes sibling controls', async () => {
        const transcript = await mount()
        const root = transcript.querySelector<HTMLElement>('[data-painter-message="0"]')!
        root.innerHTML = '<span data-painter-body><strong>echo</strong> then <em>echo</em></span><button>Edit</button>'
        const range = document.createRange()
        range.selectNodeContents(root)
        window.getSelection()!.addRange(range)
        document.dispatchEvent(new MouseEvent('mouseup'))
        await tick()
        expect(get(painterSelection)?.anchor).toMatchObject({ start: 0, end: source.length, text: 'echo then echo' })

        select(root.querySelector('button')!.firstChild!)
        await finishSelection()
        expect(get(painterSelection)?.anchor?.text).toBe('echo then echo')
    })

    test('does not insert on a held Enter, a coordinate-less click, or elapsed time', async () => {
        const transcript = await mount()
        const insert = vi.fn().mockResolvedValue(true)
        painterInsertionRequest.set({ characterId: 'bot', chatId: 'chat', resultId: 'result', insert })
        await tick(); await tick()
        const root = transcript.querySelector('[data-painter-message="0"]')!
        root.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', repeat: true, bubbles: true }))
        root.dispatchEvent(new MouseEvent('click', { bubbles: true }))
        await vi.advanceTimersByTimeAsync(5000); await tick()
        expect(insert).not.toHaveBeenCalled()
        expect(get(painterInsertionRequest)).not.toBeNull()
    })
    test('requires a new pointer press in the message after entering placement mode', async () => {
        const transcript = await mount()
        const insert = vi.fn().mockResolvedValue(true)
        painterInsertionRequest.set({ characterId: 'bot', chatId: 'chat', resultId: 'result', insert })
        await tick(); await tick()
        const root = transcript.querySelector('[data-painter-message="0"]')!
        root.dispatchEvent(new MouseEvent('click', { bubbles: true, clientY: 50, detail: 1 }))
        await tick()
        expect(insert).not.toHaveBeenCalled()
        clickPosition(root); await tick(); await tick()
        expect(insert).toHaveBeenCalledOnce()
    })
    test('does not insert when dragging to select text instead of clicking', async () => {
        const transcript = await mount()
        const insert = vi.fn().mockResolvedValue(true)
        painterInsertionRequest.set({ characterId: 'bot', chatId: 'chat', resultId: 'result', insert })
        await tick(); await tick()
        const root = transcript.querySelector('[data-painter-message="0"]')!
        root.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientY: 30, isPrimary: true }))
        root.dispatchEvent(new MouseEvent('click', { bubbles: true, clientY: 90, detail: 1 }))
        await tick()
        expect(insert).not.toHaveBeenCalled()
    })
    test('shows saving feedback after exactly one click until persistence finishes', async () => {
        const transcript = await mount()
        let finish!: (success: boolean) => void
        const insert = vi.fn(() => new Promise<boolean>(resolve => finish = resolve))
        painterInsertionRequest.set({ characterId: 'bot', chatId: 'chat', resultId: 'result', insert })
        await tick(); await tick()
        clickPosition(transcript.querySelector('[data-painter-message="0"]')!)
        await tick()
        expect(document.querySelector('[data-painter-placement]')?.textContent).toContain('저장하는 중')
        expect(document.querySelector('[data-painter-placement]')?.textContent).not.toContain('Enter')
        await vi.advanceTimersByTimeAsync(5000); await tick()
        expect(insert).toHaveBeenCalledOnce()
        expect(get(painterInsertionRequest)).not.toBeNull()
        finish(true); await tick(); await tick()
        expect(get(painterInsertionRequest)).toBeNull()
    })
    test('does not replace an unmapped middle gap with the start of the message', async () => {
        const transcript = await mount()
        DBState.db.characters[0].chats[0].message[0].data = 'Start.\n\nOriginal middle.\n\nEnd.'
        const root = transcript.querySelector<HTMLElement>('[data-painter-message="0"]')!
        root.innerHTML = '<span data-painter-body><p>Start.</p><p>Changed one.</p><p>Changed two.</p><p>End.</p></span>'
        root.querySelectorAll('p').forEach((p, n) => p.getBoundingClientRect = () => new DOMRect(20, 100 + n * 80, 300, 40))
        const insert = vi.fn().mockResolvedValue(true)
        painterInsertionRequest.set({ characterId: 'bot', chatId: 'chat', resultId: 'result', messageId: 'stable-message', insert })
        await tick(); await tick()
        clickPosition(root.querySelectorAll('p')[2], 240); await tick()
        root.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
        await vi.advanceTimersByTimeAsync(5000); await tick()
        expect(insert).not.toHaveBeenCalled()
        expect(document.querySelector('[role="alert"]')?.textContent).toContain('이 문단')
        expect(get(painterInsertionRequest)).not.toBeNull()
    })
    test('inserts at the pointer candidate on Enter and portals the preview outside chat layout', async () => {
        const transcript = await mount()
        const insert = vi.fn().mockResolvedValue(true)
        painterInsertionRequest.set({ characterId: 'bot', chatId: 'chat', resultId: 'result', messageId: 'stable-message', insert })
        await tick(); await tick()
        transcript.querySelector('[data-painter-message="1"]')!.dispatchEvent(new PointerEvent('pointermove', { clientY: 50, bubbles: true }))
        await tick()
        expect(document.querySelector('[data-painter-placement]')?.parentElement).toBe(document.body)
        document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
        await tick(); await tick()
        expect(insert).toHaveBeenCalledWith(expect.objectContaining({ messageId: 'other-message' }))
    })
    test('clears placement on chat navigation or screen destruction', async () => {
        await mount()
        const request = { characterId: 'bot', chatId: 'chat', resultId: 'result', insert: vi.fn() }
        painterInsertionRequest.set(request); await tick()
        component!.$set({ chatId: 'other-chat' }); await tick()
        expect(get(painterInsertionRequest)).toBeNull()
        painterInsertionRequest.set({ ...request, chatId: 'other-chat' }); await tick()
        component!.$destroy(); component = undefined
        expect(get(painterInsertionRequest)).toBeNull()
    })
    test('keeps placement available after a failed insertion for retry', async () => {
        const transcript = await mount()
        const insert = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true)
        painterInsertionRequest.set({ characterId: 'bot', chatId: 'chat', resultId: 'result', insert, error: () => '저장 실패' })
        await tick(); await tick()
        const root = transcript.querySelector('[data-painter-message="0"]')!
        clickPosition(root)
        await tick(); await tick()
        expect(document.querySelector('[data-painter-placement]')?.textContent).toContain('저장 실패')
        expect(get(painterInsertionRequest)).not.toBeNull()
        clickPosition(root)
        await tick(); await tick()
        expect(get(painterInsertionRequest)).toBeNull()
    })
    test('focuses the message for explicit placement and Escape cancels without insertion', async () => {
        const transcript = await mount()
        const insert = vi.fn().mockResolvedValue(true)
        painterInsertionRequest.set({ characterId: 'bot', chatId: 'chat', resultId: 'result', messageId: 'stable-message', insert })
        await tick(); await tick()
        expect(document.activeElement).toBe(transcript.querySelector('[data-painter-message="0"]'))
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
        await tick()
        expect(get(painterInsertionRequest)).toBeNull()
        expect(insert).not.toHaveBeenCalled()
    })
    test('snaps a click to a paragraph boundary and suppresses click-to-edit', async () => {
        const transcript = await mount()
        const source = 'First paragraph.\n\nSecond paragraph.'
        DBState.db.characters[0].chats[0].message[0].data = source
        const root = transcript.querySelector<HTMLElement>('[data-painter-message="0"]')!
        root.innerHTML = '<div data-painter-body><p>First paragraph.</p><p>Second paragraph.</p></div>'
        root.querySelectorAll('p').forEach((p, n) => p.getBoundingClientRect = () => ({ top: 100 + n * 80, bottom: 140 + n * 80, left: 0, right: 300, width: 300, height: 40, x: 0, y: 100 + n * 80, toJSON() {} }))
        const edit = vi.fn(); root.addEventListener('click', edit)
        const insert = vi.fn().mockResolvedValue(true)
        painterInsertionRequest.set({ characterId: 'bot', chatId: 'chat', resultId: 'result', messageId: 'stable-message', insert })
        await tick(); await tick()
        clickPosition(root.querySelectorAll('p')[1], 181)
        await tick(); await tick()
        expect(edit).not.toHaveBeenCalled()
        expect(insert).toHaveBeenCalledWith(expect.objectContaining({ messageId: 'stable-message', start: 18, end: 18 }))
        expect(get(painterInsertionRequest)).toBeNull()
    })
    test.each(['mouse', 'keyboard'])('captures duplicate text through %s without a floating button', async kind => {
        const transcript = await mount()
        select(transcript.querySelector('em')!.firstChild!)
        document.dispatchEvent(new Event(kind === 'mouse' ? 'mouseup' : 'keyup'))
        await finishSelection()
        expect(entry()).toBeNull()
        expect(get(painterSelection)?.anchor).toEqual({ characterId: 'bot', chatId: 'chat', messageId: 'stable-message', start: 14, end: 20, text: 'echo' })
    })
    test('keeps captured offsets and a legacy identity after deselection or selecting panel text', async () => {
        const transcript = await mount()
        delete DBState.db.characters[0].chats[0].message[0].chatId
        select(transcript.querySelector('em')!.firstChild!)
        await finishSelection()
        const captured = get(painterSelection)?.anchor
        expect(captured?.messageId).toEqual(expect.any(String))
        expect(captured?.messageId).toBe(DBState.db.characters[0].chats[0].message[0].chatId)
        window.getSelection()!.removeAllRanges()
        document.dispatchEvent(new Event('selectionchange'))
        await finishSelection()
        expect(get(painterSelection)?.anchor).toEqual(captured)
        const panel = document.createElement('div')
        panel.textContent = 'settings text'
        document.body.append(panel)
        select(panel.firstChild!)
        await finishSelection()
        expect(get(painterSelection)?.anchor).toEqual(captured)
    })
    test('discards scheduled capture and does not revive it when switching chats', async () => {
        const transcript = await mount()
        select(transcript.querySelector('em')!.firstChild!)
        component!.$set({ chatId: 'other-chat' })
        await tick()
        await finishSelection()
        expect(get(painterSelection)).toEqual({ characterId: 'bot', chatId: 'other-chat' })
        component!.$set({ chatId: 'chat' })
        await tick()
        expect(get(painterSelection)?.anchor).toBeUndefined()
    })
    test('explains cross-message selections in panel state', async () => {
        const transcript = await mount()
        const range = document.createRange()
        range.setStart(transcript.querySelector('em')!.firstChild!, 0)
        range.setEnd(transcript.querySelector('[data-painter-message="1"]')!.firstChild!, 5)
        window.getSelection()!.addRange(range)
        document.dispatchEvent(new Event('selectionchange'))
        await finishSelection()
        expect(get(painterSelection)?.issue).toContain('한 메시지')
        expect(get(painterSelection)?.anchor).toBeUndefined()
    })
    test('uses whole-message boundaries when a partial formatted selection has no safe text boundary', async () => {
        const transcript = await mount()
        select(transcript.querySelector('em')!.firstChild!, 0, 2)
        await finishSelection()
        expect(get(painterSelection)?.issue).toBeUndefined()
        const anchor = get(painterSelection)!.anchor!
        expect(anchor).toMatchObject({ text: 'ec', start: 0, end: source.length, insertionUnavailable: true })
        expect(insertPainterReference(source, anchor, 'picture', 'after').text)
            .toBe('**echo** then *echo*\n\n{{inlay::picture}}\n\n')
        expect(insertPainterReference(source, anchor, 'picture', 'before').text)
            .toBe('\n\n{{inlay::picture}}\n\n**echo** then *echo*')
    })
    test('maps normal name substitutions and uses displayed text without guessing other transforms', async () => {
        const transcript = await mount()
        Object.assign(DBState.db, { username: 'John' })
        DBState.db.characters[0].chats[0].message[0].data = '{{user}} waves. John listens.'
        const message = transcript.querySelector('[data-painter-message="0"]')!
        message.textContent = 'John waves. John listens.'
        select(message.firstChild!, 0, 4)
        await finishSelection()
        expect(get(painterSelection)?.issue).toBeUndefined()
        expect(get(painterSelection)?.anchor).toMatchObject({ text: 'John', start: 0, end: 8 })
        expect(get(painterSelection)?.anchor?.insertionUnavailable).toBeUndefined()
        message.textContent = 'Generated intro. John waves. John listens.'
        select(message.firstChild!, 0, 9)
        await finishSelection()
        expect(get(painterSelection)?.issue).toBeUndefined()
        const anchor = get(painterSelection)!.anchor!
        expect(anchor).toMatchObject({ text: 'Generated', start: 0, end: 29, insertionUnavailable: true })
        expect(insertPainterReference(DBState.db.characters[0].chats[0].message[0].data, anchor, 'picture', 'after').text)
            .toBe('{{user}} waves. John listens.\n\n{{inlay::picture}}\n\n')
        expect(entry()).toBeNull()
    })
    test('resolves the bound persona and bot nickname before mapping a repeated name', async () => {
        const transcript = await mount()
        const character = DBState.db.characters[0]
        Object.assign(character, { name: 'Bot', nickname: 'Mira', personas: [{ id: 'local-persona', name: 'Alex' }] })
        Object.assign(character.chats[0], { bindedPersona: 'local-persona' })
        character.chats[0].message[0].data = '{{user}} meets {{char}}. Alex waves.'
        const message = transcript.querySelector('[data-painter-message="0"]')!
        message.textContent = 'Alex meets Mira. Alex waves.'
        select(message.firstChild!, 0, 15)
        await finishSelection()
        expect(get(painterSelection)?.anchor).toMatchObject({ text: 'Alex meets Mira', start: 0, end: 23 })
        expect(get(painterSelection)?.anchor?.insertionUnavailable).toBeUndefined()
    })
    test('ignores sibling edit controls and accepts selection before a generated footer', async () => {
        const transcript = await mount()
        DBState.db.characters[0].chats[0].message[0].data = '"......wait."\n\nOpen the door.\n{{footer}}'
        const message = transcript.querySelector('[data-painter-message="0"]')!
        message.innerHTML = '<span data-painter-body>“...wait.”<p>Open the door.</p><aside>Generated status</aside></span><button>Edit</button>'
        select(message.querySelector('p')!.firstChild!)
        await finishSelection()
        const anchor = get(painterSelection)?.anchor
        expect(anchor?.text).toBe('Open the door.')
        expect(DBState.db.characters[0].chats[0].message[0].data.slice(anchor!.start, anchor!.end)).toBe('Open the door.')
    })

    test('the real chat click-to-edit handler leaves a selected passage readable', async () => {
        const transcript = await mount()
        select(transcript.querySelector('em')!.firstChild!)
        const code = readFileSync(resolve(process.cwd(), 'src/lib/ChatScreens/Chat.svelte'), 'utf8')
        const tree = parse(code)
        // Execute the production handler without mounting unrelated chat transport and editors.
        function findHandler(node: any): any {
            if (!node || typeof node !== 'object') return undefined
            if (node.type === 'Element' && node.attributes?.some((attr: any) => attr.name === 'data-painter-message')) {
                return node.attributes.find((attr: any) => attr.name === 'onclick')?.value?.[0]?.expression
            }
            for (const value of Object.values(node)) {
                if (Array.isArray(value)) { for (const child of value) { const found = findHandler(child); if (found) return found } }
                else if (value && typeof value === 'object') { const found = findHandler(value); if (found) return found }
            }
        }
        const handler = findHandler(tree.html)
        expect(handler).toBeDefined()
        const click = new Function('DBState', 'window', `let editMode = false; const readOnly = false, idx = 0, isOptimizedStreamingMessage = false, inlineEditAllowed = () => false, getInlineEditor = () => null; (${code.slice(handler.start, handler.end)})(); return editMode;`)
        expect(click({ db: { clickToEdit: true } }, window)).toBe(false)
        window.getSelection()!.removeAllRanges()
        expect(click({ db: { clickToEdit: true } }, window)).toBe(true)
    })
})
