import { describe, expect, it } from 'vitest'
import {
    addAuthorPost,
    addComment,
    analyzeChat,
    applyGenerationResult,
    applyRosterResult,
    banReader,
    buildGenerationRequest,
    canDeleteEpisode,
    cleanStoryText,
    deleteEpisode,
    createReaderBoard,
    findMatchingBoards,
    forkReaderBoard,
    normalizeReaderBoard,
    normalizeReaderBoardIndex,
    orderComments,
    parseModelJson,
    parseReaderBoardImport,
    pickActiveReaders,
    prepareGeneration,
    renderReaderBoardHtml,
    simulateAudience,
    splitRange,
    stripEpisodeNumber,
    totalSubscribers,
    startNewWork,
    summarizeReaderBoard,
    workScore,
    toMessageView,
    type ChatMessageView,
    type ReaderBoard,
} from './readerBoard'

const CHAT = 'char:chat-a'

function views(count: number, prefix = 'm'): ChatMessageView[] {
    return Array.from({ length: count }, (_, i) => toMessageView({ role: i % 2 ? 'char' : 'user', data: `본문 ${i}`, chatId: `${prefix}${i}` }, i % 2 ? '앨리스' : '나'))
}

let id = 0
const createId = () => `id-${++id}`

function boardWithReaders(): ReaderBoard {
    const board = createReaderBoard({ id: 'b1', name: '테스트', characterId: 'char', chatKey: CHAT, now: 1 })
    applyRosterResult(board, { readers: [
        { handle: 'knight0011', persona: '깐깐함', taste: '복선', dealbreakers: '개연성 구멍', level: 3, activity: 1 },
        { handle: '새벽감자', persona: '다정함', taste: '로맨스', dealbreakers: '전개가 느림', level: 1, activity: 1 },
    ] }, createId)
    return board
}

/** Publishes messages [start, end] as one episode with a minimal valid reply. */
function publish(board: ReaderBoard, chat: ChatMessageView[], start: number, end: number, chatKey = CHAT): ReaderBoard {
    const plan = prepareGeneration({ board, chatKey, views: chat, range: { start, end }, random: () => 0, now: 1000 + start })!
    applyGenerationResult(plan, {
        episode: { title: '부제', summary: `요약 ${start}` },
        comments: [{ postNo: plan.episodePostNo ?? plan.targetPostNos[0], author: 'knight0011', text: '읽었음' }],
        readerUpdates: [{ handle: 'knight0011', opinion: '아직 모르겠음', newTheories: ['토끼는 은유'], scores: { fun: 6, immersion: 7, plausibility: 5, nextIntent: 8 } }],
    }, { createId, now: 1000 + start })
    return plan.board
}

describe('analyzeChat', () => {
    it('starts after the last published episode', () => {
        const chat = views(6)
        const board = publish(boardWithReaders(), chat, 0, 3)
        const analysis = analyzeChat(board, CHAT, chat)
        expect(analysis.lineage).toHaveLength(1)
        expect(analysis.nextStart).toBe(4)
        // Only the character message of the two left counts.
        expect(analysis.pending).toBe(1)
    })

    it('retracts the rewound episode and every later one of the same chat', () => {
        const chat = views(9)
        let board = publish(boardWithReaders(), chat, 0, 2)
        board = publish(board, chat, 3, 5)
        board = publish(board, chat, 6, 8)
        // Rewind to message 4 and write something new.
        const rewound = [...chat.slice(0, 4), ...views(3, 'n')]
        const analysis = analyzeChat(board, CHAT, rewound)
        expect(analysis.lineage.map((episode) => episode.no)).toEqual([1])
        expect(analysis.removed.map((episode) => episode.no)).toEqual([2, 3])
        // Episode 1 holds only m1; the user turn m2 waits for the next one.
        expect(analysis.nextStart).toBe(2)
    })

    it('reports an edited message without retracting the episode', () => {
        const chat = views(4)
        const board = publish(boardWithReaders(), chat, 0, 3)
        const edited = chat.map((view, i) => i === 3 ? toMessageView({ role: 'char', data: '고친 본문', chatId: 'm3' }, '앨리스') : view)
        const analysis = analyzeChat(board, CHAT, edited)
        expect(analysis.removed).toHaveLength(0)
        expect(analysis.edited).toHaveLength(1)
    })

    it('ignores episodes another chat of a shared board published', () => {
        const chat = views(4)
        const board = publish(boardWithReaders(), chat, 0, 3, 'char:other')
        const analysis = analyzeChat(board, CHAT, views(2, 'x'))
        expect(analysis.removed).toHaveLength(0)
        expect(analysis.nextStart).toBe(0)
    })
})

