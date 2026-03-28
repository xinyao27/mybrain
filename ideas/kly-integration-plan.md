# kly Integration into Paperboy Observability System

> Created: 2026-03-28
> Author: Xinyao Chen
> Status: Draft
> Related document: [Paperboy Frontend Rewrite Plan](./paperboy-frontend-rewrite.md)

## 1. Background

kly (`~/work/kly`) is a file-level code repository indexing tool that parses code structure via tree-sitter AST, uses LLM to generate human-readable file metadata, and stores it in per-branch SQLite databases.

In the Paperboy Frontend Rewrite Plan, kly and ohbug are defined as "two sides of one system" — kly is the static perspective (code structure), ohbug is the runtime perspective (error scenes). Error Stack is their intersection point.

**This document defines how kly transitions from its current standalone CLI tool to a core component of the Paperboy observability system.**

---

## 2. kly Current State Assessment

### 2.1 Verified and Available Capabilities

| Capability                   | Status | Description                                                                    |
| ---------------------------- | ------ | ------------------------------------------------------------------------------ |
| Tree-sitter AST parsing      | ✅     | TypeScript / JavaScript / Swift                                                |
| LLM file metadata generation | ✅     | File description, summary, symbol descriptions                                 |
| Git-aware incremental build  | ✅     | Per-branch SQLite, only re-indexes changed files                               |
| FTS5 full-text search        | ✅     | BM25 ranking + optional LLM rerank                                             |
| Dependency graph             | ✅     | File-level, based on relative path import resolution                           |
| MCP Server                   | ✅     | 3 tools: `search_files`, `get_file_index`, `get_overview`                      |
| CLI                          | ✅     | 9 commands: `init`/`build`/`query`/`show`/`overview`/`graph`/`mcp`/`hook`/`gc` |
| Test coverage                | ✅     | High coverage on core modules, smoke tests for CLI/MCP                         |

### 2.2 Known Issues

| Issue                                                | Severity | Description                                                                         |
| ---------------------------------------------------- | -------- | ----------------------------------------------------------------------------------- |
| `better-sqlite3` ABI incompatibility                 | 🔴       | Node v24 binary vs vite-plus Node v25 wrapper. Blocks packaging/distribution.       |
| Rough LLM provider error handling                    | 🟡       | Invalid API key reports "Unexpected end of JSON input" — should report clear error. |
| Dependency graph only resolves relative path imports | 🟡       | Does not track `node_modules` package imports, dynamic imports, or re-exports.      |

### 2.3 Core Type Definitions (Existing)

```typescript
interface FileIndex {
  path: string; // file path
  name: string; // LLM-generated file name
  description: string; // LLM-generated file description
  language: Language; // typescript | javascript | swift
  imports: string[]; // import path list
  exports: string[]; // export name list
  symbols: SymbolInfo[]; // functions/classes/interfaces/types/enums/variables
  summary: string; // LLM-generated file summary
  hash: string; // file content hash
  indexedAt: number; // index timestamp
}

interface SymbolInfo {
  name: string;
  kind: SymbolKind; // class | function | method | interface | type | enum | variable | protocol | struct
  description: string; // LLM-generated description
}

interface DependencyGraph {
  nodes: Map<string, GraphNode>;
  edges: GraphEdge[]; // { from, to }
}
```

### 2.4 Existing Library Exports (`src/index.ts`)

kly is already a cleanly exported TypeScript library:

- `IndexDatabase` — SQLite database operations (CRUD, search)
- `buildIndex()` — Build/incremental index update
- `searchFiles()` / `searchFilesWithRerank()` — Search
- `buildDependencyGraph()` / `generateMermaid()` — Dependency graph
- `scanFiles()` — File scanning
- `ParserManager` — Tree-sitter parser management
- `LLMService` — LLM invocation
- Git utility functions (`getCurrentBranch`, `getChangedFiles`, etc.)
- Store functions (`openDatabase`, `loadState`, etc.)

---

## 3. Gap Analysis — What's Needed for Observability System Integration

### 3.1 🔴 Insufficient MCP Tools

The query capabilities needed for ohbug integration are not currently exposed by kly:

| Required Tool          | Current Status                                          | Description                                                               |
| ---------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------- |
| `get_dependency_graph` | ⚠️ Implemented (`graph.ts`) but not exposed as MCP tool | Given a file, return its dependency graph                                 |
| `get_dependents`       | ❌ Missing                                              | Given a file, return "who imports it" — reverse dependency query          |
| `get_file_history`     | ❌ Missing                                              | Given a file, return recent git modification records (commit/author/date) |
| `enrich_error_stack`   | ❌ Missing                                              | **Core tool**: Given an error stack, return fully enriched context        |

### 3.2 🔴 Missing `enrich_error_stack` High-Level Function

This is the intersection point of kly and ohbug — error stacks captured by ohbug obtain full code context through this function:

**Input:**

```
TypeError: Cannot read property 'content' of undefined
    at renderMessage (src/components/MessageList.tsx:142)
    at ChatPanel (src/components/ChatPanel.tsx:87)
```

**Output:**

```json
{
  "frames": [
    {
      "file": "src/components/MessageList.tsx",
      "line": 142,
      "function": "renderMessage",
      "fileDescription": "Chat message list rendering component, handles streaming/markdown/attachment",
      "symbols": ["renderMessage()", "useScrollPosition()", "MessageBubble"],
      "importedBy": ["ChatPanel.tsx", "WorkspaceChat.tsx", "DetachedChatWindow.tsx"],
      "importsFrom": ["ChatStore.ts", "MessageTypes.ts", "MarkdownRenderer.ts"],
      "riskPropagation": ["ChatPanel.tsx → WorkspaceRoot.tsx → App.tsx"],
      "lastModified": {
        "commit": "abc1234",
        "author": "@yanan-li",
        "date": "2026-03-25T10:30:00Z",
        "pr": "#236"
      }
    }
  ]
}
```

### 3.3 🔴 Local-Only Execution — Cloud Access Needed

kly currently runs as CLI + MCP stdio, only locally on the developer's machine. Paperboy's cloud architecture requires a different integration approach.

**Three approach comparison:**

| Approach                   | Method                                                                | Pros                                                | Cons                                          |
| -------------------------- | --------------------------------------------------------------------- | --------------------------------------------------- | --------------------------------------------- |
| A. CI build + upload       | CI runs `kly build` → push SQLite DB to cloud storage → cloud queries | Simple                                              | Queries go through cloud storage, extra layer |
| B. Add HTTP mode to kly    | Add HTTP server alongside MCP stdio                                   | Independent deployment                              | One more service to maintain                  |
| **C. Santi direct import** | `import { ... } from 'kly'`                                           | Zero deployment, type sharing, direct library calls | kly and Santi coupling                        |

**Recommended approach C: Santi directly imports kly's library functions.**

Rationale:

- kly is already a cleanly exported TypeScript library (`src/index.ts` exports all core functions)
- Both Santi and kly are TypeScript, types are naturally shared
- No need to run an extra process, no MCP protocol overhead
- MCP mode is preserved for external agents (Claude Code / Codex / MiniChen)

```typescript
// Using kly in Santi
import {
  openDatabase,
  searchFiles,
  buildDependencyGraph,
  getDependents, // new
  getFileHistory, // new
  enrichErrorStack, // new
} from "kly";
```

### 3.4 🟡 Missing Reverse Dependency Query API

The BFS in `graph.ts` already handles reverse edges internally, but it's not exposed as a standalone API.

**Needs to be added:**

```typescript
/**
 * Query who imports a given file (reverse dependencies)
 */
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

### 3.5 🟡 Missing Git History Query

kly uses git for incremental builds (`git diff`), but doesn't provide single-file modification history queries. ohbug enrichment needs "who recently modified this file."

**Needs to be added:**

```typescript
interface GitCommit {
  hash: string;
  author: string;
  email: string;
  date: number; // unix timestamp
  message: string;
}

/**
 * Query recent git modification records for a file
 */
