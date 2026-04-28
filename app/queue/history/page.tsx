import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/auth";
import { sql } from "@/lib/db/neon";
import { HistoryTable } from "@/components/queue/history-table";
import { NavBar } from "@/components/queue/nav-bar";
import type { HistoryRow } from "@/app/api/queue/history/route";

export const dynamic = "force-dynamic";

// /queue/history — day-scoped closed reservations for the maître (STAFF-08).
// Server Component: auth-gated, SSR snapshot, no SSE (D-17).
// Hands off to <HistoryTable initial={initial} /> which polls every 30s client-side.

export default async function HistoryPage() {
  const session = await auth();
  if (!session?.user?.email) redirect("/login");

  // Defense-in-depth re-check (mirrors /queue page and Phase 2 SSE handlers).
  const empRows = (await sql`
    SELECT active FROM employees WHERE email = ${session.user.email} LIMIT 1
  `) as Array<{ active: boolean }>;
  if (empRows.length === 0 || !empRows[0].active) redirect("/login");

  // SSR initial snapshot: same SQL as /api/queue/history to avoid loading-skeleton flash.
  // Direct DB read is faster than fetch()-ing our own route handler at RSC render time.
  const initial = (await sql`
    SELECT id AS reservation_id,
           status,
           name,
           party_size,
           eta_min,
           extension_count,
           reopen_count,
           created_at::text AS created_at,
           called_at::text   AS called_at,
           ended_at::text    AS ended_at
    FROM reservations
    WHERE status IN ('seated', 'no_show', 'cancelled')
      AND DATE(created_at AT TIME ZONE 'America/Argentina/Buenos_Aires') = CURRENT_DATE
    ORDER BY ended_at DESC NULLS LAST
  `) as HistoryRow[];

  return (
    <>
      <NavBar active="history" />
      <main className="p-4">
        <HistoryTable initial={initial} />
      </main>
    </>
  );
}
