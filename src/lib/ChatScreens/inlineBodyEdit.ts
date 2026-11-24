// Lets the reader type straight into a rendered paragraph. The paragraph turns
// editable on click; leaving it writes the change back to the message source.
import { applyInlineEdit, findInlineAlignments, LOCKED_CHAR, type InlineAlignment } from 'src/ts/parser/inlineEdit'
import { isEditableBlockCandidate } from 'src/ts/parser/partialEdit'

const BLOCK_SELECTOR = 'p, li, h1, h2, h3, h4, h5, h6, blockquote, dt, dd'
const INLINE_TAGS = new Set([
    'EM', 'STRONG', 'B', 'I', 'U', 'S', 'DEL', 'INS', 'MARK', 'SMALL', 'SUB', 'SUP',
    'SPAN', 'Q', 'FONT', 'CODE', 'ABBR', 'CITE', 'DFN', 'KBD', 'SAMP', 'VAR', 'TIME',
])
// Anything inside these is bot UI or script output, never plain prose.
const LOCKED_SELECTOR = [
    'table', 'details', 'summary', 'button', 'label', 'a', 'form', 'svg', 'pre', 'select',
    'textarea', 'input', 'img', 'video', 'audio', 'iframe', 'canvas', 'ruby',
    '[contenteditable="false"]', '[risu-btn]', '[risu-trigger]', '[risu-ctrl]',
    '[data-inlay-image-id]', '[data-inlay-id]', '.inlay-image-control',
].join(', ')

export interface InlineBodyEditOptions {
    root: HTMLElement
    /** Current message source. */
    getSource: () => string | null
    onCommit: (newSource: string) => void
    /** The edit touched something protected and was rolled back. */
    onRejected: () => void
}

interface Session {
    block: HTMLElement
    source: string
    alignment: InlineAlignment
    oldPlain: string
    originalHtml: string
    locked: Set<Element>
    lockAttrs: Map<Element, string | null>
    cleanup: () => void
    /** Undoes a temporary wrapper once the edit is saved or cancelled. */
    release?: () => void
}

function isLockedElement(el: Element): boolean {
    if (!INLINE_TAGS.has(el.tagName) && el.tagName !== 'BR' && el.tagName !== 'WBR') return true
    if (el.matches(LOCKED_SELECTOR)) return true
    // risu-mark only colors dialogue; other risu-* attributes make bot controls.
    if (Array.from(el.attributes).some(attr => attr.name.startsWith('risu-') && attr.name !== 'risu-mark')) return true
    return getComputedStyle(el).display === 'none'
}

/** `transparent` elements are paragraphs (and their containers) inside a multi-paragraph session. */
function collectLocked(block: HTMLElement, transparent?: Set<Element>): Set<Element> {
    const locked = new Set<Element>()
    const visit = (node: Element) => {
        for (const child of Array.from(node.children)) {
            if (!transparent?.has(child) && isLockedElement(child)) locked.add(child)
            else visit(child)
        }
    }
    visit(block)
    return locked
}

const LINE_BLOCK_TAGS = new Set(['DIV', 'P', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'DT', 'DD'])

function readNodesText(nodes: Node[], locked: Set<Element>): string {
    let out = ''
    const visit = (children: Node[]) => {
        for (const child of children) {
            if (child.nodeType === Node.TEXT_NODE) {
                out += (child as Text).data
            } else if (child.nodeType === Node.ELEMENT_NODE) {
                const el = child as Element
                if (el.tagName === 'BR') out += '\n'
                else if (locked.has(el)) out += LOCKED_CHAR
                else {
                    // Paragraph breaks, and the line blocks some browsers wrap typed lines in.
                    if (LINE_BLOCK_TAGS.has(el.tagName) && out && !out.endsWith('\n')) out += '\n'
                    visit(Array.from(el.childNodes))
                }
            }
        }
    }
    visit(nodes)
    return out
}

/** Rendered text of a block, with each locked element as one placeholder. */
export function readBlockText(block: HTMLElement, locked: Set<Element>): string {
    return readNodesText(Array.from(block.childNodes), locked)
}

