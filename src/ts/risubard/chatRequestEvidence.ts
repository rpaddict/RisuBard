import {
    fetchRequestLogPage,
    type RequestLogEntry,
    type RequestLogRoute,
    type RequestLogSource,
} from 'src/ts/requestLog'
import { requestPurposeLabel, type RequestPurpose } from 'src/ts/requestPurpose'
import {
    reconcileInjectionManifest,
    type RequestInjectionKind,
    type RequestInjectionManifest,
} from 'src/ts/status/requestStatus'
import type { Message } from 'src/ts/storage/database.svelte'
import { formatWikiInquiryDiagnostic, type WikiInquiryDiagnostic } from './wikiInquiryDiagnostics'

export interface ChatRequestEvidenceEntry {
    id: number
    timestamp: string
    generationId?: string
    source: RequestLogSource
    purpose?: RequestPurpose
    model?: string
    provider?: string
    outcome: 'done' | 'response-received' | 'failed' | 'aborted'
    status?: number
    route?: RequestLogRoute
    streaming: boolean
    durationMs?: number
    firstTokenMs?: number
    inputTokens?: number
    outputTokens?: number
    cachedTokens?: number
    reasoningTokens?: number
    injectionManifest?: RequestInjectionManifest
    selectedHistoryMessageCount?: number
    wikiInquiry?: WikiInquiryDiagnostic
    failureCategory?: 'timeout' | 'rate-limit' | 'authentication'
        | 'server' | 'network' | 'format' | 'invalid-request' | 'provider'
}

export interface ChatRequestEvidence {
    schemaVersion: 1
    generatedAt: string
    timeZone?: string
    chatId: string
    requestCount: number
    totals: {
        inputTokens: number
        outputTokens: number
        cachedTokens: number
        reasoningTokens: number
    }
    retainedAssistant?: {
        responseCount: number
        bodyTokens: number
    }
    requests: ChatRequestEvidenceEntry[]
}

export interface LegacyChatGenerationEvidence {
    timestamp?: number
    generationId?: string
    model?: string
    inputTokens?: number
    outputTokens?: number
    durationMs?: number
    wikiTokens?: number
}

const injectionLabels: Record<RequestInjectionKind, string> = {
    systemPrompt: '주입 컨텍스트',
    jailbreak: '탈옥 프롬프트',
    globalNote: '전역 메모',
    authorNote: '작가 노트',
    character: '캐릭터',
    persona: '페르소나',
    lorebook: '로어북',
    grimoire: '그리모어',
    grimoireRequired: '그리모어(필수)',
    wiki: 'BardWiki',
    memory: '메모리',
    exampleDialogue: '예시 대화',
    chatHistory: '채팅 기록',
    instruction: '추가 지침',
    tool: '도구',
    other: '기타',
}

export interface DisplayInjectionItem {
    kind: RequestInjectionKind
    label: string
    tokens: number
    details?: Array<{ label: string, tokens: number }>
}

interface ChatRange {
    start: number
    end: number
}

function parseChatRange(name: string | undefined): ChatRange | undefined {
    const match = name?.match(/^\d+개 \((\d+)(?:~(\d+))?\)$/)
    if (!match) return undefined
    const start = Number(match[1])
    const end = Number(match[2] ?? match[1])
    return Number.isSafeInteger(start) && Number.isSafeInteger(end) && start > 0 && end >= start
        ? { start, end }
        : undefined
}

function mergeChatRanges(ranges: ChatRange[]): ChatRange[] {
    const sorted = ranges.slice().sort((a, b) => a.start - b.start || a.end - b.end)
    const merged: ChatRange[] = []
    for (const range of sorted) {
        const previous = merged.at(-1)
        if (previous && range.start <= previous.end + 1) {
            previous.end = Math.max(previous.end, range.end)
        } else {
            merged.push({ ...range })
        }
    }
    return merged
}

