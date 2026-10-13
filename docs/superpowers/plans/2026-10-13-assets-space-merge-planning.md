# 에셋 공간 전환 및 기획-개발 병합 구현 계획

> **실행 방식(이 저장소 규칙):** Claude가 각 Task를 지시서로 작성해 `scripts/gpt.sh - < 지시서`로 GPT(수행자)에게 전달하고, 결과를 diff·테스트·캡처로 검수한 뒤 필요하면 재지시한다. GPT는 위임·질문·제안 없이 끝까지 수행한다. Claude는 코드를 직접 쓰지 않는다. 커밋·푸시는 사용자가 요청할 때만 한다. 단계(Task)는 순서대로 진행하며 앞 단계의 테스트·빌드가 통과해야 다음 단계로 간다.

**Goal:** '기획' 공간을 GPT 에셋 제작 공간(`assets`)으로 바꾸고, 기획→설계→개발을 개발 프로젝트 하나에서 수행하게 한다. 개발은 에셋을 복사해서 쓴다.

**Architecture:** 동기화 장치 제거 → `planning`을 `assets`로 정식 이름 변경(데이터 마이그레이션 포함) → 기획 스킬/마스터 규칙을 dev로 병합 → 에셋 규칙·카탈로그 신설 → 개발의 에셋 연결·복사 규칙. 단계마다 독립적으로 테스트·빌드가 통과한다.

**Tech Stack:** Electron, electron-vite, React 19, TypeScript, vitest, node-pty. 테스트 `npm test`, 타입 `npm run typecheck`, 빌드 `npm run build`.

**Spec:** `docs/superpowers/specs/2026-10-13-assets-space-merge-planning-design.md`

## Global Constraints
- GPT 모델은 `gpt-6.1-sol` 고정(`scripts/gpt.sh`가 강제).
- 사용자 데이터(레지스트리, 스킬 저장소, 사용자가 수정한 스킬/MD)는 **어떤 경우에도 삭제·덮어쓰기하지 않는다**. 변환 전에 백업 복사를 만든다.
- 에셋 프로젝트·기획 폴더의 파일은 IDE가 지우지 않는다(IDE가 만든 마커 확인된 관리 파일만 정리).
- kind 값: `'assets' | 'dev' | 'manage'`. 링크 필드: `linkedAssetsId`. 스킬 공간 값: `'assets' | 'dev' | 'manage'`.
- 사용자 지정 MASTER.md 원본 경로 설정과 Notion 주소·로컬 설정 경로는 보고서/코드/문서에 쓰지 않는다.
- 기획 자율 진행 원칙 유지: "혼자 못한다" 금지, 에셋은 GPT, 사람 몫은 광고 연동·스토어 출시 절차·BGM뿐, Notion 자료 1순위.
- ko/en 모두 i18n 문구를 둔다(`src/shared/i18n.ts`, `tests/i18n.test.ts` 통과).
- 기존 기능(새로고침 버튼, GPT 로그 시각, 상태 표시, ESC 복원, GPT 워커 가드)은 깨지 않는다.

## Review Focus
1. 기존 `projects.json`에 `kind: 'planning'`과 `linkedPlanningId`가 남아 있어도 로드 시 `assets`/`linkedAssetsId`로 변환되고 원본 파일은 백업된다(손상된 JSON은 기존처럼 `.corrupt-*`로 보존).
2. `spaces/planning/skills`에 사용자가 수정한 `yal-game-planning`이 있으면 dev에서 덮어쓰지 않고 `yal-game-planning-planning-legacy`로 보존된다. 내장본과 같은 것은 dev의 v3로 대체된다.
3. 이미 프로젝트 안에 생성돼 있는 `.claude/yal-planning-changes.md`, `.claude/yal-planning-link.md`는 IDE 마커가 확인될 때만 정리되고, 사용자 파일은 그대로 남는다.
4. 에셋 프로젝트가 없거나 경로가 사라진 상태에서 개발 프로젝트를 열어도 터미널이 정상 시작된다(`--add-dir` 생략).
5. 설정 창·스킬 창·프로젝트 목록·개발 헤더에 "기획(planning)" 문구가 남아 에셋과 혼동되지 않는다.

