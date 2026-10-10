export type WikiPromptStage = 'analysis' | 'canonical-rewrite' | 'both' | 'response'
export type WikiPromptBlockType = 'core-ref' | 'text' | 'injection'
export type WikiPromptAnalysisMode = 'all' | 'normal' | 'historical'

export interface WikiPromptBlock {
    id: string
    type: WikiPromptBlockType
    name: string
    target: WikiPromptStage
    enabled: boolean
    readonly: boolean
    analysisMode?: WikiPromptAnalysisMode
    content?: string
}

export interface WikiPromptPreset {
    schemaVersion: 1
    writingPolicyVersion?: 1 | 2 | 3 | 4 | 5 | 6
    id: string
    name: string
    revision: number
    builtin: boolean
    blocks: WikiPromptBlock[]
}

export interface WikiPromptPresetState {
    presets: WikiPromptPreset[]
    chatPresetId: string
}

export interface CompiledWikiPromptGuide {
    analysis: string
    canonicalRewrite: string
    response: string
}

const MAX_PRESETS = 64
const MAX_EDITABLE_BLOCKS = 32
const MAX_BLOCK_CONTENT = 8_000
const MAX_COMPILED_GUIDE = 24_000

const REQUIRED_PREFIX: readonly WikiPromptBlock[] = [
    {
        id: 'core-evidence-contract',
        type: 'core-ref',
        name: 'Evidence and fact boundary',
        target: 'both',
        analysisMode: 'all',
        enabled: true,
        readonly: true,
        content: [
            'Record only facts established by accepted or confirmed narrative evidence.',
            'Do not promote instructions, discarded text, plans, guesses, omitted details, or temporal order into story facts or causation.',
            'Keep objective facts, character knowledge, and unresolved inference separate.',
        ].join('\n'),
    },
    {
        id: 'core-character-continuity-contract',
        type: 'core-ref',
        name: 'Character continuity contract',
        target: 'both',
        analysisMode: 'all',
        enabled: true,
        readonly: true,
        content: [
            'Character canon is accumulated operating state, not a summary of the latest scene.',
            'Do not delete established relationships and trust, mental state, knowledge boundaries, promises, injuries, or meaningful possessions, equipment, or appearance merely because a new scene does not mention them. Update them only with confirmed evidence.',
            'An optional history or turning-point map should contain about 3-6 major irreversible or causally useful transitions, not a turn-by-turn action log.',
            'When evidence supports it, keep relationships and trust, mental state, knowledge boundaries, and meaningful possessions, equipment, appearance, or constraints in separate sections from transient current state. Use only sections supported by evidence. Do not create empty sections or templates.',
            'When replacing a section, retain every unrelated established fact there or move it to an appropriate returned section. Keep individual knowledge and ownership separate; do not infer shared knowledge or ownership.',
            'Compress expression, never distinct established facts, relationship direction, knowledge boundaries, or consequences of change. Keep detailed scenes in event documents and their durable result in character canon.',
            'Record confirmed structured state values in the relevant subject canon. Update them only from confirmed evidence, retain existing values when they are omitted, and do not recalculate them or infer narrative meaning from them alone.',
        ].join('\n'),
    },
    {
        id: 'core-analysis-contract',
        type: 'core-ref',
        name: 'Memory analysis contract',
        target: 'analysis',
        analysisMode: 'normal',
        enabled: true,
        readonly: true,
        content: [
            'Separate established events, state changes, character knowledge, persistent facts, unresolved continuity, and canonical update candidates.',
            'Preserve exact puzzle observations such as symbols, order, spatial layout, pairings, blanks, mechanisms, and attempt outcomes. Keep confirmed observations distinct from inferred rules or solutions.',
        ].join('\n'),
    },
    {
        id: 'core-historical-analysis-contract',
        type: 'core-ref',
        name: 'Historical turn reanalysis contract',
        target: 'analysis',
        analysisMode: 'historical',
        enabled: true,
        readonly: true,
        content: [
            'Reanalyze the selected historical turn from its currently saved text and the supplied earlier context.',
            'Replace conflicting event details and recover omissions without projecting later knowledge back into the selected turn.',
            'Canonical updates may correct history, but must preserve a character current-state section that represents later events.',
        ].join('\n'),
    },
]

