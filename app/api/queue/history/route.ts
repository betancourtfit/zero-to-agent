// GET /api/queue/history — day-scoped closed reservations for maître history view (STAFF-08 / D-17).
//
// Auth-gated: 401 on no session, 403 on employees.active=false (mirrors /api/queue/[id]/seated pattern).
// Returns status IN ('seated', 'no_show', 'cancelled') for today in Buenos Aires timezone.
// Sorted by ended_at DESC NULLS LAST.
//
// No SSE on this endpoint — D-17 is explicit: the history page polls every 30s.
// Inline SQL here (not a 6th service export) — read-only, single consumer, keeps
// lib/services/queue.ts at 5 exports per plan 03-05 architecture note.
//
// PII note: returns `name` (operationally needed by maître to identify diners).
// Phone and email are NOT projected. Phase 4 PII audit may restrict to first-name-only.

import { auth } from "@/lib/auth/auth";
import { sql } from "@/lib/db/neon";
import { log } from "@/lib/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export interface HistoryRow {
  reservation_id: string;
  status: "seated" | "no_show" | "cancelled";
  name: string;
  party_size: number;
  eta_min: number | null;
  extension_count: number;
  reopen_count: number;
  created_at: string;
  called_at: string | null;
  ended_at: string | null;
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.email) {
    log.warn("api.queue.history.unauthorized", { reason: "no_session" });
    return Response.json(
      { ok: false, error: { code: "UNAUTHORIZED", message: "No autorizado." } },
      { status: 401 },
    );
  }

  const empRows = (await sql`
    SELECT active FROM employees WHERE email = ${session.user.email} LIMIT 1
  `) as Array<{ active: boolean }>;

  if (empRows.length === 0 || !empRows[0].active) {
    log.warn("api.queue.history.forbidden", { reason: "employee_inactive" });
    return Response.json(
      { ok: false, error: { code: "FORBIDDEN", message: "Empleado inactivo." } },
      { status: 403 },
    );
  }

  // D-17: day-scoped, Buenos Aires timezone, terminal statuses only, sorted by ended_at DESC.
  const rows = (await sql`
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
      AND DATE(created_at AT TIME ZONE 'America/Argentina/Buenos_Aires')
        = (CURRENT_TIMESTAMP AT TIME ZONE 'America/Argentina/Buenos_Aires')::date
    ORDER BY ended_at DESC NULLS LAST
  `) as HistoryRow[];

  log.info("api.queue.history.read", {
    count: rows.length,
  });

  return Response.json({ ok: true, data: rows });
}
