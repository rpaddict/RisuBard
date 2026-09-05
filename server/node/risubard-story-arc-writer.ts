import type { WikiWritingLanguage } from '../../src/ts/risubard/wikiWritingLanguage'
import {
    ARC_PLOTTER_DEFAULT_SETTINGS,
    normalizeArcPlotterSettings,
    type ArcPlotterSettings,
} from '../../src/ts/risubard/arcPlotterSettings'

export const STORY_ARC_CHECKPOINT_SIZE =
    ARC_PLOTTER_DEFAULT_SETTINGS.checkpointSize
export const STORY_ARC_MAX_MARKDOWN_CHARACTERS =
    ARC_PLOTTER_DEFAULT_SETTINGS.maxCharacters
export const STORY_ARC_EVENT_EXCERPT_CHARACTERS = 800

const STORY_ARC_TITLES = {
    ko: '스토리 아크 플롯',
    en: 'Story Arc Plot',
    ja: 'ストーリーアークプロット',
} as const

const LEGACY_STORY_ARC_TITLES = ['스토리 아크 지도', 'Story Arc Map'] as const

const checkpointPattern = /<!--\s*risubard-story-arc-checkpoint:\s*([A-Za-z0-9._:-]{1,200})\s*-->/gu

export interface StoryArcWriterDocument {
    id: string
    type: 'event' | 'other' | string
    title: string
    content: string
    sourceMessageIds: string[]
    created?: string
    status?: 'active' | 'superseded' | 'retracted'
}

export interface StoryArcUpdatePlan {
    candidate: {
        type: 'other'
        title: string
        aliases: string[]
        reason: string
        action: 'create' | 'update'
        targetDocumentId: string | null
        confidence: number
    }
    events: StoryArcWriterDocument[]
    checkpointEventId: string
}

function normalizedTitle(value: string): string {
    return value.normalize('NFKC').toLocaleLowerCase().trim()
}

export function isStoryArcTitle(value: string): boolean {
    const normalized = normalizedTitle(value)
    return [...Object.values(STORY_ARC_TITLES), ...LEGACY_STORY_ARC_TITLES]
        .some((title) =>
        normalizedTitle(title) === normalized)
}

export function isStoryArcCandidate(candidate: {
    type: string
    title: string
}): boolean {
    return candidate.type === 'other' && isStoryArcTitle(candidate.title)
}

export function readStoryArcCheckpoint(markdown: string): string | undefined {
    const matches = [...markdown.matchAll(checkpointPattern)]
    return matches.at(-1)?.[1]
}

export function stampStoryArcCheckpoint(
    markdown: string,
    eventId: string
): string {
    if (!/^[A-Za-z0-9._:-]{1,200}$/u.test(eventId)) {
        throw new Error('Story arc checkpoint event ID is invalid')
    }
    const body = markdown.replace(checkpointPattern, '').trimEnd()
    return `${body}\n\n<!-- risubard-story-arc-checkpoint: ${eventId} -->`
}

