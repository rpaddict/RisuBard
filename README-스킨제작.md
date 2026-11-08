# RisuBard 앱 스킨 제작 안내

RisuBard 앱 화면 전체(사이드바, 채팅, 설정, 창)의 색, 모서리, 그림자, 글꼴, 부품 모양을 바꾸는 **앱 스킨(.risuskin)** 을 만드는 방법입니다.
사람이 읽어도 되고, AI에게 이 문서를 통째로 주고 "이 규칙대로 스킨을 만들어 줘"라고 해도 됩니다.

- 스킨은 JSON 파일 하나입니다. 코드를 고치거나 빌드할 필요가 없습니다.
- 설치: 설정 > 환경 > 앱 스킨 > `파일에서 가져오기` 또는 `코드 붙여넣기`.
- 적용: 같은 곳의 카드, 또는 처음 화면 왼쪽 `앱 스킨` 목록에서 누르면 바로 바뀝니다.
- 설치할 때 앱이 스킨을 검사하고, 규칙에 어긋나면 이유를 보여 주며 거절합니다.
- 화면이 망가졌으면 주소 끝에 `?safeskin=1`을 붙여 열면 기본 화면으로 시작합니다. 거기서 스킨을 바꾸거나 지우세요.

## AI에게 맡길 때

이 문서와 함께 아래처럼 요청하면 됩니다.

```
아래 README-스킨제작.md 규칙만 지켜서 RisuBard 앱 스킨(.risuskin JSON)을 만들어 줘.
분위기: (예: 벚꽃 핀 봄날, 연분홍과 흰색, 둥글고 부드럽게)
어두운 화면 / 밝은 화면: (dark 또는 light)
결과는 JSON 코드 블록 하나로만 줘.
```

참고 예시가 필요하면 앱에 들어 있는 기본 제공 스킨(`둥근 기본`, `히어로 코믹`, `히어로 코믹 (둥근)`, `강철 전술`)을 설정 > 환경 > 앱 스킨에서 `내보내기`로 받아 함께 주세요.

## 가장 작은 스킨

```json
{
  "skinApi": 1,
  "id": "spring-blossom",
  "name": "봄 벚꽃",
  "description": "연분홍 바탕에 흰 카드, 둥근 모서리.",
  "base": "light",
  "colors": {
    "bgcolor": "#fff7f9",
    "darkbg": "#ffe8ee",
    "darkbutton": "#ffd9e3",
    "selected": "#ffcfdc",
    "borderc": "#e86a92",
    "darkborderc": "#f3c3d1",
    "textcolor": "#3a2a30",
    "textcolor2": "#7d6670",
    "primary": "#e86a92",
    "accenttext": "#ffffff"
  },
  "tokens": {
    "radius-md": "0.75rem",
    "radius-lg": "1rem"
  }
}
```

이것만으로도 앱 전체 색과 모서리가 바뀝니다. 나머지 항목은 모두 선택입니다.

## 파일 형식

| 항목 | 필수 | 내용 |
|---|---|---|
| `skinApi` | 예 | 항상 `1` |
| `id` | 예 | 영문 소문자, 숫자, 하이픈. 48자 이하. 같은 id로 다시 설치하면 덮어씁니다 |
| `name` | 예 | 카드에 보일 이름. 80자 이하 |
| `description` | 아니오 | 한 줄 설명. 500자 이하 |
| `source` | 아니오 | 참고한 작품이나 봇 이름. 카드에 `참고: …`로 보입니다 |
| `base` | 아니오 | `dark` 또는 `light`. 스크롤바, 입력칸 같은 브라우저 기본 부품의 명암 |
| `colors` | 아니오 | 앱 색 (아래 표) |
| `chatText` | 아니오 | 채팅 본문 글자색 |
| `tokens` | 아니오 | 모서리, 그림자, 글꼴, 메시지 카드 잘림 모서리 |
| `fonts` | 아니오 | 글꼴 이름과 받을 곳, 또는 글꼴 파일 |
| `partsCss` | 아니오 | 부품 모양을 바꾸는 CSS 문자열 |

