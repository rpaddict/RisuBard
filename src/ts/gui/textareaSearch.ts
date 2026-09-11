export function findTextareaMatch(text: string, search: string, from = 0) {
    const query = search.trim()
    if (!query) return null
    const expression = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')
    expression.lastIndex = from
    let match = expression.exec(text)
    if (!match && from > 0) {
        expression.lastIndex = 0
        match = expression.exec(text)
    }
    return match ? { start: match.index, end: match.index + match[0].length } : null
}

export function revealTextareaMatch(field: HTMLTextAreaElement, match: { start: number; end: number }) {
    field.focus({ preventScroll: true })
    field.setSelectionRange(match.start, match.end)
    field.scrollIntoView({ block: 'nearest', inline: 'nearest' })

    // Measure the real wrapped text, including padding and the scrollbar's width.
    const mirror = document.createElement('div')
    const style = getComputedStyle(field)
    for (const property of [
        'font-family', 'font-size', 'font-weight', 'font-style', 'font-variant',
        'line-height', 'letter-spacing', 'word-spacing', 'text-indent', 'text-transform',
        'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
        'tab-size', 'word-break', 'overflow-wrap', 'white-space', 'direction',
    ]) mirror.style.setProperty(property, style.getPropertyValue(property))
    Object.assign(mirror.style, {
        position: 'fixed', top: '0', left: '0', visibility: 'hidden',
        pointerEvents: 'none', boxSizing: 'border-box', width: `${field.clientWidth}px`,
    })
    mirror.setAttribute('aria-hidden', 'true')
    const text = document.createTextNode(field.value + '\n')
    mirror.append(text)
    document.body.append(mirror)
    try {
        const range = document.createRange()
        range.setStart(text, match.start)
        range.setEnd(text, match.end)
        const rect = range.getClientRects()[0]
        if (rect) field.scrollTop = rect.top - mirror.getBoundingClientRect().top - (field.clientHeight - rect.height) / 2
    } finally {
        mirror.remove()
    }
}
