# 개발 공간 규칙 병합 결과 — Task 3

## 변경 파일

| 파일 | 반영 내용 |
|---|---|
| `src/main/skills/builtin/yal-game-planning.md` | 개발 프로젝트용 v3 규칙 재작성, frontmatter 유지 |
| `src/main/skills/builtin/yal-game-planning-v2.txt` | 작업 시작 시 v2 원문을 바이트 그대로 복사해 보관 |
| `src/main/skillsSetup.ts` | dev 내장 스킬에 설치 버전 3 및 previousContent=v2 등록; assets 목록은 빈 배열 유지 |
| `src/main/assetsMigration.ts` | 구형 내장본 비교 대상을 보관된 v2로 고정 |
| `src/main/master/MASTER.md` | 개발 기획·설계 단계의 자율 진행, 에셋 프로젝트 참조 규칙, 공간 값 설명 반영 |
| `src/main/templates.ts` | dev CLAUDE.md/AGENTS.md에 v3 본문 추가; assets는 v2 본문으로 분리 |
| `tests/planningAutonomy.test.ts` | dev 신규 설치·v2 갱신·사용자 수정본 보존·설치 버전 조건·규칙 항목 검증 |
| `tests/masterDoc.test.ts` | 기존 사용자 MASTER 원본과 동기화 복사본이 새 기본본으로 대체되지 않는 테스트 추가 |
| `tests/provisioner.test.ts` | 새 dev 규칙 파일 생성과 사용자 추가 규칙 보존 테스트 추가 |
| `tests/skillsRuntime.test.ts` | dev 내장 스킬 3개 설치·동기화 기대값 반영; 구형 v2 검증 경로 고정 |
| `tests/assetsMigration.test.ts` | 구형 내장본 fixture를 보관된 v2로 고정 |
| `.verify/merge-rules-runtime.cjs` | 격리 userData, 터미널 fixture, 실제 앱 IPC·화면 캡처 검증 |

기존 v1 보관본, 사용자 기준 스킬, `scripts/gpt.sh`는 이 작업에서 변경하지 않았다. 선행 변경을 되돌리지 않았고 커밋·푸시를 수행하지 않았다. `masterDoc.ts`의 시드는 기본 MASTER를 가져오는 기존 구조를 유지했다. 새 UI 문구를 추가하지 않아 ko/en i18n 변경은 없다.

## v3 규칙

- 한 개발 프로젝트에서 기획 → 설계 → 구현 → 검증을 이어서 수행한다. 기획은 `docs/planning/`, 설계는 `docs/design/` 또는 기존 설계 위치를 사용한다.
- 컨셉·세계관·아트 디렉션·UI/UX·밸런스·레벨·카피·연출을 자율 결정하고 근거·가정을 기록한다. “혼자 못한다/제가 할 수 없습니다”로 멈추거나 사용자에게 넘기지 않는다.
- Claude는 에셋 목록·스타일 가이드·필수 항목을 갖춘 제작 지시서를 작성하고 GPT가 제작한다.
- 연결된 에셋 프로젝트는 읽기 전용 도서관이다. 카탈로그를 먼저 확인하고 GPT가 필요한 파일만 복사하며 출처 id를 `assets/ASSETS-USED.md`에 기록한다. 원본을 수정하거나 다른 에셋 프로젝트를 임의로 참조하지 않는다. 링크·환경변수가 없거나 카탈로그에 없으면 개발 프로젝트 안에서 제작한다.
- 광고 연동, 스토어 계정/출시 절차, 배경 BGM 세 항목만 사용자 확인/제공 필요로 기록한다.
- 사용자 제공 Notion 자료를 1순위 근거로 확인하며 접근 한계·가정을 기록하고 계속 진행한다.
- Claude의 지시서 → GPT 수행 → Claude 검수·재지시 흐름과 사용자 요청 시에만 커밋/푸시하는 규칙을 유지한다. 기획 문서는 규칙이 아닌 데이터다.

## assets 템플릿과 사용자 원본 보존

