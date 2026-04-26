---
phase: 03-user-surfaces
plan: 05
type: execute
wave: 3
depends_on: [03-02, 03-04]
files_modified:
  - db/migrations/0003_reopen_count.sql
  - lib/services/queue.ts
  - app/api/queue/[id]/reopen/route.ts
  - app/api/queue/history/route.ts
  - app/queue/history/page.tsx
  - components/queue/history-table.tsx
  - components/queue/reopen-dialog.tsx
  - __tests__/queue-reopen.test.ts
autonomous: true
requirements: [STAFF-08, STAFF-09]
requirements_addressed: [STAFF-08, STAFF-09]
must_haves:
  truths:
    - "Migration `0003_reopen_count.sql` adds `reopen_count INTEGER NOT NULL DEFAULT 0` to reservations; idempotent ALTER TABLE ADD COLUMN IF NOT EXISTS so re-running is safe (D-16)."
    - "`lib/services/queue.ts` gains a 5th export `reopenNoShow(reservationId)` that validates current status==='no_show', starts a NEW workflow run via `start(reservationWorkflow, [{reservationId}])`, updates the row to status='waiting' + clears ended_at/no_show_deadline/called_at + increments reopen_count, inserts an audit `reservation_events` row with event_type='reopened', and publishes both reservation:<id> and queue:active KV events."
    - "`POST /api/queue/[id]/reopen` is a 5-15 LOC wrapper around `reopenNoShow` with the same auth + status-code mapping as Phase 2 staff endpoints (401/403/404/409/400/500). NOT_IN_NO_SHOW_STATE maps to 409."
    - "`/queue/history` is a separate route (not a /queue toggle) per D-12. Auth-gated. Shows all closed reservations of the day (status IN seated/no_show/cancelled) sorted by ended_at DESC. TABLE layout (not cards) per D-17."
    - "Day filter: `DATE(created_at AT TIME ZONE 'America/Argentina/Buenos_Aires') = CURRENT_DATE` (D-17)."
    - "`/api/queue/history` is auth-gated GET that returns the day's closed rows; client polls every 30s — NO SSE on this page (D-17)."
    - "Each `no_show` row in the table has a `[Reabrir]` button that opens a shadcn AlertDialog (`¿Confirmás reabrir? Se va a crear una nueva entrada en la cola activa.`) per D-18; on confirm POSTs to `/api/queue/[id]/reopen`."
    - "On reopen success: Sonner toast `Reserva reabierta. Aparece en la cola activa.` (UI-SPEC §"Reopen flow")."
  artifacts:
    - path: "db/migrations/0003_reopen_count.sql"
      provides: "reopen_count column"
      contains: "ADD COLUMN IF NOT EXISTS reopen_count"
    - path: "lib/services/queue.ts"
      provides: "5th export reopenNoShow"
      contains: "export async function reopenNoShow"
    - path: "app/api/queue/[id]/reopen/route.ts"
      provides: "POST staff endpoint wrapping reopenNoShow"
      min_lines: 50
    - path: "app/api/queue/history/route.ts"
      provides: "GET history list (auth-gated, day-scoped)"
      min_lines: 30
    - path: "app/queue/history/page.tsx"
      provides: "Server Component + auth + render <HistoryTable />"
      min_lines: 30
    - path: "components/queue/history-table.tsx"
      provides: "6-column table + 30s polling + Reabrir button per no_show row"
      min_lines: 80
    - path: "components/queue/reopen-dialog.tsx"
      provides: "AlertDialog wrapper firing the reopen POST"
  key_links:
    - from: "app/api/queue/[id]/reopen/route.ts"
      to: "lib/services/queue.ts → reopenNoShow"
      via: "direct import"
      pattern: "reopenNoShow"
    - from: "lib/services/queue.ts → reopenNoShow"
      to: "lib/workflows/reservation.ts → reservationWorkflow"
      via: "start() from workflow/api"
      pattern: "start\\(reservationWorkflow"
    - from: "components/queue/history-table.tsx"
      to: "/api/queue/history"
      via: "fetch with 30s polling"
      pattern: "/api/queue/history"
    - from: "components/queue/reopen-dialog.tsx"
      to: "/api/queue/[id]/reopen"
      via: "fetch POST"
      pattern: "/api/queue/.*/reopen"
---

<objective>
Ship STAFF-08 (history view) and STAFF-09 (Reabrir / undo no_show), the last two maître-side requirements before the workflow-body swap. STAFF-09 is taken off the cut list per CONTEXT D-16 because the underlying mechanic (a fresh workflow run for the same row) is small (~30 LOC service + 1 endpoint + 1 button + 1 dialog) and the pilot pain of NOT having it is unbounded ("you're already a no-show, re-register from QR" is brutal).

Purpose: Close the maître panel loop. The day's closed reservations are auditable; the maître has an emergency lever for "the diner arrived 5 min late" cases.

Output: A `/queue/history` page deployed to prod with day-scoped table + Reabrir AlertDialog. Migration 0003 lands first (DB compatibility) then service + endpoints + UI in atomic commits.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/STATE.md
@.planning/phases/03-user-surfaces/03-CONTEXT.md
@.planning/phases/03-user-surfaces/03-RESEARCH.md
@.planning/phases/03-user-surfaces/03-PATTERNS.md
@.planning/phases/03-user-surfaces/03-UI-SPEC.md
@db/migrations/0002_workflow_active_hook.sql
@lib/services/queue.ts
@lib/workflows/reservation.ts
@lib/realtime.ts
@app/api/queue/[id]/seated/route.ts
@app/api/queue/route.ts
@components/ui/alert-dialog.tsx

