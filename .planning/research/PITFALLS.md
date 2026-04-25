# Pitfalls Research — Restaurant Queue MVP (WDK + MCP + AI SDK + Auth.js + SSE on Vercel)

**Domain:** Conversational restaurant waitlist with durable workflow per reservation, MCP server backend, real pilot in 7 days
**Researched:** 2026-04-25
**Confidence:** HIGH for stack-specific gotchas with verified sources; MEDIUM for hackathon process pitfalls (experiential)
**Tags used:** [DEMO KILLER] = breaks the 90s video; [PILOT KILLER] = breaks for real diners; [ANNOYANCE] = friction but recoverable; [MINOR] = polish

---

## Critical Pitfalls

### Pitfall 1: Side effects outside `"use step"` blocks (re-execute on replay) [DEMO KILLER]

**What goes wrong:**
WDK replays your workflow function from the top every time it resumes. Any code that lives in the workflow body but NOT inside a `"use step"` function will re-execute on every resume. Examples that break: `Math.random()`, `Date.now()`, `crypto.randomUUID()`, `await fetch()`, `await db.insert()`, `console.log()` for audit. `session_token = crypto.randomUUID()` outside a step gives a different token every replay → cookie mismatch → diner returns and the chatbot doesn't recognize them.

**Why it happens:**
The mental model "this is just an async function" is wrong — it's a deterministic transcript replay. Steps are checkpoints; everything else is replayed code. The compiler tries to flag this but cannot catch all dynamic call sites. (See [Vercel Workflow blog post on the programming model](https://vercel.com/blog/a-new-programming-model-for-durable-execution).)

**How to avoid:**
- Rule: **the workflow function is a router, not a worker.** Anything that touches IO, time, randomness, or external services lives in a `"use step"` function.
- Concrete rule for THIS project: every DB write (`reservations`, `reservation_events`), every KV publish, every Edge Config read, every UUID generation goes inside a step.
- Code review checklist before merging Phase 6: grep the workflow file for `Math.random|crypto.|Date.now|fetch|db.|kv.|publish` outside step boundaries.

**Warning signs:**
- Same reservation appears twice in `reservation_events` with different timestamps
- `session_token` in cookie doesn't match DB after a deploy
- ETA value flickers between values without a recompute trigger
- Audit log has `'created'` rows with the same `reservation_id` but different created_at

**Phase to address:** Phase 6 (WDK workflows) — establish the discipline at first step. Add a `lib/workflows/_README.md` with the "function-is-a-router" rule before writing any step.

---

### Pitfall 2: `waitForEvent` race — event published before subscriber is ready [DEMO KILLER, PILOT KILLER]

