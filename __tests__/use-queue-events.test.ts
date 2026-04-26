// Tests for useQueueEvents hook.
// Uses node:test + tsx. Run: npx tsx --test __tests__/use-queue-events.test.ts
//
// Mocks the browser EventSource constructor so these tests run in Node.
// Verifies the 6 behavioral requirements from the plan.

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

// ============================================================
// EventSource stub (mirrors use-reservation-events test)
// ============================================================
const CONNECTING = 0;
const OPEN = 1;
const CLOSED = 2;

type EventCallback = (event: MessageEvent | Event) => void;

class StubEventSource {
  static CONNECTING = CONNECTING;
  static OPEN = OPEN;
  static CLOSED = CLOSED;

  static instances: StubEventSource[] = [];
  static lastInstance: StubEventSource | null = null;

  url: string;
  withCredentials: boolean;
  readyState: number = CONNECTING;

  private listeners: Map<string, EventCallback[]> = new Map();

  constructor(url: string, opts?: { withCredentials?: boolean }) {
    this.url = url;
    this.withCredentials = opts?.withCredentials ?? false;
    StubEventSource.instances.push(this);
    StubEventSource.lastInstance = this;
  }

  addEventListener(type: string, cb: EventCallback) {
    const list = this.listeners.get(type) ?? [];
    list.push(cb);
    this.listeners.set(type, list);
  }

  close() {
    this.readyState = CLOSED;
  }

  simulateOpen() {
    this.readyState = OPEN;
    const handlers = this.listeners.get("open") ?? [];
    for (const h of handlers) h(new Event("open"));
  }

  simulateEvent(type: string, data: unknown) {
    const handlers = this.listeners.get(type) ?? [];
    const evt = Object.assign(new Event(type), {
      data: JSON.stringify(data),
      lastEventId: "",
    }) as MessageEvent;
    for (const h of handlers) h(evt);
  }

  simulateError() {
    const handlers = this.listeners.get("error") ?? [];
    for (const h of handlers) h(new Event("error"));
  }
}

(globalThis as Record<string, unknown>).EventSource = StubEventSource;

// ============================================================
// Import hook after globals are set
// ============================================================
import {
  _testRunQueueEffect,
  type ActiveQueueRow,
} from "../lib/hooks/use-queue-events";
import type { ConnectionState, ReservationEvent } from "../lib/hooks/use-reservation-events";

// ============================================================
// Test helper
// ============================================================
function runQueueEffect() {
  let reservations: ActiveQueueRow[] = [];
  let latestEvent: ReservationEvent | null = null;
  let connection: ConnectionState = "connecting";

  const setReservations = (r: ActiveQueueRow[]) => {
    reservations = r;
  };
  const setLatestEvent = (e: ReservationEvent | null) => {
    latestEvent = e;
  };
  const setConnection = (c: ConnectionState) => {
    connection = c;
  };

  const cleanup = _testRunQueueEffect({ setReservations, setLatestEvent, setConnection });
  return {
    get reservations() {
      return reservations;
    },
    get latestEvent() {
      return latestEvent;
    },
    get connection() {
      return connection;
    },
    cleanup,
  };
}

