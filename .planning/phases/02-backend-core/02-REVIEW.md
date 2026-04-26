---
phase: 02-backend-core
reviewed: 2026-04-26T00:00:00Z
depth: standard
files_reviewed: 24
files_reviewed_list:
  - __tests__/log-redact.test.ts
  - app/api/events/[reservation_id]/route.ts
  - app/api/events/queue/route.ts
  - app/api/queue/[id]/call/route.ts
  - app/api/queue/[id]/no_show_manual/route.ts
  - app/api/queue/[id]/seated/route.ts
  - app/api/queue/route.ts
  - app/mcp/[transport]/route.ts
  - db/migrations/0002_workflow_active_hook.sql
  - lib/log.ts
  - lib/mcp/auth.ts
  - lib/realtime.ts
  - lib/services/queue.ts
  - lib/services/reservations.ts
  - lib/workflows/_README.md
  - lib/workflows/reservation.ts
  - next.config.ts
  - package.json
  - scripts/seed-demo.ts
  - scripts/smoke-money-shot.sh
  - scripts/smoke-test-mcp.sh
  - scripts/spike-hook-buffering.ts
  - scripts/spike-using-keyword.ts
  - tsconfig.json
findings:
  critical: 1
  warning: 7
  info: 9
  total: 17
status: issues_found
---

# Phase 2: Code Review Report

**Reviewed:** 2026-04-26
**Depth:** standard
**Files Reviewed:** 24
**Status:** issues_found

## Summary

