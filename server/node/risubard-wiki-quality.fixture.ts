// Synthetic long chat with a ground-truth ledger, and a scripted analysis
// model that answers from the ledger. The real runner, wiki, inquiry and
// recall run on top, so the measured loss belongs to the program, not to a
// model's writing. Nothing here comes from a user's chat.

export const qualityNames = ['아리아', '세레스', '카일', '노아', '리엔', '바르트'] as const
const places = ['북문', '항구 창고', '왕립 도서관', '시계탑', '수도원', '고아원']
const origins = ['북부 항구 마을', '은빛 숲', '붉은 사막', '안개 섬', '동쪽 광산촌', '수도 하층가']
const activities = ['순찰', '조사', '회의', '훈련', '휴식', '추적']
const menus = ['토스트', '보리죽', '감자 수프', '꿀빵', '생선구이', '과일 파이', '오믈렛']
const relationStates = ['경계', '협력', '신뢰', '갈등', '화해']
export const qualityPairs = [['아리아', '카일'], ['세레스', '노아'], ['리엔', '바르트']] as const

export interface QualityTurn {
    turn: number
    title: string
    user: string
    sentences: string[]
    /** Character documents this turn should create or update. */
    touched: string[]
    relationChanges: Array<{ a: string; b: string; state: string }>
    origin?: { name: string; origin: string }
    secret?: { name: string; secret: string }
    keyOwner?: string
    rumor?: 'start' | 'refuted'
    place: string
    /** Every scene leaves its lead a clue to remember, so knowledge keeps growing. */
    clue: { name: string; text: string }
}

export interface QualityLedger {
    turns: QualityTurn[]
    relation(turn: number, a: string, b: string): string | undefined
    keyOwner(turn: number): string | undefined
    secretsOf(turn: number, name: string): string[]
    cluesOf(turn: number, name: string): string[]
}

const RELATION_PERIOD = 37
const KEY_PERIOD = 53
const SECRET_PERIOD = 61
export const RUMOR_START = 45
export const RUMOR_REFUTED = 140

export function buildQualityLedger(total: number): QualityLedger {
    const turns: QualityTurn[] = []
    for (let turn = 1; turn <= total; turn += 1) {
        const a = qualityNames[turn % qualityNames.length]
        const b = qualityNames[(turn * 5 + 1) % qualityNames.length]
        const place = places[turn % places.length]
        const breakfast = turn % 10 === 0
        const title = breakfast ? '아침 식사' : `${place}의 ${activities[turn % activities.length]}`
        const sentences = breakfast
            ? [`${a}와 ${b}가 아침으로 ${menus[(turn / 10) % menus.length]}를 먹었다. 식탁에는 단서 ${turn}가 적힌 쪽지가 있었다.`]
            : [`${a}와 ${b}가 ${place}에서 ${activities[turn % activities.length]}을 하며 단서 ${turn}를 찾았다.`]
        const entry: QualityTurn = { turn, title, user: `${turn}턴: ${a}에게 다음 일을 묻는다.`, sentences,
            touched: [a], relationChanges: [], place, clue: { name: a, text: `${place}에서 단서 ${turn}를 확인했다.` } }
        if (turn <= qualityNames.length) {
            const name = qualityNames[turn - 1]
            entry.origin = { name, origin: origins[turn - 1] }
            sentences.push(`${name}는 자신이 ${origins[turn - 1]} 출신이라고 말했다.`)
            entry.touched.push(name)
        }
        qualityPairs.forEach(([left, right], index) => {
            const offset = 7 + index * 11
            if (turn >= offset && (turn - offset) % RELATION_PERIOD === 0) {
                const state = relationStates[((turn - offset) / RELATION_PERIOD + index) % relationStates.length]
                entry.relationChanges.push({ a: left, b: right, state })
                sentences.push(`${left}와 ${right}의 관계가 '${state}'(으)로 바뀌었다.`)
                entry.touched.push(left, right)
            }
        })
        if (turn % KEY_PERIOD === 3) {
            entry.keyOwner = qualityNames[(turn / KEY_PERIOD | 0) % qualityNames.length]
            sentences.push(`청동 열쇠는 이제 ${entry.keyOwner}가 가지고 있다.`)
        }
        if (turn % SECRET_PERIOD === 20) {
            const name = qualityNames[(turn / SECRET_PERIOD | 0) % qualityNames.length]
            const secret = `${places[(turn / SECRET_PERIOD | 0) % places.length]} 지하 ${turn}번 방에 지도가 있다`
            entry.secret = { name, secret }
            sentences.push(`${name}는 '${secret}'라는 비밀을 알게 되었다.`)
            entry.touched.push(name)
        }
        if (turn === RUMOR_START) {
            entry.rumor = 'start'
            sentences.push('세레스는 카일이 배신자라는 소문을 들었다.')
            entry.touched.push('세레스')
        }
        if (turn === RUMOR_REFUTED) {
            entry.rumor = 'refuted'
            sentences.push('카일이 배신자라는 소문은 거짓으로 밝혀졌다.')
            entry.touched.push('세레스')
        }
        entry.touched = [...new Set(entry.touched)]
        turns.push(entry)
    }
    return {
        turns,
        relation(turn, a, b) {
            let state: string | undefined
            for (const entry of turns.slice(0, turn)) {
                for (const change of entry.relationChanges) if (change.a === a && change.b === b) state = change.state
            }
            return state
        },
        keyOwner(turn) {
            let owner: string | undefined
            for (const entry of turns.slice(0, turn)) if (entry.keyOwner) owner = entry.keyOwner
            return owner
        },
        cluesOf(turn, name) {
            return turns.slice(0, turn).flatMap((entry) => entry.clue.name === name ? [entry.clue.text] : [])
        },
        secretsOf(turn, name) {
            return turns.slice(0, turn).flatMap((entry) => entry.secret?.name === name ? [entry.secret.secret] : [])
        },
    }
}

