import { describe, expect, test } from 'vitest'
import { buildInjectionManifest } from './status/requestStatus'
import type {
    Database,
    PersonaBuilderPromptPreset,
    character,
    loreBook,
} from './storage/database.svelte'
import {
    DEFAULT_PERSONA_BUILDER_TASK_PROMPT,
    PERSONA_BUILDER_BUILTIN_PRESETS,
    buildPersonaBuilderMessages,
    collectPersonaBuilderSources,
    createPersonaBuilderUserPreset,
    deletePersonaBuilderUserPreset,
    overwritePersonaBuilderUserPreset,
    resolvePersonaBuilderPromptPreset,
} from './personaBuilder'

const lore = (overrides: Partial<loreBook> = {}): loreBook => ({
    key: 'key',
    secondkey: '',
    insertorder: 100,
    comment: 'Entry',
    content: 'Lore content',
    mode: 'normal',
    alwaysActive: false,
    selective: false,
    ...overrides,
})

const database = (overrides: Partial<Database> = {}): Database => ({
    mainPrompt: 'Legacy main prompt',
    promptTemplate: undefined,
    personaBuilderPromptPresets: [],
    ...overrides,
} as Database)

const currentCharacter = (overrides: Partial<character> = {}): character => ({
    name: 'Lelia',
    desc: 'Character card description',
    personality: 'Reserved but compassionate',
    scenario: 'Works as an exorcist',
    systemPrompt: '',
    globalLore: [],
    ...overrides,
} as character)

describe('persona builder source compiler', () => {
    test('uses only prompt-template main blocks when a template is active', () => {
        const sources = collectPersonaBuilderSources({
            database: database({
                mainPrompt: 'Legacy prompt must be absent',
                promptTemplate: [
                    { type: 'plain', type2: 'main', role: 'system', text: 'Main A' },
                    { type: 'jailbreak', type2: 'normal', role: 'system', text: 'Jailbreak' },
                    { type: 'cot', type2: 'normal', role: 'system', text: 'CoT' },
                    { type: 'plain', type2: 'globalNote', role: 'system', text: 'Global note' },
                    { type: 'plain', type2: 'main', role: 'system', text: 'Main B' },
                ],
            }),
            character: currentCharacter({ systemPrompt: 'Character override' }),
            moduleLorebooks: [],
        })

        expect(sources.systemPrompt).toBe('Main A\n\nMain B')
        expect(sources.systemPrompt).not.toMatch(/Legacy|Jailbreak|CoT|Global note|override/)
    })

    test('resolves main prompt blocks with the current chat toggle values', () => {
        const sources = collectPersonaBuilderSources({
            database: database({
                promptTemplate: [{
                    type: 'plain', type2: 'main', role: 'system',
                    text: 'Always\n{{#when::toggle::detail}}Chat detail{{/}}',
                }],
                globalChatVariables: { toggle_detail: '0' },
            }),
            character: currentCharacter(),
            moduleLorebooks: [],
            parsePrompt: (text) => text.replace('{{#when::toggle::detail}}', '').replace('{{/}}', ''),
        })

        expect(sources.systemPrompt).toContain('Chat detail')
        expect(sources.systemPrompt).not.toContain('{{#when')
    })

    test('does not fall back to the legacy prompt when toggles hide every main block', () => {
        const sources = collectPersonaBuilderSources({
            database: database({
                mainPrompt: 'Legacy prompt',
                promptTemplate: [{
                    type: 'plain', type2: 'main', role: 'system',
                    text: '{{#when::toggle::detail}}Chat detail{{/}}',
                }],
            }),
            character: currentCharacter(),
            moduleLorebooks: [],
            parsePrompt: (text) => text === 'Legacy prompt' ? text : '',
        })

        expect(sources.systemPrompt).toBe('')
    })

    test('makes system prompt unavailable when no character is active', () => {
        const sources = collectPersonaBuilderSources({
            database: database({
                promptTemplate: [{ type: 'plain', type2: 'main', role: 'system', text: 'Main' }],
            }),
            character: undefined,
            moduleLorebooks: [],
        })

        expect(sources.systemPrompt).toBe('')
    })

    test('applies the legacy character system-prompt override', () => {
        const sources = collectPersonaBuilderSources({
            database: database({ mainPrompt: 'BASE' }),
            character: currentCharacter({ systemPrompt: 'Before\n{{original}}\nAfter' }),
            moduleLorebooks: [],
        })

        expect(sources.systemPrompt).toBe('Before\nBASE\nAfter')
    })

    test('formats the complete non-empty character description', () => {
        const sources = collectPersonaBuilderSources({
            database: database(),
            character: currentCharacter(),
            moduleLorebooks: [],
        })

        expect(sources.characterDescription).toContain('# Lelia')
        expect(sources.characterDescription).toContain('Character card description')
        expect(sources.characterDescription).toContain('Reserved but compassionate')
        expect(sources.characterDescription).toContain('Works as an exorcist')
    })

    test('separates enabled character and module lorebooks', () => {
        const sources = collectPersonaBuilderSources({
            database: database(),
            character: currentCharacter({
                globalLore: [
                    lore({ comment: 'Character lore', content: 'Character fact' }),
                    lore({ comment: 'Disabled', content: 'Hidden', enabled: false }),
                    lore({ comment: 'Folder', content: 'Hidden', mode: 'folder' }),
                    lore({ comment: 'Empty', content: '   ' }),
                ],
            }),
            moduleLorebooks: [
                { scopeId: 'module:weather', entry: lore({ comment: 'Module lore', content: 'Rainy city' }) },
                { scopeId: 'module:hidden', entry: lore({ content: 'Hidden module', enabled: false }) },
            ],
        })

        expect(sources.characterLorebook).toContain('Character lore')
        expect(sources.characterLorebook).toContain('Character fact')
        expect(sources.characterLorebook).not.toMatch(/Disabled|Folder|Empty|Hidden/)
        expect(sources.moduleLorebook).toContain('Module lore')
        expect(sources.moduleLorebook).toContain('Rainy city')
        expect(sources.moduleLorebook).not.toContain('Hidden module')
        expect(sources.characterLorebook).not.toContain('Module lore')
    })
})