Phase 2 is a large, deliberate, and well-documented backend foundation. The architectural commitments from `lib/workflows/_README.md` are visible across the code: the service-layer funnel is consistent, hooks are resumed in-process via `resumeHook(...)` from `workflow/api` (never `fetch()`), MCP action tools accept zero LLM-visible identity (Pitfall #5 enforced), bearer auth uses `timingSafeEqual` (Pitfall — none, this is correct), Zod schemas use `.passthrough()` (Pitfall #9), Next.js 16 dynamic params are awaited consistently, SSE handlers honour the snapshot-replay-on-connect contract (Pitfall #6), and no SSE handler attempts a `Set-Cookie` mid-stream (Pitfall #10).

The single critical finding is a SAFE-01 escape hatch in the smoke-test scripts: bash `grep` patterns that try to extract `reservation_id` / `session_token` from the JSON-RPC envelope will not match the JSON-escaped form returned by mcp-handler. If the smoke tests have been observed to "PASS", they are likely passing on weaker assertions than intended (e.g., HTTP 2xx + empty token still yields no negative branch). This affects `smoke:money-shot` — the Phase 2 gate test for the demo's core value proposition.

The warning-level findings concentrate around (a) PII redactor depth-cap and dot-notation path keys that don't actually match anything (lib/log.ts), (b) `reservation.created` and `reservation.cancelled` events that lack a stable `id` field for SSE Last-Event-ID resumability, (c) a small but observable race window between service-layer `markCalled` setting `status='called'` and the workflow's `applyCallTransition` setting `no_show_deadline` (subscribers see `status=called, no_show_deadline=null` for a few hundred ms), and (d) a couple of comments that overstate the redactor's protection (the "session_token in querystring is mitigated by lib/log.ts" comment in the SSE diner route is incorrect — `session_token` is not in `PII_KEYS`).

Phase 2 is shippable. Address the critical smoke-test bug before relying on `npm run smoke:money-shot` as a gate, and fold the warnings into either Phase 2 polish or a docs commit.

## Critical Issues

### CR-01: `extract_inner_field` regex won't match JSON-escaped fields in MCP envelope

**File:** `scripts/smoke-money-shot.sh:99-103` and `scripts/smoke-test-mcp.sh:93-99`
**Issue:** The MCP `tools/call` response wraps the tool's payload as a JSON-stringified text content block, e.g.

```
{"jsonrpc":"2.0","result":{"content":[{"type":"text","text":"{\"ok\":true,\"data\":{\"reservation_id\":\"abc-…\",\"session_token\":\"xyz-…\"}}"}]}}
```

The grep pattern `"\"${field}\":\"[^\"]*\""` looks for the unescaped form `"reservation_id":"…"`, but the actual bytes on the wire are `\"reservation_id\":\"…\"` (backslash + quote). `grep -oE` against a single-line response will therefore extract nothing for `reservation_id` and `session_token`.

In `smoke-test-mcp.sh`, the script accepts `ok:true` matching either `\\"ok\\":true` OR `"ok":true` (line 124, 168, 184) — so the *positive* tests can still report PASS. But `extract_inner_field` is then used to capture `SESSION_TOKEN`, which silently becomes empty, causing the "with session" path on line 163 to be SKIPped (line 174: `[ -n "${SESSION_TOKEN:-}" ]` is false → fallthrough to FAIL increment). The summary line will print `1 passed, N failed` for what should be a green run.

In `smoke-money-shot.sh`, line 130 does `[ -z "$rid" ] || [ -z "$stoken" ]` and exits non-zero if either is empty — so the money-shot test fails immediately on every run without ever reaching the deploy step. This is a **gate test** for the project's core demo (D-31). If it has passed in CI/manually, that is itself suspicious and worth re-checking.

**Fix:** Either (a) require `jq` for these scripts (one-line `apt install` or `brew install` on hackathon laptops, simpler than escape-aware grep) and use:

```bash
extract_inner_field() {
  local body="$1"
  local field="$2"
  # The tool payload lives in result.content[0].text and is itself a JSON string.
  echo "$body" | jq -r --arg f "$field" '.result.content[0].text | fromjson | (.. | objects | select(has($f))) | .[$f]' \
    | head -1
}
```

or (b) strip backslashes before grepping:

```bash
extract_inner_field() {
  local body="$1"
  local field="$2"
  # Unescape the embedded JSON string before searching.
  echo "$body" | sed 's/\\"/"/g' | grep -oE "\"${field}\":\"[^\"]*\"" | head -1 | cut -d'"' -f4
}
```

Add a self-test at the top of each script that runs `extract_inner_field` against a known fixture and exits non-zero if the result is empty — that single line would have caught this.

## Warnings

### WR-01: PII redactor `MAX_DEPTH = 4` lets nested PII slip through; dot-notation `PII_KEYS` are dead

**File:** `lib/log.ts:7-22, 68-99`
**Issue:** Two related problems in the redactor:

1. **Depth cap leak.** `MAX_DEPTH = 4` returns the raw value when `depth >= 4`. The accompanying test (`__tests__/log-redact.test.ts:49-64`) explicitly asserts that a depth-5 leaf with `{ email: "leak@example.com" }` is **left untouched**. For a SAFE-01 boundary, this is a real risk: any logger envelope that wraps a reservation row in a few layers (e.g., `log.error("ctx", { request: { body: { payload: { email } } } })`) would silently bypass redaction. The current callsites in this codebase do not nest that deeply, so this is latent rather than active — but the test treats the leak as a feature, which makes regression-by-accident more likely as call sites grow.
2. **Dot-notation path entries are dead code.** `PII_KEYS` includes `"payload.name"`, `"payload.email"`, `"payload.phone"`. The actual matcher only compares each individual object key to the lowercased set: `if (PII_KEY_SET.has(keyLower))`. A literal field named `payload.email` is rare; what callers actually emit is `{ payload: { email: "..." } }`, which the matcher handles via the leaf `email` key — but the dot-notation entries do nothing useful and read as if they configured nested-path matching. Misleading.

**Fix:** Raise `MAX_DEPTH` to at least 8 (the redactor cost is bounded by the object size, not the depth alone — 8 is still cheap on real reservation logs), and either remove the dot-notation entries or implement actual nested-path matching:

```typescript
// 1. Bump depth cap.
const MAX_DEPTH = 8;

// 2. Remove dead entries.
export const PII_KEYS: readonly string[] = [
  "name",
  "email",
  "phone",
  "full_name",
  "phone_number",
] as const;
```

Update the depth-cap test to assert that depth-7 PII *is* redacted; keep one assertion at the new boundary for documentation.

### WR-02: `reservation.created` and `reservation.cancelled` KV events lack a stable `id` for Last-Event-ID resumability

**File:** `lib/services/reservations.ts:234-241` (`reservation.created`); `lib/services/reservations.ts:545-557` (`reservation.cancelled` on the diner channel — actually has `id`, see below)
**Issue:** `createReservation` publishes the `reservation.created` event WITHOUT first inserting a row into `reservation_events`, so the published payload has no `id` field (the `ReservationEventPayload.id` is optional). The diner SSE handler at `app/api/events/[reservation_id]/route.ts:216-225` reads `evt.id != null ? String(evt.id) : undefined` and emits `id: …` only when present. For the create event, the SSE frame has no `id:` line, so the client cannot use Last-Event-ID for that event — the snapshot covers the row state, but a client that subscribes mid-create would never see "you were just created" via replay.

This is mostly cosmetic for `reservation.created` (the snapshot replaces it on reconnect), but `cancelReservation` at line 527 DOES insert into `reservation_events` and includes `insertedEvent[0].id` in the publish — so the asymmetry is just create. Same gap exists in `markCalled`/`markSeated`/`markNoShowManual`'s `publishQueueEvent` calls (queue events have no `id` even though the per-reservation event does). The staff SSE replay loop at `app/api/events/queue/route.ts:111-140` re-derives events from `reservation_events`, so this works in practice, but a queue-subscribing client cannot dedupe the live KV stream against the snapshot's `last_event_id`.

**Fix:** Two options:

```typescript
// Option A: Insert a synthetic "create" reservation_event before publish.
const createdEvent = (await sql`
  INSERT INTO reservation_events (reservation_id, event_type, payload)
  VALUES (
    ${reservationId},
    'reservation_created',
    ${JSON.stringify({ occurred_at: occurredAt, party_size, position, eta_min: etaMin })}::jsonb
  )
  RETURNING id
`) as Array<{ id: number }>;

await publishReservationEvent(reservationId, {
  id: createdEvent[0].id,
  type: "reservation.created",
  // ... rest unchanged
});

// Option B: Pass insertedEvent[0].id through to publishQueueEvent everywhere
// it's already passed to publishReservationEvent, so queue subscribers can
// dedupe against last_event_id in the snapshot.
await publishQueueEvent({
  id: insertedEvent[0].id,
  type: "reservation.called",
  // ...
});
```

Recommend doing both. Option B is a one-line change per call site.

### WR-03: Race window between service-layer `markCalled` and workflow's `applyCallTransition` exposes `status='called', no_show_deadline=null`

**File:** `lib/services/queue.ts:142-176` and `lib/workflows/reservation.ts:224-290`
**Issue:** Sequence under a staff "Llamar" click:

1. Service: `UPDATE reservations SET status='called', called_at=NOW()` — `no_show_deadline` is NOT set here.
2. Service: `INSERT INTO reservation_events (… 'call_requested')`.
3. Service: `await resumeHook(token, …)` — fires the hook, returns when the workflow runtime acknowledges the resume (not when the workflow finishes its next step).
4. Service: `publishReservationEvent({ type: 'reservation.called', status: 'called', called_at: occurredAt, … })` — also no `no_show_deadline`.
5. Service: returns 200 to the staff client.
6. Workflow: Phase-1 race resolves, advancedToCalled = true.
7. Workflow: `await loadEdgeConfigSnapshot()` — Edge Config round-trip (~50–200ms).
8. Workflow: `await applyCallTransition(reservationId, no_show_timeout_min)` — finally writes `no_show_deadline = NOW() + interval`.
9. Workflow: `INSERT INTO reservation_events ('workflow_called')` and publishes `reservation.workflow_called`.

For the ~50–500ms between step 4 and step 8, any SSE client that connects (or that already received the step-4 event) sees `status='called', no_show_deadline=null`. The diner UI's "te quedan X minutos" widget would render "te quedan — minutos" briefly. The race is bounded and self-heals on the `workflow_called` follow-up event.

This is unlikely to cause a visible bug for end users, but it's a real ordering issue worth either fixing or documenting:

**Fix (preferred):** Move the `no_show_deadline` write into the service-layer `markCalled` so the row of truth is consistent at the moment the API returns, and let the workflow `applyCallTransition` use `COALESCE(no_show_deadline, NOW() + …)` (which it already does):

```typescript
// lib/services/queue.ts → markCalled:
const noShowTimeoutMin = await getTypedConfig<number>("no_show_timeout_min", 15);
await sql`
  UPDATE reservations
  SET status = 'called',
      called_at = NOW(),
      no_show_deadline = NOW() + (${noShowTimeoutMin} || ' minutes')::interval,
      updated_at = NOW()
  WHERE id = ${reservationId}
`;
```

Then `applyCallTransition`'s `COALESCE(no_show_deadline, NOW() + …)` is a no-op. The workflow still owns the `workflow_called` audit event and the timer; the service layer just commits to the deadline atomically with the status flip. This also eliminates the Edge Config round-trip from the client's perceived latency budget.

**Alternative:** Document this race in `lib/workflows/_README.md` and have the diner UI gracefully render "Calculando…" instead of "—" when `no_show_deadline` is null but `status === 'called'`.

### WR-04: SSE comment claim "session_token redacted by lib/log.ts" is incorrect

**File:** `app/api/events/[reservation_id]/route.ts:9-12`
**Issue:** The header comment says:

> Token in querystring is mitigated by lib/log.ts redacting query string values from emitted log lines.

`lib/log.ts` does no querystring-aware redaction. `redactPII` only matches by leaf key against `PII_KEYS = ["name","email","phone","full_name","phone_number", …]`. `session_token` is not in that set, and the redactor doesn't parse URLs at all. If any code path logs `req.url` (this route does not, but Vercel access logs and the platform's own observability stream do), the `session_token` query parameter is exposed in plaintext.

