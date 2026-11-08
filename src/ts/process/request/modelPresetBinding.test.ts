import { describe, expect, test, beforeEach, vi } from 'vitest'

// Mock the database module so resolveChatModelBinding reads a controllable db.
// Only getDatabase is imported at runtime by modelPresetBinding.ts (everything
// else there is type-only), so a minimal factory keeps us off the big import graph.
let mockDb: any
vi.mock('src/ts/storage/database.svelte', () => ({
    getDatabase: () => mockDb,
}))

import {
    resolveChatModelBinding,
    resolveRequestModelBindingTarget,
    resolvePresetMaxOutputTokens,
    resolveChatMaxResponseTokens,
    applyPromptPresetParams,
    applyPromptPresetValues,
} from './modelPresetBinding'
import { emptyModelBinding } from 'src/ts/preset/types'

const PRESET = { id: 'p-main', name: 'Main' } as any

function bindingWith(main?: string) {
    const b = emptyModelBinding()
    if (main !== undefined) b.main = main
    return b
}

beforeEach(() => {
    mockDb = {
        modelPresets: [PRESET],
        nodeOnlyModelModeLock: 'none',
        useModelPresetByDefault: false,
        defaultModelBinding: undefined,
    }
})

describe('resolveChatModelBinding — regime gate', () => {
    test("lock 'none': an undecided existing chat stays classic", () => {
        const chat = { useModelPreset: undefined, modelBinding: undefined } as any
        expect(resolveChatModelBinding(chat, 'model')).toEqual({ kind: 'classic' })
    })

    test("lock 'none': new-chat default does NOT retroactively flip undecided chats (finding 1)", () => {
        mockDb.useModelPresetByDefault = true // user set new-chat default = preset
        const chat = { useModelPreset: undefined, modelBinding: undefined } as any
        // The default is snapshotted at creation, never read here — so an old
        // chat that never chose remains classic.
        expect(resolveChatModelBinding(chat, 'model')).toEqual({ kind: 'classic' })
    })

    test("lock 'none': a chat that explicitly chose preset resolves its own bundle", () => {
        const chat = { useModelPreset: true, modelBinding: bindingWith('p-main') } as any
        expect(resolveChatModelBinding(chat, 'model')).toEqual({ kind: 'modelPreset', preset: PRESET })
    })

    test("lock 'none': preset chat with no bundle blocks (no live default fallback — finding 2)", () => {
        mockDb.defaultModelBinding = bindingWith('p-main') // set, but must NOT leak in
        const chat = { useModelPreset: true, modelBinding: undefined } as any
        expect(resolveChatModelBinding(chat, 'model')).toEqual({ kind: 'block', reason: 'main-unset' })
    })

    test("lock 'legacy': forces classic even when the chat chose preset", () => {
        mockDb.nodeOnlyModelModeLock = 'legacy'
        const chat = { useModelPreset: true, modelBinding: bindingWith('p-main') } as any
        expect(resolveChatModelBinding(chat, 'model')).toEqual({ kind: 'classic' })
    })

    test("lock 'preset': forces preset and falls back to the global default for un-seeded chats", () => {
        mockDb.nodeOnlyModelModeLock = 'preset'
        mockDb.defaultModelBinding = bindingWith('p-main')
        const chat = { useModelPreset: false, modelBinding: undefined } as any
        expect(resolveChatModelBinding(chat, 'model')).toEqual({ kind: 'modelPreset', preset: PRESET })
    })

    test("lock 'preset': blocks when neither the chat nor the global default has a bundle", () => {
        mockDb.nodeOnlyModelModeLock = 'preset'
        const chat = { useModelPreset: false, modelBinding: undefined } as any
        expect(resolveChatModelBinding(chat, 'model')).toEqual({ kind: 'block', reason: 'main-unset' })
    })
})

