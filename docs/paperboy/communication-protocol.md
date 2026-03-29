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
- ~~WebSocket transport~~ → Delete `packages/santi/src/proto/transport/`
- ~~Envelope framing~~ → oRPC has built-in request correlation
- **PostBox redesigned** — PostBox evolves from a WKWebView-specific bridge into the **WebView's universal communication layer** — the single exit point for all external communication. oRPC becomes a channel within PostBox (for Santi), alongside the native channel (for Swift/Electron/iOS/...). Business code uses `pb.*` and never knows what platform it's running on. See §2.2 for the full design.

---

## 2. Target Architecture

### 2.1 Dual Adapter Architecture: One Router, Two Exposure Methods

**Core design: A single oRPC router on Santi, with two handlers mounted simultaneously.**

```
┌──────────────────────────────────────────────────────────────┐
│  React SPA (Chat Window WebView / Browser)                    │
│                                                                │
│  ┌─ PostBox (pb.*) ─ The single exit point ─────────────────┐ │
│  │                                                           │ │
│  │  oRPC Channel               Native Channel               │ │
│  │  ├── pb.chat.*              ├── pb.window.*               │ │
│  │  ├── pb.session.*           ├── pb.notification.*         │ │
│  │  ├── pb.project.*           ├── pb.clipboard.*            │ │
│  │  ├── pb.agent.*             ├── pb.permissions.*          │ │
│  │  ├── pb.auth.*              └── pb.onEvent()              │ │
│  │  ├── pb.settings.*                                        │ │
│  │  ├── pb.file.*              Adapter: auto-detected        │ │
│  │  ├── pb.live.*              (WKWebView / Electron / ...)  │ │
│  │  ├── pb.observability.*                                   │ │
│  │  └── pb.system.*                                          │ │
│  └──────┬─────────────────────────────────┬──────────────────┘ │
│         │                                 │                     │
└─────────┼─────────────────────────────────┼─────────────────────┘
          │ WebSocket                       │ WKScriptMessageHandlerWithReply
          │ ws://localhost:PORT/rpc          │ (long-poll pattern)
          ▼                                 ▼
┌──────────────────────────────┐  ┌──────────────────────────────┐
│  Santi (Bun Server)          │  │  Swift Shell (ultra-thin)     │
│                              │  │                               │
│  ┌─ RPCHandler ────────────┐│  │  PostBoxHandler:               │
│  │  WS adapter — React     ││  │  ├── window.create/close/      │
│  │  Streaming, bidirectional││  │  │   resize/focus              │
│  └─────────────────────────┘│  │  ├── notification.send         │
│                              │  │  ├── clipboard / permissions   │
│  ┌─ OpenAPIHandler ────────┐│  │  ├── emit: navigate, theme,    │
│  │  HTTP/SSE — Swift       ││  │  │   OAuth, fileDrop           │
│  └─────────────────────────┘│  │  └── broadcast to all windows  │
│                              │  │                               │
│  Router (business data):     │  │  URLSession calls Santi:       │
│  ├── chat.*                  │  │  ├── GET /api/agent.status     │
│  ├── session.*               │  │  └── SSE /api/agent.events     │
│  ├── project.*               │  │      → Orb animation           │
│  ├── agent.*                 │  │                               │
│  ├── auth.*                  │  └───────────────────────────────┘
│  ├── settings.*              │
│  ├── file.*                  │
│  ├── live.*                  │
│  ├── observability.*         │
│  └── system.health           │
│                              │
│  MemoryPublisher             │
│  └── Broadcast state changes │
└──────────────────────────────┘
```

**PostBox is the WebView's single exit point, with two internal channels:**

| Channel            | Destination                  | Transport                                                            | Examples                                       |
| ------------------ | ---------------------------- | -------------------------------------------------------------------- | ---------------------------------------------- |
| **oRPC channel**   | Santi (TS backend)           | WebSocket (React) / HTTP+SSE (Swift)                                 | `pb.chat.stream()`, `pb.session.list()`        |
| **Native channel** | Swift / Electron / iOS / ... | Platform adapter (WKScriptMessageHandlerWithReply, ipcRenderer, ...) | `pb.window.create()`, `pb.notification.send()` |

