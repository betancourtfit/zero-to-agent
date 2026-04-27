---
phase: "03-user-surfaces"
plan: "04"
subsystem: "panel"
tags: [maître, panel, queue-cards, sse, sonner, edge-config]
dependency_graph:
  requires:
    - "03-02-hooks-shadcn (useQueueEvents, shadcn primitives)"
    - "02-06-sse (app/api/events/queue SSE producer)"
    - "02-07-staff-api (POST /api/queue/[id]/call + /seated)"
    - "01-foundation (Edge Config getTypedConfig, auth)"
  provides:
    - "app/queue/page.tsx — live maître panel (STAFF-02..07)"
    - "components/queue/ — 4 reusable panel components"
    - "app/layout.tsx — app-wide Sonner toast root"
  affects:
    - "lib/services/queue.ts — getActiveQueue now includes reopen_count"
tech_stack:
  added: []
  patterns:
    - "RSC + client island handoff (server snapshot → useQueueEvents live updates)"
    - "defense-in-depth employees.active re-check in RSC body"
    - "Edge Config palette read server-side, passed as serializable prop"
    - "wait-for-server action pattern (no optimistic UI per D-15)"
key_files:
  created:
    - "components/queue/connection-dot.tsx (35 LOC)"
    - "components/queue/nav-bar.tsx (43 LOC)"
    - "components/queue/queue-card.tsx (144 LOC)"
    - "components/queue/queue-grid.tsx (114 LOC)"
  modified:
    - "app/layout.tsx — added Toaster mount"
    - "app/queue/page.tsx — replaced Phase 1 stub with RSC (29 LOC)"
    - "lib/services/queue.ts — added reopen_count to getActiveQueue SELECT + interfaces"
decisions:
  - "ActiveQueueItem (service type) used for initial prop in QueueGrid; ActiveQueueRow (hook type) for live SSE data — both satisfy QueueCardReservation interface"
  - "QueueCard uses inline statusPillVariants cva (not Badge primitive) for full control over pill shape per UI-SPEC color table"
  - "connection-dot uses 4 states (connecting/connected/reconnecting/failed) per hook's ConnectionState"
metrics:
  duration: "4 minutes"
  completed_date: "2026-04-27"
  tasks_completed: 3
  files_count: 7
---

# Phase 3 Plan 4: Maître Panel Summary

**One-liner:** Card-grid maître panel with SSE live updates, Edge Config party-size color coding, and wait-for-server Llamar/Marcar presentado actions.

---

## What Was Built

Three tasks completed before the human-verify checkpoint:

**Task 1 — Sonner Toaster in `app/layout.tsx`**
- Mounted `<Toaster position="bottom-right" duration={5000} richColors />` after `{children}` in the root layout.
- `<html lang="es">` confirmed present.

**Task 2 — 4 panel components under `components/queue/`**

| Component | LOC | Description |
|-----------|-----|-------------|
| `connection-dot.tsx` | 35 | 8px SSE status dot: green=connected, yellow=connecting/reconnecting, red=failed. Spanish labels: "en vivo", "conectando", "reconectando", "sin conexión". |
| `nav-bar.tsx` | 43 | Sticky h-12 nav: "Panel de Maître" + Activas/Historial links + ConnectionDot. `active="history"` prop pre-shipped for plan 05. |
| `queue-card.tsx` | 144 | Card with border-l-4 color band (inline borderLeftColor), party badge, name (truncated), wait-time (30s refresh), ETA, status pill (cva), extension badge (orange), reopen badge (purple). Llamar ONLY when waiting; Marcar presentado ONLY when called — absent not disabled per UI-SPEC D-13. Loading spinner via Lucide Loader2. aria-label on action buttons. |
| `queue-grid.tsx` | 114 | Client island: SSE via useQueueEvents, falls back to RSC initial snapshot until first SSE snapshot arrives. handleAction POSTs to /api/queue/[id]/{call,seated}, error toasts via Sonner. SSE-failed red banner. Empty state with "Sin reservas activas" + timestamp. |

**Task 3 — `app/queue/page.tsx` RSC replacement**
- Fetches `getActiveQueue()` server-side for SSR snapshot (no loading-skeleton flash).
- Defense-in-depth `employees.active` re-check after session gate (mirrors `app/api/events/queue/route.ts` lines 58-65).
- `getTypedConfig("colors_by_party_size", ...)` read server-side, passed as serializable prop.
- Renders `<QueueGrid initial={initial} colorsByPartySize={colorsByPartySize} />`.
- No `"use client"` directive — pure RSC.

