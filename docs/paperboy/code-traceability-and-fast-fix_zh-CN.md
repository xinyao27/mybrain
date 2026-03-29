# Code Traceability & Fast Fix Pipeline

> 版本: 0.1 | 日期: 2026-03-29
> 状态: Draft
> 关联: [Guarded Vibe Coding Framework](./guarded-vibe-coding-framework_zh-CN.md) | [Observability System Design](./observability-system-design_zh-CN.md)
> 作者: Xinyao Chen + MiniChen

## 这是什么

一套从错误发生到修复完成的**全链路可追踪 + 自动化修复**管线。解决 AI 时代代码维护的核心问题：agent 写的代码出了 bug，如何在分钟级内定位根因并修复。

---

## 核心问题

Vibe coding 生产的代码，bug 出现时面对三个传统工具链无法解决的难题：

| 问题               | 传统方案                     | 为什么不够                                                                                   |
| ------------------ | ---------------------------- | -------------------------------------------------------------------------------------------- |
| **谁改的？**       | git blame → 找人问           | Agent 写的代码，blame 只显示 "Cursor" 或 "Claude Code"，不知道哪个 prompt、什么意图          |
| **为什么这么改？** | PR description → code review | Agent 的推理过程丢失了，只剩代码产物；PR description 是 agent 自动生成的摘要，不是真实推理链 |
| **改了会炸什么？** | 跑 test → 祈祷               | Agent 不了解全局影响范围，test 只覆盖已知行为，架构退化不可见                                |

---

## 五层追踪模型

```
L5: Runtime（运行时）     — ohbug: 错误栈 + 用户操作面包屑
L4: OS Context（环境）    — Paperboy: 截屏 + 剪贴板 + 用户行为序列
L3: Code Structure（结构）— kly: 依赖图 + 文件历史 + 影响范围
L2: Intent（意图）        — Session Log + ADR + Structured Commit
L1: Behavior（行为）      — Contract Tests + Fitness Functions
```

**Bug 出现时，从上往下穿透**：

```
用户报错 / ohbug 自动捕获
  → L5 ohbug: 错误栈 + 最近 30s 用户操作序列 (breadcrumbs)
  → L4 Paperboy: 出错时的截屏 + 当时在做什么 + 剪贴板
  → L3 kly enrich_error_stack: 错误栈 → 代码文件 → 依赖图 → 最近改动
  → L2 找到改动的 commit → session log → 当时的 prompt 和推理 → ADR
  → L1 跑 test → 哪些行为被破坏了 → fitness function 是否被违反
```

---

## L5: Runtime — ohbug 错误捕获

### 标准配置

```typescript
import Ohbug from "@ohbug/browser";

Ohbug.init({
  apiKey: "...",

  // 用户操作面包屑 — 最近 N 次操作
  breadcrumbs: {
    dom: true, // 点击、输入事件
    console: true, // console.error / console.warn
    network: true, // 失败的 HTTP 请求
    navigation: true, // 路由切换
  },

  // 关键：附加 agent 元数据
  metadata: {
    lastAgentSession: getCurrentSessionId(), // 最近一次 agent session ID
    lastCommit: __COMMIT_HASH__, // 当前运行的 commit hash
    buildTime: __BUILD_TIMESTAMP__, // 构建时间
    branch: __GIT_BRANCH__, // 当前分支
  },
});
```

### 自定义上下文注入

```typescript
// 在关键操作前注入上下文
Ohbug.addAction("message-list-scroll", {
  viewport: { top: scrollTop, height: viewportHeight },
  visibleMessages: visibleRange,
  totalMessages: messageCount,
});

// 错误发生时，这些 action 会作为面包屑一起上报
```

### 上报数据结构

```json
{
  "error": {
    "type": "TypeError",
    "message": "Cannot read properties of undefined (reading 'height')",
    "stack": "at useMessageHeight (MessageList.tsx:142)\n  at renderMessage (MessageList.tsx:87)\n  ..."
  },
  "breadcrumbs": [
    { "type": "click", "target": "#send-button", "timestamp": -3200 },
    { "type": "navigation", "from": "/chat/1", "to": "/chat/2", "timestamp": -2100 },
    { "type": "network", "url": "/api/messages", "status": 200, "timestamp": -1500 },
    { "type": "dom", "target": ".message-input", "action": "input", "timestamp": -800 }
  ],
  "metadata": {
    "lastAgentSession": "cursor-52a50243",
    "lastCommit": "abc1234",
    "buildTime": "2026-03-29T17:00:00Z",
    "branch": "feat/react"
  }
}
```

