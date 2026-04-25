# Project Research Summary

**Project:** Restaurant Queue MVP — Zero to Agent (hackathon + real-world pilot)
**Domain:** Vercel-native conversational waitlist (chatbot + MCP server + WDK durable workflow + SSE)
**Researched:** 2026-04-25
**Confidence:** HIGH for stack/architecture/pitfalls; HIGH for table-stakes feature surface
**Timeline:** ~7 days, solo dev, real piloto restaurant starts same week

---

## 1. Verdict

**Build it as scoped, but with surgical corrections — and start Phase 0 today.** The product thesis (chatbot-as-entry, MCP-as-platform, WDK-as-durability money shot, Edge Config live-edit moment) is sound and uniquely positioned vs. every commercial waitlist (Yelp, OpenTable, SevenRooms, Toast, Waitlist Me) — none market durability or expose their backend as an MCP. The locked stack works. **However, the scope's pseudocode does not compile as written**: it uses deprecated package names (`@vercel/postgres`, `@vercel/kv`, `@vercel/workflow`, `@vercel/mcp-adapter`), an API that doesn't exist (`waitForEvent({ timeout })`), the wrong model id (`anthropic/claude-sonnet-4-6` should be `4.6` with a dot), and a cookie pattern (set during streaming) that violates HTTP. These are 1–4 hour corrections each, not a redesign — but they must be applied before Phase 1 finishes, or every downstream phase inherits the wrong assumptions. The non-negotiable Phase 0 blocker is **Resend domain verification (0–48h DNS propagation)**: without it, the maître's magic-link auth fails on demo day and the pilot is dead.

---

## 2. Stack — Corrected from Scope

The stack thesis (100% Vercel, no third-party credentials) holds. The package names and API shapes need updating. **The scope was written against a 2024-vintage version of the Vercel platform; the platform has moved.**

| Scope says | Reality (2026-04-25) | Severity | Phase to fix |
|---|---|---|---|
| `@vercel/postgres` | `@neondatabase/serverless` (Vercel Postgres deprecated Dec 2024 → Neon) | HIGH | Phase 1 |
| `@vercel/kv` | `@upstash/redis` (Vercel KV deprecated Dec 2024 → Upstash) | HIGH | Phase 1 |
| `@vercel/workflow` package | Package is just `workflow` (`npm i workflow`) | HIGH | Phase 1 |
| `@vercel/mcp-adapter` | `mcp-handler@1.1.0` + `@modelcontextprotocol/sdk@>=1.26.0` | HIGH | Phase 1 |
| `waitForEvent(['call','cancel'], { timeout: 30s })` | API does not exist. Use `createHook()` + `Promise.race(hook, sleep("30s"))` | HIGH | Phase 2 |
| `anthropic/claude-sonnet-4-6` (dash) | `anthropic/claude-sonnet-4.6` (dot) — fails at runtime otherwise | HIGH | Phase 3 |
| `KV.publish/subscribe` "alternative LIST+BLPOP simpler" | Use Upstash `redis.subscribe()` over HTTP/SSE. **Never BLPOP in serverless** (blocks for full 300s timeout, no fan-out) | HIGH | Phase 2/3 |
| `next-auth` v4 | `next-auth@beta` (Auth.js v5); Resend provider is `next-auth/providers/resend` | MEDIUM | Phase 1 |
| `middleware.ts` for auth | Next.js 16 renames to `proxy.ts` (deprecated alias works) | LOW | Phase 1 |
| Env vars `POSTGRES_URL` / `KV_URL` | Now `DATABASE_URL` (Neon) / `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` | HIGH | Phase 1 |
| Hobby SSE timeout "5–15 min" | Hobby = 300s hard cap; Pro = 800s with Fluid Compute | LOW | Phase 3 |
| `@auth/pg-adapter` uses any pg client | MUST use `pg.Pool` (not `@neondatabase/serverless`) for the adapter — keep two clients | MEDIUM | Phase 1 |

