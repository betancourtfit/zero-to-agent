# Roadmap: Zero to Agent — Restaurant Queue MVP

**Created:** 2026-04-25
**Granularity:** coarse (4 phases, derived from research dependency graph)
**Coverage:** 32/32 v1 requirements mapped (100%)
**Mode:** yolo (auto-advance disabled, parallelization enabled)
**Hackathon deadline:** ~2026-05-02 (~7 days)
**Pilot start:** same week — real diners

---

## Core Value (Goal Backward Anchor)

**Una reserva entra al chatbot, sobrevive deploys/crashes/timers como workflow durable, y se cierra correctamente (`seated`, `no_show` o `cancelled`) sin perder estado.**

Every phase exists to make this true and demonstrable. The "money shot" (deploy mid-flight, tickets survive) is enabled by Phase 2 and demonstrated in Phase 4.

---

## Phase 0 — Prerequisites (Human, Not Numbered)

These are NOT a phase the agent runs. They are **blocking human work** that must complete BEFORE Phase 1 starts. Documented here for visibility.

| # | Item | Why blocking | Status |
|---|------|--------------|--------|
| 0.1 | **Resend domain verification** (DNS SPF/DKIM/DMARC) | 0–48h propagation. Without verified domain, magic-link emails go to spam → maître locked out → STAFF-01 fails → pilot dead. | Pending |
| 0.2 | **`.env.example` inventory** | Every required env key documented before Phase 1 commits start. Prevents prod-only "missing env var" discovery on day 6. | Pending |
| 0.3 | **Vercel pre-provisioning** (Postgres/Neon, Upstash KV, Edge Config, AI Gateway) | Marketplace integrations sometimes need browser consent. Pre-authorize today. | Pending |
| 0.4 | **Next.js 16 decision confirmed** | Affects every phase (proxy.ts vs middleware.ts, package pins). Recommendation: Next.js 16 (locked). | Done (per research) |
| 0.5 | **Cookie 24h cut confirmed** | Promoted from "deferred" to "validated cut". Use localStorage post-v1 if needed. | Done (per research §3.3 + REQUIREMENTS Out of Scope) |

**Rule:** Phase 1's auth subtask (STAFF-01) cannot start until Resend shows "verified" in dashboard. The rest of Phase 1 can proceed in parallel.

---

## Phases

- [ ] **Phase 1: Foundation** — Empty Next.js 16 deployed to Vercel with DB, Auth.js magic-link, Edge Config, KV provisioned, env vars set in all environments
- [ ] **Phase 2: Backend Core** — MCP server + service layer + WDK durable workflow + KV pub/sub + SSE handlers; money-shot smoke test passes (CRITICAL PATH) — 4/8 plans done (02-01 spikes-skew, 02-02 log-redactor, 02-03 service-layer, 02-04 workflow)
- [ ] **Phase 3: User Surfaces** — Chatbot embed (diner self-serve) + maître panel (queue + history + actions) + DurableAgent ETA, both surfaces real-time via SSE
- [ ] **Phase 4: Pilot-Hardening + Demo** — Rate limiting, idempotency, monitoring, PII audit, smoke test script, demo video recording, README polish, final prod deploy

---

## Phase Details

### Phase 1: Foundation
**Goal:** A deployed empty Next.js 16 app at a public Vercel URL, with Postgres schema migrated, Edge Config seeded, KV provisioned, and the maître able to log in via Resend magic-link end-to-end. Without this foundation, no application logic can be written.
**Depends on:** Phase 0 prerequisites (Resend domain verified, env inventory done, Vercel marketplace integrations pre-authorized)
**Requirements:** STAFF-01, PLAT-04, PLAT-06, DEMO-01, DEMO-02
**Collapses scope Fases:** 1 (scaffold), 2 (Vercel link + storage), 3 (DB schema), 4 (Auth.js), 7 (Edge Config — pulled forward so Phase 2 workflow code can compile against `getConfig()`)

