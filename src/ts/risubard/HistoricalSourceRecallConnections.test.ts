import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, test } from 'vitest'

describe('historical source recall connections', () => {
    test('searches loaded history outside the response rolling window', () => {
        const source = readFileSync(resolve(
            process.cwd(),
            'src/ts/process/index.svelte.ts'
        ), 'utf8')
        const recallCall = source.match(
            /sourceMatches: findHistoricalSourceMatches\(\{[\s\S]{0,500}?\}\),/
        )?.[0] ?? ''
        const exactRecallCall = source.match(
            /resolveSourceMatches: \(messageIds\) =>[\s\S]{0,700}?\}\),/
        )?.[0] ?? ''

        expect(source).toContain('findHistoricalSourceMatches,')
        expect(source).toContain('resolveHistoricalSourceMatchesById,')
        expect(recallCall).toContain('messages: currentChat.message')
        expect(recallCall).toContain(
            'inquirySettings.risuBardResponseMessageCount'
        )
        expect(recallCall).not.toContain(
            'inquirySettings.risuBardRecentMessageCount'
        )
        expect(exactRecallCall).toContain('messages: currentChat.message')
        expect(exactRecallCall).toContain('messageIds')
        expect(source).toContain('entityHints: lorepmt.bardWikiEntityHints')
        expect(source).toContain(
            'timeoutMs: inquirySettings.risuBardInquiryTimeoutMs'
        )
        expect(source).toContain(
            'fallbackInput: buildBoundedNarrativeInquiryFallback('
        )
        expect(source).toContain(
            'chat.risuBardWikiReboot?.stagingChatId === chatId'
        )
    })
})
