# Guarded Vibe Coding Framework

> 版本: 0.1 | 日期: 2026-03-29
> 状态: Draft — 待团队验证后发布为 Skill
> 作者: Xinyao Chen + MiniChen

## 这是什么

一套让 AI agent 在 vibe coding 时**自动保持高质量**的工作流框架。不依赖使用者理解背后的哲学 — 流程本身就是约束。

核心矛盾：vibe coding 的价值在于快速探索，但探索产出的代码往往质量不可控。这套框架通过分阶段工作流 + 自动化守卫，让"快"和"好"不再冲突。

---

## 核心原则

1. **探索和巩固是两个阶段，不要混在一起**
2. **Agent 写代码，人定边界，kly 守规矩**
3. **Test 锁行为，Fitness Function 锁架构**
4. **每次 session 结束都留下决策记忆，不只是代码**

---

## 两阶段工作流

### Phase A: Spike（探索）

**目标**：发现接口、行为和可行性。不追求代码质量。

**规则**：

- ✅ 随意 vibe，不需要写 test
- ✅ 可以 hack、hardcode、copy-paste
- ✅ 产出是 prototype，不是 production code
- ❌ 不要在 spike 代码上追加功能
- ❌ spike 代码不进 main branch

**Spike 的退出条件**：

- 你能用一句话描述这个功能的 public API
- 你知道哪些行为是必须的，哪些是可选的
- 你知道这个功能的边界在哪里（什么不做）

**Spike 结束时必须产出**：

```markdown
## Spike Summary: [功能名]

### Public API（对外接口）

- `functionA(input): output` — 做什么
- `functionB(input): output` — 做什么

### 必须满足的行为

1. 当 X 时，应该 Y
2. 当 A 时，不应该 B

### 不做什么（明确排除）

- 不处理 Z 场景
- 不支持 W 格式

### 架构决策

- 选了 X 方案，因为 ...
- 拒绝了 Y 方案，因为 ...
```

---

### Phase B: Consolidate（巩固）

**目标**：基于 Spike 发现的行为，写出 production-quality 代码。

**步骤严格按顺序执行**：

#### Step 1: 写 Contract Tests（人类或 senior agent 负责）

基于 Spike Summary 的"必须满足的行为"，写 test：

```typescript
// ✅ 好的 contract test — 测 public API 行为
describe('MessageList', () => {
  it('should render only visible messages within viewport', () => { ... })
  it('should maintain scroll position when new messages prepend', () => { ... })
  it('should auto-scroll to bottom when user is at bottom', () => { ... })
})

// ❌ 坏的 test — 测内部实现
describe('MessageList', () => {
  it('should call _recalculateHeights when container resizes', () => { ... })
  // 这个 test 在重构时一定 break，因为它绑定了实现细节
})
```

**Test 的规则**：

- 只测 public API / 对外行为
- 用 property-based testing 描述不变量，而不只是 example-based
- 如果一个 test 在正确的重构后 break，说明这个 test 写得太紧，删掉重写

#### Step 2: 写 ADR（Architecture Decision Record）

在模块目录下创建或更新 `DECISIONS.md`：

```markdown
## ADR-001: 使用 Pretext 替代 virtua 做消息列表虚拟化

### 状态: Accepted

### 日期: 2026-03-29

### 背景

Message list 需要虚拟滚动。传统方案用 virtua，但 Pretext 提供零 DOM reflow 的精确高度预计算，使虚拟化逻辑变得很薄。

### 决策

采用 Pretext + 自实现虚拟化，不引入 virtua。

### 理由

- Pretext masonry demo 证明自实现虚拟化可行且更轻量
- 精确高度预计算消除了 estimated height 跳变问题
- shrink-wrap 能力是 CSS 无法实现的

### 拒绝的方案

- virtua: 引入额外依赖，且无法利用 Pretext 的 shrink-wrap
- react-window: 不支持动态高度的精确预计算

### 什么条件下需要重新评估

- Pretext 维护停止
- 消息类型复杂度超出纯文本测量范围（富媒体为主）
```

#### Step 3: Agent 实现

让 agent 基于 contract tests 写 implementation：

```
prompt 模板:

实现 [功能名]。

约束：
1. 必须通过 [test file] 中的所有 test
2. 阅读 DECISIONS.md 了解架构决策，不要违反
3. 阅读 AGENTS.md 了解项目级约束
4. 运行 `kly check` 确认没有违反依赖方向约束
5. 完成后运行 `kly affected [changed files]` 列出影响范围

不要做：
- 不要修改 test（如果 test 有问题，报告给我）
- 不要修改 public API 签名（如果需要改，报告给我）
- 不要引入 DECISIONS.md 中明确拒绝的方案
```

#### Step 4: 自动化守卫

Agent 完成实现后，自动运行以下检查：

```bash
# 1. 行为检查 — test 必须全部通过
pnpm test

# 2. 架构检查 — kly fitness functions
kly check --rules .kly/rules.yaml

# 3. Mutation testing — 验证 test 质量（可选，CI 里跑）
pnpm mutation-test

# 4. Lint + Type check
pnpm lint && pnpm typecheck
```

