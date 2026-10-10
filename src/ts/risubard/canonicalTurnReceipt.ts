export type CanonicalReceiptDocumentType = 'character' | 'location' | 'scene'
    | 'faction' | 'creature' | 'item' | 'concept' | 'other'

export interface CanonicalTurnReceiptChange {
    documentId: string
    type: CanonicalReceiptDocumentType
    title: string
    relativePath: string
    action: 'create' | 'update'
    afterHash: string
}

export interface CanonicalTurnReceipt {
    sourceMessageIds: string[]
    eventIds: string[]
    changes: CanonicalTurnReceiptChange[]
    warnings: string[]
    notes?: string[]
    recordedAt: string
    recovery?: {
        inputHash: string
        deferred: Array<{
            documentId: string | null
            type: CanonicalReceiptDocumentType
            title: string
            contentHash: string | null
            warning: string
        }>
    }
}

// Repeated analysis belongs to the same turn; an empty pass must not erase saves.
export function mergeCanonicalTurnReceipts(
    previous: CanonicalTurnReceipt | undefined,
    latest: CanonicalTurnReceipt
): CanonicalTurnReceipt {
    if (!previous) return latest
    const changes = new Map(previous.changes.map(change => [change.documentId, change]))
    for (const change of latest.changes) {
        const earlier = changes.get(change.documentId)
        changes.set(change.documentId, {
            ...change,
            action: earlier?.action === 'create' ? 'create' : change.action,
        })
    }
    return {
        ...latest,
        sourceMessageIds: [...new Set([...previous.sourceMessageIds, ...latest.sourceMessageIds])],
        eventIds: [...new Set([...previous.eventIds, ...latest.eventIds])],
        changes: [...changes.values()],
    }
}

const CANONICAL_UPDATE_RETRY_PREFIX = '정본 문서 갱신 실패'
const CANONICAL_DEFERRED_PREFIX = '정본 문서 갱신 보류:'

export function formatCanonicalDeferredWarning(title: string, reason: string): string {
    const label = title.replace(/\s+/gu, ' ').trim().slice(0, 160)
    const detail = reason.replace(/\s+/gu, ' ').trim().slice(0, 320)
    return `${CANONICAL_DEFERRED_PREFIX} ${label} (${detail}). 기존 문서와 사건 기록은 보존했습니다. 이 문서의 같은 입력에 대한 자동 재시도는 중단합니다. 문서를 확인한 뒤 추가 분석을 실행하거나 새 근거가 있는 다음 턴에서 다시 갱신할 수 있습니다.`
}

export function canonicalTurnFailureWarning(receipt: CanonicalTurnReceipt): string | undefined {
    return canonicalTurnRetryWarning(receipt)
        ?? receipt.warnings.find((warning) => warning.startsWith(CANONICAL_DEFERRED_PREFIX))
}

function canonicalValidationHint(error: unknown): string | undefined {
    if (typeof error !== 'object' || error === null) return undefined
    const hint = (error as { validationHint?: unknown }).validationHint
    if (typeof hint !== 'string') return undefined
    const normalized = hint.replace(/\s+/gu, ' ').trim()
    return normalized ? normalized.slice(0, 320) : undefined
}

function canonicalFailureCategory(error: unknown): string {
    const message = (error instanceof Error ? error.message : String(error))
        .toLocaleLowerCase()
    const errorName = typeof error === 'object' && error !== null
        ? (error as { name?: unknown }).name
        : undefined
    if (errorName === 'ModelOutputError'
        || canonicalValidationHint(error)
        || /응답 형식|invalid.?structure|schema validation|canonical.*(?:section|markdown)|current state|현재 상태/u.test(message)) {
        return '응답 형식 오류'
    }
    if (/timed?\s*out|timeout|시간.*초과/u.test(message)) return '타임아웃'
    if (/\b429\b|rate.?limit|resource exhausted|quota/u.test(message)) {
        return '호출 제한'
    }
    if (/\b(?:401|403)\b|unauthor|forbidden|authentication|api.?key/u.test(message)) {
        return '인증 오류'
    }
    if (/\b5\d\d\b|bad gateway|service unavailable|internal server/u.test(message)) {
        return '공급자 서버 오류'
    }
    if (/network|fetch|econn|enotfound|socket|connection|proxy/u.test(message)) {
        return '네트워크 오류'
    }
    return '공급자 응답 오류'
}

