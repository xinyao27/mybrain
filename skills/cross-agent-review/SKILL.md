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
3. Collect lightweight context:

```bash
pwd
git branch --show-current
git status --short
git diff --stat
git diff --cached --stat
git ls-files --others --exclude-standard
```

4. For Claude reviews, prefer a supplied review packet over broad tool-enabled repository exploration. Claude Code can hit `max turns` before producing findings when asked to inspect a large working tree.
5. Ask the other CLI to review only. Require findings first, with severity and file/line references where possible.
6. Relay the useful findings back to the user. Make it clear they came from the external reviewer, and add your own judgment if you disagree.

## Retry Budget

External CLI reviews are best-effort, not an infinite loop. Use at most:

1. One packet-first Claude review, or one normal tool-enabled review for a small, explicitly scoped target.
2. One narrowed packet retry if the first packet was too broad or hit `max turns`.
3. One tiny health check only if the CLI behavior itself is unclear.

If all attempts fail, stop calling the external CLI, report the exact failure mode, and continue with your own review. Do not keep shrinking prompts indefinitely.

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
claude -p --max-turns 1 --output-format text 'Reply with exactly: ok'
```

### Default: packet-first review

Use this default for broad working-tree reviews, multi-file changes, untracked files, or when previous tool-enabled reviews hit `max turns`.

Build a focused review packet before invoking Claude:

```bash
review_packet="$(mktemp "${TMPDIR:-/tmp}/claude-review-packet.XXXXXX")"
{
  echo "You are the external reviewer. Review only; do not modify files."
  echo
  echo "Review the supplied context only. Do not inspect the filesystem."
  echo "Prioritize correctness bugs, regressions, security/privacy risks, missing high-value tests, and maintainability risks that could cause real failures."
  echo "Output findings first, ordered by severity. Include file/line when possible. If there are no blocking issues, say so clearly and list residual risks."
  echo
  echo "--- repo ---"
  pwd
  git branch --show-current
  echo
  echo "--- git status --short ---"
  git status --short
  echo
  echo "--- diff stat ---"
  git diff --stat
  git diff --cached --stat
  echo
  echo "--- untracked files ---"
  git ls-files --others --exclude-standard
  echo
  echo "--- targeted diff ---"
  # Replace these paths with the narrow files or directories under review.
  git diff -- path/to/changed-file path/to/changed-dir
  echo
  echo "--- relevant untracked file contents ---"
  # Add only new files that matter for the review, for example:
  # sed -n '1,220p' path/to/new-file
  echo
  echo "--- validation ---"
  # Paste the exact validation commands and pass/fail summaries.
} >"$review_packet"
```

Then call Claude with one turn:

```bash
claude -p \
  --permission-mode plan \
  --max-turns 1 \
  --output-format text \
  "$(cat "$review_packet")"
```

Notes:

- Keep the packet targeted. Prefer changed implementation files, tests, promises/specs, and validation summaries. Avoid generated files, lockfiles, and broad full-repo diffs unless they are central to the review.
- Include untracked files explicitly. `git diff` and `git diff --stat` do not include them.
- Do not use `--tools ""` as the default no-tools fallback; it can exit with no output on some Claude Code installs. A packet-first `--max-turns 1` call without `--tools ""` is usually more stable.
- If Claude reports it cannot assess a missing file, add only that file's relevant content to the packet and retry once.

### Optional: tool-enabled narrow review

Use this only when the target is small and Claude should inspect files itself, such as one crate, one package, or one design document. Do not use this for a large mixed working tree.

```bash
claude -p \
  --permission-mode plan \
  --tools "Read,Bash" \
  --disallowedTools "Edit" "Write" "MultiEdit" "NotebookEdit" \
  --max-turns 12 \
  --output-format text \
  "<review prompt>"
```

Notes:

- Use `cd <repo>` before invoking Claude when reviewing a specific local repository.
- Keep `--permission-mode plan` for review-only work.
- Keep `--tools "Read,Bash"` so Claude can inspect files and git state but does not receive editing tools.
- Scope the prompt tightly, for example: "Review only `crates/harness-daemon/src/main.rs` and its daemon tests."
- Keep the prompt explicit: "Review only; do not modify files."
- Do not use `claude ultrareview` even if the user asks for a deep or strict review. Ask for confirmation before any paid premium feature, and prefer plain `claude -p`.

### Claude CLI Failure Modes and Fallbacks

Observed sharp edges:

- `claude -p --permission-mode plan --tools "Read,Bash" ... --max-turns 6` can hit `Error: Reached max turns` before producing a review, especially when the working tree has many changed files or the prompt asks Claude to inspect broad repo context. Retrying with `--max-turns 12` may still fail.
- `git diff` and `git diff --stat` do not include untracked files. If the work under review includes new files, collect `git ls-files --others --exclude-standard` and either let Claude read those files with `Read,Bash` or paste their contents into the prompt.
- `claude -p --tools ""` can exit with no output on some installs. Do not rely on it as the stable fallback unless a local health check proves it works.
- Packet-first review can still fail with `Error: Reached max turns` if the packet is too broad. Treat this as a failed external review attempt, narrow the packet once, and do not present your own review as Claude's review.
- `claude -p` can hang without producing output. Use a bounded invocation for fallback attempts, and kill the process if it exceeds the time budget.
- macOS usually does not provide GNU `timeout`; do not rely on `timeout` unless `command -v timeout` succeeds.
- `--max-turns 1` is usually enough only when the prompt forbids filesystem inspection and supplies a concise packet. If it fails, narrow the packet rather than repeatedly increasing turns.
- Avoid `claude --bare` for this workflow; it may enter an interactive or login-specific path. Prefer non-interactive `claude -p`.

Mac-safe bounded wrapper for Claude commands:

```bash
run_bounded_claude() {
  out_file="$(mktemp "${TMPDIR:-/tmp}/claude-review.XXXXXX")"
  "$@" >"$out_file" 2>&1 &
  pid="$!"
  waited=0
  limit="${CLAUDE_REVIEW_TIMEOUT_SECONDS:-90}"

  while kill -0 "$pid" 2>/dev/null; do
    if [ "$waited" -ge "$limit" ]; then
      kill "$pid" 2>/dev/null || true
      wait "$pid" 2>/dev/null || true
      cat "$out_file"
      rm -f "$out_file"
      return 124
    fi
    sleep 1
    waited=$((waited + 1))
  done

  wait "$pid"
  exit_code="$?"
  cat "$out_file"
  rm -f "$out_file"
  return "$exit_code"
}
```

Fallback pattern when tool-enabled review cannot finish:

```bash
run_bounded_claude claude -p \
  --permission-mode plan \
  --max-turns 1 \
  --output-format text \
  "$(cat <<'PROMPT'
You are the external reviewer. Review only; do not modify files.

Target: supplied context from <repo>, branch <branch>. Review the supplied context only. Do not inspect the filesystem.

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

If a Claude attempt times out, hangs, or hits max turns:

```bash
ps -axo pid,ppid,stat,command | rg 'claude -p|claude'
```

Kill only the stale Claude review process you started. Then report that the external review did not complete and include any partial output. Do not present your own review as Claude's review.

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
