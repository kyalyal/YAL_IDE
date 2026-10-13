# YAL_IDE 복원·재구축 결과 보고서

작성일: 2026-10-13 (한국시간)  
수행: GPT 단독. 다른 에이전트 위임, scripts/gpt.sh를 통한 실제 GPT 작업 재호출, 커밋·푸시 없음.

## 결과

관리 공간을 추가하고 프로젝트 터미널의 Claude 자동 실행·재개를 HEAD 방식으로 복원했다. Claude는 대화·명령·검수·재명령을 담당하는 디렉터이며, GPT는 지시받은 일을 직접 완료하고 결과를 파일로 저장하는 수행자다. GPT 완료 후 Claude를 자동으로 별도 호출하던 구현은 제거했다.

## 백업과 복원

- 추적 변경 백업: `.verify/backup-before-rebuild.patch`.
- 새 파일 내용 백업: `.verify/backup-untracked/`. 새 파일 16개의 내용을 원본과 바이트 단위로 비교하여 모두 일치했다.
- 잘못된 이전 GPT 스크립트 원본: `.verify/gpt.sh.broken-by-prev-task`.
- 백업 추적 변경은 `git apply --reverse --check --exclude=scripts/gpt.sh .verify/backup-before-rebuild.patch`에 통과했다. scripts/gpt.sh는 작업 시작 전에 이미 HEAD로 복원된 상태였다.
- 백업 확인 뒤 추적 파일을 HEAD로 복원하고 직전 작업의 새 파일들을 개별 삭제했다. .verify, node_modules, out은 복원·삭제 대상에서 제외했다. out은 이후 빌드로 갱신했다.
- 루트 CLAUDE.md는 건드리지 말라는 명시 지침을 우선하여 복원에서도 제외했다. 작업 전후 SHA-256이 동일하다. git status의 CLAUDE.md 변경 표시는 작업 시작 전부터 존재한 변경이다.
- 관리 공간·원자적 저장·시작/취소 마커 등 필요한 부분만 백업에서 다시 적용하고 역할·실행 경로를 수정했다.
- terminalManager.ts, planningSyncIpc.ts, 공유 MASTER.md와 기획/개발 내장 스킬 내용은 HEAD와 동일하다.
- 근거: `.verify/rebuild-backup-check.json`, `.verify/rebuild-restore.json`, `.verify/rebuild-audit.json`.

## 관리 공간의 동작

고정 프로젝트 ID는 `yal-ide-manage`다. 기획·개발과 별도 탭과 사이드바 영역을 갖고 기본 연결 대상은 `app.getAppPath()`의 IDE 저장소 루트다. 설정에서 연결 대상과 규칙 저장 위치를 변경할 수 있다. 변경한 경로는 IDE 재시작 후 적용된다. 실행 중 저장소와 같은 경로라면 경고 배지와 빌드·재시작 안내가 표시된다.

규칙 기본 위치는 `<userData>/spaces/manage/skills`와 `<userData>/spaces/manage/master/MASTER.md`다. 사용자가 지정한 관리 저장소 아래에 skills와 master를 둔다. 기획·개발 공간, 기존 공유 skills/master와 같은 경로뿐 아니라 상위·하위 경로도 거부한다. 실제 경로를 정규화하여 정션을 통한 중첩도 거부한다.

관리 스킬/MD는 스킬 창의 관리 탭에서 독립적으로 편집한다. 기획·개발 편집 요청은 IPC에서 거부한다. 관리 스킬은 기존 프로젝트 규칙 복사본으로 동기화하지 않는다. 관리 Claude 세션에는 디렉터 역할과 독립 규칙 위치를 추가 지시로 제공한다. GPT 작업은 실행할 때 해당 공간의 최신 MD·스킬을 읽는다.

관리 프로젝트도 기존 터미널, GPT 로그 파서·감시, 상태 추적, 완료/주의 알람 흐름을 사용한다. 프로젝트별 GPT 작업 권한을 저장하며 직접 실행 입력 영역을 제공한다. 직접 실행 결과는 프로젝트 `docs/yal-results/` 및 앱 데이터 `task-results/<projectId>/`에 저장한다. 읽기 전용 작업의 출력은 앱 데이터에 저장한다. 직접 실행은 GPT 종료로 완료되며 Claude 자동 검수 프로세스를 생성하지 않는다.

설정·관리 MD·상태 파일은 같은 디렉터리의 고유 임시 파일에 먼저 쓰고 rename으로 교체한다. 실패하면 임시 파일을 정리하고 기존 파일 및 공개된 설정 상태를 보존한다. 스킬 저장은 기존 SkillStore의 원자적 저장·이력 처리를 사용한다. 사용자 편집 이력의 author는 user다.

## Claude 터미널 복원과 수행자 실행

프로젝트 터미널은 Windows에서 `cmd.exe /c claude`, 다른 플랫폼에서 claude를 실행한다. 기존 세션이 있으면 `--continue`를 전달한다. 상태 훅의 `--settings`와 연결된 기획 폴더의 `--add-dir`도 복원했다. Codex 미설치만으로 Claude 터미널을 막던 UI 회귀도 수정했다. 기획 변경분 적용은 원래대로 Claude 터미널에 전달한다.

