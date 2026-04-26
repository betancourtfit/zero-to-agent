"use client";
import { useEffect, useState, useRef } from "react";
import type { ConnectionState, ReservationEvent } from "./use-reservation-events";

export type { ConnectionState };

export interface ActiveQueueRow {
  reservation_id: string;
  status: "waiting" | "called";
  name: string;
  party_size: number;
  eta_min: number | null;
  extension_count: number;
  reopen_count: number;
  created_at: string;
  called_at: string | null;
}

const TYPED_EVENTS = [
  "queue.changed",
  "reservation.created",
  "reservation.called",
  "reservation.seated",
  "reservation.cancelled",
  "reservation.no_show",
  "reservation.reopened",
] as const;

// ============================================================
// Internal effect logic — extracted for testability in node:test.
// The hook's useEffect calls this, and __tests__/ imports it directly.
// ============================================================

export interface QueueEffectSetters {
  setReservations: (r: ActiveQueueRow[]) => void;
  setLatestEvent: (e: ReservationEvent | null) => void;
  setConnection: (c: ConnectionState) => void;
}

export function _testRunQueueEffect(setters: QueueEffectSetters): (() => void) | undefined {
  const { setReservations, setLatestEvent, setConnection } = setters;

  const es = new EventSource("/api/events/queue", { withCredentials: true });
  setConnection("connecting");

  const failureCountRef = { current: 0 };

  es.addEventListener("open", () => {
    failureCountRef.current = 0;
    setConnection("connected");
  });

  es.addEventListener("snapshot", (e) => {
    const data = JSON.parse((e as MessageEvent).data) as {
      reservations: ActiveQueueRow[];
      last_event_id: number;
    };
    setReservations(data.reservations);
  });

  for (const evt of TYPED_EVENTS) {
    es.addEventListener(evt, (e) => {
      const data = JSON.parse((e as MessageEvent).data);
      setLatestEvent({ type: evt, data });
    });
  }

  es.addEventListener("error", () => {
    if (es.readyState === EventSource.CLOSED) {
      setConnection("failed");
      return;
    }
    failureCountRef.current++;
    if (failureCountRef.current >= 3) {
      setConnection("failed");
      es.close();
    } else {
      setConnection("reconnecting");
    }
  });

  return () => {
    es.close();
  };
}

// ============================================================
// React hook — thin wrapper around _testRunQueueEffect.
//
// Staff auth is via Auth.js cookie, so:
//   - No arguments (cookie is sent automatically by the browser)
//   - withCredentials: true so the browser includes the httpOnly cookie
//   - No session_token in the URL (staff SSE is cookie-gated server-side)
// ============================================================

export function useQueueEvents(): {
  reservations: ActiveQueueRow[];
  latestEvent: ReservationEvent | null;
  connection: ConnectionState;
} {
  const [reservations, setReservations] = useState<ActiveQueueRow[]>([]);
  const [latestEvent, setLatestEvent] = useState<ReservationEvent | null>(null);
  const [connection, setConnection] = useState<ConnectionState>("connecting");

  // Stable ref — the effect only runs once (no deps) because the URL is
  // constant for the lifetime of the component. Reconnects are handled by
  // the browser's built-in EventSource retry, not by re-running the effect.
  const mountedRef = useRef(true);
  mountedRef.current = true;

  useEffect(() => {
    const cleanup = _testRunQueueEffect({ setReservations, setLatestEvent, setConnection });
    return cleanup ?? undefined;
  }, []);

  return { reservations, latestEvent, connection };
}
