import { describe, expect, test } from 'vitest'
import {
    describeStoryTimeForModel,
    formatStoryTimeLabel,
    normalizeMemoryRetrievalMetadata,
    resolveMemoryRetrievalMetadata,
    storyTimeStamp,
    type SemanticTemporalHint,
} from './risubard-memory-metadata'

describe('memory retrieval metadata', () => {
    test('normalizes bounded keywords and establishes day zero only for the first event', () => {
        const metadata = resolveMemoryRetrievalMetadata({
            keywords: ['  Gilbert ', 'dance', 'Gilbert', ...Array.from(
                { length: 22 }, (_, index) => `keyword-${index}`
            )],
            priorTimeline: [],
        })

        expect(metadata.keywords).toEqual([
            'Gilbert', 'dance', ...Array.from(
                { length: 22 }, (_, index) => `keyword-${index}`
            ),
        ])
        expect(metadata.storyTime).toEqual({
            day: 0, evidence: 'first recorded event', precision: 'origin',
        })
    })

    test('advances an explicit prior day with grounded elapsed time', () => {
        const temporalHint: SemanticTemporalHint = {
            elapsedDays: 7,
            evidence: 'a week later',
        }
        expect(resolveMemoryRetrievalMetadata({
            keywords: ['dance'],
            priorTimeline: [{ day: 3, precision: 'explicit' }],
            temporalHint,
        }).storyTime).toEqual({
            day: 10, evidence: 'a week later', precision: 'explicit',
        })
    })

    test('keeps an ungrounded skip as a lower bound instead of inventing its length', () => {
        expect(resolveMemoryRetrievalMetadata({
            keywords: ['dance'],
            priorTimeline: [{ day: 3, precision: 'explicit' }],
            temporalHint: { elapsedDays: null, evidence: '' },
        }).storyTime).toEqual({
            day: 3,
            evidence: 'time skip of unknown length',
            precision: 'after',
        })
    })

    test('preserves a grounded continuity marker at the same day', () => {
        expect(resolveMemoryRetrievalMetadata({
            keywords: ['dance'],
            priorTimeline: [{ day: 3, precision: 'explicit' }],
            temporalHint: { elapsedDays: 0, evidence: 'that afternoon' },
        }).storyTime).toEqual({
            day: 3, evidence: 'that afternoon', precision: 'explicit',
        })
    })

    test('counts on from the last dated event past an unknown one, as a lower bound', () => {
        expect(resolveMemoryRetrievalMetadata({
            keywords: ['dance'],
            priorTimeline: [
                { day: 0, precision: 'origin' },
                { day: null, precision: 'unknown' },
            ],
            temporalHint: { elapsedDays: 1, evidence: 'the next day' },
        }).storyTime).toEqual({
            day: 1,
            evidence: 'the next day',
            precision: 'after',
        })
        // A lower bound stays one; it never becomes an exact day again by itself.
        expect(resolveMemoryRetrievalMetadata({
            keywords: ['dance'],
            priorTimeline: [{ day: 4, precision: 'after' }],
            temporalHint: { elapsedDays: 2, evidence: 'two days later' },
        }).storyTime?.precision).toBe('after')
    })

    test('places a flashback before day 0 without moving the present day', () => {
        const flashback = resolveMemoryRetrievalMetadata({
            keywords: ['war'],
            priorTimeline: [{ day: 0, precision: 'origin' }, { day: 3, precision: 'explicit' }],
            temporalHint: {
                elapsedDays: null, evidence: '200 years ago', timeline: 'flashback',
                flashbackAmount: 200, flashbackUnit: 'year', calendar: '',
            },
        }).storyTime!
        expect(flashback).toEqual({
            day: null, evidence: '200 years ago', precision: 'flashback',
            offset: { amount: -200, unit: 'year' },
        })
        expect(resolveMemoryRetrievalMetadata({
            keywords: ['war'],
            priorTimeline: [{ day: 25, precision: 'explicit' }],
            temporalHint: {
                elapsedDays: null, evidence: 'twenty days ago', timeline: 'flashback',
                flashbackAmount: 20, flashbackUnit: 'day', calendar: '',
            },
        }).storyTime?.offset).toEqual({ amount: 5, unit: 'day' })
        // The scene after the flashback continues from the present day.
        expect(resolveMemoryRetrievalMetadata({
            keywords: ['dance'],
            priorTimeline: [{ day: 3, precision: 'explicit' }, flashback],
            temporalHint: { elapsedDays: 1, evidence: 'the next morning' },
        }).storyTime).toEqual({ day: 4, evidence: 'the next morning', precision: 'explicit' })
    })

    test('keeps the in-story date as written and labels every kind of time', () => {
        const dated = resolveMemoryRetrievalMetadata({
            keywords: ['beach'],
            priorTimeline: [{ day: 1, precision: 'explicit' }],
            temporalHint: {
                elapsedDays: 1, evidence: '다음 날', timeline: 'present',
                flashbackAmount: null, flashbackUnit: 'day', calendar: ' 7월 넷째 주   월요일 ',
            },
        }).storyTime!
        expect(dated).toEqual({ day: 2, evidence: '다음 날', precision: 'explicit', calendar: '7월 넷째 주 월요일' })
        expect(formatStoryTimeLabel(dated)).toBe('+2일, 7월 넷째 주 월요일')
        expect(describeStoryTimeForModel(dated))
            .toBe('[Story time: day +2 from the story start; in-story date as written: 7월 넷째 주 월요일]')
        expect(storyTimeStamp(dated)).toBe('day +2')
        expect(formatStoryTimeLabel({ day: 0, evidence: 'x', precision: 'origin' })).toBe('0일 (시작)')
        expect(formatStoryTimeLabel({ day: 5, evidence: 'x', precision: 'after' })).toBe('+5일 이후')
        expect(formatStoryTimeLabel({ day: null, evidence: 'x', precision: 'unknown' })).toBe('시점 미상')
        expect(formatStoryTimeLabel({
            day: null, evidence: 'x', precision: 'flashback', offset: { amount: -200, unit: 'year' },
        })).toBe('-200년 (회상)')
        expect(formatStoryTimeLabel({
            day: null, evidence: 'x', precision: 'flashback', offset: { amount: null, unit: 'day' },
        })).toBe('회상 (시점 미상)')
        expect(storyTimeStamp({ day: null, evidence: 'x', precision: 'unknown' })).toBeUndefined()
    })

    test('reads stored story time from before flashbacks and dates, and rejects malformed new fields', () => {
        expect(normalizeMemoryRetrievalMetadata({
            keywords: ['dance'], storyTime: { day: 3, evidence: 'later', precision: 'explicit' },
        })?.storyTime).toEqual({ day: 3, evidence: 'later', precision: 'explicit' })
        expect(normalizeMemoryRetrievalMetadata({
            keywords: ['dance'],
            storyTime: { day: null, evidence: 'x', precision: 'flashback', offset: { amount: -3, unit: 'month' }, calendar: '봄' },
        })?.storyTime).toEqual({ day: null, evidence: 'x', precision: 'flashback', offset: { amount: -3, unit: 'month' }, calendar: '봄' })
        expect(() => normalizeMemoryRetrievalMetadata({
            keywords: [], storyTime: { day: null, evidence: 'x', precision: 'flashback' },
        })).toThrow()
        expect(() => normalizeMemoryRetrievalMetadata({
            keywords: [], storyTime: { day: 2, evidence: 'x', precision: 'explicit', offset: { amount: 1, unit: 'day' } },
        })).toThrow()
    })
})
