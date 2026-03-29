# Phase 1：端到端链路验证

> 创建日期：2026-03-28
> 作者：Xinyao Chen
> 状态：草案（Draft）
> 关联文档：
>
> - [Paperboy 前端大重写方案](./paperboy-frontend-rewrite_zh-CN.md)
> - [通信协议重设计](./communication-protocol_zh-CN.md)
> - [可观测性系统设计](./observability-system-design_zh-CN.md)

## 一、目标

**证明 Swift → Santi → WKWebView → React → oRPC → 渲染 这条链路是通的。**

不做任何真实 UI（不做 Chat、不做 Sidebar、不做 Settings）。只做一个最小验证页面，调通 oRPC 的 request/response 和 streaming。

**完成标准：** macOS app 启动后，WKWebView 里显示一个 React 页面，页面通过 oRPC WebSocket 从 Santi 拿到数据并渲染，同时能跑通一个 streaming demo。

---

## 二、执行步骤

### Step 1：Santi 挂载 oRPC（Bun WS adapter）

**目标：** 在 Santi 现有 WS server 上加 oRPC RPCHandler，实现第一个 procedure。

**交付物：**

- `packages/santi/src/rpc/router.ts` — oRPC router 定义
- `packages/santi/src/rpc/procedures/system.ts` — `system.health` procedure
- Santi Bun server 同时挂载：
  - 旧 Protobuf WS（`/ws` path，不动）
  - 新 oRPC WS（`/rpc` path）
  - 新 OpenAPI HTTP（`/api/*` path）
- 验证：`curl http://localhost:PORT/api/system.health` 返回 JSON

**不做：** 不动任何现有业务逻辑，不改 Protobuf 路径。

**新增依赖：**

```json
{
  "@orpc/server": "latest",
  "@orpc/openapi": "latest",
  "zod": "latest"
}
```

**双协议共存方案：按 URL path 区分。**

- `/ws` → 旧 Protobuf WebSocket（现有 Swift client 继续用）
- `/rpc` → 新 oRPC WebSocket（React 用）
- `/api/*` → 新 oRPC OpenAPI HTTP（Swift 用）
- `/health` → 保持现有健康检查不变

### Step 2：packages/shared + packages/web 脚手架 + 调通 oRPC

**目标：** 创建共享类型包和 React SPA 项目，oRPC WebSocket client 连上 Santi，调通 `system.health`。

**Step 2a：packages/shared — 共享类型与契约**

`packages/shared` 存放 `packages/web` 和 `packages/santi` 之间共享的类型和常量。避免循环依赖，提供通信契约的单一事实来源。

**交付物：**

- `packages/shared/` — 纯 TypeScript，无运行时依赖
- `packages/shared/src/router.ts` — 重导出 `Router` 类型
- `packages/shared/src/errors.ts` — 错误码（见通信协议 §3.5）
- `packages/shared/src/postbox.ts` — PostBox 消息与事件类型定义（`PostBoxAction`、`NativeEvent`）
- `packages/shared/src/types/` — 共享业务类型（Session、Project、Message 等）
- `packages/web/src/lib/postbox/` — `PlatformAdapter` 接口、`WKWebViewAdapter`、adapter 自动检测
- `packages/web/src/lib/channels/native.ts` — 类型化的 native channel，包装 PostBox adapter
- `packages/web/src/lib/pb.ts` — 统一的 `pb.*` 入口（oRPC + native channel）

```json
// packages/shared/package.json
{
  "name": "@paperboy/shared",
  "type": "module",
  "exports": {
    "./*": "./src/*"
  },
  "devDependencies": {
    "typescript": "latest",
    "zod": "latest"
  }
}
```

`packages/web` 和 `packages/santi` 都在 dependencies 中加入 `"@paperboy/shared": "workspace:*"`。

**Step 2b：packages/web — React SPA**

**交付物：**

- `packages/web/` — React 19 + Vite+ + Tailwind v4 + shadcn + Zustand
- oRPC WebSocket client 配置（使用 `partysocket` 自动重连）
- 一个最小页面：显示 "Connected to Santi" + health check 结果

**技术栈（已确认）：**

| 层面        | 选择                                  |
| ----------- | ------------------------------------- |
| 框架        | React 19 + TypeScript                 |
| 构建        | Vite+（`vp` 命令）                    |
| CSS         | Tailwind CSS v4 + shadcn/ui           |
| 状态        | Zustand                               |
| 路由        | TanStack Router                       |
| 数据请求    | TanStack Query + @orpc/tanstack-query |
| oRPC Client | @orpc/client/websocket (RPCLink)      |
| WS 重连     | partysocket                           |

**oRPC Client 配置：**