export function buildStoryArcUpdatePlan(input: {
    documents: readonly StoryArcWriterDocument[]
    savedEvents: readonly StoryArcWriterDocument[]
    writingLanguage: WikiWritingLanguage
    settings?: Partial<ArcPlotterSettings>
}): StoryArcUpdatePlan | undefined {
    const settings = normalizeArcPlotterSettings(input.settings)
    const existing = input.documents.find((document) =>
        document.type === 'other'
        && document.status !== 'retracted'
        && isStoryArcTitle(document.title)
    )
    const ordered = [...input.documents, ...input.savedEvents]
        .filter((document) => document.type === 'event'
            && document.status !== 'retracted'
            && document.status !== 'superseded')
        .filter((document, index, all) =>
            all.findIndex((candidate) => candidate.id === document.id) === index)
        .map((document, index) => ({ document, index }))
        .sort((left, right) => {
            const byCreated = (left.document.created ?? '')
                .localeCompare(right.document.created ?? '')
            return byCreated || left.index - right.index
        })
        .map(({ document }) => document)
    const checkpoint = existing
        ? readStoryArcCheckpoint(existing.content)
        : undefined
    if (existing && !checkpoint) return undefined
    const checkpointIndex = checkpoint
        ? ordered.findIndex((document) => document.id === checkpoint)
        : -1
    if (checkpoint && checkpointIndex < 0) return undefined
    const pending = ordered.slice(checkpointIndex + 1)
    if (pending.length < settings.checkpointSize) return undefined

    const events = pending.slice(0, settings.checkpointSize)
    const title = existing?.title ?? STORY_ARC_TITLES[input.writingLanguage]
    const eventTitles = events.map((event) => `[[${event.title}]]`).join(', ')
    const reason = input.writingLanguage === 'en'
        ? `Compact the next confirmed event checkpoint into the routing plot: ${eventTitles}`
        : input.writingLanguage === 'ja'
            ? `次の確定イベントチェックポイントをナビゲーション用アークプロットに圧縮する: ${eventTitles}`
            : `다음 확정 사건 체크포인트를 탐색용 아크 플롯에 압축한다: ${eventTitles}`
    return {
        candidate: {
            type: 'other',
            title,
            aliases: [],
            reason: reason.slice(0, 500),
            action: existing ? 'update' : 'create',
            targetDocumentId: existing?.id ?? null,
            confidence: 1,
        },
        events,
        checkpointEventId: events.at(-1)!.id,
    }
}

export function storyArcRewriteInstruction(
    writingLanguage: WikiWritingLanguage,
    value?: Partial<ArcPlotterSettings>
): string {
    const settings = normalizeArcPlotterSettings(value)
    const maxCharacters = settings.maxCharacters.toLocaleString('en-US')
    if (writingLanguage === 'en') {
        return [
            'For the reserved other document titled Story Arc Plot, use storyArcEvents as the evidence batch.',
            'It is a compact routing plot, not primary evidence. Keep exactly the useful H3 sections Arc Overview, Major Turning Points, and Open Threads.',
            `Keep at most ${settings.maxArcs} chronological arc bullets, ${settings.maxTurningPoints} turning-point bullets, and ${settings.maxOpenThreads} open-thread bullets. Link representative events as [[event title]].`,
            'Merge older adjacent arcs when over the cap while preserving distinctive names, objects, places, causal transitions, and representative event links.',
            `Keep the complete document within ${maxCharacters} characters. Never reproduce full event summaries or character state histories.`,
        ].join('\n')
    }
    if (writingLanguage === 'ja') {
        return [
            '予約された other 文書であるストーリーアークプロットは、storyArcEvents を根拠の束として使う。',
            'この文書は一次的事実の根拠ではなく、圧縮されたナビゲーション用プロットである。有用なH3節であるアーク概要、主要な転換点、未解決の糸のみを維持する。',
            `時系列のアーク箇条書き最大${settings.maxArcs}個、転換点最大${settings.maxTurningPoints}個、未解決の糸最大${settings.maxOpenThreads}個を維持し、代表的なイベントを [[イベントタイトル]] で接続する。`,
            '上限を超えたら古い隣接アークを統合するが、固有の名前・物・場所・因果の転換と代表的なイベントリンクは保存する。',
            `文書全体を${maxCharacters}文字以内に維持し、イベント要約の全文や人物の状態履歴を複製しない。`,
        ].join('\n')
    }
    return [
        '예약된 other 문서인 스토리 아크 플롯은 storyArcEvents를 근거 묶음으로 사용한다.',
        '이 문서는 1차 사실 근거가 아니라 압축 탐색 플롯이다. 유용한 H3 절인 아크 개요, 주요 전환점, 미해결 줄기만 유지한다.',
        `시간순 아크 글머리표 최대 ${settings.maxArcs}개, 전환점 최대 ${settings.maxTurningPoints}개, 미해결 줄기 최대 ${settings.maxOpenThreads}개를 유지하고 대표 사건을 [[사건 제목]]으로 연결한다.`,
        '상한을 넘으면 오래된 인접 아크를 합치되 고유 이름·물건·장소·인과 전환과 대표 사건 링크는 보존한다.',
        `문서 전체를 ${maxCharacters}자 안에 유지하고 사건 요약 전문이나 인물 상태 이력을 복제하지 않는다.`,
    ].join('\n')
}
