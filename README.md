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
   - **`.js` / `.mjs` / `.cjs`:** the **real ESLint engine** (flat config in
     `eslint.config.js`) — e.g. `no-debugger`, `no-unused-vars`,
     `no-undef`. ESLint errors are real errors; it does not get fooled by, say,
     the word `debugger` inside a string the way a regex would.
   - **`.html`:** `<img>` without `alt`, `<html>` without a `lang` attribute.
   - large-file warning (> 200 KB).
   Findings are graded **ERROR** (merge markers, ESLint errors) or **warn**
   (advisory). If ESLint isn't installed yet, that step degrades to a warning.
3. **Feeds the result back to Claude** — emits PostToolUse JSON with
   `hookSpecificOutput.additionalContext`, so the *assistant* sees the combined
   summary and can react, not just the human reading the transcript.

By default it **blocks** on ERROR-level per-file findings: those return exit `2`
and stop the turn so they get fixed. Advisory `warn` findings never block. Set
`LOCAL_REVIEW_BLOCK=0` (an env var) to make the hook fully advisory (always exit
`0`). Run the per-file check by hand with `npm run review:file -- <path>`, and
lint the whole project with `npm run lint`.

ESLint is also a **CI deploy gate**: the GitHub Actions workflow runs
`npm run lint` between review and build, so a lint error blocks deployment too.

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
3. **GitHub Actions** runs the `Review and Deploy` workflow: review → lint →
   build. If any of these fail, the deploy does not run.
4. **A reviewer approves.** The run pauses on the protected `production`
   environment and GitHub emails the required reviewer (see below). Nothing
   deploys until someone clicks **Approve**.
5. **GitHub Pages** serves the published `dist/` as the live site.

### Manual approval gate (required reviewer)

The workflow has an `approval` job that targets a protected `production`
environment. That environment is configured (repo **Settings → Environments →
production → Required reviewers**) with a human reviewer. When a run reaches the
gate:

1. The `review-build` job finishes (review + lint + build all green).
2. The run **pauses** at the `approval` job and the deployment shows as
   *Waiting*.
3. GitHub **emails** the reviewer a "deployment waiting for review" request
   (email delivery depends on your GitHub notification settings; you can always
   approve from the **Actions** run page, which shows a **Review deployments**
   button).
4. The reviewer clicks **Approve and deploy** (optionally leaving a comment) to
   let the `deploy` job run, or **Reject** to stop it. The decision is recorded
   on the deployment for audit.
5. Only after approval does GitHub Pages publish the new version.

This requires a **public** repo on the free plan (environment protection rules
are a paid feature for private repos). Self-review is allowed, so the same person
who pushes can approve. To change reviewers, edit the `production` environment in
repo settings.

#### Is the approval gate a Claude Code hook? No — and that's the point

This project has **two different kinds of gate**, and it helps to keep them
straight:

| | **Claude Code hooks** (`guard-dog`, `local-review`, …) | **Approval gate** |
| --- | --- | --- |
| Runs | locally, in your Claude Code session | remotely, in GitHub Actions |
| When | while you edit (before/after a tool, on stop) | after push, before deploy |
| Enforced by | Claude Code on your machine | GitHub's servers |
| Bypassable | yes — it is local | no — it is a server-side rule on the deployment |
| Best at | fast feedback while coding | **authorizing the real deployment** |

A local hook **cannot** be a real deployment-approval gate: it only affects your
machine, it can't email an external reviewer, and it leaves no auditable record
on the deployment. Approval has to live where the deploy happens (GitHub
Actions / Pages) to actually be a gate. So the hooks and the approval gate are
**complementary layers** of the same "don't ship without checks" idea — not the
same mechanism. (If you wanted, a local hook could *remind* you that pushing to
`main` triggers an approval-gated deploy, but it would not be the authority.)

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
