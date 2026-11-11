// @vitest-environment happy-dom

import { afterEach, describe, expect, test, vi } from 'vitest'
import { mount, tick, unmount } from 'svelte'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Chat } from 'src/ts/storage/database.svelte'
import { resolveRisuBardChatSettings, type RisuBardChatSettings } from 'src/ts/risubard/risuBardSettings'
import RisuBardCurrentChatSettings from './RisuBardCurrentChatSettings.svelte'

const alertMocks = vi.hoisted(() => ({ alertConfirm: vi.fn(async (_message: string) => true) }))
vi.mock('src/ts/alert', () => ({ alertConfirm: alertMocks.alertConfirm }))

let mounted: ReturnType<typeof mount> | undefined

afterEach(async () => {
    vi.useRealTimers()
    alertMocks.alertConfirm.mockReset()
    alertMocks.alertConfirm.mockResolvedValue(true)
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
            risuBardModelMode: 'model',
            showRequestStatus: false,
        },
    }
}

describe('RisuBardCurrentChatSettings', () => {
    test.each([
        ['bardwiki-maximum-tokens', 'risuBardInquiryMaximumTokenBudget', '7500', '8213'],
        ['bardwiki-analysis-tokens', 'risuBardAnalysisTokenLimit', '32768', '35881'],
    ] as const)('%s keeps the baseline in the input and shows its dynamic limit separately', async (id, key, base, effective) => {
        const chat = chatWithLongMessages()
        chat.message = [{ role: 'char', data: '가'.repeat(50_000) }]
        chat.risuBardSettings = { risuBardDynamicMemoryMode: 'balanced' }
        mounted = mount(RisuBardCurrentChatSettings, { target: document.body, props: { chat, global: { risuBardWikiSettingsView: 'advanced' } } })
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
        const global: RisuBardChatSettings & { risuBardWikiSettingsView?: 'simple' | 'advanced' } = { risuBardWikiSettingsView: 'advanced' }
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
        const global: RisuBardChatSettings & { risuBardWikiSettingsView?: 'simple' | 'advanced' } = { risuBardWikiSettingsView: 'advanced' }
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
        expect(document.querySelector<HTMLInputElement>('#bardwiki-analysis-tokens')?.value).toBe('32768')
        expect(document.querySelector('#bardwiki-analysis-tokens-dynamic')?.textContent).toContain('49,152')
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
        mounted = mount(RisuBardCurrentChatSettings, {target: document.body, props: {chat, global: { risuBardWikiSettingsView: 'advanced' }}})
        const input = document.querySelector<HTMLInputElement>('#bardwiki-analysis-tokens')!
        const description = () => document.querySelector('#bardwiki-analysis-tokens-dynamic')!.textContent
        expect(input.value).toBe('32768')
        expect(description()).toContain('65,536')
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
        mounted = mount(RisuBardCurrentChatSettings, {target: document.body, props: {chat: saved, global: { risuBardWikiSettingsView: 'advanced' }}})
        expect(document.querySelector<HTMLInputElement>('#bardwiki-analysis-tokens')!.value).toBe('3072')
        expect(description()).toContain('6,144')
    })
    test('keeps ordinary analysis input unchanged when dynamic memory is off', async () => {
        const chat = chatWithLongMessages()
        chat.risuBardSettings!.risuBardDynamicMemoryMode = 'off'
        mounted = mount(RisuBardCurrentChatSettings, {target: document.body, props: {chat, global: { risuBardWikiSettingsView: 'advanced' }}})
        const input = document.querySelector<HTMLInputElement>('#bardwiki-analysis-tokens')!
        expect(input.value).toBe('32768')
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
        const global: RisuBardChatSettings & { risuBardWikiSettingsView?: 'simple' | 'advanced' } = { risuBardWikiSettingsView: 'advanced', risuBardResponseMessageCount: 12 }
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
        const global: RisuBardChatSettings & { risuBardWikiSettingsView?: 'simple' | 'advanced' } = {
            risuBardWikiSettingsView: 'advanced',
            risuBardResponseMessageCount: 12,
            risuBardModelMode: 'memory',
            showRequestStatus: true,
        }
        mounted = mount(RisuBardCurrentChatSettings, {
            target: document.body,
            props: { chat, global },
        })

        const apply = document.querySelector<HTMLButtonElement>('[data-apply-chat-settings-global]')!
        expect(apply.disabled).toBe(false)
        alertMocks.alertConfirm.mockResolvedValueOnce(false)
        apply.click()
        await vi.waitFor(() => expect(alertMocks.alertConfirm).toHaveBeenCalledWith('모든 봇의 기본값이 지금 값으로 바뀝니다. 계속할까요?'))
        await tick()
        expect(global.risuBardResponseMessageCount).toBe(12)
        expect(chat.risuBardSettings?.risuBardResponseMessageCount).toBe(4)

        apply.click()
        await vi.waitFor(() => expect(global.risuBardResponseMessageCount).toBe(4))
        expect(global.risuBardModelMode).toBe('model')
        expect(global.showRequestStatus).toBe(false)
        expect(chat.risuBardSettings).toBeUndefined()
        await tick()
        expect(apply.disabled).toBe(true)
    })

    test('disables applying to global when the current values already equal global', () => {
        const chat = chatWithLongMessages()
        chat.risuBardSettings = { risuBardResponseMessageCount: 12 }
        mounted = mount(RisuBardCurrentChatSettings, {
            target: document.body,
            props: { chat, global: { risuBardWikiSettingsView: 'advanced', risuBardResponseMessageCount: 12 } },
        })
        expect(document.querySelector<HTMLButtonElement>('[data-apply-chat-settings-global]')!.disabled).toBe(true)
    })

    test('names the save scope in the title and a visible line, unpinned and pinned', async () => {
        const chat = chatWithLongMessages()
        const character: { risuBardPinnedSettings?: RisuBardChatSettings } = {}
        mounted = mount(RisuBardCurrentChatSettings, { target: document.body, props: { chat, global: { risuBardWikiSettingsView: 'advanced' }, character } })
        const title = () => document.querySelector('.settings-title strong')?.textContent?.trim()
        const scope = () => document.querySelector('[data-chat-settings-scope]')?.textContent?.trim()
        expect(title()).toBe('이 챗 설정')
        expect(scope()).toContain('바꾼 값은 이 챗에만 저장됩니다.')
        expect(document.querySelector('[data-reset-chat-settings-global]')?.textContent?.trim()).toBe('전역값 사용')
        document.querySelector<HTMLInputElement>('[data-pin-chat-settings-character]')!.click()
        await tick()
        expect(title()).toBe('이 봇의 모든 챗 설정 (고정)')
        expect(scope()).toContain('바꾼 값은 이 봇의 모든 챗에 저장됩니다.')
        expect(document.querySelector('[data-reset-chat-settings-global]')?.textContent?.trim()).toBe('고정 풀고 전역값 따르기')
    })

    test('unpinning to global removes the pin and the chat overrides so the chat follows global', async () => {
        const chat = chatWithLongMessages()
        const character: { risuBardPinnedSettings?: RisuBardChatSettings } = { risuBardPinnedSettings: { risuBardResponseMessageCount: 3 } }
        const global: RisuBardChatSettings & { risuBardWikiSettingsView?: 'simple' | 'advanced' } = { risuBardWikiSettingsView: 'advanced', risuBardResponseMessageCount: 12 }
        mounted = mount(RisuBardCurrentChatSettings, { target: document.body, props: { chat, global, character } })
        expect(document.querySelector<HTMLInputElement>('#bardwiki-response-messages')!.value).toBe('3')
        document.querySelector<HTMLButtonElement>('[data-reset-chat-settings-global]')!.click()
        await tick()
        expect(character.risuBardPinnedSettings).toBeUndefined()
        expect(chat.risuBardSettings).toBeUndefined()
        expect(global).toEqual({ risuBardWikiSettingsView: 'advanced', risuBardResponseMessageCount: 12 })
        expect(document.querySelector<HTMLInputElement>('[data-pin-chat-settings-character]')!.checked).toBe(false)
        expect(document.querySelector<HTMLInputElement>('#bardwiki-response-messages')!.value).toBe('12')
        expect(document.querySelector('.settings-title strong')?.textContent?.trim()).toBe('이 챗 설정')
    })

    test('using global without a pin drops only the chat overrides', async () => {
        const chat = chatWithLongMessages()
        mounted = mount(RisuBardCurrentChatSettings, { target: document.body, props: { chat, global: { risuBardWikiSettingsView: 'advanced' } } })
        document.querySelector<HTMLButtonElement>('[data-reset-chat-settings-global]')!.click()
        await tick()
        expect(chat.risuBardSettings).toBeUndefined()
        expect(document.querySelector<HTMLButtonElement>('[data-reset-chat-settings-global]')!.disabled).toBe(true)
    })

    test.each([
        ['bardwiki-response-exclude-user', 'risuBardResponseExcludeUserMessages', '답변에 사용자 메시지 넣기'],
        ['bardwiki-analysis-exclude-user', 'risuBardAnalysisExcludeUserMessages', '분석에 사용자 메시지 넣기'],
    ] as const)('%s is checked when user messages are included and stores the inverted flag', async (id, key, label) => {
        const chat = chatWithLongMessages()
        mounted = mount(RisuBardCurrentChatSettings, { target: document.body, props: { chat, global: { risuBardWikiSettingsView: 'advanced' } } })
        const field = document.querySelector(`[data-chat-setting-field="${key}"]`)!
        const input = document.querySelector<HTMLInputElement>(`#${id}`)!
        expect(field.textContent).toContain(label)
        expect(input.checked).toBe(true)
        expect(field.querySelector('.toggle-control span')?.textContent).toBe('넣음')
        input.click()
        await tick()
        expect(chat.risuBardSettings![key]).toBe(true)
        expect(input.checked).toBe(false)
        expect(field.querySelector('.toggle-control span')?.textContent).toBe('뺌')
        input.click()
        await tick()
        expect(chat.risuBardSettings![key]).toBe(false)
        expect(input.checked).toBe(true)
        expect(field.querySelector('.toggle-control span')?.textContent).toBe('넣음')
    })

    test('stores the lorebook reference settings and disables them at zero tokens', async () => {
        const chat = chatWithLongMessages()
        mounted = mount(RisuBardCurrentChatSettings, { target: document.body, props: { chat, global: { risuBardWikiSettingsView: 'advanced' } } })
        const tokens = document.querySelector<HTMLInputElement>('#bardwiki-analysis-lore-tokens')!
        const always = document.querySelector<HTMLInputElement>('#bardwiki-analysis-lore-always')!
        const words = document.querySelector<HTMLTextAreaElement>('#bardwiki-analysis-lore-exclude')!
        expect(tokens.value).toBe('1000')
        expect(always.checked).toBe(false)
        expect(words.value).toBe('<img\n{{asset::\n{{img::\n{{image::')

        always.click()
        words.value = '에셋\n<img'
        words.dispatchEvent(new Event('change', { bubbles: true }))
        await tick()
        expect(chat.risuBardSettings).toMatchObject({
            risuBardAnalysisLoreIncludeAlwaysActive: true,
            risuBardAnalysisLoreExcludeWords: '에셋\n<img',
        })

        tokens.value = '0'
        tokens.dispatchEvent(new Event('change', { bubbles: true }))
        await tick()
        expect(chat.risuBardSettings!.risuBardAnalysisLoreTokenLimit).toBe(0)
        expect(always.disabled).toBe(true)
        expect(words.disabled).toBe(true)
    })

    describe('number inputs', () => {
        const change = async (selector: string, value: string) => {
            const input = document.querySelector<HTMLInputElement>(selector)!
            input.value = value
            input.dispatchEvent(new Event('change', { bubbles: true }))
            await tick()
            return input
        }
        const note = (key: string) => document.querySelector(`[data-number-note="${key}"]`)?.textContent?.trim()

        test('keeps the stored value for an empty input and writes it back', async () => {
            const chat = chatWithLongMessages()
            mounted = mount(RisuBardCurrentChatSettings, { target: document.body, props: { chat, global: { risuBardWikiSettingsView: 'advanced' } } })
            const input = await change('#bardwiki-response-messages', '')
            expect(chat.risuBardSettings!.risuBardResponseMessageCount).toBe(4)
            expect(input.value).toBe('4')
            expect(note('risuBardResponseMessageCount')).toContain('이전 값')
        })

        test('clamps out-of-range values, shows the range, and clears the note on the next edit or after 3 seconds', async () => {
            vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
            const chat = chatWithLongMessages()
            chat.risuBardSettings!.risuBardInquiryTimeoutMs = 5_000
            mounted = mount(RisuBardCurrentChatSettings, { target: document.body, props: { chat, global: { risuBardWikiSettingsView: 'advanced' } } })
            let input = await change('#bardwiki-timeout', '99999')
            expect(chat.risuBardSettings!.risuBardInquiryTimeoutMs).toBe(10_000)
            expect(input.value).toBe('10000')
            expect(note('risuBardInquiryTimeoutMs')).toBe('허용 범위(1~10,000)에 맞췄습니다.')
            input.dispatchEvent(new Event('input', { bubbles: true }))
            await tick()
            expect(note('risuBardInquiryTimeoutMs')).toBeUndefined()

            input = await change('#bardwiki-response-messages', '0')
            expect(chat.risuBardSettings!.risuBardResponseMessageCount).toBe(1)
            expect(input.value).toBe('1')
            expect(note('risuBardResponseMessageCount')).toBe('최솟값 1에 맞췄습니다.')
            vi.advanceTimersByTime(3_000)
            await tick()
            expect(note('risuBardResponseMessageCount')).toBeUndefined()

            input = await change('#bardwiki-history-limit', '40')
            expect(chat.risuBardSettings!.risuBardHistoricalSourceMatchLimit).toBe(32)
            expect(input.value).toBe('32')
            input = await change('#bardwiki-response-messages', '5')
            expect(chat.risuBardSettings!.risuBardResponseMessageCount).toBe(5)
            expect(note('risuBardResponseMessageCount')).toBeUndefined()
        })

        test('bounds budget fields by the search maximum and gives every number input min and max', async () => {
            const chat = chatWithLongMessages()
            chat.risuBardSettings!.risuBardDynamicMemoryMode = 'off'
            chat.risuBardSettings!.risuBardInquiryTargetTokenBudget = 3500
            mounted = mount(RisuBardCurrentChatSettings, { target: document.body, props: { chat, global: { risuBardWikiSettingsView: 'advanced' } } })
            const inputs = [...document.querySelectorAll<HTMLInputElement>('input[type="number"]')]
            expect(inputs.length).toBeGreaterThanOrEqual(11)
            for (const input of inputs) {
                expect(input.getAttribute('min'), input.id).toMatch(/^\d+$/)
                expect(input.getAttribute('max'), input.id).toMatch(/^\d+$/)
            }
            const target = document.querySelector<HTMLInputElement>('#bardwiki-target-tokens')!
            expect(target.max).toBe('7500')
            target.focus()
            await tick()
            target.value = '9000'
            target.dispatchEvent(new Event('input', { bubbles: true }))
            target.blur()
            await tick()
            expect(chat.risuBardSettings!.risuBardInquiryTargetTokenBudget).toBe(7500)
            expect(target.value).toBe('7500')
            expect(note('risuBardInquiryTargetTokenBudget')).toBe('허용 범위(256~7,500)에 맞췄습니다.')
        })
    })

    test('disables the whole form with a reason when no chat is open', () => {
        mounted = mount(RisuBardCurrentChatSettings, { target: document.body, props: { global: { risuBardWikiSettingsView: 'advanced' } } })
        const form = document.querySelector<HTMLFieldSetElement>('fieldset[data-chat-settings-form]')!
        expect(form.disabled).toBe(true)
        expect(document.querySelector('[data-chat-settings-disabled-reason]')?.textContent?.trim()).toBe('챗을 연 뒤 바꿀 수 있습니다.')
    })

    test.each([
        ['with a chat', true, false],
        ['for global dynamic defaults', false, true],
    ] as const)('keeps the form enabled %s', (_name, withChat, globalDynamicOnly) => {
        mounted = mount(RisuBardCurrentChatSettings, {
            target: document.body,
            props: { chat: withChat ? chatWithLongMessages() : undefined, global: { risuBardWikiSettingsView: 'advanced' }, globalDynamicOnly },
        })
        expect(document.querySelector<HTMLFieldSetElement>('fieldset[data-chat-settings-form]')!.disabled).toBe(false)
        expect(document.querySelector('[data-chat-settings-disabled-reason]')).toBeNull()
    })

    test('uses plain names for the count and limit fields', () => {
        mounted = mount(RisuBardCurrentChatSettings, { target: document.body, props: { chat: chatWithLongMessages(), global: { risuBardWikiSettingsView: 'advanced' } } })
        const fieldText = (key: string) => document.querySelector(`[data-chat-setting-field="${key}"] .setting-heading label`)?.textContent
        expect(fieldText('risuBardResponseMessageCount')).toBe('답변에 그대로 넣을 최근 응답 수')
        expect(fieldText('risuBardRecentMessageCount')).toBe('위키 분석이 읽을 최근 응답 수')
        expect(fieldText('risuBardCanonicalTargetLimit')).toBeUndefined()
        expect(fieldText('risuBardAdditionalSearchLimit')).toBe('근거 부족 시 다시 찾기 횟수')
        expect(fieldText('risuBardAnalysisTokenLimit')).toBe('위키 분석 최대 길이(토큰)')
        expect(document.body.textContent).not.toContain('·')
        expect(document.querySelector('[data-chat-setting-help="risuBardResponseMessageCount"]')?.getAttribute('data-help-text')).toContain('AI 응답 수')
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
            mounted = mount(RisuBardCurrentChatSettings, { target: document.body, props: { chat: chatWithLongMessages(), global: { risuBardWikiSettingsView: 'advanced' } } })
            const select = document.querySelector<HTMLSelectElement>('#bardwiki-memory-budget')!
            expect([...select.options].map(option => option.textContent)).toEqual(['절약', '보통', '넉넉', '사용자 지정'])
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
            expect(help.getAttribute('data-help-text')).toContain('사용자 지정')
        })

        test('writes the six tier values to the chat, keeps 커스텀 open without changing them, and tiers close it again', async () => {
            const chat = chatWithLongMessages()
            const global: RisuBardChatSettings & { risuBardWikiSettingsView?: 'simple' | 'advanced' } = { risuBardWikiSettingsView: 'advanced' }
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
            expect(global).toEqual({ risuBardWikiSettingsView: 'advanced' })
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
            mounted = mount(RisuBardCurrentChatSettings, { target: document.body, props: { chat, global: { risuBardWikiSettingsView: 'advanced' } } })
            expect(document.querySelector<HTMLSelectElement>('#bardwiki-memory-budget')!.value).toBe('custom')
            expect(summary()).toBeUndefined()
            expect(document.querySelector<HTMLInputElement>('#bardwiki-target-tokens')!.value).toBe('3500')
            await choose('standard')
            const saved = JSON.parse(JSON.stringify(chat))
            await unmount(mounted)
            mounted = mount(RisuBardCurrentChatSettings, { target: document.body, props: { chat: saved, global: { risuBardWikiSettingsView: 'advanced' } } })
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
            mounted = mount(RisuBardCurrentChatSettings, { target: document.body, props: { chat, global: { risuBardWikiSettingsView: 'advanced' }, character } })
            await choose('economy')
            expect(character.risuBardPinnedSettings).toMatchObject({ risuBardInquiryMaximumTokenBudget: 5500, risuBardDynamicMemoryMode: 'economy' })
            expect(chat.risuBardSettings!.risuBardInquiryMaximumTokenBudget).toBeUndefined()
            await unmount(mounted)
            mounted = mount(RisuBardCurrentChatSettings, { target: document.body, props: { global: { risuBardWikiSettingsView: 'advanced' } } })
            expect(document.querySelector<HTMLSelectElement>('#bardwiki-memory-budget')!.disabled).toBe(true)
        })
    })

    test('the simple view shows the work scale, model, source rerank and language and writes a scale to the chat', async () => {
        const chat = chatWithLongMessages()
        chat.risuBardSettings = {}
        const global: RisuBardChatSettings & { risuBardWikiSettingsView?: 'simple' | 'advanced' } = {}
        mounted = mount(RisuBardCurrentChatSettings, { target: document.body, props: { chat, global } })
        const fields = () => [...document.querySelectorAll<HTMLElement>('[data-chat-setting-field]')].map((field) => field.dataset.chatSettingField)
        expect(fields()).toEqual(['risuBardWikiScale', 'risuBardModelMode', 'risuBardSourceRerank', 'risuBardWikiWritingLanguage', 'risuBardMemoryBudgetPreset'])
        const scale = (value: string) => document.querySelector<HTMLInputElement>(`input[name="bardwiki-wiki-scale"][value="${value}"]`)!
        expect(scale('standard').checked).toBe(true)
        scale('large').click()
        await tick()
        expect(chat.risuBardSettings).toEqual({
            risuBardAnalysisTokenLimit: 65_536, risuBardAnalysisLoreTokenLimit: 2_000,
        })
        chat.risuBardSettings.risuBardAnalysisTokenLimit = 40_000
        document.querySelector<HTMLButtonElement>('[data-wiki-settings-view="advanced"]')!.click()
        await tick()
        expect(global.risuBardWikiSettingsView).toBe('advanced')
        expect(document.querySelector<HTMLInputElement>('#bardwiki-analysis-tokens')?.value).toBe('40000')
        document.querySelector<HTMLButtonElement>('[data-wiki-settings-view="simple"]')!.click()
        await tick()
        expect(document.querySelector('[data-wiki-scale-custom]')?.textContent).toContain('40,000')
        expect(document.querySelector('#bardwiki-analysis-tokens')).toBeNull()
    })

    test('applies the official recommended settings to this chat only', async () => {
        const chat = chatWithLongMessages()
        const global: RisuBardChatSettings = { risuBardSourceRerank: true }
        mounted = mount(RisuBardCurrentChatSettings, { target: document.body, props: { chat, global } })
        await tick()

        const apply = document.querySelector<HTMLButtonElement>('[data-apply-recommended-wiki-preset]')!
        expect(apply.disabled).toBe(false)
        apply.click()
        await tick()

        expect(chat.risuBardSettings).toMatchObject({
            risuBardAnalysisTurnInterval: 2,
        })
        expect(chat.risuBardSettings?.risuBardSourceRerank).toBeUndefined()
        expect(global.risuBardAnalysisTurnInterval).toBeUndefined()
        expect(apply.disabled).toBe(true)
        expect(document.querySelector('[data-recommended-wiki-preset]')?.getAttribute('data-matched')).toBe('true')
        expect(document.querySelector('[data-recommended-wiki-preset] [role="status"]')).not.toBeNull()
    })

    test('gives every visible option contextual help without step validation hints', () => {
        const chat = chatWithLongMessages()
        mounted = mount(RisuBardCurrentChatSettings, {
            target: document.body,
            props: { chat, global: { risuBardWikiSettingsView: 'advanced' } },
        })

        const fields = [...document.querySelectorAll('[data-chat-setting-field]')]
        const helpButtons = [...document.querySelectorAll('[data-chat-setting-help]')]
        expect(fields).toHaveLength(19)
        expect(document.querySelector('[data-chat-setting-field^="risuBardBardChan"]')).toBeNull()
        expect(document.querySelector('#bardwiki-ignore-ooc')).toBeNull()
        expect(helpButtons).toHaveLength(fields.length)
        expect(document.querySelector(
            '[data-chat-setting-field="risuBardAnalysisExcludeUserMessages"]'
        )).not.toBeNull()
        expect(document.querySelector<HTMLSelectElement>(
            '[data-chat-setting-field="risuBardModelMode"] select'
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
