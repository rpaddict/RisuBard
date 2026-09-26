import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import ts from 'typescript'
import { expect, test, vi } from 'vitest'

const source = readFileSync(resolve(process.cwd(), 'src/ts/globalApi.svelte.ts'), 'utf8')
const start = source.indexOf('    async function triggerSave(')
const end = source.indexOf('    let savetrys = 0', start)
const controller = ts.transpile(source.slice(start, end), { target: ts.ScriptTarget.ES2022 })

function fixture(dirty = true) {
    const sync = vi.fn(async () => {})
    const save = vi.fn(async () => 'saved')
    const flush = vi.fn(async () => {})
    const create = new Function('syncLiveFilesNow', 'persistTrackedChanges', 'flushServerDbNow', 'initialDirty', `
        let saveInFlight = null, requestImmediateSaveImpl, savetrys = 0, changed = false, forceFullWriteOnRetry = false, gotChannel = false;
        const supportsPatchSync = true, saving = {}, lastLiveError = '';
        const saveRuntime = { isActive: () => true }, language = { sessionSavePausedTitle: 'paused' };
        const changeTracker = { dirty: initialDirty };
        const hasTrackedChanges = value => value.dirty;
        const takeTrackedChanges = () => { const result = {...changeTracker}; changeTracker.dirty = false; return result; };
        const requeueTrackedChanges = () => { changeTracker.dirty = true; };
        const tick = async () => {}, refreshThisRuntime = syncLiveFilesNow;
        const sleep = async () => {}, alertError = () => {}, sessionHandoff = { show() {} };
        ${controller}
        return requestImmediateSaveImpl;
    `)
    return { sync, save, flush, request: create(sync, save, flush, dirty) }
}

test('immediate saves reconcile live files once before writing and then await a canonical flush', async () => {
    const f = fixture()
    await f.request({ flushServer: 'canonical', rejectOnFailure: true })
    expect(f.sync).toHaveBeenCalledOnce()
    expect(f.save).toHaveBeenCalledOnce()
    expect(f.flush).toHaveBeenCalledWith(false, true)
    expect(f.sync.mock.invocationCallOrder[0]).toBeLessThan(f.save.mock.invocationCallOrder[0])
    expect(f.save.mock.invocationCallOrder[0]).toBeLessThan(f.flush.mock.invocationCallOrder[0])
})

test('an immediate save still refreshes external files when there are no local changes', async () => {
    const f = fixture(false)
    await f.request({ rejectOnFailure: true })
    expect(f.sync).toHaveBeenCalledOnce()
    expect(f.save).not.toHaveBeenCalled()
})

test('failed preflight prevents a write and failed flush rejects the save', async () => {
    const f = fixture()
    f.sync.mockRejectedValueOnce(new Error('external conflict'))
    await expect(f.request({ flushServer: 'canonical', rejectOnFailure: true })).rejects.toThrow('external conflict')
    expect(f.save).not.toHaveBeenCalled()
    expect(f.flush).not.toHaveBeenCalled()
    f.flush.mockRejectedValueOnce(new Error('disk full'))
    await expect(f.request({ flushServer: 'canonical', rejectOnFailure: true })).rejects.toThrow('disk full')
})
