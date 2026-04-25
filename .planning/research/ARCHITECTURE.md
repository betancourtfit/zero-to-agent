# Architecture Research

**Domain:** Restaurant queue MVP — chatbot embed + MCP server + WDK durable workflow + SSE realtime, 100% Vercel stack
**Researched:** 2026-04-25
**Confidence:** HIGH on Vercel/WDK/MCP/Auth.js (verified against official docs); MEDIUM on the exact AI-SDK-cookie-during-streaming pattern (verified against Next.js routing docs but the AI SDK does not document it explicitly).

> Scope: this file only covers **architecture** for the milestone. Stack choices live in `STACK.md`, feature scope in `FEATURES.md`, demo failure modes in `PITFALLS.md`. The roadmap should consume the **build order** and **risk register** here as its phase scaffolding.

---

## Standard Architecture

### System Overview

```
                                      DINER (browser)
                                            │
                            ┌───────────────┴───────────────┐
                            │                               │
                            │  POST /api/chat  (streaming)  │  GET /api/events/[reservation_id]  (SSE)
                            ▼                               ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                          Next.js 15 (Vercel Functions)                        │
│                                                                                │
│  ┌─────────────────────┐    ┌─────────────────────┐    ┌──────────────────┐  │
│  │  /api/chat          │    │  app/mcp/[t]/route  │    │ /api/events/...  │  │
│  │  (AI SDK streamText)│───▶│  @vercel/mcp-adapt. │    │ SSE handler      │  │
│  │  tools: forwarded   │    │  4 tools (Zod)      │    │ subscribes KV    │  │
│  │  to MCP via         │    │  validates token+   │    │ + Postgres       │  │
│  │  experimental_create│    │  X-MCP-API-Key      │    │ snapshot         │  │
│  │  MCPClient          │    │                     │    │                  │  │
│  └─────────┬───────────┘    └──────────┬──────────┘    └────────▲─────────┘  │
│            │                           │                         │            │
│            │  the tools call:          │                         │            │
│            │   1) DB write             │                         │            │
│            │   2) workflow start /     │                         │            │
│            │      hook resume          │                         │            │
│            ▼                           ▼                         │            │
│  ┌────────────────────────────────────────────────────────┐      │            │
│  │       lib/services/* (DB + workflow.start + hooks)     │      │            │
│  └─────┬─────────────────┬─────────────────┬──────────────┘      │            │
│        │                 │                 │                     │            │
│        ▼                 ▼                 ▼                     │            │
│  ┌──────────┐    ┌────────────────┐    ┌────────────────┐        │            │
│  │ Postgres │    │ WDK runtime    │    │ Upstash Redis  │────────┘            │
│  │ (Neon)   │◀──▶│ reservation    │───▶│ (publish on    │  KV.subscribe       │
│  └──────────┘    │ Workflow runs  │    │  state change) │  inside SSE handler │
│                  └───────┬────────┘    └────────────────┘                     │
│                          │                                                     │
│                          │   reads via @vercel/edge-config                    │
│                          ▼                                                     │
│                  ┌────────────────┐                                            │
│                  │  Edge Config   │   (no_show_timeout_min, etc.)              │
│                  └────────────────┘                                            │
└──────────────────────────────────────────────────────────────────────────────┘
                                            ▲
                                            │  POST /api/queue/[id]/call|seated
                                            │  GET  /api/queue
                                            │  (auth: Auth.js v5 magic link)
                                            │
                                      STAFF (browser)
                                            │
                                  GET /api/events/queue (SSE)
```

### Component Responsibilities

| Component | Responsibility | Implementation |
|-----------|----------------|----------------|
| **Chat UI (`/`)** | Conversation, render messages, listen on SSE for proactive pushes | `useChat` from `@ai-sdk/react` + `EventSource` for SSE |
| **`/api/chat`** | Stream LLM, expose tools to model, set cookie on first reservation | AI SDK `streamText` + `experimental_createMCPClient` (or local-call adapter) |
| **MCP server (`app/mcp/[transport]/route.ts`)** | Expose 4 tools as the **single source of truth** for diner mutations. Validates `X-MCP-API-Key` + per-action `session_token`. | `mcp-handler` package (formerly `@vercel/mcp-adapter`) + `withMcpAuth` |
| **Service layer (`lib/services/*`)** | Business logic shared by MCP tools and staff API. DB writes + `workflow.start()` + `hook.resume()`. | Plain TS functions, no Next.js coupling |
| **`reservationWorkflow`** | Durable lifecycle per reservation (`waiting → called → seated\|no_show\|cancelled`). Defines hooks for `call`, `seated`, `extend`, `cancel`. | `'use workflow'` + `defineHook` from `workflow` package |
| **Upstash Redis (KV)** | Realtime fanout from workflow steps to connected SSE clients. Rate-limit storage. | `@upstash/redis` — see "Pub/sub vs LIST vs Streams" below |
| **SSE handlers (`/api/events/*`)** | Open SSE, subscribe to KV channel, **immediately replay current state from Postgres**, then forward published events. | `ReadableStream` returned from Route Handler with `force-dynamic` + `Content-Type: text/event-stream` |
| **Staff API (`/api/queue/*`)** | Auth.js-protected endpoints: list active queue, call/seated actions. | Plain Route Handlers + `auth()` helper |
| **Auth.js v5** | Magic-link via Resend, sessions in Postgres via `@auth/pg-adapter`. Helper `getCurrentEmployee()`. | `auth.ts` exports `auth, handlers, signIn, signOut`; `middleware.ts` protects `/queue/*` |
| **Edge Config** | Read-only runtime parameters that the workflow + handlers read on every relevant step. | `@vercel/edge-config` `get()`. Sub-15ms reads, propagated globally before the request hits — no cold-cache concern |
| **DurableAgent (ETA)** | Estimates ETA from current queue + historical turnover. | `DurableAgent` from `@workflow/ai/agent`. Called from a step inside `reservationWorkflow` and from `get_reservation_status` (cached in KV) |

