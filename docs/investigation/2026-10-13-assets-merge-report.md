# 에셋 공간 전환 및 기획·개발 병합 — 통합 결과

작성일: 2026-10-13. 대상: 계획서 Task 0~6의 최종 상태 및 Task 6 통합 검증.

## 전체 변경 결과

| 단계 | 최종 변경 |
| --- | --- |
| Task 0 | GPT 로그의 실행별 run id 추적, 중복·종료된 start 에코 차단, 구형 로그의 무출력 제한 및 파서 호환. 실제 실행 여부에 따른 상태·알림 판정. 해당 단계의 기존 변경을 유지했다. |
| Task 1 | 기획↔개발 변경 동기화 IPC·파일 생성·프로젝트 배지·반영 완료 버튼 제거. IDE 관리 마커와 파일 해시가 일치하는 이전 관리 파일만 정리하며 사용자 파일은 보존한다. 마스터·스킬 배포 기능은 유지한다. |
| Task 2 | 공간 종류를 assets/dev/manage, 연결 필드를 linkedAssetsId로 전환. 시작 시 레지스트리 백업·변환과 기획 스킬의 개발 공간 병합을 수행한다. 목록·탭·연결 라벨은 에셋/개발/YAL_IDE 관리다. |
| Task 3 | 개발 공간에 yal-game-planning v3 설치. 기획→설계→구현→검증을 한 개발 프로젝트에서 수행하며 기획·설계 산출물과 에셋 참조·복사 규칙을 스킬·기본 마스터·템플릿에 반영한다. |
| Task 4 | 에셋 도서관 스킬, 공유 ASSET_RULES·카탈로그 형식, 프로젝트 골격을 추가했다. images/, sfx/, vfx/, ui/, ASSETS.md, STYLE.md를 만들고 기존 파일은 유지한다. |
| Task 5 | 개발 프로젝트의 에셋 연결 선택, 유효한 연결에 대한 --add-dir와 YAL_ASSETS_DIR, assets/ASSETS-USED.md 초안 및 참조·복사·출처 기록 규칙을 추가했다. |
| Task 6 | 제작 가능 범위를 실측 근거로 확정하고 에셋 제작 스킬을 v2로 갱신했다. v1 원문을 보관하고 previousContent로 연결했다. 전체 테스트·타입 검사·빌드, 구형 데이터 격리 앱 실행, 캡처 시각 확인과 프로세스 종료를 검증했다. |

이번 단계에서 저장소 scripts/gpt.sh는 수정·실행하지 않았다. 기존 단계의 변경은 되돌리지 않았고 커밋·푸시는 수행하지 않았다. 실제 사용자 데이터와 프로젝트 폴더는 사용하지 않았다. 앱·터미널 검증은 격리 데이터와 로컬 fixture만 사용했으며 외부 Claude/Codex 세션을 실행하지 않았다.

## Task 6 변경 산출물

- src/main/skills/builtin/yal-asset-factory.md: 제작 가능 범위, 도구 목록 확인, 규격 후처리·원본 보관, 도구 부재 시 대안·불가 기록 규칙.
- src/main/skills/builtin/yal-asset-factory-v1.txt: 변경 전 v1 원문.
- src/main/skillsSetup.ts: assets 내장 버전 2, previousContent=v1. 기존 installBuiltins의 사용자 수정본 보존 정책을 유지했다.
- tests/assetsRules.test.ts: 스킬·CLAUDE.md·AGENTS.md 공통 문구, v1→v2 갱신, system 작성자 수정본과 사용자 수정본 보존, 재설치 멱등 검증.
- tests/skillsRuntime.test.ts: assets 내장 버전 2 기대값.
- .verify/assets-final-runtime.cjs, .verify/assets-final-verify.cjs, .verify/assets-final-terminal-fixture.cjs: 격리 시드·빌드 앱·PTY·화면·종료 검증.
- .verify/assets-final-runtime/result.json: 최종 런타임 결과. .verify/assets-final-{test,typecheck,build}.log: 명령 결과.
- .verify/shots/assets-final-01~08-*.png: 최종 화면 8장. 아래 표에 정확한 파일명을 기록했다.