새 CLAUDE.md 템플릿에는 Claude 디렉터의 대화·명령·검수·재명령 역할을 명시했다. 새 AGENTS.md 템플릿과 루트 미커밋 AGENTS.md에는 GPT 수행자, 위임·재호출·Claude에게 질문/제안 금지, 직접 완료와 사실·산출물·검증 결과의 파일 저장을 명시했다. 루트 CLAUDE.md의 내용은 유지했다.

scripts/gpt.sh와 생성 템플릿은 동일하다. stdin 지시서는 먼저 문자열로 읽은 후 공통 수행자 머리말을 붙인다. 실제 Codex 호출은 다음 인자 형식을 유지한다.

```bash
codex exec --model gpt-6.1-sol --cd "$ROOT" --approve-for-me --skip-git-repo-check "$PROMPT" < /dev/null
```

실제 구현은 PATH 변경 전에 확보한 Codex 실행 파일을 사용하며, HEAD와 같은 GPT_MODEL 기본값 gpt-6.1-sol을 유지한다. `--sandbox`와 `--ask-for-approval never`를 전달하지 않는다. IDE 직접 실행 경로도 동일한 승인·모델·작업 경로 인자와 닫힌 stdin을 사용한다. Windows의 긴 지시서는 UTF-8 임시 파일에 저장하고 읽을 경로를 전달한다.

알려진 기존 생성 스크립트는 전체 내용 비교로 갱신한다. 직전 잘못된 생성 스크립트는 정규화한 전체 내용의 SHA-256이 정확히 일치할 때만 갱신한다. 사용자 수정본은 보존한다. `tests/fixtures/rejected-gpt-script.txt`는 실행하지 않는 이전 버전 테스트 자료다.

## 가드·차단 방식과 한계

- gpt.sh는 `YAL_GPT_WORKER=1`이면 지시서/stdin을 읽기 전에 “GPT는 GPT에게 위임할 수 없다”를 출력하고 종료 코드 1로 끝난다.
- 승인된 첫 Codex 경로를 먼저 찾은 뒤 GPT 자식에게만 YAL_GPT_WORKER=1과 차단 디렉터리를 PATH 맨 앞에 전달한다. 디렉터 터미널의 PATH는 변경하지 않는다.
- 차단 디렉터리에는 codex, claude, gpt.sh 셸 실행 파일과 각각의 .cmd/.ps1 파일을 만든다. 실패 메시지를 출력하고 종료 코드 1로 끝난다. Bash의 이름 조회 및 Windows cmd/PowerShell 실행을 테스트했다. Windows gpt.sh.cmd/gpt.sh.ps1은 명시한 실행 형식으로 검사했다.
- IDE 직접 실행도 같은 worker 환경을 사용한다. worker 상태에서 직접 실행 함수를 재호출하거나 이 경로에서 Claude를 호출하면 실행 전에 거부한다.
- GPT 출력의 시작/종료 마커를 기록한다. CLI 시작 실패와 취소에도 종료 마커를 남기고 늦은 종료 이벤트를 무시한다. 종료 호출 자체가 실패해도 취소 마커를 남긴다. 셸 종료 trap은 정상 종료·실패·처리 가능한 INT/TERM에서 마커와 임시 shim 정리를 수행한다.

이 방식은 일반적인 이름 기반 재호출을 기술적으로 막는 환경 가드이며 OS 보안 경계는 아니다. 실행 파일의 절대 경로, PATH/YAL_GPT_WORKER 초기화, 다른 이름의 실행 파일·API 호출 등 고의적 우회까지 차단하지 않는다. cmd.exe에서 확장자가 .sh인 파일의 파일 연결로 여는 동작은 프로세스 차단 명령과 다르다. 강제 종료로 셸 trap이 실행되지 않는 경우에도 마커를 보장할 수는 없다.

읽기 전용 선택은 GPT 지시와 프로젝트별 설정에 적용된다. `--approve-for-me` 방식을 유지하므로 OS 수준의 파일 쓰기 강제 제한은 아니다. 이 한계는 작업 입력 영역에도 표시한다. 실제 GPT 모델에 제작 작업을 다시 지시하지 않았으며 Codex 실행 인자·stdin·환경 전달은 가짜 CLI와 프로세스 단위 테스트로 확인했다.

## 검증 결과

| 명령/확인 | 결과 | 근거 |
| --- | --- | --- |
| `npm test` 및 전체 JSON 리포트 실행 | 79개 테스트 파일 통과, 860개 통과, 1개 건너뜀, 실패 0 | `.verify/rebuild-test-final.log`, `.verify/rebuild-tests.json` |
| `npm run typecheck` | 종료 코드 0 | `.verify/rebuild-typecheck.log` |
| `npm run build` | 종료 코드 0, out 생성 | `.verify/rebuild-build.log` |
| `git diff --check` | 종료 코드 0 | `.verify/rebuild-audit.json` |
| 격리 Electron/CDP 실행 | 관리·기획·개발·스킬·설정 화면 캡처 완료 | `.verify/rebuild-ui-results.json` |
| 실제 프로젝트 터미널 | 세 공간 모두 Claude 출력 확인 | 같은 JSON의 terminals 항목 |
| 검증 앱 종료 | 정상 종료 코드 0, 마지막 실행은 강제 종료 불필요 | `.verify/rebuild-cleanup.json` |