---

## Task 0: 유령 GPT 실행 판정 수정 (알림이 "GPT 작업중"에 막히는 문제)
**배경(실측):** 관리 공간 로그에 `start` 48개/`end` 38개. GPT가 검증용 가짜 마커 줄을 화면에 출력해 실제 로그에 섞이면 `GptLogWatcher`가 줄 모양만으로 시작 마커로 믿어 `outstanding`이 남고, `isGptRunning`(30분 mtime 창)이 참이 되어 "GPT 작업중" 표시와 완료 알림 보류가 발생한다.

**Files:**
- Modify: `scripts/gpt.sh`(+`src/main/templates.ts` 템플릿·알려진 이전 버전 등록), `src/main/gptLogWatcher.ts`, `src/shared/gptLogParser.ts`, `src/renderer/src/sound/notifyRules.ts`(필요 시), `tests/gptLogWatcher*.test.ts`·`tests/gptScript.test.ts`·`tests/gptLogParser*.test.ts`·`tests/rendererActivity.test.ts`

**Interfaces:**
- 마커 형식: `=== [YAL-GPT] start <ISO> model=<m> run=<id> ===` / `end <ISO> exit=<n> run=<id>` / `order ... `. `<id>`는 gpt.sh가 실행마다 만든 비공개 난수(`[0-9a-f]{12,}`)이며 환경변수로 export하지 않는다(GPT가 읽지 못함).
- Watcher: `outstanding`을 run id 기준 집합으로 관리. `end`는 같은 id만 제거, 이미 끝난 id의 `start`가 다시 나타나도 되살리지 않는다(최근 N개 ended id 기억). id 없는 구형 마커는 "구형" 취급 — 같은 로그에 id 있는 마커가 한 번이라도 있으면 구형 start는 무시, id 마커가 없는 오래된 로그만 기존 규칙을 따르되 start 뒤에 일정 시간 아무 출력이 없으면 실행 중으로 보지 않는다.
- 파서(`parseGptLog`)는 id가 있는 마커와 구형 마커를 모두 읽는다(과거 로그 호환).

- [ ] 실패 테스트: (a) `start` 줄을 일반 출력으로 에코해도(id 없음 또는 모르는 id) 실행 중이 되지 않는다 (b) 실제 시작→끝 한 쌍 후 outstanding이 0이다 (c) 같은 id의 start 중복이 한 번만 센다 (d) 끝난 id의 start가 에코돼도 되살아나지 않는다 (e) 실제 로그 사본(`yal-ide-manage.log` 끝 부분을 .verify에 복사해 사용, 저장소에는 넣지 않는다)을 읽혀 outstanding==0 (f) 구형 스크립트 마커만 있는 로그에서 기존 동작 유지.
- [ ] `scripts/gpt.sh`와 템플릿에 run id 생성·마커 추가, 알려진 이전 버전 등록으로 기존 프로젝트 자동 업그레이드(사용자 수정본은 `gptCustomized` 안내 유지).
- [ ] 알림 규칙 확인: 유령이 아닌 진짜 실행 중에만 완료 알림이 보류되고, 끝나면 3초 유예 후 재생된다. 실제 Claude 질문 대기(Stop→done) 상황이 알림으로 이어지는지 `notifyRules` 테스트로 확인한다.
- [ ] `npm test`, `npm run typecheck`, `npm run build` 통과. 격리 앱에서 "유령 start 에코 → 라벨이 GPT 작업중이 아님" 캡처 `.verify/shots/ghost-*.png`.

---