---

## Commits

| Hash | Message |
|------|---------|
| `482d724` | feat(03-04): mount Sonner Toaster in app/layout.tsx |
| `15a82fd` | feat(03-04): add 4 maître panel components and fix getActiveQueue reopen_count |
| `c88b7e1` | feat(03-04): replace /queue stub with Server Component + QueueGrid island |

---

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical Functionality] Added `reopen_count` to `getActiveQueue()` projection**
- **Found during:** Task 2 (queue-card.tsx reopen badge implementation)
- **Issue:** Plan's `must_haves.truths` requires "reopen badge if reopen_count > 0" on the card, but `getActiveQueue()` did NOT include `reopen_count` in the SQL SELECT or `ActiveQueueItem` interface. The badge would always be absent.
- **Fix:** Added `reopen_count` to the SELECT columns, the `ActiveQueueRow` (internal) interface, the `ActiveQueueItem` (public) interface, and the `rows.map()` projection in `lib/services/queue.ts`.
- **Files modified:** `lib/services/queue.ts`
- **Commit:** `15a82fd`

**2. [Rule 2 - Type Alignment] `QueueCardReservation` local interface reconciles service vs hook types**
- **Found during:** Task 2 (queue-grid.tsx composing initial + live data)
- **Issue:** Service returns `ActiveQueueItem` (has `position`, `no_show_deadline`); hook returns `ActiveQueueRow` (narrower status union, no `position`). Both needed to feed the same card component.
- **Fix:** Defined `QueueCardReservation` interface in `queue-card.tsx` with exactly the fields the card renders. The grid maps both sources to this type explicitly. No casting, no spread.
- **Files modified:** `components/queue/queue-card.tsx`, `components/queue/queue-grid.tsx`
- **Commit:** `15a82fd`

---

## Manual Smoke Results (Task 4 — Pending)

Task 4 is `type="checkpoint:human-verify"`. The 12 scenarios listed in the plan require production access at `https://zero-to-agent-xi.vercel.app`. Results will be recorded after human approval.

**Expected:** All 12 scenarios PASS including:
1. Login + /queue renders seed-demo reservations
2. New diner card appears live (SSE queue.changed)
3. Llamar → diner push banner "TU MESA ESTÁ LISTA" (money shot)
4. Followup banner after followup_after_call_min
5. Color coding from Edge Config colors_by_party_size
6. Marcar presentado → card disappears
7. Real-time card creation
8. Connection dot states
9. Action error toast (Sonner, Spanish copy)
10-12. PII safety in logs

---

## Known Stubs

None. All data is wired through the service layer and SSE hook. The `reopen_count` field is present in the DB schema (Phase 3 plan 05 migration will add it as a column; for now defaults to 0 from existing rows). The reopen badge renders correctly when `reopen_count > 0`.

---

## Threat Flags

No new threat surface introduced beyond what the plan's threat model covers:
- `/queue` page protected by proxy.ts + RSC defense-in-depth employees.active check (T-03-04-01, T-03-04-02)
- Action POSTs use existing Phase 2 endpoints (T-03-04-03 CSRF — SameSite=Lax)
- SSE consumer uses existing Phase 2 endpoint (T-03-04-04)
- `getActiveQueue()` projection confirmed: no `email` or `phone` columns (T-03-04-05 accepted)
- Button disabled during POST (T-03-04-06)

---

## Self-Check

**Files exist:**
- `components/queue/connection-dot.tsx` — FOUND
- `components/queue/nav-bar.tsx` — FOUND
- `components/queue/queue-card.tsx` — FOUND
- `components/queue/queue-grid.tsx` — FOUND
- `app/queue/page.tsx` — FOUND (replaced)
- `app/layout.tsx` — FOUND (modified)

**Commits exist:**
- `482d724` — FOUND
- `15a82fd` — FOUND
- `c88b7e1` — FOUND

**Build:** `npm run build` exits 0 with all 16 routes present including `ƒ /queue`.

**TypeScript:** `npx tsc --noEmit` exits 0.

## Self-Check: PASSED
