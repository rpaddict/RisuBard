# RisuBard 자동 업데이터

## 개요

2026-08-19부터 RisuBard 공개판의 자동 업데이터는 이전 공개판의 업데이트 워커가 아니라 `rpaddict/RisuBard`의 GitHub Releases를 직접 확인한다.

- 릴리즈 확인 API: `https://api.github.com/repos/rpaddict/RisuBard/releases/latest`
- 릴리즈 다운로드 저장소: `https://github.com/rpaddict/RisuBard`
- 적용 대상: `RisuBard-public`
- 비공개 소설가 모드 저장소인 `RisuBard-private`에는 이 작업을 적용하지 않았다.

## 변경 이유

기존 서버는 이전 업데이트 워커의 응답을 사용했고, 휴대용 업데이트 스크립트도 이전 저장소의 릴리즈를 조회했다. 이 상태에서는 RisuBard가 자체 릴리즈를 발행해도 사용자에게 업데이트가 표시되거나 자동 설치되지 않는다.

이번 변경으로 웹 UI의 업데이트 확인, 포터블 셀프 업데이트, 독립 실행형 업데이트 스크립트가 모두 `rpaddict/RisuBard`를 기준으로 동작한다.

## 동작 과정

1. 클라이언트가 서버의 `GET /api/update-check`를 호출한다.
2. 서버가 `rpaddict/RisuBard`의 최신 공개 릴리즈를 GitHub API로 조회한다.
3. 릴리즈 태그의 앞에 붙은 `v`를 제거하고 현재 `package.json` 버전과 비교한다.
4. 최신 릴리즈가 더 높은 버전이면 선택 업데이트로 응답한다.
5. 포터블 배포판은 플랫폼에 맞는 릴리즈 파일이 있으면 `POST /api/self-update`로 다운로드하고 교체한다.
6. 릴리즈 빌드가 생성하는 포터블 `update.bat`과 `update.sh`는 독립 업데이터를 실행해 같은 저장소의 최신 릴리즈 파일을 사용한다.
7. 저장소 루트의 소스 빌드용 `update.sh`도 같은 저장소의 최신 태그 소스를 받아 다시 빌드한다.

Windows의 독립 `update.bat`은 파일 교체 전에 같은 포터블 폴더의 `node.exe`와 `cloudflared.exe`가 실행 중인지 확인한다. 실행 중이면 설치 파일을 변경하지 않고 종료하며, 후처리 중 실행 파일 복사가 실패한 경우에는 `.update-tmp/backup`을 즉시 복원한다. 롤백을 수행하는 동안 실행 중인 `update.bat` 자체는 덮어쓰지 않는다.

GitHub가 `404`를 반환하는 경우는 공개 릴리즈가 없는 상태로 간주한다. 이때 서버는 실패 팝업을 표시하지 않고 “업데이트 없음”으로 응답한다.

## 릴리즈 요구사항

자동 업데이트에 노출하려면 릴리즈가 다음 조건을 만족해야 한다.

- 태그는 `vX.Y.Z` 형식을 사용한다. 예: `v0.1.1`
- 릴리즈는 초안이 아닌 공개 발행 상태여야 한다.
- 사전 릴리즈가 아닌 일반 릴리즈여야 `releases/latest`에서 조회된다.
- `package.json`의 현재 버전보다 태그 버전이 높아야 한다.
- 포터블 자동 설치에는 실행 환경과 일치하는 릴리즈 파일이 필요하다.

현재 `.github/workflows/release.yml`은 `workflow_dispatch`에서 배포할 버전을 입력받는다. 입력 버전이 `package.json` 및 `patchnote/X.Y.Z.md`와 일치하는지 먼저 검사하고, 전체 검증과 네 플랫폼 패키징이 모두 성공한 뒤에만 태그와 `draft: true` 초안을 생성한다. 빌드가 끝난 뒤 GitHub에서 초안을 검토하고 **Publish release**를 눌러야 사용자 앱이 새 버전을 발견한다.

포터블에 포함하는 Cloudflared 버전은 릴리즈 워크플로에 고정한다. 일반 앱 릴리즈마다 외부의 `latest`가 달라져 Windows 실행 파일 교체가 불필요하게 발생하지 않도록 하며, 버전 갱신은 명시적인 릴리즈 변경으로 수행한다.

