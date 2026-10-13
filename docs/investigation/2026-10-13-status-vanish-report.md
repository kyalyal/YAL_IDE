# 상태 문구 소실 조사·수정 보고서

작성일: 2026-10-13

## 확인된 원인

1. 수정 전 `src/main/hook/yal-hook.cjs:56`은 Notification의 idle_prompt를 working/attention → idle로 처리했다. 같은 파일의 수정 전 164~167행은 세션 메타에 interrupted=true를 기록했다. 후속 훅은 interrupted 검사(현재 `src/main/hook/yal-hook.cjs:163`)에서 반환하므로 PreToolUse/PostToolUse/Stop이 차단됐다. GPT start만 있는 로그와 실제 훅을 사용하는 테스트로 재현했다.
2. 수정 전 `src/renderer/src/activityState.ts:8`은 gptRunning과 working/done의 조합만 waiting-gpt로 파생했다. `src/renderer/src/App.tsx:174`의 handleSelect는 done 클릭 시 idle로 확인 처리하므로 GPT 실행 정보가 남아 있어도 문구가 사라졌다.
3. 수정 전 `src/renderer/src/components/ProjectList.tsx:230`은 idle 라벨을 빈 문자열로 만들고 span 렌더링도 생략했다. 헤더는 같은 idle 상태를 표시해 목록과 일관되지 않았다.
4. 수정 전 App의 폴링 경합 보호는 확인 처리 후 도착한 결과에서 해당 프로젝트 activity 전체를 기존 값으로 대체했다. 그 결과 새 gptRunning/gptSince도 버려졌다. 현재 `src/renderer/src/App.tsx:148`은 확인 처리와 경합한 done 상태만 보호하고 GPT 필드는 수신값을 반영한다.

## 적용 내용과 변경 파일

- `src/main/hook/yal-hook.cjs`: idle_prompt는 상태·세션 메타를 변경하지 않는다. 실제 중단의 interrupted 차단은 유지한다. 약 60초 보조 해제 방식은 사용하지 않았다.
- `src/renderer/src/activityState.ts`: idle/working/done에서 gptRunning이면 waiting-gpt로 표시하며 gptSince를 경과 시간 기준으로 사용한다. attention → needs-input의 기존 우선순위는 유지한다.
- `src/renderer/src/App.tsx`: 확인 처리 중 들어온 폴링 결과의 GPT 필드를 즉시 적용한다. stale done만 보호하고 새 working/attention 상태는 반영한다.
- `src/renderer/src/components/ProjectList.tsx`: idle을 포함한 모든 파생 상태에 activityLabel을 표시한다.
- `src/renderer/src/styles.css:65`: idle 라벨에 흐린 글자색을 적용한다.
- `src/shared/i18n.ts:67`: 한국어 waiting-gpt는 `GPT 작업중`, idle은 기존 키로 `대기중`을 표시한다. 영어는 `GPT working`, `Idle`을 표시한다.
- `tests/activityState.test.ts`: GPT가 실행 중인 idle 표시·경과 시간과 ko/en 전체 상태 라벨을 검증한다.
- `tests/hookLogic.test.ts`: idle_prompt의 상태 해제 기대값을 무변경으로 갱신했다.
- `tests/claudeInterrupt.test.ts`: GPT 진행 중 idle_prompt 후 세션 메타 보존, 후속 Pre/Post/Stop 허용, 이후 실제 transcript 중단 복원을 검증한다.
- `tests/rendererActivity.test.ts`: 새 표시 문구와 GPT 진행 중 확인 처리의 기대값을 갱신했다. 기존 완료 알림 지연·단일 재생 검증은 유지했다.
- `tests/statusPersistence.test.ts`: 실제 App/ProjectList를 사용해 프로젝트 전환·복귀, done 확인 처리, 폴링 경합, 새로고침 재마운트 및 모든 파생 라벨을 검증한다.

ESC 복원은 기존 `src/main/claudeInterruptMonitor.ts:52`의 transcript 중단 레코드와 `src/main/statusTracker.ts:48`의 interrupt를 사용한다. PTY 종료 정리는 `src/main/index.ts:484`와 `src/main/statusTracker.ts:64`의 기존 경로를 유지했다.

완료 알림은 `src/renderer/src/sound/notifyRules.ts`의 원래 status/gptRunning 기준으로 유지했다. 표시용 파생 상태를 알림 상태로 사용하지 않는다. 확인 처리로 pending을 취소하고, GPT 종료 후 3초 유예와 동일 완료 에피소드의 단일 재생을 기존·추가 테스트에서 확인했다.

새로고침은 App의 활동·선택·알림 sessionStorage 복원(`src/renderer/src/App.tsx:65`)과 독립적인 전체 프로젝트 폴링(`src/main/index.ts:595`)을 이용한다. 새로고침 구현 자체를 변경할 필요는 없었으며 앞선 새로고침·로그 시각 작업을 보존했다.

## 검증 결과

