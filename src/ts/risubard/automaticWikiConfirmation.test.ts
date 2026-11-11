import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { shouldAutomaticallyConfirmNarrativeTurn } from './automaticWikiConfirmation'

describe('automatic BardWiki confirmation', () => {
    test('remains enabled by default and can be disabled explicitly', () => {
        expect(shouldAutomaticallyConfirmNarrativeTurn(undefined)).toBe(true)
        expect(shouldAutomaticallyConfirmNarrativeTurn(true)).toBe(true)
        expect(shouldAutomaticallyConfirmNarrativeTurn(false)).toBe(false)
    })

    test('places a manual wiki button and auto switch after the send control', () => {
        const composer = readFileSync(
            'src/lib/ChatScreens/DefaultChatScreen.svelte',
            'utf8'
        )
        const korean = readFileSync('src/lang/ko.ts', 'utf8')

        expect(composer).toContain('data-risubard-wiki-button')
        expect(composer).toContain('onclick={() => memoryWikiOpen = !memoryWikiOpen}')
        expect(korean).toContain('risuBardMemoryOpenManual: "BARDWIKI 열기"')
        expect(composer).toContain('data-risubard-auto-wiki')
        expect(composer).toContain('DBState.db.risuBardAutoWikiEnabled !== false')
        expect(composer).toContain('data-risubard-wiki-cancel')
        expect(composer).toContain('onclick={cancelWikiGeneration}')
        expect(composer).toContain('style="left: 5px"')
        expect(korean).toContain('risuBardWikiCancel: "바드위키 작업 취소"')
    })

    test('guards automatic confirmation and keeps manual confirmation available', () => {
        const processSource = readFileSync('src/ts/process/index.svelte.ts', 'utf8')
        const chatSource = readFileSync('src/lib/ChatScreens/Chat.svelte', 'utf8')
        const chatsSource = readFileSync('src/lib/ChatScreens/Chats.svelte', 'utf8')
        const screenSource = readFileSync('src/lib/ChatScreens/DefaultChatScreen.svelte', 'utf8')

        expect(processSource).toMatch(
            /shouldAutomaticallyConfirmNarrativeTurn\(\s*requestSettings\.risuBardAutoWikiEnabled\s*\)/
        )
        expect(processSource).toContain('export async function confirmCurrentNarrativeMessage(')
        expect(processSource).toContain('export async function reanalyzeNarrativeMessage(')
        expect(processSource).toContain('historicalReanalysis: true')
        expect(chatSource).toContain('data-risubard-reanalyze-memory')
        expect(chatSource).toContain('<SearchIcon size={20}')
        expect(chatsSource).toContain('onReanalyzeMemory')
        expect(screenSource).toContain('onReanalyzeMemory={reanalyzeNarrativeMessage}')
    })

    test('serializes confirmations per chat and analyzes the queued backlog in story order', () => {
        const processSource = readFileSync('src/ts/process/index.svelte.ts', 'utf8')

        expect(processSource).toContain('enqueueNarrativeConfirmation(')
        expect(processSource).toContain('projectMemoryBacklog(')
        const trigger = processSource.search(/shouldAutomaticallyConfirmNarrativeTurn\(\s*requestSettings\.risuBardAutoWikiEnabled/)
        expect(trigger).toBeGreaterThan(0)
        const block = processSource.slice(trigger, trigger + 800)
        expect(block).toContain('queueNarrativeTurn({')
        expect(block).toContain('targetMessageId: narrativeTurnToConfirm.targetMessageId')
        // The turn interval only defers; once due, the queued backlog runs.
        const queue = processSource.slice(processSource.indexOf('function queueNarrativeTurnNow('))
        const queueBody = queue.slice(0, queue.search(/\r?\n\}\r?\n/))
        expect(queueBody).toContain('narrativeAnalysisDue(')
        expect(queueBody).toContain('void processNarrativeBacklog(input)')
        // A turn that does not confirm stops the pass so that no later turn overtakes it.
        const runner = processSource.slice(processSource.indexOf('async function runNarrativeBacklog('))
        expect(runner.slice(0, runner.search(/\r?\n\}\r?\n/))).toMatch(/risubardMemoryConfirmed !== true\)+ break/)
    })

    test('a user retry or additional analysis replaces the chat\'s analysis in flight instead of queueing behind it', () => {
        const processSource = readFileSync('src/ts/process/index.svelte.ts', 'utf8')
        const body = (name: string) => {
            const start = processSource.indexOf(`export async function ${name}(`)
            const rest = processSource.slice(start)
            return rest.slice(0, rest.search(/\r?\n\}\r?\n/))
        }
        for (const name of ['retryNarrativeBacklog', 'forceCurrentNarrativeWikiUpdate']) {
            const source = body(name)
            const restart = source.indexOf('await restartChatWikiAnalysis(')
            expect(restart, name).toBeGreaterThan(0)
            expect(restart, name).toBeLessThan(source.search(/processNarrativeBacklog\(|confirmProjectedNarrativeTurn\(/))
        }
        // Queued analyses of that chat are dropped too, so they cannot hang on the same provider again.
        expect(processSource).toMatch(/wikiChatCancellationEpoch\(chatKey\) === chatEpoch/)
    })

    test('semantic recall waits as long as the user\'s wiki lookup time and records why it was left out', () => {
        const processSource = readFileSync('src/ts/process/index.svelte.ts', 'utf8')
        // A fixed 2-second wait dropped every remote embedding model that answers in several seconds.
        expect(processSource).toMatch(/wikiEmbeddingRuntime\.search\(currentInput, retrievalRecentContext,\s*inquirySettings\.risuBardInquiryTimeoutMs\)/)
        expect(processSource).toMatch(/timeoutMs: inquirySettings\.risuBardInquiryTimeoutMs/)
        expect(processSource).toContain('semanticSkip: wikiSemanticSkip')
    })

    test('keeps configurable confirmation delay out of the product path', () => {
        const processSource = readFileSync('src/ts/process/index.svelte.ts', 'utf8')
        const currentChatSettings = readFileSync(
            'src/lib/Others/RisuBardCurrentChatSettings.svelte',
            'utf8'
        )
        const commonSettings = readFileSync(
            'src/ts/setting/risuBardCommonSettingsData.ts',
            'utf8'
        )
        const databaseSource = readFileSync(
            'src/ts/storage/database.svelte.ts',
            'utf8'
        )

        expect(processSource).toMatch(
            /const narrativeTurnToConfirm = projectConfirmedMemoryTurn\(\s*currentChat\.message,\s*undefined,\s*\{\s*ignoreOocTurns: true\s*\}\s*\)/
        )
        for (const source of [
            processSource,
            currentChatSettings,
            commonSettings,
            databaseSource,
        ]) {
            expect(source).not.toContain('risuBardAutoConfirmDelayEnabled')
            expect(source).not.toContain('risuBardAutoWikiConfirmationCursor')
        }
    })
})
