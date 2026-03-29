# Building the Paperboy Observability System

> Created: 2026-03-28
> Updated: 2026-03-29
> Author: Xinyao Chen
> Status: Draft
> Related document: [Paperboy Frontend Rewrite Plan](./paperboy-frontend-rewrite.md) — Section 4.2 "Observability + Reliability"

## 1. Vision

**Any error can be traced to its root cause — automatically, with full context, without asking the user "what did you do?"**

The Paperboy observability system is not another Sentry clone. It combines three proprietary tools that no competitor can replicate:

| Layer                   | Tool                      | What It Provides                                                             |
| ----------------------- | ------------------------- | ---------------------------------------------------------------------------- |
| **Runtime errors**      | ohbug (SDK + Dashboard)   | Error capture, aggregation, source map resolution, alerts, session replay    |
| **Static code context** | kly                       | File-level code index, dependency graph, git history, LLM-generated metadata |
| **OS-level context**    | Paperboy OS capture layer | Screenshots, keystrokes, clipboard, window switches, accessibility tree      |

When an error occurs, these three data streams converge in the cloud, producing an **Enriched Error Report** that tells you not just _what_ broke, but _why_ it likely broke, _who_ changed it, _how far_ the damage spreads, and _what the user was doing_ at the exact moment.

---

## 2. System Architecture

```
┌─────────────────────────────────┐        ┌───────────────────────────────────┐
│   macOS Client (thin client)     │        │            Cloud                   │
│                                  │        │                                    │
│  ┌────────────────────────────┐  │ upload │  ┌──────────────────────────────┐  │
│  │ OS Capture Layer (Swift)    │──┼───────→│  │ OS Data Storage               │  │
│  │ Accessibility / Screenshots │  │        │  │ screenshots / keystrokes /    │  │
│  │ Keystrokes / Clipboard      │  │        │  │ clipboard / window switches   │  │
│  └────────────────────────────┘  │        │  └──────────────┬───────────────┘  │
│                                  │        │                 │                   │
│  ┌────────────────────────────┐  │        │  ┌──────────────▼───────────────┐  │
│  │ WebView (React SPA)         │  │  API   │  │  Santi Backend               │  │
│  │                             │←─┼───────→│  │  ┌─────────────────────────┐ │  │
│  │ @ohbug/browser captures     │  │        │  │  │ KlyService              │ │  │
│  │ errors → reports to cloud   │──┼───────→│  │  │ enrichErrorStack()      │ │  │
│  │                             │  │        │  │  └─────────────────────────┘ │  │
│  │ Observability Panel         │  │        │  │  ohbug event ingestion       │  │
│  │ (issues, metrics, alerts)   │  │        │  │  source map resolution       │  │
│  └────────────────────────────┘  │        │  │  alert evaluation             │  │
│                                  │        │  └──────────────┬───────────────┘  │
│  ┌────────────────────────────┐  │        │                 │                   │
│  │ Native Shell (Swift)        │  │        │  ┌──────────────▼───────────────┐  │
│  │ Window / Notification / Orb │  │        │  │ Observability Database       │  │
│  └────────────────────────────┘  │        │  │ PostgreSQL + Redis + files   │  │
│                                  │        │  └──────────────────────────────┘  │
└─────────────────────────────────┘        └───────────────────────────────────┘
```

---

## 3. ohbug — Runtime Error Monitoring

ohbug is a self-hosted error monitoring system consisting of two repositories:

- **ohbug** (`~/work/ohbug`) — SDK monorepo: client-side error capture, reporting, and extensions
- **ohbug-dashboard** (`~/work/ohbug-dashboard`) — Full-stack dashboard: event ingestion, aggregation, visualization, alerts

### 3.1 ohbug SDK Architecture

The SDK is a pnpm monorepo built with Vite+ (`vp pack`), TypeScript, Apache-2.0 licensed.

#### Package Map