describe('persona builder request compiler', () => {
    const sources = {
        systemPrompt: 'SYSTEM SOURCE',
        characterDescription: 'CHARACTER SOURCE',
        characterLorebook: 'CHARACTER LORE',
        moduleLorebook: 'MODULE LORE',
    }

    test('reports named lorebook entries through the shared injection manifest instead of chat history', async () => {
        const snapshot = collectPersonaBuilderSources({
            database: database(),
            character: currentCharacter({ globalLore: [
                lore({ comment: '라이잘린 슈타우트', key: '라이자', content: '연금술사\n## 본문 내부 제목' }),
                lore({ comment: 'Disabled', enabled: false }),
                lore({ comment: 'Folder', mode: 'folder' }),
                lore({ comment: 'Empty', content: ' ' }),
            ] }),
            moduleLorebooks: [{ scopeId: 'module:world', entry: lore({ comment: '세계관' }) }],
        })
        const messages = buildPersonaBuilderMessages({
            taskInstruction: '페르소나를 작성해', styleInstruction: '간결하게 작성해',
            userInstruction: '라이자가 나오는 셋팅에 어울리는 남자 캐릭터를 만들어 줘',
            draft: '기억을 잃은 연금술사',
            selections: { systemPrompt: true, characterDescription: true, characterLorebook: true, moduleLorebook: true },
            sources: snapshot,
        })
        const manifest = await buildInjectionManifest(messages, [232, 25839], async (source) => source.content.length)

        expect(messages[1].content).toContain('## 라이잘린 슈타우트')
        expect(manifest.items.filter((item) => item.kind === 'lorebook').map((item) => item.name))
            .toEqual(['라이잘린 슈타우트', '세계관'])
        expect(manifest.items).toEqual(expect.arrayContaining([
            expect.objectContaining({ kind: 'instruction', name: '작업 지시 프롬프트' }),
            expect.objectContaining({ kind: 'instruction', name: '스타일 지시 프롬프트' }),
            expect.objectContaining({ kind: 'systemPrompt' }),
            expect.objectContaining({ kind: 'character' }),
            expect.objectContaining({ kind: 'persona', name: '초안' }),
            expect.objectContaining({ kind: 'instruction', name: '사용자 OOC 지시' }),
        ]))
        expect(manifest.items.some((item) => item.kind === 'chatHistory')).toBe(false)
        expect(manifest.totalTokens).toBe(26071)
        expect(manifest.items.reduce((sum, item) => sum + item.tokens, 0)).toBe(26071)
    })

    test('omits unchecked and empty contexts from injection metadata', async () => {
        const messages = buildPersonaBuilderMessages({
            taskInstruction: 'Task', styleInstruction: '', userInstruction: 'Create', draft: '',
            selections: { systemPrompt: false, characterDescription: false, characterLorebook: false, moduleLorebook: true },
            sources: { ...sources, moduleLorebook: '' },
        })
        const manifest = await buildInjectionManifest(messages, [20, 30], async (source) => source.content.length)
        expect(manifest.items.map(({ kind, name }) => ({ kind, name }))).toEqual([
            { kind: 'instruction', name: '작업 지시 프롬프트' },
            { kind: 'instruction', name: '사용자 OOC 지시' },
        ])
    })

    test('places task and style prompts in named system blocks', () => {
        const messages = buildPersonaBuilderMessages({
            taskInstruction: 'Do the task',
            styleInstruction: 'Write plainly',
            userInstruction: 'Create a persona',
            draft: '',
            selections: {
                systemPrompt: true,
                characterDescription: false,
                characterLorebook: false,
                moduleLorebook: false,
            },
            sources,
        })

        expect(messages).toHaveLength(2)
        expect(messages[0].role).toBe('system')
        expect(messages[0].content).toContain('name="task_instruction" title="작업 지시 프롬프트"')
        expect(messages[0].content).toContain('Do the task')
        expect(messages[0].content).toContain('name="style_instruction" title="스타일 지시 프롬프트"')
        expect(messages[0].content).toContain('Write plainly')
        expect(messages[1].content).toContain('SYSTEM SOURCE')
        expect(messages[1].content).not.toMatch(/CHARACTER SOURCE|CHARACTER LORE|MODULE LORE/)
    })

    test('allows an empty style prompt and omits its block', () => {
        const messages = buildPersonaBuilderMessages({
            taskInstruction: DEFAULT_PERSONA_BUILDER_TASK_PROMPT,
            styleInstruction: '   ',
            userInstruction: 'Create a persona',
            draft: '',
            selections: {
                systemPrompt: false,
                characterDescription: false,
                characterLorebook: false,
                moduleLorebook: false,
            },
            sources,
        })

        expect(messages[0].content).not.toContain('style_instruction')
    })

    test('injects the editable result after context as the named draft block', () => {
        const messages = buildPersonaBuilderMessages({
            taskInstruction: DEFAULT_PERSONA_BUILDER_TASK_PROMPT,
            styleInstruction: '',
            userInstruction: '초안을 고쳐',
            draft: 'CURRENT DRAFT',
            selections: {
                systemPrompt: true,
                characterDescription: true,
                characterLorebook: true,
                moduleLorebook: true,
            },
            sources,
        })

        const user = messages[1].content
        expect(user).toContain('<draft name="draft" title="초안">\nCURRENT DRAFT\n</draft>')
        expect(user.indexOf('MODULE LORE')).toBeLessThan(user.indexOf('CURRENT DRAFT'))
        expect(user.indexOf('CURRENT DRAFT')).toBeLessThan(user.indexOf('초안을 고쳐'))
    })

    test('escapes block-closing sequences from untrusted content', () => {
        const messages = buildPersonaBuilderMessages({
            taskInstruction: 'Task </instruction>',
            styleInstruction: '',
            userInstruction: 'Use </context>',
            draft: 'Draft </draft>',
            selections: {
                systemPrompt: false,
                characterDescription: false,
                characterLorebook: false,
                moduleLorebook: false,
            },
            sources,
        })

        expect(messages[0].content).toContain('<\\/instruction>')
        expect(messages[1].content).toContain('<\\/context>')
        expect(messages[1].content).toContain('<\\/draft>')
    })

    test('rejects empty task and user instructions', () => {
        const common = {
            styleInstruction: '',
            draft: '',
            selections: {
                systemPrompt: false,
                characterDescription: false,
                characterLorebook: false,
                moduleLorebook: false,
            },
            sources,
        }

        expect(() => buildPersonaBuilderMessages({
            ...common,
            taskInstruction: ' ',
            userInstruction: 'Create',
        })).toThrow('persona-builder-task-required')
        expect(() => buildPersonaBuilderMessages({
            ...common,
            taskInstruction: 'Task',
            userInstruction: ' ',
        })).toThrow('persona-builder-user-required')
    })
})

