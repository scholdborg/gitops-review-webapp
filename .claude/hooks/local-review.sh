#!/usr/bin/env bash
# local-review.sh — PostToolUse hook (matcher: Write|Edit|MultiEdit)
#
# After Claude writes or edits a file this hook does three things:
#   1. Runs the project-wide review        (npm run review).
#   2. Runs targeted checks on the SPECIFIC file Claude just edited
#      (scripts/review-file.mjs), using the file path from the tool payload.
#   3. Feeds a combined summary back to Claude as `additionalContext` (PostToolUse
#      JSON output), so the assistant — not just the human — sees the result.
#
# By default it BLOCKS on high-severity per-file findings (merge markers and
# real ESLint errors): those return exit 2 and stop the turn so they get fixed.
# Advisory "warn" findings never block. Set LOCAL_REVIEW_BLOCK=0 to make the
# hook fully advisory (always exit 0) instead.

set -uo pipefail

input="$(cat)"

cd "${CLAUDE_PROJECT_DIR:-.}" || {
  echo "[local-review] could not cd into project dir; skipping." >&2
  exit 0
}

# --- 1. Which file did Claude touch? (read tool_name + file_path from stdin) --
meta="$(HOOK_JSON="$input" python3 - <<'PY' 2>/dev/null
import os, json
try:
    d = json.loads(os.environ.get("HOOK_JSON", "") or "{}")
except Exception:
    d = {}
print(d.get("tool_name", ""))
print((d.get("tool_input") or {}).get("file_path", ""))
PY
)"
tool="$(printf '%s\n' "$meta" | sed -n '1p')"
file="$(printf '%s\n' "$meta" | sed -n '2p')"

# --- 2. Project-wide review --------------------------------------------------
proj_out="$(npm run review 2>&1)"; proj_rc=$?
proj_result="$(printf '%s\n' "$proj_out" | grep -E 'Result:' | tail -1)"

# --- 3. Targeted review of the edited file -----------------------------------
file_out=""
file_rc=0
if [ -n "$file" ] && [ -f "$file" ]; then
  file_out="$(node scripts/review-file.mjs "$file" 2>&1)"; file_rc=$?
fi

# --- 4. Build a combined summary ---------------------------------------------
summary="$(
  printf 'local-review (PostToolUse, after %s)\n' "${tool:-edit}"
  printf 'project review: %s\n' "${proj_result:-unknown}"
  if [ -n "$file_out" ]; then
    printf '%s\n' "$file_out"
  elif [ -n "$file" ]; then
    printf 'file review: skipped (%s not on disk)\n' "$file"
  fi
)"

# --- 5. Human-readable output (to stderr, for the transcript) ----------------
{
  echo "[local-review] ---------------------------------"
  printf '%s\n' "$summary"
  if [ "$proj_rc" -ne 0 ]; then
    printf '%s\n' "$proj_out" | grep -E '  FAIL' || true
    echo "[local-review] project review FAILED (advisory, not blocking)."
  fi
  echo "[local-review] ---------------------------------"
} >&2

# --- 6. Decide exit code -----------------------------------------------------
exit_code=0
if [ "${LOCAL_REVIEW_BLOCK:-1}" = "1" ] && [ "$file_rc" -ne 0 ]; then
  exit_code=2
fi

# --- 7. Feed the summary back to Claude as additionalContext -----------------
# (Only on the non-blocking path; when blocking we rely on exit 2 + stderr.)
if [ "$exit_code" -eq 0 ]; then
  SUMMARY="$summary" python3 - <<'PY' 2>/dev/null || true
import os, json
print(json.dumps({
    "hookSpecificOutput": {
        "hookEventName": "PostToolUse",
        "additionalContext": os.environ.get("SUMMARY", ""),
    },
    "suppressOutput": True,
}))
PY
fi

exit "$exit_code"