describe('resolveChatModelBinding — main and sub regimes chosen separately', () => {
    const SUB = { id: 'p-sub', name: 'Sub' } as any
    beforeEach(() => { mockDb.modelPresets = [PRESET, SUB] })
    function mixedBinding() {
        const b = bindingWith('p-main')
        b.sub = 'p-sub'
        return b
    }

    test('an unset sub regime follows the main regime', () => {
        const chat = { useModelPreset: true, modelBinding: mixedBinding() } as any
        expect(resolveChatModelBinding(chat, 'submodel')).toEqual({ kind: 'modelPreset', preset: SUB })
        expect(resolveChatModelBinding(chat, 'memory')).toEqual({ kind: 'modelPreset', preset: SUB })
    })

    test('preset main with legacy sub sends sub and aux requests down the classic path', () => {
        const chat = { useModelPreset: true, subUseModelPreset: false, modelBinding: mixedBinding() } as any
        expect(resolveChatModelBinding(chat, 'model')).toEqual({ kind: 'modelPreset', preset: PRESET })
        expect(resolveChatModelBinding(chat, 'submodel')).toEqual({ kind: 'classic' })
        expect(resolveChatModelBinding(chat, 'otherAx')).toEqual({ kind: 'classic' })
    })

    test('legacy main with preset sub uses the preset only for sub and aux requests', () => {
        const chat = { useModelPreset: false, subUseModelPreset: true, modelBinding: mixedBinding() } as any
        expect(resolveChatModelBinding(chat, 'model')).toEqual({ kind: 'classic' })
        expect(resolveChatModelBinding(chat, 'translate')).toEqual({ kind: 'modelPreset', preset: SUB })
    })

    test('a global lock overrides the separate sub choice', () => {
        mockDb.nodeOnlyModelModeLock = 'legacy'
        const chat = { useModelPreset: false, subUseModelPreset: true, modelBinding: mixedBinding() } as any
        expect(resolveChatModelBinding(chat, 'submodel')).toEqual({ kind: 'classic' })
    })
})

describe('resolveChatModelBinding — per-module override', () => {
    const MODULE_PRESET = { id: 'p-module', name: 'Module' } as any
    const classicChat = { useModelPreset: undefined, modelBinding: undefined } as any

    beforeEach(() => {
        mockDb.modelPresets = [PRESET, MODULE_PRESET]
        mockDb.moduleModelBindingsEnabled = true
        mockDb.moduleModelBindings = { 'mod-1': 'p-module' }
    })

    test('a bound module wins over the classic regime', () => {
        expect(resolveChatModelBinding(classicChat, 'otherAx', 'mod-1'))
            .toEqual({ kind: 'modelPreset', preset: MODULE_PRESET })
    })

    test("wins for mode 'model' too — a module's LLM call is never the visible reply", () => {
        expect(resolveChatModelBinding(classicChat, 'model', 'mod-1'))
            .toEqual({ kind: 'modelPreset', preset: MODULE_PRESET })
    })

    test('master switch off: falls through to normal resolution', () => {
        mockDb.moduleModelBindingsEnabled = false
        expect(resolveChatModelBinding(classicChat, 'model', 'mod-1')).toEqual({ kind: 'classic' })
    })

    test('unbound module falls through to normal resolution', () => {
        expect(resolveChatModelBinding(classicChat, 'model', 'mod-other')).toEqual({ kind: 'classic' })
    })

    test('no moduleId (character script / normal send) is untouched', () => {
        expect(resolveChatModelBinding(classicChat, 'model')).toEqual({ kind: 'classic' })
    })

    test('dangling preset id falls through rather than blocking', () => {
        mockDb.moduleModelBindings = { 'mod-1': 'p-deleted' }
        expect(resolveChatModelBinding(classicChat, 'model', 'mod-1')).toEqual({ kind: 'classic' })
    })

    test('overrides a preset-regime chat that already resolves to another preset', () => {
        const presetChat = { useModelPreset: true, modelBinding: bindingWith('p-main') } as any
        expect(resolveChatModelBinding(presetChat, 'model')).toEqual({ kind: 'modelPreset', preset: PRESET })
        expect(resolveChatModelBinding(presetChat, 'model', 'mod-1'))
            .toEqual({ kind: 'modelPreset', preset: MODULE_PRESET })
    })
})

function presetWith(opts: { schema?: any[]; userValues?: any; defaults?: any } = {}) {
    return {
        id: 'p-main',
        name: 'Main',
        profileSnapshot: { schema: opts.schema ?? [], defaults: opts.defaults },
        userValues: opts.userValues ?? {},
    } as any
}

