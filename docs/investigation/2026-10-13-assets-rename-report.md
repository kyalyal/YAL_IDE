# Task 2 — 에셋 공간 이름 변경 및 데이터 마이그레이션 결과

작성일: 2026-10-13

## 변경 결과

- `ProjectKind`와 `SkillSpace`는 `assets | dev | manage`로 변경했다.
- 프로젝트 링크 필드·API·IPC를 `linkedAssetsId`, `setLinkedAssets`, `projects:set-linked-assets`로 변경했다. 개발 프로젝트의 연결 대상은 에셋 프로젝트로 제한된다.
- 목록·공간 탭·스킬 창·관리 설정 안내와 연결 드롭다운 문구를 변경했다. 연결 드롭다운에는 보이는 라벨과 접근성 라벨 모두 한국어 `에셋 연결`, 영어 `Assets link`를 적용했다.
- `src/main/assetsMigration.ts`를 추가했다. 앱 시작 시 레지스트리 생성과 스킬 시스템 시작보다 먼저 실행한다. `ProjectRegistry.load()`도 구형 종류와 링크를 방어적으로 변환한다.
- 기존 단일 스킬 저장소의 개발 공간 이동을 먼저 처리하고 기획 스킬 병합을 수행한다. 이후 `skillsRuntime`의 기존 레거시 이동 호출은 이미 처리된 저장소에 대해 변경하지 않는다.
- `BUILTIN_SKILLS.assets`는 빈 배열이다. 기존 기획 내장 파일은 유지했고, 개발 공간에 새 기획 내장 스킬을 임시 추가하지 않았다.
- 에셋 템플릿 선택과 사용자 수정 문서·스킬 보존 조건은 `assets` 기준으로 동작한다. 템플릿 제목은 에셋 공간으로 변경했으며 규칙 본문은 이번 단계의 지시대로 유지했다.
- 관리 공간의 보호 대상에 `spaces/assets`, 레거시 원본, `spaces/planning-migrated`와 실제 존재하는 타임스탬프 보존 폴더를 포함했다.
- 스킬 도구는 지정된 `YAL_SPACE` 값 중 `assets`, `dev`, `manage`를 허용한다. `planning`은 명확한 오류와 종료 코드 1로 거부하고 저장소를 생성하지 않는다.
- 설정 저장소에는 공간별 종류·링크·스킬 공간 값이 없었다. 권한 설정은 프로젝트 ID별 값이며 변환 대상이 아니었다.

## 마이그레이션 규칙과 검증 예시

### 프로젝트 레지스트리

구형 종류는 `assets`로 바꾸고 링크 ID는 그대로 유지하면서 필드 이름만 변경한다. 변환할 항목이 있을 때만 원본 바이트를 `projects.json.bak-<ts>`에 독점 복사하고 새 파일을 원자적으로 저장한다. 이미 새 링크 필드가 있으면 해당 값을 유지한다. 두 번째 실행은 변환·백업·파일 변경이 없다.

손상 JSON 또는 배열이 아닌 JSON은 `.corrupt-<ts>` 파일로 보존한다. 레지스트리는 기존 동작대로 빈 목록으로 시작한다.

### 스킬 공간

1. 개발 공간에 동일한 이름이 없으면 스킬 폴더를 복사한다. `SKILL.md`, `meta.json`, 이력 파일을 유지한다.
2. 동일한 이름이 있고 기획 스킬이 `system` 작성자의 내장 v1/v2 원문과 같으면 건너뛴다. 비교 시 CRLF/LF만 정규화한다.
3. 그 외 동일 이름의 스킬은 `<이름>-planning-legacy`로 보존한다. 이름 충돌 시 `-2`부터 증가시킨다. 별도 이름의 현재 문서에는 해당 이름을 frontmatter에 적용하고 메타데이터와 과거 이력은 보존한다.
4. 스킬 저장소의 기존 이름 길이 제한은 40자다. 접미사를 붙이면 제한을 넘는 이름은 앞부분을 줄인다. 원본 전체 이름과 내용은 보존 폴더에 그대로 남는다.
5. 스킬 저장소 잠금과 독점 복사를 사용하며 개발 공간의 기존 스킬을 덮어쓰지 않는다. 성공 후 원래 공간은 `planning-migrated`로 이름만 변경한다. 기존 보존 폴더가 있으면 타임스탬프 접미사를 사용한다.
6. 실패하면 이번 시도에서 만든 개발 스킬 폴더를 롤백하고 원래 기획 폴더를 유지한다. 오류 코드와 경로를 보고한다. 스킬 내용·프로젝트 데이터는 오류 로그에 포함하지 않는다.

보고서는 격리 프로필의 `migration-assets.json`과 콘솔에 기록했다. 변경 없는 재실행은 최초 결과 파일을 유지한다.

격리 실행의 결과는 다음과 같다. 보존 경로는 프로필 기준 상대 경로로 표시했다.

```json
{
  "registryConverted": 2,
  "linksConverted": 1,
  "skillsMoved": [
    "unique-assets-test",
    "yal-game-design-criteria-planning-legacy"
  ],
  "skillsConflict": ["yal-game-design-criteria"],
  "backupDir": "spaces/planning-migrated",
  "errors": []
}
```

기획 공간의 내장 동일본과 충돌한 개발 `yal-game-planning`은 유지됐다. 개발 `yal-game-design-criteria`도 유지됐고 기획 수정본은 별도 이름으로 보존됐다. 고유 스킬은 원래 이름으로 복사됐다. 에셋 스킬 저장소는 비어 있었다.

## 검증 결과

