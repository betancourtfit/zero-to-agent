---
phase: 03-user-surfaces
plan: 04
type: execute
wave: 2
depends_on: [03-02]
files_modified:
  - app/queue/page.tsx
  - app/layout.tsx
  - components/queue/queue-card.tsx
  - components/queue/queue-grid.tsx
  - components/queue/connection-dot.tsx
  - components/queue/nav-bar.tsx
autonomous: true
requirements: [STAFF-02, STAFF-03, STAFF-04, STAFF-05, STAFF-06, STAFF-07]
requirements_addressed: [STAFF-02, STAFF-03, STAFF-04, STAFF-05, STAFF-06, STAFF-07]
must_haves:
  truths:
    - "Maître navigates to `/queue` and sees the day's active reservations (status IN waiting, called) ordered chronologically (oldest first) as a card grid (1-col mobile, 2-col tablet, 3-col desktop)."
    - "Each card shows: party-size badge, name (truncated), wait-time computed from created_at, status pill, ETA, extension badge if extension_count > 0, reopen badge if reopen_count > 0 (additive — plan 05 publishes these)."
    - "Card has a left-border color band (`border-l-4`) using `colors_by_party_size` from Edge Config (read server-side in RSC, passed as prop)."
    - "Bottom of card shows `[Llamar]` button when status='waiting', `[Marcar presentado]` when status='called'. Wrong-state button is ABSENT, not disabled (UI-SPEC contract)."
    - "Click [Llamar] → POST /api/queue/[id]/call (Phase 2 endpoint, unchanged) → button shows loading spinner → SSE arrives with `reservation.called` → card mutates to show [Marcar presentado] (wait-for-server, no optimistic UI)."
    - "Connection state is visible: 8px dot in nav bar — green=connected, yellow=reconnecting, red=failed (≥3 attempts → user must refresh)."
    - "Panel updates in real time when a new reservation is created (via chatbot or any future surface) — `queue.changed` event arrives, panel calls `getActiveQueue()` again or applies the delta to the local reservations state."
    - "Auth gate: `proxy.ts` already covers /queue/:path*; page re-validates `employees.active=true` server-side (defense in depth, mirroring Phase 2 D-29)."
    - "Action error toasts (Sonner, bottom-right, 5s duration) show Spanish error message from API; the button auto-disables on error (SSE will sync state)."
  artifacts:
    - path: "app/queue/page.tsx"
      provides: "Server Component: auth + employees.active re-check + getActiveQueue() snapshot + Edge Config colors + hand off to client island"
      min_lines: 30
    - path: "components/queue/queue-grid.tsx"
      provides: "Client island: receives initial snapshot, subscribes via useQueueEvents, renders queue cards"
      min_lines: 80
    - path: "components/queue/queue-card.tsx"
      provides: "single card with party badge, name, wait-time, ETA, status pill, action button"
      min_lines: 60
    - path: "components/queue/connection-dot.tsx"
      provides: "8px circle + label (green/yellow/red + Spanish label)"
    - path: "components/queue/nav-bar.tsx"
      provides: "h-12 nav with title + Tabs (Activas | Historial) + connection-dot"
    - path: "app/layout.tsx"
      provides: "Mounts <Toaster /> from sonner so action error toasts work app-wide"
  key_links:
    - from: "app/queue/page.tsx"
      to: "lib/services/queue.ts → getActiveQueue"
      via: "direct service call in RSC"
      pattern: "getActiveQueue"
    - from: "components/queue/queue-grid.tsx"
      to: "lib/hooks/use-queue-events"
      via: "import"
      pattern: "useQueueEvents"
    - from: "components/queue/queue-card.tsx"
      to: "/api/queue/[id]/call (Phase 2)"
      via: "fetch POST"
      pattern: "/api/queue/.*/call"
    - from: "components/queue/queue-card.tsx"
      to: "/api/queue/[id]/seated (Phase 2)"
      via: "fetch POST"
      pattern: "/api/queue/.*/seated"
    - from: "app/queue/page.tsx"
      to: "lib/edge-config → getTypedConfig"
      via: "import"
      pattern: "getTypedConfig"