<interfaces>
Phase 2 service contract:
```typescript
type ServiceResult<T> = {ok: true; data: T} | {ok: false; error: {code: string; message: string; fields?: Record<string, string>}};

// existing exports in lib/services/queue.ts (Phase 2 + plan 05 adds 5th)
getActiveQueue(): Promise<ActiveQueueRow[]>;
markCalled(id): Promise<ServiceResult<QueueMutationData>>;
markSeated(id): Promise<ServiceResult<QueueMutationData>>;
markNoShowManual(id): Promise<ServiceResult<QueueMutationData>>;
// NEW in plan 05:
reopenNoShow(id): Promise<ServiceResult<{reservation_id: string; new_status: "waiting"}>>;
```

Workflow start (Phase 2 — D-14 compensating action shape):
```typescript
import { start } from "workflow/api";
import { reservationWorkflow } from "@/lib/workflows/reservation";
// const run = await start(reservationWorkflow, [{reservationId}]);
// run.runId is the new workflow run id
```

KV publish helpers (Phase 2):
```typescript
publishReservationEvent(reservationId, payload): Promise<void>;
publishQueueEvent(payload): Promise<void>;
```

Phase 2 staff endpoint shape (auth + status code mapping — copy from app/api/queue/[id]/seated/route.ts):
```typescript
// 401 if no session
// 403 if employees.active === false
// 404 RESERVATION_NOT_FOUND
// 409 NOT_IN_NO_SHOW_STATE | RESERVATION_ALREADY_CLOSED
// 400 INVALID_INPUT | INVALID_SESSION
// 500 default / INTERNAL_ERROR
```
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Migration `0003_reopen_count.sql` — add reopen_count column (idempotent)</name>
  <files>db/migrations/0003_reopen_count.sql</files>
  <read_first>
    - db/migrations/0002_workflow_active_hook.sql (exact: top-comment block + idempotent ALTER TABLE ADD COLUMN IF NOT EXISTS pattern)
    - .planning/phases/03-user-surfaces/03-PATTERNS.md §"db/migrations/0003_reopen_count.sql" lines 338-353 (verbatim template)
    - .planning/phases/03-user-surfaces/03-CONTEXT.md D-16 (audit column + forward-only, no backfill)
  </read_first>
  <action>
1. Create `db/migrations/0003_reopen_count.sql` exactly:
```sql
-- Phase 3 — Plan 03-05 (D-16)
-- Add reopen_count column for STAFF-09 undo-no-show audit trail.
-- The reopen flow is a wrapper around start(reservationWorkflow, ...)
-- + UPDATE reservations SET status='waiting', reopen_count = reopen_count + 1.
-- Idempotent: ADD COLUMN IF NOT EXISTS allows safe re-application.
-- No backfill needed — production reservations table has no rows pre-pilot.

ALTER TABLE reservations
  ADD COLUMN IF NOT EXISTS reopen_count INTEGER NOT NULL DEFAULT 0;
```

2. Apply the migration to prod + dev:
```bash
npm run db:migrate     # uses runner from Phase 1 — picks up 0003 automatically
```

3. Verify the column exists:
```bash
psql $DATABASE_URL -c "\\d reservations" | grep reopen_count
# expect: reopen_count | integer | not null | 0
```

4. Confirm Phase 2's `getActiveQueue()` projection still works — the new column doesn't break the existing SELECT (only widens the column list). Run `npm run smoke:mcp` to verify Phase 2 contracts intact.

5. Add `reopen_count` to the `getActiveQueue()` SELECT projection in `lib/services/queue.ts` so plan 04's `QueueCard` reopen-badge actually shows when it's > 0:
   - Find the SELECT in `getActiveQueue` (Phase 2 plan 02-03 — verify line range with `grep -n "SELECT" lib/services/queue.ts` first).
   - Add `, reopen_count` to the column list.
   - Update the row TypeScript shape (`ActiveQueueRow`) accordingly so `lib/hooks/use-queue-events.ts` and `components/queue/queue-card.tsx` see it.
   - This is a small drift from "Phase 3 doesn't change Phase 2 contracts" but it's additive (the column exists per migration; SELECT widens) and contracts were always nullable / extensible.
  </action>
  <verify>
    <automated>npm run db:migrate && grep -F "ADD COLUMN IF NOT EXISTS reopen_count" db/migrations/0003_reopen_count.sql && grep -F "reopen_count" lib/services/queue.ts && npm run smoke:mcp</automated>
  </verify>
  <acceptance_criteria>
    - File `db/migrations/0003_reopen_count.sql` exists with idempotent `ADD COLUMN IF NOT EXISTS`
    - `npm run db:migrate` exits 0 (Phase 1 migration runner picks it up automatically — verify no manual runner edit needed)
    - DB column `reservations.reopen_count` exists with `NOT NULL DEFAULT 0` (verifiable via `psql`)
    - `lib/services/queue.ts → getActiveQueue` SELECT now includes `reopen_count`
    - `ActiveQueueRow` type (in `lib/services/queue.ts` and/or `lib/hooks/use-queue-events.ts`) includes `reopen_count: number`
    - `npm run smoke:mcp` exits 0 (no Phase 2 regression)
  </acceptance_criteria>
  <done>
