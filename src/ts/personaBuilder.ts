import type {
    Database,
    PersonaBuilderPromptPreset,
    character,
    loreBook,
} from './storage/database.svelte'
import type { RequestInjectionSource } from './status/requestStatus'

export type PersonaBuilderPromptKind = PersonaBuilderPromptPreset['kind']

export const DEFAULT_PERSONA_BUILDER_TASK_PROMPT = `이것은 롤플레잉이나 스토리 생성 요청이 아니라 페르소나 설정을 작성·수정하기 위한 out-of-character 작업이다. 절대로 롤플레잉, 장면, 대사 또는 서사를 이어 쓰지 마라. 사용자의 입력을 모두 OOC 편집 지시로 해석하고, 제공된 자료는 사실과 문체를 참고하기 위한 컨텍스트로만 사용하라. 사용자의 최신 지시를 최우선으로 따라 즉시 사용할 수 있는 페르소나 설명 본문만 출력하라. 설명, 서문, 후기, 코드 펜스는 출력하지 마라.`

const BASIC_STYLE_PROMPT_KO = `아래 프로필을 제시된 기준에 따라 수정해 주세요. 수정된 프로필은 한국어 버전으로 제공해 주세요. 생각의 사슬은 전달하지 마세요.

수정 기준

1. 강조를 위한 문장부호 사용 최소화
별표(*), 작은따옴표('), 큰따옴표(")가 순전히 장식적인 강조 목적으로 쓰인 경우, 사용을 줄인다.

2. 중복된 외모 묘사 제거
누적된 대화 기록으로 인해 동일한 신체 묘사가 반복적으로 등장하는 경우가 많다. 장황한 외모 묘사는 과감히 정리한다. 중요한 것은 비유가 아니라 명칭이다: "하얀 셔츠", "검은 코트", "빨간 넥타이"라고 쓰면 충분하며, "뙤약볕에 바싹 마른 듯한 새하얀 셔츠"나 "먹빛 그림자에 흠뻑 젖은 코트" 같은 표현은 쓰지 않는다. 머리카락도 마찬가지로 "긴 생머리", "짧은 곱슬머리"면 충분하다. 미용실에 가서 "가을빛 받은 단풍잎처럼 붉게 염색해 주세요"라고 말하는 사람은 없다.

3. 상품 라벨식 미사여구 금지
식품 성분표나 원재료 태그는 "열대의 태양 아래 정성껏 수확한"이라고 쓰지 않는다. 프로필도 마찬가지다. 사실을 담백하게 서술한다.

4. 다음 표현 사용 금지 (구조적으로 유사한 표현 포함)
- 극명한 대비 / 극적인 대비
- "그것은 결코 간단한 문제가 아니었다"
- 소용돌이치는 감정
- 마치 폭풍의 눈 속으로 들어선 듯한
- 사시나무 떨듯 떨리는
- 그는 생명을 구하는 신 같은 존재로 보인다
- "생명을 창조하는 것과 연쇄살인을 저지르는 것 사이의 모순이 그의 극단적인 이중성을 상징한다"

5. 담백하고 현실적인 묘사 유지
다음과 같이: "뒷골목의 유능한 해결사이자 생명을 살리는 자 — 그는 결과로 자신의 가치를 증명하며, 사람들은 구원을 바라며 그를 찾아온다."

6. 캐릭터를 기계화하지 않기
캐릭터에게서 인간성을 지워버리는 단어는 사용하지 않는다. 다음을 포함한다: 똑똑한, 무감정한, 분석적인, 인형 같은, 로봇 같은, 감정을 완전히 잃은, 논리, 데이터, 프로토콜, 기계, 제어, 변수, 알고리즘, 임상적인, 효율, 시스템, 프로그래밍, 각도, 조정(캘리브레이션), 표본. 이런 단어 대신 일상적인 언어나 자연스러운 대체 표현을 사용한다.

7. 캐릭터를 정의하는 세부사항은 절대 생략하지 않기
무언가를 삭제했을 때 캐릭터가 평범해지거나 모호해지거나 오해될 위험이 있다면 남겨둔다. 수정된 프로필은 독자가 원본을 참조할 필요 없이 그 자체로 완결되어야 한다.

8. 줄표(—)와 괄호 사용 최소화
가능한 한 둘 다 피한다. 줄표와 괄호를 반복적으로 함께 사용하면 결과물이 지저분해진다.

9. 생체역학적/반사작용 기반의 신체 묘사 금지
"흉골이 조여든다", "근육이 저절로 반응한다" 같은 표현이나, 해부학적 구조·반사 기제를 직접 언급하는 표현을 피한다. 대신 감각이나 감정에 기반한 언어로 대체한다.

10. 부정문을 긍정문으로 전환
"그는 성실하지 않았다"가 아니라 "그는 게을렀다" 또는 "그는 태만했다"라고 쓴다.

11. "A가 아니라 B이다" 구문에서 A가 의미 있는 맥락을 더하지 않는다면 A를 제거
같은 내용을 조금씩 다른 표현으로 반복하는 문장들은 하나의 명확한 문장으로 통합한다.

12. 감정을 명확히 명명하기
"무언가", "어떤 느낌", "일종의 감정" 같은 표현을 쓰지 않는다. 맥락이 암시하는 실제 감정을 구체적으로 지목한다. 이 부분이 모호하게 처리되면 이후 LLM이 "그의 안에서 무언가가 꿈틀거렸다" 같은 식으로 감정을 명명하지 않고 얼버무리게 된다.

13. 각 항목의 내부 모순과 중복 점검
서로 모순되거나 여러 섹션에서 같은 내용을 반복하는 항목은 병합, 삭제, 혹은 재작성한다.

14. 특정 단어나 표현의 반복 사용 지양
"사람을 꿰뚫어 본다", "정확한" 같은 특정 표현을 반복해서 사용하지 않는다. 가능하면 다른 표현으로 대체한다.`