---

<objective>
Replace the Phase 1 `/queue` stub with the live maître panel: a card-grid view of active reservations with real-time SSE updates, color-coded by party size from Edge Config, with Llamar/Marcar presentado action buttons that wait for server confirmation. Ships 6 of the 19 phase requirements (STAFF-02..07). Does NOT touch `/queue/history` or Reabrir — those land in plan 05.

Purpose: This is the maître-facing half of the user surfaces. It IS the demo's scenarios where the maître clicks Llamar and the diner gets pushed (DINER-03 wired in plan 03). The two surfaces meet here.

Output: An auth-protected card grid at `/queue` that updates live, deploys via atomic commit (D-31). Plan 03's chatbot push banner can now be triggered end-to-end from the panel.
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
@lib/services/queue.ts
@lib/hooks/use-queue-events.ts
@app/queue/page.tsx
@app/api/queue/route.ts
@app/api/queue/[id]/call/route.ts
@app/api/queue/[id]/seated/route.ts
@components/ui/button.tsx
@components/ui/card.tsx
@components/ui/sonner.tsx
@components/ui/tabs.tsx

<interfaces>
Service layer (Phase 2):
```typescript
// lib/services/queue.ts
export async function getActiveQueue(): Promise<ActiveQueueRow[]>;
// returns rows where status IN ('waiting', 'called') ordered by created_at ASC
// each row: {reservation_id, status, name, party_size, eta_min, extension_count, reopen_count, created_at, called_at}
```

Phase 2 staff endpoints (UNCHANGED):
- `GET /api/queue` — auth-gated snapshot (panel CAN consume this OR call getActiveQueue() in RSC; D-28 prefers RSC direct call)
- `POST /api/queue/[id]/call` — Llamar action; returns `ServiceResult<QueueMutationData>` with HTTP 200/401/403/404/409/500 per Phase 2 status mapping
- `POST /api/queue/[id]/seated` — Marcar presentado; same shape

Hooks (plan 02):
```typescript
useQueueEvents(): {reservations: ActiveQueueRow[], latestEvent: ReservationEvent | null, connection: ConnectionState};
```

Edge Config (Phase 1):
```typescript
import { getTypedConfig } from "@/lib/edge-config";
await getTypedConfig<Record<string, string>>("colors_by_party_size", {
  "1-2": "#A8E6CF", "3-4": "#FFD3B6", "5-6": "#FFAAA5", "7+": "#D5AAFF",
});
```
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Mount Sonner Toaster in `app/layout.tsx` (app-wide toast root)</name>
  <files>app/layout.tsx</files>
  <read_first>
    - app/layout.tsx (current Phase 1 layout — read to know what to extend; do NOT remove anything)
    - components/ui/sonner.tsx (the Toaster component shipped by plan 02 — verify export name)
    - .planning/phases/03-user-surfaces/03-UI-SPEC.md §"Action error toast" (Sonner config: `position="bottom-right"`, `duration={5000}`)
  </read_first>
  <action>
1. Open `app/layout.tsx` and add the Toaster mount inside the `<body>` (typically after `{children}` so toasts render above page content):
```tsx
import { Toaster } from "@/components/ui/sonner";
// ... existing imports

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>
        {children}
        <Toaster position="bottom-right" duration={5000} richColors />
      </body>
    </html>
  );
}
```

2. Note: shadcn's Sonner wrapper accepts `position` and `duration` as props (passed through to `sonner` package). `richColors` enables green-success / red-error theming so the action toasts visually differentiate.

3. Confirm `<html lang="es">` is set (Spanish-only project — already done in Phase 1 most likely; verify and add if missing).

