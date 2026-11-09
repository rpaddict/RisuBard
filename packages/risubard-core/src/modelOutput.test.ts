import { describe, expect, it } from 'vitest'
import {
    normalizeNarrativeBaseline,
    parseSingleJsonObject,
} from './modelOutput'

describe('parseSingleJsonObject', () => {
    it('reads raw newlines inside strings, mid-reply reasoning and odd prose quotes', () => {
        expect(parseSingleJsonObject('{"body":"첫 줄\n\t둘째 줄"}')).toEqual({ body: '첫 줄\n\t둘째 줄' })
        expect(parseSingleJsonObject(
            '알겠습니다.\n<thinking>초안 {"a":0}</thinking>\n{"a":1}'
        )).toEqual({ a: 1 })
        expect(parseSingleJsonObject('그는 "멈춰 라고 말했다.\n{"a":"}"}')).toEqual({ a: '}' })
        expect(parseSingleJsonObject('{"a":"<think>인용</think>"}')).toEqual({ a: '<think>인용</think>' })
        expect(() => parseSingleJsonObject('<think>{"a":1}')).toThrow('exactly one JSON object')
        expect(() => parseSingleJsonObject('{"a":1}\n{"b":2}')).toThrow('exactly one JSON object')
    })

    it('accepts strict JSON and JSON wrapped in reasoning or a markdown fence', () => {
        const value = { schemaVersion: 1, operations: [] }

        expect(parseSingleJsonObject(JSON.stringify(value))).toEqual(value)
        expect(parseSingleJsonObject(
            `<Thoughts>reasoning</Thoughts>\n\`\`\`json\n${JSON.stringify(value)}\n\`\`\``
        )).toEqual(value)
        expect(parseSingleJsonObject(
            `I will return the requested object.\n${JSON.stringify(value)}`
        )).toEqual(value)
    })

    it('ignores JSON-shaped provider reasoning before the final object', () => {
        const value = {
            schemaVersion: 2,
            storyId: 'character',
            branchId: 'chat',
            operations: [],
        }

        expect(parseSingleJsonObject(
            `<Thoughts>{"draft":true}</Thoughts>\n${JSON.stringify(value)}`
        )).toEqual(value)
    })

    it('rejects ambiguous multiple JSON objects and prose without JSON', () => {
        expect(() => parseSingleJsonObject('{}\n{}')).toThrow(/exactly one/)
        expect(() => parseSingleJsonObject('not json')).toThrow(/exactly one/)
    })

    it('ignores JSON drafts in leading think blocks but preserves literal document text', () => {
        const value = { markdown: '## 인물\n<think>원문</think> <Thoughts>인용</Thoughts>' }
        expect(parseSingleJsonObject(
            `\n<think>{"draft":true}</think>\n\`\`\`json\n${JSON.stringify(value)}\n\`\`\``
        )).toEqual(value)
        expect(parseSingleJsonObject(JSON.stringify(value))).toEqual(value)
    })

    it('never executes JSON inside an unfinished reasoning block', () => {
        expect(() => parseSingleJsonObject('<think>{"draft":true}'))
            .toThrow(/exactly one/)
    })
})

describe('normalizeNarrativeBaseline', () => {
    it('removes reasoning and markdown wrappers before persistence', () => {
        expect(normalizeNarrativeBaseline(
            '<Thoughts>private plan</Thoughts>\n```text\nCurrent state.\n```'
        )).toBe('Current state.')
    })

    it('rejects reasoning-only and oversized baselines', () => {
        expect(() => normalizeNarrativeBaseline(
            '<Thoughts>private plan</Thoughts>'
        )).toThrow(/empty/)
        expect(() => normalizeNarrativeBaseline('x'.repeat(12_001)))
            .toThrow(/12000/)
    })
})
