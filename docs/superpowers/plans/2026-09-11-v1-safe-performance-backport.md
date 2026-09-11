# V1 저장 안정성 보존 성능 이식 전투 계획서 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: 구현 승인을 받은 뒤 executing-plans 스킬로 아래 체크박스를 순서대로 실행한다. 현재 공개판 main 체크아웃에서만 작업한다. 이 문서는 구현 승인 전 검토안이며, 이번 작업에서는 구현·커밋·push·배포를 하지 않는다.

**Goal:** v0.9.26에서 확인한 병목 제거 방식 중 V1 파일 형식과 저장·충돌·복구 계약을 보존하는 부분만 작은 커밋으로 다시 적용한다.

**Architecture:** 전송 및 가져오기 준비 단계부터 개선하고, 기존 V1 저장소 호출과 게시 순서를 유지한다. 문서별 V2 런타임, 이름 기반 경로, 소유자 에셋 정본, 이관 코드는 도입하지 않는다. 저장 횟수 감소는 실제 변경 추적을 증명한 경우에만 별도 단계에서 허용한다.

**Tech Stack:** 기존 Svelte 5/TypeScript, Node.js CommonJS, Express, fflate, msgpackr, Vitest. 새 라이브러리 없음.

**상태:** 사용자 검토 대기. 작성일 2026-09-11 KST. 성능 측정값은 아직 없으며 아래 수치 중 payload 산식 외에는 검증 목표다.

---

## 1. 기준점과 근거 읽기

작업 루트는 현재 공개 저장소다. 계획서는 `docs/superpowers/plans/2026-09-11-v1-safe-performance-backport.md`에 있으며, 아래 저장소 상대경로는 모두 이 루트를 기준으로 한다.

상위 `../AGENTS.md`와 위키 진입점 `../project_wiki/index.md`를 확인했다. 공개판 내부에는 별도 AGENTS.md와 project_wiki/index.md가 없다. .bardwiki.json은 상위 프로젝트에 있으며 wikiDir, rawDir, contextDir는 서로 독립적이다.

관련 must_read_with 관계를 따라 운영 규칙, 파일 정본 사용자 데이터 아키텍처, Markdown 서사 위키, 소설 집필 모드, 고정 예산 컨텍스트, inquiry, 프롬프트·도구 프리셋, 컨텍스트 파이프라인, 패치노트 계약의 관련 경계를 확인했다. 소설가 문서는 저장 경계 확인용이며 비공개판 작업을 허용하는 근거가 아니다. 공식 위키는 수정하지 않는다.

위키의 “시작 시 작은 manifest만 로드”는 설계 계약이다. 현재 V1 HTTP 런타임이 이미 모든 문서를 지연 로드한다고 해석하면 안 된다. 아래는 실제 태그 코드의 동작을 별도로 추적한 결과다.

### 실제 태그가 가리키는 커밋

| 기준 | 실제 commit SHA | 관찰 |
| --- | --- | --- |
| v0.9.25 | 268fe37853553a9b29aad5eb64a158f13c283e05 | V1 기준 구현 |
| v0.9.26 | 1d104bbc6f33c084b6e60be153716f9fb6c84817 | V2 문서 런타임·소유자 에셋과 전송 개선이 함께 존재 |
| v0.9.29 | 7e019cbfbdc4d5baacd9c7e1421d0342e2de0ab7 | V1 복귀 후 변환 도구 개선 포함 |
| 작성 시 main/HEAD | b6b8d52c5170a005da43673c8a27e353790fabb7 | v0.9.29 대비 patchnote/0.9.30.md 추가만 있음 |

v0.9.25와 v0.9.29는 annotated tag이므로 git rev-parse의 tag object SHA를 commit SHA로 인용하지 않는다. 위 표는 git log -1 --format='%H %s'로 확인했다.

다음 재현 명령은 체크아웃과 세이브를 변경하지 않는다.

~~~powershell
git log -1 --format='%H %s' v0.9.25
git log -1 --format='%H %s' v0.9.26
git log -1 --format='%H %s' v0.9.29
git diff --name-status v0.9.29 HEAD
git diff v0.9.25 v0.9.26 -- src/ts/globalApi.svelte.ts src/ts/process/processzip.ts src/ts/storage/nodeStorage.ts
git diff v0.9.25 v0.9.26 -- server/node/file-store.cjs server/node/file-kv.cjs server/node/user-data-repository.cjs server/node/server.cjs
git diff --name-only v0.9.25 v0.9.29 -- src/ts/storage src/ts/globalApi.svelte.ts src/ts/process/processzip.ts src/ts/characterCards.ts src/ts/bootstrap.ts server/node/file-store.cjs server/node/file-kv.cjs server/node/user-data-repository.cjs server/node/db.cjs
~~~

마지막 명령은 출력이 없다. 그 범위의 V1 코드는 v0.9.25와 v0.9.29에서 동일하다. server/node/server.cjs의 두 기준 사이 변경은 JWT secret 로드 교체이며 저장·bulk 경로는 동일하다. 따라서 v0.9.26의 개선이 현재에도 남았다는 전제로 작업하지 않는다.

기존 미추적 파일 patchnote/0.9.28-apology.png와 patchnote/0.9.28-arca.txt는 이번 작업과 무관하므로 수정·스테이징하지 않는다.

## 2. 보존할 V1 데이터 흐름

### 읽기와 저장

1. server/node/db.cjs의 createFileKv → KV manifest/objects를 사용한다. database/database.bin은 실제 경로 하나로 가정하지 않는다. KV 논리 키이며 manifest가 content object를 가리킨다. 캐시가 없으면 repository.exportLegacyDatabase → encodeRisuSaveLegacy → kvSet으로 재생성한다.
2. server/node/server.cjs의 /api/read → flushPendingDb → database.bin decode → initChatStore/stripChatsFromDb로 브라우저에는 채팅 stub을 보낸다. ensureChatStore는 필요 시 전체 DB에서 서버 메모리의 fullChatStore를 준비한다.
3. src/ts/storage/chatStorage.ts의 ensureChatHydrated는 선택한 채팅을 가져오고 hydrationPromises로 같은 채팅의 동시 로드를 합친다. nodeStorage.ts는 채팅 페이지당 200개 메시지, 전송 동시성 4의 기존 경로를 가진다. 이는 V2 문서 런타임과 구분한다.
4. src/ts/globalApi.svelte.ts의 saveDb → takeTrackedChanges → persistTrackedChanges → collectChatsToPersist → saveChatToServer. 설정·캐릭터 metadata는 RisuSavePatcher와 /api/patch, 필요 시 /api/write로 보낸다. encoder.set과 encoder.encode는 patch 성공 경로 앞에서도 실행된다.
5. 서버 /api/chat-content POST는 fullChatStore를 갱신하고 SAVE_INTERVAL 타이머를 예약한다. /api/patch 역시 메모리 snapshot·ETag를 갱신한 뒤 지연 게시한다. **이 응답의 success는 디스크 확정 ACK가 아니다.**
6. persistDbCacheWithChats → ensureChatStore → reassembleFullDb → findStubFlagLossChats → encodeRisuSaveLegacy → kvSet → persistCanonicalProjection → importLegacyDatabase(mode: sync) → commitTransaction. 저장 후 initChatStore로 메타데이터를 다시 맞춘다.
7. user-data-repository.cjs의 importLegacyDatabase는 settings/secrets, 컬렉션, 캐릭터 metadata, 채팅 metadata/messages.jsonl, sidebar 작업 목록을 만든다. file-store.cjs는 staging 쓰기·검증·journal·게시·.bak·.sha256·디렉터리 fsync·replay를 담당한다.
8. publishTransaction은 이미 대상 바이트가 같으면 게시를 건너뛴다. 그러나 그 앞의 전체 직렬화와 staging 생성 비용은 남는다. “변경 없는 모든 파일을 매번 최종 교체한다”는 설명은 부정확하다.

### 에셋 가져오기

