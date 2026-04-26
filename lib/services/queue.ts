// Staff-facing service layer (D-18). The Phase 3 maître panel reads
// getActiveQueue() for its queue cards; the Phase 02-07 staff action API
// endpoints (POST /api/queue/[id]/{call,seated,no_show_manual}) call
// markCalled / markSeated / markNoShowManual.
//
// Discipline mirrors lib/services/reservations.ts:
//   - Postgres via lib/db/neon.ts HTTP client (D-19)
//   - KV publish via lib/realtime.ts helpers (D-20)
//   - Logging via lib/log.ts (D-21) — never raw console.*
//   - DB-backed safety net (D-10): INSERT reservation_events BEFORE resumeHook
//   - Hook resume in-process (D-37): import resumeHook from "workflow/api"

import { sql } from "@/lib/db/neon";
import { log } from "@/lib/log";
import {
  publishQueueEvent,
  publishReservationEvent,
} from "@/lib/realtime";
import { safeResumeHook } from "@/lib/workflows/safe-resume";

import type { ServiceResult } from "@/lib/services/reservations";

export interface ActiveQueueItem {
  reservation_id: string;
  status: string;
  name: string;
  party_size: number;
  position: number;
  eta_min: number | null;
  extension_count: number;
  no_show_deadline: string | null;
  called_at: string | null;
  created_at: string;
}

interface ActiveQueueRow {
  id: string;
  status: string;
  name: string;
  party_size: number;
  eta_min: number | null;
  extension_count: number;
  no_show_deadline: string | null;
  called_at: string | null;
  created_at: string;
}

// Active queue feeds the Phase 3 staff panel AND the Phase 2 staff action
// API endpoints (so they can verify a reservation is still in scope before
// resuming a hook). status filter mirrors D-14 compensating-action contract:
// failed_to_start rows are forensic, not active.
export async function getActiveQueue(): Promise<ActiveQueueItem[]> {
  const rows = (await sql`
    SELECT
      id, status, name, party_size, eta_min, extension_count,
      no_show_deadline::text AS no_show_deadline,
      called_at::text AS called_at,
      created_at::text AS created_at
    FROM reservations
    WHERE status NOT IN ('seated', 'no_show', 'cancelled', 'failed_to_start')
    ORDER BY created_at ASC
  `) as ActiveQueueRow[];

  log.info("queue.active.read", { count: rows.length });

  return rows.map((row, idx) => ({
    reservation_id: row.id,
    status: row.status,
    name: row.name,
    party_size: row.party_size,
    position: idx + 1,
    eta_min: row.eta_min,
    extension_count: row.extension_count,
    no_show_deadline: row.no_show_deadline,
    called_at: row.called_at,
    created_at: row.created_at,
  }));
}

interface ReservationLookupRow {
  id: string;
  status: string;
  active_hook_token: string | null;
}

async function loadReservation(
  reservationId: string,
): Promise<ReservationLookupRow | null> {
  const rows = (await sql`
    SELECT id, status, active_hook_token
    FROM reservations
    WHERE id = ${reservationId}
    LIMIT 1
  `) as ReservationLookupRow[];
  return rows[0] ?? null;
}

interface QueueMutationData {
  reservation_id: string;
  new_status: string;
}

// Advances waiting → called. The token resumed here is the :waiting token
// (D-08); the workflow then writes :called:pre into reservations.active_hook_token
// before parking on the followup window. Phase 02-04 owns that workflow body.
export async function markCalled(
  reservationId: string,
): Promise<ServiceResult<QueueMutationData>> {
  const row = await loadReservation(reservationId);
  if (!row) {
    log.warn("queue.call.not_found", { reservation_id: reservationId });
    return {
      ok: false,
      error: {
        code: "RESERVATION_NOT_FOUND",
        message: "No encontramos esa reserva.",
      },
    };
  }

  if (row.status !== "waiting") {
    log.warn("queue.call.bad_state", {
      reservation_id: reservationId,
      status: row.status,
    });
    return {
      ok: false,
      error: {
        code: "RESERVATION_ALREADY_CLOSED",
        message: "Esta reserva ya no está esperando.",
      },
    };
  }

  // We capture the token to resume BEFORE the UPDATE, then let the workflow
  // overwrite active_hook_token to the next phase token (:called:pre) inside
  // its own step. If active_hook_token is null (e.g., the 02-03/02-04 gap),
  // we still update DB state and publish — but skip resumeHook with a warn.
  const tokenToResume = row.active_hook_token;

  await sql`
    UPDATE reservations
    SET status = 'called',
        called_at = NOW(),
        updated_at = NOW()
    WHERE id = ${reservationId}
  `;

  const occurredAt = new Date().toISOString();

  // D-10 DB-backed safety net: persist event BEFORE resumeHook.
  const insertedEvent = (await sql`
    INSERT INTO reservation_events (reservation_id, event_type, payload)
    VALUES (
      ${reservationId},
      'call_requested',
      ${JSON.stringify({ occurred_at: occurredAt })}::jsonb
    )
    RETURNING id
  `) as Array<{ id: number }>;

  if (tokenToResume) {
    await safeResumeHook(
      tokenToResume,
      { type: "call" },
      { reservation_id: reservationId, intent: "call" },
    );
  } else {
    log.warn("queue.call.no_active_hook", { reservation_id: reservationId });
  }

  await publishReservationEvent(reservationId, {
    id: insertedEvent[0].id,
    type: "reservation.called",
    reservation_id: reservationId,
    occurred_at: occurredAt,
    status: "called",
    called_at: occurredAt,
  });
  await publishQueueEvent({
    type: "reservation.called",
    reservation_id: reservationId,
    occurred_at: occurredAt,
    status: "called",
  });

  log.info("queue.call.ok", { reservation_id: reservationId });

  return {
    ok: true,
    data: { reservation_id: reservationId, new_status: "called" },
  };
}