4. Do NOT change anything else in layout.tsx — keep Phase 1 font setup, metadata, etc.
  </action>
  <verify>
    <automated>npx tsc --noEmit && grep -F '<Toaster' app/layout.tsx && grep -F 'position="bottom-right"' app/layout.tsx</automated>
  </verify>
  <acceptance_criteria>
    - `app/layout.tsx` imports `Toaster` from `@/components/ui/sonner`
    - `<Toaster />` is rendered inside `<body>` after `{children}`
    - Props include `position="bottom-right"` and `duration={5000}` (UI-SPEC requirements)
    - `<html lang="es">` is present
    - `npx tsc --noEmit` exits 0
  </acceptance_criteria>
  <done>
Toast root is mounted. Plan 04 components can call `toast.error("...")` from `sonner` directly and toasts render at bottom-right.
  </done>
</task>

<task type="auto">
  <name>Task 2: Build the 4 panel components under `components/queue/`</name>
  <files>components/queue/queue-card.tsx, components/queue/connection-dot.tsx, components/queue/nav-bar.tsx, components/queue/queue-grid.tsx</files>
  <read_first>
    - .planning/phases/03-user-surfaces/03-UI-SPEC.md §"Surface 2: Maître Panel" lines 152-177 (queue card anatomy + nav-bar layout + action flow + states)
    - .planning/phases/03-user-surfaces/03-UI-SPEC.md §"Copywriting Contract → Maître surface" lines 230-262 (verbatim Spanish copy)
    - .planning/phases/03-user-surfaces/03-PATTERNS.md §"Components in components/chat/* and components/queue/*" lines 535-560 (cva variant style)
    - .planning/phases/03-user-surfaces/03-CONTEXT.md D-13, D-14, D-15, D-19 (layout, color treatment, wait-for-server, error states)
    - lib/hooks/use-queue-events.ts (the hook this panel consumes — re-read to verify return shape)
    - components/ui/button.tsx, card.tsx, badge.tsx, skeleton.tsx, tabs.tsx (shadcn primitives composed here)
  </read_first>
  <action>
Build each component as a `"use client";` component (except `nav-bar.tsx` which can be RSC-safe but include `"use client"` for the connection-dot child to work). Spanish copy verbatim from UI-SPEC.

### `components/queue/connection-dot.tsx`
Props: `{ connection: "connecting" | "connected" | "reconnecting" | "failed" }`. Renders 8px circle + Spanish label:
```tsx
"use client";
import { cn } from "@/lib/utils";

const COLOR: Record<string, string> = {
  connecting: "bg-yellow-400",
  connected: "bg-green-500",
  reconnecting: "bg-yellow-400",
  failed: "bg-red-500",
};
const LABEL: Record<string, string> = {
  connecting: "conectando",
  connected: "en vivo",
  reconnecting: "reconectando",
  failed: "sin conexión",
};

export function ConnectionDot({ connection }: { connection: keyof typeof COLOR }) {
  return (
    <div className="flex items-center gap-2" title={`SSE ${LABEL[connection]}`}>
      <span className={cn("w-2 h-2 rounded-full inline-block", COLOR[connection])} aria-hidden />
      <span className="text-xs text-muted-foreground">{LABEL[connection]}</span>
    </div>
  );
}
```