// Version 1 retains the shipped 2026-09-22 continuity contract above.
const MODULAR_CONTINUITY = [
    ...REQUIRED_PREFIX.find(block => block.id === 'core-character-continuity-contract')!.content!
        .split('\n').filter(line => !line.startsWith('When evidence supports it,') && !line.startsWith('An optional history')),
    'Use only these character section roles, translated into the selected wiki writing language: 인물 핵심 (Identity), 현재 상태 (Current State), 관계와 신뢰 (Relationships and Trust), 지식과 비밀 (Knowledge and Secrets), 주요 전환 (Major Transitions). Omit sections without evidence. Do not create empty sections or templates.',
    'Identity owns stable identity, background, personality and durable abilities. Current State owns current situation, goals, physical condition, constraints, unresolved tasks, and still-relevant emotion and mental state; it is not a recap of the latest scene.',
    'Relationships and Trust owns each counterpart current relationship, trust, conflict, promises and explicit values. Knowledge and Secrets owns individual knowledge, uncertainty, mistaken beliefs and who shares a secret; never equate objective truth with shared knowledge.',
    'One primary home per fact. Keep its full explanation in that section; elsewhere mention only the distinct consequence needed there. Stable temperament belongs to Identity, current distress to Current State, feelings about a counterpart to Relationships and Trust.',
    'Major Transitions records consequential changes to identity, goals, relationships, abilities, affiliation or lasting constraints with exact event links. Allow independent transitions to grow across a long story; no fixed item or character quota. Merge successive steps of the same transition rather than logging every encounter, movement or turn.',
    'During a justified update, consolidate overlapping legacy headings into these roles. Return the destination replacements and deletion patches for obsolete source sections together, preserving every unrelated still-valid fact. Do not delete a section until its necessary facts are represented in the same patch batch. Merely having older headings is not a reason to update.',
    'Meaningful equipment remains in Identity or Current State unless the equipment module is enabled. Do not create a Related Documents section just to repeat links already present.',
].join('\n')

export const OFFICIAL_WIKI_BACKUP_ID = 'official-wiki-260922'
export const OFFICIAL_WIKI_V2_BACKUP_ID = 'official-wiki-260922-v2'
export const OFFICIAL_WIKI_V3_BACKUP_ID = 'official-wiki-260930'
export const OFFICIAL_WIKI_V4_BACKUP_ID = 'official-wiki-261003'
export const OFFICIAL_WIKI_V5_BACKUP_ID = 'official-wiki-261003-v5'
const OPTIONAL_BLOCKS: WikiPromptBlock[] = [
    {
        id: 'default-character-equipment', type: 'text', name: '장비와 소지품',
        target: 'both', enabled: true, readonly: true, analysisMode: 'all',
        content: 'Equipment module: use a separate 장비와 소지품 (Equipment and Possessions) section in the selected wiki language when supported by evidence. It owns meaningful possessions, ownership, availability, acquisition, loss and condition. Move equipment details from other sections here without duplicating them; other sections may retain only a distinct identity trait or action constraint. Never infer ownership from proximity or another character equipment. Omit empty sections.',
    },
    {
        id: 'default-length-compression', type: 'text', name: '분량 압축',
        target: 'both', enabled: false, readonly: true, analysisMode: 'all',
        content: 'Apply stronger compression when updating character canon. Consolidate repeated explanations and counterpart relationship bullets, replace obsolete current states from confirmed evidence, and group consecutive steps of the same major transition with exact event links. Keep scene details in event documents. Never drop distinct still-valid facts, current state, relationship direction or values, knowledge boundaries, secrets, unresolved promises, meaningful equipment, or causal consequences merely to shorten the document. Keep each major transition meaning as well as its link. Prefer the shortest faithful expression, but impose no fixed length or item quota. Move facts and delete redundant source sections in the same patch batch only after preserving their necessary content.',
    },
]