const BASIC_STYLE_PROMPT_EN = `Please provide a revised version of the profile below according to the criteria listed. Please provide the revised profile in English. Do not provide chain of thought.

Revision Criteria

1. Minimize punctuation used for emphasis. Reduce the use of asterisks (*), single quotes ('), and double quotes (") when their purpose is purely decorative emphasis.

2. Cut redundant appearance descriptions. Accumulated conversation history causes repeated physical descriptions to surface often. Trim verbose appearance descriptions aggressively. What matters is the label, not the metaphor: write "white shirt," "black coat," "red tie," not "a shirt sun-dried to crisp whiteness" or "a coat soaked in ink-black shadow." The same applies to hair: "long straight hair," "short curly hair" is sufficient. No one walks into a salon and says "dye it like a red maple leaf catching autumn light."

3. No product-label poetry. Ingredient lists and material tags don't say "lovingly harvested under tropical sun." Neither should a profile. State facts plainly.

4. Ban the following expressions (and anything structurally similar):
- stark contrast / dramatic contrast
- "it was no simple matter"
- swirling emotions
- like stepping into the eye of a storm
- trembling like an aspen
- he appears as a god-like being who saves lives
- "the contradiction between creating life and committing serial murder symbolizes his extreme duality"

5. Keep descriptions grounded, like this: "A capable backstreet fixer and a giver of life, he proves his worth through results, and people come to him seeking salvation."

6. Avoid mechanizing the character. Do not use words that strip the character of humanity, including: smart, emotionless, analytical, doll-like, robotic, lost all emotion, logic, data, protocol, machine, control, variable, algorithm, clinical, efficiency, system, programming, angle, calibration, specimen. Replace with everyday language or naturally equivalent alternatives.

7. Never omit details that define the character. If cutting something risks making the character feel generic, ambiguous, or misread, keep it. The revised profile must stand on its own without the reader needing the original for reference.

8. Minimize em dashes (—) and parentheses. Avoid both wherever possible. Repeated use of em/en dashes alongside parentheses clutters the output.

9. No biomechanical or reflex-based physical descriptions. Avoid expressions like "sternum tightens," "muscle memory," or direct references to anatomical structures or reflexive mechanisms. Replace with sensation- or emotion-based language.

10. Convert negatives to positives. Not "he was not diligent," write "he was lazy" or "he was negligent."

11. Remove the A in "not A, but B" constructions when A adds no meaningful context. Consolidate sentences that repeat the same idea in slightly different words into one clear sentence.

12. Name emotions explicitly. Do not write "something," "a certain feeling," or "some kind of emotion." Identify the actual emotion the context implies. Vague phrasing here causes the LLM to later write "something stirred within him" instead of naming what it is.

13. Check each section for internal contradictions and redundancy. Merge, delete, or rewrite any items that contradict each other or repeat the same point across different sections.

14. Do not repeatedly use specific words or expressions such as "read people" or "precise." Replace them with alternative expressions where possible.`

