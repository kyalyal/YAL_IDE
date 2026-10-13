# 2026-10-13 YAL_IDE 정리 결과

## 변경 결과

- GPT 직접 작업 입력창·실행 버튼·상태 폴링을 제거했다. 작업 지시 경로는 Claude 터미널에서 디렉터가 `scripts/gpt.sh`를 사용하는 경로로 남았다.
- 프로젝트 권한을 설정 창으로 옮겼다. 기존 프로젝트별 저장·병합과 Claude PTY의 `YAL_PERMISSION` 전달을 유지했다. 새 터미널부터 적용되며 읽기 전용은 지시 규칙이라는 문구를 표시한다.
- 화면 안내는 “Claude가 대화하며 지시하고 GPT가 수행합니다”로 정리했다. 관리 공간의 IDE 수정·빌드·재시작 안내는 유지했다.
- 외부 CLI 재호출 금지와 내부 서브에이전트·병렬 워커 허용을 생성 규칙, 루트 AGENTS, MASTER와 내장 협업 스킬에 반영했다. 내장 협업 스킬 버전은 3이다.
- 기본 10분 출력 공백 감시, 설정값, attention 알람·로그·화면 안내 및 출력 재개 시 working 복귀를 구현했다. 자동 종료는 없다.
- 긴 GPT 지시서의 임시 UTF-8 파일 전달, 실제 Codex stdin EOF, 스텁 반복 실행 하네스 및 종료된 PTY 중복 kill 방지를 구현했다.

## 이번 작업에서 변경한 파일

| 영역 | 파일 |
| --- | --- |
| 규칙·실행 | `AGENTS.md`, `scripts/gpt.sh`, `src/main/taskRules.ts`, `src/main/templates.ts`, `src/main/provisioner.ts`, `src/main/master/MASTER.md`, `src/main/skills/builtin/yal-collaboration.md`, `src/main/skillsSetup.ts` |
| 상태·권한·연결 | `src/main/index.ts`, `src/main/gptLogWatcher.ts`, `src/main/gptSessionActivity.ts`(신규), `src/main/stallMonitor.ts`(신규), `src/main/settingsStore.ts`, `src/main/terminalManager.ts`, `src/shared/settings.ts`, `src/shared/types.ts`, `src/preload/index.ts` |
| 화면 | `src/renderer/src/App.tsx`, `src/renderer/src/components/SettingsWindow.tsx`, `src/renderer/src/styles.css` |
| 하네스 | `scripts/stall-check.cjs`(신규) |
| 검증 | `tests/gptScript.test.ts`, `tests/gptLog.test.ts`, `tests/gptLogMain.test.ts`, `tests/exportMain.test.ts`, `tests/projectMain.test.ts`, `tests/provisioner.test.ts`, `tests/settingsStore.test.ts`, `tests/terminalManager.test.ts`, `tests/skillsRuntime.test.ts`, `tests/rendererManagement.test.ts`, `tests/rendererPermissions.test.ts`(신규), `tests/gptSessionActivity.test.ts`(신규), `tests/stallMonitor.test.ts`(신규), `tests/stallHarness.test.ts`(신규) |

작업 시작 시 이미 여러 파일이 수정·미추적 상태였다. 전체 git diff에는 이전 작업 변경이 함께 포함되므로 위 목록은 이번 수행에서 수정한 파일만 나타낸다. 루트 `CLAUDE.md`는 수정하지 않았다. 캡처 시작·종료 및 최종 검사에서 SHA-256은 `ebb7a92911cf24dbaec746e575fc987fc62ca299fe56c29c3325e182b1ea3380`이었다. 커밋·푸시와 에이전트 위임은 수행하지 않았다.

## 제거 내역과 보존

제거 파일: `src/renderer/src/components/TaskPanel.tsx`, `src/main/taskRunner.ts`, `src/main/taskProcess.ts`, `src/main/workerEnvironment.ts`, `tests/rendererTaskPanel.test.ts`, `tests/taskRunner.test.ts`, `tests/taskProcess.test.ts`, `tests/workerEnvironment.test.ts`.

`task:run`/`task:status` IPC, preload API, 공유 타입, App 연결, 전용 CSS, main의 직접 실행·저장·취소 경로와 관련 mock을 제거했다. 활성 코드·테스트·스크립트에서 직접 실행 잔재 문구·API 검색 결과는 0건이다.

