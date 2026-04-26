// SSE handler for diner — per-reservation realtime events (PLAT-07).
//
// Pattern 3 (ARCHITECTURE §3.2 + Pitfall #6): snapshot-replay-on-connect.
//   1. Read current state from Postgres
//   2. Emit as initial event with deterministic event id
//   3. Replay reservation_events rows newer than Last-Event-ID (gap recovery)
//   4. Subscribe to KV channel reservation:<uuid> for future updates
//
// Auth (D-28): ?session_token=<uuid> query param matched against the row's
// session_token. Mismatch / missing → 401. Token in querystring is mitigated
// by lib/log.ts redacting query string values from emitted log lines.
//
// Cleanup (Pitfall #7): req.signal.abort fires when the client disconnects.
// We MUST clearInterval(hb), unsubscribe the Subscriber, and close the
// controller — otherwise Upstash subscribe slots leak and the heartbeat
// keeps writing to a dead controller.
//
// Per CLAUDE.md and D-10 architecture: this handler ONLY READS Postgres
// and ONLY SUBSCRIBES to KV. It never publishes — that's reserved for the
// service layer / workflow steps via lib/realtime.ts.

import { Redis } from "@upstash/redis";

import { sql } from "@/lib/db/neon";
import { log } from "@/lib/log";

export const runtime = "nodejs";
// Hobby ceiling is 300s; Pro extends this to 800s. Browser EventSource
// auto-reconnects on close, so the practical user impact is more
// frequent silent reconnects on Hobby — the snapshot-replay-on-connect
// pattern means each reconnect starts from Postgres truth.
export const maxDuration = 300;
export const dynamic = "force-dynamic";

const redis = Redis.fromEnv();

interface ReservationSnapshotRow {
  id: string;
  status: string;
  eta_min: number | null;
  extension_count: number;
  no_show_deadline: string | null;
  called_at: string | null;
  last_event_id: number;
}

interface ReservationEventRow {
  id: number;
  event_type: string;
  payload: Record<string, unknown> | null;
  created_at: string;
}

// Compute the diner's 1-based position in the active queue. Mirrors
// computePosition in lib/services/reservations.ts. Active queue excludes
// terminal states (D-14). Returns 0 if the reservation is no longer active
// — the snapshot still emits a meaningful status (seated/cancelled/etc.).
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

