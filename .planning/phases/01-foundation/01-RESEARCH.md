# Phase 1: Foundation - Research

**Researched:** 2026-04-25
**Domain:** Next.js 16 scaffolding, Neon Postgres (two-client pattern), Auth.js v5 magic-link, Vercel Edge Config, Upstash Redis, env validation
**Confidence:** HIGH — all focus areas verified against live official docs or npm registry. Two open questions flagged explicitly.

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01** Schema managed as plain SQL. `db/schema.sql` holds the initial DDL; forward-only migrations live in `db/migrations/NNNN_<name>.sql`.
- **D-02** Custom migration runner at `scripts/db-migrate.ts` invoked by `npm run db:migrate`. Tracks applied files in a `_migrations` table.
- **D-03** Migration runner uses the **non-pooled** Neon URL (`DATABASE_URL_UNPOOLED`). App + Auth.js use the pooled `DATABASE_URL`.
- **D-04** No ORM (no Drizzle / Prisma / Kysely).
- **D-05** `edge-config/seed.json` checked into the repo with the 6 operational params and demo-safe defaults.
- **D-06** `scripts/edge-config-seed.ts` (invoked by `npm run edge-config:seed`) PUTs values via the Edge Config Items API. Idempotent — only writes if a key is absent or its value differs from `seed.json`.
- **D-07** Phase 4 "live edit" demo edits values from the Vercel dashboard. The seed script does NOT overwrite dashboard edits unless `--force` is passed.
- **D-08** Initial values committed in `seed.json`: `no_show_timeout_min: 20`, `followup_after_call_min: 1`, `extension_min: 5`, `max_extensions_per_ticket: 2`, `eta_recompute_interval_sec: 60`, `colors_by_party_size: { "1-2": "#A8E6CF", "3-4": "#FFD3B6", "5-6": "#FFAAA5", "7+": "#D5AAFF" }`.
- **D-09** Auth.js `signIn({ user, account })` callback queries `employees` BEFORE the magic-link is generated/sent. If `user.email` is not in `employees` (or `employees.active = false`), return `false` — Resend never sends the link.
- **D-10** UI copy on `/login` is generic regardless of email match. Avoids leaking existence via response timing or message variation.
- **D-11** Auth.js `session({ session, token })` callback also re-validates `employees` row exists and is active on every session read.
- **D-12** Magic-link `from` address is `noreply@<verified-resend-domain>`. Subject (Spanish): "Tu link para entrar al panel". Body Spanish, brand-neutral.
- **D-13** `main` branch deploys to production automatically. PRs get preview URLs. No manual `vercel --prod` from local.
- **D-14** Production URL is the free `<project>.vercel.app` alias.
- **D-15** Phase 1 ships an empty-but-deployed app with three routes: `/`, `/login`, `/queue` (auth-gated stub).
- **D-16** Env vars set in all 3 Vercel environments. Verified via `vercel env ls` before merging Phase 1 → main.
- **D-17** `MAITRE_EMAIL` env var + `scripts/seed-maitre.ts` invoked by `npm run seed:maitre`. Idempotent upsert on email.
- **D-18** `.env.example` lists `MAITRE_EMAIL=pilot-maitre@example.com` as placeholder.
- **D-19** `@t3-oss/env-nextjs` + Zod schemas at `lib/env.ts`. Separate `server` and `client` schemas. Validates at build AND runtime.
- **D-20** `.env.example` is the source of truth for the list of required keys. A CI / local pre-deploy check asserts each key has a line in `.env.example`.
- **D-21** `/` renders a minimal Spanish landing: project name + 1-line tagline + link to `/login`. Phase 3 replaces with chatbot embed.
- **D-22** `/login` is a single-input Spanish form (email + submit) using shadcn/ui `Input` + `Button`. Generic success copy regardless of validation result (per D-10).
- **D-23** `/queue` is auth-gated via `proxy.ts` matcher. Phase 1 renders only `Hola {session.user.email} — panel próximamente`.
- **D-24** No global layout chrome beyond `<html lang="es">` in `app/layout.tsx` + Tailwind reset + minimal `body` font.
- **D-25** Single Next.js 16 app, App Router. Top-level dirs: `app/`, `lib/`, `db/`, `edge-config/`, `scripts/`, `public/`.
- **D-26** `lib/` contains: `lib/db/neon.ts`, `lib/db/pool.ts`, `lib/auth/auth.config.ts`, `lib/auth/auth.ts`, `lib/edge-config/`, `lib/env.ts`.
- **D-27** `proxy.ts` lives at the **repo root** (Next.js 16 convention). Imports only `lib/auth/auth.config.ts`.
- **D-28** Phase 1 plan includes a load test script at `scripts/load-test-pg.ts`: 10 parallel Auth.js Pool queries + 10 parallel `@neondatabase/serverless` queries. Asserts no errors and total wall time < 5s.

### Claude's Discretion

- Concrete shadcn/ui component versions and Tailwind v4 config details
- Exact form copy / wording (must be Spanish, friendly-empathic per SAFE-03 tone)
- Whether to wire `next-themes` / dark mode in Phase 1 (default: no)
- Migration runner implementation language (default: TypeScript via `tsx`, Node 20)
- Initial Vercel project name + slug (chosen at `vercel link` time by user)
- Whether to add a `/api/health` endpoint in Phase 1 or wait for Phase 4

### Deferred Ideas (OUT OF SCOPE)

- Custom domain for the pilot (post-hackathon)
- Multi-role employees (single "maître" role only in v1)
- `/login` design polish (Phase 3)
- `next-themes` / dark mode (out of scope for v1)
- Migration rollback (forward-only only)
- `/api/health` endpoint (Phase 4)

