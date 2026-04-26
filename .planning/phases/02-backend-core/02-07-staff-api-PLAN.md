---
phase: 02-backend-core
plan: 07
type: execute
wave: 1
depends_on:
  - "02-03-service-layer"
files_modified:
  - app/api/queue/[id]/call/route.ts
  - app/api/queue/[id]/seated/route.ts
  - app/api/queue/[id]/no_show_manual/route.ts
  - app/api/queue/route.ts
autonomous: true
requirements:
  - PLAT-01
  - PLAT-03

must_haves:
  truths:
    - "app/api/queue/[id]/call/route.ts exports POST — auth-gated, calls markCalled service"
    - "app/api/queue/[id]/seated/route.ts exports POST — auth-gated, calls markSeated service"
    - "app/api/queue/[id]/no_show_manual/route.ts exports POST — auth-gated"
    - "app/api/queue/route.ts exports GET — auth-gated, returns getActiveQueue"
    - "All endpoints use auth() from lib/auth/auth.ts for staff auth"
    - "All endpoints use DB-backed safety net (D-10): INSERT reservation_events BEFORE resumeHook"
    - "All endpoints use log.* from lib/log.ts"
  artifacts:
    - path: "app/api/queue/[id]/call/route.ts"
      provides: "Staff action: advance reservation from waiting to called"
      exports: ["POST"]
    - path: "app/api/queue/[id]/seated/route.ts"
      provides: "Staff action: close reservation as seated"
      exports: ["POST"]
    - path: "app/api/queue/[id]/no_show_manual/route.ts"
      provides: "Staff action: manual no_show override"
      exports: ["POST"]
    - path: "app/api/queue/route.ts"
      provides: "Staff action: list active queue"
      exports: ["GET"]

---

<objective>
Create staff action API endpoints (`/api/queue/[id]/call`, `/api/queue/[id]/seated`, `/api/queue/[id]/no_show_manual`) and the active queue list (`/api/queue`). These are auth-gated endpoints that wrap the service layer functions.

Purpose: PLAT-01, PLAT-03 — staff action API endpoints land in Phase 2 (D-30) so the workflow can be exercised end-to-end with auth-gated curl during Phase 2 development. The Phase 3 panel just calls the same endpoints.
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
@.planning/research/STACK.md
@.planning/research/ARCHITECTURE.md
@.planning/research/PITFALLS.md
@CLAUDE.md

<interfaces>
From 02-CONTEXT.md D-30 — staff action API endpoints:
- `POST /api/queue/[id]/call` — auth-gated, resolves active hook token from `reservations.active_hook_token`, persists `reservation_events(event_type='call_requested')` BEFORE `resumeHook`, publishes `reservation:<id>` + `queue:active` events
- `POST /api/queue/[id]/seated` — same pattern with `seated_requested`
- `POST /api/queue/[id]/no_show_manual` — same pattern (manual override no_show)
- These endpoints are TESTED via curl in Phase 2
- Phase 3 panel calls them

From 02-CONTEXT.md D-10 — DB-backed safety net:
1. `INSERT INTO reservation_events(reservation_id, event_type, payload)`
2. `await resumeHook(token, payload)`
Workflow timeout branches re-query `reservation_events` for missed events before re-entering the race.

From 02-CONTEXT.md D-37 — resumeHook in-process:
- `resumeHook` imported from `workflow/api`
- Called directly from staff API endpoints (in-process)
- NEVER `fetch()` back to a workflow endpoint

From 02-CONTEXT.md D-29 — staff SSE auth pattern:
- `auth()` from `lib/auth/auth.ts`
- `employees.active = true` gate
- Returns 401 if session missing or employee inactive

From 02-CONTEXT.md D-08 — hook tokens:
- `reservation:<id>:waiting` — staff calls via markCalled
- `reservation:<id>:called:pre` — followup window
- `reservation:<id>:called:final` — extend/cancel/seated window

From ARCHITECTURE.md Pattern 2 — hook-resume in-process:
```typescript
// app/api/queue/[id]/call/route.ts
import { callHook } from "@/lib/workflows/reservation";
import { auth } from "@/lib/auth";

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user) return new Response("unauthorized", { status: 401 });
  await callHook.resume(params.id, {});
  return Response.json({ ok: true });
}
```