**Net stack delta:** ~6 hours of corrections spread across Phases 1, 2, 3. **All confirmed correct in scope:** Next.js 16 + App Router + Tailwind v4, AI SDK v6 with `useChat`, Auth.js + Resend magic-link, Edge Config for live params, SSE from Route Handlers, `shadcn/ui` + `v0` for UI scaffolding, Vercel hosting + Marketplace integrations.

---

## 3. Architecture — Key Decisions (cross-cutting, not obvious from any single research file)

These five patterns are the architectural commitments that make the rest of the system safe. They cut across phases and must be set in stone before Phase 2 begins.

### 3.1 Service-layer funnel (`lib/services/*` is the single mutation path)

MCP tools, the staff API, and a future WhatsApp client all funnel through the same service functions. Service functions own: validate → DB write → `workflow.start()`/`hook.resume()` → KV publish → return. **Without this, the same logic exists in 3 places and drifts.** Tools and route handlers become 5–15 line wrappers. This is the most important architectural decision in the project.

### 3.2 Snapshot-replay-on-connect for SSE (Postgres is truth, KV is a hint)

Redis pub/sub is **at-most-once** — a publish that lands while no subscriber is connected is dropped forever. This bites every SSE reconnect (Vercel function timeout = 300s, EventSource auto-reconnects, gap = lost message = diner never sees "MESA LISTA"). **Fix:** every SSE handler does (1) read current snapshot from Postgres and emit as first event, then (2) subscribe to KV for future events. Combined with `Last-Event-ID`, reconnects auto-recover. Mandatory in Phase 3.

### 3.3 Pre-set cookie OR localStorage — never set cookie during streaming

The scope says "set the `reservation_session` cookie from the result of `create_reservation` returned mid-stream." HTTP forbids `Set-Cookie` after the response body has started flushing. The cookie silently fails in production and demo scenario #2 (vuelta con cookie) breaks. **Recommendation: cut the cookie now (it's already cut-list #1), use localStorage.** Don't discover this broken on day 5.

### 3.4 Freeze workflow shape after Phase 2; only modify step bodies thereafter

WDK replays workflows from a deterministic transcript. **Adding/removing/reordering steps in a deployed workflow breaks every in-flight reservation** — exactly the money shot you're trying to demo. Vercel Skew Protection helps but isn't magic. After Phase 2 ships the workflow skeleton: only modify step **bodies**, never **count or order**. Add new steps at the END or behind Edge Config feature flags. This constraint should appear in `lib/workflows/_README.md` from day one.

### 3.5 Hook resume is in-process, not HTTP

Staff API endpoints (`POST /api/queue/[id]/call`) call `callHook.resume(reservationId, {})` directly via import — never `fetch()` back to a workflow endpoint. Same goes for MCP tools dispatching to workflows. HTTP self-calls add latency, an auth hop, and a failure mode for no benefit.

---

## 4. Phase 0 Today — Longest-Lead-Time Blockers

These cannot wait for the agent to start coding. Do them **before** spawning Phase 1.

| # | Blocker | Why it blocks | Action |
|---|---|---|---|
| 0.1 | **Resend domain verification** | DNS propagation 0–48h. Without verified domain, magic-link emails go to spam OR bounce for any address that isn't your Resend account email. Maître can't log in → entire panel is dead → pilot fails. | **TODAY:** buy a domain if you don't have one (~$10), add to Resend, set SPF + DKIM + DMARC, wait for "verified" status. Do NOT start Phase 1 auth work until this shows green. |
| 0.2 | **`.env.example` inventory** | Easy to set vars in `.env.local` and forget production. | Create `.env.example` with every required key (no values) BEFORE Phase 1. Every new var added gets a line in `.env.example` in the same commit. |
| 0.3 | **Verify Vercel access for AI Gateway, Postgres, KV, Edge Config** | Marketplace integrations sometimes need a browser consent click. | Pre-provision (or at least pre-authorize) Postgres (Neon), KV (Upstash), Edge Config, AI Gateway in Vercel dashboard. |
| 0.4 | **Decide Next.js 15 vs 16** | Different middleware filename, different package version pins. Affects every phase. | **Recommendation: Next.js 16.** Stable since Oct 2025, codemod handles 90% of changes, gets `proxy.ts` + Turbopack stable + better cache APIs + `next-devtools-mcp`. |
| 0.5 | **Decide cookie strategy NOW** | If keeping it, Phase 3 needs the `client_session_id` plumbing. If cutting, Phase 3 is simpler. | **Recommendation: cut it. Use localStorage. Document in PROJECT.md as "validated cut" not "deferred".** |

