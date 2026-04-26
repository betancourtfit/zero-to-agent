# 03-01 Spike Results — AI SDK v6 useChat Lifecycle

**Date:** 2026-04-26
**Spike:** D-30 — AI SDK v6 useChat lifecycle assertions
**Cap:** 2h (completed well within)
**Runner:** scripts/spike-usechat-lifecycle.ts

---

## Package Versions Installed

| Package | Version |
|---------|---------|
| `ai` | ^6.0.168 |
| `@ai-sdk/react` | ^3.0.170 |
| `@ai-sdk/anthropic` | ^3.0.71 |

Note: `@ai-sdk/react` and `@ai-sdk/anthropic` are versioned independently from `ai`. The dist-tag `ai-v6` on `@ai-sdk/react` points to `3.0.134`; `latest` is `3.0.170`. These are fully compatible with `ai@6`.

---

## Assertion Results

```
ASSERT-A: tool-result parts surface on client = PASS
ASSERT-B: part.output.ok && part.output.data.reservation_id readable = PASS
ASSERT-C: stopWhen stepCountIs(5) halts after 5 tool calls = PASS
ASSERT-D: transport.headers: () => ({...}) re-evaluates per request = PASS
```

### ASSERT-A — Tool-result parts surface on client (PASS)

After consuming `result.toUIMessageStream()` via `readUIMessageStream()`, the final
`UIMessage` contains parts of type `"tool-register_diner"` with `state === "output-available"`.
The part shape is `{ type: "tool-${toolName}", state: "output-available", output: <execute() return value> }`.

This confirms D-08's localStorage hydration path: the client can iterate `messages[].parts`
and find the tool part by type to extract `session_token` and `reservation_id`.

### ASSERT-B — `part.output.data.reservation_id` readable (PASS)

When `execute()` returns `{ ok: true, data: { reservation_id: "r-spike-1", ... } }`, the
`part.output` field on the client carries the exact object returned by `execute()`.
The chain `part.output.ok && part.output.data.reservation_id` works as described in D-08.

### ASSERT-C — `stopWhen: stepCountIs(5)` halts after 5 steps (PASS)

A loop mock LLM that emits one tool call per `doStream()` invocation was used. With
`stopWhen: stepCountIs(5)`, `streamText` called `doStream` exactly 5 times (verified by
counter) and stopped. The stream was not infinite. This confirms Pitfall #8 mitigation
(vercel/ai #7502) is effective in v6.

### ASSERT-D — `transport.headers: () => ({})` re-evaluates per request (PASS)

`Resolvable<T>` in `HttpChatTransportInitOptions` is defined as
`T | Promise<T> | (() => T | Promise<T>)`. The `DefaultChatTransport` calls
`resolveValue(this.headers)` on every `sendMessages()` invocation, not once at
construction. A closure variable mutated between two calls returned different values,
confirming the function form re-evaluates on every request.

This confirms D-02's pattern for `X-Reservation-Session` header: the chatbot client can
use `transport: new DefaultChatTransport({ api: "/api/chat", headers: () => ({ "X-Reservation-Session": localStorage.getItem("restaurant_queue:session_token") ?? "" }) })` and the header will always reflect the current localStorage value, even after `register_diner` writes it.

---

## Footgun Found — `convertToModelMessages` is ASYNC in v6

**Severity:** HIGH — causes silent breakage (no TypeScript error at compile time)

The type signature in `ai/dist/index.d.ts` declares:
```typescript
declare function convertToModelMessages<UI_MESSAGE extends UIMessage>(messages: Array<Omit<UI_MESSAGE, 'id'>>, options?: {...}): ...
```

However the source at `ai/src/ui/convert-to-model-messages.ts` is:
```typescript
export async function convertToModelMessages<UI_MESSAGE extends UIMessage>(
```

The `.d.ts` omits `async`, so TypeScript does NOT complain when you call it synchronously.
At runtime, passing the returned `Promise` directly to `streamText({ messages })` causes:

```
InvalidPromptError: Invalid prompt: The messages do not match the ModelMessage[] schema.
  cause: "Invalid input: expected array, received Promise"
```

**Fix for plan 03:** In `app/api/chat/route.ts`, always `await convertToModelMessages(uiMessages)` before passing to `streamText`. The CONTEXT.md D-02 description already says "convertToModelMessages is now ASYNC in v6 (await required)" — this is confirmed.

---

## Assumption Log Updates

| Assumption | Status | Outcome |
|------------|--------|---------|
| A1 (tool-result parts surface on client with state=output-available) | RESOLVED | PASS — part.type === `tool-${toolName}`, state === "output-available", output carries execute() return value |
| A5 (transport.headers function-form re-evaluates per request) | RESOLVED | PASS — Resolvable<T> = () => T is re-called on every sendMessages() invocation |

---

## Impact on Plan 03 (chatbot route + page)

| Area | Impact |
|------|--------|
| `/api/chat` route | MUST `await convertToModelMessages(uiMessages)` — see Footgun above |
| D-08 localStorage hydration | CONFIRMED — iterate `messages[].parts`, find `type === "tool-register_diner"` with `state === "output-available"`, read `part.output.ok && part.output.data` |
| `stopWhen: stepCountIs(5)` | CONFIRMED — effective against infinite loops (Pitfall #8) |
| `DefaultChatTransport headers` fn | CONFIRMED — re-evaluates per request; pattern in D-02 works as described |
| CONTEXT.md D-04 | NO UPDATE NEEDED — all 5 rules validated as structurally sound |
| CONTEXT.md D-08 | NO UPDATE NEEDED — localStorage hydration path confirmed |

---

## DECISION: PROCEED-UNCHANGED

All three D-30 questions answered PASS. The footgun (`await convertToModelMessages`) is
already noted in CONTEXT.md D-02 from research. No CONTEXT.md edits required before plan 03.

Plan 03 (chatbot route + page) can proceed with the existing CONTEXT.md D-04 and D-08
definitions unchanged.

---

## Fixture Validation

The 10-conversation SAFE-02 fixture (`__tests__/chatbot-conversations.fixture.json`) was
committed alongside this spike. Shape asserter passes:

```
# tests 10
# pass 10
# fail 0
```

All 5 D-04 rules have at least one fixture case. `npm run test:fixtures` is CI-ready.
