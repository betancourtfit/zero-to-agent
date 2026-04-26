---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: executing
last_updated: "2026-04-26T11:51:47.655Z"
progress:
  total_phases: 4
  completed_phases: 1
  total_plans: 12
  completed_plans: 11
  percent: 92
---

# State: Zero to Agent — Restaurant Queue MVP

**Last updated:** 2026-04-26 after plan 02-07-staff-api completion

---

## Project Reference

**Core value:** Una reserva entra al chatbot, sobrevive deploys/crashes/timers como workflow durable, y se cierra correctamente (`seated`, `no_show` o `cancelled`) sin perder estado.

**Current focus:** Phase 02 — backend-core

**Hackathon deadline:** ~2026-05-02 (~7 days from 2026-04-25)
**Pilot start:** Same week as hackathon — real diners, real PII, real correctness requirements
**Constraints:** Solo dev + Claude Code. 100% Vercel stack. Spanish only. Tiny scale (<20 concurrent diners).

---

## Current Position

Phase: 02 (backend-core) — EXECUTING
Plan: 8 of 8 (next: 02-08-smoke)
**Milestone:** v1 (hackathon MVP + pilot)
**Phase:** 2
**Plan:** 02-01..02-07 complete; 02-08 next (final Phase 2 plan)
**Status:** Executing Phase 02
**Progress:** [█████████░] 92%

**Next action:** Plan 02-08 (money-shot smoke test) is the final Phase 2 plan. It HARD-blocks on B2 (Skew Protection) — the user must click Vercel Dashboard → Settings → Skew Protection → Enable before the rehearsal. This is the rehearsal of the money-shot demo: create 2 reservations via MCP, sleep 3s, manually `git push` to redeploy, assert in-flight reservations resume via SSE post-deploy. After 02-08 lands, Phase 2 closes and Phase 3 (User Surfaces) becomes the next phase.

After plan 02-07, `npm run build` reports `Created manifest with 14 steps, 1 workflow, and 0 classes` — workflow count preserved (these routes consume the workflow indirectly via `lib/services/queue.ts → resumeHook(...)` but do not import the workflow file directly). All four staff action endpoints are live in the route table: `/api/queue` (GET), `/api/queue/[id]/call` (POST), `/api/queue/[id]/seated` (POST), `/api/queue/[id]/no_show_manual` (POST).

---

## Phase Progress

| Phase | Status | Plans | Requirements | Complete |
|-------|--------|-------|--------------|----------|
| 1 — Foundation | Context captured | 0/TBD | 5 | - |
| 2 — Backend Core | Not started | 0/TBD | 7 | - |
| 3 — User Surfaces | Not started | 0/TBD | 19 | - |
| 4 — Pilot-Hardening + Demo | Not started | 0/TBD | 1 | - |

**Overall:** 32/32 v1 requirements mapped. 0/32 complete.

---

## Performance Metrics

**Plans completed:** 11 (Phase 1: 4 plans + Phase 2: 7 plans — through 02-07-staff-api)
**Plans repaired:** 0
**Phases completed:** 1 (Phase 1 — Foundation)
**Cycles per plan (avg):** 1.0
**Time per phase (avg):** N/A

| Plan | Duration | Tasks | Files |
|------|----------|-------|-------|
| Phase 02-backend-core P01 (spikes-skew) | 7m | 5 (4 atomic + 1 auto-fix) | 7 |
| Phase 02-backend-core P02 (log-redactor) | 3m | 3 (2 atomic + 1 auto-fix) | 2 |
| Phase 02-backend-core P03 (service-layer) | 15m | 4 atomic tasks | 5 files |
| Phase 02-backend-core P04 (workflow) | 7m | 2 atomic tasks | 3 files |
| Phase 02-backend-core P06 (sse) | 5m | 2 atomic tasks | 2 files |
| Phase 02-backend-core P07 (staff-api) | 3m | 4 atomic tasks | 4 files |

---

## Accumulated Context

### Key Decisions (locked from research synthesis)

