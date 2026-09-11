# V2 세이브를 V1 구조로 변환하기

RisuBard 0.9.28은 0.9.25의 V1 저장 구조를 사용합니다. 0.9.26~0.9.27에서 V2로 이관한 세이브는 별도 변환기로 새 V1 폴더를 만든 뒤 사용할 수 있습니다.

변환기는 원본 폴더를 읽기만 합니다. 원본 안의 파일을 수정하거나 삭제하지 않으며, 이미 존재하는 목적지에는 쓰지 않습니다. 변환이 끝나기 전에는 임시 폴더에 저장하고 전체 검증이 성공한 경우에만 목적지 이름으로 바꿉니다.

## Windows 포터블판: 폴더를 끌어다 놓거나 경로 입력하기

1. 실행 중인 RisuBard를 모두 종료합니다.
2. V2 데이터 폴더를 포터블 폴더의 `V2-to-V1.bat` 위에 끌어다 놓습니다.
3. 드래그 앤 드롭이 어렵다면 `V2-to-V1.bat`을 더블 클릭하고 V2 데이터 폴더의 절대경로를 입력한 뒤 `Enter`를 누릅니다.
4. 화면에 표시되는 현재 작업과 진행률이 100%가 될 때까지 기다립니다.

원본이 `E:\RisuBard-userdata`라면 결과는 자동으로 `E:\RisuBard-userdata-v1`에 생성됩니다. 결과 폴더가 이미 있으면 덮어쓰지 않고 중단합니다.

## 명령어로 실행

RisuBard 소스 폴더에서는 V2 원본 경로 하나만 지정합니다.

```powershell
pnpm run convert:v2-to-v1 -- "E:\RisuBard-userdata"
```

결과는 자동으로 `E:\RisuBard-userdata-v1`에 생성됩니다. 목적지를 직접 지정해야 할 때만 두 번째 경로를 추가합니다.

```powershell
node scripts/convert-v2-to-v0925.cjs "E:\RisuBard-userdata-v2" "E:\RisuBard-userdata-v1"
```

Linux·macOS 포터블판에서는 다음처럼 실행합니다.

```bash
./V2-to-V1.sh "/path/to/RisuBard-userdata"
```

## Android Termux

RisuBard 소스 폴더에서 서버를 종료한 뒤 다음 한 줄을 실행합니다.

```bash
bash scripts/termux/downgrade-and-start-v1.sh
```

기본 V2 데이터인 `$HOME/.local/share/risubard`를 읽어 `$HOME/.local/share/risubard-v1`을 만든 뒤, 그 V1 폴더로 서버를 바로 시작합니다. 이후에도 같은 명령을 사용하면 변환을 반복하지 않고 기존 V1 결과로 서버를 시작합니다.

`RISUBARD_DATA_ROOT`로 다른 폴더를 사용했던 경우에는 그 V2 경로 하나만 지정합니다.

```bash
bash scripts/termux/downgrade-and-start-v1.sh "/data/data/com.termux/files/home/my-risubard-data"
```

## 변환 결과 확인

성공하면 목적지에 `conversion/v2-to-v0925.json` 검증 기록이 생성됩니다. 이 기록에는 원본 전체의 SHA-256 요약과 변환한 캐릭터·자산·KV 항목 수, 복구 모드에서 건너뛴 파일 경고가 들어 있습니다.

변환기는 다음 내용을 대조한 뒤에만 성공합니다.

- 설정과 로그인 정보
- 캐릭터, 대화, 모든 메시지와 초안
- 모듈, 페르소나, 프롬프트, 전역 로어북
- KV 데이터와 참조된 이미지·음성 자산
- BardWiki, 로그 등 별도 보조 폴더
- 변환 전후 V2 원본 전체의 파일 목록·크기·해시

오류가 발생하면 최종 목적지 폴더를 만들지 않습니다. 파일 누락 때문에 중단된 Windows 포터블 변환기는 누락 항목을 제외하고 복구 변환을 시도할지 묻습니다. 복구 모드는 누락된 분리 설명, 채팅 메시지, 에셋 사본과 KV 데이터를 경고로 기록하고 나머지 데이터를 변환합니다. 누락된 채팅 메시지는 빈 대화로 복원되며, 누락된 설명·이미지·항목은 결과에서 빠질 수 있습니다.

V2 레이아웃, 사이드바 인덱스, 기본 설정처럼 정상적인 V1 구조를 만드는 데 필요한 핵심 파일은 복구 모드에서도 무시하지 않고 중단합니다. 체크섬 불일치, 잘못된 인덱스, 변환 중 원본 변경도 계속 실패로 처리합니다.

## 변환본으로 실행

개발 환경에서는 서버를 시작할 PowerShell에서 변환본을 지정합니다.

```powershell
$env:RISUBARD_DATA_ROOT = "E:\RisuBard-userdata-v1"
pnpm run dev:server
```

포터블판에서는 같은 방식으로 환경 변수를 지정한 뒤 실행합니다.

```powershell
$env:RISUBARD_DATA_ROOT = "E:\RisuBard-userdata-v1"
.\RisuBard.exe
```

정상 작동을 확인할 때까지 V2 원본을 그대로 보관하세요.
