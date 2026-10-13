# 개발 프로젝트 에셋 연결 검증 보고서

작성일: 2026-10-13. 수행 범위: 에셋 공간 병합 계획 Task 5, 설계 §4.

## 구현 사실

- `resolveAssetsLink`가 dev 링크의 대상 종류와 디렉터리 존재 여부를 확인한다. 조회와 디렉터리 판정을 주입할 수 있으며 파일을 변경하지 않는다. 읽기 실패는 null로 처리한다.
- 터미널 `argsFor`와 `envFor`가 같은 해석 함수를 사용한다. 유효한 연결에만 `--add-dir` 한 쌍과 `YAL_ASSETS_DIR`를 제공한다.
- PTY 생성 시 부모 환경의 `YAL_ASSETS_DIR`를 제거한 뒤 현재 프로젝트 환경을 적용한다. 연결 해제 후 오래된 값이 상속되는 경우도 차단한다.
- dev 프로비저닝에서 `assets/ASSETS-USED.md` 초안을 생성한다. 기존 파일은 보존하며 `wx`로 생성한다. 프로젝트 루트와 조상, assets 폴더, 기록 파일의 심볼릭 링크·Windows junction을 거부한다. assets가 일반 파일이면 오류를 로그에 남기고 false를 반환한다.
- IDE는 에셋을 자동 복사하지 않는다. 생성된 기록 초안에는 용도와 지정된 출처 항목 형식을 넣었다.
- 드롭다운은 assets 목록에 실제 존재하는 id만 선택값으로 표시한다. 삭제됐거나 다른 종류의 대상은 ‘링크 없음’으로 표시한다.
- 링크는 레지스트리에 저장된다. 기존 레지스트리 재로드 테스트와 격리 앱 새로고침에서 유지됨을 확인했다.

## 조건별 규칙

| 조건 | --add-dir | YAL_ASSETS_DIR | 터미널 |
| --- | --- | --- | --- |
| dev + 연결 대상 존재 + kind assets + 디렉터리 | 대상 경로, 정확히 1회 | 대상 경로 | 정상 시작 |
| dev + 링크 없음 | 없음 | 키 없음 | 정상 시작 |
| dev + 대상 삭제 또는 끊어진 id | 없음 | 키 없음 | 정상 시작 |
| dev + 대상 종류 불일치 | 없음 | 키 없음 | 링크 해석 null |
| dev + 대상 경로 없음 또는 일반 파일 | 없음 | 키 없음 | 정상 시작 |
| assets 또는 manage | 없음 | 키 없음 | 정상 시작 |

## 변경 파일과 산출물

| 파일 | 변경 내용 |
| --- | --- |
| `src/main/assetsLink.ts` | 연결 해석 함수 신규 |
| `src/main/assetsUsageNote.ts` | 사용 기록 초안 생성 함수 신규 |
| `src/main/index.ts` | 인자·환경변수에 연결 해석 적용 |
| `src/main/ptyAdapter.ts` | 오래된 에셋 환경변수 상속 제거 |
| `src/main/provisioner.ts` | dev 전용 사용 기록 생성 |
| `src/main/skills/builtin/yal-game-planning.md` | 환경변수 제공 조건 표현 정렬 |
| `src/renderer/src/components/ProjectList.tsx` | 끊어진 링크 선택값 정리 |
| `tests/assetsLink.test.ts` | 정상·무효 연결 조건 검증 신규 |
| `tests/assetsUsageNote.test.ts` | 생성·보존·심볼릭 링크·공간 분기 검증 신규 |
| `tests/assetsPtyEnv.test.ts` | 상속 환경 제거 검증 신규 |
| `tests/projectMain.test.ts` | 실제 main 흐름의 인자·환경·삭제 후 시작 검증 |
| `tests/provisioner.test.ts` | 생성 파일 목록 갱신 |
| `tests/terminalManager.test.ts` | settings·권한·continue·add-dir 순서 검증 |
| `tests/rendererProjects.test.ts` | 끊어진 링크와 종류 불일치 표시 검증 |
| `.verify/assets-link-runtime.cjs` | 격리 앱·새로고침·재시작·캡처 검증 |
| `.verify/assets-link-fake-claude.cjs` | 실제 PTY fixture의 argv·제한된 env 기록 |
| `docs/investigation/2026-10-13-assets-link-report.md` | 본 보고서 |

`templates.ts`의 dev CLAUDE.md/AGENTS.md는 위 스킬 본문을 공통으로 읽으므로 해당 파일을 직접 수정하지 않고 두 템플릿 문구를 함께 정렬했다.

## 스킬 버전 판단

