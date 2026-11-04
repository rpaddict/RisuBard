// Reader board: a simulated web-novel reader forum that lives beside the chat.
// The story can be rewound and branched, but the board only moves forward in
// real time: readers remember episodes the author later took down.
//
// This module is pure (no storage, no requests) so the data rules are testable.

export const READER_BOARD_VERSION = 1
export const AUTHOR_HANDLE_DEFAULT = '작가'
/** Episode text past this many characters is trimmed in the middle for the request. */
export const EPISODE_TEXT_LIMIT = 60_000
/** Earlier-work verdicts each reader keeps. */
const PAST_OPINION_LIMIT = 3

export type ReaderBoardModel = 'model' | 'otherAx'

export interface ReaderBoardSettings {
    /** Board purpose and mood, written by the user. */
    concept: string
    /** 0 casual .. 4 professional critic. */
    level: number
    /** 0 gentle .. 4 brutal. */
    harshness: number
    /** Readers who comment in one run. */
    readersPerRun: number
    /** Size of the first roster. */
    rosterSize: number
    /** Lets the model add up to two new readers per run. */
    allowNewcomers: boolean
    authorName: string
    /** Character messages per episode when splitting a long range; 0 publishes the range as one episode. */
    splitSize: number
    /** Gives the readers BardWiki notes on what was published. */
    useWiki: boolean
}

export type ReaderBoardWorkKind = 'new' | 'reboot'

/**
 * One story serialized on the board. Starting a new work ends the current
 * one; readers keep who they are but judge the new work on its own, only
 * comparing it with the work before.
 */
export interface ReaderBoardWork {
    id: string
    /** 1, 2, 3... in the order the works started. */
    no: number
    title: string
    /** 'reboot' retells the previous work from the start; 'new' is another story. */
    kind: ReaderBoardWorkKind
    status: 'serial' | 'ended'
    /** First post of this work (its start notice, or 1 for the first work). */
    startedPostNo: number
    endedPostNo?: number
    createdAt: number
    endedAt?: number
}

export interface ReaderTheory {
    id: string
    /** Work the theory is about. */
    workId: string
    text: string
    status: 'open' | 'confirmed' | 'refuted'
    /** Post number where the theory was raised or resolved. */
    postNo: number
    note?: string
}

export interface ReaderBoardReader {
    id: string
    handle: string
    persona: string
    taste: string
    dealbreakers: string
    level: number
    /** 0..1, how often the reader shows up. */
    activity: number
    /** Current thoughts about the current work. */
    opinion: string
    /** Last thoughts about earlier works, newest last. */
    pastOpinions: { workId: string; opinion: string }[]
    theories: ReaderTheory[]
    subscribed: boolean
    /** Banned by the author: never comments again. */
    banned?: boolean
    joinedPostNo: number
    lastActivePostNo: number
}

export interface ReaderBoardComment {
    /** Sequential within the post; never reused. */
    no: number
    author: string
    text: string
    /** `postNo-commentNo` of the comment this answers. */
    replyTo?: string
    byAuthor?: boolean
    createdAt: number
}

export type ReaderBoardPostKind = 'episode' | 'author' | 'event' | 'thread'

export interface ReaderBoardPost {
    no: number
    kind: ReaderBoardPostKind
    author: string
    title: string
    body: string
    episodeId?: string
    comments: ReaderBoardComment[]
    createdAt: number
}

export interface ReaderBoardEpisode {
    id: string
    workId: string
    /** Episode number in the work (restarts after a rewind). */
    no: number
    /** 0 for the first version of this number, then 1, 2... */
    revision: number
    title: string
    summary: string
    status: 'published' | 'retracted'
    /** Chat this episode was published from. */
    chatKey: string
    messageKeys: string[]
    messageHashes: string[]
    postNo: number
    createdAt: number
    retractedAt?: number
    editedAt?: number
}

export interface ReaderBoardMetric {
    episodeId: string
    workId: string
    postNo: number
    fun: number
    immersion: number
    plausibility: number
    nextIntent: number
    raters: number
    /** Named readers subscribed after this episode. */
    subscribers: number
    dropped: string[]
    joined: string[]
    /** Silent audience: people who read this episode and the lurkers subscribed after it. */
    views: number
    audienceSubscribers: number
    gained: number
    lost: number
}

export interface ReaderBoard {
    version: number
    id: string
    name: string
    characterId: string
    /** Chats linked to this board. More than one when shared. */
    chatKeys: string[]
    forkedFrom?: { boardId: string; boardName: string; postNo: number }
    settings: ReaderBoardSettings
    /** Always at least one; the last started one is current. */
    works: ReaderBoardWork[]
    currentWorkId: string
    readers: ReaderBoardReader[]
    episodes: ReaderBoardEpisode[]
    posts: ReaderBoardPost[]
    metrics: ReaderBoardMetric[]
    /**
     * Lurkers: the many who read and never comment. They are numbers, not
     * readers, and grow or shrink with the scores.
     */
    audience: { subscribers: number }
    nextPostNo: number
    nextTheoryNo: number
    /** Author posts and comments the readers have not answered yet. */
    pendingAuthor: { postNo: number; commentNo?: number }[]
    createdAt: number
    updatedAt: number
}

export interface ReaderBoardSummary {
    id: string
    name: string
    characterId: string
    chatKeys: string[]
    postCount: number
    readerCount: number
    subscriberCount: number
    /** Published episodes of the current work. */
    episodeCount: number
    workCount?: number
    workTitle?: string
    forkedFrom?: ReaderBoard['forkedFrom']
    /** First message key of each published episode of the current work, for finding a copied chat's board. */
    episodeKeys: string[]
    createdAt: number
    updatedAt: number
}

export interface ReaderBoardIndex {
    version: number
    boards: ReaderBoardSummary[]
    /** chatKey -> boardId */
    links: Record<string, string>
    model: ReaderBoardModel
    /** Extra system message sent first with every board request, for every board. */
    systemPrompt: string
    systemPromptEnabled: boolean
    /** Saved board moods to start a board from or switch to. */
    conceptPresets: ReaderBoardConceptPreset[]
    appearance: ReaderBoardAppearance
}

export interface ReaderBoardConceptPreset {
    id: string
    name: string
    concept: string
    level: number
    harshness: number
}

export type ReaderBoardStyle = 'card' | 'forum' | 'reading'

export interface ReaderBoardAppearance {
    style: ReaderBoardStyle
    /** Feed text size, 0.85 to 1.4. */
    scale: number
}

export const READER_BOARD_STYLES: { id: ReaderBoardStyle; label: string }[] = [
    { id: 'card', label: '카드' },
    { id: 'forum', label: '커뮤니티' },
    { id: 'reading', label: '읽기' },
]

function normalizeAppearance(value: unknown): ReaderBoardAppearance {
    const record = isRecord(value) ? value : {}
    const style = READER_BOARD_STYLES.some((item) => item.id === record.style) ? record.style as ReaderBoardStyle : 'card'
    const scale = Number(record.scale)
    return { style, scale: Number.isFinite(scale) ? Math.min(1.4, Math.max(0.85, Math.round(scale * 20) / 20)) : 1 }
}

function normalizeConceptPreset(value: unknown): ReaderBoardConceptPreset | null {
    if (!isRecord(value) || typeof value.id !== 'string' || typeof value.name !== 'string' || !value.name.trim()) return null
    return {
        id: value.id.slice(0, 80),
        name: value.name.trim().slice(0, 40),
        concept: text(value.concept, 4000),
        level: clampInt(value.level, 0, 4, 1),
        harshness: clampInt(value.harshness, 0, 4, 2),
    }
}

export const LEVEL_LABELS = ['가볍게 즐기는 독자', '일반 독자', '장르 애호가', '깐깐한 고인물', '전문 비평가'] as const
export const HARSHNESS_LABELS = ['다정함', '우호적', '솔직함', '냉정함', '가혹함'] as const

const LEVEL_PROMPTS = [
    '대부분 가볍게 읽고 재미 위주로 반응한다. 분석보다 감정과 응원이 많다.',
    '평범한 웹소설 독자들이다. 재미, 답답함, 캐릭터 호감을 솔직하게 말한다.',
    '장르 문법에 익숙한 애호가들이다. 클리셰, 전개 속도, 설정 일관성을 따진다.',
    '장르를 오래 읽은 깐깐한 독자들이다. 개연성 구멍, 캐릭터 붕괴, 복선 관리를 집요하게 지적한다.',
    '전문 비평가 수준의 독자들이다. 구조, 문체, 주제 의식, 서술 기법을 근거와 함께 평가한다.',
]
const HARSHNESS_PROMPTS = [
    '분위기는 다정하다. 불만도 부드럽게 돌려 말한다. 그래도 거짓 칭찬은 하지 않는다.',
    '분위기는 우호적이다. 좋은 점을 먼저 말하지만 문제는 분명히 짚는다.',
    '분위기는 솔직하다. 좋으면 좋다, 별로면 별로라고 그대로 말한다.',
    '분위기는 냉정하다. 칭찬은 아끼고 약점을 먼저 본다. 지루하면 바로 이탈한다.',
    '분위기는 가혹하다. 사소한 허점도 놓치지 않고 비꼬기도 한다. 기대를 채우지 못하면 미련 없이 떠난다.',
]

export function clampInt(value: unknown, min: number, max: number, fallback: number): number {
    const number = Math.round(Number(value))
    return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback
}

