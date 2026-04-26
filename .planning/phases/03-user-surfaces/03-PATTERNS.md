# Phase 3: User Surfaces - Pattern Map

**Mapped:** 2026-04-26
**Files analyzed:** 21 new/modified
**Analogs found:** 16 strong / 4 partial / 1 no-analog (NEW patterns)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `app/page.tsx` (REPLACE) | Client component (RSC + island) | streaming + EventSource | `app/queue/page.tsx` (Phase 1 stub) + `RESEARCH.md §Pattern 2` | partial — first useChat consumer |
| `app/api/chat/route.ts` (NEW) | Server route handler | streaming response (POST) | `app/mcp/[transport]/route.ts` (tool wrapping pattern) + `RESEARCH.md §Pattern 1` | role-match — first streamText consumer |
| `app/api/me/route.ts` (NEW) | Server route handler | request-response (GET) | `app/api/queue/route.ts` (auth-gated GET wrapping a service call) | role-match (diner-side, query-param auth) |
| `app/api/queue/history/route.ts` (NEW) | Server route handler | request-response (GET) | `app/api/queue/route.ts` (exact: auth-gated GET wrapping a service call) | exact |
| `app/api/queue/[id]/reopen/route.ts` (NEW) | Server route handler | request-response (POST) | `app/api/queue/[id]/seated/route.ts` (canonical 5–15 LOC wrapper, auth + service dispatch) | exact |
| `app/queue/page.tsx` (REPLACE) | Server component + client island | RSC read + handoff | `app/queue/page.tsx` (Phase 1 stub) + `RESEARCH.md §Pattern 4` | partial — needs island handoff |
| `app/queue/history/page.tsx` (NEW) | Server component | RSC read | `app/queue/page.tsx` (auth + render) | role-match |
| `components/chat/chat-thread.tsx` (NEW) | Client component | render messages array | `components/ui/button.tsx` (cva variant style) | role-match (no chat analog) |
| `components/chat/chat-composer.tsx` (NEW) | Client component | render + form submit | `components/ui/button.tsx` (cva pattern) | role-match (no analog) |
| `components/chat/status-card.tsx` (NEW) | Client component | render snapshot | `components/ui/button.tsx` (cva pattern) | partial (no analog) |
| `components/chat/push-banner.tsx` (NEW) | Client component | render snapshot + ariaLive | `components/ui/button.tsx` (cva pattern) | partial (no analog) |
| `components/chat/quick-reply-chips.tsx` (NEW) | Client component | onClick → sendMessage | `components/ui/button.tsx` (Button variant=outline) | role-match |
| `components/queue/queue-card.tsx` (NEW) | Client component | render row + action handler | `components/ui/button.tsx` + queue snapshot row | role-match |
| `components/queue/queue-grid.tsx` (NEW) | Client component | island wrapping SSE hook | `RESEARCH.md §Pattern 4` example | partial (NEW pattern) |
| `components/queue/connection-dot.tsx` (NEW) | Client component | render readyState | `components/ui/button.tsx` (cva variant pattern) | partial (NEW) |
| `components/queue/nav-bar.tsx` (NEW) | Client component | render Tabs | `components/ui/button.tsx` (variant patterns) | partial (NEW) |
| `components/queue/history-table.tsx` (NEW) | Client component | render rows + action | `components/queue/queue-card.tsx` (sibling) | role-match |
| `components/queue/reopen-dialog.tsx` (NEW) | Client component | AlertDialog open + POST | shadcn AlertDialog primitive + RESEARCH.md | partial (NEW: first AlertDialog) |
| `lib/hooks/use-reservation-events.ts` (NEW) | Custom React hook | EventSource consumer | `app/api/events/[reservation_id]/route.ts` (producer side) + `RESEARCH.md §Pattern 3` | role-match — first browser-side SSE |
| `lib/hooks/use-queue-events.ts` (NEW) | Custom React hook | EventSource consumer | `app/api/events/queue/route.ts` (producer side) + `RESEARCH.md §Pattern 3` | role-match — first browser-side SSE |
| `db/migrations/0003_reopen_count.sql` (NEW) | DB migration | DDL | `db/migrations/0002_workflow_active_hook.sql` (idempotent ALTER ADD COLUMN) | exact |
| `__tests__/chatbot-conversations.fixture.json` (NEW) | Test fixture (JSON) | static fixture | `__tests__/log-redact.test.ts` (node:test via tsx convention) | partial (fixture only, no asserter analog) |
| `lib/services/queue.ts` (MODIFY: add `reopenNoShow`) | Service layer extension | CRUD + workflow start + KV | `lib/services/queue.ts → markCalled` (existing function, exact pattern) | exact |
| `lib/workflows/reservation.ts` (MODIFY: `recompute_eta` body swap) | Workflow step body | LLM-driven recompute (Path C) | `lib/services/reservations.ts → estimateEtaMin` (current formula) + `RESEARCH.md §0 D-20` | partial — first generateText in step |
| `scripts/spike-usechat-lifecycle.ts` (NEW, D-30) | Spike script | one-shot CLI | `scripts/spike-hook-buffering.ts` (top-comment + main + ESM scope guard) | exact |