```typescript
import PartySocket from "partysocket";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/websocket";
import type { Router } from "@paperboy/shared/router";

const ws = new PartySocket({
  host: `localhost:${PORT}`,
  path: "/rpc",
  minReconnectDelay: 500,
  maxReconnectDelay: 5000,
  reconnectDecay: 1.5,
});
const link = new RPCLink({ websocket: ws });
const client = createORPCClient<Router>(link);
```

**类型共享：** `packages/web` 从 `@paperboy/shared` 导入类型（pnpm workspace 引用）。`Router` 类型从 shared 重导出，web 不直接依赖 santi。

**开发环境：**

- Vite dev server (`:5173`) 跑 React SPA
- 在 Chrome 里开发（有 DevTools + HMR）
- WebSocket 连 Santi (`:7654/rpc`)
- 不在 WKWebView 里做日常开发
- Vite proxy 配置将 `/rpc` 和 `/api` 转发到 Santi，开发环境下无 CORS 问题：

```typescript
// packages/web/vite.config.ts
export default defineConfig({
  server: {
    proxy: {
      "/rpc": { target: "ws://localhost:7654", ws: true },
      "/api": { target: "http://localhost:7654" },
    },
  },
});
```

### Step 3：验证 Streaming

**目标：** 实现一个 demo streaming procedure，React 实时消费。

**交付物：**

- `chat.streamDemo` procedure — 每 100ms yield 一个 event（模拟 agent streaming）
- React 页面实时显示 streaming events
- 验证 Event Iterator over WebSocket 工作正常
- 验证断线恢复（lastEventId）

**不做：** 不接真实 agent engine，纯 mock 数据。

**Server 端 demo：**

```typescript
const chatStreamDemo = os
  .input(z.object({ message: z.string() }))
  .output(
    eventIterator(
      z.object({
        type: z.enum(["delta", "done"]),
        content: z.string(),
      }),
    ),
  )
  .handler(async function* ({ input }) {
    const words = input.message.split(" ");
    for (const word of words) {
      yield { type: "delta", content: word + " " };
      await new Promise((r) => setTimeout(r, 100));
    }
    yield { type: "done", content: "" };
  });
```

### Step 4：Swift Shell 最小化

**目标：** Swift app 能创建 WKWebView 加载 `localhost:PORT`。

**交付物：**

- 新的极简 Swift target 或现有工程瘦身
- `WindowManager` — 创建 NSWindow + WKWebView
- `ProcessManager` — 启动 Santi 子进程（复用现有 DaemonManager 逻辑）
- `PostBoxHandler` — 实现 `WKScriptMessageHandlerWithReply`，用于 React ↔ Swift 双向通信（完整设计见通信协议 §2.2）
- WKWebView 加载 `http://localhost:PORT`
- Swift 通过 URLSession 调 `/api/system.health`

**PostBox 集成要点：**

- `PostBoxHandler` 使用 `WKScriptMessageHandlerWithReply` 长轮询模式 — 不用 `callAsyncJavaScript`，不注入全局 JS 函数
- React → Swift：`postMessage({ type: "action", ... })` → Swift reply handler 回复
- Swift → React：`postMessage({ type: "listen" })` 挂起直到 Swift 调用 `emit()`，然后重新注册
- Phase 1 只需实现 `window.close` 和 `ping` action 验证管线
- 完整 action 集（`window.create`、`notification.send`、`clipboard.read` 等）在 Phase 2 逐步添加

**决策：瘦身 vs 新建？**

| 方案            | 优点                                 | 缺点                                                   |
| --------------- | ------------------------------------ | ------------------------------------------------------ |
| 瘦身现有工程    | 保留 DaemonManager/OS 采集等成熟逻辑 | 几千行 SwiftUI 代码要删，容易遗漏依赖                  |
| 新建极简 target | 从零开始，干净                       | 需要重新集成 DaemonManager、PermissionManager、OS 采集 |

**倾向瘦身** — DaemonManager 逻辑复杂（进程管理、crash recovery、health check），重写不值得。先不删 SwiftUI，让新 WebView 和旧 SwiftUI 并行存在。

**WKWebView 配置要点：**

- `Info.plist` 加 `NSAllowsLocalNetworking = true`（ATS）
- 多窗口共享同一个 `WKWebsiteDataStore`
- token 注入通过 `WKUserScript` 在页面加载前注入

**WKWebView 调试：**

- 启用 Safari Web Inspector：设置 `webView.isInspectable = true`（需要 macOS 13.3+ / iOS 16.4+，仅 debug 构建）
- Safari 中：开发菜单 → 选择 Mac → 选择 WKWebView 目标
- 完整访问 Elements、Console、Network、Sources 面板 — 和调试普通网页一样
- 生产构建中 `isInspectable` 应设为 `false`（或用 `#if DEBUG` 守护）

