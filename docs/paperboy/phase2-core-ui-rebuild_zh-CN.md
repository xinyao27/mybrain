# Phase 2：核心 UI 重建

> 创建日期：2026-03-28
> 作者：Xinyao Chen
> 状态：草案（Draft）
> 前置条件：[Phase 1 端到端链路验证](./phase1-e2e-verification_zh-CN.md) 完成
> 关联文档：
>
> - [Paperboy 前端大重写方案](./paperboy-frontend-rewrite_zh-CN.md)
> - [通信协议重设计](./communication-protocol_zh-CN.md)

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
