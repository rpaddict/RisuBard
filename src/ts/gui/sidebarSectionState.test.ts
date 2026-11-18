import { beforeEach, describe, expect, test } from 'vitest'
import {
    SIDEBAR_SECTION_STATE_KEY,
    isSidebarSectionOpen,
    reloadSidebarSectionState,
    setSidebarSectionOpen,
} from './sidebarSectionState.svelte'

describe('sidebar section state', () => {
    beforeEach(() => {
        localStorage.clear()
        reloadSidebarSectionState()
    })

    test('keeps open sections per bot and survives a reload', () => {
        setSidebarSectionOpen('bot-a', 'chatList', true)
        setSidebarSectionOpen('bot-a', 'group:OOC', true)
        setSidebarSectionOpen('bot-b', 'group:OOC', false)

        reloadSidebarSectionState()

        expect(isSidebarSectionOpen('bot-a', 'chatList')).toBe(true)
        expect(isSidebarSectionOpen('bot-a', 'group:OOC')).toBe(true)
        expect(isSidebarSectionOpen('bot-b', 'chatList')).toBe(false)
        expect(isSidebarSectionOpen('bot-b', 'group:OOC')).toBe(false)
    })

    test('stores only open sections and drops bots with none open', () => {
        setSidebarSectionOpen('bot-a', 'chatList', true)
        setSidebarSectionOpen('bot-a', 'chatList', false)

        expect(JSON.parse(localStorage.getItem(SIDEBAR_SECTION_STATE_KEY)!)).toEqual({})
    })

    test('ignores corrupt storage', () => {
        localStorage.setItem(SIDEBAR_SECTION_STATE_KEY, '{not json')
        reloadSidebarSectionState()

        expect(isSidebarSectionOpen('bot-a', 'chatList')).toBe(false)
    })
})
