# Phase 1: End-to-End Pipeline Verification

> Created: 2026-03-28
> Author: Xinyao Chen
> Status: Draft
> Related Documents:
>
> - [Paperboy Frontend Rewrite Plan](./paperboy-frontend-rewrite_zh-CN.md)
> - [Communication Protocol Redesign](./communication-protocol_zh-CN.md)
> - [Observability System Design](./observability-system-design.md)

This document is the execution plan for Phase 1 of the Paperboy frontend rewrite. Its sole goal is to prove that the full end-to-end pipeline — Swift native shell → Santi backend → WKWebView → React SPA → oRPC (request/response + streaming) — works correctly before any real UI is built. Covers oRPC server setup, shared type packages, React SPA scaffolding, WebView mounting, streaming verification, and acceptance criteria.

### Architecture Overview

```
┌───────────────────────────────────────────────────────────────────┐
│                     macOS Native Shell (Swift)                    │
│                                                                   │
│  ┌─────────────────┐    ┌──────────────────────────────────────┐  │
│  │ ProcessManager   │    │           WKWebView                  │  │
│  │ launches Santi   │    │                                      │  │
│  │ child process    │    │  ┌──────────────────────────────────┐│  │
│  └────────┬────────┘    │  │      React SPA (Vite+)           ││  │
│           │              │  │                                   ││  │
│           │  spawn       │  │  oRPC WS Client (partysocket)    ││  │
│           ▼              │  │         │                         ││  │
│  ┌─────────────────┐    │  └─────────┼─────────────────────────┘│  │
│  │ Santi (Bun)      │    │           │ WebSocket /rpc            │  │
│  │                  │◄───┼───────────┘                           │  │
│  │  /rpc  → oRPC WS │    │                                      │  │
│  │  /api/* → OpenAPI │    │  Renders health check result         │  │
│  │  /ws   → Protobuf │    │  + streaming demo output             │  │
│  │  (legacy, kept)  │    └──────────────────────────────────────┘  │
│  └─────────────────┘                                              │
└───────────────────────────────────────────────────────────────────┘
```

## 1. Objective

**Prove that the Swift → Santi → WKWebView → React → oRPC → Render pipeline works end-to-end.**

No real UI will be built (no Chat, no Sidebar, no Settings). Only a minimal verification page to validate oRPC request/response and streaming.

**Completion Criteria:** After the macOS app launches, a React page is displayed inside WKWebView. The page fetches data from Santi via oRPC WebSocket and renders it, and a streaming demo runs successfully.

---

## 2. Execution Steps

### Step 1: Mount oRPC on Santi (Bun WS Adapter)

**Objective:** Add an oRPC RPCHandler to Santi's existing WS server and implement the first procedure.

**Deliverables:**

- `packages/santi/src/rpc/router.ts` — oRPC router definition
- `packages/santi/src/rpc/procedures/system.ts` — `system.health` procedure
- Santi Bun server mounts both:
  - Legacy Protobuf WS (`/ws` path, unchanged)
  - New oRPC WS (`/rpc` path)
  - New OpenAPI HTTP (`/api/*` path)
- Verification: `curl http://localhost:PORT/api/system.health` returns JSON

**Out of scope:** No changes to existing business logic or the Protobuf path.

**New dependencies:**

```json
{
  "@orpc/server": "latest",
  "@orpc/openapi": "latest",
  "zod": "latest"
}
```

**Dual-protocol coexistence strategy: differentiate by URL path.**

- `/ws` → Legacy Protobuf WebSocket (existing Swift client continues to use)
- `/rpc` → New oRPC WebSocket (for React)
- `/api/*` → New oRPC OpenAPI HTTP (for Swift)
- `/health` → Existing health check remains unchanged

### Step 2: packages/shared + packages/web Scaffolding + oRPC Integration

**Objective:** Create the shared type package and React SPA project, connect to Santi via oRPC WebSocket client, and validate `system.health`.

**Step 2a: packages/shared — Shared Types and Contracts**

`packages/shared` holds types and constants shared between `packages/web` and `packages/santi`. This avoids circular dependencies and provides a single source of truth for the communication contract.

**Deliverables:**

- `packages/shared/` — pure TypeScript, no runtime dependencies
- `packages/shared/src/router.ts` — re-exports the `Router` type
- `packages/shared/src/errors.ts` — error codes (see Communication Protocol §3.5)
- `packages/shared/src/postbox.ts` — PostBox message & event type definitions (`PostBoxAction`, `NativeEvent`)
- `packages/shared/src/types/` — shared business types (Session, Project, Message, etc.)
- `packages/web/src/lib/postbox/` — `PlatformAdapter` interface, `WKWebViewAdapter`, adapter auto-detection
- `packages/web/src/lib/channels/native.ts` — typed native channel wrapping PostBox adapter
- `packages/web/src/lib/pb.ts` — unified `pb.*` entry point (oRPC + native channel)

```json
// packages/shared/package.json
{
  "name": "@paperboy/shared",
  "type": "module",
  "exports": {
    "./*": "./src/*"
  },
  "devDependencies": {
    "typescript": "latest",
    "zod": "latest"
  }
}
```

