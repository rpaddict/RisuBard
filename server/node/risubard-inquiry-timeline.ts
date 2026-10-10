import { createEventOrder, type EventOrderMessage } from '../../src/ts/risubard/eventOrder'
import type { MarkdownWikiDocument } from './risubard-markdown-wiki'

export const INQUIRY_TIMELINE_MESSAGE_LIMIT = 96
export const RECENT_FLOW_EVENT_LIMIT = 8
export const RECENT_FLOW_TOKEN_LIMIT = 400

export interface InquiryTimelineInput {
    messages: readonly EventOrderMessage[]
}

type TimedDocument = Pick<MarkdownWikiDocument, 'id' | 'type' | 'title' | 'status' | 'sourceMessageIds'>

const FLOW_HEADER = 'Story flow before the recent transcript (oldest first; the recent transcript continues after the last item):'

function turnsLabel(turns: number): string {
    return turns === 1 ? '1 turn before' : `${turns} turns before`
}

/** Messages immediately before the recent transcript, oldest first. */
export function createInquiryTimeline(input?: InquiryTimelineInput) {
    const messages = (input?.messages ?? []).slice(-INQUIRY_TIMELINE_MESSAGE_LIMIT)
    const order = createEventOrder(messages)
    const assistantFrom = new Array<number>(messages.length + 1).fill(0)
    for (let index = messages.length - 1; index >= 0; index -= 1) {
        assistantFrom[index] = assistantFrom[index + 1] + (messages[index].role === 'char' ? 1 : 0)
    }
    const turnsBefore = (document: Pick<TimedDocument, 'sourceMessageIds'>): number | undefined => {
        const position = order.position(document)
        return position === undefined ? undefined : Math.max(1, assistantFrom[position])
    }
    return {
        sourceLabel(document: Pick<TimedDocument, 'sourceMessageIds'>): string | undefined {
            const turns = turnsBefore(document)
            return turns === undefined ? undefined : `[${turnsLabel(turns)} the recent transcript]`
        },
        recentFlow(
            documents: readonly TimedDocument[],
            countTokens: (value: string) => number,
            tokenLimit: number,
        ): { content: string; tokens: number } | undefined {
            const limit = Math.min(RECENT_FLOW_TOKEN_LIMIT, tokenLimit)
            const lines = documents
                .filter((document) => document.type === 'event' && document.status === 'active')
                .flatMap((document) => {
                    const turns = turnsBefore(document)
                    return turns === undefined ? [] : [{ document, turns }]
                })
                .sort((left, right) => right.turns - left.turns
                    || order.compare(left.document, right.document))
                .slice(-RECENT_FLOW_EVENT_LIMIT)
                .map(({ document, turns }) => `- [${turnsLabel(turns)}] ${document.title}`)
            while (lines.length > 0 && countTokens([FLOW_HEADER, ...lines].join('\n')) > limit) lines.shift()
            if (lines.length === 0) return undefined
            const content = [FLOW_HEADER, ...lines].join('\n')
            return { content, tokens: countTokens(content) }
        },
    }
}
