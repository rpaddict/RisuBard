import { describe, expect, it, vi } from 'vitest'

vi.mock('../parser/parser.svelte', () => ({ risuChatParser: (text: string) => text }))
vi.mock('../util', () => ({ parseToggleSyntax: () => [] }))

import {
    addPins,
    buildAssistantScopes,
    buildCharacterAssistantMessages,
    CHARACTER_ASSISTANT_MAX_PINS,
    CHARACTER_ASSISTANT_SYSTEM_PROMPT,
    collectMentionNames,
    findSection,
    findSectionMentions,
    formatMaterial,
    formatScopeIndex,
    normalizeCharacterAssistantProject,
    parseAssistantLookups,
    resolveSectionRef,
    searchSections,
    stripAssistantLookups,
    type AssistantCharacterSource,
} from './characterAssistant'

const bot: AssistantCharacterSource = {
    name: '하루',
    desc: '하루는 {{user}}의 소꿉친구다.',
    firstMessage: '안녕!',
    alternateGreetings: ['비 오는 날의 인사', ''],
    globalLore: [
        { mode: 'folder', key: 'f1', comment: '장소' },
        { comment: '학교', key: '학교, 교실', content: '하루가 다니는 학교. 호감도 변수는 affection이다.', folder: 'f1', alwaysActive: false, insertorder: 100 },
        { comment: '규칙', key: '', content: '항상 존댓말을 쓴다.', alwaysActive: true },
    ],
    customscript: [{ comment: '상태창', type: 'editdisplay', in: '<status>(.*?)</status>', out: '<div>$1</div>' }],
    triggerscript: [{ comment: '', type: 'start', conditions: [], effect: [{ type: 'triggerlua', code: Array.from({ length: 400 }, (_, i) => `-- line ${i + 1}`).join('\n') } as { type: string }] }],
}

describe('character scopes', () => {
    it('lists fields, greetings, lore, regex and the Lua body without content in the index', () => {
        const [scope] = buildAssistantScopes({ bot })
        const index = formatScopeIndex(scope)
        expect(index).toContain('<index scope="bot" title="봇 \'하루\'">'.replaceAll("'", "'"))
        expect(index).toContain('- bot:field:desc `설명` 필드')
        expect(index).toContain('- bot:field:lua `Lua 트리거` 필드 | ')
        expect(index).toContain('- bot:greeting:1 추가 인사말 1번')
        expect(index).toContain('- bot:lore:1 로어북 1번 `장소` | [폴더]')
        expect(index).toContain('- bot:lore:2 로어북 2번 `학교` | 키: 학교, 교실 | 폴더: 장소')
        expect(index).toContain('- bot:lore:3 로어북 3번 `규칙` | 상시')
        expect(index).toContain('- bot:regex:1 정규식 1번 `상태창` | editdisplay (디스플레이 수정)')
        expect(index).toContain('트리거 방식: Lua')
        expect(index).not.toContain('항상 존댓말을 쓴다')
    })

    it('adds reference, module and preset scopes with their own prefixes', () => {
        const scopes = buildAssistantScopes({
            bot,
            reference: { name: '참고', globalLore: [{ comment: '세계관', key: 'a', content: 'x' }] },
            modules: [{ name: '모듈', regex: [{ comment: 'r', type: 'editoutput', in: 'a', out: 'b' }] }],
            preset: {
                name: 'P',
                promptTemplate: [{ type: 'plain', type2: 'main', role: 'system', name: '규칙', text: '짧게' }],
                customPromptTemplateToggle: 'short=짧게',
                toggleValues: { toggle_short: '1' },
            },
        })
        expect(findSection(scopes, 'ref:lore:1')?.label).toBe('참고 봇 로어북 1번 `세계관`')
        expect(findSection(scopes, 'mod1:regex:1')?.label).toBe('모듈 1 정규식 1번 `r`')
        expect(findSection(scopes, 'preset:block:1')?.text).toContain('<block no="1" type="plain" name="규칙"')
        expect(formatScopeIndex(scopes[3])).toContain('현재 토글 값: toggle_short=1')
    })
})

describe('materials and search', () => {
    it('numbers long sections and pages them', () => {
        const scopes = buildAssistantScopes({ bot })
        const lua = findSection(scopes, 'bot:field:lua')!
        const first = formatMaterial(lua)
        expect(first).toContain('lines="1-300" total_lines="400"')
        expect(first).toContain('1| -- line 1')
        expect(first).toContain('<read ref="bot:field:lua" lines="301-400" />')
        const tail = formatMaterial(lua, [390, 999])
        expect(tail).toContain('lines="390-400"')
        expect(tail).not.toContain('남음')
    })

    it('keeps short sections unnumbered', () => {
        const scopes = buildAssistantScopes({ bot })
        expect(formatMaterial(findSection(scopes, 'bot:lore:3')!)).toBe('<material ref="bot:lore:3" label="로어북 3번 `규칙`">\n이름: 규칙\n활성: 상시 활성\n키: \n삽입 순서: 100\n본문:\n항상 존댓말을 쓴다.\n</material>')
    })

    it('finds text across sections with line numbers', () => {
        const hits = searchSections(buildAssistantScopes({ bot }), 'AFFECTION')
        expect(hits).toHaveLength(1)
        expect(hits[0]).toMatchObject({ ref: 'bot:lore:2', line: 7 })
        expect(hits[0].snippet).toContain('affection')
    })
})

