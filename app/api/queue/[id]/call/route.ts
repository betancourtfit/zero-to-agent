// POST /api/queue/[id]/call — staff action: advance waiting → called.
//
// Thin wrapper around lib/services/queue.ts → markCalled() (D-18 / D-30).
// The service handles the full pattern: D-10 DB-backed safety net (INSERT
// reservation_events BEFORE resumeHook), in-process resumeHook (D-37),
// and KV publish (D-20). This route only does auth + service dispatch.
//
// Auth (D-29): auth() session check + employees.active gate. Pattern
// established in app/api/events/queue/route.ts (plan 02-06).
//
// Next.js 16 dynamic params: `params: Promise<{ id: string }>` — must be
// awaited (per plan 02-06 deviation #4 lock).
//
// Error contract: { ok, data?, error?: { code, message } } with HTTP
// status codes from the service-layer ServiceResult shape.

import { auth } from "@/lib/auth/auth";
import { sql } from "@/lib/db/neon";
import { log } from "@/lib/log";
import { markCalled } from "@/lib/services/queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Map ServiceResult error codes to HTTP status codes.
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
    log.warn("api.queue.call.unauthorized", {
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
    log.warn("api.queue.call.forbidden", {
      reason: "employee_inactive",
      reservation_id: id,
    });
    return Response.json(
      { ok: false, error: { code: "FORBIDDEN", message: "Empleado inactivo." } },
      { status: 403 },
    );
  }

  // === Service dispatch ===
  log.info("api.queue.call.start", {
    reservation_id: id,
    employee_email: session.user.email,
  });

  const result = await markCalled(id);

  if (!result.ok) {
    log.warn("api.queue.call.service_error", {
      reservation_id: id,
      code: result.error.code,
    });
    return Response.json(result, { status: statusForErrorCode(result.error.code) });
  }

  log.info("api.queue.call.ok", { reservation_id: id });
  return Response.json(result);
}
