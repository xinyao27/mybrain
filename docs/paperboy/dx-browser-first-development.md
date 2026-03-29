# DX: Browser-First Development Strategy

> Created: 2026-03-29
> Author: Xinyao Chen
> Status: Draft
>
> **Related Documents:**
>
> - [Frontend Grand Rewrite Plan](./paperboy-frontend-rewrite.md) — The overall rewrite strategy this DX approach enables
> - [Communication Protocol Redesign (oRPC)](./communication-protocol.md) — PostBox / oRPC bridge design that powers the native switch

## 1. Core Insight

Since the frontend rewrite produces a standard React SPA that talks to cloud APIs, **we can develop the entire Agent directly in the browser as a pure Web App**. No Xcode, no Swift compilation, no simulator — just a browser tab.

Once PostBox (the Native ↔ WebView bridge) is implemented and the thin Swift shell is ready, we **switch to a native macOS app with zero UI code changes**. The same React SPA loads inside `WKWebView` instead of a browser tab. That's it.

```
Phase A: Browser-only development
┌─────────────────────────────────────────┐
│              Browser Tab                │
│                                         │
│  React SPA  ──── Cloud API ────  Cloud  │
│  (all UI)        (REST/WS)              │
│                                         │
│  ✅ Full functionality                  │
│  ✅ HMR, DevTools, React DevTools       │
│  ✅ No Xcode, no Swift, no build wait   │
└─────────────────────────────────────────┘

Phase B: One-click switch to native Mac app
┌─────────────────────────────────────────┐
│           macOS Native Shell            │
│  ┌───────────────────────────────────┐  │
│  │         WKWebView                 │  │
│  │                                   │  │
│  │  Same React SPA ── Cloud API     │  │
│  │  (zero code changes)             │  │
│  └───────────────────────────────────┘  │
│                                         │
│  + PostBox bridge (system-level ops)    │
│  + OS data collection                   │
│  + Window management / Orb / Tray       │
└─────────────────────────────────────────┘
```

## 2. Why Browser-First Is the Right Order

### 2.1 The DX Gap Today

Current development loop for Paperboy UI:

```
Edit SwiftUI code → Xcode build (10-30s) → Simulator/device → See result
```

With the rewrite, browser-first DX:

```
Edit React code → Vite HMR (<100ms) → See result in browser tab
```

| Dimension           | SwiftUI (current)     | Browser-first React                            |
| ------------------- | --------------------- | ---------------------------------------------- |
| Hot reload          | Xcode Preview (flaky) | Vite HMR (<100ms, reliable)                    |
| Debug tools         | Xcode + LLDB          | Chrome DevTools + React DevTools + network tab |
| Build time          | 10-30s incremental    | ~0 (HMR)                                       |
| Who can contribute  | Swift developers only | Entire team (React/TS)                         |
| Test in CI          | macOS runner + Xcode  | Any runner + headless browser                  |
| Error investigation | Console.app + Xcode   | Browser console + ohbug + source maps          |

### 2.2 Everything Works Without a Shell

