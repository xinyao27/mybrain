# Paperboy 通信协议重设计：oRPC 统一通信层

> 创建日期：2026-03-28
> 作者：Xinyao Chen
> 状态：草案（Draft）
> 关联文档：[Paperboy 前端大重写方案](./paperboy-frontend-rewrite_zh-CN.md)

## 一、背景

### 1.1 现有通信架构（要被替换的）

当前 Paperboy 有三条独立的通信路径：

| 路径                      | 传输层                                       | 序列化格式                          | 用途            |
| ------------------------- | -------------------------------------------- | ----------------------------------- | --------------- |
| Swift ↔ Santi             | WebSocket `:7654`                            | Protobuf binary（Envelope wrapper） | 所有业务数据    |
| OS ↔ Santi                | WebSocket `:7654/os`                         | Protobuf + JSON                     | 系统事件        |
| Swift ↔ WebView (Inkwell) | WKScriptMessageHandler + callAsyncJavaScript | JSON                                | Inspector panel |

**问题：**

1. **Protobuf 只服务于 Swift client** — 13 个 `.proto` 文件、Swift 侧 `*.pb.swift` 生成代码、Santi 侧 `*_pb.ts` 生成代码，全部只为 Swift ↔ Santi 这一条路径存在。重写后 Swift client 不再消费业务数据，Protobuf 的唯一消费者消失。
2. **三条路径职责重叠** — 业务数据走 WebSocket Protobuf，系统事件走 WebSocket JSON，UI bridge 走 WKScriptMessageHandler。三套协议、三套错误处理、三套重连逻辑。
3. **类型安全断裂** — Protobuf 生成的类型和 TypeScript 业务类型之间没有自动关联。Swift 侧和 Santi 侧的类型分别由 `protoc` 生成，任何 schema 变更需要同时更新两端。
4. **PostBox 是平台绑定的** — `WKScriptMessageHandler` 只存在于 macOS WKWebView。如果将来要跑在浏览器或 Electron，PostBox 需要重写。

### 1.2 决策：用 oRPC 替换全部三条路径

**核心洞察：oRPC 同一套 router 定义，可以通过不同 adapter 暴露为 WebSocket 和 HTTP 两种接口。** React 走 WebSocket（低延迟、streaming），Swift 走 HTTP/OpenAPI（标准 URLSession 即可调用）。平台差异天然消失。

|            | Protobuf + WebSocket  | PostBox (WKScriptMessageHandler) | **oRPC（目标）**                       |
| ---------- | --------------------- | -------------------------------- | -------------------------------------- |
| 传输层     | WebSocket binary      | WKScriptMessageHandler           | **WS（React）+ HTTP/OpenAPI（Swift）** |
| 序列化     | Protobuf binary       | JSON（手动）                     | JSON（自动）                           |
| 类型安全   | protoc 生成，手动同步 | 无                               | **自动推导**（server → client）        |
| Streaming  | WebSocket frames      | 不支持                           | **Event Iterator**（WS 或 SSE）        |
| 断线恢复   | 手动实现              | 无                               | **lastEventId 自动续传**               |
| 跨平台     | N/A                   | ❌ 每个平台重写                  | ✅ HTTP/WS 天然跨平台                  |
| 多窗口同步 | 手动广播              | 无                               | **Publisher 内置广播**                 |

**替换结果：**

- ~~Protobuf~~ → 删除全部 `.proto` 文件、`*_pb.ts`、`*.pb.swift`、`@bufbuild/protobuf` 依赖
- ~~PostBox SDK~~ → 删除 `WKScriptMessageHandler` bridge
- ~~WebSocket transport~~ → 删除 `packages/santi/src/proto/transport/`
- ~~Envelope framing~~ → oRPC 自带 request correlation

---

## 二、目标架构

### 2.1 双 Adapter 架构：同一 Router，两种暴露方式

**核心设计：Santi 上同一套 oRPC router，同时挂载两个 handler。**

