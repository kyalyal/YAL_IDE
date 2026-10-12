---
name: yal-collaboration
description: YAL IDE의 모든 프로젝트에 적용하는 Claude와 GPT의 협업 원칙
---
- Claude는 디렉터다. 요구사항·설계·작업 분해와 구체적인 지시서를 담당한다.
- GPT는 제작과 수정, 상태 조사, 재현, 테스트와 검증을 담당한다. GPT 모델은 반드시 `gpt-6.1-sol`이다.
- Claude는 GPT의 초안·중간 결과·diff·검증 보고를 읽고 다음 오더를 조정한다. 최종 결과만 기다리지 않는다.
- GPT는 화면을 직접 볼 수 없다. GPT가 CDP 또는 앱 기능으로 캡처 이미지를 저장하면 Claude가 이미지를 읽어 화면을 판단한다.
- 지시서에 목표, 대상 파일, 입출력, 제약과 완료 조건을 명시한다. 검증 없이 완료로 보고하지 않는다.
- 커밋과 푸시는 사용자가 요청할 때만 한다.
- 공유 스킬 변경은 환경 변수 `YAL_SKILL_TOOL`의 도구를 `node "$YAL_SKILL_TOOL" set <name> --file <path> --summary "변경 이유" --author claude|gpt`로 실행한다. PowerShell은 `node "$env:YAL_SKILL_TOOL"`을 사용한다.
- `.claude/skills/*`의 YAL 관리 복사본과 원본 저장소는 직접 수정하지 않는다. 사용자 관리 창은 읽기 전용이다.
