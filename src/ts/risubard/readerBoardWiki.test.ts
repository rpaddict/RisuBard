import { describe, expect, it } from 'vitest'
import { selectReaderBoardWiki, type ReaderBoardWikiDocument } from './readerBoardWiki'

const messages = Array.from({ length: 8 }, (_, i) => ({ chatId: `m${i}`, role: i % 2 ? 'char' : 'user' }))

function event(id: string, source: string, content = `${id} 내용`): ReaderBoardWikiDocument {
    return { id, type: 'event', status: 'active', title: `사건 ${id}`, content, sourceMessageIds: [source] }
}

describe('selectReaderBoardWiki', () => {
    it('keeps only events from published messages, in story order', () => {
        const text = selectReaderBoardWiki({
            documents: [event('e3', 'm5'), event('e1', 'm1'), event('e2', 'm3'), { ...event('gone', 'm1'), status: 'retracted' }],
            messages,
            publishedUntil: 3,
        })
        expect(text).toContain('사건 e1')
        expect(text).toContain('사건 e2')
        expect(text).not.toContain('사건 e3')
        expect(text).not.toContain('사건 gone')
        expect(text.indexOf('사건 e1')).toBeLessThan(text.indexOf('사건 e2'))
    })

    it('uses the arc plot only when its last event is published', () => {
        const arc = (checkpoint: string): ReaderBoardWikiDocument => ({
            id: 'arc', type: 'other', status: 'active', title: '스토리 아크 지도', sourceMessageIds: [],
            content: `[[키스케|주인공]]이 항구로 간다.\n<!-- risubard-story-arc-checkpoint: ${checkpoint} -->`,
        })
        const early = selectReaderBoardWiki({ documents: [event('e1', 'm1'), event('e3', 'm5'), arc('e1')], messages, publishedUntil: 3 })
        expect(early).toContain('주인공이 항구로 간다.')
        expect(early).not.toContain('checkpoint')
        const late = selectReaderBoardWiki({ documents: [event('e1', 'm1'), event('e3', 'm5'), arc('e3')], messages, publishedUntil: 3 })
        expect(late).not.toContain('항구')
    })

    it('fills the budget with the new episode first, then the latest before it', () => {
        const documents = [event('e1', 'm1', 'a'.repeat(900)), event('e2', 'm3', 'b'.repeat(900)), event('e3', 'm5', 'c'.repeat(900))]
        const text = selectReaderBoardWiki({ documents, messages, publishedUntil: 5, focus: { start: 4, end: 5 }, limit: 2000 })
        expect(text).toContain('사건 e3')
        expect(text).toContain('사건 e2')
        expect(text).not.toContain('사건 e1')
    })

    it('returns nothing before anything is published', () => {
        expect(selectReaderBoardWiki({ documents: [event('e1', 'm1')], messages, publishedUntil: -1 })).toBe('')
    })
})