크기 제한: 파일 전체(글꼴 제외) 512KB, `partsCss` 64KB, 글꼴 8개, 글꼴 하나 4MB, 글꼴 합계 12MB.

### colors

값은 `#rrggbb`, `rgb(...)`, `hsl(...)` 같은 색입니다. 스킨이 색을 정하면 사용자의 색상 팔레트보다 스킨 색이 먼저 보입니다.

기본 11색 (이것만 정해도 충분합니다):

| 이름 | 쓰이는 곳 |
|---|---|
| `bgcolor` | 앱 바탕, 메시지 카드 |
| `darkbg` | 사이드바, 패널 (바탕보다 한 단계 다른 면) |
| `darkbutton` | 버튼 면 |
| `selected` | 선택된 항목의 면 |
| `borderc` | 초점, 강조 테두리 |
| `darkborderc` | 평소의 가는 구분선 |
| `textcolor` | 본문 글자 |
| `textcolor2` | 보조 글자 (설명, 날짜) |
| `primary` | 강조색 (주 버튼, 선택 표시) |
| `accenttext` | `primary` 위 글자색. 대비 4.5:1 이상. 밝은 강조색이면 어두운 글자 |
| `draculared` | 빨간 경고 |

추가로 정할 수 있는 색 (안 정하면 남는 파란색, 보라색이 보일 수 있습니다):

- 고정, 바인딩: `binding`, `binding-text`, `binding-border`
- 상태: `info`, `success`, `warning`, `danger`, `secondary` 와 각각의 `-bg`, `-border`, `on-` 짝 (예: `danger-bg`, `danger-border`, `on-danger`)
- 기타: `overlay`(창 뒤 어두운 막), `shadow`(그림자 색), `media-bg`, `media-text`(그림 위 글자), `switch-thumb`(스위치 손잡이)

### chatText

채팅 본문 글자색 6가지: `standard`(본문), `bold`, `italic`, `italicBold`, `quote1`(작은따옴표 대사), `quote2`(큰따옴표 대사). 본문 `standard`는 바탕과 대비 7:1 이상이 읽기 좋습니다.

### tokens

| 이름 | 내용 |
|---|---|
| `radius`, `radius-xs` ~ `radius-4xl` | 모서리 둥글기. 작은 부품은 `xs`~`md`, 카드는 `lg`, 창은 `2xl`, 메시지 입력창은 `3xl`. 앱의 다른 모서리도 가까운 단계를 따라옵니다 |
| `shadow`, `shadow-2xs` ~ `shadow-2xl`, `shadow-popover` | 그림자 크기별 값. `shadow-popover`는 드롭다운 |
| `shadow-raised`, `shadow-floating`, `shadow-overlay` | 작은 부품, 떠 있는 카드, 창과 서랍의 깊이 그림자를 한꺼번에 바꿉니다 |
| `font-ui`, `font-prose`, `font-display`, `font-numeric` | 글꼴 묶음을 직접 적을 때. 보통은 `fonts`를 쓰세요 |
| `message-clip-radius` | 화면보다 긴 메시지 카드가 화면 위쪽이나 입력창 위에서 잘릴 때 그 자리를 이 반지름으로 둥글게 깎습니다. 카드 모서리를 크게 둥글린 스킨에 쓰세요 (예: `1.5rem`) |

기본값 참고: `radius-md` 0.375rem, `radius-lg` 0.5rem, `radius-2xl` 1rem, `radius-3xl` 1.5rem.

### fonts

```json
"fonts": [
  { "family": "Gowun Dodum", "role": "ui", "url": "https://fonts.google.com/specimen/Gowun+Dodum", "note": "무료(OFL)" },
  { "family": "Black Han Sans", "role": "display" }
]
```

- `role`: `ui`(앱 화면), `prose`(채팅 본문), `display`(제목), `numeric`(숫자).
- 글꼴 이름만 적으면 사용자 컴퓨터에 그 글꼴이 있을 때만 보입니다. 없으면 기본 글꼴로 대신 보이고, 앱이 `받기` 링크(`url`)를 띄워 줍니다.
- 어디서나 같게 보이게 하려면 글꼴 파일을 `data`에 넣습니다: `"data": "data:font/woff2;base64,..."` (woff2, woff, ttf, otf). 배포가 허락된 무료 글꼴만 넣으세요.
- 제목 글꼴은 한글이 있는 글꼴을 먼저 두세요. `display` 글꼴은 앱이 직접 쓰지 않으므로 `partsCss`에서 `font-family: var(--risu-font-display)`로 부릅니다.

