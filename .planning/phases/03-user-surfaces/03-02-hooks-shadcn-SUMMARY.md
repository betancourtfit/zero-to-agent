---
phase: 03-user-surfaces
plan: 02
subsystem: ui
tags: [shadcn, sse, react, hooks, eventsource, typescript]

# Dependency graph
requires:
  - phase: 02-backend-core
    provides: SSE endpoints /api/events/[reservation_id] and /api/events/queue with snapshot-replay-on-connect pattern

provides:
  - "6 shadcn primitives: card, badge, skeleton, alert-dialog, sonner, tabs under components/ui/"
  - "useReservationEvents hook — diner-side SSE consumer with connection state machine + terminal-status auto-close"
  - "useQueueEvents hook — staff-side SSE consumer with cookie auth and no auto-close"
  - "ConnectionState, ReservationSnapshot, ReservationEvent, ActiveQueueRow types — single-sourced"
  - "_testRunEffect and _testRunQueueEffect exports — enable node:test harness without JSDOM"

affects:
  - 03-03-chatbot
  - 03-04-panel
  - 03-05-reopen

# Tech tracking
tech-stack:
  added:
    - "sonner@2.0.7 — toast library for shadcn Sonner component"
    - "next-themes@0.4.6 — transitive dep pulled by shadcn Sonner"
  patterns:
    - "TDD with node:test + tsx: RED commit (failing test) → GREEN commit (implementation) per task"
    - "_testRunEffect extracted from useEffect body: enables pure node:test testing without JSDOM"
    - "EventSource connection state machine: connecting → connected → reconnecting (< 3 errors) → failed (>= 3 errors or readyState CLOSED)"
    - "Terminal status auto-close: seated/no_show/cancelled close ES gracefully with connection='connected' (not 'failed')"
    - "Staff vs diner SSE auth: diner uses ?session_token= query param + withCredentials:false; staff uses Auth.js cookie + withCredentials:true"

key-files:
  created:
    - "components/ui/card.tsx"
    - "components/ui/badge.tsx"
    - "components/ui/skeleton.tsx"
    - "components/ui/alert-dialog.tsx"
    - "components/ui/sonner.tsx"
    - "components/ui/tabs.tsx"
    - "lib/hooks/use-reservation-events.ts"
    - "lib/hooks/use-queue-events.ts"
    - "__tests__/use-reservation-events.test.ts"
    - "__tests__/use-queue-events.test.ts"
  modified:
    - "package.json (sonner + next-themes added)"

key-decisions:
  - "_testRunEffect pattern: extract useEffect body as a named export for node:test harness — avoids JSDOM dependency while keeping hook wiring idiomatic React"
  - "ConnectionState types single-sourced in use-reservation-events.ts; use-queue-events.ts re-imports — no type drift"
  - "TYPED_EVENTS in diner hook includes reservation.reopened proactively (plan 05 will publish this from reopenNoShow)"
  - "Set<terminal>.has(status) uses type assertion 'as ...' — TERMINAL_STATUSES is narrower than the full status union; TS requires the cast"
  - "useQueueEvents has empty deps [] — URL is constant; browser EventSource handles reconnect natively; re-running effect would double-subscribe"

patterns-established:
  - "TDD pattern: test file exported as _testRunEffect; hook file is thin useState+useEffect wrapper around it"
  - "Hooks: 'use client' directive required; no server-side imports allowed"
  - "EventSource error handling: readyState CLOSED check before incrementing failureCount — CLOSED fires on server-side close (counts as immediate failure, not a retry opportunity)"
  - "No console.* in hooks — enforced by grep in acceptance check"

requirements-completed: [DINER-03, DINER-04, STAFF-07]

# Metrics
duration: 5min
completed: 2026-04-26
---

# Phase 03 Plan 02: Hooks + shadcn SUMMARY

**6 shadcn primitives installed and 2 typed EventSource consumer hooks shipped with full unit-test coverage — foundational dependencies for chatbot (plan 03), panel (plan 04), and reopen dialog (plan 05)**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-04-26T21:08:26Z
- **Completed:** 2026-04-26T21:13:25Z
- **Tasks:** 3 (1 install + 2 TDD each with RED + GREEN commits)
- **Files modified:** 10 created + 1 modified (package.json)

## Accomplishments

- 6 shadcn primitives committed under `components/ui/` — `card`, `badge`, `skeleton`, `alert-dialog`, `sonner`, `tabs` — ready for plans 03/04/05 to import without further setup. CLI 4.5.0 ran against `components.json` (base-nova preset, Tailwind v4, cssVariables). Transitive deps: `sonner@2.0.7` + `next-themes@0.4.6`.
- `useReservationEvents` diner hook — 136 LOC, `"use client"`, `_testRunEffect` exported for node:test, 10 TYPED_EVENTS (includes `reservation.reopened` proactively for plan 05). Connection state machine: connecting → connected → reconnecting → failed with 3-attempt threshold. Terminal statuses close EventSource gracefully. 15/15 tests pass.
- `useQueueEvents` staff hook — 117 LOC, `"use client"`, cookie auth (`withCredentials: true`, no query params), 7 TYPED_EVENTS, no auto-close on events (staff panel keeps stream open for session). 7/7 tests pass.