---

## Pattern Assignments

### `app/api/queue/[id]/reopen/route.ts` (POST staff action wrapper)

**Analog:** `app/api/queue/[id]/seated/route.ts` (lines 1-87, near-identical shape)

**Imports + runtime hints** (lines 10-16):
```typescript
import { auth } from "@/lib/auth/auth";
import { sql } from "@/lib/db/neon";
import { log } from "@/lib/log";
import { markSeated } from "@/lib/services/queue";   // → swap to `reopenNoShow`

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
```

**HTTP-status-code mapper** (lines 18-33) — copy verbatim, add a case for any new error codes (`NOT_IN_NO_SHOW_STATE` likely → 409):
```typescript
function statusForErrorCode(code: string): number {
  switch (code) {
    case "RESERVATION_NOT_FOUND": return 404;
    case "RESERVATION_ALREADY_CLOSED":
    case "NOT_IN_CALLED_STATE":
    case "NOT_IN_WAITING_OR_CALLED_STATE":
    case "MAX_EXTENSIONS_REACHED": return 409;
    case "INVALID_INPUT":
    case "INVALID_SESSION": return 400;
    default: return 500;
  }
}
```

**Auth + dispatch handler** (lines 35-87) — copy structure, swap `markSeated` for `reopenNoShow`, swap `log` event names from `api.queue.seated.*` to `api.queue.reopen.*`:
```typescript
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

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
    return Response.json(result, { status: statusForErrorCode(result.error.code) });
  }
  return Response.json(result);
}
```

---

### `app/api/queue/history/route.ts` (GET history list, auth-gated)

**Analog:** `app/api/queue/route.ts` (lines 1-58, exact shape — also wraps a service call after auth)

**Imports + auth + service dispatch** (lines 16-57):
```typescript
import { auth } from "@/lib/auth/auth";
import { sql } from "@/lib/db/neon";
import { log } from "@/lib/log";
import { getActiveQueue } from "@/lib/services/queue";   // → swap to a new `getHistory()` service

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
    return Response.json(
      { ok: false, error: { code: "FORBIDDEN", message: "Empleado inactivo." } },
      { status: 403 },
    );
  }

  const history = await getHistory();   // implement in lib/services/queue.ts (or inline SQL)

  log.info("api.queue.history.read", {
    employee_email: session.user.email,
    count: history.length,
  });

  return Response.json({ ok: true, data: history });
}
```

**SQL pattern for day-scoped history** (model after `getActiveQueue` in `lib/services/queue.ts` lines 52-78, but invert the WHERE):
```sql
SELECT id, status, name, party_size, eta_min, extension_count, reopen_count,
       created_at::text AS created_at,
       called_at::text AS called_at,
       ended_at::text AS ended_at
FROM reservations
WHERE status IN ('seated', 'no_show', 'cancelled')
  AND DATE(created_at AT TIME ZONE 'America/Argentina/Buenos_Aires') = CURRENT_DATE
ORDER BY ended_at DESC
```