const CURRENT = '현재 상태'
const IDENTITY = '인물 핵심'
const RELATIONS = '관계와 신뢰'
const KNOWLEDGE = '지식과 비밀'

type Section = { heading: string; operation: 'upsert' | 'edit'; content: string;
    add: string[]; replace: Array<{ index: number; text: string }>;
    remove: Array<{ index: number; reason: 'superseded' | 'merged' | 'corrected' | 'covered'; mergedInto: number | null }> }

function readUnits(markdown: string, heading: string): string[] {
    const lines = markdown.split('\n')
    const start = lines.findIndex((line) => line.trim() === `### ${heading}`)
    if (start < 0) return []
    const units: string[] = []
    for (const line of lines.slice(start + 1)) {
        if (/^#{1,3}\s/u.test(line)) break
        const match = /^-\s+(?:\[\d+\]\s+)?(.*)$/u.exec(line)
        if (match) units.push(match[1].replace(/\s*\(#\d+\)\s*$/u, ''))
    }
    return units
}

const upsert = (heading: string, units: string[]): Section =>
    ({ heading, operation: 'upsert', content: units.map((unit) => `- ${unit}`).join('\n'), add: [], replace: [], remove: [] })

export interface OracleOptions {
    ledger: QualityLedger
    /** Fraction of existing character updates sent as a lossy whole-section rewrite. */
    lossyRewriteRate: number
    /** Fraction of analysis calls that fail like a provider error. */
    failureRate: number
    random: () => number
}

export function createOracleModel(options: OracleOptions) {
    const stats = { calls: 0, failures: 0, lossyRewrites: 0, inputCharacters: 0, droppedByModel: [] as string[] }
    const turnOf = (input: { confirmedMessages?: Array<{ messageId: string }> }) => {
        const id = input.confirmedMessages?.findLast((message) => message.messageId.startsWith('a'))?.messageId
        return id ? Number(id.slice(1)) : 0
    }
    const characterSections = (turn: number, name: string, markdown: string | undefined): Section[] => {
        const entry = options.ledger.turns[turn - 1]
        const sections: Section[] = [upsert(CURRENT, [`${entry.place} 근처에 있다.`])]
        const origin = options.ledger.turns.find((item) => item.origin?.name === name && item.turn <= turn)?.origin
        const relations = qualityPairs.filter(([a, b]) => a === name || b === name).flatMap(([a, b]) => {
            const state = options.ledger.relation(turn, a, b)
            const other = a === name ? b : a
            return state ? [{ other, text: `${other}와의 관계: ${state}` }] : []
        })
        const secrets = options.ledger.secretsOf(turn, name)
        const rumorUnit = '카일이 배신자라는 소문을 들었다'
        const refutedUnit = '카일이 배신자라는 소문은 거짓이다'
        if (!markdown) {
            if (origin) sections.push(upsert(IDENTITY, [`${origin.origin} 출신이다.`]))
            if (relations.length > 0) sections.push(upsert(RELATIONS, relations.map((relation) => relation.text)))
            const knowledge = [...options.ledger.cluesOf(turn, name), ...secrets.map((secret) => `'${secret}'를 알고 있다.`)]
            if (name === '세레스' && turn >= 45) knowledge.push(turn >= 140 ? refutedUnit : rumorUnit)
            if (knowledge.length > 0) sections.push(upsert(KNOWLEDGE, knowledge))
            return sections
        }
        const edit = (heading: string): Section => ({ heading, operation: 'edit', content: '', add: [], replace: [], remove: [] })
        if (entry.origin?.name === name) {
            const section = edit(IDENTITY)
            section.add.push(`${entry.origin.origin} 출신이다.`)
            sections.push(section)
        }
        const changed = entry.relationChanges.filter((change) => change.a === name || change.b === name)
        if (changed.length > 0) {
            const units = readUnits(markdown, RELATIONS)
            const section = edit(RELATIONS)
            for (const change of changed) {
                const other = change.a === name ? change.b : change.a
                const index = units.findIndex((unit) => unit.startsWith(`${other}와의 관계`))
                const text = `${other}와의 관계: ${change.state}`
                if (index >= 0) section.replace.push({ index, text })
                else section.add.push(text)
            }
            sections.push(section)
        }
        const knowledgeUnits = readUnits(markdown, KNOWLEDGE)
        const knowledge = edit(KNOWLEDGE)
        if (entry.clue.name === name) knowledge.add.push(entry.clue.text)
        if (entry.secret?.name === name) knowledge.add.push(`'${entry.secret.secret}'를 알고 있다.`)
        if (name === '세레스' && entry.rumor === 'start') knowledge.add.push(rumorUnit)
        if (name === '세레스' && entry.rumor === 'refuted') {
            const index = knowledgeUnits.findIndex((unit) => unit.startsWith(rumorUnit))
            if (index >= 0) knowledge.remove.push({ index, reason: 'corrected', mergedInto: null })
            knowledge.add.push(refutedUnit)
        }
        if (knowledge.add.length + knowledge.remove.length > 0) {
            if (knowledgeUnits.length > 1 && options.random() < options.lossyRewriteRate) {
                // A careless model rewrites the whole section and forgets its oldest unit.
                stats.lossyRewrites += 1
                stats.droppedByModel.push(`${name}\u0000${knowledgeUnits[0]}`)
                const removed = new Set(knowledge.remove.map((item) => item.index))
                sections.push(upsert(KNOWLEDGE, [...knowledgeUnits.filter((_unit, index) => index > 0 && !removed.has(index)), ...knowledge.add]))
            }
            else sections.push(knowledge)
        }
        return sections
    }
    const arcSections = (input: { target: { markdown: string }; storyArcEvents: Array<{ title: string }> }): Section[] => {
        const overview = readUnits(input.target.markdown, '아크 개요')
        const titles = input.storyArcEvents.map((event) => event.title)
        let arcs = [...overview, `[[${titles[0]}]]부터 [[${titles.at(-1)}]]까지 이어진 여정`]
        while (arcs.length > 8) arcs = [`${arcs[0]} / ${arcs[1]}`, ...arcs.slice(2)]
        const turning = [...readUnits(input.target.markdown, '주요 전환점'), `[[${titles.at(-1)}]]`].slice(-16)
        const threads = readUnits(input.target.markdown, '미해결 줄기')
        return [upsert('아크 개요', arcs), upsert('주요 전환점', turning),
            ...(threads.length > 0 ? [upsert('미해결 줄기', threads)] : [upsert('미해결 줄기', ['청동 열쇠의 쓰임새'])])]
    }
    async function analyze(request: { format?: string; system: string; input: string }) {
        stats.calls += 1
        stats.inputCharacters += request.input.length
        const input = JSON.parse(request.input)
        if (request.system.startsWith('Canonical maintenance')) {
            return JSON.stringify({
                sections: input.sections.map((section: { role: string; units: Array<{ text: string }> }) =>
                    ({ role: section.role, units: section.units.map((unit) => unit.text) })),
                dispositions: input.sections.flatMap((section: { role: string; units: Array<{ index: number }> }) =>
                    section.units.map((unit) => ({ role: section.role, old: unit.index, action: 'kept', newIndex: unit.index,
                        moveTo: null, movedText: null, documentId: null }))),
            })
        }
        if (request.format === 'memory-draft') {
            if (options.random() < options.failureRate) {
                stats.failures += 1
                throw new Error('Memory analysis model request failed: 429')
            }
            const entry = options.ledger.turns[turnOf(input) - 1]
            return JSON.stringify({
                title: entry.title,
                establishedEvents: entry.sentences,
                stateChanges: entry.relationChanges.map((change) => ({ subject: `${change.a}와 ${change.b}`, before: null, after: change.state })),
                characterKnowledge: [], persistentFacts: [], openContinuity: [],
                keywords: [entry.place],
                canonicalUpdateCandidates: [
                    ...entry.touched.map((name) => ({ type: 'character', title: name, aliases: [], reason: '이번 턴의 지속 변화',
                        action: 'create', targetDocumentId: null, confidence: 1 })),
                    ...(entry.keyOwner ? [{ type: 'item', title: '청동 열쇠', aliases: [], reason: '소유자 변경',
                        action: 'create', targetDocumentId: null, confidence: 1 }] : []),
                ],
                canonicalPatches: [],
            })
        }
        const turn = turnOf(input)
        return JSON.stringify({ documents: input.targets.map((target: {
            candidateIndex: number; target: { id: string | null; type: string; title: string; markdown: string }
            storyArcEvents?: Array<{ title: string }>
        }) => {
            const existing = target.target.id ? target.target.markdown : undefined
            const sections = target.storyArcEvents
                ? arcSections({ target: target.target, storyArcEvents: target.storyArcEvents })
                : target.target.type === 'item'
                    ? [upsert(CURRENT, [`${options.ledger.keyOwner(turn)}가 가지고 있다.`])]
                    : characterSections(turn, target.target.title, existing)
            return { candidateIndex: target.candidateIndex, sections }
        }) })
    }
    return { analyze, stats }
}

export function seededRandom(seed: number) {
    let state = seed >>> 0
    return () => {
        state = (state * 1664525 + 1013904223) >>> 0
        return state / 2 ** 32
    }
}