The schema is forward-compatible. Plan 04's queue-card reopen-badge now actually populates from server data. Migration is auto-applied on next `db:migrate` in any env.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Add `reopenNoShow` 5th export to `lib/services/queue.ts`</name>
  <files>lib/services/queue.ts, __tests__/queue-reopen.test.ts</files>
  <read_first>
    - lib/services/queue.ts (Phase 2 — read fully to understand existing 4 exports + ServiceResult shape + `loadReservation` helper + KV publish discipline)
    - lib/services/reservations.ts → createReservation (Phase 2 plan 02-04 — has the `start(reservationWorkflow, ...)` + try/catch + D-14 compensating action shape; copy that error handling)
    - lib/realtime.ts (publishReservationEvent + publishQueueEvent — read to verify event payload shape)
    - .planning/phases/03-user-surfaces/03-PATTERNS.md §"lib/services/queue.ts — ADD reopenNoShow export" lines 263-335 (canonical implementation)
    - .planning/phases/03-user-surfaces/03-RESEARCH.md §"`reopenNoShow` service function" lines 993-1075 (full snippet)
    - .planning/phases/03-user-surfaces/03-CONTEXT.md D-16 (validates current status==='no_show'; new workflow run; clear ended_at/no_show_deadline/called_at; bump reopen_count; audit event)
  </read_first>
  <behavior>
    - Test 1: when `reservationId` does not exist, returns `{ok:false, error:{code:"RESERVATION_NOT_FOUND"}}`
    - Test 2: when reservation status !== 'no_show' (e.g., status='waiting'), returns `{ok:false, error:{code:"NOT_IN_NO_SHOW_STATE"}}`
    - Test 3: when status === 'no_show', calls `start(reservationWorkflow, [{reservationId}])`, returns the new runId
    - Test 4: after success, the reservations row has status='waiting', ended_at=NULL, no_show_deadline=NULL, called_at=NULL, reopen_count incremented by 1, workflow_run_id updated, active_hook_token = `reservation:<id>:waiting`
    - Test 5: after success, a `reservation_events` row with `event_type='reopened'` is inserted
    - Test 6: after success, `publishReservationEvent` and `publishQueueEvent` are both called with type 'reservation.reopened'
    - Test 7: if `start()` throws, returns `{ok:false, error:{code:"INTERNAL_ERROR"}}` and DOES NOT mutate the row (D-14 compensation pattern)
  </behavior>
  <action>
1. Add the 5th export to `lib/services/queue.ts`. Place it at the END of the file, AFTER `markNoShowManual` (Phase 2 D-30 deviation). Use the exact shape from PATTERNS.md §"lib/services/queue.ts — ADD reopenNoShow export":

```typescript
import { start } from "workflow/api";
import { reservationWorkflow } from "@/lib/workflows/reservation";
// (these imports may already exist for Phase 2 plan 02-04 — append-only if so)

export async function reopenNoShow(
  reservationId: string,
): Promise<ServiceResult<{ reservation_id: string; new_status: "waiting" }>> {
  const row = await loadReservation(reservationId); // existing private helper in queue.ts
  if (!row) {
    log.warn("queue.reopen.not_found", { reservation_id: reservationId });
    return {
      ok: false,
      error: { code: "RESERVATION_NOT_FOUND", message: "No encontramos esa reserva." },
    };
  }
  if (row.status !== "no_show") {
    log.warn("queue.reopen.bad_state", { reservation_id: reservationId, status: row.status });
    return {
      ok: false,
      error: {
        code: "NOT_IN_NO_SHOW_STATE",
        message: "Solo se pueden reabrir reservas marcadas como no-show.",
      },
    };
  }

  // Start a NEW workflow run — the prior workflow already terminated when it transitioned to no_show.
  let runId: string;
  try {
    const run = await start(reservationWorkflow, [{ reservationId }]);
    runId = run.runId;
  } catch (err) {
    log.error("queue.reopen.workflow_start_failed", err, { reservation_id: reservationId });
    return {
      ok: false,
      error: { code: "INTERNAL_ERROR", message: "No pudimos reabrir la reserva. Intentá de nuevo." },
    };
  }

  // Update row state — clears the terminal-state markers and bumps the audit counter.
  await sql`
    UPDATE reservations
    SET status = 'waiting',
        ended_at = NULL,
        no_show_deadline = NULL,
        called_at = NULL,
        workflow_run_id = ${runId},
        active_hook_token = ${`reservation:${reservationId}:waiting`},
        reopen_count = reopen_count + 1,
        updated_at = NOW()
    WHERE id = ${reservationId}
  `;

  const occurredAt = new Date().toISOString();
  const inserted = (await sql`
    INSERT INTO reservation_events (reservation_id, event_type, payload)
    VALUES (
      ${reservationId},
      'reopened',
      ${JSON.stringify({ occurred_at: occurredAt, prior_status: "no_show", run_id: runId })}::jsonb
    )
    RETURNING id
  `) as Array<{ id: number }>;

  await publishReservationEvent(reservationId, {
    id: inserted[0].id,
    type: "reservation.reopened",
    reservation_id: reservationId,
    occurred_at: occurredAt,
    status: "waiting",
  });
  await publishQueueEvent({
    type: "reservation.reopened",
    reservation_id: reservationId,
    occurred_at: occurredAt,
    status: "waiting",
  });

  log.info("queue.reopen.ok", { reservation_id: reservationId, run_id: runId });
  return { ok: true, data: { reservation_id: reservationId, new_status: "waiting" } };
}
```

2. Note (deviation from `markCalled`): NO `safeResumeHook` call. The prior workflow has terminated, so there is no live hook to resume. The fresh `start()` is the entire control-flow handover. Document this with a single inline comment in the function body.

3. Add unit tests in `__tests__/queue-reopen.test.ts` covering the 7 behaviors above. Mock `loadReservation`, `start`, `sql`, `publishReservationEvent`, `publishQueueEvent`. Use `node:test` via `tsx` per Phase 2 D-23 convention. Run via `npx tsx --test __tests__/queue-reopen.test.ts`.

