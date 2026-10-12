# 기획/개발 공간 분리 + 총괄 MD 구현 계획

> **실행 방식 (이 저장소 규칙):** `CLAUDE.md`의 협업 규칙이 우선한다. 각 Task는 Claude가 지시서로 만들어 `scripts/gpt.sh`로 GPT(Sol)에게 위임하고, Claude는 diff·테스트·캡처로 검수한다. 단계는 체크박스로 추적한다. 커밋은 사용자가 요청할 때만 한다(계획 안의 "검수" 단계가 커밋을 대신한다).

**Goal:** 사이드바를 기획(위)/개발(아래)로 나누고, 공간별 스킬 저장소와 총괄 MD(MASTER.md)를 두며, 스킬 갱신은 사용자 승인(`--approved`) 없이는 적용되지 않게 한다.

**Architecture:** `ProjectRecord`에 `kind`/`linkedPlanningId`를 추가한다. 스킬 저장소·동기화를 `spaces/planning`, `spaces/dev`로 물리 분리하고 `kind`로 대상 프로젝트를 필터링한다. 총괄 MD는 `master/MASTER.md`에서 모든 프로젝트의 `.claude/yal-master.md`로 읽기 전용 동기화하며 CLAUDE.md가 `@` import로 읽는다.

**Tech Stack:** Electron, electron-vite, React, TypeScript, Vitest (기존 그대로)

**Spec:** `docs/superpowers/specs/2026-10-12-planning-dev-spaces-design.md`

## Global Constraints
- GPT 모델은 `gpt-6.1-sol` 고정(`scripts/gpt.sh`). 위임 후 `~/.codex/sessions`로 확인한다.
- 기존 프로젝트(`kind` 없음)는 `dev`로 동작해야 한다. 기존 `projects.json`을 깨면 안 된다.
- 기획 동기화는 `kind=dev` 프로젝트에, 개발 동기화는 `kind=planning` 프로젝트에 **파일을 하나도 쓰지 않는다**.
- 스킬 저장소 쓰기는 `tools/yal-skill.cjs`의 `--approved` 없이는 불가. MASTER.md는 도구로 수정하지 않는다.
- 기존 YAL 마커(`.yal-managed.json`) 방식, 심볼릭 링크 거부, 읽기 전용 속성 규칙을 재사용한다.
- 사용자 문구는 `src/shared/i18n.ts`에 ko/en 모두 추가한다. 새 UI에 하드코딩 문자열을 쓰지 않는다.
- `npm test`, `npm run typecheck`, `npm run build`가 모두 통과해야 한다.

## Review Focus
- 기존 `projects.json`(kind 없음) 로드 → 전부 `dev`, 저장 시 기록되고 데이터 손실 없음.
- 링크된 기획 프로젝트를 제거 → 개발 프로젝트의 링크와 `.claude/yal-planning-link.md`가 정리됨(사용자 파일은 보존).
- 사용자가 직접 만든 `CLAUDE.md`에 import 줄이 없을 때 → 한 줄만 추가, 두 번 실행해도 중복 없음, CRLF 파일도 보존.
- `userData/skills`와 `spaces/dev/skills`가 둘 다 있을 때 → 덮어쓰지 않고 `spaces/dev` 유지, 이전 폴더는 건드리지 않음.
- 개발 프로젝트 터미널에서 `YAL_SKILLS_DIR`이 기획 저장소를 가리키는 일이 없음(kind별 env).

