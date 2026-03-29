# Paperboy 通信协议重设计：oRPC 统一通信层

> 创建日期：2026-03-28
> 作者：Xinyao Chen
> 状态：草案（Draft）
> 关联文档：[Paperboy 前端大重写方案](./paperboy-frontend-rewrite_zh-CN.md)

本文档详述了 Paperboy 通信层的重新设计——用统一的 oRPC 架构替换现有的三套独立协议（Protobuf WebSocket、JSON WebSocket、WKScriptMessageHandler）。涵盖双 Adapter 设计（WebSocket 给 React、HTTP/OpenAPI 给 Swift）、PostBox 统一通信桥抽象、流式传输与多窗口同步模式、错误处理策略，以及从旧 Protobuf 体系逐步迁移的路径。

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
- ~~WebSocket transport~~ → 删除 `packages/santi/src/proto/transport/`
- ~~Envelope framing~~ → oRPC 自带 request correlation
- **PostBox 重新定位** — PostBox 从一个 WKWebView 专属桥接升级为 **WebView 的统一通信层** — 所有对外通信的唯一出口。oRPC 成为 PostBox 内部的一个 channel（对接 Santi），另一个是 native channel（对接 Swift/Electron/iOS/…）。业务代码通过 `pb.*` 调用，完全不知道自己跑在什么平台上。详见 §2.2。

---

## 二、目标架构

### 2.1 双 Adapter 架构：同一 Router，两种暴露方式

**核心设计：Santi 上同一套 oRPC router，同时挂载两个 handler。**

```
┌──────────────────────────────────────────────────────────────┐
│  React SPA (Chat Window WebView / 浏览器)                      │
│                                                                │
│  ┌─ PostBox (pb.*) ─ 唯一对外出口 ──────────────────────────┐ │
│  │                                                           │ │
│  │  oRPC Channel               Native Channel               │ │
│  │  ├── pb.chat.*              ├── pb.window.*               │ │
│  │  ├── pb.session.*           ├── pb.notification.*         │ │
│  │  ├── pb.project.*           ├── pb.clipboard.*            │ │
│  │  ├── pb.agent.*             ├── pb.permissions.*          │ │
│  │  ├── pb.auth.*              └── pb.onEvent()              │ │
│  │  ├── pb.settings.*                                        │ │
│  │  ├── pb.file.*              Adapter: 自动检测              │ │
│  │  ├── pb.live.*              (WKWebView / Electron / ...)  │ │
│  │  ├── pb.observability.*                                   │ │
│  │  └── pb.system.*                                          │ │
│  └──────┬─────────────────────────────────┬──────────────────┘ │
│         │                                 │                     │
└─────────┼─────────────────────────────────┼─────────────────────┘
          │ WebSocket                       │ WKScriptMessageHandlerWithReply
          │ ws://localhost:PORT/rpc          │ (长轮询模式)
          ▼                                 ▼
┌──────────────────────────────┐  ┌──────────────────────────────┐
│  Santi (Bun Server)          │  │  Swift Shell (极薄)           │
│                              │  │                               │
│  ┌─ RPCHandler ────────────┐│  │  PostBoxHandler:               │
│  │  WS adapter — React 用  ││  │  ├── window.create/close/      │
│  │  Streaming、双向         ││  │  │   resize/focus              │
│  └─────────────────────────┘│  │  ├── notification.send         │
│                              │  │  ├── clipboard / permissions   │
│  ┌─ OpenAPIHandler ────────┐│  │  ├── emit: navigate, 主题,     │
│  │  HTTP/SSE — Swift 用    ││  │  │   OAuth, 文件拖放            │
│  └─────────────────────────┘│  │  └── broadcast 到所有窗口      │
│                              │  │                               │
│  Router（业务数据）：         │  │  URLSession 调 Santi：         │
│  ├── chat.*                  │  │  ├── GET /api/agent.status     │
│  ├── session.*               │  │  └── SSE /api/agent.events     │
│  ├── project.*               │  │      → Orb 动画                │
│  ├── agent.*                 │  │                               │
│  ├── auth.*                  │  └───────────────────────────────┘
│  ├── settings.*              │
│  ├── file.*                  │
│  ├── live.*                  │
│  ├── observability.*         │
│  └── system.health           │
│                              │
│  MemoryPublisher             │
│  └── 广播状态变更             │
└──────────────────────────────┘
```

**PostBox 是 WebView 的唯一对外出口，内部有两个 channel：**

