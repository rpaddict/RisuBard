export type StoryTimeUnit = 'day' | 'month' | 'year'

export interface MemoryStoryTime {
    /** Day on the present timeline counted from the first event (day 0); a lower bound when precision is after. */
    day: number | null
    evidence: string
    precision: 'origin' | 'explicit' | 'after' | 'flashback' | 'unknown'
    /** Where a flashback sits relative to day 0; amount is null when the text gives no distance. */
    offset?: { amount: number | null; unit: StoryTimeUnit }
    /** The in-story date or time as the text writes it, such as a status line. */
    calendar?: string
}

export interface MemoryRetrievalMetadata {
    keywords: string[]
    storyTime?: MemoryStoryTime
}

export interface SemanticTemporalHint {
    elapsedDays: number | null
    evidence: string
    /** A flashback narrates time before the present scene and never moves the present day. */
    timeline?: 'present' | 'flashback'
    /** How long before the present scene a flashback happens. */
    flashbackAmount?: number | null
    flashbackUnit?: StoryTimeUnit
    calendar?: string
}

export interface MemoryTimelineEntry {
    day: number | null
    precision: MemoryStoryTime['precision']
}

const MAX_KEYWORDS = 24
const MAX_KEYWORD_LENGTH = 80
const MAX_CALENDAR_LENGTH = 120
export const STORY_TIME_UNITS: readonly StoryTimeUnit[] = ['day', 'month', 'year']
const DAYS_PER_UNIT: Record<StoryTimeUnit, number> = { day: 1, month: 30, year: 365 }

function requiredString(value: unknown, label: string): string {
    if (typeof value !== 'string' || value.trim().length === 0) {
        throw new Error(`${label} must be a non-empty string`)
    }
    return value.trim()
}

export function normalizeMemoryRetrievalKeywords(value: unknown): string[] {
    if (!Array.isArray(value)) {
        throw new Error('Memory retrieval keywords must be an array')
    }
    const seen = new Set<string>()
    const keywords: string[] = []
    for (const valueItem of value) {
        const keyword = requiredString(valueItem, 'Memory retrieval keyword')
        if (keyword.length > MAX_KEYWORD_LENGTH) {
            throw new Error(`Memory retrieval keyword must contain 1-${MAX_KEYWORD_LENGTH} characters`)
        }
        const key = keyword.normalize('NFKC').toLocaleLowerCase()
        if (!seen.has(key) && keywords.length < MAX_KEYWORDS) {
            seen.add(key)
            keywords.push(keyword)
        }
    }
    return keywords
}

function normalizeStoryTime(value: unknown): MemoryStoryTime {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new Error('Memory story time must be an object')
    }
    const record = value as Record<string, unknown>
    const allowed = new Set(['day', 'evidence', 'precision', 'offset', 'calendar'])
    if (!['day', 'evidence', 'precision'].every((key) => Object.hasOwn(record, key))
        || Object.keys(record).some((key) => !allowed.has(key))) {
        throw new Error('Memory story time has invalid fields')
    }
    const day = record.day
    if (day !== null && (typeof day !== 'number' || !Number.isSafeInteger(day) || day < 0)) {
        throw new Error('Memory story time day must be a non-negative integer or null')
    }
    const evidence = requiredString(record.evidence, 'Memory story time evidence')
    if (evidence.length > 240) {
        throw new Error('Memory story time evidence must contain 1-240 characters')
    }
    const precision = record.precision
    if (precision !== 'origin' && precision !== 'explicit' && precision !== 'after'
        && precision !== 'flashback' && precision !== 'unknown') {
        throw new Error('Memory story time precision is invalid')
    }
    if (precision === 'origin' && day !== 0) {
        throw new Error('Memory story time origin must be day zero')
    }
    if ((precision === 'unknown' || precision === 'flashback') && day !== null) {
        throw new Error('Unknown or flashback memory story time must not retain a day')
    }
    if ((precision === 'explicit' || precision === 'after') && day === null) {
        throw new Error('Explicit memory story time requires a day')
    }
    let offset: MemoryStoryTime['offset']
    if (record.offset !== undefined) {
        const raw = record.offset as Record<string, unknown> | null
        if (precision !== 'flashback' || typeof raw !== 'object' || raw === null
            || Object.keys(raw).length !== 2
            || (raw.amount !== null && (typeof raw.amount !== 'number' || !Number.isSafeInteger(raw.amount)))
            || !STORY_TIME_UNITS.includes(raw.unit as StoryTimeUnit)) {
            throw new Error('Memory story time offset is invalid')
        }
        offset = { amount: raw.amount as number | null, unit: raw.unit as StoryTimeUnit }
    }
    if (precision === 'flashback' && !offset) {
        throw new Error('Flashback memory story time requires an offset')
    }
    const calendar = record.calendar === undefined ? undefined
        : requiredString(record.calendar, 'Memory story time calendar')
    if (calendar !== undefined && calendar.length > MAX_CALENDAR_LENGTH) {
        throw new Error(`Memory story time calendar must contain 1-${MAX_CALENDAR_LENGTH} characters`)
    }
    return {
        day: day as number | null,
        evidence,
        precision,
        ...(offset ? { offset } : {}),
        ...(calendar ? { calendar } : {}),
    }
}