// Version 4 keeps current state and individual knowledge without accumulating expired instructions.
const V4_CONTINUITY = [
    'Character canon maintains durable identity and current operating state. Keep scene details and acquisition history in event documents.',
    'Preserve established relationships and trust, knowledge, promises, injuries and meaningful possessions when the latest scene is silent about them. Silence is not completion, forgetting or evidence of change.',
    'On confirmed completion, expiry or replacement, remove inactive tasks, temporary instructions and superseded state from any section. Preserve outstanding rewards, obligations and lasting consequences; task completion does not prove reward delivery. Keep useful history in saved events with exact supplied links.',
    'A completed encounter or revelation does not erase acquaintance or acquired knowledge. Retain who met whom and what each person learned. Group knowledge by counterpart or topic and update the existing entry rather than append each occasion of learning.',
    'Preserve learned identities, rules, secrets, uncertainty, mistaken beliefs and who shares each secret. Correct a belief only for holders reached by the evidence. A document link, another person\'s knowledge or knowing a mutual acquaintance does not establish this person\'s knowledge. Do not invent ignorance from absent evidence.',
    'Use these section roles in the wiki writing language: 인물 핵심 (Identity), 현재 상태 (Current State), 관계와 신뢰 (Relationships and Trust), 지식과 비밀 (Knowledge and Secrets), 주요 전환 (Major Transitions). Do not create empty sections or templates.',
    'Identity owns identity, background, personality and abilities. Current State owns situation, goals, physical and mental condition, constraints and active tasks. Relationships and Trust owns acquaintances, relationships, trust, conflict, promises and explicit values. Knowledge and Secrets owns individual knowledge and belief boundaries, not an experience diary.',
    'One primary home per fact. Preserve its holder, source, certainty and conditions there, including knowledge recorded outside Knowledge and Secrets. Elsewhere retain only a distinct consequence. Keep routine experiences in events unless they establish durable state or knowledge needed for later choices.',
    'Record confirmed structured state values in the relevant subject canon. Update them only from confirmed evidence, retain existing values when they are omitted, and do not recalculate them or infer narrative meaning from them alone.',
    'Major Transitions records consequential changes with exact event links. Merge successive steps of the same transition; retain independent changes without a fixed item or character quota.',
    'When replacing or merging sections, preserve unrelated still-valid state and knowledge. Return destination and deletion patches together, retaining necessary content before removing source sections. Older headings alone do not justify an update.',
    'Meaningful equipment remains in Identity or Current State unless the equipment module is enabled. Do not create a Related Documents section just to repeat links already present.',
].join('\n')

const V4_COMPRESSION = 'Apply stronger compression by merging repeated explanations and successive steps of the same change. Follow the continuity contract to retire confirmed completed or expired state while preserving outstanding obligations and lasting consequences. Keep scene details and knowledge acquisition history in events; keep who met whom and each holder\'s current knowledge concise in canon. Never drop distinct still-valid facts, knowledge boundaries, attribution, conditions, relationship direction or values merely to shorten the document. Retain meaningful transition results and exact event links without a fixed length or item quota. Move necessary content and delete redundant source sections in the same patch batch.'

// Version 5 takes localized role headings from the writing policy and stops per-event transition logs.
const CURRENT_CONTINUITY = V4_CONTINUITY.split('\n').map(line =>
    line.startsWith('Use these section roles')
        ? 'Use these character section roles: Identity, Current State, Relationships and Trust, Knowledge and Secrets, Major Transitions. Write each heading exactly as the locale heading given in the canonical writing policy. Do not create empty sections or templates.'
        : line.startsWith('Major Transitions records')
            ? 'Major Transitions records lasting changes to state, relationships, role, goals, affiliation or constraints, not actions or scenes. A continuous scene or encounter spanning several events is one transition. When a new event continues or deepens the latest transition, revise that entry instead of appending a new one. Each entry states the resulting change with exact event links; retain independent changes without a fixed item or character quota.'
            : line
).join('\n')

const CURRENT_EQUIPMENT = 'Equipment module: use a separate Equipment and Possessions section, headed with its exact locale heading, when supported by evidence. It owns meaningful possessions, ownership, availability, acquisition, loss and condition. Move equipment details from other sections here without duplicating them; other sections may retain only a distinct identity trait or action constraint. Never infer ownership from proximity or another character equipment. Omit empty sections.'

const CURRENT_COMPRESSION = V4_COMPRESSION.replace(
    'Retain meaningful transition results and exact event links without a fixed length or item quota.',
    'When rewriting Major Transitions, also merge existing entries that describe successive steps of the same change, including entries left by earlier per-event logging. Each transition keeps its resulting change and one or two representative event links, such as the start and the decisive event; other events remain searchable without links. Impose no fixed length or item quota.'
)

// Version 6 keeps knowledge boundaries in character canon and shared world facts in one place.
const V6_CONTINUITY = CURRENT_CONTINUITY.split('\n').map(line =>
    line.startsWith('A completed encounter or revelation')
        ? 'A completed encounter or revelation does not erase acquaintance or acquired knowledge. Knowledge and Secrets records knowledge boundaries that matter for later choices: secrets and who shares them, mistaken beliefs, uncertainty, what this character knows that a relevant counterpart does not, and what they notably do not know. It is not a catalogue of everything the character has seen or been told.'
        : line.startsWith('Preserve learned identities, rules,')
            ? 'Shared world rules, setting mechanics and place facts belong once in the relevant location or concept canon, not in every character who learned them. In a character document keep one concise entry per topic or source, such as that a person explained the town rules with a link to that canon, and revise that entry instead of appending each new detail. Preserve learned identities, secrets, uncertainty, mistaken beliefs and who shares each secret. Correct a belief only for holders reached by the evidence. A document link, another person\'s knowledge or knowing a mutual acquaintance does not establish this person\'s knowledge. Do not invent ignorance from absent evidence.'
            : line.startsWith('Identity owns identity')
                ? `${line} Relationships and Trust keeps one compact current entry per counterpart; how it developed belongs in events and Major Transitions, not a running chronicle of scenes. Canon never narrates a sequence of scenes, so it must not imply when a routine experience happened.`
                : line
).join('\n')

