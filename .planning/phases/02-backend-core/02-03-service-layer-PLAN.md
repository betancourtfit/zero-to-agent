---
phase: 02-backend-core
plan: 03
type: execute
wave: 1
depends_on:
  - "02-01-spikes-skew"
  - "02-02-log-redactor"
files_modified:
  - lib/services/reservations.ts
  - lib/services/queue.ts
  - lib/realtime.ts
  - db/migrations/0002_workflow_active_hook.sql
  - scripts/db-migrate.ts (unchanged — handles 0002 automatically)
  - package.json (scripts: seed:demo, smoke:mcp, smoke:money-shot)
autonomous: true
requirements:
  - PLAT-01
  - PLAT-03
  - PLAT-04
  - PLAT-05
  - DEMO-04

must_haves:
  truths:
    - "lib/services/reservations.ts exports createReservation, getReservationStatus, extendWait, cancelReservation"
    - "lib/services/queue.ts exports getActiveQueue, markCalled, markSeated"
    - "lib/realtime.ts exports publishReservationEvent, publishQueueEvent using Redis.fromEnv()"
    - "db/migrations/0002_workflow_active_hook.sql adds active_hook_token TEXT NULL"
    - "Service layer uses lib/db/neon.ts (HTTP), NOT lib/db/pool.ts"
    - "All service functions use log.* from lib/log.ts — no raw console.*"
    - "All service functions validate input with Zod .passthrough() — no .strict()"
    - "DB-backed safety net (D-10) implemented: INSERT reservation_events BEFORE resumeHook"
  artifacts:
    - path: "lib/services/reservations.ts"
      provides: "Diner-facing reservation CRUD + workflow orchestration"
      exports: ["createReservation", "getReservationStatus", "extendWait", "cancelReservation"]
    - path: "lib/services/queue.ts"
      provides: "Staff-facing queue operations"
      exports: ["getActiveQueue", "markCalled", "markSeated"]
    - path: "lib/realtime.ts"
      provides: "KV pub/sub publisher — service layer wraps this, NEVER calls redis.publish directly"
      exports: ["publishReservationEvent", "publishQueueEvent"]
    - path: "db/migrations/0002_workflow_active_hook.sql"
      provides: "Schema addition for active_hook_token column"
      contains: "active_hook_token TEXT NULL"

---

<objective>
Create the service layer (`lib/services/reservations.ts`, `lib/services/queue.ts`), the KV pub/sub publisher (`lib/realtime.ts`), and the Phase 2 schema migration (`0002_workflow_active_hook.sql`). This is the core business logic that everything else (MCP tools, staff API endpoints, SSE handlers) wraps around.

Purpose: PLAT-01, PLAT-03, PLAT-04, PLAT-05 — the service layer IS the public durable backend. Every mutational path funnels through here. The DB-backed safety net (D-10) is implemented here: persist event to `reservation_events` BEFORE calling `resumeHook`.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/STATE.md
@.planning/phases/02-backend-core/02-CONTEXT.md
@.planning/phases/02-backend-core/02-RESEARCH.md
@.planning/phases/01-foundation/01-CONTEXT.md
@.planning/phases/01-foundation/01-03-db-migrations-seed-SUMMARY.md
@.planning/research/STACK.md
@.planning/research/PITFALLS.md
@.planning/research/ARCHITECTURE.md
@CLAUDE.md

<interfaces>
From 02-CONTEXT.md D-18 — service layer file structure:
```
lib/services/reservations.ts — exports createReservation, getReservationStatus, extendWait, cancelReservation
lib/services/queue.ts — exports getActiveQueue, markCalled, markSeated
```

From 02-CONTEXT.md D-19 — DB client discipline:
- Service layer uses `lib/db/neon.ts` (HTTP, pooled) — NOT `lib/db/pool.ts`
- `lib/db/pool.ts` is for `@auth/pg-adapter` only

From 02-CONTEXT.md D-20 — KV publisher:
```typescript
// lib/realtime.ts
import { Redis } from "@upstash/redis";

const redis = Redis.fromEnv();

export async function publishReservationEvent(id: string, event: { type: string; ... }) {
  await redis.publish(`reservation:${id}`, JSON.stringify(event));
}

export async function publishQueueEvent(event: { reservation_id: string; ... }) {
  await redis.publish("queue:active", JSON.stringify(event));
}
```