Both `packages/web` and `packages/santi` add `"@paperboy/shared": "workspace:*"` to their dependencies.

**Step 2b: packages/web — React SPA**

**Deliverables:**

- `packages/web/` — React 19 + Vite+ + Tailwind v4 + shadcn + Zustand
- oRPC WebSocket client configuration (with `partysocket` for auto-reconnect)
- A minimal page displaying "Connected to Santi" + health check result

**Tech Stack (confirmed):**

| Layer         | Choice                                |
| ------------- | ------------------------------------- |
| Framework     | React 19 + TypeScript                 |
| Build         | Vite+ (`vp` command)                  |
| CSS           | Tailwind CSS v4 + shadcn/ui           |
| State         | Zustand                               |
| Routing       | TanStack Router                       |
| Data Fetching | TanStack Query + @orpc/tanstack-query |
| oRPC Client   | @orpc/client/websocket (RPCLink)      |
| WS Reconnect  | partysocket                           |

**oRPC Client Configuration:**

```typescript
import PartySocket from "partysocket";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/websocket";
import type { Router } from "@paperboy/shared/router";

const ws = new PartySocket({
  host: `localhost:${PORT}`,
  path: "/rpc",
  minReconnectDelay: 500,
  maxReconnectDelay: 5000,
  reconnectDecay: 1.5,
});
const link = new RPCLink({ websocket: ws });
const client = createORPCClient<Router>(link);
```

**Type Sharing:** `packages/web` imports types from `@paperboy/shared` (pnpm workspace reference). The `Router` type is re-exported from shared so web doesn't directly depend on santi.

**Development Environment:**

- Vite dev server (`:5173`) runs the React SPA
- Develop in Chrome (DevTools + HMR available)
- WebSocket connects to Santi (`:7654/rpc`)
- Day-to-day development does NOT happen inside WKWebView
- Vite proxy config forwards `/rpc` and `/api` to Santi to avoid CORS issues during development:

```typescript
// packages/web/vite.config.ts
export default defineConfig({
  server: {
    proxy: {
      "/rpc": { target: "ws://localhost:7654", ws: true },
      "/api": { target: "http://localhost:7654" },
    },
  },
});
```

### Step 3: Streaming Verification

**Objective:** Implement a demo streaming procedure and have React consume it in real time.

**Deliverables:**

- `chat.streamDemo` procedure — yields one event every 100ms (simulating agent streaming)
- React page displays streaming events in real time
- Verify Event Iterator over WebSocket works correctly
- Verify reconnection recovery (lastEventId)

**Out of scope:** No real agent engine integration; pure mock data only.

**Server-side demo:**

```typescript
const chatStreamDemo = os
  .input(z.object({ message: z.string() }))
  .output(
    eventIterator(
      z.object({
        type: z.enum(["delta", "done"]),
        content: z.string(),
      }),
    ),
  )
  .handler(async function* ({ input }) {
    const words = input.message.split(" ");
    for (const word of words) {
      yield { type: "delta", content: word + " " };
      await new Promise((r) => setTimeout(r, 100));
    }
    yield { type: "done", content: "" };
  });
```

### Step 4: Minimal Swift Shell

**Objective:** Swift app can create a WKWebView and load `localhost:PORT`.

**Deliverables:**

- A new minimal Swift target or a slimmed-down version of the existing project
- `WindowManager` — creates NSWindow + WKWebView
- `ProcessManager` — launches Santi child process (reuses existing DaemonManager logic)
- `PostBoxHandler` — implements `WKScriptMessageHandlerWithReply` for bidirectional React ↔ Swift communication (see Communication Protocol §2.2 for full design)
- WKWebView loads `http://localhost:PORT`
- Swift calls `/api/system.health` via URLSession

**PostBox integration notes:**

- `PostBoxHandler` uses the `WKScriptMessageHandlerWithReply` long-poll pattern — no `callAsyncJavaScript`, no global JS function injection
- React → Swift: `postMessage({ type: "action", ... })` → Swift reply handler responds
- Swift → React: `postMessage({ type: "listen" })` hangs until Swift calls `emit()`, then re-registers
- For Phase 1, only `window.close` and a `ping` action are needed to verify the pipeline
- Full action set (`window.create`, `notification.send`, `clipboard.read`, etc.) will be added incrementally in Phase 2

**Decision: Slim down vs. New target?**

| Approach                   | Pros                                                        | Cons                                                                    |
| -------------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------- |
| Slim down existing project | Preserves mature logic (DaemonManager, OS collection, etc.) | Thousands of lines of SwiftUI code to remove; easy to miss dependencies |
| Create new minimal target  | Clean start from scratch                                    | Must re-integrate DaemonManager, PermissionManager, OS collection       |

**Leaning toward slimming down** — DaemonManager logic is complex (process management, crash recovery, health check); rewriting it is not worth the effort. Don't delete SwiftUI yet — let the new WebView and old SwiftUI coexist in parallel.

**WKWebView configuration notes:**

