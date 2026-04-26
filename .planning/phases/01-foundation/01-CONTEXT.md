# Phase 1: Foundation - Context

**Gathered:** 2026-04-25
**Status:** Ready for planning
**Discuss outcome:** User selected "ninguna" — all gray areas decided by Claude using research-backed defaults from PROJECT.md, ROADMAP.md, REQUIREMENTS.md, research/SUMMARY.md, and research/PITFALLS.md.

<domain>
## Phase Boundary

Phase 1 ships a deployed empty Next.js 16 app at a public Vercel URL with:

- Postgres schema migrated (`reservations`, `reservation_events`, `employees` + Auth.js auto tables)
- Edge Config seeded with 6 operational params (`no_show_timeout_min`, `followup_after_call_min`, `extension_min`, `max_extensions_per_ticket`, `eta_recompute_interval_sec`, `colors_by_party_size`)
- Upstash Redis (KV) provisioned (no pub/sub usage yet — that's Phase 2)
- Auth.js v5 magic-link via Resend working end-to-end (maître logs in to a protected `/queue` stub)
- Public GitHub repo with `.env.example`, working `npm run dev`, and a stable production Vercel URL

Without this foundation, no application logic can be written. After Phase 1 ships to prod, every subsequent phase pushes to prod via `git push`.

**In scope:** scaffold + Vercel link + DB schema/seed + Auth + Edge Config seed + repo public. Collapses scope_hackathon_mvp.md Fases 1, 2, 3, 4, 7.

**Out of scope (later phases):**
- MCP server, WDK workflow, KV pub/sub, SSE handlers (Phase 2)
- `lib/services/*`, `lib/log.ts` PII redactor, `lib/workflows/*` (Phase 2)
- chatbot, panel UI, DurableAgent (Phase 3)
- rate limiting, idempotency, monitoring, demo video (Phase 4)

**Phase 0 prerequisites (blocking, human work — already documented in ROADMAP.md):**
- Resend domain verified (DNS SPF/DKIM/DMARC; 0–48h propagation). STAFF-01 cannot start until this is green.
- `.env.example` inventory. Vercel marketplace integrations pre-authorized (Postgres/Neon, Upstash KV, Edge Config, AI Gateway).

</domain>

<decisions>
## Implementation Decisions

### Migration Tooling
- **D-01:** Schema managed as plain SQL. `db/schema.sql` holds the initial DDL; forward-only migrations live in `db/migrations/NNNN_<name>.sql` (e.g. `0001_init.sql`, `0002_employees_active_flag.sql`).
- **D-02:** Custom migration runner at `scripts/db-migrate.ts` invoked by `npm run db:migrate`. Tracks applied files in a `_migrations` table (`filename TEXT PRIMARY KEY`, `applied_at TIMESTAMPTZ DEFAULT now()`).
- **D-03:** Migration runner uses the **non-pooled** Neon URL (`DATABASE_URL_UNPOOLED`) per Pitfall #13. App + Auth.js use the pooled `DATABASE_URL`.
- **D-04:** No ORM (no Drizzle / Prisma / Kysely). Rationale: 7-day sprint, fixed schema (3 app tables + Auth.js auto), solo dev. Type-safe queries don't pay back the install/learn overhead at this scale; raw SQL keeps the schema explicit and demo-friendly.

### Edge Config Seeding
- **D-05:** `edge-config/seed.json` checked into the repo with the 6 operational params and demo-safe defaults.
- **D-06:** `scripts/edge-config-seed.ts` (invoked by `npm run edge-config:seed`) PUTs values via the Edge Config Items API. Idempotent — only writes if a key is absent or its value differs from `seed.json`. Use `--force` to overwrite dashboard edits.
- **D-07:** Phase 4 "live edit" demo edits values from the Vercel dashboard. The seed script does NOT overwrite dashboard edits unless `--force` is passed.
- **D-08:** Initial values committed in `seed.json`:
  - `no_show_timeout_min: 20`
  - `followup_after_call_min: 1`
  - `extension_min: 5`
  - `max_extensions_per_ticket: 2`
  - `eta_recompute_interval_sec: 60`
  - `colors_by_party_size: { "1-2": "#A8E6CF", "3-4": "#FFD3B6", "5-6": "#FFAAA5", "7+": "#D5AAFF" }`

  Phase 2 plan-phase agent may refine these once workflow timing is known; the starting values are committed and reproducible.

### Maître Auth Gate
- **D-09:** Auth.js `signIn({ user, account })` callback queries `employees` BEFORE the magic-link is generated/sent. If `user.email` is not in `employees` (or `employees.active = false`), return `false` — Resend never sends the link.
- **D-10:** UI copy on `/login` is generic ("Si tu email está autorizado, te enviamos un link en breve") regardless of whether the email matched. Avoids leaking existence via response timing or message variation.
- **D-11:** Auth.js `session({ session, token })` callback also re-validates that the `employees` row exists and is active on every session read. Defense in depth — handles mid-session employee removal without needing to track sessions externally.
- **D-12:** Magic-link `from` address is `noreply@<verified-resend-domain>` (domain comes from Phase 0 prereq 0.1). Subject (Spanish): "Tu link para entrar al panel". Body Spanish, brand-neutral.

### Deploy + URL
- **D-13:** Vercel project linked to the GitHub repo. `main` branch deploys to **production** automatically. Pull requests get **preview** URLs. No manual `vercel --prod` from local — every prod deploy goes through `git push origin main`.
- **D-14:** Production URL is the free `<project>.vercel.app` alias. The pilot bookmarks this. Custom domain deferred to post-hackathon (pilot can request after week 1 if needed).
- **D-15:** Phase 1 ships an empty-but-deployed app with three routes: `/`, `/login`, `/queue` (auth-gated stub). Phase 2 money-shot demo (`git push` mid-flight, active workflows survive) requires this auto-deploy wiring already proven in Phase 1.
- **D-16:** Env vars set in **all 3** Vercel environments (production, preview, development) per Pitfall #18. Verified via `vercel env ls` before merging Phase 1 → main. CI step (or local pre-deploy script) asserts every key in `lib/env.ts` is present in `.env.example`.

### Maître Seed
- **D-17:** `MAITRE_EMAIL` env var (NOT committed) + `scripts/seed-maitre.ts` invoked by `npm run seed:maitre`. Inserts/upserts the maître's row in `employees` (idempotent on email).
- **D-18:** `.env.example` lists `MAITRE_EMAIL=pilot-maitre@example.com` as a placeholder. The pilot sets their real email in `.env.local` and in Vercel project env. The seed script runs at first migrate and is safe to re-run.

### Env Var Validation
- **D-19:** `@t3-oss/env-nextjs` + Zod schemas at `lib/env.ts`. Separate `server` and `client` schemas. Validates at build AND runtime — missing/malformed env var fails the build or start, not at first request. Closes Pitfall #18.
- **D-20:** `.env.example` is the source of truth for the list of required keys. A small CI / local pre-deploy check greps `lib/env.ts` `server.*.parse` keys and asserts each one has a line in `.env.example`.

### Empty-App Placeholder
- **D-21:** `/` (`app/page.tsx`) renders a minimal Spanish landing: project name + 1-line tagline + link to `/login`. Phase 3 replaces with the chatbot embed.
- **D-22:** `/login` (`app/login/page.tsx`) is a single-input Spanish form (email + submit) using shadcn/ui `Input` + `Button`. POSTs to Auth.js `/api/auth/signin/resend`. Generic success copy regardless of validation result (per D-10).
- **D-23:** `/queue` (`app/queue/page.tsx`) is auth-gated via `proxy.ts` matcher. Phase 1 renders only `Hola {session.user.email} — panel próximamente` to prove the round-trip works end-to-end. Phase 3 replaces with the live queue panel.
- **D-24:** No global layout chrome beyond `<html lang="es">` in `app/layout.tsx` + Tailwind reset + minimal `body` font. v0/shadcn shell is built in Phase 3 when surfaces have content. Avoid premature layout work.

### Repo Layout
- **D-25:** Single Next.js 16 app, App Router. Top-level dirs: `app/`, `lib/`, `db/`, `edge-config/`, `scripts/`, `public/`. No monorepo.
- **D-26:** `lib/` for Phase 1 contains: `lib/db/` (two clients — `lib/db/neon.ts` for `@neondatabase/serverless`, `lib/db/pool.ts` for `pg.Pool` used by `@auth/pg-adapter`), `lib/auth/` (split — `auth.config.ts` Edge-safe + `auth.ts` Node), `lib/edge-config/` (typed `getConfig<K>()` wrapper), `lib/env.ts`. Phase 2 adds `lib/services/`, `lib/workflows/`, `lib/log.ts`.
- **D-27:** `proxy.ts` lives at the **repo root** (Next.js 16 convention, NOT `middleware.ts`). Edge-safe. Imports only `lib/auth/auth.config.ts` (no `pg.Pool`, which is not Edge-compatible).

### Two-PG-Clients Load Test
- **D-28:** Phase 1 plan includes a small load test script at `scripts/load-test-pg.ts`: 10 parallel Auth.js Pool queries (`SELECT 1` via `pg.Pool`) + 10 parallel `@neondatabase/serverless` queries against the same Neon DB. Asserts both clients return without errors and total wall time stays under 5s. Documented as a soft gate before merging Phase 1 → main. Resolves SUMMARY.md open question #7 / Phase 1 spike.

### Folded Todos
None — no pending todos matched Phase 1 scope (`gsd-sdk query todo.match-phase 1` returned 0 matches).

### Claude's Discretion
The following are NOT locked here — plan-phase / executor agents have flexibility:
- Concrete shadcn/ui component versions and Tailwind v4 config details
- Exact form copy / wording (must be Spanish, friendly-empathic per SAFE-03 tone)
- Whether to wire `next-themes` / dark mode in Phase 1 (default: no)
- Migration runner implementation language (default: TypeScript via `tsx`, Node 20)
- Initial Vercel project name + slug (chosen at `vercel link` time by user)
- Whether to add a `/api/health` endpoint in Phase 1 or wait for Phase 4 (if added now, must NOT use real env vars at module-load to avoid blocking deploy on env misconfig)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project artifacts (always read first)
- `.planning/PROJECT.md` — vision, scope, key decisions table, constraints (Spanish-only, real-pilot-same-week, cut list)
- `.planning/REQUIREMENTS.md` — Phase 1 reqs: STAFF-01, PLAT-04, PLAT-06, DEMO-01, DEMO-02; full Out-of-Scope table
- `.planning/ROADMAP.md` §"Phase 1: Foundation" — goal-backward success criteria 1–5; phase-mapped pitfalls #11/#12/#13/#18/#19; stack corrections summary
- `.planning/STATE.md` — accumulated context + locked decisions table
- `CLAUDE.md` (project root) — locked stack, top 5 pitfalls, code style + conventions, GSD workflow defaults
- `scope_hackathon_mvp.md` — original 12-phase spec (Fases 1, 2, 3, 4, 7 collapse into Phase 1; **pseudocode has stack errors — defer to STACK.md when conflict**)

### Stack & architecture (locked)
- `.planning/research/STACK.md` — corrected package names + working snippets for every Phase 1 integration: Neon serverless + `pg.Pool`, `@upstash/redis`, Auth.js v5 + `@auth/pg-adapter` + `next-auth/providers/resend`, Edge Config, `proxy.ts` for Next.js 16
- `.planning/research/ARCHITECTURE.md` — 5 cross-cutting commitments (only #3 cookie-during-stream and #5 in-process hooks affect Phase 1 directly; rest land in Phase 2/3 but should not be violated by Phase 1 scaffolding)
- `.planning/research/SUMMARY.md` §2 (stack corrections), §4 (Phase 0 blockers), §5 (Phase 1 collapse rationale), §9 (gaps to address during planning, including Phase 1 open question #7)

### Pitfalls relevant to Phase 1
- `.planning/research/PITFALLS.md` #11 — Resend domain verification (Phase 0 gate; verified end-to-end here)
- `.planning/research/PITFALLS.md` #12 — Auth.js v5 split config (Edge-safe `auth.config.ts` for `proxy.ts`, full `auth.ts` for route handlers)
- `.planning/research/PITFALLS.md` #13 — pooled vs non-pooled Postgres URL (app/auth = pooled `DATABASE_URL`; migrations = non-pooled `DATABASE_URL_UNPOOLED`)
- `.planning/research/PITFALLS.md` #18 — env vars in all 3 Vercel environments (verified via `vercel env ls`)
- `.planning/research/PITFALLS.md` #19 — push to prod every phase (this phase ships an empty-but-deployed app to prod, establishing the auto-deploy wiring Phase 2 needs)

### External docs (downstream agents may need to fetch)
- Auth.js v5 migration: https://authjs.dev/getting-started/migrating-to-v5
- Auth.js Resend provider: https://authjs.dev/getting-started/authentication/email
- `@auth/pg-adapter`: https://authjs.dev/getting-started/adapters/pg
- Neon serverless driver: https://neon.tech/docs/serverless/serverless-driver
- Upstash Redis SDK: https://upstash.com/docs/redis/sdks/ts/overview
- Vercel Edge Config Items API: https://vercel.com/docs/edge-config/edge-config-management-api
- Next.js 16 release / `proxy.ts`: https://nextjs.org/blog/next-16
- `@t3-oss/env-nextjs`: https://env.t3.gg/docs/nextjs

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
**None — repo is greenfield.** Only `.env`, `.git`, `.planning/`, `CLAUDE.md`, `brief.md`, `scope_hackathon_mvp.md` exist at repo root. (Note: `brief.md` describes a different product — "SiteAgent". Treat as unrelated; binding spec is `.planning/*` + `CLAUDE.md`.)

### Established Patterns
**None yet.** Phase 1 establishes the patterns Phases 2–4 inherit. CLAUDE.md `Code Style + Conventions` is the closest thing to a convention spec; treat it as binding for Phase 1 scaffolding (Spanish UI copy, English code/comments, no comments unless WHY is non-obvious, PII redaction discipline preview).

### Integration Points
- **Vercel Marketplace integrations** auto-provision env vars when linked: Neon Postgres (`DATABASE_URL`, `DATABASE_URL_UNPOOLED`), Upstash KV (`UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`), Edge Config (`EDGE_CONFIG`), AI Gateway (`AI_GATEWAY_API_KEY`). Phase 0 prereq 0.3 says these are pre-authorized.
- **Resend** is the only external SaaS NOT auto-provisioned by Vercel. `RESEND_API_KEY` is set manually in all 3 Vercel envs. Domain verification is Phase 0 prereq 0.1.
- **GitHub repo** (must be public per DEMO-02) is the trigger for Vercel auto-deploy. Wire Vercel ↔ GitHub once at Phase 1 start.

</code_context>

<specifics>
## Specific Ideas

- The pilot bookmarks the free `<project>.vercel.app` URL — same URL across deploys, no surprise re-issuance. Mention this explicitly in the Phase 1 README so the pilot doesn't bookmark a preview URL by mistake.
- Login page Spanish copy must match the project's friendly-but-empathic tone (SAFE-03 says "tono empático y recuperable"; that tone applies to ALL user-facing copy, not just no-show messages).
- `/queue` Phase 1 stub renders the authenticated user's email — proves the auth round-trip works end-to-end and is a tiny but real success criterion for the manual sanity check.
- Magic-link email subject and body should be brand-neutral (no restaurant name) since branding is generic per PROJECT.md key decisions.

</specifics>

<deferred>
## Deferred Ideas

These came up while scoping Phase 1 but belong elsewhere or post-v1:

- **Custom domain for the pilot** — post-hackathon. Pilot can request a custom domain after week 1 of running on the free `.vercel.app` URL.
- **Multi-role employees** (host vs manager vs admin) — v1 has a single "maître" role per `employees`. Multi-role is out of scope for v1.
- **`/login` design polish** (logo, branded card, animation) — Phase 3 when v0/shadcn shell is built. Phase 1 ships functional minimal copy.
- **`next-themes` / dark mode** — out of scope for v1; Phase 3 may add if v0 scaffolding includes it for free.
- **Migration rollback** — forward-only migrations only. If a migration is wrong, write a new forward migration to fix. Pilot is tiny scale (<20 concurrent), no DR plan needed.
- **`/api/health` endpoint** — could ship in Phase 1 but its real purpose (monitoring + Slack/Discord webhook on workflow failure) is Phase 4 success criterion 1. If added in Phase 1, must NOT block deploy on env misconfig at module load.

### Reviewed Todos (not folded)
None — todo matcher returned 0 matches for Phase 1.

</deferred>

---

*Phase: 01-foundation*
*Context gathered: 2026-04-25*
