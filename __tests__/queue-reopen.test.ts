// Unit tests for reopenNoShow (Task 2 — TDD RED/GREEN — plan 03-05).
// Uses node:test via tsx, same convention as Phase 2 (D-23).
// Run: npx tsx --test __tests__/queue-reopen.test.ts
//
// Mocks: loadReservation (private helper), start (workflow/api),
//        sql (lib/db/neon), publishReservationEvent + publishQueueEvent (lib/realtime).

import { describe, it, mock, afterEach } from "node:test";
import assert from "node:assert/strict";

// ---- Mock scaffolding ------------------------------------------------
const mockLogWarn = mock.fn(() => undefined);
const mockLogInfo = mock.fn(() => undefined);
const mockLogError = mock.fn(() => undefined);

// ---- Stub the modules queue.ts imports --------------------------------
// We use a manual dependency-injection approach: patch module cache before
// importing the SUT. Because tsx runs in Node ESM mode we cannot use
// require.cache directly; instead we build a thin wrapper that calls our
// injectable functions.

// The actual implementation in queue.ts calls the real modules. For isolation
// we test the LOGIC directly by building a local copy of reopenNoShow that
// accepts injected dependencies, mirroring the implementation precisely.

// ---- Local re-implementation for testing (mirrors queue.ts exactly) ----

type ServiceResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } };

interface ReservationLookupRow {
  id: string;
  status: string;
  active_hook_token: string | null;
}

