import { describe, expect, test } from 'vitest'
import {
    canonicalTurnRetryWarning,
    canonicalTurnFailureWarning,
    formatCanonicalDeferredWarning,
    parseCanonicalTurnReceipt,
    canonicalTurnNeedsRetry,
    formatCanonicalUpdateFailureWarning,
    mergeCanonicalTurnReceipts,
    type CanonicalTurnReceipt,
} from './canonicalTurnReceipt'

describe('cumulative canonical turn receipt', () => {
    const saved: CanonicalTurnReceipt = {
        sourceMessageIds: ['user-1', 'assistant-1'],
        eventIds: ['event-1'],
        changes: [{ documentId: 'character-1', type: 'character',
            title: '인물', relativePath: 'characters/person.md',
            action: 'create', afterHash: 'first-hash' }],
        warnings: ['정본 문서 저장 실패: 마을'],
        recordedAt: '2026-09-23T00:00:00.000Z',
    }
    const latest: CanonicalTurnReceipt = {
        sourceMessageIds: ['assistant-1'], eventIds: ['event-1'],
        changes: [], warnings: [], recordedAt: '2026-09-24T00:00:00.000Z',
    }

    test('retains saved documents when additional analysis finds no new changes', () => {
        const result = mergeCanonicalTurnReceipts(saved, latest)
        expect(result.changes).toEqual(saved.changes)
        expect(result.sourceMessageIds).toEqual(saved.sourceMessageIds)
        expect(result.eventIds).toEqual(['event-1'])
        expect(result.recordedAt).toBe(latest.recordedAt)
        expect(result.warnings).toEqual([])
        expect(canonicalTurnNeedsRetry(result)).toBe(false)
    })

    test('combines new documents with previous changes without mutating either result', () => {
        const next: CanonicalTurnReceipt = { ...latest,
            changes: [{ ...saved.changes[0], documentId: 'character-2' }],
            eventIds: ['event-2'], warnings: ['정본 문서 저장 실패: 마을'],
        }
        const before = structuredClone([saved, next])
        const result = mergeCanonicalTurnReceipts(saved, next)
        expect(result.changes.map(change => change.documentId))
            .toEqual(['character-1', 'character-2'])
        expect(result.eventIds).toEqual(['event-1', 'event-2'])
        expect(canonicalTurnNeedsRetry(result)).toBe(true)
        expect([saved, next]).toEqual(before)
    })

    test('keeps one entry with the newest hash and the original create action', () => {
        const updated = { ...saved.changes[0], action: 'update' as const,
            title: '새 이름', afterHash: 'latest-hash' }
        const result = mergeCanonicalTurnReceipts(saved, { ...latest, changes: [updated] })
        expect(result.changes).toEqual([{ ...updated, action: 'create' }])
    })

    test('accepts a first receipt including a genuine no-change result', () => {
        expect(mergeCanonicalTurnReceipts(undefined, latest)).toEqual(latest)
    })
})