function chatHistoryDisplay(items: RequestInjectionManifest['items']): DisplayInjectionItem {
    const ranges = items.map((item) => parseChatRange(item.name))
    const tokens = items.reduce((total, item) => total + item.tokens, 0)
    if (ranges.every((range): range is ChatRange => range !== undefined)) {
        const merged = mergeChatRanges(ranges)
        const count = merged.reduce((total, range) => total + range.end - range.start + 1, 0)
        const rangeLabel = merged.map((range) => range.start === range.end
            ? String(range.start)
            : `${range.start}~${range.end}`
        ).join(', ')
        return {
            kind: 'chatHistory',
            label: `채팅 기록 · ${count}개 (${rangeLabel})`,
            tokens,
            ...(items.length > 1 ? {
                details: items.map((item, index) => {
                    const range = ranges[index]
                    const itemCount = range.end - range.start + 1
                    const itemRange = range.start === range.end
                        ? String(range.start)
                        : `${range.start}~${range.end}`
                    return {
                        label: `${itemCount}개 (${itemRange})`,
                        tokens: item.tokens,
                    }
                }),
            } : {}),
        }
    }
    return {
        kind: 'chatHistory',
        label: items.length === 1 && items[0].name
            ? `채팅 기록 · ${items[0].name}`
            : `채팅 기록 · ${items.length}개 항목`,
        tokens,
    }
}

/** Body-free, deterministic projection shared by the activity UI and export. */
export function groupInjectionManifestItems(
    manifest: RequestInjectionManifest
): DisplayInjectionItem[] {
    const instructions = manifest.items.filter((item) => item.kind === 'instruction')
    const chatHistory = manifest.items.filter((item) => item.kind === 'chatHistory')
    const result: DisplayInjectionItem[] = []
    let emittedInstructions = false
    let emittedChatHistory = false

    for (const item of manifest.items) {
        if (item.kind === 'instruction') {
            if (emittedInstructions) continue
            emittedInstructions = true
            result.push({
                kind: 'instruction',
                label: instructions.length === 1 && instructions[0].name
                    ? `추가 지침 · ${instructions[0].name}`
                    : `추가 지침 · ${instructions.length}개 항목`,
                tokens: instructions.reduce((total, source) => total + source.tokens, 0),
                ...(instructions.length > 1 ? {
                    details: instructions.map((source, index) => ({
                        label: source.name || `이름 없는 지침 ${index + 1}`,
                        tokens: source.tokens,
                    })),
                } : {}),
            })
            continue
        }
        if (item.kind === 'chatHistory') {
            if (emittedChatHistory) continue
            emittedChatHistory = true
            result.push(chatHistoryDisplay(chatHistory))
            continue
        }
        const label = item.kind === 'other' && item.name
            ? item.name
            : item.name
                ? `${injectionLabels[item.kind]} · ${item.name}`
                : injectionLabels[item.kind]
        result.push({ kind: item.kind, label, tokens: item.tokens })
    }
    return result
}

const number = (value: number | undefined) => value?.toLocaleString('ko-KR') ?? '확인 불가'

const failureLabels: Record<
    NonNullable<ChatRequestEvidenceEntry['failureCategory']>,
    string
> = {
    timeout: '타임아웃',
    'rate-limit': '호출 제한',
    authentication: '인증 오류',
    server: '공급자 서버 오류',
    network: '네트워크 오류',
    format: '구조화 응답 검증 오류',
    'invalid-request': '요청 인자 거부',
    provider: '공급자 응답 오류',
}

export function chatRequestFailureLabel(
    category: NonNullable<ChatRequestEvidenceEntry['failureCategory']>
): string {
    return failureLabels[category]
}

function localTimeZone(): string {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
}

function safeTimeZone(value: string | undefined): string {
    const candidate = value || localTimeZone()
    try {
        new Intl.DateTimeFormat('en', { timeZone: candidate }).format(0)
        return candidate
    }
    catch {
        return 'UTC'
    }
}

