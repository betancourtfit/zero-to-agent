"use client";
import Link from "next/link";
import { ConnectionDot } from "./connection-dot";
import { cn } from "@/lib/utils";

export function NavBar({
  active,
  connection,
}: {
  active: "active" | "history";
  connection?: "connecting" | "connected" | "reconnecting" | "failed";
}) {
  return (
    <nav className="h-12 border-b px-4 flex items-center justify-between sticky top-0 bg-background z-40">
      <span className="text-base font-semibold">Panel de Maître</span>
      <div className="flex gap-4 text-sm">
        <Link
          href="/queue"
          className={cn(
            "font-normal",
            active === "active"
              ? "text-foreground"
              : "text-muted-foreground",
          )}
        >
          Activas
        </Link>
        <Link
          href="/queue/history"
          className={cn(
            "font-normal",
            active === "history"
              ? "text-foreground"
              : "text-muted-foreground",
          )}
        >
          Historial
        </Link>
      </div>
      {connection ? <ConnectionDot connection={connection} /> : <span aria-hidden />}
    </nav>
  );
}
