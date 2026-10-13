# 새로고침 및 GPT 문단 시각 구현 결과

작성일: 2026-10-13

## 구현 결과

- GPT 출력은 빈 줄로 구분되는 문단의 첫 줄 직전에 `=== [YAL-GPT] t <로컬 ISO8601 시각+오프셋> ===` 마커를 기록한다. Bash 내장 시각 포맷을 사용하며, 줄별 스트리밍과 마지막 개행 없는 출력도 처리한다.
- 기존 stdin 닫기, 종료코드 전달, `--approve-for-me`, 워커 재호출 가드, 로그 없는 실행 동작을 유지했다.
- 파서는 문자열 `lines`를 유지하면서 별도 시각 배열을 구성한다. 화면에는 고정폭의 흐린 `HH:MM:SS`, 복사에는 `[HH:MM:SS] `를 표시한다. 문단 중간 줄은 같은 폭으로 들여쓴다. 마커 자체는 화면 및 복사에서 제외한다.
- 마커 없는 과거 로그는 시각을 생성하지 않는다. 작업 시작 마커가 잘린 tail도 시각 마커를 숨기고 출력 및 복사 내용을 유지한다.
- 직전 생성 스크립트를 알려진 이전 버전에 등록했다. 기존 해시/내용 비교 기반 프로비저닝으로 자동 업그레이드하며, 사용자 수정본의 `gptCustomized` 안내 흐름은 유지한다.
- 상단 새로고침 버튼과 Ctrl+Shift+R은 메인·설정·스킬 BrowserWindow를 `reloadIgnoringCache()`로 다시 로드한다. 뷰어 WebContentsView는 순회하지 않는다. 재시작 버튼은 추가하지 않았다.
- 선택 프로젝트와 공간, 실행 터미널 표시, 작업 상태, 알림 메모리와 대기 목록, 뷰어 접힘은 sessionStorage에 보존한다. GPT 로그 높이·접힘과 기존 너비 설정의 localStorage 저장을 유지한다.
- 복원 중 프로젝트 목록이 도착하기 전에 뷰어를 숨기지 않는다. 초기 뷰어 배치 및 복원된 상태에 따른 위치 변경은 즉시 전송하고, ResizeObserver 및 외부 레이아웃 이벤트는 프레임 단위로 병합한다.
- 빌드 감지는 산출물 하위 파일의 최신 mtime을 1초마다 관찰하며, 동일한 두 번의 관찰 후 상태를 알린다. 렌더러·프리로드는 마지막 적용 기준, 메인은 프로세스 시작 기준으로 비교한다. 패키지 및 devUrl 모드에서는 빌드 감지를 끈다.
- 한국어·영어 UI 문구, IPC 상수, preload API 및 Window 타입을 추가했다.

## 수정·추가 파일

| 영역 | 파일 |
| --- | --- |
| GPT 실행·업그레이드 | `scripts/gpt.sh`, `src/main/templates.ts` |
| 메인 새로고침·감지 | `src/main/appReload.ts`, `src/main/index.ts` |
| 공유 타입·번역·파서 | `src/shared/appReload.ts`, `src/shared/gptLog.ts`, `src/shared/gptLogParser.ts`, `src/shared/i18n.ts` |
| preload | `src/preload/index.ts`, `src/renderer/src/env.d.ts` |
| 렌더러 상태 | `src/renderer/src/App.tsx`, `src/renderer/src/reloadSession.ts`, `src/renderer/src/gptLogState.ts` |
| 렌더러 UI | `src/renderer/src/components/ReloadControls.tsx`, `src/renderer/src/components/GptLogPane.tsx`, `src/renderer/src/components/ViewerPane.tsx`, `src/renderer/src/styles.css` |
| 테스트 | `tests/reloadAndTimestamps.test.ts`, `tests/rendererReload.test.ts`, `tests/gptScript.test.ts`, `tests/viewerPaneBounds.test.ts` |

## 검증 결과

