# Paperboy Communication Protocol Redesign: oRPC Unified Communication Layer

> Created: 2026-03-28
> Author: Xinyao Chen
> Status: Draft
> Related: [Paperboy Frontend Major Rewrite Plan](./paperboy-frontend-rewrite_zh-CN.md)

## 1. Background

### 1.1 Current Communication Architecture (To Be Replaced)

Paperboy currently has three separate communication paths:

| Path                      | Transport                                    | Serialization                      | Purpose           |
| ------------------------- | -------------------------------------------- | ---------------------------------- | ----------------- |
| Swift ↔ Santi             | WebSocket `:7654`                            | Protobuf binary (Envelope wrapper) | All business data |
| OS ↔ Santi                | WebSocket `:7654/os`                         | Protobuf + JSON                    | System events     |
| Swift ↔ WebView (Inkwell) | WKScriptMessageHandler + callAsyncJavaScript | JSON                               | Inspector panel   |

**Problems:**

1. **Protobuf only serves the Swift client** — 13 `.proto` files, Swift-side `*.pb.swift` generated code, Santi-side `*_pb.ts` generated code, all exist solely for the Swift ↔ Santi path. After the rewrite, the Swift client no longer consumes business data, and Protobuf's only consumer disappears.
2. **Three paths with overlapping responsibilities** — Business data over WebSocket Protobuf, system events over WebSocket JSON, UI bridge over WKScriptMessageHandler. Three protocols, three error handling strategies, three reconnection logics.
3. **Type safety is broken** — There is no automatic linkage between Protobuf-generated types and TypeScript business types. Types on the Swift side and Santi side are generated separately by `protoc`; any schema change requires updating both sides simultaneously.
4. **PostBox is platform-bound** — `WKScriptMessageHandler` only exists in macOS WKWebView. If we ever need to run in a browser or Electron, PostBox would need to be rewritten.

### 1.2 Decision: Replace All Three Paths with oRPC

**Core insight: A single oRPC router definition can be exposed as both WebSocket and HTTP interfaces through different adapters.** React uses WebSocket (low latency, streaming), Swift uses HTTP/OpenAPI (standard URLSession can call directly). Platform differences vanish naturally.

|                     | Protobuf + WebSocket          | PostBox (WKScriptMessageHandler) | **oRPC (Target)**                         |
| ------------------- | ----------------------------- | -------------------------------- | ----------------------------------------- |
| Transport           | WebSocket binary              | WKScriptMessageHandler           | **WS (React) + HTTP/OpenAPI (Swift)**     |
| Serialization       | Protobuf binary               | JSON (manual)                    | JSON (automatic)                          |
| Type safety         | protoc generated, manual sync | None                             | **Automatic inference** (server → client) |
| Streaming           | WebSocket frames              | Not supported                    | **Event Iterator** (WS or SSE)            |
| Disconnect recovery | Manual implementation         | None                             | **lastEventId auto-resume**               |
| Cross-platform      | N/A                           | ❌ Rewrite per platform          | ✅ HTTP/WS natively cross-platform        |
| Multi-window sync   | Manual broadcast              | None                             | **Publisher built-in broadcast**          |

**Replacement outcome:**

- ~~Protobuf~~ → Delete all `.proto` files, `*_pb.ts`, `*.pb.swift`, `@bufbuild/protobuf` dependency
- ~~PostBox SDK~~ → Delete `WKScriptMessageHandler` bridge
- ~~WebSocket transport~~ → Delete `packages/santi/src/proto/transport/`
- ~~Envelope framing~~ → oRPC has built-in request correlation

---

## 2. Target Architecture

### 2.1 Dual Adapter Architecture: One Router, Two Exposure Methods

**Core design: A single oRPC router on Santi, with two handlers mounted simultaneously.**

