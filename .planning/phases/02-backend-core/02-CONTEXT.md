# Phase 2: Backend Core - Context

**Gathered:** 2026-04-26
**Status:** Ready for planning
**Discuss outcome:** User selected "ninguno, ejecuta todos" — all gray areas decided by Claude using research-backed defaults from PROJECT.md, REQUIREMENTS.md, ROADMAP.md, research/SUMMARY.md, research/STACK.md, research/ARCHITECTURE.md, research/PITFALLS.md, plus Phase 1 carry-forwards from `01-CONTEXT.md` and live state in `01-VERIFICATION.md`.

<domain>
## Phase Boundary

Phase 2 ships the public, durable backend that any client (the Phase 3 chatbot via MCP, a future WhatsApp adapter, raw `curl`) can use to manage a reservation lifecycle end-to-end. Everything mutational funnels through `lib/services/*`. The reservation lifecycle is orchestrated by a Vercel WDK workflow (`waiting → called → seated|no_show|cancelled` with `extend` branch) that survives a deploy mid-flight (the money shot). The four MCP tools, the staff action API endpoints, and a `seed-demo.ts` script are all thin wrappers around the same service layer. SSE Route Handlers expose realtime state changes to (eventual) chatbot + panel clients with snapshot-replay-on-connect from Postgres + KV pub/sub for the live hint.

