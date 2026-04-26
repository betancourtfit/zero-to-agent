# Phase 2: Backend Core — Research Summary

**Researched:** 2026-04-26
**Phase:** 2 — Backend Core
**Source:** `.planning/research/` (STACK.md, ARCHITECTURE.md, PITFALLS.md, SUMMARY.md) + `02-CONTEXT.md` decisions D-01–D-37

---

## Executive Summary

Phase 2 is the critical path. It collapses scope Fases 5 (MCP server) + 6 (WDK workflows). All technical approaches have been researched in the initial spike and the findings are incorporated into `02-CONTEXT.md` as 37 locked decisions. This document confirms the research is current and identifies what the planner needs to know.

**Confidence: HIGH** — no new gaps found since initial research (2026-04-25).

---

## What the Planner Needs to Know

### 1. MCP Server (`mcp-handler@1.1.0`)

- **Stack:** `mcp-handler@1.1.0` + `@modelcontextprotocol/sdk@1.26.0` + `zod@^3`
- **Route:** `app/mcp/[transport]/route.ts` — exports `GET = POST = DELETE = authHandler`
- **Auth:** Single `verifyBearer` function for all 4 tools (D-01, D-06). Constant-time comparison against `MCP_API_KEY` env var.
- **Security model:** `create_reservation` accepts diner fields in LLM-visible schema. Action tools (`extend_wait`, `cancel_reservation`, `get_reservation_status`) accept `z.object({}).passthrough()` — server resolves `reservation_id` from `X-Reservation-Session` header via `resolveSession()` (D-03, D-05).
- **Error contract:** Structured JSON `{ ok: false, error: { code, message } }` returned as text content (D-04). No fake-success.

### 2. WDK Durable Workflow (`workflow@latest`)

