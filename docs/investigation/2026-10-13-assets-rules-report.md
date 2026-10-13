# 에셋 공간 규칙·카탈로그 구현 결과

작성일: 2026-10-13
대상: 에셋 공간 전환 계획의 Task 4 및 설계 §3.

## 변경 파일

| 파일 | 변경 내용 |
| --- | --- |
| `src/main/skills/builtin/yal-asset-factory.md` | 한국어 에셋 도서관 제작·검수 규칙 신설 |
| `src/main/assetsRules.ts` | 내장 스킬에서 공간 규칙과 카탈로그 형식을 추출하는 공유 모듈 신설 |
| `src/main/assetsScaffold.ts` | 비덮어쓰기 에셋 프로젝트 골격 생성 함수 신설 |
| `src/main/skillsSetup.ts` | assets에 `yal-asset-factory` v1 등록; dev 등록 없음 |
| `src/main/templates.ts` | assets CLAUDE.md/AGENTS.md를 새 에셋 도서관 규칙으로 교체 |
| `src/main/provisioner.ts` | assets일 때 골격 호출 및 실패 로그 처리 |
| `src/main/projectCreation.ts` | 생성 시 공통 프로비저닝이 골격을 생성함을 주석으로 명시 |
| `tests/assetsScaffold.test.ts` | 골격 생성·멱등성·보존·경로/심볼릭 링크·공간별 프로비저닝·생성 경로 테스트 신설 |
| `tests/assetsRules.test.ts` | 설치 공간·사용자 수정본 보존·카탈로그 형식 일치·템플릿·비밀 위치 패턴 테스트 신설 |
| `tests/provisioner.test.ts` | 임시 assets 기획 문구 기대값을 에셋 규칙으로 변경 |
| `tests/skillsRuntime.test.ts` | assets 내장 스킬과 설치 버전 기대값 갱신 |
| `tests/planningAutonomy.test.ts` | dev 기획 스킬 분리 유지, assets 임시 v2 규칙 기대값 제거 |

기존 작업 트리의 선행 변경은 유지했다. `scripts/gpt.sh`, dev 템플릿 본문과 공통 EXECUTOR 규칙은 이번 작업에서 수정하지 않았다. 커밋·푸시는 하지 않았다.

## 스킬과 템플릿

- 여러 게임이 재사용하는 에셋 도서관이며 게임 기획·개발은 수행하지 않는다.
- Claude는 디렉터이며 에셋을 직접 만들지 않는다. 용도·스타일·크기/포맷·파일 경로·수량·완료 조건을 담은 지시서를 전달하고 파일·캡처·카탈로그를 검수한다. GPT는 제작·검증·기록을 수행한다.
- `images/`, `sfx/`, `vfx/`, `ui/`와 `<분류>-<이름>-<버전>.<확장자>` 규칙, v1 시작 및 기존 파일을 보존하는 v2 추가 규칙을 명시했다.
- GPT가 제작 직후 ASSETS.md를 추가·갱신하고 Claude가 검수한다. 버전 제외 id와 버전을 포함한 상대 경로, 이전 버전 경로 보존을 명시했다.
- STYLE.md의 팔레트·선 굵기·해상도 단위·음량 기준과 변경 이력을 따른다.
- SVG·HTML 캔버스 이미지·CSS/Canvas 이펙트·웹오디오 WAV는 `가능(검증 예정)`이다. AI 일러스트/사진풍은 `미확인`이며 불가 시 SVG/캔버스 대안, 불가 확정 시 사용자 제공 필요로 기록한다. BGM은 사용자 제공 필요, 광고 연동·스토어 출시 절차는 범위 밖이다.
- Notion 주소·로컬 설정 경로·비밀값 기록 금지와 사용자 요청 시에만 커밋/푸시하는 규칙을 포함했다.
- `ASSETS_LEGACY_RULES`와 assets용 v2 import를 제거했다. `ASSET_RULES`로 대체해 새 스킬 본문을 두 assets 템플릿에 공유한다. dev의 기획 v3 본문은 유지했다. 마이그레이션용 v2 원문은 유지했다.
- 카탈로그 형식은 스킬의 코드 블록이 원본이며 `ASSET_CATALOG_FORMAT`으로 골격에 공유한다. 스킬·CLAUDE.md·AGENTS.md·ASSETS.md가 동일 문자열을 사용하는 테스트가 통과했다.
- 기존 CLAUDE.md/AGENTS.md 사용자 수정본 보존 정책을 유지했다. 기존 CLAUDE.md에 총괄 import가 없으면 기존 정책대로 import만 추가한다. 기존 템플릿 본문을 자동 교체하지 않는다.

## 골격 동작

`scaffoldAssetsProject(path)`는 `{ created, skipped }` 상대 경로 목록을 반환한다.