ASSET_RULES는 스킬 본문의 frontmatter를 제거해 만든 공유 상수다. 에셋 CLAUDE.md와 AGENTS.md는 이 상수를 사용한다. 별도의 복제 문구 없이 같은 규칙이 신규 에셋 프로젝트 템플릿에 반영됨을 테스트했다.

## 마이그레이션 규칙과 실측 결과

구형 projects.json의 kind=planning은 assets로 바꾸고 linkedPlanningId는 linkedAssetsId로 바꾼다. 이미 새 링크 필드가 있으면 그 값을 유지한다. 변환 전에 원본을 projects.json.bak-<시각>으로 복사하고 새 형식은 원자적으로 저장한다. 손상 JSON은 .corrupt-<시각>으로 보존한다. 멱등성·손상 데이터 처리는 전체 테스트의 마이그레이션 테스트로 확인했다.

구형 기획 스킬은 개발 공간으로 복사한다. 동일 이름의 개발 스킬은 유지한다. 충돌한 구형 yal-game-planning이 system 작성자의 내장 v1/v2와 같으면 중복 복사를 생략한다. 수정본 충돌은 <이름>-planning-legacy로 보존하고 재충돌 시 번호를 붙인다. 고유 스킬은 같은 이름으로 병합한다. 성공 후 원본 공간은 planning-migrated로 보관한다. 잠금·심볼릭 링크 거부·실패 시 이번 시도 산출물 롤백 정책은 기존 구현과 테스트를 유지한다.

격리 시드는 구형 기획 프로젝트 2개, linkedPlanningId를 가진 개발 프로젝트 1개, 구형 기획 스킬 3개(내장 동일본·수정본·고유), 기존 개발 스킬, 에셋 내장 v1, 사용자 마스터 원본으로 구성했다. 기존 기획 문서·프로젝트 규칙과 기존 카탈로그도 넣었다.

| 항목 | 실제 결과 |
| --- | --- |
| 레지스트리 변환 | 기획 2개→에셋 2개, 링크 필드 1개 변환, ID 유지 |
| 원본 백업 | 백업 바이트가 시드 projects.json과 일치 |
| 스킬 원본 | planning-migrated 존재, 오류 0 |
| 내장 동일본 | 기존 개발 기획 스킬을 v3로 갱신, 중복 legacy 생성 없음 |
| 수정본 | yal-collaboration-planning-legacy로 보존, 사용자 추가 규칙 확인 |
| 고유 스킬 | personal-planning을 개발 공간으로 병합 |
| 에셋 내장본 | 수정 없는 v1→v2, 화면·본문·메타 버전 확인 |
| 사용자 수정본 | 자동 테스트에서 system-edited와 user-edited 모두 보존 |
| 기존 문서 | 기획 docs/plan.md·CLAUDE.md·AGENTS.md·기존 ASSETS.md 해시 유지 |
| 골격 | 에셋 2개에 4개 폴더·ASSETS.md·STYLE.md 존재 |
| 사용자 마스터 | 시작 전후 SHA-256 동일: 324f307246a97d51ff687295cad61180133f33e3f48b10409ba76e88521a37b3 |

## 제작 가능 범위

근거는 기존 읽기 전용 실측 증거 .verify/asset-probe/CAPABILITY.md, VERIFY.md, ASSETS.md와 해당 산출물이다. 이번 단계에서는 그 증거를 읽고 최종 스킬에 반영했다. 이미지 생성 도구를 다시 호출하거나 기존 실측 파일을 변경하지 않았다.