```
┌─────────────────────────────────────────────────┐
│  React SPA (Chat Window WebView / 浏览器)         │
│                                                   │
│  oRPC Client — WebSocket Link                     │
│  ├── 普通调用 → WS message (request/response)     │
│  └── Streaming → WS Event Iterator               │
│                                                   │
└──────────────────┬────────────────────────────────┘
                   │ WebSocket
                   │ ws://localhost:PORT/rpc
                   ▼
┌──────────────────────────────────────────────────┐
│  Santi (Bun Server)                               │
│                                                   │
│  ┌─ RPCHandler (@orpc/server/bun-ws) ──────────┐ │
│  │  WebSocket adapter — 给 React 用             │ │
│  │  低延迟、双向、streaming                      │ │
│  └─────────────────────────────────────────────┘ │
│                                                   │
│  ┌─ OpenAPIHandler (@orpc/openapi/fetch) ──────┐ │
│  │  HTTP adapter — 给 Swift 用                  │ │
│  │  标准 REST，URLSession 直接调                 │ │
│  │  SSE 支持（agent.events → Orb 状态）          │ │
│  └─────────────────────────────────────────────┘ │
│                                                   │
│  共享同一个 router：                               │
│  ├── chat.*           → 直接处理                  │
│  ├── session.*        → 直接处理                  │
│  ├── agent.*          → 直接处理                  │
│  ├── observability.*  → 直接处理                  │
│  ├── window.*         → 转发给 Swift shell        │
│  ├── notification.*   → 转发给 Swift shell        │
│  └── system.*         → 转发给 Swift shell        │
│                                                   │
│  MemoryPublisher                                  │
│  └── 广播 agent events / 状态变更到所有订阅者      │
└──────────────┬────────────────────┬──────────────┘
               │ HTTP/SSE           │
               │ /api/*             │
               ▼                    │
┌──────────────────────────┐       │
│  Swift Shell (极薄)       │       │
│                           │       │
│  URLSession 调 Santi：    │       │
│  ├── GET /api/agent.status│       │
│  ├── SSE /api/agent.events│→ Orb 动画
│  └── POST /api/window.*   │       │
│                           │       │
│  系统级能力：              │       │
│  窗口 / 通知 / 权限 /     │       │
│  OS 采集 / Orb / 剪贴板   │       │
└──────────────────────────┘       │
                                    │
               window.*/notification.*/system.*
               请求由 Santi 转发给 Swift
               （Swift 同时是 caller 和 callee）
```

### 2.2 Swift ↔ Santi 通信详解

Swift 和 Santi 之间有两个方向的通信：

**Swift → Santi（Swift 主动调 Santi）：**

- Swift 用 `URLSession` 调 Santi 的 OpenAPI HTTP 接口
- 例：`GET /api/agent.status` 拿 Orb 状态
- 例：`SSE /api/agent.events` 订阅实时 agent 事件流（驱动 Orb 动画）
- 零额外依赖，标准 URLSession + JSONDecoder

**Santi → Swift（Santi 需要 Swift 执行系统操作）：**

- React 调 `window.create` → Santi 收到 → 需要 Swift 创建 NSWindow
- 这个方向需要一个"反向通道"

反向通道方案：

| 方案                             | 说明                                                                  | 推荐           |
| -------------------------------- | --------------------------------------------------------------------- | -------------- |
| A. Swift 轮询 Santi 的命令队列   | Swift 定期 `GET /api/system.pendingCommands`，拿到命令后执行          | 简单但有延迟   |
| B. Swift SSE 订阅系统命令流      | Swift 用 `URLSession` 订阅 `SSE /api/system.commands`，Santi 实时推送 | ✅ 实时 + 简单 |
| C. Santi 调 Swift 的 HTTP server | Swift 起一个极小的 HTTP server，Santi 反过来调                        | 过重           |

**推荐方案 B**：Swift 启动后用 URLSession 订阅 `SSE /api/system.commands`。当 React 调 `window.create` → Santi 通过 Publisher 推送到 SSE → Swift 收到后执行。全部走 oRPC，零额外协议。

```swift
// Swift 侧：订阅系统命令流
func subscribeToSystemCommands() {
    let url = URL(string: "http://localhost:\(port)/api/system.commands")!
    let task = URLSession.shared.dataTask(with: url) // SSE long-polling
    // 解析 SSE event → 执行 window/notification/permission 操作
}
```

