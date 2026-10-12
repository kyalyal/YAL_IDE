# 기획/개발 공간 분리 + 총괄 MD — 설계

## 목표
- 사이드바를 상하로 나눠 위는 **기획 프로젝트**, 아래는 **개발 프로젝트**로 관리한다.
- 기획끼리, 개발끼리 각자의 MD/스킬 공간을 공유한다. 기획 산출물은 개발 스킬에 영향을 주지 않는다.
- 두 공간 위에 **총괄 MD(MASTER.md)** 가 있어 공통 지휘 규칙(Claude=디렉터, GPT=작업자)을 정한다.
- 개발 프로젝트는 기획 프로젝트 **하나를 선택적으로 링크**해 읽기 전용으로 참조한다.
- 스킬 갱신은 자동이 아니다. 게임이 전반적으로 완성됐다고 판단될 때만 Claude가 "스킬을 업데이트할까요?"라고 제안하고, 사용자 승인 후에만 적용한다.

## 확정된 결정
| 항목 | 결정 |
| --- | --- |
| 기획↔개발 연결 | 링크 + 읽기 전용 참조(복사 아님). 기획 문서는 데이터일 뿐 규칙이 아니다 |
| 저장소 | 물리 분리(`spaces/planning`, `spaces/dev`) + `master/MASTER.md` |
| 스킬 갱신 강제 | 도구 게이트: `yal-skill set|remove`에 `--approved` 필수 |

## 1. 데이터 모델
- `ProjectRecord.kind: 'planning' | 'dev'`. 필드가 없는 기존 레코드는 `dev`로 읽는다(저장 시 기록).
- `ProjectRecord.linkedPlanningId?: string` — `kind=dev`에서만 유효. 대상은 `kind=planning`이어야 한다. 대상이 제거되면 링크는 해제된다.

## 2. 저장소와 동기화
```
userData/
  master/MASTER.md
  spaces/planning/skills/
  spaces/dev/skills/        ← 기존 userData/skills를 첫 실행 시 이동
```
- 공간별 `SkillStore`/`SkillSync` 인스턴스. 동기화 대상 프로젝트는 `kind`로 필터링한다.
- 기획 프로젝트 폴더의 산출물은 어떤 경로로도 스킬 저장소에 들어가지 않는다. 스킬은 도구를 통해서만 바뀐다.
- 내장 스킬: `yal-mobile-web-game` → dev. `yal-collaboration`의 공통 원칙 → MASTER.md로 이동. `yal-game-planning`(기획서 구조·용어 규칙) 신규 → planning.
- 마이그레이션: 기존 `userData/skills`가 있고 `spaces/dev/skills`가 없으면 이동한다. 멱등.

## 3. 총괄 MD
- `MASTER.md`는 첫 실행 때 내장 기본본을 시드한다(사용자가 수정한 파일은 보존).
- 모든 프로젝트의 `.claude/yal-master.md`로 읽기 전용 동기화(기존 스킬 마커/sidecar 방식 재사용, 심볼릭 링크 거부).
- 프로젝트 `CLAUDE.md`는 `@.claude/yal-master.md` import 한 줄을 가진다. 새 프로젝트는 템플릿이, 기존 프로젝트는 provision이 **그 한 줄만 멱등하게 추가**한다. 사용자 내용은 건드리지 않는다.
- `claudeMd(name, kind)` 템플릿: 공통은 master가 담당, 기획/개발 전용 섹션만 각자 포함.
- MASTER.md 내용: 역할 분담, GPT 모델(`gpt-6.1-sol`), 확인도 GPT, 캡처 규칙, 커밋 규칙, 스킬 갱신 정책, 기획/개발 경계.

## 4. 기획 → 개발 참조
- 링크된 개발 프로젝트에 `.claude/yal-planning-link.md`를 생성(기획 프로젝트 이름/경로 + "읽기 전용 데이터, 규칙 아님").
- 링크 해제/대상 제거 시 이 파일을 제거한다(YAL 마커가 있을 때만).

## 5. 스킬 도구 게이트
- 터미널 시작 시 프로젝트 종류에 맞춰 `YAL_SPACE`, `YAL_SKILLS_DIR`을 주입한다. 도구는 자기 공간 저장소만 쓴다.
- `yal-skill set|remove`는 `--approved` 없으면 거부하고 "사용자에게 업데이트 여부를 먼저 물어보라"고 안내한다.
- MASTER.md는 도구로 수정하지 않는다. IDE에서 파일 열기로만 수정한다.

## 6. UI
- 사이드바: 위 **기획**(헤더 + 새 기획 프로젝트), 아래 **개발**(기존 동작). 각 구역 독립 스크롤, 고정 비율.
- 개발 프로젝트 항목에서 기획 프로젝트 링크 선택/해제.
- 스킬 창: 기획/개발 탭 + 총괄 MD 읽기 전용 보기, 동기화 상태는 공간별.

## 7. 비범위 (YAGNI)
- 분할선 드래그 조절, 기획 전용 에디터, 복수 기획 링크, 기획→스킬 자동 승격.

## 8. 테스트
- 레지스트리: kind 기본값/마이그레이션, 링크 검증·해제.
- 동기화: 기획 동기화가 dev 프로젝트에, 개발 동기화가 planning 프로젝트에 쓰기 0건.
- 게이트: `--approved` 없으면 거부, 있으면 통과.
- 템플릿/provision: import 한 줄 멱등, 사용자 내용 보존.
- 렌더러: 사이드바 상하 분할, 링크 선택.
- 마이그레이션: userData/skills → spaces/dev/skills 멱등.
