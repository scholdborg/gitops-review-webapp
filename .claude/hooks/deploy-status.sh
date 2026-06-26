#!/usr/bin/env bash
# deploy-status.sh — Stop hook
# Prints a short GitOps-style status summary when Claude finishes responding.
# Purely informational: it never fails the session and always exits 0.

set -uo pipefail

cd "${CLAUDE_PROJECT_DIR:-.}" 2>/dev/null || exit 0

echo "" >&2
echo "===== GitOps status =====" >&2

# --- Git branch + working tree ----------------------------------------------
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")"
  echo "Branch:       ${branch}" >&2
  if [ -z "$(git status --porcelain 2>/dev/null)" ]; then
    echo "Working tree: clean" >&2
  else
    echo "Working tree: dirty (uncommitted changes)" >&2
  fi
else
  echo "Branch:       (not a git repository yet)" >&2
  echo "Working tree: n/a" >&2
fi

# --- Review check ------------------------------------------------------------
if npm run review >/dev/null 2>&1; then
  echo "Review:       PASS" >&2
else
  echo "Review:       FAIL" >&2
fi

# --- Build check -------------------------------------------------------------
if npm run build >/dev/null 2>&1; then
  echo "Build:        PASS" >&2
else
  echo "Build:        FAIL" >&2
fi

echo "-------------------------" >&2
echo "Reminder: deployment happens from GitHub Actions after you push to 'main'." >&2
echo "=========================" >&2

exit 0