// Version 3 adds recall detail without changing the archived writing policies.
const RECALL_BLOCKS: WikiPromptBlock[] = [
    {
        id: 'default-evidence-scope', type: 'text', name: '사실의 출처와 지속 범위',
        target: 'both', enabled: true, readonly: true, analysisMode: 'all',
        content: [
            'Keep attribution and certainty in each event or canon sentence, not only in characterKnowledge: A reported X, B suspects X, or C witnessed X. A claim, confession, self-report or prediction is not an unqualified world fact without independent confirming evidence. Preserve who actually learned it; narrator knowledge is not shared character knowledge.',
            'When evidence corrects a belief, update only the knowledge holders supported by that evidence. Retain the former belief as history only when its existence still matters.',
            'Affection, intimacy, jealousy, comfort and context-bound roles do not alone establish a formal relationship, permanent hierarchy, personality change or resolved psychological problem. Preserve the observed behavior and explicit commitments; name a durable status only when the narrative establishes it through naming, agreement or equivalent unambiguous evidence.',
            'First appearance in the supplied input is not first onset in the story. Record onset, reinforcement or resolution only with evidence for that transition; leave unsupported before states unknown. Temporal sequence alone is not causation. A single outcome does not prove a universal ability, limitation or permanent effect; retain the stated scope.',
            'Preserve supported observations and attributed uncertainty rather than deleting the whole development because its interpretation is uncertain.',
        ].join('\n'),
    },
    {
        id: 'default-recall-detail', type: 'text', name: '회수할 수 있는 사건의 구체성',
        target: 'analysis', enabled: true, readonly: true, analysisMode: 'all',
        content: [
            'Write establishedEvents as a chronological story summary with enough concrete detail to recognize and retrieve each meaningful development on its own. Retain supported participants, action and target, distinctive objects or places, conditions, and consequences when they distinguish this event or explain a later choice. Preserve cause, response and result only where the source establishes their connection.',
            'Do not replace a distinctive interaction with a generic conclusion such as increased trust. Preserve what the characters actually did or said. Small gestures, recurring nicknames, jokes and relationship-specific motifs can matter even without an external plot change; include them briefly in their scene when they provide a distinctive recall cue.',
            'Keep one coherent development together. Separate independently meaningful decisions, revelations or consequences without fragmenting each action or padding the record count. Do not force a fixed detail quota or length increase; remove repeated description, routine action and connective prose before removing useful recall cues. Respect the existing schema and per-item limits; add no dialogue or memory fields.',
            'When keywords are available, include grounded distinctive names, objects, actions, nicknames or short recurring expressions. Keywords aid retrieval but never replace the event facts or add unsupported details.',
            'Keep scene detail in events. Still register or update a subject canon for independently useful durable state, knowledge, commitments, possessions or constraints, even when the event describes their origin. Store the concise current result and event link in canon instead of copying the full scene.',
        ].join('\n'),
    },
    {
        id: 'default-dialogue-recall', type: 'text', name: '핵심 대사와 문맥 보존',
        target: 'analysis', enabled: true, readonly: true, analysisMode: 'all',
        content: [
            'Retain a short exact quotation inside an establishedEvents item when its wording carries a promise, condition, boundary, refusal, acceptance or distinctive relationship-specific expression that paraphrase would lose. Emotional intensity, humor or ordinary character voice alone is not enough; not every scene needs a quote.',
            'Identify the speaker, addressee when known, situation and relevant response so the quotation remains understandable alone. Keep the shortest exchange needed when a reply changes the meaning; preserve conditions and negation.',
            'Every quoted passage must be an exact contiguous substring of the supplied confirmed source, with original wording and punctuation. Never reconstruct, merge separate utterances, translate or improve a quotation. If literal copying is uncertain, omit direct quotation and retain only the supported meaning as attributed paraphrase. Distinguish a character quoting someone else from an independently witnessed original utterance.',
        ].join('\n'),
    },
    {
        id: 'default-recall-response', type: 'text', name: '회수한 기억의 문맥과 대사',
        target: 'response', enabled: true, readonly: true, analysisMode: 'all',
        content: 'Use retrieved concrete actions, objects and distinctive expressions when relevant to the current scene, without forcing callbacks. Preserve the original speaker, addressee, conditions, chronology and knowledge holders. For exact past wording, prefer retrieved source text over a summary; do not present reconstructed or paraphrased dialogue as a verbatim past quote. Missing context remains uncertain. A past claim remains attributed, and a scene-local reaction does not establish a lasting relationship or state.',
    },
]

