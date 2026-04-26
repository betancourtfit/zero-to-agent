// KV pub/sub publisher (D-20). Service layer + workflow steps publish
// through these helpers — they NEVER call redis.publish directly.
// Subscription is ONLY in SSE Route Handlers (Phase 02-06), never in
// service functions or workflow steps (Pitfall #7 cleanup discipline
// applies to subscribers).

import { Redis } from "@upstash/redis";
import { log } from "@/lib/log";

const redis = Redis.fromEnv();

// Stable payload shape per D-25. The `id` field maps to reservation_events.id
// so SSE clients can pass Last-Event-ID for resumability per Pitfall #6.
export interface ReservationEventPayload {
  id?: number;
  type: string;
  reservation_id: string;
  occurred_at: string;
  [key: string]: unknown;
}

export interface QueueEventPayload {
  reservation_id: string;
  type: string;
  occurred_at: string;
  [key: string]: unknown;
}

// Publishes a per-reservation event to channel `reservation:<uuid>` (D-24).
// SSE handler at /api/events/[reservation_id] subscribes here.
export async function publishReservationEvent(
  reservationId: string,
  event: ReservationEventPayload,
): Promise<void> {
  await redis.publish(`reservation:${reservationId}`, JSON.stringify(event));
  log.info("realtime.publish.reservation", {
    reservation_id: event.reservation_id,
    event_type: event.type,
  });
}

// Publishes a queue-level fan-out event to channel `queue:active` (D-24).
// SSE handler at /api/events/queue subscribes here for the staff panel.
export async function publishQueueEvent(
  event: QueueEventPayload,
): Promise<void> {
  await redis.publish("queue:active", JSON.stringify(event));
  log.info("realtime.publish.queue", {
    reservation_id: event.reservation_id,
    event_type: event.type,
  });
}