function localTimestamp(value: string, timeZone: string): string {
    const parts = new Intl.DateTimeFormat('en', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
    }).formatToParts(new Date(value))
    const part = (type: Intl.DateTimeFormatPartTypes) =>
        parts.find((item) => item.type === type)?.value ?? '00'
    return `${part('year')}-${part('month')}-${part('day')} ${part('hour')}:${part('minute')}:${part('second')}`
}

function timeZoneOffset(value: string, timeZone: string): string {
    const name = new Intl.DateTimeFormat('en', {
        timeZone,
        timeZoneName: 'longOffset',
    }).formatToParts(new Date(value)).find(
        (item) => item.type === 'timeZoneName'
    )?.value ?? 'GMT'
    return name === 'GMT' ? 'UTC+00:00' : name.replace('GMT', 'UTC')
}

function sum(entries: RequestLogEntry[], key: 'inputTokens' | 'outputTokens' | 'cachedTokens' | 'reasoningTokens') {
    return entries.reduce((total, entry) => total + Math.max(0, entry[key] ?? 0), 0)
}

function requestFailureCategory(
    entry: RequestLogEntry
): ChatRequestEvidenceEntry['failureCategory'] | undefined {
    if (entry.success && !entry.aborted) return undefined
    const message = [entry.errorMessage, providerResponseError(entry.responseBody)]
        .filter(Boolean)
        .join(' ')
        .toLocaleLowerCase()
    if (entry.status === 408 || entry.status === 504
        || /timed?\s*out|timeout|시간.*초과/u.test(message)) return 'timeout'
    if (entry.status === 429
        || /rate.?limit|resource exhausted|quota/u.test(message)) return 'rate-limit'
    if (entry.status === 401 || entry.status === 403
        || /unauthor|forbidden|authentication|api.?key/u.test(message)) {
        return 'authentication'
    }
    if (/structured.?output.*validation|json.?schema.*validation|response.?schema.*validation/u.test(message)) {
        return 'format'
    }
    if (/\binvalid[_ ]argument\b|request contains an invalid argument/u.test(message)) {
        return 'invalid-request'
    }
    if ((entry.status ?? 0) >= 500
        || /bad gateway|service unavailable|internal server/u.test(message)) {
        return 'server'
    }
    if (/network|fetch|econn|enotfound|socket|connection|proxy/u.test(message)) {
        return 'network'
    }
    return 'provider'
}

function providerResponseError(responseBody: string | undefined): string {
    if (!responseBody) return ''
    try {
        const parsed = JSON.parse(responseBody) as unknown
        if (!parsed || typeof parsed !== 'object') return ''
        const error = (parsed as { error?: unknown }).error
        if (!error || typeof error !== 'object') return ''
        const record = error as { status?: unknown, message?: unknown }
        return [record.status, record.message]
            .filter((value): value is string => typeof value === 'string')
            .join(' ')
    }
    catch {
        return ''
    }
}

function requestOutcome(entry: RequestLogEntry): ChatRequestEvidenceEntry['outcome'] {
    if (entry.aborted) return 'aborted'
    if (!entry.success) return 'failed'
    return entry.source === 'memory'
        && ['bardwiki-analysis', 'bardwiki-canonical-update', 'bardwiki-canonical-maintenance'].includes(entry.purpose ?? '')
        ? 'response-received'
        : 'done'
}