---

## L4: OS Context — Paperboy 独有优势

**这是竞争壁垒 — Sentry / Datadog / 任何竞品都没有这一层。**

错误发生时，Paperboy 能提供：

| 数据                    | 来源              | 价值                    |
| ----------------------- | ----------------- | ----------------------- |
| 出错前 30s 屏幕截图序列 | Screen capture    | 视觉重现用户看到了什么  |
| 用户剪贴板历史          | Clipboard monitor | 用户当时在复制/粘贴什么 |
| 当前操作的 app 和窗口   | Window tracker    | 上下文切换链            |
| 键盘/鼠标操作序列       | Input monitor     | 精确操作重放            |
| 语音转录（如有）        | Transcription     | 用户当时在说什么        |

### 与 kly 的集成点

```bash
# kly enrich_error_stack 接受 OS context 作为补充输入
kly enrich-error-stack \
  --stack "TypeError at MessageList.tsx:142" \
  --os-context '{"screenshot": "...", "activeApp": "Paperboy", "lastAction": "scroll"}'

# 输出包含：代码层分析 + "用户当时在快速滚动消息列表" 的环境推断
```

---

## L3: Code Structure — kly 作为代码知识图谱

kly 在追踪链中承担三个角色：

### 3a. 错误栈富化 (enrich_error_stack)

```bash
kly enrich-error-stack --stack "TypeError at MessageList.tsx:142"

# 输出:
{
  "location": {
    "file": "MessageList.tsx",
    "line": 142,
    "function": "useMessageHeight",
    "module": "packages/ui/message-list"
  },
  "dependencies": {
    "calls": ["pretext.layout()", "MessageStore.getById()"],
    "called_by": ["renderMessage()", "VirtualViewport.measure()"]
  },
  "dependents": [
    "ChatWindow.tsx (direct import)",
    "WorkspacePanel.tsx (indirect via ChatContentRoot)"
  ],
  "recent_changes": [
    {
      "commit": "abc1234",
      "message": "feat(message-list): implement pretext virtualization",
      "session": "cursor-52a50243",
      "date": "2026-03-29T15:00:00Z",
      "files_changed": ["MessageList.tsx", "useMessageHeight.ts"]
    }
  ],
  "decisions": [
    "ADR-003: 使用 Pretext 替代 virtua 做消息列表虚拟化"
  ]
}
```

### 3b. 影响范围分析 (affected)

```bash
kly affected MessageList.tsx

# 输出:
{
  "direct_dependents": [
    "ChatWindow.tsx",
    "ChatContentRoot.tsx"
  ],
  "indirect_dependents": [
    "WorkspacePanel.tsx",
    "App.tsx"
  ],
  "test_files": [
    "MessageList.test.tsx",
    "ChatWindow.test.tsx",
    "e2e/message-scroll.spec.ts"
  ],
  "fitness_rules_status": {
    "no-ui-import-data": "✅ pass",
    "file-complexity": "⚠️ MessageList.tsx: 287/300 lines"
  }
}
```

### 3c. 文件变更历史 (history)

```bash
kly history MessageList.tsx --last 5

# 输出:
[
  {
    "commit": "abc1234",
    "message": "feat(message-list): implement pretext virtualization",
    "session": "cursor-52a50243",
    "intent": "用 Pretext 替代 virtua 实现虚拟滚动",
    "date": "2026-03-29T15:00:00Z"
  },
  {
    "commit": "def5678",
    "message": "fix(message-list): scroll position on prepend",
    "session": "cursor-8a3b2c1d",
    "intent": "修复新消息 prepend 时滚动位置跳变",
    "date": "2026-03-28T22:00:00Z"
  }
]
```

---

## L2: Intent — 让每次改动都有"为什么"

### 2a. Structured Commit Protocol

每次 commit 必须包含 agent session 关联和意图声明：

```
# 格式
<type>(<scope>): <description>

session: <agent-session-id>
intent: <一句话描述意图>
decisions: <ADR 编号, 如有>
affected: <kly affected 关键文件>

# 示例
feat(message-list): implement pretext virtualization

session: cursor-52a50243
intent: 用 Pretext 替代 virtua 实现消息列表虚拟滚动，精确高度预计算消除跳变
decisions: ADR-003
affected: ChatWindow.tsx, WorkspacePanel.tsx
```

