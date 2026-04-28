---
phase: "03-user-surfaces"
plan: "05"
subsystem: "history-reopen"
tags: [maître, history, reopen, staff-08, staff-09, no-show-undo]
dependency_graph:
  requires:
    - "03-04-panel (NavBar, queue components, app/queue/page.tsx auth shell)"
    - "03-02-hooks-shadcn (shadcn primitives including AlertDialog from @base-ui/react)"
    - "02-07-staff-api (POST /api/queue/[id]/* pattern)"
    - "02-03-service-layer (lib/services/queue.ts 4 existing exports)"
    - "02-04-workflow (start() from workflow/api + reservationWorkflow)"
    - "01-foundation (auth, Edge Config, Neon DB)"
  provides:
    - "db/migrations/0003_reopen_count.sql — reopen_count column (pre-existing, applied)"
    - "lib/services/queue.ts — 5th export reopenNoShow"
    - "POST /api/queue/[id]/reopen — staff reopen endpoint"
    - "GET /api/queue/history — day-scoped history endpoint"
    - "app/queue/history/page.tsx — Server Component history page"
    - "components/queue/history-table.tsx — 6-col table with 30s polling"
    - "components/queue/reopen-dialog.tsx — AlertDialog wrapper for reopen flow"
  affects:
    - "lib/services/reservations.ts — added NOT_IN_NO_SHOW_STATE to ServiceErrorCode union"
tech_stack:
  added: []
  patterns:
    - "5th service export following existing 4-export queue.ts pattern"
    - "D-14 compensation: INTERNAL_ERROR if start() throws, row not mutated"
    - "Controlled AlertDialog open state (base-ui — no asChild, no auto-close on action)"
    - "RSC + client island handoff: server SSR snapshot → client 30s polling (no SSE per D-17)"
    - "Inline SQL in history route handler (read-only, single consumer)"
key_files:
  created:
    - "__tests__/queue-reopen.test.ts (238 LOC) — 7-behavior unit tests"
    - "app/api/queue/[id]/reopen/route.ts (90 LOC) — POST staff reopen endpoint"
    - "app/api/queue/history/route.ts (79 LOC) — GET history endpoint"
    - "app/queue/history/page.tsx (51 LOC) — RSC history page"
    - "components/queue/history-table.tsx (132 LOC) — polling history table"
    - "components/queue/reopen-dialog.tsx (82 LOC) — AlertDialog reopen flow"
  modified:
    - "lib/services/queue.ts (480 LOC) — added reopenNoShow 5th export + workflow/api imports"
    - "lib/services/reservations.ts — added NOT_IN_NO_SHOW_STATE to ServiceErrorCode"
decisions:
  - "Inline SQL in /api/queue/history (not a 6th service export) — read-only, single consumer, no mutation"
  - "Controlled AlertDialog open state instead of asChild pattern — base-ui does not support asChild on Trigger"
  - "AlertDialogAction replaced with plain Button + setOpen(false) on success — base-ui AlertDialogAction doesn't auto-close"
  - "SQL duplicated between history route handler and history page RSC — acceptable for Phase 3 budget; Phase 4 can refactor to getHistory() service"
metrics:
  duration: "~25 minutes"
  completed_date: "2026-04-28"
  tasks_completed: 6
  files_count: 8
---

# Phase 3 Plan 5: History + Reopen Summary

**One-liner:** Day-scoped maître history table with 30s polling and AlertDialog-gated no-show undo via a fresh workflow run.

---

## What Was Built

Six tasks completed before the human-verify checkpoint:

**Task 1 — Migration `0003_reopen_count.sql` (pre-existing)**
- File already existed at `db/migrations/0003_reopen_count.sql` (created during plan 03-04 as Rule 2 auto-fix when `getActiveQueue` needed `reopen_count`).
- `getActiveQueue()` SELECT already included `reopen_count` in both `ActiveQueueRow` and `ActiveQueueItem` interfaces.
- Migration runner confirmed idempotent (`ADD COLUMN IF NOT EXISTS`).

**Task 2 — `reopenNoShow` 5th export in `lib/services/queue.ts`**
- Validates `status === 'no_show'` BEFORE calling `start()` (D-14 ordering).
- Starts a new workflow run via `start(reservationWorkflow, [{reservationId}])`.
- Clears `ended_at`, `no_show_deadline`, `called_at`; bumps `reopen_count`; updates `workflow_run_id` and `active_hook_token`.
- Inserts `reservation_events` row with `event_type='reopened'` (D-10 safety net).
- Publishes both `reservation:<id>` and `queue:active` KV channels.
- D-14 compensation: if `start()` throws, returns `INTERNAL_ERROR` without mutating the row.
- 7-behavior unit tests in `__tests__/queue-reopen.test.ts` all pass.
- Added `NOT_IN_NO_SHOW_STATE` to `ServiceErrorCode` union in `lib/services/reservations.ts`.

