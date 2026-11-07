# 앱 스킨 시스템 제안 (초안)

상태: 제안. 사용자 검토 전. 코드 변경 없음.

## 목표

- 지금 화면은 기본 스킨으로 그대로 남는다. 스킨을 고르지 않으면 픽셀 단위로 지금과 같아야 한다.
- 스킨은 설치, 전환, 내보내기가 되는 꾸러미다. 봇 디자인(예: girls-und-panzer, mha-ultimate-2-0)을 보고 Claude가 같은 화풍의 앱 스킨을 쉽게 만들 수 있어야 한다.
- 앱 버전이 바뀌어도 스킨이 깨지지 않아야 하고, 스킨이 잘못돼도 언제든 기본으로 돌아올 수 있어야 한다.

## 현재 상태 (2026-11-07 조사)

- 색: 토큰 28개가 `src/ts/gui/uiThemeTokens.ts`와 `src/styles.css`에 있고, `colorscheme.ts`의 `updateColorScheme()`가 `--risu-theme-*`를 루트에 쓴다. 하드코딩 색은 테스트(`ThemeTokenContract.test.ts`, `RawUiColors.test.ts`)가 막는다.
- 색 외: 모서리, 그림자, 테두리, 밀도, 질감 토큰이 없다. 글꼴은 `db.font`(default, timesnewroman, custom) 하나뿐이고 역할(UI, 본문, 제목, 숫자) 구분이 없다.
  - Tailwind `rounded-*` 클래스 735곳, CSS `border-radius` 652곳, 그림자 329곳, `font-family` 35곳.
- 테마 프리셋(`themepreset.svelte`)이 색, 글꼴, 크기, customCSS를 묶어 전환한다. 안전 모드(`SafeModeStore`)는 customCSS를 끈다.
- customCSS는 내부 클래스 이름을 아무거나 겨눌 수 있어 버전이 바뀌면 깨진다. 안정적인 훅 클래스는 `risu-modal-*`, `risu-button-lift`, `risu-chat` 정도뿐이다.
- 봇 CSS는 클래스에 `x-risu-` 접두사가 붙어 거의 봇 자기 콘텐츠만 꾸민다. 두 봇 모두 앱 틀 선택자를 쓰지 않는다(MHA의 `.chattext:has(.mha-start)` 한 줄만 예외). 따라서 앱 스킨과 봇 스킨은 서로 독립적으로 둘 수 있다.

## 두 봇에서 뽑은 디자인 언어

| 축 | girls-und-panzer (현대 전차 게임) | mha-ultimate-2-0 (만화) |
|---|---|---|
| 바탕 | 강철색 단계 `#141a1c` `#1c2427` `#2b3337`, 크림 글자 `#f1efe2` | 먹색 `#0b0d12` 계열, 흰 글자 |
| 강조 | 주황 `#e0782a`, 카키 금색 `#e4d58a` 보조 | 노랑 `#ffd21f`, 빨강 `#e3262f` |
| 모서리 | 2~4px, 바깥 패널만 18~22px | 0 (각진 판), 패널 10~14px, 말풍선 30px |
| 테두리 | 1px 반투명 크림 선 | 2~3px 굵은 먹선, 흰 테두리 판 |
| 그림자 | 크고 어두운 번짐 `0 30px 80px` | 번짐 없는 오프셋 `5px 5px 0 #000` |
| 질감 | 강철 그라디언트 | 망점 `radial-gradient` 6~7px |
| 글자 | 굵기 800~900, 작은 라벨 자간 .1~.16em 대문자 | Impact 계열 두꺼운 제목, 자간 .1em, 외곽선 글자 |
| 서명 동작 | 활성 표시 = 아래쪽 3px 주황 안쪽 선, 제목 아래 30×2px 주황 막대 | 주 버튼 기울임 `skewX(-12deg)`, 각진 날짜 탭(clip-path) |

## 설계

### 1. 스킨 = 토큰 꾸러미 + 부품 CSS

스킨 파일(`.risuskin`, JSON 하나)

