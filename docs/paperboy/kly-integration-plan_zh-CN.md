# kly 接入 Paperboy 可观测性系统方案

> 创建日期：2026-03-28
> 作者：Xinyao Chen
> 状态：草案（Draft）
> 关联文档：[Paperboy 前端大重写方案](./paperboy-frontend-rewrite_zh-CN.md)

## 一、背景

kly（`~/work/kly`）是一个代码仓库文件级索引工具，通过 tree-sitter AST 解析代码结构，用 LLM 生成人类可读的文件元数据，存储在 per-branch SQLite 数据库中。

在 Paperboy 前端大重写方案中，kly 和 ohbug 被定义为「一个系统的两面」——kly 是静态视角（代码结构），ohbug 是运行时视角（错误现场）。Error Stack 是它们的交汇点。

**本文档定义 kly 如何从当前的独立 CLI 工具，调整为 Paperboy 可观测性系统的核心组件。**

---

## 二、kly 现状评估

### 2.1 已验证、可用的能力

| 能力                 | 状态 | 说明                                                                         |
| -------------------- | ---- | ---------------------------------------------------------------------------- |
| Tree-sitter AST 解析 | ✅   | TypeScript / JavaScript / Swift                                              |
| LLM 文件元数据生成   | ✅   | 文件描述、summary、symbol 描述                                               |
| Git-aware 增量构建   | ✅   | per-branch SQLite，只重新索引变更文件                                        |
| FTS5 全文搜索        | ✅   | BM25 排序 + 可选 LLM rerank                                                  |
| Dependency graph     | ✅   | 文件级，基于相对路径 import 解析                                             |
| MCP Server           | ✅   | 3 个 tool：`search_files`、`get_file_index`、`get_overview`                  |
| CLI                  | ✅   | 9 个命令：`init`/`build`/`query`/`show`/`overview`/`graph`/`mcp`/`hook`/`gc` |
| 测试覆盖             | ✅   | 核心模块覆盖率高，CLI/MCP 有 smoke test                                      |

### 2.2 已知问题

| 问题                        | 严重度 | 说明                                                             |
| --------------------------- | ------ | ---------------------------------------------------------------- |
| `better-sqlite3` ABI 不兼容 | 🔴     | Node v24 binary vs vite-plus Node v25 wrapper。block 打包分发。  |
| LLM provider 错误处理粗糙   | 🟡     | 无效 API key 报 "Unexpected end of JSON input"，应该报清晰错误。 |
| 依赖图只解析相对路径 import | 🟡     | 不追踪 `node_modules` 包导入、动态 import、re-export。           |

### 2.3 核心类型定义（现有）

```typescript
interface FileIndex {
  path: string; // 文件路径
  name: string; // LLM 生成的文件名称
  description: string; // LLM 生成的文件描述
  language: Language; // typescript | javascript | swift
  imports: string[]; // import 路径列表
  exports: string[]; // export 名称列表
  symbols: SymbolInfo[]; // 函数/类/接口/类型/枚举/变量
  summary: string; // LLM 生成的文件摘要
  hash: string; // 文件内容 hash
  indexedAt: number; // 索引时间戳
}

interface SymbolInfo {
  name: string;
  kind: SymbolKind; // class | function | method | interface | type | enum | variable | protocol | struct
  description: string; // LLM 生成的描述
}

interface DependencyGraph {
  nodes: Map<string, GraphNode>;
  edges: GraphEdge[]; // { from, to }
}
```

### 2.4 现有库导出（`src/index.ts`）

kly 已经是一个导出干净的 TypeScript 库：

- `IndexDatabase` — SQLite 数据库操作（CRUD、搜索）
- `buildIndex()` — 构建/增量更新索引
- `searchFiles()` / `searchFilesWithRerank()` — 搜索
- `buildDependencyGraph()` / `generateMermaid()` — 依赖图
- `scanFiles()` — 文件扫描
- `ParserManager` — tree-sitter 解析管理
- `LLMService` — LLM 调用
- Git 工具函数（`getCurrentBranch`、`getChangedFiles` 等）
- Store 函数（`openDatabase`、`loadState` 等）

---

## 三、Gap 分析——接入可观测性系统需要什么

### 3.1 🔴 MCP 工具不够

ohbug 集成需要的查询能力，kly 目前没有暴露：

