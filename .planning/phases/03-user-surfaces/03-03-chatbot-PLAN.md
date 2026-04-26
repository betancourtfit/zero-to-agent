---
phase: 03-user-surfaces
plan: 03
type: execute
wave: 2
depends_on: [03-01, 03-02]
files_modified:
  - app/api/chat/route.ts
  - app/api/me/route.ts
  - app/page.tsx
  - components/chat/diner-chat-island.tsx
  - components/chat/chat-thread.tsx
  - components/chat/chat-composer.tsx
  - components/chat/status-card.tsx
  - components/chat/push-banner.tsx
  - components/chat/quick-reply-chips.tsx
  - __tests__/chat-tools.test.ts
autonomous: true
requirements: [DINER-01, DINER-02, DINER-03, DINER-04, DINER-05, DINER-06, DINER-07, DINER-08, SAFE-02, SAFE-03]
requirements_addressed: [DINER-01, DINER-02, DINER-03, DINER-04, DINER-05, DINER-06, DINER-07, DINER-08, SAFE-02, SAFE-03]
user_setup: []
must_haves:
  truths:
    - "Diner can open `/`, chat in Spanish, provide name/email/phone/party_size, and after the LLM echo-back-and-confirm pattern (D-04 Rule 1) the `register_diner` tool is called and returns ServiceResult — confirmation badge renders ONLY from `part.output.ok && part.output.data.reservation_id`, never from LLM text (Pitfall #16)."
    - "Diner sees position + ETA + status persist across page reload via localStorage hydration → /api/me read → status card mount + SSE attach (D-08, D-09)."
    - "Diner sees the `TU MESA ESTÁ LISTA` push banner when SSE delivers `reservation.called`."
    - "Diner sees `¿Estás en camino?` followup banner + 2 quick-reply chips when the workflow `:called:pre` token expires (event `reservation.followup`); chips post natural-language messages into the chat (`sendMessage({text:'dame 5 más'})`)."
    - "Diner can extend / cancel / query status in natural Spanish via the LLM-mapped tools (DINER-05/06/07)."
    - "On `no_show` automatic timeout, banner shows the SAFE-03-locked empathic Spanish copy with `Anotarme de nuevo` button that clears localStorage."
    - "System prompt is the locked D-04 5-rule Spanish prompt; `temperature: 0.2`; `stopWhen: stepCountIs(5)`; `experimental_telemetry: {recordInputs: false, recordOutputs: false}` (D-23, D-02, Pitfall #8)."
    - "All chat tools' inputSchemas are `z.object({...}).passthrough()`; the three action tools accept zero LLM-visible identity params (D-03 / Pitfall #5)."
    - "All server-side logs in `/api/chat` and `/api/me` route through `lib/log.ts` and exclude tool args (D-24, D-25)."
  artifacts:
    - path: "app/api/chat/route.ts"
      provides: "POST handler with streamText + 4 inline tool wrappers"
      min_lines: 120
      contains: "streamText"
    - path: "app/api/me/route.ts"
      provides: "GET handler with PII-safe projection"
      min_lines: 30
      contains: "getReservationStatus"
    - path: "app/page.tsx"
      provides: "Full-page chatbot at / with useChat + status card + banner + composer"
      min_lines: 100
    - path: "components/chat/chat-thread.tsx"
      provides: "renders messages[].parts (text + tool-result confirmation badge)"
    - path: "components/chat/chat-composer.tsx"
      provides: "sticky-bottom input + Enviar button"
    - path: "components/chat/status-card.tsx"
      provides: "active-session summary card"
    - path: "components/chat/push-banner.tsx"
      provides: "5-state banner state machine (hidden|called|followup|seated|closed)"
      contains: "aria-live"
    - path: "components/chat/quick-reply-chips.tsx"
      provides: "horizontal chip row that posts natural-language messages into chat"
  key_links:
    - from: "app/api/chat/route.ts"
      to: "lib/services/reservations.ts"
      via: "direct import (NEVER experimental_createMCPClient)"
      pattern: "import.*from \"@/lib/services/reservations\""
    - from: "app/api/me/route.ts"
      to: "lib/services/reservations.ts → getReservationStatus"
      via: "direct import"
      pattern: "getReservationStatus"
    - from: "app/page.tsx"
      to: "lib/hooks/use-reservation-events"
      via: "import"
      pattern: "useReservationEvents"
    - from: "app/page.tsx"
      to: "@ai-sdk/react useChat"
      via: "import"
      pattern: "useChat"
---

<objective>
Replace the Phase 1 placeholder at `/` with the full diner chatbot surface: a Spanish full-page conversational UI built on AI SDK v6 (`useChat` + `DefaultChatTransport`) talking to a server-side `/api/chat` Route Handler whose 4 tool wrappers call `lib/services/reservations.ts` directly. Plus the `/api/me` endpoint that drives the localStorage-hydration return-UX and the 5-state push banner that mutates from SSE events Phase 2 already publishes. Ships 10 of the 19 phase requirements (DINER-01..08, SAFE-02, SAFE-03).

Purpose: This is the diner-facing half of the user surfaces. It IS the demo's scenarios 1, 2, 3, 4 — registering, getting called, getting the followup, and the empathic no-show close.