## 파일 구조
| 파일 | 책임 |
| --- | --- |
| `src/shared/types.ts` (수정) | `ProjectKind`, `ProjectRecord.kind/linkedPlanningId`, IPC/API 추가 |
| `src/main/projectRegistry.ts` (수정) | kind 기본값, `add(path, kind)`, `setLinkedPlanning`, 대상 제거 시 링크 해제 |
| `src/main/spaces.ts` (신규) | `SkillSpace = 'planning'|'dev'`, 공간별 경로, `migrateLegacySkills(userData)` |
| `src/main/skillsRuntime.ts` (수정) | 공간별 store/sync/watch, 공간 인자를 받는 IPC |
| `src/main/skillsSetup.ts` (수정) | 공간별 내장 스킬 목록 |
| `src/main/skills/builtin/yal-game-planning.md` (신규) | 기획 스킬 내장본 |
| `src/main/masterDoc.ts` (신규) | MASTER.md 시드, 프로젝트로 동기화, 기획 링크 파일 관리 |
| `src/main/master/MASTER.md` (신규) | 총괄 MD 기본본 |
| `src/main/templates.ts` (수정) | `claudeMd(name, kind)`, import 줄 상수 |
| `src/main/provisioner.ts` (수정) | `provision(path, name, kind)`, 기존 CLAUDE.md에 import 줄 멱등 추가 |
| `src/main/projectCreation.ts` (수정) | `kind` 전달 |
| `src/main/index.ts` (수정) | kind별 env, IPC 연결, 링크 IPC |
| `tools/yal-skill.cjs` (수정) | `--approved` 게이트 |
| `src/renderer/src/components/ProjectList.tsx` (수정) | 상하 분할, 구역별 생성/목록, 링크 선택 |
| `src/renderer/src/components/SkillsWindow.tsx` (수정) | 공간 탭 + 총괄 MD 보기 |
| `src/shared/i18n.ts` (수정) | 새 문구 ko/en |

---

### Task 1: 도구 게이트 (`--approved`)

**Files:**
- Modify: `tools/yal-skill.cjs` (`runCli`의 set/remove 분기, Usage 문구)
- Modify: `tests/skillStore.test.ts`, `tests/skillRetention.test.ts`, `tests/skillsRuntime.test.ts` (기존 CLI `set` 호출에 `--approved` 추가)
- Test: `tests/skillGate.test.ts` (신규)

**Interfaces:**
- Produces: CLI `set|remove`는 `--approved` 플래그(값 없음) 필수. 없으면 종료 코드 1, stderr에 `Skill changes require user approval. Ask the user whether to update the skill, then rerun with --approved.` 포함.

- [ ] **Step 1: 실패 테스트 작성** — `tests/skillGate.test.ts`: `YAL_SKILLS_DIR`을 임시 폴더로 두고 `node tools/yal-skill.cjs set demo --file f --summary s`를 실행하면 `status !== 0`이고 stderr에 `require user approval`, 저장소에 `demo` 폴더 없음. `--approved`를 붙이면 `status === 0`. `remove demo --summary s`도 동일. `list`/`show`/`log`는 `--approved` 없이 통과.
- [ ] **Step 2: 실패 확인** — `npx vitest run tests/skillGate.test.ts` → FAIL
- [ ] **Step 3: 구현** — `runCli`의 set/remove 분기 맨 앞에서 `rest.includes('--approved')` 검사 후 위 메시지로 throw. Usage 문구에 `--approved` 추가. 플래그 값 파서(`option`)가 `--approved`를 값으로 오인하지 않는지 확인.
- [ ] **Step 4: 기존 테스트 보정** — 위 3개 테스트 파일의 CLI `set` 호출에 `--approved` 추가.
- [ ] **Step 5: 통과 확인** — `npx vitest run tests/skillGate.test.ts tests/skillStore.test.ts tests/skillRetention.test.ts tests/skillsRuntime.test.ts` → PASS
- [ ] **Step 6: 검수** — Claude가 diff 확인.

---

### Task 2: 프로젝트 모델 (kind / 링크)

**Files:**
- Modify: `src/shared/types.ts`, `src/main/projectRegistry.ts`, `src/main/projectCreation.ts`
- Test: `tests/projectRegistry.test.ts`, `tests/projectCreation.test.ts` (확장)

**Interfaces:**
- Produces:
```ts
export type ProjectKind = 'planning' | 'dev'
// ProjectRecord: kind?: ProjectKind (읽을 때 없으면 'dev'), linkedPlanningId?: string
// ProjectView: kind: ProjectKind (항상 채워서 반환)
ProjectRegistry.add(path: string, kind?: ProjectKind): ProjectRecord   // 기본 'dev'
ProjectRegistry.setLinkedPlanning(devId: string, planningId: string | null): void
// 대상이 없거나 kind 불일치면 throw (ProjectNotFoundError / Error('Invalid link'))
// remove(planningId) 시 그것을 가리키는 모든 linkedPlanningId를 제거한다
createProject(deps, root, name, kind?: ProjectKind)  // deps.registry.add(path, kind), deps.provision(path, name, kind)
```

