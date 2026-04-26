---
phase: 03-user-surfaces
plan: 02
type: execute
wave: 1
depends_on: [03-01]
files_modified:
  - components/ui/card.tsx
  - components/ui/badge.tsx
  - components/ui/skeleton.tsx
  - components/ui/alert-dialog.tsx
  - components/ui/sonner.tsx
  - components/ui/tabs.tsx
  - lib/hooks/use-reservation-events.ts
  - lib/hooks/use-queue-events.ts
  - components/ui/index.ts
autonomous: true
requirements: [DINER-03, DINER-04, STAFF-07]
requirements_addressed: [DINER-03, DINER-04, STAFF-07]
must_haves:
  truths:
    - "shadcn primitives `card`, `badge`, `skeleton`, `alert-dialog`, `sonner`, `tabs` are installed under `components/ui/` and importable from any client component."
    - "`useReservationEvents({reservationId, sessionToken})` returns `{snapshot, latestEvent, connection}` and consumes `/api/events/[reservation_id]?session_token=...` with browser-native EventSource auto-reconnect."
    - "`useQueueEvents()` returns `{reservations, latestEvent, connection}` and consumes `/api/events/queue` (Auth.js cookie auth — no query param)."
    - "Both hooks track connection state (connecting → connected → reconnecting → failed) with the 3-attempt threshold per CONTEXT D-15 + UI-SPEC connection-dot table."
    - "Both hooks close EventSource on unmount AND on terminal status (seated/cancelled/no_show for reservation hook)."
  artifacts:
    - path: "components/ui/card.tsx"
      provides: "shadcn Card / CardHeader / CardContent / CardFooter primitives"
    - path: "components/ui/alert-dialog.tsx"
      provides: "shadcn AlertDialog used by reopen-dialog (plan 05)"
    - path: "components/ui/sonner.tsx"
      provides: "Sonner toast root (mount once at app root in plan 04)"
    - path: "components/ui/tabs.tsx"
      provides: "shadcn Tabs used by panel nav-bar (plan 04)"
    - path: "lib/hooks/use-reservation-events.ts"
      provides: "diner-side SSE consumer hook"
      min_lines: 80
    - path: "lib/hooks/use-queue-events.ts"
      provides: "staff-side SSE consumer hook"
      min_lines: 80
  key_links:
    - from: "lib/hooks/use-reservation-events.ts"
      to: "/api/events/[reservation_id]"
      via: "browser EventSource"
      pattern: "new EventSource\\("
    - from: "lib/hooks/use-queue-events.ts"
      to: "/api/events/queue"
      via: "browser EventSource"
      pattern: "new EventSource\\(.*\\\"\\/api\\/events\\/queue\\\""
---

<objective>
Land all foundational dependencies that plans 03 + 04 + 05 need: install the 6 shadcn primitives required by UI-SPEC's Component Inventory, and ship the two browser-side EventSource consumer hooks that the chatbot page (plan 03) and the maître panel (plan 04) will both consume. Hooks are the FIRST browser-side SSE code in the project — they MUST handle the snapshot-replay-on-connect contract Phase 2 SSE handlers already implement server-side.

Purpose: Eliminate code duplication between the chatbot and panel. Both need EventSource + Last-Event-ID + reconnect tracking — extracting once means plans 03 + 04 are ~60 LOC lighter and the connection-state state machine is single-sourced.

Output: Six shadcn primitives committed under `components/ui/`, two custom hooks under `lib/hooks/`, both ready to be imported by plans 03 / 04 / 05 without modification.
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
@components/ui/button.tsx
@app/api/events/[reservation_id]/route.ts
@app/api/events/queue/route.ts
@CLAUDE.md

<interfaces>
<!-- Phase 2 SSE contracts the hooks consume. Source: app/api/events/[reservation_id]/route.ts + app/api/events/queue/route.ts -->