```jsonc
{
  "skinApi": 1,
  "id": "steel-tactical",
  "name": "강철 전술",
  "base": "dark",
  "source": "girls-und-panzer",          // 참고한 봇(선택)
  "tokens": {
    "color": { /* 기존 28개 토큰과 같은 이름 */ },
    "font": { "ui": "...", "prose": "...", "display": "...", "numeric": "...",
              "labelTracking": "0.12em", "labelCase": "uppercase", "displayWeight": 900 },
    "shape": { "radiusSm": "2px", "radiusMd": "3px", "radiusLg": "4px", "radiusPanel": "18px",
               "corner": "round" },      // round | square | chamfer
    "stroke": { "width": "1px", "strong": "2px" },
    "elevation": { "1": "...", "2": "...", "3": "..." },   // 번짐형 또는 오프셋형
    "texture": { "surface": "none", "opacity": 0 },        // none | halftone | steel | grid
    "density": "normal",                                    // compact | normal | comfortable
    "active": { "style": "underline-inset", "size": "3px" } // 선택 상태 표시 방식
  },
  "assets": { "fonts": [ /* woff2 data, OFL만 */ ], "images": [] },
  "partsCss": "/* 부품 훅만 겨누는 CSS, 선택 */"
}
```

- 토큰만으로 스킨의 80%를 표현한다. 부품 CSS는 서명 동작 2~3개(기울인 버튼, 아래쪽 강조선 등)만 담는다.
- 채팅 본문 가독성 토큰(본문 글꼴, 크기, 줄 간격, 폭)은 스킨이 바꿀 수 있어도 검사기가 하한을 강제한다.

### 2. 토큰화 (기존 화면 그대로)

- Tailwind v4는 `rounded-md`를 `var(--radius-md)`, `shadow-lg`를 `var(--shadow-lg)`, `font-sans`를 `var(--font-sans)`로 그린다. `styles.css`의 `@theme`에서 이 변수를 스킨 토큰에 연결하면 `rounded-*` 735곳이 파일 수정 없이 스킨을 따른다. 기본값은 지금 값과 같게 둔다.
- CSS 안의 `border-radius` 652곳과 그림자는 공용 부품(Sh*, SettingPage, 모달)부터 토큰으로 옮긴다. 옮기지 않은 곳은 기본 모양으로 남을 뿐 깨지지 않는다. 적용 범위를 숫자로 재는 검사를 둔다.
- 글꼴을 역할 4개(ui, prose, display, numeric)로 나눈다. 기존 `db.font` 설정은 prose와 ui의 기본값으로 이어진다.

### 3. 부품 훅 (안정 API)

- 주요 영역에 `data-skin-part`를 붙인다(2단계 완료, 목록과 설명은 `src/ts/gui/uiSkinParts.ts`): `app-shell`, `sidebar-rail`, `rail-icon`, `sidebar-panel`, `chat-screen`, `message`, `composer`, `composer-field`, `button`, `input`, `switch`, `checkbox`, `chip`, `tabs`, `tab`, `modal`, `menu`, `settings-nav`, `settings-page`.
- 부가 정보는 전용 속성으로 노출한다. 라이브러리가 쓰는 `data-state`와 겹치지 않게 `data-skin-` 접두사를 쓴다.
  - `data-skin-state`: `active`(선택된 탭, 선택된 봇 아이콘), `checked`(체크박스).
  - `data-skin-role`: 메시지의 `user`, `bot`.
  - `data-skin-variant`: 버튼과 칩의 종류(`primary`, `ghost`, `destructive` 등).
- 채팅 상단 헤더는 지금 화면에 따로 없어 훅을 만들지 않았다. 생성 중 상태(`generating`)는 3단계에서 필요할 때 더한다.
- 부품 CSS는 이 훅과 토큰만 쓸 수 있다. 적용할 때 `:root[data-skin="<id>"]` 아래로 감싼다. 검사기가 내부 클래스 선택자, `position: fixed`, 원격 `@import`, 핵심 부품 숨기기(`display:none`)를 거부한다.
- 계약 테스트가 모든 훅이 실제 DOM에 있는지 확인한다. 훅을 없애거나 이름을 바꾸면 `skinApi` 버전을 올린다.

### 4. 안정성 장치

- 기본 스킨 = 지금 토큰 값. 토큰화 단계마다 대표 화면 스크린샷을 비교해 차이가 없음을 확인한다.
- 가져올 때 검사: 스키마, 대비(UI 4.5:1, 본문 7:1), 글꼴 대체 경로, 에셋 크기 상한, 부품 CSS 규칙.
- 미리보기 후 적용. 안전 모드와 `?safeskin=1` 주소로 스킨을 끄고 기본으로 시작한다.
- 스킨 데이터가 깨지면 조용히 기본 스킨으로 돌아가고 알림만 남긴다.
- 우선순위: 기본 토큰 < 스킨 < 사용자 customCSS. customCSS는 고급 기능으로 그대로 둔다.
- 봇 콘텐츠(`x-risu-*`)는 스킨이 건드리지 않는다. 봇 HTML이 앱 글꼴을 상속하는 점만 스킨의 prose 글꼴로 이어진다.

