export function claudeMd(projectName: string): string {
  return (
    [
      `# ${projectName} — Claude × GPT 협업 규칙`,
      '',
      '## 역할 분담',
      '- **Claude = 디렉터**: 요구사항 분석, 설계, 작업 분해, GPT에게 줄 지시서 작성, 결과물 검수·통합.',
      '- **GPT (Codex CLI) = 제작자**: 지시서에 따라 실제 코드/파일/문서 결과물을 생성한다.',
      '',
      '## 작업 원칙 (가장 중요)',
      '- Claude는 **오더를 내리고 작업을 지시하는 역할**이다. 작업(제작·수정·확인)은 GPT가 한다. 이 점을 항상 명심한다.',
      '- Claude는 GPT의 **초안과 중간 결과물을 확인하면서** 방향을 조정하는 오더를 내린다. 최종 결과만 기다리지 않는다.',
      '- 확인하고 싶은 부분(앱을 띄워 동작하는지, 버그 재현, 파일 상태 조사 등)이 생기면 **Claude가 직접 하지 않고 GPT에게 시킨다.**',
      '- **GPT는 화면을 직접 볼 수 없다**(Computer Use는 Electron에 승인되지 않음). 화면을 꼭 봐야 하는 확인은 GPT가 **캡처(스크린샷)를 이미지 파일로 저장**하고, Claude가 그 이미지를 읽어서 판단한다. 캡처는 CDP(`--remote-debugging-port`)나 앱 자체 캡처 기능으로 만든다.',
      '- Claude가 직접 하는 일은 지시서 작성, GPT 보고·diff·중간 결과 검토, 판단과 결정, 사용자와의 소통이다.',
      '- 이 원칙은 YAL IDE가 관리하는 모든 프로젝트에 적용된다.',
      '',
      '## 워크플로',
      '1. Claude가 작업을 작은 단위로 쪼개 지시서(목표, 대상 파일, 제약, 완료 조건)를 작성한다.',
      '2. 지시서를 `scripts/gpt.sh "<지시서>"` 로 GPT에게 전달한다. (내부적으로 `codex exec` 실행)',
      '3. GPT가 워크스페이스에 결과물을 작성한다.',
      '4. Claude가 `git diff`와 실행/테스트로 검수하고, 문제가 있으면 수정 지시서를 다시 보낸다.',
      '5. 통과하면 Claude가 통합한다.',
      '',
      '## 규칙',
      '- 결과물(코드/파일) 생성은 기본적으로 GPT에게 위임한다. Claude는 사소한 수정·검수 보정·설정 파일 외에는 직접 작성하지 않는다.',
      '- 지시서는 모호하지 않게: 파일 경로, 입출력, 스타일, 금지사항, 완료 조건을 명시한다.',
      '- GPT 결과는 반드시 검수 후 반영한다. 검증 없이 완료로 보고하지 않는다.',
      '- 커밋/푸시는 사용자가 요청할 때만 한다.',
      '- GPT 모델은 반드시 gpt-6.1-sol(Sol)로 쓴다. scripts/gpt.sh가 --model로 고정한다.',
      '',
      '## IDE 공유 스킬',
      '- 모든 프로젝트에 적용되는 공유 스킬 변경은 반드시 node "<YAL_SKILL_TOOL의 전체 경로>" 도구로만 한다. YAL_SKILL_TOOL은 <userData>/tools/yal-skill.cjs 전체 경로이며 IDE가 제공한다.',
      '- Bash: node "$YAL_SKILL_TOOL" set <name> --file <path> --summary "변경 이유" --author claude|gpt. PowerShell: node "$env:YAL_SKILL_TOOL" 로 실행한다.',
      '- 목록/내용/로그: list, show <name>, log. 삭제: remove <name> --summary "삭제 이유".',
      '- YAL_SKILLS_DIR은 IDE 전체 공유 저장소다. 원본과 .claude/skills/*의 YAL 관리 복사본을 손으로 수정하지 않는다. 사용자의 관리 창은 읽기 전용이다.',
      ''
    ].join('\n')
  )
}

const GPT_SH_MODEL_ONLY =
  [
    '#!/usr/bin/env bash',
    '# Claude(디렉터) -> GPT(제작자) 위임 스크립트',
    '# 사용법: scripts/gpt.sh "지시서 텍스트"   또는   echo "지시서" | scripts/gpt.sh -',
    '# 모델: 기본은 gpt-6.1-sol 로 고정한다. 바꾸려면 GPT_MODEL 환경변수를 지정한다.',
    '# --approve-for-me: Windows에서 workspace-write 샌드박스가 읽기전용으로 떨어지는 문제를 피하기 위해 사용',
    'set -euo pipefail',
    'ROOT="$(cd "$(dirname "$0")/.." && pwd)"',
    'PROMPT="${1:--}"',
    'MODEL="${GPT_MODEL:-gpt-6.1-sol}"',
    'exec codex exec \\',
    '  --model "$MODEL" \\',
    '  --cd "$ROOT" \\',
    '  --approve-for-me \\',
    '  --skip-git-repo-check \\',
    '  "$PROMPT"',
    ''
  ].join('\n')

// Frozen previous generated versions: compare the entire file, never a substring.
// The no-model predecessor uses the same shell body from the IDE shell plan.
export const PREVIOUS_GPT_SH = [
  GPT_SH_MODEL_ONLY.split('\n').filter(line => !line.startsWith('# 모델:')
    && !line.startsWith('MODEL=') && !line.includes('--model "$MODEL"')).join('\n'),
  GPT_SH_MODEL_ONLY
] as const

export const GPT_SH = GPT_SH_MODEL_ONLY.replace('exec codex exec', 'run_codex() {\n  codex exec')
  .replace('  "$PROMPT"\n', '  "$PROMPT"\n}\n') + [
  'if [[ -z "${YAL_GPT_LOG:-}" ]]; then',
  '  run_codex',
  '  exit $?',
  'fi',
  'mkdir -p "$(dirname "$YAL_GPT_LOG")"',
  'ORDER="$PROMPT"',
  'if [[ "$PROMPT" == "-" ]]; then ORDER="$(cat)"; fi',
  'ORDER_LINE="$(printf "%s" "$ORDER" | tr "\\r\\n\\t" "   " | tr -d "[:cntrl:]")"',
  'printf "=== [YAL-GPT] start %s model=%s ===\\n" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$MODEL" | tee -a "$YAL_GPT_LOG"',
  'printf "=== [YAL-GPT] order %s ===\\n" "${ORDER_LINE:0:160}" | tee -a "$YAL_GPT_LOG"',
  'set +e',
  'if [[ "$PROMPT" == "-" ]]; then',
  '  run_codex <<< "$ORDER" 2>&1 | tee -a "$YAL_GPT_LOG"',
  '  CODE=${PIPESTATUS[0]}',
  'else',
  '  run_codex 2>&1 | tee -a "$YAL_GPT_LOG"',
  '  CODE=${PIPESTATUS[0]}',
  'fi',
  // A newline keeps the end marker separate even when codex has no final newline.
  'printf "\\n=== [YAL-GPT] end %s exit=%s ===\\n" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$CODE" | tee -a "$YAL_GPT_LOG"',
  'exit "$CODE"',
  ''
].join('\n')