export function buildChatRequestEvidence(
    chatId: string,
    entries: RequestLogEntry[],
    generatedAt = Date.now(),
    timeZone = localTimeZone(),
): ChatRequestEvidence {
    const requests = entries.map((entry): ChatRequestEvidenceEntry => ({
        id: entry.id,
        timestamp: new Date(entry.timestamp).toISOString(),
        ...(entry.generationId || (entry.source === 'main' && entry.chatId)
            ? { generationId: entry.generationId ?? entry.chatId }
            : {}),
        source: entry.source,
        ...(entry.purpose ? { purpose: entry.purpose } : {}),
        ...(entry.model ? { model: entry.model } : {}),
        ...(entry.provider ? { provider: entry.provider } : {}),
        outcome: requestOutcome(entry),
        ...(entry.status !== undefined ? { status: entry.status } : {}),
        ...(entry.route ? { route: entry.route } : {}),
        streaming: entry.streaming,
        ...(entry.durationMs !== undefined ? { durationMs: entry.durationMs } : {}),
        ...(entry.firstTokenMs !== undefined ? { firstTokenMs: entry.firstTokenMs } : {}),
        ...(entry.inputTokens !== undefined ? { inputTokens: entry.inputTokens } : {}),
        ...(entry.outputTokens !== undefined ? { outputTokens: entry.outputTokens } : {}),
        ...(entry.cachedTokens !== undefined ? { cachedTokens: entry.cachedTokens } : {}),
        ...(entry.reasoningTokens !== undefined ? { reasoningTokens: entry.reasoningTokens } : {}),
        ...(requestFailureCategory(entry) ? {
            failureCategory: requestFailureCategory(entry),
        } : {}),
        ...(entry.injectionManifest ? {
            injectionManifest: reconcileInjectionManifest(
                entry.injectionManifest,
                entry.inputTokens,
            ),
        } : {}),
    }))
    return {
        schemaVersion: 1,
        generatedAt: new Date(generatedAt).toISOString(),
        timeZone: safeTimeZone(timeZone),
        chatId,
        requestCount: requests.length,
        totals: {
            inputTokens: sum(entries, 'inputTokens'),
            outputTokens: sum(entries, 'outputTokens'),
            cachedTokens: sum(entries, 'cachedTokens'),
            reasoningTokens: sum(entries, 'reasoningTokens'),
        },
        requests,
    }
}

/**
 * Older/plugin generations predate persisted request rows. Keep their
 * body-free message metadata exportable while stating that the detailed
 * input composition was not retained.
 */
export function buildLegacyChatRequestEvidence(
    chatId: string,
    entries: LegacyChatGenerationEvidence[],
    generatedAt = Date.now(),
    timeZone = localTimeZone(),
): ChatRequestEvidence {
    const requests: ChatRequestEvidenceEntry[] = entries.map((entry, index) => {
        const inputTokens = entry.inputTokens === undefined
            ? undefined
            : Math.max(0, Math.round(entry.inputTokens))
        const wikiTokens = Math.min(
            inputTokens ?? 0,
            Math.max(0, Math.round(entry.wikiTokens ?? 0)),
        )
        const items: RequestInjectionManifest['items'] = []
        if (wikiTokens > 0) {
            items.push({
                kind: 'wiki',
                name: '선택된 BardWiki',
                tokens: wikiTokens,
            })
        }
        if (inputTokens !== undefined && inputTokens - wikiTokens > 0) {
            items.push({
                kind: 'other',
                name: '세부 구성이 보존되지 않은 입력',
                tokens: inputTokens - wikiTokens,
            })
        }
        return {
            id: -(index + 1),
            timestamp: new Date(entry.timestamp ?? generatedAt).toISOString(),
            ...(entry.generationId ? { generationId: entry.generationId } : {}),
            source: 'main',
            purpose: 'chat-response',
            ...(entry.model ? { model: entry.model } : {}),
            outcome: 'done',
            streaming: false,
            ...(entry.durationMs !== undefined
                ? { durationMs: Math.max(0, Math.round(entry.durationMs)) }
                : {}),
            ...(inputTokens !== undefined ? { inputTokens } : {}),
            ...(entry.outputTokens !== undefined ? {
                outputTokens: Math.max(0, Math.round(entry.outputTokens)),
            } : {}),
            ...(inputTokens !== undefined ? {
                injectionManifest: {
                    totalTokens: inputTokens,
                    estimated: true,
                    items,
                },
            } : {}),
        }
    })
    return {
        schemaVersion: 1,
        generatedAt: new Date(generatedAt).toISOString(),
        timeZone: safeTimeZone(timeZone),
        chatId,
        requestCount: requests.length,
        totals: {
            inputTokens: requests.reduce((sum, entry) => sum + (entry.inputTokens ?? 0), 0),
            outputTokens: requests.reduce((sum, entry) => sum + (entry.outputTokens ?? 0), 0),
            cachedTokens: 0,
            reasoningTokens: 0,
        },
        requests,
    }
}

