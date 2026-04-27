"use client";
import { cn } from "@/lib/utils";

const COLOR: Record<string, string> = {
  connecting: "bg-yellow-400",
  connected: "bg-green-500",
  reconnecting: "bg-yellow-400",
  failed: "bg-red-500",
};

const LABEL: Record<string, string> = {
  connecting: "conectando",
  connected: "en vivo",
  reconnecting: "reconectando",
  failed: "sin conexión",
};

export function ConnectionDot({
  connection,
}: {
  connection: "connecting" | "connected" | "reconnecting" | "failed";
}) {
  return (
    <div
      className="flex items-center gap-2"
      title={`SSE ${LABEL[connection]}`}
    >
      <span
        className={cn("w-2 h-2 rounded-full inline-block", COLOR[connection])}
        aria-hidden
      />
      <span className="text-xs text-muted-foreground">{LABEL[connection]}</span>
    </div>
  );
}