All communication goes through `pb.*`. Business code never knows which channel handles the call.

### 2.2 PostBox: The Universal Communication Layer

#### What is PostBox?

PostBox is the **single exit point for all communication from the WebView to the outside world**. Whenever the WebView needs to talk to anything external — Santi (the TS backend), Swift (the native shell), and in the future potentially Electron, mobile iOS, or any other host — it goes through PostBox.

PostBox's sole responsibility: **abstract away how and where messages are delivered, so business code never needs to know what platform it's running on.** The WebView might be inside a macOS WKWebView today, an Electron BrowserWindow tomorrow, or a React Native WebView next year — business code stays the same.

#### PostBox's internal architecture

PostBox is not a single transport — it's a **router with multiple channels**. Each channel handles a different class of communication:

| Channel            | Destination                  | Transport                                                             | What it carries                                                                     |
| ------------------ | ---------------------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| **oRPC channel**   | Santi (TS backend)           | WebSocket / HTTP                                                      | Business data: chat, sessions, projects, agent, settings, files, streaming          |
| **Native channel** | Swift / Electron / iOS / ... | Platform adapter (WKScriptMessageHandlerWithReply, ipcRenderer, etc.) | System operations: window control, notifications, clipboard, permissions, OS events |

oRPC is a **channel within PostBox**, not a parallel system. From business code's perspective, `pb.chat.stream()` and `pb.window.create()` are both "PostBox calls" — they just happen to be routed to different backends internally.

#### Why PostBox exists

1. **Platform abstraction** — The WebView doesn't know (and shouldn't know) whether it's running inside WKWebView, Electron, or a browser iframe. PostBox hides the transport completely.

2. **Single API surface** — Components import `pb` and call methods. They never deal with WebSocket connections, `postMessage` APIs, or `ipcRenderer` directly.

3. **Future portability** — When Paperboy moves to a new platform, only PostBox's channel adapters change. Zero changes to any component, hook, or page.

4. **Direct native access** — System-level operations (window management, notifications, clipboard) bypass Santi and go directly to the native shell for minimal latency:

| Path                                          | Latency             | Dependency     | Offline |
| --------------------------------------------- | ------------------- | -------------- | ------- |
| `pb.chat.send()` → oRPC channel → Santi       | ~5ms (localhost WS) | Santi must run | No      |
| `pb.window.create()` → Native channel → Swift | ~1ms (in-process)   | None           | Yes     |

#### Platform adapter pattern

PostBox defines a `PlatformAdapter` interface. Each platform provides its own implementation:

```typescript
// packages/web/src/lib/postbox/adapter.ts

interface PlatformAdapter {
  // Send a fire-and-forget action
  send(message: PostBoxMessage): void;

  // Send an action and wait for a response
  request<T>(message: PostBoxMessage): Promise<T>;

  // Subscribe to events pushed from the native side
  onEvent(handler: (event: NativeEvent) => void): () => void;
}
```

| Platform          | Adapter              | Transport                         | Status  |
| ----------------- | -------------------- | --------------------------------- | ------- |
| macOS (WKWebView) | `WKWebViewAdapter`   | `WKScriptMessageHandlerWithReply` | Current |
| Electron          | `ElectronAdapter`    | `ipcRenderer.invoke()`            | Future  |
| Browser (iframe)  | `PostMessageAdapter` | `window.postMessage()`            | Future  |
| React Native      | `RNBridgeAdapter`    | Native bridge                     | Future  |

Business code is identical across all platforms:

```typescript
// This code works on macOS, Electron, browser — unchanged
await pb.window.create({ sessionId: "abc" });
await pb.notification.send({ title: "Done", body: "Agent finished" });
const content = await pb.clipboard.read();
```

#### The `pb` object — PostBox's public API

`pb` IS PostBox. All external communication from the WebView goes through `pb.*`. Internally, PostBox routes each call to the appropriate channel:

