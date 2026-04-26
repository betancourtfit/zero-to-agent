# Phase 1: Foundation - Pattern Map

**Mapped:** 2026-04-25
**Files analyzed:** 22 new files (greenfield — no existing source tree)
**Analogs found:** 22 / 22 (all from 01-RESEARCH.md and STACK.md verified snippets)

> Greenfield note: every "analog" here is a research-verified snippet rather than an existing codebase file.
> The planner should treat each excerpt as the canonical starting template, not merely a reference.
> "Copy from" means: use this code verbatim as the starting point, then layer Phase 1–specific details on top.

---

## File Classification

| New File | Role | Data Flow | Closest Analog Source | Match Quality |
|----------|------|-----------|----------------------|---------------|
| `proxy.ts` | middleware | request-response | 01-RESEARCH.md §Focus Area 3 "proxy.ts at repo root" | exact |
| `next.config.ts` | config | — | STACK.md §Installation "next.config.ts" | exact |
| `lib/env.ts` | config/validation | — | 01-RESEARCH.md §Focus Area 4 "lib/env.ts" | exact |
| `lib/db/neon.ts` | utility/db-client | request-response | 01-RESEARCH.md §Focus Area 2 "lib/db/neon.ts" | exact |
| `lib/db/pool.ts` | utility/db-client | request-response | 01-RESEARCH.md §Focus Area 2 "lib/db/pool.ts" | exact |
| `lib/auth/auth.config.ts` | config/auth | request-response | 01-RESEARCH.md §Focus Area 3 "lib/auth/auth.config.ts" | exact |
| `lib/auth/auth.ts` | service/auth | request-response | 01-RESEARCH.md §Focus Area 3 "lib/auth/auth.ts" | exact |
| `lib/edge-config/index.ts` | utility | request-response | STACK.md §"Edge Config reads" | exact |
| `app/api/auth/[...nextauth]/route.ts` | route | request-response | 01-RESEARCH.md §Focus Area 3 "app/api/auth/[...nextauth]/route.ts" | exact |
| `app/layout.tsx` | component | — | 01-RESEARCH.md §Focus Area 9 (D-24 constraint) | pattern-only |
| `app/page.tsx` | component | — | STACK.md §"AI SDK chatbot" (structure only, not content) | pattern-only |
| `app/login/page.tsx` | component | request-response | 01-RESEARCH.md §Focus Area 9 "Phase 1 scope constraint" | role-match |
| `app/queue/page.tsx` | component | request-response | 01-RESEARCH.md §Focus Area 3 (session callback pattern) | role-match |
| `db/schema.sql` | migration/schema | — | 01-RESEARCH.md §Focus Area 2 "0001_init.sql DDL" | exact |
| `db/migrations/0001_init.sql` | migration | — | 01-RESEARCH.md §Focus Area 2 "0001_init.sql DDL" | exact |
| `scripts/db-migrate.ts` | utility/script | file-I/O + CRUD | 01-RESEARCH.md §Focus Area 2 "scripts/db-migrate.ts" | exact |
| `scripts/seed-maitre.ts` | utility/script | CRUD | 01-RESEARCH.md §Focus Area 2 (migration runner pattern adapted) | role-match |
| `scripts/edge-config-seed.ts` | utility/script | request-response | 01-RESEARCH.md §Focus Area 5 "scripts/edge-config-seed.ts" | exact |
| `scripts/smoke-test-kv.ts` | utility/script | request-response | 01-RESEARCH.md §Focus Area 6 "smoke test snippet" | exact |
| `scripts/load-test-pg.ts` | utility/script | CRUD | 01-RESEARCH.md §Focus Area 2 "load test snippet" | exact |
| `edge-config/seed.json` | config/data | — | 01-RESEARCH.md §Focus Area 5 "edge-config/seed.json" | exact |
| `.env.example` | config/env | — | 01-RESEARCH.md §Focus Area 4 (env key inventory) | exact |

---

## Shared Cross-Cutting Conventions

These apply to every file in Phase 1 and every file in Phases 2–4.

### Import path alias

All project imports use `@/` mapped to the repo root (set by `create-next-app --import-alias "@/*"`):

```typescript
import { sql } from "@/lib/db/neon";
import { pool } from "@/lib/db/pool";
import { authConfig } from "@/lib/auth/auth.config";
import { env } from "@/lib/env";
```

Never use relative `../../` paths across `lib/` boundaries. Relative imports are acceptable only within the same subdirectory (e.g., `auth.ts` importing `./auth.config`).

### Env var access pattern

Production code never touches `process.env.*` directly. Use `env.*` from `lib/env.ts`:

```typescript
// CORRECT
import { env } from "@/lib/env";
const url = env.DATABASE_URL;

// WRONG — bypasses validation, can silently be undefined
const url = process.env.DATABASE_URL;
```

