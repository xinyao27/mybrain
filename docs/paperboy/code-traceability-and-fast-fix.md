# Code Traceability & Fast Fix Pipeline

> Version: 0.1 | Date: 2026-03-29
> Status: Draft
> Related: [Guarded Vibe Coding Framework](./guarded-vibe-coding-framework.md) | [Observability System Design](./observability-system-design.md)
> Author: Xinyao Chen + MiniChen

## What Is This

An **end-to-end traceability + automated fix** pipeline from error occurrence to fix completion. It solves the core problem of code maintenance in the AI era: when code written by agents has bugs, how to locate the root cause and fix it within minutes.

---

## Core Problems

Code produced by vibe coding faces three challenges when bugs appear that traditional toolchains cannot solve:

| Problem                          | Traditional Approach         | Why It's Not Enough                                                                                                                          |
| -------------------------------- | ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| **Who changed it?**              | git blame → ask the person   | Agent-written code shows only "Cursor" or "Claude Code" in blame — no idea which prompt or what intent                                       |
| **Why was it changed this way?** | PR description → code review | Agent's reasoning process is lost; only the code artifact remains. PR description is an auto-generated summary, not the real reasoning chain |
| **What will break if changed?**  | Run tests → pray             | Agent doesn't understand the full impact scope; tests only cover known behaviors; architectural degradation is invisible                     |

---

## Five-Layer Tracing Model

```
L5: Runtime              — ohbug: error stack + user action breadcrumbs
L4: OS Context            — Paperboy: screenshots + clipboard + user behavior sequence
L3: Code Structure        — kly: dependency graph + file history + impact scope
L2: Intent                — Session Log + ADR + Structured Commit
L1: Behavior              — Contract Tests + Fitness Functions
```

**When a bug occurs, drill down from top to bottom**:

```
User reports error / ohbug auto-captures
  → L5 ohbug: error stack + last 30s user action sequence (breadcrumbs)
  → L4 Paperboy: screenshot at error time + what user was doing + clipboard
  → L3 kly enrich_error_stack: error stack → code file → dependency graph → recent changes
  → L2 find the commit → session log → the prompt and reasoning at that time → ADR
  → L1 run tests → which behaviors are broken → whether fitness functions are violated
```

---

## L5: Runtime — ohbug Error Capture

### Standard Configuration

```typescript
import Ohbug from "@ohbug/browser";

Ohbug.init({
  apiKey: "...",

  // User action breadcrumbs — last N actions
  breadcrumbs: {
    dom: true, // Click, input events
    console: true, // console.error / console.warn
    network: true, // Failed HTTP requests
    navigation: true, // Route transitions
  },

  // Critical: attach agent metadata
  metadata: {
    lastAgentSession: getCurrentSessionId(), // Most recent agent session ID
    lastCommit: __COMMIT_HASH__, // Current running commit hash
    buildTime: __BUILD_TIMESTAMP__, // Build timestamp
    branch: __GIT_BRANCH__, // Current branch
  },
});
```

### Custom Context Injection

```typescript
// Inject context before critical operations
Ohbug.addAction("message-list-scroll", {
  viewport: { top: scrollTop, height: viewportHeight },
  visibleMessages: visibleRange,
  totalMessages: messageCount,
});

// When an error occurs, these actions are reported as breadcrumbs
```

### Reported Data Structure

```json
{
  "error": {
    "type": "TypeError",
    "message": "Cannot read properties of undefined (reading 'height')",
    "stack": "at useMessageHeight (MessageList.tsx:142)\n  at renderMessage (MessageList.tsx:87)\n  ..."
  },
  "breadcrumbs": [
    { "type": "click", "target": "#send-button", "timestamp": -3200 },
    { "type": "navigation", "from": "/chat/1", "to": "/chat/2", "timestamp": -2100 },
    { "type": "network", "url": "/api/messages", "status": 200, "timestamp": -1500 },
    { "type": "dom", "target": ".message-input", "action": "input", "timestamp": -800 }
  ],
  "metadata": {
    "lastAgentSession": "cursor-52a50243",
    "lastCommit": "abc1234",
    "buildTime": "2026-03-29T17:00:00Z",
    "branch": "feat/react"
  }
}
```

