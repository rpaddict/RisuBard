import { writable } from 'svelte/store'
import { describe, expect, it, vi } from 'vitest'

const { mockDBState, mockModuleSources, mockDownloadFile, mockSelectSingleFile } = vi.hoisted(() => ({
    mockDBState: { db: {} as any },
    mockModuleSources: [] as Array<{ scopeId: string; entry: any }>,
    mockDownloadFile: vi.fn(),
    mockSelectSingleFile: vi.fn(),
}))

vi.mock('../stores.svelte', () => ({
    DBState: mockDBState,
    selectedCharID: writable(0),
}))
vi.mock('../tokenizer', () => ({
    tokenize: vi.fn(async () => 1),
}))
vi.mock('../parser/parser.svelte', () => ({
    risuChatParser: (value: string) => value,
}))
vi.mock('../util', () => ({
    findCharacterbyId: vi.fn(),
    pickHashRand: vi.fn(() => 1),
    selectSingleFile: mockSelectSingleFile,
}))
vi.mock('../alert', () => ({
    alertError: vi.fn(),
    notifySuccess: vi.fn(),
}))
vi.mock('../../lang', () => ({
    getCurrentLocale: () => 'en',
    language: {},
}))
vi.mock('../globalApi.svelte', () => ({
    downloadFile: mockDownloadFile,
    saveAsset: vi.fn(),
}))
vi.mock('./modules', () => ({
    getModuleLorebooks: () => [],
    getModuleLorebooksWithSources: () => mockModuleSources,
}))

import { convertImportedLorebook, exportLoreBook, importLoreBook, loadLoreBookV3Prompt } from './lorebook.svelte'
import { buildPersonaBuilderMessages, matchPersonaBuilderCharacterLorebook } from '../personaBuilder'
import { buildInjectionManifest } from '../status/requestStatus'
import { fingerprintLegacyLore, upgradeLegacyLorebook, createBardLoreSettings } from '../lorebook/bardLore'

function lore(comment: string, key: string, content: string) {
    return {
        comment,
        key,
        content,
        mode: 'normal' as const,
        insertorder: 100,
        alwaysActive: false,
        secondkey: '',
        selective: false,
        useRegex: false,
    }
}

describe('Grimoire live prompt retrieval', () => {
    it.each([0, 1, 3, 20])('injects a named character with a %s-message window and ignores disabled history', async (contextMessages) => {
        mockModuleSources.length = 0
        const sources = [
            { ...lore('카이넬 레오', '카이넬 레오', 'LEO PROFILE'), id: 'leo' },
            { ...lore('비활성 인물', '비활성 인물', 'DISABLED PROFILE'), id: 'disabled' },
        ]
        const bardLore = upgradeLegacyLorebook(sources, () => 'unused', createBardLoreSettings({ contextMessages }))
        bardLore.mode = 'bard'
        bardLore.metadata.forEach((metadata) => { metadata.kind = 'character' })
        const character = {
            chaId: 'test', name: 'test', chatPage: 0, globalLore: sources, bardLore,
            chats: [{ id: 'chat', localLore: [], message: [
                { role: 'user', data: '비활성 인물' },
                { role: 'char', data: '경계', disabled: 'allBefore' },
                { role: 'char', data: '장소 설명: 여성 전용 지역' },
                { role: 'user', data: '카이넬 레오를 만난다.' },
                { role: 'char', data: '여자 캐릭터 3명', isComment: true },
                { role: 'user', data: '비활성 인물', disabled: true },
                { role: 'char', data: '그는 지도를 펼친다.' },
            ] }],
        }
        mockDBState.db = { username: 'user', loreBookDepth: 3, loreBookToken: 8000, characters: [character] }
        const result = await loadLoreBookV3Prompt()
        expect(result.actives).toContainEqual(expect.objectContaining({
            prompt: 'LEO PROFILE', requestStatusKind: 'grimoire',
        }))
        expect(result.actives.some((active) => active.prompt === 'DISABLED PROFILE')).toBe(false)
        expect(result.matchLog.find((log) => log.source === 'Grimoire query plan')?.prompt).toBe('카이넬 레오를 만난다.')
    })

    it('uses the active first message to bootstrap ambient scene retrieval in a new chat', async () => {
        mockModuleSources.length = 0
        const sources = [
            { ...lore('학교', '학교', 'SCHOOL FACT'), id: 'school' },
            { ...lore('신입생', '', 'STUDENT PROFILE'), id: 'student' },
        ]
        const bardLore = upgradeLegacyLorebook(sources, () => 'unused', createBardLoreSettings({ contextMessages: 3 }))
        bardLore.mode = 'bard'
        bardLore.metadata[0].kind = 'location'
        bardLore.metadata[1].kind = 'character'
        bardLore.metadata[1].links = [{ targetId: 'school', relation: 'attends', retrieval: 'ambient' }]
        const character = {
            chaId: 'test',
            name: 'test',
            firstMessage: '학교 복도에서 새로운 하루가 시작된다.',
            alternateGreetings: [],
            chatPage: 0,
            globalLore: sources,
            bardLore,
            chats: [{ id: 'chat', fmIndex: -1, localLore: [], message: [
                { role: 'user', data: '주위를 둘러본다.' },
            ] }],
        }
        mockDBState.db = { username: 'user', loreBookDepth: 3, loreBookToken: 8000, characters: [character] }

        const result = await loadLoreBookV3Prompt()

        expect(result.actives.map((entry) => entry.prompt)).toEqual(expect.arrayContaining([
            'SCHOOL FACT',
            'STUDENT PROFILE',
        ]))
    })
})

