// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { mount, unmount } from 'svelte'
import RisuBardSaveSlotsDialog from './RisuBardSaveSlotsDialog.svelte'
import type { MemorySaveSlotSummary } from 'src/ts/risubard/memorySaveSlots'

const mocks = vi.hoisted(() => ({
    listMemorySaveSlots: vi.fn(),
    previewMemorySaveSlot: vi.fn(),
    renameMemorySaveSlot: vi.fn(),
    deleteMemorySaveSlot: vi.fn(),
    alertConfirm: vi.fn(),
    alertInput: vi.fn(),
    createAuth: vi.fn(async () => 'auth'),
}))

vi.mock('src/ts/risubard/memorySaveSlots', () => ({
    listMemorySaveSlots: mocks.listMemorySaveSlots,
    previewMemorySaveSlot: mocks.previewMemorySaveSlot,
    renameMemorySaveSlot: mocks.renameMemorySaveSlot,
    deleteMemorySaveSlot: mocks.deleteMemorySaveSlot,
    shouldConfirmMemorySaveLoad: (currentLatestMessageId: string, slots: Array<{ latestMessageId?: string }>) =>
        currentLatestMessageId !== slots[0]?.latestMessageId,
}))
vi.mock('src/ts/alert', () => ({
    alertConfirm: mocks.alertConfirm,
    alertInput: mocks.alertInput,
}))
vi.mock('src/ts/globalApi.svelte', () => ({
    forageStorage: { createAuth: mocks.createAuth },
    downloadFile: vi.fn(),
    saveAsset: vi.fn(),
}))

let mounted: ReturnType<typeof mount> | undefined

