"use client";
import { useEffect, useState, useCallback } from "react";
import { ReopenDialog } from "./reopen-dialog";
import { cn } from "@/lib/utils";
import type { HistoryRow } from "@/app/api/queue/history/route";

// History table for the /queue/history page (STAFF-08 / D-17).
// Receives an initial server-rendered snapshot from the RSC page, then polls
// /api/queue/history every 30s to pick up changes (no SSE — D-17 explicit).
// The Reabrir button renders ONLY for no_show rows (D-18).

const STATUS_CLASSES: Record<string, string> = {
  seated: "bg-green-100 text-green-700",
  no_show: "bg-red-100 text-red-700",
  cancelled: "bg-gray-100 text-gray-500",
};

const STATUS_LABEL: Record<string, string> = {
  seated: "Sentado",
  no_show: "No-show",
  cancelled: "Cancelado",
};

function formatTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toTimeString().slice(0, 5); // HH:MM local
}

function durationMin(created: string, ended: string | null): string {
  if (!ended) return "—";
  const mins = Math.floor(
    (new Date(ended).valueOf() - new Date(created).valueOf()) / 60_000,
  );
  return `${mins} min`;
}

interface HistoryTableProps {
  initial: HistoryRow[];
}

export function HistoryTable({ initial }: HistoryTableProps) {
  const [rows, setRows] = useState<HistoryRow[]>(initial);

  const refetch = useCallback(async () => {
    try {
      const res = await fetch("/api/queue/history", { credentials: "include" });
      const body = await res.json();
      if (res.ok && body.ok) {
        setRows(body.data as HistoryRow[]);
      }
      // Network error or 4xx — keep stale data; don't toast (polling is silent).
    } catch {
      // Swallowed intentionally — stale data is safe for a history view.
    }
  }, []);

  // Poll every 30s. No SSE — D-17.
  useEffect(() => {
    const id = setInterval(refetch, 30_000);
    return () => clearInterval(id);
  }, [refetch]);

  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground text-center py-8">
        No hay reservas cerradas hoy.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="bg-muted text-muted-foreground">
            <th className="text-left p-2 font-normal">Llegada</th>
            <th className="text-left p-2 font-normal">Nombre</th>
            <th className="text-left p-2 font-normal">Personas</th>
            <th className="text-left p-2 font-normal">Estado</th>
            <th className="text-left p-2 font-normal">Tiempo en cola</th>
            <th className="text-left p-2 font-normal">Acción</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr
              key={r.reservation_id}
              className={cn(
                "border-b last:border-0 hover:bg-muted/50",
                i % 2 === 1 && "bg-muted/30",
              )}
            >
              <td className="p-2 tabular-nums">{formatTime(r.created_at)}</td>
              <td className="p-2 font-medium">{r.name}</td>
              <td className="p-2">{r.party_size}</td>
              <td className="p-2">
                <span
                  role="status"
                  className={cn(
                    "inline-flex items-center px-2 py-0.5 rounded-full text-xs",
                    STATUS_CLASSES[r.status],
                  )}
                >
                  {STATUS_LABEL[r.status]}
                </span>
                {r.reopen_count > 0 && (
                  <span className="ml-2 text-xs text-purple-700">
                    reabierto ×{r.reopen_count}
                  </span>
                )}
              </td>
              <td className="p-2 text-muted-foreground tabular-nums">
                {durationMin(r.created_at, r.ended_at)}
              </td>
              <td className="p-2">
                {r.status === "no_show" ? (
                  <ReopenDialog
                    reservationId={r.reservation_id}
                    diner_name={r.name}
                    onReopened={refetch}
                  />
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
