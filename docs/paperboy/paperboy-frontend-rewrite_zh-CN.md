# Paperboy 前端大重写方案

> 创建日期：2026-03-28
> 作者：Xinyao Chen
> 状态：草案（Draft）
>
> **相关文档：**
>
> - [DX：浏览器优先开发策略](./dx-browser-first-development_zh-CN.md) — 纯浏览器开发 Agent，一键切入 native Mac 应用
> - [通信协议重新设计（oRPC）](./communication-protocol_zh-CN.md) — 用 oRPC 替换 Protobuf/PostBox 的详细设计
> - [可观测性系统设计](./observability-system-design_zh-CN.md) — 搭建 Paperboy 可观测性系统（ohbug + kly + OS 上下文）
> - [Phase 1：端到端验证](./phase1-e2e-verification_zh-CN.md) — Swift → Santi → WebView → React → oRPC 全链路验证
> - [Phase 2：核心 UI 重建](./phase2-core-ui-rebuild_zh-CN.md) — Chat、Sidebar、Settings、Workspace 重建细节
> - [Phase 3：切换 + 清理 + 可观测性](./phase3-switch-and-observability_zh-CN.md) — SwiftUI 删除、Protobuf 清理、ohbug+kly 集成

## 一、背景与动机

Paperboy 当前的前端是纯 SwiftUI 实现，刚刚完成了从 AppKit 到 SwiftUI 的全量迁移。但这个架构面临几个核心问题：

1. **团队技能栈错配** — 团队所有同学都擅长前端（React/TypeScript），但 Paperboy 的核心 UI 全是 SwiftUI。只有少数人能改核心界面，人效被架构绑死了。
2. **跨端不可能** — SwiftUI 锁死在 Apple 生态。未来想跑在浏览器、移动端，或者作为 web app 独立运行，完全做不到。
3. **可观测性盲区** — 纯 native 应用的错误追踪、session replay、自动化复原等能力，在 SwiftUI 上生态极弱。
4. **开发速度瓶颈** — React 的组件生态、热更新速度、调试工具链在 2026 年仍然是所有 UI 框架里最好的。

**核心决策：将 Paperboy 前端重写为 Web App（React），通过 WebView 嵌入 native shell，使同一套 UI 可以跑在任何地方 — 浏览器里、本地 native app（类似 Electron）、mobile，任何地方。**

### 已有验证

这不是从零开始的冒险。Inkwell panel（`packages/inkwell/`）已经是 React 19 + Vite + Zustand + Tailwind 跑在 WKWebView 里，通过 PostBox SDK 与 Swift shell 通信。Artifacts panel、文件预览器都在这个架构上运行且稳定。

---

## 二、四大支柱（原始设计思考）

### 1. React in everywhere（DX）

1. React 就是所有可视化领域下生态最好的
2. 任何端可以通过 webview 接入同一套 UI

### 2. 可观测性 + 可靠性

1. 任何报错可被查找到原因
   1. Error Stack
      1. 要能够跟进 stack 追踪到 commit / 行
   2. Session Replay
   3. 自动化复原错误场景（自动搭建可复原环境）
   4. 所有的能力应该在同一个 page 上追踪
2. 跟踪所有问题 + 每天展示可追踪的产品体验改进的进度
3. 提前预测缺陷可能出现的位置
4. 自动化
   1. 所有问题都应该自动生成文档 沉淀为可回溯的资料
   2. 打通所有工作平台 任何问题通过统一的入口进入观测平台（slack + linear + github + paperboy bot）收到问题以后自动处理

### 3. 速度

1. bun + viteplus
2. 最好的第三方 library
3. 最好的算法

### 4. UX

（详见第四节 4.4）

---

## 三、架构设计

### 3.1 云端驱动的三层模型

> 背景：杜哥正在将能力和数据迁移到云端。OS 层继续在客户端采集数据，但采集到的数据上报到云端。云端 Agent 依据上报后的数据进行处理。重写后的 App 大概率依赖云端数据。

```
┌──────────────────────────┐          ┌──────────────────────────────┐
│  macOS Client（瘦客户端）  │          │         Cloud                 │
│                           │          │                               │
│  ┌──────────────────────┐ │  upload  │  ┌─────────────────────────┐  │
│  │ OS 数据采集层 (Swift)  │─┼────────→│  │  数据存储                │  │
│  │ Accessibility / AX    │ │          │  │  OS 活动 / 屏幕截图 /    │  │
│  │ Screenshots           │ │          │  │  按键 / 剪贴板 / …       │  │
│  │ Keystrokes / Clipboard│ │          │  └──────────┬──────────────┘  │
│  └──────────────────────┘ │          │             │                  │
│                           │          │  ┌──────────▼──────────────┐  │
│  ┌──────────────────────┐ │          │  │  Cloud Agent             │  │
│  │ WebView (React SPA)   │ │   API    │  │  推理 / 执行 / 编排       │  │
│  │ 职责：所有可视化 UI    │←┼────────→│  └──────────┬──────────────┘  │
│  │ ┌──────┐ ┌─────────┐ │ │          │             │                  │
│  │ │ Chat │ │Workspace│ │ │          │  ┌──────────▼──────────────┐  │
│  │ │      │ │         │ │ │          │  │  API Layer               │  │
│  │ └──────┘ └─────────┘ │ │          │  │  REST / WebSocket / SSE  │  │
│  │ ┌────────────────┐   │ │          │  └─────────────────────────┘  │
│  │ │ Observability  │   │ │          │                               │
│  │ └────────────────┘   │ │          │  ohbug 错误存储 + 聚合        │
│  │                       │ │          │  kly 代码索引                 │
│  │ @ohbug/browser        │ │  upload  │  Almanac / Garden            │
│  │ (错误也上报到云端) ────┼─┼────────→│  OS 活动数据                  │
│  └──────────────────────┘ │          │                               │
│                           │          │  全部数据在云端汇聚：          │
│  ┌──────────────────────┐ │          │  error stack + OS 上下文       │
│  │ Native Shell (Swift)  │ │          │  = 比 session replay 更强的   │
│  │ 窗口 / 通知 / Orb     │ │          │    错误现场还原               │
│  └──────────────────────┘ │          └──────────────────────────────┘
└──────────────────────────┘

  浏览器 / 移动端 也可以直连 Cloud API（没有 OS 采集层，但 UI 完全一致）
```

**核心变化：数据和智能在云端，客户端是瘦终端。**

- **Source of Truth = 云端**。React SPA 直调云端 API，不通过 Swift bridge 中继数据。
- **Bridge 职责大幅缩小**：只负责系统级操作（窗口管理、通知、Orb、OS 采集启停），不负责数据传递。
- **多窗口同步自动解决**：所有 WebView 连同一个云端 → WebSocket/SSE 推送 → 全部窗口同步。
- **跨端真正可行**：浏览器/移动端直连同一个云端 API，唯一差别是 macOS 多了 OS 采集层。
- **ohbug + OS 数据在云端汇聚**：一个 error event 不仅有 stack trace，还有用户当时在干什么的完整上下文 — 比任何 session replay 都强。

**离线策略：**

