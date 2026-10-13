# ESC 중단 상태 해제 조사·구현 보고서

- 수행일: 2026-10-13
- 작업 공간: `D:\클로드프로젝트\YAL_IDE`
- 결과: Claude 중단 transcript 감지 후 `working/attention → idle`, 새 프롬프트 제출 후 `working` 복귀. PTY 종료 및 명시적 닫기 상태 해제 구현.
- 최종 검증: `npm test` 81개 파일, 884개 테스트 통과·1개 건너뜀. 타입 검사·빌드 종료 코드 0. 격리 Electron 상태 검사 9개 통과.
- 커밋·푸시, 실제 Claude/Codex 실행, 외부 GPT CLI 재호출은 수행하지 않았다. 기존 사용자 IDE와 저장소 루트 `CLAUDE.md`를 수정·재시작·종료하지 않았다.

## 1. 원인과 근거

사용자 중단은 응답 완료나 세션 종료와 다르다. 기존 IDE는 프롬프트/도구 훅으로 working을 기록하고 Stop의 done 또는 SessionEnd의 idle을 기다렸다. 사용자 중단에는 Stop이 없고 Claude CLI/PTY는 입력 대기를 위해 살아 있으므로 이 경로로 working이 해제되지 않았다. 기존 Notification의 idle_prompt도 무시됐다.