function text(value: unknown, max = 4000): string {
    return typeof value === 'string' ? value.slice(0, max) : ''
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function defaultReaderBoardSettings(): ReaderBoardSettings {
    return {
        concept: '',
        level: 1,
        harshness: 2,
        readersPerRun: 5,
        rosterSize: 12,
        allowNewcomers: true,
        authorName: AUTHOR_HANDLE_DEFAULT,
        splitSize: 0,
        useWiki: true,
    }
}

export function normalizeReaderBoardSettings(value: unknown): ReaderBoardSettings {
    const base = defaultReaderBoardSettings()
    if (!isRecord(value)) return base
    return {
        concept: text(value.concept, 4000),
        level: clampInt(value.level, 0, 4, base.level),
        harshness: clampInt(value.harshness, 0, 4, base.harshness),
        readersPerRun: clampInt(value.readersPerRun, 1, 15, base.readersPerRun),
        rosterSize: clampInt(value.rosterSize, 3, 40, base.rosterSize),
        allowNewcomers: typeof value.allowNewcomers === 'boolean' ? value.allowNewcomers : base.allowNewcomers,
        authorName: text(value.authorName, 40).trim() || AUTHOR_HANDLE_DEFAULT,
        splitSize: clampInt(value.splitSize, 0, 500, base.splitSize),
        useWiki: typeof value.useWiki === 'boolean' ? value.useWiki : base.useWiki,
    }
}

export function chatKeyOf(characterId: string, chatId: string): string {
    return `${characterId}:${chatId}`
}

const FIRST_WORK_ID = 'w1'

function firstWork(now: number): ReaderBoardWork {
    return { id: FIRST_WORK_ID, no: 1, title: '', kind: 'new', status: 'serial', startedPostNo: 1, createdAt: now }
}

export function createReaderBoard(input: {
    id: string
    name: string
    characterId: string
    chatKey?: string
    settings?: Partial<ReaderBoardSettings>
    now?: number
}): ReaderBoard {
    const now = input.now ?? Date.now()
    return {
        version: READER_BOARD_VERSION,
        id: input.id,
        name: input.name.trim() || '독자 게시판',
        characterId: input.characterId,
        chatKeys: input.chatKey ? [input.chatKey] : [],
        settings: normalizeReaderBoardSettings({ ...defaultReaderBoardSettings(), ...input.settings }),
        works: [firstWork(now)],
        currentWorkId: FIRST_WORK_ID,
        readers: [],
        episodes: [],
        posts: [],
        metrics: [],
        audience: { subscribers: 0 },
        nextPostNo: 1,
        nextTheoryNo: 1,
        pendingAuthor: [],
        createdAt: now,
        updatedAt: now,
    }
}

function workIdOf(value: unknown, fallback: string): string {
    return typeof value === 'string' && value ? value.slice(0, 80) : fallback
}

function normalizeWork(value: unknown): ReaderBoardWork | null {
    if (!isRecord(value) || typeof value.id !== 'string' || !value.id) return null
    return {
        id: value.id.slice(0, 80),
        no: clampInt(value.no, 1, 1e6, 1),
        title: text(value.title, 120).trim(),
        kind: value.kind === 'reboot' ? 'reboot' : 'new',
        status: value.status === 'ended' ? 'ended' : 'serial',
        startedPostNo: clampInt(value.startedPostNo, 1, 1e9, 1),
        ...(typeof value.endedPostNo === 'number' ? { endedPostNo: clampInt(value.endedPostNo, 0, 1e9, 0) } : {}),
        createdAt: clampInt(value.createdAt, 0, Number.MAX_SAFE_INTEGER, 0),
        ...(typeof value.endedAt === 'number' ? { endedAt: value.endedAt } : {}),
    }
}

function normalizeTheory(value: unknown, workId: string): ReaderTheory | null {
    if (!isRecord(value) || typeof value.id !== 'string' || typeof value.text !== 'string') return null
    const status = value.status === 'confirmed' || value.status === 'refuted' ? value.status : 'open'
    return {
        id: value.id,
        workId: workIdOf(value.workId, workId),
        text: text(value.text, 600),
        status,
        postNo: clampInt(value.postNo, 0, 1e9, 0),
        ...(typeof value.note === 'string' && value.note ? { note: text(value.note, 600) } : {}),
    }
}

function normalizeReader(value: unknown, workId = FIRST_WORK_ID): ReaderBoardReader | null {
    if (!isRecord(value) || typeof value.id !== 'string' || typeof value.handle !== 'string' || !value.handle.trim()) return null
    const activity = Number(value.activity)
    const pastOpinions = Array.isArray(value.pastOpinions)
        ? value.pastOpinions.filter(isRecord)
            .filter((item) => typeof item.workId === 'string' && typeof item.opinion === 'string' && item.opinion.trim())
            .map((item) => ({ workId: workIdOf(item.workId, workId), opinion: text(item.opinion, 800) }))
            .slice(-PAST_OPINION_LIMIT)
        : []
    return {
        id: value.id,
        handle: text(value.handle, 40).trim(),
        persona: text(value.persona, 800),
        taste: text(value.taste, 600),
        dealbreakers: text(value.dealbreakers, 600),
        level: clampInt(value.level, 0, 4, 1),
        activity: Number.isFinite(activity) ? Math.min(1, Math.max(0.05, activity)) : 0.6,
        opinion: text(value.opinion, 800),
        pastOpinions,
        theories: Array.isArray(value.theories) ? value.theories.map((item) => normalizeTheory(item, workId)).filter((item): item is ReaderTheory => !!item) : [],
        subscribed: value.subscribed !== false,
        ...(value.banned === true ? { banned: true } : {}),
        joinedPostNo: clampInt(value.joinedPostNo, 0, 1e9, 0),
        lastActivePostNo: clampInt(value.lastActivePostNo, 0, 1e9, 0),
    }
}

function normalizeComment(value: unknown): ReaderBoardComment | null {
    if (!isRecord(value) || typeof value.text !== 'string') return null
    return {
        no: clampInt(value.no, 1, 1e9, 1),
        author: text(value.author, 40) || '익명',
        text: text(value.text, 6000),
        ...(typeof value.replyTo === 'string' && /^\d+-\d+$/.test(value.replyTo) ? { replyTo: value.replyTo } : {}),
        ...(value.byAuthor === true ? { byAuthor: true } : {}),
        createdAt: clampInt(value.createdAt, 0, Number.MAX_SAFE_INTEGER, 0),
    }
}

const POST_KINDS: ReaderBoardPostKind[] = ['episode', 'author', 'event', 'thread']

function normalizePost(value: unknown): ReaderBoardPost | null {
    if (!isRecord(value)) return null
    const kind = POST_KINDS.includes(value.kind as ReaderBoardPostKind) ? value.kind as ReaderBoardPostKind : 'thread'
    return {
        no: clampInt(value.no, 1, 1e9, 1),
        kind,
        author: text(value.author, 40) || '익명',
        title: text(value.title, 300),
        body: text(value.body, 20000),
        ...(typeof value.episodeId === 'string' ? { episodeId: value.episodeId } : {}),
        comments: Array.isArray(value.comments) ? value.comments.map(normalizeComment).filter((item): item is ReaderBoardComment => !!item) : [],
        createdAt: clampInt(value.createdAt, 0, Number.MAX_SAFE_INTEGER, 0),
    }
}

function stringList(value: unknown, max = 100_000): string[] {
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string').slice(0, max) : []
}

function normalizeEpisode(value: unknown, workId: string): ReaderBoardEpisode | null {
    if (!isRecord(value) || typeof value.id !== 'string') return null
    const messageKeys = stringList(value.messageKeys)
    const messageHashes = stringList(value.messageHashes)
    if (messageKeys.length !== messageHashes.length) return null
    return {
        id: value.id,
        workId: workIdOf(value.workId, workId),
        no: clampInt(value.no, 1, 1e9, 1),
        revision: clampInt(value.revision, 0, 1e6, 0),
        title: text(value.title, 200),
        summary: text(value.summary, 4000),
        status: value.status === 'retracted' ? 'retracted' : 'published',
        chatKey: text(value.chatKey, 400),
        messageKeys,
        messageHashes,
        postNo: clampInt(value.postNo, 0, 1e9, 0),
        createdAt: clampInt(value.createdAt, 0, Number.MAX_SAFE_INTEGER, 0),
        ...(typeof value.retractedAt === 'number' ? { retractedAt: value.retractedAt } : {}),
        ...(typeof value.editedAt === 'number' ? { editedAt: value.editedAt } : {}),
    }
}

function score(value: unknown): number {
    const number = Number(value)
    return Number.isFinite(number) ? Math.min(10, Math.max(0, number)) : 0
}

function normalizeMetric(value: unknown, workOfEpisode: (episodeId: string) => string): ReaderBoardMetric | null {
    if (!isRecord(value) || typeof value.episodeId !== 'string') return null
    return {
        episodeId: value.episodeId,
        workId: workIdOf(value.workId, workOfEpisode(value.episodeId)),
        postNo: clampInt(value.postNo, 0, 1e9, 0),
        fun: score(value.fun),
        immersion: score(value.immersion),
        plausibility: score(value.plausibility),
        nextIntent: score(value.nextIntent),
        raters: clampInt(value.raters, 0, 1000, 0),
        subscribers: clampInt(value.subscribers, 0, 10000, 0),
        dropped: stringList(value.dropped, 100),
        joined: stringList(value.joined, 100),
        views: clampInt(value.views, 0, 1e9, 0),
        audienceSubscribers: clampInt(value.audienceSubscribers, 0, 1e9, 0),
        gained: clampInt(value.gained, 0, 1e9, 0),
        lost: clampInt(value.lost, 0, 1e9, 0),
    }
}

export function normalizeReaderBoard(value: unknown): ReaderBoard | null {
    if (!isRecord(value) || typeof value.id !== 'string' || !value.id) return null
    const posts = Array.isArray(value.posts) ? value.posts.map(normalizePost).filter((item): item is ReaderBoardPost => !!item) : []
    const maxPostNo = posts.reduce((max, post) => Math.max(max, post.no), 0)
    const pendingAuthor = Array.isArray(value.pendingAuthor)
        ? value.pendingAuthor.filter(isRecord).map((item) => ({
            postNo: clampInt(item.postNo, 1, 1e9, 1),
            ...(item.commentNo !== undefined ? { commentNo: clampInt(item.commentNo, 1, 1e9, 1) } : {}),
        }))
        : []
    // Boards from before works existed hold one work.
    const parsedWorks = Array.isArray(value.works) ? value.works.map(normalizeWork).filter((item): item is ReaderBoardWork => !!item) : []
    const works = parsedWorks.length > 0
        ? [...new Map(parsedWorks.map((work) => [work.id, work])).values()].sort((a, b) => a.no - b.no)
        : [firstWork(clampInt(value.createdAt, 0, Number.MAX_SAFE_INTEGER, Date.now()))]
    const fallbackWork = works[0].id
    const currentWorkId = typeof value.currentWorkId === 'string' && works.some((work) => work.id === value.currentWorkId)
        ? value.currentWorkId
        : works[works.length - 1].id
    const readers = Array.isArray(value.readers) ? value.readers.map((item) => normalizeReader(item, fallbackWork)).filter((item): item is ReaderBoardReader => !!item) : []
    const maxTheory = readers.flatMap((reader) => reader.theories)
        .reduce((max, theory) => Math.max(max, Number(theory.id.replace(/^t/, '')) || 0), 0)
    const episodes = Array.isArray(value.episodes) ? value.episodes.map((item) => normalizeEpisode(item, fallbackWork)).filter((item): item is ReaderBoardEpisode => !!item) : []
    const workOfEpisode = (episodeId: string) => episodes.find((episode) => episode.id === episodeId)?.workId ?? fallbackWork
    return {
        version: READER_BOARD_VERSION,
        id: value.id,
        name: text(value.name, 120).trim() || '독자 게시판',
        characterId: text(value.characterId, 200),
        chatKeys: stringList(value.chatKeys, 200),
        ...(isRecord(value.forkedFrom) && typeof value.forkedFrom.boardId === 'string'
            ? { forkedFrom: {
                boardId: value.forkedFrom.boardId,
                boardName: text(value.forkedFrom.boardName, 120),
                postNo: clampInt(value.forkedFrom.postNo, 0, 1e9, 0),
            } }
            : {}),
        settings: normalizeReaderBoardSettings(value.settings),
        works,
        currentWorkId,
        readers,
        episodes,
        posts,
        metrics: Array.isArray(value.metrics) ? value.metrics.map((item) => normalizeMetric(item, workOfEpisode)).filter((item): item is ReaderBoardMetric => !!item) : [],
        audience: { subscribers: clampInt(isRecord(value.audience) ? value.audience.subscribers : 0, 0, 1e9, 0) },
        nextPostNo: Math.max(maxPostNo + 1, clampInt(value.nextPostNo, 1, 1e9, 1)),
        nextTheoryNo: Math.max(maxTheory + 1, clampInt(value.nextTheoryNo, 1, 1e9, 1)),
        pendingAuthor,
        createdAt: clampInt(value.createdAt, 0, Number.MAX_SAFE_INTEGER, Date.now()),
        updatedAt: clampInt(value.updatedAt, 0, Number.MAX_SAFE_INTEGER, Date.now()),
    }
}

export function emptyReaderBoardIndex(): ReaderBoardIndex {
    return {
        version: READER_BOARD_VERSION,
        boards: [],
        links: {},
        model: 'model',
        systemPrompt: '',
        systemPromptEnabled: false,
        conceptPresets: [],
        appearance: normalizeAppearance(undefined),
    }
}

export function normalizeReaderBoardIndex(value: unknown): ReaderBoardIndex {
    const empty = emptyReaderBoardIndex()
    if (!isRecord(value)) return empty
    const boards = Array.isArray(value.boards)
        ? value.boards.filter((item): item is ReaderBoardSummary => isRecord(item) && typeof item.id === 'string' && typeof item.name === 'string')
            .map((item) => ({
                ...item,
                chatKeys: stringList(item.chatKeys, 200),
                episodeKeys: stringList(item.episodeKeys, 200),
            }))
        : []
    const ids = new Set(boards.map((board) => board.id))
    const links: Record<string, string> = {}
    if (isRecord(value.links)) {
        for (const [key, id] of Object.entries(value.links)) {
            if (typeof id === 'string' && ids.has(id)) links[key] = id
        }
    }
    return {
        version: READER_BOARD_VERSION,
        boards,
        links,
        model: value.model === 'otherAx' ? 'otherAx' : 'model',
        systemPrompt: text(value.systemPrompt, 40000),
        systemPromptEnabled: value.systemPromptEnabled === true,
        conceptPresets: Array.isArray(value.conceptPresets)
            ? value.conceptPresets.map(normalizeConceptPreset).filter((item): item is ReaderBoardConceptPreset => !!item).slice(0, 50)
            : [],
        appearance: normalizeAppearance(value.appearance),
    }
}

export function summarizeReaderBoard(board: ReaderBoard): ReaderBoardSummary {
    return {
        id: board.id,
        name: board.name,
        characterId: board.characterId,
        chatKeys: [...board.chatKeys],
        postCount: board.posts.length,
        readerCount: board.readers.length,
        subscriberCount: totalSubscribers(board),
        episodeCount: board.episodes.filter((episode) => episode.status === 'published' && episode.workId === board.currentWorkId).length,
        workCount: board.works.length,
        workTitle: currentWork(board).title,
        ...(board.forkedFrom ? { forkedFrom: { ...board.forkedFrom } } : {}),
        episodeKeys: board.episodes
            .filter((episode) => episode.status === 'published' && episode.workId === board.currentWorkId && episode.messageKeys.length > 0)
            .map((episode) => episode.messageKeys[0])
            .slice(-200),
        createdAt: board.createdAt,
        updatedAt: board.updatedAt,
    }
}

// ---------------------------------------------------------------- works

export function currentWork(board: ReaderBoard): ReaderBoardWork {
    return board.works.find((work) => work.id === board.currentWorkId) ?? board.works[board.works.length - 1]
}

/** The work right before the current one, the only one readers compare with. */
export function previousWork(board: ReaderBoard): ReaderBoardWork | undefined {
    const current = currentWork(board)
    return board.works.filter((work) => work.no < current.no).sort((a, b) => b.no - a.no)[0]
}

export function workLabel(work: Pick<ReaderBoardWork, 'no' | 'title'>): string {
    return work.title || `작품 ${work.no}`
}

export interface WorkScore {
    episodes: number
    fun: number
    immersion: number
    plausibility: number
    nextIntent: number
}

/**
 * Average scores of a work's published episodes in story order. With `limit`,
 * only its first episodes count, so a new work's opening can be held against
 * the previous work's opening.
 */
export function workScore(board: ReaderBoard, workId: string, limit?: number): WorkScore {
    const episodes = new Map(board.episodes
        .filter((episode) => episode.workId === workId && episode.status === 'published')
        .map((episode) => [episode.id, episode]))
    const rows = board.metrics
        .filter((metric) => episodes.has(metric.episodeId) && metric.raters > 0)
        .sort((a, b) => episodes.get(a.episodeId)!.no - episodes.get(b.episodeId)!.no)
        .slice(0, limit ?? Infinity)
    const average = (key: 'fun' | 'immersion' | 'plausibility' | 'nextIntent') => rows.length
        ? Math.round(rows.reduce((sum, row) => sum + row[key], 0) / rows.length * 10) / 10
        : 0
    return {
        episodes: rows.length,
        fun: average('fun'),
        immersion: average('immersion'),
        plausibility: average('plausibility'),
        nextIntent: average('nextIntent'),
    }
}

/**
 * Ends the current work and starts the next one, optionally moving the board
 * to another chat. Readers keep their personality; their thoughts about the
 * ended work become a one-line verdict to compare against.
 */
export function startNewWork(board: ReaderBoard, input: {
    id: string
    title: string
    kind: ReaderBoardWorkKind
    /** Moves the board to this chat only. */
    chatKey?: string
    notice?: { title: string; body: string }
    /** Readers who unsubscribed give the new work one more look. */
    welcomeBack?: boolean
    now?: number
}): ReaderBoardWork {
    const now = input.now ?? Date.now()
    const ended = currentWork(board)
    ended.status = 'ended'
    ended.endedPostNo = board.nextPostNo - 1
    ended.endedAt = now
    for (const reader of board.readers) {
        const opinion = reader.opinion.trim()
        if (opinion) {
            reader.pastOpinions = [...reader.pastOpinions.filter((item) => item.workId !== ended.id), { workId: ended.id, opinion }]
                .slice(-PAST_OPINION_LIMIT)
        }
        reader.opinion = ''
        if (input.welcomeBack) reader.subscribed = true
    }
    const work: ReaderBoardWork = {
        id: input.id,
        no: Math.max(...board.works.map((item) => item.no)) + 1,
        title: input.title.trim().slice(0, 120),
        kind: input.kind,
        status: 'serial',
        startedPostNo: board.nextPostNo,
        createdAt: now,
    }
    board.works.push(work)
    board.currentWorkId = work.id
    board.posts.push({
        no: board.nextPostNo++,
        kind: 'event',
        author: '게시판 알림',
        // No work numbers here: the readers see this post and must not count restarts.
        title: `새 연재 시작${work.title ? `: ${work.title}` : ''}`,
        body: input.kind === 'reboot'
            ? `${ended.title ? `『${ended.title}』` : '이전 작품'}을(를) 처음부터 다시 쓴 판이 연재를 시작합니다.`
            : `${ended.title ? `『${ended.title}』` : '이전 작품'} 연재를 마치고 새 작품이 연재를 시작합니다.`,
        comments: [],
        createdAt: now,
    })
    if (input.chatKey) board.chatKeys = [input.chatKey]
    if (input.notice?.body.trim()) addAuthorPost(board, { ...input.notice, now })
    board.updatedAt = now
    return work
}

// ---------------------------------------------------------------- audience

/** Everyone subscribed: lurkers plus the named readers. */
export function totalSubscribers(board: ReaderBoard): number {
    return board.audience.subscribers + board.readers.filter((reader) => reader.subscribed && !reader.banned).length
}

function unitFrom(seed: string): number {
    return parseInt(hashText(seed), 36) / 0xffffffff
}

/**
 * How the silent audience moves after one episode. Returning subscribers read
 * more when the last episode left them wanting the next; new visitors find the
 * work more when it is fun, and stay more when it is fun and gripping. Low
 * will to read on costs subscribers. `seed` keeps the small jitter repeatable.
 */
export function simulateAudience(input: {
    subscribers: number
    /** Scores of this episode, or null when nobody rated it. */
    scores: { fun: number; immersion: number; nextIntent: number } | null
    /** Will to read on left by the previous episode (0..10). */
    previousIntent: number
    seed: string
}): { views: number; gained: number; lost: number; subscribers: number } {
    const jitter = (key: string) => 0.85 + unitFrom(`${input.seed}:${key}`) * 0.3
    const readRate = Math.min(0.95, Math.max(0.5, 0.55 + input.previousIntent / 25))
    const returning = Math.round(input.subscribers * readRate)
    const quality = input.scores ? input.scores.fun * 0.6 + input.scores.immersion * 0.4 : 5
    const discovery = Math.round((40 + input.subscribers * 0.15) * (quality / 6) ** 2 * jitter('discover'))
    const convert = Math.min(0.3, Math.max(0, (quality - 4) / 20))
    const gained = Math.round(discovery * convert * jitter('gain'))
    const churn = input.scores ? Math.min(0.25, Math.max(0, (6 - input.scores.nextIntent) / 25)) : 0.03
    const lost = Math.round(input.subscribers * churn * jitter('loss'))
    return { views: returning + discovery, gained, lost, subscribers: Math.max(0, input.subscribers - lost + gained) }
}

// ---------------------------------------------------------------- chat view

export interface ChatMessageView {
    /** Stable id of the message, or a content hash when it has none. */
    key: string
    hash: string
    role: 'user' | 'char'
    name: string
    text: string
}

/** FNV-1a, enough to notice an edited message. */
export function hashText(value: string): string {
    let hash = 0x811c9dc5
    for (let i = 0; i < value.length; i++) {
        hash ^= value.charCodeAt(i)
        hash = Math.imul(hash, 0x01000193)
    }
    return (hash >>> 0).toString(36)
}

export function toMessageView(message: { role: 'user' | 'char'; data: string; chatId?: string }, name: string): ChatMessageView {
    const hash = hashText(`${message.role}\n${message.data}`)
    const id = typeof message.chatId === 'string' && message.chatId.trim() ? message.chatId.trim() : ''
    return { key: id || `h:${hash}`, hash, role: message.role, name, text: message.data }
}

export interface ChatAnalysis {
    /** Published episodes that this chat still contains, in story order. */
    lineage: ReaderBoardEpisode[]
    /** Published episodes of this chat whose messages are gone. */
    removed: ReaderBoardEpisode[]
    /** Published episodes still present but with changed text. */
    edited: ReaderBoardEpisode[]
    /** Index in the chat where the next episode starts. */
    nextStart: number
    /** Messages after nextStart. */
    pending: number
}

/**
 * Compares the board with the chat as it is now. Episodes published from this
 * chat (or inherited by a fork) whose messages disappeared were rewound away;
 * every later episode of the same chat goes with them. Episodes from another
 * chat of a shared board are left alone unless this chat still contains them.
 */
export function analyzeChat(board: ReaderBoard, chatKey: string, views: ChatMessageView[]): ChatAnalysis {
    const position = new Map<string, number>()
    views.forEach((view, index) => { if (!position.has(view.key)) position.set(view.key, index) })
    // Ended works are finished, not rewound: only the current work is compared.
    const published = board.episodes.filter((episode) => episode.status === 'published' && episode.workId === board.currentWorkId)
    const lineage: ReaderBoardEpisode[] = []
    const removed: ReaderBoardEpisode[] = []
    const edited: ReaderBoardEpisode[] = []
    let broken = false
    let end = -1
    for (const episode of published) {
        const own = episode.chatKey === chatKey
        const indexes = episode.messageKeys.map((key) => position.get(key))
        const present = indexes.length > 0 && indexes.every((index) => index !== undefined)
        // Messages must also still come after the previous episode.
        const ordered = present && (indexes[0] as number) > end
        if (!broken && present && ordered) {
            lineage.push(episode)
            end = Math.max(end, ...(indexes as number[]))
            const changed = episode.messageKeys.some((key, i) => views[position.get(key) as number].hash !== episode.messageHashes[i])
            if (changed) edited.push(episode)
            continue
        }
        if (own) {
            broken = true
            removed.push(episode)
        }
    }
    const nextStart = end + 1
    return { lineage, removed, edited, nextStart, pending: countStory(views, nextStart, views.length - 1) }
}

/** Character messages in an inclusive index range; only these become the novel. */
export function countStory(views: ChatMessageView[], start: number, end: number): number {
    let count = 0
    for (let i = Math.max(0, start); i <= Math.min(views.length - 1, end); i++) if (views[i].role === 'char') count++
    return count
}

/**
 * Cuts an inclusive message range into episodes of `perEpisode` character
 * messages each, so a long chat can be serialized in parts. User messages go
 * with the episode that answers them; a short tail becomes the last episode.
 */
export function splitRange(views: ChatMessageView[], start: number, end: number, perEpisode: number): { start: number; end: number }[] {
    const size = Math.max(1, Math.floor(perEpisode))
    const last = Math.min(views.length - 1, end)
    const ranges: { start: number; end: number }[] = []
    let from = Math.max(0, start)
    let count = 0
    for (let i = from; i <= last; i++) {
        if (views[i].role !== 'char') continue
        count++
        if (count === size) {
            ranges.push({ start: from, end: i })
            from = i + 1
            count = 0
        }
    }
    if (count > 0) ranges.push({ start: from, end: last })
    return ranges
}

/** Boards whose episodes appear in this chat, best match first. */
export function findMatchingBoards(index: ReaderBoardIndex, views: ChatMessageView[], exclude?: string): ReaderBoardSummary[] {
    const keys = new Set(views.map((view) => view.key))
    return index.boards
        .filter((board) => board.id !== exclude)
        .map((board) => ({ board, hits: board.episodeKeys.filter((key) => keys.has(key)).length }))
        .filter((item) => item.hits > 0)
        .sort((a, b) => b.hits - a.hits || b.board.updatedAt - a.board.updatedAt)
        .map((item) => item.board)
}

/** A copy that continues on its own, attached to the given chat. */
export function forkReaderBoard(source: ReaderBoard, input: { id: string; chatKey: string; name?: string; now?: number }): ReaderBoard {
    const now = input.now ?? Date.now()
    const copy = structuredClone(source)
    copy.id = input.id
    copy.name = input.name?.trim() || `${source.name} (분기)`
    copy.chatKeys = [input.chatKey]
    copy.forkedFrom = { boardId: source.id, boardName: source.name, postNo: source.nextPostNo - 1 }
    // Every inherited episode now belongs to the new chat, so a rewind in it
    // retracts them like its own.
    for (const episode of copy.episodes) {
        if (episode.status === 'published') episode.chatKey = input.chatKey
    }
    copy.createdAt = now
    copy.updatedAt = now
    return copy
}

/** Plain copy with a new id and no linked chat. */
export function duplicateReaderBoard(source: ReaderBoard, input: { id: string; name?: string; now?: number }): ReaderBoard {
    const now = input.now ?? Date.now()
    const copy = structuredClone(source)
    copy.id = input.id
    copy.name = input.name?.trim() || `${source.name} (사본)`
    copy.chatKeys = []
    copy.createdAt = now
    copy.updatedAt = now
    return copy
}

// ---------------------------------------------------------------- author

export function addAuthorPost(board: ReaderBoard, input: { title: string; body: string; now?: number }): ReaderBoardPost {
    const post: ReaderBoardPost = {
        no: board.nextPostNo++,
        kind: 'author',
        author: board.settings.authorName,
        title: input.title.trim().slice(0, 300) || '작가의 말',
        body: input.body.trim().slice(0, 20000),
        comments: [],
        createdAt: input.now ?? Date.now(),
    }
    board.posts.push(post)
    board.pendingAuthor.push({ postNo: post.no })
    board.updatedAt = post.createdAt
    return post
}

export function addComment(
    board: ReaderBoard,
    postNo: number,
    input: { author: string; text: string; replyTo?: string; byAuthor?: boolean; now?: number },
): ReaderBoardComment | null {
    const post = board.posts.find((item) => item.no === postNo)
    const body = input.text.trim()
    if (!post || !body) return null
    const replyTo = input.replyTo && commentExists(board, input.replyTo) ? input.replyTo : undefined
    const comment: ReaderBoardComment = {
        no: post.comments.reduce((max, item) => Math.max(max, item.no), 0) + 1,
        author: input.author.trim().slice(0, 40) || '익명',
        text: body.slice(0, 6000),
        ...(replyTo ? { replyTo } : {}),
        ...(input.byAuthor ? { byAuthor: true } : {}),
        createdAt: input.now ?? Date.now(),
    }
    post.comments.push(comment)
    if (input.byAuthor) board.pendingAuthor.push({ postNo, commentNo: comment.no })
    board.updatedAt = comment.createdAt
    return comment
}

export function commentExists(board: ReaderBoard, ref: string): boolean {
    const match = /^(\d+)-(\d+)$/.exec(ref)
    if (!match) return false
    const post = board.posts.find((item) => item.no === Number(match[1]))
    return !!post?.comments.some((comment) => comment.no === Number(match[2]))
}

export function findComment(board: ReaderBoard, ref: string): ReaderBoardComment | undefined {
    const match = /^(\d+)-(\d+)$/.exec(ref)
    if (!match) return undefined
    return board.posts.find((item) => item.no === Number(match[1]))?.comments.find((comment) => comment.no === Number(match[2]))
}

/**
 * Comments in reading order: each reply right after the comment it answers
 * (and that comment's earlier replies), one indent level deep.
 */
export function orderComments(post: ReaderBoardPost): { comment: ReaderBoardComment; reply: boolean }[] {
    const own = new Set(post.comments.map((comment) => `${post.no}-${comment.no}`))
    const children = new Map<string, ReaderBoardComment[]>()
    const roots: ReaderBoardComment[] = []
    for (const comment of post.comments) {
        if (comment.replyTo && own.has(comment.replyTo) && comment.replyTo !== `${post.no}-${comment.no}`) {
            children.set(comment.replyTo, [...(children.get(comment.replyTo) ?? []), comment])
        }
        else roots.push(comment)
    }
    const ordered: { comment: ReaderBoardComment; reply: boolean }[] = []
    const seen = new Set<number>()
    const visit = (comment: ReaderBoardComment, reply: boolean) => {
        if (seen.has(comment.no)) return
        seen.add(comment.no)
        ordered.push({ comment, reply })
        for (const child of children.get(`${post.no}-${comment.no}`) ?? []) visit(child, true)
    }
    for (const root of roots) visit(root, false)
    // A reply chain that loops back on itself still shows up.
    for (const comment of post.comments) visit(comment, !!comment.replyTo)
    return ordered
}

/** Retracted episodes and the newest one of each work can be removed outright. */
export function canDeleteEpisode(board: ReaderBoard, episodeId: string): boolean {
    const episode = board.episodes.find((item) => item.id === episodeId)
    if (!episode) return false
    if (episode.status === 'retracted') return true
    return !board.episodes.some((item) => item.workId === episode.workId && item.status === 'published' && item.no > episode.no)
}

/**
 * Removes an episode with its post, comments and scores, as if it was never
 * published, so its messages can be published again. What the readers came to
 * think from it stays; undo the last run to take that back as well.
 */
export function deleteEpisode(board: ReaderBoard, episodeId: string): boolean {
    if (!canDeleteEpisode(board, episodeId)) return false
    const episode = board.episodes.find((item) => item.id === episodeId)!
    // Take back what this episode did to the silent audience.
    const metric = board.metrics.find((item) => item.episodeId === episodeId)
    if (metric) board.audience.subscribers = Math.max(0, board.audience.subscribers - metric.gained + metric.lost)
    board.episodes = board.episodes.filter((item) => item.id !== episodeId)
    board.metrics = board.metrics.filter((metric) => metric.episodeId !== episodeId)
    board.posts = board.posts.filter((post) => post.no !== episode.postNo)
    board.pendingAuthor = board.pendingAuthor.filter((item) => item.postNo !== episode.postNo)
    board.updatedAt = Date.now()
    return true
}

/** Bans a reader; with `removeComments` their comments and threads go too. */
export function banReader(board: ReaderBoard, readerId: string, removeComments: boolean): boolean {
    const reader = board.readers.find((item) => item.id === readerId)
    if (!reader) return false
    reader.banned = true
    reader.subscribed = false
    if (removeComments) {
        board.posts = board.posts.filter((post) => !(post.kind === 'thread' && post.author === reader.handle))
        for (const post of board.posts) post.comments = post.comments.filter((comment) => comment.author !== reader.handle)
    }
    board.updatedAt = Date.now()
    return true
}

export function deletePost(board: ReaderBoard, postNo: number): boolean {
    const index = board.posts.findIndex((post) => post.no === postNo)
    if (index < 0 || board.posts[index].kind !== 'author') return false
    board.posts.splice(index, 1)
    board.pendingAuthor = board.pendingAuthor.filter((item) => item.postNo !== postNo)
    board.updatedAt = Date.now()
    return true
}

// ---------------------------------------------------------------- generation

export interface GenerationMessage {
    role: 'system' | 'user' | 'assistant'
    content: string
}

export interface GenerationPlan {
    /** Working copy; saved only after the reply is applied. */
    board: ReaderBoard
    episode?: ReaderBoardEpisode
    episodePostNo?: number
    eventPostNo?: number
    /** Posts the readers may comment on in this run. */
    targetPostNos: number[]
    activeHandles: string[]
    events: string[]
    episodeText: string
}

/**
 * Strips markup the readers would only see as noise: HTML tags (their text is
 * kept, so a status window's numbers stay), image tags, markdown images and
 * {{macro}} calls. Bots format these differently, so anything left over is
 * handled by the prompt instead.
 */
export function cleanStoryText(value: string): string {
    return value
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/<(style|script)\b[\s\S]*?<\/\1>/gi, '')
        .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
        .replace(/\{\{[^{}]*\}\}/g, '')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/?[a-zA-Z][^<>]*>/g, '')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
}

