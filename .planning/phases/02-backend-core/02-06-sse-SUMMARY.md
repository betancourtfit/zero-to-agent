---
phase: 02-backend-core
plan: 06
subsystem: api
tags: [sse, server-sent-events, upstash-redis, neon, nextjs-16, route-handler, realtime, snapshot-replay, last-event-id, auth-js]

# Dependency graph
requires:
  - phase: 02-backend-core
    provides: lib/services/queue.ts (getActiveQueue), lib/realtime.ts publishers (channel naming), lib/auth/auth.ts (auth() + employees.active gate), lib/db/neon.ts (sql HTTP client), lib/log.ts (PII-redacting logger)
  - phase: 01-foundation
    provides: schema.sql (reservations + reservation_events tables), Auth.js v5 setup with Resend, Upstash Redis env vars
provides:
  - "Diner SSE endpoint at /api/events/[reservation_id] with session_token gate and snapshot-replay-on-connect"
  - "Staff SSE endpoint at /api/events/queue with auth() + employees.active gate and active-queue snapshot"
  - "Pattern 3 (snapshot-replay-on-connect) reference implementation — Postgres = truth, KV = real-time hint"
  - "Last-Event-ID gap recovery using reservation_events.id as the cursor"
  - "Heartbeat + abort cleanup pattern other long-lived stream handlers can follow"
affects: [03-user-surfaces, 02-07-staff-api, 02-08-smoke]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pattern 3 (ARCHITECTURE §3.2): snapshot from Postgres FIRST, then subscribe to KV — never the other way around"
    - "Upstash Redis subscribe() returns Subscriber synchronously (not a Promise); message arrives auto-deserialized"
    - "req.signal.addEventListener('abort', ...) is the cleanup hook — clearInterval + sub.unsubscribe + controller.close"
    - "Next.js 16 dynamic route params is a Promise; must be awaited"
    - "Defense in depth on staff routes: lib/auth/auth.ts session callback already strips inactive employees, but routes re-check explicitly"

key-files:
  created:
    - app/api/events/[reservation_id]/route.ts
    - app/api/events/queue/route.ts
  modified: []

key-decisions:
  - "Upstash @upstash/redis v1.x subscribe returns a Subscriber synchronously, not a Promise — plan pseudocode (await redis.subscribe + redis.unsubscribe(sub)) was incorrect against the installed package surface; corrected to sub = redis.subscribe(...) + await sub.unsubscribe()"
  - "Auto-deserialization is on by default in @upstash/redis — message handlers receive parsed objects, not strings; do NOT JSON.parse(message) again or it crashes"
  - "Position is computed (not a column) — match service-layer computePosition() ordering; plan pseudocode SELECT ... position FROM reservations would fail at runtime"
  - "Staff auth gate matches by session.user.email (matches lib/auth/auth.ts session callback and app/queue/page.tsx) — schema does not expose user.id on session"
  - "maxDuration = 800 set as plan-spec'd (Pro + Fluid Compute ceiling); confirmed compiles cleanly under current Vercel plan"
  - "Last-Event-ID replay window bounded by snapshot's last_event_id — prevents racing past events that the snapshot already reflects"

patterns-established:
  - "SSE Route Handler shape: nodejs runtime + maxDuration 800 + force-dynamic + ReadableStream(start) + req.signal abort handler"
  - "Snapshot frame uses event 'snapshot' with id == COALESCE(MAX(reservation_events.id), 0) so clients can reconnect with Last-Event-ID set to the snapshot's id"
  - "All SSE event lines carry id: <reservation_events.id> for resumability (Pitfall #6)"
  - "Heartbeat as ': hb\\n\\n' SSE comment line every 25s — under typical proxy idle-cut (30s)"

requirements-completed: [PLAT-07]

# Metrics
duration: 5min
completed: 2026-04-26
---

# Phase 02 Plan 06: SSE Route Handlers Summary

**Two long-lived SSE handlers (`/api/events/[reservation_id]` for diners, `/api/events/queue` for staff) implementing snapshot-replay-on-connect — Postgres reads first, then `@upstash/redis` Subscriber attaches to per-reservation or queue:active channel, with Last-Event-ID gap recovery and abort-driven cleanup.**

