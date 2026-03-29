# Guarded Vibe Coding Framework

> Version: 0.1 | Date: 2026-03-29
> Status: Draft — Pending team validation before publishing as a Skill
> Author: Xinyao Chen + MiniChen

## What Is This

A workflow framework that enables AI agents to **automatically maintain high quality** during vibe coding. It does not rely on the user understanding the underlying philosophy — the process itself is the constraint.

Core tension: The value of vibe coding lies in rapid exploration, but the code produced through exploration is often of uncontrollable quality. This framework uses phased workflows + automated guardrails to make "fast" and "good" no longer in conflict.

---

## Core Principles

1. **Exploration and consolidation are two separate phases — don't mix them**
2. **Agents write code, humans define boundaries, kly enforces the rules**
3. **Tests lock behavior, Fitness Functions lock architecture**
4. **Every session ends with decision memory, not just code**

---

## Two-Phase Workflow

### Phase A: Spike (Exploration)

**Goal**: Discover interfaces, behavior, and feasibility. Code quality is not a concern.

**Rules**:

- ✅ Vibe freely, no need to write tests
- ✅ Hacking, hardcoding, and copy-pasting are fine
- ✅ Output is a prototype, not production code
- ❌ Don't build features on top of spike code
- ❌ Spike code does not go into the main branch

**Spike Exit Criteria**:

- You can describe this feature's public API in one sentence
- You know which behaviors are required and which are optional
- You know where the boundaries are (what not to do)

**Required Output at Spike Completion**:

```markdown
## Spike Summary: [Feature Name]

### Public API (External Interface)

- `functionA(input): output` — what it does
- `functionB(input): output` — what it does

### Required Behaviors

1. When X happens, it should Y
2. When A happens, it should not B

### Explicit Exclusions (What We Don't Do)

- Does not handle Z scenario
- Does not support W format

### Architecture Decisions

- Chose approach X because ...
- Rejected approach Y because ...
```

---

### Phase B: Consolidate

**Goal**: Based on the behaviors discovered during Spike, write production-quality code.

**Steps must be executed in strict order**:

#### Step 1: Write Contract Tests (Human or Senior Agent Responsible)

Based on the "Required Behaviors" from the Spike Summary, write tests:

```typescript
// ✅ Good contract test — tests public API behavior
describe('MessageList', () => {
  it('should render only visible messages within viewport', () => { ... })
  it('should maintain scroll position when new messages prepend', () => { ... })
  it('should auto-scroll to bottom when user is at bottom', () => { ... })
})

// ❌ Bad test — tests internal implementation
describe('MessageList', () => {
  it('should call _recalculateHeights when container resizes', () => { ... })
  // This test will break on refactor because it's bound to implementation details
})
```

**Testing Rules**:

- Only test public API / external behavior
- Use property-based testing to describe invariants, not just example-based tests
- If a test breaks after a correct refactor, it's written too tightly — delete and rewrite

#### Step 2: Write ADR (Architecture Decision Record)

Create or update `DECISIONS.md` in the module directory:

```markdown
## ADR-001: Using Pretext Instead of virtua for Message List Virtualization

### Status: Accepted

### Date: 2026-03-29

### Context

Message list needs virtual scrolling. The traditional approach uses virtua, but Pretext provides zero DOM reflow precise height pre-calculation, making the virtualization logic very thin.

### Decision

Adopt Pretext + custom virtualization, without introducing virtua.

### Rationale

- Pretext masonry demo proves custom virtualization is feasible and more lightweight
- Precise height pre-calculation eliminates estimated height jump issues
- Shrink-wrap capability is something CSS cannot achieve

### Rejected Alternatives

- virtua: Introduces an extra dependency and cannot leverage Pretext's shrink-wrap
- react-window: Does not support precise pre-calculation of dynamic heights

### Conditions for Re-evaluation

- Pretext maintenance stops
- Message type complexity exceeds pure text measurement scope (rich media dominant)
```

#### Step 3: Agent Implementation

Have the agent implement based on contract tests:

```
Prompt template:

Implement [feature name].

Constraints:
1. Must pass all tests in [test file]
2. Read DECISIONS.md to understand architecture decisions, do not violate them
3. Read AGENTS.md to understand project-level constraints
4. Run `kly check` to confirm no dependency direction violations
5. After completion, run `kly affected [changed files]` to list the impact scope

Do not:
- Do not modify tests (if a test has issues, report to me)
- Do not modify public API signatures (if changes are needed, report to me)
- Do not introduce solutions explicitly rejected in DECISIONS.md
```

#### Step 4: Automated Guardrails

After the agent completes implementation, automatically run the following checks:

```bash
# 1. Behavior check — all tests must pass
pnpm test

# 2. Architecture check — kly fitness functions
kly check --rules .kly/rules.yaml

# 3. Mutation testing — verify test quality (optional, run in CI)
pnpm mutation-test

# 4. Lint + Type check
pnpm lint && pnpm typecheck
```

