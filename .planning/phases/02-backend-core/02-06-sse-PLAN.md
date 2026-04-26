---
phase: 02-backend-core
plan: 06
type: execute
wave: 1
depends_on:
  - "02-03-service-layer"
files_modified:
  - app/api/events/[reservation_id]/route.ts
  - app/api/events/queue/route.ts
autonomous: true
requirements:
  - PLAT-07

must_haves:
  truths:
    - "app/api/events/[reservation_id]/route.ts exports GET with SSE handler"
    - "app/api/events/queue/route.ts exports GET with SSE handler"
    - "Both handlers: runtime=nodejs, maxDuration=800, dynamic=force-dynamic"
    - "Both handlers: snapshot-replay-on-connect (Postgres first, then KV subscribe)"
    - "Diner SSE auth: ?session_token=<uuid> query param (D-28)"
    - "Staff SSE auth: auth() + employees.active gate (D-29)"
    - "Heartbeat every 25s as : hb\\n\\n"
    - "Proper SSE headers: Content-Type, Cache-Control, Connection, X-Accel-Buffering"
  artifacts:
    - path: "app/api/events/[reservation_id]/route.ts"
      provides: "Diner SSE handler — per-reservation realtime events"
      exports: ["GET"]
    - path: "app/api/events/queue/route.ts"
      provides: "Staff SSE handler — active queue realtime events"
      exports: ["GET"]

---

<objective>
Create SSE Route Handlers for diner realtime (`/api/events/[reservation_id]`) and staff realtime (`/api/events/queue`). Both implement snapshot-replay-on-connect (Pattern 3), heartbeat, and proper cleanup.

Purpose: PLAT-07 — SSE handlers are the ONLY place that subscribe to KV channels. Service layer and workflow steps NEVER subscribe. Postgres is the source of truth; KV is a real-time hint.
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
From 02-CONTEXT.md D-26 — SSE handler shape:
```typescript
export const runtime = "nodejs";
export const maxDuration = 800; // Pro+Fluid
export const dynamic = "force-dynamic";
// Headers:
//   Content-Type: text/event-stream
//   Cache-Control: no-cache, no-transform
//   Connection: keep-alive
//   X-Accel-Buffering: no
// Heartbeat every 25s: : hb\n\n
// Abort cleanup: clearInterval(hb); sub.unsubscribe(); controller.close();
```

From 02-CONTEXT.md D-27 — snapshot-replay-on-connect (mandatory):
1. Read current state from Postgres
2. Emit as initial event: `id: <max_event_id>\nevent: snapshot\ndata: <json>\n\n`
3. If client sent `Last-Event-ID` header, replay `reservation_events` rows with `id > Last-Event-ID`
4. Subscribe to KV channel(s)

From 02-CONTEXT.md D-28 — Diner SSE auth:
- `?session_token=<uuid>` query parameter
- Validates: `SELECT id FROM reservations WHERE id = $1 AND session_token = $2`
- Mismatch → 401
- Token in query string — mitigated by `lib/log.ts` redacting query string values

From 02-CONTEXT.md D-29 — Staff SSE auth:
- `/api/events/queue` gated by `auth()` from `lib/auth/auth.ts`
- PLUS `employees.active = true` gate
- Returns 401 if session missing or employee inactive

From 02-CONTEXT.md D-24 — KV channel naming:
- `reservation:<uuid>` — per-reservation events
- `queue:active` — fan-out for staff panel
- Payload: `{ id, type, reservation_id, occurred_at, ...event_specific_fields }`

