"use client";
import type { ReservationSnapshot } from "@/lib/hooks/use-reservation-events";

interface Props {
  snapshot: ReservationSnapshot | null;
}

export function StatusCard({ snapshot }: Props) {
  if (!snapshot) return null;

  return (
    <div className="bg-muted rounded-lg mx-4 mt-4 p-4 text-sm">
      <div className="font-semibold">TU RESERVA</div>
      <div className="text-muted-foreground">
        Posición #{snapshot.position} · ETA {snapshot.eta_min ?? "—"} min · {snapshot.status}
      </div>
      {snapshot.extension_count > 0 && (
        <span className="inline-block mt-1 bg-orange-100 text-orange-700 text-xs rounded-full px-2 py-0.5">
          extendido ×{snapshot.extension_count}
        </span>
      )}
    </div>
  );
}