Diner SSE endpoint emits these named events:
- `snapshot` — initial event with `{reservation_id, status, position, eta_min, extension_count, no_show_deadline, called_at, last_event_id}`
- `reservation.created`, `reservation.called`, `reservation.extended`, `reservation.seated`, `reservation.cancelled`, `reservation.no_show`
- `reservation.workflow_called`, `reservation.followup`, `reservation.workflow_no_show`
- Heartbeat as bare `: hb` line (browser handles, no JS event)

Staff SSE endpoint (`/api/events/queue`) emits:
- `snapshot` — `{reservations: ActiveQueueRow[], last_event_id}`
- `queue.changed` — generic notification with `{reservation_id, type, status, ...}`
- Heartbeat `: hb`

Browser EventSource auto-reconnect contract (MDN-cited):
- Constructor: `new EventSource(url, {withCredentials?})` — NO custom headers possible
- `readyState`: 0 connecting, 1 open, 2 closed
- Auto-sends `Last-Event-ID` header on reconnect if previous event had `id:` set
- Reconnect delay default ~3s, no manual retry needed

Existing shadcn convention (from `components/ui/button.tsx`):
```typescript
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
// uses @base-ui/react primitives, NOT @radix-ui — base-nova preset
```
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Install 6 shadcn primitives via CLI</name>
  <files>components/ui/card.tsx, components/ui/badge.tsx, components/ui/skeleton.tsx, components/ui/alert-dialog.tsx, components/ui/sonner.tsx, components/ui/tabs.tsx</files>
  <read_first>
    - components/ui/button.tsx (existing shadcn primitive — establishes the cva + cn pattern; new primitives must match shape)
    - components.json (verifies preset is `base-nova` / `neutral` / Tailwind v4 / cssVariables: true; CLI reads this)
    - .planning/phases/03-user-surfaces/03-UI-SPEC.md §"Component Inventory" lines 304-331 (which primitives + which props/variants are used)
  </read_first>
  <action>
1. Verify the shadcn CLI is on the locked version (already 4.5.0 per package.json):
```bash
npx shadcn@latest --version
```

2. Install the 6 primitives in one batch — UI-SPEC line 32 lists them:
```bash
npx shadcn@latest add card badge skeleton alert-dialog sonner tabs
```

The CLI reads `components.json` and writes files into `components/ui/` automatically. It will NOT overwrite `button.tsx` or `input.tsx` (already present from Phase 1) — confirm by checking git status after the command.

3. UI-SPEC §"Component Inventory" rejects two primitives originally listed in CONTEXT D-29: `dialog` (alert-dialog covers the only modal) and `dropdown-menu` (not needed in Phase 3). DO NOT install them — keeps `components/ui/` lean.

4. The Sonner primitive emits a `<Toaster />` component that must be mounted at app root in plan 04 (panel) — for now we only ship the file so plan 04 can import it.

5. After install, verify each file imports correctly via TS:
```bash
npx tsc --noEmit
```

6. If `card.tsx` writes a `Card` export that uses `data-slot` attributes (newer shadcn pattern), DO NOT modify — newer shadcn primitives in base-nova use `data-slot` for Tailwind v4 selectors. Match whatever the CLI emits.

NOTE: shadcn CLI may add transitive deps (`@radix-ui/react-tabs`, `@base-ui/react/dialog`, `sonner`, etc.). Allow it to update `package.json`. Confirm `npm run build` still succeeds at the end of this task.
  </action>
  <verify>
    <automated>ls components/ui/card.tsx components/ui/badge.tsx components/ui/skeleton.tsx components/ui/alert-dialog.tsx components/ui/sonner.tsx components/ui/tabs.tsx && npx tsc --noEmit</automated>
  </verify>
  <acceptance_criteria>
    - All 6 files exist under `components/ui/`
    - `npx tsc --noEmit` exits 0 (no TS errors introduced)
    - `package.json` has new transitive deps (whichever shadcn pulled in for these 6 primitives — usually `@radix-ui/react-alert-dialog`, `@radix-ui/react-tabs`, `sonner`, etc. — exact list depends on shadcn version)
    - `components/ui/dialog.tsx` is NOT created (rejected per UI-SPEC)
    - `components/ui/dropdown-menu.tsx` is NOT created (rejected per UI-SPEC)
    - `components/ui/button.tsx` and `components/ui/input.tsx` are unchanged (`git diff components/ui/button.tsx components/ui/input.tsx` shows no diff)
  </acceptance_criteria>
  <done>
