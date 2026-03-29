# Paperboy Frontend Grand Rewrite Plan

> Created: 2026-03-28
> Author: Xinyao Chen
> Status: Draft
>
> **Related Documents:**
>
> - [Communication Protocol Redesign (oRPC)](./communication-protocol.md) — Detailed design for replacing Protobuf/PostBox with oRPC
> - [Observability System Design](./observability-system-design.md) — Building the Paperboy observability system (ohbug + kly + OS context)
> - [Phase 1: End-to-End Verification](./phase1-e2e-verification.md) — Swift → Santi → WebView → React → oRPC pipeline validation
> - [Phase 2: Core UI Rebuild](./phase2-core-ui-rebuild.md) — Chat, Sidebar, Settings, Workspace rebuild details
> - [Phase 3: Switch + Cleanup + Observability](./phase3-switch-and-observability.md) — SwiftUI removal, Protobuf cleanup, ohbug+kly integration

## 1. Background & Motivation

Paperboy's current frontend is a pure SwiftUI implementation that just completed a full migration from AppKit to SwiftUI. However, this architecture faces several core problems:

1. **Team skill-stack mismatch** — Everyone on the team is proficient in frontend (React/TypeScript), but Paperboy's core UI is entirely SwiftUI. Only a handful of people can modify the core interface — productivity is shackled by architecture.
2. **Cross-platform impossibility** — SwiftUI is locked into the Apple ecosystem. Running in a browser, on mobile, or as a standalone web app in the future is simply not possible.
3. **Observability blind spot** — Error tracking, session replay, automated reproduction, and similar capabilities for pure native apps have an extremely weak ecosystem on SwiftUI.
4. **Development speed bottleneck** — React's component ecosystem, hot reload speed, and debugging toolchain remain the best across all UI frameworks in 2026.

**Core decision: Rewrite the Paperboy frontend as a Web App (React), embed it via WebView in a native shell, so the same UI can run anywhere — in a browser, a local native app (similar to Electron), mobile, anywhere.**

### Prior Validation

This is not a from-scratch gamble. The Inkwell panel (`packages/inkwell/`) is already React 19 + Vite + Zustand + Tailwind running inside WKWebView, communicating with the Swift shell via the PostBox SDK. The Artifacts panel and file previewer both run on this architecture and are stable.

---

## 2. Four Pillars (Original Design Thinking)

### 1. React in everywhere (DX)

> 1. React 就是所有可视化领域下生态最好的
> 2. 任何端可以通过 webview 接入同一套 UI

1. React has the best ecosystem across all visualization domains
2. Any platform can plug into the same UI via a webview

### 2. Observability + Reliability

> 1. 任何报错可被查找到原因
>    1. Error Stack
>       1. 要能够跟进 stack 追踪到 commit / 行
>    2. Session Replay
>    3. 自动化复原错误场景（自动搭建可复原环境）
>    4. 所有的能力应该在同一个 page 上追踪
> 2. 跟踪所有问题 + 每天展示可追踪的产品体验改进的进度
> 3. 提前预测缺陷可能出现的位置
> 4. 自动化
>    1. 所有问题都应该自动生成文档 沉淀为可回溯的资料
>    2. 打通所有工作平台 任何问题通过统一的入口进入观测平台（slack + linear + github + paperboy bot）收到问题以后自动处理

1. Every error must be traceable to its root cause
   1. Error Stack
      1. Must be able to trace the stack back to the commit / line
   2. Session Replay
   3. Automated reproduction of error scenarios (automatically build a reproducible environment)
   4. All capabilities should be trackable on a single page
2. Track all issues + show trackable product experience improvement progress daily
3. Predict where defects are likely to appear in advance
4. Automation
   1. Every issue should automatically generate documentation, accumulated as traceable reference material
   2. Connect all work platforms — any issue enters the observability platform through a unified entry point (Slack + Linear + GitHub + Paperboy bot), then gets processed automatically upon receipt

### 3. Speed

> 1. bun + viteplus
> 2. 最好的第三方 library
> 3. 最好的算法

1. bun + viteplus
2. The best third-party libraries
3. The best algorithms

### 4. UX

(See Section 4.4 for details)

---

## 3. Architecture Design

### 3.1 Cloud-Driven Three-Layer Model

> Background: Du-ge is migrating capabilities and data to the cloud. The OS layer continues to collect data on the client side, but collected data is reported to the cloud. The cloud Agent processes data based on what's been reported. The rewritten app will most likely depend on cloud data.

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

**Core change: Data and intelligence live in the cloud; the client is a thin terminal.**

- **Source of Truth = Cloud**. The React SPA calls cloud APIs directly — no relaying data through a Swift bridge.
- **Bridge responsibilities drastically reduced**: Only handles system-level operations (window management, notifications, Orb, OS collection start/stop) — not data transfer.
- **Multi-window sync solved automatically**: All WebViews connect to the same cloud → WebSocket/SSE push → all windows stay in sync.
- **True cross-platform becomes viable**: Browser/mobile connect directly to the same cloud API; the only difference is that macOS has an additional OS collection layer.
- **ohbug + OS data converge in the cloud**: An error event has not only a stack trace but the full context of what the user was doing at that moment — more powerful than any session replay.

**Offline strategy:**

- OS data collection layer: Continues collecting offline, buffers locally, uploads when reconnected
- Chat: Caches messages locally, readable offline, syncs when reconnected
- Other features: Degrades to read-only offline (displays cached data)

### 3.2 Native/Web/Cloud Boundary Definitions

**Native Shell (Swift, client-resident):**

- OS data collection (Accessibility API, screenshots, keystrokes, clipboard) → reported to cloud
- System-level integration (macOS notifications, Menu Bar, Dynamic Island/Orb)
- Window management (multi-window, "Open in New Window", split screen)
- Keychain (auth token storage; WebView obtains tokens via bridge)
- Offline buffer (collected data temporarily stored, uploaded when online)

**WebView React SPA (UI layer, all visualization):**