- OS 数据采集层：离线继续采集，本地 buffer，联网后上传
- Chat：本地缓存消息，离线可读，联网后同步
- 其他功能：离线降级为只读（显示缓存数据）

### 3.2 Native/Web/Cloud 三方边界定义

**Native Shell（Swift，客户端常驻）：**

- OS 数据采集（Accessibility API、屏幕截图、按键、剪贴板）→ 上报到云端
- 系统级集成（macOS 通知、Menu Bar、Dynamic Island/Orb）
- 窗口管理（多窗口、"Open in New Window"、分屏）
- Keychain（auth token 存储，WebView 通过 bridge 获取）
- 离线 buffer（采集数据暂存，联网后上传）

**WebView React SPA（UI 层，所有可视化）：**

- Chat UI（消息列表、输入框、markdown 渲染、代码块）
- Workspace panel（artifacts、file preview、diff viewer）
- Sidebar（session 列表、spaces）
- Settings 页面
- Observability 面板（issues、metrics、session replay、alerts）
- Onboarding 流程
- @ohbug/browser 错误捕获（上报到云端）
- **直连云端 API，不通过 Swift bridge 获取数据**

**Cloud（数据 + 智能）：**

- 所有 OS 数据的存储和处理
- Agent 执行（推理、编排、工具调用）
- ohbug 错误接收、聚合、source map 反解
- kly 代码索引存储、dependency graph 查询
- Almanac / Garden
- API Layer（REST + WebSocket/SSE 推送实时更新）
- 统一入口（Slack + Linear + GitHub + Paperboy bot → 自动处理）

### 3.3 Bridge 通信协议（PostBox SDK）

> **详细文档：** [通信协议重新设计（oRPC）](./communication-protocol_zh-CN.md) — 涵盖完整的 oRPC router 设计、双适配器架构、chat streaming 实现、Publisher 多窗口同步、Protobuf 到 oRPC 迁移映射表、以及 localhost 安全方案。

Swift ↔ WebView 通信通过 `WKScriptMessageHandler`：

```
Swift → WebView:  WKWebView.evaluateJavaScript()
WebView → Swift:  window.webkit.messageHandlers.postbox.postMessage()
```

**云端架构下 bridge 职责大幅缩小：**

| 类别                         | 走 Bridge（Swift） |      走云端 API（直连）       |
| ---------------------------- | :----------------: | :---------------------------: |
| 聊天消息 / agent 状态        |                    |         ✅ WebSocket          |
| OS 活动数据                  |                    | ✅（由 Swift 采集层独立上报） |
| 窗口操作（新建/关闭/resize） |         ✅         |                               |
| 系统通知                     |         ✅         |                               |
| Keychain token 获取          |         ✅         |                               |
| Orb/Menu Bar 交互            |         ✅         |                               |
| 文件拖拽（系统级）           |         ✅         |                               |
| Observability 数据           |                    |              ✅               |
| Settings 读写                |                    |        ✅（云端同步）         |

Bridge 只处理**系统级操作**，所有**数据密集型通信**走云端 API。这从根本上消除了 bridge 性能瓶颈的担忧。

### 3.4 核心竞争优势：OS 级上下文 × 异常监控（只有 Paperboy 能做）

传统异常监控平台（Sentry / Datadog）只能看到浏览器内部的数据：Error Stack、DOM 快照（rrweb）、network requests。它们永远无法知道用户在报错前的操作系统级行为 — 从哪个 app 切过来的、剪贴板里粘贴了什么、当时屏幕上真正显示的是什么。

**Paperboy 的 OS 数据采集层 + ohbug 错误监控 + kly 代码索引，三者在云端汇聚，构成了一个任何竞品都无法复制的异常监控系统：**

| 数据维度            |   Sentry 能拿到   |                 Paperboy 能拿到                  |
| ------------------- | :---------------: | :----------------------------------------------: |
| Error Stack         |        ✅         |       ✅（ohbug + source map → commit/行）       |
| Session Replay      | ⚠️ rrweb DOM 模拟 |     ✅ **OS 级真实截屏**（不是模拟，是事实）     |
| 用户操作轨迹        |   ⚠️ 页面内点击   | ✅ **全 OS 操作**（鼠标/键盘/窗口切换/app 切换） |
| 剪贴板内容          |        ❌         |              ✅ 用户复制粘贴了什么               |
| 跨应用上下文        |        ❌         |            ✅ 用户从哪个 app 切过来的            |
| UI 状态树           |        ❌         |          ✅ Accessibility Tree 完整快照          |
| 代码结构 / 依赖图   |        ❌         |       ✅ kly file index + dependency graph       |
| git blame / PR 关联 |   ⚠️ 需手动配置   |                 ✅ kly 自动关联                  |

**具体场景示例：**

```
⏱ 15:42:01  用户在 Chrome 里复制了一段代码         ← OS: clipboard event
⏱ 15:42:03  用户切换到 Paperboy                    ← OS: window switch
⏱ 15:42:05  用户粘贴到 chat 输入框                 ← OS: keystroke ⌘V
⏱ 15:42:06  用户点击发送                           ← OS: mouse click
⏱ 15:42:07  [截屏] 用户看到的完整界面               ← OS: screenshot
⏱ 15:42:08  💥 TypeError: Cannot read 'content'    ← ohbug: error event
             at MessageList.tsx:142

             ┌─ kly enrichment:
             │  MessageList.tsx 3天前被 @yanan-li 改过 (PR #236)
             │  imports from: ChatStore (数据源)
             │  imported by: 5 个消费者
             └─
```

→ 不需要问用户"请描述你的操作步骤"。系统已经全部知道了。

**这个数据已经在采集。** OS 层现在就在收集 screenshots、keystrokes、clipboard、mouse events、accessibility snapshots。杜哥正在将这些数据迁移到云端。ohbug 的错误数据也上报到云端。**两条数据流汇聚在同一个云端，只需要用时间戳关联。**

**对笔记中每个需求的影响：**

| 需求               | 传统实现           | Paperboy OS 级实现                                                                          |
| ------------------ | ------------------ | ------------------------------------------------------------------------------------------- |
| Session Replay     | rrweb DOM 快照回放 | OS 级截屏 + 操作轨迹时间线（真实现场，不是模拟）                                            |
| 自动化复原错误场景 | 基于 DOM 录制回放  | 基于完整 OS 上下文自动还原（知道用户跨 app 行为）                                           |
| 自动生成文档       | 手动写 bug report  | 自动组装：error stack + 截图 + 操作时间线 + kly 代码上下文 = 完整 bug report                |
| 提前预测缺陷       | 静态代码分析       | 运行时模式识别（"每次用户从 Chrome 粘贴长文本后这个组件就崩" — 只有 OS 数据能发现这类模式） |

---

## 四、四大支柱详解

### 4.1 React in everywhere（DX）

> 原文：React 就是所有可视化领域下生态最好的。任何端可以通过 webview 接入同一套 UI。

**实现路径：**

- 统一 React SPA（Vite+ 构建），产出标准 HTML/JS/CSS
- macOS：Swift shell + WKWebView 加载 SPA
- 浏览器：直接部署为 web app
- 移动端：未来可套 Tauri Mobile / Capacitor / 自建 WebView shell
- 桌面跨平台：可套 Tauri / Electron 作为非 macOS 方案

