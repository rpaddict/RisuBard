import { afterEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'

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

it('rejects a copy source changed since asset validation before publishing files', () => {
    const root = tempRoot()
    const source = path.join(root, 'source')
    fs.writeFileSync(source, 'changed after validation')
    expect(() => commitTransaction(root, [{ path: 'target', sourcePath: source, expectedChecksum: '0'.repeat(64) }])).toThrow(/source checksum mismatch/)
    expect(fs.existsSync(path.join(root, 'target'))).toBe(false)
})

function tempRoot() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'risubard-file-store-'))
    roots.push(root)
    return root
}

afterEach(() => {
    vi.restoreAllMocks()
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
    it('recovers chunked writes after interrupted publication and skips unchanged bytes', () => {
        const root = tempRoot()
        const chunks = function* () { yield Buffer.from('한글'); yield Buffer.from('😀\n'); }
        const operations = [{ path: 'messages.jsonl', chunks }, { path: 'metadata.json', data: Buffer.from('{}') }]
        expect(() => commitTransaction(root, operations, { failAfterPublish: 1 })).toThrow(/simulated crash/)
        recoverTransactions(root)
        expect(fs.readFileSync(path.join(root, 'messages.jsonl'), 'utf8')).toBe('한글😀\n')
        expect(commitTransaction(root, operations)).toMatchObject({ published: 0, skipped: 2, stagedBytes: 0 })
    })

    it('keeps the original files if chunk production fails during staging', () => {
        const root = tempRoot()
        atomicWriteFile(root, 'messages.jsonl', Buffer.from('original'))
        let pass = 0
        const chunks = function* () {
            yield Buffer.from('replacement')
            if (++pass === 2) throw new Error('serialization failed')
        }
        expect(() => commitTransaction(root, [{ path: 'messages.jsonl', chunks }])).toThrow('serialization failed')
        expect(fs.readFileSync(path.join(root, 'messages.jsonl'), 'utf8')).toBe('original')
        expect(fs.readdirSync(path.join(root, '.journal'))).toEqual([])
    })

    it('does not attach a stale sidecar to a newly preserved backup', () => {
        const root = tempRoot()
        atomicWriteJson(root, 'settings/app.json', { revision: 1 })
        atomicWriteJson(root, 'settings/app.json.bak', { revision: 0 })
        atomicWriteJson(root, 'settings/app.json', { revision: 2 })
        expect(fs.existsSync(path.join(root, 'settings/app.json.bak.sha256'))).toBe(false)
        expect(readVerifiedJson(root, 'settings/app.json.bak')).toEqual({ revision: 1 })
        expect(readVerifiedJson(root, 'settings/app.json')).toEqual({ revision: 2 })
    })
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
        let mismatch: any
        try { readVerifiedJson(root, relativePath) } catch (error: any) { mismatch = error.checksumMismatch }
        expect(mismatch).toEqual({
            file: target,
            expected: fs.readFileSync(`${target}.sha256`, 'utf8').trim(),
            actual: crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex'),
        })
        expect(readVerifiedJson(root, relativePath, { acceptExternalChanges: true }))
            .toEqual({ schemaVersion: 1, value: 'external' })
        expect(readVerifiedJson(root, relativePath)).toEqual({ schemaVersion: 1, value: 'external' })

        fs.writeFileSync(target, '{ invalid json')
        expect(() => readVerifiedJson(root, relativePath, { acceptExternalChanges: true })).toThrow()
    })
})

