import { describe, expect, it } from 'vitest'
import { countText, measureNovel, proseText } from './novelVolume'
import { toMessageView } from './readerBoard'

describe('proseText', () => {
    it('keeps the story and drops status windows, images and code', () => {
        const raw = [
            '<p>쿠루미가 <b>정문</b> 앞에서 기다린다.</p>',
            '<status>HP: 100/100\n위치: 정문</status>',
            '<img src="a.png">',
            '{{img::smile}}',
            '![삽화](b.png)',
            '```\n[상태창]\n호감도 30\n```',
            '[STATUS]기분: 좋음[/STATUS]',
            '| 이름 | 호감도 |',
            '━━━━━━━━',
            '"……!"',
            '<!-- OOC_turn -->',
        ].join('\n')
        expect(proseText(raw)).toBe('쿠루미가 정문 앞에서 기다린다.\n"……!"')
    })

    it('drops nested custom blocks with what is inside them', () => {
        expect(proseText('앞 문장.<info><stat><b>힘</b> 10</stat>설명</info> 뒷 문장.')).toBe('앞 문장. 뒷 문장.')
    })
})

describe('countText', () => {
    it('counts characters with and without spaces, ignoring line breaks', () => {
        const count = countText('가나 다\n라마')
        expect(count.withSpaces).toBe(6)
        expect(count.withoutSpaces).toBe(5)
        expect(count.words).toBe(3)
    })
})

describe('measureNovel', () => {
    it('counts only story turns: no user messages and no OOC turns', () => {
        const views = [
            toMessageView({ role: 'user', data: '계속 해 줘. 아주 긴 사용자 메시지'.repeat(20), chatId: 'u1' }, '나'),
            toMessageView({ role: 'char', data: '가'.repeat(5_000), chatId: 'c1' }, '쿠루미'),
            toMessageView({ role: 'char', data: '<!-- OOC_turn -->\n작가님, 다음 전개는 어떻게 할까요?'.repeat(50), chatId: 'c2' }, '쿠루미'),
            toMessageView({ role: 'char', data: '나'.repeat(5_000), chatId: 'c3' }, '쿠루미'),
        ]
        const volume = measureNovel(views)
        expect(volume.language).toBe('ko')
        expect(volume.turns).toBe(2)
        expect(volume.size).toBe(10_000)
        expect(volume.perTurn).toBe(5_000)
        expect(volume.episodes).toBe(2)
        expect(volume.ebooks).toBeCloseTo(0.08)
        expect(volume.manuscriptPages).toBe(50)
    })

    it('measures an English chat in words', () => {
        const volume = measureNovel([toMessageView({ role: 'char', data: 'The rain did not stop. '.repeat(600), chatId: 'c1' }, 'Kurumi')])
        expect(volume.language).toBe('en')
        expect(volume.size).toBe(3_000)
        expect(volume.episodes).toBe(1)
        expect(volume.manuscriptPages).toBeUndefined()
    })
})
