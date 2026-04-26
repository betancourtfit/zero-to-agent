---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: executing
last_updated: "2026-04-26T06:14:45.000Z"
progress:
  total_phases: 4
  completed_phases: 1
  total_plans: 12
  completed_plans: 6
  percent: 50
---

# State: Zero to Agent — Restaurant Queue MVP

**Last updated:** 2026-04-26 after plan 02-02-log-redactor completion

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
Plan: 3 of 8 (next: 02-03-service-layer)
**Milestone:** v1 (hackathon MVP + pilot)
**Phase:** 2
**Plan:** 02-01 complete; 02-02 complete; 02-03 ready to execute
**Status:** Executing Phase 02
**Progress:** [█████░░░░░] 50%

**Next action:** Proceed to plan 02-03 (service-layer — `lib/services/reservations.ts` + `lib/services/queue.ts`). All later Phase 2 plans (services, workflow, MCP, SSE, staff API) consume `log` from `lib/log.ts` for structured logging; the contract is locked. Skew Protection (B2) still pending and gates plans 02-04 (workflow) + 02-08 (money-shot) — does NOT gate 02-03.

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

**Plans completed:** 6 (Phase 1: 4 plans + Phase 2: 2 plans)
**Plans repaired:** 0
**Phases completed:** 1 (Phase 1 — Foundation)
**Cycles per plan (avg):** 1.0
**Time per phase (avg):** N/A

| Plan | Duration | Tasks | Files |
|------|----------|-------|-------|
| Phase 02-backend-core P01 (spikes-skew) | 7m | 5 (4 atomic + 1 auto-fix) | 7 |
| Phase 02-backend-core P02 (log-redactor) | 3m | 3 (2 atomic + 1 auto-fix) | 2 |

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
| B2 | Vercel Skew Protection NOT confirmed enabled | Human (user) | Vercel Dashboard → Project → Settings → Skew Protection → Enable. Soft-blocks plan 02-04 (workflow code) and hard-blocks plan 02-08 (money-shot smoke). Deferred from plan 02-01 Task 1 — agent cannot click dashboard toggles. |

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

**Previous session ended:** 2026-04-26 after plan 02-02-log-redactor completion. `lib/log.ts` PII redactor + structured logger shipped (SAFE-01), 7-case `__tests__/log-redact.test.ts` green, build clean.

**Next session should:**

1. Proceed to plan 02-03 (service-layer — `lib/services/reservations.ts` + `lib/services/queue.ts`). All service-layer mutations consume `log` from `lib/log.ts` and the D-10 DB-backed safety net pattern.
2. Skew Protection (B2) still pending; doesn't gate 02-03 but does gate 02-04 (workflow) + 02-08 (money-shot).
3. After 02-03, plans 02-04 (workflow) + 02-05 (MCP) can run in parallel once B2 is resolved.

**If returning after long gap:**

- Re-read PROJECT.md "Core Value" first
- Check ROADMAP.md "Phase Details" for current phase's success criteria
- Check this STATE.md "Active Blockers" before assuming you can proceed

---

*State initialized: 2026-04-25 after roadmap creation*

**Planned Phase:** 1 (Foundation) — 4 plans — 2026-04-26T01:47:31.899Z

**Last completed plan:** 02-01-spikes-skew — 2026-04-26 — commits be77a72, e4170f2, 223a04d, aa6ab70, c39a107

**Last completed plan:** 02-02-log-redactor — 2026-04-26 — commits 81dae58, 87fa419, f8d91f2
