import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as fflate from 'fflate'

const mocks = vi.hoisted(() => ({
    saveAsset: vi.fn(async () => 'single-write'),
    setItems: vi.fn<(entries: Array<{ key: string; value: Uint8Array }>) => Promise<void>>(async () => undefined),
}))

vi.mock('../globalApi.svelte', () => ({
    AppendableBuffer: class {
        private chunks: Uint8Array[] = []
        append(data: Uint8Array) { this.chunks.push(Buffer.from(data)) }
        get buffer() { return Buffer.concat(this.chunks.map(chunk => Buffer.from(chunk))) }
        clear() { this.chunks = [] }
    },
    forageStorage: { setItems: mocks.setItems },
    saveAsset: mocks.saveAsset,
}))
vi.mock('../parser/parser.svelte', () => ({
    hasher: vi.fn(async (data: Uint8Array) => `hash-${data[0]}`),
}))
vi.mock('../alert', () => ({ alertStore: { set: vi.fn() } }))
vi.mock('../characterCards', () => ({ hubURL: '' }))
vi.mock('../util', () => ({
    asBuffer: (data: Uint8Array) => Buffer.from(data),
    sleep: async () => undefined,
    Semaphore: class {
        private available: number
        private waiting: Array<() => void> = []
        constructor(max: number) { this.available = max }
        async acquire() {
            if (this.available > 0) { this.available -= 1; return }
            await new Promise<void>(resolve => this.waiting.push(resolve))
        }
        release() {
            const next = this.waiting.shift()
            if (next) next()
            else this.available += 1
        }
    },
}))

import { CharXImporter } from './processzip'

describe('CharXImporter asset persistence', () => {
    beforeEach(() => vi.clearAllMocks())

    it('stores streamed assets in server-sized batches', async () => {
        const archiveEntries: Record<string, Uint8Array> = {
            'card.json': new TextEncoder().encode('{}'),
        }
        for (let index = 0; index < 51; index++) {
            archiveEntries[`assets/${index}.png`] = Uint8Array.of(index)
        }
        const archive = fflate.zipSync(archiveEntries, { level: 0 })
        const importer = new CharXImporter()

        await importer.parse(archive)
        await importer.done()

        expect(mocks.setItems).toHaveBeenCalledTimes(1)
        expect(mocks.setItems.mock.calls[0][0]).toHaveLength(51)
        expect(mocks.saveAsset).not.toHaveBeenCalled()
        expect(Object.keys(importer.assets)).toHaveLength(51)
    })

    it('finishes archives with hundreds of compressed metadata entries', async () => {
        const archiveEntries: Record<string, Uint8Array> = {
            'card.json': new TextEncoder().encode('{}'),
            'module.risum': Uint8Array.of(111, 0),
        }
        for (let index = 0; index < 728; index++) {
            archiveEntries[`x_meta/${index}.json`] = new TextEncoder().encode(`{"index":${index}}`)
            archiveEntries[`assets/${index}.webp`] = Uint8Array.of(index % 256)
        }
        const archive = fflate.zipSync(archiveEntries, { level: 6 })
        const importer = new CharXImporter()

        await importer.parse(archive)
        await importer.done()

        expect(importer.cardData).toBeTruthy()
        expect(importer.moduleData).toBeTruthy()
        expect(Object.keys(importer.assets)).toHaveLength(728)
    }, 30_000)

    it('imports animation assets larger than 50 MiB', async () => {
        const animation = new Uint8Array(64 * 1024 * 1024)
        const archive = fflate.zipSync({
            'card.json': new TextEncoder().encode('{}'),
            'assets/animation.webp': animation,
        }, { level: 6 })
        const importer = new CharXImporter()

        await importer.parse(archive)
        await importer.done()

        expect(importer.excludedFiles).not.toContain('assets/animation.webp')
        expect(importer.assets['assets/animation.webp']).toBe('single-write')
    }, 30_000)

})