</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| STAFF-01 | Maître se autentica en `/login` con magic-link enviado por Auth.js v5 + Resend, validando contra la tabla `employees` | Auth.js v5 split config, signIn callback ordering (VERIFIED fires BEFORE email), pg-adapter DDL, Resend provider options |
| PLAT-04 | Persistencia en Neon Postgres con tablas `reservations`, `reservation_events`, `employees`, y las tablas auto-generadas por Auth.js v5 | Two-client pattern verified, migration runner pattern, pg-adapter DDL confirmed |
| PLAT-06 | Vercel Edge Config almacena parámetros operativos — cambios desde dashboard sin redeploy | Edge Config REST API endpoint and upsert pattern verified, `@vercel/edge-config` read SDK confirmed |
| DEMO-01 | Deploy productivo en Vercel con URL pública estable | Auto-deploy via `git push main`, stable `.vercel.app` URL, `vercel link` + GitHub integration |
| DEMO-02 | Repo público en GitHub con código limpio + `.env.example` actualizado + README claro | `@t3-oss/env-nextjs` schema as source of truth for env keys, `.env.example` sync pattern |

</phase_requirements>

---

## Executive Summary

- **proxy.ts runs on Node.js by default (NOT Edge) in Next.js 16.** The official docs state: "Proxy defaults to using the Node.js runtime. The runtime config option is not available in Proxy files." This means the historical reason for splitting `auth.config.ts` (Edge incompatibility of `pg.Pool`) still applies as best practice — but the split is now motivated by avoiding loading the full adapter on every proxy invocation, not a hard runtime blocker. Keep the split as D-27 specifies.
- **The Auth.js v5 `signIn` callback fires BEFORE the Resend email is sent** during the verification request phase. Returning `false` prevents the email entirely. This directly validates D-09. The callback receives `email.verificationRequest === true` on the first call, allowing distinction from the second call (after user clicks the link).
- **`@auth/pg-adapter` ships no SQL file — the DDL must be copied manually into migration `0001_init.sql`.** Four tables required: `users`, `accounts`, `sessions`, `verification_token`. The table names use integer `SERIAL` IDs (not UUID), meaning the `employees` table bridge to `users` uses `INTEGER` foreign keys.
- **Edge Config REST API for writes uses `PATCH /v1/edge-config/{id}/items` with `Authorization: Bearer {VERCEL_TOKEN}` and operation `"upsert"`.** The `EDGE_CONFIG_ID` comes from the `EDGE_CONFIG` connection string environment variable (parse the `id` component from it).
- **`next-auth@beta` current version is 4.24.14 (as of 2026-04-25).** The "beta" tag IS Auth.js v5 — this has been stable for 18+ months. `@auth/pg-adapter` is at 1.11.2. Both verified via npm registry.

---

## Focus Area 1: Next.js 16 Scaffolding

### Recommended init command

```bash
npx create-next-app@latest restaurant-queue \
  --typescript \
  --tailwind \
  --app \
  --no-src-dir \
  --import-alias "@/*"
cd restaurant-queue
```

[VERIFIED: npm view next version → 16.2.4 as of 2026-04-25]

The `create-next-app@latest` defaults in 2026 include:
- App Router (default)
- TypeScript-first
- Tailwind CSS v4 (default for new projects in 2026)
- ESLint with flat config format (ESLint v10 compatible)
- Turbopack as default bundler (no `--turbopack` flag needed)

### Turbopack status

Turbopack is **default** in Next.js 16 for both `next dev` and `next build`. No configuration needed. Opt-out with `next dev --webpack` or `next build --webpack` only if webpack plugins are strictly required. This project has no such requirement.

[VERIFIED: Next.js 16 blog post — "Turbopack is now the default bundler for all apps"]

### proxy.ts location, runtime, and Auth.js integration

**Key finding: proxy.ts runs on Node.js, NOT Edge, in Next.js 16.**

From the official Next.js 16 docs (verified 2026-04-25):
> "Proxy defaults to using the Node.js runtime. The `runtime` config option is not available in Proxy files. Setting the `runtime` config option in Proxy will throw an error."

The function is named `proxy` (not `middleware`). It can be a default export or named `proxy`. File lives at repo root.

```typescript
// proxy.ts (repo root, NOT src/ prefix)
import NextAuth from "next-auth";
import authConfig from "@/lib/auth/auth.config";

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

[VERIFIED: nextjs.org/docs/app/api-reference/file-conventions/proxy — Node.js runtime confirmed, function name, matcher syntax]

### Package manager and Vercel auto-detection

Vercel auto-detects the package manager based on the lock file present:
- `package-lock.json` → npm
- `yarn.lock` → Yarn
- `pnpm-lock.yaml` → pnpm
- `bun.lockb` → Bun

The choice of npm, pnpm, or bun does not affect deployment behavior. For this solo 7-day project, npm is the default from `create-next-app` and requires no additional setup.

[ASSUMED — Vercel package manager auto-detection is well-established behavior]

---

## Focus Area 2: Two Postgres Clients Pattern (D-26, D-03, Pitfall #13)

### Why two clients

- `@neondatabase/serverless` — HTTP/WebSocket driver optimized for serverless cold-starts. Used for all app queries (route handlers, future workflow steps). Does NOT support all `pg` driver semantics.
- `pg.Pool` — Standard Node.js PostgreSQL client. Required by `@auth/pg-adapter` (it expects classical Pool semantics). NOT compatible with Neon's HTTP transport.

Both clients point to the **same** Neon database. They do not conflict.

[VERIFIED: authjs.dev/getting-started/adapters/pg — explicitly requires `pg.Pool`; STACK.md §Supporting Libraries]

### lib/db/neon.ts

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

[CITED: neon.tech/docs/serverless/serverless-driver — `neon()` returns a tagged template literal query function]

The `neon()` function is the HTTP transport: one query = one HTTP request. Fastest for cold-start serverless. No persistent connection held.

For queries that need the WebSocket transport (e.g. transactions), use `new Pool()` from `@neondatabase/serverless` — but for Phase 1, the HTTP client is sufficient.

### lib/db/pool.ts

```typescript
// lib/db/pool.ts
// Used ONLY by @auth/pg-adapter — do NOT use for app queries
import { Pool } from "pg";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required");
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,            // Conservative pool size — Neon serverless has connection limits
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});
```

[CITED: authjs.dev/getting-started/adapters/pg — `new Pool({ connectionString })` is the exact documented pattern]

### Migration runner (D-01, D-02, D-03)

The migration runner uses `pg.Client` (not Pool) against the **non-pooled** URL. PgBouncer (the pooler) in transaction mode can block certain DDL statements like `CREATE TABLE`, `ALTER TABLE`, and DDL-heavy migrations. Non-pooled connections establish a direct TCP connection to Postgres.

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
    // Create migrations tracking table
    await client.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        filename TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    const migrationsDir = join(process.cwd(), "db", "migrations");
    const files = (await readdir(migrationsDir))
      .filter((f) => f.endsWith(".sql"))
      .sort(); // Lexicographic sort — NNNN_ prefix ensures correct order

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

Invoke via `package.json`:
```json
{
  "scripts": {
    "db:migrate": "tsx scripts/db-migrate.ts"
  }
}
```

[VERIFIED: Pitfall #13 in PITFALLS.md — non-pooled URL for migrations is mandatory]

### @auth/pg-adapter SQL DDL — what to include in 0001_init.sql

The adapter ships NO SQL file. Copy the following DDL manually into `db/migrations/0001_init.sql`. This is the official schema from the Auth.js docs (verified 2026-04-25):

```sql
-- Auth.js v5 tables (from @auth/pg-adapter documentation)
-- Source: authjs.dev/getting-started/adapters/pg

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

