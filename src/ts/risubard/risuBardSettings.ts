import { buildWikiWritingLanguageGuard, normalizeWikiWritingLanguage, type WikiWritingLanguage } from './wikiWritingLanguage'

export const RISUBARD_ANALYSIS_TOKEN_LIMIT_DEFAULT = 8_192
export const RISUBARD_ADDITIONAL_SEARCH_LIMIT_DEFAULT = 1
export const RISUBARD_CANONICAL_TARGET_LIMIT_DEFAULT = 8
export const RISUBARD_INQUIRY_TARGET_TOKEN_BUDGET_DEFAULT = 2_000
export const RISUBARD_INQUIRY_EVENT_TOKEN_BUDGET_DEFAULT = 2_000
export const RISUBARD_INQUIRY_SOURCE_TOKEN_BUDGET_DEFAULT = 2_000
export const RISUBARD_INQUIRY_MAXIMUM_TOKEN_BUDGET_DEFAULT = 6_000
export const RISUBARD_HISTORICAL_SOURCE_MATCH_LIMIT_DEFAULT = 8
export const RISUBARD_CANONICAL_WRITING_STYLE_DEFAULT = 'concise' as const
export const RISUBARD_CANONICAL_CUSTOM_STYLE_MAX_LENGTH = 1_000

export type RisuBardCanonicalWritingStyle =
    | 'standard'
    | 'concise'
    | 'ultra-concise'
    | 'custom'

export interface RisuBardChatSettings {
    risuBardModelMode?: 'memory' | 'model'
    showRequestStatus?: boolean
    risuBardInquiryTargetTokenBudget?: number
    risuBardInquiryEventTokenBudget?: number
    risuBardInquirySourceTokenBudget?: number
    risuBardInquiryMaximumTokenBudget?: number
    risuBardHistoricalSourceMatchLimit?: number
    risuBardAnalysisTokenLimit?: number
    risuBardAdditionalSearchLimit?: number
    risuBardCanonicalTargetLimit?: number
    risuBardRecentMessageCount?: number
    risuBardResponseMessageCount?: number
    risuBardResponseExcludeUserMessages?: boolean
    risuBardCanonicalWritingStyle?: RisuBardCanonicalWritingStyle
    risuBardCanonicalCustomStyle?: string
    risuBardWikiWritingLanguage?: WikiWritingLanguage
    risuBardWikiLanguageSync?: boolean
    bardChatIncludeWiki?: boolean
    bardChatIncludeChat?: boolean
    bardChatIncludeSystemPrompt?: boolean
    bardChatIncludeCharacterDescription?: boolean
    bardChatIncludePersona?: boolean
    bardChatIncludeCharacterLorebook?: boolean
    bardChatIncludeModuleLorebook?: boolean
}

export interface ResolvedRisuBardChatSettings {
    risuBardModelMode: 'memory' | 'model'
    showRequestStatus: boolean
    risuBardInquiryTargetTokenBudget: number
    risuBardInquiryEventTokenBudget: number
    risuBardInquirySourceTokenBudget: number
    risuBardInquiryMaximumTokenBudget: number
    risuBardHistoricalSourceMatchLimit: number
    risuBardAnalysisTokenLimit: number
    risuBardAdditionalSearchLimit: number
    risuBardCanonicalTargetLimit: number
    risuBardRecentMessageCount: number
    risuBardResponseMessageCount: number
    risuBardResponseExcludeUserMessages: boolean
    risuBardCanonicalWritingStyle: RisuBardCanonicalWritingStyle
    risuBardCanonicalCustomStyle: string
    risuBardWikiWritingLanguage: WikiWritingLanguage
    risuBardWikiLanguageSync: boolean
    bardChatIncludeWiki: boolean
    bardChatIncludeChat: boolean
    bardChatIncludeSystemPrompt: boolean
    bardChatIncludeCharacterDescription: boolean
    bardChatIncludePersona: boolean
    bardChatIncludeCharacterLorebook: boolean
    bardChatIncludeModuleLorebook: boolean
}

function boundedInteger(
    value: unknown,
    fallback: number,
    minimum: number,
    maximum = Number.MAX_SAFE_INTEGER
): number {
    if (!Number.isFinite(value) || typeof value !== 'number') return fallback
    const rounded = Math.round(value)
    if (!Number.isSafeInteger(rounded)) return fallback
    return Math.max(minimum, Math.min(maximum, rounded))
}