| Channel            | 目标                       | 传输方式                                                        | 示例                                           |
| ------------------ | -------------------------- | --------------------------------------------------------------- | ---------------------------------------------- |
| **oRPC channel**   | Santi (TS 后端)            | WebSocket (React) / HTTP+SSE (Swift)                            | `pb.chat.stream()`、`pb.session.list()`        |
| **Native channel** | Swift / Electron / iOS / … | 平台 Adapter（WKScriptMessageHandlerWithReply、ipcRenderer、…） | `pb.window.create()`、`pb.notification.send()` |

所有通信都走 `pb.*`。业务代码不需要知道底层走哪个 channel。

### 2.2 PostBox：统一通信层

#### PostBox 是什么？

PostBox 是 **WebView 所有对外通信的唯一出口**。只要 WebView 需要和外部通信 — 不管是 Santi（TS 后端）、Swift（原生壳）、还是未来可能的 Electron、mobile iOS、或任何其他宿主 — 都走 PostBox。

PostBox 的唯一职责：**屏蔽消息如何传递以及传递到哪里，让业务代码完全不需要知道自己跑在什么平台上。** WebView 今天可能在 macOS WKWebView 里，明天在 Electron BrowserWindow 里，后天在 React Native WebView 里 — 业务代码完全不变。

#### PostBox 的内部架构

PostBox 不是单一传输 — 它是一个**带路由的多 channel 系统**。每个 channel 负责不同类别的通信：

| Channel            | 目标                       | 传输方式                                                        | 承载内容                                                           |
| ------------------ | -------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------ |
| **oRPC channel**   | Santi (TS 后端)            | WebSocket / HTTP                                                | 业务数据：chat、session、project、agent、settings、file、streaming |
| **Native channel** | Swift / Electron / iOS / … | 平台 Adapter（WKScriptMessageHandlerWithReply、ipcRenderer 等） | 系统操作：窗口控制、通知、剪贴板、权限、OS 事件                    |

oRPC 是 **PostBox 内部的一个 channel**，不是一个平行的系统。从业务代码角度看，`pb.chat.stream()` 和 `pb.window.create()` 都是"PostBox 调用" — 只是内部被路由到了不同的后端。

#### PostBox 存在的意义

1. **平台抽象** — WebView 不知道（也不应该知道）自己跑在 WKWebView、Electron 还是浏览器 iframe 里。PostBox 完全隐藏了传输细节。

2. **单一 API 表面** — 组件只 import `pb`，调方法。永远不直接碰 WebSocket 连接、`postMessage` API 或 `ipcRenderer`。

3. **未来可移植性** — Paperboy 换到新平台时，只改 PostBox 的 channel adapter。组件、hook、页面——全部零改动。

4. **原生直连** — 系统级操作（窗口管理、通知、剪贴板）绕过 Santi，直接到原生壳，延迟最低：

| 路径                                          | 延迟                | 依赖           | 离线可用 |
| --------------------------------------------- | ------------------- | -------------- | -------- |
| `pb.chat.send()` → oRPC channel → Santi       | ~5ms (localhost WS) | Santi 必须运行 | 否       |
| `pb.window.create()` → Native channel → Swift | ~1ms (进程内)       | 无             | 是       |

#### 平台 Adapter 模式

PostBox 定义了 `PlatformAdapter` 接口。每个平台提供自己的实现：

```typescript
// packages/web/src/lib/postbox/adapter.ts

interface PlatformAdapter {
  // 发送 fire-and-forget 动作
  send(message: PostBoxMessage): void;

  // 发送动作并等待响应
  request<T>(message: PostBoxMessage): Promise<T>;

  // 订阅原生侧推送的事件
  onEvent(handler: (event: NativeEvent) => void): () => void;
}
```

| 平台              | Adapter              | 传输方式                          | 状态 |
| ----------------- | -------------------- | --------------------------------- | ---- |
| macOS (WKWebView) | `WKWebViewAdapter`   | `WKScriptMessageHandlerWithReply` | 当前 |
| Electron          | `ElectronAdapter`    | `ipcRenderer.invoke()`            | 未来 |
| 浏览器 (iframe)   | `PostMessageAdapter` | `window.postMessage()`            | 未来 |
| React Native      | `RNBridgeAdapter`    | Native bridge                     | 未来 |

业务代码在所有平台上完全相同：

```typescript
// 这段代码在 macOS、Electron、浏览器上都能跑 — 不需要改
await pb.window.create({ sessionId: "abc" });
await pb.notification.send({ title: "Done", body: "Agent finished" });
const content = await pb.clipboard.read();
```