**Fix:** Either remove the misleading claim from the comment, or actually add session_token redaction. The cheapest correct fix is to add `session_token` to `PII_KEYS`:

```typescript
export const PII_KEYS: readonly string[] = [
  "name",
  "email",
  "phone",
  "full_name",
  "phone_number",
  "session_token",      // SAFE-01: bearer-equivalent for the diner channel
] as const;
```

…and add a value-level mask in `redactString` for any URL-shaped value that contains a `session_token=` query param. Long-term the right answer is to move the token off the querystring (header or POST body) but that's a larger SSE change.

### WR-05: SSE handler subscribes to KV AFTER snapshot+replay; events between snapshot read and `redis.subscribe()` can be missed and not de-duped

**File:** `app/api/events/[reservation_id]/route.ts:127-225` and `app/api/events/queue/route.ts:90-156`
**Issue:** Two related concerns:

1. **Subscribe-after-snapshot gap.** The handler reads `last_event_id` (snapshot), then optionally replays missed rows up to `lastEventId`, then calls `redis.subscribe(...)`. Any event published *between* the snapshot SELECT and the subscribe call is permanently lost from the live channel. The replay window is `(lastEventIdFromClient, lastEventId]`, which does not include rows inserted after the snapshot read. In practice, Postgres → KV publish in the service layer happens within a few ms of each other, but this is a real serializability gap.