function deferred<T>() {
    let resolve!: (value: T) => void
    const promise = new Promise<T>((done) => { resolve = done })
    return { promise, resolve }
}

function importedFile(comment: string) {
    return {
        data: Buffer.from(JSON.stringify({
            type: 'risu',
            data: [lore(comment, comment, `${comment} content`)],
        })),
    }
}

describe('persona builder character lorebook search', () => {
    function prepare(entries: ReturnType<typeof lore>[], settings: Record<string, unknown> = {}) {
        mockModuleSources.splice(0, mockModuleSources.length, {
            scopeId: 'module:hidden', entry: { ...lore('Module', '', 'MODULE SECRET'), alwaysActive: true },
        })
        const character = {
            chaId: 'builder-character', name: 'Builder character', chatPage: 0,
            globalLore: entries,
            chats: [{
                id: 'chat-1', message: [{ role: 'user', data: 'chat-only keyword' }],
                localLore: [{ ...lore('Local', '', 'LOCAL SECRET'), alwaysActive: true }],
                scriptstate: { '$__internal_ka_sticky': 'true' },
            }],
            loreSettings: {
                tokenBudget: 8000, scanDepth: 1, recursiveScanning: false,
                matchingMode: 'partial', ...settings,
            },
        }
        mockDBState.db = {
            username: 'user', loreBookDepth: 5, loreBookToken: 8000,
            characters: [character],
        }
        return character
    }

    it('carries only matched entry names from the search into the request manifest', async () => {
        const character = prepare([
            lore('라이잘린 슈타우트', '라이잘린 슈타우트, 라이자, Ryza', '연금술사\n## 내부 제목'),
            lore('Unmatched', 'other', 'NOT INJECTED'),
        ])
        const userInstruction = '라이자가 나오는 셋팅에 어울리는 남자 캐릭터를 만들어 줘'
        const matched = await matchPersonaBuilderCharacterLorebook({ character: character as any, userInstruction, draft: '' })
        expect(matched).toMatchObject({
            content: expect.stringContaining('## 라이잘린 슈타우트'),
            sources: [{ kind: 'lorebook', name: '라이잘린 슈타우트', role: 'user', content: expect.stringContaining('연금술사') }],
        })
        const messages = buildPersonaBuilderMessages({
            taskInstruction: 'Create a persona', styleInstruction: '', userInstruction, draft: '',
            selections: { systemPrompt: false, characterDescription: false, characterLorebook: true, moduleLorebook: false },
            sources: {
                systemPrompt: '', characterDescription: '', moduleLorebook: '',
                characterLorebook: matched.content, characterLorebookSources: matched.sources,
            },
        })
        const manifest = await buildInjectionManifest(messages, [232, 25839], async (source) => source.content.length)
        expect(manifest.items.filter((item) => item.kind === 'lorebook')).toEqual([
            { kind: 'lorebook', name: '라이잘린 슈타우트', tokens: expect.any(Number) },
        ])
        expect(manifest.items.some((item) => item.kind === 'chatHistory')).toBe(false)
    })

    it('matches input and draft without injecting unrelated, local, or module lore', async () => {
        const character = prepare([
            lore('Input match', 'moon', 'MOON FACT'),
            lore('Draft match', 'sun', 'SUN FACT'),
            lore('Unrelated', 'chat-only', 'UNRELATED SECRET'),
            { ...lore('Always', '', 'ALWAYS FACT'), alwaysActive: true },
            { ...lore('Disabled', 'moon', 'DISABLED SECRET'), enabled: false },
            { ...lore('Folder', 'moon', 'FOLDER SECRET'), mode: 'folder' },
        ] as ReturnType<typeof lore>[])
        const before = JSON.stringify(character)
        const context = await matchPersonaBuilderCharacterLorebook({
            character: character as any, userInstruction: 'Describe the moon', draft: 'Lives near the sun',
        })
        expect(context.content).toContain('MOON FACT')
        expect(context.content).toContain('SUN FACT')
        expect(context.content).toContain('ALWAYS FACT')
        expect(context.content).not.toContain('SECRET')
        expect(JSON.stringify(character)).toBe(before)
    })

    it('reevaluates changed drafts and honors secondary keys and word boundaries', async () => {
        const character = prepare([
            { ...lore('Selective', 'alice', 'SELECTIVE FACT'), selective: true, secondkey: 'mage' },
            lore('Longer name', 'aliceford', 'WRONG NAME'),
        ], { matchingMode: 'word-boundary' })
        const input = { character: character as any, userInstruction: 'Alice, please', draft: 'A mage.' }
        expect((await matchPersonaBuilderCharacterLorebook(input)).content).toContain('SELECTIVE FACT')
        expect(await matchPersonaBuilderCharacterLorebook({ ...input, draft: 'A warrior.' })).toEqual({ content: '', sources: [] })
        expect(await matchPersonaBuilderCharacterLorebook({ ...input, userInstruction: 'Alicea' })).toEqual({ content: '', sources: [] })
    })

    it('uses chat decorators, recursive scanning, and token priority without mutating activation state', async () => {
        const character = prepare([
            { ...lore('Seed', 'seed', '@@keep_activate_after_match\nbridge'), id: 'seed', insertorder: 300 },
            { ...lore('Bridge', 'bridge', 'BRIDGE FACT'), insertorder: 200 },
            { ...lore('Sticky', 'absent', '@@keep_activate_after_match\nSTICKY SECRET'), id: 'sticky' },
            lore('Excluded', 'seed', '@@exclude_keys blocked\nEXCLUDED SECRET'),
            lore('Low priority', 'seed', 'BUDGET SECRET'),
        ] as ReturnType<typeof lore>[], { recursiveScanning: true, maxRecursionSteps: 2, tokenBudget: 2 })
        const before = JSON.stringify(character)
        const context = await matchPersonaBuilderCharacterLorebook({
            character: character as any, userInstruction: 'seed blocked', draft: '',
        })
        expect(context.content).toContain('bridge')
        expect(context.content).toContain('BRIDGE FACT')
        expect(context.content).not.toContain('SECRET')
        expect(context.content).not.toContain('@@')
        expect(JSON.stringify(character)).toBe(before)
    })

    it('does not fall back to the selected chat when no character or no keys match', async () => {
        const character = prepare([lore('Unrelated', 'chat-only', 'SECRET')])
        expect(await matchPersonaBuilderCharacterLorebook({ userInstruction: 'other', draft: '' })).toEqual({ content: '', sources: [] })
        expect(await matchPersonaBuilderCharacterLorebook({
            character: character as any, userInstruction: 'other', draft: '',
        })).toEqual({ content: '', sources: [] })
    })
})