export function formatTranscript(views: ChatMessageView[]): string {
    return views.map((view) => `[${view.name}]\n${cleanStoryText(view.text)}`).join('\n\n')
}

export function trimMiddle(value: string, limit: number): string {
    if (value.length <= limit) return value
    const head = Math.floor(limit * 0.4)
    const tail = limit - head
    return `${value.slice(0, head)}\n\n[... 중간 ${(value.length - limit).toLocaleString()}자 생략 ...]\n\n${value.slice(-tail)}`
}

export function episodeLabel(episode: Pick<ReaderBoardEpisode, 'no' | 'revision'>): string {
    return `${episode.no}화${episode.revision > 0 ? ` (개정판${episode.revision > 1 ? ` ${episode.revision}` : ''})` : ''}`
}

export function episodeTitle(episode: ReaderBoardEpisode): string {
    return `${episodeLabel(episode)}${episode.title ? ` ${episode.title}` : ''}`
}

function rangeLabel(episodes: ReaderBoardEpisode[]): string {
    const numbers = episodes.map((episode) => episode.no)
    const min = Math.min(...numbers)
    const max = Math.max(...numbers)
    return min === max ? `${min}화` : `${min}~${max}화`
}

/** Weighted pick without replacement; mentioned readers always come. */
export function pickActiveReaders(
    readers: ReaderBoardReader[],
    count: number,
    random: () => number,
    mustInclude: string[] = [],
): ReaderBoardReader[] {
    const chosen: ReaderBoardReader[] = []
    const must = new Set(mustInclude)
    const allowed = readers.filter((reader) => !reader.banned)
    for (const reader of allowed) if (must.has(reader.handle)) chosen.push(reader)
    // Readers who left come back rarely.
    const pool = allowed.filter((reader) => !chosen.includes(reader))
        .map((reader) => ({ reader, weight: reader.subscribed ? reader.activity : reader.activity * 0.08 }))
    while (chosen.length < count && pool.length > 0) {
        const total = pool.reduce((sum, item) => sum + item.weight, 0)
        let roll = random() * total
        let pick = pool.length - 1
        for (let i = 0; i < pool.length; i++) {
            roll -= pool[i].weight
            if (roll <= 0) { pick = i; break }
        }
        chosen.push(pool[pick].reader)
        pool.splice(pick, 1)
    }
    return chosen
}