## Performance

- **Duration:** ~5 min (commit timestamps 08:35:07 → 08:40:30 ART = 2026-04-26T11:35–11:40Z)
- **Tasks:** 2 (atomic, both first-pass)
- **Files created:** 2
- **Files modified:** 0
- **Build:** `Created manifest with 14 steps, 1 workflow, and 0 classes` — workflow count preserved (these routes do not import `lib/workflows/reservation.ts`)

## Accomplishments

- **Diner SSE** (`app/api/events/[reservation_id]/route.ts`, 276 lines): `?session_token=<uuid>` gate; snapshot includes status, computed position, eta_min, extension_count, no_show_deadline, called_at, last_event_id; per-reservation channel subscription; Last-Event-ID gap recovery scoped to `[lastEventIdFromClient, snapshot.last_event_id]`; heartbeat + abort cleanup.
- **Staff SSE** (`app/api/events/queue/route.ts`, 199 lines): `auth()` session check + explicit `employees.active = true` gate (defense in depth); snapshot wraps `getActiveQueue()` service-layer output (single source of truth shared with the staff panel page); subscribes to `queue:active`; same heartbeat + abort cleanup discipline.
- **Pattern 3 reference established:** Both routes follow the exact ordering — Postgres snapshot → SSE emit → optional gap-recover from `reservation_events` → KV subscribe → heartbeat → abort cleanup. Future SSE handlers (none planned in v1) can use these as templates.
- **Build manifest preserved:** Phase 02-04's `1 workflow` count holds — neither new route imports the workflow file (they only read DB and subscribe to KV per D-20).

## Task Commits

1. **Task 1: Diner SSE handler** — `855c737` (feat)
2. **Task 2: Staff SSE handler** — `15ad508` (feat)

**Plan metadata commit:** _(pending — final docs commit at end of run)_

## Files Created/Modified

- `app/api/events/[reservation_id]/route.ts` (created) — Per-reservation diner SSE endpoint. Validates `?session_token=<uuid>` against `reservations.session_token`. Snapshot reads (status, position, eta, extensions, deadlines) + Last-Event-ID replay + subscribe to `reservation:<uuid>` channel. Heartbeat 25s, abort-cleanup releases Upstash subscriber slot.
- `app/api/events/queue/route.ts` (created) — Staff queue SSE endpoint. Auth.js `auth()` + redundant `employees.active` lookup. Snapshot via `getActiveQueue()` service. Subscribes to `queue:active`. Same heartbeat + cleanup discipline.

## Decisions Made

1. **Upstash subscribe API correction.** The plan's pseudocode used `await redis.subscribe(...)` and `redis.unsubscribe(sub)`. Reading `node_modules/@upstash/redis/error-8y4qG0W2.d.ts` confirmed: `subscribe` returns a `Subscriber<TMessage>` synchronously, and `unsubscribe()` is a method on the Subscriber instance (returns `Promise<void>`). Corrected both routes to match the actual API. This is a Rule 1 deviation against the plan pseudocode but in alignment with the installed package — code would not have run otherwise.
2. **Auto-deserialization.** `@upstash/redis` Subscriber's default `automaticDeserialization: true` means `message` arrives parsed. The plan's `JSON.parse(message)` would have crashed on type mismatch. Removed the parse step; message handlers operate on the parsed object directly.
3. **`session.user.email` for staff auth, not `session.user.id`.** The Auth.js v5 session callback in `lib/auth/auth.ts` reads employees by email. The schema does not surface a numeric `id` on the session. Followed the established `app/queue/page.tsx` pattern for consistency.
4. **Computed `position`.** The reservations table has no `position` column. Matched the service-layer `computePosition()` algorithm (1-based index in active queue ordered by `created_at`).
5. **Last-Event-ID upper bound.** Replay range scoped to `[clientCursor, snapshot.lastEventId]` — events past `snapshot.lastEventId` arrive via the live KV subscriber. Prevents racing events the snapshot already reflects.
6. **Defense in depth on `employees.active`.** The session callback already returns `{...session, user: undefined}` for inactive employees, but the SSE route re-queries explicitly. Single audit point: looking at the route in isolation makes the security gate self-evident.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Plan pseudocode used wrong Upstash subscribe API**
- **Found during:** Task 1 (diner SSE handler)
- **Issue:** Plan's `<interfaces>` and ARCHITECTURE §3.2 pseudocode used `await redis.subscribe(...)` and `redis.unsubscribe(sub)`, which doesn't match `@upstash/redis@^1.x` (the installed version). The real API: `subscribe()` returns a `Subscriber` synchronously, and `unsubscribe()` is a method on the Subscriber.
- **Fix:** `const sub = redis.subscribe<...>(channel); ... await sub.unsubscribe();` in both handlers.
- **Files modified:** `app/api/events/[reservation_id]/route.ts`, `app/api/events/queue/route.ts`
- **Verification:** `SKIP_ENV_VALIDATION=1 npm run build` passes — TypeScript would have failed against the typings if the plan's shape were used.
- **Committed in:** `855c737`, `15ad508`

