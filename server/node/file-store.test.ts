import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const {
    atomicWriteFile,
    atomicWriteJson,
    commitTransaction,
    moveToTrash,
    readVerifiedJson,
    recoverTransactions,
} = require('./file-store.cjs')
const { resolveDataRoot } = require('./data-root.cjs')

const roots: string[] = []

function tempRoot() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'risubard-file-store-'))
    roots.push(root)
    return root
}

afterEach(() => {
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe('resolveDataRoot', () => {
    it('uses an explicit absolute user-data root independently from the app directory', () => {
        const root = path.resolve(tempRoot(), 'user-data')
        expect(resolveDataRoot({ env: { RISUBARD_DATA_ROOT: root }, cwd: 'C:\\app' })).toBe(root)
    })

    it('rejects shared Android storage as canonical Termux data', () => {
        expect(() => resolveDataRoot({
            env: { RISUBARD_DATA_ROOT: '/sdcard/RisuBard', PREFIX: '/data/data/com.termux/files/usr' },
            cwd: '/data/data/com.termux/files/home/app',
            platform: 'linux',
        })).toThrow(/shared Android storage/i)
    })
})

describe('crash-safe canonical writes', () => {
    it('validates bytes, publishes atomically, and preserves the previous revision', () => {
        const root = tempRoot()
        atomicWriteFile(root, 'settings/app.json', Buffer.from('{"revision":1}'), {
            validate: (bytes: Buffer) => JSON.parse(bytes.toString('utf8')).revision === 1,
        })
        atomicWriteFile(root, 'settings/app.json', Buffer.from('{"revision":2}'), {
            validate: (bytes: Buffer) => JSON.parse(bytes.toString('utf8')).revision === 2,
        })

        expect(fs.readFileSync(path.join(root, 'settings/app.json'), 'utf8')).toBe('{"revision":2}')
        expect(fs.readFileSync(path.join(root, 'settings/app.json.bak'), 'utf8')).toBe('{"revision":1}')
        expect(fs.readdirSync(path.join(root, 'settings')).some(name => name.endsWith('.tmp'))).toBe(false)
    })

    it('rejects invalid content without replacing the last good revision', () => {
        const root = tempRoot()
        atomicWriteJson(root, 'settings/app.json', { schemaVersion: 1, value: 'safe' })
        expect(() => atomicWriteFile(root, 'settings/app.json', Buffer.from('{}'), {
            validate: () => false,
        })).toThrow(/validation/i)
        expect(readVerifiedJson(root, 'settings/app.json')).toEqual({ schemaVersion: 1, value: 'safe' })
    })

    it('adopts a valid external JSON edit only through the explicit external-change path', () => {
        const root = tempRoot()
        const relativePath = 'settings/app.json'
        const target = path.join(root, relativePath)
        atomicWriteJson(root, relativePath, { schemaVersion: 1, value: 'safe' })
        fs.writeFileSync(target, `${JSON.stringify({ schemaVersion: 1, value: 'external' }, null, 2)}\n`)

        expect(() => readVerifiedJson(root, relativePath)).toThrow(/checksum mismatch/i)
        expect(readVerifiedJson(root, relativePath, { acceptExternalChanges: true }))
            .toEqual({ schemaVersion: 1, value: 'external' })
        expect(readVerifiedJson(root, relativePath)).toEqual({ schemaVersion: 1, value: 'external' })

        fs.writeFileSync(target, '{ invalid json')
        expect(() => readVerifiedJson(root, relativePath, { acceptExternalChanges: true })).toThrow()
    })
})

describe('journal recovery and trash', () => {
    it('reports published and unchanged files without changing transaction behavior', () => {
        const root = tempRoot()
        atomicWriteFile(root, 'settings/app.json', Buffer.from('{"same":true}'))

        const result = commitTransaction(root, [
            { path: 'settings/app.json', data: Buffer.from('{"same":true}') },
            { path: 'presets/preset-1.json', data: Buffer.from('{"id":"preset-1"}') },
        ])

        expect(result).toEqual({
            committed: 2,
            published: 1,
            skipped: 1,
            stagedBytes: 30,
        })
        expect(fs.readFileSync(path.join(root, 'settings/app.json'), 'utf8')).toBe('{"same":true}')
        expect(fs.readFileSync(path.join(root, 'presets/preset-1.json'), 'utf8')).toBe('{"id":"preset-1"}')
    })

    it('commits staged source files without requiring in-memory operation data', () => {
        const root = tempRoot()
        const source = path.join(root, '.import-staging', 'settings.json')
        fs.mkdirSync(path.dirname(source), { recursive: true })
        fs.writeFileSync(source, Buffer.from('{"streamed":true}'))

        commitTransaction(root, [
            { path: 'settings/app.json', sourcePath: source },
        ])

        expect(JSON.parse(fs.readFileSync(path.join(root, 'settings/app.json'), 'utf8')))
            .toEqual({ streamed: true })
    })

    it('finishes a prepared multi-file transaction after a simulated crash', () => {
        const root = tempRoot()
        expect(() => commitTransaction(root, [
            { path: 'settings/app.json', data: Buffer.from('{"ok":true}') },
            { path: 'presets/preset-1.json', data: Buffer.from('{"id":"preset-1"}') },
        ], { failAfterPublish: 1 })).toThrow(/simulated crash/i)

        recoverTransactions(root)
        expect(JSON.parse(fs.readFileSync(path.join(root, 'settings/app.json'), 'utf8'))).toEqual({ ok: true })
        expect(JSON.parse(fs.readFileSync(path.join(root, 'presets/preset-1.json'), 'utf8'))).toEqual({ id: 'preset-1' })
        expect(fs.readdirSync(path.join(root, '.journal'))).toHaveLength(0)
    })

    it('moves deleted canonical data to trash with recoverable bytes', () => {
        const root = tempRoot()
        atomicWriteFile(root, 'characters/char-1/metadata.json', Buffer.from('character'))
        const trashed = moveToTrash(root, 'characters/char-1/metadata.json')
        expect(fs.existsSync(path.join(root, 'characters/char-1/metadata.json'))).toBe(false)
        expect(fs.readFileSync(trashed, 'utf8')).toBe('character')
        expect(trashed).toContain(`${path.sep}trash${path.sep}`)
    })
})
