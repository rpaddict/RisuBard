import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import type { BardLoreEntry } from './bardLore'
import { fingerprintBardLoreEntry } from './bardLore'
import {
    BardLoreAnalysisBudgetError,
    applyBardLoreAnalysisDraft,
    auditBardLoreAnalysisDraft,
    auditBardLoreMetadata,
    bardLoreAnalysisSchema,
    bardLoreAnalysisDraftFromRun,
    buildBardLoreAnalysisPrompt,
    buildBardLoreAnalysisInstructions,
    collectBardLoreAnalysisTargets,
    completeBardLoreAnalysisBatch,
    createBardLoreAnalysisBatches,
    createBardLoreAnalysisRun,
    failBardLoreAnalysisBatch,
    finishBardLoreAnalysisRun,
    parseBardLoreAnalysisResponse,
    planBardLoreAnalysisBatches,
} from './bardLoreAnalysis'
import { createBardLoreSettings } from './bardLore'

function entry(id: string, links: BardLoreEntry['bard']['links'] = []): BardLoreEntry {
    return {
        id,
        key: id,
        secondkey: '',
        insertorder: 10,
        comment: id,
        content: id + ' content',
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
            links,
        },
    }
}

describe('Bard Lore AI analysis', () => {
    it('collects entry, configurable connected depth, and complete scopes', () => {
        const entries = [
            entry('a', [{ targetId: 'b', relation: 'to', retrieval: 'supporting' }]),
            entry('b', [{ targetId: 'c', relation: 'to', retrieval: 'supporting' }]),
            entry('c'),
        ]

        expect(collectBardLoreAnalysisTargets(entries, 'entry', 'a', 9).map((item) => item.id)).toEqual(['a'])
        expect(collectBardLoreAnalysisTargets(entries, 'connected', 'a', 1).map((item) => item.id)).toEqual(['a', 'b'])
        expect(collectBardLoreAnalysisTargets(entries, 'connected', 'a', 2).map((item) => item.id)).toEqual(['a', 'b', 'c'])
        expect(collectBardLoreAnalysisTargets(entries, 'all', 'a', 0).map((item) => item.id)).toEqual(['a', 'b', 'c'])
    })

    it('collects only character entries for targeted descriptor enrichment', () => {
        const character = entry('character')
        character.bard.kind = 'character'
        const location = entry('location')
        location.bard.kind = 'location'

        expect(collectBardLoreAnalysisTargets([character, location], 'characters', undefined, 0)
            .map((item) => item.id)).toEqual(['character'])
    })

    it('batches by configured entry and input-token limits', () => {
        const entries = [entry('a'), entry('b'), entry('c')]
        const batches = createBardLoreAnalysisBatches(entries, { a: 30, b: 30, c: 30 }, {
            maxEntries: 2,
            maxTokens: 60,
        })

        expect(batches.map((batch) => batch.map((item) => item.id))).toEqual([['a', 'b'], ['c']])
        expect(() => createBardLoreAnalysisBatches([entry('huge')], { huge: 61 }, {
            maxEntries: 2,
            maxTokens: 60,
        })).toThrow(BardLoreAnalysisBudgetError)
    })

    it('plans against each real batch prompt instead of summing repeated catalogs per entry', async () => {
        const entries = [entry('a'), entry('b'), entry('c')]
        const seen: string[] = []
        const plan = await planBardLoreAnalysisBatches(
            entries,
            entries,
            createBardLoreSettings({ analysisBatchEntries: 2, analysisInputTokens: 90 }),
            async (value) => {
                seen.push(value)
                if (value.includes('"targets"')) {
                    const targets = JSON.parse(value.split('\n').at(-1)!).targets as unknown[]
                    return 20 + targets.length * 25
                }
                return 10
            },
        )

        expect(plan.batches.map((batch) => batch.entries.map((item) => item.id))).toEqual([['a', 'b'], ['c']])
        expect(plan.batches.map((batch) => batch.inputTokens)).toEqual([80, 55])
        expect(plan.totalInputTokens).toBe(135)
        expect(seen.filter((value) => value.includes('"linkCatalog"')).length).toBeGreaterThan(0)
    })

    it('reports the full input required for a 17,655-character entry and accepts that configured allowance', async () => {
        const { get_encoding } = createRequire(import.meta.url)('@dqbd/tiktoken')
        const encoding = get_encoding('cl100k_base')
        try {
            const source = entry('long-lore')
            source.comment = '긴 배포 로어'
            source.content = '도시의 탑지기는 광장을 지키며 방문객에게 오래된 역사를 들려준다. '.repeat(600).slice(0, 17_655)
            expect(source.content).toHaveLength(17_655)
            const settings = createBardLoreSettings()
            const tokenize = async (value: string) => encoding.encode(value).length
            const prompt = buildBardLoreAnalysisPrompt([source], [source], settings.router.filterFacetKeys)
            const required = await tokenize(prompt) + await tokenize(bardLoreAnalysisSchema)
            expect(required).toBeGreaterThan(settings.analysisInputTokens)
            await expect(planBardLoreAnalysisBatches([source], [source], settings, tokenize)).rejects.toMatchObject({
                details: { entryId: source.id, entryName: source.comment, inputTokens: required, limit: settings.analysisInputTokens },
            })
            const plan = await planBardLoreAnalysisBatches([source], [source], {
                ...settings, analysisInputTokens: required,
            }, tokenize)
            expect(plan.batches[0].inputTokens).toBe(required)
            expect(plan.batches[0].entries[0].content).toBe(source.content)
        } finally {
            encoding.free()
        }
    })

    it('keeps completed batch candidates when a later batch fails', () => {
        const entries = [entry('a'), entry('b')]
        const plan = {
            totalInputTokens: 60,
            batches: entries.map((item) => ({ entries: [item], inputTokens: 30 })),
        }
        let serial = 0
        let run = createBardLoreAnalysisRun(
            plan,
            'all',
            createBardLoreSettings(),
            () => `id-${serial++}`,
            () => '2026-08-31T00:00:00.000Z',
            'en',
        )
        run = completeBardLoreAnalysisBatch(run, run.batches[0].id, [{
            id: 'a',
            sourceHash: fingerprintBardLoreEntry(entries[0]),
            kind: 'location',
            aliases: [],
            tags: [],
            summary: 'saved draft',
            links: [],
        }])
        run = failBardLoreAnalysisBatch(run, run.batches[1].id, 'invalid response')
        run = finishBardLoreAnalysisRun(run)

        expect(run.status).toBe('review')
        expect(run.languageSnapshot).toBe('en')
        expect(run.batches.map((batch) => batch.status)).toEqual(['complete', 'failed'])
        expect(bardLoreAnalysisDraftFromRun(run).entries).toMatchObject([{ id: 'a', summary: 'saved draft' }])
    })

    it('uses compact numeric references while preserving full lore text and a catalog-first cache prefix', () => {
        const source = entry('a')
        source.id = '123e4567-e89b-12d3-a456-426614174000'
        source.key = 'bridge'
        source.comment = 'Moonlight Bridge'
        source.content = 'The complete bridge lore remains available.'
        source.bard.sourceLegacyId = source.id
        const target = entry('987e6543-e21b-12d3-a456-426614174999')
        target.key = 'harbor'
        target.comment = 'Harbor'
        target.content = 'The complete harbor lore remains available.'
        target.bard.sourceLegacyId = target.id
        const prompt = buildBardLoreAnalysisPrompt([source], [source, target])
        const sourceHash = fingerprintBardLoreEntry(source)
        const payload = JSON.parse(prompt.split('\n').at(-1)!)

        expect(Object.keys(payload)).toEqual(['linkCatalog', 'targets'])
        expect(payload.linkCatalog).toEqual([
            [0, 'Moonlight Bridge', 'other'],
            [1, 'Harbor', 'other'],
        ])
        expect(payload.targets[0]).toMatchObject({
            ref: 0,
            name: 'Moonlight Bridge',
            content: 'The complete bridge lore remains available.',
        })
        expect(prompt).not.toContain(source.id)
        expect(prompt).not.toContain(target.id)
        expect(prompt).not.toContain(sourceHash)
        expect(prompt).toContain('Do not rewrite lore content')
        expect(prompt).toContain('The router can filter these facet keys when evidence exists')
        expect(prompt).toContain('사람이 읽고 검색하는 모든 메타데이터를 한국어로 작성하세요')
        expect(prompt).toContain('appearance')
        expect(bardLoreAnalysisSchema).toContain('"targetRef"')
        expect(bardLoreAnalysisSchema).not.toContain('"sourceHash"')

        const parsed = parseBardLoreAnalysisResponse(JSON.stringify({
            entries: [{
                ref: 0,
                kind: 'location',
                activation: 'retrieve',
                aliases: ['', ' 탑 ', '탑'],
                tags: ['', ' 던전 ', '던전'],
                summary: '위험한 탑',
                facets: [{ key: ' type ', value: ' dungeon ', aliases: ['', ' 던전 ', '던전'] }],
                injection: 'index-only',
                links: [{ targetRef: 1, relation: 'overlooks', retrieval: 'discoverable' }],
            }],
        }), [source], [source, target], new Map([[source.id, sourceHash]]))

        expect(parsed.entries[0]).toMatchObject({
            id: source.id,
            sourceHash,
            kind: 'location',
            aliases: ['탑'],
            tags: ['던전'],
            facets: [{ key: 'type', value: 'dungeon', aliases: ['던전'] }],
            injection: 'index-only',
            links: [{ targetId: target.id, relation: 'overlooks', retrieval: 'discoverable' }],
        })
        expect(bardLoreAnalysisSchema).toContain('"discoverable"')
        expect(bardLoreAnalysisSchema).toContain('"facets"')
        expect(() => parseBardLoreAnalysisResponse(JSON.stringify({
            entries: [{
                ref: 0,
                kind: 'unknown',
                aliases: [],
                tags: [],
                summary: '',
                links: [],
            }],
        }), [source], [source, target])).toThrow('bard-lore-analysis-invalid:entry-shape')
    })

    it('puts configured character quality facets into the model contract', () => {
        const character = entry('character')
        const prompt = buildBardLoreAnalysisPrompt([character], [character], ['work', 'era'])

        expect(prompt).toContain('work, era')
        expect(prompt).not.toContain('work and gender facets')
        expect(prompt).toContain('Do not invent or require a facet merely because its key is filterable')
        expect(prompt).toContain('Do not use supporting as the default relationship mode')
        expect(prompt).toContain('timeline')
    })

    it('applies the selected metadata language to prompts and token planning', async () => {
        const character = entry('character')
        const koreanPrompt = buildBardLoreAnalysisPrompt(
            [character],
            [character],
            ['work'],
            'ko',
            'en',
        )
        const bilingualPrompt = buildBardLoreAnalysisPrompt(
            [character],
            [character],
            ['work'],
            'bilingual',
            'ko',
        )
        const measured: string[] = []

        await planBardLoreAnalysisBatches(
            [character],
            [character],
            createBardLoreSettings(),
            async (value) => {
                measured.push(value)
                return 1
            },
            'ko',
            'en',
        )

        expect(koreanPrompt).toContain('사람이 읽고 검색하는 모든 메타데이터를 한국어로 작성하세요')
        expect(koreanPrompt).not.toContain('Write all human-readable retrieval metadata in English')
        expect(bilingualPrompt).toContain('both English and Korean')
        expect(measured.some((value) => value.includes('사람이 읽고 검색하는 모든 메타데이터를 한국어로 작성하세요'))).toBe(true)
    })

    it('shows a dynamic facet-key slot in the readable common instruction', () => {
        expect(buildBardLoreAnalysisInstructions(undefined, 'ko', 'ko'))
            .toContain('[Character-specific filter facet keys are inserted here at request time.]')
    })

    it('reports the exact validation stage without retaining response content', () => {
        const source = entry('a')

        expect(() => parseBardLoreAnalysisResponse('{broken', [source], [source]))
            .toThrow('bard-lore-analysis-invalid:invalid-json')
        expect(() => parseBardLoreAnalysisResponse('{"entries":[]}', [source], [source]))
            .toThrow('bard-lore-analysis-invalid:missing-targets')
        expect(() => parseBardLoreAnalysisResponse(JSON.stringify({
            entries: [{
                ref: 0,
                kind: 'location',
                aliases: [],
                tags: [],
                summary: '',
                links: [],
            }],
        }), [source], [source])).toThrow('bard-lore-analysis-invalid:entry-shape')
        expect(parseBardLoreAnalysisResponse(JSON.stringify({
            entries: [{
                ref: 0,
                kind: 'location',
                activation: 'retrieve',
                aliases: [],
                tags: [],
                summary: '',
                links: [{ targetRef: 0, relation: 'self', retrieval: 'supporting' }],
            }],
        }), [source], [source]).entries[0].links).toEqual([])

        expect(parseBardLoreAnalysisResponse(JSON.stringify({
            entries: [{
                ref: 0,
                kind: 'location',
                activation: 'retrieve',
                aliases: [],
                tags: [],
                summary: '',
                links: [{ targetRef: 99, relation: 'unknown', retrieval: 'supporting' }],
            }],
        }), [source], [source]).entries[0].links).toEqual([])
    })

    it('does not require optional filter facets from every character', () => {
        const character = entry('character')
        character.bard.kind = 'character'
        const settings = createBardLoreSettings()
        const sourceHash = fingerprintBardLoreEntry(character)
        const incomplete = {
            entries: [{
                id: character.id,
                sourceHash,
                kind: 'character' as const,
                aliases: ['Character'],
                tags: ['cast'],
                summary: 'A main character.',
                facets: [],
                injection: 'full' as const,
                links: [],
                atoms: [],
            }],
        }

        expect(auditBardLoreAnalysisDraft(incomplete, [character], settings).issues).toEqual([])
    })

    it('classifies mandatory output contracts as required and applies the approved activation', () => {
        const status = entry('status-output-rule')
        status.comment = '상태창 출력 규칙'
        status.content = '모든 응답 끝에 상태창을 출력한다.'
        const prompt = buildBardLoreAnalysisPrompt([status], [status])

        expect(JSON.parse(bardLoreAnalysisSchema).properties.entries.items.required).toContain('activation')
        expect(prompt).toContain('status display')
        expect(prompt).toContain('"activation":"retrieve"')

        const parsed = parseBardLoreAnalysisResponse(JSON.stringify({
            entries: [{
                ref: 0,
                kind: 'system',
                activation: 'required',
                aliases: ['상태창'],
                tags: ['출력 규칙'],
                summary: '모든 응답에 적용되는 상태창 출력 규칙.',
                facets: [],
                injection: 'full',
                atoms: [],
                links: [],
            }],
        }), [status], [status])
        const applied = applyBardLoreAnalysisDraft([status], parsed, { overwriteExisting: false })

        expect(parsed.entries[0].activation).toBe('required')
        expect(applied.entries[0].bard.activation).toBe('required')
    })

    it('treats long timelines as routing indexes that need atomic event drafts', () => {
        const timeline = entry('timeline')
        timeline.comment = '전체 타임라인'
        timeline.content = '2009년: 첫 사건이 일어났다.\n2010년: 다음 사건이 일어났다.\n'.repeat(30)
        const sourceHash = fingerprintBardLoreEntry(timeline)
        const draft = {
            entries: [{
                id: timeline.id,
                sourceHash,
                kind: 'event' as const,
                aliases: ['연표'],
                tags: ['타임라인'],
                summary: '사건 연표.',
                facets: [],
                injection: 'full' as const,
                links: [],
                atoms: [],
            }],
        }

        expect(auditBardLoreAnalysisDraft(draft, [timeline], createBardLoreSettings()).issues.map((issue) => issue.code))
            .toEqual(['composite-not-index-only', 'composite-without-atoms'])
    })

    it('does not recursively atomize an atomic event merely tagged as a timeline', () => {
        const event = entry('event')
        event.comment = 'event · 9월 스트레가'
        event.content = '<Timeline_Window id="p3_strega">9월의 단일 사건.</Timeline_Window>'.repeat(20)
        event.bard.kind = 'event'
        const sourceHash = fingerprintBardLoreEntry(event)
        const draft = {
            entries: [{
                id: event.id,
                sourceHash,
                kind: 'event' as const,
                aliases: [],
                tags: ['타임라인', '9월'],
                summary: '9월 사건 타임라인.',
                facets: [],
                injection: 'full' as const,
                links: [],
                atoms: [],
            }],
        }

        expect(auditBardLoreAnalysisDraft(draft, [event], createBardLoreSettings()).issues).toEqual([])
    })

    it('flags one entry whose supporting links alone exceed the configured result budget', () => {
        const hub = entry('hub')
        hub.bard.kind = 'character'
        hub.bard.tags = ['인물']
        hub.bard.summary = '연결 허브.'
        hub.bard.links = ['a', 'b', 'c'].map((targetId) => ({
            targetId,
            relation: 'related',
            retrieval: 'supporting' as const,
        }))
        const settings = createBardLoreSettings({ maxEntries: 2 })

        expect(auditBardLoreMetadata([hub], settings).issues)
            .toContainEqual(expect.objectContaining({
                entryId: 'hub',
                code: 'supporting-links-exceed-budget',
                detail: '3/2',
            }))
    })

    it('requires composite rosters to stay out of runtime context and produce atoms', () => {
        const roster = entry('roster')
        roster.comment = '주요 인물 경량 명부'
        roster.content = '슈지: 학교 이사장.\n준페이: 남학생이자 S.E.E.S. 대원.'.repeat(20)
        const sourceHash = fingerprintBardLoreEntry(roster)
        const draft = {
            entries: [{
                id: roster.id,
                sourceHash,
                kind: 'system' as const,
                aliases: ['Main Character Roster'],
                tags: ['명부'],
                summary: '주요 인물 목록.',
                facets: [],
                injection: 'full' as const,
                links: [],
                atoms: [],
            }],
        }

        expect(auditBardLoreAnalysisDraft(draft, [roster], createBardLoreSettings()).issues.map((issue) => issue.code))
            .toEqual(['composite-not-index-only', 'composite-without-atoms'])
        expect(auditBardLoreMetadata([roster], createBardLoreSettings()).issues.map((issue) => issue.code))
            .toContain('composite-not-index-only')
    })

    it('accepts one complete schema object wrapped in plugin reasoning text', () => {
        const source = entry('a')
        const response = [
            '<reasoning>Preparing the structured result.</reasoning>',
            JSON.stringify({
                entries: [{
                    ref: 0,
                    kind: 'location',
                    activation: 'retrieve',
                    aliases: ['탑'],
                    tags: ['던전'],
                    summary: '위험한 탑',
                    links: [],
                }],
            }),
            'Analysis complete.',
        ].join('\n')

        expect(parseBardLoreAnalysisResponse(response, [source], [source]).entries[0])
            .toMatchObject({ id: 'a', kind: 'location', summary: '위험한 탑' })
    })

    it('previews safely, merges into empty metadata, and rejects stale fingerprints', () => {
        const source = entry('a')
        source.bard.aliases = ['기존']
        const sourceHash = fingerprintBardLoreEntry(source)
        const draft = {
            entries: [{
                id: 'a',
                sourceHash,
                kind: 'location' as const,
                aliases: ['새 별칭'],
                tags: ['장소'],
                summary: '요약',
                facets: [{ key: 'region', value: 'city', aliases: ['시내'] }],
                injection: 'index-only' as const,
                links: [],
            }],
        }

        const applied = applyBardLoreAnalysisDraft([source], draft, { overwriteExisting: false })
        expect(applied.appliedIds).toEqual(['a'])
        expect(applied.entries[0].bard).toMatchObject({
            kind: 'location',
            aliases: ['기존', '새 별칭'],
            tags: ['장소'],
            summary: '요약',
            facets: [{ key: 'region', value: 'city', aliases: ['시내'] }],
            injection: 'index-only',
        })

        const changed = [{ ...source, content: 'changed after request' }]
        const stale = applyBardLoreAnalysisDraft(changed, draft, { overwriteExisting: true })
        expect(stale.appliedIds).toEqual([])
        expect(stale.conflicts).toEqual([{ id: 'a', reason: 'source-changed' }])

        const metadataChanged = [{
            ...source,
            bard: { ...source.bard, tags: ['manual edit after request'] },
        }]
        const staleMetadata = applyBardLoreAnalysisDraft(metadataChanged, draft, { overwriteExisting: true })
        expect(staleMetadata.appliedIds).toEqual([])
        expect(staleMetadata.conflicts).toEqual([{ id: 'a', reason: 'source-changed' }])
    })

    it('can replace only links during a quality repair without overwriting other manual metadata', () => {
        const source = entry('a')
        source.bard.kind = 'character'
        source.bard.summary = '수동 요약'
        source.bard.tags = ['수동 태그']
        source.bard.links = [
            { targetId: 'old', relation: 'related', retrieval: 'supporting' },
        ]
        const draft = {
            entries: [{
                id: source.id,
                sourceHash: fingerprintBardLoreEntry(source),
                kind: 'location' as const,
                aliases: [],
                tags: ['AI 태그'],
                summary: 'AI 요약',
                facets: [],
                injection: 'full' as const,
                links: [{ targetId: 'new', relation: 'located_in', retrieval: 'discoverable' as const }],
                atoms: [],
            }],
        }

        const applied = applyBardLoreAnalysisDraft([source], draft, {
            overwriteExisting: false,
            replaceLinks: true,
        })

        expect(applied.entries[0].bard).toMatchObject({
            kind: 'character',
            summary: '수동 요약',
            tags: ['수동 태그', 'AI 태그'],
            links: [{ targetId: 'new', relation: 'located_in', retrieval: 'discoverable' }],
        })
    })

    it('creates approved atomic Bard entries from exact source quotes without changing the source input', () => {
        const roster = entry('roster')
        roster.comment = '주요 인물 경량 명부'
        roster.content = '슈지: 학교 이사장.\n준페이: 남학생이자 S.E.E.S. 대원.'
        const before = structuredClone(roster)
        const sourceHash = fingerprintBardLoreEntry(roster)
        const parsed = parseBardLoreAnalysisResponse(JSON.stringify({
            entries: [{
                ref: 0,
                kind: 'other',
                activation: 'retrieve',
                aliases: [],
                tags: ['명부'],
                summary: '인물 목록',
                facets: [],
                injection: 'index-only',
                links: [],
                atoms: [{
                    name: '이쿠츠키 슈지',
                    sourceQuote: '슈지: 학교 이사장.',
                    existingTargetRef: -1,
                    kind: 'character',
                    aliases: ['슈지', '이쿠츠키'],
                    tags: ['인물'],
                    summary: '학교 이사장',
                    facets: [{ key: 'role', value: 'chairman', aliases: ['이사장'] }],
                    links: [],
                }],
            }],
        }), [roster], [roster], new Map([[roster.id, sourceHash]]))

        expect(parsed.entries[0].atoms).toMatchObject([{
            name: '이쿠츠키 슈지',
            content: '슈지: 학교 이사장.',
            facets: [{ key: 'role', value: 'chairman', aliases: ['이사장'] }],
        }])

        const applied = applyBardLoreAnalysisDraft([roster], parsed, {
            overwriteExisting: false,
        })

        expect(roster).toEqual(before)
        expect(applied.entries).toHaveLength(2)
        expect(applied.entries[0].bard.injection).toBe('index-only')
        expect(applied.entries[1].id).toMatch(/^bard-atom-[0-9a-f]{8}$/u)
        expect(applied.entries[1]).toMatchObject({
            comment: '이쿠츠키 슈지',
            content: '슈지: 학교 이사장.',
            bard: {
                derivedFromId: 'roster',
                kind: 'character',
                aliases: ['슈지', '이쿠츠키'],
                injection: 'full',
            },
        })

        const rerun = structuredClone(parsed)
        rerun.entries[0].sourceHash = fingerprintBardLoreEntry(applied.entries[0])
        const reapplied = applyBardLoreAnalysisDraft(applied.entries, rerun, {
            overwriteExisting: false,
            createId: () => { throw new Error('must reuse the derived atom') },
        })
        expect(reapplied.entries).toHaveLength(2)
    })

    it('reuses an explicitly targeted atomic entry instead of creating a duplicate', () => {
        const roster = entry('roster')
        roster.comment = '주요 인물 명부'
        roster.content = '슈지: 학교 이사장.'
        const shuji = entry('shuji')
        shuji.comment = '이쿠츠키 슈지'
        shuji.content = '기존 상세 로어'
        const sourceHash = fingerprintBardLoreEntry(roster)
        const targetHash = fingerprintBardLoreEntry(shuji)
        const parsed = parseBardLoreAnalysisResponse(JSON.stringify({
            entries: [{
                ref: 0,
                kind: 'other',
                activation: 'retrieve',
                aliases: [],
                tags: ['명부'],
                summary: '인물 목록',
                facets: [],
                injection: 'index-only',
                links: [],
                atoms: [{
                    name: '이쿠츠키 슈지',
                    sourceQuote: '슈지: 학교 이사장.',
                    existingTargetRef: 1,
                    kind: 'character',
                    aliases: ['슈지', '이쿠츠키'],
                    tags: ['인물'],
                    summary: '학교 이사장',
                    facets: [{ key: 'role', value: 'chairman', aliases: ['이사장'] }],
                    links: [],
                }],
            }],
        }), [roster], [roster, shuji], new Map([[roster.id, sourceHash]]))

        expect(parsed.entries[0].atoms?.[0]).toMatchObject({
            existingTargetId: 'shuji',
            existingTargetHash: targetHash,
        })

        const applied = applyBardLoreAnalysisDraft([roster, shuji], parsed, {
            overwriteExisting: false,
            createId: () => { throw new Error('must not create') },
        })

        expect(applied.entries).toHaveLength(2)
        expect(applied.entries[1].content).toBe('기존 상세 로어')
        expect(applied.entries[1].bard).toMatchObject({
            kind: 'character',
            aliases: ['슈지', '이쿠츠키'],
            facets: [{ key: 'role', value: 'chairman', aliases: ['이사장'] }],
        })

        const missingTarget = applyBardLoreAnalysisDraft([roster], parsed, { overwriteExisting: false })
        expect(missingTarget.entries[0].bard.injection).toBe('full')
        expect(missingTarget.conflicts).toEqual([{ id: 'roster', reason: 'missing-entry' }])
    })
})
