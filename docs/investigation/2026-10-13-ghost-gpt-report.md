# 유령 GPT 실행 판정 수정 결과

작업 범위: `2026-10-13-assets-space-merge-planning.md`의 Task 0. 기존 새로고침·문단 시각·상태 표시 변경을 유지했다. 커밋·푸시는 수행하지 않았다.

## 원인

- 수정 전 `scripts/gpt.sh:74`, `scripts/gpt.sh:88`의 출력 필터와 tee 경로는 GPT가 출력한 마커 모양 줄을 원문 그대로 기록했다. 스크립트의 실제 start/end와 검증용 출력이 같은 형식이었다.
- 수정 전 `src/main/gptLogWatcher.ts:86`, `:93`, `:96`은 id 없는 줄의 형식만 확인하고 시작을 배열에 추가하거나 종료 시 가장 오래된 시작 하나를 제거했다. 검증 출력의 가짜 start가 추가되면 실제 실행 종료 후에도 미종료 항목이 남았다.
- 수정 전 `src/main/gptLogWatcher.ts:64`는 로그 mtime 이후 30분까지 실행으로 판정했고, `:68`의 activity는 시간 제한 없이 배열 길이만 확인했다. UI와 stall 입력도 같은 실행 판정을 사용하지 않았다.
- `src/renderer/src/sound/notifyRules.ts:40`은 `gptRunning`이 참이면 완료 알림 유예를 초기화한다. 유령 실행 값이 알림을 보류시켰다. 알림 규칙 자체는 유지했다.
- 실제 관리 로그 끝부분 511,998바이트를 `.verify/ghost-fixture.log`로 복사했다. 사본에는 마커 줄 기준 start 2개, end 1개가 있었다. 원본은 읽기만 했으며 사본은 Git 제외 대상이다. 지시서에 기재된 전체 로그 start 48개/end 38개 수치는 이 사본의 집계와 별개다.

## 변경 파일과 동작

| 파일 | 변경 내용 |
|---|---|
| `scripts/gpt.sh:28` | OS 난수 16바이트로 32자리 소문자 hex run id 생성. 상속된 동일 이름 변수를 unset하여 export 속성 제거. start/order/end에 같은 id 기록. |
| `scripts/gpt.sh:87` | 하위 프로세스 출력 중 `[YAL-GPT]`를 포함한 줄 앞에 `> `를 붙여 제어 마커와 구분. id 없는 에코와 모르는 유효 hex id 에코 모두 일반 출력으로 보존. |
| `src/main/templates.ts:190`, `:288` | 직전 문단 시각 버전을 알려진 이전 생성본으로 보존. 최신 템플릿은 저장소 스크립트를 raw import하여 사본과 실행기 일치. 기존 이전 버전·정확한 해시 업그레이드와 customized 안내 유지. |
| `src/main/gptLogWatcher.ts:63`, `:90` | 실행 중 항목을 run id Map으로 관리. 중복 start는 1회, end는 같은 id만 제거. 최근 종료 id 256개 기억. end만 먼저 관측한 id도 재출력 start로 살아나지 않음. |
| `src/main/gptLogWatcher.ts:101` | 신형 start/end/order를 관측하면 구형 시작 항목을 비우고 이후 id 없는 시작·종료는 실행 계산에서 제외. 구형 전용 로그는 기존 순서 짝 규칙과 기본 5분 무출력 제한 유지. `legacyIdleMs`로 변경 가능. |
| `src/main/gptLogWatcher.ts:73`, `:78`, `:222` | running/activity/since가 같은 판정을 사용. snapshot/append에 신형 여부와 실제 출력 시각, snapshot에 구형 제한값 전달. 로그 표시 범위가 잘려도 판정 방식 유지. |
| `src/main/index.ts:601` | IPC의 실행 여부와 시작 시각에 동일한 관측 시각 전달. `:474`의 stall 입력은 변경된 activity를 그대로 사용. |
| `src/shared/gptLog.ts:5` | run id 및 snapshot/append의 판정 메타데이터 타입 추가. |
| `src/shared/gptLogParser.ts:4`, `:45` | 신형·구형 파싱, id별 order/end 연결, 중복·종료된 start 제외. 구형 화면 상태에 동일한 무출력 제한 적용. |
| `src/renderer/src/gptLogState.ts:4`, `:27` | 신형 로그의 id 없는 start를 일반 출력으로 유지. 잘린 로그에서 실제 작업 메타데이터 보존 및 신형 여부 전달. |
| `src/renderer/src/components/GptLogPane.tsx:81` | watcher가 전달한 판정 방식·실제 출력 시각·제한값 사용. 겹친 실행 중 하나라도 남으면 실행 중인 작업을 상태 표시 대상으로 사용. |
| `tests/gptGhost.test.ts` | 실행 id, 실제 로그 사본, 화면 경계, stall 입력, 완료 알림의 통합 회귀 테스트 추가. |
| `tests/gptLog.test.ts`, `tests/gptScript.test.ts` | 구형 5분 규칙과 신형 마커 기대값 갱신. 신형 회전·재시작, 출력 에코, 난수 비공개성, 실제 저장소 스크립트 문법 검증 추가. 기존 테스트 삭제 없음. |