릴리즈 준비 커밋을 `main`에 푸시한 뒤 다음 명령으로 워크플로를 시작한다. 전체 검증은 태그 생성 전에 CI에서 한 번만 실행하므로 릴리즈를 위해 로컬에서 같은 전체 명령을 다시 실행하지 않는다. CI가 실패하면 태그와 초안은 만들어지지 않는다.

```powershell
gh workflow run release.yml --ref main -f version=X.Y.Z
```

실행이 끝나면 해당 워크플로의 커밋, 초안 본문, 네 플랫폼 아티팩트와 해시를 확인한 뒤 공개한다. 코드 변경을 구현할 때 수행하는 검증은 이 릴리즈 절차와 별개이며 생략하지 않는다.

## 포터블 파일명 규칙

포터블 파일명은 `RisuBard` 접두사를 사용한다.

| 실행 환경 | 예상 파일명 |
| --- | --- |
| Windows x64 | `RisuBard-vX.Y.Z-win-x64.zip` |
| Linux x64 | `RisuBard-vX.Y.Z-linux-x64.tar.gz` |
| Linux ARM64 | `RisuBard-vX.Y.Z-linux-arm64.tar.gz` |
| macOS ARM64 | `RisuBard-vX.Y.Z-macos-arm64.tar.gz` |

릴리즈 워크플로와 `getSelfUpdateAssetInfo()`도 같은 파일명 규칙을 사용한다.

## 배포 형태별 차이

| 배포 형태 | 업데이트 알림 | 웹 셀프 업데이트 |
| --- | --- | --- |
| 포터블 (`.portable` 존재) | 지원 | 지원 |
| Git 체크아웃 | 지원 | 지원하지 않음 |
| Docker | 지원 | 지원하지 않음 |
| Termux 및 기타 환경 | 지원 | 지원하지 않음 |

포터블 이외의 환경은 새 버전을 안내할 수 있지만 설치 방법이 서로 다르므로 서버가 파일을 직접 교체하지 않는다.

## 환경 변수

| 환경 변수 | 용도 |
| --- | --- |
| `RISU_UPDATE_CHECK=false` | 릴리즈 확인 기능을 비활성화한다. |
| `RISU_UPDATE_URL` | 기본 GitHub 최신 릴리즈 API 대신 사용할 주소를 지정한다. 응답은 GitHub Release JSON 형식이어야 한다. |

## 변경 파일

- `scripts/updater-recovery.cjs`: Windows 후처리 실패 시 이전 설치 복원
- `scripts/portable/update.bat`: Windows 실행 파일 후처리와 자동 롤백
- `server/node/server.cjs`: GitHub 최신 릴리즈 직접 조회, 대상 저장소 변경
- `server/node/release-update.cjs`: 릴리즈 태그 정규화와 버전 비교
- `scripts/updater.cjs`: 독립 업데이터 대상 저장소 변경
- `update.sh`: 소스 빌드용 업데이터의 대상 저장소와 압축 해제 디렉터리 규칙 변경
- `server/node/release-update.test.ts`: 버전 비교와 업데이트 판정 테스트
- `server/node/risubard-update-release.test.ts`: 서버와 스크립트의 저장소 대상 회귀 테스트

## 검증

다음 명령으로 변경을 검증했다.

```powershell
& '.\node_modules\.bin\vitest.cmd' run --config vitest.config.server.ts `
  server/node/release-update.test.ts `
  server/node/risubard-update-release.test.ts

node --check server/node/server.cjs
node --check server/node/release-update.cjs
node --check scripts/updater.cjs
& 'C:\Program Files\Git\bin\bash.exe' -n update.sh
```

결과는 테스트 파일 2개, 테스트 3개가 모두 통과했으며 세 CommonJS 파일과 `update.sh`의 구문 검사도 통과했다.

## 관련 코드

- 업데이트 확인과 셀프 업데이트: `server/node/server.cjs`
- GitHub 릴리즈 변환과 버전 비교: `server/node/release-update.cjs`
- 독립 포터블 업데이터: `scripts/updater.cjs`
- 소스 빌드용 업데이터: `update.sh`
- 릴리즈 빌드 및 초안 생성: `.github/workflows/release.yml`
