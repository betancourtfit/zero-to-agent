// MCP server route handler (D-07).
// Exposes the public MCP surface: 4 tools, bearer-gated by withMcpAuth,
// per-action session resolution from X-Reservation-Session.
//
// Discipline:
//   - One verifier (verifyBearer) wraps the WHOLE handler — never inline
//     auth per tool (D-01, ARCHITECTURE Anti-Pattern 5).
//   - create_reservation is the ONLY tool exposing diner identity fields
//     in its inputSchema (D-02).
//   - Action tools (extend_wait, cancel_reservation,
//     get_reservation_status) accept ZERO LLM-visible identity params
//     (D-03, Pitfall #5). The MCP route resolves session_token from the
//     X-Reservation-Session HTTP header and dispatches the service-
//     layer call with the resolved token.
//   - All tools return text content with JSON.stringify({ ok, data? |
//     error? }) — MCP tool results are strings to the LLM (D-04).
//   - Service layer is called directly (Pattern 1, no HTTP self-call).

import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type {
  ServerNotification,
  ServerRequest,
} from "@modelcontextprotocol/sdk/types.js";
import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { z } from "zod";

import { log } from "@/lib/log";
import { resolveSession, verifyBearer } from "@/lib/mcp/auth";
import {
  cancelReservation,
  createReservation,
  extendWait,
  getReservationStatus,
} from "@/lib/services/reservations";

// D-02: create_reservation accepts diner identity fields. Zod object
// with .passthrough() so LLM-fabricated extra fields (notes, allergens,
// time-of-day) are silently ignored, not rejected (Pitfall #9).
// Numerics coerced (LLM may pass "4" as a string).
const createReservationSchema = z
  .object({
    name: z.string().min(1),
    email: z.string().email(),
    phone: z.string().min(5),
    party_size: z.coerce.number().int().min(1).max(20),
  })
  .passthrough();

// D-03: action tools accept ZERO LLM-visible identity. Empty object
// with .passthrough() — the LLM may pass arbitrary chit-chat (e.g.
// {reason:"running late"}); we ignore it. Reservation identity comes
// from the X-Reservation-Session header, NEVER from LLM input.
const actionSchema = z.object({}).passthrough();

type ToolExtra = RequestHandlerExtra<ServerRequest, ServerNotification>;

// Pull the X-Reservation-Session header from the tool extra context.
// mcp-handler lowercases headers (Object.fromEntries(req.headers.entries())
// via the underlying Fetch Headers) so we look up the lowercase key first
// and fall back to the canonical Pascal-Case form for safety.
function readSessionHeader(extra: ToolExtra): string | undefined {
  const headers = extra.requestInfo?.headers;
  if (!headers) return undefined;
  const raw =
    headers["x-reservation-session"] ?? headers["X-Reservation-Session"];
  if (Array.isArray(raw)) return raw[0];
  return raw;
}

// Build the structured INVALID_SESSION error response (D-04). Spanish
// SAFE-03-tone empathic message. Same code regardless of WHY the
// session is invalid (missing header, malformed UUID, no row matches)
// to avoid leaking existence (security-by-obscurity matches the auth
// page anti-enum pattern from Phase 1 D-10).
function invalidSessionResponse() {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({
          ok: false,
          error: {
            code: "INVALID_SESSION",
            message:
              "No pudimos verificar tu reserva. Volvé a empezar la conversación.",
          },
        }),
      },
    ],
  };
}

// Wrap any service-layer ServiceResult into the MCP tool content shape.
// Service layer already shapes the {ok, data?, error?} contract (D-04).
function toolResponse(result: unknown) {
  return {
    content: [
      { type: "text" as const, text: JSON.stringify(result) },
    ],
  };
}