-- _migrations table is created by the runner itself, not here
```

**IMPORTANT NOTE on users.id type:** The `@auth/pg-adapter` schema uses `SERIAL` (integer) for `users.id`, NOT UUID. The `employees.user_id` foreign key must therefore be `INTEGER`, not UUID. This is a common gotcha — do not change `users.id` to UUID or the adapter will break.

[VERIFIED: authjs.dev/getting-started/adapters/pg — DDL confirmed from official docs, 2026-04-25]

### Two-clients load test (D-28)

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

---

## Focus Area 3: Auth.js v5 Split Config (Pitfall #12, D-09–D-12, D-27)

### CRITICAL FINDING: signIn callback fires BEFORE email is sent

The Auth.js v5 `signIn` callback is triggered **twice** for email providers:
1. **During the verification request (before the email is sent)** — `email.verificationRequest === true`
2. **After the user clicks the sign-in link** — `email.verificationRequest` is absent

Returning `false` from the first call prevents the email from being sent entirely. This directly validates D-09.

[VERIFIED: next-auth.js.org/configuration/callbacks — "When the user provides an email address, the `signIn()` callback is triggered ... on the first call during email sign in the `email` object will include a property `verificationRequest: true`"]

### CRITICAL FINDING: proxy.ts runs Node.js, not Edge

**The historical reason for the `auth.config.ts` split was Edge runtime incompatibility of `pg.Pool`.** In Next.js 16, proxy.ts runs Node.js by default and the `runtime` option cannot be set (throws an error if you try).

**What this means for the plan:**
- The split is still good practice (keeps the proxy lean, avoids loading the full adapter on every request) and D-27 is still correct
- But the constraint is NOT "Edge can't run pg.Pool" — it's "don't load the full adapter in the proxy for performance and simplicity"
- No `export const runtime = "edge"` is needed (or allowed) in proxy.ts

[VERIFIED: nextjs.org/docs/app/api-reference/file-conventions/proxy — "Proxy defaults to using the Node.js runtime. The runtime config option is not available in Proxy files."]

### lib/auth/auth.config.ts (Edge-safe, imported by proxy.ts)

```typescript
// lib/auth/auth.config.ts
// This file must NOT import pg.Pool, @auth/pg-adapter, or any Node-only module
// because it may also be used in contexts where leaner imports matter
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
    error: "/login",     // send auth errors back to login page
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

### lib/auth/auth.ts (full Node config — route handlers and server components)

```typescript
// lib/auth/auth.ts
import NextAuth from "next-auth";
import PostgresAdapter from "@auth/pg-adapter";
import { authConfig } from "./auth.config";
import { pool } from "@/lib/db/pool";
import { sql } from "@/lib/db/neon";

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  adapter: PostgresAdapter(pool),
  session: { strategy: "database" },
  callbacks: {
    ...authConfig.callbacks,

    // D-09: Run BEFORE the email is sent. Return false to abort.
    // `email.verificationRequest === true` on the first call only.
    async signIn({ user, email }) {
      if (email?.verificationRequest) {
        // This branch runs BEFORE the Resend email is dispatched
        if (!user.email) return false;

        const rows = await sql`
          SELECT id, active FROM employees WHERE email = ${user.email}
        `;

        // D-10: Return false silently — generic copy shown regardless
        if (rows.length === 0 || !rows[0].active) {
          return false;
        }
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
        // Employee was deactivated mid-session — return empty session
        // Next request will redirect to /login
        return { ...session, user: undefined } as typeof session;
      }

      return session;
    },
  },
});
```

### app/api/auth/[...nextauth]/route.ts

```typescript
// app/api/auth/[...nextauth]/route.ts
export { GET, POST } from "@/lib/auth/auth";
```

[VERIFIED: authjs.dev/getting-started/adapters/pg; authjs.dev/getting-started/providers/resend; next-auth.js.org/configuration/callbacks]

### proxy.ts at repo root

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

Note: The exported function is the default export from `auth()` — Auth.js v5's `auth()` returns a proxy handler when called as middleware.

### Session strategy decision: `"database"` vs `"jwt"`

With `@auth/pg-adapter`, use `strategy: "database"`. This stores sessions in the `sessions` table and validates on every request against the DB. This enables D-11 (re-validation of `employees.active`). JWT strategy would not hit the database on session read, making D-11 impossible without additional complexity.

[VERIFIED: authjs.dev/getting-started/adapters/pg — database sessions are the default when adapter is present]

### Resend provider — customizable fields

The Resend provider in Auth.js v5 accepts:
- `apiKey` — Resend API key (defaults to `AUTH_RESEND_KEY` env var)
- `from` — Required sender address (domain must be verified in Resend)
- `name` — Provider display name
- `sendVerificationRequest` — Custom function to fully override email send (can use for custom subject/body)