**技术栈确认：**

| 层面                | 选择                                         | 备注                                           |
| ------------------- | -------------------------------------------- | ---------------------------------------------- |
| 框架                | React 19 + TypeScript                        |                                                |
| 构建                | Vite+（bun + viteplus）                      |                                                |
| CSS                 | Tailwind CSS v4 + shadcn/ui（xinyao preset） | Inkwell 已在用                                 |
| 状态管理            | Zustand                                      | Inkwell 已在用                                 |
| 数据请求            | TanStack Query                               |                                                |
| 路由                | TanStack Router                              |                                                |
| WebSocket           | 待定                                         | 原生 WebSocket API / Vercel AI SDK / socket.io |
| Markdown 渲染       | streamdown                                   | 已在 Paperboy node_modules 中                  |
| 代码块高亮          | Shiki                                        | Same 使用 shiki@3.4.2                          |
| 富文本输入框        | 参考 Manus Textarea 实现                     | `~/work/manus/.../components/Textarea.tsx`     |
| 虚拟列表            | virtua                                       | Manus 使用 virtua@0.40.0，轻量                 |
| 动画                | framer-motion                                |                                                |
| 图标                | Phosphor Icons                               | https://phosphoricons.com/                     |
| Toast               | shadcn (Inkwell 已有)                        |                                                |
| 右键菜单 / Dropdown | shadcn (Inkwell 已有)                        |                                                |
| 表单验证            | zod + react-hook-form                        | Settings 页面用                                |
| 拖拽                | 暂不需要                                     |                                                |
| 国际化              | 不需要                                       |                                                |

**各模块参考来源：**

| 模块            | 参考项目 | 参考路径                                                                                | 复用方式                 |
| --------------- | -------- | --------------------------------------------------------------------------------------- | ------------------------ |
| 消息列表        | Same     | `~/work/feat_ai-sdk-v5/same-next/src/components/chat/messages/` (8个文件)               | 参考实现                 |
| 消息列表        | Manus    | `~/work/manus/manus-next-agent-webapp/.../ChatBox/ChatMessages/`                        | 参考实现                 |
| TextArea 输入框 | Manus    | `~/work/manus/manus-next-agent-webapp/.../components/Textarea.tsx` (153行)              | 学习实现                 |
| TextArea 输入框 | Same     | `~/work/feat_ai-sdk-v5/same-next/.../chat/textarea/` (3576行，含 attach/context/upload) | 参考实现                 |
| 代码块          | Same     | `~/work/feat_ai-sdk-v5/same-next/src/components/ui/code-block.tsx` + Shiki              | 参考实现                 |
| Tool Call UI    | Same     | `~/work/feat_ai-sdk-v5/same-next/.../chat/tool-invocation/` (31个文件)                  | 参考实现                 |
| Tool Call UI    | 1Code    | `https://github.com/21st-dev/1Code`                                                     | 参考实现                 |
| Message Queue   | Same     | Same chat 模块中的 queue 相关逻辑                                                       | 直接参考                 |
| 附件预览        | Same     | `~/work/feat_ai-sdk-v5/same-next/.../chat/textarea/attach/`                             | **只参考样式，代码重写** |
| WebSocket 通信  | Manus    | `~/work/manus/manus-next-agent-webapp/.../controllers/useChatWebsocketController.tsx`   | 参考实现                 |
| Sidebar         | 待定     | Same `history.tsx` / `chats.tsx` 或 Manus sessions controller                           | 待决定                   |

**参考项目路径汇总：**

- Same: `~/work/feat_ai-sdk-v5/same-next/`
- Manus: `~/work/manus/manus-next-agent-webapp/`
- 1Code: `https://github.com/21st-dev/1Code`

**对团队的意义：** 所有人都能改核心 UI 了。不再受限于 SwiftUI 的学习曲线和人员稀缺。

### 4.2 可观测性 + 可靠性

> 原文全文保留如上第二节。以下为详细技术方案。

#### 4.2.1 任何报错可被查找到原因

##### Error Stack — 追踪到 commit / 行

> 原文：要能够跟进 stack 追踪到 commit / 行

**实现：**

1. **客户端捕获**：`@ohbug/browser` 已集成 `error-stack-parser`，自动捕获 uncaught error / unhandled rejection / fetch error / websocket error / ajax error / resource error 的完整 stack trace
2. **Source Map 反解**：生产构建生成 source map，上传到 ohbug server。收到 error stack 后，用 `source-map-trace`（ohbug-dashboard 已有依赖）反解到源码行号
3. **关联 commit**：
   - 构建时注入 `GIT_COMMIT_SHA` 到 bundle（Vite+ 环境变量）
   - ohbug event 上报时携带 commit hash
   - dashboard 展示时，Error Stack → 源码行 → `git blame` → 具体 commit + 作者
4. **现有代码复用**：
   - `ohbug/packages/ohbug-browser/src/capture/` — 完整的错误捕获 pipeline
   - `ohbug/packages/ohbug-browser/src/handle/` — 分类处理器（uncaught/fetch/ajax/websocket/resource/unknown）
   - `ohbug-dashboard/packages/web/components/event-detail-stack.tsx` — Stack 展示组件
   - `ohbug-dashboard/packages/web/components/stack-info.tsx` — Stack 信息解析组件

##### Session Replay

**实现：**

1. **录制**：集成 rrweb（ohbug-dashboard 已有 `issue-related-rrweb.tsx` 组件）
2. **存储**：rrweb 录制数据关联到 ohbug event，存入后端
3. **回放**：在 Observability 面板中嵌入 rrweb player，支持定位到报错时刻
4. **现有代码复用**：`ohbug-dashboard/packages/web/components/issue-related-rrweb.tsx`

##### 自动化复原错误场景（自动搭建可复原环境）

**实现思路：**

1. 报错时自动录制：error context + rrweb session + network logs + console logs
2. 打包为"复现包"（reproducible bundle）：包含所有复现所需状态
3. 一键搭建：CI/CD 环境中自动从"复现包"还原到报错时的精确状态
4. **长期目标**：AI agent 自动复原 → 自动定位 → 自动修复建议

##### 所有能力在同一个 page 上追踪

> 原文：所有的能力应该在同一个 page 上追踪

**实现：** 将 ohbug-dashboard 的核心页面整合为 Paperboy 内置的 Observability 面板（一个 tab/page）：

- Error Stack 追踪
- Session Replay 回放
- 错误趋势图（复用 `ohbug-dashboard/packages/web/components/charts/`）
- Issue 列表 + 详情
- Metrics 面板
- Alert 配置

**不再是独立应用，而是 Paperboy UI 的一部分。**

#### 4.2.2 跟踪所有问题 + 每天展示可追踪的产品体验改进的进度

**实现：**

1. 每日自动生成"产品健康报告"：
   - 新增/关闭 issue 数量
   - 错误率趋势（日/周对比）
   - 用户影响面（affected users count）
   - 性能指标变化（LCP/FID/CLS）
2. 展示为可追踪的进度条/图表，在 Observability 面板首页
3. 可选：推送到 Slack #daily-async

#### 4.2.3 提前预测缺陷可能出现的位置