- images, sfx, vfx, ui 빈 폴더와 ASSETS.md, STYLE.md를 생성한다. README.md와 .gitkeep은 생성하지 않는다.
- ASSETS.md 초안에는 목적·항목 형식·id/경로 설명·등록된 에셋 없음 표시를 넣었다. STYLE.md는 제목만 생성한다.
- 기존 정상 파일/폴더는 skipped에 기록하며 덮어쓰지 않는다. 파일 쓰기는 `wx`, 폴더 생성은 비재귀 방식이다.
- 프로젝트 루트·상위 경로·골격 대상의 심볼릭 링크를 거부한다. 모든 대상의 링크와 파일 종류를 생성 전에 검사한다.
- 없는 루트, 디렉터리가 아닌 루트, 요구 파일/폴더 종류와 충돌하는 대상은 명확한 예외를 던진다.
- 공통 `provision()`에서 assets일 때만 호출한다. 새 프로젝트 생성, 기존 폴더 추가, 등록된 프로젝트의 앱 시작 시 프로비저닝과 마이그레이션된 프로젝트에 적용된다.
- 골격 실패는 console.error에 기록하고 프로비저닝을 계속한다. 골격 실패만으로 프로젝트 생성이 취소되지 않는다.
- 기존 docs와 문서는 변경하지 않는다.

## 검증 결과

| 검증 | 결과 |
| --- | --- |
| 구현 전 테스트 | 스킬 부재로 3개 테스트 실패, 골격 모듈 부재로 1개 테스트 파일 로딩 실패 확인 |
| 새 테스트 | 2개 파일, 14개 통과 |
| 최종 `npm test` | 84개 파일, 875개 테스트 통과; 종료 코드 0 |
| 최종 `npm run typecheck` | 통과; 종료 코드 0 |
| `npm run build` | 통과; 종료 코드 0; out/main·preload·renderer 생성 |
| 변경 파일 `git diff --check` | 통과; 줄바꿈 변환 안내만 출력 |
| 심볼릭 링크 검증 | Windows junction으로 루트·상위 경로·images·ASSETS.md의 4개 사례 모두 통과, skip 없음 |
| 격리 신규 assets 생성 | 빈 폴더 4개, ASSETS.md·STYLE.md·CLAUDE.md·AGENTS.md 존재와 규칙 확인 |
| 격리 기존 폴더 assets 추가 | 기존 docs/plan.md 바이트 유지, 골격 추가 확인 |
| 격리 planning→assets 전환 및 시작 | kind 전환, 기존 문서 보존과 골격 추가 확인 |
| 격리 dev 생성 | ASSETS.md 미생성 확인 |
| 스킬 창 | 「에셋」 탭의 yal-asset-factory v1 표시 및 본문 원본 일치 확인; dev에는 미설치 |
| 캡처 | 4장 저장 후 직접 읽어 확인 |
| 격리 앱 종료 | 앱 exitCode=0, appExited=true, 소유 PID 47004 부재 확인 |

실행 검증은 `.verify/assets-rules-runtime/` 아래 신규 격리 프로필과 임시 프로젝트만 사용했다. 실제 사용자 userData와 사용자 프로젝트 폴더는 사용하지 않았다. CLI 감지와 터미널은 검증용 fixture로 대체해 Claude/Codex CLI와 새 GPT 세션을 실행하지 않았다. 다른 사용자 프로세스를 종료하지 않았다.

## 검증 산출물

- `.verify/assets-rules-test.log`
- `.verify/assets-rules-typecheck.log`
- `.verify/assets-rules-build.log`
- `.verify/assets-rules-runtime.cjs`
- `.verify/assets-rules-runtime.log`
- `.verify/assets-rules-runtime/result.json`
- `.verify/assets-rules-process-check.json`
- `.verify/shots/assets-rules-01-created-project.png`: 신규 assets 선택 화면
- `.verify/shots/assets-rules-02-added-project.png`: 기존 폴더 추가 후 선택 화면
- `.verify/shots/assets-rules-03-skill-body.png`: 에셋 탭·v1·역할과 지시서 본문
- `.verify/shots/assets-rules-04-skill-capabilities.png`: 확인 상태 표·검수·원본 보호 본문

## 한계·미검증

실제 에셋 제작 능력과 외부 AI 이미지 생성은 이번 작업에서 실행하지 않았다. 스킬의 가능/미확인 표기는 검증 예정 상태를 유지한다. 실제 Claude/GPT 터미널 실행은 fixture 사용으로 미검증이다.

격리 캡처에서 Electron `UnknownVizError`가 발생했다. 검증 harness에 하드웨어 가속 비활성화와 캡처 재시도 기록을 적용한 최종 실행은 첫 캡처 1회 재시도 후 4장 모두 성공했다. 제품 앱의 렌더링 설정은 수정하지 않았다. 실행 로그에는 기존 shell 옵션 관련 Node DEP0190 경고가 남아 있다.
