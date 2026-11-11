import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'

function source(file: string): string {
    return readFileSync(`src/lib/UI/Realm/${file}`, 'utf8')
}

describe('RisuRealm browser experience', () => {
    test('home realm mode shows, collapses without loading, or removes RisuRealm', () => {
        const home = source('RealmHome.svelte')
        const mobile = readFileSync('src/lib/Mobile/MobileBody.svelte', 'utf8')

        expect(readFileSync('src/lib/UI/MainMenu.svelte', 'utf8')).toContain("import Hub from './Realm/RealmHome.svelte'")
        expect(mobile).toContain('<RealmHome showRemovedHint />')
        expect(home).toContain("{#if mode === 'show'}")
        expect(home).toContain("{:else if mode === 'collapsed' && expanded}")
        expect(home.match(/<RealmMain \/>/g)).toHaveLength(2)
        expect(home).toContain('{:else if showRemovedHint}')
    })

    test('opens the full Realm browser as the main screen without related links', () => {
        const mainMenu = readFileSync('src/lib/UI/MainMenu.svelte', 'utf8')

        expect(mainMenu).toContain('<Hub />')
        expect(mainMenu).not.toContain('Get More')
        expect(mainMenu).not.toContain('Related Links')
        expect(mainMenu).not.toContain('OpenRealmStore')
    })

    test('uses native form submission so Enter runs the same search as the button', () => {
        const main = source('RealmMain.svelte')

        expect(main).toContain('<form')
        expect(main).toContain('onsubmit={submitSearch}')
        expect(main).toContain('type="submit"')
    })

    test('searches creator names alongside character text and removes duplicate cards', () => {
        const main = source('RealmMain.svelte')

        expect(main).toContain('function currentAuthorSearch()')
        expect(main).toContain('`author:${textQuery}`')
        expect(main).toContain('Promise.all(searches.map')
        expect(main).toContain('new Map(results.flat().map((chara) => [chara.id, chara]))')
        expect(main).toContain('이름, 설명, 제작자 또는 정확한 태그')
        expect(main).toContain('name, description, creator, or an exact tag')
    })

    test('keeps the initial unfiltered Realm request when the search field is empty', () => {
        const main = source('RealmMain.svelte')

        expect(main).toContain('const baseSearch = currentSearch();')
        expect(main).toContain('const searches = authorSearch && authorSearch !== baseSearch')
        expect(main).toContain('? [baseSearch, authorSearch]')
        expect(main).toContain(': [baseSearch];')
    })

    test('searches immediately when a card creator name is clicked', () => {
        const main = source('RealmMain.svelte')
        const card = source('RealmHubIcon.svelte')

        expect(main).toContain('function searchByAuthor(author: string)')
        expect(main).toContain('onAuthorClick={searchByAuthor}')
        expect(card).toContain('onAuthorClick?: (author: string) => void')
        expect(card).toContain('onAuthorClick(chara.authorname)')
        expect(card).toContain('event.stopPropagation()')
    })

    test('offers a keyboard-driven autocomplete for each space-separated tag', () => {
        const main = source('RealmMain.svelte')
        const util = readFileSync('src/ts/util.ts', 'utf8')
        expect(main).toContain('TagList')
        expect(main).not.toContain('<datalist')
        expect(main).toContain('role="listbox"')
        expect(main).toContain('onkeydown={handleTagKeydown}')
        expect(main).toContain("event.key === 'ArrowDown'")
        expect(main).toContain("event.key === 'ArrowUp'")
        expect(main).toContain("event.key === 'Tab' || event.key === 'Enter'")
        expect(main).toContain("tagSearch.split(/\\s+/)")
        expect(main).toContain(".map((tag) => `tag:${tag}`)")
        expect(main).toContain('completedTags.has(tag.value.toLowerCase())')
        expect(util).toContain('tag.value.toLowerCase().startsWith(realQuery)')
    })

    test('shows every tag alphabetically when the empty tag field is focused', () => {
        const main = source('RealmMain.svelte')

        expect(main).toContain(".sort((a, b) => a.value.localeCompare(b.value))")
        expect(main).toContain("return query ? matches.slice(0, 8) : matches")
        expect(main).toContain("tagInputFocused && tagSuggestions.length > 0")
        expect(main).not.toContain("tagInputFocused && tagFragment.length > 0")
    })

    test('linkifies bare URLs only when the Realm description opts in', () => {
        const parser = readFileSync('src/ts/parser/parser.svelte.ts', 'utf8')
        const display = readFileSync('src/lib/UI/GUI/MultiLangDisplay.svelte', 'utf8')
        const popup = source('RealmPopUp.svelte')

        expect(parser).toContain('mdHighlightLinkify')
        expect(parser).toContain('renderOptions: { linkify?: boolean } = {}')
        expect(display).toContain('{ linkify })')
        expect(popup).toContain('linkify={true}')
    })

    test('uses the shared dialog surface so selecting or dragging text does not close details', () => {
        const popup = source('RealmPopUp.svelte')

        expect(popup).toContain("import ShDialog from '../GUI/ShDialog.svelte'")
        expect(popup).toContain('<ShDialog')
        expect(popup).toContain('closeOnOutsideClick={!busy}')
        expect(popup).toContain('tier="base"')
        expect(source('RealmMain.svelte')).toContain('$showRealmInfoStore = chara')
        expect(source('RealmMain.svelte')).not.toContain('<RealmPopUp')
        expect(popup).not.toContain('role="button" tabindex="0" onclick={() => {\n    openedData = null')
    })

    test('keeps the Realm detail actions reachable on short mobile viewports', () => {
        const popup = source('RealmPopUp.svelte')

        expect(popup).toContain('max-h-[calc(100dvh-1rem)]')
        expect(popup).toContain('bodyClass="min-h-0 min-w-0 flex-1 overflow-y-auto"')
        expect(popup).toContain('max-h-none')
        expect(popup).toContain('md:max-h-64 md:overflow-y-auto')
    })

    test('uses current theme-token surfaces for the browser and cards', () => {
        const main = source('RealmMain.svelte')
        const card = source('RealmHubIcon.svelte')

        expect(main).toContain('border-darkborderc')
        expect(main).toContain('bg-darkbg')
        expect(main).toContain('rounded-2xl')
        expect(card).toContain('border-darkborderc')
        expect(card).toContain('hover:-translate-y-1')
    })

    test('shows Korean copy throughout the Realm UI when Korean is selected', () => {
        const main = source('RealmMain.svelte')
        const popup = source('RealmPopUp.svelte')
        const card = source('RealmHubIcon.svelte')
        const license = source('RealmLicense.svelte')

        for (const component of [main, popup, card, license]) {
            expect(component).toContain("DBState.db.language === 'ko'")
        }
        expect(main).toContain('RisuRealm 둘러보기')
        expect(main).toContain('캐릭터 검색')
        expect(main).toContain('태그를 공백으로 구분해 입력')
        expect(main).toContain('검색 결과가 없습니다.')
        expect(popup).toContain('다운로드 후 채팅')
        expect(popup).toContain('원본 캐릭터 보기')
        expect(card).toContain('다운로드')
        expect(license).toContain('라이선스')
    })
})
