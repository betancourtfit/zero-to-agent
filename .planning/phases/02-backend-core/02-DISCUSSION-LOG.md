# Phase 2: Backend Core - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in `02-CONTEXT.md` — this log preserves the alternatives considered.

**Date:** 2026-04-26
**Phase:** 02-backend-core
**Areas presented:** MCP tools (security + error contract), Workflow shape (hook-race safety + spikes), Service layer + PII redactor (SAFE-01), Realtime fan-out + SSE auth + money-shot + seed-demo
**Areas discussed:** none (user opted to lock all areas using research-backed defaults)

---

## Single Question Asked

**Header:** Discuss
**Question:** Which Phase 2 areas do you want to discuss? (Pick any combo — unselected areas use research-backed defaults from PITFALLS/ARCHITECTURE/STACK without further questions.)
**Mode:** multiSelect

| Option | Description (abbreviated) | Selected |
|--------|---------------------------|----------|
| MCP tools — security + error contract | Bearer + per-tool session_token; LLM-visible schemas; structured error codes (Pitfalls #5, #9, #16). Covers PLAT-01, PLAT-02. | |
| Workflow shape, hook-race safety + spikes | Hook token strategy; DB-backed safety net; workflow file structure given Pitfall #4 freeze rule; the two open spikes (Pitfalls #1/#2/#3/#4). | |
| Service layer organization + PII redactor (SAFE-01) | `lib/services/*` granularity; `lib/log.ts` shape, scope, sink (SAFE-01 + Pitfall #15). | |
| Realtime fan-out + SSE auth + money-shot validation + seed-demo | KV channels; SSE auth without cookie-during-stream; snapshot-replay payload; money-shot smoke test format; seed-demo strategy (PLAT-05/07/DEMO-04 + Pitfalls #6, #7). | |

**User's response:** "ninguno, ejecuta todos" (none — execute all using research-backed defaults).

**Interpretation:** All four gray areas locked by Claude using:
- `.planning/research/STACK.md` (package names, snippets, env vars)
- `.planning/research/ARCHITECTURE.md` (5 commitments + 5 patterns + 4 critical journeys + 6 anti-patterns)
- `.planning/research/PITFALLS.md` (#1, #2, #3, #4, #5, #7, #9, #14, #15, #16, #19, #20)
- `.planning/research/SUMMARY.md` §3, §5, §6, §7
- `.planning/PROJECT.md` (cut list, key decisions, constraints)
- `.planning/REQUIREMENTS.md` (PLAT-01/02/03/05/07, SAFE-01, DEMO-04)
- `.planning/ROADMAP.md` "Phase 2: Backend Core"
- `.planning/phases/01-foundation/01-CONTEXT.md` (Phase 1 carry-forwards: D-19 env, D-25/26 repo layout, D-28 two-pg-clients, D-13 auto-deploy)
- `.planning/phases/01-foundation/01-VERIFICATION.md` (live verified state: 6 statuses CHECK including failed_to_start, workflow_run_id column present, Edge Config wrapper orphaned awaiting Phase 2 consumer)

---

## Claude's Discretion

All four gray areas were resolved as Claude's discretion per user instruction. Decisions are recorded in `02-CONTEXT.md` `<decisions>` section as D-01 through D-37, plus `<canonical_refs>`, `<code_context>`, `<specifics>`, and `<deferred>` sections.

**Key locked decisions worth re-flagging here for audit:**
- D-09: One new schema column (`active_hook_token TEXT NULL`) via `0002_workflow_active_hook.sql`
- D-10: DB-backed safety net for hook race SHIPS regardless of spike outcome (belt-and-suspenders)
- D-11: Single workflow file at `lib/workflows/reservation.ts`; do NOT split (Pitfall #4 file-count is a shape change)
- D-15: Both spikes (`using` keyword + createHook buffering) are FIRST tasks in `/gsd-execute-phase 2`, before any workflow code lands
- D-17: Skew Protection enable-check is a hard gate at top of execute-phase
- D-28: Diner SSE auth via `?session_token=<uuid>` query param (cookie-during-stream is out of v1; localStorage-fed query param is the ARCHITECTURE §3.3 pattern)
- D-30: Staff action API endpoints land in Phase 2 (not Phase 3) so the workflow is exercised end-to-end during Phase 2 development
- D-31: Money-shot smoke test = automated bash + manual ritual; Phase 3 cannot start until automated test passes against production
- D-32: `seed-demo.ts` uses the REAL `createReservation()` service (Pitfall #20 — used as default dev fixture from day 1, not just demo)
- D-36: `/api/chat` will call services DIRECTLY in Phase 3 (not via in-process MCP roundtrip) — locks Open Question #3 from research SUMMARY §7

## Deferred Ideas

Captured in `02-CONTEXT.md` `<deferred>` section. Highlights: chatbot UI, panel UI, DurableAgent ETA, STAFF-09 undo, rate limit, idempotency, /api/health, Slack/Discord webhook, Pino, custom ESLint rule, multi-tenant, WhatsApp adapter.
