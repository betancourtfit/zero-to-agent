// scripts/seed-demo.ts
//
// Creates 3 reservations in distinct states for dev/demo use.
// Idempotent: deletes existing demo rows first, then re-creates.
// Uses REAL service layer — workflows are LIVE every dev session (D-32).
//
// Reservation A → waiting   (just created)
// Reservation B → called    (advanced via markCalled)
// Reservation C → seated    (advanced via markCalled then markSeated)
//
// This is the DEFAULT DEV FIXTURE (Pitfall #20). Re-runnable safely.
// Invoked via `npm run seed:demo` or `npm run dev:reset`.

import { sql } from "@/lib/db/neon";
import { log } from "@/lib/log";
import {
  markCalled,
  markSeated,
} from "@/lib/services/queue";
import { createReservation } from "@/lib/services/reservations";

interface CreateOk {
  reservation_id: string;
  session_token: string;
  position: number;
  eta_min: number;
}

// Narrow ServiceResult-or-throw helper. The service-layer functions return
// {ok:false, error} on failure rather than throw, so we surface the error
// code as a fatal exit so the seed script doesn't silently produce a
// half-populated DB.
function unwrapOrThrow<T>(
  label: string,
  result: { ok: true; data: T } | { ok: false; error: { code: string; message: string } },
): T {
  if (!result.ok) {
    throw new Error(
      `[seed-demo] ${label} failed: ${result.error.code} — ${result.error.message}`,
    );
  }
  return result.data;
}

async function clearDemoRows(): Promise<{ reservations: number; events: number }> {
  // Order matters: delete events first (FK constraint via reservation_id).
  // Both filter on the demo email pattern — there is no client-side state
  // here, so a re-run is identical to a first run.
  const eventsDeleted = (await sql`
    DELETE FROM reservation_events
    WHERE reservation_id IN (
      SELECT id FROM reservations WHERE email LIKE 'demo%@example.test'
    )
    RETURNING id
  `) as Array<{ id: number }>;

  const reservationsDeleted = (await sql`
    DELETE FROM reservations
    WHERE email LIKE 'demo%@example.test'
    RETURNING id
  `) as Array<{ id: string }>;

  return {
    reservations: reservationsDeleted.length,
    events: eventsDeleted.length,
  };
}

async function main(): Promise<void> {
  console.log("[seed-demo] Clearing existing demo rows…");
  const cleared = await clearDemoRows();
  console.log(
    `[seed-demo] Cleared ${cleared.reservations} reservation(s) and ${cleared.events} event(s).`,
  );

  // ─── Reservation A: fresh waiting ───────────────────────────────────
  console.log("[seed-demo] Creating Reservation A (waiting)…");
  const a = unwrapOrThrow<CreateOk>(
    "Reservation A create",
    await createReservation({
      name: "Demo Comensal 1",
      email: "demo1@example.test",
      phone: "+540000000001",
      party_size: 2,
    }),
  );
  log.info("seed-demo.created", {
    label: "A",
    reservation_id: a.reservation_id,
    target_status: "waiting",
  });

  // ─── Reservation B: advance to called ───────────────────────────────
  console.log("[seed-demo] Creating Reservation B (will advance to called)…");
  const b = unwrapOrThrow<CreateOk>(
    "Reservation B create",
    await createReservation({
      name: "Demo Comensal 2",
      email: "demo2@example.test",
      phone: "+540000000002",
      party_size: 4,
    }),
  );

  console.log("[seed-demo] Advancing Reservation B → called…");
  unwrapOrThrow(
    "Reservation B markCalled",
    await markCalled(b.reservation_id),
  );
  log.info("seed-demo.advanced", {
    label: "B",
    reservation_id: b.reservation_id,
    target_status: "called",
  });

  // ─── Reservation C: advance to seated ───────────────────────────────
  console.log("[seed-demo] Creating Reservation C (will advance to seated)…");
  const c = unwrapOrThrow<CreateOk>(
    "Reservation C create",
    await createReservation({
      name: "Demo Comensal 3",
      email: "demo3@example.test",
      phone: "+540000000003",
      party_size: 6,
    }),
  );

  console.log("[seed-demo] Advancing Reservation C → called…");
  unwrapOrThrow(
    "Reservation C markCalled",
    await markCalled(c.reservation_id),
  );

  console.log("[seed-demo] Advancing Reservation C → seated…");
  unwrapOrThrow(
    "Reservation C markSeated",
    await markSeated(c.reservation_id),
  );
  log.info("seed-demo.advanced", {
    label: "C",
    reservation_id: c.reservation_id,
    target_status: "seated",
  });

  // ─── Summary ────────────────────────────────────────────────────────
  console.log("");
  console.log("[seed-demo] Done. 3 reservations created:");
  console.log(`  A: waiting  id=${a.reservation_id} session_token=${a.session_token}`);
  console.log(`  B: called   id=${b.reservation_id} session_token=${b.session_token}`);
  console.log(`  C: seated   id=${c.reservation_id} session_token=${c.session_token}`);
  console.log("");
  console.log("[seed-demo] Tip: copy a session_token into the chatbot localStorage");
  console.log("[seed-demo]      to resume that reservation's session in the UI.");
}

main().catch((err) => {
  log.error("seed-demo.error", err);
  console.error("[seed-demo] FAILED:", err instanceof Error ? err.message : err);
  process.exit(1);
});