```
┌─────────────────────────────────────────────────┐
│  React SPA (Chat Window WebView / Browser)        │
│                                                   │
│  oRPC Client — WebSocket Link                     │
│  ├── Regular calls → WS message (request/response)│
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
│  │  WebSocket adapter — for React               │ │
│  │  Low latency, bidirectional, streaming        │ │
│  └─────────────────────────────────────────────┘ │
│                                                   │
│  ┌─ OpenAPIHandler (@orpc/openapi/fetch) ──────┐ │
│  │  HTTP adapter — for Swift                    │ │
│  │  Standard REST, callable via URLSession       │ │
│  │  SSE support (agent.events → Orb state)       │ │
│  └─────────────────────────────────────────────┘ │
│                                                   │
│  Shared single router:                            │
│  ├── chat.*           → Handle directly           │
│  ├── session.*        → Handle directly           │
│  ├── agent.*          → Handle directly           │
│  ├── observability.*  → Handle directly           │
│  ├── window.*         → Forward to Swift shell    │
│  ├── notification.*   → Forward to Swift shell    │
│  └── system.*         → Forward to Swift shell    │
│                                                   │
│  MemoryPublisher                                  │
│  └── Broadcast agent events / state changes       │
│      to all subscribers                           │
└──────────────┬────────────────────┬──────────────┘
               │ HTTP/SSE           │
               │ /api/*             │
               ▼                    │
┌──────────────────────────┐       │
│  Swift Shell (ultra-thin) │       │
│                           │       │
│  URLSession calls Santi:  │       │
│  ├── GET /api/agent.status│       │
│  ├── SSE /api/agent.events│→ Orb animation
│  └── POST /api/window.*   │       │
│                           │       │
│  System-level capabilities:│       │
│  Window / Notification /  │       │
│  Permissions / OS capture /│       │
│  Orb / Clipboard          │       │
└──────────────────────────┘       │
                                    │
               window.*/notification.*/system.*
               Requests forwarded by Santi to Swift
               (Swift is both caller and callee)
```

### 2.2 Swift ↔ Santi Communication Details

Communication between Swift and Santi has two directions:

**Swift → Santi (Swift actively calls Santi):**

- Swift uses `URLSession` to call Santi's OpenAPI HTTP endpoints
- Example: `GET /api/agent.status` to get Orb state
- Example: `SSE /api/agent.events` to subscribe to real-time agent event stream (drives Orb animation)
- Zero additional dependencies, standard URLSession + JSONDecoder

**Santi → Swift (Santi needs Swift to execute system operations):**

- React calls `window.create` → Santi receives it → needs Swift to create NSWindow
- This direction requires a "reverse channel"

Reverse channel options:

| Option                                               | Description                                                                                   | Recommended            |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------- | ---------------------- |
| A. Swift polls Santi's command queue                 | Swift periodically `GET /api/system.pendingCommands`, executes commands when received         | Simple but has latency |
| B. Swift subscribes to system command stream via SSE | Swift uses `URLSession` to subscribe to `SSE /api/system.commands`, Santi pushes in real-time | ✅ Real-time + simple  |
| C. Santi calls Swift's HTTP server                   | Swift starts a minimal HTTP server, Santi calls back to it                                    | Too heavy              |

**Recommended: Option B** — After startup, Swift subscribes to `SSE /api/system.commands` via URLSession. When React calls `window.create` → Santi pushes via Publisher to SSE → Swift receives and executes. Everything goes through oRPC, zero additional protocols.

```swift
// Swift side: subscribe to system command stream
func subscribeToSystemCommands() {
    let url = URL(string: "http://localhost:\(port)/api/system.commands")!
    let task = URLSession.shared.dataTask(with: url) // SSE long-polling
    // Parse SSE events → execute window/notification/permission operations
}
```

---

## 3. oRPC Router Design

### 3.1 Top-Level Router Structure

```typescript
import { os } from "@orpc/server";
import { z } from "zod";

export const router = {
  // ── Session Management ────────────────────────
  session: {
    list: sessionListProcedure,
    get: sessionGetProcedure,
    create: sessionCreateProcedure,
    delete: sessionDeleteProcedure,
    update: sessionUpdateProcedure,
  },

  // ── Chat ──────────────────────────────────────
  chat: {
    send: chatSendProcedure, // request/response: send message
    stream: chatStreamProcedure, // SSE: agent response stream
    history: chatHistoryProcedure, // request/response: paginated history
    approve: chatApproveProcedure, // request/response: tool approval
    queue: chatQueueProcedure, // request/response: message queue operations
  },

  // ── Agent ─────────────────────────────────────
  agent: {
    status: agentStatusProcedure, // request/response: current status
    events: agentEventsProcedure, // SSE: agent event stream (tool calls, subagent, progress)
    cancel: agentCancelProcedure, // request/response: cancel execution
  },

  // ── Authentication ────────────────────────────
  auth: {
    login: authLoginProcedure,
    logout: authLogoutProcedure,
    status: authStatusProcedure,
    refresh: authRefreshProcedure,
  },

  // ── Settings ──────────────────────────────────
  settings: {
    get: settingsGetProcedure,
    update: settingsUpdateProcedure,
  },

  // ── Observability ─────────────────────────────
  observability: {
    issues: observabilityIssuesProcedure,
    events: observabilityEventsProcedure, // SSE: real-time error push
    metrics: observabilityMetricsProcedure,
  },

  // ── System-Level Operations (Forwarded to Swift Shell) ──
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

### 3.2 Chat Streaming Detailed Design

This is the most critical path — replacing the existing Protobuf WebSocket streaming.

**Server side:**

```typescript
import { os, eventIterator, withEventMeta } from "@orpc/server";