- Add `NSAllowsLocalNetworking = true` to `Info.plist` (ATS)
- Multiple windows share the same `WKWebsiteDataStore`
- Token injection via `WKUserScript` before page load

**WKWebView debugging:**

- Enable Safari Web Inspector for WKWebView: set `webView.isInspectable = true` (requires macOS 13.3+ / iOS 16.4+, debug builds only)
- In Safari: Develop menu → select the Mac → select the WKWebView target
- Full access to Elements, Console, Network, Sources panels — same as debugging a regular web page
- For production builds, `isInspectable` should be `false` (or guarded behind `#if DEBUG`)

```swift
#if DEBUG
webView.isInspectable = true
#endif
```

### Step 5: End-to-End Verification

**Objective:** Full startup pipeline runs successfully.

**Verification Checklist:**

- [ ] Swift app launches
- [ ] DaemonManager starts Santi child process
- [ ] Santi health check passes
- [ ] WKWebView is created and loads `http://localhost:PORT`
- [ ] React SPA renders
- [ ] oRPC WebSocket connection is established
- [ ] `system.health` call succeeds; result is displayed on page
- [ ] Streaming demo runs; events render in real time
- [ ] PostBox action: React calls `pb.window.ping()` → Swift replies successfully
- [ ] PostBox event: Swift calls `postBoxHandler.emit("ping")` → React receives and displays
- [ ] Swift fetches data via `/api/agent.status` (simulating Orb)
- [ ] App close → Santi process exits cleanly

---

## 3. Risks and Mitigations

### 3.1 Dual-Protocol Coexistence (Step 1)

**Risk:** Legacy Protobuf WS and new oRPC WS coexisting on the same Bun server.

**Mitigation:** Differentiate by URL path. Bun `server.upgrade(req)` can route based on `req.url`:

- `/ws` → Legacy Protobuf handler
- `/rpc` → New oRPC handler

During Phase 4 cleanup, simply remove the `/ws` path.

### 3.2 Developer Experience / HMR / CORS (Steps 2–3)

**Risk:** No HMR inside WKWebView, leading to low development efficiency. Cross-origin issues when Vite dev server (`:5173`) connects to Santi (`:7654`).

**Mitigation:** Develop in Chrome; use WKWebView only for verification.

- Vite dev server (`:5173`) provides HMR
- Vite proxy config forwards `/rpc` (WS) and `/api` (HTTP) to Santi (`:7654`), eliminating CORS issues during development
- When running inside WKWebView, same-origin (both served from Santi's port), so no CORS issues
- Santi's OpenAPIHandler also has `CORSPlugin` as a safety net

### 3.3 Type Sharing (Step 2)

**Risk:** `packages/web` needs to import the `Router` type.

**Mitigation:** Use pnpm workspace reference. Add to `packages/web/package.json`:

```json
{
  "devDependencies": {
    "@paperboy/santi": "workspace:*"
  }
}
```

Then `import type { Router } from '@paperboy/santi/rpc/router'`.

### 3.4 WKWebView Security (Step 4)

**Risk:** ATS blocks HTTP localhost; transparent background uses private API.

**Mitigation:**

- ATS: Add `NSAllowsLocalNetworking = true` to `Info.plist`
- Transparent background: Inkwell already uses `setValue(false, forKey: "drawsBackground")`, verified to pass App Review
- Cookie/Storage isolation: Multiple windows share the same `WKWebsiteDataStore`

### 3.5 Startup Timing (Step 5)

**Risk:** WebView loads before Santi is ready, resulting in a white screen.

**Mitigation:** Reuse DaemonManager's existing `waitForSantiReady()` logic — polls `/health` until it returns 200, then creates the WebView. Already has a 30-second timeout + automatic retry.

### 3.6 Orb Integration (Deferred)

**Risk:** Coordination between Orb and Chat Window (click Orb → open Chat).

**Mitigation:** Not addressed in this phase. Orb retains its existing SwiftUI logic. The WebView Chat Window is verified as a standalone window. Integration is a Phase 2 concern.

---

## 4. Time Estimates

| Step      | Description                                                     | Estimate     |
| --------- | --------------------------------------------------------------- | ------------ |
| 1         | Santi oRPC mounting                                             | 1–2 days     |
| 2a        | packages/shared scaffolding (types, error codes, PostBox types) | 0.5 day      |
| 2b        | packages/web scaffolding + health check integration             | 1 day        |
| 3         | Streaming verification                                          | 1 day        |
| 4         | Swift Shell + WKWebView + PostBox long-poll handler + debugging | 2–3 days     |
| 5         | End-to-end integration testing                                  | 1–2 days     |
| **Total** |                                                                 | **6–9 days** |

---

## 5. Out of Scope for This Phase

The following work is NOT part of Phase 1 and belongs to subsequent phases:

- Chat UI rebuild (Phase 2)
- Sidebar rebuild (Phase 2)
- Settings page (Phase 2)
- Real agent streaming integration (Phase 2)
- SwiftUI code removal (Phase 3)
- Protobuf removal (Phase 3)
- ohbug integration (Phase 4)
- kly integration (Phase 4)
- Orb ↔ Chat Window coordination (Phase 2)
