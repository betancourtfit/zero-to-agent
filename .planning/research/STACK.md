# Stack Research

**Domain:** Vercel-native restaurant queue MVP (chatbot + MCP + durable workflow)
**Researched:** 2026-04-25
**Confidence:** HIGH (most items verified against current official docs as of today)

---

## TL;DR — what changed since the scope doc was written

The scope document (`scope_hackathon_mvp.md`) is **directionally correct** but several package names and API signatures are **outdated or wrong**. The biggest deltas a roadmap must reflect:

| Scope says | Reality (2026-04-25) | Severity |
|---|---|---|
| `@vercel/workflow` package | Package is just `workflow` (npm i workflow) | HIGH — wrong install command |
| `waitForEvent(['call','cancel'], { timeout: 30s })` | No `waitForEvent` API exists. Use `createHook()` + `Promise.race(hook, sleep("30s"))` | HIGH — fundamental API shape is different |
| `@vercel/mcp-adapter` | Current package is `mcp-handler` (v1.1.0). `@vercel/mcp-adapter` is the older name and is functionally superseded | HIGH — wrong install command |
| `@vercel/postgres` | Vercel Postgres deprecated Dec 2024, migrated to Neon. Use `@neondatabase/serverless` | HIGH — wrong package |
| `@vercel/kv` | Vercel KV deprecated Dec 2024, migrated to Upstash. Use `@upstash/redis` | HIGH — wrong package |
| `KV.publish()` / `KV.subscribe()` is "alternative LIST+BLPOP simpler" | `@upstash/redis` exposes real `publish()` / `subscribe()` over HTTP/SSE — use it directly. **Do NOT use BLPOP** in serverless (blocks forever, will hit function timeout) | HIGH — wrong fallback recommendation |
| `anthropic/claude-sonnet-4-6` (dash) | Correct ID is `anthropic/claude-sonnet-4.6` (dot) | HIGH — wrong model id; will fail at runtime |
| `next-auth` | Use `next-auth@beta` (which IS Auth.js v5). Resend provider is `next-auth/providers/resend` not `@auth/providers/resend` | MEDIUM — confusing aliasing |
| `middleware.ts` for auth protection | Next.js 16 renames `middleware.ts` → `proxy.ts` (still works but deprecated) | LOW — works either way for now, but use `proxy.ts` for forward-compat |
| Hobby SSE timeout "5–15 min" | Hobby = 300s (5 min) hard cap. Pro = 800s (~13 min) max with fluid compute | LOW — slightly worse than scope thought |

**Net impact for the 7-day timeline:** the scope's pseudocode for the workflow doesn't compile as-written. Section 4 of the scope (`waitForEvent(['call','cancel','recompute'], { timeout: 30s })`) needs to be rewritten as `Promise.race([hook, sleep("30s")])` per event arm. **This is a 1–2 hour rework, not a redesign** — the durability semantics are unchanged.

