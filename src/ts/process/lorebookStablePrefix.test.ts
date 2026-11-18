import { describe, expect, it } from 'vitest'
import { isStableAlwaysActiveLore, resolveStableLoreIndex } from './lorebookStablePrefix'

const cards = (...types: string[]) => types.map((type) => ({ type }))
const lore = (over: Record<string, unknown> = {}, entry: Record<string, unknown> = { alwaysActive: true, mode: 'normal' }) => ({
    pos: '',
    inject: null,
    sourceIdentity: { entry },
    ...over,
})

describe('resolveStableLoreIndex', () => {
    it('puts always-active lore right after the persona block that precedes the chat', () => {
        expect(resolveStableLoreIndex(cards('plain', 'description', 'persona', 'plain', 'chat', 'cache', 'chat', 'lorebook'))).toBe(3)
    })

    it('uses the description block when there is no persona block before the chat', () => {
        expect(resolveStableLoreIndex(cards('description', 'plain', 'chat', 'persona', 'lorebook'))).toBe(1)
    })

    it('falls back to just before the first chat block', () => {
        expect(resolveStableLoreIndex(cards('plain', 'plain', 'chat', 'lorebook'))).toBe(2)
    })

    it('does not split a lorebook block that already precedes the chat', () => {
        expect(resolveStableLoreIndex(cards('description', 'lorebook', 'chat'))).toBe(-1)
    })

    it('does not split without a chat or lorebook block', () => {
        expect(resolveStableLoreIndex(cards('description', 'lorebook'))).toBe(-1)
        expect(resolveStableLoreIndex(cards('description', 'chat'))).toBe(-1)
        expect(resolveStableLoreIndex(null)).toBe(-1)
    })
})

describe('isStableAlwaysActiveLore', () => {
    it('accepts a plain always-active entry', () => {
        expect(isStableAlwaysActiveLore(lore())).toBe(true)
    })

    it('rejects keyword-matched entries', () => {
        expect(isStableAlwaysActiveLore(lore({}, { alwaysActive: false, mode: 'normal' }))).toBe(false)
    })

    it('rejects entries with a position, depth or injection decorator', () => {
        expect(isStableAlwaysActiveLore(lore({ pos: 'depth' }))).toBe(false)
        expect(isStableAlwaysActiveLore(lore({ pos: 'after_desc' }))).toBe(false)
        expect(isStableAlwaysActiveLore(lore({ inject: { location: 'x' } }))).toBe(false)
    })

    it('rejects child entries, whose always-active flag only mirrors the parent', () => {
        expect(isStableAlwaysActiveLore(lore({}, { alwaysActive: true, mode: 'child' }))).toBe(false)
    })
})