## partsCss: 부품 모양

색과 모서리만으로 부족할 때 쓰는 CSS입니다. **앱 내부 클래스나 id는 겨눌 수 없고, 아래의 `data-skin-part` 훅만 겨눌 수 있습니다.** 그래서 앱이 업데이트되어도 스킨이 깨지지 않습니다.

### 훅 목록

| 훅 | 부품 | 추가 속성 |
|---|---|---|
| `app-shell` | 앱 전체 틀 | |
| `sidebar-rail` | 왼쪽 좁은 아이콘 줄 | |
| `rail-icon` | 레일의 봇 아이콘, 메뉴 버튼 | `data-skin-state="active"` |
| `sidebar-panel` | 레일 옆 패널 (대화 목록, 봇 설정) | |
| `chat-screen` | 채팅 스크롤 영역 (메시지와 입력창 포함) | |
| `message` | 메시지 한 줄 전체 | `data-skin-role="user"` / `"bot"` |
| `message-card` | 눈에 보이는 메시지 카드 | |
| `composer` | 아래 메시지 입력 구역 | |
| `composer-field` | 둥근 메시지 입력창 틀 | |
| `button` | 버튼 | `data-skin-variant`: `default`, `outline`, `secondary`, `ghost`, `destructive`, `success`, `primary`, `soft-primary`, `binding`, `link` |
| `input` | 입력칸, 여러 줄 입력칸, 숫자, 선택 상자 | |
| `switch` | 켜고 끄는 스위치 | |
| `checkbox` | 체크박스 | `data-skin-state="checked"` |
| `chip` | 작은 배지, 태그 | `data-skin-variant`: `default`, `secondary`, `destructive`, `outline`, `ghost`, `link`, `warning`, `info`, `success` |
| `tabs` | 탭 줄 | |
| `tab` | 탭 하나 | `data-skin-state="active"` |
| `modal` | 창 | |
| `menu` | 드롭다운 메뉴 | |
| `settings-nav` | 설정 왼쪽 목록 (현재 항목은 `[aria-current="page"]`) | |
| `settings-page` | 설정 한 페이지 | |

### 쓸 수 있는 것

- 선택자마다 `[data-skin-part="..."]`가 하나 이상 있어야 합니다.
- 그 아래의 일반 태그(`h1`, `svg`, `img`, `button` 등), `[aria-*]`, `[data-state]`, `[disabled]` 같은 속성 선택자.
- 가상 클래스 `:hover`, `:focus`, `:focus-visible`, `:focus-within`, `:active`, `:disabled`, `:checked`, `:first-child`, `:last-child`, `:nth-child()`, `:empty`, `:not()`, `:is()`, `:where()`, `:has()` 등.
- 가상 요소 `::before`, `::after`, `::placeholder`, `::selection`, `::marker`.
- `@media`, `@supports`, `@keyframes`.
- 그림은 `url(data:image/...)`만 됩니다.
- 앱 자체 스타일과 부딪히면 `!important`를 붙이세요.

### 쓸 수 없는 것 (설치가 거절됩니다)

- 클래스(`.x`)와 id(`#x`) 선택자, 등록되지 않은 훅 이름.
- 외부 주소(`url(https://...)`), `@import`, 스크립트성 값.
- `position: fixed`.
- 앱 부품을 숨기는 `display: none`, `visibility: hidden`, `opacity: 0`. 숨기기는 `::before`, `::after` 장식에만 허락됩니다.
- `<`, `\` 문자.

### 배치는 건드리지 마세요 (중요)

부품의 `padding`, `margin`, 너비와 높이, 테두리 굵기, 글자 크기, 글꼴, 자간, `transform`을 바꾸면 훅이 없는 옆 요소와 줄이 어긋납니다. 설치는 되지만 경고가 뜹니다. 대신:

- 굵은 테두리와 외곽선은 `box-shadow: 0 0 0 2px #000`(안쪽은 `inset`)이나 `outline`으로 그립니다. 크기가 변하지 않습니다.
- 기울임과 깎은 모서리는 `clip-path`로 만듭니다. 단, 글자가 잘리지 않을 만큼만.
- 무늬(망점, 격자, 줄무늬)는 `background-image`를 여러 겹 쌓아 그립니다.
- 움직임(`transform`)은 `:hover`, `:active` 반응에만 씁니다.
- 제목 글꼴과 자간은 `h1`~`h6`에만 씁니다.

