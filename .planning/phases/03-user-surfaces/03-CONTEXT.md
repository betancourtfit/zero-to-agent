# Phase 3: User Surfaces - Context

**Gathered:** 2026-04-26
**Status:** Ready for planning
**Discuss outcome:** User selected "ninguna, avancemos" — all gray areas decided by Claude using research-backed defaults from PROJECT.md, REQUIREMENTS.md, ROADMAP.md, research/SUMMARY.md, research/STACK.md, research/ARCHITECTURE.md, research/PITFALLS.md, plus carry-forwards from `01-CONTEXT.md` (Phase 1) and `02-CONTEXT.md` (Phase 2 — workflow shape FROZEN, service layer + SSE + staff API + MCP all shipped UNCHANGED for consumption here).

<domain>
## Phase Boundary

Phase 3 ships the two human-facing surfaces of the product:

1. **Diner chatbot embed** at `/` — a Spanish conversational UI built with AI SDK v6 (`useChat` + `DefaultChatTransport` + `sendMessage({text})`) talking to a server-side `/api/chat` Route Handler that calls `lib/services/reservations.ts` DIRECTLY (Phase 2 D-36 — NOT via `experimental_createMCPClient`). The diner registers, returns, asks for status, asks for an extension, and cancels — all conversationally. Push events from the workflow ("MESA LISTA", 1-min followup) arrive over SSE (`/api/events/[reservation_id]` from Phase 2) and surface as a sticky banner above the chat. Quick-reply chips render the followup actions ([Pedir más tiempo] [Cancelar]).

2. **Maître panel** at `/queue` (already auth-gated stub from Phase 1) and a NEW `/queue/history` route — both auth-protected by `proxy.ts` + `lib/auth/auth.ts`. The panel reads `lib/services/queue.ts → getActiveQueue()` for snapshot, then subscribes to `/api/events/queue` SSE for live updates. Action buttons (Llamar, Marcar presentado, Reabrir) call the Phase 2 staff API endpoints (`/api/queue/[id]/{call,seated,no_show_manual}` + a NEW `/api/queue/[id]/reopen` for STAFF-09 undo). Cards are colored by party-size from Edge Config `colors_by_party_size`.

