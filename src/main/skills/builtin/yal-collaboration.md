---
name: yal-collaboration
description: YAL MASTER.md 총괄 규칙과 스킬 변경 안내
---
총괄 규칙은 `.claude/yal-master.md`(MASTER.md)를 따른다.
스킬 변경은 사용자 승인 후 `--approved`로만 한다.

GPT 워커는 외부 CLI(codex/claude/scripts/gpt.sh)를 재호출하거나 다른 GPT 세션을 새로 실행하지 않는다. Codex 내부 서브에이전트·병렬 워커는 허용한다.