- [ ] **Step 1: 실패 테스트** — (a) kind 없는 JSON 로드 → `list()` 전부 `kind: 'dev'`. (b) `add(path,'planning')` 후 목록에 planning. (c) `setLinkedPlanning(dev, planning)` 성공 / dev→dev, planning→planning 링크는 throw / null로 해제. (d) planning 제거 시 링크 자동 해제. (e) `createProject(...,'planning')`이 provision에 kind를 전달.
- [ ] **Step 2: 실패 확인** — `npx vitest run tests/projectRegistry.test.ts tests/projectCreation.test.ts`
- [ ] **Step 3: 구현** — 위 인터페이스대로. `isRecord`는 kind가 있으면 두 값 중 하나인지 검증하고 아니면 `dev`로 간주.
- [ ] **Step 4: 통과 확인** — 같은 명령 PASS, `npm run typecheck`
- [ ] **Step 5: 검수**

---

### Task 3: 공간 분리 스킬 저장소 + 마이그레이션

**Files:**
- Create: `src/main/spaces.ts`, `src/main/skills/builtin/yal-game-planning.md`
- Modify: `src/main/skillsRuntime.ts`, `src/main/skillsSetup.ts`, `src/shared/skills.ts`, `src/preload/index.ts`, `src/renderer/src/env.d.ts`
- Test: `tests/spaces.test.ts` (신규), `tests/skillsRuntime.test.ts`, `tests/skillsPreload.test.ts` (확장)

**Interfaces:**
- Produces:
```ts
// spaces.ts
export type SkillSpace = 'planning' | 'dev'
export const spaceOf = (kind: ProjectKind): SkillSpace => kind   // 이름 일치
export function spaceDir(userData: string, space: SkillSpace): string   // <userData>/spaces/<space>/skills
export function migrateLegacySkills(userData: string): { moved: boolean }
// skillsRuntime
startSkillsSystem(userData, projects: () => {path:string; kind: ProjectKind}[], mainWindow, language)
  -> { stores: Record<SkillSpace, SkillStore>, toolPath, resync(): void, schedule(): void, close(): void }
// SKILLS_IPC 호출은 마지막/첫 인자에 space: SkillSpace를 받는다 (list/get/history/readVersion/log/syncStatus)
```
- 내장 스킬: dev = `yal-mobile-web-game`만. planning = `yal-game-planning`(기획서 구조, 용어·수치 표기, 개발 이관 시 읽기 전용 참조라는 점). `yal-collaboration`은 더 이상 설치하지 않는다(Task 4의 MASTER로 이동). 기존 dev 저장소에 이미 설치된 `yal-collaboration`은 **삭제하지 않고 그대로 둔다**.

- [ ] **Step 1: 실패 테스트** — (a) `migrateLegacySkills`: `userData/skills`만 있으면 `spaces/dev/skills`로 이동, 이미 `spaces/dev/skills`가 있으면 아무것도 하지 않음, 두 번 호출해도 안전. (b) 런타임: planning 스킬을 planning store에 쓰면 dev 프로젝트의 `.claude/skills`에 아무 파일도 생기지 않고 planning 프로젝트에만 생김, 그 반대도 동일. (c) 각 공간 watcher가 자기 폴더 변경만 sync 예약.
- [ ] **Step 2: 실패 확인**
- [ ] **Step 3: 구현** — `SkillSync.sync(projects)`는 호출부에서 `kind`로 필터링해 넘긴다(클래스는 그대로). `appliedProjects`도 공간의 프로젝트 목록 기준.
- [ ] **Step 4: 통과 확인** — `npx vitest run tests/spaces.test.ts tests/skillsRuntime.test.ts tests/skillsPreload.test.ts tests/skillSync.test.ts`
- [ ] **Step 5: 검수**

---

### Task 4: 총괄 MD + 기획 링크 파일 + CLAUDE.md 템플릿

**Files:**
- Create: `src/main/masterDoc.ts`, `src/main/master/MASTER.md`
- Modify: `src/main/templates.ts`, `src/main/provisioner.ts`, `src/main/raw.d.ts`(필요 시)
- Test: `tests/masterDoc.test.ts` (신규), `tests/provisioner.test.ts` (확장)