---

## Recommended Project Structure

```
.
├── app/
│   ├── (diner)/
│   │   └── page.tsx                    # chatbot embed (public)
│   ├── (staff)/
│   │   ├── login/page.tsx
│   │   ├── queue/page.tsx              # active queue (auth)
│   │   └── queue/history/page.tsx
│   ├── api/
│   │   ├── chat/route.ts               # AI SDK streamText, tool calls → MCP (in-process)
│   │   ├── events/
│   │   │   ├── [reservation_id]/route.ts   # SSE for diner
│   │   │   └── queue/route.ts              # SSE for staff
│   │   └── queue/
│   │       ├── route.ts                # GET active list (auth)
│   │       ├── history/route.ts        # GET history (auth)
│   │       └── [id]/
│   │           ├── call/route.ts       # POST → hook.resume (auth)
│   │           └── seated/route.ts     # POST → hook.resume (auth)
│   ├── mcp/[transport]/route.ts        # MCP server (4 tools)
│   ├── auth/[...nextauth]/route.ts     # Auth.js handlers
│   ├── .well-known/                    # MCP OAuth metadata (only if going OAuth route — see auth section)
│   ├── layout.tsx
│   └── middleware.ts                   # protects /queue/*
├── lib/
│   ├── auth.ts                         # NextAuth() config, exports auth/handlers
│   ├── db/
│   │   ├── schema.sql
│   │   ├── client.ts                   # @vercel/postgres typed client
│   │   └── queries.ts                  # data-access only (no business logic)
│   ├── kv.ts                           # @upstash/redis client + helpers (publish/subscribe/list)
│   ├── config.ts                       # getConfig(key) wrapping @vercel/edge-config
│   ├── services/
│   │   ├── reservations.ts             # createReservation, getStatus, extendWait, cancel
│   │   └── employees.ts                # getCurrentEmployee()
│   ├── workflows/
│   │   ├── reservation.ts              # 'use workflow' + hook definitions
│   │   ├── steps.ts                    # 'use step' helpers
│   │   └── eta-agent.ts                # DurableAgent for ETA
│   └── mcp/
│       ├── handler.ts                  # createMcpHandler(...) shared between local + route
│       └── auth.ts                     # verifyToken (api-key + session_token)
├── components/
│   ├── chat/                           # message list, quick-reply buttons, "MESA LISTA" banner
│   ├── queue/                          # cards, action buttons, color codes
│   └── ui/                             # shadcn/ui
├── scripts/
│   ├── migrate.ts
│   ├── seed-employee.ts
│   └── seed-demo.ts                    # 3 reservations in distinct states for video opening
├── next.config.ts                      # withWorkflow(...)
└── .env.local
```

### Structure Rationale

- **Service layer (`lib/services/`)** is the **most important architectural decision**. The MCP tool, the staff API, and the workflow steps all funnel through the same service functions. This means a `create_reservation` tool, a future `POST /api/admin/reservations`, and a debug script all behave identically. Without this, you end up duplicating the "validate → write DB → start workflow → publish event" sequence in three places and they will drift.
- **`app/(diner)` and `app/(staff)` route groups** isolate the two surfaces and allow distinct layouts/middleware composition.
- **`lib/workflows/`** stays away from `app/` so `'use workflow'` directives don't get confused with React Server Components — the WDK builder needs them visible to its compiler but they should not look like routes.
- **`app/mcp/[transport]/route.ts`** uses the dynamic `[transport]` segment from the official MCP-on-Vercel template (matches `streamable-http`, `sse`, etc.).

---

## Architectural Patterns

### Pattern 1: Service-layer funnel (a.k.a. "MCP tools are thin")

**What:** MCP tools and staff API endpoints are 5–15-line wrappers around shared service functions. The service functions own DB writes + workflow start + KV publish.

**When to use:** Always, in this project. There are at least 2 callers (chatbot via MCP + staff panel) and a future 3rd (WhatsApp). One source of truth is mandatory.

**Trade-offs:**
- (+) No drift between callers
- (+) Easy to test the service layer with no Next.js context
- (−) One extra indirection — fine