const REQUIRED_SUFFIX: readonly WikiPromptBlock[] = [
    {
        id: 'character-wiki-guide',
        type: 'injection',
        name: 'Character Wiki Guide Injection',
        target: 'both',
        analysisMode: 'all',
        enabled: true,
        readonly: true,
        content: 'The current character Wiki Guide is inserted here at runtime for analysis and canonical writing.',
    },
    {
        id: 'chat-wiki-guide',
        type: 'injection',
        name: 'Chat Wiki Guide Injection',
        target: 'both',
        analysisMode: 'all',
        enabled: true,
        readonly: true,
        content: 'The current chat Wiki Guide is inserted here at runtime after the character guide.',
    },
    {
        id: 'core-output-contract',
        type: 'core-ref',
        name: 'Structured output contract',
        target: 'both',
        analysisMode: 'all',
        enabled: true,
        readonly: true,
        content: [
            'Return only the structured fields required by the active operation.',
            'The event draft fields are schemaVersion, title, establishedEvents, stateChanges, characterKnowledge, persistentFacts, openContinuity, and canonicalUpdateCandidates.',
            'Do not create IDs, paths, revisions, hashes, timestamps, source IDs, or YAML frontmatter.',
        ].join('\n'),
    },
]

const RESERVED_IDS = new Set([
    ...REQUIRED_PREFIX.map((block) => block.id),
    ...REQUIRED_SUFFIX.map((block) => block.id),
])

function boundedText(value: unknown, maximum: number): string {
    return typeof value === 'string' ? value.trim().slice(0, maximum) : ''
}

function normalizeTarget(value: unknown): WikiPromptStage {
    return value === 'analysis'
        || value === 'canonical-rewrite'
        || value === 'both'
        || value === 'response'
        ? value
        : 'both'
}

function normalizeAnalysisMode(value: unknown): WikiPromptAnalysisMode {
    return value === 'normal' || value === 'historical' ? value : 'all'
}

function isLegacyBuiltinPreset(source: Record<string, unknown>): boolean {
    if (source.builtin === true) return true
    if (source.builtin === false || source.name !== 'Default Wiki Prompt'
        || !Array.isArray(source.blocks)) return false
    const ids = new Set(source.blocks.flatMap((block) =>
        block && typeof block === 'object' && typeof (block as Record<string, unknown>).id === 'string'
            ? [(block as Record<string, unknown>).id as string]
            : []
    ))
    return ids.has('default-puzzle-clue-tracker')
        && ids.has('default-puzzle-response-reasoning')
}

function normalizeEditableBlocks(value: unknown): WikiPromptBlock[] {
    if (!Array.isArray(value)) return []
    const seen = new Set<string>()
    const blocks: WikiPromptBlock[] = []
    for (const raw of value) {
        if (!raw || typeof raw !== 'object') continue
        const source = raw as Record<string, unknown>
        const id = boundedText(source.id, 120)
        if (!id || RESERVED_IDS.has(id) || seen.has(id)) continue
        if (source.type !== 'text') continue
        seen.add(id)
        blocks.push({
            id,
            type: 'text',
            name: boundedText(source.name, 80) || 'Wiki Guide',
            target: normalizeTarget(source.target),
            enabled: source.enabled !== false,
            readonly: false,
            analysisMode: normalizeAnalysisMode(source.analysisMode),
            content: boundedText(source.content, MAX_BLOCK_CONTENT),
        })
        if (blocks.length >= MAX_EDITABLE_BLOCKS) break
    }
    return blocks
}

