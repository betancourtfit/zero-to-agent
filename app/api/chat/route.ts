// Diner chatbot API route handler (D-02, D-03).
// Receives a stream of UIMessages from the @ai-sdk/react useChat client and
// returns a streaming response with the LLM's replies + tool results.
//
// Discipline (ARCHITECTURE commitments):
//   - Service-layer funnel: tools call lib/services/* DIRECTLY (D-03, D-36).
//     NEVER experimental_createMCPClient, NEVER fetch("/mcp/...", ...).
//   - sessionToken resolved from X-Reservation-Session header ONLY (D-02).
//     NEVER from request body or LLM tool inputSchema (Pitfall #5).
//   - All logs via lib/log.ts — raw console.* forbidden (D-24, SAFE-01).
//   - Tool execute logs tool NAME + ok/error_code only — NEVER args (D-25).
//   - convertToModelMessages is ASYNC in v6 — must await (spike footgun #1).
//   - stopWhen: stepCountIs(5) prevents infinite tool loop (Pitfall #8).
//   - experimental_telemetry disables input/output recording to protect PII (D-23).

import { streamText, tool, stepCountIs, convertToModelMessages, type UIMessage } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { z } from "zod";

// OpenAI-compatible provider — configure via env vars:
//   OPENAI_BASE_URL  e.g. https://api.openai.com/v1 or https://api.anthropic.com/v1
//   OPENAI_API_KEY   your API key for that provider
//   CHAT_MODEL       model ID (default: gpt-4o-mini)
const openai = createOpenAI({
  baseURL: process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
  apiKey: process.env.OPENAI_API_KEY ?? "",
});
const CHAT_MODEL = process.env.CHAT_MODEL ?? "gpt-4o-mini";

import {
  createReservation,
  getReservationStatus,
  extendWait,
  cancelReservation,
} from "@/lib/services/reservations";
import { log } from "@/lib/log";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

// D-04: Locked Spanish system prompt — 6 rules (5 D-04 + 1 D-09 returning-diner rule).
// Must contain: "Confirmás", "NUNCA", "Solo te puedo ayudar", "número exacto", "cola de hoy"
const SYSTEM_PROMPT = `Sos el host del restaurante. Ayudás a los comensales a anotarse en la cola, consultar su lugar, pedir más tiempo o cancelar. Hablás en español rioplatense, amable y empático.

ANTES de llamar register_diner, repetí los datos que recolectaste y pedí confirmación: "Confirmás: Juan, juan@example.com, +5491122334455, 4 personas?". Solo llamás al tool si el comensal confirma con sí/dale/correcto.

NUNCA digas "estás registrado/llamado/cancelado" sin que el tool haya devuelto ok: true con reservation_id. Si el tool devuelve ok: false, explicale el error.message en español y NO reintentes el mismo tool.

Si te preguntan algo que no es la cola del restaurante, respondé: "Solo te puedo ayudar con la cola del restaurante. ¿Querés anotarte o consultar tu reserva?"

Si el comensal dice "somos 4 o 5" o "tal vez un bebé", pedí precisión: "Para anotarte necesito un número exacto. ¿Son 4 o 5 personas?"

Esta es una cola de espera para ahora, no reservas para mañana. Si te piden "reservar para mañana a las 8", explicales: "Manejamos solo la cola de hoy. ¿Querés anotarte ahora?"

Si el usuario ya tiene una reserva activa, NO le pidas datos de nuevo. Saludá brevemente y ofrecé ayuda con su reserva existente.`;

