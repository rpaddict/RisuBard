# Prompt V2 Workbench Implementation Plan

> **For Codex:** Execute this plan inline in the current `RisuBard-public` checkout. Preserve the legacy Prompt tab and the existing preset schema.

**Goal:** Add a desktop-oriented Prompt V2 tab that edits the active prompt preset through a three-pane visual workspace with compatible conditional blocks, a searchable toggle variable library, and an isolated live sidebar preview.

**Architecture:** Keep `PromptItem` and `botPreset` unchanged. Visual activation rules compile into existing CBS wrappers stored in each compatible prompt text field. The V2 workspace edits the same `DBState.db.promptTemplate` and `customPromptTemplateToggle` fields as the legacy editor, while preview values remain local and never write to chat/global variables.

**Tech Stack:** Svelte 5, TypeScript, Tailwind semantic theme utilities, Vitest, existing RisuBard UI controls.

---

## Task 1: Lock the compatibility contract

**Files:**
- Create: `src/ts/promptV2.test.ts`
- Create: `src/lib/Setting/Pages/PromptPreset/PromptV2Workspace.test.ts`

1. Test AND/OR and positive/negative activation compilation.
2. Test the generated CBS through `risuChatParser` with request-scoped global variables.
3. Test legacy single-condition `#if_pure` recognition and opaque preservation of unsupported manual wrappers.
4. Test parsing the custom-toggle DSL into a master variable list.
5. Test tab order, three-pane landmarks, and preview-state isolation at the component boundary.
6. Run the focused tests and confirm they fail before implementation.

## Task 2: Implement the compatibility layer

**Files:**
- Create: `src/ts/promptV2.ts`

1. Define serializable in-memory condition models without adding persisted schema fields.
2. Compile comparisons to nested `equal`/`notequal` CBS expressions and combine their boolean results with existing `#when::keep` AND/OR operators.
3. Parse V2 wrappers plus the common legacy `#if_pure {{? ...}}` wrapper.
4. Treat unrecognized hand-written condition syntax as opaque and non-destructive.
5. Parse and group the existing custom-toggle DSL for the variable library and preview.
6. Run focused unit tests.

## Task 3: Build the Prompt V2 workspace

**Files:**
- Create: `src/lib/Setting/Pages/PromptPreset/PromptV2Workspace.svelte`
- Create: `src/lib/Setting/Pages/PromptPreset/PromptV2BlockList.svelte`
- Create: `src/lib/Setting/Pages/PromptPreset/PromptV2BlockEditor.svelte`
- Create: `src/lib/Setting/Pages/PromptPreset/PromptV2TogglePreview.svelte`
- Create: `src/lib/Setting/Pages/PromptPreset/PromptV2ToggleEditor.svelte`

1. Build a compact toolbar for prompt/toggle modes, pane visibility, search, and preview reset.
2. Render every prompt block in a navigable left list with selection, state badges, add/delete, and reorder controls.
3. Edit the selected block in the center pane, including compatible prompt fields and visual activation rules.
4. Support group-wide AND/OR and per-condition `is`/`is not`; provide appropriate values for switches and selects.
5. Provide a searchable, copy/insert-friendly master toggle list.
6. Render the right pane from the same toggle DSL parser and existing control primitives using isolated draft values.
7. Provide a focused responsive fallback that switches panes rather than compressing three columns.

## Task 4: Wire navigation and copy

**Files:**
- Modify: `src/lib/Setting/Pages/PromptPresetSettings.svelte`
- Modify: `src/ts/setting/searchIndex.ts`
- Modify: `src/lang/en.ts`
- Modify: `src/lang/ko.ts`

1. Insert Prompt V2 immediately after Prompt.
2. Shift Parameters and Advanced indices, including settings search deep links.
3. Make the settings page resizable only while Prompt V2 is active.
4. Add concise English fallback and complete Korean UI copy.

## Task 5: Verify and document

**Files:**
- Modify: `patchnote/0.9.23.md`

1. Run focused Vitest tests.
2. Run `svelte-check`, the prompt/settings-related tests, help-key validation, and theme-token validation.
3. Start the local app, exercise the V2 workflow with Playwright, and capture a screenshot if the environment permits.
4. Add one user-facing patch-note entry without overwriting existing work.
5. Inspect the final diff and working tree for unrelated changes.