```typescript
// packages/web/src/lib/pb.ts — PostBox: the WebView's single exit point

import { createORPCChannel } from "./channels/orpc";
import { createNativeChannel } from "./channels/native";

const orpc = createORPCChannel({ ws: partySocket });
const native = createNativeChannel(); // auto-detects platform adapter

export const pb = {
  // ── oRPC channel → Santi ─────────────────────────
  chat: orpc.chat,
  session: orpc.session,
  project: orpc.project,
  agent: orpc.agent,
  auth: orpc.auth,
  settings: orpc.settings,
  file: orpc.file,
  live: orpc.live,
  observability: orpc.observability,
  system: { health: orpc.system.health, info: orpc.system.info },

  // ── Native channel → Swift / Electron / iOS / ... ─
  window: native.window,
  notification: native.notification,
  clipboard: native.clipboard,
  permissions: native.permissions,

  // ── Native event subscription ────────────────────
  onEvent: native.onEvent,
  dispose: native.dispose,
};

export type PB = typeof pb;
```

Components only ever import `pb`. They don't know (or care) whether a call goes to Santi or to the native shell:

```typescript
import { pb } from "@/lib/pb";

// These two calls look identical to the component.
// PostBox routes them to different channels internally.
const sessions = await pb.session.list(); // → oRPC channel → Santi
await pb.window.create({ sessionId: sessions[0].id }); // → Native channel → Swift
```

**What happens when Paperboy moves to Electron?**

```typescript
// packages/web/src/lib/channels/native.ts — only this file changes

function detectAdapter(): PlatformAdapter {
  if (window.webkit?.messageHandlers?.postbox) return new WKWebViewAdapter();
  if (window.electronAPI) return new ElectronAdapter();
  if (window.parent !== window) return new PostMessageAdapter();
  throw new Error("No native adapter available");
}
```

Every `pb.window.create()` call in the entire codebase continues to work — zero changes.

#### WKWebView adapter: `WKScriptMessageHandlerWithReply` long-poll

The macOS adapter uses `WKScriptMessageHandlerWithReply` for **ALL communication in both directions**. There is no `callAsyncJavaScript`, no global functions injected into the page — everything flows through a single `postMessage` channel.

**How it works:**

- **React → Swift (action):** WebView calls `postMessage({ type: "action", ... })`. Swift handles the action and replies via the reply handler. The JS side gets a `Promise` back with the result.
- **Swift → React (event push):** WebView calls `postMessage({ type: "listen" })`, which **hangs** (the Promise does not resolve). When Swift has an event to push, it replies to the pending listener. WebView immediately re-registers a new listener.

This is a **long-poll pattern** — the WebView always has one outstanding `listen` request waiting for Swift to respond.

**Swift side:**

```swift
class PostBoxHandler: NSObject, WKScriptMessageHandlerWithReply {

    private var pendingListener: ((Any?, String?) -> Void)?
    private var eventQueue: [[String: Any]] = []

    func userContentController(
        _ controller: WKUserContentController,
        didReceive message: WKScriptMessage,
        replyHandler: @escaping (Any?, String?) -> Void
    ) {
        guard let body = message.body as? [String: Any],
              let type = body["type"] as? String else {
            replyHandler(nil, "invalid message")
            return
        }

        switch type {
        case "listen":
            if eventQueue.isEmpty {
                // No events pending — hold the reply handler until we have one
                pendingListener = replyHandler
            } else {
                // Flush queued events immediately
                let events = eventQueue
                eventQueue.removeAll()
                replyHandler(events, nil)
            }

        case "action":
            let action = body["action"] as? String ?? ""
            let params = body["params"] as? [String: Any] ?? [:]
            handleAction(action, params: params, reply: replyHandler)

        default:
            replyHandler(nil, "unknown type")
        }
    }

    /// Push an event to the WebView
    func emit(event: String, params: [String: Any] = [:]) {
        let payload: [String: Any] = ["event": event, "params": params]

        if let listener = pendingListener {
            pendingListener = nil
            listener([payload], nil)
        } else {
            eventQueue.append(payload)
        }
    }

    /// Broadcast to all windows (e.g., theme change)
    static func broadcast(event: String, params: [String: Any] = [:]) {
        for handler in WindowManager.shared.allPostBoxHandlers {
            handler.emit(event: event, params: params)
        }
    }

    private func handleAction(
        _ action: String,
        params: [String: Any],
        reply: @escaping (Any?, String?) -> Void
    ) {
        switch action {
        case "window.create":
            let sid = params["sessionId"] as? String
            WindowManager.shared.createWindow(sessionId: sid)
            reply(["ok": true], nil)
        case "window.close":
            webView?.window?.close()
            reply(["ok": true], nil)
        case "clipboard.read":
            let content = NSPasteboard.general.string(forType: .string)
            reply(["content": content as Any], nil)
        case "notification.send":
            let title = params["title"] as? String ?? ""
            let body = params["body"] as? String ?? ""
            NotificationManager.shared.send(title: title, body: body)
            reply(["ok": true], nil)
        default:
            reply(nil, "unknown action: \(action)")
        }
    }
}
```

