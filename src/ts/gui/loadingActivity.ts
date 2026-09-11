import { writable } from 'svelte/store'

export function createLoadingActivity(makeImage: () => HTMLImageElement = () => new Image()) {
    const foreground = writable<{ label: string; cancel: () => void } | null>(null)
    const background = writable<{ id: number; label: string }[]>([])
    const failure = writable<{ label: string; timeout: boolean } | null>(null)
    let selection = 0, sequence = 0
    let failureTimer: ReturnType<typeof setTimeout>
    const images = new Map<string, boolean>()

    function fail(label: string, timeout = false) {
        clearTimeout(failureTimer)
        failure.set({ label, timeout })
        failureTimer = setTimeout(() => failure.set(null), 6000)
    }

    function begin(label: string) {
        const id = ++sequence
        background.update(entries => [...entries, { id, label: label.slice(0, 160) }])
        return () => background.update(entries => entries.filter(entry => entry.id !== id))
    }

    return {
        foreground, background, failure, begin,
        select(label: string) {
            const id = ++selection
            const current = () => id === selection
            const cancel = () => { if (current()) { selection++; foreground.set(null) } }
            foreground.set({ label, cancel })
            return { current, cancel, finish: cancel }
        },
        async read<T>(label: string, read: () => Promise<T>): Promise<T> {
            const done = begin(label)
            try { return await read() }
            catch (error) { fail(label); throw error }
            finally { done() }
        },
        image(src: string, label: string) {
            if (typeof src !== 'string' || !src.startsWith('/api/asset/') || images.has(src)) return
            images.set(src, false)
            const image = makeImage()
            const done = begin(label)
            let settled = false
            const finish = (failed = false, timeout = false) => {
                if (settled) return
                settled = true
                clearTimeout(timer)
                image.onload = image.onerror = null
                images.set(src, true)
                for (const [key, complete] of images) {
                    if (images.size <= 128) break
                    if (complete) images.delete(key)
                }
                done()
                if (failed) fail(label, timeout)
            }
            const timer = setTimeout(() => finish(true, true), 60000)
            image.onload = () => finish()
            image.onerror = () => finish(true)
            image.src = src
        },
    }
}

export function describeNativeRead(path: string, body?: any): string | null {
    const [endpoint, query] = path.split('?')
    if (endpoint === '/api/native/catalog') return 'index/sidebar.json'
    if (endpoint === '/api/native/document') {
        const target = new URLSearchParams(query)
        return `${target.get('kind')} / ${target.get('id')}`
    }
    if (endpoint === '/api/native/documents' || endpoint === '/api/native/summaries') {
        const first = body?.targets?.[0]?.target ?? body?.targets?.[0]
        return first ? `${first.kind} / ${first.id}${body.targets.length > 1 ? ` (+${body.targets.length - 1})` : ''}` : 'index/sidebar.json'
    }
    return null
}

export const loadingActivity = createLoadingActivity()