// ── Message Stream Event Types ──────────────────
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
    // If lastEventId exists, resume from breakpoint
    if (lastEventId) {
      // Recover unsent events from cache
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
      // Cleanup: client disconnected or stream ended
    }
  });
```

**Client side (React):**

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

// ── Consuming the stream ─────────────────────────
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

### 3.3 Multi-Window Real-Time Sync

When multiple Chat windows are open simultaneously, state must be synchronized (new messages, session changes, settings changes).

**Server side (Publisher):**

```typescript
import { MemoryPublisher } from "@orpc/experimental-publisher/memory";

// ── Global Publisher Instance ────────────────────
const publisher = new MemoryPublisher<{
  "session:updated": { sessionId: string; change: "created" | "deleted" | "renamed" };
  "session:message": { sessionId: string; messageId: string; preview: string };
  "settings:changed": { key: string; value: unknown };
  "agent:status": { sessionId: string; status: string };
  "notification:new": { title: string; body: string };
}>({
  resumeRetentionSeconds: 60 * 5, // 5-minute disconnect recovery window
});

// ── Real-time subscription procedure ─────────────
const liveUpdatesProcedure = os
  .input(
    z.object({
      channels: z.array(z.string()).optional(), // Optional: subscribe to specific channels only
    }),
  )
  .handler(async function* ({ input, signal, lastEventId }) {
    // Subscribe to all channels or specified channels
    const iterator = publisher.subscribe("session:updated", { signal, lastEventId });
    for await (const payload of iterator) {
      yield payload;
    }
  });

// ── Internal: broadcast when agent produces events ──
// Called within the engine:
await publisher.publish("session:message", {
  sessionId: "xxx",
  messageId: "msg_123",
  preview: "Here is the analysis...",
});
```

**Client side (React):**

```typescript
// Subscribe on window startup
useEffect(() => {
  let cancelled = false;

  async function subscribe() {
    const iterator = await client.live.updates({
      channels: ["session:updated", "settings:changed"],
    });
    for await (const event of iterator) {
      if (cancelled) break;
      // Update Zustand store, all components respond automatically
      useLiveStore.getState().handleEvent(event);
    }
  }

  subscribe();
  return () => {
    cancelled = true;
  };
}, []);
```

### 3.4 System-Level Operations (Swift Shell Forwarding)

System-level operations are infrequent (window operations, notifications) but need to be reliable.

```typescript
// ── Santi side: receive oRPC calls, forward to Swift ──

// Swift shell communication abstraction
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

## 4. Santi Server Integration

### 4.1 Dual Handler Mounting (Bun Server)

Santi's Bun server mounts both the WebSocket RPCHandler and HTTP OpenAPIHandler simultaneously:

```typescript
import { RPCHandler as WsRPCHandler } from "@orpc/server/bun-ws";
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { CORSPlugin } from "@orpc/server/plugins";
import { router } from "./router";

// WebSocket handler — for React
const wsHandler = new WsRPCHandler(router);

// HTTP/OpenAPI handler — for Swift
const httpHandler = new OpenAPIHandler(router, {
  plugins: [new CORSPlugin()],
});

Bun.serve({
  async fetch(req, server) {
    const url = new URL(req.url);

    // WebSocket upgrade (React oRPC client)
    if (url.pathname === "/rpc" && req.headers.get("upgrade") === "websocket") {
      if (server.upgrade(req)) return;
      return new Response("Upgrade failed", { status: 500 });
    }

    // HTTP/OpenAPI (Swift URLSession)
    const { matched, response } = await httpHandler.handle(req, {
      prefix: "/api",
      context: {
        /* auth */
      },
    });
    if (matched) return response;

    // Static file serving (React SPA)
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

**Routing breakdown:**

| Path                           | Handler        | Consumer            | Transport           |
| ------------------------------ | -------------- | ------------------- | ------------------- |
| `ws://localhost:PORT/rpc`      | WsRPCHandler   | React SPA           | WebSocket           |
| `http://localhost:PORT/api/*`  | OpenAPIHandler | Swift Shell         | HTTP + SSE          |
| `http://localhost:PORT/*`      | serveStatic    | React SPA           | HTTP (static files) |
| `http://localhost:PORT/health` | Custom         | Swift DaemonManager | HTTP (health check) |

