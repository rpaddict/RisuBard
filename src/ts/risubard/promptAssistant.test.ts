import { describe, expect, it, vi } from 'vitest'

vi.mock('../parser/parser.svelte', () => ({ risuChatParser: (text: string) => text }))
vi.mock('../util', () => ({ parseToggleSyntax: () => [] }))

import {
    buildPromptAssistantMessages,
    clampChatMessageCount,
    compactRequestBody,
    formatChatLogForAssistant,
    markStrongForCjk,
    normalizePromptAssistantProject,
    serializePresetForAssistant,
    PROMPT_ASSISTANT_SYSTEM_PROMPT,
    STRONG_CLOSE_MARK,
    STRONG_OPEN_MARK,
    stripBlockWrapper,
    collectBlockNames,
    findBlockReferences,
    resolveBlockIndex,
} from './promptAssistant'

describe('serializePresetForAssistant', () => {
    it('numbers blocks in editor order and decodes V2 activation', () => {
        const text = serializePresetForAssistant({
            name: 'Main "RP"',
            promptTemplate: [
                { type: 'plain', type2: 'main', role: 'system', name: '규칙', text: '{{#when::keep::{{equal::{{getglobalvar::toggle_short}}::1}}}}\n짧게 써라.\n{{/when}}' },
                { type: 'chat', rangeStart: 0, rangeEnd: 'end' },
                { type: 'description', innerFormat: '<desc>{{slot}}</desc>' },
            ],
            customPromptTemplateToggle: 'short=짧은 응답',
        })
        expect(text).toContain('<preset name="Main &quot;RP&quot;">')
        expect(text).toContain('<block no="1" type="plain" name="규칙" role="system" slot="main" active_when="toggle_short == 1">\n짧게 써라.\n</block>')
        expect(text).toContain('<block no="2" type="chat" range_start="0" range_end="end" />')
        expect(text).toContain('<block no="3" type="description">\n<desc>{{slot}}</desc>\n</block>')
        expect(text).toContain('<toggles>\nshort=짧은 응답\n</toggles>')
    })

    it('falls back to legacy prompt fields without a template', () => {
        const text = serializePresetForAssistant({ promptTemplate: null, mainPrompt: 'main', jailbreak: 'jb', globalNote: 'note' })
        expect(text).toContain('<legacy_main_prompt>\nmain\n</legacy_main_prompt>')
        expect(text).toContain('<toggles />')
    })
})

describe('compactRequestBody', () => {
    it('keeps only role-tagged text from OpenAI-style bodies', () => {
        const body = JSON.stringify({
            model: 'x', temperature: 1,
            messages: [
                { role: 'system', content: 'sys' },
                { role: 'user', content: [{ type: 'text', text: 'hi' }, { type: 'image_url', image_url: { url: 'data:...' } }] },
            ],
        })
        expect(compactRequestBody(body)).toBe('<turn role="system">\nsys\n</turn>\n<turn role="user">\nhi\n[image_url]\n</turn>')
    })

    it('reads Anthropic system and Gemini contents', () => {
        expect(compactRequestBody(JSON.stringify({ system: [{ type: 'text', text: 'S' }], messages: [{ role: 'user', content: 'U' }] })))
            .toBe('<turn role="system">\nS\n</turn>\n<turn role="user">\nU\n</turn>')
        expect(compactRequestBody(JSON.stringify({ systemInstruction: { parts: [{ text: 'S' }] }, contents: [{ role: 'model', parts: [{ text: 'M' }] }] })))
            .toBe('<turn role="system">\nS\n</turn>\n<turn role="model">\nM\n</turn>')
    })

    it('returns unknown shapes unchanged', () => {
        expect(compactRequestBody('not json')).toBe('not json')
        expect(compactRequestBody('{"prompt":"p"}')).toBe('{"prompt":"p"}')
    })
})

