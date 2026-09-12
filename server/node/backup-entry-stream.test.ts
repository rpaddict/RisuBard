import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const roots: string[] = []

function tempRoot() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'risubard-backup-stream-'))
    roots.push(root)
    return root
}

function encodeEntry(name: string, data: Buffer) {
    const nameBytes = Buffer.from(name, 'utf8')
    const header = Buffer.alloc(8 + nameBytes.length)
    header.writeUInt32LE(nameBytes.length, 0)
    nameBytes.copy(header, 4)
    header.writeUInt32LE(data.length, 4 + nameBytes.length)
    return Buffer.concat([header, data])
}

async function* chunks(data: Buffer, sizes: number[]) {
    let offset = 0
    let index = 0
    while (offset < data.length) {
        const end = Math.min(data.length, offset + sizes[index++ % sizes.length])
        yield data.subarray(offset, end)
        offset = end
    }
}

afterEach(() => {
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe('disk-backed backup entry streaming', () => {
    it('restores the client import timeout after Node clears the request socket', () => {
        const source = fs.readFileSync('server/node/server.cjs', 'utf8')
        const start = source.indexOf("app.post('/api/backup/import'")
        const end = source.indexOf('// ── Server-side backup endpoints', start)
        const route = source.slice(start, end)
        const cleanup = route.slice(route.indexOf('} finally {'))

        expect(start).toBeGreaterThan(-1)
        expect(end).toBeGreaterThan(start)
        expect(route).toContain('const requestSocket = req.socket;')
        expect(route).toContain('const requestServer = requestSocket.server;')
        expect(cleanup).toContain('requestServer.requestTimeout = prevRequestTimeout;')
        expect(cleanup).not.toContain('req.socket')
    })

    it('keeps server-side restores alive throughout post-stream publication work', () => {
        const source = fs.readFileSync('server/node/server.cjs', 'utf8')
        const start = source.indexOf("app.post('/api/backup/server/restore'")
        const end = source.indexOf('// Delete a server backup file', start)
        const route = source.slice(start, end)

        expect(start).toBeGreaterThan(-1)
        expect(end).toBeGreaterThan(start)
        expect(route).toContain("res.setHeader('cache-control', 'no-cache, no-transform')")
        expect(route).toContain("res.setHeader('x-accel-buffering', 'no')")
        expect(route).toContain('setInterval(() =>')
        expect(route).toContain('BACKUP_NDJSON_HEARTBEAT_MS')
        expect(route).toContain('clearInterval(heartbeatTimer)')
    })

    it('stages fragmented entry bodies as files instead of returning body buffers', async () => {
        const { stageBackupEntries } = require('./backup-entry-stream.cjs')
        const stagingDir = tempRoot()
        const large = Buffer.alloc(3 * 1024 * 1024, 0x5a)
        const encoded = Buffer.concat([
            encodeEntry('database.risudat', Buffer.from('db')),
            encodeEntry('large-asset.bin', large),
        ])
        const entries: Array<{ name: string; sourcePath: string; size: number }> = []

        const result = await stageBackupEntries(chunks(encoded, [1, 2, 7, 65537]), {
            stagingDir,
            maxNameBytes: 1024,
            onEntry: async (entry: { name: string; sourcePath: string; size: number }) => {
                entries.push(entry)
            },
        })

        expect(result.bytesReceived).toBe(encoded.length)
        expect(entries.map(entry => ({ name: entry.name, size: entry.size }))).toEqual([
            { name: 'database.risudat', size: 2 },
            { name: 'large-asset.bin', size: large.length },
        ])
        expect(fs.readFileSync(entries[1].sourcePath)).toEqual(large)
        expect(entries[1]).not.toHaveProperty('data')
    })

    it('finishes receiving the backup before processing staged entries', async () => {
        const { stageBackupEntries } = require('./backup-entry-stream.cjs')
        const stagingDir = tempRoot()
        const encoded = Buffer.concat([
            encodeEntry('large-animation.webp', Buffer.alloc(1024 * 1024, 0x5a)),
            encodeEntry('database.risudat', Buffer.from('db')),
        ])
        let sourceFullyRead = false
        const source = (async function* () {
            yield* chunks(encoded, [4096])
            sourceFullyRead = true
        })()
        const processingStartedAfterUpload: boolean[] = []

        await stageBackupEntries(source, {
            stagingDir,
            maxNameBytes: 1024,
            onEntry: async () => {
                processingStartedAfterUpload.push(sourceFullyRead)
            },
        })

        expect(processingStartedAfterUpload).toEqual([true, true])
    })

    it('rejects truncated bodies without publishing a complete entry', async () => {
        const { stageBackupEntries } = require('./backup-entry-stream.cjs')
        const stagingDir = tempRoot()
        const encoded = Buffer.concat([
            encodeEntry('complete.bin', Buffer.from('complete-body')),
            encodeEntry('truncated.bin', Buffer.from('truncated-body')),
        ])
        const entries: unknown[] = []

        await expect(stageBackupEntries(chunks(encoded.subarray(0, -1), [3]), {
            stagingDir,
            maxNameBytes: 1024,
            onEntry: async (entry: unknown) => entries.push(entry),
        })).rejects.toThrow(/incomplete entry/i)
        expect(entries).toEqual([])
    })
})