### 4.2 Authentication

Current approach: DaemonManager passes a secure token to Santi via stdin at startup.

Authentication flow under oRPC:

```
1. Swift starts Santi → passes one-time bootstrap token via stdin
2. Santi generates session token → writes to Keychain (via Swift bridge)
3. When WebView loads → Swift reads token from Keychain → injects into WKWebView's initial JS context
4. React SPA includes token in all oRPC requests (HTTP header)
5. Santi middleware validates token
```

```typescript
// oRPC authentication middleware
const authed = os.middleware(async ({ context, next }) => {
  const token = context.headers.get("Authorization")?.replace("Bearer ", "");
  if (!token || !validateToken(token)) {
    throw new Error("Unauthorized");
  }
  return next({ context: { token, userId: decodeToken(token).userId } });
});

// Procedure requiring authentication
const chatSendProcedure = authed
  .input(z.object({ sessionId: z.string(), message: z.string() }))
  .handler(async ({ input, context }) => {
    // context.userId is verified
  });
```

### 4.3 Localhost Security

Risk identified in the rewrite document: any local application can connect to localhost:PORT.

**Countermeasures (implemented in oRPC middleware):**

1. **Random port** — Chosen randomly at startup; Swift records the port number and passes it to WebView
2. **One-time token** — Generated by Swift, injected via WKWebView JS context, validated on every request
3. **Origin check** — oRPC middleware checks `Origin` / `Referer` headers
4. **Optional: Unix Domain Socket** — Replaces TCP localhost; only the local process can access (Bun supports UDS)

---

## 5. Existing Protobuf Protocol Mapping

Mapping each existing Protobuf Envelope message to oRPC procedures one by one:

### 5.1 Envelope → oRPC

Existing Envelope structure:

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

**oRPC handles automatically:**

- `request_id` → oRPC internal request correlation (HTTP request/response naturally paired)
- `method` → oRPC router path (e.g., `chat.send`)
- `payload` → oRPC input/output (zod schema, automatic JSON serialization)
- `is_stream_end` → Event Iterator's `return` statement
- `auth_token` → HTTP `Authorization` header
- `error` → oRPC built-in error handling (`ORPCError`)

### 5.2 Proto Services → oRPC Procedures

| Proto Service     | Method            | oRPC Procedure       | Type                    |
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

## 6. Migration Steps

### Phase 1: Add oRPC Server to Santi (No Swift Changes)

1. `pnpm add @orpc/server zod`
2. Define `router.ts`, implement just the `system.health` procedure first
3. Mount `RPCHandler` on Santi's Bun server at path `/rpc`
4. Verify: `curl http://localhost:PORT/rpc/system.health`

### Phase 2: Implement Core Procedures

By priority:

1. `auth.*` — Authentication flow
2. `session.*` — Session CRUD
3. `chat.stream` — **Most critical**: streaming pipeline validation
4. `chat.send` / `chat.history` — Message send/receive
5. `agent.*` — Agent event stream

Implementation approach for each procedure: extract business logic from existing `packages/santi/src/proto/services/`, strip Protobuf serialization, wrap as oRPC handler.

### Phase 3: Connect React SPA

1. `pnpm add @orpc/client @orpc/tanstack-query @tanstack/react-query`
2. Create typed client: `createORPCClient<Router>(link)`
3. Incrementally implement UI components consuming oRPC procedures

### Phase 4: Cleanup

1. Delete all `.proto` files in `proto/santi/v1/`
2. Delete `packages/santi/src/proto/` directory (transport, envelope, services, gen)
3. Delete Swift-side `Paperboy/Generated/santi/v1/*.pb.swift`
4. Delete `SantiClient.swift` (WebSocket + Protobuf client)
5. Remove `@bufbuild/protobuf`, `@bufbuild/protoc-gen-es` dependencies
6. Remove Swift's `SwiftProtobuf` package dependency

