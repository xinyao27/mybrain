# Phase 3: Switch + Cleanup + Observability

> Created: 2026-03-28
> Author: Xinyao Chen
> Status: Draft
> Prerequisites: [Phase 2 Core UI Rebuild](./phase2-core-ui-rebuild.md) completed
> Related documents:
>
> - [Paperboy Frontend Rewrite Plan](./paperboy-frontend-rewrite_zh-CN.md)
> - [Communication Protocol Redesign](./communication-protocol_zh-CN.md)
> - [Observability System Design](./observability-system-design.md)

## 1. Goals

**Switch to the React version in one shot, clean up all legacy code, and integrate the observability system.**

Phase 2 built the React UI. Phase 3 does three things:

1. Remove SwiftUI — React becomes the sole UI
2. Remove Protobuf — oRPC becomes the sole communication protocol
3. Integrate ohbug + kly observability

---

## 2. Execution Plan

### Phase 3A: Switch

- React version passes the Phase 2 acceptance checklist
- Delete all SwiftUI View code
- Swift retains only:
  - `WindowManager` — NSWindow + WKWebView management
  - `ProcessManager` — Santi child process lifecycle (reuses DaemonManager)
  - `PermissionManager` — TCC permissions (Accessibility, Screen Recording, Mic)
  - OS data collection (screenshots, keystrokes, clipboard, mouse, AX tree)
  - Orb / Dynamic Island (NSPanel + animations)
  - PostBox bridge — Swift ↔ WebView bidirectional communication (see §3.1)
  - CGEvent Tap (global hotkeys)
  - MenuBar Extra
  - Sparkle auto-update
  - `paperboy://` URL scheme handler
- WKWebView becomes the sole UI container

### Phase 3B: Protobuf Cleanup

- Delete all `.proto` files in `proto/santi/v1/` (13 files)
- Delete the entire `packages/santi/src/proto/` directory (gen, transport, services, client, server)
- Delete `packages/paperboy/Paperboy/Generated/santi/v1/*.pb.swift` (16 files)
- Delete `SantiClient.swift`
- Remove `@bufbuild/protobuf`, `@bufbuild/protoc-gen-es` dependencies
- Remove Swift's `SwiftProtobuf` package dependency
- Confirm the OS package's `/os` WebSocket path is unaffected (OS does not use Protobuf)

### Phase 3C: ohbug + kly Integration

- Integrate `@ohbug/browser` + `@ohbug/react` into the React SPA
- kly MCP tool extensions (`get_dependents`, `get_file_history`, `enrich_error_stack`)
- Santi imports kly library functions (`KlyService`)
- Error stack + OS context converge in the cloud
- See [Observability System Design](./observability-system-design.md) for details

> **Note: The specific implementation of ohbug and kly is owned by Xinyao directly. Only integration points are documented here — implementation details are not expanded.**

### Phase 3D: Observability Dashboard

- Migrate ohbug-dashboard components into the React SPA
- Enriched Error View (error stack + kly code context + OS screenshots/action traces)
- Daily product health report
- Unified entry point (Slack + Linear + GitHub + Paperboy bot → automated handling)

> **Note: The ohbug-dashboard backend work is owned by Xinyao directly.**

---

## 3. Key Design Decisions

### 3.1 PostBox Retained: Swift ↔ WebView Bidirectional Communication Bridge

While oRPC handles React ↔ Santi and Swift ↔ Santi communication, **Swift and WebView still need direct bidirectional communication** — oRPC cannot cover these scenarios:

| Scenario                                  | Direction       | Why not route through Santi                                                                                     |
| ----------------------------------------- | --------------- | --------------------------------------------------------------------------------------------------------------- |
| Orb click → open/focus a specific session | Swift → WebView | Requires immediate control of WebView internal routing; going through Santi adds an extra hop and is unreliable |
| Global hotkey → trigger action in WebView | Swift → WebView | CGEvent Tap is on the Swift side; needs to notify WebView directly                                              |
| WebView requests window operations        | WebView → Swift | e.g. resize, enter fullscreen, close window — needs direct NSWindow API calls                                   |
| OAuth callback relay                      | Swift → WebView | URL scheme handler is in Swift; token needs to be passed to React immediately                                   |
| File drag & drop                          | Swift → WebView | After native drop zone receives the file, the file path needs to be passed to WebView                           |
| System theme change                       | Swift → WebView | Appearance change notification is on the Swift side                                                             |

**PostBox's responsibilities narrow to:**

- Only handles **direct interactions** between Swift ↔ WebView (window control, navigation, system events)
- **No longer transports business data** (all goes through oRPC)
- Maintains the `WKScriptMessageHandler` + `evaluateJavaScript` bidirectional channel

**Communication overview (final version):**

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

Three communication paths with fully separated responsibilities:

- **oRPC/WS** — React ↔ Santi (all business data)
- **oRPC/HTTP** — Swift ↔ Santi (Orb state, agent events)
- **PostBox** — Swift ↔ WebView (window control, navigation, system events)

### 3.2 Project Data: No Compatibility Migration Needed

The Spaces feature has not shipped yet — there is no user data to migrate. Phase 2 builds tables directly with the Project data model; no migration from Spaces is needed.