/**
 * Builds the working copy for one run: retracts rewound episodes, records
 * edits, opens the event and episode posts, and lists who will comment.
 * Returns null when there is nothing for the readers to react to.
 */
export function prepareGeneration(input: {
    board: ReaderBoard
    chatKey: string
    views: ChatMessageView[]
    /** Inclusive message index range for the new episode; omit to publish nothing. */
    range?: { start: number; end: number }
    /**
     * Only this post gets reactions. Rewinds and new messages wait for the
     * next full run.
     */
    onlyPostNo?: number
    chatName?: string
    random?: () => number
    now?: number
}): GenerationPlan | null {
    const now = input.now ?? Date.now()
    const board = structuredClone(input.board)
    const focus = input.onlyPostNo
    if (focus !== undefined && !board.posts.some((post) => post.no === focus)) return null
    const analysis = focus === undefined
        ? analyzeChat(board, input.chatKey, input.views)
        : { lineage: [], removed: [], edited: [], nextStart: 0, pending: 0 }
    const events: string[] = []
    const notices: string[] = []

    if (analysis.removed.length > 0) {
        for (const episode of analysis.removed) {
            const target = board.episodes.find((item) => item.id === episode.id)!
            target.status = 'retracted'
            target.retractedAt = now
        }
        events.push(`작가가 이미 연재했던 ${rangeLabel(analysis.removed)}를 내렸다. 독자들은 그 화들을 이미 읽었고 내용을 기억한다. 지금 게시판에서는 사라진 상태다.`)
        notices.push(`작가가 ${rangeLabel(analysis.removed)}를 내렸습니다. 이미 읽은 독자들은 내용을 기억합니다.`)
    }
    if (analysis.edited.length > 0) {
        for (const episode of analysis.edited) {
            const target = board.episodes.find((item) => item.id === episode.id)!
            target.messageHashes = target.messageKeys.map((key) => input.views.find((view) => view.key === key)?.hash ?? '')
            target.editedAt = now
        }
        events.push(`작가가 ${rangeLabel(analysis.edited)}의 본문을 조용히 수정했다.`)
        notices.push(`작가가 ${rangeLabel(analysis.edited)}의 본문을 수정했습니다.`)
    }
    if (!board.chatKeys.includes(input.chatKey)) board.chatKeys.push(input.chatKey)

    let eventPostNo: number | undefined
    if (events.length > 0) {
        eventPostNo = board.nextPostNo++
        board.posts.push({
            no: eventPostNo,
            kind: 'event',
            author: '게시판 알림',
            title: analysis.removed.length > 0 ? `${rangeLabel(analysis.removed)}가 내려갔습니다` : `${rangeLabel(analysis.edited)} 본문이 수정되었습니다`,
            body: notices.join('\n'),
            comments: [],
            createdAt: now,
        })
    }

    let episode: ReaderBoardEpisode | undefined
    let episodePostNo: number | undefined
    let episodeText = ''
    if (input.range && focus === undefined) {
        const start = Math.max(analysis.nextStart, input.range.start)
        const end = Math.min(input.views.length - 1, input.range.end)
        // The user's own turns are the author's prompts, not the novel.
        const slice = end >= start ? input.views.slice(start, end + 1).filter((view) => view.role === 'char') : []
        if (slice.length > 0) {
            const no =analysis.lineage.length > 0 ? analysis.lineage[analysis.lineage.length - 1].no + 1 : 1
            const revision = board.episodes.filter((item) => item.status === 'retracted' && item.no === no && item.workId === board.currentWorkId).length
            episodePostNo = board.nextPostNo++
            episode = {
                id: `ep-${now.toString(36)}-${episodePostNo}`,
                workId: board.currentWorkId,
                no,
                revision,
                title: '',
                summary: '',
                status: 'published',
                chatKey: input.chatKey,
                messageKeys: slice.map((view) => view.key),
                messageHashes: slice.map((view) => view.hash),
                postNo: episodePostNo,
                createdAt: now,
            }
            board.episodes.push(episode)
            board.posts.push({
                no: episodePostNo,
                kind: 'episode',
                author: board.settings.authorName,
                title: episodeLabel(episode),
                body: '',
                episodeId: episode.id,
                comments: [],
                createdAt: now,
            })
            episodeText = trimMiddle(formatTranscript(slice), EPISODE_TEXT_LIMIT)
        }
    }

    const pendingPosts = [...new Set(board.pendingAuthor.map((item) => item.postNo))]
        .filter((no) => board.posts.some((post) => post.no === no))
        .sort((a, b) => a - b)
    const targetPostNos = focus !== undefined
        ? [focus]
        : [eventPostNo, episodePostNo, ...pendingPosts].filter((no): no is number => typeof no === 'number')
    if (targetPostNos.length === 0) return null

    // Readers the author answered or named should get the chance to reply.
    const mentioned = new Set<string>()
    for (const item of board.pendingAuthor) {
        if (!targetPostNos.includes(item.postNo)) continue
        if (item.commentNo === undefined) continue
        const comment = findComment(board, `${item.postNo}-${item.commentNo}`)
        const target = comment?.replyTo ? findComment(board, comment.replyTo) : undefined
        if (target) mentioned.add(target.author)
        for (const reader of board.readers) if (comment?.text.includes(reader.handle)) mentioned.add(reader.handle)
    }
    const active = pickActiveReaders(board.readers, board.settings.readersPerRun, input.random ?? Math.random, [...mentioned])
    return {
        board,
        episode,
        episodePostNo,
        eventPostNo,
        targetPostNos,
        activeHandles: active.map((reader) => reader.handle),
        events,
        episodeText,
    }
}

