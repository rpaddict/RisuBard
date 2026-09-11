import type { Database, LoreBuilderPromptPreset, character, loreBook } from './storage/database.svelte'
import type { RequestInjectionSource } from './status/requestStatus'

export type LoreBuilderPromptKind = LoreBuilderPromptPreset['kind']

export const DEFAULT_LORE_BUILDER_TASK_PROMPT = `이것은 롤플레잉이나 스토리 생성 요청이 아니라 로어북 항목을 작성·수정하기 위한 out-of-character 편집 작업이다. 절대로 장면, 대사, 서사를 이어 쓰지 마라. 사용자의 최신 지시를 최우선으로 따르고, 선택된 컨텍스트는 사실과 용어를 확인하기 위한 참고 자료로만 사용하라. 현재 초안에 없는 사실을 임의로 확정하지 말고, 사용자가 창작이나 확장을 명시했을 때만 새 설정을 제안하라.

결과는 즉시 저장할 수 있는 구조화된 Markdown 로어북 본문이어야 한다. 제목과 의미 있는 절을 사용하고, 사실은 짧고 구체적인 문장이나 목록으로 정리하라. 공개 정보와 비공개 정보, 지식 경계, 복선 또는 공개 조건이 관련된 경우 서로 구분하라. 모델의 연기나 서술을 제한하는 규칙은 모호한 감상 대신 관찰 가능한 행동과 조건으로 작성하라. 설명, 서문, 후기, 코드 펜스 없이 완성된 로어북 본문만 출력하라.`

const LORE_STYLE_PROMPT_KO = `한국어 로어북 작성 규칙:
1. 첫 줄은 "# 항목명"으로 시작하고 필요한 내용만 "##" 절로 나눈다.
2. 사실, 관계, 역할, 장소, 규칙은 짧고 구체적인 목록으로 쓴다. 소설식 장면 묘사나 수사는 피한다.
3. 공개 정보와 [비공개] 정보를 분리한다. 비밀에는 누가 알고 있는지, 관찰 가능한 복선, 공개 또는 확정 조건을 함께 적는다.
4. AI의 서술·연기 지침이나 노출 제한은 인용문(>)으로 분리해 눈에 띄게 한다.
5. 고유명사와 정체성을 결정하는 세부사항은 보존한다. 같은 사실을 여러 절에서 반복하지 않는다.
6. 현재 항목만 읽어도 이해되게 작성하되, 다른 로어의 내용을 불필요하게 복제하지 않는다.
7. 사용자가 요구하지 않은 설정을 임의로 추가하거나 기존 사실을 바꾸지 않는다.`

const LORE_STYLE_PROMPT_EN = `English lorebook writing rules:
1. Start with "# Entry name" and divide only necessary material into "##" sections.
2. State facts, relationships, roles, places, and rules in short concrete prose or lists. Avoid scene-writing and decorative language.
3. Separate public and [Private] information. For secrets, record who knows, observable clues, and disclosure or confirmation conditions.
4. Put narration, acting, or disclosure constraints in blockquotes (>), so they remain visibly distinct.
5. Preserve proper nouns and identity-defining details. Do not repeat the same fact across sections.
6. Keep the entry self-contained without copying unrelated lore into it.
7. Do not invent or alter facts unless the user explicitly asks for creative expansion.`

export const LORE_BUILDER_BUILTIN_PRESETS: readonly LoreBuilderPromptPreset[] = [
    { id: 'builtin:lore-task-default', kind: 'task', name: '기본 로어북 작업', content: DEFAULT_LORE_BUILDER_TASK_PROMPT },
    { id: 'builtin:lore-style-ko', kind: 'style', name: '구조화 로어북 (한국어)', content: LORE_STYLE_PROMPT_KO },
    { id: 'builtin:lore-style-en', kind: 'style', name: 'Structured Lorebook (English)', content: LORE_STYLE_PROMPT_EN },
]

export function resolveLoreBuilderPromptPreset(
    presets: LoreBuilderPromptPreset[],
    kind: LoreBuilderPromptKind,
    id: string | undefined,
): LoreBuilderPromptPreset | undefined {
    if (!id) return undefined
    return [...LORE_BUILDER_BUILTIN_PRESETS, ...presets]
        .find((preset) => preset.kind === kind && preset.id === id)
}

export interface LoreBuilderSelections {
    systemPrompt: boolean
    characterDescription: boolean
    characterLorebook: boolean
    moduleLorebook: boolean
}

