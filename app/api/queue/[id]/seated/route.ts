// POST /api/queue/[id]/seated — staff action: close called → seated.
//
// Thin wrapper around lib/services/queue.ts → markSeated() (D-18 / D-30).
// Service handles D-10 DB safety net (INSERT reservation_events BEFORE
// resumeHook), D-37 in-process resumeHook, and D-20 KV publish.
//
// Auth (D-29): auth() session check + employees.active gate. Same pattern
// as /api/queue/[id]/call/route.ts and /api/events/queue/route.ts.

import { auth } from "@/lib/auth/auth";
import { sql } from "@/lib/db/neon";
import { log } from "@/lib/log";
import { markSeated } from "@/lib/services/queue";

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
    log.warn("api.queue.seated.unauthorized", {
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
    log.warn("api.queue.seated.forbidden", {
      reason: "employee_inactive",
      reservation_id: id,
    });
    return Response.json(
      { ok: false, error: { code: "FORBIDDEN", message: "Empleado inactivo." } },
      { status: 403 },
    );
  }

  // === Service dispatch ===
  log.info("api.queue.seated.start", {
    reservation_id: id,
    employee_email: session.user.email,
  });

  const result = await markSeated(id);

  if (!result.ok) {
    log.warn("api.queue.seated.service_error", {
      reservation_id: id,
      code: result.error.code,
    });
    return Response.json(result, { status: statusForErrorCode(result.error.code) });
  }

  log.info("api.queue.seated.ok", { reservation_id: id });
  return Response.json(result);
}