function normalizePreset(value: unknown, idFactory: () => string): WikiPromptPreset {
    const source = value && typeof value === 'object'
        ? value as Record<string, unknown>
        : {}
    const builtin = isLegacyBuiltinPreset(source)
    const editable = normalizeEditableBlocks(source.blocks)
    const storedBlocks = Array.isArray(source.blocks) ? source.blocks : []
    const storedCore = new Map(storedBlocks.flatMap((block) => {
        if (!block || typeof block !== 'object') return []
        const record = block as Record<string, unknown>
        return record.type === 'core-ref' && RESERVED_IDS.has(String(record.id ?? ''))
            ? [[String(record.id), record] as const]
            : []
    }))
    const hasMain = editable.some((block) => block.id === 'main-wiki-guide')
    if (!hasMain) {
        editable.unshift({
            id: 'main-wiki-guide',
            type: 'text',
            name: 'Main Wiki Guide',
            target: 'both',
            enabled: true,
            readonly: false,
            analysisMode: 'all',
            content: '',
        })
    }
    const writingPolicyVersion = source.writingPolicyVersion === 6 ? 6
        : source.writingPolicyVersion === 5 ? 5
        : source.writingPolicyVersion === 4 ? 4
        : source.writingPolicyVersion === 3 ? 3
        : source.writingPolicyVersion === 2 ? 2 : 1
    return {
        schemaVersion: 1,
        writingPolicyVersion,
        id: boundedText(source.id, 120) || idFactory(),
        name: boundedText(source.name, 120) || 'Default Wiki Prompt',
        revision: Number.isSafeInteger(source.revision)
            ? Math.max(1, Math.min(2_147_483_647, source.revision as number))
            : 1,
        builtin,
        blocks: [
            ...REQUIRED_PREFIX.map((block) => {
                const stored = builtin || block.id === 'core-character-continuity-contract'
                    ? undefined
                    : storedCore.get(block.id)
                return {
                    ...block,
                    ...(block.id === 'core-character-continuity-contract' && writingPolicyVersion >= 2
                        ? { content: writingPolicyVersion >= 6 ? V6_CONTINUITY
                        : writingPolicyVersion >= 5 ? CURRENT_CONTINUITY
                        : writingPolicyVersion >= 4 ? V4_CONTINUITY : MODULAR_CONTINUITY } : {}),
                    ...(stored ? {
                        name: boundedText(stored.name, 80) || block.name,
                        target: normalizeTarget(stored.target),
                        analysisMode: normalizeAnalysisMode(stored.analysisMode ?? block.analysisMode),
                        enabled: stored.enabled !== false,
                        content: typeof stored.content === 'string'
                            ? boundedText(stored.content, MAX_BLOCK_CONTENT)
                            : block.content,
                    } : {}),
                    readonly: builtin || block.id === 'core-character-continuity-contract',
                }
            }),
            ...editable.map((block) => ({ ...block, readonly: builtin })),
            ...REQUIRED_SUFFIX.map((block) => {
                if (block.type !== 'core-ref') return { ...block }
                const stored = builtin ? undefined : storedCore.get(block.id)
                return {
                    ...block,
                    ...(stored ? {
                        name: boundedText(stored.name, 80) || block.name,
                        target: normalizeTarget(stored.target),
                        analysisMode: normalizeAnalysisMode(stored.analysisMode ?? block.analysisMode),
                        enabled: stored.enabled !== false,
                        content: typeof stored.content === 'string'
                            ? boundedText(stored.content, MAX_BLOCK_CONTENT)
                            : block.content,
                    } : {}),
                    readonly: builtin,
                }
            }),
        ],
    }
}

function createLegacyWikiPromptPreset(id: string): WikiPromptPreset {
    return normalizePreset({
        id,
        builtin: true,
        blocks: [
            {
                id: 'main-wiki-guide',
                type: 'text',
                name: 'Main Wiki Guide',
                target: 'both',
                enabled: true,
                readonly: false,
                analysisMode: 'all',
                content: '',
            },
            {
                id: 'default-puzzle-clue-tracker',
                type: 'text',
                name: 'Puzzle & clue tracker',
                target: 'both',
                enabled: true,
                readonly: false,
                analysisMode: 'all',
                content: 'When a puzzle, cipher, ritual, combination, lock, or rule-based clue appears, preserve the observed elements, order, spatial layout, pairings, blanks, mechanism locations, and outcomes of attempted solutions. Keep confirmed observations separate from inferred rules or answers, and retain unresolved parts as unresolved continuity.',
            },
            {
                id: 'default-puzzle-response-reasoning',
                type: 'text',
                name: 'Puzzle relationship reasoning',
                target: 'response',
                enabled: true,
                readonly: false,
                analysisMode: 'all',
                content: 'When retrieved evidence contains a puzzle, cipher, symbolic sequence, paired layout, or blank, reason about the relationship among the recalled elements before choosing the next action. Reveal important connections naturally in the narrative. Treat any solution not established by evidence as an inference rather than a fact.',
            },
        ],
    }, () => id)
}

function createModularWikiPromptPreset(id: string): WikiPromptPreset {
    const legacy = createLegacyWikiPromptPreset(id)
    return normalizePreset({
        ...legacy, name: '공식기본', writingPolicyVersion: 2,
        blocks: [...legacy.blocks, ...OPTIONAL_BLOCKS.map(block => ({ ...block }))],
    }, () => id)
}

function createRecallWikiPromptPreset(id: string): WikiPromptPreset {
    const modular = createModularWikiPromptPreset(id)
    return normalizePreset({
        ...modular, writingPolicyVersion: 3, revision: 2,
        blocks: [...modular.blocks, ...RECALL_BLOCKS.map(block => ({ ...block }))],
    }, () => id)
}