---

## 三、oRPC Router 设计

### 3.1 顶层 Router 结构

```typescript
import { os } from "@orpc/server";
import { z } from "zod";

export const router = {
  // ── 会话管理 ──────────────────────────────────
  session: {
    list: sessionListProcedure,
    get: sessionGetProcedure,
    create: sessionCreateProcedure,
    delete: sessionDeleteProcedure,
    update: sessionUpdateProcedure,
  },

  // ── 聊天 ──────────────────────────────────────
  chat: {
    send: chatSendProcedure, // request/response: 发送消息
    stream: chatStreamProcedure, // SSE: agent 响应流
    history: chatHistoryProcedure, // request/response: 分页历史
    approve: chatApproveProcedure, // request/response: tool 审批
    queue: chatQueueProcedure, // request/response: 消息队列操作
  },

  // ── Agent ─────────────────────────────────────
  agent: {
    status: agentStatusProcedure, // request/response: 当前状态
    events: agentEventsProcedure, // SSE: agent 事件流（tool calls、subagent、progress）
    cancel: agentCancelProcedure, // request/response: 取消执行
  },

  // ── 认证 ──────────────────────────────────────
  auth: {
    login: authLoginProcedure,
    logout: authLogoutProcedure,
    status: authStatusProcedure,
    refresh: authRefreshProcedure,
  },

  // ── 设置 ──────────────────────────────────────
  settings: {
    get: settingsGetProcedure,
    update: settingsUpdateProcedure,
  },

  // ── 可观测性 ──────────────────────────────────
  observability: {
    issues: observabilityIssuesProcedure,
    events: observabilityEventsProcedure, // SSE: 实时错误推送
    metrics: observabilityMetricsProcedure,
  },

  // ── 系统级操作（转发给 Swift Shell）───────────
  window: {
    create: windowCreateProcedure,
    close: windowCloseProcedure,
    resize: windowResizeProcedure,
    focus: windowFocusProcedure,
  },

  notification: {
    send: notificationSendProcedure,
  },

  system: {
    permissions: systemPermissionsProcedure,
    clipboard: systemClipboardProcedure,
    info: systemInfoProcedure,
  },
};

export type Router = typeof router;
```

### 3.2 Chat Streaming 详细设计

这是最关键的路径 — 替代现有 Protobuf WebSocket streaming。

**Server 端：**

```typescript
import { os, eventIterator, withEventMeta } from "@orpc/server";

// ── 消息流事件类型 ──────────────────────────────
const ChatStreamEvent = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("delta"),
    content: z.string(),
    messageId: z.string(),
  }),
  z.object({
    type: z.literal("tool_call_start"),
    toolCallId: z.string(),
    toolName: z.string(),
    args: z.record(z.unknown()),
  }),
  z.object({
    type: z.literal("tool_call_result"),
    toolCallId: z.string(),
    result: z.unknown(),
  }),
  z.object({
    type: z.literal("thinking"),
    content: z.string(),
  }),
  z.object({
    type: z.literal("status"),
    status: z.enum(["thinking", "executing", "idle", "error"]),
  }),
  z.object({
    type: z.literal("done"),
    messageId: z.string(),
    usage: z
      .object({
        inputTokens: z.number(),
        outputTokens: z.number(),
      })
      .optional(),
  }),
]);

const chatStreamProcedure = os
  .input(
    z.object({
      sessionId: z.string(),
      message: z.string(),
      attachments: z
        .array(
          z.object({
            type: z.string(),
            path: z.string(),
          }),
        )
        .optional(),
    }),
  )
  .output(eventIterator(ChatStreamEvent))
  .handler(async function* ({ input, lastEventId }) {
    // 如果有 lastEventId，从断点恢复
    if (lastEventId) {
      // 从缓存中恢复未发送的事件
    }

    const stream = engine.chat(input.sessionId, input.message, {
      attachments: input.attachments,
    });

    try {
      let eventIndex = 0;
      for await (const chunk of stream) {
        const eventId = `${input.sessionId}-${eventIndex++}`;
        yield withEventMeta(chunk, { id: eventId });
      }
    } finally {
      // 清理：client 断开或 stream 结束
    }
  });
```