describe('journal recovery and trash', () => {
    it('stages only files whose content changed', () => {
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
            stagedBytes: 17,
        })
        expect(fs.readFileSync(path.join(root, 'settings/app.json'), 'utf8')).toBe('{"same":true}')
        expect(fs.readFileSync(path.join(root, 'presets/preset-1.json'), 'utf8')).toBe('{"id":"preset-1"}')
    })

    it('aborts before publishing when an unchanged precondition changes', () => {
        const root = tempRoot()
        const unchangedPath = path.join(root, 'settings', 'app.json')
        atomicWriteFile(root, 'settings/app.json', Buffer.from('{"same":true}'))

        const originalWrite = fs.writeSync
        let changed = false
        vi.spyOn(fs, 'writeSync').mockImplementation(((...args: any[]) => {
            const result = (originalWrite as any)(...args)
            if (!changed && Buffer.isBuffer(args[1]) && args[1].toString('utf8') === '{"id":"preset-1"}') {
                fs.writeFileSync(unchangedPath, '{"external":true}')
                changed = true
            }
            return result
        }) as typeof fs.writeSync)

        let caught: unknown
        try {
            commitTransaction(root, [
                { path: 'settings/app.json', data: Buffer.from('{"same":true}') },
                { path: 'presets/preset-1.json', data: Buffer.from('{"id":"preset-1"}') },
            ])
        } catch (error) {
            caught = error
        }

        expect(changed).toBe(true)
        expect(caught).toMatchObject({ code: 'CANONICAL_FILES_CHANGED' })
        expect(fs.readFileSync(unchangedPath, 'utf8')).toBe('{"external":true}')
        expect(fs.existsSync(path.join(root, 'presets', 'preset-1.json'))).toBe(false)
    })

    it('treats a matching checksum sidecar as a candidate and rejects a stale target', () => {
        const root = tempRoot()
        const target = path.join(root, 'settings', 'app.json')
        atomicWriteFile(root, 'settings/app.json', Buffer.from('{"same":true}'))
        fs.writeFileSync(target, '{"external":true}')

        let caught: unknown
        try {
            commitTransaction(root, [
                { path: 'settings/app.json', data: Buffer.from('{"same":true}') },
                { path: 'presets/preset-1.json', data: Buffer.from('{"id":"preset-1"}') },
            ])
        } catch (error) {
            caught = error
        }

        expect(caught).toMatchObject({ code: 'CANONICAL_FILES_CHANGED' })
        expect(fs.readFileSync(target, 'utf8')).toBe('{"external":true}')
        expect(fs.existsSync(path.join(root, 'presets', 'preset-1.json'))).toBe(false)
    })

    it('skips empty staging and journaling when every target is unchanged', () => {
        const root = tempRoot()
        atomicWriteFile(root, 'settings/app.json', Buffer.from('{"same":true}'))

        const result = commitTransaction(root, [
            { path: 'settings/app.json', data: Buffer.from('{"same":true}') },
        ])

        expect(result).toEqual({ committed: 1, published: 0, skipped: 1, stagedBytes: 0 })
        expect(fs.existsSync(path.join(root, '.journal'))).toBe(false)
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

    it('recovers a directory replacement and its new files from one journal', () => {
        const root = tempRoot()
        atomicWriteFile(root, 'characters/old/metadata.json', Buffer.from('old'))

        expect(() => commitTransaction(root, [
            { path: 'characters', moveTo: 'trash/restore-1/characters' },
            { path: 'characters/new/metadata.json', data: Buffer.from('new') },
            { path: 'kv/manifest.json', data: Buffer.from('{"schemaVersion":1,"entries":{}}') },
        ], { failAfterPublish: 1 })).toThrow(/simulated crash/i)

        expect(fs.existsSync(path.join(root, 'characters'))).toBe(false)
        recoverTransactions(root)
        expect(fs.readFileSync(path.join(root, 'characters/new/metadata.json'), 'utf8')).toBe('new')
        expect(fs.readFileSync(path.join(root, 'trash/restore-1/characters/old/metadata.json'), 'utf8')).toBe('old')
        expect(JSON.parse(fs.readFileSync(path.join(root, 'kv/manifest.json'), 'utf8'))).toEqual({ schemaVersion: 1, entries: {} })
        expect(fs.readdirSync(path.join(root, '.journal'))).toHaveLength(0)
    })

    it('recovers a case-only directory rename interrupted before its journal flag', () => {
        const root = tempRoot()
        atomicWriteFile(root, 'characters/Alice/metadata.json', Buffer.from('alice'))

        expect(() => commitTransaction(root, [
            { path: 'characters/Alice', moveTo: 'characters/alice' },
            { path: 'characters/alice/package.json', data: Buffer.from('{"directory":"alice"}') },
        ], { failAfterPublish: 1 })).toThrow(/simulated crash/i)
        // Crash between the rename and persisting entry.completed.
        const journalPath = path.join(root, '.journal', fs.readdirSync(path.join(root, '.journal')).find(name => name.endsWith('.json'))!)
        const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8'))
        delete journal.entries[0].completed
        fs.writeFileSync(journalPath, JSON.stringify(journal))

        recoverTransactions(root)
        expect(fs.readdirSync(path.join(root, 'characters'))).toEqual(['alice'])
        expect(fs.readFileSync(path.join(root, 'characters/alice/metadata.json'), 'utf8')).toBe('alice')
        expect(fs.readFileSync(path.join(root, 'characters/alice/package.json'), 'utf8')).toBe('{"directory":"alice"}')
        expect(fs.readdirSync(path.join(root, '.journal'))).toHaveLength(0)
    })

    it('still rejects a differently named destination that links back to the source', () => {
        const root = tempRoot()
        atomicWriteFile(root, 'characters/alice/metadata.json', Buffer.from('alice'))
        fs.symlinkSync(path.join(root, 'characters/alice'), path.join(root, 'characters/other'), 'junction')

        expect(() => commitTransaction(root, [
            { path: 'characters/alice', moveTo: 'characters/other' },
        ])).toThrow(/destination already exists/)
        expect(fs.readFileSync(path.join(root, 'characters/alice/metadata.json'), 'utf8')).toBe('alice')
    })

    it.each(['presets', 'presets/preset-1.json'])('restores identical bytes after moving %s aside', movedPath => {
        const root = tempRoot()
        atomicWriteFile(root, 'presets/preset-1.json', Buffer.from('same-preset'))
        commitTransaction(root, [
            { path: movedPath, moveTo: `trash/restore-1/${movedPath}` },
            { path: 'presets/preset-1.json', data: Buffer.from('same-preset') },
        ])
        expect(fs.readFileSync(path.join(root, 'presets/preset-1.json'), 'utf8')).toBe('same-preset')
        expect(fs.readFileSync(path.join(root, 'trash/restore-1/presets/preset-1.json'), 'utf8')).toBe('same-preset')
    })

    it('preserves appended live logs in trash while restoring the backed-up log', () => {
        const root = tempRoot()
        atomicWriteFile(root, 'logs/storage-observation.jsonl', Buffer.from('backup\n'))
        fs.appendFileSync(path.join(root, 'logs/storage-observation.jsonl'), 'later\n')
        commitTransaction(root, [
            { path: 'logs', moveTo: 'trash/restore-1/logs' },
            { path: 'logs/storage-observation.jsonl', data: Buffer.from('backup\n') },
        ])
        expect(fs.readFileSync(path.join(root, 'logs/storage-observation.jsonl'), 'utf8')).toBe('backup\n')
        expect(fs.readFileSync(path.join(root, 'trash/restore-1/logs/storage-observation.jsonl'), 'utf8')).toBe('backup\nlater\n')
    })

    it.each([2, 3])('replays a restore after %i publications have recreated the moved root', failAfterPublish => {
        const root = tempRoot()
        atomicWriteFile(root, 'characters/old/metadata.json', Buffer.from('old'))
        expect(() => commitTransaction(root, [
            { path: 'characters', moveTo: 'trash/restore-1/characters' },
            { path: 'characters/new/metadata.json', data: Buffer.from('new') },
            { path: 'kv/manifest.json', data: Buffer.from('{}') },
        ], { failAfterPublish })).toThrow(/simulated crash/)
        recoverTransactions(root)
        expect(fs.readFileSync(path.join(root, 'characters/new/metadata.json'), 'utf8')).toBe('new')
        expect(fs.readFileSync(path.join(root, 'trash/restore-1/characters/old/metadata.json'), 'utf8')).toBe('old')
        expect(fs.readFileSync(path.join(root, 'kv/manifest.json'), 'utf8')).toBe('{}')
        expect(fs.readdirSync(path.join(root, '.journal'))).toEqual([])
    })

    it('recovers a moved directory when interruption precedes its journal completion record', () => {
        const root = tempRoot()
        atomicWriteFile(root, 'characters/old/metadata.json', Buffer.from('old'))
        const originalRename = fs.renameSync
        const rename = vi.spyOn(fs, 'renameSync').mockImplementation((source, destination) => {
            originalRename(source, destination)
            if (source === path.join(root, 'characters')) throw new Error('interrupted after move')
        })
        expect(() => commitTransaction(root, [
            { path: 'characters', moveTo: 'trash/restore-1/characters' },
            { path: 'characters/new/metadata.json', data: Buffer.from('new') },
        ])).toThrow('interrupted after move')
        rename.mockRestore()
        recoverTransactions(root)
        expect(fs.readFileSync(path.join(root, 'characters/new/metadata.json'), 'utf8')).toBe('new')
        expect(fs.readFileSync(path.join(root, 'trash/restore-1/characters/old/metadata.json'), 'utf8')).toBe('old')
        expect(fs.readdirSync(path.join(root, '.journal'))).toEqual([])
    })

    it('skips an optional move whose source is absent', () => {
        const root = tempRoot()
        expect(commitTransaction(root, [
            { path: 'characters', moveTo: 'trash/restore-1/characters' },
            { path: 'settings/app.json', data: Buffer.from('{}') },
        ])).toEqual({ committed: 2, published: 1, skipped: 1, stagedBytes: 2 })
        expect(fs.readFileSync(path.join(root, 'settings/app.json'), 'utf8')).toBe('{}')
    })

    it('replays permanent character deletion after interruption without touching other characters', () => {
        const root = tempRoot()
        atomicWriteFile(root, 'characters/one/metadata.json', Buffer.from('one'))
        atomicWriteFile(root, 'characters/two/metadata.json', Buffer.from('two'))
        expect(() => commitTransaction(root, [
            { path: 'index/sidebar.json', data: Buffer.from('{}') },
            { path: 'characters/one', deleteCharacter: true },
        ], { failAfterPublish: 1 })).toThrow(/simulated crash/)
        recoverTransactions(root)
        expect(fs.existsSync(path.join(root, 'characters/one'))).toBe(false)
        expect(fs.readFileSync(path.join(root, 'characters/two/metadata.json'), 'utf8')).toBe('two')
        expect(() => commitTransaction(root, [{ path: 'characters', deleteCharacter: true }])).toThrow(/one character/)
        expect(() => commitTransaction(root, [{ path: '../outside', deleteCharacter: true }])).toThrow(/escapes/)
    })

    it('allows a move destination only when an earlier move clears it', () => {
        const root = tempRoot()
        atomicWriteFile(root, 'characters/legacy/metadata.json', Buffer.from('old'))
        atomicWriteFile(root, 'characters/friendly/metadata.json', Buffer.from('current'))
        commitTransaction(root, [
            { path: 'characters/legacy', moveTo: 'trash/legacy' },
            { path: 'characters/friendly', moveTo: 'characters/legacy', destinationClearedByTransaction: true },
        ])
        expect(fs.readFileSync(path.join(root, 'characters/legacy/metadata.json'), 'utf8')).toBe('current')
        expect(fs.readFileSync(path.join(root, 'trash/legacy/metadata.json'), 'utf8')).toBe('old')

        atomicWriteFile(root, 'characters/other/metadata.json', Buffer.from('other'))
        expect(() => commitTransaction(root, [
            { path: 'characters/other', moveTo: 'characters/legacy', destinationClearedByTransaction: true },
        ])).toThrow(/destination already exists/)
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