4. Verify the updated file still has the 4 Phase 2 exports unchanged (`grep -E "^export async function (getActiveQueue|markCalled|markSeated|markNoShowManual|reopenNoShow)" lib/services/queue.ts | wc -l == 5`).
  </action>
  <verify>
    <automated>npx tsc --noEmit && grep -E "^export async function reopenNoShow" lib/services/queue.ts && npx tsx --test __tests__/queue-reopen.test.ts</automated>
  </verify>
  <acceptance_criteria>
    - `lib/services/queue.ts` has 5 exported async functions (verifiable by grep)
    - `reopenNoShow` returns `ServiceResult<{reservation_id, new_status}>`
    - Validates status==='no_show' BEFORE calling `start()` (correct ordering)
    - Increments `reopen_count` in the UPDATE
    - Inserts `reservation_events` row with `event_type='reopened'` (`grep -F "'reopened'" lib/services/queue.ts`)
    - Publishes both `reservation:<id>` and `queue:active` channels via existing helpers
    - Has try/catch around `start()` with INTERNAL_ERROR fallback (D-14 compensation)
    - All log lines via `log.*`, no raw `console.*`
    - Unit tests in `__tests__/queue-reopen.test.ts` exit 0
    - `npx tsc --noEmit` exits 0
  </acceptance_criteria>
  <done>
The service layer's 5th export is testable in isolation. Plan 04's panel can already render a reopen-badge from the column; the new endpoint can now wire to this function.
  </done>
</task>

<task type="auto">
  <name>Task 3: Add `POST /api/queue/[id]/reopen/route.ts` (auth + dispatch wrapper)</name>
  <files>app/api/queue/[id]/reopen/route.ts</files>
  <read_first>
    - app/api/queue/[id]/seated/route.ts (Phase 2 — exact shape; copy verbatim, swap markSeated for reopenNoShow, swap log event names)
    - .planning/phases/03-user-surfaces/03-PATTERNS.md §"app/api/queue/[id]/reopen/route.ts" lines 41-107 (full template with status-code mapper)
    - .planning/phases/03-user-surfaces/03-CONTEXT.md D-16
  </read_first>
  <action>
1. Create `app/api/queue/[id]/reopen/route.ts` based on PATTERNS.md template. Critical: status-code mapper MUST handle `NOT_IN_NO_SHOW_STATE` as 409:
```typescript
import { auth } from "@/lib/auth/auth";
import { sql } from "@/lib/db/neon";
import { log } from "@/lib/log";
import { reopenNoShow } from "@/lib/services/queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function statusForErrorCode(code: string): number {
  switch (code) {
    case "RESERVATION_NOT_FOUND": return 404;
    case "RESERVATION_ALREADY_CLOSED":
    case "NOT_IN_NO_SHOW_STATE": return 409;
    case "INVALID_INPUT":
    case "INVALID_SESSION": return 400;
    case "INTERNAL_ERROR":
    default: return 500;
  }
}

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params; // Next.js 16 dynamic route params are a Promise (Phase 2 D-32 / 02-06 deviation #4)

  const session = await auth();
  if (!session?.user?.email) {
    log.warn("api.queue.reopen.unauthorized", { reason: "no_session", reservation_id: id });
    return Response.json(
      { ok: false, error: { code: "UNAUTHORIZED", message: "No autorizado." } },
      { status: 401 },
    );
  }

  const empRows = (await sql`
    SELECT active FROM employees WHERE email = ${session.user.email} LIMIT 1
  `) as Array<{ active: boolean }>;

  if (empRows.length === 0 || !empRows[0].active) {
    log.warn("api.queue.reopen.forbidden", { reason: "employee_inactive", reservation_id: id });
    return Response.json(
      { ok: false, error: { code: "FORBIDDEN", message: "Empleado inactivo." } },
      { status: 403 },
    );
  }

  const result = await reopenNoShow(id);
  if (!result.ok) {
    log.warn("api.queue.reopen.service_error", { reservation_id: id, code: result.error.code });
    return Response.json(result, { status: statusForErrorCode(result.error.code) });
  }
  log.info("api.queue.reopen.ok", { reservation_id: id, employee_email: session.user.email });
  return Response.json(result);
}
```

2. NO new contracts — this endpoint is the 5th member of the staff API family (4 from Phase 2 + 1 here). HTTP status codes match Phase 2's mapping conventions exactly.

3. The route handler is intentionally short (5-15 LOC of business logic; ~50 LOC total with auth + comments). All real work happens in `reopenNoShow`.
  </action>
  <verify>
    <automated>npx tsc --noEmit && grep -F "reopenNoShow" app/api/queue/[id]/reopen/route.ts && grep -F "NOT_IN_NO_SHOW_STATE" app/api/queue/[id]/reopen/route.ts && grep -F "employees.active" app/api/queue/[id]/reopen/route.ts || grep -F "active" app/api/queue/[id]/reopen/route.ts</automated>
  </verify>
  <acceptance_criteria>
    - File `app/api/queue/[id]/reopen/route.ts` exists with at least 50 LOC
    - Imports `reopenNoShow` from `@/lib/services/queue`
    - Exports `POST` only
    - Has the `statusForErrorCode` helper with `NOT_IN_NO_SHOW_STATE` → 409 case
    - Re-validates `employees.active` (defense in depth)
    - Awaits `params` (Next.js 16 — Phase 2 D-32)
    - All logs via `log.*` (no raw `console.*`)
    - `npx tsc --noEmit` exits 0
  </acceptance_criteria>
  <done>
The new staff endpoint is reachable. Hitting `POST /api/queue/{id}/reopen` with the maître's session cookie executes the workflow re-start.
  </done>
</task>