| 需要的 tool            | 现状                                         | 说明                                                          |
| ---------------------- | -------------------------------------------- | ------------------------------------------------------------- |
| `get_dependency_graph` | ⚠️ 已实现（`graph.ts`），但未暴露为 MCP tool | 给一个文件，返回其依赖图                                      |
| `get_dependents`       | ❌ 缺失                                      | 给一个文件，返回"谁 import 了它"——反向依赖查询                |
| `get_file_history`     | ❌ 缺失                                      | 给一个文件，返回最近的 git 修改记录（commit/author/date）     |
| `enrich_error_stack`   | ❌ 缺失                                      | **核心 tool**：给一个 error stack，返回完整的 enriched 上下文 |

### 3.2 🔴 缺少 `enrich_error_stack` 高级函数

这是 kly 和 ohbug 的交汇点——ohbug 捕获的 error stack 通过这个函数获得完整的代码上下文：

**输入：**

```
TypeError: Cannot read property 'content' of undefined
    at renderMessage (src/components/MessageList.tsx:142)
    at ChatPanel (src/components/ChatPanel.tsx:87)
```

**输出：**

```json
{
  "frames": [
    {
      "file": "src/components/MessageList.tsx",
      "line": 142,
      "function": "renderMessage",
      "fileDescription": "Chat 消息列表渲染组件，处理 streaming/markdown/attachment",
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

### 3.3 🔴 只能本地跑——需要支持云端接入

kly 现在是 CLI + MCP stdio，只能在开发者本地跑。Paperboy 的云端架构需要不同的接入方式。

**三个方案对比：**

| 方案                     | 方式                                                | 优点                         | 缺点                   |
| ------------------------ | --------------------------------------------------- | ---------------------------- | ---------------------- |
| A. CI 构建 + 上传        | CI 跑 `kly build` → SQLite DB 推到云存储 → 云端查询 | 简单                         | 查询要走云存储，多一层 |
| B. kly 加 HTTP 模式      | 除 MCP stdio 外加 HTTP server                       | 独立部署                     | 多一个服务要维护       |
| **C. Santi 直接 import** | `import { ... } from 'kly'`                         | 零部署、类型共享、直调库函数 | kly 和 Santi 耦合      |

**推荐方案 C：Santi 直接 import kly 的库函数。**

理由：

- kly 已经是一个导出干净的 TypeScript 库（`src/index.ts` 导出了所有核心函数）
- Santi 和 kly 都是 TypeScript，类型自然共享
- 不需要多跑一个进程，不需要 MCP 协议开销
- MCP 模式保留给外部 agent（Claude Code / Codex / MiniChen）使用

```typescript
// Santi 中使用 kly
import {
  openDatabase,
  searchFiles,
  buildDependencyGraph,
  getDependents, // 新增
  getFileHistory, // 新增
  enrichErrorStack, // 新增
} from "kly";
```

### 3.4 🟡 缺少反向依赖查询 API

`graph.ts` 的 BFS 已经在内部处理了反向边，但没有暴露为独立 API。

**需要新增：**

```typescript
/**
 * 查询谁 import 了某个文件（反向依赖）
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

### 3.5 🟡 缺少 git history 查询

kly 用 git 做增量构建（`git diff`），但不提供单文件的修改历史查询。ohbug enrichment 需要"这个文件最近被谁改了"。

**需要新增：**

```typescript
interface GitCommit {
  hash: string;
  author: string;
  email: string;
  date: number; // unix timestamp
  message: string;
}

/**
 * 查询文件的最近 git 修改记录
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

### 3.6 🟡 `better-sqlite3` ABI 兼容问题

**现象：** `better-sqlite3` 在 Node v25 (ABI 141) 下 crash，只在 Node v24 (ABI 137) 下正常。

**对策选项：**

| 方案                | 说明                                                                                      |
| ------------------- | ----------------------------------------------------------------------------------------- |
| **A. Santi 跑 Bun** | Bun 内置 SQLite，`better-sqlite3` 在 Bun 下也兼容。如果 Santi 用 Bun 运行，问题自动消失。 |
| B. 换 `bun:sqlite`  | 替换 `better-sqlite3` 为 Bun 内置的 `bun:sqlite`。但会失去 Node.js 兼容性。               |
| C. 锁定 Node 版本   | 确保运行环境用 Node v24。治标不治本。                                                     |

**推荐 A** — Santi 已经确认用 Bun 运行，这个问题不需要额外解决。

---

## 四、`enrich_error_stack` 详细设计

这是 kly 接入可观测性系统的核心新增能力。

### 4.1 函数签名

```typescript
interface ErrorFrame {
  file: string;
  line: number;
  column?: number;
  function?: string;
}

interface EnrichedFrame {
  // 原始 stack 信息
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
  importedBy: string[]; // 反向依赖：谁 import 了这个文件
  importsFrom: string[]; // 正向依赖：这个文件 import 了谁
  riskPropagation: string[]; // 风险传播路径（BFS 展开）

  // git enrichment
  lastModified: GitCommit | null;
  recentCommits: GitCommit[]; // 最近 N 次修改
}

interface EnrichedErrorStack {
  originalStack: string;
  frames: EnrichedFrame[];
  affectedModules: number; // 受影响的模块总数（所有 frame 的 importedBy 去重）
  riskLevel: "low" | "medium" | "high" | "critical"; // 基于依赖扇出 + 错误历史
}

export function enrichErrorStack(
  db: IndexDatabase,
  root: string,
  stack: string | ErrorFrame[],
): EnrichedErrorStack;
```

### 4.2 实现流程

```
输入: error stack (string 或 parsed frames)
  │
  ├── 1. 解析 stack trace → 提取 file + line + function
  │      (如果输入是 string，用 error-stack-parser 解析)
  │
  ├── 2. 对每个 frame:
  │      ├── db.getFile(frame.file)         → 文件描述、symbols、summary
  │      ├── getDependents(db, frame.file)  → 反向依赖
  │      ├── graph.buildDependencyGraph()   → 风险传播路径
  │      └── getFileHistory(root, frame.file) → 最近修改
  │
  ├── 3. 计算 riskLevel:
  │      ├── 依赖扇出 > 10 → +1 level
  │      ├── 最近 7 天内有修改 → +1 level
  │      ├── 历史错误次数 > 3（需要 ohbug 数据） → +1 level
  │      └── low(0) / medium(1) / high(2) / critical(3)
  │
  └── 4. 组装 EnrichedErrorStack 返回
```

### 4.3 性能考量

- `db.getFile()` 是 O(1) 主键查询
- `getDependents()` 需要遍历所有文件的 imports → 应该建立反向索引缓存
- `buildDependencyGraph()` 做 BFS → 限制 depth=2 避免全图遍历
- `getFileHistory()` 调用 `git log` → 需要 subprocess，但结果可缓存

**优化建议：**

在 `IndexDatabase` 中新增一张 `dependencies` 表，构建时同步写入，查询时 O(1)：

```sql
CREATE TABLE IF NOT EXISTS dependencies (
  from_path TEXT NOT NULL,
  to_path TEXT NOT NULL,
  PRIMARY KEY (from_path, to_path)
);

CREATE INDEX IF NOT EXISTS idx_deps_to ON dependencies(to_path);
-- 反向查询：SELECT from_path FROM dependencies WHERE to_path = ?
```

---

## 五、MCP 工具扩展

保留 MCP server 给外部 agent 使用（Claude Code / Codex / MiniChen），新增 4 个 tool：

### 5.1 新增 tool 列表

```typescript
// 现有 tools（保持不变）
"search_files"; // FTS5 搜索
"get_file_index"; // 单文件详情
"get_overview"; // 仓库概览

// 新增 tools
"get_dependency_graph"; // 输入 file + depth → 输出 dependency graph (JSON/Mermaid)
"get_dependents"; // 输入 file → 输出所有 import 了它的文件
"get_file_history"; // 输入 file + limit → 输出 git 修改历史
"enrich_error_stack"; // 输入 error stack → 输出 enriched context
```

### 5.2 `get_dependency_graph` tool

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

### 5.3 `enrich_error_stack` tool

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

## 六、接入 Santi 的方式

### 6.1 作为库直接 import（主要方式）

```typescript
// packages/santi/src/observability/kly-service.ts

import {
  openDatabase,
  searchFiles,
  buildDependencyGraph,
  enrichErrorStack, // 新增
  getDependents, // 新增
  getFileHistory, // 新增
  buildIndex,
} from "kly";

export class KlyService {
  private dbPath: string;
  private repoRoot: string;

  constructor(repoRoot: string) {
    this.repoRoot = repoRoot;
    this.dbPath = `${repoRoot}/.kly/db`;
  }

  /** ohbug error event 到达时调用 */
  enrichError(errorStack: string): EnrichedErrorStack {
    const db = openDatabase(this.repoRoot);
    try {
      return enrichErrorStack(db, this.repoRoot, errorStack);
    } finally {
      db.close();
    }
  }

  /** 查询文件信息（给 Observability 面板用） */
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

  /** 搜索文件（给 React 前端用） */
  search(query: string, limit = 20) {
    const db = openDatabase(this.repoRoot);
    try {
      return searchFiles(db, query, limit);
    } finally {
      db.close();
    }
  }

  /** 增量更新索引（CI 或 post-commit hook 触发） */
  async rebuildIndex() {
    await buildIndex(this.repoRoot, { incremental: true });
  }
}
```

### 6.2 MCP server 保留给外部 agent

```
Santi 直接 import kly 库函数  ←  主要接入方式（零协议开销）
     │
     │  同时
     │