// Closes called → seated. Terminal transition: ended_at is set, no further
// transitions valid.
export async function markSeated(
  reservationId: string,
): Promise<ServiceResult<QueueMutationData>> {
  const row = await loadReservation(reservationId);
  if (!row) {
    log.warn("queue.seated.not_found", { reservation_id: reservationId });
    return {
      ok: false,
      error: {
        code: "RESERVATION_NOT_FOUND",
        message: "No encontramos esa reserva.",
      },
    };
  }

  if (row.status !== "called") {
    log.warn("queue.seated.bad_state", {
      reservation_id: reservationId,
      status: row.status,
    });
    return {
      ok: false,
      error: {
        code: "NOT_IN_CALLED_STATE",
        message: "Solo podés marcar como sentado a quien ya fue llamado.",
      },
    };
  }

  const tokenToResume = row.active_hook_token;

  await sql`
    UPDATE reservations
    SET status = 'seated',
        ended_at = NOW(),
        updated_at = NOW()
    WHERE id = ${reservationId}
  `;

  const occurredAt = new Date().toISOString();

  const insertedEvent = (await sql`
    INSERT INTO reservation_events (reservation_id, event_type, payload)
    VALUES (
      ${reservationId},
      'seated_requested',
      ${JSON.stringify({ occurred_at: occurredAt })}::jsonb
    )
    RETURNING id
  `) as Array<{ id: number }>;

  if (tokenToResume) {
    await safeResumeHook(
      tokenToResume,
      { type: "seated" },
      { reservation_id: reservationId, intent: "seated" },
    );
  } else {
    log.warn("queue.seated.no_active_hook", { reservation_id: reservationId });
  }

  await publishReservationEvent(reservationId, {
    id: insertedEvent[0].id,
    type: "reservation.seated",
    reservation_id: reservationId,
    occurred_at: occurredAt,
    status: "seated",
    ended_at: occurredAt,
  });
  await publishQueueEvent({
    type: "reservation.seated",
    reservation_id: reservationId,
    occurred_at: occurredAt,
    status: "seated",
  });

  log.info("queue.seated.ok", { reservation_id: reservationId });

  return {
    ok: true,
    data: { reservation_id: reservationId, new_status: "seated" },
  };
}

// Manual no-show override (D-30). Lets staff close a reservation as no_show
// without waiting for the workflow's no_show_deadline timer to fire. STAFF-09
// undo-no-show lives in Phase 3 with the panel; here we just expose the
// transition. Allowed from waiting OR called — the workflow timer can also
// trigger this transition autonomously.
export async function markNoShowManual(
  reservationId: string,
): Promise<ServiceResult<QueueMutationData>> {
  const row = await loadReservation(reservationId);
  if (!row) {
    log.warn("queue.no_show.not_found", { reservation_id: reservationId });
    return {
      ok: false,
      error: {
        code: "RESERVATION_NOT_FOUND",
        message: "No encontramos esa reserva.",
      },
    };
  }

  if (row.status !== "waiting" && row.status !== "called") {
    log.warn("queue.no_show.bad_state", {
      reservation_id: reservationId,
      status: row.status,
    });
    return {
      ok: false,
      error: {
        code: "NOT_IN_WAITING_OR_CALLED_STATE",
        message: "Esta reserva ya no se puede marcar como no-show.",
      },
    };
  }

  const tokenToResume = row.active_hook_token;

  await sql`
    UPDATE reservations
    SET status = 'no_show',
        ended_at = NOW(),
        updated_at = NOW()
    WHERE id = ${reservationId}
  `;

  const occurredAt = new Date().toISOString();

  const insertedEvent = (await sql`
    INSERT INTO reservation_events (reservation_id, event_type, payload)
    VALUES (
      ${reservationId},
      'no_show_requested',
      ${JSON.stringify({ occurred_at: occurredAt, source: "manual" })}::jsonb
    )
    RETURNING id
  `) as Array<{ id: number }>;

  if (tokenToResume) {
    await safeResumeHook(
      tokenToResume,
      { type: "no_show_manual" },
      { reservation_id: reservationId, intent: "no_show_manual" },
    );
  } else {
    log.warn("queue.no_show.no_active_hook", {
      reservation_id: reservationId,
    });
  }

  await publishReservationEvent(reservationId, {
    id: insertedEvent[0].id,
    type: "reservation.no_show",
    reservation_id: reservationId,
    occurred_at: occurredAt,
    status: "no_show",
    source: "manual",
  });
  await publishQueueEvent({
    type: "reservation.no_show",
    reservation_id: reservationId,
    occurred_at: occurredAt,
    status: "no_show",
    source: "manual",
  });

  log.info("queue.no_show.ok", { reservation_id: reservationId });

  return {
    ok: true,
    data: { reservation_id: reservationId, new_status: "no_show" },
  };
}