| Package                         | Purpose                                                                                                    |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| **@ohbug/types**                | Shared TypeScript type declarations (`OhbugEvent`, `OhbugClient`, `OhbugExtension`, `OhbugConfig`)         |
| **@ohbug/utils**                | Internal helpers: `getGlobal`, `getOhbugObject`, logger, validators, DOM utilities                         |
| **@ohbug/core**                 | Client lifecycle, event creation, `notify` pipeline, extension orchestration, `EventTypes`                 |
| **@ohbug/browser**              | Browser SDK: global error listeners, XHR/Fetch/WebSocket monkey-patches, breadcrumb capture, HTTP notifier |
| **@ohbug/react**                | `OhbugErrorBoundary` — React Error Boundary that captures render errors                                    |
| **@ohbug/vue**                  | Vue 2/3 `config.errorHandler` integration                                                                  |
| **@ohbug/angular**              | Angular `ErrorHandler` provider factory                                                                    |
| **@ohbug/cli**                  | Node CLI: interactive source map upload to dashboard                                                       |
| **@ohbug/unplugin**             | Build plugin (Vite/Rollup/Webpack) for automatic `.map` file upload                                        |
| **@ohbug/extension-rrweb**      | Session replay: rrweb `record`, attaches recording events to ohbug event metadata                          |
| **@ohbug/extension-web-vitals** | Core Web Vitals (FCP/LCP/CLS/FID) → `category: "performance"` events                                       |
| **@ohbug/extension-uuid**       | Anonymous user tracking via UUID                                                                           |
| **@ohbug/extension-view**       | Page visibility + URL change tracking                                                                      |
| **@ohbug/extension-feedback**   | User feedback UI (Solid.js + Tailwind)                                                                     |

#### Error Capture Pipeline

```
1. Initialization
   Ohbug.setup(config) → creates Client → registers OhbugBrowser extension
                                          → installs capture handlers

2. Capture → Dispatch → Handle
   ┌─ window "error" event ──────→ scriptDispatcher ──→ uncaughtErrorHandler
   ├─ window "unhandledrejection" ──────────────────→ unhandledrejectionHandler
   ├─ XHR monkey-patch ─────────→ networkDispatcher → ajaxErrorHandler
   ├─ fetch monkey-patch ───────→ networkDispatcher → fetchErrorHandler
   ├─ WebSocket monkey-patch ──→ networkDispatcher → websocketErrorHandler
   ├─ Resource load failure ────→ scriptDispatcher ──→ resourceErrorHandler
   └─ React ErrorBoundary ──────────────────────────→ reactErrorHandler

3. Event Creation
   handler builds detail → client.createEvent({ category, type, detail })
   → handleEventCreated: reduce chain (config.onEvent → extensions.onEvent)
   → any step can return null to drop the event

4. Reporting
   client.notify(event)
   → browser notifier: POST JSON to config.endpoint
     (prefers navigator.sendBeacon, falls back to XHR)
   → runs onNotify hooks from config + extensions

5. Breadcrumbs
   client.addAction() → ring buffer (maxActions, default 30)
   → copied into each new event as `actions` array
```

#### Core Type Definitions

```typescript
interface OhbugEvent {
  apiKey: string;
  appVersion?: string;
  appType?: string;
  releaseStage?: string;
  timestamp: string;
  category: "error" | "message" | "feedback" | "view" | "performance" | "other";
  type: string; // EventTypes: UNCAUGHT_ERROR, RESOURCE_ERROR, AJAX_ERROR, FETCH_ERROR, WEBSOCKET_ERROR, REACT, VUE, ANGULAR, ...
  sdk: { platform: string; version: string };
  detail: unknown;
  device: OhbugDevice;
  user?: OhbugUser;
  actions?: OhbugAction[];
  metadata?: OhbugMetadata;
}

interface OhbugExtension {
  name: string;
  onSetup?(client: OhbugClient): void;
  onDestroy?(client: OhbugClient): void;
  onEvent?(event: OhbugEvent, client: OhbugClient): OhbugEvent | null;
  onNotify?(event: OhbugEvent, client: OhbugClient): void;
}

interface OhbugConfig {
  apiKey: string;
  endpoint: string;
  maxActions?: number; // default 30
  onEvent?(event: OhbugEvent): OhbugEvent | null;
  onNotify?(event: OhbugEvent): void;
  user?: OhbugUser;
  metadata?: OhbugMetadata;
  logger?: OhbugLogger;
}
```

#### Source Map Upload

The SDK includes two mechanisms for source map upload:

1. **@ohbug/cli** — Interactive CLI: `ohbug upload` prompts for API key, selects `.map` files
2. **@ohbug/unplugin** — Build plugin: auto-uploads maps after Vite/Rollup/Webpack build