## Task 1: 기획↔개발 동기화 장치 제거
**Files:**
- Delete: `src/main/planningSync.ts`, `src/main/planningSyncHandlers.ts`, `src/main/planningSyncIpc.ts`, `src/renderer/src/usePlanningSync.ts`, `src/renderer/src/planningSyncState.ts`
- Delete tests: `tests/planningSync.test.ts`, `tests/planningSyncHandlers.test.ts`, `tests/planningSyncState.test.ts`, `tests/rendererPlanningSync.test.ts`
- Modify: `src/main/index.ts`(planningSync 인스턴스·핸들러·`syncPlanningLinks` 호출·IPC 등록·정리 코드), `src/main/masterDoc.ts`(`syncPlanningLinks`·기획 변경 파일 동기화 제거, 마스터 동기화는 유지), `src/preload/index.ts`, `src/renderer/src/env.d.ts`, `src/shared/types.ts`(IPC 키 `planningSyncStatus|planningApply|planningMarkSynced|planningSetBaseline`, 관련 View 타입), `src/renderer/src/App.tsx`·`components/ProjectList.tsx`(배지·반영 완료 버튼·동기화 상태 사용 제거), `src/renderer/src/styles.css`, `src/shared/i18n.ts`(동기화 문구), `tests/masterDoc.test.ts`, `tests/projectPreload.test.ts`, `tests/projectMain.test.ts`, `tests/rendererProjects.test.ts`, `tests/rendererSidebar.test.ts`

**Interfaces:**
- Produces: 링크 선택(`setLinkedPlanning`)과 `--add-dir` 참조는 이 Task에서는 **유지**한다(Task 2에서 이름 변경). 동기화 관련 IPC·UI·파일 생성만 사라진다.

- [ ] 실패 테스트 먼저: `tests/masterDoc.test.ts`에 "동기화 후 `.claude/yal-planning-changes.md`가 생성되지 않는다", `tests/projectPreload.test.ts`에 "preload에 planningApply 등이 노출되지 않는다"를 추가해 실패를 확인한다.
- [ ] 위 파일 삭제·수정. `.claude/yal-planning-changes.md`와 `.claude/yal-planning-link.md`는 `.yal-managed` 마커가 있고 해시가 일치할 때만 `masterDoc.ts`의 정리 함수 `removeManagedPlanningFiles(projectPath)`로 지운다(마커 없는 파일은 보존, 심볼릭 링크 거부는 기존 `rejectSymbolic` 재사용).
- [ ] `npm test`, `npm run typecheck`, `npm run build` 통과 확인.
- [ ] 완료 조건: 코드에 `planningSync`, `usePlanningSync`, `planningApply`, `planningMarkSynced`, `planningSetBaseline`, `yal-planning-changes` 문자열이 정리 함수·마이그레이션 주석 외에 남지 않는다(`grep` 확인).

## Task 2: `planning` → `assets` 이름 변경과 데이터 마이그레이션
**Files:**
- Create: `src/main/assetsMigration.ts`, `tests/assetsMigration.test.ts`
- Modify: `src/shared/types.ts`(`ProjectKind = 'assets' | 'dev' | 'manage'`, `linkedPlanningId`→`linkedAssetsId`, `setLinkedPlanning`→`setLinkedAssets`, IPC `setLinkedAssets: 'projects:set-linked-assets'`), `src/main/projectRegistry.ts`, `src/main/spaces.ts`, `src/main/skillsRuntime.ts`, `src/main/skillsSetup.ts`, `src/main/skillSync.ts`, `src/main/manageSpace.ts`(보호 경로 `spaces/assets`·`spaces/planning-migrated` 포함), `src/main/templates.ts`, `src/main/index.ts`, `src/preload/index.ts`, `src/renderer/src/env.d.ts`, `src/renderer/src/App.tsx`, `components/ProjectList.tsx`, `components/SkillsWindow.tsx`, `projectListState.ts`, `styles.css`, `src/shared/i18n.ts`(공간 이름 "기획"→"에셋"/"Assets"), `tools/yal-skill.cjs`(허용 `YAL_SPACE` 값), 관련 기존 테스트 일괄.

