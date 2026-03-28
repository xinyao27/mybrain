---
name: create-ts-project
description: "Scaffold new TypeScript projects or migrate existing ones to a standardized Vite+ stack. Use this skill whenever the user wants to: create a new TS/React project, start a new library, set up a monorepo, initialize a fullstack app with API + database, scaffold a Cloudflare Workers project, migrate/convert an existing project to Vite+, or mentions 'vp create', 'new project', 'init project', 'project setup', 'tech stack setup'. Also triggers when the user asks to add oRPC, Drizzle, shadcn, or Cloudflare Workers to a project."
---

# Create TypeScript Project

Scaffold new TypeScript projects or migrate existing ones to a standardized Vite+ tech stack owned by xinyao.

## Step 1: Determine project intent

Before doing anything, ask the user:

> What type of project do you want to create?
> 1. **Frontend app** — React + Tailwind + shadcn (SPA)
> 2. **Library** — publishable npm package
> 3. **Monorepo** — apps/ + packages/ structure
> 4. **Migrate existing project** — convert current project to this stack

If the user already specified the type in their message, skip the question and proceed.

For **migration**, jump to the [Migration](#migration) section.

---

## Step 2: Create the project

### Frontend App

```bash
vp create vite:application -- --template react-ts
```

### Library

```bash
vp create vite:library
```

### Monorepo

```bash
vp create vite:monorepo
```

Then add apps and packages inside it:

```bash
# Inside the monorepo root
vp create vite:application -- --template react-ts  # for apps/web
vp create vite:library  # for packages/lib
```

**Monorepo typical structure:**

```
apps/
  web/          — main frontend app (React + Tailwind + shadcn)
  api/          — Cloudflare Workers API (optional)
packages/
  ui/           — shared UI components (optional)
  db/           — Drizzle schema + migrations (optional)
  shared/       — shared types/utils (optional)
```

After `vp create`, run `vp install` to install dependencies.

---

## Step 3: Configure package.json

Every package.json must include these fields. Check each one — missing any is a bug.

### 3a. Author metadata

```json
{
  "homepage": "https://github.com/xinyao27/<project-name>#readme",
  "bugs": {
    "url": "https://github.com/xinyao27/<project-name>/issues"
  },
  "license": "MIT",
  "author": {
    "name": "xinyao",
    "email": "hi@xinyao.me"
  },
  "repository": {
    "type": "git",
    "url": "git+https://github.com/xinyao27/<project-name>.git"
  },
  "funding": "https://github.com/sponsors/xinyao27"
}
```

Replace `<project-name>` with the actual project/repo name. Ask the user if unsure.

### 3b. Required scripts

```json
{
  "scripts": {
    "dev": "vp dev",
    "build": "vp build",
    "preview": "vp preview",
    "check": "vp check --fix",
    "lint": "vp lint --fix",
    "fmt": "vp fmt",
    "test": "vp test",
    "up": "taze major -Ir",
    "prepare": "vp config"
  }
}
```

Notes:
- `check` must include `--fix` — this is the primary quality gate
- `up: taze major -Ir` — interactive major version upgrade via taze
- `prepare: vp config` sets up git hooks on install
- For libraries, `build` should use `vp build` (tsdown via vite-plus), not `tsc && vp build`
- For apps with custom build steps, `build` can chain commands, but prefer keeping it simple
- Monorepo root may have additional scripts like `"dev:web": "vp run --filter web dev"`

### 3c. Module system and package manager

```json
{
  "type": "module",
  "packageManager": "pnpm@10.32.1"
}
```

The `packageManager` field is required — Vite+ uses it to detect which package manager to wrap. Use the latest stable pnpm version.

### 3d. pnpm overrides (required for Vite+)

Vite+ requires these overrides so that all dependencies resolve to the vite-plus bundled versions:

```json
{
  "pnpm": {
    "overrides": {
      "vite": "npm:@voidzero-dev/vite-plus-core@latest",
      "vitest": "npm:@voidzero-dev/vite-plus-test@latest"
    }
  }
}
```

This ensures libraries that depend on `vite` or `vitest` get the vite-plus versions. Without these overrides, you may get duplicate/conflicting versions.

### 3e. devDependencies baseline

At minimum, every project needs:

```json
{
  "devDependencies": {
    "taze": "latest",
    "vite": "npm:@voidzero-dev/vite-plus-core@latest",
    "vite-plus": "latest",
    "typescript": "~5.9.3"
  }
}
```

Note: `vite` points to the vite-plus core package via npm alias — this is intentional and required.

### 3f. VS Code settings

Create `.vscode/settings.json` (or add to existing) with:

```json
{
  "editor.defaultFormatter": "oxc.oxc-vscode",
  "oxc.fmt.configPath": "./vite.config.ts",
  "editor.formatOnSave": true,
  "editor.formatOnSaveMode": "file",
  "editor.codeActionsOnSave": {
    "source.fixAll.oxc": "explicit"
  }
}
```

This configures the Oxc VS Code extension as the default formatter and enables format-on-save with lint auto-fix. The formatter reads its config from `vite.config.ts` (the `fmt` section).

Also ensure `.vscode/extensions.json` recommends the Oxc extension:

```json
{
  "recommendations": ["oxc.oxc-vscode"]
}
```

### 3g. tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "useDefineForClassFields": true,
    "module": "ESNext",
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "types": ["vite/client", "node"],
    "skipLibCheck": true,
    "jsx": "react-jsx",
    "paths": {
      "@/*": ["./src/*"]
    },

    /* Bundler mode */
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "verbatimModuleSyntax": true,
    "moduleDetection": "force",
    "noEmit": true,

    /* Linting */
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "erasableSyntaxOnly": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedSideEffectImports": true
  },
  "include": ["src"]
}
```

Notes:
- `"types": ["vite/client", "node"]` — `vite/client` resolves to vite-plus client types via the npm alias
- `"jsx": "react-jsx"` — only for React projects; remove for pure libraries without React
- `"paths"` — the `@/*` alias matches the `resolve.alias` in `vite.config.ts`
- For libraries, you may need to adjust `"include"` and add `"declaration": true` if not using tsdown for dts

---

## Step 4: Configure vite-plus

Write `vite.config.ts` at the project root (or each package root in monorepo):

```typescript
import { defineConfig } from "vite-plus";

export default defineConfig({
  staged: {
    "*": "vp check --fix",
  },
  pack: {
    dts: {
      tsgo: true,
    },
    exports: true,
    sourcemap: true,
  },
  lint: {
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/__tests__/**", "src/index.ts", "src/types.ts"],
      thresholds: {
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100,
      },
    },
  },
  fmt: {
    sortImports: {},
    sortPackageJson: true,
    sortTailwindcss: {},
  },
});
```

For **frontend apps**, merge the React/Tailwind Vite config on top of this base. For **libraries**, the `pack` section is critical — keep it. For **apps** that don't publish, `pack` can be removed.

---

## Step 5: Set up frontend stack (if applicable)

Only for frontend apps, not pure libraries.

### 5a. Tailwind CSS

```bash
vp add tailwindcss @tailwindcss/vite
```

Add the Tailwind Vite plugin to `vite.config.ts`:

```typescript
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite-plus";

export default defineConfig({
  // ... base config from Step 4
  plugins: [tailwindcss()],
});
```

Add to the main CSS file:

```css
@import "tailwindcss";
```

### 5b. shadcn/ui

```bash
pnpm dlx shadcn@latest init --preset b4hGpM3Yx --base base --template vite
```

This sets up the shadcn component library with the xinyao preset. After init, add components as needed:

```bash
pnpm dlx shadcn@latest add button card input
```

### 5c. React Router (if SPA needs routing)

Only add if the user needs client-side routing:

```bash
vp add react-router
```

---

## Step 6: Set up backend stack (optional)

Only if the user wants an API/backend. Ask before adding this.

### 6a. oRPC + Cloudflare Workers

Install server dependencies:

```bash
vp add @orpc/server zod
```

Create the API entry point (e.g., `src/server/index.ts` or `apps/api/src/index.ts` in monorepo):

```typescript
import { RPCHandler } from "@orpc/server/fetch";
import { CORSPlugin } from "@orpc/server/plugins";
import { router } from "./router";

const handler = new RPCHandler(router, {
  plugins: [new CORSPlugin()],
});

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { matched, response } = await handler.handle(request, {
      prefix: "/rpc",
      context: { headers: request.headers, env },
    });
    if (matched) return response;
    return new Response("Not Found", { status: 404 });
  },
};
```

Create router (e.g., `src/server/router.ts`):

```typescript
import { os } from "@orpc/server";
import * as z from "zod";

const base = os.$context<{
  headers: Headers;
  env: Env;
}>();

export const router = {
  health: base.handler(async () => ({ status: "ok" })),
  // Add more procedures here
};

export type Router = typeof router;
```

Set up `wrangler.jsonc` for Cloudflare Workers:

```jsonc
{
  "name": "<project-name>-api",
  "main": "src/index.ts",
  "compatibility_date": "2025-01-01",
  "d1_databases": [],
  "r2_buckets": [],
  "kv_namespaces": []
}
```

### 6b. Drizzle ORM (with Cloudflare D1)

```bash
vp add drizzle-orm
vp add -D drizzle-kit
```

Create schema (e.g., `src/server/db/schema.ts` or `packages/db/src/schema.ts`):

```typescript
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});
```

Create a db middleware for oRPC:

```typescript
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./db/schema";

const withDb = base.middleware(async ({ context, next }) => {
  const db = drizzle(context.env.DB, { schema });
  return next({ context: { db } });
});
```

Create `drizzle.config.ts`:

```typescript
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/server/db/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
});
```

Update `wrangler.jsonc` to bind D1:

```jsonc
{
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "<project-name>-db",
      "database_id": "<create-via-wrangler>"
    }
  ]
}
```

### 6c. Client-side integration (TanStack React Query + oRPC client)

In the frontend app:

```bash
vp add @orpc/client @orpc/tanstack-query @tanstack/react-query
```

Create the oRPC client (e.g., `src/lib/orpc.ts`):

```typescript
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import type { Router } from "../server/router"; // or from shared package

const link = new RPCLink({
  url: `${import.meta.env.VITE_API_URL}/rpc`,
});

const client = createORPCClient<Router>(link);
export const orpc = createTanstackQueryUtils(client);
```

Wrap the app with QueryClientProvider:

```typescript
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const queryClient = new QueryClient();

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      {/* app content */}
    </QueryClientProvider>
  );
}
```

Usage in components:

```typescript
import { useQuery, useMutation } from "@tanstack/react-query";
import { orpc } from "../lib/orpc";