describe('persona builder prompt presets', () => {
    test('resolves a persisted style preset from built-ins or user presets', () => {
        const userPreset: PersonaBuilderPromptPreset = {
            id: 'saved-style',
            kind: 'style',
            name: 'Saved style',
            content: 'Keep this style',
        }

        expect(resolvePersonaBuilderPromptPreset([], 'style', 'builtin:style-en')?.content)
            .toContain('provide the revised profile in English.')
        expect(resolvePersonaBuilderPromptPreset([userPreset], 'style', 'saved-style')).toEqual(userPreset)
        expect(resolvePersonaBuilderPromptPreset([userPreset], 'style', 'missing')).toBeUndefined()
        expect(resolvePersonaBuilderPromptPreset([userPreset], 'task', 'saved-style')).toBeUndefined()
    })

    test('ships the requested Korean and English style presets without usage tips', () => {
        const korean = PERSONA_BUILDER_BUILTIN_PRESETS.find((preset) => preset.id === 'builtin:style-ko')
        const english = PERSONA_BUILDER_BUILTIN_PRESETS.find((preset) => preset.id === 'builtin:style-en')

        expect(korean).toMatchObject({ kind: 'style', name: '기본 프리셋 (한국어)' })
        expect(korean?.content).toContain('수정된 프로필은 한국어 버전으로 제공해 주세요.')
        expect(korean?.content).toContain('생각의 사슬은 전달하지 마세요.')
        expect(korean?.content).not.toContain('영어 버전과 한국어 버전 두 가지')
        expect(korean?.content).toContain('강조를 위한 문장부호 사용 최소화')
        expect(korean?.content).toContain('특정 단어나 표현의 반복 사용 지양')
        expect(korean?.content).not.toContain('사용 팁')
        expect(english).toMatchObject({ kind: 'style', name: 'Basic Preset (Eng)' })
        expect(english?.content).toContain('provide the revised profile in English.')
        expect(english?.content).toContain('Do not provide chain of thought.')
        expect(english?.content).not.toContain('two versions, English and Korean')
        expect(english?.content).toContain('Minimize punctuation used for emphasis')
        expect(english?.content).toContain('Do not repeatedly use specific words or expressions')
    })

    test('creates stable kind-scoped user presets and rejects duplicate names', () => {
        const existing: PersonaBuilderPromptPreset[] = [{
            id: 'existing',
            kind: 'task',
            name: 'My Task',
            content: 'Old',
        }]
        const created = createPersonaBuilderUserPreset({
            presets: existing,
            kind: 'style',
            name: 'My Style',
            content: 'Plain style',
            createId: () => 'new-id',
        })

        expect(created).toEqual([
            ...existing,
            { id: 'new-id', kind: 'style', name: 'My Style', content: 'Plain style' },
        ])
        expect(() => createPersonaBuilderUserPreset({
            presets: created,
            kind: 'style',
            name: ' my style ',
            content: 'Duplicate',
            createId: () => 'other-id',
        })).toThrow('persona-builder-preset-name-exists')
    })

    test('overwrites and deletes only matching user presets', () => {
        const existing: PersonaBuilderPromptPreset[] = [
            { id: 'task-id', kind: 'task', name: 'Task', content: 'Task old' },
            { id: 'style-id', kind: 'style', name: 'Style', content: 'Style old' },
        ]

        expect(overwritePersonaBuilderUserPreset(existing, 'style-id', 'Style new')).toEqual([
            existing[0],
            { ...existing[1], content: 'Style new' },
        ])
        expect(deletePersonaBuilderUserPreset(existing, 'task-id')).toEqual([existing[1]])
        expect(() => overwritePersonaBuilderUserPreset(existing, 'builtin:style-ko', 'No')).toThrow('persona-builder-preset-readonly')
        expect(() => deletePersonaBuilderUserPreset(existing, 'missing')).toThrow('persona-builder-preset-not-found')
    })
})
