---
phase: 01-foundation
plan: 03
type: execute
wave: 2
depends_on:
  - 01
files_modified:
  - db/schema.sql
  - db/migrations/0001_init.sql
  - scripts/db-migrate.ts
  - scripts/seed-maitre.ts
  - scripts/load-test-pg.ts
  - lib/db/neon.ts
  - lib/db/pool.ts
  - package.json
autonomous: false
requirements:
  - PLAT-04

must_haves:
  truths:
    - "Postgres has all 7 expected tables migrated (users, accounts, sessions, verification_token, employees, reservations, reservation_events)"
    - "_migrations table tracks 0001_init.sql as applied"
    - "employees has at least 1 row matching MAITRE_EMAIL after seed"
    - "Two-clients load test passes (10 Pool + 10 Neon queries < 5s wall)"
    - "Migration runner uses DATABASE_URL_UNPOOLED, app clients use DATABASE_URL"
  artifacts:
    - path: "db/migrations/0001_init.sql"
      provides: "All Phase 1 tables: 4 Auth.js tables + 3 app tables"
      contains: "CREATE TABLE IF NOT EXISTS users"
    - path: "db/schema.sql"
      provides: "Reference snapshot mirror of current schema"
    - path: "scripts/db-migrate.ts"
      provides: "Forward-only migration runner with _migrations tracking"
    - path: "scripts/seed-maitre.ts"
      provides: "Idempotent upsert of MAITRE_EMAIL into employees"
    - path: "scripts/load-test-pg.ts"
      provides: "Two-client concurrency soft gate per D-28"
    - path: "lib/db/neon.ts"
      provides: "@neondatabase/serverless HTTP client for app queries (DATABASE_URL pooled)"
      exports: ["sql"]
    - path: "lib/db/pool.ts"
      provides: "pg.Pool for @auth/pg-adapter (DATABASE_URL pooled)"
      exports: ["pool"]
  key_links:
    - from: "scripts/db-migrate.ts"
      to: "DATABASE_URL_UNPOOLED"
      via: "pg.Client (direct TCP, not PgBouncer)"
      pattern: "process.env.DATABASE_URL_UNPOOLED"
    - from: "lib/db/neon.ts and lib/db/pool.ts"
      to: "DATABASE_URL"
      via: "pooled connection (PgBouncer)"
      pattern: "process.env.DATABASE_URL"
    - from: "scripts/seed-maitre.ts"
      to: "employees table"
      via: "ON CONFLICT (email) DO UPDATE SET active = true"
      pattern: "INSERT.*ON CONFLICT.*DO UPDATE"
    - from: "employees.user_id"
      to: "users.id"
      via: "INTEGER FK (NOT UUID — research correction RISK-3)"
      pattern: "user_id INTEGER REFERENCES users\\(id\\)"
---

<objective>
Migrate the Neon Postgres schema with all 7 tables required for Phase 1 + Auth.js, ship the forward-only migration runner with `_migrations` tracking, seed the maître's `employees` row, and prove the two-pg-clients pattern works under concurrent load.