From 02-CONTEXT.md D-10 — DB-backed safety net pattern:
```
Every staff/diner action that triggers a workflow event:
1. INSERT INTO reservation_events(reservation_id, event_type, payload)
2. await resumeHook(token, payload)

Workflow timeout branches re-query reservation_events for missed events.
```

From 02-CONTEXT.md D-05 — Zod usage discipline:
- `.passthrough()` on every object schema
- `.coerce.number()` on numerics
- `.refine()` and `.default()` FORBIDDEN at top-level inputSchema
- Use `safeParse` (not `parse`) and on validation failure return structured error

From 02-CONTEXT.md D-02 — create_reservation input schema:
```typescript
z.object({
  name: z.string().min(1),
  email: z.string().email(),
  phone: z.string().min(5),
  party_size: z.coerce.number().int().min(1).max(20),
}).passthrough()
```

From 02-CONTEXT.md D-04 — tool error contract (structured JSON):
```typescript
{ ok: false, error: { code: "STRING_CODE", message: "Spanish-friendly user message", fields?: {...} } }
```

From 02-CONTEXT.md D-09 — migration:
```sql
-- db/migrations/0002_workflow_active_hook.sql
ALTER TABLE reservations ADD COLUMN active_hook_token TEXT NULL;
-- No backfill needed — empty reservations table at end of Phase 1
```

From 02-CONTEXT.md D-32 — seed-demo strategy:
```typescript
// scripts/seed-demo.ts
// 3 reservations via REAL createReservation()
// Advance 2 via internal hook resumes:
// - Reservation A: fresh waiting
// - Reservation B: advanced to called
// - Reservation C: advanced to seated
// Names: Demo Comensal 1/2/3, +540000000001..3, demoN@example.test
// Idempotent: ON CONFLICT DO UPDATE on email
```

From 02-CONTEXT.md D-24 — KV channel naming:
- `reservation:<uuid>` — per-reservation events
- `queue:active` — fan-out for staff panel
- Payload: `{ id, type, reservation_id, occurred_at, ...event_specific_fields }`

From 02-CONTEXT.md D-14 — compensating action on workflow.start failure:
```
UPDATE reservations SET status='failed_to_start' WHERE id=$1
Re-throws. DB row left in place for forensic audit.
```

From 02-CONTEXT.md D-21 — PII redactor:
- Every service function uses `log.*` from `lib/log.ts`
- No raw `console.*` calls
- `log.info("reservation.create.start", { reservation_id, party_size })` — PII masked by redactPII
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Create db/migrations/0002_workflow_active_hook.sql</name>
  <files>db/migrations/0002_workflow_active_hook.sql</files>
  <read_first>
    - .planning/phases/02-backend-core/02-CONTEXT.md D-09 (active_hook_token column)
    - .planning/phases/01-foundation/01-03-db-migrations-seed-SUMMARY.md (migration runner pattern)
    - .planning/phases/01-foundation/01-PATTERNS.md (forward-only migration discipline)
  </read_first>
  <action>
    1. Create `db/migrations/0002_workflow_active_hook.sql`:
       ```sql
       -- Phase 2: Add active_hook_token column for workflow hook resumption
       -- Staff API endpoints read this column to know which token to pass to resumeHook
       -- No backfill needed — empty reservations table at end of Phase 1
       ALTER TABLE reservations ADD COLUMN active_hook_token TEXT NULL;
       ```
    2. Run migration: `npm run db:migrate` — should show `[applied] 0002_workflow_active_hook.sql`
    3. Verify: `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'reservations' AND column_name = 'active_hook_token';` — should return `active_hook_token | TEXT`
  </action>
  <verify>
    <automated>npm run db:migrate 2>&1 | grep -q 'applied.*0002' && psql "$DATABASE_URL_UNPOOLED" -c "SELECT column_name FROM information_schema.columns WHERE table_name = 'reservations' AND column_name = 'active_hook_token';" 2>&1 | grep -q 'active_hook_token'</automated>
  </verify>
  <acceptance_criteria>
    - `db/migrations/0002_workflow_active_hook.sql` exists with `ALTER TABLE reservations ADD COLUMN active_hook_token TEXT NULL`
    - Migration applies cleanly via `npm run db:migrate`
    - Column exists in the database (verified via information_schema)
    - Second run shows `[skip] 0002_workflow_active_hook.sql` (idempotent)
  </acceptance_criteria>
  <done>
    `0002_workflow_active_hook.sql` migration applied. `reservations.active_hook_token TEXT NULL` column available for workflow hook management.
  </done>