**Example:**
```typescript
// lib/services/reservations.ts
export async function createReservation(input: CreateInput): Promise<CreateOutput> {
  // 1. validate (Zod was already applied at the boundary)
  // 2. compute initial position
  const sessionToken = crypto.randomUUID();
  const id = crypto.randomUUID();

  // 3. DB row first (source of truth)
  await db.insert(reservations).values({ id, ...input, sessionToken, status: "waiting" });

  // 4. start workflow — capture runId, write back to row
  let runId: string;
  try {
    const run = await start(reservationWorkflow, [id]);
    runId = run.runId;
    await db.update(reservations).set({ workflowRunId: runId }).where(eq(reservations.id, id));
  } catch (e) {
    // CRITICAL: compensating action — mark row as failed so it doesn't
    // appear in the active queue without an orchestrator
    await db.update(reservations).set({ status: "failed_to_start" }).where(eq(reservations.id, id));
    throw e;
  }

  // 5. notify staff panel that a new reservation arrived (best-effort)
  await kv.publish("queue:active", { type: "created", id });

  return { reservationId: id, sessionToken, position: ..., etaMin: ... };
}

// app/mcp/[transport]/route.ts (the tool — 6 lines)
server.tool("create_reservation", "...", schema, async (input, ctx) => {
  const result = await createReservation(input);
  return { content: [{ type: "text", text: JSON.stringify(result) }] };
});
```

### Pattern 2: Hook-resume for staff actions (NOT another HTTP call)

**What:** The staff "Llamar" button posts to `/api/queue/[id]/call`, which calls `callHook.resume(reservationId, {})` directly. The workflow's `waitForEvent`-equivalent (the hook iterator) wakes up on the same Vercel runtime — no HTTP round-trip back into the workflow.

**When to use:** Whenever an external action needs to advance a workflow. The WDK design term is **hook**.

**Trade-offs:**
- (+) Direct in-process call, no HTTP, no auth issues, no extra route
- (+) Type-safe with `defineHook<{...}>()`
- (−) The hook **token** must be deterministic (we use `reservationId`) so the route knows what to resume

**Example:**
```typescript
// lib/workflows/reservation.ts
import { defineHook } from "workflow";
export const callHook   = defineHook<{}>();
export const seatedHook = defineHook<{ employeeId: string }>();
export const extendHook = defineHook<{}>();
export const cancelHook = defineHook<{ reason?: string }>();

export async function reservationWorkflow(reservationId: string) {
  "use workflow";

  await loadAndPersistInitial(reservationId);

  // === waiting phase ===
  const callEvents = callHook.create({ token: reservationId });
  const cancelEvents = cancelHook.create({ token: reservationId });
  // ...wait on either, with periodic ETA recompute via sleep+race
  // (the WDK API for racing hooks is documented in workflow-sdk.dev)

  // === called phase ===
  await markCalledAndPushDiner(reservationId);
  // wait followup_after_call_min, then push followup if no event
  // ...
}

// app/api/queue/[id]/call/route.ts
import { callHook } from "@/lib/workflows/reservation";
import { auth } from "@/lib/auth";

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user) return new Response("unauthorized", { status: 401 });

  await callHook.resume(params.id, {});
  return Response.json({ ok: true });
}
```

### Pattern 3: SSE handler = subscribe + replay-on-connect

**What:** When the SSE handler opens, it does **two things in order**: (1) read the current authoritative state from Postgres and emit it as the first SSE event, then (2) subscribe to KV for subsequent events. This eliminates the "I missed the message because I wasn't connected yet" race.

**When to use:** Always, for any pub/sub-style realtime layer.

**Trade-offs:**
- (+) Robust against subscriber-not-connected message loss (which is fundamental to Redis pub/sub — verified against Redis + Upstash docs)
- (+) Handles client reconnection (after Vercel function timeout) with no extra code
- (−) One extra DB read per SSE connection — negligible at < 20 concurrent diners