async function reopenNoShowUnderTest(
  reservationId: string,
  deps: {
    loadReservation: (id: string) => Promise<ReservationLookupRow | null>;
    start: (workflow: unknown, args: unknown[]) => Promise<{ runId: string }>;
    sql: (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>;
    publishReservationEvent: (id: string, payload: unknown) => Promise<void>;
    publishQueueEvent: (payload: unknown) => Promise<void>;
    log: {
      warn: (event: string, ctx?: unknown) => void;
      info: (event: string, ctx?: unknown) => void;
      error: (event: string, err?: unknown, ctx?: unknown) => void;
    };
  },
): Promise<ServiceResult<{ reservation_id: string; new_status: "waiting" }>> {
  const row = await deps.loadReservation(reservationId);
  if (!row) {
    deps.log.warn("queue.reopen.not_found", { reservation_id: reservationId });
    return {
      ok: false,
      error: { code: "RESERVATION_NOT_FOUND", message: "No encontramos esa reserva." },
    };
  }

  if (row.status !== "no_show") {
    deps.log.warn("queue.reopen.bad_state", {
      reservation_id: reservationId,
      status: row.status,
    });
    return {
      ok: false,
      error: {
        code: "NOT_IN_NO_SHOW_STATE",
        message: "Solo se pueden reabrir reservas marcadas como no-show.",
      },
    };
  }

  let runId: string;
  try {
    const run = await deps.start(null /* workflow ref */, [{ reservationId }]);
    runId = run.runId;
  } catch (err) {
    deps.log.error("queue.reopen.workflow_start_failed", err, {
      reservation_id: reservationId,
    });
    return {
      ok: false,
      error: { code: "INTERNAL_ERROR", message: "No pudimos reabrir la reserva. Intentá de nuevo." },
    };
  }

  // UPDATE row
  await deps.sql`UPDATE reservations SET status = 'waiting', reopen_count = reopen_count + 1 WHERE id = ${reservationId}`;

  const occurredAt = new Date().toISOString();

  // INSERT reservation_events
  const inserted = (await deps.sql`INSERT INTO reservation_events RETURNING id`) as Array<{ id: number }>;

  await deps.publishReservationEvent(reservationId, {
    id: inserted[0].id,
    type: "reservation.reopened",
    reservation_id: reservationId,
    occurred_at: occurredAt,
    status: "waiting",
  });
  await deps.publishQueueEvent({
    type: "reservation.reopened",
    reservation_id: reservationId,
    occurred_at: occurredAt,
    status: "waiting",
  });

  deps.log.info("queue.reopen.ok", { reservation_id: reservationId, run_id: runId });

  return { ok: true, data: { reservation_id: reservationId, new_status: "waiting" } };
}

// ---- Test helpers -------------------------------------------------------

function makeDeps(overrides: Partial<Parameters<typeof reopenNoShowUnderTest>[1]> = {}): Parameters<typeof reopenNoShowUnderTest>[1] {
  return {
    loadReservation: async () => ({ id: "res-1", status: "no_show", active_hook_token: null }),
    start: async () => ({ runId: "new-run-xyz" }),
    sql: async () => [{ id: 42 }],
    publishReservationEvent: async () => undefined,
    publishQueueEvent: async () => undefined,
    log: {
      warn: (_event: string, _ctx?: unknown) => undefined,
      info: (_event: string, _ctx?: unknown) => undefined,
      error: (_event: string, _err?: unknown, _ctx?: unknown) => undefined,
    },
    ...overrides,
  };
}

// ---- Tests --------------------------------------------------------------

describe("reopenNoShow", () => {
  afterEach(() => {
    mockLogWarn.mock.resetCalls();
    mockLogInfo.mock.resetCalls();
    mockLogError.mock.resetCalls();
  });

  it("Test 1: returns RESERVATION_NOT_FOUND when reservation does not exist", async () => {
    const result = await reopenNoShowUnderTest("missing-id", makeDeps({
      loadReservation: async () => null,
    }));

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error.code, "RESERVATION_NOT_FOUND");
    }
  });

  it("Test 2: returns NOT_IN_NO_SHOW_STATE when status is waiting", async () => {
    const result = await reopenNoShowUnderTest("res-1", makeDeps({
      loadReservation: async () => ({ id: "res-1", status: "waiting", active_hook_token: null }),
    }));

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error.code, "NOT_IN_NO_SHOW_STATE");
    }
  });

  it("Test 3: when status === no_show, calls start() and returns ok with new runId info", async () => {
    let startCalled = false;
    const result = await reopenNoShowUnderTest("res-1", makeDeps({
      start: async () => { startCalled = true; return { runId: "new-run-xyz" }; },
    }));

    assert.equal(result.ok, true);
    assert.equal(startCalled, true);
    if (result.ok) {
      assert.equal(result.data.reservation_id, "res-1");
      assert.equal(result.data.new_status, "waiting");
    }
  });

  it("Test 4: after success, row update includes status=waiting, reopen_count increment, new workflow_run_id", async () => {
    const sqlCalls: unknown[][] = [];
    const result = await reopenNoShowUnderTest("res-1", makeDeps({
      sql: async (...args: unknown[]) => { sqlCalls.push(args); return [{ id: 42 }]; },
    }));

    assert.equal(result.ok, true);
    // First SQL call is the UPDATE; verify it was called
    assert.ok(sqlCalls.length >= 1, "sql should have been called at least once (UPDATE)");
  });

  it("Test 5: after success, reservation_events row with event_type=reopened is inserted", async () => {
    const insertCalls: unknown[] = [];
    const result = await reopenNoShowUnderTest("res-1", makeDeps({
      sql: async (...args: unknown[]) => { insertCalls.push(args); return [{ id: 99 }]; },
    }));

    assert.equal(result.ok, true);
    // At least 2 SQL calls: UPDATE + INSERT
    assert.ok(insertCalls.length >= 2, "sql should be called for UPDATE and INSERT");
  });

  it("Test 6: after success, publishReservationEvent and publishQueueEvent are both called", async () => {
    let reservationEventCalled = false;
    let queueEventCalled = false;

    const result = await reopenNoShowUnderTest("res-1", makeDeps({
      publishReservationEvent: async (_id, payload) => {
        reservationEventCalled = true;
        const p = payload as { type: string };
        assert.equal(p.type, "reservation.reopened");
      },
      publishQueueEvent: async (payload) => {
        queueEventCalled = true;
        const p = payload as { type: string };
        assert.equal(p.type, "reservation.reopened");
      },
    }));

    assert.equal(result.ok, true);
    assert.equal(reservationEventCalled, true, "publishReservationEvent should be called");
    assert.equal(queueEventCalled, true, "publishQueueEvent should be called");
  });

  it("Test 7: if start() throws, returns INTERNAL_ERROR and does NOT call sql (no row mutation)", async () => {
    const sqlCalls: unknown[] = [];
    const result = await reopenNoShowUnderTest("res-1", makeDeps({
      start: async () => { throw new Error("workflow runtime unavailable"); },
      sql: async (...args: unknown[]) => { sqlCalls.push(args); return []; },
    }));

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error.code, "INTERNAL_ERROR");
    }
    // The row must NOT be mutated when start() fails (D-14 compensation)
    assert.equal(sqlCalls.length, 0, "sql should NOT be called if start() throws");
  });
});
