# Prompt V2 Navigation Memory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve the Prompt V2 editing location across tabs, turn the toggle-variable library into an expandable usage navigator, and make visual condition blocks movable or removable as complete units.

**Architecture:** Keep transient view state per prompt preset in the Prompt V2 helper module so remounting the settings tab restores its mode, selected block, and editor scroll offsets without changing saved preset data. Derive exact body references from canonical prompt items and pass them into the toggle library; a usage click selects the owning block and asks the block editor to reveal the stored character range in its current source or visual mode. The shared CBS visual editor exposes whole-condition cut, delete, and guarded drag/drop only when Prompt V2 opts into block actions.

**Tech Stack:** Svelte 5, TypeScript, Vitest, happy-dom, existing RisuBard theme tokens and components.

---

### Task 1: Prompt usage and workspace-session helpers

**Files:**
- Modify: `src/ts/promptV2.ts`
- Test: `src/ts/promptV2.test.ts`

- [ ] **Step 1: Write failing tests** for exact `{{getglobalvar::toggle_key}}` references, one-based line numbers, bounded previews, unsupported block exclusion, and preset-scoped transient session state.
- [ ] **Step 2: Run** `vitest run src/ts/promptV2.test.ts` and confirm missing helper exports fail.
- [ ] **Step 3: Add** `PromptV2ToggleUsage`, `findPromptV2ToggleUsages`, `PromptV2WorkspaceSession`, `loadPromptV2WorkspaceSession`, and `savePromptV2WorkspaceSession`. The usage helper returns `{ blockIndex, blockName, line, start, end, preview }`; session state is copied into and out of a module-local map.
- [ ] **Step 4: Re-run** the targeted test and confirm it passes.

### Task 2: Expandable toggle usage navigator and jump wiring

**Files:**
- Modify: `src/lib/Setting/Pages/PromptPreset/PromptV2ToggleEditor.svelte`
- Modify: `src/lib/Setting/Pages/PromptPreset/PromptV2Workspace.svelte`
- Modify: `src/lib/Setting/Pages/PromptPreset/PromptV2BlockEditor.svelte`
- Modify: `src/lang/ko.ts`
- Modify: `src/lang/en.ts`
- Create: `src/lib/Setting/Pages/PromptPreset/PromptV2ToggleEditor.test.ts`
- Test: `src/lib/Setting/Pages/PromptPreset/PromptV2BlockEditor.test.ts`
- Test: `src/lib/Setting/Pages/PromptPreset/PromptV2Workspace.test.ts`

- [ ] **Step 1: Write failing component tests** proving variable rows expose occurrence counts, unfold into block/line/preview buttons, dispatch the selected usage, and the block editor can reveal an exact range.
- [ ] **Step 2: Run the three targeted tests** and confirm the missing UI and reveal method fail.
- [ ] **Step 3: Implement the navigator** with accessible `aria-expanded` disclosure buttons, a separate copy control, compact count badges, and indented occurrence buttons using only canonical theme tokens.
- [ ] **Step 4: Wire navigation** by deriving a usage map in the workspace, switching to prompt mode, selecting the block, awaiting render, and calling `revealBodyRange(start, end)` without changing the last source/visual mode.
- [ ] **Step 5: Re-run the targeted tests** and confirm they pass.

### Task 3: Restore block and toggle-source scroll positions

**Files:**
- Modify: `src/lib/Setting/Pages/PromptPreset/PromptV2Workspace.svelte`
- Modify: `src/lib/Setting/Pages/PromptPreset/PromptV2BlockEditor.svelte`
- Modify: `src/lib/UI/GUI/CbsConditionView.svelte`
- Modify: `src/lib/UI/GUI/TextAreaInput.svelte`
- Modify: `src/lib/Setting/Pages/PromptPreset/PromptV2ToggleEditor.svelte`
- Test: `src/lib/Setting/Pages/PromptPreset/PromptV2BlockEditor.test.ts`
- Test: `src/lib/Setting/Pages/PromptPreset/PromptV2ToggleEditor.test.ts`

- [ ] **Step 1: Add failing tests** that mount editors with saved scroll offsets, assert scroll callbacks report new positions, and prove the stored source/visual mode survives remounting and usage jumps.
- [ ] **Step 2: Run the component tests** and confirm the new props are not yet honored.
- [ ] **Step 3: Add controlled scroll props** to native, highlighted, and visual editors; restore after binding and report user scrolls to the workspace session.
- [ ] **Step 4: Restore workspace mode and selected block** from the preset-scoped session and update it on navigation.
- [ ] **Step 5: Re-run the component tests** and confirm scroll restoration passes.

### Task 4: Whole-condition actions in visual mode

**Files:**
- Modify: `src/lib/UI/GUI/CbsConditionView.svelte`
- Modify: `src/lib/Setting/Pages/PromptPreset/PromptV2BlockEditor.svelte`
- Modify: `src/lang/ko.ts`
- Modify: `src/lang/en.ts`
- Test: `src/lib/UI/GUI/CbsConditionView.test.ts`

- [ ] **Step 1: Write failing tests** proving a nested condition's complete opening/body/closing range is deleted, cut to the clipboard, and moved before or after another complete condition without corrupting either block.
- [ ] **Step 2: Run** `vitest run src/lib/UI/GUI/CbsConditionView.test.ts` and confirm the missing action controls fail.
- [ ] **Step 3: Extend the render tree** with each condition's matching closing-part index, then add opt-in action buttons and draggable condition shells. Delete and cut replace the complete source range; drag/drop rejects a target inside the dragged range and otherwise inserts before or after the target's complete range.
- [ ] **Step 4: Extend visual range reveal** so a reference inside a condition token opens its ancestors, focuses its condition heading, and scrolls that block into view.
- [ ] **Step 5: Re-run the visual editor tests** and confirm all actions and range reveal pass.

### Task 5: Public notes and verification

**Files:**
- Modify: `patchnote/0.9.30.md`

- [ ] **Step 1: Add one `[편의성]` section** describing preserved editing positions and the toggle usage navigator from the user's perspective.
- [ ] **Step 2: Run** the Prompt V2 helper, workspace, block-editor, block-list, and toggle-editor tests.
- [ ] **Step 3: Run** `git diff --check` on the touched files and inspect the final diff for unrelated changes.