</task>

<task type="auto">
  <name>Task 2: Create lib/realtime.ts — KV pub/sub publisher</name>
  <files>lib/realtime.ts</files>
  <read_first>
    - .planning/phases/02-backend-core/02-CONTEXT.md D-20 (KV publisher pattern)
    - .planning/phases/02-backend-core/02-CONTEXT.md D-24 (channel naming: reservation:<uuid>, queue:active)
    - .planning/phases/02-backend-core/02-CONTEXT.md D-25 (payload shape: { id, type, reservation_id, occurred_at, ... })
    - .planning/phases/01-foundation/01-02-edge-config-kv-SUMMARY.md (smoke test pattern with Redis.fromEnv())
  </read_first>
  <action>
    1. Create `lib/realtime.ts`:
       ```typescript
       // lib/realtime.ts
       // KV pub/sub publisher — service layer wraps this, NEVER calls redis.publish directly.
       // Subscription is ONLY in SSE Route Handlers, never in service functions or workflow steps.

       import { Redis } from "@upstash/redis";
       import { log } from "@/lib/log";

       const redis = Redis.fromEnv();

       export async function publishReservationEvent(reservationId: string, event: {
         id?: number;
         type: string;
         reservation_id: string;
         occurred_at: string;
         [key: string]: unknown;
       }): Promise<void> {
         const payload = {
           id: event.id,
           type: event.type,
           reservation_id: event.reservation_id,
           occurred_at: event.occurred_at,
           ...event,
         };
         await redis.publish(`reservation:${reservationId}`, JSON.stringify(payload));
         log.info("realtime.publish.reservation", { reservation_id: event.reservation_id, event_type: event.type });
       }

       export async function publishQueueEvent(event: {
         reservation_id: string;
         type: string;
         occurred_at: string;
         [key: string]: unknown;
       }): Promise<void> {
         const payload = {
           reservation_id: event.reservation_id,
           type: event.type,
           occurred_at: event.occurred_at,
           ...event,
         };
         await redis.publish("queue:active", JSON.stringify(payload));
         log.info("realtime.publish.queue", { reservation_id: event.reservation_id, event_type: event.type });
       }
       ```
    2. Run KV smoke test to verify Redis is still working: `npm run smoke:kv`
    3. Verify: `npm run smoke:kv` outputs `KV smoke test passed`
  </action>
  <verify>
    <automated>test -f lib/realtime.ts && grep -q 'publishReservationEvent' lib/realtime.ts && grep -q 'publishQueueEvent' lib/realtime.ts && grep -q 'Redis.fromEnv' lib/realtime.ts && npm run smoke:kv 2>&1 | grep -q 'smoke test passed'</automated>
  </verify>
  <acceptance_criteria>
    - `lib/realtime.ts` exports `publishReservationEvent(reservationId, event)`
    - `lib/realtime.ts` exports `publishQueueEvent(event)`
    - Both use `Redis.fromEnv()` (matches Phase 1 smoke test pattern)
    - Channel naming: `reservation:<uuid>` and `queue:active`
    - Payload shape includes `id`, `type`, `reservation_id`, `occurred_at`
    - KV smoke test still passes (`npm run smoke:kv`)
  </acceptance_criteria>
  <done>
    `lib/realtime.ts` is the KV pub/sub publisher. Service layer and workflow steps call these helpers — they NEVER call `redis.publish` directly.
  </done>
</task>

