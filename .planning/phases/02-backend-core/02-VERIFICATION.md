---
phase: 02-backend-core
verified: 2026-04-26
status: human_needed
must_haves_total: 5
must_haves_verified: 4
score: 4/5
---

# Phase 2: Backend Core — Verification Report

**Phase Goal:** Any client (chatbot, future WhatsApp, curl) can create a reservation, extend, cancel, or query its status via the MCP server. The reservation's lifecycle is orchestrated by a durable WDK workflow that survives a deploy mid-flight (the money shot). Workflow shape is FROZEN at the end of this phase — only step bodies may change after.

**Verified:** 2026-04-26T12:21:55Z
**Status:** human_needed (4/5 verifiable from code; 1 success criterion requires live deploy rehearsal)
**Re-verification:** No — initial verification

## Summary

Phase 2 is shipped, well-architected, and substantially honors every architectural commitment from `02-CONTEXT.md` (D-01..D-37) and `02-RESEARCH.md`. The workflow uses the correct `defineHook(...).create({token})` + `Promise.race(hook, sleep(...))` pattern (NOT the broken `hook.waitFor` API the prior session shipped). Service-layer funnel, in-process `resumeHook`, snapshot-replay-on-connect SSE, PII redactor, and the 4-tool MCP server with bearer + session-token gating all check out at code level. One critical bug in `scripts/smoke-money-shot.sh` (and `scripts/smoke-test-mcp.sh`) — confirmed via grep simulation — means the money-shot smoke test cannot pass until the regex is fixed. The live money-shot rehearsal also requires Skew Protection (B2) toggled in the dashboard, which the user owns.

## Phase 2 Success Criteria

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | curl + Bearer creates reservation; all 4 tools work; reject without bearer OR session header | PASS (code) / HUMAN (live curl) | `app/mcp/[transport]/route.ts:103-220` registers 4 tools (`create_reservation` L109, `get_reservation_status` L134, `extend_wait` L161, `cancel_reservation` L188); `withMcpAuth(mcpHandler, verifyBearer, { required: true })` at L225; `lib/mcp/auth.ts:43-51` uses `timingSafeEqual` constant-time comparison; action tools return `INVALID_SESSION` via `invalidSessionResponse()` L75-91 when `X-Reservation-Session` header missing/malformed |
| 2 | Workflow visibly progresses waiting → called → seated\|no_show\|cancelled (verifiable via dashboard + reservation_events + reservations.status) | PASS | `lib/workflows/reservation.ts:469-788` implements 3-phase router (Phase 1 WAITING L489-549, Phase 2 :called:pre L551-660, Phase 3 :called:final L662-787); 10 `"use step"` functions; 5 typed hooks (L41-49); `applyCallTransition` L224-290 writes `status='called'` + inserts `workflow_called` event; `acknowledgeTerminal` L404-434 inserts `workflow_terminal` for seated/cancelled; `applyNoShowTransition` L345-397 inserts `workflow_no_show` |
| 3 | Money-shot smoke test passes (script exists; live run deferred per Skew Protection) | FAIL (script blocked by regex bug) / HUMAN (live rehearsal) | `scripts/smoke-money-shot.sh` exists (L1-265); CR-01 in `02-REVIEW.md`: regex `extract_inner_field` at L99-103 fails to match JSON-escaped `\"reservation_id\":\"…\"` payload from MCP envelope. Confirmed via grep simulation against realistic envelope — extracts empty string. `--dry-run` exits with "ERROR: create_reservation returned no reservation_id/session_token" before reaching deploy step. **Script must be fixed before this gate can pass.** Live rehearsal also requires Skew Protection (B2) toggled — user owns. |
| 4 | seed-demo.ts populates 3 reservations in distinct states (waiting, called, seated) | PASS | `scripts/seed-demo.ts:69-154` calls real `createReservation` (L80-86, L97-103, L120-126), then `markCalled` (L107, L131), then `markSeated` (L137); idempotent via `clearDemoRows` L45-67 (DELETE WHERE email LIKE 'demo%@example.test'); wired in `package.json:16` (`seed:demo`) and `package.json:19` (`dev:reset` composite); honors D-32 |
| 5 | Workflow steps publish to KV pub/sub; SSE handlers emit Postgres snapshot then live KV events | PASS | `lib/realtime.ts:31-52` publishes to `reservation:<id>` and `queue:active` channels (D-24); `app/api/events/[reservation_id]/route.ts:127-225` does Pattern 3 (snapshot L127-170, replay L178-206, subscribe L212-225); `app/api/events/queue/route.ts:90-156` mirrors the pattern; `redis.subscribe()` confirmed at both L212 and L145; both SSE handlers have `maxDuration = 800` (L28/L29), 25s heartbeat (L236/L163), `req.signal` abort cleanup with `sub.unsubscribe()` (L248-264, L172-187). 9 service-layer + workflow `publishReservationEvent` / `publishQueueEvent` calls confirmed. |