describe('prepareGeneration', () => {
    it('opens an event post and a revised episode after a rewind', () => {
        const chat = views(6)
        let board = publish(boardWithReaders(), chat, 0, 2)
        board = publish(board, chat, 3, 5)
        const rewound = [...chat.slice(0, 3), ...views(2, 'n')]
        const plan = prepareGeneration({ board, chatKey: CHAT, views: rewound, range: { start: 0, end: 4 }, random: () => 0 })!
        expect(plan.events[0]).toContain('2화')
        expect(plan.board.posts.find((post) => post.no === plan.eventPostNo)?.kind).toBe('event')
        expect(plan.episode).toMatchObject({ no: 2, revision: 1, messageKeys: ['n1'] })
        expect(plan.board.episodes.filter((episode) => episode.status === 'retracted')).toHaveLength(1)
        // The stored board is untouched until the reply is applied.
        expect(board.episodes.every((episode) => episode.status === 'published')).toBe(true)
        const request = buildGenerationRequest(plan, '이상한 나라')
        expect(request[1].content).toContain('내려간 화')
    })

    it('returns null when there is nothing to react to', () => {
        const chat = views(2)
        const board = publish(boardWithReaders(), chat, 0, 1)
        expect(prepareGeneration({ board, chatKey: CHAT, views: chat, range: { start: 0, end: 1 } })).toBeNull()
    })

    it('runs for an author post alone and brings the answered reader', () => {
        const chat = views(2)
        const board = publish(boardWithReaders(), chat, 0, 1)
        const post = addAuthorPost(board, { title: '공지', body: '설정을 고쳤습니다.' })
        const first = board.posts[0]
        addComment(board, first.no, { author: '작가', text: '감사합니다', replyTo: `${first.no}-1`, byAuthor: true })
        const plan = prepareGeneration({ board: { ...board, settings: { ...board.settings, readersPerRun: 1 } }, chatKey: CHAT, views: chat, random: () => 0.99 })!
        expect(plan.targetPostNos).toEqual([first.no, post.no].sort((a, b) => a - b))
        expect(plan.activeHandles).toContain('knight0011')
    })
})

describe('applyGenerationResult', () => {
    it('keeps reader memory, metrics and drops, and never speaks as the author', () => {
        const chat = views(2)
        const board = boardWithReaders()
        const plan = prepareGeneration({ board, chatKey: CHAT, views: chat, range: { start: 0, end: 1 }, random: () => 0 })!
        const result = applyGenerationResult(plan, {
            episode: { title: '토끼굴', summary: '앨리스가 토끼를 만난다.' },
            comments: [
                { postNo: plan.episodePostNo, author: 'knight0011', text: '개연성 없음' },
                { postNo: plan.episodePostNo, author: '새벽감자', text: '귀여워요', replyTo: `${plan.episodePostNo}-1` },
                { postNo: plan.episodePostNo, author: '작가', text: '가짜 작가' },
                { postNo: 999, author: 'knight0011', text: '없는 글' },
            ],
            readerUpdates: [
                { handle: 'knight0011', opinion: '별로', newTheories: ['토끼가 범인'], subscribed: false, scores: { fun: 2, immersion: 3, plausibility: 1, nextIntent: 0 } },
                { handle: '새벽감자', scores: { fun: 8, immersion: 9, plausibility: 7, nextIntent: 10 } },
            ],
        }, { createId })
        expect(result).toMatchObject({ comments: 2, dropped: ['knight0011'] })
        const post = plan.board.posts.find((item) => item.no === plan.episodePostNo)!
        expect(post.title).toBe('1화 토끼굴')
        expect(post.comments.map((comment) => comment.author)).toEqual(['knight0011', '새벽감자'])
        expect(post.comments[1].replyTo).toBe(`${post.no}-1`)
        expect(plan.board.metrics[0]).toMatchObject({ fun: 5, raters: 2, subscribers: 1, dropped: ['knight0011'] })
        expect(plan.board.readers[0].theories[0]).toMatchObject({ text: '토끼가 범인', status: 'open' })
    })

    it('resolves a theory by id', () => {
        const chat = views(4)
        const board = publish(boardWithReaders(), chat, 0, 1)
        const theory = board.readers[0].theories[0]
        const plan = prepareGeneration({ board, chatKey: CHAT, views: chat, range: { start: 2, end: 3 }, random: () => 0 })!
        applyGenerationResult(plan, {
            episode: { title: '', summary: '' },
            comments: [{ postNo: plan.episodePostNo, author: 'knight0011', text: '아 그게 복선이었네' }],
            readerUpdates: [{ handle: 'knight0011', resolved: [{ id: theory.id, status: 'confirmed', note: '맞았다' }] }],
        }, { createId })
        expect(plan.board.readers[0].theories[0]).toMatchObject({ status: 'confirmed', note: '맞았다' })
    })

    it('fails without any comment so the board is not saved half done', () => {
        const plan = prepareGeneration({ board: boardWithReaders(), chatKey: CHAT, views: views(2), range: { start: 0, end: 1 } })!
        expect(() => applyGenerationResult(plan, { comments: [] }, { createId })).toThrow()
    })
})