describe('canonical turn retry receipt', () => {
    test('round-trips optional recovery metadata while accepting legacy receipts', () => {
        const legacy = { sourceMessageIds: ['a'], eventIds: [], changes: [], warnings: [], recordedAt: 'now' }
        expect(parseCanonicalTurnReceipt(legacy)).toEqual(legacy)
        const receipt = { ...legacy, recovery: { inputHash: 'a'.repeat(64), deferred: [{
            documentId: 'character.alice', type: 'character' as const, title: 'Alice', contentHash: 'old-hash',
            warning: formatCanonicalDeferredWarning('Alice', '형식 오류'),
        }] } }
        const restored = parseCanonicalTurnReceipt(JSON.parse(JSON.stringify(receipt)))
        expect(restored).toEqual(receipt)
        expect(() => parseCanonicalTurnReceipt({ ...receipt, recovery: { ...receipt.recovery, inputHash: 'invalid' } })).toThrow()
        expect(() => parseCanonicalTurnReceipt({ ...receipt, recovery: { ...receipt.recovery, deferred: [{ ...receipt.recovery.deferred[0], type: 'event' }] } })).toThrow()
        expect(() => parseCanonicalTurnReceipt({ ...receipt, unexpected: true })).toThrow()
    })

    test('keeps exhausted recovery visible as a failure without automatically replaying the turn', () => {
        const warning = formatCanonicalDeferredWarning('Alice', '기존 문서 구조 오류')
        const receipt = { sourceMessageIds: ['a'], eventIds: ['e'], changes: [], warnings: [warning], recordedAt: 'now' }
        expect(canonicalTurnNeedsRetry(receipt)).toBe(false)
        expect(canonicalTurnFailureWarning(receipt)).toBe(warning)
        expect(warning).toContain('Alice')
        expect(warning).toContain('추가 분석')
        const transient = formatCanonicalUpdateFailureWarning(new Error('timeout'))
        expect(canonicalTurnNeedsRetry({ ...receipt, warnings: [warning, transient] })).toBe(true)
    })

    test('retries a partial document save failure from an existing receipt', () => {
        const warning = '정본 문서 저장 실패: 마을'
        const receipt = {
            sourceMessageIds: ['assistant-1'], eventIds: ['event-1'],
            changes: [{ documentId: 'character-1', type: 'character' as const,
                title: '인물', relativePath: 'characters/person.md',
                action: 'update' as const, afterHash: 'saved-hash' }],
            warnings: [warning], recordedAt: '2026-09-10T00:00:00.000Z',
        }
        expect(canonicalTurnNeedsRetry(receipt)).toBe(true)
        expect(canonicalTurnRetryWarning(receipt)).toBe(warning)
    })

    test('marks a provider timeout as retryable without exposing unbounded details', () => {
        const warning = formatCanonicalUpdateFailureWarning(
            new Error('Upstream request timed out after 300000ms')
        )

        expect(warning).toContain('타임아웃')
        expect(warning).toContain('다음 턴에 자동으로 다시 시도합니다')
        expect(canonicalTurnNeedsRetry({
            sourceMessageIds: ['assistant-1'],
            eventIds: ['event-1'],
            changes: [],
            warnings: [warning],
            recordedAt: '2026-08-31T00:00:00.000Z',
        })).toBe(true)
    })

    test('keeps a successful receipt complete', () => {
        expect(canonicalTurnNeedsRetry({
            sourceMessageIds: ['assistant-1'],
            eventIds: ['event-1'],
            changes: [],
            warnings: [],
            recordedAt: '2026-08-31T00:00:00.000Z',
        })).toBe(false)
    })

    test('retains a bounded semantic validation reason', () => {
        const error = Object.assign(
            new Error('AI 응답 형식이 올바르지 않습니다.'),
            {
                name: 'ModelOutputError',
                validationHint:
                    '모든 캐릭터 정본에는 직접 자식 `### 현재 상태` 절이 필요합니다.',
            }
        )
        const warning = formatCanonicalUpdateFailureWarning(error)
        const receipt = {
            sourceMessageIds: ['assistant-1'],
            eventIds: ['event-1'],
            changes: [],
            warnings: [warning],
            recordedAt: '2026-08-31T00:00:00.000Z',
        }

        expect(warning).toContain('응답 형식 오류')
        expect(warning).toContain('직접 자식 `### 현재 상태` 절이 필요합니다')
        expect(warning.length).toBeLessThanOrEqual(1_024)
        expect(canonicalTurnRetryWarning(receipt)).toBe(warning)
    })
})

test('accepts bounded maintenance notes and rejects malformed ones', () => {
    const base = { sourceMessageIds: ['a'], eventIds: [], changes: [], warnings: [], recordedAt: '2026-10-09T00:00:00.000Z' }
    expect(parseCanonicalTurnReceipt({ ...base, notes: ['정본 정리: 미오 지식과 비밀 14→3항목'] }).notes)
        .toEqual(['정본 정리: 미오 지식과 비밀 14→3항목'])
    expect(parseCanonicalTurnReceipt(base).notes).toBeUndefined()
    expect(() => parseCanonicalTurnReceipt({ ...base, notes: [1] })).toThrow()
    expect(() => parseCanonicalTurnReceipt({ ...base, notes: Array.from({ length: 9 }, () => 'x') })).toThrow()
})