`taskRules.ts`는 관리 MASTER와 생성 AGENTS의 공통 수행자 규칙으로 사용하므로 보존했다. `atomicWrite`, 관리 공간, 상태 훅, GPT 로그 시작·종료 마커와 로그 회전은 보존했다. 사용되지 않는 Node worker 환경 모듈은 제거했으나 실제 `gpt.sh`의 환경 가드·PATH shim은 유지했다. 알려진 과거 생성 스크립트와 직전 워커 스크립트는 전체 일치 또는 SHA-256 일치로만 갱신하고 사용자 수정본은 유지한다. `tests/fixtures/rejected-gpt-script.txt`의 과거 금지 문구는 실행하지 않는 정확 일치 갱신 fixture의 원문으로 보존했다.

## 가드 범위

`YAL_GPT_WORKER=1`이면 `gpt.sh`는 지시서 읽기와 CLI 해석 전에 종료한다. 승인된 디렉터 실행은 PATH 변경 전에 codex 위치를 확보하고 워커용 `codex`, `claude`, `gpt.sh` 및 Windows `.cmd`/`.ps1` shim을 PATH 앞에 붙인다.

이 가드는 셸이 이름으로 해석하는 외부 실행 파일에만 작용한다. Codex 내부 서브에이전트 API·병렬 워커는 셸 PATH에서 이 이름을 찾지 않으므로 차단되지 않는다. 내부 워커의 외부 CLI 재호출 금지 규칙은 동일하다.

shim은 보안 샌드박스가 아니다. 절대 경로, 다른 실행 이름·확장자, 별도의 PATH/환경 변경, 패키지 entrypoint 직접 실행은 이름 기반 가드 범위 밖이다. 재호출 금지 규칙과 실행 플랫폼의 승인 정책이 함께 필요하며 이 가드는 승인 정책을 우회하지 않는다. 기존 사용자 커스텀 규칙·스크립트는 자동으로 덮어쓰지 않는다.

## 멈춤 분석 요약

세션 273개, 앱 GPT 로그, `.verify` 로그와 스크립트 변경 내역을 읽었다. 실제 오류로 외부 `gpt.sh` 자동 승인 거부, 읽기 전용 쓰기 거부, Windows 명령줄 `os error 206`, 종료 대상 불일치 거부, 도구 정책 차단, GPT 네트워크 재연결을 확인했다. stdin 읽기 문구가 있는 과거 무해 작업은 8초 뒤 정상 종료했으므로 이 문구 자체를 장애로 판정하지 않았다.

ConPTY 정리 오류는 이번 첫 검증에서 관찰했다. 종료된 PTY 재종료를 막고 fixture를 자연 종료한 최종 앱은 종료 코드 0이었다. 자동 승인 서비스의 장시간 대기나 과거 orphan 잔류는 확정하지 못했다. 상세 증거·조치·남은 위험과 실제 하네스 사용법은 `docs/investigation/2026-10-13-stall-analysis.md`에 기록했다.

## 최종 검증 결과

| 검증 | 결과 | 증거 |
| --- | --- | --- |
| `npm test` | 종료 코드 0, 79개 파일 통과, 861개 테스트 통과, 1개 건너뜀 | `.verify/cleanup-test.log` |
| `npm run typecheck` | 종료 코드 0 | `.verify/cleanup-typecheck.log` |
| `npm run build` | 종료 코드 0, `out/main`, `out/preload`, `out/renderer` 생성 | `.verify/cleanup-build.log` |
| `git diff --check` | 종료 코드 0 | 실행 출력 확인 |
| 기본 스텁 하네스 | 5회 모두 종료 코드 0, stdin EOF, 60초 공백 없음 | `.verify/stall-check.json`, `.verify/cleanup-stall-harness.log` |
| 격리 앱/CDP | 세 공간 입력창 제거·API 제거, PTY 권한, 설정 위치, 멈춤 알람·복귀 검증 통과 | `.verify/cleanup-ui-results.json` |
| 검증 앱 종료 | Electron 종료 코드 0, 별도 강제 종료 없음, fixture node 잔류 0개 | `.verify/cleanup-process-exit.json`, `.verify/cleanup-owned-processes.json` |

건너뛴 테스트는 `tests/planningSync.test.ts`의 `skips file symlinks`이다. Windows 파일 symlink 생성 권한 부재(EPERM)에 따른 기존 조건부 skip이며 directory junction 검증은 실행됐다.

기본 하네스 회차 결과:

| 회차 | 소요 ms | 종료 코드 | 60초 공백 발생 |
| --- | --- | --- | --- |
| 1 | 1190 | 0 | False |
| 2 | 1167 | 0 | False |
| 3 | 1188 | 0 | False |
| 4 | 1174 | 0 | False |
| 5 | 1221 | 0 | False |

## 앱 실행·캡처 산출물

