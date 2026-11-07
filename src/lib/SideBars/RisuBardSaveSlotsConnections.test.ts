import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, test } from 'vitest'

const source = readFileSync(resolve(
    process.cwd(), 'src/lib/SideBars/SideChatList.svelte'
), 'utf8')
const chatScreenSource = readFileSync(resolve(
    process.cwd(), 'src/lib/ChatScreens/ChatScreen.svelte'
), 'utf8')
const shortcutsPath = resolve(
    process.cwd(), 'src/lib/ChatScreens/RisuBardSaveLoadShortcuts.svelte'
)
const shortcutsSource = existsSync(shortcutsPath)
    ? readFileSync(shortcutsPath, 'utf8')
    : ''
const defaultChatSource = readFileSync(resolve(
    process.cwd(), 'src/lib/ChatScreens/DefaultChatScreen.svelte'
), 'utf8')
const dialogSource = readFileSync(resolve(
    process.cwd(), 'src/lib/SideBars/RisuBardSaveSlotsDialog.svelte'
), 'utf8')
const buttonSource = readFileSync(resolve(
    process.cwd(), 'src/lib/UI/GUI/ShButton.svelte'
), 'utf8')
const stylesSource = readFileSync(resolve(process.cwd(), 'src/styles.css'), 'utf8')
const commonSettingsSource = readFileSync(resolve(
    process.cwd(), 'src/ts/setting/risuBardCommonSettingsData.ts'
), 'utf8')
const databaseSource = readFileSync(resolve(
    process.cwd(), 'src/ts/storage/database.svelte.ts'
), 'utf8')
const koreanSource = readFileSync(resolve(process.cwd(), 'src/lang/ko.ts'), 'utf8')
const charactersSource = readFileSync(resolve(
    process.cwd(), 'src/ts/characters.ts'
), 'utf8')