---

## L4: OS Context — Paperboy's Unique Advantage

**This is a competitive moat — Sentry / Datadog / no competitor has this layer.**

When an error occurs, Paperboy can provide:

| Data                                 | Source            | Value                                         |
| ------------------------------------ | ----------------- | --------------------------------------------- |
| Screenshot sequence 30s before error | Screen capture    | Visual reproduction of what the user saw      |
| User clipboard history               | Clipboard monitor | What the user was copying/pasting at the time |
| Current active app and window        | Window tracker    | Context switch chain                          |
| Keyboard/mouse action sequence       | Input monitor     | Precise action replay                         |
| Voice transcription (if available)   | Transcription     | What the user was saying at the time          |

### Integration Point with kly

```bash
# kly enrich_error_stack accepts OS context as supplementary input
kly enrich-error-stack \
  --stack "TypeError at MessageList.tsx:142" \
  --os-context '{"screenshot": "...", "activeApp": "Paperboy", "lastAction": "scroll"}'

# Output includes: code-level analysis + "user was rapidly scrolling the message list" environmental inference
```

---

## L3: Code Structure — kly as a Code Knowledge Graph

kly plays three roles in the tracing chain:

### 3a. Error Stack Enrichment (enrich_error_stack)

```bash
kly enrich-error-stack --stack "TypeError at MessageList.tsx:142"

# Output:
{
  "location": {
    "file": "MessageList.tsx",
    "line": 142,
    "function": "useMessageHeight",
    "module": "packages/ui/message-list"
  },
  "dependencies": {
    "calls": ["pretext.layout()", "MessageStore.getById()"],
    "called_by": ["renderMessage()", "VirtualViewport.measure()"]
  },
  "dependents": [
    "ChatWindow.tsx (direct import)",
    "WorkspacePanel.tsx (indirect via ChatContentRoot)"
  ],
  "recent_changes": [
    {
      "commit": "abc1234",
      "message": "feat(message-list): implement pretext virtualization",
      "session": "cursor-52a50243",
      "date": "2026-03-29T15:00:00Z",
      "files_changed": ["MessageList.tsx", "useMessageHeight.ts"]
    }
  ],
  "decisions": [
    "ADR-003: Using Pretext instead of virtua for message list virtualization"
  ]
}
```

### 3b. Impact Scope Analysis (affected)

```bash
kly affected MessageList.tsx

# Output:
{
  "direct_dependents": [
    "ChatWindow.tsx",
    "ChatContentRoot.tsx"
  ],
  "indirect_dependents": [
    "WorkspacePanel.tsx",
    "App.tsx"
  ],
  "test_files": [
    "MessageList.test.tsx",
    "ChatWindow.test.tsx",
    "e2e/message-scroll.spec.ts"
  ],
  "fitness_rules_status": {
    "no-ui-import-data": "✅ pass",
    "file-complexity": "⚠️ MessageList.tsx: 287/300 lines"
  }
}
```

### 3c. File Change History (history)

```bash
kly history MessageList.tsx --last 5

# Output:
[
  {
    "commit": "abc1234",
    "message": "feat(message-list): implement pretext virtualization",
    "session": "cursor-52a50243",
    "intent": "Replace virtua with custom virtual scrolling using Pretext",
    "date": "2026-03-29T15:00:00Z"
  },
  {
    "commit": "def5678",
    "message": "fix(message-list): scroll position on prepend",
    "session": "cursor-8a3b2c1d",
    "intent": "Fix scroll position jump when new messages prepend",
    "date": "2026-03-28T22:00:00Z"
  }
]
```

---

## L2: Intent — Making Every Change Have a "Why"

### 2a. Structured Commit Protocol

Every commit must include agent session association and intent declaration:

```
# Format
<type>(<scope>): <description>

session: <agent-session-id>
intent: <one-sentence intent description>
decisions: <ADR number, if any>
affected: <kly affected key files>

# Example
feat(message-list): implement pretext virtualization

session: cursor-52a50243
intent: Replace virtua with Pretext for message list virtual scrolling, precise height pre-calculation eliminates jitter
decisions: ADR-003
affected: ChatWindow.tsx, WorkspacePanel.tsx
```