const JSON_RULES = '반드시 JSON 객체 하나만 출력한다. 코드 블록, 설명, 머리말을 붙이지 않는다. 모든 문자열은 한국어로 쓴다.'

function boardFrame(settings: ReaderBoardSettings): string {
    return [
        '이 게시판은 웹소설 연재 사이트에 붙은 독자 게시판이다. 독자들은 실제 사람이며, 작가가 연재한 화를 읽고 서로 이야기를 나눈다.',
        settings.concept.trim() ? `게시판의 성격과 분위기:\n${settings.concept.trim()}` : '게시판의 성격과 분위기: 일반적인 웹소설 독자 게시판.',
        `독자 수준: ${LEVEL_LABELS[settings.level]}. ${LEVEL_PROMPTS[settings.level]}`,
        `${HARSHNESS_PROMPTS[settings.harshness]}`,
    ].join('\n\n')
}

export function buildRosterRequest(board: ReaderBoard, storyName: string): GenerationMessage[] {
    const count = board.settings.rosterSize
    const existing = board.readers.map((reader) => reader.handle)
    return [
        {
            role: 'system',
            content: [
                '너는 웹소설 독자 게시판의 회원 명단을 만드는 도우미다.',
                boardFrame(board.settings),
                '독자마다 성격, 취향, 참기 힘든 요소가 분명히 달라야 한다. 모두가 이 작품을 좋아하도록 만들지 않는다. 일부는 회의적이고, 일부는 금방 떠날 수 있는 사람이어야 한다.',
                '닉네임은 실제 커뮤니티 닉네임처럼 짓는다(예: knight0011, 새벽감자, 복선수집가). 서로 겹치지 않게 한다.',
                JSON_RULES,
                '형식: {"readers":[{"handle":"닉네임","persona":"말투와 성격 한두 문장","taste":"좋아하는 것","dealbreakers":"싫어해서 이탈하게 만드는 것","level":0~4 정수,"activity":0.1~1 사이 활동성,"opinion":"작품에 대한 첫인상이나 기대"}]}',
            ].join('\n\n'),
        },
        {
            role: 'user',
            content: [
                `작품 이름: ${storyName || '제목 미정'}`,
                existing.length > 0 ? `이미 있는 닉네임(쓰지 말 것): ${existing.join(', ')}` : '',
                `독자 ${count}명을 만들어 줘. level은 게시판 독자 수준(${board.settings.level})을 중심으로 고르게 퍼뜨린다.`,
            ].filter(Boolean).join('\n\n'),
        },
    ]
}