describe('lorebook recursion steps', () => {
    it('uses bounded Bard Lore entries instead of legacy always-active character lore', async () => {
        mockModuleSources.length = 0
        const bardEntry = (id: string, content: string, activation: string, aliases: string[] = [], tags: string[] = []) => ({
            ...lore(id, aliases.join(', '), content),
            id,
            bard: {
                sourceLegacyId: id,
                sourceHash: id,
                kind: activation === 'required' ? 'system' : 'location',
                activation,
                aliases,
                tags,
                summary: '',
                facets: [],
                injection: 'full',
                links: [],
            },
        })
        mockDBState.db = {
            username: 'user',
            loreBookDepth: 5,
            loreBookToken: 1,
            characters: [{
                chaId: 'bard-character',
                name: 'storywriter',
                chatPage: 0,
                globalLore: [
                    { ...lore('format', '', 'STATUS FORMAT'), id: 'format' },
                    { ...lore('mall', '', 'MALL DATE FACT'), id: 'mall' },
                    { ...lore('dorm', '', 'DORM FACT'), id: 'dorm' },
                    { ...lore('Legacy dump', '', 'LEGACY WORLD DUMP'), alwaysActive: true },
                ],
                bardLore: {
                    schemaVersion: 2,
                    mode: 'bard',
                    settings: { targetTokens: 20, maximumTokens: 30, maxEntries: 3, contextMessages: 2 },
                    metadata: [
                        bardEntry('format', 'STATUS FORMAT', 'required').bard,
                        bardEntry('mall', 'MALL DATE FACT', 'retrieve', [], ['시내']).bard,
                        bardEntry('dorm', 'DORM FACT', 'retrieve', [], ['기숙사']).bard,
                    ],
                    derivedEntries: [],
                },
                chats: [{
                    localLore: [],
                    message: [
                        { role: 'user', data: '시내로 가자' },
                        { role: 'user', data: '좋아' },
                    ],
                }],
                loreSettings: {
                    tokenBudget: 1,
                    scanDepth: 3,
                    recursiveScanning: true,
                    maxRecursionSteps: 1,
                    matchingMode: 'partial',
                },
            }],
        }

        const result = await loadLoreBookV3Prompt()
        const prompts = result.actives.map((entry) => entry.prompt)

        expect(prompts).toEqual(expect.arrayContaining(['STATUS FORMAT', 'MALL DATE FACT']))
        expect(result.actives.map((entry) => [entry.source, entry.requestStatusKind])).toEqual(expect.arrayContaining([
            ['format', 'grimoireRequired'],
            ['mall', 'grimoire'],
        ]))
        expect(result.matchLog.some((entry) => entry.source === 'Grimoire query plan')).toBe(true)
        expect(prompts).not.toContain('DORM FACT')
        expect(prompts.join('\n')).not.toContain('LEGACY')
    })

    it('gives the latest user input priority when selecting bounded Grimoire entries', async () => {
        mockModuleSources.length = 0
        const sources = [
            { ...lore('Haania', 'Haania, Hanya', 'HAANIA FACT'), id: 'haania' },
            { ...lore('Lilia', 'Lilia', 'LILIA FACT'), id: 'lilia' },
            { ...lore('Game Over', 'game over, gameover', 'GAME OVER INSTRUCTIONS'), id: 'game-over' },
        ]
        const metadata = sources.map((source) => ({
            sourceLegacyId: source.id,
            sourceHash: source.id,
            kind: 'other',
            activation: 'retrieve',
            aliases: [],
            tags: [],
            summary: '',
            facets: [],
            injection: 'full',
            links: [],
        }))
        mockDBState.db = {
            username: 'user',
            loreBookDepth: 5,
            loreBookToken: 8_000,
            characters: [{
                chaId: 'bard-character',
                name: 'storywriter',
                chatPage: 0,
                globalLore: sources,
                bardLore: {
                    schemaVersion: 2,
                    mode: 'bard',
                    settings: { targetTokens: 2, maximumTokens: 3, maxEntries: 3, contextMessages: 3 },
                    metadata,
                    derivedEntries: [],
                },
                chats: [{
                    localLore: [],
                    message: [
                        { role: 'user', data: 'Haania가 보였다.' },
                        { role: 'char', data: 'Lilia가 쓰러졌다.' },
                        { role: 'user', data: 'game over' },
                    ],
                }],
                loreSettings: {
                    tokenBudget: 8_000,
                    scanDepth: 3,
                    recursiveScanning: false,
                    maxRecursionSteps: 1,
                    matchingMode: 'partial',
                },
            }],
        }

        const result = await loadLoreBookV3Prompt()

        expect(result.actives).toContainEqual(expect.objectContaining({
            prompt: 'GAME OVER INSTRUCTIONS',
            source: 'Game Over',
            requestStatusKind: 'grimoire',
        }))
    })

    it('returns BardWiki character hints for model-visible Grimoire lore', async () => {
        mockModuleSources.length = 0
        const source = { ...lore('Haania', '', 'Name: Haania (Hanya)'), id: 'haania' }
        mockDBState.db = {
            username: 'user',
            loreBookDepth: 5,
            loreBookToken: 8_000,
            characters: [{
                chaId: 'bard-character',
                name: 'storywriter',
                chatPage: 0,
                globalLore: [source],
                bardLore: {
                    schemaVersion: 2,
                    mode: 'bard',
                    settings: {
                        targetTokens: 4_000,
                        maximumTokens: 8_000,
                        maxEntries: 12,
                        contextMessages: 3,
                    },
                    metadata: [{
                        sourceLegacyId: 'haania',
                        sourceHash: fingerprintLegacyLore(
                            source as Parameters<typeof fingerprintLegacyLore>[0]
                        ),
                        kind: 'character',
                        activation: 'required',
                        aliases: ['Haania', 'Hania', '하니아', 'Hanya', '수녀'],
                        tags: [],
                        summary: '리리아를 헌신적으로 돌보는 보조 수녀',
                        facets: [],
                        injection: 'full',
                        links: [],
                    }],
                    derivedEntries: [],
                },
                chats: [{
                    localLore: [],
                    message: [
                        { role: 'char', data: '리리아가 숨을 몰아쉰다.' },
                        { role: 'user', data: '손을 뻗는다.' },
                    ],
                }],
                loreSettings: {
                    tokenBudget: 8_000,
                    scanDepth: 3,
                    recursiveScanning: false,
                    maxRecursionSteps: 1,
                    matchingMode: 'partial',
                },
            }],
        }

        const result = await loadLoreBookV3Prompt()

        expect(result.actives.map((entry) => entry.source)).toContain('Haania')
        expect(result.bardWikiEntityHints).toEqual([{
            kind: 'character',
            names: ['Haania', 'Hania', '하니아', 'Hanya', '수녀'],
        }])
    })

    it('returns BardWiki character hints for model-visible legacy character lore', async () => {
        mockModuleSources.length = 0
        mockDBState.db = {
            username: 'user',
            loreBookDepth: 5,
            loreBookToken: 8_000,
            characters: [{
                chaId: 'legacy-character',
                name: 'storywriter',
                chatPage: 0,
                globalLore: [{
                    ...lore('Haania', 'Hania,하니아,Hanya,수녀', 'Name: Haania (Hanya)'),
                    alwaysActive: true,
                }],
                chats: [{
                    localLore: [],
                    message: [{ role: 'user', data: '손을 뻗는다.' }],
                }],
                loreSettings: {
                    tokenBudget: 8_000,
                    scanDepth: 3,
                    recursiveScanning: false,
                    maxRecursionSteps: 1,
                    matchingMode: 'partial',
                },
            }],
        }

        const result = await loadLoreBookV3Prompt()

        expect(result.bardWikiEntityHints).toEqual([{
            kind: 'character',
            names: ['Haania', 'Hania', '하니아', 'Hanya', '수녀'],
        }])
    })

    it('tolerates a missing secondary key in model-visible legacy character lore', async () => {
        mockModuleSources.length = 0
        const legacyEntry = {
            ...lore('Official Proper Noun Glossary', 'proper noun,transliteration', 'Glossary body'),
            alwaysActive: true,
        }
        delete (legacyEntry as Partial<typeof legacyEntry>).secondkey
        mockDBState.db = {
            username: 'user',
            loreBookDepth: 5,
            loreBookToken: 8_000,
            characters: [{
                chaId: 'legacy-character',
                name: 'storywriter',
                chatPage: 0,
                globalLore: [legacyEntry],
                chats: [{
                    localLore: [],
                    message: [{ role: 'user', data: 'continue' }],
                }],
                loreSettings: {
                    tokenBudget: 8_000,
                    scanDepth: 3,
                    recursiveScanning: false,
                    maxRecursionSteps: 1,
                    matchingMode: 'partial',
                },
            }],
        }

        const result = await loadLoreBookV3Prompt()

        expect(result.bardWikiEntityHints).toEqual([{
            kind: 'character',
            names: ['Official Proper Noun Glossary', 'proper noun', 'transliteration'],
        }])
    })

    it('injects a legacy lore body for a multi-word whitespace key', async () => {
        mockModuleSources.length = 0
        mockDBState.db = {
            username: 'user',
            loreBookDepth: 5,
            loreBookToken: 8_000,
            characters: [{
                chaId: 'game-over-character',
                name: 'storywriter',
                chatPage: 0,
                globalLore: [lore(
                    '게임 오버',
                    'game over, gameover',
                    'GAME OVER INSTRUCTIONS'
                )],
                chats: [{
                    localLore: [],
                    message: [{ role: 'user', data: 'game over' }],
                }],
                loreSettings: {
                    tokenBudget: 8_000,
                    scanDepth: 3,
                    recursiveScanning: false,
                    maxRecursionSteps: 1,
                    matchingMode: 'whitespace',
                },
            }],
        }

        const result = await loadLoreBookV3Prompt()

        expect(result.actives).toEqual([
            expect.objectContaining({
                source: '게임 오버',
                prompt: 'GAME OVER INSTRUCTIONS',
                requestStatusKind: 'lorebook',
            }),
        ])
    })

    it('does not activate newly discovered keys during the same sweep', async () => {
        mockModuleSources.length = 0
        mockDBState.db = {
            username: 'user',
            loreBookDepth: 5,
            loreBookToken: 8000,
            characters: [{
                name: 'storywriter',
                chatPage: 0,
                globalLore: [
                    lore('alice', 'alice', 'bobby'),
                    lore('bobby', 'bobby', 'toby'),
                    lore('toby', 'toby', 'controls people'),
                ],
                chats: [{
                    localLore: [],
                    message: [{ role: 'user', data: 'alice' }],
                }],
                loreSettings: {
                    tokenBudget: 8000,
                    scanDepth: 5,
                    recursiveScanning: true,
                    maxRecursionSteps: 1,
                    matchingMode: 'partial',
                },
            }],
        }

        const result = await loadLoreBookV3Prompt()

        expect(result.actives.map((entry) => entry.source)).toEqual(['alice'])
    })

    it('filters disabled entries without losing character, chat, or module source identity', async () => {
        const enabledCharacter = { ...lore('Enabled character', '', 'Character prompt'), alwaysActive: true }
        const enabledChat = { ...lore('Enabled chat', '', 'Chat prompt'), alwaysActive: true }
        const enabledModule = { ...lore('Enabled module', '', 'Module prompt'), alwaysActive: true }
        mockModuleSources.splice(0, mockModuleSources.length,
            {
                scopeId: 'module:module-1',
                entry: { ...lore('Disabled module', '', 'Disabled module prompt'), alwaysActive: true, enabled: false },
            },
            { scopeId: 'module:module-1', entry: enabledModule },
        )
        mockDBState.db = {
            username: 'user',
            loreBookDepth: 5,
            loreBookToken: 8000,
            characters: [{
                chaId: 'character-1',
                name: 'storywriter',
                chatPage: 0,
                globalLore: [
                    { ...lore('Disabled character', '', 'Disabled character prompt'), alwaysActive: true, enabled: false },
                    enabledCharacter,
                ],
                chats: [{
                    id: 'chat-1',
                    localLore: [
                        { ...lore('Disabled chat', '', 'Disabled chat prompt'), alwaysActive: true, enabled: false },
                        enabledChat,
                    ],
                    message: [],
                }],
                loreSettings: {
                    tokenBudget: 8000,
                    scanDepth: 5,
                    recursiveScanning: false,
                    maxRecursionSteps: 1,
                    matchingMode: 'partial',
                },
            }],
        }

        const result = await loadLoreBookV3Prompt()

        expect(result.actives.map(({ source, prompt }) => ({ source, prompt }))).toEqual(expect.arrayContaining([
            { source: 'Enabled character', prompt: 'Character prompt' },
            { source: 'Enabled chat', prompt: 'Chat prompt' },
            { source: 'Enabled module', prompt: 'Module prompt' },
        ]))
        expect(result.actives.map((entry) => entry.prompt).join('\n')).not.toContain('Disabled')
        expect(result.activeSources.map(({ sourceIdentity }) => ({
            scopeId: sourceIdentity.scopeId,
            source: sourceIdentity.entry.comment,
        }))).toEqual([
            { scopeId: 'character:character-1', source: 'Enabled character' },
            { scopeId: 'chat:chat-1', source: 'Enabled chat' },
            { scopeId: 'module:module-1', source: 'Enabled module' },
        ])
    })
})