**Client 端（React）：**

```typescript
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import type { Router } from "../shared/router";

const link = new RPCLink({
  url: `http://localhost:${PORT}/rpc`,
});

const client = createORPCClient<Router>(link);
export const orpc = createTanstackQueryUtils(client);

// ── 消费 stream ──────────────────────────────────
async function sendMessage(sessionId: string, message: string) {
  const iterator = await client.chat.stream({
    sessionId,
    message,
  });

  for await (const event of iterator) {
    switch (event.type) {
      case "delta":
        appendToMessage(event.messageId, event.content);
        break;
      case "tool_call_start":
        showToolCallUI(event.toolCallId, event.toolName, event.args);
        break;
      case "tool_call_result":
        updateToolCallResult(event.toolCallId, event.result);
        break;
      case "thinking":
        showThinkingBlock(event.content);
        break;
      case "status":
        updateAgentStatus(event.status);
        break;
      case "done":
        finalizeMessage(event.messageId, event.usage);
        break;
    }
  }
}
```

### 3.3 多窗口实时同步

多个 Chat 窗口同时打开时，状态必须同步（新消息、session 变更、settings 变更）。

**Server 端（Publisher）：**

```typescript
import { MemoryPublisher } from "@orpc/experimental-publisher/memory";

// ── 全局 Publisher 实例 ──────────────────────────
const publisher = new MemoryPublisher<{
  "session:updated": { sessionId: string; change: "created" | "deleted" | "renamed" };
  "session:message": { sessionId: string; messageId: string; preview: string };
  "settings:changed": { key: string; value: unknown };
  "agent:status": { sessionId: string; status: string };
  "notification:new": { title: string; body: string };
}>({
  resumeRetentionSeconds: 60 * 5, // 5 分钟断线恢复窗口
});

// ── 实时订阅 procedure ──────────────────────────
const liveUpdatesProcedure = os
  .input(
    z.object({
      channels: z.array(z.string()).optional(), // 可选：只订阅特定频道
    }),
  )
  .handler(async function* ({ input, signal, lastEventId }) {
    // 订阅所有频道或指定频道
    const iterator = publisher.subscribe("session:updated", { signal, lastEventId });
    for await (const payload of iterator) {
      yield payload;
    }
  });

// ── 内部：当 agent 产生事件时广播 ─────────────────
// 在 engine 内部调用：
await publisher.publish("session:message", {
  sessionId: "xxx",
  messageId: "msg_123",
  preview: "Here is the analysis...",
});
```

**Client 端（React）：**

```typescript
// 每个窗口启动时订阅
useEffect(() => {
  let cancelled = false;

  async function subscribe() {
    const iterator = await client.live.updates({
      channels: ["session:updated", "settings:changed"],
    });
    for await (const event of iterator) {
      if (cancelled) break;
      // 更新 Zustand store，所有组件自动响应
      useLiveStore.getState().handleEvent(event);
    }
  }

  subscribe();
  return () => {
    cancelled = true;
  };
}, []);
```

### 3.4 系统级操作（Swift Shell 转发）

系统级操作不频繁（窗口操作、通知），但需要可靠。

```typescript
// ── Santi 侧：接收 oRPC 调用，转发给 Swift ──────

// Swift shell 通信抽象
interface SwiftShellBridge {
  invoke(command: string, args: Record<string, unknown>): Promise<unknown>;
}

const windowCreateProcedure = os
  .input(
    z.object({
      sessionId: z.string().optional(),
      width: z.number().optional(),
      height: z.number().optional(),
      hideSidebar: z.boolean().optional(),
    }),
  )
  .handler(async ({ input }) => {
    return await swiftShell.invoke("window.create", input);
  });

const notificationSendProcedure = os
  .input(
    z.object({
      title: z.string(),
      body: z.string(),
      sound: z.boolean().optional(),
    }),
  )
  .handler(async ({ input }) => {
    return await swiftShell.invoke("notification.send", input);
  });