export async function GET(
  req: Request,
  { params }: { params: Promise<{ reservation_id: string }> },
) {
  // Next.js 16: params is a Promise. Awaited once, used throughout.
  const { reservation_id: reservationId } = await params;

  const url = new URL(req.url);
  const sessionToken = url.searchParams.get("session_token");

  // D-28: validate session_token. Single 401 response shape regardless of
  // why the token is invalid — avoids existence enumeration.
  if (!sessionToken) {
    log.warn("sse.diner.unauthorized", { reason: "missing_session_token" });
    return new Response("Unauthorized", { status: 401 });
  }

  const authRows = (await sql`
    SELECT id FROM reservations
    WHERE id = ${reservationId} AND session_token = ${sessionToken}
    LIMIT 1
  `) as Array<{ id: string }>;

  if (authRows.length === 0) {
    log.warn("sse.diner.unauthorized", {
      reason: "session_mismatch",
      reservation_id: reservationId,
    });
    return new Response("Unauthorized", { status: 401 });
  }

  const lastEventHeader = req.headers.get("Last-Event-ID");
  const lastEventIdFromClient =
    lastEventHeader && Number.isFinite(Number(lastEventHeader))
      ? Number(lastEventHeader)
      : 0;

  log.info("sse.diner.connect", {
    reservation_id: reservationId,
    has_last_event_id: lastEventIdFromClient > 0,
  });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      // Helper that writes a fully-formed SSE frame.
      const send = (event: string, data: unknown, id?: string) => {
        try {
          const idLine = id ? `id: ${id}\n` : "";
          controller.enqueue(
            encoder.encode(
              `${idLine}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
            ),
          );
        } catch {
          // Controller may already be closed if abort fired during enqueue.
          // Swallow: the abort handler owns lifecycle.
        }
      };

      // === D-27 Step 1: Snapshot from Postgres ===
      // Single query: reservation row + max event id (for client resumability).
      const snapshotRows = (await sql`
        SELECT
          r.id,
          r.status,
          r.eta_min,
          r.extension_count,
          r.no_show_deadline::text AS no_show_deadline,
          r.called_at::text AS called_at,
          COALESCE(
            (SELECT MAX(id) FROM reservation_events WHERE reservation_id = r.id),
            0
          ) AS last_event_id
        FROM reservations r
        WHERE r.id = ${reservationId}
        LIMIT 1
      `) as ReservationSnapshotRow[];

      if (snapshotRows.length === 0) {
        // Should not happen — auth check matched on this same id. Treat as
        // 404 by closing immediately with a single error event.
        send("error", { code: "RESERVATION_NOT_FOUND" });
        controller.close();
        return;
      }

      const snapshot = snapshotRows[0];
      const position = await computePosition(reservationId);
      const lastEventId = Number(snapshot.last_event_id);

      // === D-27 Step 2: Emit snapshot as initial event ===
      send(
        "snapshot",
        {
          reservation_id: reservationId,
          status: snapshot.status,
          position,
          eta_min: snapshot.eta_min,
          extension_count: snapshot.extension_count,
          no_show_deadline: snapshot.no_show_deadline,
          called_at: snapshot.called_at,
          last_event_id: lastEventId,
        },
        String(lastEventId),
      );

      // === D-27 Step 3: Gap-recover via Last-Event-ID (Pitfall #6) ===
      // If the client reconnects with Last-Event-ID, replay every row
      // recorded in reservation_events with id > that value. This closes
      // the small window between the snapshot read and the KV subscribe
      // (and also any events missed during a disconnect). Snapshot already
      // reflects the row's current state, so replay is for fan-out events.
      if (lastEventIdFromClient > 0 && lastEventIdFromClient < lastEventId) {
        const missedRows = (await sql`
          SELECT id, event_type, payload, created_at::text AS created_at
          FROM reservation_events
          WHERE reservation_id = ${reservationId}
            AND id > ${lastEventIdFromClient}
            AND id <= ${lastEventId}
          ORDER BY id ASC
        `) as ReservationEventRow[];

        for (const row of missedRows) {
          send(
            row.event_type,
            {
              id: row.id,
              type: row.event_type,
              reservation_id: reservationId,
              occurred_at: row.created_at,
              ...(row.payload ?? {}),
            },
            String(row.id),
          );
        }

        log.info("sse.diner.replay", {
          reservation_id: reservationId,
          replayed: missedRows.length,
        });
      }

      // === D-27 Step 4: Subscribe to KV channel ===
      // Upstash subscribe() returns a Subscriber synchronously (NOT a
      // Promise). Auto-deserialization is on by default → message arrives
      // as the parsed JSON object; we MUST NOT JSON.parse it again.
      const sub = redis.subscribe<Record<string, unknown>>(
        `reservation:${reservationId}`,
      );

      sub.on("message", ({ message }) => {
        if (!message || typeof message !== "object") return;
        const evt = message;
        const eventName =
          typeof evt.type === "string" && evt.type.length > 0
            ? evt.type
            : "event";
        const eventId = evt.id != null ? String(evt.id) : undefined;
        send(eventName, evt, eventId);
      });

      sub.on("error", (err) => {
        log.error("sse.diner.subscriber_error", err, {
          reservation_id: reservationId,
        });
      });

      // === Heartbeat (D-26) ===
      // SSE comment line keeps proxies + Vercel from killing the idle
      // stream. 25s is comfortably under the typical 30s idle-cut.
      const hb = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": hb\n\n"));
        } catch {
          // Controller closed — abort handler will clean up the interval.
        }
      }, 25_000);

      // === Cleanup on abort (Pitfall #7) ===
      // req.signal fires "abort" when the client disconnects OR when the
      // platform tears down the stream. We MUST release the Upstash
      // subscribe slot or it will leak.
      req.signal.addEventListener("abort", async () => {
        clearInterval(hb);
        try {
          await sub.unsubscribe();
        } catch (err) {
          log.warn("sse.diner.unsubscribe_failed", {
            reservation_id: reservationId,
            err: err instanceof Error ? err.message : String(err),
          });
        }
        try {
          controller.close();
        } catch {
          // Already closed — fine.
        }
        log.info("sse.diner.disconnect", { reservation_id: reservationId });
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