**Example:**
```typescript
// app/api/events/[reservation_id]/route.ts
export const dynamic = "force-dynamic";
export const maxDuration = 800; // Pro+Fluid

export async function GET(req: Request, { params }: { params: { reservation_id: string } }) {
  // validate session_token cookie matches reservation_id
  const ok = await validateSessionCookie(req, params.reservation_id);
  if (!ok) return new Response("unauthorized", { status: 401 });

  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      const send = (event: string, data: unknown, id?: string) =>
        controller.enqueue(
          enc.encode(`${id ? `id: ${id}\n` : ""}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
        );

      // 1. REPLAY current state immediately
      const snapshot = await getReservationSnapshot(params.reservation_id);
      send("snapshot", snapshot, snapshot.lastEventId);

      // 2. SUBSCRIBE for future updates
      const sub = redis.subscribe(`reservation:${params.reservation_id}`);
      sub.on("message", ({ message }) => {
        const evt = JSON.parse(message);
        send(evt.type, evt, String(evt.id));
      });

      // 3. heartbeat every 25s to keep connection alive across proxies
      const hb = setInterval(() => controller.enqueue(enc.encode(`: hb\n\n`)), 25_000);

      req.signal.addEventListener("abort", () => {
        clearInterval(hb);
        sub.unsubscribe();
        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
```

### Pattern 4: Cookie set BEFORE the stream starts

**What:** When `/api/chat` calls a tool that returns a fresh `session_token`, the `Set-Cookie` header **must** be present in the initial HTTP response. HTTP forbids setting cookies after the body has started streaming.

**Constraint:** The AI SDK's `toUIMessageStreamResponse()` returns a `Response`; you can pass extra `headers` to it but the cookie value has to be known **before the streaming starts**, which is a problem when the LLM decides mid-stream to call `create_reservation`.

**The clean fix:**
- Frontend sends a per-conversation `client_session_id` (UUID v4 generated in browser, stored in localStorage).
- Server `/api/chat` reads or sets the `session_session` cookie by binding it to that `client_session_id` **before** any LLM work, and passes it as context to the tools.
- When the LLM calls `create_reservation`, the service writes `session_token = <derived-from-client-session-id>` and persists. The cookie is already set (from the very first request to `/api/chat`).

This is simpler than trying to set the cookie after the stream finishes.

**Alternative:** Skip the cookie entirely (it's already first on the cut list). Use localStorage on the client instead — no `HTTPOnly`, slightly less secure, but for a hackathon piloting with diners who already trust the brand, it's fine.

### Pattern 5: Edge Config — read on the way in, not in the hot loop

**What:** Read Edge Config once at the top of each step that needs it; do not re-read inside loops. P99 < 15ms, propagated globally before request, but it's still a network call.

**When to use:** All operational parameters (`no_show_timeout_min`, `followup_after_call_min`, `extension_min`, etc.) live in Edge Config so they update without redeploy. **Confirmed safe to call from a workflow step** — Edge Config works in any Vercel Function (Edge or Node), and workflow steps run as Vercel Functions.

**Trade-offs:**
- (+) Live config updates are a demo-gold moment
- (−) The `no_show_timeout_min` value sampled at the time of the `called` transition is the one that controls that ticket — if you change it mid-deadline, the ticket's deadline does not retroactively shift (because it's computed once and stored on the row). This is the **correct** behavior for the demo, but make sure the script narrates it that way.

---

## Data Flow

### Critical Journey 1 — Alta (diner registers via chatbot)

```
[Diner types "somos 4 para esta noche"]
    │
    ▼
useChat → POST /api/chat
    │
    ▼
streamText(model, tools=[…mcp tools via experimental_createMCPClient(local)])
    │
    │ (LLM streams tokens, asks for name/email/phone, eventually decides to call tool)
    ▼
Tool call: create_reservation({name, email, phone, party_size})
    │
    ▼
MCP route handler → validates X-MCP-API-Key (server-to-server, internal)
    │
    ▼
lib/services/reservations.createReservation(input)
    │
    ├─ db.insert(reservations) [status='waiting', session_token=uuid]
    │
    ├─ start(reservationWorkflow, [id])  ← WDK
    │  │
    │  ▼
    │  workflow runs first step: loadReservation, computeETA, persistInitial
    │  then enters waiting hook loop
    │
    ├─ db.update(reservations).set({workflowRunId: run.runId})
    │
    ├─ kv.publish('queue:active', {type:'created', id})  ← staff panel sees it appear
    │
    └─ returns {reservation_id, position, eta_min, session_token}
    │
    ▼
Tool result streams back as part of LLM response
    │
    ▼
LLM produces a confirmation message: "Listo Juana, posición 3, te avisamos en ~12 min"
    │
    ▼
Frontend: cookie was already set on the first /api/chat request (Pattern 4)
          OR: the chat client makes a follow-up "claim" call. (Cut-list candidate.)
    │
    ▼
Frontend opens EventSource('/api/events/<reservation_id>')
```

**Critical fix in the scope:** The scope says the cookie is set "from the result of a tool call inside `/api/chat`". This is **not safe** because by the time the tool result is generated, the response stream has already started. **Recommendation:** Either set the cookie pre-emptively at the top of `/api/chat` (Pattern 4) or move the cookie to the cut list immediately and use localStorage (the scope already lists it as cut-list #1 — perfect, just do it now).

### Critical Journey 2 — Llamado (staff calls a table → diner receives push via SSE)

```
[Staff clicks "Llamar" on /queue]
    │
    ▼
POST /api/queue/<id>/call (with session cookie from Auth.js)
    │
    ├─ auth() validates session
    │
    └─ callHook.resume(<id>, {})  ← in-process, no HTTP
        │
        ▼
        workflow wakes from waitForEvent('call'), runs:
        │
        ├─ step: db.update status='called', called_at=now,
        │         no_show_deadline = now + edgeConfig.no_show_timeout_min
        │
        ├─ step: kv.publish('reservation:<id>', {type:'called', deadline})
        │  AND   kv.publish('queue:active', {type:'updated', id})
        │
        └─ enters new waitForEvent for ['seated', 'extend', 'cancel'] with timeout
    │
    ▼
SSE handler /api/events/<reservation_id> receives KV message
    │
    ▼
Forwards to diner browser as `event: called\ndata: {...}`
    │
    ▼
Chatbot UI: shows "TU MESA ESTÁ LISTA" banner + new chat message
```

**Critical detail:** The staff panel SSE (`/api/events/queue`) **also** receives a publish on `queue:active`, refreshes that card to show new state.

**Subtle scope issue:** The scope says "publish to KV channel `reservation:<id>`, SSE handler subscribes". This is **only safe if the diner's SSE is connected at the moment of publish**. Verified against Redis docs: pub/sub is at-most-once and drops messages with no subscribers. **Recommendation (Pattern 3):** the SSE handler always replays the current state from Postgres on connect, so even if the call event was missed, the snapshot still says `status='called'` and the UI can render correctly. Postgres is the source of truth; KV is a real-time hint.

### Critical Journey 3 — Extend via chat ("dame 5 más")

```
[Diner types "voy llegando, dame 5 más"]
    │
    ▼
POST /api/chat (existing conversation)
    │
    ▼
LLM interprets intent → tool call: extend_wait({reservation_id})
    │
    ▼
MCP tool validates session_token cookie matches reservation
    │
    ▼
lib/services/reservations.extendWait(id)
    │
    ├─ if not in 'called' state → throw error → tool returns error → LLM apologizes
    ├─ if extension_count >= max → throw error → LLM apologizes
    │
    ├─ extendHook.resume(id, {})
    │  │
    │  ▼
    │  workflow wakes: no_show_deadline += extension_min, extension_count++
    │  publishes 'reservation:<id>' {type:'extended', new_deadline}
    │  AND       'queue:active' {type:'updated', id}
    │
    └─ returns {new_no_show_deadline, extension_count}
    │
    ▼
LLM confirms: "Perfecto, te esperamos hasta las 21:25"
```

### Critical Journey 4 — No-show automático

```
[no event arrives before deadline]
    │
    ▼
workflow's waitForEvent times out
    │
    ├─ step: db.update status='no_show', ended_at=now
    │
    ├─ step: kv.publish('reservation:<id>', {type:'no_show'})
    │  AND   kv.publish('queue:active', {type:'closed', id})
    │
    ├─ step: send notification to diner channel via the same KV publish
    │  (the chatbot UI shows the message; if tab is closed, message is lost —
    │   acceptable per scope, narrated in video as "in production: WhatsApp")
    │
    └─ workflow ends
    │
    ▼
Staff /queue panel removes the card (queue:active update)
Staff /queue/history page next refresh shows the closed ticket
```

**Why this is the WDK money shot:** This entire sequence happens **with zero CPU** during the wait. No cron, no scheduler, no polling. The workflow is suspended in the WDK runtime; the timeout fires; one step runs; done. And because workflow runs are pinned to the deployment that started them (skew protection), a `git push` mid-wait does **not** disrupt active timers.

---

## Build Order

The scope's 12 phases are essentially correct, but for a 7-day solo build the **dependency graph** matters more than the linear list. Here's the critical path and what can be deferred or parallelized.

### Dependency graph (read top-down)

```
                    Fase 0 — Pre-reqs (10m, human)
                              │
                              ▼
                    Fase 1 — Scaffolding (10m)
                              │
                              ▼
                    Fase 2 — Vercel link + storage (10m)
                              │
        ┌─────────────────────┼─────────────────────┐
        │                     │                     │
        ▼                     ▼                     ▼
   Fase 3 — DB schema    Fase 7 — Edge Config   (Fase 12 stub — vercel logs ready)
   (15m)                 (10m, parallel-safe)
        │
        ▼
   Fase 4 — Auth.js (20m)        ◀── CAN PARALLELIZE with Fase 5
        │
        ▼ (auth ready unblocks /queue routes)
   ──────┼────────────────────┐
         │                    │
         ▼                    ▼
   Fase 5 — MCP server   (Fase 9 staff panel scaffold — uses fake data)
   (30m)                 (can start early with mock /api/queue)
         │
         ▼
   Fase 6 — WDK workflows ⚙️  ← CRITICAL PATH
   (45m, the longest single block)
         │
         ▼
   ──────┴────────────────────┐
         │                    │
         ▼                    ▼
   Fase 8 — Chatbot     Fase 9 — Staff panel
   (45m)                (40m, swap mocks for real APIs)
         │                    │
         └──────┬─────────────┘
                ▼
         Fase 10 — DurableAgent ETA (25m)
                │
                ▼
         Fase 11 — Hardening + prod (30m)
                │
                ▼
         Fase 12 — Demo prep (15m + 30m human)
```

### Critical path

**Fase 1 → 2 → 3 → 5 → 6 → 8 → 11 → 12 = ~3h 30m of agent work**, gated by ~30m of human verification. Everything else is parallelizable around the workflow build (Fase 6).

### What to defer / reorder

1. **Fase 7 (Edge Config) right after Fase 2.** The scope puts it after Fase 6, but the workflow code in Fase 6 needs `getConfig('no_show_timeout_min')` to compile cleanly. Provisioning + helper before Fase 6 is cheaper than refactoring after.
2. **Fase 10 (DurableAgent ETA) is optional for V1 demo.** A static "ETA = `position * 12 min`" function inside the existing service works for the video. If time runs short, ship the agent post-pilot.
3. **Fase 4 (Auth.js) and Fase 5 (MCP) can be built in parallel** — they share no code. If pairing with Claude, run the agent on auth while you write the MCP tool schemas in parallel; merge in Fase 6.
4. **Fase 11 (rate limiting + idempotency) is non-negotiable for the pilot.** Real diners + a public MCP endpoint means rate-limiting must ship. Don't put this at the end where it gets cut.
5. **Move "deploy with active workflows" smoke test into Fase 6.** Don't wait until Fase 11 to find out the money-shot doesn't work.

### Recommended cut list (in order, if running short)

1. **Cookie 24h** (already in scope cut list) — use localStorage instead, add `HTTPOnly` cookie post-hackathon.
2. **DurableAgent ETA** — replace with a deterministic estimator function.
3. **`/queue/history` page** — show closed reservations inline in `/queue` with a filter toggle.
4. **Edge Config "live update during demo" scenario** (#5 of the 6 video scenarios) — keep the infra, drop the demo scenario if rehearsal is sloppy.
5. **Color-coded cards by party size** — basic styling is fine.

Do **not** cut: chatbot, MCP server, workflow durability, SSE for diner push, no-show automation, staff Llamar/Marcar presentado. Those are the demo.

### What you can do in parallel (with Claude Code)

- While agent runs **Fase 6 (workflows)** — write the `DEMO.md` script, prepare the recording environment.
- While agent runs **Fase 8 (chatbot UI)** — write the system prompt and test inputs for the LLM.
- While agent runs **Fase 9 (staff panel)** — design the seed data for the demo opening.

---

## Scaling Considerations

The pilot is < 20 concurrent diners. Real-world ceiling for this stack without changes is around 1k concurrent diners per restaurant. None of the following matter for V1, but flagging them so the roadmap doesn't optimize prematurely:

| Scale | Concern | Action |
|-------|---------|--------|
| 0–20 (pilot) | Nothing | Ship as designed |
| 20–200 | SSE per-connection cost (each open SSE = 1 invocation slot in Fluid Compute) | Already fine — Fluid Compute shares instances; bump `maxDuration: 800` on Pro |
| 200–1k | Postgres connection pool exhaustion if every SSE handler does its own snapshot read | Move snapshot reads to a shared cache with a 1s TTL in KV |
| 1k+ | One Vercel project per restaurant feels right | Multi-tenant is explicitly out of scope and that's correct |

### Scaling priorities

1. **First bottleneck: Postgres pooler.** The Neon connection pool is the first thing to monitor. SSE handlers that hold connections are the risk. Mitigation: read snapshot, release connection, then subscribe (Postgres connection only held for the snapshot read, not for the duration of the SSE).
2. **Second bottleneck: Redis pub/sub fan-out.** At ~1k concurrent diners with frequent state changes, KV publish becomes cheap but each subscriber cost adds up. Mitigation: switch to Upstash Streams (XADD/XREAD) for batch consumption.

---

## Anti-Patterns

### Anti-Pattern 1: HTTP self-call from MCP tool to start workflow

**What people do:** The MCP tool calls `fetch('/api/internal/start-workflow', ...)` instead of importing `start()` directly.
**Why it's wrong:** Adds latency, an auth hop, a serverless cold start, and a failure mode (network blip between same-process routes).
**Do this instead:** Import `start` from `workflow/api` and call it directly inside the service function.

### Anti-Pattern 2: Workflow holds a long-lived Redis connection

**What people do:** Subscribe to KV inside a workflow step, keep listening for messages.
**Why it's wrong:** Workflow steps must be deterministic and replayable. A long-lived connection is neither. Also: workflows wait for events via **hooks**, not via Redis.
**Do this instead:** Workflow steps **publish** to KV (one-shot HTTP call to Upstash REST). Workflow steps **wait** for staff/diner actions via hooks (`callHook.create({token: id})`). The HTTP route handler that received the staff action calls `callHook.resume(id, ...)` to wake the workflow. KV is only for fanout to SSE clients, never an input to the workflow.

### Anti-Pattern 3: Trusting pub/sub for "the diner must see this"

**What people do:** "Workflow publishes `called`, diner SSE subscribes, done."
**Why it's wrong:** Redis pub/sub is at-most-once. If the diner's tab was unfocused/reloading at the moment of publish, the message vanishes. The diner sees stale state.
**Do this instead:** Pattern 3 — SSE handler reads current snapshot from Postgres on connect, then subscribes for future events. The KV message is a hint to refresh, not a primary delivery mechanism. Postgres is source of truth.

### Anti-Pattern 4: Setting the cookie after the chat stream starts

**What people do:** "When `create_reservation` returns the token, set the cookie."
**Why it's wrong:** HTTP forbids `Set-Cookie` after the response body has started streaming. The cookie silently fails.
**Do this instead:** Pattern 4 — pre-emptive cookie at the top of `/api/chat` based on a `client_session_id` from the browser, OR move to localStorage and accept the trade-off.

### Anti-Pattern 5: Each MCP tool re-implements auth

**What people do:** Each of the 4 tools opens with its own `if (!apiKey) ...` check, copy-pasted.
**Why it's wrong:** Drift. Bug-fix in one tool not propagated to the other 3.
**Do this instead:** Use `withMcpAuth(handler, verifyToken, {...})` from `mcp-handler`. One verifyToken function, applied to the whole MCP server.

### Anti-Pattern 6: Skipping the snapshot on SSE reconnect

**What people do:** SSE handler just subscribes, no replay.
**Why it's wrong:** When the Vercel function timeout (300s/800s) hits and the EventSource auto-reconnects, the new SSE handler starts a fresh subscription — and misses any events that fired in the gap. The diner sees stale UI.
**Do this instead:** The handler reads the current snapshot first thing on connect (Pattern 3). Reconnect = automatic catch-up. Combined with `EventSource`'s built-in `Last-Event-ID` reconnection mechanism (set the `id:` field on every SSE event with the row's `last_event_id` from Postgres `reservation_events`), you can also do precise gap recovery.

---

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| **Vercel Postgres (Neon)** | `@vercel/postgres` direct from any context (workflow steps, route handlers). Connection pooling via Neon's PgBouncer. | Steps must release connections promptly. Neon hibernates → first query after idle has cold-start latency (acceptable for hackathon). |
| **Vercel KV (Upstash Redis)** | `@upstash/redis` over HTTP. Works in any runtime. | Pub/sub uses HTTP streaming (SSE under the hood). Calls are stateless HTTP — no connection pool to manage. |
| **Vercel Edge Config** | `@vercel/edge-config` `get(key)`. P99 < 15ms, propagated globally before request. | Read on the way in, cache locally if used in a tight loop. Safe from workflow steps. |
| **AI Gateway** | `@ai-sdk/anthropic` configured with `gateway: 'vercel'` (or `AI_GATEWAY_API_KEY` env). | One env var, one model name (`anthropic/claude-sonnet-4-6`). |
| **Resend** | Used by Auth.js EmailProvider for magic-link. Verify domain or use `onboarding@resend.dev` for dev. | Spam: magic links sometimes go to spam, mention to pilot maître. |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| Chat client → `/api/chat` | HTTP POST, SSE response | AI SDK protocol; never call MCP from browser directly |
| `/api/chat` → MCP tools | In-process, via `experimental_createMCPClient` or direct service-layer call | **Recommendation: skip the MCP client and call services directly from the chat handler.** The MCP server is the public interface for *future* clients (WhatsApp). Internally, the chat handler can just call the same `lib/services/*` functions the MCP tools call. This eliminates the MCP-over-HTTP round-trip from chat to MCP and back. |
| MCP tools / staff API → Workflow | Direct import: `start()`, `<hook>.resume()` | **Never via HTTP.** |
| Workflow → SSE clients | Publish to KV channels, SSE handlers consume | Always combined with Postgres snapshot replay (Pattern 3) |
| Workflow → Edge Config | Direct `get(key)` from any step | Read once per step, don't loop |

### About "tools call the workflow vs. write to Postgres and the workflow consumes"

**Recommendation: tools write to Postgres AND start/resume the workflow, in that order, in the same service function.** The workflow does not "consume from Postgres" — that would be polling, which defeats WDK. The workflow is started with the `reservationId` and reads its own state from Postgres at the top of each relevant step.

The `session_token` is generated **in the service function**, not by the workflow, because the chatbot needs it in the response body to set the cookie. The workflow just reads the row.

If `workflow.start` fails after the DB row is created: **Pattern 1's compensating action** marks the row `status='failed_to_start'` so the active queue query filters it out. A separate cleanup job (or just a manual SQL delete during the pilot) handles them. For 20 diners this is fine; for production, add a retry loop.

---

## Risk Register (Demo + Pilot)

The 5 risks most likely to break the demo or the pilot, with mitigations.

### Risk 1 — Money-shot fails: deploy mid-flight breaks active workflows

**Likelihood:** Low (skew protection is now default for new projects)
**Impact:** Catastrophic for the demo
**Mitigation:**
- Verify Skew Protection is enabled in project settings before recording (one click in Vercel dashboard)
- Workflow runs are pinned to the version that started them; do **not** rename/delete workflow files between demo deploys. Adding new files is safe; renaming `reservationWorkflow` is not.
- Test in Fase 6, not Fase 11: create 2 reservations, deploy, verify both still progress.

### Risk 2 — Diner SSE drops at 300s/800s timeout, push event lost

**Likelihood:** High (will happen in any pilot session > 5 min)
**Impact:** Diner doesn't see "MESA LISTA"
**Mitigation:**
- `EventSource` auto-reconnects on `error` with built-in retry. Set `id:` on every SSE event (using `reservation_events.id`).
- SSE handler does Pattern 3 (snapshot replay) on every connect, including reconnects → no information lost
- Set `maxDuration: 800` and use Pro plan for the pilot
- Heartbeat every 25s to keep proxies happy
- Diner tab closed = lost message — narrate in video as "in production this is WhatsApp" (already in scope)

### Risk 3 — Cookie pattern breaks because stream already started

**Likelihood:** High if implemented as described in scope §6.1
**Impact:** Diner can't return; chatbot doesn't recognize them
**Mitigation:**
- Either pre-set cookie at top of `/api/chat` (Pattern 4) or move to localStorage immediately
- Already on cut list — move it to **cut now** rather than discovering it broken on day 5

### Risk 4 — Workflow step calls Edge Config / DB, gets cold-start, exceeds step timeout

**Likelihood:** Low (Vercel Functions warm fast; Edge Config is < 15ms)
**Impact:** Step retries; user-visible latency
**Mitigation:**
- Steps have built-in retries — fine
- Read Edge Config once at the top of a step, not in a loop
- Neon's pooler can cold-start at ~500ms; if a step is sensitive, pre-warm with a tiny query

### Risk 5 — `create_reservation` race: two diners same email, double row

**Likelihood:** Low (one restaurant, < 20 diners)
**Impact:** Confused diner, wrong workflow
**Mitigation:**
- Idempotency in Fase 11: hash `(email, party_size, floor(now / 30s))` as a dedup key in KV with 30s TTL. Already in scope.
- Add a unique partial index on `(email, status)` where `status='waiting'`. Catches the race even if the KV check loses.

### Risk 6 (bonus) — Auth.js magic-link goes to spam, maître locked out

**Likelihood:** Medium during pilot
**Impact:** Maître can't run their service
**Mitigation:**
- Use a verified Resend domain, not `onboarding@resend.dev`, for the pilot
- Backup: pre-create a session row via a script and manually set the `__Secure-authjs.session-token` cookie if needed
- Add a "Resend magic link" button on `/login` (Auth.js supports this out of the box)

### Risk 7 (bonus) — KV pub/sub message arrives before Postgres write committed

**Likelihood:** Low (publish happens after `await db.update`)
**Impact:** SSE handler's snapshot read is stale
**Mitigation:**
- Always `await` the DB write before `await kv.publish` in service functions. Pattern 1 enforces this.
- The next snapshot replay (or any subsequent event) will correct it within 1–2s.

---

## Verified Architectural Assumptions from the Scope

| Scope assumption | Verdict | Notes |
|------------------|---------|-------|
| Tools call the workflow directly via `start()` | **CONFIRMED** | `start` from `workflow/api`. Returns `{ runId, status, returnValue }`. |
| `waitForEvent`-style API exists | **CONFIRMED, with naming caveat** | The actual API is `defineHook<T>()` + `hook.create({token}).resume(token, data)` — not `waitForEvent`. Functionally identical. Update the scope wording. |
| Workflow can publish to Vercel KV from a step | **CONFIRMED** | Steps run in regular Vercel Functions; `@upstash/redis` works fine over HTTP. |
| KV pub/sub is reliable enough as a real-time bridge | **PARTIALLY — needs Pattern 3** | Redis pub/sub is at-most-once. With snapshot-replay-on-connect (Pattern 3), it's reliable enough. Without, messages can be lost. |
| Edge Config works inside a workflow step | **CONFIRMED** | Edge Config works in any Vercel runtime, including the function that hosts a workflow step. |
| SSE timeout: 5 min hobby / 15 min pro | **PARTIALLY OUTDATED** | With Fluid Compute (default for new projects 2026), defaults are 300s on all plans, max 800s on Pro. Set `maxDuration` explicitly. |
| Auth.js v5 protects routes via middleware | **CONFIRMED** | `auth()` from `@/lib/auth` works in middleware, route handlers, RSC. |
| Cookie set from the result of a tool call inside `/api/chat` | **NOT SAFE AS DESCRIBED** | Stream-after-cookie violates HTTP. Use Pattern 4 or accept the cut. |
| Tool results stream back to the chat | **CONFIRMED** | AI SDK's `streamText` + tool calling forwards tool outputs in the data stream. |
| MCP server reachable from external clients (future WhatsApp) | **CONFIRMED** | `mcp-handler` produces a public Streamable-HTTP endpoint. Auth via `withMcpAuth`. |
| AI Gateway model `anthropic/claude-sonnet-4-6` | **CONFIRMED in product, version-as-of-2026** | Model identifier valid as of April 2026. |

---

## Sources

- **Vercel Workflows (concepts):** https://vercel.com/docs/workflows/concepts — workflow/step/sleep/hook abstractions, skew protection
- **Vercel Workflows (overview):** https://vercel.com/docs/workflows
- **Workflow SDK starting workflows:** https://workflow-sdk.dev/docs/foundations/starting-workflows — `start()` API and `Run` object
- **Workflow SDK hooks:** https://workflow-sdk.dev/docs/foundations/hooks — `defineHook`, `resumeHook` programmatic API
- **Workflow SDK streaming:** https://workflow-sdk.dev/docs/foundations/streaming — built-in stream alternative to KV pub/sub
- **Vercel Function duration:** https://vercel.com/docs/functions/configuring-functions/duration — Fluid Compute defaults 300s, Pro max 800s (2026)
- **Vercel MCP deploy:** https://vercel.com/docs/mcp/deploy-mcp-servers-to-vercel — `mcp-handler` package, `withMcpAuth`, `app/[transport]/route.ts` pattern
- **Edge Config performance:** https://vercel.com/docs/edge-config and https://vercel.com/blog/edge-config-ultra-low-latency-data-at-the-edge — < 15ms P99, propagated globally
- **Auth.js v5 migration:** https://authjs.dev/getting-started/migrating-to-v5 — `auth()` helper unified across contexts
- **Auth.js Next.js reference:** https://authjs.dev/reference/nextjs
- **Upstash Redis pub/sub:** https://upstash.com/docs/redis/sdks/ts/commands/pubsub/subscribe — HTTP streaming based, works in serverless
- **Upstash Redis pub/sub system overview:** https://deepwiki.com/upstash/redis-js/4.8-pubsub-system — confirmed HTTP/SSE under the hood
- **Redis pub/sub at-most-once delivery:** https://oneuptime.com/blog/post/2026-03-31-redis-pubsub-message-delivery-guarantees/view — message-loss caveat
- **Redis Streams alternative:** https://upstash.com/blog/redis-streams-beyond-memory — XADD/XREAD for durability if pattern 3 isn't enough
- **AI SDK chatbot tool usage:** https://ai-sdk.dev/docs/ai-sdk-ui/chatbot-tool-usage
- **AI SDK streamText:** https://ai-sdk.dev/docs/reference/ai-sdk-core/stream-text
- **Next.js cookie API limits:** https://nextjs.org/docs/app/api-reference/functions/cookies — cookies cannot be set after stream starts
- **Skew Protection:** https://vercel.com/docs/skew-protection — workflow runs pinned to deployment version
- **Skew Protection default:** https://vercel.com/changelog/skew-protection-is-now-enabled-by-default-for-new-projects

---
*Architecture research for: restaurant queue MVP — chatbot + MCP + WDK + SSE on Vercel*
*Researched: 2026-04-25*