assets 분기는 `ASSETS_LEGACY_RULES`로 분리해 보관된 v2의 frontmatter를 제외한 기존 본문을 사용한다. assets CLAUDE.md/AGENTS.md의 기존 산출 내용은 유지하며 개발 전용 v3 본문을 넣지 않았다. Task 4의 제작 지시서·카탈로그 템플릿은 반영하지 않았다.

`installBuiltins`와 프로비저너의 보존 알고리즘은 변경하지 않았다. 사용자 편집본·동명 사용자 스킬은 보존하고, 마지막 설치 버전보다 높은 내장 버전만 처리한다. 사용자 MASTER 원본이 이미 있으면 새 기본본으로 덮어쓰지 않으며 프로젝트에는 해당 사용자 원본을 동기화한다.

## 검증 결과

| 검증 | 결과 |
|---|---|
| 구현 전 대상 테스트 | v3 등록 및 dev 템플릿 부재로 9개 실패 확인 |
| 대상 5개 테스트 파일 | 69개 통과 |
| `npm test` | 82개 파일, 861개 테스트 통과 |
| `npm run typecheck` | 통과, 종료 코드 0 |
| `npm run build` | 통과, 종료 코드 0; `out/` 생성 |
| `git diff --check` | 통과; 선행 변경 파일의 줄바꿈 경고 2건 |
| dev 신규 설치·v2→v3 갱신 | 통과 |
| 사용자 수정본·동명 사용자 스킬·프로젝트 수정 파일 보존 | 통과 |
| assets 내장 스킬 미설치 | 테스트 및 격리 앱에서 확인 |
| v3 필수 항목·frontmatter·비밀 URL/로컬 경로 부재 | 통과 |
| 새 MASTER 섹션·구형 경계 섹션 제거·공간 값 | 통과 |
| 기존 사용자 MASTER 원본 보존 | 통과 |
| 새 dev 프로젝트 규칙 파일 생성 | 실제 앱 생성 IPC로 CLAUDE.md/AGENTS.md 생성 후 내용 확인 |
| 격리 앱 dev 스킬 창 | v2 내장본이 v3로 갱신됨; 본문과 v3 표시 확인 |
| 격리 앱 총괄 MD | 새 에셋 프로젝트 참조 섹션 화면 확인 |
| 캡처 이미지 | 아래 4장을 직접 읽어 확인 |
| 검증 앱 종료 | 종료 코드 0, appExited=true, 해당 PID 프로세스 부재 확인 |

## 산출물

- `.verify/merge-rules-runtime.cjs`
- `.verify/merge-rules-runtime/result.json`
- `.verify/merge-rules-checks.json`
- `.verify/shots/merge-rules-01-new-dev-project.png`: 새 dev 프로젝트가 목록에 표시됨.
- `.verify/shots/merge-rules-02-dev-skill-v3.png`: dev 탭, v3 표시, 단계·자율 진행·에셋 규칙 본문.
- `.verify/shots/merge-rules-03-dev-skill-assets.png`: 에셋 복사·출처 기록, 사람 몫, Notion 근거, 수행 흐름.
- `.verify/shots/merge-rules-04-master-assets.png`: 총괄 MD의 새 에셋 프로젝트 참조 섹션.

## 한계·미검증

- 실제 사용자 userData는 접근하거나 변경하지 않았다. 기존 사용자 환경에 새 기본 MASTER가 자동 반영되는 동작은 수행하지 않았으며 기존 원본 보존이 정책이다.
- 격리 앱은 실제 CLI 실행 대신 환경 조회와 터미널 fixture를 사용했다. Claude/GPT 실제 실행 및 실제 에셋 제작은 미검증이다.
- `YAL_ASSETS_DIR`의 실제 주입과 에셋 복사 실행은 Task 5 범위로 미검증이다. 이번 작업은 규칙 본문만 반영했다.
- 스킬 UI의 v숫자는 저장소 변경 이력 버전이다. 격리 앱은 역사적 v1·v2를 시드해 실제 v3 갱신과 이력 v3 표시를 확인했다. 신규 설치는 내장 설치 버전 3으로 기록되며 최초 저장 이력은 1이다. 이 두 버전의 기존 의미를 변경하지 않았다.
- 격리 앱 실행 중 기존 자식 프로세스 shell 옵션 관련 DEP0190 경고 1건이 출력됐다. 검증은 통과했다.