**Interfaces:**
- Produces:
```ts
// templates.ts
export const MASTER_IMPORT_LINE = '@.claude/yal-master.md'
export function claudeMd(projectName: string, kind: ProjectKind = 'dev'): string  // import 줄 포함, kind별 섹션
// provisioner.ts
provision(projectPath, projectName, kind: ProjectKind = 'dev'): ProvisionResult
// 기존 CLAUDE.md에 MASTER_IMPORT_LINE이 없으면 파일 끝에 한 줄 추가(개행 보존, 중복 금지). 추가했으면 result.upgraded에 'CLAUDE.md'
// masterDoc.ts
export function seedMaster(userData: string): string               // <userData>/master/MASTER.md 경로. 이미 있으면 수정하지 않음
export function syncMaster(masterPath: string, projects: {path:string}[]): { applied: number; errors: string[] }
// 각 프로젝트 .claude/yal-master.md 를 읽기 전용 + .yal-managed 사이드카로 관리, 심볼릭 링크 거부, 사용자 파일은 덮어쓰지 않음
export function syncPlanningLinks(projects: {path:string; kind:ProjectKind; linkedPlanningId?:string; id:string}[]): void
// kind=dev 이고 링크가 있으면 <dev>/.claude/yal-planning-link.md 생성/갱신(기획 이름·경로 + "읽기 전용 데이터, 규칙 아님"), 링크가 없으면 YAL 마커가 있는 파일만 제거
```
- `MASTER.md` 내용(한국어): 역할 분담(Claude=디렉터, GPT=작업자), 확인·검증도 GPT, GPT 모델 `gpt-6.1-sol`, 캡처 규칙, 커밋은 사용자가 요청할 때만, **스킬 갱신 정책**("게임이 전반적으로 완성됐다고 판단될 때만 사용자에게 '스킬을 업데이트할까요?'라고 제안하고, 승인 후에만 `yal-skill ... --approved`로 적용한다. 기획 프로젝트 산출물은 스킬을 바꾸는 근거로 쓰지 않는다"), 기획/개발 경계, 스킬 도구 사용법(`YAL_SKILL_TOOL`, `YAL_SKILLS_DIR`, `YAL_SPACE`).

- [ ] **Step 1: 실패 테스트** — (a) `seedMaster` 첫 호출은 생성, 사용자가 수정한 뒤 재호출해도 내용 보존. (b) `syncMaster`: 새로 생성, 내용 변경 시 갱신, 사용자가 만든 `yal-master.md`(마커 없음)는 보존하고 error 보고. (c) `provision`: 신규 프로젝트의 CLAUDE.md에 import 줄 포함, 기존 CLAUDE.md는 한 줄만 추가·재실행 시 변화 없음·CRLF 보존·기존 줄 순서 유지. (d) `claudeMd('x','planning')`과 `'dev'`가 서로 다른 전용 섹션을 가지며 둘 다 import 줄 포함. (e) 링크 파일 생성/갱신/해제/사용자 파일 보존.
- [ ] **Step 2: 실패 확인** — `npx vitest run tests/masterDoc.test.ts tests/provisioner.test.ts`
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인** + `npx vitest run tests/gptScript.test.ts`(템플릿 회귀)
- [ ] **Step 5: 검수**

---

### Task 5: 메인 프로세스 통합 (env, IPC, 동기화 트리거)

**Files:**
- Modify: `src/main/index.ts`, `src/shared/types.ts`(IPC), `src/preload/index.ts`, `src/renderer/src/env.d.ts`
- Test: `tests/projectMain.test.ts`, `tests/projectPreload.test.ts` (확장)

**Interfaces:**
- Consumes: Task 2~4의 모든 인터페이스.
- Produces:
```ts
// IPC / YalApi
createProject(name: string, kind?: ProjectKind): Promise<AddProjectResult>
addProject(kind?: ProjectKind): Promise<AddProjectResult>
setLinkedPlanning(devId: string, planningId: string | null): Promise<ProjectView[]>
openMaster(): Promise<void>            // MASTER.md를 shell.openPath로 연다
readMaster(): Promise<string>          // 읽기 전용 보기용
```
- 터미널 env: `YAL_SPACE=<kind>`, `YAL_SKILLS_DIR=<해당 공간 저장소>`, `YAL_SKILL_TOOL`, 그리고 기존 값.
- 프로젝트 추가/생성/제거/링크 변경/MASTER 변경 시 `resync()` + `syncMaster` + `syncPlanningLinks` 호출. 시작 시 `migrateLegacySkills` → `seedMaster` → 기존 프로젝트 provision(import 줄 보강) 순서.

