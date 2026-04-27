"use client";
import type { UIMessage } from "ai";

import { cn } from "@/lib/utils";

interface Props {
  messages: UIMessage[];
}

export function ChatThread({ messages }: Props) {
  return (
    <div className="flex flex-col gap-3 py-2">
      {messages.map((message) => (
        <div key={message.id} className={cn("flex flex-col gap-1", message.role === "user" ? "items-end" : "items-start")}>
          {message.parts.map((part, idx) => {
            // Text bubble
            if (part.type === "text") {
              return (
                <div
                  key={idx}
                  className={cn(
                    "max-w-[80%] px-4 py-2 text-base leading-normal",
                    message.role === "user"
                      ? "bg-primary text-primary-foreground rounded-2xl rounded-br-sm"
                      : "bg-muted text-foreground rounded-2xl rounded-bl-sm",
                  )}
                >
                  {part.text}
                </div>
              );
            }

            // Confirmation badge for register_diner — rendered ONLY from tool result, NEVER from LLM text (Pitfall #16)
            if (part.type === "tool-register_diner" && (part as { state: string }).state === "output-available") {
              const out = (part as { output?: { ok: boolean; data?: { reservation_id: string } } }).output;
              if (out?.ok && out.data) {
                return (
                  <span
                    key={idx}
                    className="inline-flex items-center gap-1 bg-green-50 text-green-700 text-xs font-normal px-2 py-0.5 rounded-full border border-green-200"
                  >
                    Reserva #{out.data.reservation_id.slice(0, 8)}
                  </span>
                );
              }
            }

            // All other tool result types: render nothing.
            // LLM text speaks the result; only register_diner confirmation gets the badge (Pitfall #16).
            return null;
          })}
        </div>
      ))}
    </div>
  );
}
