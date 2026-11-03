import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, test } from 'vitest'
import { languageEnglish } from '../../lang/en'
import { languageKorean } from '../../lang/ko'

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')

describe('character configuration navigation', () => {
    test('keeps character navigation in the shared sidebar toolbar', () => {
        const config = source('src/lib/SideBars/CharConfig.svelte')
        const sidebar = source('src/lib/SideBars/Sidebar.svelte')
        const iconPath = 'src/lib/UI/Icons/SolarBoldIcon.svelte'
        expect(existsSync(resolve(process.cwd(), iconPath))).toBe(true)
        for (const name of [
            'chat-round-dots',
            'people-nearby',
            'gallery-wide',
            'notebook',
            'camera-rotate',
            'code-square',
            'settings',
        ]) {
            expect(sidebar).toContain(`<SolarBoldIcon name="${name}"`)
            expect(source(iconPath)).toContain(`name === '${name}'`)
        }
        expect(config).not.toContain('data-character-config-navigation')
    })

    test('puts chat home first and promotes character management to the title row', () => {
        const sidebar = source('src/lib/SideBars/Sidebar.svelte')
        expect(sidebar).toContain('data-character-workspace-header')
        expect(sidebar).toContain('data-character-title')
        expect(sidebar).toContain('data-character-manage')
        expect(sidebar).toContain('data-character-config-navigation')
        expect(sidebar.indexOf('data-character-chat-home'))
            .toBeLessThan(sidebar.indexOf('data-character-config-tab'))
        expect(sidebar).not.toContain('data-sidebar-mode-tabs')
    })

    test('uses gallery in the former TTS toolbar position', () => {
        const sidebar = source('src/lib/SideBars/Sidebar.svelte')
        expect(sidebar.match(/data-character-config-tab/g)).toHaveLength(5)
        for (const label of [
            'language.characterInfo',
            'language.characterDisplay',
            'language.loreBook',
            'language.scripts',
            'language.advancedSettings',
        ]) {
            expect(sidebar).toContain(`aria-label={${label}}`)
        }
        expect(sidebar).toContain('data-risubard-gallery')
        expect(sidebar).toContain('aria-label={language.gallery}')
        expect(sidebar).toContain('<SolarBoldIcon name="camera-rotate"')
        expect(sidebar).toContain('risuBardGalleryOpen.set(true)')
        expect(sidebar).not.toContain('aria-label={"TTS"}')
    })

    test('moves TTS settings to the top of advanced settings before Bias', () => {
        const config = source('src/lib/SideBars/CharConfig.svelte')
        const advancedStart = config.indexOf('{:else if activeSubMenu === 2}')
        const advanced = config.slice(advancedStart)

        expect(config).not.toContain('{:else if activeSubMenu === 5}')
        expect(advanced).toContain('data-character-tts-settings')
        expect(advanced.indexOf('data-character-tts-settings'))
            .toBeLessThan(advanced.indexOf('Bias <Help key="bias"'))
        expect(advanced).toContain('bind:value={DBState.db.characters[$selectedCharID].ttsMode}')
    })

    test('keeps alternate greetings in a collapsed list below the first message', () => {
        const config = source('src/lib/SideBars/CharConfig.svelte')
        const infoStart = config.indexOf('{#if activeSubMenu === 0}')
        const displayStart = config.indexOf('{:else if activeSubMenu === 1}')
        const advancedStart = config.indexOf('{:else if activeSubMenu === 2}')
        const info = config.slice(infoStart, displayStart)
        const advanced = config.slice(advancedStart)

        expect(info.indexOf('bind:value={DBState.db.characters[$selectedCharID].firstMessage}'))
            .toBeLessThan(info.indexOf('data-alternate-greetings'))
        expect(info).toContain('<ShAccordion')
        expect(info).toContain('DBState.db.characters[$selectedCharID].alternateGreetings.length')
        expect(info).toContain("alternateGreetings.push('')")
        expect(advanced).not.toContain('data-alternate-greetings')
    })

    test('opens the former share screen from the management button', () => {
        const sidebar = source('src/lib/SideBars/Sidebar.svelte')
        const charConfig = source('src/lib/SideBars/CharConfig.svelte')
        const manageStart = sidebar.indexOf('data-character-manage')
        const manageEnd = sidebar.indexOf('</button>', manageStart)
        const manageButton = sidebar.slice(manageStart, manageEnd)
        expect(manageButton).toContain('characterManageOpen = true')
        expect(manageButton).not.toContain('botMakerMode.set(true)')
        expect(sidebar).toContain('bind:open={characterManageOpen}')
        expect(sidebar).toContain('closeOnOutsideClick={true}')
        expect(sidebar).toContain('<CharConfig subMenuOverride={6}')
        expect(charConfig).toContain('subMenuOverride?: number')
        expect(languageEnglish.share).toBe('Share')
        expect(languageKorean.share).toBe('공유')
    })

    test('closes character management safely when deletion clears the selection', () => {
        const sidebar = source('src/lib/SideBars/Sidebar.svelte')
        const charConfig = source('src/lib/SideBars/CharConfig.svelte')
        expect(sidebar).toMatch(/if \(\$selectedCharID < 0\)\s+characterManageOpen = false/)
        expect(charConfig).toContain('let currentCharacter = $derived(DBState.db.characters[$selectedCharID])')
        expect(charConfig).toContain('{#if currentCharacter}')
        expect(charConfig.match(/if \(!currentCharacter\) return/g)?.length).toBeGreaterThanOrEqual(9)
    })

    test('does not show trashed characters in recent or mobile character lists', () => {
        const sidebar = source('src/lib/SideBars/Sidebar.svelte')
        const mobileCharacters = source('src/lib/Mobile/MobileCharacters.svelte')
        expect(sidebar).toContain('.filter((c) => !c.trashTime)')
        expect(mobileCharacters).toContain('.filter((c) => !c.trashTime)')
        const recentChars = sidebar.slice(sidebar.indexOf('let recentChars'), sidebar.indexOf('let recentVisible'))
        const sortChar = mobileCharacters.slice(mobileCharacters.indexOf('function sortChar'), mobileCharacters.indexOf('</script>'))
        expect(recentChars.indexOf('.map(')).toBeLessThan(recentChars.indexOf('.filter('))
        expect(sortChar.indexOf('.map(')).toBeLessThan(sortChar.indexOf('.filter('))
    })

    test('uses the requested local Solar icons for management and developer tools', () => {
        const sidebar = source('src/lib/SideBars/Sidebar.svelte')
        for (const [name, asset] of [
            ['share-bold', 'src/assets/solar-bold/share-bold.svg'],
            ['magnifier-bug-bold', 'src/assets/solar-bold/magnifier-bug-bold.svg'],
        ]) {
            expect(existsSync(resolve(process.cwd(), asset))).toBe(true)
            expect(sidebar).toContain(`name="${name}"`)
        }
        expect(sidebar).not.toContain('<WrenchIcon')
    })

    test('shares one toolbar button state model while chat keeps a visible idle state', () => {
        const sidebar = source('src/lib/SideBars/Sidebar.svelte')
        const styles = source('src/styles.css')
        expect(sidebar).toContain('character-toolbar-button--chat')
        expect(sidebar.match(/character-toolbar-button/g)?.length).toBeGreaterThanOrEqual(7)
        expect(sidebar).toContain(
            "class:is-active={!$botMakerMode && !devTool && !$risuBardGalleryOpen}",
        )
        expect(sidebar).toContain("class:is-active={$risuBardGalleryOpen}")
        expect(sidebar).toContain("class:is-active={$botMakerMode && !devTool && $CharConfigSubMenu === 0}")
        expect(styles).toContain('.character-toolbar-button--chat:not(.is-active)')
        expect(styles).toContain('.character-toolbar-button.is-active')
        expect(styles).toContain('transform: translateY(-1px)')
    })

    test('uses one vertical gap around the character toolbar and following heading', () => {
        const sidebar = source('src/lib/SideBars/Sidebar.svelte')
        const chatList = source('src/lib/SideBars/SideChatList.svelte')
        expect(sidebar).toMatch(
            /data-character-config-navigation[^>]*class="my-2 /
        )
        expect(chatList).toContain(
            '<section data-current-chat-section class="border-b border-darkborderc pb-2">'
        )
        expect(chatList).not.toContain('<section class="mt-1 border-b')
        expect(chatList).not.toContain('data-current-chat-label')
    })

    test('places persona binding above prompt binding in the character sidebar', () => {
        const chatList = source('src/lib/SideBars/SideChatList.svelte')
        const personaPosition = chatList.indexOf('<PersonaBind />')
        const promptPosition = chatList.indexOf('<PromptBind />')

        expect(personaPosition).toBeGreaterThan(-1)
        expect(promptPosition).toBeGreaterThan(-1)
        expect(personaPosition).toBeLessThan(promptPosition)
    })

    test('labels the toggle area as per-chat preset pinning', () => {
        expect(languageKorean.toggleBindingLabel).toBe('채팅별 프리셋 고정')
    })

    test('keeps nine ordered toolbar actions and moves secondary actions into a menu', () => {
        const chatList = source('src/lib/SideBars/SideChatList.svelte')
        const toolbar = chatList.slice(chatList.indexOf('data-chat-list-toolbar'), chatList.indexOf('{#key sorted}'))
        const actions = ['data-sidebar-new-chat', 'data-chat-rename', 'data-chat-copy', 'data-chat-merge',
            'data-chat-branch', 'data-chat-delete', 'data-chat-new-folder', 'data-chat-manager-open', 'data-chat-more']
        const positions = actions.map(action => toolbar.indexOf(action))
        expect(positions.every(position => position >= 0)).toBe(true)
        expect(positions).toEqual([...positions].sort((a, b) => a - b))
        expect(toolbar).not.toContain('flex-wrap')
        const menu = toolbar.slice(toolbar.indexOf('<ShDropdownMenuContent'), toolbar.indexOf('</ShDropdownMenuContent>'))
        expect(menu).toContain('onSelect={exportAllChats}')
        expect(menu).toContain('onSelect={importChat}')
        expect(menu).toContain('$bookmarkListOpen = true')
        expect(toolbar.match(/<ShButton\b/g)).toHaveLength(8)
    })

    test('gives the list its own scroll area and keeps the sidebar handle outside scrolling content', () => {
        const chatList = source('src/lib/SideBars/SideChatList.svelte')
        const sidebar = source('src/lib/SideBars/Sidebar.svelte')
        expect(chatList).toContain('data-chat-list-scroll')
        expect(chatList).toContain('style:height={`${chatListHeight}px`}')
        expect(chatList).toContain('scrollbar-gutter: stable')
        expect(chatList).toContain('<SidebarResizeHandle axis="height" target={listEle}')
        expect(sidebar).toContain('data-character-sidebar-scroll')
        expect(sidebar).toContain('<SidebarResizeHandle axis="width" target={sidebarElement}')
        expect(sidebar).toContain('style:--sidebar-size={sidebarWidth}')
    })
})
