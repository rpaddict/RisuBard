import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const { createSaveObservation } = require('./save-observation.cjs')

const roots: string[] = []

function tempRoot() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'risubard-save-observation-'))
    roots.push(root)
    return root
}

afterEach(() => {
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe('save observation log', () => {
    it('persists only bounded content-free fields', async () => {
        const dataRoot = tempRoot()
        const observation = createSaveObservation({
            dataRoot,
            sessionId: 'session-test',
            now: () => 1234,
        })

        observation.record({
            kind: 'compatibility-persist',
            trigger: 'patch-debounce',
            outcome: 'success',
            durationMs: 12.75,
            databaseBytes: 4096,
            characterCount: 3,
            content: 'must not be logged',
            filePath: 'C:/private/save',
        })
        await observation.flush()

        const rows = fs.readFileSync(path.join(dataRoot, 'logs', 'storage-observation.jsonl'), 'utf8')
            .trim().split(/\r?\n/).map(line => JSON.parse(line))
        expect(rows).toEqual([{
            schemaVersion: 1,
            timestamp: 1234,
            sessionId: 'session-test',
            kind: 'compatibility-persist',
            trigger: 'patch-debounce',
            outcome: 'success',
            durationMs: 12.75,
            databaseBytes: 4096,
            characterCount: 3,
        }])
    })

    it('rotates to one bounded previous file', async () => {
        const dataRoot = tempRoot()
        const observation = createSaveObservation({ dataRoot, sessionId: 's', maxBytes: 1 })

        observation.record({ kind: 'session', outcome: 'started' })
        await observation.flush()
        observation.record({ kind: 'compatibility-persist', outcome: 'success' })
        await observation.flush()
        observation.record({ kind: 'canonical-sync', outcome: 'success' })
        await observation.flush()

        const current = fs.readFileSync(path.join(dataRoot, 'logs', 'storage-observation.jsonl'), 'utf8')
        const previous = fs.readFileSync(path.join(dataRoot, 'logs', 'storage-observation.previous.jsonl'), 'utf8')
        expect(JSON.parse(current).kind).toBe('canonical-sync')
        expect(JSON.parse(previous).kind).toBe('compatibility-persist')
    })

    it('never rejects the caller when observation storage is unavailable', async () => {
        const dataRoot = tempRoot()
        fs.writeFileSync(path.join(dataRoot, 'blocked'), 'file')
        const observation = createSaveObservation({
            dataRoot: path.join(dataRoot, 'blocked'),
            sessionId: 's',
        })

        expect(() => observation.record({ kind: 'session' })).not.toThrow()
        await expect(observation.flush()).resolves.toBeUndefined()
    })
})
