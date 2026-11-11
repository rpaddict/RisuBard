import {
    MEMORY_BUDGET_PRESET_IDS,
    MEMORY_BUDGET_PRESETS,
    type MemoryBudgetPreset,
    type MemoryBudgetPresetId,
} from './memoryBudgetPreset'
import type {
    ResolvedRisuBardChatSettings,
    RisuBardChatSettings,
} from './risuBardSettings'

interface StoryMessageLike {
    role: 'user' | 'char'
    data: string
    disabled?: boolean | 'allBefore'
    isComment?: boolean
}

export interface RisuBardChatProfile {
    messageCount: number
    turnCount: number
    averageCharacters: number
}

export const risuBardCurrentChatSettingKeys = [
    'risuBardDynamicMemoryMode',
    'risuBardDynamicMemoryMaximumTokens',
    'risuBardModelMode',
    'showRequestStatus',
    'risuBardInquiryTargetTokenBudget',
    'risuBardInquiryEventTokenBudget',
    'risuBardInquirySourceTokenBudget',
    'risuBardInquiryMaximumTokenBudget',
    'risuBardInquiryTimeoutMs',
    'risuBardHistoricalSourceMatchLimit',
    'risuBardSourceRerank',
    'risuBardAnalysisTokenLimit',
    'risuBardAdditionalSearchLimit',
    'risuBardCanonicalTargetLimit',
    'risuBardRecentMessageCount',
    'risuBardResponseMessageCount',
    'risuBardResponseExcludeUserMessages',
    'risuBardAnalysisExcludeUserMessages',
    'risuBardAnalysisLoreTokenLimit',
    'risuBardAnalysisLoreIncludeAlwaysActive',
    'risuBardAnalysisLoreExcludeWords',
    'risuBardCanonicalWritingStyle',
    'risuBardCanonicalCustomStyle',
    'risuBardWikiWritingLanguage',
] as const satisfies readonly (keyof RisuBardChatSettings)[]

export type RisuBardChatSettingKey =
    typeof risuBardCurrentChatSettingKeys[number]

/** The setting keys plus the memory budget preset, which only has help text and no stored value of its own. */
export type RisuBardChatSettingHelpKey =
    RisuBardChatSettingKey | 'risuBardMemoryBudgetPreset'

const numberFormat = new Intl.NumberFormat('ko-KR')

const presetValues = (pick: (preset: MemoryBudgetPreset) => number) =>
    MEMORY_BUDGET_PRESET_IDS.map((id) =>
        `${MEMORY_BUDGET_PRESETS[id].label} ${numberFormat.format(pick(MEMORY_BUDGET_PRESETS[id]))}`
    ).join(', ')

export function measureRisuBardChat(
    messages: readonly StoryMessageLike[],
): RisuBardChatProfile {
    const active = messages.filter((message) =>
        !message.disabled && !message.isComment && message.data.length > 0
    )
    const characters = active.reduce(
        (total, message) => total + message.data.length,
        0,
    )
    return {
        messageCount: active.length,
        turnCount: active.filter((message) => message.role === 'char').length,
        averageCharacters: active.length > 0
            ? Math.round(characters / active.length)
            : 0,
    }
}

export function formatRisuBardChatProfile(
    profile: RisuBardChatProfile,
): string {
    return `${numberFormat.format(profile.turnCount)}턴, 메시지 평균 ${numberFormat.format(profile.averageCharacters)}자`
}