**实现 — kly + ohbug 联动：**

1. `kly` 索引 Paperboy 代码仓库，构建 **dependency graph**（文件级依赖关系）
2. 当 ohbug 捕获某个文件的报错 → 通过 kly 查询 dependency graph → 标记所有依赖/被依赖的文件为「风险区域」
3. 在 Observability 面板展示「风险热力图」（Mermaid / 可视化）
4. **PR 级预测**：MiniChen 在 review PR 时，通过 kly MCP 查询变更文件的依赖图，自动标注可能受影响的模块
5. **历史模式识别**：基于 ohbug 历史数据，识别"高频出错模块"和"级联故障路径"

#### 4.2.4 自动化

##### 所有问题都应该自动生成文档 沉淀为可回溯的资料

**实现：**

1. ohbug 新建 issue → 自动生成标准文档：
   - 错误摘要
   - Error Stack（反解后）
   - 影响范围（用户数、发生频率）
   - 复现步骤（从 rrweb session 自动提取）
   - 关联 commit / PR
2. 文档格式：Markdown，存入 Notion / 本地知识库
3. 每个 issue 关闭时自动追加"修复记录"：修复 PR、根因分析、防止再次发生的措施

##### 打通所有工作平台 — 统一入口

> 原文：打通所有工作平台 任何问题通过统一的入口进入观测平台（slack + linear + github + paperboy bot）收到问题以后自动处理

**实现：**

```
任何来源的问题
    │
    ├── Slack #bugs 消息   ─┐
    ├── Linear issue        │
    ├── GitHub issue/PR     ├──→  统一入口（Santi API）──→ Observability 平台
    ├── Paperboy bot 对话   │                                    │
    └── ohbug 自动上报     ─┘                              自动处理 pipeline
                                                                 │
                                                    ┌────────────┼────────────┐
                                                    │            │            │
                                                 分类/去重    自动分配    自动文档生成
```

- 已有基础：MiniChen 已接入 Slack #bugs，能接收和处理 bug report
- 需要补充：Linear webhook + GitHub webhook → Santi API → 统一 issue 创建
- 自动处理：收到问题 → 自动关联 ohbug event（如果有）→ 自动分配优先级 → 自动通知责任人

#### 4.2.5 测试驱动开发（TDD）+ 自动化测试

**核心原则：Test-First。先写测试，再写实现。所有业务逻辑在代码实现前必须有对应的测试用例。**

##### TDD 工作流

```
Red → Green → Refactor → Repeat

1. 写一个会失败的测试（定义期望行为）
2. 写最少的代码让测试通过
3. 重构，保持测试绿色
4. 重复
```

每个新功能、每个 bug fix 都从测试开始。测试不是"写完代码补上去的"，测试是**设计工具** — 它迫使你在写代码前想清楚接口和行为。

##### 单元测试（Vitest）

| 层面                | 测试内容                                 | 覆盖率目标 |
| ------------------- | ---------------------------------------- | ---------- |
| Store 层（Zustand） | 状态变更、computed values、action 副作用 | > 95%      |
| 工具函数（utils）   | 纯函数、数据转换、格式化                 | 100%       |
| 自定义 Hooks        | 状态逻辑、副作用、生命周期               | > 90%      |
| API 层              | request/response 转换、错误处理、重试    | > 90%      |
| 组件逻辑            | 关键交互逻辑（非 snapshot 测试）         | > 80%      |

**测试原则：**

- 测试行为，不测试实现细节 — 重构不应该导致测试失败
- 每个 store action 至少一个 happy path + 一个 error path
- 所有数据转换函数必须覆盖边界条件（空数组、null、undefined、超长字符串）
- Mock 仅 mock 外部依赖（API、WebSocket、bridge），不 mock 内部模块

##### 端到端测试（Playwright）

覆盖关键用户路径：

| 用户路径      | 测试场景                                                    |
| ------------- | ----------------------------------------------------------- |
| Chat 核心流程 | 发送消息 → streaming 接收 → markdown 渲染 → 代码块高亮      |
| Sidebar 导航  | session 列表加载 → 切换 session → 搜索 → 创建新 session     |
| Settings      | 修改配置 → 保存 → 刷新后持久化 → 多窗口同步                 |
| Workspace     | 文件预览 → diff viewer → artifacts panel                    |
| 异常恢复      | 网络断开 → 重连 → 数据恢复；Santi 崩溃 → 自动重启 → UI 恢复 |
| 多窗口        | 窗口 A 操作 → 窗口 B 同步；新开窗口 → 状态一致              |

**E2E 测试策略：**

- 每个关键用户路径至少一条 E2E 测试
- 不测样式细节，只测功能正确性
- 使用 Page Object Model 组织测试代码，隔离页面结构变化
- CI 中每次 PR 运行核心路径测试，每日全量回归

##### 测试工具链

| 工具                      | 用途                | 备注                           |
| ------------------------- | ------------------- | ------------------------------ |
| Vitest                    | 单元测试 + 集成测试 | `vp test`，与 Vite 同 pipeline |
| @testing-library/react    | 组件测试            | 测试用户行为而非实现细节       |
| Playwright                | E2E 测试            | 跨浏览器 + WebView 测试        |
| MSW (Mock Service Worker) | API Mock            | 前后端解耦测试                 |
| @faker-js/faker           | 测试数据生成        | 避免硬编码测试数据             |

##### CI/CD 测试门禁

```
PR 提交
  │
  ├── vp check --fix        ← type check + lint + format
  ├── vp test               ← 单元测试 + 覆盖率检查
  ├── playwright (核心路径)  ← 关键 E2E 测试
  │
  └── 全部通过 → 允许合并
       └── 覆盖率下降 → 阻止合并

每日 (Scheduled CI)
  │
  └── playwright (全量)     ← 全部 E2E 回归
  └── 性能基准测试          ← 防止性能退化
```

#### 4.2.6 其他可靠性保障

##### TypeScript 严格模式 + 运行时校验

编译期 + 运行时双重保障，不信任任何外部输入：

- **编译期**：`strict: true` + `noUncheckedIndexedAccess: true`，让编译器拦住大部分类型问题
- **运行时**：zod schema 校验所有外部输入 — API 响应、WebSocket 消息、bridge 消息。不信任任何来自网络的数据
- **端到端类型安全**：oRPC 已实现 client/server 类型共享，API 合约变更在编译期就能发现

##### Error Boundary 分层降级

**不允许白屏。** 任何模块崩溃都应该降级，而不是拖垮整个应用：

```
┌─ 应用级 Error Boundary ──────────────────────────────┐
│                                                       │
│  ┌─ Chat 模块 Error Boundary ─┐  ┌─ Sidebar EB ─┐   │
│  │                             │  │               │   │
│  │  ┌─ 单条消息 EB ─┐         │  │  session 列表 │   │
│  │  │  消息渲染失败   │         │  │               │   │
│  │  │  → 显示 fallback│         │  └───────────────┘   │
│  │  │  → 不影响其他消息│         │                      │
│  │  └────────────────┘         │  ┌─ Workspace EB ┐   │
│  │                             │  │                │   │
│  └─────────────────────────────┘  └────────────────┘   │
│                                                       │
│  每一层 catch 到错误 → 自动上报 ohbug                   │
└───────────────────────────────────────────────────────┘
```

