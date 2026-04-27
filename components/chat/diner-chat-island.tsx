"use client";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useEffect, useRef, useState } from "react";

import { useReservationEvents } from "@/lib/hooks/use-reservation-events";
import { ChatComposer } from "./chat-composer";
import { ChatThread } from "./chat-thread";
import { PushBanner } from "./push-banner";
import { QuickReplyChips } from "./quick-reply-chips";
import { StatusCard } from "./status-card";

// localStorage keys (D-08)
const SK_TOKEN = "restaurant_queue:session_token";
const SK_RID = "restaurant_queue:reservation_id";
const SK_INTENT = "restaurant_queue:lastIntent";

interface Props {
  colorsByPartySize: Record<string, string>;
}

export function DinerChat({ colorsByPartySize }: Props) {
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [reservationId, setReservationId] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [networkError, setNetworkError] = useState<string | null>(null);
  const hasGreeted = useRef(false);

  // D-09 step 1: read localStorage on mount
  useEffect(() => {
    const tok = localStorage.getItem(SK_TOKEN);
    const rid = localStorage.getItem(SK_RID);
    setSessionToken(tok);
    setReservationId(rid);

    if (!tok || !rid) {
      setHydrated(true);
      return;
    }

    // D-09 step 2: validate via /api/me; clear localStorage if closed/invalid
    fetch(`/api/me?session_token=${encodeURIComponent(tok)}`)
      .then((r) => r.json())
      .then((data: { ok: boolean; data?: { status: string } }) => {
        if (
          !data.ok ||
          ["seated", "no_show", "cancelled"].includes(data.data?.status ?? "")
        ) {
          localStorage.removeItem(SK_TOKEN);
          localStorage.removeItem(SK_RID);
          setSessionToken(null);
          setReservationId(null);
        }
      })
      .catch(() => {
        // Network error on /api/me is non-fatal — keep localStorage, retry next mount
      })
      .finally(() => setHydrated(true));
  }, []);

  // ASSERT-D PASS: transport.headers function form re-evaluates per request
  const { messages, sendMessage, status, error } = useChat({
    transport: new DefaultChatTransport({
      api: "/api/chat",
      headers: () => ({
        ...(sessionToken ? { "X-Reservation-Session": sessionToken } : {}),
      }),
    }),
  });

  // D-08: persist localStorage after successful register_diner (Pitfall #10 — AFTER stream, not during)
  useEffect(() => {
    for (const m of messages) {
      for (const part of m.parts) {
        if (
          part.type === "tool-register_diner" &&
          (part as { state: string }).state === "output-available"
        ) {
          const out = (
            part as {
              output?: {
                ok: boolean;
                data?: { reservation_id: string; session_token: string };
              };
            }
          ).output;
          if (out?.ok && out.data && !localStorage.getItem(SK_TOKEN)) {
            localStorage.setItem(SK_TOKEN, out.data.session_token);
            localStorage.setItem(SK_RID, out.data.reservation_id);
            setSessionToken(out.data.session_token);
            setReservationId(out.data.reservation_id);
          }
        }
      }
    }
  }, [messages]);

  // SSE hook — connects once reservationId + sessionToken are known
  const { snapshot, latestEvent } = useReservationEvents({ reservationId, sessionToken });

  // Track network-level chat errors (D-07)
  useEffect(() => {
    if (error) {
      setNetworkError("No pude contactar al servidor. Intentá de nuevo en un momento.");
    }
  }, [error]);

  // Synthetic greeting on first mount when no session (avoids blank chat)
  useEffect(() => {
    if (hydrated && !sessionToken && !hasGreeted.current && messages.length === 0) {
      hasGreeted.current = true;
      sendMessage({ text: "hola" });
    }
  }, [hydrated, sessionToken, messages.length, sendMessage]);

  function clearSession() {
    localStorage.removeItem(SK_TOKEN);
    localStorage.removeItem(SK_RID);
    localStorage.removeItem(SK_INTENT);
    window.location.reload();
  }

  // Derive party color for banner — fallback to 1-2 default since diner snapshot lacks party_size
  const partyColor = colorsByPartySize["1-2"] ?? "#A8E6CF";

  return (
    <div className="min-h-screen flex flex-col max-w-md mx-auto">
      <header className="h-12 flex items-center px-4 border-b shrink-0">
        <h1 className="text-xl font-semibold">Cola de Espera</h1>
        <p className="ml-3 text-sm text-muted-foreground">Anotate en la cola del restaurante</p>
      </header>

      <PushBanner
        snapshot={snapshot}
        latestEvent={latestEvent}
        partyColor={partyColor}
        onClearSession={clearSession}
      >
        {snapshot?.status === "called" && latestEvent?.type === "reservation.followup" && (
          <QuickReplyChips onChip={(text) => sendMessage({ text })} />
        )}
      </PushBanner>

      <StatusCard snapshot={snapshot} />

      <main className="flex-1 overflow-y-auto px-4 py-2">
        <ChatThread messages={messages} />
      </main>

      {networkError && (
        <div className="bg-destructive/10 text-destructive text-sm px-4 py-2 mx-4 mb-2 rounded">
          {networkError}
        </div>
      )}

      <ChatComposer onSend={(text) => sendMessage({ text })} status={status} />
    </div>
  );
}