---

### `app/api/me/route.ts` (GET diner status, query-param auth)

**Analog (auth shape):** `app/api/events/[reservation_id]/route.ts` lines 76-98 (`?session_token=` query param + 401 on missing/mismatch)

**Analog (service dispatch shape):** `app/api/queue/route.ts` lines 49-56 (call service, log result, return JSON)

**Auth pattern excerpt** (mirrors `app/api/events/[reservation_id]/route.ts` lines 76-98):
```typescript
const url = new URL(req.url);
const sessionToken = url.searchParams.get("session_token");

if (!sessionToken) {
  log.warn("api.me.unauthorized", { reason: "missing_session_token" });
  return new Response("Unauthorized", { status: 401 });
}

// Service call enforces session resolution + RESERVATION_NOT_FOUND.
const result = await getReservationStatus({ sessionToken });
```

**PII-safe projection** (D-10) — important: do NOT spread `result.data`; project only the columns the status card needs:
```typescript
if (!result.ok) {
  return Response.json(result, { status: result.error.code === "INVALID_SESSION" ? 401 : 404 });
}
return Response.json({
  ok: true,
  data: {
    reservation_id: result.data.reservation_id,
    status: result.data.status,
    position: result.data.position,
    eta_min: result.data.eta_min,
    extension_count: result.data.extension_count,
    no_show_deadline: result.data.no_show_deadline,
    called_at: result.data.called_at,
    // INTENTIONAL omissions: name, email, phone — not needed by the status card
  },
});
```

---

### `app/api/chat/route.ts` (streamText + 4 inline tools)

**Analog (tool-wrap-service-layer pattern):** `app/mcp/[transport]/route.ts` lines 109-211 (the 4 `server.registerTool` calls — same Zod schemas, same service-layer dispatch)

**Analog (route boilerplate):** `app/api/queue/route.ts` lines 21-23 (runtime/dynamic config)

**Working snippet** is the canonical implementation in `RESEARCH.md` lines 387-496 — copy this verbatim, swap any model id changes from CLAUDE.md (`anthropic/claude-sonnet-4.6` DOT not dash), preserve `experimental_telemetry: { recordInputs: false, recordOutputs: false }` (D-23).

**Imports + runtime config** (model after MCP route + RESEARCH.md):
```typescript
import { streamText, tool, stepCountIs, convertToModelMessages, type UIMessage } from "ai";
import { z } from "zod";
import { createReservation, getReservationStatus, extendWait, cancelReservation } from "@/lib/services/reservations";
import { log } from "@/lib/log";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";
```

**Tool wrapper pattern (4×)** — same shape as MCP tools (`app/mcp/[transport]/route.ts` lines 142-156):
```typescript
get_my_status: tool({
  description: "Consultar estado, posición y ETA.",
  inputSchema: z.object({}).passthrough(),   // D-03 — ZERO LLM identity params
  execute: async () => {
    if (!sessionToken) {
      return { ok: false, error: { code: "INVALID_SESSION", message: "No encontré tu reserva. ¿Querés anotarte de nuevo?" } };
    }
    return await getReservationStatus({ sessionToken });
  },
}),
```

**Logging discipline** (D-25) — log tool name + result shape, NOT args:
```typescript
log.info("chat.tool.invoked", { tool: "register_diner" });
const result = await createReservation(input);
log.info("chat.tool.completed", {
  tool: "register_diner",
  ok: result.ok,
  error_code: result.ok ? undefined : result.error.code,
});
```

**Anti-pattern to ban** (from `app/mcp/[transport]/route.ts` line 17 comment — invert):
- ARCHITECTURE Anti-Pattern 1: Do NOT call `experimental_createMCPClient` from this route. Direct service-layer calls only (D-03 + D-36).

---

### `lib/services/queue.ts` — ADD `reopenNoShow` export