**Score:** 4/5 verifiable PASS — criterion 3 has a confirmed code bug (CR-01) that fails the script + an externally-gated live rehearsal.

## Requirement Traceability

| Requirement | Description | Status | Evidence |
|-------------|-------------|--------|----------|
| PLAT-01 | Service-layer funnel + active-queue contract | SATISFIED | `lib/services/reservations.ts` (4 functions: createReservation L123, getReservationStatus L298, extendWait L352, cancelReservation L482); `lib/services/queue.ts` (4 functions: getActiveQueue L53, markCalled L107, markSeated L194, markNoShowManual L279); all routes are 5-15 LOC wrappers (`app/api/queue/route.ts:24-57`, `app/api/queue/[id]/{call,seated,no_show_manual}/route.ts`); MCP tools also wrap services (`app/mcp/[transport]/route.ts:117-209`) |
| PLAT-02 | MCP bearer + per-tool session_token gating; LLM never passes reservation_id | SATISFIED | `withMcpAuth(...required:true)` `app/mcp/[transport]/route.ts:225`; `verifyBearer` constant-time at `lib/mcp/auth.ts:43-51`; action tools (`get_reservation_status` L142, `extend_wait` L169, `cancel_reservation` L196) call `resolveSession(readSessionHeader(extra))` BEFORE service dispatch; action input schema is `z.object({}).passthrough()` L53 — zero LLM-visible identity params (Pitfall #5 mitigated). `create_reservation` L109 is the only diner-identity tool. |
| PLAT-03 | WDK durable workflow with createHook+Promise.race (no waitForEvent); shape FROZEN | SATISFIED | `lib/workflows/reservation.ts:20` imports `defineHook, sleep` from `workflow`; 5 typed hooks L41-49; all hook usage uses `.create({token})` form (verified: L502, L505, L569, L572, L575, L578, L581, L706, L709, L712, L715); `Promise.race` at L509, L585, L719; **zero `waitForEvent` or `hook.waitFor` references in lib/ or app/** (broken API from prior session has been excised); `lib/workflows/_README.md:1-3` declares freeze; "Shape History" L342-348 records initial 10-step lock; `next.config.ts:6` wraps with `withWorkflow`; `tsconfig.json:21` registers `{name:"workflow"}` plugin; `db/migrations/0002_workflow_active_hook.sql:9` adds `active_hook_token` column |
| PLAT-05 | Upstash pub/sub (real, no BLPOP); channels reservation:<id> + queue:active | SATISFIED | `lib/realtime.ts:7,10` `Redis.fromEnv()`; `redis.publish('reservation:${id}', …)` L35; `redis.publish('queue:active', …)` L47; `redis.subscribe()` (NOT BLPOP) at `app/api/events/[reservation_id]/route.ts:212` and `app/api/events/queue/route.ts:145`; auto-deserialization handled per Upstash docs (no double-JSON.parse) |
| PLAT-07 | SSE handlers with snapshot-replay-on-connect + heartbeat 25s + maxDuration 800 | SATISFIED | Both `/api/events/[reservation_id]` and `/api/events/queue` set `runtime = "nodejs"`, `maxDuration = 800`, `dynamic = "force-dynamic"`; emit `event: snapshot` first (`app/api/events/[reservation_id]/route.ts:157-170`, `app/api/events/queue/route.ts:101-109`); replay missed `reservation_events` on Last-Event-ID (L178-206, L116-140); subscribe to KV after; 25s `: hb\n\n` heartbeat (L236, L163); abort cleanup with `clearInterval(hb)` + `sub.unsubscribe()` + `controller.close()` (L248-264, L172-187) |
| SAFE-01 | lib/log.ts PII redactor used everywhere; no raw console.* | SATISFIED | `lib/log.ts:7-99` redactPII walks objects, masks PII keys (`name`, `email`, `phone`, `full_name`, `phone_number` + dot-notation paths), value-level email/phone regex masking; `log.info/warn/error` at L126-158; **grep confirms zero `console.*` calls outside `lib/log.ts`** in `lib/services/`, `lib/workflows/`, `lib/realtime.ts`, `lib/mcp/`, `app/api/`, `app/mcp/`; `__tests__/log-redact.test.ts` (7 cases) all PASS via `npx tsx --test` (verified) |
| DEMO-04 | seed-demo.ts populates 3-state fixture; npm run dev:reset | SATISFIED | `scripts/seed-demo.ts:69-154` (3 reservations in waiting/called/seated); `package.json:16-19` (`seed:demo`, `dev:reset`); script idempotent + uses real service layer (D-32) — workflows are LIVE every dev session |

**All 7 Phase 2 requirements: SATISFIED.**

No orphaned requirements found — REQUIREMENTS.md `Phase 2` mapping (PLAT-01, PLAT-02, PLAT-03, PLAT-05, PLAT-07, SAFE-01, DEMO-04) matches plan-frontmatter coverage 1:1.

## Pitfalls Honored

Pitfalls relevant to Phase 2, with verification:

- **#1 Side effects outside `"use step"` (router-level forbidden ops)** — HONORED. `awk` over `reservationWorkflow` body L469-788 grep'd for `Date.now|crypto\.randomUUID|Math\.random|fetch\(|sql\`|redis\.publish|getTypedConfig` returns ZERO hits. All 13 SQL/Date.now/Edge-Config calls are inside the 10 step functions (each declared with `"use step";`).
- **#2 Event race + DB-backed safety net (D-10)** — HONORED. Every service mutation (`markCalled`, `markSeated`, `markNoShowManual`, `extendWait`, `cancelReservation`) inserts `reservation_events` BEFORE `resumeHook` (5 INSERT-then-resumeHook sequences confirmed at `lib/services/reservations.ts:425-445`, L527-543, `lib/services/queue.ts:153-167`, L235-249, L320-336). Workflow timeout branches re-query missed events via `fetchMissedEvents` (`lib/workflows/reservation.ts:182-212` step), called from all 4 timeout branches (L533, L625, L675, L756).
- **#3 Plain-JSON step inputs/outputs** — HONORED. All 10 step return types are interfaces of plain primitives + ISO strings (e.g., `MarkCalledResult` L218-222, `ReservationSnapshot` L58-68); TIMESTAMPTZ projected via `::text` (L80-82, L241-242, L290-291, etc.); no Date/Map/Set/Buffer in step boundaries.
- **#4 Freeze workflow shape after Phase 2** — HONORED in code AND in docs. `lib/workflows/_README.md:1-3` is explicit; "Shape History" L342-348 records the freeze. 10-step inventory in README L304-316 matches actual code (loadReservationSnapshot, setActiveHookToken, loadEdgeConfigSnapshot, fetchMissedEvents, applyCallTransition, emitFollowupPush, reloadDeadlineAfterExtend, applyNoShowTransition, acknowledgeTerminal, computeRemainingSeconds).
- **#5 MCP tool poisoning** — HONORED. Action tool input schema is `z.object({}).passthrough()` (`app/mcp/[transport]/route.ts:53`); reservation identity is resolved server-side via `resolveSession(readSessionHeader(extra))` (`lib/mcp/auth.ts:91-128`). LLM has zero ability to specify a `reservation_id` for action tools.
- **#6 SSE Last-Event-ID resumability** — PARTIALLY HONORED. Last-Event-ID parsing + replay logic shipped (both routes); however, see WR-02/WR-06 below — `reservation.created` events are not inserted into `reservation_events`, so the create event has no stable id for resumability. Subscribe-after-snapshot gap (WR-05) means a small race window exists.
- **#7 KV abort cleanup** — HONORED. `req.signal.addEventListener('abort', …)` in both SSE routes (L248, L172) calls `clearInterval(hb)` + `sub.unsubscribe()` + `controller.close()`.
- **#9 Zod `.passthrough()` + safeParse + coerce** — HONORED. `createReservationSchema` uses `.passthrough()` + `z.coerce.number()` (`app/mcp/[transport]/route.ts:40-47`, `lib/services/reservations.ts:52-59`); `safeParse` used (L126, L301, L355, L485). Action schema is empty `.passthrough()` per D-03.
- **#10 No cookie-during-streaming** — HONORED. Diner SSE auth uses `?session_token=` query param (`app/api/events/[reservation_id]/route.ts:73`), NOT `Set-Cookie`. Per D-28 trade-off documented.
- **#13 Pooled vs non-pooled DB clients** — HONORED. Service layer + workflow steps use `lib/db/neon.ts` (HTTP); Auth.js uses `lib/db/pool.ts` (`pg.Pool`); inherited from Phase 1.
- **#14 Edge Config inside steps; sample-once-and-store** — HONORED. `loadEdgeConfigSnapshot` is a `"use step"` (`lib/workflows/reservation.ts:141-163`); `applyCallTransition` writes `no_show_deadline = NOW() + interval` ONCE with `COALESCE` to make idempotent (L234-237).
- **#15 PII helper from day one** — HONORED. `lib/log.ts` shipped Wave 1 of Phase 2 (plan 02-02); used by every service function, workflow step, MCP route, SSE route, staff API endpoint. `__tests__/log-redact.test.ts` 7/7 pass.
- **#16 No fake-success — structured tool error contract** — HONORED. ServiceResult shape `{ ok: true, data } | { ok: false, error: { code, message, fields? } }` (`lib/services/reservations.ts:29-47`); MCP tool returns JSON.stringify(result) as text content (`app/mcp/[transport]/route.ts:95-101`). 8 distinct error codes. Phase 3 confirmation badge will read `result.ok && result.data.reservation_id`.
- **#19 Push to prod every phase** — INHERITED from Phase 1 auto-deploy; live verification deferred (HUMAN — money-shot rehearsal).
- **#20 Seed script as default dev fixture** — HONORED. `scripts/seed-demo.ts` calls real services; `npm run dev:reset` composite ships in package.json.

Pitfalls #8 (streamText), #11 (Resend), #12 (Auth.js split), #17 (demo recording), #18 (env vars), #21 (Spanish edge inputs), #22 (monitoring) are out of Phase 2 scope.

## Code Review Integration

The 02-REVIEW.md identifies 1 critical + 7 warnings + 9 info. Severity-tiered impact on Phase 2 verdict:

### Critical (BLOCKING success criterion 3)

- **CR-01:** `extract_inner_field` regex in `scripts/smoke-money-shot.sh:99-103` and `scripts/smoke-test-mcp.sh:93-99` cannot match JSON-escaped `\"reservation_id\":\"…\"` payload returned by mcp-handler. **Confirmed via grep simulation** against a realistic JSON-RPC envelope — extracts empty string. The `--dry-run` invocation exits with "ERROR: create_reservation returned no reservation_id/session_token" before ever reaching the deploy step. The smoke-test-mcp.sh path is partially salvageable (positive `ok:true` matching is broader at L124, L168, L184), but step 4 ("with session" test) and step 5 (cancel via session) are SKIP/FAIL because `SESSION_TOKEN` is empty. **This blocks success criterion 3** until fixed via either `jq` adoption (preferred) or `sed 's/\\"/"/g'` pre-pass.

### Warnings (non-blocking but real, fold into Phase 2 polish)

- **WR-01:** PII redactor `MAX_DEPTH = 4` lets depth-5 nested PII slip through (test at `__tests__/log-redact.test.ts:49-64` codifies the leak as expected behavior); dot-notation `payload.email` entries in `PII_KEYS` are dead code.
- **WR-02:** `reservation.created` events lack a stable `id` for Last-Event-ID resumability (no `reservation_events` row inserted at create); queue-event publishes also miss `id` even when per-reservation publishes have one.
- **WR-03:** Race window ~50-500ms between service-layer `markCalled` (status='called', `no_show_deadline=NULL`) and workflow's `applyCallTransition` writing the deadline. SSE clients can briefly see `status='called', no_show_deadline=null`. Self-heals via `workflow_called` follow-up event.
- **WR-04:** Misleading comment in `app/api/events/[reservation_id]/route.ts:9-12` claims `lib/log.ts` redacts `session_token` from query strings — it does NOT (`session_token` is not in `PII_KEYS` and the redactor doesn't parse URLs).
- **WR-05:** Subscribe-after-snapshot gap in both SSE handlers; events published between snapshot SELECT and `redis.subscribe` may be lost from the live channel. No server-side dedup against `lastEventId` in the live subscriber.
- **WR-06:** No `reservation_events` row inserted on `createReservation`, breaking audit-log symmetry; the staff queue SSE replay cannot replay create events.
- **WR-07:** `tsconfig.json:3` target is ES2017 but `using` keyword is ES2023; spike A passed via `tsx` but production lowering is unverified. Mitigated because the actual workflow does NOT use `using` — the README's claim it does (L201) is inconsistent with reality (IN-08).

### Info (already documented; no action this phase)

IN-01 (event_type CHECK constraint), IN-02 (`employee_email` log key not in PII_KEYS), IN-03 (`console.error` for level=error), IN-04 (loose UUID regex), IN-05 (Spanish copy in services), IN-06 (defensive Math.max for Edge Config), IN-07 (orphan workflow runs after seed reset), IN-08 (README inconsistent with code on `using`), IN-09 (diner SSE may miss create event).

### Additional findings from this verification

- **Lint error in `lib/workflows/reservation.ts:487`** — `prefer-const` for `currentStatus` (variable never reassigned). `npm run lint` exits non-zero. Cosmetic but means CI won't pass cleanly.
- **TypeScript error in `__tests__/log-redact.test.ts:10`** — `import "../lib/log.ts"` includes the `.ts` extension which fails strict tsc check (`error TS5097`). Tests run fine via `tsx --test` (which is more permissive). Fix: drop the `.ts` extension or set `allowImportingTsExtensions`.

## Gaps

The following items must close to declare Phase 2 fully complete:

1. **CR-01 smoke-test regex bug.** Both `scripts/smoke-test-mcp.sh:93-99` and `scripts/smoke-money-shot.sh:99-103` cannot extract `reservation_id` / `session_token` from the MCP JSON-RPC envelope. Fix with either jq adoption or `sed 's/\\"/"/g'` unescape pre-pass; add a self-test fixture at the top of each script that fails-fast if the extractor returns empty. **This directly blocks ROADMAP success criterion 3.**

2. **Lint failure (`prefer-const` in `reservation.ts:487`)** — change `let currentStatus` to `const currentStatus`. One-line fix; required for CI.

3. **TypeScript test import (`__tests__/log-redact.test.ts:10`)** — drop the `.ts` extension on the import path or add `allowImportingTsExtensions: true` to tsconfig. One-line fix.

These three are mechanical fixes; closing them takes <30 minutes. They are not architectural problems.

The 7 warnings (WR-01..WR-07) from 02-REVIEW.md are real but non-blocking — they describe latent risks (depth-cap leak, race windows, audit asymmetry) that don't prevent the phase goal from being achieved. They should land in Phase 2 polish OR be tracked as Phase 4 hardening items.

## Human Verification Required

These cannot be verified from code alone:

### 1. Live MCP curl against production deploy

**Test:** From a fresh terminal, run `BASE_URL=https://zero-to-agent-xi.vercel.app bash scripts/smoke-test-mcp.sh` AFTER the regex fix from CR-01 has been applied.
**Expected:** All 5 checks pass (create_reservation, 2 negative auth checks, get_reservation_status with session, cancel_reservation closes fixture). HTTP 401 if Bearer is invalid; HTTP 200 with `INVALID_SESSION` body if header missing.
**Why human:** Requires production endpoint reachable and a fixed smoke script. The MCP route code is verified correct, but a live HTTP roundtrip can only be confirmed with the deploy + fixed harness.

### 2. Money-shot live rehearsal (success criterion 3 — full proof)

**Test:** With Skew Protection enabled in Vercel dashboard (Project → Settings → Skew Protection → On — D-17 / B2 prerequisite), run `BASE_URL=https://zero-to-agent-xi.vercel.app bash scripts/smoke-money-shot.sh` (after CR-01 fix). When prompted, in another terminal: `git commit --allow-empty -m 'chore: money-shot deploy' && git push origin main`. Wait for Vercel build, press ENTER to begin SSE polling.
**Expected:** Both reservations emit `event: snapshot` within 60s of deploy, proving in-flight workflows survive the deploy.
**Why human:** Requires (a) Skew Protection toggle (user-owned dashboard action), (b) a real prod deploy with `git push`, (c) human confirmation of build completion. Cannot be automated within the verifier's sandbox.

### 3. Workflow visible in Vercel Workflow dashboard

**Test:** After running `npm run seed:demo` against the deployed app, open Vercel Dashboard → Workflows for the project.
**Expected:** 3 workflow runs visible (one per seeded reservation A/B/C), each tracking its lifecycle. Run B should show `applyCallTransition` step completed; run C should show `acknowledgeTerminal('seated')`.
**Why human:** Vercel dashboard rendering is not introspectable from code; requires browser visit.

### 4. Edge Config reads return real values mid-workflow

**Test:** While a reservation is in `waiting` state, change `no_show_timeout_min` in Vercel Edge Config dashboard, then trigger `markCalled`. The `applyCallTransition` step should sample the new value (D-13: sample-once-and-store).
**Expected:** `reservations.no_show_deadline = NOW() + new_timeout_minutes` for that ticket.
**Why human:** Requires dashboard edit + manual workflow exercise.

### 5. KV pub/sub fan-out under two concurrent SSE connections

**Test:** Open `curl -N "https://.../api/events/<reservation_id>?session_token=<token>"` in two terminals; trigger `markCalled` from a third. Both SSE streams should receive `event: reservation.called`.
**Expected:** Both connections see snapshot first, then live `reservation.called` event with matching `id` field.
**Why human:** Multi-connection real-time behavior cannot be verified by static code analysis; needs live infrastructure.

## Verdict

**Status: human_needed** (4/5 success criteria PASS at code level; 1 blocked on a confirmed code bug + live infrastructure gates owned by the user)

**Rationale:**

The phase code is architecturally sound. Every commitment from 02-CONTEXT.md (D-01 through D-37) and 02-RESEARCH.md (Pitfalls #1-#7, #9, #10, #13-#16, #19, #20) is honored at the file-and-line level. The previous session's broken `hook.waitFor` API has been completely excised — the new code uses `defineHook(...).create({token})` + `Promise.race(hook, sleep("..."))` exactly as specified by `02-RESEARCH.md` and CLAUDE.md. The service-layer funnel, in-process `resumeHook`, snapshot-replay-on-connect SSE, PII redactor, the 4-tool MCP server with bearer + session-token gating, and the seed-demo script all check out by direct file inspection. The 7-test SAFE-01 suite passes.

What blocks "passed":

1. **CR-01 (critical, code-level)** — smoke scripts have a regex that cannot parse the MCP JSON-RPC envelope. This is verifiable by static reproduction (done) and means success criterion 3 cannot pass even on dry-run until fixed. Fix is mechanical (~10 min).

2. **Live money-shot rehearsal** is gated on Skew Protection (B2) toggle in the Vercel dashboard — explicitly user-owned per CLAUDE.md and 02-CONTEXT.md D-17. The script exists, the workflow is durable in code, but the proof of "survives deploy mid-flight" requires a real deploy.

3. **Two trivial fixes** (lint `prefer-const`, test import extension) needed for clean CI.

Recommend: fix CR-01 + the two trivial issues, then route the 5 human-verification items above to the user (or to a `/gsd-verify-work` UAT pass) to close out success criterion 3 and confirm live behavior matches code-level guarantees.

---

_Verified: 2026-04-26T12:21:55Z_
_Verifier: Claude (gsd-verifier)_