CharXImporter.parse/#feedChunk → fflate.UnzipInflate → #handleFileComplete → AssetImportBatcher.enqueue → persistBatch → hasher/Promise.all → forageStorage.setItems → NodeStorage.setItems(JSON/base64) → /api/assets/bulk-write → kvSetManyAsync → prepareEntriesAsync → writeObjectAsync → saveManifest.

- V1에 이미 batch당 200개, 보통 32 MiB, outstanding high-water 64 MiB, 직렬 writeChain, 서버 object 쓰기 동시성 최대 8이 있다.
- 현재 CharXImporter가 동기 UnzipInflate를 등록한 주석에는 수백 개 metadata entry의 worker 고갈을 피하려는 이유가 명시돼 있다.
- characterCards.ts의 CHARX 분기는 importer.done()을 기다린 뒤 card metadata를 검증·게시한다. 이 순서를 유지한다.
- SHA-256 object를 여러 KV 키가 참조하는 V1의 중복 제거와, 소유자별 일반 파일을 정본으로 만든 V2의 “이미지 단일 저장”은 다른 구조다.

## 3. 후보별 분류와 이식 판정

분류 ① = V2 구조에 결합되어 그대로 이식 불가. ② = V1에 최소 변경으로 이식 가능. ③ = 위험해서 제외하거나 별도 재설계 필요. ②도 검증을 통과하기 전에는 적용하지 않는다.

