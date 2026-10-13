# 2026-10-13 GPT 멈춤·지연 분석

## 조사 범위와 증거

2026-10-12~13 날짜 폴더의 Codex 세션 JSONL 273개를 읽었다. 현재 작업의 08:28:28 세션은 후보 집계에서 제외했다. 세션 원본, 실제 앱 데이터와 GPT 로그에는 쓰지 않았다. `<userData>`의 실제 조사 위치는 `C:/Users/USER/AppData/Roaming/yal-ide`이다. `.verify/` 로그, `git diff -- scripts/gpt.sh`, `git log` 및 `.verify/gpt.sh.broken-by-prev-task`도 확인했다.

- `.verify/cleanup-stall-evidence.json`: 키워드 후보와 로그 마커 목록. 소스·테스트·문서를 출력한 기록도 포함되므로 키워드 횟수는 실제 장애 건수가 아니다.
- `.verify/cleanup-confirmed-evidence.json`: 실제 오류 출력으로 선별한 6개 기록. 원본 파일, 줄 번호, UTC 시각과 오류 발췌 포함.
- `.verify/ui-real-gpt-output.txt`: 2026-10-12 07:45:36~07:45:44 UTC, 정상 종료 코드 0인 과거 실행.
- `.verify/gpt.sh.broken-by-prev-task`: `--sandbox` 및 후속 `claude -p` 실행이 들어 있던 백업. 현재 코드가 아니다.
- `.verify/cleanup-ui-observations.json`: 이번 격리 앱 검증에서 관찰한 ConPTY 정리 오류와 최종 재검증 결과. 첫 앱 로그는 최종 캡처 실행으로 덮어써졌으며 관찰 기록을 별도로 남겼다.

## 원인별 판정·조치·한계