Exception: `proxy.ts` and `lib/auth/auth.config.ts` read `process.env.*` directly to stay dependency-light (see RISK-4 in 01-RESEARCH.md). Scripts in `scripts/` may also read `process.env.*` directly.

### Error handling in scripts

All `scripts/*.ts` files follow the same tail-call pattern — never swallow errors:

```typescript
// Source: 01-RESEARCH.md, every script snippet
mainFunction().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

### Language convention

- UI copy, email subject/body, error messages shown to users: **Spanish**
- Code, comments, variable names, log messages: **English**
- Domain nouns may stay Spanish where appropriate (e.g., `maitre`, `comensal`)

### Comment policy

No comments unless the WHY is non-obvious. The existing research snippets already include brief inline comments for architectural reasons — keep those, remove narration comments.

### PII discipline (preview for Phase 2)

Phase 1 does not yet use `lib/log.ts`. But establish the habit: never `console.log(email)`, never log connection strings, never surface `err.message` from DB errors in HTTP responses. Migration runner logs filenames only, not SQL or connection strings.

---

## Pattern Assignments

### `proxy.ts` (middleware, request-response)

**Analog:** 01-RESEARCH.md §Focus Area 3 — "proxy.ts at repo root" (lines 548–564)

**Gotcha:** proxy.ts runs on Node.js in Next.js 16, NOT Edge. Do NOT add `export const runtime = "edge"` — it throws a build error. The split between `auth.config.ts` and `auth.ts` is motivated by keeping the proxy lean (avoid loading the PG adapter on every request), not by Edge incompatibility.

**Full pattern (copy verbatim):**

```typescript
// proxy.ts (repo root)
import NextAuth from "next-auth";
import { authConfig } from "@/lib/auth/auth.config";

const { auth } = NextAuth(authConfig);

export default auth((req) => {
  const isLoggedIn = !!req.auth;
  if (req.nextUrl.pathname.startsWith("/queue") && !isLoggedIn) {
    return Response.redirect(new URL("/login", req.url));
  }
});