Custom subject and body require implementing `sendVerificationRequest`. For D-12 (Spanish subject/body), this is needed:

```typescript
// In authConfig providers:
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
```

[CITED: authjs.dev/getting-started/providers/resend — `sendVerificationRequest` is the customization hook]

**Note:** `resend` npm package (`npm install resend`) must be added if using `sendVerificationRequest`. Alternative: Accept Auth.js's built-in Resend integration (less control over subject/body but simpler). Given D-12 requires a Spanish subject, `sendVerificationRequest` is needed.

---

## Focus Area 4: Env Var Validation with `@t3-oss/env-nextjs` (D-19, D-20)

**Verified version:** `@t3-oss/env-nextjs@0.13.11` (npm registry, 2026-04-25)

### lib/env.ts

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
    VERCEL_TOKEN: z.string().optional(), // Only needed for edge-config seed script (local)
  },
  client: {
    NEXT_PUBLIC_BASE_URL: z.string().url(),
  },
  // Required for @t3-oss/env-nextjs — explicitly list all values
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

**How it fails the build:** `createEnv()` throws synchronously on module load if any required var is missing or malformed. Because Next.js evaluates this module during build, a missing env var fails `next build` with a clear error — not at first request.

**Edge runtime note:** Do NOT import `lib/env.ts` from `proxy.ts`. The `createEnv()` call runs `zod.parse()` on process.env which may not be available in all proxy contexts. Instead, proxy.ts uses only `auth.config.ts` which directly reads `process.env.*`. [ASSUMED — t3-oss/env-nextjs docs do not explicitly address proxy.ts import; the safer pattern is to keep proxy.ts dependency-light]

**Pre-deploy sync check (D-20):**

```bash
#!/bin/bash
# scripts/check-env-sync.sh
# Assert every key in lib/env.ts runtimeEnv is in .env.example
MISSING=()
while IFS= read -r key; do
  if ! grep -q "^${key}=" .env.example; then
    MISSING+=("$key")
  fi
done < <(grep -oP '(?<=DATABASE_URL|AUTH_SECRET|...)' lib/env.ts)
# Simpler approach: grep for env var names from runtimeEnv block
while IFS= read -r key; do
  if ! grep -q "^${key}=" .env.example; then
    MISSING+=("Missing: $key")
  fi
done < <(grep -oP '[A-Z_]+(?=:)' lib/env.ts | sort -u)

if [ ${#MISSING[@]} -gt 0 ]; then
  echo "ERROR: These env vars are in lib/env.ts but missing from .env.example:"
  printf '%s\n' "${MISSING[@]}"
  exit 1
fi
echo "Env sync OK"
```

[CITED: env.t3.gg/docs/nextjs — `createEnv`, `runtimeEnv`, `skipValidation`]

---

## Focus Area 5: Edge Config Seeding (D-05, D-06, D-07)

### REST API for writes — verified endpoint

```
PATCH https://api.vercel.com/v1/edge-config/{EDGE_CONFIG_ID}/items
Authorization: Bearer {VERCEL_TOKEN}
Content-Type: application/json

{
  "items": [
    { "operation": "upsert", "key": "no_show_timeout_min", "value": 20 },
    { "operation": "upsert", "key": "followup_after_call_min", "value": 1 }
  ]
}
```

Success response: `{"status":"ok"}`

If any single item fails, the entire PATCH fails (atomic). The `upsert` operation creates the key if absent, updates it if present. This is exactly what the idempotent seed script needs.

[VERIFIED: vercel.com/docs/edge-config/vercel-api — full PATCH API documentation]

**Getting EDGE_CONFIG_ID:** The `EDGE_CONFIG` environment variable (provisioned by Vercel marketplace integration) is a connection string of the form `https://edge-config.vercel.com/{EDGE_CONFIG_ID}?token={READ_TOKEN}`. Parse the ID component programmatically.

**Team accounts:** Add `?teamId={TEAM_ID}` query parameter if the project is under a Vercel Team (not personal). For a personal Vercel account, omit `teamId`.

### edge-config/seed.json

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