- **应用级**：整体 fallback + 自动 reload 选项
- **模块级**：Chat 挂了不影响 Sidebar，Workspace 挂了不影响 Chat
- **组件级**：单条消息渲染失败不影响其他消息
- 每一层都自动上报 ohbug，附带组件树路径

##### 健康检查 + 自愈机制

| 场景                            | 检测方式                               | 自愈策略                                         |
| ------------------------------- | -------------------------------------- | ------------------------------------------------ |
| Santi 进程崩溃                  | Swift 进程监控                         | 自动重启 + WebView 显示 fallback + ohbug 记录    |
| WebView content process 被 kill | `webViewWebContentProcessDidTerminate` | 自动 reload + Zustand persist 恢复状态           |
| 网络断开                        | WebSocket onclose / navigator.onLine   | 指数退避重连 + 本地缓存离线可读 + 重连后增量同步 |
| API 请求失败                    | TanStack Query retry                   | 自动重试（指数退避）+ 错误上报 + 用户提示        |
| 状态损坏                        | Zustand middleware 校验                | 检测到非法状态 → 重置为默认值 + 上报             |

##### 代码质量自动化

- **Pre-commit hooks**：`vp check --fix`（lint + format + type check），代码进仓库前就保证基本质量
- **PR 自动 review**：MiniChen 已有能力，自动检查代码风格、潜在 bug、依赖变更
- **Dependency audit**：定期扫描依赖安全漏洞（`pnpm audit`），CI 中自动化

##### 渐进式发布 + 自动回滚

- 新版本先推给少量用户（内部 → beta → 全量）
- ohbug 实时监控错误率 → 错误率超阈值自动回滚
- 结合 OS 数据可以精确判断"是不是新版本引入的问题"（用户行为模式没变但错误增加 → 代码问题）

### 4.3 速度

> 原文：bun + viteplus + / 最好的第三方 library / 最好的算法

**技术选型原则：**

| 层面   | 选择                  | 理由                                     |
| ------ | --------------------- | ---------------------------------------- |
| 包管理 | pnpm（由 Vite+ 包装） | monorepo 支持最好，workspace 协议        |
| 构建   | Vite+（vp 命令）      | bun 速度 + Vite 生态 + oxlint/oxfmt 统一 |
| 运行时 | bun                   | 原生 TS 执行，无需编译步骤               |
| 检查   | `vp check --fix`      | 一条命令：type check + lint + format     |
| 测试   | `vp test`（Vitest）   | 与 Vite 同一个 transform pipeline        |

**第三方库选型标准：**

1. **bundle size** — 能用 tree-shakable 的就不用 monolithic
2. **维护活跃度** — GitHub last commit < 3 月
3. **类型安全** — 原生 TypeScript 优先
4. **零依赖优先** — 能不引入子依赖就不引入

**算法优化方向：**

- 虚拟列表（chat 长消息列表）— `@tanstack/virtual` 或类似方案
- 增量 diff 渲染（streaming 场景）
- Web Worker 处理密集计算（source map 反解等）
- WASM 加速（可能用于 tree-sitter browser 端）

### 4.4 UX

**总原则：用户感觉不出来是 WebView。**

#### 已确认的决策

- **输入框**：使用富文本编辑器（ProseMirror/TipTap 等），体验更好。团队有丰富经验。
- **滚动**：团队有大量处理经验（auto-scroll、虚拟列表等），不是风险点。
- **暗色模式 / 字体 / 动画 / 拖拽 / 右键菜单**：都有成熟方案，可解决。

#### 🔴 需要重点关注：键盘快捷键路由

WebView 和 Swift 都在监听键盘事件，可能冲突。

**决策原则：稳定性优先。** 从哪里处理，看哪里能获得最好的稳定性——包括用起来的稳定性，也包括写代码过程当中的稳定性。能 WebView 处理的优先 WebView，但如果 WebView 处理不稳定，由 Swift 处理。

```
键盘快捷键路由表（初步）：

Swift 处理（系统级，必须可靠）：
  ⌘W    关闭窗口
  ⌘Q    退出应用
  ⌘M    最小化
  ⌘H    隐藏
  ⌘,    打开 Settings（Swift 创建窗口，内容是 WebView）

WebView 处理（业务级，React 内部路由）：
  ⌘N    新建 chat
  ⌘K    Command Palette
  ⌘/    快捷键帮助
  ⌘C/V  复制粘贴（WebView 原生支持）
  ⌘Z    撤销（WebView 输入框内）
  ⌘Enter 发送消息

需要验证的（可能冲突）：
  ⌘+/-  缩放 — 是否拦截？
  ⌘F    搜索 — WebView 内搜索 vs 系统搜索
  Tab   焦点切换 — WebView 内部 vs 跨区域
```

#### 🔴 需要重点关注：多窗口架构

**会同时打开很多个 Chat window，每个 Chat window 都是一个独立的 WebView。**

这引出几个 UX 层面的问题：

1. **状态一致性**：窗口 A 切换了 dark mode → 窗口 B 也要立刻变。字体大小、主题、用户偏好——所有 WebView 必须同步。
2. **窗口标识**：多个 chat 窗口同时打开，用户怎么区分？标题栏显示 session 名称？窗口颜色区分？
3. **焦点管理**：用户在窗口 A 的输入框打字，切到窗口 B → 焦点应该自动到 B 的输入框。WebView 的 focus 行为需要和 native 窗口激活事件联动。
4. **窗口记忆**：关闭 app 再打开，之前的多窗口布局（位置、大小、哪些 session 打开着）是否恢复？
5. **资源占用**：10 个 WebView = 10 个 React 实例 = 10 份内存。需要考虑上限。

**实现思路：**

- Swift `WindowManager` 管理所有 `NSWindow` + `WKWebView` 的创建/销毁/恢复
- 每个 WebView 启动时从 Santi API 获取最新状态（不依赖 WebView 之间的直接通信）
- 用户偏好变更通过 Santi WebSocket 广播到所有连接的 WebView
- 窗口布局信息持久化到本地（Swift `UserDefaults` 或文件）

#### UX 设计原则

| 原则                                   | 含义                                                                        |
| -------------------------------------- | --------------------------------------------------------------------------- |
| **"用户感觉不出来是 WebView"**         | 如果达到这个标准，UX 就成功了                                               |
| **稳定性优先**                         | 功能在 WebView 还是 Swift 实现，取决于哪里更稳定（使用稳定性 + 开发稳定性） |
| **系统字体 + 系统颜色 + 系统动画曲线** | 视觉上与 macOS 一致                                                         |
| **永远不出现 Web 痕迹**                | 无 loading spinner、无 404、无浏览器错误页                                  |
| **高频交互零延迟**                     | 打字、滚动、快捷键——不能有可感知的延迟                                      |

---

## 五、已有项目复用计划

### 5.1 ohbug（SDK monorepo）→ 可观测性基座

