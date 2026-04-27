"use client";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import type { ReservationSnapshot, ReservationEvent } from "@/lib/hooks/use-reservation-events";

interface Props {
  snapshot: ReservationSnapshot | null;
  latestEvent: ReservationEvent | null;
  partyColor: string;
  onClearSession: () => void;
  children?: ReactNode; // QuickReplyChips passed in by parent for followup state
}

export function PushBanner({ snapshot, latestEvent, partyColor, onClearSession, children }: Props) {
  // State machine: driven by snapshot.status + latestEvent.type

  if (!snapshot || snapshot.status === "waiting") {
    return null;
  }

  // Called state — two sub-states: initial call or followup
  if (snapshot.status === "called") {
    const isFollowup = latestEvent?.type === "reservation.followup";

    if (isFollowup) {
      return (
        <div
          role="status"
          aria-live="assertive"
          className="sticky top-0 z-50 w-full bg-amber-50 border-b border-amber-200 px-4 py-3"
        >
          <div className="text-base font-semibold text-amber-800">¿Estás en camino?</div>
          <div className="text-sm text-amber-700 mt-1">
            Avisanos para reservarte tu lugar.
          </div>
          {children}
        </div>
      );
    }

    // Initial call — "TU MESA ESTÁ LISTA" (DINER-03)
    return (
      <div
        role="status"
        aria-live="assertive"
        className="sticky top-0 z-50 w-full px-4 py-4 text-center"
        style={{ backgroundColor: partyColor }}
      >
        <div className="text-3xl font-semibold uppercase tracking-wide">TU MESA ESTÁ LISTA</div>
        <div className="text-sm mt-1 opacity-80">Acercate al maître</div>
      </div>
    );
  }

  // Seated state
  if (snapshot.status === "seated") {
    return (
      <div
        role="status"
        aria-live="assertive"
        className="sticky top-0 z-50 w-full bg-green-50 border-b border-green-200 px-4 py-3 flex items-center justify-between"
      >
        <span className="text-sm font-medium text-green-800">Bienvenido. Disfrutá la cena.</span>
        <Button variant="outline" size="sm" onClick={onClearSession}>
          Salir
        </Button>
      </div>
    );
  }

  // No-show — SAFE-03 LOCKED empathic copy (verbatim per REQUIREMENTS.md)
  if (snapshot.status === "no_show") {
    return (
      <div
        role="status"
        aria-live="assertive"
        className="sticky top-0 z-50 w-full bg-muted border-b px-4 py-3"
      >
        <p className="text-sm text-foreground">
          Marcamos tu reserva como no-show porque no llegamos a verte. Si querés volver a anotarte, abrí esta página de nuevo.
        </p>
        <Button variant="outline" size="sm" className="mt-2" onClick={onClearSession}>
          Anotarme de nuevo
        </Button>
      </div>
    );
  }

  // Cancelled state
  if (snapshot.status === "cancelled") {
    return (
      <div
        role="status"
        aria-live="assertive"
        className="sticky top-0 z-50 w-full bg-muted border-b px-4 py-3"
      >
        <p className="text-sm text-foreground">
          Tu reserva fue cancelada. Si querés volver a anotarte, abrí esta página de nuevo.
        </p>
        <Button variant="outline" size="sm" className="mt-2" onClick={onClearSession}>
          Anotarme de nuevo
        </Button>
      </div>
    );
  }

  return null;
}