export const config = {
  matcher: ["/queue/:path*"],
};
```

**Constraints:**
- Only imports from `lib/auth/auth.config.ts` — never `lib/auth/auth.ts`, never `lib/env.ts`, never `lib/db/*`
- No `export const runtime` of any kind

---

### `next.config.ts` (config)

**Analog:** STACK.md §Installation "next.config.ts" block

**Phase 1 note:** `withWorkflow` wrapper is added now even though the workflow SDK is not used until Phase 2. This avoids a config change mid-flight when Phase 2 starts (Architectural Commitment #4 — freeze workflow shape). STACK.md STACK.md §Installation confirms this is the correct wrapping pattern.

**Pattern:**

```typescript
// next.config.ts
import { withWorkflow } from "workflow/next";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Add project-specific config here as needed
};

export default withWorkflow(nextConfig);
```

**Constraints:**
- Do NOT add `images.domains` (deprecated in Next.js 16 — use `images.remotePatterns` if needed)
- Do NOT add `experimental.serverExternalPackages` unless a specific package requires it

---

### `lib/env.ts` (config/validation)

**Analog:** 01-RESEARCH.md §Focus Area 4 "lib/env.ts" (lines 619–652)

**Gotcha:** `createEnv()` throws synchronously at module load. Missing env var fails `next build` with a clear error. `skipValidation: !!process.env.SKIP_ENV_VALIDATION` allows CI matrix jobs to skip validation when running without secrets.

**Full pattern (copy verbatim):**

```typescript
// lib/env.ts
import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

export const env = createEnv({
  server: {
    DATABASE_URL: z.string().url(),
    DATABASE_URL_UNPOOLED: z.string().url(),
    AUTH_SECRET: z.string().min(1),
    AUTH_RESEND_KEY: z.string().min(1),
    RESEND_DOMAIN: z.string().min(1),
    UPSTASH_REDIS_REST_URL: z.string().url(),
    UPSTASH_REDIS_REST_TOKEN: z.string().min(1),
    EDGE_CONFIG: z.string().min(1),
    MCP_API_KEY: z.string().min(1),
    MAITRE_EMAIL: z.string().email(),
    VERCEL_TOKEN: z.string().optional(),
  },
  client: {
    NEXT_PUBLIC_BASE_URL: z.string().url(),
  },
  runtimeEnv: {
    DATABASE_URL: process.env.DATABASE_URL,
    DATABASE_URL_UNPOOLED: process.env.DATABASE_URL_UNPOOLED,
    AUTH_SECRET: process.env.AUTH_SECRET,
    AUTH_RESEND_KEY: process.env.AUTH_RESEND_KEY,
    RESEND_DOMAIN: process.env.RESEND_DOMAIN,
    UPSTASH_REDIS_REST_URL: process.env.UPSTASH_REDIS_REST_URL,
    UPSTASH_REDIS_REST_TOKEN: process.env.UPSTASH_REDIS_REST_TOKEN,
    EDGE_CONFIG: process.env.EDGE_CONFIG,
    MCP_API_KEY: process.env.MCP_API_KEY,
    MAITRE_EMAIL: process.env.MAITRE_EMAIL,
    VERCEL_TOKEN: process.env.VERCEL_TOKEN,
    NEXT_PUBLIC_BASE_URL: process.env.NEXT_PUBLIC_BASE_URL,
  },
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
});
```

**Constraints:**
- Every key added to `server` or `client` must also appear in `runtimeEnv` and in `.env.example`
- `VERCEL_TOKEN` is `optional()` — it is local-only, must NOT be set as a Vercel production env var

---

### `lib/db/neon.ts` (utility/db-client, request-response)

**Analog:** 01-RESEARCH.md §Focus Area 2 "lib/db/neon.ts" (lines 174–186)

**Gotcha:** `neon()` returns a tagged template literal function (HTTP transport). One query = one HTTP request. No persistent connection held. Do NOT use this for transactions in Phase 1 — use `pg.Client` (non-pooled) via migration runner for that. For Phase 2 transactions, use `@neondatabase/serverless`'s `Pool` constructor, not the `neon()` function.

**Full pattern:**

```typescript
// lib/db/neon.ts
// Use for all app queries (route handlers, API routes, future workflow steps)
import { neon } from "@neondatabase/serverless";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required");
}

export const sql = neon(process.env.DATABASE_URL);

// Usage: const rows = await sql`SELECT * FROM reservations WHERE id = ${id}`;
```

**Note:** This file reads `process.env.DATABASE_URL` directly (not via `lib/env.ts`) because it is imported at module load time and needs to be usable before `createEnv()` runs. This is the only justified exception to the env access pattern.

---

### `lib/db/pool.ts` (utility/db-client, request-response)

**Analog:** 01-RESEARCH.md §Focus Area 2 "lib/db/pool.ts" (lines 196–211)

**Gotcha:** This pool is used ONLY by `@auth/pg-adapter`. Never use it for application queries — route handlers and workflow steps use `lib/db/neon.ts`. The pool points to `DATABASE_URL` (pooled), NOT `DATABASE_URL_UNPOOLED`.

**Full pattern:**

```typescript
// lib/db/pool.ts
// Used ONLY by @auth/pg-adapter — do NOT use for app queries
import { Pool } from "pg";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required");
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});
```

---

### `lib/auth/auth.config.ts` (config/auth, request-response)

**Analog:** 01-RESEARCH.md §Focus Area 3 "lib/auth/auth.config.ts" (lines 451–477)

**Gotcha:** Must NOT import `pg`, `@auth/pg-adapter`, `lib/db/pool.ts`, or `lib/env.ts`. The config is kept lean because proxy.ts imports it on every matched request. The `authorized` callback here is the proxy-level access check; the full `signIn` and `session` callbacks with DB queries live in `auth.ts`.

**Custom email override** (required for D-12 Spanish subject) lives in `auth.ts`, not here. Keep `auth.config.ts` provider-minimal.

**Full pattern:**

```typescript
// lib/auth/auth.config.ts
// This file must NOT import pg.Pool, @auth/pg-adapter, or any heavy module
import type { NextAuthConfig } from "next-auth";
import Resend from "next-auth/providers/resend";

export const authConfig: NextAuthConfig = {
  providers: [
    Resend({
      apiKey: process.env.AUTH_RESEND_KEY,
      from: `noreply@${process.env.RESEND_DOMAIN ?? "resend.dev"}`,
      name: "Restaurant Queue",
    }),
  ],
  pages: {
    signIn: "/login",
    error: "/login",
  },
  callbacks: {
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = !!auth?.user;
      const isOnQueue = nextUrl.pathname.startsWith("/queue");
      if (isOnQueue) return isLoggedIn;
      return true;
    },
  },
};
```

**Note on `sendVerificationRequest`:** The Spanish email subject (D-12) requires a custom `sendVerificationRequest`. This must be wired in `auth.ts` (full config), not here, because it imports the `resend` npm package which is a heavier dependency. Override the Resend provider in `auth.ts`'s `...authConfig` spread by providing a fresh `Resend({...})` entry with `sendVerificationRequest`.

---

### `lib/auth/auth.ts` (service/auth, request-response)

**Analog:** 01-RESEARCH.md §Focus Area 3 "lib/auth/auth.ts" (lines 484–533)

**Gotchas:**
- The `signIn` callback fires BEFORE Resend sends the email when `email?.verificationRequest === true`. Return `false` to silently abort — no email sent, no error message variation (D-10).
- The `session` callback fires on every session read. Re-querying `employees.active` here enforces D-11 (mid-session deactivation).
- `users.id` is `SERIAL` (integer) from `@auth/pg-adapter`, so `user.id` will be a string-encoded integer like `"42"`. Never treat it as a UUID. Use `user.email` for the `employees` lookup.
- `sendVerificationRequest` with the `resend` package handles D-12 Spanish email subject. Dynamic import inside the function avoids loading it at module top-level.

**Full pattern:**

```typescript
// lib/auth/auth.ts
import NextAuth from "next-auth";
import PostgresAdapter from "@auth/pg-adapter";
import Resend from "next-auth/providers/resend";
import { authConfig } from "./auth.config";
import { pool } from "@/lib/db/pool";
import { sql } from "@/lib/db/neon";

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  adapter: PostgresAdapter(pool),
  session: { strategy: "database" },
  providers: [
    Resend({
      apiKey: process.env.AUTH_RESEND_KEY,
      from: `noreply@${process.env.RESEND_DOMAIN}`,
      async sendVerificationRequest({ identifier: email, url, provider }) {
        const { Resend: ResendClient } = await import("resend");
        const resend = new ResendClient(provider.apiKey);
        await resend.emails.send({
          from: provider.from!,
          to: email,
          subject: "Tu link para entrar al panel",
          html: `<p>Hacé clic para entrar al panel:</p><p><a href="${url}">Ingresar</a></p><p>Este link expira en 24 horas.</p>`,
        });
      },
    }),
  ],
  callbacks: {
    ...authConfig.callbacks,

    // D-09: Fires BEFORE the Resend email is dispatched.
    // email.verificationRequest === true on the first call only.
    async signIn({ user, email }) {
      if (email?.verificationRequest) {
        if (!user.email) return false;
        const rows = await sql`
          SELECT id, active FROM employees WHERE email = ${user.email}
        `;
        // D-10: Return false silently — UI shows generic copy regardless
        if (rows.length === 0 || !rows[0].active) return false;
      }
      return true;
    },

    // D-11: Re-validate employees.active on every session read
    async session({ session, user }) {
      if (!session.user?.email) return session;
      const rows = await sql`
        SELECT active FROM employees WHERE email = ${session.user.email}
      `;
      if (rows.length === 0 || !rows[0].active) {
        return { ...session, user: undefined } as typeof session;
      }
      return session;
    },
  },
});
```

---

### `lib/edge-config/index.ts` (utility, request-response)

**Analog:** STACK.md §"Edge Config reads" (lines 445–451); 01-RESEARCH.md §Focus Area 5

**Gotcha:** `get()` from `@vercel/edge-config` is read-only. Writes go through the Vercel REST API (only in the seed script). The wrapper below is the typed accessor Phase 2+ will use to read operational params like `no_show_timeout_min`.

**Pattern:**

```typescript
// lib/edge-config/index.ts
import { get } from "@vercel/edge-config";

export async function getConfig<T>(key: string, fallback: T): Promise<T> {
  return ((await get<T>(key)) ?? fallback);
}

// Usage in workflow step (Phase 2+):
// const noShowMin = await getConfig("no_show_timeout_min", 20);
```

**Typed key variant (optional, adds safety):**

```typescript
// Extend with a typed key union once the schema is stable (Phase 2):
type EdgeConfigKey =
  | "no_show_timeout_min"
  | "followup_after_call_min"
  | "extension_min"
  | "max_extensions_per_ticket"
  | "eta_recompute_interval_sec"
  | "colors_by_party_size";

export async function getTypedConfig<T>(key: EdgeConfigKey, fallback: T): Promise<T> {
  return ((await get<T>(key)) ?? fallback);
}
```

---

### `app/api/auth/[...nextauth]/route.ts` (route, request-response)

**Analog:** 01-RESEARCH.md §Focus Area 3 "app/api/auth/[...nextauth]/route.ts" (lines 539–541)

**Full pattern (copy verbatim):**

```typescript
// app/api/auth/[...nextauth]/route.ts
export { GET, POST } from "@/lib/auth/auth";
```

This is the entire file. Auth.js v5 `handlers` export handles all OAuth/email sign-in flows.

---

### `app/layout.tsx` (component)

**Analog:** 01-RESEARCH.md §Focus Area 9 "D-24 constraint"; no codebase analog exists

**Constraints (D-24):**
- `<html lang="es">` — mandatory for Spanish app
- Tailwind reset via `globals.css` import
- Minimal body font class — no layout chrome, no nav, no header/footer in Phase 1
- No `next-themes` provider, no global `<Toaster>`, no dark mode

**Pattern:**

```typescript
// app/layout.tsx
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Cola de Espera",
  description: "Sistema de reservas para restaurantes",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es">
      <body className="min-h-screen bg-background font-sans antialiased">
        {children}
      </body>
    </html>
  );
}
```

---

### `app/page.tsx` (component — landing, Spanish)

**Analog:** 01-RESEARCH.md D-21; no direct research snippet (design from scratch per CLAUDE.md)

**Constraints (D-21):**
- Minimal Spanish landing: project name + 1-line tagline + link to `/login`
- Phase 3 replaces this entirely with the chatbot embed
- No client-side JS needed — pure Server Component

**Pattern:**

```typescript
// app/page.tsx
import Link from "next/link";

export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
      <h1 className="text-3xl font-bold tracking-tight">Cola de Espera</h1>
      <p className="text-muted-foreground">
        Gestión de reservas para tu restaurante, sin complicaciones.
      </p>
      <Link
        href="/login"
        className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
      >
        Ingresar al panel
      </Link>
    </main>
  );
}
```

---

### `app/login/page.tsx` (component, request-response)

**Analog:** 01-RESEARCH.md §Focus Area 9 "Phase 1 scope constraint (D-22, D-24)"; D-10 timing attack mitigation

**Gotchas:**
- Generic success copy regardless of whether the email matched `employees` (D-10). Do NOT conditionally show different text based on `?error=Verification` query param — Auth.js redirects there on `signIn` returning false, which would leak existence.
- shadcn `Input` + `Button` components installed via `npx shadcn@latest add button input`
- Must be a Client Component (`"use client"`) to handle form submission state

**Pattern:**

```typescript
// app/login/page.tsx
"use client";
import { useState } from "react";
import { signIn } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    await signIn("resend", { email, redirect: false });
    // D-10: Show the same message regardless of whether email matched
    setSubmitted(true);
  }

  if (submitted) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-8">
        <p className="text-center text-muted-foreground">
          Si tu email está autorizado, te enviamos un link en breve.
        </p>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
      <h1 className="text-2xl font-semibold">Acceder al panel</h1>
      <form onSubmit={handleSubmit} className="flex w-full max-w-sm flex-col gap-4">
        <Input
          type="email"
          placeholder="tu@email.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoComplete="email"
        />
        <Button type="submit">Enviar link</Button>
      </form>
    </main>
  );
}
```

---

### `app/queue/page.tsx` (component, request-response — auth-gated stub)

**Analog:** 01-RESEARCH.md D-23; auth `session` callback pattern from §Focus Area 3

**Constraints (D-23):**
- Renders only `Hola {session.user.email} — panel próximamente` to prove round-trip works
- Must be a Server Component that calls `auth()` from `lib/auth/auth.ts`
- If no session, redirect to `/login` (defense-in-depth — proxy.ts is the first gate)
- Phase 3 replaces this entirely

**Pattern:**

```typescript
// app/queue/page.tsx
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/auth";

export default async function QueuePage() {
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8">
      <p className="text-lg">
        Hola {session.user.email} — panel próximamente
      </p>
    </main>
  );
}
```

---

### `db/migrations/0001_init.sql` (migration/schema)

**Analog:** 01-RESEARCH.md §Focus Area 2 "DDL block" (lines 299–378)

**Gotchas:**
- `verification_token` (singular, no 's') — Auth.js adapter hard-codes this name. Wrong name = silent auth failures.
- `users.id` is `SERIAL` (integer), NOT UUID. `employees.user_id` must be `INTEGER REFERENCES users(id)`.
- `reservations.id` is UUID via `gen_random_uuid()` — entirely separate ID space from `users.id`.
- `_migrations` table is NOT created here — the migration runner creates it at startup.
- Order matters: `users` before `accounts`/`sessions`; `users` before `employees`; `reservations` before `reservation_events`.

**Full pattern (copy verbatim from 01-RESEARCH.md Focus Area 2):**

```sql
-- Auth.js v5 tables (from @auth/pg-adapter documentation)
CREATE TABLE IF NOT EXISTS verification_token (
  identifier TEXT NOT NULL,
  expires TIMESTAMPTZ NOT NULL,
  token TEXT NOT NULL,
  PRIMARY KEY (identifier, token)
);

CREATE TABLE IF NOT EXISTS accounts (
  id SERIAL PRIMARY KEY,
  "userId" INTEGER NOT NULL,
  type VARCHAR(255) NOT NULL,
  provider VARCHAR(255) NOT NULL,
  "providerAccountId" VARCHAR(255) NOT NULL,
  refresh_token TEXT,
  access_token TEXT,
  expires_at BIGINT,
  id_token TEXT,
  scope TEXT,
  session_state TEXT,
  token_type TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  id SERIAL PRIMARY KEY,
  "userId" INTEGER NOT NULL,
  expires TIMESTAMPTZ NOT NULL,
  "sessionToken" VARCHAR(255) NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255),
  email VARCHAR(255) UNIQUE,
  "emailVerified" TIMESTAMPTZ,
  image TEXT
);

-- Application tables

CREATE TABLE IF NOT EXISTS employees (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  email VARCHAR(255) UNIQUE NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS reservations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_token UUID NOT NULL UNIQUE,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL,
  phone VARCHAR(50) NOT NULL,
  party_size INTEGER NOT NULL CHECK (party_size >= 1 AND party_size <= 20),
  status VARCHAR(50) NOT NULL DEFAULT 'waiting'
    CHECK (status IN ('waiting', 'called', 'seated', 'no_show', 'cancelled', 'failed_to_start')),
  workflow_run_id TEXT,
  eta_min INTEGER,
  extension_count INTEGER NOT NULL DEFAULT 0,
  no_show_deadline TIMESTAMPTZ,
  called_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS reservation_events (
  id SERIAL PRIMARY KEY,
  reservation_id UUID NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
  event_type VARCHAR(100) NOT NULL,
  payload JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

### `db/schema.sql` (reference schema)

Same content as `db/migrations/0001_init.sql`. Acts as the human-readable snapshot of the current schema. Keep in sync with migrations manually. The migration runner does not read this file.

---

### `scripts/db-migrate.ts` (utility/script, file-I/O + CRUD)

**Analog:** 01-RESEARCH.md §Focus Area 2 "scripts/db-migrate.ts" (lines 219–281)

**Gotchas:**
- Uses `pg.Client` (not Pool, not neon) against `DATABASE_URL_UNPOOLED` — direct TCP, not PgBouncer pooler
- Each migration runs in a transaction: BEGIN → DDL → INSERT into `_migrations` → COMMIT. ROLLBACK on failure
- Lexicographic sort on `NNNN_` prefix ensures correct order
- Log filename, not SQL content or connection string (PII/security discipline)

**Full pattern (copy verbatim from 01-RESEARCH.md):**

```typescript
// scripts/db-migrate.ts
import { Client } from "pg";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

async function migrate() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL_UNPOOLED,
  });

  await client.connect();

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        filename TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    const migrationsDir = join(process.cwd(), "db", "migrations");
    const files = (await readdir(migrationsDir))
      .filter((f) => f.endsWith(".sql"))
      .sort();

    for (const filename of files) {
      const { rows } = await client.query(
        "SELECT filename FROM _migrations WHERE filename = $1",
        [filename]
      );

      if (rows.length > 0) {
        console.log(`[skip] ${filename}`);
        continue;
      }

      const sql = await readFile(join(migrationsDir, filename), "utf-8");

      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query(
          "INSERT INTO _migrations (filename) VALUES ($1)",
          [filename]
        );
        await client.query("COMMIT");
        console.log(`[applied] ${filename}`);
      } catch (err) {
        await client.query("ROLLBACK");
        throw new Error(`Migration ${filename} failed: ${err}`);
      }
    }
  } finally {
    await client.end();
  }
}

migrate().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

**package.json script entry:**

```json
"db:migrate": "tsx scripts/db-migrate.ts"
```

---

### `scripts/seed-maitre.ts` (utility/script, CRUD)

**Analog:** 01-RESEARCH.md §D-17 decision; migration runner pattern for DB client setup

**Gotcha:** Uses `DATABASE_URL_UNPOOLED` (direct connection, same rationale as migration runner — safe for one-off inserts). Idempotent on `email` via `ON CONFLICT DO UPDATE`.

**Pattern (adapted from migration runner client setup):**

```typescript
// scripts/seed-maitre.ts
import { Client } from "pg";

async function seedMaitre() {
  const email = process.env.MAITRE_EMAIL;
  if (!email) throw new Error("MAITRE_EMAIL env var is required");

  const client = new Client({
    connectionString: process.env.DATABASE_URL_UNPOOLED,
  });

  await client.connect();

  try {
    await client.query(
      `INSERT INTO employees (email, active)
       VALUES ($1, true)
       ON CONFLICT (email) DO UPDATE SET active = true`,
      [email]
    );
    console.log(`[seeded] maitre: ${email}`);
  } finally {
    await client.end();
  }
}

seedMaitre().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

**package.json script entry:**

```json
"seed:maitre": "tsx scripts/seed-maitre.ts"
```

---

### `scripts/edge-config-seed.ts` (utility/script, request-response)

**Analog:** 01-RESEARCH.md §Focus Area 5 "scripts/edge-config-seed.ts" (lines 738–796)

**Gotchas:**
- `VERCEL_TOKEN` must be local-only (`.env.local`) — never set as a Vercel production env var
- `EDGE_CONFIG_ID` extracted from the `EDGE_CONFIG` connection string URL pathname
- Idempotent by default: reads current value via `get()`, skips if unchanged. `--force` overwrites dashboard edits (D-07)
- The PATCH is atomic across all items — if any single item fails, the entire operation fails

**Full pattern (copy verbatim from 01-RESEARCH.md):**

```typescript
// scripts/edge-config-seed.ts
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { get } from "@vercel/edge-config";

const FORCE = process.argv.includes("--force");

async function seedEdgeConfig() {
  const token = process.env.VERCEL_TOKEN;
  const edgeConfigConnectionString = process.env.EDGE_CONFIG;

  if (!token) throw new Error("VERCEL_TOKEN is required (local only — do not commit)");
  if (!edgeConfigConnectionString) throw new Error("EDGE_CONFIG is required");

  const url = new URL(edgeConfigConnectionString);
  const edgeConfigId = url.pathname.replace(/^\//, "");

  const seedPath = join(process.cwd(), "edge-config", "seed.json");
  const seed = JSON.parse(await readFile(seedPath, "utf-8"));

  const items = [];
  for (const [key, value] of Object.entries(seed)) {
    if (!FORCE) {
      const current = await get(key);
      if (JSON.stringify(current) === JSON.stringify(value)) {
        console.log(`[skip] ${key} (unchanged)`);
        continue;
      }
    }
    items.push({ operation: "upsert", key, value });
  }

  if (items.length === 0) {
    console.log("All keys up to date. Run with --force to overwrite.");
    return;
  }

  const res = await fetch(
    `https://api.vercel.com/v1/edge-config/${edgeConfigId}/items`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ items }),
    }
  );

  const result = await res.json();
  if (!res.ok) throw new Error(`Edge Config seed failed: ${JSON.stringify(result)}`);
  console.log(`[seeded] ${items.map((i: { key: string }) => i.key).join(", ")}`);
}

seedEdgeConfig().catch((err) => { console.error(err); process.exit(1); });
```

**package.json script entry:**

```json
"edge-config:seed": "tsx scripts/edge-config-seed.ts"
```

---

### `scripts/smoke-test-kv.ts` (utility/script, request-response)

**Analog:** 01-RESEARCH.md §Focus Area 6 "smoke test snippet" (lines 826–840)

**Full pattern (copy verbatim):**

```typescript
// scripts/smoke-test-kv.ts
import { Redis } from "@upstash/redis";

async function smokeTestKV() {
  const redis = Redis.fromEnv();
  const pong = await redis.ping();
  if (pong !== "PONG") throw new Error(`KV ping failed: ${pong}`);

  await redis.set("smoke:test:key", "hello", { ex: 60 });
  const val = await redis.get("smoke:test:key");
  if (val !== "hello") throw new Error(`KV set/get failed: ${val}`);

  await redis.del("smoke:test:key");
  console.log("KV smoke test passed");
}

smokeTestKV().catch((err) => { console.error(err); process.exit(1); });
```

**package.json script entry:**

```json
"smoke:kv": "tsx scripts/smoke-test-kv.ts"
```

---

### `scripts/load-test-pg.ts` (utility/script, CRUD — D-28 soft gate)

**Analog:** 01-RESEARCH.md §Focus Area 2 "load test snippet" (lines 386–420)

**Full pattern (copy verbatim):**

```typescript
// scripts/load-test-pg.ts
import { Pool } from "pg";
import { neon } from "@neondatabase/serverless";

async function loadTest() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
  const sql = neon(process.env.DATABASE_URL!);

  const start = Date.now();

  const poolQueries = Array.from({ length: 10 }, () =>
    pool.query("SELECT 1 AS ok")
  );
  const neonQueries = Array.from({ length: 10 }, () =>
    sql`SELECT 1 AS ok`
  );

  const [poolResults, neonResults] = await Promise.all([
    Promise.all(poolQueries),
    Promise.all(neonQueries),
  ]);

  const elapsed = Date.now() - start;
  console.log(`Pool: ${poolResults.length} OK, Neon: ${neonResults.length} OK`);
  console.log(`Wall time: ${elapsed}ms`);

  if (elapsed > 5000) {
    throw new Error(`Load test exceeded 5s wall time: ${elapsed}ms`);
  }

  await pool.end();
}

loadTest().catch((err) => { console.error(err); process.exit(1); });
```

**package.json script entry:**

```json
"test:pg": "tsx scripts/load-test-pg.ts"
```

---

### `edge-config/seed.json` (config/data)

**Analog:** 01-RESEARCH.md §Focus Area 5 "edge-config/seed.json" (lines 719–733); D-08 values

**Full pattern (copy verbatim):**

```json
{
  "no_show_timeout_min": 20,
  "followup_after_call_min": 1,
  "extension_min": 5,
  "max_extensions_per_ticket": 2,
  "eta_recompute_interval_sec": 60,
  "colors_by_party_size": {
    "1-2": "#A8E6CF",
    "3-4": "#FFD3B6",
    "5-6": "#FFAAA5",
    "7+": "#D5AAFF"
  }
}
```

Phase 2 plan-phase agent may refine the timing values once workflow step durations are known. Values are committed and reproducible via the seed script.

---

### `.env.example` (config/env)

**Analog:** 01-RESEARCH.md §Focus Area 4 (env key inventory); D-18 placeholder values

**Full pattern:**

```bash
# Database (Neon Postgres — provisioned by Vercel Marketplace)
DATABASE_URL=postgresql://user:pass@ep-pooled.neon.tech/dbname?sslmode=require
DATABASE_URL_UNPOOLED=postgresql://user:pass@ep-direct.neon.tech/dbname?sslmode=require

# Auth.js v5
AUTH_SECRET=change-me-generate-with-npx-auth-secret
AUTH_RESEND_KEY=re_xxxxxxxxxxxx
RESEND_DOMAIN=mail.yourdomain.com

# Upstash Redis (KV — provisioned by Vercel Marketplace)
UPSTASH_REDIS_REST_URL=https://xxx.upstash.io
UPSTASH_REDIS_REST_TOKEN=xxxxxxxxxxxx

# Vercel Edge Config (provisioned by Vercel Marketplace)
EDGE_CONFIG=https://edge-config.vercel.com/ecfg_xxxx?token=xxxx

# MCP server bearer token (generate: openssl rand -hex 32)
MCP_API_KEY=change-me-generate-with-openssl-rand-hex-32

# App URL (set to production URL after vercel link)
NEXT_PUBLIC_BASE_URL=http://localhost:3000

# Maître seed (set real email in .env.local and in all 3 Vercel envs)
MAITRE_EMAIL=pilot-maitre@example.com

# Vercel API token — LOCAL ONLY, never set in Vercel dashboard
# Used only by scripts/edge-config-seed.ts
VERCEL_TOKEN=
```

---

## Shared Patterns

### Auth guard (defense-in-depth)

**Source:** 01-RESEARCH.md §Focus Area 3 (proxy.ts + server component double-gate)
**Apply to:** All auth-gated route files (`app/queue/page.tsx` and all Phase 3+ panel routes)

Pattern: proxy.ts redirects unauthenticated requests to `/login`. Server component also calls `auth()` and redirects. Both gates are needed.

```typescript
// In every auth-gated Server Component:
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/auth";

const session = await auth();
if (!session?.user) redirect("/login");
```

### DB client selection

**Source:** 01-RESEARCH.md §Focus Area 2 "Why two clients"
**Apply to:** Every file that touches Postgres

| Context | Client | URL used |
|---------|--------|----------|
| App queries (route handlers, workflow steps) | `sql` from `lib/db/neon.ts` | `DATABASE_URL` (pooled) |
| Auth.js adapter (internal, via `auth.ts`) | `pool` from `lib/db/pool.ts` | `DATABASE_URL` (pooled) |
| Migration runner, seed scripts | `pg.Client` (local, not exported) | `DATABASE_URL_UNPOOLED` (direct TCP) |

### Script termination pattern

**Source:** 01-RESEARCH.md §every script snippet
**Apply to:** Every `scripts/*.ts` file

```typescript
mainFunction().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

### Spanish email copy

**Source:** 01-RESEARCH.md §Focus Area 3 "sendVerificationRequest" (lines 587–600); D-12
**Apply to:** `lib/auth/auth.ts` `sendVerificationRequest`

Subject: `"Tu link para entrar al panel"`
Body: Spanish, brand-neutral, no restaurant name. Empathic tone per SAFE-03.

---

## No Analog Found

No files in this phase are without an analog — all 22 files have exact or role-matched research snippets from 01-RESEARCH.md or STACK.md. No file requires the planner to invent a pattern from scratch.

---

## Phase 1 Precedents for Phases 2–4

The following conventions, established in Phase 1, must not be broken by later phases:

| Convention | File(s) establishing it | Impact if broken |
|------------|------------------------|-----------------|
| `@/` import alias | `tsconfig.json` from create-next-app | All imports break |
| `lib/env.ts` as single env access point | `lib/env.ts` | Env validation bypassed, Pitfall #18 re-opens |
| Two separate DB clients (neon + pool) | `lib/db/neon.ts`, `lib/db/pool.ts` | Auth adapter or app queries fail |
| `DATABASE_URL_UNPOOLED` for scripts | `scripts/db-migrate.ts` | DDL fails with PgBouncer transaction-mode error |
| `proxy.ts` at repo root (not `middleware.ts`) | `proxy.ts` | Forward-compat with Next.js 16 broken |
| `withWorkflow(nextConfig)` wrapper | `next.config.ts` | Phase 2 workflow routes fail to register |
| Auth session strategy `"database"` | `lib/auth/auth.ts` | D-11 (re-validate `employees.active`) becomes impossible |
| Forward-only migrations with `NNNN_` prefix | `db/migrations/` | Lexicographic order breaks if prefix width changes |

---

## Metadata

**Analog search scope:** 01-RESEARCH.md + STACK.md (both verified against live docs 2026-04-25)
**Existing source files scanned:** 0 (greenfield)
**Research snippets used:** 22
**Pattern extraction date:** 2026-04-25

---

## PATTERN MAPPING COMPLETE