건너뛴 기존 테스트는 `planningSync.test.ts`의 skips file symlinks다. Windows 파일 심볼릭 링크 권한이 없어 기존 조건에 따라 건너뛰었다. 정션 경계 테스트는 실행·통과했다.

가드·shim·HEAD 실행 인자·닫힌 stdin·검수 재호출 없음·관리 탭·독립 규칙·설정/MD 원자적 쓰기·시작 실패/취소 마커·Claude 자동 실행/재개에 대한 테스트를 실행했다. 새 회귀는 수정 전 실패도 확인했다. 초기 실패와 수정 과정의 로그는 `.verify/rebuild-test-first.log` 및 `.verify/rebuild-test-second.log`에 보존했다.

검증 프로필은 `.verify/rebuild-profile-final2`다. CDP 포트는 실행 때 빈 포트를 골랐다. 캡처 스크립트는 `.verify/rebuild-capture.cjs`이며 앱의 --remote-debugging-port와 --user-data-dir를 지정했다. 마지막 검증 앱 PID는 24208였고 자신이 만든 창만 정상 닫았다. 다른 실행 중 Codex/Node 프로세스는 종료하지 않았다.

검증 환경에서 상속된 CLAUDE_CODE_CHILD_SESSION에 따른 새 대화 저장 꺼짐 경고가 표시됐다. 세션 자동 실행과 기존 세션 재개 출력은 확인했다. Electron 로그의 skills:save 오류는 기획/개발 스킬 편집 거부를 의도적으로 확인한 결과다. DEP0190 경고는 기존 Windows CLI 설치 확인 코드에서 발생하며 타입 검사·빌드·캡처를 중단하지 않았다.

## 캡처

- `.verify/shots/rebuild-dev.png` (1264×735)
- `.verify/shots/rebuild-main.png` (1264×735)
- `.verify/shots/rebuild-planning.png` (1264×735)
- `.verify/shots/rebuild-settings.png` (680×1050)
- `.verify/shots/rebuild-skills-dev.png` (1100×1050)
- `.verify/shots/rebuild-skills-planning.png` (1100×1050)
- `.verify/shots/rebuild-skills.png` (1100×1050)

## 변경 파일

HEAD 대비 실제 수정 파일(작업 전부터 수정되어 있던 루트 CLAUDE.md 제외):

- `scripts/gpt.sh`
- `src/main/index.ts`
- `src/main/processTree.ts`
- `src/main/provisioner.ts`
- `src/main/settingsStore.ts`
- `src/main/skillsRuntime.ts`
- `src/main/skillsSetup.ts`
- `src/main/spaces.ts`
- `src/main/statusTracker.ts`
- `src/main/templates.ts`
- `src/preload/index.ts`
- `src/renderer/src/App.tsx`
- `src/renderer/src/components/ProjectList.tsx`
- `src/renderer/src/components/SettingsWindow.tsx`
- `src/renderer/src/components/SkillsWindow.tsx`
- `src/renderer/src/components/skills.css`
- `src/renderer/src/projectListState.ts`
- `src/renderer/src/styles.css`
- `src/shared/i18n.ts`
- `src/shared/settings.ts`
- `src/shared/skills.ts`
- `src/shared/types.ts`
- `tests/exportMain.test.ts`
- `tests/gptLogMain.test.ts`
- `tests/gptScript.test.ts`
- `tests/projectMain.test.ts`
- `tests/projectPreload.test.ts`
- `tests/provisioner.test.ts`
- `tests/rendererActivity.test.ts`
- `tests/rendererPlanningSync.test.ts`
- `tests/rendererProjects.test.ts`
- `tests/rendererSidebar.test.ts`
- `tests/rendererSkills.test.ts`
- `tests/settingsStore.test.ts`
- `tests/skillStore.test.ts`
- `tests/skillsPreload.test.ts`
- `tests/skillsRuntime.test.ts`
- `tools/yal-skill.cjs`

신규/재작성 파일:

- `AGENTS.md`
- `src/main/atomicWrite.ts`
- `src/main/manageSpace.ts`
- `src/main/taskProcess.ts`
- `src/main/taskRules.ts`
- `src/main/taskRunner.ts`
- `src/main/workerEnvironment.ts`
- `src/renderer/src/components/ManagementSettings.tsx`
- `src/renderer/src/components/TaskPanel.tsx`
- `tests/atomicWrite.test.ts`
- `tests/fixtures/rejected-gpt-script.txt`
- `tests/manageSpace.test.ts`
- `tests/rendererManagement.test.ts`
- `tests/rendererTaskPanel.test.ts`
- `tests/taskProcess.test.ts`
- `tests/taskRunner.test.ts`
- `tests/workerEnvironment.test.ts`
- `docs/investigation/2026-10-13-rebuild-report.md`