**自动化**：Agent 每次 commit 时，自动运行 `kly affected` 填充 `affected` 字段，从当前 session 上下文填充 `session` 和 `intent`。

### 2b. Session Log

每次 agent session 结束时自动生成（详见 [Guarded Vibe Coding Framework](./guarded-vibe-coding-framework_zh-CN.md)）：

```markdown
## Session Log: 2026-03-29 cursor-52a50243

### Prompt（触发）

"用 Pretext 实现消息列表虚拟化，参考 masonry demo 的模式"

### 推理链

1. 读了 Pretext masonry demo 的虚拟化实现
2. 决定不用 virtua，自实现视口管理
3. 用 prepare() 预计算高度，layout() 在 resize 时重算
4. 实现了 200px buffer 防快速滚动闪烁

### 做了什么

- 新建 useMessageHeight.ts
- 修改 MessageList.tsx: 替换 virtua 为自实现虚拟滚动
- 修改 ChatWindow.tsx: 传入 containerWidth

### 架构决策

- 选了自实现虚拟化，因为 Pretext 让测量层极薄
- 用 absolute positioning 而不是 transform，因为 ...

### 影响范围

kly affected: ChatWindow.tsx, WorkspacePanel.tsx

### 未解决问题

- streaming 消息的增量 prepare() 性能未验证
```

### 2c. ADR (Architecture Decision Records)

详见 [Guarded Vibe Coding Framework](./guarded-vibe-coding-framework_zh-CN.md) Step 2。

---

## L1: Behavior — Tests 作为行为基线

### Bug 修复的 TDD 流程

```
bug 报告 / ohbug 捕获
  → 先写一个复现 bug 的 test（红）
  → 修 bug（绿）
  → test 永久留下，防止回归
  → 如果所有现有 test 通过但用户报了 bug → test 覆盖不足，补 test
```

### 行为回归检测

```bash
# 常规: 跑全量 test
pnpm test

# 增强: 只跑受影响的 test（kly 提供范围）
kly affected MessageList.tsx --tests-only | xargs pnpm test --filter

# 深度: mutation testing 验证 test 质量
pnpm mutation-test --files MessageList.tsx
```

---

## 光速修复管线（End-to-End）

### 全自动流程

```
┌──────────────────────────────────────────────────────┐
│  Step 1: 错误捕获                                     │
│                                                      │
│  ohbug 捕获:                                          │
│    → error stack + breadcrumbs + agent metadata       │
│  Paperboy 捕获:                                       │
│    → 截屏 + 用户操作序列 + 剪贴板                      │
│                                                      │
│  耗时: 0s（自动）                                     │
└──────────────────────┬───────────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────────┐
│  Step 2: 上下文富化                                    │
│                                                      │
│  kly enrich-error-stack:                              │
│    → 定位代码文件 + 函数                               │
│    → 依赖图（谁调用它、它调用谁）                       │
│    → 最近改动 + 关联 session log                       │
│    → 关联 ADR                                         │
│  Paperboy OS context:                                 │
│    → 出错时截屏 + 用户当时在做什么                      │
│                                                      │
│  耗时: ~2s                                            │
└──────────────────────┬───────────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────────┐
│  Step 3: 自动诊断                                     │
│                                                      │
│  Agent 接收完整上下文，输出:                            │
│    → Root cause 分析                                  │
│    → 是否是已知 failure class（对比历史 session log）   │
│    → 建议修复方案（遵守 ADR 约束）                      │
│    → 影响范围 (kly affected)                          │
│    → 需要新增/修改的 test 列表                         │
│    → 置信度评分: HIGH / MEDIUM / LOW                   │
│                                                      │
│  耗时: ~30s                                           │
└──────────────────────┬───────────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────────┐
│  Step 4: 修复执行                                     │
│                                                      │
│  如果置信度 HIGH:                                     │
│    → 自动执行:                                        │
│      1. 写复现 test（红）                              │
│      2. 实现 fix（绿）                                │
│      3. 跑全量 test + kly check + typecheck           │
│      4. 生成 structured commit                        │
│      5. 生成 session log                              │
│      6. 创建 PR                                      │
│                                                      │
│  如果置信度 MEDIUM / LOW:                              │
│    → 生成诊断报告 + 修复建议，等待人类确认              │
│                                                      │
│  耗时: HIGH ~2min / MEDIUM-LOW 等待人类                │
└──────────────────────┬───────────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────────┐
│  Step 5: 人类 Review                                  │
│                                                      │
│  只需要看:                                            │
│    → root cause 分析是否准确                           │
│    → fix 是否违反架构意图（对照 ADR）                   │
│    → 影响范围是否被 test 覆盖                          │
│                                                      │
│  不需要看:                                            │
│    → 代码实现细节（test + kly 已守卫）                  │
│    → commit 格式（自动生成）                           │
│    → 影响范围（kly affected 已分析）                   │
│                                                      │
│  耗时: ~1min                                          │
└──────────────────────────────────────────────────────┘
```

