# DX：浏览器优先开发策略

> 创建日期：2026-03-29
> 作者：Xinyao Chen
> 状态：草案（Draft）
>
> **相关文档：**
>
> - [前端大重写方案](./paperboy-frontend-rewrite_zh-CN.md) — 本 DX 策略所依托的整体重写方案
> - [通信协议重新设计（oRPC）](./communication-protocol_zh-CN.md) — PostBox / oRPC bridge 设计，支撑 native 切换

本文档描述了 Paperboy 前端重写的「浏览器优先」开发体验策略。由于重写产出的是一个标准 React SPA、直连云端 API，整个 Agent UI 可以直接在普通浏览器中开发和测试——不需要 Xcode、不需要 Swift 编译、不需要模拟器。当 PostBox native 桥接和 Swift 薄壳准备就绪后，同一个 React SPA 在 WKWebView 里加载，代码零改动。涵盖两个开发阶段（纯浏览器 → native 切换）、环境检测、PostBox 适配器抽象以及 DX 收益对比。

## 一、核心洞察

既然前端重写产出的是一个标准 React SPA、直连云端 API，那**我们完全可以直接在浏览器里开发整个 Agent，作为纯 Web App 运行**。不需要 Xcode，不需要 Swift 编译，不需要模拟器——只需要一个浏览器标签页。

等 PostBox（Native ↔ WebView 通信桥）实现好、Swift 薄壳准备就绪后，**一键切入 native macOS 应用，UI 代码零改动**。同一个 React SPA 从浏览器标签页换到 `WKWebView` 里加载，就这么简单。

```
阶段 A：纯浏览器开发
┌─────────────────────────────────────────┐
│              浏览器标签页                 │
│                                         │
│  React SPA  ──── Cloud API ────  Cloud  │
│  (所有 UI)       (REST/WS)              │
│                                         │
│  ✅ 完整功能                             │
│  ✅ HMR、DevTools、React DevTools       │
│  ✅ 不需要 Xcode、Swift、等编译         │
└─────────────────────────────────────────┘

阶段 B：一键切入 native Mac 应用
┌─────────────────────────────────────────┐
│           macOS Native Shell            │
│  ┌───────────────────────────────────┐  │
│  │         WKWebView                 │  │
│  │                                   │  │
│  │  同一个 React SPA ── Cloud API   │  │
│  │  (代码零改动)                     │  │
│  └───────────────────────────────────┘  │
│                                         │
│  + PostBox bridge（系统级操作）          │
│  + OS 数据采集                          │
│  + 窗口管理 / Orb / 托盘               │
└─────────────────────────────────────────┘
```

## 二、为什么浏览器优先是正确的顺序

### 2.1 当前的 DX 差距

Paperboy 当前的 UI 开发循环：

```
编辑 SwiftUI 代码 → Xcode 编译 (10-30s) → 模拟器/真机 → 看到结果
```

重写后，浏览器优先的 DX：

```
编辑 React 代码 → Vite HMR (<100ms) → 在浏览器标签页里看到结果
```

| 维度         | SwiftUI（当前）         | 浏览器优先 React                            |
| ------------ | ----------------------- | ------------------------------------------- |
| 热更新       | Xcode Preview（不稳定） | Vite HMR（<100ms，稳定可靠）                |
| 调试工具     | Xcode + LLDB            | Chrome DevTools + React DevTools + 网络面板 |
| 构建时间     | 10-30s 增量编译         | ~0（HMR）                                   |
| 谁能参与开发 | 仅 Swift 开发者         | 全团队（React/TS）                          |
| CI 测试      | macOS runner + Xcode    | 任意 runner + 无头浏览器                    |
| 错误排查     | Console.app + Xcode     | 浏览器控制台 + ohbug + source maps          |

### 2.2 没有 Shell 一切也能跑

