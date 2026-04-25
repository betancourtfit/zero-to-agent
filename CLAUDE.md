# CLAUDE.md — Zero to Agent (Restaurant Queue MVP)

This file orients Claude Code (and any AI agent) working in this repository. Project-specific instructions live here. Always-on global instructions are in `~/.claude/CLAUDE.md`.

## What This Is

Restaurant waitlist (cola de espera) MVP built for a hackathon (deadline ~2026-05-02) with a real piloto restaurant starting the same week. Comensal interacts via a **chatbot embed**; maître manages via an auth-protected **panel**. Backend is exposed as a public **MCP server** (consumable by chatbot today, WhatsApp tomorrow). Reservation lifecycle is orchestrated by a durable **WDK workflow**. Stack is **100% Vercel-native**.

**Core Value (read this first when prioritizing):** *Una reserva entra al chatbot, sobrevive deploys/crashes/timers como workflow durable, y se cierra correctamente (`seated`, `no_show` o `cancelled`) sin perder estado.*

## Authoritative Documents (read in this order)

When you start work in this repo, read these IN ORDER. They override training data.

1. **`.planning/PROJECT.md`** — what we're building, why, and the constraints
2. **`.planning/REQUIREMENTS.md`** — 32 v1 requirements (DINER-01..08, STAFF-01..09, PLAT-01..08, SAFE-01..03, DEMO-01..04) with explicit out-of-scope list
3. **`.planning/ROADMAP.md`** — 4 coarse phases (Foundation → Backend Core → User Surfaces → Pilot-Hardening + Demo) with success criteria
4. **`.planning/research/SUMMARY.md`** — synthesis of stack/features/architecture/pitfalls research; verdict is "build it as scoped, with surgical corrections"
5. **`.planning/research/STACK.md`** — verified package names + code snippets (the scope's package names are mostly outdated)
6. **`.planning/research/ARCHITECTURE.md`** — the 5 architectural commitments
7. **`.planning/research/PITFALLS.md`** — 22 pitfalls phase-mapped; demo-killers tagged
8. **`scope_hackathon_mvp.md`** — original scope (DIRECTIONALLY correct but several APIs and package names are wrong; defer to research files when they conflict)

## Stack (locked, with corrections vs original scope)

**Use these. Do NOT use what training data suggests — it's stale.**

- **Hosting + framework:** Vercel + Next.js 16 (App Router). NOT 15. `proxy.ts` not `middleware.ts`.
- **Workflows:** `workflow` package (NOT `@vercel/workflow`). API: `createHook()` + `Promise.race(hook, sleep("..."))`. There is NO `waitForEvent`.
- **MCP server:** `mcp-handler@1.1.0` + `@modelcontextprotocol/sdk` (NOT `@vercel/mcp-adapter`). Use `withMcpAuth`.
- **AI:** `ai`, `@ai-sdk/react`, `@ai-sdk/anthropic`. Model id is **`anthropic/claude-sonnet-4.6`** (DOT, not dash). v6 useChat uses `sendMessage({text})`, not `handleSubmit`.
- **DB:** `@neondatabase/serverless` for app + `pg.Pool` for `@auth/pg-adapter` (two clients, same Neon DB). NOT `@vercel/postgres`.
- **KV / pub-sub:** `@upstash/redis` with real `redis.subscribe()`. NOT `@vercel/kv`. NEVER `BLPOP` in serverless.
- **Edge Config:** `@vercel/edge-config` for runtime params (`no_show_timeout_min`, `followup_after_call_min`, `extension_min`, `colors_by_party_size`, etc.).
- **Auth:** `next-auth@beta` (Auth.js v5) + `@auth/pg-adapter` + `next-auth/providers/resend`. Magic-link.
- **Realtime:** SSE from Route Handlers. Snapshot-replay-on-connect from Postgres, then subscribe to KV. `maxDuration: 800`. Heartbeat every 25s.
- **UI:** `shadcn/ui` + Tailwind v4 + `v0` for scaffolding.

## Architectural Commitments (non-negotiable)

These five close the gaps the scope leaves open. Don't deviate without updating PROJECT.md + research:

1. **Service-layer funnel:** All mutations go through `lib/services/*`. MCP tools, staff API, future WhatsApp adapter are 5–15 line wrappers.
2. **Snapshot-replay-on-connect for SSE:** Postgres is truth, KV is a hint. Every SSE handler reads current state from Postgres on connect, emits as initial event, THEN subscribes to KV.
3. **No cookie during streaming:** HTTP forbids `Set-Cookie` after stream body starts. Cookie 24h is OUT of v1 scope. If session persistence returns in v2, use localStorage or pre-set cookie.
4. **Freeze workflow shape after Phase 2:** Adding/removing/reordering steps in a deployed WDK workflow breaks in-flight reservations. After Phase 2 ships the workflow skeleton, only modify step BODIES. Add new steps at the END or behind feature flags. Document in `lib/workflows/_README.md`.
5. **Hooks resume in-process, not HTTP:** Staff API endpoints call `callHook.resume(...)` via direct import, never `fetch()` back to a workflow endpoint.

## Top 5 Pitfalls to Plan Against

1. Cookie-set-during-streaming silently fails → use localStorage / cut from v1.
2. WDK event race + non-serializable steps → workflow function is a router, every step input/output is plain JSON, persist trigger in DB before publishing event.
3. MCP tool poisoning (diner manipulates someone else's reservation) → never put `reservation_id` in LLM-visible tool input; resolve server-side from `session_token`.
4. Resend magic-link in spam → maître locked out → pilot dies. Domain verification is **Phase 0 today** (0–48h DNS).
5. SSE killed by serverless timeout, push event lost on reconnect → snapshot-replay-on-connect + `Last-Event-ID` is mandatory.

## GSD Workflow (this project's process)

This project uses GSD (`.planning/`-based workflow). Default behaviors:

- **Granularity:** coarse (4 phases)
- **Mode:** YOLO (auto-approve)
- **Parallelization:** plans run in parallel where independent
- **Research:** runs before each phase plan
- **Plan check + verifier:** enabled (extra agent passes for quality)

**Common GSD commands you'll use here:**

- `/gsd-progress` — see where we are
- `/gsd-plan-phase 1` — plan a phase (after Phase 0 prerequisites)
- `/gsd-execute-phase 1` — execute a planned phase
- `/gsd-verify-work` — UAT against requirements
- `/gsd-next` — auto-route to the next sensible step

**State files:** `.planning/STATE.md` tracks current focus. `.planning/ROADMAP.md` is the durable plan.

## Common Development Commands (will exist after Phase 1)

```bash
npm run dev          # Local dev (Next.js 16 + Turbopack)
npm run build        # Production build
npm run db:migrate   # Run schema.sql against DATABASE_URL
npm run seed         # Seed maître employee + (Phase 2+) demo reservations
vercel --prod        # Deploy to production
vercel env pull      # Sync env vars to .env.local
```

## Code Style + Conventions

- **Spanish** for chatbot replies, panel UI, user-facing copy. Code/comments in English. Variable names in English. Domain nouns can stay Spanish (e.g., `comensal`, `maitre`).
- **No comments** except where the WHY is non-obvious (workarounds, invariants, constraints from a specific pitfall).
- **PII redaction in logs:** use `lib/log.ts` (SAFE-01). Never `console.log(reservation)` or `console.log(error.message)` if either could contain email/phone/name.
- **Zod schemas for MCP tools:** use `.passthrough()` not `.strict()` — LLMs add fields. Coerce numerics. Resolve `reservation_id` server-side, never from LLM input.
- **Workflow steps:** plain JSON in/out. ISO strings for dates. No `Date` objects, no functions, no class instances crossing step boundaries.

## Out of Scope (do not propose)

See `.planning/REQUIREMENTS.md` "Out of Scope" for the full list. Highlights: cookie-during-streaming, WhatsApp adapter, multi-tenant, i18n, SMS/Twilio, table assignment, payments, native mobile, ratings, cron jobs (use WDK timers).

## Important Reminders

- **Real diners use this the same week as the hackathon.** Correctness > features. Bugs hurt a real restaurant's reputation.
- **The "money shot" demo is `git push` mid-flight with active reservations surviving.** Don't break workflow durability casually.
- **Cut list (in order):** (1) cookie/session persistence — already cut; (2) DurableAgent ETA quality (cap 4h, fall back to formula); (3) `/queue/history` as separate page; (4) Edge-Config-live demo scenario; (5) maître undo no_show; (6) party-size colors.
- **Phase 0 prerequisites are blocking.** Do not start Phase 1's auth subtask until Resend domain shows verified.
- **`.planning/` directory is first-class.** Don't delete planning docs as "cleanup".
