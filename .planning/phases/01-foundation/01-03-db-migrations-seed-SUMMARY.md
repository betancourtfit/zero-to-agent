---
phase: 01-foundation
plan: 03
status: complete
completed: 2026-04-26
requirements_validated:
  - PLAT-04
---

# Plan 01-03 SUMMARY: DB schema migration + maître seed + 2-clients load test

## Tables migrated (verified via `information_schema.tables`)

8 tables present in `public` schema:

| Table | Purpose | Notes |
|-------|---------|-------|
| `_migrations` | Auto-created tracker | filename + applied_at |
| `verification_token` | Auth.js v5 magic-link | **Singular** name (RISK-6 — adapter hard-codes) |
| `accounts` | Auth.js v5 OAuth/identity | `"userId"` quoted camelCase |
| `sessions` | Auth.js v5 sessions | `"sessionToken"` UNIQUE |
| `users` | Auth.js v5 user identity | `id SERIAL` (RISK-3 — NOT UUID) |
| `employees` | App: who can authenticate | `user_id INTEGER REFERENCES users(id)` |
| `reservations` | App: queue lifecycle | UUID id space, status CHECK enforces 6 states |
| `reservation_events` | App: event log per reservation | FK to reservations(id) ON DELETE CASCADE |

`_migrations` contents: `0001_init.sql` (only entry).

## Maître seeded

`MAITRE_EMAIL` was upserted into `employees` with `active = true`.
Verification query returned `active = true` for the seeded row.

## Two-clients load test (D-28)

```
Pool: 10 OK, Neon: 10 OK
Wall time: 441ms
```

20 parallel queries (10 via `pg.Pool max=5`, 10 via `@neondatabase/serverless`'s `neon()` HTTP client) completed in **441ms** — well under the 5000ms soft gate. Two-clients pattern proven safe under Phase 1 load.

## Idempotency

| Command | First run | Second run |
|---------|-----------|------------|
| `npm run db:migrate` | `[applied] 0001_init.sql` | `[skip] 0001_init.sql` |
| `npm run seed:maitre` | `[seeded] maitre: <email>` | `[seeded] maitre: <email>` (ON CONFLICT DO UPDATE re-runs without error) |

## Production deploy after schema commit

- Pushed sha `bfa8fd6` (DB clients + scripts) — Vercel auto-deploy fired via webhook
- New deployment READY at `https://zero-to-agent-lmxmufwhq-juan-7600s-projects.vercel.app`
- Stable alias `https://zero-to-agent-xi.vercel.app/` still returns HTTP 200

## Code shipped

| File | Purpose |
|------|---------|
| `db/migrations/0001_init.sql` | 7 CREATE TABLE statements in safe FK order. RISK-3 (integer IDs) + RISK-6 (singular `verification_token`) corrections embedded |
| `db/schema.sql` | Byte-identical mirror for human reading; kept in sync with migrations manually |
| `lib/db/neon.ts` | `@neondatabase/serverless` HTTP client (`sql` tagged template) — app queries |
| `lib/db/pool.ts` | `pg.Pool max=5` — only `@auth/pg-adapter` imports this |
| `scripts/db-migrate.ts` | Forward-only runner via `pg.Client + DATABASE_URL_UNPOOLED`; transactional with `_migrations` tracking |
| `scripts/seed-maitre.ts` | `pg.Client + DATABASE_URL_UNPOOLED`; idempotent upsert on email |
| `scripts/load-test-pg.ts` | 10+10 parallel queries against `DATABASE_URL` (pooled); asserts <5s wall |
| `package.json` | `db:migrate`, `seed:maitre`, `test:pg` scripts |

## Deviations from DDL

None. Schema is byte-identical to `01-PATTERNS.md` snippet which embedded the 2 research corrections (RISK-3, RISK-6).

## Operational notes

- **pg SSL mode warning:** pg v8 prints a deprecation warning on every connection because Vercel/Neon's connection string uses `sslmode=require` and pg will adopt libpq semantics in v9. Current behavior (verify-full alias) is the safer one. No action required for Phase 1; revisit if pg v9 ships before milestone v1.
- **Pooled vs non-pooled discipline (Pitfall #13):** verified by grep guard — neither `lib/db/neon.ts` nor `lib/db/pool.ts` references `DATABASE_URL_UNPOOLED`. Migration + seed scripts use `DATABASE_URL_UNPOOLED` exclusively.

## Threat model status

| Threat ID | Status |
|-----------|--------|
| T-03-01 (connection string in error logs) | Mitigated — runner throws `Migration ${filename} failed: ${err}` (filename only); no connection string |
| T-03-02 (DATABASE_URL_UNPOOLED in app code) | Mitigated — grep guard verified for `lib/db/*.ts` |
| T-03-03 (seed script logs maître email) | Accepted — local script, not production runtime; SAFE-01 covers prod logging in Phase 2 |
| T-03-04 (partial migration leaves DB inconsistent) | Mitigated — BEGIN/COMMIT/ROLLBACK wraps migration body + `_migrations` insert atomically |
| T-03-05 (Auth.js adapter expects integer FK) | Mitigated + verified — schema uses SERIAL/INTEGER per RISK-3; `verification_token` singular per RISK-6 |
| T-03-06 (pool exhaustion if non-pooled used in app) | Mitigated — both lib/db modules use pooled URL; `pg.Pool max=5` |
| T-03-07 (DDL injection via malicious migration) | Accepted — same trust boundary as code commits |
| T-03-08 (migration deployed without env vars) | Mitigated — `lib/env.ts` validates at next build; `check:env-sync` is the pre-deploy gate |

## Unresolved items

None. Plan 01-04 (Auth.js magic-link) is unblocked.

- 01-04 will use the `users`, `accounts`, `sessions`, `verification_token` tables via `@auth/pg-adapter` reading `lib/db/pool.ts`.
- 01-04's `signIn` callback will gate on the `employees` table (D-09/D-10/D-11): only seeded `MAITRE_EMAIL` with `active = true` can authenticate. Both pre-conditions are now satisfied (table exists, maître row seeded).

## Verification evidence

```
$ npm run db:migrate
[applied] 0001_init.sql

$ npm run db:migrate          # second run
[skip] 0001_init.sql

$ npm run seed:maitre
[seeded] maitre: juan@talos.lat

$ npm run seed:maitre         # second run (idempotent)
[seeded] maitre: juan@talos.lat

$ npm run test:pg
Pool: 10 OK, Neon: 10 OK
Wall time: 441ms

$ curl -s -o /dev/null -w '%{http_code}\n' https://zero-to-agent-xi.vercel.app/
200
```
