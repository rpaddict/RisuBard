import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
    alertWait: vi.fn(),
    decodeRPackBatch: vi.fn<(data: Uint8Array[]) => Promise<Uint8Array[]>>(async (data) => data.map(item => Buffer.from(item))),
    decodeRPack: vi.fn<(data: Uint8Array) => Promise<Uint8Array>>(async (data) => Buffer.from(data)),
    hasher: vi.fn(async (data: Uint8Array) => `hash-${data[0]}`),
    saveAsset: vi.fn<(data: Uint8Array) => Promise<string>>(async () => 'single-write'),
    readImage: vi.fn(),
    setItems: vi.fn<(entries: Array<{ key: string; value: Uint8Array }>) => Promise<void>>(async () => undefined),
    database: {
        current: {
            modules: [] as Array<{ id: string, name: string, description: string }>,
            enabledModules: [] as string[],
            personaEnabledModules: {} as Record<string, string[]>,
            personas: [] as Array<{ id?: string }>,
            selectedPersona: 0,
        },
    },
}))

vi.mock('src/lang', () => ({
    language: {
        errors: { noData: 'no data' },
        fileDropImport: {
            moduleAssets: (completed: number, total: number) =>
                `module assets ${completed} / ${total}`,
        },
    },
}))
vi.mock('../alert', () => ({
    alertClear: vi.fn(),
    alertConfirm: vi.fn(),
    alertError: vi.fn(),
    alertModuleSelect: vi.fn(),
    alertNormal: vi.fn(),
    alertStore: { set: vi.fn() },
    alertWait: mocks.alertWait,
    notifySuccess: vi.fn(),
}))
vi.mock('../storage/database.svelte', () => ({
    getCurrentCharacter: vi.fn(),
    getCurrentChat: vi.fn(),
    getDatabase: vi.fn(() => mocks.database.current),
    setCurrentCharacter: vi.fn(),
    setDatabase: vi.fn(),
}))
vi.mock('../globalApi.svelte', () => ({
    AppendableBuffer: class {
        parts: Uint8Array[] = []
        append(data: Uint8Array) { this.parts.push(data) }
        get buffer() { return Buffer.concat(this.parts) }
    },
    downloadFile: vi.fn(),
    forageStorage: { setItems: mocks.setItems },
    LocalWriter: class {},
    readImage: mocks.readImage,
    saveAsset: mocks.saveAsset,
    VirtualWriter: class {},
}))
vi.mock('../util', () => ({
    checkPersonaBinded: vi.fn(),
    selectSingleFile: vi.fn(),
    sleep: vi.fn(async () => undefined),
}))
vi.mock('uuid', () => ({ v4: vi.fn(() => 'new-module-id') }))
vi.mock('./lorebook.svelte', () => ({ convertExternalLorebook: vi.fn() }))
vi.mock('../media', () => ({ compressImage: vi.fn(async data => data) }))
vi.mock('../rpack/rpack_js', () => ({
    decodeRPackBatch: mocks.decodeRPackBatch,
    decodeRPack: mocks.decodeRPack,
    encodeRPack: vi.fn(async data => data),
}))
vi.mock('../stores.svelte', () => ({
    HideIconStore: { set: vi.fn() },
    moduleBackgroundEmbedding: { set: vi.fn() },
    ReloadGUIPointer: { set: vi.fn() },
}))
vi.mock('svelte/store', () => ({ get: vi.fn(() => 0) }))
vi.mock('../interchangeability', () => ({
    convertCharacterToModule: vi.fn(),
    convertModuleToCharacter: vi.fn(),
}))
vi.mock('../characterCards', () => ({
    exportCharacterCard: vi.fn(),
    importCharacterProcess: vi.fn(),
}))
vi.mock('../parser/parser.svelte', () => ({ hasher: mocks.hasher }))

import { exportModuleLegacy, getModules, readModule, refreshModules, resolveModuleIds } from './modules'

function uint32le(value: number) {
    const bytes = Buffer.alloc(4)
    bytes.writeUInt32LE(value)
    return bytes
}

function risumWithAssets(count: number) {
    const moduleData = Buffer.from(JSON.stringify({
        type: 'risuModule',
        module: {
            name: 'asset pack',
            description: '',
            id: 'old-id',
            assets: Array.from({ length: count }, (_, index) => [`asset-${index}`, '', 'png']),
        },
    }))
    const parts: Buffer[] = [Buffer.from([111, 0]), uint32le(moduleData.length), moduleData]
    for (let index = 0; index < count; index++) {
        const data = Buffer.from([index])
        parts.push(Buffer.from([1]), uint32le(data.length), data)
    }
    parts.push(Buffer.from([0]))
    return Buffer.concat(parts)
}