2. **No client-side or server-side de-dup against `lastEventId`.** When the live subscriber receives a message with `id <= lastEventId`, the handler forwards it as-is. Clients that respect the SSE `id:` line will deduplicate, but the protocol does not require it (`Last-Event-ID` is purely advisory after the initial connect).

**Fix:**

1. **Re-query after subscribe.** Subscribe first, buffer messages for ~50–100ms, then snapshot+replay, then drain the buffer skipping any `id <= lastEventId`. Cheaper alternative: re-run the missed-events query AFTER subscribe attaches and before unblocking the stream.
2. **Server-side de-dup:** filter inside the `sub.on("message", ...)` handler:

```typescript
sub.on("message", ({ message }) => {
  if (!message || typeof message !== "object") return;
  const evt = message;
  const evtId = typeof evt.id === "number" ? evt.id : null;
  if (evtId !== null && evtId <= lastEventId) return; // already replayed
  // ... existing send(...) logic
});
```

This requires the publishers to always include `id` (see WR-02). With both changes, snapshot-replay-on-connect becomes truly idempotent across reconnects and brief KV outages.

### WR-06: `reservation_events` create-event gap breaks event-log audit symmetry

**File:** `lib/services/reservations.ts:234-241` (and the symmetric mutation paths)
**Issue:** Every other lifecycle event (`call_requested`, `extend_requested`, `cancel_requested`, `seated_requested`, `no_show_requested`, plus the workflow's `workflow_called`/`workflow_followup`/`workflow_no_show`/`workflow_terminal`) inserts a row into `reservation_events`. `createReservation` does not — it publishes to KV but writes nothing to the event log. The audit trail therefore starts at the first state transition, not at creation. Forensic queries like "show me everything that happened to reservation X" miss the very first row.

This also interacts with WR-02: there is no `id` to feed Last-Event-ID for the create event, and the staff queue SSE replay (`app/api/events/queue/route.ts:117-123`) cannot replay the create event either — a maître reconnecting after a 30-second drop won't see the new reservation in the live stream until the next state change.

**Fix:** Insert a `'reservation_created'` row in `createReservation` before the first KV publish, and pass its id through to both publish helpers. See WR-02 Option A snippet for the exact form.

### WR-07: `tsconfig.json` target ES2017 may cause `using` keyword lowering issues on Vercel build

**File:** `tsconfig.json:3` and `scripts/spike-using-keyword.ts:24-27`, `lib/workflows/reservation.ts` (any future `using` adoption)
**Issue:** `target: "ES2017"` is below the language version that natively supports `using` (ES2023 / TS 5.2+ Explicit Resource Management). TypeScript can lower `using` to ES2017 only if the project has the disposable runtime helpers available. Spike A passed locally via `tsx`, but `next build` with the workflow plugin compiles workflow files to a different runtime path. The workflow currently does NOT use `using` (it uses bare `defineHook(…).create({token})` without resource management), so this is latent — but the spike's "PASS" sign-off may not transfer to production. The README's fallback (`try / finally { hook.dispose() }`) is the safer default.

**Fix:** Either (a) bump `target` to `ES2022` (Vercel's Node 20 runtime supports ES2022 natively), or (b) keep ES2017 and explicitly document in `lib/workflows/_README.md` "Spike Findings" that the `using` decision was deferred and the codebase ships with manual `try/finally` (which it does today). The existing `_README.md` text is currently optimistic in saying `lib/workflows/reservation.ts is cleared to use using hook = createHook(...)` — but the actual implementation does not use `using`, so the README is inconsistent with reality. Sync the docs to the code.

## Info

### IN-01: `reservation_events` event_type column is open-ended; consider a CHECK constraint

**File:** `lib/services/queue.ts:153-159, 235-243, 320-328`; `lib/services/reservations.ts:425-433, 527-535`; `lib/workflows/reservation.ts:251-262, 301-308, 365-373, 419-426`
**Issue:** `event_type` is a free-form TEXT column. Twelve distinct values are written across the codebase: `call_requested, extend_requested, cancel_requested, seated_requested, no_show_requested, workflow_called, workflow_followup, workflow_no_show, workflow_terminal` (plus `reservation_created` if WR-06 lands). A typo in any future producer silently writes a row that the workflow's `fetchMissedEvents` filter ignores — same failure mode as missing the row entirely, but harder to spot.

**Fix:** Add a `CHECK (event_type IN ('call_requested', …))` constraint in a follow-up migration, or define the union as a Postgres ENUM. Phase 2 ships fine without this; raise it for Phase 3 hardening.

### IN-02: `markCalled`/`markSeated`/`markNoShowManual` log `employee_email` cleartext

**File:** `app/api/queue/[id]/call/route.ts:80-81`; `app/api/queue/[id]/seated/route.ts:72-73`; `app/api/queue/[id]/no_show_manual/route.ts:80-81`
**Issue:** The structured log lines emit `employee_email: session.user.email`. The redactor's `PII_KEYS` includes `"email"`, so `redactPII({ employee_email: ... })` redacts it to `[REDACTED]` — but it's worth confirming, because the key is `employee_email`, not `email`. Looking at `lib/log.ts:85-90`, the matcher uses `keyLower = key.toLowerCase()` and checks `PII_KEY_SET.has(keyLower)` — which is the literal string match. `"employee_email"` is NOT in `PII_KEYS`, so this would NOT redact. That said, the value-level email regex in `redactString` would still mask `j****@example.com` inside the value. This is defense-in-depth working as intended, but the leaf-key match misses.

**Fix:** Add `employee_email` to `PII_KEYS`, OR rename the log field to plain `email` so the leaf-key match catches it. Cleaner option: rename to `actor` + `actor_email` and add `actor_email` to PII_KEYS.

### IN-03: `lib/log.ts` `emit()` always uses `console.log`, even at level=error

**File:** `lib/log.ts:110-120`
**Issue:** All log lines go through `console.log(JSON.stringify(line))`. Vercel's log ingestion routes by stream (stdout vs stderr), so error-level lines appear in the "log" stream rather than the "error" stream. Minor — the `level: "error"` field in the JSON line lets you grep — but `console.error` for level=error matches the convention.

**Fix:**

```typescript
function emit(level: LogLevel, event: string, ctx?: Record<string, unknown>): void {
  const redacted = ctx ? (redactPII(ctx) as Record<string, unknown>) : undefined;
  const line: LogLine = { ts: new Date().toISOString(), level, event, ...(redacted ?? {}) };
  const out = JSON.stringify(line);
  if (level === "error") console.error(out);
  else console.log(out);
}
```

### IN-04: `resolveSession` UUID regex is loose (allows non-canonical hyphenation)

**File:** `lib/mcp/auth.ts:104`
**Issue:** `/^[0-9a-fA-F-]{32,40}$/` accepts e.g. `--------xxxxxxxxxxxxxxxxxxxxxxx` or `aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa` (32 a's, no hyphens). The DB column is UUID and would reject the latter, but the early-reject is supposed to spare the round-trip. A canonical UUID regex is `/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/`. Cosmetic; current code is correct, just permissive.

**Fix:**

```typescript
const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
if (!UUID_RE.test(reservationSession)) {
  log.info("mcp.auth.session_malformed");
  return null;
}
```

### IN-05: Hardcoded Spanish messages in service layer should live in a constants file

**File:** `lib/services/reservations.ts:138, 219, 307, 318, 361, 372, 383, 397, 491, 502, 512`; `lib/services/queue.ts:117, 130, 203, 217, 290, 303`
**Issue:** Twenty-something user-facing Spanish strings are inlined across the service layer. Phase 3 is going to want to tweak tone (SAFE-03) and may add WhatsApp adapter that wants the same strings. A small `lib/i18n/es.ts` constants module avoids drift.

**Fix:** Phase 3 hardening — extract to `lib/copy/es.ts`:

```typescript
export const COPY = {
  errors: {
    INVALID_INPUT: "Algunos datos son inválidos. Revisalos e intentá de nuevo.",
    INVALID_SESSION: "No pudimos verificar tu sesión. Volvé a empezar.",
    RESERVATION_NOT_FOUND: "No encontramos tu reserva.",
    // …
  },
} as const;
```

### IN-06: `extend_wait` does not handle the case where `Edge Config` returns 0 for `extension_min`

**File:** `lib/services/reservations.ts:403-414`
**Issue:** `getTypedConfig<number>("extension_min", 5)` defaults to 5 if missing, but a misconfigured Edge Config could write `0` or a negative number. The SQL would then add `0 minutes` or a negative interval, leaving the deadline unchanged or moving it backwards. Defensive check is cheap.

**Fix:**

```typescript
const extensionMin = Math.max(1, await getTypedConfig<number>("extension_min", 5));
```

Same pattern applies to `no_show_timeout_min` at line 116-119.

### IN-07: `seed-demo.ts` deletes by email pattern but doesn't clean up dangling workflow runs

**File:** `scripts/seed-demo.ts:45-67`
**Issue:** `clearDemoRows()` deletes from `reservation_events` and `reservations` but does not stop or terminate the workflow runs that were started by previous `createReservation` calls. The orphan workflows will run their first `loadReservationSnapshot` step, get `null`, and exit cleanly via `final_status: "missing"` — so this is self-healing, but each `npm run dev:reset` accumulates a few extra workflow runs in the dashboard. Acceptable for hackathon ops; document for the pilot.

**Fix:** Add a comment in `seed-demo.ts` near `clearDemoRows`:

```typescript
// NOTE: Existing workflow runs for the deleted reservations are NOT terminated.
// They will detect missing rows on first step and exit with final_status='missing'.
// Watch the Workflow dashboard for orphan-run accumulation across many resets.
```

### IN-08: `lib/workflows/_README.md` "Spike Findings" section is inconsistent with `lib/workflows/reservation.ts`

**File:** `lib/workflows/_README.md:198-212` vs `lib/workflows/reservation.ts:498-548`
**Issue:** The README says "lib/workflows/reservation.ts is cleared to use `using hook = createHook(...)`" and presents the manual try/finally as a fallback only. The actual workflow uses neither: it calls `callHook.create({token: …})` and races the resulting promise without resource management at all. This is fine in terms of behaviour (hooks are managed by the WDK runtime once the race resolves), but the README is misleading.

**Fix:** Update the README to reflect the shipped pattern:

```markdown
### Spike A — TS `using` keyword on Vercel Node 20 — DEFERRED

The spike compiled and ran locally. We ultimately did not adopt `using` in
`reservation.ts` because the typed `defineHook` API resolves on race exit
without explicit disposal. If a future hook usage needs disposal, prefer
`try / finally { await hook.dispose() }` until we verify `using` lowering
on the workflow plugin's emit pipeline.
```

### IN-09: `lib/services/reservations.ts` initial KV publish race — diner SSE could miss create events

**File:** `lib/services/reservations.ts:234-250`
**Issue:** `createReservation` publishes both `reservation.created` (per-reservation channel) and a queue event before the function returns. If the diner client opens the SSE connection on the page that the chatbot navigates to AFTER the create call returns, the publish has already fired and the diner sees only the snapshot (correct state, but no live "you've been added" event). If WR-06 lands (insert into `reservation_events` for create), this becomes recoverable via Last-Event-ID replay; without it, the diner channel is `snapshot only` for the create moment.

**Fix:** Implement WR-06 (insert `reservation_created` row before publish). Then the diner SSE handler's replay path covers reconnects.

---

_Reviewed: 2026-04-26_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