### `components/queue/nav-bar.tsx`
Props: `{ active: "active" | "history"; connection?: "connecting" | "connected" | "reconnecting" | "failed" }`. (active="history" is for plan 05's `/queue/history` page — ship the prop now to avoid an edit later.)
```tsx
"use client";
import Link from "next/link";
import { ConnectionDot } from "./connection-dot";
import { cn } from "@/lib/utils";

export function NavBar({ active, connection }: { active: "active" | "history"; connection?: "connecting" | "connected" | "reconnecting" | "failed" }) {
  return (
    <nav className="h-12 border-b px-4 flex items-center justify-between sticky top-0 bg-background z-40">
      <span className="text-base font-semibold">Panel de Maître</span>
      <div className="flex gap-4 text-sm">
        <Link href="/queue" className={cn("font-normal", active === "active" ? "text-foreground" : "text-muted-foreground")}>
          Activas
        </Link>
        <Link href="/queue/history" className={cn("font-normal", active === "history" ? "text-foreground" : "text-muted-foreground")}>
          Historial
        </Link>
      </div>
      {connection ? <ConnectionDot connection={connection} /> : <span aria-hidden />}
    </nav>
  );
}
```

### `components/queue/queue-card.tsx`
Props:
```typescript
{
  reservation: ActiveQueueRow;
  partyColor: string;
  onAction: (action: "call" | "seated") => void;
  loadingAction: "call" | "seated" | null;
}
```
Layout per UI-SPEC §"Queue card anatomy" lines 161-168:
- Outer: `rounded-lg border bg-card shadow-sm border-l-4 p-4 flex flex-col gap-2` with `style={{borderLeftColor: partyColor}}`
- Top row:
  - Party-size badge: `style={{backgroundColor: partyColor}} className="text-xs font-normal px-1.5 py-0.5 rounded"` showing the size number
  - Name: `text-base font-semibold truncate flex-1` (truncate so long names don't break layout; `title` attr holds full name)
  - Extension badge if `extension_count > 0`: `bg-orange-100 text-orange-700 text-xs rounded-full px-2 py-0.5` showing `extendido ×{extension_count}`
  - Reopen badge if `reopen_count > 0`: `bg-purple-100 text-purple-700 text-xs rounded-full px-2 py-0.5` showing `reabierto ×{reopen_count}` (additive — plan 05 ships migration; harmless when count=0)
- Middle row: `Esperando hace {min} min` (computed `Math.floor((Date.now() - new Date(created_at).valueOf()) / 60000)`) + `ETA {eta_min ?? "—"} min` + status pill (use cva variants from PATTERNS.md §"Components in components/chat/* and components/queue/*" lines 543-555)
- Bottom row: `flex gap-2 mt-2` with action button:
  - status='waiting': `<Button variant="default" size="sm" className="min-h-[44px]" onClick={() => onAction("call")} disabled={loadingAction === "call"}>{loadingAction === "call" ? <Spinner/> : "Llamar"}</Button>` ([Marcar presentado] is ABSENT, not disabled — D-13 explicit)
  - status='called': `<Button>Marcar presentado</Button>` (`[Llamar]` is ABSENT)

Aria: `aria-label="Llamar a {name} ({party_size} personas)"` (UI-SPEC line 339).

### `components/queue/queue-grid.tsx`
Client island. Props: `{ initial: ActiveQueueRow[]; colorsByPartySize: Record<string, string> }`.

```tsx
"use client";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useQueueEvents, type ActiveQueueRow } from "@/lib/hooks/use-queue-events";
import { QueueCard } from "./queue-card";
import { NavBar } from "./nav-bar";
import { Skeleton } from "@/components/ui/skeleton";

function pickColor(partySize: number, palette: Record<string, string>): string {
  if (partySize <= 2) return palette["1-2"] ?? "#A8E6CF";
  if (partySize <= 4) return palette["3-4"] ?? "#FFD3B6";
  if (partySize <= 6) return palette["5-6"] ?? "#FFAAA5";
  return palette["7+"] ?? "#D5AAFF";
}

export function QueueGrid({ initial, colorsByPartySize }: { initial: ActiveQueueRow[]; colorsByPartySize: Record<string, string> }) {
  const { reservations: liveReservations, latestEvent, connection } = useQueueEvents();
  // Use initial server-rendered snapshot until the hook's first SSE snapshot arrives.
  const reservations = liveReservations.length > 0 ? liveReservations : initial;
  const [loadingMap, setLoadingMap] = useState<Record<string, "call" | "seated" | null>>({});
  const [now, setNow] = useState<number>(Date.now());

  // Refresh wait-time display every 30s (D-13 — cosmetic, NOT SSE-driven)
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  // Show error state on ≥3 failed reconnects
  const sseFailed = connection === "failed";

  async function handleAction(reservationId: string, action: "call" | "seated") {
    setLoadingMap((m) => ({ ...m, [reservationId]: action }));
    try {
      const res = await fetch(`/api/queue/${reservationId}/${action}`, {
        method: "POST",
        credentials: "include",
      });
      const body = await res.json();
      if (!res.ok || !body.ok) {
        toast.error(body?.error?.message ?? "Error desconocido");
        // SSE will sync state regardless; clear loading immediately so the absent-button rule applies cleanly
      }
    } catch {
      toast.error("No pudimos completar la acción. Probá de nuevo.");
    } finally {
      setLoadingMap((m) => ({ ...m, [reservationId]: null }));
    }
  }

  return (
    <>
      <NavBar active="active" connection={connection} />
      {sseFailed && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded mx-4 mt-4 px-4 py-2">
          Sin conexión en vivo. Refrescá la página.
        </div>
      )}
      {reservations.length === 0 ? (
        <div className="text-center py-16">
          <h2 className="text-xl font-semibold">Sin reservas activas</h2>
          <p className="text-sm text-muted-foreground mt-2">Cuando alguien se anote, va a aparecer acá.</p>
          <p className="text-xs text-muted-foreground mt-4">
            Última actualización: {new Date(now).toTimeString().slice(0, 8)}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 p-4">
          {reservations.map((r) => (
            <QueueCard
              key={r.reservation_id}
              reservation={r}
              partyColor={pickColor(r.party_size, colorsByPartySize)}
              onAction={(action) => handleAction(r.reservation_id, action)}
              loadingAction={loadingMap[r.reservation_id] ?? null}
              now={now}
            />
          ))}
        </div>
      )}
    </>
  );
}
```

(Threading `now` to QueueCard is needed so wait-time refresh is consistent across cards.)

### Loading state
The page itself does NOT show a skeleton during initial render — RSC SSR delivers the first snapshot. Skeleton is only relevant if SSE fails AND `reservations.length === 0`. Skip the skeleton path for v1; UI-SPEC §"Loading state" line 170 spec is reachable via plan 05's history page, not here.
  </action>
  <verify>
    <automated>npx tsc --noEmit && ls components/queue/queue-card.tsx components/queue/queue-grid.tsx components/queue/connection-dot.tsx components/queue/nav-bar.tsx && grep -F 'border-l-4' components/queue/queue-card.tsx && grep -F 'borderLeftColor' components/queue/queue-card.tsx && grep -F 'min-h-[44px]' components/queue/queue-card.tsx</automated>
  </verify>
  <acceptance_criteria>
    - All 4 component files exist under `components/queue/`
    - Each starts with `"use client";`
    - `connection-dot.tsx` has 4 connection states + corresponding Spanish labels (`en vivo`, `reconectando`, `sin conexión`, `conectando`)
    - `nav-bar.tsx` renders Activas + Historial nav links + ConnectionDot
    - `queue-card.tsx` uses `border-l-4` + inline `borderLeftColor` style for the party-size color band
    - `queue-card.tsx` action buttons have `min-h-[44px]` (UI-SPEC accessibility)
    - `queue-card.tsx` renders ONLY [Llamar] when status='waiting' and ONLY [Marcar presentado] when status='called' (no disabled-state alternative — UI-SPEC line 166)
    - `queue-card.tsx` shows extension badge when `extension_count > 0` and reopen badge when `reopen_count > 0`
    - `queue-grid.tsx` consumes `useQueueEvents()` and renders the grid `grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 p-4`
    - `queue-grid.tsx` shows the empty-state Spanish copy when reservations is empty
    - `queue-grid.tsx` shows the SSE-error red banner when connection==="failed"
    - All Spanish copy verbatim from UI-SPEC §"Copywriting Contract → Maître surface"
    - `npx tsc --noEmit` exits 0
  </acceptance_criteria>
  <done>
The 4 panel components are testable in isolation. Plan 05's `/queue/history` will reuse `nav-bar.tsx` (active="history") and `connection-dot.tsx` is shared.
  </done>
</task>

<task type="auto">
  <name>Task 3: Replace `app/queue/page.tsx` with Server Component + client island handoff</name>
  <files>app/queue/page.tsx</files>
  <read_first>
    - app/queue/page.tsx (current Phase 1 stub — read to know what to replace; preserve auth shell)
    - .planning/phases/03-user-surfaces/03-RESEARCH.md §Pattern 4 lines 685-734 (canonical RSC + island)
    - .planning/phases/03-user-surfaces/03-PATTERNS.md §"app/queue/page.tsx (REPLACE Phase 1 stub)" lines 357-402 (preserve auth bones; defense-in-depth re-check)
    - lib/services/queue.ts → getActiveQueue
    - lib/edge-config/index.ts → getTypedConfig
    - lib/auth/auth.ts → auth()
    - app/api/events/queue/route.ts (auth shape — match the same `employees.active` defense-in-depth check)
  </read_first>
  <action>
1. Replace `app/queue/page.tsx` with the Server Component shell:
```tsx
// app/queue/page.tsx
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/auth";
import { sql } from "@/lib/db/neon";
import { getActiveQueue } from "@/lib/services/queue";
import { getTypedConfig } from "@/lib/edge-config";
import { QueueGrid } from "@/components/queue/queue-grid";

export const dynamic = "force-dynamic";

export default async function QueuePage() {
  const session = await auth();
  if (!session?.user?.email) redirect("/login");

  // Defense-in-depth re-check (mirrors Phase 2 SSE handler at app/api/events/queue/route.ts lines 58-65).
  // proxy.ts already gates /queue/:path*, but employees may have been deactivated since the cookie was issued.
  const empRows = (await sql`
    SELECT active FROM employees WHERE email = ${session.user.email} LIMIT 1
  `) as Array<{ active: boolean }>;
  if (empRows.length === 0 || !empRows[0].active) redirect("/login");

  const initial = await getActiveQueue();
  const colorsByPartySize = await getTypedConfig<Record<string, string>>(
    "colors_by_party_size",
    { "1-2": "#A8E6CF", "3-4": "#FFD3B6", "5-6": "#FFAAA5", "7+": "#D5AAFF" },
  );

  return <QueueGrid initial={initial} colorsByPartySize={colorsByPartySize} />;
}
```

2. The SSR snapshot via `getActiveQueue()` means the page renders cards on first paint — no loading skeleton flash. SSE then takes over for live updates.

3. Edge Config read happens server-side ONCE per request (RSC). The palette is passed as a serializable prop to the client island — no client-side `@vercel/edge-config` import.

4. NO `"use client";` at the top of this file — it's a Server Component. The client island lives in `components/queue/queue-grid.tsx`.

5. Atomic commit per D-31. The chatbot at `/` (plan 03) and the panel at `/queue` are now both live. SSE roundtrip works end-to-end:
   - Maître clicks Llamar → POST /api/queue/[id]/call → markCalled() updates row + publishes `reservation:<id>` and `queue:active` channels
   - Diner's `/api/events/[reservation_id]` SSE delivers the `reservation.called` event → push banner shows "TU MESA ESTÁ LISTA"
   - Maître's `/api/events/queue` SSE delivers the `queue.changed` event → card mutates from [Llamar] to [Marcar presentado]
  </action>
  <verify>
    <automated>npm run build && grep -c 'employees.active' app/queue/page.tsx && grep -F 'getActiveQueue' app/queue/page.tsx && grep -F 'colors_by_party_size' app/queue/page.tsx && ! grep -F '"use client"' app/queue/page.tsx</automated>
  </verify>
  <acceptance_criteria>
    - `app/queue/page.tsx` does NOT contain `"use client";` directive
    - Imports `auth` from `@/lib/auth/auth`
    - Imports `getActiveQueue` from `@/lib/services/queue`
    - Imports `getTypedConfig` from `@/lib/edge-config`
    - Re-checks `employees.active = true` via `sql\`...\`` AFTER the session check (defense in depth)
    - Calls `redirect("/login")` if session missing OR employee inactive
    - Renders `<QueueGrid initial={...} colorsByPartySize={...} />`
    - No raw `console.*`
    - `npm run build` exits 0
  </acceptance_criteria>
  <done>
The maître panel ships. Auto-deployed via `git push origin main`. Both `/` and `/queue` are live in production atomically.
  </done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <name>Task 4: End-to-end smoke between chatbot and panel (the demo's money-shot pair)</name>
  <files>(no files modified — verification only)</files>
  <read_first>
    - .planning/phases/03-user-surfaces/03-UI-SPEC.md §"Queue panel (`/queue`) — action flow" lines 282-290
  </read_first>
  <what-built>
    - Sonner Toaster mounted in `app/layout.tsx`
    - 4 panel components in `components/queue/`
    - `app/queue/page.tsx` Server Component + client island
    - 6 phase requirements ship: STAFF-02..07
  </what-built>
  <how-to-verify>
1. Open `https://zero-to-agent-xi.vercel.app/login` and log in as the seeded maître via Resend magic link.
2. Navigate to `/queue`. Expected: see seed-demo's 3 reservations (waiting, called, seated states — the "seated" one is filtered out per `getActiveQueue()` so you should see 2 active cards).
3. Open a SECOND tab in incognito or another browser to `https://zero-to-agent-xi.vercel.app/`. Register a new diner conversationally. After confirmation, the diner's tab shows the status card.
4. Switch back to the maître `/queue` tab. Expected: the new reservation appears as a card within ~3s (SSE-driven). Connection dot is green.
5. **THE DEMO MONEY SHOT (DINER-03 + STAFF-05):**
   - On the maître tab, click [Llamar] on the new card. Button shows loading spinner.
   - Switch to the diner tab. Within ~2s, push banner appears: **"TU MESA ESTÁ LISTA"** with party-size colored background.
   - Back on maître tab, the card has mutated — [Llamar] is gone, [Marcar presentado] is now there.
6. **Followup wait (DINER-04):** Stay on the diner tab. After `followup_after_call_min` (Edge Config — likely 1 min), the banner mutates to "¿Estás en camino?" with two chips.
7. **Color coding (STAFF-04):** Verify each card has a left-border color matching the party size (1-2 = green, 3-4 = orange, etc.). Edit `colors_by_party_size` in Vercel Edge Config dashboard, change one hex, refresh `/queue` — color updates without redeploy (this is demo scenario 5).
8. **Marcar presentado (STAFF-06):** Click [Marcar presentado] on the called card. Within ~2s, the card disappears from the grid (status no longer in waiting/called).
9. **Real-time on creation (STAFF-07):** While on maître tab, register a new diner from another tab. Card appears live without refresh.
10. **Connection dot (UI-SPEC):** Throw the maître tab into airplane mode (or kill network for 5s). Dot transitions yellow → red. Re-enable network → eventually green again. (Browser auto-reconnect ~3s.)
11. **Action error toast:** Trigger an error path manually — e.g., the diner cancels their reservation right before the maître clicks Llamar. The maître's POST should return 409. Sonner toast shows the Spanish error.
12. **PII safety:** Run `vercel logs --follow` while clicking actions. Confirm no raw email/phone/name in log lines (only reservation IDs).

If all 12 pass: type "approved". Plan 05 (history + reopen) and plan 06 (PLAT-08 body swap) can now ship.
If any fail: report which; the most likely culprits are SSE event names not matching between Phase 2 publishers and plan 02 hooks (re-check the TYPED_EVENTS list).
  </how-to-verify>
  <resume-signal>Type "approved" to confirm panel is production-ready.</resume-signal>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| browser ↔ /queue (RSC + SSE) | Auth.js cookie crosses; `employees.active` re-checked server-side every request |
| browser ↔ /api/queue/[id]/{call,seated} (POST) | Auth.js cookie + same-origin; CSRF protected by SameSite=Lax |
| RSC ↔ Edge Config | server-side fetch; no client exposure of palette beyond what's serialized as props |
| useQueueEvents ↔ /api/events/queue | Auth.js cookie via withCredentials:true |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-03-04-01 | Spoofing | unauthenticated user accesses /queue | mitigate | Phase 1 proxy.ts gates /queue/:path*; defense-in-depth re-check in app/queue/page.tsx (employees.active) — belt-and-suspenders. Phase 1 D-12 |
| T-03-04-02 | Spoofing | inactive employee accesses /queue (cookie still valid) | mitigate | Server-side re-validation in RSC body — `redirect("/login")` if employees.active=false |
| T-03-04-03 | Tampering | CSRF on action POST endpoints | mitigate | Auth.js v5 cookies are SameSite=Lax (default) — cross-site POST is blocked. Plan does NOT add explicit CSRF tokens (deferred to Phase 4 if multi-origin embedding is ever requested). |
| T-03-04-04 | Information Disclosure | reservations data leaked to anonymous users via SSE | mitigate | /api/events/queue requires Auth.js cookie + employees.active (Phase 2 D-29). Plan 04 does NOT change SSE handler. |
| T-03-04-05 | Information Disclosure | PII (name, phone, email) in client-side state visible to browser ext | accept | Maître panel needs at least name + party_size to function; phone+email are NOT in `getActiveQueue()` projection (Phase 2 ships row shape without them — verify in lib/services/queue.ts). If phone/email appear in projection, escalate. |
| T-03-04-06 | Denial of Service | maître spams [Llamar] before SSE confirms | mitigate | Button enters loading state (`loadingAction === "call"`), `disabled={true}`. Re-enables on response (and SSE reaches consistency). Server idempotency is Phase 4 — for now, repeated POSTs to /call on already-called reservation return 409 RESERVATION_ALREADY_CLOSED or NOT_IN_WAITING_OR_CALLED_STATE. |

No high-severity threats. Auth gate is layered (proxy.ts + RSC re-check + SSE re-check); CSRF mitigated by SameSite cookies.
</threat_model>

<verification>
- `npm run build` exits 0
- `getActiveQueue` projection does NOT include `email` or `phone` (`grep -E "(email|phone)" lib/services/queue.ts` shows only function arguments / signatures, not SELECT columns) — verify
- `app/queue/page.tsx` re-validates `employees.active`
- All 4 panel components are TS-clean
- Toaster mounted in layout.tsx
- Manual smoke (task 4) confirms 12 scenarios PASS
- `npm run smoke:money-shot --dry-run` still green (no Phase 2 regression)
</verification>

<success_criteria>
- 6 of 19 phase requirements ship: STAFF-02..07
- Maître panel renders correctly on mobile (host stand use case)
- Real-time updates flow chatbot→panel and panel→chatbot end-to-end
- STAFF-04 color coding consumes live Edge Config (demo scenario 5 mechanism is proven)
- No regression to Phase 2 contracts
- Push to prod via `git push origin main` succeeds
</success_criteria>

<output>
After completion, create `.planning/phases/03-user-surfaces/03-04-panel-SUMMARY.md` with:
- 4 component LOC counts
- Whether `getActiveQueue` projection needed widening (e.g., to include `reopen_count` — likely yes; document as a sub-deviation if so)
- Manual smoke results (12 scenarios PASS/FAIL)
- Production deploy SHA + URL
- D-31 push confirmation
</output>
