#!/usr/bin/env bash
# guard-dog.sh — PreToolUse hook (matcher: Bash)
# Reads the tool-call JSON from stdin, inspects the proposed Bash command,
# and blocks risky commands by exiting with code 2 (which tells Claude Code
# to stop the tool call and show the message to the model).

set -uo pipefail

input="$(cat)"

# Extract .tool_input.command from the JSON. Prefer python3 (always available
# on macOS / GitHub runners); fall back to a crude grep if it is not.
command_str=""
if command -v python3 >/dev/null 2>&1; then
  command_str="$(printf '%s' "$input" | python3 -c '
import sys, json
try:
    data = json.load(sys.stdin)
    print(data.get("tool_input", {}).get("command", ""))
except Exception:
    print("")
')"
else
  command_str="$(printf '%s' "$input" | grep -o '"command"[[:space:]]*:[[:space:]]*"[^"]*"' | sed 's/.*:[[:space:]]*"//; s/"$//')"
fi

# Each entry: a regex pattern and a human-readable reason.
block() {
  echo "[guard-dog] BLOCKED: $1" >&2
  echo "[guard-dog] Command: ${command_str}" >&2
  echo "[guard-dog] This command is blocked by the project PreToolUse hook." >&2
  exit 2
}

case "$command_str" in
  *"rm -rf"*)            block "destructive recursive delete (rm -rf)";;
  *"git push --force"*)  block "force push (git push --force)";;
  *"git push -f"*)       block "force push (git push -f)";;
  *"gh repo delete"*)    block "repository deletion (gh repo delete)";;
  *"git reset --hard"*)  block "hard reset discards work (git reset --hard)";;
  *"npm publish"*)       block "package publish (npm publish)";;
esac

# Nothing matched — allow the command.
exit 0
