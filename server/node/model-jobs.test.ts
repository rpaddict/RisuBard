import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import http from 'node:http'
import express from 'express'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import pkg from './model-jobs.cjs'

const { createModelJobs } = pkg as {
    createModelJobs: (opts: { saveDir: string; logger?: unknown }) => any
}

const AUTH_TOKEN = 'test-token'
const SECRET_KEY = 'sk-secret-DO-NOT-PERSIST-1234567890'

// Stub with the same contract as server.cjs checkProxyAuth: sends its own
// error response and returns false when the risu-auth header is missing/wrong.
async function stubAuth(req: any, res: any) {
    if (req.headers['risu-auth'] === AUTH_TOKEN) return true
    res.status(400).send({ error: 'No auth header' })
    return false
}

function listen(server: http.Server): Promise<number> {
    return new Promise((resolve) => {
        server.listen(0, '127.0.0.1', () => {
            resolve((server.address() as any).port)
        })
    })
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function readAll(res: Response): Promise<Buffer> {
    const parts: Buffer[] = []
    for await (const chunk of res.body as any) {
        parts.push(Buffer.from(chunk))
    }
    return Buffer.concat(parts)
}

async function waitForStatus(base: string, jobId: string, statuses: string[], timeoutMs = 10_000) {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
        const res = await fetch(`${base}/api/model-jobs/${jobId}`, {
            headers: { 'risu-auth': AUTH_TOKEN },
        })
        const meta = await res.json()
        if (statuses.includes(meta.status)) return meta
        await sleep(50)
    }
    throw new Error(`job ${jobId} did not reach ${statuses.join('/')} in time`)
}