```

---

## 四、Santi Server 集成

### 4.1 双 Handler 挂载（Bun Server）

Santi 的 Bun server 同时挂载 WebSocket RPCHandler 和 HTTP OpenAPIHandler：

```typescript
import { RPCHandler as WsRPCHandler } from "@orpc/server/bun-ws";
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { CORSPlugin } from "@orpc/server/plugins";
import { router } from "./router";

// WebSocket handler — 给 React 用
const wsHandler = new WsRPCHandler(router);

// HTTP/OpenAPI handler — 给 Swift 用
const httpHandler = new OpenAPIHandler(router, {
  plugins: [new CORSPlugin()],
});

Bun.serve({
  async fetch(req, server) {
    const url = new URL(req.url);

    // WebSocket upgrade（React oRPC client）
    if (url.pathname === "/rpc" && req.headers.get("upgrade") === "websocket") {
      if (server.upgrade(req)) return;
      return new Response("Upgrade failed", { status: 500 });
    }

    // HTTP/OpenAPI（Swift URLSession）
    const { matched, response } = await httpHandler.handle(req, {
      prefix: "/api",
      context: {
        /* auth */
      },
    });
    if (matched) return response;

    // 静态文件 serve（React SPA）
    return serveStatic(req);
  },

  websocket: {
    message(ws, message) {
      wsHandler.message(ws, message, {
        context: {
          /* auth */
        },
      });
    },
    close(ws) {
      wsHandler.close(ws);
    },
  },
});
```

**路由分工：**

| 路径                           | Handler        | 消费者              | 传输             |
| ------------------------------ | -------------- | ------------------- | ---------------- |
| `ws://localhost:PORT/rpc`      | WsRPCHandler   | React SPA           | WebSocket        |
| `http://localhost:PORT/api/*`  | OpenAPIHandler | Swift Shell         | HTTP + SSE       |
| `http://localhost:PORT/*`      | serveStatic    | React SPA           | HTTP（静态文件） |
| `http://localhost:PORT/health` | 自定义         | Swift DaemonManager | HTTP（健康检查） |

### 4.2 认证

现有方案：DaemonManager 启动 Santi 时通过 stdin 传递 secure token。

oRPC 下的认证流程：

```
1. Swift 启动 Santi → stdin 传入 one-time bootstrap token
2. Santi 生成 session token → 写入 Keychain（通过 Swift bridge）
3. WebView 加载时 → Swift 从 Keychain 读取 token → 注入到 WKWebView 的初始 JS context
4. React SPA 所有 oRPC 请求携带 token（HTTP header）
5. Santi middleware 验证 token
```

```typescript
// oRPC 认证 middleware
const authed = os.middleware(async ({ context, next }) => {
  const token = context.headers.get("Authorization")?.replace("Bearer ", "");
  if (!token || !validateToken(token)) {
    throw new Error("Unauthorized");
  }
  return next({ context: { token, userId: decodeToken(token).userId } });
});

// 需要认证的 procedure
const chatSendProcedure = authed
  .input(z.object({ sessionId: z.string(), message: z.string() }))
  .handler(async ({ input, context }) => {
    // context.userId 已验证
  });
```

### 4.3 localhost 安全

重写文档已识别的风险：本机任何应用都能连 localhost:PORT。

**对策（在 oRPC middleware 中实现）：**

1. **随机端口** — 启动时随机选择，Swift 记录端口号传给 WebView
2. **One-time token** — Swift 生成，通过 WKWebView JS context 注入，每次请求验证
3. **Origin 检查** — oRPC middleware 检查 `Origin` / `Referer` header
4. **可选：Unix Domain Socket** — 替代 TCP localhost，只有本进程可访问（Bun 支持 UDS）

---

## 五、现有 Protobuf 协议映射

逐一映射现有 Protobuf Envelope 消息到 oRPC procedure：

### 5.1 Envelope → oRPC

现有 Envelope 结构：