---

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|---|---|---|---|
| **Next.js** | `16.x` (latest stable as of 2026-04-25) | App framework, hosting target | App Router is required for Route Handlers + RSC; Next.js 16 ships Turbopack stable + better caching APIs. Pinning to 16 also makes the MCP devtools and `proxy.ts` available. |
| **React** | `19.2` (ships with Next.js 16) | UI runtime | Required by Next.js 16. `useEffectEvent`, `<Activity/>` available. |
| **TypeScript** | `5.6+` | Type safety | Next.js 16 requires TS 5.1+; pick latest. |
| **Node.js** | `20.9+` | Runtime | Required minimum for Next.js 16. |
| **Vercel Workflow SDK** | `workflow@latest` (currently 4.x; pin `>=4.0.1-beta.26` if on Next.js 16.1+) | Durable workflows for reservation lifecycle | The locked Track 1 tech. `"use workflow"` + `"use step"` directives + `createHook()` + `sleep()` give us the full state machine. |
| **mcp-handler** | `mcp-handler@1.1.0` + `@modelcontextprotocol/sdk@1.26.0` (security floor) + `zod@^3` | Public MCP server | Locked Track 2 tech. Co-hosts cleanly inside Next.js as a Route Handler. Officially maintained by Vercel. |
| **AI SDK** | `ai@6` + `@ai-sdk/react@6` | LLM orchestration + chatbot | `useChat` + `streamText` + `tool()` give us the chatbot in <100 lines. v6 is current. |
| **AI Gateway** | (no SDK — env var `AI_GATEWAY_API_KEY`) | Unified model access | Provides Claude Sonnet 4.6 with no Anthropic key needed. Auto-provisioned by Vercel integration. |
| **@neondatabase/serverless** | `^0.10.x` | Postgres driver (HTTP + WebSocket) | Replaces deprecated `@vercel/postgres`. Works in Edge + Node runtimes. Auto-provisioned by Vercel-Neon Marketplace integration. |
| **@upstash/redis** | `^1.34.x` | Redis client + pub/sub over HTTP/SSE | Replaces deprecated `@vercel/kv`. **Critically: HTTP-based pub/sub works in serverless.** |
| **@vercel/edge-config** | `^1.x` | Read-only fast config (no redeploy) | The "demo gold" item. Sub-15ms reads. Writes go through Vercel REST API. |
| **next-auth** | `next-auth@beta` (Auth.js v5) | Maître authentication | Magic-link via Resend provider; PG adapter stores users/sessions/verification tokens in same Neon DB. |
| **@auth/pg-adapter** | `^1.x` (latest) | Auth.js → Postgres bridge | Required to persist Auth.js entities. Compatible with Neon via standard `pg` Pool. |
| **Resend** | (REST, no SDK strictly required) | Magic-link email delivery | Used by `next-auth/providers/resend`. Free tier covers a hackathon piloto. |
| **shadcn/ui** | `shadcn@latest` CLI | Component library | Prescriptive for Track 2 (v0 emits shadcn). Tailwind v4 supported in current CLI. |
| **Tailwind CSS** | `v4` (default with `create-next-app@latest` in 2026) | Styling | Comes with current shadcn `init`. |
| **v0** | (web tool, no install) | UI scaffolding | Generates shadcn-based components from prompts. Use for the chatbot widget shell + maître panel cards. |

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---|---|---|---|
| `zod` | `^3.x` | Runtime validation | MCP tool inputs, Auth.js callbacks, API route bodies. **Required peer of `mcp-handler`**. |
| `pg` | `^8.x` | Pool driver for Auth.js adapter | `@auth/pg-adapter` requires a `pg.Pool`. Use the standard `pg` package (not `@neondatabase/serverless`) in the Auth.js wiring because the adapter expects classical Pool semantics. For application queries (workflow steps, route handlers), use `@neondatabase/serverless`. |
| `nanoid` or `crypto.randomUUID()` | (built-in) | `session_token` UUID v4, MCP_API_KEY | Use Web Crypto's `crypto.randomUUID()` — zero deps, works on Node + Edge. |
| `tsx` | latest | Run TS scripts (seed, migrate) | `npm run db:migrate`, `npm run db:seed`. |
| `eventsource-parser` | (only if writing custom SSE client) | Parse SSE on the server side | Usually unnecessary — browser `EventSource` handles client side; server side can write raw `data: ...\n\n`. |

### Development Tools

| Tool | Purpose | Notes |
|---|---|---|
| Vercel CLI | Link, deploy, env pull | `vercel link`, `vercel env pull .env.local`, `vercel --prod`. |
| GitHub CLI (`gh`) | Repo create + PRs | `gh repo create restaurant-queue --public --source=. --push`. |
| `npx workflow@latest` | One-shot scaffolder for WDK | **Verify the exact CLI name before assuming this exists** — the scope doc references `npx workflow@latest`; the docs only confirm `npm i workflow` + manual `withWorkflow` wrapping. Treat the CLI as nice-to-have, not load-bearing. |
| MCP Inspector | Test the MCP server locally | Comes with `@modelcontextprotocol/sdk`. Streamable HTTP transport. |
| `next-devtools-mcp` | AI-assisted debugging during dev | Optional but free — Next.js 16 ships it. Add to `.mcp.json` for Claude Code to introspect the running app. |

---

## Installation

**Single block — copy/paste at start of Phase 1:**

```bash
# Scaffold (Tailwind v4 default in 2026)
npx create-next-app@latest restaurant-queue --typescript --tailwind --app --no-src-dir
cd restaurant-queue

# Workflow SDK (locked Track 1)
npm install workflow

# MCP server (locked Track 2)
npm install mcp-handler @modelcontextprotocol/sdk@1.26.0 zod

# AI SDK + Gateway
npm install ai @ai-sdk/react @ai-sdk/mcp

# Storage (NEW — replaces @vercel/postgres + @vercel/kv)
npm install @neondatabase/serverless @upstash/redis @vercel/edge-config

# Auth.js v5 + Postgres adapter
npm install next-auth@beta @auth/pg-adapter pg

# Dev
npm install -D tsx @types/pg

# UI
npx shadcn@latest init        # accept defaults: new-york style, neutral colors, Tailwind v4
```

**Then wire `next.config.ts`:**

```ts
// next.config.ts
import { withWorkflow } from "workflow/next";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // your config here
};

export default withWorkflow(nextConfig);
```

**`tsconfig.json` — add the workflow plugin for IDE intellisense (optional but high ROI):**

```json
{
  "compilerOptions": {
    "plugins": [{ "name": "workflow" }]
  }
}
```

---

## Highest-risk integration snippets

These are the items where "guess and fix" eats the most hours. Pinning the exact shape here.

