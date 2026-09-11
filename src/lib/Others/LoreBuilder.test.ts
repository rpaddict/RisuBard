import { readFileSync } from 'node:fs'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = (path: string): string => readFileSync(resolve(process.cwd(), path), 'utf8')
const optionalSource = (path: string): string => existsSync(resolve(process.cwd(), path)) ? source(path) : ''

describe('lore builder UI contract', () => {
    it('offers lore presets, four explicit context switches, and iterative draft controls', () => {
        const builder = source('src/lib/Others/LoreBuilder.svelte')

        expect(builder).toContain('LorePromptPresetEditor')
        expect(builder).toContain('data-lore-builder-context')
        expect(builder.match(/type="checkbox"/g)).toHaveLength(4)
        expect(builder).toContain('data-lore-builder-instruction')
        expect(builder).toContain('data-lore-builder-send')
        expect(builder).toContain('data-lore-builder-reset')
        expect(builder).toContain('data-lore-builder-draft')
        expect(builder).toContain('data-lore-builder-undo')
        expect(builder).toContain('data-lore-builder-apply')
        expect(builder).toContain("logPurpose: 'lore-builder'")
    })

    it('uses a scrollable opaque child dialog above the lore workspace', () => {
        const builder = source('src/lib/Others/LoreBuilder.svelte')

        expect(builder).toContain('tier="alert"')
        expect(builder).toContain('bodyClass="min-h-0 overflow-y-auto"')
        expect(builder).toContain('var(--manager-height, 90dvh)')
        expect(builder).toContain('background: var(--color-surface-base)')
        expect(builder).toContain('closeOnEscape={true}')
        expect(builder).toContain('closeOnOutsideClick={true}')
        expect(builder).toContain('role="alert"')
        expect(builder).toContain('aria-busy={generating}')
    })

    it('supports viewport-bounded resizing and responsive draft comparison', () => {
        const builder = source('src/lib/Others/LoreBuilder.svelte')
        const splitter = optionalSource('src/lib/UI/GUI/DraftSplitHandle.svelte')
        const english = source('src/lang/en.ts')
        const korean = source('src/lang/ko.ts')

        expect(builder).toContain("import ManagerResizeHandles from 'src/lib/UI/GUI/ManagerResizeHandles.svelte'")
        expect(builder).toContain('let dialogElement = $state<HTMLElement | null>(null)')
        expect(builder).toContain('bind:contentElement={dialogElement}')
        expect(builder).toContain('<ManagerResizeHandles target={dialogElement} centered')
        expect(builder).toContain('var(--manager-width, 56rem)')
        expect(builder).toContain('calc(100vw - 2rem)')
        expect(builder).toContain('calc(100dvh - 2rem)')

        expect(builder).toContain('class="context-options"')
        expect(builder).toContain('grid-template-columns: repeat(4, minmax(0, 1fr))')
        expect(builder).toMatch(/\.context-panel label span \{[^}]*font-size: \.75rem/)
        expect(builder).not.toContain('font-size: .65rem')
        expect(builder).not.toContain('sm:grid-cols-2')

        expect(builder).toContain("let originalDraft = $state('')")
        expect(builder).toContain('originalDraft = currentContent')
        expect(builder).toContain('data-lore-builder-draft-comparison')
        expect(builder).toContain("import DraftSplitHandle from 'src/lib/UI/GUI/DraftSplitHandle.svelte'")
        expect(builder).toContain('<DraftSplitHandle target={draftComparisonElement}')
        expect(builder).toContain('grid-template-rows: 2rem minmax(14rem, 1fr)')
        expect(builder).toContain('var(--draft-left-width, 1fr)')
        expect(builder).toContain('var(--draft-right-width, 1fr)')
        expect(builder).toContain('data-lore-builder-original')
        expect(builder).toMatch(/data-lore-builder-original[\s\S]*?readonly/)
        expect(builder).toContain('data-lore-builder-draft')
        expect(builder).toContain('overflow-y: scroll')
        expect(builder).toMatch(/@media \(max-width: 700px\)[\s\S]*?grid-template-columns: 1fr/)
        expect(english).toContain('originalDraft: "Original"')
        expect(english).toContain('revisedDraft: "Revision"')
        expect(korean).toContain('originalDraft: "원본"')
        expect(korean).toContain('revisedDraft: "수정본"')

        expect(splitter).toContain('use:resizeHandle')
        expect(splitter).toContain("data-draft-split-resize")
        expect(splitter).toContain("--draft-left-width")
        expect(splitter).toContain("--draft-right-width")
        expect(splitter).toContain("@media (max-width: 700px)")
    })

    it('persists lore builder switches, dialog size, split, and textarea heights', () => {
        const builder = source('src/lib/Others/LoreBuilder.svelte')
        const presetEditor = source('src/lib/Others/LorePromptPresetEditor.svelte')
        const splitter = source('src/lib/UI/GUI/DraftSplitHandle.svelte')

        expect(builder).toContain('loadLoreBuilderSelections')
        expect(builder).toContain('saveLoreBuilderSelections')
        expect(builder).toContain('DBState.db.loreBuilderStylePromptPresetId')
        expect(builder).toContain('resolveLoreBuilderPromptPreset')
        expect(presetEditor).toContain('DBState.db.loreBuilderStylePromptPresetId = id || undefined')
        expect(builder).toContain('resizeStorageKey="lore-builder-dialog"')
        expect(builder).toContain('resizeStorageKey="lore-builder-draft-split"')
        expect(builder).toContain("use:persistElementHeight={'lore-builder-instruction'}")
        expect(builder).toContain("use:persistElementHeight={'lore-builder-original'}")
        expect(builder).toContain("use:persistElementHeight={'lore-builder-revision'}")
        expect(builder).toMatch(/\.draft-pane \.builder-textarea \{[^}]*resize: vertical;[^}]*overflow-y: scroll;/)
        expect(splitter).toContain('loadResizableSize')
        expect(splitter).toContain('saveResizableSize')
    })

    it('starts with an empty revision while sending the original as the first draft context', () => {
        const builder = source('src/lib/Others/LoreBuilder.svelte')

        expect(builder).toContain("async function initializeBuilder(initialDraft = '')")
        expect(builder).toContain('draft: draft.trim() ? draft : originalDraft')
    })

    it('preserves the current instruction after generation and guards stale abort cleanup', () => {
        const builder = source('src/lib/Others/LoreBuilder.svelte')

        expect(builder.match(/userInstruction = ''/g)).toHaveLength(1)
        expect(builder).toMatch(/finally\s*\{\s*if \(abortController === controller\) \{\s*abortController = null\s*generating = false/s)
    })

    it('keeps the header concise and places icon undo plus apply beside the revision title', () => {
        const builder = source('src/lib/Others/LoreBuilder.svelte')
        const korean = source('src/lang/ko.ts')

        expect(builder).not.toContain('{#snippet description()}')
        expect(builder).not.toContain('copy.contextHint')
        expect(builder).not.toContain('<Undo2Icon size={15} />{copy.undo}')
        expect(builder).toMatch(/draft-heading[\s\S]*data-lore-builder-undo[\s\S]*data-lore-builder-apply/)
        expect(korean).toContain('applyDraft: "적용"')
    })
})