Items 0.1 and 0.2 are blocking. Items 0.3, 0.4, 0.5 are unblocking-but-cheaper-now-than-later.

---

## 5. Roadmap Implications — Recommended Phase Structure

The scope has 12 micro-phases. The architecture research recommends collapsing them into **4 macro-phases** that align with the dependency graph and the chosen `granularity: coarse`. This makes the roadmap map cleanly to GSD's phase structure (each phase has its own discuss/plan/build cycle) without losing any work.

### Phase 1 — Foundation (Scaffolding + Vercel + DB + Auth + Edge Config)

**Collapses scope Fases 1, 2, 3, 4, 7.**

**Rationale:** All five fases are infrastructure with no app logic. They share env-var setup and migration discipline. **Critically: pull Edge Config forward from scope Fase 7 to here**, because the workflow code in Phase 2 needs `getConfig('no_show_timeout_min')` to compile cleanly.

**Delivers:** Empty Next.js 16 app deployed to a public Vercel URL. Postgres schema migrated. KV + Edge Config provisioned. Auth.js v5 with Resend magic-link working end-to-end (verified domain). Maître seed user.

**Pitfalls addressed:** #11 (Resend domain — start in Phase 0, verify here), #12 (Auth.js v5 split config edge/node), #13 (pooled vs non-pooled URL choice), #18 (env vars in all 3 environments), #19 (push to prod every phase starting now).

**Stack corrections applied:** All new package names; `proxy.ts` not `middleware.ts`; `@neondatabase/serverless` for app + `pg.Pool` for Auth adapter; Edge Config keys seeded.

### Phase 2 — Backend Core (MCP server + service layer + WDK workflow)

**Collapses scope Fases 5 + 6.** This is the critical path.

**Rationale:** MCP tools are thin wrappers around service functions; service functions invoke the workflow. Building them in tight sequence avoids interface drift. Includes the deploy-with-active-workflows smoke test that the scope incorrectly defers to Phase 11 — finding out the money shot doesn't work in Phase 2 leaves time to fix it.

**Delivers:** 4 MCP tools (`create_reservation`, `get_reservation_status`, `extend_wait`, `cancel_reservation`) with Zod schemas + session_token validation. Service layer (`lib/services/reservations.ts`) owning all mutations. WDK `reservationWorkflow` covering full lifecycle with `createHook + Promise.race(hook, sleep)` pattern. Staff API endpoints calling `hook.resume()` in-process. KV publish from workflow steps. **Workflow shape is frozen at the end of this phase.**

**Pitfalls addressed:** #1 (steps discipline — workflow function is a router not a worker), #2 (event race + DB-backed safety net), #3 (serializable step inputs/outputs only), #4 (freeze shape after this phase), #5 (per-tool session_token validation, never trust LLM-passed reservation_id), #7 (KV pub/sub patterns + abort cleanup), #9 (Zod `.passthrough()` not `.strict()` for LLM tool inputs), #15 (PII logging helper from day one), #16 (no fake-success — system prompt rule deferred to Phase 3 but tool error contract designed here).

**Includes the money-shot smoke test:** create 2 reservations, deploy mid-flight, verify both still progress. Don't wait until Phase 4.

### Phase 3 — User Surfaces (Chatbot + Maître Panel + DurableAgent ETA)

**Collapses scope Fases 8 + 9 + 10.**

**Rationale:** Both surfaces consume the same SSE infrastructure (`/api/events/[id]` for diner, `/api/events/queue` for staff). Building them together locks in the snapshot-replay pattern (Architecture decision 3.2) consistently. ETA agent piggybacks on the same MCP tool wiring.

**Delivers:** Chatbot embed at `/` with `useChat` + AI SDK + tool-calling against MCP. Maître panel at `/queue` with active list + history + Llamar/Marcar presentado actions. SSE on both surfaces with snapshot-replay-on-connect + heartbeat + reconnect. DurableAgent estimating ETA (capped at 4h effort — fall back to deterministic formula if running over).