**Interfaces:**
- Produces (`src/main/assetsMigration.ts`):
```ts
export interface MigrationReport { registryConverted: number; linksConverted: number; skillsMoved: string[]; skillsConflict: string[]; backupDir: string | null; errors: string[] }
export function migrateRegistryFile(file: string): { converted: number; links: number; backup: string | null }
export function migrateSkillSpaces(userData: string): MigrationReport // planning→dev 병합, 폴더는 spaces/planning-migrated로 이름 변경
```
- `ProjectRegistry.load()`는 `kind === 'planning'`을 `'assets'`로, `linkedPlanningId`를 `linkedAssetsId`로 읽는다(파일은 첫 저장 시 새 형식으로 기록).

- [ ] 실패 테스트 작성(`tests/assetsMigration.test.ts`): (a) 구형 `projects.json`(planning 2개, dev에 `linkedPlanningId`)을 로드하면 kind/링크가 변환되고 `projects.json.bak-<ts>`가 만들어진다. (b) 변환이 멱등이다. (c) `spaces/planning/skills`에 내장 동일본·사용자 수정본·다른 이름 스킬이 있을 때 dev로 병합 결과가 §5 규칙과 같다(동일 이름 시 dev 유지, 수정본은 `<이름>-planning-legacy`). (d) 실패(권한 오류 시뮬레이션) 시 원본 폴더가 그대로다. (e) 손상 JSON은 `.corrupt-*`로 보존.
- [ ] 구현: 마이그레이션은 앱 시작 시 레지스트리 생성 전과 `startSkillsSystem` 전에 1회 호출한다(`src/main/index.ts`). 결과 보고(`MigrationReport`)를 콘솔 로그와 `userData/migration-assets.json`에 남긴다(경로 외 비밀 없음).
- [ ] 이름 변경 후 `ProjectKind`가 컴파일 오류로 모든 사용처를 드러내므로 `npm run typecheck`가 0이 될 때까지 수정한다. UI 문구는 ko "에셋"/en "Assets", 목록 제목·스킬 창 탭·설정·알림 문구 확인.
- [ ] `npm test`, `npm run typecheck`, `npm run build` 통과. `grep -rn "'planning'" src`에 마이그레이션 코드 외 남지 않는다.

## Task 3: 스킬·마스터 규칙을 dev로 병합
**Files:**
- Rename/Modify: `src/main/skills/builtin/yal-game-planning.md`(v3: dev용으로 재작성), `yal-game-planning-v1.txt`/v2 원문 보관(`yal-game-planning-v2.txt`로 이전해 `previousContent` 체인 유지)
- Create: `src/main/skills/builtin/yal-game-design-criteria.md`가 이미 사용자 환경에 있으면 내장하지 말고 **건드리지 않는다**(사용자 스킬이므로 Task 2의 병합만 적용). 내장 목록에는 `yal-game-planning` v3만 추가.
- Modify: `src/main/skillsSetup.ts`(`BUILTIN_SKILLS.dev`에 `yal-game-planning` v3 추가, previousContent=v2), `src/main/master/MASTER.md`, `src/main/masterDoc.ts`(기본 시드 문구), `src/main/templates.ts`(dev 템플릿에 기획→설계→구현→검증 흐름과 `docs/planning/` 규칙, EXECUTOR 규칙 갱신), `tests/planningAutonomy.test.ts`(대상 공간을 dev로), `tests/skillsRuntime.test.ts`, `tests/provisioner.test.ts`, `tests/masterDoc.test.ts`

**Interfaces:**
- Consumes: Task 2의 `'assets' | 'dev'` 공간 값, `migrateSkillSpaces` 결과.
- Produces: `BUILTIN_SKILLS.dev`에 `{ name: 'yal-game-planning', version: 3, content, previousContent: v2 }`. 사용자가 수정한 v2는 `installBuiltins`의 기존 "customized면 보존" 규칙을 따른다.