Both upload to the dashboard's `POST /sourceMap/upload` endpoint with `apiKey`, `appVersion`, and the map file.

### 3.2 ohbug-dashboard Architecture

The dashboard is a full-stack application on the `feature/shadcn` branch (23 commits ahead of `main`), migrated to a modern stack:

#### Tech Stack

| Layer            | Technology                                                                                               |
| ---------------- | -------------------------------------------------------------------------------------------------------- |
| Web UI           | Vite + TanStack Start + TanStack Router, React 19, Nitro (SSR), Tailwind CSS v4, TanStack Query, Zustand |
| Dashboard API    | oRPC (`@orpc/server` / `@orpc/client`) over fetch at `/api/rpc`                                          |
| Auth             | Better Auth + Drizzle adapter                                                                            |
| Ingestion Server | Hono + @hono/node-server (port 6660)                                                                     |
| Job Queue        | BullMQ + Redis                                                                                           |
| Database         | PostgreSQL + Drizzle ORM                                                                                 |
| Source Maps      | source-map-trace                                                                                         |

#### Database Schema (Drizzle)

| Domain        | Tables                                                                                       |
| ------------- | -------------------------------------------------------------------------------------------- |
| Auth          | `user`, `session`, `account`, `verification` (Better Auth)                                   |
| Project       | `project`, `users_on_projects`                                                               |
| Issues/Events | `issue`, `event`, `event_user`, `event_users_on_issues`, `event_users_on_projects`           |
| Metrics       | `metric`, `feedback`, `page_view`, `user_view`                                               |
| Alerts        | `alert` (conditions/filters/actions as JSON, levels: serious/warning/default), `alert_event` |
| Releases      | `release` with `sourceMaps` JSONB column                                                     |

#### Ingestion Pipeline

```
SDK POST → Hono /
  │
  ├─ category: "error"  → BullMQ "document" queue (3s delay)
  │                         → event.worker: persist event → upsert issue
  │                           → aggregate counts → maybe enqueue "alert"
  │
  ├─ category: "performance" → metric job
  ├─ category: "feedback"    → feedback job
  ├─ category: "view"        → pageView / userView job
  │
  └─ alert.worker: evaluate rules → email/webhook → alert_event rows

Source Map Upload:
  POST /sourceMap/upload → BullMQ "sourceMap" queue
    → source-map.worker: upsert release → store file to .uploads/
    → max 5000 maps per release (FIFO eviction)
```

#### Dashboard Pages

| Route              | Feature                                                                    |
| ------------------ | -------------------------------------------------------------------------- |
| `/issues`          | Issue list: sort by Last seen / First seen / Events / Users                |
| `/issues/$issueId` | Issue detail: 24h/14d trend bars, latest event detail, source-mapped stack |
| `/feedbacks`       | User feedback list + detail                                                |
| `/alerts`          | Alert rules: create/edit/delete, event trends                              |
| `/metrics`         | Performance metrics                                                        |
| `/releases`        | Release list, uploaded source maps per release                             |
| `/users`           | Affected users                                                             |
| `/settings`        | Project settings                                                           |

#### Source Map Resolution

1. SDK or CLI uploads `.map` files to `POST /sourceMap/upload` with `apiKey` + `appVersion`
2. Dashboard stores files on disk (`.uploads/`), metadata in `release.sourceMaps` JSONB
3. When viewing an event, the `event.get` oRPC procedure uses `source-map-trace` to resolve stack frames against the matching release's source maps
4. Resolved source location displayed alongside the raw stack

### 3.3 ohbug Integration Plan for Paperboy

#### What We Use Directly

| Package                       | Integration                                               |
| ----------------------------- | --------------------------------------------------------- |
| `@ohbug/browser`              | `npm install` into React SPA, captures all runtime errors |
| `@ohbug/react`                | `OhbugErrorBoundary` wrapping top-level components        |
| `@ohbug/extension-rrweb`      | Session replay recording                                  |
| `@ohbug/extension-web-vitals` | Core Web Vitals monitoring                                |
| `@ohbug/unplugin`             | Auto-upload source maps on build                          |

#### What We Need to Add