**Analog:** `lib/services/queue.ts → markCalled` (lines 106-193) — same 5-step pattern (load → state-check → UPDATE → INSERT event → publish)

**Service signature mirrors siblings** (lines 106-110):
```typescript
export async function reopenNoShow(
  reservationId: string,
): Promise<ServiceResult<QueueMutationData>> {
```

**Load + state-validate** (mirror lines 109-133, but the valid prior state is `'no_show'` not `'waiting'`):
```typescript
const row = await loadReservation(reservationId);
if (!row) {
  log.warn("queue.reopen.not_found", { reservation_id: reservationId });
  return { ok: false, error: { code: "RESERVATION_NOT_FOUND", message: "No encontramos esa reserva." } };
}
if (row.status !== "no_show") {
  log.warn("queue.reopen.bad_state", { reservation_id: reservationId, status: row.status });
  return { ok: false, error: { code: "NOT_IN_NO_SHOW_STATE", message: "Solo se pueden reabrir reservas marcadas como no-show." } };
}
```

**Workflow start (UNIQUE to reopen)** — model after `lib/services/reservations.ts → createReservation` lines 193-205:
```typescript
import { start } from "workflow/api";
import { reservationWorkflow } from "@/lib/workflows/reservation";

const run = await start(reservationWorkflow, [{ reservationId }]);
await sql`
  UPDATE reservations
  SET status = 'waiting',
      ended_at = NULL,
      no_show_deadline = NULL,
      called_at = NULL,
      reopen_count = reopen_count + 1,
      workflow_run_id = ${run.runId},
      active_hook_token = ${`reservation:${reservationId}:waiting`},
      updated_at = NOW()
  WHERE id = ${reservationId}
`;
```

**Insert audit event + publish** (mirror lines 152-185, swap event_type to `'reopened'`):
```typescript
const insertedEvent = (await sql`
  INSERT INTO reservation_events (reservation_id, event_type, payload)
  VALUES (
    ${reservationId},
    'reopened',
    ${JSON.stringify({ occurred_at: occurredAt, prior_status: 'no_show' })}::jsonb
  )
  RETURNING id
`) as Array<{ id: number }>;

await publishReservationEvent(reservationId, {
  id: insertedEvent[0].id,
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
```

**Note (deviation from `markCalled`):** No `safeResumeHook` call — the prior workflow has terminated, so there is no live hook to resume. The fresh `start()` is the entire control-flow handover. Document inline.

---

### `db/migrations/0003_reopen_count.sql`

**Analog:** `db/migrations/0002_workflow_active_hook.sql` (lines 1-9) — exact: top comment block + idempotent `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`

**Pattern (copy verbatim, edit column):**
```sql
-- Phase 3 — Plan (D-16)
-- Add reopen_count column for STAFF-09 undo-no-show audit trail.
-- The reopen flow is a wrapper around start(reservationWorkflow,...)
-- + UPDATE reservations SET status='waiting', reopen_count = reopen_count + 1.
-- Idempotent: ADD COLUMN IF NOT EXISTS allows safe re-application.
-- No backfill needed — production reservations table is empty pre-pilot.

ALTER TABLE reservations
  ADD COLUMN IF NOT EXISTS reopen_count INTEGER NOT NULL DEFAULT 0;
```

---

### `app/queue/page.tsx` (REPLACE Phase 1 stub — Server Component + client island)

**Analog (current shape):** `app/queue/page.tsx` (Phase 1 stub, lines 1-18 — `auth()` + `redirect("/login")` shell)

**Analog (target shape):** `RESEARCH.md §Pattern 4` example (lines 700-734)

**Bones to preserve from Phase 1 stub:**
```typescript
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/auth";

export default async function QueuePage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }
  // ... new content below
}
```

**Add defense-in-depth `employees.active` re-check** (mirror `app/api/events/queue/route.ts` lines 58-65):
```typescript
import { sql } from "@/lib/db/neon";

const empRows = (await sql`
  SELECT active FROM employees WHERE email = ${session.user.email} LIMIT 1
