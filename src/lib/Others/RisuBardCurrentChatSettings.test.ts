// @vitest-environment happy-dom

import { afterEach, describe, expect, test } from 'vitest'
import { mount, tick, unmount } from 'svelte'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Chat } from 'src/ts/storage/database.svelte'
import { resolveRisuBardChatSettings, type RisuBardChatSettings } from 'src/ts/risubard/risuBardSettings'
import RisuBardCurrentChatSettings from './RisuBardCurrentChatSettings.svelte'

let mounted: ReturnType<typeof mount> | undefined

afterEach(async () => {
    if (mounted) await unmount(mounted)
    mounted = undefined
    document.body.replaceChildren()
})
function chatWithLongMessages(): Chat {
    return {
        id: 'chat',
        name: 'test',
        note: '',
        localLore: [],
        message: Array.from({ length: 120 }, (_, index) => ({
            role: index % 2 === 0 ? 'user' as const : 'char' as const,
            data: '가'.repeat(1_200),
        })),
        risuBardSettings: {
            risuBardResponseMessageCount: 4,
            risuBardBardChanEnabled: true,
            risuBardBardChanModelMode: 'model',
        },
    }
}

describe('RisuBardCurrentChatSettings', () => {
    test.each([
        ['bardwiki-maximum-tokens', 'risuBardInquiryMaximumTokenBudget', '7500', '8213'],
        ['bardwiki-analysis-tokens', 'risuBardAnalysisTokenLimit', '8192', '8970'],
    ] as const)('%s keeps the baseline in the input and shows its dynamic limit separately', async (id, key, base, effective) => {
        const chat = chatWithLongMessages()
        chat.message = [{ role: 'char', data: '가'.repeat(50_000) }]
        chat.risuBardSettings = { risuBardDynamicMemoryMode: 'balanced' }
        mounted = mount(RisuBardCurrentChatSettings, { target: document.body, props: { chat, global: {} } })
        const input = document.querySelector<HTMLInputElement>(`#${id}`)!
        expect(input.value).toBe(base)
        expect(document.querySelector(`#${id}-dynamic`)?.textContent).toContain(Number(effective).toLocaleString('ko-KR'))
        expect(input.getAttribute('aria-describedby')).toContain(`${id}-dynamic`)
        input.focus()
        await tick()
        expect(input.value).toBe(base)
        input.blur()
        await tick()
        expect(chat.risuBardSettings[key]).toBeUndefined()
        input.focus()
        await tick()
        input.value = '7000'
        input.dispatchEvent(new Event('input', { bubbles: true }))
        input.blur()
        await tick()
        expect(chat.risuBardSettings[key]).toBe(7000)
        expect(input.value).toBe('7000')
        expect(document.querySelector(`#${id}-dynamic`)?.textContent).toContain('7,665')
        input.focus()
        await tick()
        input.value = '9000'
        input.dispatchEvent(new Event('input', { bubbles: true }))
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
        await tick()
        expect(input.value).toBe('7000')
        expect(chat.risuBardSettings[key]).toBe(7000)
        expect(document.querySelector('#bardwiki-source-tokens')?.classList.contains('dynamic-value')).toBe(false)
    })
    test('edits global dynamic defaults independently of chat overrides', async () => {
        const global: RisuBardChatSettings = {}
        const chat = chatWithLongMessages()
        chat.risuBardSettings!.risuBardDynamicMemoryMode = 'recall'
        mounted = mount(RisuBardCurrentChatSettings, { target: document.body, props: { chat, global, globalDynamicOnly: true } })
        const select = document.querySelector<HTMLSelectElement>('#bardwiki-dynamic-memory')!
        expect(select.value).toBe('economy')
        select.value = 'balanced'
        select.dispatchEvent(new Event('change', { bubbles: true }))
        await tick()
        expect(global.risuBardDynamicMemoryMode).toBe('balanced')
        expect(chat.risuBardSettings!.risuBardDynamicMemoryMode).toBe('recall')
        expect(document.querySelector('#bardwiki-model-mode')).toBeNull()
        expect(document.querySelector('#bardwiki-memory-budget')).toBeNull()
    })
    test('stores dynamic policy, shows computed limits and restores the baseline when disabled', async () => {
        const chat = chatWithLongMessages()
        chat.message = Array.from({ length: 700 }, () => ({ role: 'char' as const, data: '가'.repeat(1000) }))
        const global: RisuBardChatSettings = {}
        mounted = mount(RisuBardCurrentChatSettings, { target: document.body, props: { chat, global } })
        expect(document.querySelector('#bardwiki-dynamic-maximum')).toBeNull()
        expect(document.querySelector('#bardwiki-dynamic-memory')).toBeNull()
        const preset = document.querySelector<HTMLSelectElement>('#bardwiki-memory-budget')!
        preset.value = 'custom'
        preset.dispatchEvent(new Event('change', { bubbles: true }))
        await tick()
        const select = document.querySelector<HTMLSelectElement>('#bardwiki-dynamic-memory')!
        expect(select).not.toBeNull()
        select.value = 'balanced'
        select.dispatchEvent(new Event('change', { bubbles: true }))
        await tick()
        expect(document.querySelector<HTMLInputElement>('#bardwiki-maximum-tokens')?.value).toBe('7500')
        expect(document.querySelector('#bardwiki-maximum-tokens-dynamic')?.textContent).toContain('11,250')
        expect(document.querySelector<HTMLInputElement>('#bardwiki-analysis-tokens')?.value).toBe('8192')
        expect(document.querySelector('#bardwiki-analysis-tokens-dynamic')?.textContent).toContain('12,288')
        expect(document.querySelector<HTMLInputElement>('#bardwiki-history-limit')?.value).toBe('8')
        expect(document.querySelectorAll('.dynamic-value')).toHaveLength(4)
        const maximum = document.querySelector<HTMLInputElement>('#bardwiki-dynamic-maximum')!
        maximum.value = '8000'
        maximum.dispatchEvent(new Event('change', { bubbles: true }))
        await tick()
        expect(document.querySelector<HTMLInputElement>('#bardwiki-maximum-tokens')?.value).toBe('7500')
        expect(document.querySelector('#bardwiki-maximum-tokens-dynamic')?.textContent).toContain('8,000')
        expect(document.querySelector('[data-chat-setting-help="risuBardInquiryMaximumTokenBudget"]')?.getAttribute('data-help-text')).toContain('상한 적용')
        const help = document.querySelector<HTMLButtonElement>('[data-chat-setting-help="risuBardDynamicMemoryMode"]')!
        expect(help.getAttribute('aria-label')).toBe('장기기억 동적 한도 도움말')
        expect(help.getAttribute('data-help-text')).toContain('50턴')
        const saved = JSON.parse(JSON.stringify(chat))
        await unmount(mounted)
        mounted = mount(RisuBardCurrentChatSettings, { target: document.body, props: { chat: saved, global } })
        expect(document.querySelector<HTMLInputElement>('#bardwiki-dynamic-maximum')!.value).toBe('8000')
        const restored = document.querySelector<HTMLSelectElement>('#bardwiki-dynamic-memory')!
        restored.value = 'off'
        restored.dispatchEvent(new Event('change', { bubbles: true }))
        await tick()
        expect(document.querySelector('#bardwiki-dynamic-maximum')).toBeNull()
        expect(resolveRisuBardChatSettings(global, saved.risuBardSettings).risuBardInquiryMaximumTokenBudget).toBe(7500)
        expect(document.querySelector('#bardwiki-maximum-tokens-dynamic')).toBeNull()
    })
    test.each(['blur', 'Enter'])('recall analysis preserves lowered input after %s and explains the model ceiling', async (finish) => {
        const chat = chatWithLongMessages()
        chat.message = [{role: 'char', data: '가'.repeat(500_000)}]
        chat.risuBardSettings = {risuBardDynamicMemoryMode: 'recall'}
        mounted = mount(RisuBardCurrentChatSettings, {target: document.body, props: {chat, global: {}}})
        const input = document.querySelector<HTMLInputElement>('#bardwiki-analysis-tokens')!
        const description = () => document.querySelector('#bardwiki-analysis-tokens-dynamic')!.textContent
        expect(input.value).toBe('8192')
        expect(description()).toContain('16,384')
        expect(description()).toContain('동적 요청')
        expect(description()).toContain('모델 출력 상한')
        for (const [typed, saved, requested] of [['4096', 4096, '8,192'], ['1000', 3072, '6,144']] as const) {
            input.focus()
            await tick()
            input.value = typed
            input.dispatchEvent(new Event('input', {bubbles: true}))
            if (finish === 'blur') input.blur()
            else input.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', bubbles: true}))
            await tick()
            expect(chat.risuBardSettings.risuBardAnalysisTokenLimit).toBe(saved)
            expect(input.value).toBe(String(saved))
            expect(description()).toContain(requested)
        }
        const saved = JSON.parse(JSON.stringify(chat))
        await unmount(mounted)
        mounted = mount(RisuBardCurrentChatSettings, {target: document.body, props: {chat: saved, global: {}}})
        expect(document.querySelector<HTMLInputElement>('#bardwiki-analysis-tokens')!.value).toBe('3072')
        expect(description()).toContain('6,144')
    })
    test('keeps ordinary analysis input unchanged when dynamic memory is off', async () => {
        const chat = chatWithLongMessages()
        chat.risuBardSettings!.risuBardDynamicMemoryMode = 'off'
        mounted = mount(RisuBardCurrentChatSettings, {target: document.body, props: {chat, global: {}}})
        const input = document.querySelector<HTMLInputElement>('#bardwiki-analysis-tokens')!
        expect(input.value).toBe('8192')
        expect(document.querySelector('#bardwiki-analysis-tokens-dynamic')).toBeNull()
        input.focus()
        await tick()
        input.value = '7000'
        input.dispatchEvent(new Event('input', {bubbles: true}))
        input.blur()
        await tick()
        expect(input.value).toBe('7000')
        expect(chat.risuBardSettings!.risuBardAnalysisTokenLimit).toBe(7000)
        expect(document.querySelector('#bardwiki-analysis-tokens-dynamic')).toBeNull()
    })
    test('pins current values across existing and new chats, persists edits, and unpins locally', async () => {
        const chat = chatWithLongMessages()
        const character: { risuBardPinnedSettings?: RisuBardChatSettings } = {}
        const global: RisuBardChatSettings = { risuBardResponseMessageCount: 12 }
        mounted = mount(RisuBardCurrentChatSettings, {
            target: document.body,
            props: { chat, global, character },
        })
        const pin = document.querySelector<HTMLInputElement>('[data-pin-chat-settings-character]')
        expect(pin).not.toBeNull()
        pin!.click()
        await tick()
        expect(character.risuBardPinnedSettings?.risuBardResponseMessageCount).toBe(4)
        const count = document.querySelector<HTMLInputElement>('#bardwiki-response-messages')!
        count.value = '7'
        count.dispatchEvent(new Event('change', { bubbles: true }))
        await tick()
        const saved = JSON.parse(JSON.stringify(character))
        expect(resolveRisuBardChatSettings(global, undefined, saved.risuBardPinnedSettings).risuBardResponseMessageCount).toBe(7)
        expect(resolveRisuBardChatSettings(global, { risuBardResponseMessageCount: 2 }, saved.risuBardPinnedSettings).risuBardResponseMessageCount).toBe(7)
        expect(resolveRisuBardChatSettings(global).risuBardResponseMessageCount).toBe(12)

        await unmount(mounted)
        mounted = undefined
        const newChat: Chat = { ...chatWithLongMessages(), id: 'new-chat', risuBardSettings: undefined }
        mounted = mount(RisuBardCurrentChatSettings, {
            target: document.body,
            props: { chat: newChat, global, character: saved },
        })
        const restoredPin = document.querySelector<HTMLInputElement>('[data-pin-chat-settings-character]')!
        expect(restoredPin.checked).toBe(true)
        expect(document.querySelector<HTMLInputElement>('#bardwiki-response-messages')!.value).toBe('7')
        restoredPin.click()
        await tick()
        expect(saved.risuBardPinnedSettings).toBeUndefined()
        expect(newChat.risuBardSettings?.risuBardResponseMessageCount).toBe(7)
        expect(resolveRisuBardChatSettings(global, { risuBardResponseMessageCount: 2 }, saved.risuBardPinnedSettings).risuBardResponseMessageCount).toBe(2)
    })

    test('promotes the current chat values to global settings', async () => {
        const chat = chatWithLongMessages()
        const global: RisuBardChatSettings = {
            risuBardResponseMessageCount: 12,
            risuBardBardChanEnabled: false,
            risuBardBardChanModelMode: 'memory',
        }
        mounted = mount(RisuBardCurrentChatSettings, {
            target: document.body,
            props: { chat, global },
        })

        document.querySelector<HTMLButtonElement>(
            '[data-apply-chat-settings-global]'
        )!.click()
        await tick()

        expect(global.risuBardResponseMessageCount).toBe(4)
        expect(global.risuBardBardChanEnabled).toBe(true)
        expect(global.risuBardBardChanModelMode).toBe('model')
        expect(chat.risuBardSettings).toBeUndefined()
    })

    describe('memory budget preset', () => {
        const choose = async (value: string) => {
            const select = document.querySelector<HTMLSelectElement>('#bardwiki-memory-budget')!
            select.value = value
            select.dispatchEvent(new Event('change', { bubbles: true }))
            await tick()
        }
        const summary = () => document.querySelector('#bardwiki-memory-budget-summary')?.textContent?.trim()
        const budgetInputs = ['#bardwiki-target-tokens', '#bardwiki-event-tokens', '#bardwiki-source-tokens', '#bardwiki-maximum-tokens']
        const dynamicIds = ['#bardwiki-dynamic-memory', '#bardwiki-dynamic-maximum']

        test('shows the standard tier summary and hides the six fields while keeping the other search fields', () => {
            mounted = mount(RisuBardCurrentChatSettings, { target: document.body, props: { chat: chatWithLongMessages(), global: {} } })
            const select = document.querySelector<HTMLSelectElement>('#bardwiki-memory-budget')!
            expect([...select.options].map(option => option.textContent)).toEqual(['절약', '보통', '넉넉', '커스텀'])
            expect(select.value).toBe('standard')
            expect(select.closest('[data-chat-setting-field]')?.getAttribute('data-chat-setting-field')).toBe('risuBardMemoryBudgetPreset')
            expect(summary()).toBe('검색 목표 4,000 / 사건 3,000 / 자료별 2,000 / 최대 7,500 / 동적 한도 절약형')
            expect(summary()).not.toContain('·')
            expect([...document.querySelectorAll('#bardwiki-memory-budget-summary .summary-part')].map(part => part.textContent))
                .toEqual(['검색 목표 4,000', '사건 3,000', '자료별 2,000', '최대 7,500', '동적 한도 절약형'])
            for (const selector of [...budgetInputs, ...dynamicIds]) expect(document.querySelector(selector), selector).toBeNull()
            expect(document.querySelector('#bardwiki-timeout')).not.toBeNull()
            expect(document.querySelector('#bardwiki-history-limit')).not.toBeNull()
            const help = document.querySelector('[data-chat-setting-help="risuBardMemoryBudgetPreset"]')!
            expect(help.getAttribute('aria-label')).toBe('기억 예산 도움말')
            expect(help.getAttribute('data-help-text')).toContain('절약(검색 목표 3,000, 최대 5,500)')
            expect(help.getAttribute('data-help-text')).toContain('커스텀')
        })

        test('writes the six tier values to the chat, keeps 커스텀 open without changing them, and tiers close it again', async () => {
            const chat = chatWithLongMessages()
            const global: RisuBardChatSettings = {}
            mounted = mount(RisuBardCurrentChatSettings, { target: document.body, props: { chat, global } })
            await choose('generous')
            expect(chat.risuBardSettings).toMatchObject({
                risuBardInquiryTargetTokenBudget: 6000,
                risuBardInquiryEventTokenBudget: 4000,
                risuBardInquirySourceTokenBudget: 2500,
                risuBardInquiryMaximumTokenBudget: 10500,
                risuBardDynamicMemoryMode: 'balanced',
                risuBardDynamicMemoryMaximumTokens: 16000,
                risuBardResponseMessageCount: 4,
            })
            expect(global).toEqual({})
            expect(document.querySelector<HTMLSelectElement>('#bardwiki-memory-budget')!.value).toBe('generous')
            expect(summary()).toBe('검색 목표 6,000 / 사건 4,000 / 자료별 2,500 / 최대 10,500 / 동적 한도 균형형')
            expect(document.querySelector('#bardwiki-target-tokens')).toBeNull()

            const before = JSON.stringify(chat.risuBardSettings)
            await choose('custom')
            expect(JSON.stringify(chat.risuBardSettings)).toBe(before)
            expect(document.querySelector<HTMLSelectElement>('#bardwiki-memory-budget')!.value).toBe('custom')
            expect(summary()).toBeUndefined()
            expect(document.querySelector<HTMLInputElement>('#bardwiki-target-tokens')!.value).toBe('6000')
            expect(document.querySelector<HTMLInputElement>('#bardwiki-source-tokens')!.value).toBe('2500')
            expect(document.querySelector<HTMLSelectElement>('#bardwiki-dynamic-memory')!.value).toBe('balanced')
            expect(document.querySelector<HTMLInputElement>('#bardwiki-dynamic-maximum')!.value).toBe('16000')

            const source = document.querySelector<HTMLInputElement>('#bardwiki-source-tokens')!
            source.value = '2600'
            source.dispatchEvent(new Event('change', { bubbles: true }))
            await tick()
            expect(chat.risuBardSettings!.risuBardInquirySourceTokenBudget).toBe(2600)
            expect(document.querySelector<HTMLSelectElement>('#bardwiki-memory-budget')!.value).toBe('custom')

            await choose('economy')
            expect(chat.risuBardSettings).toMatchObject({
                risuBardInquiryTargetTokenBudget: 3000,
                risuBardInquiryEventTokenBudget: 2000,
                risuBardInquirySourceTokenBudget: 1500,
                risuBardInquiryMaximumTokenBudget: 5500,
                risuBardDynamicMemoryMode: 'economy',
                risuBardDynamicMemoryMaximumTokens: 12000,
            })
            expect(summary()).toBe('검색 목표 3,000 / 사건 2,000 / 자료별 1,500 / 최대 5,500 / 동적 한도 절약형')
            expect(document.querySelector('#bardwiki-source-tokens')).toBeNull()
        })

        test('shows the fields for values that match no tier and re-detects a saved tier on remount', async () => {
            const chat = chatWithLongMessages()
            chat.risuBardSettings!.risuBardInquiryTargetTokenBudget = 3500
            mounted = mount(RisuBardCurrentChatSettings, { target: document.body, props: { chat, global: {} } })
            expect(document.querySelector<HTMLSelectElement>('#bardwiki-memory-budget')!.value).toBe('custom')
            expect(summary()).toBeUndefined()
            expect(document.querySelector<HTMLInputElement>('#bardwiki-target-tokens')!.value).toBe('3500')
            await choose('standard')
            const saved = JSON.parse(JSON.stringify(chat))
            await unmount(mounted)
            mounted = mount(RisuBardCurrentChatSettings, { target: document.body, props: { chat: saved, global: {} } })
            expect(document.querySelector<HTMLSelectElement>('#bardwiki-memory-budget')!.value).toBe('standard')
            expect(document.querySelector('#bardwiki-target-tokens')).toBeNull()
        })

        test('lets the row wrap and shrink and wraps the summary only between label and value pairs', () => {
            const source = readFileSync(resolve(process.cwd(), 'src/lib/Others/RisuBardCurrentChatSettings.svelte'), 'utf8')
            expect(source).toMatch(/\.summary-part\s*\{[^}]*white-space:\s*nowrap/)
            expect(source).not.toMatch(/\.budget-summary\s*\{[^}]*white-space:\s*nowrap/)
            expect(source).toMatch(/\.preset-controls\s*\{[^}]*flex-wrap:\s*wrap/)
            expect(source).toMatch(/\.preset-controls select\s*\{[^}]*max-width:/)
            // A spanning summary inside a max-content grid track used to push the select out of the field.
            expect(source).not.toMatch(/\.preset-field\s*\{[^}]*max-content/)
        })

        test('follows the pinned bot target and stays disabled without a chat', async () => {
            const chat = chatWithLongMessages()
            const character: { risuBardPinnedSettings?: RisuBardChatSettings } = { risuBardPinnedSettings: { risuBardResponseMessageCount: 4 } }
            mounted = mount(RisuBardCurrentChatSettings, { target: document.body, props: { chat, global: {}, character } })
            await choose('economy')
            expect(character.risuBardPinnedSettings).toMatchObject({ risuBardInquiryMaximumTokenBudget: 5500, risuBardDynamicMemoryMode: 'economy' })
            expect(chat.risuBardSettings!.risuBardInquiryMaximumTokenBudget).toBeUndefined()
            await unmount(mounted)
            mounted = mount(RisuBardCurrentChatSettings, { target: document.body, props: { global: {} } })
            expect(document.querySelector<HTMLSelectElement>('#bardwiki-memory-budget')!.disabled).toBe(true)
        })
    })

    test('gives every visible option contextual help without step validation hints', () => {
        const chat = chatWithLongMessages()
        mounted = mount(RisuBardCurrentChatSettings, {
            target: document.body,
            props: { chat, global: {} },
        })

        const fields = [...document.querySelectorAll('[data-chat-setting-field]')]
        const helpButtons = [...document.querySelectorAll('[data-chat-setting-help]')]
        expect(fields).toHaveLength(16)
        expect(document.querySelector('#bardwiki-ignore-ooc')).toBeNull()
        expect(helpButtons).toHaveLength(fields.length)
        expect(document.querySelector(
            '[data-chat-setting-field="risuBardAnalysisExcludeUserMessages"]'
        )).not.toBeNull()
        expect(document.querySelector<HTMLSelectElement>(
            '[data-chat-setting-field="risuBardBardChanModelMode"] select'
        )?.value).toBe('model')
        const responseHelp = helpButtons.find((button) =>
            button.getAttribute('data-chat-setting-help')
                === 'risuBardResponseMessageCount'
        )
        expect(responseHelp?.getAttribute('data-help-text')).toContain('2~3개')
        for (const input of document.querySelectorAll('input[type="number"]')) {
            expect(input.hasAttribute('step')).toBe(false)
        }
    })

    test('uses a compact container-responsive grid and a resizable popover', () => {
        const settingsSource = readFileSync(resolve(
            process.cwd(), 'src/lib/Others/RisuBardCurrentChatSettings.svelte'
        ), 'utf8')
        const dockSource = readFileSync(resolve(
            process.cwd(), 'src/lib/Others/RisuBardMemoryWiki.svelte'
        ), 'utf8')

        expect(settingsSource).toMatch(
            /\.settings-grid\s*\{[^}]*grid-template-columns:\s*repeat\(3,/s
        )
        expect(settingsSource).toMatch(
            /@container\s+chat-settings\s*\(max-width:\s*48rem\)[\s\S]*repeat\(2,/s
        )
        expect(settingsSource).toMatch(
            /@container\s+chat-settings\s*\(max-width:\s*31rem\)[\s\S]*grid-template-columns:\s*1fr/s
        )
        expect(settingsSource).not.toMatch(/\.setting-field\s*\{[^}]*min-height:\s*4\.6rem/s)
        expect(dockSource).toMatch(
            /<ManagerResizeHandles[\s\S]*rightAnchored/s
        )
        expect(dockSource).toMatch(
            /<ManagerResizeHandles[\s\S]*shadowPreview/s
        )
        expect(dockSource).toMatch(
            /\.settings-popover\s*\{[^}]*width:\s*var\(--manager-width,\s*58rem\)/s
        )
    })
})