| Component                      | Description                                                                                                                                        |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@ohbug/webview`               | New extension: captures WebView bridge errors (Swift↔WebView communication failures, bridge timeouts)                                              |
| Dashboard component extraction | Extract issue list, issue detail, trend charts, alert management from ohbug-dashboard into embeddable React components for the Observability panel |
| Santi as ingestion backend     | Route ohbug events through Santi's API instead of the standalone Hono server, enabling cloud-side enrichment with kly + OS context                 |

---

## 4. kly — Static Code Context

kly (`~/work/kly`) is a file-level code repository indexing tool. It parses code structure via tree-sitter AST, uses LLM to generate human-readable file metadata, and stores everything in per-branch SQLite databases.

### 4.1 Current Capabilities

| Capability                   | Status | Description                                                                    |
| ---------------------------- | ------ | ------------------------------------------------------------------------------ |
| Tree-sitter AST parsing      | ✅     | TypeScript / JavaScript / Swift                                                |
| LLM file metadata generation | ✅     | File description, summary, symbol descriptions                                 |
| Git-aware incremental build  | ✅     | Per-branch SQLite, only re-indexes changed files                               |
| FTS5 full-text search        | ✅     | BM25 ranking + optional LLM rerank                                             |
| Dependency graph             | ✅     | File-level, based on relative path import resolution                           |
| MCP Server                   | ✅     | 3 tools: `search_files`, `get_file_index`, `get_overview`                      |
| CLI                          | ✅     | 9 commands: `init`/`build`/`query`/`show`/`overview`/`graph`/`mcp`/`hook`/`gc` |

### 4.2 Core Type Definitions

```typescript
interface FileIndex {
  path: string;
  name: string; // LLM-generated file name
  description: string; // LLM-generated file description
  language: Language; // typescript | javascript | swift
  imports: string[];
  exports: string[];
  symbols: SymbolInfo[]; // functions/classes/interfaces/types/enums/variables
  summary: string; // LLM-generated file summary
  hash: string;
  indexedAt: number;
}

interface SymbolInfo {
  name: string;
  kind: SymbolKind; // class | function | method | interface | type | enum | variable | protocol | struct
  description: string;
}

interface DependencyGraph {
  nodes: Map<string, GraphNode>;
  edges: GraphEdge[]; // { from, to }
}
```

### 4.3 Library Exports

kly is already a cleanly exported TypeScript library (`src/index.ts`):

- `IndexDatabase` — SQLite database operations (CRUD, search)
- `buildIndex()` — Build/incremental index update
- `searchFiles()` / `searchFilesWithRerank()` — Search
- `buildDependencyGraph()` / `generateMermaid()` — Dependency graph
- `scanFiles()` — File scanning
- `ParserManager` — Tree-sitter parser management
- `LLMService` — LLM invocation
- Git utility functions (`getCurrentBranch`, `getChangedFiles`, etc.)
- Store functions (`openDatabase`, `loadState`, etc.)

### 4.4 Known Issues

| Issue                                                | Severity | Description                                                                         |
| ---------------------------------------------------- | -------- | ----------------------------------------------------------------------------------- |
| `better-sqlite3` ABI incompatibility                 | 🔴       | Node v24 binary vs vite-plus Node v25 wrapper. Mitigated by running Santi on Bun.   |
| Rough LLM provider error handling                    | 🟡       | Invalid API key reports "Unexpected end of JSON input" — should report clear error. |
| Dependency graph only resolves relative path imports | 🟡       | Does not track `node_modules` package imports, dynamic imports, or re-exports.      |

---

## 5. The Intersection — `enrich_error_stack`

This is the core integration point where ohbug's runtime data meets kly's static code context. Error stacks captured by ohbug obtain full code context through kly.

### 5.1 Before vs After

**Without kly (traditional mode):**

```
TypeError: Cannot read property 'content' of undefined
    at renderMessage (MessageList.tsx:142)
    at Array.map (<anonymous>)
    at ChatPanel (ChatPanel.tsx:87)
