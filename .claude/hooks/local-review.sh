#!/usr/bin/env bash
# local-review.sh — PostToolUse hook (matcher: Write|Edit|MultiEdit)
# After Claude writes or edits a file, run the project's review script and
# print a short result. This hook NEVER blocks editing: it always exits 0,
# even when the review fails, so the project can still be built up. It just
# surfaces the current review status as feedback.

set -uo pipefail

# Run from the project root. CLAUDE_PROJECT_DIR is provided by Claude Code.
cd "${CLAUDE_PROJECT_DIR:-.}" || {
  echo "[local-review] could not cd into project dir; skipping." >&2
  exit 0
}

echo "[local-review] running 'npm run review'..." >&2

if output="$(npm run review 2>&1)"; then
  echo "[local-review] PASS — review is green." >&2
else
  echo "[local-review] FAIL — review reported problems (not blocking):" >&2
  # Show just the FAIL lines and the final Result line for a short summary.
  echo "$output" | grep -E "FAIL|Result:" >&2 || echo "$output" | tail -n 5 >&2
fi

exit 0
