import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const { createExternalEditSession } = require('./external-edit-session.cjs')

describe('external canonical-file edit session', () => {
    it('flushes pending browser saves before pausing and captures the canonical revision', async () => {
        const events: string[] = []
        const session = createExternalEditSession({
            flush: async () => { events.push('flush') },
            getRevision: () => 'revision-1',
            adopt: vi.fn(),
        })

        await expect(session.start()).resolves.toEqual({
            active: true,
            baselineRevision: 'revision-1',
        })
        expect(events).toEqual(['flush'])
        expect(session.isActive()).toBe(true)
    })

    it('adopts externally edited files before unpausing', async () => {
        const session = createExternalEditSession({
            flush: async () => {},
            getRevision: () => 'revision-1',
            adopt: () => ({ revision: 'revision-2' }),
        })
        await session.start()

        await expect(session.finish()).resolves.toEqual({
            active: false,
            adopted: true,
            revision: 'revision-2',
        })
        expect(session.isActive()).toBe(false)
    })

    it('stays paused when an external file cannot be validated', async () => {
        const session = createExternalEditSession({
            flush: async () => {},
            getRevision: () => 'revision-1',
            adopt: () => { throw new Error('invalid external JSON') },
        })
        await session.start()

        await expect(session.finish()).rejects.toThrow('invalid external JSON')
        expect(session.isActive()).toBe(true)
    })

    it('still scans and adopts when finish follows a server restart', async () => {
        const session = createExternalEditSession({
            flush: async () => {},
            getRevision: () => 'revision-2',
            adopt: () => ({ revision: 'revision-2' }),
        })

        await expect(session.finish()).resolves.toMatchObject({
            active: false,
            adopted: true,
            revision: 'revision-2',
        })
    })
})

describe('external edit session server wiring', () => {
    const server = readFileSync(resolve(process.cwd(), 'server/node/server.cjs'), 'utf8')

    it('exposes authenticated status, start, and finish endpoints', () => {
        expect(server).toContain("require('./external-edit-session.cjs')")
        expect(server).toContain("app.get('/api/external-edit/status'")
        expect(server).toContain("app.post('/api/external-edit/start'")
        expect(server).toContain("app.post('/api/external-edit/finish'")
    })

    it('blocks database, patch, chat, read-flush, and explicit flush writes while paused', () => {
        expect(server.match(/externalEditSession\.isActive\(\)/g)?.length ?? 0).toBeGreaterThanOrEqual(5)
        expect(server).toContain("code: 'EXTERNAL_EDIT_MODE'")
    })
})