```

→ You only know line 142 crashed. Then manually search the code, manually assess blast radius.

**With kly + ohbug (target mode):**

```
TypeError: Cannot read property 'content' of undefined
    at renderMessage (MessageList.tsx:142)

    ┌─ kly: MessageList.tsx
    │  Description: Chat message list rendering component, handles streaming/markdown/attachment
    │  symbols: renderMessage(), useScrollPosition(), MessageBubble
    │  imports from: ChatStore, MessageTypes, MarkdownRenderer
    │  imported by: ChatPanel, WorkspaceChat, DetachedChatWindow (5 consumers)
    │
    │  Risk propagation: ChatPanel.tsx → WorkspaceRoot.tsx → App.tsx
    │  Errors in this file (last 30 days): 3 (high-frequency module)
    │  Last modified: commit abc1234 by @yanan-li (3 days ago, PR #236)
    └─
```

### 5.2 Function Signature

```typescript
interface EnrichedFrame {
  file: string;
  line: number;
  column?: number;
  function?: string;

  // kly index enrichment
  fileDescription: string;
  fileSummary: string;
  symbols: SymbolInfo[];
  language: Language;

  // kly graph enrichment
  importedBy: string[]; // reverse dependencies
  importsFrom: string[]; // forward dependencies
  riskPropagation: string[]; // BFS expansion paths

  // git enrichment
  lastModified: GitCommit | null;
  recentCommits: GitCommit[];
}

interface EnrichedErrorStack {
  originalStack: string;
  frames: EnrichedFrame[];
  affectedModules: number;
  riskLevel: "low" | "medium" | "high" | "critical";
}

export function enrichErrorStack(
  db: IndexDatabase,
  root: string,
  stack: string | ErrorFrame[],
): EnrichedErrorStack;
```

### 5.3 Implementation Flow

```
Input: error stack (string or parsed frames)
  │
  ├── 1. Parse stack trace → extract file + line + function
  │      (if input is string, parse with error-stack-parser)
  │
  ├── 2. For each frame:
  │      ├── db.getFile(frame.file)         → file description, symbols, summary
  │      ├── getDependents(db, frame.file)  → reverse dependencies
  │      ├── graph.buildDependencyGraph()   → risk propagation paths
  │      └── getFileHistory(root, frame.file) → recent modifications
  │
  ├── 3. Calculate riskLevel:
  │      ├── Dependency fan-out > 10 → +1 level
  │      ├── Modified within last 7 days → +1 level
  │      ├── Historical error count > 3 (requires ohbug data) → +1 level
  │      └── low(0) / medium(1) / high(2) / critical(3)
  │
  └── 4. Assemble and return EnrichedErrorStack
```

### 5.4 New APIs Required in kly

**`getDependents()` — Reverse dependency query:**

```typescript
export function getDependents(db: IndexDatabase, filePath: string): string[] {
  const allFiles = db.getAllFiles();
  const indexedPaths = new Set(allFiles.map((f) => f.path));
  const dependents: string[] = [];

  for (const file of allFiles) {
    for (const imp of file.imports) {
      const resolved = resolveImport(file.path, imp, indexedPaths);
      if (resolved === filePath) {
        dependents.push(file.path);
      }
    }
  }
  return dependents;
}
```

**`getFileHistory()` — Git history query:**

```typescript
interface GitCommit {
  hash: string;
  author: string;
  email: string;
  date: number;
  message: string;
}

export function getFileHistory(root: string, filePath: string, limit = 5): GitCommit[] {
  const result = execSync(
    `git log --follow -n ${limit} --format='%H|%an|%ae|%at|%s' -- ${filePath}`,
    { cwd: root, encoding: "utf-8" },
  );
  return result
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [hash, author, email, date, ...messageParts] = line.split("|");
      return { hash, author, email, date: parseInt(date, 10), message: messageParts.join("|") };
    });
}
```

**Performance optimization — `dependencies` table:**

```sql
CREATE TABLE IF NOT EXISTS dependencies (
  from_path TEXT NOT NULL,
  to_path TEXT NOT NULL,
  PRIMARY KEY (from_path, to_path)
);

CREATE INDEX IF NOT EXISTS idx_deps_to ON dependencies(to_path);
-- Reverse query: SELECT from_path FROM dependencies WHERE to_path = ?
```

### 5.5 New MCP Tools

```typescript
// Existing tools (unchanged)
"search_files"; // FTS5 search
"get_file_index"; // Single file details
"get_overview"; // Repository overview