<task type="auto">
  <name>Task 3: Create lib/services/reservations.ts — diner-facing reservation CRUD</name>
  <files>lib/services/reservations.ts</files>
  <read_first>
    - .planning/phases/02-backend-core/02-CONTEXT.md D-18 (two-file service layer)
    - .planning/phases/02-backend-core/02-CONTEXT.md D-02 (create_reservation input schema)
    - .planning/phases/02-backend-core/02-CONTEXT.md D-04 (error contract)
    - .planning/phases/02-backend-core/02-CONTEXT.md D-05 (Zod discipline: .passthrough(), .coerce.number(), safeParse)
    - .planning/phases/02-backend-core/02-CONTEXT.md D-10 (DB-backed safety net)
    - .planning/phases/02-backend-core/02-CONTEXT.md D-14 (compensating action on workflow.start failure)
    - .planning/phases/02-backend-core/02-CONTEXT.md D-19 (uses lib/db/neon.ts, NOT lib/db/pool.ts)
    - .planning/phases/02-backend-core/02-CONTEXT.md D-21 (uses log.* from lib/log.ts)
    - .planning/research/ARCHITECTURE.md Pattern 1 (service-layer funnel)
  </read_first>
  <action>
    1. Create `lib/services/reservations.ts` with the following functions:

       **createReservation(input)** — validates input with Zod, inserts reservation row, starts WDK workflow:
       - Input schema: `{ name, email, phone, party_size }` with `.passthrough()`
       - Validates with `safeParse`, returns `INVALID_INPUT` error on failure
       - Inserts into `reservations` table with status `waiting`, generates `session_token UUID`
       - Writes `active_hook_token = 'reservation:<id>:waiting'`
       - Starts WDK workflow: `await start("reservation-workflow", { input: { reservationId: id } })`
       - On `workflow.start` failure: compensating action — `UPDATE reservations SET status='failed_to_start' WHERE id=$1`
       - Publishes KV events: `reservation:<id>` + `queue:active`
       - Returns: `{ ok: true, data: { reservation_id, session_token, position, eta_min } }`

       **getReservationStatus({ sessionToken })** — resolves reservation from session_token, returns status:
       - Looks up `SELECT * FROM reservations WHERE session_token = $1`
       - Returns: `{ ok: true, data: { id, status, position, eta_min, extension_count, no_show_deadline, called_at } }`
       - If not found: `{ ok: false, error: { code: "RESERVATION_NOT_FOUND", message: "..." } }`

       **extendWait({ sessionToken })** — extends no_show_deadline for a called reservation:
       - Resolves reservation from `session_token`
       - Checks `extension_count < max_extensions_per_ticket` (from Edge Config)
       - Checks status is `called` (NOT_IN_CALLED_STATE error if not)
       - Updates `extension_count += 1`, extends `no_show_deadline` by `extension_min` from Edge Config
       - Writes `reservation_events(event_type='extend_requested')`
       - Resumes hook: `await resumeHook(active_hook_token, { type: 'extend' })`
       - Returns: `{ ok: true, data: { reservation_id, new_deadline } }`

       **cancelReservation({ sessionToken })** — cancels a waiting or called reservation:
       - Resolves reservation from `session_token`
       - Checks status is `waiting` or `called` (NOT_IN_WAITING_OR_CALLED_STATE if not)
       - Updates status to `cancelled`
       - Writes `reservation_events(event_type='cancel_requested')`
       - Resumes hook: `await resumeHook(active_hook_token, { type: 'cancel' })`
       - Publishes KV events
       - Returns: `{ ok: true, data: { reservation_id } }`

    2. All functions:
       - Use `log.*` from `@/lib/log` — no raw `console.*`
       - Use `sql` from `@/lib/db/neon` (HTTP client)
       - Use `safeParse` with Zod (never `parse`)
       - Return structured JSON: `{ ok: boolean, data?: object, error?: { code, message, fields? } }`
       - Convert `TIMESTAMPTZ` to ISO strings before returning (D-12 serialization contract)
  </action>
  <verify>
    <automated>test -f lib/services/reservations.ts && grep -q 'export.*createReservation' lib/services/reservations.ts && grep -q 'export.*getReservationStatus' lib/services/reservations.ts && grep -q 'export.*extendWait' lib/services/reservations.ts && grep -q 'export.*cancelReservation' lib/services/reservations.ts && grep -q 'import.*from "@/lib/db/neon"' lib/services/reservations.ts && grep -q 'import.*from "@/lib/log"' lib/services/reservations.ts && grep -q 'safeParse' lib/services/reservations.ts && grep -q 'reservation_events' lib/services/reservations.ts</automated>
  </verify>
  <acceptance_criteria>
    - `lib/services/reservations.ts` exports 4 functions: `createReservation`, `getReservationStatus`, `extendWait`, `cancelReservation`
    - `createReservation` validates with Zod `.passthrough()`, uses `safeParse`, inserts row, starts workflow
    - `createReservation` has compensating action on `workflow.start` failure (D-14)
    - `extendWait` checks `extension_count < max_extensions_per_ticket` from Edge Config
    - `cancelReservation` checks status is `waiting` or `called`
    - All functions use `log.*` — no raw `console.*`
    - All functions use `sql` from `@/lib/db/neon` (NOT pool.ts)
    - All functions use `safeParse` (never `parse`)
    - DB-backed safety net: `INSERT reservation_events` BEFORE `resumeHook`
    - Returns structured JSON: `{ ok, data?, error? }`
  </acceptance_criteria>
  <done>
    `lib/services/reservations.ts` is the diner-facing service layer. All 4 reservation lifecycle functions implemented with Zod validation, structured error contracts, PII-safe logging, and DB-backed safety net.
  </done>
