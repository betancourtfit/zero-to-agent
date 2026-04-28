// POST /api/queue/[id]/reopen — staff action: undo no_show → waiting (STAFF-09 / D-16).
//
// Thin wrapper around lib/services/queue.ts → reopenNoShow() (D-18 / D-30).
// Service handles D-14 compensating action (no row mutation if start() throws),
// D-10 DB safety net (INSERT reservation_events), and D-20 KV publish.
//
// Auth (D-29): auth() session check + employees.active gate. Same pattern
// as /api/queue/[id]/seated/route.ts and siblings.

import { auth } from "@/lib/auth/auth";
import { sql } from "@/lib/db/neon";
import { log } from "@/lib/log";
import { reopenNoShow } from "@/lib/services/queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function statusForErrorCode(code: string): number {
  switch (code) {
    case "RESERVATION_NOT_FOUND":
      return 404;
    case "RESERVATION_ALREADY_CLOSED":
    case "NOT_IN_NO_SHOW_STATE":
      return 409;
    case "INVALID_INPUT":
    case "INVALID_SESSION":
      return 400;
    case "INTERNAL_ERROR":
    default:
      return 500;
  }
}

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  // Next.js 16 dynamic route params are a Promise (D-32 / plan 02-06 deviation #4).
  const { id } = await params;

  // === D-29: Staff auth ===
  const session = await auth();
  if (!session?.user?.email) {
    log.warn("api.queue.reopen.unauthorized", {
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
    log.warn("api.queue.reopen.forbidden", {
      reason: "employee_inactive",
      reservation_id: id,
    });
    return Response.json(
      { ok: false, error: { code: "FORBIDDEN", message: "Empleado inactivo." } },
      { status: 403 },
    );
  }

  // === Service dispatch ===
  log.info("api.queue.reopen.start", {
    reservation_id: id,
    employee_email: session.user.email,
  });

  const result = await reopenNoShow(id);

  if (!result.ok) {
    log.warn("api.queue.reopen.service_error", {
      reservation_id: id,
      code: result.error.code,
    });
    return Response.json(result, { status: statusForErrorCode(result.error.code) });
  }

  log.info("api.queue.reopen.ok", {
    reservation_id: id,
    employee_email: session.user.email,
  });
  return Response.json(result);
}