#### Step 5: Session Log

每次 session 结束时，agent 自动生成：

```markdown
## Session Log: [日期] [功能名]

### 做了什么

- 实现了 X
- 修改了 Y

### 架构决策（如有新的）

- 选了 A 而不是 B，因为 ...

### 发现的问题（未修复）

- Z 模块的 API 不太合理，但不在本次范围内

### 影响范围

- kly affected: [file list]
```

---

## 持久化上下文层级

```
L0: 代码本身
    → kly 索引（结构、依赖、历史）
    → 是什么 (WHAT)

L1: AGENTS.md / CLAUDE.md
    → 项目级约束、编码惯例、禁止事项
    → 怎么做 (HOW)

L2: DECISIONS.md (per module)
    → 架构决策、选型理由、拒绝的方案
    → 为什么 (WHY)

L3: Session Logs
    → 每次 session 的摘要、发现、未解决问题
    → 什么时候、什么上下文 (WHEN & CONTEXT)
```

**Agent 启动时自动加载**：L1 (全局) + 相关模块的 L2 + 最近 3 条 L3。

---

## kly Fitness Functions（架构守卫规则）

在项目根目录创建 `.kly/rules.yaml`：

```yaml
rules:
  # 依赖方向约束
  - name: no-ui-import-data
    type: dependency-direction
    description: "UI 层不能直接 import 数据层"
    source: "packages/ui/**"
    forbidden_target: "packages/data/**"

  # 模块边界约束
  - name: store-public-api
    type: module-boundary
    description: "Store 的 public API 只能是指定的导出"
    target: "packages/*/stores/**"
    allowed_exports: ["*Store", "use*"]

  # 复杂度约束
  - name: file-complexity
    type: complexity
    description: "单文件不超过 300 行"
    max_lines: 300
    exclude: ["*.test.*", "*.spec.*"]

  # 命名约束
  - name: store-naming
    type: naming
    description: "所有 Store 文件必须以 Store 结尾"
    target: "packages/*/stores/**"
    pattern: "*Store.ts"
```

---

## 角色分工速查

| 角色                  | 负责                                                         | 不做                                 |
| --------------------- | ------------------------------------------------------------ | ------------------------------------ |
| **人类**              | 定义 Spike 方向、写 contract test spec、review ADR、架构判断 | 写 implementation 代码               |
| **Agent**             | Spike prototype、写 implementation、生成 session log         | 修改 test、修改 public API、违反 ADR |
| **kly**               | 依赖检查、影响范围分析、fitness function                     | 语义理解、架构判断                   |
| **TDD**               | 锁定已确认的行为                                             | 发现新需求、验证架构质量             |
| **Fitness Functions** | 验证架构约束（方向、边界、复杂度）                           | 验证业务逻辑正确性                   |

---

## 流程图

```
┌─────────────────────────────────────────────────────┐
│                   Phase A: Spike                     │
│                                                     │
│  自由 vibe → prototype → 发现接口和行为              │
│  产出: Spike Summary (API + 行为 + 决策 + 排除项)    │
│                                                     │
│  退出条件: 能一句话描述 public API                    │
└──────────────────────┬──────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────┐
│               Phase B: Consolidate                   │
│                                                     │
│  ① 人写 Contract Tests (基于 Spike Summary)          │
│  ② 人写/更新 ADR (DECISIONS.md)                      │
│  ③ Agent 实现 (受 test + ADR + AGENTS.md 约束)       │
│  ④ 自动守卫 (test + kly check + typecheck + lint)    │
│  ⑤ Agent 生成 Session Log                           │
│                                                     │
│  退出条件: 全部 check 通过 + 人 review 架构          │
└──────────────────────┬──────────────────────────────┘
                       │
                       ▼
              ┌────────────────┐
              │  Merge to main │
              └────────────────┘
```

---

## 给不了解此框架的人的 Quick Start

**如果你是第一次在这个项目里写代码：**

1. 读 `AGENTS.md` — 了解项目约束
2. 读你要改的模块的 `DECISIONS.md` — 了解架构决策
3. 如果是新功能：先 Spike，产出 Spike Summary，再让 agent 实现
4. 如果是 bug fix：直接写 test 复现 bug，再让 agent 修
5. 改完后跑 `pnpm test && kly check && pnpm typecheck`
6. 生成 session log

**一句话版本**：先搞清楚要什么（Spike），锁住行为（Test），让 agent 干活，机器守规矩（kly + fitness），人看方向（ADR + review）。

---

## 待验证 & TODO

- [ ] kly fitness function 规则语法还需设计和实现（当前 kly v0.2 不支持 rules.yaml）
- [ ] Mutation testing 工具选型（Stryker? 自研?）
- [ ] Session log 自动生成的 prompt 模板需要迭代
- [ ] Property-based testing 在前端场景的可行性验证（fast-check?）
- [ ] Spike Summary 模板是否需要更结构化（YAML? frontmatter?）
- [ ] 这套流程在真实 feature 上跑一次 end-to-end 验证
