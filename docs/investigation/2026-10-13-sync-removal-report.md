# 기획↔개발 동기화 제거 결과

작성일: 2026-10-13. 수행 범위: 계획서 Task 1.

## 사실

기획 변경 감지·기준선·반영 완료·변경 배지·변경 목록 문서 생성과 관련 IPC/API를 제거했다. `planning` 종류명, 개발 프로젝트의 기획 링크 드롭다운, `setLinkedPlanning`, 터미널의 `--add-dir` 참조는 유지했다. 링크 설정 IPC는 레지스트리만 갱신한다. 마스터 MD 시드·동기화와 공유 스킬 동기화는 유지했다.

기존 새로고침·로그 시각·상태 표시·유령 GPT 판정 변경은 유지했다. 이 작업에서 `scripts/gpt.sh`를 편집하지 않았으며 커밋·푸시는 수행하지 않았다.

## 삭제 파일

| 파일 | 결과 |
| --- | --- |
| `src/main/planningSync.ts` | 변경 감지·스냅샷·기준선 구현 삭제 |
| `src/main/planningSyncHandlers.ts` | 동기화 핸들러 재노출 삭제 |
| `src/main/planningSyncIpc.ts` | 동기화 IPC 핸들러·터미널 지시 삭제 |
| `src/renderer/src/usePlanningSync.ts` | 폴링 훅 삭제 |
| `src/renderer/src/planningSyncState.ts` | 배지·버튼 상태 변환 삭제 |
| `tests/planningSync.test.ts` | 삭제된 구현 테스트 삭제 |
| `tests/planningSyncHandlers.test.ts` | 삭제된 핸들러 테스트 삭제 |
| `tests/planningSyncState.test.ts` | 삭제된 상태 변환 테스트 삭제 |
| `tests/rendererPlanningSync.test.ts` | 삭제된 동기화 UI 테스트 삭제 |

## 수정 파일

| 파일 | 변경 |
| --- | --- |
| `src/main/index.ts` | 동기화 인스턴스·IPC·삭제 정리·dispose 제거, 링크 레지스트리 갱신 유지, 마스터 동기화 진입 시 관리 문서 정리 호출 |
| `src/main/masterDoc.ts` | 링크 문서 생성 제거, `removeManagedPlanningFiles` 추가 |
| `src/main/master/MASTER.md` | 변경 목록·반영 완료 버튼 안내 문단 삭제 |
| `src/main/templates.ts` | 삭제된 링크 문서를 읽으라는 안내 삭제; 신규 안내 미작성 |
| `src/preload/index.ts` | 동기화 API 네 개 제거 |
| `src/shared/types.ts` | 동기화 IPC 키·응답 타입·API 선언 제거 |
| `src/renderer/src/env.d.ts` | 링크 선택 API 설명 정리; 공통 `YalApi` 타입 사용 유지 |
| `src/renderer/src/App.tsx` | 동기화 훅·액션·헤더 배지·버튼 제거 |
| `src/renderer/src/components/ProjectList.tsx` | 변경 건수 배지 제거, 상태·알림·폴더 경고를 이름 아래 라벨 영역으로 이동 |
| `src/renderer/src/styles.css` | 동기화 UI 스타일 제거, 이름 최소 너비 48px·말줄임, 라벨 줄바꿈 적용 |
| `src/shared/i18n.ts` | 동기화 문구 13개를 ko/en에서 함께 제거 |
| `tests/masterDoc.test.ts` | 문서 미생성, 관리 문서 정리·사용자 파일 보존·심볼릭 링크 거부 검증 |
| `tests/projectPreload.test.ts` | 동기화 API/IPC 부재와 링크 API 유지 검증 |
| `tests/projectMain.test.ts` | 링크 레지스트리 보존·문서 미생성·동기화 IPC 부재 검증; 기존 `--add-dir` 테스트 유지 |
| `tests/rendererProjects.test.ts` | 동기화 UI 부재, 이름 아래 두 라벨 배치 검증; 링크 선택 테스트 유지 |
| `tests/provisioner.test.ts` | 삭제된 링크 문서 안내가 템플릿에 없음을 검증 |
| `tests/i18n.test.ts` | 제거 문구 부재 검증; ko/en 키 일치 검증 유지 |

## 관리 파일 정리 동작

`removeManagedPlanningFiles(projectPath)`는 `yal-planning-changes.md`, `yal-planning-link.md`에 대해 `{ removed: string[]; preserved: string[] }`를 반환한다. 배열 항목은 문서 파일명이다.

문서가 일반 파일이며 사이드카의 `name`이 문서명과 일치하고 `version === 1`, `sha256`이 유효한 64자리 소문자 16진수이고 실제 파일 바이트의 SHA-256과 일치할 때만 문서와 사이드카를 삭제한다. 읽기 전용 속성은 삭제 직전에 해제한다. 문서와 사이드카 모두 없으면 건너뛴다.

