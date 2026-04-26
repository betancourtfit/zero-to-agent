// lib/workflows/reservation.ts
// 'use workflow' — single-file FROZEN reservation lifecycle (D-11, Pitfall #4).
// Only step BODIES may change after Phase 2. Never step count or order.
//
// State machine: waiting → called → seated | no_show | cancelled
//                       (extend branch loops back inside :called:final)
//
// Hook tokens (D-08):
//   reservation:<id>:waiting       — initial parking; staff `markCalled` resumes
//   reservation:<id>:called:pre    — 1-min followup window after call
//   reservation:<id>:called:final  — post-followup; extend/cancel/seated land here before no_show_deadline
//
// Discipline (see lib/workflows/_README.md "The Router Rule"):
//   - Router body: only control flow (if / for / await / Promise.race)
//   - Every IO/time/random/Edge-Config call lives inside a "use step" async function
//   - Every step input/output is plain JSON (ISO strings for dates)
//   - DB-backed safety net (D-10): timeout branches re-query reservation_events for missed events
//   - Edge Config sampled INSIDE steps; no_show_deadline computed ONCE at called transition (D-13)

import { defineHook, sleep } from "workflow";

import { sql } from "@/lib/db/neon";
import { getTypedConfig } from "@/lib/edge-config";
import { log } from "@/lib/log";
import {
  publishQueueEvent,
  publishReservationEvent,
} from "@/lib/realtime";

// ============================================================================
// TYPED HOOKS (module top — D-08)
// ============================================================================
//
// `defineHook<TInput>()` gives us a TypedHook with .create({token}) for the
// workflow side and .resume(token, payload) for the service-layer side.
// We re-export the typed hooks so service code (lib/services/reservations.ts,
// lib/services/queue.ts) can resume them with type safety. Today the service
// layer uses the lower-level `resumeHook(tokenString, payload)` from
// "workflow/api"; the typed re-exports are forward-compat for Phase 3+.

export const callHook = defineHook<{ type: "call" }>();
export const extendHook = defineHook<{
  type: "extend";
  new_deadline: string;
  extension_count: number;
}>();
export const cancelHook = defineHook<{ type: "cancel" }>();
export const seatedHook = defineHook<{ type: "seated" }>();
export const noShowManualHook = defineHook<{ type: "no_show_manual" }>();

// ============================================================================
// STEP FUNCTIONS (all "use step")
// ============================================================================
//
// Inputs and outputs are plain JSON. TIMESTAMPTZ values are returned as ISO
// strings. No Date, Map, Set, Buffer, or class instances cross step boundaries.

interface ReservationSnapshot {
  id: string;
  status: string;
  party_size: number;
  extension_count: number;
  no_show_deadline: string | null;
  called_at: string | null;
  ended_at: string | null;
  active_hook_token: string | null;
  last_seen_event_id: number | null;
}

async function loadReservationSnapshot(
  reservationId: string,
): Promise<ReservationSnapshot | null> {
  "use step";
  const rows = (await sql`
    SELECT
      id,
      status,
      party_size,
      extension_count,
      no_show_deadline::text AS no_show_deadline,
      called_at::text AS called_at,
      ended_at::text AS ended_at,
      active_hook_token
    FROM reservations
    WHERE id = ${reservationId}
    LIMIT 1
  `) as Array<{
    id: string;
    status: string;
    party_size: number;
    extension_count: number;
    no_show_deadline: string | null;
    called_at: string | null;
    ended_at: string | null;
    active_hook_token: string | null;
  }>;
  if (!rows[0]) return null;
  const row = rows[0];
  return {
    id: row.id,
    status: row.status,
    party_size: row.party_size,
    extension_count: row.extension_count,
    no_show_deadline: row.no_show_deadline,
    called_at: row.called_at,
    ended_at: row.ended_at,
    active_hook_token: row.active_hook_token,
    last_seen_event_id: null,
  };
}

