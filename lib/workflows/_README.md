# Workflow Discipline — Reservation Workflow

> **FROZEN at end of Phase 2.** Only step BODIES may change. Never step count, never step order. New steps land at the END of the workflow function or behind Edge Config feature flags. Adding/removing/reordering steps in a deployed WDK workflow breaks in-flight reservations across deploys (Pitfall #4).

This file is the LIVING CONTRACT for `lib/workflows/reservation.ts`. Every commitment that affects workflow durability is documented HERE before the code that enforces it lands. If you are about to touch `reservation.ts`, read this first.

Source decisions: `.planning/phases/02-backend-core/02-CONTEXT.md` D-08 through D-17, D-37; `.planning/research/PITFALLS.md` #1, #2, #3, #4, #14; `.planning/research/ARCHITECTURE.md` §3.5.

---

## The Router Rule (Pitfall #1, D-16)

The workflow function is a **router**, not a worker. Everything that touches IO, time, randomness, or external services lives inside a `"use step"` async function. The router body only contains control flow: `if`, `for`, `Promise.race`, `await` of step calls.

**WRONG (router-level side effects — bans for `reservation.ts`):**

```ts
// All of these are FORBIDDEN at the router level:
Date.now()
crypto.randomUUID()
Math.random()
await fetch(...)
await sql`SELECT ...`
await redis.publish(...)
await getConfig("...")     // Edge Config too — see "Edge Config Inside Steps" below
```

**RIGHT (router calls steps; steps do the work):**

```ts
"use workflow";

export async function reservationWorkflow(input: { id: string }) {
  const row = await loadReservation(input.id);     // step
  await markCalled(input.id);                       // step
  using hook = createHook(`reservation:${input.id}:waiting`);
  const winner = await Promise.race([hook, sleep("15m")]);
  if (winner === "timeout") {
    await markNoShow(input.id);                     // step
  }
}
```

### Pre-merge code review checklist (D-16)

Run before any PR that touches `lib/workflows/reservation.ts`:

```bash
grep -nE 'Math\.random|crypto\.randomUUID|Date\.now|fetch\(|sql`|redis\.|getConfig\(' \
  lib/workflows/reservation.ts | grep -v '"use step"'
```

Expected output: zero hits in the router-level body. Any hit = block the merge.

---

## Serialization Contract (Pitfall #3, D-12)

Every `"use step"` function input and output is **plain JSON**. Workflow runtime serializes step boundaries; non-serializable values silently corrupt or throw.

| Forbidden across step boundaries | Use instead |
|---|---|
| `Date` instance | ISO 8601 string (`new Date().toISOString()`) |
| `Map` / `Set` | Plain object / array |
| `Buffer` / `Uint8Array` | Base64 string |
| Class instances | Plain object literal (extract fields) |
| Functions / closures | Identifiers + dispatch table |

DB row reads MUST project the specific columns the workflow needs and convert all `TIMESTAMPTZ` fields to ISO strings before returning from the step.

Plan 02-04 ships `__tests__/workflow-step-serialization.test.ts` that round-trips every step's return value through `JSON.parse(JSON.stringify(x))` and asserts deep equality.

---

## Hook Token Convention (D-08)

Hook tokens are **phase-specific**. Three tokens per reservation, one workflow function, transitions are linear:

| Token | When the workflow is parked at this token | Resumed by |
|---|---|---|
| `reservation:<id>:waiting` | Initial parking after `create_reservation` | `markCalled` (staff API `/api/queue/[id]/call`) |
| `reservation:<id>:called:pre` | 1-min followup window between `called` and the proactive "¿Estás en camino?" message | Diner reply via MCP (`extend_wait`/`cancel_reservation`) or `markSeated` |
| `reservation:<id>:called:final` | Post-followup window where extend/cancel/seated land before the `no_show_deadline` timeout | Same as `called:pre` |

The workflow writes the active token to `reservations.active_hook_token` at each phase transition. Staff API endpoints **MUST** read this column before calling `resumeHook` — never hardcode a token.

---

## Schema Addition (D-09)

Plan 02-04 ships forward-only migration `db/migrations/0002_workflow_active_hook.sql`:

```sql
ALTER TABLE reservations ADD COLUMN active_hook_token TEXT NULL;
```

The existing `scripts/db-migrate.ts` runner picks this up via `_migrations` tracking. No backfill needed — the `reservations` table is empty at end of Phase 1.

---

## DB-Backed Safety Net (D-10) — MANDATORY

Every action that triggers a workflow event (call/extend/cancel/seated) does, in this exact order:

1. `INSERT INTO reservation_events (reservation_id, event_type, payload)` with `event_type ∈ {call_requested, extend_requested, cancel_requested, seated_requested}`.
2. `await resumeHook(token, payload)` (in-process — see "Hook Resume In-Process" below).

The workflow's timeout branches (the `sleep(...)` arms of every `Promise.race`) re-emerge and immediately:

```sql
SELECT * FROM reservation_events
WHERE reservation_id = $1
  AND id > $last_seen_event_id
  AND event_type IN ('call_requested','extend_requested','cancel_requested','seated_requested')
ORDER BY id ASC
```

Any missed events are processed in order BEFORE re-entering the next race.

Spike B (see "Spike Findings" below) records that we treat `createHook()` as **non-buffering** and ship this safety net as the primary delivery path. If a later runtime test proves buffering is present, the safety net becomes redundant — not wrong. Either way, it ships in plan 02-03 / 02-04.

---

## Hook Resume In-Process (ARCHITECTURE §3.5, D-37)

`resumeHook` is imported from `workflow/api` and called **directly** from staff API endpoints (and from `scripts/seed-demo.ts`). NEVER `fetch()` back to a workflow endpoint. HTTP self-calls are an architectural anti-pattern (ARCHITECTURE Anti-Pattern 1) — they double serverless invocations, defeat connection pooling, and create cyclic timeout dependencies.

```ts
// CORRECT — staff API endpoint:
import { resumeHook } from "workflow/api";
await resumeHook(`reservation:${id}:waiting`, { type: "call" });

// WRONG — never do this:
await fetch(`${process.env.VERCEL_URL}/api/internal/resume-hook`, { ... });
```

---

## Edge Config Inside Steps (Pitfall #14, D-13)

All Edge Config reads happen **inside** `"use step"` functions, never at module load and never in the router body. Module-load reads run on cold-start before request context is established and can hang the entire function.

**Sample-once-and-store discipline:** `no_show_deadline` is computed ONCE at the `called` transition step using the `no_show_timeout_min` value sampled THEN, written to `reservations.no_show_deadline`, and used by ALL subsequent timeout calculations for that ticket. Dashboard edits to `no_show_timeout_min` mid-deadline do NOT retroactively shift an existing ticket — narrate this honestly in the demo.

The 6 Edge Config keys (seeded in Phase 1) Phase 2 reads:

- `no_show_timeout_min`
- `followup_after_call_min`
- `extension_min`
- `max_extensions_per_ticket`
- `eta_recompute_interval_sec`
- `colors_by_party_size`

Do NOT add new keys in Phase 2. Phase 3 may add for chatbot/panel concerns.

---

## Compensating Action on `workflow.start` Failure (D-14, ARCHITECTURE Pattern 1)

The service layer wraps `workflow.start(...)` in `try/catch`. On throw, it runs:

```sql
UPDATE reservations SET status='failed_to_start' WHERE id = $1
```

…and re-throws so the caller sees the failure. Active-queue queries filter `status NOT IN ('failed_to_start','seated','no_show','cancelled')`. The DB row is left in place (not deleted) for forensic audit during the pilot.

---

## Freeze-Shape Commitment (Pitfall #4, D-11)

After Phase 2 ships, `lib/workflows/reservation.ts` is FROZEN in shape. The contract:

| Allowed change | Why it's safe |
|---|---|
| Step BODY changes (e.g., swap deterministic ETA for `@workflow/ai/agent` in `recompute_eta`) | Step boundary is unchanged; in-flight runs continue to work |
| Append a NEW step at the END of the workflow function | In-flight runs that have already passed previous steps don't see the new step |
| Add a step BEHIND an Edge Config feature flag (`if (await getConfig("flag_x")) { await newStep(); }`) | Feature flag defaults to off; in-flight runs see the same shape they started with |

| Forbidden change | Why it breaks |
|---|---|
| Insert a step in the MIDDLE of the function | In-flight runs replay step indices and crash |
| Reorder existing steps | Same as middle-insert — replay mismatch |
| Remove a step | In-flight runs that expect that step crash |
| Split `reservation.ts` into multiple files (e.g., `reservation/index.ts + steps.ts`) | File count is part of the workflow shape (Pitfall #4) — risks breaking in-flight runs across deploys |

If you need a structural change after Phase 2, the procedure is:

1. Drain in-flight reservations to terminal state (manual maître ops).
2. Deploy the structural change.
3. Document the migration in this README under "Shape History".

---

## Spike Findings (D-15)

### Spike A — TS `using` keyword on Vercel Node 20 — **PASS**

`scripts/spike-using-keyword.ts` allocates a `Disposable`, enters a block-scoped `using _r = resource` binding, and asserts `Symbol.dispose` fires when the scope exits. Local result on Node 20.19.4: PASS.

**Decision:** `lib/workflows/reservation.ts` is cleared to use `using hook = createHook(...)`. Auto-disposal is preferred over manual `try/finally` because it removes a class of side-effect bugs in the router body.

**Vercel preview verification** on the production Node 20 runtime is deferred to the first push that exercises the workflow runtime (plan 02-04 or later). If that preview build fails the `using` lowering, the fallback is:

```ts
const hook = createHook(token);
try {
  return await Promise.race([hook, sleep("15m")]);
} finally {
  await hook.dispose();
}
```

### Spike B — `createHook()` event buffering — **ASSUMED NO BUFFERING** (pessimistic)

`scripts/spike-hook-buffering.ts` records the decision rather than running a full runtime test. Reasoning: a full test requires a deployed workflow instance + a parallel `resumeHook` caller + Vercel event-bus mediation, which is significantly more setup than the 30-minute spike budget allows AND **does not change the implementation outcome** — D-10 (DB-backed safety net) ships regardless.

**Decision:** Treat `createHook()` as NON-BUFFERING. D-10 is the **primary** delivery path. If a later runtime test proves buffering is present, the safety net becomes redundant — not wrong. This is the safer failure mode for the hackathon demo and the same-week pilot.

---

## Money-Shot Rehearsal (D-31)

The "money shot" is `git push origin main` with active reservations in flight, all of them surviving the deploy and continuing to progress on the new code. This is the ONE demo that validates the project's core value.

### Hard prerequisites (block the rehearsal)

1. **Skew Protection is ENABLED in the Vercel dashboard** (D-17). Project → Settings → Skew Protection → Enable. Without this, in-flight workflows pin to a deployment that gets garbage-collected and break.
2. `npm run build` succeeds locally with the workflow plugin (verified end of plan 02-01).
3. Plan 02-08's `scripts/smoke-money-shot.sh` exists and exits 0 against production.

### Manual ritual (run before any demo)

1. Verify Skew Protection is enabled (dashboard check).
2. `npm run seed:demo` — gives you 3 live reservations (1 `waiting`, 1 `called`, 1 `seated`) using the real `createReservation()` service.
3. Make a trivial commit (e.g., bump a comment in this README) and `git push origin main`.
4. Watch the Vercel Workflow dashboard + run `SELECT id, status, updated_at FROM reservations ORDER BY updated_at DESC` to confirm in-flight runs continue progressing on the new deployment.
5. After ~5 minutes, the `waiting` reservation should still be in `waiting`, the `called` reservation should still be in `called`, and any subsequent maître action (call/seated) should advance them as expected.

### Automated smoke (`scripts/smoke-money-shot.sh`, plan 02-08)

The bash version:

1. Creates 2 reservations via the MCP `create_reservation` tool, captures both `(reservation_id, session_token)` pairs.
2. Sleeps 3s for workflows to settle into their `:waiting` race.
3. Echoes the `git push origin main` command for the operator to run (NOT auto-executed — the operator confirms a no-op commit). Records the timestamp.
4. Polls each `/api/events/<id>?session_token=<token>` SSE for 60s with `curl -N`. Asserts each receives at least one `event: snapshot` and that subsequent `eta_min` updates arrive AFTER the deploy timestamp.
5. Exits 0 if both reservations show post-deploy activity, non-zero with the failing `reservation_id` otherwise.

---

## Code Review Checklist for `lib/workflows/reservation.ts`

Before any PR touching this file, run all four:

```bash
# 1. Router-level side effects (Pitfall #1)
grep -nE 'Math\.random|crypto\.randomUUID|Date\.now|fetch\(|sql`|redis\.|getConfig\(' \
  lib/workflows/reservation.ts | grep -v '"use step"'
# Expected: zero hits.

# 2. Date/Map/Buffer crossing step boundaries (Pitfall #3)
grep -nE 'new Date\(|new Map\(|new Set\(|Buffer\.' lib/workflows/reservation.ts
# Inspect each hit — must be inside a step AND not in the return value.

# 3. Hardcoded hook tokens in staff API endpoints (D-08)
grep -nrE 'reservation:[a-z0-9-]+:(waiting|called)' app/api/queue/
# Expected: zero hits — tokens come from reservations.active_hook_token.

# 4. HTTP self-call to workflow endpoints (ARCHITECTURE Anti-Pattern 1)
grep -nE 'fetch\([^)]*workflow' app/api/ lib/services/
# Expected: zero hits — resumeHook is imported in-process.
```

---

## Cross-References for Later Phases

- **Phase 3 — `/api/chat`:** Calls services DIRECTLY (D-36), NOT via `experimental_createMCPClient` in-process roundtrip. The MCP server stays as the public interface for FUTURE clients (WhatsApp, raw curl).
- **Phase 3 — AI SDK telemetry:** Routes through `lib/log.ts → redactPII` (D-22). The `experimental_telemetry` config + tool-call lifecycle hooks scrub before logging.
- **Phase 3 — DurableAgent ETA:** Wraps the SAME `recompute_eta` step body in `@workflow/ai/agent`. Step BODY change is safe per the freeze rule above.

---

## Implementation Notes (plan 02-04)

`lib/workflows/reservation.ts` shipped on 2026-04-26 with the FROZEN shape below. After Phase 2 ends, only step **bodies** change — the structure here is locked per Pitfall #4 / D-11.

### Hook definitions (module top)

```ts
import { defineHook, sleep } from "workflow";

export const callHook         = defineHook<{ type: "call" }>();
export const extendHook       = defineHook<{ type: "extend"; new_deadline: string; extension_count: number }>();
export const cancelHook       = defineHook<{ type: "cancel" }>();
export const seatedHook       = defineHook<{ type: "seated" }>();
export const noShowManualHook = defineHook<{ type: "no_show_manual" }>();
```

The workflow uses the typed `.create({token})` form inside the function body. The service layer (`lib/services/reservations.ts` + `lib/services/queue.ts`) currently uses the lower-level `resumeHook(tokenString, payload)` from `workflow/api` against tokens read from `reservations.active_hook_token` — that pattern is preserved from plan 02-03 and stays working. The typed `.resume()` form is forward-compat for Phase 3+.

### Step inventory (FROZEN — count + order)

| Index | Function | Returns (plain JSON) | Notes |
|---|---|---|---|
| 1 | `loadReservationSnapshot(id)` | `ReservationSnapshot \| null` | All TIMESTAMPTZ as ISO strings via `::text` projection |
| 2 | `setActiveHookToken(id, token)` | `{ token, written_at }` | UPDATE before each new hook (so staff API can resume) |
| 3 | `loadEdgeConfigSnapshot()` | `EdgeConfigSnapshot` | Sample-once-and-store (D-13) |
| 4 | `fetchMissedEvents(id, lastSeenEventId)` | `MissedEvent[]` | DB-backed safety net (D-10) — every timeout calls this |
| 5 | `applyCallTransition(id, noShowTimeoutMin)` | `{ no_show_deadline, called_at, event_id }` | Persists `no_show_deadline = now + timeout` ONCE |
| 6 | `emitFollowupPush(id, message)` | `{ event_id }` | Records workflow_followup event + KV publish |
| 7 | `reloadDeadlineAfterExtend(id)` | `{ no_show_deadline, extension_count }` | Re-reads row after service-layer extendWait wrote |
| 8 | `applyNoShowTransition(id, source)` | `{ event_id, ended_at }` | Terminal — workflow timeout path |
| 9 | `acknowledgeTerminal(id, reason)` | `{ event_id }` | Clears active_hook_token after seated/cancel/no_show_manual |
| 10 | `computeRemainingSeconds(isoDeadline)` | `{ seconds }` | Where `Date.now()` lives — router-forbidden (D-16) |

### Router phases

The workflow function body is a 3-phase router:

1. **Phase 1: WAITING** — token `reservation:<id>:waiting`. `Promise.race(callHook, cancelHook, sleep(eta_recompute_interval_sec))`. On timeout, replay missed events; ignore any while-waiting `extend`/`seated`.
2. **Phase 2: CALLED — :called:pre window** — token `reservation:<id>:called:pre`. After `applyCallTransition` writes `no_show_deadline` ONCE (D-13), race all four hook arms (call/extend/cancel/seated/no_show_manual) against `sleep(followup_after_call_min)`. Followup push emits at end of window unless an event lands first.
3. **Phase 3: CALLED — :called:final window** — token `reservation:<id>:called:final`. Race extend/cancel/seated/no_show_manual against `sleep(remainingSeconds)` where `remainingSeconds` is computed by `computeRemainingSeconds` against the live `no_show_deadline`. On timeout, replay missed events; if still expired, transition to no_show.

Per-event-type sub-tokens (e.g. `:called:pre:extend`, `:called:final:cancel`) let multiple hook arms park on the same phase concurrently. The DB-tracked `active_hook_token` stays at the phase root token (`:called:pre` / `:called:final`) so the service layer's `resumeHook(tokenString, ...)` calls keep working with the existing column.

### Service-layer integration

`lib/services/reservations.ts → createReservation` calls `start(reservationWorkflow, [{ reservationId }])` (plan 02-04). On success, it persists `workflow_run_id` and `active_hook_token = "reservation:<id>:waiting"`. On failure (D-14), it sets `status='failed_to_start'` and returns `INTERNAL_ERROR` to the caller.

Active-queue queries (`lib/services/queue.ts → getActiveQueue`) filter `status NOT IN ('failed_to_start','seated','no_show','cancelled')`, so failed-to-start rows are forensic-only.

### Build / discovery note

The workflow plugin's eager builder (`@workflow/next/dist/builder-eager.js`) only scans files reachable from `app/`, `src/app/`, `pages/`, or `src/pages/` entrypoints (`route.ts`, `page.ts`, `layout.ts`). At end of plan 02-04, no app route imports `lib/services/reservations.ts` yet — so `npm run build` reports `Created manifest with N steps, 0 workflows`. That is **expected and correct** for this phase boundary. Discovery lights up in plan 02-05 (MCP route imports `createReservation`) and again in plan 02-07 (staff API endpoints import queue services).

TypeScript checking covers the workflow file regardless of discovery — the type check passing in `npm run build` is the gate, and it does pass.

---

## Shape History

*(Append entries here when the workflow shape changes after Phase 2 ships.)*

| Date | Plan | Change | Reason |
|---|---|---|---|
| 2026-04-26 | 02-04 | Initial shape: 10 step functions, 3 router phases, 5 typed hooks. FROZEN. | First implementation per plan 02-04. |
