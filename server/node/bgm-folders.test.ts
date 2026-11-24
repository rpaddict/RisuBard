import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
const { createBgmFolders, registerBgmRoutes } = require('./bgm-folders.cjs')

let base: string
let dataRoot: string
let music: string

beforeEach(() => {
    base = fs.mkdtempSync(path.join(os.tmpdir(), 'bgm-folders-'))
    dataRoot = path.join(base, 'data')
    music = path.join(base, 'music')
    fs.mkdirSync(path.join(dataRoot, 'settings'), { recursive: true })
    fs.mkdirSync(path.join(music, 'battle'), { recursive: true })
    fs.writeFileSync(path.join(music, 'calm.mp3'), 'a')
    fs.writeFileSync(path.join(music, 'battle', 'boss.ogg'), 'b')
    fs.writeFileSync(path.join(music, 'notes.txt'), 'c')
    fs.writeFileSync(path.join(base, 'secret.mp3'), 'd')
})
afterEach(() => fs.rmSync(base, { recursive: true, force: true }))

it('saves only existing absolute folders and keeps ids stable across edits', () => {
    const folders = createBgmFolders(dataRoot)
    expect(folders.replace([{ path: 'relative/music' }]).errors).toEqual([{ index: 0, reason: 'not-absolute' }])
    expect(folders.replace([{ path: path.join(base, 'missing') }]).errors).toEqual([{ index: 0, reason: 'missing' }])
    expect(folders.list()).toEqual([])
    const saved = folders.replace([{ path: music, name: 'My music' }]).folders
    expect(saved).toHaveLength(1)
    const again = folders.replace([{ path: music }]).folders
    expect(again[0].id).toBe(saved[0].id)
    expect(folders.replace([{ path: music }, { path: music }]).errors).toEqual([{ index: 1, reason: 'duplicate' }])
})

it('serves only audio files inside a registered folder', () => {
    const folders = createBgmFolders(dataRoot)
    const [{ id }] = folders.replace([{ path: music }]).folders
    expect(folders.resolveFile(id, 'battle/boss.ogg')).toBe(fs.realpathSync.native(path.join(music, 'battle', 'boss.ogg')))
    expect(folders.resolveFile(id, 'notes.txt')).toBeNull()
    expect(folders.resolveFile(id, '../secret.mp3')).toBeNull()
    expect(folders.resolveFile(id, '..\\secret.mp3')).toBeNull()
    expect(folders.resolveFile(id, path.join(base, 'secret.mp3'))).toBeNull()
    expect(folders.resolveFile('unknown', 'calm.mp3')).toBeNull()
})

it('scans audio files recursively and maps pasted paths back to folders', () => {
    const folders = createBgmFolders(dataRoot)
    const [{ id }] = folders.replace([{ path: music }]).folders
    expect(folders.scan(id)).toEqual({ files: ['battle/boss.ogg', 'calm.mp3'], truncated: false })
    expect(folders.locate(path.join(music, 'battle', 'boss.ogg'))).toEqual({ folderId: id, relPath: 'battle/boss.ogg' })
    expect(folders.locate(path.join(base, 'secret.mp3'))).toBeNull()
    expect(folders.locate(path.join(music, 'notes.txt'))).toBeNull()
})

it('requires auth for every route and writer ownership for edits', async () => {
    const routes: Record<string, Function> = {}
    const deps = {
        auth: vi.fn(async () => false),
        activeSession: vi.fn(() => true),
        sessionAuth: vi.fn(),
        folders: { list: vi.fn(() => []), replace: vi.fn(), scan: vi.fn(), locate: vi.fn(), resolveFile: vi.fn() },
    }
    const register = (method: string) => (route: string, ...handlers: Function[]) => { routes[`${method} ${route}`] = handlers.at(-1)!; if (handlers.length > 1) routes[`${method} ${route} guard`] = handlers[0] }
    registerBgmRoutes({ get: register('GET'), put: register('PUT'), post: register('POST') }, deps)
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn(), set: vi.fn().mockReturnThis(), end: vi.fn() }
    await routes['GET /api/bgm/folders']({}, res)
    await routes['PUT /api/bgm/folders']({ body: { folders: [] } }, res, vi.fn())
    await routes['POST /api/bgm/locate']({ body: { path: '/x.mp3' } }, res)
    expect(deps.folders.list).not.toHaveBeenCalled()
    expect(deps.folders.replace).not.toHaveBeenCalled()
    expect(deps.folders.locate).not.toHaveBeenCalled()
    expect(routes['GET /api/bgm/file/:folderId/:hexPath guard']).toBe(deps.sessionAuth)
    deps.auth.mockResolvedValue(true)
    deps.activeSession.mockReturnValue(false)
    await routes['PUT /api/bgm/folders']({ body: { folders: [] } }, res, vi.fn())
    expect(deps.folders.replace).not.toHaveBeenCalled()
})

it('rejects malformed file addresses before touching the disk', () => {
    const routes: Record<string, Function> = {}
    const folders = { resolveFile: vi.fn(() => null) }
    registerBgmRoutes({ get: (route: string, ...handlers: Function[]) => { routes[route] = handlers.at(-1)! }, put: vi.fn(), post: vi.fn() }, { auth: vi.fn(), activeSession: vi.fn(), sessionAuth: vi.fn(), folders })
    const res = { status: vi.fn().mockReturnThis(), set: vi.fn().mockReturnThis(), end: vi.fn() }
    routes['/api/bgm/file/:folderId/:hexPath']({ params: { folderId: 'a', hexPath: 'zz' } }, res)
    expect(folders.resolveFile).toHaveBeenCalledWith('a', '')
    expect(res.status).toHaveBeenCalledWith(404)
})