**React side (WKWebView adapter):**

```typescript
// packages/web/src/lib/postbox/adapters/wkwebview.ts

import type { PlatformAdapter, PostBoxMessage, NativeEvent } from "../types";

export class WKWebViewAdapter implements PlatformAdapter {
  private eventHandlers = new Set<(event: NativeEvent) => void>();
  private listening = false;

  constructor() {
    this.startListening();
  }

  send(message: PostBoxMessage): void {
    window.webkit?.messageHandlers?.postbox?.postMessage({
      type: "action",
      action: message.action,
      params: message.params,
    });
  }

  async request<T>(message: PostBoxMessage): Promise<T> {
    return window.webkit!.messageHandlers.postbox.postMessage({
      type: "action",
      action: message.action,
      params: message.params,
    }) as Promise<T>;
  }

  onEvent(handler: (event: NativeEvent) => void): () => void {
    this.eventHandlers.add(handler);
    return () => this.eventHandlers.delete(handler);
  }

  private async startListening() {
    if (this.listening) return;
    this.listening = true;

    while (this.listening) {
      try {
        // Hangs until Swift replies with event(s)
        const events = (await window.webkit!.messageHandlers.postbox.postMessage({
          type: "listen",
        })) as NativeEvent[];

        for (const event of events) {
          for (const handler of this.eventHandlers) {
            handler(event);
          }
        }
      } catch {
        // WebView navigated or destroyed — stop listening
        this.listening = false;
      }
    }
  }

  dispose() {
    this.listening = false;
    this.eventHandlers.clear();
  }
}
```

**Why this design is better than `callAsyncJavaScript`:**

| Dimension        | `callAsyncJavaScript`                        | `WKScriptMessageHandlerWithReply` long-poll               |
| ---------------- | -------------------------------------------- | --------------------------------------------------------- |
| Communication    | Two APIs (postMessage + callAsyncJavaScript) | **Single API** (postMessage for everything)               |
| JS injection     | Swift executes JS in the page                | **No JS execution** — pure message passing                |
| Global functions | Requires `window.__postbox__` to exist       | **None needed**                                           |
| Timing           | Fails if page hasn't loaded                  | WebView registers listener when ready — no race condition |
| Event loss       | Events lost during navigation                | Queued on Swift side, flushed when listener re-registers  |
| Security         | JS code injection surface                    | No injection surface                                      |

### 2.3 Swift ↔ Santi Communication

Swift also communicates directly with Santi via HTTP/SSE. This path is separate from PostBox — it uses standard HTTP because both sides understand it natively.

- `GET /api/agent.status` — Orb queries current agent state
- `SSE /api/agent.events` — Orb subscribes to real-time agent event stream (drives animation)
- Zero additional dependencies, standard URLSession + JSONDecoder