export function normalizeMemoryRetrievalMetadata(
    value: unknown
): MemoryRetrievalMetadata | undefined {
    if (value === undefined) return undefined
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new Error('Memory retrieval metadata must be an object')
    }
    const record = value as Record<string, unknown>
    const allowed = new Set(['keywords', 'storyTime'])
    if (!Object.hasOwn(record, 'keywords')
        || Object.keys(record).some((key) => !allowed.has(key))) {
        throw new Error('Memory retrieval metadata has invalid fields')
    }
    return {
        keywords: normalizeMemoryRetrievalKeywords(record.keywords),
        ...(record.storyTime === undefined
            ? {}
            : { storyTime: normalizeStoryTime(record.storyTime) }),
    }
}

const squash = (value: string) => value.replace(/\s+/gu, ' ').trim()

/**
 * Keeps only what the source text supports: the elapsed time needs its quoted evidence, and a
 * date is kept only when every word of it appears there, so it is copied, never guessed.
 */
export function groundTemporalHint(
    hint: SemanticTemporalHint | undefined,
    sourceText: string,
): SemanticTemporalHint | undefined {
    if (!hint) return undefined
    const source = squash(sourceText)
    const evidence = squash(hint.evidence ?? '')
    const calendar = typeof hint.calendar === 'string' && squash(hint.calendar)
        && squash(hint.calendar).split(' ').every((word) => source.includes(word)) ? hint.calendar : ''
    return evidence && source.includes(evidence)
        ? { ...hint, calendar }
        : { elapsedDays: null, evidence: '', calendar }
}

// The latest present-timeline day. Flashbacks never move it, and an event of unknown
// time after it turns every later day into a lower bound instead of breaking the count.
function presentAnchor(
    priorTimeline: readonly MemoryTimelineEntry[]
): { day: number; exact: boolean } | undefined {
    let exact = true
    for (let index = priorTimeline.length - 1; index >= 0; index -= 1) {
        const entry = priorTimeline[index]
        if (entry?.precision === 'flashback') continue
        if (!entry || entry.precision === 'unknown' || entry.day === null
            || !Number.isSafeInteger(entry.day) || entry.day < 0) {
            exact = false
            continue
        }
        return { day: entry.day, exact: exact && entry.precision !== 'after' }
    }
    return undefined
}

function calendarOf(hint: SemanticTemporalHint | undefined): { calendar?: string } {
    const calendar = typeof hint?.calendar === 'string'
        ? hint.calendar.replace(/\s+/gu, ' ').trim().slice(0, MAX_CALENDAR_LENGTH)
        : ''
    return calendar ? { calendar } : {}
}

