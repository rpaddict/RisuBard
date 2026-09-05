import { describe, expect, test } from 'vitest'
import { selectMarkdownExcerpt } from './risubard-markdown-excerpt'

const longCharacter = [
    '## 체사레',
    '',
    '### 작중 행적',
    '',
    `- ${'오래된 사건 '.repeat(500)}`,
    '',
    '### 현재 상태',
    '',
    '- 쉽독이다.',
    '- 이탈리아에 남기로 했다.',
    '',
    '### 관계',
    '',
    '- 연인과 교제한 지 21개월이다.',
    '',
    '### 목표',
    '',
    '- 유럽에서 취업한다.',
].join('\n')

describe('bounded Markdown excerpts', () => {
    test('keeps character current-state lanes ahead of long history', () => {
        const excerpt = selectMarkdownExcerpt({
            content: longCharacter,
            documentType: 'character',
            query: '체사레가 산책을 계속한다.',
            maximumCharacters: 2_000,
            chronologyIntent: false,
        })

        expect(excerpt).toContain('## 체사레')
        expect(excerpt).toContain('### 현재 상태')
        expect(excerpt).toContain('쉽독이다')
        expect(excerpt).toContain('### 관계')
        expect(excerpt).toContain('### 목표')
        expect(excerpt).not.toContain('오래된 사건 오래된 사건 오래된 사건')
        expect(excerpt.length).toBeLessThanOrEqual(2_000)
    })

    test('includes character history only for chronology intent', () => {
        const ordinary = selectMarkdownExcerpt({
            content: longCharacter, documentType: 'character',
            query: '체사레의 현재 상태', maximumCharacters: 2_000,
            chronologyIntent: false,
        })
        const chronology = selectMarkdownExcerpt({
            content: longCharacter, documentType: 'character',
            query: '체사레의 작중 행적', maximumCharacters: 2_000,
            chronologyIntent: true,
        })

        expect(ordinary).not.toContain('### 작중 행적')
        expect(chronology).toContain('### 작중 행적')
        expect(chronology).toContain('### 현재 상태')
    })

    test('keeps matched history ahead of oversized current sections for chronology intent', () => {
        const excerpt = selectMarkdownExcerpt({
            content: [
                '## 체사레',
                '### 현재 상태',
                `- ${'세부 상태 '.repeat(500)}`,
                '### 작중 행적',
                '- 양치기 대회에서 우승했다.',
            ].join('\n\n'),
            documentType: 'character', query: '체사레의 작중 행적',
            maximumCharacters: 500, chronologyIntent: true,
        })

        expect(excerpt).toContain('### 작중 행적')
        expect(excerpt).toContain('양치기 대회에서 우승했다')
    })

    test('recognizes English current character headings', () => {
        const excerpt = selectMarkdownExcerpt({
            content: [
                '## Cesare',
                '### Story History',
                `- ${'Old event '.repeat(400)}`,
                '### Identity',
                '- Sheepdog',
                '### Current State',
                '- Staying in Italy',
                '### Relationships',
                '- Dating for 21 months',
            ].join('\n\n'),
            documentType: 'character', query: 'Cesare continues.',
            maximumCharacters: 1_000, chronologyIntent: false,
        })

        expect(excerpt).toContain('### Identity')
        expect(excerpt).toContain('Sheepdog')
        expect(excerpt).toContain('### Current State')
        expect(excerpt).toContain('### Relationships')
        expect(excerpt).not.toContain('### Story History')
    })

    test('keeps non-character excerpts centered on the matching section', () => {
        const excerpt = selectMarkdownExcerpt({
            content: [
                '## 오래된 사건',
                '### 도입',
                `- ${'무관한 설명 '.repeat(400)}`,
                '### 결정적 단서',
                '- 붉은 구체는 숨겨진 문을 연다.',
                '### 결말',
                '- 문이 열렸다.',
            ].join('\n\n'),
            documentType: 'event', query: '붉은 구체와 숨겨진 문',
            maximumCharacters: 500, chronologyIntent: false,
        })

        expect(excerpt).toContain('## 오래된 사건')
        expect(excerpt).toContain('### 결정적 단서')
        expect(excerpt).toContain('붉은 구체는 숨겨진 문을 연다')
        expect(excerpt).not.toContain('무관한 설명 무관한 설명')
        expect(excerpt.length).toBeLessThanOrEqual(500)
    })

    test('prefers Japanese current-state and history lanes for ja headings', () => {
        const jaCharacter = [
            '## シロ',
            '',
            '### 物語要約',
            '',
            `- ${'古い記録 '.repeat(400)}`,
            '',
            '### 現在の状態',
            '',
            '- 学園の新入生。',
            '',
            '### 関係',
            '',
            '- 白雪凛と知り合った。',
        ].join('\n')
        const excerpt = selectMarkdownExcerpt({
            content: jaCharacter,
            documentType: 'character',
            query: 'シロの現在の状態は？',
            maximumCharacters: 2_000,
            chronologyIntent: false,
        })

        expect(excerpt).toContain('### 現在の状態')
        expect(excerpt).toContain('学園の新入生')
        expect(excerpt).not.toContain('古い記録 古い記録 古い記録')
    })
})