export function getFileHistory(root: string, filePath: string, limit = 5): GitCommit[] {
  // git log --follow -n {limit} --format='%H|%an|%ae|%at|%s' -- {filePath}
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
      return {
        hash,
        author,
        email,
        date: parseInt(date, 10),
        message: messageParts.join("|"),
      };
    });
}
```

### 3.6 🟡 `better-sqlite3` ABI Compatibility Issue

**Symptom:** `better-sqlite3` crashes under Node v25 (ABI 141), only works under Node v24 (ABI 137).

**Mitigation options:**

| Approach                  | Description                                                                                                                             |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| **A. Run Santi on Bun**   | Bun has built-in SQLite, and `better-sqlite3` is also compatible under Bun. If Santi runs on Bun, the problem disappears automatically. |
| B. Switch to `bun:sqlite` | Replace `better-sqlite3` with Bun's built-in `bun:sqlite`. But loses Node.js compatibility.                                             |
| C. Lock Node version      | Ensure runtime uses Node v24. Treats the symptom, not the cause.                                                                        |

**Recommended A** — Santi has already been confirmed to run on Bun, so this issue requires no additional resolution.

---

## 4. `enrich_error_stack` Detailed Design

This is the core new capability for kly's integration into the observability system.

### 4.1 Function Signature

```typescript
interface ErrorFrame {
  file: string;
  line: number;
  column?: number;
  function?: string;
}

interface EnrichedFrame {
  // Original stack info
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
  importedBy: string[]; // Reverse dependencies: who imports this file
  importsFrom: string[]; // Forward dependencies: what this file imports
  riskPropagation: string[]; // Risk propagation paths (BFS expansion)

  // git enrichment
  lastModified: GitCommit | null;
  recentCommits: GitCommit[]; // Last N modifications
}

interface EnrichedErrorStack {
  originalStack: string;
  frames: EnrichedFrame[];
  affectedModules: number; // Total affected modules (deduplicated importedBy across all frames)
  riskLevel: "low" | "medium" | "high" | "critical"; // Based on dependency fan-out + error history
}

export function enrichErrorStack(
  db: IndexDatabase,
  root: string,
  stack: string | ErrorFrame[],
): EnrichedErrorStack;
```

### 4.2 Implementation Flow

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

### 4.3 Performance Considerations

- `db.getFile()` is O(1) primary key lookup
- `getDependents()` requires traversing all files' imports → should build a reverse index cache
- `buildDependencyGraph()` does BFS → limit depth=2 to avoid full graph traversal
- `getFileHistory()` calls `git log` → requires subprocess, but results can be cached

**Optimization suggestion:**

Add a new `dependencies` table in `IndexDatabase`, written synchronously during build, enabling O(1) queries:

```sql
CREATE TABLE IF NOT EXISTS dependencies (
  from_path TEXT NOT NULL,
  to_path TEXT NOT NULL,
  PRIMARY KEY (from_path, to_path)
);

CREATE INDEX IF NOT EXISTS idx_deps_to ON dependencies(to_path);
-- Reverse query: SELECT from_path FROM dependencies WHERE to_path = ?
```

---

## 5. MCP Tool Extensions

Preserve the MCP server for external agent use (Claude Code / Codex / MiniChen), adding 4 new tools:

### 5.1 New Tool List

```typescript
// Existing tools (unchanged)
"search_files"; // FTS5 search
"get_file_index"; // Single file details
"get_overview"; // Repository overview

// New tools
"get_dependency_graph"; // Input file + depth → output dependency graph (JSON/Mermaid)
"get_dependents"; // Input file → output all files that import it
"get_file_history"; // Input file + limit → output git modification history
"enrich_error_stack"; // Input error stack → output enriched context
```

### 5.2 `get_dependency_graph` Tool

```typescript
server.registerTool(
  "get_dependency_graph",
  {
    description: "Get dependency graph for a file, showing what it imports and what imports it",
    inputSchema: {
      path: z.string().describe("File path relative to repository root"),
      depth: z.number().optional().default(2).describe("BFS traversal depth"),
      format: z.enum(["json", "mermaid"]).optional().default("json"),
    },
  },
  async ({ path, depth, format }) => {
    const db = openDatabase(root);
    try {
      const graph = buildDependencyGraph(db, { focus: path, depth });
      const output =
        format === "mermaid"
          ? generateMermaid(graph)
          : JSON.stringify(
              {
                nodes: Array.from(graph.nodes.values()),
                edges: graph.edges,
              },
              null,
              2,
            );
      return { content: [{ type: "text", text: output }] };
    } finally {
      db.close();
    }
  },
);
```

### 5.3 `enrich_error_stack` Tool

```typescript
server.registerTool(
  "enrich_error_stack",
  {
    description:
      "Enrich an error stack trace with file descriptions, dependency graph, and git history",
    inputSchema: {
      stack: z.string().describe("Error stack trace string"),
    },
  },
  async ({ stack }) => {
    const db = openDatabase(root);
    try {
      const enriched = enrichErrorStack(db, root, stack);
      return { content: [{ type: "text", text: JSON.stringify(enriched, null, 2) }] };
    } finally {
      db.close();
    }
  },
);
```

---

## 6. Integration with Santi

### 6.1 Direct Library Import (Primary Approach)

```typescript
// packages/santi/src/observability/kly-service.ts