### 时间线对比

```
传统流程:
  用户报 bug → 分配给人 → 人读代码 → 人定位问题 → 人写 fix → code review → merge
  耗时: 小时~天

本框架 (HIGH confidence):
  ohbug 捕获 → kly 富化 → agent 诊断 → agent 修复 → 人 review → merge
  耗时: ~5 分钟

本框架 (MEDIUM/LOW confidence):
  ohbug 捕获 → kly 富化 → agent 诊断报告 → 人确认方向 → agent 修复 → 人 review → merge
  耗时: ~15 分钟
```

---

## 置信度评分规则

Agent 在诊断后自动评估置信度：

| 条件                                                               | 置信度     |
| ------------------------------------------------------------------ | ---------- |
| 错误栈精确指向单文件 + kly 最近改动直接相关 + 已有类似 session log | **HIGH**   |
| 错误栈跨多文件 + kly 显示多个最近改动 + 无类似 session log         | **MEDIUM** |
| 错误栈不完整 / 复现条件不明 / 涉及外部依赖 / 可能是架构层面问题    | **LOW**    |

**HIGH 可以自动修复，MEDIUM/LOW 必须人类确认方向。**

这条规则不可协商 — 它防止 agent 在不确定时做出破坏性修改。

---

## 与竞品的对比

```
              错误捕获  代码结构  Agent意图  OS上下文  自动修复  意图追溯
Sentry          ✅       ❌        ❌         ❌        ❌        ❌
Datadog         ✅       ❌        ❌         ❌        ❌        ❌
GitHub Copilot  ❌       部分      ❌         ❌        部分      ❌
Cursor          ❌       部分      部分       ❌        ✅        ❌
Linear+GitHub   ❌       ❌        部分       ❌        ❌        部分
────────────────────────────────────────────────────────────────────
Paperboy        ✅       ✅        ✅         ✅        ✅        ✅
(ohbug+kly+OS)
```

**核心壁垒**：ohbug（运行时错误栈）+ kly（静态代码结构与依赖图）+ Paperboy OS context（截屏/操作/剪贴板）的三层交叉。没有任何竞品能同时覆盖这三层。Error Stack 是三层的交汇点。

---

## Structured Commit — 详细规范

### 格式

```
<type>(<scope>): <short description>

[optional body]

session: <agent-session-id>
intent: <一句话，为什么做这个改动>
decisions: <ADR 编号，多个用逗号分隔，没有则省略>
affected: <kly affected 输出的关键文件，逗号分隔>
confidence: <如果是 fix，标注诊断置信度>
```

### Type 枚举

| type       | 用途                      |
| ---------- | ------------------------- |
| `feat`     | 新功能                    |
| `fix`      | Bug 修复                  |
| `refactor` | 重构（不改变行为）        |
| `test`     | 新增或修改 test           |
| `docs`     | 文档更新                  |
| `spike`    | 探索性代码（不应进 main） |

### 示例

```
fix(message-list): handle undefined height for empty messages

prepare() returns undefined for empty string input.
Added null check before passing to layout().

session: cursor-8a3b2c1d
intent: 修复空消息导致 TypeError 的崩溃
affected: MessageList.tsx, useMessageHeight.ts
confidence: HIGH
```

### 自动化

Agent commit 时自动执行：

```bash
# 1. 获取影响范围
AFFECTED=$(kly affected --changed-files --format=csv)

# 2. 获取当前 session ID（从环境变量或 agent 上下文）
SESSION_ID=$AGENT_SESSION_ID

# 3. 生成 commit message（agent 填充 intent）
git commit -m "fix(message-list): handle undefined height for empty messages

session: $SESSION_ID
intent: 修复空消息导致 TypeError 的崩溃
affected: $AFFECTED
confidence: HIGH"
```

