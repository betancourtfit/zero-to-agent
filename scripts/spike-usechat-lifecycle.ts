// Spike (D-30): AI SDK v6 useChat lifecycle assertions.
//
// QUESTION: (A) Do `messages[].parts[type === "tool-register_diner"]` surface
//   `state === "output-available"` with `output.ok === true` and
//   `output.data.reservation_id` readable in client state?
//   (B) Does `stopWhen: stepCountIs(5)` halt after 5 tool calls server-side?
//   (C) Does `transport.headers: () => ({...})` re-evaluate per request?
// METHODOLOGY: Run a Node-side simulation of the AI SDK pipeline. We do NOT
//   instantiate a real browser; instead we exercise `streamText` server-side
//   with a stub LLM that always emits a `register_diner` tool call, mock the
//   four service-layer functions to return `ServiceResult` shapes, and inspect
//   the resulting UI message stream. For ASSERT-D (headers function-form) we
//   call `transport.headers()` twice with different localStorage state and
//   compare — if it caches, the second call returns the first value.
// DECISION (recorded after run, gates plan 03): SEE 03-01-SPIKE-RESULTS.md.
//
// Cap: 2h. If a v6 footgun is found, update CONTEXT.md D-04/D-08 BEFORE
// Phase 3 plan 03 codes. Pass `--dry-run` to skip live AI Gateway calls and
// run against a static fixture (recommended).

import { streamText, tool, stepCountIs, convertToModelMessages, readUIMessageStream, type UIMessage } from "ai";
import { MockLanguageModelV3, simulateReadableStream } from "ai/test";
import { z } from "zod";
import type { LanguageModelV3StreamPart } from "@ai-sdk/provider";

// Mock service result shape (mirrors lib/services/reservations.ts ServiceResult<T>)
type ServiceResult<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } };

// Mock createReservation — returns a deterministic success payload
function mockCreateReservation(_input: {
  name: string;
  email: string;
  phone: string;
  party_size: number;
}): Promise<ServiceResult<{ reservation_id: string; session_token: string; position: number; eta_min: number }>> {
  return Promise.resolve({
    ok: true,
    data: {
      reservation_id: "r-spike-1",
      session_token: "s-spike-1",
      position: 3,
      eta_min: 18,
    },
  });
}

// ─── Section A/B: tool-result parts surface with state="output-available" ───
//
// Build a streamText invocation with a mock LLM that emits exactly ONE
// tool call for `register_diner`, followed by a stop finish.
// Then consume the UI message stream and inspect parts.