- [ ] 실패 테스트: dev 공간 신규 설치 시 `yal-game-planning` v3가 설치된다 / v2 내장본이던 기존 dev 스킬은 v3로 갱신된다 / 사용자 수정본은 보존된다 / dev 템플릿 CLAUDE.md가 `docs/planning/`, "에셋 프로젝트 참조·복사", "혼자 못한다 금지" 문구를 포함한다.
- [ ] v3 스킬 본문: ① 개발 프로젝트의 단계(기획→설계→구현→검증)와 각 단계 산출물 위치 ② 기획 자율 진행·Notion 1순위·에셋 규칙(Claude가 안 만들고 GPT) 유지 ③ 에셋 프로젝트 카탈로그 참조·복사·`assets/ASSETS-USED.md` 기록 규칙(§4) ④ 사람 몫은 광고 연동·스토어 출시 절차·BGM뿐.
- [ ] MASTER.md: "기획 자율 진행"을 전 개발 프로젝트 적용으로, "기획과 개발의 경계"를 "에셋 프로젝트 참조 규칙"으로 교체, `YAL_SPACE` 설명에 `assets` 반영. 사용자 원본 MASTER가 이미 있으면 기존 정책대로(사용자 수정본 보존, 새 기본본은 별도 알림) 동작하는지 테스트.
- [ ] `npm test`, `npm run typecheck`, `npm run build` 통과.

## Task 4: 에셋 공간 규칙·카탈로그
**Files:**
- Create: `src/main/skills/builtin/yal-asset-factory.md`, `src/main/assetsScaffold.ts`(에셋 프로젝트 골격 생성: `images/ sfx/ vfx/ ui/` 폴더와 `ASSETS.md` 카탈로그 초안·`README`), `tests/assetsScaffold.test.ts`
- Modify: `src/main/skillsSetup.ts`(`BUILTIN_SKILLS.assets`), `src/main/provisioner.ts`/`templates.ts`(assets 프로젝트 템플릿: CLAUDE.md, AGENTS.md, scripts/gpt.sh 프로비저닝은 기존 흐름 재사용), `src/main/projectCreation.ts`(kind assets 생성 시 골격 생성)

**Interfaces:**
- Produces: `export function scaffoldAssetsProject(path: string): { created: string[]; skipped: string[] }` — 이미 있는 파일은 건너뛴다(기존 기획 프로젝트에서 전환된 폴더에도 안전).
- 카탈로그 항목 형식(스킬·템플릿이 동일 문구 사용):
```
## <asset-id>
- 용도: / 스타일: / 포맷: / 크기: / 경로: / 태그: / 제작일: / 출처: 자체 제작(GPT)
```

- [ ] 실패 테스트: 골격 생성은 멱등이며 기존 파일을 덮어쓰지 않는다 / assets 프로젝트 CLAUDE.md에 "Claude는 에셋을 직접 만들지 않는다, 제작 지시서→GPT→검수" 규칙이 포함된다 / assets 공간 내장 스킬이 설치된다.
- [ ] 스킬 본문: 지시서 필수 항목(용도, 스타일, 크기/포맷, 파일 경로, 수량, 완료 조건), 카탈로그 갱신 의무, 파일명 규칙 `<분류>-<이름>-<버전>.<확장자>`, 제작 가능 범위 표(Task 6에서 실제 테스트로 확정하기 전까지는 "SVG·캔버스 렌더·웹오디오 합성 SFX 가능(검증 예정), AI 일러스트 생성은 미확인"으로 명시하고 불가 시 대안·사용자 제공 필요 분리).
- [ ] 기존 기획 프로젝트에서 전환된 에셋 프로젝트를 열 때 골격이 없으면 만들되 기존 `docs/`, 파일은 건드리지 않는다.
- [ ] `npm test`, `npm run typecheck`, `npm run build` 통과.

## Task 5: 개발 프로젝트의 에셋 연결·복사 규칙
**Files:**
- Modify: `src/main/index.ts`(터미널 `argsFor`: `linkedAssetsId`가 가리키는 assets 프로젝트가 존재할 때만 `--add-dir`; 환경변수 `YAL_ASSETS_DIR` 추가), `src/main/templates.ts`(dev CLAUDE.md의 에셋 참조 문구가 `YAL_ASSETS_DIR`/`ASSETS.md`를 가리키게), `src/renderer/src/components/ProjectList.tsx`(드롭다운 라벨 "에셋 연결"), `src/shared/i18n.ts`, `tests/terminalManager.test.ts`, `tests/projectMain.test.ts`
- Create: `src/main/assetsUsageNote.ts`(개발 프로젝트에 `assets/ASSETS-USED.md` 초안을 만들어 주는 함수, 이미 있으면 건너뜀), `tests/assetsUsageNote.test.ts`