Santi never needs to "call back" to Swift. The only two directions are: Swift reads from Santi (HTTP/SSE), and React sends events to Swift (PostBox).

---

## 3. oRPC Router Design

### 3.1 Top-Level Router Structure

The oRPC router handles **business data only**. System-level operations (window, notification, clipboard) go through PostBox (see §2.2).

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

  // ── Project (formerly "Spaces") ───────────────
  project: {
    list: projectListProcedure,
    get: projectGetProcedure,
    create: projectCreateProcedure,
    update: projectUpdateProcedure,
    delete: projectDeleteProcedure,
    reorder: projectReorderProcedure,
  },

  // ── Chat ──────────────────────────────────────
  chat: {
    send: chatSendProcedure, // request/response: send message
    stream: chatStreamProcedure, // Event Iterator: agent response stream
    history: chatHistoryProcedure, // request/response: paginated history
    approve: chatApproveProcedure, // request/response: tool approval
    queue: chatQueueProcedure, // request/response: message queue operations
  },

  // ── Agent ─────────────────────────────────────
  agent: {
    status: agentStatusProcedure, // request/response: current status
    events: agentEventsProcedure, // Event Iterator: agent event stream (tool calls, subagent, progress)
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

  // ── File Operations ───────────────────────────
  file: {
    upload: fileUploadProcedure, // HTTP multipart (large files) or WS (small files)
    download: fileDownloadProcedure,
    meta: fileMetaProcedure, // file metadata (size, mime, etc.)
  },

  // ── Real-Time Subscriptions ───────────────────
  live: {
    updates: liveUpdatesProcedure, // Event Iterator: multi-window state sync via Publisher
  },

  // ── Observability ─────────────────────────────
  observability: {
    issues: observabilityIssuesProcedure,
    events: observabilityEventsProcedure, // Event Iterator: real-time error push
    metrics: observabilityMetricsProcedure,
  },

  // ── System (Santi-level, NOT Swift shell) ─────
  system: {
    health: systemHealthProcedure, // health check for DaemonManager
    info: systemInfoProcedure, // Santi version, uptime, etc.
  },
};

export type Router = typeof router;
```

**What is NOT in the oRPC router (handled by PostBox):**

| Operation                          | Why PostBox                         | Direction     |
| ---------------------------------- | ----------------------------------- | ------------- |
| `window.create/close/resize/focus` | Requires `NSWindow`                 | React → Swift |
| `notification.send`                | Requires `UNUserNotificationCenter` | React → Swift |
| `system.permissions`               | Requires TCC framework              | React → Swift |
| `system.clipboard`                 | Requires `NSPasteboard`             | React → Swift |
| `navigate(sessionId)`              | Orb click → open chat window        | Swift → React |
| `themeChanged(theme)`              | macOS appearance change             | Swift → React |
| `oauthCallback(url)`               | OAuth redirect relay                | Swift → React |
| `fileDrop(paths)`                  | Finder drag & drop                  | Swift → React |

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

### 3.4 PostBox: Shared Types and Native Channel

PostBox type definitions live in `@paperboy/shared` so both `packages/web` and Swift can reference the same contract.

**Shared type definitions:**

```typescript
// packages/shared/src/postbox.ts

// ── Messages: React → Swift ─────────────────────
export interface PostBoxMessage {
  action: string;
  params?: Record<string, unknown>;
}

export type PostBoxAction =
  | { action: "window.create"; params: { sessionId?: string; width?: number; height?: number } }
  | { action: "window.close"; params: { windowId: string } }
  | { action: "window.resize"; params: { windowId: string; width: number; height: number } }
  | { action: "window.focus"; params: { windowId: string } }
  | { action: "notification.send"; params: { title: string; body: string; sound?: boolean } }
  | { action: "clipboard.read" }
  | { action: "permissions.query"; params: { type: string } };

// ── Events: Swift → React ───────────────────────
export type NativeEvent =
  | { event: "navigate"; params: { sessionId: string } }
  | { event: "themeChanged"; params: { theme: "light" | "dark" } }
  | { event: "oauthCallback"; params: { url: string } }
  | { event: "fileDrop"; params: { paths: string[] } }
  | { event: "windowWillClose" };