- Chat UI (message list, input box, markdown rendering, code blocks)
- Workspace panel (artifacts, file preview, diff viewer)
- Sidebar (session list, spaces)
- Settings page
- Observability panel (issues, metrics, session replay, alerts)
- Onboarding flow
- @ohbug/browser error capture (reported to cloud)
- **Connects directly to cloud API — does not fetch data through Swift bridge**

**Cloud (Data + Intelligence):**

- Storage and processing of all OS data
- Agent execution (reasoning, orchestration, tool invocation)
- ohbug error reception, aggregation, source map resolution
- kly code index storage, dependency graph queries
- Almanac / Garden
- API Layer (REST + WebSocket/SSE push for real-time updates)
- Unified entry point (Slack + Linear + GitHub + Paperboy bot → automatic processing)

### 3.3 Bridge Communication Protocol (PostBox SDK)

> **Detailed document:** [Communication Protocol Redesign (oRPC)](./communication-protocol.md) — covers the full oRPC router design, dual adapter architecture, chat streaming implementation, multi-window sync via Publisher, Protobuf-to-oRPC migration mapping, and localhost security.

Swift ↔ WebView communication via `WKScriptMessageHandler`:

```
Swift → WebView:  WKWebView.evaluateJavaScript()
WebView → Swift:  window.webkit.messageHandlers.postbox.postMessage()
```

**Bridge responsibilities drastically reduced under the cloud architecture:**

| Category                                | Via Bridge (Swift) |                Via Cloud API (Direct)                 |
| --------------------------------------- | :----------------: | :---------------------------------------------------: |
| Chat messages / agent state             |                    |                     ✅ WebSocket                      |
| OS activity data                        |                    | ✅ (reported independently by Swift collection layer) |
| Window operations (create/close/resize) |         ✅         |                                                       |
| System notifications                    |         ✅         |                                                       |
| Keychain token retrieval                |         ✅         |                                                       |
| Orb/Menu Bar interaction                |         ✅         |                                                       |
| File drag-and-drop (system-level)       |         ✅         |                                                       |
| Observability data                      |                    |                          ✅                           |
| Settings read/write                     |                    |                    ✅ (cloud sync)                    |

The bridge handles only **system-level operations**; all **data-intensive communication** goes through the cloud API. This fundamentally eliminates concerns about bridge performance bottlenecks.

### 3.4 Core Competitive Advantage: OS-Level Context × Error Monitoring (Only Paperboy Can Do This)

Traditional error monitoring platforms (Sentry / Datadog) can only see data from inside the browser: Error Stack, DOM snapshots (rrweb), network requests. They can never know the user's OS-level behavior before the error occurred — which app they switched from, what they pasted from the clipboard, what was actually displayed on screen at that moment.

**Paperboy's OS data collection layer + ohbug error monitoring + kly code index converge in the cloud to form an error monitoring system that no competitor can replicate:**

| Data Dimension                    |    Sentry Can Capture     |                        Paperboy Can Capture                         |
| --------------------------------- | :-----------------------: | :-----------------------------------------------------------------: |
| Error Stack                       |            ✅             |                ✅ (ohbug + source map → commit/line)                |
| Session Replay                    |  ⚠️ rrweb DOM simulation  |     ✅ **OS-level real screenshots** (not simulated — factual)      |
| User action trail                 |     ⚠️ In-page clicks     | ✅ **Full OS operations** (mouse/keyboard/window switch/app switch) |
| Clipboard content                 |            ❌             |                   ✅ What the user copied/pasted                    |
| Cross-application context         |            ❌             |                 ✅ Which app the user switched from                 |
| UI state tree                     |            ❌             |                 ✅ Full Accessibility Tree snapshot                 |
| Code structure / dependency graph |            ❌             |                ✅ kly file index + dependency graph                 |
| git blame / PR association        | ⚠️ Requires manual config |                    ✅ kly automatic association                     |

**Concrete scenario example:**

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

→ No need to ask the user "please describe your steps to reproduce." The system already knows everything.

**This data is already being collected.** The OS layer is currently collecting screenshots, keystrokes, clipboard, mouse events, and accessibility snapshots. Du-ge is migrating this data to the cloud. ohbug's error data is also reported to the cloud. **Two data streams converge in the same cloud — they just need to be correlated by timestamp.**

**Impact on each requirement from the notes:**

