// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, tick, unmount } from 'svelte'
import { DBState } from 'src/ts/stores.svelte'
import { detectMemoryBudgetPreset } from 'src/ts/risubard/memoryBudgetPreset'
import { resolveRisuBardChatSettings } from 'src/ts/risubard/risuBardSettings'
import { memoryBudgetPresetUi } from 'src/ts/setting/memoryBudgetPresetUi.svelte'
import RisuBardMemoryBudgetPreset from './RisuBardMemoryBudgetPreset.svelte'

vi.mock('src/ts/alert', () => ({ alertMd: vi.fn() }))
vi.mock('src/ts/stores.svelte', () => ({ DBState: { db: {} } }))

let mounted: ReturnType<typeof mount> | undefined
const db = () => DBState.db as unknown as Record<string, unknown>
const select = () => document.querySelector<HTMLSelectElement>('#risubard-memory-budget-preset')!
const summary = () => document.querySelector('#risubard-memory-budget-summary')?.textContent?.trim()
const choose = async (value: string) => {
    select().value = value
    select().dispatchEvent(new Event('change', { bubbles: true }))
    await tick()
}
const open = () => { mounted = mount(RisuBardMemoryBudgetPreset, { target: document.body }) }

beforeEach(() => {
    for (const key of Object.keys(db())) delete db()[key]
    memoryBudgetPresetUi.customOpen = false
})
afterEach(async () => {
    if (mounted) await unmount(mounted)
    mounted = undefined
    document.body.replaceChildren()
})

describe('global memory budget preset control', () => {
    it('shows the standard tier for an untouched database, with a summary and a help button', () => {
        open()
        expect([...select().options].map((option) => option.textContent)).toEqual(['Economy', 'Standard', 'Generous', 'Custom'])
        expect(select().value).toBe('standard')
        expect(summary()).toBe('Search target 4,000 / events 3,000 / per source 2,000 / maximum 7,500 / dynamic limit Economy')
        const parts = [...document.querySelectorAll('#risubard-memory-budget-summary span')]
        expect(parts.map((part) => part.textContent)).toEqual(['Search target 4,000', 'events 3,000', 'per source 2,000', 'maximum 7,500', 'dynamic limit Economy'])
        expect(parts.every((part) => part.classList.contains('whitespace-nowrap'))).toBe(true)
        expect(document.querySelector('#risubard-memory-budget-summary')?.classList.contains('whitespace-nowrap')).toBe(false)
        expect(document.querySelector('label[for="risubard-memory-budget-preset"]')?.textContent).toBe('Memory budget')
        expect(document.querySelector('[data-setting-id="risubard.chat.memoryBudgetPreset"] button[title]')).not.toBeNull()
    })

    it('writes the six tier values to the global database and leaves the other settings alone', async () => {
        db().risuBardAnalysisTokenLimit = 9000
        db().risuBardInquiryTimeoutMs = 5000
        open()
        await choose('generous')
        expect(db()).toEqual({
            risuBardAnalysisTokenLimit: 9000,
            risuBardInquiryTimeoutMs: 5000,
            risuBardInquiryTargetTokenBudget: 6000,
            risuBardInquiryEventTokenBudget: 4000,
            risuBardInquirySourceTokenBudget: 2500,
            risuBardInquiryMaximumTokenBudget: 10500,
            risuBardDynamicMemoryMode: 'balanced',
            risuBardDynamicMemoryMaximumTokens: 16000,
        })
        expect(detectMemoryBudgetPreset(resolveRisuBardChatSettings(DBState.db as never))).toBe('generous')
        expect(memoryBudgetPresetUi.customOpen).toBe(false)
    })

    it('keeps the entries open after choosing custom without changing any value, and a tier closes them again', async () => {
        open()
        await choose('custom')
        expect(memoryBudgetPresetUi.customOpen).toBe(true)
        expect(db()).toEqual({})
        expect(select().value).toBe('custom')
        expect(summary()).toBeUndefined()
        await choose('economy')
        expect(memoryBudgetPresetUi.customOpen).toBe(false)
        expect(db().risuBardInquiryMaximumTokenBudget).toBe(5500)
    })

    it('shows custom for stored values that match no tier', () => {
        db().risuBardInquiryTargetTokenBudget = 3500
        open()
        expect(select().value).toBe('custom')
        expect(summary()).toBeUndefined()
    })
})