export function formatCanonicalUpdateFailureWarning(error: unknown, title?: string): string {
    const category = canonicalFailureCategory(error)
    const validationHint = category === '응답 형식 오류'
        ? canonicalValidationHint(error)
        : undefined
    const target = title ? `: ${title.replace(/\s+/gu, ' ').trim().slice(0, 160)}` : ''
    return (`${CANONICAL_UPDATE_RETRY_PREFIX}${target} (${category}${validationHint ? `: ${validationHint}` : ''}). `
        + (title ? '사건 기록은 보존했지만 이 문서는 저장하지 않았습니다. ' : '사건 기록은 보존했지만 정보 문서는 저장하지 않았습니다. ')
        + '다음 턴에 자동으로 다시 시도합니다.').slice(0, 1024)
}

export function canonicalTurnRetryWarning(
    receipt: CanonicalTurnReceipt
): string | undefined {
    return receipt.warnings.find((warning) =>
        warning.startsWith(CANONICAL_UPDATE_RETRY_PREFIX)
        || warning.startsWith('정본 문서 저장 실패:')
    )
}

export function canonicalTurnNeedsRetry(
    receipt: CanonicalTurnReceipt
): boolean {
    return canonicalTurnRetryWarning(receipt) !== undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const documentTypes: readonly CanonicalReceiptDocumentType[] = [
    'character', 'location', 'scene', 'faction', 'creature', 'item',
    'concept', 'other',
]

export function parseCanonicalTurnReceipt(
    value: unknown
): CanonicalTurnReceipt {
    if (!isRecord(value)
        || Object.keys(value).length !== 5
            + (value.recovery === undefined ? 0 : 1)
            + (value.notes === undefined ? 0 : 1)
        || !['sourceMessageIds', 'eventIds', 'changes', 'warnings',
            'recordedAt'].every((key) => Object.hasOwn(value, key))
        || !Array.isArray(value.sourceMessageIds)
        || !value.sourceMessageIds.every((id) => typeof id === 'string')
        || !Array.isArray(value.eventIds)
        || !value.eventIds.every((id) => typeof id === 'string')
        || !Array.isArray(value.warnings)
        || !value.warnings.every((warning) => typeof warning === 'string')
        || (value.notes !== undefined && (!Array.isArray(value.notes) || value.notes.length > 8
            || !value.notes.every((note) => typeof note === 'string' && note.length <= 512)))
        || typeof value.recordedAt !== 'string'
        || !Array.isArray(value.changes)) {
        throw new Error('Invalid wiki turn receipt')
    }
    const changes = value.changes.map((change) => {
        if (!isRecord(change)
            || Object.keys(change).length !== 6
            || !['documentId', 'type', 'title', 'relativePath', 'action',
                'afterHash'].every((key) => Object.hasOwn(change, key))
            || typeof change.documentId !== 'string'
            || !documentTypes.includes(
                change.type as CanonicalReceiptDocumentType
            )
            || typeof change.title !== 'string'
            || typeof change.relativePath !== 'string'
            || (change.action !== 'create' && change.action !== 'update')
            || typeof change.afterHash !== 'string') {
            throw new Error('Invalid wiki turn receipt change')
        }
        return change as unknown as CanonicalTurnReceiptChange
    })
    let recovery: CanonicalTurnReceipt['recovery']
    if (value.recovery !== undefined) {
        const raw = value.recovery
        if (!isRecord(raw) || Object.keys(raw).length !== 2
            || typeof raw.inputHash !== 'string' || !/^[a-f0-9]{64}$/u.test(raw.inputHash)
            || !Array.isArray(raw.deferred)) throw new Error('Invalid wiki recovery receipt')
        const deferred = raw.deferred.map((entry) => {
            if (!isRecord(entry) || Object.keys(entry).length !== 5
                || !(entry.documentId === null || typeof entry.documentId === 'string')
                || !documentTypes.includes(entry.type as CanonicalReceiptDocumentType)
                || typeof entry.title !== 'string'
                || !(entry.contentHash === null || typeof entry.contentHash === 'string')
                || typeof entry.warning !== 'string' || entry.warning.length > 1024
                || !entry.warning.startsWith(CANONICAL_DEFERRED_PREFIX)) {
                throw new Error('Invalid wiki deferred target')
            }
            return { ...entry } as NonNullable<CanonicalTurnReceipt['recovery']>['deferred'][number]
        })
        recovery = { inputHash: raw.inputHash, deferred }
    }
    return {
        sourceMessageIds: [...value.sourceMessageIds] as string[],
        eventIds: [...value.eventIds] as string[],
        changes,
        warnings: [...value.warnings] as string[],
        ...(value.notes === undefined ? {} : { notes: [...(value.notes as string[])] }),
        recordedAt: value.recordedAt,
        ...(recovery ? { recovery } : {}),
    }
}
