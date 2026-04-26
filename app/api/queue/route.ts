// GET active queue list — staff-only REST endpoint (D-30, PLAT-01).
//
// This endpoint complements the staff SSE handler at /api/events/queue:
// the Phase 3 panel will use this REST call for first paint, then upgrade
// to SSE for live updates. Phase 2 callers (smoke tests, curl) use it to
// verify the active queue between staff actions.
//
// Auth (D-29): auth() session check + employees.active = true gate. The
// session callback in lib/auth/auth.ts already strips inactive employees,
// but we re-check here as defense-in-depth — exactly the pattern
// established in app/api/events/queue/route.ts (plan 02-06).
//
// Service-layer funnel (D-18 / ARCHITECTURE §3.1): this route is a thin
// wrapper around getActiveQueue() — no SQL or business logic in routes.

import { auth } from "@/lib/auth/auth";
import { sql } from "@/lib/db/neon";
import { log } from "@/lib/log";
import { getActiveQueue } from "@/lib/services/queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  // === D-29: Staff auth — auth() + employees.active gate ===
  const session = await auth();
  if (!session?.user?.email) {
    log.warn("api.queue.unauthorized", { reason: "no_session" });
    return Response.json(
      { ok: false, error: { code: "UNAUTHORIZED", message: "No autorizado." } },
      { status: 401 },
    );
  }

  // Schema: employees.email is UNIQUE NOT NULL. Match by email (the
  // established pattern; the v5 session in this app surfaces email, not id).
  const empRows = (await sql`
    SELECT active FROM employees WHERE email = ${session.user.email} LIMIT 1
  `) as Array<{ active: boolean }>;

  if (empRows.length === 0 || !empRows[0].active) {
    log.warn("api.queue.forbidden", { reason: "employee_inactive" });
    return Response.json(
      { ok: false, error: { code: "FORBIDDEN", message: "Empleado inactivo." } },
      { status: 403 },
    );
  }

  const queue = await getActiveQueue();

  log.info("api.queue.read", {
    employee_email: session.user.email,
    count: queue.length,
  });

  return Response.json({ ok: true, data: queue });
}
