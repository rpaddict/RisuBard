import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import {
    selectLaggedConfirmationTarget,
    shouldAutomaticallyConfirmNarrativeTurn,
} from './automaticWikiConfirmation'

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

        expect(processSource).toMatch(
            /shouldAutomaticallyConfirmNarrativeTurn\(\s*DBState\.db\.risuBardAutoWikiEnabled\s*\)/
        )
        expect(processSource).toContain('export async function confirmCurrentNarrativeMessage(')
    })
})

describe('lagged BardWiki confirmation targets', () => {
    /** Alternating turns: u1, c1, u2, c2 ... optionally followed by a pending user message. */
    const conversation = (
        turns: number,
        options: { pendingUser?: boolean } = {}
    ) => {
        const messages: Array<Record<string, unknown>> = []
        for (let turn = 1; turn <= turns; turn += 1) {
            messages.push({ role: 'user', chatId: `u${turn}` })
            messages.push({ role: 'char', chatId: `c${turn}` })
        }
        if (options.pendingUser) messages.push({ role: 'user', chatId: 'ux' })
        return messages
    }

    // The user has just sent their fifth message: u1,c1 ... u4,c4, ux
    const sending = conversation(4, { pendingUser: true })

    test('walks back one assistant turn per unit of lag', () => {
        expect(selectLaggedConfirmationTarget(sending, 1)).toBe('c3')
        expect(selectLaggedConfirmationTarget(sending, 2)).toBe('c2')
        expect(selectLaggedConfirmationTarget(sending, 3)).toBe('c1')
    })

    test('reports no target instead of falling back to a recent turn', () => {
        expect(selectLaggedConfirmationTarget(sending, 4)).toBeNull()
        expect(selectLaggedConfirmationTarget(sending, 99)).toBeNull()
    })

    test('treats a missing or invalid lag as disabled', () => {
        expect(selectLaggedConfirmationTarget(sending, 0)).toBeNull()
        expect(selectLaggedConfirmationTarget(sending, -3)).toBeNull()
        expect(selectLaggedConfirmationTarget(sending, 1.5)).toBeNull()
        expect(selectLaggedConfirmationTarget(sending, Number.NaN)).toBeNull()
    })

    test('requires the latest active message to be a user message', () => {
        expect(selectLaggedConfirmationTarget(conversation(4), 1)).toBeNull()
        expect(selectLaggedConfirmationTarget([], 1)).toBeNull()
    })

    test('skips disabled and comment messages', () => {
        const messages = conversation(4, { pendingUser: true })
        const third = messages.find((message) => message.chatId === 'c3')!
        third.disabled = true
        expect(selectLaggedConfirmationTarget(messages, 1)).toBe('c2')

        const commented = conversation(4, { pendingUser: true })
        commented.find((message) => message.chatId === 'c3')!.isComment = true
        expect(selectLaggedConfirmationTarget(commented, 1)).toBe('c2')
    })

    test('rejects assistant messages without a usable chatId', () => {
        const messages = conversation(4, { pendingUser: true })
        messages.find((message) => message.chatId === 'c3')!.chatId = '  '
        expect(selectLaggedConfirmationTarget(messages, 1)).toBeNull()
    })

    test('advances one turn at a time so no turn is skipped', () => {
        const targets = [2, 3, 4, 5, 6].map((turns) =>
            selectLaggedConfirmationTarget(
                conversation(turns, { pendingUser: true }),
                1
            )
        )
        expect(targets).toEqual(['c1', 'c2', 'c3', 'c4', 'c5'])
    })

    test('wires the lag setting into automatic confirmation only', () => {
        const processSource = readFileSync('src/ts/process/index.svelte.ts', 'utf8')
        const settingsData = readFileSync(
            'src/ts/setting/risuBardCommonSettingsData.ts',
            'utf8'
        )

        expect(processSource).toContain('selectLaggedConfirmationTarget(')
        expect(processSource).toContain('risuBardAutoConfirmLagTurns')
        // Manual confirmation and forced updates pass an explicit messageId and
        // must keep bypassing the lag.
        expect(processSource).toContain(
            'projectConfirmedMemoryTurn(chat.message, messageId)'
        )
        expect(settingsData).toContain("bindKey: 'risuBardAutoConfirmLagTurns'")
    })
})