export const PERSONA_BUILDER_BUILTIN_PRESETS: readonly PersonaBuilderPromptPreset[] = [
    {
        id: 'builtin:task-default',
        kind: 'task',
        name: '기본 작업 프리셋',
        content: DEFAULT_PERSONA_BUILDER_TASK_PROMPT,
    },
    {
        id: 'builtin:style-ko',
        kind: 'style',
        name: '기본 프리셋 (한국어)',
        content: BASIC_STYLE_PROMPT_KO,
    },
    {
        id: 'builtin:style-en',
        kind: 'style',
        name: 'Basic Preset (Eng)',
        content: BASIC_STYLE_PROMPT_EN,
    },
]

export function resolvePersonaBuilderPromptPreset(
    presets: PersonaBuilderPromptPreset[],
    kind: PersonaBuilderPromptKind,
    id: string | undefined,
): PersonaBuilderPromptPreset | undefined {
    if (!id) return undefined
    return [...PERSONA_BUILDER_BUILTIN_PRESETS, ...presets]
        .find((preset) => preset.kind === kind && preset.id === id)
}

export interface PersonaBuilderSelections {
    systemPrompt: boolean
    characterDescription: boolean
    characterLorebook: boolean
    moduleLorebook: boolean
}

export interface PersonaBuilderSourceSnapshot {
    systemPrompt: string
    characterDescription: string
    characterLorebook: string
    moduleLorebook: string
    characterLorebookSources?: RequestInjectionSource[]
    moduleLorebookSources?: RequestInjectionSource[]
}

interface PersonaBuilderLorebookSnapshot {
    content: string
    sources: RequestInjectionSource[]
}

function formatLorebooks(entries: Array<{ scopeId?: string; entry: loreBook }>): PersonaBuilderLorebookSnapshot {
    const sources: RequestInjectionSource[] = entries
        .filter(({ entry }) => entry.enabled !== false
            && entry.mode !== 'folder'
            && entry.content.trim().length > 0)
        .map(({ scopeId, entry }) => {
            const title = entry.comment.trim() || entry.key.trim() || 'Untitled'
            const keys = [entry.key, entry.secondkey].filter((value) => value?.trim()).join(', ')
            const content = [
                `## ${title}${scopeId ? ` [${scopeId}]` : ''}`,
                keys ? `Keys: ${keys}` : '',
                entry.content.trim(),
            ].filter(Boolean).join('\n')
            return { kind: 'lorebook', name: title, role: 'user', content }
        })
    return { content: sources.map((source) => source.content).join('\n\n'), sources }
}

