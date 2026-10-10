import { afterAll, expect, test } from 'vitest'
import { cp, readFile } from 'node:fs/promises'
import path from 'node:path'
import { createClient } from './helpers/client.js'
import { createSeedBackup } from './helpers/seed.js'
import { spawnServer, type ServerHandle } from './helpers/spawnServer.js'
import { decodeBackup } from './helpers/decode.js'
import { encodeBackup } from './helpers/encode.js'
import { decodeRisuDat } from './helpers/normalize.js'
import { uploadChatContent, CHAT_UPLOAD_CHUNK_BYTES } from '../../src/ts/storage/chatContentUpload'

const { calculateHash, encodeRisuSaveLegacyBuffer } = require('../../server/node/utils.cjs')
const { MAX_CHUNK_BYTES } = require('../../server/node/chat-content-upload.cjs')
const filePath = Buffer.from('database/database.bin').toString('hex')
const servers: ServerHandle[] = []
afterAll(async () => { await Promise.allSettled(servers.map(server => server.cleanup())) })

async function setup() {
    const server = await spawnServer()
    servers.push(server)
    const client = await createClient(server.port, server.password)
    const seed = decodeBackup(createSeedBackup({ characterCount: 2, chatsPerCharacter: 2, messagesPerChat: 3 }))
    const database: any = decodeRisuDat(seed[0].data)
    // Model the current application's initialized collections and stable IDs.
    // The legacy seed intentionally omits these for old-import compatibility tests.
    database.modules = []
    database.loreBook = []
    database.personas[0].id = 'persona-test'
    seed[0].data = encodeRisuSaveLegacyBuffer(database)
    expect((await client.importBackup(encodeBackup(seed))).ok).toBe(true)
    const session = 'w2-integration'
    const sessionResponse = await client.fetch('/api/session', { method: 'POST', headers: { 'x-session-id': session } })
    const cookie = sessionResponse.headers.get('set-cookie')!.split(';', 1)[0]
    const headers = { 'x-session-id': session, 'x-user-active': '1', cookie }
    const read = async () => {
        const response = await client.fetch('/api/read', { headers: { ...headers, 'file-path': filePath } })
        expect(response.ok).toBe(true)
        return decodeRisuDat(Buffer.from(await response.arrayBuffer())) as any
    }
    const postChat = async (id: string, data: string, chatIndex = 0) => {
        const response = await client.fetch(`/api/chat-content/test-char-0/${chatIndex}`, {
            method: 'POST', headers: { ...headers, 'content-type': 'application/json', 'x-chat-id': id },
            body: JSON.stringify({ id, name: `Chat ${chatIndex}`, message: [{ role: 'user', data }], localLore: [] }),
        })
        expect(response.ok).toBe(true)
    }
    const patch = async (database: any, operations: any[]) => {
        const response = await client.fetch('/api/patch', {
            method: 'POST', headers: { ...headers, 'file-path': filePath, 'content-type': 'application/json' },
            body: JSON.stringify({ patch: operations, expectedHash: calculateHash(database).toString(16) }),
        })
        expect(response.status, await response.clone().text()).toBe(200)
    }
    const rows = async () => (await readFile(path.join(server.cwd, 'save/logs/storage-observation.jsonl'), 'utf8'))
        .trim().split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line))
    const waitFor = async (predicate: (rows: any[]) => boolean) => {
        const deadline = Date.now() + 12_000
        while (Date.now() < deadline) {
            const values = await rows()
            if (predicate(values)) return values
            await new Promise(resolve => setTimeout(resolve, 50))
        }
        throw new Error('W2 persist did not finish')
    }
    return { server, client, headers, read, postChat, patch, rows, waitFor }
}