| Decision | Source | Impact |
|----------|--------|--------|
| 4-phase coarse-grained structure (Foundation → Backend Core → User Surfaces → Pilot-Hardening) | Research SUMMARY §5 + config granularity:coarse | Fewer discuss/plan/build cycles; aligned with dependency graph |
| Workflow shape FROZEN at end of Phase 2 | Pitfall #4 | Adding/removing/reordering steps after Phase 2 breaks in-flight money-shot demo |
| Cookie 24h CUT from v1 (use localStorage post-v1 if needed) | Pitfall #10 + Architecture §3.3 | Cookie-during-streaming violates HTTP. Promoted from "deferred" to "validated cut" |
| Service-layer funnel (`lib/services/*`) is the single mutation path | Architecture §3.1 | MCP tools, staff API, future WhatsApp all funnel through same functions — no drift |
| Snapshot-replay-on-connect for SSE (Postgres = truth, KV = hint) | Architecture §3.2 + Pitfall #6 | Mandatory; Redis pub/sub is at-most-once |
| Hook resume is in-process, not HTTP | Architecture §3.5 | Staff API endpoints call `hook.resume()` via import, never `fetch()` |
| Stack package corrections | STACK.md | `@neondatabase/serverless` not `@vercel/postgres`; `@upstash/redis` not `@vercel/kv`; `mcp-handler@1.1.0` not `@vercel/mcp-adapter`; `workflow` not `@vercel/workflow`; `createHook + Promise.race(hook, sleep)` not `waitForEvent({timeout})`; model id `anthropic/claude-sonnet-4.6` (DOT not dash); env vars `DATABASE_URL` + `UPSTASH_REDIS_REST_URL/TOKEN` |
| Next.js 16 (not 15) — `proxy.ts` not `middleware.ts` | Research §4.4 | Stable since Oct 2025; better cache APIs; codemod handles 90% of changes |
| Auth.js v5 split config: Edge-safe `auth.config.ts` for proxy.ts; full `auth.ts` for route handlers | Pitfall #12 | `pg.Pool` is not Edge-compatible; must split |
| Pulled Edge Config forward from scope Fase 7 to Phase 1 | Research §5 | Phase 2 workflow code needs `getConfig()` to compile cleanly |
| Money-shot smoke test pulled into Phase 2 (not Phase 4) | Architecture §Build Order | Find money-shot broken in Phase 2 = time to fix; in Phase 4 = project killer |
| seed-demo script built in Phase 2 (not Phase 4) | Pitfall #20 | Used as default dev fixture from day one, not just demo |
| DurableAgent ETA capped at 4h; fall back to deterministic formula wrapped in `@workflow/ai/agent` | Cut list #1 | Preserve Track 2 narrative even if agent doesn't deliver visible value |
| Spike A PASS on Node 20.19.4 — `using hook = createHook(...)` cleared in `reservation.ts` | Plan 02-01 Spike A | Manual `try/finally` is fallback only |
| Spike B treated as NON-BUFFERING (pessimistic); D-10 DB-backed safety net is mandatory primary delivery path | Plan 02-01 Spike B | Safer failure mode for hackathon demo + same-week pilot |
| Workflow SDK wired into Next.js build via `withWorkflow()` from `workflow/next` | Plan 02-01 Task 2 | Phase 2 prerequisite for plan 02-04 |
| `lib/log.ts` ships PII redactor + structured logger; `log.info/warn/error` is the only sink for production console output (raw `console.*` outside this file forbidden by convention) | Plan 02-02 Task 1 | Every Phase 2+ module imports `log` from here; SAFE-01 ships |
| Phone regex hardened with hex-aware boundaries + 8-digit minimum to prevent UUID false-positives | Plan 02-02 Rule 1 auto-fix | Logged reservation rows preserve UUID legibility while still masking real phones |
| Test convention: `node:test` via `tsx` (no vitest dep) — `npx tsx --test __tests__/<name>.test.ts` | Plan 02-02 Task 2 | All Phase 2+ unit tests follow this pattern |
| ESLint custom rule for raw `console.*` deferred to Phase 4 polish; flat-config + CI grep step is the Phase 2 fallback | Plan 02-02 deviation #2 | Convention enforced by code review + grep until then |
| Service layer ships in two files: `lib/services/reservations.ts` (diner-facing) + `lib/services/queue.ts` (staff-facing). `ServiceResult<T>` tagged-union return shape is single-sourced from reservations.ts | Plan 02-03 D-18 | MCP tools (02-05) and staff API (02-07) import the same type so the LLM-visible JSON shape stays uniform across all 7 actions |
| `resumeHook` imported directly from `workflow/api` against tokens stored in `reservations.active_hook_token`. No separate `lib/workflows/hooks.ts` shim — `resumeHook(tokenString, payload)` works without a typed hook handle | Plan 02-03 deviation #3 | Avoids extra file in `lib/workflows/` (Pitfall #4 freeze rule); avoids stub `Promise.resolve()` that was the bug we rebuilt to fix |
| `markNoShowManual` added to `lib/services/queue.ts` (4 exports total, plan declared 3) — backs the `POST /api/queue/[id]/no_show_manual` endpoint plan 02-07 needs per D-30 | Plan 02-03 deviation #2 (Rule 2) | Without this, 02-07 would have to inline SQL+KV+resumeHook violating the service-layer-funnel commitment |
| `createReservation` defers `start(reservationWorkflow, ...)` to plan 02-04. The row is inserted with `active_hook_token = 'reservation:<id>:waiting'` so staff API will work as soon as 02-04 lands; a TODO(02-04) block documents the exact code 02-04 must add | Plan 02-03 deviation #1 (Rule 3) | No Phase 2 caller exercises createReservation in 02-03 (MCP create_reservation lands in 02-05 which depends on 02-04) |
| KV publish helpers in `lib/realtime.ts` use `Redis.fromEnv()` module-scoped (no long-lived subscriptions). Channels: `reservation:<uuid>` per-reservation, `queue:active` fan-out. Payload always includes `id` field mapping to `reservation_events.id` for SSE Last-Event-ID resumability | Plan 02-03 D-20 + D-24 + D-25 | Subscription is ONLY in SSE Route Handlers (02-06); service layer + workflow steps publish through these helpers, never `redis.publish` directly |
| Reservation workflow ships at `lib/workflows/reservation.ts` with 5 typed `defineHook<T>()` at module top + 10 `"use step"` helpers in same file (FROZEN per D-11). Three router phases (WAITING / CALLED:pre / CALLED:final), each `Promise.race` against per-event sub-tokens + `sleep(...)` timeout. DB-backed safety net (D-10) replays `reservation_events` on every timeout exit | Plan 02-04 task 1 | Single-file discipline preserved (file count is part of workflow shape — Pitfall #4); per-event sub-tokens preserve `defineHook<T>` payload typing while the row's `active_hook_token` stays at the phase root token so service-layer `resumeHook(tokenString, ...)` keeps working unchanged |
| `createReservation` now invokes `start(reservationWorkflow, [{reservationId}])` with try/catch + D-14 compensating UPDATE (`status='failed_to_start'`). On `start()` failure returns `ServiceResult` with `INTERNAL_ERROR` (Spanish empathic message) instead of re-throwing — preserves the contract every other service function follows | Plan 02-04 deviation #1 (Rule 4) | Phase 02-05 MCP tools wrap `result.ok ? ... : ...`; an exception escape hatch only on this one function would force special-case try/catch in every caller |
| `computeRemainingSeconds(isoDeadline)` extracted as step #10 (last in FROZEN order — append-safe per D-11) so the router never calls `Date.now()` directly | Plan 02-04 deviation #2 (Rule 2) | D-16 router rule forbids `Date.now()` in workflow body; sleep argument needs to be deterministic at replay so the conversion lives inside a step where it gets persisted to the event log |
| Workflow build manifest reports "0 workflows" at end of plan 02-04 — `@workflow/next` eager builder only scans files reachable from `app/`/`pages/` entrypoints; service is not yet imported by any route. Will light up when MCP route lands in plan 02-05 | Plan 02-04 verification | TypeScript check passes regardless; this is a discovery deferral, not a compile failure |
| Upstash `@upstash/redis` v1.x `subscribe()` returns `Subscriber<TMessage>` synchronously (NOT a Promise); `unsubscribe()` is a method on the Subscriber instance; auto-deserialization is on by default so the message handler receives the parsed object (do NOT `JSON.parse(message)` again). Plan pseudocode (and ARCHITECTURE §3.2 example) used incorrect API shape — corrected during implementation | Plan 02-06 deviations #1, #2 (Rule 1) | Cemented in two SSE handlers; future SSE/PubSub work in this repo follows this shape |
| Pattern 3 (snapshot-replay-on-connect) reference implementation lives in `app/api/events/[reservation_id]/route.ts` and `app/api/events/queue/route.ts`. Order: Postgres snapshot → SSE emit (with id == max event id) → optional gap-recover from `reservation_events` (bounded by `[clientCursor, snapshot.last_event_id]`) → KV subscribe → heartbeat → abort cleanup. Position is computed (no DB column); staff snapshot uses `getActiveQueue()` service to share single source of truth with the panel page | Plan 02-06 task 1 + 2 | Pitfall #6 (missed message during reconnect) and Pitfall #7 (subscriber slot leak) both mitigated; future surfaces (chatbot, panel) consume these endpoints unchanged |
| Staff SSE auth uses `session.user.email` to look up `employees` (matching `lib/auth/auth.ts` session callback and `app/queue/page.tsx`) — the Auth.js v5 session in this app surfaces `email`, not `id`. Defense in depth: route re-checks `employees.active` even though the session callback already strips inactive employees | Plan 02-06 deviation #5 (Rule 1) | Plan 02-07 staff API endpoints will follow the same pattern; route is self-auditable |
| Next.js 16 dynamic route params is `Promise<{...}>` and must be awaited inside route handlers | Plan 02-06 deviation #4 (Rule 3) | All future dynamic-segment routes in this repo follow this pattern (already true of `mcp/[transport]/route.ts` indirectly via mcp-handler) |
| All four staff action API endpoints (GET /api/queue + POST /api/queue/[id]/{call,seated,no_show_manual}) ship as 5–15 line wrappers around `lib/services/queue.ts` — strict ARCHITECTURE §3.1 service-layer funnel adherence; zero SQL/business logic in routes (only the auth-gate `employees` lookup). Plan task 4 pseudocode for inline DB+KV+resumeHook in no_show_manual was superseded by service's `markNoShowManual()` (added in plan 02-03 deviation #2 specifically to back this endpoint) | Plan 02-07 task 4 deviation (Rule 4 architectural alignment) | Phase 3 panel calls these endpoints unchanged; future WhatsApp adapter (post-v1) reuses the same service functions |
| Staff route HTTP status mapping: 401 (no session), 403 (signed-in but inactive employee), 404 (RESERVATION_NOT_FOUND), 409 (state-conflict codes RESERVATION_ALREADY_CLOSED/NOT_IN_*), 400 (INVALID_INPUT/INVALID_SESSION), 500 (default). 401 vs 403 distinction lets the Phase 3 panel route /login vs cuenta-desactivada-screen separately. `statusForErrorCode()` switch is duplicated across the 3 POST routes intentionally — short, drift-resistant via grep, no shared helper file | Plan 02-07 implementation refinement | Phase 3 panel UX maps result.error.code → user-visible Spanish copy without parsing message strings |

### Pending Todos

- [ ] Complete Phase 0 prerequisite 0.1: Resend domain verification (BLOCKING for STAFF-01)
- [ ] Complete Phase 0 prerequisite 0.2: write `.env.example` with all required keys
- [ ] Complete Phase 0 prerequisite 0.3: pre-authorize Vercel marketplace integrations (Postgres/Neon, Upstash KV, Edge Config, AI Gateway)
- [x] Phase 1 context captured (`.planning/phases/01-foundation/01-CONTEXT.md`) — 2026-04-25
- [ ] Run `/gsd-plan-phase 1` (next step)

### Active Blockers

| # | Blocker | Owner | Resolution Path |
|---|---------|-------|-----------------|
| B1 | Resend domain DNS propagation (0–48h) | Human (user) | Buy domain if needed (~$10), add SPF+DKIM+DMARC, wait for "verified" status in Resend dashboard |
| B2 | Vercel Skew Protection NOT confirmed enabled | Human (user) | Vercel Dashboard → Project → Settings → Skew Protection → Enable. HARD-blocks ONLY plan 02-08 (money-shot smoke rehearsal). Originally thought to also block 02-04 — corrected during 02-04 execution: Skew Protection is a deploy-time concern that affects in-flight workflow runs across deploys, not local code or type checks. Plans 02-04, 02-05, 02-06, 02-07 are all unblocked. 02-08 still needs B2 toggled before money-shot rehearsal. Agent cannot click dashboard toggles. |

### Key Files

**Project artifacts:**

- `.planning/PROJECT.md` — vision, scope, constraints, key decisions
- `.planning/REQUIREMENTS.md` — 32 v1 requirements with phase traceability
- `.planning/ROADMAP.md` — 4-phase structure with goal-backward success criteria
- `.planning/STATE.md` — this file
- `.planning/config.json` — granularity:coarse, parallelization:true, mode:yolo, commit_docs:true

**Research artifacts (consume during plan-phase):**

- `.planning/research/SUMMARY.md` — synthesis + verdict + phase recommendation
- `.planning/research/STACK.md` — corrected stack with package names + working snippets
- `.planning/research/ARCHITECTURE.md` — component diagram, build order, 5 cross-cutting decisions, anti-patterns
- `.planning/research/PITFALLS.md` — 22 pitfalls phase-mapped
- `.planning/research/FEATURES.md` — competitive analysis + feature surface

**Reference (source of truth for original spec):**

- `scope_hackathon_mvp.md` — original 12-phase runbook (NOTE: pseudocode has stack errors — see STACK.md for corrections)

---

## Session Continuity

**Previous session ended:** 2026-04-26 after plan 02-07-staff-api completion. Four staff action API endpoints shipped, all auth-gated thin wrappers around `lib/services/queue.ts`: `app/api/queue/route.ts` (GET active queue, 57 LOC), `app/api/queue/[id]/call/route.ts` (POST markCalled, 95 LOC), `app/api/queue/[id]/seated/route.ts` (POST markSeated, 87 LOC), `app/api/queue/[id]/no_show_manual/route.ts` (POST markNoShowManual, 95 LOC). All four copy the auth pattern from `app/api/events/queue/route.ts` — `auth()` session check + `employees.active` lookup by email + 401/403 error responses. ServiceResult error codes mapped to HTTP status (404/409/400/500). One Rule 4 architectural deviation: plan task 4 specified inline DB+KV+resumeHook for no_show_manual, but service layer's `markNoShowManual()` (added in plan 02-03 deviation #2) already covers this — wrapped service instead to preserve §3.1 funnel. Build manifest still reports `1 workflow`. PLAT-01 + PLAT-03 complete via this plan.

**Next session should:**

1. Run plan 02-08 (money-shot smoke test) — the final Phase 2 plan. **HARD-blocked on B2** (Skew Protection in Vercel dashboard). Before running 02-08, the user must click Vercel Dashboard → Project → Settings → Skew Protection → Enable. After B2 clears, the plan creates 2 reservations via MCP, sleeps 3s, prompts the user to `git push` (manual gesture), then polls `/api/events/<id>?session_token=...` for 60s asserting both reservations show post-deploy SSE activity.
2. After plan 02-08 lands and `npm run smoke:money-shot` passes against production, Phase 2 closes. Phase 3 (User Surfaces) becomes the next phase — chatbot UI + maître panel — and consumes the 4 staff action endpoints (this plan) + 2 SSE endpoints (plan 02-06) + 4 MCP tools (plan 02-05) + service layer (plan 02-03) UNCHANGED.
3. Phase 3 panel REST contract is now locked: first-paint via `GET /api/queue`, live updates via `/api/events/queue` SSE, action buttons hit `POST /api/queue/<id>/{call,seated,no_show_manual}`. Error UX inspects `result.error.code` (not just HTTP status) — codes are stable across MCP + service + REST.

**If returning after long gap:**

- Re-read PROJECT.md "Core Value" first
- Check ROADMAP.md "Phase Details" for current phase's success criteria
- Check this STATE.md "Active Blockers" before assuming you can proceed

---

*State initialized: 2026-04-25 after roadmap creation*

**Planned Phase:** 1 (Foundation) — 4 plans — 2026-04-26T01:47:31.899Z

**Last completed plan:** 02-01-spikes-skew — 2026-04-26 — commits be77a72, e4170f2, 223a04d, aa6ab70, c39a107

**Last completed plan:** 02-02-log-redactor — 2026-04-26 — commits 81dae58, 87fa419, f8d91f2

**Last completed plan:** 02-03-service-layer — 2026-04-26 — commits 09964e2, 4f30b4f, 7122449, 04d01d0, 69bbeae

**Last completed plan:** 02-04-workflow — 2026-04-26 — commits 720f430, f145d22

**Last completed plan:** 02-06-sse — 2026-04-26 — commits 855c737, 15ad508

**Last completed plan:** 02-07-staff-api — 2026-04-26 — commits ea32967, 415b0cc, 59e4d28, d62dc5d