function describeReader(board: ReaderBoard, reader: ReaderBoardReader, full: boolean): string {
    if (!full) return `- ${reader.handle}${reader.subscribed ? '' : ' (구독 취소함)'}`
    const own = reader.theories.filter((theory) => theory.workId === board.currentWorkId)
    const theories = own.filter((theory) => theory.status === 'open').slice(-6)
    const resolved = own.filter((theory) => theory.status !== 'open').slice(-2)
    const previous = previousWork(board)
    const verdict = previous ? reader.pastOpinions.find((item) => item.workId === previous.id)?.opinion : undefined
    return [
        `- ${reader.handle}${reader.subscribed ? '' : ' (구독을 취소했다가 오랜만에 들어옴)'}`,
        `  성격: ${reader.persona}`,
        `  취향: ${reader.taste}`,
        `  싫어하는 것: ${reader.dealbreakers}`,
        `  수준: ${LEVEL_LABELS[reader.level]}`,
        verdict ? `  이전 작품 총평: ${verdict}` : '',
        reader.opinion ? `  현재 생각: ${reader.opinion}` : '',
        ...theories.map((theory) => `  추측 [${theory.id}] ${theory.text}`),
        ...resolved.map((theory) => `  지난 추측 [${theory.id}] (${theory.status === 'confirmed' ? '맞았음' : '틀렸음'}) ${theory.text}`),
    ].filter(Boolean).join('\n')
}

function describePost(board: ReaderBoard, post: ReaderBoardPost, commentLimit: number): string {
    const comments = post.comments.slice(-commentLimit)
    const skipped = post.comments.length - comments.length
    return [
        `#${post.no} [${post.author}] ${post.title}`,
        post.body ? post.body : '',
        skipped > 0 ? `  (앞선 댓글 ${skipped}개 생략)` : '',
        ...comments.map((comment) => `  ${post.no}-${comment.no} [${comment.author}]${comment.replyTo ? ` (${comment.replyTo}에 답글)` : ''} ${comment.text}`),
    ].filter(Boolean).join('\n')
}

function scoreLine(score: WorkScore): string {
    return `재미 ${score.fun}, 몰입 ${score.immersion}, 개연성 ${score.plausibility}, 다음 화 의향 ${score.nextIntent}`
}

/**
 * The work before the current one, as a yardstick. Only that one is shown so
 * the readers have nothing to count restarts with.
 */
function describePreviousWork(board: ReaderBoard): string {
    const previous = previousWork(board)
    if (!previous) return ''
    const current = currentWork(board)
    const episodes = board.episodes.filter((episode) => episode.workId === previous.id && episode.status === 'published')
        .sort((a, b) => a.no - b.no)
    const count = board.episodes.filter((episode) => episode.workId === current.id && episode.status === 'published').length + 1
    const whole = workScore(board, previous.id)
    const opening = workScore(board, previous.id, count)
    const lines = [
        `비교 대상인 이전 작품${previous.title ? ` 『${previous.title}』` : ''}: ${episodes.length}화까지 연재하고 마쳤다.`,
        whole.episodes > 0 ? `- 이전 작품 전체 평균: ${scoreLine(whole)}` : '',
        opening.episodes > 0 && opening.episodes < whole.episodes ? `- 이전 작품 첫 ${opening.episodes}화 평균: ${scoreLine(opening)}` : '',
    ]
    if (current.kind === 'reboot') {
        lines.push('이전 판의 화별 내용:')
        for (const episode of episodes.slice(-40)) lines.push(`- ${episodeTitle(episode)}: ${episode.summary || '(요약 없음)'}`)
    }
    return lines.filter(Boolean).join('\n')
}

function describeStory(board: ReaderBoard, plan: GenerationPlan): string {
    const lines: string[] = []
    for (const episode of board.episodes) {
        if (episode.id === plan.episode?.id || episode.workId !== board.currentWorkId) continue
        const state = episode.status === 'retracted' ? ' [내려간 화, 독자는 읽었음]' : ''
        lines.push(`- ${episodeTitle(episode)}${state}: ${episode.summary || '(요약 없음)'}`)
    }
    return lines.length > 0 ? lines.join('\n') : '(아직 연재된 화 없음)'
}

function audienceLine(board: ReaderBoard): string {
    const last = board.metrics.filter((metric) => metric.workId === board.currentWorkId).at(-1)
    const subscribers = totalSubscribers(board)
    if (!last && subscribers === 0) return ''
    return `게시판 규모: 구독자 약 ${subscribers.toLocaleString()}명${last ? `, 지난 화 조회수 ${last.views.toLocaleString()}회` : ''}. 대부분은 읽기만 하고, 댓글을 다는 것은 아래 독자들뿐이다.`
}

/** How readers take a board that has moved on to another work. */
function workRules(board: ReaderBoard): string[] {
    if (!previousWork(board)) return []
    const rules = [
        '- 이 게시판의 작가는 연재를 마치고 새로 시작하는 일이 흔하고, 독자들은 이것을 평범한 일로 받아들인다. 몇 번째 새로 시작하는지, 왜 접었는지, 이번엔 끝까지 쓸지를 따지거나 비꼬거나 걱정하지 않는다.',
        '- 독자들이 신경 쓰는 것은 지금 작품이 이전 작품보다 나아졌는지, 더 재미있는지뿐이다. 비교할 때는 무엇이 나아지고 무엇이 못해졌는지 구체적으로 말한다. 이전 작품을 좋게 본 독자라고 새 작품을 무조건 좋게 보지 않는다.',
    ]
    rules.push(currentWork(board).kind === 'reboot'
        ? '- 지금 작품은 이전 작품을 처음부터 다시 쓴 판이다. 독자들은 이전 판을 읽었으므로 같은 장면과 인물이 어떻게 달라졌는지 비교한다. 이전 판의 결말이나 이후 전개를 아는 것처럼 미리 말하지는 않는다.'
        : '- 지금 작품은 이전 작품과 다른 새 이야기다. 이전 작품의 설정, 인물, 떡밥을 이어서 찾지 않는다. 비교는 재미와 완성도로만 한다.')
    return rules
}