test.each([true, false])('chat debounce persists canonical and compatibility data with cached=%s', async cached => {
    const fixture = await setup()
    if (cached) await fixture.read()
    await fixture.postChat('chat-0-0', 'first dirty chat')
    await fixture.postChat('chat-0-1', 'second dirty chat', 1)
    const rows = await fixture.waitFor(rows => rows.some(row => row.kind === 'canonical-sync' && row.trigger === 'chat-debounce'))
    expect(rows.find(row => row.kind === 'canonical-sync' && row.trigger === 'chat-debounce'))
        .toMatchObject({ outcome: 'success', strategy: 'chat-direct', fallbackUsed: false, plannedFiles: 6 })
    expect(rows.filter(row => row.kind === 'compatibility-persist').every(row => row.overlappingPersists === 0)).toBe(true)
    const backup = decodeBackup(await fixture.client.exportBackup())
    const database: any = decodeRisuDat(backup.find(entry => entry.name === 'database.risudat')!.data)
    for (const [index, text] of ['first dirty chat', 'second dirty chat'].entries()) {
        expect(database.characters[0].chats[index].message[0].data).toBe(text)
        const canonical = await readFile(path.join(fixture.server.cwd, `save/characters/test-char-0/chats/chat-0-${index}/messages.jsonl`), 'utf8')
        expect(JSON.parse(canonical.trim()).data).toBe(text)
    }
})

test.each([1, 8, 16])('saved %i MiB app setting controls chunked upload and persists through the normal writer', async chunkMiB => {
    const fixture = await setup()
    const initialDatabase = await fixture.read()
    await fixture.patch(initialDatabase, [{ op: 'add', path: '/chatUploadChunkMiB', value: chunkMiB }])
    const savedSettings = await fixture.read()
    expect(savedSettings.chatUploadChunkMiB).toBe(chunkMiB)
    const getChat = async () => {
        const response = await fixture.client.fetch('/api/chat-content/test-char-0/0', {
            headers: { ...fixture.headers, 'x-chat-id': 'chat-0-0' },
        })
        expect(response.ok).toBe(true)
        return decodeRisuDat(Buffer.from(await response.arrayBuffer())) as any
    }
    const original = await getChat()
    const chunkBytes = chunkMiB * 1024 * 1024
    const data = 'large chat payload '.repeat(Math.ceil(chunkBytes / 19))
    const chat = { ...original, message: [{ role: 'user', data }] }
    const encoded = encodeRisuSaveLegacyBuffer(chat)
    expect(encoded.length).toBeGreaterThan(chunkBytes)
    let requests = 0
    const result = await uploadChatContent(async (url, init) => {
        const response = await fixture.client.fetch(url, {
            ...init, headers: { ...fixture.headers, ...init.headers },
        })
        requests++
        if (response.status === 202) expect(await getChat()).toEqual(original)
        return response
    }, 'test-char-0', 0, 'chat-0-0', encoded, savedSettings.chatUploadChunkMiB, true)
    expect(result.status, await result.clone().text()).toBe(200)
    expect(requests).toBe(2)
    expect((await getChat()).message[0].data === data).toBe(true)
    const backup = decodeBackup(await fixture.client.exportBackup())
    const database: any = decodeRisuDat(backup.find(entry => entry.name === 'database.risudat')!.data)
    expect(database.chatUploadChunkMiB).toBe(chunkMiB)
    expect(database.characters[0].chats[0].message[0].data === data).toBe(true)
    const canonical = await readFile(path.join(fixture.server.cwd, 'save/characters/test-char-0/chats/chat-0-0/messages.jsonl'), 'utf8')
    expect(JSON.parse(canonical.trim()).data === data).toBe(true)
})

test('chunk upload HTTP endpoint rejects missing chunks and unauthenticated writes', async () => {
    const fixture = await setup()
    const url = '/api/chat-content-upload/test-char-0/0'
    const headers = { ...fixture.headers, 'content-type': 'application/octet-stream', 'x-chat-id': 'chat-0-0',
        'x-upload-id': 'missing-upload', 'x-upload-index': '1', 'x-upload-size': String(CHAT_UPLOAD_CHUNK_BYTES + 1) }
    const response = await fixture.client.fetch(url, { method: 'POST', headers, body: new Uint8Array([1]) })
    expect(response.status).toBe(409)
    expect((await response.json()).error).toContain('missing')
    const unauthorized = await fetch(`http://127.0.0.1:${fixture.server.port}${url}`, {
        method: 'POST', headers, body: new Uint8Array([1]),
    })
    expect(unauthorized.status).toBe(400)
    expect(await unauthorized.json()).toEqual({ error: 'No auth header' })
    const oversized = await fixture.client.fetch(url, {
        method: 'POST', headers: { ...headers, 'x-upload-index': '0' },
        body: new Uint8Array(MAX_CHUNK_BYTES + 1),
    })
    expect(oversized.status).toBe(413)
})