3. **DurableAgent ETA estimator** (PLAT-08) — Phase 3 swaps the BODY of the `recompute_eta` step (already exists in `lib/workflows/reservation.ts`, currently a deterministic formula per Phase 2 D-32 / Claude's discretion at end of 02-CONTEXT.md) into a `@workflow/ai/agent`-wrapped path. Phase 3 ships the formula INSIDE the agent wrapper so the Track 2 narrative exists; LLM-tuned recompute is a 4h-capped spike that ships only if dry-run shows visibly better ETAs. **Step BODY change only — never step count or order (D-11 freeze rule from Phase 2).**

4. **SAFE-02** — system prompt rules for the chatbot: echo-back-before-confirm, never-fabricate-confirmation (UI confirmation badge reads from `tool result.ok && result.data.reservation_id`), refuse off-topic, ask for clarification on ambiguous Spanish inputs ("somos 4 o 5", "tal vez un bebé"). Validated against ≥10 weird real inputs before merging.

5. **SAFE-03** — empathic-recoverable Spanish copy for tool errors and the no-show automated message ("Marcamos tu reserva como no-show porque no llegamos a verte. Si querés volver a anotarte, abrí esta página de nuevo."), NOT punitive.

**In scope:** `/` chatbot UI + `/api/chat` Route Handler + system prompt + tool wiring + diner status card + push banner + quick-reply chips + localStorage hydration + `/queue` panel rebuild (replaces Phase 1 stub) + `/queue/history` route + Llamar / Marcar presentado / Reabrir actions + STAFF-04 color coding + SSE consumers on both surfaces + `recompute_eta` step BODY swap to `@workflow/ai/agent` (formula inside) + AI SDK telemetry routed through `lib/log.ts → redactPII` (Phase 2 D-22 promise paid).

**Out of scope (deferred to Phase 4 or later):**
- Rate limiting (5 req/min on `create_reservation`) — Phase 4
- Idempotency dedup key (`email + party_size + 30s window` hash in KV) on `create_reservation` — Phase 4
- `/api/health` endpoint + Slack/Discord webhook on workflow failure — Phase 4
- Final PII audit (grep production logs for email/phone) — Phase 4
- Demo video recording, README polish — Phase 4
- WhatsApp adapter (the public MCP from Phase 2 stays the future-proofing) — post-hackathon
- Multi-tenant scoping, i18n, ratings, payments, table assignment — out of scope per PROJECT.md

**Phase 3 prerequisites already satisfied (by Phase 2 — verified in `.planning/STATE.md` + `02-CONTEXT.md`):**
- 4 MCP tools live at `app/mcp/[transport]/route.ts` (`mcp-handler@1.1.0` + `withMcpAuth`) — `create_reservation`, `get_reservation_status`, `extend_wait`, `cancel_reservation`. All Phase 3 work calls `lib/services/*` directly per D-36; the MCP server stays intact for future clients (WhatsApp, raw curl).
- Service layer at `lib/services/reservations.ts` (4 funcs: `createReservation`, `getReservationStatus`, `extendWait`, `cancelReservation`) + `lib/services/queue.ts` (4 funcs: `getActiveQueue`, `markCalled`, `markSeated`, `markNoShowManual`) — **all 8 functions are the only mutation paths Phase 3 uses.** Verified file-listing 2026-04-26.
- WDK durable workflow at `lib/workflows/reservation.ts` — FROZEN per D-11. Only the `recompute_eta` step BODY changes in Phase 3 (allowed — see _README.md "How to Add a New Step Safely"). NO step count/order changes.
- KV pub/sub via `lib/realtime.ts` — channels `reservation:<uuid>` (per-reservation) + `queue:active` (fan-out). Subscription is ONLY in SSE handlers.
- 2 SSE Route Handlers shipped: `/api/events/[reservation_id]` (diner; query-param `?session_token=<uuid>` auth per D-28) + `/api/events/queue` (staff; auth() + employees.active gate per D-29). BOTH implement Pattern 3 snapshot-replay-on-connect with `Last-Event-ID` resumability and `maxDuration=300` (Hobby) / 800 (Pro).
- 4 Phase 2 staff action endpoints: `GET /api/queue` (snapshot — used by panel pre-SSE-attach) + `POST /api/queue/[id]/{call,seated,no_show_manual}`. All 5–15 LOC wrappers around `lib/services/queue.ts`. HTTP status codes mapped per Phase 2 implementation refinement: 401/403/404/409/400/500.
- `lib/log.ts` PII redactor live (SAFE-01). Phase 3 wires `experimental_telemetry` from AI SDK + tool-call lifecycle hooks through it (D-22 from Phase 2).
- Edge Config `colors_by_party_size` already seeded: `{"1-2":"#A8E6CF","3-4":"#FFD3B6","5-6":"#FFAAA5","7+":"#D5AAFF"}`. Phase 3 UI consumes via `lib/edge-config/getTypedConfig()`.
- Workflow event lifecycle: `waiting → called → seated|no_show|cancelled` with `extend` branch — workflow's `recompute_eta` step already publishes via `publishReservationEvent(...)` so the diner status card auto-updates without new wiring.
- `seed-demo.ts` populates 3 reservations (waiting/called/seated) using REAL service layer — Phase 3 development starts every dev session against known-good fixture data.
- `npm run dev:reset` + `npm run smoke:mcp` + `npm run smoke:money-shot --dry-run` all green. Phase 3 plans must NOT regress these.
- Auth.js v5 magic-link via Resend live in production (https://zero-to-agent-xi.vercel.app). STAFF-01 validated; the `/queue` route is authenticated and the maître session shape is `{ user: { email } }` (NOT `{ user: { id } }` — see Phase 2 D-29 / 02-06 deviation #5). Defense in depth: SSE handlers AND Phase 3 panel page MUST re-check `employees.active = true` on every render/connect.

</domain>

<decisions>
## Implementation Decisions

### Chatbot UX shape, push delivery, and `/api/chat` wiring (DINER-01..08, SAFE-02; Pitfalls #5, #8, #9, #16, #21)

- **D-01:** **Chatbot is full-page at `/` (replaces Phase 1's placeholder landing).** Single-purpose surface — diner arrives, chats, leaves. Mobile-first, single-column, `max-w-md` chat thread + sticky composer at bottom. Branded chrome stays minimal: H1 "Cola de Espera" + 1-line tagline at top, no nav. shadcn/ui `Button` + `Input` + a custom chat-bubble component scaffolded via `v0`. NO floating widget, NO embedded panel — for v1 the diner has ONE job, the chat IS the page. (Floating-widget shape is a v2 affordance for restaurants that want to embed the queue inside their own site.)

- **D-02:** **`/api/chat` Route Handler shape:**
  - `app/api/chat/route.ts` exports `POST` (no GET/PUT/DELETE).
  - `runtime = "nodejs"`, `maxDuration = 60`, `dynamic = "force-dynamic"`.
  - Uses `streamText({ model: "anthropic/claude-sonnet-4.6", messages: convertToModelMessages(uiMessages), tools, system, stopWhen: stepCountIs(5), temperature: 0.2 })` — model id has a DOT not a dash (Pitfall in scope's pseudocode), `stopWhen: stepCountIs(5)` prevents the infinite-tool-loop bug (Pitfall #8 — vercel/ai #7502, #9384), `temperature: 0.2` reduces variance (Pitfall #21).
  - Returns `result.toUIMessageStreamResponse()` for AI SDK v6 client compatibility.
  - Reads `X-Reservation-Session` header (or body field) from the client → forwards as the resolved session in the tool wrappers below. NEVER puts `session_token` in `system` or in tool inputSchema.

- **D-03:** **Tool wiring: 4 tools defined inline in `/api/chat` using `tool({ inputSchema, execute })` from `ai`. Each tool's `execute` is a 5–15 LOC wrapper around `lib/services/*` — NEVER `experimental_createMCPClient`, NEVER HTTP self-call to `/mcp/mcp`** (Phase 2 D-36 ARCHITECTURE Anti-Pattern 1, locked).
  - `register_diner` → `lib/services/reservations.ts → createReservation({ name, email, phone, party_size })`. Returns the result so the LLM can speak the confirmation. UI confirmation badge reads from `result.ok && result.data.reservation_id` (NEVER from LLM text — Pitfall #16).
  - `get_my_status`, `extend_my_wait`, `cancel_my_reservation` → resolve `reservation_id` server-side from the request's `X-Reservation-Session` header (the chat client posts it on every request once localStorage has it). Tool inputSchema is `z.object({}).passthrough()` — LLM has NO way to act on someone else's reservation (Pitfall #5 mitigation, mirrors Phase 2 D-03 / D-06 for the public MCP).
  - All four `tool()` schemas use `.passthrough()` (NOT `.strict()`), `z.coerce.number()` on numerics, `safeParse` not `parse` (Phase 2 D-05). Validation failures return `{ ok: false, error: { code: "INVALID_INPUT", message: "Spanish-friendly", fields: {...} } }`.

- **D-04:** **System prompt is locked to a SHORT, RIGID Spanish prompt with explicit echo-back-before-confirm rule. SAFE-02 contract:**
  - Persona: "Sos el host del restaurante. Ayudás a los comensales a anotarse en la cola, consultar su lugar, pedir más tiempo o cancelar. Hablás en español rioplatense, amable y empático."
  - **Rule 1 (echo-back):** "ANTES de llamar `register_diner`, repetí los datos que recolectaste y pedí confirmación: 'Confirmás: Juan, juan@example.com, +5491122334455, 4 personas?'. Solo llamás al tool si el comensal confirma con sí/dale/correcto."
  - **Rule 2 (never fabricate):** "NUNCA digas 'estás registrado/llamado/cancelado' sin que el tool haya devuelto `ok: true` con `reservation_id`. Si el tool devuelve `ok: false`, explicale el `error.message` en español y NO reintentes el mismo tool."
  - **Rule 3 (refuse off-topic):** "Si te preguntan algo que no es la cola del restaurante, respondé: 'Solo te puedo ayudar con la cola del restaurante. ¿Querés anotarte o consultar tu reserva?'"
  - **Rule 4 (clarify ambiguous inputs):** "Si el comensal dice 'somos 4 o 5' o 'tal vez un bebé', pedí precisión: 'Para anotarte necesito un número exacto. ¿Son 4 o 5 personas?'"
  - **Rule 5 (no future booking):** "Esta es una cola de espera para ahora, no reservas para mañana. Si te piden 'reservar para mañana a las 8', explicales: 'Manejamos solo la cola de hoy. ¿Querés anotarte ahora?'"
  - System prompt is single string ≤ 800 tokens. Validation: ≥10 weird-real-input conversations tested before merging (Pitfall #21 — fixture lives in `__tests__/chatbot-conversations.fixture.json` — actual test runs against the prompt + tool schemas, not against the live LLM, so it's deterministic and CI-safe; live `/api/chat` smoke is manual).

- **D-05:** **Push delivery UX:** A SINGLE sticky banner sits ABOVE the chat thread, hidden by default. The diner page subscribes to `/api/events/[reservation_id]?session_token=<token>` once localStorage holds the session. Banner state machine:
  - `status === "waiting"` → banner hidden, status card shows "Posición #N · ETA Xmin" (small, dismissable-no, top of page).
  - `status === "called"` (event `called`) → banner shown big-and-prominent: **"TU MESA ESTÁ LISTA"** + sub-line "Acercate al maître". Background color from `colors_by_party_size` accent. AnnounceLive (`aria-live="assertive"`) for screen readers.
  - `event.type === "followup_proactive"` (1 min after `called` if no diner action) → banner mutates into "¿Estás en camino?" + two quick-reply chips: `[Pedir más tiempo]` `[Cancelar]`. Chips post structured messages into the chat (`sendMessage({text: "dame 5 más"})` and `sendMessage({text: "no voy a ir"})`) so the LLM still drives the tool call — UI doesn't bypass the LLM. (Quick-reply chips are NOT tool buttons; they are pre-canned natural-language messages. Keeps the chatbot the single source of action, no parallel UI/LLM divergence.)
  - `status === "seated"` → banner mutates: "Bienvenido. Disfrutá la cena." + button "Salir". Clears localStorage on click.
  - `status === "cancelled"` or `status === "no_show"` → banner mutates: empathic recoverable copy per SAFE-03 + button "Anotarme de nuevo". Clears localStorage on click.

- **D-06:** **Quick-reply chips render as a horizontal-scrolling row directly under the banner when in `called` or `followup_proactive` state.** They are NOT permanently visible — only when the workflow is in a state where extend/cancel are valid actions. Chips are buttons styled as pills (shadcn `Button variant="outline" size="sm"`). On click → `sendMessage({text})` into `useChat` → LLM sees the message, calls the tool, banner updates via SSE on tool success. (Belt-and-suspenders: chip click also writes to localStorage `lastIntent` so reload-during-action doesn't lose context.)

- **D-07:** **Spanish error copy from tools is rendered as a chatbot message, NOT a toast.** When a tool returns `{ ok: false, error: { code, message } }`, the LLM (per D-04 Rule 2) speaks the `error.message` to the diner in chat. UI shows no separate error UI for tool errors — the chat IS the error UI. This keeps the conversational metaphor intact and prevents tool errors from feeling like the app crashed. Network-level errors (chat API itself unreachable) DO show a small banner at top: "No pude contactar al servidor. Intentá de nuevo en un momento." (NOT in chat — because the chat itself is what failed).

### Diner state persistence + return UX (DINER-01..08; ARCHITECTURE §3.3, Phase 0.5 cookie cut, Pitfall #10)

- **D-08:** **localStorage holds two keys, written ONLY after successful `register_diner`:**
  - `restaurant_queue:session_token` — the `session_token` UUID from `createReservation`'s response.
  - `restaurant_queue:reservation_id` — the `reservation_id` UUID (used to construct the SSE URL).
  These are written from the chatbot client's `onToolResult` lifecycle hook of `useChat` (or equivalent — `useChat` v6 surfaces tool results in `messages[].parts[type==="tool-result"]`; the client component reads them and persists). NEVER set during streaming response from the server (Pitfall #10). NEVER as cookie (Phase 0.5 cut, locked).

- **D-09:** **On every page mount of `/`, the client-side hydration sequence is:**
  1. Read `restaurant_queue:session_token` from localStorage. If absent → render welcome state (just the chatbot greeting), nothing else.
  2. If present → call a small Server Action or `/api/me?session_token=<token>` Route Handler that wraps `lib/services/reservations.ts → getReservationStatus({ session_token })`.
     - If response is `{ ok: false, error: "INVALID_SESSION" }` OR the resolved status is `seated`/`no_show`/`cancelled` → clear localStorage, render welcome state. (Closed reservations don't keep the chat session alive; if the diner wants back in, they re-register.)
     - If response is `{ ok: true, data: { status, position, eta_min, ... } }` AND status is `waiting`/`called` → render the persistent status card ABOVE the chat ("TU RESERVA: posición N · ETA Xmin · estado X") and open SSE to `/api/events/[reservation_id]?session_token=<token>`.
  3. **NEW conversation always starts fresh.** Chat history is NOT persisted across reloads in v1 — `useChat`'s default behavior. The status card + SSE banner ARE the persistent affordances; the chat is ephemeral. (Persisting chat history is a v2 affordance and would require either localStorage with PII or a server-side message store with auth — both beyond hackathon scope.)
  - Trade-off: a returning diner sees a fresh greeting from the chatbot but ALSO sees their live status card immediately. The chatbot system prompt is updated (D-04 Rule 6) to acknowledge: "Si el usuario ya tiene una reserva activa, NO le pidas datos de nuevo. Saludá brevemente y ofrecé ayuda con su reserva existente."

- **D-10:** **`/api/me` Route Handler shape (NEW in Phase 3):**
  - `app/api/me/route.ts` exports `GET`.
  - `runtime = "nodejs"`, `maxDuration = 10`, `dynamic = "force-dynamic"`.
  - Reads `?session_token=<uuid>` query param (mirror of D-28 from Phase 2 SSE diner auth). Calls `getReservationStatus({ session_token })` from `lib/services/reservations.ts`. Returns the same `ServiceResult<T>` JSON shape.
  - PII-safe: does NOT echo `name/email/phone` back to the client (the client doesn't need them — the chat already collected them; the status card only needs `position`, `eta_min`, `status`, `extension_count`, `called_at`, `no_show_deadline`). The endpoint projects only those columns. (Defense against Pitfall #15 leaking PII into the page source / client-side React state.)
  - `lib/log.ts` redacts the `session_token` query string from any logged URL per Phase 2 D-21.

- **D-11:** **No cookie work in Phase 3.** The cookie-during-streaming pattern is permanently cut (Phase 0.5 + REQUIREMENTS Out-of-Scope). If v2 ever wants 24h session persistence, the path is (a) localStorage (already in place — extend TTL semantics) or (b) pre-set cookie in a NON-streaming route handler BEFORE the chat opens — both are v2 exercises.

### Maître panel: layout, real-time updates, history, undo (STAFF-02..09, PLAT-08; Pitfalls #6, #7)

- **D-12:** **TWO routes (not a toggle):**
  - `/queue` — active reservations (status IN `waiting`, `called`). Default landing for the maître. Replaces Phase 1's stub.
  - `/queue/history` — closed reservations of the day (`seated`, `no_show`, `cancelled`). Separate route per STAFF-08; the "filter toggle on `/queue`" alternative was rejected because it makes the active queue noisier and confuses the SSE subscription model (active panel subscribes to `queue:active`; history page is a one-shot DB read with optional client-side polling at 30s intervals — no SSE needed).
  - Both routes are auth-gated by `proxy.ts` (Phase 1 D-23 / D-27 already covers `/queue/:path*`). Both re-validate `employees.active = true` server-side on render (defense in depth, mirroring Phase 2 D-29).
  - A small nav bar at the top of `/queue` and `/queue/history` lets the maître switch (`Activas` | `Historial` links). No global app shell needed — two routes, two purposes.

- **D-13:** **`/queue` layout: card-grid, mobile-first, single column on phone, 2-column on tablet, 3-column on desktop.** Tailwind grid: `grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3`. Card vs table chosen because (a) the panel runs on the maître's phone at the host stand, (b) STAFF-04 color coding reads better as a card affordance, (c) action buttons need finger-target size (44px+). Table layout is rejected for mobile UX. Each card shows:
  - Top: party size badge + name (truncate w/ tooltip if long) + "extendido ×N" badge if `extension_count > 0`.
  - Middle: `Esperando hace X min` (computed from `created_at`, refreshed every 30s by client — NOT by SSE, this is purely cosmetic) + `ETA Y min` + status pill.
  - Bottom: action buttons depending on status — `[Llamar]` if waiting, `[Marcar presentado]` if called, both disabled if not in the right state. Disabled state shows tooltip ("Solo disponible si la reserva está esperando/llamada").

- **D-14:** **STAFF-04 color treatment: LEFT-BORDER COLOR BAND only.** Card has `border-l-4` with the color from `colors_by_party_size`. Background stays neutral (white / dark slate by theme). Reasons: (a) tinting the WHOLE card kills text readability for long names (Edge Config palette has light-pastel hex values), (b) badge-only is too weak — the maître scans 10 cards at a glance, the LEFT-BORDER is the strongest peripheral-vision affordance without visual noise, (c) Edge Config palette `{"1-2":"#A8E6CF","3-4":"#FFD3B6","5-6":"#FFAAA5","7+":"#D5AAFF"}` are designed as accent colors. The party-size badge in the top-right of the card REPEATS the color (small fill chip with the size number) so the signal is doubled. **Live edits to `colors_by_party_size` from the dashboard take effect on next page load** — this IS scenario 5 of the demo video (Edge Config en vivo). NO redeploy required.

- **D-15:** **Real-time update strategy: WAIT-FOR-SERVER on actions, OPTIMISTIC ON DELETE-FROM-LIST when SSE confirms.**
  - When the maître clicks `[Llamar]` → button enters loading state, POST to `/api/queue/[id]/call`. On 200, leave the card in place (state will transition via SSE) and the SSE event flips status to `called` and the card re-renders with the next action.
  - When the maître clicks `[Marcar presentado]` → button enters loading state, POST to `/api/queue/[id]/seated`. On 200, leave the card in place — SSE arrives, the staff page filters out anything with status NOT IN (`waiting`,`called`), card disappears from grid.
  - **No optimistic UI on actions** because (a) the maître's panel is the SOURCE of truth for actions (no other surface is firing these), (b) the staff API endpoints are 5–15 LOC wrappers and respond in <200ms locally, (c) optimistic-then-rollback is more visually disruptive than a 200ms loading spinner. (Optimistic on actions would also race with the SSE stream for state ownership — wait-for-server keeps a single linear update path: action → server → SSE → UI.)
  - **Connection state is visible:** small dot in the nav bar (`green` when SSE is connected, `yellow` when reconnecting, `red` if reconnect fails 3 times in a row → user must refresh). Snapshot-replay-on-connect (Phase 2 D-27) means temporary disconnects are invisible to actions; the dot is informational.

- **D-16:** **STAFF-09 SHIPPED in Phase 3 (Reabrir / undo no_show).**
  - New backend endpoint: `POST /api/queue/[id]/reopen` — 5–15 LOC wrapper around a NEW service function `lib/services/queue.ts → reopenNoShow(reservationId)`. The service function: validates current `status === 'no_show'`, executes a `start(reservationWorkflow, [{reservationId}])` (NEW workflow run — the original workflow has already terminated), updates `reservations.status = 'waiting'`, clears `ended_at` + `no_show_deadline`, increments a `reopen_count` field (NEW column — see D-17), publishes `queue:active` + `reservation:<id>` events.
  - Frontend affordance: `[Reabrir]` button on each `no_show` card in `/queue/history`, with a confirm dialog ("¿Confirmás reabrir? Se va a crear una nueva entrada en la cola activa."). Single-click, full round-trip.
  - **Why ship vs cut:** STAFF-09 is in PROJECT.md cut list at #3, BUT the underlying mechanic (a new workflow run for the same reservation row) is a 30-LOC service function + 1 endpoint + 1 button + 1 dialog. <2 hours. The pilot's real failure mode is "diner arrived 5 min late" — without Reabrir the maître has to explain "you're already a no-show, go re-register from the waiting room QR" which is a brutal pilot experience. Ship it. (Cut still in effect AT THE PLAN LEVEL: if Phase 3 plan-phase / executor agent runs over time, this is the FIRST cut within Phase 3 along with PLAT-08 quality.)
  - **Schema addition:** `reopen_count INTEGER NOT NULL DEFAULT 0` on `reservations`. Migration `db/migrations/0003_reopen_count.sql`. Forward-only, no backfill needed (no existing pilot data yet). Audit row in `reservation_events` with `event_type = 'reopened'`.

- **D-17:** **`/queue/history` layout: TABLE not cards (read-only data, dense, audit-feel), with a single `[Reabrir]` action column for `no_show` rows.** Columns: arrival time | name | party size | status | duration in queue | action. Sorted by `ended_at DESC` (most recent first). Day-scoped filter: rows where `DATE(created_at AT TIME ZONE 'America/Argentina/Buenos_Aires') = CURRENT_DATE`. Single-day for v1; multi-day with date picker is v2 (STAFF-11). Page polls `/api/queue/history` every 30s for fresh data (new closed reservations land here as workflow exits) — NO SSE on the history page (the data is already terminal; live updates would just spam re-renders).

- **D-18:** **Action confirmations: Reabrir DOES confirm; Llamar/Marcar presentado do NOT.** Llamar and Marcar presentado are reversible-by-action (you can call the wrong table and still mark them presentado; you can mark presentado early and the maître talks to the diner). Reabrir is the EXTRAORDINARY action — confirms because it spins up a new workflow run, fires push events, costs money, and the maître should think twice before doing it during the pilot. Confirm dialog uses shadcn `AlertDialog`.

- **D-19:** **Empty / loading / error states:**
  - `/queue` empty (no active reservations): friendly Spanish copy "No hay reservas activas. Cuando alguien se anote, va a aparecer acá." + a small "Última actualización: HH:MM:SS" timestamp.
  - `/queue` loading (initial fetch before SSE attaches): 3 skeleton cards (shadcn `Skeleton`).
  - `/queue` SSE error after 3 failed reconnects: red banner at top "Sin conexión en vivo. Refrescá la página." + the last-known snapshot stays visible (don't blank the screen).
  - `/queue/history` empty: "No hay reservas cerradas hoy."
  - `/queue/history` loading: skeleton table rows.
  - Action button error (e.g., `409 RESERVATION_ALREADY_CLOSED` if the diner cancelled while the maître was about to click Llamar): toast (shadcn `Sonner`) with the Spanish error message + the button auto-disables (the SSE update is also coming).

### DurableAgent ETA scope (PLAT-08; cut list #1)

- **D-20:** **Phase 3 ships the deterministic formula INSIDE a `@workflow/ai/agent` wrapper, not the LLM-tuned variant.** The `recompute_eta` step in `lib/workflows/reservation.ts` already exists from Phase 2 (Claude's Discretion item — the formula is `position * avg_turnover_min` from Edge Config). Phase 3 swaps the BODY only (D-11 freeze rule allows this — see `lib/workflows/_README.md` "How to Add a New Step Safely") to wrap the deterministic computation inside the agent constructor:
  ```ts
  // Inside step body — NEVER at router level
  const agent = new DurableAgent({ ... });
  const eta = await agent.run({ position, partySize, avgTurnoverMin });
  // Inside agent.run, the system prompt forces deterministic output — formula in, formula out.
  ```
  This satisfies Track 2 narrative ("ETA estimated by an agent") with zero LLM cost AND zero quality risk. The agent CAN be promoted to LLM-tuned later by changing the agent's tool/prompt — still a step BODY change, still safe.
- **D-21:** **LLM-tuned ETA is a 4h-capped spike, NOT a Phase 3 commitment.** Spike scope: feed the agent a small history table (`reservation_events` JOIN with party_size) and ask it to estimate ETA in minutes. Compare against the deterministic formula across 20 historical reservations from the seed-demo workflow runs. Ship the LLM-tuned version ONLY IF the agent's ETA is visibly closer to actual `seated_at - created_at` than the formula AND the LLM cost is <$0.01 per recompute. Otherwise the formula stays. **Either way the wrapper stays.** Decision deferred to plan-phase / executor; the spike is a Phase 3 plan task.
- **D-22:** **`recompute_eta` step body MUST stay deterministic-on-replay.** WDK replays steps; if the agent's LLM call is non-deterministic the workflow's stored output won't match the replayed value, breaking durability. Mitigation: (a) `temperature: 0` on the agent's LLM (if used), (b) the step result is what's persisted — the agent runs ONCE per step invocation, and `eta_min` is sampled-and-stored on the row exactly like `no_show_deadline` is in Phase 2 D-13. Sample-once-and-store discipline applies. Edge Config `eta_recompute_interval_sec` controls how often the workflow re-enters the recompute step.

### AI SDK ↔ PII redactor wiring (SAFE-01 carry-forward, Phase 2 D-22; Pitfall #15)

- **D-23:** **AI SDK `experimental_telemetry` config in `streamText({...})` MUST route through `lib/log.ts → redactPII`.** Specifically: pass `experimental_telemetry: { isEnabled: true, recordInputs: false, recordOutputs: false, metadata: { redacted: true } }` — disable input/output recording at the SDK level for v1. (Future v2 may want to log conversations for QA — at that point a custom `Tracer` implementation that wraps every span attribute through `redactPII` becomes mandatory. Documented in `lib/log.ts` JSDoc as a forward-pointer.)
- **D-24:** **Tool-call lifecycle hooks (`onStepFinish`, `onFinish` in `streamText`) MUST log via `log.info(...)` not raw `console.log`.** Plan-phase / executor agent enforces this via grep step (`grep -nE 'console\.(log|warn|error)' app/api/chat/route.ts | grep -v 'lib/log'` returns 0).
- **D-25:** **Conversation-content redaction:** The Phase 3 chat is allowed to ECHO back name/email/phone in the conversation as the LLM speaks (echo-back per D-04 Rule 1) — that data lives in the user's browser tab, not in server logs. But ANY server-side log from the chat route (`log.info("chat.tool.invoked", { tool, status })`) MUST exclude the actual tool args because they contain PII. Convention: log tool NAME and tool RESULT shape (`{ ok: true|false, error_code? }`), never the args. Codified in a code review checklist line item for Phase 3 PRs.

### Spanish copy guidelines (SAFE-03 carry-forward; Phase 2 specifics §)

- **D-26:** **Tone is rioplatense (vos, tu/tuyo, "che" not used) — friendly, empathic, recoverable. NO punitive copy anywhere.**
  - Welcome (chatbot greeting): "¡Hola! Soy el host. ¿Querés anotarte en la cola?"
  - Confirmation echo-back (LLM rule, see D-04): "Confirmás: {name}, {email}, {phone}, {party_size} personas?"
  - Confirmation success (LLM speaks after `register_diner` returns `ok:true`): "Listo, te anoté. Sos el número {position} en la cola, te esperamos en aproximadamente {eta_min} minutos. Te aviso por acá cuando esté tu mesa."
  - Push: "TU MESA ESTÁ LISTA" — uppercase, single-line. Translates as urgency.
  - Followup: "¿Estás en camino?" + chips `[Pedir más tiempo]` `[Cancelar]`.
  - No-show automated message (SAFE-03, locked from REQUIREMENTS): "Marcamos tu reserva como no-show porque no llegamos a verte. Si querés volver a anotarte, abrí esta página de nuevo."
  - Tool error examples: `MAX_EXTENSIONS_REACHED.message = "Ya pediste todas las extensiones. Si necesitás más tiempo, hablá con el maître al llegar."` `RESERVATION_ALREADY_CLOSED.message = "Tu reserva ya está cerrada. Si querés volver a anotarte, abrí la página de nuevo."` All errors are recoverable-suggesting, not blame-assigning.
- **D-27:** **Maître panel copy is brief and operational (NOT empathic):** "Llamar", "Marcar presentado", "Reabrir", "Esperando hace 12 min", "Posición #3 · ETA 18 min", "Sin conexión en vivo". Audience is the maître at the host stand — terse Spanish over warm Spanish.

### Wiring contract — what new files Phase 3 creates

- **D-28:** **NEW files Phase 3 ships:**
  - `app/page.tsx` — REPLACES the Phase 1 placeholder. Client component (or RSC + "use client" island) hosting `useChat` + status card + push banner + chat thread + composer.
  - `app/api/chat/route.ts` — POST handler with `streamText` + 4 inline tool wrappers around `lib/services/reservations.ts`.
  - `app/api/me/route.ts` — GET handler returning `getReservationStatus({session_token})` projection.
  - `app/api/queue/history/route.ts` — GET handler for `/queue/history` polling.
  - `app/api/queue/[id]/reopen/route.ts` — POST handler wrapping `reopenNoShow(id)`.
  - `app/queue/page.tsx` — REPLACES the Phase 1 stub. Server component reading `getActiveQueue()` for SSR snapshot, client island handles SSE + actions.
  - `app/queue/history/page.tsx` — Server component reading `/api/queue/history` server-side or directly.
  - `components/chat/` — `chat-thread.tsx`, `chat-composer.tsx`, `status-card.tsx`, `push-banner.tsx`, `quick-reply-chips.tsx` (scaffolded via v0).
  - `components/queue/` — `queue-card.tsx`, `queue-grid.tsx`, `connection-dot.tsx`, `nav-bar.tsx`, `history-table.tsx`, `reopen-dialog.tsx`.
  - `lib/hooks/use-reservation-events.ts` — wraps `EventSource` + Last-Event-ID + reconnect/backoff for the diner page. (Optional — could be inline in `app/page.tsx`; decided as a hook for testability.)
  - `lib/hooks/use-queue-events.ts` — same pattern for the maître panel.
  - `db/migrations/0003_reopen_count.sql` — adds `reopen_count INTEGER NOT NULL DEFAULT 0` column.
  - `__tests__/chatbot-conversations.fixture.json` — 10 weird-real-input conversations (ambiguous party size, "para mañana", "tal vez un bebé", off-topic, etc.) + the asserter that runs each through the system prompt + tool schemas (NOT against live LLM — uses fixture LLM outputs to validate the SHAPE of the tool calls, not the LLM's quality).
  - `lib/services/queue.ts` — ADD `reopenNoShow(id)` export. NOT a new file; the existing 4-export file from Phase 2 grows to 5 exports.

- **D-29:** **NEW dependencies Phase 3 adds:** `ai@^6` + `@ai-sdk/react@^6` + `@ai-sdk/anthropic@^2` (in case the AI Gateway routes need direct provider package, though the string model id is preferred per CLAUDE.md). NO additional UI deps (shadcn already covers everything via `components/ui/`). NO test framework switch — keep `node:test` via `tsx` per Phase 2 D-23 convention.

- **D-30:** **Spike scheduling: AI SDK `useChat` v6 lifecycle spike is the FIRST plan-phase task in Phase 3.** The roadmap and SUMMARY both flag this — `useChat` + `DefaultChatTransport` + `sendMessage({text})` lifecycle changed in v5→v6, and the tool-call lifecycle on the client (how `messages[].parts[type==="tool-result"]` surfaces) is the foundation for D-08 localStorage hydration. **Spike scope:** `scripts/spike-usechat-lifecycle.ts` (or a sandbox `app/spike-chat/page.tsx` that ships under a feature flag, removed before merge). Walks 3 conversations end-to-end against `/api/chat` with mock service-layer functions, asserts: (a) `tool-result` parts arrive on the client, (b) `result.ok && result.data.reservation_id` is readable from client state, (c) `stopWhen: stepCountIs(5)` actually halts after 5 tool calls (regression test for vercel/ai #7502). Cap: 2h. If the spike reveals a v6 footgun, the plan-phase agent updates `lib/workflows/_README.md` AND `D-04`/`D-08` BEFORE Phase 3 implementation begins.

- **D-31:** **Push-to-prod-every-phase discipline (Pitfall #19) is preserved:** Phase 3 plans push to prod via `git push origin main` after each plan completes (auto-deploy from Phase 1 D-13). The full chatbot end-to-end is testable on the production URL during Phase 3 development; the maître panel rebuild does NOT take down the production `/queue` route during Phase 3 (Phase 1 stub stays live until the new panel is merged in a single atomic commit per plan).

### Folded Todos

None — `gsd-sdk query todo.match-phase 3` returned 0 matches.

### Claude's Discretion

Plan-phase / executor agents have flexibility on:
- Exact file boundaries inside `components/chat/` and `components/queue/` (could collapse `quick-reply-chips.tsx` into `push-banner.tsx`; could split `queue-card.tsx` into card-header / card-body / card-actions)
- Exact v0 prompts used to scaffold the components (use them as scaffolds — manual cleanup after pasting is expected and assumed)
- Whether the diner status card lives in `app/page.tsx` directly or as a separate `<StatusCard />` component (default: separate component for testability)
- Choice of toast library (default: shadcn `Sonner`)
- Polling interval for `/queue/history` (default: 30s; tunable via Edge Config later if pilot needs it — NOT a v1 Edge Config key)
- Connection-dot color thresholds (default: green=connected, yellow=reconnecting <3 attempts, red=>=3 failed reconnects)
- Whether the empty-state of `/queue` shows a static illustration or just text (default: text — shipping speed)
- Whether STAFF-09 confirm dialog is shadcn `AlertDialog` or a custom inline confirm (default: AlertDialog — accessible, short)
- How verbose the LLM's "thinking" / intermediate text streams (default: minimal — keep the chat bubbles short and action-driven; shorter text = less variance per Pitfall #21)
- Whether the AI SDK `experimental_telemetry` is enabled at all in Phase 3 (default: enabled with `recordInputs:false, recordOutputs:false` per D-23 — gives request count + latency without PII risk; can be toggled via env var if it noisily shows up in Vercel observability)
- Final wording of all Spanish copy (must align with D-26 tone — rioplatense, empathic, recoverable; reviewable by user before final demo)
- Whether `useChat`'s message-history truncation is implemented (default: defer; conversations are short — under 30 msgs typically — and Phase 3 doesn't need server-side history truncation for v1; if `/api/chat` token cost becomes painful in pilot, revisit)
- Whether the chatbot greets the returning diner by name (e.g., "Hola Juan, te llamamos en X min") (default: NO — greeting in v1 is generic since the chatbot doesn't know the user's name without a prior reservation, and PII-on-page is a privacy concern; if shown, it would only be after `getReservationStatus` returns the row's `name` and that's gated by `session_token` — feasible but defer to Phase 4 polish)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project artifacts (always read first)
- `.planning/PROJECT.md` — vision, scope, key decisions table, constraints (Spanish-only, real-pilot-same-week, cut list — STAFF-09 was at #3 cut, Phase 3 ships it per D-16; PLAT-08 at #1 cut, Phase 3 ships formula-wrapped-in-agent per D-20)
- `.planning/REQUIREMENTS.md` — Phase 3 reqs: DINER-01..08, STAFF-02..09, PLAT-08, SAFE-02, SAFE-03; full Out-of-Scope table including the SAFE/SECURITY/PILOT items deferred to Phase 4
- `.planning/ROADMAP.md` §"Phase 3: User Surfaces" — goal-backward success criteria 1–5 (diner happy path, diner real-time push, diner self-serve in natural Spanish, maître panel, no-show empathic close); phase-mapped pitfalls #6/#8/#10/#16/#21; required spike (AI SDK v6 `useChat` lifecycle); first cut within phase (PLAT-08 quality)
- `.planning/STATE.md` — accumulated context + locked decisions table; "Phase 3 consumes Phase 2 artifacts UNCHANGED" contract; STAFF-09 cut-list status
- `.planning/phases/01-foundation/01-CONTEXT.md` — Phase 1 decisions to inherit (D-09/D-10/D-11/D-12 employees gate + anti-enum copy; D-19 env validation; D-25/D-26 repo + lib subdir convention; D-27 proxy.ts auth gate covers `/queue/:path*`)
- `.planning/phases/02-backend-core/02-CONTEXT.md` — Phase 2 decisions to inherit (D-04 tool error contract; D-09 active_hook_token column; D-11 SINGLE-FILE workflow; D-13 sample-once-and-store Edge Config; D-18 service layer 2 files / 8 funcs; D-21 lib/log.ts shape; D-22 AI SDK telemetry deferred to Phase 3 — paid here in D-23/D-24/D-25; D-24/D-25/D-26/D-27 KV channels + SSE shape; D-28/D-29 SSE auth; D-30 staff API endpoints; D-32 seed-demo via real services; D-36 chat calls services directly NOT via MCP; D-37 hook resume in-process)
- `.planning/phases/02-backend-core/02-VERIFICATION.md` — Phase 2 verified state (8 plans complete, money-shot harness ready, `/api/events/*` + `/api/queue/*` + `/mcp/*` all live in production)
- `CLAUDE.md` (project root) — locked stack (Next.js 16 + `proxy.ts`, AI SDK v6 + `sendMessage({text})`, model id `anthropic/claude-sonnet-4.6` DOT, mcp-handler@1.1.0, workflow not @vercel/workflow, `@neondatabase/serverless` + `pg.Pool`, `@upstash/redis`, `next-auth@beta`); top 5 pitfalls (cookie-during-streaming forbidden, WDK race + DB safety net, MCP tool poisoning gate, Resend domain, SSE timeout heartbeat); code style + conventions (Spanish for user-facing copy, no comments, PII-redacted logs, Zod `.passthrough()`, no Date objects across step boundaries)
- `scope_hackathon_mvp.md` — original scope reference (§8 chatbot frontend, §9 maître panel, §10 DurableAgent ETA — pseudocode has stack errors; defer to STACK.md when in conflict)

### Stack & architecture (locked)
- `.planning/research/STACK.md` §"Highest-risk integration snippets" §4 (AI SDK chatbot exact `useChat` v6 + `streamText` snippets — model id DOT, `convertToModelMessages`, `toUIMessageStreamResponse`, `DefaultChatTransport`), §5 (Auth.js v5 + Resend snippet — already implemented in Phase 1 but reference for staff session shape), §6 (Edge Config reads via `@vercel/edge-config` — `colors_by_party_size` consumption); also the "What NOT to Use" table including the AI SDK v5 → v6 migration callouts
- `.planning/research/ARCHITECTURE.md` Pattern 1 (service-layer funnel — chatbot tools are thin wrappers, staff actions are thin wrappers; both call `lib/services/*` directly), Pattern 2 (hook-resume in-process — staff API does this, NOT chat client), Pattern 3 (SSE handler = subscribe + replay-on-connect — chatbot consumes `/api/events/[reservation_id]`, panel consumes `/api/events/queue` — both already shipped in Phase 2), Pattern 4 (cookie strategy — D-11 here: NO COOKIES; localStorage only), Pattern 5 (Edge Config inside steps — `colors_by_party_size` is read on the CLIENT in Phase 3 page render, not in workflow; both are valid uses, but the workflow-level access stays inside `"use step"`); Critical Journeys 1–4; Anti-Patterns 1–6 (especially #1 HTTP self-call from chat to MCP — explicitly forbidden in D-03; #4 cookie-after-first-byte — explicitly forbidden in D-11)
- `.planning/research/SUMMARY.md` §3 (5 architectural commitments — all 5 honored in Phase 3: service-layer funnel D-03, snapshot-replay D-15, no cookie-during-stream D-11, frozen workflow D-20/D-22, hooks resume in-process — staff API does this, chat NEVER does), §5 "Phase 3 — User Surfaces" (collapse rationale + spike flag for `useChat` lifecycle), §6 (top-5 pitfalls — items 1/3 are pure Phase 3 enforcement, items 2/4/5 inherited from Phase 1/2), §7 (open questions: items 3 = MCP-from-chat DECIDED in Phase 2 D-36 carried forward in D-03; item 4 = DurableAgent ETA quality DECIDED in D-20/D-21; item 6 = STAFF-09 undo DECIDED in D-16 — SHIP), §8 (cut list reaffirmed: PLAT-08 at #1, STAFF-09 at #5 stretch — D-16 ships it as 2h work, still cuttable at plan-time if running over)
- `.planning/research/PITFALLS.md`:
  - #6 (SSE missed-message during reconnect — already mitigated in Phase 2 D-27 snapshot-replay; Phase 3 client uses `Last-Event-ID` per `lib/hooks/use-reservation-events.ts` D-28)
  - #7 (KV pub/sub subscriber slot leak — already mitigated in Phase 2 D-26 abort cleanup; Phase 3 client closes `EventSource` on unmount)
  - #8 (`stopWhen: stepCountIs(5)` on `streamText` — D-02; mitigates vercel/ai #7502 + #9384 infinite tool loop)
  - #9 (Zod `.passthrough()` not `.strict()`; coerce numerics) — D-03
  - #10 (cookie-during-streaming forbidden — D-11; locked from Phase 0.5)
  - #15 (PII redaction — D-23/D-24/D-25 wires AI SDK telemetry through `lib/log.ts` — promise from Phase 2 D-22 paid)
  - #16 (no fake-success — UI confirmation badge from server response, never LLM text) — D-03 + D-04 Rule 2
  - #17 (demo recording variance — temperature 0.2 in chat, rehearse Edge Config color edits) — D-02; the demo recording itself is Phase 4
  - #19 (push to prod every phase) — D-31
  - #21 (Spanish ambiguous-input handling — `temperature: 0.2`, system prompt rule for clarification, ≥10 weird inputs tested) — D-02 + D-04 Rule 4 + D-30 spike fixture

### Phase 1 + 2 code Phase 3 reuses or extends
- `lib/services/reservations.ts` — 4 funcs (`createReservation`, `getReservationStatus`, `extendWait`, `cancelReservation`); chatbot's 4 tools are 5–15 LOC wrappers around these (D-03)
- `lib/services/queue.ts` — 4 funcs from Phase 2 (`getActiveQueue`, `markCalled`, `markSeated`, `markNoShowManual`); ADD 5th: `reopenNoShow(id)` (D-16)
- `lib/workflows/reservation.ts` — FROZEN per D-11 from Phase 2; Phase 3 swaps the BODY of `recompute_eta` step ONLY (D-20). DO NOT touch step count or order.
- `lib/workflows/_README.md` — living architectural contract; Phase 3 plan-phase agent ADDS notes for the `recompute_eta` body change (D-20) and the AI SDK telemetry wiring (D-23) before code lands
- `lib/realtime.ts` — `publishReservationEvent` + `publishQueueEvent` already in use by service layer; Phase 3 SSE consumers are already wired (Phase 2 D-26/D-27)
- `lib/log.ts` — PII redactor; Phase 3 `/api/chat` + `/api/me` + new staff endpoint MUST use `log.*` (D-24)
- `lib/edge-config/index.ts` — `getTypedConfig()` for `colors_by_party_size` (D-14)
- `lib/auth/auth.ts` — `auth()` helper for `/queue` + `/queue/history` server components and the new `/api/queue/[id]/reopen` endpoint
- `lib/db/neon.ts` — `sql` template tag for `getActiveQueue` and the new history query
- `app/api/events/[reservation_id]/route.ts` — diner SSE endpoint; consumed by `lib/hooks/use-reservation-events.ts` (D-28)
- `app/api/events/queue/route.ts` — staff SSE endpoint; consumed by `lib/hooks/use-queue-events.ts` (D-28)
- `app/api/queue/[id]/{call,seated,no_show_manual}/route.ts` — Phase 2 staff actions; consumed by panel button handlers (D-15)
- `app/api/queue/route.ts` (GET) — Phase 2 snapshot; can be used by panel SSR (or panel can call `getActiveQueue()` directly — D-28 Server Component reads service layer)
- `db/migrations/0001_init.sql` + `0002_workflow_active_hook.sql` — schema base; ADD `0003_reopen_count.sql` (D-16)
- `scripts/seed-demo.ts` — daily dev fixture; Phase 3 work starts every dev session against 3 known-good reservations
- `scripts/smoke-test-mcp.sh` + `scripts/smoke-money-shot.sh` — Phase 2 smoke harness; MUST stay green throughout Phase 3
- `components/ui/button.tsx`, `components/ui/input.tsx` — shadcn primitives; Phase 3 adds (via `npx shadcn add`) `card`, `badge`, `skeleton`, `alert-dialog`, `sonner`, `dialog`, `dropdown-menu`, `tabs` (only the ones actually used)

### External docs (downstream agents may need to fetch)
- AI SDK v6 chatbot reference: https://ai-sdk.dev/docs/ai-sdk-ui/chatbot
- AI SDK v6 `useChat` API: https://ai-sdk.dev/docs/reference/ai-sdk-ui/use-chat
- AI SDK v6 `streamText` + `convertToModelMessages` + `toUIMessageStreamResponse`: https://ai-sdk.dev/docs/reference/ai-sdk-core/stream-text
- AI SDK v5→v6 migration: https://ai-sdk.dev/docs/migration-guides/migration-guide-6-0
- AI SDK `stopWhen` + `stepCountIs`: https://ai-sdk.dev/docs/ai-sdk-core/agents (and vercel/ai issue #7502 + #9384 referenced in PITFALLS.md #8)
- AI Gateway model id format `provider/model`: https://vercel.com/docs/ai-gateway/getting-started
- DurableAgent (`@workflow/ai/agent`) — wrapped agent inside workflow steps: https://workflow-sdk.dev/docs/integrations/ai (or whatever the Workflow SDK has shipped by 2026-04; Phase 3 plan-phase agent should fetch current docs)
- Vercel AI SDK telemetry / `experimental_telemetry`: https://ai-sdk.dev/docs/ai-sdk-core/telemetry
- shadcn/ui Card + Badge + Skeleton + AlertDialog + Sonner + Tabs: https://ui.shadcn.com/docs/components
- v0 (UI scaffolding tool): https://v0.dev — Phase 3 plan-phase agent uses for `chat-thread`, `queue-card` initial scaffolds; manual cleanup expected
- EventSource + Last-Event-ID: https://developer.mozilla.org/en-US/docs/Web/API/EventSource (browser-side reconnect behavior — informs `lib/hooks/use-reservation-events.ts` design)
- Tailwind v4 grid utilities: https://tailwindcss.com/docs/grid-template-columns

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets (from Phase 1 + Phase 2)

- **`lib/services/reservations.ts`** — 4 exported async functions, all return `ServiceResult<T>` tagged-union shape (Phase 2 D-18). Chatbot tools wrap these 1:1. Verified at file inspection 2026-04-26: `createReservation` (line 125), `getReservationStatus` (line 300), `extendWait` (line 354), `cancelReservation` (line 484).
- **`lib/services/queue.ts`** — 4 exported async functions; Phase 3 ADDS 5th (`reopenNoShow`). Maître panel reads `getActiveQueue()` directly in a Server Component for SSR snapshot, then SSE replaces with live updates.
- **`lib/workflows/reservation.ts`** — FROZEN. The `recompute_eta` step body is the ONE thing Phase 3 changes (D-20). The router and step boundary count are immutable per `_README.md`.
- **`lib/realtime.ts`** — `publishReservationEvent(id, event)` + `publishQueueEvent(event)`. Both consumed by service layer + workflow steps in Phase 2; Phase 3 doesn't add new publishers, only consumes via the 2 SSE endpoints.
- **`lib/log.ts`** — PII redactor + structured logger. `log.info/warn/error` is the ONLY log sink for Phase 3 client-server code. Raw `console.*` outside `lib/log.ts` is forbidden — Phase 3 PRs review with `grep -nE 'console\.(log|warn|error)\(' app/api/chat/route.ts | grep -v 'lib/log'` returns 0.
- **`lib/edge-config/index.ts`** — `getTypedConfig()` returns the full operational params; Phase 3 uses for `colors_by_party_size` (D-14) on the panel page.
- **`lib/auth/auth.ts`** — `auth()` helper for the new `/api/queue/[id]/reopen` endpoint and the `/queue` + `/queue/history` Server Components. Re-validates `employees.active = true` per Phase 1 D-11.
- **`lib/db/neon.ts`** — `sql` template tag for `/queue/history` data fetching and the new `reopenNoShow` service function.
- **`app/api/events/[reservation_id]/route.ts`** — Phase 2 SSE handler with snapshot-replay. Consumed by chatbot client via `lib/hooks/use-reservation-events.ts` (NEW Phase 3, D-28).
- **`app/api/events/queue/route.ts`** — Phase 2 SSE handler. Consumed by panel client via `lib/hooks/use-queue-events.ts` (NEW Phase 3, D-28).
- **`app/api/queue/[id]/{call,seated,no_show_manual}/route.ts`** — Phase 2 staff actions. Panel button handlers POST here (D-15). HTTP status mapping (401/403/404/409/400/500) per Phase 2 implementation refinement; panel handles each code with Spanish-friendly toast (D-19).
- **`app/api/queue/route.ts`** (GET) — Phase 2 snapshot. Panel CAN consume this OR call `getActiveQueue()` directly in a Server Component (D-28 prefers the latter — fewer round trips).
- **`app/api/auth/[...nextauth]/route.ts`** — Auth.js handlers; magic-link working in production.
- **`app/queue/page.tsx`** — Phase 1 stub; Phase 3 REPLACES with the live panel.
- **`app/page.tsx`** — Phase 1 placeholder landing; Phase 3 REPLACES with the chatbot.
- **`app/login/page.tsx`** — Phase 1 maître login; UNCHANGED in Phase 3.
- **`scripts/seed-demo.ts`** — daily fixture; 3 reservations in waiting/called/seated states. Phase 3 dev work starts every session against this.
- **`scripts/smoke-test-mcp.sh`** — Phase 2 5-step MCP smoke; Phase 3 MUST keep this green (especially after the `recompute_eta` body swap in D-20).
- **`components/ui/button.tsx`, `components/ui/input.tsx`** — shadcn primitives. Phase 3 adds via `npx shadcn add`: `card`, `badge`, `skeleton`, `alert-dialog`, `sonner`, `dialog`, `dropdown-menu`, `tabs` (only those used).

### Established Patterns (from Phase 1 + Phase 2)

- **Spanish for user-facing copy, English for code/comments, no comments unless WHY is non-obvious** (CLAUDE.md, applied throughout Phase 1 + Phase 2; Phase 3 honors).
- **Forward-only SQL migrations in `db/migrations/NNNN_<name>.sql`** with `_migrations` tracking. Phase 3 adds `0003_reopen_count.sql`.
- **TS scripts run via `tsx`**. Phase 3 may add `scripts/spike-usechat-lifecycle.ts` (D-30); production-deploy-blockers run as either `bash` smoke or `tsx` scripts per Phase 2 convention.
- **Re-export pattern for Auth.js handlers** (`import { handlers }; export const { GET, POST } = handlers`) — Phase 3 follows.
- **Service-layer funnel discipline:** chatbot tools are 5–15 LOC wrappers; panel actions go through Phase 2 staff API endpoints (which themselves are 5–15 LOC wrappers). NO HTTP self-calls (ARCHITECTURE Anti-Pattern 1).
- **PII safety:** never log raw reservation rows; project only the columns the client needs; `lib/log.ts` redacts everything via `redactPII`.
- **Auto-deploy via `git push origin main`** (Phase 1 D-13). Phase 3 inherits.
- **HTTP status code conventions on API routes** (Phase 2 D-30 implementation refinement): 401 (no session), 403 (signed-in but inactive employee), 404 (RESERVATION_NOT_FOUND), 409 (state-conflict), 400 (INVALID_INPUT/INVALID_SESSION), 500 (default). Panel UX (D-19) maps each code to Spanish-friendly user-visible copy.
- **Workflow shape FROZEN** — only step BODIES change. `lib/workflows/_README.md` is the rulebook; Phase 3 updates this file alongside the `recompute_eta` body swap (D-20).
- **Snapshot-replay-on-connect for SSE** — already shipped in Phase 2; Phase 3 client implementations (`lib/hooks/use-reservation-events.ts`, `lib/hooks/use-queue-events.ts`) MUST handle the initial `event: snapshot` BEFORE relying on subsequent `event: data` payloads.

### Integration Points

- **Chatbot lands at `/`** — REPLACES Phase 1 placeholder. Single-purpose surface, no nav. Client-side hydration sequence is D-09 (read localStorage → optional `/api/me` call → status card + SSE).
- **`/api/chat` Route Handler** — NEW. Inline `streamText` with 4 tool wrappers (D-02 + D-03). Critical that this calls `lib/services/*` directly, never `experimental_createMCPClient` (Phase 2 D-36).
- **`/api/me` Route Handler** — NEW. GET with query param `?session_token=<uuid>`. Wraps `getReservationStatus`, projects PII-safe columns only (D-10).
- **Maître panel at `/queue`** — REPLACES Phase 1 stub. Server Component reads `getActiveQueue()` for SSR; client island handles SSE + actions.
- **Maître history at `/queue/history`** — NEW route. Polled (30s), no SSE.
- **`/api/queue/history` Route Handler** — NEW. GET; auth-gated; returns rows where `DATE(created_at AT TIME ZONE 'America/Argentina/Buenos_Aires') = CURRENT_DATE` AND status closed.
- **`/api/queue/[id]/reopen` Route Handler** — NEW. POST; auth-gated; wraps `reopenNoShow(id)` (D-16).
- **`recompute_eta` step in `lib/workflows/reservation.ts`** — body swap to wrap formula in `@workflow/ai/agent` (D-20). Step boundary count UNCHANGED.
- **AI SDK `experimental_telemetry`** — wired through `lib/log.ts` per D-23/D-24/D-25; first AI-SDK consumer in the project, so Phase 3 sets the convention.
- **shadcn additions** — `npx shadcn add card badge skeleton alert-dialog sonner` (and any others discovered during planning); files land in `components/ui/`.
- **v0 scaffolds** — Phase 3 uses v0 for the chat-thread + queue-card initial designs; manual cleanup expected; the v0 outputs are starting points, not finals.

</code_context>

<specifics>
## Specific Ideas

- **Chatbot is the ENTIRE landing page at `/`.** No nav, no sidebar, no marketing — single conversion surface for the diner. Mobile-first because the typical use is "diner standing at the door scans a QR, opens link on phone, chats." Desktop is a side-effect, not a target.
- **The push banner "TU MESA ESTÁ LISTA" is the single most important UI moment in the demo.** It MUST appear within 2s of the maître clicking Llamar (Roadmap Success Criteria 2). Tested manually before each plan commit; the SSE infrastructure from Phase 2 (snapshot-replay + `Last-Event-ID`) makes this reliable.
- **The maître panel runs on the host stand's phone.** The maître is on their feet, glancing at the panel between greeting diners. Card-grid + left-border color band + finger-target buttons are NOT cosmetic — they're the access pattern.
- **STAFF-09 Reabrir SHIPS in Phase 3 (D-16) — this overrides the cut list #3 status.** The 2-hour cost is bounded; the pilot pain of NOT having it is unbounded. Plan-phase / executor agent may CUT it back at planning time IF the running estimate for Phase 3 is over budget by >2h; otherwise ship.
- **DurableAgent ETA wraps the FORMULA, not LLM-tuned.** The Track 2 narrative is preserved by the `@workflow/ai/agent` constructor, not by what the agent does internally. LLM-tuning is a 4h-capped spike (D-21) — ship deterministic, promote to LLM only if the spike clearly wins.
- **Quick-reply chips POST messages into the chat (D-06), NOT directly call tools.** Belt-and-suspenders: the LLM still drives every action, the UI is just providing canned natural-language affordances. Avoids two parallel action paths (UI + LLM) racing for state ownership.
- **System prompt is RIGID, not free-form.** Echo-back-before-confirm + never-fabricate + refuse-off-topic + clarify-ambiguous-Spanish are LOCKED rules (D-04). Tested against ≥10 fixture conversations BEFORE merging (D-30 spike fixture).
- **The 1-min followup ("¿Estás en camino?") arrives as an SSE event from the workflow's `:called:pre` token expiry**, NOT from a client-side timer. The workflow is the authority on timing — client-side timers go out of sync after sleep/wake/network jitter.
- **The chatbot does NOT persist chat history across reloads in v1.** localStorage holds session state ({reservation_id, session_token}), not message history. Returning diner sees a fresh greeting + their persistent status card — chat is ephemeral, status is durable. (Persisting messages would require either privacy-leaking client storage or a server-side message store with auth — both v2.)
- **AI SDK telemetry is enabled with `recordInputs:false, recordOutputs:false` in Phase 3 (D-23).** Gives request count + latency without PII risk. Custom Tracer wrapping every span attribute through `redactPII` is a v2 affordance if conversation logging is ever turned on.
- **Phase 3 ships migration `0003_reopen_count.sql` as the only schema change** — adds `reopen_count INTEGER NOT NULL DEFAULT 0` to `reservations` for STAFF-09 audit (D-16). Forward-only, no backfill.
- **Spike (D-30) is the FIRST plan task in Phase 3.** AI SDK v6 `useChat` lifecycle has changed (v5→v6) and the `tool-result` part shape on the client is the foundation for D-08 localStorage hydration. 2h cap. If the spike reveals a v6 footgun, D-04/D-08 get updated BEFORE implementation begins.
- **Push-to-prod-every-phase (Pitfall #19, Phase 1 D-13)** — Phase 3 plans deploy after each plan via `git push origin main`. The chatbot end-to-end is testable on the production URL (`https://zero-to-agent-xi.vercel.app`) during Phase 3; the maître panel rebuild lands as a single atomic commit per plan to avoid taking down `/queue` during a multi-plan rebuild.

</specifics>

<deferred>
## Deferred Ideas

These came up while scoping Phase 3 but belong elsewhere:

- **Rate limit (5 req/min per IP) on `create_reservation`** — Phase 4 (PILOT-readiness). Uses KV counter; pattern documented in scope §11. Phase 3 leaves the chatbot ungated against abuse; the public MCP also stays ungated until Phase 4.
- **Idempotency dedup key (`email + party_size + 30s window` hash) on `create_reservation`** — Phase 4. Belt-and-suspenders: KV TTL key + unique partial index on `(email, status) WHERE status='waiting'`.
- **`/api/health` endpoint + Slack/Discord webhook on workflow failure** — Phase 4. Pings DB + KV + Edge Config; consumed by external uptime monitor.
- **Final PII audit (grep production logs for email/phone)** — Phase 4. Phase 3 wires `lib/log.ts` everywhere; the audit verifies no leaks slipped through.
- **Demo video recording (DEMO-03, 6 scenarios)** — Phase 4. Phase 3 ships the surfaces that the video will SHOW; recording happens in Phase 4.
- **README polish (DEMO-02 expansion)** — Phase 4.
- **Final prod deploy as a discrete step** — N/A; every Phase 3 plan auto-deploys per Pitfall #19 / D-31.
- **Greeting the returning diner by name** — Phase 4 polish if visible value; defer to keep Phase 3 PII-conservative (D-29 Claude's Discretion).
- **Server-side message-history truncation in `useChat`** — defer; conversations are short in v1; revisit if pilot token costs become painful.
- **Custom Tracer for AI SDK telemetry that wraps every span attribute through `redactPII`** — v2; Phase 3 ships with `recordInputs:false, recordOutputs:false` which avoids the need.
- **Multi-day filter / date picker on `/queue/history` (STAFF-11)** — v2; Phase 3 ships day-scoped to today.
- **Analytics dashboard (STAFF-10: count attended, avg wait, no-show rate)** — v2.
- **Web push / service workers (PLAT-10)** — out of scope; if tab is closed, diner doesn't see push. The video narrative explains WhatsApp solves this in production.
- **WhatsApp adapter (PLAT-09)** — post-hackathon. The MCP server from Phase 2 IS the future-proofing.
- **Multi-tenant scoping (PLAT-11)** — out of scope.
- **Floating-widget chatbot embed for restaurants that want to embed it in their own site** — v2; Phase 3 ships full-page-at-`/` only.
- **Persisting chat history across reloads** — v2; would require either privacy-leaking client storage or server-side message store with auth.
- **LLM-tuned ETA agent (full DurableAgent intelligence beyond formula)** — capped 4h spike WITHIN Phase 3 (D-21); ships only if dry-run wins. If not, the formula stays inside the wrapper and the LLM-tuned variant becomes a v2 upgrade path (still a step BODY change, still safe).
- **ESLint custom rule for raw `console.*`** — Phase 4 polish (deferred from Phase 2). Phase 3 falls back to the same CI grep step.
- **Multi-restaurant rebrand via Edge Config** — v2 (PROJECT.md "Branding genérico" decision); the Phase 3 panel uses neutral copy + dynamic colors so a rebrand IS feasible without code changes, but the rebrand itself is post-hackathon.

### Reviewed Todos (not folded)
None — todo matcher returned 0 matches for Phase 3.

</deferred>

---

*Phase: 03-user-surfaces*
*Context gathered: 2026-04-26*
