import { describe, expect, it } from 'vitest'
import { applyInlineEdit, findInlineAlignments, LOCKED_CHAR } from './inlineEdit'

function edit(source: string, oldPlain: string, newPlain: string, occurrence = 0) {
    const found = findInlineAlignments(source, oldPlain)
    expect(found.length).toBeGreaterThan(occurrence)
    return applyInlineEdit(source, found[occurrence], oldPlain, newPlain)
}

describe('inline body edit', () => {
    it('keeps emphasis markers around edited words', () => {
        const source = '"안녕" 그녀가 *웃었다*.'
        expect(edit(source, '"안녕" 그녀가 웃었다.', '"안녕" 그녀가 미소지었다.')).toBe('"안녕" 그녀가 *미소지었다*.')
    })

    it('edits only the matching paragraph of a longer message', () => {
        const source = '첫 문단이다.\n\n**둘째** 문단은 길다.\n\n셋째 문단.'
        expect(edit(source, '둘째 문단은 길다.', '둘째 문단은 짧다.')).toBe('첫 문단이다.\n\n**둘째** 문단은 짧다.\n\n셋째 문단.')
    })

    it('keeps markup when a deletion crosses a formatting boundary', () => {
        expect(edit('그녀가 *웃었다*', '그녀가 웃었다', '그녀었다')).toBe('그녀*었다*')
    })

    it('maps macro output but refuses to edit it', () => {
        const source = '{{user}}가 웃었다.'
        expect(edit(source, 'Alice가 웃었다.', 'Alice가 울었다.')).toBe('{{user}}가 울었다.')
        expect(edit(source, 'Alice가 웃었다.', 'Bob가 웃었다.')).toBeNull()
    })

    it('does not let a macro stand in for a whole paragraph', () => {
        const source = '"어서 와." 그녀가 웃었다.\n\n{{user}}는 앉았다.'
        expect(findInlineAlignments(source, '“어서 와.” 그녀가 웃었다.').map(f => f.start)).toEqual([0])
    })

    it('protects inline images', () => {
        const source = '앞 {{inlay::abc}} 뒤'
        const plain = `앞 ${LOCKED_CHAR} 뒤`
        expect(edit(source, plain, `앞 ${LOCKED_CHAR} 뒤쪽`)).toBe('앞 {{inlay::abc}} 뒤쪽')
        expect(edit(source, plain, '앞  뒤')).toBeNull()
        expect(edit('<img src="a.png">설명', `${LOCKED_CHAR}설명`, `${LOCKED_CHAR}새 설명`)).toBe('<img src="a.png">새 설명')
    })

    it('does not match text a script rewrote', () => {
        expect(findInlineAlignments('[HP: 10]', 'HP 10')).toEqual([])
    })

    it('finds every repeated paragraph in source order', () => {
        const found = findInlineAlignments('반복\n\n다른 줄\n\n반복', '반복')
        expect(found.map(f => f.start)).toEqual([0, 10])
        expect(applyInlineEdit('반복\n\n다른 줄\n\n반복', found[1], '반복', '변경')).toBe('반복\n\n다른 줄\n\n변경')
    })

    it('treats typographic quotes, entities and list markers as the same text', () => {
        expect(edit('"hi" &amp; bye', '\u201Chi\u201D & bye', '\u201Chi\u201D & see you')).toBe('"hi" &amp; see you')
        expect(edit('- 첫째\n- 둘째', '둘째', '둘째 항목')).toBe('- 첫째\n- 둘째 항목')
    })

    it('inserts typed text at the caret, extending the word before it', () => {
        expect(edit('그녀가 *웃었다*.', '그녀가 웃었다.', '그녀가 웃었다!.')).toBe('그녀가 *웃었다!*.')
        expect(edit('a  b', 'a b', 'ab')).toBe('ab')
    })

    it('drops the trailing break browsers add on Enter', () => {
        expect(edit('문장', '문장', '문장\n')).toBe('문장')
        expect(edit('문장', '문장', '문\n장')).toBe('문\n장')
    })
})