| 검증 | 결과 | 근거 |
| --- | --- | --- |
| 구현 전 실패 확인 | 통과 | 구형 종류·링크 변환, 구형 도구 값 거부, 백업·병합·보호 경로의 실패 확인 후 구현 |
| 신규 마이그레이션 테스트 | 통과 | 12개: 백업, 멱등, 손상 JSON, 링크 ID 유지, v1/v2 판별, 충돌 접미사, 메타·이력, 오류·롤백·재시도, 기존 레거시 순서, 긴 이름 |
| `npm test` | 통과 | 82개 파일, 857개 테스트, 종료 코드 0 |
| `npm run typecheck` | 통과 | 종료 코드 0 |
| `npm run build` | 통과 | 종료 코드 0, `out/` 생성 |
| 구형 식별자 검색 | 통과 | `'planning'`, `linkedPlanning`, `setLinkedPlanning` 검색 결과는 `assetsMigration.ts`의 구형 데이터 처리에만 존재 |
| 격리 Electron 시작 | 통과 | 구형 프로젝트 2개·개발 링크 1개·기획 스킬 3개를 넣은 별도 프로필에서 빌드 앱 실행 |
| 한국어·영어 UI | 통과 | 에셋/개발/YAL_IDE 관리 목록·탭, 에셋 연결/Assets link 표시 |
| 개발 링크 선택·해제 | 통과 | 최초 구형 링크 유지, 해제, 다른 변환 프로젝트 선택, 최초 링크 복원 |
| 개발 스킬 UI | 통과 | 고유 병합 스킬과 수정본의 `-planning-legacy` 이름·본문 표시 |
| 디스크 보존 산출물 | 통과 | 레지스트리 백업 원본 바이트 일치, `planning-migrated`, 결과 JSON, 빈 에셋 저장소 확인 |
| 실제 OS ACL 변경 | 미검증 | 막힌 대상 파일과 복사 중 `EACCES` 주입으로 실패 경로를 검증함 |
| 실제 Claude/GPT 실행 | 미검증 | CLI 검사와 터미널 실행은 격리 검증용 대체 구현을 사용함 |
| 격리 앱 종료 | 통과 | 정상 종료 코드 0, 앱 PID 부재 확인 |
| 캡처 시각 검수 | 통과 | 아래 PNG 5장을 직접 읽어 UI·병합된 수정본 확인 |
| 직접 코드 검토 | 통과 | 종류·링크·IPC, 마이그레이션 순서·백업·롤백, 스킬 보존, 관리 보호, 문구 범위 검토. 독립 리뷰는 수행하지 않음 |

전체 검증 결과는 `.verify/assets-checks.json`, 상세 로그는 `.verify/assets-test.log`, `.verify/assets-typecheck.log`, `.verify/assets-build.log`에 저장했다. 실행 결과는 `.verify/assets-rename-runtime/result.json`, 실행 로그는 `.verify/assets-runtime.log`에 저장했다. 실행·전체 검증 스크립트는 `.verify/assets-rename-runtime.cjs`, `.verify/assets-checks.cjs`다.

캡처 산출물:

- `.verify/shots/assets-rename-01-ko-linked.png`: 한국어 목록·탭·에셋 연결 라벨과 구형 링크 유지.
- `.verify/shots/assets-rename-02-ko-unlinked.png`: 연결 해제 후 링크 없음.
- `.verify/shots/assets-rename-03-dev-skills.png`: 개발 탭과 병합된 고유 스킬.
- `.verify/shots/assets-rename-04-en-linked.png`: 영어 Assets 목록·탭과 Assets link 라벨.
- `.verify/shots/assets-rename-05-dev-legacy-skill.png`: 별도 보존된 사용자 수정 스킬의 이름과 본문.

## 유지한 문구와 남은 한계

- `src/main/templates.ts`의 기획 산출물·`docs/planning/`·기획 산출물의 스킬 승격 금지 본문은 지시대로 유지했다. 에셋 규칙 본문 재작성은 이번 산출물에 포함하지 않았다.
- `src/main/master/MASTER.md`의 기획 자율 진행 적용 범위와 구형 `YAL_SPACE` 설명은 Task 3 대상이므로 유지했다. 스킬 창의 총괄 MD 원문에는 해당 문구가 아직 표시된다.
- `yal-game-planning` 내장 v1/v2 파일·스킬 이름, `-planning-legacy`, `planning-migrated`, 기존 관리 파일 정리 이름은 원문 판별·이력·데이터 보존을 위해 유지했다.
- `manageSpace.ts`의 `spaces/planning`은 실패한 마이그레이션 원본의 보호 경로다. 운영 공간 종류로 사용하지 않는다.
- 오류 발생 중 프로세스 강제 종료·전원 중단 복구는 검증하지 않았다. 일반 오류 이후 재시도와 성공 후 재실행의 멱등성은 검증했다.
- 보고서 파일 자체를 쓸 수 없는 경우 오류는 반환값과 콘솔에 남지만 결과 파일 저장은 실패할 수 있다.
- 검증 실행 중 Node의 기존 `shell: true` 호출에 대한 `DEP0190` 경고가 출력됐다. 테스트·타입 검사·빌드·격리 앱은 모두 종료 코드 0이었다.
- 실제 사용자 userData에 대한 마이그레이션·수정은 수행하지 않았다. 격리 프로필만 사용했다. 다른 사용자 프로세스에는 종료·변경 명령을 실행하지 않았다.
- 이번 작업에서 `scripts/gpt.sh` 수정, 외부 GPT/Claude 세션 실행, 커밋·푸시는 수행하지 않았다. 기존 새로고침·시각·상태·유령 GPT·동기화 제거 변경은 유지했다.