// New tools
"get_dependency_graph"; // file + depth → dependency graph (JSON/Mermaid)
"get_dependents"; // file → all files that import it
"get_file_history"; // file + limit → git modification history
"enrich_error_stack"; // error stack → enriched context
```

---

## 6. Santi Integration — The Orchestration Layer

Santi is the backend that connects all three data sources. It imports kly as a library, receives ohbug events via its API, and correlates OS context by timestamp.

### 6.1 KlyService

```typescript
// packages/santi/src/observability/kly-service.ts
import {
  openDatabase,
  searchFiles,
  buildDependencyGraph,
  enrichErrorStack,
  getDependents,
  getFileHistory,
  buildIndex,
} from "kly";

export class KlyService {
  private repoRoot: string;

  constructor(repoRoot: string) {
    this.repoRoot = repoRoot;
  }

  enrichError(errorStack: string): EnrichedErrorStack {
    const db = openDatabase(this.repoRoot);
    try {
      return enrichErrorStack(db, this.repoRoot, errorStack);
    } finally {
      db.close();
    }
  }

  getFileInfo(filePath: string) {
    const db = openDatabase(this.repoRoot);
    try {
      return {
        index: db.getFile(filePath),
        dependents: getDependents(db, filePath),
        history: getFileHistory(this.repoRoot, filePath),
      };
    } finally {
      db.close();
    }
  }

  async rebuildIndex() {
    await buildIndex(this.repoRoot, { incremental: true });
  }
}
```

### 6.2 Integration Mode

```
Santi directly imports kly library functions  ←  Primary (zero protocol overhead)
     │
     │  simultaneously
     │
kly MCP server (stdio)  ←  For Claude Code / Codex / MiniChen
```

Rationale for direct import over MCP/HTTP:

- kly is already a cleanly exported TypeScript library
- Both Santi and kly are TypeScript, types are naturally shared
- No extra process, no protocol overhead
- MCP mode preserved for external agents

---

## 7. End-to-End Data Flow

```
┌────────────────────────────┐
│ Paperboy WebView (React)   │
│                             │
│ @ohbug/browser captures     │
│ error + error-stack-parser  │
│ parses it                   │
└──────────────┬──────────────┘
               │ Reports error event
               │ (stack trace + source-mapped file names/line numbers)
               ▼