// Persist active_hook_token BEFORE the workflow parks on a new hook so staff
// API endpoints (which read this column to decide which token to resume) are
// always pointed at the live token. Returns the token written so the router
// can keep its local snapshot in sync.
async function setActiveHookToken(
  reservationId: string,
  token: string,
): Promise<{ token: string; written_at: string }> {
  "use step";
  await sql`
    UPDATE reservations
    SET active_hook_token = ${token},
        updated_at = NOW()
    WHERE id = ${reservationId}
  `;
  return { token, written_at: new Date().toISOString() };
}

// Edge Config snapshot — sample-once-and-store at called transition (D-13).
// Returned as plain JSON so the router can pass values through subsequent
// steps without re-reading Edge Config.
interface EdgeConfigSnapshot {
  no_show_timeout_min: number;
  followup_after_call_min: number;
  extension_min: number;
  max_extensions_per_ticket: number;
  eta_recompute_interval_sec: number;
}

async function loadEdgeConfigSnapshot(): Promise<EdgeConfigSnapshot> {
  "use step";
  const [
    no_show_timeout_min,
    followup_after_call_min,
    extension_min,
    max_extensions_per_ticket,
    eta_recompute_interval_sec,
  ] = await Promise.all([
    getTypedConfig<number>("no_show_timeout_min", 15),
    getTypedConfig<number>("followup_after_call_min", 1),
    getTypedConfig<number>("extension_min", 5),
    getTypedConfig<number>("max_extensions_per_ticket", 1),
    getTypedConfig<number>("eta_recompute_interval_sec", 60),
  ]);
  return {
    no_show_timeout_min,
    followup_after_call_min,
    extension_min,
    max_extensions_per_ticket,
    eta_recompute_interval_sec,
  };
}

// DB-backed safety net (D-10). Called from every Promise.race timeout branch
// to recover events that may have been published while the workflow was not
// parked on its hook. Returns events ordered by id (the SERIAL primary key on
// reservation_events) so the router replays them in the same order they were
// written.
interface MissedEvent {
  id: number;
  type:
    | "call_requested"
    | "extend_requested"
    | "cancel_requested"
    | "seated_requested"
    | "no_show_requested";
  payload: Record<string, unknown> | null;
  created_at: string;
}

async function fetchMissedEvents(
  reservationId: string,
  lastSeenEventId: number | null,
): Promise<MissedEvent[]> {
  "use step";
  const rows = (await sql`
    SELECT id, event_type, payload, created_at::text AS created_at
    FROM reservation_events
    WHERE reservation_id = ${reservationId}
      AND id > ${lastSeenEventId ?? 0}
      AND event_type IN (
        'call_requested',
        'extend_requested',
        'cancel_requested',
        'seated_requested',
        'no_show_requested'
      )
    ORDER BY id ASC
  `) as Array<{
    id: number;
    event_type: MissedEvent["type"];
    payload: Record<string, unknown> | null;
    created_at: string;
  }>;
  return rows.map((r) => ({
    id: r.id,
    type: r.event_type,
    payload: r.payload,
    created_at: r.created_at,
  }));
}

// Transition to called: writes status='called', called_at=now,
// no_show_deadline=now+no_show_timeout_min (sample-once per D-13).
// Publishes KV events. Returns the persisted ISO deadline so subsequent
// timeout calculations use the row-of-truth value.
interface MarkCalledResult {
  no_show_deadline: string;
  called_at: string;
  event_id: number;
}

