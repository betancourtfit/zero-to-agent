// Diner-facing service layer (D-18). Every mutation funnels through here:
// MCP tools, the future /api/chat route, and any future WhatsApp adapter
// are 5–15 line wrappers around these functions (ARCHITECTURE Pattern 1).
//
// Discipline:
//   - Postgres via lib/db/neon.ts HTTP client (D-19) — never lib/db/pool.ts
//   - KV publish via lib/realtime.ts helpers (D-20) — never redis.publish directly
//   - Logging via lib/log.ts (D-21) — never raw console.*
//   - Zod via .passthrough() + safeParse + .coerce.number() (D-05)
//   - DB-backed safety net (D-10): INSERT reservation_events BEFORE resumeHook
//   - Hook resume in-process (D-37): import resumeHook from "workflow/api"

import { start } from "workflow/api";

import { safeResumeHook } from "@/lib/workflows/safe-resume";
import { z } from "zod";

import { sql } from "@/lib/db/neon";
import { getTypedConfig } from "@/lib/edge-config";
import { log } from "@/lib/log";
import {
  publishQueueEvent,
  publishReservationEvent,
} from "@/lib/realtime";
import { reservationWorkflow } from "@/lib/workflows/reservation";

// Structured error contract (D-04). The MCP tool layer JSON.stringify's this
// into the text content returned to the LLM. Phase 3 system prompt rule:
// "Si un tool devuelve ok:false, explicale al comensal el error.message en
// español y NO reintentes el tool."
export type ServiceResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: ServiceError };

export interface ServiceError {
  code: ServiceErrorCode;
  message: string;
  fields?: Record<string, string>;
}

export type ServiceErrorCode =
  | "INVALID_INPUT"
  | "INVALID_SESSION"
  | "RESERVATION_NOT_FOUND"
  | "RESERVATION_ALREADY_CLOSED"
  | "NOT_IN_CALLED_STATE"
  | "NOT_IN_WAITING_OR_CALLED_STATE"
  | "NOT_IN_NO_SHOW_STATE"
  | "MAX_EXTENSIONS_REACHED"
  | "INTERNAL_ERROR";

// D-02: create_reservation is the ONLY tool whose LLM-visible inputSchema
// accepts diner identity fields. .passthrough() lets the LLM fabricate extra
// fields (notes, allergens, etc.) without rejection — they are silently ignored.
const CreateReservationInput = z
  .object({
    name: z.string().min(1),
    email: z.string().email(),
    phone: z.string().min(5),
    party_size: z.coerce.number().int().min(1).max(20),
  })
  .passthrough();

export type CreateReservationInput = z.input<typeof CreateReservationInput>;

interface ReservationRow {
  id: string;
  session_token: string;
  name: string;
  email: string;
  phone: string;
  party_size: number;
  status: string;
  workflow_run_id: string | null;
  active_hook_token: string | null;
  eta_min: number | null;
  extension_count: number;
  no_show_deadline: string | null;
  called_at: string | null;
  ended_at: string | null;
  created_at: string;
  updated_at: string;
}

interface CreateReservationData {
  reservation_id: string;
  session_token: string;
  position: number;
  eta_min: number;
}

interface ReservationStatusData {
  reservation_id: string;
  status: string;
  position: number;
  eta_min: number | null;
  extension_count: number;
  no_show_deadline: string | null;
  called_at: string | null;
}

// Compute current position in the active queue (1-based) ordered by created_at.
async function computePosition(reservationId: string): Promise<number> {
  const rows = (await sql`
    SELECT id
    FROM reservations
    WHERE status NOT IN ('seated', 'no_show', 'cancelled', 'failed_to_start')
    ORDER BY created_at ASC
  `) as Array<{ id: string }>;
  const idx = rows.findIndex((r) => r.id === reservationId);
  return idx === -1 ? 0 : idx + 1;
}