### 5. 전환

- 디스플레이 설정에 스킨 목록(미리보기 썸네일, 적용, 내보내기, 삭제).
- 테마 프리셋에 스킨 id를 함께 저장해 기존 프리셋 전환이 스킨도 바꾸게 한다.
- 선택 기능: 봇에 추천 스킨을 연결해 그 봇 채팅에 들어가면 자동 전환(사용자 설정으로 켜고 끔).

### 6. 봇에서 스킨 만들기 (Claude 작업 절차)

전역 스킬 `risubard-skin-from-bot`으로 묶는다.

1. 봇의 `card/background.html`, 공유 CSS, regex 출력 CSS를 읽어 위 표 같은 디자인 언어를 뽑는다.
2. 토큰으로 옮긴다. 봇 고유 콘텐츠 장식(전차 지도, 캐릭터 CG)은 가져오지 않는다.
3. 서명 동작 2~3개만 부품 CSS로 쓴다.
4. 검사기를 통과시키고, 채팅, 사이드바, 설정, 모달 4화면을 데스크톱과 모바일로 찍어 확인한다.
5. `.risuskin`으로 내보낸다.

예상 결과
- 강철 전술(GuP): 강철 바탕, 주황 강조, 모서리 3px, 활성 항목은 아래쪽 주황 안쪽 선, 라벨은 자간 넓힌 대문자, 패널은 깊은 번짐 그림자.
- 히어로 코믹(MHA): 먹색 바탕, 노랑 주 버튼과 빨강 보조, 모서리 0, 굵은 테두리, 오프셋 그림자, 패널에 옅은 망점, 주 버튼만 기울임. 한글 제목용으로 OFL 두꺼운 글꼴(예: Black Han Sans)을 꾸러미에 넣는다(Impact는 사용자 설치 글꼴이라 쓰지 않음).

## 3단계 구현 기록 (2026-11-07)

- 형식과 검사: `src/ts/gui/appSkin.ts`. 필드는 `skinApi`, `id`, `name`, `description`, `source`, `base`, `colors`(색 토큰), `chatText`(채팅 본문 6색), `tokens`(모서리, 그림자, 글꼴 역할), `partsCss`. 512KB, CSS 64KB 상한.
- `partsCss` 규칙: 선택자마다 `data-skin-part` 훅 필수, 클래스와 id 금지, 허용 속성 선택자는 `data-skin-*`, `aria-*`, `disabled`, `open`, `checked`, `data-state`. @규칙은 `@media`, `@supports`, `@keyframes`만. `url()`은 `data:image`만. 중첩 규칙, `position: fixed`, 숨김 선언 금지.
- 적용: `src/ts/gui/appSkinRuntime.ts`가 `<head>`의 `style#risu-app-skin`에 컴파일 결과를 넣고 `:root[data-risu-skin]`을 단다. 토큰은 `!important`로 색 구성이 `:root`에 인라인으로 쓰는 값을 이긴다. 사용자 customCSS는 body 끝에 있어 같은 우선순위면 나중에 적용되지만, 스킨 규칙은 `:root[...]` 범위만큼 구체성이 높으므로 덮으려면 `!important`가 필요하다.
- 저장: `db.appSkins`, `db.appSkinId`(''이 기본). 테마 프리셋에 `appSkinId` 포함.
- 글꼴 내장(`fonts`)은 보류. 설정 저장마다 큰 데이터가 실리지 않도록 4단계에서 에셋 저장소에 두는 방식으로 넣는다.

## 4단계 구현 기록 (2026-11-07)

- 예시 스킨: `charx/bot-factory/bots/girls-und-panzer/skin/steel-tactical.risuskin`(강철 전술), `charx/bot-factory/bots/mha-ultimate-2-0/skin/hero-comic.risuskin`(히어로 코믹). 설정, 채팅, 프롬프트 프리셋 창, 모바일 폭에서 확인.
- 검사 명령: `pnpm check:skin <파일>`(`scripts/check-app-skin.mjs`, 앱과 같은 `validateAppSkin` 사용).
- 제작 절차: 전역 스킬 `risubard-skin-from-bot`.
- 예시를 만들며 바꾼 규칙: `::before`, `::after`만 겨눈 규칙은 숨김 선언 허용.
- 남은 일: 글꼴 내장(에셋 저장소), 봇 연결 자동 전환, 남은 하드코딩 모서리와 그림자 정리.