---

## 追溯查询示例

### 场景 1: 用户报 bug，快速定位

```bash
# 从 ohbug 拿到 error stack
# → kly 富化
kly enrich-error-stack --stack "TypeError at MessageList.tsx:142"

# → 发现最近改动是 commit abc1234, session cursor-52a50243
# → 查看 session log
cat .sessions/cursor-52a50243.md

# → 看到当时的 intent: "用 Pretext 替代 virtua"
# → 看到推理链: "决定不用 virtua，自实现视口管理"
# → 看到未解决问题: "streaming 消息的增量 prepare() 性能未验证"
# → 根因明确: 这就是问题所在
```

### 场景 2: 新人接手代码，理解设计

```bash
# 为什么用 Pretext 而不是 virtua？
cat packages/ui/message-list/DECISIONS.md
# → ADR-003: 完整的选型理由 + 拒绝方案 + 重新评估条件

# 这个文件最近经历了什么？
kly history MessageList.tsx --last 10
# → 完整变更历史，每条附带 session ID 和 intent

# 这个模块的架构约束是什么？
kly check --module packages/ui/message-list
# → fitness rules 状态 + 违反项
```

### 场景 3: 自动修复全流程

```
09:00:00  ohbug 捕获 TypeError at MessageList.tsx:142
09:00:02  kly enrich: 定位到 useMessageHeight, 最近改动 abc1234
09:00:02  Paperboy: 截屏显示用户在快速滚动长消息列表
09:00:05  Agent 诊断: 空消息的 prepare() 返回 undefined, confidence: HIGH
09:00:07  Agent: 写复现 test (红)
09:00:15  Agent: 实现 fix — null check + fallback height (绿)
09:00:30  Agent: pnpm test ✅, kly check ✅, pnpm typecheck ✅
09:00:35  Agent: structured commit + session log + 创建 PR
09:01:00  人类 review: root cause 准确, fix 不违反 ADR → approve
09:01:30  Merge → 部署
```

**从错误发生到修复部署: < 2 分钟。**

---

## 实现路线图

### Phase 1: 基础设施（现在可以开始）

- [ ] Structured Commit Protocol — 写入 AGENTS.md，让所有 agent 遵循
- [ ] Session Log 自动生成 — agent session 结束时的 prompt 模板
- [ ] ADR 模板 — 在关键模块创建 DECISIONS.md

### Phase 2: kly 增强

- [ ] `kly enrich-error-stack` 命令实现
- [ ] `kly affected --changed-files` 命令实现
- [ ] `kly check --rules` fitness function 引擎
- [ ] `kly history` 集成 structured commit 的 session/intent 字段

### Phase 3: ohbug 集成

- [ ] ohbug SDK 配置 agent metadata 注入
- [ ] ohbug → kly 自动富化管线
- [ ] ohbug dashboard 显示 kly 富化后的错误上下文

### Phase 4: 自动修复管线

- [ ] Agent 诊断 prompt 模板（输入: enriched error + ADR + tests）
- [ ] 置信度评分逻辑
- [ ] HIGH confidence 自动修复 + PR 流程
- [ ] MEDIUM/LOW confidence 人类确认交互流程

### Phase 5: Paperboy OS Context 集成

- [ ] 错误发生时自动关联 OS context（截屏、操作序列）
- [ ] kly enrich-error-stack 接受 OS context 输入
- [ ] ohbug dashboard 展示 OS context 面包屑

---

## 待验证 & 开放问题

- [ ] Structured commit 的 `session` 字段如何在不同 agent（Cursor / Claude Code / Codex）间统一？
- [ ] Session log 存在哪里？`.sessions/` 目录？还是 git notes？
- [ ] kly fitness function 的规则语法设计（YAML? DSL?）
- [ ] 置信度评分的校准 — 需要在真实 bug 上跑几轮验证阈值
- [ ] 自动修复的安全边界 — 哪些模块允许自动 fix，哪些必须人工？
- [ ] 性能: kly enrich-error-stack 在大型 monorepo 上的延迟
- [ ] 第一个 end-to-end 验证: 在真实 bug 上跑完 Step 1-5 全流程