describe('fork and matching', () => {
    it('finds the board of a copied chat and lets the fork retract inherited episodes', () => {
        const chat = views(6)
        let board = publish(boardWithReaders(), chat, 0, 2)
        board = publish(board, chat, 3, 5)
        const index = normalizeReaderBoardIndex({ boards: [summarizeReaderBoard(board)], links: { [CHAT]: board.id } })
        // A save slot loaded into a new chat keeps message ids up to the save point.
        const loaded = chat.slice(0, 3)
        expect(findMatchingBoards(index, loaded).map((item) => item.id)).toEqual([board.id])
        const fork = forkReaderBoard(board, { id: 'b2', chatKey: 'char:chat-b' })
        expect(fork.forkedFrom).toMatchObject({ boardId: board.id })
        const analysis = analyzeChat(fork, 'char:chat-b', loaded)
        expect(analysis.removed.map((episode) => episode.no)).toEqual([2])
    })
})

describe('pickActiveReaders', () => {
    it('always includes mentioned readers and respects the count', () => {
        const board = boardWithReaders()
        const picked = pickActiveReaders(board.readers, 1, () => 0, ['새벽감자'])
        expect(picked.map((reader) => reader.handle)).toEqual(['새벽감자'])
    })
})

describe('parsing and files', () => {
    it('reads JSON wrapped in a fence or prose', () => {
        expect(parseModelJson('설명\n```json\n{"a":1}\n```')).toEqual({ a: 1 })
        expect(parseModelJson('앞 {"b":2} 뒤')).toEqual({ b: 2 })
        expect(() => parseModelJson('없음')).toThrow()
    })

    it('round-trips a board through the HTML export', () => {
        const chat = views(2)
        const board = publish(boardWithReaders(), chat, 0, 1)
        board.posts[0].comments[0].text = '</script><b>태그</b>'
        const html = renderReaderBoardHtml(board)
        expect(html).not.toContain('</script><b>')
        const back = parseReaderBoardImport(html)
        expect(back.posts[0].comments[0].text).toBe('</script><b>태그</b>')
        expect(back.readers).toHaveLength(2)
    })

    it('rejects files that are not boards', () => {
        expect(() => parseReaderBoardImport('<html></html>')).toThrow()
        expect(normalizeReaderBoard({ nope: true })).toBeNull()
    })
})

describe('user turns', () => {
    it('leaves the user messages out of the episode', () => {
        const chat = views(4)
        const plan = prepareGeneration({ board: boardWithReaders(), chatKey: CHAT, views: chat, range: { start: 0, end: 3 }, random: () => 0 })!
        expect(plan.episode?.messageKeys).toEqual(['m1', 'm3'])
        expect(plan.episodeText).toContain('본문 1')
        expect(plan.episodeText).not.toContain('본문 0')
        expect(plan.episodeText).not.toContain('[나]')
    })

    it('publishes nothing when the range holds only user messages', () => {
        const chat = views(1)
        expect(prepareGeneration({ board: boardWithReaders(), chatKey: CHAT, views: chat, range: { start: 0, end: 0 } })).toBeNull()
    })
})

