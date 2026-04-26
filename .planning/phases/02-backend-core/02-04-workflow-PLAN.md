---
phase: 02-backend-core
plan: 04
type: execute
wave: 1
depends_on:
  - "02-01-spikes-skew"
  - "02-03-service-layer"
files_modified:
  - lib/workflows/reservation.ts
  - lib/workflows/_README.md (updated with workflow implementation notes)
autonomous: true
requirements:
  - PLAT-03

must_haves:
  truths:
    - "lib/workflows/reservation.ts exists with 'use workflow' directive"
    - "Workflow function is a router — no IO, time, randomness, or external calls at router level"
    - "All side effects live inside 'use step' async functions"
    - "Three hook tokens: reservation:<id>:waiting, reservation:<id>:called:pre, reservation:<id>:called:final"
    - "Promise.race([hook, sleep(...)]) pattern used for every phase timeout"
    - "Serialization contract enforced — no Date objects, Maps, or class instances cross step boundaries"
    - "Edge Config reads happen INSIDE step functions, never at module load"
    - "Compensating action on workflow.start failure (D-14) handled in service layer, not here"
  artifacts:
    - path: "lib/workflows/reservation.ts"
      provides: "Durable reservation lifecycle state machine — waiting → called → seated|no_show|cancelled with extend branch"
      exports: ["reservationWorkflow"]
      contains: '"use workflow"'

---

<objective>
Create `lib/workflows/reservation.ts` — the single-file WDK workflow that orchestrates the full reservation lifecycle: `waiting → called → seated|no_show|cancelled` with `extend` branch, follow-up push, and no-show timeout.

Purpose: PLAT-03 — the durable workflow IS the reservation orchestrator. Every reservation created in Phase 2 gets a WDK run. The workflow shape FREEZES at end of Phase 2 (step count and order are locked).

The workflow function body contains ONLY control flow (`if`, `for`, `Promise.race`, `await`). Every IO, time, randomness, and external service call lives inside `"use step"` async functions.
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
From 02-CONTEXT.md D-08 — hook tokens:
- `reservation:<id>:waiting` — initial parking (staff calls via markCalled)
- `reservation:<id>:called:pre` — 1-min followup window after called
- `reservation:<id>:called:final` — post-followup window where extend/cancel/seated can land before no_show_deadline