Output: A diner can open `/` on their phone, register, leave, return, see status, get pushed when called, extend or cancel, all in natural Spanish. Atomic commit per D-31 — `/` either is the placeholder OR the full chatbot, never half-built.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/STATE.md
@.planning/phases/03-user-surfaces/03-CONTEXT.md
@.planning/phases/03-user-surfaces/03-RESEARCH.md
@.planning/phases/03-user-surfaces/03-PATTERNS.md
@.planning/phases/03-user-surfaces/03-UI-SPEC.md
@.planning/phases/03-user-surfaces/03-01-SPIKE-RESULTS.md
@lib/services/reservations.ts
@lib/log.ts
@lib/hooks/use-reservation-events.ts
@app/page.tsx
@app/mcp/[transport]/route.ts
@CLAUDE.md

<interfaces>
Service layer (Phase 2): all return `ServiceResult<T>` = `{ok:true,data:T} | {ok:false,error:{code,message,fields?}}`.

```typescript
createReservation({name,email,phone,party_size}) -> ServiceResult<{reservation_id, session_token, position, eta_min}>
getReservationStatus({sessionToken}) -> ServiceResult<{reservation_id, status, position, eta_min, extension_count, no_show_deadline, called_at}>
extendWait({sessionToken}) -> ServiceResult<{...}>
cancelReservation({sessionToken}) -> ServiceResult<{...}>
```

Hooks (plan 02):
```typescript
useReservationEvents({reservationId, sessionToken}) -> {snapshot, latestEvent, connection}
```