function recommendation(
    key: RisuBardChatSettingHelpKey,
    profile: RisuBardChatProfile,
): string {
    const longChat = profile.turnCount >= 100
    const mediumChat = profile.turnCount >= 40
    const veryLongMessage = profile.averageCharacters >= 2_000
    const longMessage = profile.averageCharacters >= 1_000

    switch (key) {
        case 'risuBardMemoryBudgetPreset': {
            const line = (id: MemoryBudgetPresetId, text: string) => {
                const preset = MEMORY_BUDGET_PRESETS[id]
                return `${preset.label}(검색 목표 ${numberFormat.format(preset.target)}, 최대 ${numberFormat.format(preset.maximum)}): ${text}`
            }
            return [
                line('economy', '주요 인물 카드 두 장과 약간의 다른 기억만 넣어 응답마다 쓰는 토큰을 아낍니다.'),
                line('standard', '기본값입니다. 주요 인물 카드 두 장에 다른 기억과 사건 자료를 알맞게 더합니다.'),
                line('generous', '인물과 사건이 많은 장기 챗에서 기억을 더 많이 넣고 챗이 길어질수록 한도도 더 늘립니다. 토큰을 가장 많이 씁니다.'),
                '값을 하나라도 직접 고치면 사용자 지정이 됩니다.',
            ].join('\n')
        }
        case 'risuBardDynamicMemoryMode':
            return '절약형, 균형형, 회수 우선형 순으로 검색 한도가 더 많이 늘어납니다. 절약과 보통 프리셋은 절약형, 넉넉 프리셋은 균형형입니다.'
        case 'risuBardDynamicMemoryMaximumTokens':
            return '장기기억 동적 한도로 늘어나는 검색 최대 토큰의 상한입니다.'
        case 'risuBardModelMode':
            return '비용을 아끼려면 보조 모델, 복잡한 장기 챗에서 검색 판단이 자주 빗나가면 메인 모델을 권장합니다.'
        case 'showRequestStatus':
            return '토큰을 쓰지 않으므로 켜기를 권장합니다. 요청마다 실제로 들어간 BardWiki 문서를 확인할 수 있습니다.'
        case 'risuBardInquiryTargetTokenBudget':
            return `프리셋 값은 ${presetValues(preset => preset.target)}입니다. 기본값은 보통이며, 등장인물이 많은 챗은 넉넉을 고르세요.`
        case 'risuBardInquiryEventTokenBudget':
            return `프리셋 값은 ${presetValues(preset => preset.events)}입니다. 사건이 촘촘한 장기 챗은 넉넉을 고르세요.`
        case 'risuBardInquirySourceTokenBudget':
            return `프리셋 값은 ${presetValues(preset => preset.perSource)}입니다. 인물 카드 하나는 이 값의 80%까지 유지하므로, 카드가 긴 위키는 넉넉을 고르세요.`
        case 'risuBardInquiryMaximumTokenBudget':
            return `프리셋 값은 ${presetValues(preset => preset.maximum)}입니다. 검색 목표 토큰과 사건 검색 토큰의 합에 최근 흐름 400을 더한 값보다 작게 두지 마세요.`
        case 'risuBardInquiryTimeoutMs':
            return '토큰에는 영향이 없으므로 보통 최대값인 10,000ms를 그대로 두고, 답변 시작이 너무 늦을 때만 줄이세요.'
        case 'risuBardHistoricalSourceMatchLimit':
            return `현재 규모에는 ${longChat ? '8~12' : mediumChat ? '6~8' : '4~6'}개를 권장합니다. 긴 메시지가 많아 토큰이 빠듯하면 먼저 이 수를 줄이세요.`
        case 'risuBardSourceRerank':
            return '과거 장면의 수량, 이름, 대사, 순서를 자주 틀리면 켜기를 권장합니다. 답변마다 작업 모델 요청이 한 번 늘고, 입력은 원문 후보 16개(약 1만~2만 토큰)입니다.'
        case 'risuBardAnalysisTokenLimit':
            return `현재 규모에는 ${longChat || longMessage ? '8,192' : '6,144'}를 권장합니다. 짧은 챗은 4,096~6,144, 100턴 이상 또는 평균 1,000자 이상은 8,192부터 시작하세요.`
        case 'risuBardAdditionalSearchLimit':
            return `현재 규모에는 ${longChat || longMessage ? '1' : '0~1'}회를 권장합니다. 2회 이상은 누락이 반복될 때만 사용하세요.`
        case 'risuBardCanonicalTargetLimit':
            return `현재 규모에는 ${longChat ? '8~12' : '6~8'}개를 권장합니다. 한 메시지가 1,000자 이상이면 한 번에 너무 많이 고치지 않도록 6~8개가 안전합니다.`
        case 'risuBardRecentMessageCount':
            return veryLongMessage
                ? '분석 입력은 3~4개를 권장합니다. 평균 2,000자 이상에서는 더 늘리기보다 위키 검색에 맡기세요.'
                : longMessage
                    ? '분석 입력은 4~6개를 권장합니다. 평균 1,000자 이상이면 4개부터 시작하세요.'
                    : `분석 입력은 ${longChat ? '6~8' : '8~12'}개를 권장합니다. 챗이 길수록 오래된 사실은 위키로 회수합니다.`
        case 'risuBardResponseMessageCount':
            return veryLongMessage
                ? '기본 절약값은 4개입니다. 평균 2,000자 이상이면 2개까지 줄여도 좋습니다.'
                : longMessage
                    ? '기본 절약값은 4개입니다. 평균 1,000자 이상이면 2~3개로 줄여도 좋습니다.'
                    : '기본 절약값은 4개입니다. 짧은 메시지에서 바로 앞 대화 연결이 부족할 때만 6~8개로 늘리세요.'
        case 'risuBardResponseExcludeUserMessages':
            return longMessage
                ? '긴 사용자 메시지가 이미 분석과 위키에 반영된다면 꺼서 토큰을 줄일 수 있습니다. 지시나 대사를 그대로 이어야 하면 켜 두세요.'
                : '보통은 켜 두기를 권장합니다. 사용자 발화를 빼도 맥락이 유지되는 장기 챗에서만 끄세요.'
        case 'risuBardAnalysisExcludeUserMessages':
            return longMessage
                ? '사용자 입력이 지시문 위주이고 AI 응답만 사실로 남기려면 끄기를 권장합니다. 사용자 대사와 행동도 서사의 일부라면 켜 두세요.'
                : '보통은 켜 두기를 권장합니다. 사용자 메시지를 사건 근거로 삼지 않는 챗에서만 끄세요.'
        case 'risuBardAnalysisLoreTokenLimit':
            return '기본값 1,000을 권장합니다. 원작과 설정이 다른 봇에서 인물 정보가 자주 틀리면 2,000~3,000으로 늘리고, 토큰을 아끼려면 0으로 끄세요.'
        case 'risuBardAnalysisLoreIncludeAlwaysActive':
            return '보통은 빼 두기를 권장합니다. 항상 켜진 항목에는 세계관 전체 설명이나 에셋 목록처럼 긴 내용이 많습니다. 핵심 인물 설정이 항상 켜진 항목에만 있을 때만 켜세요.'
        case 'risuBardAnalysisLoreExcludeWords':
            return '기본값은 이미지 에셋 문법(<img, {{asset::, {{img::, {{image::)입니다. 봇마다 에셋 항목에 공통으로 들어가는 표시가 있다면 그 단어를 한 줄에 하나씩 더하세요.'
        case 'risuBardCanonicalWritingStyle':
            return '‘기본’을 권장합니다. 꾸밈과 줄거리 서술은 줄이고 숫자, 이름, 물건, 핵심 대사처럼 나중에 물어볼 만한 사실을 남깁니다. 직접 규칙을 쓰려면 ‘사용자 지정’을 고르세요.'
        case 'risuBardCanonicalCustomStyle':
            return '1~3개의 짧고 구체적인 규칙을 권장합니다. 긴 지시문은 모든 정본 갱신에 반복되어 토큰을 늘립니다.'
        case 'risuBardWikiWritingLanguage':
            return '챗 본문과 같은 언어를 권장합니다. 장기 챗에서는 중간에 언어를 바꾸지 않아야 같은 인물과 사건이 안정적으로 연결됩니다.'
    }
}