describe('resolvePresetMaxOutputTokens — output cap comes from the preset, not db.maxResponse', () => {
    test('reads the userValue of the field that maps to body.max_tokens', () => {
        const preset = presetWith({
            schema: [{ key: 'max_tokens', default: 4096, mapsTo: { target: 'body', path: 'max_tokens' } }],
            userValues: { max_tokens: 8192 },
        })
        expect(resolvePresetMaxOutputTokens(preset)).toBe(8192)
    })

    test('falls back to the schema default when the user left the field unset', () => {
        const preset = presetWith({
            schema: [{ key: 'max_tokens', default: 4096, mapsTo: { target: 'body', path: 'max_tokens' } }],
        })
        expect(resolvePresetMaxOutputTokens(preset)).toBe(4096)
    })

    test('matches Gemini-native maxOutputTokens via its nested body path', () => {
        const preset = presetWith({
            schema: [{ key: 'maxOutputTokens', mapsTo: { target: 'body', path: 'generationConfig.maxOutputTokens' } }],
            userValues: { maxOutputTokens: 2048 },
        })
        expect(resolvePresetMaxOutputTokens(preset)).toBe(2048)
    })

    test('returns undefined when no output-token field is declared', () => {
        const preset = presetWith({
            schema: [{ key: 'temperature', mapsTo: { target: 'body', path: 'temperature' } }],
        })
        expect(resolvePresetMaxOutputTokens(preset)).toBeUndefined()
    })

    test('ignores a non-positive or non-numeric value (falls through to undefined)', () => {
        const preset = presetWith({
            schema: [{ key: 'max_tokens', default: 4096, mapsTo: { target: 'body', path: 'max_tokens' } }],
            userValues: { max_tokens: 0 },
        })
        expect(resolvePresetMaxOutputTokens(preset)).toBeUndefined()
    })

    test('legacy snapshot: schema has no output field but defaults carries it (Anthropic 4096)', () => {
        // An Anthropic preset snapshotted before the schema gained max_tokens —
        // the cap lives only in profileSnapshot.defaults.
        const preset = presetWith({
            schema: [{ key: 'apiKey', mapsTo: { target: 'auth', path: 'apiKey' } }],
            defaults: { max_tokens: 4096 },
        })
        expect(resolvePresetMaxOutputTokens(preset)).toBe(4096)
    })

    test('schema output field with no default/userValue falls through to defaults', () => {
        const preset = presetWith({
            schema: [{ key: 'max_tokens', mapsTo: { target: 'body', path: 'max_tokens' } }],
            defaults: { max_tokens: 8192 },
        })
        expect(resolvePresetMaxOutputTokens(preset)).toBe(8192)
    })

    test('defaults fallback resolves a nested Gemini path declared by the schema', () => {
        const preset = presetWith({
            schema: [{ key: 'maxOutputTokens', mapsTo: { target: 'body', path: 'generationConfig.maxOutputTokens' } }],
            defaults: { generationConfig: { maxOutputTokens: 2048 } },
        })
        expect(resolvePresetMaxOutputTokens(preset)).toBe(2048)
    })

    test('user-set value still wins over defaults', () => {
        const preset = presetWith({
            schema: [{ key: 'max_tokens', default: 4096, mapsTo: { target: 'body', path: 'max_tokens' } }],
            userValues: { max_tokens: 16000 },
            defaults: { max_tokens: 4096 },
        })
        expect(resolvePresetMaxOutputTokens(preset)).toBe(16000)
    })
})

describe('resolveChatMaxResponseTokens — the bug: stray legacy db.maxResponse must not leak into preset budgeting', () => {
    test('classic chat uses the global db.maxResponse', () => {
        mockDb.maxResponse = 300
        const chat = { useModelPreset: false, modelBinding: undefined } as any
        expect(resolveChatMaxResponseTokens(chat)).toBe(300)
    })

    test('preset chat uses the preset output cap, NOT the stray legacy db.maxResponse (65535)', () => {
        // db.maxResponse carries a high value imported from a shared prompt
        // preset; the budget must ignore it and reserve the preset's 8192.
        mockDb.maxResponse = 65535
        mockDb.modelPresets = [presetWith({
            schema: [{ key: 'max_tokens', default: 4096, mapsTo: { target: 'body', path: 'max_tokens' } }],
            userValues: { max_tokens: 8192 },
        })]
        const chat = { useModelPreset: true, modelBinding: bindingWith('p-main') } as any
        expect(resolveChatMaxResponseTokens(chat)).toBe(8192)
    })

    test('preset with no output-token field falls back to db.maxResponse', () => {
        mockDb.maxResponse = 500
        mockDb.modelPresets = [presetWith()]
        const chat = { useModelPreset: true, modelBinding: bindingWith('p-main') } as any
        expect(resolveChatMaxResponseTokens(chat)).toBe(500)
    })
})