#### `pb` 对象 — PostBox 的公开 API

`pb` 就是 PostBox。WebView 的所有对外通信都走 `pb.*`。PostBox 内部将每个调用路由到正确的 channel：

```typescript
// packages/web/src/lib/pb.ts — PostBox：WebView 的唯一对外出口

import { createORPCChannel } from "./channels/orpc";
import { createNativeChannel } from "./channels/native";

const orpc = createORPCChannel({ ws: partySocket });
const native = createNativeChannel(); // 自动检测平台 adapter

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

  // ── Native channel → Swift / Electron / iOS / … ──
  window: native.window,
  notification: native.notification,
  clipboard: native.clipboard,
  permissions: native.permissions,

  // ── 原生事件订阅 ─────────────────────────────────
  onEvent: native.onEvent,
  dispose: native.dispose,
};

export type PB = typeof pb;
```

组件只 import `pb`。它们不知道（也不需要关心）一个调用是到 Santi 还是到原生壳：

```typescript
import { pb } from "@/lib/pb";

// 这两个调用对组件来说看起来完全一样。
// PostBox 内部将它们路由到不同的 channel。
const sessions = await pb.session.list(); // → oRPC channel → Santi
await pb.window.create({ sessionId: sessions[0].id }); // → Native channel → Swift
```

**Paperboy 迁移到 Electron 时会怎样？**

```typescript
// packages/web/src/lib/channels/native.ts — 只改这个文件

function detectAdapter(): PlatformAdapter {
  if (window.webkit?.messageHandlers?.postbox) return new WKWebViewAdapter();
  if (window.electronAPI) return new ElectronAdapter();
  if (window.parent !== window) return new PostMessageAdapter();
  throw new Error("No native adapter available");
}
```

整个代码库中所有 `pb.window.create()` 调用继续正常工作 — 零改动。

#### WKWebView Adapter：`WKScriptMessageHandlerWithReply` 长轮询

macOS adapter 使用 `WKScriptMessageHandlerWithReply` 实现**所有双向通信**。不使用 `callAsyncJavaScript`，不注入全局函数 — 一切都通过单一的 `postMessage` 通道。

**工作原理：**

- **React → Swift（action）：** WebView 调 `postMessage({ type: "action", ... })`。Swift 处理后通过 reply handler 回复。JS 侧拿到一个 `Promise` 返回结果。
- **Swift → React（事件推送）：** WebView 调 `postMessage({ type: "listen" })`，Promise **挂起不 resolve**。当 Swift 有事件要推送时，回复这个挂起的 listener。WebView 立即重新注册新 listener。

这是一个**长轮询模式** — WebView 始终有一个待回复的 `listen` 请求等待 Swift 响应。

