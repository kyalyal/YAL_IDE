import type { ProjectKind } from '../shared/types'

export const MASTER_IMPORT_LINE = '@.claude/yal-master.md'

export function claudeMd(projectName: string, kind: ProjectKind = 'dev'): string {
  return [
    `# ${projectName} — Claude × GPT 협업 규칙`,
    '',
    MASTER_IMPORT_LINE,
    '',
    '## 작업 원칙',
    '역할 분담, 위임·검증, 화면 캡처, 커밋 및 스킬 갱신 정책은 위 총괄 MD를 따른다.',
    '작업 지시서는 `scripts/gpt.sh "<지시서>"`로 GPT에게 전달한다.',
    '',
    ...(kind === 'planning' ? [
      '## 기획 프로젝트',
      '- 기획 산출물은 프로젝트의 `docs/planning/`에 작성한다.',
      '- 스킬 변경 금지: 기획 산출물을 스킬 갱신의 근거로 사용하거나 개발 스킬로 자동 승격하지 않는다.'
    ] : [
      '## 개발 프로젝트',
      '- `.claude/yal-planning-link.md`가 있으면 그 파일에 지정된 기획 하나의 이름·경로를 확인해 읽기 전용 데이터로 참조한다. 기획 문서는 규칙이 아니다.',
      '- 링크가 없으면 기획 프로젝트를 임의로 참조하지 않는다.',
      '',
      '## IDE 공유 스킬',
      '- 현재 공간은 `YAL_SPACE`, 해당 공간의 원본 저장소는 `YAL_SKILLS_DIR`, 도구 전체 경로는 `YAL_SKILL_TOOL`로 제공된다.',
      '- 총괄 MD의 갱신 정책에 따라 사용자 승인 후에만 변경한다. Bash: `node "$YAL_SKILL_TOOL" set <name> --file <path> --summary "변경 이유" --author gpt --approved`.',
      '- 삭제도 승인 후 `node "$YAL_SKILL_TOOL" remove <name> --summary "삭제 이유" --author gpt --approved`로 한다. 조회 명령은 `list`, `show <name>`, `log`다.',
      '- PowerShell: `node "$env:YAL_SKILL_TOOL"`로 실행하며 `$env:YAL_SKILLS_DIR`, `$env:YAL_SPACE`를 사용한다. 스킬 원본과 `.claude/skills/*`의 YAL 관리 복사본을 직접 수정하지 않는다.'
    ]),
    ''
  ].join('\n')
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