// Deterministic ETA estimate (D-13 fallback). Phase 3 may wrap the same logic
// in @workflow/ai/agent inside a "use step" — step BODY changes are safe per
// freeze rule (D-11). Avg turnover sampled fresh from Edge Config; this is
// NOT the no_show_deadline (which is sample-once-and-store per D-13).
async function estimateEtaMin(position: number): Promise<number> {
  const avgTurnoverMin = await getTypedConfig<number>(
    "no_show_timeout_min",
    15,
  );
  return Math.max(0, position * avgTurnoverMin);
}

export async function createReservation(
  rawInput: unknown,
): Promise<ServiceResult<CreateReservationData>> {
  const parsed = CreateReservationInput.safeParse(rawInput);
  if (!parsed.success) {
    const fields: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const path = issue.path.join(".") || "_";
      fields[path] = issue.message;
    }
    log.warn("reservation.create.invalid_input", { fields });
    return {
      ok: false,
      error: {
        code: "INVALID_INPUT",
        message: "Algunos datos son inválidos. Revisalos e intentá de nuevo.",
        fields,
      },
    };
  }

  const { name, email, phone, party_size } = parsed.data;

  log.info("reservation.create.start", { party_size });

  // INSERT row first; session_token defaults to gen_random_uuid() at the DB
  // level via session_token UUID NOT NULL UNIQUE — but the column has no
  // default in 0001_init.sql, so we generate explicitly. Doing this at DB
  // call time keeps it out of any future workflow router-level body.
  const inserted = (await sql`
    INSERT INTO reservations (
      session_token,
      name,
      email,
      phone,
      party_size,
      status,
      active_hook_token
    )
    VALUES (
      gen_random_uuid(),
      ${name},
      ${email},
      ${phone},
      ${party_size},
      'waiting',
      NULL
    )
    RETURNING id, session_token
  `) as Array<{ id: string; session_token: string }>;

  if (inserted.length === 0) {
    log.error("reservation.create.insert_failed");
    return {
      ok: false,
      error: {
        code: "INTERNAL_ERROR",
        message: "No pudimos guardar tu reserva. Intentá de nuevo.",
      },
    };
  }

  const { id: reservationId, session_token: sessionToken } = inserted[0];

  // D-14 compensating action: workflow.start failure leaves the row marked
  // failed_to_start for forensic audit; row is NOT deleted. Active-queue
  // queries filter status NOT IN ('failed_to_start','seated','no_show','cancelled').
  // Wired in plan 02-04 alongside lib/workflows/reservation.ts.
  try {
    const run = await start(reservationWorkflow, [{ reservationId }]);
    await sql`
      UPDATE reservations
      SET workflow_run_id = ${run.runId},
          active_hook_token = ${`reservation:${reservationId}:waiting`},
          updated_at = NOW()
      WHERE id = ${reservationId}
    `;
    log.info("reservation.create.workflow_started", {
      reservation_id: reservationId,
      run_id: run.runId,
    });
  } catch (err) {
    await sql`
      UPDATE reservations
      SET status = 'failed_to_start',
          updated_at = NOW()
      WHERE id = ${reservationId}
    `;
    log.error("reservation.create.workflow_start_failed", err, {
      reservation_id: reservationId,
    });
    return {
      ok: false,
      error: {
        code: "INTERNAL_ERROR",
        message: "No pudimos iniciar tu reserva. Intentá de nuevo.",
      },
    };
  }

  const position = await computePosition(reservationId);
  const etaMin = await estimateEtaMin(position);

  await sql`
    UPDATE reservations SET eta_min = ${etaMin} WHERE id = ${reservationId}
  `;

  const occurredAt = new Date().toISOString();

  // KV fan-out. Per Pitfall #6, Postgres is the source of truth — these
  // events are real-time hints for SSE subscribers.
  await publishReservationEvent(reservationId, {
    type: "reservation.created",
    reservation_id: reservationId,
    occurred_at: occurredAt,
    status: "waiting",
    position,
    eta_min: etaMin,
  });
  await publishQueueEvent({
    type: "reservation.created",
    reservation_id: reservationId,
    occurred_at: occurredAt,
    status: "waiting",
    party_size,
    position,
    eta_min: etaMin,
  });

  log.info("reservation.create.ok", {
    reservation_id: reservationId,
    party_size,
    position,
    eta_min: etaMin,
  });

  return {
    ok: true,
    data: {
      reservation_id: reservationId,
      session_token: sessionToken,
      position,
      eta_min: etaMin,
    },
  };
}