| 검증 | 결과 | 확인 내용 |
| --- | --- | --- |
| 수정 전 회귀 테스트 | 실패 재현 | 4개 파일에서 7개 실패로 idle_prompt 중단 오판, idle GPT 표시 소실, 목록 라벨 소실 재현 |
| 관련 회귀 테스트 | 통과 | 4개 파일, 51개 테스트 |
| `npm test` | 통과 | 84개 파일, 906개 통과, 1개 건너뜀, 실패 0 |
| `npm run typecheck` | 통과 | 종료 코드 0 |
| `npm run build` | 통과 | main/preload/renderer 모두 빌드, 종료 코드 0, out/ 산출물 생성 |
| `git diff --check` | 통과 | 공백 오류 없음. 기존 scripts/gpt.sh의 CRLF→LF 경고 존재 |
| 실제 앱 검증 | 통과 | 별도 userData, 가짜 Claude PTY, GPT start 마커, 원격 디버깅 포트 9359 |
| idle_prompt 주입 | 통과 | 설치된 훅 실행 후 working 상태와 세션 메타 유지, 목록·헤더 GPT 작업중 유지 |
| 후속 훅 | 통과 | PreToolUse/PostToolUse/Stop 수신, done 상태에서 GPT 작업중 유지 |
| 프로젝트 전환·복귀 | 통과 | 다른 프로젝트 선택 후 복귀하여 done→idle 확인 처리 후에도 waiting-gpt 유지, gptSince 동일 |
| 같은 프로젝트 새로고침 | 통과 | idle+gptRunning 표시와 경과 시간 기준 복원, PTY PID 목록 동일 |
| idle 라벨 | 통과 | 목록과 헤더의 대기중 표시, 캡처에서 흐린 목록 라벨 확인 |
| GPT end 폴링 | 통과 | 다음 성공 폴링에서 gptRunning=false와 목록·헤더 대기중 반영 |
| 프로세스 정리 | 통과 | 검증 가짜 PTY를 먼저 종료한 뒤 앱 종료 코드 0, 잔여 가짜 PTY PID 없음 |
| 실제 Claude/GPT 서비스 세션 | 미검증 | 외부 수행자 호출 없이 가짜 PTY·로그·transcript로 검증 |

건너뛴 테스트는 `tests/planningSync.test.ts`의 `scan > skips file symlinks`이며 Windows 파일 심볼릭 링크 생성 권한이 없어 기존 조건에 따라 건너뛰었다. 해당 파일을 별도로 실행해 38개 통과, 1개 건너뜀과 사유를 확인했다.

## 산출물

- 이 보고서: `docs/investigation/2026-10-13-status-vanish-report.md`
- 재현 가능한 앱 검증: `.verify/status-verify.mjs`, `.verify/status-runtime.cjs`, `.verify/status-fake-claude.cjs`
- 실행 결과: `.verify/status-runtime/result.json`
- 시작 상태와 idle 라벨: `.verify/shots/status-01-gpt-start-and-idle.png`
- idle_prompt 이후: `.verify/shots/status-02-after-idle-prompt.png`
- 프로젝트 복귀 이후: `.verify/shots/status-03-after-switch-back.png`
- 새로고침 이후: `.verify/shots/status-04-after-refresh.png`
- GPT 종료 이후: `.verify/shots/status-05-after-gpt-end.png`

## 남은 한계·관찰 사항

- GPT 실행 여부는 기존 로그 마커·mtime 추론을 사용한다. `src/main/gptLogWatcher.ts:58`의 30분 무갱신 만료 정책과 기존 stall attention 정책은 변경하지 않았다. 무출력 장시간 작업의 표시 정책은 이 검증 범위에 포함하지 않았다.
- attention은 GPT 실행 중에도 입력 필요로 우선 표시한다. idle/working/done에서의 GPT 진행 표시 소실을 수정했다.
- 과거 idle_prompt로 이미 interrupted=true가 저장된 메타를 자동으로 해제하지 않는다. 실제 ESC 중단 메타와 구분할 근거가 없으며, 새 UserPromptSubmit에서 새 turn과 interrupted=false가 기록되는 기존 복원 경로를 유지했다.
- 초기 검증 스크립트는 문자 인코딩·마커 개행 fixture 오류로 타임아웃했다. 검증 스크립트를 교정한 최종 실행은 모든 시나리오를 통과했다.
- 가짜 PTY를 살려 둔 채 앱을 닫은 중간 실행에서 node-pty AttachConsole 오류와 앱 비정상 종료를 관찰했다. 최종 실행은 가짜 PTY에 정상 종료 입력을 전달하고 종료를 확인한 뒤 앱을 닫아 종료 코드 0을 확인했다. node-pty의 강제 종료 문제는 이번 상태 표시 수정 범위에서 변경하지 않았다.
- 최종 실행 stderr에는 기존 CLI 환경 확인 경로의 Node DEP0190 경고가 남았다. 외부 Claude/Codex 프로세스를 실행하지 않도록 검증 fixture에서 해당 호출을 대체했다.
- 커밋·푸시는 수행하지 않았다. 다른 사용자 codex/node 프로세스를 종료하지 않았다.