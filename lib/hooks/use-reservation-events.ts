"use client";
import { useEffect, useState, useRef } from "react";

export type ConnectionState = "connecting" | "connected" | "reconnecting" | "failed";

export interface ReservationSnapshot {
  reservation_id: string;
  status: "waiting" | "called" | "seated" | "no_show" | "cancelled";
  position: number;
  eta_min: number | null;
  extension_count: number;
  no_show_deadline: string | null;
  called_at: string | null;
  last_event_id: number;
}

export interface ReservationEvent {
  type: string;
  data: unknown;
}

const TERMINAL_STATUSES = new Set(["seated", "no_show", "cancelled"] as const);

const TYPED_EVENTS = [
  "reservation.created",
  "reservation.called",
  "reservation.extended",
  "reservation.seated",
  "reservation.cancelled",
  "reservation.no_show",
  "reservation.workflow_called",
  "reservation.followup",
  "reservation.workflow_no_show",
  "reservation.reopened",
] as const;

// ============================================================
// Internal effect logic — extracted for testability in node:test.
// The hook's useEffect calls this, and __tests__/ imports it directly.
// ============================================================

export interface EffectSetters {
  setSnapshot: (s: ReservationSnapshot | null) => void;
  setLatestEvent: (e: ReservationEvent | null) => void;
  setConnection: (c: ConnectionState) => void;
}

export function _testRunEffect(
  opts: { reservationId: string | null; sessionToken: string | null },
  setters: EffectSetters,
): (() => void) | undefined {
  const { reservationId, sessionToken } = opts;
  const { setSnapshot, setLatestEvent, setConnection } = setters;

  if (!reservationId || !sessionToken) {
    return undefined;
  }

  const url = `/api/events/${reservationId}?session_token=${encodeURIComponent(sessionToken)}`;
  const es = new EventSource(url, { withCredentials: false });
  setConnection("connecting");

  const failureCountRef = { current: 0 };

  es.addEventListener("open", () => {
    failureCountRef.current = 0;
    setConnection("connected");
  });

  es.addEventListener("snapshot", (e) => {
    const data = JSON.parse((e as MessageEvent).data) as ReservationSnapshot;
    setSnapshot(data);
    if (TERMINAL_STATUSES.has(data.status as "seated" | "no_show" | "cancelled")) {
      es.close();
      setConnection("connected");
    }
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
// React hook — thin wrapper around _testRunEffect
// ============================================================

export function useReservationEvents(opts: {
  reservationId: string | null;
  sessionToken: string | null;
}): {
  snapshot: ReservationSnapshot | null;
  latestEvent: ReservationEvent | null;
  connection: ConnectionState;
} {
  const [snapshot, setSnapshot] = useState<ReservationSnapshot | null>(null);
  const [latestEvent, setLatestEvent] = useState<ReservationEvent | null>(null);
  const [connection, setConnection] = useState<ConnectionState>("connecting");

  const reservationIdRef = useRef(opts.reservationId);
  const sessionTokenRef = useRef(opts.sessionToken);
  reservationIdRef.current = opts.reservationId;
  sessionTokenRef.current = opts.sessionToken;

  useEffect(() => {
    const cleanup = _testRunEffect(
      { reservationId: opts.reservationId, sessionToken: opts.sessionToken },
      { setSnapshot, setLatestEvent, setConnection },
    );
    return cleanup ?? undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.reservationId, opts.sessionToken]);

  return { snapshot, latestEvent, connection };
}
