// Tests for useReservationEvents hook.
// Uses node:test + tsx. Run: npx tsx --test __tests__/use-reservation-events.test.ts
//
// Mocks the browser EventSource constructor so these tests run in Node.
// Verifies the 7 behavioral requirements from the plan.

import { describe, it, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";

// ============================================================
// EventSource stub
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

  // Test helpers
  simulateOpen() {
    this.readyState = OPEN;
    const handlers = this.listeners.get("open") ?? [];
    for (const h of handlers) h(new Event("open"));
  }

  simulateEvent(type: string, data: unknown, lastEventId?: string) {
    const handlers = this.listeners.get(type) ?? [];
    const evt = Object.assign(new Event(type), {
      data: JSON.stringify(data),
      lastEventId: lastEventId ?? "",
    }) as MessageEvent;
    for (const h of handlers) h(evt);
  }

  simulateError() {
    const handlers = this.listeners.get("error") ?? [];
    for (const h of handlers) h(new Event("error"));
  }
}

// ============================================================
// Shim globals needed for the hook (runs in Node, not browser)
// ============================================================
// Assign stub to globalThis without a conflicting type declaration.
// The var declaration would conflict with lib.dom.d.ts; cast to unknown instead.
(globalThis as Record<string, unknown>).EventSource = StubEventSource;

// ============================================================
// Import hook after globals are set
// ============================================================
// We test the pure hook logic via a minimal React-like harness since
// node:test has no JSDOM. We invoke the hook indirectly by calling
// runEffect() which exercises the useEffect body directly.
//
// Strategy: We extract the hook's internal effect logic by importing
// the module and calling a test-only exported helper that mirrors the
// exact body of the useEffect in the hook without React wiring.
// This approach is idiomatic for testing EventSource hooks in Node.
import {
  _testRunEffect,
  type ConnectionState,
  type ReservationSnapshot,
  type ReservationEvent,
} from "../lib/hooks/use-reservation-events";

// ============================================================
// Test helpers
// ============================================================
function makeOpts(
  reservationId: string | null = "res-123",
  sessionToken: string | null = "tok-abc",
) {
  return { reservationId, sessionToken };
}

