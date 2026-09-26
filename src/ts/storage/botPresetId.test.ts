import { describe, test, expect, beforeEach, vi } from 'vitest'

// Mock heavy dependencies so importing database.svelte doesn't drag in the
// full Svelte/forage/globalApi stack. We do NOT mock database.svelte itself —
// these tests exercise the real botPreset id helpers and the active-preset
// stability invariant that PR S3 establishes.

vi.mock('../stores.svelte', () => {
    const state: { db: any } = { db: {} }
    const noopStore = { subscribe: () => () => {}, set: () => {}, update: () => {} }
    return {
        DBState: state,
        selectedCharID: { ...noopStore, subscribe: (run: (value: number) => void) => { run(0); return () => {} } },
        selIdState: { selId: -1 },
    }
})

vi.mock('../globalApi.svelte', () => ({
    forageStorage: { realStorage: null },
    downloadFile: () => {},
    saveAsset: () => Promise.resolve(''),
}))

vi.mock('../alert', () => ({
    notifySuccess: () => {},
    alertError: () => {},
}))

vi.mock('../../lang', () => ({
    language: {},
    changeLanguage: () => {},
}))

const databaseModule = await import('./database.svelte')
const storesModule = await import('../stores.svelte')
const {
    createBotPresetTemplate,
    getActiveBotPreset,
    getActiveBotPresetId,
    getBotPresetById,
    getBotPresetIndexById,
    changeToPreset,
    selectChatPromptPreset,
    deleteBotPreset,
    loadChatBindings,
    setActiveBotPresetById,
    saveCurrentPreset,
    syncActiveBotPresetFromMirror,
    syncActiveThemePresetFromMirror,
    setPreset,
    themePresetTemplate,
    withStableActivePreset,
} = databaseModule
const { DBState } = storesModule as any

function makePreset(id: string, name: string) {
    return { id, name, mainPrompt: '', jailbreak: '', globalNote: '', temperature: 0, maxContext: 0, maxResponse: 0, frequencyPenalty: 0, PresensePenalty: 0, formatingOrder: [], bias: [], promptPreprocess: false }
}

beforeEach(() => {
    DBState.db = {
        botPresets: [
            makePreset('id-a', 'A'),
            makePreset('id-b', 'B'),
            makePreset('id-c', 'C'),
        ],
        botPresetsId: 1,
    }
})

