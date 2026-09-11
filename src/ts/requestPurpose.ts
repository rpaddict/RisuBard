import type { RequestLogSource } from './requestLog'

export type RequestPurpose =
    | 'chat-response'
    | 'bardwiki-analysis'
    | 'bardwiki-bard-chan-rerank'
    | 'bardwiki-canonical-update'
    | 'bardwiki-admin'
    | 'persona-builder'
    | 'lore-builder'
    | 'bard-lore-analysis'

export const requestPurposeLabels: Record<RequestPurpose, string> = {
    'chat-response': '채팅 답변 생성',
    'bardwiki-analysis': 'BardWiki 의미 분석',
    'bardwiki-bard-chan-rerank': '바드쨩 검색 재정렬',
    'bardwiki-canonical-update': 'BardWiki 정본 갱신',
    'bardwiki-admin': 'BardWiki 관리자 명령',
    'persona-builder': '페르소나 빌더',
    'lore-builder': '로어 빌더',
    'bard-lore-analysis': '그리모어 메타데이터 분석',
}

export function defaultRequestPurpose(
    source: RequestLogSource,
): RequestPurpose | undefined {
    if (source === 'main') return 'chat-response'
    if (source === 'memory') return 'bardwiki-analysis'
    if (source === 'wiki-admin') return 'bardwiki-admin'
    return undefined
}

export function requestPurposeLabel(
    purpose: RequestPurpose | undefined,
    source: RequestLogSource,
): string {
    if (purpose) return requestPurposeLabels[purpose]
    if (source === 'main') return '채팅 답변 생성'
    if (source === 'memory') return 'BardWiki 작업 (세부 목적 미기록)'
    if (source === 'wiki-admin') return 'BardWiki 관리자 명령'
    return `기타 요청 (${source})`
}