test('external edit mode is retired: it cannot start during an upload, which then completes', async () => {
    const fixture = await setup()
    const database = await fixture.read()
    const original = database.characters[0].chats[0]
    const encoded = encodeRisuSaveLegacyBuffer({
        ...original, message: [{ role: 'user', data: 'x'.repeat(CHAT_UPLOAD_CHUNK_BYTES) }],
    })
    let staged = false
    const result = await uploadChatContent(async (url, init) => {
        const response = await fixture.client.fetch(url, { ...init, headers: { ...fixture.headers, ...init.headers } })
        if (response.status === 202 && !staged) {
            staged = true
            const edit = await fixture.client.fetch('/api/external-edit/start', { method: 'POST', headers: fixture.headers })
            expect(edit.status).toBe(409)
        }
        return response
    }, 'test-char-0', 0, 'chat-0-0', encoded, 8, true)
    expect(staged).toBe(true)
    expect(result.ok).toBe(true)
    const response = await fixture.client.fetch('/api/chat-content/test-char-0/0', {
        headers: { ...fixture.headers, 'x-chat-id': 'chat-0-0' },
    })
    const saved: any = decodeRisuDat(Buffer.from(await response.arrayBuffer()))
    expect(saved.message[0].data).toHaveLength(CHAT_UPLOAD_CHUNK_BYTES)
})

test('coalesced metadata and CSS survive restart; preset mixing, reordering and deletion use full sync', async () => {
    const fixture = await setup()
    let database = await fixture.read()
    await fixture.postChat('chat-0-0', 'durable edited message')
    await fixture.patch(database, [
        { op: 'replace', path: '/characters/0/chats/0/name', value: 'renamed chat' },
        { op: 'replace', path: '/characters/0/chatPage', value: 1 },
        { op: 'add', path: '/customCSS', value: 'body { color: red; }' },
    ])
    // Export must flush the same scope without waiting for the timer.
    await fixture.client.exportBackup()
    await fixture.waitFor(rows => rows.some(row => row.strategy === 'chat-direct'))
    const firstRows = await fixture.rows()
    expect(firstRows.find(row => row.strategy === 'chat-direct')).toMatchObject({ outcome: 'success', fallbackUsed: false })
    database = await fixture.read()
    await fixture.postChat('chat-0-1', 'mixed with preset', 1)
    await fixture.patch(database, [{ op: 'add', path: '/botPresets', value: [{ id: 'preset-test', name: 'test' }] }])
    await fixture.client.exportBackup()
    const mixedRows = await fixture.waitFor(rows => rows.filter(row => row.kind === 'canonical-sync').length > firstRows.filter(row => row.kind === 'canonical-sync').length)
    expect(mixedRows.filter(row => row.kind === 'canonical-sync').at(-1)).toMatchObject({ strategy: 'full-sync', outcome: 'success' })
    database = await fixture.read()
    await fixture.patch(database, [{ op: 'replace', path: '/characters/0/chats', value: [...database.characters[0].chats].reverse() }])
    await fixture.client.exportBackup()
    database = await fixture.read()
    await fixture.patch(database, [{ op: 'remove', path: '/characters/0/chats/1' }])
    const finalBackup = decodeBackup(await fixture.client.exportBackup())
    const expected: any = decodeRisuDat(finalBackup.find(entry => entry.name === 'database.risudat')!.data)
    expect(expected.customCSS).toBe('body { color: red; }')
    expect(expected.botPresets[0].name).toBe('test')
    expect(expected.characters[0].chats.map((chat: any) => chat.id)).toEqual(['chat-0-1'])
    expect(expected.characters[0].chats[0].message[0].data).toBe('mixed with preset')

    const restarted = await spawnServer({ seedSave: save => cp(path.join(fixture.server.cwd, 'save'), save, {
        recursive: true,
        // The clone is a different data root, not a second owner of the original.
        filter: source => path.basename(source) !== '.risubard-server.lock',
    }) })
    servers.push(restarted)
    const reopened = await createClient(restarted.port, restarted.password)
    const exported = decodeBackup(await reopened.exportBackup())
    expect(decodeRisuDat(exported.find(entry => entry.name === 'database.risudat')!.data)).toEqual(expected)
    const shadowRows = await fixture.waitFor(rows => rows.some(row => row.kind === 'projection-shadow' && row.outcome === 'success'))
    expect(shadowRows.filter(row => row.kind === 'projection-shadow').every(row => !['failure', 'mismatch'].includes(row.outcome))).toBe(true)
})