describe('prompt preset lifecycle', () => {
    function setup(activeIndex = 0) {
        const presets = ['old', 'next', 'third'].map((id) => ({
            ...createBotPresetTemplate(), id, name: id,
            mainPrompt: `${id}-prompt`,
            customPromptTemplateToggle: `${id}=Toggle`,
            moduleIntergration: `${id}-module`,
        }))
        const chat = {
            bindedBotPreset: presets[activeIndex].id,
            useLocallySetGlobalVariables: true,
            GLGlobalVariables: { toggle_saved: '1' },
            togglePresetBaseline: { name: 'Saved toggles', values: { toggle_saved: '1' } },
        }
        DBState.db = {
            ...structuredClone(presets[activeIndex]), NAIsettings: {},
            botPresets: presets, botPresetsId: activeIndex,
            characters: [{ chatPage: 0, chats: [chat, { bindedBotPreset: 'third' }] }],
        }
        return chat
    }

    test.each([0, 1, 2])('applies the replacement after deleting active index %i without saving old values into it', (index) => {
        setup(index)
        // Exercise the original deletion sequence as well as the shared API below.
        saveCurrentPreset()
        withStableActivePreset(() => { DBState.db.botPresets.splice(index, 1) })
        changeToPreset(0, false)
        const expected = index === 0 ? 'next' : 'old'
        expect(DBState.db.mainPrompt).toBe(`${expected}-prompt`)
        expect(DBState.db.customPromptTemplateToggle).toBe(`${expected}=Toggle`)
        expect(DBState.db.moduleIntergration).toBe(`${expected}-module`)
        syncActiveBotPresetFromMirror()
        expect(DBState.db.botPresets[0].moduleIntergration).toBe(`${expected}-module`)
        expect(DBState.db.botPresets[0].mainPrompt).toBe(`${expected}-prompt`)
    })

    test('deletes by stable ID and clears loaded bindings while preserving independent pinned toggle values', () => {
        const chat = setup()
        DBState.db.characters.push({ chats: [{ bindedBotPreset: 'old' }, { _placeholder: true, id: 'lazy' }] })
        expect(deleteBotPreset('old')).toBe(true)
        expect(DBState.db.botPresets.map((p: any) => p.id)).toEqual(['next', 'third'])
        expect(DBState.db.moduleIntergration).toBe('next-module')
        expect(chat.bindedBotPreset).toBe('')
        expect(DBState.db.characters[1].chats[0].bindedBotPreset).toBe('')
        expect(DBState.db.characters[0].chats[1].bindedBotPreset).toBe('third')
        expect(DBState.db.characters[1].chats[1]).toEqual({ _placeholder: true, id: 'lazy' })
        expect(chat.GLGlobalVariables).toEqual({ toggle_saved: '1' })
        expect(chat.togglePresetBaseline.name).toBe('Saved toggles')
        syncActiveBotPresetFromMirror()
        expect(DBState.db.botPresets[0].moduleIntergration).toBe('next-module')
    })

    test('deleting a non-active preset preserves active identity and unsaved edits', () => {
        setup(2)
        DBState.db.mainPrompt = 'edited third'
        expect(deleteBotPreset('old')).toBe(true)
        expect(getActiveBotPresetId()).toBe('third')
        expect(DBState.db.mainPrompt).toBe('edited third')
        expect(getActiveBotPreset()?.mainPrompt).toBe('edited third')
        expect(DBState.db.moduleIntergration).toBe('third-module')
    })

    test('refuses missing or last remaining preset deletion without changing state', () => {
        setup()
        expect(deleteBotPreset('missing')).toBe(false)
        deleteBotPreset('next')
        deleteBotPreset('third')
        const before = structuredClone(DBState.db)
        expect(deleteBotPreset('old')).toBe(false)
        expect(DBState.db).toEqual(before)
    })

    test('explicit selection updates the current binding and runtime without changing another chat', () => {
        const chat = setup()
        selectChatPromptPreset(1)
        expect(chat.bindedBotPreset).toBe('next')
        expect(DBState.db.moduleIntergration).toBe('next-module')
        expect(DBState.db.customPromptTemplateToggle).toBe('next=Toggle')
        expect(DBState.db.characters[0].chats[1].bindedBotPreset).toBe('third')
        expect(chat.GLGlobalVariables).toEqual({ toggle_saved: '1' })
    })

    test('explicit selection of the already active preset still updates an older chat binding', () => {
        const chat = setup()
        chat.bindedBotPreset = 'third'
        selectChatPromptPreset(0)
        expect(chat.bindedBotPreset).toBe('old')
    })

    test('keeps unbound chats unbound and automatic preset changes do not rewrite bindings', () => {
        const chat = setup()
        changeToPreset(1)
        expect(chat.bindedBotPreset).toBe('old')
        chat.bindedBotPreset = ''
        selectChatPromptPreset(2)
        expect(chat.bindedBotPreset).toBe('')
        expect(DBState.db.moduleIntergration).toBe('third-module')
    })

    test.each([-1, 99, 0.5, NaN])('ignores invalid selection %s without saving or changing bindings', (index) => {
        setup()
        const before = structuredClone(DBState.db)
        expect(() => changeToPreset(index)).not.toThrow()
        expect(() => selectChatPromptPreset(index)).not.toThrow()
        expect(DBState.db).toEqual(before)
    })

    test('switching to a preset without module integration or toggles clears the previous values', () => {
        setup()
        delete DBState.db.botPresets[1].moduleIntergration
        delete DBState.db.botPresets[1].customPromptTemplateToggle
        changeToPreset(1)
        expect(DBState.db.moduleIntergration).toBe('')
        expect(DBState.db.customPromptTemplateToggle).toBe('')
    })

    test('entering a bound chat applies its preset without mounting the sidebar', () => {
        const chat = setup()
        DBState.db.characters[0].chatPage = 1
        const other = DBState.db.characters[0].chats[1]
        loadChatBindings(other)
        expect(getActiveBotPresetId()).toBe('third')
        expect(DBState.db.moduleIntergration).toBe('third-module')
        DBState.db.characters[0].chatPage = 0
        loadChatBindings(chat as any)
        expect(getActiveBotPresetId()).toBe('old')
        expect(DBState.db.moduleIntergration).toBe('old-module')
    })

    test('clears a deleted binding on lazy chat entry even when toggle binding is disabled', () => {
        const chat = setup()
        chat.bindedBotPreset = 'deleted'
        DBState.db.disableToggleBinding = true
        loadChatBindings(chat as any)
        expect(chat.bindedBotPreset).toBe('')
        expect(getActiveBotPresetId()).toBe('old')
        expect(chat.GLGlobalVariables).toEqual({ toggle_saved: '1' })
    })

    test('does not restore a binding from a chat placeholder', () => {
        setup()
        loadChatBindings({ _placeholder: true, bindedBotPreset: 'third' } as any)
        expect(getActiveBotPresetId()).toBe('old')
    })
})

