// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { mount, tick, unmount } from 'svelte'
import { readFileSync } from 'node:fs'
import type { Database } from 'src/ts/storage/database.svelte'
import CharacterVaultDialog from './CharacterVaultDialog.svelte'

const mocks = vi.hoisted(() => ({
    db: {} as Database,
    requestImmediateSave: vi.fn(async () => undefined),
    trackChatForSave: vi.fn(),
    selectSingleFile: vi.fn(),
    saveAsset: vi.fn(async () => 'vault-cover'),
    getFileSrc: vi.fn(async () => 'vault-cover-src'),
    alertConfirm: vi.fn(async () => true),
    alertInput: vi.fn(async () => ''),
    selectedCharID: { set: vi.fn() },
    requiresFullEncoderReload: { state: false },
    forkMemoryWiki: vi.fn(async (input: { destinationChatId: string }) => ({
        mode: 'copy' as const,
        sourceExists: true,
        destinationChatId: input.destinationChatId,
        warnings: [],
        forkToken: `token-${input.destinationChatId}`,
    })),
    completeMemoryWikiFork: vi.fn(async (input: { action: 'finalize' | 'discard' }) => ({
        action: input.action,
        completed: true as const,
    })),
    createAuth: vi.fn(async () => 'auth'),
}))

vi.mock('src/ts/stores.svelte', () => ({
    DBState: { get db() { return mocks.db } },
    selectedCharID: mocks.selectedCharID,
}))
vi.mock('src/ts/globalApi.svelte', () => ({
    requestImmediateSave: mocks.requestImmediateSave,
    trackChatForSave: mocks.trackChatForSave,
    saveAsset: mocks.saveAsset,
    getFileSrc: mocks.getFileSrc,
    requiresFullEncoderReload: mocks.requiresFullEncoderReload,
    forageStorage: { createAuth: mocks.createAuth },
}))
vi.mock('src/ts/risubard/memoryWikiFork', () => ({
    forkMemoryWiki: mocks.forkMemoryWiki,
    completeMemoryWikiFork: mocks.completeMemoryWikiFork,
}))
vi.mock('src/ts/util', () => ({
    selectSingleFile: mocks.selectSingleFile,
}))
vi.mock('src/ts/characters', () => ({
    getCharImage: vi.fn(async (value: string) => value || '/none.webp'),
}))
vi.mock('src/ts/alert', () => ({
    alertConfirm: mocks.alertConfirm,
    alertInput: mocks.alertInput,
}))

let mounted: ReturnType<typeof mount> | undefined

function makeDb(): Database {
    return {
        characters: [
            { chaId: 'a', name: 'Alice', image: 'alice.webp', lastInteraction: 300, creation_date: 100 },
            { chaId: 'b', name: 'Bryn', image: 'bryn.webp', lastInteraction: 100, creation_date: 300 },
            { chaId: 'c', name: 'Cato', image: '', lastInteraction: 200, creation_date: 200 },
        ],
        characterOrder: [
            'a',
            {
                id: 'folder-1',
                name: 'Cast',
                color: 'blue',
                data: ['b'],
            },
            'c',
        ],
    } as Database
}

async function render(expectedImages = 3, expectedTitle = 'Character Vault') {
    const target = document.body.appendChild(document.createElement('div'))
    mounted = mount(CharacterVaultDialog, {
        target,
        props: {
            open: true,
            onOpenChange: vi.fn(),
            onSelectCharacter: vi.fn(),
        },
    })
    await tick()
    await vi.waitFor(() => expect(document.body.textContent)
        .toContain(expectedTitle))
    await vi.waitFor(() => expect(
        document.body.querySelectorAll('.portrait img')
    ).toHaveLength(expectedImages))
}

function click(label: string) {
    const button = document.body.querySelector<HTMLButtonElement>(
        `[aria-label="${label}"]`
    )
    if (!button) throw new Error(`Missing button: ${label}`)
    button.click()
}

