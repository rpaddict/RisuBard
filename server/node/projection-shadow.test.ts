import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readFileSync } from 'node:fs'

const { createUserDataRepository } = require('./user-data-repository.cjs')
let createProjectionShadow: any
try {
    ({ createProjectionShadow } = require('./projection-shadow.cjs'))
} catch {
    createProjectionShadow = undefined
}

const roots: string[] = []

function tempRoot() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'risubard-projection-shadow-'))
    roots.push(root)
    return root
}

function legacyDatabase() {
    return {
        formatversion: 5,
        language: 'ko',
        botPresets: [{ id: 'preset-1', name: 'Preset' }],
        modules: [],
        personas: [],
        loreBook: [],
        characters: [{
            chaId: 'char-1',
            name: 'Private character name',
            chats: [{
                id: 'chat-1',
                name: 'Private chat name',
                message: [{ id: 'message-1', role: 'user', data: 'Private message body' }],
            }],
        }],
    }
}

afterEach(() => {
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe('S1 projection shadow', () => {
    it.each(['patch-debounce', 'canonical-flush'])('samples verified %s saves and checks immediately after mismatch or loss of eligibility', async (sampledTrigger) => {
        let time = 0, reads = 0, eligible = true
        const tasks: Array<() => Promise<void>> = [], rows: any[] = []
        const shadow = createProjectionShadow({
            repository: { exportLegacyDatabase: () => { reads++; return { language: 'ko' } } },
            now: () => time, minIntervalMs: 30000, canSkip: () => eligible,
            observation: { record: (row: any) => rows.push(row) },
            scheduleTask: (task: () => Promise<void>) => tasks.push(task),
        })
        const save = async (trigger = sampledTrigger, language = 'ko') => {
            shadow.schedule({ database: { language }, trigger }); await tasks.shift()!()
        }
        await save(); time = 1000; await save()
        expect(reads).toBe(1)
        expect(rows.at(-1)).toMatchObject({ outcome: 'skipped', errorStage: 'sample-interval' })
        time = 30000; await save(); expect(reads).toBe(2)
        await save('flush', 'en'); expect(reads).toBe(3)
        await save(); expect(reads).toBe(4)
        eligible = false; await save(); expect(reads).toBe(5)
        eligible = true
        shadow.schedule({ database: { language: 'ko' }, trigger: sampledTrigger, allowSampling: false })
        await tasks.shift()!()
        expect(reads).toBe(6)
    })
    it('reports match, mismatch and read failure to the P1 eligibility gate', async () => {
        let read: () => any = () => ({ language: 'ko' })
        const tasks: Array<() => Promise<void>> = []
        const comparisons: boolean[] = []
        const shadow = createProjectionShadow({
            repository: { exportLegacyDatabase: () => read() },
            scheduleTask: (task: () => Promise<void>) => tasks.push(task),
            onComparison: (match: boolean) => comparisons.push(match),
        })
        for (const value of ['ko', 'en']) {
            shadow.schedule({ database: { language: value } })
            await tasks.shift()!()
        }
        read = () => { throw new Error('read failed') }
        shadow.schedule({ database: { language: 'ko' } })
        await tasks.shift()!()
        expect(comparisons).toEqual([true, false, false])
    })
    it('runs from the successful canonical projection boundary', () => {
        const server = readFileSync(path.join(process.cwd(), 'server', 'node', 'server.cjs'), 'utf8')

        expect(server).toContain("require('./projection-shadow.cjs')")
        expect(server).toContain('projectionShadow.schedule({')
        expect(server).toContain('database: databaseObject')
    })

    it('compares the committed projection without publishing another copy', async () => {
        expect(createProjectionShadow).toBeTypeOf('function')
        if (!createProjectionShadow) return

        const repository = createUserDataRepository({ dataRoot: tempRoot() })
        const database = legacyDatabase()
        const imported = repository.importLegacyDatabase(database, { mode: 'sync' })
        const tasks: Array<() => Promise<void>> = []
        const rows: any[] = []
        const shadow = createProjectionShadow({
            repository,
            observation: { record: (row: any) => rows.push(row) },
            scheduleTask: (task: () => Promise<void>) => { tasks.push(task) },
            isPersisting: () => false,
        })

        expect(shadow.schedule({ database, trigger: 'chat-debounce', plannedFiles: imported.files })).toBe(true)
        expect(tasks).toHaveLength(1)
        await tasks[0]()

        expect(rows).toEqual([expect.objectContaining({
            kind: 'projection-shadow',
            trigger: 'chat-debounce',
            outcome: 'success',
            semanticMatch: true,
            plannedFiles: imported.files,
        })])
        expect(JSON.stringify(rows)).not.toContain('Private')
    })

    it('accepts the malformed legacy shapes observed in the S1 runtime', async () => {
        expect(createProjectionShadow).toBeTypeOf('function')
        if (!createProjectionShadow) return

        const repository = createUserDataRepository({ dataRoot: tempRoot() })
        const database: any = legacyDatabase()
        database.collectionOrganizers = { promptPresets: { folderByItemId: {} } }
        database.seperateParameters = { first: {}, second: {} }
        database.characters[0].chats[0].id = ''
        delete database.characters[0].chats[0].message
        const imported = repository.importLegacyDatabase(database, { mode: 'sync' })
        const tasks: Array<() => Promise<void>> = []
        const rows: any[] = []
        const shadow = createProjectionShadow({
            repository,
            observation: { record: (row: any) => rows.push(row) },
            scheduleTask: (task: () => Promise<void>) => { tasks.push(task) },
        })

        shadow.schedule({ database, trigger: 'chat-debounce', plannedFiles: imported.files })
        await tasks[0]()

        expect(rows).toEqual([expect.objectContaining({ outcome: 'success', semanticMatch: true })])
    })

    it('compares the JSON-persisted meaning of explicit undefined chat metadata', async () => {
        expect(createProjectionShadow).toBeTypeOf('function')
        if (!createProjectionShadow) return

        const repository = createUserDataRepository({ dataRoot: tempRoot() })
        const database: any = legacyDatabase()
        database.characters[0].chats[0].folderId = undefined
        const imported = repository.importLegacyDatabase(database, { mode: 'sync' })
        const tasks: Array<() => Promise<void>> = []
        const rows: any[] = []
        const shadow = createProjectionShadow({
            repository,
            observation: { record: (row: any) => rows.push(row) },
            scheduleTask: (task: () => Promise<void>) => { tasks.push(task) },
        })

        shadow.schedule({ database, trigger: 'chat-debounce', plannedFiles: imported.files })
        await tasks[0]()

        expect(rows).toEqual([expect.objectContaining({ outcome: 'success', semanticMatch: true })])
    })

    it('reports only a content-free mismatch result and never throws into saving', async () => {
        expect(createProjectionShadow).toBeTypeOf('function')
        if (!createProjectionShadow) return

        const repository = createUserDataRepository({ dataRoot: tempRoot() })
        const database = legacyDatabase()
        repository.importLegacyDatabase(database, { mode: 'sync' })
        const tasks: Array<() => Promise<void>> = []
        const rows: any[] = []
        const shadow = createProjectionShadow({
            repository,
            observation: { record: (row: any) => rows.push(row) },
            scheduleTask: (task: () => Promise<void>) => { tasks.push(task) },
            isPersisting: () => false,
        })

        expect(() => shadow.schedule({
            database: { ...database, language: 'en' },
            trigger: 'flush',
            plannedFiles: 9,
        })).not.toThrow()
        await tasks[0]()

        expect(rows).toEqual([expect.objectContaining({
            kind: 'projection-shadow',
            outcome: 'mismatch',
            errorStage: 'semantic-compare',
            semanticMatch: false,
        })])
        expect(JSON.stringify(rows)).not.toContain('Private')
    })

    it('skips comparison while a compatibility persist is active', async () => {
        expect(createProjectionShadow).toBeTypeOf('function')
        if (!createProjectionShadow) return

        const tasks: Array<() => Promise<void>> = []
        const rows: any[] = []
        const shadow = createProjectionShadow({
            repository: { exportLegacyDatabase: () => { throw new Error('must not read') } },
            observation: { record: (row: any) => rows.push(row) },
            scheduleTask: (task: () => Promise<void>) => { tasks.push(task) },
            isPersisting: () => true,
        })

        shadow.schedule({ database: legacyDatabase(), trigger: 'patch-debounce', plannedFiles: 9 })
        await tasks[0]()

        expect(rows).toEqual([expect.objectContaining({
            kind: 'projection-shadow',
            outcome: 'skipped',
            errorStage: 'persist-active',
        })])
    })
})