async function applyCallTransition(
  reservationId: string,
  noShowTimeoutMin: number,
): Promise<MarkCalledResult> {
  "use step";

  const updated = (await sql`
    UPDATE reservations
    SET status = 'called',
        called_at = COALESCE(called_at, NOW()),
        no_show_deadline = COALESCE(
          no_show_deadline,
          NOW() + (${noShowTimeoutMin} || ' minutes')::interval
        ),
        updated_at = NOW()
    WHERE id = ${reservationId}
    RETURNING
      called_at::text AS called_at,
      no_show_deadline::text AS no_show_deadline
  `) as Array<{ called_at: string; no_show_deadline: string }>;

  const occurredAt = new Date().toISOString();

  // Insert audit event so SSE clients (snapshot-replay-on-connect) see the
  // workflow-driven transition. Distinct from the staff-API `call_requested`
  // event — this one records the workflow ACK.
  const inserted = (await sql`
    INSERT INTO reservation_events (reservation_id, event_type, payload)
    VALUES (
      ${reservationId},
      'workflow_called',
      ${JSON.stringify({
        occurred_at: occurredAt,
        no_show_deadline: updated[0].no_show_deadline,
        called_at: updated[0].called_at,
      })}::jsonb
    )
    RETURNING id
  `) as Array<{ id: number }>;

  await publishReservationEvent(reservationId, {
    id: inserted[0].id,
    type: "reservation.workflow_called",
    reservation_id: reservationId,
    occurred_at: occurredAt,
    status: "called",
    called_at: updated[0].called_at,
    no_show_deadline: updated[0].no_show_deadline,
  });
  await publishQueueEvent({
    type: "reservation.workflow_called",
    reservation_id: reservationId,
    occurred_at: occurredAt,
    status: "called",
  });

  log.info("workflow.transition.called", {
    reservation_id: reservationId,
    no_show_deadline: updated[0].no_show_deadline,
  });

  return {
    no_show_deadline: updated[0].no_show_deadline,
    called_at: updated[0].called_at,
    event_id: inserted[0].id,
  };
}

// Followup push at the end of the :called:pre window. Records the message in
// reservation_events and publishes to KV so chatbot/panel UIs can render it.
async function emitFollowupPush(
  reservationId: string,
  message: string,
): Promise<{ event_id: number }> {
  "use step";
  const occurredAt = new Date().toISOString();
  const inserted = (await sql`
    INSERT INTO reservation_events (reservation_id, event_type, payload)
    VALUES (
      ${reservationId},
      'workflow_followup',
      ${JSON.stringify({ occurred_at: occurredAt, message })}::jsonb
    )
    RETURNING id
  `) as Array<{ id: number }>;
  await publishReservationEvent(reservationId, {
    id: inserted[0].id,
    type: "reservation.followup",
    reservation_id: reservationId,
    occurred_at: occurredAt,
    message,
  });
  log.info("workflow.followup.sent", { reservation_id: reservationId });
  return { event_id: inserted[0].id };
}

// Apply an extend on the workflow side. The service-layer extendWait already
// updates the row + inserts reservation_events + calls resumeHook. This step
// re-reads the persisted no_show_deadline so the workflow trusts the DB row
// of truth (the service layer is the writer; the workflow is the timer).
async function reloadDeadlineAfterExtend(
  reservationId: string,
): Promise<{ no_show_deadline: string | null; extension_count: number }> {
  "use step";
  const rows = (await sql`
    SELECT
      no_show_deadline::text AS no_show_deadline,
      extension_count
    FROM reservations
    WHERE id = ${reservationId}
    LIMIT 1
  `) as Array<{ no_show_deadline: string | null; extension_count: number }>;
  return {
    no_show_deadline: rows[0]?.no_show_deadline ?? null,
    extension_count: rows[0]?.extension_count ?? 0,
  };
}

