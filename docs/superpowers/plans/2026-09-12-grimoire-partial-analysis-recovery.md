# Grimoire Partial Analysis Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve valid Grimoire analysis candidates from malformed model responses, mark only incomplete targets as failed, and retry those targets separately.

**Architecture:** Keep the existing strict parser and approval contract. Add an opt-out feature flag plus a recovery pass that extracts balanced entry objects, validates complete candidates unchanged, stores normalized previews for incomplete candidates, and partitions one failed batch into completed and failed target groups. Existing apply logic will only apply completed batches; failed previews remain reviewable and retryable.

**Tech Stack:** TypeScript, Svelte 5, Vitest

---

### Task 1: Recover and partition partial responses

**Files:**
- Modify: `src/ts/lorebook/bardLore.ts`
- Modify: `src/ts/lorebook/bardLoreAnalysis.ts`
- Test: `src/ts/lorebook/bardLoreAnalysis.test.ts`

- [x] **Step 1: Write the failing recovery tests**

Add tests proving that a truncated `entries` response preserves every complete entry object, records recoverable fields for an incomplete entry, and partitions only unresolved target IDs into a failed batch.

- [x] **Step 2: Run the focused unit test and verify RED**

Run: `pnpm vitest run src/ts/lorebook/bardLoreAnalysis.test.ts`

Expected: FAIL because the recovery API and batch partition function do not exist.

- [x] **Step 3: Implement the minimal recovery model**

Add an additive optional `recoveredFields` diagnostic to analysis batches. Implement balanced-object extraction under the top-level `entries` array, reuse the strict parser for complete objects, normalize incomplete previews from existing metadata without making them approvable, and partition complete versus unresolved targets. Gate the behavior with `BARD_LORE_PARTIAL_RECOVERY_ENABLED` so setting it to `false` restores the previous all-or-nothing path.

- [x] **Step 4: Run the focused unit test and verify GREEN**

Run: `pnpm vitest run src/ts/lorebook/bardLoreAnalysis.test.ts`

Expected: PASS.

### Task 2: Integrate recovery and problem tracking in the analysis panel

**Files:**
- Modify: `src/lib/SideBars/LoreBook/BardLoreAnalysisPanel.svelte`
- Test: `src/lib/SideBars/LoreBook/BardLoreAnalysisPanel.test.ts`

- [x] **Step 1: Write the failing component test**

Add a mocked response containing one valid entry followed by a truncated entry. Assert that the valid title is complete, the unresolved title is red/failed, its recovered field preview remains visible, and retry requests contain only the unresolved target.

- [x] **Step 2: Run the focused component test and verify RED**

Run: `pnpm vitest run src/lib/SideBars/LoreBook/BardLoreAnalysisPanel.test.ts`

Expected: FAIL because the panel still rejects or splits the full malformed batch without preserving recovered candidates.

- [x] **Step 3: Integrate recovery and diagnostics**

Capture the response text before strict parsing. On a JSON protocol failure, run partial recovery before the existing split/fail path, partition the batch, show recovered incomplete previews in the failure card, and keep the existing red failed-title styling. Preserve the original behavior when the feature flag is disabled or nothing can be recovered.

- [x] **Step 4: Run the focused component test and verify GREEN**

Run: `pnpm vitest run src/lib/SideBars/LoreBook/BardLoreAnalysisPanel.test.ts`

Expected: PASS.

### Task 3: Document and verify the user-visible behavior

**Files:**
- Modify: `../project_wiki/bard_lore_architecture.md`
- Modify: `patchnote/0.9.31.md`

- [x] **Step 1: Update the canonical contract and patch note**

Document that complete candidates from malformed responses are preserved, incomplete targets remain unapplied with derived field diagnostics, and retries are limited to unresolved targets. Add one Korean user-facing patch-note bullet without duplicating existing entries.

- [x] **Step 2: Run affected verification**

Run: `pnpm vitest run src/ts/lorebook/bardLoreAnalysis.test.ts src/lib/SideBars/LoreBook/BardLoreAnalysisPanel.test.ts src/ts/lorebook/bardLore.test.ts`

Expected: PASS.

Run: `pnpm check`

Expected: PASS with no new diagnostics.

- [x] **Step 3: Inspect the scoped diff**

Run: `git diff --check` and review only the files listed above, preserving all unrelated working-tree changes.