### 1. WDK workflow with hook + timeout (the scope's `waitForEvent` doesn't exist)

```ts
// lib/workflows/reservationWorkflow.ts
import { createHook, sleep } from "workflow";

type DinerEvent =
  | { type: "call" }
  | { type: "cancel" }
  | { type: "extend" }
  | { type: "seated" }
  | { type: "no_show_manual" };

export async function reservationWorkflow(reservationId: string) {
  "use workflow";

  // ===== WAITING PHASE =====
  let status: "waiting" | "called" = "waiting";

  while (status === "waiting") {
    using hook = createHook<DinerEvent>({ token: `reservation:${reservationId}:waiting` });

    // race the hook against a 30s recompute timer
    const result = await Promise.race([
      hook.then(e => ({ kind: "event" as const, event: e })),
      sleep("30s").then(() => ({ kind: "timeout" as const })),
    ]);

    if (result.kind === "event") {
      if (result.event.type === "call") { status = "called"; break; }
      if (result.event.type === "cancel") { return await finalize(reservationId, "cancelled"); }
    }
    // timeout → recompute ETA, loop
    await recomputeEtaStep(reservationId);
  }

  // ===== CALLED PHASE =====
  await markCalledStep(reservationId);
  await pushToDinerStep(reservationId, "TU MESA ESTÁ LISTA");

  // 1-min pre-followup race
  using preHook = createHook<DinerEvent>({ token: `reservation:${reservationId}:called:pre` });
  const preResult = await Promise.race([
    preHook.then(e => ({ kind: "event" as const, event: e })),
    sleep("1m").then(() => ({ kind: "timeout" as const })),
  ]);

  if (preResult.kind === "event") {
    return await handleCalledEvent(reservationId, preResult.event);
  }
  // pre-followup timeout → send proactive followup, enter final loop
  await pushToDinerStep(reservationId, "¿Estás en camino? [+5 min] [Cancelar]");

  // ===== FINAL LOOP =====
  while (true) {
    using finalHook = createHook<DinerEvent>({ token: `reservation:${reservationId}:called:final` });
    const r = await Promise.race([
      finalHook.then(e => ({ kind: "event" as const, event: e })),
      sleep(`${await getNoShowDeadlineMinutesRemaining(reservationId)}m`)
        .then(() => ({ kind: "timeout" as const })),
    ]);
    if (r.kind === "timeout") return await finalize(reservationId, "no_show");
    const next = await handleCalledEvent(reservationId, r.event);
    if (next) return next; // seated / cancelled / no_show_manual
    // extend loops back
  }
}

async function recomputeEtaStep(id: string) { "use step"; /* ... */ }
async function markCalledStep(id: string) { "use step"; /* ... */ }
async function pushToDinerStep(id: string, msg: string) { "use step"; /* publishes to Upstash */ }
```

**Note the `using` keyword.** `createHook()` returns a disposable. The TypeScript "explicit resource management" syntax (`using hook = ...`) auto-disposes when the scope exits. Requires TS 5.2+ and Node 22+ (or the Symbol.dispose polyfill). Next.js 16 + Node 20.9+ minimum is borderline — **verify in Phase 1 that `using` compiles**, otherwise fall back to manual `hook.dispose()` in a try/finally.

**Resuming a hook from outside the workflow** (e.g., when the maître hits "Llamar"):

```ts
// app/api/queue/[id]/call/route.ts
import { resumeHook } from "workflow/api";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Resume whatever waiting/called/final hook is open
  // (token must match what the workflow used)
  await resumeHook(`reservation:${id}:waiting`, { type: "call" });
  return Response.json({ ok: true });
}
```