</task>

<task type="auto">
  <name>Task 4: Create lib/services/queue.ts — staff-facing queue operations</name>
  <files>lib/services/queue.ts</files>
  <read_first>
    - .planning/phases/02-backend-core/02-CONTEXT.md D-18 (queue.ts exports)
    - .planning/phases/02-backend-core/02-CONTEXT.md D-30 (staff action API endpoints pattern)
    - .planning/phases/02-backend-core/02-CONTEXT.md D-10 (DB-backed safety net)
    - .planning/phases/02-backend-core/02-CONTEXT.md D-29 (staff SSE auth: auth() + employees.active gate)
  </read_first>
  <action>
    1. Create `lib/services/queue.ts` with the following functions:

       **getActiveQueue()** — returns active (non-closed) reservations:
       - `SELECT * FROM reservations WHERE status NOT IN ('seated', 'no_show', 'cancelled', 'failed_to_start') ORDER BY created_at ASC`
       - Returns array of reservation summaries (position, eta_min, status, etc.)
       - Used by Phase 3 staff panel AND Phase 2 staff action API endpoints

       **markCalled(reservationId)** — advances reservation from `waiting` to `called`:
       - Resolves reservation by `id`
       - Checks status is `waiting`
       - Updates status to `called`, sets `called_at = NOW()`
       - Sets `active_hook_token = 'reservation:<id>:called:pre'`
       - Writes `reservation_events(event_type='call_requested')`
       - Resumes hook: `await resumeHook('reservation:<id>:waiting', { type: 'call' })`
       - Publishes KV events: `reservation:<id>` + `queue:active`
       - Returns: `{ ok: true, data: { reservation_id, new_status: 'called' } }`

       **markSeated(reservationId)** — closes reservation as `seated`:
       - Resolves reservation by `id`
       - Checks status is `called`
       - Updates status to `seated`, sets `ended_at = NOW()`
       - Writes `reservation_events(event_type='seated_requested')`
       - Resumes hook: `await resumeHook(active_hook_token, { type: 'seated' })`
       - Publishes KV events
       - Returns: `{ ok: true, data: { reservation_id } }`

    2. All functions:
       - Use `log.*` from `@/lib/log`
       - Use `sql` from `@/lib/db/neon`
       - DB-backed safety net: `INSERT reservation_events` BEFORE `resumeHook`
  </action>
  <verify>
    <automated>test -f lib/services/queue.ts && grep -q 'export.*getActiveQueue' lib/services/queue.ts && grep -q 'export.*markCalled' lib/services/queue.ts && grep -q 'export.*markSeated' lib/services/queue.ts && grep -q 'import.*from "@/lib/db/neon"' lib/services/queue.ts && grep -q 'import.*from "@/lib/log"' lib/services/queue.ts && grep -q 'reservation_events' lib/services/queue.ts</automated>
  </verify>
  <acceptance_criteria>
    - `lib/services/queue.ts` exports 3 functions: `getActiveQueue`, `markCalled`, `markSeated`
    - `getActiveQueue` returns non-closed reservations ordered by `created_at ASC`
    - `markCalled` advances from `waiting` to `called`, updates `called_at`, sets `active_hook_token`
    - `markSeated` closes reservation as `seated`, sets `ended_at`
    - All functions use DB-backed safety net (INSERT reservation_events BEFORE resumeHook)
    - All functions use `log.*` — no raw `console.*`
  </acceptance_criteria>
  <done>
    `lib/services/queue.ts` is the staff-facing service layer. `getActiveQueue` feeds the Phase 3 panel; `markCalled`/`markSeated` are the functions called by staff API endpoints.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Service layer → Postgres | Uses `lib/db/neon.ts` (HTTP, pooled); never touches `lib/db/pool.ts` (D-19) |