function createCurrentStateWikiPromptPreset(id: string): WikiPromptPreset {
    const previous = createRecallWikiPromptPreset(id)
    return normalizePreset({
        ...previous, writingPolicyVersion: 4, revision: 3,
        blocks: previous.blocks.map(block => block.id === 'default-length-compression'
            ? { ...block, content: V4_COMPRESSION } : block),
    }, () => id)
}

function createLocalizedTransitionWikiPromptPreset(id: string): WikiPromptPreset {
    const previous = createCurrentStateWikiPromptPreset(id)
    return normalizePreset({
        ...previous, writingPolicyVersion: 5, revision: 4,
        blocks: previous.blocks.map(block => block.id === 'default-length-compression'
            ? { ...block, enabled: true, content: CURRENT_COMPRESSION }
            : block.id === 'default-character-equipment'
                ? { ...block, content: CURRENT_EQUIPMENT } : block),
    }, () => id)
}

export function createDefaultWikiPromptPreset(id: string): WikiPromptPreset {
    const previous = createLocalizedTransitionWikiPromptPreset(id)
    return normalizePreset({ ...previous, writingPolicyVersion: 6, revision: 5 }, () => id)
}

function createOfficialBackup(): WikiPromptPreset {
    return { ...createLegacyWikiPromptPreset(OFFICIAL_WIKI_BACKUP_ID), name: '공식기본-260922' }
}

export function createWikiPromptPreset(id: string, name = 'Wiki Prompt'): WikiPromptPreset {
    const preset = duplicateWikiPromptPreset(createDefaultWikiPromptPreset(id), id)
    preset.name = name.slice(0, 120)
    return preset
}

export function normalizeWikiPromptPresetState(
    value: unknown,
    idFactory: () => string
): WikiPromptPresetState {
    const source = value && typeof value === 'object'
        ? value as Record<string, unknown>
        : {}
    const rawPresets = Array.isArray(source.presets)
        ? source.presets.slice(0, MAX_PRESETS)
        : []
    const presets = rawPresets.map((preset) => {
        const normalized = normalizePreset(preset, idFactory)
        // Existing official selections retain their stable ID; personal copies retain their policy.
        if (!normalized.builtin || normalized.id === OFFICIAL_WIKI_BACKUP_ID
            || normalized.id === OFFICIAL_WIKI_V2_BACKUP_ID
            || normalized.id === OFFICIAL_WIKI_V3_BACKUP_ID
            || normalized.id === OFFICIAL_WIKI_V4_BACKUP_ID
            || normalized.id === OFFICIAL_WIKI_V5_BACKUP_ID
            || normalized.writingPolicyVersion === 6) return normalized
        const current = createDefaultWikiPromptPreset(normalized.id)
        for (const optional of OPTIONAL_BLOCKS) {
            // Version 5 shipped compression on; later upgrades keep the user's choice.
            if (optional.id === 'default-length-compression' && normalized.writingPolicyVersion < 5) continue
            const stored = normalized.blocks.find(block => block.id === optional.id)
            if (stored) current.blocks.find(block => block.id === optional.id)!.enabled = stored.enabled
        }
        return current
    })
    if (presets.length === 0) presets.push(createDefaultWikiPromptPreset(idFactory()))
    if (!presets.some(preset => preset.builtin && preset.writingPolicyVersion === 6)) {
        presets.push(createDefaultWikiPromptPreset('official-wiki-current'))
    }
    if (!presets.some(preset => preset.id === OFFICIAL_WIKI_BACKUP_ID)) {
        presets.push(createOfficialBackup())
    }
    if (!presets.some(preset => preset.id === OFFICIAL_WIKI_V2_BACKUP_ID)) {
        presets.push({
            ...createModularWikiPromptPreset(OFFICIAL_WIKI_V2_BACKUP_ID),
            name: '공식기본-260922-v2',
        })
    }
    if (!presets.some(preset => preset.id === OFFICIAL_WIKI_V3_BACKUP_ID)) {
        presets.push({
            ...createRecallWikiPromptPreset(OFFICIAL_WIKI_V3_BACKUP_ID),
            name: '공식기본-260930',
        })
    }
    if (!presets.some(preset => preset.id === OFFICIAL_WIKI_V4_BACKUP_ID)) {
        presets.push({
            ...createCurrentStateWikiPromptPreset(OFFICIAL_WIKI_V4_BACKUP_ID),
            name: '공식기본-261003',
        })
    }
    if (!presets.some(preset => preset.id === OFFICIAL_WIKI_V5_BACKUP_ID)) {
        presets.push({
            ...createLocalizedTransitionWikiPromptPreset(OFFICIAL_WIKI_V5_BACKUP_ID),
            name: '공식기본-261003-v5',
        })
    }
    const ids = new Set(presets.map((preset) => preset.id))
    const fallbackId = presets[0].id
    const chatPresetId = boundedText(source.chatPresetId, 120)
    return {
        presets,
        chatPresetId: ids.has(chatPresetId) ? chatPresetId : fallbackId,
    }
}