<task type="auto">
  <name>Task 4: Add `GET /api/queue/history/route.ts` (auth-gated day-scoped history)</name>
  <files>app/api/queue/history/route.ts</files>
  <read_first>
    - app/api/queue/route.ts (Phase 2 GET shape — auth + service call + JSON response)
    - .planning/phases/03-user-surfaces/03-PATTERNS.md §"app/api/queue/history/route.ts" lines 111-167 (auth + SQL pattern with TZ-scoped day filter)
    - .planning/phases/03-user-surfaces/03-CONTEXT.md D-17 (day-scoped, sorted by ended_at DESC)
    - lib/db/neon.ts (sql template tag pattern)
  </read_first>
  <action>
1. Create `app/api/queue/history/route.ts`. Strategy: inline the SQL here (small, scoped to history page) rather than adding a 6th service-layer export. Two reasons: (a) no other surface needs `getHistory()`, (b) keeping `lib/services/queue.ts` at 5 exports preserves the "all mutations through service layer" rule without bloat (history is read-only).

```typescript
import { auth } from "@/lib/auth/auth";
import { sql } from "@/lib/db/neon";
import { log } from "@/lib/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export interface HistoryRow {
  reservation_id: string;
  status: "seated" | "no_show" | "cancelled";
  name: string;
  party_size: number;
  eta_min: number | null;
  extension_count: number;
  reopen_count: number;
  created_at: string;
  called_at: string | null;
  ended_at: string | null;
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.email) {
    log.warn("api.queue.history.unauthorized", { reason: "no_session" });
    return Response.json(
      { ok: false, error: { code: "UNAUTHORIZED", message: "No autorizado." } },
      { status: 401 },
    );
  }

  const empRows = (await sql`
    SELECT active FROM employees WHERE email = ${session.user.email} LIMIT 1
  `) as Array<{ active: boolean }>;
  if (empRows.length === 0 || !empRows[0].active) {
    log.warn("api.queue.history.forbidden", { reason: "employee_inactive" });
    return Response.json(
      { ok: false, error: { code: "FORBIDDEN", message: "Empleado inactivo." } },
      { status: 403 },
    );
  }

  // D-17: day-scoped, Buenos Aires timezone, terminal statuses only
  const rows = (await sql`
    SELECT id AS reservation_id,
           status,
           name,
           party_size,
           eta_min,
           extension_count,
           reopen_count,
           created_at::text AS created_at,
           called_at::text AS called_at,
           ended_at::text AS ended_at
    FROM reservations
    WHERE status IN ('seated', 'no_show', 'cancelled')
      AND DATE(created_at AT TIME ZONE 'America/Argentina/Buenos_Aires') = CURRENT_DATE
    ORDER BY ended_at DESC NULLS LAST
  `) as HistoryRow[];

  log.info("api.queue.history.read", {
    employee_email: session.user.email,
    count: rows.length,
  });

  return Response.json({ ok: true, data: rows });
}
```

2. NOTE: PII tradeoff — this endpoint DOES return `name` (the maître needs to identify the diner). Phone and email are NOT projected. If Phase 4 PII audit flags this, the maître surface would need to switch to a synthetic display name (e.g., first name only). For the pilot, full first+last name is operationally needed.