**Task 3 — `POST /api/queue/[id]/reopen/route.ts`**
- 90 LOC thin wrapper around `reopenNoShow()`.
- Auth: 401 no session, 403 inactive employee (defense-in-depth `employees.active` re-check).
- Status codes: `NOT_IN_NO_SHOW_STATE` → 409, `RESERVATION_NOT_FOUND` → 404, `INTERNAL_ERROR` → 500.
- Awaits `params` (Next.js 16 D-32). All logs via `log.*`.

**Task 4 — `GET /api/queue/history/route.ts`**
- 79 LOC auth-gated GET.
- Day filter: `DATE(created_at AT TIME ZONE 'America/Argentina/Buenos_Aires') = CURRENT_DATE` (D-17).
- Status filter: `seated`, `no_show`, `cancelled`; sorted `ORDER BY ended_at DESC NULLS LAST`.
- Projects `name` (maître operationally needs it) but NOT `email` or `phone` (T-03-05-04 PII boundary).
- Includes `reopen_count` for history table badge.
- No SSE — D-17 explicit. Client polls every 30s.

**Task 5 — `components/queue/reopen-dialog.tsx` + `components/queue/history-table.tsx`**

| Component | LOC | Description |
|-----------|-----|-------------|
| `reopen-dialog.tsx` | 82 | Controlled AlertDialog (base-ui): trigger "Reabrir", title "¿Confirmás reabrir?", description "Se va a crear una nueva entrada en la cola activa.", Cancelar/Confirmar buttons. POSTs to `/api/queue/[id]/reopen`; toast.success on ok. |
| `history-table.tsx` | 132 | 6-column table (Llegada/Nombre/Personas/Estado/Tiempo en cola/Acción). 30s polling via setInterval. Empty state "No hay reservas cerradas hoy." Reabrir only on no_show rows. "reabierto ×N" badge when reopen_count > 0. |

**Task 6 — `app/queue/history/page.tsx` RSC**
- 51 LOC pure Server Component (no `"use client"`).
- Auth-gated: redirect `/login` on no session or inactive employee.
- SSR initial snapshot with same day-scoped TZ filter as the route handler.
- Renders `<NavBar active="history" />` (no connection prop — no SSE per D-17).
- Hands off to `<HistoryTable initial={initial} />`.
- `npm run build` exits 0; `/queue/history` appears in route table.

---

## Commits

| Hash | Message |
|------|---------|
| `3984bb6` | feat(03-05): add reopenNoShow 5th export to lib/services/queue.ts |
| `0e320fb` | feat(03-05): add POST /api/queue/[id]/reopen staff endpoint |
| `9f66703` | feat(03-05): add GET /api/queue/history auth-gated day-scoped history endpoint |
| `9d62140` | feat(03-05): add reopen-dialog and history-table components |
| `89635d4` | feat(03-05): add /queue/history Server Component page (STAFF-08) |

---

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Task 1 already done — migration + getActiveQueue reopen_count pre-existing**
- **Found during:** Task 1 verification
- **Issue:** Migration `0003_reopen_count.sql` was created during plan 03-04 as a Rule 2 auto-fix; `getActiveQueue()` already projected `reopen_count`. Plan treated Task 1 as new work.
- **Fix:** Verified file exists with correct content; verified `getActiveQueue` SELECT includes column. Skipped re-creation. Proceeded directly to Task 2.
- **Files modified:** None (pre-existing correct state verified)

**2. [Rule 1 - Bug] AlertDialog `asChild` prop not supported by base-ui**
- **Found during:** Task 5 (TypeScript check — TS2322 on `asChild`)
- **Issue:** The plan's code template used `<AlertDialogTrigger asChild>` (Radix pattern), but the project's `alert-dialog.tsx` wraps `@base-ui/react` which does not have `asChild` on the Trigger component.
- **Fix:** Replaced `asChild` + inner `<Button>` with inline Tailwind button styles on `AlertDialogTrigger` directly.
- **Files modified:** `components/queue/reopen-dialog.tsx`
- **No commit** (fixed inline before Task 5 commit)

**3. [Rule 1 - Bug] AlertDialogAction does not auto-close the dialog in base-ui**
- **Found during:** Task 5 (code review of `alert-dialog.tsx` — `AlertDialogAction` is a raw Button, not a `Close` primitive)
- **Issue:** The plan's template used `<AlertDialogAction onClick={confirm}>` expecting it to close the dialog on click (Radix pattern). In base-ui, `AlertDialogAction` is just a `Button` wrapper with no close behavior.
- **Fix:** Used controlled `open` state (`useState(false)`) on `AlertDialog`; `setOpen(false)` is called explicitly after a successful POST. Replaced `AlertDialogAction` with plain `Button` from shadcn. `onOpenChange={(value) => setOpen(value)}` wraps `setOpen` to match base-ui's `(open, eventDetails)` signature.
- **Files modified:** `components/queue/reopen-dialog.tsx`
- **No commit** (fixed inline before Task 5 commit)