---

## 7. Performance Considerations

### 7.1 WebSocket (React) vs HTTP/SSE (Swift)

In this architecture, the two transport methods serve different consumers:

| Dimension    | WebSocket (React)                | HTTP/SSE (Swift)                        |
| ------------ | -------------------------------- | --------------------------------------- |
| Consumer     | React SPA (Chat Window)          | Swift Shell (Orb + system operations)   |
| Direction    | Bidirectional                    | Request/response + SSE push             |
| Latency      | Very low (persistent connection) | Low (localhost HTTP)                    |
| Streaming    | Event Iterator over WS           | Event Iterator over SSE                 |
| Reconnection | partysocket auto-reconnect       | URLSession native SSE reconnect         |
| Type safety  | oRPC client auto-inference       | OpenAPI spec, Swift manual JSON parsing |

**Why React uses WS instead of HTTP:**

- Chat streaming requires low-latency bidirectional communication
- Multiple procedures share a single WS connection, reducing connection count
- oRPC WS adapter natively supports Event Iterator

**Why Swift uses HTTP instead of WS:**

- Swift-side call frequency is low (Orb status + occasional system commands)
- URLSession is a native Swift API, zero additional dependencies
- OpenAPIHandler exposes standard REST endpoints, no oRPC TypeScript client needed
- SSE can be consumed using URLSession's `bytes` API

### 7.2 Streaming Latency

Current: Protobuf WebSocket frame → decode → UI update (~30fps throttle in ChatStore)

oRPC WS: WebSocket JSON frame → JSON parse → UI update

**Latency difference is negligible.** JSON parse is slower than Protobuf decode, but in a chat streaming scenario (dozens of text deltas per second), the difference is sub-millisecond — well below the human perception threshold. The real latency bottleneck is LLM inference, not the transport layer.

### 7.3 Multi-Window Resources

Each Chat Window uses one WS connection. 10 windows = 10 WS connections.
Swift Shell uses one SSE connection (Orb status) + on-demand HTTP requests.

MemoryPublisher broadcasts within the Santi process with minimal memory overhead.

---

## 8. Relationship to the Rewrite Document

This document provides the detailed technical design for the following sections of the [Paperboy Frontend Major Rewrite Plan](./paperboy-frontend-rewrite_zh-CN.md):

- **§3.3 Bridge Communication Protocol** — PostBox SDK replaced by oRPC
- **§4.1 React Everywhere** — WebSocket row in the tech stack table confirmed as oRPC (SSE)
- **§6.1 Underlying Logic of the Migration** — Concrete implementation path for "Protobuf is no longer needed"
- **§7.2 Localhost Secure Exposure** — Security countermeasures implemented in oRPC middleware

The rewrite document defines **why** (why change the communication protocol); this document defines **how** (what to replace it with, how to migrate, how each proto service maps).

---

## Appendix

### A. Files to Be Deleted (Phase 4)

```
# Proto definitions
proto/santi/v1/*.proto                          (13 files)

# Santi-side generated code + transport
packages/santi/src/proto/gen/santi/v1/*_pb.ts   (16 files)
packages/santi/src/proto/transport/             (envelope.ts, ws-transport.ts, ws-security.ts)
packages/santi/src/proto/services/              (chat.ts, session.ts, agent.ts, daemon.ts, ...)
packages/santi/src/proto/client.ts
packages/santi/src/proto/server.ts

# Swift-side generated code + client
packages/paperboy/Paperboy/Generated/santi/v1/*.pb.swift  (16 files)
packages/paperboy/Paperboy/Services/Network/SantiClient.swift

# Dependencies
@bufbuild/protobuf, @bufbuild/protoc-gen-es     (package.json)
SwiftProtobuf                                   (Package.swift / project.yml)
```

### B. oRPC Package Dependencies

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

### C. References

- [oRPC Event Iterator (SSE)](https://orpc.dev/docs/event-iterator)
- [oRPC Publisher Helper](https://orpc.dev/docs/helpers/publisher)
- [oRPC RPCHandler (fetch adapter)](https://orpc.dev/docs/rpc-handler)
- [oRPC TanStack Query integration](https://orpc.dev/docs/tanstack-query)
