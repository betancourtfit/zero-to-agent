"use client";
import { cva } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";

const statusPillVariants = cva(
  "inline-flex items-center px-2 py-0.5 rounded-full text-xs",
  {
    variants: {
      status: {
        waiting: "bg-blue-100 text-blue-700",
        called: "bg-amber-100 text-amber-700",
        seated: "bg-green-100 text-green-700",
        no_show: "bg-red-100 text-red-700",
        cancelled: "bg-gray-100 text-gray-500",
      },
    },
    defaultVariants: {
      status: "waiting",
    },
  },
);

export interface QueueCardReservation {
  reservation_id: string;
  status: string;
  name: string;
  party_size: number;
  eta_min: number | null;
  extension_count: number;
  reopen_count: number;
  created_at: string;
  called_at: string | null;
}

export function QueueCard({
  reservation,
  partyColor,
  onAction,
  loadingAction,
  now,
}: {
  reservation: QueueCardReservation;
  partyColor: string;
  onAction: (action: "call" | "seated") => void;
  loadingAction: "call" | "seated" | null;
  now: number;
}) {
  const waitMin = Math.floor(
    (now - new Date(reservation.created_at).valueOf()) / 60_000,
  );
  const statusKey = reservation.status as
    | "waiting"
    | "called"
    | "seated"
    | "no_show"
    | "cancelled";

  return (
    <div
      className="rounded-lg border bg-card shadow-sm border-l-4 p-4 flex flex-col gap-2"
      style={{ borderLeftColor: partyColor }}
    >
      {/* Top row */}
      <div className="flex items-center gap-2">
        <span
          className="text-xs font-normal px-1.5 py-0.5 rounded shrink-0"
          style={{ backgroundColor: partyColor }}
        >
          {reservation.party_size}
        </span>
        <span
          className="text-base font-semibold truncate flex-1"
          title={reservation.name}
        >
          {reservation.name}
        </span>
        {reservation.extension_count > 0 && (
          <span className="bg-orange-100 text-orange-700 text-xs rounded-full px-2 py-0.5 shrink-0">
            extendido ×{reservation.extension_count}
          </span>
        )}
        {reservation.reopen_count > 0 && (
          <span className="bg-purple-100 text-purple-700 text-xs rounded-full px-2 py-0.5 shrink-0">
            reabierto ×{reservation.reopen_count}
          </span>
        )}
      </div>

      {/* Middle row */}
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-sm text-muted-foreground">
          Esperando hace {waitMin} min
        </span>
        <span className="text-sm">
          ETA {reservation.eta_min ?? "—"} min
        </span>
        <span
          className={cn(statusPillVariants({ status: statusKey }))}
          role="status"
        >
          {statusKey}
        </span>
      </div>

      {/* Bottom row — action buttons */}
      <div className="flex gap-2 mt-2">
        {reservation.status === "waiting" && (
          <Button
            variant="default"
            size="sm"
            className="min-h-[44px]"
            onClick={() => onAction("call")}
            disabled={loadingAction === "call"}
            aria-label={`Llamar a ${reservation.name} (${reservation.party_size} personas)`}
          >
            {loadingAction === "call" ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              "Llamar"
            )}
          </Button>
        )}
        {reservation.status === "called" && (
          <Button
            variant="default"
            size="sm"
            className="min-h-[44px]"
            onClick={() => onAction("seated")}
            disabled={loadingAction === "seated"}
            aria-label={`Marcar presentado a ${reservation.name} (${reservation.party_size} personas)`}
          >
            {loadingAction === "seated" ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              "Marcar presentado"
            )}
          </Button>
        )}
      </div>
    </div>
  );
}
