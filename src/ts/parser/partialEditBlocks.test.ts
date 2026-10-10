import { describe, expect, test } from 'vitest'
import { isEditableBlockCandidate } from './partialEdit'

function body(html: string): HTMLElement {
    const root = document.createElement('span')
    root.className = 'text'
    root.innerHTML = html
    return root
}

describe('partial edit block candidates', () => {
    test('rejects the message body and wrappers around several paragraphs', () => {
        const root = body('<div class="wrap"><p>첫 문단</p><p>둘째 문단</p></div>')
        expect(isEditableBlockCandidate(root, root)).toBe(false)
        expect(isEditableBlockCandidate(root.querySelector('.wrap')!, root)).toBe(false)
        expect(isEditableBlockCandidate(root.querySelectorAll('p')[1], root)).toBe(true)
    })

    test('keeps paragraphs with inline spans and quote paragraphs editable', () => {
        const root = body('<p>그녀가 <span class="quote">"안녕"</span> 하고 말했다.</p><blockquote><p>인용</p></blockquote>')
        expect(isEditableBlockCandidate(root.querySelector('p')!, root)).toBe(true)
        expect(isEditableBlockCandidate(root.querySelector('.quote')!, root)).toBe(true)
        expect(isEditableBlockCandidate(root.querySelector('blockquote')!, root)).toBe(false)
        expect(isEditableBlockCandidate(root.querySelector('blockquote p')!, root)).toBe(true)
    })

    test('ignores elements outside the message body', () => {
        const root = body('<p>본문</p>')
        expect(isEditableBlockCandidate(document.createElement('p'), root)).toBe(false)
    })
})
