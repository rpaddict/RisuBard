import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, test } from 'vitest'

const processSource = readFileSync(resolve(
    process.cwd(), 'src/ts/process/index.svelte.ts'
), 'utf8')
const chatSource = readFileSync(resolve(
    process.cwd(), 'src/lib/ChatScreens/DefaultChatScreen.svelte'
), 'utf8')
const wikiSource = readFileSync(resolve(
    process.cwd(), 'src/lib/Others/RisuBardMemoryWiki.svelte'
), 'utf8')
const koSource = readFileSync(resolve(process.cwd(), 'src/lang/ko.ts'), 'utf8')
const enSource = readFileSync(resolve(process.cwd(), 'src/lang/en.ts'), 'utf8')

describe('BardWiki reboot connections', () => {
    test('checkpoints the batch before analysis and replaces only at completion', () => {
        const runner = processSource.slice(
            processSource.indexOf('async function runWikiReboot'),
            processSource.indexOf('export async function startCurrentWikiReboot')
        )
        expect(runner.indexOf('job.inFlightAssistantMessageIds ='))
            .toBeLessThan(runner.indexOf('storedResponseMemoryAnalysis.confirm'))
        expect(runner).toContain('recoverWikiRebootBatch')
        expect(runner.match(/completeWikiRebootBatch/g)).toHaveLength(2)
        const recoveredApply = runner.indexOf(
            'applyWikiRebootBatchReceipt(chat, batch, recovered)'
        )
        const recoveredPersist = runner.indexOf(
            'await persistWikiReboot', recoveredApply
        )
        expect(recoveredPersist).toBeLessThan(runner.indexOf(
            'await completeWikiRebootBatch', recoveredPersist
        ))

        const finalize = processSource.slice(
            processSource.indexOf('async function finalizeWikiReboot'),
            processSource.indexOf('async function runWikiReboot')
        )
        expect(finalize.indexOf('prepareWikiRebootReplacement'))
            .toBeLessThan(finalize.indexOf("action: 'finalize'"))
        expect(finalize.indexOf("action: 'finalize'"))
            .toBeLessThan(finalize.indexOf('delete chat.risuBardWikiReboot'))
    })

    test('blocks response paths only for reboot and shares the wiki generation indicator', () => {
        expect(chatSource).toContain('wikiRebootBlocksGeneration')
        expect(chatSource).toContain('if (wikiRebootBlocksGeneration)')
        expect(chatSource).toContain('disabled={wikiRebootBlocksGeneration}')
        expect(chatSource).toContain('class:wiki-generating={$isWikiGenerating}')
    })

    test('records reboot failures in the BardWiki work log', () => {
        const runner = processSource.slice(
            processSource.indexOf('async function runWikiReboot'),
            processSource.indexOf('export async function startCurrentWikiReboot')
        )
        const failure = runner.slice(
            runner.lastIndexOf('catch (error)'),
            runner.lastIndexOf('finally')
        )

        expect(failure).toContain('publishRisuBardMemoryActivity')
        expect(failure).toContain("operation: 'error'")
        expect(failure).toContain('위키 리부트 실패:')
        expect(failure).toContain('boundedMemoryAnalysisError(error)')
        expect(failure).toContain('job.lastError = reason')
        expect(failure).toContain('throw new Error(reason, { cause: error })')
    })

    test('allows responses during ordinary BardWiki work while still blocking reboot', () => {
        const sendChat = processSource.slice(
            processSource.indexOf('export async function sendChat'),
            processSource.indexOf('const stageTimings =',
                processSource.indexOf('export async function sendChat'))
        )
        expect(sendChat).not.toContain('get(isWikiGenerating)')
        expect(sendChat).toContain('generationScope.chat.risuBardWikiReboot')
        expect(sendChat.indexOf('generationScope.chat.risuBardWikiReboot'))
            .toBeLessThan(sendChat.indexOf('chatProcessStage.set(0)'))

        expect(chatSource).not.toContain('let wikiBlocksGeneration = $derived(')
        expect(chatSource).toContain('if (wikiRebootBlocksGeneration)')
        expect(chatSource).toContain('disabled={wikiRebootBlocksGeneration}')
        expect(chatSource).toContain('{#if $isWikiGenerating}')
    })

    test('offers text lifecycle controls and one-turn or two-turn choices', () => {
        expect(wikiSource).toContain('data-risubard-wiki-reboot')
        expect(wikiSource).toContain('{rebootButtonLabel}')
        expect(wikiSource).toContain('startReboot(1)')
        expect(wikiSource).toContain('startReboot(2)')
        expect(wikiSource).toContain('risuBardWikiRebootOneTurnTooltip')
        expect(wikiSource).toContain('risuBardWikiRebootTwoTurnTooltip')
        expect(wikiSource).toContain('onCancelWikiReboot')
    })

    test('accepts a visible chat index and starts reboot from that boundary', () => {
        expect(wikiSource).toContain('data-risubard-wiki-reboot-start-index')
        expect(wikiSource).toContain('risuBardWikiRebootStartChatIndex')
        expect(wikiSource).toContain('onStartWikiReboot?.(batchSize, rebootStartChatIndex)')
        expect(processSource).toContain('startChatIndex: number = 0')
        expect(processSource).toMatch(
            /projectWikiRebootTurns\(current\.chat\.message, startChatIndex, true,\s*true\)/
        )
        expect(koSource).toContain('시작 챗 인덱스')
        expect(enSource).toContain('Starting chat index')
    })

    test('loads and refreshes the visible staging wiki during reboot', () => {
        expect(wikiSource).toContain('resolveWikiRebootViewChatId')
        expect(wikiSource).toContain('let wikiChatId = $derived(')
        expect(wikiSource).toContain('chatId: wikiChatId')
        expect(wikiSource).toContain('detail.chatId !== wikiChatId')
        expect(wikiSource).toContain('locked={Boolean(rebootJob)}')
        expect(wikiSource).toContain('{#if onExecuteWikiCommand && !rebootJob}')
    })

    test('describes two-turn mode as reducing semantic analysis calls', () => {
        expect(koSource).toContain('의미 분석 호출 수와 반복 프롬프트 토큰')
        expect(enSource).toContain('semantic-analysis calls and repeated prompt tokens')
    })

    test('shows the active analysis token limit before choosing a batch size', () => {
        expect(wikiSource).toContain('resolveRisuBardChatSettings')
        expect(wikiSource).toContain('data-risubard-wiki-reboot-token-budget')
        expect(wikiSource).toContain('risuBardWikiRebootTokenBudget(')
        expect(koSource).toContain('정본 갱신 배치가 이 한도를 넘을 것으로 예상되면 문서 단위로 자동 분할됩니다')
        expect(enSource).toContain('Canonical update batches are automatically split by document')
    })

    test('shows the send lock with resume and cancel above the composer', () => {
        expect(chatSource).toContain('data-risubard-wiki-reboot-notice')
        expect(chatSource).toContain('onclick={resumeRebootFromNotice}')
        expect(chatSource).toContain('alertConfirm(language.risuBardWikiRebootCancelWarning)')
        expect(koSource).toContain('risuBardWikiRebootNoticePaused')
        expect(enSource).toContain('risuBardWikiRebootNoticePaused')
    })

    test('does not copy a reboot job into another chat', () => {
        for (const file of [
            'src/lib/SideBars/SideChatList.svelte',
            'src/lib/ChatScreens/Chat.svelte',
        ]) {
            expect(readFileSync(resolve(process.cwd(), file), 'utf8'))
                .toContain('delete newChat.risuBardWikiReboot')
        }
        const saveSlots = readFileSync(resolve(
            process.cwd(), 'src/ts/risubard/memorySaveSlots.ts'
        ), 'utf8')
        expect(saveSlots).toContain('delete snapshot.risuBardWikiReboot')
        expect(saveSlots).toContain('delete chat.risuBardWikiReboot')
    })
})