## 5단계 구현 기록 (2026-11-07)

- 모서리: CSS와 Svelte 스타일의 고정 `border-radius` 500곳을 가장 가까운 토큰의 비율로 바꿨다. 예: `.55rem` → `calc(var(--risu-radius-lg) * 1.1)`. 기본값에서 계산 결과가 같고, 스킨이 토큰을 바꾸면 같은 비율로 따라간다. px 값은 루트 16px 기준으로 rem 토큰에 맞췄다. 0, 알약(999px 등), 원(50%), em 단위, 첫 메시지 스튜디오의 `--studio-radius`(봇 디자인 값)는 그대로 둔다.
- `var(--settings-radius, <고정값>)`의 대체값도 토큰으로 바꿨다. 설정 화면 밖(프롬프트 프리셋 창 등)에서 대체값이 쓰이기 때문이다.
- 그림자: 깊이 그림자 41곳을 `var(--risu-shadow-raised|floating|overlay, 원래 값)`으로 감쌌다. 역할 토큰은 기본으로 선언하지 않아 원래 값이 그대로 쓰이고, 스킨이 정하면 그 크기의 그림자가 한꺼번에 바뀐다. 초점 링, 빛 번짐(오프셋 0), 안쪽 그림자, 강조색 그림자는 깊이가 아니므로 두었다.
- 고정 장치: `src/lib/UI/GUI/SkinShapeContract.test.ts`가 새 고정 모서리, 감싸지 않은 깊이 그림자, 고정 `--settings-radius` 대체값을 막는다.
- 검증: 기본 스킨에서 설정 17개 화면, 홈, 채팅, 프롬프트 프리셋 창의 요소별 모서리와 그림자 계산값이 바꾸기 전과 같음(새로 생긴 값 0). 히어로 코믹 스킨에서 같은 화면들의 둥근 모서리가 0개(스킨 미리보기 카드 4개 제외).

## 글꼴 (2026-11-07)

- 형식: `fonts: [{ family, role?, url?, note?, weight?, style?, data? }]`. `role`은 `ui`, `prose`, `display`, `numeric`. `url`은 https 안내 링크로만 쓰고 CSS에서 불러오지 않는다.
- 역할별 대체: 글꼴 토큰(`tokens.font-<role>`)이 있으면 그 값, 없으면 그 역할의 `fonts`를 순서대로 이어 쓰고, 끝에 역할 기본값을 붙인다(`display`, `numeric`은 `var(--risu-font-ui)`, `ui`, `prose`는 `var(--risu-font-family)`). 이미 일반 글꼴(sans-serif 등)이나 글꼴 토큰으로 끝나면 붙이지 않는다.
- 내장: `data`(base64, 글꼴 서명 확인, 개당 4MB, 합계 12MB, 최대 8개). 설치 때 `saveAsset`으로 에셋 저장소에 옮기고 저장본에는 `asset` 경로만 둔다. 적용 때 `FontFace` API로 등록하고 스킨을 바꾸면 해제한다. 내보낼 때 다시 `data`로 넣는다. 가져오는 파일의 `asset`은 거절한다.
- 정리 보호: `collectDatabaseAssetReferences`가 `appSkins[].fonts[].asset`을 참조로 센다.
- 설치 여부 확인: 캔버스로 글꼴 폭을 일반 글꼴과 비교한다. 흔한 시스템 글꼴까지 모두 같게 나오면 브라우저가 막은 것으로 보고 `확인 불가`.

## 단계

1. 토큰화: Tailwind 테마 변수 연결, 글꼴 역할 분리, 공용 부품의 모서리와 그림자 토큰화. 화면 변화 없음을 스크린샷으로 증명.
2. 부품 훅과 계약 테스트.
3. 스킨 형식, 적용기, 검사기, 설정 화면, 안전 모드, 가져오기와 내보내기.
4. 예시 스킨 2개(GuP, MHA)와 제작 스킬.
5. 남은 하드코딩 모서리와 그림자를 화면별로 정리(채팅, 사이드바, 설정 순). 봇 연결 자동 전환.

1~4단계가 끝나면 "봇 디자인 보고 스킨 만들기"가 된다. 5단계는 적용 범위를 넓히는 정리 작업이다.

## 결정할 것

- 테마 프리셋과 스킨의 관계: 프리셋이 스킨을 품는 방식(제안) 또는 별도 목록.
- 봇 연결 자동 전환을 처음부터 넣을지.
- 스킨 파일에 글꼴을 넣을 때 크기 상한(제안: 글꼴당 2MB, 스킨당 6MB).
