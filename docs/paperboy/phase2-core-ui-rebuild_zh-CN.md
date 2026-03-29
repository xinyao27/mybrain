# Phase 2：核心 UI 重建与 SwiftUI → React 迁移清单

> 计划创建日期：2026-03-28 · 清单创建日期：2026-03-29 · 作者：Xinyao Chen · 状态：草案（Draft）  
> 前置条件：[Phase 1 端到端链路验证](./phase1-e2e-verification_zh-CN.md) 完成

**关联文档：**

- [Paperboy 前端大重写方案](./paperboy-frontend-rewrite_zh-CN.md)
- [通信协议重设计](./communication-protocol_zh-CN.md)
- English: [Phase 2: Core UI Rebuild & Migration](./phase2-core-ui-rebuild.md)

本文档在同一文件内包含 Phase 2 **产品/执行计划** 与 **SwiftUI → React 逐项迁移清单**（简体中文）。清单部分可直接跳转：[第二部份 · 迁移清单](#part-2-migration-checklist-zh)。

---

## 第一部份 — 核心 UI 重建

## 一、目标

**用 React 重建所有核心 UI，功能完全覆盖现有 SwiftUI 版本。**

Phase 1 证明了架构可行。Phase 2 是真正的建设阶段——把 SwiftUI 的 Chat、Sidebar、Settings、Workspace 全部用 React 重写，同时将 Santi 的 Protobuf services 迁移到 oRPC procedures。

**完成标准：** React 版本通过验收 checklist，可以替代 SwiftUI 版本给用户使用。

---

## 二、产品变更：Spaces → Project

### 2.1 概念重定义

原有的 "Spaces"（PRO-17）概念升级为 **"Project"**：

|          | Spaces（旧）       | Project（新）                   |
| -------- | ------------------ | ------------------------------- |
| 命名     | 抽象，用户需要学习 | 具象，用户一看就懂              |
| 含义     | 上下文容器         | 项目 = 一个工作主题下的所有对话 |
| 层级     | Space → Sessions   | Project → Sessions              |
| 用户心智 | "我在哪个 Space"   | "我在做哪个项目"                |

### 2.2 数据模型

```typescript
interface Project {
  id: string;
  name: string;
  icon?: string; // emoji 或自定义图标
  description?: string;
  context?: ProjectContext; // 项目级共享上下文
  createdAt: number;
  updatedAt: number;
  sortOrder: number; // sidebar 排序
}

interface ProjectContext {
  systemPrompt?: string; // 项目级 system prompt
  files?: string[]; // 项目关联文件路径
  connectors?: string[]; // 项目关联的 connector IDs
  metadata?: Record<string, unknown>;
}

interface Session {
  id: string;
  projectId: string; // 所属 Project
  title: string;
  createdAt: number;
  updatedAt: number;
  lastMessagePreview?: string;
}
```

**核心设计原则：**

- 每个 Session 必须属于一个 Project
- Project 的 context 被其下所有 Session 共享（context fixation）
- 新建 Session 时继承 Project 的 context
- 默认存在一个 "General" Project，未分类的 session 归入

### 2.3 oRPC Router — project 命名空间

```typescript
project: {
  list:     projectListProcedure,       // 列出所有项目
  get:      projectGetProcedure,        // 获取单个项目详情
  create:   projectCreateProcedure,     // 创建项目
  update:   projectUpdateProcedure,     // 更新项目（名称、图标、context）
  delete:   projectDeleteProcedure,     // 删除项目（sessions 移入 General）
  sessions: projectSessionsProcedure,   // 列出项目下的 sessions
  reorder:  projectReorderProcedure,    // 调整项目排序
}
```

### 2.4 Sidebar 结构

```
┌─────────────────────────┐
│  🔍 搜索                 │
├─────────────────────────┤
│  📁 Paperboy 重写        │  ← Project
│    ├── 通信协议讨论       │  ← Session
│    ├── Phase 1 规划       │  ← Session
│    └── + 新建对话         │
│                          │
│  📁 Ohbug 可观测性        │  ← Project
│    ├── Vite+ 迁移         │
│    └── kly 接入方案       │
│                          │
│  📁 General              │  ← 默认 Project
│    ├── 杂项对话 1         │
│    └── 杂项对话 2         │
├─────────────────────────┤
│  ⚙️ Settings             │
└─────────────────────────┘
```

**交互：**

- 点击 Project 名称 → 展开/折叠 sessions
- 右键 Project → 重命名 / 编辑 context / 删除
- 拖拽 Session → 移动到另一个 Project
- 新建 Session 时可选择归属哪个 Project

### 2.5 和 PRO-17 的关系

PRO-17（`feat/new-parallel-chat`）的核心设计延续：

- Context fixation at session creation → 改为 Project 级 context 共享
- Space grouping → Project grouping
- Sidebar 层级 → Project → Sessions

PRO-17 已有的 bug（session grouping、input focus lock、shared highlight state）在 React 重建中自然解决——不在旧 SwiftUI 代码上修。

**重要：重建期间不保留两套系统并行。SwiftUI 前端直接停止维护，全力建设 React 版本。** 这意味着重建期间产品不可用（或降级为旧版本冻结），但避免了双系统并行的状态冲突和维护成本。

---

## 三、执行顺序

### Phase 2A：Chat UI（核心路径）— 最高优先级

**目标：** 消息收发 + streaming 渲染完整可用。

**包含：**

- 消息列表（虚拟列表，virtua）
- 消息气泡（用户消息 / agent 消息 / system 消息）
- Markdown 渲染（streamdown）
- 代码块高亮（Shiki）
- Streaming 实时渲染（oRPC eventIterator over WS）
- Tool Call UI（审批按钮、执行状态、结果展示）
- Thinking block（折叠/展开）
- 输入框（富文本，参考 Manus Textarea）
- 附件预览 + 文件拖拽上传
- Message Queue（Cursor 风格的消息排队）
- 自动滚动（新消息时滚到底部，用户手动滚动时停止）

**Santi 侧同步迁移：**

- `proto/services/chat.ts` → `rpc/procedures/chat.ts`
- `proto/services/session.ts` → `rpc/procedures/session.ts`（Session CRUD）

**参考项目：**

| 模块         | 参考  | 路径                                                               |
| ------------ | ----- | ------------------------------------------------------------------ |
| 消息列表     | Same  | `~/work/feat_ai-sdk-v5/same-next/src/components/chat/messages/`    |
| 消息列表     | Manus | `~/work/manus/manus-next-agent-webapp/.../ChatBox/ChatMessages/`   |
| 输入框       | Manus | `~/work/manus/.../components/Textarea.tsx`                         |
| 输入框       | Same  | `~/work/feat_ai-sdk-v5/same-next/.../chat/textarea/`               |
| 代码块       | Same  | `~/work/feat_ai-sdk-v5/same-next/src/components/ui/code-block.tsx` |
| Tool Call UI | Same  | `~/work/feat_ai-sdk-v5/same-next/.../chat/tool-invocation/`        |
| Tool Call UI | 1Code | `https://github.com/21st-dev/1Code`                                |

### Phase 2B：Sidebar + Project 管理

**目标：** Project 层级的 sidebar，session 导航完整可用。

**包含：**

- Project 列表（展开/折叠）
- Session 列表（在 Project 下）
- 新建 Project / 新建 Session
- Project 上下文编辑（名称、图标、system prompt、关联文件）
- 搜索（跨 Project 搜索 sessions）
- 拖拽 Session 到不同 Project
- 右键菜单（重命名、删除、移动）
- 默认 "General" Project

**Santi 侧同步迁移：**

- 新增 `rpc/procedures/project.ts`
- 数据库 schema 加 `projects` 表 + `sessions.projectId` 外键

### Phase 2C：Settings

**目标：** 配置页面完整可用。

**包含：**

- 账户信息
- 模型选择 / API key 管理
- 外观设置（主题、字体）
- 快捷键配置
- Connector 管理
- 权限状态

**最简单的模块——纯表单 CRUD。**

### Phase 2D：Workspace（Inkwell 合并）

**目标：** 将现有 Inkwell React 代码合并到新 SPA。

**包含：**

- Artifacts panel（已有）
- File previewer（已有）
- Diff viewer
- 和 Chat 联动（agent 创建文件 → 右侧面板显示）

**优势：** Inkwell 已经是 React 代码，迁移成本最低——主要是目录重组和状态管理统一（PostBox → oRPC）。

---

## 四、Santi 侧迁移对照表

逐个将 `packages/santi/src/proto/services/` 的业务逻辑迁移到 oRPC procedures：

| Proto Service 文件                      | oRPC Procedure                      | Phase   |
| --------------------------------------- | ----------------------------------- | ------- |
| `proto/services/chat.ts`                | `rpc/procedures/chat.ts`            | 2A      |
| `proto/services/session.ts`             | `rpc/procedures/session.ts`         | 2A      |
| `proto/services/session-broadcaster.ts` | `rpc/procedures/session.ts`（合并） | 2A      |
| `proto/services/agent.ts`               | `rpc/procedures/agent.ts`           | 2A      |
| `proto/services/general-agent.ts`       | `rpc/procedures/agent.ts`（合并）   | 2A      |
| `proto/services/task.ts`                | `rpc/procedures/task.ts`            | 2A      |
| `proto/services/daemon.ts`              | `rpc/procedures/system.ts`          | 2A      |
| `proto/services/paperboy.ts`            | `rpc/procedures/notification.ts`    | 2C      |
| `proto/services/bug-report.ts`          | `rpc/procedures/observability.ts`   | Phase 4 |
| —（新增）                               | `rpc/procedures/project.ts`         | 2B      |

**迁移原则：** 提取业务逻辑，剥离 Protobuf 序列化代码，用 zod schema 定义 input/output。

---

## 五、验收 Checklist

Phase 2 结束时必须满足：

### Chat（2A）

- [ ] 能发送消息并收到 agent streaming 回复
- [ ] Markdown 渲染正确（标题、列表、链接、加粗斜体）
- [ ] 代码块有语法高亮 + 复制按钮
- [ ] Tool Call 有审批 UI，审批后显示结果
- [ ] Thinking block 可折叠/展开
- [ ] 附件可拖拽上传，显示预览
- [ ] Message Queue 可排队、编辑、取消
- [ ] 自动滚动行为正确（新消息滚底，手动滚动时停止）
- [ ] Streaming 中断后可恢复（lastEventId）

### Sidebar + Project（2B）

- [ ] 显示 Project → Sessions 层级
- [ ] 可新建 / 重命名 / 删除 Project
- [ ] 可新建 Session 并指定归属 Project
- [ ] 可拖拽 Session 到不同 Project
- [ ] 搜索能跨 Project 找到 sessions
- [ ] 默认 General Project 存在且不可删除
- [ ] Project context 可编辑（system prompt、关联文件）

### Settings（2C）

- [ ] 所有配置项可读取和修改
- [ ] 修改后立即生效（通过 Publisher 广播到所有窗口）

### Workspace（2D）

- [ ] Artifacts 在右侧面板正确显示
- [ ] 文件预览器支持 markdown / 代码 / 图片
- [ ] Agent 创建文件后右侧面板自动更新

### 整体

- [ ] 多窗口状态同步（Publisher）
- [ ] 快捷键工作（Cmd+N 新建、Cmd+K Command Palette）
- [ ] 性能：消息列表 1000 条消息无卡顿（虚拟列表）
- [ ] 性能：Streaming 30fps 无掉帧

---

## 六、时间估算

| Phase    | 内容                                    | 估算       |
| -------- | --------------------------------------- | ---------- |
| 2A       | Chat UI + Santi chat/session/agent 迁移 | 2-3 周     |
| 2B       | Sidebar + Project + DB schema           | 1-2 周     |
| 2C       | Settings                                | 3-5 天     |
| 2D       | Workspace（Inkwell 合并）               | 3-5 天     |
| **总计** |                                         | **5-7 周** |

---

## 七、风险

### 7.1 Proto Services 迁移不是简单包装

**风险：** 现有 proto services 和 Protobuf 类型、Envelope transport、event bus 深度耦合。不能简单"外面包一层 oRPC"，需要真正理解每个 service 的业务逻辑然后重写。特别是 `chat.ts` 和 `session-broadcaster.ts`，里面有大量状态管理（消息组装、fragment 合并、tool call 追踪）。

**对策：** 迁移每个 service 前，先读源码画出数据流，确认哪些是业务逻辑、哪些是 Protobuf 序列化胶水代码。业务逻辑提取为纯函数，再包装为 oRPC handler。

### 7.2 ChatStore 状态机复杂度

**风险：** Swift 侧 ChatStore 做了大量工作：30fps streaming throttle、消息历史分页、disk cache、tool approval 状态追踪、auto-scroll 控制。这些逻辑要在 React + Zustand 里重新实现，遗漏任何一项都会导致功能缺失。

**对策：** 迁移前列一个 ChatStore 功能清单（从 Swift 源码逐方法提取），逐项确认 React 侧有对应实现。

### 7.3 Chat Streaming 性能

**风险：** React 渲染 streaming markdown 可能不如 SwiftUI 原生流畅。

**对策：**

- streamdown 专为 streaming markdown 设计，已被行业验证
- virtua 虚拟列表控制 DOM 节点数
- 设定量化标准：delta under 15% vs SwiftUI baseline（沿用现有性能标准）

### 7.4 认证流程改造

**风险：** OAuth callback 现在走 `paperboy://` URL scheme → Swift AuthManager。重写后 React 在 WebView 里，回调怎么传回来？

**对策：** 路径为 `paperboy://` URL scheme → Swift 接收 → oRPC 通知 Santi → Publisher 广播给 React。Phase 2A 早期验证完整流程。

### 7.5 文件系统访问

**风险：** WebView 不能直接读本地文件。Chat 附件预览、文件拖拽上传、workspace 文件展示全部需要通过 Santi API 中转。

**对策：** 新增 oRPC procedures：

- `file.read` — Santi 读文件返回内容
- `file.upload` — 接收 multipart upload
- oRPC 原生支持 File Upload/Download

### 7.6 WebView "不像 native" 的长尾问题

**风险：** 每一个单独不致命，但累积起来用户感觉"不太对"：文本选择行为、剪贴板互操作、系统字体渲染、accent color、拖拽体验、中文输入法候选框位置。

**对策：** Phase 2A 做 Chat 时就建一个 **"native feel 对照表"**，逐项记录 WebView 和原生的差异，分级处理：

- 🔴 必须修复（影响核心交互：输入、复制粘贴、滚动）
- 🟡 尽量修复（影响体验：字体、颜色、动画曲线）
- 🟢 可接受差异（低频操作的细微差别）

### 7.7 Project 数据迁移

**风险：** 现有 sessions 没有 projectId，需要迁移。

**对策：** 所有现有 sessions 归入默认 "General" Project。迁移脚本在 Santi 启动时自动执行，带事务回滚，一次性操作。迁移失败不影响 app 启动（fallback 为无 Project 的 flat list）。

### 7.8 快捷键冲突

**风险：** WebView 和 Swift 都监听键盘事件。

**对策：** 重写文档已定义路由表——系统级（Cmd+Q/W/M/H/,）走 Swift，业务级（Cmd+N/K/Enter）走 WebView。Phase 2A 时验证并固化。

### 7.9 输入法（IME）

**风险：** PRO-25（Chinese IME not working in Paperboy）在 WKWebView 里可能依然存在。

**对策：** WKWebView 的 IME 支持通常比 SwiftUI 更好（Web 标准 IME 处理）。Phase 2A 早期验证，如有问题提前处理。

### 7.10 多窗口状态一致性

**风险：** 新架构用 MemoryPublisher 广播替代进程内单例 ChatStore。快速开关窗口、同时多窗口操作时可能短暂不一致，WS 断线重连期间可能丢消息。

**对策：** 用 lastEventId 做断线恢复，Publisher 开启 `resumeRetentionSeconds: 300`（5分钟缓冲）。关键操作（session 创建/删除）做乐观更新 + 服务端确认。

---

<a id="part-2-migration-checklist-zh"></a>

## 第二部份 — SwiftUI → React 逐项迁移清单

> **说明：** 执行级补充：列出需在 React / WebView 中重写的 SwiftUI 界面、数据流与交互。

**源码位置：** Paperboy macOS 应用不在本仓库；SwiftUI 位于 Paperboy monorepo 的 `packages/paperboy/Paperboy/`（本地克隆常见路径：`~/work/paperboy`）。

## 与 Phase 2 文档的对应关系

| 工作项            | 本文档章节                              |
| ----------------- | --------------------------------------- |
| Sidebar 迁移      | 第二节 Sidebar                          |
| Message List 迁移 | 第三节 Chat 消息列表                    |
| Scroll 行为迁移   | 第三节内 3.5–3.6（滚底与历史 prefetch） |
| Input 迁移        | 第四节 Chat Input                       |
| Tool Call UI 迁移 | 第五节 Tool Call UI                     |
| 其他组件迁移      | 第六至十节                              |
| 设计系统迁移      | 第十二节 设计系统                       |
| PostBox 桥接      | 第十四节 原生桥接                       |
| Settings 迁移     | 第十一节 Settings                       |

---

## 一、整体布局层级（Layout Hierarchy）

### 1.1 当前 SwiftUI 层级

源码入口：`packages/paperboy/Paperboy/Views/Chat/ChatContentRootView.swift`

```
ChatWindowRootView (glass background, debug overlay)
  └─ ChatContentRootView (@ObservedObject model: ChatContentModel)
       ├─ HStack
       │   ├─ SidebarLayer (ChatSidebarRootView, fixed width, divider)
       │   └─ ChatConversationPaneView
       │        ├─ ChatPanelToolbarView (drag, app icon, sidebar toggle, new chat, collapse)
       │        └─ ChatConversationBodyView
       │             ├─ contentArea (empty / loading / MessageListView)
       │             ├─ ChatAskUserCard (conditional)
       │             ├─ AppMessageQueueView (conditional)
       │             └─ ChatInputRootView
       ├─ Drop target overlay (isDropTargeted)
       └─ AttachmentPreviewPopover (modal overlay)
```

### 1.2 React 迁移

- Root layout：`flex` 横向，sidebar + 主内容区。
- Sidebar 固定宽度 `IslandSize.ChatPanel.sidebarWidth`（约 220px）；`ChatWindowLayoutModel.resolvedSidebarWidth` 控制展开/折叠与动画（Swift：`withAnimation(.easeInOut(duration: 0.22))`）；React 用 CSS transition。

---

## 二、Sidebar（侧边栏）

源码：`packages/paperboy/Paperboy/Views/Chat/ChatSidebarHost.swift`

### 2.1 数据模型

- `ChatSidebarHost`：`sessions`、`activeSessionId`、`hasMore`、`isLoadingMore`、`isLoading`、`searchQuery`、`sections`、`renamingSessionId`、`renameDraftTitle` 等。

### 2.2 数据获取

- Host 不直接请求网络；由上层 `setSessions` 注入。React：oRPC `session.list` + TanStack Query；分页：`useInfiniteQuery` 或 cursor。

### 2.3 TimeBucket 分组

Today / Yesterday / This Week / This Month / Older；`activeSessionId == nil && !isSearching` 时在 Today 插入「New chat」占位行。React：`useMemo` 重建 sections。

### 2.4 搜索

本地过滤 `searchableText`；`sanitizeSystemContextPrefix` 剥离 `<system_context>...</system_context>`。

### 2.5 SessionRow 交互

选择、右键菜单（Rename / Archive / Open in New Window 等）、悬停时间与 `...` 菜单、内联重命名、轻量 Markdown 标题、滚动清除 hover、底部 sentinel 触发 load more。

### 2.6 视觉

`NSVisualEffectView` sidebar material → Web 用 `backdrop-filter` 或半透明纯色近似。

### 2.7 Footer

Settings 行 → PostBox 打开设置窗口或 SPA 内路由。

---

## 三、Chat 消息列表（Message List）

源码：`MessageListView.swift`、`ChatMessageListState.swift`、`MessageListHost.swift`

### 3.1 ChatRowModel

`id`、`messageId`、`role`、`kind`、`layoutHints`、`layoutKey`、`contentVersion`、`displayPayloadKey`。

### 3.2 ChatRowKind 对照表

| Kind                 | SwiftUI             | React                 |
| -------------------- | ------------------- | --------------------- |
| dateSeparator        | 横线 + 日期         | `<DateSeparator>`     |
| userText             | 右对齐气泡          | `<UserBubble>`        |
| assistantMarkdown    | MarkdownView        | streamdown + Shiki    |
| image(Data)          | ChatImageRow        | `<img>`               |
| lazyImage            | getBlob             | oRPC blob + lazy load |
| document             | ChatDocumentRow     | `<DocumentCard>`      |
| attachmentGroup      | AttachmentGroupView | `<AttachmentGroup>`   |
| toolGroup            | ToolCallGroupView   | `<ToolCallGroup>`     |
| subagentCard         | SubagentCardView    | `<SubagentCard>`      |
| streamingStatus      | shimmer             | CSS shimmer           |
| compactingStatus     | 文案                | `<StatusText>`        |
| compactedMarker      | 横线文案            | `<CompactedMarker>`   |
| toolUse / toolResult | EmptyView           | 跳过                  |

### 3.3 间距策略

`ChatTranscriptSpacingPolicy`：角色切换大/小间距、同角色 `xs`、toolGroup→markdown `xs`；`topPaddingByRowId` → CSS margin/gap。

### 3.4 虚拟列表 / 性能

SwiftUI **不用** `LazyVStack`（与 NSHostingView 反馈循环）；用 `VStack` 全量布局 + 观测隔离、固定内容宽、增量 padding、CodeBlock VM 复用。React：**virtua** 虚拟列表。

### 3.5 Scroll to Bottom 逻辑

状态：`isNearBottom`、`followStreamingOutput`、`sessionOpenAutoFollow`、`nearTopPrefetchArmed`。协调器：`pendingScroll`、容差 20px、prefetch 顶部 240px。

规则摘要：新消息且贴底则跟随；streaming 且 `followStreamingOutput` 则滚底；用户上滑 → `userDidScrollAway` 停止跟随；回底恢复；换 session 自动跟随（可取消）；历史 prepend **不**打断视口；planning/status 按 `shouldAutoScrollForLatestChange` 处理。

Near-bottom：macOS 15+ `onScrollGeometryChange`；旧版 bottom sentinel。React：virtua `onScroll` / `IntersectionObserver` + Zustand 存 `followStreamingOutput`。

### 3.6 向上加载历史

Top sentinel → 触发后 disarm，滚远后 rearm；`isPurePrepend` 时保持滚动位置。React：virtua + scroll restore。

### 3.7 Markdown / 代码块

`AssistantMarkdownContent`、`AssistantRenderPackage`、`ChatMarkdownWidthClass`、`CachedAssistantMarkdownRenderer`；代码块 `CodeBlockView` / `DiffCodeBlockView` / `PBCodeBlockHostingView` → streamdown + Shiki + diff 组件。

---

## 四、Chat Input（输入框）

源码：`ChatInputRootView.swift`、`ChatInputModel.swift`

### 4.1 模型要点

`text`、`attachments`、`presentation`、`editMode`（含 queue 编辑）、`voiceState`、`manualEditorHeight` 等。

### 4.2 TextEditor

自适应高度（CTFont 测量、最多 10 行、行高 18）；顶部拖拽改高（最大 360）。React：textarea auto-resize（参考 Manus）。

### 4.3 快捷键

Return 发送、Shift+Return 换行、Escape 取消录音、粘贴文件/图片、Control+Paste。React：`onKeyDown`。

### 4.4 主按钮状态机

队列编辑 / 录音中 Stop（pulse）/ 转写中 / 生成中 Stop / 可发送 Send / 空且可用 Mic / 默认禁用 Send。

### 4.5 附件

`NSOpenPanel`、类型白名单、数量与总大小校验、去重、`AttachmentPreviewStrip`、drop。React：file input + paste + drag；上传走 oRPC `file.upload`。

### 4.6 语音

Push-to-talk 状态机 → PostBox 或 Web Audio。

### 4.7 Message Queue

`AppMessageQueueView` + `MessageQueueStore`：折叠、编辑/立即发送/删除、最高 240px 滚动。React：Zustand + `<MessageQueue>`。

---

## 五、Tool Call UI

源码：`ToolBlock/ToolCallGroupView.swift`、`ToolCallExpandedContent.swift`

- 单步直显；多步「N steps」折叠；待审批 / Running Thinking 自动展开；单步 accordion。
- Step 标题：`ToolCallTitlePresentation`（Bash、文件、Task、WebFetch、MCP 等）。
- 展开区：Edit/Write diff、Bash code block、WebFetch markdown、Glob/Grep 列表、LoadSkill、Thinking streaming、MCP JSON、strip 结果懒加载 `getToolResult`。
- 审批：`ToolPermissionRequestView`、`ToolApprovalCardView`、`ToolApprovalEditorView`。

---

## 六、Subagent Card

`SubagentCardView.swift`：`SubagentCardData`、普通时间线 vs 后台 CUA 截图卡；`applySubagentProgress` 实时更新。

---

## 七、Toolbar

`ChatPanelToolbarView`：高度、`ChatToolbarAppIcon`、sidebar / new / collapse、最窄 160px 隐藏控件、拖拽区、（macOS 26）Glass slider（Web 可不迁）。

---

## 八、Empty State

`ChatEmptyStateContentView`：点击聚焦输入。

---

## 九、Ask User Card

`ChatAskUserCard` + `NotificationIslandContentView`，在列表与输入之间。

---

## 十、Attachment Preview

`AttachmentPreviewPopover`：遮罩、响应式面板、前后翻页。

---

## 十一、Settings（设置）

`SettingsView.swift`：Account、General、Permissions、Privacy、Shortcuts、Connectors、Bridges、External MCP、（DEBUG）Support；600×500；`.sidebarAdaptable`。React：Tab + 表单（Phase 2C）。

---

## 十二、设计系统（Design System Tokens）

PBColors / PBTypography / PBSpacing / PBRadius / Shimmer → CSS 变量或 Tailwind。Glass / sidebar material / thin scrollbar / 指针 / 窗口拖拽 → `backdrop-filter`、`scrollbar-width`、`-webkit-app-region: drag` 等 Web 近似方案。

---

## 十三、状态管理迁移对照

| Swift                 | React                       |
| --------------------- | --------------------------- |
| ChatContentModel      | Zustand                     |
| ChatSidebarHost       | Query + slice               |
| ChatInputModel        | Zustand                     |
| MessageQueueStore     | Zustand                     |
| ChatMessageListState  | Zustand                     |
| ChatScrollCoordinator | ref + 命令式 scroll         |
| MessageListHost       | hook                        |
| @FocusState           | useRef + focus              |
| @AppStorage           | localStorage / settings API |
| @EnvironmentObject    | Context                     |

---

## 十四、原生桥接必须项（PostBox 调用清单）

窗口（新开/关闭/最小化/拖拽）、文件选择器、粘贴板、打开设置、通知、权限查询、主题/OAuth/拖放事件、业务快捷键路由等——按 [通信协议](./communication-protocol_zh-CN.md) 与 PostBox 路由表实现。

---

## 十五、不迁移（保留 Swift）

Dynamic Island、Login、Subscription、Onboarding、MenuBarExtra、`PaperboyApp` 场景、`AppDelegate`、`ChatWindow` 容器、DEBUG Computer Use 等。

---

## 十六、建议执行顺序（细化）

1. **2A-1** Message List 基础：全 Row 类型、间距、streamdown+Shiki、virtua。
2. **2A-2** Scroll：贴底检测、自动滚动、用户打断、历史 prefetch、换 session。
3. **2A-3** Input：textarea、快捷键、主按钮状态机、附件、语音桥。
4. **2A-4** Tool UI：分组、各工具展开、三种审批、strip 懒取。
5. **2A-5** Queue、Subagent、AskUser、附件预览、空/加载态。
6. **2B** Sidebar + Project（含拖拽）。
7. **2C** Settings。
8. **2D** Workspace / Inkwell 合并。

---

## 执行跟踪（在 Paperboy React 仓库勾选）

在实现 PR 中逐项勾选；本表与 Phase 2 验收 checklist 对齐。

- [ ] Sidebar：TimeBucket、搜索、SessionRow、内联重命名、load more、右键菜单
- [ ] Message List：14 种 Row、SpacingPolicy、virtua
- [ ] Scroll：near-bottom、auto-scroll、userDidScrollAway、history prefetch、session 打开滚底
- [ ] Input：auto-resize、快捷键、主按钮状态机、附件、语音
- [ ] Tool Call UI：accordion、各工具展开、三种审批
- [ ] 其他：SubagentCard、MessageQueue、AskUser、AttachmentPreview、EmptyState
- [ ] 设计 Token：PB\* → CSS
- [ ] PostBox：窗口、picker、pasteboard、事件
- [ ] Settings：8 个 Tab CRUD
