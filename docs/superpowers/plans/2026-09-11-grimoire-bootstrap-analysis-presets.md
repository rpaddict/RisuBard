# Grimoire Bootstrap and Analysis Presets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a new chat's active first message usable as bounded Grimoire retrieval evidence, then add editable protected analysis-instruction presets and a denser resizable analysis workbench.

**Architecture:** Keep the first message as evidence rather than a current-turn instruction: it may add entity/location anchors and sparse terms, but only the latest user input supplies list/count/facet commands. Add a Grimoire-specific global preset store with one protected built-in preset and editable duplicates; snapshot the compiled instruction into each analysis run. Reuse the existing dialog and resize primitives instead of coupling Grimoire to Wiki Prompt presets.

**Tech Stack:** TypeScript, Svelte 5, Vitest, existing `ShDialog`, `resizeHandle`, and RisuBard DB normalization.

---

### Task 1: First-message retrieval bootstrap

**Files:**
- Modify: `src/ts/process/lorebook.svelte.ts`
- Modify: `src/ts/lorebook/bardLoreRetrieval.ts`
- Modify: `src/ts/lorebook/bardLoreQueryPlanner.ts`
- Test: `src/ts/process/lorebookRecursion.test.ts`
- Test: `src/ts/lorebook/bardLoreQueryPlanner.test.ts`
- Modify: `docs/ko/grimoire-ai-analysis.md`
- Modify: `patchnote/0.9.30.md`

- [ ] **Step 1: Write the failing cold-start test**

Add a new-chat fixture whose first message names a location, whose latest user input is generic, and whose character entry has an `ambient` reverse link to that location. Assert both the location and character are injected.

```ts
expect(result.actives.map((entry) => entry.prompt)).toEqual(
    expect.arrayContaining(['SCHOOL FACT', 'STUDENT PROFILE'])
)
```

- [ ] **Step 2: Verify RED**

Run: `npx vitest run src/ts/process/lorebookRecursion.test.ts -t "uses the active first message"`

Expected: FAIL because the first message is not part of the Grimoire query.

- [ ] **Step 3: Add bounded evidence plumbing**

Extend selection/planning with a separate evidence string. Build filters, cardinality, and arbitrary/list intent only from the latest user input, while allowing the evidence string to contribute anchors and a location-driven scene intent.

```ts
const plan = planBardLoreQuery(
    currentQuery,
    compileBardLoreIndex(eligible),
    settings,
    input.scopeAliases,
    input.routingEvidence,
)
```

In the live loader, include the parsed selected greeting only when it is enabled, no `allBefore` boundary exists, `contextMessages > 0`, and the chat is still inside that bounded early window.

- [ ] **Step 4: Verify GREEN and edge behavior**

Run the focused process and retrieval/planner suites. Confirm disabled/reset greetings are not used and current-input filter semantics remain unchanged.

- [ ] **Step 5: Document and commit independently**

Update the Grimoire help and patch note, stage only Task 1 hunks, then commit:

```text
fix: use first message for Grimoire bootstrap
```

### Task 2: Grimoire analysis instruction preset domain

**Files:**
- Create: `src/ts/lorebook/bardLoreInstructionPreset.ts`
- Create: `src/ts/lorebook/bardLoreInstructionPreset.test.ts`
- Modify: `src/ts/lorebook/bardLoreAnalysis.ts`
- Modify: `src/ts/lorebook/bardLore.ts`
- Modify: `src/ts/storage/database.svelte.ts`
- Test: `src/ts/lorebook/bardLoreAnalysis.test.ts`
- Test: `src/ts/lorebook/bardLore.test.ts`

- [ ] **Step 1: Write failing preset normalization tests**

Specify schema-1 presets with `id`, `name`, `revision`, `builtin`, and one instruction template string. Assert normalization restores the exact protected working default, resolves missing IDs to it, duplicates as editable, and rejects deletion of the built-in.

- [ ] **Step 2: Verify RED**

Run the new preset test and confirm the missing module/API causes the failure.

- [ ] **Step 3: Implement the focused preset module**

Provide `createDefault`, `normalizeState`, `resolve`, `duplicate`, `delete`, and `compile` functions. Move the already working Grimoire analysis instruction into this single canonical protected default instead of copying it or borrowing Wiki Prompt text. Keep its runtime language/filter slots and add explicit classification guidance:

```text
system/output contract -> kind system; recommend required only for genuinely per-request rules
composite roster/timeline -> index-only plus exact-source atoms
character/location relationship -> justified ambient/discoverable/supporting/none link
```

- [ ] **Step 4: Persist and snapshot**