// ============================================================
// Tests
// ============================================================
describe("useQueueEvents", () => {
  beforeEach(() => {
    StubEventSource.instances = [];
    StubEventSource.lastInstance = null;
  });

  it("Test 1: hook accepts NO arguments (auth is cookie-based)", () => {
    // The hook takes no arguments — verified by _testRunQueueEffect signature accepting no opts
    const state = runQueueEffect();
    assert.ok(StubEventSource.lastInstance, "EventSource should be created immediately");
    state.cleanup?.();
  });

  it("Test 2: opens EventSource at /api/events/queue with withCredentials: true", () => {
    const state = runQueueEffect();
    const es = StubEventSource.lastInstance!;
    assert.equal(es.url, "/api/events/queue");
    assert.equal(es.withCredentials, true, "Staff auth requires cookie — withCredentials must be true");
    // Verify NO session_token in URL
    assert.ok(!es.url.includes("session_token"), "Staff SSE must NOT contain session_token");
    state.cleanup?.();
  });

  it("Test 3: snapshot event populates reservations array from payload.reservations", () => {
    const state = runQueueEffect();
    const es = StubEventSource.lastInstance!;
    const mockQueue: ActiveQueueRow[] = [
      {
        reservation_id: "r-1",
        status: "waiting",
        name: "Ana López",
        party_size: 2,
        eta_min: 10,
        extension_count: 0,
        reopen_count: 0,
        created_at: "2026-04-26T10:00:00Z",
        called_at: null,
      },
      {
        reservation_id: "r-2",
        status: "called",
        name: "Carlos Gómez",
        party_size: 4,
        eta_min: 0,
        extension_count: 1,
        reopen_count: 0,
        created_at: "2026-04-26T09:45:00Z",
        called_at: "2026-04-26T10:05:00Z",
      },
    ];
    es.simulateEvent("snapshot", { reservations: mockQueue, last_event_id: 42 });
    assert.equal(state.reservations.length, 2);
    assert.equal(state.reservations[0].reservation_id, "r-1");
    assert.equal(state.reservations[1].reservation_id, "r-2");
    state.cleanup?.();
  });

  it("Test 4: queue.changed event forwarded as latestEvent", () => {
    const state = runQueueEffect();
    const es = StubEventSource.lastInstance!;
    const eventData = { reservation_id: "r-1", type: "queue.changed", status: "called" };
    es.simulateEvent("queue.changed", eventData);
    assert.ok(state.latestEvent, "latestEvent should be set");
    assert.equal(state.latestEvent!.type, "queue.changed");
    state.cleanup?.();
  });

  it("Test 4b: reservation.called event forwarded as latestEvent", () => {
    const state = runQueueEffect();
    const es = StubEventSource.lastInstance!;
    es.simulateEvent("reservation.called", { reservation_id: "r-1" });
    assert.equal(state.latestEvent?.type, "reservation.called");
    state.cleanup?.();
  });

  it("Test 5: connection-state machine matches use-reservation-events", () => {
    const state = runQueueEffect();
    const es = StubEventSource.lastInstance!;

    // Initial state after effect runs
    assert.equal(state.connection, "connecting");

    // Open → connected
    es.simulateOpen();
    assert.equal(state.connection, "connected");

    // First error → reconnecting
    es.readyState = CONNECTING;
    es.simulateError();
    assert.equal(state.connection, "reconnecting");

    // Two more errors → failed + closed
    es.readyState = CONNECTING;
    es.simulateError();
    es.readyState = CONNECTING;
    es.simulateError();
    assert.equal(state.connection, "failed");
    assert.equal(es.readyState, CLOSED);

    state.cleanup?.();
  });

  it("Test 6: hook does NOT close EventSource on any specific event type", () => {
    const state = runQueueEffect();
    const es = StubEventSource.lastInstance!;
    es.simulateOpen();

    // Emit all kinds of events — none should close the EventSource
    es.simulateEvent("snapshot", { reservations: [], last_event_id: 1 });
    assert.notEqual(es.readyState, CLOSED, "snapshot should not close staff SSE");

    es.simulateEvent("queue.changed", { reservation_id: "r-1" });
    assert.notEqual(es.readyState, CLOSED, "queue.changed should not close staff SSE");

    es.simulateEvent("reservation.seated", { reservation_id: "r-1" });
    assert.notEqual(es.readyState, CLOSED, "reservation.seated should not close staff SSE");

    es.simulateEvent("reservation.no_show", { reservation_id: "r-1" });
    assert.notEqual(es.readyState, CLOSED, "reservation.no_show should not close staff SSE");

    // Only unmount (cleanup) closes it
    state.cleanup?.();
    assert.equal(es.readyState, CLOSED, "cleanup should close EventSource");
  });
});