The [cloud-driven three-layer model](./paperboy-frontend-rewrite.md#31-cloud-driven-three-layer-model) already established that:

- **Source of Truth = Cloud.** The React SPA calls cloud APIs directly.
- **Bridge responsibilities are minimal.** Only system-level operations (window management, notifications, Orb, OS collection) go through the Swift bridge.
- **All data flows through cloud APIs.** Chat messages, agent state, observability data, settings — all via REST/WebSocket.

This means the React SPA is **fully functional in a browser**. The only things missing without the native shell are OS-level features (accessibility data collection, screenshots, keystrokes, clipboard monitoring, system notifications, Orb). These are additive capabilities, not prerequisites for the core UI.

### 2.3 Development Parallelism

Browser-first unlocks true parallel development:

```
Team A: React SPA development        (browser, pure web)
         ↓ runs in any browser
         ↓ full UI + chat + sidebar + settings + workspace
         ↓ connects to cloud API

Team B: PostBox + Swift shell         (Xcode, native)
         ↓ window management
         ↓ OS data collection
         ↓ bridge protocol

         ──── merge when both ready ────→  Native Mac App
```

No blocking dependencies. Team A doesn't need Team B's shell to develop, test, or demo the UI. Team B doesn't need the React SPA to be "done" to develop the bridge protocol.

## 3. What PostBox Enables

PostBox is the bridge layer between the native Swift shell and the WebView. When we're ready to switch to the native app, PostBox adds:

| Capability               | Browser mode | Native mode (via PostBox) |
| ------------------------ | :----------: | :-----------------------: |
| Core UI (Chat, Sidebar…) |      ✅      |            ✅             |
| Cloud API access         |      ✅      |            ✅             |
| Observability (ohbug)    |      ✅      |            ✅             |
| Window management        |      ❌      |            ✅             |
| System notifications     |      ❌      |            ✅             |
| Orb / Menu Bar           |      ❌      |            ✅             |
| OS data collection       |      ❌      |            ✅             |
| Keychain token storage   |      ❌      |            ✅             |
| File drag-and-drop       |      ❌      |            ✅             |
| Multi-window management  |      ❌      |            ✅             |

The switch is purely additive. Nothing breaks; the browser version keeps working as a standalone web app even after the native version ships.

### 3.1 PostBox Abstraction Layer

To make this seamless, the React SPA uses a thin abstraction:

```typescript
// The app doesn't know (or care) whether it's in a browser or WKWebView.
// PostBox provides a unified API.

interface PlatformBridge {
  // System-level operations — no-op in browser, real in native
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

// Auto-detected at runtime
const bridge = isWebView()
  ? new NativePostBoxBridge() // real bridge via WKScriptMessageHandler
  : new BrowserFallbackBridge(); // no-op or browser-native alternatives
```

In browser mode, `window.openNew()` could open a new browser tab; `notifications.show()` could use the Web Notifications API. The same code, different behavior — but the core app doesn't care.

## 4. Development Workflow

### 4.1 Day-to-Day Development (Browser)

```bash
# Start the dev server
pnpm dev

# Open browser tab → http://localhost:5173
# Edit code → Vite HMR → instant feedback
# Use Chrome DevTools for debugging
# Use React DevTools for component inspection
# Use Network tab for API debugging
```

No Xcode. No simulator. No Swift compilation. Just a browser and a text editor.

### 4.2 Native Testing (When Needed)

```bash
# Build the React SPA
pnpm build

# Open Xcode project → Run
# Swift shell loads the built SPA in WKWebView
# Test native-specific features (PostBox bridge, window management, OS collection)
```

Native testing is only needed for PostBox integration testing, not for UI development.

### 4.3 CI/CD

```
PR submitted
  │
  ├── Browser tests (fast, any runner)
  │   ├── vp check --fix
  │   ├── vp test (Vitest)
  │   └── Playwright E2E (headless browser)
  │
  ├── Native tests (slower, macOS runner)
  │   └── PostBox bridge integration tests
  │
  └── All pass → merge
```

Browser tests catch 95%+ of issues. Native tests only validate bridge behavior.

## 5. The Pure Web App Angle

Here's the insight that makes this even more powerful: **the browser version isn't just a development convenience — it's a real product**.

A user who doesn't want to install a macOS app can use Paperboy directly in their browser. They get everything except OS-level features. For many use cases (chat with the agent, view workspace, manage settings), this is 100% sufficient.

```
Deployment targets from the same codebase:

1. Browser (web app)        — deploy to any CDN, zero install
2. macOS (native app)       — Swift shell + WKWebView + PostBox
3. Windows/Linux (future)   — Tauri / Electron shell
4. Mobile (future)          — Capacitor / Tauri Mobile
```

One React SPA, four deployment targets, zero UI code duplication.

## 6. Risks & Mitigations

| Risk                                                                 | Severity  | Mitigation                                                                                                                                                        |
| -------------------------------------------------------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Browser version becomes "good enough" → native version deprioritized | 🟡 Medium | Native-only features (OS collection) are the core competitive advantage. Without them, Paperboy is just another chat UI. The native version is where the moat is. |
| PostBox abstraction layer adds complexity                            | 🟢 Low    | The abstraction is thin (~100 lines). Browser fallbacks are simple (no-op or Web API equivalents).                                                                |
| Feature drift between browser and native                             | 🟡 Medium | Strict rule: all UI code lives in the React SPA. PostBox only adds system-level capabilities. UI features never depend on native-only APIs.                       |
| "Works in browser, broken in WKWebView"                              | 🟡 Medium | E2E tests run in both environments. WKWebView quirks are documented and tested early in Phase 1.                                                                  |

## 7. Summary

The frontend rewrite isn't just about React vs SwiftUI. It's about **unlocking the fastest possible development loop**:

1. **Develop in the browser** — fastest HMR, best debugging tools, entire team can contribute
2. **Ship as a web app** — zero install, works everywhere
3. **Switch to native** — PostBox bridge adds OS-level superpowers, same UI code
4. **Scale to any platform** — same SPA, different shells

This is the DX advantage of building on the web platform. The browser is the development environment, the testing environment, and a deployment target — all at once.