describe('buildPromptAssistantMessages', () => {
    it('puts materials in the system message and skips failed turns', () => {
        const messages = buildPromptAssistantMessages({
            preset: '<preset />',
            chatLog: formatChatLogForAssistant([{ role: 'char', name: 'Alice', text: 'hello' }]),
            sentRequest: 'REQ',
            history: [
                { id: '1', role: 'user', text: 'q1', createdAt: 0 },
                { id: '2', role: 'assistant', text: 'error', createdAt: 0, failed: true },
            ],
            userText: 'q2',
        })
        expect(messages[0].role).toBe('system')
        expect(messages[0].content.startsWith(PROMPT_ASSISTANT_SYSTEM_PROMPT)).toBe(true)
        expect(messages[0].content).toContain('<message role="assistant" name="Alice">\nhello\n</message>')
        expect(messages[0].content).toContain('<sent_request>\nREQ\n</sent_request>')
        expect(messages.slice(1)).toEqual([
            { role: 'user', content: 'q1' },
            { role: 'user', content: 'q2' },
        ])
    })

    it('omits empty materials', () => {
        const [system] = buildPromptAssistantMessages({ preset: '<preset />', chatLog: '', history: [], userText: 'q' })
        expect(system.content).toBe(`${PROMPT_ASSISTANT_SYSTEM_PROMPT}

<preset />`)
    })
})

describe('markStrongForCjk', () => {
    const open = STRONG_OPEN_MARK
    const close = STRONG_CLOSE_MARK
    it('marks bold followed by Korean particles, including code inside', () => {
        expect(markStrongForCjk('**3번 블록 `서술 규칙`**이 원인'))
            .toBe(`${open}3번 블록 \`서술 규칙\`${close}이 원인`)
    })

    it('leaves code, spaced delimiters and unclosed pairs alone', () => {
        expect(markStrongForCjk('`**a**` ```\n**b**\n``` ** c ** **d'))
            .toBe('`**a**` ```\n**b**\n``` ** c ** **d')
    })
})

describe('stripBlockWrapper', () => {
    it('removes the material-only block tags around a suggestion', () => {
        expect(stripBlockWrapper('<block no="114" type="plain" name="대화문 — 켜짐" role="user">\n{{#if_pure 1}}\n본문\n{{/if}}\n</block>\n'))
            .toBe('{{#if_pure 1}}\n본문\n{{/if}}')
    })

    it('keeps text without a wrapper unchanged', () => {
        expect(stripBlockWrapper('본문\n<block>는 본문 속 단어')).toBe('본문\n<block>는 본문 속 단어')
    })
})

describe('block references', () => {
    it('finds numbers in prose and in block tags', () => {
        expect(findBlockReferences('114번 블록 `대화`와 블록 7번, 블록 #3, 그리고 <block no="20" type="plain">'))
            .toEqual([3, 7, 20, 114])
        expect(findBlockReferences('1140개의 블록이 아님, 2024년')).toEqual([])
    })

    it('records names for mentioned blocks only', () => {
        const preset = { promptTemplate: [
            { type: 'plain', type2: 'normal', role: 'system', text: '', name: 'A' },
            { type: 'plain', type2: 'normal', role: 'system', text: '' },
        ] } as Parameters<typeof collectBlockNames>[0]
        expect(collectBlockNames(preset, '2번 블록과 1번 블록, 9번 블록')).toEqual({ 1: 'A', 2: '' })
        expect(collectBlockNames(preset, '블록 언급 없음')).toBeUndefined()
    })

    it('follows a renamed number back to the named block', () => {
        const items = [{ name: 'X' }, { name: 'B' }, { name: 'A' }, { name: 'B' }]
        expect(resolveBlockIndex(items, 3, 'A')).toBe(2)
        expect(resolveBlockIndex(items, 1, 'A')).toBe(2)
        expect(resolveBlockIndex(items, 3, 'B')).toBe(1)
        expect(resolveBlockIndex(items, 2, 'gone')).toBe(-1)
        expect(resolveBlockIndex(items, 4)).toBe(3)
        expect(resolveBlockIndex(items, 9)).toBe(-1)
    })
})

describe('project normalization', () => {
    it('clamps chat counts and repairs stored projects', () => {
        expect(clampChatMessageCount(-3)).toBe(0)
        expect(clampChatMessageCount('7.9')).toBe(7)
        expect(clampChatMessageCount(10_000)).toBe(200)
        const project = normalizePromptAssistantProject({ id: 'p', name: ' ', model: 'weird', chatMessages: 'x', messages: [{ id: 'm', role: 'system', text: 'x' }] })
        expect(project).toMatchObject({ name: '새 프로젝트', model: 'otherAx', chatMessages: 0, messages: [] })
        expect(normalizePromptAssistantProject({ name: 'no id' })).toBeNull()
    })
})