describe('model-jobs', () => {
    let saveDir: string
    let store: any
    let appServer: http.Server
    let base: string

    // Mock upstream SSE server: emits `chunks` with `delayMs` between them.
    // Controlled per-test through the shared `upstream` config object.
    let upstreamServer: http.Server
    let upstreamUrl: string
    const upstream: {
        chunks: string[]
        delayMs: number
        hang: boolean
        contentType: string
        status: number
        lastReq: http.IncomingMessage | null
        lastBody: Buffer | null
        closed: boolean
        hits: number
    } = {
        chunks: [],
        delayMs: 20,
        hang: false,
        contentType: 'text/event-stream',
        status: 200,
        lastReq: null,
        lastBody: null,
        closed: false,
        hits: 0,
    }

    beforeAll(async () => {
        saveDir = fs.mkdtempSync(path.join(os.tmpdir(), 'model-jobs-test-'))
        store = createModelJobs({ saveDir })

        const app = express()
        app.use(express.json({ limit: '10mb' }))
        store.registerRoutes(app, { auth: stubAuth })
        appServer = http.createServer(app)
        base = `http://127.0.0.1:${await listen(appServer)}`

        upstreamServer = http.createServer((req, res) => {
            upstream.lastReq = req
            upstream.hits += 1
            upstream.closed = false
            const bodyParts: Buffer[] = []
            req.on('data', (c) => bodyParts.push(c))
            req.on('end', async () => {
                upstream.lastBody = Buffer.concat(bodyParts)
                res.writeHead(upstream.status, { 'content-type': upstream.contentType })
                res.on('close', () => {
                    upstream.closed = true
                })
                for (const chunk of upstream.chunks) {
                    res.write(chunk)
                    await sleep(upstream.delayMs)
                }
                if (!upstream.hang) res.end()
            })
        })
        upstreamUrl = `http://127.0.0.1:${await listen(upstreamServer)}`
    })

    afterAll(async () => {
        store.close()
        upstreamServer.close()
        appServer.close()
        fs.rmSync(saveDir, { recursive: true, force: true })
    })

    async function createJob(overrides: Record<string, unknown> = {}) {
        const res = await fetch(`${base}/api/model-jobs`, {
            method: 'POST',
            headers: { 'risu-auth': AUTH_TOKEN, 'content-type': 'application/json' },
            body: JSON.stringify({
                targetUrl: upstreamUrl,
                method: 'POST',
                headers: {
                    authorization: `Bearer ${SECRET_KEY}`,
                    'x-api-key': SECRET_KEY,
                    'content-type': 'application/json',
                    'accept-encoding': 'gzip, deflate',
                },
                // Body is pre-serialized by the client (jobFetch) — the server
                // only accepts string bodies.
                body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
                chatId: `chat-${Math.random().toString(36).slice(2)}`,
                generationId: 'gen-1',
                adapterKind: 'openai',
                streaming: true,
                ...overrides,
            }),
        })
        return { status: res.status, json: await res.json() }
    }

    it('rejects unauthenticated requests', async () => {
        const res = await fetch(`${base}/api/model-jobs`, { method: 'POST' })
        expect(res.status).toBe(400)
    })

    it('live stream delivers exact upstream bytes and journal matches', async () => {
        upstream.chunks = ['data: {"a":1}\n\n', 'data: {"b":2}\n\n', 'data: [DONE]\n\n']
        upstream.delayMs = 60
        upstream.hang = false
        const expected = upstream.chunks.join('')

        const { status, json } = await createJob()
        expect(status).toBe(200)
        const jobId = json.jobId as string
        expect(jobId).toBeTruthy()

        const streamRes = await fetch(`${base}/api/model-jobs/${jobId}/stream`, {
            headers: { 'risu-auth': AUTH_TOKEN },
        })
        expect(streamRes.status).toBe(200)
        const received = await readAll(streamRes)
        expect(received.toString('utf-8')).toBe(expected)

        const meta = await waitForStatus(base, jobId, ['done'])
        expect(meta.upstreamStatus).toBe(200)
        expect(meta.contentType).toBe('text/event-stream')
        expect(meta.bytes).toBe(Buffer.byteLength(expected))

        // Header capture: upstream status + content-type mirrored on the stream.
        expect(streamRes.headers.get('x-model-job-upstream-status')).toBe('200')
        expect(streamRes.headers.get('content-type')).toContain('text/event-stream')

        const journal = fs.readFileSync(path.join(saveDir, 'model-jobs', jobId, 'response.journal'))
        expect(journal.toString('utf-8')).toBe(expected)

        // Recorder contract: upstream is asked for identity encoding and never
        // sees the risu-auth header; provider auth passes through untouched.
        expect(upstream.lastReq!.headers['accept-encoding']).toBe('identity')
        expect(upstream.lastReq!.headers['risu-auth']).toBeUndefined()
        expect(upstream.lastReq!.headers['authorization']).toBe(`Bearer ${SECRET_KEY}`)
    })

    it('detached job completes and replays the full journal afterwards', async () => {
        upstream.chunks = ['data: one\n\n', 'data: two\n\n', 'data: three\n\n']
        upstream.delayMs = 30
        upstream.hang = false
        const expected = upstream.chunks.join('')

        const { json } = await createJob()
        const jobId = json.jobId as string
        // No reader attached — the server must consume upstream on its own.
        await waitForStatus(base, jobId, ['done'])

        const streamRes = await fetch(`${base}/api/model-jobs/${jobId}/stream`, {
            headers: { 'risu-auth': AUTH_TOKEN },
        })
        const received = await readAll(streamRes)
        expect(received.toString('utf-8')).toBe(expected)
    })

    it('replay-then-tail: attaching mid-generation receives all bytes exactly', async () => {
        upstream.chunks = Array.from({ length: 8 }, (_, i) => `data: chunk-${i}\n\n`)
        upstream.delayMs = 120
        upstream.hang = false
        const expected = upstream.chunks.join('')

        const { json } = await createJob()
        const jobId = json.jobId as string
        // Let a few chunks land in the journal before attaching.
        await sleep(350)

        const streamRes = await fetch(`${base}/api/model-jobs/${jobId}/stream`, {
            headers: { 'risu-auth': AUTH_TOKEN },
        })
        const received = await readAll(streamRes)
        expect(received.toString('utf-8')).toBe(expected)
        await waitForStatus(base, jobId, ['done'])
    })

    it('DELETE aborts a running job and marks it aborted', async () => {
        upstream.chunks = ['data: first\n\n']
        upstream.delayMs = 20
        upstream.hang = true // upstream never ends on its own

        const { json } = await createJob()
        const jobId = json.jobId as string
        await sleep(200)

        const delRes = await fetch(`${base}/api/model-jobs/${jobId}`, {
            method: 'DELETE',
            headers: { 'risu-auth': AUTH_TOKEN },
        })
        expect(delRes.status).toBe(200)
        expect((await delRes.json()).aborted).toBe(true)

        const meta = await waitForStatus(base, jobId, ['aborted'])
        expect(meta.status).toBe('aborted')
        // Upstream connection was torn down by the abort.
        const deadline = Date.now() + 3000
        while (!upstream.closed && Date.now() < deadline) await sleep(50)
        expect(upstream.closed).toBe(true)
        upstream.hang = false
    })

    it('enforces one running job per chat (409) and allows a new one after', async () => {
        upstream.chunks = ['data: x\n\n']
        upstream.delayMs = 20
        upstream.hang = true

        const chatId = 'chat-guard'
        const first = await createJob({ chatId })
        expect(first.status).toBe(200)
        const second = await createJob({ chatId })
        expect(second.status).toBe(409)
        expect(second.json.jobId).toBe(first.json.jobId)

        // Different chat is unaffected.
        const other = await createJob({ chatId: 'chat-guard-other' })
        expect(other.status).toBe(200)

        // After the first terminates, the chat can start a new job.
        // (hang stays true until both aborts land, so neither job can slip
        // into 'done' and get DELETEd away before the status poll sees it.)
        for (const id of [first.json.jobId, other.json.jobId]) {
            await fetch(`${base}/api/model-jobs/${id}`, {
                method: 'DELETE',
                headers: { 'risu-auth': AUTH_TOKEN },
            })
            await waitForStatus(base, id, ['aborted'])
        }
        upstream.hang = false
        const third = await createJob({ chatId })
        expect(third.status).toBe(200)
        await waitForStatus(base, third.json.jobId, ['done'])
    })

    it('claim flow: unclaimed listing, claim, then excluded', async () => {
        upstream.chunks = ['data: claimable\n\n']
        upstream.delayMs = 10
        upstream.hang = false

        const { json } = await createJob()
        const jobId = json.jobId as string
        await waitForStatus(base, jobId, ['done'])

        const listRes = await fetch(`${base}/api/model-jobs?unclaimed=1`, {
            headers: { 'risu-auth': AUTH_TOKEN },
        })
        const { jobs } = await listRes.json()
        expect(jobs.some((j: any) => j.id === jobId)).toBe(true)

        const claimRes = await fetch(`${base}/api/model-jobs/${jobId}/claim`, {
            method: 'POST',
            headers: { 'risu-auth': AUTH_TOKEN },
        })
        expect(claimRes.status).toBe(200)

        const meta = await waitForStatus(base, jobId, ['done'])
        expect(meta.claimed).toBe(true)
        const listRes2 = await fetch(`${base}/api/model-jobs?unclaimed=1`, {
            headers: { 'risu-auth': AUTH_TOKEN },
        })
        const after = await listRes2.json()
        expect(after.jobs.some((j: any) => j.id === jobId)).toBe(false)
    })

    it('claiming a running job returns 409', async () => {
        upstream.chunks = ['data: y\n\n']
        upstream.hang = true
        const { json } = await createJob()
        const claimRes = await fetch(`${base}/api/model-jobs/${json.jobId}/claim`, {
            method: 'POST',
            headers: { 'risu-auth': AUTH_TOKEN },
        })
        expect(claimRes.status).toBe(409)
        upstream.hang = false
        await fetch(`${base}/api/model-jobs/${json.jobId}`, {
            method: 'DELETE',
            headers: { 'risu-auth': AUTH_TOKEN },
        })
        await waitForStatus(base, json.jobId, ['aborted'])
    })

    it('server restart marks running jobs failed', async () => {
        upstream.chunks = ['data: stale\n\n']
        upstream.hang = true
        const { json } = await createJob()
        const jobId = json.jobId as string
        await sleep(100)

        // A second store on the same save dir simulates a process restart:
        // its boot-time sweep must fail the stale 'running' row.
        const store2 = createModelJobs({ saveDir })
        const meta = store2.getJob(jobId)
        expect(meta.status).toBe('failed')
        expect(meta.error).toBe('server restart')
        store2.close()

        // Clean up the still-live in-memory job from store 1.
        upstream.hang = false
        store.deleteJob(jobId)
    })

    it('relays a non-streaming JSON body and replays it', async () => {
        upstream.chunks = [JSON.stringify({ choices: [{ message: { content: 'hello world' } }] })]
        upstream.delayMs = 0
        upstream.hang = false
        upstream.contentType = 'application/json'
        const expected = upstream.chunks.join('')

        const { json } = await createJob({ streaming: false })
        const jobId = json.jobId as string
        await waitForStatus(base, jobId, ['done'])

        const streamRes = await fetch(`${base}/api/model-jobs/${jobId}/stream`, {
            headers: { 'risu-auth': AUTH_TOKEN },
        })
        expect(streamRes.headers.get('content-type')).toContain('application/json')
        const received = await readAll(streamRes)
        expect(received.toString('utf-8')).toBe(expected)

        // Request body reached upstream as serialized JSON.
        expect(JSON.parse(upstream.lastBody!.toString('utf-8'))).toEqual({
            messages: [{ role: 'user', content: 'hi' }],
        })
        upstream.contentType = 'text/event-stream'
    })

    it('never persists auth headers or creates a SQLite database', async () => {
        const files: string[] = []
        const walk = (dir: string) => {
            for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                const p = path.join(dir, entry.name)
                if (entry.isDirectory()) walk(p)
                else files.push(p)
            }
        }
        walk(saveDir)
        expect(files.length).toBeGreaterThan(0)
        expect(fs.existsSync(path.join(saveDir, 'model-jobs.db'))).toBe(false)
        for (const file of files) {
            const content = fs.readFileSync(file)
            expect(content.includes(SECRET_KEY), `secret found in ${file}`).toBe(false)
            expect(content.includes('risu-auth'), `risu-auth found in ${file}`).toBe(false)
        }
    })

    it('rejects invalid target URLs and missing chatId', async () => {
        const bad = await createJob({ targetUrl: 'ftp://example.com/x' })
        expect(bad.status).toBe(400)
        const noChat = await createJob({ chatId: '' })
        expect(noChat.status).toBe(400)
    })

    it('rejects non-POST methods and non-string bodies', async () => {
        for (const method of ['GET', 'PUT', 'DELETE', 'PATCH']) {
            const res = await createJob({ method })
            expect(res.status, `method ${method}`).toBe(400)
        }
        const objBody = await createJob({ body: { messages: [] } })
        expect(objBody.status).toBe(400)
        // No body at all is fine (buffered upstream request without payload).
        upstream.chunks = ['data: nobody\n\n']
        upstream.hang = false
        const noBody = await createJob({ body: undefined })
        expect(noBody.status).toBe(200)
        await waitForStatus(base, noBody.json.jobId, ['done'])
    })

    it('GET /api/model-jobs requires an active or unclaimed filter', async () => {
        const res = await fetch(`${base}/api/model-jobs`, {
            headers: { 'risu-auth': AUTH_TOKEN },
        })
        expect(res.status).toBe(400)
        const active = await fetch(`${base}/api/model-jobs?active=1`, {
            headers: { 'risu-auth': AUTH_TOKEN },
        })
        expect(active.status).toBe(200)
        expect(Array.isArray((await active.json()).jobs)).toBe(true)
    })

    it('aux jobs skip the per-chat guard and never appear in the active list', async () => {
        upstream.chunks = ['data: long\n\n']
        upstream.delayMs = 20
        upstream.hang = true // keep both jobs running
        const chatId = 'chat-aux-guard'

        const main = await createJob({ chatId })
        expect(main.status).toBe(200)
        // Aux on the SAME chat is allowed (relay-only, not a generation) …
        const aux = await createJob({ chatId, kind: 'aux' })
        expect(aux.status).toBe(200)
        // … while a second main still trips the guard.
        const main2 = await createJob({ chatId })
        expect(main2.status).toBe(409)

        const activeRes = await fetch(`${base}/api/model-jobs?active=1`, {
            headers: { 'risu-auth': AUTH_TOKEN },
        })
        const activeJobs = (await activeRes.json()).jobs as { id: string }[]
        expect(activeJobs.some((j) => j.id === main.json.jobId)).toBe(true)
        expect(activeJobs.some((j) => j.id === aux.json.jobId)).toBe(false)

        for (const jobId of [main.json.jobId, aux.json.jobId]) {
            await fetch(`${base}/api/model-jobs/${jobId}`, {
                method: 'DELETE',
                headers: { 'risu-auth': AUTH_TOKEN },
            })
            await waitForStatus(base, jobId, ['aborted'])
        }
        upstream.hang = false
    })

    it('pending sends register (upsert per chat), list, and clear over HTTP', async () => {
        const reg = await fetch(`${base}/api/pending-sends`, {
            method: 'POST',
            headers: { 'risu-auth': AUTH_TOKEN, 'content-type': 'application/json' },
            body: JSON.stringify({ chatId: 'chat-ps-1', generationId: 'gen-a' }),
        })
        expect(reg.status).toBe(200)
        // Same chat again → upsert replaces, not duplicates.
        await fetch(`${base}/api/pending-sends`, {
            method: 'POST',
            headers: { 'risu-auth': AUTH_TOKEN, 'content-type': 'application/json' },
            body: JSON.stringify({ chatId: 'chat-ps-1', generationId: 'gen-b' }),
        })
        const listRes = await fetch(`${base}/api/pending-sends`, { headers: { 'risu-auth': AUTH_TOKEN } })
        const listed = (await listRes.json()).pendingSends as { chatId: string, generationId: string }[]
        const mine = listed.filter((p) => p.chatId === 'chat-ps-1')
        expect(mine).toHaveLength(1)
        expect(mine[0].generationId).toBe('gen-b')

        const del = await fetch(`${base}/api/pending-sends/chat-ps-1`, {
            method: 'DELETE', headers: { 'risu-auth': AUTH_TOKEN },
        })
        expect(del.status).toBe(200)
        const after = await fetch(`${base}/api/pending-sends`, { headers: { 'risu-auth': AUTH_TOKEN } })
        expect(((await after.json()).pendingSends as { chatId: string }[])
            .some((p) => p.chatId === 'chat-ps-1')).toBe(false)
        // Missing chatId rejected; unauthenticated rejected.
        const bad = await fetch(`${base}/api/pending-sends`, {
            method: 'POST',
            headers: { 'risu-auth': AUTH_TOKEN, 'content-type': 'application/json' },
            body: JSON.stringify({}),
        })
        expect(bad.status).toBe(400)
        const noAuth = await fetch(`${base}/api/pending-sends`)
        expect(noAuth.status).toBe(400)
    })

    it('claim is atomic: exactly one claimer wins', async () => {
        await fetch(`${base}/api/pending-sends`, {
            method: 'POST',
            headers: { 'risu-auth': AUTH_TOKEN, 'content-type': 'application/json' },
            body: JSON.stringify({ chatId: 'chat-claim-1', generationId: 'g' }),
        })
        const first = await fetch(`${base}/api/pending-sends/chat-claim-1/claim`, {
            method: 'POST', headers: { 'risu-auth': AUTH_TOKEN },
        })
        const second = await fetch(`${base}/api/pending-sends/chat-claim-1/claim`, {
            method: 'POST', headers: { 'risu-auth': AUTH_TOKEN },
        })
        expect((await first.json()).claimed).toBe(true)
        expect((await second.json()).claimed).toBe(false)
    })

    it('expired pending sends are swept by the cleanup pass', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'model-jobs-ps-'))
        let localStore = createModelJobs({ saveDir: dir })
        localStore.registerPendingSend({ chatId: 'old-chat', generationId: 'g' })
        // Backdate past the 48h window.
        localStore.close()
        const pendingPath = path.join(dir, 'model-jobs', 'pending-sends.json')
        const pending = JSON.parse(fs.readFileSync(pendingPath, 'utf8'))
        pending.items[0].created_at = Date.now() - 3 * 24 * 60 * 60 * 1000
        fs.writeFileSync(pendingPath, JSON.stringify(pending))
        localStore = createModelJobs({ saveDir: dir })
        localStore.registerPendingSend({ chatId: 'fresh-chat', generationId: 'g' })
        localStore.cleanupTerminalJobs()
        const left = localStore.listPendingSends().map((p: { chatId: string }) => p.chatId)
        expect(left).toEqual(['fresh-chat'])
        localStore.close()
        fs.rmSync(dir, { recursive: true, force: true })
    })

    it('a completed aux job stays streamable but is excluded from the unclaimed list', async () => {
        upstream.chunks = ['data: aux-result\n\n']
        upstream.delayMs = 5
        upstream.hang = false

        const aux = await createJob({ kind: 'aux' })
        expect(aux.status).toBe(200)
        const meta = await waitForStatus(base, aux.json.jobId, ['done'])
        expect(meta.kind).toBe('aux')

        // Relay contract: the journal still replays (a reconnecting client
        // resumes from it) …
        const streamRes = await fetch(`${base}/api/model-jobs/${aux.json.jobId}/stream`, {
            headers: { 'risu-auth': AUTH_TOKEN },
        })
        expect((await readAll(streamRes)).toString('utf-8')).toBe('data: aux-result\n\n')

        // … but recovery never sees it: an aux journal is not a chat message.
        const unclaimedRes = await fetch(`${base}/api/model-jobs?unclaimed=1`, {
            headers: { 'risu-auth': AUTH_TOKEN },
        })
        const unclaimedJobs = (await unclaimedRes.json()).jobs as { id: string }[]
        expect(unclaimedJobs.some((j) => j.id === aux.json.jobId)).toBe(false)
    })
    describe('unclaimed aux job reuse', () => {
        const auxBody = (tag: string) => JSON.stringify({ messages: [{ role: 'user', content: `wiki-analysis-${tag}` }] })
        const stream = async (jobId: string) => (await readAll(await fetch(`${base}/api/model-jobs/${jobId}/stream`, {
            headers: { 'risu-auth': AUTH_TOKEN },
        }))).toString('utf-8')
        const claim = (jobId: string) => fetch(`${base}/api/model-jobs/${jobId}/claim`, {
            method: 'POST', headers: { 'risu-auth': AUTH_TOKEN },
        })

        it('answers an identical aux request with the finished unclaimed job, once', async () => {
            upstream.chunks = ['data: first-analysis\n\n']
            upstream.delayMs = 0
            upstream.hang = false
            const body = auxBody('reuse')
            const first = await createJob({ kind: 'aux', body, generationId: 'aux-a' })
            await waitForStatus(base, first.json.jobId, ['done'])
            const hits = upstream.hits

            // The client that sent `first` vanished (app closed). Its re-run is byte-identical.
            upstream.chunks = ['data: second-analysis\n\n']
            const again = await createJob({ kind: 'aux', body, generationId: 'aux-b' })
            expect(again.json.jobId).toBe(first.json.jobId)
            expect(upstream.hits).toBe(hits)
            expect(await stream(again.json.jobId)).toBe('data: first-analysis\n\n')

            // Once delivered (claimed) it is never handed out again: a repeat is a real retry.
            await claim(again.json.jobId)
            const retry = await createJob({ kind: 'aux', body, generationId: 'aux-c' })
            expect(retry.json.jobId).not.toBe(first.json.jobId)
            await waitForStatus(base, retry.json.jobId, ['done'])
            expect(upstream.hits).toBe(hits + 1)
            expect(await stream(retry.json.jobId)).toBe('data: second-analysis\n\n')
            await claim(retry.json.jobId)
        })

        it('never reuses across a different body, streaming mode, main jobs or a failed upstream', async () => {
            upstream.chunks = ['data: x\n\n']
            upstream.delayMs = 0
            upstream.hang = false
            const body = auxBody('strict')
            const base1 = await createJob({ kind: 'aux', body })
            await waitForStatus(base, base1.json.jobId, ['done'])

            const otherBody = await createJob({ kind: 'aux', body: auxBody('strict-2') })
            const otherMode = await createJob({ kind: 'aux', body, streaming: false })
            const main = await createJob({ body })
            for (const job of [otherBody, otherMode, main]) {
                expect(job.json.jobId).not.toBe(base1.json.jobId)
                await waitForStatus(base, job.json.jobId, ['done'])
            }

            upstream.status = 500
            const failedBody = auxBody('upstream-500')
            const failed = await createJob({ kind: 'aux', body: failedBody })
            await waitForStatus(base, failed.json.jobId, ['done', 'failed'])
            upstream.status = 200
            const afterFailure = await createJob({ kind: 'aux', body: failedBody })
            expect(afterFailure.json.jobId).not.toBe(failed.json.jobId)
            await waitForStatus(base, afterFailure.json.jobId, ['done'])
        })

        it('finds a reusable job after a server restart', async () => {
            upstream.chunks = ['data: before-restart\n\n']
            upstream.delayMs = 0
            upstream.hang = false
            const body = auxBody('restart')
            const first = await createJob({ kind: 'aux', body })
            await waitForStatus(base, first.json.jobId, ['done'])

            const restarted = createModelJobs({ saveDir })
            try {
                const app = express()
                app.use(express.json({ limit: '10mb' }))
                restarted.registerRoutes(app, { auth: stubAuth })
                const server = http.createServer(app)
                const restartedBase = `http://127.0.0.1:${await listen(server)}`
                const res = await fetch(`${restartedBase}/api/model-jobs`, {
                    method: 'POST',
                    headers: { 'risu-auth': AUTH_TOKEN, 'content-type': 'application/json' },
                    body: JSON.stringify({ targetUrl: upstreamUrl, method: 'POST', headers: {}, body,
                        chatId: 'chat-restart', generationId: 'gen-restart', adapterKind: 'openai', streaming: true, kind: 'aux' }),
                })
                expect((await res.json()).jobId).toBe(first.json.jobId)
                server.close()
            } finally {
                restarted.close()
            }
        })
    })
})

