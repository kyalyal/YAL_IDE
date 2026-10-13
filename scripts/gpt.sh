#!/usr/bin/env bash
# Claude 디렉터가 GPT 수행자에게 전달하는 지시서 실행기
set -euo pipefail
if [[ "${YAL_GPT_WORKER:-}" == "1" ]]; then
  echo "GPT 워커는 외부 CLI를 재호출할 수 없다" >&2
  exit 1
fi
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ORDER="${1:--}"
if [[ "$ORDER" == "-" ]]; then ORDER="$(cat)"; fi
MODEL="${GPT_MODEL:-gpt-6.1-sol}"
RULES='너는 수행자다. 외부 CLI 재호출 금지, 내부 서브에이전트는 허용. Claude에게 질문·제안 금지. 끝까지 직접 수행하고 결과를 파일로 저장. 결과 보고서에는 사실·산출물·검증 결과만.
외부 CLI(codex/claude/scripts/gpt.sh) 재호출과 다른 GPT 세션의 신규 실행은 금지한다. Codex 내부 서브에이전트·병렬 워커는 허용하며 필요에 따라 활용한다.
Claude는 디렉터다. 사용자와 대화하고 지시서를 전달하며 결과 검수 후 필요하면 새 지시서를 내린다.
합리적 기본값으로 조사·설계·구현·검증·실행 확인·캡처를 직접 수행한다.
커밋/푸시는 사용자가 요청한 경우에만 한다.'
PROMPT="$RULES"$'\n\n'"$ORDER"
if [[ -n "${YAL_MASTER_PATH:-}" && -f "$YAL_MASTER_PATH" ]]; then PROMPT="$PROMPT"$'\n\n'"$(cat "$YAL_MASTER_PATH")"; fi
if [[ -n "${YAL_SKILLS_DIR:-}" && -d "$YAL_SKILLS_DIR" ]]; then
  for SKILL_FILE in "$YAL_SKILLS_DIR"/*/SKILL.md; do
    if [[ -f "$SKILL_FILE" ]]; then PROMPT="$PROMPT"$'\n\n'"$(cat "$SKILL_FILE")"; fi
  done
fi
if [[ "${YAL_PERMISSION:-workspace-write}" == "read-only" ]]; then
  PROMPT="$PROMPT"$'\n\n읽기 전용 작업이다. 프로젝트 파일을 수정하지 않고 사실·산출물·검증 결과를 최종 출력으로 작성한다.'
fi
PROMPT="$PROMPT"$'\n\n'"$RULES"
# Clear a potentially inherited export attribute: this identity stays shell-local.
unset YAL_GPT_RUN_ID
YAL_GPT_RUN_ID="$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n')"
[[ "$YAL_GPT_RUN_ID" =~ ^[0-9a-f]{32}$ ]] || exit 1
SHIM=""
INPUT_DIR=""
LOG_STARTED=0
finish() {
  local code=$?
  trap - EXIT
  if [[ "$LOG_STARTED" == "1" ]]; then
    printf "\n=== [YAL-GPT] end %s exit=%s run=%s ===\n" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$code" "$YAL_GPT_RUN_ID" | tee -a "$YAL_GPT_LOG"
  fi
  if [[ -n "$INPUT_DIR" ]]; then rm -rf -- "$INPUT_DIR"; fi
  if [[ -n "$SHIM" ]]; then rm -rf -- "$SHIM"; fi
  exit "$code"
}
trap finish EXIT
trap 'exit 130' INT TERM
if [[ -n "${YAL_GPT_LOG:-}" ]]; then
  mkdir -p "$(dirname "$YAL_GPT_LOG")"
  LOG_STARTED=1
  ORDER_LINE="$(printf "%s" "$ORDER" | tr "\r\n\t" "   " | tr -d "[:cntrl:]")"
  printf "=== [YAL-GPT] start %s model=%s run=%s ===\n" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$MODEL" "$YAL_GPT_RUN_ID" | tee -a "$YAL_GPT_LOG"
  printf "=== [YAL-GPT] order %s run=%s ===\n" "${ORDER_LINE:0:160}" "$YAL_GPT_RUN_ID" | tee -a "$YAL_GPT_LOG"
fi
# Resolve the authorized CLI before adding worker-only blocking shims.
CODEX_BIN="$(command -v codex)"
SHIM="$(mktemp -d "${TMPDIR:-/tmp}/yal-gpt-shims.XXXXXXXX")"
for CLI in codex claude gpt.sh; do
  printf '#!/bin/sh\necho "GPT 수행자는 GPT/Claude를 호출할 수 없다" >&2\nexit 1\n' > "$SHIM/$CLI"
  chmod +x "$SHIM/$CLI"
  printf '@echo off\r\necho GPT worker cannot invoke GPT/Claude 1>&2\r\nexit /b 1\r\n' > "$SHIM/$CLI.cmd"
  printf 'Write-Error "GPT worker cannot invoke GPT/Claude"\nexit 1\n' > "$SHIM/$CLI.ps1"
done
# Keep large orders and shell syntax out of Windows native command lines.
INPUT_DIR="$(mktemp -d "${TMPDIR:-/tmp}/yal-gpt-input.XXXXXXXX")"
INPUT_FILE="$INPUT_DIR/order.md"
printf '%s' "$PROMPT" > "$INPUT_FILE"
if command -v cygpath >/dev/null 2>&1; then INPUT_FILE="$(cygpath -w "$INPUT_FILE")"; fi
BOOTSTRAP="$RULES"$'\n'"전체 UTF-8 지시서 파일을 읽고 수행한다: $INPUT_FILE"
run_codex() {
  env YAL_GPT_WORKER=1 PATH="$SHIM:$PATH" "$CODEX_BIN" exec \
    --model "$MODEL" \
    --cd "$ROOT" \
    --approve-for-me \
    --skip-git-repo-check \
    "$BOOTSTRAP" < /dev/null
}
# Read and emit each line immediately; Bash builtins avoid a fork per paragraph.
timestamp_paragraphs() {
  local line at_start=1
  while IFS= read -r line || [[ -n "$line" ]]; do
    if [[ "$line" =~ ^[[:space:]]*$ ]]; then
      at_start=1
    elif [[ "$at_start" == "1" ]]; then
      printf '=== [YAL-GPT] t %(%FT%T%z)T ===\n' -1
      at_start=0
    fi
    # Child output is data, even when it echoes a valid control marker or ANSI.
    if [[ "$line" == *'[YAL-GPT]'* ]]; then
      printf '> %s\n' "$line"
    else
      printf '%s\n' "$line"
    fi
  done
}
set +e
if [[ "$LOG_STARTED" == "1" ]]; then
  run_codex 2>&1 | timestamp_paragraphs | tee -a "$YAL_GPT_LOG"
  CODE=${PIPESTATUS[0]}
else
  run_codex
  CODE=$?
fi
exit "$CODE"