describe('RisuBardSaveSlotsDialog', () => {
    beforeEach(() => {
        localStorage.clear()
        mocks.listMemorySaveSlots.mockReset().mockResolvedValue([{
            saveId: 'save-1', sourceChatId: 'chat-1',
            sourceChatName: '성문 앞',
            createdAt: '2026-08-14T08:00:00.000Z', turnCount: 7,
            latestMessageId: 'assistant-1',
            latestEvent: {
                title: '성문이 열렸다',
                excerpt: '경비병이 일행의 통행을 허락했다.',
            },
        }])
        mocks.previewMemorySaveSlot.mockReset().mockResolvedValue([
            { role: 'user', data: '문을 연다.' },
            { role: 'char', data: '성문이 열렸다.' },
        ])
        mocks.alertConfirm.mockReset().mockResolvedValue(true)
        mocks.alertInput.mockReset()
        mocks.renameMemorySaveSlot.mockReset()
    })
    afterEach(async () => {
        if (mounted) await unmount(mounted)
        mounted = undefined
        document.body.replaceChildren()
    })

    function render(onLoad = vi.fn(async () => undefined), saveProps: {
        mode?: 'save' | 'load'
        onSave?: (saveId?: string, overwrite?: boolean) => Promise<MemorySaveSlotSummary>
    } = {}) {
        const target = document.body.appendChild(document.createElement('div'))
        mounted = mount(RisuBardSaveSlotsDialog, {
            target,
            props: {
                open: true,
                characterId: 'character',
                characterName: '기사',
                currentChatId: 'chat-1',
                currentChatName: '성문 앞',
                currentLatestMessageId: 'unsaved-message',
                onOpenChange: vi.fn(),
                onLoad,
                ...saveProps,
            },
        })
        return onLoad
    }

    test('shows character/chat context without repeating the current chat name in a save card', async () => {
        render()

        await vi.waitFor(() => expect(document.body.textContent)
            .toContain('기사/성문 앞'))
        expect(document.body.textContent).toContain('2026')
        expect(document.body.querySelector('[data-save-file-grid]')?.textContent).not.toContain('성문 앞')
        expect(document.body.textContent).toContain('TURN 7')
        expect(document.body.textContent).toContain("'SAVE 01' 최근 대화")
        expect(document.body.textContent).not.toContain('채팅 저장하기')
        expect(document.body.textContent).not.toContain('채팅 불러오기')
        await vi.waitFor(() => expect(document.body.textContent)
            .toContain('성문이 열렸다.'))
        expect(document.body.querySelector('[data-save-file-load]')
            ?.className).toContain('save-slot__action')
        expect(document.body.querySelector('[data-save-file-new]')).toBeNull()
    })

    test('renames a manual save from the edit button inside its card', async () => {
        mocks.alertInput.mockResolvedValue('성문 돌파 직전')
        mocks.renameMemorySaveSlot.mockResolvedValue({
            saveId: 'save-1', sourceChatId: 'chat-1',
            sourceChatName: '성문 돌파 직전',
            createdAt: '2026-08-14T08:00:00.000Z', turnCount: 7,
            latestMessageId: 'assistant-1',
        })
        render()

        await vi.waitFor(() => expect(document.body.textContent).toContain('SAVE 01'))
        const manualCard = document.body.querySelector('[data-save-slot-kind="manual"]')
        const rename = manualCard?.querySelector<HTMLButtonElement>('[data-save-file-rename]')
        expect(rename).not.toBeNull()
        expect(rename?.className).toContain('save-slot__rename')
        expect(document.body.querySelector('.save-ledger__toolbar > [data-save-file-rename]')).toBeNull()

        rename!.click()

        await vi.waitFor(() => expect(mocks.alertInput).toHaveBeenCalledWith(
            '저장된 파일 이름 변경', [], '성문 앞'
        ))
        await vi.waitFor(() => expect(mocks.renameMemorySaveSlot).toHaveBeenCalledWith(
            expect.objectContaining({
                characterId: 'character',
                saveId: 'save-1',
                name: '성문 돌파 직전',
            })
        ))
        await vi.waitFor(() => expect(manualCard?.textContent).toContain('성문 돌파 직전'))
    })

    test.each(['save', 'load'] as const)('switches both ways from %s without losing the selected preview or writing data', async (initialMode) => {
        const onSave = vi.fn(async () => ({
            saveId: 'save-1', sourceChatId: 'chat-1', sourceChatName: '성문 앞',
            createdAt: '2026-08-26T08:00:00.000Z', turnCount: 8,
        }))
        const onLoad = render(undefined, { mode: initialMode, onSave })
        await vi.waitFor(() => expect(document.body.textContent).toContain('성문이 열렸다.'))
        const switcher = document.body.querySelector('[data-save-mode-switcher]')
        expect(switcher).not.toBeNull()
        const dialog = document.body.querySelector('[role="dialog"]')!
        const title = document.getElementById(dialog.getAttribute('aria-labelledby')!)!
        expect(title.textContent).toBe('채팅 저장 및 불러오기')
        expect(document.body.querySelector('[data-save-dialog-context]')?.textContent).toBe('기사/성문 앞')

        const otherMode = initialMode === 'save' ? 'load' : 'save'
        for (const nextMode of [otherMode, initialMode]) {
            document.body.querySelector<HTMLButtonElement>(`[data-save-mode="${nextMode}"]`)!.click()
            await vi.waitFor(() => expect(document.body.querySelector(`[data-save-mode="${nextMode}"]`)?.getAttribute('aria-pressed')).toBe('true'))
            for (const mode of ['save', 'load']) {
                expect(document.body.querySelector(`[data-save-mode="${mode}"]`)
                    ?.getAttribute('aria-pressed')).toBe(String(mode === nextMode))
            }
            expect(document.body.querySelector(nextMode === 'save'
                ? '[data-save-file-overwrite]' : '[data-save-file-load]')).not.toBeNull()
            expect(document.body.querySelector('.save-slot__select[aria-pressed="true"]')
                ?.textContent).toContain('SAVE 01')
            expect(document.body.querySelector('[data-save-file-preview]')
                ?.textContent).toContain('성문이 열렸다.')
        }
        expect(onSave).not.toHaveBeenCalled()
        expect(onLoad).not.toHaveBeenCalled()
        expect(mocks.listMemorySaveSlots).toHaveBeenCalledOnce()
        expect(mocks.previewMemorySaveSlot).toHaveBeenCalledOnce()
    })

    test('disables save mode when the caller cannot save', async () => {
        render()
        await vi.waitFor(() => expect(document.body.querySelector('[data-save-mode="save"]')).not.toBeNull())
        expect(document.body.querySelector<HTMLButtonElement>('[data-save-mode="save"]')!.disabled).toBe(true)
        expect(document.body.querySelector<HTMLButtonElement>('[data-save-mode="load"]')!.disabled).toBe(false)
    })

    test('keeps autosaves in a one-row strip and quicksave first in the regular grid', async () => {
        mocks.listMemorySaveSlots.mockResolvedValue([
            {
                saveId: 'manual-1', sourceChatId: 'chat-1', sourceChatName: '성문 앞',
                createdAt: '2026-08-14T08:00:00.000Z', turnCount: 7,
            },
            {
                saveId: '__risubard_auto__chat-1__0', sourceChatId: 'chat-1', sourceChatName: '성문 앞',
                createdAt: '2026-08-14T09:00:00.000Z', turnCount: 6,
            },
            {
                saveId: '__risubard_quick__chat-1', sourceChatId: 'chat-1', sourceChatName: '성문 앞',
                createdAt: '2026-08-14T10:00:00.000Z', turnCount: 8,
            },
        ])
        render()

        await vi.waitFor(() => expect(document.body.querySelector('[data-autosave-strip] [data-save-slot-kind="auto"]')).not.toBeNull())
        const grid = document.body.querySelector('[data-save-file-grid]')!
        expect(grid.firstElementChild?.getAttribute('data-save-slot-kind')).toBe('quick')
        expect(grid.querySelector('[data-save-slot-kind="manual"]')).not.toBeNull()
        expect(document.body.querySelector('[data-autosave-strip]')?.textContent).toContain('AUTO 1')
    })

    test('opens save mode without saving and creates a slot from an empty list', async () => {
        mocks.listMemorySaveSlots.mockResolvedValue([])
        const onSave = vi.fn(async () => ({
            saveId: 'new-save', sourceChatId: 'chat-1', sourceChatName: '새 저장',
            createdAt: '2026-08-26T08:00:00.000Z', turnCount: 8,
        }))
        render(undefined, { mode: 'save', onSave })
        await vi.waitFor(() => expect(document.body.textContent).toContain('클릭하여 생성'))
        expect(onSave).not.toHaveBeenCalled()
        const button = document.body.querySelector<HTMLButtonElement>('[data-save-file-new]')
        expect(button).not.toBeNull()
        button!.click()
        await vi.waitFor(() => expect(onSave).toHaveBeenCalledWith(undefined, false))
        await vi.waitFor(() => expect(document.body.textContent).toContain('새 저장'))
        expect(document.body.querySelectorAll('.save-slot')).toHaveLength(3)
        expect(mocks.alertConfirm).not.toHaveBeenCalled()
    })

    test('confirms overwrite, keeps one slot, and refreshes its preview', async () => {
        const onSave = vi.fn(async () => ({
            saveId: 'save-1', sourceChatId: 'chat-1', sourceChatName: '성문 앞',
            createdAt: '2026-08-26T08:00:00.000Z', turnCount: 8,
        }))
        render(undefined, { mode: 'save', onSave })
        await vi.waitFor(() => expect(document.body.textContent).toContain('성문이 열렸다.'))
        const overwrite = document.body.querySelector<HTMLButtonElement>('[aria-label="SAVE 01 덮어쓰기"]')
        expect(overwrite).not.toBeNull()
        expect(document.body.querySelector('[data-save-file-load]')).toBeNull()
        mocks.alertConfirm.mockResolvedValueOnce(false)
        overwrite!.click()
        await vi.waitFor(() => expect(mocks.alertConfirm).toHaveBeenCalledOnce())
        await vi.waitFor(() => expect(overwrite!.disabled).toBe(false))
        expect(onSave).not.toHaveBeenCalled()
        mocks.previewMemorySaveSlot.mockResolvedValue([{ role: 'char', data: '새로운 장면' }])
        overwrite!.click()
        await vi.waitFor(() => expect(onSave).toHaveBeenCalledWith('save-1', true))
        await vi.waitFor(() => expect(document.body.textContent).toContain('새로운 장면'))
        expect(document.body.querySelectorAll('.save-slot')).toHaveLength(3)
        expect(document.body.textContent).toContain('TURN 8')
    })

    test('blocks duplicate saves and preserves the list on save failure', async () => {
        let rejectSave!: (reason: Error) => void
        const onSave = vi.fn(() => new Promise<MemorySaveSlotSummary>((_resolve, reject) => {
            rejectSave = reject
        }))
        render(undefined, { mode: 'save', onSave })
        await vi.waitFor(() => expect(document.body.textContent).toContain('SAVE 01'))
        const button = document.body.querySelector<HTMLButtonElement>('[data-save-file-new]')
        expect(button).not.toBeNull()
        button!.click()
        button!.click()
        await vi.waitFor(() => expect(onSave).toHaveBeenCalledOnce())
        for (const selector of ['[data-save-file-new]', '[data-save-file-overwrite]', '[data-save-file-rename]', '[data-save-file-delete]', '[data-save-mode="save"]', '[data-save-mode="load"]']) {
            expect(document.body.querySelector<HTMLButtonElement>(selector)?.disabled).toBe(true)
        }
        rejectSave(new Error('저장 실패 테스트'))
        await vi.waitFor(() => expect(document.body.textContent).toContain('저장 실패 테스트'))
        expect(document.body.querySelectorAll('.save-slot')).toHaveLength(3)
        expect(document.body.textContent).toContain('TURN 7')
        expect(button!.disabled).toBe(false)
    })

    test('adjusts the file and preview distribution from the separator', async () => {
        render()
        await vi.waitFor(() => expect(document.body.querySelector(
            '[data-preview-resize-handle]'
        )).not.toBeNull())
        const separator = document.body.querySelector<HTMLElement>(
            '[data-preview-resize-handle]'
        )!

        expect(separator.getAttribute('aria-valuenow')).toBe('38')
        separator.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'ArrowUp', bubbles: true,
        }))

        await vi.waitFor(() => expect(
            separator.getAttribute('aria-valuenow')
        ).toBe('43'))
    })

    test('loads the selected immutable slot', async () => {
        const onLoad = render()
        await vi.waitFor(() => expect(document.body.querySelector(
            '[aria-label="SAVE 01 불러오기"]'
        )).not.toBeNull())
        document.body.querySelector<HTMLButtonElement>(
            '[aria-label="SAVE 01 불러오기"]'
        )!.click()

        await vi.waitFor(() => expect(mocks.alertConfirm).toHaveBeenCalledWith(
            '저장하지 않은 채팅은 사라집니다. 불러올까요?',
            { tier: 'top' },
        ))
        await vi.waitFor(() => expect(onLoad).toHaveBeenCalledWith('save-1', false))
    })

    test('keeps the load control idle while the nested overwrite confirmation is open', async () => {
        let resolveConfirmation!: (confirmed: boolean) => void
        mocks.alertConfirm.mockImplementationOnce(() => new Promise<boolean>((resolve) => {
            resolveConfirmation = resolve
        }))
        const onLoad = render()
        await vi.waitFor(() => expect(document.body.querySelector(
            '[aria-label="SAVE 01 불러오기"]'
        )).not.toBeNull())
        const loadButton = document.body.querySelector<HTMLButtonElement>(
            '[aria-label="SAVE 01 불러오기"]'
        )!

        loadButton.click()

        await vi.waitFor(() => expect(mocks.alertConfirm).toHaveBeenCalledWith(
            '저장하지 않은 채팅은 사라집니다. 불러올까요?',
            { tier: 'top' },
        ))
        expect(loadButton.disabled).toBe(false)
        expect(loadButton.querySelector('.animate-spin')).toBeNull()
        expect(onLoad).not.toHaveBeenCalled()

        resolveConfirmation(true)
        await vi.waitFor(() => expect(onLoad).toHaveBeenCalledWith('save-1', false))
    })

    test('loads a save into a new chat without warning about overwriting the current chat', async () => {
        const onLoad = render()
        await vi.waitFor(() => expect(document.body.textContent).toContain('SAVE 01'))
        const newChatOption = document.body.querySelector<HTMLInputElement>(
            'input[alt="새 챗으로 불러오기"]'
        )
        expect(newChatOption).not.toBeNull()
        newChatOption!.click()
        document.body.querySelector<HTMLButtonElement>(
            '[aria-label="SAVE 01 불러오기"]'
        )!.click()

        await vi.waitFor(() => expect(onLoad).toHaveBeenCalledWith('save-1', true))
        expect(mocks.alertConfirm).not.toHaveBeenCalled()
    })

    test('skips confirmation when the newest save matches the current story', async () => {
        const target = document.body.appendChild(document.createElement('div'))
        const onLoad = vi.fn(async () => undefined)
        mounted = mount(RisuBardSaveSlotsDialog, {
            target,
            props: {
                open: true,
                characterId: 'character',
                characterName: '기사',
                currentChatId: 'chat-1',
                currentChatName: '성문 앞',
                currentLatestMessageId: 'assistant-1',
                onOpenChange: vi.fn(),
                onLoad,
            },
        })
        await vi.waitFor(() => expect(document.body.querySelector(
            '[aria-label="SAVE 01 불러오기"]'
        )).not.toBeNull())
        document.body.querySelector<HTMLButtonElement>(
            '[aria-label="SAVE 01 불러오기"]'
        )!.click()

        await vi.waitFor(() => expect(onLoad).toHaveBeenCalledWith('save-1', false))
        expect(mocks.alertConfirm).not.toHaveBeenCalled()
    })
})