**Interfaces:**
- Produces: `export function ensureAssetsUsedNote(projectPath: string): boolean` (생성 시 true).
- Consumes: Task 2의 `linkedAssetsId`, Task 4의 카탈로그 형식.

- [ ] 실패 테스트: 링크가 없거나 대상이 삭제된 경우 `argsFor`가 `--add-dir`을 넣지 않는다 / 존재하면 정확히 한 번 넣는다 / `YAL_ASSETS_DIR`이 설정된다 / 링크 대상이 assets가 아니면 거부된다.
- [ ] 개발 프로젝트 열기 시 `ensureAssetsUsedNote` 호출(실패는 무시, 로그만). 에셋은 읽기 전용 참조임을 템플릿·스킬이 명시한다.
- [ ] `npm test`, `npm run typecheck`, `npm run build` 통과.

## Task 6: 통합 검증과 에셋 제작 가능 범위 확인
**Files:**
- Create: `docs/investigation/2026-10-13-assets-merge-report.md`, 검증 스크립트 `.verify/assets-*.{mjs,cjs}`, 캡처 `.verify/shots/assets-*.png`
- Modify: `yal-asset-factory.md`의 제작 가능 범위 표(검증 결과 반영), 관련 테스트

- [ ] 전체: `npm test`, `npm run typecheck`, `npm run build`.
- [ ] 격리 앱(별도 userData, 구형 `projects.json`·구형 `spaces/planning/skills` 시드)으로 시작해 확인·캡처: ① 탭/목록 제목이 에셋/개발/YAL_IDE 관리 ② 구형 기획 프로젝트가 에셋으로 전환되고 데이터 백업 존재 ③ 개발 프로젝트의 에셋 연결 드롭다운 ④ 스킬 창 dev에 `yal-game-planning` v3와 수정본의 `-planning-legacy` ⑤ 동기화 배지·반영 버튼 없음 ⑥ 새로고침·상태 표시 회귀 없음.
- [ ] 에셋 제작 가능 범위: `scripts/gpt.sh`로 에셋 프로젝트에서 GPT가 SVG 아이콘 1개와 웹오디오 합성 효과음 생성 스크립트/파일 1개를 만들고 `ASSETS.md`에 기록하는 흐름을 **실제 1회** 실행한다. AI 일러스트 생성 가능 여부는 가능/불가 중 확인된 사실만 표에 기록하고 모르면 "미확인"으로 둔다.
- [ ] 보고서: 변경 요약, 마이그레이션 결과, 검증 표(통과/미검증 구분), 남은 한계. Notion 주소·로컬 설정 경로·비밀값 금지.

---

## Self-Review
- **Spec 커버리지**: §2 공간 구조 → Task 2 / §3 에셋 프로젝트 → Task 4 / §4 에셋 사용 → Task 5 / §5 규칙·스킬 병합 → Task 3 + Task 2의 `migrateSkillSpaces` / §6 제거 → Task 1 / §9 검증 → Task 6. §7 비범위는 어떤 Task에도 넣지 않았다.
- **플레이스홀더**: 없음. 제작 가능 범위는 Task 6 실측 후 확정하도록 단계를 명시했다.
- **타입 일관성**: `assets`, `linkedAssetsId`, `setLinkedAssets`, `YAL_ASSETS_DIR`, `MigrationReport`, `scaffoldAssetsProject`, `ensureAssetsUsedNote`를 Task 2·4·5에서 같은 이름으로 쓴다.
- **순서 근거**: 제거(Task 1)로 이름 변경 표면을 줄이고, 이름 변경(Task 2) 이후에 새 규칙(Task 3~5)을 올린다. 각 Task는 단독으로 테스트·빌드 통과가 가능하다.