**Automation**: Each time an agent commits, it automatically runs `kly affected` to populate the `affected` field, and fills `session` and `intent` from the current session context.

### 2b. Session Log

Automatically generated at the end of each agent session (see [Guarded Vibe Coding Framework](./guarded-vibe-coding-framework.md) for details):

```markdown
## Session Log: 2026-03-29 cursor-52a50243

### Prompt (Trigger)

"Implement message list virtualization with Pretext, referencing the masonry demo pattern"

### Reasoning Chain

1. Read Pretext masonry demo's virtualization implementation
2. Decided not to use virtua, implementing viewport management ourselves
3. Used prepare() for height pre-calculation, layout() recalculates on resize
4. Implemented 200px buffer to prevent fast-scroll flickering

### What Was Done

- Created useMessageHeight.ts
- Modified MessageList.tsx: replaced virtua with custom virtual scrolling
- Modified ChatWindow.tsx: passed in containerWidth

### Architecture Decisions

- Chose custom virtualization because Pretext makes the measurement layer extremely thin
- Used absolute positioning instead of transform because ...

### Impact Scope

kly affected: ChatWindow.tsx, WorkspacePanel.tsx

### Unresolved Issues

- Performance of incremental prepare() for streaming messages not yet verified
```

### 2c. ADR (Architecture Decision Records)

See [Guarded Vibe Coding Framework](./guarded-vibe-coding-framework.md) Step 2 for details.

---

## L1: Behavior — Tests as a Behavior Baseline

### TDD Flow for Bug Fixes

```
Bug report / ohbug capture
  → First write a test that reproduces the bug (red)
  → Fix the bug (green)
  → Test stays permanently to prevent regression
  → If all existing tests pass but user reports a bug → test coverage is insufficient, add tests
```

### Behavior Regression Detection

```bash
# Standard: run full test suite
pnpm test

# Enhanced: only run affected tests (kly provides the scope)
kly affected MessageList.tsx --tests-only | xargs pnpm test --filter

# Deep: mutation testing to verify test quality
pnpm mutation-test --files MessageList.tsx
```

---

## Speed Fix Pipeline (End-to-End)

### Fully Automated Flow

```
┌──────────────────────────────────────────────────────┐
│  Step 1: Error Capture                                │
│                                                      │
│  ohbug capture:                                       │
│    → error stack + breadcrumbs + agent metadata       │
│  Paperboy capture:                                    │
│    → screenshot + user action sequence + clipboard    │
│                                                      │
│  Duration: 0s (automatic)                            │
└──────────────────────┬───────────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────────┐
│  Step 2: Context Enrichment                           │
│                                                      │
│  kly enrich-error-stack:                              │
│    → Locate code file + function                     │
│    → Dependency graph (who calls it, what it calls)  │
│    → Recent changes + associated session log         │
│    → Associated ADR                                  │
│  Paperboy OS context:                                 │
│    → Screenshot at error time + what user was doing   │
│                                                      │
│  Duration: ~2s                                       │
└──────────────────────┬───────────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────────┐
│  Step 3: Automated Diagnosis                          │
│                                                      │
│  Agent receives full context, outputs:                │
│    → Root cause analysis                             │
│    → Whether it's a known failure class              │
│      (compared against historical session logs)      │
│    → Suggested fix (respecting ADR constraints)      │
│    → Impact scope (kly affected)                     │
│    → List of tests to add/modify                     │
│    → Confidence score: HIGH / MEDIUM / LOW           │
│                                                      │
│  Duration: ~30s                                      │
└──────────────────────┬───────────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────────┐
│  Step 4: Fix Execution                                │
│                                                      │
│  If confidence HIGH:                                  │
│    → Auto-execute:                                    │
│      1. Write reproduction test (red)                │
│      2. Implement fix (green)                        │
│      3. Run full tests + kly check + typecheck       │
│      4. Generate structured commit                   │
│      5. Generate session log                         │
│      6. Create PR                                    │
│                                                      │
│  If confidence MEDIUM / LOW:                          │
│    → Generate diagnostic report + fix suggestions,   │
│      wait for human confirmation                     │
│                                                      │
│  Duration: HIGH ~2min / MEDIUM-LOW awaiting human    │
└──────────────────────┬───────────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────────┐
│  Step 5: Human Review                                 │
│                                                      │
│  Only need to check:                                  │
│    → Is the root cause analysis accurate             │
│    → Does the fix violate architectural intent       │
│      (cross-reference with ADR)                      │
│    → Is the impact scope covered by tests            │
│                                                      │
│  Don't need to check:                                 │
│    → Code implementation details                     │
│      (tests + kly already guard this)                │
│    → Commit format (auto-generated)                  │
│    → Impact scope (kly affected already analyzed)    │
│                                                      │
│  Duration: ~1min                                     │
└──────────────────────────────────────────────────────┘
```