(In practice you'll need to track which token is currently active per reservation in Postgres or KV, since the workflow moves through 3 different token names.)

### 2. MCP server with auth header (current `mcp-handler` shape)

```ts
// app/mcp/[transport]/route.ts
import { createMcpHandler, withMcpAuth } from "mcp-handler";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { z } from "zod";

const handler = createMcpHandler(
  (server) => {
    server.registerTool(
      "create_reservation",
      {
        title: "Create reservation",
        description: "Add a diner to the waitlist",
        inputSchema: {
          name: z.string().min(1),
          email: z.string().email(),
          phone: z.string().min(5),
          party_size: z.number().int().min(1).max(20),
        },
      },
      async ({ name, email, phone, party_size }) => {
        // ... insert into Postgres, start workflow, return reservation_id + session_token
        return { content: [{ type: "text", text: JSON.stringify({ reservation_id, position, eta_min, session_token }) }] };
      }
    );
    // register get_reservation_status, extend_wait, cancel_reservation similarly
  },
  {},
  { basePath: "/mcp", maxDuration: 60, verboseLogs: process.env.NODE_ENV !== "production" }
);

const verifyToken = async (req: Request, bearer?: string): Promise<AuthInfo | undefined> => {
  if (!bearer || bearer !== process.env.MCP_API_KEY) return undefined;
  return { token: bearer, scopes: ["diner"], clientId: "diner-chatbot", extra: {} };
};

const authHandler = withMcpAuth(handler, verifyToken, { required: true });

export { authHandler as GET, authHandler as POST, authHandler as DELETE };
```

For the per-reservation `session_token` validation (so diner A can't mutate diner B's reservation), do it **inside each tool's `execute`** by reading a custom header (e.g., `X-Reservation-Session`) from the original request. The MCP `withMcpAuth` only handles bearer; per-resource auth is on you.

### 3. Upstash Redis pub/sub for SSE fan-out (NOT BLPOP)

```ts
// lib/realtime.ts
import { Redis } from "@upstash/redis";

export const redis = Redis.fromEnv(); // reads UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN

// from a workflow step:
export async function publishReservationEvent(id: string, event: unknown) {
  "use step";
  await redis.publish(`reservation:${id}`, JSON.stringify(event));
  await redis.publish(`queue:active`, JSON.stringify({ reservation_id: id, ...event }));
}

// from the SSE Route Handler:
// app/api/events/[reservation_id]/route.ts
export const runtime = "nodejs";        // not edge — see notes
export const maxDuration = 300;         // hobby cap

export async function GET(req: Request, { params }: { params: Promise<{ reservation_id: string }> }) {
  const { reservation_id } = await params;
  const stream = new ReadableStream({
    async start(controller) {
      const sub = redis.subscribe([`reservation:${reservation_id}`]);
      sub.on("message", (data) => {
        controller.enqueue(new TextEncoder().encode(`data: ${data.message}\n\n`));
      });
      // heartbeat every 25s to keep proxies happy
      const heartbeat = setInterval(() => {
        controller.enqueue(new TextEncoder().encode(`: ping\n\n`));
      }, 25_000);
      req.signal.addEventListener("abort", () => {
        clearInterval(heartbeat);
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

**Why not BLPOP:** in a serverless function, BLPOP blocks the function until either a value arrives or the function timeout (300s) kills it — and only ONE consumer drains each value (no fan-out). The Upstash HTTP `subscribe()` is built on SSE and supports multiple concurrent subscribers. Use it.

**Why nodejs runtime not edge:** Node runtime gives you the full 300s on Hobby (vs Edge's 25s response-start window + 300s stream); also `@upstash/redis` and `@neondatabase/serverless` both work fine in Node. Pick Node for SSE handlers, Edge only if you measure a real need.

### 4. AI SDK chatbot + AI Gateway with Claude Sonnet 4.6

```ts
// app/api/chat/route.ts
import { streamText, convertToModelMessages, type UIMessage } from "ai";
import { createMCPClient } from "@ai-sdk/mcp";

export const maxDuration = 60;

export async function POST(req: Request) {
  const { messages, sessionToken }: { messages: UIMessage[]; sessionToken?: string } = await req.json();

  const mcp = await createMCPClient({
    transport: {
      type: "http",
      url: `${process.env.NEXT_PUBLIC_BASE_URL}/mcp/http`,
      headers: {
        Authorization: `Bearer ${process.env.MCP_API_KEY!}`,
        ...(sessionToken ? { "X-Reservation-Session": sessionToken } : {}),
      },
    },
  });
  const tools = await mcp.tools();

  const result = streamText({
    model: "anthropic/claude-sonnet-4.6",   // ← DOT, not dash
    system: "Sos el host de un restaurante. Recolectás nombre, email, teléfono y cantidad de personas en una conversación natural en español.",
    messages: await convertToModelMessages(messages),
    tools,
    onFinish: async () => { await mcp.close(); },
  });

  return result.toUIMessageStreamResponse();
}
```

```tsx
// app/page.tsx (Client Component)
"use client";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useState } from "react";