describe('splitRange', () => {
    it('cuts a long range into episodes of N character messages', () => {
        const chat = views(10)
        // Characters at 1, 3, 5, 7, 9.
        expect(splitRange(chat, 0, 9, 2)).toEqual([{ start: 0, end: 3 }, { start: 4, end: 7 }, { start: 8, end: 9 }])
        expect(splitRange(chat, 0, 9, 5)).toEqual([{ start: 0, end: 9 }])
        // A trailing user turn waits for the next episode.
        expect(splitRange(chat, 0, 8, 2)).toEqual([{ start: 0, end: 3 }, { start: 4, end: 7 }])
    })

    it('publishes the parts as consecutive episodes', () => {
        const chat = views(8)
        let board = boardWithReaders()
        for (const range of splitRange(chat, 0, 7, 2)) board = publish(board, chat, range.start, range.end)
        expect(board.episodes.map((episode) => [episode.no, episode.messageKeys])).toEqual([[1, ['m1', 'm3']], [2, ['m5', 'm7']]])
        expect(analyzeChat(board, CHAT, chat).pending).toBe(0)
    })
})

describe('works', () => {
    const NEXT = 'char:chat-b'

    function withEndedWork(kind: 'new' | 'reboot' = 'new'): ReaderBoard {
        const chat = views(6)
        let board = publish(boardWithReaders(), chat, 0, 1)
        board = publish(board, chat, 2, 3)
        board = publish(board, chat, 4, 5)
        startNewWork(board, { id: 'w2', title: '신작', kind, chatKey: NEXT, notice: { title: '공지', body: '이전 작품을 즐겨 주셔서 감사합니다.' }, welcomeBack: true, now: 5000 })
        return board
    }

    it('ends the current work and starts numbering again on the new chat', () => {
        const board = withEndedWork()
        expect(board.works.map((work) => [work.id, work.status])).toEqual([['w1', 'ended'], ['w2', 'serial']])
        expect(board.chatKeys).toEqual([NEXT])
        const chat = views(4, 'x')
        // The old episodes are not in the new chat, yet nothing is rewound.
        const analysis = analyzeChat(board, NEXT, chat)
        expect(analysis.removed).toEqual([])
        expect(analysis.nextStart).toBe(0)
        const plan = prepareGeneration({ board, chatKey: NEXT, views: chat, range: { start: 0, end: 3 }, random: () => 0 })!
        expect(plan.episode).toMatchObject({ no: 1, revision: 0, workId: 'w2' })
        expect(plan.events).toEqual([])
        // The notice waits for the readers.
        expect(plan.targetPostNos).toContain(board.posts.find((post) => post.kind === 'author')!.no)
    })

    it('keeps who the readers are and folds their thoughts into a verdict', () => {
        const board = withEndedWork()
        const reader = board.readers.find((item) => item.handle === 'knight0011')!
        expect(reader.persona).toBe('깐깐함')
        expect(reader.opinion).toBe('')
        expect(reader.pastOpinions).toEqual([{ workId: 'w1', opinion: '아직 모르겠음' }])
        expect(reader.theories.every((theory) => theory.workId === 'w1')).toBe(true)
    })

    it('tells the readers to compare, not to count restarts', () => {
        const board = withEndedWork()
        const plan = prepareGeneration({ board, chatKey: NEXT, views: views(2, 'x'), range: { start: 0, end: 1 }, random: () => 0 })!
        const [system, user] = buildGenerationRequest(plan, '이상한 나라')
        expect(system.content).toContain('몇 번째 새로 시작하는지')
        expect(system.content).toContain('다른 새 이야기')
        expect(user.content).toContain('이전 작품 총평: 아직 모르겠음')
        expect(user.content).toContain('이전 작품 전체 평균')
        expect(user.content).toContain('작품 이름: 신작')
        // Old theories and episode summaries stay out of a new story.
        expect(user.content).not.toContain('토끼는 은유')
        expect(user.content).not.toContain('요약 0')
        expect(user.content).not.toMatch(/작품 \d|번째 작품/)
    })

    it('shows the previous version episode by episode for a rewrite', () => {
        const board = withEndedWork('reboot')
        const plan = prepareGeneration({ board, chatKey: NEXT, views: views(2, 'x'), range: { start: 0, end: 1 }, random: () => 0 })!
        const [system, user] = buildGenerationRequest(plan, '이상한 나라')
        expect(system.content).toContain('처음부터 다시 쓴 판')
        expect(user.content).toContain('요약 0')
    })

    it('scores each work separately and can compare openings', () => {
        const board = withEndedWork()
        const next = publish(board, views(2, 'x'), 0, 1, NEXT)
        expect(workScore(next, 'w1')).toMatchObject({ episodes: 3, fun: 6 })
        expect(workScore(next, 'w1', 1).episodes).toBe(1)
        expect(workScore(next, 'w2')).toMatchObject({ episodes: 1, fun: 6 })
        expect(next.metrics.map((metric) => metric.workId)).toEqual(['w1', 'w1', 'w1', 'w2'])
        expect(summarizeReaderBoard(next)).toMatchObject({ episodeCount: 1, workCount: 2, workTitle: '신작' })
    })

    it('reads a board saved before works existed as one work', () => {
        const legacy = JSON.parse(JSON.stringify(publish(boardWithReaders(), views(2), 0, 1)))
        delete legacy.works
        delete legacy.currentWorkId
        for (const episode of legacy.episodes) delete episode.workId
        for (const metric of legacy.metrics) delete metric.workId
        for (const reader of legacy.readers) {
            delete reader.pastOpinions
            for (const theory of reader.theories) delete theory.workId
        }
        const board = normalizeReaderBoard(legacy)!
        expect(board.works).toHaveLength(1)
        expect(board.currentWorkId).toBe(board.works[0].id)
        expect(board.episodes[0].workId).toBe(board.works[0].id)
        expect(board.metrics[0].workId).toBe(board.works[0].id)
        expect(board.readers[0].pastOpinions).toEqual([])
        expect(analyzeChat(board, CHAT, views(2)).lineage).toHaveLength(1)
    })
})

