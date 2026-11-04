import { expect, test, vi } from 'vitest'
import { createCanonicalSaveConflict } from './canonicalSaveConflict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import ts from 'typescript'
import { uploadChatContent } from './chatContentUpload'

const source = readFileSync(resolve(process.cwd(), 'src/ts/globalApi.svelte.ts'), 'utf8')
function productionFunction(start: string, end: string) {
    const first = source.indexOf(start)
    expect(first).toBeGreaterThan(-1)
    return ts.transpile(source.slice(first, source.indexOf(end, first)), { target: ts.ScriptTarget.ES2022 })
}

test('cancel keeps the conflict pending and never authorizes a fallback write', async () => {
    const conflict = createCanonicalSaveConflict()
    conflict.mark()
    const apply = vi.fn()
    expect(await conflict.resolve(async () => 'cancel', apply, vi.fn())).toBe('noop')
    expect(conflict.pending()).toBe(true)
    expect(apply).not.toHaveBeenCalled()
    expect(await conflict.resolve(async () => 'keep', apply, vi.fn())).toBe('retry')
    expect(apply).toHaveBeenCalledTimes(1)
    expect(conflict.pending()).toBe(false)
})

test('export preserves the unresolved conflict; failed rebase also remains pending', async () => {
    const conflict = createCanonicalSaveConflict()
    conflict.mark()
    const download = vi.fn()
    const apply = vi.fn(async () => { throw new Error('offline') })
    expect(await conflict.resolve(async () => 'download', apply, download)).toBe('noop')
    expect(download).toHaveBeenCalledOnce()
    expect(apply).not.toHaveBeenCalled()
    expect(conflict.pending()).toBe(true)
    await expect(conflict.resolve(async () => 'keep', apply, download)).rejects.toThrow('offline')
    expect(conflict.pending()).toBe(true)
})

test('production full-write retries must resolve pending conflicts before any transport', async () => {
    const conflict = createCanonicalSaveConflict()
    conflict.mark()
    const resolveConflict = vi.fn(async () => 'noop')
    const code = productionFunction('    async function persistTrackedChanges(', '    async function triggerSave(')
    const persist = new Function('canonicalSaveConflict', 'resolveCanonicalSaveConflict', `${code}; return persistTrackedChanges`)(conflict, resolveConflict)
    // All other persistence dependencies are intentionally absent: reaching
    // transport instead of the conflict gate would fail this test.
    expect(await persist({ botPreset: true }, { forceFullWrite: true })).toBe('noop')
    expect(resolveConflict).toHaveBeenCalledOnce()
    expect(source).not.toContain('reloadAfterExternalCanonicalChange')
})

test('production rebase retains edits made during fetch and leaves unrelated server items intact', async () => {
    const code = productionFunction('    async function rebaseTrackedLocalChangesOnLatestServerDb(', '    async function resolveCanonicalSaveConflict(')
    const flags = { character: [], chat: [], root: true, botPreset: false, modules: false, plugins: false, pluginCustomStorage: false }
    let local: any = { customCSS: 'initial', characters: [], botPresets: [], modules: [], plugins: [] }
    const remote = { customCSS: 'external', characters: [{ chaId: 'remote', chats: [] }], botPresets: [], modules: [{ id: 'remote-module' }] }
    const getItem = async () => {
        local.customCSS = 'edited during fetch'
        local.botPresets = [{ id: 'copy', name: 'test' }]
        local.characters = [{ chaId: 'local', chats: [{ id: 'chat', message: [{ role: 'user', data: 'new message' }] }] }]
        Object.assign(flags, { botPreset: true, chat: [['local', 'chat']] })
        return new Uint8Array([1])
    }
    const create = new Function('getDatabase', 'setDatabase', 'changeTracker', 'getItem', 'decodeRisuSave', `
        let changed = false, encoder, patcher;
        const safeStructuredClone = structuredClone;
        const forageStorage = { setDbEtag() {}, getItem };
        const requeueTrackedChanges = value => { for (const key in value) {
            if (Array.isArray(value[key])) changeTracker[key] = [...changeTracker[key], ...value[key]];
            else changeTracker[key] ||= value[key];
        }};
        const supportsPatchSync = true;
        class RisuSaveEncoder { async init() {} }
        class RisuSavePatcher { async init() {} }
        const convertStubsToPlaceholders = chats => chats;
        ${code}
        return rebaseTrackedLocalChangesOnLatestServerDb;
    `)
    const rebase = create(() => local, (value: any) => { local = value }, flags, getItem, async () => remote)
    await rebase('etag', local, structuredClone(flags))
    expect(local.customCSS).toBe('edited during fetch')
    expect(local.botPresets[0].name).toBe('test')
    expect(local.characters.map((c: any) => c.chaId)).toEqual(['remote', 'local'])
    expect(local.characters[1].chats[0].message[0].data).toBe('new message')
    expect(local.modules).toEqual(remote.modules)
})