kly MCP server (stdio)  ←  给 Claude Code / Codex / MiniChen 用
```

### 6.3 CI 集成（持续更新索引）

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
          fetch-depth: 0 # 需要完整 git history

      - uses: oven-sh/setup-bun@v2

      - run: bun install
      - run: bun run kly build --incremental

      # 上传 index DB 到云端
      - run: |
          bun run upload-index .kly/db/main.db
```

---

## 七、与 ohbug 的集成数据流

```
┌────────────────────────────┐
│ Paperboy WebView (React)   │
│                             │
│ @ohbug/browser 捕获 error   │
│ + error-stack-parser 解析   │
└──────────────┬──────────────┘
               │ 上报 error event
               │ (stack trace + source map 后的文件名/行号)
               ▼
┌──────────────────────────────────────────────────┐
│ Santi / Cloud API                                 │
│                                                   │
│  1. 接收 ohbug error event                        │
│                                                   │
│  2. KlyService.enrichError(stack)                 │
│     ├── db.getFile()         → 文件描述/symbols   │
│     ├── getDependents()      → 反向依赖           │
│     ├── buildDependencyGraph() → 风险传播路径      │
│     └── getFileHistory()     → git 修改记录       │
│                                                   │
│  3. 合并 OS 上下文（来自 Paperboy OS 采集层）      │
│     ├── 报错时刻的屏幕截图                        │
│     ├── 用户操作轨迹（鼠标/键盘/窗口切换）         │
│     └── 剪贴板内容                                │
│                                                   │
│  4. 生成 Enriched Error Report                    │
│     → 存入 ohbug 数据库                           │
│     → 推送到 Observability 面板                    │
│     → 自动生成 Markdown 文档                       │
│     → 可选：自动创建 Linear issue                  │
└──────────────┬───────────────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────────────┐
│ Observability 面板 (React)                        │
│                                                   │
│  ┌──────────────────────────────────────────────┐ │
│  │ Enriched Error View                          │ │
│  │                                              │ │
│  │ TypeError: Cannot read 'content' of undefined│ │
│  │ at renderMessage (MessageList.tsx:142)        │ │
│  │                                              │ │
│  │ 📄 MessageList.tsx                           │ │
│  │    Chat 消息列表渲染组件                      │ │
│  │    5 个模块依赖此文件                         │ │
│  │    最近修改: @yanan-li, 3天前, PR #236        │ │
│  │                                              │ │
│  │ 🖥 用户当时的屏幕                             │ │
│  │    [截图]                                    │ │
│  │                                              │ │
│  │ 🔗 操作时间线                                 │ │
│  │    15:42:01 Chrome 复制代码                   │ │
│  │    15:42:03 切换到 Paperboy                   │ │
│  │    15:42:05 粘贴到输入框                      │ │
│  │    15:42:06 点击发送                          │ │
│  │    15:42:08 💥 ERROR                         │ │
│  └──────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────┘
```

