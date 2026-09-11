import { describe, expect, it } from 'vitest'
import type { Database, character, loreBook } from './storage/database.svelte'
import {
    DEFAULT_LORE_BUILDER_TASK_PROMPT,
    LORE_BUILDER_BUILTIN_PRESETS,
    buildLoreBuilderMessages,
    collectLoreBuilderSources,
    createLoreBuilderUserPreset,
    deleteLoreBuilderUserPreset,
    loadLoreBuilderSelections,
    overwriteLoreBuilderUserPreset,
    resolveLoreBuilderPromptPreset,
    saveLoreBuilderSelections,
} from './loreBuilder'

const lore = (id: string, content: string): loreBook => ({
    id,
    key: id,
    secondkey: '',
    insertorder: 100,
    comment: id,
    content,
    mode: 'normal',
    alwaysActive: false,
    selective: false,
})

describe('lore builder prompt contract', () => {
    it('resolves a persisted style preset from built-ins or user presets', () => {
        const userPreset = { id: 'saved-style', kind: 'style' as const, name: 'Saved style', content: 'Keep lore style' }

        expect(resolveLoreBuilderPromptPreset([], 'style', 'builtin:lore-style-en')?.content)
            .toContain('English lorebook writing rules')
        expect(resolveLoreBuilderPromptPreset([userPreset], 'style', 'saved-style')).toEqual(userPreset)
        expect(resolveLoreBuilderPromptPreset([userPreset], 'style', 'missing')).toBeUndefined()
        expect(resolveLoreBuilderPromptPreset([userPreset], 'task', 'saved-style')).toBeUndefined()
    })

    it('ships a structured, factual, output-only lorebook prompt', () => {
        expect(DEFAULT_LORE_BUILDER_TASK_PROMPT).toContain('롤플레잉')
        expect(DEFAULT_LORE_BUILDER_TASK_PROMPT).toContain('Markdown')
        expect(DEFAULT_LORE_BUILDER_TASK_PROMPT).toContain('공개')
        expect(DEFAULT_LORE_BUILDER_TASK_PROMPT).toContain('비공개')
        expect(DEFAULT_LORE_BUILDER_TASK_PROMPT).toContain('본문만 출력')
        expect(LORE_BUILDER_BUILTIN_PRESETS.map((preset) => preset.id)).toEqual([
            'builtin:lore-task-default',
            'builtin:lore-style-ko',
            'builtin:lore-style-en',
        ])
    })

    it('excludes the target entry from character and module lore snapshots', () => {
        const target = lore('target', 'target body')
        const related = lore('related', 'related body')
        const moduleRelated = lore('module-related', 'module body')
        const sources = collectLoreBuilderSources({
            database: { mainPrompt: 'system rules' } as Database,
            character: {
                name: 'Character',
                desc: 'description',
                globalLore: [target, related],
            } as character,
            moduleLorebooks: [
                { scopeId: 'module-a', entry: target },
                { scopeId: 'module-a', entry: moduleRelated },
            ],
            targetEntryId: 'target',
        })

        expect(sources.characterLorebook).toContain('related body')
        expect(sources.characterLorebook).not.toContain('target body')
        expect(sources.moduleLorebook).toContain('module body')
        expect(sources.moduleLorebook).not.toContain('target body')
    })

    it('resolves main prompt blocks with the current chat toggle values', () => {
        const sources = collectLoreBuilderSources({
            database: {
                promptTemplate: [{
                    type: 'plain',
                    type2: 'main',
                    role: 'system',
                    text: 'Always\n{{#when::toggle::detail}}Chat detail{{/}}',
                }],
            } as unknown as Database,
            character: { name: 'Character', globalLore: [] } as character,
            moduleLorebooks: [],
            targetEntryId: 'target',
            parsePrompt: (text) => text.replace('{{#when::toggle::detail}}', '').replace('{{/}}', ''),
        })

        expect(sources.systemPrompt).toContain('Chat detail')
        expect(sources.systemPrompt).not.toContain('{{#when')
    })

    it('does not fall back to the legacy prompt when toggles hide every main block', () => {
        const sources = collectLoreBuilderSources({
            database: {
                mainPrompt: 'Legacy prompt',
                promptTemplate: [{
                    type: 'plain', type2: 'main', role: 'system',
                    text: '{{#when::toggle::detail}}Chat detail{{/}}',
                }],
            } as Database,
            character: { name: 'Character', globalLore: [] } as character,
            moduleLorebooks: [],
            targetEntryId: 'target',
            parsePrompt: (text) => text === 'Legacy prompt' ? text : '',
        })

        expect(sources.systemPrompt).toBe('')
    })

    it('serializes only selected context plus the current draft and latest instruction', () => {
        const messages = buildLoreBuilderMessages({
            taskInstruction: 'task contract',
            styleInstruction: 'style contract',
            userInstruction: 'tighten the secret section',
            draft: '# Existing lore',
            selections: {
                systemPrompt: false,
                characterDescription: true,
                characterLorebook: false,
                moduleLorebook: true,
            },
            sources: {
                systemPrompt: 'excluded system',
                characterDescription: 'included character',
                characterLorebook: 'excluded character lore',
                moduleLorebook: 'included module lore',
            },
        })

        expect(messages).toHaveLength(2)
        expect(messages[0].content).toContain('task contract')
        expect(messages[0].content).toContain('style contract')
        expect(messages[1].content).toContain('included character')
        expect(messages[1].content).toContain('included module lore')
        expect(messages[1].content).toContain('# Existing lore')
        expect(messages[1].content).toContain('tighten the secret section')
        expect(messages[1].content).not.toContain('excluded system')
        expect(messages[1].content).not.toContain('excluded character lore')
    })

    it('keeps lore presets mutable without allowing built-ins to be overwritten', () => {
        const created = createLoreBuilderUserPreset({
            presets: [],
            kind: 'style',
            name: 'House style',
            content: 'concise facts',
            createId: () => 'user-1',
        })
        expect(created[0]).toMatchObject({ id: 'user-1', kind: 'style' })
        expect(overwriteLoreBuilderUserPreset(created, 'user-1', 'new rules')[0].content).toBe('new rules')
        expect(deleteLoreBuilderUserPreset(created, 'user-1')).toEqual([])
        expect(() => overwriteLoreBuilderUserPreset(created, 'builtin:lore-style-ko', 'x'))
            .toThrow('lore-builder-preset-readonly')
    })

    it('round-trips context switch preferences and ignores malformed storage', () => {
        const storage = localStorage
        storage.clear()
        const selections = {
            systemPrompt: true,
            characterDescription: false,
            characterLorebook: false,
            moduleLorebook: true,
        }

        saveLoreBuilderSelections(selections, storage)
        expect(loadLoreBuilderSelections(storage)).toEqual(selections)
        storage.setItem('risubard:lore-builder-selections:v1', '{broken')
        expect(loadLoreBuilderSelections(storage)).toBeNull()
    })
})