```

**Native channel (wraps PlatformAdapter into typed methods):**

```typescript
// packages/web/src/lib/channels/native.ts

import type { PlatformAdapter, NativeEvent } from "../postbox/types";
import { WKWebViewAdapter } from "../postbox/adapters/wkwebview";

function detectAdapter(): PlatformAdapter {
  if (window.webkit?.messageHandlers?.postbox) return new WKWebViewAdapter();
  // Future: if (window.electronAPI) return new ElectronAdapter();
  // Future: if (window.parent !== window) return new PostMessageAdapter();
  throw new Error("No PostBox adapter available");
}

export function createNativeChannel() {
  const adapter = detectAdapter();

  return {
    window: {
      create: (p?: { sessionId?: string; width?: number; height?: number }) =>
        adapter.request<{ ok: boolean }>("window.create", p),
      close: (p: { windowId: string }) => adapter.send("window.close", p),
      resize: (p: { windowId: string; width: number; height: number }) =>
        adapter.send("window.resize", p),
      focus: (p: { windowId: string }) => adapter.send("window.focus", p),
    },
    notification: {
      send: (p: { title: string; body: string; sound?: boolean }) =>
        adapter.send("notification.send", p),
    },
    clipboard: {
      read: () => adapter.request<{ content: string | null }>("clipboard.read"),
    },
    permissions: {
      query: (p: { type: string }) => adapter.request<{ granted: boolean }>("permissions.query", p),
    },
    onEvent: adapter.onEvent.bind(adapter),
    dispose: adapter.dispose.bind(adapter),
  };
}
```

**React hook for listening to native events:**

```typescript
// packages/web/src/hooks/useNativeEvent.ts

import { useEffect } from "react";
import { pb } from "@/lib/pb";

export function useNativeEvent(event: NativeEvent["event"], handler: (params: any) => void) {
  useEffect(() => {
    return pb.onEvent((e) => {
      if (e.event === event) handler(e.params);
    });
  }, [event, handler]);
}

// Usage:
// useNativeEvent("navigate", ({ sessionId }) => router.navigate(...));
// useNativeEvent("themeChanged", ({ theme }) => setTheme(theme));
// useNativeEvent("fileDrop", ({ paths }) => handleFileDrop(paths));
```

**"Open in New Window" flow:**

```
User clicks "Open in New Window" in React UI
  → pb.window.create({ sessionId: "abc" })
  → WKWebViewAdapter.request("window.create", { sessionId: "abc" })
  → postMessage({ type: "action", action: "window.create", params: {...} })
  → Swift PostBoxHandler receives, creates NSWindow + WKWebView
  → New WKWebView loads localhost:PORT/#/chat/abc
  → New React instance mounts, auto-detects WKWebViewAdapter, connects oRPC
```

### 3.5 Error Handling Strategy

oRPC provides built-in error handling via `ORPCError`. All procedures follow a consistent error strategy:

**Error codes and categories:**

```typescript
// packages/shared/src/errors.ts

import { ORPCError } from "@orpc/server";

export const ErrorCode = {
  // Auth errors (401/403)
  UNAUTHORIZED: "UNAUTHORIZED",
  TOKEN_EXPIRED: "TOKEN_EXPIRED",
  FORBIDDEN: "FORBIDDEN",

  // Resource errors (404/409)
  SESSION_NOT_FOUND: "SESSION_NOT_FOUND",
  PROJECT_NOT_FOUND: "PROJECT_NOT_FOUND",
  SESSION_CONFLICT: "SESSION_CONFLICT",

  // Agent errors (409/429)
  AGENT_BUSY: "AGENT_BUSY",
  AGENT_CANCELLED: "AGENT_CANCELLED",
  RATE_LIMITED: "RATE_LIMITED",

  // Stream errors (500)
  STREAM_INTERRUPTED: "STREAM_INTERRUPTED",
  STREAM_TIMEOUT: "STREAM_TIMEOUT",

  // File errors (400/413)
  FILE_TOO_LARGE: "FILE_TOO_LARGE",
  FILE_TYPE_NOT_ALLOWED: "FILE_TYPE_NOT_ALLOWED",

  // Server errors (500)
  INTERNAL: "INTERNAL",
} as const;

