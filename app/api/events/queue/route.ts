// SSE handler for staff — active queue realtime events (PLAT-07).
//
// Pattern 3 (ARCHITECTURE §3.2 + Pitfall #6): snapshot-replay-on-connect.
//   1. Read active queue from Postgres via getActiveQueue() service
//   2. Emit as initial event with deterministic event id
//   3. Replay reservation_events rows newer than Last-Event-ID
//   4. Subscribe to KV channel queue:active for future updates
//
// Auth (D-29): auth() + employees.active gate. The auth.ts session callback
// already strips session.user when the employee is inactive, but we
// double-check here as defense in depth so the SSE handler is auditable
// in isolation.
//
// Cleanup (Pitfall #7): req.signal.abort releases the Upstash subscribe
// slot. Heartbeat fires every 25s.
//
// Per D-20 / CLAUDE.md: this handler ONLY READS Postgres + ONLY SUBSCRIBES
// to KV. Service-layer functions and workflow steps publish; SSE
// subscribes. Never the other way around.

import { Redis } from "@upstash/redis";

import { auth } from "@/lib/auth/auth";
import { sql } from "@/lib/db/neon";
import { log } from "@/lib/log";
import { getActiveQueue } from "@/lib/services/queue";

export const runtime = "nodejs";
// Hobby ceiling is 300s; Pro extends to 800s. Snapshot-replay-on-connect
// means each EventSource reconnect rehydrates from Postgres truth, so
// the more frequent reconnects on Hobby are functionally equivalent.
export const maxDuration = 300;
export const dynamic = "force-dynamic";

const redis = Redis.fromEnv();

interface ReservationEventRow {
  id: number;
  reservation_id: string;
  event_type: string;
  payload: Record<string, unknown> | null;
  created_at: string;
}

export async function GET(req: Request) {
  // === D-29: Staff auth — auth() + employees.active gate ===
  const session = await auth();
  if (!session?.user?.email) {
    log.warn("sse.queue.unauthorized", { reason: "no_session" });
    return new Response("Unauthorized", { status: 401 });
  }

  // The session callback in lib/auth/auth.ts already filters inactive
  // employees, but we re-check here so this route is self-auditable.
  // Schema: employees.email is UNIQUE NOT NULL; employees.active BOOLEAN.
  // We match by email (the established pattern in app/queue/page.tsx and
  // lib/auth/auth.ts) — the schema does NOT expose an id-on-session.
  const empRows = (await sql`
    SELECT active FROM employees WHERE email = ${session.user.email} LIMIT 1
  `) as Array<{ active: boolean }>;

  if (empRows.length === 0 || !empRows[0].active) {
    log.warn("sse.queue.unauthorized", { reason: "employee_inactive" });
    return new Response("Unauthorized", { status: 401 });
  }

  const lastEventHeader = req.headers.get("Last-Event-ID");
  const lastEventIdFromClient =
    lastEventHeader && Number.isFinite(Number(lastEventHeader))
      ? Number(lastEventHeader)
      : 0;

  log.info("sse.queue.connect", {
    has_last_event_id: lastEventIdFromClient > 0,
  });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown, id?: string) => {
        try {
          const idLine = id ? `id: ${id}\n` : "";
          controller.enqueue(
            encoder.encode(
              `${idLine}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
            ),
          );
        } catch {
          // Controller may already be closed during abort race — fine.
        }
      };

      // === D-27 Step 1: Snapshot from Postgres via service layer ===
      // getActiveQueue() filters terminal states (D-14) and computes
      // position from row order. Uses the same service that the staff
      // panel page reads — single source of truth.
      const queue = await getActiveQueue();

      const lastEventRow = (await sql`
        SELECT COALESCE(MAX(id), 0) AS max_id FROM reservation_events
      `) as Array<{ max_id: number }>;
      const lastEventId = Number(lastEventRow[0].max_id);

      // === D-27 Step 2: Emit snapshot ===
      send(
        "snapshot",
        {
          reservations: queue,
          last_event_id: lastEventId,
        },
        String(lastEventId),
      );

      // === D-27 Step 3: Gap recovery (Pitfall #6) ===
      // Note: queue snapshot already reflects the current row state. The
      // replay below is for the staff panel's per-row event log, so the
      // UI can re-render call/extend/seated/no-show transitions that
      // occurred while disconnected.
      if (lastEventIdFromClient > 0 && lastEventIdFromClient < lastEventId) {
        const missedRows = (await sql`
          SELECT id, reservation_id, event_type, payload,
                 created_at::text AS created_at
          FROM reservation_events
          WHERE id > ${lastEventIdFromClient} AND id <= ${lastEventId}
          ORDER BY id ASC
        `) as ReservationEventRow[];

        for (const row of missedRows) {
          send(
            row.event_type,
            {
              id: row.id,
              type: row.event_type,
              reservation_id: row.reservation_id,
              occurred_at: row.created_at,
              ...(row.payload ?? {}),
            },
            String(row.id),
          );
        }

        log.info("sse.queue.replay", { replayed: missedRows.length });
      }

      // === D-27 Step 4: Subscribe to queue:active ===
      // Upstash subscribe() is synchronous, returns a Subscriber. Auto-
      // deserialization yields parsed objects on "message".
      const sub = redis.subscribe<Record<string, unknown>>("queue:active");

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
        log.error("sse.queue.subscriber_error", err);
      });

      // === Heartbeat every 25s ===
      const hb = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": hb\n\n"));
        } catch {
          // Controller closed.
        }
      }, 25_000);

      // === Cleanup on abort (Pitfall #7) ===
      req.signal.addEventListener("abort", async () => {
        clearInterval(hb);
        try {
          await sub.unsubscribe();
        } catch (err) {
          log.warn("sse.queue.unsubscribe_failed", {
            err: err instanceof Error ? err.message : String(err),
          });
        }
        try {
          controller.close();
        } catch {
          // Already closed.
        }
        log.info("sse.queue.disconnect");
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