---

## 八、行动计划

### 第一步：kly 核心改造（接入 Santi 前置条件）

| 序号 | 任务                                      | 优先级 | 工作量                                  |
| ---- | ----------------------------------------- | ------ | --------------------------------------- |
| 1    | 新增 `getDependents()` API + 导出         | 🔴 高  | 小（~50 行，逻辑已在 graph.ts 内部）    |
| 2    | 新增 `getFileHistory()` API + 导出        | 🔴 高  | 小（~30 行，git log 解析）              |
| 3    | 新增 `dependencies` 表 + 构建时写入       | 🟡 中  | 中（数据库 schema 变更 + indexer 修改） |
| 4    | 新增 `enrichErrorStack()` 高级函数 + 导出 | 🔴 高  | 中（~150 行，组合现有函数）             |
| 5    | MCP 新增 `get_dependency_graph` tool      | 🟡 中  | 小（graph.ts 已实现，包一层 MCP）       |
| 6    | MCP 新增 `get_dependents` tool            | 🟡 中  | 小                                      |
| 7    | MCP 新增 `get_file_history` tool          | 🟡 中  | 小                                      |
| 8    | MCP 新增 `enrich_error_stack` tool        | 🟡 中  | 小                                      |
| 9    | 修复 LLM provider 错误处理                | 🟢 低  | 小                                      |

