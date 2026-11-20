import { describe, expect, test } from 'vitest'
import markdownit from 'markdown-it'
import {
    countWikiBacklinks,
    describeWikiLinkTarget,
    normalizeWikiLinkKey,
    resolveWikiLinkTarget,
    wikiLinkPlugin,
} from './wikiLink'

function document(title: string, aliases: string[] = []) {
    return { id: `id-${title}`, title, aliases } as never
}

function render(source: string, resolves?: (target: string) => boolean) {
    const md = markdownit({ html: false, breaks: false, linkify: false })
    md.use(wikiLinkPlugin, resolves ? { resolves } : {})
    return md.render(source).trim()
}

describe('resolveWikiLinkTarget', () => {
    const documents = [
        document('셀레나 스타폴', ['셀레나']),
        document('크라운헤이븐'),
    ]

    test('resolves an exact title', () => {
        expect(resolveWikiLinkTarget('크라운헤이븐', documents)?.title)
            .toBe('크라운헤이븐')
    })

    test('resolves an alias', () => {
        expect(resolveWikiLinkTarget('셀레나', documents)?.title)
            .toBe('셀레나 스타폴')
    })

    test('ignores casing and repeated whitespace', () => {
        expect(resolveWikiLinkTarget('  크라운헤이븐 ', documents)?.title)
            .toBe('크라운헤이븐')
        expect(resolveWikiLinkTarget('SELENA', [document('Selena')])?.title)
            .toBe('Selena')
    })

    test('returns null when a title collides with another document alias', () => {
        const shadowed = [document('알리아스', ['본명']), document('본명')]
        expect(resolveWikiLinkTarget('본명', shadowed)).toBeNull()
    })

    test('returns null when multiple documents share an alias', () => {
        const duplicated = [document('첫째', ['공통']), document('둘째', ['공통'])]
        expect(resolveWikiLinkTarget('공통', duplicated)).toBeNull()
    })

    test('still resolves an identifier repeated within one document', () => {
        const repeated = [document('본명', ['본명', '별칭'])]
        expect(resolveWikiLinkTarget('본명', repeated)?.title).toBe('본명')
    })

    test('returns null for an unknown or empty target', () => {
        expect(resolveWikiLinkTarget('없는문서', documents)).toBeNull()
        expect(resolveWikiLinkTarget('   ', documents)).toBeNull()
    })

    test('describes missing and ambiguous identifiers without guessing a winner', () => {
        const shadowed = [document('별칭 주인', ['공통']), document('공통')]

        expect(describeWikiLinkTarget('없는문서', shadowed)).toEqual({ status: 'missing' })
        expect(describeWikiLinkTarget('공통', shadowed)).toEqual({
            status: 'ambiguous',
            owners: shadowed,
        })
        expect(describeWikiLinkTarget('공통', [document('공통', ['공통'])])).toMatchObject({
            status: 'resolved', document: { title: '공통' },
        })
    })
})

describe('document id link targets', () => {
    const location = { id: 'location._Y9aUPRcvN-thmz2s26URj2y', title: '검은 이끼 골짜기', aliases: [] } as never
    const other = { id: 'location.other', title: 'location._y9aUPRcvN-thmz2s26URj2y', aliases: [] } as never

    test('resolves an exact internal id even when another title normalizes to it', () => {
        expect(describeWikiLinkTarget('location._Y9aUPRcvN-thmz2s26URj2y', [location, other]))
            .toEqual({ status: 'resolved', document: location })
    })

    test('renders an id link as a resolved link that keeps its display text', () => {
        const md = markdownit({ html: false, breaks: false, linkify: false })
        md.use(wikiLinkPlugin, {
            resolve: (target: string) => describeWikiLinkTarget(target, [location]).status === 'resolved'
                ? { status: 'resolved' } : { status: 'missing' },
        })
        const html = md.render('[[location._Y9aUPRcvN-thmz2s26URj2y|검은 이끼 골짜기]]에 도착했다.')
        expect(html).toContain('data-wikilink-status="resolved"')
        expect(html).toContain('>검은 이끼 골짜기</a>에 도착했다.')
        expect(html).not.toContain('[[')
    })

    test('counts backlinks written with the id', () => {
        expect(countWikiBacklinks(
            { id: 'location._Y9aUPRcvN-thmz2s26URj2y', title: '검은 이끼 골짜기' },
            [{ id: 'event.a', links: ['location._Y9aUPRcvN-thmz2s26URj2y|검은 이끼 골짜기'] }]
        )).toBe(1)
    })
})

