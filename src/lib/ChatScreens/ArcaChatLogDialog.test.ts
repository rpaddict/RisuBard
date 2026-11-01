import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, test } from 'vitest'

const source = () => readFileSync(resolve('src/lib/ChatScreens/ArcaChatLogDialog.svelte'), 'utf8')
const chatScreen = () => readFileSync(resolve('src/lib/ChatScreens/DefaultChatScreen.svelte'), 'utf8')

describe('ArcaChatLogDialog shell', () => {
    test('uses the canonical dialog with whole-chat, page, turn, and user-message controls', () => {
        const component = source()

        expect(component).toContain("import ShDialog from '../UI/GUI/ShDialog.svelte'")
        expect(component).toContain('<ShDialog')
        expect(component).toContain('data-arca-log-mode="all"')
        expect(component).toContain('data-arca-log-mode="page"')
        expect(component).toContain('data-arca-log-mode="turn"')
        expect(component).not.toContain('data-arca-log-mode="range"')
        expect(component).toContain('data-arca-log-user-messages')
        expect(component).toContain('risuBardArcaChatIncludeUserMessages')
        expect(component).toContain('data-arca-log-preview')
    })

    test('places range inputs beside the user toggle and shows character and image totals', () => {
        const component = source()

        expect(component).toContain('class="arca-log-range-row"')
        expect(component).toContain('data-arca-log-range-start')
        expect(component).toContain('data-arca-log-range-end')
        expect(component).toContain('summarizeArcaLogMessages')
        expect(component).toContain('selectionSummary.characters')
        expect(component).toContain('selectionSummary.images')
        expect(component).toContain('getChatPageCount')
        expect(component).toContain('getArcaLogTurnCount')
    })

    test('exposes accessible resize handles and the export settings beside the preview', () => {
        const component = source()

        expect(component).toContain("import ManagerResizeHandles from '../UI/GUI/ManagerResizeHandles.svelte'")
        expect(component).toContain('bind:contentElement')
        expect(component).toContain('onResizeEnd={persistDialogSize}')
        expect(component).toContain('risuBardArcaChatDialogSize')
        expect(component).toContain('data-arca-log-setting="font-size"')
        expect(component).toContain('data-arca-log-setting="paragraph-spacing"')
        expect(component).toContain('data-arca-log-setting="image-width"')
        expect(component).toContain('data-arca-log-setting="profile-images"')
        expect(component).toContain('DBState.db.risuBardArcaChatFontSizePx')
        expect(component).toContain('DBState.db.risuBardArcaChatParagraphSpacingPercent')
        expect(component).toContain('DBState.db.risuBardArcaChatImageWidthPercent')
        expect(component).toContain('DBState.db.risuBardArcaChatShowTitleImage')
        expect(component).toContain('data-arca-log-settings-apply')
        expect(component).toContain('data-arca-log-settings-cancel')
        expect(component).toContain('applyAppearanceSettings')
        expect(component).toContain('cancelAppearanceSettings')
    })

    test('uses a compact collapsible sidebar and one-line enlarged section titles', () => {
        const component = source()

        expect(component).toContain('data-arca-log-sidebar-toggle')
        expect(component).toContain('class:sidebar-collapsed={!sidebarOpen}')
        expect(component).not.toContain('language.arcaChatLog.stepOne')
        expect(component).not.toContain('language.arcaChatLog.stepTwo')
        expect(component).toContain('font-size: 1.25rem')
        expect(component).toContain('white-space: nowrap')
    })

    test('ignores outside clicks and waits for visible rendered message content', () => {
        const component = source()

        expect(component).toContain('closeOnOutsideClick={false}')
        expect(component).toContain('hasVisibleArcaLogContent(body)')
    })

    test('shows the target range first and builds only on request, with stop and resume', () => {
        const component = source()

        expect(component).not.toContain('void tick().then(() => generatePreview())\n        }\n        else if (!open)')
        expect(component).toContain('data-arca-log-target')
        expect(component).toContain('excerptArcaLogMessage')
        expect(component).toContain('data-arca-log-stop')
        expect(component).toContain('onclick={stopGeneration}')
        expect(component).toContain('getArcaLogCachedBody')
        expect(component).toContain('setArcaLogCachedBody')
        expect(component).toContain('createArcaImageLoader')
        expect(component).toContain('language.arcaChatLog.resumeBuild')
    })

    test('keeps font size and profile images out of the render key so the frame updates in place', () => {
        const component = source()
        const key = component.slice(component.indexOf('const selectionKey'), component.indexOf('const previewTitle'))

        expect(key).not.toContain('risuBardArcaChatFontSizePx')
        expect(key).not.toContain('risuBardArcaChatShowTitleImage')
        expect(component).toContain('const previewHtml = $derived(')
    })

    test('stages the real chat renderer and copies rich and plain clipboard formats', () => {
        const component = source()

        expect(component).toContain('mount(Chat')
        expect(component).toContain('const requestedKey = selectionKey')
        expect(component).toContain('preparedKey = requestedKey')
        expect(component).toContain('new ClipboardItem')
        expect(component).toContain("'text/html'")
        expect(component).toContain("'text/plain'")
        expect(component).toContain('renderComplexBlock: renderArcaComplexBlock')
        expect(component).toContain("from 'src/ts/arcaSnapshot'")
    })

    test('keeps a responsive single-column mobile layout', () => {
        const component = source()

        expect(component).toMatch(/@media\s*\(max-width:\s*640px\)/)
        expect(component).toContain('grid-template-columns: minmax(0, 1fr)')
    })

    test('is opened from the existing chat menu with the full current chat', () => {
        const screen = chatScreen()

        expect(screen).toContain("import ArcaChatLogDialog from './ArcaChatLogDialog.svelte'")
        expect(screen).toContain('data-open-arca-chat-log')
        expect(screen).toContain('<ArcaChatLogDialog')
        expect(screen).toContain('chat={currentChatSlot}')
    })
})