From 02-03-service-layer-PLAN.md — queue service functions:
- `markCalled(reservationId)` — advances from `waiting` to `called`, sets `called_at`, `active_hook_token`, writes `reservation_events(event_type='call_requested')`, resumes hook, publishes KV events
- `markSeated(reservationId)` — closes as `seated`, sets `ended_at`, writes `reservation_events`, resumes hook, publishes KV events
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Create app/api/queue/route.ts — GET active queue</name>
  <files>app/api/queue/route.ts</files>
  <read_first>
    - .planning/phases/02-backend-core/02-CONTEXT.md D-29 (staff auth pattern)
    - .planning/phases/02-backend-core/02-03-service-layer-PLAN.md (getActiveQueue service)
  </read_first>
  <action>
    1. Create `app/api/queue/route.ts`:

       ```typescript
       // app/api/queue/route.ts
       // GET active queue — auth-gated, returns live queue for staff panel
       // Used by Phase 3 panel AND Phase 2 staff action API testing

       import { auth } from "@/lib/auth/auth";
       import { sql } from "@/lib/db/neon";
       import { getActiveQueue } from "@/lib/services/queue";
       import { log } from "@/lib/log";

       export const runtime = "nodejs";
       export const dynamic = "force-dynamic";

       export async function GET(req: Request) {
         // D-29: Staff auth
         const session = await auth();
         if (!session?.user) {
           return new Response("Unauthorized", { status: 401 });
         }

         const empRows = await sql\`SELECT active FROM employees WHERE id = ${session.user.id}\`;
         if (!empRows[0] || !empRows[0].active) {
           return new Response("Unauthorized", { status: 401 });
         }

         const queue = await getActiveQueue();
         return Response.json({ ok: true, data: queue });
       }
       ```
   </action>
   <verify>
     <automated>test -f "app/api/queue/route.ts" && grep -q 'auth()' "app/api/queue/route.ts" && grep -q 'getActiveQueue' "app/api/queue/route.ts" && grep -q 'employees' "app/api/queue/route.ts"</automated>
   </verify>
   <acceptance_criteria>
     - `app/api/queue/route.ts` exports GET
     - Auth via `auth()` + `employees.active` gate
     - Returns `getActiveQueue()` result
     - Returns `{ ok: true, data: queue }`
   </acceptance_criteria>
   <done>
     `app/api/queue/route.ts` — GET active queue, auth-gated. Feeds Phase 3 panel and Phase 2 curl testing.
   </done>
</task>

<task type="auto">
  <name>Task 2: Create app/api/queue/[id]/call/route.ts — POST mark called</name>
  <files>app/api/queue/[id]/call/route.ts</files>
  <read_first>
    - .planning/phases/02-backend-core/02-CONTEXT.md D-30 (staff action API pattern)
    - .planning/phases/02-backend-core/02-CONTEXT.md D-10 (DB-backed safety net)
    - .planning/phases/02-backend-core/02-03-service-layer-PLAN.md (markCalled service)
  </read_first>
  <action>
    1. Create `app/api/queue/[id]/call/route.ts`:

       ```typescript
       // app/api/queue/[id]/call/route.ts
       // POST mark reservation as called — advances waiting → called
       // Auth-gated, uses service layer + DB-backed safety net (D-10)

       import { auth } from "@/lib/auth/auth";
       import { sql } from "@/lib/db/neon";
       import { markCalled } from "@/lib/services/queue";
       import { log } from "@/lib/log";

       export const runtime = "nodejs";
       export const dynamic = "force-dynamic";

       export async function POST(
         _req: Request,
         { params }: { params: { id: string } }
       ) {
         // D-29: Staff auth
         const session = await auth();
         if (!session?.user) {
           return new Response("Unauthorized", { status: 401 });
         }

         const empRows = await sql\`SELECT active FROM employees WHERE id = ${session.user.id}\`;
         if (!empRows[0] || !empRows[0].active) {
           return new Response("Unauthorized", { status: 401 });
         }

         const result = await markCalled(params.id);
         if (!result.ok) {
           return new Response(JSON.stringify(result), { status: 400, headers: { "Content-Type": "application/json" } });
         }

         return Response.json(result);
       }
       ```
   </action>
   <verify>
     <automated>test -f "app/api/queue/[id]/call/route.ts" && grep -q 'auth()' "app/api/queue/[id]/call/route.ts" && grep -q 'markCalled' "app/api/queue/[id]/call/route.ts" && grep -q 'employees' "app/api/queue/[id]/call/route.ts"</automated>
   </verify>
   <acceptance_criteria>
     - `app/api/queue/[id]/call/route.ts` exports POST
     - Auth via `auth()` + `employees.active` gate
     - Calls `markCalled(params.id)` service function
     - Returns service result as JSON
     - 400 on service error, 401 on auth failure
   </acceptance_criteria>
   <done>
     `app/api/queue/[id]/call/route.ts` — POST mark called. Auth-gated, wraps `markCalled` service function.
   </done>
</task>