function UserList() {
  const { data } = useQuery(orpc.user.list.queryOptions({ input: {} }));
  const create = useMutation(orpc.user.create.mutationOptions());
  // ...
}
```

---

## Step 7: Verify

Run these checks to confirm everything works:

```bash
vp install
vp check
vp test       # if tests exist
vp dev        # verify dev server starts
vp build      # verify production build
```

---

## Migration

For migrating an existing project to this stack:

### Step 1: Analyze the current project

Read `package.json`, config files, and directory structure to identify:

- **Package manager**: npm / yarn / pnpm / bun
- **Bundler**: Webpack / Rollup / esbuild / Vite / other
- **Framework**: React / Vue / Svelte / vanilla / other
- **Linting**: ESLint config, Prettier config
- **Testing**: Jest / Vitest / Mocha / other
- **CSS**: Tailwind / CSS Modules / styled-components / Sass / other
- **State management**: Redux / Zustand / TanStack Query / SWR / other
- **API layer**: REST fetch / Axios / tRPC / GraphQL / other

### Step 2: Present migration plan

Before making changes, present a clear migration plan to the user:

```
Current stack:
- Bundler: Webpack 5
- Linting: ESLint + Prettier
- Testing: Jest
- CSS: CSS Modules

Migration plan:
1. Replace Webpack with Vite+ (vp dev / vp build)
2. Replace ESLint + Prettier with vp lint + vp fmt (Oxlint + Oxfmt)
3. Replace Jest with vp test (Vitest)
4. Add Tailwind CSS + shadcn (if desired)
5. Update package.json metadata
6. Add vite-plus config