공식 [Hooks reference — Stop](https://code.claude.com/docs/en/hooks#stop)는 사용자 중단 시 Stop이 실행되지 않는다고 명시한다. [SessionEnd](https://code.claude.com/docs/en/hooks#sessionend)는 세션 종료의 신호다. [Notification](https://code.claude.com/docs/en/hooks#notification)의 idle_prompt는 응답 종료 뒤 약 60초간 입력이 없고 백그라운드 작업이 없는 상황의 보조 신호다. [공통 입력 필드](https://code.claude.com/docs/en/hooks#common-input-fields)는 session_id, prompt_id, transcript_path와 transcript의 비동기 기록 지연을 설명한다.

| 로컬 근거 | 확인 내용 |
|---|---|
| `C:/Users/USER/AppData/Roaming/npm/node_modules/@anthropic-ai/claude-code/package.json` | 설치 버전 `2.1.296`, 실행 파일 `bin/claude.exe`. CLI 실행 없이 파일을 읽었다. |
| 같은 설치 경로의 `bin/claude.exe` | `[Request interrupted by user]` 바이트 위치 `106603598`, `[Request interrupted by user for tool use]` 위치 `107069556`. 전자는 중단된 API 메시지 식별자에 관한 내부 설명에도 등장한다. |
| `C:/Users/USER/.claude/projects/C--Users-USER-Desktop---/8bb87846-22fe-4e15-9a7e-e1f273bd5e9e.jsonl:103` | `2026-09-29T19:34:46.323Z`, `type: user`, 단독 text `[Request interrupted by user]`. promptId, interruptedMessageId, sessionId가 있는 실제 중단 기록이다. |
| `C:/Users/USER/.claude/projects/D----------YAL-IDE/f7a5abc9-0d72-4289-9a4e-b4757a4f8086.jsonl:550` 및 `:553` | 문구가 작업 지시와 설명에 인용된 assistant 기록이다. 단순 문자열 검색은 오탐한다. 구현은 이 항목을 제외한다. |
| `.verify/esc-evidence.json` | 설치·기록 근거의 필요한 필드만 저장했다. 전체 대화는 복사하지 않았다. |

이번 사용자가 ESC 두 번을 누른 원본 세션은 별도 식별되지 않았다. Stop 미발화의 의미는 공식 문서로, 실제 중단 기록 형식은 기존 세션과 설치본으로 확인했다. 실제 Claude를 사용하는 신규 AI 세션 실험은 수행하지 않았다.

## 2. 상태 흐름

| 단계 | 코드 근거와 동작 |
|---|---|
| 훅 설치·주입 | `src/main/hookSetup.ts:6`, `:43`은 UserPromptSubmit, Stop, Notification, PreToolUse, PostToolUse, SessionEnd를 설치한다. `src/main/index.ts:452`는 Claude에 `--settings`를 전달하고 envFor에서 프로젝트 ID와 상태 폴더를 구분한다. |
| 상태 기록 | `src/main/hook/yal-hook.cjs:45`부터 프롬프트와 도구 훅은 working, Stop은 done, SessionEnd는 idle, 승인 알림은 attention으로 매핑한다. `src/main/statusTracker.ts:14`, `:30`은 `{state, ts}`를 저장·조회한다. |
| 터미널 수명 | `src/main/terminalManager.ts:86`의 onExit와 `:117`의 kill. 기존 kill은 세션을 먼저 제거해 늦은 onExit를 무시했으므로 종료 정리 전달이 누락됐다. 자연 종료의 tracker.reset은 기존에도 있었으며, 정상 전달된 onExit 자체는 ESC 잔류 원인이 아니다. |
| GPT 로그 | `src/main/gptLogWatcher.ts`는 start/end 마커와 outstanding 작업을 별도로 추적한다. `src/main/index.ts:553`의 activity IPC는 Claude 상태와 GPT 실행 정보를 각각 반환한다. |
| StallMonitor | `src/main/index.ts:428`의 5초 주기와 `src/main/stallMonitor.ts:17`에서 활성 GPT가 있고 상태가 working/attention일 때만 감시한다. 기본 10분 무출력은 attention, 의심 표시와 알림을 만든다. Claude-only 무출력 감시가 아니다. |
| 렌더러 | `src/renderer/src/App.tsx:154`는 1초마다 조회한다. `src/renderer/src/activityState.ts:12`는 working 타임스탬프가 90초 넘게 갱신되지 않으면 quiet/응답 없음으로 표현할 뿐 상태를 해제하지 않는다. GPT 활성 여부·since는 별도 기준이다. |
| 알람 | `src/renderer/src/sound/notifyRules.ts:21`은 done에 3초 유예와 GPT 종료 조건을 적용한다. idle 전환은 완료음을 재생하지 않는다. attention 알람은 설정에 따른다. |

## 3. working 또는 attention 잔류 경로

| 경로 | 기존 상태와 이번 처리 |
|---|---|
| ESC로 모델 응답 중단 | Stop 없이 PTY가 살아 있어 working 잔류. 연결된 transcript의 중단 항목으로 idle 처리한다. |
| 도구/승인 대기 후 취소 | Stop/도구 완료가 없으면 working 또는 attention 잔류 가능. 도구 중단 marker 변형과 idle_prompt를 처리한다. 변형 문구는 설치본으로 확인하고 테스트로 검증했으며 실제 승인 취소 세션을 신규 실행하지는 않았다. |
| 중단된 도구의 늦은 Pre/Post/Stop/Notification | working/done/attention을 다시 만들 수 있음. interrupted 플래그, 세션·프롬프트 ID, 훅 실행 시작 시 턴, 도구 세대 검증으로 제외한다. |
| Claude 프로세스 비정상 종료 | 정상 onExit가 전달되면 기존에도 reset. 전달 누락·앱 재시작 후 남은 working/attention은 실행 중 PTY 존재 여부로 정리한다. |
| 명시적 kill·터미널 닫기 | 기존 늦은 onExit 무시로 정리 누락 가능. onClose로 정리하고 잠금 경합 실패는 pendingClaudeClosures로 재시도한다. |
| 앱 강제 종료·영속 상태 복구 | 다음 터미널 시작 전까지 잔류 가능. 새 앱의 1초 주기에서 PTY 없는 working/attention을 정리한다. |
| node/훅 설치 실패·설정 미주입·훅 오류·쓰기 실패 | 종료 신호가 저장되지 않을 수 있음. transcript 연결 정보와 idle 훅 모두 없고 PTY가 살아 있으면 확정적인 중단 판정은 불가능하다. PTY 종료 안전망은 적용된다. |
| API 오류 | 등록 이벤트에 StopFailure가 없어 이 이벤트로 끝나는 오류는 즉시 반영하지 못할 수 있다. idle_prompt 또는 PTY 종료의 조건부 안전망만 적용된다. API 오류 이벤트 추가는 이번 수정에 포함하지 않았다. |
| 승인/한도 대기·실제 프로세스 정지 | 살아 있는 PTY와 중단 기록 부재를 완료/중단으로 간주하지 않는다. GPT 활성 시 기존 StallMonitor의 attention 표시가 적용된다. |
| GPT start 이후 end 마커 부재 | Claude 상태와 별개의 GPT 작업 정보다. 이번 수정은 GPT outstanding, start/end 마커와 실제 작업을 종료하거나 삭제하지 않는다. |

## 4. 구현 산출물

- `src/main/claudeInterruptMonitor.ts`: 프롬프트 훅이 알려준 정확한 transcript를 1초마다 추적한다. 시작 offset/inode와 UTF-8 decoder로 분할 JSONL·파일 교체/축소/부재에 대응한다. 폴링당 256KiB로 제한한다. 같은 세션, 가능하면 같은 promptId, 프롬프트 이후 타임스탬프와 user의 단독 text 중단 marker만 허용한다. 인용·assistant·tool_result·sidechain은 제외하고 잠금 경합 시 신호를 보존해 재시도한다.
- `src/main/hook/yal-hook.cjs:148`: UserPromptSubmit에서 `.claude-session`에 sessionId, promptId, transcriptPath, 시작 offset/inode, promptAt, UUID 턴과 interrupted=false를 기록한다. 새 프롬프트는 정상 working으로 시작한다. idle_prompt는 working/attention만 idle로 해제하고 기존 done은 보존한다.
- 같은 훅 `:158`: 다른 세션/프롬프트, 실행 시작 뒤 턴이 바뀐 훅과 중단된 턴의 후속 훅을 제외한다. 새 프롬프트에서도 도구 세대를 증가시켜 식별되는 이전 PostToolUse를 배제한다.
- `src/main/statusTracker.ts:48`: 턴 확인, interrupted 기록과 working/attention 해제를 함께 처리한다. `:64`의 endClaude는 종료 상태를 정리하고 성공 여부를 반환한다.
- `src/main/statusLock.ts:3` 및 설치 훅의 대응 코드: 별도 훅 프로세스와 메인의 비교·메타데이터·상태 변경을 독점 파일 잠금으로 직렬화한다. 죽은 PID의 잠금을 복구한다. 복구는 별도 디렉터리에서 직렬화한 뒤 소유자를 다시 읽으며 복구 중 죽어 남은 디렉터리는 10초 임대로 회수한다.
- `src/main/terminalManager.ts:90`, `:127`: 자연 종료·kill 모두 onClose를 전달한다. 기존 늦은 세션 이벤트 무시와 onExit 계약을 유지한다.
- `src/main/index.ts:440`, `:479`: 종료 정리 재시도와 PTY 없는 working/attention 정리를 연결한다. 새 터미널 시작 시 이전 정리 요청을 해제하고 앱 종료 시 자체 타이머를 정리한다.
- `src/main/stallMonitor.ts:13`: 중단·종료 시 의심 플래그를 즉시 제거한다. GPT 실행 정보·로그에 쓰지 않는다.
- `tests/claudeInterrupt.test.ts`: 14개 사례. `tests/hookLogic.test.ts`: idle 알림과 transcript 연결 정보 테스트 2개 추가.
- `.verify/esc-interrupt-ui.cjs`: 가짜 CMD/Node 프로세스와 실제 설치 훅을 사용하는 격리 앱 검증. 가짜 CMD는 상대 경로로 Windows 한글 경로 인코딩 문제를 피한다.

## 5. 사용 신호와 한계

주 신호는 실제 transcript에 확인된 구조화된 중단 항목이다. PTY 출력 문자열은 인용·화면 재그리기와 구별하기 어려워 해제 근거로 쓰지 않았다. ESC 키 자체는 판정 근거가 아니다.

transcript 기록이 비동기이므로 폴링 1초와 렌더러 조회 주기만큼 표시가 늦을 수 있다. 큰 backlog는 256KiB씩 처리해 더 늦을 수 있다. 파일 접근 실패는 재시도한다. idle_prompt는 약 60초 후의 조건부 보조 신호이며 백그라운드 작업·한도 대기 등에 따라 생기지 않을 수 있다.

구형·누락 payload에 prompt_id가 없으면 UUID 턴과 도구 시퀀스로 보완한다. 같은 세션의 오래된 훅 프로세스 자체가 다음 프롬프트 이후 시작되고 프롬프트·도구 ID도 없으면 완전한 턴 구분은 불가능하다. 사용자가 marker와 완전히 같은 단독 user 메시지를 직접 제출한 기록도 marker 구조만으로 합성 중단과 구별할 수 없다. 실제 CLI 중단은 신규 실행하지 않았다.

## 6. 검증 결과·캡처

| 검사 | 최종 결과 | 로그 |
|---|---|---|
| `npm test` | 종료 코드 0. 81개 파일, 884개 통과·1개 건너뜀. 2026-10-13 10:27:27 실행. | `.verify/esc-tests.log` |
| `npm run typecheck` | 종료 코드 0 | `.verify/esc-typecheck.log` |
| `npm run build` | 종료 코드 0, `out/` 산출 | `.verify/esc-build.log` |
| `node .verify/esc-interrupt-ui.cjs` | 종료 코드 0, 9개 상태 검사 통과 | `.verify/esc-ui-results.json`, `.verify/esc-ui-app.log` |

회귀 검증은 중단/재시작, ESC 원시 입력·인용 오탐 제외, PTY exit/kill, StallMonitor 해제, GPT 로그 보존·완료음 없음, 다른 세션/턴·지연 도구 훅 제외, stdin을 지연한 Stop/Notification, 잠금 경합 재시도와 죽은 소유자 복구를 포함한다. 기존 코드에서 idle_prompt·메타데이터 부재, PTY 정리 누락, 잠금 경합 신호 소실과 이전 prompt_id 훅 덮어쓰기 실패를 확인한 뒤 수정했다.

최종 격리 앱은 프로필 `.verify/esc-profile-z8fccD`, 디버깅 포트 `52238`, 생성 PID `39588`을 사용했다. 사용자 프로필을 공유하지 않았고 가짜 Claude/Codex를 PATH 앞에 배치했다. 생성한 Electron 및 그 PTY만 종료했으며 해당 PID의 종료를 확인했다. 개발·기획·관리 전환, 원시 ESC만으로 working 유지, transcript 중단 idle, 새 프롬프트 working, idle_prompt fallback, SessionEnd 없는 exit=7과 PTY 없는 영속 working 정리를 확인했다.

| 캡처 | 확인 상태 |
|---|---|
| `.verify/shots/esc-01-working.png` | 개발 검증 프로젝트 working |
| `.verify/shots/esc-02-interrupted-idle.png` | 중단 기록 후 대기 중 |
| `.verify/shots/esc-03-restarted-working.png` | 새 프롬프트 후 working 복귀 |
| `.verify/shots/esc-04-pty-exit-idle.png` | PTY 비정상 종료 후 대기 중 |

캡처는 실제 격리 앱 화면이며 중단 후 한국어 대기 표시를 확인했다. 사용자 실행 중 IDE에는 이번 빌드를 재시작해 적용하지 않았다. 보고서 저장 중 발견한 한국어 인코딩 손실은 UTF-8 직접 저장으로 수정했다.