| Package          | 用途                                    | 复用方式         |
| ---------------- | --------------------------------------- | ---------------- |
| `@ohbug/core`    | 错误事件管理、扩展系统、上报 pipeline   | 直接 npm install |
| `@ohbug/browser` | 浏览器错误捕获（含 error-stack-parser） | 直接 npm install |
| `@ohbug/react`   | React Error Boundary + hooks            | 直接 npm install |
| `@ohbug/types`   | 共享类型定义                            | 直接 npm install |
| `@ohbug/utils`   | 工具函数                                | 直接 npm install |

**需要新增：**

- `@ohbug/webview` — WebView bridge 错误捕获插件（Swift↔WebView 通信错误、bridge 超时）
- rrweb 集成 package（从 ohbug-dashboard 提取）

### 5.2 ohbug-dashboard → 可观测性面板组件

| 模块                                 | 内容                  | 复用方式                          |
| ------------------------------------ | --------------------- | --------------------------------- |
| `components/issue-list.tsx`          | Issue 列表            | 迁移到新 React SPA                |
| `components/issue-detail-tabs.tsx`   | Issue 详情 tabs       | 迁移到新 React SPA                |
| `components/issue-related-rrweb.tsx` | Session Replay 播放器 | 迁移到新 React SPA                |
| `components/event-detail-stack.tsx`  | Error Stack 展示      | 迁移到新 React SPA                |
| `components/stack-info.tsx`          | Stack 信息解析        | 迁移到新 React SPA                |
| `components/charts/*`                | 错误趋势图、性能图    | 迁移到新 React SPA                |
| `components/alert-list.tsx`          | Alert 管理            | 迁移到新 React SPA                |
| `components/data-table/`             | 数据表格组件          | 迁移到新 React SPA                |
| `services/*`                         | API 请求层            | 重写，对接 Santi backend          |
| `packages/server/`                   | NestJS 后端           | 逐步替换为 Santi endpoint 或 oRPC |

**迁移路径：**

```
现在：  Next.js SSR + NestJS + Prisma/PostgreSQL
  ↓
目标：  Vite+ React SPA（嵌入 Paperboy）+ Santi backend
```

当前 `feature/shadcn` 分支的迁移工作继续进行，但目标从"独立应用"调整为"可嵌入的组件包"。

### 5.3 kly + ohbug — 一个系统的两面

> **详细文档：** [可观测性系统设计](./observability-system-design_zh-CN.md) — 涵盖 ohbug SDK/Dashboard 架构、kly 代码索引、`enrich_error_stack` 详细设计、OS 上下文集成、以及完整的可观测性系统搭建方案。

> kly 和 ohbug 是相辅相成的。kly 整理出来的文件级 index 可以和 error stack 相结合。

kly 是**静态视角**（代码结构、依赖关系、文件元数据），ohbug 是**运行时视角**（错误现场、用户行为、session）。Error Stack 是它们的**交汇点** — 一个文件名 + 行号，连接了两个世界。

#### 为什么它们必须是一个系统

**没有 kly 的 Error Stack（传统模式）：**

```
TypeError: Cannot read property 'content' of undefined
    at renderMessage (MessageList.tsx:142)
    at Array.map (<anonymous>)
    at ChatPanel (ChatPanel.tsx:87)
```

→ 你只知道 142 行炸了。然后人工翻代码、人工判断影响范围。

**kly + ohbug 结合后的 Error Stack（目标模式）：**

```
TypeError: Cannot read property 'content' of undefined
    at renderMessage (MessageList.tsx:142)

    ┌─ kly: MessageList.tsx
    │  描述: Chat 消息列表渲染组件，处理 streaming/markdown/attachment
    │  symbols: renderMessage(), useScrollPosition(), MessageBubble
    │  imports from: ChatStore, MessageTypes, MarkdownRenderer
    │  imported by: ChatPanel, WorkspaceChat, DetachedChatWindow (5个消费者)
    │
    │  风险传播路径: ChatPanel.tsx → WorkspaceRoot.tsx → App.tsx
    │  近30天此文件错误: 3次 (高频模块)
    │  最近修改: commit abc1234 by @yanan-li (3天前, PR #236)
    └─
```

→ 不仅知道**哪里炸了**，还知道**为什么可能炸**（谁最近改的）、**影响多大**（5个消费者会受影响）、**怎么修**（看 imports 就知道数据从哪来的）。

#### 结合方式

| kly 提供                | ohbug 提供           | 结合后的能力                                                                           |
| ----------------------- | -------------------- | -------------------------------------------------------------------------------------- |
| 文件描述 + symbols      | Error Stack 行号     | 报错位置的语义化解释（不只是行号，是"消息列表的渲染函数"）                             |
| dependency graph        | 报错文件             | 风险传播路径（这个报错会影响哪些其他模块）                                             |
| git history per file    | error event timeline | 因果关联（"这个文件3天前被改过 → 从那以后开始报错"）                                   |
| LLM 生成的文件元数据    | error context        | 自动生成人类可读的错误报告（不是给工程师看的 stack trace，是给所有人看的"发生了什么"） |
| 文件修改频率 + 依赖扇出 | 历史错误频率         | **缺陷预测热力图**：高修改频率 × 高依赖扇出 × 历史高错误率 = 风险区域                  |

#### 数据流

```
                    ┌─────────────────────────┐
                    │    Paperboy WebView      │
                    │                          │
                    │  @ohbug/browser          │
                    │  捕获 error + stack      │
                    └──────────┬───────────────┘
                               │ 上报 event
                               ▼
                    ┌──────────────────────────┐
                    │      Santi Backend       │
                    │                          │
                    │  1. source map 反解      │
                    │     → 源码文件名 + 行号   │
                    │                          │
                    │  2. 查询 kly index        │
                    │     → 文件描述            │
                    │     → symbols             │
                    │     → dependency graph    │
                    │     → git blame/history   │
                    │                          │
                    │  3. 生成 enriched report  │
                    │     → 语义化错误描述       │
                    │     → 风险传播路径         │
                    │     → 因果关联（最近改动）  │
                    │     → 修复建议            │
                    └──────────┬───────────────┘
                               │
                    ┌──────────┴───────────────┐
                    │  Observability 面板       │
                    │  ┌─────────────────────┐  │
                    │  │ Enriched Error View │  │
                    │  │ + 风险热力图         │  │
                    │  │ + 每日健康报告       │  │
                    │  └─────────────────────┘  │
                    └──────────────────────────┘
```

#### kly 能力明细

| 能力                        | 用途                                        | 接入方式                     |
| --------------------------- | ------------------------------------------- | ---------------------------- |
| tree-sitter AST 解析        | 精确了解文件结构（imports/exports/symbols） | kly MCP server               |
| dependency graph            | 风险传播预测、PR 影响分析                   | kly MCP `graph` 命令         |
| FTS5 搜索 + LLM rerank      | MiniChen PR review 时搜索代码库             | kly MCP `query` 命令         |
| git-aware incremental build | 每次 commit 自动更新索引                    | `kly hook install`           |
| LLM 文件元数据              | enriched error report 的语义化描述          | kly MCP `show` 命令          |
| MCP server                  | 所有 agent 统一接入                         | `kly mcp`（stdio transport） |

---

## 六、迁移策略——全量重建，不是渐进迁移

### 6.1 迁移的底层逻辑

