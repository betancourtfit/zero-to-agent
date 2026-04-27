---
phase: 03-user-surfaces
plan: "03"
subsystem: chatbot
tags:
  - chatbot
  - ai-sdk-v6
  - useChat
  - streamText
  - diner
  - safe-02
  - safe-03
  - diner-01
  - diner-08
dependency_graph:
  requires:
    - "03-01 (AI SDK v6 spike — PROCEED-UNCHANGED decision, convertToModelMessages MUST await)"
    - "03-02 (useReservationEvents hook + 6 shadcn primitives)"
    - "02-03 (service layer — createReservation/getReservationStatus/extendWait/cancelReservation)"
    - "02-06 (SSE endpoint /api/events/[reservation_id])"
  provides:
    - "POST /api/chat — streamText route with 4 tool wrappers around lib/services/reservations.ts"
    - "GET /api/me — PII-safe diner status projection (session_token → position/status/eta_min only)"
    - "5 chat components in components/chat/ (thread, composer, status-card, push-banner, quick-reply-chips)"
    - "Full diner chatbot at / — Server Component shell + DinerChat client island"
    - "D-04 6-rule Spanish system prompt with all SAFE-02 rules"
    - "SAFE-03 locked no_show copy on push-banner"
  affects:
    - "03-04-panel (can now run in parallel — disjoint files)"
    - "03-05-reopen (depends on service layer already in place)"
tech_stack:
  added:
    - "components/chat/diner-chat-island.tsx — useChat + DefaultChatTransport client island"
    - "components/chat/chat-thread.tsx, chat-composer.tsx, status-card.tsx, push-banner.tsx, quick-reply-chips.tsx"
    - "app/api/chat/route.ts — streamText + 4 inline tool wrappers"
    - "app/api/me/route.ts — PII-safe GET endpoint"
    - "__tests__/chat-tools.test.ts — 9 tests for tool schema + log discipline"
  patterns:
    - "Service-layer funnel: tools call lib/services/* DIRECTLY (no experimental_createMCPClient, no HTTP self-call)"
    - "sessionToken resolved from X-Reservation-Session header only (never from body or LLM input)"
    - "Tool part confirmation badge: rendered ONLY from part.output.ok && part.output.data.reservation_id (Pitfall #16)"
    - "D-09 hydration: localStorage read → /api/me validate → clear if closed/invalid → SSE attach"
    - "D-08 localStorage persist: from useEffect after stream ends, NOT during streaming (Pitfall #10)"
    - "Synthetic greeting on first mount (sendMessage({text:'hola'})) to avoid blank chat"
    - "push-banner 5-state machine: null/called/followup/seated/no_show/cancelled"
    - "SAFE-03 locked no_show copy verbatim per REQUIREMENTS.md"
key_files:
  created:
    - "app/api/chat/route.ts (173 LOC)"
    - "app/api/me/route.ts (60 LOC)"
    - "components/chat/chat-thread.tsx"
    - "components/chat/chat-composer.tsx"
    - "components/chat/status-card.tsx"
    - "components/chat/push-banner.tsx"
    - "components/chat/quick-reply-chips.tsx"
    - "components/chat/diner-chat-island.tsx"
    - "__tests__/chat-tools.test.ts"
  modified:
    - "app/page.tsx (replaced Phase 1 placeholder with Server Component shell)"
    - "scripts/spike-usechat-lifecycle.ts (Rule 1 fix: MockLanguageModelV3 API shapes updated)"
    - "__tests__/chatbot-conversations.test.ts (Rule 1 fix: expected_tool_calls cast to string[])"
decisions:
  - "transport.headers function form confirmed PASS (ASSERT-D from spike 03-01) — used as-is in DinerChat island"
  - "Synthetic sendMessage({text:'hola'}) on mount chosen over static greeting bubble — LLM greeting is more dynamic and exercises the full pipeline"
  - "experimental_createMCPClient NOT used — D-03/D-36 direct service-layer calls enforced by comment fence and acceptance grep"
  - "Rule 1 auto-fix: MockLanguageModelV3 response/finishReason/usage shapes updated after AI SDK upgrade changed LanguageModelV3FinishReason from string union to {unified, raw} object and LanguageModelV3Usage from flat numbers to nested objects"
metrics:
  duration: "~30 minutes"
  completed: "2026-04-27"
  tasks_completed: 4
  files_created: 9
  files_modified: 3
---

# Phase 3 Plan 03: Chatbot Diner Surface Summary

**One-liner:** Full diner chatbot at `/` — `/api/chat` streamText route with 4 service-layer tools, `/api/me` PII-safe projection, 5 chat components, DinerChat client island with D-09 hydration + D-08 localStorage persistence + 5-state push banner + SAFE-03 no_show copy.