Shall I proceed?
```

**Wait for user confirmation before executing.**

### Step 3: Execute migration

1. **Install vite-plus**: `vp add vite-plus` (or `vp migrate` if available)
2. **Remove old tooling**: Remove webpack, babel, eslint, prettier, jest and their configs
3. **Add vite.config.ts**: Use the standard config from Step 4
4. **Update imports**: Change `import { ... } from 'vite'` to `import { ... } from 'vite-plus'`, same for test utils
5. **Update package.json completely**: Apply ALL of Step 3 — scripts, metadata, overrides, devDependencies baseline
6. **Run `vp check`**: Fix any issues that come up
7. **Run `vp test`**: Ensure tests still pass (may need migration from Jest to Vitest syntax)

### Migration checklist (for projects already close to the target)

When a project already uses Vite+ or is partially set up, run through this checklist to catch gaps:

- [ ] `scripts.check` exists and is `"vp check --fix"`
- [ ] `scripts.lint` exists and is `"vp lint --fix"`
- [ ] `scripts.fmt` exists and is `"vp fmt"`
- [ ] `scripts.test` exists and is `"vp test"`
- [ ] `scripts.up` exists and is `"taze major -Ir"`, with `taze` in devDependencies
- [ ] `scripts.prepare` is `"vp config"`
- [ ] `scripts.build` uses `vp build` (not `tsc && vp build` unless there's a specific reason)
- [ ] `type` is `"module"`
- [ ] `packageManager` field is set
- [ ] `pnpm.overrides` has both `vite` and `vitest` aliases
- [ ] `devDependencies.vite` points to `npm:@voidzero-dev/vite-plus-core@latest`
- [ ] `devDependencies["vite-plus"]` is `"latest"`
- [ ] Author metadata (homepage, bugs, license, author, repository, funding) is present
- [ ] `vite.config.ts` uses `import { defineConfig } from "vite-plus"` (not from `"vite"`)
- [ ] `vite.config.ts` has `staged`, `lint`, and `fmt` sections
- [ ] No direct installs of vitest, oxlint, oxfmt, or tsdown in dependencies
- [ ] Test imports use `vite-plus/test` (not `vitest`)
- [ ] `.vscode/settings.json` has `oxc.oxc-vscode` as default formatter with format-on-save
- [ ] `.vscode/extensions.json` recommends `oxc.oxc-vscode`
- [ ] `tsconfig.json` uses `moduleResolution: "bundler"`, `verbatimModuleSyntax: true`, `strict: true`
- [ ] `tsconfig.json` has `"types": ["vite/client", "node"]`
- [ ] `tsconfig.json` has `"paths": { "@/*": ["./src/*"] }` matching vite.config.ts resolve.alias

Present any gaps found to the user with suggested fixes before applying them.

### Migration pitfalls

- **Don't install Vitest, Oxlint, or Oxfmt directly** — Vite+ bundles them
- **Import from `vite-plus`**, not from `vite` or `vitest`
- **Use `vp` commands**, not direct pnpm/npm/yarn commands for dev/build/test/lint
- **Webpack-specific features** (module federation, custom loaders) may need Vite plugin equivalents
- **Jest → Vitest**: Most Jest tests work with minimal changes. Key differences:
  - `jest.fn()` → `vi.fn()`
  - `jest.mock()` → `vi.mock()`
  - Import test utils from `vite-plus/test`

---

## Important reminders

- **Never install Vitest, Oxlint, Oxfmt, or tsdown directly** — Vite+ wraps these
- **Always import from `vite-plus`** instead of `vite` or `vitest`
- **Use `vp` for all commands**: `vp dev`, `vp build`, `vp test`, `vp lint`, `vp fmt`, `vp check`
- **Use `vp add` / `vp remove`** instead of pnpm/npm/yarn directly
- **Run `vp install` after any dependency change**
- **The shadcn init command uses pnpm dlx directly** — this is the one exception where we use pnpm directly, because shadcn's CLI needs it