Normalize `risuBardGrimoirePromptPresets` and `risuBardGrimoirePromptPresetId` during DB load. Snapshot the selected preset into new analysis runs so resume/retry remains reproducible.

- [ ] **Step 5: Route prompt planning and execution through the snapshot**

Pass the compiled instruction to token planning and request construction. Existing runs without a snapshot use the legacy built-in instruction for compatibility.

- [ ] **Step 6: Verify the domain suites**

Run the preset, analysis, run-normalization, and storage/settings tests.

### Task 3: Shared settings page and manager above the analysis dialog

**Files:**
- Create: `src/lib/Setting/Pages/RisuBardGrimoirePromptSettings.svelte`
- Create: `src/lib/Setting/Pages/RisuBardGrimoirePromptWorkspace.svelte`
- Create: `src/lib/Setting/Pages/RisuBardGrimoirePromptSettings.test.ts`
- Modify: `src/ts/routing.ts`
- Modify: `src/ts/setting/settingsNavigation.ts`
- Modify: `src/ts/setting/searchManifestData.ts`
- Modify: `src/ts/setting/searchIndex.ts`
- Modify: `src/lib/Setting/Settings.svelte`
- Modify: `src/lib/Setting/SettingsNavigation.svelte`
- Modify: `src/lib/SideBars/LoreBook/BardLoreAnalysisPanel.svelte`
- Modify: `src/lib/Setting/Pages/RisuBardGrimoireLanguageSettings.svelte`
- Modify: `src/lang/ko.ts`
- Modify: `src/lang/en.ts`

- [ ] **Step 1: Write failing UI tests**

Assert a “Grimoire prompts” sidebar item appears immediately below Wiki prompts, both entry points use the same workspace, the analysis manager uses `ShDialog tier="top"`, the built-in textarea/name/delete controls are disabled, duplicate selects an editable copy, and selection replans the token estimate.

- [ ] **Step 2: Verify RED**

Run the two Grimoire UI component suites and confirm the manager/button assertions fail.

- [ ] **Step 3: Build the preset manager**

Use one compact editor with a preset selector, a full instruction-template textarea, duplicate/delete actions, and a read-only badge for the default. Only duplicated presets are editable.

- [ ] **Step 4: Connect the active preset**

Open the shared workspace above the analysis dialog, resolve the active preset from `DBState`, and pass its compiled instruction to planning and run creation. Add a dedicated settings page directly below Wiki prompts and make the common-language preview show the active preset.

- [ ] **Step 5: Verify UI behavior**

Run component tests for protected defaults, editable copies, selection, persistence callbacks, and top-tier stacking.

### Task 4: Dense resizable analysis workbench

**Files:**
- Modify: `src/lib/SideBars/LoreBook/BardLoreAnalysisPanel.svelte`
- Test: `src/lib/SideBars/LoreBook/BardLoreAnalysisPanel.test.ts`

- [ ] **Step 1: Write failing layout/resize tests**

Assert a vertical settings/plan split handle exists in the left pane, the main workbench consumes the dialog's available height, and the review area uses a bounded resizable row instead of creating unused bottom space.

- [ ] **Step 2: Verify RED**

Run the panel suite and confirm the new handle and CSS contract assertions fail.

- [ ] **Step 3: Implement compact composition**

Group the five numeric settings into a denser grid, reduce card padding/gaps, add a row-resize separator between settings and request plan, and make the workbench/review rows fill the resized dialog without fixed `64vh` dead space. Hide internal splitters on narrow screens.

- [ ] **Step 4: Verify interaction and accessibility**

Test pointer/keyboard resize, reset-on-double-click, separator roles/orientation, narrow-screen fallback, and that target scrolling remains contained.

### Task 5: Documentation, patch note, and final commit

**Files:**
- Modify: `../project_wiki/bard_lore_architecture.md`
- Modify: `docs/ko/grimoire-ai-analysis.md`
- Modify: `patchnote/0.9.30.md`

- [ ] **Step 1: Update the reviewed contracts**

Record bounded first-message evidence, protected Grimoire instruction presets, run snapshots, and the classification/link guidance without changing the legacy `alwaysActive` migration rule.

- [ ] **Step 2: Run targeted validation**

Run all changed Grimoire domain/UI suites, `git diff --check`, and the affected TypeScript/package validation if targeted tests reveal cross-package type errors.

- [ ] **Step 3: Inspect the staged diff**

Confirm only Grimoire-related hunks are staged and all pre-existing worktree changes remain unstaged.

- [ ] **Step 4: Commit the remaining feature**

```text
feat: add Grimoire analysis instruction presets
```
