# Phase 3: User Surfaces — Research

**Researched:** 2026-04-26
**Domain:** Diner chatbot embed (AI SDK v6 + `useChat` + `streamText`) + maître panel (RSC + SSE EventSource + shadcn) + DurableAgent ETA wrapper
**Confidence:** HIGH on AI SDK v6 lifecycle, EventSource patterns, shadcn integration; **MEDIUM-HIGH** on DurableAgent placement (one finding contradicts CONTEXT.md D-20 — see Critical Finding §0).

---

## Summary

Phase 3 ships three surfaces — a Spanish full-page chatbot at `/`, a maître panel at `/queue`, and a maître history table at `/queue/history` — plus a `recompute_eta` step body swap to wrap the deterministic formula in `@workflow/ai/agent`. CONTEXT.md (D-01 through D-31) locks every architectural decision; this research is **NOT** about choosing alternatives. It's about surfacing the concrete 2026-04 API surfaces, syntax footguns, and one structural contradiction the planner needs to resolve before the first plan task lands.

**Primary recommendation (planner):**

1. Open Phase 3 with a **2-hour AI SDK v6 `useChat` lifecycle spike** (D-30) — confirm tool-result part shape on client (`tool-${name}` typed part with `state: "output-available"` and `part.output`), assert `stopWhen: stepCountIs(5)` halts the server stream, validate dynamic `transport.headers` for `X-Reservation-Session`. THIS is the foundation for D-08 localStorage hydration.
2. **CRITICAL — re-decide D-20 before any workflow file edit.** The Workflow SDK docs verify that `DurableAgent` is **constructed at the `"use workflow"` router level, not inside a `"use step"`** ([cited: workflow-sdk.dev/docs/api-reference/workflow-ai/durable-agent](https://workflow-sdk.dev/docs/api-reference/workflow-ai/durable-agent)). The `recompute_eta` step BODY cannot host a `new DurableAgent({...})` without violating either the framework rule (agent at router) OR the freeze rule (D-11: workflow router shape FROZEN). See Critical Finding §0 for the three resolution paths.
3. Everything else (chatbot UI, panel, history, SSE hooks, `/api/chat` route, `/api/me`, `/api/queue/history`, `/api/queue/[id]/reopen`, migration `0003_reopen_count.sql`) is mechanical from the verified snippets in this document. The 19 requirements fall out cleanly.

[VERIFIED: package.json] `@workflow/ai` is **NOT yet installed** (only `workflow@^4.2.4`). D-29 listed `ai@^6 + @ai-sdk/react@^6 + @ai-sdk/anthropic@^2`; the planner must add `@workflow/ai@^4.1.2` (or `^5.0.0-beta.2` if Phase 3 wants the beta) IF the team chooses any DurableAgent-bearing path in §0 below.

---

## User Constraints (from CONTEXT.md)

### Locked Decisions

> Phase 3 plans MUST honor every decision verbatim. Re-research is forbidden — these are constraints, not options.

**Chatbot UX shape, push delivery, `/api/chat` (D-01..D-07):**
- D-01: Chatbot is FULL-PAGE at `/`; replaces Phase 1 placeholder. Mobile-first, single-column, `max-w-md`, sticky composer. NO floating widget.
- D-02: `/api/chat` `POST` only; `runtime="nodejs"`, `maxDuration=60`, `dynamic="force-dynamic"`. `streamText({model: "anthropic/claude-sonnet-4.6", messages: convertToModelMessages(uiMessages), tools, system, stopWhen: stepCountIs(5), temperature: 0.2})`. Returns `result.toUIMessageStreamResponse()`. Reads `X-Reservation-Session` header; NEVER puts `session_token` in `system` or in tool inputSchema.
- D-03: 4 tools defined inline using `tool({inputSchema, execute})` from `ai`; each `execute` is a 5–15 LOC wrapper around `lib/services/*` DIRECTLY. **Never** `experimental_createMCPClient`, **never** HTTP self-call to `/mcp/mcp`. Tools that act on existing reservation accept ZERO LLM-visible identity params; `reservation_id`/`session_token` resolved server-side from `X-Reservation-Session` header. Schemas: `.passthrough()` (NOT `.strict()`), `z.coerce.number()` on numerics, `safeParse` not `parse`.
- D-04: System prompt is short and rigid Spanish. 5 LOCKED rules: (1) echo-back-before-confirm, (2) never fabricate confirmation (only after `ok:true` with `reservation_id`), (3) refuse off-topic, (4) clarify ambiguous Spanish inputs, (5) no future booking. ≤800 tokens. Validated against ≥10 fixture conversations BEFORE merging.
- D-05: SINGLE sticky banner ABOVE chat thread; state machine: hidden (waiting) → "TU MESA ESTÁ LISTA" (called) → "¿Estás en camino?" + chips (followup_proactive) → "Bienvenido" (seated) → empathic copy + "Anotarme de nuevo" (cancelled / no_show). Banner background from `colors_by_party_size` Edge Config palette. `aria-live="assertive"`.
- D-06: Quick-reply chips in horizontal scroll row under banner; visible only in `called`/`followup_proactive`. Chips POST natural-language messages into chat (`sendMessage({text: "dame 5 más"})`), NOT direct tool calls. Belt-and-suspenders: chip click also writes `lastIntent` to localStorage.
- D-07: Tool errors render as chatbot messages (LLM speaks `error.message`), NOT toasts. Network-level `/api/chat` failure shows banner above composer (NOT in chat thread).

**Diner state persistence + return UX (D-08..D-11):**
- D-08: localStorage holds `restaurant_queue:session_token` + `restaurant_queue:reservation_id`, written ONLY after successful `register_diner` from `useChat`'s tool-result lifecycle hook (`messages[].parts[type==="tool-${name}"]` with `state==="output-available"`). NEVER set during streaming response. NEVER as cookie.
- D-09: On every page mount of `/`: read localStorage → if absent, render welcome state. If present, call `/api/me?session_token=<token>` → if `seated/no_show/cancelled` or `INVALID_SESSION`, clear localStorage + render welcome. If `waiting/called`, render persistent status card + open SSE. Chat history NOT persisted across reloads (status card + SSE banner ARE the persistent affordances).
- D-10: `/api/me` is GET only; `runtime="nodejs"`, `maxDuration=10`, `dynamic="force-dynamic"`. Reads `?session_token=<uuid>`. Wraps `getReservationStatus({session_token})`. PII-safe projection: only `position`, `eta_min`, `status`, `extension_count`, `called_at`, `no_show_deadline` (NEVER `name`/`email`/`phone`). `lib/log.ts` redacts session_token in logs.
- D-11: NO cookie work in Phase 3. localStorage only.

**Maître panel layout, real-time updates, history, undo (D-12..D-19):**
- D-12: TWO routes (NOT a toggle). `/queue` (active: waiting/called) + `/queue/history` (closed: seated/no_show/cancelled). Both auth-gated by `proxy.ts`. Both re-validate `employees.active=true` server-side.
- D-13: `/queue` is `grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3` card grid. Action buttons depend on status: `[Llamar]` for `waiting`, `[Marcar presentado]` for `called` (the OPPOSITE button is ABSENT — not just disabled — see UI-SPEC).
- D-14: STAFF-04 color treatment is LEFT-BORDER (`border-l-4`) + party-size badge. Background stays `bg-card`. Edge Config palette `{"1-2":"#A8E6CF","3-4":"#FFD3B6","5-6":"#FFAAA5","7+":"#D5AAFF"}` already seeded in Phase 1. Live edits take effect on next page load — IS scenario 5 of the demo.
- D-15: WAIT-FOR-SERVER on actions, NO optimistic UI. POST → button loading → SSE confirms state transition. Connection-state dot in nav: green=connected, yellow=reconnecting (<3 attempts), red=failed (≥3 attempts; user must refresh).
- D-16: STAFF-09 SHIPS in Phase 3. New endpoint `POST /api/queue/[id]/reopen`; new service `reopenNoShow(id)` (5th export of `lib/services/queue.ts`). Validates current `status==='no_show'` → `start(reservationWorkflow, [{reservationId}])` (NEW workflow run; original already terminated) → `UPDATE` row to `waiting`, clear `ended_at`+`no_show_deadline`, increment `reopen_count`. Migration `0003_reopen_count.sql` adds `reopen_count INTEGER NOT NULL DEFAULT 0`. Forward-only, no backfill.
- D-17: `/queue/history` is a TABLE (not cards). Day-scoped filter `DATE(created_at AT TIME ZONE 'America/Argentina/Buenos_Aires') = CURRENT_DATE`. Sorted `ended_at DESC`. Polls every 30s; NO SSE.
- D-18: Reabrir confirms via shadcn `AlertDialog`; Llamar/Marcar presentado do NOT confirm.
- D-19: Empty/loading/error states copy locked. shadcn `Skeleton` for loading. shadcn `Sonner` for action error toasts (position bottom-right, 5s duration).

**DurableAgent ETA scope (D-20..D-22):**
- D-20: Phase 3 ships deterministic formula INSIDE `@workflow/ai/agent` wrapper. Step BODY change only (D-11 freeze rule). **⚠️ See Critical Finding §0 — this is structurally inverted vs the Workflow SDK's documented placement model.**
- D-21: LLM-tuned ETA is a 4h-capped spike (NOT a Phase 3 commitment). Compare against deterministic across 20 historical reservations; ship LLM-tuned only if visibly closer AND <$0.01 per recompute.
- D-22: `recompute_eta` step body MUST stay deterministic-on-replay. `temperature: 0` on the agent's LLM if used. Sample-once-and-store: agent runs ONCE per step invocation; `eta_min` persisted on row.

**AI SDK ↔ PII redactor wiring (D-23..D-25):**
- D-23: `experimental_telemetry: { isEnabled: true, recordInputs: false, recordOutputs: false, metadata: { redacted: true } }` in `streamText`.
- D-24: Tool-call lifecycle hooks (`onStepFinish`, `onFinish`) MUST log via `log.info(...)` (NOT raw `console.*`). CI grep enforces.
- D-25: Server-side log of chat route excludes tool args (PII). Log tool NAME and tool RESULT shape (`{ ok: true|false, error_code? }`) only.

**Spanish copy guidelines (D-26..D-27):** Rioplatense, vos, friendly+empathic+recoverable for diner; brief+operational for maître. Full copy table in UI-SPEC §"Copywriting Contract".

**Wiring contract (D-28..D-31):**
- D-28: NEW files Phase 3 ships: `app/page.tsx` (replaces Phase 1 placeholder), `app/api/chat/route.ts`, `app/api/me/route.ts`, `app/api/queue/history/route.ts`, `app/api/queue/[id]/reopen/route.ts`, `app/queue/page.tsx` (replaces stub), `app/queue/history/page.tsx`, `components/chat/{chat-thread,chat-composer,status-card,push-banner,quick-reply-chips}.tsx`, `components/queue/{queue-card,queue-grid,connection-dot,nav-bar,history-table,reopen-dialog}.tsx`, `lib/hooks/{use-reservation-events,use-queue-events}.ts`, `db/migrations/0003_reopen_count.sql`, `__tests__/chatbot-conversations.fixture.json`, ADD 5th export to `lib/services/queue.ts → reopenNoShow(id)`.
- D-29: NEW deps: `ai@^6` + `@ai-sdk/react@^6` + `@ai-sdk/anthropic@^2`. NO additional UI deps. NO test framework switch (keep `node:test` via `tsx`). **Add: `@workflow/ai@^4.1.2`** if any DurableAgent path is taken.
- D-30: AI SDK v6 `useChat` lifecycle spike is FIRST plan-phase task. 2h cap. Validates: (a) tool-result parts arrive on client, (b) `result.ok && result.data.reservation_id` readable from client state, (c) `stopWhen: stepCountIs(5)` actually halts after 5 tool calls.
- D-31: Push-to-prod-every-phase preserved. Each plan deploys via `git push origin main`. Maître panel rebuild lands as single atomic commit per plan.

### Claude's Discretion

> Phase 3 plan-phase / executor agents have flexibility on:

- Exact file boundaries inside `components/chat/` and `components/queue/` (collapse `quick-reply-chips.tsx` into `push-banner.tsx`; split `queue-card.tsx` into header/body/actions). Default: keep separate components.
- Exact v0 prompts used to scaffold components (treat outputs as starting points).
- Whether the diner status card lives in `app/page.tsx` directly or as separate `<StatusCard />` (default: separate).
- Toast library (default: shadcn `Sonner`).
- Polling interval for `/queue/history` (default: 30s).
- Connection-dot color thresholds (default: green / yellow / red at 3-attempt threshold).
- Whether `/queue` empty state shows static illustration or just text (default: text).
- Whether STAFF-09 confirm dialog is `AlertDialog` or custom inline (default: `AlertDialog`).
- LLM "thinking" verbosity (default: minimal, action-driven).
- Whether `experimental_telemetry` is enabled at all (default: enabled per D-23).
- Final wording of all Spanish copy (must align D-26 tone; reviewable by user before final demo).
- Whether `useChat` message-history truncation is implemented (default: defer; conversations short).
- Whether chatbot greets returning diner by name (default: NO; PII-on-page concern).

### Deferred Ideas (OUT OF SCOPE for Phase 3)

> Do NOT propose, do NOT plan, do NOT touch:

- Rate limiting (5 req/min on `create_reservation`) — Phase 4
- Idempotency dedup key (email+party_size+30s window) — Phase 4
- `/api/health` + Slack/Discord webhook — Phase 4
- Final PII audit of production logs — Phase 4
- Demo video recording (DEMO-03) — Phase 4
- README polish — Phase 4
- WhatsApp adapter — post-hackathon
- Multi-tenant scoping, i18n, ratings, payments, table assignment — out of scope per PROJECT.md
- Greeting returning diner by name — Phase 4 polish if visible value
- Server-side message-history truncation — defer
- Custom Tracer for AI SDK telemetry that wraps every span attribute — v2
- Multi-day filter / date picker on `/queue/history` — v2 (STAFF-11)
- Analytics dashboard (STAFF-10) — v2
- Web push / service workers (PLAT-10) — out of scope
- Floating-widget chatbot embed — v2
- Persisting chat history across reloads — v2
- LLM-tuned ETA agent (full intelligence beyond formula) — capped 4h spike WITHIN Phase 3 (D-21); ships only if dry-run wins
- ESLint custom rule for raw `console.*` — Phase 4 polish
- Multi-restaurant rebrand via Edge Config — v2

---

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| DINER-01 | Comensal can register via chatbot at `/` (name/email/phone/party_size) | §"Standard Stack" `streamText` + `tool()` for `register_diner` wrapping `lib/services/reservations.ts → createReservation`. UI-SPEC §"Surface 1: Diner Chatbot". CONTEXT D-01..D-04. |
| DINER-02 | Comensal receives confirmation with `reservation_id`, position, ETA | §"Code Examples — register_diner tool" returns the service result. §"Code Examples — confirmation badge" reads `part.output.ok && part.output.data.reservation_id` from `messages[].parts[type==="tool-register_diner"][state==="output-available"]`. CONTEXT D-03 + Pitfall #16 mitigation. |
| DINER-03 | Comensal receives push "TU MESA ESTÁ LISTA" within 2s of maître clicking Llamar | §"EventSource Patterns" + Phase 2 SSE handler at `/api/events/[reservation_id]`. UI-SPEC banner state machine. CONTEXT D-05. |
| DINER-04 | Comensal receives followup "¿Estás en camino?" 1 min after called | Phase 2 workflow already publishes `followup_proactive` event from `:called:pre` token expiry. SSE consumer (`use-reservation-events.ts`) renders banner mutation. CONTEXT D-05. |
| DINER-05 | Comensal can extend in natural language ("dame 5 más") | LLM maps phrase → `extend_my_wait` tool → `lib/services/reservations.ts → extendWait(sessionToken)`. CONTEXT D-03. |
| DINER-06 | Comensal can cancel in natural language ("no voy a ir") | LLM maps phrase → `cancel_my_reservation` → `cancelReservation(sessionToken)`. CONTEXT D-03. |
| DINER-07 | Comensal can query status ("¿cómo voy?") | LLM maps phrase → `get_my_status` → `getReservationStatus(sessionToken)`. CONTEXT D-03. |
| DINER-08 | If no response by `no_show_deadline`, system marks `no_show` automatically + empathic Spanish | Workflow already auto-no-shows in Phase 2. SAFE-03 copy in UI-SPEC. SSE delivers `no_show` event → push banner mutates per CONTEXT D-05. |
| STAFF-02 | Maître sees active queue at `/queue` chronologically | Server Component reads `getActiveQueue()` from `lib/services/queue.ts`. CONTEXT D-12 + D-13. |
| STAFF-03 | Each card shows name/party_size/arrival/wait/status/ETA/extension badge | UI-SPEC §"Surface 2: Maître Panel — Queue card anatomy". |
| STAFF-04 | Cards color-coded by party_size from Edge Config | `lib/edge-config/index.ts → getTypedConfig("colors_by_party_size", default)` + inline `style={{borderLeftColor: partyColor}}`. CONTEXT D-14. |
| STAFF-05 | Maître Llamar dispatches `call` event + diner push | POST `/api/queue/[id]/call` (Phase 2 endpoint, unchanged) → `markCalled(id)` → publishes `reservation:<id>` channel → diner SSE delivers. CONTEXT D-15. |
| STAFF-06 | Maître Marcar presentado closes `seated` | POST `/api/queue/[id]/seated` (Phase 2 endpoint, unchanged) → `markSeated(id)`. CONTEXT D-15. |
| STAFF-07 | Panel updates in real time via SSE w/ snapshot-replay | Phase 2 `/api/events/queue` endpoint already implements Pattern 3. Phase 3 adds `lib/hooks/use-queue-events.ts` consumer. |
| STAFF-08 | `/queue/history` shows day's closed reservations | NEW `app/queue/history/page.tsx` + `app/api/queue/history/route.ts`. Polls every 30s. CONTEXT D-12 + D-17. |
| STAFF-09 | Maître can undo `no_show` (Reabrir) | NEW `app/api/queue/[id]/reopen/route.ts` + new `lib/services/queue.ts → reopenNoShow(id)` + migration `0003_reopen_count.sql`. AlertDialog confirm. CONTEXT D-16 + D-18. |
| PLAT-08 | DurableAgent ETA via `@workflow/ai/agent` | **⚠️ Critical Finding §0 — see resolution paths.** CONTEXT D-20..D-22. |
| SAFE-02 | System prompt rules: echo-back, never-fabricate, refuse off-topic, clarify ambiguous Spanish | CONTEXT D-04 (5 locked rules). Validated by 10-conversation fixture (D-30 spike artifact). |
| SAFE-03 | Empathic recoverable Spanish copy on `no_show` and tool errors | UI-SPEC §"Copywriting Contract" + CONTEXT D-26. |

---

## Critical Finding §0 — DurableAgent Placement vs Workflow Freeze

**THIS BLOCKS PLANNING UNTIL RESOLVED.**

CONTEXT.md D-20 and D-22 instruct: *"Phase 3 swaps the BODY of the `recompute_eta` step body in `lib/workflows/reservation.ts` to wrap the deterministic computation inside the `DurableAgent` constructor… Inside step body — NEVER at router level."*

**[VERIFIED: workflow-sdk.dev/docs/api-reference/workflow-ai/durable-agent]** The current Workflow SDK documentation states:

> *"DurableAgent cannot be instantiated inside a `"use step"` function — it operates at the workflow level for durable execution and state management."*
>
> *"Move the agent logic into a separate function, which will serve as our workflow definition."*
>
> The constructor accepts `model`, `instructions`, `temperature?`, `tools`, `toolChoice?`, `maxOutputTokens?`, `topP?`. The `stream()` method takes `{ messages, writable, ... }` and returns `{ messages, steps, toolCalls, toolResults, ... }`.

**The contradiction:** D-20 says "agent inside step BODY"; the framework says "agent at workflow router level (`use workflow`)". Either reading is structurally unsafe in Phase 3:

| Path | What changes | Risk | Verdict |
|------|--------------|------|---------|
| **A. Agent at router level** | `lib/workflows/reservation.ts` router body adds `new DurableAgent(...)` + `agent.stream(...)` for ETA | Violates D-11 freeze (router shape changes); breaks in-flight reservations across deploy | ❌ Hard no |
| **B. Agent inside `recompute_eta` step body** | The current step body wraps `new DurableAgent(...)` | Violates the framework rule; may throw at runtime OR silently break replay determinism (Pitfall #1) | ❌ Hard no |
| **C. Use plain `generateText` from `ai` SDK inside step** | Step body imports `import { generateText } from "ai"` (NOT `@workflow/ai/agent`); calls LLM as a one-shot completion with `temperature: 0`; persists `eta_min` once | Stays inside step; deterministic-on-replay because step output is sampled-once-and-stored (D-22); preserves Track 2 narrative ("ETA estimated by LLM") at the cost of NOT using the literal `@workflow/ai/agent` package | ✅ **Recommended primary** |
| **D. Keep formula; skip LLM entirely** | Step body unchanged from Phase 2 | Track 2 narrative "DurableAgent" is technically false but `position * avg_turnover_min` is the demo scope's stated fallback. PROJECT cut list #1 explicitly endorses this. | ✅ Acceptable cut |
| **E. Add a NEW step at end of workflow router that runs the agent** | Append-safe per D-11 freeze rules; gated behind Edge Config feature flag | Existing in-flight reservations skip the new step; new reservations exercise it. Agent still can't live AT router level — would need to be its own workflow function called via `start(...)` | ⚠️ Possible but adds 4-8h scope; conflicts with 2h cap on D-21 spike |

**Planner action:** Open Phase 3 plan-phase by:

1. Re-reading the freeze rules in `lib/workflows/_README.md` and the framework constraint above.
2. Choosing **Path C (recommended)** OR **Path D (cut)** for PLAT-08. Both honor freeze, both preserve replay determinism, both fit Phase 3 budget.
3. Updating CONTEXT.md D-20 / D-22 to reflect the chosen path BEFORE the implementation plan lands.
4. Noting in `lib/workflows/_README.md` "Shape History" that the step body change happened on this date with this rationale.

If the team wants the literal `@workflow/ai/agent` package in production for the Track 2 narrative, that's Path E — a 2nd phase item beyond Phase 3 budget OR the end-of-workflow append-safe addition, NOT a step-body swap.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|--------------|----------------|-----------|
| Diner chatbot UI (chat thread, composer, banner, status card) | Browser / Client | Frontend Server (RSC shell) | `useChat` is a client-only hook (uses fetch streaming + state). RSC shell renders header + initial frame. |
| Diner localStorage hydration + `/api/me` call | Browser / Client | API / Backend (`/api/me` GET) | localStorage lives in browser; `/api/me` projects PII-safe data. |
| Diner SSE consumption (`use-reservation-events.ts`) | Browser / Client | API / Backend (`/api/events/[id]`) | EventSource is a browser API. Server endpoint already shipped Phase 2. |
| `/api/chat` LLM streaming + tool calls | API / Backend | — | `streamText` + service-layer calls live in Node Route Handler. |
| Maître panel queue grid render | Frontend Server (RSC) | Browser / Client (SSE updates) | Initial SSR snapshot via `getActiveQueue()`; client island handles SSE + actions. |
| Maître action endpoints (Llamar / Marcar / Reabrir) | API / Backend | Database (Postgres) + KV (Upstash) | Phase 2 endpoints unchanged for call/seated; NEW `/reopen` endpoint. |
| Maître history table | Frontend Server (RSC) | API / Backend (`/api/queue/history` polling) | Read-once SSR + client-side 30s polling. NO SSE. |
| `recompute_eta` agent wrapper | Database (workflow runtime, persists step output) | API / Backend (LLM call inside step) | Agent inside `"use step"` (Path C above); LLM returns `eta_min` as plain JSON; persisted via `UPDATE reservations`. |
| Edge Config reads (party-size colors) | Frontend Server (RSC) + API / Backend (workflow steps) | — | `colors_by_party_size` read at panel page render time + at workflow step time. |
| PII redaction wrapper (AI SDK telemetry) | API / Backend (`/api/chat` route, `/api/me`) | — | `lib/log.ts → redactPII` applied to every log line; `experimental_telemetry: { recordInputs: false, recordOutputs: false }`. |

---

## Standard Stack

### Core (already installed in package.json — VERIFIED)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `next` | `16.2.4` | App framework, hosting target | [VERIFIED: package.json] Phase 1 lock. App Router, `proxy.ts` instead of `middleware.ts`. |
| `react` | `19.2.4` | UI runtime | [VERIFIED: package.json] |
| `workflow` | `^4.2.4` | Durable workflows (untouched in Phase 3 except `recompute_eta` body) | [VERIFIED: package.json] FROZEN per D-11. |
| `mcp-handler` | `^1.1.0` | Public MCP server (untouched in Phase 3 — chat calls services directly per D-03) | [VERIFIED: package.json] |
| `@neondatabase/serverless` | `^1.1.0` | Postgres HTTP client for `getActiveQueue`, `/api/queue/history`, `reopenNoShow` | [VERIFIED: package.json] |
| `@upstash/redis` | `^1.37.0` | KV pub/sub (read-only in SSE handlers — already shipped Phase 2) | [VERIFIED: package.json] |
| `@vercel/edge-config` | `^1.4.3` | `colors_by_party_size` lookup on panel page render | [VERIFIED: package.json] |
| `next-auth` | `^5.0.0-beta.31` | Maître session for `/queue` + `/queue/history` + `/api/queue/[id]/reopen` (Phase 1 unchanged) | [VERIFIED: package.json] |
| `zod` | `^4.3.6` | Tool inputSchema with `.passthrough()` + `safeParse` per D-03 | [VERIFIED: package.json] |
| `shadcn` (CLI) | `^4.5.0` | Component scaffolding | [VERIFIED: package.json] base-nova / neutral / Tailwind v4. |
| `@base-ui/react` | `^1.4.1` | Underlying primitives for shadcn base-nova style | [VERIFIED: package.json] |
| `lucide-react` | `^1.11.0` | Icon library (per `components.json`) | [VERIFIED: components.json] |
| `tailwindcss` | `^4` | Styling | [VERIFIED: package.json] |

### NEW dependencies Phase 3 adds (CONTEXT D-29 + Critical Finding §0)

| Library | Version | Purpose | Verification |
|---------|---------|---------|---------------|
| `ai` | `^6` | `streamText`, `tool`, `convertToModelMessages`, `stepCountIs` | [VERIFIED: ai-sdk.dev/docs/ai-sdk-ui/chatbot] Current latest stable line. |
| `@ai-sdk/react` | `^6` | `useChat` hook, `DefaultChatTransport` | [VERIFIED: ai-sdk.dev/docs/reference/ai-sdk-ui/use-chat] |
| `@ai-sdk/anthropic` | `^2` | (Optional — only needed if BYO Anthropic key; Vercel AI Gateway routes via string model id `"anthropic/claude-sonnet-4.6"` reads `AI_GATEWAY_API_KEY` directly) | [CITED: vercel.com/ai-gateway/models/claude-sonnet-4.6] |
| `@workflow/ai` | `^4.1.2` (or `^5.0.0-beta.2`) | DurableAgent (ONLY if Path C is rejected and team takes Path E) | [VERIFIED: npm view @workflow/ai] Latest stable 4.1.2 (published 1 week ago, 2026-04). Beta 5.0.0-beta.2 also available. |

**Version verification (run before plan starts):**

```bash
npm view ai version          # expect ^6.x
npm view @ai-sdk/react version
npm view @ai-sdk/anthropic version
npm view @workflow/ai version  # 4.1.2 confirmed 2026-04-26
```

[VERIFIED: npm registry, 2026-04-26] `@workflow/ai@4.1.2` published "a week ago" by GitHub Actions; deps include `@ai-sdk/provider: ^3.0.0` + `@workflow/serde: ^4.1.1` + `zod@4.3.6` (matches our zod). `5.0.0-beta.2` is the AI SDK v6 forward-compat beta — verify compatibility with our `workflow@^4.2.4` before using.

### shadcn components to install

[VERIFIED: components.json + UI-SPEC §"Component Inventory"]

```bash
npx shadcn@latest add card badge skeleton alert-dialog sonner tabs
# Drop from D-29 list: dialog (alert-dialog covers the only modal), dropdown-menu (not needed in Phase 3)
```

Already installed: `button`, `input` (Phase 1).

### Alternatives Considered (rejected per CONTEXT)

| Instead of | Could Use | Why we DON'T |
|------------|-----------|---------------|
| `streamText` + inline `tool()` calls to `lib/services/*` | `experimental_createMCPClient` round-trip from `/api/chat` to `/mcp/mcp` | Phase 2 D-36 + ARCHITECTURE Anti-Pattern 1 explicitly forbid. Doubles serverless invocations, breaks connection pool, creates auth round-trip. |
| Pre-set cookie before stream / 24h cookie hydration | Cookie-during-streaming | Phase 0.5 cut, Pitfall #10 locked. localStorage only. |
| `cookies()` for diner session | localStorage | Same as above. |
| `experimental_createMCPClient` from `@ai-sdk/mcp` | Direct service-layer calls | D-03 + D-36 locked. |
| AI SDK's `Agent` class | `streamText` + manual tool wiring | `streamText` is the documented chatbot path; `Agent` is for autonomous loops. Not a fit for a conversational chatbot per [CITED: ai-sdk.dev/docs/ai-sdk-ui/chatbot]. |
| Polling `/api/queue` for live updates | SSE via `/api/events/queue` | Already shipped Phase 2; polling violates STAFF-07 "real time". |
| WebSocket | SSE | SSE is one-way (server → client) and trivial in Vercel Functions. WebSocket needs separate infra. |

---

## Architecture Patterns

### System Architecture Diagram

```
                                          ┌─────────────────────────┐
                                          │     DINER (browser)     │
                                          │       /  (chatbot)      │
                                          └──┬──────────────────────┘
                                             │
              ┌──────────────────────────────┼──────────────────────────────┐
              │                              │                               │
              │  POST /api/chat (streaming)  │  GET /api/me?session_token=X  │  GET /api/events/[id]?session_token=X (SSE)
              │  (tools call services)       │  (PII-safe projection)        │  (snapshot-replay-on-connect)
              ▼                              ▼                               ▼
   ┌─────────────────────────────────────────────────────────────────────────────────────┐
   │                       Next.js 16 (Vercel Functions, nodejs runtime)                  │
   │                                                                                      │
   │  ┌────────────────┐    ┌─────────────────┐    ┌──────────────┐                      │
   │  │  /api/chat     │    │  /api/me        │    │ /api/events  │                      │
   │  │ POST           │    │ GET             │    │ /[id]/route  │                      │
   │  │ streamText +   │    │ getReservation  │    │ Phase 2:     │                      │
   │  │ 4 inline tools │    │ Status() then   │    │ snapshot →   │                      │
   │  │ wrap services  │    │ project minimal │    │ replay →     │                      │
   │  │ stopWhen=5     │    │ columns         │    │ subscribe    │                      │
   │  │ temp 0.2       │    │                 │    │ + heartbeat  │                      │
   │  └───────┬────────┘    └─────────┬───────┘    └──────▲───────┘                      │
   │          │                       │                    │                              │
   │          │   tools.execute()     │                    │                              │
   │          ▼                       ▼                    │                              │
   │  ┌─────────────────────────────────────────┐          │                              │
   │  │  lib/services/reservations.ts (4 fns)   │          │                              │
   │  │  - createReservation                     │          │                              │
   │  │  - getReservationStatus                  │          │                              │
   │  │  - extendWait                            │          │                              │
   │  │  - cancelReservation                     │          │                              │
   │  └────────┬────────────────────┬────────────┘          │                              │
   │           │                    │                        │                              │
   │           ▼                    ▼                        │                              │
   │   ┌──────────────┐   ┌────────────────┐                │                              │
   │   │  Postgres    │   │  Upstash Redis │────────────────┘                              │
   │   │  (Neon)      │   │  pub channels  │  KV.subscribe inside SSE handlers             │
   │   │  source of   │   │  reservation:X │                                                │
   │   │  truth       │   │  queue:active  │                                                │
   │   └──────────────┘   └────────────────┘                                                │
   │                                                                                        │
   │   ┌────────────────────────────────────────────────────────────────────────────────┐  │
   │   │   /api/queue/[id]/{call,seated,no_show_manual}/route.ts  (Phase 2, unchanged)  │  │
   │   │   /api/queue/[id]/reopen/route.ts                        (Phase 3 NEW)          │  │
   │   │   /api/queue/route.ts (GET snapshot)                     (Phase 2, unchanged)   │  │
   │   │   /api/queue/history/route.ts                            (Phase 3 NEW, polled)  │  │
   │   └────────────────────────────────────────────────────────────────────────────────┘  │
   │                                                                                        │
   │   lib/workflows/reservation.ts (FROZEN; only `recompute_eta` BODY swap — see §0)       │
   │   lib/edge-config (colors_by_party_size read by panel page)                            │
   │   lib/log.ts (PII redactor — every server log)                                         │
   │   lib/auth/auth.ts (server) + lib/auth/auth.config.ts (proxy.ts edge-safe)             │
   └────────────────────────────────────────────────────────────────────────────────────────┘
                                          ▲
                                          │  POST /api/queue/[id]/{call,seated,reopen}
                                          │  GET /api/queue/history (polling, 30s)
                                          │  GET /api/events/queue (SSE)
                                          │
                                  ┌───────┴──────────┐
                                  │  MAÎTRE          │
                                  │  /queue          │
                                  │  /queue/history  │
                                  └──────────────────┘
```

### Recommended Project Structure (incremental from existing tree)

```
app/
├── page.tsx                           # REPLACES Phase 1 placeholder — chatbot full-page
├── api/
│   ├── chat/
│   │   └── route.ts                   # NEW — streamText + 4 inline tools (D-02..D-04)
│   ├── me/
│   │   └── route.ts                   # NEW — GET reservationStatus, PII-safe projection (D-10)
│   ├── queue/
│   │   ├── route.ts                   # Phase 2, unchanged (GET snapshot)
│   │   ├── [id]/
│   │   │   ├── call/route.ts          # Phase 2, unchanged
│   │   │   ├── seated/route.ts        # Phase 2, unchanged
│   │   │   ├── no_show_manual/route.ts # Phase 2, unchanged
│   │   │   └── reopen/route.ts        # NEW — wraps reopenNoShow(id) (D-16)
│   │   └── history/
│   │       └── route.ts               # NEW — day-scoped closed-reservation list (D-17)
│   └── events/                        # Phase 2, unchanged
├── queue/
│   ├── page.tsx                       # REPLACES Phase 1 stub — Server Component + client island
│   └── history/
│       └── page.tsx                   # NEW (D-12)
components/
├── ui/                                # shadcn — `npx shadcn add card badge skeleton alert-dialog sonner tabs`
├── chat/                              # NEW (D-28)
│   ├── chat-thread.tsx                # message list, alternating bubbles
│   ├── chat-composer.tsx              # sticky-bottom input + send button
│   ├── status-card.tsx                # active-session summary (position / ETA / state)
│   ├── push-banner.tsx                # sticky top, state-machine'd
│   └── quick-reply-chips.tsx          # 2 chips during called/followup states
├── queue/                             # NEW (D-28)
│   ├── queue-card.tsx                 # left-border color band, party badge, action buttons
│   ├── queue-grid.tsx                 # client island wrapper of cards w/ SSE
│   ├── connection-dot.tsx             # 8px dot + label (en vivo / reconectando / sin conexión)
│   ├── nav-bar.tsx                    # h-12 with title + Tabs + dot
│   ├── history-table.tsx              # 6-column table + row hover + Reabrir action
│   └── reopen-dialog.tsx              # AlertDialog wrapper (D-18)
lib/
├── hooks/                             # NEW (D-28)
│   ├── use-reservation-events.ts      # EventSource consumer for diner SSE
│   └── use-queue-events.ts            # EventSource consumer for staff SSE
├── services/                          # Phase 2 — ADD reopenNoShow to queue.ts (5th export)
db/migrations/
└── 0003_reopen_count.sql              # NEW (D-16) — adds reservations.reopen_count
__tests__/
└── chatbot-conversations.fixture.json # NEW (D-30) — 10 weird-real-input cases
```

### Pattern 1: Service-layer funnel (extends Phase 2 ARCHITECTURE Pattern 1)

**What:** Every chatbot tool's `execute` is a 5–15 LOC wrapper around `lib/services/reservations.ts`. Every staff panel button's POST handler is a 5–15 LOC wrapper around `lib/services/queue.ts` (Phase 2's existing 4 endpoints + the NEW `/reopen` endpoint).

**When to use:** Always. The ARCHITECTURE Anti-Pattern 1 ("HTTP self-call from chat to MCP") is explicitly forbidden by D-03 + D-36. Direct service calls inside `tool({execute})` are the way.

**Example (verified):**

```typescript
// app/api/chat/route.ts
// [VERIFIED: ai-sdk.dev/docs/ai-sdk-ui/chatbot + chatbot-tool-usage]
import { streamText, tool, stepCountIs, convertToModelMessages, type UIMessage } from "ai";
import { z } from "zod";
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

const SYSTEM_PROMPT = `Sos el host del restaurante. Ayudás a los comensales a anotarse en la cola, consultar su lugar, pedir más tiempo o cancelar. Hablás en español rioplatense, amable y empático.

ANTES de llamar register_diner, repetí los datos que recolectaste y pedí confirmación: "Confirmás: Juan, juan@example.com, +5491122334455, 4 personas?". Solo llamás al tool si el comensal confirma con sí/dale/correcto.

NUNCA digas "estás registrado/llamado/cancelado" sin que el tool haya devuelto ok: true con reservation_id. Si el tool devuelve ok: false, explicale el error.message en español y NO reintentes el mismo tool.

Si te preguntan algo que no es la cola del restaurante, respondé: "Solo te puedo ayudar con la cola del restaurante. ¿Querés anotarte o consultar tu reserva?"

Si el comensal dice "somos 4 o 5" o "tal vez un bebé", pedí precisión: "Para anotarte necesito un número exacto. ¿Son 4 o 5 personas?"

Esta es una cola de espera para ahora, no reservas para mañana. Si te piden "reservar para mañana a las 8", explicales: "Manejamos solo la cola de hoy. ¿Querés anotarte ahora?"

Si el usuario ya tiene una reserva activa, NO le pidas datos de nuevo. Saludá brevemente y ofrecé ayuda con su reserva existente.`;

export async function POST(req: Request) {
  const { messages }: { messages: UIMessage[] } = await req.json();
  const sessionToken = req.headers.get("X-Reservation-Session"); // NEVER from message body

  const result = streamText({
    model: "anthropic/claude-sonnet-4.6", // DOT not dash (locked)
    system: SYSTEM_PROMPT,
    messages: await convertToModelMessages(messages), // v6: now async!
    temperature: 0.2,
    stopWhen: stepCountIs(5), // [VERIFIED: ai-sdk.dev/docs/ai-sdk-core/agents] mitigates Pitfall #8
    experimental_telemetry: {
      isEnabled: true,
      recordInputs: false, // D-23 — no PII in spans
      recordOutputs: false,
      metadata: { redacted: true },
    },
    tools: {
      register_diner: tool({
        description: "Anotar a un comensal nuevo en la cola.",
        inputSchema: z
          .object({
            name: z.string().min(1),
            email: z.string().email(),
            phone: z.string().min(5),
            party_size: z.coerce.number().int().min(1).max(20),
          })
          .passthrough(), // [VERIFIED: PITFALLS.md #9] LLMs add fields
        execute: async (input) => {
          log.info("chat.tool.invoked", { tool: "register_diner" }); // D-25 — name only, no args
          const result = await createReservation(input);
          log.info("chat.tool.completed", {
            tool: "register_diner",
            ok: result.ok,
            error_code: result.ok ? undefined : result.error.code,
          });
          return result; // {ok, data?, error?} flows back as part.output to client
        },
      }),
      get_my_status: tool({
        description: "Consultar estado, posición y ETA de la reserva del comensal.",
        inputSchema: z.object({}).passthrough(), // D-03: ZERO LLM-visible identity params
        execute: async () => {
          if (!sessionToken) {
            return {
              ok: false,
              error: { code: "INVALID_SESSION", message: "No encontré tu reserva. ¿Querés anotarte de nuevo?" },
            };
          }
          return await getReservationStatus({ sessionToken });
        },
      }),
      extend_my_wait: tool({
        description: "Pedir más tiempo (extensión).",
        inputSchema: z.object({}).passthrough(),
        execute: async () => {
          if (!sessionToken) {
            return { ok: false, error: { code: "INVALID_SESSION", message: "No encontré tu reserva." } };
          }
          return await extendWait({ sessionToken });
        },
      }),
      cancel_my_reservation: tool({
        description: "Cancelar la reserva.",
        inputSchema: z.object({}).passthrough(),
        execute: async () => {
          if (!sessionToken) {
            return { ok: false, error: { code: "INVALID_SESSION", message: "No encontré tu reserva." } };
          }
          return await cancelReservation({ sessionToken });
        },
      }),
    },
    onStepFinish: async ({ toolResults }) => {
      log.info("chat.step.finished", { tool_results: toolResults.length });
    },
  });

  return result.toUIMessageStreamResponse();
}
```

### Pattern 2: AI SDK v6 client lifecycle — tool-result on `messages[].parts`

**What:** In v6, every tool call surfaces as a typed part on the user's most recent assistant message. The part type is `tool-${toolName}` (NOT `tool-call` or `tool-invocation`). The same part transitions through states: `input-streaming` → `input-available` → `output-available` (or `output-error`). On `output-available`, `part.output` is the literal value the server's `execute()` function returned.

**[VERIFIED: ai-sdk.dev/docs/ai-sdk-ui/chatbot-tool-usage]**

**When to use:** D-08 localStorage hydration (the chatbot client component reads `tool-register_diner` parts and persists `reservation_id` + `session_token`). D-03 confirmation badge rendering ("✓ Reserva #abc12345" ONLY when `part.output.ok === true`).

**Example:**

```tsx
// app/page.tsx
"use client"; // entire page is client because useChat is client-only
// [VERIFIED: ai-sdk.dev/docs/ai-sdk-ui/chatbot]
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useEffect, useState } from "react";

export default function ChatPage() {
  // localStorage read on mount (D-09)
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [reservationId, setReservationId] = useState<string | null>(null);

  useEffect(() => {
    const stored = localStorage.getItem("restaurant_queue:session_token");
    setSessionToken(stored);
    setReservationId(localStorage.getItem("restaurant_queue:reservation_id"));
  }, []);

  const { messages, sendMessage, status, error } = useChat({
    transport: new DefaultChatTransport({
      api: "/api/chat",
      // [VERIFIED: docs] dynamic headers are SUPPORTED via function form
      headers: () => ({
        ...(sessionToken ? { "X-Reservation-Session": sessionToken } : {}),
      }),
    }),
  });

  // D-08: persist localStorage on register_diner success
  useEffect(() => {
    for (const m of messages) {
      for (const part of m.parts) {
        // [VERIFIED: ai-sdk.dev] tool part types are `tool-${toolName}`, NOT `tool-call`
        if (
          part.type === "tool-register_diner" &&
          part.state === "output-available" &&
          part.output &&
          typeof part.output === "object" &&
          "ok" in part.output &&
          part.output.ok === true
        ) {
          const data = (part.output as { data: { reservation_id: string; session_token: string } }).data;
          if (!localStorage.getItem("restaurant_queue:session_token")) {
            localStorage.setItem("restaurant_queue:session_token", data.session_token);
            localStorage.setItem("restaurant_queue:reservation_id", data.reservation_id);
            setSessionToken(data.session_token);
            setReservationId(data.reservation_id);
          }
        }
      }
    }
  }, [messages]);

  // ... composer + status card + push banner + chat thread
}
```

**Confidence:** HIGH. The only remaining uncertainty is exact Discriminated-Union typing of `part.output` (it inherits from the tool's `execute` return type via the `tool()` generic). The D-30 spike confirms this against a sandbox tool first.

### Pattern 3: EventSource consumer hook (snapshot-replay-aware)

**What:** Browser `EventSource` reconnects automatically on close, sending the last received `Last-Event-ID` header. The Phase 2 SSE handlers already handle this server-side. Phase 3 client hooks must:

1. Open `EventSource("/api/events/[id]?session_token=X")` only after localStorage has the token (`useEffect` with dependency).
2. Listen for the initial `event: snapshot` (lands BEFORE any data event).
3. Listen for typed events emitted server-side (`reservation.created`, `reservation.called`, `reservation.extended`, `reservation.seated`, `reservation.cancelled`, `reservation.no_show`, plus `followup_proactive`).
4. Track connection state (`connecting → connected → reconnecting → failed`) via the `EventSource.readyState` and a counter of consecutive `error` events. Threshold: 3 attempts → "failed" UI per CONTEXT D-15 + UI-SPEC connection dot color table.
5. Close the EventSource on unmount AND on terminal status (seated/cancelled/no_show).

**[VERIFIED: developer.mozilla.org/en-US/docs/Web/API/EventSource]** Browser sends `Last-Event-ID` automatically when reconnecting if a previous event had `id:` set. The Phase 2 SSE handler already sets `id:` on every event with the row's `last_event_id`. NO manual header-setting needed on the client side.

**Example:**

```typescript
// lib/hooks/use-reservation-events.ts
"use client";
import { useEffect, useState, useRef } from "react";

export type ConnectionState = "connecting" | "connected" | "reconnecting" | "failed";

export interface ReservationSnapshot {
  reservation_id: string;
  status: "waiting" | "called" | "seated" | "no_show" | "cancelled";
  position: number;
  eta_min: number | null;
  extension_count: number;
  no_show_deadline: string | null;
  called_at: string | null;
  last_event_id: number;
}

export function useReservationEvents(opts: {
  reservationId: string | null;
  sessionToken: string | null;
}) {
  const [snapshot, setSnapshot] = useState<ReservationSnapshot | null>(null);
  const [latestEvent, setLatestEvent] = useState<{ type: string; data: unknown } | null>(null);
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const failureCountRef = useRef(0);

  useEffect(() => {
    if (!opts.reservationId || !opts.sessionToken) {
      setConnection("connecting");
      return;
    }

    const url = `/api/events/${opts.reservationId}?session_token=${encodeURIComponent(opts.sessionToken)}`;
    const es = new EventSource(url);

    setConnection("connecting");

    es.addEventListener("open", () => {
      failureCountRef.current = 0;
      setConnection("connected");
    });

    es.addEventListener("snapshot", (e) => {
      const data = JSON.parse((e as MessageEvent).data) as ReservationSnapshot;
      setSnapshot(data);
      // CLOSE eventsource on terminal status (UI-SPEC §banner state machine)
      if (data.status === "seated" || data.status === "no_show" || data.status === "cancelled") {
        es.close();
        setConnection("connected"); // graceful — terminal isn't a failure
      }
    });

    // Phase 2 publishes typed events; we forward each generically. Components
    // mutate banner state from latestEvent.type (UI-SPEC §state machine).
    const TYPED_EVENTS = [
      "reservation.created",
      "reservation.called",
      "reservation.extended",
      "reservation.seated",
      "reservation.cancelled",
      "reservation.no_show",
      "followup_proactive", // emitted by workflow's :called:pre token expiry
    ];
    for (const evt of TYPED_EVENTS) {
      es.addEventListener(evt, (e) => {
        const data = JSON.parse((e as MessageEvent).data);
        setLatestEvent({ type: evt, data });
      });
    }

    es.addEventListener("error", () => {
      failureCountRef.current++;
      // [VERIFIED: MDN EventSource] readyState transitions:
      //   0 = connecting (auto-reconnect in progress)
      //   1 = open (connected — should not see error here)
      //   2 = closed (irrecoverable)
      if (es.readyState === EventSource.CLOSED) {
        setConnection("failed");
        return;
      }
      if (failureCountRef.current >= 3) {
        setConnection("failed");
        es.close();
      } else {
        setConnection("reconnecting");
      }
    });

    return () => {
      es.close();
    };
  }, [opts.reservationId, opts.sessionToken]);

  return { snapshot, latestEvent, connection };
}
```

**Footgun (browser-specific):** `EventSource` does NOT support custom request headers in any browser. Auth must use query params (`?session_token=X`) — and Phase 2 SSE handler already does. Don't try to set `Authorization: Bearer` — it WILL silently fail. [CITED: MDN]

**Reconnect delay:** Browser default is ~3s with no backoff. Acceptable for our scale; do NOT manually retry — that creates duplicate connections.

### Pattern 4: Server-Component-with-client-island for the maître panel

**What:** `app/queue/page.tsx` is a Server Component that:

1. Calls `auth()` for session, redirects to `/login` on miss.
2. Re-validates `employees.active=true` (defense in depth per D-12 + Phase 2 D-29).
3. Calls `getActiveQueue()` directly to render initial card grid SSR.
4. Reads `colors_by_party_size` from Edge Config server-side.
5. Renders a client island `<QueueGrid initial={...} colorsByPartySize={...} />` that subscribes to SSE for live updates.

This avoids a layout shift between SSR and the first SSE snapshot AND avoids exposing `getActiveQueue()` to the browser.

**Example:**

```tsx
// app/queue/page.tsx (Server Component)
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/auth";
import { sql } from "@/lib/db/neon";
import { getActiveQueue } from "@/lib/services/queue";
import { getTypedConfig } from "@/lib/edge-config";
import { QueueGrid } from "@/components/queue/queue-grid";
import { NavBar } from "@/components/queue/nav-bar";

export const dynamic = "force-dynamic";

export default async function QueuePage() {
  const session = await auth();
  if (!session?.user?.email) redirect("/login");

  // D-12 defense-in-depth re-check. Phase 2 D-29 already does this in SSE; mirror here.
  const empRows = (await sql`
    SELECT active FROM employees WHERE email = ${session.user.email} LIMIT 1
  `) as Array<{ active: boolean }>;
  if (!empRows[0]?.active) redirect("/login");

  const initial = await getActiveQueue();
  const colorsByPartySize = await getTypedConfig<Record<string, string>>(
    "colors_by_party_size",
    { "1-2": "#A8E6CF", "3-4": "#FFD3B6", "5-6": "#FFAAA5", "7+": "#D5AAFF" },
  );

  return (
    <>
      <NavBar active="active" />
      <QueueGrid initial={initial} colorsByPartySize={colorsByPartySize} />
    </>
  );
}
```

### Anti-Patterns to Avoid

- **`experimental_createMCPClient` from `/api/chat`** — ARCHITECTURE Anti-Pattern 1 + D-03/D-36. HTTP self-call doubles invocations.
- **Setting cookies in `/api/chat` after stream starts** — Pitfall #10. localStorage only.
- **Treating LLM text as confirmation** — Pitfall #16 + D-04 Rule 2. Confirmation badge reads from `part.output.ok && part.output.data.reservation_id`, NEVER from the LLM's text.
- **Custom EventSource reconnect logic with manual `Last-Event-ID` header** — Browser handles this automatically. Manual retry creates duplicate connections + slot leak in Upstash.
- **`useChat`'s `addToolResult` API for client-confirmation flows** — Phase 3 doesn't use human-in-the-loop tool approval. Tools execute server-side; client only reads results.
- **Putting `reservation_id` in tool inputSchema for actions** — Pitfall #5. Resolve from `X-Reservation-Session` header.
- **Optimistic UI on Llamar / Marcar presentado** — D-15 says wait-for-server. SSE is single source of truth post-action.
- **Reading Edge Config at module top** — Pitfall #14 + `_README.md` "Edge Config Inside Steps". Read inside route handler / RSC body.
- **`conversaToCoreMessages`** — v5 API, removed in v6. Use `await convertToModelMessages(...)` (now async per migration guide).
- **`ai@5` patterns** — `handleInputChange` / `handleSubmit` / `toolInvocations` are v5; v6 uses `sendMessage({text})` + `messages[].parts[type==="tool-${name}"]`.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Streaming chat with tool calls | Custom fetch + EventSource parser + tool-call state machine | `streamText` server + `useChat` client | Tool-call lifecycle, retries, multi-step orchestration are non-trivial. AI SDK v6 ships them. |
| Server-Sent Events client | Custom WebSocket fallback, custom retry, custom Last-Event-ID tracking | Browser native `EventSource` | Browser handles reconnect + Last-Event-ID automatically. |
| Chatbot message threading state | Custom React state for messages array | `useChat`'s built-in `messages` + `sendMessage` | v6 handles streaming partial messages, tool-call interleaving, error states. |
| Spanish input → tool dispatch | Custom regex / NER for "dame 5 más" → extend | LLM tool-calling | LLM does this natively. Pitfall #21 mitigated via system prompt. |
| Tool input validation against LLM hallucination | Custom error mapping | Zod `.passthrough() + safeParse` returning `ServiceResult` | Phase 2 already standardized; LLM apologizes from `error.message`. |
| Push notifications to diner | Custom polling / WebSocket | SSE (Phase 2 endpoint) + UI banner | One-way push fits the use case; Phase 2 endpoint already shipped. |
| Confirmation dialog for destructive actions | Custom modal | shadcn `AlertDialog` | Accessible (focus trap, role="alertdialog"), 4 LOC. |
| Toast notifications for errors | Custom queue / portal | shadcn `Sonner` | Accessible, queued, themed. |
| Skeleton loaders | Custom keyframes | shadcn `Skeleton` | One-line per use site. |
| Cookie session for diner | Cookie pre-set + decrypt | localStorage + `/api/me` projection | Phase 0.5 cut, Pitfall #10. localStorage is the v1 path. |
| Workflow change for ETA agent | New step / step reorder | Path C (plain `generateText` inside existing step) OR Path D (skip LLM, keep formula) | D-11 freeze rule. See Critical Finding §0. |
| Cron job for no-show timeout | `node-cron`, Vercel Cron | Already shipped: workflow `Promise.race(hook, sleep)` in Phase 2 | Workflow IS the cron replacement. |
| Authentication for SSE endpoints | JWT in custom header | Existing query-param `?session_token=` (diner) + Auth.js cookie (staff) | Phase 2 D-28/D-29 already shipped. EventSource doesn't support custom headers anyway. |

**Key insight:** Phase 3 is overwhelmingly assembly of existing, verified building blocks. The ONE genuinely new piece of code that needs invention is the `lib/hooks/use-reservation-events.ts` + `use-queue-events.ts` (Pattern 3) — and even that is ~80 LOC of `EventSource` wiring with no novel algorithm. Everything else is a 5-15 LOC wrapper.

---

## Common Pitfalls

### Pitfall #6 — SSE missed-message during reconnect [DEMO KILLER]

**What goes wrong:** Vercel function timeout (300s on Hobby) kills SSE; browser auto-reconnects; the maître clicks Llamar exactly during the gap; diner never sees push.

**Why it happens:** Redis pub/sub is at-most-once.

**How to avoid (already mitigated by Phase 2):**
- Phase 2 SSE handler emits `id:` on every SSE event using `reservation_events.id`.
- Browser sends `Last-Event-ID` automatically on reconnect.
- Phase 2 handler queries `SELECT * FROM reservation_events WHERE id > ?` to fill the gap.
- Phase 3 client just needs to NOT manually retry (creates duplicate connections).

**Warning signs:** Diner UI shows stale state after a 5+ minute SSE session. Snapshot doesn't match what the maître sees.

**Test:** Open chatbot, leave for 5 min, then maître clicks Llamar. Diner SHOULD see "TU MESA ESTÁ LISTA" after the silent reconnect (max ~3s gap).

---

### Pitfall #8 — Chatbot infinite tool-call loop [DEMO KILLER]

**What goes wrong:** LLM calls tool, gets error, retries same tool, loops. AI SDK v5 had bugs where `stopWhen` didn't bound `useChat`'s client-side resend ([vercel/ai #7502, #9384]).

**How to avoid:**
- **`stopWhen: stepCountIs(5)` on `streamText`** — VERIFIED [ai-sdk.dev/docs/ai-sdk-core/agents]. v6 honors it server-side.
- **System prompt rule 2 (D-04 locked):** "Si el tool devuelve `ok:false`, explicale el `error.message` en español y NO reintentes el mismo tool."
- **Server-side guard (defense in depth):** if `onStepFinish` callback sees > 3 tool calls in a single request, log warn.

**Warning signs:** AI Gateway usage spike disproportionate to active users. Vercel logs show 10+ tool calls in 5 seconds for one chat session.

**Test:** Make `register_diner` artificially fail (set party_size to 99). LLM should apologize + STOP, not retry.

---

### Pitfall #9 — Zod `.strict()` rejecting LLM tool inputs [DEMO KILLER]

**What goes wrong:** LLM sends `{name, email, phone, party_size, notes: "celíaco"}`. `.strict()` rejects → tool errors → LLM retries (Pitfall #8 chain).

**How to avoid:**
- **`.passthrough()` not `.strict()`** on every tool inputSchema (D-03 locked). Phase 2 already sets convention.
- **`z.coerce.number()`** on `party_size` so LLM string `"4"` works.
- **`safeParse` not `parse`** so error path is predictable.

**Already implemented in Phase 2** `lib/services/reservations.ts` lines 54-61. Phase 3 inherits.

---

### Pitfall #10 — Cookie-set during streaming silently fails [DEMO KILLER]

**What goes wrong:** `Set-Cookie` after first byte → no cookie. Diner returns next time → no recognition.

**How to avoid:** Phase 3 doesn't use cookies at all. localStorage only (D-08 + D-11). Validated cut from Phase 0.5.

---

### Pitfall #15 — PII in logs [PILOT KILLER]

**What goes wrong:** `console.log("registered", reservation)` → name/email/phone in Vercel logs visible to anyone with project access.

**How to avoid:**
- **`lib/log.ts → redactPII`** is THE log sink. Phase 2 SAFE-01 shipped it.
- **`experimental_telemetry: { recordInputs: false, recordOutputs: false }`** on `streamText` (D-23).
- **D-25 convention:** log tool name + result shape (`{ok, error_code?}`), NEVER args. Tool args contain PII.
- **CI grep step:** `grep -nE 'console\.(log|warn|error)' app/api/chat/route.ts | grep -v 'lib/log'` returns 0.

**Warning signs:** Production log lines contain visible `@` (email), `+` followed by digits (phone), or full names.

---

### Pitfall #16 — LLM hallucinates fake confirmation [PILOT KILLER]

**What goes wrong:** LLM says "¡Te anoté, Juana!" but never called `register_diner`. Diner walks to restaurant → not in system.

**How to avoid:**
- **System prompt rule 2 (D-04 locked):** "NUNCA digas 'estás registrado/llamado/cancelado' sin que el tool haya devuelto `ok: true` con `reservation_id`."
- **UI confirmation badge** rendered ONLY from `part.output.ok && part.output.data.reservation_id`, NEVER from LLM text (D-03).
- **D-04 fixture (D-30 spike):** simulate tool failure scenarios; LLM must say "fallo" not "te anoté".

**Test:** Kill the MCP service (`createReservation` returns INTERNAL_ERROR). LLM speaks the error in Spanish. UI shows NO badge.

---

### Pitfall #17 — Demo recording variance [DEMO KILLER]

**What goes wrong:** LLM output varies; re-takes burn time.

**How to avoid (Phase 3 plays its part; Phase 4 records):**
- **`temperature: 0.2`** on `streamText` (D-02 locked).
- **D-04 system prompt is RIGID** — bullets 1-5 are imperative.
- **D-30 spike fixture** — 10 conversations rehearsed.
- **Phase 4 will record in clips, not one take.**

---

### Pitfall #19 — Push to prod every phase [DEMO KILLER]

**What goes wrong:** First prod deploy on day 6 → discover env vars missing.

**How to avoid:** D-31 inherits Phase 1 D-13 auto-deploy. Each Phase 3 plan ends with `git push origin main`. Atomic commits per plan to avoid taking down `/queue`.

---

### Pitfall #21 — Spanish ambiguous input handling [PILOT KILLER]

**What goes wrong:** "somos 4 o 5", "tal vez un bebé", "para mañana" → LLM creates broken reservations.

**How to avoid:**
- **D-04 Rule 4:** "Si el comensal dice 'somos 4 o 5' o 'tal vez un bebé', pedí precisión: '¿Son 4 o 5 personas?'"
- **D-04 Rule 5:** "Esta es una cola de espera para ahora, no reservas para mañana."
- **D-30 fixture (10 conversations)** validates these in `__tests__/chatbot-conversations.fixture.json` before merging.

---

### Phase-3-specific pitfall: AI SDK v5 → v6 migration footguns

**[VERIFIED: ai-sdk.dev/docs/migration-guides/migration-guide-6-0]**

| v5 (DON'T USE) | v6 (USE) |
|----------------|----------|
| `convertToCoreMessages(messages)` (sync) | `await convertToModelMessages(messages)` (async!) |
| `isToolUIPart(part)` | `isStaticToolUIPart(part)` |
| `isToolOrDynamicToolUIPart(part)` | `isToolUIPart(part)` |
| `getToolName(toolPart)` | `getStaticToolName(toolPart)` |
| `getToolOrDynamicToolName(toolPart)` | `getToolName(toolPart)` |
| `toModelOutput: output => {...}` | `toModelOutput: ({ output }) => {...}` |
| `messages[].toolInvocations[]` | `messages[].parts[type==="tool-${name}"][state==="output-available"]` |
| `handleInputChange` / `handleSubmit` | Manage your own input state + `sendMessage({text})` |

**Warning signs:** TypeScript errors after `npm install ai@^6` reference any of the v5 names.

---

### Phase-3-specific pitfall: EventSource auth via headers does NOT work

**[CITED: MDN EventSource]** Browser `EventSource` constructor takes only `(url, eventSourceInitDict?)` and `eventSourceInitDict` only supports `withCredentials: boolean`. There is NO way to set `Authorization` or any other custom header.

Phase 2 SSE handlers correctly use query-param auth (`?session_token=` for diner; cookie auth via Auth.js for staff). Phase 3 client code MUST mirror — DO NOT attempt to wrap fetch streaming as a substitute.

**Footnote:** The `Last-Event-ID` header IS sent automatically by the browser on reconnect — that's a special case the spec defines.

---

## Code Examples

### `register_diner` tool (server side, in `/api/chat/route.ts`)

[VERIFIED: ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling + Phase 2 service layer]

```typescript
register_diner: tool({
  description: "Anotar a un comensal nuevo en la cola.",
  inputSchema: z.object({
    name: z.string().min(1),
    email: z.string().email(),
    phone: z.string().min(5),
    party_size: z.coerce.number().int().min(1).max(20),
  }).passthrough(),
  execute: async (input) => {
    log.info("chat.tool.invoked", { tool: "register_diner" }); // D-25 — NO args
    return await createReservation(input); // returns ServiceResult<CreateReservationData>
  },
}),
```

### Confirmation badge (client side)

```tsx
// components/chat/chat-thread.tsx (excerpt)
{message.parts.map((part, i) => {
  // [VERIFIED: ai-sdk.dev] AI SDK v6 typed tool parts
  if (part.type === "text") {
    return <span key={i}>{part.text}</span>;
  }
  if (part.type === "tool-register_diner" && part.state === "output-available") {
    const out = part.output as { ok: boolean; data?: { reservation_id: string } };
    if (out.ok && out.data) {
      return (
        <span key={i} className="inline-flex items-center gap-1 bg-green-50 text-green-700 text-xs font-normal px-2 py-0.5 rounded-full border border-green-200">
          ✓ Reserva #{out.data.reservation_id.slice(0, 8)}
        </span>
      );
    }
  }
  return null;
})}
```

### `/api/me` Route Handler (D-10)

```typescript
// app/api/me/route.ts
import { NextResponse } from "next/server";
import { getReservationStatus } from "@/lib/services/reservations";
import { log } from "@/lib/log";

export const runtime = "nodejs";
export const maxDuration = 10;
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const sessionToken = url.searchParams.get("session_token");

  if (!sessionToken) {
    return NextResponse.json(
      { ok: false, error: { code: "INVALID_SESSION", message: "Sesión inválida." } },
      { status: 400 },
    );
  }

  const result = await getReservationStatus({ sessionToken });
  // service returns ServiceResult<ReservationStatusData>
  // Already projects only safe columns (no name/email/phone) — see Phase 2 lib/services/reservations.ts:300-346.
  // log.ts redacts session_token in URL (Phase 2 D-21).
  log.info("me.read", { ok: result.ok });
  return NextResponse.json(result);
}
```

### `reopenNoShow` service function (D-16, NEW 5th export of `lib/services/queue.ts`)

```typescript
// lib/services/queue.ts (ADDITIONAL export — file already has 4)
import { start } from "workflow/api";
import { reservationWorkflow } from "@/lib/workflows/reservation";

export async function reopenNoShow(
  reservationId: string,
): Promise<ServiceResult<{ reservation_id: string; new_status: string }>> {
  const row = await loadReservation(reservationId);
  if (!row) {
    return {
      ok: false,
      error: { code: "RESERVATION_NOT_FOUND", message: "No encontramos esa reserva." },
    };
  }
  if (row.status !== "no_show") {
    return {
      ok: false,
      error: {
        code: "NOT_IN_NO_SHOW_STATE",
        message: "Solo podés reabrir una reserva marcada como no-show.",
      },
    };
  }

  // Start a NEW workflow run — the original already terminated when it transitioned to no_show.
  let runId: string;
  try {
    const run = await start(reservationWorkflow, [{ reservationId }]);
    runId = run.runId;
  } catch (err) {
    log.error("queue.reopen.workflow_start_failed", err, { reservation_id: reservationId });
    return {
      ok: false,
      error: { code: "INTERNAL_ERROR", message: "No pudimos reabrir la reserva. Intentá de nuevo." },
    };
  }

  // Update row state — must clear ended_at + no_show_deadline; bump reopen_count
  await sql`
    UPDATE reservations
    SET status = 'waiting',
        ended_at = NULL,
        no_show_deadline = NULL,
        called_at = NULL,
        workflow_run_id = ${runId},
        active_hook_token = ${`reservation:${reservationId}:waiting`},
        reopen_count = reopen_count + 1,
        updated_at = NOW()
    WHERE id = ${reservationId}
  `;

  const occurredAt = new Date().toISOString();
  const inserted = (await sql`
    INSERT INTO reservation_events (reservation_id, event_type, payload)
    VALUES (
      ${reservationId},
      'reopened',
      ${JSON.stringify({ occurred_at: occurredAt, run_id: runId })}::jsonb
    )
    RETURNING id
  `) as Array<{ id: number }>;

  await publishReservationEvent(reservationId, {
    id: inserted[0].id,
    type: "reservation.reopened",
    reservation_id: reservationId,
    occurred_at: occurredAt,
    status: "waiting",
  });
  await publishQueueEvent({
    type: "reservation.reopened",
    reservation_id: reservationId,
    occurred_at: occurredAt,
    status: "waiting",
  });

  log.info("queue.reopen.ok", { reservation_id: reservationId, run_id: runId });
  return { ok: true, data: { reservation_id: reservationId, new_status: "waiting" } };
}
```

### Migration `0003_reopen_count.sql`

```sql
-- db/migrations/0003_reopen_count.sql
-- D-16: STAFF-09 audit column. Forward-only, no backfill (no production rows yet).
ALTER TABLE reservations ADD COLUMN reopen_count INTEGER NOT NULL DEFAULT 0;
```

### Recompute ETA — Path C (recommended; in-step `generateText`)

[VERIFIED: ai-sdk.dev/docs/reference/ai-sdk-core/generate-text]

```typescript
// lib/workflows/reservation.ts (BODY ONLY of existing recompute_eta step — D-11 freeze respected)
import { generateText } from "ai"; // NEW import; not @workflow/ai/agent

async function recomputeEta(
  reservationId: string,
  position: number,
  partySize: number,
): Promise<{ eta_min: number }> {
  "use step";
  const avgTurnoverMin = await getTypedConfig<number>("no_show_timeout_min", 15);
  const formulaEta = Math.max(0, position * avgTurnoverMin);

  // PATH C: optionally consult LLM for refinement; default to formula on any failure.
  // Step output is sampled-once-and-stored: WDK persists the return value; on replay,
  // the SAME value comes back deterministically. This satisfies D-22 without requiring
  // temperature: 0 (the LLM's non-determinism is hidden behind the step boundary).
  try {
    const { text } = await generateText({
      model: "anthropic/claude-sonnet-4.6",
      system: "Devolvés solo un número entero positivo. Sin texto, sin markdown, sin explicación.",
      prompt: `Estimación de espera en minutos para posición ${position} con grupo de ${partySize}, turnover promedio ${avgTurnoverMin} min/mesa. Responde solo con el número.`,
      temperature: 0,
      maxOutputTokens: 8,
    });
    const parsed = Number(text.trim());
    if (Number.isFinite(parsed) && parsed >= 0 && parsed < 240) {
      return { eta_min: Math.round(parsed) };
    }
  } catch (err) {
    log.warn("workflow.recompute_eta.llm_failed", { reservation_id: reservationId });
  }
  return { eta_min: formulaEta };
}
```

This honors D-22 (deterministic-on-replay because step output is sampled once), preserves Track 2 narrative ("ETA estimated by an LLM call inside the workflow"), and keeps the workflow router shape unchanged. It does NOT use the literal `@workflow/ai/agent` package — that's a Path E exercise.

---

## State of the Art

| Old Approach (v5 / pre-2026) | Current Approach (v6 / 2026-04) | Impact |
|------------------------------|----------------------------------|--------|
| `useChat` exposes `handleInputChange` + `handleSubmit` | Manage your own input state + `sendMessage({text})` | More boilerplate but cleaner control flow. |
| `messages[].toolInvocations[]` | `messages[].parts[type==="tool-${name}"][state==="output-available"]` | Single unified shape for text + tool. State transitions explicit. |
| `convertToCoreMessages(messages)` (sync) | `await convertToModelMessages(messages)` (async) | Forgetting `await` returns a Promise to the SDK = silent failure. |
| `experimental_createMCPClient` from `@ai-sdk/mcp` | Direct service-layer calls (D-03 + Phase 2 D-36) | Avoids HTTP self-call; ARCHITECTURE Anti-Pattern 1. |
| Cookie session for chat | localStorage + `/api/me` projection | Pitfall #10 mitigated. |
| AI Gateway `createAnthropic()` + Anthropic key | Bare model id `"anthropic/claude-sonnet-4.6"` reading `AI_GATEWAY_API_KEY` | Auto-provisioned by Vercel; no extra credential. |
| Workflow `waitForEvent({timeout})` | `Promise.race([hook, sleep("Xm")])` (already shipped Phase 2) | Phase 3 doesn't touch this; just notes it. |
| `@vercel/mcp-adapter` | `mcp-handler@1.1.0` (already shipped Phase 2) | Phase 3 inherits unchanged. |

**Deprecated/outdated for Phase 3:**
- `ai@5` — replaced by `ai@6`. Migration touches `convertToModelMessages` (async), `tool-X` part naming, `isStaticToolUIPart` rename.
- `cookie-during-streaming` patterns — Pitfall #10 + Phase 0.5 cut.
- `experimental_createMCPClient` from chat — D-03 + Anti-Pattern 1.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Path C (`generateText` inside step) preserves replay determinism via sample-once-and-store | §"Critical Finding §0" + §"Code Examples — recomputeEta" | If WDK does NOT cache step return values across replays, the LLM call would re-fire on every replay → token cost + non-deterministic state. Phase 2 `_README.md` explicitly states "the step result is what's persisted" — but verify with a small spike test before pushing to prod. |
| A2 | `EventSource` browser auto-reconnect with `Last-Event-ID` "just works" with Phase 2 SSE handlers | §"Pattern 3" | Phase 2 D-26/D-27 already implements server-side gap recovery; client just needs to NOT fight the browser. Risk if wrong: gap-recovery breaks → diner sees stale state. Mitigated by Phase 2 verification (already shipped). |
| A3 | `temperature: 0.2` on `streamText` is sufficient for Pitfall #21 demo stability | §"Common Pitfalls — Pitfall #17/21" | If LLM output still varies wildly, demo recording may need temperature: 0 or stricter prompt fixtures. Mitigated by D-30 spike + Phase 4 rehearsal. |
| A4 | `@workflow/ai@^4.1.2` is compatible with `workflow@^4.2.4` and Next.js 16.2.4 | §"Standard Stack" | Beta `5.0.0-beta.2` is the AI SDK v6 forward-compat track — IF using DurableAgent, the planner must verify which track is required. Path C avoids this entirely. |
| A5 | `useChat`'s `headers: () => ({...})` re-evaluates on every request (so localStorage updates take effect) | §"Pattern 2" + §"Code Examples" | If headers are evaluated only at hook init time, the X-Reservation-Session won't update after `register_diner` writes localStorage. D-30 spike test case. **High priority to verify in spike.** |
| A6 | `getReservationStatus` projection in `/api/me` doesn't expose `name/email/phone` | §"Code Examples — `/api/me`" | Verified: Phase 2 service layer already projects safe columns (lines 300-346 in `lib/services/reservations.ts`). |
| A7 | `addToolResult` / `addToolApprovalResponse` are NOT needed for Phase 3 | §"Pattern 2" | If tool execution requires human-in-the-loop approval (e.g., maître approves diner cancellations), this changes. CONTEXT D-04 + D-06 has zero such flow. Confirmed: tools execute server-side, client only reads results. |
| A8 | The 10-conversation fixture (D-30) tests against the system prompt + tool schemas, NOT against the live LLM | §"Common Pitfalls — Pitfall #21" + CONTEXT D-04 | If the test framework expects live LLM calls, CI runs become non-deterministic + costly. Mitigated by mocking `streamText` with fixture LLM outputs (per CONTEXT D-04 fixture description). Implementation strategy in spike. |

**Rows tagged [ASSUMED] needing user confirmation before plans land:**
- A1 (replay determinism of `generateText` inside step) — **planner should verify in 30-min spike or accept Path D as fallback**
- A5 (`headers: () => ({...})` re-evaluation timing) — **first task of D-30 spike**
- A4 (`@workflow/ai` package compatibility) — moot if Path C/D is chosen

---

## Open Questions

1. **Should Phase 3 take Path C (recommended) or Path D (cut) for PLAT-08?**
   - What we know: D-20/D-22 say "agent inside step body". Framework says "agent at workflow router level". Path C inverts D-20's mechanism but preserves intent (LLM-calling step). Path D ships zero LLM scope and relies on framework's `@workflow/ai` not being literally present.
   - What's unclear: Does the team want the literal `@workflow/ai/agent` import in production for the Track 2 narrative, or is "step body calls LLM" enough?
   - Recommendation: **Path C** for narrative integrity at minimal risk. If Phase 3 runs over budget, fall back to Path D (PROJECT cut list #1 endorses).

2. **Does `useChat`'s `transport.headers: () => ({...})` re-evaluate per request?**
   - What we know: Docs show function form is supported; behavior on dynamic re-evaluation isn't explicit.
   - What's unclear: Does it cache the function call or invoke per-request?
   - Recommendation: **First spike test (D-30 task 1).** If it caches, fall back to per-call `sendMessage(msg, {headers: {...}})` (D-29 alternative shown in §"Code Examples").

3. **What's the canonical event-name mapping between Phase 2 publishers and Phase 3 consumers?**
   - What we know: Phase 2 service layer publishes `reservation.created`, `reservation.called`, `reservation.extended`, `reservation.seated`, `reservation.cancelled`, `reservation.no_show`. Workflow's `:called:pre` token expiry publishes `followup_proactive`.
   - What's unclear: Are there other workflow-emitted events (e.g., `reservation.reopened` from STAFF-09) that the queue panel needs to handle for sliding new cards in?
   - Recommendation: **Plan-phase task: enumerate all event types in `__tests__/sse-event-shapes.fixture.json` and assert UI handles each.**

4. **What's the polling interval for `/queue/history`?**
   - CONTEXT discretion: default 30s. Tunable later if pilot demands.
   - Recommendation: 30s is right. Don't over-think.

5. **Should the welcome chatbot greeting include "Hola Juan" for returning diners?**
   - CONTEXT discretion: default NO (PII-on-page concern).
   - Recommendation: Stay default-off. SAFE-02 + D-29 align.

---

## Project Constraints (from CLAUDE.md)

> Strict directives the planner MUST honor. Any plan task that contradicts these is automatically a deviation requiring re-scoping.

- **Stack package locks:** `next@16` + `proxy.ts` (NOT middleware.ts), AI SDK v6 + `sendMessage({text})` (NOT v5 `handleSubmit`), model id `anthropic/claude-sonnet-4.6` (DOT not dash), `mcp-handler@1.1.0`, `workflow` package (NOT `@vercel/workflow`), `@neondatabase/serverless` + `pg.Pool`, `@upstash/redis`, `next-auth@beta`. **NO substitutions without updating PROJECT.md.**
- **Architectural commitments (5 non-negotiable):** service-layer funnel (D-03/D-36), snapshot-replay-on-connect for SSE (Phase 2 shipped), no cookie during streaming (D-11), workflow shape FROZEN (D-11/D-20), hooks resume in-process (Phase 2 shipped).
- **Spanish for chatbot replies, panel UI, user-facing copy.** Code/comments in English. Variable names in English. Domain nouns can stay Spanish (`comensal`, `maitre`).
- **NO comments except where the WHY is non-obvious** (workarounds, invariants, constraints from a specific pitfall).
- **PII redaction via `lib/log.ts`** (SAFE-01). Never `console.log(reservation)` or `console.log(error.message)` if it could contain email/phone/name. **CI grep enforces.**
- **Zod schemas for tools:** `.passthrough()` not `.strict()`, coerce numerics, resolve `reservation_id` server-side. NEVER from LLM input.
- **Workflow steps:** plain JSON in/out. ISO strings for dates. No `Date` objects, no functions, no class instances crossing step boundaries.
- **Top 5 pitfalls to plan against** (re-cited from CLAUDE.md):
  1. Cookie-set-during-streaming silently fails → use localStorage / cut from v1.
  2. WDK event race + non-serializable steps → workflow function is a router, every step input/output is plain JSON, persist trigger in DB before publishing event.
  3. MCP tool poisoning → never put `reservation_id` in LLM-visible tool input; resolve server-side from `session_token`.
  4. Resend magic-link in spam → maître locked out → pilot dies. (Phase 1 D-09; Phase 3 doesn't touch.)
  5. SSE killed by serverless timeout, push event lost on reconnect → snapshot-replay-on-connect + `Last-Event-ID` mandatory. (Phase 2 shipped server-side; Phase 3 client just consumes.)
- **Hackathon deadline ~2026-05-02 (~6 days from today). Real diners use the system the same week.** Correctness > features. Bugs hurt a real restaurant's reputation.
- **The "money shot" demo is `git push` mid-flight.** Don't break workflow durability casually. **Phase 3 only changes `recompute_eta` step BODY (D-20), nothing else in `lib/workflows/reservation.ts`.**
- **Cut list (in order, if running over):** (1) DurableAgent ETA quality (cap 4h, fall back to formula); (2) `/queue/history` as separate page (collapse into `/queue` with filter — but D-12 already chose separate); (3) maître undo no_show (D-16 says ship; cuttable); (4) Edge-Config-live demo scenario; (5) party-size colors.

---

## Validation Architecture

> Per `.planning/config.json`, `workflow.nyquist_validation` is not explicitly set. Default is enabled. However, the project ships with a small `node:test` via `tsx` convention (Phase 2 D-23). This section captures what's needed for Phase 3 to maintain the convention.

### Test Framework

| Property | Value |
|----------|-------|
| Framework | `node:test` via `tsx` (Phase 2 convention; no vitest) |
| Config file | none — direct `npx tsx --test __tests__/<name>.test.ts` |
| Quick run command | `npx tsx --test __tests__/chatbot-conversations.test.ts` |
| Full suite command | `find __tests__ -name "*.test.ts" -exec npx tsx --test {} \;` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| DINER-01..07 | Tools wire correctly to services | unit | `npx tsx --test __tests__/chat-tools.test.ts` | ❌ Wave 0 |
| SAFE-02 | System prompt + tool schemas handle 10 weird inputs | fixture-asserter | `npx tsx --test __tests__/chatbot-conversations.test.ts` | ❌ Wave 0 — D-30 fixture |
| STAFF-09 | `reopenNoShow` validates `status==='no_show'`, starts new workflow run | unit | `npx tsx --test __tests__/queue-reopen.test.ts` | ❌ Wave 0 |
| Pitfall #6 | SSE consumer hook reconnect + snapshot replay | manual | open `/`, kill server, restart, verify state recovers | ✅ Phase 2 server-side; Phase 3 client manual |
| Pitfall #16 | Confirmation badge ONLY from `part.output.ok` | manual | force `register_diner` to error; verify NO badge | ❌ Wave 0 — manual sanity |
| PLAT-08 (Path C) | `recomputeEta` step body returns numeric eta_min from formula on LLM failure | unit | `npx tsx --test __tests__/workflow-recompute-eta.test.ts` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** Run only the test file relevant to the changed module.
- **Per wave merge:** Run all `__tests__/*.test.ts` + manual `npm run smoke:mcp` sanity.
- **Phase gate:** Full suite green + `npm run smoke:money-shot --dry-run` succeeds before `/gsd-verify-work`.

### Wave 0 Gaps

- [ ] `__tests__/chatbot-conversations.test.ts` — system prompt + tool schemas asserter against fixture (covers SAFE-02)
- [ ] `__tests__/chatbot-conversations.fixture.json` — 10 weird-real-input cases (D-30 spike artifact)
- [ ] `__tests__/chat-tools.test.ts` — verifies each tool's `execute` calls the right service function with right args (mocks services)
- [ ] `__tests__/queue-reopen.test.ts` — `reopenNoShow` happy path + state validation
- [ ] `__tests__/workflow-recompute-eta.test.ts` — Path C deterministic-on-replay assertion
- [ ] No framework install needed (`node:test` is built-in to Node 20).

---

## Security Domain

> Required when `security_enforcement` is enabled (absent from `.planning/config.json`, treated as enabled). Phase 3 surfaces user-facing endpoints, so explicit categories apply.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|------------------|
| V2 Authentication | yes | Maître via Auth.js v5 magic-link (Phase 1 already shipped). Diner is anonymous (intentional v1 scope) — `session_token` is a capability, not an authn factor. |
| V3 Session Management | yes | localStorage `session_token` for diner; Auth.js cookie for maître. Diner SSE auth via query-param `?session_token=` (capability-based). Staff SSE via Auth.js cookie. |
| V4 Access Control | yes | `proxy.ts` gates `/queue/:path*`. Routes re-validate `employees.active=true` server-side (defense in depth). MCP tool poisoning mitigated via Phase 2 D-03/D-06 (resolve `reservation_id` server-side). |
| V5 Input Validation | yes | Zod `.passthrough() + safeParse + .coerce.number()` on every tool inputSchema (D-03). |
| V6 Cryptography | yes | `crypto.randomUUID()` (DB level via `gen_random_uuid()`) for `session_token`. NO custom crypto. |

### Known Threat Patterns for Phase 3

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| MCP tool poisoning (LLM passes someone else's reservation_id) | Spoofing | D-03: tools accept ZERO LLM-visible identity params; `session_token` resolved from header server-side. |
| Cookie-during-streaming silently failing | Tampering | D-11: localStorage only. Cut from v1 (Phase 0.5). |
| PII in logs visible to project members | Information Disclosure | D-23/D-24/D-25: `lib/log.ts → redactPII` everywhere; `experimental_telemetry: { recordInputs: false, recordOutputs: false }`. |
| Tool-call infinite loop exhausting AI Gateway | Denial of Service | D-02: `stopWhen: stepCountIs(5)` + D-04 Rule 2 system prompt. |
| Diner cancels someone else's reservation via guessed UUID | Tampering / Repudiation | D-03: `reservation_id` is NOT in tool input; `cancelReservation({sessionToken})` resolves row from session_token only. |
| Diner accesses someone else's SSE stream | Information Disclosure | Phase 2 D-28: `?session_token=` validated against `reservations` row. Phase 3 inherits unchanged. |
| LLM hallucinates fake confirmation, diner walks to restaurant unregistered | Repudiation | D-03 + Pitfall #16: confirmation badge from `part.output.ok && part.output.data.reservation_id`, NEVER LLM text. |
| Maître session hijack via Auth.js cookie theft | Spoofing | Out of Phase 3 scope (Phase 1 already mitigated via Auth.js v5 + httpOnly cookies). |
| Off-topic abuse (diner asks LLM to "tell me a joke", "ignore previous instructions") | Spoofing / DoS via prompt injection | D-04 Rule 3: explicit refusal copy. `stopWhen: stepCountIs(5)` bounds damage. |
| LLM's tool error retry loop hides real errors from diner | Repudiation | D-04 Rule 2: explain error in Spanish, NO retry. |

### Phase 3 specific: Diner is anonymous; `session_token` is a capability not an identity

This is a v1 design choice. Anyone with the localStorage `session_token` can act on that reservation. The blast radius is: one reservation, fully recoverable (rebook). Pilot scope is acceptable. Post-hackathon, if multi-restaurant or higher-risk surfaces ship, upgrade to Auth.js for diners too.

---

## Sources

### Primary (HIGH confidence)

- [VERIFIED: package.json] — `next@16.2.4`, `react@19.2.4`, `workflow@^4.2.4`, `mcp-handler@^1.1.0`, `@neondatabase/serverless@^1.1.0`, `@upstash/redis@^1.37.0`, `@vercel/edge-config@^1.4.3`, `next-auth@^5.0.0-beta.31`, `zod@^4.3.6`, `shadcn@^4.5.0`, `tailwindcss@^4`, `lucide-react@^1.11.0`. `@workflow/ai` NOT installed.
- [VERIFIED: components.json] — shadcn `base-nova` style, `neutral` baseColor, `cssVariables: true`, `iconLibrary: lucide`.
- [CITED: ai-sdk.dev/docs/ai-sdk-ui/chatbot] — `useChat` v6 shape, `DefaultChatTransport`, `messages[].parts`, `sendMessage({text})`, status values, dynamic headers via function form.
- [CITED: ai-sdk.dev/docs/reference/ai-sdk-ui/use-chat] — full API reference: parameters (`transport`, `id`, `onFinish`, `onError`, `onToolCall`, `messages`, `experimental_throttle`), return value (`messages`, `sendMessage`, `status`, `error`, `regenerate`, `stop`, `addToolResult`, `addToolOutput`, `addToolApprovalResponse`, `setMessages`, `clearError`, `resumeStream`).
- [CITED: ai-sdk.dev/docs/ai-sdk-ui/chatbot-tool-usage] — tool part shape `tool-${toolName}`, state lifecycle (`input-streaming` → `input-available` → `output-available` / `output-error` / `approval-requested`), client read pattern via `useEffect` over `messages[].parts`.
- [CITED: ai-sdk.dev/docs/migration-guides/migration-guide-6-0] — v5 → v6 breaking changes: `convertToCoreMessages` → `convertToModelMessages` (now async); `isToolUIPart` → `isStaticToolUIPart`; `isToolOrDynamicToolUIPart` → `isToolUIPart`; `getToolName` → `getStaticToolName`; `getToolOrDynamicToolName` → `getToolName`; `toModelOutput: output => ...` → `toModelOutput: ({ output }) => ...`.
- [CITED: ai-sdk.dev/docs/ai-sdk-core/agents] — `stopWhen: stepCountIs(5)` import from `'ai'` package, server-side enforcement.
- [CITED: workflow-sdk.dev/docs/api-reference/workflow-ai/durable-agent] — `DurableAgent` constructor options (`model`, `instructions`, `temperature`, `tools`, `toolChoice`, `maxOutputTokens`, `topP`); `stream()` method signature; "**cannot be instantiated inside a `"use step"` function**".
- [CITED: workflow-sdk.dev/docs/ai] — DurableAgent placement at workflow router level.
- [VERIFIED: npm view @workflow/ai] — version 4.1.2 (stable), 5.0.0-beta.2 (beta); deps `@ai-sdk/provider@^3.0.0`, `@workflow/serde@^4.1.1`, `zod@4.3.6`.
- [VERIFIED: lib/services/reservations.ts + lib/services/queue.ts] — Phase 2 service layer shape, ServiceResult contract, PII-safe column projection.
- [VERIFIED: app/api/events/[reservation_id]/route.ts + app/api/events/queue/route.ts] — Phase 2 SSE handler implementing Pattern 3 with `Last-Event-ID` server-side replay.
- [VERIFIED: lib/workflows/reservation.ts + lib/workflows/_README.md] — Frozen workflow shape; only step BODIES may change; `recompute_eta` is the targeted body for Phase 3's PLAT-08.

### Secondary (MEDIUM confidence)

- WebSearch (cross-verified): Vercel Workflow + DurableAgent docs across `vercel.com/docs/workflows`, `vercel.com/blog`, `workflow-sdk.dev` — confirmed DurableAgent is workflow-level, "drop-in replacement for AI SDK Agent class", "splits the loop into individual steps".
- [CITED: developer.mozilla.org/en-US/docs/Web/API/EventSource] — auto-reconnect behavior, `Last-Event-ID` automatic transmission, no support for custom headers in constructor.

### Tertiary (LOW confidence — flagged for spike validation in D-30)

- A1: `generateText` inside a `"use step"` is replay-deterministic via output sampling — inferred from `_README.md` "the step result is what's persisted" but not directly tested.
- A5: `transport.headers: () => ({...})` re-evaluates per-request — D-30 spike must verify (alternative: pass `{headers}` to `sendMessage` second arg).

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — every package + version verified against package.json + npm registry as of 2026-04-26.
- Architecture: HIGH for client-side + chat route patterns (verified against ai-sdk.dev docs); MEDIUM-HIGH for DurableAgent path (Critical Finding §0 contradicts CONTEXT.md D-20).
- AI SDK v6 lifecycle: HIGH — verified `tool-${name}` part shape, `state==="output-available"`, `part.output`, `headers` function form, `stopWhen: stepCountIs(5)`. D-30 spike validates the integration end-to-end.
- EventSource patterns: HIGH — MDN-cited; matches Phase 2 server-side already in production.
- Pitfalls: HIGH — Phase 2 already mitigated #6, #7, #15. Phase 3 inherits + adds chat-specific #8, #9, #16, #21.
- DurableAgent placement: HIGH (the contradiction is verified, not ambiguous). Resolution path: HIGH on Path C/D recommendations; MEDIUM on Path E timeline estimate.

**Research date:** 2026-04-26
**Valid until:** ~2026-05-15 — AI SDK v6 is stable but the Workflow SDK is a young product. Minor versions of `@workflow/ai` may shift the agent-vs-step boundary.