### 예시

```css
/* 레일: 짙은 그라디언트와 오른쪽 먹선 */
[data-skin-part="sidebar-rail"] {
  background: linear-gradient(180deg, #2b2f3a, #14161c) !important;
  box-shadow: inset -2px 0 0 #000000;
}
/* 선택된 레일 아이콘: 바깥 고리 */
[data-skin-part="rail-icon"][data-skin-state="active"] {
  box-shadow: 0 0 0 1px #000000, 0 0 0 3px #e86a92 !important;
}
/* 선택된 탭: 강조색 면, 기본 밑줄 지우기 */
[data-skin-part="tab"][data-skin-state="active"] { background: #e86a92 !important; color: #ffffff !important; }
[data-skin-part="tab"][data-skin-state="active"]::after { display: none !important; }
/* 주 버튼: 번짐 없는 그림자 */
[data-skin-part="button"][data-skin-variant="primary"] { box-shadow: 3px 3px 0 #000000; }
/* 메시지 카드: 내 메시지와 봇 메시지 다르게 */
[data-skin-part="message"] { background-color: transparent !important; }
[data-skin-part="message"][data-skin-role="user"] [data-skin-part="message-card"] { box-shadow: inset 0 0 0 2px #e86a92; }
/* 휴대폰 너비에서는 카드가 화면 끝까지 차므로 옆 그림자 빼기 */
@media (max-width: 639px) {
  [data-skin-part="message-card"] { box-shadow: none; }
}
/* 설정 페이지 제목 */
[data-skin-part="settings-page"] h1 { font-family: var(--risu-font-display); color: #e86a92; }
```

JSON 안에서 `partsCss`는 문자열 하나입니다. 줄바꿈은 `\n`으로, CSS 속 큰따옴표는 `\"`로 적습니다. CSS에서 작은따옴표(`[data-skin-part='tab']`)를 쓰면 이스케이프가 줄어듭니다. 앱의 `코드 붙여넣기`는 올바른 JSON만 받습니다.

### 알아 두면 좋은 것

- 앱 일부 버튼과 표시는 강조색(`primary`)을 그대로 씁니다. 특정 구역만 다른 강조색을 쓰려면 그 훅에 변수를 다시 정하세요: `[data-skin-part="sidebar-rail"] { --color-primary: #ffffff; --risu-theme-primary: #ffffff; }`
- 채팅 본문 안(봇이 만든 HTML)은 봇이 꾸미는 영역입니다. 스킨은 카드까지만 꾸미세요.
- 사용자가 설정 > 환경에서 배경 그림을 넣으면 채팅 영역 배경은 비워지고 그림이 보입니다. 메시지 카드는 제 바탕색을 지킵니다.

## 완성 전 점검

1. JSON이 올바른가 (`코드 붙여넣기`로 설치되는가).
2. 설치할 때 오류나 "배치를 바꾸는 속성" 경고가 없는가.
3. 설정 화면, 채팅 화면(메시지가 있는 상태), 창(예: 프롬프트 프리셋 창)을 열어 보았는가.
4. 글자와 바탕의 대비가 충분한가. 특히 `primary` 위의 `accenttext`.
5. 남은 기본 파란색, 보라색이 없는가 (`binding`, `info`, `secondary` 색 확인).
6. 휴대폰 너비(약 375px)에서도 보기 괜찮은가.
7. `?safeskin=1`로 열면 기본 화면으로 돌아오는가.

RisuBard 소스 코드를 가지고 있다면 `pnpm check:skin <파일>`로 앱이 설치할 때와 같은 검사를 미리 돌릴 수 있습니다.
