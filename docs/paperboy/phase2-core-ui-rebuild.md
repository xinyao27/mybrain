# Phase 2: Core UI Rebuild & SwiftUI → React Migration

> Created: 2026-03-28 (plan) · 2026-03-29 (checklist) · Author: Xinyao Chen · Status: Draft  
> Prerequisites: [Phase 1 End-to-End Verification](./phase1-e2e-verification_zh-CN.md) completed

**Related documents:**

- [Paperboy Frontend Rewrite Plan](./paperboy-frontend-rewrite_zh-CN.md)
- [Communication Protocol Redesign](./communication-protocol_zh-CN.md)
- Chinese version: [Phase 2：核心 UI 重建与迁移清单](./phase2-core-ui-rebuild_zh-CN.md)

This document combines the Phase 2 **product/execution plan** and the **SwiftUI → React migration checklist** in English. For the checklist-only anchor, see [Migration checklist](#part-ii-migration-checklist).

---

## Part I — Core UI Rebuild

## 1. Objectives

**Rebuild all core UI in React, fully covering the feature set of the existing SwiftUI version.**

Phase 1 proved the architecture is viable. Phase 2 is the real construction phase — rewrite Chat, Sidebar, Settings, and Workspace from SwiftUI to React, while migrating Santi's Protobuf services to oRPC procedures.

**Definition of Done:** The React version passes the acceptance checklist and can replace the SwiftUI version for end users.

---

## 2. Product Change: Spaces → Project

### 2.1 Concept Redefinition

The existing "Spaces" (PRO-17) concept is upgraded to **"Project"**:

|                   | Spaces (old)                     | Project (new)                                    |
| ----------------- | -------------------------------- | ------------------------------------------------ |
| Naming            | Abstract, requires user learning | Concrete, immediately intuitive                  |
| Meaning           | Context container                | Project = all conversations under one work topic |
| Hierarchy         | Space → Sessions                 | Project → Sessions                               |
| User mental model | "Which Space am I in"            | "Which project am I working on"                  |

### 2.2 Data Model

```typescript
interface Project {
  id: string;
  name: string;
  icon?: string; // emoji or custom icon
  description?: string;
  context?: ProjectContext; // project-level shared context
  createdAt: number;
  updatedAt: number;
  sortOrder: number; // sidebar sort order
}

interface ProjectContext {
  systemPrompt?: string; // project-level system prompt
  files?: string[]; // project-associated file paths
  connectors?: string[]; // project-associated connector IDs
  metadata?: Record<string, unknown>;
}

interface Session {
  id: string;
  projectId: string; // owning Project
  title: string;
  createdAt: number;
  updatedAt: number;
  lastMessagePreview?: string;
}
```

**Core Design Principles:**

- Every Session must belong to a Project
- A Project's context is shared by all its Sessions (context fixation)
- New Sessions inherit the parent Project's context
- A default "General" Project always exists; uncategorized sessions go there

### 2.3 oRPC Router — project namespace

```typescript
project: {
  list:     projectListProcedure,       // list all projects
  get:      projectGetProcedure,        // get a single project's details
  create:   projectCreateProcedure,     // create a project
  update:   projectUpdateProcedure,     // update a project (name, icon, context)
  delete:   projectDeleteProcedure,     // delete a project (sessions move to General)
  sessions: projectSessionsProcedure,   // list sessions under a project
  reorder:  projectReorderProcedure,    // reorder projects
}
```

### 2.4 Sidebar Structure

```
┌─────────────────────────┐
│  🔍 Search               │
├─────────────────────────┤
│  📁 Paperboy Rewrite     │  ← Project
│    ├── Protocol Discussion│  ← Session
│    ├── Phase 1 Planning   │  ← Session
│    └── + New Chat         │
│                          │
│  📁 Ohbug Observability   │  ← Project
│    ├── Vite+ Migration    │
│    └── kly Integration    │
│                          │
│  📁 General              │  ← Default Project
│    ├── Misc Chat 1        │
│    └── Misc Chat 2        │
├─────────────────────────┤
│  ⚙️ Settings             │
└─────────────────────────┘
```

**Interactions:**

- Click a Project name → expand/collapse sessions
- Right-click a Project → rename / edit context / delete
- Drag a Session → move to another Project
- When creating a new Session, choose which Project it belongs to

### 2.5 Relationship with PRO-17

The core design from PRO-17 (`feat/new-parallel-chat`) carries forward:

- Context fixation at session creation → changed to Project-level context sharing
- Space grouping → Project grouping
- Sidebar hierarchy → Project → Sessions

Existing bugs in PRO-17 (session grouping, input focus lock, shared highlight state) will be naturally resolved during the React rebuild — no fixes on the old SwiftUI code.

**Important: No parallel maintenance of two systems during the rebuild. SwiftUI frontend development stops entirely; all effort goes into the React version.** This means the product is unavailable (or frozen on the old version) during the rebuild period, but avoids the state conflicts and maintenance overhead of running dual systems.

---

## 3. Execution Order

### Phase 2A: Chat UI (Critical Path) — Highest Priority

**Goal:** Message send/receive + streaming rendering fully functional.

**Includes:**

- Message list (virtual list, virtua)
- Message bubbles (user messages / agent messages / system messages)
- Markdown rendering (streamdown)
- Code block highlighting (Shiki)
- Streaming real-time rendering (oRPC eventIterator over WS)
- Tool Call UI (approval buttons, execution status, result display)
- Thinking block (collapse/expand)
- Input box (rich text, reference Manus Textarea)
- Attachment preview + drag-and-drop file upload
- Message Queue (Cursor-style message queuing)
- Auto-scroll (scroll to bottom on new messages, stop when user scrolls manually)

**Santi-side concurrent migration:**

- `proto/services/chat.ts` → `rpc/procedures/chat.ts`
- `proto/services/session.ts` → `rpc/procedures/session.ts` (Session CRUD)

**Reference projects:**

| Module       | Reference | Path                                                               |
| ------------ | --------- | ------------------------------------------------------------------ |
| Message list | Same      | `~/work/feat_ai-sdk-v5/same-next/src/components/chat/messages/`    |
| Message list | Manus     | `~/work/manus/manus-next-agent-webapp/.../ChatBox/ChatMessages/`   |
| Input box    | Manus     | `~/work/manus/.../components/Textarea.tsx`                         |
| Input box    | Same      | `~/work/feat_ai-sdk-v5/same-next/.../chat/textarea/`               |
| Code block   | Same      | `~/work/feat_ai-sdk-v5/same-next/src/components/ui/code-block.tsx` |
| Tool Call UI | Same      | `~/work/feat_ai-sdk-v5/same-next/.../chat/tool-invocation/`        |
| Tool Call UI | 1Code     | `https://github.com/21st-dev/1Code`                                |

### Phase 2B: Sidebar + Project Management

**Goal:** Project-hierarchy sidebar with full session navigation.

**Includes:**

- Project list (expand/collapse)
- Session list (under Projects)
- Create new Project / Create new Session
- Project context editing (name, icon, system prompt, associated files)
- Search (cross-Project session search)
- Drag-and-drop Sessions between Projects
- Context menu (rename, delete, move)
- Default "General" Project

**Santi-side concurrent migration:**

- Add `rpc/procedures/project.ts`
- Database schema: add `projects` table + `sessions.projectId` foreign key

### Phase 2C: Settings

**Goal:** Configuration page fully functional.

**Includes:**

- Account information
- Model selection / API key management
- Appearance settings (theme, font)
- Keyboard shortcut configuration
- Connector management
- Permission status

**The simplest module — pure form CRUD.**

### Phase 2D: Workspace (Inkwell Merge)

**Goal:** Merge existing Inkwell React code into the new SPA.

**Includes:**

- Artifacts panel (already exists)
- File previewer (already exists)
- Diff viewer
- Chat integration (agent creates a file → right panel displays it)

**Advantage:** Inkwell is already React code, so migration cost is minimal — mainly directory reorganization and state management unification (PostBox → oRPC).

---

## 4. Santi-side Migration Reference Table

Migrate business logic from `packages/santi/src/proto/services/` to oRPC procedures one by one:

| Proto Service File                      | oRPC Procedure                       | Phase   |
| --------------------------------------- | ------------------------------------ | ------- |
| `proto/services/chat.ts`                | `rpc/procedures/chat.ts`             | 2A      |
| `proto/services/session.ts`             | `rpc/procedures/session.ts`          | 2A      |
| `proto/services/session-broadcaster.ts` | `rpc/procedures/session.ts` (merged) | 2A      |
| `proto/services/agent.ts`               | `rpc/procedures/agent.ts`            | 2A      |
| `proto/services/general-agent.ts`       | `rpc/procedures/agent.ts` (merged)   | 2A      |
| `proto/services/task.ts`                | `rpc/procedures/task.ts`             | 2A      |
| `proto/services/daemon.ts`              | `rpc/procedures/system.ts`           | 2A      |
| `proto/services/paperboy.ts`            | `rpc/procedures/notification.ts`     | 2C      |
| `proto/services/bug-report.ts`          | `rpc/procedures/observability.ts`    | Phase 4 |
| — (new)                                 | `rpc/procedures/project.ts`          | 2B      |

**Migration Principle:** Extract business logic, strip Protobuf serialization code, define input/output with zod schemas.

---

## 5. Acceptance Checklist

Must be satisfied at the end of Phase 2:

### Chat (2A)

- [ ] Can send messages and receive agent streaming replies
- [ ] Markdown renders correctly (headings, lists, links, bold/italic)
- [ ] Code blocks have syntax highlighting + copy button
- [ ] Tool Calls have approval UI; results display after approval
- [ ] Thinking blocks can be collapsed/expanded
- [ ] Attachments can be drag-and-drop uploaded with preview
- [ ] Message Queue supports queuing, editing, and canceling
- [ ] Auto-scroll behavior is correct (scroll to bottom on new messages, stop on manual scroll)
- [ ] Streaming can resume after interruption (lastEventId)

### Sidebar + Project (2B)

- [ ] Displays Project → Sessions hierarchy
- [ ] Can create / rename / delete Projects
- [ ] Can create Sessions and assign them to a Project
- [ ] Can drag-and-drop Sessions between Projects
- [ ] Search can find sessions across Projects
- [ ] Default General Project exists and cannot be deleted
- [ ] Project context is editable (system prompt, associated files)

### Settings (2C)

- [ ] All configuration items can be read and modified
- [ ] Changes take effect immediately (broadcast to all windows via Publisher)

### Workspace (2D)

- [ ] Artifacts display correctly in the right panel
- [ ] File previewer supports markdown / code / images
- [ ] Right panel auto-updates when agent creates a file

### Overall

- [ ] Multi-window state sync (Publisher)
- [ ] Keyboard shortcuts work (Cmd+N new session, Cmd+K Command Palette)
- [ ] Performance: Message list with 1000 messages has no jank (virtual list)
- [ ] Performance: Streaming at 30fps with no dropped frames

---

## 6. Time Estimates

| Phase     | Scope                                        | Estimate      |
| --------- | -------------------------------------------- | ------------- |
| 2A        | Chat UI + Santi chat/session/agent migration | 2–3 weeks     |
| 2B        | Sidebar + Project + DB schema                | 1–2 weeks     |
| 2C        | Settings                                     | 3–5 days      |
| 2D        | Workspace (Inkwell merge)                    | 3–5 days      |
| **Total** |                                              | **5–7 weeks** |

---

## 7. Risks

### 7.1 Proto Services Migration Is Not a Simple Wrapper

**Risk:** Existing proto services are deeply coupled with Protobuf types, Envelope transport, and the event bus. You can't simply "wrap them with oRPC" — you need to truly understand each service's business logic and rewrite it. In particular, `chat.ts` and `session-broadcaster.ts` contain extensive state management (message assembly, fragment merging, tool call tracking).

**Mitigation:** Before migrating each service, read the source code and map out the data flow. Identify what is business logic vs. Protobuf serialization glue code. Extract business logic into pure functions, then wrap them as oRPC handlers.

### 7.2 ChatStore State Machine Complexity

**Risk:** The Swift-side ChatStore does heavy lifting: 30fps streaming throttle, message history pagination, disk cache, tool approval state tracking, auto-scroll control. All of this must be reimplemented in React + Zustand — missing any single piece will result in feature gaps.

**Mitigation:** Before migration, compile a ChatStore feature inventory (extracted method-by-method from Swift source), and verify each item has a corresponding React-side implementation.

### 7.3 Chat Streaming Performance

**Risk:** React rendering of streaming markdown may not be as smooth as native SwiftUI.

**Mitigation:**

- streamdown is purpose-built for streaming markdown and industry-proven
- virtua virtual list controls DOM node count
- Set a quantified benchmark: delta under 15% vs SwiftUI baseline (reusing existing performance criteria)

### 7.4 Authentication Flow Rework

**Risk:** OAuth callbacks currently go through `paperboy://` URL scheme → Swift AuthManager. After the rewrite, React runs inside a WebView — how does the callback get passed back?

**Mitigation:** Flow becomes `paperboy://` URL scheme → Swift receives → oRPC notifies Santi → Publisher broadcasts to React. Verify the complete flow early in Phase 2A.

### 7.5 File System Access

**Risk:** WebView cannot read local files directly. Chat attachment previews, drag-and-drop uploads, and workspace file display all need to go through Santi API.

**Mitigation:** Add new oRPC procedures:

- `file.read` — Santi reads a file and returns its contents
- `file.upload` — accepts multipart upload
- oRPC natively supports File Upload/Download

### 7.6 WebView "Doesn't Feel Native" Long-Tail Issues

**Risk:** Each individual issue is not fatal, but cumulatively users feel "something is off": text selection behavior, clipboard interop, system font rendering, accent color, drag-and-drop experience, Chinese IME candidate window positioning.

**Mitigation:** During Phase 2A Chat implementation, create a **"native feel comparison table"** that tracks differences between WebView and native, categorized by severity:

- 🔴 Must fix (affects core interactions: input, copy/paste, scrolling)
- 🟡 Should fix (affects experience: fonts, colors, animation curves)
- 🟢 Acceptable difference (subtle differences in low-frequency operations)

### 7.7 Project Data Migration

**Risk:** Existing sessions have no projectId and need migration.

**Mitigation:** All existing sessions are assigned to the default "General" Project. The migration script runs automatically on Santi startup, is wrapped in a transaction with rollback, and is a one-time operation. Migration failure does not block app startup (fallback to a flat list with no Projects).

### 7.8 Keyboard Shortcut Conflicts

**Risk:** Both WebView and Swift listen for keyboard events.

**Mitigation:** The rewrite document defines a routing table — system-level shortcuts (Cmd+Q/W/M/H/,) go to Swift, application-level shortcuts (Cmd+N/K/Enter) go to WebView. Verify and lock down during Phase 2A.

### 7.9 Input Method (IME)

**Risk:** PRO-25 (Chinese IME not working in Paperboy) may still persist in WKWebView.

**Mitigation:** WKWebView's IME support is generally better than SwiftUI's (standard Web IME handling). Verify early in Phase 2A; if issues arise, address them proactively.

### 7.10 Multi-Window State Consistency

**Risk:** The new architecture uses MemoryPublisher broadcasts instead of in-process singleton ChatStore. Rapidly opening/closing windows or simultaneous multi-window operations may cause brief inconsistencies; messages may be lost during WS disconnect/reconnect.

**Mitigation:** Use lastEventId for disconnect recovery, with Publisher configured at `resumeRetentionSeconds: 300` (5-minute buffer). Critical operations (session create/delete) use optimistic updates + server-side confirmation.

---

<a id="part-ii-migration-checklist"></a>

## Part II — SwiftUI → React Migration Checklist

> **Note:** Execution-level supplement: every SwiftUI surface, data flow, and interaction to reimplement in React / WebView.

**Source code:** The Paperboy macOS app is not in this repo. SwiftUI lives under the Paperboy monorepo at `packages/paperboy/Paperboy/` (local clone often `~/work/paperboy`).

## Mapping to workstreams

| Workstream       | Section                      |
| ---------------- | ---------------------------- |
| Sidebar          | §2 Sidebar                   |
| Message list     | §3 Chat message list         |
| Scroll behavior  | §3.5–3.6 (scroll + prefetch) |
| Input            | §4 Chat input                |
| Tool call UI     | §5 Tool call UI              |
| Other components | §6–10                        |
| Design tokens    | §12 Design system            |
| PostBox bridge   | §14 Native bridge            |
| Settings         | §11 Settings                 |

---

## 1. Layout hierarchy

### 1.1 Current SwiftUI tree

Entry: `packages/paperboy/Paperboy/Views/Chat/ChatContentRootView.swift`

```
ChatWindowRootView
  └─ ChatContentRootView
       ├─ HStack: SidebarLayer (ChatSidebarRootView) | ChatConversationPaneView
       │     (toolbar, body: empty|loading|MessageListView, AskUser, Queue, Input)
       ├─ Drop overlay
       └─ AttachmentPreviewPopover
```

### 1.2 React

Flex row; sidebar width from design tokens; animate collapse like `ChatWindowLayoutModel` (CSS transition).

---

## 2. Sidebar

File: `ChatSidebarHost.swift`

- **Model:** sessions, active id, pagination flags, search, sections, rename state.
- **Data:** Injected via `setSessions`; React uses oRPC `session.list` + TanStack Query / infinite query.
- **Time buckets:** Today … Older; placeholder row when no active session and not searching.
- **Search:** Client filter + `sanitizeSystemContextPrefix`.
- **Row UX:** Select, context menu, hover affordances, inline rename, load-more sentinel.
- **Chrome:** Native sidebar blur → `backdrop-filter` or flat fill.
- **Footer:** Settings → PostBox or in-app route.

---

## 3. Chat message list

Files: `MessageListView.swift`, `ChatMessageListState.swift`, `MessageListHost.swift`

### 3.1 Rows

`ChatRowModel` + `ChatRowKind` (date separator, user text, assistant markdown, image, lazy blob image, document, attachments, tool group, subagent card, streaming/compacting status, compacted marker; skip toolUse/toolResult visually).

### 3.2 Spacing

`ChatTranscriptSpacingPolicy` → CSS margins / per-row top padding map.

### 3.3 Performance

SwiftUI avoids `LazyVStack` (AppKit hosting loop); uses full `VStack`, fixed width, incremental padding, code block VM reuse. React: **virtua** for virtualization.

### 3.5 Scroll to bottom

State: `isNearBottom`, `followStreamingOutput`, `sessionOpenAutoFollow`, `nearTopPrefetchArmed`. Coordinator: `pendingScroll`, 20px bottom tolerance, 240px top prefetch.

Rules: follow new content when pinned; streaming respects `followStreamingOutput`; user scroll up calls `userDidScrollAway`; return to bottom re-enables follow; session open auto-follow; history prepend preserves viewport; status rows use `shouldAutoScrollForLatestChange`.

Detection: `onScrollGeometryChange` or bottom sentinel. React: virtua scroll metrics or `IntersectionObserver` + Zustand.

### 3.6 History prefetch

Top sentinel, arm/rearm thresholds; pure prepend detection keeps scroll position.

### 3.7 Markdown / code

Assistant render package, width class, caching; code blocks and diffs → streamdown + Shiki + diff component.

---

## 4. Chat input

Files: `ChatInputRootView.swift`, `ChatInputModel.swift`

- Auto-growing editor (max lines, manual drag height cap).
- Shortcuts: Return send, Shift+Return newline, Escape, paste files/images.
- Primary button state machine (queue edit, record, transcribe, stop, send, mic).
- Attachments: picker types, limits, strip, drag/drop; upload via oRPC.
- Voice: PTT states; bridge via PostBox or Web Audio.
- Queue UI: collapsible list, edit/send now/delete, max height scroll.

---

## 5. Tool call UI

Files: `ToolCallGroupView.swift`, `ToolCallExpandedContent.swift`

Single vs multi-step groups, auto-expand for approvals / running Thinking, accordion per step. Titles from `ToolCallTitlePresentation`. Expanded bodies per tool (diff, bash, web fetch, glob/grep, skills, thinking, MCP JSON, lazy full result). Three approval patterns: permission, structured card, JSON editor.

---

## 6. Subagent card

`SubagentCardView.swift` — timeline vs CUA screenshot card; live `applySubagentProgress`.

---

## 7. Toolbar

`ChatPanelToolbarView` — drag region, icon, sidebar/new/collapse, min width 140–160px; optional macOS 26 glass control can be skipped on web.

---

## 8. Empty state

Centered greeting; tap focuses input.

---

## 9. Ask user card

Between transcript and composer; completion/dismiss callbacks.

---

## 10. Attachment preview modal

Dimmed scrim, responsive panel, prev/next.

---

## 11. Settings

`SettingsView.swift` — tabs (Account … MCP); 600×500; React forms in Phase 2C.

---

## 12. Design system tokens

Map `PBColors`, `PBTypography`, `PBSpacing`, `PBRadius`, shimmer to CSS variables / Tailwind. Approximate materials and window chrome with web APIs.

---

## 13. State mapping

Observable objects / `@Observable` → Zustand, TanStack Query, refs for imperative scroll, Context for globals, localStorage for preferences.

---

## 14. Native bridge (PostBox)

Window ops, file picker, pasteboard, settings, notifications, permissions, theme/OAuth/drop events, keyboard routing — align with [communication protocol](./communication-protocol_zh-CN.md).

---

## 15. Out of scope (stay Swift)

Orb, login, subscription, onboarding, menu bar, app scenes, `ChatWindow` shell, debug-only views.

---

## 16. Suggested order

2A-1 list rows + spacing + streamdown + virtua → 2A-2 scroll → 2A-3 input → 2A-4 tools → 2A-5 misc → 2B sidebar/projects → 2C settings → 2D workspace.

---

## Execution tracking (tick in Paperboy React PRs)

- [ ] Sidebar: buckets, search, rows, rename, load more, context menu
- [ ] Message list: all row kinds, spacing, virtua
- [ ] Scroll: near-bottom, auto-scroll, user cancel follow, prefetch, session open
- [ ] Input: auto-resize, shortcuts, button FSM, attachments, voice
- [ ] Tool UI: accordion, expanders, approvals
- [ ] Misc: SubagentCard, queue, ask-user, attachment preview, empty/loading
- [ ] Design tokens: PB\* → CSS
- [ ] PostBox: window, picker, pasteboard, events
- [ ] Settings: eight tabs

---