describe('lookups', () => {
    it('parses read and search tags and strips them', () => {
        const text = '자료가 필요하다.\n<read ref="bot:lore:2" />\n<read ref="bot:field:lua" lines="301-400"/>\n<search query="호감도" />'
        expect(parseAssistantLookups(text)).toEqual({
            reads: [{ ref: 'bot:lore:2' }, { ref: 'bot:field:lua', lines: [301, 400] }],
            searches: ['호감도'],
        })
        expect(stripAssistantLookups(text)).toBe('자료가 필요하다.')
    })

    it('replaces pins of the same ref and keeps the newest within the cap', () => {
        const pins = addPins([{ ref: 'a' }, { ref: 'b' }], [{ ref: 'a', lines: [1, 2] }])
        expect(pins).toEqual([{ ref: 'b' }, { ref: 'a', lines: [1, 2] }])
        const many = addPins([], Array.from({ length: CHARACTER_ASSISTANT_MAX_PINS + 5 }, (_, i) => ({ ref: `r${i}` })))
        expect(many).toHaveLength(CHARACTER_ASSISTANT_MAX_PINS)
        expect(many[0].ref).toBe('r5')
    })
})

describe('mentions', () => {
    it('finds scoped item mentions and preset blocks', () => {
        const text = '로어북 2번과 참고 봇 로어북 1번, 모듈 1 정규식 1번, 추가 인사말 1번, 114번 블록을 보자.'
        expect(findSectionMentions(text, true).map((mention) => mention.ref)).toEqual([
            'bot:lore:2', 'ref:lore:1', 'mod1:regex:1', 'bot:greeting:1', 'preset:block:114',
        ])
        expect(findSectionMentions(text, false).map((mention) => mention.ref)).not.toContain('preset:block:114')
    })

    it('records names and re-finds a moved item by name', () => {
        const scopes = buildAssistantScopes({ bot })
        const names = collectMentionNames(scopes, '로어북 2번 `학교`를 고치자.', false)
        expect(names).toEqual({ 'bot:lore:2': '학교' })
        const moved = buildAssistantScopes({ bot: { ...bot, globalLore: [bot.globalLore![2], bot.globalLore![1]] } })
        expect(resolveSectionRef(moved, 'bot:lore:2', '학교')?.ref).toBe('bot:lore:2')
        expect(resolveSectionRef(moved, 'bot:lore:1', '학교')?.ref).toBe('bot:lore:2')
        expect(resolveSectionRef(moved, 'bot:lore:1', '없는 이름')).toBeUndefined()
    })
})

describe('request', () => {
    it('puts indexes and materials in the system turn and keeps history', () => {
        const messages = buildCharacterAssistantMessages({
            indexes: ['<index scope="bot" />'],
            materials: [],
            lookups: ['<search_result query="x">\n찾지 못함\n</search_result>'],
            history: [
                { id: '1', role: 'user', text: '질문', createdAt: 0 },
                { id: '2', role: 'assistant', text: '실패', createdAt: 0, failed: true },
            ],
            userText: '다음 질문',
        })
        expect(messages[0].role).toBe('system')
        expect(messages[0].content.startsWith(CHARACTER_ASSISTANT_SYSTEM_PROMPT)).toBe(true)
        expect(messages[0].content).toContain('아직 읽은 본문이 없다.')
        expect(messages[0].content).toContain('<search_result query="x">')
        expect(messages.slice(1)).toEqual([
            { role: 'user', content: '질문' },
            { role: 'user', content: '다음 질문' },
        ])
    })
})

describe('project normalization', () => {
    it('fills defaults and drops broken pins and messages', () => {
        const project = normalizeCharacterAssistantProject({
            id: 'p', characterId: 'c', pins: [{ ref: 'bot:lore:1' }, { ref: '' }, { ref: 'bot:field:lua', lines: [1, 2] }, null],
            messages: [{ id: 'm', role: 'user', text: 'hi' }, { role: 'bad' }],
            chatMessages: 999,
        })
        expect(project).toMatchObject({
            name: '새 프로젝트', referenceId: '', includeModules: false, includePreset: false, model: 'otherAx', chatMessages: 200,
            pins: [{ ref: 'bot:lore:1' }, { ref: 'bot:field:lua', lines: [1, 2] }],
        })
        expect(project?.messages).toHaveLength(1)
        expect(normalizeCharacterAssistantProject({ name: 'x' })).toBeNull()
    })
})