async function countRetainedTextTokens(text: string): Promise<number> {
    const { encodeWithTokenizer } = await import('src/ts/tokenizer')
    return (await encodeWithTokenizer(text, 'tik')).length
}

/** Join saved response diagnostics by generation, including after reopening the log. */
export function attachWikiInquiryDiagnostics(
    requests: ChatRequestEvidenceEntry[], messages: readonly Message[],
): ChatRequestEvidenceEntry[] {
    const diagnostics = new Map<string, WikiInquiryDiagnostic>()
    for (const message of messages) {
        const diagnostic = message.generationInfo?.risuBardContext?.wikiInquiry
        if (message.role !== 'char' || !diagnostic) continue
        if (message.chatId) diagnostics.set(message.chatId, diagnostic)
        if (message.generationInfo?.generationId) diagnostics.set(message.generationInfo.generationId, diagnostic)
    }
    return requests.map(request => {
        const diagnostic = request.source === 'main' && request.generationId
            ? diagnostics.get(request.generationId) : undefined
        return diagnostic ? { ...request, wikiInquiry: diagnostic } : request
    })
}

/** Adds current-chat totals without counting user text or discarded swipes. */
export async function addRetainedAssistantSummary(
    evidence: ChatRequestEvidence,
    messages: readonly Message[],
    countText: (text: string) => Promise<number> = countRetainedTextTokens,
): Promise<ChatRequestEvidence> {
    const retained = messages.filter(
        (message) => message.role === 'char' && !message.isComment
    )
    const bodyTokens = (await Promise.all(
        retained.map((message) => countText(message.data))
    )).reduce((total, tokens) => total + Math.max(0, Math.round(tokens)), 0)
    const byGenerationId = new Map<string, Message>()
    for (const message of retained) {
        if (message.chatId) byGenerationId.set(message.chatId, message)
        if (message.generationInfo?.generationId) {
            byGenerationId.set(message.generationInfo.generationId, message)
        }
    }
    return {
        ...evidence,
        retainedAssistant: {
            responseCount: retained.length,
            bodyTokens,
        },
        requests: attachWikiInquiryDiagnostics(evidence.requests, messages).map((request) => {
            const recentMessages = request.generationId
                ? byGenerationId.get(request.generationId)
                    ?.generationInfo?.risuBardContext?.recentMessages
                : undefined
            return recentMessages
                ? { ...request, selectedHistoryMessageCount: recentMessages.length }
                : request
        }),
    }
}

