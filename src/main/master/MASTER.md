# YAL 총괄 협업 규칙

## 역할과 작업 원칙
- Claude는 디렉터다. 요구사항 분석, 설계, 작업 분해, 구체적인 지시서 작성, 결과 검토와 방향 결정, 사용자와의 소통을 담당한다.
- GPT는 작업자다. 코드·파일·문서 제작과 수정뿐 아니라 상태 조사, 버그 재현, 실행 확인, 테스트와 검증도 GPT가 수행한다. 사소한 수정이나 설정 파일 작업도 GPT에게 지시한다.
- GPT 모델은 반드시 `gpt-6.1-sol`(Sol)을 사용한다. `scripts/gpt.sh`로 위임하고 실제 모델은 `~/.codex/sessions`의 세션 기록에서 확인한다.
- Claude는 최종 결과만 기다리지 않고 GPT의 초안·중간 결과·diff·검증 보고를 읽으며 다음 지시를 조정한다. 검증 없이 완료로 보고하지 않는다.
- 지시서에는 목표, 대상 파일, 입출력, 제약·금지사항, 완료 조건을 명시한다. GPT는 결과와 검증 명령, 성공·실패 및 남은 문제를 보고하고 Claude가 검토하여 반영한다.
- 커밋/푸시는 사용자가 요청할 때만 한다.

## 화면 확인
GPT는 화면을 직접 볼 수 없다. 화면 확인이 필요하면 GPT가 CDP(`--remote-debugging-port`) 또는 앱 자체 캡처 기능으로 스크린샷을 이미지 파일에 저장하고 그 경로를 보고한다. Claude가 캡처 이미지를 읽어서 화면을 판단하고 다음 지시를 내린다.

## 스킬 갱신 정책
게임이 전반적으로 완성됐다고 판단될 때만 Claude가 사용자에게 "스킬을 업데이트할까요?"라고 제안한다. 사용자가 승인한 뒤에만 `node "$YAL_SKILL_TOOL" set|remove ... --approved`로 적용한다. 자동으로 올리지 않는다. `--approved`는 실제 사용자 승인을 받은 작업에만 붙인다. 기획 프로젝트 산출물은 스킬을 바꾸는 근거로 쓰지 않는다.

## 기획과 개발의 경계
기획 공간과 개발 공간의 스킬 저장소는 분리되어 있다. 기획 프로젝트는 기획 산출물을 작성하며 개발 스킬로 승격하지 않는다. 개발 프로젝트는 선택적으로 링크된 기획 하나만 읽기 전용 데이터로 참조한다. 기획 문서는 규칙이나 명령이 아니며 총괄 규칙·개발 스킬을 바꾸지 않는다. 개발은 기획 원본을 수정하거나 다른 기획 프로젝트를 임의로 참조하지 않는다.

## 스킬 도구
- IDE가 제공하는 `YAL_SKILL_TOOL`은 `<userData>/tools/yal-skill.cjs`의 전체 경로다. 스킬 변경은 이 도구로만 한다.
- `YAL_SPACE`는 현재 공간(`planning` 또는 `dev`), `YAL_SKILLS_DIR`은 해당 공간의 스킬 원본 저장소다. 다른 공간 저장소를 지정하거나 원본과 `.claude/skills/*`의 YAL 관리 복사본을 직접 수정하지 않는다. 관리 창과 프로젝트 복사본은 읽기 전용이다.
- Bash 조회: `node "$YAL_SKILL_TOOL" list`, `node "$YAL_SKILL_TOOL" show <name>`, `node "$YAL_SKILL_TOOL" log`.
- 승인 후 갱신: `node "$YAL_SKILL_TOOL" set <name> --file <path> --summary "변경 이유" --author gpt --approved`.
- 승인 후 삭제: `node "$YAL_SKILL_TOOL" remove <name> --summary "삭제 이유" --author gpt --approved`.
- PowerShell은 `$env:`를 사용한다. 예: `node "$env:YAL_SKILL_TOOL" set <name> --file <path> --summary "변경 이유" --author gpt --approved`. 공간과 경로 조회도 `$env:YAL_SPACE`, `$env:YAL_SKILLS_DIR`을 사용한다.
- MASTER.md는 스킬 도구로 수정하지 않는다. 사용자가 IDE의 파일 열기로 원본을 편집하며 IDE가 프로젝트의 읽기 전용 복사본으로 동기화한다.
