import { describe, expect, it } from 'vitest'
import { createBardLoreSettings, type BardLoreEntry } from './bardLore'
import { compileBardLoreIndex, planBardLoreQuery } from './bardLoreQueryPlanner'

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

describe('Bard Lore deterministic query planner', () => {
    it('does not turn syllables inside Korean words into facet constraints', () => {
        const people = ['male', 'female'].map((gender) => entry(gender, {
            bard: { ...entry(gender).bard, kind: 'character', facets: [
                { key: 'gender', value: gender, aliases: gender === 'male' ? ['남'] : ['여'] },
            ] },
        }))
        const plan = planBardLoreQuery('여행을 마치고 남아 있는 지도를 본다.',
            compileBardLoreIndex(people), createBardLoreSettings())
        expect(plan.constraints).toEqual([])
    })

    it('does not treat Korean names containing category words as kind filters', () => {
        const plan = planBardLoreQuery('장소희를 만난다.', compileBardLoreIndex([]), createBardLoreSettings())
        expect(plan.targetKinds).toEqual([])
    })

    it('accepts alternative values of the same facet while retaining cross-facet restrictions', () => {
        const people = ['male', 'female'].map((gender) => entry(gender, {
            bard: { ...entry(gender).bard, kind: 'character', facets: [
                { key: 'gender', value: gender, aliases: [] },
                { key: 'work', value: 'Game A', aliases: [] },
            ] },
        }))
        const outsider = entry('outsider', { bard: { ...entry('x').bard, kind: 'character',
            facets: [{ key: 'gender', value: 'male', aliases: [] }] } })
        const plan = planBardLoreQuery('Game A의 남자와 여자 캐릭터 목록',
            compileBardLoreIndex([...people, outsider]), createBardLoreSettings())
        expect(plan.candidates.map((item) => item.entryId).sort()).toEqual(['female', 'male'])
    })

    it('resolves a location anchor and discovers ambient characters through reverse relations', () => {
        const school = entry('school', {
            comment: '월광관 고등학교',
            bard: { ...entry('x').bard, sourceLegacyId: 'school', sourceHash: 'school', kind: 'location', aliases: ['학교'] },
        })
        const student = entry('yukari', {
            comment: '타케바 유카리',
            bard: {
                ...entry('x').bard,
                sourceLegacyId: 'yukari',
                sourceHash: 'yukari',
                kind: 'character',
                aliases: ['유카리'],
                links: [{ targetId: 'school', relation: 'attends', retrieval: 'ambient' }],
            },
        })
        const settings = createBardLoreSettings({
            router: {
                ambientResultCount: 2,
                kindAliases: { location: ['장소'], character: ['캐릭터', '인물'] },
                intentAliases: { scene: ['갔다'], describe: ['설명'], list: ['누구'], arbitrary: ['아무나'] },
            },
        })

        const plan = planBardLoreQuery('학교에 갔다', compileBardLoreIndex([school, student]), settings)

        expect(plan.intent).toBe('scene')
        expect(plan.anchors).toContainEqual(expect.objectContaining({ entryId: 'school', phrase: '학교' }))
        expect(plan.candidates).toContainEqual(expect.objectContaining({
            entryId: 'yukari',
            reason: 'graph',
            path: ['school', 'yukari'],
            relation: 'attends',
        }))
    })

    it('plans an exact requested number using kind and facet constraints', () => {
        const characters = [
            ['akihiko', '사나다 아키히코', 'male'],
            ['junpei', '이오리 준페이', 'male'],
            ['shinjiro', '아라가키 신지로', 'male'],
            ['yukari', '타케바 유카리', 'female'],
        ].map(([id, name, gender]) => entry(id, {
            comment: name,
            bard: {
                ...entry('x').bard,
                sourceLegacyId: id,
                sourceHash: id,
                kind: 'character',
                facets: [
                    { key: 'work', value: 'Persona 3', aliases: ['페르소나 3', 'P3'] },
                    { key: 'gender', value: gender, aliases: gender === 'male' ? ['남자', '남성'] : ['여자', '여성'] },
                ],
            },
        }))
        const settings = createBardLoreSettings({
            router: {
                defaultResultCount: 1,
                kindAliases: { character: ['캐릭터', '인물'] },
                intentAliases: { scene: ['갔다'], describe: ['설명'], list: ['목록'], arbitrary: ['아무나'] },
            },
        })

        const plan = planBardLoreQuery(
            '페르소나 3의 남자 캐릭터 아무나 3명에 대해 설명해 봐',
            compileBardLoreIndex(characters),
            settings,
        )

        expect(plan).toMatchObject({
            intent: 'describe',
            arbitrary: true,
            requestedCount: 3,
            targetKinds: ['character'],
            constraints: expect.arrayContaining([
                { key: 'work', value: 'Persona 3', phrase: '페르소나 3' },
                { key: 'gender', value: 'male', phrase: '남자' },
            ]),
        })
        expect(plan.candidates.map((candidate) => candidate.entryId)).toEqual(['akihiko', 'junpei', 'shinjiro'])
    })

    it('ignores an ambiguous shared facet alias inside a more specific work constraint', () => {
        const characters = [
            ['akihiko', '아키히코', '폴리데우케스'],
            ['junpei', '준페이', '헤르메스'],
            ['shinjiro', '신지로', '카스토르'],
        ].map(([id, name, persona]) => entry(id, {
            comment: name,
            bard: {
                ...entry('x').bard,
                sourceLegacyId: id,
                sourceHash: id,
                kind: 'character',
                facets: [
                    { key: 'work', value: 'Persona 3', aliases: ['페르소나 3'] },
                    { key: 'gender', value: 'male', aliases: ['남자'] },
                    { key: 'persona', value: persona, aliases: ['페르소나'] },
                ],
            },
        }))
        const personaWorld = entry('persona-world', {
            comment: '페르소나·와일드',
            bard: {
                ...entry('x').bard,
                sourceLegacyId: 'persona-world',
                sourceHash: 'persona-world',
                kind: 'concept',
                aliases: ['페르소나'],
            },
        })
        const settings = createBardLoreSettings({
            router: {
                kindAliases: { character: ['캐릭터', '인물'] },
                intentAliases: { scene: ['갔다'], describe: ['설명'], list: ['목록'], arbitrary: ['아무나'] },
            },
        })

        const plan = planBardLoreQuery(
            '페르소나 3의 남자 캐릭터 아무나 3명에 대해 설명해 봐',
            compileBardLoreIndex([...characters, personaWorld]),
            settings,
        )

        expect(plan.constraints).toEqual([
            { key: 'work', value: 'Persona 3', phrase: '페르소나 3' },
            { key: 'gender', value: 'male', phrase: '남자' },
        ])
        expect(plan.anchors).not.toContainEqual(expect.objectContaining({ entryId: 'persona-world' }))
        expect(plan.candidates.map((candidate) => candidate.entryId)).toEqual(['akihiko', 'junpei', 'shinjiro'])
    })

    it('maps configured facet vocabulary and treats the character name as corpus scope', () => {
        const characters = [
            ['akihiko', '남성'],
            ['junpei', '남성'],
            ['shinjiro', '남성'],
            ['yukari', '여성'],
        ].map(([id, gender]) => entry(id, {
            bard: {
                ...entry('x').bard,
                sourceLegacyId: id,
                sourceHash: id,
                kind: 'character',
                facets: [
                    { key: 'gender', value: gender, aliases: ['성별', 'gender'] },
                    ...(id === 'yukari' ? [{ key: 'work', value: 'Persona 3', aliases: ['페르소나 3'] }] : []),
                ],
            },
        }))
        const settings = createBardLoreSettings()

        const plan = planBardLoreQuery(
            '페르소나 3의 남자 캐릭터 아무나 3명',
            compileBardLoreIndex(characters),
            settings,
            ['페르소나 3'],
        )

        expect(plan.scopeMatches).toEqual(['페르소나 3'])
        expect(plan.constraints).toEqual([{ key: 'gender', value: 'male', phrase: '남자' }])
        expect(plan.candidates.map((candidate) => candidate.entryId)).toEqual(['akihiko', 'junpei', 'shinjiro'])
    })

    it('does not infer relationships from a shared kind or facet', () => {
        const soviet = entry('ussr', {
            bard: { ...entry('x').bard, sourceLegacyId: 'ussr', sourceHash: 'ussr', kind: 'faction', aliases: ['소련'], facets: [{ key: 'type', value: 'country', aliases: ['국가'] }] },
        })
        const america = entry('usa', {
            bard: { ...entry('x').bard, sourceLegacyId: 'usa', sourceHash: 'usa', kind: 'faction', aliases: ['미국'], facets: [{ key: 'type', value: 'country', aliases: ['국가'] }] },
        })
        const settings = createBardLoreSettings()

        const plan = planBardLoreQuery('소련 잠수함에서 식사한다', compileBardLoreIndex([soviet, america]), settings)

        expect(plan.anchors.map((anchor) => anchor.entryId)).toEqual(['ussr'])
        expect(plan.candidates.map((candidate) => candidate.entryId)).not.toContain('usa')
    })

    it('obeys zero and multi-hop graph depth for ambient scene discovery', () => {
        const school = entry('school', {
            comment: '월광관 고등학교',
            bard: { ...entry('x').bard, sourceLegacyId: 'school', sourceHash: 'school', kind: 'location', aliases: ['학교'] },
        })
        const club = entry('club', {
            bard: {
                ...entry('x').bard,
                sourceLegacyId: 'club',
                sourceHash: 'club',
                kind: 'faction',
                links: [{ targetId: 'school', relation: 'based_at', retrieval: 'ambient' }],
            },
        })
        const student = entry('student', {
            bard: {
                ...entry('x').bard,
                sourceLegacyId: 'student',
                sourceHash: 'student',
                kind: 'character',
                links: [{ targetId: 'club', relation: 'member_of', retrieval: 'ambient' }],
            },
        })
        const index = compileBardLoreIndex([school, club, student])
        const router = {
            kindAliases: { character: ['캐릭터'], location: ['장소'] },
            intentAliases: { scene: ['갔다'], describe: ['설명'], list: ['목록'], arbitrary: ['아무나'] },
        }

        const disabled = planBardLoreQuery('학교에 갔다', index, createBardLoreSettings({ maxLinkDepth: 0, router }))
        const depthTwo = planBardLoreQuery('학교에 갔다', index, createBardLoreSettings({ maxLinkDepth: 2, router }))

        expect(disabled.candidates.map((candidate) => candidate.entryId)).toEqual(['school'])
        expect(depthTwo.candidates).toContainEqual(expect.objectContaining({
            entryId: 'student',
            path: ['school', 'club', 'student'],
        }))
    })
})