| 분류 | 확인한 사실 | 이번 조치 | 남은 위험·판정 한계 |
| --- | --- | --- | --- |
| ① stdin EOF 대기 | HEAD의 과거 생성 스크립트는 일반 실행에서 stdin을 상속했다. 과거 로그에 `Reading additional input from stdin...`가 있다. 위 정상 실행은 8초 뒤 종료했으므로 이 문구만으로 실제 멈춤을 입증하지 못한다. | 지시서 입력은 먼저 읽고, 실제 Codex stdin은 `< /dev/null`로 닫는다. IDE 직접 실행 경로는 제거했다. 하네스도 지시서를 전송한 뒤 stdin을 `end()`한다. 스텁에서 EOF 검증. | `gpt.sh -`로 지시서를 주는 호출자가 입력 스트림을 닫지 않으면 wrapper의 `cat` 단계에서 기다린다. 실제 모델 반복 실행은 수행하지 않았다. |
| ② 외부 재호출 거부 | `rollout-2026-10-13T07-20-56-01a13234-60bc-7fa1-827f-865d0744fb48.jsonl:25`, 2026-10-12T22:21:27.926Z: `scripts/gpt.sh` 실행이 자동 승인에서 거부됐다. 명시된 이유는 저장소·세션 기록의 외부 모델 전달에 대한 목적지별 승인 부재였다. | 워커의 외부 CLI 재호출 차단을 유지했다. 내부 서브에이전트·병렬 워커 허용을 규칙에 명시했다. 실제 CLI 없이 스텁만 실행했다. | 이 기록은 도구 실행 거부를 입증한다. 전체 세션의 즉시 종료 또는 장시간 심사 대기까지 입증하지는 않는다. |
| ③ Windows 읽기 전용 | 정상 실행과 실제 프로젝트 로그 모두 `approval: on-request`, `sandbox: read-only`를 표시한다. `rollout-2026-10-12T12-42-16-01a12e34-357d-7d82-a936-c57a72b7c1be.jsonl:23`에는 `patch rejected: writing is blocked by read-only sandbox; rejected by user approval settings`가 있다. | 기존 `--approve-for-me`를 유지하고 `--sandbox workspace-write` 강제 인자는 추가하지 않았다. 설정 권한을 PTY 환경 및 지시 규칙으로 전달한다. | 현재 실행 플랫폼의 읽기 전용 정책을 wrapper가 바꾸거나 보장할 수 없다. 편집 선택도 OS 접근 권한 보장이 아니며, 읽기 전용은 GPT 지시 규칙이다. |
| ④ Windows 길이·인용 | `rollout-2026-10-13T04-19-11-01a1318d-fcdb-7a81-ac38-4c6171a1ece1.jsonl:103`, 2026-10-12T19:22:36.719Z: `Failed to create unified exec process ... (os error 206)`. 직전 명령은 큰 압축 데이터를 포함한 PowerShell 검증 명령이었다. 별도 세션에는 Node 식 인용 오류도 있다. | 전체 GPT 지시서를 임시 UTF-8 파일로 저장하고 2,000자 미만 bootstrap만 CLI에 전달한다. Git Bash에서는 `cygpath -w`로 원생 Windows 경로를 전달한다. 40,000자 한글·인용·셸 기호를 stdin으로 전달해 보존과 정리를 검증했다. | 확인된 206 오류는 GPT CLI 자체가 아니라 도구 명령 생성 단계였다. 일반 개발 명령의 길이·인용 오류는 여전히 별도로 발생할 수 있다. |
| ⑤ 자동 승인 심사 | 위 재호출 거부 외에 `rollout-2026-10-13T04-29-46-01a13197-ad98-7a12-a57e-860792052557.jsonl:364`는 PID 8552/포트 4173과 설명의 4174가 다르다는 이유로 종료 명령을 거부했다. | 승인 정책을 우회하지 않았다. 출력 공백을 감시하고 승인 대기·로그 확인 문구를 표시한다. 검증 프로세스는 직접 생성한 PID와 격리 프로필로 식별했다. | 심사 거부는 확인했다. 심사 서비스 자체의 장시간 무응답을 확정할 증거는 발견하지 못했다. |
| ⑥ 프로세스 정리 | 이번 첫 앱 종료에서 `node-pty`의 `AttachConsole failed`를 관찰했다. 라이브러리는 콘솔 목록 조회를 비동기로 시작한 뒤 PTY를 종료한다. 이전 로그의 종료 명령 거부도 프로세스 정리를 방해할 수 있다. | 이미 종료됐다고 기록된 PTY에는 `kill()`을 다시 호출하지 않는다. 회귀 테스트 포함. 캡처 fixture는 자체 종료 후 앱을 닫았다. 최종 앱 종료 코드 0, fixture node 잔류 0개. | 살아 있는 ConPTY 종료의 비동기 목록 조회 경합은 외부 라이브러리에 남는다. 사용자의 다른 프로세스는 종료하지 않았다. 과거 세션의 실제 orphan 잔류 여부는 확정하지 못했다. |
| ⑦ 네트워크 재연결 | 실제 앱 `fafe09f2-e5df-4a68-8c56-132a66c33903.log:11576`에 `ERROR: Reconnecting... 2/5`가 있다. 주변 실행은 이후 진행했다. | 출력 공백 알람으로 장시간 무진행을 노출한다. 네트워크 오류를 실행 wrapper가 대신 재시도하지 않는다. | 일시 재연결은 확인됐다. 지속 장애·서비스 원인·지연 길이를 확정하지 못했다. |
| ⑧ 도구 정책 차단 | `rollout-2026-10-13T07-56-59-01a13255-634e-7d10-bab2-dcf82cb67ba0.jsonl:29`에서 읽기 작업인 `git status --short`도 `blocked by policy`로 거부됐다. | 도구 차단과 모델 멈춤을 구분해 기록했다. 외부 CLI 호출 경로를 줄이고 워커가 수행할 수 있는 로컬 검증만 진행했다. | 정책 차단은 IDE 코드로 해결할 수 없다. 사용자에게는 진행 중단처럼 보일 수 있지만 확인된 오류는 즉시 거부다. |

## 멈춤 감시 구현