function targetIncludes(target: WikiPromptStage, stage: Exclude<WikiPromptStage, 'both'>): boolean {
    return target === stage || (target === 'both' && stage !== 'response')
}

function compileStage(
    preset: WikiPromptPreset,
    stage: Exclude<WikiPromptStage, 'both'>,
    characterGuide: string,
    chatGuide: string,
    analysisMode: Exclude<WikiPromptAnalysisMode, 'all'>
): string {
    const sections: string[] = []
    for (const block of preset.blocks) {
        if (!block.enabled || !targetIncludes(block.target, stage)
            || (stage === 'analysis'
                && block.analysisMode !== undefined
                && block.analysisMode !== 'all'
                && block.analysisMode !== analysisMode)) continue
        if (block.type === 'text' || block.type === 'core-ref') {
            const content = boundedText(block.content, MAX_BLOCK_CONTENT)
            if (content) sections.push(`## ${block.name}\n${content}`)
        }
        else if (block.id === 'character-wiki-guide') {
            const content = boundedText(characterGuide, MAX_BLOCK_CONTENT)
            if (content) sections.push(`## Character Wiki Guide\n${content}`)
        }
        else if (block.id === 'chat-wiki-guide') {
            const content = boundedText(chatGuide, MAX_BLOCK_CONTENT)
            if (content) sections.push(`## Chat Wiki Guide\n${content}`)
        }
    }
    return sections.join('\n\n').slice(0, MAX_COMPILED_GUIDE)
}

export function compileWikiPromptGuide(
    preset: WikiPromptPreset,
    injections: {
        characterGuide?: string
        chatGuide?: string
        analysisMode?: Exclude<WikiPromptAnalysisMode, 'all'>
    } = {}
): CompiledWikiPromptGuide {
    const normalized = normalizePreset(preset, () => preset.id)
    return {
        analysis: compileStage(
            normalized,
            'analysis',
            injections.characterGuide ?? '',
            injections.chatGuide ?? '',
            injections.analysisMode ?? 'normal'
        ),
        canonicalRewrite: compileStage(
            normalized,
            'canonical-rewrite',
            injections.characterGuide ?? '',
            injections.chatGuide ?? '',
            'normal'
        ),
        response: compileStage(normalized, 'response', '', '', 'normal'),
    }
}

export function resolveWikiPromptPreset(
    presets: readonly WikiPromptPreset[] | null | undefined,
    presetId: string | null | undefined
): WikiPromptPreset | undefined {
    if (!Array.isArray(presets) || presets.length === 0) return undefined
    return presets.find((preset) => preset.id === presetId) ?? presets[0]
}

export function duplicateWikiPromptPreset(
    preset: WikiPromptPreset,
    id: string
): WikiPromptPreset {
    const copy = normalizePreset({ ...preset, builtin: false }, () => id)
    return {
        ...copy,
        id,
        builtin: false,
        name: `${copy.name} Copy`.slice(0, 120),
        revision: 1,
        blocks: copy.blocks.map((block) => ({ ...block })),
    }
}

export function deleteWikiPromptPreset(
    presets: readonly WikiPromptPreset[],
    presetId: string
): { presets: WikiPromptPreset[]; deleted: boolean } {
    if (presets.length <= 1 || presets.find((preset) => preset.id === presetId)?.builtin
        || !presets.some((preset) => preset.id === presetId)) {
        return { presets: [...presets], deleted: false }
    }
    return {
        presets: presets.filter((preset) => preset.id !== presetId),
        deleted: true,
    }
}

export function serializeWikiPromptPreset(preset: WikiPromptPreset): string {
    return JSON.stringify({
        type: 'risubard-wiki-prompt-preset',
        schemaVersion: 1,
        preset: normalizePreset(preset, () => preset.id),
    }, null, 2)
}

export function parseWikiPromptPreset(
    text: string,
    idFactory: () => string
): WikiPromptPreset {
    const parsed = JSON.parse(text) as unknown
    const source = parsed && typeof parsed === 'object'
        && (parsed as Record<string, unknown>).type === 'risubard-wiki-prompt-preset'
        ? (parsed as Record<string, unknown>).preset
        : parsed
    const preset = normalizePreset({
        ...(source && typeof source === 'object' ? source : {}),
        builtin: false,
    }, idFactory)
    return {
        ...preset,
        id: idFactory(),
        revision: 1,
    }
}