| 후보 | v0.9.26 실제 근거·의존 관계 | 현재 V1과의 차이 | 분류·결정 |
| --- | --- | --- | --- |
| 문서 단위 지연 로딩 | src/ts/storage/nativeRuntime.ts의 bootstrap/ensureCharacter/readChat, nativeDocuments.ts, server/node/native-document-routes.cjs의 /api/native/*, native-document-store.cjs의 catalog/read | V1은 채팅 stub 지연 로딩만 있고 서버에는 전체 DB/fullChatStore가 필요하다. V2는 catalog·문서 revision·ready 상태·이름 기반 codec 사용 | **① 제외.** nativeRuntime, nativeDocuments, named-entity-codec, native routes를 복원하지 않는다 |
| 변경 문서만 저장 | NativeRuntime.persist/persistNow → NativeDocuments.commit → native-document-store.commit; expectedRevision CAS와 catalog membership/order를 분리 | V1의 sync import는 전체 데이터에서 목록과 삭제를 판단한다. 일부 문서만 전달하면 누락 항목을 삭제로 오인할 수 있다 | **① 제외.** 부분 DB를 importLegacyDatabase(mode: sync)에 보내지 않는다 |
| 서버 database.bin 전체 재조립 회피 | globalApi의 nativeRuntime.persist 분기, 서버 native route onCommit 캐시 무효화, db.cjs/native compatibility 분기 | V1의 /api/read, /api/write, /api/patch, fullChatStore, ETag, 외부 수정 감지, 내보내기가 호환 투영에 연결됨 | **① 제외.** V1 일반 저장에서 kvSet/reassembleFullDb/encodeRisuSaveLegacy를 생략하지 않는다 |
| 클라이언트 불필요한 encode 지연 | v0.9.26은 native 모드에서 encoder/patcher 자체를 만들지 않음 | V1은 patch 이전에도 encoder.encode가 모든 stub 블록을 합친다. encode는 config block이 없으면 null을 반환 | **③ 별도 재설계.** 단순 이동하면 noop 판정·fallback·baseline 의미가 바뀔 수 있다. 첫 이식 범위에서 제외 |
| 반복 저장 방지: tracker 소비 | globalApi.takeTrackedChanges가 character/chat을 첫 원소 유지에서 []로 변경; trackNativeDocuments와 documentDirty가 함께 도입됨 | V1은 선택 캐릭터·활성 채팅 effect, isHydrating, knownChatIds, 실패 requeue에 의존 | **③ 조건부 4단계.** 두 줄만 cherry-pick 금지. V1에서 새 편집·실패 재시도를 놓치지 않는다는 행동 테스트가 선행 |
| 반복 저장 방지: 동일 문서 바이트 생략 | native-document-store.commit의 changed filter + recheck + commitTransaction(beforePrepare) | V1 publishTransaction에도 같은 바이트의 최종 게시 생략은 있지만 pre-staging CAS가 없다 | **③ 제외.** V2 changed filter만 V1에 복사하거나 mtime만 보고 저장 생략 금지 |
| 대형 에셋 서버 병렬 쓰기 | file-kv.cjs의 prepareEntriesAsync/kvSetManyAsync, import-parallelism.test.ts | 주요 병렬 object 쓰기·staged file promotion은 v0.9.25부터 이미 존재 | **② 이미 적용.** 검증 기준으로 유지하며 동시성 상향·Promise.all 전면화는 하지 않는다 |
| CHARX 압축 해제 병렬화 | processzip.ts의 CharXImportDecodeScheduler(limit 4) + AsyncUnzipInflate + 완료/error 시 complete | 현재 동기 decoder. V2 저장 API 없이 분리할 수 있으나 worker 시작 실패·대기 압축 데이터·메모리 상한 검증 필요 | **② 보강 후 3단계.** 무제한 worker 또는 숫자 4만 복사하는 방식은 **③ 제외** |
| 에셋 바이너리 일괄 전송 | nodeStorage.setItems, server/node/asset-bulk-protocol.cjs의 decodeAssetBulkWrite, bulk-write route의 binary/legacy 분기 | V1 write API·KV 호출을 그대로 두고 HTTP body 표현만 바꿀 수 있다 | **② 최우선 1단계.** 구형 JSON 유지·capability 확인·입력 상한·실패 의미 보강 |
| 동시 인증 요청 합치기 | nodeStorage.checkAuth의 authPending/performAuthCheck | V1 refreshPending/sessionPending은 있지만 checkAuth 전체를 합치지는 않음 | **② 선택 2단계.** 초기 동시 요청만 개선. 저장 성능 개선이라고 과장하지 않는다 |
| 이미지 이중 저장 제거 | owned-assets.cjs의 planOwnedAssets/readOwnedAsset/getOwnedAssetSource, owner-asset-references.cjs, file-kv.kvDetachOwnedAssets, 파일 retirement journal | V2는 owner assets/asset index로 읽기를 전환한 뒤 KV 참조를 해제. kvDetachOwnedAssets도 옛 객체는 삭제하지 않고 recovery manifest를 보존함 | **① 제외.** V1 kvGet는 KV object를 읽으므로 이 참조를 지우면 에셋이 사라진다 |
| 동일 이미지 업로드 재사용·GC 확대 | V2 소유권 분리와 관련 없는 별도 아이디어 | V1은 동일 해시 객체를 이미 재사용. 키 삭제·owner 추론은 백업·cold storage·공유 참조를 깨뜨릴 수 있음 | **③ 제외.** 새 GC, hardlink, reflink, 물리 삭제, 이름 기반 병합 없음 |

v0.9.26 원문에서만 존재하는 파일은 다음처럼 확인한다. 전체 릴리즈 커밋을 cherry-pick하지 않는다.

~~~powershell
git show v0.9.26:src/ts/storage/nativeRuntime.ts
git show v0.9.26:server/node/native-document-store.cjs
git show v0.9.26:server/node/asset-bulk-protocol.cjs
git show v0.9.26:docs/superpowers/plans/2026-09-08-single-copy-owned-assets.md
~~~

마지막 문서의 대규모 이미지 검증 수치와 “테스트 통과” 기록은 당시 작성자의 역사 기록이다. 이번 V1 검증 결과나 동일한 속도 개선 보장으로 재사용하지 않는다.

## 4. 변경 금지선과 발견 시 중단 기준

- V1 schemaVersion, 안정 ID 경로, KV manifest/object 구조, sidebar 순서, .sha256, .bak, .journal, trash, draft, backup/import/export 데이터 형식을 고정한다.
- native-runtime marker, entity-order/owned-asset index, named 저장소, V2 gate/worker, 변환 스크립트와 portable 변환 launcher는 변경하거나 실행하지 않는다.
- 체크섬 검증, external-change 검사, expectedHash/ETag/409/423, writer/session lock, stub/placeholder 보호, 실패 requeue, 명시적 flush를 제거·완화하지 않는다.
- 백업·복원의 대상 목록, 보존 정책, 기존 정본 삭제/전환 처리와 updateKnownChatsAfterSuccessfulSave는 변경하지 않는다.
- 대화 본문과 swipe, note/localLore, bindings, draft, 미선택 캐릭터, cold-storage/remote block, 알 수 없는 보존 필드도 무결성 비교 대상이다.
- 현재 getProjectionRevision은 파일 목록·size·mtimeNs 기반이다. 같은 크기·같은 mtime의 외부 수정을 모두 잡는 content CAS라고 주장하지 않는다.
- 현재 loadMessages는 파일이 없으면 []를 반환하며, readVerifiedJson의 체크섬 재수용은 acceptExternalChanges 경로에만 있다. 손상 fixture에서 “빈 데이터로 정상 저장”되면 성능 이식은 중단한다. 기존 한계여도 테스트를 완화해서 통과시키지 않는다.
- raw parser의 큰 전역 상한, bulk route의 queueStorageOperation 미사용, 지연 timer와 저장 queue의 상호작용은 검증해야 할 기존 경계다. 후보 적용으로 노출되는 충돌이 있으면 해당 단계를 보류한다. 성능 PR에 저장 구조 수선을 섞지 않는다.
- 절대 무손실을 테스트만으로 증명할 수는 없다. 본 계획의 승인 의미는 아래 검증 범위에서 무결성 차이 0·기존 안전 경로 유지이며, 미검증 플랫폼/실제 복제 데이터가 남으면 구현 완료로 처리하지 않는 것이다.

## 5. 공통 기준 데이터·측정·무결성 판정

### 격리 원칙과 실제 V1 복제 데이터

0단계에서만 구현할 검증 도구는 저장소 코드를 현재 checkout에서 읽고, 데이터는 새 임시 루트에서만 연다. 별도 소스 checkout/worktree는 만들지 않는다. 기존 test/compat/helpers/spawnServer.ts가 이 구조이며 RISUBARD_DATA_ROOT를 임시 save로 고정한다. opts.env로 이 값을 실제 저장 경로로 덮어쓰지 못하도록 검증한다.

실제 데이터 원본은 사용자가 확인한 V1 세이브 또는 완성된 백업으로 한정한다. 경로를 추측해 현재 save/를 테스트 서버로 열지 않는다. 이번 계획 작성 중 실제 세이브를 조사·복사·부팅하지 않았다.

1. 실행 중인 원본 앱을 종료하거나 이미 완료된 일관된 V1 백업을 선택한다. 미완료 journal이 있는 live 폴더를 조용히 snapshot하지 않는다.
2. read-only 파일 API로 원본의 상대경로·길이·SHA-256 목록을 기록한다. 앱의 readVerifiedJson/export를 원본 검사용으로 호출하지 않는다. 해당 API는 checksum/cache를 쓸 수 있다.
3. fs.cp의 보통 복사로 독립 master 복제본을 만든다. hardlink/reflink와 junction/symlink는 허용하지 않는다. 경로 포함 관계·실제 경로·link count·재분석 지점을 확인해 원본 접근 가능성이 있으면 중단한다.
4. 매 실행마다 master에서 run-001, run-002처럼 새 복제를 만든다. 결함 주입은 run 복제에만 수행한다. master와 원본은 전후 SHA-256 목록이 같아야 한다.
5. 서버 cwd, RISUBARD_DATA_ROOT, backup 경로, 로그, 임시 파일, 브라우저 profile을 모두 run 루트에 가둔다. 복제 데이터의 외부 backup 경로와 작업 재개·플러그인 네트워크 실행은 격리 harness에서 막는다. API key·원문은 report/Git에 넣지 않는다.
6. 작업 종료 후 앱을 멈추고 manifest와 논리 데이터를 검증한다. 실패 run은 원인 확인 전 삭제하지 않는다. 원본 복구·덮어쓰기 명령은 이 계획에 없다.

### 규모별 고정 시나리오

표의 이미지 크기는 유효한 이미지 fixture의 합계 목표다. 반복 바이트만으로 이미지를 구성해 압축률/해시 재사용을 왜곡하지 않는다. deterministic seed는 92629, ID와 내용 생성 규칙은 fixture helper에 고정한다.

| ID | 캐릭터 / 채팅 / 메시지 | 에셋·입력 | 주 관측 대상 |
| --- | --- | --- | --- |
| S | 5 / 캐릭터당 2 / 채팅당 100 | 100개, 약 25 MiB | 작은 데이터에서 속도·메모리 퇴행 없는지 |
| C | 10 / 캐릭터당 10 / 채팅당 10,000 | 100개 | 장기 대화 저장·전환·불필요한 재저장 |
| K | 500 / 캐릭터당 2 / 채팅당 50 | 1,000개 | 캐릭터 삭제·정렬·전환·metadata 전체 비용 |
| I | 30 / 캐릭터당 2 / 채팅당 100 | 20,000개, 약 2 GiB; 최대 49 MiB 단일 에셋 | bulk body·worker·RSS·동시 저장 |
| M | 10 / 캐릭터당 2 / 채팅당 100 | 728개 압축 x_meta + 728개 에셋 CHARX | 현재 worker 고갈 방지 회귀 |
| R | 선택한 실제 V1 복제의 정확한 개수 기록 | 내용 SHA-256을 가진 실제 대형 카드·세이브 | 합성 fixture에 없는 키·metadata·공유 이미지 |

Windows NTFS와 Termux 내부 저장소에서 S/M/R은 필수다. C/K/I도 실행하되 Termux 메모리가 부족하면 축소본과 원래 목표의 미실행 사유를 따로 기록하고 대규모 지원 통과로 표시하지 않는다. Termux /sdcard 또는 /storage/emulated/0는 활성 정본으로 사용하지 않으며 기존 거부 동작만 임시 환경으로 테스트한다.

### 재현 가능한 측정 순서

- node/pnpm/Vitest/fflate 실제 버전, commit SHA, lockfile SHA-256, OS/파일시스템, CPU/RAM, 브라우저 버전, 기기 온도·전원 상태, 압축 크기와 원래 크기를 기록한다.
- 현재 V1 실행으로 baseline을 먼저 고정하고 단계마다 직전 승인 커밋과 누적 baseline 둘 다 비교한다. v0.9.26 실데이터 부팅/이관은 하지 않는다. 역사 태그 비교는 코드 근거이며 속도 비율의 기준은 현재 V1이다.
- warming 1회 후 동일 fixture를 새 run 복제에서 10회 수행한다. 가능한 각 단계의 enable/disable 경로는 같은 실행환경에서 번갈아 측정한다. p50, p95, 최악값과 전체 표본을 보존한다.
- cold는 서버 프로세스와 브라우저를 새로 띄운 첫 실행, warm은 같은 인스턴스의 두 번째 작업으로 구분한다. OS page cache를 강제로 비우거나 원본 디스크에 부하를 가하지 않는다.
- 작업: 최초 목록 표시 → 큰 채팅 열기 → 메시지 하나 수정 → 설정 하나 수정 → A/B 100회 전환 → A 삭제 → 저장/재시작 → CHARX 가져오기 → 명시적 flush → backup export/import/new instance → 재수출.
- 서버 저장의 완료시간은 /api/db/flush 성공 뒤 디스크 검증까지다. 채팅 POST 응답시간은 별도 값이다. UI 저장 표시만 보고 내구성 완료로 측정하지 않는다.
- 계측: 단계별 elapsed ms, long task(50 ms 초과) 개수·최댓값, rAF 응답 간격, 브라우저 heap 관측 가능 여부, Node RSS/heap/external/arrayBuffers, request 수·body 바이트·실제 wire 바이트, 해시/encode 호출 수, 전체 DB 조립 횟수, fsync/rename/journal/manifest 게시 횟수·바이트, worker active 최대치.
- HTTP gzip가 base64 중복을 줄일 수 있으므로 body 감소와 실제 wire 감소를 구분한다. body의 이론상 25% 감소를 전체 가져오기 시간 25% 감소로 쓰지 않는다.
- 성능 계측은 test wrapper 또는 별도 bench harness에서 수행한다. 운영 세이브 정본이나 설정에 계측 필드를 넣지 않는다.

### 매 단계 공통 합격 G / 즉시 중단 X

**G1 무결성:** 기대한 편집 외 논리 데이터 차이 0, 에셋 키별 SHA-256 차이 0, 캐릭터/채팅/message ID·순서·개수 차이 0. 비대상 정본·에셋 파일은 byte-identical. 정상적으로 바뀌는 로그·파생 캐시·manifest와 sidebar의 timestamp는 baseline의 변경 범위를 별도로 기록한다. modifiedAt 같은 값의 무시 목록은 기존 format의 timestamp 필드만 명시하고 본문/ID/배열을 normalize로 숨기지 않는다.

**G2 파일 계약:** KV key→object 실제 바이트, JSON/JSONL schema, 존재하는 checksum sidecar, .bak, journal replay, trash 및 backup 복구를 검사한다. sidebar에서 찾지 못하는 항목도 디스크 inventory로 검출한다. “전체 export가 성공했다” 하나로 손상 검사 완료를 대신하지 않는다.

**G3 실패·호환:** 아래 F 행렬에서 기존 보호 응답 유지, 손상을 success로 승격하지 않음. 새 버전 저장 → 동일 run의 보존 복제 → v0.9.25 reader 함수와 현재 reader로 decode/import/export 의미 일치. 구형 앱 HTTP 호환은 JSON 요청 fixture로 검증하며 V2 runtime은 사용하지 않는다.

**G4 성능:** S의 p95와 peak memory가 baseline보다 10% 넘게 나빠지면 보류한다. baseline 자체 편차가 10%를 넘으면 개선 판정도 보류한다. 대상 병목의 결정론적 지표가 줄고 대규모 R/C/K/I에서 데이터 오류가 없어야 한다. 무결성 실패는 속도 이득과 상쇄하지 않는다.

**X:** 누락·hash 불일치·ghost 삭제/부활·잘못된 소유권·flush 후 유실·충돌 무시·종료 후 import success·멈춘 done Promise·worker 누수·메모리 상한 초과가 한 번이라도 나오면 그 단계 즉시 중단. baseline도 실패하면 해당 성능 단계는 승인하지 않고 기존 결함으로 별도 기록한다.

## 6. 실패 주입 행렬

모든 단계는 관련 단위 테스트에 더해 S/M/R에서 F0~F9를 적용한다. 저장 로직 후보인 4단계는 C/K에도 전부 적용한다. 횟수는 각 결정론적 failpoint 10회, 시간 경합은 seed를 고정한 100회다.

| ID | 주입 방법 — run 복제 한정 | 반드시 관찰할 결과 |
| --- | --- | --- |
| F0 | 정상 저장 → 명시적 flush → 프로세스 종료/재시작 | flush로 확정한 메시지·설정·이미지가 정확히 남음 |
| F1 | 업로드 시작 전 / 중간 / 모든 에셋 ACK 뒤 character 게시 전 브라우저 종료 | 부분 캐릭터를 성공으로 노출하지 않음. 선행 저장된 고아 에셋은 삭제하지 않고 기존 복구 정책 유지 |
| F2 | 채팅 POST ACK 직후, debounce 전 강제 종료 | 예약 상태와 내구성 완료를 구분. flush 전 값 손실을 새 보장으로 덮지 않으며 baseline보다 손실 창을 늘리지 않음 |
| F3 | temp write → fsync 전후 → journal prepared → 첫/중간 rename → sidecar → cleanup 직전 종료 | 이전 완전 상태 또는 replay로 완성한 새 상태. 적용 도중 일부 파일만 남은 결과를 정상 완료로 표시하지 않음 |
| F4 | 같은 세션의 동시 chat/save/import, 다른 세션의 stale ETag/hash, 423 writer 거부 | 최신 확정 데이터 보존·기존 충돌 응답. 거부된 작업을 binary→JSON 재전송으로 우회하지 않음 |
| F5 | 저장 중 A를 편집하고 B로 전환, A 또는 마지막 캐릭터 삭제; hydration 응답 역순 도착 | 편집 누락·삭제 부활·다른 채팅으로의 본문 덮어쓰기 없음 |
| F6 | run 복제에서 asset object, messages.jsonl, metadata, sidebar, database object, staging 파일을 각각 하나씩 누락 | 캐시만 없으면 기존 안전 재구성 검증. 정본 누락이면 복구/오류를 기록하고 빈 정상 데이터로 확정하지 않음 |
| F7 | 같은 길이의 바이트 변경, .sha256 불일치/누락, 같은 mtime 외부 수정 | checksum mismatch 경로 보존. 탐지 못한 원본 손상이 있으면 그 실험은 합격 처리하지 않음 |
| F8 | 짧은 binary body, key/value length 조작, extra tail, 초과 count/bytes, 중복 키, 잘못된 ZIP, decoder 시작 throw/error/final 중복 | malformed frame은 KV publish 0회. worker 슬롯은 정확히 1회 반환, done은 성공 또는 오류로 반드시 종료 |
| F9 | 디스크 공간 부족·읽기 전용·Windows rename EPERM, Termux 프로세스 SIGKILL/백그라운드 중단 | success 오보고 없음. 마지막 좋은 revision과 복구 자료 보존. 실패 이후 재시도와 재시작 검증 |

파일-store failpoint는 기존 commitTransaction(..., { failAfterPublish: 1 }) 테스트를 출발점으로 사용한다. 그 옵션만으로 fsync 전이나 sidecar 중간 종료가 재현되지는 않는다. test 전용 child process에서 fs wrapper와 IPC 도달 통지를 사용해 정확한 단계에서 종료한다. Windows는 harness가 생성한 정확한 child PID에만 강제 종료를 적용하고 프로세스 이름 전체를 종료하지 않는다. Termux에서는 같은 child에 SIGKILL을 보낸다. 전원 장애 자체를 재현했다는 주장은 하지 않는다.

## 7. 실행 순서와 커밋 단위

기본 순서: **0 → 1A → 1B → 검토 → 2(필요할 때) → 3A → 3B → 검토**. 4단계는 별도 승인 대상으로 남긴다. ① 후보와 명시적 제외 항목은 이 순서에 들어오지 않는다. 앞 단계가 효과를 달성하면 다음 단계까지 자동 확장하지 않는다.

각 구현 커밋에는 변경 파일과 그 행동 테스트만 선택적으로 담는다. 공개 동작을 실제로 바꾼 단계는 실행 당시 SemVer 최신 patchnote에 사용자 결과를 적는다. 이하 커밋명은 제안이며 이번 문서 작성에서 실행하지 않는다.

### Task 0 — 기준 동작·측정 도구 확정 (P0, 제품 코드 변경 없음)

**Create:** test/compat/helpers/v1Integrity.ts, test/compat/v1-performance-safety.test.ts, test/compat/v1-performance-baseline.test.ts.
**Reuse:** helpers/spawnServer.ts, seed.ts, client.ts, normalize.ts, decode.ts, encode.ts.
**Inspect:** server/node/file-store.test.ts, file-kv.test.ts, user-data-repository.test.ts, canonical-projection-sync.test.ts.

- [ ] 원본/복제/run 경로 포함관계와 symlink/junction 차단, 새 run 경로 미존재 확인, 원본 hash 전후 비교를 구현한다. 실제 데이터 fixture가 미지정이면 합성 테스트만 실행하고 R은 “미검증”으로 남긴다.
- [ ] v1Integrity.ts는 walkInventory(root), verifyV1(root), compareInventories(before, after, allowedChanges)를 제공한다. inventory 항목은 relativePath/size/sha256/nlink이고, 파일 시스템 오류를 빈 값으로 취급하지 않는다. verifyV1은 sidecar·KV object hash·JSONL 각 줄·sidebar 참조·backups/trash 범위를 검사한다. 저장소 객체를 원본에 대해 생성하지 않는다.
- [ ] 손상된 임시 asset/messages/index 입력이 verifier에서 실패하는 테스트를 먼저 작성한다. verifier 자체를 검증하기 전 성능 실험을 시작하지 않는다.
- [ ] baseline test는 S/C/K/I/M/R 각각의 fixture ID, run seed, Git SHA, 환경, 지표를 run 루트 report.json에 기록한다. 본문과 credential 값은 기록하지 않는다. 실행시간 상한은 기준 p95의 3배와 60초 중 큰 값으로 정하고, 초과를 무한 대기 대신 실패로 보고한다.
- [ ] 기존 테스트와 F0~F9의 기준 결과를 기록한다. 기존 결함은 failpoint와 보존한 run 위치를 기록하고 관련 이식을 보류한다.
- [ ] R 복제 1회 정상 저장/재시작/백업 왕복을 수행하고 원본·master의 SHA-256 불변을 확인한다.

검증 시작 명령(Windows; 현재 설치된 지원 Node를 명시):

~~~powershell
$v1Node = 'C:/Users/jsthe/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe'
& $v1Node node_modules/vitest/vitest.mjs run --config vitest.config.server.ts server/node/file-store.test.ts server/node/file-kv.test.ts server/node/user-data-repository.test.ts server/node/canonical-projection-sync.test.ts
& $v1Node node_modules/vitest/vitest.mjs run --config vitest.config.compat.ts test/compat/v1-performance-safety.test.ts test/compat/v1-performance-baseline.test.ts
~~~

Termux는 지원 Node >=22.12.0을 확인한 뒤 같은 vitest.mjs 인자를 node로 실행한다. 잠금 파일에 맞는 의존성 설치 여부를 먼저 확인하며 테스트 편의를 위해 package.json/lockfile을 변경하지 않는다.

**통과:** G1~G3 기준과 실패 실험 결과가 재현됨, 비교 report 작성, R 검증 완료.
**중단/롤백:** 원본/프로젝트 save 접근, 임의 외부 backup 쓰기, verifier의 손상 누락, 이미 알려진 안전 조건 실패. 새 test/harness 커밋만 revert하며 데이터는 복구·삭제하지 않는다.
**커밋 제안:** test: establish isolated V1 performance and integrity baselines.

### Task 1A — V1 에셋 API에 바이너리 수신만 추가 (P1A)

**Create:** server/node/asset-bulk-protocol.cjs, server/node/asset-bulk-protocol.test.ts, test/compat/asset-bulk-v1.test.ts.
**Modify:** server/node/server.cjs의 body parser 배치와 /api/assets/bulk-write 주변만.
**Unchanged:** file-kv.cjs, file-store.cjs, user-data-repository.cjs, db.cjs, 기존 JSON 입력 분기.

- [ ] 아래 protocol vector를 첫 RED 테스트로 작성한다. decoder가 없는 상태에서 실패해야 한다.

~~~ts
import { describe, expect, it } from 'vitest'
const { decodeAssetBulkWrite } = require('./asset-bulk-protocol.cjs')

describe('V1 binary asset frame', () => {
    it('preserves the exact key and binary bytes', () => {
        // count=1, keyLength=8, key="assets/a", valueLength=3, value=00 ff 7f
        const body = Buffer.from('00000001000000086173736574732f610000000300ff7f', 'hex')
        const entries = decodeAssetBulkWrite(body)
        expect(entries).toHaveLength(1)
        expect(entries[0].key).toBe('assets/a')
        expect(entries[0].value.equals(Buffer.from([0, 255, 127]))).toBe(true)
        expect(() => decodeAssetBulkWrite(body.subarray(0, -1))).toThrow()
        expect(() => decodeAssetBulkWrite(Buffer.concat([body, Buffer.from([0])]))).toThrow()
    })
})
~~~

- [ ] v0.9.26 decoder를 참고해 4-byte big-endian count, 각 keyLength/key UTF-8/valueLength/value 순서를 유지한다. 다음 제약은 새 binary 입력에만 적용한다.
  - frame <=64 MiB, count <=200, UTF-8 key <=4 KiB.
  - key는 assets/ 이름공간만 허용한다. NUL, backslash, 빈 경로 요소, . 및 .. 요소, 중복 key, 잘못된 UTF-8을 거부한다. 대상 밖 key는 클라이언트가 전송 전에 기존 JSON 경로를 선택한다.
  - 전체 frame 길이와 모든 entry를 검증한 뒤 KV를 호출한다. 잘린 끝부분을 허용하지 않는다.
  - Buffer 입력에는 불필요한 Buffer.from 전체 복사를 만들지 않는다. decode의 subarray가 참조하는 body는 await가 끝날 때까지 유지한다.
- [ ] 위 제약을 400/413으로 반환하고 writer 호출 0회를 확인한다. count 0/1/200/201, 0-byte value, UTF-8 key, subarray byteOffset, UInt32 최대값, tail, duplicate key 테스트를 추가한다.
- [ ] 전역 2 GiB raw parser가 먼저 body를 할당하지 않도록 bulk binary 전용 64 MiB raw parser를 **전역 raw parser 앞**에 배치한다. JSON parser의 기존 100 MiB 제한과 JSON 입력 동작은 유지한다.
- [ ] /api/assets/bulk-write는 인증·active session 검사를 유지하고, binary는 검증된 Buffer entry, JSON은 기존 base64 entry를 같은 kvSetManyAsync로 보낸다. success는 해당 batch의 await가 끝난 뒤만 반환한다. 호출 순서·object write 동시성·manifest 게시 구현은 변경하지 않는다.
- [ ] GET /api/assets/bulk-write-capabilities를 추가한다. 인증 후 Cache-Control: no-store와 아래 응답을 반환하며 이 조회는 KV 쓰기·writer 권한 획득을 하지 않는다.

~~~json
{"binaryVersion":1,"maxEntries":200,"maxBodyBytes":67108864,"maxKeyBytes":4096}
~~~

- [ ] 동일한 seed의 독립 V1 run에 JSON frame과 binary frame을 각각 보내고 key→value SHA-256, KV object 수, 재시작 후 결과, backup export/import를 비교한다. timestamp는 명시한 허용 목록만 비교에서 제외한다.
- [ ] F4에서 bulk/backup import/삭제가 겹쳐 manifest가 오래된 값으로 게시되는지 검사한다. 문제가 있으면 동시성 확대나 queue 수정을 섞지 않고 P1A를 중단한다.
- [ ] R 복제에서 기존 JSON 가져오기와 binary API를 통한 동일 asset 입력을 비교한다. 일반 채팅 저장·캐릭터 전환·삭제·백업 파일은 baseline과 같은 결과여야 한다.

~~~powershell
& $v1Node node_modules/vitest/vitest.mjs run --config vitest.config.server.ts server/node/asset-bulk-protocol.test.ts server/node/file-kv.test.ts server/node/file-store.test.ts
& $v1Node node_modules/vitest/vitest.mjs run --config vitest.config.compat.ts test/compat/asset-bulk-v1.test.ts test/compat/v1-performance-safety.test.ts test/compat/backup-roundtrip.test.ts
~~~

**예상 효과:** 이 커밋만으로 기존 UI 속도 변화는 없다. 안전한 새 수신 경로를 독립 검증하는 단계다.
**통과:** G1~G4, F0~F9, JSON/binary 왕복 동일, invalid frame의 manifest 쓰기 0, 구형 JSON 클라이언트 정상.
**중단/롤백:** parser 순서·상한·한 entry라도 불일치·기존 JSON 회귀. P1A만 revert하면 기존 클라이언트는 그대로 동작한다.
**커밋 제안:** feat: accept bounded binary asset batches on V1.

### Task 1B — 클라이언트가 확인된 서버에서만 바이너리 전송 (P1B)

**Create:** src/ts/storage/assetBulkProtocol.ts, src/ts/storage/assetBulkProtocol.test.ts.
**Modify:** src/ts/storage/nodeStorage.ts의 setItems와 메모리 내 capability cache, nodeStorage.bulkWrite.test.ts.
**Reuse:** AssetImportBatcher의 기존 200개/32 MiB batching, 64 MiB high-water, writeChain.

- [ ] encodeAssetBulkWrite(entries)를 순수 함수로 만들고 아래 byte vector 테스트부터 RED→GREEN으로 구현한다. 새 저장 키와 image 변환은 만들지 않는다.

~~~ts
import { expect, it } from 'vitest'
import { encodeAssetBulkWrite } from './assetBulkProtocol'

it('encodes the interoperable V1 asset frame', () => {
    const body = encodeAssetBulkWrite([
        { key: 'assets/a', value: Uint8Array.of(0, 255, 127) },
    ])
    expect(Buffer.from(body).toString('hex'))
        .toBe('00000001000000086173736574732f610000000300ff7f')
})
~~~

- [ ] encoder는 UTF-8 key 바이트를 먼저 계산하고 안전 정수 범위 내 총길이 하나로 Uint8Array를 할당한다. DataView.setUint32의 big-endian을 사용한다. value.buffer 전체 대신 value view 범위만 복사한다.
- [ ] setItems 최초 호출에서 capability를 조회하고 in-flight 조회를 같은 인스턴스에서 합친다. binaryVersion=1의 유효 응답만 binary 사용으로 기억한다. 브라우저 재시작 또는 storage 인스턴스 교체 시 다시 확인하며 영구 설정에 쓰지 않는다.
- [ ] 404/405/지원하지 않는 버전이면 **아직 쓰기 요청을 보내기 전** 기존 JSON 경로를 선택한다. 인증 실패·423·네트워크 오류는 기존 오류 경로로 전달한다. 일반 HTML catch-all 200 응답은 binary 지원으로 오인하지 않는다.
- [ ] 최대 200개와 32 MiB payload를 함께 기준으로 binary frame을 직렬 분할한다. 큰 단일 항목 또는 binary key 계약 밖의 항목은 보내기 전에 기존 JSON 동작을 선택한다. bulk body 상한을 맞추려고 저장값을 잘라 보내지 않는다.
- [ ] binary POST의 응답 유실·400·413·500·timeout에는 JSON 자동 재전송을 하지 않는다. 기존 명시적 인증 실패의 한 번 재인증 외에 새 쓰기 retry를 추가하지 않는다.
- [ ] 201개 입력의 200+1 분할, capability 동시 호출 1회, old server에서 JSON body 유지, binary 실패 뒤 추가 POST 0회, 두 번째 batch 실패 시 전체 setItems reject를 테스트한다.
- [ ] 성공한 await 전에 AssetImportBatcher.onStored를 호출하지 않는 기존 보장을 검사한다. importer.done 실패 후 character가 게시되지 않아야 한다.
- [ ] M/I/R에서 동일 CHARX의 JSON baseline과 binary 결과를 측정한다. body는 이론값과 일치해야 하며 image key·bytes·metadata는 그대로여야 한다. F0~F9 및 V1 backup 왕복을 반복한다.

~~~powershell
& $v1Node node_modules/vitest/vitest.mjs run src/ts/storage/assetBulkProtocol.test.ts src/ts/storage/nodeStorage.bulkWrite.test.ts src/ts/process/processzip.test.ts src/ts/characterCards.import.test.ts
& $v1Node node_modules/vitest/vitest.mjs run --config vitest.config.compat.ts test/compat/asset-bulk-v1.test.ts test/compat/v1-performance-safety.test.ts test/compat/backup-roundtrip.test.ts
~~~

**예상 효과:** 큰 binary payload B에 대해 base64 부분은 약 4B/3에서 B로 줄어 body 기준 약 25% 감소. base64 문자열 생성·JSON stringify/parse 부담도 감소할 가능성이 있다. 이미지 파일 크기와 서버 fsync 횟수는 줄이지 않는다.

**통과:** G1~G4, S/M/R 필수, I 메모리 측정, payload 산식 일치, 실제 backend 두 표현의 asset hash 일치, old server JSON 호환 확인.
**중단/롤백:** 메모리 peak 10% 초과 악화·capability 오판·불확실 응답 뒤 재전송·데이터 불일치. P1B만 revert하면 P1A 서버는 계속 JSON을 받는다. 전체 기능을 되돌릴 때도 P1B → P1A 순서.
**커밋 제안:** perf: send negotiated binary asset batches from V1 clients.

### Task 2 — 인증 중복 요청 억제 (P2, 선택적 독립 커밋)

**Modify:** src/ts/storage/nodeStorage.ts.
**Create:** src/ts/storage/nodeStorage.authConcurrency.test.ts.

첫 측정에서 동시 /api/test_auth 호출이 실제로 반복될 때만 진행한다. 이미 인증된 일반 저장이나 디스크 처리의 성능 개선 후보로 사용하지 않는다.

- [ ] 기존 NodeStorage.bulkWrite.test.ts의 모듈 mock 구성을 재사용하고 아래 행동 테스트를 작성한다.

~~~ts
it('shares an in-flight auth check and allows a later check', async () => {
    const storage = new NodeStorage() as any
    let finish!: () => void
    const gate = new Promise<void>(resolve => { finish = resolve })
    storage.performAuthCheck = vi.fn(() => gate)

    const calls = [storage.checkAuth(), storage.checkAuth(), storage.checkAuth()]
    expect(storage.performAuthCheck).toHaveBeenCalledTimes(1)
    finish()
    await Promise.all(calls)
    await storage.checkAuth()
    expect(storage.performAuthCheck).toHaveBeenCalledTimes(2)
})
~~~

- [ ] private authPending 필드를 추가하고 기존 checkAuth 본문을 performAuthCheck로 옮긴다. 원래 암호 입력·login·JWT 갱신·initSession 본문은 그대로 둔다.

~~~ts
private authPending: Promise<void> | null = null

private async checkAuth() {
    if (this.authPending) return this.authPending
    this.authPending = this.performAuthCheck()
    try { await this.authPending }
    finally { this.authPending = null }
}
~~~

- [ ] 실패한 Promise도 모든 대기자에게 전달되고 다음 호출은 재시도하는지, unset/incorrect/token refresh/423 흐름이 그대로인지 테스트한다. 요청을 합친다는 이유로 writer lock 획득이나 이미 거부된 write를 성공 처리하지 않는다.
- [ ] S/M/R에서 첫 동시 read/import 요청의 auth 횟수와 대기시간을 측정한다. F0~F9의 저장 결과는 P1 상태와 같아야 한다.

~~~powershell
& $v1Node node_modules/vitest/vitest.mjs run src/ts/storage/nodeStorage.authConcurrency.test.ts src/ts/storage/nodeStorage.bulkWrite.test.ts
& $v1Node node_modules/vitest/vitest.mjs run --config vitest.config.server.ts server/node/session-lock.test.ts
& $v1Node node_modules/vitest/vitest.mjs run --config vitest.config.compat.ts test/compat/v1-performance-safety.test.ts
~~~

**통과:** 동시 auth 진행 1개, 실패 후 재시도 가능, G1~G4와 R 무결성 동일.
**중단/롤백:** 무한 대기·암호창 중복/누락·session handoff 회귀. P2만 revert한다.
**커밋 제안:** perf: coalesce concurrent V1 authentication checks.

### Task 3A — CHARX decoder 종료·용량 경계 검증 (P3A, 아직 동기 decoder)

**Modify:** src/ts/process/processzip.test.ts, src/ts/characterCards.import.test.ts.
**Create:** src/ts/process/charxDecodeScheduler.test.ts, src/ts/process/charxDecodeScheduler.ts.

- [ ] v0.9.26의 CharXImportDecodeScheduler를 참고해 제한된 scheduler를 만든다. 제품 연결은 P3B까지 하지 않는다. 각 job의 상태는 queued → running → settled 단방향이며 release는 job당 정확히 한 번이다.
- [ ] limit 1/2/4에서 active <= limit, start가 동기 throw하는 경우 슬롯 회수·오류 전달, callback error/final 중복 시 중복 release 금지, pending 취소 시 start 0회, 작업 완료 후 retained buffer 0을 행동 테스트로 고정한다.
- [ ] 현재 동기 importer의 card.json 지연 발견, module.risum, x_meta 728개, 중복 ZIP entry 이름, 49 MiB/50 MiB 경계, originalSize 미제공, 잘린 ZIP, 실패한 asset batch의 결과를 기록한다.
- [ ] 동일 ZIP 경로의 entry는 filename 하나로 진행 중 buffer를 덮어쓰지 않도록 처리 조건을 확정한다. 중복 entry가 있는 카드의 기존 의미를 보존할 수 없으면 P3B는 보류한다.
- [ ] worker 개수 제한만으로 전체 메모리가 제한되지는 않는다는 것을 테스트에 반영한다. active 해제된 데이터, pending 압축 데이터, unzip 내부 대기량, batcher.outstandingBytes를 따로 측정한다.

**기준 측정:** M/I/R의 동기 parser 시간·long tasks·peak memory와 import 결과.
**통과:** scheduler 단위 테스트 및 기존 import 결과 동일, 제품 decoder 미연결 상태에서 G1~G4/F0~F9 유지.
**중단/롤백:** 멈춘 Promise·중복 entry 의미 불명확·메모리 계측 누락. P3A만 revert 가능.
**커밋 제안:** test: define bounded CHARX decode lifecycle.

### Task 3B — 검증된 bounded worker 연결 (P3B)

**Modify:** src/ts/process/processzip.ts, src/ts/process/charxDecodeScheduler.ts 및 대응 테스트.
**Unchanged:** asset key 생성, storage format, saveAsset/AssetImportBatcher의 저장 완료 판단, character 게시 순서.

- [ ] AsyncUnzipInflate를 scheduler에 연결한다. 초기 공통 동시성은 2로 제한하고, Termux 실측에서 더 작은 한도가 필요하면 1을 선택한다. 4는 별도 검증 없이 기본으로 쓰지 않는다.
- [ ] #handleFile은 모든 accepted entry를 발견 시 카운트하고, #handleFileData의 정상 final/error와 file.start throw 모두에서 once-settle하도록 연결한다. #tryFinalize는 inputFinalized && 모든 entry settled && assetBatcher.done 성공일 때만 성공한다.
- [ ] #feedChunk의 입력 backpressure가 pending compressed bytes에도 작동하도록 확인한다. 목표 decode 대기 압축 바이트 64 MiB와 active 결과 상한을 계측하며, 실제 라이브러리 API로 강제할 수 없으면 worker 전환을 출시하지 않는다. 전체 입력을 계속 읽어 큐에 숨기는 구현은 금지한다.
- [ ] 알려진 초과 크기 entry는 worker에서 끝까지 해제해 버리는 v0.9.26 분기를 그대로 가져오지 않는다. 기존 MAX_ASSET_SIZE_BYTES 배제 정책을 유지하며 필요한 parser drain과 정상 종료만 보장한다.
- [ ] Worker를 만들 수 없는 환경에서는 아직 entry를 시작하기 전 전체 import 전략을 동기 방식으로 선택한다. 일부 entry를 저장한 뒤 전체 ZIP을 자동 재시작하지 않는다.
- [ ] UI 취소/탭 종료/worker error에서 실행 중 worker와 pending closure가 해제되는지 검사한다. 먼저 저장된 에셋은 현재 V1 정책대로 남기고 새 cleanup/GC를 넣지 않는다.
- [ ] Windows 실제 브라우저와 Termux Android 브라우저에서 M/I/R을 실행한다. happy-dom 성공을 실제 Web Worker 검증으로 대체하지 않는다. F0~F9 및 backup round-trip을 반복한다.

~~~powershell
& $v1Node node_modules/vitest/vitest.mjs run src/ts/process/charxDecodeScheduler.test.ts src/ts/process/processzip.test.ts src/ts/characterCards.import.test.ts src/ts/storage/nodeStorage.bulkWrite.test.ts
& $v1Node node_modules/vitest/vitest.mjs run --config vitest.config.compat.ts test/compat/v1-performance-safety.test.ts test/compat/backup-roundtrip.test.ts
~~~

**예상 효과:** 압축 해제의 UI 점유 감소. JPEG/WebP처럼 이미 압축된 이미지에서는 전체 소요시간 이득이 작을 수 있다.
**통과:** G1~G4, worker 최대 2(또는 선택한 더 낮은 값), 정해진 메모리 경계 준수, M 완주, 실제 browser long-task 개선, R 결과 동일.
**중단/롤백:** worker 생성/종료 누수, input/decode deadlock, 메모리 경계 불명확, 이미지 누락, 모바일 강제 종료 증가. P3B만 revert하면 기존 동기 decoder와 P1 전송 이점이 남는다.
**커밋 제안:** perf: decode CHARX entries with bounded workers.

### Task 4 — V1 반복 저장 억제의 증명 단계 (P4A/P4B, 조건부)

**Create:** src/ts/storage/v1SaveTracking.svelte.test.ts.
**Modify 후보:** src/ts/globalApi.svelte.ts의 takeTrackedChanges 두 할당만.
**Reuse:** chatStorage.test.ts, chatGuards.test.ts, risuSavePatcher.test.ts, test/compat/v1-performance-safety.test.ts.

이 단계는 승인 전 기본 제외다. 목표는 저장하지 않아도 되는 추적 항목 재사용을 없애는 것이며, debounce를 길게 하거나 flush를 생략하는 것이 아니다.

- [ ] P4A: 현재 Svelte effect를 실제로 작동시키는 fixture에서 DBState 수정 → 공개 requestImmediateSave → 기록된 chat-content/patch/write 요청 → flush/restart 결과를 검사한다. 소스 문자열에 []가 있는지 검사하는 테스트로 대신하지 않는다.
- [ ] 최소 시나리오: 첫 저장 이후 설정만 변경했을 때 같은 chat body 재전송, 아무 편집 없는 immediate save, 저장 Promise 대기 중 두 번째 메시지 편집, 채팅 저장 실패, PATCH 409, 전체 write fallback, hydration 늦은 도착, A 수정 직후 B 전환, A 삭제, plugin의 비선택 캐릭터 편집, chat order/module/folder 변경.
- [ ] 각 시나리오의 최신 내용·삭제 상태·ID별 전송 횟수와 retry 횟수를 기록한다. idle 60초에 실제 반복 저장이 있는지 별도로 측정한다. retained tracker만 보고 idle에서 무한 저장한다고 단정하지 않는다.
- [ ] P4A를 test: capture V1 tracked-save retry and switching behavior로 먼저 커밋한다. 이 커밋은 제품 동작을 바꾸지 않는다.
- [ ] 모든 수정 경로가 effect 또는 명시적 dirty marking에 잡히고 실패 requeue가 유지된 경우에만 P4B 후보를 적용한다.

~~~ts
const toSave = safeStructuredClone(changeTracker)
changeTracker.character = []
changeTracker.chat = []
~~~

- [ ] 나머지 root/botPreset/modules/plugins 필드의 기존 처리, requeueTrackedChanges, knownChatIds 갱신, isHydrating, saveInFlight, requestImmediateSave의 tick/flush 순서를 유지한다.
- [ ] 변경 중 새 edit를 takeTrackedChanges의 snapshot과 섞어 잃지 않는지 검증한다. no-op/retry/failure에는 이전 snapshot과 이후 dirty를 합쳐 다시 저장해야 한다.
- [ ] 이 두 줄로 테스트를 통과하지 못하거나 전 문서 tracker·새 revision 상태·새 저장 queue가 필요하면 **P4B를 폐기**한다. V2 tracking을 가져와 범위를 넓히지 않는다.
- [ ] C/K/R에서 설정-only 변경의 chat POST 수, 전체 DB 조립 횟수, flush 완료시간을 비교한다. S/M/R와 C/K의 F0~F9를 모두 통과시킨다.

~~~powershell
& $v1Node node_modules/vitest/vitest.mjs run src/ts/storage/v1SaveTracking.svelte.test.ts src/ts/storage/chatStorage.test.ts src/ts/storage/chatGuards.test.ts src/ts/storage/risuSavePatcher.test.ts
& $v1Node node_modules/vitest/vitest.mjs run --config vitest.config.compat.ts test/compat/v1-performance-safety.test.ts test/compat/backup-roundtrip.test.ts test/compat/coldstorage.test.ts
~~~

**예상 효과:** 재사용된 tracker 때문에 발생하는 불필요한 chat POST와 그 뒤의 전체 저장을 줄일 가능성. 한 번의 필요한 저장에서 V1 전체 재조립 비용은 그대로다.
**통과:** G1~G4, 저장 중 신규 편집 100회 race에서 누락 0, 삭제·전환·실패 재시도 동일, R 복제 재시작/구버전 왕복 확인.
**중단/롤백:** saveInFlight 동안 edit 소실, 첫 저장 누락, dirty 채팅 재전송 누락, 409/423 우회, 삭제 부활. P4B만 즉시 revert하고 P4A 회귀 테스트는 유지한다.
**커밋 제안:** perf: clear consumed V1 dirty targets between saves.

## 8. 단계별 실제 복제·배포 전 최종 확인

| 단계 | 실제 R 복제의 필수 검증 | 기준 성능·효과 증거 | 독립 롤백 |
| --- | --- | --- | --- |
| P0 | 읽기·저장·재시작·백업 왕복, 원본 hash 불변 | 환경/표본/카운터 재현 | harness만 제거 |
| P1A | JSON/binary API 각각으로 동일 에셋 입력·재시작·백업 | body decode/JSON baseline, 파일 결과 동일 | 서버 additive API만 제거 |
| P1B | 동일 실제 CHARX 전체 가져오기, hash·key·character 게시 확인 | body/wire bytes·CPU·RSS·완료시간 | 클라이언트 JSON으로 복귀 |
| P2 | 초기 로그인·동시 열기·가져오기·세션 전환 | auth 요청 수 | authPending wrapper만 제거 |
| P3A | 기존 동기 decoder로 M/R 기준 재확인 | decoder baseline·오류 종료 | 미연결 scheduler 제거 |
| P3B | Windows/Termux 실제 worker, 취소/중단/재시도·백업 | long tasks·worker 수·대기 바이트·peak memory | 동기 decoder 복귀 |
| P4A/B | 큰 대화 편집 중 캐릭터 전환/삭제, 충돌/재시도·flush | chat POST·전체 조립·fsync 수 | P4B만 되돌림 |

위 표의 각 행은 G1~G4와 F0~F9를 생략하는 축약표가 아니다. 모든 구현 단계의 검증은 새 R run 복제로 수행하고 원본·master는 전후 hash 불변이어야 한다.

구버전 호환 검증은 두 층으로 수행한다.

1. 자동: 태그에서 읽은 v0.9.25 codec/reader와 당시 JSON request 계약을 임시 fixture에 적용해 V1 저장·백업의 의미·바이트를 비교한다. 역사 소스는 test process 안에서만 로드하고 checkout/worktree를 만들지 않는다. 테스트에 사용한 실제 의존성 버전을 보고해 “옛 배포물 전체 검증”과 구분한다.
2. 최종 QA: 별도 검증 기기의 공식 v0.9.25/V1 배포물에 **완성된 복제 백업만** 가져와 열기·수정·저장·다시 export한다. 현재 버전의 새 run으로 되가져와 비교한다. 구버전 실행이 V2 변환을 요구하면 잘못된 fixture로 보고 중단한다. 이 검증이 없으면 실제 구버전 앱 호환은 미검증으로 남긴다.

실제 반영 직전에는 변경된 UI/TS에 pnpm check와 build, 관련 server/compat 테스트를 실행한다. 저장 의미를 건드리는 P4B는 전체 호환 suite도 실행한다. 각 작은 단계마다 무관한 전체 suite를 반복하지는 않는다. 빌드 성공만으로 위 R/플랫폼/중단 복구 검증을 대신하지 않는다.

릴리즈 여부는 사용자 검토 이후 결정한다. 지금 승인받을 결과물은 계획서이며 자동 실행·릴리즈·이관 재활성화는 없다.

### 실제 문제 발생 시 즉시 행동 순서

1. 문제가 난 candidate를 비활성화하고 테스트 서버만 중지한다. 자동 재시도·GC·복원·덮어쓰기를 실행하지 않는다.
2. run 복제, journal, backup, 요청 순서와 hash report를 보존한다. 본문·credential은 공유용 report에서 제외한다.
3. 이번 단계의 코드 커밋만 revert한다. 후속 단계가 선행 API를 요구하면 consumer부터 되돌린다. 데이터 폴더를 이전 버전으로 덮어씌우지 않는다.
4. 새 master 복제에서 이전 승인 코드로 같은 시나리오를 재현한다. 기존 오류인지 후보가 만든 오류인지 판단한다.
5. 손상된 원본이 존재한다는 가정으로 복구 명령을 실행하지 않는다. 이 계획은 원본을 대상으로 하는 실험을 허용하지 않는다.

## 9. 이번 계획 작성에서 수행한 검증과 남은 관문

- 실제 v0.9.25/v0.9.26/v0.9.29 태그와 main의 diff, 저장·전송·CHARX·V2 소유 에셋 경로를 읽었다.
- 저장소 기준 테스트 4개 파일 **27개 통과**: file-store, file-kv, user-data-repository, canonical-projection-sync.
- 클라이언트 기준 테스트 3개 파일 **18개 통과**: nodeStorage.bulkWrite, processzip, characterCards.import.
- 기본 PATH Node v20.11.1과 pnpm 실행은 engine/실행 경로 문제로 실패했다. 번들 Node v24.19.0으로 실행했으며 sandbox spawn EPERM은 승인된 동일 테스트 실행으로 해소됐다. 실행된 Vitest는 4.1.4다.
- 위 테스트는 합성 임시 데이터/모킹 기반이다. 실제 R 복제, Termux, 브라우저 worker, baseline 성능 수치, F0~F9 전체, 구형 배포물 QA, 프로덕션 build는 **이번 작성에서 실행하지 않았다**.
- 문서 자체는 태그 근거·분류·경로·커밋 독립성·검증 명령·실패 판정의 일관성을 확인한다. 구현 파일과 기존 세이브는 변경하지 않는다.
- 작성 결과로 이 계획서와 최신 patchnote/0.9.30.md의 문서 안내만 추가한다. 패치노트에 성능이 이미 개선됐다고 적지 않는다.

**검토 추천:** P0 검증을 준비한 다음 **P1A/P1B 바이너리 에셋 전송**만 첫 이식 대상으로 승인한다. V1 정본 쓰기 경로를 그대로 유지하면서 base64/JSON 비용을 줄일 수 있고, 클라이언트 단독 롤백이 가능하다. 주요 위험은 frame 파싱·구형 서버 판별·메모리 peak·응답 유실이며, 이를 독립적으로 검증할 수 있다. 저장 경로의 가장 큰 구조적 비용은 이번 범위에서 남겨 두는 것이 의도된 결정이다.