function resolveSystemPrompt(
    database: Database,
    currentCharacter?: character | null,
    parsePrompt?: (text: string, role?: string) => string,
): string {
    if (!currentCharacter) return ''
    const parse = (text: string, role?: string) => (parsePrompt ? parsePrompt(text, role) : text).trim()
    if (Array.isArray(database.promptTemplate)) {
        const mainBlocks: string[] = []
        let hasMainBlock = false
        for (const item of database.promptTemplate) {
            if (item.type === 'plain' && item.type2 === 'main' && item.text.trim()) {
                hasMainBlock = true
                const content = parse(item.text, item.role)
                if (content) mainBlocks.push(content)
            }
        }
        if (hasMainBlock) return mainBlocks.join('\n\n')
    }
    const main = database.mainPrompt?.trim() ?? ''
    return parse(currentCharacter.systemPrompt?.trim()
        ? currentCharacter.systemPrompt.replaceAll('{{original}}', main).trim()
        : main)
}

function resolveCharacterDescription(currentCharacter?: character | null): string {
    if (!currentCharacter) return ''
    return [
        currentCharacter.name?.trim() ? `# ${currentCharacter.name.trim()}` : '',
        currentCharacter.desc?.trim() ? `## Description\n${currentCharacter.desc.trim()}` : '',
        currentCharacter.personality?.trim() ? `## Personality\n${currentCharacter.personality.trim()}` : '',
        currentCharacter.scenario?.trim() ? `## Scenario\n${currentCharacter.scenario.trim()}` : '',
    ].filter(Boolean).join('\n\n')
}

export function collectPersonaBuilderSources(input: {
    database: Database
    character?: character | null
    moduleLorebooks: Array<{ scopeId: string; entry: loreBook }>
    parsePrompt?: (text: string, role?: string) => string
}): PersonaBuilderSourceSnapshot {
    const characterLorebook = formatLorebooks((input.character?.globalLore ?? []).map((entry) => ({ entry })))
    const moduleLorebook = formatLorebooks(input.moduleLorebooks)
    return {
        systemPrompt: resolveSystemPrompt(input.database, input.character, input.parsePrompt),
        characterDescription: resolveCharacterDescription(input.character),
        characterLorebook: characterLorebook.content,
        moduleLorebook: moduleLorebook.content,
        characterLorebookSources: characterLorebook.sources,
        moduleLorebookSources: moduleLorebook.sources,
    }
}

function escapeBlockClosers(value: string): string {
    return value.replace(/<\/(instruction|context|draft)>/gi, '<\\/$1>')
}

export async function matchPersonaBuilderCharacterLorebook(input: {
    character?: character | null
    userInstruction: string
    draft: string
}): Promise<PersonaBuilderLorebookSnapshot> {
    if (!input.character) return { content: '', sources: [] }
    const { loadLoreBookV3Prompt } = await import('./process/lorebook.svelte')
    const result = await loadLoreBookV3Prompt({
        character: input.character,
        text: [input.userInstruction, input.draft].join('\n\n'),
    })
    return formatLorebooks(result.actives.map((active) => ({
        entry: { ...active.sourceIdentity.entry, content: active.prompt },
    })))
}

function block(tag: 'instruction' | 'context' | 'draft', name: string, title: string, content: string): string {
    return `<${tag} name="${name}" title="${title}">\n${escapeBlockClosers(content.trim())}\n</${tag}>`
}