**Swift 侧：**

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
                // 没有待推送事件 — 持有 reply handler 直到有事件
                pendingListener = replyHandler
            } else {
                // 立即 flush 队列中的事件
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

    /// 推送事件给 WebView
    func emit(event: String, params: [String: Any] = [:]) {
        let payload: [String: Any] = ["event": event, "params": params]

        if let listener = pendingListener {
            pendingListener = nil
            listener([payload], nil)
        } else {
            eventQueue.append(payload)
        }
    }

    /// 广播到所有窗口（如主题切换）
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

**React 侧（WKWebView adapter）：**

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
        // 挂起等待 Swift 回复事件
        const events = (await window.webkit!.messageHandlers.postbox.postMessage({
          type: "listen",
        })) as NativeEvent[];

        for (const event of events) {
          for (const handler of this.eventHandlers) {
            handler(event);
          }
        }
      } catch {
        // WebView 被销毁或导航了 — 停止监听
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

**为什么这个设计优于 `callAsyncJavaScript`：**

| 维度     | `callAsyncJavaScript`                         | `WKScriptMessageHandlerWithReply` 长轮询    |
| -------- | --------------------------------------------- | ------------------------------------------- |
| 通信     | 两套 API（postMessage + callAsyncJavaScript） | **单一 API**（全部走 postMessage）          |
| JS 注入  | Swift 在页面中执行 JS                         | **不执行任何 JS** — 纯消息传递              |
| 全局函数 | 需要 `window.__postbox__` 存在                | **不需要**                                  |
| 时序     | 页面未加载时调用会失败                        | WebView 加载完后自行注册 listener — 无竞态  |
| 事件丢失 | 导航期间事件可能丢失                          | Swift 侧队列兜底，listener 重新注册后 flush |
| 安全性   | JS 代码注入面                                 | 无注入面                                    |

### 2.3 Swift ↔ Santi 通信

Swift 还通过 HTTP/SSE 直接和 Santi 通信。这条路径与 PostBox 无关 — 用标准 HTTP 是因为两端都能原生理解。

- `GET /api/agent.status` — Orb 查询当前 agent 状态
- `SSE /api/agent.events` — Orb 订阅实时 agent 事件流（驱动动画）
- 零额外依赖，标准 URLSession + JSONDecoder

Santi 不需要"回调" Swift。仅有的两个方向是：Swift 从 Santi 读数据（HTTP/SSE），React 通过 PostBox 向 Swift 发事件。

---

## 三、oRPC Router 设计

### 3.1 顶层 Router 结构

oRPC router 只处理**业务数据**。系统级操作（窗口、通知、剪贴板）走 PostBox（见 §2.2）。

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

  // ── Project（原 "Spaces"）─────────────────────
  project: {
    list: projectListProcedure,
    get: projectGetProcedure,
    create: projectCreateProcedure,
    update: projectUpdateProcedure,
    delete: projectDeleteProcedure,
    reorder: projectReorderProcedure,
  },

  // ── 聊天 ──────────────────────────────────────
  chat: {
    send: chatSendProcedure, // request/response: 发送消息
    stream: chatStreamProcedure, // Event Iterator: agent 响应流
    history: chatHistoryProcedure, // request/response: 分页历史
    approve: chatApproveProcedure, // request/response: tool 审批
    queue: chatQueueProcedure, // request/response: 消息队列操作
  },

  // ── Agent ─────────────────────────────────────
  agent: {
    status: agentStatusProcedure, // request/response: 当前状态
    events: agentEventsProcedure, // Event Iterator: agent 事件流（tool calls、subagent、progress）
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

  // ── 文件操作 ──────────────────────────────────
  file: {
    upload: fileUploadProcedure, // HTTP multipart（大文件）或 WS（小文件）
    download: fileDownloadProcedure,
    meta: fileMetaProcedure, // 文件元数据（大小、mime 等）
  },

  // ── 实时订阅 ──────────────────────────────────
  live: {
    updates: liveUpdatesProcedure, // Event Iterator: 多窗口状态同步 via Publisher
  },

  // ── 可观测性 ──────────────────────────────────
  observability: {
    issues: observabilityIssuesProcedure,
    events: observabilityEventsProcedure, // Event Iterator: 实时错误推送
    metrics: observabilityMetricsProcedure,
  },

  // ── 系统（Santi 级别，非 Swift Shell）─────────
  system: {
    health: systemHealthProcedure, // DaemonManager 健康检查
    info: systemInfoProcedure, // Santi 版本、运行时间等
  },
};

export type Router = typeof router;
```

**不在 oRPC router 中的操作（由 PostBox 处理）：**

| 操作                               | 为什么用 PostBox                | 方向          |
| ---------------------------------- | ------------------------------- | ------------- |
| `window.create/close/resize/focus` | 需要 `NSWindow`                 | React → Swift |
| `notification.send`                | 需要 `UNUserNotificationCenter` | React → Swift |
| `system.permissions`               | 需要 TCC framework              | React → Swift |
| `system.clipboard`                 | 需要 `NSPasteboard`             | React → Swift |
| `navigate(sessionId)`              | Orb 点击 → 打开聊天窗口         | Swift → React |
| `themeChanged(theme)`              | macOS 外观变更                  | Swift → React |
| `oauthCallback(url)`               | OAuth 重定向转发                | Swift → React |
| `fileDrop(paths)`                  | Finder 文件拖放                 | Swift → React |

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

### 3.4 PostBox：共享类型与 Native Channel

PostBox 类型定义放在 `@paperboy/shared` 中，`packages/web` 和 Swift 都引用同一份契约。

**共享类型定义：**

```typescript
// packages/shared/src/postbox.ts

// ── 消息：React → Swift ─────────────────────────
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

// ── 事件：Swift → React ─────────────────────────
export type NativeEvent =
  | { event: "navigate"; params: { sessionId: string } }
  | { event: "themeChanged"; params: { theme: "light" | "dark" } }
  | { event: "oauthCallback"; params: { url: string } }
  | { event: "fileDrop"; params: { paths: string[] } }
  | { event: "windowWillClose" };
```

**Native Channel（将 PlatformAdapter 包装为类型化方法）：**

```typescript
// packages/web/src/lib/channels/native.ts

import type { PlatformAdapter, NativeEvent } from "../postbox/types";
import { WKWebViewAdapter } from "../postbox/adapters/wkwebview";

function detectAdapter(): PlatformAdapter {
  if (window.webkit?.messageHandlers?.postbox) return new WKWebViewAdapter();
  // 未来: if (window.electronAPI) return new ElectronAdapter();
  // 未来: if (window.parent !== window) return new PostMessageAdapter();
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

**React hook 监听原生事件：**

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

// 使用：
// useNativeEvent("navigate", ({ sessionId }) => router.navigate(...));
// useNativeEvent("themeChanged", ({ theme }) => setTheme(theme));
// useNativeEvent("fileDrop", ({ paths }) => handleFileDrop(paths));
```

**"在新窗口中打开"流程：**

```
用户在 React UI 中点击"在新窗口中打开"
  → pb.window.create({ sessionId: "abc" })
  → WKWebViewAdapter.request("window.create", { sessionId: "abc" })
  → postMessage({ type: "action", action: "window.create", params: {...} })
  → Swift PostBoxHandler 接收，创建 NSWindow + WKWebView
  → 新 WKWebView 加载 localhost:PORT/#/chat/abc
  → 新 React 实例挂载，自动检测 WKWebViewAdapter，连接 oRPC
```

### 3.5 错误处理策略

oRPC 通过 `ORPCError` 提供内置错误处理。所有 procedure 遵循统一的错误策略：

**错误码与分类：**

```typescript
// packages/shared/src/errors.ts

import { ORPCError } from "@orpc/server";

export const ErrorCode = {
  // 认证错误 (401/403)
  UNAUTHORIZED: "UNAUTHORIZED",
  TOKEN_EXPIRED: "TOKEN_EXPIRED",
  FORBIDDEN: "FORBIDDEN",

  // 资源错误 (404/409)
  SESSION_NOT_FOUND: "SESSION_NOT_FOUND",
  PROJECT_NOT_FOUND: "PROJECT_NOT_FOUND",
  SESSION_CONFLICT: "SESSION_CONFLICT",

  // Agent 错误 (409/429)
  AGENT_BUSY: "AGENT_BUSY",
  AGENT_CANCELLED: "AGENT_CANCELLED",
  RATE_LIMITED: "RATE_LIMITED",

  // 流错误 (500)
  STREAM_INTERRUPTED: "STREAM_INTERRUPTED",
  STREAM_TIMEOUT: "STREAM_TIMEOUT",

  // 文件错误 (400/413)
  FILE_TOO_LARGE: "FILE_TOO_LARGE",
  FILE_TYPE_NOT_ALLOWED: "FILE_TYPE_NOT_ALLOWED",

  // 服务器错误 (500)
  INTERNAL: "INTERNAL",
} as const;

export function createError(code: keyof typeof ErrorCode, message: string, data?: unknown) {
  return new ORPCError(code, { message, data });
}
```

**客户端错误处理：**

```typescript
// packages/web/src/lib/orpc-error-handler.ts

import { isDefinedError } from "@orpc/client";

export function handleORPCError(error: unknown) {
  if (!isDefinedError(error)) {
    // 网络错误或意外错误
    showToast("连接已断开，正在重试...", "error");
    return;
  }

  switch (error.code) {
    case "UNAUTHORIZED":
    case "TOKEN_EXPIRED":
      // 触发重新认证流程（pb → PostBox → Swift → Keychain → 注入新 token）
      pb.auth.refreshToken();
      break;
    case "AGENT_BUSY":
      showToast("Agent 正在处理其他请求", "warning");
      break;
    case "RATE_LIMITED":
      showToast("请求过于频繁，请稍候", "warning");
      break;
    case "STREAM_INTERRUPTED":
      // 在消息上显示重试按钮
      markMessageRetryable(error.data?.messageId);
      break;
    default:
      showToast(error.message, "error");
  }
}
```

**oRPC middleware 统一错误包装：**

```typescript
// packages/santi/src/rpc/middleware/error.ts

const errorMiddleware = os.middleware(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    if (error instanceof ORPCError) throw error;

    // 包装意外错误
    console.error("[oRPC] Unhandled error:", error);
    throw createError("INTERNAL", "An unexpected error occurred");
  }
});
```

### 3.6 WebSocket 断线重连策略

WebSocket 连接可能因网络变化、休眠/唤醒或 Santi 重启而中断。重连策略需要透明地处理所有情况。

**客户端：`partysocket` 自动重连**

```typescript
// packages/web/src/lib/orpc-client.ts