export default function Chat() {
  const { messages, sendMessage, status } = useChat({
    transport: new DefaultChatTransport({ api: "/api/chat" }),
  });
  const [input, setInput] = useState("");
  return (
    <div>
      {messages.map(m => (
        <div key={m.id}>
          <strong>{m.role}:</strong>{" "}
          {m.parts.map((p, i) => p.type === "text" ? <span key={i}>{p.text}</span> : null)}
        </div>
      ))}
      <form onSubmit={e => { e.preventDefault(); sendMessage({ text: input }); setInput(""); }}>
        <input value={input} onChange={e => setInput(e.target.value)} />
        <button disabled={status !== "ready"}>Enviar</button>
      </form>
    </div>
  );
}
```

**Env var:** `AI_GATEWAY_API_KEY` is auto-read by the AI SDK when you use a string model id like `"anthropic/claude-sonnet-4.6"`. No `createAnthropic()` needed — that's only for direct Anthropic API access. The Vercel-AI Gateway integration auto-provisions this var.

### 5. Auth.js v5 with Resend + Postgres adapter (on Neon)

```ts
// auth.ts
import NextAuth from "next-auth";
import Resend from "next-auth/providers/resend";
import PostgresAdapter from "@auth/pg-adapter";
import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,    // Neon-injected
  max: 5,
});

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PostgresAdapter(pool),
  providers: [
    Resend({
      from: "Restaurant Queue <onboarding@resend.dev>",  // or your verified domain
      apiKey: process.env.AUTH_RESEND_KEY,
    }),
  ],
  pages: { signIn: "/login" },
  session: { strategy: "database" },
});
```

```ts
// app/api/auth/[...nextauth]/route.ts
export { GET, POST } from "@/auth";
```

```ts
// proxy.ts  (formerly middleware.ts in Next.js 15; rename in Next.js 16)
import { auth } from "@/auth";
export default auth((req) => {
  if (req.nextUrl.pathname.startsWith("/queue") && !req.auth) {
    return Response.redirect(new URL("/login", req.url));
  }
});
export const config = { matcher: ["/queue/:path*"] };
```

**SQL the adapter needs** — get the schema from the Auth.js `@auth/pg-adapter` README and run it before first login. Tables: `users`, `accounts`, `sessions`, `verification_token`. Add your `employees` table with `user_id uuid references users(id)` to bridge to your roles.

### 6. Edge Config reads (and writes via REST)

```ts
// lib/config.ts
import { get } from "@vercel/edge-config";

export async function getConfig<T>(key: string, fallback: T): Promise<T> {
  return ((await get<T>(key)) ?? fallback);
}

// usage in workflow step:
const noShowMin = await getConfig("no_show_timeout_min", 10);
```

**Writes** — the SDK is read-only. To update Edge Config from a script (or admin UI), call the Vercel REST API:

```bash
curl -X PATCH "https://api.vercel.com/v1/edge-config/${EDGE_CONFIG_ID}/items" \
  -H "Authorization: Bearer ${VERCEL_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"items":[{"operation":"upsert","key":"no_show_timeout_min","value":2}]}'
```

For the demo "live edit" moment, the Vercel dashboard UI is fine — no script needed.

---

## Environment variables — auto-provisioned vs manual

| Var | Source | Required at | Notes |
|---|---|---|---|
| `DATABASE_URL` | Neon Marketplace integration | All envs | Neon's standard name. May also expose `POSTGRES_URL` for back-compat — both point to same DB. |
| `UPSTASH_REDIS_REST_URL` | Upstash Marketplace integration | All envs | Plus `UPSTASH_REDIS_REST_TOKEN`. `Redis.fromEnv()` reads both. |
| `EDGE_CONFIG` | Vercel Edge Config | All envs | Connection string format: `https://edge-config.vercel.com/<id>?token=<read_token>`. |
| `AI_GATEWAY_API_KEY` | Vercel AI Gateway integration | All envs | Auto-read by AI SDK when using string model ids. |
| `AUTH_SECRET` | Generate with `npx auth secret` | All envs | Required by Auth.js v5. |
| `AUTH_RESEND_KEY` | Manual — from resend.com dashboard | All envs | Auth.js v5 reads `AUTH_RESEND_KEY` by default for the Resend provider. |
| `MCP_API_KEY` | Generate with `openssl rand -hex 32` | All envs | Your own — protects the MCP server from public abuse. |
| `NEXT_PUBLIC_BASE_URL` | Manual: `https://<project>.vercel.app` | All envs | Used by the chat route to call its own MCP. |
| `VERCEL_TOKEN` | Manual — from Vercel account settings | Local only | For Edge Config writes via API. NOT a deploy-time var. |

The scope's variable list (`POSTGRES_URL`, `POSTGRES_PRISMA_URL`, `POSTGRES_URL_NON_POOLING`, `KV_URL`, `KV_REST_API_URL`, `KV_REST_API_TOKEN`) reflects the **deprecated** `@vercel/postgres` + `@vercel/kv` shape. The Neon and Upstash integrations expose different names (above). Your code should reference the new names.

---

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|---|---|---|
| `mcp-handler` | `@vercel/mcp-adapter` | Only if you find an example that uses it and don't want to translate. Both work today; `mcp-handler` is the actively maintained one. |
| `@neondatabase/serverless` | `pg` directly | For the Auth.js adapter you MUST use `pg` (Pool). For app queries, `@neondatabase/serverless` is faster cold-start in serverless. |
| `@upstash/redis` HTTP pub/sub | `@upstash/redis` LIST + LPUSH/BLPOP | Never in serverless — BLPOP blocks until function timeout. LIST+LPUSH (without BLPOP) works for queue-style fan-in but not for SSE fan-out. |
| String model id `"anthropic/claude-sonnet-4.6"` | `createAnthropic()` from `@ai-sdk/anthropic` | Only if you BYO Anthropic key and want to bypass the Gateway. For this project: don't — you'd lose the auto-provisioned key. |
| Auth.js v5 (`next-auth@beta`) | Clerk, Lucia, custom JWT | Auth.js v5 is the locked choice (no third-party deps). Clerk would be faster but adds a credential and is out of scope. |
| `proxy.ts` (Next.js 16) | `middleware.ts` (Next.js 15) | If you somehow stay on Next.js 15. The Auth.js v5 `auth()` helper works in both. |
| SSE from Route Handler | WebSocket via Upstash + custom server | SSE is one-way and trivial. WebSocket needs a separate Edge service or a long-running process — not free in Vercel's model. |
| `crypto.randomUUID()` | `nanoid` | Both fine. Built-in saves a dep. |