From ARCHITECTURE.md Pattern 3 — SSE handler = subscribe + replay-on-connect:
```typescript
const stream = new ReadableStream({
  async start(controller) {
    const enc = new TextEncoder();
    const send = (event: string, data: unknown, id?: string) =>
      controller.enqueue(enc.encode(`${id ? `id: ${id}\n` : ""}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
    // 1. REPLAY current state immediately
    const snapshot = await getReservationSnapshot(reservationId);
    send("snapshot", snapshot, snapshot.lastEventId);
    // 2. SUBSCRIBE for future updates
    const sub = redis.subscribe(`reservation:${reservationId}`);
    sub.on("message", ({ message }) => {
      const evt = JSON.parse(message);
      send(evt.type, evt, String(evt.id));
    });
    // 3. heartbeat every 25s
    const hb = setInterval(() => controller.enqueue(enc.encode(`: hb\n\n`)), 25_000);
    // 4. cleanup on abort
    req.signal.addEventListener("abort", () => {
      clearInterval(hb);
      sub.unsubscribe();
      controller.close();
    });
  },
});
```

From PITFALLS.md #6 — SSE missed message during reconnect:
- Set `id:` on every SSE event using `reservation_events.id`
- Use `Last-Event-ID` header for gap recovery

From PITFALLS.md #7 — subscriber-not-yet-attached race:
- Snapshot replay on connect eliminates this
- Postgres is source of truth; KV is hint
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Create app/api/events/[reservation_id]/route.ts — diner SSE handler</name>
  <files>app/api/events/[reservation_id]/route.ts</files>
  <read_first>
    - .planning/phases/02-backend-core/02-CONTEXT.md D-26, D-27, D-28 (SSE shape + snapshot replay + diner auth)
    - .planning/research/ARCHITECTURE.md Pattern 3 (exact ReadableStream shape)
    - .planning/research/PITFALLS.md #6, #7 (SSE race conditions)
  </read_first>
  <action>
    1. Create `app/api/events/[reservation_id]/route.ts`:

       ```typescript
       // app/api/events/[reservation_id]/route.ts
       // SSE handler for diner — per-reservation realtime events
       // Auth: ?session_token=<uuid> query param (D-28)
       // Pattern 3: snapshot-replay-on-connect (ARCHITECTURE)

       import { sql } from "@/lib/db/neon";
       import { Redis } from "@upstash/redis";
       import { log } from "@/lib/log";

       export const runtime = "nodejs";
       export const maxDuration = 800;
       export const dynamic = "force-dynamic";

       const redis = Redis.fromEnv();

       export async function GET(
         req: Request,
         { params }: { params: { reservation_id: string } }
       ) {
         const { reservation_id } = params;
         const url = new URL(req.url);
         const sessionToken = url.searchParams.get("session_token");

         // D-28: Validate session_token
         if (!sessionToken) {
           return new Response("Unauthorized", { status: 401 });
         }

         const rows = await sql\`SELECT id FROM reservations WHERE id = ${reservation_id} AND session_token = ${sessionToken}\`;
         if (!rows[0]) {
           return new Response("Unauthorized", { status: 401 });
         }

         const encoder = new TextEncoder();
         const send = (event: string, data: unknown, id?: string) => {
           const line = id ? `id: ${id}\n` : "";
           return encoder.encode(`${line}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
         };

         const stream = new ReadableStream({
           async start(controller) {
             // D-27 Step 1: Snapshot from Postgres
             const snapshotRows = await sql\`
               SELECT id, status, position, eta_min, extension_count, no_show_deadline, called_at,
                      (SELECT COALESCE(MAX(id), 0) FROM reservation_events WHERE reservation_id = ${reservation_id}) as last_event_id
               FROM reservations
               WHERE id = ${reservation_id}
             \`;
             const snapshot = snapshotRows[0];
             const lastEventId = snapshot.last_event_id;

             // D-27 Step 2: Emit snapshot as initial event
             send("snapshot", {
               reservation_id,
               status: snapshot.status,
               position: snapshot.position,
               eta_min: snapshot.eta_min,
               extension_count: snapshot.extension_count,
               no_show_deadline: snapshot.no_show_deadline,
               called_at: snapshot.called_at,
               last_event_id: lastEventId,
             }, String(lastEventId));

             // D-27 Step 3: Replay missed events if Last-Event-ID provided
             const lastEventHeader = req.headers.get("Last-Event-ID");
             if (lastEventHeader && Number(lastEventHeader) > 0) {
               const missedRows = await sql\`
                 SELECT id, event_type, payload, created_at
                 FROM reservation_events
                 WHERE reservation_id = ${reservation_id}
                   AND id > ${Number(lastEventHeader)}
                 ORDER BY id ASC
               \`;
               for (const row of missedRows) {
                 send(row.event_type, {
                   id: row.id,
                   type: row.event_type,
                   reservation_id,
                   occurred_at: row.created_at,
                   ...row.payload,
                 }, String(row.id));
               }
             }

             // D-27 Step 4: Subscribe to KV channel
             const sub = await redis.subscribe(`reservation:${reservation_id}`, (message) => {
               const evt = JSON.parse(message);
               send(evt.type || "event", evt, String(evt.id));
             });

             // Heartbeat every 25s (D-26)
             const hb = setInterval(() => {
               controller.enqueue(encoder.encode(": hb\n\n"));
             }, 25_000);

             // Cleanup on abort (Pitfall #7)
             req.signal.addEventListener("abort", () => {
               clearInterval(hb);
               redis.unsubscribe(sub);
               controller.close();
             });
           },
           cancel() {
             // Cleanup if stream is cancelled externally
             redis.unsubscribe("reservation:" + reservation_id);
           },
         });

         return new Response(stream, {
           headers: {
             "Content-Type": "text/event-stream",
             "Cache-Control": "no-cache, no-transform",
             "Connection": "keep-alive",
             "X-Accel-Buffering": "no",
           },
         });
       }
       ```
   </action>
   <verify>
     <automated>test -f "app/api/events/[reservation_id]/route.ts" && grep -q 'runtime.*nodejs' "app/api/events/[reservation_id]/route.ts" && grep -q 'maxDuration.*800' "app/api/events/[reservation_id]/route.ts" && grep -q 'force-dynamic' "app/api/events/[reservation_id]/route.ts" && grep -q 'session_token' "app/api/events/[reservation_id]/route.ts" && grep -q 'snapshot' "app/api/events/[reservation_id]/route.ts" && grep -q 'Last-Event-ID' "app/api/events/[reservation_id]/route.ts" && grep -q 'subscribe' "app/api/events/[reservation_id]/route.ts" && grep -q 'unsubscribe' "app/api/events/[reservation_id]/route.ts" && grep -q 'hb' "app/api/events/[reservation_id]/route.ts"</automated>
   </verify>
   <acceptance_criteria>
     - `app/api/events/[reservation_id]/route.ts` exports GET with SSE handler
     - `runtime = "nodejs"`, `maxDuration = 800`, `dynamic = "force-dynamic"`
     - Diner auth via `?session_token` query param → 401 on mismatch
     - Snapshot replay from Postgres on connect (D-27 Step 1-2)
     - Gap recovery via `Last-Event-ID` header (D-27 Step 3)
     - Subscribes to `reservation:<id>` KV channel (D-27 Step 4)
     - Heartbeat every 25s (`: hb\n\n`)
     - Cleanup on abort: clearInterval, unsubscribe, close controller
     - SSE headers: Content-Type, Cache-Control, Connection, X-Accel-Buffering
   </acceptance_criteria>
   <done>
     Diner SSE handler at `/api/events/[reservation_id]`. Snapshot-replay-on-connect, session_token auth, heartbeat, KV subscription with cleanup. PLAT-07.
   </done>
</task>

<task type="auto">
  <name>Task 2: Create app/api/events/queue/route.ts — staff SSE handler</name>
  <files>app/api/events/queue/route.ts</files>
  <read_first>
    - .planning/phases/02-backend-core/02-CONTEXT.md D-26, D-27, D-29 (SSE shape + snapshot replay + staff auth)
    - .planning/phases/02-backend-core/02-03-service-layer-PLAN.md (getActiveQueue from queue.ts)
    - .planning/research/ARCHITECTURE.md Pattern 3
  </read_first>
  <action>
    1. Create `app/api/events/queue/route.ts`:

       ```typescript
       // app/api/events/queue/route.ts
       // SSE handler for staff — active queue realtime events
       // Auth: auth() + employees.active gate (D-29)
       // Pattern 3: snapshot-replay-on-connect (ARCHITECTURE)

       import { sql } from "@/lib/db/neon";
       import { Redis } from "@upstash/redis";
       import { auth } from "@/lib/auth/auth";
       import { getActiveQueue } from "@/lib/services/queue";
       import { log } from "@/lib/log";

       export const runtime = "nodejs";
       export const maxDuration = 800;
       export const dynamic = "force-dynamic";

       const redis = Redis.fromEnv();

       export async function GET(req: Request) {
         // D-29: Staff auth — auth() + employees.active gate
         const session = await auth();
         if (!session?.user) {
           return new Response("Unauthorized", { status: 401 });
         }

         // Check employees.active
         const empRows = await sql\`SELECT active FROM employees WHERE id = ${session.user.id}\`;
         if (!empRows[0] || !empRows[0].active) {
           return new Response("Unauthorized", { status: 401 });
         }

         const encoder = new TextEncoder();
         const send = (event: string, data: unknown, id?: string) => {
           const line = id ? `id: ${id}\n` : "";
           return encoder.encode(`${line}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
         };

         const stream = new ReadableStream({
           async start(controller) {
             // D-27 Step 1: Snapshot — active queue from Postgres
             const queue = await getActiveQueue();
             const lastEventRow = await sql\`
               SELECT COALESCE(MAX(id), 0) as max_id FROM reservation_events
             \`;
             const lastEventId = lastEventRow[0].max_id;

             // D-27 Step 2: Emit snapshot
             send("snapshot", {
               reservations: queue,
               last_event_id: lastEventId,
             }, String(lastEventId));

             // D-27 Step 3: Replay missed events
             const lastEventHeader = req.headers.get("Last-Event-ID");
             if (lastEventHeader && Number(lastEventHeader) > 0) {
               const missedRows = await sql\`
                 SELECT id, event_type, payload, created_at
                 FROM reservation_events
                 WHERE id > ${Number(lastEventHeader)}
                 ORDER BY id ASC
               \`;
               for (const row of missedRows) {
                 send(row.event_type, {
                   id: row.id,
                   type: row.event_type,
                   reservation_id: row.payload?.reservation_id || "",
                   occurred_at: row.created_at,
                   ...row.payload,
                 }, String(row.id));
               }
             }

             // D-27 Step 4: Subscribe to queue:active KV channel
             const sub = await redis.subscribe("queue:active", (message) => {
               const evt = JSON.parse(message);
               send(evt.type || "event", evt, String(evt.id));
             });

             // Heartbeat every 25s
             const hb = setInterval(() => {
               controller.enqueue(encoder.encode(": hb\n\n"));
             }, 25_000);

             // Cleanup on abort
             req.signal.addEventListener("abort", () => {
               clearInterval(hb);
               redis.unsubscribe(sub);
               controller.close();
             });
           },
           cancel() {
             redis.unsubscribe("queue:active");
           },
         });

         return new Response(stream, {
           headers: {
             "Content-Type": "text/event-stream",
             "Cache-Control": "no-cache, no-transform",
             "Connection": "keep-alive",
             "X-Accel-Buffering": "no",
           },
         });
       }
       ```
   </action>
   <verify>
     <automated>test -f "app/api/events/queue/route.ts" && grep -q 'runtime.*nodejs' "app/api/events/queue/route.ts" && grep -q 'maxDuration.*800' "app/api/events/queue/route.ts" && grep -q 'force-dynamic' "app/api/events/queue/route.ts" && grep -q 'auth()' "app/api/events/queue/route.ts" && grep -q 'employees' "app/api/events/queue/route.ts" && grep -q 'getActiveQueue' "app/api/events/queue/route.ts" && grep -q 'queue:active' "app/api/events/queue/route.ts" && grep -q 'subscribe' "app/api/events/queue/route.ts" && grep -q 'unsubscribe' "app/api/events/queue/route.ts"</automated>
   </verify>
   <acceptance_criteria>
     - `app/api/events/queue/route.ts` exports GET with SSE handler
     - `runtime = "nodejs"`, `maxDuration = 800`, `dynamic = "force-dynamic"`
     - Staff auth via `auth()` + `employees.active` gate (D-29)
     - Snapshot from `getActiveQueue()` service layer
     - Subscribes to `queue:active` KV channel
     - Heartbeat every 25s
     - Cleanup on abort
     - SSE headers correct
   </acceptance_criteria>
   <done>
     Staff SSE handler at `/api/events/queue`. Auth + employees.active gate, active queue snapshot, `queue:active` KV subscription. PLAT-07.
   </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Diner → SSE | Auth via `?session_token` query param; validated against DB row (D-28) |
| Staff → SSE | Auth via `auth()` session + `employees.active` check (D-29) |
| SSE handler → KV | Subscribes to channels; NEVER publishes (D-20) |
| SSE handler → Postgres | Snapshot reads; connection released before KV subscription begins |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-02-06-01 | Information Disclosure | session_token in URL/query string | accept | Documented trade-off (D-28); single-purpose, non-reusable across reservations; redacted in logs by lib/log.ts |
| T-02-06-02 | Unauthorized Access | Staff SSE without auth | mitigate | `auth()` + `employees.active` gate returns 401 |
| T-02-06-03 | Denial of Service | SSE connections not cleaned up | mitigate | Abort event handler calls `unsubscribe()` + `controller.close()` (Pitfall #7) |
| T-02-06-04 | Information Disclosure | PII in SSE snapshots | mitigate | Service layer functions use `log.*`; snapshot queries select only needed columns |

</threat_model>

<verification>
**End-to-end checks for this plan:**
1. `test -f "app/api/events/[reservation_id]/route.ts"` → diner SSE exists
2. `test -f "app/api/events/queue/route.ts"` → staff SSE exists
3. Both files: `grep -q 'runtime.*nodejs'` → nodejs runtime
4. Both files: `grep -q 'maxDuration.*800'` → 800s max duration
5. Both files: `grep -q 'force-dynamic'` → force-dynamic
6. Diner SSE: `grep -q 'session_token'` → session_token auth
7. Staff SSE: `grep -q 'auth()'` → auth() gate
8. Both: `grep -q 'snapshot'` → snapshot replay
9. Both: `grep -q 'subscribe'` → KV subscription
10. Both: `grep -q 'unsubscribe'` → cleanup on abort

</verification>

<success_criteria>
1. **Diner SSE:** `/api/events/[reservation_id]` with session_token auth, snapshot replay, KV subscription.
2. **Staff SSE:** `/api/events/queue` with auth() + employees.active gate, active queue snapshot.
3. **Both handlers:** nodejs runtime, maxDuration 800, force-dynamic, heartbeat 25s, SSE headers.
4. **Snapshot-replay-on-connect:** Postgres read first, then KV subscribe (Pattern 3).
5. **Gap recovery:** Last-Event-ID header support for missed events.
6. **Cleanup:** Abort handler releases KV subscription slot.

</success_criteria>

<output>
After completion, create `.planning/phases/02-backend-core/02-06-sse-SUMMARY.md` documenting:
- SSE handler structures (diner vs staff)
- Auth mechanisms
- Snapshot replay behavior
- Any deviations from the spec
</output>