### 第二步：Santi 接入

| 序号 | 任务                                                  | 优先级 |
| ---- | ----------------------------------------------------- | ------ |
| 1    | Santi `pnpm add kly`                                  | 🔴 高  |
| 2    | 实现 `KlyService` 封装层                              | 🔴 高  |
| 3    | ohbug error event → `KlyService.enrichError()` 调用链 | 🔴 高  |
| 4    | Enriched Error Report → 存储 + 推送到前端             | 🔴 高  |
| 5    | 合并 OS 上下文数据（屏幕截图 + 操作轨迹）             | 🟡 中  |

### 第三步：CI 集成

| 序号 | 任务                                                            | 优先级                           |
| ---- | --------------------------------------------------------------- | -------------------------------- |
| 1    | GitHub Actions workflow：每次 push 跑 `kly build --incremental` | 🟡 中                            |
| 2    | 上传 index DB 到云端存储                                        | 🟡 中                            |
| 3    | post-commit hook 自动更新本地索引                               | 🟢 低（已有 `kly hook install`） |

---

## 九、附录

### A. kly 项目路径

- 仓库根目录：`~/work/kly`
- 核心源码：
  - `~/work/kly/src/index.ts` — 库导出（所有 public API）
  - `~/work/kly/src/database.ts` — SQLite 数据库操作（IndexDatabase 类）
  - `~/work/kly/src/graph.ts` — 依赖图构建（buildDependencyGraph / generateMermaid）
  - `~/work/kly/src/indexer.ts` — 索引构建器（buildIndex）
  - `~/work/kly/src/query.ts` — 搜索（searchFiles / searchFilesWithRerank）
  - `~/work/kly/src/mcp.ts` — MCP server（3 个 tool）
  - `~/work/kly/src/git.ts` — Git 操作工具函数
  - `~/work/kly/src/scanner.ts` — 文件扫描
  - `~/work/kly/src/hasher.ts` — 文件 hash
  - `~/work/kly/src/store.ts` — 数据库/状态管理
  - `~/work/kly/src/types.ts` — 核心类型定义
  - `~/work/kly/src/config.ts` — 配置加载
- 解析器：
  - `~/work/kly/src/parser/typescript.ts` — TypeScript / JavaScript / JSX / TSX
  - `~/work/kly/src/parser/swift.ts` — Swift
  - `~/work/kly/src/parser/base.ts` — 解析器基类
  - `~/work/kly/src/parser/index.ts` — ParserManager
- LLM：
  - `~/work/kly/src/llm/index.ts` — LLMService
  - `~/work/kly/src/llm/batcher.ts` — 批量 LLM 调用
  - `~/work/kly/src/llm/prompts.ts` — prompt 模板
  - `~/work/kly/src/llm/reranker.ts` — 搜索结果 LLM 重排
- 测试：`~/work/kly/src/__tests__/`
- 文档：`~/work/kly/docs/`
- 任务记录：`~/work/kly/tasks/todo.md`
- 配置：`~/work/kly/vite.config.ts`、`~/work/kly/tsconfig.json`、`~/work/kly/package.json`

### B. 与前端重写文档的关系

本文档是 [Paperboy 前端大重写方案](./paperboy-frontend-rewrite_zh-CN.md) 第 5.3 节「kly + ohbug — 一个系统的两面」的详细技术方案。重写文档定义了 why（为什么 kly 和 ohbug 要结合），本文档定义了 how（具体怎么改 kly、怎么接入 Santi）。

### C. 依赖关系

```
kly (库)
  ├── 被 Santi import（直接调用库函数）
  ├── 被 Claude Code / Codex / MiniChen 通过 MCP 调用
  └── 被 CI 通过 CLI 调用

ohbug (SDK)
  ├── 在 React WebView 中运行，捕获错误
  └── 上报到 Santi / Cloud API

Santi (backend)
  ├── import kly → enrichErrorStack()
  ├── 接收 ohbug error events
  ├── 合并 OS 上下文数据
  └── 输出 Enriched Error Report → Observability 面板
```
