import { describe, expect, it } from 'vitest'
import { createBardLoreSettings, type BardLoreEntry, type BardLoreSettings } from './bardLore'
import { BardLoreBudgetError, selectBardLoreEntries } from './bardLoreRetrieval'

const settings: BardLoreSettings = createBardLoreSettings({
    targetTokens: 400,
    maximumTokens: 800,
    maxEntries: 8,
})

function entry(id: string, overrides: Partial<BardLoreEntry> = {}): BardLoreEntry {
    return {
        id,
        key: '',
        secondkey: '',
        insertorder: 10,
        comment: id,
        content: '',
        mode: 'normal',
        alwaysActive: false,
        selective: false,
        bard: {
            sourceLegacyId: id,
            sourceHash: id,
            kind: 'other',
            activation: 'retrieve',
            aliases: [],
            tags: [],
            summary: '',
            facets: [],
            injection: 'full',
            links: [],
        },
        ...overrides,
    }
}

function select(query: string, entries: BardLoreEntry[], tokenCounts: Record<string, number>, overrides: Partial<BardLoreSettings> = {}, priorityQuery?: string) {
    return selectBardLoreEntries({
        query,
        priorityQuery,
        entries,
        tokenCounts,
        settings: { ...settings, ...overrides },
    })
}

describe('selectBardLoreEntries', () => {
    const leo = () => entry('leo', {
        comment: '카이넬 레오', key: '카이넬 레오, 카이넬',
        bard: { ...entry('leo').bard, kind: 'character', activation: 'keyed',
            facets: [{ key: 'gender', value: 'male', aliases: ['남'] }] },
    })

    it('routes only the current input while retaining recent context for retrieval', () => {
        const current = '카이넬 레오를 만난다.'
        const result = select('장소 설명: 여자 캐릭터 3명\n' + current,
            [leo()], { leo: 80 }, {}, current)
        expect(result.selected.map((item) => item.entry.id)).toEqual(['leo'])
        expect(result.plan).toMatchObject({ query: current, targetKinds: [], constraints: [] })
    })

    it('keeps a directly named character in ordinary narration mentioning a place and a woman', () => {
        const result = select('카이넬 레오가 여자와 약속한 장소를 설명한다.', [leo()], { leo: 80 })
        expect(result.selected.map((item) => item.entry.id)).toEqual(['leo'])
    })

    it('does not weaken a hard token exclusion into an inferred filter exclusion', () => {
        const result = select('카이넬 레오가 여자와 약속한 장소를 설명한다.', [leo()], { leo: 900 })
        expect(result.selected).toEqual([])
        expect(result.excluded[0].reason).toBe('token-limit')
    })

    it('prioritizes a current title-only match over old keys and high sparse scores', () => {
        const old = entry('old', { key: '옛 인물', content: '새 인물' })
        const current = entry('new', { comment: '새 인물' })
        const result = select('옛 인물\n새 인물', [old, current], { old: 10, new: 10 }, {
            maxEntries: 1, fieldWeights: { ...settings.fieldWeights, content: 100_000 },
        }, '새 인물')
        expect(result.selected.map((item) => item.entry.id)).toEqual(['new'])
    })

    it('uses the current input even when the context window supplied by the caller is empty', () => {
        expect(select('', [leo()], { leo: 80 }, {}, '카이넬 레오').selected[0]?.entry.id).toBe('leo')
    })

    it('normalizes Unicode for directly matched keys', () => {
        const named = leo()
        named.key = '카이넬 레오'.normalize('NFD')
        named.comment = 'profile'
        expect(select('카이넬 레오', [named], { leo: 80 }).selected[0]?.reason).toBe('key')
    })

    it('always selects required entries and reports the reserved reason', () => {
        const required = entry('format', { bard: { ...entry('x').bard, sourceLegacyId: 'format', sourceHash: 'format', activation: 'required' } })

        const result = select('unrelated', [required], { format: 30 })

        expect(result.selected.map((item) => item.entry.id)).toEqual(['format'])
        expect(result.selected[0].reason).toBe('required')
        expect(result.totalTokens).toBe(30)
    })

    it('keeps required system lore outside the contextual target and entry count', () => {
        const required = entry('format', {
            bard: { ...entry('x').bard, sourceLegacyId: 'format', sourceHash: 'format', kind: 'system', activation: 'required' },
        })
        const first = entry('first', { content: '데이트 장소 첫째', bard: { ...entry('x').bard, sourceLegacyId: 'first', sourceHash: 'first', kind: 'location' } })
        const second = entry('second', { content: '데이트 장소 둘째', bard: { ...entry('x').bard, sourceLegacyId: 'second', sourceHash: 'second', kind: 'location' } })

        const result = select('데이트 장소', [required, first, second], { format: 350, first: 100, second: 100 }, {
            targetTokens: 200,
            maximumTokens: 700,
            maxEntries: 2,
        })

        expect(result.selected.map((item) => item.entry.id)).toEqual(['format', 'first', 'second'])
        expect(result.selected.map((item) => item.lane)).toEqual(['required', 'context', 'context'])
        expect(result).toMatchObject({ requiredTokens: 350, contextualTokens: 200, totalTokens: 550 })
    })

    it('treats direct aliases as strong seeds', () => {
        const mall = entry('mall', {
            bard: { ...entry('x').bard, sourceLegacyId: 'mall', sourceHash: 'mall', activation: 'keyed', aliases: ['폴로니안 몰'] },
        })

        const result = select('오늘 폴로니안 몰에서 데이트하자.', [mall], { mall: 80 })

        expect(result.selected[0]).toMatchObject({ reason: 'alias' })
    })

    it('injects the full entry selected by a multi-word primary key', () => {
        const gameOver = entry('game-over', {
            key: 'game over, gameover',
            content: 'GAME OVER INSTRUCTIONS',
        })

        const result = select('game over', [gameOver], { 'game-over': 80 })

        expect(result.selected).toEqual([
            expect.objectContaining({
                entry: expect.objectContaining({
                    id: 'game-over',
                    content: 'GAME OVER INSTRUCTIONS',
                }),
                reason: 'key',
            }),
        ])
    })

    it('prioritizes a direct match from the latest user input over older context matches', () => {
        const haania = entry('haania', { key: 'Haania, Hanya' })
        const lilia = entry('lilia', { key: 'Lilia' })
        const gameOver = entry('game-over', {
            key: 'game over, gameover',
            content: 'GAME OVER INSTRUCTIONS',
        })

        const result = select(
            'Haania\nLilia\ngame over',
            [haania, lilia, gameOver],
            { haania: 60, lilia: 60, 'game-over': 60 },
            { targetTokens: 100, maximumTokens: 180, maxEntries: 3 },
            'game over',
        )

        expect(result.selected[0].entry.id).toBe('game-over')
        expect(result.selected.map((item) => item.entry.id)).toContain('game-over')
    })

    it('uses sparse Korean and English evidence without including unrelated entries of the same kind', () => {
        const mall = entry('mall', {
            comment: 'Paulownia Mall',
            content: '시내 카페와 영화관이 있는 데이트 장소.',
            bard: { ...entry('x').bard, sourceLegacyId: 'mall', sourceHash: 'mall', kind: 'location', tags: ['시내', '데이트'], summary: 'Downtown cafe district' },
        })
        const dorm = entry('dorm', {
            comment: 'Dormitory',
            content: '학생 기숙사와 작전 회의실.',
            bard: { ...entry('x').bard, sourceLegacyId: 'dorm', sourceHash: 'dorm', kind: 'location', tags: ['기숙사'], summary: 'Student dormitory' },
        })

        const result = select('시내 cafe 데이트', [mall, dorm], { mall: 100, dorm: 100 })

        expect(result.selected.map((item) => item.entry.id)).toEqual(['mall'])
        expect(result.selected[0].reason).toBe('sparse')
    })

    it('does not retrieve a country merely because it shares a kind with a direct match', () => {
        const soviet = entry('ussr', {
            key: '소련',
            bard: { ...entry('x').bard, sourceLegacyId: 'ussr', sourceHash: 'ussr', kind: 'faction', activation: 'keyed', aliases: ['소련'] },
        })
        const america = entry('usa', {
            content: '미국 햄버거와 해군 이야기',
            bard: { ...entry('x').bard, sourceLegacyId: 'usa', sourceHash: 'usa', kind: 'faction', tags: ['국가'] },
        })

        const result = select('소련 잠수함에서 식사한다.', [soviet, america], { ussr: 60, usa: 60 })

        expect(result.selected.map((item) => item.entry.id)).toEqual(['ussr'])
    })

    it('follows only one explicit supporting-link hop', () => {
        const seed = entry('seed', {
            bard: {
                ...entry('x').bard,
                sourceLegacyId: 'seed',
                sourceHash: 'seed',
                activation: 'keyed',
                aliases: ['타르타로스'],
                links: [{ targetId: 'support', relation: 'contains', retrieval: 'supporting' }],
            },
        })
        const support = entry('support', {
            bard: {
                ...entry('x').bard,
                sourceLegacyId: 'support',
                sourceHash: 'support',
                links: [{ targetId: 'second-hop', relation: 'related', retrieval: 'supporting' }],
            },
        })
        const secondHop = entry('second-hop')

        const result = select('타르타로스 탐색', [seed, support, secondHop], { seed: 30, support: 30, 'second-hop': 30 })

        expect(result.selected.map((item) => item.entry.id)).toEqual(['seed', 'support'])
        expect(result.selected[1]).toMatchObject({ reason: 'link', path: ['seed', 'support'] })
    })

    it('uses the configured link depth instead of a fixed one-hop rule', () => {
        const seed = entry('seed', {
            bard: {
                ...entry('x').bard,
                sourceLegacyId: 'seed',
                sourceHash: 'seed',
                activation: 'keyed',
                aliases: ['탑'],
                links: [{ targetId: 'middle', relation: 'contains', retrieval: 'supporting' }],
            },
        })
        const middle = entry('middle', {
            bard: {
                ...entry('x').bard,
                sourceLegacyId: 'middle',
                sourceHash: 'middle',
                links: [{ targetId: 'deep', relation: 'contains', retrieval: 'supporting' }],
            },
        })
        const deep = entry('deep')

        const result = select('탑 탐색', [seed, middle, deep], { seed: 10, middle: 10, deep: 10 }, { maxLinkDepth: 2 })

        expect(result.selected.map((item) => item.entry.id)).toEqual(['seed', 'middle', 'deep'])
        expect(result.selected[2].path).toEqual(['seed', 'middle', 'deep'])
    })

    it('uses an index-only entry as a routing seed without injecting its body or token count', () => {
        const catalog = entry('catalog', {
            bard: {
                ...entry('x').bard,
                sourceLegacyId: 'catalog',
                sourceHash: 'catalog',
                activation: 'keyed',
                aliases: ['학교 인물'],
                injection: 'index-only',
                links: [{ targetId: 'yukari', relation: 'contains', retrieval: 'supporting' }],
            },
        })
        const yukari = entry('yukari', { bard: { ...entry('x').bard, sourceLegacyId: 'yukari', sourceHash: 'yukari', kind: 'character' } })

        const result = select('학교 인물', [catalog, yukari], { yukari: 80 }, {
            targetTokens: 100,
            maximumTokens: 100,
        })

        expect(result.selected.map((item) => item.entry.id)).toEqual(['yukari'])
        expect(result.totalTokens).toBe(80)
        expect(result.excluded).toContainEqual(expect.objectContaining({
            entry: expect.objectContaining({ id: 'catalog' }),
            reason: 'routing-only',
        }))
    })

    it('injects a scene location matched only by its title while using it as an ambient graph seed', () => {
        const school = entry('school', {
            comment: '월광관 고등학교',
            bard: { ...entry('x').bard, sourceLegacyId: 'school', sourceHash: 'school', kind: 'location' },
        })
        const student = entry('student', {
            bard: {
                ...entry('x').bard,
                sourceLegacyId: 'student',
                sourceHash: 'student',
                kind: 'character',
                links: [{ targetId: 'school', relation: 'attends', retrieval: 'ambient' }],
            },
        })

        const result = select('월광관 고등학교에 갔다', [school, student], { school: 20, student: 20 })

        expect(result.selected.map((item) => item.entry.id)).toEqual(['school', 'student'])
        expect(result.selected[0].reason).toBe('entity')
    })

    it('selects the requested number of facet-matched characters without a roster entry', () => {
        const characters = ['akihiko', 'junpei', 'shinjiro', 'yukari'].map((id, index) => entry(id, {
            bard: {
                ...entry('x').bard,
                sourceLegacyId: id,
                sourceHash: id,
                kind: 'character',
                facets: [
                    { key: 'work', value: 'Persona 3', aliases: ['페르소나 3'] },
                    { key: 'gender', value: index < 3 ? 'male' : 'female', aliases: index < 3 ? ['남자'] : ['여자'] },
                ],
            },
        }))

        const result = select('페르소나 3의 남자 캐릭터 아무나 3명에 대해 설명해 봐', characters, {
            akihiko: 100, junpei: 100, shinjiro: 100, yukari: 100,
        }, {
            targetTokens: 400,
            maximumTokens: 400,
            maxEntries: 4,
        })

        expect(result.selected.map((item) => item.entry.id)).toEqual(['akihiko', 'junpei', 'shinjiro'])
        expect(result.selected.every((item) => item.reason === 'facet')).toBe(true)
        expect(result.plan).toMatchObject({ requestedCount: 3, targetKinds: ['character'] })
    })

    it('keeps required lore but excludes non-character context from an explicit character request', () => {
        const required = entry('format', {
            bard: { ...entry('x').bard, sourceLegacyId: 'format', sourceHash: 'format', kind: 'system', activation: 'required' },
        })
        const characters = ['akihiko', 'junpei', 'shinjiro'].map((id) => entry(id, {
            bard: {
                ...entry('x').bard,
                sourceLegacyId: id,
                sourceHash: id,
                kind: 'character',
                facets: [
                    { key: 'work', value: 'Persona 3', aliases: ['페르소나 3'] },
                    { key: 'gender', value: 'male', aliases: ['남자'] },
                ],
            },
        }))
        const personaWorld = entry('persona-world', {
            comment: '페르소나·와일드',
            content: '페르소나 3의 페르소나 설정',
            bard: {
                ...entry('x').bard,
                sourceLegacyId: 'persona-world',
                sourceHash: 'persona-world',
                kind: 'concept',
                aliases: ['페르소나'],
            },
        })
        const awakening = entry('awakening', {
            comment: '소환기·각성',
            content: '페르소나 3 캐릭터의 각성',
            bard: { ...entry('x').bard, sourceLegacyId: 'awakening', sourceHash: 'awakening', kind: 'concept' },
        })

        const result = select(
            '페르소나 3의 남자 캐릭터 아무나 3명에 대해 설명해 봐',
            [required, ...characters, personaWorld, awakening],
            { format: 50, akihiko: 50, junpei: 50, shinjiro: 50, 'persona-world': 50, awakening: 50 },
            { targetTokens: 500, maximumTokens: 500, maxEntries: 10 },
        )

        expect(result.selected.map((item) => item.entry.id)).toEqual(['format', 'akihiko', 'junpei', 'shinjiro'])
        expect(result.excluded).toEqual(expect.arrayContaining([
            expect.objectContaining({ entry: expect.objectContaining({ id: 'persona-world' }), reason: 'kind-mismatch' }),
            expect.objectContaining({ entry: expect.objectContaining({ id: 'awakening' }), reason: 'kind-mismatch' }),
        ]))
    })

    it('does not let an index-only match consume a requested result slot', () => {
        const matching = (id: string, injection: 'full' | 'index-only' = 'full') => entry(id, {
            bard: {
                ...entry('x').bard,
                sourceLegacyId: id,
                sourceHash: id,
                kind: 'character',
                injection,
                facets: [{ key: 'gender', value: 'male', aliases: ['남자'] }],
            },
        })
        const entries = [matching('a-roster', 'index-only'), matching('b'), matching('c'), matching('d'), matching('e')]

        const result = select('남자 캐릭터 아무나 3명', entries, { b: 10, c: 10, d: 10, e: 10 }, {
            targetTokens: 100,
            maximumTokens: 100,
            maxEntries: 10,
        })

        expect(result.selected.map((item) => item.entry.id)).toEqual(['b', 'c', 'd'])
        expect(result.excluded).toContainEqual(expect.objectContaining({
            entry: expect.objectContaining({ id: 'a-roster' }),
            reason: 'routing-only',
        }))
    })

    it('applies facet constraints to direct entity matches before counting requested results', () => {
        const character = (id: string, name: string, gender: 'male' | 'female') => entry(id, {
            comment: name,
            key: name,
            bard: {
                ...entry('x').bard,
                sourceLegacyId: id,
                sourceHash: id,
                kind: 'character',
                facets: [{ key: 'gender', value: gender, aliases: [gender === 'male' ? '남자' : '여자'] }],
            },
        })
        const entries = [
            character('yukari', '유카리', 'female'),
            character('akihiko', '아키히코', 'male'),
            character('junpei', '준페이', 'male'),
            character('shinjiro', '신지로', 'male'),
            character('ken', '켄', 'male'),
        ]

        const result = select('유카리와 남자 캐릭터 아무나 3명', entries, {
            yukari: 10, akihiko: 10, junpei: 10, shinjiro: 10, ken: 10,
        }, { targetTokens: 100, maximumTokens: 100, maxEntries: 10 })

        expect(result.selected.map((item) => item.entry.id)).toEqual(['akihiko', 'junpei', 'ken'])
        expect(result.excluded).toContainEqual(expect.objectContaining({
            entry: expect.objectContaining({ id: 'yukari' }),
            reason: 'constraint-mismatch',
        }))
    })

    it('applies requested cardinality to the final mixed character selection', () => {
        const characters = ['akihiko', 'junpei', 'shinjiro', 'ken'].map((id) => entry(id, {
            comment: id === 'akihiko' ? '사나다 아키히코' : id,
            bard: {
                ...entry('x').bard,
                sourceLegacyId: id,
                sourceHash: id,
                kind: 'character',
                aliases: id === 'akihiko' ? ['아키히코'] : [],
                facets: [
                    { key: 'work', value: 'Persona 3', aliases: ['페르소나 3'] },
                    { key: 'gender', value: 'male', aliases: ['남자'] },
                ],
            },
        }))

        const result = select('아키히코와 페르소나 3의 남자 캐릭터 아무나 3명에 대해 설명해 봐', characters, {
            akihiko: 10, junpei: 10, shinjiro: 10, ken: 10,
        }, { targetTokens: 100, maximumTokens: 100, maxEntries: 10 })

        expect(result.selected).toHaveLength(3)
        expect(result.selected.map((item) => item.entry.id)).toContain('akihiko')
        expect(result.excluded).toContainEqual(expect.objectContaining({
            entry: expect.objectContaining({ id: 'ken' }),
            reason: 'requested-count',
        }))
    })

    it('uses configured sparse threshold and field weights', () => {
        const contentOnly = entry('content-only', { content: '비밀 카페 데이트 장소' })
        const tagged = entry('tagged', {
            bard: { ...entry('x').bard, sourceLegacyId: 'tagged', sourceHash: 'tagged', tags: ['데이트'] },
        })

        const result = select('데이트', [contentOnly, tagged], { 'content-only': 10, tagged: 10 }, {
            minimumSparseScore: 0.1,
            fieldWeights: { ...settings.fieldWeights, content: 0, tags: 5 },
        })

        expect(result.selected.map((item) => item.entry.id)).toEqual(['tagged'])
    })

    it('uses descriptive facet aliases as ranked sparse evidence instead of global filters', () => {
        const yukari = entry('yukari', {
            bard: { ...entry('x').bard, sourceLegacyId: 'yukari', sourceHash: 'yukari', kind: 'character', facets: [
                { key: 'gender', value: 'female', aliases: ['여자'] },
                { key: 'appearance', value: 'short hair', aliases: ['단발머리'] },
                { key: 'school_role', value: 'classmate', aliases: ['동급생'] },
            ] },
        })
        const mitsuru = entry('mitsuru', {
            bard: { ...entry('x').bard, sourceLegacyId: 'mitsuru', sourceHash: 'mitsuru', kind: 'character', facets: [
                { key: 'gender', value: 'female', aliases: ['여자'] },
                { key: 'social_role', value: 'senior woman', aliases: ['누님'] },
            ] },
        })
        const fuuka = entry('fuuka', {
            bard: { ...entry('x').bard, sourceLegacyId: 'fuuka', sourceHash: 'fuuka', kind: 'character', facets: [
                { key: 'gender', value: 'female', aliases: ['여자'] },
                { key: 'personality', value: 'timid', aliases: ['소심'] },
                { key: 'cooking', value: 'poor', aliases: ['요리 실력이 끔찍한'] },
                { key: 'school_role', value: 'junior', aliases: ['후배'] },
            ] },
        })
        const unrelated = entry('unrelated', {
            bard: { ...entry('x').bard, sourceLegacyId: 'unrelated', sourceHash: 'unrelated', kind: 'character' },
        })

        const result = select(
            '귀여운 단발머리 동급생, 멋진 누님, 소심하고 요리 실력이 끔찍한 여자 후배',
            [yukari, mitsuru, fuuka, unrelated],
            { yukari: 10, mitsuru: 10, fuuka: 10, unrelated: 10 },
            { targetTokens: 100, maximumTokens: 100, maxEntries: 10 },
        )

        expect(result.plan.constraints).toEqual([{ key: 'gender', value: 'female', phrase: '여자' }])
        expect(result.selected.map((item) => item.entry.id)).toEqual(['fuuka', 'yukari', 'mitsuru'])
        expect(result.selected.every((item) => item.reason === 'sparse')).toBe(true)
    })

    it('does not treat an empty alias as a direct match for every query', () => {
        const malformed = entry('malformed', {
            bard: { ...entry('x').bard, sourceLegacyId: 'malformed', sourceHash: 'malformed', aliases: ['', '  '] },
        })

        const result = select('전혀 무관한 질의', [malformed], { malformed: 10 })

        expect(result.selected).toEqual([])
    })

    it('enforces entry and token limits for optional retrieval', () => {
        const entries = ['one', 'two', 'three'].map((id) => entry(id, { content: `데이트 장소 ${id}`, bard: { ...entry('x').bard, sourceLegacyId: id, sourceHash: id, kind: 'location', tags: ['데이트'] } }))

        const result = select('데이트 장소', entries, { one: 70, two: 70, three: 70 }, { targetTokens: 200, maximumTokens: 140, maxEntries: 2 })

        expect(result.selected).toHaveLength(2)
        expect(result.totalTokens).toBe(140)
        expect(result.excluded).toContainEqual(expect.objectContaining({
            entry: expect.objectContaining({ id: 'three' }),
            reason: 'entry-limit',
        }))
    })

    it('reports why matching and unrelated entries were excluded', () => {
        const oversized = entry('oversized', { content: '데이트 장소' })
        const unrelated = entry('unrelated', { content: '우주선 정비' })

        const result = select('데이트', [oversized, unrelated], { oversized: 900, unrelated: 10 }, {
            targetTokens: 500,
            maximumTokens: 500,
        })

        expect(result.excluded.map(({ entry, reason }) => [entry.id, reason])).toEqual([
            ['oversized', 'token-limit'],
            ['unrelated', 'no-match'],
        ])
    })

    it('fails visibly when required entries alone exceed a hard limit', () => {
        const required = entry('required', { bard: { ...entry('x').bard, sourceLegacyId: 'required', sourceHash: 'required', activation: 'required' } })

        expect(() => select('anything', [required], { required: 900 })).toThrow(BardLoreBudgetError)
    })

    it('keeps a 150-entry lorebook with 49 legacy always-active entries inside configured soft limits', () => {
        const entries = Array.from({ length: 150 }, (_, index) => entry('entry-' + index, {
            alwaysActive: index < 49,
            content: index === 87 ? '폴로니안 몰 카페 데이트' : '무관한 설정 ' + index,
            bard: {
                ...entry('x').bard,
                sourceLegacyId: 'entry-' + index,
                sourceHash: 'entry-' + index,
                tags: index === 87 ? ['시내', '데이트'] : ['기타-' + index],
            },
        }))
        const tokenCounts = Object.fromEntries(entries.map((item) => [item.id, 100]))

        const result = select('시내에서 데이트', entries, tokenCounts, {
            targetTokens: 300,
            maximumTokens: 500,
            maxEntries: 5,
        })

        expect(result.selected.map((item) => item.entry.id)).toEqual(['entry-87'])
        expect(result.totalTokens).toBeLessThanOrEqual(500)
        expect(result.selected.length).toBeLessThanOrEqual(5)
    })
})
