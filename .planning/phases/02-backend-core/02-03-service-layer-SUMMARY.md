---
phase: 02-backend-core
plan: 03
subsystem: services
tags: [service-layer, kv-pubsub, db-safety-net, zod-validation, plat-01, plat-03, plat-04, plat-05, demo-04]

# Dependency graph
requires:
  - phase: 01-foundation
    provides: "Schema 0001_init.sql (reservations + reservation_events tables, 6-status CHECK including failed_to_start), lib/db/neon.ts HTTP client, lib/edge-config/index.ts getTypedConfig wrapper, scripts/db-migrate.ts runner with _migrations tracking"
  - phase: 02-backend-core
    provides: "Plan 02-01 wired workflow SDK + workflow/api re-exports resumeHook; Plan 02-02 shipped lib/log.ts with PII redactor — every service-layer function logs through it"
provides:
  - "lib/services/reservations.ts — diner-facing CRUD: createReservation, getReservationStatus, extendWait, cancelReservation. ServiceResult<T> = { ok, data | error } structured contract per D-04."
  - "lib/services/queue.ts — staff-facing ops: getActiveQueue, markCalled, markSeated, markNoShowManual. Re-exports ServiceResult<T> from reservations.ts to single-source the type."
  - "lib/realtime.ts — KV pub/sub publisher: publishReservationEvent (channel reservation:<uuid>) + publishQueueEvent (channel queue:active). Service layer + future workflow steps publish through this; SSE handlers (Phase 02-06) subscribe."
  - "db/migrations/0002_workflow_active_hook.sql — adds active_hook_token TEXT NULL column for workflow hook token resolution (D-09). Idempotent via ADD COLUMN IF NOT EXISTS."
  - "package.json — seed:demo, smoke:mcp, smoke:money-shot script aliases (implementations land in plan 02-08)."