| 검증 | 결과 |
| --- | --- |
| `npm test` | 통과: 83개 파일, 895개 테스트 통과, 1개 건너뜀, 실패 0 |
| `npm run typecheck` | 통과: 종료코드 0 |
| `npm run build` | 통과: 메인·preload·렌더러 산출물 생성, 종료코드 0 |
| `git diff --check` | 통과: 공백 오류 없음 |
| 파서·표시·복사 | 새 마커, 과거 로그, orphan tail, 빈 줄, 표시 행 제한의 시각 정렬 확인 |
| 셸 필터 | EOF 전 출력 수신, 문단당 마커 1개, 마지막 개행 없는 줄 처리 확인. 필터만 실행하는 추가 테스트에서는 AI CLI를 호출하지 않음 |
| 업그레이드 | 모든 알려진 이전 생성본 업그레이드, CRLF 정규화, 멱등성, 사용자 수정본 보존 확인 |
| 새로고침 범위 | 파괴된 창 제외와 뷰어 비순회 단위 테스트 통과. 실제 설정·스킬 창의 JS 상태 초기화 확인 |
| 실제 PTY | 동일 PID 및 생성 횟수 1회 유지. 최초 출력이 포함된 buffer 응답과 새로고침 후 화면 복원 확인 |
| 상태 복원 | 선택 프로젝트, 높이 237.2px, 로그 및 뷰어 접힘, `working` 상태 유지 확인 |
| Ctrl+Shift+R | 실제 Electron 입력 이벤트로 전체 창 새로고침 및 접힘 복원 확인 |
| 실행 중 새 빌드 | 렌더러·preload 소스를 일시 변경하여 빌드. 새 빌드 배지 표시, 새로고침 후 두 변경 반영 및 배지 해제 확인 |
| 메인 변경 | 빌드 및 `out/main` mtime 변경으로 재시작 경고 확인. 새로고침 이후에도 경고 유지 |
| 뷰어 | 동일 WebContents 및 페이지 load ID 유지. 배치 좌표와 stage 일치 확인 |
| GPT 시각 | 파일에 기록한 14:03:22 및 14:03:25의 두 문단 표시, 중간 줄 들여쓰기, 새로고침 후 재표시 확인 |
| 프로세스 종료 | 검증 앱 종료코드 0. 생성한 PTY 및 뷰어 fixture 프로세스 잔존 없음 |

실제 앱 검증은 격리 프로필, 실제 node-pty, 가짜 Claude 프로세스와 검증용 로컬 뷰어 fixture를 사용했다. IDE용 Vite 개발 서버는 실행하지 않았다. 실제 GPT/Claude 세션 신규 실행, 커밋, 푸시는 수행하지 않았다. 검증 중 추가한 렌더러 meta 및 preload 표식은 복원했고, 복원된 소스로 최종 `out/`을 다시 빌드했다.

최종 PTY PID: 36424. 뷰어 배치 전후: x=899, y=122, width=199, height=432. 해당 stage: x=733, y=122, width=531, height=432.

## 검증 산출물

- 실행 스크립트: `.verify/reload-verify.mjs`, `.verify/reload-runtime.cjs`, `.verify/reload-fake-claude.cjs`, `.verify/reload-viewer-fixture.cjs`, `.verify/reload-checks.cjs`
- 실제 앱 결과: `.verify/reload-runtime/result.json`
- 명령 결과: `.verify/reload-runtime/checks.json`, `final-tests.log`, `final-typecheck.log`, `final-build.log`
- 캡처: `.verify/shots/reload-before.png`, `reload-after.png`, `reload-collapsed.png`, `reload-new-build.png`, `reload-applied-main-warning.png`, `gptlog-time-paragraphs.png`, `gptlog-time-after-reload.png`
- 캡처를 직접 열어 문단 시각·들여쓰기, terminal buffer, 새 빌드 배지 및 재시작 경고를 확인했다.

## 한계 및 미검증

메인 프로세스의 코드는 렌더러 새로고침으로 교체되지 않는다. 메인 변경을 적용하려면 앱을 재시작해야 한다. PTY 및 뷰어 서버의 소유자와 정리 로직이 메인에 있으므로 앱 종료 시 세션과 자식 프로세스가 정리되어 진행 중인 터미널 작업이 끊긴다. UI에 이 사실을 경고 문구로 표시한다. 이 새로고침 기능 자체를 처음 설치하는 기존 실행 앱에는 한 번의 재시작이 필요하다.

마커 없는 과거 로그의 문단 시작 시각은 복원할 수 없다. 사용자 수정 스크립트는 자동 덮어쓰기하지 않는다.

실제 GPT/Claude 세션, 패키징된 앱 및 devUrl 실행, 새로고침 중 소리 알림의 실시간 재생은 미검증이다. 실제 앱 검증에서는 소리를 껐고, 알림 로직은 기존 단위 테스트와 상태 저장 구현으로 확인했다. 테스트 1개는 기존 환경 조건에 의해 건너뛰었다.
