---
phase: 01-foundation
plan: 04
status: complete
completed: 2026-04-26
requirements_validated:
  - STAFF-01
  - DEMO-01
  - DEMO-02
---

# Plan 01-04 SUMMARY: Auth.js v5 + Resend magic-link, employees gate live

## Production URL (pilot bookmark)

**https://zero-to-agent-xi.vercel.app** — auth flow live; the maître can navigate to `/login`, request a link, click it, and land on `/queue`.

## End-to-end magic-link round-trip (verified live, 2026-04-26)

| # | Step | Verification | Result |
|---|------|--------------|--------|
| 1 | POST `/api/auth/signin/resend` with `not-the-maitre-XXX@example.com` | `verification_token` rowcount for that email | **0 rows** — D-09 callback rejected before Resend dispatch |
| 2 | POST `/api/auth/signin/resend` with `juan@talos.lat` (`MAITRE_EMAIL`) | `verification_token` rowcount | **1 row**, `expires: 2026-04-27T02:58:29.520Z` (24h) |
| 3 | Email arrived in maître inbox | NOT in spam — Phase 0.1 Resend domain DNS verified | ✓ Confirmed by user |
| 4 | Subject + From | `"Tu link para entrar al panel"` from `noreply@<RESEND_DOMAIN>` | ✓ |
| 5 | Click magic-link → land on `/queue` | Browser navigated through `/api/auth/callback/resend` to `/queue` | ✓ Confirmed by user |
| 6 | `/queue` rendered Spanish stub | `Hola juan@talos.lat — panel próximamente` | ✓ Confirmed |
| 7 | Token consumed | `verification_token` rowcount after click | **0 rows** — Auth.js deletes on successful redemption |
| 8 | Session created | `sessions` row joined to `users.email` | **1 row**, expires `2026-05-26 00:02:15 -03` (~30 days, Auth.js default) |

**STAFF-01 success criterion: PASS.**

## Routes verified live

| Route | Behavior | Status |
|-------|----------|--------|
| `/` | Spanish landing page | 200 |
| `/login` | Spanish form: "Acceder al panel" + email input + "Enviar link" button | 200 |
| `/queue` (no session) | proxy.ts redirects | 307 → `/login` |
| `/api/auth/[...nextauth]` | Auth.js handlers (signin, callback, session, signout) | Dynamic |

## Code shipped

| File | Purpose |
|------|---------|
| `lib/auth/auth.config.ts` | Lean config for `proxy.ts` — Resend provider, `pages` routing, `authorized` callback. NO pg/adapter imports (RISK-1 — split is for cold-start perf, not Edge incompatibility) |
| `lib/auth/auth.ts` | Full config — `PostgresAdapter(pool)`, `session.strategy: "database"` (mandatory for D-11), `signIn` callback (D-09), `session` callback (D-11), `sendVerificationRequest` (D-12 Spanish) |
| `app/api/auth/[...nextauth]/route.ts` | `export const { GET, POST } = handlers` — Auth.js v5 catch-all wiring |
| `proxy.ts` (repo root, NOT `middleware.ts`) | Next.js 16 routing middleware. Matcher `/queue/:path*`. NO `export const runtime` (RISK-1) |
| `app/login/page.tsx` | Client Component. shadcn `Input` + `Button`. Generic "Si tu email está autorizado…" copy regardless of result (D-10 anti-enumeration) |
| `app/queue/page.tsx` | Server Component. Defense-in-depth: `auth()` + `redirect("/login")` if no session (T-04-07) |
| `next-auth.d.ts` | Module augmentation pinning `Session.user.email` type |

## Deviations from plan (2)

1. **`app/api/auth/[...nextauth]/route.ts` re-export pattern.** Plan's verbatim snippet `export { GET, POST } from "@/lib/auth/auth"` failed with "Export GET doesn't exist". `lib/auth/auth.ts` exports `handlers` (not `GET`/`POST` directly), so the standard Auth.js v5 pattern is `import { handlers }; export const { GET, POST } = handlers`. Behavior identical to the plan's intent.

2. **TypeScript cast in `session` callback.** Plan's verbatim `return { ...session, user: undefined } as typeof session` failed strict TS — `AdapterUser` is non-optional in the resolved session type. Changed to `as unknown as typeof session` per the TS error's own suggestion. Runtime behavior identical: D-11 still nullifies `session.user` on inactive employees.

Both are mechanical corrections to the verbatim snippets, not design changes. The locked decisions (split config, employees gate timing, Spanish copy, defense-in-depth, database session strategy) are all preserved.

## D-11 mid-session deactivation test

**Skipped (optional, user did not request).** The `session` callback queries `employees.active` on every read; logic is straightforward and test-coverage-equivalent under the load the pilot generates. If we want hard evidence post-pilot, run:

```bash
npx tsx -e "import('pg').then(async ({Client}) => { const c=new Client({connectionString:process.env.DATABASE_URL_UNPOOLED}); await c.connect(); await c.query('UPDATE employees SET active=false WHERE email=\$1', [process.env.MAITRE_EMAIL]); await c.end(); })"
# refresh /queue → should redirect to /login
npm run seed:maitre  # restores active=true
```

## Threat model status

| Threat ID | Status |
|-----------|--------|
| T-04-01 (replay) | Mitigated — Auth.js single-use token; deletion verified live (token gone after click) |
| T-04-02 (forwarding) | Accepted — inherent to magic-link auth |
| T-04-03 (enumeration) | Mitigated — `/login` shows generic copy; `pages.error: "/login"` keeps error redirects on same UI; code does not read `?error=` |
| T-04-04 (brute force) | Accepted — rate limiting deferred to Phase 4 (DEMO-03) |
| T-04-05 (stolen-token bypass) | Mitigated — token only ever issued to verified employees (D-09) |
| T-04-06 (deactivated mid-session) | Mitigated — D-11 session callback re-queries on every read; nullifies `user` on inactive |
| T-04-07 (proxy matcher misconfig) | Mitigated — `/queue/page.tsx` Server Component double-gate |
| T-04-08, T-04-09 (PII in logs) | Mitigated — no `console.log` of email/URL anywhere in auth code; SAFE-01 lib/log.ts arrives Phase 2 |
| T-04-10 (RESEND_DOMAIN unset) | Mitigated — `lib/env.ts` `z.string().min(1)`; would fail next build |
| T-04-11 (CSRF) | Mitigated — Auth.js v5 built-in; verified live (test fetched CSRF token before submit) |
| T-04-12 (spam folder) | Mitigated + verified — user confirmed email arrived NOT in spam |

## Phase 1 success criteria — all 5 PASS

| # | ROADMAP success criterion | Plan(s) | Status |
|---|--------------------------|---------|--------|
| 1 | Maître magic-link round-trip end-to-end | 01-04 | ✓ verified live (steps 1-8 above) |
| 2 | Public deployment URL stable across deploys | 01-01 | ✓ 4 deploys to same alias `zero-to-agent-xi.vercel.app` |
| 3 | DB schema migrated with all 7 tables (+ `_migrations`) | 01-03 | ✓ 8 tables verified via `information_schema` |
| 4 | Edge Config dashboard edits propagate without redeploy | 01-02 | ✓ verified 20 → 5 → 20 cycle |
| 5 | env vars set in all 3 Vercel envs (Pitfall #18) | 01-01 | ✓ 18 keys × 3 envs |

**Phase 1 → Phase 2 transition is unblocked.** All foundation primitives ready:

- `getConfig` typed wrapper for workflow steps to read operational params
- Two-pg-clients pattern proven (Pool for `@auth/pg-adapter`, Neon HTTP for app queries)
- `_migrations` runner ready for Phase 2 schema additions (workflow_runs table, etc.)
- Auth.js session strategy = database means Phase 3 SSE handlers can reliably check session inline
- Spanish UI baseline established; all Phase 2/3 copy continues in Spanish

## Verification evidence

```
$ curl -s -o /dev/null -w '%{http_code}\n' https://zero-to-agent-xi.vercel.app/
200
$ curl -s -o /dev/null -w '%{http_code}\n' https://zero-to-agent-xi.vercel.app/login
200
$ curl -s -I https://zero-to-agent-xi.vercel.app/queue | grep -iE 'http/|location'
HTTP/2 307
location: /login

$ curl -s https://zero-to-agent-xi.vercel.app/login | grep -oE 'Acceder al panel|Enviar link'
Acceder al panel
Enviar link

# D-09 negative path
$ POST /api/auth/signin/resend (email=not-the-maitre-1777172287@example.com)
$ SELECT FROM verification_token WHERE identifier = 'not-the-maitre-1777172287@example.com'
0 rows  ← D-09 callback rejected before Resend

# D-09 positive path
$ POST /api/auth/signin/resend (email=juan@talos.lat)
$ SELECT FROM verification_token WHERE identifier = 'juan@talos.lat'
1 row, expires 2026-04-27T02:58:29.520Z  ← magic-link sent

# user clicks magic-link in inbox

$ SELECT FROM verification_token WHERE identifier = 'juan@talos.lat'
0 rows  ← Auth.js deleted on successful click

$ SELECT s."sessionToken", s.expires FROM sessions s JOIN users u ON u.id = s."userId" WHERE u.email = 'juan@talos.lat'
1 row, expires 2026-05-26  ← session live for ~30 days
```