AI SDK v6 contract (per D-30 spike outcome):
```typescript
streamText({
  model: "anthropic/claude-sonnet-4.6",  // DOT, locked
  system, messages: await convertToModelMessages(uiMessages),
  temperature: 0.2,
  stopWhen: stepCountIs(5),
  experimental_telemetry: {isEnabled: true, recordInputs: false, recordOutputs: false},
  tools, onStepFinish,
}).toUIMessageStreamResponse();
```
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Implement `app/api/chat/route.ts` with streamText + 4 inline tool wrappers</name>
  <files>app/api/chat/route.ts, __tests__/chat-tools.test.ts</files>
  <read_first>
    - app/mcp/[transport]/route.ts (Phase 2 — same tool-wrap-services pattern; PATTERNS.md cites lines 109-211)
    - .planning/phases/03-user-surfaces/03-RESEARCH.md §Pattern 1 lines 387-496 (canonical /api/chat — copy verbatim)
    - .planning/phases/03-user-surfaces/03-CONTEXT.md D-02, D-03, D-04, D-23, D-24, D-25
    - .planning/phases/03-user-surfaces/03-01-SPIKE-RESULTS.md (transport.headers re-evaluation outcome)
    - lib/services/reservations.ts (verify exports)
    - lib/log.ts (PII redactor — chat route MUST log via log.info/warn/error)
  </read_first>
  <behavior>
    - Test 1: tool `register_diner` inputSchema rejects missing `name`, accepts extra fields via `.passthrough()` (Pitfall #9)
    - Test 2: tool `register_diner` inputSchema coerces `party_size: "4"` (string) to number 4 via `z.coerce.number()`
    - Test 3: tools `get_my_status` / `extend_my_wait` / `cancel_my_reservation` use `z.object({}).passthrough()` (zero LLM identity params)
    - Test 4: when `X-Reservation-Session` header is missing, action-tool execute returns `{ok:false, error:{code:"INVALID_SESSION"}}`
    - Test 5: `register_diner.execute(input)` calls `createReservation(input)` and returns ServiceResult unchanged
    - Test 6: tool execute does NOT pass `input` to log calls (D-25 — log tool name + ok/error_code only)
  </behavior>
  <action>
1. Create `app/api/chat/route.ts` based VERBATIM on RESEARCH.md §Pattern 1 lines 387-496. Header:
```typescript
import { streamText, tool, stepCountIs, convertToModelMessages, type UIMessage } from "ai";
import { z } from "zod";
import { createReservation, getReservationStatus, extendWait, cancelReservation } from "@/lib/services/reservations";
import { log } from "@/lib/log";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";
```

2. Define `SYSTEM_PROMPT` as a single Spanish string containing ALL 5 D-04 rules verbatim from RESEARCH.md §Pattern 1 lines 404-416 plus the D-09 returning-diner Rule 6 paragraph: `Si el usuario ya tiene una reserva activa, NO le pidas datos de nuevo. Saludá brevemente y ofrecé ayuda con su reserva existente.`

3. Implement the POST handler exactly as RESEARCH.md §Pattern 1 lines 418-496. Critical literals (DO NOT paraphrase):
   - `model: "anthropic/claude-sonnet-4.6"` (DOT — CLAUDE.md stack lock)
   - `temperature: 0.2`
   - `stopWhen: stepCountIs(5)` (Pitfall #8)
   - `experimental_telemetry: { isEnabled: true, recordInputs: false, recordOutputs: false, metadata: { redacted: true } }` (D-23)
   - `messages: await convertToModelMessages(messages)` (v6 ASYNC)
   - Tool inputSchemas:
     - `register_diner`: `z.object({ name: z.string().min(1), email: z.string().email(), phone: z.string().min(5), party_size: z.coerce.number().int().min(1).max(20) }).passthrough()`
     - other 3 tools: `z.object({}).passthrough()` (zero identity params per D-03)
   - sessionToken comes from `req.headers.get("X-Reservation-Session")` ONLY; never from body or LLM input.
   - Each tool execute logs `chat.tool.invoked` (name only) and `chat.tool.completed` (name + ok + error_code). NEVER log args/input.
   - `onStepFinish: async ({ toolResults }) => { log.info("chat.step.finished", { tool_results: toolResults.length }); }`
   - Return `result.toUIMessageStreamResponse()` (verbatim — v6 method name).

4. Anti-pattern fence (D-03 + D-36): NO `experimental_createMCPClient`, NO `fetch("/mcp/mcp", ...)`. Direct service-layer calls only.

5. Add `__tests__/chat-tools.test.ts` (~80 LOC). Strategy: dynamically import the route module's exported tool definitions (or extract them into a separate `app/api/chat/tools.ts` if simpler — but only if both files import from the same `tools.ts`). Mock the service-layer functions with stub implementations and exercise the 6 behaviors above. Run with `npx tsx --test __tests__/chat-tools.test.ts`.

6. Verify CI grep for raw console:
```bash
grep -nE "console\\.(log|warn|error)" app/api/chat/route.ts | grep -v "lib/log"
# Must return 0 lines (D-24)
```
  </action>
  <verify>
    <automated>npx tsc --noEmit && grep -E "stopWhen: stepCountIs\\(5\\)" app/api/chat/route.ts && grep -F 'model: "anthropic/claude-sonnet-4.6"' app/api/chat/route.ts && npx tsx --test __tests__/chat-tools.test.ts</automated>
  </verify>
  <acceptance_criteria>
    - File `app/api/chat/route.ts` exists with at least 120 LOC
    - Exports `runtime = "nodejs"`, `maxDuration = 60`, `dynamic = "force-dynamic"`
    - Imports `streamText, tool, stepCountIs, convertToModelMessages` from `"ai"`
    - Imports the 4 services from `@/lib/services/reservations`
    - Does NOT import `experimental_createMCPClient` (`grep -c experimental_createMCPClient app/api/chat/route.ts == 0`)
    - Does NOT contain `fetch("/mcp"` or any self-HTTP call
    - Contains `stopWhen: stepCountIs(5)` literal
    - Contains model id `"anthropic/claude-sonnet-4.6"` with DOT
    - Contains `temperature: 0.2`
    - Contains `experimental_telemetry` with `recordInputs: false` AND `recordOutputs: false`
    - System prompt contains all 5 D-04 rule keywords: `"Confirmás"`, `"NUNCA"`, `"Solo te puedo ayudar"`, `"número exacto"`, `"cola de hoy"`
    - Has 4 tools: `register_diner`, `get_my_status`, `extend_my_wait`, `cancel_my_reservation`
    - All 4 inputSchemas use `.passthrough()` and none use `.strict()`
    - 3 of 4 tools use `z.object({}).passthrough()` (zero LLM identity params)
    - No raw `console.*` outside `lib/log` (`grep -nE "console\\.(log|warn|error)" app/api/chat/route.ts | grep -v "lib/log" | wc -l == 0`)
    - No tool input/args appear in log calls (`grep -E "log\\.(info|warn|error)\\(.*\\binput\\b" app/api/chat/route.ts | wc -l == 0`)
    - Returns `result.toUIMessageStreamResponse()` (verbatim)
    - `__tests__/chat-tools.test.ts` exists and runs via `npx tsx --test` exiting 0
    - `npx tsc --noEmit` exits 0
  </acceptance_criteria>
  <done>
The chat Route Handler is server-ready. POSTing to `/api/chat` from a v6 useChat client streams text + tool results. The 4 tools wire 1:1 to Phase 2 service layer. PII never leaves the server.
  </done>
</task>

<task type="auto">
  <name>Task 2: Implement `app/api/me/route.ts` (PII-safe diner status projection)</name>
  <files>app/api/me/route.ts</files>
  <read_first>
    - app/api/events/[reservation_id]/route.ts (auth pattern lines 76-98 — query-param session_token + 401)
    - app/api/queue/route.ts (service-call shape — log result, return JSON)
    - .planning/phases/03-user-surfaces/03-PATTERNS.md §"app/api/me/route.ts" lines 171-209 (PII-safe projection)
    - .planning/phases/03-user-surfaces/03-CONTEXT.md D-10
    - lib/services/reservations.ts → getReservationStatus
  </read_first>
  <action>
Create `app/api/me/route.ts`:
```typescript
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
    log.warn("api.me.unauthorized", { reason: "missing_session_token" });
    return NextResponse.json(
      { ok: false, error: { code: "INVALID_SESSION", message: "Sesión inválida." } },
      { status: 400 },
    );
  }

  const result = await getReservationStatus({ sessionToken });
  log.info("api.me.read", { ok: result.ok, error_code: result.ok ? undefined : result.error.code });

  if (!result.ok) {
    const status = result.error.code === "INVALID_SESSION" ? 401 : 404;
    return NextResponse.json(result, { status });
  }

  // Defense-in-depth: project only safe columns. Service already projects safely;
  // this re-projection enforces the contract against future service changes.
  return NextResponse.json({
    ok: true,
    data: {
      reservation_id: result.data.reservation_id,
      status: result.data.status,
      position: result.data.position,
      eta_min: result.data.eta_min,
      extension_count: result.data.extension_count,
      no_show_deadline: result.data.no_show_deadline,
      called_at: result.data.called_at,
      // INTENTIONAL omissions per D-10: name, email, phone — NEVER on this endpoint.
    },
  });
}
```
NO Anthropic / AI SDK imports. NO POST/PUT/DELETE.
  </action>
  <verify>
    <automated>npx tsc --noEmit && grep -c "getReservationStatus" app/api/me/route.ts && ! grep -nE "data\\.(name|email|phone)\\s*:" app/api/me/route.ts</automated>
  </verify>
  <acceptance_criteria>
    - File `app/api/me/route.ts` exists, at least 30 LOC
    - Exports `runtime = "nodejs"`, `maxDuration = 10`, `dynamic = "force-dynamic"`
    - Exports `GET` only
    - Returns 400 when `session_token` query param missing
    - Calls `getReservationStatus({ sessionToken })`
    - On `INVALID_SESSION` returns 401; else on !ok returns 404
    - Response `data` MUST NOT contain `name`, `email`, `phone` properties (`grep -nE "(name|email|phone):" app/api/me/route.ts | grep -v INTENTIONAL | wc -l == 0`)
    - All logs via `log.*` (no raw console)
    - `npx tsc --noEmit` exits 0
  </acceptance_criteria>
  <done>
The diner can hit `GET /api/me?session_token=<token>` after page reload and get a tiny PII-safe payload powering the status card.
  </done>
</task>

<task type="auto">
  <name>Task 3: Build the 5 chat components under `components/chat/`</name>
  <files>components/chat/chat-thread.tsx, components/chat/chat-composer.tsx, components/chat/status-card.tsx, components/chat/push-banner.tsx, components/chat/quick-reply-chips.tsx</files>
  <read_first>
    - .planning/phases/03-user-surfaces/03-UI-SPEC.md §"Surface 1: Diner Chatbot" lines 134-148 (layout, structure, copy, accessibility)
    - .planning/phases/03-user-surfaces/03-UI-SPEC.md §"Copywriting Contract → Diner surface" lines 206-228 (verbatim Spanish copy)
    - .planning/phases/03-user-surfaces/03-PATTERNS.md §"Components in components/chat/* and components/queue/*" lines 535-560
    - .planning/phases/03-user-surfaces/03-RESEARCH.md §"Confirmation badge" lines 940-959 (exact tool-result render pattern)
    - components/ui/button.tsx (cva style — match for any new variant components)
    - components/ui/card.tsx, badge.tsx, skeleton.tsx (from plan 02)
  </read_first>
  <action>
Each component starts with `"use client";`. Imports from `@/components/ui/*` for shadcn primitives; `cn` from `@/lib/utils`; types from `@/lib/hooks/use-reservation-events`.

### `components/chat/chat-thread.tsx`
Props: `{ messages: UIMessage[] }`. Render each message's `parts[]`:
- `part.type === "text"`: chat bubble. User-role messages right-aligned `bg-primary text-primary-foreground rounded-2xl rounded-br-sm`; assistant left-aligned `bg-muted text-foreground rounded-2xl rounded-bl-sm`. Body: `text-base leading-normal`.
- `part.type === "tool-register_diner" && part.state === "output-available"`: cast `part.output` as `{ ok: boolean; data?: { reservation_id: string } }`. If `out.ok && out.data` render the ✓ badge per RESEARCH.md lines 940-959:
```tsx
<span className="inline-flex items-center gap-1 bg-green-50 text-green-700 text-xs font-normal px-2 py-0.5 rounded-full border border-green-200">
  ✓ Reserva #{out.data.reservation_id.slice(0, 8)}
</span>
```
- All other tool result types: render nothing (LLM text speaks the result; only `register_diner` confirmation gets the badge per Pitfall #16).

### `components/chat/chat-composer.tsx`
Props: `{ onSend: (text: string) => void; status: "ready" | "submitted" | "streaming" | "error"; }`. Container: `sticky bottom-0 border-t bg-background px-4 py-3 flex gap-2`. Local state: `input` string. On Enter or button click → `onSend(input.trim())` then clear. `<input>` has `aria-label="Mensaje para el chatbot"`, `aria-disabled={status !== "ready"}`, `placeholder="Escribí tu mensaje..."`. Button: `min-h-[44px]`, label `Enviar`, `disabled={status !== "ready"}`.

### `components/chat/status-card.tsx`
Props: `{ snapshot: ReservationSnapshot | null }`. If null → return null. Else (UI-SPEC line 214):
```tsx
<div className="bg-muted rounded-lg mx-4 mt-4 p-4 text-sm">
  <div className="font-semibold">TU RESERVA</div>
  <div className="text-muted-foreground">
    Posición #{snapshot.position} · ETA {snapshot.eta_min ?? "—"} min · {snapshot.status}
  </div>
  {snapshot.extension_count > 0 && (
    <span className="inline-block mt-1 bg-orange-100 text-orange-700 text-xs rounded-full px-2 py-0.5">
      extendido ×{snapshot.extension_count}
    </span>
  )}
</div>
```

### `components/chat/push-banner.tsx`
Props:
```typescript
{
  snapshot: ReservationSnapshot | null;
  latestEvent: ReservationEvent | null;
  partyColor: string;
  onClearSession: () => void;
  children?: React.ReactNode; // QuickReplyChips passed in by parent for followup state
}
```
Container always `position: sticky top-0 z-50` with `role="status"` and `aria-live="assertive"`. State machine driven by `snapshot.status` + `latestEvent.type`:
- `snapshot === null || snapshot.status === "waiting"` → return null.
- `snapshot.status === "called"`:
  - If `latestEvent?.type === "reservation.followup"`: header text `¿Estás en camino?`, render `{children}` (chips passed in).
  - Else: header `TU MESA ESTÁ LISTA` (`text-3xl font-semibold uppercase`); sub `Acercate al maître`; `style={{backgroundColor: partyColor}}`.
- `snapshot.status === "seated"`: copy "Bienvenido. Disfrutá la cena." + `<Button>Salir</Button>` calling `onClearSession`.
- `snapshot.status === "no_show"`: SAFE-03 LOCKED copy from UI-SPEC line 220 verbatim: `"Marcamos tu reserva como no-show porque no llegamos a verte. Si querés volver a anotarte, abrí esta página de nuevo."` + `<Button>Anotarme de nuevo</Button>` calling `onClearSession`.
- `snapshot.status === "cancelled"`: UI-SPEC line 221 copy: `"Tu reserva fue cancelada. Si querés volver a anotarte, abrí esta página de nuevo."` + same button.

### `components/chat/quick-reply-chips.tsx`
Props: `{ onChip: (text: string) => void }`. Two `Button variant="outline" size="sm"` chips, `min-h-[44px] rounded-full`:
- "Pedir más tiempo" → `onChip("dame 5 más")` AND `localStorage.setItem("restaurant_queue:lastIntent", "extend")` (D-06 belt-and-suspenders)
- "Cancelar" → `onChip("no voy a ir")` AND `localStorage.setItem("restaurant_queue:lastIntent", "cancel")`
Container: `flex gap-2 px-4 py-2 overflow-x-auto`.

### NO chat history persistence
Per D-09: localStorage holds only session state ({reservation_id, session_token, optional lastIntent}). No `messages[]` written to localStorage.
  </action>
  <verify>
    <automated>npx tsc --noEmit && ls components/chat/chat-thread.tsx components/chat/chat-composer.tsx components/chat/status-card.tsx components/chat/push-banner.tsx components/chat/quick-reply-chips.tsx && grep -l 'aria-live="assertive"' components/chat/push-banner.tsx && grep -F "Marcamos tu reserva como no-show" components/chat/push-banner.tsx</automated>
  </verify>
  <acceptance_criteria>
    - All 5 component files exist under `components/chat/`
    - Each starts with `"use client";`
    - `push-banner.tsx` contains `aria-live="assertive"` and `role="status"`
    - `push-banner.tsx` contains the SAFE-03 LOCKED no_show copy verbatim: "Marcamos tu reserva como no-show porque no llegamos a verte. Si querés volver a anotarte, abrí esta página de nuevo."
    - `chat-thread.tsx` reads `part.type === "tool-register_diner"` (NOT v5 `toolInvocations`) — `grep -c "tool-register_diner" components/chat/chat-thread.tsx == 1`
    - `chat-thread.tsx` reads `part.state === "output-available"` AND `part.output.ok` for the badge gate
    - `chat-composer.tsx` Enviar button has `min-h-[44px]` (UI-SPEC accessibility)
    - `chat-composer.tsx` input has `aria-label="Mensaje para el chatbot"`
    - `quick-reply-chips.tsx` has the 2 specific texts: "dame 5 más" and "no voy a ir" (verbatim — D-06)
    - `status-card.tsx` renders only when `snapshot !== null` (`grep -E "if \\(.*snapshot\\b" components/chat/status-card.tsx`)
    - No raw `console.*` in any of the 5 files
    - `npx tsc --noEmit` exits 0
  </acceptance_criteria>
  <done>
The 5 chat components are testable in isolation and ready for `app/page.tsx` to compose them. UI-SPEC contracts are met verbatim.
  </done>
</task>

<task type="auto">
  <name>Task 4: Replace `app/page.tsx` with full-page chatbot client component</name>
  <files>app/page.tsx</files>
  <read_first>
    - app/page.tsx (current Phase 1 placeholder — read to know what's being replaced)
    - .planning/phases/03-user-surfaces/03-UI-SPEC.md §"Surface 1: Diner Chatbot" lines 134-148 (layout structure top to bottom)
    - .planning/phases/03-user-surfaces/03-RESEARCH.md §Pattern 2 lines 509-565 (canonical useChat client + localStorage hydration)
    - .planning/phases/03-user-surfaces/03-CONTEXT.md D-08, D-09 (localStorage keys + hydration sequence)
    - .planning/phases/03-user-surfaces/03-01-SPIKE-RESULTS.md (transport.headers re-evaluation: PASS → use function form; FAIL/cached → use sendMessage second-arg headers)
    - lib/edge-config/index.ts (`getTypedConfig` for `colors_by_party_size` — Edge Config palette consumed CLIENT-SIDE on this page)
  </read_first>
  <action>
1. Make `app/page.tsx` a Server Component shell that reads Edge Config server-side, then hands off to a `<DinerChat />` client island. (Edge Config reads in client = no value; reads in RSC = single fetch + props handoff.)

2. Server shell:
```tsx
// app/page.tsx (Server Component)
import { getTypedConfig } from "@/lib/edge-config";
import { DinerChat } from "@/components/chat/diner-chat-island";

export const dynamic = "force-dynamic";

export default async function Home() {
  const colorsByPartySize = await getTypedConfig<Record<string, string>>(
    "colors_by_party_size",
    { "1-2": "#A8E6CF", "3-4": "#FFD3B6", "5-6": "#FFAAA5", "7+": "#D5AAFF" },
  );
  return <DinerChat colorsByPartySize={colorsByPartySize} />;
}
```

3. NEW client island: `components/chat/diner-chat-island.tsx` (add to files_modified — this file is the actual `useChat` consumer):
```tsx
"use client";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useEffect, useState } from "react";
import { useReservationEvents } from "@/lib/hooks/use-reservation-events";
import { ChatThread } from "./chat-thread";
import { ChatComposer } from "./chat-composer";
import { StatusCard } from "./status-card";
import { PushBanner } from "./push-banner";
import { QuickReplyChips } from "./quick-reply-chips";

const SK_TOKEN = "restaurant_queue:session_token";
const SK_RID = "restaurant_queue:reservation_id";

export function DinerChat({ colorsByPartySize }: { colorsByPartySize: Record<string, string> }) {
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [reservationId, setReservationId] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [networkError, setNetworkError] = useState<string | null>(null);

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
      .then((data) => {
        if (!data.ok || ["seated", "no_show", "cancelled"].includes(data.data?.status)) {
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

  const { messages, sendMessage, status, error } = useChat({
    transport: new DefaultChatTransport({
      api: "/api/chat",
      headers: () => ({
        ...(sessionToken ? { "X-Reservation-Session": sessionToken } : {}),
      }),
    }),
  });

  // D-08: persist localStorage on register_diner success
  useEffect(() => {
    for (const m of messages) {
      for (const part of m.parts) {
        if (
          part.type === "tool-register_diner" &&
          (part as { state: string }).state === "output-available"
        ) {
          const out = (part as { output?: { ok: boolean; data?: { reservation_id: string; session_token: string } } }).output;
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

  // SSE hook
  const { snapshot, latestEvent } = useReservationEvents({ reservationId, sessionToken });

  // Network error tracker (chat itself)
  useEffect(() => {
    if (error) setNetworkError("No pude contactar al servidor. Intentá de nuevo en un momento.");
  }, [error]);

  function clearSession() {
    localStorage.removeItem(SK_TOKEN);
    localStorage.removeItem(SK_RID);
    localStorage.removeItem("restaurant_queue:lastIntent");
    window.location.reload();
  }

  // Derive party color for banner (UI-SPEC line 108)
  const partyKey = snapshot?.position
    ? // we don't carry party_size on the diner snapshot — fallback to default
      "1-2"
    : "1-2";
  const partyColor = colorsByPartySize[partyKey] ?? "#A8E6CF";

  return (
    <div className="min-h-screen flex flex-col max-w-md mx-auto">
      <header className="h-12 flex items-center px-4 border-b">
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
        <div className="bg-destructive/10 text-destructive text-sm px-4 py-2 mx-4 rounded">
          {networkError}
        </div>
      )}

      <ChatComposer
        onSend={(text) => sendMessage({ text })}
        status={status}
      />
    </div>
  );
}
```

4. Add `components/chat/diner-chat-island.tsx` to the files_modified list (this is a new file — needs to ship with this task).

5. NOTE on `transport.headers: () => ({...})` re-evaluation (RESEARCH.md A5):
   - If spike PASSES (function re-evaluates per request): the function-form above works as-is.
   - If spike FAILS (cached at hook init): replace with passing headers per-call:
```typescript
const customSendMessage = (msg: {text: string}) => sendMessage(msg, {
  headers: sessionToken ? { "X-Reservation-Session": sessionToken } : {},
});
```
   Choose at execute time based on `03-01-SPIKE-RESULTS.md` outcome.

6. Welcome state (`hydrated && !sessionToken`) is implicit: `messages` is empty → ChatThread renders nothing → user sees just the header + composer + greeting handled by the LLM's first response. (LLM greets per D-04 system prompt → "¡Hola! Soy el host. ¿Querés anotarte en la cola?")

   To trigger the LLM greeting on mount when no session, send a synthetic system-side hello via `useEffect`:
   ```typescript
   const hasGreeted = useRef(false);
   useEffect(() => {
     if (hydrated && !sessionToken && !hasGreeted.current && messages.length === 0) {
       hasGreeted.current = true;
       sendMessage({ text: "hola" });
     }
   }, [hydrated, sessionToken, messages.length]);
   ```
   This avoids a blank chat on first load. (Alternative: render a static greeting bubble when `messages.length === 0`. Choose either; document the choice in the SUMMARY.)

7. Atomic commit per D-31: `git add app/page.tsx components/chat/*.tsx app/api/chat/route.ts app/api/me/route.ts __tests__/chat-tools.test.ts && git commit -m "feat(03-03): chatbot diner surface — DINER-01..08, SAFE-02, SAFE-03"` THEN `git push origin main` (auto-deploy).
  </action>
  <verify>
    <automated>npm run build && grep -E "use client" components/chat/diner-chat-island.tsx && grep -F 'restaurant_queue:session_token' components/chat/diner-chat-island.tsx && grep -F 'X-Reservation-Session' components/chat/diner-chat-island.tsx</automated>
  </verify>
  <acceptance_criteria>
    - `app/page.tsx` is a Server Component (no `"use client";` at top) that renders `<DinerChat colorsByPartySize={...} />`
    - `app/page.tsx` imports `getTypedConfig` from `@/lib/edge-config`
    - `components/chat/diner-chat-island.tsx` exists and starts with `"use client";`
    - The island imports `useChat` from `@ai-sdk/react` and `DefaultChatTransport` from `ai`
    - The island imports `useReservationEvents` from `@/lib/hooks/use-reservation-events`
    - localStorage keys present verbatim: `restaurant_queue:session_token` and `restaurant_queue:reservation_id`
    - localStorage write is gated by `part.type === "tool-register_diner" && part.state === "output-available" && out.ok`
    - `X-Reservation-Session` header set on chat requests when sessionToken is non-null
    - The island reads `/api/me` on mount when localStorage has a token
    - `clearSession()` removes both localStorage keys + the lastIntent key
    - `npm run build` exits 0
    - No raw `console.*` calls (`grep -nE "console\\.(log|warn|error)" components/chat/diner-chat-island.tsx | wc -l == 0`)
  </acceptance_criteria>
  <done>
The diner can hit `https://zero-to-agent-xi.vercel.app/` and the full chatbot loads. End-to-end manual smoke: open `/`, type "hola somos 4", confirm details when LLM echoes back, see ✓ Reserva badge from server, leave the page, return — status card + SSE attach.
  </done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <name>Task 5: Manual end-to-end smoke against production</name>
  <files>(no files modified — verification only)</files>
  <read_first>
    - .planning/phases/03-user-surfaces/03-UI-SPEC.md §"Chatbot state machine" lines 269-281 (transitions to verify)
  </read_first>
  <what-built>
    - `/api/chat` Route Handler with streamText + 4 tools wrapping service layer directly
    - `/api/me` GET endpoint with PII-safe projection
    - 5 client components in `components/chat/`
    - `app/page.tsx` Server shell + `<DinerChat />` client island
    - 1 test file (`__tests__/chat-tools.test.ts`)
    - Auto-deployed to production via `git push origin main`
  </what-built>
  <how-to-verify>
1. Open production URL `https://zero-to-agent-xi.vercel.app/` on a phone (or mobile emulator).
2. **Scenario 1 (DINER-01..02 happy path):**
   - Type: "hola somos 4 personas, juan, juan@example.com, +5491122334455"
   - LLM should echo back: "Confirmás: Juan, juan@example.com, +5491122334455, 4 personas?"
   - Reply: "sí dale"
   - Expected: ✓ Reserva #xxxxxxxx badge appears (from tool result, NOT LLM text). Status card appears showing position + ETA.
3. **Scenario 2 (DINER-07 status):**
   - Type: "¿cómo voy?"
   - Expected: LLM speaks current position + ETA. (No tool retry loop.)
4. **Scenario 3 (DINER-03 push call) — REQUIRES second tab as maître:**
   - Open `/queue` in another tab as the maître (after plan 04 ships — for plan 03 this is deferred to plan 04 verification).
   - Verify the SSE wiring is at least connecting in dev tools (Network tab → EventSource → `/api/events/[id]?session_token=...` shows `pending` status with periodic data).
5. **Scenario 4 (DINER-05 extend):**
   - In main tab, type: "dame 5 más"
   - Expected: LLM calls `extend_my_wait` (visible in Network tab as a chat completion with tool call), responds with confirmation message in Spanish.
6. **Scenario 5 (DINER-06 cancel):**
   - Type: "ya no voy a ir"
   - Expected: `cancel_my_reservation` invoked, status card shows "cancelled", banner mutates to "Tu reserva fue cancelada..." with "Anotarme de nuevo" button.
7. **SAFE-02 ambiguous input check:** type "somos 4 o 5" — LLM should ask for precision, NOT call register_diner. Confirm via Network tab.
8. **SAFE-02 off-topic check:** type "contame un chiste" — LLM should refuse with the D-04 Rule 3 copy.
9. **PII safety check (Vercel logs):**
   - Run `vercel logs --follow` (Phase 4 will formalize PII audit; for plan 03 a quick spot-check).
   - Trigger any tool call.
   - Confirm log lines show `chat.tool.invoked tool=register_diner` (no email, no name, no phone).
10. **Network error path:** kill the `/api/chat` endpoint (simulate by changing the URL temporarily in browser devtools), send a message — confirm the network-error banner appears.

If any scenario fails: do NOT proceed to plan 04 in parallel. Report which failed; spawn a fix plan or fall back to revising chat route / system prompt.

If all scenarios pass: type "approved" — plan 04 may run in parallel (wave 2 had plan 03 + plan 04 designed to run together; plan 04 can start as soon as plan 03 lands and atomic-commits).
  </how-to-verify>
  <resume-signal>Type "approved" to confirm chatbot is production-ready and SAFE-02/SAFE-03 hold.</resume-signal>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| browser ↔ /api/chat | LLM-generated tool inputs cross here; PII (name, email, phone) flows in for register_diner |
| browser ↔ /api/me | session_token in query string |
| browser ↔ /api/events/[reservation_id] | session_token in query string |
| /api/chat ↔ Anthropic via AI Gateway | system prompt + user messages flow out; PII included in conversation but NOT in telemetry per D-23 |
| /api/chat ↔ lib/services/reservations | tool inputs reach service layer (service does its own validation) |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-03-03-01 | Spoofing | MCP-style tool poisoning (LLM passes someone else's reservation_id) | mitigate | D-03: action tools use `z.object({}).passthrough()` — zero LLM-visible identity params. `reservation_id` resolved server-side from `X-Reservation-Session` header that the client sets from localStorage. LLM has NO way to act on someone else's reservation. |
| T-03-03-02 | Tampering | LLM hallucinates fake confirmation ("¡Te anoté!" without tool call) | mitigate | UI confirmation badge in `chat-thread.tsx` rendered ONLY from `part.output.ok && part.output.data.reservation_id`. NEVER from LLM text. D-04 Rule 2 system prompt reinforces. Pitfall #16 directly addressed. |
| T-03-03-03 | Repudiation | LLM tool-call infinite loop (Pitfall #8 — vercel/ai #7502) | mitigate | `stopWhen: stepCountIs(5)` on streamText. D-04 Rule 2 system prompt: "Si el tool devuelve ok:false, NO reintentes el mismo tool." `onStepFinish` logs tool-call count for monitoring. |
| T-03-03-04 | Information Disclosure | PII in Vercel observability spans | mitigate | `experimental_telemetry: { recordInputs: false, recordOutputs: false }` (D-23). Tool execute logs tool name + ok/error_code only (D-25). `lib/log.ts` PII redactor catches anything that slips through. |
| T-03-03-05 | Information Disclosure | `/api/me` accidentally returns name/email/phone | mitigate | Explicit defense-in-depth projection in route handler — only `position`, `eta_min`, `status`, `extension_count`, `no_show_deadline`, `called_at` returned. Service layer already projects safely; route re-projects for double safety. |
| T-03-03-06 | Information Disclosure | localStorage holds session_token visible to any script on same origin | accept | v1 design choice. session_token is a capability, not authn factor (RESEARCH.md §"Diner is anonymous"). Blast radius = one reservation, fully recoverable. Same-origin only — no third-party scripts on `/` (no analytics, no ads). |
| T-03-03-07 | Denial of Service | Diner spams `register_diner` calls | accept-in-phase-3 | Rate limiting deferred to Phase 4 (Out of Scope per CONTEXT). `stopWhen: stepCountIs(5)` bounds per-request damage. `max_extensions_per_ticket` Edge Config bounds extension abuse. |
| T-03-03-08 | Spoofing | Prompt injection ("ignore previous instructions") | mitigate | D-04 Rule 3 explicit refusal copy. SAFE-02 fixture (plan 01) tested this case (id: off-topic-injection). `temperature: 0.2` reduces variance. `stopWhen: stepCountIs(5)` bounds tool-call damage even if injection partially succeeds. |
| T-03-03-09 | Tampering | Cookie-during-streaming silent fail | mitigate | D-11 + Pitfall #10: NO cookies anywhere. localStorage only, written from `useEffect` AFTER stream ends (in `onToolResult` lifecycle, not during streaming response). |

No high-severity threats remain unmitigated. All ASVS V2/V3/V4/V5/V6 categories addressed inline.
</threat_model>

<verification>
- `npm run build` exits 0
- `npx tsx --test __tests__/chat-tools.test.ts` exits 0
- `npx tsx --test __tests__/chatbot-conversations.test.ts` exits 0 (fixture from plan 01 still valid)
- All 4 chat tools' inputSchemas pass `.passthrough()` check (no `.strict()`)
- No raw `console.*` outside `lib/log` in `app/api/chat/route.ts`, `app/api/me/route.ts`, or `components/chat/*.tsx`
- Production deploy succeeds via `git push origin main`
- Manual checkpoint smoke (task 5) confirms scenarios 1-9
</verification>

<success_criteria>
- 10 of 19 phase requirements ship with this plan: DINER-01..08 + SAFE-02 + SAFE-03
- Diner happy path is reproducible end-to-end on production URL
- SAFE-02 D-04 Rules 1-5 are visibly enforced (echo-back, never-fabricate, refuse off-topic, clarify ambiguous, no future booking)
- SAFE-03 LOCKED no_show copy renders verbatim on the banner
- No regression to Phase 2 — `npm run smoke:mcp` and `npm run smoke:money-shot --dry-run` still green
- The 5 chat components are reusable (plan 04 panel does not need them, but their cva style + shadcn primitives match the maître surface)
</success_criteria>

<output>
After completion, create `.planning/phases/03-user-surfaces/03-03-chatbot-SUMMARY.md` with:
- Final LOC per file
- Whether transport.headers function-form worked (Spike A5 outcome)
- Whether the synthetic LLM greeting on mount was needed (or static greeting bubble used)
- Manual smoke results (which of scenarios 1-9 PASS/FAIL)
- Production URL deploy commit SHA
- D-31 push confirmation
</output>
