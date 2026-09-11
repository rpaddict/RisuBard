import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, test } from 'vitest'

const source = (path: string): string => readFileSync(resolve(process.cwd(), path), 'utf8')
const optionalSource = (path: string): string => existsSync(resolve(process.cwd(), path)) ? source(path) : ''

describe('persona builder UI connections', () => {
    test('matches character lore for each send using the captured input and draft before generating', () => {
        const builder = source('src/lib/Others/PersonaBuilder.svelte')
        const send = builder.slice(builder.indexOf('async function sendRequest()'), builder.indexOf('function undoDraft()'))
        expect(send).toContain("sources: { ...sources, characterLorebook: '' }")
        expect(send).toContain('requestInput.selections.characterLorebook')
        expect(send).toContain('await matchPersonaBuilderCharacterLorebook(')
        expect(send).toContain('userInstruction: requestInput.userInstruction')
        expect(send).toContain('draft: requestInput.draft')
        expect(send).toContain('requestInput.sources.characterLorebook = matched.content')
        expect(send).toContain('requestInput.sources.characterLorebookSources = matched.sources')
        expect(send).toMatch(/await matchPersonaBuilderCharacterLorebook[\s\S]*if \(controller.signal.aborted\) return[\s\S]*buildPersonaBuilderMessages\(requestInput\)[\s\S]*await requestChatData/)
    })

    test('renders the iterative builder in a themed nested dialog', () => {
        const builder = source('src/lib/Others/PersonaBuilder.svelte')

        expect(builder).toContain('<ShDialog')
        expect(builder).toContain('size="xl"')
        expect(builder).toContain('tier="base"')
        expect(builder).toContain('PersonaPromptPresetEditor')
        expect(builder).toContain("kind=\"task\"")
        expect(builder).toContain("kind=\"style\"")
        expect(builder).toContain('data-persona-builder-context')
        expect(builder.match(/type="checkbox"/g)).toHaveLength(4)
        expect(builder).toContain('data-persona-builder-instruction')
        expect(builder).toContain('data-persona-builder-draft')
        expect(builder).toContain('requestChatData')
        expect(builder).toContain('buildPersonaBuilderMessages')
        expect(builder).toContain('AbortController')
        expect(builder).toContain("logPurpose: 'persona-builder'")
    })

    test('provides reusable preset selection and mutation controls', () => {
        const builder = source('src/lib/Others/PersonaBuilder.svelte')
        const editor = source('src/lib/Others/PersonaPromptPresetEditor.svelte')

        expect(editor).toContain('<ShAccordion')
        expect(editor).toContain('<ShSelect')
        expect(editor).toContain('PERSONA_BUILDER_BUILTIN_PRESETS')
        expect(editor).toContain('createPersonaBuilderUserPreset')
        expect(editor).toContain('overwritePersonaBuilderUserPreset')
        expect(editor).toContain('deletePersonaBuilderUserPreset')
        expect(editor).toContain('requestImmediateSave')
        expect(editor).toContain('data-persona-prompt-preset-save')
        expect(editor).toContain('data-persona-prompt-preset-overwrite')
        expect(editor).toContain('data-persona-prompt-preset-delete')
        expect(builder).toContain('DBState.db.personaBuilderStylePromptPresetId')
        expect(builder).toContain('resolvePersonaBuilderPromptPreset')
        expect(editor).toContain('DBState.db.personaBuilderStylePromptPresetId = id || undefined')
    })

    test('keeps the result editable and exposes send, reset, and copy actions', () => {
        const builder = source('src/lib/Others/PersonaBuilder.svelte')

        expect(builder).toContain('bind:value={draft}')
        expect(builder).toContain('sendRequest')
        expect(builder).toContain('resetBuilder')
        expect(builder).toContain('onCopyDraft')
        expect(builder).toContain('{copy.send}')
        expect(builder).toContain('{copy.reset}')
        expect(builder).toContain('{copy.copyDraft}')
        expect(builder).toContain("void initializeBuilder('')")
        expect(builder).not.toContain('variant="outline" disabled={generating} onclick={resetBuilder}')
    })

    test('uses compact instruction actions and keeps the instruction after generation', () => {
        const builder = source('src/lib/Others/PersonaBuilder.svelte')
        const korean = source('src/lang/ko.ts')

        expect(korean).toContain('instructionLabel: "AI에게 지시하세요"')
        expect(builder).toContain('data-persona-builder-instruction-row')
        expect(builder).toContain('data-persona-builder-instruction-actions')
        expect(builder).toContain('data-persona-builder-send')
        expect(builder).toContain('data-persona-builder-reset')
        expect(builder).toContain("variant={generating ? 'destructive' : 'primary'}")
        expect(builder).toContain('disabled={generating}')
        expect(builder.match(/userInstruction = ''/g)).toHaveLength(1)
        expect(builder).not.toMatch(/<SendIcon[^>]*\/?>\s*\{copy\.send\}/s)
    })

    test('stores the previous draft and exposes undo in the draft heading', () => {
        const builder = source('src/lib/Others/PersonaBuilder.svelte')

        expect(builder).toContain("let previousDraft = $state('')")
        expect(builder).toContain('let canUndoDraft = $state(false)')
        expect(builder).toContain('previousDraft = draft')
        expect(builder).toContain('function undoDraft()')
        expect(builder).toContain('data-persona-builder-undo')
        expect(builder).toMatch(/draft-heading[\s\S]*data-persona-builder-undo/)
    })

    test('uses a viewport-bounded dialog and shared semantic surface layers', () => {
        const builder = source('src/lib/Others/PersonaBuilder.svelte')
        const personas = source('src/lib/Setting/Pages/PersonaSettings.svelte')
        const styles = source('src/styles.css')

        expect(builder).toContain('var(--manager-height, 90dvh)')
        expect(styles).toContain('--color-surface-base:')
        expect(styles).toContain('--color-surface-raised:')
        expect(styles).toContain('--color-surface-inset:')
        expect(builder).toContain('var(--color-surface-base)')
        expect(builder).toContain('var(--color-surface-raised)')
        expect(builder).toContain('var(--color-surface-inset)')
        expect(personas).toContain('var(--color-surface-raised)')
    })

    test('places the builder between the persona manager and nested confirmation dialogs', () => {
        const builder = source('src/lib/Others/PersonaBuilder.svelte')
        const manager = source('src/lib/Others/PersonaManager.svelte')
        const alerts = source('src/lib/Others/AlertComp.svelte')
        const confirmStart = alerts.indexOf("open={$alertStore.type === 'ask'}")
        const confirmEnd = alerts.indexOf('</ShAlertDialog>', confirmStart)
        const confirmDialog = alerts.slice(confirmStart, confirmEnd)

        expect(builder).toContain('tier="base"')
        expect(manager).not.toContain('data-risu-modal-tier')
        expect(builder).toContain('overlayClass="z-[45]"')
        expect(builder).toContain('contentClass="persona-builder-dialog z-[45]"')
        expect(confirmStart).toBeGreaterThan(-1)
        expect(confirmDialog).not.toContain('tier="base"')
    })

    test('keeps stale aborted requests from clearing a newer request state', () => {
        const builder = source('src/lib/Others/PersonaBuilder.svelte')

        expect(builder).toMatch(/finally\s*\{\s*if \(abortController === controller\) \{\s*abortController = null\s*generating = false/s)
    })

    test('annotates each unavailable context source', () => {
        const builder = source('src/lib/Others/PersonaBuilder.svelte')

        expect(builder.match(/copy\.contextUnavailable/g)).toHaveLength(4)
    })

    test('supports viewport-bounded resizing and responsive draft comparison', () => {
        const builder = source('src/lib/Others/PersonaBuilder.svelte')
        const splitter = optionalSource('src/lib/UI/GUI/DraftSplitHandle.svelte')

        expect(builder).toContain("import ManagerResizeHandles from 'src/lib/UI/GUI/ManagerResizeHandles.svelte'")
        expect(builder).toContain('let dialogElement = $state<HTMLElement | null>(null)')
        expect(builder).toContain('bind:contentElement={dialogElement}')
        expect(builder).toContain('<ManagerResizeHandles target={dialogElement} centered')
        expect(builder).toContain('closeOnOutsideClick={true}')
        expect(builder).toContain('var(--manager-width, 56rem)')
        expect(builder).toContain('calc(100vw - 2rem)')
        expect(builder).toContain('calc(100dvh - 2rem)')

        expect(builder).toContain('class="context-options"')
        expect(builder).toContain('grid-template-columns: repeat(4, minmax(0, 1fr))')
        expect(builder).toMatch(/\.context-panel label span \{[^}]*font-size: \.75rem/)
        expect(builder).not.toContain('font-size: .65rem')
        expect(builder).not.toContain('sm:grid-cols-2')

        expect(builder).toContain("let originalDraft = $state('')")
        expect(builder).toContain('originalDraft = currentDescription')
        expect(builder).toContain('data-persona-builder-draft-comparison')
        expect(builder).toContain("import DraftSplitHandle from 'src/lib/UI/GUI/DraftSplitHandle.svelte'")
        expect(builder).toContain('<DraftSplitHandle target={draftComparisonElement}')
        expect(builder).toContain('grid-template-rows: 2rem minmax(14rem, 1fr)')
        expect(builder).toContain('var(--draft-left-width, 1fr)')
        expect(builder).toContain('var(--draft-right-width, 1fr)')
        expect(builder).toContain('data-persona-builder-original')
        expect(builder).toMatch(/data-persona-builder-original[\s\S]*?readonly/)
        expect(builder).toContain('data-persona-builder-draft')
        expect(builder).toContain('overflow-y: scroll')
        expect(builder).toMatch(/@media \(max-width: 700px\)[\s\S]*?grid-template-columns: 1fr/)

        expect(splitter).toContain('use:resizeHandle')
        expect(splitter).toContain('data-draft-split-resize')
        expect(builder).toContain('resizeStorageKey="persona-builder-dialog"')
        expect(builder).toContain('resizeStorageKey="persona-builder-draft-split"')
        expect(builder).toContain("use:persistElementHeight={'persona-builder-instruction'}")
        expect(builder).toContain("use:persistElementHeight={'persona-builder-original'}")
        expect(builder).toContain("use:persistElementHeight={'persona-builder-revision'}")
        expect(builder).toMatch(/\.draft-pane \.builder-textarea \{[^}]*resize: vertical;[^}]*overflow-y: scroll;/)
    })

    test('starts with an empty revision while sending the original as the first draft context', () => {
        const builder = source('src/lib/Others/PersonaBuilder.svelte')

        expect(builder).toContain("async function initializeBuilder(initialDraft = '')")
        expect(builder).toContain('draft: draft.trim() ? draft : originalDraft')
    })

    test('dismisses only the persona manager backdrop layer', () => {
        const manager = source('src/lib/Others/PersonaManager.svelte')

        expect(manager).toContain('function closeFromBackdrop(event: MouseEvent)')
        expect(manager).toContain('if (event.target === event.currentTarget) close()')
        expect(manager).toContain('class="risu-modal-overlay persona-manager-backdrop" onclick={closeFromBackdrop}')
    })
})
