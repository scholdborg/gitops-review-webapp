#!/usr/bin/env bash
# flow-language-guard.sh — PostToolUse hook (matcher: Write|Edit|MultiEdit)
# Policy: the "flow" text box (<p id="flow-text"> in public/index.html) must be
# written in Swedish. After Claude writes/edits a file, this runs the language
# check. If the flow text is NOT Swedish, it exits 2 so Claude is told to fix it
# (the edit itself is not undone — exit 2 surfaces the message to the model).
#
# To make this a non-blocking warning instead, change the `exit 2` below to
# `exit 0` (same style as local-review.sh).

set -uo pipefail

cd "${CLAUDE_PROJECT_DIR:-.}" || {
  echo "[flow-language] could not cd into project dir; skipping." >&2
  exit 0
}

if output="$(node scripts/check-flow-language.mjs 2>&1)"; then
  echo "[flow-language] PASS — flow text is Swedish." >&2
  exit 0
else
  echo "[flow-language] BLOCKED — the flow text box must be in Swedish." >&2
  echo "$output" | grep -E "FAIL|Hint:|English words:" >&2
  exit 2
fi
