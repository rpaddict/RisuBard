import { vi } from 'vitest'

// Suppress warning
vi.mock(import('katex'), () => ({}))

vi.stubGlobal('safeStructuredClone', (v: unknown) => JSON.parse(JSON.stringify(v)))

// Node ≥22.4 ships a built-in experimental `localStorage` global that returns
// undefined (with an ExperimentalWarning) unless `--localstorage-file` is
// provided. Because the accessor sits on globalThis it shadows the working
// storage object happy-dom injects, so tests calling bare `localStorage`
// see undefined. Replace it with an in-memory Web Storage stub when it is
// not a usable storage object.
const localStorageProbe = globalThis.localStorage as
    | { getItem?: unknown, setItem?: unknown }
    | undefined
const localStorageUsable = typeof localStorageProbe === 'object'
    && localStorageProbe !== null
    && typeof localStorageProbe.getItem === 'function'
    && typeof localStorageProbe.setItem === 'function'
if (!localStorageUsable) {
    const backing = new Map<string, string>()
    Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        enumerable: true,
        writable: true,
        value: {
            get length(): number {
                return backing.size
            },
            key(index: number): string | null {
                return [...backing.keys()][index] ?? null
            },
            getItem(key: string): string | null {
                const normalized = String(key)
                return backing.has(normalized) ? backing.get(normalized)! : null
            },
            setItem(key: string, value: string): void {
                backing.set(String(key), String(value))
            },
            removeItem(key: string): void {
                backing.delete(String(key))
            },
            clear(): void {
                backing.clear()
            },
        },
    })
}