import PartySocket from "partysocket";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/websocket";
import type { Router } from "@paperboy/shared/router";

const ws = new PartySocket({
  host: `localhost:${PORT}`,
  path: "/rpc",
  // 重连配置
  startClosed: false,
  minReconnectDelay: 500,
  maxReconnectDelay: 5000,
  reconnectDecay: 1.5,
  maxRetries: Infinity,
});

const link = new RPCLink({ websocket: ws });
export const client = createORPCClient<Router>(link);

// 连接状态用于 UI 反馈
ws.addEventListener("open", () => {
  useConnectionStore.getState().setConnected(true);
});

ws.addEventListener("close", () => {
  useConnectionStore.getState().setConnected(false);
});
```

**重连场景与恢复策略：**

| 场景                        | 检测方式                            | 恢复策略                                                                          |
| --------------------------- | ----------------------------------- | --------------------------------------------------------------------------------- |
| 短暂网络抖动                | WS `close` 事件，几秒内重连         | `partysocket` 自动重连；`live.updates` 通过 `lastEventId` 续传                    |
| Mac 休眠/唤醒               | WS `close`（休眠），`open`（唤醒）  | 同上；`lastEventId` 在 5 分钟保留窗口内恢复事件                                   |
| Santi 进程重启              | WS `close`，health check 失败后恢复 | `partysocket` 持续重试直到 Santi 恢复；客户端做全量刷新（session 列表、当前聊天） |
| 进行中的 `chat.stream` 中断 | Iterator 抛异常或不再 yield 事件    | UI 显示"流中断"+ 重试按钮；用户从最后一条消息重新发送                             |

**`live.updates` 断线恢复：**

```typescript
// 重连后，如果 Publisher 的保留窗口（5 分钟）覆盖了断线时长，
// lastEventId 无缝续传。如果断线超时：