**Pitfalls addressed:** #6 (SSE timeouts + heartbeat + 800s maxDuration + reconnect-then-poll), #8 (`stopWhen: stepCountIs(5)` on `streamText` to prevent infinite tool loops), #10 (cookie strategy resolved per Architecture decision 3.3 — localStorage, not cookie-during-stream), #16 (UI confirmation badge from server response, never from LLM text), #20 (build seed script HERE, use it as default test state for the rest of the build), #21 (system prompt handles Spanish edge inputs — "somos 4 o 5", "para mañana", etc.).

### Phase 4 — Pilot-Hardening + Demo

**Collapses scope Fases 11 + 12.**

**Rationale:** Hardening (rate limiting, idempotency, monitoring, PII audit) and demo prep are both "pre-launch" disciplines. Combining them ensures the smoke-test scripts double as demo-rehearsal scripts.

**Delivers:** Rate limit (5 req/min per IP) on `create_reservation`. Idempotency dedup key in KV. PII redaction in all `console.log`. Health check endpoint + Slack/Discord webhook on workflow failure. Smoke test bash script. Final `vercel --prod`. Seed-demo script for the recording. `DEMO.md` with 6-scenario shot list. Rough-cut recording → real recording. README + GitHub repo polish.

**Pitfalls addressed:** #14 (rehearse Edge Config propagation timing — change value, wait 15s, then trigger), #15 (PII audit before going live), #17 (record in clips, pre-script prompts, temperature 0.2, 3 dry-runs per scenario), #18 (smoke test catches missing env vars), #22 (minimum viable monitoring before pilot diners arrive).

### Phase Ordering Rationale