스크립트는 임시 파일에 변경을 적용한 뒤 교체했고 LF 줄바꿈으로 저장했다. stdin 닫기, 종료 코드 전달, `--approve-for-me`, 워커 가드, 문단 `t` 마커, 큰 UTF-8 지시서 파일 전달 동작을 유지했다.

신형 로그에서 id 없는 가짜 start는 작업 헤딩을 만들지 않는다. 원문은 일반 로그 줄로 표시하고 복사할 수 있다. 상태에 사용하지 않는 줄이 실행 중 작업으로 보이는 모순을 피하기 위한 처리다. 구형 전용 로그의 기존 헤딩은 유지하고 무출력 제한을 넘으면 stalled로 표시한다.

## 검증 결과

| 검증 | 결과 | 근거 |
|---|---|---|
| 구현 전 실패 확인 | 확인 | 초기 유령 회귀 11개 중 10개 실패. 에코 필터·run id 테스트도 실패 확인. `.verify/ghost-red.log` |
| 가짜 start 출력 | 통과 | id 없는 줄·모르는 유효 hex id 줄을 출력 필터로 통과시킨 뒤 watcher가 미실행으로 판정. 잘못된 id 형식도 무시. |
| 정상 실행·중복·종료 매칭 | 통과 | 정상 start/end 후 미실행, 중복 start 1회, 다른 id end가 기존 실행을 종료하지 않음, 종료된 id 재출력 방지. |
| 실제 관리 로그 사본 | 통과 | 마지막 출력 이후 5분+1ms 조건에서 running=false/activity=false. 이어 신형 정상 start/end를 추가해도 구형 잔여 시작이 실행을 유지하지 않음. 사본 원문을 수정하지 않음. |
| 구형 호환·설정값 | 통과 | 순서 짝, 무출력 경계, 새 실제 출력에 의한 재활성화, 설정값 snapshot 전달. |
| 회전·재시작·잘린 화면 | 통과 | 분할 마커, 열린 tee 백업의 추가 출력, 백업에서 종료 id 복구, 신형 마커가 tail 밖에 있는 경우, 가짜 start 뒤 경계 메타데이터 유지. |
| stall 입력 | 통과 | 유령으로 attention을 만들지 않으며 실제 id 실행의 무출력은 감지. 모니터 자체 기록이 구형 화면의 실행 시간을 연장하지 않음. |
| 완료 알림 | 통과 | watcher와 실제 알림 reducer를 연결하여 Stop(done) 시 미실행이면 3초 후 1회, 진짜 실행이면 보류하고 matching end 이후 3초 후 1회 확인. |
| 스크립트·업그레이드 | 통과 | 난수 32자리·실행별 차이·하위 셸 비노출, 마커 id 일치, 워커 가드, stdin EOF, 종료 코드, 문단 스트리밍, 이전 생성본 전체/CRLF 업그레이드, customized 보존. |
| `npm test` | 통과 | 테스트 파일 85개, 테스트 928개 통과·1개 건너뜀·실패 0. `.verify/ghost-test.log` |
| `npm run typecheck` | 통과 | 종료 코드 0. `.verify/ghost-typecheck.log` |
| `npm run build` | 통과 | 종료 코드 0, `out/` 생성. `.verify/ghost-build.log` |
| 격리 Electron 앱 | 통과 | 별도 userData·가짜 Claude PTY, 실제 hook 상태 전환, 최종 빌드로 검증. `.verify/ghost-runtime/result.json` |
| 프로세스 종료 | 통과 | 격리 앱 종료 코드 0, 가짜 터미널 선행 종료, 남은 검증 PTY pid 0개. 다른 사용자 프로세스 종료 없음. |
| 화면 확인 | 통과 | 아래 최종 캡처 확인. 가짜 줄은 본문에만 표시되고 정상 실행 헤딩과 상태 전환 유지. |
| 실제 스피커 청취 | 미검증 | 격리 앱은 음량 0으로 실행. 알림의 실제 Web Audio oscillator 생성 2회를 계측함. |
| 실제 외부 GPT/Claude 세션 실행 | 미검증 | 신규 외부 세션을 실행하지 않음. 기존 자동 테스트는 임시 스크립트 사본과 가짜 실행기를 사용함. 저장소 실행기 자체는 실행 없이 문법만 검사함. |

