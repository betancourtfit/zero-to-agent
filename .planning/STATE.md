---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: executing
last_updated: "2026-04-26T21:25:37.940Z"
progress:
  total_phases: 4
  completed_phases: 2
  total_plans: 18
  completed_plans: 14
  percent: 78
---

# State: Zero to Agent — Restaurant Queue MVP

**Last updated:** 2026-04-26 after plan 02-08-smoke completion (Phase 2 closed)

---

## Project Reference

**Core value:** Una reserva entra al chatbot, sobrevive deploys/crashes/timers como workflow durable, y se cierra correctamente (`seated`, `no_show` o `cancelled`) sin perder estado.

**Current focus:** Phase --phase — 03

**Hackathon deadline:** ~2026-05-02 (~7 days from 2026-04-25)
**Pilot start:** Same week as hackathon — real diners, real PII, real correctness requirements
**Constraints:** Solo dev + Claude Code. 100% Vercel stack. Spanish only. Tiny scale (<20 concurrent diners).

---

## Current Position

Phase: --phase (03) — EXECUTING
Plan: 1 of --name
**Milestone:** v1 (hackathon MVP + pilot)
**Phase:** 3
**Plan:** Not started (6 plans in 4 waves ready)
**Status:** Executing Phase --phase
**Progress:** [████████░░] 78%

**Next action:** Plan Phase 3 (User Surfaces). Prerequisites: Phase 0 prereqs (Resend domain — B1) must clear before STAFF-01 chatbot UI work; Skew Protection (B2) must clear before the live money-shot rehearsal. Neither blocks Phase 3 PLANNING — both block Phase 3 EXECUTION at specific tasks. The agent can run `/gsd-plan-phase 3` immediately. Phase 3 will consume Phase 2 artifacts UNCHANGED (no new contracts, no breaking changes): 4 MCP tools (02-05), 2 SSE endpoints (02-06), 4 staff endpoints (02-07), service layer (02-03), workflow (02-04 — FROZEN, only step bodies change), seed-demo + smoke tests (02-08).

After plan 02-08, `npm run build` route table includes all 14 routes (3 workflow internal `/.well-known/workflow/v1/*`, 4 staff action `/api/queue*`, 2 SSE `/api/events/*`, 1 MCP `/mcp/[transport]`, 1 auth `/api/auth/[...nextauth]`, 3 pages `/`, `/login`, `/queue`). Three new scripts ship: `scripts/seed-demo.ts` (3-state idempotent dev fixture), `scripts/smoke-test-mcp.sh` (5-step end-to-end MCP smoke), `scripts/smoke-money-shot.sh` (deploy-mid-flight rehearsal harness with --dry-run). Plus `npm run dev:reset` (db:migrate + seed:demo composite). DEMO-04 ships with this plan.

---

## Phase Progress

| Phase | Status | Plans | Requirements | Complete |
|-------|--------|-------|--------------|----------|
| 1 — Foundation | Complete | 4/4 | 5 | 5/5 |
| 2 — Backend Core | Complete | 8/8 | 7 | 7/7 |
| 3 — User Surfaces | Planned | 0/6 | 19 | 0/19 |
| 4 — Pilot-Hardening + Demo | Not started | 0/TBD | 1 | 0/1 |

**Overall:** 32/32 v1 requirements mapped. 12/32 complete (Phase 1: 5; Phase 2: 7).

---

## Performance Metrics

**Plans completed:** 12 (Phase 1: 4 plans + Phase 2: 8 plans — through 02-08-smoke)
**Plans repaired:** 0
**Phases completed:** 2 (Phase 1 — Foundation; Phase 2 — Backend Core)
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
| Phase 02-backend-core P08 (smoke) | 5m | 4 atomic tasks | 4 files (3 created + 1 modified) |