// Rotation policy is exercised on a dedicated store so seeded rows cannot
// interfere with (or be evicted by) the HTTP tests above.
describe('model-jobs rotation', () => {
    const DAY = 24 * 60 * 60 * 1000

    function seedTerminal(
        saveDir: string,
        rows: { id: string; claimed: number; endedAt: number; kind?: string }[],
    ) {
        for (const row of rows) {
            const dir = path.join(saveDir, 'model-jobs', row.id)
            fs.mkdirSync(dir, { recursive: true })
            fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({
                schemaVersion: 1,
                id: row.id,
                chat_id: `chat-${row.id}`,
                kind: row.kind ?? 'main',
                streaming: 0,
                status: 'done',
                created_at: row.endedAt - 1000,
                ended_at: row.endedAt,
                bytes: 0,
                claimed: row.claimed,
            }))
        }
    }

    it('age expiry deletes only claimed terminal jobs', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'model-jobs-rot-'))
        const old = Date.now() - 8 * DAY
        seedTerminal(dir, [
            { id: 'old-claimed', claimed: 1, endedAt: old },
            { id: 'old-unclaimed', claimed: 0, endedAt: old },
            { id: 'fresh-claimed', claimed: 1, endedAt: Date.now() },
        ])
        const store = createModelJobs({ saveDir: dir })
        store.cleanupTerminalJobs()
        expect(store.getJob('old-claimed')).toBeNull()
        // An unclaimed response is never age-expired — an offline client must
        // still be able to recover it after more than 7 days.
        expect(store.getJob('old-unclaimed')).not.toBeNull()
        expect(store.getJob('fresh-claimed')).not.toBeNull()
        store.close()
        fs.rmSync(dir, { recursive: true, force: true })
    })

    it('age expiry also deletes unclaimed AUX jobs — nothing ever recovers them', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'model-jobs-rot-'))
        const old = Date.now() - 8 * DAY
        seedTerminal(dir, [
            { id: 'old-unclaimed-aux', claimed: 0, endedAt: old, kind: 'aux' },
            { id: 'old-unclaimed-main', claimed: 0, endedAt: old },
        ])
        const store = createModelJobs({ saveDir: dir })
        store.cleanupTerminalJobs()
        expect(store.getJob('old-unclaimed-aux')).toBeNull()
        expect(store.getJob('old-unclaimed-main')).not.toBeNull()
        store.close()
        fs.rmSync(dir, { recursive: true, force: true })
    })

    it('overflow eviction removes claimed jobs before unclaimed ones', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'model-jobs-rot-'))
        const now = Date.now()
        const rows: { id: string; claimed: number; endedAt: number }[] = []
        for (let i = 0; i < 30; i++) {
            rows.push({ id: `unclaimed-${i}`, claimed: 0, endedAt: now - i * 1000 })
            rows.push({ id: `claimed-${i}`, claimed: 1, endedAt: now - i * 1000 })
        }
        seedTerminal(dir, rows)
        const store = createModelJobs({ saveDir: dir })
        store.cleanupTerminalJobs()
        // 60 terminal jobs, cap 50 → 10 evicted. Keep order is unclaimed-first
        // then newest, so ALL 30 unclaimed survive and the 10 oldest claimed go.
        for (let i = 0; i < 30; i++) {
            expect(store.getJob(`unclaimed-${i}`), `unclaimed-${i}`).not.toBeNull()
        }
        for (let i = 0; i < 20; i++) {
            expect(store.getJob(`claimed-${i}`), `claimed-${i}`).not.toBeNull()
        }
        for (let i = 20; i < 30; i++) {
            expect(store.getJob(`claimed-${i}`), `claimed-${i}`).toBeNull()
        }
        store.close()
        fs.rmSync(dir, { recursive: true, force: true })
    })
})