describe('applyPromptPresetParams — per-chat prompt-preset sampling override', () => {
    const SAMPLING_SCHEMA = [
        { key: 'temperature', default: 0.7, mapsTo: { target: 'body', path: 'temperature' } },
        { key: 'top_p', default: 1, mapsTo: { target: 'body', path: 'top_p' } },
        { key: 'max_tokens', default: 4096, mapsTo: { target: 'body', path: 'max_tokens' } },
    ]

    beforeEach(() => {
        // Classic prompt-preset params as mirrored into db.* by setPreset
        // (temperature / penalties are stored in hundredths).
        mockDb.temperature = 80
        mockDb.top_p = 0.9
        mockDb.top_k = 40
        mockDb.frequencyPenalty = 50
        mockDb.PresensePenalty = -1000 // slider disabled
        mockDb.maxResponse = 65535
    })

    const onChat = { usePromptPresetParams: true } as any

    test('identity when the chat did not opt in', () => {
        const preset = presetWith({ schema: SAMPLING_SCHEMA })
        expect(applyPromptPresetParams(preset, { usePromptPresetParams: false } as any, 'model')).toBe(preset)
        expect(applyPromptPresetParams(preset, {} as any, 'model')).toBe(preset)
        expect(applyPromptPresetParams(preset, undefined, 'model')).toBe(preset)
    })

    test('identity for non-main modes even when opted in', () => {
        const preset = presetWith({ schema: SAMPLING_SCHEMA })
        expect(applyPromptPresetParams(preset, onChat, 'submodel')).toBe(preset)
        expect(applyPromptPresetParams(preset, onChat, 'memory')).toBe(preset)
    })

    test('injects normalized sampling values over userValues without mutating the stored preset', () => {
        const preset = presetWith({
            schema: SAMPLING_SCHEMA,
            userValues: { temperature: 0.2, apiKey: 'k' },
        })
        const out = applyPromptPresetParams(preset, onChat, 'model')
        expect(out).not.toBe(preset)
        expect(out.userValues.temperature).toBe(0.8) // 80 hundredths -> 0.8, beats the editor's 0.2
        expect(out.userValues.top_p).toBe(0.9)
        expect(out.userValues.apiKey).toBe('k') // unrelated values preserved
        expect(preset.userValues).toEqual({ temperature: 0.2, apiKey: 'k' }) // input untouched
    })

    test('schema-gated: params the profile does not declare are not injected (top_k), and output caps never are', () => {
        const preset = presetWith({ schema: SAMPLING_SCHEMA })
        const out = applyPromptPresetParams(preset, onChat, 'model')
        expect(out.userValues).not.toHaveProperty('top_k') // db.top_k=40 but schema lacks it
        expect(out.userValues).not.toHaveProperty('max_tokens') // sampling only, never the output cap
    })

    test('-1000 slider-disabled sentinel is treated as unset', () => {
        const preset = presetWith({
            schema: [
                { key: 'presence_penalty', mapsTo: { target: 'body', path: 'presence_penalty' } },
                { key: 'frequency_penalty', mapsTo: { target: 'body', path: 'frequency_penalty' } },
            ],
        })
        const out = applyPromptPresetParams(preset, onChat, 'model')
        expect(out.userValues).not.toHaveProperty('presence_penalty') // PresensePenalty = -1000
        expect(out.userValues.frequency_penalty).toBe(0.5) // 50 hundredths -> 0.5
    })

    test.each([-1000, -1, 201])('does not inject invalid stored temperature %i', (temperature) => {
        mockDb.temperature = temperature
        const preset = presetWith({
            schema: SAMPLING_SCHEMA,
            userValues: { temperature: 0.2 },
        })

        expect(applyPromptPresetParams(preset, onChat, 'model').userValues.temperature).toBe(0.2)
    })

    test('does not inject stored sampling values outside the target field schema', () => {
        mockDb.top_k = 101
        const preset = presetWith({
            schema: [
                {
                    key: 'top_k',
                    type: 'integer',
                    min: 0,
                    max: 100,
                    mapsTo: { target: 'body', path: 'top_k' },
                },
            ],
            userValues: { top_k: 40 },
        })

        expect(applyPromptPresetParams(preset, onChat, 'model').userValues.top_k).toBe(40)
        expect(mockDb.top_k).toBe(101)
    })

    test('wire-flavored alias keys map to the same classic values (Gemini camelCase)', () => {
        const preset = presetWith({
            schema: [
                { key: 'topP', mapsTo: { target: 'body', path: 'generationConfig.topP' } },
                { key: 'topK', mapsTo: { target: 'body', path: 'generationConfig.topK' } },
            ],
        })
        const out = applyPromptPresetParams(preset, onChat, 'model')
        expect(out.userValues.topP).toBe(0.9)
        expect(out.userValues.topK).toBe(40)
    })

    test('non-body mappings are ignored even if the key matches', () => {
        const preset = presetWith({
            schema: [{ key: 'temperature', mapsTo: { target: 'header', path: 'X-Temp' } }],
        })
        expect(applyPromptPresetParams(preset, onChat, 'model')).toBe(preset)
    })

    test('identity when nothing in the schema matches', () => {
        const preset = presetWith({
            schema: [{ key: 'apiKey', mapsTo: { target: 'auth', path: 'apiKey' } }],
        })
        expect(applyPromptPresetParams(preset, onChat, 'model')).toBe(preset)
    })
})

