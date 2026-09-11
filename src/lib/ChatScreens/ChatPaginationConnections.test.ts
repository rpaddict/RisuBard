import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const chats = () => readFileSync('src/lib/ChatScreens/Chats.svelte', 'utf8')
const screen = () => readFileSync('src/lib/ChatScreens/DefaultChatScreen.svelte', 'utf8')
const shortcuts = () => readFileSync('src/lib/ChatScreens/RisuBardSaveLoadShortcuts.svelte', 'utf8')

describe('bounded chat-page UI connections', () => {
    it('mounts only an absolute end-exclusive page range', () => {
        const source = chats()
        expect(source).toContain('pageStart')
        expect(source).toContain('pageEnd')
        expect(source).toContain('let loadStart = pageEnd - 1')
        expect(source).toContain('let loadEnd = pageStart')
        expect(source).not.toContain('messages.length - loadPages')
    })

    it('uses explicit bounded navigation instead of cumulative scroll loading', () => {
        const source = screen()
        expect(source).toContain('data-chat-pagination')
        expect(source).toContain('data-chat-page-previous')
        expect(source).toContain('data-chat-page-next')
        expect(source).toContain('data-chat-page-latest')
        expect(source).toContain('getChatPageBounds')
        expect(source).toContain('getChatPageForMessage')
        expect(source).not.toMatch(/loadPages\s*\+=/)
    })

    it('keeps the side navigator compact and places page-turn jump at the toolbar right edge', () => {
        const source = screen()
        const navigator = source.slice(
            source.indexOf("DBState.db.nodeOnlyScrollButtonType !== 'off'"),
            source.indexOf('{#if showNewMessageButton}'),
        )
        const toolbar = shortcuts()
        const close = toolbar.indexOf('class="toolbar-close"')
        const pageJump = toolbar.indexOf('data-chat-page-jump')
        const turnJump = toolbar.indexOf('data-chat-turn-jump', pageJump)
        const jumpButton = toolbar.indexOf('data-chat-page-turn-jump-button', turnJump)

        expect(navigator).not.toContain('data-chat-page-jump')
        expect(navigator).not.toContain('data-chat-turn-jump')
        expect([close, pageJump, turnJump, jumpButton].every(index => index >= 0)).toBe(true)
        expect(close).toBeLessThan(pageJump)
        expect(pageJump).toBeLessThan(turnJump)
        expect(turnJump).toBeLessThan(jumpButton)
        expect(toolbar).toContain('ArrowRightToLineIcon')
        expect(toolbar).toContain('onJump')
        expect(source).toContain('buildChatTurnNavigation(currentChat, targetPageBounds.start, targetPageBounds.end)')
        expect(source).toContain('messageIndexByTurn[target - 1]')
    })

    it('passes stable response turn numbers into each rendered chat message', () => {
        const list = chats()
        const chat = readFileSync('src/lib/ChatScreens/Chat.svelte', 'utf8')

        expect(list).toContain('buildChatTurnNavigation(messages)')
        expect(list).toContain('turnNumber: turnNavigation.turnByMessageIndex.get(i)')
        expect(chat).toContain('data-chat-turn-reference="header"')
        expect(chat).toContain('data-chat-turn-reference="footer"')
    })

    it('restores the per-chat page and scroll position after the chat screen remounts', () => {
        const source = screen()
        expect(source).toContain("from 'src/ts/chatViewSession'")
        expect(source).toContain('loadChatViewSession(nextKey)')
        expect(source).toContain('saveChatViewSession(paginationKey')
        expect(source).toContain('bind:this={chatScrollContainer}')
        expect(source).toContain('chatScrollContainer.scrollTop = savedView.scrollTop')
    })

    it('never expands the mounted chat to infinity for screenshots', () => {
        const source = screen()
        expect(source).not.toContain('loadPages = Infinity')
        expect(source).toContain('chat-page-${chatBounds.page + 1}')
    })

    it('pins the first message to every chat page and defaults later pages to collapsed', () => {
        const source = screen()
        expect(source).toContain('let firstMessageCollapsed = $state(true)')
        expect(source).toContain('firstMessageCollapsed = true')
        expect(source).toContain('data-chat-pinned-first-message')
        expect(source).toContain('{#if chatBounds.page === 0 || !firstMessageCollapsed}')
    })

    it('places the later-page first-message toggle after the message content', () => {
        const source = screen()
        expect(source).toContain('{#if chatBounds.page > 0}')
        expect(source).toContain('data-chat-first-message-toggle')
        expect(source).toContain('aria-expanded={!firstMessageCollapsed}')
        expect(source).toContain('firstMessageCollapsed = !firstMessageCollapsed')
        expect(source.indexOf('id="chat-pinned-first-message-content"')).toBeLessThan(
            source.indexOf('data-chat-first-message-toggle')
        )
    })
})