// D-03: tools that act on an EXISTING reservation accept ZERO LLM-visible
// identity parameters. The MCP route resolves session_token from request
// headers and passes it to these service functions server-side.
const SessionScopedInput = z
  .object({
    sessionToken: z.string().uuid(),
  })
  .passthrough();

async function loadReservationBySession(
  sessionToken: string,
): Promise<ReservationRow | null> {
  const rows = (await sql`
    SELECT
      id, session_token, name, email, phone, party_size, status,
      workflow_run_id, active_hook_token, eta_min, extension_count,
      no_show_deadline::text AS no_show_deadline,
      called_at::text AS called_at,
      ended_at::text AS ended_at,
      created_at::text AS created_at,
      updated_at::text AS updated_at
    FROM reservations
    WHERE session_token = ${sessionToken}
    LIMIT 1
  `) as ReservationRow[];
  return rows[0] ?? null;
}

export async function getReservationStatus(
  rawInput: unknown,
): Promise<ServiceResult<ReservationStatusData>> {
  const parsed = SessionScopedInput.safeParse(rawInput);
  if (!parsed.success) {
    return {
      ok: false,
      error: {
        code: "INVALID_SESSION",
        message: "No pudimos verificar tu sesión. Volvé a empezar.",
      },
    };
  }

  const row = await loadReservationBySession(parsed.data.sessionToken);
  if (!row) {
    log.warn("reservation.status.not_found");
    return {
      ok: false,
      error: {
        code: "RESERVATION_NOT_FOUND",
        message: "No encontramos tu reserva.",
      },
    };
  }

  const position = await computePosition(row.id);

  log.info("reservation.status.ok", {
    reservation_id: row.id,
    status: row.status,
    position,
  });

  return {
    ok: true,
    data: {
      reservation_id: row.id,
      status: row.status,
      position,
      eta_min: row.eta_min,
      extension_count: row.extension_count,
      no_show_deadline: row.no_show_deadline,
      called_at: row.called_at,
    },
  };
}

interface ExtendWaitData {
  reservation_id: string;
  new_deadline: string;
  extension_count: number;
}

export async function extendWait(
  rawInput: unknown,
): Promise<ServiceResult<ExtendWaitData>> {
  const parsed = SessionScopedInput.safeParse(rawInput);
  if (!parsed.success) {
    return {
      ok: false,
      error: {
        code: "INVALID_SESSION",
        message: "No pudimos verificar tu sesión. Volvé a empezar.",
      },
    };
  }

  const row = await loadReservationBySession(parsed.data.sessionToken);
  if (!row) {
    return {
      ok: false,
      error: {
        code: "RESERVATION_NOT_FOUND",
        message: "No encontramos tu reserva.",
      },
    };
  }

  if (row.status !== "called") {
    return {
      ok: false,
      error: {
        code: "NOT_IN_CALLED_STATE",
        message:
          "Solo podés pedir una extensión después de que el maître te llame.",
      },
    };
  }

  const maxExtensions = await getTypedConfig<number>(
    "max_extensions_per_ticket",
    1,
  );
  if (row.extension_count >= maxExtensions) {
    return {
      ok: false,
      error: {
        code: "MAX_EXTENSIONS_REACHED",
        message:
          "Ya pediste todas las extensiones disponibles. Si necesitás más tiempo, hablá con el maître al llegar.",
      },
    };
  }

  const extensionMin = await getTypedConfig<number>("extension_min", 5);

  // Compute new deadline server-side. We GREATEST() against now() to handle
  // the edge case where no_show_deadline is null or already in the past.
  const updated = (await sql`
    UPDATE reservations
    SET extension_count = extension_count + 1,
        no_show_deadline = GREATEST(
          COALESCE(no_show_deadline, NOW()),
          NOW()
        ) + (${extensionMin} || ' minutes')::interval,
        updated_at = NOW()
    WHERE id = ${row.id}
    RETURNING extension_count, no_show_deadline::text AS no_show_deadline
  `) as Array<{ extension_count: number; no_show_deadline: string }>;

  const { extension_count, no_show_deadline } = updated[0];
  const occurredAt = new Date().toISOString();

  // D-10 DB-backed safety net: INSERT reservation_events BEFORE resumeHook.
  // Workflow timeout branches re-query this table on resume to recover
  // missed events.
  const insertedEvent = (await sql`
    INSERT INTO reservation_events (reservation_id, event_type, payload)
    VALUES (
      ${row.id},
      'extend_requested',
      ${JSON.stringify({ new_deadline: no_show_deadline, extension_count, occurred_at: occurredAt })}::jsonb
    )
    RETURNING id
  `) as Array<{ id: number }>;

  if (row.active_hook_token) {
    await safeResumeHook(
      row.active_hook_token,
      { type: "extend", new_deadline: no_show_deadline, extension_count },
      { reservation_id: row.id, intent: "extend" },
    );
  } else {
    log.warn("reservation.extend.no_active_hook", {
      reservation_id: row.id,
    });
  }

  await publishReservationEvent(row.id, {
    id: insertedEvent[0].id,
    type: "reservation.extended",
    reservation_id: row.id,
    occurred_at: occurredAt,
    no_show_deadline,
    extension_count,
  });
  await publishQueueEvent({
    type: "reservation.extended",
    reservation_id: row.id,
    occurred_at: occurredAt,
    no_show_deadline,
    extension_count,
  });

  log.info("reservation.extend.ok", {
    reservation_id: row.id,
    extension_count,
  });

  return {
    ok: true,
    data: {
      reservation_id: row.id,
      new_deadline: no_show_deadline,
      extension_count,
    },
  };
}