// A temporary wrapper that makes bare text, or several paragraphs, one editable element.
const WRAP_ATTR = 'data-inline-run'

/** One editable piece: a paragraph element, or a run of bare text (e.g. the line after an HTML image block). */
interface Unit {
    block: HTMLElement | null
    nodes: Node[]
}

function isInlineContent(el: Element): boolean {
    if (el.tagName === 'BR' || el.tagName === 'WBR') return true
    if (el.matches(BLOCK_SELECTOR)) return false
    if (!getComputedStyle(el).display.startsWith('inline')) return false
    return Array.from(el.children).every(isInlineContent)
}

function textRuns(root: HTMLElement): Unit[] {
    const runs: Unit[] = []
    const visit = (container: Element) => {
        let current: Node[] = []
        const flush = () => {
            if (current.some(node => node.nodeType === Node.TEXT_NODE && (node as Text).data.trim()
                || node instanceof Element && (node.textContent ?? '').trim())) {
                runs.push({ block: null, nodes: current })
            }
            current = []
        }
        for (const child of Array.from(container.childNodes)) {
            if (child.nodeType === Node.TEXT_NODE) {
                current.push(child)
            } else if (child instanceof Element) {
                if (isInlineContent(child)) {
                    current.push(child)
                    continue
                }
                flush()
                if (child.matches(LOCKED_SELECTOR) || getComputedStyle(child).display === 'none') continue
                if (Array.from(child.attributes).some(attr => attr.name.startsWith('risu-') && attr.name !== 'risu-mark')) continue
                if (child.matches(BLOCK_SELECTOR) && isEditableBlockCandidate(child, root)) continue
                visit(child)
            }
        }
        flush()
    }
    visit(root)
    return runs
}

function editableUnits(root: HTMLElement): Unit[] {
    const units: Unit[] = [
        ...editableBlocks(root).map(block => ({ block, nodes: [block] as Node[] })),
        ...textRuns(root),
    ]
    return units.sort((a, b) =>
        a.nodes[0].compareDocumentPosition(b.nodes[0]) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1)
}

function unitContains(unit: Unit, node: Node): boolean {
    return unit.nodes.some(part => part === node || part.contains(node))
}

function unitText(unit: Unit): string {
    if (unit.block) return readBlockText(unit.block, collectLocked(unit.block))
    const locked = new Set<Element>()
    for (const node of unit.nodes) {
        if (!(node instanceof Element)) continue
        if (isLockedElement(node)) locked.add(node)
        else for (const el of collectLocked(node as HTMLElement)) locked.add(el)
    }
    return readNodesText(unit.nodes, locked)
}

/** Moves the wrapper's children back out and rejoins text split around it. */
function unwrap(wrapper: HTMLElement) {
    const parent = wrapper.parentNode
    if (!parent) return
    const before = wrapper.previousSibling
    const after = wrapper.nextSibling
    wrapper.replaceWith(...Array.from(wrapper.childNodes))
    let node: Node | null = before ?? parent.firstChild
    while (node && node !== after) {
        const next: Node | null = node.nextSibling
        if (node.nodeType === Node.TEXT_NODE && next?.nodeType === Node.TEXT_NODE) {
            (node as Text).appendData((next as Text).data)
            next.parentNode?.removeChild(next)
            if (next === after) break
            continue
        }
        node = next
    }
}

function insideLockedAncestor(block: HTMLElement, root: HTMLElement): boolean {
    for (let el = block.parentElement; el && el !== root; el = el.parentElement) {
        if (el.matches(LOCKED_SELECTOR)) return true
    }
    return block.matches(LOCKED_SELECTOR)
}

function editableBlocks(root: HTMLElement): HTMLElement[] {
    return Array.from(root.querySelectorAll<HTMLElement>(BLOCK_SELECTOR))
        .filter(block => isEditableBlockCandidate(block, root) && !insideLockedAncestor(block, root))
}