```protobuf
message Envelope {
  string request_id = 1;
  string method = 2;
  bytes payload = 3;
  bool is_stream_end = 4;
  string auth_token = 5;
  Error error = 6;
}
```

**oRPC 自动处理：**

- `request_id` → oRPC 内部 request correlation（HTTP request/response 天然配对）
- `method` → oRPC router 路径（如 `chat.send`）
- `payload` → oRPC input/output（zod schema，JSON 自动序列化）
- `is_stream_end` → Event Iterator 的 `return` 语句
- `auth_token` → HTTP `Authorization` header
- `error` → oRPC 内置错误处理（`ORPCError`）

### 5.2 Proto Services → oRPC Procedures

| Proto Service     | Method            | oRPC Procedure       | 类型                    |
| ----------------- | ----------------- | -------------------- | ----------------------- |
| `ChatService`     | `SendMessage`     | `chat.send`          | request/response        |
| `ChatService`     | `StreamResponse`  | `chat.stream`        | **SSE (eventIterator)** |
| `ChatService`     | `GetHistory`      | `chat.history`       | request/response        |
| `ChatService`     | `ApproveToolCall` | `chat.approve`       | request/response        |
| `SessionService`  | `List`            | `session.list`       | request/response        |
| `SessionService`  | `Create`          | `session.create`     | request/response        |
| `SessionService`  | `Delete`          | `session.delete`     | request/response        |
| `SessionService`  | `Subscribe`       | `session.live`       | **SSE (Publisher)**     |
| `AgentService`    | `GetStatus`       | `agent.status`       | request/response        |
| `AgentService`    | `StreamEvents`    | `agent.events`       | **SSE (eventIterator)** |
| `AgentService`    | `Cancel`          | `agent.cancel`       | request/response        |
| `DaemonService`   | `HealthCheck`     | `system.health`      | request/response        |
| `DaemonService`   | `GetPermissions`  | `system.permissions` | request/response        |
| `PaperboyService` | `Notify`          | `notification.send`  | request/response        |

---

## 六、迁移步骤

### Phase 1：Santi 侧加 oRPC server（不动 Swift）

1. `pnpm add @orpc/server zod`
2. 定义 `router.ts`，先实现 `system.health` 一个 procedure
3. 在 Santi 的 Bun server 上挂载 `RPCHandler`，路径 `/rpc`
4. 验证：`curl http://localhost:PORT/rpc/system.health`

### Phase 2：实现核心 procedures

按优先级：

1. `auth.*` — 认证流程
2. `session.*` — 会话 CRUD
3. `chat.stream` — **最关键**：streaming 链路验证
4. `chat.send` / `chat.history` — 消息收发
5. `agent.*` — agent 事件流

每个 procedure 的实现方式：从现有 `packages/santi/src/proto/services/` 中提取业务逻辑，剥离 Protobuf 序列化，包装为 oRPC handler。

### Phase 3：React SPA 接入

1. `pnpm add @orpc/client @orpc/tanstack-query @tanstack/react-query`
2. 创建 typed client：`createORPCClient<Router>(link)`
3. 逐步实现 UI 组件，消费 oRPC procedures

### Phase 4：清理

1. 删除 `proto/santi/v1/` 全部 `.proto` 文件
2. 删除 `packages/santi/src/proto/` 目录（transport、envelope、services、gen）
3. 删除 Swift 侧 `Paperboy/Generated/santi/v1/*.pb.swift`
4. 删除 `SantiClient.swift`（WebSocket + Protobuf client）
5. 移除 `@bufbuild/protobuf`、`@bufbuild/protoc-gen-es` 依赖
6. 移除 Swift 的 `SwiftProtobuf` package dependency

---

## 七、性能考量

### 7.1 WebSocket (React) vs HTTP/SSE (Swift)

本架构中两种传输方式各服务不同消费者：

| 维度      | WebSocket（React）       | HTTP/SSE（Swift）                 |
| --------- | ------------------------ | --------------------------------- |
| 消费者    | React SPA（Chat Window） | Swift Shell（Orb + 系统操作）     |
| 方向      | 双向                     | 请求/响应 + SSE 推送              |
| 延迟      | 极低（持久连接）         | 低（localhost HTTP）              |
| Streaming | Event Iterator over WS   | Event Iterator over SSE           |
| 重连      | partysocket 自动重连     | URLSession 原生 SSE 重连          |
| 类型安全  | oRPC client 自动推导     | OpenAPI spec，Swift 手动解析 JSON |