interface CancelReservationData {
  reservation_id: string;
}

export async function cancelReservation(
  rawInput: unknown,
): Promise<ServiceResult<CancelReservationData>> {
  const parsed = SessionScopedInput.safeParse(rawInput);
  if (!parsed.success) {
    return {
      ok: false,
      error: {
        code: "INVALID_SESSION",
        message: "No pudimos verificar tu sesión. Volvé a empezar.",
      },
    };
  }

  const row = await loadReservationBySession(parsed.data.sessionToken);
  if (!row) {
    return {
      ok: false,
      error: {
        code: "RESERVATION_NOT_FOUND",
        message: "No encontramos tu reserva.",
      },
    };
  }

  if (row.status !== "waiting" && row.status !== "called") {
    return {
      ok: false,
      error: {
        code: "NOT_IN_WAITING_OR_CALLED_STATE",
        message: "Esta reserva ya no se puede cancelar.",
      },
    };
  }

  await sql`
    UPDATE reservations
    SET status = 'cancelled',
        ended_at = NOW(),
        updated_at = NOW()
    WHERE id = ${row.id}
  `;

  const occurredAt = new Date().toISOString();

  const insertedEvent = (await sql`
    INSERT INTO reservation_events (reservation_id, event_type, payload)
    VALUES (
      ${row.id},
      'cancel_requested',
      ${JSON.stringify({ occurred_at: occurredAt, prev_status: row.status })}::jsonb
    )
    RETURNING id
  `) as Array<{ id: number }>;

  if (row.active_hook_token) {
    await safeResumeHook(
      row.active_hook_token,
      { type: "cancel" },
      { reservation_id: row.id, intent: "cancel" },
    );
  } else {
    log.warn("reservation.cancel.no_active_hook", {
      reservation_id: row.id,
    });
  }

  await publishReservationEvent(row.id, {
    id: insertedEvent[0].id,
    type: "reservation.cancelled",
    reservation_id: row.id,
    occurred_at: occurredAt,
    status: "cancelled",
  });
  await publishQueueEvent({
    type: "reservation.cancelled",
    reservation_id: row.id,
    occurred_at: occurredAt,
    status: "cancelled",
  });

  log.info("reservation.cancel.ok", { reservation_id: row.id });

  return {
    ok: true,
    data: { reservation_id: row.id },
  };
}