- **Package:** `npm install workflow` (NOT `@vercel/workflow` — that package name is deprecated)
- **API shape:** `'use workflow'` + `'use step'` directives. `createHook()` + `Promise.race(hook, sleep("Xm"))` — NOT `waitForEvent` (which doesn't exist).
- **File structure:** SINGLE FILE at `lib/workflows/reservation.ts` (D-11). Do NOT split into multiple files — file count change is a workflow-shape change per Pitfall #4.
- **Next.js config:** `next.config.ts` must add `withWorkflow(...)` wrapper. `tsconfig.json` must include `plugins: [{name:"workflow"}]`.
- **Hook tokens:** Phase-specific tokens (`reservation:<id>:waiting`, `reservation:<id>:called:pre`, `reservation:<id>:called:final`) (D-08).
- **DB-backed safety net:** Persist `reservation_events` INSERT BEFORE `resumeHook` (D-10). Workflow timeout branches re-query `reservation_events` for missed events.
- **Serializable steps only:** All step I/O is plain JSON. Convert `TIMESTAMPTZ` to ISO strings at boundaries (D-12, Pitfall #3).
- **Side effects in steps only:** Workflow function is a router, not a worker. All IO inside `"use step"` functions (D-16, Pitfall #1).
- **Edge Config inside steps:** Never at module load. Sample-once-and-store pattern (D-13, Pitfall #14).
- **Freeze shape:** Workflow step count and order frozen at end of Phase 2 (D-11, Pitfall #4).

### 3. Service Layer (`lib/services/*`)

- **Two files:** `reservations.ts` (diner-facing) + `queue.ts` (staff-facing) (D-18)
- **DB client:** `lib/db/neon.ts` (HTTP, pooled). NOT `lib/db/pool.ts` (that's Auth.js only).
- **Pattern:** validate → DB write/read → workflow.start/resumeHook → KV publish → return JSON-serializable result

### 4. Realtime: KV Pub/Sub + SSE

- **KV:** `@upstash/redis` with `Redis.fromEnv()`. Channels: `reservation:<id>` + `queue:active` (D-24).
- **Publisher:** `lib/realtime.ts` — service layer + workflow steps call these helpers, never `redis.publish` directly (D-20).
- **SSE handlers:** `app/api/events/[reservation_id]/route.ts` + `app/api/events/queue/route.ts` (D-26, D-27).
- **Snapshot-replay-on-connect:** Mandatory. Read Postgres current state → emit snapshot event → replay missed `reservation_events` → subscribe to KV (D-27).
- **Heartbeat:** Every 25s as `: hb\n\n` (comment line). `maxDuration: 800` (Pro).
- **Abort cleanup:** `req.signal.addEventListener('abort', ...)` releases Upstash subscription slot (D-26, Pitfall #7).

### 5. Staff Action API

- **Endpoints:** `POST /api/queue/[id]/call`, `/api/queue/[id]/seated`, `/api/queue/[id]/no_show_manual` (D-30)
- **Auth:** `auth()` from `lib/auth/auth.ts` + employees-active gate
- **Pattern:** resolve hook token from `reservations.active_hook_token` → INSERT `reservation_events` → `resumeHook` → publish KV events (D-10)

### 6. PII Redactor (`lib/log.ts` — SAFE-01)

- **Shape:** `log.info/warn/error` + `redactPII()` helper (D-21)
- **Scope:** Used EVERYWHERE in `lib/services/*` + `lib/workflows/*` + MCP handlers + SSE handlers + staff API
- **Raw console.log forbidden** outside `lib/log.ts` (D-21)

### 7. Seed Script (`scripts/seed-demo.ts` — DEMO-04)

- **Strategy:** 3 reservations via REAL `createReservation()` service (D-32)
- **States:** `waiting`, `called`, `seated` — all with live workflows
- **Idempotent:** deletes existing demo rows first
- **Run:** `npm run seed:demo` — default dev fixture from day 1

### 8. Money-Shot Smoke Test

- **Automated:** `scripts/smoke-money-shot.sh` (bash) — creates 2 reservations, triggers deploy, verifies both survive (D-31)
- **Manual ritual:** documented in `lib/workflows/_README.md`
- **Prerequisite:** Skew Protection MUST be enabled in Vercel dashboard (D-17)

---

## Known Spikes (to execute FIRST in Phase 2)

| Spike | Description | Time | Fallback |
|-------|-------------|------|----------|
| 2-A | Verify `using` keyword compiles + runs on Vercel Node 20 | ~30 min | Manual `try/finally` with `hook.dispose()` |
| 2-B | Verify `createHook()` buffers events fired before subscribe | ~30 min | DB-backed safety net is mandatory |

Both spikes are documented as FIRST tasks in `02-CONTEXT.md` D-15.

---

## Phase 2 Requirements Coverage

| Req ID | Description | Addressed by |
|--------|-------------|--------------|
| PLAT-01 | MCP server with 4 tools | D-01 to D-07 |
| PLAT-02 | Per-tool security (bearer + session_token) | D-01, D-03, D-05, D-06 |
| PLAT-03 | WDK durable workflow, lifecycle, frozen shape | D-08 to D-17 |
| PLAT-05 | Upstash Redis pub/sub for SSE fan-out | D-20, D-24 |
| PLAT-07 | SSE Route Handlers with snapshot-replay | D-26, D-27, D-28, D-29 |
| SAFE-01 | PII redactor in all logs | D-21, D-23 |
| DEMO-04 | seed-demo.ts script | D-32 |

All 7 Phase 2 requirements are addressed by CONTEXT.md decisions. No gaps.

---

## Dependencies on Phase 1

Phase 2 depends on Phase 1 being complete:
- Public Vercel URL stable (auto-deploy wired)
- DB schema with 6-status CHECK constraint, `workflow_run_id`, `session_token` columns
- Edge Config 6 keys seeded + `getConfig()` wrapper at `lib/edge-config/index.ts`
- Two-pg-clients pattern (neon.ts for app, pool.ts for Auth)
- KV provisioned + smoke test passing
- `MCP_API_KEY` env var in all 3 Vercel environments

One new migration: `0002_workflow_active_hook.sql` adds `active_hook_token TEXT NULL` column (D-09).

---

## Research Gaps

**None identified.** The existing research (STACK.md, ARCHITECTURE.md, PITFALLS.md, SUMMARY.md) plus the 37 CONTEXT.md decisions provide sufficient detail for planning. The two spikes (2-A, 2-B) are runtime verifications, not design decisions.

---

*Research completed: 2026-04-26*
*Source: Initial research completed 2026-04-25. No new gaps found.*
