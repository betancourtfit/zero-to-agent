// PII-safe diner status projection (D-10).
// Hydrates the returning-diner status card on page mount.
// Only session_token flows through query param; name/email/phone NEVER returned.
//
// Discipline:
//   - GET only — no POST/PUT/DELETE
//   - Wraps lib/services/reservations.ts → getReservationStatus (service-layer funnel)
//   - Re-projects only the safe subset even though service already projects safely
//     (defense-in-depth against future service changes — D-10)
//   - All logs via lib/log.ts (D-24, SAFE-01)

import { NextResponse } from "next/server";

import { getReservationStatus } from "@/lib/services/reservations";
import { log } from "@/lib/log";

export const runtime = "nodejs";
export const maxDuration = 10;
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const sessionToken = url.searchParams.get("session_token");

  if (!sessionToken) {
    log.warn("api.me.unauthorized", { reason: "missing_session_token" });
    return NextResponse.json(
      { ok: false, error: { code: "INVALID_SESSION", message: "Sesión inválida." } },
      { status: 400 },
    );
  }

  const result = await getReservationStatus({ sessionToken });
  log.info("api.me.read", {
    ok: result.ok,
    error_code: result.ok ? undefined : result.error.code,
  });

  if (!result.ok) {
    const status = result.error.code === "INVALID_SESSION" ? 401 : 404;
    return NextResponse.json(result, { status });
  }

  // Defense-in-depth: project only safe columns (D-10).
  // Service already projects safely; this re-projection enforces the contract
  // against future service changes.
  // INTENTIONAL omissions: name, email, phone — NEVER on this endpoint.
  return NextResponse.json({
    ok: true,
    data: {
      reservation_id: result.data.reservation_id,
      status: result.data.status,
      position: result.data.position,
      eta_min: result.data.eta_min,
      extension_count: result.data.extension_count,
      no_show_deadline: result.data.no_show_deadline,
      called_at: result.data.called_at,
    },
  });
}