`) as Array<{ active: boolean }>;
if (empRows.length === 0 || !empRows[0].active) redirect("/login");
```

**Add SSR snapshot via service layer** (mirror `app/api/queue/route.ts` line 49):
```typescript
import { getActiveQueue } from "@/lib/services/queue";
import { getTypedConfig } from "@/lib/edge-config";

const initial = await getActiveQueue();
const colorsByPartySize = await getTypedConfig<Record<string, string>>(
  "colors_by_party_size",
  { "1-2": "#A8E6CF", "3-4": "#FFD3B6", "5-6": "#FFAAA5", "7+": "#D5AAFF" },
);
```

**Hand off to client island:**
```typescript
return <QueueGrid initial={initial} colorsByPartySize={colorsByPartySize} />;
```

---

### `app/queue/history/page.tsx`

**Analog:** Same shape as `app/queue/page.tsx` (Phase 1 stub) — auth + employees gate + render.

**Differences from `/queue`:** No SSE; instead the `<HistoryTable />` client island polls `/api/queue/history` every 30s (D-17). Pre-fetch initial rows server-side (call `getHistory()` directly) to avoid loading-skeleton flash.

---

### `lib/hooks/use-reservation-events.ts` + `use-queue-events.ts`

**Analog (server side it consumes):** `app/api/events/[reservation_id]/route.ts` lines 161-269 (snapshot event name `"snapshot"`, typed events `reservation.created/.called/.extended/.seated/.cancelled/.no_show`, heartbeat as `: hb`)

**Working snippet:** `RESEARCH.md §Pattern 3` lines 583-678 — copy verbatim. Key invariants:
- Browser native `EventSource` handles `Last-Event-ID` automatically — don't manually set headers
- Auth via query param ONLY (`?session_token=X`) — `EventSource` does NOT support custom headers
- `failureCountRef.current >= 3` → `connection = "failed"` (matches D-19 + UI-SPEC connection-dot)
- `es.close()` on terminal status (`seated|no_show|cancelled`)

**Server-emitted event names to listen for** (extract from `app/api/events/[reservation_id]/route.ts` line 161 + lines 220-229):
- `snapshot` (initial, with `reservation_id`, `status`, `position`, `eta_min`, `extension_count`, `last_event_id`)
- `reservation.created`, `reservation.called`, `reservation.extended`, `reservation.seated`, `reservation.cancelled`, `reservation.no_show`
- `reservation.workflow_called`, `reservation.followup`, `reservation.workflow_no_show` (workflow-driven — `lib/workflows/reservation.ts` lines 264-272, 309-315)

**For the queue hook:** `app/api/events/queue/route.ts` line 148 publishes to channel `queue:active` and emits the snapshot as `{ reservations: queue, last_event_id }` — the hook returns `reservations` array, not a single `snapshot`.

---

### `lib/workflows/reservation.ts` — `recompute_eta` step BODY swap (Path C)

**Analog:** `lib/services/reservations.ts → estimateEtaMin` lines 117-123 (current deterministic formula)

**FREEZE rule (D-11):** Only the body of an existing step may change. The step boundary (`"use step"` async function) and the call site in the workflow router stay identical. No new steps. No reorder.

**Working snippet** is `CONTEXT.md D-20` (Path C):
```typescript
import { generateText } from "ai";

const { text } = await generateText({
  model: "anthropic/claude-sonnet-4.6",
  temperature: 0,
  system: "You are an ETA estimator. Return ONLY an integer minute count.",
  prompt: `Position ${position}, party size ${partySize}, avg turnover ${avgTurnoverMin}min. Estimate wait in minutes.`,
});
const etaMin = Number.parseInt(text.trim(), 10);
```

**D-22 invariants the body MUST preserve:**
- `temperature: 0` (replay determinism)
- The step's RETURN VALUE (`{ eta_min: number }`) is what gets persisted in the workflow event log; on replay, the LLM is NOT re-called
- Wrap in try/catch + fallback to `position * avgTurnoverMin` (D-20.1 Path D) if `Number.parseInt(text.trim(), 10)` is `NaN`

