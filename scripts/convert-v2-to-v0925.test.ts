import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { afterEach, describe, expect, test } from 'vitest'

const { createUserDataRepository } = require('../server/node/user-data-repository.cjs')
const { convertV2ToV0925 } = require('./convert-v2-to-v0925.cjs')

const roots: string[] = []

afterEach(() => {
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

function sha256(value: Buffer | string) {
    return crypto.createHash('sha256').update(value).digest('hex')
}

function writeFile(root: string, relative: string, value: Buffer | string) {
    const target = path.join(root, relative)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, value)
}

function writeJson(root: string, relative: string, value: unknown) {
    writeFile(root, relative, `${JSON.stringify(value, null, 2)}\n`)
}

function writeEntity(
    root: string,
    folder: string,
    kind: string,
    mainFile: string,
    metadata: Record<string, unknown>,
    fields: Record<string, { path: Array<string | number>, value: unknown }> = {},
) {
    writeJson(root, `${folder}/${mainFile}`, metadata)
    writeJson(root, `${folder}/manifest.json`, {
        schemaVersion: 2,
        kind,
        fieldFiles: Object.fromEntries(Object.entries(fields).map(([name, field]) => [name, field.path])),
    })
    for (const [name, field] of Object.entries(fields)) {
        writeFile(root, `${folder}/${name}`, name.endsWith('.json')
            ? JSON.stringify(field.value, null, 2)
            : String(field.value))
    }
}

function makeFixture() {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'rb-v2-to-v1-'))
    roots.push(parent)
    const source = path.join(parent, 'source-v2')
    const destination = path.join(parent, 'destination-v1')
    fs.mkdirSync(source)

    writeJson(source, 'settings/layout.json', { schemaVersion: 2, format: 'risubard-named-folders' })
    writeJson(source, 'settings/app.json', { schemaVersion: 1, selectedCharacter: 0, nested: { theme: 'dark' } })
    writeJson(source, 'secrets/credentials.json', { schemaVersion: 1, nested: { apiKey: 'secret' } })
    writeJson(source, 'index/sidebar.json', {
        schemaVersion: 2,
        updatedAt: 10,
        collections: {
            botPresets: ['preset-a'],
            modules: ['module-a'],
            personas: ['persona-a'],
            loreBook: ['lore-a'],
        },
        paths: {
            botPresets: { 'preset-a': 'prompts/규칙' },
            modules: { 'module-a': 'modules/도구' },
            personas: { 'persona-a': 'personas/화자' },
            loreBook: { 'lore-a': 'lorebooks/세계' },
        },
        characters: [{
            id: 'char-a',
            name: '주인공',
            path: 'characters/주인공',
            chats: [{ id: 'chat-a', name: '첫 대화', path: 'characters/주인공/chats/첫 대화', lastDate: 20 }],
        }],
    })

    writeEntity(source, 'prompts/규칙', 'prompt', 'settings.json', {
        id: 'preset-a', name: '규칙', promptTemplate: [{ name: '지시' }],
    }, { 'promptTemplate-0-text.md': { path: ['promptTemplate', 0, 'text'], value: '프롬프트 본문' } })
    writeEntity(source, 'modules/도구', 'module', 'module.json', {
        id: 'module-a', name: '도구', lorebook: [],
    }, { 'description.md': { path: ['description'], value: '모듈 설명' } })
    writeEntity(source, 'personas/화자', 'persona', 'persona.json', {
        id: 'persona-a', name: '화자',
    }, { 'persona_prompt.md': { path: ['personaPrompt'], value: '화자 설명' } })
    writeEntity(source, 'lorebooks/세계', 'lorebook', 'lorebook.json', {
        id: 'lore-a', name: '세계', data: [{ key: '도시', content: '설정' }],
    })
    writeEntity(source, 'characters/주인공', 'character', 'character.json', {
        chaId: 'char-a', name: '주인공', image: 'assets/avatar.png', chatPage: 0,
    }, {
        'description.md': { path: ['desc'], value: '캐릭터 설명' },
        'lorebook.json': { path: ['globalLore'], value: [{ key: '비밀', content: '내용' }] },
    })
    writeJson(source, 'characters/주인공/metadata.json', { externalLabel: '추가 메타데이터' })
    const characterJson = fs.readFileSync(path.join(source, 'characters/주인공/character.json'))
    writeFile(source, 'characters/주인공/character.json.sha256', `${sha256(characterJson)}\n`)
    writeEntity(source, 'characters/주인공/chats/첫 대화', 'chat', 'metadata.json', {
        id: 'chat-a', name: '첫 대화', localLore: [], lastDate: 20,
    }, { 'note.md': { path: ['note'], value: '대화 메모' } })
    writeFile(source, 'characters/주인공/chats/첫 대화/messages.jsonl', [
        JSON.stringify({ role: 'user', data: '안녕' }),
        JSON.stringify({ role: 'char', data: '반가워' }),
        '',
    ].join('\n'))
    writeJson(source, 'characters/주인공/chats/첫 대화/draft.json', { role: 'char', data: '초안' })

    const avatar = Buffer.from('current-avatar')
    writeFile(source, 'characters/주인공/assets/avatar.png', avatar)
    writeFile(source, 'shared/assets/avatar.png', avatar)
    writeJson(source, 'settings/asset-files.json', {
        schemaVersion: 2,
        entries: {
            'assets/avatar.png': {
                checksum: sha256(avatar),
                paths: ['characters/주인공/assets/avatar.png', 'shared/assets/avatar.png'],
            },
        },
    })

    const pluginState = Buffer.from('plugin-state')
    const staleAvatar = Buffer.from('stale-avatar')
    const staleProjection = Buffer.from('stale-database')
    for (const bytes of [pluginState, staleAvatar, staleProjection]) {
        writeFile(source, `kv/objects/${sha256(bytes)}`, bytes)
    }
    writeJson(source, 'kv/manifest.json', {
        schemaVersion: 1,
        updatedAt: 1,
        entries: {
            'plugin/state': { object: sha256(pluginState), size: pluginState.length, updatedAt: 1 },
            'assets/avatar.png': { object: sha256(staleAvatar), size: staleAvatar.length, updatedAt: 1 },
            'database/database.bin': { object: sha256(staleProjection), size: staleProjection.length, updatedAt: 1 },
        },
    })

    writeFile(source, 'risubard/wiki/.history/entry.md', '기록')
    fs.mkdirSync(path.join(source, 'risubard/wiki/empty'), { recursive: true })
    writeFile(source, 'novelist/notes/story.md', '소설')
    writeFile(source, 'inlays/layout.json', '{}')
    writeFile(source, `${['jel', 'lybard'].join('')}/state/runtime.json`, '{"enabled":true}')
    writeFile(source, 'request-logs/requests.jsonl', '{"path":"/api/test"}\n')
    writeFile(source, '__password', Buffer.from([0, 1, 2, 255]))
    writeFile(source, '__instance_id', 'instance-test-id')
    writeFile(source, '__authcode', 'registration-code')
    writeFile(source, 'plugin-files/state.bin', Buffer.from([4, 3, 2, 1]))
    writeFile(source, '.journal/source-only.json', '{}')
    writeFile(source, 'migration/source-only.json', '{}')
    writeFile(source, 'trash/source-only.txt', 'discarded')
    return { parent, source, destination, avatar, pluginState }
}