3. NO SSE on this endpoint — D-17 is explicit: history page polls every 30s. The polling cost is bounded (1 request per 30s × maître's open tab × ~5 hours per shift = ~600 requests/day per maître, well within Vercel Hobby).
  </action>
  <verify>
    <automated>npx tsc --noEmit && grep -F "America/Argentina/Buenos_Aires" app/api/queue/history/route.ts && grep -F "ORDER BY ended_at DESC" app/api/queue/history/route.ts && grep -F "employees.active" app/api/queue/history/route.ts || grep -F "active" app/api/queue/history/route.ts</automated>
  </verify>
  <acceptance_criteria>
    - File `app/api/queue/history/route.ts` exists, at least 30 LOC
    - Exports `GET` only
    - Auth-gated: 401 on no session, 403 on employees.active=false
    - SQL filters `status IN ('seated', 'no_show', 'cancelled')`
    - Day filter uses `DATE(created_at AT TIME ZONE 'America/Argentina/Buenos_Aires') = CURRENT_DATE`
    - Sorted `ORDER BY ended_at DESC` (NULLS LAST)
    - Includes `reopen_count` in projection (so history table can show "reabierto ×N" if relevant)
    - Does NOT project `email` or `phone`
    - All logs via `log.*`
    - `npx tsc --noEmit` exits 0
  </acceptance_criteria>
  <done>
The history endpoint is reachable. The history page in task 6 will poll this every 30s.
  </done>
</task>

<task type="auto">
  <name>Task 5: Build `components/queue/reopen-dialog.tsx` and `components/queue/history-table.tsx`</name>
  <files>components/queue/reopen-dialog.tsx, components/queue/history-table.tsx</files>
  <read_first>
    - components/ui/alert-dialog.tsx (shadcn primitive from plan 02 — verify export names: AlertDialog, AlertDialogTrigger, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction)
    - .planning/phases/03-user-surfaces/03-UI-SPEC.md §"Surface 3: Maître History" lines 180-196 (table columns, styling, Reabrir button shape, AlertDialog copy)
    - .planning/phases/03-user-surfaces/03-UI-SPEC.md §"Reopen flow (`/queue/history`)" lines 293-301 (interaction contract)
    - .planning/phases/03-user-surfaces/03-CONTEXT.md D-17 (table layout) and D-18 (Reabrir confirms; Llamar/presentado don't)
    - components/queue/queue-card.tsx (status pill cva variants — REUSE the same cva variant rather than re-defining)
  </read_first>
  <action>
### `components/queue/reopen-dialog.tsx`
Wraps shadcn AlertDialog with the locked Spanish copy. Props:
```typescript
{
  reservationId: string;
  diner_name: string; // shown in dialog body for context
  onReopened: () => void; // called after successful POST so the parent table can refetch
}
```

```tsx
"use client";
import { useState } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

export function ReopenDialog({ reservationId, diner_name, onReopened }: { reservationId: string; diner_name: string; onReopened: () => void }) {
  const [loading, setLoading] = useState(false);

  async function confirm() {
    setLoading(true);
    try {
      const res = await fetch(`/api/queue/${reservationId}/reopen`, {
        method: "POST",
        credentials: "include",
      });
      const body = await res.json();
      if (res.ok && body.ok) {
        toast.success("Reserva reabierta. Aparece en la cola activa.");
        onReopened();
      } else {
        toast.error(body?.error?.message ?? "No pudimos reabrir la reserva.");
      }
    } catch {
      toast.error("Error de red. Probá de nuevo.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="outline" size="sm" className="min-h-[44px]">Reabrir</Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>¿Confirmás reabrir?</AlertDialogTitle>
          <AlertDialogDescription>
            Se va a crear una nueva entrada en la cola activa.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction onClick={confirm} disabled={loading}>Confirmar</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
```

### `components/queue/history-table.tsx`
Client component. Props: `{ initial: HistoryRow[] }` (initial server-rendered snapshot from `app/queue/history/page.tsx`). Internally polls `/api/queue/history` every 30s.

```tsx
"use client";
import { useEffect, useState, useCallback } from "react";
import { ReopenDialog } from "./reopen-dialog";
import { cn } from "@/lib/utils";
import type { HistoryRow } from "@/app/api/queue/history/route";

const STATUS_CLASSES: Record<string, string> = {
  seated: "bg-green-100 text-green-700",
  no_show: "bg-red-100 text-red-700",
  cancelled: "bg-gray-100 text-gray-500",
};

const STATUS_LABEL: Record<string, string> = {
  seated: "Sentado",
  no_show: "No-show",
  cancelled: "Cancelado",
};

function formatTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toTimeString().slice(0, 5); // HH:MM
}

function durationMin(created: string, ended: string | null): string {
  if (!ended) return "—";
  return `${Math.floor((new Date(ended).valueOf() - new Date(created).valueOf()) / 60000)} min`;
}

export function HistoryTable({ initial }: { initial: HistoryRow[] }) {
  const [rows, setRows] = useState(initial);

  const refetch = useCallback(async () => {
    try {
      const res = await fetch("/api/queue/history", { credentials: "include" });
      const body = await res.json();
      if (res.ok && body.ok) setRows(body.data);
    } catch {
      // Network error — keep stale data; don't toast (polling is silent)
    }
  }, []);

  useEffect(() => {
    const id = setInterval(refetch, 30_000);
    return () => clearInterval(id);
  }, [refetch]);

  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground text-center py-8">No hay reservas cerradas hoy.</p>
    );
  }

  return (
    <table className="w-full text-sm border-collapse">
      <thead>
        <tr className="bg-muted text-muted-foreground font-normal">
          <th className="text-left p-2">Llegada</th>
          <th className="text-left p-2">Nombre</th>
          <th className="text-left p-2">Personas</th>
          <th className="text-left p-2">Estado</th>
          <th className="text-left p-2">Tiempo en cola</th>
          <th className="text-left p-2">Acción</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={r.reservation_id} className={cn("hover:bg-muted/50", i % 2 === 1 && "bg-muted/30")}>
            <td className="p-2">{formatTime(r.created_at)}</td>
            <td className="p-2 font-medium">{r.name}</td>
            <td className="p-2">{r.party_size}</td>
            <td className="p-2">
              <span role="status" className={cn("inline-flex items-center px-2 py-0.5 rounded-full text-xs", STATUS_CLASSES[r.status])}>
                {STATUS_LABEL[r.status]}
              </span>
              {r.reopen_count > 0 && (
                <span className="ml-2 text-xs text-purple-700">reabierto ×{r.reopen_count}</span>
              )}
            </td>
            <td className="p-2 text-muted-foreground">{durationMin(r.created_at, r.ended_at)}</td>
            <td className="p-2">
              {r.status === "no_show" ? (
                <ReopenDialog
                  reservationId={r.reservation_id}
                  diner_name={r.name}
                  onReopened={refetch}
                />
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```
  </action>
  <verify>
    <automated>npx tsc --noEmit && grep -F "¿Confirmás reabrir?" components/queue/reopen-dialog.tsx && grep -F "Se va a crear una nueva entrada" components/queue/reopen-dialog.tsx && grep -F "30_000" components/queue/history-table.tsx</automated>
  </verify>
  <acceptance_criteria>
    - File `components/queue/reopen-dialog.tsx` uses shadcn AlertDialog primitives
    - AlertDialogTitle text is "¿Confirmás reabrir?" (verbatim UI-SPEC)
    - AlertDialogDescription text is "Se va a crear una nueva entrada en la cola activa." (verbatim)
    - Cancel button label "Cancelar"; confirm button label "Confirmar"
    - Reabrir trigger button has `min-h-[44px]`
    - Success toast text: "Reserva reabierta. Aparece en la cola activa."
    - File `components/queue/history-table.tsx` polls `/api/queue/history` every 30 seconds (`grep -F "30_000" components/queue/history-table.tsx`)
    - Table has 6 columns matching UI-SPEC: Llegada, Nombre, Personas, Estado, Tiempo en cola, Acción
    - Reabrir dialog renders ONLY in `no_show` rows (status check in conditional)
    - Empty state copy: "No hay reservas cerradas hoy."
    - No SSE references in history-table.tsx (`grep -E "EventSource|use-queue-events|use-reservation-events" components/queue/history-table.tsx | wc -l == 0`)
    - `npx tsc --noEmit` exits 0
  </acceptance_criteria>
  <done>
The reopen flow is testable end-to-end in the UI: user clicks Reabrir → AlertDialog → Confirmar → POST → toast → refetch.
  </done>
</task>

<task type="auto">
  <name>Task 6: Create `app/queue/history/page.tsx` (Server Component shell)</name>
  <files>app/queue/history/page.tsx</files>
  <read_first>
    - app/queue/page.tsx (sibling page from plan 04 — same auth shell + employees.active gate)
    - .planning/phases/03-user-surfaces/03-PATTERNS.md §"app/queue/history/page.tsx" lines 406-411 (similar to /queue but no SSE)
    - components/queue/nav-bar.tsx (plan 04 — pass `active="history"` for the active tab indicator)
    - app/api/queue/history/route.ts (the route this page consumes)
  </read_first>
  <action>
1. Create `app/queue/history/page.tsx`:
```tsx
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/auth";
import { sql } from "@/lib/db/neon";
import { HistoryTable } from "@/components/queue/history-table";
import { NavBar } from "@/components/queue/nav-bar";
import type { HistoryRow } from "@/app/api/queue/history/route";

export const dynamic = "force-dynamic";

export default async function HistoryPage() {
  const session = await auth();
  if (!session?.user?.email) redirect("/login");

  // Defense-in-depth re-check (mirrors /queue page).
  const empRows = (await sql`
    SELECT active FROM employees WHERE email = ${session.user.email} LIMIT 1
  `) as Array<{ active: boolean }>;
  if (empRows.length === 0 || !empRows[0].active) redirect("/login");

  // SSR initial snapshot: query the same SQL the route uses.
  // (Slight duplication with route handler, but RSC can't `fetch` its own route handler at build/render time
  //  efficiently — direct DB read is cheaper and faster.)
  const initial = (await sql`
    SELECT id AS reservation_id,
           status,
           name,
           party_size,
           eta_min,
           extension_count,
           reopen_count,
           created_at::text AS created_at,
           called_at::text AS called_at,
           ended_at::text AS ended_at
    FROM reservations
    WHERE status IN ('seated', 'no_show', 'cancelled')
      AND DATE(created_at AT TIME ZONE 'America/Argentina/Buenos_Aires') = CURRENT_DATE
    ORDER BY ended_at DESC NULLS LAST
  `) as HistoryRow[];

  return (
    <>
      <NavBar active="history" />
      <main className="p-4">
        <HistoryTable initial={initial} />
      </main>
    </>
  );
}
```

2. NOTE on duplication: the SQL is identical to `/api/queue/history/route.ts`. If this duplication grates, factor into a `lib/services/queue.ts → getHistory()` 6th export. For Phase 3 budget, the duplication is acceptable (35 LOC duplicated, single-file impact). The Phase 4 hardening pass can refactor.

3. The page handing off to `<HistoryTable initial={initial} />` lets the client island poll without a loading skeleton flash.

4. NO connection-dot here — D-17 says no SSE. NavBar's `connection` prop is optional; pass nothing.
  </action>
  <verify>
    <automated>npm run build && grep -F 'active="history"' app/queue/history/page.tsx && grep -F "America/Argentina/Buenos_Aires" app/queue/history/page.tsx && ! grep -F '"use client"' app/queue/history/page.tsx</automated>
  </verify>
  <acceptance_criteria>
    - File `app/queue/history/page.tsx` does NOT contain `"use client";` directive
    - Imports `auth` from `@/lib/auth/auth` and re-validates `employees.active`
    - Performs SSR initial query with day-scoped TZ filter
    - Hands off to `<HistoryTable initial={initial} />`
    - Renders `<NavBar active="history" />` (no connection prop — no SSE)
    - `npm run build` exits 0
    - Route appears in `npm run build` output route table (`/queue/history` segment)
  </acceptance_criteria>
  <done>
The history page ships. Atomic commit per D-31 — push to prod via `git push origin main`. The maître can navigate Activas ↔ Historial.
  </done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <name>Task 7: End-to-end smoke for history + reopen</name>
  <files>(no files — verification only)</files>
  <read_first>
    - .planning/phases/03-user-surfaces/03-UI-SPEC.md §"Reopen flow (`/queue/history`)" lines 293-301
  </read_first>
  <what-built>
    - Migration 0003 + reopen_count column live in prod
    - 5th service-layer export `reopenNoShow`
    - `POST /api/queue/[id]/reopen` endpoint
    - `GET /api/queue/history` endpoint
    - `app/queue/history/page.tsx` Server Component
    - `components/queue/reopen-dialog.tsx` + `components/queue/history-table.tsx`
    - 2 phase requirements ship: STAFF-08, STAFF-09
  </what-built>
  <how-to-verify>
1. Run `npm run db:migrate` against prod (or via Vercel build hook — already triggered by deploy). Confirm column exists.
2. Open `/queue` as the maître. Confirm seed-demo's "seated" reservation is NOT visible (it's closed). Active queue still works (plan 04 unchanged).
3. Click "Historial" tab. Land on `/queue/history`.
4. Expected: table with the seated demo row + any other closed rows from today. No `[Reabrir]` button (status is seated, not no_show).
5. **Force a no_show:** in another tab, register a new diner via `/`. Wait for `no_show_timeout_min` (Edge Config — usually 15 min for the demo seed) OR force it via psql:
```bash
psql $DATABASE_URL -c "UPDATE reservations SET status='no_show', ended_at=NOW() WHERE id='<some-id>'"
```
   (Or programmatically via a maître `markNoShowManual` call — Phase 2 endpoint.)
6. Refresh `/queue/history`. Expected: the no_show row appears with a `[Reabrir]` button.
7. Click `[Reabrir]`. AlertDialog opens. Title: "¿Confirmás reabrir?". Body: "Se va a crear una nueva entrada en la cola activa.".
8. Click Cancelar. Dialog closes, no change. ✓
9. Click Reabrir again → Confirmar. Dialog closes, button shows loading state, then a green toast at bottom-right: "Reserva reabierta. Aparece en la cola activa."
10. Open `/queue` in another tab. Expected: the reservation now appears as an active waiting card. The card's reopen-badge shows "reabierto ×1".
11. **Verify a NEW workflow run started:** check Vercel Workflow dashboard — the reservation's run_id should be different from the original; both runs are visible in history.
12. **Verify event audit:** psql:
```bash
psql $DATABASE_URL -c "SELECT event_type, payload FROM reservation_events WHERE reservation_id='<id>' ORDER BY id"
```
   Expected: original lifecycle events + a new `reopened` row with `payload.prior_status = 'no_show'`.
13. **Wait-for-server check:** click Reabrir on a row that has just been reopened (state should be 'waiting' now). Expected: 409 toast: "Solo se pueden reabrir reservas marcadas como no-show." (NOT_IN_NO_SHOW_STATE → 409 mapping).
14. **Polling check:** open `/queue/history` and watch Network tab. Confirm a `GET /api/queue/history` fires every 30s.
15. **No regression to plan 03 / plan 04:** open `/` and `/queue` in separate tabs, register, click Llamar — push banner still arrives (plan 03+04 contracts intact).

If all 15 pass: type "approved". Plan 06 (PLAT-08 body swap) can run.
If any fail: report which; the most likely culprits are (a) workflow_run_id update race on parallel reopens, (b) ActiveQueueRow shape didn't pick up reopen_count.
  </how-to-verify>
  <resume-signal>Type "approved" to confirm history + reopen are production-ready.</resume-signal>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| browser ↔ /queue/history (RSC) | Auth.js cookie + employees.active re-check |
| browser ↔ /api/queue/history (GET, polled) | Same auth |
| browser ↔ /api/queue/[id]/reopen (POST) | Same auth + status-conflict resolution |
| reopenNoShow ↔ workflow start() | server-side; D-14 compensating action on failure |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-03-05-01 | Spoofing | unauthenticated user accesses /queue/history or /api/queue/history | mitigate | proxy.ts gates /queue/:path*; page + API both re-validate `employees.active` |
| T-03-05-02 | Tampering | maître reopens a reservation that's NOT in no_show state (e.g., still waiting) | mitigate | service validates `status==='no_show'` BEFORE start(); returns NOT_IN_NO_SHOW_STATE → 409. Audit row in reservation_events shows the attempt failed (no row inserted). |
| T-03-05-03 | Tampering | concurrent reopens of the same reservation by two maître tabs | mitigate | DB UPDATE is atomic on `id`. First reopen flips status to 'waiting'; second reopen's status check fails (current is 'waiting' not 'no_show') → 409. workflow_run_id race is bounded — losing the workflow_run_id of the first start() into garbage if second start happens millisecond-later — but the second start fails gating BEFORE the UPDATE in the service. Acceptable for pilot scale (<20 concurrent). |
| T-03-05-04 | Information Disclosure | history endpoint returns name (PII) | accept | The maître surface needs to identify diners; only `name` is included (no phone/email). Phase 4 PII audit may flag for first-name-only synthetic rendering — defer. |
| T-03-05-05 | Repudiation | who reopened? | mitigate | API logs `employee_email` on success. `reservation_events.payload` contains `run_id` + `prior_status`. Audit trail traceable to maître session. |
| T-03-05-06 | Denial of Service | maître spam-clicks Reabrir | mitigate | Dialog requires Confirmar (single-click). Loading state disables Confirmar during POST. Server idempotency deferred to Phase 4 — but the status check (NOT_IN_NO_SHOW_STATE) provides natural idempotency: only the first reopen succeeds; subsequent ones 409. |
| T-03-05-07 | DoS | polling /api/queue/history every 30s by N maître tabs | accept | At pilot scale (1 maître × 1 tab), <2 req/min. Negligible. Phase 4 may add `If-Modified-Since` if pilot scales; not needed v1. |

No high-severity threats. STAFF-09 ships with a clean audit trail.
</threat_model>

<verification>
- `npm run build` exits 0
- `npm run db:migrate` exits 0; reopen_count column verifiable
- `npx tsx --test __tests__/queue-reopen.test.ts` exits 0 (7 behaviors)
- `npm run smoke:mcp` exits 0 (no Phase 2 regression — the staff API family grew by 1, MCP unaffected)
- All 5 lib/services/queue.ts exports present
- HTTP 409 mapping for NOT_IN_NO_SHOW_STATE confirmed via integration test
- Manual smoke (task 7) confirms 15 scenarios PASS
- `git push origin main` deploys; `/queue/history` accessible in prod
</verification>

<success_criteria>
- 2 of 19 phase requirements ship: STAFF-08, STAFF-09
- Migration 0003 forward-compatible across dev / preview / prod
- Reopen flow works end-to-end with proper audit trail
- No regression to plan 03 or plan 04 contracts
- 17 of 19 phase requirements now shipped (DINER-01..08 + STAFF-02..09 + SAFE-02 + SAFE-03 = 17; remaining: PLAT-08 in plan 06)
</success_criteria>

<output>
After completion, create `.planning/phases/03-user-surfaces/03-05-history-reopen-SUMMARY.md` with:
- Migration 0003 application result + reopen_count default value verification
- 5 service-layer exports listed
- LOC counts per file
- Manual smoke results (15 scenarios PASS/FAIL)
- Production deploy SHA + URL
- Whether `getActiveQueue` projection grew to include `reopen_count` (deviation from "Phase 3 doesn't change Phase 2 contracts" — mark as additive, document)
- D-31 push confirmation
</output>