## Task Commits

TDD tasks have multiple commits (test RED → feat GREEN):

1. **Task 1: Install 6 shadcn primitives** - `0c187c0` (feat)
2. **Task 2 RED: Failing tests for use-reservation-events** - `6c1611b` (test)
3. **Task 2 GREEN: Implement use-reservation-events hook** - `e09e976` (feat)
4. **Task 3 RED: Failing tests for use-queue-events** - `b4fde8b` (test)
5. **Task 3 GREEN: Implement use-queue-events hook** - `6e6d83d` (feat)

## Files Created/Modified

- `components/ui/card.tsx` — shadcn Card/CardHeader/CardContent/CardFooter primitives
- `components/ui/badge.tsx` — shadcn Badge (status pills for queue cards)
- `components/ui/skeleton.tsx` — shadcn Skeleton (loading skeletons for panel)
- `components/ui/alert-dialog.tsx` — shadcn AlertDialog (STAFF-09 reopen confirm dialog — plan 05)
- `components/ui/sonner.tsx` — shadcn Sonner Toaster root (mount once at app root in plan 04)
- `components/ui/tabs.tsx` — shadcn Tabs (panel nav-bar in plan 04)
- `lib/hooks/use-reservation-events.ts` — diner SSE consumer (136 LOC)
- `lib/hooks/use-queue-events.ts` — staff SSE consumer (117 LOC)
- `__tests__/use-reservation-events.test.ts` — 15 tests covering all 7 behavioral requirements
- `__tests__/use-queue-events.test.ts` — 7 tests covering all 6 behavioral requirements
- `package.json` — added `sonner@2.0.7`, `next-themes@0.4.6`

## Decisions Made

- **`_testRunEffect` extraction pattern:** The hook's EventSource logic lives in a named export (`_testRunEffect` / `_testRunQueueEffect`) that the `useEffect` body calls. This allows node:test to exercise the effect logic directly without JSDOM or a React test renderer — a clean separation between the stateful wiring (React) and the logic (pure TS).
- **`reservation.reopened` added proactively:** TYPED_EVENTS in the diner hook includes this event name even though plan 05 hasn't shipped it yet. Zero cost now; avoids a hook modification mid-flight-reservation when plan 05 lands.
- **`Set.has()` type assertion:** `TERMINAL_STATUSES` is `Set<"seated" | "no_show" | "cancelled">` but `data.status` is the full `"waiting" | "called" | "seated" | "no_show" | "cancelled"` union. TypeScript requires an explicit cast. The runtime behavior is correct — non-terminal statuses return `false` from `.has()`.
- **`useQueueEvents` empty `[]` deps:** The staff SSE URL is constant; the browser's built-in EventSource reconnect handles network disruptions. Re-running the effect on any state change would create duplicate subscriptions. `[]` is intentional.

## Deviations from Plan

None — plan executed exactly as written. The `_testRunEffect` export pattern matches what the plan's action instructions specified for testability.

The one TypeScript deviation was a minor type-system-level fix during RED→GREEN (the `Set.has()` cast) — this is a correctness alignment required by TypeScript's narrowing, not a plan deviation.

## Issues Encountered

- TypeScript required a type cast (`as "seated" | "no_show" | "cancelled"`) for the `TERMINAL_STATUSES.has(data.status)` call — `Set<T>` in TS4+ enforces that the argument is assignable to `T`. Fixed inline during GREEN phase.
- Test file's `declare global { var EventSource }` conflicted with `lib.dom.d.ts`. Fixed by removing the `declare global` block and using a plain `(globalThis as Record<string, unknown>).EventSource = StubEventSource` assignment instead.

## Known Stubs

None — both hooks wire to real Phase 2 SSE endpoints. No hardcoded arrays or placeholder data.

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| No new flags | — | Both hooks consume already-authenticated Phase 2 SSE endpoints (T-03-02-01 through T-03-02-03 in plan threat model already addressed) |

## Next Phase Readiness

- **Plan 03 (chatbot):** Can import `useReservationEvents` directly from `@/lib/hooks/use-reservation-events`. Connection dot colors: green=connected, yellow=reconnecting, red=failed (>= 3 attempts).
- **Plan 04 (panel):** Can import `useQueueEvents` + `ActiveQueueRow` from `@/lib/hooks/use-queue-events`. Can import `Tabs` from `@/components/ui/tabs`, `Sonner` from `@/components/ui/sonner`.
- **Plan 05 (reopen):** Can import `AlertDialog` from `@/components/ui/alert-dialog`. `useReservationEvents` already has `reservation.reopened` in TYPED_EVENTS.
- **Both plans 03 + 04 can now run in parallel** — they share no files from this plan's output.

---
*Phase: 03-user-surfaces*
*Completed: 2026-04-26*