---

## What Was Built

### Task 1: `app/api/chat/route.ts` (TDD — RED then GREEN)

173 LOC POST handler using `streamText` from `ai`:
- Model `anthropic/claude-sonnet-4.6` (DOT), `temperature: 0.2`, `stopWhen: stepCountIs(5)` (Pitfall #8)
- `experimental_telemetry: { isEnabled: true, recordInputs: false, recordOutputs: false }` (D-23)
- 4 tools with `.passthrough()` schemas: `register_diner` (coerce party_size), `get_my_status`, `extend_my_wait`, `cancel_my_reservation` (zero LLM identity params)
- `sessionToken` from `X-Reservation-Session` header only (never from body — D-02, Pitfall #5)
- D-04 6-rule Spanish system prompt with all 5 required keywords: "Confirmás", "NUNCA", "Solo te puedo ayudar", "número exacto", "cola de hoy" + Rule 6 returning-diner
- All logs via `lib/log.ts` with tool name + ok/error_code only (D-24, D-25 — no PII args)
- Returns `result.toUIMessageStreamResponse()` (v6 method name)

`__tests__/chat-tools.test.ts` — 9 tests covering:
- Schema rejects missing `name`; accepts extra fields via `.passthrough()`
- `party_size: "4"` coerced to number 4
- Action tool schemas accept zero-param + extra LLM fields
- Missing sessionToken returns `INVALID_SESSION`
- `register_diner.execute` calls `createReservation` and returns ServiceResult
- Log calls contain only tool name + ok, never PII args

### Task 2: `app/api/me/route.ts`

60 LOC GET-only endpoint:
- `session_token` from query param; 400 if missing
- `INVALID_SESSION` → 401; other errors → 404
- Defense-in-depth re-projection: only `reservation_id`, `status`, `position`, `eta_min`, `extension_count`, `no_show_deadline`, `called_at` — `name`/`email`/`phone` intentionally omitted (D-10)
- All logs via `lib/log.ts`

### Task 3: 5 chat components under `components/chat/`

- `chat-thread.tsx`: renders `UIMessage[]` parts; text bubbles (user right/assistant left); `tool-register_diner` badge ONLY from `part.output.ok && part.output.data.reservation_id` (Pitfall #16)
- `chat-composer.tsx`: sticky-bottom input + Enviar button; `min-h-[44px]`; `aria-label="Mensaje para el chatbot"`;  `aria-disabled` on status != "ready"
- `status-card.tsx`: renders TU RESERVA with position/ETA/status; null when snapshot is null; extension badge when extension_count > 0
- `push-banner.tsx`: 5-state machine with `role="status"` and `aria-live="assertive"`: hidden (waiting) → TU MESA ESTÁ LISTA (called) → ¿Estás en camino? + children (followup) → Bienvenido (seated) → SAFE-03 locked no_show copy → cancelada copy; each terminal state has "Anotarme de nuevo" button calling `onClearSession`
- `quick-reply-chips.tsx`: "Pedir más tiempo" → `onChip("dame 5 más")` + localStorage lastIntent; "Cancelar" → `onChip("no voy a ir")` + localStorage lastIntent (D-06 belt-and-suspenders)

### Task 4: `app/page.tsx` (Server Component) + `components/chat/diner-chat-island.tsx`

**`app/page.tsx`:** Server Component, reads `colors_by_party_size` from Edge Config server-side (single fetch), passes to `<DinerChat />`. No `"use client"`.

**`diner-chat-island.tsx`:** Client island with:
- `useChat({ transport: new DefaultChatTransport({ api: "/api/chat", headers: () => ({...}) }) })` — function form re-evaluates per request (ASSERT-D PASS)
- D-09 hydration: on mount reads `restaurant_queue:session_token` + `restaurant_queue:reservation_id`; if present calls `/api/me` to validate; clears localStorage if `seated`/`no_show`/`cancelled` or `INVALID_SESSION`
- D-08 localStorage persist: in `useEffect` watching `messages`, writes `SK_TOKEN` + `SK_RID` from `tool-register_diner` part with `state === "output-available"` and `out.ok === true` — never during streaming (Pitfall #10)
- `useReservationEvents({ reservationId, sessionToken })` — SSE attach once IDs are known
- Network error banner when `error` from useChat (D-07)
- Synthetic `sendMessage({ text: "hola" })` on first mount (hydrated + no session + no messages) to avoid blank chat
- `clearSession()` removes all 3 localStorage keys + `window.location.reload()`

---

## Transport.headers Function Form Outcome (Spike A5 re-evaluation)

**PASS — function form used as-is.** ASSERT-D confirmed in plan 03-01: `Resolvable<T>` function form is called on every `sendMessages()` invocation. The `headers: () => ({ ...(sessionToken ? { "X-Reservation-Session": sessionToken } : {}) })` pattern in `DinerChat` correctly picks up the latest `sessionToken` state on every request — no second-arg headers workaround needed.

## Synthetic LLM Greeting

**Used `sendMessage({text:'hola'})` on mount.** The static greeting bubble alternative was rejected because (a) it would show a hardcoded string rather than the LLM's actual Spanish response, (b) it doesn't exercise the full pipeline during the demo, (c) the synthetic message approach is cleaner — the LLM greeting triggers the real `/api/chat` endpoint and the user sees the chatbot actually working from the first interaction.

---

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `MockLanguageModelV3` API shapes changed with SDK upgrade**
- **Found during:** Task 4 verification — `npm run build` TypeScript check
- **Issue:** `LanguageModelV3FinishReason` changed from a string union (`"tool-calls"`) to an object `{ unified: "tool-calls", raw: "tool-calls" }`. `LanguageModelV3Usage` changed from flat `{ inputTokens: number, outputTokens: number }` to nested objects. `LanguageModelV3StreamResult.response` changed from `{ id, timestamp, modelId }` to `{ headers }`. These changes caused 5 TypeScript errors in `scripts/spike-usechat-lifecycle.ts`.
- **Fix:** Updated both `doStream` mock implementations in the spike script to use the current API shapes.
- **Files modified:** `scripts/spike-usechat-lifecycle.ts`
- **Commit:** `c8b5f3b`

**2. [Rule 1 - Bug] `expected_tool_calls` typed as `never[]` in fixture test**
- **Found during:** Task 4 verification — `npm run build` TypeScript check
- **Issue:** TypeScript infers `[]` in a JSON import as `never[]`. The `includes("register_diner")` call on `never[]` fails the type check.
- **Fix:** Cast `happy.expected_tool_calls` to `string[]` before calling `.includes()`.
- **Files modified:** `__tests__/chatbot-conversations.test.ts`
- **Commit:** `c8b5f3b`

---

## Known Stubs

None — all components wire to real Phase 2 service layer and SSE endpoints. The `partyColor` calculation in `DinerChat` uses a hardcoded `"1-2"` key as a fallback (the diner snapshot doesn't carry `party_size`) — this is intentional and documented in the plan. The Edge Config palette is real and already seeded from Phase 1.

---

## Threat Flags

No new threat flags. All T-03-03-01 through T-03-03-09 threats from the plan's STRIDE register are mitigated as implemented:
- T-03-03-01 (tool poisoning): action tools use `z.object({}).passthrough()` — zero LLM identity params
- T-03-03-02 (fake confirmation): badge renders only from `part.output.ok && part.output.data.reservation_id`
- T-03-03-03 (infinite loop): `stopWhen: stepCountIs(5)` confirmed working (ASSERT-C PASS)
- T-03-03-04 (PII in telemetry): `recordInputs: false, recordOutputs: false` + D-25 log discipline
- T-03-03-05 (PII in /api/me): defense-in-depth re-projection verified by grep (0 matches for name/email/phone)
- T-03-03-09 (cookie-during-streaming): no cookies anywhere; localStorage written from useEffect post-stream

---

## Production Deploy

Push to `origin main` completed at task 4 commit `c8b5f3b`. Auto-deploy to `https://zero-to-agent-xi.vercel.app` triggered. Route table confirms `/api/chat` and `/api/me` as dynamic (ƒ) routes.

---

## Manual Smoke (Task 5 — Checkpoint)

Task 5 is a `type="checkpoint:human-verify"` — manual end-to-end smoke against production. Scenarios 1-9 (registration → called push → followup → extend → cancel → off-topic → ambiguous → PII log check → network error) must be verified by the user before plan 04 (maître panel) is approved to proceed.

---

## Self-Check: PASSED

- [x] `app/api/chat/route.ts` exists (173 LOC)
- [x] `app/api/me/route.ts` exists (60 LOC)
- [x] `components/chat/chat-thread.tsx` exists
- [x] `components/chat/chat-composer.tsx` exists
- [x] `components/chat/status-card.tsx` exists
- [x] `components/chat/push-banner.tsx` exists
- [x] `components/chat/quick-reply-chips.tsx` exists
- [x] `components/chat/diner-chat-island.tsx` exists
- [x] `app/page.tsx` is a Server Component (no `"use client"`)
- [x] `__tests__/chat-tools.test.ts` exists — 9 tests pass
- [x] `__tests__/chatbot-conversations.test.ts` — 10 tests pass
- [x] `npm run build` exits 0
- [x] Commits `ddf0d37`, `6813465`, `1bdc1ed`, `774fb9a`, `c8b5f3b` verified in git log
- [x] `git push origin main` completed — production deploy triggered
