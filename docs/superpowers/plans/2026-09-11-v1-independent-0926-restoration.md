# V1 독립 0.9.26 개선 복원 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 0.9.26의 저장 구조 비의존 개선을 현재 V1 런타임에 복원하고, 각 개선을 회귀 테스트와 0.9.30 패치노트로 고정한다.

**Architecture:** `nativeRuntime`, V2 문서 API, 이름 기반 저장 경로와 V2 이관 코드는 도입하지 않는다. UI와 순수 설정, 기존 V1 데이터 필드, 요청 조립, 입력 검증만 작은 단위로 변경하며 기존 V1 저장 API와 저장 순서는 유지한다.

**Tech Stack:** Svelte 5, TypeScript, Vitest, 기존 V1 `database.bin`/chat-content 저장 경로.

---

### Task 1: BardWiki 현재 챗 설정과 Bard-chan

**Files:**
- Create: `src/lib/Others/RisuBardCurrentChatSettings.test.ts`
- Modify: `src/lib/Others/RisuBardCurrentChatSettings.svelte`
- Modify: `src/lib/Others/RisuBardMemoryWiki.svelte`
- Modify: `src/ts/risubard/risuBardSettings.ts`
- Modify: `src/ts/risubard/risuBardSettings.test.ts`
- Modify: `src/ts/risubard/memoryAnalysisClient.ts`
- Modify: `src/ts/risubard/memoryAnalysisClient.test.ts`
- Modify: `src/ts/risubard/narrativeContext.ts`
- Modify: `src/ts/risubard/narrativeContext.test.ts`
- Modify: `src/ts/process/index.svelte.ts`
- Modify: `src/ts/setting/risuBardCommonSettingsData.ts`
- Modify: `src/ts/setting/risuBardCommonSettingsData.test.ts`
- Modify: `src/ts/storage/database.svelte.ts`
- Restore: `src/ts/risubard/bardChanReranker.ts`
- Restore: `src/ts/risubard/bardChanReranker.test.ts`
- Restore: `src/ts/risubard/chatSettingsHelp.ts`
- Restore: `src/ts/risubard/chatSettingsHelp.test.ts`
- Modify: `patchnote/0.9.30.md`

- [x] Write tests proving the redesigned sections, per-option help, global-value application, window resize persistence, Bard-chan fallback, and analysis-only user-message exclusion.
- [x] Run the focused tests and confirm failures come from the missing behavior.
- [x] Add only plain database settings and request/UI wiring; do not import any V2 storage module.
- [x] Run the BardWiki focused tests and update `patchnote/0.9.30.md` with the completed user-visible behavior.

### Task 2: New-chat persona inheritance

**Files:**
- Modify: `src/ts/personaScopes.test.ts`
- Modify: `src/ts/personaScopes.ts`
- Modify: `src/ts/storage/database.svelte.ts`
- Modify: `src/lib/Others/ChatList.svelte`
- Modify: `src/lib/SideBars/SideChatList.svelte`
- Modify: `src/lib/SideBars/PersonaBind.svelte`
- Modify: `patchnote/0.9.30.md`

- [x] Add failing tests for inheriting the previous chat persona and falling back to the selected global persona.
- [x] Implement the pure resolver and pass the current character/chat into every new-chat constructor.
- [x] Verify persona tests and record the completed improvement in the latest patch note.

### Task 3: Character-wide chat module scope

**Files:**
- Modify: `src/lib/Setting/Pages/Module/ModuleChatMenu.test.ts`
- Modify: `src/lib/Setting/Pages/Module/ModuleChatMenu.svelte`
- Modify: `src/lib/ChatScreens/DefaultChatScreen.svelte`
- Modify: `src/lib/SideBars/SideChatList.svelte`
- Modify: `patchnote/0.9.30.md`

- [x] Add a failing component test proving the chat-labelled control writes `character.modules` and applies to existing/new chats through the established character scope.
- [x] Replace only the scope target; retain V1 synchronous module access and existing global/persona resolution.
- [x] Verify module scope tests and update the patch note.

### Task 4: File drop and import integrity

**Files:**
- Create: `src/App.fileDropImport.test.ts`
- Modify: `src/App.svelte`
- Modify: `src/ts/characterCards.import.test.ts`
- Modify: `src/ts/characterCards.ts`
- Modify: `src/ts/process/modules.test.ts`
- Modify: `src/ts/process/modules.ts`
- Modify: `src/lang/en.ts`
- Modify: `src/lang/ko.ts`
- Modify: `patchnote/0.9.30.md`

- [x] Add failing tests for `.js` drop dispatch, localized progress, truncated module input, asset-count mismatch, and missing export assets.
- [x] Implement error handling and integrity checks without changing V1 asset keys, batching, persistence calls, or publication order.
- [x] Verify focused import tests and update the patch note.

### Task 5: Dialog and activity feedback stability

**Files:**
- Modify: `src/lib/SideBars/RisuBardSaveSlotsDialog.test.ts`
- Modify: `src/lib/SideBars/RisuBardSaveSlotsDialog.svelte`
- Create: `src/lib/Others/SavePopupIcon.test.ts`
- Modify: `src/lib/Others/SavePopupIcon.svelte`
- Modify: `src/lib/SideBars/SidebarResizeHandle.svelte`
- Modify: `src/lib/SideBars/SidebarResizeHandle.test.ts`
- Modify: `patchnote/0.9.30.md`

- [x] Add failing tests for top-tier load confirmation and delayed save indicator; the existing resize test confirmed cancelled resizing was already persisted.
- [x] Make the minimal UI-state changes without altering save requests or acknowledgement semantics.
- [x] Verify focused tests and update the patch note.

### Task 6: Documentation parity and final verification

**Files:**
- Modify: `docs/ko/grimoire-ai-analysis.md`
- Modify: `patchnote/0.9.30.md`

- [x] Restore the missing settings translation/help keys and verify the help-key audit.
- [x] Restore V1-safe loading feedback, startup logo handoff, and the loading activity tests without native document hooks.
- [x] Consolidate existing V1 backup and migration actions under System > Backups, retain legacy-route redirection, and verify navigation tests.
- [x] Restore the user guide explanation for direct mentions, continuation input, disabled/comment filtering, and exclusion diagnostics.
- [x] Run targeted BardWiki, Grimoire, persona, module, import, dialog and UI tests.
- [x] Run `npm run check`, theme-token validation, and the affected build if checks pass.
- [x] Inspect `git diff --check`, confirm no V2 runtime imports were introduced, and confirm all pre-existing unrelated edits remain intact.