| Requirement                        | Traditional Implementation   | Paperboy OS-Level Implementation                                                                                                                |
| ---------------------------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Session Replay                     | rrweb DOM snapshot playback  | OS-level screenshots + operation trail timeline (real scene, not simulated)                                                                     |
| Automated error scene reproduction | DOM recording-based playback | Full OS context-based automated reproduction (knows user's cross-app behavior)                                                                  |
| Auto-generated documentation       | Manually written bug reports | Auto-assembled: error stack + screenshots + operation timeline + kly code context = complete bug report                                         |
| Predictive defect detection        | Static code analysis         | Runtime pattern recognition ("this component crashes every time a user pastes long text from Chrome" — only OS data can discover such patterns) |

---

## 4. Four Pillars in Detail

### 4.1 React in everywhere (DX)

> Original: React has the best ecosystem across all visualization domains. Any platform can plug into the same UI via a webview.

**Implementation path:**

- Unified React SPA (Vite+ build), outputs standard HTML/JS/CSS
- macOS: Swift shell + WKWebView loads the SPA
- Browser: Deploy directly as a web app
- Mobile: Can be wrapped in Tauri Mobile / Capacitor / custom WebView shell in the future
- Desktop cross-platform: Can be wrapped in Tauri / Electron as a non-macOS solution

**Tech stack confirmed:**

| Layer                   | Choice                                      | Notes                                            |
| ----------------------- | ------------------------------------------- | ------------------------------------------------ |
| Framework               | React 19 + TypeScript                       |                                                  |
| Build                   | Vite+ (bun + viteplus)                      |                                                  |
| CSS                     | Tailwind CSS v4 + shadcn/ui (xinyao preset) | Already used in Inkwell                          |
| State Management        | Zustand                                     | Already used in Inkwell                          |
| Data Fetching           | TanStack Query                              |                                                  |
| Routing                 | TanStack Router                             |                                                  |
| WebSocket               | TBD                                         | Native WebSocket API / Vercel AI SDK / socket.io |
| Markdown Rendering      | streamdown                                  | Already in Paperboy node_modules                 |
| Code Block Highlighting | Shiki                                       | Same uses shiki@3.4.2                            |
| Rich Text Input         | Reference Manus Textarea implementation     | `~/work/manus/.../components/Textarea.tsx`       |
| Virtual List            | virtua                                      | Manus uses virtua@0.40.0, lightweight            |
| Animation               | framer-motion                               |                                                  |
| Icons                   | Phosphor Icons                              | https://phosphoricons.com/                       |
| Toast                   | shadcn (already in Inkwell)                 |                                                  |
| Context Menu / Dropdown | shadcn (already in Inkwell)                 |                                                  |
| Form Validation         | zod + react-hook-form                       | For Settings page                                |
| Drag & Drop             | Not needed for now                          |                                                  |
| i18n                    | Not needed                                  |                                                  |

**Reference sources per module:**

| Module                  | Reference Project | Reference Path                                                                                    | Reuse Method                             |
| ----------------------- | ----------------- | ------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| Message List            | Same              | `~/work/feat_ai-sdk-v5/same-next/src/components/chat/messages/` (8 files)                         | Reference implementation                 |
| Message List            | Manus             | `~/work/manus/manus-next-agent-webapp/.../ChatBox/ChatMessages/`                                  | Reference implementation                 |
| TextArea Input          | Manus             | `~/work/manus/manus-next-agent-webapp/.../components/Textarea.tsx` (153 lines)                    | Study implementation                     |
| TextArea Input          | Same              | `~/work/feat_ai-sdk-v5/same-next/.../chat/textarea/` (3576 lines, includes attach/context/upload) | Reference implementation                 |
| Code Block              | Same              | `~/work/feat_ai-sdk-v5/same-next/src/components/ui/code-block.tsx` + Shiki                        | Reference implementation                 |
| Tool Call UI            | Same              | `~/work/feat_ai-sdk-v5/same-next/.../chat/tool-invocation/` (31 files)                            | Reference implementation                 |
| Tool Call UI            | 1Code             | `https://github.com/21st-dev/1Code`                                                               | Reference implementation                 |
| Message Queue           | Same              | Queue-related logic in Same chat module                                                           | Direct reference                         |
| Attachment Preview      | Same              | `~/work/feat_ai-sdk-v5/same-next/.../chat/textarea/attach/`                                       | **Reference styling only, rewrite code** |
| WebSocket Communication | Manus             | `~/work/manus/manus-next-agent-webapp/.../controllers/useChatWebsocketController.tsx`             | Reference implementation                 |
| Sidebar                 | TBD               | Same `history.tsx` / `chats.tsx` or Manus sessions controller                                     | To be decided                            |

**Reference project paths summary:**

- Same: `~/work/feat_ai-sdk-v5/same-next/`
- Manus: `~/work/manus/manus-next-agent-webapp/`
- 1Code: `https://github.com/21st-dev/1Code`

**What this means for the team:** Everyone can now modify the core UI. No longer constrained by SwiftUI's learning curve and talent scarcity.

### 4.2 Observability + Reliability

> The original notes are preserved in full in Section 2 above. Below is the detailed technical plan.

#### 4.2.1 Every Error Must Be Traceable to Its Root Cause

##### Error Stack — Trace to Commit / Line

> Original: Must be able to trace the stack back to the commit / line

**Implementation:**

1. **Client-side capture**: `@ohbug/browser` has `error-stack-parser` integrated, automatically captures complete stack traces for uncaught error / unhandled rejection / fetch error / websocket error / ajax error / resource error
2. **Source Map resolution**: Production builds generate source maps, uploaded to ohbug server. Upon receiving an error stack, use `source-map-trace` (already a dependency of ohbug-dashboard) to resolve to source code line numbers
3. **Commit association**:
   - Inject `GIT_COMMIT_SHA` into the bundle at build time (Vite+ environment variable)
   - ohbug event includes the commit hash when reporting
   - Dashboard display: Error Stack → source line → `git blame` → specific commit + author
4. **Existing code reuse**:
   - `ohbug/packages/ohbug-browser/src/capture/` — Complete error capture pipeline
   - `ohbug/packages/ohbug-browser/src/handle/` — Categorized handlers (uncaught/fetch/ajax/websocket/resource/unknown)
   - `ohbug-dashboard/packages/web/components/event-detail-stack.tsx` — Stack display component
   - `ohbug-dashboard/packages/web/components/stack-info.tsx` — Stack info parsing component

##### Session Replay

**Implementation:**

1. **Recording**: Integrate rrweb (ohbug-dashboard already has the `issue-related-rrweb.tsx` component)
2. **Storage**: rrweb recording data associated with ohbug events, stored in backend
3. **Playback**: Embed rrweb player in the Observability panel, with support for jumping to the moment of the error
4. **Existing code reuse**: `ohbug-dashboard/packages/web/components/issue-related-rrweb.tsx`

##### Automated Error Scene Reproduction (Automatically Build Reproducible Environment)

**Implementation approach:**

1. Automatically record at error time: error context + rrweb session + network logs + console logs
2. Package as a "reproducible bundle" containing all state needed for reproduction
3. One-click setup: Automatically restore to the exact state at the time of error in CI/CD environment
4. **Long-term goal**: AI agent auto-reproduces → auto-locates → auto-suggests fix

##### All Capabilities Trackable on a Single Page

> Original: All capabilities should be trackable on a single page

**Implementation:** Consolidate ohbug-dashboard's core pages into a built-in Observability panel within Paperboy (one tab/page):

- Error Stack tracking
- Session Replay playback
- Error trend charts (reuse `ohbug-dashboard/packages/web/components/charts/`)
- Issue list + details
- Metrics panel
- Alert configuration

**No longer a standalone application — it's part of the Paperboy UI.**

#### 4.2.2 Track All Issues + Show Trackable Product Experience Improvement Progress Daily

**Implementation:**

1. Auto-generate a daily "Product Health Report":
   - New/closed issue count
   - Error rate trends (day/week comparison)
   - User impact scope (affected users count)
   - Performance metric changes (LCP/FID/CLS)
2. Display as trackable progress bars/charts on the Observability panel homepage
3. Optional: Push to Slack #daily-async

#### 4.2.3 Predict Where Defects Are Likely to Appear in Advance

**Implementation — kly + ohbug synergy:**

1. `kly` indexes the Paperboy codebase, building a **dependency graph** (file-level dependency relationships)
2. When ohbug captures an error in a file → query the dependency graph via kly → mark all dependent/depended-upon files as "risk zones"
3. Display a "risk heatmap" in the Observability panel (Mermaid / visualization)
4. **PR-level prediction**: MiniChen, when reviewing PRs, queries the dependency graph of changed files via kly MCP, automatically annotating potentially affected modules
5. **Historical pattern recognition**: Based on ohbug historical data, identify "high-frequency error modules" and "cascading failure paths"

#### 4.2.4 Automation

##### Every Issue Should Automatically Generate Documentation Accumulated as Traceable Reference Material

**Implementation:**

1. ohbug creates a new issue → automatically generates standard documentation:
   - Error summary
   - Error Stack (after resolution)
   - Impact scope (user count, occurrence frequency)
   - Reproduction steps (automatically extracted from rrweb session)
   - Associated commit / PR
2. Document format: Markdown, stored in Notion / local knowledge base
3. When each issue is closed, automatically append a "fix record": fix PR, root cause analysis, measures to prevent recurrence

##### Connect All Work Platforms — Unified Entry Point

> Original: Connect all work platforms — any issue enters the observability platform through a unified entry point (Slack + Linear + GitHub + Paperboy bot), then gets processed automatically upon receipt

**Implementation:**

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

- Existing foundation: MiniChen is already connected to Slack #bugs, can receive and process bug reports
- Needs to be added: Linear webhook + GitHub webhook → Santi API → unified issue creation
- Automatic processing: Receive issue → automatically associate ohbug event (if any) → automatically assign priority → automatically notify responsible person

#### 4.2.5 Test-Driven Development (TDD) + Automated Testing

**Core principle: Test-First. Write tests before implementation. All business logic must have corresponding test cases before code is written.**

##### TDD Workflow

```
Red → Green → Refactor → Repeat

1. Write a failing test (define expected behavior)
2. Write the minimum code to make the test pass
3. Refactor, keeping tests green
4. Repeat
```

Every new feature and every bug fix starts with a test. Tests are not "something you tack on after writing code" — tests are a **design tool** that forces you to think through interfaces and behavior before writing code.

##### Unit Testing (Vitest)

| Layer                 | What to Test                                          | Coverage Target |
| --------------------- | ----------------------------------------------------- | --------------- |
| Store layer (Zustand) | State mutations, computed values, action side effects | > 95%           |
| Utility functions     | Pure functions, data transformations, formatting      | 100%            |
| Custom Hooks          | State logic, side effects, lifecycle                  | > 90%           |
| API layer             | Request/response transforms, error handling, retry    | > 90%           |
| Component logic       | Key interaction logic (not snapshot testing)          | > 80%           |

**Testing principles:**

- Test behavior, not implementation details — refactoring should not break tests
- Every store action gets at least one happy path + one error path test
- All data transformation functions must cover boundary conditions (empty arrays, null, undefined, excessively long strings)
- Only mock external dependencies (API, WebSocket, bridge) — never mock internal modules

##### End-to-End Testing (Playwright)

Cover critical user paths:

| User Path          | Test Scenarios                                                                           |
| ------------------ | ---------------------------------------------------------------------------------------- |
| Chat core flow     | Send message → streaming receive → markdown render → code block highlight                |
| Sidebar navigation | Session list load → switch session → search → create new session                         |
| Settings           | Modify config → save → persists after refresh → multi-window sync                        |
| Workspace          | File preview → diff viewer → artifacts panel                                             |
| Error recovery     | Network disconnect → reconnect → data recovery; Santi crash → auto-restart → UI recovery |
| Multi-window       | Window A action → Window B sync; open new window → state consistency                     |

**E2E testing strategy:**

- At least one E2E test for each critical user path
- Don't test style details — only test functional correctness
- Use Page Object Model to organize test code, isolating page structure changes
- CI runs core path tests on every PR; full regression runs daily

##### Testing Toolchain

| Tool                      | Purpose                        | Notes                                   |
| ------------------------- | ------------------------------ | --------------------------------------- |
| Vitest                    | Unit tests + integration tests | `vp test`, same pipeline as Vite        |
| @testing-library/react    | Component testing              | Tests user behavior, not implementation |
| Playwright                | E2E testing                    | Cross-browser + WebView testing         |
| MSW (Mock Service Worker) | API mocking                    | Decoupled frontend/backend testing      |
| @faker-js/faker           | Test data generation           | Avoid hardcoded test data               |

##### CI/CD Test Gates

```
PR Submitted
  │
  ├── vp check --fix           ← type check + lint + format
  ├── vp test                  ← unit tests + coverage check
  ├── playwright (core paths)  ← critical E2E tests
  │
  └── All pass → merge allowed
       └── Coverage decreased → merge blocked

Daily (Scheduled CI)
  │
  └── playwright (full suite)  ← full E2E regression
  └── performance benchmarks   ← prevent performance regressions
```

#### 4.2.6 Other Reliability Measures

##### TypeScript Strict Mode + Runtime Validation

Compile-time + runtime dual guarantees — trust no external input:

- **Compile-time**: `strict: true` + `noUncheckedIndexedAccess: true` — let the compiler catch most type issues
- **Runtime**: zod schema validation on all external inputs — API responses, WebSocket messages, bridge messages. Trust no data from the network
- **End-to-end type safety**: oRPC already implements client/server type sharing; API contract changes are caught at compile time

##### Layered Error Boundary Degradation

**No white screens allowed.** Any module crash should degrade gracefully rather than take down the entire application:

```
┌─ App-level Error Boundary ───────────────────────────┐
│                                                       │
│  ┌─ Chat Module EB ───────────┐  ┌─ Sidebar EB ──┐   │
│  │                             │  │               │   │
│  │  ┌─ Single Message EB ──┐  │  │  session list │   │
│  │  │  Message render fails │  │  │               │   │
│  │  │  → show fallback      │  │  └───────────────┘   │
│  │  │  → other msgs unaffected│ │                      │
│  │  └───────────────────────┘  │  ┌─ Workspace EB ┐   │
│  │                             │  │                │   │
│  └─────────────────────────────┘  └────────────────┘   │
│                                                       │
│  Every layer catches errors → auto-reports to ohbug    │
└───────────────────────────────────────────────────────┘
```

- **App-level**: Overall fallback + auto-reload option
- **Module-level**: Chat crashing doesn't affect Sidebar; Workspace crashing doesn't affect Chat
- **Component-level**: A single message render failure doesn't affect other messages
- Every layer auto-reports to ohbug with the component tree path

##### Health Checks + Self-Healing

| Scenario                       | Detection Method                       | Self-Healing Strategy                                                                    |
| ------------------------------ | -------------------------------------- | ---------------------------------------------------------------------------------------- |
| Santi process crash            | Swift process monitoring               | Auto-restart + WebView shows fallback + ohbug records crash                              |
| WebView content process killed | `webViewWebContentProcessDidTerminate` | Auto-reload + Zustand persist restores state                                             |
| Network disconnect             | WebSocket onclose / navigator.onLine   | Exponential backoff reconnect + local cache offline read + incremental sync on reconnect |
| API request failure            | TanStack Query retry                   | Auto-retry (exponential backoff) + error report + user notification                      |
| State corruption               | Zustand middleware validation          | Detect invalid state → reset to defaults + report                                        |

##### Code Quality Automation

- **Pre-commit hooks**: `vp check --fix` (lint + format + type check) — guarantee baseline quality before code enters the repo
- **Automated PR review**: MiniChen already has this capability — auto-checks code style, potential bugs, dependency changes
- **Dependency audit**: Regular dependency vulnerability scanning (`pnpm audit`), automated in CI

##### Progressive Rollout + Auto-Rollback

- New versions roll out to a small group first (internal → beta → general availability)
- ohbug monitors error rate in real-time → auto-rollback when error rate exceeds threshold
- Combined with OS data, can precisely determine "whether the new version introduced the problem" (user behavior patterns unchanged but errors increased → code issue)

### 4.3 Speed

> Original: bun + viteplus / The best third-party libraries / The best algorithms

**Tech selection principles:**

| Layer           | Choice                  | Rationale                                         |
| --------------- | ----------------------- | ------------------------------------------------- |
| Package Manager | pnpm (wrapped by Vite+) | Best monorepo support, workspace protocol         |
| Build           | Vite+ (vp command)      | bun speed + Vite ecosystem + unified oxlint/oxfmt |
| Runtime         | bun                     | Native TS execution, no compilation step needed   |
| Checking        | `vp check --fix`        | One command: type check + lint + format           |
| Testing         | `vp test` (Vitest)      | Same transform pipeline as Vite                   |

**Third-party library selection criteria:**

1. **bundle size** — Use tree-shakable over monolithic whenever possible
2. **Maintenance activity** — GitHub last commit < 3 months
3. **Type safety** — Native TypeScript preferred
4. **Zero dependencies preferred** — Avoid introducing sub-dependencies when possible

**Algorithm optimization directions:**

- Virtual list (long chat message lists) — `@tanstack/virtual` or similar
- Incremental diff rendering (streaming scenarios)
- Web Worker for compute-intensive tasks (source map resolution, etc.)
- WASM acceleration (potentially for tree-sitter in the browser)

### 4.4 UX

**Overarching principle: The user shouldn't be able to tell it's a WebView.**

#### Confirmed Decisions

- **Input box**: Use a rich text editor (ProseMirror/TipTap, etc.) for a better experience. The team has extensive experience.
- **Scrolling**: The team has extensive experience handling this (auto-scroll, virtual lists, etc.) — not a risk.
- **Dark mode / fonts / animation / drag & drop / context menus**: Mature solutions exist for all; solvable.

#### 🔴 Needs Key Attention: Keyboard Shortcut Routing

Both WebView and Swift listen for keyboard events, which may conflict.

**Decision principle: Stability first.** Where to handle a shortcut depends on where we get the best stability — both stability of usage and stability during development. Prefer WebView handling where possible, but if WebView handling is unstable, let Swift handle it.

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

#### 🔴 Needs Key Attention: Multi-Window Architecture

**Many Chat windows will be open simultaneously, each Chat window being an independent WebView.**

This raises several UX-level questions:

1. **State consistency**: Window A toggles dark mode → Window B must change immediately too. Font size, theme, user preferences — all WebViews must stay in sync.
2. **Window identification**: With multiple chat windows open simultaneously, how does the user tell them apart? Show session name in the title bar? Color-code windows?
3. **Focus management**: User is typing in Window A's input box, switches to Window B → focus should automatically go to B's input box. WebView focus behavior needs to be linked with native window activation events.
4. **Window memory**: Close the app and reopen — should the previous multi-window layout (positions, sizes, which sessions were open) be restored?
5. **Resource consumption**: 10 WebViews = 10 React instances = 10× memory. An upper limit needs to be considered.

**Implementation approach:**

- Swift `WindowManager` manages creation/destruction/restoration of all `NSWindow` + `WKWebView` instances
- Each WebView fetches the latest state from the Santi API on startup (no direct communication between WebViews)
- User preference changes are broadcast via Santi WebSocket to all connected WebViews
- Window layout information persisted locally (Swift `UserDefaults` or file)

#### UX Design Principles

| Principle                                                  | Meaning                                                                                                                        |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| **"The user shouldn't be able to tell it's a WebView"**    | If this standard is met, the UX is a success                                                                                   |
| **Stability first**                                        | Whether a feature is implemented in WebView or Swift depends on which is more stable (usage stability + development stability) |
| **System fonts + system colors + system animation curves** | Visually consistent with macOS                                                                                                 |
| **Never show web artifacts**                               | No loading spinners, no 404s, no browser error pages                                                                           |
| **Zero latency on high-frequency interactions**            | Typing, scrolling, keyboard shortcuts — no perceptible delay                                                                   |

---

## 5. Existing Project Reuse Plan

### 5.1 ohbug (SDK monorepo) → Observability Foundation

| Package          | Purpose                                                      | Reuse Method       |
| ---------------- | ------------------------------------------------------------ | ------------------ |
| `@ohbug/core`    | Error event management, extension system, reporting pipeline | Direct npm install |
| `@ohbug/browser` | Browser error capture (includes error-stack-parser)          | Direct npm install |
| `@ohbug/react`   | React Error Boundary + hooks                                 | Direct npm install |
| `@ohbug/types`   | Shared type definitions                                      | Direct npm install |
| `@ohbug/utils`   | Utility functions                                            | Direct npm install |

**Needs to be added:**

- `@ohbug/webview` — WebView bridge error capture plugin (Swift↔WebView communication errors, bridge timeouts)
- rrweb integration package (extracted from ohbug-dashboard)

### 5.2 ohbug-dashboard → Observability Panel Components

| Module                               | Content                         | Reuse Method                                  |
| ------------------------------------ | ------------------------------- | --------------------------------------------- |
| `components/issue-list.tsx`          | Issue list                      | Migrate to new React SPA                      |
| `components/issue-detail-tabs.tsx`   | Issue detail tabs               | Migrate to new React SPA                      |
| `components/issue-related-rrweb.tsx` | Session Replay player           | Migrate to new React SPA                      |
| `components/event-detail-stack.tsx`  | Error Stack display             | Migrate to new React SPA                      |
| `components/stack-info.tsx`          | Stack info parsing              | Migrate to new React SPA                      |
| `components/charts/*`                | Error trend charts, perf charts | Migrate to new React SPA                      |
| `components/alert-list.tsx`          | Alert management                | Migrate to new React SPA                      |
| `components/data-table/`             | Data table component            | Migrate to new React SPA                      |
| `services/*`                         | API request layer               | Rewrite, connect to Santi backend             |
| `packages/server/`                   | NestJS backend                  | Gradually replace with Santi endpoint or oRPC |

**Migration path:**

```
现在：  Next.js SSR + NestJS + Prisma/PostgreSQL
  ↓
目标：  Vite+ React SPA（嵌入 Paperboy）+ Santi backend
```

The ongoing migration work on the current `feature/shadcn` branch continues, but the goal shifts from "standalone application" to "embeddable component package."

### 5.3 kly + ohbug — Two Sides of One System

> **Detailed document:** [Observability System Design](./observability-system-design.md) — covers ohbug SDK/Dashboard architecture, kly code index, `enrich_error_stack` detailed design, OS context integration, and the complete observability system design.

> kly and ohbug are complementary. The file-level index that kly organizes can be combined with error stacks.

kly is the **static perspective** (code structure, dependency relationships, file metadata); ohbug is the **runtime perspective** (error scenes, user behavior, sessions). The Error Stack is their **intersection point** — a filename + line number that connects both worlds.

#### Why They Must Be One System

**Error Stack without kly (traditional mode):**

```
TypeError: Cannot read property 'content' of undefined
    at renderMessage (MessageList.tsx:142)
    at Array.map (<anonymous>)
    at ChatPanel (ChatPanel.tsx:87)
```

→ You only know line 142 blew up. Then you manually dig through code and manually assess the blast radius.

**Error Stack with kly + ohbug combined (target mode):**

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

→ You know not only **where it blew up**, but also **why it might have blown up** (who changed it recently), **how big the impact is** (5 consumers will be affected), and **how to fix it** (look at the imports to see where the data comes from).

#### How They Combine

| kly Provides                                     | ohbug Provides             | Combined Capability                                                                                                             |
| ------------------------------------------------ | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| File description + symbols                       | Error Stack line number    | Semantic explanation of the error location (not just a line number — it's "the render function of the message list")            |
| dependency graph                                 | Error file                 | Risk propagation path (which other modules will this error affect)                                                              |
| git history per file                             | error event timeline       | Causal correlation ("this file was changed 3 days ago → errors started since then")                                             |
| LLM-generated file metadata                      | error context              | Auto-generated human-readable error reports (not a stack trace for engineers — a "what happened" for everyone)                  |
| File modification frequency + dependency fan-out | Historical error frequency | **Defect prediction heatmap**: high modification frequency × high dependency fan-out × historically high error rate = risk zone |

#### Data Flow

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

#### kly Capability Details

| Capability                  | Purpose                                                       | Integration Method          |
| --------------------------- | ------------------------------------------------------------- | --------------------------- |
| tree-sitter AST parsing     | Precisely understand file structure (imports/exports/symbols) | kly MCP server              |
| dependency graph            | Risk propagation prediction, PR impact analysis               | kly MCP `graph` command     |
| FTS5 search + LLM rerank    | MiniChen searches the codebase during PR review               | kly MCP `query` command     |
| git-aware incremental build | Automatically update index on every commit                    | `kly hook install`          |
| LLM file metadata           | Semantic descriptions for enriched error reports              | kly MCP `show` command      |
| MCP server                  | Unified access point for all agents                           | `kly mcp` (stdio transport) |

---

## 6. Migration Strategy — Full Rebuild, Not Incremental Migration

### 6.1 The Underlying Logic of the Migration

**Current state:** Swift frontend ↔ Santi (Three-Body, protobuf communication) → SwiftUI rendering
**Target state:** React frontend ↔ Santi (direct JSON/WebSocket) → WebView rendering

**This is not a "migration" — it's rebuilding the frontend with a new tech stack. Santi stays unchanged; only its consumer is being swapped.**

Core decisions:

- **Everything visible in the entire application is a WebView** — Sidebar, Chat, Workspace, Settings are all written in React. There will be no hybrid state of "SwiftUI Sidebar + React Chat."
- **Completely delete the existing SwiftUI frontend** — No maintaining two codebases, no serving two frontends.
- **Protobuf is no longer needed** — Santi directly sends final data to the React WebView via JSON/WebSocket. The communication protocol is drastically simplified. See [Communication Protocol Redesign](./communication-protocol.md) for the full oRPC migration plan.
- **Swift retains only system-native logic** — Permission handling, window management, OS data collection, launching the Santi subprocess.

**Key architectural decision: The frontend + Santi are packaged as a single TypeScript executable, launched by Swift as a subprocess.**

This means:

- Very little Swift-side code (window management + permissions + OS collection + process management)
- Swift is no longer a black box — all business logic is in TypeScript, directly observable via ohbug
- Santi is no longer a standalone daemon — it's part of the app, its lifecycle is tied to the app
- No "transitional state" — there is no phase where two UIs coexist

### 6.2 Engineering Structure

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

### 6.3 SPA Loading Method

**Development environment:** Vite dev server (:5173) + HMR, API requests proxied to Santi (:3000)
**Production environment:** Santi simultaneously serves static files + API + WebSocket, all on the same localhost port

```
┌───────────────────────────────────────────────────┐
│                Santi (localhost:PORT)               │
│                                                    │
│  GET /*           → serve React SPA 静态文件        │
│  GET /api/*       → API 路由                       │
│  WS  /ws          → WebSocket (streaming, 实时推送) │
└───────────────────────────────────────────────────┘
```

Reasons for choosing localhost over file://:

- Santi is already an HTTP server; adding static serving is nearly zero-cost
- Frontend + API same-origin → zero CORS issues
- WebSocket same-origin → no additional configuration needed
- Some Web APIs behave inconsistently under file:// (Service Worker, etc.)

**Swift startup flow:**

1. `ProcessManager.swift` → launch `bun dist/server/index.js` (Santi subprocess)
2. Wait for health check `GET /api/health` to return 200
3. Create `NSWindow` + `WKWebView` → load `http://localhost:PORT`

**Build artifacts:**

```
dist/
├── web/           ← React SPA 构建产物 (vp build)
│   ├── index.html
│   └── assets/
└── server/        ← Santi bundle (bun build)
    └── index.js
```

### 6.4 Rebuild Phases

#### Phase 0: Prior Validation ✅

- Inkwell panel: React 19 + Vite + Zustand + Tailwind running stably inside WKWebView
- PostBox SDK: Swift ↔ WebView bridge communication verified
- Artifacts panel, file previewer already running on the WebView architecture

#### Phase 1: Infrastructure Setup

> **Detailed document:** [Phase 1: End-to-End Verification](./phase1-e2e-verification.md) — step-by-step execution plan, dual-protocol coexistence strategy, React SPA scaffolding, streaming verification, Swift shell implementation, and the full verification checklist.

- Set up monorepo structure (native/ + packages/web + packages/santi + packages/shared)
- Add HTTP static serving + WebSocket endpoint to Santi
- Switch Santi communication protocol from protobuf to JSON/WebSocket
- Implement the ultra-thin Swift shell: `ProcessManager` (launch Santi subprocess) + `WindowManager` (WKWebView windows)
- Verify the full chain: Swift launch → Santi serve → WebView load → React → API communication

#### Phase 2: Core UI Rebuild

> **Detailed document:** [Phase 2: Core UI Rebuild](./phase2-core-ui-rebuild.md) — Spaces→Project redesign, Chat/Sidebar/Settings/Workspace detailed breakdown, Santi proto-to-oRPC migration table, acceptance checklist, and risk analysis.

**Rebuild all visual modules in parallel** (there is no question of "which to migrate first" — rebuild everything, ship together):

- **Chat UI**: Message list + input box + message queue + streaming + markdown/code blocks + attachment preview
- **Sidebar**: Session list, Spaces, search
- **Workspace**: Merge Inkwell, artifacts panel, file previewer, diff viewer
- **Settings**: Configuration pages

Note: React streaming chat has been validated by the entire industry (ChatGPT/Claude/Cursor/v0). Sidebar + Settings are pure CRUD UI — far simpler to implement in React than SwiftUI.

#### Phase 3: The Switch

> **Detailed document:** [Phase 3: Switch + Cleanup + Observability](./phase3-switch-and-observability.md) — SwiftUI removal plan, Protobuf cleanup file list, PostBox retention rationale, ohbug+kly integration points, testing requirements, and overall timeline.

- New React frontend passes the acceptance checklist
- **One-shot switch**: Delete all SwiftUI View code, Swift networking layer, protobuf definitions
- Swift retains only: window management + permissions + OS collection + subprocess management
- @ohbug/browser + @ohbug/react integration
- kly MCP integration

#### Phase 4: Observability Goes Live

> **Detailed documents:** [Phase 3: Switch + Cleanup + Observability §3C–3D](./phase3-switch-and-observability.md) + [Observability System Design](./observability-system-design.md)

- ohbug-dashboard components migrated in
- Error Stack → commit/line + kly enrichment pipeline connected end-to-end
- OS data + ohbug data converge in the cloud
- Unified entry point (Slack + Linear + GitHub + Paperboy bot → Observability platform)
- Daily product health report auto-generation

**Bug handling strategy:** During the rebuild, the existing SwiftUI version continues to serve users. Severe bugs (P0/P1) are fixed in the old code; less severe ones are deferred — these bugs will most likely not exist in the new WebView version.

---

## 7. Risks & Mitigations

### 7.1 Risks During the Rebuild

> Note: Since we are adopting a full rebuild strategy (not incremental migration), the "two UIs coexisting" and "Santi dual API" problems do not exist.

| Risk                                          | Severity  | Details                                                                                                                           | Mitigation                                                                                                                               |
| --------------------------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| ~~Two UIs coexisting interop~~                | ~~N/A~~   | ~~Does not exist. The entire frontend is rebuilt with WebView at once; there will be no SwiftUI + React hybrid state.~~           | —                                                                                                                                        |
| ~~Santi dual API burden~~                     | ~~N/A~~   | ~~Does not exist. After completely deleting the SwiftUI frontend, Santi serves only React; protobuf is no longer needed either.~~ | —                                                                                                                                        |
| Bug handling judgment for old version         | 🟡 Medium | During the rebuild, the old SwiftUI version continues to serve users. Fix severe bugs or not?                                     | P0/P1 fixed in old code. P2+ deferred — these bugs will most likely not exist in the new WebView version.                                |
| Feature Parity acceptance criteria            | 🟡 Medium | When is the React version considered "ready to ship"?                                                                             | Write a clear acceptance checklist in Phase 3; switch only when the entire checklist passes.                                             |
| Unable to iterate new features during rebuild | 🟡 Medium | A full rebuild means the team's energy is focused on the rebuild; new features are paused.                                        | Keep the rebuild cycle to 4–6 weeks. Only fix P0/P1 during this period. After the rebuild, new features are developed directly in React. |

### 7.2 Risks After Migration Completion

| Risk                                           | Severity  | Details                                                                                                                                                                                                          | Mitigation                                                                                                                                                                                         |
| ---------------------------------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WKWebView content process killed by the system | 🔴 High   | Under macOS memory pressure, jetsam may kill the WKWebView content process → entire UI goes white. Electron wouldn't (Chromium has independent processes), but WKWebView is subject to system memory management. | Implement `webViewWebContentProcessDidTerminate` → auto reload. React uses Zustand persist to save critical state. User experiences only a brief flicker, no data loss.                            |
| localhost security exposure                    | 🔴 High   | Santi listens on localhost:PORT — any application on the machine can connect to this port, potentially reading user data or injecting messages.                                                                  | ① Random port at launch ② Swift generates a one-time token, WebView carries it with requests ③ Santi validates the token ④ Consider Unix socket instead of TCP (only the local process can access) |
| Longer startup time                            | 🔴 High   | Currently Swift renders in under a second. After rewrite: Swift → spawn Bun → Santi ready → health check → WebView load → React hydrate → API → render. Could be 2–4 seconds of blank window.                    | ① Swift shows a native splash/loading animation first ② Santi pre-launch (launchd login item) ③ React uses skeleton screen to show a scaffold first                                                |
| Santi process crash → entire UI down           | 🔴 High   | If Santi crashes → localhost unreachable → WebView goes white. Currently SwiftUI runs in the same process; "backend down" doesn't exist.                                                                         | Swift monitors the Santi process (process monitoring) → auto-restart on crash → WebView shows fallback → ohbug records the crash                                                                   |
| App size bloat                                 | 🟡 Medium | Currently ~30–50MB. Adding Bun runtime (~50–90MB) + Santi bundle + React SPA could reach ~100–150MB.                                                                                                             | Bun runtime is the bulk; watch for Bun team's binary size optimizations. Or consider requiring users to pre-install Bun.                                                                           |
| WebKit version not controllable                | 🟡 Medium | WKWebView uses the system WebKit. macOS 13's WebKit ≠ macOS 15's. CSS/JS behavior may differ.                                                                                                                    | Determine minimum macOS version → corresponding WebKit version. Run multi-version tests in CI. Use feature detection.                                                                              |
| Native feel degradation                        | 🟡 Medium | Scrollbars/text selection/context menus/drag & drop/IME/spell check/accent color — each individually non-fatal, but accumulated, the user feels "something's off."                                               | Build a comparison checklist item by item. Prioritize high-frequency interactions (scrolling, selection, shortcuts). Minor differences on low-frequency interactions are acceptable.               |
| Multi-process resource consumption             | 🟡 Medium | Swift + Bun/Santi + WKWebView content process + WKWebView networking process = 4–6 processes. Laptop users care about battery.                                                                                   | Monitor CPU/memory baseline. Ensure low power consumption at idle. Consider Santi throttling when inactive.                                                                                        |
| Code signing / Notarization                    | 🟡 Medium | Bundling the Bun binary into the .app bundle — Apple notarization may flag it as an unknown binary.                                                                                                              | Run the full notarization flow early. Confirm the Bun binary can be codesigned + notarized.                                                                                                        |
| Chat streaming performance                     | 🟢 Low    | Every agent product in the React ecosystem implements streaming chat with TS+React; the ecosystem is extremely mature. The current SwiftUI implementation is actually the disadvantage.                          | —                                                                                                                                                                                                  |
| Bridge performance bottleneck                  | 🟢 Low    | Under the cloud architecture, the bridge only handles system-level operations — it doesn't transfer data.                                                                                                        | —                                                                                                                                                                                                  |

---

## 8. Timeline (Aligned with 6/1 Target)

| Timeframe   | Milestone                                                  |
| ----------- | ---------------------------------------------------------- |
| 3/28 – 4/4  | Phase 1: Chat WebView prototype + benchmark                |
| 4/5 – 4/18  | Phase 2: Chat full migration                               |
| 4/19 – 4/30 | Phase 3: Sidebar + Settings + Observability first version  |
| 5/1 – 5/15  | Phase 4: Shell minimization + ohbug full integration       |
| 5/16 – 6/1  | Phase 5: Full observability + unified entry point + polish |

---

## 9. Appendix

### A. Related Project Repositories

- `~/work/paperboy` — Paperboy macOS app (Swift/SwiftUI + Santi daemon)
- `~/work/ohbug` — Error tracking SDK monorepo (already migrated to Vite+)
- `~/work/ohbug-dashboard` — Error tracking dashboard (`feature/shadcn` branch migration in progress)
- `~/work/kly` — Codebase file-level indexing tool (already on Vite+)

### B. Existing WebView Architecture References

- `packages/inkwell/` — Validated React + WKWebView architecture
- PostBox SDK — Swift↔WebView bridge communication protocol
- Liquid Glass framework design (2026-03-27) — A more general Swift + WebView + Bun architecture concept

### C. Design Decision Records

| Decision           | Choice           | Alternatives            | Rationale                                                        |
| ------------------ | ---------------- | ----------------------- | ---------------------------------------------------------------- |
| UI Framework       | React            | SwiftUI / Flutter / Vue | Team expertise + best ecosystem + cross-platform ability         |
| Build Tool         | Vite+ (bun)      | Webpack / Turbopack     | Speed + unified toolchain                                        |
| Observability      | ohbug (in-house) | Sentry / Datadog        | Full control + existing code + zero cost                         |
| Code Indexing      | kly (in-house)   | CodeQL / Sourcegraph    | Lightweight + MCP-native + tree-sitter already integrated        |
| Migration Strategy | Incremental      | Full rewrite            | Controllable risk + each step reversible + product doesn't stall |