**What goes wrong:**
The classic timing bug. The maître clicks "Llamar" → API publishes the `call` event → workflow has not yet reached its `waitForEvent(['call', 'cancel', ...])` line. Event is dropped. Workflow waits 30s for the timeout, recomputes ETA, loops back, never sees the call. Diner never gets "MESA LISTA". Maître sees "Llamado" but nothing happens. (See [Cloudflare Workers SDK issue #11740](https://github.com/cloudflare/workers-sdk/issues/11740) for the same pattern in a sister product, and [Vercel agent-browser issue #561](https://github.com/vercel-labs/agent-browser/issues/561) for the lazy-listener race in a Vercel-shipped product.)

**Why it happens:**
1. WDK's event delivery semantics are **subscriber-driven**: an event published while no `waitForEvent` is parked is lost (unless the SDK explicitly buffers — verify in Phase 6).
2. The workflow can be in a step doing slow work (e.g. ETA recompute calling the LLM) when the event fires.
3. Local dev vs prod timing differs — passes locally, fails in prod under real load.

**How to avoid:**
- **Persist the trigger in DB before publishing the event.** API handler does: `INSERT INTO reservation_events(event_type='call_requested') ... ; THEN publish('call')`. The workflow's `waitForEvent` timeout branch should also `SELECT FROM reservation_events WHERE created_at > last_check AND event_type IN (...)` as a safety net. If the event was missed, the DB row catches it on the next loop.
- **Test the race explicitly:** in a script, fire the event 10ms before the workflow reaches `waitForEvent`. If WDK doesn't buffer, build the DB-backed safety net.
- **Verify WDK's exact semantics first** — the [event-sourced architecture changelog](https://vercel.com/changelog/workflow-event-sourcing) hints buffering may exist in 4.1+; verify the version installed by `npx workflow@latest` and read its docs for `waitForEvent` buffering behavior.

**Warning signs:**
- Maître clicks "Llamar", sees status flip to `called` in DB, but diner never gets push
- During demo rehearsal, sometimes the call works, sometimes the timer fires first
- `reservation_events` has a `call` row but workflow log shows the next event was a timeout

**Phase to address:** Phase 6 (workflows) — design the DB-backed safety net into the API handlers and the workflow loop from day one. Don't try to "add it later when we have time."

---

### Pitfall 3: Non-serializable step inputs/outputs (workflow crashes on resume) [DEMO KILLER]

**What goes wrong:**
A step returns a `Date` object, a `Map`, a class instance, a `Buffer`, an LLM streaming response, or a connection handle. WDK serializes step results to durable storage. On resume, deserialization gives you a plain object — `date.toISOString()` is now `undefined`. Workflow throws on the next step that uses it.

**Why it happens:**
TypeScript types make non-serializable objects look identical to plain objects. The compile-time check is happy; the runtime breaks. Especially likely with `pg` query results (sometimes return `Date`s for timestamps) or AI SDK responses.

**How to avoid:**
- Step inputs/outputs are **plain JSON only.** Strings, numbers, booleans, arrays, plain objects. No Date, no Buffer, no class instances, no functions.
- Convert at the step boundary: `return { created_at: row.created_at.toISOString() }` not `return row`.
- For DB rows: explicitly project the columns you need in the step, don't return the whole row.
- Add a unit test that JSON.stringify+parse round-trips the step output and matches the input.

**Warning signs:**
- Workflow runs fine in one shot but breaks after a deploy mid-execution
- Errors like "x.toISOString is not a function" or "Cannot read properties of undefined (reading 'getTime')" after a resume
- `JSON.stringify` returns `{}` for a step return value

**Phase to address:** Phase 6, alongside Pitfall 1. Same code review pass.

---

### Pitfall 4: Adding a step to a deployed workflow breaks in-flight reservations [PILOT KILLER]

**What goes wrong:**
Reservation #42 is in the middle of `reservationWorkflow`, suspended at step 5. You ship a deploy that inserts a new step between steps 3 and 4. On resume, WDK replays from the transcript — but the transcript records step 4 as "the old step 4," and the new code expects step 4 to be the inserted step. Replay diverges. Workflow either crashes or executes wrong logic.

**Why it happens:**
Durable workflows are deterministic replays of a transcript. Re-ordering or inserting steps changes the replay alignment. Vercel has skew protection ([source](https://vercel.com/docs/workflows)) — old in-flight workflows continue on the old version's code — but this protection is not magic and depends on deployment isolation working correctly. There's an [open issue (#89)](https://github.com/vercel-labs/workflow-builder-template/issues/89) on the workflow-builder-template explicitly asking for breaking-change handling. Skew protection ALSO requires the OLD function code to still be reachable, which means: if the old build is purged or the deployment is removed, in-flight workflows die.

**Why it bites THIS project hard:**
The "money shot" of the demo is `git push` mid-call and watching tickets survive. If you push a code change that touches the workflow file structure (not just step bodies), the in-flight tickets break and the money shot blows up on camera.

**How to avoid:**
- **Freeze the workflow shape early.** Get the step skeleton right in Phase 6 and don't add/reorder steps after Phase 7.
- For mid-hackathon changes: only modify step **bodies**, not their **count or order**. Add new steps at the END of the function or behind a feature flag controlled by Edge Config.
- Before recording the demo: deploy the FINAL version of the workflow, then start fresh reservations, THEN do the money-shot deploy. Don't money-shot a deploy that changes the workflow shape.
- Verify Vercel's skew protection is enabled for the project in dashboard settings.
- Document in `lib/workflows/_README.md`: "Adding/removing/reordering steps is a breaking change. Bumping the workflow file count = new workflow version = ALL existing in-flight reservations must complete or be cancelled before deploy."

**Warning signs:**
- After deploy, workflow logs show "step mismatch" or "transcript divergence" errors
- In-flight reservations stuck and never progress after a deploy
- A code change that looks innocent (like splitting a block into a helper) breaks something

**Phase to address:** Phase 6 to establish the structural skeleton; Phase 11 (hardening) to add the deploy-discipline note to README and to verify skew protection in dashboard.

---

### Pitfall 5: MCP tool-poisoning via diner input — diner manipulates someone else's reservation [PILOT KILLER]

**What goes wrong:**
The `extend_wait` tool takes `{ reservation_id }`. If validation only checks "reservation_id exists in DB" and not "session_token in cookie matches the one stored for this reservation_id," any diner can extend, cancel, or read any other diner's reservation by guessing UUIDs (or by sending the LLM "extend reservation 12345"). Even worse: the LLM, having tools that act on a `reservation_id` it sees in conversation, may pick up an ID that appears in the diner's chat input ("my friend's reservation is XYZ — can you cancel hers?") and call the tool. ([MCP tool poisoning is a documented attack class](https://owasp.org/www-community/attacks/MCP_Tool_Poisoning); [Simon Willison's overview](https://simonwillison.net/2025/Apr/9/mcp-prompt-injection/) covers the LLM-as-confused-deputy angle.)

**Why it happens:**
1. Scope §5 explicitly notes "validate session_token" but it's easy to skip in the rush to get tools working.
2. LLM passes whatever string it receives — it has no concept of "this id belongs to this user."
3. UUIDs feel random but a malicious user can scrape multiple reservations from a public MCP and start guessing.
4. The MCP is **publicly accessible by spec** (Track 2 requires it).

**How to avoid:**
- Every tool that acts on a `reservation_id` MUST receive the `session_token` as a separate parameter (NOT something the LLM can fabricate from chat) and the server validates `(reservation_id, session_token)` matches in DB.
- **Don't put `reservation_id` in the LLM's tool input schema for `extend_wait` / `cancel_reservation` / `get_reservation_status`.** Resolve the reservation server-side from the session_token only. The LLM passes nothing reservation-identifying — the server reads the cookie/header.
- The `X-MCP-API-Key` header (mentioned in scope §12) gates MCP access to known callers (your own chatbot frontend). Generate it in Phase 2, store in env, validate in MCP route handler.
- For `create_reservation`: rate-limit by IP (5/min via KV — already in scope §11).

**Warning signs:**
- During testing, manually send a tool call with a random UUID — it must be rejected
- Logs show `extend_wait` calls without a corresponding session_token validation success
- Demo shows a single browser cancelling 2 different reservations in quick succession (they shouldn't be able to)

**Phase to address:** Phase 5 (MCP server) — bake into tool signatures from the first commit. Don't ship Phase 5 without `(reservation_id, session_token)` joint validation tested.

---

### Pitfall 6: SSE stream killed by serverless function timeout mid-call [DEMO KILLER]

**What goes wrong:**
Diner is connected to `/api/events/[reservation_id]`. Vercel function timeout (60s on Pro, up to 5 min if `maxDuration` configured, or 800s on Fluid) kills the stream after N seconds. The browser EventSource auto-reconnects but **misses any events that fired during the gap**. Maître clicks "Llamar" exactly during the reconnect window — diner never sees "MESA LISTA". ([Vercel KB on function timeouts](https://vercel.com/kb/guide/what-can-i-do-about-vercel-serverless-functions-timing-out); [Vercel docs on maxDuration](https://vercel.com/docs/functions/configuring-functions/duration).)

**Why it happens:**
1. Serverless functions have hard timeouts. SSE wants to live forever.
2. EventSource reconnects but doesn't know what it missed.
3. Pub/sub via Upstash is fire-and-forget — events not delivered while no subscriber is attached are lost.

**How to avoid:**
- **Set `export const maxDuration = 800` in the SSE route** (or whatever Fluid maxes at on your plan; verify in dashboard). Set explicit `export const dynamic = 'force-dynamic'` and `export const runtime = 'nodejs'`.
- **Send a heartbeat every 15s** (`: keep-alive\n\n`) to prevent intermediate proxies from idle-timing-out. ([Source](https://nextjslaunchpad.com/article/nextjs-server-sent-events-real-time-notifications-progress-tracking-live-dashboards).)
- **Set `'X-Accel-Buffering': 'no'`** header to prevent proxy buffering. Without this, the first chunks may not flush. ([Source](https://medium.com/@oyetoketoby80/fixing-slow-sse-server-sent-events-streaming-in-next-js-and-vercel-99f42fbdb996).)
- **On reconnect, fetch missed state.** When EventSource reconnects, the client immediately calls `get_reservation_status` (MCP tool) to get current state. If status is `called` and the diner hadn't seen the push, the chatbot displays "MESA LISTA" anyway from the polled state. Belt-and-suspenders: pub/sub for instant + polled state for catch-up.
- **Use Last-Event-ID header** for resumability if you implement event IDs. (Optional polish for Phase 11.)

**Warning signs:**
- Stream dies at exactly 60s in dev (default hobby timeout)
- Browser network tab shows `eventsource` connection closed after N minutes
- Test scenario "open chatbot, leave for 5 min, then maître calls" — does the diner see the push?

**Phase to address:** Phase 8 (chatbot frontend) — implement reconnect-then-poll from day one. Phase 9 (panel) — same pattern for the maître panel. Phase 7 — set `maxDuration` in the route handler.

---

### Pitfall 7: Vercel KV pub/sub subscriber-attach race + stateless functions can't hold global subscriber map [DEMO KILLER]

**What goes wrong:**
Two related issues:
1. **Subscribe-after-publish:** SSE handler attaches `kv.subscribe('reservation:42')` AFTER the workflow already published the `called` event in the same millisecond. Event lost.
2. **Stateless functions:** You can't keep a `Map<reservationId, Set<Subscriber>>` in module scope and expect it to persist — each cold-start function is a fresh process. ([Source](https://nextjslaunchpad.com/article/nextjs-server-sent-events-real-time-notifications-progress-tracking-live-dashboards).)
3. **Connection limits:** Upstash Redis has connection limits (free tier: ~30 concurrent). Each SSE connection holding a long-lived `subscribe()` consumes one. 20 diners + 1 maître + headroom = tight on free tier.

**Why it happens:**
- Pub/sub semantics: subscribe must precede publish. There's no buffer for "subscribe to channel and replay last N events."
- Each function invocation is independent.
- SSE connections naturally accumulate.

**How to avoid:**
- **Use the DB-backed safety net (Pitfall 2):** any time the SSE handler subscribes, immediately also poll `reservation_events` for events created since the page-open timestamp. If the diner missed the publish, the polled events catch it up.
- **Alternative pattern: List + BLPOP** (mentioned in scope §12). The workflow LPUSHes events to `reservation:42:queue`. The SSE handler does BLPOP in a loop. Events queue up if no subscriber is attached. Trade-off: only one subscriber consumes each event (not pub/sub fan-out), so for the maître panel you'd need a different pattern. For a single-diner-per-reservation channel, this is simpler than pub/sub.
- **Watch Upstash dashboard for connection count** during testing. Add `await redis.unsubscribe()` in the abort handler of the ReadableStream. **Test that it actually fires** by closing the browser and watching connection count drop in Upstash dashboard.
- **Cap concurrent SSE connections per IP** — primitive: KV counter `sse:ip:1.2.3.4`, increment on connect, decrement on disconnect, reject if > 5.

**Warning signs:**
- Upstash dashboard shows climbing connection count even when no users are active
- "Cannot publish, channel limit exceeded" errors
- Diner closes tab, reopens, doesn't get events anymore (orphan subscription holding the slot)

**Phase to address:** Phase 6 (publish from workflow), Phase 7 (Edge Config helpers can be in same phase as KV pattern decision), Phase 8/9 (subscribe in SSE handlers). Decide pub/sub vs LPUSH/BLPOP at start of Phase 6.

---

### Pitfall 8: Tool-calling infinite loop or `maxSteps` exhaustion [DEMO KILLER]

**What goes wrong:**
The chatbot LLM calls a tool, gets an error ("not_in_called_state"), tries again, fails again, recurses. With `useChat` v5, there's a known issue where `stopWhen` in `streamText` doesn't always halt `useChat`'s client-side resend loop ([vercel/ai issue #7502](https://github.com/vercel/ai/issues/7502)) and an [infinite recursive loop on tool errors](https://github.com/vercel/ai/issues/9384). The chatbot makes 20+ LLM calls in 10 seconds, eats AI Gateway budget, and the user sees a frozen chat.

**Why it happens:**
1. AI SDK v5 changed the message format (UIMessage vs ModelMessage) and tool call lifecycle. Migration is non-trivial. ([Migration guide](https://ai-sdk.dev/docs/migration-guides/migration-guide-5-0).)
2. Tool errors aren't always surfaced as terminal — the LLM "thinks it should try again."
3. Default `stepCountIs(20)` is the only safety net.

**How to avoid:**
- **Pin AI SDK version explicitly** in package.json — `ai@^5.0.0` is fine but lock the major. Read the [v5 migration guide](https://ai-sdk.dev/docs/migration-guides/migration-guide-5-0) before writing the chatbot code.
- **Set explicit `stopWhen: stepCountIs(5)`** on `streamText` for the chatbot — 5 tool calls is enough for the longest legitimate flow (greet → ask → ask → call create_reservation → confirm). More than 5 = something is looping.
- **Make tool errors terminal:** when a tool returns an error like `not_in_called_state`, the system prompt instructs "if a tool returns an error, explain the error to the user in plain language and STOP. Do not retry."
- **Add a server-side guard:** in the chat route handler, if total tool calls in a single request > 5, return an error. Don't trust the LLM to self-limit.
- **Telemetry:** log every tool call with `request_id` so you can see in Vercel logs if a single user triggered N calls.

**Warning signs:**
- AI Gateway usage spike disproportionate to active users
- Chat UI shows the "thinking" indicator for >10 seconds without output
- Vercel logs show 10+ entries with the same `chatId` in 5 seconds

**Phase to address:** Phase 8 (chatbot frontend) — set `stopWhen` from first commit. Phase 11 — add the server-side guard.

---

### Pitfall 9: Zod strict schema rejecting LLM tool inputs [DEMO KILLER]

**What goes wrong:**
LLM calls `create_reservation` with `{ name: "Juana", email: "j@x.com", phone: "+34123", party_size: 4, notes: "celiacas" }`. Your Zod schema is `z.object({ name, email, phone, party_size }).strict()`. Strict mode rejects extra keys → tool errors → LLM tries again with the same payload → loops (Pitfall 8). User sees nothing happen. ([Source on LLM Zod validation issues](https://community.vercel.com/t/how-to-pass-zod-validation-errors-from-tool-calls-back-to-llm/24610); [v5 issue with Anthropic JSON schema sanitization](https://github.com/vercel/ai/issues/13355).)

**Why it happens:**
- LLMs hallucinate extra fields, especially when the tool description hints at concepts not in the schema.
- Anthropic's API doesn't support all Zod features (e.g., `.default()`, `.refine()` may not survive the round-trip to claude-sonnet-4-6).
- Strict mode is the responsible default but bites in LLM contexts.

**How to avoid:**
- Use `.passthrough()` or omit `.strict()` on tool input schemas. Validate the **required** fields strictly; ignore extras silently.
- For each field: be liberal in what you accept. `party_size` should accept `z.coerce.number().int().min(1).max(20)` so the LLM can pass `"4"` as a string.
- Use `safeParse` (not `parse`) — return a structured error to the LLM that explains what was wrong, so the next call fixes it. Format: `{ error: "INVALID_INPUT", details: "party_size must be a number between 1 and 20", retry_with: { ... } }`.
- Test the schemas against real LLM outputs early in Phase 5: write a script that runs Claude through 10 sample conversations and logs every tool call payload. Adjust schemas to accept what Claude actually emits.

**Warning signs:**
- Tool calls fail with `ZodError` in logs but the LLM keeps trying
- LLM "succeeds" the conversation but no row appears in `reservations`
- The chatbot says "I've registered you" but DB is empty (LLM hallucinated success after silent tool failure)

**Phase to address:** Phase 5 (MCP server) — schemas from day one. Test with real LLM in Phase 8.

---

### Pitfall 10: Streaming response can't set cookies after first byte [DEMO KILLER]

**What goes wrong:**
The chatbot calls `create_reservation` mid-stream. The MCP returns `{ reservation_id, session_token }`. You try to set the `reservation_session` cookie via `Set-Cookie` header — but the streaming response already started flushing tokens to the client. Headers are locked after the first byte. Cookie never sets. Diner returns next time, no cookie, no recognition. Money-shot demo scenario #2 (vuelta con cookie) breaks.

**Why it happens:**
HTTP fundamentals: headers come before body. Once a single byte of body is on the wire, you cannot add or modify headers. The AI SDK `streamText` starts streaming tokens early to feel responsive — by the time a tool call resolves mid-stream, you're already past the headers.

**How to avoid:**
- **Set the cookie on a SEPARATE request, not on the chat stream.** Pattern:
  - Tool call result includes `session_token` in the assistant's response data.
  - Client receives the streamed text, then makes a tiny POST to `/api/session` with `{ session_token }` to set the HTTPOnly cookie server-side.
  - OR: pre-set a "session candidate" cookie before the stream starts (anonymous_session_id), and on `create_reservation` server-side, link it to the reservation by writing to DB.
- **Alternative:** make `create_reservation` a non-streamed RPC (separate `/api/reservation` endpoint that the LLM calls via tool, not the chat stream itself). The chat just observes the result. This is cleaner anyway.
- Test specifically: after the chatbot says "you're registered," check in DevTools → Application → Cookies for `reservation_session`. If absent, the cookie path is broken.

**Warning signs:**
- DevTools shows no `reservation_session` cookie after a successful registration
- Reopening the page does not resume the conversation
- Demo scenario #2 (vuelta) doesn't work in production but works in dev (different cookie semantics)

**Phase to address:** Phase 5 (decide cookie-set pattern) and Phase 8 (implement on client side).

---

### Pitfall 11: Resend domain not verified — magic link emails go to spam or fail entirely [PILOT KILLER]

**What goes wrong:**
Two failure modes:
1. Using `onboarding@resend.dev` works only for the email tied to the Resend account. Other addresses (your maître's actual email) bounce. ([Source](https://authjs.dev/getting-started/providers/resend); [Resend domain verification docs](https://resend.com/blog/new-domain-verification-experience).)
2. Sending from an unverified domain: emails land in spam or get rejected outright.
3. DNS propagation for SPF/DKIM/DMARC takes 0-48 hours.

**Why it bites THIS project:**
You're a solo dev. The pilot maître needs to log in. If the magic link doesn't arrive (or lands in spam), the whole panel is dead. You also need this for the demo video — judges might try the live URL.

**How to avoid:**
- **Verify a domain on day 1 of the build (Phase 0 or Phase 4)**. Even a free `vercel.app` subdomain won't work — you need a real domain you control. If you don't have one, buy one for $10 NOW (don't wait until Phase 4).
- Add SPF + DKIM + DMARC records as Resend instructs. Verify in Resend dashboard before Phase 4 starts.
- For the pilot maître: use their actual email (whitelist). Test the magic-link flow end-to-end as soon as Phase 4 ships.
- Backup plan if domain verification stalls: use the Resend-account email as the maître's login email for the demo video, document this is "demo only," and verify domain in parallel.
- **Send a test email to a Gmail account, an Outlook account, and the maître's actual provider.** Each handles spam differently.

**Warning signs:**
- Magic link arrives in spam folder
- Magic link doesn't arrive at all (check Resend dashboard for delivery status)
- DNS records show "pending" in Resend after 30 minutes — propagation delay

**Phase to address:** Phase 0 (buy domain if needed) and Phase 4 (Auth.js setup). Do not start Phase 4 until Resend domain shows "verified."

---

### Pitfall 12: Auth.js v5 + Edge runtime middleware can't reach DB → split config required [ANNOYANCE → PILOT KILLER if missed]

**What goes wrong:**
Auth.js v5 middleware runs on the Edge runtime by default. The `@auth/pg-adapter` uses `pg` (node-postgres), which is **not Edge-compatible**. If you import the full auth config (including the adapter) into middleware, the build fails or middleware crashes at runtime. If you "fix" by switching middleware to nodejs runtime, you lose the Edge perf — but your project may not care.

**Why it happens:**
The Edge runtime is V8-isolate-based, no Node APIs, no TCP sockets. `pg` needs TCP. Auth.js v5 split the architecture into two configs precisely to handle this. ([Migration guide](https://authjs.dev/getting-started/migrating-to-v5).)

**How to avoid:**
- Follow the v5 pattern: `auth.config.ts` (Edge-safe, providers only, no adapter, no DB) imported by middleware; `auth.ts` (full config with adapter + JWT strategy) imported by route handlers and server components.
- Force JWT session strategy (not database sessions) so middleware can verify the session without DB access.
- Don't import `auth.ts` from middleware — only `auth.config.ts`.
- Test: deploy to Vercel and visit a protected route. If middleware crashes, you imported wrong file.

**Warning signs:**
- Build fails with "Module not found: 'net'" or "TCP not available in edge runtime"
- Middleware runs locally but 500s in production
- `/queue` returns 500 with no logs (edge crashes are quiet)

**Phase to address:** Phase 4 (Auth.js setup) — get the file split right from the first commit.

---

### Pitfall 13: Connection pool exhaustion via `POSTGRES_URL` vs `POSTGRES_URL_NON_POOLING` confusion [PILOT KILLER]

**What goes wrong:**
Two URLs, two purposes ([Neon docs](https://neon.com/docs/connect/choose-connection)):
- `POSTGRES_URL` (pooled via PgBouncer) — for app queries
- `POSTGRES_URL_NON_POOLING` — for migrations and long-lived connections

Misuse:
- Using NON_POOLING for app queries → fast connection exhaustion at low concurrency.
- Using POOLED for migrations → some DDL fails because PgBouncer in transaction mode can't run prepared statements / certain ALTER variants.
- Workflows that hold a transaction across multiple steps → break with pooled connection (transactions don't survive across function invocations).

**Why it happens:**
Both URLs are in `.env.local`. Devs grab the first one they see. Auth.js docs sometimes show one, sometimes the other. WDK steps may reuse pool clients across invocations and confuse PgBouncer's transaction mode.

**How to avoid:**
- **Decision matrix for THIS project:**
  - App queries (MCP tools, API routes, panel reads, Auth.js adapter): `POSTGRES_URL` (pooled).
  - WDK workflow steps (each is a separate function invocation, no cross-step transactions): `POSTGRES_URL` (pooled).
  - Migration script (`lib/db/migrate.ts`): `POSTGRES_URL_NON_POOLING`.
  - Seed script: `POSTGRES_URL_NON_POOLING` (fine, runs once).
- **Don't open transactions inside one step and try to commit in another.** Each step is its own DB call. If you need transactionality across steps, use the workflow itself for atomicity (compensating actions on failure).
- **Use Vercel Fluid:** ([Source](https://neon.com/docs/connect/choose-connection)) Fluid keeps functions warm and shares connections. Enable in vercel.json or project settings.

**Warning signs:**
- "Too many connections" or "remaining connection slots are reserved" errors during demo
- "prepared statement does not exist" errors from migrations
- Slow queries that get slower as the app runs

**Phase to address:** Phase 3 (schema/migrations — pick the right URL). Phase 6 (workflow steps — confirm pooled URL is used).

---

### Pitfall 14: Edge Config propagation > 0 → demo scenario #5 looks broken on stage [DEMO KILLER]

**What goes wrong:**
Demo scenario #5 is "change `no_show_timeout_min` from 10 to 2 in the dashboard, watch the next called ticket respect the new value." Edge Config propagation can take **up to 10 seconds** ([Vercel docs](https://vercel.com/docs/edge-config)). If you change the value and immediately call a ticket, the workflow may still see the old value. Demo flops on camera.

There's also caching: `@vercel/edge-config` SDK has an in-memory cache with background revalidation. The first read after a change in a warm function may return the cached value for several seconds.

**Why it happens:**
Eventual consistency, edge propagation, in-memory cache.

**How to avoid:**
- **Rehearse the demo scenario with a stopwatch.** Change Edge Config → wait visibly 15 seconds (or do another scenario in between) → THEN trigger the call. The pause is "showing the dashboard change took effect."
- **In the workflow code, ALWAYS read Edge Config inside a step, never cached at module load.** Module-level reads will use the value from cold-start time, which may be hours stale.
- Add a manual "force refresh" button or a small UI element that shows the currently-loaded config value next to each ticket. This makes the change visible to the audience and acts as a debugging aid.
- For the demo: change the value BEFORE starting the recording, demonstrate it's "in effect" by reading the current value; then later change it AGAIN on camera with a brief pause for propagation.

**Warning signs:**
- Demo scenario #5 inconsistently works in rehearsal
- Workflow sometimes uses old value, sometimes new

**Phase to address:** Phase 7 (Edge Config) — implement reads inside steps from day one. Phase 12 (demo prep) — rehearse the timing.

---

### Pitfall 15: PII (email, phone) in Vercel logs visible to anyone with project access [PILOT KILLER]

**What goes wrong:**
You log `console.log("Created reservation", reservation)` for debugging. The full row, including diner's name, email, and phone, ends up in Vercel function logs. Anyone with project access (you, future contributors, anyone who joins the team) can see it. This is real PII for real diners. GDPR / general privacy concerns. Pilot restaurant won't be happy if this leaks.

**Why it happens:**
- Solo dev under time pressure adds prints liberally.
- LLM logging (AI SDK request/response logs) often includes the full conversation including phone numbers and emails the diner typed.
- Vercel logs are retained for the project lifetime by default.

**How to avoid:**
- **Logging discipline from Phase 5 onward:** never log full row objects. Log the `reservation_id` only. If you need to debug fields, log `name.length`, `email.split('@')[1]` (domain only), or hash.
- Wrap a `safeLog(label, obj)` helper that strips known-PII fields (email, phone, name) and use it everywhere.
- AI SDK has telemetry options — disable verbose logging in production or scrub it.
- Add a `lib/log.ts` from day one with `redactPII(obj)` helper. Use it in every workflow step's audit logs too.
- **The `reservation_events.payload` jsonb column is also exposed via panel** — make sure the panel only renders sanitized data, not raw payload.

**Warning signs:**
- Vercel logs contain visible email addresses or phone numbers
- The audit log payload column has full diner records in JSON
- Error stack traces include user data

**Phase to address:** Phase 5 (logging helper from day one). Phase 11 (hardening — audit logs before going live).

---

### Pitfall 16: LLM hallucinates a fake confirmation without calling the tool [PILOT KILLER]

**What goes wrong:**
The chatbot conversation:
- Diner: "Somos 4, Juana, j@x.com, 555-1234"
- Chatbot: "¡Listo! Te anoté, Juana. Sos la posición 3, ETA 15 min."
- ...but the LLM never called `create_reservation`. It just made up a plausible response.

The diner walks to the restaurant. They're not in the system. Maître has no idea who they are. Reputation hit.

**Why it happens:**
LLMs are trained to be helpful. They'll fabricate success if their tool call fails silently or if the system prompt is ambiguous. Especially common when tool errors aren't surfaced clearly.

**How to avoid:**
- **System prompt rule:** "NEVER confirm a reservation to the user unless `create_reservation` returned a `reservation_id`. If you don't have a reservation_id, say 'algo falló, reintentemos' and try again."
- **Verify in the UI, not just in the LLM:** the chatbot UI should show a "Reservation confirmed: #12345" badge that renders ONLY when the server confirms. Don't trust the LLM's text alone.
- **Save the conversation transcript to DB linked to reservation_id** for audit. If a diner shows up and isn't in the system, you can search by name/phone in the audit log to see what happened.
- **Test edge cases:** kill the MCP endpoint mid-conversation (return 500 from `create_reservation`). Confirm the chatbot says "fallo" instead of fabricating success.

**Warning signs:**
- Diner reports "I registered but you don't have me" — check chat logs vs `reservations` table
- Chatbot UI says "confirmed" but no DB row exists
- Tool call logs show errors at the same time the LLM said success

**Phase to address:** Phase 8 (chatbot system prompt + UI confirmation badge). Phase 11 (test with simulated MCP failures).

---

### Pitfall 17: Demo brittleness — LLM output varies, video re-takes burn time [DEMO KILLER]

**What goes wrong:**
You record the demo, edit it, only to realize the LLM said something weird in scenario 3 ("would you like to book again instead?" instead of "great, I extended your wait"). Re-record the entire scenario. Burn 30 min. Repeat for the next weird output.

LLM outputs are non-deterministic. Even with `temperature: 0` you get variation. With chat history affecting context, the variance compounds.

**Why it happens:**
Treating LLM output as deterministic. Recording in one take.

**How to avoid:**
- **Record each scenario as a separate clip.** If clip 3 has a weird LLM output, re-record only clip 3.
- **Use ScreenStudio or similar that lets you redo segments.**
- **Pre-script the diner's exact prompts.** Don't improv. Same input → similar output.
- **Set `temperature: 0.2`** for the chatbot — slightly less variance.
- **Run each scenario 3 times before recording** to see what the LLM actually says. If it's inconsistent, beef up the system prompt with explicit examples.
- **Have a backup take of each scenario already saved.** If the live one flops, you have a fallback.

**Warning signs:**
- First demo recording attempt produces a weird LLM response
- The same prompt gives different outputs on retry

**Phase to address:** Phase 12 (demo prep) — schedule LLM scenario testing on day 6, not day 7.

---

### Pitfall 18: "It worked on my machine" — env vars not set in production [DEMO KILLER, PILOT KILLER]

**What goes wrong:**
Local `.env.local` has `MCP_API_KEY=devkey123`. Production Vercel env doesn't. The chatbot calls the MCP endpoint, gets 401 unauthorized, looks broken in production but works locally. You discover this 30 min before the deadline.

**Why it happens:**
- Vercel env vars are set per environment (Development/Preview/Production).
- It's easy to add to .env.local during local dev and forget to mirror to Vercel.
- `vercel env pull` only goes one direction (from Vercel to local).

**How to avoid:**
- **Phase 2 sets all env vars in all 3 environments.** Re-verify with `vercel env ls` before each major demo deploy.
- **Maintain a `.env.example`** with all required keys (no values). On every deploy: `for v in $(grep -o '^[A-Z_]\+' .env.example); do vercel env ls | grep $v || echo "MISSING: $v"; done`.
- **Smoke-test production after every deploy.** Phase 11 has a smoke test step — make it a bash script `scripts/smoke.sh` that hits all critical endpoints with `curl` and asserts 2xx.
- **Vercel dashboard → Project → Settings → Environment Variables** — manually scan before final deploy.

**Warning signs:**
- Production logs show "API_KEY undefined" or 401s from MCP
- A feature works in `vercel dev` but fails on the deployed URL
- "It works locally" said more than once during the build

**Phase to address:** Phase 2 (initial env var setup). Phase 11 (smoke test script). Phase 12 (final deploy verification).

---

### Pitfall 19: No `vercel --prod` push until day 6 → discover prod-only bugs at the worst time [DEMO KILLER]

**What goes wrong:**
You build everything, push to preview branches, test in preview URLs. Day 6: `vercel --prod`. Now you discover: prod env vars missing, prod domain not configured, prod has different timeouts, Edge Config not bound to prod, magic link emails not arriving from prod sender, etc. Spend day 7 debugging instead of polishing the demo.

**Why it happens:**
Preview deploys feel safe and frictionless. Prod is an event. The temptation is to delay it.

**How to avoid:**
- **Push to prod at end of Phase 2.** Even an empty Next.js app in prod gets the deploy pipeline shaken out early.
- **Push to prod at end of every phase.** Make it a habit. Each phase ends with `vercel --prod && curl <prod-url> && commit`.
- **The pilot restaurant URL = prod URL from day 1.** If they're going to use it the same week, they need a stable URL early.

**Warning signs:**
- The "Production" tab in Vercel dashboard shows builds older than 24h
- You've never visited the prod URL in a week
- You're not sure if the prod env has the right env vars

**Phase to address:** Phase 2 onward — establish the discipline.

---

### Pitfall 20: Skipping the seed script → first end-to-end run is during the recording [DEMO KILLER]

**What goes wrong:**
Phase 12 says "create scripts/seed-demo.ts for 3 reservations." If you skip it and try to populate the queue manually for the recording, you're typing in the chatbot 3 times for setup, which is slow, error-prone, and wastes time on demo day. Worse: you discover your first real end-to-end flow is the recording itself, and you find a bug at minute 0:45 of the take.

**Why it happens:**
Seeding feels optional. End-to-end testing feels optional. Both are gold.

**How to avoid:**
- **Build `scripts/seed-demo.ts` early — by end of Phase 9.** Use it during Phase 9/10 testing as your default state. By demo day you've run the seed 50 times and know it works.
- **Do a full E2E walkthrough at end of Phase 9, 10, AND 11.** Don't wait for Phase 12.
- **Record a "rough cut" demo at end of Phase 11.** Even if it's bad, it surfaces issues. The good take is on day 7.

**Warning signs:**
- You haven't run the full happy path manually since Phase 6
- The seed script doesn't exist by Phase 11
- "I'll test the demo flow when I have time"

**Phase to address:** Phase 9 (build seed early). Phase 11 (rough cut). Phase 12 (real recording).

---

### Pitfall 21: System prompt doesn't handle ambiguous Spanish inputs [PILOT KILLER]

**What goes wrong:**
Real diners are messy. Inputs the chatbot might face:
- "Somos 4 o 5" (party size ambiguous)
- "para las 8" (no time-based reservations in this product, but the LLM might try to handle it)
- "tengo reserva pero no sé si vamos a ir" (cancel intent? extend intent? unclear)
- "Hola, busco mesa para mañana" (out-of-scope feature — system only does walk-in queue)
- "Mi nombre es Juana, mi marido se llama Pedro, somos 2" (extra info, but who's the contact?)
- All of the above in a chat session that already has a reservation_session cookie ("hola, qué tal mi mesa?")

**Why it happens:**
The system prompt and tool schemas were designed for the happy path. Edge inputs aren't tested.

**How to avoid:**
- **System prompt explicitly states scope:** "Solo manejo cola de espera presencial. Si el comensal pide reserva con horario futuro o algo fuera de esto, decile que el restaurante solo acepta walk-ins y dirigilo al teléfono X."
- **Ask for clarification on ambiguity:** "Si el comensal dice 'somos 4 o 5', preguntá '¿confirmamos 4 o 5?' antes de llamar al tool."
- **Test 10 weird real inputs in Phase 8 before considering it done.** Write them down in `lib/chat/test-prompts.md` and run them.
- **Have the pilot restaurant owner test it briefly** before the maître starts using it for real diners.

**Warning signs:**
- Chatbot creates reservations with `party_size: NaN` or weird values
- Chatbot apologizes a lot or says "I can help with that" then doesn't
- Conversation goes in circles

**Phase to address:** Phase 8 (system prompt). Phase 11 (real inputs testing).

---

### Pitfall 22: No monitoring → silent workflow failures during pilot [PILOT KILLER]

**What goes wrong:**
A workflow crashes on resume (Pitfall 1, 3, 4). Diner sits waiting forever. Maître never gets a notification because the workflow is dead. No alert fires. Diner walks away angry. You find out via the restaurant owner texting you "hey nothing's working."

**Why it happens:**
Solo dev with 7 days has no time for proper monitoring. Vercel logs require manual review. Silent failures are silent.

**How to avoid:**
- **Health check endpoint:** `/api/health` that pings DB, KV, Edge Config, returns status. Cron-ping it from a free service (UptimeRobot, BetterStack free tier).
- **Workflow failure → DB row.** Wrap the workflow with try/catch at the top level; on uncaught error, INSERT into `reservation_events` with `event_type='workflow_failed'` and the error stack. Panel shows a banner "X reservations stuck — check logs."
- **Vercel Analytics free tier** — set up in Phase 11. At least see request volumes.
- **Slack/Discord webhook on workflow failure** (5 min to add, huge payoff): on failure, POST to a webhook with the reservation_id and error. You get pinged in real-time.
- **Daily Vercel logs review during pilot week.** Set a calendar reminder.

**Warning signs:**
- Reservations stuck in `waiting` for hours with no progress
- DB has `reservation_events.workflow_failed` rows
- Restaurant owner texts you about issues you didn't know about

**Phase to address:** Phase 11 (hardening) — minimum viable monitoring before going live.

---

## Technical Debt Patterns

Shortcuts that seem reasonable but create long-term problems.

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Skip `session_token` validation in MCP tools | "I'll add it later, just want create_reservation working" | Diners manipulate each other's reservations; no fix possible without full rewrite of tool signatures; pilot exposed | NEVER — bake into Phase 5 |
| Hard-code `no_show_timeout_min` instead of Edge Config | Saves 10 min in Phase 6 | Demo scenario #5 doesn't work; need to redo workflow code in Phase 7 anyway | Only if Phase 7 is being cut entirely |
| Single-file workflow without splitting helpers | "It's one function, why split?" | Workflow shape changes break in-flight runs (Pitfall 4) | Acceptable if you commit to never restructuring |
| Use `parse` (not `safeParse`) on tool inputs | Less code | LLM tool errors crash the route, not gracefully recover | NEVER for LLM-facing schemas |
| Skip `.env.example` | Saves 2 min | Bootstrap fails on a fresh machine; deploy missing env vars not detected | NEVER — write it as you add each var |
| Log full reservation objects for debugging | Easy to debug | PII in logs, GDPR risk, panic on day of pilot | Never in production code; only inside `if (process.env.NODE_ENV === 'development')` |
| Skip seed script | Saves 1 hour in Phase 9 | First E2E run is during demo recording (Pitfall 20) | NEVER if recording a demo |
| Use `onboarding@resend.dev` for production magic link | No domain verification needed | Maître's actual email bounces; magic link in spam (Pitfall 11) | Only if maître's email is the same as Resend account email AND demo only |
| Push to prod only at the end | "I'll fix prod-specific stuff at the end" | Day 7 spent debugging prod, no time to polish demo (Pitfall 19) | NEVER — push prod every phase |
| Skip Drizzle/Prisma, hand-write SQL migrations | Saves dependency setup | Schema drift between dev/prod; no migration history | Acceptable for hackathon if you have one `migrate.ts` script that runs all SQL files in order |
| One big workflow file with no comments | Get features shipped | Future-you can't safely modify steps; in-flight workflows break unpredictably | Acceptable if you commit to a freeze post-Phase 7 |

---

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| **Vercel Workflow + Postgres** | Open transaction in step A, commit in step B | Each step is independent; use the workflow itself for atomicity (compensating actions on failure) |
| **Vercel Workflow + Edge Config** | Read Edge Config at module top-level | Read inside a `"use step"` so the value is fresh on each invocation |
| **Vercel Workflow + AI SDK** | Call `streamText` directly in workflow body | Wrap in `"use step"` so the LLM call is durable; don't stream from a workflow (workflow steps are not streamable) |
| **Vercel KV + SSE Route Handler** | Subscribe in handler without abort cleanup | `req.signal.addEventListener('abort', () => kv.unsubscribe())` to free Upstash slots on disconnect |
| **Vercel KV + serverless** | Store `Map<reservationId, Subscriber>` in module scope | Each function instance is isolated; per-connection state must live in DB or KV, not memory |
| **Auth.js v5 + middleware** | Import `auth.ts` (with adapter) in `middleware.ts` | Import only `auth.config.ts` (Edge-safe) in middleware; full `auth.ts` only in route handlers |
| **Auth.js v5 + Resend** | Send from unverified domain or default address to anyone except account email | Verify domain in Phase 0; use a domain you control |
| **AI SDK v5 + Anthropic** | Use Zod features Anthropic doesn't support (e.g., `.refine()`, `.default()`) | Test schemas with the actual LLM in Phase 5; remove features that get stripped |
| **AI SDK v5 + tool calling** | No explicit `stopWhen` — rely on `stepCountIs(20)` default | Set `stopWhen: stepCountIs(5)` for the chatbot (5 is enough for the longest legitimate flow) |
| **MCP adapter + public access** | No API key gating | `X-MCP-API-Key` header on every tool call, validated in adapter route handler |
| **MCP adapter + transport** | Assume client speaks Streamable HTTP, server only does SSE | Verify which transport the AI SDK MCP client uses; `@vercel/mcp-adapter` supports both, default is Streamable HTTP per [Vercel changelog](https://vercel.com/changelog/mcp-server-support-on-vercel) |
| **`@vercel/postgres` + Drizzle (if added)** | Use both clients in same step | Pick one; mixing causes connection-tracking confusion |

---

## Performance Traps

Patterns that work at small scale but fail as usage grows. (Note: pilot is <20 concurrent diners, so most of these don't bite at v1, but worth knowing for post-pilot.)

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Step count grows linearly per workflow (loop with N iterations = N step records) | Workflow gets slower to resume after each iteration ([vercel/workflow #1315](https://github.com/vercel/workflow/issues/1315)) | Use one step that takes the full iteration count as input, not N steps in a loop | When a single reservation has >50 events (extensions, recomputes) — unlikely at pilot scale but possible if `eta_recompute_interval_sec` is small |
| One Upstash subscription per SSE connection | Upstash dashboard shows climbing connection count | Use BLPOP pattern OR aggressive cleanup on disconnect | At ~25 concurrent SSE streams on free tier |
| ETA recompute every 30s × N active reservations | LLM costs explode | Cache ETA in KV with 60s TTL; recompute on demand only when reservation count changes | At 50+ active reservations |
| `useChat` resends full message history every turn | Token costs grow with conversation length | Truncate history server-side; keep last 10 messages | At 30+ message conversations |
| Polling `/api/queue` from panel instead of SSE | Hammers DB on every refresh | Use SSE channel `queue:active` for panel | If panel auto-refresh interval drops below 5s |
| `reservation_events` table never archived | Slow queries on history page | Add monthly partitioning OR archive table after pilot | At 10K+ events |

---

## Phase-Specific Warnings (Cross-Reference)

| Scope §13 Phase | Top 3 Pitfalls to Address |
|-----------------|---------------------------|
| Phase 0 | #11 (Resend domain verification — start NOW), #18 (env var inventory in `.env.example`) |
| Phase 1 | None critical |
| Phase 2 | #18 (set env vars in all 3 environments), #19 (push to prod), #11 (link domain) |
| Phase 3 | #13 (pooled vs non-pooled URL choice) |
| Phase 4 | #11 (Resend domain MUST be verified before this phase), #12 (Auth.js v5 split config) |
| Phase 5 | #5 (session_token validation in tools), #9 (Zod schemas with LLM-friendly defaults), #15 (logging helper), #16 (no fake confirmations) |
| Phase 6 | #1 (steps discipline), #2 (waitForEvent + DB safety net), #3 (serializable returns), #4 (freeze workflow shape), #7 (KV pub/sub pattern), #14 (Edge Config inside steps) |
| Phase 7 | #14 (Edge Config propagation testing) |
| Phase 8 | #6 (SSE timeouts + heartbeat + reconnect), #8 (stopWhen=5), #10 (cookie set on separate request), #16 (UI confirmation badge), #21 (system prompt for edge inputs) |
| Phase 9 | #6 (SSE for panel), #20 (build seed script HERE not Phase 12) |
| Phase 10 | #1 + #3 (DurableAgent has same constraints as workflow) |
| Phase 11 | #15 (PII audit), #18 (smoke test script), #22 (health check + monitoring), #20 (rough cut demo), #19 (push to prod) |
| Phase 12 | #14 (rehearse demo #5 timing), #17 (record in clips, pre-script, temperature 0.2) |

---

## Severity Summary

**[DEMO KILLER]** — breaks the 90s video on camera:
1, 2, 3, 4, 6, 7, 8, 9, 10, 14, 17, 18, 19, 20

**[PILOT KILLER]** — breaks for real diners and damages restaurant:
2, 4, 5, 6, 11, 12, 13, 15, 16, 18, 21, 22

**[ANNOYANCE]** — friction but recoverable:
12 (if caught early), some technical debt patterns

**[MINOR]** — polish only:
performance traps (don't bite at pilot scale)

---

## Sources

- [Vercel Workflow — programming model for durable execution](https://vercel.com/blog/a-new-programming-model-for-durable-execution) (HIGH — official)
- [Vercel Workflow docs](https://vercel.com/docs/workflows) (HIGH — official)
- [Vercel Workflow event sourcing changelog](https://vercel.com/changelog/workflow-event-sourcing) (HIGH — official)
- [Vercel/workflow issue #1315 — step processing time](https://github.com/vercel/workflow/issues/1315) (HIGH — first-hand bug report)
- [Vercel/workflow issue #943 — step hang](https://github.com/vercel/workflow/issues/943) (HIGH — first-hand bug report)
- [vercel-labs/agent-browser issue #561 — waitForEvent race](https://github.com/vercel-labs/agent-browser/issues/561) (HIGH — first-hand)
- [Cloudflare Workers waitForEvent issue #11740](https://github.com/cloudflare/workers-sdk/issues/11740) (MEDIUM — sister product, same pattern)
- [Workflow versioning issue #89](https://github.com/vercel-labs/workflow-builder-template/issues/89) (HIGH — first-hand)
- [@vercel/mcp-adapter and transport options](https://vercel.com/changelog/mcp-server-support-on-vercel) (HIGH — official)
- [Building efficient MCP servers — Vercel](https://vercel.com/blog/building-efficient-mcp-servers) (HIGH — official)
- [Deploy MCP servers to Vercel](https://vercel.com/docs/mcp/deploy-mcp-servers-to-vercel) (HIGH — official)
- [MCP Tool Poisoning — OWASP](https://owasp.org/www-community/attacks/MCP_Tool_Poisoning) (HIGH — security authority)
- [Simon Willison — MCP prompt injection](https://simonwillison.net/2025/Apr/9/mcp-prompt-injection/) (HIGH — credible analysis)
- [Microsoft — Protecting against indirect prompt injection in MCP](https://developer.microsoft.com/blog/protecting-against-indirect-injection-attacks-mcp) (HIGH — vendor security guidance)
- [Palo Alto Unit 42 — MCP attack vectors](https://unit42.paloaltonetworks.com/model-context-protocol-attack-vectors/) (HIGH — security research)
- [Solving MCP authentication — Neon](https://neon.com/blog/solving-mcp-with-vercel-and-better-auth) (MEDIUM — vendor blog)
- [AI SDK 5 migration guide](https://ai-sdk.dev/docs/migration-guides/migration-guide-5-0) (HIGH — official)
- [AI SDK 5 — Vercel announcement](https://vercel.com/blog/ai-sdk-5) (HIGH — official)
- [vercel/ai issue #7502 — stopWhen and useChat maxSteps](https://github.com/vercel/ai/issues/7502) (HIGH — first-hand bug)
- [vercel/ai issue #9384 — infinite tool error loop](https://github.com/vercel/ai/issues/9384) (HIGH — first-hand bug)
- [vercel/ai issue #13355 — Anthropic JSON schema sanitization](https://github.com/vercel/ai/issues/13355) (HIGH — first-hand bug)
- [Zod validation errors with AI SDK tool calls](https://community.vercel.com/t/how-to-pass-zod-validation-errors-from-tool-calls-back-to-llm/24610) (MEDIUM — community)
- [Validating MCP Tool Inputs — Fast.io 2026](https://fast.io/resources/validating-mcp-tool-inputs/) (MEDIUM — vendor blog)
- [SSE in Next.js — comprehensive guide 2026](https://nextjslaunchpad.com/article/nextjs-server-sent-events-real-time-notifications-progress-tracking-live-dashboards) (MEDIUM — independent)
- [Fixing slow SSE streaming on Vercel](https://medium.com/@oyetoketoby80/fixing-slow-sse-server-sent-events-streaming-in-next-js-and-vercel-99f42fbdb996) (MEDIUM — independent practitioner)
- [Vercel function maxDuration docs](https://vercel.com/docs/functions/configuring-functions/duration) (HIGH — official)
- [Vercel KB — function timeouts](https://vercel.com/kb/guide/what-can-i-do-about-vercel-serverless-functions-timing-out) (HIGH — official)
- [Upstash Redis pub/sub system](https://deepwiki.com/upstash/redis-js/4.8-pubsub-system) (MEDIUM — derived docs)
- [Upstash + Next.js App Router quickstart](https://upstash.com/docs/redis/quickstarts/vercel-functions-app-router) (HIGH — vendor official)
- [Auth.js migrating to v5](https://authjs.dev/getting-started/migrating-to-v5) (HIGH — official)
- [Auth.js Resend provider](https://authjs.dev/getting-started/providers/resend) (HIGH — official)
- [Auth.js configuring Resend](https://authjs.dev/guides/configuring-resend) (HIGH — official)
- [Resend domain verification](https://resend.com/blog/new-domain-verification-experience) (HIGH — vendor official)
- [Neon connection pooling](https://neon.com/docs/connect/connection-pooling) (HIGH — vendor official)
- [Neon — choosing connection method](https://neon.com/docs/connect/choose-connection) (HIGH — vendor official)
- [Vercel Edge Config docs](https://vercel.com/docs/edge-config) (HIGH — official)
- [Vercel Edge Config blog](https://vercel.com/blog/edge-config-ultra-low-latency-data-at-the-edge) (HIGH — official)
- [@vercel/edge-config npm package](https://www.npmjs.com/package/@vercel/edge-config) (HIGH — official)
