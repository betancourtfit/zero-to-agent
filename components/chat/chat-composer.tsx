"use client";
import { useState, type KeyboardEvent } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface Props {
  onSend: (text: string) => void;
  status: "ready" | "submitted" | "streaming" | "error";
}

export function ChatComposer({ onSend, status }: Props) {
  const [input, setInput] = useState("");
  const isDisabled = status !== "ready";

  function handleSend() {
    const trimmed = input.trim();
    if (!trimmed || isDisabled) return;
    onSend(trimmed);
    setInput("");
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <div className="sticky bottom-0 border-t bg-background px-4 py-3 flex gap-2">
      <input
        type="text"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Escribí tu mensaje..."
        aria-label="Mensaje para el chatbot"
        aria-disabled={isDisabled}
        disabled={isDisabled}
        className={cn(
          "flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm",
          "placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2",
          "focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
        )}
      />
      <Button
        onClick={handleSend}
        disabled={isDisabled}
        className="min-h-[44px] shrink-0"
      >
        Enviar
      </Button>
    </div>
  );
}