### Timeline Comparison

```
Traditional flow:
  User reports bug → assign to person → person reads code → person locates issue → person writes fix → code review → merge
  Duration: hours to days

This framework (HIGH confidence):
  ohbug capture → kly enrich → agent diagnose → agent fix → human review → merge
  Duration: ~5 minutes

This framework (MEDIUM/LOW confidence):
  ohbug capture → kly enrich → agent diagnostic report → human confirms direction → agent fix → human review → merge
  Duration: ~15 minutes
```

---

## Confidence Scoring Rules

The agent automatically evaluates confidence after diagnosis:

| Condition                                                                                                                              | Confidence |
| -------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| Error stack precisely points to a single file + kly's recent changes are directly related + similar session log exists                 | **HIGH**   |
| Error stack spans multiple files + kly shows multiple recent changes + no similar session log                                          | **MEDIUM** |
| Error stack is incomplete / reproduction conditions unclear / involves external dependencies / potentially an architecture-level issue | **LOW**    |

**HIGH can auto-fix; MEDIUM/LOW must have human confirmation of direction.**

This rule is non-negotiable — it prevents agents from making destructive changes when uncertain.

---

## Comparison with Competitors

```
              Error Capture  Code Structure  Agent Intent  OS Context  Auto Fix  Intent Tracing
Sentry          ✅              ❌              ❌            ❌          ❌         ❌
Datadog         ✅              ❌              ❌            ❌          ❌         ❌
GitHub Copilot  ❌              Partial         ❌            ❌          Partial    ❌
Cursor          ❌              Partial         Partial       ❌          ✅         ❌
Linear+GitHub   ❌              ❌              Partial       ❌          ❌         Partial
────────────────────────────────────────────────────────────────────────────────────────
Paperboy        ✅              ✅              ✅            ✅          ✅         ✅
(ohbug+kly+OS)
```

**Core moat**: The three-layer intersection of ohbug (runtime error stack) + kly (static code structure and dependency graph) + Paperboy OS context (screenshots/actions/clipboard). No competitor can simultaneously cover all three layers. The Error Stack is the convergence point of the three layers.

---

## Structured Commit — Detailed Specification

### Format

```
<type>(<scope>): <short description>

[optional body]

session: <agent-session-id>
intent: <one sentence — why this change was made>
decisions: <ADR numbers, comma-separated, omit if none>
affected: <key files from kly affected output, comma-separated>
confidence: <if a fix, annotate diagnostic confidence>
```

### Type Enum

| type       | Purpose                                  |
| ---------- | ---------------------------------------- |
| `feat`     | New feature                              |
| `fix`      | Bug fix                                  |
| `refactor` | Refactoring (no behavior change)         |
| `test`     | Add or modify tests                      |
| `docs`     | Documentation updates                    |
| `spike`    | Exploratory code (should not enter main) |

### Example

```
fix(message-list): handle undefined height for empty messages

prepare() returns undefined for empty string input.
Added null check before passing to layout().

session: cursor-8a3b2c1d
intent: Fix crash caused by TypeError on empty messages
affected: MessageList.tsx, useMessageHeight.ts
confidence: HIGH
```

### Automation

Automatically executed when agent commits:

```bash
# 1. Get impact scope
AFFECTED=$(kly affected --changed-files --format=csv)

# 2. Get current session ID (from environment variable or agent context)
SESSION_ID=$AGENT_SESSION_ID

# 3. Generate commit message (agent fills in intent)
git commit -m "fix(message-list): handle undefined height for empty messages

session: $SESSION_ID
intent: Fix crash caused by TypeError on empty messages
affected: $AFFECTED
confidence: HIGH"
```

---

## Tracing Query Examples

### Scenario 1: User Reports Bug, Quick Localization

```bash
# Get error stack from ohbug
# → kly enrich
kly enrich-error-stack --stack "TypeError at MessageList.tsx:142"

# → Discover recent change is commit abc1234, session cursor-52a50243
# → View session log
cat .sessions/cursor-52a50243.md

# → See the intent at that time: "Replace virtua with Pretext"
# → See the reasoning chain: "Decided not to use virtua, implementing viewport management ourselves"
# → See unresolved issues: "Incremental prepare() performance for streaming messages not yet verified"
# → Root cause is clear: this is the problem
```

### Scenario 2: New Team Member, Understanding the Design

```bash
# Why Pretext instead of virtua?
cat packages/ui/message-list/DECISIONS.md
# → ADR-003: Complete selection rationale + rejected alternatives + re-evaluation conditions

# What has this file been through recently?
kly history MessageList.tsx --last 10
# → Complete change history, each with session ID and intent

# What are the architectural constraints for this module?
kly check --module packages/ui/message-list
# → fitness rules status + violations
```

### Scenario 3: Automated Fix End-to-End

```
09:00:00  ohbug captures TypeError at MessageList.tsx:142
09:00:02  kly enrich: locates useMessageHeight, recent change abc1234
09:00:02  Paperboy: screenshot shows user was rapidly scrolling a long message list
09:00:05  Agent diagnosis: empty message's prepare() returns undefined, confidence: HIGH
09:00:07  Agent: writes reproduction test (red)
09:00:15  Agent: implements fix — null check + fallback height (green)
09:00:30  Agent: pnpm test ✅, kly check ✅, pnpm typecheck ✅
09:00:35  Agent: structured commit + session log + creates PR
09:01:00  Human review: root cause accurate, fix doesn't violate ADR → approve
09:01:30  Merge → deploy
```

**From error occurrence to fix deployment: < 2 minutes.**

---

## Implementation Roadmap

### Phase 1: Infrastructure (Can Start Now)

- [ ] Structured Commit Protocol — Write into AGENTS.md, have all agents follow it
- [ ] Session Log auto-generation — Prompt template for when agent sessions end
- [ ] ADR template — Create DECISIONS.md in critical modules

### Phase 2: kly Enhancement

- [ ] `kly enrich-error-stack` command implementation
- [ ] `kly affected --changed-files` command implementation
- [ ] `kly check --rules` fitness function engine
- [ ] `kly history` integration with structured commit session/intent fields

### Phase 3: ohbug Integration

- [ ] ohbug SDK configuration with agent metadata injection
- [ ] ohbug → kly automatic enrichment pipeline
- [ ] ohbug dashboard displays kly-enriched error context

### Phase 4: Automated Fix Pipeline

- [ ] Agent diagnostic prompt template (input: enriched error + ADR + tests)
- [ ] Confidence scoring logic
- [ ] HIGH confidence auto-fix + PR workflow
- [ ] MEDIUM/LOW confidence human confirmation interaction flow

### Phase 5: Paperboy OS Context Integration

- [ ] Automatically associate OS context (screenshots, action sequences) when errors occur
- [ ] kly enrich-error-stack accepts OS context input
- [ ] ohbug dashboard displays OS context breadcrumbs

---

## To Validate & Open Questions

- [ ] How to unify the `session` field in structured commits across different agents (Cursor / Claude Code / Codex)?
- [ ] Where to store session logs? `.sessions/` directory? Or git notes?
- [ ] kly fitness function rule syntax design (YAML? DSL?)
- [ ] Confidence scoring calibration — need to run several rounds of validation on real bugs to tune thresholds
- [ ] Safety boundaries for auto-fix — which modules allow auto-fix, which must be manual?
- [ ] Performance: kly enrich-error-stack latency in a large monorepo
- [ ] First end-to-end validation: run through the complete Step 1-5 pipeline on a real bug