- [ ] **Step 1: 실패 테스트** — preload가 새 메서드를 노출하고 허용 채널만 사용. 메인: kind별 env가 올바른 저장소를 가리킴(기획 프로젝트 터미널의 `YAL_SKILLS_DIR`이 `spaces/planning/skills`).
- [ ] **Step 2: 실패 확인**
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인** — `npm test`, `npm run typecheck`
- [ ] **Step 5: 검수**

---

### Task 6: 렌더러 UI (사이드바 분할, 링크, 스킬 창)

**Files:**
- Modify: `src/renderer/src/components/ProjectList.tsx`, `SkillsWindow.tsx`, `skills.css`, `src/renderer/src/styles.css`, `src/renderer/src/App.tsx`, `src/renderer/src/projectListState.ts`, `src/renderer/src/skillsState.ts`, `src/shared/i18n.ts`
- Test: `tests/rendererProjects.test.ts`, `tests/rendererSkills.test.ts`, `tests/i18n.test.ts` (확장)

**Interfaces:**
- Produces: `splitByKind<T extends {kind: ProjectKind}>(projects: T[]): { planning: T[]; dev: T[] }` (`projectListState.ts`, 각 구역에서 기존 `orderProjects`/핀 규칙 유지).
- UI: 사이드바 위 **기획** 구역(헤더 + 새 기획 프로젝트 `+`), 아래 **개발** 구역(기존 `+` 메뉴). 각 구역 독립 스크롤, 고정 비율. 개발 프로젝트 항목에 기획 링크 선택(드롭다운: 없음 + 기획 프로젝트 목록)과 링크 표시. 스킬 창: 기획/개발 탭, 총괄 MD 읽기 전용 보기 + "파일 열기" 버튼.

- [ ] **Step 1: 실패 테스트** — `splitByKind`가 순서·핀을 보존, 렌더 시 두 구역이 분리되어 표시, 링크 선택이 `setLinkedPlanning`을 호출, 스킬 탭 전환이 해당 공간의 목록만 표시, i18n 키가 ko/en 모두 존재.
- [ ] **Step 2: 실패 확인**
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인** — `npm test`
- [ ] **Step 5: 검수**

---

### Task 7: 통합 검증 (GPT가 캡처 생성, Claude가 판단)

**Files:** 코드 변경 없음(문제 발견 시 해당 Task로 회귀).

- [ ] **Step 1:** `npm test`, `npm run typecheck`, `npm run build` 전부 통과 확인(GPT 실행·보고).
- [ ] **Step 2:** GPT가 빌드 결과를 `npx electron . --remote-debugging-port=<port>`로 띄우고 CDP로 캡처 저장: ① 빈 상태 사이드바, ② 기획 프로젝트 1개 + 개발 프로젝트 1개 생성 후 사이드바, ③ 개발 프로젝트에 기획 링크 지정 후, ④ 스킬 창 기획/개발 탭, ⑤ 총괄 MD 보기.
- [ ] **Step 3:** GPT가 파일 시스템 사실 확인 보고: 기획 프로젝트 `.claude/skills`에 `yal-game-planning`만, 개발 프로젝트에 `yal-mobile-web-game`만, 두 프로젝트 모두 `.claude/yal-master.md`와 CLAUDE.md import 줄, 개발 프로젝트에만 `.claude/yal-planning-link.md`.
- [ ] **Step 4:** GPT가 개발 터미널 환경에서 `node "$YAL_SKILL_TOOL" set ...`(승인 플래그 없이) 실행 → 거부 확인.
- [ ] **Step 5:** Claude가 캡처 이미지를 읽고 판단, 문제 시 수정 지시서.
- [ ] **Step 6:** 세션 기록(`~/.codex/sessions`)에서 사용 모델이 `gpt-6.1-sol`인지 확인.

---

## 자체 점검 결과
- 스펙 §1→Task 2, §2→Task 3, §3→Task 4, §4→Task 4·5, §5→Task 1·5, §6→Task 6, §8 테스트→각 Task. 빠진 항목 없음.
- 타입 일관성: `ProjectKind`, `SkillSpace`, `MASTER_IMPORT_LINE`, `setLinkedPlanning` 이름을 전 Task에서 동일하게 사용.
- 의도적 변경: `yal-collaboration` 내장 스킬은 신규 설치 중단(MASTER로 이동). 이미 설치된 사본은 보존.