**Workflow shape FREEZES at the end of Phase 2.** After Phase 2 ships, only step BODIES may change — never step count or order. New steps must land at the END of the workflow function or behind Edge Config feature flags. This is the contract that makes the money-shot demo (and the real pilot's in-flight reservations) safe.

**In scope:** MCP server (4 tools) + per-tool security (bearer + session_token) + service layer (`lib/services/*`) + WDK durable workflow (`lib/workflows/reservation.ts`) + KV pub/sub publisher (`lib/realtime.ts`) + SSE Route Handlers (`/api/events/[reservation_id]`, `/api/events/queue`) + staff action API (`/api/queue/[id]/call`, `/api/queue/[id]/seated`, etc.) + `lib/log.ts` PII redactor (SAFE-01) + `scripts/seed-demo.ts` (DEMO-04) + money-shot smoke test (automated bash + manual ritual). Collapses scope_hackathon_mvp.md Fases 5 + 6.

**Out of scope (later phases):**
- Chatbot UI / `useChat` / `/api/chat` / system prompt / tool-call lifecycle in chat (Phase 3)
- Maître panel / queue cards / Llamar+Marcar presentado UI / `/queue/history` (Phase 3 — note: staff action API endpoints land HERE so the workflow can be exercised; the panel that calls them lands in Phase 3)
- DurableAgent ETA estimator (`@workflow/ai/agent`) — Phase 3 with cap-at-4h fallback to deterministic formula
- Rate limit (5 req/min) on `create_reservation`, idempotency dedup key, `/api/health` endpoint, Slack/Discord webhook on workflow failure (Phase 4)
- AI SDK telemetry routing through `redactPII` (Phase 3, when chatbot lands)
- Demo video recording, README polish, final prod deploy as a discrete step (Phase 4 — though every Phase 2 commit pushes to prod via existing auto-deploy from Phase 1 D-13)

**Phase 2 prerequisites already satisfied (by Phase 1):**
- Public Vercel URL stable: `https://zero-to-agent-xi.vercel.app`
- Auto-deploy via `git push origin main` already wired (Phase 1 D-13 + verified — 4 prod deploys observed)
- DB schema with reservations (UUID, 6 statuses including `failed_to_start`, `workflow_run_id` column, `session_token UUID UNIQUE`, `extension_count`, `no_show_deadline`, `called_at`, `ended_at`) and `reservation_events` audit table — no new migration needed for core lifecycle (one schema addition planned: `active_hook_token` column, see D-09)
- 6 Edge Config keys live with typed `getConfig()` wrapper at `lib/edge-config/index.ts` (Phase 1 D-08)
- Two-pg-clients pattern verified (Pool for Auth, Neon HTTP for app) — service layer uses `lib/db/neon.ts`
- KV provisioned + smoke test passing (`npm run smoke:kv`)
- All 11 required env keys in all 3 Vercel envs including `MCP_API_KEY`
- Skew Protection NOT yet verified enabled in dashboard — flagged as a Phase 2 prerequisite gate (see D-17)

</domain>

<decisions>
## Implementation Decisions

### MCP Tools — Security + Error Contract (PLAT-01, PLAT-02; Pitfalls #5, #9, #16)

- **D-01:** All 4 MCP tools live behind `withMcpAuth(handler, verifyBearer, { required: true })`. The `verifyBearer` function accepts the bearer header, compares constant-time against `process.env.MCP_API_KEY`, returns `AuthInfo | undefined`. One verifier function for all tools — never inline auth per tool (Pitfall: drift; ARCHITECTURE Anti-Pattern 5).
- **D-02:** `create_reservation` is the ONLY tool whose LLM-visible `inputSchema` accepts diner identity fields: `{ name: z.string().min(1), email: z.string().email(), phone: z.string().min(5), party_size: z.coerce.number().int().min(1).max(20) }` — wrapped with `.passthrough()` so LLM-fabricated extra fields (notes, allergens) are ignored, not rejected. Returns text content `JSON.stringify({ ok: true, data: { reservation_id, session_token, position, eta_min } })` on success.
- **D-03:** `extend_wait`, `cancel_reservation`, `get_reservation_status` accept ZERO LLM-visible parameters that identify a reservation. Their `inputSchema` is `z.object({}).passthrough()` (the LLM may pass arbitrary context but the server ignores it for resolution). The MCP route handler reads `X-Reservation-Session` from the original request headers, looks up `(session_token) → reservation row` in Postgres, then dispatches to the service function with the resolved `reservation_id`. If header is missing or no row matches → return error code `INVALID_SESSION` (LLM apologizes in Spanish per system prompt rule landing in Phase 3). Mitigates Pitfall #5 (MCP tool poisoning) — the LLM has NO way to act on someone else's reservation.
- **D-04:** Tool error contract is structured JSON returned as `text` content (because MCP tool results are strings to the LLM): `JSON.stringify({ ok: false, error: { code: "STRING_CODE", message: "Spanish-friendly user message" } })`. Distinct codes: `INVALID_SESSION`, `INVALID_INPUT`, `NOT_IN_CALLED_STATE` (extend before called), `NOT_IN_WAITING_OR_CALLED_STATE` (cancel after closed), `MAX_EXTENSIONS_REACHED`, `RESERVATION_NOT_FOUND`, `RESERVATION_ALREADY_CLOSED`, `INTERNAL_ERROR`. Phase 3 system prompt rule: "Si un tool devuelve `ok: false`, explicale al comensal el `error.message` en español y NO reintentes el tool." Mitigates Pitfall #9 (LLM-friendly errors prevent infinite tool loops) and Pitfall #16 (no fake-success — confirmation badge in chatbot UI reads `result.ok && result.data.reservation_id`, never LLM text).
- **D-05:** Zod usage discipline (Pitfall #9): `.passthrough()` on every object schema; `.coerce.number()` on numerics; `.refine()` and `.default()` are FORBIDDEN at the top-level inputSchema (Anthropic strips these — verified in Pitfall #9 source). Use `safeParse` (not `parse`) and on validation failure return `INVALID_INPUT` with field-level details: `{ ok:false, error:{ code:"INVALID_INPUT", message:"...", fields:{ party_size:"debe ser entre 1 y 20" } } }`.
- **D-06:** `lib/mcp/auth.ts` exports two helpers: `verifyBearer(rawRequest, bearer): Promise<AuthInfo | undefined>` (used by `withMcpAuth`) and `resolveSession(rawRequest): Promise<{ reservationId: string; row: ReservationRow } | null>` (called as the FIRST line of every action tool's `execute`). Tools never inline these checks.
- **D-07:** MCP route lives at `app/mcp/[transport]/route.ts` per `mcp-handler` convention. Exports `GET = POST = DELETE = authHandler`. `basePath: "/mcp"`, `maxDuration: 60` (a tool call should never need longer; the workflow is async). `verboseLogs: process.env.NODE_ENV !== "production"`. Streamable-HTTP transport (default).

### Workflow Shape, Hook-Race Safety + Spikes (PLAT-03; Pitfalls #1, #2, #3, #4, #14)

- **D-08:** Hook tokens are PHASE-SPECIFIC: `reservation:<id>:waiting`, `reservation:<id>:called:pre` (1-min followup window between `called` and the proactive "¿Estás en camino?" message), `reservation:<id>:called:final` (the post-followup window where extend/cancel/seated can land before the `no_show_deadline` timeout). Three tokens, one workflow function, transitions are linear. Staff API endpoints look up the active token from DB (see D-09) before calling `resumeHook`.
- **D-09:** **Schema addition (forward-only migration `db/migrations/0002_workflow_active_hook.sql`):** add `active_hook_token TEXT NULL` column to `reservations`. Workflow writes the active token at each phase transition step (e.g., `UPDATE reservations SET active_hook_token = $token WHERE id = $id`). Staff API endpoints read this column to know which token to pass to `resumeHook`. Existing migration runner (`scripts/db-migrate.ts` from Phase 1 D-02) handles this — no backfill needed (empty `reservations` table at end of Phase 1).
- **D-10:** **DB-backed safety net is SHIPPED, not relying on createHook buffering alone.** Service-layer pattern: every staff/diner action that triggers a workflow event does, in this order:
  1. `INSERT INTO reservation_events(reservation_id, event_type, payload)` with event_type ∈ `{call_requested, extend_requested, cancel_requested, seated_requested}`
  2. `await resumeHook(token, payload)` (in-process per ARCHITECTURE §3.5 / D-37)
  Workflow timeout branches (the `sleep(...)` arms of every `Promise.race`) re-emerge and immediately:
  ```
  SELECT * FROM reservation_events
  WHERE reservation_id = $1
    AND id > $last_seen_event_id
    AND event_type IN ('call_requested','extend_requested','cancel_requested','seated_requested')
  ORDER BY id ASC
  ```
  Process any missed events in order before re-entering the next race. Spike 2-B (D-15) determines whether createHook buffers — if it does, the safety net is belt-only; if not, it's the primary delivery path. Either way, ship it. Mitigates Pitfall #2 (waitForEvent race) which is BOTH a demo killer AND a pilot killer.
- **D-11:** **Workflow file structure: SINGLE FILE** at `lib/workflows/reservation.ts` containing the full state machine plus all `"use step"` helpers as inline async functions in the same file. **DO NOT split** into `reservation/index.ts + steps.ts + ...` — file count change is a workflow-shape change per Pitfall #4 and risks breaking in-flight runs across deploys. `lib/workflows/_README.md` (also created in Phase 2, before any workflow code lands) documents:
  - The "function-is-a-router, steps-do-the-work" rule (Pitfall #1)
  - The freeze-shape commitment (Pitfall #4)
  - The hook token convention (D-08) + DB-backed safety net (D-10)
  - The plain-JSON step contract (Pitfall #3)
  - How to add a new step safely (END of function or behind Edge Config flag)
- **D-12:** Step boundary discipline (Pitfall #3): every step input/output is JSON-serializable. DB row reads PROJECT specific columns and convert all `TIMESTAMPTZ` to ISO strings before returning. No `Date` objects, no `Map`, no class instances, no `Buffer`, no functions cross step boundaries. Add `__tests__/workflow-step-serialization.test.ts` that round-trips each step's return value through `JSON.parse(JSON.stringify(x))` and asserts deep equality.
- **D-13:** All Edge Config reads happen INSIDE `"use step"` functions, never at module load (Pitfall #14). Sample-once-and-store discipline: `no_show_deadline` is computed ONCE at the `called` transition step using the `no_show_timeout_min` value sampled THEN, written to `reservations.no_show_deadline`, and used by ALL subsequent timeout calculations for that ticket. Dashboard edits to `no_show_timeout_min` mid-deadline do NOT retroactively shift the existing ticket — narrate this honestly in the demo.
- **D-14:** Compensating action on `workflow.start` failure (ARCHITECTURE Pattern 1): service layer wraps the start in try/catch; on throw, runs `UPDATE reservations SET status='failed_to_start' WHERE id=$1` and re-throws. Active-queue queries filter `status NOT IN ('failed_to_start','seated','no_show','cancelled')`. The DB row is left in place (not deleted) for forensic audit during the pilot.
- **D-15:** **Spike scheduling: BOTH spikes are FIRST tasks in `/gsd-execute-phase 2`, BEFORE any workflow code lands.** Findings are written into `lib/workflows/_README.md` as anchored decisions before the main workflow function begins.
  - **Spike 2-A (`scripts/spike-using-keyword.ts`, ~30 min):** Minimal workflow with `using hook = createHook(...)`; deploy to a Vercel preview URL; verify the build succeeds AND the runtime executes the `Symbol.dispose` cleanly when the workflow exits the scope. **Fallback if `using` fails to compile or run on Vercel's Node 20 runtime:** rewrite all hook usage as `const hook = createHook(...); try { ... } finally { await hook.dispose(); }`. Either decision is recorded in `_README.md`.
  - **Spike 2-B (`scripts/spike-hook-buffering.ts`, ~30 min):** Start a workflow that does `sleep("5s")` then `createHook(...)` then awaits the race. From a parallel script, fire `resumeHook(token, ...)` 1s into the sleep (well before the workflow's createHook line is reached). Observe whether the event is delivered when the workflow eventually subscribes. Result determines whether D-10's DB-backed safety net is mandatory (no buffering) or belt-and-suspenders (buffering present). **Either way, D-10 ships.**
- **D-16:** Workflow function body never directly calls `crypto.randomUUID()`, `Date.now()`, `Math.random()`, `fetch()`, `db.*`, or `kv.*` from the router level (Pitfall #1). All such calls live inside `"use step"` async functions. Pre-merge code review checklist: `grep -nE 'Math\.random|crypto\.randomUUID|Date\.now|fetch\(|sql\`|redis\.' lib/workflows/reservation.ts | grep -v '"use step"'` should return zero hits in the router-level body.
- **D-17:** **Skew Protection MUST be verified enabled in Vercel project settings as a Phase 2 prerequisite gate.** This is one click in the dashboard (Project → Settings → Skew Protection → Enable). The plan-phase agent surfaces this as a manual prerequisite check at the top of the execute checklist; the agent does NOT proceed to write workflow code until it asks the user to confirm. Without it, the money-shot demo cannot work and in-flight pilot reservations can break on deploy.

### Service Layer Organization + PII Redactor (PLAT-01, SAFE-01; Pitfall #15)

- **D-18:** Service layer is **two files**, both pure TS with no Next.js coupling:
  - `lib/services/reservations.ts` — exports `createReservation`, `getReservationStatus`, `extendWait`, `cancelReservation`. Each function: validate input → DB write/read → workflow.start or resumeHook → KV publish → return JSON-serializable result.
  - `lib/services/queue.ts` — exports `getActiveQueue` (used by Phase 3 staff panel; built here so the Phase 2 staff action API endpoints can also read it) and `markCalled` / `markSeated` (the staff action functions that resume workflow hooks).
  Two files keeps the file count small (Pitfall #4 friendliness — fewer files = fewer accidental shape changes) while separating diner-facing actions from staff-facing actions cleanly.
- **D-19:** Service-layer DB writes use `lib/db/neon.ts` (HTTP, pooled). Migrations and load tests use `lib/db/pool.ts` (`pg.Pool`, pooled). Same pooled Neon URL, two clients (Phase 1 D-28 verified at 441ms wall under 10+10 parallel). Auth.js continues to use `lib/db/pool.ts` exclusively.
- **D-20:** KV publish helper at `lib/realtime.ts` exports `publishReservationEvent(id, event)` and `publishQueueEvent(event)`. Both use `Redis.fromEnv()` (matches the Phase 1 KV smoke test at `scripts/smoke-test-kv.ts`). Service functions and workflow steps call these helpers — they NEVER call `redis.publish` directly. Subscription is ONLY in SSE Route Handlers, never in service functions or workflow steps.
- **D-21:** **`lib/log.ts` (SAFE-01) shape:**
  - Exports: `log.info(event, ctx?)`, `log.warn(event, ctx?)`, `log.error(event, errOrCtx?, ctx?)`, plus the lower-level `redactPII(value)` helper.
  - `redactPII` walks the object/array tree (capped at depth 4). For each string value: applies email regex → masks local part (`j****@talos.lat`); applies Argentine-format phone regex (loose, accepts `+54...`, `5491...`, `11-...`, etc.) → masks all but last 4 digits. For each known-PII KEY (`name`, `email`, `phone`, `full_name`, `phone_number`, `payload.name`, `payload.email`, `payload.phone`), masks the value entirely (`[REDACTED]`).
  - The known-PII key list is centralized in `lib/log.ts` exported as `PII_KEYS: readonly string[]` so tests can assert it covers the schema columns from `0001_init.sql`.
  - `log.*` writes structured JSON via `console.log(JSON.stringify({ ts: new Date().toISOString(), level, event, ...redactPII(ctx) }))`. Vercel's log shipping picks up JSON natively.
  - Used EVERYWHERE in `lib/services/*` + `lib/workflows/*` + MCP tool handlers + SSE handlers + staff API endpoints. Raw `console.*` outside `lib/log.ts` is forbidden — Phase 2 adds an ESLint custom rule (or a CI grep step) flagging raw `console.log/warn/error` calls outside the allow-list.
- **D-22:** AI SDK telemetry routing through `redactPII` is deferred to Phase 3 when the chatbot lands (`/api/chat`'s `experimental_telemetry` and tool-call onResponse hooks scrub before logging). Documented in this CONTEXT.md and added to `lib/workflows/_README.md` cross-references for Phase 3 awareness.
- **D-23:** Add `__tests__/log-redact.test.ts` with at least 6 cases: nested-email-in-payload, phone-in-array, mixed PII keys, depth-cap behavior, no-PII passthrough, AND a regression test that runs `redactPII(reservationRow)` against a fixture row and asserts no `name`/`email`/`phone` substring leaks.

### Realtime Fan-out + SSE + Money-Shot + seed-demo (PLAT-05, PLAT-07, DEMO-04; Pitfalls #6, #7, #19, #20)

- **D-24:** **KV channel naming:**
  - `reservation:<uuid>` — per-reservation events. Subscribed by `/api/events/[reservation_id]` SSE handler.
  - `queue:active` — fan-out for the staff panel. Every reservation lifecycle event ALSO publishes here with a minimal payload `{ reservation_id, type, ...summary_fields }`. Subscribed by `/api/events/queue` SSE handler.
- **D-25:** KV message payload is stable JSON: `{ id: <reservation_events.id>, type: <event_type>, reservation_id: <uuid>, occurred_at: <iso>, ...event_specific_fields }`. The `id` field maps to `reservation_events.id` so SSE clients can pass `Last-Event-ID` for resumability per Pitfall #6.
- **D-26:** **SSE Route Handler shape (mandatory headers + lifecycle):**
  - `export const runtime = "nodejs"`, `export const maxDuration = 800` (Pro), `export const dynamic = "force-dynamic"`.
  - Response headers: `Content-Type: text/event-stream`, `Cache-Control: no-cache, no-transform`, `Connection: keep-alive`, `X-Accel-Buffering: no`.
  - Heartbeat every 25s as `: hb\n\n` (comment line; ignored by EventSource but keeps proxies alive).
  - `req.signal.addEventListener("abort", () => { clearInterval(hb); sub.unsubscribe(); controller.close(); })` — releases Upstash subscription slot on disconnect (Pitfall #7).
- **D-27:** **Snapshot-replay-on-connect (mandatory; ARCHITECTURE Pattern 3):** every SSE handler does, in this exact order:
  1. Read current state from Postgres (project the columns the client needs; for `/api/events/[reservation_id]` that's `id, status, position, eta_min, no_show_deadline, called_at, extension_count`; for `/api/events/queue` that's the active-queue list).
  2. Emit as initial event: `id: <reservation_events.max(id)>\nevent: snapshot\ndata: <json>\n\n`.
  3. If the client sent `Last-Event-ID` header, ALSO replay any `reservation_events` rows with `id > Last-Event-ID` from Postgres (in order) before subscribing.
  4. Subscribe to KV channel(s).
  This eliminates the "missed message during reconnect" race (Pitfall #6) and the "subscriber-not-yet-attached" race (Pitfall #7). Postgres is the source of truth; KV is a real-time hint.
- **D-28:** **Diner SSE auth (no cookie-during-stream — ARCHITECTURE §3.3 enforces cookie-during-stream as out of v1):** `/api/events/[reservation_id]` accepts `?session_token=<uuid>` query parameter. Validates by `SELECT id FROM reservations WHERE id = $1 AND session_token = $2`. Mismatch → 401. The chatbot client (Phase 3) reads `session_token` from localStorage and constructs `new EventSource(`/api/events/${reservation_id}?session_token=${token}`)`. Trade-offs (documented honestly):
  - Token visible in server access logs and proxy logs → **mitigated by `lib/log.ts` D-21 redacting query string `session_token` values from any logged URL**.
  - Token in URL is acceptable for v1 because (a) it is single-purpose / non-credential / non-reusable across reservations, (b) the v1 alternative (cookie-during-stream) is broken per HTTP spec (Pitfall #10), (c) localStorage + query param is the pattern recommended by ARCHITECTURE §3.3.
- **D-29:** **Staff SSE auth:** `/api/events/queue` is gated by `auth()` from `lib/auth/auth.ts` PLUS the same employees-active gate used in Phase 1 D-11 (re-validate `employees.active = true` on every connect). Returns 401 if `session.user` missing or `employees.active = false`. No additional handshake required.
- **D-30:** **Staff action API endpoints land in Phase 2 (so the workflow can be exercised without the panel):**
  - `POST /api/queue/[id]/call` — auth-gated, resolves active hook token from `reservations.active_hook_token`, persists `reservation_events(event_type='call_requested')` BEFORE `resumeHook` (D-10), publishes `reservation:<id>` + `queue:active` events.
  - `POST /api/queue/[id]/seated` — same pattern with `seated_requested`.
  - `POST /api/queue/[id]/no_show_manual` — same pattern (this is the "manual override no_show" path; STAFF-09 undo lives in Phase 3 with the panel).
  These endpoints are TESTED via curl in Phase 2 (covered by smoke test). The Phase 3 panel calls them.
- **D-31:** **Money-shot smoke test format: BOTH automated and manual.**
  - **Automated:** `scripts/smoke-money-shot.sh` (bash) — performs:
    1. `curl POST /mcp` with bearer + `create_reservation` payload, twice, captures both `reservation_id`s.
    2. Sleeps 3s to let workflows settle into their `:waiting` race.
    3. Echoes the `git push origin main` command for the operator to run (NOT auto-executed — operator confirms a no-op commit). Records the timestamp.
    4. Polls `/api/events/<id>?session_token=<token>` SSE for each reservation for 60s using `curl -N`. Asserts each receives at least one `event: snapshot` AND that subsequent activity (e.g., `eta_min` updates from the workflow's recompute loop) arrives AFTER the deploy timestamp.
    5. Exits 0 if both reservations show post-deploy activity, non-zero with the failing reservation_id otherwise.
  - **Manual ritual** documented at `lib/workflows/_README.md` "Money-shot rehearsal":
    1. Verify Skew Protection is enabled (D-17).
    2. `npm run seed:demo` to get 3 reservations live.
    3. Trivial commit (e.g., bump comment in this README) + `git push`.
    4. Watch Vercel Workflow dashboard + `SELECT id, status, updated_at FROM reservations` to confirm in-flight runs continue progressing.
- **D-32:** **`scripts/seed-demo.ts` strategy (DEMO-04, Pitfall #20):** 3 reservations created via the REAL `lib/services/reservations.ts → createReservation()` (so workflows are LIVE every dev session and Phase 2's full plumbing is exercised every time). Then advance 2 of them via internal hook resumes:
  - Reservation A: fresh `waiting` (workflow parked at `:waiting` token).
  - Reservation B: advanced to `called` (script calls the same `markCalled` service function the staff API uses → `resumeHook("reservation:<B>:waiting", { type: "call" })`, workflow advances).
  - Reservation C: advanced to `seated` (similar path through `markCalled` then `markSeated`).
  - Names use safe fake data: `Demo Comensal 1`, `Demo Comensal 2`, `Demo Comensal 3` with `+540000000001..3` phones and `demoN@example.test` emails. NO real PII committed to the repo.
  - Script is idempotent: deletes any existing rows where `email LIKE 'demo%@example.test'` first, then re-creates.
  - `npm run seed:demo` — runs from day 1 of Phase 2 execution; every developer reset uses it. NOT a Phase 4-only artifact.
- **D-33:** **`scripts/smoke-test-mcp.sh` (Phase 2 deliverable; Phase 4 hardening expands it):** minimal bash hitting all 4 MCP tools end-to-end with proper auth headers; asserts 2xx + the `{ ok: true, data: ... }` shape. Uses production URL by default, accepts `BASE_URL` env override for preview testing. Documented in README as `npm run smoke:mcp`.
- **D-34:** **Push-to-prod-every-phase discipline (Pitfall #19) is preserved:** Phase 2 ends with the money-shot smoke test running green against production. No manual `vercel --prod` — every commit to `main` auto-deploys via the Phase 1 wiring.

### Cross-cutting Workflow ↔ MCP ↔ Service-Layer Wiring

- **D-35:** Every MCP tool's `execute` is a 5–15 line wrapper around a single `lib/services/reservations.ts` function (ARCHITECTURE Pattern 1). Same goes for the staff action API endpoints — they import `lib/services/queue.ts` functions directly. NO HTTP self-calls (ARCHITECTURE Anti-Pattern 1 / commitment §3.5).
- **D-36:** `/api/chat` (Phase 3) will call services DIRECTLY — not via `experimental_createMCPClient` in-process roundtrip. The MCP server stays as the public interface for FUTURE clients (WhatsApp, raw curl). This is documented now to lock the boundary (Open Question #3 from research SUMMARY §7 → DECIDED in favor of direct service calls).
- **D-37:** `resumeHook` is imported from `workflow/api` and called directly from staff API endpoints (in-process). NEVER `fetch()` back to a workflow endpoint (ARCHITECTURE Anti-Pattern 1).

### Folded Todos

None — `gsd-sdk query todo.match-phase 2` returned 0 matches.

### Claude's Discretion

Plan-phase / executor agents have flexibility on:
- Exact file boundaries inside `lib/mcp/` (could be one `auth.ts` or split into `verify-bearer.ts` + `resolve-session.ts`)
- Exact wording of MCP tool descriptions (English metadata is fine; the LLM reads the description to pick the right tool — Spanish-friendly hints in description help but are not required)
- Exact event names in `log.ts` calls (e.g., `"reservation.create.start"` vs `"create_reservation_start"`) — pick one snake-case-or-dot convention and apply consistently
- Whether `lib/log.ts` adds Pino later — default: pure-JSON `console.log`, no dependency
- Tests stack (`vitest` vs `node:test`) — default: `node:test` to avoid adding `vitest`; small test footprint in Phase 2
- Exact Spanish copy for tool error `message` fields (must align with SAFE-03 empathic-recoverable tone for diner-facing errors)
- Whether to add a `npm run dev:reset` script that runs `db:migrate` + `seed:maitre` + `seed:demo` in order (recommended; lightweight)
- Whether the workflow's `recompute_eta` step actually calls AI or just the deterministic formula in Phase 2 — default: deterministic formula (`position * avg_turnover_min` from Edge Config) so Phase 2 has zero AI Gateway cost. Phase 3 wraps the same step in `@workflow/ai/agent` for the Track 2 narrative. Step BODY changes are safe per Pitfall #4 (D-11 freeze rule explicitly allows this).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project artifacts (always read first)
- `.planning/PROJECT.md` — vision, scope, key decisions table, constraints (Spanish-only, real-pilot-same-week, cut list)
- `.planning/REQUIREMENTS.md` — Phase 2 reqs: PLAT-01, PLAT-02, PLAT-03, PLAT-05, PLAT-07, SAFE-01, DEMO-04; full Out-of-Scope table
- `.planning/ROADMAP.md` §"Phase 2: Backend Core" — goal-backward success criteria 1–5; phase-mapped pitfalls #1/#2/#3/#4/#5/#7/#9/#15/#16; required spikes (the two `using`/buffering spikes)
- `.planning/STATE.md` — accumulated context + locked decisions table
- `.planning/phases/01-foundation/01-CONTEXT.md` — Phase 1 decisions to inherit (D-19 env validation, D-25 repo layout, D-26 lib/ subdir convention, D-28 two-pg-clients verified)
- `.planning/phases/01-foundation/01-VERIFICATION.md` — Phase 1 verified state (DB schema, 6 statuses CHECK including `failed_to_start`, `workflow_run_id` column already present, Edge Config wrapper at `lib/edge-config/index.ts` orphaned awaiting Phase 2)
- `CLAUDE.md` (project root) — locked stack, top 5 pitfalls, code style + conventions, GSD workflow defaults, "service-layer funnel" + "freeze workflow shape after Phase 2" + "hooks resume in-process" architectural commitments
- `scope_hackathon_mvp.md` — original scope reference (§5 MCP server, §6 WDK workflow, §11 hardening — pseudocode has stack errors; defer to STACK.md when in conflict)

### Stack & architecture (locked)
- `.planning/research/STACK.md` §"Highest-risk integration snippets" §1 (WDK workflow with `using hook = createHook(...)` + `Promise.race([hook, sleep("Xm")])` — exact compiling pattern), §2 (MCP server with `withMcpAuth` + `mcp-handler@1.1.0`), §3 (Upstash Redis pub/sub for SSE — NOT BLPOP), §6 (Edge Config reads via `@vercel/edge-config`); also the "What NOT to Use" table
- `.planning/research/ARCHITECTURE.md` Pattern 1 (service-layer funnel — exact `createReservation` shape with compensating action), Pattern 2 (hook-resume in-process via direct import), Pattern 3 (SSE handler = subscribe + replay-on-connect — exact ReadableStream shape), Pattern 4 (cookie strategy — D-28 here), Pattern 5 (Edge Config inside steps); Critical Journeys 1–4; Anti-Patterns 1–6 (especially #1 HTTP self-call, #3 trusting pub/sub alone, #4 cookie-after-first-byte)
- `.planning/research/SUMMARY.md` §3 (5 architectural commitments — all 5 in scope for Phase 2), §5 "Phase 2 — Backend Core" (collapse rationale + spike flags), §6 (top-5 pitfalls — items 2/3/5 are pure Phase 2, item 4 was Phase 1 done, item 1 enforced by Phase 3), §7 (open questions: items 1+2 = the two Phase 2 spikes; item 3 = MCP-from-chat decision DECIDED in D-36 above)
- `.planning/research/PITFALLS.md`:
  - #1 (steps discipline — workflow function is a router) — D-11, D-16
  - #2 (waitForEvent race + DB safety net) — D-10, D-15 spike B
  - #3 (serializable step inputs/outputs) — D-12
  - #4 (freeze workflow shape after this phase) — D-11, D-17
  - #5 (MCP tool poisoning — server resolves reservation_id from session_token; LLM never passes IDs for actions) — D-03, D-06
  - #7 (KV pub/sub patterns + abort cleanup) — D-20, D-26
  - #9 (Zod `.passthrough()` not `.strict()`; coerce numerics; safeParse with structured errors) — D-05
  - #14 (Edge Config inside steps; sample once and store on the row) — D-13
  - #15 (PII logging helper from day one) — D-21, D-22, D-23
  - #16 (no fake-success — tool error contract) — D-04
  - #19 (push to prod every phase) — D-34
  - #20 (build seed script EARLY, use as default dev fixture) — D-32

### Phase 1 code Phase 2 reuses or extends
- `lib/env.ts` — `MCP_API_KEY` already validated (Phase 1 D-19) — used by `lib/mcp/auth.ts → verifyBearer`
- `lib/db/neon.ts` — pooled Neon HTTP client; used by `lib/services/*` (D-19)
- `lib/db/pool.ts` — `pg.Pool` used by Auth.js adapter only; service layer does NOT use this
- `lib/edge-config/index.ts` — typed `getConfig()` / `getTypedConfig()` from Phase 1; first consumers land in Phase 2 workflow steps (D-13)
- `lib/auth/auth.ts` + `lib/auth/auth.config.ts` — `auth()` helper for staff API endpoints (D-30) and `/api/events/queue` SSE auth (D-29)
- `db/migrations/0001_init.sql` — base schema (reservations, reservation_events, employees with `workflow_run_id` and `failed_to_start` already in CHECK)
- `db/migrations/0002_workflow_active_hook.sql` — NEW Phase 2 migration; adds `active_hook_token TEXT NULL` (D-09)
- `scripts/db-migrate.ts` — handles 0002 via existing `_migrations` tracking
- `scripts/seed-maitre.ts` — pattern to copy for `scripts/seed-demo.ts`
- `scripts/smoke-test-kv.ts` — pattern to copy for `scripts/smoke-test-mcp.sh` and `scripts/smoke-money-shot.sh`

### External docs (downstream agents may need to fetch)
- Vercel Workflow concepts: https://vercel.com/docs/workflow
- Workflow SDK foundations (hooks, sleep, Promise.race): https://workflow-sdk.dev/docs/foundations/hooks + https://workflow-sdk.dev/docs/foundations/sleep
- Workflow SDK starting workflows (`start()` API + `Run` object): https://workflow-sdk.dev/docs/foundations/starting-workflows
- mcp-handler v1.1.0 release notes + `withMcpAuth` API: https://github.com/vercel/mcp-handler/releases/tag/v1.1.0
- Vercel MCP deploy + `app/[transport]/route.ts` template: https://vercel.com/docs/mcp/deploy-mcp-servers-to-vercel
- Upstash Redis pub/sub (SSE under the hood): https://upstash.com/docs/redis/sdks/ts/commands/pubsub/subscribe
- Vercel Skew Protection (D-17 prerequisite): https://vercel.com/docs/skew-protection
- Vercel Skew Protection enabled-by-default-for-new-projects changelog: https://vercel.com/changelog/skew-protection-is-now-enabled-by-default-for-new-projects
- Vercel Function `maxDuration` (300s Hobby, 800s Pro Fluid): https://vercel.com/docs/functions/configuring-functions/duration
- Vercel Edge Config docs (P99 < 15ms reads): https://vercel.com/docs/edge-config
- TypeScript `using` keyword (TS 5.2+ explicit resource management; D-15 spike A): https://devblogs.microsoft.com/typescript/announcing-typescript-5-2/#using-declarations-and-explicit-resource-management

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets (from Phase 1)
- **`lib/env.ts`** — `@t3-oss/env-nextjs` + Zod schemas. `MCP_API_KEY` is already in the validated server schema. Phase 2 does not need to add new env vars (all 11 are present in all 3 Vercel envs per Phase 1 verification).
- **`lib/db/neon.ts`** — exports `sql = neon(DATABASE_URL)` template tag. The single DB client for service layer + workflow steps + SSE snapshot reads.
- **`lib/db/pool.ts`** — exports `pg.Pool` with `max=5`. Used by `@auth/pg-adapter` only; service layer does NOT touch this. (Two-clients pattern verified at 441ms wall under 10+10 parallel in Phase 1 D-28.)
- **`lib/edge-config/index.ts`** — exports `getConfig<K>()` and `getTypedConfig()`. Currently orphaned (no consumers). Phase 2 workflow steps are the first consumers (D-13).
- **`lib/auth/auth.ts`** — exports `auth()` helper + `signIn` callback (D-09 employees gate) + session callback (D-11 re-validate). Service layer staff functions and SSE staff handler reuse `auth()` for gating.
- **`lib/auth/auth.config.ts`** — Edge-safe; consumed by `proxy.ts` only. Phase 2 SSE handlers run in `runtime = "nodejs"` (D-26) so they import the full `lib/auth/auth.ts`.
- **`db/migrations/0001_init.sql`** — already has the `reservations` table with `workflow_run_id TEXT`, `session_token UUID UNIQUE`, `extension_count INTEGER NOT NULL DEFAULT 0`, `no_show_deadline TIMESTAMPTZ`, `called_at TIMESTAMPTZ`, `ended_at TIMESTAMPTZ`, and the 6-status CHECK constraint including `failed_to_start`. **Only one new column needed in Phase 2:** `active_hook_token TEXT NULL` via `0002_workflow_active_hook.sql` (D-09).
- **`scripts/db-migrate.ts`** — transactional migration runner with `_migrations` tracking. Handles the new 0002 migration unchanged.
- **`scripts/seed-maitre.ts`** — exact pattern to copy for `seed-demo.ts` (idempotent ON CONFLICT upsert).
- **`scripts/smoke-test-kv.ts`** — exact pattern for `Redis.fromEnv()` + ping/set/get/del. Phase 2's `lib/realtime.ts` reuses `Redis.fromEnv()` exactly.
- **`scripts/check-env-sync.sh`** — already enforces `lib/env.ts` ↔ `.env.example` parity; Phase 2 does not change this.
- **shadcn/ui Button + Input** in `components/ui/` — NOT used by Phase 2 (no UI work this phase); kept for Phase 3.

### Established Patterns (from Phase 1)
- **Spanish for user-facing copy, English for code/comments, no comments unless WHY is non-obvious** (CLAUDE.md, applied throughout Phase 1; preserved in Phase 2).
- **Forward-only SQL migrations in `db/migrations/NNNN_<name>.sql`** with `_migrations` tracking (Phase 1 D-01, D-02). Phase 2 adds `0002_workflow_active_hook.sql`.
- **TS scripts run via `tsx`** (`npm run db:migrate`, `npm run seed:maitre`, etc.). Phase 2 adds `npm run seed:demo`, `npm run smoke:mcp`, `npm run smoke:money-shot`.
- **Anti-enum copy on auth pages** (Phase 1 D-10) — same security-by-obscurity discipline informs MCP tool error messages: tool returns `INVALID_SESSION` whether the header is missing OR the session does not match (don't leak existence).
- **Pooled `DATABASE_URL` for app, non-pooled `DATABASE_URL_UNPOOLED` for migrations** (Pitfall #13, Phase 1 D-03). Phase 2 service layer + workflow steps use pooled.
- **Auto-deploy via `git push origin main`** (Phase 1 D-13 verified — 4 prod deploys observed). Phase 2 inherits and exercises.
- **Re-export pattern for Auth.js handlers** (Phase 1 deviation #1 in 01-VERIFICATION) — use `import { handlers }; export const { GET, POST } = handlers` instead of `export { GET, POST } from "@/lib/auth/auth"`. Phase 2 staff API endpoints can use either; consistency-with-Phase-1 says re-export.

### Integration Points
- **MCP route lands at `app/mcp/[transport]/route.ts`** — new route this phase per `mcp-handler` convention. Public-facing; gated by `MCP_API_KEY` bearer (D-01).
- **Staff action API at `app/api/queue/[id]/{call,seated,no_show_manual}/route.ts`** — auth-gated by `auth()` (D-30). Imported directly in Phase 3 panel.
- **SSE handlers at `app/api/events/[reservation_id]/route.ts` and `app/api/events/queue/route.ts`** — first SSE consumers (Phase 1 had no streaming routes).
- **Workflow lifecycle at `lib/workflows/reservation.ts`** — single new file (D-11). `next.config.ts` must add `withWorkflow(...)` wrapper (per STACK §Installation) — currently NOT wrapped (Phase 1 verification shows minimal `next.config.ts`). Phase 2 plan must add this AND verify the `tsconfig.json` `plugins: [{name:"workflow"}]` is set (per STACK.md tsconfig snippet).
- **PII redactor at `lib/log.ts`** — first sink for structured logs. Replaces every `console.log` in `lib/services/*` + `lib/workflows/*` + MCP tool handlers + SSE handlers + new staff API endpoints.
- **Realtime publisher at `lib/realtime.ts`** — wraps `Redis.fromEnv()`; service layer + workflow steps publish through it; SSE handlers subscribe directly.

</code_context>

<specifics>
## Specific Ideas

- **The money-shot rehearsal is non-negotiable at end of Phase 2.** Discovering it broken with 5 days left = fixable; discovering it broken in Phase 4 = project killer. The automated `scripts/smoke-money-shot.sh` is what unblocks Phase 3 — Phase 3 cannot start until this passes against production.
- **The DB-backed safety net (D-10) is the single largest Pitfall mitigation in Phase 2.** Without it, the demo can flop on a single hook race. The two spikes (D-15) inform whether it's mandatory or belt-only, but ship it either way.
- **`lib/workflows/_README.md` is a living architectural contract** — every commitment that affects workflow durability gets a note here BEFORE the code that enforces it lands. After Phase 2 ships, this README is the rulebook for "what's safe to change in `reservation.ts`."
- **Edge Config keys seeded in Phase 1 are the ONLY values Phase 2 reads.** Don't add new keys this phase — Phase 3 may add for chatbot/panel concerns. The 6 keys: `no_show_timeout_min`, `followup_after_call_min`, `extension_min`, `max_extensions_per_ticket`, `eta_recompute_interval_sec`, `colors_by_party_size`.
- **Skew Protection enable-check is a hard gate** at the top of `/gsd-execute-phase 2`. Plan-phase agent surfaces it; executor halts if not confirmed by the user. Money-shot demo physically cannot work without it.
- **Spanish-friendly tool error messages** must align with SAFE-03's "empathic and recoverable" tone. Examples: `MAX_EXTENSIONS_REACHED.message = "Ya pediste todas las extensiones disponibles. Si necesitás más tiempo, hablá con el maître al llegar."` — recoverable, not punitive.
- **The `recompute_eta` step uses the deterministic formula in Phase 2** (position × avg_turnover_min from Edge Config). Phase 3 wraps the SAME step body in `@workflow/ai/agent` if the DurableAgent gives visibly better ETAs in dry-run; if not, the formula stays and we still wrap it for Track 2 narrative. Step BODY changes are safe per Pitfall #4 (D-11 freeze rule explicitly allows this).
- **All staff action API endpoints land in Phase 2** (not Phase 3) so the workflow is exercised end-to-end with auth-gated curl during Phase 2 development. Phase 3's panel just calls the same endpoints.
- **Public MCP endpoint is THE attack surface** for the pilot. Per-tool `session_token` validation (D-03, D-06) is the line between "pilot ships" and "pilot dies on a tool poisoning incident." This is enforced at the FIRST line of every action tool, code-reviewed before merge.

</specifics>

<deferred>
## Deferred Ideas

These came up while scoping Phase 2 but belong elsewhere or post-v1:

- **`/api/chat` route + chatbot UI + system prompt + tool-call lifecycle** — Phase 3. The decision in D-36 (call services directly, not via `experimental_createMCPClient`) locks the boundary now so Phase 3 inherits a clear contract.
- **Maître panel UI / queue cards / Llamar+Marcar presentado UI / `/queue/history`** — Phase 3. The staff action API endpoints land in Phase 2 (D-30) so the workflow is testable; the panel that calls them lands in Phase 3.
- **DurableAgent ETA estimator** — Phase 3 with cap-at-4h fallback to deterministic formula. Phase 2 ships the formula inside the workflow's `recompute_eta` step body; Phase 3 wraps it (or replaces it) in `@workflow/ai/agent`.
- **STAFF-09 maître undo no_show** — Phase 3 with the panel (panel needs the affordance; the underlying state transition is just another hook resume). On the cut list (#3 in PROJECT.md cut order).
- **Rate limit (5 req/min per IP) on `create_reservation`** — Phase 4 (PILOT-readiness). Uses KV counter; pattern documented in scope §11.
- **Idempotency dedup key on `create_reservation`** — Phase 4. Hash of `email + party_size + 30s window` in KV with 30s TTL plus a unique partial index `(email, status) WHERE status='waiting'` as belt-and-suspenders.
- **`/api/health` endpoint** — Phase 4. Pings DB + KV + Edge Config; returns 200/503; consumed by external uptime monitor + Slack/Discord webhook on workflow failure.
- **Slack/Discord webhook on workflow failure** — Phase 4. Workflow top-level try/catch writes `reservation_events(event_type='workflow_failed')` AND POSTs to webhook.
- **AI SDK telemetry routing through `redactPII`** — Phase 3 when chatbot lands. `lib/log.ts` is built in Phase 2 (D-21) and ready; the wiring point is the `experimental_telemetry` config + tool-call lifecycle hooks in `/api/chat`.
- **Pino or other structured logger replacing pure-JSON `console.log`** — post-pilot. Phase 2 ships pure JSON; if log volume becomes painful, swap the internals of `lib/log.ts` without changing the public API.
- **ESLint custom rule for raw `console.*`** — would be ideal but writing a custom rule takes time; Phase 2 falls back to a CI grep step or a pre-commit hook scanning for `console\.(log|warn|error)\(` outside `lib/log.ts`. Real ESLint rule is post-pilot polish.
- **Multi-restaurant / multi-tenant scoping** — out of scope per PROJECT.md (post-hackathon).
- **WhatsApp adapter consuming the MCP server** — out of scope per PROJECT.md (post-hackathon). The MCP boundary IS the future-proofing for this; D-36 keeps the MCP as the public interface for future clients while Phase 3's `/api/chat` calls services directly.

### Reviewed Todos (not folded)
None — todo matcher returned 0 matches for Phase 2.

</deferred>

---

*Phase: 02-backend-core*
*Context gathered: 2026-04-26*