┌──────────────────────────────────────────────────┐
│ Santi / Cloud API                                 │
│                                                   │
│  1. Receive ohbug error event                     │
│                                                   │
│  2. Source map resolution                         │
│     → source-map-trace resolves to source lines   │
│                                                   │
│  3. KlyService.enrichError(stack)                 │
│     ├── db.getFile()         → file desc/symbols  │
│     ├── getDependents()      → reverse deps       │
│     ├── buildDependencyGraph() → risk propagation │
│     └── getFileHistory()     → git history        │
│                                                   │
│  4. Merge OS context (from Paperboy OS capture    │
│     layer, correlated by timestamp)               │
│     ├── Screenshot at time of error               │
│     ├── User action trail (mouse/keyboard/window  │
│     │   switches)                                 │
│     └── Clipboard content                         │
│                                                   │
│  5. Generate Enriched Error Report                │
│     → Store in ohbug database                     │
│     → Push to Observability panel                 │
│     → Auto-generate Markdown document             │
│     → Optional: auto-create Linear issue          │
└──────────────┬───────────────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────────────┐
│ Observability Panel (React)                       │
│                                                   │
│  ┌──────────────────────────────────────────────┐ │
│  │ Enriched Error View                          │ │
│  │                                              │ │
│  │ TypeError: Cannot read 'content' of undefined│ │
│  │ at renderMessage (MessageList.tsx:142)        │ │
│  │                                              │ │
│  │ MessageList.tsx                               │ │
│  │    Chat message list rendering component     │ │
│  │    5 modules depend on this file             │ │
│  │    Last modified: @yanan-li, 3 days ago,     │ │
│  │    PR #236                                   │ │
│  │                                              │ │
│  │ User's screen at the time                     │ │
│  │    [screenshot]                              │ │
│  │                                              │ │
│  │ Action Timeline                               │ │
│  │    15:42:01 Chrome copy code                 │ │
│  │    15:42:03 Switch to Paperboy               │ │
│  │    15:42:05 Paste into input field           │ │
│  │    15:42:06 Click send                       │ │
│  │    15:42:08 ERROR                            │ │
│  └──────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────┘
```

---

## 8. Competitive Advantage — Why Only Paperboy Can Do This

| Data Dimension                    | Sentry               | Paperboy                                                    |
| --------------------------------- | -------------------- | ----------------------------------------------------------- |
| Error Stack                       | ✅                   | ✅ (ohbug + source map → commit/line)                       |
| Session Replay                    | rrweb DOM simulation | ✅ **Real OS screenshots** (not simulation, fact)           |
| User Action Trail                 | Page-internal clicks | ✅ **Full OS actions** (mouse/keyboard/window/app switches) |
| Clipboard Content                 | ❌                   | ✅ What the user copied/pasted                              |
| Cross-App Context                 | ❌                   | ✅ Which app the user switched from                         |
| UI State Tree                     | ❌                   | ✅ Accessibility Tree complete snapshot                     |
| Code Structure / Dependency Graph | ❌                   | ✅ kly file index + dependency graph                        |
| git blame / PR Correlation        | Manual config        | ✅ kly automatic correlation                                |

**Scenario example:**

```
15:42:01  User copies code in Chrome            ← OS: clipboard event
15:42:03  User switches to Paperboy             ← OS: window switch
15:42:05  User pastes into chat input            ← OS: keystroke ⌘V
15:42:06  User clicks send                      ← OS: mouse click
15:42:07  [screenshot] user's full screen       ← OS: screenshot
15:42:08  TypeError: Cannot read 'content'      ← ohbug: error event
           at MessageList.tsx:142

           ┌─ kly enrichment:
           │  MessageList.tsx modified 3 days ago by @yanan-li (PR #236)
           │  imports from: ChatStore (data source)
           │  imported by: 5 consumers
           └─
```

→ No need to ask the user "describe your steps." The system already knows everything.

---

## 9. Observability Panel Features

The Observability panel is an embedded tab in the Paperboy React SPA, combining ohbug-dashboard components with kly enrichment and OS context.

### 9.1 Core Views

| View                | Source                 | Description                                                                       |
| ------------------- | ---------------------- | --------------------------------------------------------------------------------- |
| Issue List          | ohbug-dashboard        | Aggregated issues with occurrence count, affected users, trend                    |
| Issue Detail        | ohbug-dashboard + kly  | Error stack with kly enrichment, source-mapped code, dependency graph             |
| Session Replay      | rrweb + OS screenshots | DOM recording + real OS screenshots at error time                                 |
| Action Timeline     | OS capture layer       | Chronological user actions leading to the error                                   |
| Risk Heatmap        | kly dependency graph   | Dependency fan-out visualization, highlighting high-risk modules                  |
| Trend Charts        | ohbug-dashboard        | Error rate trends (daily/weekly), performance metrics                             |
| Alert Management    | ohbug-dashboard        | Configure alert rules, notification channels                                      |
| Daily Health Report | ohbug + kly            | Auto-generated: new/closed issues, error rate trend, affected users, perf metrics |

### 9.2 Automated Workflows

| Trigger                         | Action                                                                                 |
| ------------------------------- | -------------------------------------------------------------------------------------- |
| New ohbug issue created         | Auto-generate Markdown document (error summary, stack, impact, repro steps, commit/PR) |
| Error in high-dependency module | Auto-escalate priority, notify responsible developer                                   |
| Slack #bugs message             | Unified intake → correlate with ohbug events → auto-assign                             |
| Linear / GitHub issue           | Webhook → Santi API → link to ohbug issue                                              |
| PR submitted (MiniChen review)  | kly MCP query changed files → dependency graph → flag impacted modules                 |

---

## 10. Action Plan

### Step 1: kly Core Modifications

| #   | Task                                          | Priority | Effort                           |
| --- | --------------------------------------------- | -------- | -------------------------------- |
| 1   | Add `getDependents()` API + export            | 🔴 High  | Small (~50 lines)                |
| 2   | Add `getFileHistory()` API + export           | 🔴 High  | Small (~30 lines)                |
| 3   | Add `dependencies` table + write during build | 🟡 Med   | Medium (schema + indexer change) |
| 4   | Add `enrichErrorStack()` + export             | 🔴 High  | Medium (~150 lines)              |
| 5   | MCP: add 4 new tools                          | 🟡 Med   | Small (wrap existing logic)      |
| 6   | Fix LLM provider error handling               | 🟢 Low   | Small                            |

### Step 2: ohbug Enhancements

| #   | Task                                                     | Priority | Effort |
| --- | -------------------------------------------------------- | -------- | ------ |
| 1   | Create `@ohbug/webview` extension (bridge error capture) | 🔴 High  | Medium |
| 2   | Extract dashboard components into embeddable package     | 🔴 High  | Large  |
| 3   | Integrate rrweb extension into Paperboy React SPA        | 🟡 Med   | Small  |
| 4   | Add web-vitals extension                                 | 🟡 Med   | Small  |
| 5   | Configure unplugin for auto source map upload            | 🟡 Med   | Small  |

### Step 3: Santi Integration

| #   | Task                                                | Priority | Effort |
| --- | --------------------------------------------------- | -------- | ------ |
| 1   | Santi `pnpm add kly`                                | 🔴 High  | —      |
| 2   | Implement `KlyService` wrapper                      | 🔴 High  | Medium |
| 3   | ohbug event → `KlyService.enrichError()` call chain | 🔴 High  | Medium |
| 4   | Enriched Error Report → storage + push to frontend  | 🔴 High  | Medium |
| 5   | Merge OS context data (screenshots + action trail)  | 🟡 Med   | Medium |
| 6   | Migrate ohbug ingestion into Santi API              | 🟡 Med   | Large  |

### Step 4: CI Integration

| #   | Task                                                   | Priority | Effort                                  |
| --- | ------------------------------------------------------ | -------- | --------------------------------------- |
| 1   | GitHub Actions: `kly build --incremental` on each push | 🟡 Med   | Small                                   |
| 2   | Upload index DB to cloud storage                       | 🟡 Med   | Small                                   |
| 3   | Post-commit hook auto-update local index               | 🟢 Low   | Small (already have `kly hook install`) |

### Step 5: Observability Panel

| #   | Task                                              | Priority | Effort |
| --- | ------------------------------------------------- | -------- | ------ |
| 1   | Issue list + detail views                         | 🔴 High  | Medium |
| 2   | Enriched error stack view                         | 🔴 High  | Medium |
| 3   | Action timeline + OS screenshot view              | 🔴 High  | Medium |
| 4   | Risk heatmap / dependency visualization           | 🟡 Med   | Medium |
| 5   | Alert management UI                               | 🟡 Med   | Small  |
| 6   | Daily health report auto-generation               | 🟡 Med   | Medium |
| 7   | Unified intake (Slack + Linear + GitHub webhooks) | 🟢 Low   | Large  |

---

## 11. Appendix

### A. Project Paths

- **ohbug SDK**: `~/work/ohbug` (pnpm monorepo, Vite+, Apache-2.0)
- **ohbug-dashboard**: `~/work/ohbug-dashboard` (pnpm monorepo, `feature/shadcn` branch)
- **kly**: `~/work/kly` (TypeScript, Vite+, tree-sitter + LLM)
- **Paperboy**: `~/work/paperboy` (Swift/SwiftUI + Santi daemon)

### B. Relationship with Frontend Rewrite Document

This document is the detailed technical design for Section 4.2 "Observability + Reliability" and Section 5.3 "kly + ohbug — Two Sides of One System" in the [Paperboy Frontend Rewrite Plan](./paperboy-frontend-rewrite.md). The rewrite document defines the _why_ (why observability matters, why these tools), while this document defines the _how_ (system architecture, component details, integration steps).

### C. Dependency Relationships

```
ohbug SDK (@ohbug/browser, @ohbug/react, extensions)
  ├── Runs in React WebView, captures errors
  ├── Reports to Santi / Cloud API
  └── Source maps uploaded via @ohbug/unplugin or @ohbug/cli

ohbug-dashboard (components)
  ├── Issue list, detail, charts → extracted into Observability panel
  └── Ingestion pipeline → migrated into Santi

kly (library)
  ├── Imported by Santi (direct library function calls)
  ├── Called by Claude Code / Codex / MiniChen via MCP
  └── Called by CI via CLI

Santi (backend, orchestration)
  ├── import kly → enrichErrorStack()
  ├── Receives ohbug error events
  ├── Merges OS context data (screenshots, actions, clipboard)
  ├── Runs ohbug ingestion pipeline (from ohbug-dashboard server)
  └── Outputs Enriched Error Report → Observability panel
```