export function createError(code: keyof typeof ErrorCode, message: string, data?: unknown) {
  return new ORPCError(code, { message, data });
}
```

**Client-side error handling:**

```typescript
// packages/web/src/lib/orpc-error-handler.ts

import { isDefinedError } from "@orpc/client";

export function handleORPCError(error: unknown) {
  if (!isDefinedError(error)) {
    // Network error or unexpected error
    showToast("Connection lost. Retrying...", "error");
    return;
  }

  switch (error.code) {
    case "UNAUTHORIZED":
    case "TOKEN_EXPIRED":
      // Trigger re-auth flow (pb → PostBox → Swift → Keychain → inject new token)
      pb.auth.refreshToken();
      break;
    case "AGENT_BUSY":
      showToast("Agent is processing another request", "warning");
      break;
    case "RATE_LIMITED":
      showToast("Too many requests. Please wait.", "warning");
      break;
    case "STREAM_INTERRUPTED":
      // Show retry button on the message
      markMessageRetryable(error.data?.messageId);
      break;
    default:
      showToast(error.message, "error");
  }
}
```

**oRPC middleware for consistent error wrapping:**

```typescript
// packages/santi/src/rpc/middleware/error.ts

const errorMiddleware = os.middleware(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    if (error instanceof ORPCError) throw error;

    // Wrap unexpected errors
    console.error("[oRPC] Unhandled error:", error);
    throw createError("INTERNAL", "An unexpected error occurred");
  }
});
```

### 3.6 WebSocket Reconnection Strategy

WebSocket connections can drop due to network changes, sleep/wake, or Santi restarts. The reconnection strategy must handle all cases transparently.

**Client-side: `partysocket` for auto-reconnect**

```typescript
// packages/web/src/lib/orpc-client.ts

import PartySocket from "partysocket";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/websocket";
import type { Router } from "@paperboy/shared/router";

const ws = new PartySocket({
  host: `localhost:${PORT}`,
  path: "/rpc",
  // Reconnection config
  startClosed: false,
  minReconnectDelay: 500,
  maxReconnectDelay: 5000,
  reconnectDecay: 1.5,
  maxRetries: Infinity,
});

const link = new RPCLink({ websocket: ws });
export const client = createORPCClient<Router>(link);

// Connection state for UI feedback
ws.addEventListener("open", () => {
  useConnectionStore.getState().setConnected(true);
});

ws.addEventListener("close", () => {
  useConnectionStore.getState().setConnected(false);
});
```

**Reconnection scenarios and recovery:**

| Scenario                            | Detection                                    | Recovery                                                                                               |
| ----------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Momentary network drop              | WS `close` event, reconnects within seconds  | `partysocket` auto-reconnects; `live.updates` resumes via `lastEventId`                                |
| Mac sleep/wake                      | WS `close` on sleep, `open` on wake          | Same as above; `lastEventId` recovers events within 5-min retention window                             |
| Santi process restart               | WS `close`, health check fails then recovers | `partysocket` retries until Santi is back; client does full state refresh (session list, current chat) |
| In-flight `chat.stream` interrupted | Iterator throws or yields no more events     | UI shows "Stream interrupted" + retry button; user re-sends from last message                          |

**`live.updates` gap recovery:**

```typescript
// When reconnected, if Publisher's retention window (5 min) covers the gap,
// lastEventId resumes seamlessly. If the gap is too large:

