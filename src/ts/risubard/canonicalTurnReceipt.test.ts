import { describe, expect, test } from 'vitest'
import {
    canonicalTurnRetryWarning,
    canonicalTurnNeedsRetry,
    formatCanonicalUpdateFailureWarning,
} from './canonicalTurnReceipt'

describe('canonical turn retry receipt', () => {
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