export function resolveRisuBardChatSettings(
    global: RisuBardChatSettings,
    chat?: RisuBardChatSettings,
): ResolvedRisuBardChatSettings {
    const value = <K extends keyof RisuBardChatSettings>(key: K) =>
        chat?.[key] ?? global[key]
    const inquiry = normalizeRisuBardInquiryTokenBudget(
        value('risuBardInquiryTargetTokenBudget'),
        value('risuBardInquiryMaximumTokenBudget'),
        value('risuBardInquiryEventTokenBudget'),
        value('risuBardInquirySourceTokenBudget'),
    )
    return {
        risuBardModelMode: value('risuBardModelMode') === 'model' ? 'model' : 'memory',
        showRequestStatus: value('showRequestStatus') !== false,
        risuBardInquiryTargetTokenBudget: inquiry.target,
        risuBardInquiryEventTokenBudget: inquiry.events,
        risuBardInquirySourceTokenBudget: inquiry.perSource,
        risuBardInquiryMaximumTokenBudget: inquiry.maximum,
        risuBardHistoricalSourceMatchLimit:
            normalizeRisuBardHistoricalSourceMatchLimit(
                value('risuBardHistoricalSourceMatchLimit')
            ),
        risuBardAnalysisTokenLimit: normalizeRisuBardAnalysisTokenLimit(
            value('risuBardAnalysisTokenLimit')
        ),
        risuBardAdditionalSearchLimit: normalizeRisuBardAdditionalSearchLimit(
            value('risuBardAdditionalSearchLimit')
        ),
        risuBardCanonicalTargetLimit: normalizeRisuBardCanonicalTargetLimit(
            value('risuBardCanonicalTargetLimit')
        ),
        risuBardRecentMessageCount: boundedInteger(
            value('risuBardRecentMessageCount'), 12, 1
        ),
        risuBardResponseMessageCount: boundedInteger(
            value('risuBardResponseMessageCount'), 12, 1
        ),
        risuBardResponseExcludeUserMessages:
            value('risuBardResponseExcludeUserMessages') === true,
        risuBardCanonicalWritingStyle: normalizeRisuBardCanonicalWritingStyle(
            value('risuBardCanonicalWritingStyle')
        ),
        risuBardCanonicalCustomStyle: normalizeRisuBardCanonicalCustomStyle(
            value('risuBardCanonicalCustomStyle')
        ),
        risuBardWikiWritingLanguage: normalizeWikiWritingLanguage(value('risuBardWikiWritingLanguage')),
        risuBardWikiLanguageSync: value('risuBardWikiLanguageSync') === true,
        bardChatIncludeWiki: value('bardChatIncludeWiki') !== false,
        bardChatIncludeChat: value('bardChatIncludeChat') === true,
        bardChatIncludeSystemPrompt:
            value('bardChatIncludeSystemPrompt') === true,
        bardChatIncludeCharacterDescription:
            value('bardChatIncludeCharacterDescription') === true,
        bardChatIncludePersona: value('bardChatIncludePersona') === true,
        bardChatIncludeCharacterLorebook:
            value('bardChatIncludeCharacterLorebook') === true,
        bardChatIncludeModuleLorebook:
            value('bardChatIncludeModuleLorebook') === true,
    }
}

export function normalizeRisuBardAnalysisTokenLimit(value: unknown): number {
    return boundedInteger(
        value,
        RISUBARD_ANALYSIS_TOKEN_LIMIT_DEFAULT,
        3_072
    )
}

export function normalizeRisuBardAdditionalSearchLimit(value: unknown): number {
    return boundedInteger(
        value,
        RISUBARD_ADDITIONAL_SEARCH_LIMIT_DEFAULT,
        0
    )
}

export function normalizeRisuBardCanonicalTargetLimit(value: unknown): number {
    return boundedInteger(
        value,
        RISUBARD_CANONICAL_TARGET_LIMIT_DEFAULT,
        1
    )
}

export function normalizeRisuBardHistoricalSourceMatchLimit(
    value: unknown
): number {
    return boundedInteger(
        value,
        RISUBARD_HISTORICAL_SOURCE_MATCH_LIMIT_DEFAULT,
        0,
        32
    )
}