---

## What NOT to Use

| Avoid | Why | Use Instead |
|---|---|---|
| `@vercel/postgres` | Deprecated Dec 2024; redirects to Neon | `@neondatabase/serverless` |
| `@vercel/kv` | Deprecated Dec 2024; redirects to Upstash | `@upstash/redis` |
| `@vercel/workflow` (npm) | Wrong package name — package is just `workflow` | `npm install workflow` |
| `next-auth@4` (the original NextAuth) | Different API, deprecated; the v5 beta has been stable for 18+ months | `next-auth@beta` (which is Auth.js v5) |
| `@auth/core` directly | Lower-level than you need; the `next-auth` package wraps it | `next-auth@beta` + `@auth/pg-adapter` |
| `waitForEvent({ timeout })` | API does not exist in workflow SDK | `Promise.race([createHook(), sleep("Xm")])` |
| BLPOP in SSE handler | Blocks function for the full 300s, no fan-out | `redis.subscribe()` (HTTP/SSE) |
| Edge runtime for SSE handlers | 25s response-start cap is fragile + you don't gain much | `runtime = "nodejs"` |
| `useChat` `handleInputChange`/`handleSubmit` from old AI SDK | v6 changed to `sendMessage({ text })` + manage your own input state | See snippet above |
| Cron jobs for the no-show timer | The whole point of WDK is "no cron" — sleep+hook+race does it | Promise.race(hook, sleep(deadline)) |
| `createAnthropic()` + Anthropic API key | You'd be paying Anthropic and bypassing the Gateway | Bare model id `"anthropic/claude-sonnet-4.6"` reads `AI_GATEWAY_API_KEY` |
| `images.domains` config | Deprecated in Next.js 16 | `images.remotePatterns` (not relevant here unless you use external images) |
| `npx workflow@latest` as a CLI scaffolder | Unverified — the docs only confirm `npm i workflow` | Run `npm i workflow` and write `next.config.ts` by hand (3 lines) |

---

## Stack Patterns by Variant

**If you stay on Next.js 15** (e.g., to avoid Next.js 16 breaking changes during the hackathon):
- Pin `next@15.x.x` and `workflow@<4.0.1-beta.26` (older WDK versions had different Next.js compat — check the WDK release notes).
- Use `middleware.ts` not `proxy.ts`.
- Async `params`/`cookies()`/`headers()` is still required (this changed in 15, not 16).
- Tailwind CSS 4 still works.
- **Recommendation: just go with Next.js 16.** It's been stable since Oct 2025 and the migration codemod handles 90% of changes.

**If the Auth.js `using` syntax + `pg.Pool` clashes with Neon's HTTP driver:**
- Run `pg` Pool against Neon's standard Postgres TCP endpoint (Neon supports both). Auth.js sessions are infrequent; the Pool is fine.
- Run application queries (workflow steps, MCP tools) via `@neondatabase/serverless` HTTP for cold-start speed.
- Two clients pointing at the same DB is fine; they don't fight.

**If Resend domain verification is too slow for the hackathon timeline:**
- Use `from: "onboarding@resend.dev"` initially. Works for testing; emails go to your inbox. Switch to a verified domain post-pilot.

---

## Version Compatibility

| Package A | Compatible With | Notes |
|---|---|---|
| `next@16.x` | `react@19.2`, `node>=20.9` | Hard requirement. |
| `workflow@4.x` | `next@15` and `next@16` (latest betas) | If on Next.js 16.1+, use `workflow@>=4.0.1-beta.26` to avoid `Cannot find module 'next/dist/lib/server-external-packages.json'` error. Pin exact version in `package.json`. |
| `mcp-handler@1.1.0` | `@modelcontextprotocol/sdk@1.26.0+` | Older `@modelcontextprotocol/sdk` versions have a known security vuln. Pin floor at 1.26.0. |
| `next-auth@beta` (5.x) | `@auth/pg-adapter@^1.x` + `pg@^8.x` | Adapter needs `pg.Pool`, not `@neondatabase/serverless`. |
| `ai@6` | `@ai-sdk/react@6` + `@ai-sdk/mcp@latest` | Major version must match between core and react. |
| `@upstash/redis@^1.34` | Node.js 20+ | HTTP-based; works in Edge and Node runtimes. |
| `@neondatabase/serverless@^0.10` | Node.js 18+ | HTTP and WebSocket transports both supported. |
| `shadcn` CLI | Tailwind v4 + React 19 | New `init` defaults to v4 + new-york style. |