| Service layer → KV | Uses `lib/realtime.ts` helpers; never calls `redis.publish` directly (D-20) |
| Service layer → WDK | Uses `start()` for new workflows, `resumeHook()` for actions (D-37: in-process import) |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-02-03-01 | Information Disclosure | PII in service layer logs | mitigate | All log paths go through `lib/log.ts`; `redactPII` masks emails, phones, names |
| T-02-03-02 | Tampering | Invalid input bypasses validation | mitigate | Zod `.passthrough()` + `safeParse` on all inputs; returns `INVALID_INPUT` error |
| T-02-03-03 | Tampering | Workflow start failure leaves orphaned row | mitigate | Compensating action: `UPDATE status='failed_to_start'` (D-14); row left for forensic audit |
| T-02-03-04 | Information Disclosure | `console.*` bypass in service layer | mitigate | Code review checklist: grep for `console\.(log|warn|error)` outside `lib/log.ts` |
| T-02-03-05 | Tampering | DB-backed safety net race | mitigate | Transactional INSERT + resumeHook; workflow timeout branches re-query events table |

</threat_model>

<verification>
**End-to-end checks for this plan:**
1. `grep -q 'active_hook_token TEXT NULL' db/migrations/0002_workflow_active_hook.sql` → migration exists
2. `npm run db:migrate` → applies 0002 cleanly
3. `grep -q 'publishReservationEvent' lib/realtime.ts` → KV publisher exists
4. `npm run smoke:kv` → KV smoke test passes
5. `grep -q 'createReservation' lib/services/reservations.ts` → service layer exists
6. `grep -q 'getActiveQueue' lib/services/queue.ts` → queue service exists
7. All service files: `grep -q 'from "@/lib/log"'` → uses structured logger
8. All service files: `grep -q 'from "@/lib/db/neon"'` → uses HTTP client, not pool
9. All service files: `grep -q 'safeParse'` → uses safe validation
10. All service files: `grep -q 'reservation_events'` → DB-backed safety net present
</verification>

<success_criteria>
1. **0002 migration:** `active_hook_token TEXT NULL` column added to `reservations` table.
2. **lib/realtime.ts:** Exports `publishReservationEvent` and `publishQueueEvent` using `Redis.fromEnv()`.
3. **lib/services/reservations.ts:** 4 functions — `createReservation`, `getReservationStatus`, `extendWait`, `cancelReservation` — with Zod validation, structured error contracts, PII-safe logging, DB-backed safety net.
4. **lib/services/queue.ts:** 3 functions — `getActiveQueue`, `markCalled`, `markSeated` — with DB-backed safety net.
5. **No raw console.*:** All service functions use `log.*` from `lib/log.ts`.
6. **DB client discipline:** Service layer uses `lib/db/neon.ts` (HTTP), never `lib/db/pool.ts`.
</success_criteria>

<output>
After completion, create `.planning/phases/02-backend-core/02-03-service-layer-SUMMARY.md` documenting:
- Migration results (0002 applied)
- KV smoke test results
- Service layer function signatures and key behaviors
- Any deviations from the spec (e.g., if Edge Config reads needed adjustment)
</output>
