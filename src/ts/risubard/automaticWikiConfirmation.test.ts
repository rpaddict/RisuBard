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
            /shouldAutomaticallyConfirmNarrativeTurn\(\s*DBState\.db\.risuBardAutoWikiEnabled\s*\)/
        )
        expect(processSource).toContain('export async function confirmCurrentNarrativeMessage(')
        expect(processSource).toContain('export async function reanalyzeNarrativeMessage(')
        expect(processSource).toContain('historicalReanalysis: true')
        expect(chatSource).toContain('data-risubard-reanalyze-memory')
        expect(chatSource).toContain('<SearchIcon size={20}')
        expect(chatsSource).toContain('onReanalyzeMemory')
        expect(screenSource).toContain('onReanalyzeMemory={reanalyzeNarrativeMessage}')
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
            /const narrativeTurnToConfirm = projectConfirmedMemoryTurn\(\s*currentChat\.message\s*\)/
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
