# GitOps Review Webapp

A tiny static webapp that demonstrates an **ArgoCD/GitOps-inspired workflow** for
a Claude Code hooks lab:

```text
Commit → Review → Build → Deploy
```

A code change is automatically reviewed, then built, and only deployed to
**GitHub Pages** if every check passes. **GitHub Actions** is the gate that
decides whether a change is allowed to go live.

---

## What this project is

- A small static site (plain HTML / CSS / JS) under `public/` and `src/`.
- A deterministic "code review" script (`scripts/simple-review.mjs`) that acts
  as an automated quality gate.
- A GitHub Actions workflow that runs review → build → deploy to GitHub Pages.
- Three **project-level Claude Code hooks** (in `.claude/settings.json`) that
  illustrate the Claude Code hook lifecycle.

## The GitOps-inspired flow

1. **Commit** — you change code and commit it to Git. Git is the source of truth.
2. **Review** — `npm run review` runs deterministic checks (required files,
   `<title>`, no secrets, no `console.log`, no `TODO`).
3. **Build** — `npm run build` assembles the deployable site into `dist/`.
4. **Deploy** — GitHub Actions publishes `dist/` to GitHub Pages **only if**
   review and build pass.

### Why GitHub Pages is the live webserver

GitHub Pages hosts static sites directly from your repository — no servers,
containers, VPS, or secrets to manage. For a static demo it is the simplest
possible "production": push to `main`, and the published artifact becomes the
live site.

### Why GitHub Actions is the deployment gate

GitHub Actions runs the review and build on every push to `main`. The `deploy`
job `needs` the `review-build` job, so **if review or build fails, nothing is
deployed**. This is the GitOps gate: the live site can only ever reflect a
commit that passed all checks.

---

## ArgoCD-like, but not real ArgoCD

This demo borrows ArgoCD's core principle — **Git is the source of truth and
you deploy only after checks pass** — but it is deliberately small.

Real ArgoCD continuously **reconciles Kubernetes cluster state** against the
desired state declared in Git, constantly correcting drift. This project has no
Kubernetes, no controller, and no continuous reconciliation. Instead it uses
GitHub Actions (the gate) and GitHub Pages (the host) to keep the same idea
tiny and dependency-free.

---

## Local commands

```bash
npm run review   # run the deterministic code review (exits non-zero on failure)
npm run build    # build the site into dist/
npm run check    # review + build
```

To preview the built site locally:

```bash
npm run build
open dist/index.html        # macOS — or serve dist/ with any static server
```

---

## The three Claude Code hooks

All three are **project-scoped** hooks, configured in
[`.claude/settings.json`](.claude/settings.json), with scripts in
`.claude/hooks/`.

| Hook            | Event         | Matcher              | Scope   | Purpose                                            |
| --------------- | ------------- | -------------------- | ------- | -------------------------------------------------- |
| `guard-dog`     | `PreToolUse`  | `Bash`               | project | Block risky Bash commands before they run.         |
| `local-review`  | `PostToolUse` | `Write\|Edit\|MultiEdit` | project | Run `npm run review` after Claude edits files.     |
| `deploy-status` | `Stop`        | _(none)_             | project | Print a GitOps status summary when Claude is done. |
| `flow-language-guard` | `PostToolUse` | `Write\|Edit\|MultiEdit` | project | Require the `#flow-text` box in `index.html` to be Swedish; block (exit 2) if not. |

### 1. `guard-dog` (PreToolUse, matcher `Bash`)

Reads the tool-call JSON from stdin, inspects the proposed Bash command, and
**blocks** by exiting with code `2` if it matches a risky pattern:

- `rm -rf`
- `git push --force` / `git push -f`
- `gh repo delete`
- `git reset --hard`
- `npm publish`

Anything else exits `0` (allowed).

### 2. `local-review` (PostToolUse, matcher `Write|Edit|MultiEdit`)

After Claude writes or edits a file, this hook does three things:

1. **Project-wide review** — runs `npm run review` from `$CLAUDE_PROJECT_DIR`.
2. **Targeted, file-aware review** — reads the edited file's path from the tool
   payload (`tool_input.file_path`) and runs `scripts/review-file.mjs` on just
   that file. It applies file-type-specific checks:
   - **any file:** merge-conflict markers (`<<<<<<<`), unfinished-work markers
     (`TODO`/`FIXME`/`XXX`/`HACK`), trailing whitespace, lines over 120 chars.
   - **`.js` / `.mjs`:** leftover `debugger` statements, `console.log/debug/info`.
   - **`.html`:** `<img>` without `alt`, `<html>` without a `lang` attribute.
   - large-file warning (> 200 KB).
   Findings are graded **ERROR** (high severity: merge markers, `debugger`) or
   **warn** (advisory).