**Success Criteria** (what must be TRUE):
  1. Maître navigates to `/login`, enters their email, receives a Resend magic-link in their inbox (not spam), clicks it, lands on a protected `/queue` route authenticated as themselves (validated against the `employees` table)
  2. The public Vercel deployment URL responds 200 on `/` and the URL is stable (same URL across deploys — pilot can bookmark it)
  3. The Neon Postgres database has all tables migrated (`reservations`, `reservation_events`, `employees`, plus Auth.js's `users`, `accounts`, `sessions`, `verification_tokens`) and contains at least one seed `employees` row for the maître
  4. Vercel Edge Config returns the operational parameters (`no_show_timeout_min`, `followup_after_call_min`, `extension_min`, `max_extensions_per_ticket`, `eta_recompute_interval_sec`, `colors_by_party_size`) when called via `@vercel/edge-config`'s `get()`, and changing a value in the Vercel dashboard takes effect on the next read without a redeploy
  5. The GitHub repo is public, contains a working `.env.example` listing every required key, and `git clone` + `vercel env pull` + `npm install` + `npm run dev` succeeds from a fresh machine

**Plans:** 4 plans

Plans:
- [x] 01-01-scaffold-vercel-env-PLAN.md — Scaffold Next.js 16 + lib/env.ts validation + .env.example + public GitHub repo + Vercel link + first prod deploy (Wave 1, requirements: DEMO-01, DEMO-02)
- [x] 01-02-edge-config-kv-PLAN.md — Seed Edge Config (6 operational params) + Upstash Redis smoke test + typed getConfig wrapper (Wave 1, requirements: PLAT-06)
- [x] 01-03-db-migrations-seed-PLAN.md — Postgres schema (7 tables) + migration runner + maître seed + two-clients load test (Wave 2, depends on 01, requirements: PLAT-04)
- [x] 01-04-auth-magic-link-PLAN.md — Auth.js v5 split config + Resend magic-link + employees gate (D-09/D-10/D-11/D-12) + /login + /queue stub + E2E verification (Wave 3, depends on 01 + 03, requirements: STAFF-01, DEMO-01, DEMO-02)

**Pitfalls addressed in this phase:**
- #11 Resend domain verification (gated by Phase 0; verified end-to-end here)
- #12 Auth.js v5 split config (Edge-safe `auth.config.ts` for `proxy.ts`, full `auth.ts` for route handlers)
- #13 Pooled vs non-pooled Postgres URL (app/auth = pooled `DATABASE_URL`; migrations = non-pooled)
- #18 Env vars in all 3 Vercel environments (verified via `vercel env ls`)
- #19 Push to prod every phase (this phase ships an empty-but-deployed app to prod)

**Stack corrections applied:**
- `@neondatabase/serverless` for app + `pg.Pool` for `@auth/pg-adapter` (two clients, same DB)
- `@upstash/redis` not `@vercel/kv`
- `next-auth@beta` (Auth.js v5) with `next-auth/providers/resend`
- `proxy.ts` not `middleware.ts` (Next.js 16)
- Env vars: `DATABASE_URL` not `POSTGRES_URL`; `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` not `KV_URL`

---

### Phase 2: Backend Core
**Goal:** Any client (chatbot, future WhatsApp, curl) can create a reservation, extend, cancel, or query its status via the MCP server. The reservation's lifecycle is orchestrated by a durable WDK workflow that survives a deploy mid-flight (the money shot). Workflow shape is FROZEN at the end of this phase — only step bodies may change after.
**Depends on:** Phase 1 (DB, Edge Config, env vars)
**Requirements:** PLAT-01, PLAT-02, PLAT-03, PLAT-05, PLAT-07, SAFE-01, DEMO-04
**Collapses scope Fases:** 5 (MCP server) + 6 (WDK workflows) — CRITICAL PATH

**Success Criteria** (what must be TRUE):
  1. A `curl` against the public MCP endpoint with a valid `Bearer MCP_API_KEY` successfully creates a reservation (`create_reservation`), and the response returns `reservation_id`, `position`, `eta_min`, and `session_token` — all four MCP tools (`create_reservation`, `get_reservation_status`, `extend_wait`, `cancel_reservation`) work and reject calls without the bearer key OR without a matching `X-Reservation-Session` header
  2. After `create_reservation`, the WDK workflow visibly progresses through states (`waiting → called → seated|no_show|cancelled`) — verifiable via the Vercel Workflow dashboard AND via the `reservation_events` audit log AND via Postgres `reservations.status`
  3. **Money-shot smoke test passes:** create 2 reservations, deploy mid-flight (`vercel --prod` or a meaningful code change), verify both still progress through their lifecycles without state loss (timers don't desync, hooks resume correctly)
  4. The `seed-demo.ts` script populates 3 reservations in distinct states (`waiting`, `called`, `seated`) and is used as the default dev fixture from this phase forward (NOT just at demo time)
  5. Workflow steps publish state-change events to Upstash Redis pub/sub channels (`reservation:<id>` and `queue:active`) and SSE Route Handlers (`/api/events/[reservation_id]`, `/api/events/queue`) emit a Postgres-snapshot event on connect followed by live KV events — verifiable by opening two `curl -N` SSE connections and triggering a state change

**Plans:** 8 (1 complete)

Plans:
- [x] 02-01-spikes-skew-PLAN.md — Skew Protection prereq + spike A (`using` keyword) + spike B (createHook buffering decision) + `withWorkflow` wired into next.config.ts + tsconfig workflow plugin + `lib/workflows/_README.md` freeze-shape rulebook (Wave 1, requirements: PLAT-03)
- [x] 02-02-log-redactor-PLAN.md — `lib/log.ts` PII redactor + structured logger + `__tests__/log-redact.test.ts` (7 cases via `node:test`); ships SAFE-01 (Wave 1, requirements: SAFE-01)
- [x] 02-03-service-layer-PLAN.md — `lib/services/reservations.ts` (4 funcs) + `lib/services/queue.ts` (4 funcs) + `lib/realtime.ts` + 0002 migration; ships service-layer-funnel commitment (Wave 1, requirements: PLAT-01)
- [x] 02-04-workflow-PLAN.md — `lib/workflows/reservation.ts` durable lifecycle workflow (5 typed hooks + 10 steps + 3-phase router) + `createReservation` start() wired with D-14 compensating action + `_README.md` Implementation Notes; ships PLAT-03 (Wave 1, requirements: PLAT-03)
- [ ] 02-05-mcp-PLAN.md
- [ ] 02-06-sse-PLAN.md
- [ ] 02-07-staff-api-PLAN.md
- [ ] 02-08-smoke-PLAN.md

**Pitfalls addressed in this phase:**
- #1 Side effects outside `"use step"` (workflow function is a router, not a worker — establish in `lib/workflows/_README.md`)
- #2 Event race + DB-backed safety net (persist trigger in `reservation_events` BEFORE publishing hook resume)
- #3 Serializable step inputs/outputs only (plain JSON; convert `Date` to ISO string at boundaries)
- #4 Freeze workflow shape after this phase (documented; only step bodies may change after)
- #5 MCP tool poisoning — server resolves `reservation_id` from `session_token`; LLM never passes IDs for actions
- #7 KV pub/sub patterns + abort cleanup (`req.signal.addEventListener('abort', ...)` to free Upstash slots)
- #9 Zod `.passthrough()` not `.strict()` for LLM-facing tool inputs; coerce numeric fields
- #15 PII logging helper (`lib/log.ts` with `redactPII()`) used from day one in workflow steps and tool handlers
- #16 Tool error contract designed (no fake-success — error response shape is `{ error: CODE, message: string }`; UI confirmation rule for Phase 3)

**Required spikes (from research §5 flags):**
- 30-min spike at top of Phase 2: verify `using` keyword (TS 5.2+ explicit resource management) compiles + executes on Vercel's Node 20 runtime with the WDK compiler. Fallback: manual `try/finally` with `hook.dispose()` — **DONE in plan 02-01: PASS on Node 20.19.4**
- Verify whether `createHook()` buffers events fired before subscribe. If NO → DB-backed safety net is mandatory; if YES → belt-and-suspenders — **DONE in plan 02-01: ASSUMED NON-BUFFERING (pessimistic); D-10 is mandatory primary delivery path**

---

### Phase 3: User Surfaces
**Goal:** A diner can self-serve their entire reservation lifecycle by chatting with an embedded chatbot in Spanish, and the maître can manage the live queue from a panel that updates in real time. Both surfaces consume the SSE infrastructure built in Phase 2 with snapshot-replay-on-connect.
**Depends on:** Phase 2 (MCP, workflow, SSE handlers, services)
**Requirements:** DINER-01, DINER-02, DINER-03, DINER-04, DINER-05, DINER-06, DINER-07, DINER-08, STAFF-02, STAFF-03, STAFF-04, STAFF-05, STAFF-06, STAFF-07, STAFF-08, STAFF-09, PLAT-08, SAFE-02, SAFE-03
**Collapses scope Fases:** 8 (chatbot frontend) + 9 (maître panel) + 10 (DurableAgent ETA)

**Success Criteria** (what must be TRUE):
  1. **Diner happy path:** a person opens `/`, has a natural Spanish conversation with the chatbot, provides name/email/phone/party_size, and receives a confirmation showing `reservation_id`, position, and ETA — the confirmation is rendered from the actual MCP tool response, never from LLM-fabricated text (UI badge from server response)
  2. **Diner real-time push:** when the maître clicks "Llamar" in the panel, the diner's open chatbot pestaña shows "TU MESA ESTÁ LISTA" within 2 seconds, and 1 minute later (per `followup_after_call_min`) shows the follow-up "¿Estás en camino? [Pedir más tiempo] [Cancelar]" if no diner response — both pushed via SSE
  3. **Diner self-serve actions in natural Spanish:** the chatbot correctly maps "dame 5 más" / "voy llegando" → `extend_wait`, "no voy a ir" / "cancelar" → `cancel_reservation`, "¿cómo voy?" → `get_reservation_status`, AND handles ambiguous inputs ("somos 4 o 5", "tal vez un bebé") by asking for clarification rather than guessing — verified by running 10 sample conversations
  4. **Maître panel:** at `/queue`, the maître sees the day's active reservations ordered chronologically (oldest first) as cards showing name/party_size/arrival/wait-time/status/ETA/extension-badge, color-coded by party_size from Edge Config; the panel updates in real time via SSE (`queue:active`) when reservations are created or change state; "Llamar" + "Marcar presentado" actions work; `/queue/history` shows the day's closed reservations and the maître can undo an erroneous `no_show`
  5. **No-show automation closes the loop empathically:** if the diner never responds and the `no_show_deadline` (with extensions) elapses, the workflow marks `no_show` automatically, the ticket moves to history, and the diner sees an empathic recoverable message in chat ("Marcamos tu reserva como no-show porque no llegamos a verte. Si querés volver a anotarte, abrí esta página de nuevo.") — NOT punitive

**Plans:** TBD
**UI hint:** yes

**Pitfalls addressed in this phase:**
- #6 SSE timeouts + heartbeat every 25s + `maxDuration: 800` + EventSource auto-reconnect with snapshot-replay catch-up
- #8 `stopWhen: stepCountIs(5)` on `streamText` to prevent infinite tool loops
- #10 Cookie strategy resolved: localStorage on client, NOT cookie-during-stream (validated cut from Phase 0.5)
- #16 UI confirmation badge from server response, never from LLM text — system prompt rule "NEVER confirm without `reservation_id`"
- #21 System prompt explicitly handles Spanish edge inputs ("somos 4 o 5", "para mañana" → out of scope, etc.) — tested with 10 weird real inputs
- DurableAgent ETA capped at 4h effort; if running over, fall back to deterministic formula `position * avg_turnover_min` wrapped in `@workflow/ai/agent` for Track 2 narrative

**Required spikes (from research §5 flags):**
- AI SDK v6 `useChat` + `DefaultChatTransport` + `sendMessage({text})` lifecycle: spike-test 10 sample conversations in `/gsd-discuss-phase` BEFORE locking tool schemas

**First cut within this phase if running over:** PLAT-08 (DurableAgent ETA) — replace with deterministic formula, still wrap in `@workflow/ai/agent` to preserve Track 2 framing

---

### Phase 4: Pilot-Hardening + Demo
**Goal:** The system is production-grade enough to run a real pilot the same week (rate limiting, idempotency, PII audit, monitoring), and the 90-second demo video shipping all 6 scenarios is recorded, edited, and submitted with a polished README. This is the win condition.
**Depends on:** Phase 3 (full user-facing system working end-to-end)
**Requirements:** DEMO-03
**Collapses scope Fases:** 11 (hardening) + 12 (demo prep)

**Success Criteria** (what must be TRUE):
  1. **Pilot-readiness gate:** all 4 of (a) rate limit (5 req/min per IP) on `create_reservation` with KV-backed counter, (b) idempotency dedup key in KV (hash of `email + party_size + 30s window`) on `create_reservation`, (c) PII audit confirms no email/phone/full-name in any Vercel log over a 1-hour observation, (d) `/api/health` endpoint returns 200 when DB+KV+EdgeConfig reachable, with a Slack/Discord webhook firing on workflow failure
  2. **Smoke test passes against production:** `scripts/smoke.sh` runs end-to-end in production (create reservation via MCP, call it via authed staff endpoint, extend, cancel, no-show flow) and asserts 2xx + correct status transitions
  3. **Demo video shipped:** 90-second recording covering all 6 scenarios — (1) alta conversacional, (2) vuelta del comensal con estado preservado, (3) llamado + extensión proactiva via chat, (4) no-show automático, (5) Edge Config en vivo (with rehearsed 15s propagation pause), (6) money shot del deploy with active tickets surviving — recorded in clips (not one take), at temperature 0.2, with each scenario rehearsed 3 times before the real take
  4. **Submission complete:** GitHub repo public + `.env.example` accurate + README has description/stack/local-run/deploy-link, public Vercel URL stable, video uploaded, hackathon submission form filed

**Plans:** TBD

**Pitfalls addressed in this phase:**
- #14 Rehearse Edge Config propagation timing for scenario 5 (change value, wait 15s, then trigger)
- #15 Final PII audit before going live with real diners (grep production logs for email/phone patterns)
- #17 Record in clips, pre-script prompts, temperature 0.2, 3 dry-runs per scenario; have backup take of each
- #18 Smoke test catches missing env vars in production
- #22 Minimum viable monitoring (health check + workflow-failure webhook) before pilot diners arrive

**Cuttable from video if rehearsal is sloppy:** scenario 5 (Edge Config live edit) — keep the infra (used by workflow), drop the video moment. Non-cuttable: scenarios 1, 2, 3, 4, 6.

---

## Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation | 4/4 | Done | 2026-04-25 |
| 2. Backend Core | 3/8 | Executing | - |
| 3. User Surfaces | 0/TBD | Not started | - |
| 4. Pilot-Hardening + Demo | 0/TBD | Not started | - |

---

## Coverage Validation

**v1 requirements:** 32 total
**Mapped:** 32/32 (100%) ✓
**Unmapped:** 0
**Duplicates:** 0

| Phase | Requirement Count | Requirements |
|-------|-------------------|--------------|
| 1 — Foundation | 5 | STAFF-01, PLAT-04, PLAT-06, DEMO-01, DEMO-02 |
| 2 — Backend Core | 7 | PLAT-01, PLAT-02, PLAT-03, PLAT-05, PLAT-07, SAFE-01, DEMO-04 |
| 3 — User Surfaces | 19 | DINER-01, DINER-02, DINER-03, DINER-04, DINER-05, DINER-06, DINER-07, DINER-08, STAFF-02, STAFF-03, STAFF-04, STAFF-05, STAFF-06, STAFF-07, STAFF-08, STAFF-09, PLAT-08, SAFE-02, SAFE-03 |
| 4 — Pilot-Hardening + Demo | 1 | DEMO-03 |
| **Total** | **32** | |

**Phase 4 has only 1 mapped requirement (DEMO-03) by design** — most of Phase 4's work is hardening/discipline (rate limiting, idempotency, monitoring, PII audit, smoke testing) which is captured by success criteria 1, 2, and 4 but is NOT enumerated as separate v1 requirements (it's pilot-readiness baseline, not feature scope). DEMO-01/02/04 deliberately ship earlier (Phase 1 deploy + repo, Phase 2 seed script) so they exist to support development from day one, not as last-minute artifacts.

---

## Phase Ordering Rationale

- **Why Phase 1 collapses 5 scope-fases:** all are Vercel infrastructure with no business logic. Doing them as separate GSD phases (each with discuss/plan/build) wastes coordination overhead. Edge Config is pulled forward from scope Fase 7 because Phase 2 workflow code needs `getConfig('no_show_timeout_min')` to compile cleanly.
- **Why Phase 2 is the critical path:** MCP + WDK + service layer + SSE plumbing are deeply interdependent and represent the entire "backend" of the system. Collapsing them avoids inventing fake interfaces between fases. Money-shot smoke test pulled forward from scope Fase 11 — finding it broken in Phase 2 leaves time to fix; finding it broken in Phase 4 is a project killer.
- **Why Phase 3 includes ETA agent:** scope Fase 10 is half-day work and depends on the same MCP tooling. Spinning up a separate phase isn't worth the overhead. ETA agent is the cleanest cut within Phase 3 if running over (fall back to deterministic formula).
- **Why Phase 4 includes demo prep:** demo prep IS hardening — the video scenarios ARE the smoke tests. Building the seed-demo script in Phase 2 (not Phase 4) means Phase 4 focuses on rehearsal and polish, not first-time E2E discovery.

---

## Critical Path

```
Phase 0 (human, ~1 day blocked by DNS)
    ↓
Phase 1 (foundation, agent ~1.5 days)
    ↓
Phase 2 (backend core, agent ~2 days) ← CRITICAL PATH, money shot here
    ↓
Phase 3 (user surfaces, agent ~2 days)
    ↓
Phase 4 (hardening + demo, agent + human ~1.5 days)
```

Total: ~7 days end-to-end with overlap (Phase 0 DNS propagates while Phase 1 agent work proceeds on non-auth subtasks).

---

## Cut List Priority (if time runs short)

In order of "cut first":

1. **DurableAgent ETA quality** (PLAT-08 in Phase 3) — fall back to deterministic formula `position * avg_turnover_min`, still wrap in `@workflow/ai/agent` to keep the Track 2 narrative
2. **`/queue/history` as separate page** (STAFF-08 in Phase 3) — show closed reservations inline in `/queue` with a filter toggle
3. **STAFF-09 undo no_show** — document as known gap; fix in pilot week 1
4. **Edge Config live-edit video scenario** (DEMO-03 scenario 5) — keep the infra, drop scenario 5 from video if rehearsal is sloppy
5. **Color-coded cards by party size** (STAFF-04) — basic styling fine, Edge Config palette is bonus

**Do NOT cut:** chatbot, MCP server with 4 tools, WDK durable workflow, SSE for diner push, no-show automation, staff Llamar/Marcar presentado, Resend magic-link auth, public deploy URL, demo video covering scenarios 1-4 + 6. These are the demo + the pilot.

---

## Open Questions for Plan-Phase Spikes

| # | Question | Phase | Where to resolve |
|---|----------|-------|------------------|
| 1 | Does TS 5.2+ `using` keyword compile + run on Vercel's Node 20 runtime with WDK? | 2 | RESOLVED in plan 02-01: PASS on Node 20.19.4 |
| 2 | Does `createHook()` buffer events fired before subscribe? | 2 | RESOLVED in plan 02-01: ASSUMED NON-BUFFERING (pessimistic) → D-10 mandatory |
| 3 | Skip MCP-over-HTTP roundtrip from `/api/chat` and call services directly? | 3 | `/gsd-plan-phase 3` |
| 4 | DurableAgent ETA quality vs deterministic formula | 3 | Cap at 4h, decide based on dry-run output |
| 5 | Pro vs Hobby plan for pilot (Hobby caps SSE at 300s, Pro 800s) | 4 | Decide before final prod deploy |
| 6 | Two `pg` clients on Neon at concurrent load (Pool for Auth + serverless for app) | 1 | Small load test in Phase 1 plan (10 parallel auth + 10 parallel reads) |
| 7 | AI SDK v6 `useChat` lifecycle in chatbot context | 3 | 10-conversation spike with Claude in `/gsd-discuss-phase 3` |

---

*Last updated: 2026-04-26 after plan 02-01-spikes-skew completion*