ws.addEventListener("open", async () => {
  const connectionStore = useConnectionStore.getState();
  const disconnectDuration = Date.now() - connectionStore.lastDisconnectTime;

  if (disconnectDuration > 5 * 60 * 1000) {
    // 超出 Publisher 保留窗口 — 全量刷新
    await queryClient.invalidateQueries({ queryKey: ["session"] });
    await queryClient.invalidateQueries({ queryKey: ["project"] });
  }
  // 否则 lastEventId 自动处理
});
```

### 3.7 文件与二进制数据传输

文件操作（聊天附件、图片上传）尽量复用 WebSocket 连接。

**策略：WS 优先，大文件回退 HTTP**

| 文件大小 | 传输方式       | 机制                                                     |
| -------- | -------------- | -------------------------------------------------------- |
| ≤ 10 MB  | WebSocket      | oRPC `file.upload` procedure，binary 编码在 WS frame 中  |
| > 10 MB  | HTTP multipart | 标准 `fetch()` 到 `/api/file.upload`（OpenAPI endpoint） |
| 下载     | HTTP           | 直链：`/api/file.download?id=xxx`（支持 range request）  |

**上传 procedure：**

```typescript
// Server 端
const fileUploadProcedure = os
  .input(
    z.object({
      sessionId: z.string(),
      filename: z.string(),
      mimeType: z.string(),
      data: z.instanceof(Blob), // oRPC 支持 WS 上传 Blob/File
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
// Client 端 — 根据大小自动选择传输方式
export async function uploadFile(sessionId: string, file: File) {
  if (file.size <= 10 * 1024 * 1024) {
    // 小文件：走 WS（已连接，延迟更低）
    return client.file.upload({ sessionId, filename: file.name, mimeType: file.type, data: file });
  } else {
    // 大文件：走 HTTP multipart，可显示进度
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

注意：`window.*`、`notification.*`、`clipboard.*`、`permissions.*` 不经过 Santi。这些通过 PostBox（WKScriptMessageHandler）在 React 和 Swift 之间直接通信。

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

| Proto Service     | Method            | 新位置                          | 类型                           |
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
| `DaemonService`   | `GetPermissions`  | **PostBox** `permissions.query` | React → Swift 直连             |
| `PaperboyService` | `Notify`          | **PostBox** `notification.send` | React → Swift 直连             |

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

- **§3.3 Bridge 通信协议** — Protobuf 被 oRPC 替代；PostBox 重新定位为 WebView 的统一通信层（oRPC + native channels）
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