**2. [Rule 1 - Bug] Plan pseudocode would double-parse SSE messages**
- **Found during:** Task 1
- **Issue:** Plan's handler did `JSON.parse(message)` inside the subscriber callback. `@upstash/redis` ships with `automaticDeserialization: true` by default — `message` is already the parsed JSON object. Calling `JSON.parse` on an object would throw at runtime.
- **Fix:** Treat `message` as the already-parsed payload; type-narrow with a runtime `typeof message === 'object'` guard.
- **Files modified:** `app/api/events/[reservation_id]/route.ts`, `app/api/events/queue/route.ts`
- **Verification:** Type signature `redis.subscribe<Record<string, unknown>>(...)` flows through to the `({ channel, message })` callback param — message is `Record<string, unknown>`, not a string.
- **Committed in:** `855c737`, `15ad508`

**3. [Rule 1 - Bug] Plan SQL referenced non-existent `position` column**
- **Found during:** Task 1
- **Issue:** Plan's snapshot SQL did `SELECT ... position FROM reservations`. Schema (`db/schema.sql` line 49–66) has no `position` column — position is computed at read time per `lib/services/reservations.ts:computePosition()`.
- **Fix:** Added a local `computePosition(reservationId)` helper in the diner route mirroring the service-layer algorithm. Staff route uses `getActiveQueue()` which already includes computed position.
- **Files modified:** `app/api/events/[reservation_id]/route.ts`
- **Verification:** Build passes; semantics match the service-layer single source of truth.
- **Committed in:** `855c737`

**4. [Rule 3 - Blocking] Next.js 16 dynamic route params must be awaited**
- **Found during:** Task 1
- **Issue:** Plan pseudocode treated `params` as a sync object (`{ params }: { params: { reservation_id: string } }`). Next.js 16 typed `params` as `Promise<{...}>`; using it directly produces a TypeScript error and runtime warning.
- **Fix:** Signature changed to `{ params }: { params: Promise<{ reservation_id: string }> }` with an explicit `await` at the top of the handler.
- **Files modified:** `app/api/events/[reservation_id]/route.ts`
- **Verification:** `SKIP_ENV_VALIDATION=1 npm run build` (Next 16.2.4) passes with no params-related warnings.
- **Committed in:** `855c737`