From 02-CONTEXT.md D-11 — single file discipline:
- `lib/workflows/reservation.ts` contains the FULL state machine
- `lib/workflows/_README.md` documents the rules (already created in plan 01)
- NEVER split into multiple files (Pitfall #4)

From 02-CONTEXT.md D-12 — serialization contract:
- Step input/output = plain JSON only
- Convert TIMESTAMPTZ to ISO strings at step boundaries
- No Date objects, Maps, class instances, Buffer, or functions cross step boundaries

From 02-CONTEXT.md D-13 — Edge Config inside steps:
- Read Edge Config values INSIDE step functions
- Sample-once-and-store: `no_show_deadline` computed ONCE at called transition, written to row, used by all subsequent calculations

From 02-CONTEXT.md D-16 — router rule:
- grep pattern for code review: `grep -nE 'Math\.random|crypto\.randomUUID|Date\.now|fetch\(|sql\`|redis\.' lib/workflows/reservation.ts | grep -v '"use step"'` should return zero hits in router body

From ARCHITECTURE.md Pattern 2 — hook-resume in-process:
- Staff API calls `callHook.resume(id, {})` directly (in-process, no HTTP)
- Workflow waits via `hook.create({ token })` + `Promise.race`

From ARCHITECTURE.md Critical Journey 2 — called flow:
1. Staff calls → `callHook.resume(id, {})`
2. Workflow wakes → step updates status='called', called_at, no_show_deadline
3. Publishes KV events: `reservation:<id>` + `queue:active`
4. Enters followup phase → sleep(followup_after_call_min) → proactive followup

From ARCHITECTURE.md Critical Journey 3 — extend flow:
1. Diner requests extend → `extendHook.resume(id, {})`
2. Workflow wakes → `no_show_deadline += extension_min`, `extension_count++`
3. Publishes KV events

From ARCHITECTURE.md Critical Journey 4 — no-show:
1. No event arrives before deadline → timeout fires
2. Step updates status='no_show', ended_at=now
3. Publishes KV events
4. Workflow ends

From STACK.md — WDK API patterns:
```typescript
import { defineHook, sleep } from "workflow";

const callHook = defineHook<{ type: string }>();
const extendHook = defineHook<{ type: string }>();
const cancelHook = defineHook<{ type: string }>();
const seatedHook = defineHook<{ type: string }>();

export async function reservationWorkflow(reservationId: string) {
  "use workflow";

  // Router body: only control flow
  // All IO, time, randomness inside "use step" functions
}
```

From 02-CONTEXT.md D-37 — resumeHook in-process:
- `resumeHook` imported from `workflow/api`
- Called directly from staff API endpoints
- NEVER `fetch()` back to a workflow endpoint

From 02-CONTEXT.md D-10 — DB-backed safety net:
- Workflow timeout branches re-query `reservation_events` for missed events before re-entering the race
- Pattern: `SELECT * FROM reservation_events WHERE reservation_id = $1 AND id > $last_seen_event_id ORDER BY id ASC`
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Create lib/workflows/reservation.ts — full reservation lifecycle workflow</name>
  <files>lib/workflows/reservation.ts</files>
  <read_first>
    - .planning/phases/02-backend-core/02-CONTEXT.md D-08 to D-16 (all workflow decisions)
    - .planning/phases/02-backend-core/02-CONTEXT.md D-11 (single file discipline)
    - .planning/research/ARCHITECTURE.md Patterns 2–5, Critical Journeys 2–4
    - .planning/research/PITFALLS.md #1, #2, #3, #4 (workflow pitfalls)
    - .planning/phases/02-backend-core/02-01-spikes-skew-PLAN.md (spike findings in _README.md)
  </read_first>
  <action>
    1. Create `lib/workflows/reservation.ts` with the following structure:

       **File header:**
       ```typescript
       // lib/workflows/reservation.ts
       // 'use workflow' — single file, frozen shape (D-11, Pitfall #4)
       // Only step BODIES may change after Phase 2. Never step count or order.
       ```

       **Imports:**
       ```typescript
       "use workflow";
       import { defineHook, sleep } from "workflow";
       import { sql } from "@/lib/db/neon";
       import { getConfig } from "@/lib/edge-config";
       import { publishReservationEvent, publishQueueEvent } from "@/lib/realtime";
       import { log } from "@/lib/log";
       ```

       **Hook definitions (phase-specific tokens per D-08):**
       ```typescript
       // Hook for staff "call" action — parked at :waiting phase
       const callHook = defineHook<{ type: "call" }>();

       // Hook for diner "extend" action — active during called phases
       const extendHook = defineHook<{ type: "extend" }>();

       // Hook for diner "cancel" action — active during called phases
       const cancelHook = defineHook<{ type: "cancel" }>();

       // Hook for staff "seated" action — active during called phases
       const seatedHook = defineHook<{ type: "seated" }>();
       ```

       **Step functions (all "use step", all IO inside):**

       ```typescript
       // Step: Load reservation row and compute initial state
       async function loadReservation(id: string) {
         "use step";
         const rows = await sql`SELECT * FROM reservations WHERE id = ${id}`;
         if (!rows[0]) throw new Error(`Reservation ${id} not found`);
         const row = rows[0];
         // Convert TIMESTAMPTZ to ISO strings (D-12 serialization)
         return {
           id: row.id,
           status: row.status,
           position: row.position,
           eta_min: row.eta_min,
           extension_count: row.extension_count,
           no_show_deadline: row.no_show_deadline ? new Date(row.no_show_deadline).toISOString() : null,
           called_at: row.called_at ? new Date(row.called_at).toISOString() : null,
           ended_at: row.ended_at ? new Date(row.ended_at).toISOString() : null,
           active_hook_token: row.active_hook_token,
         };
       }

       // Step: Update reservation status and persist
       async function updateReservation(id: string, updates: { status: string; [key: string]: unknown }) {
         "use step";
         const sets = Object.entries(updates)
           .map(([k, v]) => `${k} = ${typeof v === "string" ? `'${v}'` : v}`)
           .join(", ");
         await sql`UPDATE reservations SET ${sql.raw(sets)} WHERE id = ${id}`;
         log.info("workflow.step.update_reservation", { reservation_id: id, status: updates.status });
       }

       // Step: Publish KV events for realtime fan-out
       async function publishEvents(id: string, type: string, extra: Record<string, unknown> = {}) {
         "use step";
         await Promise.all([
           publishReservationEvent(id, { type, reservation_id: id, occurred_at: new Date().toISOString(), ...extra }),
           publishQueueEvent({ reservation_id: id, type, occurred_at: new Date().toISOString(), ...extra }),
         ]);
       }

       // Step: Read Edge Config values (sample-once-and-store discipline)
       async function loadEdgeConfig() {
         "use step";
         return {
           no_show_timeout_min: Number(await getConfig("no_show_timeout_min") ?? 15),
           followup_after_call_min: Number(await getConfig("followup_after_call_min") ?? 1),
           extension_min: Number(await getConfig("extension_min") ?? 5),
           max_extensions_per_ticket: Number(await getConfig("max_extensions_per_ticket") ?? 2),
         };
       }

       // Step: Check for missed events (DB-backed safety net, D-10)
       async function getMissedEvents(reservationId: string, lastEventId: number | null) {
         "use step";
         const rows = await sql`
           SELECT * FROM reservation_events
           WHERE reservation_id = ${reservationId}
             AND ${lastEventId !== null ? sql`id > ${lastEventId}` : sql`true`}
             AND event_type IN ('call_requested','extend_requested','cancel_requested','seated_requested')
           ORDER BY id ASC
         `;
         return rows.map((r) => ({
           id: r.id,
           type: r.event_type,
           payload: r.payload,
         }));
       }

       // Step: Update active_hook_token in DB
       async function setHookToken(id: string, token: string) {
         "use step";
         await sql`UPDATE reservations SET active_hook_token = ${token} WHERE id = ${id}`;
       }
       ```

       **Main workflow function (router body — only control flow):**
       ```typescript
       export async function reservationWorkflow(reservationId: string) {
         "use workflow";

         // === PHASE 1: WAITING ===
         // Load reservation and set initial hook token
         const reservation = await loadReservation(reservationId);
         await setHookToken(reservationId, `reservation:${reservationId}:waiting`);

         // Wait for call, extend, or cancel (extend/cancel should not happen while waiting,
         // but we handle it gracefully)
         const edgeConfig = await loadEdgeConfig();
         let lastEventId: number | null = null;

         while (reservation.status === "waiting") {
           // Check for missed events (safety net)
           const missed = await getMissedEvents(reservationId, lastEventId);
           for (const event of missed) {
             if (event.type === "call_requested") {
               // Advance to called phase
             }
             lastEventId = event.id;
           }

           // Race: wait for call hook OR timeout (recompute ETA periodically)
           const recomputeInterval = Number(await getConfig("eta_recompute_interval_sec") ?? 60);
           const result = await Promise.race([
             callHook.waitFor({ token: `reservation:${reservationId}:waiting` }),
             sleep(`${recomputeInterval}s`),
           ]);

           if (result === callHook) {
             // Staff called the diner — advance to called phase
             break;
           }

           // Timeout: recompute ETA and update position
           // (deterministic formula in Phase 2, see D-36)
           await recomputeETA(reservationId);
         }

         // === PHASE 2: CALLED (pre — followup window) ===
         // Mark as called, set no_show_deadline, enter followup window
         await markCalledPhase(reservationId, edgeConfig);

         // === PHASE 3: CALLED (final — extend/cancel/seated window) ===
         // Wait for extend, cancel, seated, or no-show timeout
         await calledPhase(reservationId, edgeConfig);

         // Workflow ends
         log.info("workflow.completed", { reservation_id: reservationId });
       }
       ```

       **Phase helper functions (inline async, called from router):**
       ```typescript
       async function markCalledPhase(id: string, config: Awaited<typeof loadEdgeConfig>) {
         "use step";
         // Update status to 'called'
         // Set no_show_deadline = now + no_show_timeout_min (sampled from Edge Config ONCE)
         // Set called_at = now
         // Set active_hook_token = reservation:<id>:called:pre
         // Publish KV events
         // Sleep followup_after_call_min, then send proactive followup
       }

       async function calledPhase(id: string, config: Awaited<typeof loadEdgeConfig>) {
         "use step";
         // Set active_hook_token = reservation:<id>:called:final
         // Race: seated OR extend OR cancel OR no_show_deadline timeout
         // On seated: update status='seated', ended_at=now
         // On extend: no_show_deadline += extension_min, extension_count++
         // On cancel: update status='cancelled'
         // On timeout: update status='no_show', ended_at=now (empathic message via KV)
       }

       async function recomputeETA(id: string) {
         "use step";
         // Deterministic formula: position * avg_turnover_min from Edge Config
         // Update position and eta_min in DB
       }
       ```

       Note: The exact implementation will follow the WDK API as documented in `STACK.md`. The key structural requirements are:
       - Router body contains ONLY control flow (`if`, `for`, `Promise.race`, `await`)
       - All IO, time, randomness, external calls inside `"use step"` functions
       - Three phase transitions with distinct hook tokens
       - DB-backed safety net: re-query `reservation_events` on timeout exits
       - Serialization: all step returns are plain JSON (TIMESTAMPTZ → ISO strings)
       - Edge Config read inside steps, sampled once at called transition
   </action>
   <verify>
     <automated>test -f lib/workflows/reservation.ts && grep -q '"use workflow"' lib/workflows/reservation.ts && grep -q '"use step"' lib/workflows/reservation.ts && grep -q 'callHook' lib/workflows/reservation.ts && grep -q 'extendHook' lib/workflows/reservation.ts && grep -q 'seatedHook' lib/workflows/reservation.ts && grep -q 'cancelHook' lib/workflows/reservation.ts && grep -q 'Promise.race' lib/workflows/reservation.ts && grep -q 'reservation_events' lib/workflows/reservation.ts</automated>
   </verify>
   <acceptance_criteria>
     - `lib/workflows/reservation.ts` exists with `"use workflow"` directive
     - 4 hooks defined: callHook, extendHook, seatedHook, cancelHook
     - Router body contains ONLY control flow (no IO, time, randomness, external calls)
     - All side effects inside `"use step"` async functions
     - Three hook token phases: `:waiting`, `:called:pre`, `:called:final`
     - `Promise.race([hook, sleep(...)])` pattern used for timeouts
     - DB-backed safety net: timeout branches re-query `reservation_events`
     - Serialization contract: TIMESTAMPTZ → ISO strings at step boundaries
     - Edge Config reads inside step functions, not at module load
     - Uses `sql` from `@/lib/db/neon`, `getConfig` from `@/lib/edge-config`, `publish*` from `@/lib/realtime`, `log` from `@/lib/log`
   </acceptance_criteria>
   <done>
     `lib/workflows/reservation.ts` is the durable reservation lifecycle state machine. Waiting → Called → Seated|no_show|cancelled with extend branch. Shape frozen per D-11.
   </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Workflow step → Postgres | Uses `lib/db/neon.ts` (HTTP); safe from workflow steps |
| Workflow step → KV | Uses `lib/realtime.ts` helpers (one-shot publish); never subscribes |
| Workflow step → Edge Config | Uses `getConfig()` from `@/lib/edge-config`; read-once discipline |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-02-04-01 | Tampering | Workflow shape change during deploy | mitigate | Skew Protection (D-17) pins runs to deployment version; shape frozen (D-11) |
| T-02-04-02 | Information Disclosure | PII in workflow logs | mitigate | All logging goes through `log.*` from `lib/log.ts` (D-21) |
| T-02-04-03 | Information Disclosure | Edge Config leak at module load | mitigate | D-13: all reads inside step functions |
| T-02-04-04 | Denial of Service | Infinite loop in reservation loop | accept | Loop condition: `reservation.status === "waiting"`; status only changes via DB update inside a step |

</threat_model>

<verification>
**End-to-end checks for this plan:**
1. `grep -q '"use workflow"' lib/workflows/reservation.ts` → workflow directive present
2. `grep -q '"use step"' lib/workflows/reservation.ts` → step functions present
3. `grep -q 'callHook' lib/workflows/reservation.ts` → call hook defined
4. `grep -q 'extendHook' lib/workflows/reservation.ts` → extend hook defined
5. `grep -q 'seatedHook' lib/workflows/reservation.ts` → seated hook defined
6. `grep -q 'cancelHook' lib/workflows/reservation.ts` → cancel hook defined
7. `grep -q 'Promise.race' lib/workflows/reservation.ts` → race pattern used
8. `grep -q 'reservation_events' lib/workflows/reservation.ts` → DB safety net present
9. `grep -nE 'Math\.random|crypto\.randomUUID|Date\.now|fetch\(' lib/workflows/reservation.ts | grep -v '"use step"'` → zero hits in router body
10. `npm run build` → compiles with workflow plugin

</verification>

<success_criteria>
1. **Workflow file exists:** `lib/workflows/reservation.ts` with `"use workflow"` directive.
2. **Router rule enforced:** Router body contains only control flow; all IO inside `"use step"` functions.
3. **Three hook phases:** `:waiting`, `:called:pre`, `:called:final` tokens defined and used.
4. **Race pattern:** `Promise.race([hook, sleep(...)])` used for every timeout.
5. **DB safety net:** Timeout branches re-query `reservation_events` for missed events.
6. **Serialization:** TIMESTAMPTZ converted to ISO strings at step boundaries.
7. **Edge Config inside steps:** All reads inside step functions, sampled once at called transition.
</success_criteria>

<output>
After completion, create `.planning/phases/02-backend-core/02-04-workflow-SUMMARY.md` documenting:
- Workflow structure (phases, hooks, step functions)
- Any WDK API adjustments made during implementation
- Build results (does `npm run build` succeed with the workflow file?)
- Any deviations from the spec
</output>