3. **Feeds the result back to Claude** — emits PostToolUse JSON with
   `hookSpecificOutput.additionalContext`, so the *assistant* sees the combined
   summary and can react, not just the human reading the transcript.

By default it is **advisory and never blocks** (always exits `0`). Set
`LOCAL_REVIEW_BLOCK=1` (an env var) to make ERROR-level per-file findings return
exit `2` and stop the turn instead. Run the per-file check by hand with
`npm run review:file -- <path>`.

### 3. `deploy-status` (Stop)

When Claude finishes responding, prints a short GitOps status: current git
branch, whether the working tree is clean, whether `npm run review` passes,
whether `npm run build` passes, and a reminder that deployment happens from
GitHub Actions after pushing to `main`. Always exits `0`; never fails the
session.

### 4. `flow-language-guard` (PostToolUse, matcher `Write|Edit|MultiEdit`)

A content-policy example. The "flow" text box is marked with `id="flow-text"` in
`public/index.html`. After any edit, this hook runs
`node scripts/check-flow-language.mjs`, which extracts that paragraph and
verifies it is written in **Swedish** (requires `å/ä/ö` or Swedish marker words,
and rejects English marker words). If the text is not Swedish the hook **exits
`2`**, so Claude is told to fix it. (Change the `exit 2` in the script to
`exit 0` to make it a non-blocking warning instead.) Run the check standalone
with `npm run check:flow-language`.

---

## Verify the hooks with `/hooks`

In Claude Code, run the slash command:

```text
/hooks
```

You should see all three hooks registered from the project settings:

- **PreToolUse** → matcher `Bash` → `guard-dog.sh`
- **PostToolUse** → matcher `Write|Edit|MultiEdit` → `local-review.sh`
- **Stop** → `deploy-status.sh`

## Test each hook

**`guard-dog` (should be blocked):** ask Claude to run a harmless-looking but
matching command, e.g. `rm -rf ./tmp-does-not-exist`. The PreToolUse hook
exits `2` and the command is blocked with a `[guard-dog] BLOCKED: ...` message.
A non-matching command such as `ls -la` runs normally.

**`local-review` (runs after edits):** ask Claude to edit any file (e.g. add a
comment to `src/main.js`). After the edit, the PostToolUse hook prints
`[local-review] PASS — review is green.` (or a non-blocking `FAIL` summary).

**`deploy-status` (runs at the end):** simply let Claude finish a response. The
Stop hook prints the `===== GitOps status =====` block with branch, tree
status, review, build, and the deploy reminder.

You can also run the hook scripts directly from a terminal — see
[`docs/hooks-lab-notes.md`](docs/hooks-lab-notes.md).

---

## How to deploy

1. **Commit** your changes to Git.
2. **Push to `main`.**
3. **GitHub Actions** runs the `Review and Deploy` workflow: review → build →
   deploy. If review or build fails, the deploy job does not run.
4. **GitHub Pages** serves the published `dist/` as the live site.

### One-time GitHub Pages setup

After the first push, enable Pages so the workflow can publish:

> Repo **Settings → Pages → Build and deployment → Source: GitHub Actions**

Then re-run the workflow (push again, or use **Actions → Review and Deploy →
Run workflow**). The live URL appears in the `deploy` job and under Settings →
Pages, typically:

```text
https://<your-username>.github.io/gitops-review-webapp/
```

---

## Project structure

```text
.claude/
  settings.json            # registers the 3 hooks (project scope)
  hooks/
    guard-dog.sh           # PreToolUse: block risky Bash
    local-review.sh        # PostToolUse: run review after edits
    deploy-status.sh       # Stop: print GitOps status
.github/
  workflows/
    deploy.yml             # "Review and Deploy" workflow
public/
  index.html              # the static page
src/
  main.js                 # client-side JS
  style.css               # styling
scripts/
  simple-review.mjs       # deterministic code review (the gate)
docs/
  hooks-lab-notes.md      # lab notes
package.json
README.md
.gitignore
```