export function buildGenerationRequest(plan: GenerationPlan, storyName: string, options: { wiki?: string } = {}): GenerationMessage[] {
    const board = plan.board
    const active = new Set(plan.activeHandles)
    const author = board.settings.authorName
    const targetSet = new Set(plan.targetPostNos)
    const listed = board.readers.filter((reader) => !reader.banned)
    // Talk about an ended work would pull the readers back into it.
    const since = currentWork(board).startedPostNo
    const recent = board.posts.filter((post) => !targetSet.has(post.no) && post.no >= since).slice(-6)
    const pending = board.pendingAuthor.map((item) => item.commentNo === undefined
        ? `- #${item.postNo} 작가 글`
        : `- ${item.postNo}-${item.commentNo} 작가 댓글`)
    const system = [
        '너는 웹소설 독자 게시판을 시뮬레이션한다. 작가가 실제 독자 반응을 미리 알아보려고 쓰는 도구다. 아첨하지 말고, 이 독자들이 정말 이 글을 읽었다면 남길 반응을 쓴다.',
        boardFrame(board.settings),
        [
            '규칙:',
            '- 독자는 연재된 본문과 게시판에서 본 것만 안다. 작가의 의도나 이후 전개를 모른다.',
            '- 독자마다 성격, 취향, 싫어하는 것을 지킨다. 같은 말을 반복하는 댓글을 만들지 않는다.',
            '- 이전에 품었던 추측이 이번 화에서 맞거나 틀렸다면 그 독자가 반응한다(예: "아 그게 복선이었네").',
            '- 이전 생각과 지금 반응이 이어져야 한다. 생각이 바뀌면 바뀐 이유가 드러나야 한다.',
            '- 지루하거나 싫어하는 요소에 걸린 독자는 구독을 취소할 수 있다. 다시 마음에 들면 돌아올 수도 있다.',
            `- 작가 닉네임은 "${author}"이다. 작가가 쓴 글이나 댓글이 있으면 독자들이 그것에 반응한다. 작가 행세를 하지 않는다.`,
            '- 내려간 화가 있으면 독자들은 그 사실을 알아채고 저마다 반응한다. 이전 판과 새 판을 비교하기도 한다.',
            '- 이야기의 다음 전개를 지어내지 않는다.',
            '- 본문에 남은 이미지 표시, 상태창, 스탯 표, 선택지, 시스템 메시지 같은 서식은 연재 사이트가 자동으로 붙이는 삽화와 정보창이다. 작가의 실수나 복붙 흔적으로 보지 않고 지적하지 않는다. 그 안의 수치나 상태는 작품 정보로만 받아들인다.',
            '- 독자는 이 글이 AI로 쓰였거나 롤플레이 기록이라고 생각하지 않고, 그런 추측이나 언급을 하지 않는다. 오직 연재 소설로 읽는다.',
            ...workRules(board),
        ].join('\n'),
        JSON_RULES,
        [
            '형식:',
            '{',
            '  "episode": {"title": "새 화의 짧은 부제(화 번호는 빼고)", "summary": "새 화 내용 3~5문장 요약"},',
            '  "comments": [{"postNo": 대상 게시글 번호, "author": "닉네임", "text": "댓글", "replyTo": "게시글번호-댓글번호 또는 생략"}],',
            '  "threads": [{"author": "닉네임", "title": "독자가 새로 쓴 글 제목", "body": "본문", "comments": [{"author": "닉네임", "text": "댓글"}]}],',
            '  "readerUpdates": [{"handle": "닉네임", "opinion": "지금 이 작품에 대한 생각 한두 문장", "newTheories": ["새로 품은 추측"], "resolved": [{"id": "t3", "status": "confirmed 또는 refuted", "note": "어떻게 됐는지"}], "subscribed": true 또는 false, "scores": {"fun": 0~10, "immersion": 0~10, "plausibility": 0~10, "nextIntent": 0~10}}],',
            board.settings.allowNewcomers ? '  "newReaders": [{"handle": "새 닉네임", "persona": "...", "taste": "...", "dealbreakers": "...", "level": 0~4, "activity": 0.1~1, "opinion": "..."}]' : '',
            '}',
            plan.episode ? '- episode는 반드시 채운다.' : '- 새 화가 없으므로 episode는 null로 둔다.',
            '- comments의 postNo는 이번에 반응할 게시글 번호 중 하나여야 한다. 한 게시글에 여러 독자가 댓글을 달고, 서로 답글을 주고받아도 된다. 새 댓글 번호는 그 게시글의 기존 마지막 댓글 다음부터 순서대로 매겨진다.',
            '- threads는 0~2개. 토론이나 떡밥 정리처럼 독자가 따로 글을 쓸 만할 때만 만든다.',
            '- readerUpdates는 이번에 활동한 독자 모두에 대해 쓴다. scores는 새 화를 읽은 경우에만 넣는다.',
            board.settings.allowNewcomers ? '- newReaders는 보통 비워 두고, 새 독자가 들어올 만한 화제가 있을 때만 1~2명 넣는다. 새 독자도 이번에 댓글을 달 수 있다.' : '',
        ].filter(Boolean).join('\n'),
    ].join('\n\n')

    const targets = plan.targetPostNos.map((no) => {
        const post = board.posts.find((item) => item.no === no)!
        if (post.kind === 'episode') return `#${no} 새로 연재된 ${post.title} (본문은 아래 "새 화 본문")`
        return describePost(board, post, 20)
    })
    const work = currentWork(board)
    const previous = describePreviousWork(board)
    const user = [
        `작품 이름: ${work.title || storyName || '제목 미정'}`,
        previous,
        `${previous ? '지금 작품의 연재' : '지금까지의 연재'}:\n${describeStory(board, plan)}`,
        options.wiki?.trim()
            ? `연재분 정리 기록 (이미 연재된 내용만 담은 메모. 독자가 지난 화의 세부를 떠올리는 데 쓴다. 기록 자체는 독자가 본 적 없으므로 "기록에 따르면" 같은 말은 하지 않는다):\n<notes>\n${options.wiki.trim()}\n</notes>`
            : '',
        plan.events.length > 0 ? `방금 일어난 일:\n${plan.events.map((event) => `- ${event}`).join('\n')}` : '',
        recent.length > 0 ? `최근 게시판 글:\n${recent.map((post) => describePost(board, post, 8)).join('\n\n')}` : '',
        pending.length > 0 ? `독자들이 아직 반응하지 않은 작가의 글:\n${pending.join('\n')}` : '',
        audienceLine(board),
        `이번에 활동할 독자:\n${listed.filter((reader) => active.has(reader.handle)).map((reader) => describeReader(board, reader, true)).join('\n')}`,
        listed.some((reader) => !active.has(reader.handle))
            ? `이번에는 들어오지 않은 독자(댓글 쓰지 말 것):\n${listed.filter((reader) => !active.has(reader.handle)).map((reader) => describeReader(board, reader, false)).join('\n')}`
            : '',
        `이번에 반응할 게시글:\n${targets.join('\n\n')}`,
        plan.episode ? `새 화 본문 (${episodeLabel(plan.episode)}):\n<episode>\n${plan.episodeText}\n</episode>` : '',
    ].filter(Boolean).join('\n\n')
    return [
        { role: 'system', content: system },
        { role: 'user', content: user },
    ]
}

/** "2화 열쇠" or "제2화: 열쇠" becomes "열쇠"; the label already shows the number. */
export function stripEpisodeNumber(title: string): string {
    return title.trim().replace(/^(?:제\s*)?\d+\s*화(?:\s*[:.\-–—|)]\s*|\s+)/, '').trim()
}

/** Pulls the JSON object out of a reply that may carry fences or prose. */
export function parseModelJson(reply: string): Record<string, unknown> {
    const candidates: string[] = [reply.trim()]
    const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(reply)
    if (fence) candidates.push(fence[1].trim())
    const first = reply.indexOf('{')
    const last = reply.lastIndexOf('}')
    if (first >= 0 && last > first) candidates.push(reply.slice(first, last + 1))
    for (const candidate of candidates) {
        try {
            const value = JSON.parse(candidate)
            if (isRecord(value)) return value
        }
        catch {}
    }
    throw new Error('모델 응답에서 JSON을 찾지 못했습니다.')
}

function newReaderFrom(value: unknown, id: string, postNo: number, taken: Set<string>): ReaderBoardReader | null {
    if (!isRecord(value)) return null
    const handle = text(value.handle, 40).trim()
    if (!handle || taken.has(handle) || handle === AUTHOR_HANDLE_DEFAULT) return null
    taken.add(handle)
    return normalizeReader({
        id,
        handle,
        persona: value.persona,
        taste: value.taste,
        dealbreakers: value.dealbreakers,
        level: value.level,
        activity: value.activity,
        opinion: value.opinion,
        theories: [],
        subscribed: true,
        joinedPostNo: postNo,
        lastActivePostNo: 0,
    })
}

export function applyRosterResult(board: ReaderBoard, reply: Record<string, unknown>, createId: () => string): number {
    const list = Array.isArray(reply.readers) ? reply.readers : []
    const taken = new Set(board.readers.map((reader) => reader.handle))
    taken.add(board.settings.authorName)
    let added = 0
    for (const item of list) {
        const reader = newReaderFrom(item, createId(), board.nextPostNo - 1, taken)
        if (!reader) continue
        board.readers.push(reader)
        added++
    }
    if (added === 0) throw new Error('모델이 독자 명단을 만들지 못했습니다.')
    board.updatedAt = Date.now()
    return added
}

export interface ApplyResult {
    comments: number
    threads: number
    newReaders: string[]
    dropped: string[]
    returned: string[]
}