export function normalizeRisuBardInquiryTokenBudget(
    target: unknown,
    maximum: unknown,
    events?: unknown,
    perSource?: unknown,
): { target: number; events: number; perSource: number; maximum: number } {
    const normalizedMaximum = boundedInteger(
        maximum,
        RISUBARD_INQUIRY_MAXIMUM_TOKEN_BUDGET_DEFAULT,
        256
    )
    return {
        target: boundedInteger(
            target,
            RISUBARD_INQUIRY_TARGET_TOKEN_BUDGET_DEFAULT,
            256,
            normalizedMaximum
        ),
        events: boundedInteger(
            events,
            RISUBARD_INQUIRY_EVENT_TOKEN_BUDGET_DEFAULT,
            256,
            normalizedMaximum,
        ),
        perSource: boundedInteger(
            perSource,
            RISUBARD_INQUIRY_SOURCE_TOKEN_BUDGET_DEFAULT,
            256,
            normalizedMaximum,
        ),
        maximum: normalizedMaximum,
    }
}

export function normalizeRisuBardCanonicalWritingStyle(
    value: unknown
): RisuBardCanonicalWritingStyle {
    return value === 'standard'
        || value === 'concise'
        || value === 'ultra-concise'
        || value === 'custom'
        ? value
        : RISUBARD_CANONICAL_WRITING_STYLE_DEFAULT
}

export function normalizeRisuBardCanonicalCustomStyle(value: unknown): string {
    return typeof value === 'string'
        ? value.trim().slice(0, RISUBARD_CANONICAL_CUSTOM_STYLE_MAX_LENGTH)
        : ''
}

const CONCISE_CANONICAL_STYLE = [
    '장식적 설명과 기존 사실의 반복을 제거한다.',
    '사실 하나당 한 문장을 사용한다.',
    '주체, 대상, 부정, 시간과 인물별 지식 경계는 생략하지 않는다.',
    '임의의 약어를 만들지 않는다.',
].join(' ')

function resolveRisuBardWritingStyleInstruction(
    style: unknown,
    customStyle: unknown,
    language: WikiWritingLanguage = 'ko'
): string {
    const normalizedStyle = normalizeRisuBardCanonicalWritingStyle(style)
    const normalizedCustom = normalizeRisuBardCanonicalCustomStyle(customStyle)
    if (language === 'en') {
        if (normalizedStyle === 'custom' && normalizedCustom) return `User style preference: ${normalizedCustom}`
        if (normalizedStyle === 'standard') return 'Use natural, complete short sentences without unnecessary embellishment or repetition.'
        if (normalizedStyle === 'ultra-concise') return 'Use telegraphic sentences and stable field labels, one atomic fact per line. Explicitly preserve subjects, objects, negation, time and character knowledge boundaries. Do not invent abbreviations.'
        return 'Remove decorative prose and repeated facts. Use one sentence per fact. Preserve subjects, objects, negation, time and character knowledge boundaries. Do not invent abbreviations.'
    }
    if (language === 'ja') {
        if (normalizedStyle === 'custom' && normalizedCustom) return `ユーザーの文体指定: ${normalizedCustom}`
        if (normalizedStyle === 'standard') return '自然で完全な短い文を使い、不要な修飾と繰り返しを避ける。'
        if (normalizedStyle === 'ultra-concise') return '電報文に近い短い文と安定したフィールド表現を使う。原子的な事実1件につき1行を使い、主語・対象・否定・時間と人物ごとの知識の境界を必ず明示する。勝手な略語を作らない。'
        return '装飾的な説明と既存事実の繰り返しを除去する。事実1件につき1文を使う。主語・対象・否定・時間と人物ごとの知識境界は省略しない。勝手な略語を作らない。'
    }
    const styleInstruction = normalizedStyle === 'standard'
        ? '자연스럽고 완결된 짧은 문장을 사용하되 불필요한 수식과 반복을 피한다.'
        : normalizedStyle === 'ultra-concise'
            ? '전보체에 가까운 짧은 문장과 안정된 필드 표현을 사용한다. 원자적 사실 하나당 한 줄을 사용하고 주체, 대상, 부정, 시간과 인물별 지식 경계는 반드시 명시한다. 임의의 약어를 만들지 않는다.'
            : normalizedStyle === 'custom' && normalizedCustom.length > 0
                ? `사용자 문체 선호: ${normalizedCustom}`
                : CONCISE_CANONICAL_STYLE
    return styleInstruction
}