describe('readModule asset persistence', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mocks.decodeRPack.mockImplementation(async (data: Uint8Array) => Buffer.from(data))
        mocks.decodeRPackBatch.mockImplementation(async (data: Uint8Array[]) => Promise.all(data.map(item => mocks.decodeRPack(item))))
        mocks.saveAsset.mockResolvedValue('single-write')
        mocks.setItems.mockResolvedValue(undefined)
    })

    it('bounds decoded asset batches to mobile-safe worker-sized groups', async () => {
        const module = await readModule(risumWithAssets(51))

        expect(mocks.setItems).toHaveBeenCalledTimes(1)
        expect(mocks.setItems.mock.calls[0][0]).toHaveLength(51)
        expect(mocks.decodeRPackBatch).toHaveBeenCalledTimes(7)
        expect(mocks.decodeRPackBatch.mock.calls.every(([items]) => items.length <= 8)).toBe(true)
        expect(mocks.saveAsset).not.toHaveBeenCalled()
        expect(module.assets?.[0][1]).toBe('assets/hash-0.png')
        expect(module.assets?.[50][1]).toBe('assets/hash-50.png')
    })

    it('uses the binary single-write path for an oversized asset', async () => {
        mocks.decodeRPack.mockImplementation(async (data: Uint8Array) => {
            if (data.length === 1 && data[0] === 0) {
                return { 0: 0, length: 32 * 1024 * 1024 + 1 } as unknown as Uint8Array
            }
            return Buffer.from(data)
        })

        const module = await readModule(risumWithAssets(1))

        expect(mocks.setItems).not.toHaveBeenCalled()
        expect(mocks.saveAsset).toHaveBeenCalledTimes(1)
        expect(module.assets?.[0][1]).toBe('single-write')
    })

    it('rejects empty decoded assets instead of persisting them', async () => {
        mocks.decodeRPackBatch.mockResolvedValue([new Uint8Array(0)])

        await expect(readModule(risumWithAssets(1))).rejects.toThrow('Failed to save 1 assets')

        expect(mocks.setItems).not.toHaveBeenCalled()
        expect(mocks.saveAsset).not.toHaveBeenCalled()
    })

    it('rejects a module whose metadata declares an asset but whose payload ends before that asset', async () => {
        const complete = risumWithAssets(1)
        const metadataEnd = 6 + complete.readUInt32LE(2)
        const incomplete = Buffer.concat([complete.subarray(0, metadataEnd), Buffer.from([0])])
        await expect(readModule(incomplete)).rejects.toThrow(/asset.*count/i)
        expect(mocks.setItems).not.toHaveBeenCalled()
    })

    it('rejects a truncated payload before attempting to decode or save assets', async () => {
        const complete = risumWithAssets(1)
        await expect(readModule(complete.subarray(0, complete.length - 2))).rejects.toThrow(/truncated/i)
        expect(mocks.setItems).not.toHaveBeenCalled()
    })
})

it.each([null, new Uint8Array(0)])('rejects missing or empty module images during export', async value => {
    mocks.readImage.mockResolvedValue(value)
    const module = { id: 'module', name: 'Module', description: '', assets: [['image', 'assets/missing.png', 'png']] as [string, string, string][] }
    await expect(exportModuleLegacy(module, { saveData: false, alertEnd: false })).rejects.toThrow(/missing.*asset/i)
    expect(module.assets[0][1]).toBe('assets/missing.png')
})

describe('resolveModuleIds', () => {
    it('combines module scopes in order without duplicates', () => {
        expect(resolveModuleIds({
            globalIds: ['global', 'shared'],
            activePersonaId: 'active-persona',
            personaEnabledModules: {
                'active-persona': ['persona', 'shared'],
                'other-persona': ['inactive'],
            },
            chatIds: ['chat', 'persona'],
            characterIds: ['character', 'chat'],
            embeddedPersonaModuleId: 'embedded',
            integrationIds: ['integration', 'global'],
        })).toEqual([
            'global',
            'shared',
            'persona',
            'chat',
            'character',
            'embedded',
            'integration',
        ])
    })

    it('does not activate assignments for a different persona', () => {
        expect(resolveModuleIds({
            activePersonaId: 'active-persona',
            personaEnabledModules: {
                'other-persona': ['inactive'],
            },
        })).toEqual([])
    })
})

describe('getModules cache invalidation', () => {
    beforeEach(() => {
        mocks.database.current.modules = []
        mocks.database.current.enabledModules = []
        mocks.database.current.personaEnabledModules = {}
        mocks.database.current.personas = []
        mocks.database.current.selectedPersona = 0
        refreshModules()
    })

    it('returns a replacement module object when its ID is unchanged', () => {
        const original = { id: 'same-id', name: 'Original', description: 'old content' }
        const replacement = { id: 'same-id', name: 'Replacement', description: 'new content' }
        mocks.database.current.modules = [original]
        mocks.database.current.enabledModules = ['same-id']

        expect(getModules()[0]).toBe(original)

        mocks.database.current.modules[0] = replacement

        expect(getModules()[0]).toBe(replacement)
        expect(getModules()[0].description).toBe('new content')
    })

    it('returns an empty list while the module collection is not initialized', () => {
        mocks.database.current.modules = undefined as unknown as typeof mocks.database.current.modules

        expect(getModules()).toEqual([])
    })
})
