# Hooks Lab Notes

Notes for the Claude Code hooks lab built on top of **GitOps Review Webapp**.
The project demonstrates how three project-level hooks map onto the Claude Code
hook lifecycle, supporting a GitOps-style flow: commit → review → build → deploy.

## The three hooks

| Hook            | Lifecycle event | Matcher                  | Script                         |
| --------------- | --------------- | ------------------------ | ------------------------------ |
| `guard-dog`     | `PreToolUse`    | `Bash`                   | `.claude/hooks/guard-dog.sh`   |
| `local-review`  | `PostToolUse`   | `Write\|Edit\|MultiEdit` | `.claude/hooks/local-review.sh`|
| `deploy-status` | `Stop`          | _(none — runs always)_   | `.claude/hooks/deploy-status.sh`|
| `flow-language-guard` | `PostToolUse` | `Write\|Edit\|MultiEdit` | `.claude/hooks/flow-language-guard.sh` |

All three are registered in `.claude/settings.json` (project scope), so they
apply to anyone who opens this repo in Claude Code.

## Lifecycle event used by each, and why I chose it

### `guard-dog` → `PreToolUse`

- **Why this event:** `PreToolUse` fires *before* a tool runs and can **block**
  it by exiting with code `2`. That makes it the right place to stop dangerous
  Bash commands before they can do damage.
- **Why these commands:** `rm -rf`, `git push --force`, `gh repo delete`,
  `git reset --hard`, and `npm publish` are all hard or impossible to undo. In
  a GitOps flow we want Git history and the remote to stay trustworthy, so these
  are blocked by default.

### `local-review` → `PostToolUse`

- **Why this event:** `PostToolUse` fires *after* a tool succeeds. After Claude
  writes or edits a file, it's the natural moment to re-run the review and get
  fast feedback — the same review that gates deployment in CI.
- **What it does (beyond the basics):** it is *file-aware*. It reads the edited
  file's path from the tool payload (`tool_input.file_path`) and runs
  `scripts/review-file.mjs` on that one file — on top of the project-wide
  `npm run review`. For JavaScript it runs the **real ESLint engine** (flat
  config in `eslint.config.js`); for other files it does light text checks
  (merge markers, `TODO/FIXME`, long lines, missing `alt`/`lang` in HTML).
- **Why ESLint over regex:** the first version grepped for the word `debugger`
  and wrongly flagged it inside the string `"no-debugger"` in the ESLint config.
  ESLint parses the code, so it doesn't make that mistake. Real tool > regex.
- **It talks back to Claude:** instead of only printing to the transcript, it
  emits PostToolUse JSON with `hookSpecificOutput.additionalContext`, so the
  combined summary is injected into the assistant's context and it can act on
  the findings.
- **Blocking by default:** ERROR-level findings (merge markers, ESLint errors)
  return exit `2` and stop the turn so they get fixed; `warn` findings never
  block. Set `LOCAL_REVIEW_BLOCK=0` to make it fully advisory. ESLint is *also*
  a CI gate (`npm run lint` in the workflow), so a lint error blocks deploy too.

### `deploy-status` → `Stop`

- **Why this event:** `Stop` fires when Claude finishes responding — a good
  point to summarize state. It prints a GitOps-style status (branch, clean/dirty
  tree, review pass/fail, build pass/fail) and reminds you that deployment
  happens from GitHub Actions after pushing to `main`. It is purely
  informational and always exits `0`.

### `flow-language-guard` → `PostToolUse`

- **Why this event:** like `local-review`, it reacts to edits — but instead of
  the generic review it enforces a *content policy*: the flow text box
  (`<p id="flow-text">` in `public/index.html`) must be in Swedish.
- **Why blocking (exit 2):** the rule is a hard requirement ("must be Swedish"),
  so a violation exits `2` to surface the problem to Claude rather than just
  printing a warning. Flip the `exit 2` in the script to `exit 0` for warn-only.
- **How it decides:** `scripts/check-flow-language.mjs` extracts the paragraph,
  then PASSes only if it has Swedish signals (`å/ä/ö` or ≥2 Swedish marker
  words) *and* contains no English marker words. It is a deterministic heuristic,
  not a real language detector — fine for a lab, easy to extend.

## How I verified them with `/hooks`

1. Open this project in Claude Code.
2. Run the `/hooks` slash command.
3. Confirm all three appear, sourced from project settings:
   - `PreToolUse` → matcher `Bash` → `guard-dog.sh`
   - `PostToolUse` → matcher `Write|Edit|MultiEdit` → `local-review.sh`
   - `Stop` → `deploy-status.sh`

If a hook is missing, check that `.claude/settings.json` is valid JSON and that
the script paths use `$CLAUDE_PROJECT_DIR`.

## How I tested them

You can trigger each hook through Claude, or run the scripts directly.

### Through Claude

- **`guard-dog`:** ask Claude to run `rm -rf ./tmp-x` → blocked with
  `[guard-dog] BLOCKED: ...`. Ask it to run `ls -la` → runs normally.
- **`local-review`:** ask Claude to edit a file → after the edit the hook prints
  `[local-review] PASS` (or a non-blocking `FAIL` summary).
- **`deploy-status`:** let Claude finish a turn → the `===== GitOps status =====`
  block prints.

### Directly from a terminal

```bash
# guard-dog: simulate a blocked Bash command (expect exit code 2)
echo '{"tool_input":{"command":"rm -rf /"}}' | bash .claude/hooks/guard-dog.sh; echo "exit=$?"

# guard-dog: a safe command (expect exit code 0)
echo '{"tool_input":{"command":"ls -la"}}' | bash .claude/hooks/guard-dog.sh; echo "exit=$?"

# local-review: run the post-edit review (always exit 0)
CLAUDE_PROJECT_DIR="$(pwd)" bash .claude/hooks/local-review.sh; echo "exit=$?"

# deploy-status: print the status summary (always exit 0)
CLAUDE_PROJECT_DIR="$(pwd)" bash .claude/hooks/deploy-status.sh; echo "exit=$?"
```

## One thing that could fail, and how to debug it

**Symptom:** the `local-review`/`deploy-status` hooks print nothing useful, or
`guard-dog` doesn't block.

**Likely causes & fixes:**

- **Hooks not registered.** Run `/hooks`. If they're missing, validate
  `.claude/settings.json` with `node -e "JSON.parse(require('fs').readFileSync('.claude/settings.json'))"`.
- **Script not executable / wrong path.** The settings invoke the scripts via
  `bash "$CLAUDE_PROJECT_DIR/.claude/hooks/<name>.sh"`, so they run even without
  the executable bit — but if you call them directly, `chmod +x .claude/hooks/*.sh`.
- **`guard-dog` JSON parsing.** It uses `python3` to read `.tool_input.command`
  from stdin, with a `grep` fallback. Test parsing in isolation with the
  `echo '{"tool_input":{"command":"..."}}' | bash ...` commands above and check
  the printed `[guard-dog] Command:` line.
- **Review fails in CI but not locally.** The review scans project source files;
  make sure no secret-like strings (`API_KEY`, `SECRET`, `TOKEN=`, `password=`),
  `console.log` (in `src/main.js`), or `TODO` markers slipped into production
  files. Run `npm run review` locally to see the exact failing check.