export function buildRisuBardEventWritingPolicy(
    style: unknown,
    customStyle: unknown,
    language: WikiWritingLanguage = 'ko'
): string {
    if (language === 'en') return [
        '## Canonical writing policy',
        resolveRisuBardWritingStyleInstruction(style, customStyle, language),
        'When compressing, do not invent action targets or locations, turn temporal order into causation, or cross character knowledge boundaries at the time of an event.',
        'Preserve observed puzzle elements, order, spatial layout, pairings, blanks, mechanism positions and attempt outcomes. Separate observations from inferred rules or solutions; retain unresolved clues as open continuity.',
        'Style affects expression only; it cannot change fact selection, evidence, structure or safety rules.',
        buildWikiWritingLanguageGuard(language),
    ].join('\n')
    if (language === 'ja') return [
        '## 正本執筆ポリシー',
        resolveRisuBardWritingStyleInstruction(style, customStyle, language),
        '圧縮するときも原文にない行動対象や場所を補わない。時間的な前後を因果に変えない。事件当時の人物ごとの知識の境界を維持する。',
        'パズル、暗号、儀式、組み合わせ装置やルール基盤の手がかりは、観察された要素、順序、空間配置、ペア、空欄、装置の位置と試行結果を保存する。確定した観察と推論したルール・正解を分離し、未解決部分は連続性として残す。',
        'この文体ポリシーは表現形式にのみ適用し、事実の選択、根拠、構造および安全ルールを変更しない。',
        buildWikiWritingLanguageGuard(language),
    ].join('\n')
    return [
        '## 정본 집필 정책',
        '사건 이야기 요약과 정본 Markdown 본문은 한국어로 작성한다.',
        resolveRisuBardWritingStyleInstruction(style, customStyle),
        '압축할 때도 원문에 없는 행동 대상이나 장소를 보충하지 않는다. 시간적 선후를 인과로 바꾸지 않는다. 사건 당시 인물별 지식 경계를 유지한다.',
        '퍼즐, 암호, 의식, 조합 장치나 규칙 기반 단서는 관찰된 요소, 순서, 공간 배치, 짝, 빈칸, 장치 위치와 시도 결과를 보존한다. 확정 관찰과 추론한 규칙·정답을 분리하고 미해결 부분은 연속성으로 남긴다.',
        '이 문체 정책은 표현 형식에만 적용하며 사실 선택, 근거, 구조 및 안전 규칙을 변경하지 않는다.',
        buildWikiWritingLanguageGuard(language),
    ].join('\n')
}