**4. [Rule 2 - Missing] NOT_IN_NO_SHOW_STATE added to ServiceErrorCode**
- **Found during:** Task 2 (TypeScript check — `reopenNoShow` returned a string literal not in the union)
- **Issue:** `lib/services/reservations.ts → ServiceErrorCode` union did not include `NOT_IN_NO_SHOW_STATE`. Adding the 5th service export required it.
- **Fix:** Added `"NOT_IN_NO_SHOW_STATE"` to the `ServiceErrorCode` union.
- **Files modified:** `lib/services/reservations.ts`
- **Commit:** `3984bb6`

---

## Migration 0003 Application Result

`db/migrations/0003_reopen_count.sql` exists with:
```sql
ALTER TABLE reservations
  ADD COLUMN IF NOT EXISTS reopen_count INTEGER NOT NULL DEFAULT 0;
```

Applied to Neon DB in commit `1a737d6` (plan 03-04). Migration runner exits 0 when `DATABASE_URL_UNPOOLED` is available (remote Neon; local PG not available in dev without Docker). Column confirmed present via `getActiveQueue()` SELECT returning `reopen_count` without error in plan 03-04's build.

---

## 5 Service-Layer Exports

```
getActiveQueue()        — Phase 2
markCalled()            — Phase 2
markSeated()            — Phase 2
markNoShowManual()      — Phase 2
reopenNoShow()          — Phase 3 Plan 05 (NEW)
```

---

## Manual Smoke Results (Task 7 — Pending)

Task 7 is `type="checkpoint:human-verify"`. The 15 scenarios require production access at `https://zero-to-agent-xi.vercel.app`.

**Expected to PASS:**
1. Migration 0003 live in prod (reopen_count column exists)
2. /queue still works, active queue unchanged
3. /queue/history navigable via Historial tab in NavBar
4. Day's closed reservations appear in table
5. No Reabrir button on seated/cancelled rows
6. Reabrir button appears only on no_show rows
7. AlertDialog opens with correct Spanish copy
8. Cancelar closes dialog, no change
9. Confirmar → POST → success toast "Reserva reabierta. Aparece en la cola activa."
10. Reservation appears in /queue as waiting card with "reabierto ×1" badge
11. New workflow run visible in Vercel Workflow dashboard
12. reservation_events row with event_type='reopened' in DB
13. Second reopen attempt → 409 toast (NOT_IN_NO_SHOW_STATE)
14. Network tab shows GET /api/queue/history every 30s
15. No regression to plan 03/04 (chatbot + active queue still work)

---

## Production Deploy

Pending `git push origin main` after human verification approval. SHA from final commit: `89635d4`.

---

## getActiveQueue Projection Note

`reopen_count` was added to the `getActiveQueue()` SELECT in plan 03-04 (Rule 2 auto-fix, commit `15a82fd`). This was an additive deviation from "Phase 3 doesn't change Phase 2 contracts." The column exists per migration 0003; the SELECT widens but is backward-compatible (no callers break). Documented here for audit trail.

---

## Known Stubs

None. All data flows from DB through service layer to UI:
- `reopen_count` comes from `reservations.reopen_count` (live DB column)
- History rows come from the same SQL query in both the RSC page and the polling route
- The Reabrir button's success path starts a real workflow run

---

## Threat Flags

No new threat surface beyond the plan's threat model. All 7 STRIDE threats addressed:
- T-03-05-01: /queue/history auth-gated (proxy.ts + RSC defense-in-depth)
- T-03-05-02: `status === 'no_show'` check BEFORE `start()` in service
- T-03-05-03: Concurrent reopens handled by DB atomic UPDATE + status check (409 on second)
- T-03-05-04: `name` only in projection (no phone/email) — accepted for pilot
- T-03-05-05: employee_email logged on success; reservation_events audit row inserted
- T-03-05-06: Loading state disables Confirmar; natural idempotency via NOT_IN_NO_SHOW_STATE
- T-03-05-07: Polling bounded at pilot scale — accepted

---

## Self-Check

**Files exist:**
- `__tests__/queue-reopen.test.ts` — FOUND
- `app/api/queue/[id]/reopen/route.ts` — FOUND
- `app/api/queue/history/route.ts` — FOUND
- `app/queue/history/page.tsx` — FOUND
- `components/queue/history-table.tsx` — FOUND
- `components/queue/reopen-dialog.tsx` — FOUND
- `lib/services/queue.ts` (modified) — FOUND
- `lib/services/reservations.ts` (modified) — FOUND

**Commits exist:**
- `3984bb6` — feat(03-05): add reopenNoShow 5th export
- `0e320fb` — feat(03-05): add POST /api/queue/[id]/reopen
- `9f66703` — feat(03-05): add GET /api/queue/history
- `9d62140` — feat(03-05): add reopen-dialog and history-table
- `89635d4` — feat(03-05): add /queue/history Server Component page

**Build:** `npm run build` exits 0 with `/queue/history` and `/api/queue/history` in route table.

**Tests:** `npx tsx --test __tests__/queue-reopen.test.ts` → 7/7 pass.

**TypeScript:** `npx tsc --noEmit` exits 0.

## Self-Check: PASSED