affects:
  - 02-04-workflow (createReservation has TODO(02-04) for the start() call; workflow function reads active_hook_token written by service layer; resumeHook calls bind to tokens this layer sets)
  - 02-05-mcp-server (4 MCP tools wrap these 4 reservation service functions per ARCHITECTURE Pattern 1)
  - 02-06-sse (SSE handlers subscribe to the KV channels published by lib/realtime.ts; snapshot-replay-on-connect reads the same reservations + reservation_events tables service layer writes)
  - 02-07-staff-api (POST /api/queue/[id]/{call,seated,no_show_manual} are 5–15 line wrappers around markCalled, markSeated, markNoShowManual)
  - 02-08-smoke (seed-demo.ts will call createReservation + markCalled + markSeated for the 3-reservation demo fixture; smoke-money-shot polls the SSE channels lib/realtime.ts feeds)
  - 03-x (Phase 3 /api/chat calls services DIRECTLY per D-36 — same exports, same ServiceResult contract; chatbot reads session_token from localStorage and passes it to extendWait/cancelReservation/getReservationStatus)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Service-layer funnel (ARCHITECTURE Pattern 1): every mutation goes through lib/services/*.ts; MCP tools and staff API endpoints are 5–15 line wrappers"
    - "DB-backed safety net (D-10): every action that triggers a workflow event INSERTs reservation_events BEFORE calling resumeHook — workflow timeout branches re-query missed events"
    - "ServiceResult<T> tagged-union return shape: { ok:true, data } | { ok:false, error: { code, message, fields? } }; Spanish-friendly error messages aligned with SAFE-03 empathic-recoverable tone"
    - "Zod discipline (D-05): .passthrough() on every object schema, .coerce.number() on numerics, safeParse over parse, structured INVALID_INPUT error with field-level details"
    - "Two service files (D-18): reservations.ts diner-facing, queue.ts staff-facing — keeps file count small (Pitfall #4 friendliness)"
    - "Hook resume in-process (D-37): import resumeHook from workflow/api; never fetch() back to a workflow endpoint"
    - "ISO-string serialization at the SQL layer: TIMESTAMPTZ columns cast to ::text in SELECT to avoid Date-object leakage when results cross step boundaries (D-12)"

key-files:
  created:
    - "lib/services/reservations.ts (15.9KB) — 4 diner-facing functions: createReservation (Zod input + insert + KV publish; workflow.start() is TODO(02-04)), getReservationStatus (session_token → row + position), extendWait (called-state guard + max_extensions check + Edge Config extension_min interval), cancelReservation (waiting/called guard + close + KV publish)"
    - "lib/services/queue.ts (10.1KB) — 4 staff-facing functions: getActiveQueue (non-closed reservations + 1-based position), markCalled (waiting → called), markSeated (called → seated terminal), markNoShowManual (waiting/called → no_show D-30)"
    - "lib/realtime.ts (1.7KB) — Redis.fromEnv() module-scoped publisher; ReservationEventPayload + QueueEventPayload typed shapes; logs event_type only (no PII)"
    - "db/migrations/0002_workflow_active_hook.sql — ALTER TABLE reservations ADD COLUMN IF NOT EXISTS active_hook_token TEXT NULL"
  modified:
    - "package.json — added seed:demo, smoke:mcp, smoke:money-shot scripts (implementations land in 02-08)"

decisions:
  - "createReservation defers the workflow.start() call to plan 02-04. The service inserts the reservation row + writes active_hook_token=reservation:<id>:waiting + publishes KV events, but no workflow function exists yet to actually park on that token. A TODO(02-04) block in the source documents the exact wiring 02-04 must add (try/catch around start() + D-14 compensating UPDATE on failure). This is acceptable because the only Phase 2 caller of createReservation is the MCP create_reservation tool in plan 02-05, which already depends on 02-04 (waves 1→2)."
  - "All four queue-mutation functions (markCalled, markSeated, markNoShowManual + extendWait/cancelReservation in reservations.ts) skip resumeHook with a no_active_hook warn-log if active_hook_token is NULL on the row. This handles the 02-03↔02-04 gap gracefully: DB state still mutates, KV still publishes, and the warn-log surfaces the gap during testing without breaking the call. Once 02-04 ships, every active row has a real token, so the warn path becomes dead."
  - "ServiceResult<T> is defined and exported from reservations.ts; queue.ts re-imports the type. Single source of truth for the error contract — when MCP tools land in 02-05 they import the same type and the LLM-visible JSON shape stays uniform across all 7 actions."
  - "TIMESTAMPTZ columns are SELECTed with ::text casts in the load helpers (loadReservationBySession + loadReservation + getActiveQueue) so result objects carry plain ISO strings, not Date instances. This pre-emptively satisfies D-12 step-boundary serialization for plan 02-04 (workflow steps consume these same shapes)."
  - "Position computation is 1-based and re-derived from a fresh active-queue ORDER BY created_at ASC query on every getReservationStatus / createReservation call. We do NOT cache position in a column — the position drifts as other reservations close, and a stale value would mislead the diner. eta_min IS persisted (set on create, can be refreshed by the workflow's recompute_eta step in 02-04) because that calculation is more expensive."
  - "Manual no-show service function (markNoShowManual) added even though plan 02-03 declared only 3 queue exports. Plan 02-07 will need a backing service for POST /api/queue/[id]/no_show_manual per D-30; adding it here means the staff API endpoint stays a thin wrapper. STAFF-09 undo lives in Phase 3 with the panel — undoing is a separate transition that a Phase 3 plan owns."

metrics:
  duration: "~15m wall (4 atomic tasks, sequential)"
  completed_date: "2026-04-26"
  task_count: 4
  file_count: 5
  commit_count: 5
  lines_added: 985
---

# Phase 02 Plan 03: Service Layer Summary

**One-liner:** Diner + staff service layer (`lib/services/reservations.ts` + `lib/services/queue.ts`) with Zod-validated inputs, structured `ServiceResult<T>` returns, DB-backed safety net for hook resumes, KV pub/sub via `lib/realtime.ts`, and the `0002_workflow_active_hook.sql` migration — all wired to log via `lib/log.ts` with zero raw `console.*` calls.

## What shipped

### Task 1 — `db/migrations/0002_workflow_active_hook.sql` ([commit 09964e2](commit:09964e2))

```sql
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS active_hook_token TEXT NULL;
```

Idempotent via `IF NOT EXISTS`. Column was already present in the Neon DB from a prior session that survived the working-tree rebuild — verified via `information_schema.columns`:

```
[ { "column_name": "active_hook_token", "data_type": "text", "is_nullable": "YES" } ]
```

`scripts/db-migrate.ts` reports `[skip] 0002_workflow_active_hook.sql` because `_migrations` already tracks it. Re-running on a fresh DB would apply cleanly thanks to `IF NOT EXISTS`.

### Task 2 — `lib/realtime.ts` ([commit 4f30b4f](commit:4f30b4f))

Two helpers + two typed payload interfaces:

| Export | Channel | Purpose |
|---|---|---|
| `publishReservationEvent(reservationId, event)` | `reservation:<uuid>` (D-24) | Per-reservation events for diner SSE |
| `publishQueueEvent(event)` | `queue:active` (D-24) | Fan-out for staff panel SSE |

Both use `Redis.fromEnv()` module-scoped (matches Phase 1 smoke test pattern; no long-lived subscriptions — publishers fire and forget). Logs `realtime.publish.{reservation,queue}` with `event_type` only — never the full payload (which carries position, eta_min, etc., all non-PII but kept minimal for log volume).

KV smoke test re-runs green: `KV smoke test passed`.

### Task 3 — `lib/services/reservations.ts` ([commit 7122449](commit:7122449))

```ts
export async function createReservation(rawInput: unknown): Promise<ServiceResult<CreateReservationData>>
export async function getReservationStatus(rawInput: unknown): Promise<ServiceResult<ReservationStatusData>>
export async function extendWait(rawInput: unknown): Promise<ServiceResult<ExtendWaitData>>
export async function cancelReservation(rawInput: unknown): Promise<ServiceResult<CancelReservationData>>
```

- **`createReservation`** — Zod-validates `{name, email, phone, party_size}` with `.passthrough()`, INSERTs the row with `gen_random_uuid()` session_token, writes `active_hook_token = 'reservation:<id>:waiting'`, computes position + ETA, persists `eta_min`, publishes both KV channels. **The `start(reservationWorkflow, ...)` call is a TODO(02-04)** — see Deviation #1 below.
- **`getReservationStatus`** — Resolves by `sessionToken`; returns `{reservation_id, status, position, eta_min, extension_count, no_show_deadline, called_at}`. `RESERVATION_NOT_FOUND` if no row.
- **`extendWait`** — Three guards in order: `INVALID_SESSION` → `RESERVATION_NOT_FOUND` → `NOT_IN_CALLED_STATE` → `MAX_EXTENSIONS_REACHED` (Edge Config `max_extensions_per_ticket`). Extends `no_show_deadline` by Edge Config `extension_min` minutes (uses `GREATEST(COALESCE(no_show_deadline, NOW()), NOW())` to handle null/past deadlines). INSERT `reservation_events('extend_requested')` BEFORE `resumeHook(active_hook_token, {type:'extend', ...})` (D-10).
- **`cancelReservation`** — Guards on `waiting` or `called` status. UPDATEs row to `cancelled` + `ended_at = NOW()`. Same DB-backed-safety-net pattern: events row first, hook resume second.

All Zod schemas use `.passthrough()`. All input validation uses `safeParse`. All errors have Spanish-friendly messages (e.g., `MAX_EXTENSIONS_REACHED.message = "Ya pediste todas las extensiones disponibles. Si necesitás más tiempo, hablá con el maître al llegar."`).

### Task 4 — `lib/services/queue.ts` ([commit 04d01d0](commit:04d01d0))

```ts
export async function getActiveQueue(): Promise<ActiveQueueItem[]>
export async function markCalled(reservationId: string): Promise<ServiceResult<QueueMutationData>>
export async function markSeated(reservationId: string): Promise<ServiceResult<QueueMutationData>>
export async function markNoShowManual(reservationId: string): Promise<ServiceResult<QueueMutationData>>
```

- **`getActiveQueue`** — `SELECT ... WHERE status NOT IN ('seated','no_show','cancelled','failed_to_start') ORDER BY created_at ASC`. Returns array with 1-based `position` derived from row order. Logs `queue.active.read` with `count`.
- **`markCalled`** — Guards on `waiting` status. UPDATEs to `called` + `called_at = NOW()`. INSERTs `reservation_events('call_requested')` BEFORE `resumeHook(:waiting_token, {type:'call'})`. Publishes both KV channels.
- **`markSeated`** — Guards on `called` status. UPDATEs to `seated` + `ended_at = NOW()` (terminal). Same safety-net + KV pattern.
- **`markNoShowManual`** — Guards on `waiting` OR `called`. UPDATEs to `no_show` + `ended_at = NOW()`. Resumes hook with `{type:'no_show_manual'}`. Added even though the plan declared only 3 queue exports — see Deviation #2.

### Package scripts ([commit 69bbeae](commit:69bbeae))

```json
"seed:demo": "tsx scripts/seed-demo.ts",
"smoke:mcp": "bash scripts/smoke-test-mcp.sh",
"smoke:money-shot": "bash scripts/smoke-money-shot.sh"
```

The script aliases land now so `lib/workflows/_README.md`'s money-shot rehearsal contract has stable `npm run` names; the actual script files land in plan 02-08.

## Verification

| Check | Result |
|---|---|
| `db/migrations/0002_workflow_active_hook.sql` exists with `active_hook_token TEXT NULL` | PASS |
| Column verified in Neon DB via `information_schema.columns` | PASS (text, nullable) |
| `lib/realtime.ts` exports `publishReservationEvent` + `publishQueueEvent` + uses `Redis.fromEnv()` | PASS |
| `npm run smoke:kv` | PASS (`KV smoke test passed`) |
| `lib/services/reservations.ts` exports 4 expected functions | PASS |
| `lib/services/queue.ts` exports 4 functions (3 plan + 1 added per D-30) | PASS |
| All service files import from `@/lib/db/neon` (HTTP client, not pool) | PASS |
| All service files import from `@/lib/log` (no raw `console.*`) | PASS — `grep -rnE '\bconsole\.(log\|warn\|error)\(' lib/services/ lib/realtime.ts` → 0 hits |
| All service files use `safeParse` (where Zod is used) | PASS |
| All service files INSERT `reservation_events` BEFORE `resumeHook` | PASS — visible in source for all 6 mutating paths |
| `lib/db/pool` not imported by service layer | PASS — only mentioned in a comment header |
| `SKIP_ENV_VALIDATION=1 npm run build` succeeds | PASS (1.85s compile, 1.09s tsc, 8/8 pages, no errors) |
| `npm run lint` | PASS (0 errors, 4 pre-existing warnings unrelated to this plan) |
| `__tests__/log-redact.test.ts` (Phase 02-02) | PASS (7/7) |

## Deviations from Plan

### 1. [Rule 3 — Sequencing gap] `createReservation` defers `start()` call to plan 02-04

- **Found during:** Task 3 design
- **Issue:** The plan's spec for `createReservation` includes `await start("reservation-workflow", { input: { reservationId: id } })` and a try/catch with the D-14 compensating action. But `lib/workflows/reservation.ts` doesn't exist yet — plan 02-04 owns it. Calling `start()` requires the workflow function reference (per `workflow/api`'s typed signature `start<TArgs, TResult>(workflow: WorkflowFunction<TArgs, TResult>, args: TArgs)`).
- **Fix:** Wrote `createReservation` end-to-end EXCEPT the workflow start. Inserted the row, set `active_hook_token = 'reservation:<id>:waiting'` (so plan 02-07's staff API will work end-to-end as soon as 02-04 lands), persisted `eta_min`, published both KV channels. Added a TODO(02-04) comment block with the exact code 02-04 must add (try/catch around `start()` + the D-14 compensating UPDATE).
- **Why this is safe:** No Phase 2 caller exercises `createReservation` in 02-03. The MCP `create_reservation` tool lands in plan 02-05, which depends on 02-04 (waves 1→2). By the time anyone calls this function, 02-04 will have replaced the TODO with the real `start()` call.
- **Files modified:** `lib/services/reservations.ts`
- **Commit:** 7122449

### 2. [Rule 2 — Critical missing function] Added `markNoShowManual` to `queue.ts`

- **Found during:** Task 4 cross-referencing D-30
- **Issue:** The plan's `must_haves.truths` declares `lib/services/queue.ts exports getActiveQueue, markCalled, markSeated` (3 functions), but D-30 in `02-CONTEXT.md` says plan 02-07 will ship `POST /api/queue/[id]/no_show_manual` as one of three staff action API endpoints. Without a backing service function, that endpoint would either inline the SQL+KV+resumeHook logic (violating the service-layer-funnel commitment) or block plan 02-07.
- **Fix:** Added `markNoShowManual(reservationId)` following the same pattern as `markCalled`/`markSeated`: guards on `waiting`-or-`called`, UPDATEs to `no_show`, INSERTs `reservation_events('no_show_requested', {source:'manual'})`, resumes hook with `{type:'no_show_manual'}`, publishes both KV channels.
- **Files modified:** `lib/services/queue.ts`
- **Commit:** 04d01d0

### 3. [Hook-import strategy chosen] `resumeHook` imported from `workflow/api`, no separate `hooks.ts` shim

- **Found during:** Task 3 import resolution
- **Issue:** The prompt offered two strategies for the 02-03↔02-04 ordering gap: (A) define hooks in a new `lib/workflows/hooks.ts` and import from there, or (B) call `resumeHook(token, payload)` with a TODO/stub.
- **Decision:** Chose strategy (A')→ a hybrid: import `resumeHook` directly from `workflow/api`. Inspecting `node_modules/workflow/dist/api.d.ts` confirmed `resumeHook<T>(tokenOrHook: string | Hook, payload: T)` is a public API that takes a STRING TOKEN — no need for `defineHook` or a typed hook handle. Tokens are constructed as `reservation:<id>:waiting` etc. per D-08. This means `extendWait`, `cancelReservation`, `markCalled`, `markSeated`, `markNoShowManual` ALL work today with real `resumeHook` calls; the only deferred piece is `start()` in `createReservation` (Deviation #1) which genuinely needs the workflow function reference.
- **Why this beats both alternatives:** No new shim file (avoids increasing `lib/workflows/` file count, which Pitfall #4's freeze rule treats as risky). No stub `Promise.resolve()` that would silently do nothing (the bug from the prior session that this rebuild is fixing).
- **Safety net for the 02-03↔02-04 gap:** When `active_hook_token` is null on the row, the service function logs `<action>.no_active_hook` warn and SKIPS the `resumeHook` call, but still mutates DB state and publishes KV. This means if anything calls these functions before 02-04 ships, the DB is consistent and SSE clients see the events — they just don't trigger workflow advancement. After 02-04 lands, every active row has a real token and the warn path is dead.
- **Files modified:** `lib/services/reservations.ts`, `lib/services/queue.ts`
- **Commits:** 7122449, 04d01d0

## Threat surface scan

No new network endpoints, auth paths, file-access patterns, or schema-at-trust-boundary changes beyond what `<threat_model>` in the plan already covered. The `0002` migration adds a column whose only writers are this service layer + plan 02-04's workflow steps; no diner-controlled input lands in `active_hook_token`.

## Self-Check: PASSED

| Item | Status |
|---|---|
| `db/migrations/0002_workflow_active_hook.sql` | FOUND |
| `lib/realtime.ts` | FOUND |
| `lib/services/reservations.ts` | FOUND |
| `lib/services/queue.ts` | FOUND |
| `package.json` updated with 3 scripts | FOUND |
| Commit `09964e2` (migration) | FOUND |
| Commit `4f30b4f` (realtime) | FOUND |
| Commit `7122449` (reservations service) | FOUND |
| Commit `04d01d0` (queue service) | FOUND |
| Commit `69bbeae` (package scripts) | FOUND |
| Build green (`SKIP_ENV_VALIDATION=1 npm run build`) | PASS |
| KV smoke green (`npm run smoke:kv`) | PASS |
| Lint clean (no new errors) | PASS |
| Phase 02-02 redactor tests still green (7/7) | PASS |
