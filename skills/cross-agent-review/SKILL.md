---
name: cross-agent-review
description: "Use when the user wants Codex to call Claude CLI, Claude to call Codex CLI, or either agent to get a second-opinion review from the other CLI. Default to read-only review of the current working tree unless the user explicitly asks for another target or non-review action."
---

# Cross-Agent Review

Use this skill when the user asks for a second-opinion review between Codex and Claude, especially:

- Codex should invoke Claude CLI to review code, docs, diffs, or plans.
- Claude should invoke Codex CLI to review code, docs, diffs, or plans.
- The user says "ask Claude", "ask Codex", "use the other agent", "cross review", or similar.

Sources for CLI flags:

- Claude CLI reference: https://code.claude.com/docs/en/cli-reference
- Codex CLI reference: https://developers.openai.com/codex/cli/reference

## Hard Guardrails

- Default mode is review-only. Do not edit files, stage changes, commit, push, or open PRs unless the user explicitly asks.
- Never run `claude ultrareview`, `claude ultra-review`, or any Claude ultra review feature. It is an extra paid, very expensive capability. Use plain `claude -p` for Claude reviews.
- Do not use Codex `--yolo`, `--full-auto`, or `--dangerously-bypass-approvals-and-sandbox` for review unless the user explicitly asks and the environment is isolated.
- Do not pass secrets, tokens, private keys, or unrelated personal data into the other CLI prompt.
- If the target is ambiguous, default to the current git working tree in the current directory.

## Review Workflow

1. Identify the other CLI:
   - From Codex, call `claude`.
   - From Claude, call `codex exec`.
2. Confirm the target from the user request. If absent, review the current working tree.
3. Collect lightweight context before invoking the other CLI:

```bash
pwd
git branch --show-current
git status --short
git diff --stat
git diff --cached --stat
```

4. Ask the other CLI to review only. Require findings first, with severity and file/line references where possible.
5. Relay the useful findings back to the user. Make it clear they came from the external reviewer, and add your own judgment if you disagree.

## Prompt Template

Use a prompt like this, adapted to the target:

```text
You are the external reviewer. Review only; do not modify files.

Target: <current working tree | staged diff | PR URL | commit | files>

Please inspect the relevant repository context and prioritize:
- correctness bugs
- regressions
- security or privacy risks
- missing tests for changed behavior
- maintainability risks that could cause real failures

Output findings first, ordered by severity. For each finding, include severity, file/line if available, why it matters, and the smallest practical fix. If you find no issues, say that clearly and mention residual risk or test gaps. Keep the response concise.
```

## Calling Claude From Codex

Preflight:

```bash
command -v claude
claude auth status --text
```

Default command:

```bash
claude -p \
  --permission-mode plan \
  --tools "Read,Bash" \
  --disallowedTools "Edit" "Write" "MultiEdit" "NotebookEdit" \
  --max-turns 6 \
  --output-format text \
  "<review prompt>"
```

Notes:

- Use `cd <repo>` before invoking Claude when reviewing a specific local repository.
- Keep `--permission-mode plan` for review-only work.
- Keep `--tools "Read,Bash"` so Claude can inspect files and git state but does not receive editing tools.
- Keep the prompt explicit: "Review only; do not modify files."
- Do not use `claude ultrareview` even if the user asks for a deep or strict review. Ask for confirmation before any paid premium feature, and prefer plain `claude -p`.

### Claude CLI Failure Modes and Fallbacks

Observed sharp edges:

- `claude -p --permission-mode plan --tools "Read,Bash" ... --max-turns 6` can hit `Error: Reached max turns` before producing a review, especially when the working tree has many changed files or the prompt asks Claude to inspect broad repo context. Retrying with `--max-turns 12` may still fail.
- `git diff` and `git diff --stat` do not include untracked files. If the work under review includes new files, collect `git ls-files --others --exclude-standard` and either let Claude read those files with `Read,Bash` or paste their contents into the prompt.
- `claude -p --tools ""` is useful as a fallback when tool-enabled review keeps hitting max-turn limits, but then Claude cannot inspect the filesystem. The prompt must include the relevant diff, untracked file contents, validation output, and any important constraints.
- `--max-turns 1` can be too low even for no-tool reviews. Use at least `--max-turns 2` for short pasted-context reviews.
- Avoid `claude --bare` for this workflow; it may enter an interactive or login-specific path. Prefer non-interactive `claude -p`.

Fallback pattern when tool-enabled review cannot finish:

```bash
claude -p \
  --tools "" \
  --max-turns 2 \
  --output-format text \
  "$(cat <<'PROMPT'
You are the external reviewer. Review only; do not modify files.

Target: supplied context from <repo>, branch <branch>. Review the supplied context only.

Prioritize real correctness bugs, regressions, security/privacy risks, missing high-value tests,
and maintainability risks that could cause real failures. Output findings first. If there are no
blocking issues, say so clearly and list only residual risks.

--- git status --short --branch ---
<paste output>

--- tracked diff ---
<paste targeted git diff>

--- untracked files ---
<paste file paths and contents for new files that matter>

--- validation ---
<paste relevant passing/failing commands>
PROMPT
)"
```

When using the fallback, keep the pasted context targeted. Prefer the files that contain the logic under review over generated files or broad repo-wide diffs. If Claude reports that it cannot assess untracked files, rerun with those file contents explicitly included.

## Calling Codex From Claude

Preflight:

```bash
command -v codex
codex login status
```

Default command:

```bash
codex --ask-for-approval never exec \
  --cd "<repo>" \
  --sandbox read-only \
  --output-last-message "<optional-output-file>" \
  "<review prompt>"
```

Notes:

- Omit `--output-last-message` unless saving the final review text is useful.
- Use `--sandbox read-only` for reviews so Codex cannot modify the repository.
- Use `--ask-for-approval never` for non-interactive review runs.
- For a particular model, add `--model <model>` only when the user requests it or local policy requires it.

## Handling Failures

- If the CLI is missing, say which command was missing and stop.
- If authentication is missing, report the CLI's login/status output and stop.
- If the other CLI tries to edit or asks for broader permissions during a review, stop and report that the review exceeded the intended scope.
- If the external review is noisy or low-confidence, summarize only actionable findings and label uncertainty.