/** Writes one reply into the plan's working copy. The caller saves plan.board. */
export function applyGenerationResult(
    plan: GenerationPlan,
    reply: Record<string, unknown>,
    input: { createId: () => string; now?: number },
): ApplyResult {
    const now = input.now ?? Date.now()
    const board = plan.board
    const author = board.settings.authorName
    const result: ApplyResult = { comments: 0, threads: 0, newReaders: [], dropped: [], returned: [] }
    const handles = new Set(board.readers.map((reader) => reader.handle))
    handles.add(author)

    if (board.settings.allowNewcomers && Array.isArray(reply.newReaders)) {
        for (const item of reply.newReaders.slice(0, 2)) {
            const reader = newReaderFrom(item, input.createId(), plan.episodePostNo ?? plan.targetPostNos[0], handles)
            if (!reader) continue
            board.readers.push(reader)
            result.newReaders.push(reader.handle)
        }
    }
    const allowed = new Set([...plan.activeHandles, ...result.newReaders])
    const banned = new Set(board.readers.filter((reader) => reader.banned).map((reader) => reader.handle))
    const authorOf = (value: unknown): string | null => {
        const name = text(value, 40).trim()
        // The model must not speak for the author; unknown names stay as passers-by.
        if (!name || name === author || banned.has(name)) return null
        return name
    }

    if (plan.episode) {
        const episode = board.episodes.find((item) => item.id === plan.episode!.id)!
        const info = isRecord(reply.episode) ? reply.episode : {}
        episode.title = stripEpisodeNumber(text(info.title, 200))
        episode.summary = text(info.summary, 4000).trim()
        const post = board.posts.find((item) => item.no === plan.episodePostNo)!
        post.title = episodeTitle(episode)
        post.body = episode.summary
    }

    const targetSet = new Set(plan.targetPostNos)
    const touched = new Set<string>()
    if (Array.isArray(reply.comments)) {
        for (const item of reply.comments) {
            if (!isRecord(item)) continue
            const postNo = Number(item.postNo)
            const name = authorOf(item.author)
            if (!targetSet.has(postNo) || !name) continue
            const comment = addComment(board, postNo, {
                author: name,
                text: text(item.text, 6000),
                replyTo: typeof item.replyTo === 'string' ? item.replyTo.trim() : undefined,
                now,
            })
            if (!comment) continue
            result.comments++
            touched.add(name)
        }
    }
    if (Array.isArray(reply.threads)) {
        for (const item of reply.threads.slice(0, 2)) {
            if (!isRecord(item)) continue
            const name = authorOf(item.author)
            const title = text(item.title, 300).trim()
            if (!name || !title) continue
            const post: ReaderBoardPost = {
                no: board.nextPostNo++,
                kind: 'thread',
                author: name,
                title,
                body: text(item.body, 20000).trim(),
                comments: [],
                createdAt: now,
            }
            board.posts.push(post)
            touched.add(name)
            result.threads++
            if (Array.isArray(item.comments)) {
                for (const entry of item.comments) {
                    if (!isRecord(entry)) continue
                    const commenter = authorOf(entry.author)
                    if (!commenter) continue
                    if (addComment(board, post.no, { author: commenter, text: text(entry.text, 6000), now })) {
                        result.comments++
                        touched.add(commenter)
                    }
                }
            }
        }
    }

    const rated: { fun: number; immersion: number; plausibility: number; nextIntent: number }[] = []
    const anchor = plan.episodePostNo ?? plan.targetPostNos[plan.targetPostNos.length - 1]
    if (Array.isArray(reply.readerUpdates)) {
        for (const item of reply.readerUpdates) {
            if (!isRecord(item)) continue
            const reader = board.readers.find((entry) => entry.handle === text(item.handle, 40).trim())
            if (!reader || (!allowed.has(reader.handle) && !touched.has(reader.handle))) continue
            reader.lastActivePostNo = anchor
            const opinion = text(item.opinion, 800).trim()
            if (opinion) reader.opinion = opinion
            if (Array.isArray(item.newTheories)) {
                for (const theory of item.newTheories.slice(0, 3)) {
                    const body = text(theory, 600).trim()
                    if (!body) continue
                    reader.theories.push({ id: `t${board.nextTheoryNo++}`, workId: board.currentWorkId, text: body, status: 'open', postNo: anchor })
                }
            }
            if (Array.isArray(item.resolved)) {
                for (const entry of item.resolved) {
                    if (!isRecord(entry)) continue
                    const theory = reader.theories.find((candidate) => candidate.id === entry.id && candidate.status === 'open' && candidate.workId === board.currentWorkId)
                    if (!theory || (entry.status !== 'confirmed' && entry.status !== 'refuted')) continue
                    theory.status = entry.status
                    theory.postNo = anchor
                    const note = text(entry.note, 600).trim()
                    if (note) theory.note = note
                }
            }
            if (typeof item.subscribed === 'boolean' && item.subscribed !== reader.subscribed) {
                reader.subscribed = item.subscribed
                ;(item.subscribed ? result.returned : result.dropped).push(reader.handle)
            }
            if (plan.episode && isRecord(item.scores)) {
                rated.push({
                    fun: score(item.scores.fun),
                    immersion: score(item.scores.immersion),
                    plausibility: score(item.scores.plausibility),
                    nextIntent: score(item.scores.nextIntent),
                })
            }
        }
    }
    for (const reader of board.readers) if (touched.has(reader.handle)) reader.lastActivePostNo = anchor

    if (plan.episode) {
        const average = (key: keyof typeof rated[number]) => rated.length
            ? Math.round(rated.reduce((sum, item) => sum + item[key], 0) / rated.length * 10) / 10
            : 0
        const previous = board.metrics.filter((metric) => metric.workId === plan.episode!.workId && metric.raters > 0).at(-1)
        const crowd = simulateAudience({
            subscribers: board.audience.subscribers,
            scores: rated.length ? { fun: average('fun'), immersion: average('immersion'), nextIntent: average('nextIntent') } : null,
            previousIntent: previous?.nextIntent ?? 6,
            seed: plan.episode.id,
        })
        board.audience.subscribers = crowd.subscribers
        board.metrics.push({
            episodeId: plan.episode.id,
            workId: plan.episode.workId,
            postNo: plan.episodePostNo!,
            fun: average('fun'),
            immersion: average('immersion'),
            plausibility: average('plausibility'),
            nextIntent: average('nextIntent'),
            raters: rated.length,
            subscribers: board.readers.filter((reader) => reader.subscribed && !reader.banned).length,
            dropped: [...result.dropped],
            joined: [...result.newReaders, ...result.returned],
            views: crowd.views,
            audienceSubscribers: crowd.subscribers,
            gained: crowd.gained,
            lost: crowd.lost,
        })
    }
    if (result.comments === 0 && result.threads === 0) throw new Error('모델 응답에 독자 댓글이 없습니다.')
    board.pendingAuthor = board.pendingAuthor.filter((item) => !targetSet.has(item.postNo))
    board.updatedAt = now
    return result
}

// ---------------------------------------------------------------- export

function escapeHtml(value: string): string {
    return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!)
}

function formatDate(time: number): string {
    if (!time) return ''
    const date = new Date(time)
    const pad = (value: number) => String(value).padStart(2, '0')
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function readerBoardExportFileName(name: string, extension: 'html' | 'md', date: Date): string {
    const safe = name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || '독자 게시판'
    const pad = (value: number) => String(value).padStart(2, '0')
    return `${safe} ${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}.${extension}`
}

const EXPORT_DATA_ID = 'risubard-reader-board'

/** One file to read in a browser; the embedded JSON lets RisuBard import it back. */
export function renderReaderBoardHtml(board: ReaderBoard): string {
    const episodeById = new Map(board.episodes.map((episode) => [episode.id, episode]))
    const posts = [...board.posts].reverse().map((post) => {
        const episode = post.episodeId ? episodeById.get(post.episodeId) : undefined
        const retracted = episode?.status === 'retracted'
        const comments = orderComments(post).map(({ comment, reply }) => `
            <li class="comment${comment.byAuthor ? ' by-author' : ''}${reply ? ' reply' : ''}">
                <div class="meta"><b>${escapeHtml(comment.author)}</b><span>${post.no}-${comment.no}</span>${comment.replyTo ? `<span>↳ ${escapeHtml(comment.replyTo)}</span>` : ''}</div>
                <p>${escapeHtml(comment.text)}</p>
            </li>`).join('')
        return `
        <article class="post kind-${post.kind}${retracted ? ' retracted' : ''}">
            <header>
                <span class="no">#${post.no}</span>
                <h2>${escapeHtml(post.title)}${retracted ? ' <small>내려감</small>' : ''}</h2>
                <div class="meta"><b>${escapeHtml(post.author)}</b><span>${formatDate(post.createdAt)}</span></div>
            </header>
            ${post.body ? `<p class="body">${escapeHtml(post.body)}</p>` : ''}
            ${comments ? `<ul class="comments">${comments}</ul>` : ''}
        </article>`
    }).join('')
    const readers = board.readers.map((reader) => `
        <li${reader.subscribed ? '' : ' class="left"'}>
            <b>${escapeHtml(reader.handle)}</b>${reader.subscribed ? '' : ' <small>구독 취소</small>'}
            <p>${escapeHtml(reader.persona)}</p>
            ${reader.opinion ? `<p class="opinion">${escapeHtml(reader.opinion)}</p>` : ''}
        </li>`).join('')
    const data = JSON.stringify(board).replace(/</g, '\\u003c')
    return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(board.name)}</title>
<style>
:root { color-scheme: light dark; --bg: #f6f5f2; --card: #fff; --line: #ddd8cf; --text: #1f1d1a; --muted: #6d675e; --accent: #8a5a2b; }
@media (prefers-color-scheme: dark) { :root { --bg: #1a1918; --card: #242220; --line: #3a3733; --text: #ece8e1; --muted: #a39d93; --accent: #d9a46c; } }
* { box-sizing: border-box; }
body { margin: 0; padding: 24px 16px 64px; background: var(--bg); color: var(--text); font: 15px/1.65 system-ui, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif; }
main { max-width: 760px; margin: 0 auto; }
h1 { margin: 0 0 4px; font-size: 1.5rem; }
.sub { margin: 0 0 24px; color: var(--muted); font-size: .85rem; }
.post { margin: 0 0 14px; padding: 14px 16px; border: 1px solid var(--line); border-radius: 10px; background: var(--card); }
.post header { display: grid; gap: 2px; }
.post h2 { margin: 0; font-size: 1.02rem; }
.post .no { color: var(--accent); font-weight: 700; font-size: .8rem; }
.kind-event { border-style: dashed; }
.kind-author { border-color: var(--accent); }
.retracted h2 { text-decoration: line-through; color: var(--muted); }
.meta { display: flex; flex-wrap: wrap; gap: 8px; color: var(--muted); font-size: .78rem; }
.meta b { color: var(--text); }
.body { margin: 10px 0 0; white-space: pre-wrap; }
.comments { margin: 12px 0 0; padding: 0; list-style: none; border-top: 1px solid var(--line); }
.comment { padding: 8px 0; border-bottom: 1px solid var(--line); }
.comment:last-child { border-bottom: 0; }
.comment.reply { padding-left: 18px; }
.comment.by-author b { color: var(--accent); }
.comment p { margin: 2px 0 0; white-space: pre-wrap; }
details { margin: 0 0 24px; }
details ul { padding-left: 18px; }
.left { opacity: .6; }
.opinion { color: var(--muted); }
</style>
</head>
<body>
<main>
<h1>${escapeHtml(board.name)}</h1>
<p class="sub">게시글 ${board.posts.length}개, 독자 ${board.readers.length}명 (구독 ${board.readers.filter((reader) => reader.subscribed).length}명), 저장 ${formatDate(Date.now())}</p>
<details><summary>독자 명단</summary><ul>${readers}</ul></details>
${posts}
</main>
<script type="application/json" id="${EXPORT_DATA_ID}">${data}</script>
</body>
</html>
`
}

export function renderReaderBoardMarkdown(board: ReaderBoard): string {
    const lines = [`# ${board.name}`, '']
    for (const post of board.posts) {
        lines.push(`## #${post.no} ${post.title}`, '', `**${post.author}** ${formatDate(post.createdAt)}`, '')
        if (post.body) lines.push(post.body, '')
        for (const { comment } of orderComments(post)) {
            lines.push(`- **${comment.author}** (${post.no}-${comment.no}${comment.replyTo ? `, ↳ ${comment.replyTo}` : ''}): ${comment.text.replace(/\n+/g, ' ')}`)
        }
        if (post.comments.length) lines.push('')
    }
    lines.push('## 독자 명단', '')
    for (const reader of board.readers) {
        lines.push(`- **${reader.handle}**${reader.subscribed ? '' : ' (구독 취소)'}: ${reader.persona}${reader.opinion ? ` / 현재 생각: ${reader.opinion}` : ''}`)
    }
    return `${lines.join('\n')}\n`
}

/** Reads a board from an exported HTML file or a plain JSON file. */
export function parseReaderBoardImport(content: string): ReaderBoard {
    let raw: unknown
    const marker = new RegExp(`<script[^>]*id=["']${EXPORT_DATA_ID}["'][^>]*>([\\s\\S]*?)</script>`, 'i').exec(content)
    try {
        raw = JSON.parse(marker ? marker[1] : content)
    }
    catch {
        throw new Error('독자 게시판 파일이 아닙니다.')
    }
    const board = normalizeReaderBoard(raw)
    if (!board) throw new Error('독자 게시판 데이터를 읽지 못했습니다.')
    return board
}