// Terminal transition: workflow-driven no_show on deadline expiry. Empathic
// message goes via KV (SAFE-03 tone). The DB row already records ended_at via
// the UPDATE; we publish for SSE consumers.
async function applyNoShowTransition(
  reservationId: string,
  source: "timeout" | "manual",
): Promise<{ event_id: number; ended_at: string }> {
  "use step";

  const updated = (await sql`
    UPDATE reservations
    SET status = 'no_show',
        ended_at = COALESCE(ended_at, NOW()),
        active_hook_token = NULL,
        updated_at = NOW()
    WHERE id = ${reservationId}
      AND status NOT IN ('seated', 'no_show', 'cancelled')
    RETURNING ended_at::text AS ended_at
  `) as Array<{ ended_at: string }>;

  const occurredAt = new Date().toISOString();
  const endedAt = updated[0]?.ended_at ?? occurredAt;

  const inserted = (await sql`
    INSERT INTO reservation_events (reservation_id, event_type, payload)
    VALUES (
      ${reservationId},
      'workflow_no_show',
      ${JSON.stringify({ occurred_at: occurredAt, source })}::jsonb
    )
    RETURNING id
  `) as Array<{ id: number }>;

  await publishReservationEvent(reservationId, {
    id: inserted[0].id,
    type: "reservation.no_show",
    reservation_id: reservationId,
    occurred_at: occurredAt,
    status: "no_show",
    source,
  });
  await publishQueueEvent({
    type: "reservation.no_show",
    reservation_id: reservationId,
    occurred_at: occurredAt,
    status: "no_show",
    source,
  });

  log.info("workflow.transition.no_show", {
    reservation_id: reservationId,
    source,
  });

  return { event_id: inserted[0].id, ended_at: endedAt };
}

// Acknowledge a terminal transition driven by the service layer
// (markSeated, cancelReservation, markNoShowManual). The service layer
// already wrote status + ended_at + reservation_events; we clear
// active_hook_token and emit a workflow ACK event so SSE clients see the
// workflow finishing.
async function acknowledgeTerminal(
  reservationId: string,
  reason: "seated" | "cancelled" | "no_show_manual",
): Promise<{ event_id: number }> {
  "use step";

  await sql`
    UPDATE reservations
    SET active_hook_token = NULL,
        updated_at = NOW()
    WHERE id = ${reservationId}
  `;

  const occurredAt = new Date().toISOString();
  const inserted = (await sql`
    INSERT INTO reservation_events (reservation_id, event_type, payload)
    VALUES (
      ${reservationId},
      'workflow_terminal',
      ${JSON.stringify({ occurred_at: occurredAt, reason })}::jsonb
    )
    RETURNING id
  `) as Array<{ id: number }>;

  log.info("workflow.terminal", {
    reservation_id: reservationId,
    reason,
  });

  return { event_id: inserted[0].id };
}

// Compute the remaining seconds until no_show_deadline. Done as a step (not
// in the router) because Date.now() is router-forbidden (Pitfall #1, D-16).
// Returns clamped non-negative seconds; 0 means "deadline already passed."
async function computeRemainingSeconds(
  isoDeadline: string,
): Promise<{ seconds: number }> {
  "use step";
  const deadlineMs = Date.parse(isoDeadline);
  const remainingMs = deadlineMs - Date.now();
  const seconds = remainingMs > 0 ? Math.ceil(remainingMs / 1000) : 0;
  return { seconds };
}

// ============================================================================
// HELPER: race outcome discrimination
// ============================================================================
//
// Each Promise.race arm resolves to one of these. Sentinel objects (not
// strings) so the discriminator is robust to any future hook payload that
// happens to include a `kind` field of its own.

type RaceResult<TEvent> =
  | { kind: "event"; event: TEvent }
  | { kind: "timeout" };

// ============================================================================
// MAIN WORKFLOW (router body — only control flow)
// ============================================================================

export interface ReservationWorkflowInput {
  reservationId: string;
}