v3를 유지했다. ‘링크가 있을 때’라는 기존 조건 아래의 `YAL_ASSETS_DIR` 설명만 ‘제공되면’에서 ‘유효한 에셋 연결 시 제공됨’으로 변경했다. 제작·복사·기록·원본 보존 규칙의 의미는 동일하다. 지시서가 허용한 소규모 문구 정렬에 해당한다. v4와 v3 이전본 파일은 추가하지 않았다. 설치된 v3는 기존 설치 정책상 자동 교체되지 않으며, 사용자 수정본 보존·v2 업그레이드 관련 기존 테스트가 통과했다.

## 검증 결과

| 검증 | 결과 | 증거 |
| --- | --- | --- |
| 구현 전 실패 확인 | 확인 | 빈 신규 함수에서 연결 반환·초안 생성·로그·provision 분기 실패, 기존 main에서 환경변수 누락 실패, PTY 상속 환경 제거 실패 |
| 전체 테스트 | 통과: 87 파일, 885 테스트 | `.verify/assets-link-test.log` |
| 타입 검사 | 통과, 종료 코드 0 | `.verify/assets-link-typecheck.log` |
| 빌드 | 통과, 종료 코드 0 | `.verify/assets-link-build.log`, `out/` |
| diff 공백 검사 | 통과, 종료 코드 0 | `git diff --check` |
| 격리 앱 정상 연결 | 통과 | fixture argv의 add-dir 1회, env 대상 경로 일치 |
| 연결 해제 후 재시작 | 통과 | add-dir 없음, env 키 없음 |
| 에셋 레지스트리 제거 후 dev 시작 | 통과 | add-dir 없음, env 키 없음, start 성공 |
| 끊어진 id를 저장한 앱 재시작 | 통과 | 별도 재실행 결과의 danglingOnStartup 검증 |
| assets·manage 터미널 | 통과 | 둘 다 add-dir·env 없음 |
| 새로고침 후 연결 유지 | 통과 | 레지스트리 값과 UI 선택값 일치 |
| dev 기록 초안 생성 | 통과 | 실제 격리 프로젝트 파일 생성 및 본문 확인 |
| 기존 기록 보존·심볼릭 링크 거부 | 통과 | 단위 테스트, Windows junction 4종 포함 |
| 앱과 fixture 종료 | 통과 | 앱 종료 코드 0, 해당 실행의 기록된 PID 부재 확인 |
| 캡처 육안 확인 | 통과 | 아래 4장 직접 열어 확인 |

격리 앱 결과: `.verify/assets-link-runtime/result.json`, `.verify/assets-link-runtime/dangling-result.json`.
종료 확인: `.verify/assets-link-process-check.json`.
실행 로그: `.verify/assets-link-runtime.log`, `.verify/assets-link-dangling-runtime.log`.
fixture argv/env 원본은 해당 격리 프로필의 `fixture.jsonl`에 남겼다. 환경 전체나 비밀값은 기록하지 않았다.

캡처:

- `.verify/shots/assets-link-01-connected.png`: 개발 프로젝트의 ‘에셋 연결’ 선택값 확인.
- `.verify/shots/assets-link-02-disconnected.png`: 연결 해제 후 ‘링크 없음’ 확인.
- `.verify/shots/assets-link-03-deleted-target.png`: 에셋 목록 제거 후 ‘링크 없음’ 확인.
- `.verify/shots/assets-link-04-dangling-startup.png`: 끊어진 id가 저장된 상태의 앱 재시작에서 ‘링크 없음’ 확인.

## 한계와 미검증

- 실제 Claude/GPT CLI는 실행하지 않았다. 실제 PTY는 Electron의 Node 모드에서 가짜 Claude fixture를 실행했고, CLI 설치 확인도 fixture로 대체했다. 따라서 실제 Claude가 지침을 준수해 복사 지시서를 작성하는 행위는 미검증이다.
- 읽기 전용은 템플릿·스킬의 원본 수정 금지 규칙이다. `--add-dir`와 환경변수는 운영체제의 쓰기 권한을 제한하지 않는다.
- 심볼릭 링크는 쓰기 전 검사하며 파일 덮어쓰기는 wx로 방지한다. 외부 프로세스가 검사 직후 디렉터리를 교체하는 경쟁까지 운영체제 수준에서 봉쇄하는 구현은 아니다.
- 캡처는 연결 드롭다운과 앱 화면의 증거다. 인자·환경변수의 증거는 fixture 기록과 JSON 검증 결과다.
- 격리 실행 로그에 기존 CLI 확인 코드의 Node DEP0190 경고가 발생했다. 앱 검증과 종료는 성공했다.
- 실제 사용자 userData·사용자 프로젝트를 수정하지 않았다. 다른 사용자 프로세스는 종료하지 않았다. 기존 작업 변경을 유지했으며 이번 작업에서 `scripts/gpt.sh`는 수정하지 않았다. 커밋·푸시는 수행하지 않았다.
