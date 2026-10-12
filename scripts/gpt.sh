#!/usr/bin/env bash
# Claude(디렉터) -> GPT(제작자) 위임 스크립트
# 사용법: scripts/gpt.sh "지시서 텍스트"   또는   echo "지시서" | scripts/gpt.sh -
# 모델: 기본은 gpt-6.1-sol 로 고정한다. 바꾸려면 GPT_MODEL 환경변수를 지정한다.
# --approve-for-me: Windows에서 workspace-write 샌드박스가 읽기전용으로 떨어지는 문제를 피하기 위해 사용
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROMPT="${1:--}"
MODEL="${GPT_MODEL:-gpt-6.1-sol}"
run_codex() {
  codex exec \
  --model "$MODEL" \
  --cd "$ROOT" \
  --approve-for-me \
  --skip-git-repo-check \
  "$PROMPT"
}
if [[ -z "${YAL_GPT_LOG:-}" ]]; then
  run_codex
  exit $?
fi
mkdir -p "$(dirname "$YAL_GPT_LOG")"
ORDER="$PROMPT"
if [[ "$PROMPT" == "-" ]]; then ORDER="$(cat)"; fi
ORDER_LINE="$(printf "%s" "$ORDER" | tr "\r\n\t" "   " | tr -d "[:cntrl:]")"
printf "=== [YAL-GPT] start %s model=%s ===\n" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$MODEL" | tee -a "$YAL_GPT_LOG"
printf "=== [YAL-GPT] order %s ===\n" "${ORDER_LINE:0:160}" | tee -a "$YAL_GPT_LOG"
set +e
if [[ "$PROMPT" == "-" ]]; then
  run_codex <<< "$ORDER" 2>&1 | tee -a "$YAL_GPT_LOG"
  CODE=${PIPESTATUS[0]}
else
  run_codex 2>&1 | tee -a "$YAL_GPT_LOG"
  CODE=${PIPESTATUS[0]}
fi
printf "\n=== [YAL-GPT] end %s exit=%s ===\n" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$CODE" | tee -a "$YAL_GPT_LOG"
exit "$CODE"