describe('story cleanup', () => {
    it('drops markup but keeps the words of a status window', () => {
        const text = cleanStoryText('앨리스가 웃었다.<img src="a.png">\n![삽화](x.png)\n{{img::smile}}<div class="status"><b>HP</b> 10/10</div><!-- 메모 --><style>.a{}</style>')
        expect(text).toBe('앨리스가 웃었다.\n\nHP 10/10')
    })

    it('tells the readers not to treat leftovers or AI as a story problem', () => {
        const chat = views(2)
        const plan = prepareGeneration({ board: boardWithReaders(), chatKey: CHAT, views: chat, range: { start: 0, end: 1 }, random: () => 0 })!
        const [system] = buildGenerationRequest(plan, '이상한 나라')
        expect(system.content).toContain('상태창')
        expect(system.content).toContain('AI로 쓰였거나')
    })
})

describe('comment order', () => {
    it('puts each reply under the comment it answers', () => {
        const board = boardWithReaders()
        const post = addAuthorPost(board, { title: '공지', body: '본문' })
        addComment(board, post.no, { author: 'a', text: '첫 댓글' })
        addComment(board, post.no, { author: 'b', text: '둘째 댓글' })
        addComment(board, post.no, { author: 'c', text: '첫 댓글에 답', replyTo: `${post.no}-1` })
        addComment(board, post.no, { author: 'd', text: '둘째 댓글에 답', replyTo: `${post.no}-2` })
        expect(orderComments(post).map(({ comment, reply }) => [comment.author, reply])).toEqual([['a', false], ['c', true], ['b', false], ['d', true]])
    })
})

describe('one post', () => {
    it('reacts to a single post and leaves rewinds and new turns for later', () => {
        const chat = views(4)
        let board = publish(boardWithReaders(), chat, 0, 1)
        const first = board.posts.find((post) => post.kind === 'episode')!
        addComment(board, first.no, { author: '작가', text: '감사합니다', replyTo: `${first.no}-1`, byAuthor: true })
        const other = addAuthorPost(board, { title: '공지', body: '다른 글' })
        // Rewound chat: episode 1 is gone.
        const plan = prepareGeneration({ board, chatKey: CHAT, views: views(4, 'z'), onlyPostNo: first.no, range: { start: 0, end: 3 }, random: () => 0 })!
        expect(plan.targetPostNos).toEqual([first.no])
        expect(plan.episode).toBeUndefined()
        expect(plan.events).toEqual([])
        applyGenerationResult(plan, { comments: [{ postNo: first.no, author: 'knight0011', text: '네', replyTo: `${first.no}-2` }] }, { createId })
        board = plan.board
        expect(board.pendingAuthor).toEqual([{ postNo: other.no }])
        expect(board.episodes[0].status).toBe('published')
    })
})