[云端驱动的三层模型](./paperboy-frontend-rewrite_zh-CN.md#31-云端驱动的三层模型) 已经确立了：

- **Source of Truth = 云端。** React SPA 直调云端 API。
- **Bridge 职责极小。** 只有系统级操作（窗口管理、通知、Orb、OS 采集）走 Swift bridge。
- **所有数据通过云端 API 流转。** 聊天消息、agent 状态、可观测性数据、设置——全部通过 REST/WebSocket。

这意味着 React SPA **在浏览器里就是完整可用的**。没有 native shell 缺少的只是 OS 级能力（无障碍数据采集、屏幕截图、按键、剪贴板监控、系统通知、Orb）。这些是增值能力，不是核心 UI 的前置条件。

### 2.3 开发并行化

浏览器优先解锁真正的并行开发：

```
团队 A：React SPA 开发               （浏览器，纯 Web）
         ↓ 在任意浏览器中运行
         ↓ 完整 UI + Chat + Sidebar + Settings + Workspace
         ↓ 连接云端 API

团队 B：PostBox + Swift shell         （Xcode，native）
         ↓ 窗口管理
         ↓ OS 数据采集
         ↓ bridge 协议

         ──── 两边就绪后合并 ────→  Native Mac 应用
```

没有阻塞依赖。团队 A 不需要团队 B 的 shell 就能开发、测试、演示 UI。团队 B 不需要 React SPA "做完"就能开发 bridge 协议。

## 三、PostBox 赋能了什么

PostBox 是 native Swift shell 和 WebView 之间的通信桥层。当我们准备切换到 native 应用时，PostBox 增加的能力：

| 能力               | 浏览器模式 | Native 模式（通过 PostBox） |
| ------------------ | :--------: | :-------------------------: |
| 核心 UI（Chat 等） |     ✅     |             ✅              |
| 云端 API 访问      |     ✅     |             ✅              |
| 可观测性（ohbug）  |     ✅     |             ✅              |
| 窗口管理           |     ❌     |             ✅              |
| 系统通知           |     ❌     |             ✅              |
| Orb / 菜单栏       |     ❌     |             ✅              |
| OS 数据采集        |     ❌     |             ✅              |
| Keychain token     |     ❌     |             ✅              |
| 文件拖拽           |     ❌     |             ✅              |
| 多窗口管理         |     ❌     |             ✅              |

切换是纯增量的。什么都不会坏——浏览器版本在 native 版本发布后仍然可以作为独立 web app 继续运行。

### 3.1 PostBox 抽象层

为了让这个切换无缝，React SPA 使用一层薄抽象：

```typescript
// 应用不知道（也不在意）自己跑在浏览器还是 WKWebView 里。
// PostBox 提供统一 API。

interface PlatformBridge {
  // 系统级操作 —— 在浏览器里是 no-op，在 native 里是真实调用
  window: {
    openNew(sessionId: string): void;
    close(): void;
    setTitle(title: string): void;
  };
  notifications: {
    show(title: string, body: string): void;
  };
  keychain: {
    getToken(): Promise<string | null>;
    setToken(token: string): Promise<void>;
  };
}

// 运行时自动检测
const bridge = isWebView()
  ? new NativePostBoxBridge() // 通过 WKScriptMessageHandler 真实通信
  : new BrowserFallbackBridge(); // no-op 或浏览器原生替代
```

在浏览器模式下，`window.openNew()` 可以打开一个新标签页；`notifications.show()` 可以使用 Web Notifications API。同样的代码，不同的行为——但核心应用不关心。

## 四、开发工作流

### 4.1 日常开发（浏览器）

```bash
# 启动开发服务器
pnpm dev

# 打开浏览器 → http://localhost:5173
# 编辑代码 → Vite HMR → 即时反馈
# 使用 Chrome DevTools 调试
# 使用 React DevTools 检查组件
# 使用 Network 面板调试 API
```

不需要 Xcode。不需要模拟器。不需要 Swift 编译。只需要一个浏览器和一个编辑器。

### 4.2 Native 测试（需要时）

```bash
# 构建 React SPA
pnpm build

# 打开 Xcode 工程 → 运行
# Swift shell 在 WKWebView 中加载构建产物
# 测试 native 特有功能（PostBox bridge、窗口管理、OS 数据采集）
```

Native 测试只在 PostBox 集成测试时需要，不用于 UI 开发。

### 4.3 CI/CD

```
PR 提交
  │
  ├── 浏览器测试（快，任意 runner）
  │   ├── vp check --fix
  │   ├── vp test（Vitest）
  │   └── Playwright E2E（无头浏览器）
  │
  ├── Native 测试（较慢，macOS runner）
  │   └── PostBox bridge 集成测试
  │
  └── 全部通过 → 允许合并
```

浏览器测试能捕获 95%+ 的问题。Native 测试只验证 bridge 行为。

## 五、纯 Web App 的产品视角

这里有一个更强的洞察：**浏览器版本不仅是开发便利——它本身就是一个真实的产品。**

不想安装 macOS 应用的用户可以直接在浏览器里使用 Paperboy。他们能获得除 OS 级功能之外的所有能力。对于很多使用场景（和 agent 对话、查看 workspace、管理设置），这已经 100% 够用了。

```
同一套代码的部署目标：

1. 浏览器（web app）       — 部署到任何 CDN，零安装
2. macOS（native app）     — Swift shell + WKWebView + PostBox
3. Windows/Linux（未来）   — Tauri / Electron shell
4. 移动端（未来）          — Capacitor / Tauri Mobile
```

一个 React SPA，四个部署目标，零 UI 代码重复。

## 六、风险与对策

| 风险                                         | 严重度 | 对策                                                                                                             |
| -------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------- |
| 浏览器版本"够用了" → native 版本优先级被降低 | 🟡 中  | Native 独有功能（OS 数据采集）是核心竞争壁垒。没有它们，Paperboy 只是又一个 chat UI。native 版本才是护城河所在。 |
| PostBox 抽象层增加复杂度                     | 🟢 低  | 抽象层很薄（约 100 行）。浏览器 fallback 很简单（no-op 或 Web API 替代）。                                       |
| 浏览器和 native 功能漂移                     | 🟡 中  | 严格规则：所有 UI 代码都在 React SPA 里。PostBox 只增加系统级能力。UI 功能永远不依赖 native-only API。           |
| "浏览器里正常，WKWebView 里坏了"             | 🟡 中  | E2E 测试在两个环境中都运行。WKWebView 的坑在 Phase 1 就尽早记录和测试。                                          |

## 七、总结

前端重写不仅仅是 React vs SwiftUI 的问题。它是关于**解锁最快的开发循环**：

1. **在浏览器里开发** — 最快的 HMR，最好的调试工具，全团队都能参与
2. **作为 web app 发布** — 零安装，到处能跑
3. **切入 native** — PostBox bridge 增加 OS 级超能力，UI 代码不变
4. **扩展到任意平台** — 同一个 SPA，不同的 shell

这就是基于 Web 平台构建的 DX 优势。浏览器既是开发环境，也是测试环境，还是一个部署目标——三位一体。