export async function POST(req: Request) {
  const { messages }: { messages: UIMessage[] } = await req.json();

  // sessionToken resolved server-side from header — NEVER from body or LLM input (D-02, Pitfall #5)
  const sessionToken = req.headers.get("X-Reservation-Session");

  const result = streamText({
    model: openai.chat(CHAT_MODEL), // .chat() forces /v1/chat/completions — openai() alone uses /v1/responses in SDK v3
    system: SYSTEM_PROMPT,
    messages: await convertToModelMessages(messages), // v6: async — MUST await (spike footgun #1)
    temperature: 0.2, // Reduces variance on Spanish ambiguous inputs (Pitfall #21)
    stopWhen: stepCountIs(5), // Prevents infinite tool loop (Pitfall #8 — vercel/ai #7502)
    experimental_telemetry: {
      isEnabled: true,
      recordInputs: false, // D-23 — no PII in observability spans
      recordOutputs: false,
      metadata: { redacted: true },
    },
    tools: {
      register_diner: tool({
        description: "Anotar a un comensal nuevo en la cola de espera del restaurante.",
        inputSchema: z
          .object({
            name: z.string().min(1),
            email: z.string().email(),
            phone: z.string().min(5),
            party_size: z.coerce.number().int().min(1).max(20), // coerce: LLMs send strings (Pitfall #9)
          })
          .passthrough(), // passthrough: LLMs add extra fields — must not reject (Pitfall #9)
        execute: async (input) => {
          log.info("chat.tool.invoked", { tool: "register_diner" }); // name only — no PII args (D-25)
          const result = await createReservation(input);
          log.info("chat.tool.completed", {
            tool: "register_diner",
            ok: result.ok,
            error_code: result.ok ? undefined : result.error.code,
          });
          return result; // ServiceResult<{reservation_id, session_token, position, eta_min}> flows to client as part.output
        },
      }),

      get_my_status: tool({
        description: "Consultar estado, posición y ETA estimada de la reserva del comensal.",
        inputSchema: z.object({}).passthrough(), // D-03: ZERO LLM-visible identity params
        execute: async () => {
          log.info("chat.tool.invoked", { tool: "get_my_status" });
          if (!sessionToken) {
            const result = {
              ok: false as const,
              error: {
                code: "INVALID_SESSION" as const,
                message: "No encontré tu reserva. ¿Querés anotarte de nuevo?",
              },
            };
            log.info("chat.tool.completed", { tool: "get_my_status", ok: false, error_code: "INVALID_SESSION" });
            return result;
          }
          const result = await getReservationStatus({ sessionToken });
          log.info("chat.tool.completed", {
            tool: "get_my_status",
            ok: result.ok,
            error_code: result.ok ? undefined : result.error.code,
          });
          return result;
        },
      }),

      extend_my_wait: tool({
        description: "Pedir más tiempo en la cola (extensión).",
        inputSchema: z.object({}).passthrough(), // D-03: ZERO LLM-visible identity params
        execute: async () => {
          log.info("chat.tool.invoked", { tool: "extend_my_wait" });
          if (!sessionToken) {
            const result = {
              ok: false as const,
              error: {
                code: "INVALID_SESSION" as const,
                message: "No encontré tu reserva.",
              },
            };
            log.info("chat.tool.completed", { tool: "extend_my_wait", ok: false, error_code: "INVALID_SESSION" });
            return result;
          }
          const result = await extendWait({ sessionToken });
          log.info("chat.tool.completed", {
            tool: "extend_my_wait",
            ok: result.ok,
            error_code: result.ok ? undefined : result.error.code,
          });
          return result;
        },
      }),

      cancel_my_reservation: tool({
        description: "Cancelar la reserva del comensal.",
        inputSchema: z.object({}).passthrough(), // D-03: ZERO LLM-visible identity params
        execute: async () => {
          log.info("chat.tool.invoked", { tool: "cancel_my_reservation" });
          if (!sessionToken) {
            const result = {
              ok: false as const,
              error: {
                code: "INVALID_SESSION" as const,
                message: "No encontré tu reserva.",
              },
            };
            log.info("chat.tool.completed", { tool: "cancel_my_reservation", ok: false, error_code: "INVALID_SESSION" });
            return result;
          }
          const result = await cancelReservation({ sessionToken });
          log.info("chat.tool.completed", {
            tool: "cancel_my_reservation",
            ok: result.ok,
            error_code: result.ok ? undefined : result.error.code,
          });
          return result;
        },
      }),
    },

    onStepFinish: async ({ toolResults }) => {
      log.info("chat.step.finished", { tool_results: toolResults.length });
    },
  });

  return result.toUIMessageStreamResponse(); // v6 method name — verbatim
}