`StallMonitor`는 시작 마커가 있고 종료 마커가 없는 GPT 작업을 대상으로 한다. 프로젝트 상태가 `working`이고 GPT 로그나 그 로그에 표시된 해당 Codex 세션 파일이 기본 10분 동안 갱신되지 않으면 `attention`으로 바꾼다. 설정 창의 “GPT 출력 없음 감시 (분)”에서 1~1,440분으로 변경할 수 있다. 검사 간격은 5초다.

`=== [YAL-GPT] stall <UTC> ===` 마커, OS 알림과 화면의 “멈춘 것으로 의심” 안내를 남긴다. 감시 기능은 프로세스를 종료하지 않는다. 로그 또는 해당 세션의 새 갱신이 감시 경고 시각보다 뒤이면 `working`으로 복귀하고 `resumed` 마커를 남긴다. 감시가 만들지 않은 `attention`은 자동으로 복원하지 않는다. 감시·알림 오류는 타이머에서 격리해 IDE 전체 종료로 전파하지 않는다.

세션 조회는 로그의 `session id:` UUID와 시작일 전후 하루 폴더만 조회한다. 찾지 못한 세션은 30초 뒤 재조회한다. 다른 프로젝트나 다른 세션의 활동은 복귀 근거로 사용하지 않는다. 로그 회전·세션 ID 분할 수신도 단위 테스트로 확인했다. `stall`/`resumed` 자체 로그는 작업 재개로 세지 않는다.

출력 없음은 정지의 확정 판정이 아니다. 긴 계산·서비스 대기·승인 대기일 수 있다. 기존 로그 뷰의 30분 무출력 배지 계산은 그대로 두고, 새 10분 감시 상태는 헤더·안내·알람에 표시한다. 기존 마커는 task ID가 없어 중첩·누락된 시작/종료 마커를 완전히 구분하지 못한다. 로그 삭제, 비표준 세션 경로, 세션 ID 미출력 시에는 세션 감시를 사용할 수 없고 로그 갱신만 사용한다.

## 반복 실행 하네스

파일: `scripts/stall-check.cjs`. 기본은 5회, 출력 공백 기준은 60초이다. 회차별 상태, 소요 시간, 종료 코드, 무출력 여부, 최대 출력 공백과 마지막 출력 일부를 `.verify/stall-check.json`에 저장한다. 실행 도중 공백 기준을 넘겨도 기록을 갱신하며 자동 종료하지 않는다. 실제 하네스는 `YAL_GPT_WORKER=1`에서 실행을 거부한다.

워커 밖 Claude 디렉터 환경에서의 실제 사용법:

```powershell
node scripts/stall-check.cjs --runs 5 --no-output-seconds 60
node scripts/stall-check.cjs --project "D:/대상 프로젝트" --runs 5 --no-output-seconds 120
```

실제 모드는 대상 프로젝트의 `scripts/gpt.sh`를 사용한다. 검사 작업은 `package.json` 한 파일을 읽고 프로젝트 이름을 한 줄로 출력하는 것이다. 파일 수정·추가 프로세스·외부 CLI 재호출을 금지하는 지시서를 전달한다. 결과 경로는 `--output`으로 바꿀 수 있다. 실제 Codex가 별도 긴 계산이나 승인을 기다리는 경우 하네스는 그 회차를 기다린다.

이번 수행에서 사용한 스텁 검증:

```powershell
node scripts/stall-check.cjs --stub
node scripts/stall-check.cjs --stub --runs 1 --no-output-seconds 0.05 --stub-delay-ms 200 --stub-exit 7 --output .verify/stall-check-failure.json
```

`--stub`은 자체 생성한 임시 프로젝트와 PATH상의 가짜 codex만 사용한다. 이 분기에서만 워커 환경을 분리한다. 실제 프로젝트의 CLI에는 적용하지 않는다. 기본 5회는 모두 종료 코드 0, stdin EOF 확인, 60초 공백 없음이었다. 지연/종료 코드 7은 단위 테스트로 공백 판정과 비정상 종료 보존을 확인했다. 실제 Codex/Claude 반복 실행은 수행하지 않았다.
