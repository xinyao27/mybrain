# Phase 3：切换 + 清理 + 可观测性

> 创建日期：2026-03-28
> 作者：Xinyao Chen
> 状态：草案（Draft）
> 前置条件：[Phase 2 核心 UI 重建与迁移清单](./phase2-core-ui-rebuild_zh-CN.md) 完成
> 关联文档：
>
> - [Paperboy 前端大重写方案](./paperboy-frontend-rewrite_zh-CN.md)
> - [通信协议重设计](./communication-protocol_zh-CN.md)
> - [可观测性系统设计](./observability-system-design_zh-CN.md)

## 一、目标

**一次性切换到 React 版本，清理所有旧代码，接入可观测性系统。**

Phase 2 建好了 React UI。Phase 3 做三件事：

1. 删掉 SwiftUI，React 成为唯一 UI
2. 删掉 Protobuf，oRPC 成为唯一通信协议
3. 接入 ohbug + kly 可观测性

---

## 二、执行内容

### Phase 3A：切换

- React 版本通过 Phase 2 验收 checklist
- 删除所有 SwiftUI View 代码
- Swift 只保留：
  - `WindowManager` — NSWindow + WKWebView 管理
  - `ProcessManager` — Santi 子进程生命周期（复用 DaemonManager）
  - `PermissionManager` — TCC 权限（Accessibility、Screen Recording、Mic）
  - OS 数据采集（screenshots、keystrokes、clipboard、mouse、AX tree）
  - Orb / Dynamic Island（NSPanel + 动画）
  - PostBox bridge — Swift ↔ WebView 双向通信（见 §3.1）
  - CGEvent Tap（全局快捷键）
  - MenuBar Extra
  - Sparkle 自动更新
  - `paperboy://` URL scheme handler
- WKWebView 成为唯一 UI 载体

### Phase 3B：清理 Protobuf

- 删除 `proto/santi/v1/` 全部 `.proto` 文件（13 files）
- 删除 `packages/santi/src/proto/` 整个目录（gen、transport、services、client、server）
- 删除 `packages/paperboy/Paperboy/Generated/santi/v1/*.pb.swift`（16 files）
- 删除 `SantiClient.swift`
- 移除 `@bufbuild/protobuf`、`@bufbuild/protoc-gen-es` 依赖
- 移除 Swift 的 `SwiftProtobuf` package dependency
- 确认 OS 包的 `/os` WebSocket path 不受影响（OS 不用 Protobuf）

### Phase 3C：ohbug + kly 接入

- `@ohbug/browser` + `@ohbug/react` 接入 React SPA
- kly MCP 工具扩展（`get_dependents`、`get_file_history`、`enrich_error_stack`）
- Santi import kly 库函数（`KlyService`）
- Error stack + OS 上下文在云端汇聚
- 详见 [可观测性系统设计](./observability-system-design_zh-CN.md)

> **注：ohbug 和 kly 的具体改造由 Xinyao 直接负责，此处只记录接入点，不展开实现细节。**

### Phase 3D：可观测性面板

- ohbug-dashboard 组件迁入 React SPA
- Enriched Error View（error stack + kly 代码上下文 + OS 截图/操作轨迹）
- 每日产品健康报告
- 统一入口（Slack + Linear + GitHub + Paperboy bot → 自动处理）

> **注：ohbug-dashboard 后端改造由 Xinyao 直接负责。**

---

## 三、关键设计决策

### 3.1 PostBox 保留：Swift ↔ WebView 双向通信桥梁

虽然 oRPC 解决了 React ↔ Santi 和 Swift ↔ Santi 的通信，但 **Swift 和 WebView 之间仍然需要直接双向通信**，oRPC 无法覆盖这些场景：

| 场景                             | 方向            | 为什么不走 Santi                                       |
| -------------------------------- | --------------- | ------------------------------------------------------ |
| Orb 点击 → 打开/聚焦指定 session | Swift → WebView | 需要即时控制 WebView 内部路由，走 Santi 多一跳且不可靠 |
| 全局快捷键 → 触发 WebView 内操作 | Swift → WebView | CGEvent Tap 在 Swift 侧，需要直接通知 WebView          |
| WebView 请求窗口操作             | WebView → Swift | 如 resize、进入全屏、关闭窗口，需要直接调 NSWindow API |
| OAuth 回调传递                   | Swift → WebView | URL scheme handler 在 Swift，token 需要即时传给 React  |
| 文件拖拽                         | Swift → WebView | native drop zone 接收文件后，需要传文件路径给 WebView  |
| 系统主题变化                     | Swift → WebView | appearance change notification 在 Swift 侧             |

**PostBox 的职责收窄为：**

- 只处理 Swift ↔ WebView 的**直接交互**（窗口控制、导航、系统事件）
- **不再传输业务数据**（全部走 oRPC）
- 保持 `WKScriptMessageHandler` + `evaluateJavaScript` 的双向通道

**通信全景图（最终版）：**

```
┌─────────────────────────────────────────────────┐
│  React SPA (WKWebView)                           │
│                                                   │
│  ├── oRPC/WS ←→ Santi     （业务数据 + streaming）│
│  └── PostBox ←→ Swift      （窗口控制 + 系统事件）│
└──────────────────┬──────────┬────────────────────┘
                   │ WS       │ PostBox
                   ▼          ▼
┌──────────┐    ┌─────────────────┐
│  Santi   │    │  Swift Shell     │
│  oRPC    │    │  窗口/Orb/权限/OS│
│  server  │◄───│  (OpenAPI HTTP)  │
└──────────┘    └─────────────────┘
```

三条通信路径，职责完全分离：