The 6 shadcn primitives are committed and TypeScript-clean. Plans 03 / 04 / 05 can import them via `import { Card } from "@/components/ui/card"`, `import { Toaster } from "@/components/ui/sonner"`, etc., without further setup.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Implement `lib/hooks/use-reservation-events.ts` (diner SSE consumer)</name>
  <files>lib/hooks/use-reservation-events.ts</files>
  <read_first>
    - app/api/events/[reservation_id]/route.ts (Phase 2 SSE producer — extract the exact event names emitted lines 161-269; the hook listens for these names verbatim)
    - .planning/phases/03-user-surfaces/03-RESEARCH.md §Pattern 3 lines 583-678 (canonical EventSource consumer hook — copy verbatim, then patch connection-state thresholds per CONTEXT D-15)
    - .planning/phases/03-user-surfaces/03-PATTERNS.md §"lib/hooks/use-reservation-events.ts" lines 414-431 (server-emitted event names + close-on-terminal-status invariant)
    - .planning/phases/03-user-surfaces/03-UI-SPEC.md §"Connection dot" table (color thresholds: connected=green, reconnecting=yellow at <3 attempts, failed=red at ≥3 attempts)
  </read_first>
  <behavior>
    - Test 1: when `reservationId` or `sessionToken` is null, hook returns `{snapshot: null, latestEvent: null, connection: "connecting"}` and does NOT open EventSource
    - Test 2: when both are non-null, hook opens `EventSource("/api/events/${reservationId}?session_token=${sessionToken}")` with `withCredentials: false`
    - Test 3: on `open` event, `connection` transitions to "connected" and `failureCountRef` resets to 0
    - Test 4: on `snapshot` event, the JSON is parsed and stored in `snapshot`; if status is terminal (seated/no_show/cancelled), EventSource is closed immediately
    - Test 5: on each typed event (`reservation.called`, `reservation.followup`, etc.), `latestEvent` is updated with `{type, data}`
    - Test 6: on `error` events, increment `failureCountRef`; if `readyState === CLOSED` OR `failureCountRef >= 3`, set connection="failed" and close; otherwise set connection="reconnecting"
    - Test 7: on unmount (cleanup function), EventSource is closed
  </behavior>
  <action>
1. Create `lib/hooks/` directory if it doesn't exist (it doesn't — Phase 2 left no hooks):
```bash
mkdir -p lib/hooks
```

2. Implement `lib/hooks/use-reservation-events.ts` based VERBATIM on RESEARCH.md §Pattern 3 lines 583-678. Top-of-file:
```typescript
"use client";
import { useEffect, useState, useRef } from "react";

export type ConnectionState = "connecting" | "connected" | "reconnecting" | "failed";

export interface ReservationSnapshot {
  reservation_id: string;
  status: "waiting" | "called" | "seated" | "no_show" | "cancelled";
  position: number;
  eta_min: number | null;
  extension_count: number;
  no_show_deadline: string | null;
  called_at: string | null;
  last_event_id: number;
}

export interface ReservationEvent {
  type: string;
  data: unknown;
}

export function useReservationEvents(opts: {
  reservationId: string | null;
  sessionToken: string | null;
}): {
  snapshot: ReservationSnapshot | null;
  latestEvent: ReservationEvent | null;
  connection: ConnectionState;
} { /* ... */ }
```

3. The body MUST listen for these typed events explicitly (extracted from `app/api/events/[reservation_id]/route.ts` — verify line numbers before encoding):
```typescript
const TYPED_EVENTS = [
  "reservation.created",
  "reservation.called",
  "reservation.extended",
  "reservation.seated",
  "reservation.cancelled",
  "reservation.no_show",
  "reservation.workflow_called",
  "reservation.followup",
  "reservation.workflow_no_show",
  "reservation.reopened",
] as const;
```
(Adding `reservation.reopened` proactively — plan 05 will publish this from `reopenNoShow`.)