describe('CharacterVaultDialog', () => {
    beforeEach(() => {
        mocks.db = makeDb()
        mocks.requestImmediateSave.mockClear()
        mocks.alertConfirm.mockClear().mockResolvedValue(true)
        mocks.alertInput.mockClear().mockResolvedValue('')
        mocks.selectedCharID.set.mockClear()
        mocks.requiresFullEncoderReload.state = false
        mocks.forkMemoryWiki.mockClear()
        mocks.completeMemoryWikiFork.mockClear()
        mocks.createAuth.mockClear()
    })

    afterEach(async () => {
        if (mounted) await unmount(mounted)
        mounted = undefined
        document.body.replaceChildren()
    })

    test('localizes the heading in Korean and uses the settings heading font', async () => {
        mocks.db.language = 'ko'
        await render(3, '캐릭터 저장소')

        expect(document.body.textContent).not.toContain('Character Vault')
        const source = readFileSync(
            'src/lib/SideBars/CharacterVaultDialog.svelte', 'utf8'
        )
        expect(source).toMatch(/\.vault-title\s*\{[^}]*font-family:\s*var\(--risu-font-family\)/s)
    })

    test('uses square character cards with a centered title overlay on hover', () => {
        const source = readFileSync(
            'src/lib/SideBars/CharacterVaultDialog.svelte', 'utf8'
        )

        expect(source).toMatch(/\.character-grid\s*\{[^}]*grid-auto-rows:\s*max-content/s)
        expect(source).toMatch(/\.character-card\s*\{[^}]*aspect-ratio:\s*1/s)
        expect(source).toMatch(/\.character-card\s*\{[^}]*width:\s*100%/s)
        expect(source).toMatch(/\.portrait\s*\{[^}]*inset:\s*0/s)
        expect(source).toMatch(/\.character-caption\s*\{[^}]*position:\s*absolute[^}]*inset:\s*0[^}]*place-items:\s*center[^}]*opacity:\s*0/s)
        expect(source).toMatch(/\.character-card:hover \.character-caption[^}]*\{[^}]*opacity:\s*1/s)
        expect(source).toMatch(/\.character-caption strong\s*\{[^}]*font-size:\s*clamp\(/s)
    })

    test('uses the shared resizable manager pattern and keeps the selection dock in flow', () => {
        const source = readFileSync(
            'src/lib/SideBars/CharacterVaultDialog.svelte', 'utf8'
        )

        expect(source).toContain('ManagerResizeHandles')
        expect(source).toContain('bind:contentElement')
        expect(source).toContain('<ManagerResizeHandles target={contentElement} centered />')
        expect(source).toMatch(/:global\(\.character-vault-dialog\)\s*\{[^}]*--manager-width/s)
        expect(source).toContain('container-name: character-vault')
        expect(source).toContain('@container character-vault (max-width: 50rem)')
        expect(source).toMatch(/\.bulk-dock\s*\{(?![^}]*position:\s*absolute)[^}]*flex-wrap:\s*wrap/s)
        expect(source).toContain('class="bulk-actions"')
    })

    test('opens and closes the folder sidebar from the mobile toolbar', async () => {
        await render()
        const toggle = document.body.querySelector<HTMLButtonElement>(
            '[aria-label="캐릭터 폴더 열기"]'
        )!
        const close = document.body.querySelector<HTMLButtonElement>(
            '.folder-sidebar-close'
        )!

        expect(toggle).not.toBeNull()
        expect(close).not.toBeNull()
        toggle.style.display = 'grid'
        close.style.display = 'grid'
        expect(toggle.getAttribute('aria-expanded')).toBe('false')
        toggle.click()
        await tick()
        expect(toggle.getAttribute('aria-expanded')).toBe('true')
        expect(document.body.querySelector('.vault-rail')?.classList.contains('open')).toBe(true)

        close.click()
        await tick()
        expect(toggle.getAttribute('aria-expanded')).toBe('false')

        toggle.click()
        await tick()

        click('Cast 폴더 열기')
        await tick()
        expect(toggle.getAttribute('aria-expanded')).toBe('false')
        expect(document.body.querySelector('.vault-rail')?.classList.contains('open')).toBe(false)

        const source = readFileSync(
            'src/lib/SideBars/CharacterVaultDialog.svelte', 'utf8'
        )
        expect(source).toMatch(/@container character-vault[^]*?\.vault-rail\s*\{[^}]*visibility:\s*hidden[^}]*pointer-events:\s*none/s)
        expect(source).toMatch(/@container character-vault[^]*?\.vault-rail\.open\s*\{[^}]*visibility:\s*visible/s)
        expect(source).toContain('if (open) folderSidebarClose?.focus()')
        expect(source).toContain('else folderSidebarToggle?.focus()')
    })

    test('filters the full vault by character name', async () => {
        await render()
        const search = document.body.querySelector<HTMLInputElement>(
            '[aria-label="캐릭터 검색"]'
        )!
        search.value = 'Alice'
        search.dispatchEvent(new Event('input', { bubbles: true }))
        await tick()

        expect(document.body.textContent).toContain('Alice')
        expect(document.body.textContent).not.toContain('Cato')
    })

    test('groups the full vault by folder in sidebar order', async () => {
        mocks.db.characterOrder.push({ id: 'folder-2', name: 'Empty', color: '#336699', data: [] } as never)
        await render()
        const sort = document.body.querySelector<HTMLSelectElement>(
            '[aria-label="캐릭터 정렬 기준"]'
        )!
        sort.value = 'order'
        sort.dispatchEvent(new Event('change', { bubbles: true }))
        await tick()

        const sections = [...document.body.querySelectorAll('.vault-section')]
        expect(sections.map((section) => [
            section.querySelector('h3')?.textContent,
            [...section.querySelectorAll('.character-caption strong')].map((name) => name.textContent),
        ])).toEqual([
            ['미분류', ['Alice']],
            ['Cast', ['Bryn']],
            ['미분류', ['Cato']],
            ['Empty', []],
        ])
        expect(sections[3].textContent).toContain('비어 있는 폴더입니다.')
        expect(document.body.querySelector<HTMLButtonElement>('[aria-label^="정렬 방향"]')?.disabled).toBe(true)

        click('Cast 폴더 열기')
        await tick()
        expect(document.body.querySelectorAll('.vault-section')).toHaveLength(0)
        expect(document.body.querySelectorAll('.character-card')).toHaveLength(1)
    })

    test('duplicates selected characters with chats and their BardWiki workspaces', async () => {
        Object.assign(mocks.db.characters[0], {
            chats: [{
                id: 'chat-a', name: 'Long chat', note: '', localLore: [],
                message: [{ role: 'char', data: 'hello', chatId: 'message-1' }],
            }],
            chatFolders: [],
            chatPage: 0,
        })
        await render()
        click('Alice 선택')
        await tick()

        click('선택 캐릭터 챗 포함 복제')

        await vi.waitFor(() => expect(mocks.forkMemoryWiki).toHaveBeenCalledOnce())
        await vi.waitFor(() => expect(mocks.db.characters).toHaveLength(4))
        const clone = mocks.db.characters.find((character) =>
            character.chaId !== 'a' && character.name === 'Alice-2'
        )!
        expect(clone).toBeDefined()
        expect(clone.chats[0].id).not.toBe('chat-a')
        expect(clone.chats[0].message[0].chatId).toBe('message-1')
        expect(mocks.forkMemoryWiki).toHaveBeenCalledWith(expect.objectContaining({
            characterId: 'a',
            destinationCharacterId: clone.chaId,
            sourceChatId: 'chat-a',
            destinationChatId: clone.chats[0].id,
        }))
        await vi.waitFor(() => expect(mocks.completeMemoryWikiFork)
            .toHaveBeenCalledWith(expect.objectContaining({
                characterId: clone.chaId,
                action: 'finalize',
            })))
        // Only the cloned chat bodies are sent; the database is not rewritten whole.
        expect(mocks.trackChatForSave).toHaveBeenCalledWith(clone.chaId, clone.chats[0].id)
        expect(mocks.requestImmediateSave).toHaveBeenCalledWith({ rejectOnFailure: true })
    })

    test('duplicates selected characters without chats or BardWiki calls', async () => {
        Object.assign(mocks.db.characters[0], {
            chats: [{
                id: 'chat-a', name: 'Long chat', note: '', localLore: [],
                message: [{ role: 'char', data: 'hello', chatId: 'message-1' }],
            }],
            chatFolders: [],
            chatPage: 0,
        })
        await render()
        click('Alice 선택')
        await tick()

        click('선택 캐릭터 챗 제외 복제')

        await vi.waitFor(() => expect(mocks.db.characters).toHaveLength(4))
        const clone = mocks.db.characters.find((character) =>
            character.chaId !== 'a' && character.name === 'Alice-2'
        )!
        expect(clone.chats).toEqual([expect.objectContaining({
            name: 'Chat 1', message: [], localLore: [],
        })])
        expect(mocks.forkMemoryWiki).not.toHaveBeenCalled()
        expect(mocks.completeMemoryWikiFork).not.toHaveBeenCalled()
    })

    test('does not expose characters that are in the trash', async () => {
        mocks.db.characters[0].trashTime = Date.now()
        await render(2)

        expect(document.body.textContent).not.toContain('Alice')
        expect(document.body.textContent).toContain('Bryn')
        expect(document.body.querySelector('.vault-rail button small')?.textContent)
            .toBe('2')
    })

    test('moves a multi-selection into a folder and saves immediately', async () => {
        await render()
        click('Alice 선택')
        click('Cato 선택')
        await tick()
        expect(document.body.textContent).toContain('2명 선택')
        const target = document.body.querySelector<HTMLSelectElement>(
            '[aria-label="선택 캐릭터 이동"]'
        )!
        target.value = 'folder-1'
        target.dispatchEvent(new Event('change', { bubbles: true }))
        await tick()
        click('선택 항목 이동')
        await tick()

        const folder = mocks.db.characterOrder.find((entry) =>
            typeof entry !== 'string' && entry.id === 'folder-1'
        )
        expect(typeof folder === 'string' ? [] : folder?.data)
            .toEqual(['b', 'a', 'c'])
        expect(mocks.requestImmediateSave).toHaveBeenCalled()
    })

    test('moves a dragged character card into the dropped folder and saves immediately', async () => {
        await render()
        const card = document.body.querySelector<HTMLButtonElement>(
            '[aria-label="Alice 선택"]'
        )!.closest('.character-card')!
        const folder = document.body.querySelector<HTMLButtonElement>(
            '[aria-label="Cast 폴더 열기"]'
        )!.closest('.folder-row')!
        const dataTransfer = new DataTransfer()
        const dragEvent = (type: string, cancelable = false) => {
            const event = new DragEvent(type, { bubbles: true, cancelable })
            Object.defineProperty(event, 'dataTransfer', { value: dataTransfer })
            return event
        }

        card.dispatchEvent(dragEvent('dragstart'))
        expect(dataTransfer.getData('application/x-risubard-character-vault'))
            .toBe('a')
        folder.dispatchEvent(dragEvent('dragover', true))
        folder.dispatchEvent(dragEvent('drop', true))
        await tick()

        const target = mocks.db.characterOrder.find((entry) =>
            typeof entry !== 'string' && entry.id === 'folder-1'
        )
        expect(typeof target === 'string' ? [] : target?.data).toEqual(['b', 'a'])
        expect(mocks.requestImmediateSave).toHaveBeenCalled()
        expect(document.body.querySelector('[aria-live="polite"]')?.textContent)
            .toContain('Alice · Cast 폴더로 이동')
    })

    test('selects a character when the card body is clicked', async () => {
        await render()
        document.body.querySelector<HTMLElement>(
            '.character-caption strong'
        )!.click()
        await tick()

        expect(document.body.querySelector('[aria-label="Alice 선택"]')
            ?.getAttribute('aria-pressed')).toBe('true')
        expect(document.body.textContent).toContain('1명 선택')
    })

    test('selects a focused character card from the keyboard', async () => {
        await render()
        const card = document.body.querySelector<HTMLElement>(
            '[aria-label^="Alice 캐릭터 카드"]'
        )!
        card.dispatchEvent(new KeyboardEvent('keydown', {
            key: ' ', bubbles: true, cancelable: true,
        }))
        await tick()

        expect(card.getAttribute('role')).toBe('checkbox')
        expect(card.getAttribute('aria-checked')).toBe('true')
    })

    test('moves a dragged folder character back to unfiled and saves immediately', async () => {
        await render()
        click('Cast 폴더 열기')
        await tick()
        const card = document.body.querySelector<HTMLButtonElement>(
            '[aria-label="Bryn 선택"]'
        )!.closest('.character-card')!
        const unfiled = Array.from(document.body.querySelectorAll<HTMLButtonElement>(
            '.vault-rail > button'
        )).find((button) => button.textContent?.includes('미분류'))!
        const dataTransfer = new DataTransfer()
        const dragEvent = (type: string, cancelable = false) => {
            const event = new DragEvent(type, { bubbles: true, cancelable })
            Object.defineProperty(event, 'dataTransfer', { value: dataTransfer })
            return event
        }

        card.dispatchEvent(dragEvent('dragstart'))
        unfiled.dispatchEvent(dragEvent('dragover', true))
        unfiled.dispatchEvent(dragEvent('drop', true))
        await tick()

        const folder = mocks.db.characterOrder.find((entry) =>
            typeof entry !== 'string' && entry.id === 'folder-1'
        )
        expect(typeof folder === 'string' ? [] : folder?.data).toEqual([])
        expect(mocks.db.characterOrder).toContain('b')
        expect(mocks.requestImmediateSave).toHaveBeenCalled()
        expect(document.body.querySelector('[aria-live="polite"]')?.textContent)
            .toContain('Bryn · 미분류로 이동')
    })

    test('renames a character from its card and saves immediately', async () => {
        mocks.alertInput.mockResolvedValue('  Alicia  ')
        await render()

        click('Alice 이름 변경')
        await vi.waitFor(() => expect(mocks.db.characters[0].name).toBe('Alicia'))

        expect(mocks.alertInput).toHaveBeenCalledWith(
            '캐릭터 이름 변경', [], 'Alice'
        )
        expect(mocks.requestImmediateSave).toHaveBeenCalled()
        expect(document.body.querySelector('[aria-live="polite"]')?.textContent)
            .toContain('Alice → Alicia 이름 변경 완료')
    })

    test('selects every character in the current filtered scope', async () => {
        await render()
        click('현재 목록 전체 선택')
        await tick()

        expect(document.body.textContent).toContain('3명 선택')
    })

    test('creates an empty folder from the storage rail toolbar', async () => {
        mocks.alertInput.mockResolvedValue('Supporting Cast')
        await render()
        click('새 폴더 만들기')
        await tick()

        const folder = mocks.db.characterOrder.find((entry) =>
            typeof entry !== 'string' && entry.name === 'Supporting Cast'
        )
        expect(typeof folder === 'string' ? undefined : folder?.data).toEqual([])
        expect(mocks.requestImmediateSave).toHaveBeenCalled()
    })

    test('deletes the active folder from the storage rail toolbar', async () => {
        await render()
        click('Cast 폴더 열기')
        await tick()
        click('선택한 폴더 삭제')
        await tick()

        expect(mocks.db.characterOrder.some((entry) =>
            typeof entry !== 'string' && entry.id === 'folder-1'
        )).toBe(false)
        expect(mocks.db.characterOrder).toContain('b')
    })

    test('keeps characters when the second deletion confirmation is cancelled', async () => {
        await render()
        click('Alice 선택')
        await tick()
        mocks.alertConfirm.mockResolvedValueOnce(true).mockResolvedValueOnce(false)
        click('선택 캐릭터 삭제')
        await tick()
        await tick()
        expect(mocks.alertConfirm).toHaveBeenCalledTimes(2)
        expect(mocks.db.characters.find(character => character.chaId === 'a')).toBeDefined()
        expect(mocks.requestImmediateSave).not.toHaveBeenCalled()
    })

    test('replaces selection-time folder creation with twice-confirmed permanent deletion', async () => {
        await render()
        click('Alice 선택')
        click('Cato 선택')
        await tick()

        expect(document.body.querySelector('[aria-label="새 폴더 이름"]')).toBeNull()
        expect(document.body.querySelector('[aria-label="선택 항목으로 폴더 생성"]')).toBeNull()
        click('선택 캐릭터 삭제')
        await tick()
        await tick()

        expect(mocks.alertConfirm).toHaveBeenCalledTimes(2)
        expect(mocks.db.characters.find((character) => character.chaId === 'a')).toBeUndefined()
        expect(mocks.db.characters.find((character) => character.chaId === 'c')).toBeUndefined()
        expect(mocks.selectedCharID.set).toHaveBeenCalledWith(-1)
        expect(mocks.requiresFullEncoderReload.state).toBe(true)
        expect(mocks.requestImmediateSave).toHaveBeenCalled()
    })

    test('sorts cards by criterion and toggles ascending or descending order', async () => {
        await render()
        const names = () => Array.from(document.body.querySelectorAll(
            '.character-caption strong'
        )).map((element) => element.textContent)
        expect(names()).toEqual(['Alice', 'Bryn', 'Cato'])

        const sort = document.body.querySelector<HTMLSelectElement>(
            '[aria-label="캐릭터 정렬 기준"]'
        )!
        sort.value = 'lastInteraction'
        sort.dispatchEvent(new Event('change', { bubbles: true }))
        await tick()
        expect(names()).toEqual(['Bryn', 'Cato', 'Alice'])

        click('정렬 방향: 오름차')
        await tick()
        expect(names()).toEqual(['Alice', 'Cato', 'Bryn'])
        expect(document.body.querySelector('[aria-label="정렬 방향: 내림차"]'))
            .not.toBeNull()
    })

    test('adds and removes characters from the quick inventory', async () => {
        await render()
        click('Alice 퀵 인벤토리 전환')
        await tick()

        expect(mocks.db.characterVault?.quickAccess).not.toContainEqual({
            kind: 'character', id: 'a',
        })
        expect(document.body.querySelector('[aria-live="polite"]')?.textContent)
            .toContain('퀵 인벤토리에서 제거됨')
    })

    test('renames and recolors the active folder', async () => {
        await render()
        click('Cast 폴더 열기')
        await tick()
        const name = document.body.querySelector<HTMLInputElement>(
            '[aria-label="폴더 이름"]'
        )!
        name.value = 'Main Cast'
        name.dispatchEvent(new Event('change', { bubbles: true }))
        const color = document.body.querySelector<HTMLInputElement>(
            '[aria-label="폴더 사용자 지정 색상"]'
        )!
        color.value = '#123456'
        color.dispatchEvent(new Event('input', { bubbles: true }))
        await tick()

        const folder = mocks.db.characterOrder.find((entry) =>
            typeof entry !== 'string' && entry.id === 'folder-1'
        )
        expect(typeof folder === 'string' ? '' : folder?.name).toBe('Main Cast')
        expect(typeof folder === 'string' ? '' : folder?.color).toBe('#123456')
        expect(mocks.requestImmediateSave).toHaveBeenCalled()
    })
})