<task type="auto">
  <name>Task 3: Create app/api/queue/[id]/seated/route.ts — POST mark seated</name>
  <files>app/api/queue/[id]/seated/route.ts</files>
  <read_first>
    - .planning/phases/02-backend-core/02-CONTEXT.md D-30
    - .planning/phases/02-backend-core/02-03-service-layer-PLAN.md (markSeated service)
  </read_first>
  <action>
    1. Create `app/api/queue/[id]/seated/route.ts`:

       ```typescript
       // app/api/queue/[id]/seated/route.ts
       // POST mark reservation as seated — closes the reservation
       // Auth-gated, uses service layer + DB-backed safety net (D-10)

       import { auth } from "@/lib/auth/auth";
       import { sql } from "@/lib/db/neon";
       import { markSeated } from "@/lib/services/queue";
       import { log } from "@/lib/log";

       export const runtime = "nodejs";
       export const dynamic = "force-dynamic";

       export async function POST(
         _req: Request,
         { params }: { params: { id: string } }
       ) {
         // D-29: Staff auth
         const session = await auth();
         if (!session?.user) {
           return new Response("Unauthorized", { status: 401 });
         }

         const empRows = await sql\`SELECT active FROM employees WHERE id = ${session.user.id}\`;
         if (!empRows[0] || !empRows[0].active) {
           return new Response("Unauthorized", { status: 401 });
         }

         const result = await markSeated(params.id);
         if (!result.ok) {
           return new Response(JSON.stringify(result), { status: 400, headers: { "Content-Type": "application/json" } });
         }

         return Response.json(result);
       }
       ```
   </action>
   <verify>
     <automated>test -f "app/api/queue/[id]/seated/route.ts" && grep -q 'auth()' "app/api/queue/[id]/seated/route.ts" && grep -q 'markSeated' "app/api/queue/[id]/seated/route.ts" && grep -q 'employees' "app/api/queue/[id]/seated/route.ts"</automated>
   </verify>
   <acceptance_criteria>
     - `app/api/queue/[id]/seated/route.ts` exports POST
     - Auth via `auth()` + `employees.active` gate
     - Calls `markSeated(params.id)` service function
     - Returns service result as JSON
   </acceptance_criteria>
   <done>
     `app/api/queue/[id]/seated/route.ts` — POST mark seated. Auth-gated, wraps `markSeated` service function.
   </done>
</task>

<task type="auto">
  <name>Task 4: Create app/api/queue/[id]/no_show_manual/route.ts — POST manual no_show</name>
  <files>app/api/queue/[id]/no_show_manual/route.ts</files>
  <read_first>
    - .planning/phases/02-backend-core/02-CONTEXT.md D-30 (no_show_manual endpoint)
    - .planning/phases/02-backend-core/02-CONTEXT.md D-10 (DB-backed safety net)
  </read_first>
  <action>
    1. Create `app/api/queue/[id]/no_show_manual/route.ts`:

       ```typescript
       // app/api/queue/[id]/no_show_manual/route.ts
       // POST manual no_show override — staff can mark a reservation as no_show
       // This is the manual override path; STAFF-09 undo lives in Phase 3
       // Auth-gated, uses service layer + DB-backed safety net (D-10)

       import { auth } from "@/lib/auth/auth";
       import { sql } from "@/lib/db/neon";
       import { log } from "@/lib/log";

       export const runtime = "nodejs";
       export const dynamic = "force-dynamic";

       export async function POST(
         _req: Request,
         { params }: { params: { id: string } }
       ) {
         // D-29: Staff auth
         const session = await auth();
         if (!session?.user) {
           return new Response("Unauthorized", { status: 401 });
         }

         const empRows = await sql\`SELECT active FROM employees WHERE id = ${session.user.id}\`;
         if (!empRows[0] || !empRows[0].active) {
           return new Response("Unauthorized", { status: 401 });
         }

         // Manual no_show: update status directly + write reservation_events
         // The service layer function for this will be added to queue.ts
         // For now, implement inline with DB-backed safety net pattern
         try {
           // INSERT reservation_events(event_type='no_show_manual')
           await sql\`
             INSERT INTO reservation_events (reservation_id, event_type, payload)
             VALUES (${params.id}, 'no_show_manual', jsonb_build_object('staff_id', ${session.user.id}))
           \`;

           // Update reservation status
           await sql\`
             UPDATE reservations
             SET status = 'no_show', ended_at = NOW()
             WHERE id = ${params.id} AND status IN ('waiting', 'called')
           \`;

           // Resume hook if there's an active workflow
           const { resumeHook } = await import("workflow/api");
           const { active_hook_token } = (await sql\`SELECT active_hook_token FROM reservations WHERE id = ${params.id}\`)[0] || {};
           if (active_hook_token) {
             await resumeHook(active_hook_token, { type: "no_show" });
           }

           // Publish KV events
           const { publishReservationEvent, publishQueueEvent } = await import("@/lib/realtime");
           await Promise.all([
             publishReservationEvent(params.id, { type: "no_show", reservation_id: params.id, occurred_at: new Date().toISOString() }),
             publishQueueEvent({ reservation_id: params.id, type: "no_show", occurred_at: new Date().toISOString() }),
           ]);

           log.info("staff.no_show_manual", { reservation_id: params.id, staff_id: session.user.id });

           return Response.json({ ok: true, data: { reservation_id: params.id, status: "no_show" } });
         } catch (err) {
           log.error("staff.no_show_manual.error", err);
           return new Response(JSON.stringify({ ok: false, error: { code: "INTERNAL_ERROR", message: "Error al marcar no-show" } }), {
             status: 500,
             headers: { "Content-Type": "application/json" },
           });
         }
       }
       ```

       Note: This endpoint implements the manual no_show path inline since the service layer `queue.ts` may not have a `markNoShow` function. The pattern follows D-10: INSERT reservation_events BEFORE resumeHook, then publish KV events.
   </action>
   <verify>
     <automated>test -f "app/api/queue/[id]/no_show_manual/route.ts" && grep -q 'auth()' "app/api/queue/[id]/no_show_manual/route.ts" && grep -q 'no_show' "app/api/queue/[id]/no_show_manual/route.ts" && grep -q 'employees' "app/api/queue/[id]/no_show_manual/route.ts" && grep -q 'reservation_events' "app/api/queue/[id]/no_show_manual/route.ts"</automated>
   </verify>
   <acceptance_criteria>
     - `app/api/queue/[id]/no_show_manual/route.ts` exports POST
     - Auth via `auth()` + `employees.active` gate
     - INSERTs into `reservation_events` (D-10 safety net)
     - Updates reservation status to `no_show`
     - Publishes KV events
     - Returns structured JSON response
   </acceptance_criteria>
   <done>
     `app/api/queue/[id]/no_show_manual/route.ts` — POST manual no_show. Auth-gated, follows D-10 safety net pattern.
   </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Staff → API | Auth via `auth()` session + `employees.active` check (D-29) |