const roles: Record<RisuBardChatSettingHelpKey, string> = {
    risuBardMemoryBudgetPreset: '검색 목표, 사건 검색, 자료별 검색, 검색 최대 토큰과 장기기억 동적 한도를 한 번에 맞춥니다. 사용자 지정을 고르면 여섯 값을 따로 볼 수 있습니다.',
    risuBardDynamicMemoryMode: '활성 AI 응답의 누적 본문 길이에 따라 검색 목표 토큰, 사건 검색 토큰, 검색 최대 토큰과 위키 분석 최대 길이를 늘립니다. 증가 폭이 점차 줄고 50만 자에서 멈춥니다.',
    risuBardDynamicMemoryMaximumTokens: '검색 최대 토큰의 동적 증가 상한입니다. 기본값이 상한보다 크면 기본값을 유지하며, 위키 분석 최대 길이는 모드별 최대 증가율을 따릅니다.',
    risuBardModelMode: 'BardWiki 조회와 분석 작업에 사용할 모델 경로를 정합니다.',
    showRequestStatus: '응답 요청에 포함된 위키 컨텍스트와 처리 상태를 화면에 표시합니다.',
    risuBardInquiryTargetTokenBudget: '일반 위키 검색 결과가 목표로 삼는 전체 토큰 양입니다.',
    risuBardInquiryEventTokenBudget: '현재 장면과 관련된 사건 문서에 배정할 토큰 양입니다.',
    risuBardInquirySourceTokenBudget: '한 자료가 검색 결과를 독점하지 않도록 자료 하나당 허용할 토큰 양입니다.',
    risuBardInquiryMaximumTokenBudget: '모든 위키 검색 결과를 합친 절대 토큰 상한입니다.',
    risuBardInquiryTimeoutMs: '위키 조회를 기다리는 최대 시간입니다. 시간이 지나면 가능한 결과로 계속 진행합니다.',
    risuBardHistoricalSourceMatchLimit: '분석 때 다시 확인할 과거 원문 후보의 최대 개수입니다.',
    risuBardSourceRerank: '켜면 답변 전에 작업 모델(또는 공통 설정에서 고른 리랭커 API)이 과거 원문 후보를 질문에 비추어 읽고, 묻는 사실을 담은 원문을 골라 위키 문서보다 먼저 넣습니다. 고를 원문이 없거나 요청이 실패하면 기존 검색 결과를 그대로 씁니다.',
    risuBardAnalysisTokenLimit: '위키를 갱신하는 분석 단계가 사용할 수 있는 최대 출력 토큰입니다. 정본 절에는 4,000자 고정 상한이 없습니다. 공급자가 출력 한도 종료를 보고하거나 응답 구조가 불완전하면 기존 문서에 저장하지 않고 재시도합니다.',
    risuBardAdditionalSearchLimit: '첫 분석에서 근거가 부족할 때 위키를 다시 찾을 수 있는 최대 횟수입니다.',
    risuBardCanonicalTargetLimit: '한 번의 분석에서 새로 만들거나 고칠 위키 문서(정본)의 최대 개수입니다.',
    risuBardRecentMessageCount: '위키 분석에 원문 그대로 넣는 최근 AI 응답 수입니다. 분석에 사용자 메시지 넣기가 켜져 있으면 그 응답들 사이의 사용자 메시지도 함께 읽습니다.',
    risuBardResponseMessageCount: '최종 답변 모델에 원문 그대로 넣는 최근 AI 응답 수입니다. 답변에 사용자 메시지 넣기가 켜져 있으면 그 응답들 사이의 사용자 메시지도 함께 들어갑니다.',
    risuBardResponseExcludeUserMessages: '켜면 최종 답변에 넣는 최근 원문에 사용자 메시지도 넣습니다. 끄면 AI 응답만 넣으며, 지금 보내는 요청은 항상 들어갑니다.',
    risuBardAnalysisExcludeUserMessages: '켜면 위키 분석이 읽는 확정 턴과 최근 원문에 사용자 메시지도 넣습니다. 끄면 AI 응답만 사건 근거로 삼습니다.',
    risuBardAnalysisLoreTokenLimit: '위키 분석이 참고할 로어북 본문의 최대 토큰입니다. 분석한 턴까지의 채팅으로 켜지는 로어북 항목을 조건문과 변수까지 평가해 우선순위 순으로 넣고, 한도를 넘는 항목은 통째로 뺍니다. 0이면 로어북을 넣지 않습니다. 로어북은 인물과 설정을 확인하는 참고 자료로만 쓰고, 채팅에 나오지 않은 비밀은 위키에 적지 않습니다.',
    risuBardAnalysisLoreIncludeAlwaysActive: '켜면 항상 켜진 로어북 항목도 위키 분석에 넣습니다. 끄면 키워드로 켜진 항목만 넣습니다.',
    risuBardAnalysisLoreExcludeWords: '한 줄에 하나씩 적은 단어가 로어북 항목의 제목이나 본문 원문에 들어 있으면 그 항목을 위키 분석에 넣지 않습니다. 대소문자는 구분하지 않습니다. 모두 지우면 아무것도 빼지 않습니다.',
    risuBardCanonicalWritingStyle: '사건 요약과 정본 문서를 어떤 문체로 쓸지 정합니다.',
    risuBardCanonicalCustomStyle: '사용자 지정 정본 문체일 때 반복 적용할 짧은 작성 규칙입니다.',
    risuBardWikiWritingLanguage: 'BardWiki 정본 문서가 사용할 언어를 정합니다.',
}

export function buildRisuBardChatSettingHelp(
    key: RisuBardChatSettingHelpKey,
    profile: RisuBardChatProfile,
): string {
    return [
        `역할: ${roles[key]}`,
        `추천: ${recommendation(key, profile)}`,
        `현재 챗: ${formatRisuBardChatProfile(profile)}`,
    ].join('\n')
}

export function applyCurrentRisuBardSettingsToGlobal(
    global: RisuBardChatSettings,
    current: ResolvedRisuBardChatSettings,
): void {
    const target = global as Record<string, unknown>
    for (const key of risuBardCurrentChatSettingKeys) {
        target[key] = current[key]
    }
}