import {
  openDatabase,
  searchFiles,
  buildDependencyGraph,
  enrichErrorStack, // new
  getDependents, // new
  getFileHistory, // new
  buildIndex,
} from "kly";

export class KlyService {
  private dbPath: string;
  private repoRoot: string;

  constructor(repoRoot: string) {
    this.repoRoot = repoRoot;
    this.dbPath = `${repoRoot}/.kly/db`;
  }

  /** Called when an ohbug error event arrives */
  enrichError(errorStack: string): EnrichedErrorStack {
    const db = openDatabase(this.repoRoot);
    try {
      return enrichErrorStack(db, this.repoRoot, errorStack);
    } finally {
      db.close();
    }
  }

  /** Query file info (for the Observability panel) */
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

  /** Search files (for the React frontend) */
  search(query: string, limit = 20) {
    const db = openDatabase(this.repoRoot);
    try {
      return searchFiles(db, query, limit);
    } finally {
      db.close();
    }
  }

  /** Incrementally update index (triggered by CI or post-commit hook) */
  async rebuildIndex() {
    await buildIndex(this.repoRoot, { incremental: true });
  }
}
```

### 6.2 MCP Server Preserved for External Agents

```
Santi directly imports kly library functions  ←  Primary integration (zero protocol overhead)
     │
     │  simultaneously
     │
kly MCP server (stdio)  ←  For Claude Code / Codex / MiniChen
```

### 6.3 CI Integration (Continuous Index Updates)

```yaml
# .github/workflows/kly-index.yml
name: Update kly index

on:
  push:
    branches: [main]
  pull_request:

jobs:
  index:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0 # Need full git history

      - uses: oven-sh/setup-bun@v2

      - run: bun install
      - run: bun run kly build --incremental

      # Upload index DB to cloud
      - run: |
          bun run upload-index .kly/db/main.db
```

---

## 7. Integration Data Flow with ohbug

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
│  2. KlyService.enrichError(stack)                 │
│     ├── db.getFile()         → file desc/symbols  │
│     ├── getDependents()      → reverse deps       │
│     ├── buildDependencyGraph() → risk propagation │
│     └── getFileHistory()     → git history        │
│                                                   │
│  3. Merge OS context (from Paperboy OS capture    │
│     layer)                                        │
│     ├── Screenshot at time of error               │
│     ├── User action trail (mouse/keyboard/window  │
│     │   switches)                                 │
│     └── Clipboard content                         │
│                                                   │
│  4. Generate Enriched Error Report                │
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
│  │ 📄 MessageList.tsx                           │ │
│  │    Chat message list rendering component     │ │
│  │    5 modules depend on this file             │ │
│  │    Last modified: @yanan-li, 3 days ago,     │ │
│  │    PR #236                                   │ │
│  │                                              │ │
│  │ 🖥 User's screen at the time                 │ │
│  │    [screenshot]                              │ │
│  │                                              │ │
│  │ 🔗 Action Timeline                           │ │
│  │    15:42:01 Chrome copy code                 │ │
│  │    15:42:03 Switch to Paperboy               │ │
│  │    15:42:05 Paste into input field           │ │
│  │    15:42:06 Click send                       │ │
│  │    15:42:08 💥 ERROR                         │ │
│  └──────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────┘
```

---

## 8. Action Plan

### Step 1: kly Core Modifications (Prerequisites for Santi Integration)

| #   | Task                                                  | Priority | Effort                                            |
| --- | ----------------------------------------------------- | -------- | ------------------------------------------------- |
| 1   | Add `getDependents()` API + export                    | 🔴 High  | Small (~50 lines, logic already inside graph.ts)  |
| 2   | Add `getFileHistory()` API + export                   | 🔴 High  | Small (~30 lines, git log parsing)                |
| 3   | Add `dependencies` table + write during build         | 🟡 Med   | Medium (DB schema change + indexer modification)  |
| 4   | Add `enrichErrorStack()` high-level function + export | 🔴 High  | Medium (~150 lines, composing existing functions) |
| 5   | MCP: add `get_dependency_graph` tool                  | 🟡 Med   | Small (graph.ts already implemented, wrap in MCP) |
| 6   | MCP: add `get_dependents` tool                        | 🟡 Med   | Small                                             |
| 7   | MCP: add `get_file_history` tool                      | 🟡 Med   | Small                                             |
| 8   | MCP: add `enrich_error_stack` tool                    | 🟡 Med   | Small                                             |
| 9   | Fix LLM provider error handling                       | 🟢 Low   | Small                                             |