| 종류 | 확인 상태 | 실측 근거·한계 |
| --- | --- | --- |
| SVG 벡터 이미지 | 가능(검증됨 2026-10-13) | 128×128 SVG, XML 파싱·PNG 렌더 |
| HTML 캔버스 렌더 이미지 | 가능(검증됨 2026-10-13) | 640×360 PNG 캡처 |
| Canvas 이펙트 코드 | 가능(검증됨 2026-10-13) | 프레임 증가·반복 파티클, 콘솔 오류 0 |
| 파형 합성 WAV 효과음 | 가능(검증됨 2026-10-13) | 44.1kHz, mono, 16-bit PCM, 0.400초, 비무음·클리핑 없음 |
| AI 일러스트 이미지 | 가능(내장 이미지 생성 도구 사용, 환경에 따라 달라질 수 있음 — 사용 전 도구 목록 확인) | image_gen__imagegen 1건 성공, PNG 저장·검증. 64×64 요청에 1254×1254 반환 |
| AI 사진풍 이미지 | 미확인 | 사진풍 출력 테스트 없음 |
| AI 이미지 고정 크기 직접 출력 | 미확인 | 실측 요청 크기와 실제 출력이 다름 |
| 배경 BGM | 사용자 제공 필요 | 제작·검증하지 않음 |
| 광고 연동·스토어 출시 | 범위 밖 | 실행하지 않음 |

크기가 요청과 다르면 GPT가 리사이즈·크롭 스크립트로 규격에 맞춘 파일을 별도 저장하고 원본은 images/_src/에 보관한다. 원본·후처리 파일 경로와 실제 크기를 카탈로그에 기록하고 검증한다. 이미지 도구가 없는 환경에서는 SVG/캔버스 대안을 사용하며 불가 사실을 카탈로그에 기록한다. 사진풍·크기 직접 지정처럼 확인되지 않은 기능을 가능하다고 기록하지 않는다. 후처리 규칙의 실제 AI 제작 세션 준수는 이번 검증 범위에 포함하지 않았다.

## 검증 결과

| 검증 | 결과 | 근거 |
| --- | --- | --- |
| 문구 변경 전 실패 | 통과 | assets-final-capability-red.log: 최종 능력 문구 단언 실패 확인 후 수정 |
| v2·보존·공통 규칙 테스트 | 통과 | assets-final-green.log: 2개 파일, 15개 테스트 |
| npm test | 통과 | 최종 87개 파일, 886개 테스트, 실패 0, 종료 코드 0 |
| npm run typecheck | 통과 | 최종 종료 코드 0 |
| npm run build | 통과 | 최종 종료 코드 0, out/ 생성 |
| 빌드 앱·CDP 실행 | 통과 | 별도 userData로 빌드된 out/main/index.js 로드, remote-debugging-port 대상 확인 |
| 목록 제목·공간 탭 | 통과 | 에셋/개발/YAL_IDE 관리, 구형 기획 2개가 에셋 목록에 표시 |
| 연결 UI·터미널 인자 | 통과 | 드롭다운 B→A 변경·저장. fixture argv의 --add-dir 1회와 대상 경로, YAL_ASSETS_DIR 일치 |
| 스킬 창 | 통과 | 개발 기획 v3·고유 병합 스킬·legacy 수정본, 에셋 제작 v2 |
| 골격·기존 문서 | 통과 | 디스크 존재·해시 단언 및 에셋 프로젝트 열기 캡처 |
| 동기화 UI 제거 | 통과 | 프로젝트 동기화 배지·반영 완료 버튼 없음. 스킬 배포 상태 안내는 유지 |
| 앱 새로고침 | 통과 | 버튼 클릭으로 렌더러 probe 제거, 선택 유지, PTY PID 3개 동일, 추가 spawn 없음 |
| 로그 문단 시각 | 통과 | 14:03:22·14:03:25 표시, 같은 문단 후속 줄의 중복 시각 없음 |
| 유령 start 상태 | 통과 | 정상 완료 뒤 id 없는 start 및 종료된 id의 start 에코, gptRunning=false, 대기중 표시 |
| 사용자 마스터 보호 | 통과 | 원본 해시 동일 |
| 최종 캡처 시각 확인 | 통과 | 수행자가 PNG 8장을 직접 읽어 확인 |
| 종료·정리 | 통과 | fixture PTY 선행 종료, 앱 종료 코드 0, 남은 fixture PID 0 |
| 실제 Claude 세션의 규칙 준수 | 미검증 | 외부 Claude/Codex CLI·신규 세션 미실행. UI·PTY는 로컬 fixture 사용 |
| 사진풍·고정 크기 AI 직접 출력 | 미검증 | 기존 실측 증거에도 해당 성공 결과 없음 |
| 후처리 규칙의 실제 제작 적용 | 미검증 | 문구·템플릿 반영을 검증했으며 실제 리사이즈 제작 흐름은 실행하지 않음 |