function durationLabel(ms: number | undefined): string {
    if (ms === undefined) return '확인 불가'
    return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}초`
}

function escapeTable(value: string | undefined): string {
    return (value ?? '확인 불가').replaceAll('|', '\\|').replaceAll('\n', ' ')
}

export function formatChatRequestEvidenceMarkdown(evidence: ChatRequestEvidence): string {
    const timeZone = safeTimeZone(evidence.timeZone)
    const lines = [
        '# RisuBard 채팅 요청 증거 보고서',
        '',
        `- 표시 시간대: ${timeZone} (${timeZoneOffset(evidence.generatedAt, timeZone)})`,
        `- 생성 시각: ${localTimestamp(evidence.generatedAt, timeZone)}`,
        `- 채팅 ID: \`${evidence.chatId}\``,
        `- 요청 수: ${evidence.requestCount.toLocaleString('ko-KR')}`,
        `- 총 입력 토큰: ${evidence.totals.inputTokens.toLocaleString('ko-KR')}`,
        `- 총 출력 토큰: ${evidence.totals.outputTokens.toLocaleString('ko-KR')}`,
        ...(evidence.retainedAssistant ? [
            `- 리롤 제외 누적 assistant 답변 수: ${evidence.retainedAssistant.responseCount.toLocaleString('ko-KR')}`,
            `- 리롤 제외 누적 assistant 본문 토큰: ${evidence.retainedAssistant.bodyTokens.toLocaleString('ko-KR')}`,
        ] : []),
        '',
        '> 이 보고서는 요청 메타데이터만 포함합니다. 프롬프트, 응답 본문, 헤더와 인증 정보는 제외됩니다.',
    ]

    for (const request of evidence.requests) {
        const requestHeading = request.id >= 0
            ? `요청 #${request.id}`
            : `레거시 요청 ${Math.abs(request.id)}`
        lines.push(
            '',
            `## ${requestHeading} · ${requestPurposeLabel(request.purpose, request.source)}`,
            '',
            '| 항목 | 값 |',
            '| --- | --- |',
            `| 시각 | ${localTimestamp(request.timestamp, timeZone)} |`,
            `| 생성 ID | ${escapeTable(request.generationId)} |`,
            `| 요청 목적 | ${requestPurposeLabel(request.purpose, request.source)} |`,
            `| 로그 종류 | ${request.source} |`,
            `| 모델 | ${escapeTable(request.model)} |`,
            `| 공급자 | ${escapeTable(request.provider)} |`,
            `| 결과 | ${request.outcome === 'response-received'
                ? '응답 수신 (후속 검증·저장 결과 별도)'
                : request.outcome} |`,
            ...(request.status === undefined ? [] : [
                `| HTTP 상태 | ${request.status} |`,
            ]),
            ...(request.failureCategory === undefined ? [] : [
                `| 오류 유형 | ${chatRequestFailureLabel(request.failureCategory)} |`,
            ]),
            `| 경과 시간 | ${durationLabel(request.durationMs)} |`,
            `| 첫 토큰 | ${durationLabel(request.firstTokenMs)} |`,
            `| 입력 토큰 | ${number(request.inputTokens)} |`,
            `| 출력 토큰 | ${number(request.outputTokens)} |`,
            `| 추론 토큰 | ${number(request.reasoningTokens)} |`,
            `| 캐시 토큰 | ${number(request.cachedTokens)} |`,
            ...(request.selectedHistoryMessageCount === undefined ? [] : [
                `| 선택된 채팅 메시지 | ${number(request.selectedHistoryMessageCount)} |`,
            ]),
        )
        if (request.wikiInquiry) {
            lines.push(`| 위키 조회 진단 | ${escapeTable(formatWikiInquiryDiagnostic(request.wikiInquiry))} |`)
        }
        if (request.injectionManifest) {
            lines.push(
                '',
                `### 입력 구성 · 총 ${number(request.injectionManifest.totalTokens)} 토큰`,
                '',
                '| 주입 항목 | 토큰 |',
                '| --- | ---: |',
                ...groupInjectionManifestItems(request.injectionManifest).map((item) => {
                    return `| ${escapeTable(item.label)} | ${number(item.tokens)} |`
                }),
            )
        }
    }
    return `${lines.join('\n')}\n`
}

/** Reads every retained, body-free request-log row belonging to one chat. */
export async function loadChatRequestEvidence(chatId: string): Promise<ChatRequestEvidence> {
    const entries: RequestLogEntry[] = []
    let beforeId: number | undefined
    while (true) {
        const page = await fetchRequestLogPage({
            sessionChatId: chatId,
            beforeId,
            limit: 500,
        })
        entries.push(...page.content)
        if (page.content.length < 500) break
        beforeId = page.content.at(-1)?.id
        if (beforeId === undefined) break
    }
    return buildChatRequestEvidence(chatId, entries)
}