**为什么 React 用 WS 而不是 HTTP：**

- Chat streaming 需要低延迟双向通信
- 多个 procedure 共享一条 WS 连接，减少连接数
- oRPC WS adapter 原生支持 Event Iterator

**为什么 Swift 用 HTTP 而不是 WS：**

- Swift 侧调用频率低（Orb 状态 + 偶尔的系统命令）
- URLSession 是 Swift 原生 API，零额外依赖
- OpenAPIHandler 暴露标准 REST 接口，不需要 oRPC TypeScript client
- SSE 用 URLSession 的 `bytes` API 即可消费

### 7.2 Streaming 延迟

现有：Protobuf WebSocket frame → 解码 → UI 更新（~30fps throttle in ChatStore）

oRPC WS：WebSocket JSON frame → JSON parse → UI 更新

**延迟差异可忽略。** JSON parse 比 Protobuf decode 慢，但在 chat streaming 场景（每秒几十个 text delta），差异在亚毫秒级，远低于人类感知阈值。真正的延迟瓶颈在 LLM inference，不在传输层。

### 7.3 多窗口资源

每个 Chat Window 一条 WS 连接。10 个窗口 = 10 条 WS。
Swift Shell 一条 SSE 连接（Orb 状态）+ 按需 HTTP 请求。

MemoryPublisher 在 Santi 进程内广播，内存开销极小。

---

## 八、与重写文档的关系

本文档是 [Paperboy 前端大重写方案](./paperboy-frontend-rewrite_zh-CN.md) 中以下章节的详细技术方案：

- **§3.3 Bridge 通信协议** — PostBox SDK 被 oRPC 替代
- **§4.1 React in everywhere** — 技术栈表中 WebSocket 行确认为 oRPC（SSE）
- **§6.1 迁移的底层逻辑** — "不再需要 Protobuf" 的具体实现路径
- **§7.2 localhost 安全暴露** — 安全对策在 oRPC middleware 中实现

重写文档定义了 **why**（为什么要换通信协议），本文档定义了 **how**（具体用什么替代、怎么迁移、每个 proto service 怎么映射）。

---

## 附录

### A. 被删除的文件清单（Phase 4）

```
# Proto 定义
proto/santi/v1/*.proto                          (13 files)

# Santi 侧生成代码 + transport
packages/santi/src/proto/gen/santi/v1/*_pb.ts   (16 files)
packages/santi/src/proto/transport/             (envelope.ts, ws-transport.ts, ws-security.ts)
packages/santi/src/proto/services/              (chat.ts, session.ts, agent.ts, daemon.ts, ...)
packages/santi/src/proto/client.ts
packages/santi/src/proto/server.ts

# Swift 侧生成代码 + client
packages/paperboy/Paperboy/Generated/santi/v1/*.pb.swift  (16 files)
packages/paperboy/Paperboy/Services/Network/SantiClient.swift

# 依赖
@bufbuild/protobuf, @bufbuild/protoc-gen-es     (package.json)
SwiftProtobuf                                   (Package.swift / project.yml)
```

### B. oRPC 包依赖

```json
{
  "dependencies": {
    "@orpc/server": "latest",
    "@orpc/client": "latest",
    "@orpc/tanstack-query": "latest",
    "@orpc/experimental-publisher": "latest",
    "zod": "latest",
    "@tanstack/react-query": "latest"
  }
}
```

### C. 参考链接

- [oRPC Event Iterator (SSE)](https://orpc.dev/docs/event-iterator)
- [oRPC Publisher Helper](https://orpc.dev/docs/helpers/publisher)
- [oRPC RPCHandler (fetch adapter)](https://orpc.dev/docs/rpc-handler)
- [oRPC TanStack Query integration](https://orpc.dev/docs/tanstack-query)