const mcpHandler = createMcpHandler(
  (server) => {
    // Tool 1 (D-02): create_reservation — diner identity fields visible
    // to the LLM. Returns reservation_id + session_token; the chatbot
    // (Phase 3) stores session_token in localStorage and sends it back
    // via X-Reservation-Session on subsequent action tool calls.
    server.registerTool(
      "create_reservation",
      {
        title: "Crear reserva",
        description:
          "Registra al comensal en la cola de espera. Pide nombre completo, email, teléfono y cantidad de personas. Devuelve la posición y la ETA estimada.",
        inputSchema: createReservationSchema,
      },
      async (input) => {
        const result = await createReservation(input);
        if (!result.ok) {
          log.warn("mcp.tool.create_reservation.error", {
            code: result.error.code,
          });
        } else {
          log.info("mcp.tool.create_reservation.ok", {
            reservation_id: result.data.reservation_id,
          });
        }
        return toolResponse(result);
      },
    );

    // Tool 2 (D-03): get_reservation_status — read-only status. Empty
    // input schema; reservation resolved from X-Reservation-Session.
    server.registerTool(
      "get_reservation_status",
      {
        title: "Consultar estado de reserva",
        description:
          "Consulta la posición actual, la ETA y el estado de la reserva del comensal (waiting, called, seated, etc.). No requiere parámetros — la reserva se resuelve desde la sesión.",
        inputSchema: actionSchema,
      },
      async (_input, extra: ToolExtra) => {
        const session = readSessionHeader(extra);
        const resolved = await resolveSession(session);
        if (!resolved) return invalidSessionResponse();

        const result = await getReservationStatus({
          sessionToken: resolved.sessionToken,
        });
        log.info("mcp.tool.get_reservation_status.invoked", {
          reservation_id: resolved.reservationId,
          ok: result.ok,
        });
        return toolResponse(result);
      },
    );

    // Tool 3 (D-03): extend_wait — request more time after the maitre
    // calls. Service layer enforces NOT_IN_CALLED_STATE +
    // MAX_EXTENSIONS_REACHED. Empty input schema.
    server.registerTool(
      "extend_wait",
      {
        title: "Pedir más tiempo",
        description:
          "Pide una extensión cuando el maître ya llamó al comensal pero todavía está en camino. Solo válido en estado 'called'. No requiere parámetros — la reserva se resuelve desde la sesión.",
        inputSchema: actionSchema,
      },
      async (_input, extra: ToolExtra) => {
        const session = readSessionHeader(extra);
        const resolved = await resolveSession(session);
        if (!resolved) return invalidSessionResponse();

        const result = await extendWait({
          sessionToken: resolved.sessionToken,
        });
        log.info("mcp.tool.extend_wait.invoked", {
          reservation_id: resolved.reservationId,
          ok: result.ok,
        });
        return toolResponse(result);
      },
    );

    // Tool 4 (D-03): cancel_reservation — cancellation in waiting OR
    // called states. Service layer enforces NOT_IN_WAITING_OR_CALLED_STATE
    // for closed reservations. Empty input schema.
    server.registerTool(
      "cancel_reservation",
      {
        title: "Cancelar reserva",
        description:
          "Cancela la reserva del comensal. Válido si la reserva está en estado 'waiting' o 'called'. No requiere parámetros — la reserva se resuelve desde la sesión.",
        inputSchema: actionSchema,
      },
      async (_input, extra: ToolExtra) => {
        const session = readSessionHeader(extra);
        const resolved = await resolveSession(session);
        if (!resolved) return invalidSessionResponse();

        const result = await cancelReservation({
          sessionToken: resolved.sessionToken,
        });
        log.info("mcp.tool.cancel_reservation.invoked", {
          reservation_id: resolved.reservationId,
          ok: result.ok,
        });
        return toolResponse(result);
      },
    );
  },
  {
    serverInfo: { name: "zero-to-agent-mcp", version: "0.1.0" },
  },
  {
    basePath: "/mcp",
    maxDuration: 60,
    verboseLogs: process.env.NODE_ENV !== "production",
  },
);

// D-01: gate the WHOLE handler with bearer auth. required:true → any
// request without a valid Bearer header gets 401 with a
// WWW-Authenticate hint pointing at the resource metadata endpoint.
const authHandler = withMcpAuth(mcpHandler, verifyBearer, { required: true });

// D-07: GET = POST = DELETE = authHandler. mcp-handler routes the three
// methods internally based on the streamable-HTTP transport spec.
export const GET = authHandler;
export const POST = authHandler;
export const DELETE = authHandler;