describe('chat file save slot connections', () => {
    test('opens save mode in every chat theme and only writes after choosing a slot', () => {
        expect(chatScreenSource.match(/onSaveChat=\{\(\) => openSaveSlots\('save'\)\}/g))
            .toHaveLength(1)
        expect(chatScreenSource.match(/onOpenChatLoad=\{\(\) => openSaveSlots\('load'\)\}/g))
            .toHaveLength(1)
        expect(chatScreenSource.match(/\{@render chatViewport\(/g)).toHaveLength(3)
        expect(chatScreenSource).toContain('bind:mode={saveSlotsMode}')
        expect(chatScreenSource).toContain('onSave={saveCurrentChat}')
        expect(chatScreenSource).toContain('saveId: saveId ?? v4()')
        expect(chatScreenSource).toContain('overwrite = saveId !== undefined')
        expect(chatScreenSource).toContain('overwrite,')
    })

    test('removes save and load actions from the character sidebar', () => {
        expect(source).toContain('data-chat-file-header')
        expect(source).not.toContain('data-chat-file-toolbar')
        expect(source).not.toContain('data-risubard-save-chat')
        expect(source).not.toContain('data-risubard-load-chat')
        expect(source).not.toContain('<RisuBardSaveSlotsDialog')
    })

    test('adds save, load, quicksave and quickload to an inline composer toolbar', () => {
        expect(defaultChatSource).toContain('data-composer-save-chat')
        expect(defaultChatSource).toContain('data-composer-load-chat')
        expect(defaultChatSource).toContain('onSaveChat')
        expect(defaultChatSource).toContain('onOpenChatLoad')
        expect(defaultChatSource).toMatch(
            /data-composer-save-toolbar[\s\S]*plugin-compat-items-stretch/
        )
        expect(chatScreenSource).not.toContain('<RisuBardSaveLoadShortcuts')
        expect(shortcutsSource).toContain('data-composer-save-toolbar')
        expect(shortcutsSource).toContain('data-shortcut-save-chat')
        expect(shortcutsSource).toContain('data-shortcut-load-chat')
        expect(shortcutsSource).toContain('data-shortcut-quicksave-chat')
        expect(shortcutsSource).toContain('data-shortcut-quickload-chat')
        expect(shortcutsSource).toContain('onQuickSave')
        expect(shortcutsSource).toContain('onQuickLoad')
        expect(shortcutsSource).toContain('role="group"')
        expect(shortcutsSource).toContain('aria-label={language.risuBardShowSaveLoadShortcuts}')
        expect(shortcutsSource).not.toMatch(/\.save-load-toolbar\s*\{[^}]*position:\s*absolute/)
        expect(defaultChatSource).not.toContain('!$MobileGUI')
        expect(chatScreenSource).toContain('<RisuBardSaveSlotsDialog')
    })

    test('centers the composer toolbar and matches the input pill styling', () => {
        expect(shortcutsSource).not.toContain('onpointerdown={beginDrag}')
        expect(shortcutsSource).not.toContain('risuBardSaveLoadShortcutPlacement')
        expect(shortcutsSource).toContain('display: flex')
        expect(shortcutsSource).toContain('margin: 0 auto .5rem')
        expect(shortcutsSource).toContain('border: 1px solid var(--color-darkborderc)')
        expect(shortcutsSource).toContain('border-radius: var(--risu-radius-3xl)')
        expect(shortcutsSource).toContain('background: var(--color-bgcolor)')
        expect(shortcutsSource).toContain('width: 2.25rem')
        expect(shortcutsSource).toContain('border-radius: 999px')
    })

    test('uses Solar save/load assets and lightning overlays for quick actions', () => {
        expect(shortcutsSource).toContain('<SolarAssetIcon src={feedIcon} name="feed-bold"')
        expect(shortcutsSource).toContain('<SolarAssetIcon src={loadIcon} name="undo-left-square-bold"')
        expect(shortcutsSource).toContain('name="diskette-bold"')
        expect(shortcutsSource).toContain('name="lightning-bold"')
        expect(shortcutsSource).toContain('quick-icon__bolt')
        for (const asset of [
            'src/assets/solar-bold/feed-bold.svg',
            'src/assets/solar-bold/undo-left-square-bold.svg',
            'src/assets/solar-bold/diskette-bold.svg',
            'src/assets/solar-bold/lightning-bold.svg',
        ]) {
            expect(existsSync(resolve(process.cwd(), asset))).toBe(true)
        }
    })

    test('allows opening find/replace while generation or reboot blocks mutations', () => {
        const expression = defaultChatSource.match(/findReplaceDisabled=\{([^}]+)\}/)?.[1]
        expect(expression).toBeTruthy()
        const disabled = new Function('$isWikiGenerating', '$isAnyGenerating', 'currentChatSlot', 'currentChatReady', `return (${expression})`)
        for (const [wiki, chat, slot] of [
            [false, false, { id: 'chat' }],
            [true, false, { id: 'chat' }],
            [false, true, { id: 'chat' }],
            [false, false, { id: 'chat', isStreaming: true }],
            [false, false, { id: 'chat', risuBardWikiReboot: { status: 'paused' } }],
        ]) {
            expect(disabled(wiki, chat, slot, true)).toBe(false)
        }
        expect(disabled(false, false, undefined, false)).toBe(true)
    })

    test('can hide and restore the shortcut block from RisuBard common settings', () => {
        expect(shortcutsSource).not.toContain('DBState.db.showRisuBardSaveLoadShortcuts = false')
        expect(shortcutsSource).toContain('data-chat-find-replace')
        expect(shortcutsSource).toContain('onclick={onFindReplace}')
        expect(koreanSource).toContain('세이브/로드 버튼을 끌까요? Bardwiki / 공통 옵션에서 다시 켤 수 있습니다')
        expect(commonSettingsSource).toContain("id: 'risubard.common.showSaveLoadShortcuts'")
        expect(commonSettingsSource).toContain("type: 'check'")
        expect(commonSettingsSource).toContain("bindKey: 'showRisuBardSaveLoadShortcuts'")
        expect(databaseSource).toContain('showRisuBardSaveLoadShortcuts?: boolean')
        expect(databaseSource).toContain('data.showRisuBardSaveLoadShortcuts ??= true')
        expect(defaultChatSource).toContain('DBState.db.showRisuBardSaveLoadShortcuts')
    })

    test('exposes bounded autosave interval and retention in common settings', () => {
        expect(commonSettingsSource).toContain("id: 'risubard.common.autosaveInterval'")
        expect(commonSettingsSource).toContain("bindKey: 'risuBardAutosaveInterval'")
        expect(commonSettingsSource).toContain("id: 'risubard.common.autosaveRetention'")
        expect(commonSettingsSource).toContain("bindKey: 'risuBardAutosaveRetention'")
        expect(databaseSource).toContain('risuBardAutosaveInterval?: number')
        expect(databaseSource).toContain('risuBardAutosaveRetention?: number')
        expect(databaseSource).toContain('normalizeAutosaveInterval(')
        expect(databaseSource).toContain('normalizeAutosaveRetention(')
    })

    test('orchestrates one quick slot and rotating autosaves per chat', () => {
        expect(chatScreenSource).toContain('quickSaveId(chat.id)')
        expect(chatScreenSource).toContain('listMemorySaveSlots({')
        expect(chatScreenSource).toContain('quickSaveCurrentChat')
        expect(chatScreenSource).toContain('quickLoadCurrentChat')
        expect(chatScreenSource).toContain('shouldCreateAutosave(')
        expect(chatScreenSource).toContain('autoSaveId(')
        expect(chatScreenSource).toContain('obsoleteAutosaveIds(')
        expect(chatScreenSource).toContain('risuBardLastAutosaveTurn')
        expect(chatScreenSource).toContain('silent: true')
        expect(defaultChatSource).toContain('onQuickSave')
        expect(defaultChatSource).toContain('onQuickLoad')
    })

    test('autosaves an idle completed turn without waiting for the next turn confirmation', () => {
        const effectStart = chatScreenSource.indexOf('$effect(() => {',
            chatScreenSource.indexOf('async function autosaveCurrentChat'))
        const effectEnd = chatScreenSource.indexOf('const wallPaper', effectStart)
        const autosaveEffect = chatScreenSource.slice(effectStart, effectEnd)

        expect(autosaveEffect).toContain('$isWikiGenerating')
        expect(autosaveEffect).toContain('$generationStates.has(chatGenKey(chat.id))')
        expect(autosaveEffect).toContain('shouldCreateAutosave(')
        expect(autosaveEffect).not.toContain('risubardMemoryConfirmed')
        expect(autosaveEffect).not.toContain('wikiReady')
    })

    test('keeps BardWiki when a RisuBard chat is exported and reimported locally', () => {
        expect(charactersSource).toContain('sourceCharacterId: char.chaId')
        expect(charactersSource).toContain('await forkMemoryWiki({')
        expect(charactersSource).toContain("mode: 'copy'")
        expect(charactersSource).toMatch(
            /await requestImmediateSave[\s\S]*await Promise\.all[\s\S]*completeMemoryWikiFork/
        )
        expect(charactersSource).toContain('resetImportedBardWikiState')
    })

    test('shows the current chat as a plain title above a separate chat-list disclosure', () => {
        const currentStart = source.indexOf('data-current-chat-section')
        const disclosureStart = source.indexOf('data-chat-list-disclosure')
        const currentSection = source.slice(currentStart, disclosureStart)

        expect(currentSection).not.toContain('data-current-chat-label')
        expect(currentSection).not.toContain('language.currentChatLabel')
        expect(currentSection).toContain('data-current-chat-title')
        expect(currentSection).toContain('activeChat?.name ?? language.newChat')
        expect(currentSection).not.toContain('data-chat-list-toggle')
        expect(currentSection).not.toContain('ChevronRightIcon')
        expect(source).toContain('data-chat-list-disclosure')
        expect(source).toContain('bind:open={chatListExpanded}')
        expect(source).toContain('name={language.sidebarChatListLabel}')
    })

    test('places the chat management toolbar and clean chat rows inside the disclosure', () => {
        const disclosureStart = source.indexOf('data-chat-list-disclosure')
        const settingsStart = source.indexOf('class="border-t border-selected mt-2"')
        const disclosure = source.slice(disclosureStart, settingsStart)

        expect(disclosure).toContain('data-chat-list-toolbar')
        expect(disclosure).toContain('data-sidebar-new-chat')
        expect(disclosure).toContain('data-chat-list-row')
        expect(disclosure).not.toContain('data-chat-row-actions')
        expect(source).toContain('data-chat-list-toolbar')
        expect(source).not.toContain('data-chat-row-actions')
        expect(source).toMatch(
            /data-chat-list-toolbar[\s\S]*deleteCurrentChat[\s\S]*TrashIcon/
        )
    })

    test('standardizes the one-pixel hover lift for shared buttons', () => {
        expect(buttonSource).toContain('risu-button-lift')
        expect(stylesSource).toContain('.risu-button-lift:hover:not(:disabled)')
        expect(stylesSource).toContain('transform: translateY(-1px)')
    })

    test('turns the load dialog into a selectable file workspace', () => {
        expect(dialogSource).not.toContain('{#snippet description()}')
        expect(dialogSource).not.toContain("{#snippet title()}")
        expect(dialogSource).toContain('data-save-dialog-context')
        expect(dialogSource).toContain('data-autosave-strip')
        expect(dialogSource).toContain('data-save-slot-kind="quick"')
        expect(dialogSource).toContain('data-save-file-toolbar')
        expect(dialogSource).not.toContain('save-ledger__refresh')
        expect(dialogSource).toContain('data-save-file-rename')
        expect(dialogSource).toContain('data-save-file-delete')
        expect(dialogSource).toContain('data-save-file-sort')
        expect(dialogSource).toContain('data-save-file-grid')
        expect(dialogSource).toContain('grid-template-columns: repeat(auto-fill, minmax(8.5rem, 9.25rem))')
        expect(dialogSource).toContain('aspect-ratio: 1')
        expect(dialogSource).toContain('className="save-slot__rename"')
        expect(dialogSource).toContain('overflow-y: auto')
        expect(dialogSource).toContain('data-save-file-preview')
        expect(dialogSource).toContain('previewMemorySaveSlot')
        expect(dialogSource).toContain('width: min(70.4rem, calc(100vw - 2rem))')
        expect(dialogSource).toContain('height: 91vh')
        expect(dialogSource).toContain('width: 100dvw')
        expect(dialogSource).toContain('height: 100dvh')
        expect(dialogSource).toMatch(
            /:global\(\.save-slot-dialog\)\s*\{[^}]*transform:\s*none[^}]*\}\s*(?:\/\*[\s\S]*?\*\/\s*)?:global\(\.save-slot-dialog\.save-slot-dialog\)\s*\{\s*translate:\s*none;?\s*\}/,
        )
        expect(dialogSource).toContain('<SolarAssetIcon src={loadIcon} name="undo-left-square-bold"')
        expect(dialogSource).toContain('@media (max-width: 767px)')
        expect(dialogSource).not.toContain('height: 70vh')
        expect(dialogSource).not.toContain('SAVE_SLOT_DIALOG_GEOMETRY_KEY')
        expect(dialogSource).not.toContain('bind:contentElement')
        expect(dialogSource).not.toContain('class="save-dialog__drag-handle"')
        expect(dialogSource).toContain('data-preview-resize-handle')
        expect(dialogSource).toContain('role="separator"')
        expect(dialogSource).toContain('grid-auto-flow: column')
        expect(dialogSource).toContain('TURN {slot.turnCount}')
        expect(dialogSource).toContain("'{slotLabel(selectedSlot)}' 최근 대화")
        expect(dialogSource).toContain('currentChatId: string')
        expect(dialogSource).toContain('sourceChatId: currentChatId')
        expect(chatScreenSource).toContain(
            'currentChatId={currentCharacter.chats[currentCharacter.chatPage]?.id}'
        )
        expect(chatScreenSource).toContain('characterName={currentCharacter.name}')
        expect(chatScreenSource).toContain('currentChatName={currentCharacter.chats[currentCharacter.chatPage]?.name}')
    })

    test('replaces the current chat and finalizes its wiki only after persistence', () => {
        expect(chatScreenSource).toContain('const destinationChatId = asNewChat ? v4() : currentChat.id')
        expect(chatScreenSource).toMatch(/prepareMemorySaveLoad\(\{[^}]*currentChat,/)
        expect(chatScreenSource).toContain('destinationChatId,')
        expect(chatScreenSource).toContain('loadedChat.id = destinationChatId')
        expect(chatScreenSource).toContain('character.chats[chatIdx] = loadedChat')
        expect(chatScreenSource).toContain('character.chats[chatIdx] = currentChat')
        expect(chatScreenSource).toContain('changeChatTo(asNewChat ? 0 : chatIdx)')
        expect(chatScreenSource).toMatch(
            /prepareMemorySaveLoad[\s\S]*requestImmediateSave[\s\S]*action: 'finalize'/
        )
        expect(chatScreenSource).toMatch(
            /catch\(error\)[\s\S]*action: 'discard'/
        )
        expect(chatScreenSource).not.toContain('void requestImmediateSave({ forceFullWrite: true })')
        expect(chatScreenSource).toContain("notifySuccess('스토리 불러오기 완료', { duration: 3000 })")
    })

    test('can load a save as a new chat without replacing the current chat', () => {
        expect(dialogSource).toContain('새 챗으로 불러오기')
        expect(dialogSource).toContain('onLoad(saveId, loadAsNewChat)')
        expect(chatScreenSource).toContain('async function loadSavedChat(saveId: string, asNewChat = false)')
        expect(chatScreenSource).toContain('const destinationChatId = asNewChat ? v4() : currentChat.id')
        expect(chatScreenSource).toContain('character.chats.unshift(loadedChat)')
        expect(chatScreenSource).toContain("loadedChat.name = createChatCopyName(loadedChat.name, 'Copy')")
        expect(chatScreenSource).toContain('if(asNewChat)')
        expect(chatScreenSource).toContain('character.chats.splice(0, 1)')
        expect(chatScreenSource).toContain('changeChatTo(asNewChat ? 0 : chatIdx)')
    })

    test('uses the defined theme tokens for opaque save slot surfaces', () => {
        expect(dialogSource).toContain('var(--color-darkbg)')
        expect(dialogSource).not.toMatch(
            /var\(--(?:darkbg|darkborderc|borderc|selected|textcolor|textcolor2)\)/
        )
    })
})