**Where the step lives in the workflow router** (currently — Phase 2 ships only the formula at `lib/services/reservations.ts → estimateEtaMin`; the step shell does not yet exist in `lib/workflows/reservation.ts`. Phase 3 plan-phase agent should confirm whether this step exists or needs to be created — `02-CONTEXT.md` D-32 / Claude's discretion at end may have shipped it as a placeholder. Grep for "recompute" in `lib/workflows/reservation.ts` first; if absent, this becomes a Path E discussion.):
```bash
grep -n "recompute\|eta_min" lib/workflows/reservation.ts
```

---

### `__tests__/chatbot-conversations.fixture.json` + asserter

**Analog (test file convention):** `__tests__/log-redact.test.ts` lines 1-11 — `describe`/`it` from `node:test`, run via `npx tsx --test`. Per `02-CONTEXT.md` D-23 / D-29: stick with this stack, no Jest/Vitest.

**Imports pattern** (file header):
```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fixtures from "./chatbot-conversations.fixture.json";
```

**Assertion pattern** (model after `__tests__/log-redact.test.ts` lines 12-20):
```typescript
describe("chatbot conversation fixtures", () => {
  for (const conv of fixtures.conversations) {
    it(`${conv.id}: ${conv.label}`, () => {
      // Assert SHAPE of expected tool calls — NOT live LLM output (D-30 deterministic)
      assert.deepEqual(conv.expected_tool_calls, /* schema validation */);
    });
  }
});
```

**Fixture JSON shape** (10 cases per D-04 Rule 4 + D-30):
```json
{
  "conversations": [
    {
      "id": "ambiguous-party",
      "label": "diner says 'somos 4 o 5'",
      "user_messages": ["hola, somos 4 o 5"],
      "expected_tool_calls": [],
      "expected_clarification": true
    },
    { "id": "future-booking", "label": "diner says 'para mañana a las 8'", ... },
    { "id": "off-topic", "label": "diner asks 'qué hora es?'", ... },
    { "id": "tal-vez-bebe", ... },
    { "id": "valid-registration", ... }
  ]
}
```

---

### `scripts/spike-usechat-lifecycle.ts` (D-30, 2h cap)

**Analog:** `scripts/spike-hook-buffering.ts` lines 1-56 (exact: top-comment with QUESTION/WHY/METHODOLOGY/DECISION + `main` + ESM scope guard)

**Header comment shape:**
```typescript
// Spike (D-30): AI SDK v6 useChat lifecycle assertions.
//
// QUESTION: Does `messages[].parts[type === "tool-register_diner"]`
//   surface `state === "output-available"` with `output.ok === true` and
//   `output.data.reservation_id` readable in client state?
// METHODOLOGY: Mock /api/chat with a fake service-layer that returns
//   {ok:true, data:{reservation_id:"r-1", session_token:"s-2"}}.
//   Walk 3 conversations end-to-end. Assert tool-result parts are
//   readable from useChat state.
// DECISION (recorded after run): [...]
//
// Cap: 2h. If v6 footgun is found, update D-04/D-08 BEFORE Phase 3 codes.
```

**ESM scope guard** (lines 53-55 — copy verbatim to prevent TS duplicate-symbol clashes):
```typescript
export {};
```

---

### Components in `components/chat/*` and `components/queue/*`

**Analog (the only existing reusable component):** `components/ui/button.tsx` lines 1-58 — note the project uses `@base-ui/react/button`, `cva` for variants, `cn(...)` from `@/lib/utils`. Phase 3 components follow this style.

**Variant pattern (cva) for status pills, party-size badges, connection-dot:**
```typescript
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const statusPillVariants = cva("inline-flex items-center px-2 py-0.5 rounded-full text-xs", {
  variants: {
    status: {
      waiting: "bg-blue-100 text-blue-700",
      called: "bg-amber-100 text-amber-700",
      seated: "bg-green-100 text-green-700",
      no_show: "bg-red-100 text-red-700",
      cancelled: "bg-gray-100 text-gray-500",
    },
  },
});
```

**Aria-live for `push-banner.tsx`** — UI-SPEC contract requires `aria-live="assertive"`:
```tsx
<div role="status" aria-live="assertive" className={cn(...)}>...</div>
```

---

## Shared Patterns

### Auth gate (server side — staff routes + RSC pages)

**Source:** `app/api/queue/[id]/seated/route.ts` lines 41-67 (canonical 5-15 LOC pattern)

**Apply to:** `app/api/queue/[id]/reopen/route.ts`, `app/api/queue/history/route.ts`, `app/queue/page.tsx`, `app/queue/history/page.tsx`

```typescript
const session = await auth();
if (!session?.user?.email) {
  return Response.json(
    { ok: false, error: { code: "UNAUTHORIZED", message: "No autorizado." } },
    { status: 401 },
  );
}
const empRows = (await sql`
  SELECT active FROM employees WHERE email = ${session.user.email} LIMIT 1
`) as Array<{ active: boolean }>;
if (empRows.length === 0 || !empRows[0].active) {
  return Response.json(
    { ok: false, error: { code: "FORBIDDEN", message: "Empleado inactivo." } },
    { status: 403 },
  );
}
```

**Note:** Phase 1 D-12 already established that the v5 session shape exposes `user.email` (NOT `user.id`). Match by email — see `lib/auth/auth.ts` lines 42-51.

### Diner-side auth (query-param `session_token`)

**Source:** `app/api/events/[reservation_id]/route.ts` lines 76-98

**Apply to:** `app/api/me/route.ts`, `lib/hooks/use-reservation-events.ts` (client side passing the token)

```typescript
const url = new URL(req.url);
const sessionToken = url.searchParams.get("session_token");
if (!sessionToken) return new Response("Unauthorized", { status: 401 });

// Validate the token by joining on reservations row OR by passing through to a
// service function that does the same — service layer enforces single 401 shape.
```

### Service-layer dispatch (Pattern 1 — ARCHITECTURE)

**Source:** `app/api/queue/[id]/seated/route.ts` lines 75-90

**Apply to:** Every route handler in Phase 3.

```typescript
const result = await markSeated(id);
if (!result.ok) {
  log.warn("api.queue.X.service_error", { reservation_id: id, code: result.error.code });
  return Response.json(result, { status: statusForErrorCode(result.error.code) });
}
return Response.json(result);
```

**Anti-pattern:** No `experimental_createMCPClient`. No HTTP self-call. No inline SQL outside service-layer. (`app/mcp/[transport]/route.ts` line 17 documents this rule.)

### PII-safe logging

**Source:** `lib/log.ts` lines 126-158 (the `log.{info,warn,error}` API)

**Apply to:** Every server file. Never `console.log`.

**Special D-25 rule for chat tool-call lifecycle:** Log tool name + ok/error_code only. NEVER log `input`, `args`, or `result.data`:
```typescript
// CORRECT
log.info("chat.tool.invoked", { tool: "register_diner" });
log.info("chat.tool.completed", { tool: "register_diner", ok: result.ok, error_code: result.ok ? undefined : result.error.code });

// WRONG — leaks PII to Vercel logs
log.info("chat.tool.invoked", { tool: "register_diner", input });
```

### KV publish discipline

**Source:** `lib/realtime.ts` lines 31-51 (`publishReservationEvent` + `publishQueueEvent`)

**Apply to:** `lib/services/queue.ts → reopenNoShow` only (the new service function). SSE handlers and route handlers must NEVER `redis.publish` directly.

### Snapshot-replay-on-connect (server side it consumes)

**Source:** `app/api/events/[reservation_id]/route.ts` lines 130-210 (snapshot → gap-recover via Last-Event-ID → subscribe)

**Apply to:** Phase 3 hooks consume this contract — `lib/hooks/use-reservation-events.ts` listens for the `snapshot` event first, then typed events. Browser handles `Last-Event-ID` automatically (no manual reconnect).

### Idempotent migration shape

**Source:** `db/migrations/0002_workflow_active_hook.sql` lines 1-9

**Apply to:** `db/migrations/0003_reopen_count.sql` — header comment + `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`.

### shadcn-component variant style

**Source:** `components/ui/button.tsx` lines 1-58 (cva + `class-variance-authority` + `cn` from `@/lib/utils`)

**Apply to:** All custom components in `components/chat/*` and `components/queue/*` that have multiple visual states (status pills, connection dot color states, party-size chip).

### node:test via tsx

**Source:** `__tests__/log-redact.test.ts` lines 1-11

**Apply to:** Any new asserter (e.g., the `chatbot-conversations.fixture.json` runner). Run via `npx tsx --test __tests__/...`. Per `02-CONTEXT.md` D-23 / D-29 stack lock: no Jest, no Vitest.

### Spike script convention

**Source:** `scripts/spike-hook-buffering.ts` lines 1-56

**Apply to:** `scripts/spike-usechat-lifecycle.ts` (D-30) — top comment with QUESTION/METHODOLOGY/DECISION, `main()` async + try/catch, `export {};` ESM scope guard at end.

---

## No Analog Found (NEW patterns Phase 3 introduces)

Files where there is NO Phase 1/2 codebase analog. Planner should rely on `RESEARCH.md` snippets directly:

| Pattern | First file in project | Reference |
|---------|----------------------|-----------|
| `useChat` v6 client hook (chat lifecycle, `messages[].parts[type==="tool-${name}"]`) | `app/page.tsx` | `RESEARCH.md` §Pattern 2 lines 509-565 |
| `streamText` server route + 4 inline `tool({execute})` wrappers | `app/api/chat/route.ts` | `RESEARCH.md` §Pattern 1 lines 387-496 |
| Browser-side `EventSource` consumer with reconnect tracking | `lib/hooks/use-reservation-events.ts`, `lib/hooks/use-queue-events.ts` | `RESEARCH.md` §Pattern 3 lines 583-678 + MDN EventSource (cited) |
| `generateText` from `ai` inside a `"use step"` workflow function | `lib/workflows/reservation.ts → recompute_eta` body | `CONTEXT.md` D-20 (Path C) + RESEARCH.md §0 |
| shadcn `AlertDialog` confirmation flow | `components/queue/reopen-dialog.tsx` | shadcn registry — `npx shadcn add alert-dialog` |
| shadcn `Sonner` toast | `components/queue/queue-grid.tsx` action error handler | shadcn registry — `npx shadcn add sonner`; mount once at app root |
| `experimental_telemetry` config in AI SDK | `app/api/chat/route.ts` | `CONTEXT.md` D-23 + RESEARCH.md §Pattern 1 |
| `DefaultChatTransport` with dynamic headers function | `app/page.tsx` | `RESEARCH.md` §Pattern 2 lines 528-535 |

For each of the above, the planner should reference RESEARCH.md line ranges directly in the plan's actions section — there is no Phase 1/2 file to copy from.

---

## Metadata

**Analog search scope:** `app/`, `lib/`, `components/`, `db/`, `__tests__/`, `scripts/`
**Files scanned:** ~25 (full file inventory above; nothing skipped — project is pre-pilot small)
**Pattern extraction date:** 2026-04-26
**Workflow-step freeze status (D-11):** Acknowledged. Phase 3 changes only the BODY of `recompute_eta` (Path C). No step add / remove / reorder.
**Project conventions verified:**
- Next.js 16 + `proxy.ts` (NOT `middleware.ts`) — `proxy.ts` lines 1-15
- AI SDK model id format: `anthropic/claude-sonnet-4.6` (DOT) per CLAUDE.md
- `node:test` via `tsx` for tests (no Jest/Vitest)
- PII-redacted logging via `lib/log.ts` only — no raw `console.*`
- Service-layer funnel: routes are 5–15 LOC wrappers around `lib/services/*`
- Zod `.passthrough()` (not `.strict()`); `z.coerce.number()` for numerics