const LORE_BUILDER_SELECTIONS_STORAGE_KEY = 'risubard:lore-builder-selections:v1'

function defaultStorage(): Storage | null {
    try { return typeof localStorage === 'undefined' ? null : localStorage }
    catch { return null }
}

export function loadLoreBuilderSelections(storage = defaultStorage()): LoreBuilderSelections | null {
    if (!storage) return null
    try {
        const value = JSON.parse(storage.getItem(LORE_BUILDER_SELECTIONS_STORAGE_KEY) ?? 'null')
        if (!value || typeof value !== 'object') return null
        const keys = ['systemPrompt', 'characterDescription', 'characterLorebook', 'moduleLorebook'] as const
        return keys.every((key) => typeof value[key] === 'boolean')
            ? Object.fromEntries(keys.map((key) => [key, value[key]])) as unknown as LoreBuilderSelections
            : null
    }
    catch { return null }
}

export function saveLoreBuilderSelections(selections: LoreBuilderSelections, storage = defaultStorage()): void {
    if (!storage) return
    try { storage.setItem(LORE_BUILDER_SELECTIONS_STORAGE_KEY, JSON.stringify(selections)) }
    catch {}
}

export interface LoreBuilderSourceSnapshot {
    systemPrompt: string
    characterDescription: string
    characterLorebook: string
    moduleLorebook: string
    characterLorebookSources?: RequestInjectionSource[]
    moduleLorebookSources?: RequestInjectionSource[]
}

interface LorebookSnapshot {
    content: string
    sources: RequestInjectionSource[]
}