describe('resolveRequestModelBindingTarget', () => {
    test('uses the chat associated with realChatId before the currently open chat', () => {
        const requestedChat = {
            id: 'requested-chat',
            useModelPreset: true,
            modelBinding: bindingWith('p-main'),
        }
        const openChat = { id: 'open-chat', useModelPreset: false }
        mockDb.characters = [{ chats: [openChat, requestedChat] }]

        expect(resolveRequestModelBindingTarget(
            undefined,
            'requested-chat',
            openChat,
        )).toBe(requestedChat)
    })

    test('keeps an explicit non-chat binding target authoritative', () => {
        const explicitTarget = {
            useModelPreset: true,
            modelBinding: bindingWith('p-main'),
        }
        mockDb.characters = [{ chats: [{ id: 'requested-chat' }] }]

        expect(resolveRequestModelBindingTarget(
            explicitTarget,
            'requested-chat',
            { useModelPreset: false },
        )).toBe(explicitTarget)
    })
})

describe('resolveChatModelBinding — explicit target', () => {
    test('uses the same main, sub, and separate memory bundle as chat', () => {
        const sub = { id: 'p-sub', name: 'Sub' } as any
        const memory = { id: 'p-memory', name: 'Memory' } as any
        mockDb.modelPresets = [PRESET, sub, memory]
        const target = {
            useModelPreset: true,
            modelBinding: {
                main: PRESET.id,
                sub: sub.id,
                separateAux: true,
                aux: { memory: memory.id, emotion: '', translate: '', otherAx: '' },
            },
            usePromptPresetParams: true,
        }

        expect(resolveChatModelBinding(target, 'model')).toEqual({ kind: 'modelPreset', preset: PRESET })
        expect(resolveChatModelBinding(target, 'submodel')).toEqual({ kind: 'modelPreset', preset: sub })
        expect(resolveChatModelBinding(target, 'memory')).toEqual({ kind: 'modelPreset', preset: memory })
    })
})

describe('applyPromptPresetValues — explicit prompt preset sampling source', () => {
    test('applies an explicit prompt preset without reading the chat-global db mirror', () => {
        mockDb.temperature = 10
        mockDb.top_p = 0.1
        const modelPreset = presetWith({
            schema: [
                { key: 'temperature', mapsTo: { target: 'body', path: 'temperature' } },
                { key: 'topP', mapsTo: { target: 'body', path: 'generationConfig.topP' } },
                { key: 'max_tokens', mapsTo: { target: 'body', path: 'max_tokens' } },
            ],
            userValues: { temperature: 0.2, max_tokens: 4096 },
        })
        const selectedPromptPreset = {
            temperature: 135,
            top_p: 0.82,
            maxResponse: 99999,
        } as any

        const result = applyPromptPresetValues(modelPreset, selectedPromptPreset)

        expect(result).not.toBe(modelPreset)
        expect(result.userValues).toEqual({
            temperature: 1.35,
            topP: 0.82,
            max_tokens: 4096,
        })
        expect(modelPreset.userValues).toEqual({ temperature: 0.2, max_tokens: 4096 })
    })

    test('ignores disabled and unsupported values', () => {
        const modelPreset = presetWith({
            schema: [
                { key: 'presence_penalty', mapsTo: { target: 'body', path: 'presence_penalty' } },
                { key: 'apiKey', mapsTo: { target: 'auth', path: 'apiKey' } },
            ],
        })

        expect(applyPromptPresetValues(modelPreset, {
            PresensePenalty: -1000,
            temperature: 150,
        } as any)).toBe(modelPreset)
    })
})


test('uses captured prompt sampling when another chat changes the visible preset', () => {
    const preset = {profileSnapshot:{schema:[{key:'temperature',mapsTo:{target:'body',path:'temperature'}}]},userValues:{}} as any
    const output = applyPromptPresetParams(preset,{usePromptPresetParams:true},'model',{temperature:23})
    expect(output.userValues.temperature).toBe(0.23)
})