describe('wikiLinkPlugin', () => {
    test('renders a wikilink as an anchor carrying the target', () => {
        expect(render('[[셀레나 스타폴]]')).toBe(
            '<p><a data-wikilink="셀레나 스타폴" class="wikilink" role="link"'
            + ' tabindex="0">셀레나 스타폴</a></p>'
        )
    })

    test('uses the alias as the label and the target in the attribute', () => {
        expect(render('[[크라운헤이븐|수도]]')).toBe(
            '<p><a data-wikilink="크라운헤이븐" class="wikilink" role="link"'
            + ' tabindex="0">수도</a></p>'
        )
    })

    test('marks unresolved targets so they can be styled', () => {
        const unresolved = render('[[없음]]', () => false)
        expect(unresolved).toContain('wikilink wikilink-unresolved')
        // Activating an unresolved link does nothing, so keep it out of the tab order.
        expect(unresolved).not.toContain('tabindex')
        const resolved = render('[[있음]]', () => true)
        expect(resolved).not.toContain('wikilink-unresolved')
        expect(resolved).toContain('tabindex="0"')
    })

    test('renders missing and ambiguous status with accessible diagnostics', () => {
        const md = markdownit({ html: false, breaks: false, linkify: false })
        md.use(wikiLinkPlugin, {
            resolve: (target) => target === '충돌'
                ? { status: 'ambiguous', description: '이름이 겹칩니다: 문서 A, 문서 B' }
                : { status: 'missing', description: `연결된 문서가 없습니다: ${target}` },
        })
        const html = md.render('[[없음]] [[충돌]]')

        expect(html).toContain('class="wikilink wikilink-unresolved"')
        expect(html).toContain('data-wikilink-status="missing"')
        expect(html).toContain('title="연결된 문서가 없습니다: 없음"')
        expect(html).toContain('class="wikilink wikilink-unresolved wikilink-ambiguous"')
        expect(html).toContain('data-wikilink-status="ambiguous"')
        expect(html).toContain('title="이름이 겹칩니다: 문서 A, 문서 B"')
        expect(html.match(/role="button" tabindex="0"/g)).toHaveLength(2)
    })

    test('leaves code spans and fenced blocks untouched', () => {
        expect(render('`[[코드]]`')).toBe('<p><code>[[코드]]</code></p>')
        expect(render('```\n[[코드]]\n```')).toContain('[[코드]]')
        expect(render('`[[코드]]`')).not.toContain('data-wikilink')
    })

    test('escapes markup in the target attribute and label', () => {
        expect(render('[[a<b>"c]]')).toBe(
            '<p><a data-wikilink="a&lt;b&gt;&quot;c" class="wikilink" role="link"'
            + ' tabindex="0">a&lt;b&gt;&quot;c</a></p>'
        )
    })

    test('ignores malformed or empty links', () => {
        for (const source of ['[[]]', '[[   ]]', '[[a', '[[a|]]', '[[|b]]']) {
            expect(render(source)).not.toContain('data-wikilink')
        }
    })

    test('renders several links in one paragraph', () => {
        const html = render('[[A]] and [[B|비]]')
        expect(html).toContain('data-wikilink="A"')
        expect(html).toContain('data-wikilink="B"')
        expect(html).toContain('>비<')
    })

    test('does not swallow ordinary markdown links', () => {
        expect(render('[label](https://example.com)')).toContain('href="https://example.com"')
    })

    test('preserves an ordinary markdown link containing wikilink syntax', () => {
        const html = render('[see [[Target]]](https://example.com)')
        expect(html).toContain('href="https://example.com"')
        expect(html).not.toContain('data-wikilink')
    })
})

describe('normalizeWikiLinkKey', () => {
    test('collapses whitespace and lowercases', () => {
        expect(normalizeWikiLinkKey('  Foo   Bar ')).toBe('foo bar')
    })
})

describe('countWikiBacklinks', () => {
    test('counts links to the title or any alias with normalized keys, excluding the target itself', () => {
        const target = { id: 'lavian', title: '라비안 스타폴', aliases: ['기사님'], links: [] }
        const documents = [
            target,
            { id: 'a', title: 'A', aliases: [], links: ['라비안  스타폴'] },
            { id: 'b', title: 'B', aliases: [], links: ['기사님|그 사람'] },
            { id: 'c', title: 'C', aliases: [], links: ['기사님#과거'] },
            { id: 'd', title: 'D', aliases: [], links: ['다른 사람'] },
            { id: 'lavian', title: '라비안 스타폴', aliases: [], links: ['기사님'] },
        ]
        expect(countWikiBacklinks(target, documents)).toBe(3)
    })
})

describe('evidence marks (#N)', () => {
    const events = new Map([[4, 'event.a'], [9, 'event.b'], [10, 'event.c']])
    function renderMarks(source: string, typographer = true) {
        const md = markdownit({ html: false, breaks: false, linkify: false, typographer })
        md.use(wikiLinkPlugin, { eventMarkTarget: (sequence: number) => events.get(sequence) })
        return md.render(source).trim()
    }
    const link = (id: string, label: string) =>
        `<a data-wikilink="${id}" class="wikilink wikilink-event-mark" data-wikilink-status="resolved" role="link" tabindex="0">${label}</a>`

    test('links a single mark to its event', () => {
        expect(renderMarks('검을 잃었다. (#10)'))
            .toBe(`<p>검을 잃었다. (${link('event.c', '#10')})</p>`)
    })

    test('links both ends of a range and each listed number', () => {
        expect(renderMarks('사이가 나빠졌다 (#4–#9)'))
            .toBe(`<p>사이가 나빠졌다 (${link('event.a', '#4')}–${link('event.b', '#9')})</p>`)
        expect(renderMarks('(#4, #10)'))
            .toBe(`<p>(${link('event.a', '#4')}, ${link('event.c', '#10')})</p>`)
    })

    test('leaves unknown numbers, stray hashes and code alone', () => {
        expect(renderMarks('(#4–#77)'))
            .toBe(`<p>(${link('event.a', '#4')}–#77)</p>`)
        expect(renderMarks('#10 번째, (메모 #10), (#10 참고)')).toBe('<p>#10 번째, (메모 #10), (#10 참고)</p>')
        expect(renderMarks('`(#10)`')).toBe('<p><code>(#10)</code></p>')
    })

    test('stays plain text without an event lookup', () => {
        expect(render('(#10)')).toBe('<p>(#10)</p>')
    })
})