function runEffect(opts: {
  reservationId: string | null;
  sessionToken: string | null;
}) {
  let snapshot: ReservationSnapshot | null = null;
  let latestEvent: ReservationEvent | null = null;
  let connection: ConnectionState = "connecting";

  const setSnapshot = (s: ReservationSnapshot | null) => {
    snapshot = s;
  };
  const setLatestEvent = (e: ReservationEvent | null) => {
    latestEvent = e;
  };
  const setConnection = (c: ConnectionState) => {
    connection = c;
  };

  const cleanup = _testRunEffect(opts, { setSnapshot, setLatestEvent, setConnection });
  return {
    get snapshot() {
      return snapshot;
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
describe("useReservationEvents", () => {
  beforeEach(() => {
    StubEventSource.instances = [];
    StubEventSource.lastInstance = null;
  });

  it("Test 1: returns defaults and does NOT open EventSource when reservationId is null", () => {
    const state = runEffect(makeOpts(null, "tok-abc"));
    assert.equal(state.snapshot, null);
    assert.equal(state.latestEvent, null);
    assert.equal(state.connection, "connecting");
    assert.equal(StubEventSource.lastInstance, null, "Should not open EventSource");
    state.cleanup?.();
  });

  it("Test 1b: returns defaults and does NOT open EventSource when sessionToken is null", () => {
    const state = runEffect(makeOpts("res-123", null));
    assert.equal(StubEventSource.lastInstance, null, "Should not open EventSource");
    state.cleanup?.();
  });

  it("Test 2: opens EventSource with correct URL when both params are non-null", () => {
    const state = runEffect(makeOpts("res-123", "tok-abc"));
    const es = StubEventSource.lastInstance;
    assert.ok(es, "EventSource should be created");
    assert.match(es!.url, /\/api\/events\/res-123/);
    assert.match(es!.url, /session_token=tok-abc/);
    assert.equal(es!.withCredentials, false);
    state.cleanup?.();
  });

  it("Test 2b: URL-encodes session token", () => {
    const state = runEffect(makeOpts("res-123", "tok abc+special=?"));
    const es = StubEventSource.lastInstance;
    assert.ok(es);
    assert.ok(!es!.url.includes(" "), "Space should be encoded");
    state.cleanup?.();
  });

  it("Test 3: transitions connection to 'connected' on open event and resets failureCount", () => {
    const state = runEffect(makeOpts());
    const es = StubEventSource.lastInstance!;
    es.simulateOpen();
    assert.equal(state.connection, "connected");
    state.cleanup?.();
  });

  it("Test 4a: parses snapshot event data and stores in snapshot state", () => {
    const state = runEffect(makeOpts());
    const es = StubEventSource.lastInstance!;
    const snapshotData: ReservationSnapshot = {
      reservation_id: "res-123",
      status: "waiting",
      position: 3,
      eta_min: 15,
      extension_count: 0,
      no_show_deadline: null,
      called_at: null,
      last_event_id: 42,
    };
    es.simulateEvent("snapshot", snapshotData);
    assert.deepEqual(state.snapshot, snapshotData);
    // Non-terminal status: EventSource should remain open
    assert.notEqual(es.readyState, CLOSED, "Non-terminal snapshot should not close ES");
    state.cleanup?.();
  });

  it("Test 4b: closes EventSource immediately on terminal status 'seated' in snapshot", () => {
    const state = runEffect(makeOpts());
    const es = StubEventSource.lastInstance!;
    es.simulateEvent("snapshot", {
      reservation_id: "res-123",
      status: "seated",
      position: 0,
      eta_min: null,
      extension_count: 0,
      no_show_deadline: null,
      called_at: "2026-04-26T10:00:00Z",
      last_event_id: 10,
    });
    assert.equal(es.readyState, CLOSED, "Seated terminal status should close EventSource");
    // connection should be 'connected' (graceful) not 'failed'
    assert.equal(state.connection, "connected");
    state.cleanup?.();
  });

  it("Test 4c: closes EventSource on terminal status 'no_show'", () => {
    const state = runEffect(makeOpts());
    const es = StubEventSource.lastInstance!;
    es.simulateEvent("snapshot", {
      reservation_id: "res-123",
      status: "no_show",
      position: 0,
      eta_min: null,
      extension_count: 0,
      no_show_deadline: null,
      called_at: null,
      last_event_id: 5,
    });
    assert.equal(es.readyState, CLOSED);
    state.cleanup?.();
  });

  it("Test 4d: closes EventSource on terminal status 'cancelled'", () => {
    const state = runEffect(makeOpts());
    const es = StubEventSource.lastInstance!;
    es.simulateEvent("snapshot", {
      reservation_id: "res-123",
      status: "cancelled",
      position: 0,
      eta_min: null,
      extension_count: 0,
      no_show_deadline: null,
      called_at: null,
      last_event_id: 7,
    });
    assert.equal(es.readyState, CLOSED);
    state.cleanup?.();
  });

  it("Test 5: updates latestEvent on reservation.called event", () => {
    const state = runEffect(makeOpts());
    const es = StubEventSource.lastInstance!;
    const eventData = { reservation_id: "res-123", called_at: "2026-04-26T10:00:00Z" };
    es.simulateEvent("reservation.called", eventData);
    assert.ok(state.latestEvent, "latestEvent should be set");
    assert.equal(state.latestEvent!.type, "reservation.called");
    assert.deepEqual(state.latestEvent!.data, eventData);
    state.cleanup?.();
  });

  it("Test 5b: updates latestEvent on reservation.followup event", () => {
    const state = runEffect(makeOpts());
    const es = StubEventSource.lastInstance!;
    es.simulateEvent("reservation.followup", { reservation_id: "res-123" });
    assert.equal(state.latestEvent?.type, "reservation.followup");
    state.cleanup?.();
  });

  it("Test 6a: on error with readyState CLOSED, sets connection to 'failed'", () => {
    const state = runEffect(makeOpts());
    const es = StubEventSource.lastInstance!;
    es.simulateOpen(); // first connect OK
    es.readyState = CLOSED; // simulates server-side close
    es.simulateError();
    assert.equal(state.connection, "failed");
    state.cleanup?.();
  });

  it("Test 6b: on first error (readyState CONNECTING), sets connection to 'reconnecting'", () => {
    const state = runEffect(makeOpts());
    const es = StubEventSource.lastInstance!;
    es.simulateOpen();
    // readyState goes back to CONNECTING on reconnect
    es.readyState = CONNECTING;
    es.simulateError();
    assert.equal(state.connection, "reconnecting");
    state.cleanup?.();
  });

  it("Test 6c: after 3 errors, sets connection to 'failed' and closes EventSource", () => {
    const state = runEffect(makeOpts());
    const es = StubEventSource.lastInstance!;
    es.simulateOpen();
    // 3 consecutive errors with readyState CONNECTING (browser is reconnecting)
    for (let i = 0; i < 3; i++) {
      es.readyState = CONNECTING;
      es.simulateError();
    }
    assert.equal(state.connection, "failed");
    assert.equal(es.readyState, CLOSED, "EventSource should be closed after 3 failures");
    state.cleanup?.();
  });

  it("Test 7: closes EventSource on cleanup (unmount)", () => {
    const state = runEffect(makeOpts());
    const es = StubEventSource.lastInstance!;
    es.simulateOpen();
    assert.equal(es.readyState, OPEN);
    state.cleanup?.();
    assert.equal(es.readyState, CLOSED, "Cleanup should close EventSource");
  });
});