| API → Service layer | Direct import, no HTTP self-call (Pattern 1, Anti-Pattern 1) |
| API → Workflow | `resumeHook` imported from `workflow/api`, called in-process (D-37) |
| API → KV | Uses `lib/realtime.ts` helpers, never calls `redis.publish` directly (D-20) |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-02-07-01 | Unauthorized Access | Unauthenticated staff action | mitigate | `auth()` + `employees.active` gate on all endpoints |
| T-02-07-02 | Tampering | Staff acts on wrong reservation | accept | No session_token validation for staff — staff is authenticated via Auth.js session. The `id` path param is the only identifier. |
| T-02-07-03 | Information Disclosure | PII in API logs | mitigate | All logging via `log.*` from `lib/log.ts` |
| T-02-07-04 | Tampering | Missing reservation_events before resumeHook | mitigate | D-10: INSERT reservation_events BEFORE resumeHook |

</threat_model>

<verification>
**End-to-end checks for this plan:**
1. `test -f "app/api/queue/route.ts"` → GET active queue exists
2. `test -f "app/api/queue/[id]/call/route.ts"` → POST call exists
3. `test -f "app/api/queue/[id]/seated/route.ts"` → POST seated exists
4. `test -f "app/api/queue/[id]/no_show_manual/route.ts"` → POST no_show_manual exists
5. All files: `grep -q 'auth()'` → auth gate present
6. All files: `grep -q 'employees'` → employees.active check present
7. no_show_manual: `grep -q 'reservation_events'` → DB safety net present
8. All files: `grep -q 'log'` → structured logging present

</verification>

<success_criteria>
1. **GET /api/queue:** Active queue list, auth-gated, returns `getActiveQueue()` result.
2. **POST /api/queue/[id]/call:** Mark called, auth-gated, wraps `markCalled` service.
3. **POST /api/queue/[id]/seated:** Mark seated, auth-gated, wraps `markSeated` service.
4. **POST /api/queue/[id]/no_show_manual:** Manual no_show, auth-gated, follows D-10 safety net.
5. **All endpoints:** Auth via `auth()` + `employees.active`, structured JSON responses.
6. **No HTTP self-calls:** Direct service layer imports (Pattern 1).

</success_criteria>

<output>
After completion, create `.planning/phases/02-backend-core/02-07-staff-api-SUMMARY.md` documenting:
- Endpoint URLs and methods
- Auth flow
- Service layer functions called
- Any deviations from the spec
</output>