describe('createBotPresetTemplate', () => {
    test('assigns a unique UUID on each call', () => {
        const a = createBotPresetTemplate()
        const b = createBotPresetTemplate()
        expect(a.id).toBeTruthy()
        expect(b.id).toBeTruthy()
        expect(a.id).not.toBe(b.id)
    })

    test('returns a deep-cloned template (mutating one does not affect another)', () => {
        const a = createBotPresetTemplate()
        const b = createBotPresetTemplate()
        a.name = 'Mutated'
        expect(b.name).not.toBe('Mutated')
    })

    test('provides an empty optional description for old preset compatibility', () => {
        expect(createBotPresetTemplate().description).toBe('')
    })

    test('keeps the edited description when the active preset mirror is saved', () => {
        const preset = createBotPresetTemplate()
        preset.description = '설명 https://example.com'
        DBState.db = {
            ...preset,
            botPresets: [preset],
            botPresetsId: 0,
        }

        saveCurrentPreset()

        expect(DBState.db.botPresets[0].description).toBe('설명 https://example.com')
    })

    test('keeps the prompt block overlay when the active preset mirror is saved', () => {
        const preset = createBotPresetTemplate()
        const promptBlockOverlay = {
            enabled: true,
            profileId: 'memo-profile',
            includeReferencedToggles: true,
            rules: [{
                source: { index: 0, name: '📙 Memo', type: 'plain' },
                target: { index: 0, name: 'System', type: 'plain' },
                placement: 'before',
            }],
            profileSettings: {
                'other-profile': {
                    enabled: true,
                    includeReferencedToggles: false,
                    rules: [],
                },
            },
        }
        DBState.db = {
            ...preset,
            promptBlockOverlay,
            botPresets: [preset],
            botPresetsId: 0,
        }

        saveCurrentPreset()

        expect(DBState.db.botPresets[0].promptBlockOverlay).toEqual(promptBlockOverlay)
        expect(DBState.db.botPresets[0].promptBlockOverlay).not.toBe(promptBlockOverlay)
    })

    test('synchronizes prompt edits and ordering into the active preset without switching presets', () => {
        const preset = createBotPresetTemplate()
        preset.promptTemplate = [
            { type: 'plain', type2: 'normal', role: 'system', text: 'First' },
            { type: 'plain', type2: 'normal', role: 'user', text: 'Second' },
        ]
        ;(preset as any).futureField = { keep: true }
        DBState.db = {
            ...structuredClone(preset),
            promptTemplate: [
                { type: 'plain', type2: 'normal', role: 'user', text: 'Second!' },
                { type: 'plain', type2: 'normal', role: 'system', text: 'First' },
            ],
            botPresets: [structuredClone(preset)],
            botPresetsId: 0,
        }

        expect(syncActiveBotPresetFromMirror()).toBe(true)
        expect(DBState.db.botPresets[0].promptTemplate).toEqual(DBState.db.promptTemplate)
        expect(DBState.db.botPresets[0].futureField).toEqual({ keep: true })
        expect(syncActiveBotPresetFromMirror()).toBe(false)
    })

    test('synchronizes current theme edits into the active theme preset without switching presets', () => {
        const preset = structuredClone(themePresetTemplate)
        DBState.db = {
            ...structuredClone(preset),
            customCSS: '.before {}',
            themePresets: [preset],
            themePresetsId: 0,
        }
        DBState.db.customCSS = '.after {}'

        expect(syncActiveThemePresetFromMirror()).toBe(true)
        expect(DBState.db.themePresets[0].customCSS).toBe('.after {}')
        expect(syncActiveThemePresetFromMirror()).toBe(false)
    })

    test('loads an isolated prompt block overlay into the active preset mirror', () => {
        const preset = createBotPresetTemplate()
        const promptBlockOverlay = {
            enabled: true,
            profileId: 'memo-profile',
            includeReferencedToggles: true,
            rules: [],
            profileSettings: {
                'other-profile': {
                    enabled: false,
                    includeReferencedToggles: true,
                    rules: [],
                },
            },
        }
        const target = { ...preset, promptBlockOverlay }
        DBState.db = {
            ...preset,
            NAIsettings: {},
            botPresets: [target],
            botPresetsId: 0,
        }

        setPreset(DBState.db, target)

        expect(DBState.db.promptBlockOverlay).toEqual(promptBlockOverlay)
        expect(DBState.db.promptBlockOverlay).not.toBe(promptBlockOverlay)
    })
})