---
| Phase 03-user-surfaces P02 | 5m | 3 tasks | 10 files |
| Phase 03-user-surfaces P01 | 30m | 2 tasks | 5 files |

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
| `seed-demo.ts` uses the REAL service layer (`createReservation` + `markCalled` + `markSeated`) — workflows are LIVE on every dev reset (D-32). NOT a Phase 4-only artifact (Pitfall #20): this IS the daily dev fixture. Idempotency boundary: `email LIKE 'demo%@example.test'` filter on DELETE — real diner data is untouched | Plan 02-08 task 1 | Every developer reset uses this from Phase 2 forward; the chatbot/panel work in Phase 3 starts every dev session against 3 known-good reservations across waiting/called/seated |
| `smoke-test-mcp.sh` MCP endpoint URL is `POST /mcp/mcp` (not `POST /mcp`). With `mcp-handler` `basePath: "/mcp"` and the route file at `app/mcp/[transport]/route.ts`, the streamable-HTTP endpoint requires the `[transport]` segment. Verified against `node_modules/mcp-handler/README.md` quick-start. Both shell smoke scripts also send `Accept: application/json, text/event-stream` per MCP spec — without it, mcp-handler returns 406 | Plan 02-08 task 2 deviation #2/#3 (Rule 3) | Future curl-based smoke scripts and any external MCP client integration documentation must use the `/mcp/mcp` URL shape |
| `smoke-money-shot.sh` ships with `--dry-run` flag (orchestrator scope clarification). Skew Protection (B2) is NOT a blocker for AUTHORING the script — only for the actual rehearsal. Dry-run skips the deploy gate so script logic + env wiring + SSE polling can be smoke-tested standalone; full rehearsal requires (a) Skew Protection enabled in Vercel dashboard, (b) BASE_URL pointing at a real prod URL, (c) MCP_API_KEY matching the prod env var. All three documented in script header AND runtime banner | Plan 02-08 task 3 deviation #4 (Rule 2) | The script can be re-validated cheaply between deploys via `--dry-run`; the real rehearsal cost is paid only when actually deploying |
| Phase 2 closure: 8 plans complete, 7 requirements shipped (PLAT-01, PLAT-02, PLAT-03, PLAT-05, PLAT-07, SAFE-01, DEMO-04). Workflow shape is now FROZEN per D-11 / Pitfall #4 — only step bodies may change in Phase 3+. Phase 3 (User Surfaces) consumes Phase 2 artifacts UNCHANGED: 4 MCP tools, 2 SSE endpoints, 4 staff endpoints, service layer, workflow router, seed-demo + smoke harness | Plan 02-08 closeout | Phase 3 plans must NOT touch `lib/workflows/reservation.ts` step count/order; can ONLY change step bodies (e.g., swap deterministic ETA for `@workflow/ai/agent`-wrapped DurableAgent) |

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
| ~~B2~~ | ~~Vercel Skew Protection~~ | **CLOSED 2026-04-26 — Pro-only, accepted on Hobby** | Project on Hobby plan; Skew Protection requires Pro ($20/mo). Decision: skip — workflow durability comes from Vercel Workflow runtime + frozen workflow shape (Pitfall #4), not Skew Protection. SSE handlers self-heal via snapshot-replay-on-connect. `scripts/smoke-money-shot.sh` updated to verify durability via post-deploy `get_reservation_status` MCP call (commit pending). Documented in CLAUDE.md and `lib/workflows/_README.md`. Optional Pro upgrade for pilot week if SSE 800s ceiling and the closed race window are worth $20 — user's call. |

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

**Previous session ended:** 2026-04-26 after plan 02-08-smoke completion (Phase 2 CLOSED). Three new scripts and one composite npm script shipped: `scripts/seed-demo.ts` (160 LOC) creates Demo Comensal 1/2/3 in waiting/called/seated states via the real service layer (workflows LIVE every dev reset, D-32; idempotent on `email LIKE 'demo%@example.test'`); `scripts/smoke-test-mcp.sh` (209 LOC) runs a 5-step end-to-end MCP test (create OK → action tools INVALID_SESSION without header → get_status OK with header → cancel closes the smoke fixture) using bearer auth + `Accept: application/json, text/event-stream` against `POST /mcp/mcp`; `scripts/smoke-money-shot.sh` (264 LOC) implements D-31 deploy-mid-flight rehearsal with `--dry-run` flag and `SKIP_DEPLOY_PROMPT=1` for CI; `npm run dev:reset` composes `db:migrate` + `seed:demo` for daily local resets. DEMO-04 complete via this plan. Phase 2 ends with 8/8 plans done, 7/7 phase requirements shipped, workflow shape FROZEN per D-11. Live money-shot rehearsal still pending — Skew Protection (B2) toggle + stable prod URL needed; the harness is ready.

**Next session should:**

1. **Plan Phase 3 (User Surfaces).** Run `/gsd-plan-phase 3`. Phase 3 plans the chatbot embed (DINER-01..08), the maître panel (STAFF-02..09), and DurableAgent ETA (PLAT-08), plus SAFE-02 (rate limit on diner side) and SAFE-03 (Spanish empathic copy). 19 requirements total. Phase 3 has a UI hint (use `v0` + shadcn/ui per stack lock) and a required spike (AI SDK v6 `useChat` + `DefaultChatTransport` + `sendMessage({text})` lifecycle, 10 sample conversations).
2. **Phase 3 consumes Phase 2 artifacts UNCHANGED.** Hard contract: 4 MCP tools (chatbot calls via experimental_createMCPClient or — better per D-36 — calls services DIRECTLY in the `/api/chat` route), 2 SSE endpoints (panel queue list + diner per-reservation), 4 staff REST endpoints (panel action buttons), `lib/workflows/reservation.ts` (FROZEN — only step bodies may change; e.g., wrap `recompute_eta` step body in `@workflow/ai/agent` for DurableAgent without touching the step boundary), `seed-demo.ts` as the daily fixture.
3. **B2 (Skew Protection) must be toggled before the live money-shot rehearsal.** This does NOT block Phase 3 planning OR execution. It DOES block Phase 4 demo prep — the demo video's "money shot" scenario needs to be rehearsable end-to-end on a real prod URL.
4. **Run the smoke harness manually before Phase 3 starts** to confirm the local dev environment is healthy: `npm run dev` in one terminal, then `npm run dev:reset && npm run smoke:mcp && npm run smoke:money-shot -- --dry-run` in another. Expected: all green. Documented in `.planning/phases/02-backend-core/02-08-smoke-SUMMARY.md` under "Manual Rehearsal Procedure".

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

**Last completed plan:** 02-08-smoke — 2026-04-26 — commits 1fcf33d, a07f084, d369897, c5555df

**Phase 2 closeout:** 2026-04-26 — 8/8 plans done; 7/7 phase requirements shipped (PLAT-01, PLAT-02, PLAT-03, PLAT-05, PLAT-07, SAFE-01, DEMO-04). Workflow FROZEN per D-11 / Pitfall #4. Phase 3 unblocked.

**Planned Phase:** 3 (User Surfaces) — 6 plans — 2026-04-26 — commits 01134ce (research + CONTEXT D-20 Path C revision), 0f37767 (PATTERNS), a7a9051 (6 PLAN.md files). Plan-checker passed first iteration: 19/19 reqs covered, 15/15 verification points pass. PLAT-08 path resolved via researcher Critical Finding §0 — D-20 revised to Path C (`generateText` from `ai` SDK inside `recompute_eta` step body, NOT `@workflow/ai/agent` which is forbidden inside `"use step"`). Plans 03-01 (D-30 spike, 2h cap) and 03-06 (PLAT-08 path) are `autonomous: false` for user gating at execute time. Wave 2 (03-03 chatbot + 03-04 panel) runs in parallel — disjoint files. STAFF-09 (Reabrir) ships in Phase 3 per CONTEXT D-16 override of cut list #3.

**Last completed plan:** 03-02-hooks-shadcn — 2026-04-26 — commits 0c187c0 (feat: 6 shadcn primitives), 6c1611b (test: RED use-reservation-events), e09e976 (feat: GREEN use-reservation-events), b4fde8b (test: RED use-queue-events), 6e6d83d (feat: GREEN use-queue-events). Requirements shipped: DINER-03, DINER-04, STAFF-07. 22 tests pass. Plans 03-03 (chatbot) and 03-04 (panel) can now run in parallel.
