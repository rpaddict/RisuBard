const SIZE_STORAGE_PREFIX = 'risubard:resizable-size:v1:'

export interface ResizableSize {
    width?: number
    height?: number
}

function defaultStorage(): Storage | null {
    try {
        return typeof localStorage === 'undefined' ? null : localStorage
    } catch {
        return null
    }
}

function positiveDimension(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined
}

export function loadResizableSize(key: string, storage = defaultStorage()): ResizableSize | null {
    if (!storage || !key) return null
    try {
        const parsed = JSON.parse(storage.getItem(SIZE_STORAGE_PREFIX + key) ?? 'null')
        const width = positiveDimension(parsed?.width)
        const height = positiveDimension(parsed?.height)
        return width || height ? { ...(width ? { width } : {}), ...(height ? { height } : {}) } : null
    } catch {
        return null
    }
}

export function saveResizableSize(key: string, size: ResizableSize, storage = defaultStorage()) {
    if (!storage || !key) return
    const width = positiveDimension(size.width)
    const height = positiveDimension(size.height)
    if (!width && !height) return
    try {
        storage.setItem(SIZE_STORAGE_PREFIX + key, JSON.stringify({
            ...(width ? { width } : {}),
            ...(height ? { height } : {}),
        }))
    } catch {}
}

export function clearResizableSize(key: string, storage = defaultStorage()) {
    if (!storage || !key) return
    try { storage.removeItem(SIZE_STORAGE_PREFIX + key) } catch {}
}

export function persistElementHeight(node: HTMLElement, key: string) {
    let currentKey = key
    let observer: ResizeObserver | undefined

    function restore() {
        const saved = loadResizableSize(currentKey)
        if (saved?.height) node.style.height = `${saved.height}px`
    }

    restore()
    if (typeof ResizeObserver !== 'undefined') {
        observer = new ResizeObserver(() => {
            saveResizableSize(currentKey, { height: node.getBoundingClientRect().height })
        })
        observer.observe(node)
    }

    return {
        update(nextKey: string) {
            if (nextKey === currentKey) return
            currentKey = nextKey
            restore()
        },
        destroy() { observer?.disconnect() },
    }
}
