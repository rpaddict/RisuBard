import { expect, test } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'
import { spawn } from 'node:child_process'
const { createUserDataRepository } = require('./user-data-repository.cjs')
const { createFileKv } = require('./file-kv.cjs')
const { encodeRisuSaveLegacyBuffer, decodeRisuSave } = require('./utils.cjs')

test.each(['legacy', 'v3'])('running server adopts metadata edited while the app was closed, with monitoring retired: %s', async (layout) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bard-live-http-'))
    const dataRoot = path.join(root, 'save')
    const repository = createUserDataRepository({ dataRoot, allowDirectoryMapping: true, newCharacterPackages: layout === 'v3' })
    const database = { language: 'en', botPresets: [], modules: [], personas: [], loreBook: [], characters: [{
        chaId: 'one', type: 'character', name: 'One', desc: 'Before', globalLore: [{ key: 'world', content: 'Before' }], additionalAssets: [], emotionImages: [],
        chats: [
            { id: 'chat', name: 'Chat', localLore: [{ key: 'local', content: 'Delete this' }], message: [{ role: 'user', data: 'Original message' }] },
            { id: '', name: 'Legacy chat', localLore: [], message: [{ role: 'user', data: 'Preserved legacy message' }] },
        ],
    }] }
    repository.importLegacyDatabase(database, { mode: 'sync' })
    const resolver = require('./character-directories.cjs').createCharacterDirectoryResolver(dataRoot)
    const characterPath = resolver.characterDirectory('one')
    const store = createFileKv({ dataRoot })
    store.kvSet('database/database.bin', encodeRisuSaveLegacyBuffer(database))
    store.kvSet('database/canonical-projection-revision', Buffer.from(repository.getProjectionRevision()))
    fs.writeFileSync(path.join(dataRoot, '__password'), 'local-test-password')
    fs.mkdirSync(path.join(dataRoot, 'config'), { recursive: true })
    fs.writeFileSync(path.join(dataRoot, 'config/live-file-monitoring.json'), '{"enabled":true}\n')
    const reservation = net.createServer()
    await new Promise<void>(resolve => reservation.listen(0, '127.0.0.1', resolve))
    const port = (reservation.address() as net.AddressInfo).port
    await new Promise<void>(resolve => reservation.close(() => resolve()))
    const child = spawn(process.execPath, [path.join(process.cwd(), 'server/node/server.cjs')], {
        cwd: root, env: { ...process.env, RISUBARD_DATA_ROOT: dataRoot, PORT: String(port), OPEN_BROWSER: '0' },
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
        const login = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'local-test-password' }) })
        expect(login.ok, logs).toBe(true)
        const { token } = await login.json()
        const headers = { 'content-type': 'application/json', 'risu-auth': token, 'x-session-id': 'live-test' }
        const sync = async (revision?: string) => {
            const response = await fetch(`${base}/api/live-files/sync`, { method: 'POST', headers, body: JSON.stringify({ revision }) })
            expect(response.ok, await response.clone().text()).toBe(true)
            return response.json()
        }
        // A setting saved before monitoring was retired must not restart it.
        const monitoringUrl = `${base}/api/live-files/monitoring`
        expect(await (await fetch(monitoringUrl, { headers })).json()).toEqual({ enabled: false, defaultEnabled: false })
        const malformed = await fetch(monitoringUrl, { method: 'POST', headers, body: JSON.stringify({ enabled: 'false' }) })
        expect(malformed.status).toBe(400)
        const enable = await fetch(monitoringUrl, { method: 'POST', headers, body: JSON.stringify({ enabled: true }) })
        expect(enable.ok).toBe(false)
        expect((await (await fetch(monitoringUrl, { headers })).json()).enabled).toBe(false)
        // Close the app, edit by hand (stale checksum) and reopen: the first read adopts it.
        const metadataFile = path.join(dataRoot, characterPath, 'metadata.json')
        fs.writeFileSync(metadataFile, JSON.stringify({ ...JSON.parse(fs.readFileSync(metadataFile, 'utf8')), desc: 'Edited outside' }))
        const read = await fetch(`${base}/api/read`, { headers: { ...headers, 'file-path': Buffer.from('database/database.bin').toString('hex') } })
        expect(read.status, await read.clone().text()).toBe(200)
        const loaded = await decodeRisuSave(Buffer.from(await read.arrayBuffer()))
        expect(loaded.characters[0].desc).toBe('Edited outside')
        expect(fs.readFileSync(metadataFile, 'utf8')).toContain('Edited outside')
        expect(await sync()).toMatchObject({ enabled: false })
        // A broken hand edit is reported with its location and left untouched.
        const fixed = fs.readFileSync(metadataFile, 'utf8')
        const broken = '{\n  "chaId": "one",\n  "name": "One"\n  "desc": "x"\n}\n'
        fs.writeFileSync(metadataFile, broken)
        const failed = await fetch(`${base}/api/read`, { headers: { ...headers, 'file-path': Buffer.from('database/database.bin').toString('hex') } })
        expect(failed.status).toBe(500)
        expect((await failed.json()).error).toContain("metadata.json (line 4, column 3: Expected ',' or '}' after property value)")
        expect(fs.readFileSync(metadataFile, 'utf8')).toBe(broken)
        fs.writeFileSync(metadataFile, fixed)
        const legacyId = loaded.characters[0].chats[1].id
        expect(legacyId).toEqual(expect.any(String))
        expect(legacyId.length).toBeGreaterThan(0)
        const legacyChat = await fetch(`${base}/api/chat-content/one/1`, { headers: { ...headers, 'x-chat-id': legacyId } })
        expect(legacyChat.ok).toBe(true)
        expect(await decodeRisuSave(Buffer.from(await legacyChat.arrayBuffer()))).toMatchObject({
            id: legacyId, name: 'Legacy chat', message: [{ role: 'user', data: 'Preserved legacy message' }],
        })
    } finally {
        child.kill()
        if (child.exitCode === null) await new Promise(resolve => child.once('exit', resolve))
        fs.rmSync(root, { recursive: true, force: true })
    }
}, 20000)
