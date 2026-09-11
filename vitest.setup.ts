import { afterAll, vi } from 'vitest'

const nativeSetTimeout = globalThis.setTimeout

afterAll(async () => {
    // bits-ui restores body scroll styles on a 24 ms timer after a dialog unmounts.
    // Keep the DOM environment alive until that shared cleanup has completed.
    await new Promise<void>((resolve) => nativeSetTimeout(resolve, 30))
})

// Suppress warning
vi.mock(import('katex'), () => ({}))

vi.stubGlobal('safeStructuredClone', (v: unknown) => JSON.parse(JSON.stringify(v)))

// Keep unit tests hermetic. Individual tests can replace this with vi.stubGlobal().
globalThis.fetch = ((input: RequestInfo | URL) => {
    const url = typeof input === 'string'
        ? input
        : input instanceof URL
            ? input.href
            : input.url
    const resolvedUrl = new URL(url, window.location.href)
    return Promise.reject(new Error(`Unmocked network request in Vitest: ${resolvedUrl.href}`))
}) as typeof fetch