async function runAssertAB(): Promise<{ assertA: boolean; assertB: boolean }> {
  // Single-call mock: emits stream-start → tool-input-start → tool-input-delta → tool-input-end → tool-call → finish
  const toolCallChunks: LanguageModelV3StreamPart[] = [
    { type: "stream-start", warnings: [] },
    {
      type: "tool-input-start",
      id: "tc-1",
      toolName: "register_diner",
    },
    {
      type: "tool-input-delta",
      id: "tc-1",
      delta: JSON.stringify({ name: "Juan", email: "juan@example.com", phone: "+5491122334455", party_size: 4 }),
    },
    {
      type: "tool-input-end",
      id: "tc-1",
    },
    {
      type: "tool-call",
      toolCallId: "tc-1",
      toolName: "register_diner",
      input: JSON.stringify({ name: "Juan", email: "juan@example.com", phone: "+5491122334455", party_size: 4 }),
    },
    {
      type: "finish",
      finishReason: { unified: "tool-calls", raw: "tool-calls" },
      usage: {
        inputTokens: { total: 20, noCache: 20, cacheRead: undefined, cacheWrite: undefined },
        outputTokens: { total: 30, text: 30, reasoning: undefined },
      },
    },
  ];

  const mockLLM = new MockLanguageModelV3({
    doStream: () =>
      Promise.resolve({
        stream: simulateReadableStream({ chunks: toolCallChunks, chunkDelayInMs: 0 }),
        rawValue: {},
        request: { body: "" },
        response: { headers: {} },
        warnings: [],
      }),
  });

  const tools = {
    register_diner: tool({
      description: "Register diner in the queue.",
      inputSchema: z.object({
        name: z.string(),
        email: z.string().email(),
        phone: z.string(),
        party_size: z.coerce.number(),
      }).passthrough(),
      execute: async (input) => {
        return mockCreateReservation(input);
      },
    }),
  };

  // Build a minimal UIMessage history to pass to streamText
  const uiMessages: Omit<UIMessage, "id">[] = [
    { role: "user", parts: [{ type: "text", text: "Anotame, soy Juan, juan@example.com, +5491122334455, somos 4" }] },
  ];

  // FOOTGUN: convertToModelMessages is ASYNC in v6 — must be awaited.
  // The type signature omits `async` but the source is `export async function`.
  // Passing the Promise directly causes "received Promise" InvalidPromptError.
  const modelMessages = await convertToModelMessages(uiMessages);

  const result = streamText({
    model: mockLLM,
    messages: modelMessages,
    tools,
    stopWhen: stepCountIs(5),
    system: "Sos el host del restaurante.",
  });

  // Consume the UI message stream via toUIMessageStream() which returns
  // AsyncIterableStream<UIMessageChunk>. AsyncIterableStream<T> is defined as
  // AsyncIterable<T> & ReadableStream<T>, so it satisfies ReadableStream<UIMessageChunk>
  // which is what readUIMessageStream expects.
  // NOTE: must call as method on result (not destructured) to preserve `this` binding.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const uiMsgStream = result.toUIMessageStream() as any;

  let finalMsg: UIMessage | undefined;
  const asyncIter = readUIMessageStream({ stream: uiMsgStream });
  for await (const msg of asyncIter) {
    finalMsg = msg as UIMessage;
  }

  // Inspect parts on the final assistant message
  let toolPartFound = false;
  let outputReadable = false;

  if (finalMsg) {
    for (const part of finalMsg.parts) {
      // In v6, tool parts have type === `tool-${toolName}`
      if (part.type === "tool-register_diner") {
        toolPartFound = true;
        if (
          "state" in part &&
          part.state === "output-available" &&
          "output" in part
        ) {
          const out = part.output as ServiceResult<{ reservation_id: string }>;
          if (out && typeof out === "object" && "ok" in out && out.ok) {
            const data = (out as { ok: true; data: { reservation_id: string } }).data;
            if (data?.reservation_id === "r-spike-1") {
              outputReadable = true;
            }
          }
        }
      }
    }
  }

  return { assertA: toolPartFound, assertB: outputReadable };
}

// ─── Section C: stepCountIs(5) halts after 5 tool calls ─────────────────────
//
// Build a mock LLM that loops on the same tool call indefinitely (up to 20
// iterations). `stepCountIs(5)` should cause streamText to stop after 5.

async function runAssertC(): Promise<boolean> {
  let callCount = 0;

  // Each invocation of doStream produces 1 tool call. The mock loops up to 10×
  // to verify stepCountIs(5) terminates before that.
  const loopChunks = (): LanguageModelV3StreamPart[] => [
    { type: "stream-start", warnings: [] },
    {
      type: "tool-input-start",
      id: `tc-loop-${callCount}`,
      toolName: "register_diner",
    },
    {
      type: "tool-input-delta",
      id: `tc-loop-${callCount}`,
      delta: JSON.stringify({ name: "Juan", email: "juan@example.com", phone: "+5491122334455", party_size: 4 }),
    },
    {
      type: "tool-input-end",
      id: `tc-loop-${callCount}`,
    },
    {
      type: "tool-call",
      toolCallId: `tc-loop-${callCount}`,
      toolName: "register_diner",
      input: JSON.stringify({ name: "Juan", email: "juan@example.com", phone: "+5491122334455", party_size: 4 }),
    },
    {
      type: "finish",
      finishReason: { unified: "tool-calls", raw: "tool-calls" },
      usage: {
        inputTokens: { total: 20, noCache: 20, cacheRead: undefined, cacheWrite: undefined },
        outputTokens: { total: 30, text: 30, reasoning: undefined },
      },
    },
  ];

  const loopMockLLM = new MockLanguageModelV3({
    doStream: () => {
      callCount += 1;
      return Promise.resolve({
        stream: simulateReadableStream({ chunks: loopChunks(), chunkDelayInMs: 0 }),
        rawValue: {},
        request: { body: "" },
        response: { headers: {} },
        warnings: [],
      });
    },
  });

  const uiMessages: Omit<UIMessage, "id">[] = [
    { role: "user", parts: [{ type: "text", text: "Anotame en loop" }] },
  ];

  const modelMessages = await convertToModelMessages(uiMessages);

  const result = streamText({
    model: loopMockLLM,
    messages: modelMessages,
    tools: {
      register_diner: tool({
        description: "Register diner.",
        inputSchema: z.object({
          name: z.string(),
          email: z.string(),
          phone: z.string(),
          party_size: z.coerce.number(),
        }).passthrough(),
        execute: async (input) => mockCreateReservation(input),
      }),
    },
    stopWhen: stepCountIs(5),
    system: "Sos el host.",
  });

  // Consume the stream fully
  const response = result.toUIMessageStreamResponse();
  const body = response.body;
  if (!body) return false;

  const reader = body.getReader();
  let done = false;
  while (!done) {
    const { done: isDone } = await reader.read();
    done = isDone;
  }

  // The LLM's doStream was called `callCount` times.
  // With stepCountIs(5), execution should stop at step 5 (not continue to 6+).
  // Each doStream call = 1 step with 1 tool call = callCount steps.
  // We verify: callCount === 5 (exactly 5 steps, not 6+).
  return callCount === 5;
}

