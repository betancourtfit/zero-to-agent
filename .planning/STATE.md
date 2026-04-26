---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: Phase 1 context captured. Ready for /gsd-plan-phase 1.
last_updated: "2026-04-25T22:00:00.000Z"
progress:
  total_phases: 4
  completed_phases: 0
  total_plans: 0
  completed_plans: 0
  percent: 0
---

# State: Zero to Agent — Restaurant Queue MVP

**Last updated:** 2026-04-25 after Phase 1 context gathering (`/gsd-discuss-phase 1`)

---

## Project Reference

**Core value:** Una reserva entra al chatbot, sobrevive deploys/crashes/timers como workflow durable, y se cierra correctamente (`seated`, `no_show` o `cancelled`) sin perder estado.

**Current focus:** Phase 1 context captured at `.planning/phases/01-foundation/01-CONTEXT.md`. Ready for `/gsd-plan-phase 1`. Phase 0 prerequisites still gate the auth subtask of Phase 1; non-auth subtasks can proceed in parallel.

**Hackathon deadline:** ~2026-05-02 (~7 days from 2026-04-25)
**Pilot start:** Same week as hackathon — real diners, real PII, real correctness requirements
**Constraints:** Solo dev + Claude Code. 100% Vercel stack. Spanish only. Tiny scale (<20 concurrent diners).

---

## Current Position

**Milestone:** v1 (hackathon MVP + pilot)
**Phase:** 1 (Foundation — context captured)
**Plan:** N/A (plans not yet created — next step)
**Status:** Phase 1 context captured. User selected "ninguna" — Claude resolved 4 gray areas (migration tooling, Edge Config seeding, maître auth gate, deploy + URL) plus 5 discretion decisions using research-backed defaults.
**Progress:** [░░░░░░░░░░░░░░░░░░░░] 0% (0/4 phases complete)

**Next action:** Run `/gsd-plan-phase 1` to decompose Phase 1 into executable plans. Phase 0 prereqs (especially Resend domain verification) still gate the auth subtask.

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

**Plans completed:** 0
**Plans repaired:** 0
**Phases completed:** 0
**Cycles per plan (avg):** N/A
**Time per phase (avg):** N/A

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

**Previous session ended:** 2026-04-25 after `/gsd-new-project` orchestrator created PROJECT.md, REQUIREMENTS.md, research/*, and now ROADMAP.md + STATE.md.

**Next session should:**

1. Verify Phase 0 prerequisites complete (especially Resend domain "verified" in dashboard)
2. Run `/gsd-plan-phase 1` to decompose Phase 1 (Foundation) into executable plans
3. Phase 1 plans should account for: Resend gate on STAFF-01 subtask; two pg clients (Pool for Auth + serverless for app); Auth.js v5 split config; pooled vs non-pooled Postgres URL discipline

**If returning after long gap:**

- Re-read PROJECT.md "Core Value" first
- Check ROADMAP.md "Phase Details" for current phase's success criteria
- Check this STATE.md "Active Blockers" before assuming you can proceed

---

*State initialized: 2026-04-25 after roadmap creation*