describe('Risu lorebook import compatibility', () => {
    it('preserves enabled state, numeric IDs, and unknown fields without backfilling missing enabled', () => {
        const rawEntries = [
            { ...lore('Disabled raw', 'raw', 'Raw disabled'), id: 17, enabled: false, unknownField: { keep: true } },
            { ...lore('Legacy raw', 'legacy', 'Raw legacy'), id: 18, unknownField: 'legacy' },
        ]

        const imported = convertImportedLorebook({ type: 'risu', data: rawEntries })

        expect(imported).toEqual(rawEntries)
        expect(imported.map((entry) => entry.enabled)).toEqual([false, undefined])
        expect(imported.map((entry) => entry.id)).toEqual([17, 18])
    })

    it('maps external disabled entries while keeping missing enabled active', () => {
        const imported = convertImportedLorebook({
            entries: {
                disabled: {
                    enabled: false,
                    key: ['disabled'],
                    comment: 'Disabled external',
                    content: 'Disabled external content',
                    order: 10,
                    constant: false,
                } as never,
                legacy: {
                    key: ['legacy'],
                    comment: 'Legacy external',
                    content: 'Legacy external content',
                    order: 20,
                    constant: false,
                } as never,
            },
        })

        expect(imported.map((entry) => entry.enabled)).toEqual([false, true])
    })

    it('serializes raw Risu enabled state, numeric IDs, and unknown fields unchanged', async () => {
        const rawEntries = [
            { ...lore('Raw export', 'raw', 'Raw export content'), id: 91, enabled: false, unknownField: { keep: true } },
        ]
        mockDBState.db = {
            characters: [{
                chatPage: 0,
                globalLore: rawEntries,
                chats: [{ localLore: [] }],
            }],
        }
        mockDownloadFile.mockReset()

        await exportLoreBook('global')

        expect(mockDownloadFile).toHaveBeenCalledOnce()
        const exported = JSON.parse(Buffer.from(mockDownloadFile.mock.calls[0][1]).toString('utf-8'))
        expect(exported).toMatchObject({ type: 'risu', ver: 1 })
        expect(exported.data).toEqual(rawEntries)
    })
})