### Step 2: Santi Integration

| #   | Task                                                      | Priority |
| --- | --------------------------------------------------------- | -------- |
| 1   | Santi `pnpm add kly`                                      | 🔴 High  |
| 2   | Implement `KlyService` wrapper layer                      | 🔴 High  |
| 3   | ohbug error event → `KlyService.enrichError()` call chain | 🔴 High  |
| 4   | Enriched Error Report → storage + push to frontend        | 🔴 High  |
| 5   | Merge OS context data (screenshots + action trail)        | 🟡 Med   |

### Step 3: CI Integration

| #   | Task                                                                | Priority                                 |
| --- | ------------------------------------------------------------------- | ---------------------------------------- |
| 1   | GitHub Actions workflow: run `kly build --incremental` on each push | 🟡 Med                                   |
| 2   | Upload index DB to cloud storage                                    | 🟡 Med                                   |
| 3   | Post-commit hook to auto-update local index                         | 🟢 Low (already have `kly hook install`) |

---

## 9. Appendix

### A. kly Project Paths

- Repository root: `~/work/kly`
- Core source:
  - `~/work/kly/src/index.ts` — Library exports (all public APIs)
  - `~/work/kly/src/database.ts` — SQLite database operations (IndexDatabase class)
  - `~/work/kly/src/graph.ts` — Dependency graph construction (buildDependencyGraph / generateMermaid)
  - `~/work/kly/src/indexer.ts` — Index builder (buildIndex)
  - `~/work/kly/src/query.ts` — Search (searchFiles / searchFilesWithRerank)
  - `~/work/kly/src/mcp.ts` — MCP server (3 tools)
  - `~/work/kly/src/git.ts` — Git operation utilities
  - `~/work/kly/src/scanner.ts` — File scanning
  - `~/work/kly/src/hasher.ts` — File hashing
  - `~/work/kly/src/store.ts` — Database/state management
  - `~/work/kly/src/types.ts` — Core type definitions
  - `~/work/kly/src/config.ts` — Configuration loading
- Parsers:
  - `~/work/kly/src/parser/typescript.ts` — TypeScript / JavaScript / JSX / TSX
  - `~/work/kly/src/parser/swift.ts` — Swift
  - `~/work/kly/src/parser/base.ts` — Parser base class
  - `~/work/kly/src/parser/index.ts` — ParserManager
- LLM:
  - `~/work/kly/src/llm/index.ts` — LLMService
  - `~/work/kly/src/llm/batcher.ts` — Batch LLM calls
  - `~/work/kly/src/llm/prompts.ts` — Prompt templates
  - `~/work/kly/src/llm/reranker.ts` — Search result LLM reranking
- Tests: `~/work/kly/src/__tests__/`
- Docs: `~/work/kly/docs/`
- Task log: `~/work/kly/tasks/todo.md`
- Config: `~/work/kly/vite.config.ts`, `~/work/kly/tsconfig.json`, `~/work/kly/package.json`

### B. Relationship with Frontend Rewrite Document

This document is the detailed technical proposal for Section 5.3 "kly + ohbug — Two Sides of One System" in the [Paperboy Frontend Rewrite Plan](./paperboy-frontend-rewrite.md). The rewrite document defines the _why_ (why kly and ohbug should be combined), while this document defines the _how_ (specifically how to modify kly and integrate with Santi).

### C. Dependency Relationships

```
kly (library)
  ├── Imported by Santi (direct library function calls)
  ├── Called by Claude Code / Codex / MiniChen via MCP
  └── Called by CI via CLI

ohbug (SDK)
  ├── Runs in React WebView, captures errors
  └── Reports to Santi / Cloud API

Santi (backend)
  ├── import kly → enrichErrorStack()
  ├── Receives ohbug error events
  ├── Merges OS context data
  └── Outputs Enriched Error Report → Observability panel
```
