// POST /api/queue/[id]/no_show_manual — staff action: manual no-show override.
//
// This is the manual override path: staff can close a reservation as
// no_show without waiting for the workflow's no_show_deadline timer.
// STAFF-09 (undo no-show) lives in Phase 3 with the panel UI.
//
// Thin wrapper around lib/services/queue.ts → markNoShowManual()
// (D-18 / D-30). Service layer added markNoShowManual in plan 02-03
// deviation #2 specifically to back this endpoint without forcing inline
// SQL+KV+resumeHook here (which would violate ARCHITECTURE §3.1 funnel).
// Service handles D-10 DB safety net, D-37 in-process resumeHook, D-20
// KV publish, and the source='manual' flag the workflow timer-driven
// no_show variant lacks.
//
// Auth (D-29): auth() session check + employees.active gate. Same pattern
// as the other staff action endpoints.

import { auth } from "@/lib/auth/auth";
import { sql } from "@/lib/db/neon";
import { log } from "@/lib/log";
import { markNoShowManual } from "@/lib/services/queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function statusForErrorCode(code: string): number {
  switch (code) {
    case "RESERVATION_NOT_FOUND":
      return 404;
    case "RESERVATION_ALREADY_CLOSED":
    case "NOT_IN_CALLED_STATE":
    case "NOT_IN_WAITING_OR_CALLED_STATE":
    case "MAX_EXTENSIONS_REACHED":
      return 409;
    case "INVALID_INPUT":
    case "INVALID_SESSION":
      return 400;
    default:
      return 500;
  }
}

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  // === D-29: Staff auth ===
  const session = await auth();
  if (!session?.user?.email) {
    log.warn("api.queue.no_show_manual.unauthorized", {
      reason: "no_session",
      reservation_id: id,
    });
    return Response.json(
      { ok: false, error: { code: "UNAUTHORIZED", message: "No autorizado." } },
      { status: 401 },
    );
  }

  const empRows = (await sql`
    SELECT active FROM employees WHERE email = ${session.user.email} LIMIT 1
  `) as Array<{ active: boolean }>;

  if (empRows.length === 0 || !empRows[0].active) {
    log.warn("api.queue.no_show_manual.forbidden", {
      reason: "employee_inactive",
      reservation_id: id,
    });
    return Response.json(
      { ok: false, error: { code: "FORBIDDEN", message: "Empleado inactivo." } },
      { status: 403 },
    );
  }

  // === Service dispatch ===
  log.info("api.queue.no_show_manual.start", {
    reservation_id: id,
    employee_email: session.user.email,
  });

  const result = await markNoShowManual(id);

  if (!result.ok) {
    log.warn("api.queue.no_show_manual.service_error", {
      reservation_id: id,
      code: result.error.code,
    });
    return Response.json(result, { status: statusForErrorCode(result.error.code) });
  }

  log.info("api.queue.no_show_manual.ok", { reservation_id: id });
  return Response.json(result);
}