describe('Risu lorebook import owner routing', () => {
    it('appends to the captured character current lore after character reorder and concurrent edit', async () => {
        const target = { chaId: 'char-a', chatPage: 0, globalLore: [lore('old', 'old', 'old')], chats: [] }
        const other = { chaId: 'char-b', chatPage: 0, globalLore: [], chats: [] }
        mockDBState.db = { characters: [target, other], loreBook: [{ id: 'page', data: [] }], loreBookPage: 0 }
        const picker = deferred<{ data: Buffer }>()
        mockSelectSingleFile.mockReturnValueOnce(picker.promise)

        const pending = importLoreBook('global')
        mockDBState.db.characters.reverse()
        target.globalLore = [lore('concurrent', 'concurrent', 'concurrent')]
        picker.resolve(importedFile('imported'))
        await pending

        expect(target.globalLore.map((entry) => entry.comment)).toEqual(['concurrent', 'imported'])
        expect(other.globalLore).toEqual([])
    })

    it('appends to the captured chat current lore after chat reorder and concurrent edit', async () => {
        const targetChat = { id: 'chat-a', localLore: [lore('old', 'old', 'old')] }
        const otherChat = { id: 'chat-b', localLore: [] }
        const character = {
            chaId: 'char-a',
            chatPage: 0,
            globalLore: [],
            chats: [targetChat, otherChat],
        }
        mockDBState.db = { characters: [character], loreBook: [{ id: 'page', data: [] }], loreBookPage: 0 }
        const picker = deferred<{ data: Buffer }>()
        mockSelectSingleFile.mockReturnValueOnce(picker.promise)

        const pending = importLoreBook('local')
        character.chats.reverse()
        targetChat.localLore = [lore('concurrent', 'concurrent', 'concurrent')]
        picker.resolve(importedFile('imported'))
        await pending

        expect(targetChat.localLore.map((entry) => entry.comment)).toEqual(['concurrent', 'imported'])
        expect(otherChat.localLore).toEqual([])
    })

    it('appends to the captured global page current lore after page reorder', async () => {
        const targetPage = { id: 'page-a', name: 'A', data: [lore('old', 'old', 'old')] }
        const otherPage = { id: 'page-b', name: 'B', data: [] }
        mockDBState.db = { characters: [], loreBook: [targetPage, otherPage], loreBookPage: 0 }
        const picker = deferred<{ data: Buffer }>()
        mockSelectSingleFile.mockReturnValueOnce(picker.promise)

        const pending = importLoreBook('sglobal')
        mockDBState.db.loreBook.reverse()
        targetPage.data = [lore('concurrent', 'concurrent', 'concurrent')]
        picker.resolve(importedFile('imported'))
        await pending

        expect(targetPage.data.map((entry) => entry.comment)).toEqual(['concurrent', 'imported'])
        expect(otherPage.data).toEqual([])
    })

    it('aborts when the captured owner was deleted or replaced while the picker was open', async () => {
        const target = { chaId: 'char-a', chatPage: 0, globalLore: [], chats: [] }
        mockDBState.db = { characters: [target], loreBook: [{ id: 'page', data: [] }], loreBookPage: 0 }
        const picker = deferred<{ data: Buffer }>()
        mockSelectSingleFile.mockReturnValueOnce(picker.promise)

        const pending = importLoreBook('global')
        const replacement = { chaId: 'char-a', chatPage: 0, globalLore: [], chats: [] }
        mockDBState.db.characters = [replacement]
        picker.resolve(importedFile('orphaned'))
        await pending

        expect(target.globalLore).toEqual([])
        expect(replacement.globalLore).toEqual([])
    })
})