Purpose: Without the schema migrated, Auth.js cannot store sessions and the `signIn` callback (PLAN-04) has no `employees` table to query. Without the load test, the two-clients-on-Neon pattern is unverified (research open question #7).
Output: Live Neon database with all tables; migration runner script; maître row seeded; two pg clients (Neon HTTP + pg.Pool) coexisting safely; both DB libraries (`lib/db/neon.ts`, `lib/db/pool.ts`) exporting their respective handles.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/01-foundation/01-CONTEXT.md
@.planning/phases/01-foundation/01-RESEARCH.md
@.planning/phases/01-foundation/01-PATTERNS.md
@.planning/phases/01-foundation/01-01-scaffold-vercel-env-PLAN.md
@CLAUDE.md

<interfaces>
<!-- Verbatim canonical snippets from 01-PATTERNS.md and 01-RESEARCH.md -->
<!-- Two research corrections embedded inline:
     1. users.id is SERIAL (integer), employees.user_id is INTEGER REFERENCES users(id) — NOT UUID
     2. verification_token is singular (no 's') — Auth.js adapter hard-codes this name
-->

From 01-PATTERNS.md `db/migrations/0001_init.sql` (lines 627-701) — copy verbatim:
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

From 01-PATTERNS.md `lib/db/neon.ts` (lines 226-237) — copy verbatim:
```typescript
import { neon } from "@neondatabase/serverless";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required");
}

export const sql = neon(process.env.DATABASE_URL);
```

From 01-PATTERNS.md `lib/db/pool.ts` (lines 252-266) — copy verbatim:
```typescript
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

From 01-PATTERNS.md `scripts/db-migrate.ts` (lines 724-785) — copy verbatim:
```typescript
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

From 01-PATTERNS.md `scripts/seed-maitre.ts` (lines 805-833) — copy verbatim:
```typescript
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

From 01-PATTERNS.md `scripts/load-test-pg.ts` (lines 963-996) — copy verbatim:
```typescript
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
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Write DDL (db/migrations/0001_init.sql + db/schema.sql) + DB clients (lib/db/neon.ts + lib/db/pool.ts)</name>
  <files>db/migrations/0001_init.sql, db/schema.sql, lib/db/neon.ts, lib/db/pool.ts</files>
  <read_first>
    - .planning/phases/01-foundation/01-PATTERNS.md (sections "db/migrations/0001_init.sql", "db/schema.sql", "lib/db/neon.ts", "lib/db/pool.ts" — all verbatim snippets)
    - .planning/phases/01-foundation/01-RESEARCH.md (Focus Area 2 "@auth/pg-adapter SQL DDL — what to include in 0001_init.sql"; RISK-3 — `users.id` is SERIAL/INTEGER NOT UUID; RISK-6 — `verification_token` is singular)
    - .planning/phases/01-foundation/01-CONTEXT.md (D-01 plain SQL, D-04 no ORM, D-26 lib/db/ two-client structure)
    - lib/env.ts (created in PLAN-01) — confirm env var name conventions
  </read_first>
  <action>
    1. Create `db/migrations/0001_init.sql` with the verbatim DDL from `<interfaces>` above. **Critical correctness invariants**:
       - Table is named `verification_token` (singular, no `s`) — Auth.js adapter hard-codes this name (RISK-6).
       - `users.id` is `SERIAL PRIMARY KEY` (integer auto-increment), NOT UUID. The `@auth/pg-adapter` schema is rigidly integer-keyed (RISK-3 confirmed by research).
       - `employees.user_id` is `INTEGER REFERENCES users(id) ON DELETE CASCADE` (matching the integer FK to `users.id`). Do NOT change to UUID.
       - `accounts."userId"` and `sessions."userId"` are `INTEGER NOT NULL` with double-quoted camelCase (matches Auth.js adapter expectation — Postgres treats unquoted as lowercase, the adapter inserts/queries with double quotes).
       - `reservations.id` is its own UUID (`gen_random_uuid()`) — separate ID space from `users.id`. The two never join directly.
       - All tables use `CREATE TABLE IF NOT EXISTS` so the migration is re-runnable on a clean DB without conflict (the migration runner additionally tracks via `_migrations`).
       - The `_migrations` table is NOT created in this file — the runner creates it before reading migrations.
       - Order matters in the file: `users` before any FK referencing it (`employees`, `accounts`, `sessions`); `reservations` before `reservation_events`. The verbatim snippet has the safe order.

    2. Create `db/schema.sql` as an exact mirror of `db/migrations/0001_init.sql` content. This file is a human-readable snapshot of "current schema" — kept in sync with migrations manually. The migration runner does NOT read this file.

    3. Create `lib/db/neon.ts` with the verbatim snippet from `<interfaces>`. Behavior:
       - Imports `neon` from `@neondatabase/serverless` (HTTP transport).
       - Reads `process.env.DATABASE_URL` directly (NOT via `lib/env.ts`) — module-load-order constraint per PATTERNS.md "Note" on this file.
       - Throws synchronously on missing `DATABASE_URL`.
       - Exports `sql` (tagged-template-literal query function). One query = one HTTP request. No persistent connection. Tagged-template usage example: ` sql`SELECT * FROM employees WHERE email = ${email}` `.
       - Used for ALL app queries in route handlers, server components, future workflow steps.

    4. Create `lib/db/pool.ts` with the verbatim snippet from `<interfaces>`. Behavior:
       - Imports `Pool` from `pg`.
       - Reads `process.env.DATABASE_URL` directly (same module-load reasoning).
       - Pool config: `max: 5`, `idleTimeoutMillis: 30_000`, `connectionTimeoutMillis: 5_000` — conservative for Neon's serverless connection limits.
       - Exports `pool`. **Used ONLY by `@auth/pg-adapter`** in PLAN-04. App code never imports this directly.

    5. Confirm both clients point at `DATABASE_URL` (the **pooled** PgBouncer URL), NOT `DATABASE_URL_UNPOOLED`. The non-pooled URL is reserved for the migration runner (PLAN-03 Task 2) and seed script (PLAN-03 Task 3) where direct TCP is required for DDL/long-running scripts (Pitfall #13).
  </action>
  <verify>
    <automated>test -f db/migrations/0001_init.sql && test -f db/schema.sql && test -f lib/db/neon.ts && test -f lib/db/pool.ts && grep -q 'CREATE TABLE IF NOT EXISTS verification_token' db/migrations/0001_init.sql && grep -qv 'CREATE TABLE IF NOT EXISTS verification_tokens' db/migrations/0001_init.sql && grep -q 'CREATE TABLE IF NOT EXISTS users' db/migrations/0001_init.sql && grep -q 'id SERIAL PRIMARY KEY' db/migrations/0001_init.sql && grep -q 'user_id INTEGER REFERENCES users(id)' db/migrations/0001_init.sql && grep -q 'CREATE TABLE IF NOT EXISTS employees' db/migrations/0001_init.sql && grep -q 'CREATE TABLE IF NOT EXISTS reservations' db/migrations/0001_init.sql && grep -q 'CREATE TABLE IF NOT EXISTS reservation_events' db/migrations/0001_init.sql && grep -q 'gen_random_uuid()' db/migrations/0001_init.sql && grep -q "CHECK (status IN ('waiting'" db/migrations/0001_init.sql && diff -q db/schema.sql db/migrations/0001_init.sql && grep -q 'import { neon }' lib/db/neon.ts && grep -q 'export const sql = neon' lib/db/neon.ts && grep -q 'process.env.DATABASE_URL' lib/db/neon.ts && grep -qv 'DATABASE_URL_UNPOOLED' lib/db/neon.ts && grep -q 'import { Pool }' lib/db/pool.ts && grep -q 'export const pool' lib/db/pool.ts && grep -q 'max: 5' lib/db/pool.ts && grep -qv 'DATABASE_URL_UNPOOLED' lib/db/pool.ts</automated>
  </verify>
  <acceptance_criteria>
    - `db/migrations/0001_init.sql` contains 7 `CREATE TABLE IF NOT EXISTS` statements: `verification_token` (singular), `accounts`, `sessions`, `users`, `employees`, `reservations`, `reservation_events`
    - `users.id` declared as `SERIAL PRIMARY KEY` (NOT UUID)
    - `employees.user_id` declared as `INTEGER REFERENCES users(id) ON DELETE CASCADE` (NOT UUID)
    - `reservations.id` declared as `UUID PRIMARY KEY DEFAULT gen_random_uuid()`
    - `reservations.status` has CHECK constraint listing all 6 status strings: `waiting, called, seated, no_show, cancelled, failed_to_start`
    - `db/schema.sql` is byte-identical to `db/migrations/0001_init.sql` (`diff -q` returns no differences)
    - `lib/db/neon.ts` exports `sql` from `neon(process.env.DATABASE_URL)`, throws on missing env var
    - `lib/db/pool.ts` exports `pool` from `new Pool({ connectionString: process.env.DATABASE_URL, max: 5, ... })`, throws on missing env var
    - Neither `lib/db/*.ts` file references `DATABASE_URL_UNPOOLED`
  </acceptance_criteria>
  <done>
    DDL committed with all 7 tables in correct order, integer FK pattern correctly applied (research correction RISK-3), `verification_token` named singular (RISK-6), schema.sql mirror in sync, both DB client modules ready to be imported by Auth.js adapter (PLAN-04) and app queries.
  </done>
</task>

<task type="auto">
  <name>Task 2: Create migration runner + seed script + load test + npm scripts</name>
  <files>scripts/db-migrate.ts, scripts/seed-maitre.ts, scripts/load-test-pg.ts, package.json</files>
  <read_first>
    - .planning/phases/01-foundation/01-PATTERNS.md (sections "scripts/db-migrate.ts", "scripts/seed-maitre.ts", "scripts/load-test-pg.ts" — all verbatim snippets)
    - .planning/phases/01-foundation/01-RESEARCH.md (Focus Area 2 "Migration runner" + "Two-clients load test"; "Pitfall: DATABASE_URL vs DATABASE_URL_UNPOOLED discipline")
    - .planning/phases/01-foundation/01-CONTEXT.md (D-02 _migrations table, D-03 non-pooled URL for migrations, D-17 MAITRE_EMAIL env var, D-28 load test with <5s wall asserts)
    - .planning/research/PITFALLS.md #13 — pooled vs non-pooled discipline
    - db/migrations/0001_init.sql (just created — runner reads this directory)
    - lib/db/neon.ts and lib/db/pool.ts (just created — load test imports both)
    - package.json (PLAN-01 added `check:env-sync`, PLAN-02 added `edge-config:seed` and `smoke:kv` — must extend, not overwrite)
  </read_first>
  <action>
    1. Create `scripts/db-migrate.ts` with the verbatim snippet from `<interfaces>`. Critical invariants:
       - Uses `pg.Client` (NOT Pool, NOT neon) — direct connection, opened and closed once per invocation.
       - Connects via `process.env.DATABASE_URL_UNPOOLED` (Pitfall #13: PgBouncer in transaction mode blocks DDL like `CREATE TABLE`).
       - Creates `_migrations` table at startup if missing (`CREATE TABLE IF NOT EXISTS _migrations (filename TEXT PRIMARY KEY, applied_at TIMESTAMPTZ DEFAULT NOW())`). NOT created in `0001_init.sql`.
       - Reads `db/migrations/*.sql` files via `readdir()`, filters `.sql`, sorts lexicographically (NNNN_ prefix ensures correct order).
       - For each file: SELECT existing row from `_migrations`; if present, log `[skip] {filename}` and continue. If absent: BEGIN → run SQL → INSERT into `_migrations` → COMMIT. ROLLBACK on any error and re-throw with the filename.
       - Logs ONLY filenames, never SQL content, never connection strings (security/PII discipline preview for SAFE-01).
       - Tail-call error handler: `migrate().catch((err) => { console.error(err); process.exit(1); })`.

    2. Create `scripts/seed-maitre.ts` with the verbatim snippet from `<interfaces>`. Critical invariants:
       - Reads `MAITRE_EMAIL` from `process.env`; throws clearly if missing.
       - Uses `pg.Client` against `process.env.DATABASE_URL_UNPOOLED` (same rationale as migration runner — single short-lived connection, safe direct TCP for one-off insert).
       - SQL: `INSERT INTO employees (email, active) VALUES ($1, true) ON CONFLICT (email) DO UPDATE SET active = true`. Idempotent on email — re-running re-activates a deactivated maître.
       - Logs `[seeded] maitre: {email}` — note this DOES log the maître's email by design (it's a seed script, the email is already in env vars and the human typed it). Phase 2's `lib/log.ts` will redact PII in production runtime logs; seed scripts are out of scope for that helper.
       - Tail-call error handler.

    3. Create `scripts/load-test-pg.ts` with the verbatim snippet from `<interfaces>`. Critical invariants:
       - Imports `Pool` from `pg` AND `neon` from `@neondatabase/serverless`. Both target `process.env.DATABASE_URL` (the pooled URL — this test verifies the production runtime configuration, not the migration setup).
       - Creates 10 parallel `pool.query("SELECT 1 AS ok")` and 10 parallel `sql\`SELECT 1 AS ok\`` queries.
       - Awaits both with `Promise.all` and asserts both resolve.
       - Measures `elapsed = Date.now() - start`; throws if `elapsed > 5000`.
       - Closes the pool with `pool.end()` (Neon HTTP client has no close — each query is an HTTP request).

    4. Update `package.json` `scripts` (using Edit tool to merge, preserving PLAN-01 + PLAN-02 entries):
       ```json
       {
         "scripts": {
           "db:migrate": "tsx scripts/db-migrate.ts",
           "seed:maitre": "tsx scripts/seed-maitre.ts",
           "test:pg": "tsx scripts/load-test-pg.ts"
         }
       }
       ```
       Final scripts block must include: `dev`, `build`, `start`, `lint` (from PLAN-01 scaffold), `check:env-sync` (PLAN-01 Task 2), `edge-config:seed`, `edge-config:seed:force`, `smoke:kv` (PLAN-02 Task 2), and these three new ones.
  </action>
  <verify>
    <automated>test -f scripts/db-migrate.ts && test -f scripts/seed-maitre.ts && test -f scripts/load-test-pg.ts && grep -q 'import { Client } from "pg"' scripts/db-migrate.ts && grep -q 'process.env.DATABASE_URL_UNPOOLED' scripts/db-migrate.ts && grep -q 'CREATE TABLE IF NOT EXISTS _migrations' scripts/db-migrate.ts && grep -q 'BEGIN' scripts/db-migrate.ts && grep -q 'ROLLBACK' scripts/db-migrate.ts && grep -q 'COMMIT' scripts/db-migrate.ts && grep -q 'process.exit(1)' scripts/db-migrate.ts && grep -q 'process.env.MAITRE_EMAIL' scripts/seed-maitre.ts && grep -q 'process.env.DATABASE_URL_UNPOOLED' scripts/seed-maitre.ts && grep -q 'ON CONFLICT (email) DO UPDATE' scripts/seed-maitre.ts && grep -q 'import { Pool } from "pg"' scripts/load-test-pg.ts && grep -q 'import { neon } from "@neondatabase/serverless"' scripts/load-test-pg.ts && grep -q 'Array.from({ length: 10 }' scripts/load-test-pg.ts && grep -q '5000' scripts/load-test-pg.ts && grep -q '"db:migrate":' package.json && grep -q '"seed:maitre":' package.json && grep -q '"test:pg":' package.json && grep -q '"check:env-sync":' package.json && grep -q '"edge-config:seed":' package.json && grep -q '"smoke:kv":' package.json</automated>
  </verify>
  <acceptance_criteria>
    - `scripts/db-migrate.ts` uses `pg.Client` (not Pool, not Neon) and `DATABASE_URL_UNPOOLED`
    - `scripts/db-migrate.ts` creates `_migrations` table at startup
    - `scripts/db-migrate.ts` wraps each migration in BEGIN/COMMIT/ROLLBACK
    - `scripts/db-migrate.ts` sorts files lexicographically and skips already-applied
    - `scripts/seed-maitre.ts` reads `MAITRE_EMAIL` env var, throws if missing
    - `scripts/seed-maitre.ts` uses `INSERT ... ON CONFLICT (email) DO UPDATE SET active = true`
    - `scripts/seed-maitre.ts` uses `DATABASE_URL_UNPOOLED`
    - `scripts/load-test-pg.ts` imports both `pg.Pool` and `@neondatabase/serverless`'s `neon`
    - `scripts/load-test-pg.ts` runs 10 + 10 parallel queries via `Promise.all`
    - `scripts/load-test-pg.ts` throws on elapsed > 5000ms
    - `package.json` `scripts` block contains all 9 expected commands: `dev`, `build`, `start`, `lint`, `check:env-sync`, `edge-config:seed`, `edge-config:seed:force`, `smoke:kv`, `db:migrate`, `seed:maitre`, `test:pg`
  </acceptance_criteria>
  <done>
    Migration runner correctly uses `DATABASE_URL_UNPOOLED` and tracks applied migrations transactionally. Seed script idempotent on `MAITRE_EMAIL`. Load test ready to verify two-clients pattern (D-28). All npm scripts wired.
  </done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <name>Task 3: Run migrations + seed maître + load test against live Neon DB + verify deploy</name>
  <files>(no new files — operational verification step)</files>
  <read_first>
    - .planning/phases/01-foundation/01-RESEARCH.md (Focus Area 11 "SC3 — Database schema" verification SQL; "SC7 — Two-clients load test")
    - .planning/phases/01-foundation/01-CONTEXT.md (D-28 soft gate)
    - .env.local (created in PLAN-01 Task 3 — must contain DATABASE_URL, DATABASE_URL_UNPOOLED, MAITRE_EMAIL)
    - scripts/db-migrate.ts, scripts/seed-maitre.ts, scripts/load-test-pg.ts (just created)
  </read_first>
  <action>
    Claude automates everything that has a CLI path. Human is asked only to confirm the production deploy still passes (no human dashboard interaction needed for this task).

    **Claude's automated steps:**

    1. Verify env vars present in `.env.local`:
       ```bash
       set -a; source .env.local; set +a
       test -n "$DATABASE_URL" && test -n "$DATABASE_URL_UNPOOLED" && test -n "$MAITRE_EMAIL" || { echo "Missing required env vars in .env.local — re-run 'vercel env pull .env.local'"; exit 1; }
       ```

    2. Run migrations:
       ```bash
       set -a; source .env.local; set +a
       npm run db:migrate
       ```
       Expected stdout: `[applied] 0001_init.sql`. Re-running should print `[skip] 0001_init.sql`.

    3. Verify schema via direct query (Claude uses a `tsx -e` one-liner via the non-pooled URL since this is DDL/inspection):
       ```bash
       set -a; source .env.local; set +a
       npx tsx -e "
       import('pg').then(async ({ Client }) => {
         const c = new Client({ connectionString: process.env.DATABASE_URL_UNPOOLED });
         await c.connect();
         const { rows } = await c.query(\`
           SELECT table_name FROM information_schema.tables
           WHERE table_schema = 'public'
             AND table_name IN ('reservations','reservation_events','employees','users','accounts','sessions','verification_token','_migrations')
           ORDER BY table_name
         \`);
         console.log('Tables found:', rows.map(r => r.table_name).join(', '));
         if (rows.length !== 8) { console.error('FAIL: expected 8 tables, got', rows.length); process.exit(1); }
         await c.end();
       });
       "
       ```
       Expected stdout: `Tables found: _migrations, accounts, employees, reservation_events, reservations, sessions, users, verification_token`.

    4. Verify `_migrations` tracked the init migration:
       ```bash
       set -a; source .env.local; set +a
       npx tsx -e "
       import('pg').then(async ({ Client }) => {
         const c = new Client({ connectionString: process.env.DATABASE_URL_UNPOOLED });
         await c.connect();
         const { rows } = await c.query('SELECT filename FROM _migrations ORDER BY filename');
         console.log('Migrations applied:', rows.map(r => r.filename).join(', '));
         if (rows.length !== 1 || rows[0].filename !== '0001_init.sql') { console.error('FAIL'); process.exit(1); }
         await c.end();
       });
       "
       ```

    5. Seed maître:
       ```bash
       set -a; source .env.local; set +a
       npm run seed:maitre
       ```
       Expected stdout: `[seeded] maitre: <MAITRE_EMAIL value>`. Re-running prints the same — `ON CONFLICT DO UPDATE SET active = true` makes it idempotent.

    6. Verify maître row exists:
       ```bash
       set -a; source .env.local; set +a
       npx tsx -e "
       import('pg').then(async ({ Client }) => {
         const c = new Client({ connectionString: process.env.DATABASE_URL_UNPOOLED });
         await c.connect();
         const { rows } = await c.query('SELECT email, active FROM employees WHERE email = \$1', [process.env.MAITRE_EMAIL]);
         if (rows.length !== 1 || rows[0].active !== true) { console.error('FAIL: maitre row not found or inactive'); process.exit(1); }
         console.log('Maitre seeded: active=', rows[0].active);
         await c.end();
       });
       "
       ```

    7. Run load test (D-28 soft gate):
       ```bash
       set -a; source .env.local; set +a
       npm run test:pg
       ```
       Expected stdout: `Pool: 10 OK, Neon: 10 OK` followed by `Wall time: <N>ms` where N < 5000.

    8. Trigger production deploy with the schema commit:
       ```bash
       git add db/ lib/db/ scripts/db-migrate.ts scripts/seed-maitre.ts scripts/load-test-pg.ts package.json
       git commit -m "feat(01-foundation): add DB schema, migration runner, maitre seed, load test"
       git push origin main
       ```

    9. Wait for Vercel deploy to complete and verify still 200:
       ```bash
       sleep 30  # crude wait; Vercel CLI 'vercel inspect' could be used for precision
       PROD_URL=$(grep -oE 'https://[a-z0-9-]+\.vercel\.app' README.md | head -1)
       test "$(curl -s -o /dev/null -w '%{http_code}' "$PROD_URL/")" = "200"
       ```

    **Human verification (lightweight — no dashboard interaction):**

    10. Confirm via Neon dashboard (or CLI) that all 8 expected tables visible (the SQL query in step 3 already proved this; this is just visual confirmation). Optional but useful for trust.
  </action>
  <verify>
    <automated>set -a; source .env.local 2>/dev/null; set +a; test -n "$DATABASE_URL_UNPOOLED" && test -n "$MAITRE_EMAIL" && npm run db:migrate 2>&1 | grep -qE '(\[applied\] 0001_init\.sql|\[skip\] 0001_init\.sql)' && npx tsx -e "import('pg').then(async ({Client})=>{const c=new Client({connectionString:process.env.DATABASE_URL_UNPOOLED});await c.connect();const{rows}=await c.query(\"SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('reservations','reservation_events','employees','users','accounts','sessions','verification_token','_migrations')\");if(rows.length!==8){process.exit(1)}await c.end();console.log('OK',rows.length)})" && npm run seed:maitre 2>&1 | grep -q '\[seeded\] maitre:' && npm run test:pg 2>&1 | grep -qE 'Pool: 10 OK, Neon: 10 OK'</automated>
  </verify>
  <acceptance_criteria>
    - `npm run db:migrate` exits 0 with `[applied] 0001_init.sql` (first run) or `[skip]` (subsequent runs)
    - `information_schema.tables` query returns exactly 8 tables: `_migrations`, `accounts`, `employees`, `reservation_events`, `reservations`, `sessions`, `users`, `verification_token`
    - `_migrations` table contains row with `filename = '0001_init.sql'`
    - `npm run seed:maitre` exits 0 with `[seeded] maitre: <email>` line
    - `employees` table contains 1 row matching `MAITRE_EMAIL` with `active = true`
    - `npm run test:pg` exits 0 with `Pool: 10 OK, Neon: 10 OK` and `Wall time: <5000ms` (D-28 soft gate)
    - Production deploy after pushing this plan's changes still serves 200 on `/`
  </acceptance_criteria>
  <what-built>
    - Migrated Neon Postgres schema (8 tables including `_migrations`)
    - Maître's `employees` row seeded
    - Two-clients pattern proven under concurrent load (D-28 satisfied)
    - Schema commit pushed to GitHub and auto-deployed to Vercel
  </what-built>
  <how-to-verify>
    1. Run `npm run db:migrate` — should succeed end-to-end
    2. Run `npm run seed:maitre` — should print `[seeded] maitre: <your-email>`
    3. Run `npm run test:pg` — should print `Pool: 10 OK, Neon: 10 OK` with wall time under 5s
    4. (Optional) Open Neon dashboard, confirm 8 tables visible in your database
    5. Confirm `<project>.vercel.app` still returns 200 after auto-deploy of this plan's schema commit
  </how-to-verify>
  <resume-signal>
    Type `approved` after confirming: (a) migrations applied and `_migrations` tracks `0001_init.sql`, (b) maître row seeded, (c) load test under 5s, (d) production deploy still 200. If any failure (especially load test slow >5s), describe the error.
  </resume-signal>
  <done>
    Database schema live with all 7 application + Auth.js tables (per RESEARCH correction: integer IDs, singular `verification_token`). Migration runner verified working transactionally with `_migrations` tracking. Maître row seeded. Two-clients pattern verified under concurrent load. PLAN-04 unblocked.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Local script → Neon Postgres (non-pooled) | `scripts/db-migrate.ts`, `scripts/seed-maitre.ts` send `DATABASE_URL_UNPOOLED` (with credentials) to `ep-direct.neon.tech` |
| Production runtime → Neon Postgres (pooled) | `lib/db/neon.ts`, `lib/db/pool.ts` use `DATABASE_URL` (pooled via PgBouncer) |
| Migration SQL file → live DB | DDL in `db/migrations/0001_init.sql` is committed to public GitHub repo (no secrets in DDL — schema is public knowledge) |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-03-01 | Information Disclosure (DATA-03) | Migration runner connection string in error logs | mitigate | Runner catches per-migration error, throws `Migration ${filename} failed: ${err}` — surfaces filename, NOT the connection string. Top-level `.catch((err) => { console.error(err); process.exit(1); })` may print stack — pg client error stacks do NOT include the connection string by default (verified pg behavior). |
| T-03-02 | Information Disclosure | `DATABASE_URL_UNPOOLED` accidentally used in app code | mitigate | `lib/db/neon.ts` and `lib/db/pool.ts` both use `DATABASE_URL` (pooled). Grep guard in acceptance criteria: `grep -qv 'DATABASE_URL_UNPOOLED' lib/db/*.ts`. Code review: any future `lib/` file referencing `DATABASE_URL_UNPOOLED` is a bug. |
| T-03-03 | Information Disclosure (DATA-02) | `seed-maitre.ts` logs maître email | accept | Email is already in `MAITRE_EMAIL` env var, the human typed it, and the seed script runs locally on developer machines. SAFE-01 (Phase 2 `lib/log.ts`) covers production runtime PII. Seed scripts are explicitly out of that scope. |
| T-03-04 | Tampering | Migration runner partial failure leaving DB inconsistent | mitigate | Each migration wraps in `BEGIN ... COMMIT` with `ROLLBACK` on error. The `_migrations` INSERT happens within the same transaction as the migration body — atomic: either both succeed or both roll back. Restart-safe. |
| T-03-05 | Elevation of Privilege | Auth.js adapter expects exact integer FK schema; UUID would silently break | mitigate | RESEARCH RISK-3 + RISK-6 corrections embedded in DDL: `users.id SERIAL`, `employees.user_id INTEGER REFERENCES users(id)`, `verification_token` (singular). Acceptance criteria explicitly grep for these patterns. |
| T-03-06 | Denial of Service | Connection pool exhaustion if app accidentally uses non-pooled URL under load | mitigate | `lib/db/neon.ts` and `lib/db/pool.ts` are the only sanctioned app-side DB modules; both use pooled URL. `pg.Pool` capped at `max: 5`. Pitfall #13 documented in research and PATTERNS.md. |
| T-03-07 | Tampering | DDL injection via malicious migration file | accept | Migration files are committed by repo owners only (solo dev project). Public repo means anyone can READ the SQL but only project committers can ADD migrations. Same trust boundary as code commits. |
| T-03-08 | Information Disclosure (CONFIG-01) | Migration accidentally pushed without env vars set in Vercel | mitigate | `lib/env.ts` validates at module load — `next build` fails if `DATABASE_URL` or `DATABASE_URL_UNPOOLED` missing in any of 3 envs. Pre-deploy `npm run check:env-sync` from PLAN-01 catches drift. |
</threat_model>

<verification>
**End-to-end checks for this plan:**
1. `npm run db:migrate` applies `0001_init.sql` and tracks in `_migrations`
2. Direct `information_schema.tables` query returns exactly 8 tables
3. `npm run seed:maitre` upserts MAITRE_EMAIL into `employees` with `active = true`
4. `npm run test:pg` runs 20 parallel queries (10 Pool + 10 Neon) under 5s wall (D-28)
5. Re-running `npm run db:migrate` and `npm run seed:maitre` is idempotent (no errors, expected skip/update behavior)
6. Production deploy after schema commit still serves 200
</verification>

<success_criteria>
1. **PLAT-04 (full):** Neon Postgres has `reservations`, `reservation_events`, `employees`, plus Auth.js auto tables (`users`, `accounts`, `sessions`, `verification_token`). At least one `employees` row matching MAITRE_EMAIL.
2. **Pitfall #13:** Migrations run via `DATABASE_URL_UNPOOLED`; app/auth uses `DATABASE_URL` — both verified by grep guards on file contents.
3. **Research correction RISK-3 applied:** `users.id` is `SERIAL`, `employees.user_id` is `INTEGER REFERENCES users(id)`. Auth.js adapter will work correctly.
4. **Research correction RISK-6 applied:** Table named `verification_token` (singular).
5. **D-28 soft gate:** Two-clients load test completes under 5s.
</success_criteria>

<output>
After completion, create `.planning/phases/01-foundation/01-03-db-migrations-seed-SUMMARY.md` documenting:
- Tables migrated (verified count from `information_schema.tables`)
- Maître email seeded (do NOT log the actual email; just confirm "MAITRE_EMAIL was seeded")
- Load test wall time (e.g., "Pool: 10 OK, Neon: 10 OK, Wall time: 1234ms")
- Any deviations from DDL (none expected)
- Confirmation that subsequent runs of migrate + seed are idempotent
</output>