**5. [Rule 1 - Bug] Plan staff auth used `session.user.id` (not present in this app's session)**
- **Found during:** Task 2 (staff SSE handler)
- **Issue:** Plan pseudocode looked up `employees WHERE id = ${session.user.id}`. Auth.js v5 session in this app surfaces `email`, not `id` — established by `lib/auth/auth.ts` session callback and `app/queue/page.tsx`.
- **Fix:** Re-checked `employees WHERE email = ${session.user.email}` to match the established pattern.
- **Files modified:** `app/api/events/queue/route.ts`
- **Verification:** Build passes; consistent with how `lib/auth/auth.ts` itself reads employees.
- **Committed in:** `15ad508`

---

**Total deviations:** 5 auto-fixed (4× Rule 1 — bugs in plan pseudocode against installed APIs / actual schema; 1× Rule 3 — Next.js 16 framework signature change). Zero scope creep — every fix preserves the plan's intent.

**Impact on plan:** Plan's spec-level intent (Pattern 3 + auth gates + heartbeat + cleanup) executed exactly. Pseudocode-level deviations are mechanical corrections needed to make the file compile and run against `@upstash/redis@^1.x`, Next.js 16, and the actual database schema. No design decisions changed.

## Issues Encountered

- Skill tool injection (`Skill(bootstrap)`, `Skill(auth)`, `Skill(vercel-functions)`, `Skill(next-cache-components)`, `Skill(sign-in-with-vercel)`, `Skill(workflow)`, `Skill(observability)`) was requested by hooks but the Skill tool is not available in this agent environment. The plan's `<interfaces>` block locks the route handler shape (D-26), and the codebase pattern (lib/auth/auth.ts, lib/log.ts, lib/realtime.ts) is the project's established truth. Followed those rather than guessing at upstream docs.
- Vercel post-write validation flagged "long-running logic" on both files. SSE streams are intentionally long-lived (`maxDuration = 800` per D-26); they cannot be moved to Vercel Workflow because workflows are the upstream publisher and SSE handlers are the downstream subscriber edge — the split is a CLAUDE.md commitment ("Subscription is ONLY in SSE Route Handlers").
- Vercel post-write validation also flagged "no observability." Both routes log via `lib/log.ts` (info/warn/error at every meaningful state transition: connect, unauthorized, replay, subscriber_error, unsubscribe_failed, disconnect) — the project's standardized SAFE-01 sink (D-21). The validator is matching against generic patterns and doesn't see the indirect log calls.

## Threat Flags

None — no new security surface beyond what's listed in the plan's `<threat_model>`. Both threats (T-02-06-02 unauthorized staff access, T-02-06-03 connection leak DoS) have explicit mitigations as planned: 401 short-circuits + abort-driven `sub.unsubscribe()`.

## User Setup Required

None — no external service configuration needed. The handlers consume existing env vars (`DATABASE_URL`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, `AUTH_SECRET`).

## Verification Run

```
SKIP_ENV_VALIDATION=1 npm run build
↳ Created manifest with 14 steps, 1 workflow, and 0 classes
↳ ✓ Compiled successfully in 2.4s
↳ Routes registered:
  ƒ /api/events/[reservation_id]
  ƒ /api/events/queue
```

Per-task automated `<verify>` blocks — both passed all 10/10 grep assertions (runtime, maxDuration, force-dynamic, auth checks, snapshot, subscribe/unsubscribe, hb).

## Next Phase Readiness

- **Ready for 02-07 (staff API endpoints):** Staff API will publish to KV via `lib/realtime.ts`; `/api/events/queue` is now wired to receive those publishes and replay them.
- **Ready for 02-08 (money-shot smoke):** SSE channels will be the visible signal during the deploy-mid-flight rehearsal — the diner browser tab consumes `/api/events/[reservation_id]` and stays alive across the redeploy thanks to the snapshot-replay-on-connect contract. B2 (Skew Protection) toggle still gates 02-08, not 02-06.
- **Phase 03 readiness:** Diner chatbot (Phase 03) calls `useEffect(() => new EventSource(`/api/events/${reservation_id}?session_token=...`))` and stores `localStorage.lastEventId = evt.lastEventId` for reconnects. Staff panel (Phase 03) similarly to `/api/events/queue`.

## Self-Check: PASSED

- `app/api/events/[reservation_id]/route.ts` — FOUND
- `app/api/events/queue/route.ts` — FOUND
- Commit `855c737` (Task 1) — FOUND in `git log`
- Commit `15ad508` (Task 2) — FOUND in `git log`
- Build green, workflow manifest still 1 workflow
- All 10 plan-spec'd grep assertions pass on each file

---
*Phase: 02-backend-core*
*Completed: 2026-04-26*