- **Why Phase 1 collapses 5 micro-phases:** they are all "Vercel infra" with no business logic; doing them as separate GSD phases (each with discuss/plan/build) wastes overhead. The Edge Config pull-forward is the only reordering vs. scope.
- **Why Phase 2 is the critical path:** MCP + WDK + service layer are interdependent and represent the entire "backend" of the system. Collapsing them avoids inventing fake interfaces between fases that would have to be ripped out.
- **Why Phase 3 includes ETA agent:** scope's Fase 10 is half-day work and depends on the same MCP tooling; spinning up a separate phase for it isn't worth the overhead. If time slips, ETA agent is the first cut within Phase 3.
- **Why Phase 4 includes demo prep:** demo prep IS hardening. The scenarios in the video are the smoke tests. Building the seed-demo script in Phase 3 (per pitfall #20) lets Phase 4 focus on rehearsal and polish.

### Research Flags

Phases needing deeper `/gsd-research-phase` during planning:
- **Phase 2 (Backend Core):** the WDK `createHook` + `Promise.race` + `using` keyword pattern needs verification on the exact `workflow` SDK version installed; the `using` syntax may not compile on the exact Node version Vercel ships. Plan a 30-min spike at the start of Phase 2 to verify the snippet from STACK.md actually compiles + executes the pattern correctly. Also: verify whether `waitForEvent`-equivalent buffers events or drops them (informs the DB-backed safety net depth).
- **Phase 3 (User Surfaces):** the AI SDK v6 `useChat` + `DefaultChatTransport` + `sendMessage({text})` shape is current per docs but the LLM tool-calling lifecycle changed in v5→v6; spike-test 10 sample conversations in `/gsd-discuss-phase` before committing schema shapes.

Phases with standard, well-documented patterns (skip extra research):
- **Phase 1 (Foundation):** all standard Next.js + Vercel + Auth.js + Postgres patterns; STACK.md has working snippets for everything.
- **Phase 4 (Demo prep):** mostly process discipline + bash scripting, not novel tech.

---

## 6. Top 5 Pitfalls to Plan Against (Demo-Killers / Pilot-Killers)

1. **Cookie set during streaming silently fails (Pitfall #10)** — the scope's described pattern is broken. Demo scenario #2 (vuelta con cookie) won't work in production. **Mitigation: cut the cookie now, use localStorage** (already in scope cut list — promote it from "deferred" to "validated cut" in PROJECT.md).
2. **WDK event race + non-serializable step results (Pitfalls #1, #2, #3, #4)** — the four sister pitfalls that all break the money shot. Together they say: workflow function is a router, every step input/output is plain JSON, persist trigger in DB before publishing event, freeze step shape after Phase 2. Bake all four into `lib/workflows/_README.md` before writing any step code.
3. **MCP tool poisoning — diner manipulates someone else's reservation (Pitfall #5)** — public MCP + LLM as confused deputy. **Don't put `reservation_id` in the LLM-visible tool input schema**; resolve server-side from session_token only. This is a pilot-killer if missed (real diners, real PII, real legal exposure).
4. **Resend magic-link in spam → maître locked out (Pitfall #11)** — pilot dies on day 1. **Phase 0 blocker.** Verify domain BEFORE Phase 1 starts auth work.
5. **SSE killed by serverless timeout, push event lost on reconnect (Pitfall #6)** — every diner session > 5 min hits this. Architecture decision 3.2 (snapshot-replay-on-connect) is the fix; it's mandatory, not optional. Combine with `maxDuration: 800` + heartbeat every 25s + `Last-Event-ID`.

---

## 7. Open Questions for Planning (resolve in /gsd-discuss-phase or /gsd-plan-phase)

1. **`using` keyword for hook auto-disposal** (Phase 2): does TS 5.2+ explicit resource management compile + run on Vercel's Node 20 runtime with the WDK compiler? If not, fall back to manual `try/finally` with `hook.dispose()`.
2. **WDK `waitForEvent` buffering semantics** (Phase 2): does the SDK buffer events fired before subscribe? If yes, the DB-backed safety net is belt-and-suspenders. If no, it's mandatory. Spike test before committing the workflow shape.
3. **Skip the MCP-over-HTTP roundtrip from `/api/chat`?** (Phase 3): scope says chat handler calls MCP via `experimental_createMCPClient`. ARCHITECTURE.md recommends calling services directly from the chat handler — the MCP server stays for *future* clients (WhatsApp). Decision affects Phase 3 wiring.
4. **DurableAgent ETA quality vs. deterministic formula** (Phase 3): the agent costs LLM calls; the formula is free. Cap agent effort at 4h; if it doesn't produce visibly-better ETAs in dry-run, ship the formula and wrap it in `@workflow/ai/agent` to keep the Track 2 framing.
5. **Pro vs Hobby plan for the pilot** (Phase 4): Hobby caps SSE at 300s; Pro extends to 800s with Fluid Compute. For a pilot with multi-hour wait sessions, Hobby reconnect frequency may annoy. Decide before final deploy.
6. **Maître affordance to undo `no_show`** (Phase 3 stretch): real diners arrive late; the maître needs a way to unmark. Not in scope; FEATURES.md recommends adding. Decide if it ships in Phase 3 or as a known gap fixed in pilot week 1.
7. **Two pg clients (Pool for Auth, serverless for app)** (Phase 1): two clients pointing at same Neon DB. Confirmed compatible per STACK.md but worth a spike-test in Phase 1 to make sure they don't fight under load.

---

## 8. Cut List Reaffirmed (research suggests deprioritize)

In order of "cut first if time runs short":

1. **Cookie 24h diner persistence** — promote from "deferred" to "validated cut now". Use localStorage. Architecture decision 3.3 makes this the cleanest path. (Was scope cut-list #1; research confirms.)
2. **DurableAgent ETA quality** — cap at 4h; fall back to weighted-average formula; still wrap in `@workflow/ai/agent` for the Track 2 narrative. (Per FEATURES.md and ARCHITECTURE.md "what to defer".)
3. **`/queue/history` as a separate page** — show closed reservations inline in `/queue` with a filter toggle. (Per ARCHITECTURE.md cut list.)
4. **Edge Config "live update during demo" video scenario** — keep the infra (it's used by the workflow), drop scenario #5 from the video if rehearsal is sloppy. Keep scenarios 1, 2, 3, 4, 6.
5. **Maître undo-no-show affordance** — add only if Phase 3 has slack; otherwise document as known gap, fix in pilot week 1.
6. **Color-coded cards by party size** — basic styling is fine; Edge Config-driven palette is bonus.

**Do NOT cut:** chatbot, MCP server with 4 tools, workflow durability, SSE for diner push, no-show automation, staff Llamar/Marcar presentado, Resend magic-link auth, public deploy URL, demo video. These are the demo + the pilot.

---

## 9. Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All package names, versions, env vars verified against current official Vercel/Neon/Upstash/Auth.js docs as of 2026-04-25. Working code snippets included for every integration point. One MEDIUM: TypeScript `using` keyword on Vercel's Node runtime — needs Phase 2 spike. |
| Features | HIGH (table stakes) / MEDIUM (chatbot UX) | Table stakes verified across 5+ commercial competitors. Chatbot UX risks extrapolated from booking-bot literature; the conversational-entry differentiator is the highest-variance bet in the project. |
| Architecture | HIGH | All patterns verified against official docs. The 5 architecture decisions (service layer, snapshot-replay, cookie strategy, freeze-shape, in-process hooks) close the gaps the scope leaves open. |
| Pitfalls | HIGH | 22 pitfalls with first-hand source citations (GitHub issues, Vercel changelogs, security research). Phase-mapped so nothing falls through. |

**Overall confidence: HIGH.** The known unknowns are scoped to specific Phase 2 spikes (`using` keyword, event buffering) and the Phase 3 LLM behavior verification. None block roadmap creation; all are solvable in the planning step of their respective phases.

### Gaps to Address During Planning

- **WDK `using` keyword compatibility** — Phase 2 plan must include 30-min spike at the top.
- **`waitForEvent`-equivalent buffering semantics** — Phase 2 plan must verify before committing safety net depth.
- **Two `pg` clients on Neon at concurrent load** — Phase 1 plan should include a small load test (10 parallel auth checks + 10 parallel reservation reads).
- **AI SDK v6 tool-calling lifecycle in chatbot context** — Phase 3 plan should include 10-conversation spike with Claude before locking schemas.
- **Resend domain DNS propagation timing** — Phase 0 blocker, not a planning concern, but the project plan should include a "Phase 1 auth subtask cannot start until Resend shows verified" gate.

---

## Sources

### Primary (HIGH confidence — official Vercel/vendor docs)
- Vercel Workflows, Workflow SDK, Hooks foundations
- Vercel MCP deploy, github.com/vercel/mcp-handler
- AI SDK chatbot, Claude Sonnet 4.6 changelog
- Postgres on Vercel — deprecation banner, Redis on Vercel — deprecation banner
- Auth.js v5 migration, PG adapter, Resend provider
- Vercel function limits, Skew protection
- Next.js 16 release blog

### Primary (HIGH confidence — first-hand bug reports + security research)
- vercel/workflow #1315 step processing, #943 step hang
- vercel-labs/agent-browser #561 — waitForEvent race
- vercel/ai #7502 stopWhen + useChat, #9384 infinite tool loop, #13355 Anthropic schema sanitization
- OWASP MCP Tool Poisoning, Simon Willison MCP prompt injection
- Redis pub/sub at-most-once delivery

### Secondary (MEDIUM confidence — competitor analysis + community)
- Yelp Guest Manager, OpenTable, SevenRooms, Toast Tables, Waitlist Me, TablesReady, Simple Host, NextMe, BentoBox feature pages (full URLs in FEATURES.md)
- Restaurant booking-bot UX literature, LLM hallucination case studies
- Upstash docs + DeepWiki pubsub internals, Neon serverless driver docs

### Tertiary (LOW confidence — verify in Phase 1/2 spikes)
- `npx workflow@latest` CLI scaffolder (referenced in scope; only `npm i workflow` confirmed in docs)
- TypeScript `using` keyword on Vercel's Node runtime (TS 5.2+ + Node 20+ should work but unverified on production WDK build)

---

*Detailed research lives in: STACK.md, FEATURES.md, ARCHITECTURE.md, PITFALLS.md*
*Research completed: 2026-04-25*
*Ready for roadmap: yes*