export function buildRisuBardCanonicalWritingPolicy(
    style: unknown,
    customStyle: unknown,
    language: WikiWritingLanguage = 'ko'
): string {
    if (language === 'ja') return [
        buildRisuBardEventWritingPolicy(style, customStyle, language),
        '各キャラクター正本は、次のシーンで人物を動かすダイナミックロアブックとして書く。持続する正体・役割、性格、能力とルール、関係、知識の境界、目標、所持品と制約、開いた連続性を優先する。',
        '有用な場合は文書冒頭に自己完結的な `### 現在の状態` スナップショットを置くことを推奨するが、正確な節名は必須ではなく、なくても有効である。',
        '任意の `### 作中行動` または転換点マップには、元に戻しにくい、あるいは因果上重要な大きな転換点を約3〜6個だけ残し、ターンごとの行動記録を蓄積しない。',
        '転換点には正確な `[[イベント文書のタイトル]]` を接続する。詳細な過去の行動はイベント文書から検索し、時系列の細かい行為、対象、場所と根拠をキャラクター正本に複製しない。',
        '人物がイベントに参加したという理由だけでキャラクター正本を更新しない。持続するロアブックの事実または大きな転換点が生じた場合にのみ更新する。',
        'イベントは正確な過去の観察と行動を所有する。他の正本はその後も有効な現在の状態とルールのみを所有し、イベントの文や段落を複製しない。',
        '繰り返し登場する、または固有の持続ルールを持つ種族・生物・モンスターの種類は creature 正本として登録する。個別の遭遇や外見の違いは作らず、変種は共通種と異なる持続ルールがある場合にのみ分離する。',
        '名前付きの下位場所が独立した持続状態・構造・人物・秘密を持つか、繰り返し使われる舞台であれば、別の location 正本を作り、上位場所には短いリンク要約のみを置く。',
        '手がかりごとに正本を作らない。複数のイベントをまたぐ、または未解決のまま今後の判断に影響する調査の糸のみを一つの簡潔な other 正本として管理する。',
        '新しい事実が既存事実を置き換える場合、以前の状態を現在の事実のように併記しない。',
        '関係のない既存正本の事実は保存する。',
    ].join('\n')
    if (language === 'en') return [
        buildRisuBardEventWritingPolicy(style, customStyle, language),
        'Treat each character document as a dynamic lorebook entry: keep durable identity, role, traits, capabilities and rules, relationships, knowledge boundaries, goals, possessions, constraints, and open continuity that help the character operate in the next scene.',
        'A compact self-contained `### Current State` snapshot near the top is recommended when useful, but no exact heading is required and its absence is valid.',
        'An optional `### Story History` or turning-point map should contain about 3-6 major irreversible or causally useful transitions, not a turn-by-turn action log.',
        'Link exact [[event document titles]] from turning points. Retrieve exact chronology, actions, targets, locations, and evidence from event documents rather than copying those details into character canon.',
        'Do not update a character document merely because the character participated in an event. Update it only for a durable lorebook fact or a major transition.',
        'Events own exact historical observations and actions. Other canon owns durable current state and rules; do not copy event sentences or paragraphs into it.',
        'Register recurring species, creatures, and monster kinds as creature canon. Split a variant only for durable distinct rules, not an individual encounter or cosmetic difference.',
        'Give a named sublocation its own location canon when it has independent persistent state, structure, people, secrets, or repeated scene use; keep only a short link summary in its parent.',
        'Do not create canon for every clue. Keep one compact investigation thread in other canon only when clues cross events or remain unresolved and affect future decisions.',
        'When new facts replace old ones, do not present both states as current. Preserve unrelated established facts.',
    ].join('\n')
    return [
        buildRisuBardEventWritingPolicy(style, customStyle, language),
        '각 캐릭터 정본은 다음 장면에서 인물을 기동시키는 다이나믹 로어북으로 쓴다. 지속되는 정체성·역할, 성격, 능력과 규칙, 관계, 지식 경계, 목표, 소지품과 제약, 열린 연속성을 우선한다.',
        '유용할 때 문서 상단에 자족적인 `### 현재 상태` 스냅샷을 두는 것을 권장하지만 정확한 절 이름은 필수가 아니며 없어도 유효하다.',
        '선택적인 `### 작중 행적` 또는 전환점 맵은 되돌리기 어렵거나 인과상 중요한 큰 전환점 약 3~6개만 남기고 턴별 행동 기록을 누적하지 않는다.',
        '전환점에는 정확한 `[[사건 문서 제목]]`을 연결한다. 상세 과거 행적은 사건 문서에서 조회하며 시간순 세부 행위, 대상, 장소와 근거를 캐릭터 정본에 복사하지 않는다.',
        '인물이 사건에 참여했다는 이유만으로 캐릭터 정본을 갱신하지 않는다. 지속되는 로어북 사실이나 큰 전환점이 생긴 경우에만 갱신한다.',
        '사건은 정확한 과거 관찰과 행동을 소유한다. 다른 정본은 이후에도 유효한 현재 상태와 규칙만 소유하며 사건의 문장이나 문단을 복사하지 않는다.',
        '반복 등장하거나 고유한 지속 규칙이 있는 종족·생물·몬스터 종류는 creature 정본으로 등록한다. 개별 조우나 외형 차이는 만들지 않고 변종은 공통 종류와 다른 지속 규칙이 있을 때만 분리한다.',
        '이름 있는 하위 장소가 독립된 지속 상태·구조·인물·비밀을 가지거나 반복되는 사건 무대이면 별도 location 정본으로 만들고 상위 장소에는 짧은 링크 요약만 둔다.',
        '단서마다 정본을 만들지 않는다. 여러 사건을 연결하거나 해결되지 않아 향후 판단에 영향을 주는 조사 줄기만 하나의 간결한 other 정본으로 관리한다.',
        '새 사실이 기존 사실을 대체하면 이전 상태를 현재 사실처럼 병기하지 않는다.',
        '관련 없는 기존 정본 사실은 보존한다.',
    ].join('\n')
}