- **oRPC/WS** — React ↔ Santi（所有业务数据）
- **oRPC/HTTP** — Swift ↔ Santi（Orb 状态、agent events）
- **PostBox** — Swift ↔ WebView（窗口控制、导航、系统事件）

### 3.2 Project 数据：无需兼容迁移

Spaces 功能尚未上线，没有用户数据需要迁移。Phase 2 直接用 Project 数据模型建表，不需要从 Spaces 迁移。

### 3.3 不走 App Store

Paperboy 不通过 App Store 分发，以下审核风险不适用：

- Bun binary 打包 notarization → 不需要
- WKWebView 加载 localhost → 不需要审核
- Private API (`drawsBackground`) → 不受限制
- App 体积膨胀 → 不受 App Store 限制

分发方式：直接下载 + Sparkle 自动更新。

---

## 四、测试要求

### 4.1 E2E 测试（Playwright）

Phase 2 建 UI 时同步编写，Phase 3 切换前必须全部通过。

**关键路径覆盖：**

- [ ] 发送消息 → 收到 streaming 回复 → 消息完整渲染
- [ ] 创建 Project → 在 Project 下创建 Session → 切换 Session
- [ ] Tool Call 审批流程
- [ ] 附件上传 + 预览
- [ ] Message Queue 排队 / 编辑 / 取消
- [ ] 多窗口同步（窗口 A 发消息 → 窗口 B sidebar 更新）
- [ ] Settings 修改 → 立即生效
- [ ] 断线恢复（kill Santi → 重启 → React 自动重连）

### 4.2 单元测试

**覆盖率目标：≥ 80%**

| 层面                  | 测试框架                       | 覆盖范围                                                     |
| --------------------- | ------------------------------ | ------------------------------------------------------------ |
| Santi oRPC procedures | Vitest (`vp test`)             | 每个 procedure 的 input validation、业务逻辑、error handling |
| Santi 业务逻辑        | Vitest                         | ChatEngine、SessionManager、ProjectManager 等核心模块        |
| React 组件            | Vitest + React Testing Library | 消息气泡、输入框、sidebar、settings 表单                     |
| React Hooks / Stores  | Vitest                         | Zustand stores、自定义 hooks                                 |
| 共享类型              | Vitest                         | zod schema 验证                                              |

**测试原则：**

- 每个 oRPC procedure 必须有对应的单元测试
- 每个 Zustand store 必须有状态变更测试
- 从 proto services 迁移业务逻辑时，同步补写测试（迁移前旧代码没有测试不是借口）
- CI 跑 `vp test --coverage`，低于 80% 阻断合并

---

## 五、风险

### 5.1 删 SwiftUI 时断掉意外依赖

**风险：** SwiftUI View 被 AppDelegate、notification handlers、URL scheme handlers、Orb 回调等非 UI 代码引用。删除后编译不过。

**对策：** 删之前用 Xcode Find References 确认每个待删文件的引用链。从叶子节点开始删，逐步编译验证。

### 5.2 Orb ↔ Chat Window 联动

**风险：** 点击 Orb → 需要打开/聚焦 Chat Window 并导航到指定 session。Orb 在 Swift，Chat 在 WebView。

**对策：** 通过 PostBox bridge 解决。Swift 侧 `PostBox.send("navigate", { sessionId: "xxx" })`，React 侧 `postbox.on("navigate", ...)` 处理路由跳转。

### 5.3 OS 包 WebSocket 路径不能断

**风险：** OS 包走 `/os` WebSocket path 给 Santi 发系统事件。清理 Protobuf transport 代码时可能误删公共 WS 基础设施。

**对策：** `/os` path 的 handler 和 Protobuf transport 是独立的。清理时逐文件确认，先删 Protobuf 特有代码（envelope.ts、\*\_pb.ts），再删 transport 层，每步编译验证。

### 5.4 测试覆盖不足导致回归

**风险：** 旧 SwiftUI 版本没有自动化测试，切换后无法确认功能完整覆盖。

**对策：**

- Phase 2 建 UI 时同步写 E2E + 单元测试（不是事后补）
- 单元测试覆盖率 ≥ 80%（CI 阻断）
- E2E 覆盖所有关键路径
- 切换前做一轮完整手动 QA（对照 SwiftUI 版本逐功能验证）

---

## 六、时间估算

| Phase    | 内容                                           | 估算       |
| -------- | ---------------------------------------------- | ---------- |
| 3A       | 切换（删 SwiftUI、保留 Swift Shell + PostBox） | 1 周       |
| 3B       | 清理 Protobuf                                  | 2-3 天     |
| 3C       | ohbug + kly 接入                               | 1-2 周     |
| 3D       | 可观测性面板                                   | 1-2 周     |
| **总计** |                                                | **3-5 周** |

---

## 七、全局时间线

| Phase | 内容                   | 估算   | 累计    |
| ----- | ---------------------- | ------ | ------- |
| 1     | 端到端链路验证         | 1-2 周 | 1-2 周  |
| 2     | 核心 UI 重建           | 5-7 周 | 6-9 周  |
| 3     | 切换 + 清理 + 可观测性 | 3-5 周 | 9-14 周 |

**对齐 6/1 目标：** 从 3/28 起算到 6/1 约 9 周。乐观估计刚好能完成 Phase 1-3A（切换完成）。可观测性（3C-3D）可能需要延伸到 6 月中旬。

**关键里程碑：**

- 4 月初：Phase 1 完成（架构验证通过）
- 5 月初：Phase 2A-2B 完成（Chat + Sidebar 可用）
- 5 月中旬：Phase 2C-2D 完成（全部 UI 可用）
- 6/1 前：Phase 3A-3B 完成（切换 + 清理）
- 6 月中旬：Phase 3C-3D 完成（可观测性上线）