describe('deleting and banning', () => {
    it('deletes only the newest episode, which can then be published again', () => {
        const chat = views(6)
        let board = publish(boardWithReaders(), chat, 0, 1)
        board = publish(board, chat, 2, 3)
        const [first, second] = board.episodes
        expect(canDeleteEpisode(board, first.id)).toBe(false)
        expect(deleteEpisode(board, second.id)).toBe(true)
        expect(board.posts.some((post) => post.no === second.postNo)).toBe(false)
        expect(board.metrics).toHaveLength(1)
        expect(analyzeChat(board, CHAT, chat).nextStart).toBe(2)
        expect(canDeleteEpisode(board, first.id)).toBe(true)
    })

    it('keeps a banned reader out of every later run', () => {
        const board = boardWithReaders()
        const knight = board.readers.find((reader) => reader.handle === 'knight0011')!
        const post = addAuthorPost(board, { title: '공지', body: '본문' })
        addComment(board, post.no, { author: 'knight0011', text: '별로' })
        banReader(board, knight.id, true)
        expect(post.comments).toEqual([])
        expect(pickActiveReaders(board.readers, 5, () => 0, ['knight0011']).map((reader) => reader.handle)).toEqual(['새벽감자'])
        const plan = prepareGeneration({ board, chatKey: CHAT, views: views(2), range: { start: 0, end: 1 }, random: () => 0 })!
        expect(buildGenerationRequest(plan, '이상한 나라')[1].content).not.toContain('knight0011')
        applyGenerationResult(plan, { comments: [
            { postNo: plan.episodePostNo, author: 'knight0011', text: '몰래 옴' },
            { postNo: plan.episodePostNo, author: '새벽감자', text: '좋아요' },
        ] }, { createId })
        expect(plan.board.posts.find((item) => item.no === plan.episodePostNo)!.comments.map((comment) => comment.author)).toEqual(['새벽감자'])
        expect(normalizeReaderBoard(JSON.parse(JSON.stringify(plan.board)))!.readers.find((reader) => reader.handle === 'knight0011')?.banned).toBe(true)
    })
})

describe('silent audience', () => {
    it('grows with good scores and shrinks when nobody wants the next episode', () => {
        const good = simulateAudience({ subscribers: 100, scores: { fun: 9, immersion: 8, nextIntent: 9 }, previousIntent: 8, seed: 'a' })
        const bad = simulateAudience({ subscribers: 100, scores: { fun: 3, immersion: 3, nextIntent: 2 }, previousIntent: 8, seed: 'a' })
        expect(good.subscribers).toBeGreaterThan(100)
        expect(bad.subscribers).toBeLessThan(100)
        expect(good.views).toBeGreaterThan(bad.views)
        expect(simulateAudience({ subscribers: 100, scores: { fun: 9, immersion: 8, nextIntent: 9 }, previousIntent: 8, seed: 'a' })).toEqual(good)
    })

    it('counts lurkers on top of the named readers and takes them back with a deleted episode', () => {
        const chat = views(2)
        const board = publish(boardWithReaders(), chat, 0, 1)
        const metric = board.metrics[0]
        expect(metric.views).toBeGreaterThan(0)
        expect(board.audience.subscribers).toBe(metric.audienceSubscribers)
        expect(totalSubscribers(board)).toBe(board.audience.subscribers + 2)
        const plan = prepareGeneration({ board, chatKey: CHAT, views: views(4), range: { start: 2, end: 3 }, random: () => 0 })!
        expect(buildGenerationRequest(plan, '이상한 나라')[1].content).toContain('게시판 규모: 구독자 약')
        deleteEpisode(board, board.episodes[0].id)
        expect(board.audience.subscribers).toBe(0)
    })
})

describe('episode titles', () => {
    it('drops a repeated episode number from the subtitle', () => {
        expect(stripEpisodeNumber('2화 제3 화물 야적장의 총성')).toBe('제3 화물 야적장의 총성')
        expect(stripEpisodeNumber('제12화: 귀환')).toBe('귀환')
        expect(stripEpisodeNumber('3화물 창고')).toBe('3화물 창고')
    })
})

describe('index options', () => {
    it('keeps concept presets and the look', () => {
        const index = normalizeReaderBoardIndex({ boards: [], links: {}, conceptPresets: [{ id: 'p1', name: '추리', concept: '깐깐함', level: 9, harshness: 3 }, { id: 'bad' }], appearance: { style: 'forum', scale: 2 } })
        expect(index.conceptPresets).toEqual([{ id: 'p1', name: '추리', concept: '깐깐함', level: 4, harshness: 3 }])
        expect(index.appearance).toEqual({ style: 'forum', scale: 1.4 })
        expect(normalizeReaderBoardIndex(null).appearance).toEqual({ style: 'card', scale: 1 })
    })
})
