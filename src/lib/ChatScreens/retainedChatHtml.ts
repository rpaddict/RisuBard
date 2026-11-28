interface ChatHtmlUpdate {
    content: Promise<string>
    format: (html: string) => string
    onRender: () => void
    pendingHtml?: string
}

// Compare parser output with the previous parser output, not the live DOM:
// asset loading and inlay resolution deliberately modify that DOM themselves.
function patchChildren(live: Element, previous: Node, next: Node) {
    const oldChildren = Array.from(previous.childNodes)
    // Inline editing wraps nodes in a temporary element; patch the nodes it holds.
    const liveChildren = Array.from(live.childNodes).flatMap(child =>
        child instanceof Element && child.hasAttribute('data-inline-run') ? Array.from(child.childNodes) : [child])
    const nextChildren = Array.from(next.childNodes)

    if (oldChildren.length !== liveChildren.length) {
        // A custom renderer changed the structure. Rebuild this changed subtree
        // instead of applying a positional patch to unrelated nodes.
        live.replaceChildren(...nextChildren.map(child => child.cloneNode(true)))
        return
    }

    for (let index = 0; index < Math.max(oldChildren.length, nextChildren.length); index++) {
        const oldChild = oldChildren[index]
        const nextChild = nextChildren[index]
        const liveChild = liveChildren[index]
        if (!nextChild) {
            liveChild.parentNode!.removeChild(liveChild)
        } else if (!oldChild) {
            live.appendChild(nextChild.cloneNode(true))
        } else if (!oldChild.isEqualNode(nextChild)) {
            patchNode(liveChild, oldChild, nextChild)
        }
    }
}

function patchNode(live: Node, previous: Node, next: Node) {
    if (previous.nodeType !== next.nodeType || previous.nodeName !== next.nodeName
        || live.nodeType !== next.nodeType || live.nodeName !== next.nodeName) {
        live.parentNode!.replaceChild(next.cloneNode(true), live)
        return
    }

    if (next instanceof Element && previous instanceof Element && live instanceof Element) {
        // A different media source/inlay is a different resource, even if its tag matches.
        if (['src', 'data-inlay-id', 'data-inlay-type'].some(name =>
            previous.getAttribute(name) !== next.getAttribute(name))) {
            live.replaceWith(next.cloneNode(true))
            return
        }
        for (const attribute of Array.from(previous.attributes)) {
            if (!next.hasAttribute(attribute.name)) live.removeAttribute(attribute.name)
        }
        for (const attribute of Array.from(next.attributes)) {
            if (previous.getAttribute(attribute.name) !== attribute.value) {
                live.setAttribute(attribute.name, attribute.value)
            }
        }
        if (live instanceof HTMLInputElement && (live.type === 'checkbox' || live.type === 'radio')) {
            const nextChecked = next.hasAttribute('checked')
            if (previous.hasAttribute('checked') !== nextChecked) {
                live.checked = nextChecked
            }
        } else if (live instanceof HTMLOptionElement) {
            const nextSelected = next.hasAttribute('selected')
            if (previous.hasAttribute('selected') !== nextSelected) {
                live.selected = nextSelected
            }
        }
        patchChildren(live, previous, next)
    } else if (live.nodeValue !== next.nodeValue) {
        live.nodeValue = next.nodeValue
    }
}

// Comparison copies are parsed with the same rules as a <div>, but in a document
// without a browsing context: a detached <div> of the live document would load
// media, and Firefox plays its <audio autoplay> copies forever since they are
// never removed from a document.
let parserDocument: Document | null = null
function createParserElement() {
    parserDocument ??= document.implementation.createHTMLDocument('')
    return parserDocument.createElement('div')
}

function getElementPath(root: Node, target: Element): number[] {
    const path: number[] = []
    for (let el: Element | null = target; el && el !== root; el = el.parentElement) {
        const parent = el.parentElement
        if (!parent) break
        path.unshift(Array.prototype.indexOf.call(parent.children, el))
    }
    return path
}

function captureScrolledDescendants(root: HTMLElement) {
    const saved: Array<{ el: HTMLElement; path: number[]; top: number; left: number }> = []
    for (const el of root.querySelectorAll<HTMLElement>('*')) {
        if (el.scrollTop !== 0 || el.scrollLeft !== 0) {
            saved.push({ el, path: getElementPath(root, el), top: el.scrollTop, left: el.scrollLeft })
        }
    }
    return saved
}

function restoreScrolledDescendants(root: HTMLElement, saved: Array<{ el: HTMLElement; path: number[]; top: number; left: number }>) {
    for (const entry of saved) {
        let target: Element | null = entry.el.isConnected ? entry.el : root
        if (!entry.el.isConnected) {
            for (const index of entry.path) {
                target = target?.children[index] ?? null
            }
        }
        if (target instanceof HTMLElement) {
            if (target.scrollTop !== entry.top) target.scrollTop = entry.top
            if (target.scrollLeft !== entry.left) target.scrollLeft = entry.left
        }
    }
}

/** Svelte action for already-sanitized chat HTML. Keeps the last committed DOM while parsing. */
export function retainedChatHtml(node: HTMLElement, initial: ChatHtmlUpdate) {
    let previous: Node = createParserElement()
    let revision = 0

    function commit(html: string) {
        const savedScrolls = captureScrolledDescendants(node)
        const next = createParserElement()
        next.innerHTML = html
        patchChildren(node, previous, next)
        previous = next
        if (savedScrolls.length > 0) restoreScrolledDescendants(node, savedScrolls)
    }

    function update(options: ChatHtmlUpdate) {
        const request = ++revision
        if (options.pendingHtml) commit(options.format(options.pendingHtml))
        void options.content.then(html => {
            if (request !== revision) return
            commit(options.format(html))
            options.onRender()
        }).catch(error => {
            if (request === revision) console.error('Failed to render chat HTML', error)
        })
    }

    update(initial)
    return {
        update,
        destroy() { revision += 1 },
    }
}