function pickAlignment(root: HTMLElement, block: HTMLElement, source: string, plain: string): InlineAlignment | null {
    const found = findInlineAlignments(source, plain)
    if (found.length <= 1) return found[0] ?? null
    // The same paragraph appears more than once: pair them up in order.
    const target = plain.trim()
    const twins = editableUnits(root).filter(other => unitText(other).trim() === target)
    if (twins.length !== found.length) return null
    return found[twins.findIndex(unit => unit.nodes.includes(block))] ?? null
}

function caretRangeAt(x: number, y: number): Range | null {
    const doc = document as Document & {
        caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null
    }
    const pos = doc.caretPositionFromPoint?.(x, y)
    if (pos) {
        const range = document.createRange()
        range.setStart(pos.offsetNode, pos.offset)
        return range
    }
    return document.caretRangeFromPoint?.(x, y) ?? null
}

function caretNodeAt(x: number, y: number): Node | null {
    return caretRangeAt(x, y)?.startContainer ?? null
}

function placeCaret(x: number, y: number, block: HTMLElement): boolean {
    const range = caretRangeAt(x, y)
    if (!range || !block.contains(range.startContainer)) return false
    range.collapse(true)
    const sel = window.getSelection()
    sel?.removeAllRanges()
    sel?.addRange(range)
    return true
}

function collapseCaret(block: HTMLElement, toStart: boolean) {
    const range = document.createRange()
    range.selectNodeContents(block)
    range.collapse(toStart)
    const sel = window.getSelection()
    sel?.removeAllRanges()
    sel?.addRange(range)
}

/** Screen box of a collapsed caret; collapsed ranges often report no box of their own. */
function caretRect(range: Range): DOMRect | null {
    const own = range.getClientRects()
    if (own.length) return own[0]
    const node = range.startContainer
    const offset = range.startOffset
    if (node.nodeType === Node.TEXT_NODE) {
        const probe = document.createRange()
        const length = (node as Text).length
        if (!length) return null
        const from = offset < length ? offset : offset - 1
        probe.setStart(node, from)
        probe.setEnd(node, from + 1)
        const rects = probe.getClientRects()
        if (rects.length) return offset < length ? rects[0] : rects[rects.length - 1]
    } else if (node instanceof Element) {
        const child = node.childNodes[offset] ?? node.childNodes[offset - 1]
        if (child instanceof Element) return child.getBoundingClientRect()
        if (child?.nodeType === Node.TEXT_NODE) {
            const probe = document.createRange()
            probe.selectNodeContents(child)
            const rects = probe.getClientRects()
            if (rects.length) return child === node.childNodes[offset] ? rects[0] : rects[rects.length - 1]
        }
    }
    return null
}

/** Box of the first or last line of the block. */
function edgeLineRect(block: HTMLElement, first: boolean): DOMRect | null {
    const range = document.createRange()
    range.selectNodeContents(block)
    const rects = Array.from(range.getClientRects()).filter(rect => rect.height > 0)
    if (!rects.length) return null
    return first ? rects[0] : rects[rects.length - 1]
}

/** Only whitespace (which renders as nothing) between the caret and the block edge. */
function caretAtEdge(block: HTMLElement, caret: Range, start: boolean): boolean {
    const range = document.createRange()
    range.selectNodeContents(block)
    if (start) range.setEnd(caret.startContainer, caret.startOffset)
    else range.setStart(caret.startContainer, caret.startOffset)
    if (range.toString().trim()) return false
    const fragment = range.cloneContents()
    return !fragment.querySelector?.('*:not(br)')
}

/** The caret sits on the block's first (or last) visual line. */
function caretOnEdgeLine(block: HTMLElement, caret: Range, first: boolean): boolean {
    if (caretAtEdge(block, caret, first)) return true
    const rect = caretRect(caret)
    const line = edgeLineRect(block, first)
    if (!rect || !line) return false
    const middle = rect.top + rect.height / 2
    return middle >= line.top && middle <= line.bottom
}