export function buildPersonaBuilderMessages(input: {
    taskInstruction: string
    styleInstruction: string
    userInstruction: string
    draft: string
    selections: PersonaBuilderSelections
    sources: PersonaBuilderSourceSnapshot
}): Array<{ role: 'system' | 'user'; content: string; requestStatusSources: RequestInjectionSource[] }> {
    if (!input.taskInstruction.trim()) throw new Error('persona-builder-task-required')
    if (!input.userInstruction.trim()) throw new Error('persona-builder-user-required')

    const systemSources: RequestInjectionSource[] = [{
        kind: 'instruction', name: '작업 지시 프롬프트', role: 'system',
        content: block('instruction', 'task_instruction', '작업 지시 프롬프트', input.taskInstruction),
    }]
    if (input.styleInstruction.trim()) systemSources.push({
        kind: 'instruction', name: '스타일 지시 프롬프트', role: 'system',
        content: block('instruction', 'style_instruction', '스타일 지시 프롬프트', input.styleInstruction),
    })
    const system = systemSources.map((source) => source.content).join('\n\n')

    const contextSpecs = [
        ['systemPrompt', 'system_prompt', '시스템 프롬프트', 'systemPrompt'],
        ['characterDescription', 'character_description', '캐릭터 설명', 'character'],
        ['characterLorebook', 'character_lorebook', '캐릭터 로어북', 'lorebook'],
        ['moduleLorebook', 'module_lorebook', '모듈 로어북', 'lorebook'],
    ] as const
    const userSources: RequestInjectionSource[] = []
    const contexts = contextSpecs
        .filter(([key]) => input.selections[key] && input.sources[key].trim())
        .map(([key, name, title, kind]) => {
            const content = block('context', name, title, input.sources[key])
            const loreSources = key === 'characterLorebook' ? input.sources.characterLorebookSources
                : key === 'moduleLorebook' ? input.sources.moduleLorebookSources : undefined
            userSources.push(...(loreSources?.length
                ? loreSources.map((source) => ({ ...source, content: escapeBlockClosers(source.content) }))
                : [{ kind, name: title, role: 'user' as const, content }]))
            return content
        })

    const draft = input.draft.trim() ? block('draft', 'draft', '초안', input.draft) : ''
    if (draft) userSources.push({ kind: 'persona', name: '초안', role: 'user', content: draft })
    const instruction = `# 사용자 OOC 지시\n${escapeBlockClosers(input.userInstruction.trim())}`
    userSources.push({ kind: 'instruction', name: '사용자 OOC 지시', role: 'user', content: instruction })

    const user = [
        contexts.length ? `# 참고 컨텍스트\n${contexts.join('\n\n')}` : '',
        draft,
        instruction,
    ].filter(Boolean).join('\n\n')

    return [
        { role: 'system', content: system, requestStatusSources: systemSources },
        { role: 'user', content: user, requestStatusSources: userSources },
    ]
}

function normalizedName(value: string): string {
    return value.trim().toLocaleLowerCase()
}

export function createPersonaBuilderUserPreset(input: {
    presets: PersonaBuilderPromptPreset[]
    kind: PersonaBuilderPromptKind
    name: string
    content: string
    createId: () => string
}): PersonaBuilderPromptPreset[] {
    const name = input.name.trim()
    if (!name || !input.content.trim()) throw new Error('persona-builder-preset-invalid')
    const allNames = [
        ...PERSONA_BUILDER_BUILTIN_PRESETS.filter((preset) => preset.kind === input.kind),
        ...input.presets.filter((preset) => preset.kind === input.kind),
    ]
    if (allNames.some((preset) => normalizedName(preset.name) === normalizedName(name))) {
        throw new Error('persona-builder-preset-name-exists')
    }
    return [...input.presets, {
        id: input.createId(),
        kind: input.kind,
        name,
        content: input.content,
    }]
}

export function overwritePersonaBuilderUserPreset(
    presets: PersonaBuilderPromptPreset[],
    id: string,
    content: string,
): PersonaBuilderPromptPreset[] {
    if (id.startsWith('builtin:')) throw new Error('persona-builder-preset-readonly')
    const index = presets.findIndex((preset) => preset.id === id)
    if (index < 0) throw new Error('persona-builder-preset-not-found')
    if (!content.trim()) throw new Error('persona-builder-preset-invalid')
    return presets.map((preset, presetIndex) => presetIndex === index ? { ...preset, content } : preset)
}

export function deletePersonaBuilderUserPreset(
    presets: PersonaBuilderPromptPreset[],
    id: string,
): PersonaBuilderPromptPreset[] {
    if (id.startsWith('builtin:')) throw new Error('persona-builder-preset-readonly')
    if (!presets.some((preset) => preset.id === id)) throw new Error('persona-builder-preset-not-found')
    return presets.filter((preset) => preset.id !== id)
}
