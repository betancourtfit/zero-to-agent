---
phase: 02-backend-core
plan: 04
subsystem: workflow
tags: [workflow, durable, reservation, wdk, hooks, pii-safe]
requires:
  - lib/db/neon.ts (sql HTTP client — Phase 1 D-19)
  - lib/edge-config/index.ts (getTypedConfig — Phase 1 D-08)
  - lib/log.ts (structured logger + redactor — plan 02-02)
  - lib/realtime.ts (publishReservationEvent + publishQueueEvent — plan 02-03 D-20)
  - lib/services/reservations.ts (createReservation owns start() — wired here)
  - db/migrations/0002_workflow_active_hook.sql (active_hook_token column — plan 02-03 D-09)
  - workflow@4.2.4 (defineHook + sleep + start)
provides:
  - lib/workflows/reservation.ts (reservationWorkflow + 5 typed hooks)
  - createReservation now starts the durable workflow on row insert
affects:
  - Phase 02-05 (MCP create_reservation will be the first route to import the
    service and thus light up workflow discovery)
  - Phase 02-06 (SSE handlers will subscribe to workflow-emitted KV events)
  - Phase 02-07 (staff API endpoints already use resumeHook against
    active_hook_token; the workflow now writes those tokens at every phase)
  - Phase 02-08 (money-shot smoke test exercises this workflow's durability)
  - Phase 03 chatbot (extend/cancel via MCP land on the same hooks)
  - DurableAgent ETA wrap is a Phase 3 step-BODY change (D-11 allows it)
tech-stack:
  added: []
  patterns:
    - "defineHook<T>() at module top; .create({token}) inside workflow body"
    - "Promise.race([hook, sleep('Xm/s')]) per phase with per-event sub-tokens"
    - "DB-backed safety net: every Promise.race timeout calls fetchMissedEvents"
    - "Sample-once-and-store: no_show_deadline computed ONCE at called transition (D-13)"
    - "Step boundary discipline: TIMESTAMPTZ → ::text (ISO strings); no Date/Map/Buffer cross step boundaries"
    - "Compensating action on start() failure: status='failed_to_start' (D-14)"
    - "Three phase tokens written to active_hook_token before each hook is parked"
key-files:
  created:
    - lib/workflows/reservation.ts
  modified:
    - lib/services/reservations.ts (start() wired; TODO(02-04) resolved)
    - lib/workflows/_README.md (Implementation Notes section + Shape History)
decisions:
  - "Per-event sub-tokens (e.g. :called:pre:extend) preserve the phase-root active_hook_token contract while letting Promise.race fan out across event types"
  - "computeRemainingSeconds is its own step so Date.now() never appears in the router body (D-16)"
  - "On start() failure, return INTERNAL_ERROR ServiceResult instead of re-throwing — preserves the contract Phase 02-05 MCP tools already depend on (was a deviation from the plan's TODO snippet which re-threw)"
  - "Per-event-type sub-tokens (:called:pre:extend, :called:final:cancel, etc.) instead of a single multi-arm hook because defineHook<T> binds payload type per token; this keeps each hook's payload typed without union widening"
  - "Pre-window extend short-circuits the followup push — diner explicitly asked for time, no need to ask again"
metrics:
  duration_minutes: 7
  tasks: 2 (workflow file + README docs)
  files_changed: 3
  completed: 2026-04-26
---

# Phase 02 Plan 04: Reservation Workflow Summary

Durable WDK workflow at `lib/workflows/reservation.ts` orchestrates the full reservation lifecycle (`waiting → called → seated|no_show|cancelled` with `extend` branch and proactive followup push) using `defineHook<T>()` + `Promise.race(hook, sleep)`. Single file, FROZEN shape (D-11). Service-layer `createReservation` now invokes `start(reservationWorkflow, [{reservationId}])` with D-14 compensating-action error handling; the prior session's `hook.waitFor` API-fabrication bug is replaced with the real `defineHook(...).create({token})` pattern verified against `node_modules/@workflow/core/dist/define-hook.d.ts` and `create-hook.d.ts`.

## What Shipped

### `lib/workflows/reservation.ts` (commit `720f430`)

A single-file router-style workflow function (`"use workflow"`) that calls into 10 `"use step"` async helpers in the same file (per D-11 single-file discipline — splitting into multiple files is forbidden because file count is part of the workflow shape, Pitfall #4).

**Module-top hook definitions (D-08):**

```ts
export const callHook         = defineHook<{ type: "call" }>();
export const extendHook       = defineHook<{ type: "extend"; new_deadline: string; extension_count: number }>();
export const cancelHook       = defineHook<{ type: "cancel" }>();
export const seatedHook       = defineHook<{ type: "seated" }>();
export const noShowManualHook = defineHook<{ type: "no_show_manual" }>();
```

These are exported so Phase 3 + future callers can use the typed `.resume(token, payload)` form. Today's service layer (`lib/services/{reservations,queue}.ts`) keeps using the lower-level `resumeHook(tokenString, payload)` from `workflow/api` against `reservations.active_hook_token` — that pattern was locked in plan 02-03 and remains correct.

**Step inventory (FROZEN — count and order are part of the workflow shape):**

| # | Step | Returns (plain JSON) | Notes |
|---|------|----------------------|-------|
| 1 | `loadReservationSnapshot(id)` | `ReservationSnapshot \| null` | TIMESTAMPTZ → ISO via `::text` projections |
| 2 | `setActiveHookToken(id, token)` | `{token, written_at}` | UPDATE before each new hook parks |
| 3 | `loadEdgeConfigSnapshot()` | `EdgeConfigSnapshot` | All 5 keys read in one step (D-13) |
| 4 | `fetchMissedEvents(id, lastSeenEventId)` | `MissedEvent[]` | DB-backed safety net (D-10) — every timeout exit |
| 5 | `applyCallTransition(id, noShowTimeoutMin)` | `{no_show_deadline, called_at, event_id}` | Persists deadline ONCE per D-13 sample-once-and-store |
| 6 | `emitFollowupPush(id, message)` | `{event_id}` | After `:called:pre` window expires |
| 7 | `reloadDeadlineAfterExtend(id)` | `{no_show_deadline, extension_count}` | Re-reads after service extendWait wrote |
| 8 | `applyNoShowTransition(id, source)` | `{event_id, ended_at}` | Terminal — workflow timeout path |
| 9 | `acknowledgeTerminal(id, reason)` | `{event_id}` | Clears `active_hook_token` on seated/cancel/no_show_manual |
| 10 | `computeRemainingSeconds(isoDeadline)` | `{seconds}` | `Date.now()` lives here (router-forbidden per D-16) |

**Router phases:**

1. **WAITING** — token `reservation:<id>:waiting`. `Promise.race(callHook, cancelHook, sleep(eta_recompute_interval_sec))`. On timeout, `fetchMissedEvents` recovers any `call_requested`/`cancel_requested` published while no hook was parked (D-10).
2. **CALLED — :called:pre window** — token `reservation:<id>:called:pre`. After `applyCallTransition` writes `no_show_deadline = NOW() + no_show_timeout_min` ONCE (D-13), race all 5 hook arms against `sleep(followup_after_call_min)`. If a diner extends during this window, skip the followup and proceed to `:called:final`.
3. **CALLED — :called:final window** — token `reservation:<id>:called:final`. `Promise.race(extend, cancel, seated, no_show_manual, sleep(remainingSeconds))` until terminal or deadline. Extend loop reloads `no_show_deadline` from the row (the service layer is the writer; the workflow trusts the row of truth).

Per-event-type sub-tokens (`:called:pre:extend`, `:called:final:cancel`, etc.) let multiple hooks race the same phase concurrently while keeping each hook's `defineHook<T>` payload type unambiguous — see Decision row above.

### `lib/services/reservations.ts` — `createReservation` wired (same commit `720f430`)

The plan 02-03 TODO(02-04) block is replaced with:

```ts
try {
  const run = await start(reservationWorkflow, [{ reservationId }]);
  await sql`
    UPDATE reservations
    SET workflow_run_id = ${run.runId},
        active_hook_token = ${`reservation:${reservationId}:waiting`},
        updated_at = NOW()
    WHERE id = ${reservationId}
  `;
  log.info("reservation.create.workflow_started", { reservation_id: reservationId, run_id: run.runId });
} catch (err) {
  await sql`UPDATE reservations SET status='failed_to_start', updated_at=NOW() WHERE id = ${reservationId}`;
  log.error("reservation.create.workflow_start_failed", err, { reservation_id: reservationId });
  return { ok: false, error: { code: "INTERNAL_ERROR", message: "No pudimos iniciar tu reserva. Intentá de nuevo." } };
}
```

The plan's TODO snippet originally re-threw the error; I returned a `ServiceResult` instead so the contract Phase 02-05 MCP tools depend on stays consistent (every service function returns `ServiceResult<T>` per D-04). Tracked as deviation #1 below.

### `lib/workflows/_README.md` — Implementation Notes (commit `f145d22`)

Added an "Implementation Notes (plan 02-04)" section documenting the hook definitions, step inventory, router phases, service integration, and the build/discovery note. Appended a row to "Shape History" recording the initial implementation as the FROZEN baseline.

## Verification

| Check | Result |
|---|---|
| `test -f lib/workflows/reservation.ts` | PASS |
| `grep -q '"use workflow"' lib/workflows/reservation.ts` | PASS |
| `grep -q '"use step"' lib/workflows/reservation.ts` | PASS (10 step blocks) |
| `grep -q 'callHook \| extendHook \| cancelHook \| seatedHook' lib/workflows/reservation.ts` | PASS (5 hooks) |
| `grep -q 'Promise.race' lib/workflows/reservation.ts` | PASS (3 races) |
| `grep -q 'reservation_events' lib/workflows/reservation.ts` | PASS (D-10 safety net + audit events) |
| Router-rule (D-16): all 12 `sql\``/`Date.now` hits inside `"use step"` blocks | PASS — manual line-by-line verification |
| `SKIP_ENV_VALIDATION=1 npm run build` (TypeScript check) | PASS — `Compiled successfully in 2.1s; Finished TypeScript in 1147ms` |
| `npx tsx --test __tests__/log-redact.test.ts` | PASS — 7/7 tests still green |

### Build manifest note

`npm run build` reports `Created manifest with 3 steps, 0 workflows, and 0 classes`. **This is expected and correct at this phase boundary.** The `@workflow/next` eager builder only scans files reachable from `app/`, `src/app/`, `pages/`, or `src/pages/` entrypoints (`route.ts`, `page.ts`, `layout.ts`) — confirmed by reading `node_modules/@workflow/next/dist/builder-eager.js`. No app route imports `lib/services/reservations.ts` yet; the MCP route in plan 02-05 will be the first to do so, and the workflow will appear in the manifest at that point. TypeScript checking covers the workflow file regardless of discovery, and the type check passes.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 4 / API correction] start() failure path returns ServiceResult instead of re-throwing**
- **Found during:** Task 1, while wiring the `createReservation` TODO
- **Issue:** The plan's TODO snippet at `lib/services/reservations.ts:194` re-threw the error with `throw err` after setting `failed_to_start`. Every other path in `createReservation` (and every other function in the service module) returns a `ServiceResult<T>` per D-04. Re-throwing would break the contract Phase 02-05 MCP tools depend on (the tools wrap `result.ok ? ... : ...` and would have to add try/catch only for this one function).
- **Fix:** Return `{ ok: false, error: { code: "INTERNAL_ERROR", message: "No pudimos iniciar tu reserva. Intentá de nuevo." } }` after the compensating UPDATE. The diner-facing message is Spanish + empathic (SAFE-03 tone). The compensating action (D-14) — UPDATE status='failed_to_start' — happens unchanged.
- **Files modified:** `lib/services/reservations.ts`
- **Commit:** `720f430`

**2. [Rule 2 - Critical functionality] computeRemainingSeconds extracted as a step**
- **Found during:** Task 1, designing the `:called:final` phase
- **Issue:** The plan's pseudocode in the action block did not name a step that converts `currentDeadline` (ISO string) into `sleep(...)`-compatible seconds. The router can't call `Date.now()` directly (D-16 / Pitfall #1).
- **Fix:** Added `computeRemainingSeconds(isoDeadline)` as step #10 (the LAST step in the FROZEN order, so it's append-safe per D-11). Returns `{ seconds: number }`. The router calls it before each `:called:final` race iteration.
- **Files modified:** `lib/workflows/reservation.ts`
- **Commit:** `720f430`

**3. [Rule 2 - Defensive] Per-event-type sub-tokens for multi-arm races**
- **Found during:** Task 1, racing 4-5 hook arms in `:called:pre` and `:called:final`
- **Issue:** A single shared token across all event types would require a union payload type (`{ type: "call" } | { type: "extend"; ... } | ...`). `defineHook<T>()` binds the payload type per token, so a single hook can't carry the union without a wrapper. Service layer also uses `resumeHook(tokenString, ...)` directly — passing a single phase-root token and letting payload `.type` discriminate is what plan 02-03 already shipped.
- **Fix:** Each phase gets per-event sub-tokens (`reservation:<id>:called:pre:extend`, `:called:pre:cancel`, etc.) for the workflow's `Promise.race`, while `active_hook_token` in the row stays at the phase root (`reservation:<id>:called:pre`). The service layer's `resumeHook(tokenString, payload)` calls work unchanged because the token in the DB column matches what they read.
- **Files modified:** `lib/workflows/reservation.ts`
- **Commit:** `720f430`

### No other deviations

The router rule (D-16), serialization contract (D-12), Edge Config inside steps (D-13), single file discipline (D-11), DB-backed safety net (D-10), and compensating action (D-14) all hold as written.

### Authentication gates

None. All work was local code + type check.

## Skew Protection (B2) — Status Unchanged

The user's prompt confirmed B2 is NOT a blocker for this plan: "Skew Protection (B2) is NOT a blocker for this plan. Skew Protection affects production deploy-time behavior of in-flight workflows during the money-shot demo (plan 02-08). It does NOT gate local code, type checks, or build success."

B2 remains an open Active Blocker. The user must toggle Vercel Dashboard → Project → Settings → Skew Protection → Enable before the money-shot rehearsal in plan 02-08. STATE.md still tracks it as open.

## Known Stubs

None. The workflow function is fully implemented; every step has a real body; the service-layer `start()` call is wired with full error handling.

## Self-Check: PASSED

- `lib/workflows/reservation.ts` exists at the expected path
- `lib/services/reservations.ts` modified (TODO(02-04) replaced; `start()` + `reservationWorkflow` imports added)
- `lib/workflows/_README.md` modified (Implementation Notes + Shape History row)
- Commit `720f430` exists in `git log` (Task 1: feat workflow + service wiring)
- Commit `f145d22` exists in `git log` (Task 2: docs README)
- TypeScript check passes via `SKIP_ENV_VALIDATION=1 npm run build`

## Phase Continuation

Plan 02-05 (MCP) and 02-06 (SSE) can now run in parallel — both depend on this plan and have no further blockers besides their own contexts. Plan 02-08 (money-shot smoke) is gated on B2 (Skew Protection) being toggled in the Vercel dashboard by the user; the workflow code itself is ready.