function chatContentHandler(awaitingReview: boolean, adopt: () => Promise<unknown>) {
    const server = readFileSync(resolve(process.cwd(), 'server/node/server.cjs'), 'utf8')
    const ast = ts.createSourceFile('server.cjs', server, ts.ScriptTarget.Latest, true)
    const route = ast.statements.find(s => ts.isFunctionDeclaration(s)
        && s.name?.text === 'saveChatContentHandler')!
    expect(route).toBeTruthy()
    return new Function('checkAuth', 'checkActiveSession', 'queueStorageOperation', 'externalEditSession',
        'checkExternalChangesAwaitingReview', 'sendExternalChangesPending',
        'adoptSettledExternalProjection', 'sendCanonicalProjectionConflict', `${route.getText(ast)}; return saveChatContentHandler`)(
        async () => true, () => true,
        async (fn: any) => fn(), { isActive: () => false },
        () => ({ pending: awaitingReview, revision: 'checked-revision' }),
        (response: any) => response.status(409).json({ code: 'EXTERNAL_CHANGES_PENDING' }),
        adopt,
        (response: any) => response.status(409).json({ code: 'CANONICAL_FILES_CHANGED' }),
    )
}

test('chat endpoint rejects external changes before accepting a message into its cache', async () => {
    const next = vi.fn()
    const res: any = { status: vi.fn(() => res), json: vi.fn(), send: vi.fn() }
    const adopt = vi.fn(async () => ({ etag: 'external' }))
    const handler = chatContentHandler(false, adopt)
    await handler({}, res, next)
    expect(next).not.toHaveBeenCalled()
    expect(res.status).toHaveBeenCalledWith(409)
    // The review check's scan is reused instead of scanning every file again.
    expect(adopt).toHaveBeenCalledWith(false, 'checked-revision')
})

test('chat endpoint asks for review instead of adopting external edits', async () => {
    const next = vi.fn()
    const res: any = { status: vi.fn(() => res), json: vi.fn(), send: vi.fn() }
    const adopt = vi.fn(async () => ({ etag: 'external' }))
    const handler = chatContentHandler(true, adopt)
    await handler({}, res, next)
    expect(next).not.toHaveBeenCalled()
    expect(adopt).not.toHaveBeenCalled()
    expect(res.json).toHaveBeenCalledWith({ code: 'EXTERNAL_CHANGES_PENDING' })
})

test.each(['CANONICAL_FILES_CHANGED', 'EXTERNAL_EDIT_MODE', 'EXTERNAL_CHANGES_PENDING'])('chat transport retains the %s conflict reason', async (code) => {
    const text = readFileSync(resolve(process.cwd(), 'src/ts/storage/nodeStorage.ts'), 'utf8')
    const first = text.indexOf('    async saveChatContent(')
    const last = text.indexOf('// ── Save-folder migration', first)
    const method = ts.transpile(text.slice(first, last).replace('async saveChatContent(', 'async function saveChatContent('), { target: ts.ScriptTarget.ES2022 })
    class ConflictError extends Error {
        constructor(message: string, public currentEtag: string, public canonicalFilesChanged: boolean, public externalEditMode: boolean, public externalChangesPending: boolean) { super(message) }
    }
    const save = new Function('encodeRisuSaveLegacy', 'ConflictError', 'isCanonicalFilesChangedResponse', 'isExternalChangesPendingResponse', 'uploadChatContent', 'getDatabase', `${method}; return saveChatContent`)(
        () => new Uint8Array(), ConflictError, (data: any) => data.code === 'CANONICAL_FILES_CHANGED',
        (data: any) => data.code === 'EXTERNAL_CHANGES_PENDING',
        uploadChatContent,
        () => ({ chatUploadChunkMiB: 8 }),
    )
    const context = { saveRequest: async () => ({ status: 409, json: async () => ({ code, currentEtag: 'new', error: 'conflict' }) }) }
    await expect(save.call(context, 'character', 0, 'chat', {})).rejects.toMatchObject({
        currentEtag: 'new',
        canonicalFilesChanged: code === 'CANONICAL_FILES_CHANGED',
        externalEditMode: code === 'EXTERNAL_EDIT_MODE',
        externalChangesPending: code === 'EXTERNAL_CHANGES_PENDING',
    })
})
