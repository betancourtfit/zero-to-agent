"use client";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useQueueEvents } from "@/lib/hooks/use-queue-events";
import type { ActiveQueueItem } from "@/lib/services/queue";
import { QueueCard } from "./queue-card";
import { NavBar } from "./nav-bar";

function pickColor(
  partySize: number,
  palette: Record<string, string>,
): string {
  if (partySize <= 2) return palette["1-2"] ?? "#A8E6CF";
  if (partySize <= 4) return palette["3-4"] ?? "#FFD3B6";
  if (partySize <= 6) return palette["5-6"] ?? "#FFAAA5";
  return palette["7+"] ?? "#D5AAFF";
}

export function QueueGrid({
  initial,
  colorsByPartySize,
}: {
  initial: ActiveQueueItem[];
  colorsByPartySize: Record<string, string>;
}) {
  const { reservations: liveReservations, connection } = useQueueEvents();

  // Use initial server-rendered snapshot until the hook's first SSE snapshot arrives.
  // liveReservations starts as [] — once SSE delivers the snapshot it becomes non-empty.
  const reservations =
    liveReservations.length > 0 ? liveReservations : initial;

  const [loadingMap, setLoadingMap] = useState<
    Record<string, "call" | "seated" | null>
  >({});

  // Refresh wait-time display every 30s (cosmetic, NOT SSE-driven per D-13)
  const [now, setNow] = useState<number>(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const sseFailed = connection === "failed";

  async function handleAction(
    reservationId: string,
    action: "call" | "seated",
  ) {
    setLoadingMap((m) => ({ ...m, [reservationId]: action }));
    try {
      const res = await fetch(`/api/queue/${reservationId}/${action}`, {
        method: "POST",
        credentials: "include",
      });
      const body = await res.json();
      if (!res.ok || !body.ok) {
        toast.error(body?.error?.message ?? "Error desconocido");
      }
      // SSE will sync state regardless; button re-enables via setLoadingMap below
    } catch {
      toast.error("No pudimos completar la acción. Probá de nuevo.");
    } finally {
      setLoadingMap((m) => ({ ...m, [reservationId]: null }));
    }
  }

  return (
    <>
      <NavBar active="active" connection={connection} />

      {sseFailed && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded mx-4 mt-4 px-4 py-2">
          Sin conexión en vivo. Refrescá la página.
        </div>
      )}

      {reservations.length === 0 ? (
        <div className="text-center py-16">
          <h2 className="text-xl font-semibold">Sin reservas activas</h2>
          <p className="text-sm text-muted-foreground mt-2">
            Cuando alguien se anote, va a aparecer acá.
          </p>
          <p className="text-xs text-muted-foreground mt-4">
            Última actualización: {new Date(now).toTimeString().slice(0, 8)}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 p-4">
          {reservations.map((r) => (
            <QueueCard
              key={r.reservation_id}
              reservation={{
                reservation_id: r.reservation_id,
                status: r.status,
                name: r.name,
                party_size: r.party_size,
                eta_min: r.eta_min,
                extension_count: r.extension_count,
                reopen_count: r.reopen_count,
                created_at: r.created_at,
                called_at: r.called_at,
              }}
              partyColor={pickColor(r.party_size, colorsByPartySize)}
              onAction={(action) => handleAction(r.reservation_id, action)}
              loadingAction={loadingMap[r.reservation_id] ?? null}
              now={now}
            />
          ))}
        </div>
      )}
    </>
  );
}
