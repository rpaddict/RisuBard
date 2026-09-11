import { describe, expect, it } from 'vitest'
import { collectCbsVariables, parseCbsConditionView, summarizeCbsCondition } from './cbsConditionView'

const gate = '{{#if {{or::{{equal::{{getvar::cv_g8}}::1}}::{{equal::{{getvar::cv_spoiler}}::request}}::{{equal::{{getvar::cv_spoiler}}::open}}}}}}'

describe('CBS condition view', () => {
    it('labels the toggle comparison used by the overview block', () => {
        expect(summarizeCbsCondition('{{#when::commonplace_book::tis::1}}', {
            variableLabels: { toggle_commonplace_book: '비망록 활성화' },
        }).text).toBe('비망록 활성화 = "1"')
    })
    it('collects static variable names and literal values without treating comparisons as definitions', () => {
        const variables = collectCbsVariables(gate + '{{setvar::cv_g8::0}}{{getvar::cv_g8}}{{getvar::{{getvar::key}}}}')
        expect(variables).toEqual([
            { name: 'cv_g8', values: ['1', '0'], reads: 2, writes: 1 },
            { name: 'cv_spoiler', values: ['request', 'open'], reads: 2, writes: 0 },
            { name: 'key', values: [], reads: 1, writes: 0 },
        ])
    })

    it('skips comments and literal blocks, and does not mistake addvar operands for possible values', () => {
        const source = '{{// {{getvar::comment}}}}{{#pure}}{{getvar::literal}}{{/pure}}{{addvar::score::5}}{{equal::active::{{getvar::mode}}}}'
        expect(collectCbsVariables(source)).toEqual([
            { name: 'score', values: [], reads: 0, writes: 1 },
            { name: 'mode', values: ['active'], reads: 1, writes: 0 },
        ])
    })

    it('keeps every source character, including extra braces and CRLF, in editable spans', () => {
        const source = `<Death>\r\n${gate}}}First paragraph.\r\n{{/if}}\r\n</Death>`
        const view = parseCbsConditionView(source)
        expect(view.valid).toBe(true)
        expect(view.parts.map(part => source.slice(part.from, part.to)).join('')).toBe(source)
        expect(view.parts.filter(part => part.kind === 'condition')).toHaveLength(1)
        const body = view.parts.find(part => source.slice(part.from, part.to).includes('First paragraph.'))!
        expect(body.kind).toBe('text')
        expect(body.depth).toBe(1)
        expect(source.slice(0, body.from) + 'Edited body.' + source.slice(body.to))
            .toBe(`<Death>\r\n${gate}Edited body.{{/if}}\r\n</Death>`)
    })

    it('shows actual binary OR semantics and flags extra arguments without evaluating anything', () => {
        const summary = summarizeCbsCondition(gate)
        expect(summary.text).toBe('($cv_g8 = "1") OR ($cv_spoiler = "request")')
        expect(summary.warnings).toEqual([{ name: 'or', expected: 2, actual: 3 }])
        expect(summary.expression).toMatchObject({
            kind: 'logical', operator: 'OR', children: [
                { kind: 'comparison', operator: '=', left: { kind: 'variable', text: '$cv_g8' }, right: { kind: 'literal', text: '"1"' } },
                { kind: 'comparison', operator: '=', left: { kind: 'variable', text: '$cv_spoiler' }, right: { kind: 'literal', text: '"request"' } },
            ],
        })
    })

    it('preserves expression groups and never splits operators inside literals or unknown macros', () => {
        const summary = summarizeCbsCondition('{{#if {{and::{{or::{{getvar::a}}::{{not::{{getvar::b}}}}}}::{{equal::{{custom::OR::<b>}}::A OR B AND C}}}}}}')
        expect(summary.expression).toMatchObject({
            kind: 'logical', operator: 'AND', children: [
                { kind: 'logical', operator: 'OR', children: [
                    { kind: 'variable', text: '$a' },
                    { kind: 'logical', operator: 'NOT', children: [{ kind: 'variable', text: '$b' }] },
                ] },
                { kind: 'comparison', left: { kind: 'raw', text: '{{custom::OR::<b>}}' }, right: { kind: 'literal', text: '"A OR B AND C"' } },
            ],
        })
        expect(summary.warnings).toEqual([])
    })

    it('summarizes nested conditions, and preserves unknown expressions verbatim', () => {
        expect(summarizeCbsCondition('{{#if {{and::{{not::{{getvar::hidden}}}}::{{equal::{{custom::a::b}}::yes}}}}}}').text)
            .toBe('(NOT ($hidden)) AND ({{custom::a::b}} = "yes")')
        expect(summarizeCbsCondition('{{#when::keep::{{getvar::flag}}::is::1}}').text)
            .toBe('#when::keep::{{getvar::flag}}::is::1')
    })

    it('renders Prompt V2 global toggles with their display labels and actual legacy OR semantics', () => {
        const source = '{{#if_pure {{? {{? {{getglobalvar::toggle_sinister}}>0}} || {{? {{getglobalvar::toggle_vulgarg}}>0}} || {{? {{getglobalvar::toggle_TsukuruRPG}}>0}}=1}}}}'
        const summary = summarizeCbsCondition(source, {
            variableLabels: {
                toggle_sinister: '음흉한 시선',
                toggle_vulgarg: '야스',
                toggle_TsukuruRPG: '희롱·추행받기',
            },
        })

        expect(summary.expression).toMatchObject({
            kind: 'logical', operator: 'OR', children: [
                { kind: 'comparison', operator: '>', left: { kind: 'variable', name: 'toggle_sinister', text: '음흉한 시선' }, right: { kind: 'literal', text: '"0"' } },
                { kind: 'comparison', operator: '>', left: { kind: 'variable', name: 'toggle_vulgarg', text: '야스' }, right: { kind: 'literal', text: '"0"' } },
                { kind: 'comparison', operator: '>', left: { kind: 'variable', name: 'toggle_TsukuruRPG', text: '희롱·추행받기' }, right: { kind: 'literal', text: '"0"' } },
            ],
        })
        expect(summary.text).toBe('(음흉한 시선 > "0") OR (야스 > "0") OR (희롱·추행받기 > "0")')
    })

    it('summarizes canonical Prompt V2 when conditions without changing their source', () => {
        const source = '{{#when::keep::{{equal::{{getglobalvar::toggle_OOC}}::0}}::and::{{notequal::{{getglobalvar::toggle_lang}}::2}}}}'
        const summary = summarizeCbsCondition(source, {
            variableLabels: { toggle_OOC: 'OOC', toggle_lang: '응답 언어' },
        })

        expect(summary.text).toBe('(OOC = "0") AND (응답 언어 ≠ "2")')
        expect(summary.expression).toMatchObject({
            kind: 'logical', operator: 'AND', children: [
                { kind: 'comparison', left: { kind: 'variable', name: 'toggle_OOC' } },
                { kind: 'comparison', left: { kind: 'variable', name: 'toggle_lang' } },
            ],
        })
        expect(parseCbsConditionView(source + 'Body{{/when}}').parts.map(part => part.kind))
            .toEqual(['condition', 'text', 'end'])
    })

    it('tracks nested branches while leaving ordinary macros in the text', () => {
        const source = '{{#when {{getvar::a}}}}A{{char}}{{#if 1}}B{{/if}}{{:else}}C{{/when}}'
        const view = parseCbsConditionView(source)
        expect(view.valid).toBe(true)
        expect(view.parts.map(({ kind, depth }) => [kind, depth])).toEqual([
            ['condition', 0], ['text', 1], ['condition', 1], ['text', 2],
            ['end', 1], ['otherwise', 0], ['text', 1], ['end', 0],
        ])
        expect(view.parts.map(part => source.slice(part.from, part.to)).join('')).toBe(source)
    })

    it('accepts the runtime parser close-token rules for legacy and named condition blocks', () => {
        for (const source of [
            '{{#if_pure 1}}Body{{/if}}',
            '{{#if_pure 1}}Body{{/if_pure}}',
            '{{#if_pure 1}}Body{{/}}',
            '{{#if 1}}Body{{/when}}',
        ]) {
            const view = parseCbsConditionView(source)
            expect(view.valid, source).toBe(true)
            expect(view.parts.map(part => source.slice(part.from, part.to)).join('')).toBe(source)
        }
    })

    it('splits the reported if_pure prompt with markdown content and an /if closer', () => {
        const source = [
            '{{#if_pure {{? {{getglobalvar::toggle_OOC}}=0}}}}',
            '',
            'Write with an Austen-like narrator.',
            '',
            '## POV',
            '',
            'Use one viewpoint character.',
            '{{/if}}',
        ].join('\n')
        const view = parseCbsConditionView(source)

        expect(view.valid).toBe(true)
        expect(view.parts.map(part => part.kind)).toEqual(['condition', 'text', 'end'])
        expect(view.parts.map(part => source.slice(part.from, part.to)).join('')).toBe(source)
    })

    it('leaves unknown hash macros in editable text instead of treating them as unterminated blocks', () => {
        const source = 'Before {{#unknown::value}} after'
        expect(parseCbsConditionView(source)).toEqual({
            valid: true,
            parts: [{ kind: 'text', from: 0, to: source.length, depth: 0 }],
        })
    })

    it.each(['pure', 'puredisplay', 'pure_display', 'escape', 'each', 'func'])
        ('leaves conditions inside #%s blocks in the source', name => {
            const source = `{{#${name}}}{{#if 1}}literal{{/if}}{{/${name}}}`
            const view = parseCbsConditionView(source)
            expect(view.parts).toEqual([{ kind: 'text', from: 0, to: source.length, depth: 0 }])
        })

    it.each([
        '{{#if 1}}missing end', '{{/if}}',
        '{{#when 1}}{{:else}}{{:else}}{{/when}}', '{{#if {{getvar::x}}',
    ])('falls back to the complete source for unbalanced input: %s', source => {
        const view = parseCbsConditionView(source)
        expect(view.valid).toBe(false)
        expect(view.parts).toEqual([{ kind: 'text', from: 0, to: source.length, depth: 0 }])
    })

    it('handles empty bodies and deeply nested macro input without discarding text', () => {
        expect(parseCbsConditionView('{{#if 1}}{{/if}}').parts.map(part => part.kind))
            .toEqual(['condition', 'text', 'end'])
        const source = '{{#if ' + '{{not::'.repeat(300) + '1' + '}}'.repeat(300) + '}}x{{/if}}'
        const view = parseCbsConditionView(source)
        expect(view.parts.map(part => source.slice(part.from, part.to)).join('')).toBe(source)
    })
})