최종 명령별 종료 코드는 `.verify/ghost-checks.json`에 저장했다.

## 격리 앱 캡처

1. `.verify/shots/ghost-01-fake-start.png`: 신형 완료 이력 뒤 id 없는 가짜 start만 추가. GPT 미실행, 가짜 작업 헤딩 없음.
2. `.verify/shots/ghost-02-question-done.png`: 가짜 Claude가 질문 출력 후 Stop(done). GPT 미실행, 완료 3초 유예 시작.
3. `.verify/shots/ghost-03-question-notified.png`: 유예 후 알림 오디오 생성 1회, 대기 문구 해제.
4. `.verify/shots/ghost-04-real-running.png`: 정상 id start, `GPT 작업중` 표시.
5. `.verify/shots/ghost-05-notification-held.png`: Stop(done) 이후 실제 GPT 실행이 남아 알림 보류. 추가 오디오 생성 없음.
6. `.verify/shots/ghost-06-real-ended-waiting.png`: 같은 id end 후 유예를 거쳐 알림 생성, 확인 처리 후 `대기중` 표시.

검증 실행기: `.verify/ghost-runtime.cjs`, `.verify/ghost-verify.cjs`, `.verify/ghost-checks.cjs`. `.verify/` 산출물은 Git 제외 대상이다.

## 동작 한계

- id 없는 구형 로그만 있을 때는 같은 모양의 실제 시작과 일반 출력의 가짜 시작을 원문만으로 구분할 수 없다. 호환성을 유지하므로 마지막 실제 출력 후 기본 5분까지 구형 미종료 항목이 실행으로 표시될 수 있다. 새 출력이 계속되면 그 제한도 갱신된다. 신형 마커를 한 번 관측하면 구형 잔여 항목은 즉시 실행 계산에서 제거된다.
- 실제 로그 사본 테스트는 5분 무출력 조건과 신형 전환 조건을 각각 검증했다. 복사 직후의 신선한 구형 미종료 로그를 무조건 미실행으로 판정했다는 의미는 아니다. 격리 앱의 id 없는 에코 검증도 신형 프로토콜이 관측된 로그에서 수행했다.
- 새로운 출력 필터를 거치지 않고 로그 파일에 유효 형식의 새 run id 시작을 직접 쓰는 행위는 실제 시작과 구별되지 않는다. 이 변경은 하위 프로세스 출력의 마커 에코를 무력화하며 로그 파일에 대한 별도 인증 체계를 추가하지 않는다.
- run id가 있는 실행은 matching end까지 유지된다. EXIT/INT/TERM 경로는 end를 남기지만 강제 종료로 end가 유실되면 미종료 항목이 남을 수 있다. 이 경우 무출력 stall 감지는 유지된다. 종료 id 기억은 최근 256개로 제한된다.
- 사용자 수정 스크립트는 자동 덮어쓰기하지 않는다. 기존 customized 안내가 유지되고, 구형 프로토콜이면 위의 5분 제한을 따른다.
- 원본 로그를 정리하거나 사용자 앱을 재시작하지 않았다. 최종 변경은 빌드 산출물과 격리 실행에서 검증했다.