**现在：** Swift 前端 ↔ Santi（三体，protobuf 通信）→ SwiftUI 渲染
**目标：** React 前端 ↔ Santi（直接 JSON/WebSocket）→ WebView 渲染

**这不是"迁移"，是用新技术栈重建前端。Santi 不动，只是换了它的消费者。**

核心决策：

- **整个应用上所有能看到的东西全部是 WebView** — Sidebar、Chat、Workspace、Settings 全部用 React 写。不会存在"SwiftUI Sidebar + React Chat"的混合状态。
- **完全删掉现有 SwiftUI 前端** — 不维护两套代码，不服务两个前端。
- **不再需要 Protobuf** — Santi 直接把最终数据通过 JSON/WebSocket 发给 React WebView。通信协议大幅简化。详见 [通信协议重新设计](./communication-protocol_zh-CN.md) 中的完整 oRPC 迁移方案。
- **Swift 只保留系统原生逻辑** — 权限处理、窗口管理、OS 数据采集、启动 Santi 子进程。

**关键架构决策：前端 + Santi 打包为一个 TypeScript 可执行文件，由 Swift 作为子进程启动。**

这意味着：

- Swift 侧代码量极少（窗口管理 + 权限 + OS 采集 + 进程管理）
- Swift 不再是黑盒 — 所有业务逻辑在 TypeScript 里，可直接用 ohbug 观测
- Santi 不再是独立 daemon — 它是 app 的一部分，生命周期跟 app 一致
- 没有"过渡态"——不存在两套 UI 共存的阶段

### 6.2 工程结构

```
paperboy/
├── native/                ← Swift 壳（极薄，可能不到 1000 行）
│   ├── App.swift
│   ├── WindowManager.swift
│   ├── OSCollector.swift       ← OS 数据采集（屏幕/AX/按键）
│   └── ProcessManager.swift    ← 启动/管理 Santi 子进程
│
├── packages/
│   ├── web/               ← React SPA（新前端）
│   │   ├── src/
│   │   ├── vite.config.ts
│   │   └── package.json
│   │
│   ├── santi/             ← Santi（TypeScript）
│   │   ├── src/
│   │   │   ├── server.ts       ← HTTP + WebSocket server
│   │   │   ├── api/            ← API 路由
│   │   │   └── static.ts       ← 生产环境 serve React SPA
│   │   └── (现有 Santi 代码)
│   │
│   └── shared/            ← 前后端共享类型
│       ├── api-types.ts
│       └── events.ts
│
└── package.json           ← monorepo root (pnpm workspace)
```

### 6.3 SPA 加载方式

**开发环境：** Vite dev server (:5173) + HMR，API 请求代理到 Santi (:3000)
**生产环境：** Santi 同时 serve 静态文件 + API + WebSocket，全部同一个 localhost 端口

```
┌───────────────────────────────────────────────────┐
│                Santi (localhost:PORT)               │
│                                                    │
│  GET /*           → serve React SPA 静态文件        │
│  GET /api/*       → API 路由                       │
│  WS  /ws          → WebSocket (streaming, 实时推送) │
└───────────────────────────────────────────────────┘
```

选择 localhost 而非 file:// 的原因：

- Santi 本身已经是 HTTP server，加 static serving 几乎零成本
- 前端 + API 同源 → 零 CORS 问题
- WebSocket 同源 → 无需额外配置
- file:// 下部分 Web API 行为不一致（Service Worker 等）

**Swift 启动流程：**

1. `ProcessManager.swift` → 启动 `bun dist/server/index.js`（Santi 子进程）
2. 等待 health check `GET /api/health` 返回 200
3. 创建 `NSWindow` + `WKWebView` → 加载 `http://localhost:PORT`

**打包产物：**

```
dist/
├── web/           ← React SPA 构建产物 (vp build)
│   ├── index.html
│   └── assets/
└── server/        ← Santi bundle (bun build)
    └── index.js
```

### 6.4 重建 Phases

#### Phase 0: 已有验证 ✅

- Inkwell panel：React 19 + Vite + Zustand + Tailwind 在 WKWebView 中稳定运行
- PostBox SDK：Swift ↔ WebView bridge 通信已验证
- Artifacts panel、file previewer 已在 WebView 架构上运行

#### Phase 1: 基础设施搭建

> **详细文档：** [Phase 1：端到端验证](./phase1-e2e-verification_zh-CN.md) — 逐步执行计划、双协议共存策略、React SPA 脚手架、streaming 验证、Swift shell 实现、以及完整验证清单。

- 搭建 monorepo 结构（native/ + packages/web + packages/santi + packages/shared）
- Santi 加入 HTTP static serving + WebSocket endpoint
- Santi 通信协议从 protobuf 切换到 JSON/WebSocket
- Swift 侧实现极薄 shell：`ProcessManager`（启动 Santi 子进程）+ `WindowManager`（WKWebView 窗口）
- 验证完整链路：Swift 启动 → Santi serve → WebView 加载 → React → API 通信

#### Phase 2: 核心 UI 重建

> **详细文档：** [Phase 2：核心 UI 重建](./phase2-core-ui-rebuild_zh-CN.md) — Spaces→Project 重新设计、Chat/Sidebar/Settings/Workspace 详细拆解、Santi proto 到 oRPC 迁移表、验收清单、以及风险分析。

**并行重建所有可视化模块**（不存在"先迁哪个"的问题——全部重建，一起上线）：

- **Chat UI**：消息列表 + 输入框 + message queue + streaming + markdown/代码块 + 附件预览
- **Sidebar**：Session 列表、Spaces、搜索
- **Workspace**：合并 Inkwell，artifacts panel、file previewer、diff viewer
- **Settings**：配置页面

注：React streaming chat 已被全行业验证（ChatGPT/Claude/Cursor/v0）。Sidebar + Settings 是纯 CRUD UI，React 实现远比 SwiftUI 简单。

#### Phase 3: 切换

> **详细文档：** [Phase 3：切换 + 清理 + 可观测性](./phase3-switch-and-observability_zh-CN.md) — SwiftUI 删除方案、Protobuf 清理文件清单、PostBox 保留原因、ohbug+kly 集成点、测试要求、以及整体时间线。

- 新 React 前端通过验收 checklist
- **一次性切换**：删除所有 SwiftUI View 代码、Swift 网络层、protobuf 定义
- Swift 只保留：窗口管理 + 权限 + OS 采集 + 子进程管理
- @ohbug/browser + @ohbug/react 接入
- kly MCP 接入

#### Phase 4: 可观测性上线

> **详细文档：** [Phase 3：切换 + 清理 + 可观测性 §3C–3D](./phase3-switch-and-observability_zh-CN.md) + [可观测性系统设计](./observability-system-design_zh-CN.md)

- ohbug-dashboard 组件迁入
- Error Stack → commit/行 + kly enrichment 链路打通
- OS 数据 + ohbug 数据在云端汇聚
- 统一入口（Slack + Linear + GitHub + Paperboy bot → Observability 平台）
- 每日产品健康报告自动生成

**Bug 处理策略：** 重建期间现有 SwiftUI 版本继续服务用户。严重 bug (P0/P1) 在旧代码修；不严重的搁置——这些 bug 在新 WebView 版本里很可能不存在。

