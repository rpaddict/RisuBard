import { expect, test } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'
import { spawn } from 'node:child_process'

const { createUserDataRepository } = require('./user-data-repository.cjs')
const { createFileKv } = require('./file-kv.cjs')
const { encodeRisuSaveLegacyBuffer, decodeRisuSave, calculateHash } = require('./utils.cjs')

test('canonical painter flush persists edits before acknowledgement without rebuilding the compatibility database', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bard-painter-flush-'))
    const repository = createUserDataRepository({ dataRoot: root })
    const database = { language: 'en', botPresets: [], modules: [], personas: [], loreBook: [], characters: [{
        chaId: 'painter', type: 'character', name: 'Painter',
        chats: Array.from({ length: 16 }, (_, i) => ({ id: `chat-${i}`, name: `Chat ${i}`, message: [{ role: 'user', data: 'story '.repeat(16000) }] })),
    }] }
    repository.importLegacyDatabase(database, { mode: 'sync' })
    const store = createFileKv({ dataRoot: root })
    store.kvSet('database/database.bin', encodeRisuSaveLegacyBuffer(database))
    store.kvSet('database/canonical-projection-revision', Buffer.from(repository.getProjectionRevision()))
    fs.writeFileSync(path.join(root, '__password'), 'painter-test-password')
    const reservation = net.createServer()
    await new Promise<void>(resolve => reservation.listen(0, '127.0.0.1', resolve))
    const port = (reservation.address() as net.AddressInfo).port
    await new Promise<void>(resolve => reservation.close(() => resolve()))
    const child = spawn(process.execPath, [path.join(process.cwd(), 'server/node/server.cjs')], {
        cwd: root, env: { ...process.env, RISUBARD_DATA_ROOT: root, PORT: String(port), OPEN_BROWSER: '0' },
        windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    })
    let logs = ''
    child.stdout.on('data', value => { logs += value })
    child.stderr.on('data', value => { logs += value })
    const base = `http://127.0.0.1:${port}`
    try {
        for (let attempt = 0; attempt < 100; attempt++) {
            if (child.exitCode !== null) throw new Error(logs)
            try { if ((await fetch(`${base}/api/test_auth`)).ok) break } catch {}
            await new Promise(resolve => setTimeout(resolve, 100))
        }
        const login = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'painter-test-password' }) })
        expect(login.ok, logs).toBe(true)
        const { token } = await login.json()
        const session = await fetch(`${base}/api/session`, { method: 'POST', headers: { 'risu-auth': token } })
        const cookie = session.headers.get('set-cookie')!.split(';')[0]
        const headers = { 'content-type': 'application/json', 'risu-auth': token, 'x-session-id': 'painter-test', cookie, 'file-path': Buffer.from('database/database.bin').toString('hex') }
        const read = await fetch(`${base}/api/read`, { headers })
        expect(read.ok, logs).toBe(true)
        const current = await decodeRisuSave(Buffer.from(await read.arrayBuffer()))
        const fragments = [{ id: 'light', name: 'Light', prompt: 'rim light' }]
        async function patch(value: unknown) {
            const response = await fetch(`${base}/api/patch`, { method: 'POST', headers, body: JSON.stringify({
                expectedHash: calculateHash(current).toString(16), patch: [{ op: 'add', path: '/bardPainterFragments', value }],
            }) })
            expect(response.ok, await response.clone().text()).toBe(true)
            current.bardPainterFragments = value
        }
        async function flush(canonical: boolean) {
            const start = performance.now()
            const response = await fetch(`${base}/api/db/flush${canonical ? '?mode=canonical' : ''}`, { method: 'POST', headers })
            expect(response.ok, await response.clone().text()).toBe(true)
            return performance.now() - start
        }
        // The first ordinary flush establishes the existing shadow verification gate.
        await patch(fragments)
        const fullMs = await flush(false)
        const logPath = path.join(root, 'logs/storage-observation.jsonl')
        await expect.poll(() => fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8') : '').toContain('"semanticMatch":true')
        const updated = [{ ...fragments[0], prompt: 'soft glow' }]
        await patch(updated)
        const canonicalMs = await flush(true)
        const reopened = createUserDataRepository({ dataRoot: root }).exportLegacyDatabase()
        expect(reopened.bardPainterFragments).toEqual(updated)
        expect(reopened.characters[0].chats).toEqual(database.characters[0].chats)
        // Inspect raw KV, not the compatibility reader, which intentionally rebuilds on read.
        expect(createFileKv({ dataRoot: root }).kvGet('database/database.bin') === null).toBe(true)
        process.stdout.write(`${JSON.stringify({ fixtureBytes: 16 * 96000, fullFlushMs: Math.round(fullMs), canonicalFlushMs: Math.round(canonicalMs) })}\n`)
        const chat = { ...database.characters[0].chats[0], bardPainter: { settings: { width: 1024, height: 1024 },
            draft: { rendering: '', negative: '', scene: 'night', subjects: [], fragments: updated }, outfits: [], results: [] } }
        const chatSave = await fetch(`${base}/api/chat-content/painter/0`, { method: 'POST', headers: { ...headers, 'x-chat-id': 'chat-0' }, body: JSON.stringify(chat) })
        expect(chatSave.ok, await chatSave.clone().text()).toBe(true)
        await flush(true)
        expect(createUserDataRepository({ dataRoot: root }).exportLegacyDatabase().characters[0].chats[0]).toEqual(chat)
        expect(createFileKv({ dataRoot: root }).kvGet('database/database.bin') === null).toBe(true)
        // Explicit full flush and legacy readers still get the latest complete database.
        await flush(false)
        const bytes = createFileKv({ dataRoot: root }).kvGet('database/database.bin')
        expect((await decodeRisuSave(bytes)).bardPainterFragments).toEqual(updated)
    } finally {
        child.kill()
        if (child.exitCode === null) await new Promise(resolve => child.once('exit', resolve))
        if (path.dirname(path.resolve(root)) !== path.resolve(os.tmpdir())) throw new Error('Unexpected test root')
        fs.rmSync(root, { recursive: true, force: true })
    }
}, 30000)