describe('id lookup helpers', () => {
    test('reselecting the active preset is a no-op', () => {
        const active = DBState.db.botPresets[1]
        DBState.db.NAIsettings = {}

        changeToPreset(1)

        expect(DBState.db.botPresets[1]).toBe(active)
        expect(DBState.db.botPresetsId).toBe(1)
    })

    test('getActiveBotPreset returns the entry at botPresetsId', () => {
        expect(getActiveBotPreset()?.id).toBe('id-b')
    })

    test('getActiveBotPresetId returns the active id', () => {
        expect(getActiveBotPresetId()).toBe('id-b')
    })

    test('getBotPresetById finds by id', () => {
        expect(getBotPresetById('id-c')?.name).toBe('C')
    })

    test('getBotPresetIndexById returns -1 when not found', () => {
        expect(getBotPresetIndexById('id-missing')).toBe(-1)
    })

    test('setActiveBotPresetById updates botPresetsId via findIndex', () => {
        setActiveBotPresetById('id-c')
        expect(DBState.db.botPresetsId).toBe(2)
    })

    test('setActiveBotPresetById(undefined) sets the no-active sentinel', () => {
        setActiveBotPresetById(undefined)
        expect(DBState.db.botPresetsId).toBe(-1)
    })
})

describe('withStableActivePreset', () => {
    test('preserves active id when array is reordered', () => {
        // botPresetsId=1 (id-b) is active. Move 'B' from index 1 to index 0.
        withStableActivePreset(() => {
            const arr = DBState.db.botPresets
            const moved = arr.splice(1, 1)[0]
            arr.splice(0, 0, moved)
            DBState.db.botPresets = arr
        })
        // After reorder, B is at index 0. botPresetsId should follow.
        expect(DBState.db.botPresetsId).toBe(0)
        expect(getActiveBotPresetId()).toBe('id-b')
    })

    test('preserves active id when a non-active preset is removed', () => {
        // botPresetsId=1 (id-b). Remove id-a (index 0).
        withStableActivePreset(() => {
            DBState.db.botPresets.splice(0, 1)
        })
        // B should still be active (now at index 0).
        expect(getActiveBotPresetId()).toBe('id-b')
        expect(DBState.db.botPresetsId).toBe(0)
    })

    test('clamps to 0 when the active preset itself is removed', () => {
        // botPresetsId=1 (id-b). Remove id-b.
        withStableActivePreset(() => {
            DBState.db.botPresets.splice(1, 1)
        })
        // active id was id-b which no longer exists → fall back to 0.
        expect(DBState.db.botPresetsId).toBe(0)
        expect(getActiveBotPresetId()).toBe('id-a')
    })

    test('handles append (length grows) without losing active', () => {
        withStableActivePreset(() => {
            DBState.db.botPresets.push(makePreset('id-d', 'D'))
        })
        expect(getActiveBotPresetId()).toBe('id-b')
        expect(DBState.db.botPresetsId).toBe(1)
    })
})

describe('id migration safety', () => {
    test('helpers cope with presets missing an id (treat as not findable)', () => {
        DBState.db.botPresets = [
            { name: 'no-id-preset' },
            makePreset('id-x', 'X'),
        ]
        DBState.db.botPresetsId = 0
        // Active preset has no id → getActiveBotPresetId returns undefined,
        // setupping the migration path (setDatabase will fix it on next load).
        expect(getActiveBotPresetId()).toBeUndefined()
        // Lookup by id still works for the indexed entry.
        expect(getBotPresetIndexById('id-x')).toBe(1)
    })
})