export function resolveMemoryRetrievalMetadata(input: {
    keywords: unknown
    temporalHint?: SemanticTemporalHint
    priorTimeline?: readonly MemoryTimelineEntry[]
}): MemoryRetrievalMetadata {
    const keywords = normalizeMemoryRetrievalKeywords(input.keywords)
    const priorTimeline = input.priorTimeline ?? []
    const hint = input.temporalHint
    const evidence = typeof hint?.evidence === 'string' ? hint.evidence.trim().slice(0, 240) : ''
    const anchor = presentAnchor(priorTimeline)
    if (hint?.timeline === 'flashback') {
        const unit = STORY_TIME_UNITS.includes(hint.flashbackUnit as StoryTimeUnit)
            ? hint.flashbackUnit as StoryTimeUnit : 'day'
        const distance = Number.isSafeInteger(hint.flashbackAmount) && (hint.flashbackAmount as number) >= 0
            ? hint.flashbackAmount as number : null
        // The model measures back from the present scene; the label counts from day 0.
        const present = Math.floor((anchor?.day ?? 0) / DAYS_PER_UNIT[unit])
        return {
            keywords,
            storyTime: {
                day: null,
                evidence: evidence || 'flashback without a stated distance',
                precision: 'flashback',
                offset: { amount: distance === null ? null : present - distance, unit },
                ...calendarOf(hint),
            },
        }
    }
    if (priorTimeline.length === 0) {
        return {
            keywords,
            storyTime: {
                day: 0,
                evidence: 'first recorded event',
                precision: 'origin',
                ...calendarOf(hint),
            },
        }
    }
    if (!anchor) {
        return {
            keywords,
            storyTime: {
                day: null,
                evidence: 'no grounded prior story time',
                precision: 'unknown',
                ...calendarOf(hint),
            },
        }
    }
    const elapsed = hint && hint.elapsedDays !== null && Number.isSafeInteger(hint.elapsedDays)
        && hint.elapsedDays >= 0 && evidence ? hint.elapsedDays : null
    // A skip of unknown length still happened after the last dated event.
    const day = anchor.day + (elapsed ?? 0)
    if (!Number.isSafeInteger(day)) {
        return {
            keywords,
            storyTime: {
                day: null,
                evidence: 'story time exceeds supported range',
                precision: 'unknown',
            },
        }
    }
    return {
        keywords,
        storyTime: {
            day,
            evidence: elapsed === null ? 'time skip of unknown length' : evidence,
            precision: elapsed !== null && anchor.exact ? 'explicit' : 'after',
            ...calendarOf(hint),
        },
    }
}

const UNIT_LABELS: Record<StoryTimeUnit, string> = { day: '일', month: '개월', year: '년' }
const signed = (value: number) => value > 0 ? `+${value}` : String(value)

/** Short Korean label for the UI, such as "+2일, 7월 넷째 주 월요일" or "-200년 (회상)". */
export function formatStoryTimeLabel(time: MemoryStoryTime | undefined): string {
    if (!time) return ''
    const label = time.precision === 'origin' ? '0일 (시작)'
        : time.precision === 'explicit' && time.day !== null ? `${signed(time.day)}일`
        : time.precision === 'after' && time.day !== null ? `${signed(time.day)}일 이후`
        : time.precision === 'flashback'
            ? !time.offset || time.offset.amount === null ? '회상 (시점 미상)'
            : `${signed(time.offset.amount)}${UNIT_LABELS[time.offset.unit]} (회상)`
        : '시점 미상'
    return time.calendar ? `${label}, ${time.calendar}` : label
}

/** Compact day for a canon line's (#N) mark, such as "day +2" or "day +5 or later". */
export function storyTimeStamp(time: MemoryStoryTime | undefined): string | undefined {
    if (!time) return undefined
    if (time.precision === 'origin') return 'day 0'
    if (time.precision === 'explicit' && time.day !== null) return `day ${signed(time.day)}`
    if (time.precision === 'after' && time.day !== null) return `day ${signed(time.day)} or later`
    if (time.precision === 'flashback') return 'flashback'
    return undefined
}

/** The time line an injected event carries, so a model reading events out of order can place each one. */
export function describeStoryTimeForModel(time: MemoryStoryTime | undefined): string | undefined {
    if (!time) return undefined
    const when = time.precision === 'origin' ? 'day 0, the start of the recorded story'
        : time.precision === 'explicit' && time.day !== null ? `day ${signed(time.day)} from the story start`
        : time.precision === 'after' && time.day !== null ? `day ${signed(time.day)} or later from the story start`
        : time.precision === 'flashback'
            ? !time.offset || time.offset.amount === null ? 'a flashback before the present scene, distance unstated'
            : `a flashback set ${signed(time.offset.amount)} ${time.offset.unit}${Math.abs(time.offset.amount) === 1 ? '' : 's'} from the story start`
        : 'unknown'
    return `[Story time: ${when}${time.calendar ? `; in-story date as written: ${time.calendar}` : ''}]`
}