4. Auth contract per Pattern 3 footgun box: EventSource does NOT support custom headers. Auth via query param `?session_token=...` only. URL builder:
```typescript
const url = `/api/events/${opts.reservationId}?session_token=${encodeURIComponent(opts.sessionToken)}`;
```

5. Connection-state state machine per UI-SPEC + D-15:
```typescript
const failureCountRef = useRef(0);
// on open: failureCountRef.current = 0; connection = "connected"
// on error AND es.readyState === EventSource.CLOSED: connection = "failed"
// on error AND failureCountRef.current >= 3: connection = "failed", es.close()
// on error otherwise: connection = "reconnecting"; failureCountRef.current++
```

6. Close on terminal status (UI-SPEC banner state machine reads from `snapshot.status` and the hook MUST stop the EventSource so the diner doesn't keep an idle connection):
```typescript
es.addEventListener("snapshot", (e) => {
  const data = JSON.parse((e as MessageEvent).data) as ReservationSnapshot;
  setSnapshot(data);
  if (data.status === "seated" || data.status === "no_show" || data.status === "cancelled") {
    es.close();
    setConnection("connected"); // graceful — terminal isn't a failure
  }
});
```

7. Cleanup on unmount (React effect return):
```typescript
return () => {
  es.close();
};
```

8. NO `console.log` — `lib/log.ts` is server-only. Browser-side errors should be silent (browser DevTools console for dev). If you absolutely need a dev-mode log, gate it behind `process.env.NODE_ENV !== "production"` — but prefer NONE.

9. Add a small adjacent test file `__tests__/use-reservation-events.test.ts` that runs under `node:test` via `tsx`. Mock the EventSource constructor with a stub class. Verify behaviors 1-7 above. ~80 LOC test, ~110 LOC implementation.

10. Export from `lib/hooks/use-reservation-events.ts`:
```typescript
export { useReservationEvents };
export type { ConnectionState, ReservationSnapshot, ReservationEvent };
```
  </action>
  <verify>
    <automated>npx tsc --noEmit && grep -E "new EventSource\\(" lib/hooks/use-reservation-events.ts | grep -q "session_token" && grep -c "TYPED_EVENTS\\|reservation\\.called\\|reservation\\.followup" lib/hooks/use-reservation-events.ts | xargs -I{} test {} -ge 3</automated>
  </verify>
  <acceptance_criteria>
    - `lib/hooks/use-reservation-events.ts` exists and is at least 80 LOC
    - File starts with `"use client";` directive
    - Exports `useReservationEvents` named function
    - Exports types `ConnectionState`, `ReservationSnapshot`, `ReservationEvent`
    - Contains `new EventSource(` with URL using `?session_token=`
    - Listens for at least 7 of the 10 TYPED_EVENTS by name (`grep -c 'addEventListener.*reservation\\.' lib/hooks/use-reservation-events.ts >= 7`)
    - Has explicit cleanup function returning `es.close()`
    - Closes EventSource on terminal status (`grep -c 'es\\.close' lib/hooks/use-reservation-events.ts >= 2`)
    - 3-attempt failure threshold present (`grep -E '>=\\s*3|>= 3' lib/hooks/use-reservation-events.ts` returns at least one match)
    - No `console.log` calls outside `process.env.NODE_ENV` gate (`grep -nE 'console\\.(log|warn|error)\\b' lib/hooks/use-reservation-events.ts | grep -vE 'NODE_ENV' | wc -l` returns 0)
    - `npx tsx --test __tests__/use-reservation-events.test.ts` exits 0
    - `npx tsc --noEmit` exits 0
  </acceptance_criteria>
  <done>
The diner-side SSE consumer hook is testable in isolation and ready for plan 03's chatbot page to wire `<PushBanner snapshot={snapshot} latestEvent={latestEvent} connection={connection} />`.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Implement `lib/hooks/use-queue-events.ts` (staff SSE consumer)</name>
  <files>lib/hooks/use-queue-events.ts</files>
  <read_first>
    - app/api/events/queue/route.ts (Phase 2 staff SSE producer — extract event names + snapshot shape; staff SSE uses Auth.js cookie not query param)
    - lib/hooks/use-reservation-events.ts (sibling hook — shape matches; this is the staff variant)
    - .planning/phases/03-user-surfaces/03-PATTERNS.md §"For the queue hook" line 429 (snapshot is `{reservations: queue, last_event_id}` not a single reservation)
    - .planning/phases/03-user-surfaces/03-CONTEXT.md D-15 (wait-for-server, no optimistic UI; SSE is single source of truth post-action)
  </read_first>
  <behavior>
    - Test 1: hook accepts NO arguments (auth via Auth.js cookie — different from diner hook)
    - Test 2: opens `EventSource("/api/events/queue", {withCredentials: true})` because cookie auth requires same-origin credentials
    - Test 3: snapshot event payload is `{reservations: ActiveQueueRow[], last_event_id: number}`; hook stores the array in `reservations` state
    - Test 4: each `queue.changed` event is forwarded as `latestEvent` so the panel can decide how to mutate cards
    - Test 5: connection-state state machine is identical to use-reservation-events.ts
    - Test 6: hook does NOT close EventSource on any specific event — the staff panel keeps the stream open for the full session (only unmount closes it)
  </behavior>
  <action>
1. Create `lib/hooks/use-queue-events.ts` mirroring the diner hook's shape but with these key deltas:

```typescript
"use client";
import { useEffect, useState, useRef } from "react";
import type { ConnectionState, ReservationEvent } from "./use-reservation-events";

export interface ActiveQueueRow {
  reservation_id: string;
  status: "waiting" | "called";
  name: string;
  party_size: number;
  eta_min: number | null;
  extension_count: number;
  reopen_count: number;
  created_at: string;
  called_at: string | null;
}

export function useQueueEvents(): {
  reservations: ActiveQueueRow[];
  latestEvent: ReservationEvent | null;
  connection: ConnectionState;
} {
  const [reservations, setReservations] = useState<ActiveQueueRow[]>([]);
  const [latestEvent, setLatestEvent] = useState<ReservationEvent | null>(null);
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const failureCountRef = useRef(0);

  useEffect(() => {
    const es = new EventSource("/api/events/queue", { withCredentials: true });
    setConnection("connecting");

    es.addEventListener("open", () => {
      failureCountRef.current = 0;
      setConnection("connected");
    });

    es.addEventListener("snapshot", (e) => {
      const data = JSON.parse((e as MessageEvent).data) as { reservations: ActiveQueueRow[]; last_event_id: number };
      setReservations(data.reservations);
    });

    const TYPED_EVENTS = [
      "queue.changed",
      "reservation.created",
      "reservation.called",
      "reservation.seated",
      "reservation.cancelled",
      "reservation.no_show",
      "reservation.reopened",
    ] as const;
    for (const evt of TYPED_EVENTS) {
      es.addEventListener(evt, (e) => {
        const data = JSON.parse((e as MessageEvent).data);
        setLatestEvent({ type: evt, data });
      });
    }

    es.addEventListener("error", () => {
      failureCountRef.current++;
      if (es.readyState === EventSource.CLOSED) {
        setConnection("failed");
        return;
      }
      if (failureCountRef.current >= 3) {
        setConnection("failed");
        es.close();
      } else {
        setConnection("reconnecting");
      }
    });

    return () => {
      es.close();
    };
  }, []);

  return { reservations, latestEvent, connection };
}
```

2. NOTE: the staff hook does NOT mutate `reservations` from individual `queue.changed` events — that's plan 04's responsibility (the panel reduces the events into card-state changes). Plan 04 receives `reservations` (initial snapshot) + `latestEvent` (delta hint) + `connection` (UI dot).

3. Reuse `ConnectionState` and `ReservationEvent` types from `use-reservation-events.ts` (single source of truth).

4. Add tests in `__tests__/use-queue-events.test.ts` mirroring the diner hook's test shape; verify no `?session_token=` is in the URL (this is staff auth, cookie-based).
  </action>
  <verify>
    <automated>npx tsc --noEmit && grep -E "new EventSource\\(\\\"/api/events/queue\\\"" lib/hooks/use-queue-events.ts && ! grep "session_token" lib/hooks/use-queue-events.ts</automated>
  </verify>
  <acceptance_criteria>
    - `lib/hooks/use-queue-events.ts` exists and is at least 70 LOC
    - File starts with `"use client";` directive
    - Exports `useQueueEvents` named function with NO required arguments
    - Exports type `ActiveQueueRow`
    - Re-imports `ConnectionState` and `ReservationEvent` from `./use-reservation-events` (single source of truth)
    - URL passed to EventSource is `/api/events/queue` (no query params; `grep "session_token" lib/hooks/use-queue-events.ts` returns 0)
    - Constructor passes `{withCredentials: true}` (staff cookie auth)
    - Listens for at least 4 `reservation.*` events + `queue.changed`
    - 3-attempt failure threshold present
    - `npx tsx --test __tests__/use-queue-events.test.ts` exits 0
    - `npx tsc --noEmit` exits 0
  </acceptance_criteria>
  <done>
The staff-side SSE consumer hook is testable in isolation and ready for plan 04's panel to consume. Plan 04 will receive `reservations` for grid render + `latestEvent` for delta-driven card insertions/updates.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| browser ↔ /api/events/[reservation_id] | session_token in query string traverses the wire (over HTTPS in prod) |
| browser ↔ /api/events/queue | Auth.js cookie traverses (httpOnly, SameSite=Lax) |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-03-02-01 | Information Disclosure | use-reservation-events.ts URL with session_token query param | mitigate | Phase 2 already validates session_token server-side; query param is OK because EventSource cannot use headers (MDN cited). HTTPS-only in production. Server `lib/log.ts` redacts `session_token` query strings (Phase 2 D-21) so the URL never lands in logs. |
| T-03-02-02 | Tampering | client-side reservations array (use-queue-events) | accept | Maître panel is auth-gated by proxy.ts + employees.active re-check on every SSE connect (Phase 2 D-29). Tampering with browser state only affects the maître's local view, not server state. |
| T-03-02-03 | Denial of Service | reconnect storm if hook fails | mitigate | 3-attempt threshold halts reconnects + closes EventSource; user must refresh per UI-SPEC. Browser native ~3s reconnect delay; no manual retry layered on top. |

No high-severity threats — both hooks are read-only and consume already-authenticated Phase 2 endpoints.
</threat_model>

<verification>
- `npm run build` exits 0 (TS clean across whole project)
- `npx tsx --test __tests__/use-reservation-events.test.ts` exits 0
- `npx tsx --test __tests__/use-queue-events.test.ts` exits 0
- `git diff --name-only HEAD | grep -E '^components/ui/' | wc -l` returns at least 6 (one per primitive)
- No raw `console.*` in either hook except gated by `NODE_ENV`
</verification>

<success_criteria>
- 6 shadcn primitives committed and TS-clean
- 2 hooks exported, TS-clean, unit-tested
- All 3 typed exports (`ConnectionState`, `ReservationSnapshot`, `ReservationEvent`, `ActiveQueueRow`) ready for plans 03 / 04 / 05 to consume
- Plan 03 (chatbot) and plan 04 (panel) can run in parallel after this lands
</success_criteria>

<output>
After completion, create `.planning/phases/03-user-surfaces/03-02-hooks-shadcn-SUMMARY.md` with:
- 6 shadcn primitives + which transitive deps shadcn pulled in
- Both hooks' final LOC + which Phase 2 SSE event names they listen for
- Any deviations from RESEARCH.md §Pattern 3 (e.g., if `reservation.reopened` was added proactively)
- `git push origin main` confirmation per D-31 (auto-deploy)
</output>