ws.addEventListener("open", async () => {
  const connectionStore = useConnectionStore.getState();
  const disconnectDuration = Date.now() - connectionStore.lastDisconnectTime;

  if (disconnectDuration > 5 * 60 * 1000) {
    // Gap exceeds Publisher retention — full refresh
    await queryClient.invalidateQueries({ queryKey: ["session"] });
    await queryClient.invalidateQueries({ queryKey: ["project"] });
  }
  // Otherwise, lastEventId handles it automatically
});
```

### 3.7 File and Binary Data Transfer

File operations (chat attachments, image uploads) reuse the WebSocket connection where practical.

**Strategy: WS by default, HTTP fallback for large files**

| File size | Transport      | Mechanism                                                         |
| --------- | -------------- | ----------------------------------------------------------------- |
| ≤ 10 MB   | WebSocket      | oRPC `file.upload` procedure, binary encoded in WS frame          |
| > 10 MB   | HTTP multipart | Standard `fetch()` to `/api/file.upload` (OpenAPI endpoint)       |
| Download  | HTTP           | Direct URL: `/api/file.download?id=xxx` (supports range requests) |

**Upload procedure:**

```typescript
// Server side
const fileUploadProcedure = os
  .input(
    z.object({
      sessionId: z.string(),
      filename: z.string(),
      mimeType: z.string(),
      data: z.instanceof(Blob), // oRPC supports Blob/File over WS
    }),
  )
  .output(z.object({ fileId: z.string(), url: z.string() }))
  .handler(async ({ input }) => {
    const fileId = generateId();
    await storage.save(fileId, input.data, {
      filename: input.filename,
      mimeType: input.mimeType,
    });
    return { fileId, url: `/api/file.download?id=${fileId}` };
  });
```

```typescript
// Client side — auto-selects transport based on size
export async function uploadFile(sessionId: string, file: File) {
  if (file.size <= 10 * 1024 * 1024) {
    // Small file: use WS (already connected, lower latency)
    return client.file.upload({ sessionId, filename: file.name, mimeType: file.type, data: file });
  } else {
    // Large file: use HTTP multipart with progress
    const formData = new FormData();
    formData.append("file", file);
    formData.append("sessionId", sessionId);
    const res = await fetch(`http://localhost:${PORT}/api/file.upload`, {
      method: "POST",
      body: formData,
      headers: { Authorization: `Bearer ${token}` },
    });
    return res.json();
  }
}
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

Note: `window.*`, `notification.*`, `clipboard.*`, `permissions.*` are NOT routed through Santi. These go directly between React and Swift via PostBox (WKScriptMessageHandler).

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

| Proto Service     | Method            | New Location                    | Type                           |
| ----------------- | ----------------- | ------------------------------- | ------------------------------ |
| `ChatService`     | `SendMessage`     | oRPC `chat.send`                | request/response               |
| `ChatService`     | `StreamResponse`  | oRPC `chat.stream`              | **Event Iterator (WS)**        |
| `ChatService`     | `GetHistory`      | oRPC `chat.history`             | request/response               |
| `ChatService`     | `ApproveToolCall` | oRPC `chat.approve`             | request/response               |
| `SessionService`  | `List`            | oRPC `session.list`             | request/response               |
| `SessionService`  | `Create`          | oRPC `session.create`           | request/response               |
| `SessionService`  | `Delete`          | oRPC `session.delete`           | request/response               |
| `SessionService`  | `Subscribe`       | oRPC `live.updates`             | **Event Iterator (Publisher)** |
| `AgentService`    | `GetStatus`       | oRPC `agent.status`             | request/response               |
| `AgentService`    | `StreamEvents`    | oRPC `agent.events`             | **Event Iterator (WS)**        |
| `AgentService`    | `Cancel`          | oRPC `agent.cancel`             | request/response               |
| `DaemonService`   | `HealthCheck`     | oRPC `system.health`            | request/response               |
| `DaemonService`   | `GetPermissions`  | **PostBox** `permissions.query` | React → Swift direct           |
| `PaperboyService` | `Notify`          | **PostBox** `notification.send` | React → Swift direct           |

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

- **§3.3 Bridge Communication Protocol** — Protobuf replaced by oRPC; PostBox redesigned as the WebView's universal communication layer (oRPC + native channels)
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