function formatLorebooks(entries: Array<{ scopeId?: string; entry: loreBook }>): LorebookSnapshot {
    const sources: RequestInjectionSource[] = entries
        .filter(({ entry }) => entry.enabled !== false && entry.mode !== 'folder'
            && entry.mode !== 'child' && entry.content.trim().length > 0)
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
    return parse(currentCharacter?.systemPrompt?.trim()
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

export function collectLoreBuilderSources(input: {
    database: Database
    character?: character | null
    moduleLorebooks: Array<{ scopeId: string; entry: loreBook }>
    targetEntryId: string
    parsePrompt?: (text: string, role?: string) => string
}): LoreBuilderSourceSnapshot {
    const characterLorebook = formatLorebooks((input.character?.globalLore ?? [])
        .filter((entry) => entry.id !== input.targetEntryId).map((entry) => ({ entry })))
    const moduleLorebook = formatLorebooks(input.moduleLorebooks
        .filter(({ entry }) => entry.id !== input.targetEntryId))
    return {
        systemPrompt: resolveSystemPrompt(input.database, input.character, input.parsePrompt),
        characterDescription: resolveCharacterDescription(input.character),
        characterLorebook: characterLorebook.content,
        moduleLorebook: moduleLorebook.content,
        characterLorebookSources: characterLorebook.sources,
        moduleLorebookSources: moduleLorebook.sources,
    }
}

export async function matchLoreBuilderCharacterLorebook(input: {
    character?: character | null
    targetEntryId: string
    userInstruction: string
    draft: string
}): Promise<LorebookSnapshot> {
    if (!input.character) return { content: '', sources: [] }
    const { loadLoreBookV3Prompt } = await import('./process/lorebook.svelte')
    const result = await loadLoreBookV3Prompt({
        character: input.character,
        text: [input.userInstruction, input.draft].join('\n\n'),
    })
    return formatLorebooks(result.actives
        .filter((active) => active.sourceIdentity.entry.id !== input.targetEntryId)
        .map((active) => ({ entry: { ...active.sourceIdentity.entry, content: active.prompt } })))
}

function escapeBlockClosers(value: string): string {
    return value.replace(/<\/(instruction|context|draft)>/gi, '<\\/$1>')
}

function block(tag: 'instruction' | 'context' | 'draft', name: string, title: string, content: string): string {
    return `<${tag} name="${name}" title="${title}">\n${escapeBlockClosers(content.trim())}\n</${tag}>`
}

export function buildLoreBuilderMessages(input: {
    taskInstruction: string
    styleInstruction: string
    userInstruction: string
    draft: string
    selections: LoreBuilderSelections
    sources: LoreBuilderSourceSnapshot
}): Array<{ role: 'system' | 'user'; content: string; requestStatusSources: RequestInjectionSource[] }> {
    if (!input.taskInstruction.trim()) throw new Error('lore-builder-task-required')
    if (!input.userInstruction.trim()) throw new Error('lore-builder-user-required')

    const systemSources: RequestInjectionSource[] = [{
        kind: 'instruction', name: '로어북 작업 지시', role: 'system',
        content: block('instruction', 'task_instruction', '로어북 작업 지시', input.taskInstruction),
    }]
    if (input.styleInstruction.trim()) systemSources.push({
        kind: 'instruction', name: '로어북 스타일 지시', role: 'system',
        content: block('instruction', 'style_instruction', '로어북 스타일 지시', input.styleInstruction),
    })

    const contextSpecs = [
        ['systemPrompt', 'system_prompt', '시스템 프롬프트', 'systemPrompt'],
        ['characterDescription', 'character_description', '캐릭터 설명', 'character'],
        ['characterLorebook', 'related_character_lore', '관련 캐릭터 로어', 'lorebook'],
        ['moduleLorebook', 'module_lorebook', '모듈 로어북', 'lorebook'],
    ] as const
    const userSources: RequestInjectionSource[] = []
    const contexts = contextSpecs.filter(([key]) => input.selections[key] && input.sources[key].trim())
        .map(([key, name, title, kind]) => {
            const content = block('context', name, title, input.sources[key])
            const loreSources = key === 'characterLorebook' ? input.sources.characterLorebookSources
                : key === 'moduleLorebook' ? input.sources.moduleLorebookSources : undefined
            userSources.push(...(loreSources?.length
                ? loreSources.map((source) => ({ ...source, content: escapeBlockClosers(source.content) }))
                : [{ kind, name: title, role: 'user' as const, content }]))
            return content
        })
    const draft = input.draft.trim() ? block('draft', 'current_lore', '현재 로어 본문', input.draft) : ''
    if (draft) userSources.push({ kind: 'lorebook', name: '현재 로어 본문', role: 'user', content: draft })
    const instruction = `# 사용자 OOC 지시\n${escapeBlockClosers(input.userInstruction.trim())}`
    userSources.push({ kind: 'instruction', name: '사용자 OOC 지시', role: 'user', content: instruction })

    return [
        { role: 'system', content: systemSources.map((source) => source.content).join('\n\n'), requestStatusSources: systemSources },
        {
            role: 'user',
            content: [contexts.length ? `# 선택한 참고 컨텍스트\n${contexts.join('\n\n')}` : '', draft, instruction]
                .filter(Boolean).join('\n\n'),
            requestStatusSources: userSources,
        },
    ]
}

function normalizedName(value: string): string {
    return value.trim().toLocaleLowerCase()
}

export function createLoreBuilderUserPreset(input: {
    presets: LoreBuilderPromptPreset[]
    kind: LoreBuilderPromptKind
    name: string
    content: string
    createId: () => string
}): LoreBuilderPromptPreset[] {
    const name = input.name.trim()
    if (!name || !input.content.trim()) throw new Error('lore-builder-preset-invalid')
    const allNames = [...LORE_BUILDER_BUILTIN_PRESETS.filter((preset) => preset.kind === input.kind),
        ...input.presets.filter((preset) => preset.kind === input.kind)]
    if (allNames.some((preset) => normalizedName(preset.name) === normalizedName(name))) {
        throw new Error('lore-builder-preset-name-exists')
    }
    return [...input.presets, { id: input.createId(), kind: input.kind, name, content: input.content }]
}

export function overwriteLoreBuilderUserPreset(presets: LoreBuilderPromptPreset[], id: string, content: string): LoreBuilderPromptPreset[] {
    if (id.startsWith('builtin:')) throw new Error('lore-builder-preset-readonly')
    const index = presets.findIndex((preset) => preset.id === id)
    if (index < 0) throw new Error('lore-builder-preset-not-found')
    if (!content.trim()) throw new Error('lore-builder-preset-invalid')
    return presets.map((preset, presetIndex) => presetIndex === index ? { ...preset, content } : preset)
}

export function deleteLoreBuilderUserPreset(presets: LoreBuilderPromptPreset[], id: string): LoreBuilderPromptPreset[] {
    if (id.startsWith('builtin:')) throw new Error('lore-builder-preset-readonly')
    if (!presets.some((preset) => preset.id === id)) throw new Error('lore-builder-preset-not-found')
    return presets.filter((preset) => preset.id !== id)
}