검증 앱은 `--remote-debugging-port`와 별도 `--user-data-dir`로 실행했다. CLI 이름은 검증 프로필의 로컬 스텁으로만 해석했다. 실제 Codex/Claude 세션이나 `scripts/gpt.sh`의 실제 AI 실행은 하지 않았다. 기획 PTY는 `read-only`, 개발·관리 PTY는 `workspace-write` 전달을 출력으로 확인했다. 캡처 이미지를 직접 열어 입력창 제거와 권한 위치를 확인했다.

- `.verify/shots/cleanup-planning.png`
- `.verify/shots/cleanup-dev.png`
- `.verify/shots/cleanup-manage.png`
- `.verify/shots/cleanup-settings.png`
- `.verify/shots/cleanup-stall-attention.png`

실행·검증 스크립트는 `.verify/cleanup-capture.cjs`, 실행 PID·포트·프로필은 `.verify/cleanup-process.json`, 앱 로그는 `.verify/cleanup-electron.log`에 저장했다. 최종 앱의 모든 기록된 UI 검사 결과는 true이다.

## 남은 한계

실제 반복 실행은 워커 밖 디렉터가 실행하는 하네스로 남아 있다. 스텁 검증은 CLI 전송·EOF·마커·반복 기록과 UI 연결을 검증하며 실제 모델의 지연·승인·네트워크 안정성을 보장하지 않는다. OS 알림 표시는 운영체제의 알림 설정에 따르며 화면 안내·로그 마커는 별도로 남는다.

현재 열린 Claude 터미널은 기존 권한 환경을 유지한다. 변경 권한은 새 터미널부터 적용된다. 읽기 전용은 지시 규칙이며 파일 접근 강제 제한은 실행 플랫폼에 따른다. 세션 파일 경로가 비표준이거나 세션 ID가 없으면 로그만 감시한다. 긴 계산도 출력이 없으면 경고할 수 있으며 자동 종료하지 않는다.

살아 있는 Windows ConPTY를 강제 종료할 때 외부 `node-pty`의 비동기 콘솔 목록 경합은 남아 있다. 기존 GPT 로그 뷰의 30분 배지와 새 감시의 기본 10분 알람은 별도 동작이다. 이전 커스텀 MASTER·AGENTS·스킬·gpt.sh와 수정 금지된 루트 CLAUDE 규칙은 자동 변경하지 않았다.

## 지시서 재대조 및 최종 재검증 (2026-10-13 08:52 KST)

이번 실행 시작 시 위 기능 구현·분석 보고서·캡처가 작업 트리에 이미 존재했다. 전체 지시서를 다시 읽고 구현과 산출물을 대조했다. 삭제된 TaskPanel을 참조하는 mock이 `tests/rendererActivity.test.ts`, `tests/rendererPlanningSync.test.ts`, `tests/rendererProjects.test.ts`, `tests/rendererSidebar.test.ts`에 남아 있어 4개를 제거했다. 활성 코드·스크립트·테스트·루트 AGENTS에서 TaskPanel/taskRunner/taskProcess와 직접 실행 잔재 문구 검색 결과는 0건이다.

- `npm test`: 종료 코드 0, 79개 파일, 861개 통과, 1개 기존 조건부 skip. `.verify/cleanup-recheck-test.log`.
- `npm run typecheck`: 종료 코드 0. `.verify/cleanup-recheck-typecheck.log`. PowerShell의 stderr 래핑으로 npm notice에 NativeCommandError 표기가 있으나 tsc 오류는 없고 프로세스 종료 코드는 0이다.
- `npm run build`: 종료 코드 0, out 산출물 갱신. `.verify/cleanup-recheck-build.log`.
- `git diff --check`: 종료 코드 0. CRLF/LF 변환 안내만 표시됐다.
- 스텁 하네스: 5회 종료 코드 0, stdin EOF, 60초 출력 공백 없음. `.verify/stall-check.json`, `.verify/cleanup-recheck-stall-harness.log`. 위 회차 표를 이번 결과로 갱신했다.
- 격리 앱 재실행: `.verify/cleanup-ui-results.json`의 17개 검사 모두 true. 캡처 5장 갱신 후 개발 화면과 설정 화면을 직접 열어 확인했다. `.verify/cleanup-process-exit.json`의 앱 PID 1312는 종료 코드 0, 강제 종료 없음이다.
- 기존 선별 증거 6개를 원본 세션 JSONL의 해당 줄과 앱 로그에서 재대조했다. 읽기 전용 거부, os error 206, 종료 대상 불일치 거부, 외부 gpt.sh 자동 승인 거부, 도구 정책 차단, 네트워크 재연결 원문이 모두 확인됐다.
- 루트 CLAUDE.md SHA-256은 기존 보고서와 동일하다. 커밋·푸시·위임·실제 AI CLI 실행은 하지 않았다.