function inventory(root: string): string[] {
    const result: string[] = []
    function visit(relative: string) {
        const directory = path.join(root, relative)
        for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
            const child = path.join(relative, entry.name)
            if (entry.isDirectory()) {
                result.push(`d:${child.replaceAll('\\', '/')}`)
                visit(child)
            } else {
                result.push(`f:${child.replaceAll('\\', '/')}:${sha256(fs.readFileSync(path.join(root, child)))}`)
            }
        }
    }
    visit('')
    return result
}

describe('standalone V2 to v0.9.25 V1 converter', () => {
    test('the CLI creates a sibling -v1 folder when only the V2 source is supplied', () => {
        const { source } = makeFixture()
        const destination = `${source}-v1`
        const before = inventory(source)

        const result = spawnSync(process.execPath, [path.resolve('scripts/convert-v2-to-v0925.cjs'), source], {
            encoding: 'utf8',
        })

        expect(result.status, result.stderr).toBe(0)
        expect(JSON.parse(result.stdout)).toMatchObject({ destination: path.resolve(destination), characters: 1 })
        expect(result.stderr).toMatch(/\[100%\].*완료/)
        expect(fs.existsSync(path.join(destination, 'conversion/v2-to-v0925.json'))).toBe(true)
        expect(inventory(source)).toEqual(before)
    })

    test('reports monotonic progress with the current task and finishes at 100 percent', () => {
        const { source, destination } = makeFixture()
        const progress: Array<{ percent: number, message: string }> = []

        convertV2ToV0925(source, destination, {
            onProgress: (event: { percent: number, message: string }) => progress.push(event),
        })

        expect(progress.length).toBeGreaterThan(5)
        expect(progress[0]).toMatchObject({ percent: 0 })
        expect(progress.at(-1)).toMatchObject({ percent: 100 })
        expect(progress.at(-1)?.message).toMatch(/완료/)
        expect(progress.every((event, index) => index === 0 || event.percent >= progress[index - 1].percent)).toBe(true)
        expect(progress.every(event => Number.isInteger(event.percent) && event.message.length > 0)).toBe(true)
    })

    test('decodes V2 data into a verified V1 root without changing the source', () => {
        const { source, destination, avatar, pluginState } = makeFixture()
        const before = inventory(source)

        const result = convertV2ToV0925(source, destination)

        expect(result).toMatchObject({ characters: 1, assets: 1 })
        expect(inventory(source)).toEqual(before)
        const reopened = createUserDataRepository({ dataRoot: destination })
        expect(reopened.exportLegacyDatabase()).toEqual({
            selectedCharacter: 0,
            nested: { theme: 'dark', apiKey: 'secret' },
            botPresets: [{ id: 'preset-a', name: '규칙', promptTemplate: [{ name: '지시', text: '프롬프트 본문' }] }],
            modules: [{ id: 'module-a', name: '도구', lorebook: [], description: '모듈 설명' }],
            personas: [{ id: 'persona-a', name: '화자', personaPrompt: '화자 설명' }],
            loreBook: [{ id: 'lore-a', name: '세계', data: [{ key: '도시', content: '설정' }] }],
            characters: [{
                chaId: 'char-a', name: '주인공', image: 'assets/avatar.png', chatPage: 0,
                desc: '캐릭터 설명', globalLore: [{ key: '비밀', content: '내용' }],
                chats: [{
                    id: 'chat-a', name: '첫 대화', localLore: [], lastDate: 20, note: '대화 메모',
                    message: [{ role: 'user', data: '안녕' }, { role: 'char', data: '반가워' }],
                }],
            }],
        })
        expect(reopened.loadAssistantDraft('char-a', 'chat-a')).toEqual({ role: 'char', data: '초안' })

        const kv = JSON.parse(fs.readFileSync(path.join(destination, 'kv/manifest.json'), 'utf8'))
        expect(Object.keys(kv.entries).sort()).toEqual(['assets/avatar.png', 'plugin/state'])
        expect(fs.readFileSync(path.join(destination, 'kv/objects', kv.entries['assets/avatar.png'].object))).toEqual(avatar)
        expect(fs.readFileSync(path.join(destination, 'kv/objects', kv.entries['plugin/state'].object))).toEqual(pluginState)
        expect(fs.readFileSync(path.join(destination, 'risubard/wiki/.history/entry.md'), 'utf8')).toBe('기록')
        expect(fs.existsSync(path.join(destination, 'risubard/wiki/empty'))).toBe(true)
        expect(fs.readFileSync(path.join(destination, 'novelist/notes/story.md'), 'utf8')).toBe('소설')
        expect(fs.readFileSync(path.join(destination, 'inlays/layout.json'), 'utf8')).toBe('{}')
        expect(fs.readFileSync(path.join(destination, ['jel', 'lybard'].join(''), 'state/runtime.json'), 'utf8')).toBe('{"enabled":true}')
        expect(fs.readFileSync(path.join(destination, 'request-logs/requests.jsonl'), 'utf8')).toBe('{"path":"/api/test"}\n')
        expect(fs.readFileSync(path.join(destination, '__password'))).toEqual(Buffer.from([0, 1, 2, 255]))
        expect(fs.readFileSync(path.join(destination, '__instance_id'), 'utf8')).toBe('instance-test-id')
        expect(fs.readFileSync(path.join(destination, '__authcode'), 'utf8')).toBe('registration-code')
        expect(fs.readFileSync(path.join(destination, 'plugin-files/state.bin'))).toEqual(Buffer.from([4, 3, 2, 1]))
        expect(fs.existsSync(path.join(destination, '.journal/source-only.json'))).toBe(false)
        expect(fs.existsSync(path.join(destination, 'migration/source-only.json'))).toBe(false)
        expect(fs.existsSync(path.join(destination, 'trash/source-only.txt'))).toBe(false)
        expect(fs.existsSync(path.join(destination, 'shared'))).toBe(false)
        expect(fs.existsSync(path.join(destination, 'settings/layout.json'))).toBe(false)
        expect(fs.existsSync(path.join(destination, 'settings/asset-files.json'))).toBe(false)
        expect(fs.existsSync(path.join(destination, 'conversion/v2-to-v0925.json'))).toBe(true)
    })

    test('rejects an existing, identical, or nested destination', () => {
        const { source, destination } = makeFixture()
        fs.mkdirSync(destination)
        expect(() => convertV2ToV0925(source, destination)).toThrow(/must not exist/i)
        expect(() => convertV2ToV0925(source, source)).toThrow(/separate/i)
        expect(() => convertV2ToV0925(source, path.join(source, 'output'))).toThrow(/nested/i)
        expect(() => convertV2ToV0925(source, path.dirname(source))).toThrow(/nested/i)
    })

    test('fails closed on case-insensitive stable ID collisions', () => {
        const { source, destination } = makeFixture()
        const indexPath = path.join(source, 'index/sidebar.json')
        const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'))
        index.collections.modules = ['module-a', 'MODULE-A']
        index.paths.modules['MODULE-A'] = 'modules/다른 도구'
        writeEntity(source, 'modules/다른 도구', 'module', 'module.json', { id: 'MODULE-A', name: '다른 도구' })
        writeJson(source, 'index/sidebar.json', index)

        expect(() => convertV2ToV0925(source, destination)).toThrow(/collision/i)
        expect(fs.existsSync(destination)).toBe(false)
    })

    test('fails closed when a referenced owned asset is missing', () => {
        const { source, destination } = makeFixture()
        fs.unlinkSync(path.join(source, 'shared/assets/avatar.png'))

        expect(() => convertV2ToV0925(source, destination)).toThrow(/missing|unreadable/i)
        expect(fs.existsSync(destination)).toBe(false)
    })

    test('recovery mode skips a missing chat message file and records a warning', () => {
        const { source, destination } = makeFixture()
        const missing = path.join(source, 'characters/주인공/chats/첫 대화/messages.jsonl')
        fs.unlinkSync(missing)

        expect(() => convertV2ToV0925(source, destination)).toThrow(/missing/i)

        const warnings: string[] = []
        const result = convertV2ToV0925(source, destination, {
            skipMissing: true,
            onWarning: (warning: string) => warnings.push(warning),
        })

        expect(result.warnings).toEqual(warnings)
        expect(warnings).toEqual([expect.stringMatching(/messages\.jsonl/)])
        const reopened = createUserDataRepository({ dataRoot: destination })
        expect(reopened.exportLegacyDatabase().characters[0].chats[0].message).toEqual([])
        const record = JSON.parse(fs.readFileSync(path.join(destination, 'conversion/v2-to-v0925.json'), 'utf8'))
        expect(record.warnings).toEqual(warnings)
    })

    test('recovery mode keeps an asset when one indexed copy is missing', () => {
        const { source, destination, avatar } = makeFixture()
        fs.unlinkSync(path.join(source, 'shared/assets/avatar.png'))

        const result = convertV2ToV0925(source, destination, { skipMissing: true })

        expect(result.warnings).toEqual([expect.stringMatching(/shared\/assets\/avatar\.png/)])
        const manifest = JSON.parse(fs.readFileSync(path.join(destination, 'kv/manifest.json'), 'utf8'))
        expect(fs.readFileSync(path.join(destination, 'kv/objects', manifest.entries['assets/avatar.png'].object))).toEqual(avatar)
    })

    test('recovery mode omits an entity whose required manifest is missing', () => {
        const { source, destination } = makeFixture()
        fs.unlinkSync(path.join(source, 'characters/주인공/manifest.json'))

        const result = convertV2ToV0925(source, destination, { skipMissing: true })

        expect(result.characters).toBe(0)
        expect(result.warnings).toEqual([expect.stringMatching(/characters\/주인공/)])
        const reopened = createUserDataRepository({ dataRoot: destination })
        expect(reopened.exportLegacyDatabase().characters).toEqual([])
    })

    test('the CLI returns a distinct status when missing files can be retried in recovery mode', () => {
        const { source } = makeFixture()
        fs.unlinkSync(path.join(source, 'characters/주인공/chats/첫 대화/messages.jsonl'))

        const result = spawnSync(process.execPath, [path.resolve('scripts/convert-v2-to-v0925.cjs'), source], {
            encoding: 'utf8',
        })

        expect(result.status).toBe(2)
        expect(result.stderr).toMatch(/Missing V2 source file/)
        expect(fs.existsSync(`${source}-v1`)).toBe(false)
    })

    test('recovery mode never ignores a missing core V2 layout file', () => {
        const { source, destination } = makeFixture()
        fs.unlinkSync(path.join(source, 'settings/layout.json'))

        expect(() => convertV2ToV0925(source, destination, { skipMissing: true })).toThrow(/missing/i)
        expect(fs.existsSync(destination)).toBe(false)
    })

    test('fails closed on a stale V2 checksum sidecar', () => {
        const { source, destination } = makeFixture()
        writeFile(source, 'characters/주인공/character.json.sha256', `${'0'.repeat(64)}\n`)

        expect(() => convertV2ToV0925(source, destination)).toThrow(/checksum mismatch/i)
        expect(fs.existsSync(destination)).toBe(false)
    })

    test('accepts one external asset edit but rejects two conflicting edits', () => {
        const first = makeFixture()
        writeFile(first.source, 'characters/주인공/assets/avatar.png', 'edited-once')
        convertV2ToV0925(first.source, first.destination)
        const firstManifest = JSON.parse(fs.readFileSync(path.join(first.destination, 'kv/manifest.json'), 'utf8'))
        expect(fs.readFileSync(path.join(first.destination, 'kv/objects', firstManifest.entries['assets/avatar.png'].object), 'utf8')).toBe('edited-once')

        const second = makeFixture()
        writeFile(second.source, 'characters/주인공/assets/avatar.png', 'edited-one')
        writeFile(second.source, 'shared/assets/avatar.png', 'edited-two')
        expect(() => convertV2ToV0925(second.source, second.destination)).toThrow(/conflicting/i)
        expect(fs.existsSync(second.destination)).toBe(false)
    })

    test('requires every database asset reference to exist in the owned index', () => {
        const { source, destination } = makeFixture()
        writeJson(source, 'settings/asset-files.json', { schemaVersion: 2, entries: {} })

        expect(() => convertV2ToV0925(source, destination)).toThrow(/referenced asset.*owned index/i)
        expect(fs.existsSync(destination)).toBe(false)
    })

    test('rejects source symlinks or junctions', () => {
        const { parent, source, destination } = makeFixture()
        const outside = path.join(parent, 'outside')
        fs.mkdirSync(outside)
        fs.symlinkSync(outside, path.join(source, 'risubard/link'), process.platform === 'win32' ? 'junction' : 'dir')

        expect(() => convertV2ToV0925(source, destination)).toThrow(/symbolic link|reparse/i)
        expect(fs.existsSync(destination)).toBe(false)
    })

    test('rejects an allowed root file path when it is a reparse point', () => {
        const { parent, source, destination } = makeFixture()
        const outside = path.join(parent, 'outside-password')
        fs.mkdirSync(outside)
        fs.unlinkSync(path.join(source, '__password'))
        fs.symlinkSync(outside, path.join(source, '__password'), process.platform === 'win32' ? 'junction' : 'dir')

        expect(() => convertV2ToV0925(source, destination)).toThrow(/symbolic link|reparse/i)
        expect(fs.existsSync(destination)).toBe(false)
    })

    test('does not publish when the source changes before final verification', () => {
        const { source, destination } = makeFixture()
        expect(() => convertV2ToV0925(source, destination, {
            beforePublish: () => writeFile(source, 'risubard/wiki/changed.md', 'changed'),
        })).toThrow(/source changed/i)
        expect(fs.existsSync(destination)).toBe(false)
        expect(fs.readdirSync(path.dirname(destination)).some(name => name.includes('.incomplete-'))).toBe(false)
    })

    test('removes the final destination when parent directory synchronization fails', () => {
        const { source, destination } = makeFixture()
        expect(() => convertV2ToV0925(source, destination, {
            syncParentDirectory: () => { throw new Error('sync failed') },
        })).toThrow(/sync failed/i)
        expect(fs.existsSync(destination)).toBe(false)
        expect(fs.readdirSync(path.dirname(destination)).some(name => name.includes('.incomplete-'))).toBe(false)
    })

    test('does not overwrite a destination created concurrently', () => {
        const { destination, source } = makeFixture()
        expect(() => convertV2ToV0925(source, destination, {
            beforePublish: () => fs.mkdirSync(destination),
        })).toThrow(/must not exist/i)
        expect(fs.existsSync(destination)).toBe(true)
        expect(fs.readdirSync(path.dirname(destination)).some(name => name.includes('.incomplete-'))).toBe(false)
    })

    test('the Windows launcher accepts typed paths and offers explicit missing-file recovery', () => {
        const batch = fs.readFileSync(path.resolve('scripts/portable/V2-to-V1.bat'), 'utf8')

        expect(batch).toContain('set /p "SOURCE=V2 save folder path: "')
        expect(batch).toContain('choice /C YN')
        expect(batch).toContain('--skip-missing')
    })
})