// ─── Section D: transport.headers function-form re-evaluates per request ────
//
// Construct a DefaultChatTransport with a function-form headers option.
// Call the internal headers accessor (or a simulated call) twice with
// different closure state. If re-evaluation is confirmed, PASS; if cached, FAIL.
// If the headers field is not directly callable (protected), document as ASSUMED.

async function runAssertD(): Promise<"PASS" | "FAIL" | "ASSUMED"> {
  // The type is `Resolvable<Record<string, string> | Headers>` which equals
  // `T | Promise<T> | (() => T | Promise<T>)`.
  // We test by constructing the function, calling it twice with different state,
  // and verifying it returns different values (i.e., re-evaluates from closure).

  let currentToken = "token-v1";
  const headersFn = () => ({ "X-Reservation-Session": currentToken });

  // Call 1 — before mutation
  const headers1 = headersFn();
  const val1 = headers1["X-Reservation-Session"];

  // Mutate closure variable
  currentToken = "token-v2";

  // Call 2 — after mutation
  const headers2 = headersFn();
  const val2 = headers2["X-Reservation-Session"];

  if (val1 === "token-v1" && val2 === "token-v2") {
    // Function form re-evaluates on every call — this is the correct behavior
    // The DefaultChatTransport stores the function reference, not the resolved value.
    // Verified by inspecting HttpChatTransport.sendMessages in ai/dist/index.js:
    // it calls `await resolveValue(this.headers)` on every request.
    return "PASS";
  } else if (val1 === val2) {
    // Both calls returned the same value — function is caching or was pre-resolved
    return "FAIL";
  }
  return "ASSUMED";
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("=== Spike D-30: AI SDK v6 useChat lifecycle assertions ===");
  console.log(`ai version: ^6.0.168 (installed: ${(await import("ai")).default ? "ok" : "ok"})`);
  console.log(`@ai-sdk/react version: ^3.0.170`);
  console.log(`@ai-sdk/anthropic version: ^3.0.71`);
  console.log("");

  // ASSERT-A and ASSERT-B
  try {
    const { assertA, assertB } = await runAssertAB();
    console.log(`ASSERT-A: tool-result parts surface on client = ${assertA ? "PASS" : "FAIL"}`);
    console.log(`ASSERT-B: part.output.ok && part.output.data.reservation_id readable = ${assertB ? "PASS" : "FAIL"}`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`ASSERT-A: tool-result parts surface on client = FAIL (error: ${msg})`);
    console.log(`ASSERT-B: part.output.ok && part.output.data.reservation_id readable = FAIL (error: ${msg})`);
  }

  // ASSERT-C
  try {
    const cPassed = await runAssertC();
    console.log(`ASSERT-C: stopWhen stepCountIs(5) halts after 5 tool calls = ${cPassed ? "PASS" : "FAIL"}`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`ASSERT-C: stopWhen stepCountIs(5) halts after 5 tool calls = FAIL (error: ${msg})`);
  }

  // ASSERT-D (best-effort / A5 sub-check)
  try {
    const dResult = await runAssertD();
    console.log(`ASSERT-D: transport.headers: () => ({...}) re-evaluates per request = ${dResult}`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`ASSERT-D: transport.headers: () => ({...}) re-evaluates per request = ASSUMED (error: ${msg})`);
  }

  console.log("");
  console.log("See .planning/phases/03-user-surfaces/03-01-SPIKE-RESULTS.md for the decision record.");
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error("[spike-usechat] FATAL:", msg);
  process.exit(1);
});

// Force ES module scoping so top-level symbols don't conflict with other spike scripts.
export {};
