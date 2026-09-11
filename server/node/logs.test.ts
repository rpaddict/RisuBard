import { afterEach, describe, expect, test } from 'vitest'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fork, spawnSync, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'

const roots: string[] = []
const logsModule = resolve('server/node/logs.cjs')

function tempRoot() {
    const root = mkdtempSync(join(tmpdir(), 'risubard-logs-'))
    roots.push(root)
    mkdirSync(join(root, 'logs'), { recursive: true })
    return root
}

function waitForMessage(child: ChildProcess, type: string) {
    return new Promise<Record<string, unknown>>((resolve, reject) => {
        const onMessage = (message: unknown) => {
            if ((message as { type?: string })?.type !== type) return
            cleanup()
            resolve(message as Record<string, unknown>)
        }
        const onExit = (code: number | null) => {
            cleanup()
            reject(new Error(`log writer exited before ${type} (code ${code})`))
        }
        const cleanup = () => {
            child.off('message', onMessage)
            child.off('exit', onExit)
        }
        child.on('message', onMessage)
        child.on('exit', onExit)
    })
}

afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('file-native system logs', () => {
    test('repairs a valid log state checksum mismatch when the store opens', () => {
        const root = tempRoot()
        const statePath = join(root, 'logs', 'state.json')
        writeFileSync(statePath, JSON.stringify({ schemaVersion: 1, nextId: 8 }))
        writeFileSync(`${statePath}.sha256`, `${'0'.repeat(64)}\n`)

        const result = spawnSync(process.execPath, ['-e', `require(${JSON.stringify(logsModule)}).addLog({ level: 'info', origin: 'server', message: 'started' })`], {
            env: { ...process.env, RISUBARD_DATA_ROOT: root },
            encoding: 'utf8',
        })

        expect(result.status, result.stderr).toBe(0)
        const state = readFileSync(statePath)
        expect(readFileSync(`${statePath}.sha256`, 'utf8').trim()).toBe(createHash('sha256').update(state).digest('hex'))
        const rows = readFileSync(join(root, 'logs', 'system.jsonl'), 'utf8').trim().split(/\r?\n/).map(line => JSON.parse(line) as { id: number })
        expect(rows.map(row => row.id)).toEqual([8])
    })

    test('repairs duplicate persisted ids when the log store opens', () => {
        const root = tempRoot()
        const rows = [
            { id: 7, timestamp: 100, level: 'info', origin: 'server', message: 'first', count: 1 },
            { id: 7, timestamp: 200, level: 'warning', origin: 'server', message: 'second', count: 1 },
        ]
        writeFileSync(join(root, 'logs', 'system.jsonl'), `${rows.map(row => JSON.stringify(row)).join('\n')}\n`)
        writeFileSync(join(root, 'logs', 'state.json'), JSON.stringify({ schemaVersion: 1, nextId: 8 }))

        const result = spawnSync(process.execPath, ['-e', `require(${JSON.stringify(logsModule)}).queryLogs({ limit: 10 })`], {
            env: { ...process.env, RISUBARD_DATA_ROOT: root },
            encoding: 'utf8',
        })

        expect(result.status, result.stderr).toBe(0)
        const repaired = readFileSync(join(root, 'logs', 'system.jsonl'), 'utf8')
            .trim().split(/\r?\n/).map(line => JSON.parse(line) as { id: number })
        expect(new Set(repaired.map(row => row.id)).size).toBe(repaired.length)
        const state = JSON.parse(readFileSync(join(root, 'logs', 'state.json'), 'utf8')) as { nextId: number }
        expect(state.nextId).toBeGreaterThan(Math.max(...repaired.map(row => row.id)))
    })

    test('assigns unique ids when separate server processes write concurrently', async () => {
        const root = tempRoot()
        const workerPath = join(root, 'writer.cjs')
        writeFileSync(workerPath, `
            const logs = require(process.env.LOGS_MODULE)
            process.send({ type: 'ready' })
            process.on('message', message => {
                if (message?.type !== 'write') return
                let error = null
                try {
                    for (let index = 0; index < 25; index++) {
                        logs.addLog({ level: 'info', origin: 'server', message: process.pid + ':' + index })
                    }
                } catch (caught) {
                    error = caught?.stack || String(caught)
                }
                process.send({ type: 'done', error }, () => process.exit(0))
            })
        `)
        const workers = Array.from({ length: 4 }, () => fork(workerPath, [], {
            env: { ...process.env, RISUBARD_DATA_ROOT: root, LOGS_MODULE: logsModule },
            stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
        }))

        await Promise.all(workers.map(worker => waitForMessage(worker, 'ready')))
        const done = workers.map(worker => waitForMessage(worker, 'done'))
        const exited = workers.map(worker => new Promise<void>(resolveExit => worker.once('exit', () => resolveExit())))
        for (const worker of workers) worker.send({ type: 'write' })
        const results = await Promise.all(done)
        await Promise.all(exited)
        expect(results.map(result => result.error).filter(Boolean)).toEqual([])

        const persisted = readFileSync(join(root, 'logs', 'system.jsonl'), 'utf8')
            .trim().split(/\r?\n/).map(line => JSON.parse(line) as { id: number })
        expect(persisted).toHaveLength(100)
        expect(new Set(persisted.map(row => row.id)).size).toBe(persisted.length)
    }, 15_000)

    test('does not steal a newly-created lock before its owner records a pid', async () => {
        const root = tempRoot()
        const lockPath = join(root, 'logs', '.write.lock')
        const workerPath = join(root, 'lock-waiter.cjs')
        writeFileSync(lockPath, '')
        const freshUntil = new Date(Date.now() + 5_000)
        utimesSync(lockPath, freshUntil, freshUntil)
        writeFileSync(workerPath, `
            process.send({ type: 'ready' })
            process.on('message', message => {
                if (message?.type !== 'open') return
                process.send({ type: 'attempting' })
                let error = null
                try { require(process.env.LOGS_MODULE) } catch (caught) { error = caught?.stack || String(caught) }
                process.send({ type: 'done', error }, () => process.exit(0))
            })
        `)
        const worker = fork(workerPath, [], {
            env: { ...process.env, RISUBARD_DATA_ROOT: root, LOGS_MODULE: logsModule },
            stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
        })
        await waitForMessage(worker, 'ready')
        const attempting = waitForMessage(worker, 'attempting')
        const done = waitForMessage(worker, 'done')
        const exited = new Promise<void>(resolveExit => worker.once('exit', () => resolveExit()))
        worker.send({ type: 'open' })
        await attempting
        await new Promise(resolveWait => setTimeout(resolveWait, 25))

        expect(existsSync(lockPath)).toBe(true)
        unlinkSync(lockPath)
        const result = await done
        await exited
        expect(result.error).toBeNull()
    }, 15_000)
})