---

## 七、风险与对策

### 7.1 重建过程中的风险

> 注：由于采用全量重建策略（非渐进迁移），不存在"两套 UI 共存"和"Santi 双 API"问题。

| 风险                       | 严重度  | 详情                                                                           | 对策                                                                         |
| -------------------------- | ------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| ~~两套 UI 共存互操作~~     | ~~N/A~~ | ~~不存在。整个前端一次性用 WebView 重建，不会有 SwiftUI + React 混合状态。~~   | —                                                                            |
| ~~Santi 双 API 负担~~      | ~~N/A~~ | ~~不存在。完全删掉 SwiftUI 前端后，Santi 只服务 React，protobuf 也不需要了。~~ | —                                                                            |
| 旧版 bug 处理判断          | 🟡 中   | 重建期间旧 SwiftUI 版本继续服务用户。严重 bug 修还是不修？                     | P0/P1 在旧代码修。P2+ 搁置——这些 bug 在新 WebView 版本里很可能不存在。       |
| Feature Parity 验收标准    | 🟡 中   | React 版本什么时候算"可以上线"？                                               | Phase 3 写明确的验收 checklist，checklist 全过才切换。                       |
| 重建期间产品无法迭代新功能 | 🟡 中   | 全量重建意味着团队精力集中在重建上，新功能暂停。                               | 重建周期控制在 4-6 周。期间只修 P0/P1。重建完成后新功能直接在 React 里开发。 |

### 7.2 迁移完成后的风险

| 风险                                  | 严重度 | 详情                                                                                                                                             | 对策                                                                                                                                |
| ------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| WKWebView content process 被系统 kill | 🔴 高  | macOS 内存压力下会 jetsam kill WKWebView content process → 整个 UI 白屏。Electron 不会（Chromium 独立进程），但 WKWebView 受系统内存管理。       | 实现 `webViewWebContentProcessDidTerminate` → 自动 reload。React 用 Zustand persist 保存关键状态。用户只感受到短暂闪烁，不丢数据。  |
| localhost 安全暴露                    | 🔴 高  | Santi 在 localhost:PORT 监听——本机任何应用都能连这个端口，可能读取用户数据或注入消息。                                                           | ① 启动时随机端口 ② Swift 生成 one-time token，WebView 请求时携带 ③ Santi 验证 token ④ 考虑 Unix socket 替代 TCP（只有本进程可访问） |
| 启动时间变长                          | 🔴 高  | 现在 Swift 启动秒级渲染。重写后：Swift → spawn Bun → Santi ready → health check → WebView 加载 → React hydrate → API → 渲染。可能 2-4 秒空窗口。 | ① Swift 先显示 native splash/loading 动画 ② Santi 预启动（launchd 登录项）③ React 用 skeleton screen 先展示骨架                     |
| Santi 进程崩溃 → UI 全挂              | 🔴 高  | Santi 崩了 → localhost 不可达 → WebView 白屏。现在 SwiftUI 同进程，不存在"后端挂了"。                                                            | Swift 监控 Santi 进程（process monitoring）→ 崩溃自动重启 → WebView 显示 fallback → ohbug 记录崩溃                                  |
| App 体积膨胀                          | 🟡 中  | 现在 ~30-50MB。加上 Bun runtime (~50-90MB) + Santi bundle + React SPA，可能到 ~100-150MB。                                                       | Bun runtime 是大头，关注 Bun 团队的 binary size 优化。或考虑用户预安装 Bun。                                                        |
| WebKit 版本不可控                     | 🟡 中  | WKWebView 用系统 WebKit。macOS 13 的 WebKit ≠ macOS 15。CSS/JS 行为可能不同。                                                                    | 确定最低 macOS 版本 → 对应 WebKit 版本。CI 跑多版本测试。用 feature detection。                                                     |
| Native feel 降级                      | 🟡 中  | 滚动条/文本选择/右键菜单/拖拽/IME/拼写检查/accent color — 每个单独不致命，但累积起来用户感觉"不太对"。                                           | 逐项建立对照表。优先处理高频交互（滚动、选择、快捷键）。低频交互可接受轻微差异。                                                    |
| 多进程资源占用                        | 🟡 中  | Swift + Bun/Santi + WKWebView content process + WKWebView networking process = 4-6 个进程。笔记本用户关心电池。                                  | 监控 CPU/内存基线。idle 时确保低功耗。考虑 Santi 在无活动时降频。                                                                   |
| 代码签名 / Notarization               | 🟡 中  | 打包 Bun binary 进 .app bundle，Apple notarization 可能标记为未知二进制。                                                                        | 提前跑完整 notarization 流程。确认 Bun binary 可被 codesign + notarize。                                                            |
| Chat streaming 性能                   | 🟢 低  | React 生态下所有 agent 产品都用 TS+React 实现 streaming chat，生态极其成熟。当前 SwiftUI 实现反而是劣势。                                        | —                                                                                                                                   |
| Bridge 性能瓶颈                       | 🟢 低  | 云端架构下 bridge 只处理系统级操作，不传数据。                                                                                                   | —                                                                                                                                   |

---

## 八、时间线（对齐 6/1 目标）

| 时间        | 里程碑                                           |
| ----------- | ------------------------------------------------ |
| 3/28 - 4/4  | Phase 1：Chat WebView prototype + benchmark      |
| 4/5 - 4/18  | Phase 2：Chat 全量迁移                           |
| 4/19 - 4/30 | Phase 3：Sidebar + Settings + Observability 首版 |
| 5/1 - 5/15  | Phase 4：Shell 最小化 + ohbug 全量接入           |
| 5/16 - 6/1  | Phase 5：可观测性全量 + 统一入口 + 打磨          |

---

## 九、附录

### A. 相关项目仓库

- `~/work/paperboy` — Paperboy macOS app（Swift/SwiftUI + Santi daemon）
- `~/work/ohbug` — 错误追踪 SDK monorepo（已迁移 Vite+）
- `~/work/ohbug-dashboard` — 错误追踪面板（`feature/shadcn` 分支迁移中）
- `~/work/kly` — 代码仓库文件级索引工具（已在 Vite+）

### B. 现有 WebView 架构参考

- `packages/inkwell/` — 已验证的 React + WKWebView 架构
- PostBox SDK — Swift↔WebView bridge 通信协议
- Liquid Glass 框架设计（2026-03-27）— 更通用的 Swift + WebView + Bun 架构概念

### C. 设计决策记录

| 决策     | 选择          | 替代方案                | 理由                                 |
| -------- | ------------- | ----------------------- | ------------------------------------ |
| UI 框架  | React         | SwiftUI / Flutter / Vue | 团队擅长 + 生态最好 + 跨端能力       |
| 构建工具 | Vite+（bun）  | Webpack / Turbopack     | 速度 + 统一工具链                    |
| 可观测性 | ohbug（自有） | Sentry / Datadog        | 完全可控 + 已有代码 + 零成本         |
| 代码索引 | kly（自有）   | CodeQL / Sourcegraph    | 轻量 + MCP 原生 + 已集成 tree-sitter |
| 迁移策略 | 增量          | 全量重写                | 风险可控 + 每步可回滚 + 产品不停滞   |