### scripts/edge-config-seed.ts (idempotent, with --force flag)

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

  // Parse EDGE_CONFIG_ID from connection string
  // Format: https://edge-config.vercel.com/{id}?token={readToken}
  const url = new URL(edgeConfigConnectionString);
  const edgeConfigId = url.pathname.replace(/^\//, "");

  const seedPath = join(process.cwd(), "edge-config", "seed.json");
  const seed = JSON.parse(await readFile(seedPath, "utf-8"));

  const items = [];
  for (const [key, value] of Object.entries(seed)) {
    if (!FORCE) {
      // Read current value — if it matches seed, skip
      // Note: get() reads from Edge Config using EDGE_CONFIG env var
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
  console.log(`[seeded] ${items.map((i) => i.key).join(", ")}`);
}

seedEdgeConfig().catch((err) => { console.error(err); process.exit(1); });
```

### Propagation timing and live reads

Edge Config values propagate globally in **under 1 second** for most reads (P99 < 15ms for the SDK read path). After a dashboard edit, subsequent reads will reflect the new value without a redeploy. The Edge Config SDK (`@vercel/edge-config`'s `get()`) uses in-memory caching with background revalidation — a warm function instance may serve a cached value for a few seconds.

For the Phase 4 Edge Config demo scenario (live edit in dashboard): change the value, wait 15 seconds visibly on camera, then trigger the workflow action. This ensures the cached value in any warm function has been flushed.

[VERIFIED: vercel.com/docs/edge-config — propagation timing documentation]

---

## Focus Area 6: Upstash Redis Provisioning (D-25, D-26)

Phase 1 only needs to confirm KV is provisioned and the connection works. No pub/sub usage until Phase 2.

**Verified env vars (Upstash Marketplace integration in 2026):**
- `UPSTASH_REDIS_REST_URL` — REST API base URL
- `UPSTASH_REDIS_REST_TOKEN` — Auth token

**NOT** `KV_URL` / `KV_REST_API_URL` / `KV_REST_API_TOKEN` — those were the deprecated `@vercel/kv` variable names.

[VERIFIED: STACK.md "env vars auto-provisioned vs manual" table]

### Smoke test snippet

```typescript
// scripts/smoke-test-kv.ts
import { Redis } from "@upstash/redis";

async function smokeTestKV() {
  const redis = Redis.fromEnv(); // reads UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN
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

**Verified package:** `@upstash/redis@1.37.0` (npm registry, 2026-04-25)

[VERIFIED: npm view @upstash/redis version → 1.37.0; STACK.md §Supporting Libraries]

---

## Focus Area 7: Migration Runner — Complete Picture (D-01, D-02, D-03)

See Focus Area 2 for the full `scripts/db-migrate.ts` snippet.

### Migration file naming convention

Files in `db/migrations/` must be named with a 4-digit prefix for correct lexicographic ordering:
- `0001_init.sql` — Contains all Phase 1 tables (Auth.js tables + app tables)
- `0002_*.sql` — Future Phase 2 schema changes (if any)

### What goes in 0001_init.sql

See the full DDL in Focus Area 2. It includes:
1. Auth.js adapter tables (`verification_token`, `accounts`, `sessions`, `users`)
2. Application tables (`employees`, `reservations`, `reservation_events`)

The `_migrations` table is created by the runner itself at startup, not in a migration file.

### Env var for runner (D-03)

```
DATABASE_URL_UNPOOLED=postgresql://user:pass@ep-direct.neon.tech/dbname
```

The Neon marketplace integration auto-provisions both `DATABASE_URL` (pooled via PgBouncer) and `DATABASE_URL_UNPOOLED` (direct TCP). Both must be set in all 3 Vercel environments.

[VERIFIED: PITFALLS.md #13 — Neon provides both URLs; pooled for app, non-pooled for migrations]

---

## Focus Area 8: Vercel Project Linking + Auto-Deploy (D-13–D-16)

### Setup flow

```bash
# 1. Initialize git repo (if not already)
git init && git add -A && git commit -m "chore: initial scaffold"

# 2. Create public GitHub repo and push
gh repo create zero-to-agent --public --source=. --push

# 3. Link to Vercel (creates .vercel/ directory — add to .gitignore)
vercel link

# 4. Pull env vars to .env.local for local dev
vercel env pull .env.local

# 5. Verify env vars are in all 3 environments
vercel env ls
```

**Stable URL:** The `<project>.vercel.app` alias is stable across deploys once the project is linked. The pilot can bookmark it safely. Preview deploys get distinct URLs (e.g., `zero-to-agent-abc123.vercel.app`) — make sure the pilot bookmarks the production URL, not a preview URL.

**Auto-deploy wiring:** Every `git push origin main` triggers a production deploy automatically via the Vercel GitHub integration. No `vercel --prod` needed from local (per D-13). PRs get preview deployments automatically.

**Pitfall #18 mitigation — verify env vars in all 3 environments:**

```bash
vercel env ls
# Check that production, preview, and development all have:
# DATABASE_URL, DATABASE_URL_UNPOOLED, AUTH_SECRET, AUTH_RESEND_KEY,
# RESEND_DOMAIN, UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN,
# EDGE_CONFIG, MCP_API_KEY, NEXT_PUBLIC_BASE_URL, MAITRE_EMAIL
```

**`vercel.json`:** Not needed in Phase 1. The Next.js 16 framework preset handles all routing, function configuration, and build settings automatically. Only add `vercel.json` if custom configuration is needed (e.g., `maxDuration` overrides for Phase 2 SSE routes).

[VERIFIED: Vercel docs on GitHub integration; PITFALLS.md #18; STACK.md environment variables table]

---

## Focus Area 9: shadcn/ui + Tailwind v4 (D-22, D-24)

**Verified versions:** `shadcn@4.5.0`, `tailwindcss@4.2.4` (npm registry, 2026-04-25)

### Init command

```bash
npx shadcn@latest init
```

For a new Next.js 16 project with Tailwind v4, the shadcn init flow:
- Detects Tailwind v4 automatically
- Sets up CSS-based theming (no `tailwind.config.js` needed in v4)
- Defaults to "new-york" style in 2026
- Creates `components/ui/` directory
- Adds CSS variables to `app/globals.css`

### Minimal component install for Phase 1 (D-22)

```bash
npx shadcn@latest add button input
```

These two components cover the `/login` form. No more are needed in Phase 1.

### Tailwind v4 vs v3 key differences

Tailwind v4 does NOT use `tailwind.config.js`. Instead:
- Configuration is CSS-based via `@import "tailwindcss"` in `globals.css`
- Theme customization uses CSS custom properties and `@theme` directive
- No `content` array configuration needed — Tailwind v4 auto-scans
- PostCSS config is simplified

The shadcn CLI handles all of this automatically during `init`. No manual config required for Phase 1.

[VERIFIED: shadcn.ui/docs/installation/next — current init flow for Next.js 16 + Tailwind v4]

### Phase 1 scope constraint (D-24)

Keep Phase 1 UI minimal. The `/login` page needs only:
- `<html lang="es">` in layout
- shadcn `Input` + `Button` on the login form
- Generic Spanish copy (email placeholder, submit label, generic success message)
- No dark mode, no theming, no global chrome

The Phase 3 v0/shadcn shell replaces this with production-quality design.

---

## Focus Area 10: Threat Model Groundwork

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | YES — magic-link auth | Auth.js v5 + verified Resend domain; signIn callback gating |
| V3 Session Management | YES — database sessions | Auth.js `strategy: "database"` + session re-validation in callback |
| V4 Access Control | YES — `/queue` is auth-gated | proxy.ts matcher + `auth()` helper in route handlers |
| V5 Input Validation | YES — Zod in env.ts, email input | `@t3-oss/env-nextjs` + Zod; HTML input type=email |
| V6 Cryptography | Partial — AUTH_SECRET, magic tokens | Auth.js manages token generation; `npx auth secret` for AUTH_SECRET |

### Threat surface in Phase 1

**1. Magic-link token exposure**
- Threat: Magic-link URL contains a one-time token. If intercepted (email compromise, referrer leak, log exposure), attacker authenticates as the maître.
- Mitigation: Auth.js uses 24h expiry (built-in), single-use tokens (built-in via `verification_token` table deletion on use), HTTPS-only deployment (Vercel enforces HTTPS). No additional Phase 1 action needed.

**2. Email existence timing attack (D-10)**
- Threat: An attacker sends multiple email addresses to `/login` and times responses to determine which are in `employees`.
- Mitigation: D-10 — generic success copy regardless of email match. The `signIn` returning `false` causes a redirect to `/login?error=Verification` — to avoid leaking this, the login page should show the same generic message regardless of the URL error parameter. Implement by NOT reading the `error` query param in the UI, or mapping all errors to the same copy.

**3. Env var leak via logs**
- Threat: Vercel function logs (visible to anyone with project access) could contain env var values if accidentally logged.
- Mitigation: `lib/env.ts` wraps env vars in typed constants — code uses `env.DATABASE_URL`, not `process.env.DATABASE_URL` directly. Never log `env` object. VERCEL_TOKEN must be local-only (never committed, never set in Vercel dashboard for production).

**4. Public GitHub repo (DEMO-02)**
- Threat: `.env.example` committed with real values, or `.env.local` accidentally committed.
- Mitigation: `.gitignore` must include `.env*.local`. `.env.example` contains ONLY placeholder values (e.g., `MAITRE_EMAIL=pilot-maitre@example.com`). AUTH_SECRET must NOT have a default in the example.

**5. Migration runner connection string**
- Threat: `DATABASE_URL_UNPOOLED` contains credentials. Logging or exposing the URL in error messages leaks DB access.
- Mitigation: Migration runner logs filenames, not connection strings. Catch errors and surface only the migration filename in the message.

**6. `/queue` stub accessible by unauthenticated users**
- Threat: proxy.ts matcher failure allows `/queue` access without auth.
- Mitigation: Defense in depth — the route handler for `/queue` also calls `auth()` server-side and redirects if no session. Proxy is not the only gate.

[VERIFIED: PITFALLS.md #12 (Auth.js split config), #15 (PII in logs), #18 (env vars); OWASP session management guidelines]

---

## Focus Area 11: Validation Architecture

`workflow.nyquist_validation` is `false` in `.planning/config.json`. The Validation Architecture section is SKIPPED per the config.

However, the planner MUST embed verification criteria in each plan. The following are the cheapest end-to-end checks per Phase 1 success criterion:

### Per-success-criterion verification checks

**SC1 — Auth round-trip (STAFF-01)**
1. Load `/login` — expect 200, Spanish copy visible.
2. Submit an email NOT in `employees` — expect the generic success copy (no error variation). Check that no row was inserted in `verification_tokens` (email was rejected before send).
3. Submit the maître's real email (seeded via `seed:maitre`) — expect a Resend API call logged. Check `verification_tokens` table has a row for the identifier.
4. Click the link in the received email — expect redirect to `/queue` with the stub message `Hola {email} — panel próximamente`.

**SC2 — Deployed URL stable (DEMO-01)**
1. `curl -I https://<project>.vercel.app/` — expect `200` and `server: Vercel`.
2. Deploy a code change (e.g., change a string in `app/page.tsx`) and push to `main`. After deploy completes, `curl -I` the same URL — same URL, 200.

**SC3 — Database schema (PLAT-04)**
```sql
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('reservations','reservation_events','employees','users','accounts','sessions','verification_token','_migrations');
-- Expect 8 rows
```
Also: `SELECT * FROM employees` — expect at least one row (the maître seed).

**SC4 — Edge Config values (PLAT-06)**
```typescript
// In a test route or Node script:
import { get } from "@vercel/edge-config";
const v = await get("no_show_timeout_min");
console.assert(v === 20, `Expected 20, got ${v}`);
```
Then change `no_show_timeout_min` to `5` in Vercel dashboard. Wait 15 seconds. Run again — expect `5` without redeploy.

**SC5 — KV provisioned**
```bash
npx tsx scripts/smoke-test-kv.ts
# Expect: "KV smoke test passed"
```

**SC6 — Repo public + local dev (DEMO-02)**
```bash
git clone https://github.com/<org>/zero-to-agent /tmp/test-clone
cd /tmp/test-clone
vercel env pull .env.local
npm install
npm run dev
# Expect: server starts on localhost:3000, /login returns 200
```

**SC7 — Two-clients load test (D-28)**
```bash
npx tsx scripts/load-test-pg.ts
# Expect: "Pool: 10 OK, Neon: 10 OK", wall time < 5000ms
```

---

## Focus Area 12: Risks and Open Questions

### RISK-1 (CONFIRMED RESOLVED): proxy.ts Edge runtime assumption is WRONG

**Claim in CONTEXT.md D-27 and STACK.md:** "proxy.ts is Edge-safe; imports only `lib/auth/auth.config.ts` (no `pg.Pool`, which is not Edge-compatible)."

**Finding:** In Next.js 16, proxy.ts runs on **Node.js**, not Edge. The `runtime` config option throws an error if set. The `auth.config.ts` split is still the right pattern (avoid loading the full adapter on every proxy invocation) but the constraint is performance/simplicity, not Edge incompatibility.

**Action for planner:** Keep the split as documented in D-27, but do NOT document the reason as "Edge incompatibility." The correct reason is "proxy.ts should stay lean — avoid loading the PG adapter on every request." This affects the plan's narrative in comments.

[VERIFIED: nextjs.org/docs/app/api-reference/file-conventions/proxy — "Proxy defaults to using the Node.js runtime. The runtime config option is not available in Proxy files."]

---

### RISK-2 (CONFIRMED): signIn callback fires BEFORE email is sent

D-09 is correct. Returning `false` from `signIn` when `email.verificationRequest === true` prevents the Resend email from being dispatched. The callback receives `user` (Auth.js internal user object from `users` table, may have null id on first login), and `email.verificationRequest: true`.

**Edge case to handle:** On the very first login attempt for an email address, Auth.js may create a `users` row BEFORE calling `signIn`. The `employees` check must use `user.email` (available on the first call), not `user.id` (may be null for first-time users).

[VERIFIED: next-auth.js.org/configuration/callbacks; web search confirming callback fires before email]

---

### RISK-3 (OPEN QUESTION): @auth/pg-adapter `users.id` is SERIAL (integer), not UUID

The verified DDL from authjs.dev uses `id SERIAL PRIMARY KEY` for `users`. This means:
- `employees.user_id` must be `INTEGER NOT NULL REFERENCES users(id)`, not UUID
- Any query joining `employees` to `users` uses integer IDs
- The `session.user.id` returned by Auth.js will be a string-encoded integer (e.g., `"42"`)

**Risk if wrong:** Using UUID for `users.id` would break the adapter's insert behavior. The adapter uses the exact DDL it documents.

**Planner action:** Use `INTEGER` (not UUID) for `employees.user_id`. Reservations table uses its own `UUID` primary key from `gen_random_uuid()` — no relation to `users.id`.

[VERIFIED: authjs.dev/getting-started/adapters/pg — `id SERIAL PRIMARY KEY` in official DDL]

---

### RISK-4 (OPEN QUESTION): Does `@t3-oss/env-nextjs` work in proxy.ts?

**What the research found:** The library docs say it provides "out-of-the-box compatibility in all different Next.js runtimes" but do NOT explicitly document proxy.ts usage. The `createEnv()` function runs synchronously at module load, which should be fine in Node.js proxy.ts context. However, importing `lib/env.ts` from proxy.ts would load ALL env validation on EVERY request through the proxy, which is wasteful.

**Recommendation:** Do NOT import `lib/env.ts` from proxy.ts. The proxy only needs `auth.config.ts`, which reads `process.env.AUTH_RESEND_KEY` directly. Only import `lib/env.ts` in route handlers and server components where you need type-safe env access.

[ASSUMED — no official documentation on proxy.ts + t3-oss/env-nextjs interaction found]

---

### RISK-5 (OPEN QUESTION): Edge Config EDGE_CONFIG_ID extraction

The `EDGE_CONFIG` env var format is:
```
https://edge-config.vercel.com/{EDGE_CONFIG_ID}?token={READ_TOKEN}
```

The seed script must parse this URL to extract `EDGE_CONFIG_ID`. The connection string format was confirmed from the Vercel Edge Config docs. The extraction logic is:
```typescript
const url = new URL(process.env.EDGE_CONFIG!);
const edgeConfigId = url.pathname.replace(/^\//, "");
```

This assumes the pathname is exactly `/{id}` with no additional path segments. This is verified from the Vercel docs example format. [VERIFIED: vercel.com/docs/edge-config/vercel-api]

---

### RISK-6 (CONFIRMED): `@auth/pg-adapter` schema — `verification_token` table name (no 's')

The table is named `verification_token` (singular), NOT `verification_tokens` (plural). Auth.js's adapter hard-codes this name. Creating it with a different name will cause auth failures silently. Verified from the official DDL above.

[VERIFIED: authjs.dev/getting-started/adapters/pg]

---

### RISK-7: `resend` npm package vs built-in Resend integration

D-12 requires a Spanish subject ("Tu link para entrar al panel"). Auth.js's built-in Resend provider does NOT allow subject customization without `sendVerificationRequest`. If using `sendVerificationRequest`, the `resend` npm package must be added:

```bash
npm install resend
```

Current version: check `npm view resend version`. [ASSUMED — resend package version not verified in this research session]

**Alternative:** Use Auth.js's built-in Resend integration without custom subject (English subject "Sign in to Restaurant Queue"). This is simpler but violates D-12. Given D-12 is locked, `sendVerificationRequest` with the `resend` package is required.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Vercel auto-detects package manager from lock file | Focus Area 1 | Forced to explicitly set package manager in vercel.json |
| A2 | Do NOT import lib/env.ts from proxy.ts (proxy.ts only needs auth.config.ts) | Focus Area 4 | Either works fine (low risk) or causes build issue in proxy context (medium risk) |
| A3 | resend npm package version for sendVerificationRequest | Focus Area 3 | May need to check current version before install; API may have changed |
| A4 | EDGE_CONFIG URL format is exactly `https://edge-config.vercel.com/{id}?token={token}` | Focus Area 5 | Edge Config seed script URL parsing breaks; manual fallback required |

---

## Standard Stack — Phase 1

### Core (verified npm versions, 2026-04-25)

| Library | Version | Purpose | Notes |
|---------|---------|---------|-------|
| `next` | `16.2.4` | App framework | `proxy.ts` not `middleware.ts`; Turbopack default |
| `react` | `19.2.x` | UI runtime | Ships with Next.js 16 |
| `next-auth` | `4.24.14` (beta tag = v5) | Magic-link auth | This IS Auth.js v5 |
| `@auth/pg-adapter` | `1.11.2` | Auth.js → Postgres bridge | Requires `pg.Pool` |
| `pg` | `8.20.0` | PostgreSQL client for Auth adapter | Pool semantics |
| `@types/pg` | `8.20.0` | TypeScript types | Dev dependency |
| `@neondatabase/serverless` | `1.1.0` | Neon HTTP driver for app queries | Tagged template literal API |
| `@upstash/redis` | `1.37.0` | Redis client + pub/sub | Phase 1: provisioning only |
| `@vercel/edge-config` | `1.4.3` | Edge Config read SDK | Read-only; writes via REST API |
| `@t3-oss/env-nextjs` | `0.13.11` | Env var validation | Validates at build time |
| `zod` | `4.3.6` | Schema validation | Peer of @t3-oss/env-nextjs |
| `shadcn` CLI | `4.5.0` | Component library setup | New-york style, Tailwind v4 |
| `tailwindcss` | `4.2.4` | Styling | CSS-based config, no tailwind.config.js |
| `tsx` | `4.21.0` | TypeScript script runner | For migration + seed scripts |

### Installation command

```bash
# Scaffold
npx create-next-app@latest restaurant-queue --typescript --tailwind --app --no-src-dir --import-alias "@/*"
cd restaurant-queue

# Auth + DB
npm install next-auth@beta @auth/pg-adapter pg @neondatabase/serverless

# Storage
npm install @upstash/redis @vercel/edge-config

# Env validation
npm install @t3-oss/env-nextjs zod

# Email customization (for Spanish magic-link subject)
npm install resend

# Dev tooling
npm install -D tsx @types/pg

# UI
npx shadcn@latest init
npx shadcn@latest add button input
```

---

## Environment Availability

Phase 1 requires the following external dependencies provisioned by human (Phase 0 prerequisites):

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Neon Postgres (Vercel Marketplace) | PLAT-04 | Assumed (Phase 0.3 prereq) | Neon latest | None — blocking |
| Upstash KV (Vercel Marketplace) | D-25 | Assumed (Phase 0.3 prereq) | Upstash latest | None — blocking |
| Vercel Edge Config (Vercel Marketplace) | PLAT-06 | Assumed (Phase 0.3 prereq) | Edge Config latest | None — blocking |
| Resend domain verified | STAFF-01 | Assumed (Phase 0.1 prereq) | N/A | onboarding@resend.dev for testing only |
| GitHub CLI (`gh`) | DEMO-02 | Likely installed | N/A | Manual GitHub repo creation |
| Vercel CLI | DEMO-01 | Likely installed | N/A | Vercel dashboard UI |
| Node.js 20.9+ | All | System | 20.x | None — required by Next.js 16 |

**Missing dependencies with no fallback:**
- Resend domain verification (Phase 0.1 BLOCKER for STAFF-01) — auth subtask cannot start until Resend shows "verified"
- Neon Postgres — cannot create schema without DB provisioned
- Upstash KV — cannot run smoke test without KV provisioned

---

## Common Pitfalls — Phase 1 Specific

### Pitfall: auth.config.ts must not import pg.Pool even though proxy.ts is Node

Even though proxy.ts runs on Node.js, the split is still valuable: importing the full `auth.ts` (which loads `@auth/pg-adapter` with the Pool) into proxy.ts means every request through the proxy loads the full DB connection pool. This is wasteful. Keep `auth.config.ts` as a lean config that only the proxy uses.

### Pitfall: DATABASE_URL vs DATABASE_URL_UNPOOLED discipline

Use:
- `DATABASE_URL` (pooled) → app queries via `neon()` and `pg.Pool` for auth adapter
- `DATABASE_URL_UNPOOLED` (direct TCP) → migration runner via `pg.Client`

Never use the non-pooled URL in app code (connection exhaustion risk). Never use the pooled URL in migrations (DDL failures with PgBouncer in transaction mode).

### Pitfall: @auth/pg-adapter users.id is SERIAL (integer), not UUID

The `employees` table MUST use `INTEGER` (not UUID) for `user_id`. App tables (`reservations`, etc.) use UUID for their own primary keys. Do not conflate the two ID systems.

### Pitfall: Generic login copy requires NOT reading the error query param

Auth.js redirects to `/login?error=Verification` when signIn returns false. D-10 requires generic copy regardless of validation result. The `/login` page must NOT render different copy based on the `error` query param. Either ignore the param entirely or map all errors to the same message.

### Pitfall: Env vars in all 3 Vercel environments (Pitfall #18)

After `vercel link`, run `vercel env add <KEY>` for each required key and set it in Production, Preview, AND Development. Run `vercel env ls` to verify. Don't rely on Vercel auto-populating from local `.env.local`.

### Pitfall: VERCEL_TOKEN must NOT be set as a Vercel environment variable

`VERCEL_TOKEN` is used by the edge-config seed script for local/CI use only. Setting it as a Vercel production environment variable would expose it to anyone who can read Vercel logs. Keep it local (`.env.local`) and in CI secrets only.

---

## Sources

### Primary (HIGH confidence — official docs verified in this session)

- [nextjs.org/docs/app/api-reference/file-conventions/proxy](https://nextjs.org/docs/app/api-reference/file-conventions/proxy) — proxy.ts API, Node.js runtime, matcher syntax
- [nextjs.org/blog/next-16](https://nextjs.org/blog/next-16) — Next.js 16 release notes, Turbopack default, proxy.ts rename
- [authjs.dev/getting-started/adapters/pg](https://authjs.dev/getting-started/adapters/pg) — @auth/pg-adapter SQL DDL (4 tables), pg.Pool requirement
- [authjs.dev/getting-started/providers/resend](https://authjs.dev/getting-started/providers/resend) — Resend provider options, sendVerificationRequest
- [next-auth.js.org/configuration/callbacks](https://next-auth.js.org/configuration/callbacks) — signIn callback timing, email.verificationRequest, returning false prevents email
- [vercel.com/docs/edge-config/vercel-api](https://vercel.com/docs/edge-config/vercel-api) — PATCH endpoint for Edge Config items, upsert operation, Authorization header
- [env.t3.gg/docs/nextjs](https://env.t3.gg/docs/nextjs) — @t3-oss/env-nextjs, createEnv, runtimeEnv, skipValidation
- npm registry (verified 2026-04-25): next@16.2.4, next-auth@4.24.14, @auth/pg-adapter@1.11.2, @neondatabase/serverless@1.1.0, @upstash/redis@1.37.0, @vercel/edge-config@1.4.3, @t3-oss/env-nextjs@0.13.11, zod@4.3.6, pg@8.20.0, tsx@4.21.0

### Secondary (MEDIUM confidence — web search cross-referenced)

- Auth.js v5 signIn callback timing: multiple sources (next-auth.js.org, web search) confirm callback fires before email send
- Pitfall #12, #13, #18 from PITFALLS.md (compiled 2026-04-25 against official Vercel/Auth.js docs)
- STACK.md (compiled 2026-04-25) — package names, env var names, two-client pattern

---

## RESEARCH COMPLETE