최종 실행 결과는 result.json의 passed=true, appExited=true, appExitCode=0, remainingFixturePids=[]다. 다른 사용자 프로세스는 종료하지 않았다.

## 캡처와 시각 확인

| 파일(.verify/shots/) | 직접 확인한 내용 |
| --- | --- |
| assets-final-01-migrated-list.png | 세 공간 제목·탭, 에셋 아래 구형 기획 A/B, 개발 프로젝트의 기존 연결 |
| assets-final-02-linked-terminal.png | 에셋 연결 A 선택, 실행 중 fixture의 add-dir count=1·YAL_ASSETS_DIR=set |
| assets-final-03-assets-project.png | 에셋 프로젝트 열림, 에셋 터미널은 add-dir count=0·환경변수 absent |
| assets-final-04-times-and-ghost.png | 두 문단 시각, 일반 로그의 유령 start, 헤더 대기중과 GPT 완료 표시 |
| assets-final-05-reloaded.png | 새로고침 후 선택·터미널·로그 유지 |
| assets-final-06-dev-skills.png | 개발 탭의 기획 v3, 고유 스킬과 legacy 수정본, 사용자 마스터 본문 |
| assets-final-07-assets-skill.png | 에셋 탭의 yal-asset-factory v2 |
| assets-final-08-capabilities.png | 검증 날짜·AI 도구 조건·미확인 표, 후처리·원본 보관·대안 규칙 |

## 적용 한계와 기존 문서 반영 방법

1. 마이그레이션과 스킬 설치는 메인 프로세스 시작 시 실행한다. 실행 중 IDE에는 재시작이 필요하다. 렌더러 새로고침만으로 마이그레이션·새 메인 코드가 적용되지는 않는다. 앱 재시작은 진행 중 터미널 작업을 끊으므로 해당 작업 종료 후 적용한다.
2. 이미 있는 프로젝트 CLAUDE.md/AGENTS.md의 본문과 사용자 마스터 원본은 새 기본본으로 자동 교체하지 않는다. CLAUDE.md에 마스터 import가 없으면 import 한 줄만 추가할 수 있다. 수동 반영은 기존 파일을 백업한 뒤 해당 프로젝트 루트 CLAUDE.md/AGENTS.md에 공간에 맞는 새 규칙을 병합한다. 에셋 규칙 원문은 src/main/skills/builtin/yal-asset-factory.md, 개발 규칙은 yal-game-planning.md와 src/main/templates.ts에 있다. 에셋 규칙은 역할·카탈로그·스타일·능력·후처리 항목을 반영하고 개발 규칙은 기획→설계→구현→검증·에셋 참조/복사·출처 기록 항목을 반영한다. 사용자 마스터는 스킬 창의 개발 또는 에셋 탭에서 총괄 MD의 파일 열기로 원본을 열고, 저장소 src/main/master/MASTER.md의 필요한 변경을 기존 개인 규칙과 병합해 저장한다. 프로젝트 배포용 .claude/yal-master.md를 직접 편집하는 대신 원본을 편집한다.
3. 구형 기획 프로젝트는 에셋 공간으로 분류되지만 기존 docs/와 기획 문서는 이동·삭제·내용 교체하지 않는다. 기존 ASSETS.md·STYLE.md도 유지한다. 기존 기획을 개발에 이어 쓸 때는 필요한 문서를 개발 프로젝트 docs/planning/ 등에 수동 복사·정리해야 하며 자동 병합은 하지 않는다. 이전 동기화 관리 파일은 IDE 마커·해시 확인된 파일만 정리된다.
4. 에셋 연결은 경로 접근을 제공한다. 원본을 읽기 전용으로 사용하고 개발 프로젝트에 복사하는 것은 규칙으로 명시된 행동이며 OS 수준 쓰기 차단을 뜻하지 않는다. 실제 Claude 세션이 이 규칙과 후처리 규칙을 준수하는지는 미검증이다. 개발 프로젝트의 에셋 사용 내역은 assets/ASSETS-USED.md에 기록하도록 되어 있다.