#### Step 5: Session Log

At the end of each session, the agent automatically generates:

```markdown
## Session Log: [Date] [Feature Name]

### What Was Done

- Implemented X
- Modified Y

### Architecture Decisions (If Any New Ones)

- Chose A over B because ...

### Discovered Issues (Not Fixed)

- Module Z's API is somewhat unreasonable, but out of scope for this session

### Impact Scope

- kly affected: [file list]
```

---

## Persistent Context Hierarchy

```
L0: The Code Itself
    → kly index (structure, dependencies, history)
    → WHAT

L1: AGENTS.md / CLAUDE.md
    → Project-level constraints, coding conventions, prohibitions
    → HOW

L2: DECISIONS.md (per module)
    → Architecture decisions, selection rationale, rejected alternatives
    → WHY

L3: Session Logs
    → Summary, discoveries, unresolved issues from each session
    → WHEN & CONTEXT
```

**Agent automatically loads on startup**: L1 (global) + relevant module's L2 + most recent 3 L3 entries.

---

## kly Fitness Functions (Architecture Guardrail Rules)

Create `.kly/rules.yaml` in the project root:

```yaml
rules:
  # Dependency direction constraint
  - name: no-ui-import-data
    type: dependency-direction
    description: "UI layer cannot directly import data layer"
    source: "packages/ui/**"
    forbidden_target: "packages/data/**"

  # Module boundary constraint
  - name: store-public-api
    type: module-boundary
    description: "Store's public API can only be specified exports"
    target: "packages/*/stores/**"
    allowed_exports: ["*Store", "use*"]

  # Complexity constraint
  - name: file-complexity
    type: complexity
    description: "Single file must not exceed 300 lines"
    max_lines: 300
    exclude: ["*.test.*", "*.spec.*"]

  # Naming constraint
  - name: store-naming
    type: naming
    description: "All Store files must end with Store"
    target: "packages/*/stores/**"
    pattern: "*Store.ts"
```

---

## Role Division Quick Reference

| Role                  | Responsible For                                                                       | Does Not Do                                            |
| --------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| **Human**             | Define Spike direction, write contract test specs, review ADR, architectural judgment | Write implementation code                              |
| **Agent**             | Spike prototype, write implementation, generate session log                           | Modify tests, modify public API, violate ADR           |
| **kly**               | Dependency checking, impact scope analysis, fitness functions                         | Semantic understanding, architectural judgment         |
| **TDD**               | Lock confirmed behaviors                                                              | Discover new requirements, verify architecture quality |
| **Fitness Functions** | Verify architectural constraints (direction, boundaries, complexity)                  | Verify business logic correctness                      |

---

## Process Diagram

```
┌─────────────────────────────────────────────────────┐
│                   Phase A: Spike                     │
│                                                     │
│  Free vibe → prototype → discover interfaces        │
│  & behavior                                         │
│  Output: Spike Summary (API + behavior + decisions  │
│  + exclusions)                                      │
│                                                     │
│  Exit criteria: can describe public API in one      │
│  sentence                                           │
└──────────────────────┬──────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────┐
│               Phase B: Consolidate                   │
│                                                     │
│  ① Human writes Contract Tests                      │
│    (based on Spike Summary)                         │
│  ② Human writes/updates ADR (DECISIONS.md)          │
│  ③ Agent implements                                 │
│    (constrained by test + ADR + AGENTS.md)          │
│  ④ Automated guardrails                             │
│    (test + kly check + typecheck + lint)            │
│  ⑤ Agent generates Session Log                      │
│                                                     │
│  Exit criteria: all checks pass + human reviews     │
│  architecture                                       │
└──────────────────────┬──────────────────────────────┘
                       │
                       ▼
              ┌────────────────┐
              │  Merge to main │
              └────────────────┘
```

---

## Quick Start for Newcomers

**If you're writing code in this project for the first time:**

1. Read `AGENTS.md` — understand project constraints
2. Read the `DECISIONS.md` for the module you're modifying — understand architecture decisions
3. For new features: Spike first, produce Spike Summary, then have the agent implement
4. For bug fixes: Write a test to reproduce the bug first, then have the agent fix it
5. After changes, run `pnpm test && kly check && pnpm typecheck`
6. Generate session log

**One-liner version**: Figure out what you want (Spike), lock the behavior (Test), let the agent do the work, machines enforce the rules (kly + fitness), humans review the direction (ADR + review).

---

## To Validate & TODO

- [ ] kly fitness function rule syntax still needs design and implementation (current kly v0.2 does not support rules.yaml)
- [ ] Mutation testing tool selection (Stryker? In-house?)
- [ ] Session log auto-generation prompt template needs iteration
- [ ] Property-based testing feasibility validation in frontend scenarios (fast-check?)
- [ ] Whether Spike Summary template needs more structure (YAML? frontmatter?)
- [ ] Run this entire process end-to-end on a real feature for validation