export async function reservationWorkflow(
  input: ReservationWorkflowInput,
): Promise<{ reservation_id: string; final_status: string }> {
  "use workflow";

  const { reservationId } = input;

  // ---- PHASE 1: WAITING ----
  // Park on :waiting; advance on `call` event; periodically resync via
  // missed-event safety net. Cancel terminates immediately.
  const initial = await loadReservationSnapshot(reservationId);
  if (!initial) {
    // Reservation was deleted between createReservation and workflow start.
    // Nothing to do.
    return { reservation_id: reservationId, final_status: "missing" };
  }

  let lastSeenEventId: number | null = initial.last_seen_event_id;
  const currentStatus: string = initial.status;

  if (currentStatus === "waiting") {
    await setActiveHookToken(
      reservationId,
      `reservation:${reservationId}:waiting`,
    );

    // Sample Edge Config ONCE at the start of waiting so the
    // recompute-interval is stable for the lifetime of this run. The
    // no_show_timeout_min is re-sampled at the called transition (D-13).
    const cfg = await loadEdgeConfigSnapshot();

    let advancedToCalled = false;
    while (!advancedToCalled) {
      const waitingHook = callHook.create({
        token: `reservation:${reservationId}:waiting`,
      });
      const cancelInWaitingHook = cancelHook.create({
        token: `reservation:${reservationId}:waiting:cancel`,
      });

      const winner: RaceResult<{ type: string }> = await Promise.race([
        waitingHook.then((event) => ({ kind: "event" as const, event })),
        cancelInWaitingHook.then((event) => ({
          kind: "event" as const,
          event,
        })),
        sleep(`${cfg.eta_recompute_interval_sec}s`).then(
          () => ({ kind: "timeout" as const }),
        ),
      ]);

      if (winner.kind === "event") {
        if (winner.event.type === "cancel") {
          await acknowledgeTerminal(reservationId, "cancelled");
          return { reservation_id: reservationId, final_status: "cancelled" };
        }
        // type === "call"
        advancedToCalled = true;
        break;
      }

      // Timeout branch: re-query reservation_events for missed events
      // (D-10 safety net). If a call/cancel was published while the hooks
      // were not yet parked, we recover here.
      const missed = await fetchMissedEvents(reservationId, lastSeenEventId);
      for (const event of missed) {
        lastSeenEventId = event.id;
        if (event.type === "cancel_requested") {
          await acknowledgeTerminal(reservationId, "cancelled");
          return { reservation_id: reservationId, final_status: "cancelled" };
        }
        if (event.type === "call_requested") {
          advancedToCalled = true;
          break;
        }
        // extend/seated while waiting are not valid transitions; ignore.
      }
      // Loop continues; ETA recompute is Phase 3 (DurableAgent wraps the same
      // step body per D-11 freeze rule). Phase 2 keeps the loop simple.
    }
  }

  // ---- PHASE 2: CALLED — :called:pre window (followup) ----
  // Sample no_show_timeout_min ONCE here and persist it via
  // applyCallTransition. From this point on, the workflow trusts
  // reservations.no_show_deadline as the row-of-truth (D-13).
  const calledCfg = await loadEdgeConfigSnapshot();
  const callResult = await applyCallTransition(
    reservationId,
    calledCfg.no_show_timeout_min,
  );
  let currentDeadline: string = callResult.no_show_deadline;

  await setActiveHookToken(
    reservationId,
    `reservation:${reservationId}:called:pre`,
  );

  let preWindowDone = false;
  while (!preWindowDone) {
    const preCallHook = callHook.create({
      token: `reservation:${reservationId}:called:pre`,
    });
    const preExtendHook = extendHook.create({
      token: `reservation:${reservationId}:called:pre:extend`,
    });
    const preCancelHook = cancelHook.create({
      token: `reservation:${reservationId}:called:pre:cancel`,
    });
    const preSeatedHook = seatedHook.create({
      token: `reservation:${reservationId}:called:pre:seated`,
    });
    const preNoShowHook = noShowManualHook.create({
      token: `reservation:${reservationId}:called:pre:no_show`,
    });

    const winner: RaceResult<{ type: string }> = await Promise.race([
      preCallHook.then((event) => ({ kind: "event" as const, event })),
      preExtendHook.then((event) => ({ kind: "event" as const, event })),
      preCancelHook.then((event) => ({ kind: "event" as const, event })),
      preSeatedHook.then((event) => ({ kind: "event" as const, event })),
      preNoShowHook.then((event) => ({ kind: "event" as const, event })),
      sleep(`${calledCfg.followup_after_call_min}m`).then(
        () => ({ kind: "timeout" as const }),
      ),
    ]);

    if (winner.kind === "event") {
      if (winner.event.type === "seated") {
        await acknowledgeTerminal(reservationId, "seated");
        return { reservation_id: reservationId, final_status: "seated" };
      }
      if (winner.event.type === "cancel") {
        await acknowledgeTerminal(reservationId, "cancelled");
        return { reservation_id: reservationId, final_status: "cancelled" };
      }
      if (winner.event.type === "no_show_manual") {
        await acknowledgeTerminal(reservationId, "no_show_manual");
        return { reservation_id: reservationId, final_status: "no_show" };
      }
      if (winner.event.type === "extend") {
        const refreshed = await reloadDeadlineAfterExtend(reservationId);
        if (refreshed.no_show_deadline) {
          currentDeadline = refreshed.no_show_deadline;
        }
        // Extension during pre-window: skip the followup, proceed straight
        // to the final phase — the diner has explicitly asked for more time.
        preWindowDone = true;
        break;
      }
      // type === "call" while already called: idempotent, ignore and continue.
      continue;
    }

    // Timeout: pre-window expired. Safety-net re-check before sending the
    // followup (a cancel could have raced in just before the timer fired).
    const missed = await fetchMissedEvents(reservationId, lastSeenEventId);
    let interrupted = false;
    for (const event of missed) {
      lastSeenEventId = event.id;
      if (event.type === "cancel_requested") {
        await acknowledgeTerminal(reservationId, "cancelled");
        return { reservation_id: reservationId, final_status: "cancelled" };
      }
      if (event.type === "seated_requested") {
        await acknowledgeTerminal(reservationId, "seated");
        return { reservation_id: reservationId, final_status: "seated" };
      }
      if (event.type === "no_show_requested") {
        await acknowledgeTerminal(reservationId, "no_show_manual");
        return { reservation_id: reservationId, final_status: "no_show" };
      }
      if (event.type === "extend_requested") {
        const refreshed = await reloadDeadlineAfterExtend(reservationId);
        if (refreshed.no_show_deadline) {
          currentDeadline = refreshed.no_show_deadline;
        }
        interrupted = true;
      }
    }
    if (interrupted) {
      // An extend landed via DB-only (hook missed) — skip the followup.
      preWindowDone = true;
      break;
    }
    // No interrupting event — send the proactive followup and proceed.
    await emitFollowupPush(
      reservationId,
      "¿Estás en camino? Si necesitás más tiempo, podés pedir una extensión.",
    );
    preWindowDone = true;
  }

  // ---- PHASE 3: CALLED — :called:final window ----
  // Final window: extend / cancel / seated / no_show_manual land here, or
  // the deadline timer fires and we transition to no_show.
  await setActiveHookToken(
    reservationId,
    `reservation:${reservationId}:called:final`,
  );

  while (true) {
    const remaining = await computeRemainingSeconds(currentDeadline);
    if (remaining.seconds <= 0) {
      // Deadline already passed (e.g., a long step pushed us past it).
      // Run safety-net first in case an event arrived during that step.
      const missed = await fetchMissedEvents(reservationId, lastSeenEventId);
      for (const event of missed) {
        lastSeenEventId = event.id;
        if (event.type === "cancel_requested") {
          await acknowledgeTerminal(reservationId, "cancelled");
          return { reservation_id: reservationId, final_status: "cancelled" };
        }
        if (event.type === "seated_requested") {
          await acknowledgeTerminal(reservationId, "seated");
          return { reservation_id: reservationId, final_status: "seated" };
        }
        if (event.type === "no_show_requested") {
          await acknowledgeTerminal(reservationId, "no_show_manual");
          return { reservation_id: reservationId, final_status: "no_show" };
        }
        if (event.type === "extend_requested") {
          const refreshed = await reloadDeadlineAfterExtend(reservationId);
          if (refreshed.no_show_deadline) {
            currentDeadline = refreshed.no_show_deadline;
          }
        }
      }
      // Re-check after replay; if still expired, finalize as no_show.
      const recheck = await computeRemainingSeconds(currentDeadline);
      if (recheck.seconds <= 0) {
        await applyNoShowTransition(reservationId, "timeout");
        return { reservation_id: reservationId, final_status: "no_show" };
      }
      continue;
    }

    const finalExtendHook = extendHook.create({
      token: `reservation:${reservationId}:called:final:extend`,
    });
    const finalCancelHook = cancelHook.create({
      token: `reservation:${reservationId}:called:final:cancel`,
    });
    const finalSeatedHook = seatedHook.create({
      token: `reservation:${reservationId}:called:final:seated`,
    });
    const finalNoShowHook = noShowManualHook.create({
      token: `reservation:${reservationId}:called:final:no_show`,
    });

    const winner: RaceResult<{ type: string }> = await Promise.race([
      finalExtendHook.then((event) => ({ kind: "event" as const, event })),
      finalCancelHook.then((event) => ({ kind: "event" as const, event })),
      finalSeatedHook.then((event) => ({ kind: "event" as const, event })),
      finalNoShowHook.then((event) => ({ kind: "event" as const, event })),
      sleep(`${remaining.seconds}s`).then(
        () => ({ kind: "timeout" as const }),
      ),
    ]);

    if (winner.kind === "event") {
      if (winner.event.type === "seated") {
        await acknowledgeTerminal(reservationId, "seated");
        return { reservation_id: reservationId, final_status: "seated" };
      }
      if (winner.event.type === "cancel") {
        await acknowledgeTerminal(reservationId, "cancelled");
        return { reservation_id: reservationId, final_status: "cancelled" };
      }
      if (winner.event.type === "no_show_manual") {
        await acknowledgeTerminal(reservationId, "no_show_manual");
        return { reservation_id: reservationId, final_status: "no_show" };
      }
      if (winner.event.type === "extend") {
        const refreshed = await reloadDeadlineAfterExtend(reservationId);
        if (refreshed.no_show_deadline) {
          currentDeadline = refreshed.no_show_deadline;
        }
        // Loop: re-park on the updated deadline.
        continue;
      }
      // Unknown event type: ignore and re-park.
      continue;
    }

    // Timeout: deadline reached while parked. Safety-net replay before
    // committing to no_show.
    const missed = await fetchMissedEvents(reservationId, lastSeenEventId);
    let recovered = false;
    for (const event of missed) {
      lastSeenEventId = event.id;
      if (event.type === "cancel_requested") {
        await acknowledgeTerminal(reservationId, "cancelled");
        return { reservation_id: reservationId, final_status: "cancelled" };
      }
      if (event.type === "seated_requested") {
        await acknowledgeTerminal(reservationId, "seated");
        return { reservation_id: reservationId, final_status: "seated" };
      }
      if (event.type === "no_show_requested") {
        await acknowledgeTerminal(reservationId, "no_show_manual");
        return { reservation_id: reservationId, final_status: "no_show" };
      }
      if (event.type === "extend_requested") {
        const refreshed = await reloadDeadlineAfterExtend(reservationId);
        if (refreshed.no_show_deadline) {
          currentDeadline = refreshed.no_show_deadline;
          recovered = true;
        }
      }
    }
    if (recovered) {
      continue;
    }

    // No recovery — diner is a no_show.
    await applyNoShowTransition(reservationId, "timeout");
    return { reservation_id: reservationId, final_status: "no_show" };
  }
}