---

## Confidence per item (your quality gate)

| Item | Confidence | Source |
|---|---|---|
| `workflow` is the package name (not `@vercel/workflow`) | HIGH | [Vercel Workflows docs](https://vercel.com/docs/workflow), [Workflow SDK docs](https://workflow-sdk.dev) |
| `withWorkflow` import from `workflow/next` | HIGH | [Workflow SDK Next.js getting started](https://workflow-sdk.dev/docs/getting-started/next) |
| `"use workflow"` and `"use step"` directives | HIGH | Vercel docs example + workflow-sdk.dev foundations |
| `createHook()` instead of `waitForEvent` | HIGH | [Hooks docs](https://workflow-sdk.dev/docs/foundations/hooks) — explicit "no timeout parameter" |
| Hook + `sleep()` + `Promise.race()` for timeouts | HIGH | Workflow SDK common patterns + Slack agent KB guide |
| `mcp-handler@1.1.0` is current MCP package | HIGH | [github.com/vercel/mcp-handler](https://github.com/vercel/mcp-handler) latest release Mar 24 2026 |
| MCP route shape `app/[transport]/route.ts` with `createMcpHandler` | HIGH | [Vercel MCP deploy docs](https://vercel.com/docs/mcp/deploy-mcp-servers-to-vercel) |
| `withMcpAuth` for bearer token | HIGH | Same Vercel MCP docs |
| AI SDK v6, `useChat` from `@ai-sdk/react`, `streamText` from `ai` | HIGH | [AI SDK chatbot docs](https://ai-sdk.dev/docs/ai-sdk-ui/chatbot) |
| `anthropic/claude-sonnet-4.6` model id (DOT not dash) | HIGH | [Vercel changelog Feb 17 2026](https://vercel.com/changelog/claude-sonnet-4-6-is-live-on-ai-gateway) + [model card page](https://vercel.com/ai-gateway/models/claude-sonnet-4.6) |
| `AI_GATEWAY_API_KEY` env var auto-read by AI SDK | HIGH | [Vercel AI Gateway docs](https://vercel.com/docs/ai-gateway) |
| `@ai-sdk/mcp` `createMCPClient` with HTTP transport | HIGH | [AI SDK MCP tools docs](https://ai-sdk.dev/docs/ai-sdk-core/mcp-tools) |
| Vercel Postgres deprecated, use Neon + `@neondatabase/serverless` | HIGH | [Postgres on Vercel docs](https://vercel.com/docs/postgres) — explicit deprecation banner |
| Vercel KV deprecated, use Upstash + `@upstash/redis` | HIGH | [Redis on Vercel docs](https://vercel.com/docs/redis) — explicit deprecation banner |
| `@upstash/redis` `subscribe()` works in serverless via HTTP/SSE | HIGH | [Upstash REST API docs](https://upstash.com/docs/redis/features/restapi) + DeepWiki pubsub system |
| `@vercel/edge-config` `get()` SDK is read-only; writes via REST | HIGH | [Edge Config SDK docs](https://vercel.com/docs/edge-config/edge-config-sdk) |
| Auth.js v5 = `next-auth@beta` package | HIGH | [Auth.js installation docs](https://authjs.dev/getting-started/installation) |
| Resend provider import `next-auth/providers/resend` | HIGH | [Auth.js email docs](https://authjs.dev/getting-started/authentication/email) |
| `@auth/pg-adapter` with `pg.Pool` | HIGH | [Auth.js PG adapter docs](https://authjs.dev/getting-started/adapters/pg) |
| Hobby function timeout 300s, Pro 800s | HIGH | [Vercel function limits](https://vercel.com/docs/functions/limitations) |
| Next.js 16 `proxy.ts` replaces `middleware.ts` | HIGH | [Next.js 16 blog](https://nextjs.org/blog/next-16) |
| shadcn/ui current `npx shadcn@latest init` with Tailwind v4 | HIGH | [shadcn Next.js install docs](https://ui.shadcn.com/docs/installation/next) + Tailwind v4 page |
| v0 emits shadcn-compatible Next.js components | MEDIUM | [v0.app/docs](https://v0.app/docs/) — confirms shadcn integration but doesn't pin Next.js 16 specifically |
| `using` keyword (TS explicit resource management) compiles in this stack | MEDIUM | TypeScript 5.2+, Node 20+ both support it but real-world Vercel build verification needed in Phase 1 |
| `npx workflow@latest` CLI scaffolder | LOW | Scope doc references it; official docs only confirm `npm i workflow`. Treat as "try it, fall back to manual config" |

---

## Sources

- [Vercel Workflows docs](https://vercel.com/docs/workflow) — package name `workflow`, Next.js integration, observability
- [Workflow SDK docs (workflow-sdk.dev)](https://workflow-sdk.dev) — `withWorkflow`, `createHook`, `sleep`, `Promise.race` patterns
- [Workflow SDK Next.js setup](https://workflow-sdk.dev/docs/getting-started/next) — install + config wrapping + Next.js 16.1 compat note
- [Hooks & Webhooks foundations](https://workflow-sdk.dev/docs/foundations/hooks) — confirmed no timeout param on hooks
- [GitHub issue #553 vercel/workflow](https://github.com/vercel/workflow/issues/553) — timeout feature request status
- [Building stateful Slack bots with Vercel Workflow](https://vercel.com/kb/guide/stateful-slack-bots-with-vercel-workflow) — `Promise.race(webhook, sleep("1 minute"))` pattern
- [Vercel MCP deploy docs](https://vercel.com/docs/mcp/deploy-mcp-servers-to-vercel) — `mcp-handler` route pattern, `withMcpAuth`
- [github.com/vercel/mcp-handler](https://github.com/vercel/mcp-handler) — v1.1.0 release notes (Mar 24 2026), security floor `@modelcontextprotocol/sdk@1.26.0`
- [Vercel AI Gateway docs](https://vercel.com/docs/ai-gateway) — bearer auth + `AI_GATEWAY_API_KEY`
- [Vercel changelog: Claude Sonnet 4.6 live on AI Gateway](https://vercel.com/changelog/claude-sonnet-4-6-is-live-on-ai-gateway) — Feb 17 2026, model id `anthropic/claude-sonnet-4.6` (dot)
- [Vercel AI Gateway models](https://vercel.com/ai-gateway/models/claude-sonnet-4.6) — model card confirms dot format
- [AI SDK chatbot docs](https://ai-sdk.dev/docs/ai-sdk-ui/chatbot) — current `useChat` v6 shape, `DefaultChatTransport`
- [AI SDK MCP tools](https://ai-sdk.dev/docs/ai-sdk-core/mcp-tools) — `createMCPClient` with HTTP transport
- [Postgres on Vercel](https://vercel.com/docs/postgres) — deprecation banner, redirect to Neon
- [Redis on Vercel](https://vercel.com/docs/redis) — deprecation banner, redirect to Upstash
- [Neon serverless driver docs](https://neon.com/docs/serverless/serverless-driver) — `neon()` HTTP client with template literals
- [Upstash Redis REST API](https://upstash.com/docs/redis/features/restapi) — pub/sub over SSE
- [Upstash Redis subscribe()](https://upstash.com/docs/redis/sdks/ts/commands/pubsub/subscribe) — `redis.subscribe([channels])` shape
- [DeepWiki Upstash pub/sub](https://deepwiki.com/upstash/redis-js/4.8-pubsub-system) — internals confirming HTTP/SSE
- [Vercel Edge Config](https://vercel.com/docs/edge-config) — overview, P99 < 15ms read latency
- [Edge Config SDK](https://vercel.com/docs/edge-config/edge-config-sdk) — `get`, `getAll`, `createClient`; SDK is read-only
- [Edge Config REST API](https://vercel.com/docs/edge-config/vercel-api) — for writes
- [Auth.js installation](https://authjs.dev/getting-started/installation) — `next-auth@beta` is v5
- [Auth.js Email/Resend provider](https://authjs.dev/getting-started/authentication/email) — `next-auth/providers/resend`, `AUTH_RESEND_KEY`
- [Auth.js PG adapter](https://authjs.dev/getting-started/adapters/pg) — `@auth/pg-adapter` + `pg.Pool`, Neon-compatible
- [Vercel Function limits](https://vercel.com/docs/functions/limitations) — Hobby 300s, Pro 800s, with fluid compute
- [Next.js 16 release blog](https://nextjs.org/blog/next-16) — Oct 21 2025; `proxy.ts` replaces `middleware.ts`, async params, Turbopack default
- [Next.js MCP guide](https://nextjs.org/docs/app/guides/mcp) — `next-devtools-mcp` for AI debugging
- [shadcn/ui Next.js install](https://ui.shadcn.com/docs/installation/next) — current init flow
- [shadcn/ui Tailwind v4](https://ui.shadcn.com/docs/tailwind-v4) — v4 + React 19 default for new projects
- [v0.app/docs](https://v0.app/docs/) — shadcn integration, prompt → component → ship flow

---
*Stack research for: Vercel-native restaurant queue MVP (hackathon, ~7 days, solo dev, Next.js 16 + WDK + MCP + AI Gateway)*
*Researched: 2026-04-25*