### 3.3 Not Going Through the App Store

Paperboy is not distributed through the App Store, so the following review risks do not apply:

- Bun binary bundling notarization → not required
- WKWebView loading localhost → no review needed
- Private API (`drawsBackground`) → unrestricted
- App size bloat → not subject to App Store limits

Distribution method: direct download + Sparkle auto-update.

---

## 4. Testing Requirements

### 4.1 E2E Tests (Playwright)

Written alongside UI development in Phase 2; must all pass before the Phase 3 switch.

**Critical path coverage:**

- [ ] Send message → receive streaming reply → message fully rendered
- [ ] Create Project → create Session under Project → switch Session
- [ ] Tool Call approval flow
- [ ] Attachment upload + preview
- [ ] Message Queue queuing / editing / cancellation
- [ ] Multi-window sync (window A sends message → window B sidebar updates)
- [ ] Settings change → takes effect immediately
- [ ] Disconnect recovery (kill Santi → restart → React auto-reconnects)

### 4.2 Unit Tests

**Coverage target: ≥ 80%**

| Layer                 | Test Framework                 | Coverage Scope                                                          |
| --------------------- | ------------------------------ | ----------------------------------------------------------------------- |
| Santi oRPC procedures | Vitest (`vp test`)             | Input validation, business logic, and error handling for each procedure |
| Santi business logic  | Vitest                         | Core modules: ChatEngine, SessionManager, ProjectManager, etc.          |
| React components      | Vitest + React Testing Library | Message bubbles, input box, sidebar, settings forms                     |
| React Hooks / Stores  | Vitest                         | Zustand stores, custom hooks                                            |
| Shared types          | Vitest                         | Zod schema validation                                                   |

**Testing principles:**

- Every oRPC procedure must have a corresponding unit test
- Every Zustand store must have state mutation tests
- When migrating business logic from proto services, write tests in parallel (lack of tests in old code is not an excuse)
- CI runs `vp test --coverage`; merges are blocked below 80%

---

## 5. Risks

### 5.1 Unexpected Dependencies Broken When Removing SwiftUI

**Risk:** SwiftUI Views are referenced by non-UI code — AppDelegate, notification handlers, URL scheme handlers, Orb callbacks, etc. Deletion causes compilation failures.

**Mitigation:** Before deleting, use Xcode Find References to confirm the reference chain of every file to be removed. Delete from leaf nodes first, verifying compilation incrementally.

### 5.2 Orb ↔ Chat Window Coordination

**Risk:** Clicking the Orb needs to open/focus the Chat Window and navigate to a specific session. The Orb is in Swift; Chat is in the WebView.

**Mitigation:** Solved via the PostBox bridge. Swift side: `PostBox.send("navigate", { sessionId: "xxx" })`; React side: `postbox.on("navigate", ...)` handles route navigation.

### 5.3 OS Package WebSocket Path Must Not Break

**Risk:** The OS package uses the `/os` WebSocket path to send system events to Santi. Cleaning up Protobuf transport code could accidentally delete shared WS infrastructure.

**Mitigation:** The `/os` path handler is independent from the Protobuf transport. During cleanup, verify file by file — delete Protobuf-specific code first (envelope.ts, \*\_pb.ts), then the transport layer, compiling after each step.

### 5.4 Insufficient Test Coverage Causing Regressions

**Risk:** The old SwiftUI version has no automated tests; after the switch, there is no way to confirm complete functional coverage.

**Mitigation:**

- Write E2E + unit tests in parallel during Phase 2 UI development (not as an afterthought)
- Unit test coverage ≥ 80% (CI blocks merges)
- E2E covers all critical paths
- Perform a full manual QA pass before the switch (verify feature-by-feature against the SwiftUI version)

---

## 6. Time Estimates

| Phase     | Content                                               | Estimate      |
| --------- | ----------------------------------------------------- | ------------- |
| 3A        | Switch (remove SwiftUI, retain Swift Shell + PostBox) | 1 week        |
| 3B        | Protobuf cleanup                                      | 2–3 days      |
| 3C        | ohbug + kly integration                               | 1–2 weeks     |
| 3D        | Observability dashboard                               | 1–2 weeks     |
| **Total** |                                                       | **3–5 weeks** |

---

## 7. Overall Timeline

| Phase | Content                          | Estimate  | Cumulative |
| ----- | -------------------------------- | --------- | ---------- |
| 1     | End-to-end pipeline validation   | 1–2 weeks | 1–2 weeks  |
| 2     | Core UI rebuild                  | 5–7 weeks | 6–9 weeks  |
| 3     | Switch + cleanup + observability | 3–5 weeks | 9–14 weeks |

**Alignment with the 6/1 target:** From 3/28 to 6/1 is approximately 9 weeks. Optimistic estimate: just enough to complete Phase 1–3A (switch done). Observability (3C–3D) may need to extend into mid-June.

**Key milestones:**

- Early April: Phase 1 complete (architecture validation passed)
- Early May: Phase 2A–2B complete (Chat + Sidebar usable)
- Mid-May: Phase 2C–2D complete (all UI usable)
- Before 6/1: Phase 3A–3B complete (switch + cleanup)
- Mid-June: Phase 3C–3D complete (observability live)