마커 없음·잘못된 이름/버전/해시·손상 JSON·사용자 수정 문서·문서 없는 사이드카는 보존한다. 프로젝트 경로·`.claude`·문서·사이드카의 심볼릭 링크는 기존 `rejectSymbolic`으로 거부한다. 예외는 로그에 기록하고 다음 문서 처리를 계속하며 앱으로 전파하지 않는다. 앱 시작과 프로젝트/마스터 동기화 진입 시 프로젝트별로 한 번 호출한다. 링크 설정만으로는 파일을 생성하거나 정리하지 않는다.

## 검증 결과

| 검증 | 결과 |
| --- | --- |
| 구현 전 회귀 테스트 | 3개 파일에서 15개 실패·20개 통과. API 잔존, 정리 함수 미구현, 제거 대상 마스터 안내 잔존, 이름 아래 라벨 영역 부재 확인 |
| `npm test` 최종 실행 | 통과: 81개 파일, 844개 테스트, 종료 코드 0 |
| `npm run typecheck` | 통과, 종료 코드 0 |
| `npm run build` | 통과, 종료 코드 0; `out/` 생성 |
| `git diff --check` | 통과 |
| 관리 문서 정리 회귀 | 마커+해시 일치만 삭제, 수정본/무마커/오류 마커/고아 사이드카 보존, 프로젝트·폴더·문서·마커 링크 거부 통과 |
| 개발 터미널 링크 참조 | 기존 `argsFor` 회귀 테스트 통과: 유효한 기획 폴더만 `--add-dir`, 없는 폴더·일반 파일·기획 터미널은 생략 |
| 렌더러/사이드바 기존 회귀 | 전체 테스트에 포함해 통과 |
| 격리 앱 링크 UI | 선택·해제·재선택 통과, 동기화 배지/버튼 없음, 관련 preload 메서드 없음, 링크/변경 문서 미생성 |
| 두 라벨 가시성 | 260px/180px 사이드바에서 이름 높이 17px, 너비 약 147.42px/67.42px. 라벨은 이름 아래. 180px에서 이름 말줄임 확인 |
| 캡처 직접 열람 | 아래 3장 모두 이미지로 읽어 확인 |
| 종료 확인 | 검증용 터미널 종료 후 격리 앱 종료. 기록된 앱 PID와 검증용 터미널 PID가 남아 있지 않음 확인 |
| 자체 diff 검토 | 동기화 코드 연결 제거, 링크 선택·마스터/스킬 동기화·기존 변경 유지 확인 |

격리 검증은 별도 userData와 가짜 Claude 터미널을 사용했다. 실제 Claude/GPT CLI를 재호출하지 않았다. 다른 사용자 프로세스를 종료하지 않았다.

## 산출물

- 보고서: `docs/investigation/2026-10-13-sync-removal-report.md`
- 격리 실행 스크립트: `.verify/sync-removed-runtime.cjs`
- 실행 결과: `.verify/sync-removed-runtime/result.json` (`passed: true`, `fixtureTerminalExited: true`)
- 문자열 검사: `.verify/sync-removed-string-scan.txt`
- 링크 선택 캡처: `.verify/shots/sync-removed-01-linked.png`
- 260px 두 라벨 캡처: `.verify/shots/sync-removed-02-labels-260.png`
- 180px 두 라벨 캡처: `.verify/shots/sync-removed-03-labels-180.png`

## 잔존 문자열 및 한계

`src`의 지정 문자열 검색 결과는 `masterDoc.ts` 정리 함수의 구형 문서명 한 줄뿐이다. `tests`에는 제거된 API/문구/파일이 존재하지 않음을 확인하는 회귀 검증과 구형 관리 파일 정리 픽스처가 남아 있다. 기존 계획서·설계서·조사 기록의 역사적 설명은 유지했다.

첫 격리 실행은 새로고침 후 캡처에서 `UnknownVizError`로 실패했다. 당시 링크 동작과 260px 이름 측정은 성공했으며, 캡처 대기·재시도 및 실패 시 검증용 터미널 종료 처리를 추가한 최종 실행은 재시도 없이 통과했다. 실행 시 Node의 기존 `DEP0190` 경고가 출력됐다.

실제 사용자 프로젝트 파일은 이번 검증에서 직접 삭제하지 않았다. 해당 정리 동작은 임시 프로젝트 테스트와 앱 동기화 호출 연결로 검증했다. 실제 Claude CLI와 사용자 프로필을 사용하는 종단 실행은 미검증이다. 사용자 수정 마스터·CLAUDE.md 원본에는 과거 안내가 남을 수 있으며, 이번 작업은 사용자 원본을 재작성하지 않는다. 기존 `planning-sync` 스냅샷 데이터의 일괄 삭제는 수행하지 않았다. `planning`→`assets` 이름 변경과 신규 규칙 작성은 수행하지 않았다.