```swift
#if DEBUG
webView.isInspectable = true
#endif
```

### Step 5：端到端验证

**目标：** 完整启动链路跑通。

**验证 checklist：**

- [ ] Swift app 启动
- [ ] DaemonManager 启动 Santi 子进程
- [ ] Santi health check 通过
- [ ] WKWebView 创建并加载 `http://localhost:PORT`
- [ ] React SPA 渲染
- [ ] oRPC WebSocket 连接建立
- [ ] `system.health` 调用成功，结果显示在页面
- [ ] streaming demo 跑通，events 实时渲染
- [ ] PostBox action：React 调 `pb.window.ping()` → Swift 回复成功
- [ ] PostBox event：Swift 调 `postBoxHandler.emit("ping")` → React 接收并显示
- [ ] Swift 通过 `/api/agent.status` 拿到数据（模拟 Orb）
- [ ] 关闭 app → Santi 进程正常退出

---

## 三、风险与对策

### 3.1 双协议共存（Step 1）

**风险：** 旧 Protobuf WS 和新 oRPC WS 在同一个 Bun server 上共存。

**对策：** 按 URL path 区分。Bun `server.upgrade(req)` 可以根据 `req.url` 路由：

- `/ws` → 旧 Protobuf handler
- `/rpc` → 新 oRPC handler

Phase 4 清理时只需删掉 `/ws` 路径。

### 3.2 开发体验 / HMR / CORS（Step 2-3）

**风险：** WKWebView 里没有 HMR，开发效率低。Vite dev server (`:5173`) 连接 Santi (`:7654`) 存在跨域问题。

**对策：** 开发时在 Chrome 跑，WKWebView 只用于验证。

- Vite dev server (`:5173`) 提供 HMR
- Vite proxy 配置将 `/rpc`（WS）和 `/api`（HTTP）转发到 Santi (`:7654`)，开发环境下消除 CORS 问题
- WKWebView 内运行时同源（都来自 Santi 端口），无 CORS 问题
- Santi 的 OpenAPIHandler 也配有 `CORSPlugin` 作为安全网

### 3.3 类型共享（Step 2）

**风险：** `packages/web` 需要 import `Router` 类型。

**对策：** pnpm workspace 引用。`packages/web/package.json` 加：

```json
{
  "devDependencies": {
    "@paperboy/santi": "workspace:*"
  }
}
```

然后 `import type { Router } from '@paperboy/santi/rpc/router'`。

### 3.4 WKWebView 安全（Step 4）

**风险：** ATS 阻止 HTTP localhost、透明背景用 private API。

**对策：**

- ATS：`Info.plist` 加 `NSAllowsLocalNetworking = true`
- 透明背景：Inkwell 已经在用 `setValue(false, forKey: "drawsBackground")`，已验证可过审
- Cookie/Storage 隔离：多窗口用同一个 `WKWebsiteDataStore`

### 3.5 启动时序（Step 5）

**风险：** Santi 没 ready 时 WebView 就加载了，白屏。

**对策：** 复用 DaemonManager 现有的 `waitForSantiReady()` 逻辑——轮询 `/health` 直到返回 200，然后才创建 WebView。已有最多 30 秒超时 + 自动重试。

### 3.6 Orb 联动（暂不处理）

**风险：** Orb 和 Chat Window 之间的联动（点击 Orb → 打开 Chat）。

**对策：** 这个阶段不解决。Orb 保持现有 SwiftUI 逻辑不动。WebView Chat Window 作为独立窗口验证。联动是 Phase 2 的事。

---

## 四、时间估算

| Step     | 内容                                                    | 估算       |
| -------- | ------------------------------------------------------- | ---------- |
| 1        | Santi oRPC 挂载                                         | 1-2 天     |
| 2a       | packages/shared 脚手架（类型、错误码、PostBox 类型）    | 0.5 天     |
| 2b       | packages/web 脚手架 + 调通 health                       | 1 天       |
| 3        | Streaming 验证                                          | 1 天       |
| 4        | Swift Shell + WKWebView + PostBox 长轮询 handler + 调试 | 2-3 天     |
| 5        | 端到端联调                                              | 1-2 天     |
| **总计** |                                                         | **6-9 天** |

---

## 五、不在本阶段范围

以下工作不在 Phase 1，属于后续阶段：

- Chat UI 重建（Phase 2）
- Sidebar 重建（Phase 2）
- Settings 页面（Phase 2）
- 真实 agent streaming 接入（Phase 2）
- 删除 SwiftUI 代码（Phase 3）
- 删除 Protobuf（Phase 3）
- ohbug 接入（Phase 4）
- kly 接入（Phase 4）
- Orb ↔ Chat Window 联动（Phase 2）