export function createInlineBodyEditor(options: InlineBodyEditOptions) {
    let session: Session | null = null

    function end(): Session | null {
        const current = session
        session = null
        current?.cleanup()
        return current
    }

    function cancel() {
        const current = end()
        if (current?.block.isConnected) current.block.innerHTML = current.originalHtml
        current?.release?.()
    }

    function commit() {
        const current = session
        if (!current) return
        const newPlain = readBlockText(current.block, current.locked)
        end()
        try {
            if (!current.block.isConnected) return
            if (newPlain === current.oldPlain) return
            const source = options.getSource()
            const next = source === current.source
                ? applyInlineEdit(source, current.alignment, current.oldPlain, newPlain)
                : null
            if (next === null) {
                current.block.innerHTML = current.originalHtml
                options.onRejected()
                return
            }
            if (next !== source) options.onCommit(next)
        } finally {
            current.release?.()
        }
    }

    function startUnit(unit: Unit, place: (block: HTMLElement) => void): boolean {
        if (unit.block) return start(unit.block, place)
        return startWrapped(unit.nodes, 'span', place)
    }

    /** Wraps sibling nodes in a temporary element and edits that element as one block. */
    function startWrapped(nodes: Node[], tag: 'span' | 'div', place: (block: HTMLElement) => void, transparent?: Set<Element>): boolean {
        const wrapper = document.createElement(tag)
        wrapper.setAttribute(WRAP_ATTR, '')
        nodes[0].parentNode!.insertBefore(wrapper, nodes[0])
        wrapper.append(...nodes)
        if (start(wrapper, place, { transparent, release: () => unwrap(wrapper) })) return true
        unwrap(wrapper)
        return false
    }

    function unitAt(units: Unit[], node: Node | null): Unit | null {
        return node ? units.find(unit => unitContains(unit, node)) ?? null : null
    }

    /** A drag that crosses paragraphs edits all of them, and what lies between, as one block. */
    function startAcross(selection: Selection): boolean {
        const units = editableUnits(options.root)
        const a = unitAt(units, selection.anchorNode)
        const b = unitAt(units, selection.focusNode)
        if (!a || !b || a === b) return false
        const forward = a.nodes[0].compareDocumentPosition(b.nodes[0]) & Node.DOCUMENT_POSITION_FOLLOWING
        const first = forward ? a : b
        const last = forward ? b : a
        const startNode = first.nodes[0]
        const endNode = last.nodes[last.nodes.length - 1]
        const common = document.createRange()
        common.setStartBefore(startNode)
        common.setEndAfter(endNode)
        const container = common.commonAncestorContainer
        if (!(container instanceof HTMLElement) || !options.root.contains(container)) return false
        if (insideLockedAncestor(container, options.root) && container !== options.root) return false
        const topChild = (node: Node) => {
            let current = node
            while (current.parentNode !== container) current = current.parentNode!
            return current
        }
        const nodes: Node[] = []
        for (let node: Node | null = topChild(startNode); node; node = node.nextSibling) {
            nodes.push(node)
            if (node === topChild(endNode)) break
        }
        // Paragraphs inside the range, and the lists or quotes holding them, read as text.
        const transparent = new Set<Element>()
        for (const unit of units) {
            if (!unit.block || !nodes.some(node => node === unit.block || node.contains(unit.block))) continue
            for (let el: Element | null = unit.block; el && el !== container; el = el.parentElement) transparent.add(el)
        }
        const points = [selection.anchorNode!, selection.anchorOffset, selection.focusNode!, selection.focusOffset] as const
        return startWrapped(nodes, 'div', () => {
            window.getSelection()?.setBaseAndExtent(...points)
        }, transparent)
    }

    /** Arrow keys past the first or last line continue in the neighboring paragraph. */
    function moveToNeighbor(from: HTMLElement, step: -1 | 1, x: number | null): boolean {
        const units = editableUnits(options.root).filter(unit => !unitContains(unit, from) && !from.contains(unit.nodes[0]))
        const candidates = step < 0
            ? units.filter(unit => from.compareDocumentPosition(unit.nodes[0]) & Node.DOCUMENT_POSITION_PRECEDING).reverse()
            : units.filter(unit => from.compareDocumentPosition(unit.nodes[0]) & Node.DOCUMENT_POSITION_FOLLOWING)
        if (!candidates.length) return false
        commit()
        for (const target of candidates) {
            const placed = startUnit(target, block => {
                block.scrollIntoView({ block: 'nearest' })
                const line = edgeLineRect(block, step > 0)
                if (x !== null && line && placeCaret(x, line.top + line.height / 2, block)) return
                collapseCaret(block, step > 0)
            })
            if (placed) return true
        }
        // No neighbor could be edited: stay in this paragraph.
        if (from.isConnected) start(from, block => collapseCaret(block, step < 0))
        return true
    }

    function start(block: HTMLElement, place: (block: HTMLElement) => void, extra: { transparent?: Set<Element>; release?: () => void } = {}): boolean {
        const source = options.getSource()
        if (!source) return false
        const locked = collectLocked(block, extra.transparent)
        const oldPlain = readBlockText(block, locked)
        if (!oldPlain.trim()) return false
        const alignment = pickAlignment(options.root, block, source, oldPlain)
        if (!alignment) return false

        const selection = window.getSelection()
        const kept = !extra.release && selection && !selection.isCollapsed && block.contains(selection.anchorNode) && block.contains(selection.focusNode)
            ? selection.getRangeAt(0).cloneRange()
            : null
        const originalHtml = block.innerHTML
        const lockAttrs = new Map<Element, string | null>()
        for (const el of locked) {
            lockAttrs.set(el, el.getAttribute('contenteditable'))
            el.setAttribute('contenteditable', 'false')
        }
        // Not plaintext-only: Chrome forces pre-wrap there, so source line breaks the
        // page collapses would show up as blank lines and the text would jump.
        block.contentEditable = 'true'
        block.setAttribute('data-inline-editing', '')
        block.spellcheck = false

        const touchesLocked = (range: StaticRange | Range) => {
            const live = document.createRange()
            live.setStart(range.startContainer, range.startOffset)
            live.setEnd(range.endContainer, range.endOffset)
            for (const el of locked) if (el.isConnected && live.intersectsNode(el)) return true
            return false
        }
        const onBeforeInput = (e: InputEvent) => {
            // Only text is saved; bold or italic shortcuts would just vanish on save.
            if (e.inputType.startsWith('format')) {
                e.preventDefault()
                return
            }
            if (!locked.size) return
            const ranges = e.getTargetRanges?.() ?? []
            if (ranges.some(r => !r.collapsed && touchesLocked(r))) e.preventDefault()
        }
        const onInput = () => {
            // Fallback for browsers that report no target ranges.
            for (const el of locked) {
                if (!block.contains(el)) {
                    document.execCommand('undo')
                    return
                }
            }
        }
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                e.preventDefault()
                e.stopPropagation()
                cancel()
            } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault()
                e.stopPropagation()
                commit()
            } else if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)
                && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey && !e.isComposing) {
                const sel = window.getSelection()
                if (!sel || !sel.rangeCount || !sel.isCollapsed) return
                const caret = sel.getRangeAt(0)
                if (!block.contains(caret.startContainer)) return
                const back = e.key === 'ArrowUp' || e.key === 'ArrowLeft'
                const vertical = e.key === 'ArrowUp' || e.key === 'ArrowDown'
                const atEdge = vertical ? caretOnEdgeLine(block, caret, back) : caretAtEdge(block, caret, back)
                if (!atEdge) return
                const x = vertical ? caretRect(caret)?.left ?? null : null
                if (moveToNeighbor(block, back ? -1 : 1, x)) {
                    e.preventDefault()
                    e.stopPropagation()
                }
            }
        }
        const onFocusOut = (e: FocusEvent) => {
            if (e.relatedTarget instanceof Node && block.contains(e.relatedTarget)) return
            // Switching to another window keeps the caret here.
            if (!document.hasFocus()) return
            commit()
        }
        const onPaste = (e: ClipboardEvent) => {
            e.preventDefault()
            document.execCommand('insertText', false, e.clipboardData?.getData('text/plain') ?? '')
        }
        const onDrop = (e: DragEvent) => e.preventDefault()
        // The browser keeps a drag that starts here inside this paragraph. Once the
        // pointer leaves it, save this paragraph and extend the selection ourselves;
        // the click that ends the drag then opens everything selected.
        const onMouseDown = (e: MouseEvent) => {
            if (e.button !== 0) return
            const anchor = caretRangeAt(e.clientX, e.clientY)
            if (!anchor || !block.contains(anchor.startContainer)) return
            const anchorNode = anchor.startContainer
            const anchorOffset = anchor.startOffset
            let extending = false
            const onMove = (m: MouseEvent) => {
                if (m.type === 'mousemove' && !(m.buttons & 1)) return stop()
                const hit = caretRangeAt(m.clientX, m.clientY)
                if (!hit || !options.root.contains(hit.startContainer)) return
                if (!extending) {
                    if (block.contains(hit.startContainer)) return
                    extending = true
                    commit()
                }
                if (!anchorNode.isConnected) return stop()
                window.getSelection()?.setBaseAndExtent(anchorNode, anchorOffset, hit.startContainer, hit.startOffset)
            }
            const stop = () => {
                document.removeEventListener('mousemove', onMove)
                document.removeEventListener('mouseup', onUp, true)
            }
            const onUp = (m: MouseEvent) => {
                onMove(m)
                stop()
            }
            document.addEventListener('mousemove', onMove)
            document.addEventListener('mouseup', onUp, true)
        }

        block.addEventListener('beforeinput', onBeforeInput)
        block.addEventListener('input', onInput)
        block.addEventListener('keydown', onKeyDown)
        block.addEventListener('focusout', onFocusOut)
        block.addEventListener('paste', onPaste)
        block.addEventListener('drop', onDrop)
        block.addEventListener('mousedown', onMouseDown)

        session = {
            block,
            source,
            alignment,
            oldPlain,
            originalHtml,
            locked,
            lockAttrs,
            release: extra.release,
            cleanup: () => {
                block.removeEventListener('beforeinput', onBeforeInput)
                block.removeEventListener('input', onInput)
                block.removeEventListener('keydown', onKeyDown)
                block.removeEventListener('focusout', onFocusOut)
                block.removeEventListener('paste', onPaste)
                block.removeEventListener('drop', onDrop)
                block.removeEventListener('mousedown', onMouseDown)
                block.removeAttribute('contenteditable')
                block.removeAttribute('data-inline-editing')
                block.removeAttribute('spellcheck')
                for (const [el, value] of lockAttrs) {
                    if (value === null) el.removeAttribute('contenteditable')
                    else el.setAttribute('contenteditable', value)
                }
            },
        }

        block.focus({ preventScroll: true })
        if (kept) {
            window.getSelection()?.removeAllRanges()
            window.getSelection()?.addRange(kept)
        } else {
            place(block)
        }
        return true
    }

    return {
        /** Returns true when the click belongs to inline editing and nothing else should handle it. */
        handleClick(event: MouseEvent): boolean {
            if (session && !session.block.isConnected) end()
            const target = event.target instanceof Element ? event.target : null
            if (!target || !options.root.contains(target)) return false
            if (session?.block.contains(target)) return true
            const selection = window.getSelection()
            if (selection && !selection.isCollapsed && options.root.contains(selection.anchorNode)
                && options.root.contains(selection.focusNode)) {
                if (session) commit()
                if (startAcross(selection)) return true
            }
            if (target.closest(LOCKED_SELECTOR) && options.root.contains(target.closest(LOCKED_SELECTOR))) return false
            const place = (block: HTMLElement) => placeCaret(event.clientX, event.clientY, block)
            const block = target.closest<HTMLElement>(BLOCK_SELECTOR)
            if (block && options.root.contains(block)) {
                if (!isEditableBlockCandidate(block, options.root) || insideLockedAncestor(block, options.root)) return false
                if (session) commit()
                return start(block, place)
            }
            // Bare text, such as the line right after an HTML image block, has no paragraph element.
            const hit = caretNodeAt(event.clientX, event.clientY)
            if (!hit || !options.root.contains(hit)) return false
            if (session) commit()
            const run = textRuns(options.root).find(unit => unitContains(unit, hit))
            return run ? startUnit(run, place) : false
        },
        isEditing: () => session !== null,
        destroy() {
            commit()
        },
    }
}
